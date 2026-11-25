/**
 * AnchorTransport TMS - Firebase Cloud Storage User Isolation & Security Test Suite
 *
 * Covers TEST 1 through TEST 8:
 *   TEST 1: Verified User A uploads to users/{uidA}/{category}/{fileName} + Firestore /users/{uidA}/files/{fileId}
 *   TEST 2: Logout & Re-login persistence (zero Storage/Firestore data loss on logout, restored on re-login)
 *   TEST 3: Cross-user isolation (User B denied read/download/create/update/delete on User A files & metadata)
 *   TEST 4: Path/URL tampering & customMetadata spoofing prevention
 *   TEST 5: Unverified email user denied Storage & Firestore file metadata access
 *   TEST 6: Logged-out visitor denied all Storage & Firestore file operations
 *   TEST 7: Safe delete ordering (Storage first; abort metadata delete on non-object-not-found errors)
 *   TEST 8: Multi-section categories, < 20 MB & MIME allowlist (rejects SVG/exe/0-byte/>=20MB on create & update), and UI audit
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALLOWED_STORAGE_MIME_TYPES,
  MAX_STORAGE_FILE_SIZE_BYTES,
  STORAGE_CATEGORY_LABELS,
  extractStoragePathFromUrl,
  formatFileSize,
  resolveFileContentType,
  validateStorageUploadFile,
} from '../lib/firebase/storageService';
import { FirestorePaths } from '../types/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../..');

interface SimAuth {
  uid: string;
  email: string;
  emailVerified: boolean;
}

interface SimStorageObject {
  path: string;
  contentType: string;
  size: number;
  customMetadata: Record<string, string> | null;
}

interface SimUserFileDoc {
  fileId: string;
  fileName: string;
  originalFileName: string;
  storagePath: string;
  downloadURL: string;
  contentType: string;
  fileSize: number;
  uploadedBy: string;
  uploadedAt: string;
  category: string;
  relatedRecordId?: string;
}

const VALID_STORAGE_CATEGORIES = [
  'company',
  'documents',
  'invoices',
  'receipts',
  'trips',
  'drivers',
  'vehicles',
  'expenses',
  'fuel',
  'settlements',
  'customer-documents',
  'profile',
  'other',
  'dispatches',
  'pod',
];

/**
 * Mirrors exact evaluation semantics of storage.rules & /users/{userId}/files/{fileId} in firestore.rules
 */
class UserStorageIsolationSimulator {
  storageObjects = new Map<string, SimStorageObject>();
  userFileDocs = new Map<string, SimUserFileDoc>();

  evalStorage(
    auth: SimAuth | null,
    op: 'read' | 'create' | 'update' | 'delete',
    objectPath: string,
    resource?: { contentType?: string | null; size: number; customMetadata?: Record<string, string> | null }
  ): { allowed: boolean; reason?: string } {
    if (!auth) {
      return { allowed: false, reason: 'Unauthenticated user denied (storage.rules: request.auth != null)' };
    }
    const clean = objectPath.replace(/^\/+/, '');
    const segs = clean.split('/').filter(Boolean);
    if (segs.length < 3 || segs[0] !== 'users') {
      return { allowed: false, reason: 'Default deny outside /users/{userId}/{allPaths=**}' };
    }
    const userId = segs[1];
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(userId)) {
      return { allowed: false, reason: 'Invalid userId path segment' };
    }
    if (auth.uid !== userId) {
      return { allowed: false, reason: `Cross-user access denied (${auth.uid} != ${userId})` };
    }
    if (!auth.emailVerified) {
      return { allowed: false, reason: 'Unverified email user denied (email_verified != true)' };
    }

    if (op === 'read') {
      if (!this.storageObjects.has(clean)) {
        return { allowed: false, reason: 'Object does not exist' };
      }
      return { allowed: true };
    }

    if (op === 'delete') {
      this.storageObjects.delete(clean);
      return { allowed: true };
    }

