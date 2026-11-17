/**
 * AnchorTransport TMS - Firebase Client Authentication Service
 * Handles user registration, sign-in, sign-out, password reset, and session synchronization
 */

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  reload,
  updateProfile,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import { auth } from './client';
import { parseResponseJson } from '../safeFetch';

export interface RegisterParams {
  email: string;
  password: string;
  displayName: string;
  phone?: string;
}

export interface AuthSessionResponse {
  success: boolean;
  user?: {
    id: string;
    email: string;
    name: string;
    phone: string;
    onboardingCompleted?: boolean;
    onboardingCompletedAt?: string;
  };
  company?: any;
  role?: string;
  needsOnboarding?: boolean;
  onboardingCompleted?: boolean;
  accessibleCompanies?: Array<{
    companyId: string;
    companyName: string;
    role: string;
  }>;
  token?: string;
  error?: string;
}

export interface RegisterFirebaseResult {
  user: FirebaseUser;
  verificationSent: boolean;
  verificationError?: string;
}

export function formatFirebaseAuthError(err: unknown): string {
  const code = (err as any)?.code as string | undefined;
  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account with this email address already exists. Please sign in instead.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Password is too weak. Please use at least 6 characters.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Invalid email or password. Please check your credentials and try again.';
    case 'auth/too-many-requests':
      return 'Too many requests in a short period. Please wait a minute and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact your administrator.';
    case 'auth/network-request-failed':
      return 'Network error while contacting Firebase Authentication. Please check your connection.';
    default:
      return err instanceof Error ? err.message : 'Authentication request failed.';
  }
}

/**
 * Register a new user using Firebase Email/Password Authentication
 * and immediately dispatch a verification email via sendEmailVerification().
 */
export async function registerFirebaseUser({
  email,
  password,
  displayName,
}: RegisterParams): Promise<RegisterFirebaseResult> {
  const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (displayName && userCredential.user) {
    try {
      await updateProfile(userCredential.user, { displayName: displayName.trim() });
    } catch (e) {
      console.warn('Failed to set displayName on Firebase user:', e);
    }
  }

  let verificationSent = false;
  let verificationError: string | undefined;
  if (userCredential.user && !userCredential.user.emailVerified) {
    try {
      await sendEmailVerification(userCredential.user);
      verificationSent = true;
    } catch (e) {
      verificationError = formatFirebaseAuthError(e);
      console.warn('Email verification dispatch notice:', e);
    }
  } else if (userCredential.user?.emailVerified) {
    verificationSent = true;
  }

  return {
    user: userCredential.user,
    verificationSent,
    verificationError,
  };
}

/**
 * Resends verification email for the currently signed-in unverified Firebase user
 */
export async function resendVerificationEmail(): Promise<{
  sent: boolean;
  alreadyVerified?: boolean;
  error?: string;
}> {
  const user = auth.currentUser;
  if (!user) return { sent: false, error: 'No active Firebase session. Please log in again.' };

  try {
    await reload(user);
    const freshUser = auth.currentUser || user;
    if (freshUser.emailVerified) {
      await freshUser.getIdToken(true);
      return { sent: false, alreadyVerified: true };
    }
    await sendEmailVerification(freshUser);
    return { sent: true };
  } catch (err: any) {
    return { sent: false, error: formatFirebaseAuthError(err) };
  }
}

/**
 * Reloads a specific Firebase user instance using user.reload()
 * so emailVerified reflects the authoritative server state.
 */
export async function reloadTargetFirebaseUser(fbUser: FirebaseUser): Promise<FirebaseUser> {
  await reload(fbUser);
  const current = auth.currentUser || fbUser;
  if (current.emailVerified) {
    await current.getIdToken(true);
  }
  return current;
}

/**
 * Reloads the current Firebase user profile to check updated emailVerified status
 */
export async function reloadFirebaseUser(): Promise<FirebaseUser | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return reloadTargetFirebaseUser(user);
}

/**
 * Sign in using Firebase Email/Password Authentication
 */
export async function loginFirebaseUser(email: string, password: string): Promise<FirebaseUser> {
  const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return reloadTargetFirebaseUser(userCredential.user);
}

/**
 * Sign in using Firebase Google popup
 */
export async function loginWithGoogle(): Promise<FirebaseUser> {
  const provider = new GoogleAuthProvider();
  const userCredential = await signInWithPopup(auth, provider);
  return reloadTargetFirebaseUser(userCredential.user);
}

/**
 * Send password reset email via Firebase
 */
export async function resetFirebasePassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

/**
 * Sign out of Firebase Client
 */
export async function logoutFirebaseUser(): Promise<void> {
  await signOut(auth);
}

/**
 * Sync Firebase Auth ID Token with trusted backend to obtain session cookie & tenant context
 */
export async function syncSessionWithBackend(
  firebaseUser: FirebaseUser | null,
  extra?: {
    phone?: string;
    onboardingCompleted?: boolean;
    onboardingCompletedAt?: string;
    firestoreCompany?: any;
    firestoreRole?: string;
    accessibleCompanies?: Array<{ companyId: string; companyName: string; role: string }>;
  }
): Promise<AuthSessionResponse> {
  if (!firebaseUser) {
    // Call server logout to clear cookies
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    }
    return { success: false, error: 'User is not signed in.' };
  }

  try {
    const idToken = await firebaseUser.getIdToken();
    const res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken,
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        name: firebaseUser.displayName || firebaseUser.email?.split('@')[0],
        phone: extra?.phone ?? firebaseUser.phoneNumber ?? '',
        emailVerified: firebaseUser.emailVerified,
        onboardingCompleted: extra?.onboardingCompleted,
        onboardingCompletedAt: extra?.onboardingCompletedAt,
        firestoreCompany: extra?.firestoreCompany,
        firestoreRole: extra?.firestoreRole,
        accessibleCompanies: extra?.accessibleCompanies,
      }),
    });

    const data = await parseResponseJson(res);
    return data || { success: false, error: 'Empty response from auth session sync' };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to synchronize session with backend.',
    };
  }
}

/**
 * Listen for Firebase auth state changes
 */
export function onFirebaseAuthStateChange(callback: (user: FirebaseUser | null) => void) {
  return onAuthStateChanged(auth, callback);
}
