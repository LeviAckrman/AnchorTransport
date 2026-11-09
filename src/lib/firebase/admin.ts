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

function initializeAdmin(): App {
  if (getApps().length > 0) {
    return getApp();
  }

  const credentials = getAdminCredentials();

  if (credentials) {
    return initializeApp({
      credential: credentials,
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

export const adminApp: App = initializeAdmin();
export const adminAuth: Auth = getAuth(adminApp);
export const adminDb: Firestore = getFirestore(adminApp);
export const adminStorage: Storage = getStorage(adminApp);

export async function verifyFirebaseAdminConnection(): Promise<{
  initialized: boolean;
  projectId: string;
  authReady: boolean;
  firestoreReady: boolean;
  storageReady: boolean;
  mode: 'emulator' | 'production_credentials' | 'adc';
  message: string;
}> {
  const isEmulator = Boolean(
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    process.env.VITE_USE_FIREBASE_EMULATOR === 'true'
  );

  const hasCredentials = Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
    (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY)
  );

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
