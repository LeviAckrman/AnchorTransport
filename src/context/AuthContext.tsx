/**
 * AnchorTransport TMS - Client Authentication Context
 * Integrates Firebase Auth, session persistence, tenant context, and permanent DB-backed onboarding state
 */

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { UserRole, Company } from '../types/tms';
import { ROLE_PERMISSIONS, RolePermissionSet } from '../lib/permissions';
import { auth } from '../lib/firebase/client';
import {
  registerFirebaseUser,
  loginFirebaseUser,
  loginWithGoogle,
  logoutFirebaseUser,
  resetFirebasePassword,
  resendVerificationEmail,
  reloadFirebaseUser,
  syncSessionWithBackend,
  onFirebaseAuthStateChange,
} from '../lib/firebase/auth';
import {
  ensureFirestoreUserProfile,
  fetchUserDocFromFirestore,
  listOwnedCompaniesFromFirestore,
  fetchUserCompanyFromFirestore,
  createCompanyInFirestoreAtomic,
  updateCompanyInFirestore,
  updateFirestoreUserProfile,
  FirestoreTMSClient,
  syncBundleToFirestore,
  type HydratedCompanyBundle,
} from '../lib/firebase/firestoreService';
import { clearStoreForNewCustomer, loadStore } from '../lib/storage';
import { safeJsonParse, parseResponseJson } from '../lib/safeFetch';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  phone: string;
  onboardingCompleted?: boolean;
  onboardingCompletedAt?: string;
}

export interface AccessibleCompany {
  companyId: string;
  companyName: string;
  role: UserRole;
}

