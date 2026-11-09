/**
 * AnchorTransport TMS - Firebase Phase 1 Configuration & Verification Test Suite
 * Validates Client SDK, Admin SDK, Rules, Config, Emulators, and Multi-Tenant Security
 */

import fs from 'fs';
import path from 'path';
import { adminApp, adminAuth, adminDb, adminStorage, verifyFirebaseAdminConnection } from '../lib/firebase/admin';

async function runFirebaseTests() {
  console.log('🔥 Starting AnchorTransport TMS - Firebase Phase 1 Verification Suite...');
  console.log('------------------------------------------------------------');

  let passed = 0;
  let failed = 0;

  function assert(description: string, condition: boolean, extra?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${description}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${description} ${extra ? `-> ${extra}` : ''}`);
      failed++;
    }
  }

  try {
    // 1. Firebase Config File Verification
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    assert('Config: firebase-applet-config.json exists on disk', fs.existsSync(configPath));

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert('Config: Project ID matches user specification (anchortransports-6d744)', config.projectId === 'anchortransports-6d744');
    assert('Config: API Key present and valid format', typeof config.apiKey === 'string' && config.apiKey.startsWith('AIzaSy'));
    assert('Config: Auth Domain matches project', config.authDomain === 'anchortransports-6d744.firebaseapp.com');
    assert('Config: Storage Bucket matches project', config.storageBucket.includes('anchortransports-6d744'));
    assert('Config: App ID present', typeof config.appId === 'string' && config.appId.length > 10);

    // 2. Firebase Admin SDK Initialization
    assert('Admin SDK: App instance successfully initialized', Boolean(adminApp && adminApp.name));
    assert('Admin SDK: Auth service initialized', Boolean(adminAuth));
    assert('Admin SDK: Firestore service initialized', Boolean(adminDb));
    assert('Admin SDK: Storage service initialized', Boolean(adminStorage));

    const adminVerification = await verifyFirebaseAdminConnection();
    assert('Admin SDK: Connection verification helper returns valid status', adminVerification.initialized && adminVerification.projectId === 'anchortransports-6d744');

    // 3. Firebase Emulator Suite Configuration
    const firebaseJsonPath = path.resolve(process.cwd(), 'firebase.json');
    assert('Emulator: firebase.json exists on disk', fs.existsSync(firebaseJsonPath));

    const firebaseJson = JSON.parse(fs.readFileSync(firebaseJsonPath, 'utf8'));
    assert('Emulator: Auth emulator configured on port 9099', firebaseJson.emulators?.auth?.port === 9099);
    assert('Emulator: Firestore emulator configured on port 8080', firebaseJson.emulators?.firestore?.port === 8080);
    assert('Emulator: Storage emulator configured on port 9199', firebaseJson.emulators?.storage?.port === 9199);
    assert('Emulator: Emulator UI enabled on port 4000', firebaseJson.emulators?.ui?.port === 4000);

    // 4. Firestore & Storage Security Rules Verification
    const firestoreRulesPath = path.resolve(process.cwd(), 'firestore.rules');
    assert('Security: firestore.rules exists', fs.existsSync(firestoreRulesPath));

    const firestoreRules = fs.readFileSync(firestoreRulesPath, 'utf8');
    assert('Security: firestore.rules specifies rules_version = \'2\'', firestoreRules.includes("rules_version = '2'"));
    assert('Security: firestore.rules implements default deny catch-all', firestoreRules.includes('match /{document=**} {\n      allow read, write: if false;'));
    assert('Security: firestore.rules enforces multi-tenant company isolation', firestoreRules.includes('match /companies/{companyId}') && firestoreRules.includes('members'));
    assert('Security: firestore.rules allows non-blocking test connection ping', firestoreRules.includes('match /test/{docId}'));

    const storageRulesPath = path.resolve(process.cwd(), 'storage.rules');
    assert('Security: storage.rules exists', fs.existsSync(storageRulesPath));

    const storageRules = fs.readFileSync(storageRulesPath, 'utf8');
    assert('Security: storage.rules enforces size and MIME-type restrictions for compliance docs', storageRules.includes('isImageOrPdf') && storageRules.includes('isUnderMaxSize'));

    // 5. Firestore Indexes Verification
    const indexesPath = path.resolve(process.cwd(), 'firestore.indexes.json');
    assert('Indexes: firestore.indexes.json exists with composite indexes', fs.existsSync(indexesPath));

    // 6. Environment Templates & Secret Hygiene
    const envExamplePath = path.resolve(process.cwd(), '.env.example');
    assert('Env: .env.example exists with client and server templates', fs.existsSync(envExamplePath));

    const envExample = fs.readFileSync(envExamplePath, 'utf8');
    assert('Env: .env.example contains VITE_FIREBASE_API_KEY template', envExample.includes('VITE_FIREBASE_API_KEY'));
    assert('Env: .env.example contains server-side FIREBASE_PROJECT_ID template', envExample.includes('FIREBASE_PROJECT_ID'));

    const gitignore = fs.readFileSync(path.resolve(process.cwd(), '.gitignore'), 'utf8');
    assert('Security: .gitignore ignores service-account credentials files', gitignore.includes('*serviceAccountKey*.json'));

    // 7. Client SDK Module Verification
    const clientTsPath = path.resolve(process.cwd(), 'src/lib/firebase/client.ts');
    assert('Client SDK: src/lib/firebase/client.ts exists', fs.existsSync(clientTsPath));

    const clientTs = fs.readFileSync(clientTsPath, 'utf8');
    assert('Client SDK: Implements structured handleFirestoreError', clientTs.includes('handleFirestoreError') && clientTs.includes('FirestoreErrorInfo'));
    assert('Client SDK: Connects to local emulator when VITE_USE_FIREBASE_EMULATOR is enabled', clientTs.includes('connectAuthEmulator') && clientTs.includes('connectFirestoreEmulator'));
  } catch (err: unknown) {
    console.error('Fatal execution error:', err);
    failed++;
  }

  console.log('------------------------------------------------------------');
  console.log(`🎯 FIREBASE PHASE 1 VERIFICATION RESULTS:`);
  console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log('------------------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

runFirebaseTests();
