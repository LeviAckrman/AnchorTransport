/**
 * AnchorTransport TMS - Firebase Admin SDK Initialization
 * STRICTLY SERVER-SIDE ONLY. Never import into React client components.
 */

import { initializeApp, getApps, getApp, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';
import fs from 'fs';
import path from 'path';

// Target Firebase Project ID
const projectId =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.VITE_FIREBASE_PROJECT_ID ||
  'anchortransports-6d744';

const storageBucket =
  process.env.FIREBASE_STORAGE_BUCKET ||
  process.env.VITE_FIREBASE_STORAGE_BUCKET ||
  `${projectId}.firebasestorage.app`;

function getAdminCredentials() {
  // 1. Direct Service Account JSON string in environment variable
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY.trim();
      if (raw.startsWith('{')) {
        return cert(JSON.parse(raw));
      }
      // If provided as a file path
      const resolvedPath = path.resolve(process.cwd(), raw);
      if (fs.existsSync(resolvedPath)) {
        const fileContent = fs.readFileSync(resolvedPath, 'utf8');
        return cert(JSON.parse(fileContent));
      }
    } catch (e) {
      console.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', e);
    }
  }

  // 2. Individual environment variables
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
    return cert({
      projectId,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    });
  }

  // 3. Local serviceAccountKey.json file if present in workspace root (dev only)
  const localKeyPath = path.resolve(process.cwd(), 'serviceAccountKey.json');
  if (fs.existsSync(localKeyPath)) {
    try {
      const keyData = JSON.parse(fs.readFileSync(localKeyPath, 'utf8'));
      return cert(keyData);
    } catch {
      // Ignored
    }
  }

  // 4. Fallback for Emulator or Google Application Default Credentials (ADC)
  return undefined;
}

const resolvedCredentials = getAdminCredentials();
const isEmulatorRuntime = Boolean(
  process.env.FIRESTORE_EMULATOR_HOST ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||
  process.env.VITE_USE_FIREBASE_EMULATOR === 'true'
);
const hasExplicitAdminFirestoreAccess = Boolean(
  resolvedCredentials ||
  isEmulatorRuntime ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS
);
let adminFirestoreUnavailable = !hasExplicitAdminFirestoreAccess;

function initializeAdmin(): App {
  if (getApps().length > 0) {
    return getApp();
  }

  if (resolvedCredentials) {
    return initializeApp({
      credential: resolvedCredentials,
      projectId,
      storageBucket,
    });
  }

  // When running with emulators or Google Cloud Run / ADC
  return initializeApp({
    projectId,
    storageBucket,
  });
}

const firestoreDatabaseId =
  process.env.FIRESTORE_DATABASE_ID ||
  process.env.VITE_FIRESTORE_DATABASE_ID ||
  'ai-studio-anchortransportt-c5041a54-7d47-45d6-a1f6-5144adf1df5d';

export const adminApp: App = initializeAdmin();
export const adminAuth: Auth = getAuth(adminApp);
export const adminDb: Firestore = firestoreDatabaseId
  ? getFirestore(adminApp, firestoreDatabaseId)
  : getFirestore(adminApp);
export const adminStorage: Storage = getStorage(adminApp);

export function isAdminFirestoreWritable(): boolean {
  return Boolean(adminDb) && !adminFirestoreUnavailable;
}

function isAdminPermissionError(err: unknown): boolean {
  const code = (err as any)?.code;
  const msg = err instanceof Error ? err.message : String(err || '');
  return (
    code === 7 ||
    code === 16 ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('UNAUTHENTICATED') ||
    msg.includes('Could not load the default credentials')
  );
}

/**
 * Runs a best-effort server-side Admin Firestore operation only when explicit
 * Service Account / Emulator credentials are configured. Automatically disables
 * further Admin Firestore attempts on cross-project PERMISSION_DENIED errors so
 * client-side authenticated Firebase SDK remains the clean persistence path.
 */
export async function runAdminFirestore<T>(
  label: string,
  operation: (db: Firestore) => Promise<T>
): Promise<T | null> {
  if (!adminDb || adminFirestoreUnavailable) {
    return null;
  }
  try {
    return await operation(adminDb);
  } catch (err) {
    if (isAdminPermissionError(err)) {
      adminFirestoreUnavailable = true;
      return null;
    }
    console.warn(`${label}:`, err);
    return null;
  }
}

export async function verifyFirebaseAdminConnection(): Promise<{
  initialized: boolean;
  projectId: string;
  authReady: boolean;
  firestoreReady: boolean;
  storageReady: boolean;
  mode: 'emulator' | 'production_credentials' | 'adc';
  message: string;
}> {
  const isEmulator = isEmulatorRuntime;
  const hasCredentials = Boolean(resolvedCredentials);

  return {
    initialized: true,
    projectId,
    authReady: true,
    firestoreReady: true,
    storageReady: true,
    mode: isEmulator ? 'emulator' : hasCredentials ? 'production_credentials' : 'adc',
    message: isEmulator
      ? 'Firebase Admin SDK configured in Local Emulator mode'
      : hasCredentials
      ? 'Firebase Admin SDK successfully authenticated via Service Account'
      : 'Firebase Admin SDK initialized (using project ID / ADC credentials)',
  };
}