export interface OnboardCompanyPayload {
  companyName: string;
  tradeName?: string;
  gstin: string;
  pan?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  pincode?: string;
  fleetSize?: string;
  lrPrefix?: string;
  invoicePrefix?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  company: Company | null;
  role: UserRole | null;
  accessibleCompanies: AccessibleCompany[];
  token: string | null;
  isAuthenticated: boolean;
  needsOnboarding: boolean;
  onboardingCompleted: boolean;
  isLoading: boolean;
  isEmailVerified: boolean;
  isFirebaseUser: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  loginWithGoogleAuth: () => Promise<{ success: boolean; error?: string }>;
  register: (
    email: string,
    password: string,
    name: string,
    phone?: string,
    companyName?: string,
    gstin?: string
  ) => Promise<{ success: boolean; error?: string }>;
  onboardCompany: (payload: OnboardCompanyPayload) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  resendVerification: () => Promise<{ sent: boolean; error?: string }>;
  refreshVerificationStatus: () => Promise<{ verified: boolean; error?: string }>;
  logout: () => Promise<void>;
  switchCompany: (companyId: string) => Promise<{ success: boolean; error?: string }>;
  updateUserProfile: (data: { name?: string; phone?: string }) => Promise<{ success: boolean; error?: string }>;
  updateCompanyProfile: (data: Partial<Company>) => Promise<{ success: boolean; error?: string }>;
  permissions: RolePermissionSet | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_STORAGE_KEY = 'anchortransport_auth_session_v2';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [accessibleCompanies, setAccessibleCompanies] = useState<AccessibleCompany[]>([]);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isEmailVerified, setIsEmailVerified] = useState(true);
  const [isFirebaseUser, setIsFirebaseUser] = useState(false);
  const manualAuthInProgressRef = useRef(false);

  const saveSession = (
    u: AuthUser | null,
    c: Company | null,
    r: UserRole | null,
    companies: AccessibleCompany[] = [],
    onboarding = false,
    sessionToken?: string | null,
    completedFlag?: boolean
  ) => {
    const isCompleted =
      completedFlag !== undefined
        ? Boolean(completedFlag)
        : Boolean(u?.onboardingCompleted) || !onboarding;
    const finalNeedsOnboarding = isCompleted ? false : Boolean(onboarding);

    setUser(u ? { ...u, onboardingCompleted: isCompleted } : null);
    setCompany(c);
    setRole(r);
    setAccessibleCompanies(companies);
    setOnboardingCompleted(isCompleted);
    setNeedsOnboarding(finalNeedsOnboarding);

    const activeToken =
      sessionToken !== undefined ? sessionToken : token || localStorage.getItem('token');
    if (activeToken && u) {
      setToken(activeToken);
      localStorage.setItem('token', activeToken);
    }

    if (u) {
      localStorage.setItem(
        AUTH_STORAGE_KEY,
        JSON.stringify({
          user: { ...u, onboardingCompleted: isCompleted },
          company: c,
          role: r,
          accessibleCompanies: companies,
          needsOnboarding: finalNeedsOnboarding,
          onboardingCompleted: isCompleted,
          token: activeToken || '',
        })
      );
    } else {
      setToken(null);
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem('token');
      localStorage.removeItem('onboarding_token');
    }
  };

  const hydrateCompanyContext = async (companyId: string, activeToken?: string | null) => {
    if (!auth.currentUser || !companyId) return;
    try {
      const client = new FirestoreTMSClient(companyId);
      const bundle: HydratedCompanyBundle = await client.hydrateAll();
      const tok = activeToken || localStorage.getItem('token') || '';
      await fetch('/api/sync/hydrate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: JSON.stringify(bundle),
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('tms:firestore-hydrated', { detail: { companyId, bundle } })
        );
      }
    } catch (err) {
      console.warn('Firestore company hydration notice:', err);
    }
  };

  /**
   * Synchronizes an authenticated Firebase user with Firestore user/company docs AND backend session DB.
   * Ensures returning users never re-enter onboarding once completed in Firestore or server DB.
   */
  const syncAuthenticatedFirebaseUser = async (firebaseUser: FirebaseUser) => {
    setIsFirebaseUser(true);
    setIsEmailVerified(Boolean(firebaseUser.emailVerified));

    let userDoc = null;
    try {
      userDoc =
        (await ensureFirestoreUserProfile(firebaseUser)) ||
        (await fetchUserDocFromFirestore(firebaseUser.uid));
    } catch {
      // Ignore if unverified or offline
    }

    let targetCompanyId = userDoc?.activeCompanyId || userDoc?.defaultCompanyId;
    if (!targetCompanyId) {
      try {
        const owned = await listOwnedCompaniesFromFirestore(firebaseUser.uid);
        targetCompanyId = owned[0]?.id;
      } catch {
        // Ignore if unverified or no companies yet
      }
    }

    let firestoreCompany: Company | undefined;
    let firestoreRole: UserRole | undefined;
    if (targetCompanyId) {
      try {
        const companyRes = await fetchUserCompanyFromFirestore(targetCompanyId, firebaseUser.uid);
        if (companyRes) {
          firestoreCompany = companyRes.company;
          firestoreRole = companyRes.role;
        }
      } catch {
        // Ignore read error until verified/member
      }
    }

    const firestoreCompleted =
      userDoc?.onboardingCompleted === true || Boolean(firestoreCompany);

    const session = await syncSessionWithBackend(firebaseUser, {
      phone: userDoc?.phone,
      onboardingCompleted: firestoreCompleted,
      onboardingCompletedAt: userDoc?.onboardingCompletedAt,
      firestoreCompany,
      firestoreRole,
    });

    if (session.success && session.user) {
      const activeTok = session.token || localStorage.getItem('token') || '';
      const resolvedCompleted =
        Boolean(session.onboardingCompleted) ||
        Boolean(session.user.onboardingCompleted) ||
        firestoreCompleted ||
        Boolean(session.company);
      const resolvedNeedsOnboarding = resolvedCompleted
        ? false
        : Boolean(session.needsOnboarding ?? true);

      // Keep Firestore in sync if backend DB already knows user completed onboarding
      if (firebaseUser.emailVerified && resolvedCompleted && !userDoc?.onboardingCompleted) {
        try {
          if (session.company && !firestoreCompany) {
            await createCompanyInFirestoreAtomic(session.company, firebaseUser);
          } else {
            await updateFirestoreUserProfile(firebaseUser.uid, {
              onboardingCompleted: true,
              onboardingCompletedAt: session.user.onboardingCompletedAt,
              ...(session.company?.id
                ? { activeCompanyId: session.company.id, defaultCompanyId: session.company.id }
                : {}),
            });
          }
        } catch {
          // Non-fatal sync error
        }
      }

      saveSession(
        session.user,
        session.company || null,
        (session.role as UserRole) || null,
        (session.accessibleCompanies as AccessibleCompany[]) || [],
        resolvedNeedsOnboarding,
        activeTok,
        resolvedCompleted
      );

      if (session.company?.id) {
        await hydrateCompanyContext(session.company.id, activeTok);
      }
    }

    return session;
  };

  // Restore cached session and verify authoritative onboarding status from backend database on refresh / reopen
  useEffect(() => {
    const initSession = async () => {
      try {
        const stored = localStorage.getItem(AUTH_STORAGE_KEY);
        let storedToken = localStorage.getItem('token');
        let hadCachedUser = false;

        if (stored) {
          const parsed = safeJsonParse<any>(stored);
          if (parsed && typeof parsed === 'object' && parsed.user) {
            hadCachedUser = true;
            const cachedCompleted =
              Boolean(parsed.onboardingCompleted) ||
              Boolean(parsed.user?.onboardingCompleted) ||
              (parsed.needsOnboarding === false && Boolean(parsed.company));
            setUser(parsed.user || null);
            setCompany(parsed.company || null);
            setRole(parsed.role || null);
            setAccessibleCompanies(parsed.accessibleCompanies || []);
            setOnboardingCompleted(cachedCompleted);
            setNeedsOnboarding(cachedCompleted ? false : Boolean(parsed.needsOnboarding));
            if (parsed.token && !storedToken) {
              storedToken = parsed.token;
              localStorage.setItem('token', parsed.token);
            }
          } else {
            localStorage.removeItem(AUTH_STORAGE_KEY);
          }
        }

        if (storedToken) {
          setToken(storedToken);
          // Always re-verify authoritative onboarding & company status against database on refresh / browser reopen
          try {
            const meRes = await fetch('/api/auth/me', {
              headers: { Authorization: `Bearer ${storedToken}` },
            });
            const meData = await parseResponseJson<any>(meRes);
            if (meRes.ok && meData?.success && meData.user) {
              const dbCompleted =
                Boolean(meData.onboardingCompleted) ||
                Boolean(meData.user?.onboardingCompleted) ||
                Boolean(meData.company);
              saveSession(
                meData.user,
                meData.company || null,
                (meData.role as UserRole) || null,
                (meData.accessibleCompanies as AccessibleCompany[]) || [],
                dbCompleted ? false : Boolean(meData.needsOnboarding),
                storedToken,
                dbCompleted
              );
            } else if (meRes.status === 401 && hadCachedUser && !auth.currentUser) {
              saveSession(null, null, null, [], false, null, false);
            }
          } catch {
            // Keep cached session if offline or server briefly unreachable
          }
        }
      } catch (e) {
        console.warn('Failed to parse auth session from localStorage:', e);
      } finally {
        setIsLoading(false);
      }
    };

    initSession();
  }, []);

  // Listen to Firebase client auth state changes (persisted across browser close/reopen & refresh)
  useEffect(() => {
    const unsubscribe = onFirebaseAuthStateChange(async (firebaseUser) => {
      if (!firebaseUser) {
        setIsFirebaseUser(false);
        setIsEmailVerified(true);
        return;
      }

      // Skip background sync while register/login/google-login is actively executing to prevent race conditions
      if (manualAuthInProgressRef.current) {
        return;
      }

      try {
        await syncAuthenticatedFirebaseUser(firebaseUser);
      } catch (err) {
        console.warn('Firebase auth state sync notice:', err);
      }
    });

    return () => unsubscribe();
  }, []);

  /**
   * Login with email and password
   */
  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    manualAuthInProgressRef.current = true;
    try {
      // 1. Try Firebase Auth client first
      let firebaseUser: FirebaseUser | null = null;
      try {
        firebaseUser = await loginFirebaseUser(email, password);
      } catch (fbErr: any) {
        // Fall back to direct backend API
        console.log('Firebase client login note:', fbErr.message);
      }

      if (firebaseUser) {
        const session = await syncAuthenticatedFirebaseUser(firebaseUser);
        if (session.success && session.user) {
          return { success: true };
        }
      }

      // Fallback / standard backend API call
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await parseResponseJson<any>(res);
      if (!res.ok || !data || !data.success) {
        return { success: false, error: data?.error || 'Invalid credentials' };
      }

      const dbCompleted =
        Boolean(data.onboardingCompleted) ||
        Boolean(data.user?.onboardingCompleted) ||
        Boolean(data.company);

      saveSession(
        data.user,
        data.company || null,
        data.role || null,
        data.accessibleCompanies || [],
        dbCompleted ? false : Boolean(data.needsOnboarding),
        data.token,
        dbCompleted
      );
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Login failed.' };
    } finally {
      manualAuthInProgressRef.current = false;
    }
  };

  /**
   * Login using Google Provider popup
   */
  const loginWithGoogleAuth = async (): Promise<{ success: boolean; error?: string }> => {
    manualAuthInProgressRef.current = true;
    try {
      const fbUser = await loginWithGoogle();
      if (fbUser) {
        const session = await syncAuthenticatedFirebaseUser(fbUser);
        if (session.success && session.user) {
          return { success: true };
        }
        return { success: false, error: session.error || 'Failed to sync Google session' };
      }
      return { success: false, error: 'Google sign-in cancelled or failed' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Google sign-in failed' };
    } finally {
      manualAuthInProgressRef.current = false;
    }
  };

  /**
   * Register with email and password
   */
  const register = async (
    email: string,
    password: string,
    name: string,
    phone?: string,
    companyName?: string,
    gstin?: string
  ): Promise<{ success: boolean; error?: string }> => {
    manualAuthInProgressRef.current = true;
    try {
      let fbUser: FirebaseUser | null = null;
      try {
        fbUser = await registerFirebaseUser({ email, password, displayName: name, phone });
        setIsFirebaseUser(true);
        setIsEmailVerified(Boolean(fbUser.emailVerified));
      } catch (fbErr: any) {
        console.log('Firebase client register note:', fbErr.message);
      }

      // Call backend register API
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firebaseUid: fbUser?.uid,
          ownerEmail: email,
          password,
          ownerName: name,
          phone,
          companyName,
          gstin,
        }),
      });

      const data = await parseResponseJson<any>(res);
      if (!res.ok || !data || !data.success) {
        return { success: false, error: data?.error || 'Registration failed.' };
      }

      if (fbUser && fbUser.emailVerified) {
        await ensureFirestoreUserProfile(fbUser);
        if (data.company) {
          await createCompanyInFirestoreAtomic(data.company, fbUser);
        }
      }

      const completed = Boolean(data.onboardingCompleted) || Boolean(data.company);
      saveSession(
        data.user,
        data.company || null,
        data.role || null,
        data.accessibleCompanies || [],
        completed ? false : Boolean(data.needsOnboarding),
        data.token,
        completed
      );
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Registration failed.' };
    } finally {
      manualAuthInProgressRef.current = false;
    }
  };

  /**
   * Onboard Company with trusted server-side assignment of OWNER role
   * Permanently marks onboardingCompleted = true in backend DB and Firestore
   */
  const onboardCompany = async (
    payload: OnboardCompanyPayload
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const activeTok =
        token ||
        (typeof window !== 'undefined'
          ? localStorage.getItem('token') || localStorage.getItem('onboarding_token') || ''
          : '');
      const res = await fetch('/api/auth/onboard-company', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(activeTok ? { Authorization: `Bearer ${activeTok}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await parseResponseJson<any>(res);
      if (!res.ok || !data || !data.success) {
        return { success: false, error: data?.error || 'Company onboarding failed.' };
      }

      if (auth.currentUser && auth.currentUser.emailVerified && data.company) {
        await createCompanyInFirestoreAtomic(data.company, auth.currentUser);
      }

      const activeUser = data.user || user;
      if (activeUser) {
        saveSession(
          {
            ...activeUser,
            onboardingCompleted: true,
          },
          data.company,
          'OWNER',
          data.accessibleCompanies || [],
          false,
          data.token,
          true
        );
      } else {
        setCompany(data.company);
        setRole('OWNER');
        setOnboardingCompleted(true);
        setNeedsOnboarding(false);
        setAccessibleCompanies(data.accessibleCompanies || []);
      }

      if (data.company?.id) {
        await hydrateCompanyContext(data.company.id, data.token);
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Onboarding request failed.' };
    }
  };

  /**
   * Reset Password
   */
  const resetPassword = async (
    email: string
  ): Promise<{ success: boolean; message?: string; error?: string }> => {
    try {
      try {
        await resetFirebasePassword(email);
        return { success: true, message: `Password reset instructions sent to ${email}.` };
      } catch (fbErr) {
        console.warn('Firebase client reset note:', fbErr);
      }

      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await parseResponseJson<any>(res);
      if (!res.ok || !data || !data.success) {
        return { success: false, error: data?.error || 'Failed to send password reset.' };
      }

      return { success: true, message: data.message };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to process password reset.' };
    }
  };

  const resendVerification = async (): Promise<{ sent: boolean; error?: string }> => {
    return resendVerificationEmail();
  };

  const refreshVerificationStatus = async (): Promise<{ verified: boolean; error?: string }> => {
    try {
      const reloaded = await reloadFirebaseUser();
      if (!reloaded) {
        return { verified: false, error: 'No active Firebase session.' };
      }
      setIsEmailVerified(Boolean(reloaded.emailVerified));
      if (!reloaded.emailVerified) {
        return { verified: false };
      }

      await ensureFirestoreUserProfile(reloaded);
      if (company) {
        const existingCompany = await fetchUserCompanyFromFirestore(company.id, reloaded.uid);
        if (!existingCompany) {
          await createCompanyInFirestoreAtomic(company, reloaded);
        } else if (onboardingCompleted) {
          await updateFirestoreUserProfile(reloaded.uid, {
            onboardingCompleted: true,
            activeCompanyId: company.id,
            defaultCompanyId: company.id,
          });
        }
        const localBundle = loadStore();
        await syncBundleToFirestore(company.id, localBundle);
        await hydrateCompanyContext(company.id, token);
      } else if (onboardingCompleted) {
        await updateFirestoreUserProfile(reloaded.uid, {
          onboardingCompleted: true,
        });
      }
      return { verified: true };
    } catch (err: any) {
      return { verified: false, error: err?.message || 'Failed to verify email status.' };
    }
  };

  /**
   * Logout: clears client session only; NEVER resets database onboardingCompleted status.
   */
  const logout = async () => {
    try {
      await logoutFirebaseUser();
    } catch {
      // Ignore
    }
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore
    }
    clearStoreForNewCustomer();
    setIsFirebaseUser(false);
    setIsEmailVerified(true);
    saveSession(null, null, null, [], false, null, false);
  };

  /**
   * Tenant Context Switching
   */
  const switchCompany = async (
    companyId: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const activeTok = token || (typeof window !== 'undefined' ? localStorage.getItem('token') || '' : '');
      const res = await fetch('/api/auth/switch-company', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(activeTok ? { Authorization: `Bearer ${activeTok}` } : {}),
        },
        body: JSON.stringify({ targetCompanyId: companyId }),
      });

      const data = await parseResponseJson<any>(res);
      if (!res.ok || !data || !data.success) {
        return { success: false, error: data?.error || 'Failed to switch company context' };
      }

      if (user) {
        saveSession(user, data.company, data.role, accessibleCompanies, false, data.token, true);
        if (auth.currentUser) {
          await updateFirestoreUserProfile(auth.currentUser.uid, {
            activeCompanyId: companyId,
            onboardingCompleted: true,
          });
        }
      }

      await hydrateCompanyContext(companyId, data.token);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Switching company failed' };
    }
  };

  /**
   * Update User Profile
   */
  const updateUserProfile = async (data: {
    name?: string;
    phone?: string;
  }): Promise<{ success: boolean; error?: string }> => {
    try {
      const activeTok = token || (typeof window !== 'undefined' ? localStorage.getItem('token') || '' : '');
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(activeTok ? { Authorization: `Bearer ${activeTok}` } : {}),
        },
        body: JSON.stringify(data),
      });

      const resData = await parseResponseJson<any>(res);
      if (!res.ok || !resData || !resData.success) {
        return { success: false, error: resData?.error || 'Failed to update profile' };
      }

      if (auth.currentUser) {
        try {
          await updateFirestoreUserProfile(auth.currentUser.uid, data);
        } catch (fbErr) {
          console.warn('Firestore profile update notice:', fbErr);
        }
      }

      if (user) {
        const updatedUser = { ...user, ...resData.user };
        saveSession(updatedUser, company, role, accessibleCompanies, needsOnboarding, undefined, onboardingCompleted);
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error updating profile' };
    }
  };

  /**
   * Update Company Profile (OWNER / ADMIN only)
   */
  const updateCompanyProfile = async (
    data: Partial<Company>
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const activeTok = token || (typeof window !== 'undefined' ? localStorage.getItem('token') || '' : '');
      const res = await fetch('/api/company/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(activeTok ? { Authorization: `Bearer ${activeTok}` } : {}),
        },
        body: JSON.stringify(data),
      });

      const resData = await parseResponseJson<any>(res);
      if (!res.ok || !resData || !resData.success) {
        return { success: false, error: resData?.error || 'Failed to update company profile' };
      }

      if (auth.currentUser && resData.company) {
        await updateCompanyInFirestore(resData.company);
      }

      if (user) {
        saveSession(user, resData.company, role, accessibleCompanies, false, undefined, true);
      } else {
        setCompany(resData.company);
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error updating company profile' };
    }
  };

  const permissions = role ? ROLE_PERMISSIONS[role] : null;

  return (
    <AuthContext.Provider
      value={{
        user,
        company,
        role,
        token,
        accessibleCompanies,
        isAuthenticated: Boolean(user),
        needsOnboarding,
        onboardingCompleted,
        isLoading,
        isEmailVerified,
        isFirebaseUser,
        login,
        loginWithGoogleAuth,
        register,
        onboardCompany,
        resetPassword,
        resendVerification,
        refreshVerificationStatus,
        logout,
        switchCompany,
        updateUserProfile,
        updateCompanyProfile,
        permissions,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
