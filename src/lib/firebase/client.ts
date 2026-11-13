/**
 * AnchorTransport TMS - Firebase Client SDK Initialization
 * Client-safe initialization for React SPA / Vite
 */

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDocFromServer, type Firestore } from 'firebase/firestore';
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';
import fallbackConfig from '../../../firebase-applet-config.json';

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

// Retrieve config from Vite environment variables with graceful fallback
export const firebaseClientConfig: FirebaseClientConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || fallbackConfig.apiKey || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || fallbackConfig.authDomain || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || fallbackConfig.projectId || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || fallbackConfig.storageBucket || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || fallbackConfig.messagingSenderId || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || fallbackConfig.appId || '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || fallbackConfig.measurementId || '',
};

// Singleton App Initialization
export const app: FirebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseClientConfig);

export const FIRESTORE_DATABASE_ID =
  import.meta.env.VITE_FIRESTORE_DATABASE_ID ||
  fallbackConfig.firestoreDatabaseId ||
  'ai-studio-anchortransportt-c5041a54-7d47-45d6-a1f6-5144adf1df5d';

// Initialize Services
export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app, FIRESTORE_DATABASE_ID);
export const storage: FirebaseStorage = getStorage(app);

// Connect Local Emulators if configured
const useEmulator = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';

if (typeof window !== 'undefined' && useEmulator) {
  try {
    const authEmulatorHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST || 'http://localhost:9099';
    const firestoreEmulatorHost = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST || 'localhost:8080';
    const storageEmulatorHost = import.meta.env.VITE_FIREBASE_STORAGE_EMULATOR_HOST || 'localhost:9199';

    const [fHost, fPort] = firestoreEmulatorHost.split(':');
    const [sHost, sPort] = storageEmulatorHost.split(':');

    connectAuthEmulator(auth, authEmulatorHost, { disableWarnings: true });
    connectFirestoreEmulator(db, fHost, parseInt(fPort || '8080', 10));
    connectStorageEmulator(storage, sHost, parseInt(sPort || '9199', 10));

    console.log('⚡ Connected to Firebase Local Emulator Suite');
  } catch (err) {
    console.warn('Firebase emulator connection notice:', err);
  }
}

// Structured Firestore Error Handler per Security Specification
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const currentUser = auth.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: currentUser?.emailVerified ?? null,
      isAnonymous: currentUser?.isAnonymous ?? null,
      tenantId: currentUser?.tenantId ?? null,
      providerInfo: currentUser?.providerData?.map((p) => ({
        providerId: p.providerId,
        email: p.email,
      })) || [],
    },
    operationType,
    path,
  };

  console.error('Firestore Error:', JSON.stringify(errInfo, null, 2));
  throw new Error(JSON.stringify(errInfo));
}

// Client Connection Health Verification Helper
export async function verifyFirebaseClientConnection(): Promise<{
  connected: boolean;
  projectId: string;
  error?: string;
}> {
  try {
    // Attempt non-blocking test read from the open /test/connection document
    await getDocFromServer(doc(db, 'test', 'connection'));
    return {
      connected: true,
      projectId: firebaseClientConfig.projectId,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // If the document does not exist, getDocFromServer still successfully completes network roundtrip
    if (message.includes('No document to update') || message.includes('Missing or insufficient permissions')) {
      return {
        connected: true,
        projectId: firebaseClientConfig.projectId,
      };
    }
    return {
      connected: false,
      projectId: firebaseClientConfig.projectId,
      error: message,
    };
  }
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

if (typeof window !== 'undefined') {
  testConnection();
}
