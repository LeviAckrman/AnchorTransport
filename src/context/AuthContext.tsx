/**
 * AnchorTransport TMS - Client Authentication Context
 * Authoritative Firebase Authentication + Firestore user/membership resolution,
 * permanent DB-backed onboarding state, and safe synchronous listener cleanup on logout.
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
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
  reloadTargetFirebaseUser,
  formatFirebaseAuthError,
  syncSessionWithBackend,
  onFirebaseAuthStateChange,
} from '../lib/firebase/auth';
import {
  ensureFirestoreUserProfile,
  fetchUserDocFromFirestore,
  listOwnedCompaniesFromFirestore,
  listAccessibleCompaniesForUserFromFirestore,
  fetchUserCompanyFromFirestore,
  createCompanyInFirestoreAtomic,
  updateCompanyInFirestore,
  updateFirestoreUserProfile,
} from '../lib/firebase/firestoreService';
import { clearClientTmsCaches, AUTH_SESSION_STORAGE_KEY } from '../lib/storage';
import { parseResponseJson } from '../lib/safeFetch';

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
  verificationDispatchError: string | null;
  login: (email: string, password: string) => Promise<{ success: boolean; requiresVerification?: boolean; error?: string }>;
  loginWithGoogleAuth: () => Promise<{ success: boolean; error?: string }>;
  register: (
    email: string,
    password: string,
    name: string,
    phone?: string,
    companyName?: string,
    gstin?: string
  ) => Promise<{ success: boolean; requiresVerification?: boolean; error?: string }>;
  onboardCompany: (payload: OnboardCompanyPayload) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  resendVerification: () => Promise<{ sent: boolean; alreadyVerified?: boolean; error?: string }>;
  refreshVerificationStatus: () => Promise<{ verified: boolean; error?: string }>;
  logout: () => Promise<void>;
  switchCompany: (companyId: string) => Promise<{ success: boolean; error?: string }>;
  updateUserProfile: (data: { name?: string; phone?: string }) => Promise<{ success: boolean; error?: string }>;
  updateCompanyProfile: (data: Partial<Company>) => Promise<{ success: boolean; error?: string }>;
  registerLogoutCleanup: (cleanupFn: () => void) => () => void;
  permissions: RolePermissionSet | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [accessibleCompanies, setAccessibleCompanies] = useState<AccessibleCompany[]>([]);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [isFirebaseUser, setIsFirebaseUser] = useState(false);
  const [verificationDispatchError, setVerificationDispatchError] = useState<string | null>(null);

  const manualAuthInProgressRef = useRef(false);
  const pendingRegistrationCompanyRef = useRef<{
    companyName: string;
    gstin: string;
    phone?: string;
  } | null>(null);
  const logoutCleanupFnsRef = useRef<Set<() => void>>(new Set());

  const registerLogoutCleanup = useCallback((cleanupFn: () => void) => {
    logoutCleanupFnsRef.current.add(cleanupFn);
    return () => {
      logoutCleanupFnsRef.current.delete(cleanupFn);
    };
  }, []);

  const runLogoutCleanupsSynchronously = useCallback(() => {
    logoutCleanupFnsRef.current.forEach((fn) => {
      try {
        fn();
      } catch {
        // Ignore cleanup callback errors
      }
    });
  }, []);

  const saveSession = useCallback(
    (
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
        sessionToken !== undefined ? sessionToken : localStorage.getItem('token');
      if (activeToken && u) {
        setToken(activeToken);
        localStorage.setItem('token', activeToken);
      }

      if (u) {
        localStorage.setItem(
          AUTH_SESSION_STORAGE_KEY,
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
        clearClientTmsCaches();
      }
    },
    []
  );

  const setUnverifiedFirebaseSession = useCallback(
    (firebaseUser: FirebaseUser) => {
      runLogoutCleanupsSynchronously();
      clearClientTmsCaches();
      setIsFirebaseUser(true);
      setIsEmailVerified(false);
      setToken(null);
      setCompany(null);
      setRole(null);
      setAccessibleCompanies([]);
      setOnboardingCompleted(false);
      setNeedsOnboarding(false);
      setUser({
        id: firebaseUser.uid,
        email: (firebaseUser.email || '').toLowerCase(),
        name:
          firebaseUser.displayName ||
          firebaseUser.email?.split('@')[0] ||
          'Fleet User',
        phone: firebaseUser.phoneNumber || '',
        onboardingCompleted: false,
      });
    },
    [runLogoutCleanupsSynchronously]
  );

  /**
   * Authoritatively resolves Firebase Auth UID, /users/{uid}, company & owner access from Firestore.
   * Also syncs with backend REST session when available.
   */
  const syncAuthenticatedFirebaseUser = useCallback(
    async (firebaseUser: FirebaseUser) => {
      if (!firebaseUser.emailVerified) {
        setUnverifiedFirebaseSession(firebaseUser);
        return {
          success: false,
          user: null,
          company: null,
          role: null,
          token: '',
        };
      }

      setIsFirebaseUser(true);
      setIsEmailVerified(true);
      setVerificationDispatchError(null);

      // 1. Identify UID & retrieve /users/{uid} profile from Firestore
      let userDoc = null;
      try {
        userDoc =
          (await ensureFirestoreUserProfile(firebaseUser)) ||
          (await fetchUserDocFromFirestore(firebaseUser.uid));
      } catch {
        // Ignore if unverified or unavailable
      }

      // 2. Retrieve associated owned company directly from Firestore (strict Owner-Only)
      let firestoreCompany: Company | undefined;
      let firestoreRole: UserRole | undefined;
      let targetCompanyId = userDoc?.activeCompanyId || userDoc?.defaultCompanyId;

      if (targetCompanyId) {
        try {
          const companyRes = await fetchUserCompanyFromFirestore(targetCompanyId, firebaseUser.uid);
          if (companyRes) {
            firestoreCompany = companyRes.company;
            firestoreRole = companyRes.role;
          }
        } catch {
          // Stale or inaccessible targetCompanyId — fall through to query owned companies
        }
      }

      if (!firestoreCompany) {
        try {
          const owned = await listOwnedCompaniesFromFirestore(firebaseUser.uid);
          if (owned.length > 0) {
            firestoreCompany = owned[0];
            firestoreRole = 'OWNER';
          }
        } catch {
          // Ignore if no owned companies exist yet
        }
      }

      const fsAccessibleRaw = await listAccessibleCompaniesForUserFromFirestore(
        firebaseUser.uid,
        userDoc
      ).catch(() => []);
      const fsAccessible: AccessibleCompany[] = fsAccessibleRaw.map((c) => ({
        companyId: c.companyId,
        companyName: c.companyName,
        role: c.role,
      }));

      const firestoreCompleted =
        userDoc?.onboardingCompleted === true || Boolean(firestoreCompany);

      // 3. Optional backend session sync (never required to view Firestore data)
      const session = await syncSessionWithBackend(firebaseUser, {
        phone: userDoc?.phone,
        onboardingCompleted: firestoreCompleted,
        onboardingCompletedAt: userDoc?.onboardingCompletedAt,
        firestoreCompany,
        firestoreRole: firestoreRole || (firestoreCompany ? 'OWNER' : undefined),
        accessibleCompanies: fsAccessible,
      });

      const resolvedUser: AuthUser = session.user
        ? {
            id: firebaseUser.uid,
            email: (firebaseUser.email || session.user.email || '').toLowerCase(),
            name: userDoc?.name || session.user.name || firebaseUser.displayName || 'Fleet Owner',
            phone: userDoc?.phone || session.user.phone || firebaseUser.phoneNumber || '',
            onboardingCompleted:
              firestoreCompleted ||
              Boolean(session.onboardingCompleted) ||
              Boolean(session.user.onboardingCompleted),
            onboardingCompletedAt:
              userDoc?.onboardingCompletedAt || session.user.onboardingCompletedAt,
          }
        : {
            id: firebaseUser.uid,
            email: (firebaseUser.email || '').toLowerCase(),
            name: userDoc?.name || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Fleet Owner',
            phone: userDoc?.phone || firebaseUser.phoneNumber || '',
            onboardingCompleted: firestoreCompleted,
            onboardingCompletedAt: userDoc?.onboardingCompletedAt,
          };

      // Never fall back to a backend session company owned by a different UID
      const ownedSessionCompany =
        session.company && session.company.ownerId === firebaseUser.uid
          ? (session.company as Company)
          : null;
      const resolvedCompany = firestoreCompany || ownedSessionCompany || null;
      const resolvedRole: UserRole | null =
        firestoreRole || (resolvedCompany?.ownerId === firebaseUser.uid ? 'OWNER' : null);

      const resolvedCompleted =
        Boolean(resolvedCompany) ||
        (Boolean(resolvedUser.onboardingCompleted) && !targetCompanyId);
      const resolvedNeedsOnboarding = !resolvedCompany;

      // Accessible companies restricted strictly to Firestore-owned companies for this UID
      const mergedAccessible: AccessibleCompany[] = [...fsAccessible];
      if (
        resolvedCompany &&
        resolvedRole &&
        !mergedAccessible.some((m) => m.companyId === resolvedCompany.id)
      ) {
        mergedAccessible.push({
          companyId: resolvedCompany.id,
          companyName: resolvedCompany.name,
          role: resolvedRole,
        });
      }

      // Keep Firestore /users/{uid} company references aligned with owned company
      if (firebaseUser.emailVerified && resolvedCompany) {
        try {
          if (!firestoreCompany && resolvedCompany.ownerId === firebaseUser.uid) {
            await createCompanyInFirestoreAtomic(resolvedCompany, firebaseUser);
          } else if (
            !userDoc?.onboardingCompleted ||
            userDoc?.activeCompanyId !== resolvedCompany.id ||
            userDoc?.defaultCompanyId !== resolvedCompany.id
          ) {
            await updateFirestoreUserProfile(firebaseUser.uid, {
              onboardingCompleted: true,
              onboardingCompletedAt: resolvedUser.onboardingCompletedAt,
              activeCompanyId: resolvedCompany.id,
              defaultCompanyId: resolvedCompany.id,
            });
          }
        } catch (syncErr) {
          console.warn('Firestore profile/company sync notice:', syncErr);
        }
      }

      const activeTok = session.token || localStorage.getItem('token') || '';
      saveSession(
        resolvedUser,
        resolvedCompany,
        resolvedRole,
        mergedAccessible,
        resolvedNeedsOnboarding,
        activeTok,
        resolvedCompleted
      );

      return {
        success: true,
        user: resolvedUser,
        company: resolvedCompany,
        role: resolvedRole,
        token: activeTok,
      };
    },
    [saveSession, setUnverifiedFirebaseSession]
  );

  // Authoritative Firebase onAuthStateChanged listener across refreshes & browser close/reopen
  useEffect(() => {
    let mounted = true;
    const unsubscribe = onFirebaseAuthStateChange(async (firebaseUser) => {
      if (!mounted) return;

      if (firebaseUser) {
        if (manualAuthInProgressRef.current) {
          return;
        }
        try {
          // Always reload from Firebase Auth server so emailVerified is never stale
          const freshUser = await reloadTargetFirebaseUser(firebaseUser).catch(
            () => firebaseUser
          );
          if (!mounted) return;
          if (!freshUser.emailVerified) {
            setUnverifiedFirebaseSession(freshUser);
            return;
          }
          await syncAuthenticatedFirebaseUser(freshUser);
        } catch (err) {
          console.warn('Firebase auth state sync notice:', err);
        } finally {
          if (mounted) setIsLoading(false);
        }
        return;
      }

      // No Firebase user signed in — tear down listeners & verify if a non-Firebase token exists
      runLogoutCleanupsSynchronously();
      setIsFirebaseUser(false);
      setIsEmailVerified(false);
      setVerificationDispatchError(null);

      const storedToken = localStorage.getItem('token');
      if (storedToken) {
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
            if (mounted) setIsLoading(false);
            return;
          }
        } catch {
          // Ignore network failure and fall through to logged-out state
        }
      }

      saveSession(null, null, null, [], false, null, false);
      if (mounted) setIsLoading(false);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [syncAuthenticatedFirebaseUser, setUnverifiedFirebaseSession, runLogoutCleanupsSynchronously, saveSession]);

  /**
   * Login with email and password (Firebase Auth primary, enforcing user.reload() + emailVerified)
   */
  const login = async (
    email: string,
    password: string
  ): Promise<{ success: boolean; requiresVerification?: boolean; error?: string }> => {
    manualAuthInProgressRef.current = true;
    setVerificationDispatchError(null);
    try {
      let firebaseUser: FirebaseUser | null = null;
      let firebaseErr: any = null;
      try {
        firebaseUser = await loginFirebaseUser(email, password);
      } catch (fbErr: any) {
        firebaseErr = fbErr;
      }

      if (firebaseUser) {
        if (!firebaseUser.emailVerified) {
          setUnverifiedFirebaseSession(firebaseUser);
          return { success: true, requiresVerification: true };
        }
        await syncAuthenticatedFirebaseUser(firebaseUser);
        return { success: true };
      }

      const code = firebaseErr?.code as string | undefined;
      if (
        code === 'auth/wrong-password' ||
        code === 'auth/too-many-requests' ||
        code === 'auth/user-disabled' ||
        code === 'auth/invalid-email'
      ) {
        return { success: false, error: formatFirebaseAuthError(firebaseErr) };
      }

      // Fallback to server auth only if no Firebase account matched
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await parseResponseJson<any>(res);
      if (!res.ok || !data || !data.success) {
        return {
          success: false,
          error: firebaseErr ? formatFirebaseAuthError(firebaseErr) : data?.error || 'Invalid credentials',
        };
      }

      const dbCompleted =
        Boolean(data.onboardingCompleted) ||
        Boolean(data.user?.onboardingCompleted) ||
        Boolean(data.company);

      setIsEmailVerified(true);
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
        await syncAuthenticatedFirebaseUser(fbUser);
        return { success: true };
      }
      return { success: false, error: 'Google sign-in cancelled or failed' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Google sign-in failed' };
    } finally {
      manualAuthInProgressRef.current = false;
    }
  };

  /**
   * Register with email and password -> immediately dispatches Firebase verification email
   * and enforces email verification before any dashboard or onboarding access.
   */
  const register = async (
    email: string,
    password: string,
    name: string,
    phone?: string,
    companyName?: string,
    gstin?: string
  ): Promise<{ success: boolean; requiresVerification?: boolean; error?: string }> => {
    manualAuthInProgressRef.current = true;
    setVerificationDispatchError(null);
    try {
      let fbUser: FirebaseUser;
      let verificationSent = false;
      let verificationError: string | undefined;
      try {
        const regResult = await registerFirebaseUser({
          email,
          password,
          displayName: name,
          phone,
        });
        fbUser = regResult.user;
        verificationSent = regResult.verificationSent;
        verificationError = regResult.verificationError;
      } catch (fbErr: any) {
        return { success: false, error: formatFirebaseAuthError(fbErr) };
      }

      if (companyName && gstin) {
        pendingRegistrationCompanyRef.current = {
          companyName: companyName.trim(),
          gstin: gstin.trim().toUpperCase(),
          phone: phone?.trim(),
        };
      } else {
        pendingRegistrationCompanyRef.current = null;
      }

      if (!fbUser.emailVerified) {
        setUnverifiedFirebaseSession(fbUser);
        if (!verificationSent && verificationError) {
          setVerificationDispatchError(verificationError);
        }
        return { success: true, requiresVerification: true };
      }

      await syncAuthenticatedFirebaseUser(fbUser);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Registration failed.' };
    } finally {
      manualAuthInProgressRef.current = false;
    }
  };

  /**
   * Onboard Company & permanently mark onboardingCompleted = true in Firestore (+ backend session)
   */
  const onboardCompany = async (
    payload: OnboardCompanyPayload
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const fbUser = auth.currentUser;
      const activeTok =
        token ||
        (typeof window !== 'undefined'
          ? localStorage.getItem('token') || localStorage.getItem('onboarding_token') || ''
          : '');

      // Optional backend call to keep JWT/session aligned
      let backendData: any = null;
      try {
        const res = await fetch('/api/auth/onboard-company', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(activeTok ? { Authorization: `Bearer ${activeTok}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        const parsed = await parseResponseJson<any>(res);
        if (res.ok && parsed?.success) {
          backendData = parsed;
        }
      } catch {
        // Proceed directly with Firestore
      }

      const companyId =
        backendData?.company?.id ||
        `comp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      const newCompany: Company = backendData?.company || {
        id: companyId,
        name: payload.companyName.trim(),
        tradeName: (payload.tradeName || payload.companyName).trim(),
        gstin: payload.gstin.trim().toUpperCase(),
        pan: payload.pan?.trim().toUpperCase() || '',
        phone: payload.phone?.trim() || user?.phone || '',
        email: payload.email?.trim() || user?.email || '',
        address: payload.address?.trim() || '',
        city: payload.city?.trim() || '',
        state: payload.state?.trim() || '',
        stateCode: payload.stateCode?.trim() || '',
        pincode: payload.pincode?.trim() || '',
        bankName: '',
        accountNumber: '',
        ifscCode: '',
        branch: '',
        lrPrefix: payload.lrPrefix?.trim() || 'AT/25-26/',
        invoicePrefix: payload.invoicePrefix?.trim() || 'INV/25-26/',
        tripPrefix: 'TR-',
        ownerId: fbUser?.uid || user?.id,
      };

      if (fbUser) {
        if (!fbUser.emailVerified) {
          await reloadFirebaseUser();
          setIsEmailVerified(Boolean(auth.currentUser?.emailVerified));
        }
        if (auth.currentUser && auth.currentUser.emailVerified) {
          await auth.currentUser.getIdToken(true).catch(() => null);
          await createCompanyInFirestoreAtomic(
            { ...newCompany, fleetSize: payload.fleetSize, ownerId: auth.currentUser.uid },
            auth.currentUser
          );
        }
      }

      const nextUser: AuthUser = {
        ...(backendData?.user || user || {
          id: fbUser?.uid || '',
          email: fbUser?.email || '',
          name: fbUser?.displayName || 'Fleet User',
          phone: '',
        }),
        onboardingCompleted: true,
        onboardingCompletedAt:
          backendData?.user?.onboardingCompletedAt || new Date().toISOString(),
      };

      const nextAccessible: AccessibleCompany[] = backendData?.accessibleCompanies?.length
        ? backendData.accessibleCompanies
        : [{ companyId: newCompany.id, companyName: newCompany.name, role: 'OWNER' }];

      saveSession(
        nextUser,
        newCompany,
        'OWNER',
        nextAccessible,
        false,
        backendData?.token || activeTok,
        true
      );

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
      await resetFirebasePassword(email);
      return { success: true, message: `Password reset instructions sent to ${email}.` };
    } catch (fbErr: any) {
      return { success: false, error: fbErr?.message || 'Failed to send password reset.' };
    }
  };

  const refreshVerificationStatus = useCallback(async (): Promise<{
    verified: boolean;
    error?: string;
  }> => {
    try {
      const reloaded = await reloadFirebaseUser();
      if (!reloaded) {
        return { verified: false, error: 'No active Firebase session. Please log in again.' };
      }
      if (!reloaded.emailVerified) {
        setIsEmailVerified(false);
        return { verified: false };
      }

      setIsEmailVerified(true);
      setVerificationDispatchError(null);
      await ensureFirestoreUserProfile(reloaded);

      // Complete pending 1-step registration company creation if user entered company details before verifying
      const pendingCo = pendingRegistrationCompanyRef.current;
      if (pendingCo) {
        pendingRegistrationCompanyRef.current = null;
        const companyId = `comp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const createdCo: Company & { ownerId?: string } = {
          id: companyId,
          name: pendingCo.companyName,
          tradeName: pendingCo.companyName,
          gstin: pendingCo.gstin,
          pan: pendingCo.gstin.length >= 12 ? pendingCo.gstin.substring(2, 12) : '',
          phone: pendingCo.phone || '',
          email: reloaded.email || '',
          address: '',
          city: '',
          state: '',
          stateCode: pendingCo.gstin.length >= 2 ? pendingCo.gstin.substring(0, 2) : '',
          pincode: '',
          bankName: '',
          accountNumber: '',
          ifscCode: '',
          branch: '',
          lrPrefix: 'AT/25-26/',
          invoicePrefix: 'INV/25-26/',
          tripPrefix: 'TR-',
          createdAt: new Date().toISOString(),
          ownerId: reloaded.uid,
        };
        await createCompanyInFirestoreAtomic(createdCo, reloaded);
      } else if (company?.id) {
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
      } else if (onboardingCompleted) {
        await updateFirestoreUserProfile(reloaded.uid, {
          onboardingCompleted: true,
        });
      }

      await syncAuthenticatedFirebaseUser(reloaded);
      return { verified: true };
    } catch (err: any) {
      return { verified: false, error: formatFirebaseAuthError(err) };
    }
  }, [company, onboardingCompleted, syncAuthenticatedFirebaseUser]);

  const resendVerification = useCallback(async (): Promise<{
    sent: boolean;
    alreadyVerified?: boolean;
    error?: string;
  }> => {
    const res = await resendVerificationEmail();
    if (res.sent) {
      setVerificationDispatchError(null);
    } else if (res.alreadyVerified) {
      await refreshVerificationStatus();
    }
    return res;
  }, [refreshVerificationStatus]);

  /**
   * Logout:
   * 1. Synchronously unsubscribes all active Firestore listeners & clears user-specific frontend state
   * 2. Clears cached browser tokens/session state
   * 3. Signs out of Firebase Auth
   * NEVER deletes Firestore documents or resets company operational data.
   */
  const logout = async () => {
    pendingRegistrationCompanyRef.current = null;
    setVerificationDispatchError(null);
    runLogoutCleanupsSynchronously();
    clearClientTmsCaches();
    setIsFirebaseUser(false);
    setIsEmailVerified(false);
    saveSession(null, null, null, [], false, null, false);

    try {
      await logoutFirebaseUser();
    } catch {
      // Ignore Firebase sign-out error
    }
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore
    }
  };

  /**
   * Tenant Context Switching (authoritative Firestore membership & profile update)
   */
  const switchCompany = async (
    companyId: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      if (auth.currentUser) {
        const companyRes = await fetchUserCompanyFromFirestore(companyId, auth.currentUser.uid);
        if (!companyRes) {
          return { success: false, error: 'You do not have active access to the target company.' };
        }
        await updateFirestoreUserProfile(auth.currentUser.uid, {
          activeCompanyId: companyId,
          onboardingCompleted: true,
        });
        if (user) {
          saveSession(
            user,
            companyRes.company,
            companyRes.role,
            accessibleCompanies,
            false,
            token,
            true
          );
        }
        return { success: true };
      }

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
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Switching company failed' };
    }
  };

  /**
   * Update User Profile (Firestore primary)
   */
  const updateUserProfile = async (data: {
    name?: string;
    phone?: string;
  }): Promise<{ success: boolean; error?: string }> => {
    try {
      if (auth.currentUser) {
        await updateFirestoreUserProfile(auth.currentUser.uid, data);
        if (user) {
          const updatedUser = {
            ...user,
            name: data.name ?? user.name,
            phone: data.phone ?? user.phone,
          };
          saveSession(
            updatedUser,
            company,
            role,
            accessibleCompanies,
            needsOnboarding,
            undefined,
            onboardingCompleted
          );
        }
        const activeTok = token || (typeof window !== 'undefined' ? localStorage.getItem('token') || '' : '');
        if (activeTok) {
          fetch('/api/auth/profile', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${activeTok}`,
            },
            body: JSON.stringify(data),
          }).catch(() => null);
        }
        return { success: true };
      }

      return { success: false, error: 'Authentication required to update profile.' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to update profile' };
    }
  };

  /**
   * Update Company Profile (OWNER / ADMIN only, Firestore primary)
   */
  const updateCompanyProfile = async (
    data: Partial<Company>
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      if (!company?.id) {
        return { success: false, error: 'No active company selected.' };
      }

      const updatedCompany: Company = {
        ...company,
        ...data,
        id: company.id,
      };

      if (auth.currentUser) {
        await updateCompanyInFirestore(updatedCompany);
        if (user) {
          saveSession(
            user,
            updatedCompany,
            role,
            accessibleCompanies,
            false,
            undefined,
            true
          );
        } else {
          setCompany(updatedCompany);
        }

        const activeTok = token || (typeof window !== 'undefined' ? localStorage.getItem('token') || '' : '');
        if (activeTok) {
          fetch('/api/company/profile', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${activeTok}`,
            },
            body: JSON.stringify(data),
          }).catch(() => null);
        }
        return { success: true };
      }

      return { success: false, error: 'Authentication required to update company profile.' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to update company profile' };
    }
  };

  const permissions = role ? ROLE_PERMISSIONS[role] : null;

  return (
    <AuthContext.Provider
      value={{
        user,
        company,
        role,
        accessibleCompanies,
        token,
        isAuthenticated: Boolean(user),
        needsOnboarding,
        onboardingCompleted,
        isLoading,
        isEmailVerified,
        isFirebaseUser,
        verificationDispatchError,
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
        registerLogoutCleanup,
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