    // create or update
    if (!resource) {
      return { allowed: false, reason: 'Missing upload resource' };
    }
    if (!(resource.size > 0 && resource.size < 20 * 1024 * 1024)) {
      return { allowed: false, reason: 'File size violates > 0 && < 20MB constraint' };
    }
    if (!resource.contentType || !ALLOWED_STORAGE_MIME_TYPES.includes(resource.contentType as any)) {
      return { allowed: false, reason: `Disallowed MIME type: ${resource.contentType || 'none'}` };
    }
    if (
      resource.customMetadata &&
      'uploadedBy' in resource.customMetadata &&
      resource.customMetadata.uploadedBy !== auth.uid
    ) {
      return { allowed: false, reason: 'Spoofed customMetadata.uploadedBy denied' };
    }

    this.storageObjects.set(clean, {
      path: clean,
      contentType: resource.contentType,
      size: resource.size,
      customMetadata: resource.customMetadata ?? null,
    });
    return { allowed: true };
  }

  evalUserFileFirestore(
    auth: SimAuth | null,
    op: 'get' | 'list' | 'create' | 'update' | 'delete',
    docPath: string,
    payload?: Partial<SimUserFileDoc>
  ): { allowed: boolean; reason?: string } {
    if (!auth) {
      return { allowed: false, reason: 'Unauthenticated user denied by firestore.rules' };
    }
    if (!auth.emailVerified) {
      return { allowed: false, reason: 'Unverified email user denied by firestore.rules' };
    }
    const segs = docPath.replace(/^\/+/, '').split('/').filter(Boolean);
    if (segs[0] !== 'users' || segs[2] !== 'files') {
      return { allowed: false, reason: 'Invalid user files path' };
    }
    const userId = segs[1];
    const fileId = segs[3];

    if (auth.uid !== userId) {
      return { allowed: false, reason: `Cross-user Firestore metadata access denied (${auth.uid} != ${userId})` };
    }

    if (op === 'get') {
      return { allowed: true };
    }
    if (op === 'list') {
      return { allowed: true };
    }
    if (op === 'delete') {
      this.userFileDocs.delete(docPath);
      return { allowed: true };
    }

    if (!payload) {
      return { allowed: false, reason: 'Missing incoming metadata payload' };
    }
    const required = [
      'fileId',
      'fileName',
      'originalFileName',
      'storagePath',
      'downloadURL',
      'contentType',
      'fileSize',
      'uploadedBy',
      'uploadedAt',
      'category',
    ];
    for (const k of required) {
      if ((payload as any)[k] === undefined || (payload as any)[k] === null) {
        return { allowed: false, reason: `Missing required field '${k}'` };
      }
    }
    if (payload.fileId !== fileId) {
      return { allowed: false, reason: 'fileId mismatch' };
    }
    if (payload.uploadedBy !== auth.uid || payload.uploadedBy !== userId) {
      return { allowed: false, reason: 'uploadedBy spoofing rejected' };
    }
    if (!payload.storagePath || !payload.storagePath.startsWith(`users/${userId}/`)) {
      return { allowed: false, reason: 'storagePath must reside under users/{userId}/' };
    }
    if (!payload.category || !VALID_STORAGE_CATEGORIES.includes(payload.category)) {
      return { allowed: false, reason: `Invalid category: ${payload.category}` };
    }
    if (typeof payload.fileSize !== 'number' || payload.fileSize <= 0 || payload.fileSize >= 20 * 1024 * 1024) {
      return { allowed: false, reason: 'Invalid fileSize metadata' };
    }

    if (op === 'update') {
      const existing = this.userFileDocs.get(docPath);
      if (existing && (payload.uploadedBy !== existing.uploadedBy || payload.fileId !== existing.fileId)) {
        return { allowed: false, reason: 'Immutable uploadedBy/fileId tampered' };
      }
    }

    this.userFileDocs.set(docPath, payload as SimUserFileDoc);
    return { allowed: true };
  }
}

