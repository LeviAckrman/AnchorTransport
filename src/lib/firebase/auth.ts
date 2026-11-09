/**
 * AnchorTransport TMS - Firebase Client Authentication Service
 * Handles user registration, sign-in, sign-out, password reset, and session synchronization
 */

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
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
  };
  company?: any;
  role?: string;
  needsOnboarding?: boolean;
  accessibleCompanies?: Array<{
    companyId: string;
    companyName: string;
    role: string;
  }>;
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
  return userCredential.user;
}

/**
 * Sign in using Firebase Email/Password Authentication
 */
export async function loginFirebaseUser(email: string, password: string): Promise<FirebaseUser> {
  const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
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
export async function syncSessionWithBackend(firebaseUser: FirebaseUser | null): Promise<AuthSessionResponse> {
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
        email: firebaseUser.email,
        name: firebaseUser.displayName || firebaseUser.email?.split('@')[0],
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
