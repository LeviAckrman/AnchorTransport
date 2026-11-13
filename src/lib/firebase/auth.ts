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

/**
 * Register a new user using Firebase Email/Password Authentication
 */
export async function registerFirebaseUser({
  email,
  password,
  displayName,
}: RegisterParams): Promise<FirebaseUser> {
  const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (displayName && userCredential.user) {
    try {
      await updateProfile(userCredential.user, { displayName: displayName.trim() });
    } catch (e) {
      console.warn('Failed to set displayName on Firebase user:', e);
    }
  }
  if (userCredential.user && !userCredential.user.emailVerified) {
    try {
      await sendEmailVerification(userCredential.user);
    } catch (e) {
      console.warn('Email verification dispatch notice:', e);
    }
  }
  return userCredential.user;
}

/**
 * Resends verification email for the currently signed-in unverified Firebase user
 */
export async function resendVerificationEmail(): Promise<{ sent: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { sent: false, error: 'No active Firebase user.' };
  if (user.emailVerified) return { sent: false, error: 'Email is already verified.' };
  try {
    await sendEmailVerification(user);
    return { sent: true };
  } catch (err: any) {
    return { sent: false, error: err?.message || 'Failed to send verification email.' };
  }
}

/**
 * Reloads the current Firebase user profile to check updated emailVerified status
 */
export async function reloadFirebaseUser(): Promise<FirebaseUser | null> {
  const user = auth.currentUser;
  if (!user) return null;
  await reload(user);
  await user.getIdToken(true);
  return auth.currentUser;
}

/**
 * Sign in using Firebase Email/Password Authentication
 */
export async function loginFirebaseUser(email: string, password: string): Promise<FirebaseUser> {
  const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return userCredential.user;
}

/**
 * Sign in using Firebase Google popup
 */
export async function loginWithGoogle(): Promise<FirebaseUser> {
  const provider = new GoogleAuthProvider();
  const userCredential = await signInWithPopup(auth, provider);
  return userCredential.user;
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