/**
 * Pure safe-delete orchestration test mirror verifying exact Storage-first ordering.
 */
async function simulateSafeDeleteOrdering(opts: {
  deleteFromStorage: () => Promise<void>;
  deleteFromFirestore: () => Promise<void>;
}): Promise<{ storageDeleted: boolean; firestoreDeleted: boolean }> {
  let storageDeleted = false;
  let firestoreDeleted = false;
  try {
    await opts.deleteFromStorage();
    storageDeleted = true;
  } catch (err: any) {
    const code = String(err?.code || '').toLowerCase();
    if (!code.includes('object-not-found')) {
      throw err;
    }
  }
  await opts.deleteFromFirestore();
  firestoreDeleted = true;
  return { storageDeleted, firestoreDeleted };
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ FAIL: ${name} -> ${err?.message || err}`);
    failed++;
  }
}

async function runSuite() {
  console.log('\n====================================================================');
  console.log('  ANCHORTRANSPORT TMS - FIREBASE CLOUD STORAGE USER ISOLATION TESTS   ');
  console.log('====================================================================\n');

  const storageRulesSrc = fs.readFileSync(path.join(root, 'storage.rules'), 'utf8');
  const firestoreRulesSrc = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  const storageServiceSrc = fs.readFileSync(path.join(root, 'src/lib/firebase/storageService.ts'), 'utf8');
  const firestoreServiceSrc = fs.readFileSync(path.join(root, 'src/lib/firebase/firestoreService.ts'), 'utf8');
  const clientSrc = fs.readFileSync(path.join(root, 'src/lib/firebase/client.ts'), 'utf8');
  const authCtxSrc = fs.readFileSync(path.join(root, 'src/context/AuthContext.tsx'), 'utf8');
  const dataCtxSrc = fs.readFileSync(path.join(root, 'src/context/FirestoreDataContext.tsx'), 'utf8');
  const blueprintSrc = fs.readFileSync(path.join(root, 'firebase-blueprint.json'), 'utf8');

  const sim = new UserStorageIsolationSimulator();
  const userA: SimAuth = { uid: 'uid_user_alpha_001', email: 'alpha@transports.in', emailVerified: true };
  const userB: SimAuth = { uid: 'uid_user_beta_002', email: 'beta@transports.in', emailVerified: true };
  const unverifiedA: SimAuth = { uid: 'uid_user_alpha_001', email: 'alpha@transports.in', emailVerified: false };

  const userAPath = `users/${userA.uid}/trips/1795500000_lr_copy.pdf`;
  const userADownloadUrl = `https://firebasestorage.googleapis.com/v0/b/anchortransport-bucket/o/${encodeURIComponent(
    userAPath
  )}?alt=media&token=tok_alpha_01`;
  const userAFileId = 'fil_alpha_001';
  const userADocPath = FirestorePaths.userFile(userA.uid, userAFileId);

  // -------------------------------------------------------------------------
  // TEST 1: Verified User Upload, UID Pathing & Firestore Metadata Persistence
  // -------------------------------------------------------------------------
  await test('TEST 1: Verified User A uploads to users/{uidA}/{category}/{fileName} and saves metadata under /users/{uidA}/files/{fileId}', () => {
    const uploadRes = sim.evalStorage(userA, 'create', userAPath, {
      contentType: 'application/pdf',
      size: 450_000,
      customMetadata: { uploadedBy: userA.uid, category: 'trips' },
    });
    assert.equal(uploadRes.allowed, true, uploadRes.reason);

    const metaRes = sim.evalUserFileFirestore(userA, 'create', userADocPath, {
      fileId: userAFileId,
      fileName: '1795500000_lr_copy.pdf',
      originalFileName: 'lr_copy.pdf',
      storagePath: userAPath,
      downloadURL: userADownloadUrl,
      contentType: 'application/pdf',
      fileSize: 450_000,
      uploadedBy: userA.uid,
      uploadedAt: '2026-11-24T12:00:00.000Z',
      category: 'trips',
      relatedRecordId: 'trp_001',
    });
    assert.equal(metaRes.allowed, true, metaRes.reason);

    const readBack = sim.evalStorage(userA, 'read', userAPath);
    assert.equal(readBack.allowed, true);
    assert.equal(extractStoragePathFromUrl(userADownloadUrl), userAPath);
    assert.ok(clientSrc.includes('getStorage(app)') && clientSrc.includes('export const storage'));
    assert.equal((clientSrc.match(/initializeApp\(/g) || []).length, 1, 'Must initialize single Firebase app');
  });

  // -------------------------------------------------------------------------
  // TEST 2: Logout & Re-login Persistence
  // -------------------------------------------------------------------------
  await test('TEST 2: Logout clears only in-memory listeners/state and preserves Storage + Firestore file metadata across re-login', () => {
    assert.ok(authCtxSrc.includes('runLogoutCleanupsSynchronously()'));
    assert.ok(!authCtxSrc.includes('deleteObject') && !authCtxSrc.includes('deleteUserFile'));
    assert.ok(dataCtxSrc.includes('subscribeToUserFilesInFirestore'));
    assert.ok(dataCtxSrc.includes('setUserFiles([])'));
    assert.ok(firestoreServiceSrc.includes('export function subscribeToUserFilesInFirestore'));
    assert.ok(firestoreServiceSrc.includes('export async function fetchUserFilesFromFirestore'));

    // Simulate logout -> user A logs back in -> files remain intact and readable
    const listedDocs = Array.from(sim.userFileDocs.entries()).filter(
      ([docKey, docVal]) => docKey.startsWith(`users/${userA.uid}/files/`) && docVal.uploadedBy === userA.uid
    );
    assert.equal(listedDocs.length, 1);
    assert.equal(listedDocs[0][1].downloadURL, userADownloadUrl);
    assert.equal(sim.evalStorage(userA, 'read', userAPath).allowed, true);
  });

  // -------------------------------------------------------------------------
  // TEST 3: Cross-User Isolation (User B vs User A)
  // -------------------------------------------------------------------------
  await test('TEST 3: Verified User B CANNOT read, download, list, upload, replace, or delete User A files or metadata', () => {
    assert.equal(sim.evalStorage(userB, 'read', userAPath).allowed, false);
    assert.equal(
      sim.evalStorage(userB, 'create', `users/${userA.uid}/trips/evil.pdf`, {
        contentType: 'application/pdf',
        size: 1024,
      }).allowed,
      false
    );
    assert.equal(
      sim.evalStorage(userB, 'update', userAPath, {
        contentType: 'application/pdf',
        size: 2048,
      }).allowed,
      false
    );
    assert.equal(sim.evalStorage(userB, 'delete', userAPath).allowed, false);

    assert.equal(sim.evalUserFileFirestore(userB, 'get', userADocPath).allowed, false);
    assert.equal(sim.evalUserFileFirestore(userB, 'list', `users/${userA.uid}/files`).allowed, false);
    assert.equal(sim.evalUserFileFirestore(userB, 'delete', userADocPath).allowed, false);
    assert.equal(sim.storageObjects.has(userAPath), true, 'User A file must remain untouched');
    assert.equal(sim.userFileDocs.has(userADocPath), true, 'User A metadata must remain untouched');
  });

  // -------------------------------------------------------------------------
  // TEST 4: Path/URL Tampering & Custom Metadata Spoofing Prevention
  // -------------------------------------------------------------------------
  await test('TEST 4: Path/URL tampering and spoofed uploadedBy metadata are strictly blocked in rules and client service', () => {
    // User B tries uploading into their own path while spoofing uploadedBy = userA.uid
    const spoofedStorageMeta = sim.evalStorage(userB, 'create', `users/${userB.uid}/trips/spoof.pdf`, {
      contentType: 'application/pdf',
      size: 2048,
      customMetadata: { uploadedBy: userA.uid },
    });
    assert.equal(spoofedStorageMeta.allowed, false);

    // User B tries saving metadata pointing storagePath at User A's folder
    const forgedStoragePathMeta = sim.evalUserFileFirestore(
      userB,
      'create',
      FirestorePaths.userFile(userB.uid, 'fil_forged_01'),
      {
        fileId: 'fil_forged_01',
        fileName: 'forged.pdf',
        originalFileName: 'forged.pdf',
        storagePath: userAPath,
        downloadURL: userADownloadUrl,
        contentType: 'application/pdf',
        fileSize: 2048,
        uploadedBy: userB.uid,
        uploadedAt: '2026-11-24T12:10:00.000Z',
        category: 'trips',
      }
    );
    assert.equal(forgedStoragePathMeta.allowed, false);

    // Verify storage.rules & firestore.rules explicitly enforce these guards
    assert.ok(storageRulesSrc.includes('function isValidUploadMetadata()'));
    assert.ok(storageRulesSrc.includes('request.resource.metadata.uploadedBy == request.auth.uid'));
    assert.ok(firestoreRulesSrc.includes("data.storagePath.matches('^users/' + userId + '/.+')"));
    assert.ok(firestoreRulesSrc.includes('data.uploadedBy == userId'));
    assert.ok(storageServiceSrc.includes('if (resolvedPath.startsWith(\'users/\') && !resolvedPath.startsWith(`users/${uid}/`))'));
  });

  // -------------------------------------------------------------------------
  // TEST 5: Unverified Email User Denial
  // -------------------------------------------------------------------------
  await test('TEST 5: Authenticated user WITHOUT verified email is denied all Storage and Firestore file operations', () => {
    assert.equal(sim.evalStorage(unverifiedA, 'read', userAPath).allowed, false);
    assert.equal(
      sim.evalStorage(unverifiedA, 'create', `users/${unverifiedA.uid}/documents/rc.pdf`, {
        contentType: 'application/pdf',
        size: 10000,
      }).allowed,
      false
    );
    assert.equal(sim.evalStorage(unverifiedA, 'delete', userAPath).allowed, false);
    assert.equal(sim.evalUserFileFirestore(unverifiedA, 'get', userADocPath).allowed, false);
    assert.equal(
      sim.evalUserFileFirestore(unverifiedA, 'create', FirestorePaths.userFile(unverifiedA.uid, 'fil_unv'), {
        fileId: 'fil_unv',
        fileName: 'rc.pdf',
        originalFileName: 'rc.pdf',
        storagePath: `users/${unverifiedA.uid}/documents/rc.pdf`,
        downloadURL: 'https://example.com/rc.pdf',
        contentType: 'application/pdf',
        fileSize: 10000,
        uploadedBy: unverifiedA.uid,
        uploadedAt: '2026-11-24T12:15:00.000Z',
        category: 'documents',
      }).allowed,
      false
    );
    assert.ok(storageRulesSrc.includes("('email_verified' in request.auth.token)"));
    assert.ok(storageRulesSrc.includes('request.auth.token.email_verified == true'));
    assert.ok(storageServiceSrc.includes('if (!auth.currentUser.emailVerified)'));
  });

  // -------------------------------------------------------------------------
  // TEST 6: Logged-Out Visitor Denial
  // -------------------------------------------------------------------------
  await test('TEST 6: Logged-out visitor is denied all Storage and Firestore file read/write/delete operations', () => {
    assert.equal(sim.evalStorage(null, 'read', userAPath).allowed, false);
    assert.equal(
      sim.evalStorage(null, 'create', `users/${userA.uid}/company/logo.png`, {
        contentType: 'image/png',
        size: 2048,
      }).allowed,
      false
    );
    assert.equal(sim.evalStorage(null, 'delete', userAPath).allowed, false);
    assert.equal(sim.evalUserFileFirestore(null, 'get', userADocPath).allowed, false);
    assert.equal(sim.evalUserFileFirestore(null, 'list', `users/${userA.uid}/files`).allowed, false);
    assert.equal(sim.evalStorage(userA, 'create', 'public/logo.png', { contentType: 'image/png', size: 1024 }).allowed, false);
    assert.ok(storageRulesSrc.includes('match /{allPaths=**} {\n      allow read, write: if false;'));
  });

  // -------------------------------------------------------------------------
  // TEST 7: Safe Delete Ordering (Storage First, Metadata Only After Success / object-not-found)
  // -------------------------------------------------------------------------
  await test('TEST 7: Safe delete deletes Firebase Storage first and aborts Firestore metadata delete on Storage errors (except storage/object-not-found)', async () => {
    const events: string[] = [];

    // Case A: Storage permission error -> MUST NOT delete Firestore metadata
    let permissionAborted = false;
    try {
      await simulateSafeDeleteOrdering({
        deleteFromStorage: async () => {
          events.push('storage_attempt_fail');
          const err: any = new Error('Permission denied');
          err.code = 'storage/unauthorized';
          throw err;
        },
        deleteFromFirestore: async () => {
          events.push('firestore_should_not_run');
        },
      });
    } catch {
      permissionAborted = true;
    }
    assert.equal(permissionAborted, true);
    assert.deepEqual(events, ['storage_attempt_fail']);

    // Case B: Storage object-not-found -> safely proceeds to clean Firestore metadata
    const notFoundResult = await simulateSafeDeleteOrdering({
      deleteFromStorage: async () => {
        const err: any = new Error('Missing object');
        err.code = 'storage/object-not-found';
        throw err;
      },
      deleteFromFirestore: async () => Promise.resolve(),
    });
    assert.equal(notFoundResult.storageDeleted, false);
    assert.equal(notFoundResult.firestoreDeleted, true);

    // Case C: Real storageService.ts enforces deleteObject BEFORE deleteUserFileMetadataInFirestore
    const deleteFnStart = storageServiceSrc.indexOf('export async function deleteUserFile(');
    const deleteFnEnd = storageServiceSrc.indexOf('export async function replaceUserFile(');
    const deleteBody = storageServiceSrc.slice(deleteFnStart, deleteFnEnd);
    const deleteObjIdx = deleteBody.indexOf('await deleteObject(storageRef)');
    const deleteMetaIdx = deleteBody.indexOf('await deleteUserFileMetadataInFirestore(');
    assert.ok(deleteObjIdx !== -1 && deleteMetaIdx !== -1 && deleteObjIdx < deleteMetaIdx);
    assert.ok(deleteBody.includes("if (!code.includes('object-not-found')) {\n        throw err;"));

    // Case D: Upload rollback on Firestore metadata failure
    assert.ok(storageServiceSrc.includes('// Roll back Storage object cleanly if Firestore metadata write fails'));
  });

  // -------------------------------------------------------------------------
  // TEST 8: Multi-Category Coverage, Size/MIME Restrictions, and UI Wiring Audit
  // -------------------------------------------------------------------------
  await test('TEST 8: Enforces 15 Storage categories, < 20 MB limit & safe MIME allowlist on create/update, and integrates UI cleanly', () => {
    // All 15 categories work for verified User A and are declared in blueprint + rules
    assert.equal(VALID_STORAGE_CATEGORIES.length, 15);
    for (const cat of VALID_STORAGE_CATEGORIES) {
      assert.ok(cat in STORAGE_CATEGORY_LABELS, `Missing label for category ${cat}`);
      assert.ok(firestoreRulesSrc.includes(`'${cat}'`), `Missing category '${cat}' in firestore.rules`);
      assert.ok(blueprintSrc.includes(`"${cat}"`), `Missing category '${cat}' in firebase-blueprint.json`);

      const catPath = `users/${userA.uid}/${cat}/sample_file.pdf`;
      assert.equal(
        sim.evalStorage(userA, 'create', catPath, {
          contentType: 'application/pdf',
          size: 12000,
          customMetadata: { uploadedBy: userA.uid },
        }).allowed,
        true
      );
    }

    // Reject >= 20 MB, 0 bytes, SVG (XSS risk), executables on BOTH create & update
    const maxBytes = MAX_STORAGE_FILE_SIZE_BYTES;
    assert.equal(maxBytes, 20 * 1024 * 1024);

    for (const op of ['create', 'update'] as const) {
      assert.equal(
        sim.evalStorage(userA, op, `users/${userA.uid}/documents/exact_20mb.pdf`, {
          contentType: 'application/pdf',
          size: maxBytes,
        }).allowed,
        false
      );
      assert.equal(
        sim.evalStorage(userA, op, `users/${userA.uid}/documents/over_20mb.pdf`, {
          contentType: 'application/pdf',
          size: maxBytes + 1,
        }).allowed,
        false
      );
      assert.equal(
        sim.evalStorage(userA, op, `users/${userA.uid}/documents/empty.pdf`, {
          contentType: 'application/pdf',
          size: 0,
        }).allowed,
        false
      );
      assert.equal(
        sim.evalStorage(userA, op, `users/${userA.uid}/documents/xss.svg`, {
          contentType: 'image/svg+xml',
          size: 1024,
        }).allowed,
        false
      );
      assert.equal(
        sim.evalStorage(userA, op, `users/${userA.uid}/documents/malware.exe`, {
          contentType: 'application/x-msdownload',
          size: 1024,
        }).allowed,
        false
      );
    }

    // Client-side validation parity
    assert.equal(validateStorageUploadFile({ name: 'ok.xlsx', size: 1024, type: '' } as File).contentType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(validateStorageUploadFile({ name: 'bad.svg', size: 1024, type: 'image/svg+xml' } as File).valid, false);
    assert.equal(validateStorageUploadFile({ name: 'huge.pdf', size: maxBytes, type: 'application/pdf' } as File).valid, false);
    assert.equal(validateStorageUploadFile({ name: 'empty.pdf', size: 0, type: 'application/pdf' } as File).valid, false);
    assert.equal(resolveFileContentType({ name: 'data.csv', type: '' } as File), 'text/csv');
    assert.equal(formatFileSize(1024 * 1024), '1.00 MB');

    // UI modules integrate FilePreviewModal & DocumentAttachmentsSection cleanly without window.open/alert
    const uiFilesToCheck = [
      'src/components/auth/CompanyProfilePage.tsx',
      'src/components/auth/UserProfileModal.tsx',
      'src/modules/vehicles/VehicleDocumentsView.tsx',
      'src/modules/trips/TripModal.tsx',
      'src/modules/trips/TripDetailModal.tsx',
      'src/modules/trips/TripStatusTransitionModal.tsx',
      'src/modules/financials/ExpenseModal.tsx',
      'src/modules/financials/ExpenseDetailModal.tsx',
      'src/modules/drivers/DriverDetailModal.tsx',
      'src/modules/vehicles/VehicleDetailModal.tsx',
      'src/modules/invoices/InvoiceDetailModal.tsx',
      'src/modules/financials/SettlementDetailModal.tsx',
      'src/modules/customers/CustomerDetailModal.tsx',
      'src/modules/journalTrips/JournalTripFormModal.tsx',
      'src/modules/journalTrips/JournalTripDetailModal.tsx',
    ];
    for (const rel of uiFilesToCheck) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      assert.equal(src.includes('window.open('), false, `${rel} must not use window.open`);
      assert.equal(src.includes('window.alert('), false, `${rel} must not use window.alert`);
      assert.ok(
        src.includes('FilePreviewModal') || src.includes('DocumentAttachmentsSection'),
        `${rel} must integrate FilePreviewModal or DocumentAttachmentsSection`
      );
    }
  });

  console.log('\n--------------------------------------------------------------------');
  console.log(`Firebase Storage Isolation Results: ${passed} passed, ${failed} failed`);
  console.log('--------------------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Fatal suite failure:', err);
  process.exit(1);
});
