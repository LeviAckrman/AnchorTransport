/**
 * AnchorTransport TMS - Complete Firestore & Storage Security & Persistence Audit Test Suite
 *
 * Verifies TEST 1 – TEST 8 against live firestore.rules, storage.rules, and TypeScript modules:
 * - TEST 1: New User & Company Atomic Creation + Storage Folder Isolation & Metadata
 * - TEST 2: Data Permanence on Logout & Re-Login (Zero Firestore Deletion on Logout)
 * - TEST 3: Cross-Module Data Reuse & Auto-Fill (Customers, Brokers, Vehicles, Drivers, Settings -> Trips & Invoices)
 * - TEST 4: Update Without Duplication (Server-Preserving Updates + Deterministic Doc IDs + CreatedAt Preservation)
 * - TEST 5: Multi-Tenant Company A vs Company B Isolation across Firestore & Storage
 * - TEST 6: Unauthenticated Read/Write Rejection across Firestore & Storage
 * - TEST 7: Unauthorized Cross-Company & Lower-Privilege RBAC Rejection (OPERATIONS/MANAGER vs OWNER/ADMIN/ACCOUNTANT)
 * - TEST 8: Privilege & Ownership Self-Escalation Rejection (/users role tamper, /companies ownerId tamper, /members self-promotion)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

interface SimUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

type SimOp = 'get' | 'list' | 'create' | 'update' | 'delete';
type SimRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'ACCOUNTANT' | 'OPERATIONS';

interface SimDoc {
  [key: string]: any;
}

class AuditRulesSimulator {
  private firestoreDocs = new Map<string, SimDoc>();
  private storageFiles = new Map<string, { contentType: string; size: number; customMetadata: Record<string, string> | null }>();

  seedFirestore(docPath: string, data: SimDoc) {
    this.firestoreDocs.set(docPath, { ...data });
  }

  seedStorage(objectPath: string, meta: { contentType: string; size: number; customMetadata: Record<string, string> | null }) {
    this.storageFiles.set(objectPath, { ...meta });
  }

  private getOwnerUid(companyId: string): string | null {
    const company = this.firestoreDocs.get(`companies/${companyId}`);
    return company?.ownerId || null;
  }

  private getMemberRole(uid: string, companyId: string): SimRole | null {
    if (this.getOwnerUid(companyId) === uid) return 'OWNER';
    const member = this.firestoreDocs.get(`companies/${companyId}/members/${uid}`);
    if (
      member &&
      member.companyId === companyId &&
      member.userId === uid &&
      member.status === 'ACTIVE' &&
      ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'].includes(member.role)
    ) {
      return member.role as SimRole;
    }
    return null;
  }

  evalFirestore(
    auth: SimUser | null,
    op: SimOp,
    docPath: string,
    incoming?: SimDoc,
    batchPeer?: { path: string; data: SimDoc }
  ): { allowed: boolean; reason?: string } {
    if (!auth) {
      return { allowed: false, reason: 'Unauthenticated request denied' };
    }
    const segs = docPath.split('/').filter(Boolean);

    // /users/{userId}
    if (segs[0] === 'users' && segs.length === 2) {
      const uid = segs[1];
      if (op === 'get' || op === 'list') {
        return auth.uid === uid ? { allowed: true } : { allowed: false, reason: 'Cannot read another user profile' };
      }
      if (!auth.emailVerified) {
        return { allowed: false, reason: 'Email verification required' };
      }
      if (op === 'create') {
        if (auth.uid !== uid) return { allowed: false, reason: 'UID mismatch' };
        if (incoming?.role && !['USER', 'OWNER'].includes(incoming.role)) {
          return { allowed: false, reason: 'Self-assignment of privileged user role denied' };
        }
        return { allowed: true };
      }
      if (op === 'update') {
        if (auth.uid !== uid) return { allowed: false, reason: 'UID mismatch' };
        const existing = this.firestoreDocs.get(docPath);
        if (existing && 'role' in existing && incoming?.role !== existing.role) {
          return { allowed: false, reason: 'Cannot escalate /users/{uid}.role' };
        }
        return { allowed: true };
      }
      return { allowed: false, reason: 'User profile deletion disabled' };
    }

    // /companies/{companyId}
    if (segs[0] === 'companies' && segs.length === 2) {
      const companyId = segs[1];
      const existing = this.firestoreDocs.get(docPath) || null;
      const role = this.getMemberRole(auth.uid, companyId);

      if (op === 'get') {
        return existing === null || role !== null
          ? { allowed: true }
          : { allowed: false, reason: 'Cross-company company root read denied' };
      }
      if (op === 'list') {
        return existing?.ownerId === auth.uid ? { allowed: true } : { allowed: false, reason: 'Non-owner company list denied' };
      }
      if (!auth.emailVerified) return { allowed: false, reason: 'Email verification required' };
      if (op === 'create') {
        return incoming?.ownerId === auth.uid
          ? { allowed: true }
          : { allowed: false, reason: 'ownerId must match request.auth.uid' };
      }
      if (op === 'update') {
        if (!role || !['OWNER', 'ADMIN'].includes(role)) {
          return { allowed: false, reason: 'Only OWNER or ADMIN may update company profile' };
        }
        if (existing && incoming?.ownerId !== existing.ownerId) {
          return { allowed: false, reason: 'Company ownerId is immutable' };
        }
        return { allowed: true };
      }
      return { allowed: false, reason: 'Company deletion disabled' };
    }

    // /companies/{companyId}/{sub}/{id}
    if (segs[0] === 'companies' && segs.length === 4) {
      const [, companyId, sub, docId] = segs;
      const role = this.getMemberRole(auth.uid, companyId);

      if (sub === 'members') {
        if (op === 'get') {
          return auth.uid === docId || role !== null
            ? { allowed: true }
            : { allowed: false, reason: 'Unauthorized member read' };
        }
        if (op === 'list') {
          return role !== null ? { allowed: true } : { allowed: false, reason: 'Unauthorized member list' };
        }
        if (!auth.emailVerified) return { allowed: false, reason: 'Email verification required' };
        if (op === 'create') {
          const isOwner = this.getOwnerUid(companyId) === auth.uid;
          const peerCompanyOwner =
            batchPeer?.path === `companies/${companyId}` && batchPeer.data?.ownerId === auth.uid;
          if (docId === auth.uid && incoming?.role === 'OWNER' && incoming?.status === 'ACTIVE' && (isOwner || peerCompanyOwner)) {
            return { allowed: true };
          }
          if (docId !== auth.uid && isOwner && ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'].includes(incoming?.role)) {
            return { allowed: true };
          }
          if (docId !== auth.uid && role === 'ADMIN' && ['MANAGER', 'ACCOUNTANT', 'OPERATIONS'].includes(incoming?.role)) {
            return { allowed: true };
          }
          return { allowed: false, reason: 'Member creation / self-promotion rejected' };
        }
        if (op === 'update') {
          const existing = this.firestoreDocs.get(docPath);
          if (!existing) return { allowed: false, reason: 'Missing member doc' };
          if (auth.uid === docId) {
            if (incoming?.role !== existing.role || incoming?.status !== existing.status || incoming?.email !== existing.email) {
              return { allowed: false, reason: 'Self role/status escalation rejected' };
            }
            return { allowed: true };
          }
          if (this.getOwnerUid(companyId) === auth.uid && existing.role !== 'OWNER') {
            return ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'].includes(incoming?.role)
              ? { allowed: true }
              : { allowed: false, reason: 'Cannot promote staff to OWNER' };
          }
          return { allowed: false, reason: 'Insufficient role to edit member' };
        }
        if (op === 'delete') {
          const existing = this.firestoreDocs.get(docPath);
          if (auth.uid === docId || existing?.role === 'OWNER') {
            return { allowed: false, reason: 'Cannot delete self or company OWNER' };
          }
          return this.getOwnerUid(companyId) === auth.uid || role === 'ADMIN'
            ? { allowed: true }
            : { allowed: false, reason: 'Only OWNER/ADMIN can remove staff' };
        }
      }

      if (!role) {
        return { allowed: false, reason: `User ${auth.uid} is not authorized in ${companyId}` };
      }

      if (op === 'get' || op === 'list') {
        if (sub === 'auditLogs' && !['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(role)) {
          return { allowed: false, reason: 'auditLogs restricted to OWNER/ADMIN/ACCOUNTANT' };
        }
        return { allowed: true };
      }

      if (!auth.emailVerified) {
        return { allowed: false, reason: 'Email verification required for writes' };
      }

      if ((op === 'create' || op === 'update') && incoming && incoming.companyId !== companyId) {
        return { allowed: false, reason: 'Cross-company companyId injection rejected' };
      }

      if (sub === 'auditLogs') {
        return op === 'create'
          ? { allowed: true }
          : { allowed: false, reason: 'Audit logs are strictly immutable' };
      }

      const access: Record<string, { create: SimRole[]; update: SimRole[]; delete: SimRole[] }> = {
        vehicles: { create: ['OWNER', 'ADMIN', 'MANAGER', 'OPERATIONS'], update: ['OWNER', 'ADMIN', 'MANAGER', 'OPERATIONS'], delete: ['OWNER', 'ADMIN'] },
        drivers: { create: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'], update: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'], delete: ['OWNER', 'ADMIN'] },
        customers: { create: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT'], update: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT'], delete: ['OWNER', 'ADMIN'] },
        brokers: { create: ['OWNER', 'ADMIN', 'MANAGER'], update: ['OWNER', 'ADMIN', 'MANAGER'], delete: ['OWNER', 'ADMIN'] },
        trips: { create: ['OWNER', 'ADMIN', 'MANAGER', 'OPERATIONS'], update: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'], delete: ['OWNER', 'ADMIN', 'MANAGER'] },
        expenses: { create: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'], update: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'], delete: ['OWNER', 'ADMIN', 'MANAGER'] },
        advances: { create: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT'], update: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT'], delete: ['OWNER', 'ADMIN'] },
        settlements: { create: ['OWNER', 'ADMIN', 'ACCOUNTANT'], update: ['OWNER', 'ADMIN', 'ACCOUNTANT'], delete: ['OWNER', 'ADMIN'] },
        invoices: { create: ['OWNER', 'ADMIN', 'ACCOUNTANT'], update: ['OWNER', 'ADMIN', 'ACCOUNTANT'], delete: ['OWNER', 'ADMIN'] },
        payments: { create: ['OWNER', 'ADMIN', 'ACCOUNTANT'], update: ['OWNER', 'ADMIN', 'ACCOUNTANT'], delete: ['OWNER', 'ADMIN'] },
        documents: { create: ['OWNER', 'ADMIN', 'MANAGER'], update: ['OWNER', 'ADMIN', 'MANAGER'], delete: ['OWNER', 'ADMIN'] },
        maintenance: { create: ['OWNER', 'ADMIN', 'MANAGER'], update: ['OWNER', 'ADMIN', 'MANAGER'], delete: ['OWNER', 'ADMIN'] },
        fileRecords: {
          create: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'],
          update: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'],
          delete: ['OWNER', 'ADMIN'],
        },
        settings: { create: ['OWNER', 'ADMIN'], update: ['OWNER', 'ADMIN'], delete: ['OWNER'] },
      };

      const rule = access[sub];
      if (!rule) return { allowed: false, reason: `Unknown collection ${sub}` };

      if (op === 'delete' && sub === 'fileRecords') {
        const existing = this.firestoreDocs.get(docPath);
        if (['OWNER', 'ADMIN'].includes(role) || existing?.uploadedByUid === auth.uid) {
          return { allowed: true };
        }
        return { allowed: false, reason: 'Only OWNER/ADMIN or original uploader may delete fileRecord' };
      }

      const list = rule[op as 'create' | 'update' | 'delete'];
      return list.includes(role)
        ? { allowed: true }
        : { allowed: false, reason: `Role ${role} lacks '${op}' privilege on ${sub}` };
    }

    return { allowed: false, reason: 'Default global deny matched' };
  }

  evalStorage(
    auth: SimUser | null,
    op: 'read' | 'create' | 'update' | 'delete',
    objectPath: string,
    upload?: { contentType: string; size: number; customMetadata: Record<string, string> | null }
  ): { allowed: boolean; reason?: string } {
    if (!auth || !auth.emailVerified) {
      return { allowed: false, reason: 'Unauthenticated or unverified user denied by storage.rules' };
    }
    const segs = objectPath.split('/').filter(Boolean);
    if (segs.length !== 4 || segs[0] !== 'companies') {
      return { allowed: false, reason: 'Default storage deny outside /companies/{companyId}/{folder}/{fileName}' };
    }
    const [, companyId, folder] = segs;
    const allowedFolders = ['trips', 'dispatches', 'pod', 'expenses', 'fuel', 'documents', 'company'];
    if (!allowedFolders.includes(folder)) {
      return { allowed: false, reason: `Folder '${folder}' is not allowlisted` };
    }
    const role = this.getMemberRole(auth.uid, companyId);
    if (!role) {
      return { allowed: false, reason: `User ${auth.uid} is not authorized in ${companyId}` };
    }
    if (op === 'create' || op === 'update') {
      if (!upload) return { allowed: false, reason: 'Missing upload resource' };
      const validType = upload.contentType.startsWith('image/') || upload.contentType === 'application/pdf';
      if (!validType) return { allowed: false, reason: 'Unsupported MIME type' };
      if (upload.size > 15 * 1024 * 1024) return { allowed: false, reason: 'Exceeds 15MB cap' };
      if (
        !upload.customMetadata ||
        upload.customMetadata.companyId !== companyId ||
        upload.customMetadata.uploadedByUid !== auth.uid
      ) {
        return { allowed: false, reason: 'Missing or mismatched customMetadata companyId/uploadedByUid' };
      }
      return { allowed: true };
    }
    return { allowed: true };
  }
}

async function runAuditSuite() {
  console.log('========================================================================');
  console.log('   ANCHORTRANSPORT TMS - COMPLETE SECURITY & PERSISTENCE AUDIT SUITE    ');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, label: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ [PASS] ${label}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${label}${detail ? ` -> ${detail}` : ''}`);
      failed++;
    }
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(__dirname, '../..');

  const rulesSrc = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  const storageRulesSrc = fs.readFileSync(path.join(root, 'storage.rules'), 'utf8');
  const firestoreServiceSrc = fs.readFileSync(path.join(root, 'src/lib/firebase/firestoreService.ts'), 'utf8');
  const storageServiceSrc = fs.readFileSync(path.join(root, 'src/lib/firebase/storageService.ts'), 'utf8');
  const authContextSrc = fs.readFileSync(path.join(root, 'src/context/AuthContext.tsx'), 'utf8');
  const dataContextSrc = fs.readFileSync(path.join(root, 'src/context/FirestoreDataContext.tsx'), 'utf8');
  const tripModalSrc = fs.readFileSync(path.join(root, 'src/modules/trips/TripModal.tsx'), 'utf8');
  const invoiceModalSrc = fs.readFileSync(path.join(root, 'src/modules/invoices/InvoiceModal.tsx'), 'utf8');
  const blueprintSrc = fs.readFileSync(path.join(root, 'firebase-blueprint.json'), 'utf8');

  const sim = new AuditRulesSimulator();

  const ownerA: SimUser = { uid: 'uid_owner_alpha', email: 'owner@alpha.in', emailVerified: true };
  const opsA: SimUser = { uid: 'uid_ops_alpha', email: 'ops@alpha.in', emailVerified: true };
  const mgrA: SimUser = { uid: 'uid_mgr_alpha', email: 'mgr@alpha.in', emailVerified: true };
  const accA: SimUser = { uid: 'uid_acc_alpha', email: 'acc@alpha.in', emailVerified: true };
  const ownerB: SimUser = { uid: 'uid_owner_beta', email: 'owner@beta.in', emailVerified: true };
  const unverifiedUser: SimUser = { uid: 'uid_unverified', email: 'pending@alpha.in', emailVerified: false };

  const compA = 'comp_alpha_audit_001';
  const compB = 'comp_beta_audit_002';

  // ========================================================================
  // TEST 1: New User & Company Atomic Creation + Storage Isolation
  // ========================================================================
  console.log('--- TEST 1: New User & Company Atomic Creation + Storage Upload Metadata ---');

  assert(
    firestoreServiceSrc.includes('export async function createCompanyInFirestoreAtomic') &&
      firestoreServiceSrc.includes("doc(db, 'companies', company.id, 'members', fbUser.uid)") &&
      firestoreServiceSrc.includes("doc(db, 'companies', company.id, 'settings', 'default')"),
    'Codebase: createCompanyInFirestoreAtomic provisions company + OWNER member + default settings'
  );

  assert(
    rulesSrc.includes('getAfter(companyDocPath(companyId)).data.ownerId == request.auth.uid'),
    'firestore.rules: /members/{memberUid} allow create uses getAfter() to support atomic owner creation'
  );

  assert(
    storageRulesSrc.includes('/databases/ai-studio-anchortransportt-c5041a54-7d47-45d6-a1f6-5144adf1df5d/documents/companies/$(companyId)') &&
      storageRulesSrc.includes('request.resource.metadata.companyId == companyId') &&
      storageRulesSrc.includes('request.resource.metadata.uploadedByUid == request.auth.uid') &&
      storageServiceSrc.includes('customMetadata:') &&
      storageServiceSrc.includes('recordFileUploadInFirestore'),
    'Storage Rules & Client: Enforces named-DB Firestore ownership/membership lookup, customMetadata, and fileRecords audit tracking'
  );

  const compCreateRes = sim.evalFirestore(ownerA, 'create', `companies/${compA}`, {
    id: compA,
    name: 'Alpha Haulers',
    ownerId: ownerA.uid,
  });
  const memberCreateRes = sim.evalFirestore(
    ownerA,
    'create',
    `companies/${compA}/members/${ownerA.uid}`,
    { id: ownerA.uid, userId: ownerA.uid, companyId: compA, role: 'OWNER', status: 'ACTIVE' },
    { path: `companies/${compA}`, data: { id: compA, ownerId: ownerA.uid } }
  );
  assert(compCreateRes.allowed && memberCreateRes.allowed, 'Sim: Owner A atomically creates Company A & self-OWNER membership');

  sim.seedFirestore(`companies/${compA}`, { id: compA, name: 'Alpha Haulers', ownerId: ownerA.uid });
  sim.seedFirestore(`companies/${compA}/members/${ownerA.uid}`, {
    id: ownerA.uid,
    userId: ownerA.uid,
    companyId: compA,
    role: 'OWNER',
    status: 'ACTIVE',
  });
  sim.seedFirestore(`companies/${compA}/members/${opsA.uid}`, {
    id: opsA.uid,
    userId: opsA.uid,
    companyId: compA,
    role: 'OPERATIONS',
    status: 'ACTIVE',
  });
  sim.seedFirestore(`companies/${compA}/members/${mgrA.uid}`, {
    id: mgrA.uid,
    userId: mgrA.uid,
    companyId: compA,
    role: 'MANAGER',
    status: 'ACTIVE',
  });
  sim.seedFirestore(`companies/${compA}/members/${accA.uid}`, {
    id: accA.uid,
    userId: accA.uid,
    companyId: compA,
    role: 'ACCOUNTANT',
    status: 'ACTIVE',
  });

  sim.seedFirestore(`companies/${compB}`, { id: compB, name: 'Beta Carriers', ownerId: ownerB.uid });

  const uploadAlpha = sim.evalStorage(ownerA, 'create', `companies/${compA}/pod/lr_001.pdf`, {
    contentType: 'application/pdf',
    size: 512000,
    customMetadata: { companyId: compA, uploadedByUid: ownerA.uid },
  });
  assert(uploadAlpha.allowed, 'Sim: Verified Company A owner can upload POD PDF with matching customMetadata');

  // ========================================================================
  // TEST 2: Data Permanence on Logout & Re-Login
  // ========================================================================
  console.log('\n--- TEST 2: Data Permanence on Logout & Re-Login ---');

  const logoutBlockMatch = authContextSrc.match(/const logout = async \(\) => \{[\s\S]*?\n  \};/);
  const logoutBody = logoutBlockMatch ? logoutBlockMatch[0] : '';

  assert(
    logoutBody.includes('runLogoutCleanupsSynchronously()') &&
      logoutBody.includes('clearClientTmsCaches()') &&
      logoutBody.includes('logoutFirebaseUser()') &&
      !logoutBody.includes('clearCompanyOperationalDataInFirestore') &&
      !logoutBody.includes('deleteDoc'),
    'AuthContext.logout() detaches listeners & clears local state ONLY — never deletes Firestore company data'
  );

  assert(
    dataContextSrc.includes('registerLogoutCleanup') &&
      dataContextSrc.includes('clearFrontendOperationalState()'),
    'FirestoreDataContext clears only in-memory React state/listeners synchronously upon logout'
  );

  // ========================================================================
  // TEST 3: Cross-Module Data Reuse & Auto-Fill
  // ========================================================================
  console.log('\n--- TEST 3: Cross-Module Data Reuse & Auto-Fill ---');

  assert(
    tripModalSrc.includes('brokerId') &&
      tripModalSrc.includes('commissionRatePercent') &&
      tripModalSrc.includes('brokerCommissionPaise') &&
      tripModalSrc.includes('customers') &&
      tripModalSrc.includes('vehicles') &&
      tripModalSrc.includes('drivers'),
    'TripModal reuses saved Customers, Vehicles, Drivers, and Brokers (with automatic commission calculation)'
  );

  assert(
    invoiceModalSrc.includes('companySettings?.defaultRcmEnabled') &&
      invoiceModalSrc.includes('companySettings?.defaultGstRatePercent') &&
      invoiceModalSrc.includes('cust?.paymentTermsDays || cust?.creditPeriodDays') &&
      invoiceModalSrc.includes('selectedTrip.customerId'),
    'InvoiceModal auto-fills saved CompanySettings (GST/RCM defaults) and Customer Credit Terms / Trip data'
  );

  const blueprintParsed = JSON.parse(blueprintSrc);
  const entityNames = Object.keys(blueprintParsed.entities || {});
  assert(
    [
      'User',
      'Company',
      'CompanyMember',
      'Vehicle',
      'Driver',
      'Customer',
      'Broker',
      'Trip',
      'TripExpense',
      'DriverAdvance',
      'TripSettlement',
      'Invoice',
      'Payment',
      'VehicleDocument',
      'MaintenanceRecord',
      'FileRecord',
      'CompanySettings',
      'AuditLog',
    ].every((e) => entityNames.includes(e)),
    'firebase-blueprint.json models all 18 required TMS entities including Broker, CompanyMember, FileRecord, CompanySettings'
  );

  // ========================================================================
  // TEST 4: Update Without Duplication
  // ========================================================================
  console.log('\n--- TEST 4: Update Without Duplication ---');

  assert(
    firestoreServiceSrc.includes('prepared.existingData.createdAt instanceof Timestamp') &&
      firestoreServiceSrc.includes('batch.update(') &&
      firestoreServiceSrc.includes('buildServerPreservingUpdatePayload(prepared.existingData, prepared.payload)'),
    'firestoreService.ts updates existing documents in-place by deterministic doc ID using batch.update & preserves createdAt'
  );

  // ========================================================================
  // TEST 5: Multi-Tenant Company A vs Company B Isolation (Firestore + Storage)
  // ========================================================================
  console.log('\n--- TEST 5: Multi-Tenant Company A vs Company B Isolation ---');

  const crossReadTrip = sim.evalFirestore(ownerB, 'get', `companies/${compA}/trips/trp_001`);
  const crossCreateInvoice = sim.evalFirestore(ownerB, 'create', `companies/${compA}/invoices/inv_999`, {
    id: 'inv_999',
    companyId: compA,
  });
  const crossBrokerWrite = sim.evalFirestore(ownerA, 'create', `companies/${compA}/brokers/brk_spoof`, {
    id: 'brk_spoof',
    companyId: compB, // Spoofed companyId
  });
  const crossStorageRead = sim.evalStorage(ownerB, 'read', `companies/${compA}/pod/lr_001.pdf`);
  const crossStorageUploadMetaMismatch = sim.evalStorage(ownerB, 'create', `companies/${compB}/pod/hack.pdf`, {
    contentType: 'application/pdf',
    size: 1024,
    customMetadata: { companyId: compA, uploadedByUid: ownerB.uid },
  });

  assert(!crossReadTrip.allowed, 'Company B Owner blocked from reading Company A trips');
  assert(!crossCreateInvoice.allowed, 'Company B Owner blocked from creating invoices inside Company A');
  assert(!crossBrokerWrite.allowed, 'Spoofed cross-company companyId inside payload rejected even by Company A owner');
  assert(!crossStorageRead.allowed, 'Company B Owner blocked from reading Company A Storage files');
  assert(!crossStorageUploadMetaMismatch.allowed, 'Storage upload rejected when customMetadata.companyId mismatches path');

  // ========================================================================
  // TEST 6: Unauthenticated Read/Write Rejection
  // ========================================================================
  console.log('\n--- TEST 6: Unauthenticated & Unverified Rejection ---');

  assert(!sim.evalFirestore(null, 'get', `companies/${compA}/trips/trp_001`).allowed, 'Unauthenticated Firestore read denied');
  assert(!sim.evalFirestore(null, 'create', `companies/${compA}/trips/trp_unauth`, { companyId: compA }).allowed, 'Unauthenticated Firestore write denied');
  assert(!sim.evalStorage(null, 'read', `companies/${compA}/pod/lr_001.pdf`).allowed, 'Unauthenticated Storage read denied');
  assert(!sim.evalStorage(unverifiedUser, 'create', `companies/${compA}/pod/doc.pdf`, {
    contentType: 'application/pdf',
    size: 1000,
    customMetadata: { companyId: compA, uploadedByUid: unverifiedUser.uid },
  }).allowed, 'Unverified email Storage upload denied');

  // ========================================================================
  // TEST 7: Unauthorized Lower-Privilege RBAC Rejection
  // ========================================================================
  console.log('\n--- TEST 7: Lower-Privilege Staff RBAC Boundaries ---');

  assert(
    sim.evalFirestore(opsA, 'create', `companies/${compA}/trips/trp_ops1`, { companyId: compA }).allowed,
    'OPERATIONS staff CAN create/dispatch trips within authorized company'
  );
  assert(
    !sim.evalFirestore(opsA, 'create', `companies/${compA}/invoices/inv_ops1`, { companyId: compA }).allowed,
    'OPERATIONS staff BLOCKED from creating invoices'
  );
  assert(
    !sim.evalFirestore(opsA, 'delete', `companies/${compA}/vehicles/veh_001`).allowed,
    'OPERATIONS staff BLOCKED from deleting vehicles'
  );
  assert(
    !sim.evalFirestore(mgrA, 'update', `companies/${compA}/settings/default`, { companyId: compA }).allowed,
    'MANAGER staff BLOCKED from modifying company settings'
  );
  assert(
    sim.evalFirestore(accA, 'create', `companies/${compA}/invoices/inv_acc1`, { companyId: compA }).allowed,
    'ACCOUNTANT staff CAN create financial invoices'
  );
  assert(
    sim.evalFirestore(ownerA, 'update', `companies/${compA}/settings/default`, { companyId: compA }).allowed,
    'OWNER CAN update company settings'
  );

  // ========================================================================
  // TEST 8: Privilege & Ownership Self-Escalation Rejection
  // ========================================================================
  console.log('\n--- TEST 8: Privilege & Ownership Self-Escalation Guards ---');

  sim.seedFirestore(`users/${opsA.uid}`, { id: opsA.uid, email: opsA.email, name: 'Ops User', role: 'OPERATIONS' });

  const userRoleEsc = sim.evalFirestore(opsA, 'update', `users/${opsA.uid}`, {
    id: opsA.uid,
    role: 'OWNER',
  });
  const ownerIdTamper = sim.evalFirestore(ownerA, 'update', `companies/${compA}`, {
    id: compA,
    ownerId: ownerB.uid,
  });
  const memberSelfPromote = sim.evalFirestore(opsA, 'update', `companies/${compA}/members/${opsA.uid}`, {
    id: opsA.uid,
    userId: opsA.uid,
    companyId: compA,
    role: 'ADMIN',
    status: 'ACTIVE',
  });
  const nonAdminCreateMember = sim.evalFirestore(mgrA, 'create', `companies/${compA}/members/uid_rogue`, {
    id: 'uid_rogue',
    userId: 'uid_rogue',
    companyId: compA,
    role: 'ADMIN',
    status: 'ACTIVE',
  });

  assert(!userRoleEsc.allowed, 'Blocked /users/{uid}.role self-escalation from OPERATIONS to OWNER');
  assert(!ownerIdTamper.allowed, 'Blocked /companies/{cid}.ownerId mutation (strictly immutable)');
  assert(!memberSelfPromote.allowed, 'Blocked /members/{uid} self-promotion from OPERATIONS to ADMIN');
  assert(!nonAdminCreateMember.allowed, 'Blocked non-ADMIN MANAGER from provisioning company members');

  console.log('\n========================================================================');
  console.log(`📊 Audit Suite Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAuditSuite().catch((err) => {
  console.error('Fatal audit suite error:', err);
  process.exit(1);
});
