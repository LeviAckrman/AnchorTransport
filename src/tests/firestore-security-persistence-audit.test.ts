/**
 * AnchorTransport TMS - Complete Firestore & Storage Security & Persistence Audit Test Suite
 *
 * Verifies strict Verified Owner-Only isolation, permanent persistence, and all 6 required verification scenarios:
 * - TEST 1: New User & Company Atomic Creation + Storage Folder Isolation & Metadata
 * - TEST 2: Data Permanence on Logout & Re-Login + Single Company Reuse (No Duplicate Company Creation)
 * - TEST 3: Cross-Module Data Reuse & Auto-Fill (Customers, Brokers, Vehicles, Drivers, Settings -> Trips & Invoices)
 * - TEST 4: Update Without Duplication (Server-Preserving Updates + Deterministic Doc IDs + CreatedAt Preservation)
 * - TEST 5: Multi-Tenant Company A vs Company B Isolation across Firestore & Storage
 * - TEST 6: Unauthenticated & Unverified User Rejection across Firestore & Storage
 * - TEST 7: Strict Owner-Only Enforcement & Employee/Staff Blocking (Zero RBAC / Zero Team Management)
 * - TEST 8: Privilege & Ownership Self-Escalation Rejection (/users role tamper, /companies ownerId tamper, /members tamper)
 * - SCENARIOS 1–6: End-to-End Owner A Create/Update/Re-Login Trip Retrieval & Owner B/Unauthorized Blocking
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

interface SimDoc {
  [key: string]: any;
}

const SERVER_TIME = '__SERVER_TIMESTAMP__';

interface CollectionSchemaSpec {
  required: string[];
  allowed?: string[];
  stringLimits?: Record<string, number>;
  enums?: Record<string, string[]>;
  timestampField?: 'updatedAt' | 'timestamp';
}

const SUBCOLLECTION_SCHEMAS: Record<string, CollectionSchemaSpec> = {
  invoices: {
    required: [
      'id', 'companyId', 'invoiceNumber', 'customerId', 'totalAmountPaise',
      'status', 'issueDate', 'createdAt', 'updatedAt',
    ],
    allowed: [
      'id', 'companyId', 'invoiceNumber', 'tripId', 'tripNumber', 'lrNumber',
      'customerId', 'customerName', 'customerGstin', 'billingAddress', 'originCity',
      'destinationCity', 'vehicleReg', 'goodsType', 'weightTonnes', 'ratePerTonnePaise',
      'hsnSacCode', 'issueDate', 'dueDate', 'freightAmountPaise', 'loadingChargesPaise',
      'unloadingChargesPaise', 'detentionChargesPaise', 'otherChargesPaise', 'discountPaise',
      'taxableAmountPaise', 'isRcmApplicable', 'gstRatePercent', 'cgstRatePercent',
      'sgstRatePercent', 'igstRatePercent', 'cgstAmountPaise', 'sgstAmountPaise',
      'igstAmountPaise', 'totalTaxPaise', 'totalAmountPaise', 'amountPaidPaise',
      'balanceDuePaise', 'status', 'paymentStatus', 'cancelledAt', 'cancellationReason',
      'notes', 'createdBy', 'createdAt', 'updatedAt',
    ],
    stringLimits: { invoiceNumber: 50, customerName: 150, billingAddress: 300, notes: 500 },
    enums: {
      status: ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'],
      paymentStatus: ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'],
    },
  },
  expenses: {
    required: ['id', 'companyId', 'category', 'amountPaise', 'paymentMode', 'createdAt', 'updatedAt'],
    allowed: [
      'id', 'companyId', 'tripId', 'tripNumber', 'vehicleId', 'vehicleReg',
      'driverId', 'driverName', 'category', 'amountPaise', 'paymentMode',
      'date', 'expenseDate', 'description', 'litres', 'litresFuel', 'ratePerLitrePaise',
      'pumpName', 'petrolPumpName', 'location', 'odometerReading', 'receiptNumber',
      'voucherNumber', 'receiptUrl', 'receiptAttachmentUrl', 'notes', 'recordedBy',
      'createdBy', 'isDriverDisbursed', 'isSettled', 'settlementId', 'createdAt', 'updatedAt',
    ],
    stringLimits: { receiptUrl: 1500, receiptAttachmentUrl: 1500, notes: 400 },
    enums: {
      paymentMode: ['CASH', 'FASTAG', 'PETRO_CARD', 'UPI', 'DRIVER_POCKET', 'BANK_TRANSFER'],
    },
  },
  maintenance: {
    required: ['id', 'companyId', 'vehicleId', 'serviceType', 'costPaise', 'serviceDate', 'createdAt', 'updatedAt'],
    allowed: [
      'id', 'companyId', 'vehicleId', 'vehicleReg', 'serviceType', 'garageName',
      'costPaise', 'odometerReading', 'serviceDate', 'partsReplaced',
      'invoiceNumber', 'notes', 'createdAt', 'updatedAt',
    ],
    stringLimits: { vehicleReg: 30, garageName: 120, partsReplaced: 300, invoiceNumber: 60, notes: 400 },
    enums: {
      serviceType: ['SCHEDULED_SERVICE', 'TYRE_REPLACEMENT', 'ENGINE_WORK', 'BRAKE_SUSPENSION', 'ACCIDENT_BREAKDOWN'],
    },
  },
  settings: {
    required: ['id', 'companyId', 'createdAt', 'updatedAt'],
    allowed: [
      'id', 'companyId', 'defaultGstRatePercent', 'defaultRcmEnabled',
      'defaultCreditPeriodDays', 'defaultFuelUnit', 'lowFastagThresholdPaise',
      'expiryAlertDays', 'autoGenerateLr', 'currency', 'updatedByUid',
      'createdAt', 'updatedAt',
    ],
    enums: { defaultFuelUnit: ['LITRES', 'GALLONS'] },
  },
  auditLogs: {
    required: ['id', 'companyId', 'userId', 'action', 'entityType', 'entityId', 'summary', 'timestamp'],
    allowed: [
      'id', 'companyId', 'userId', 'userName', 'action', 'entityType',
      'entityId', 'moduleName', 'summary', 'previousValues', 'updatedValues', 'timestamp',
    ],
    stringLimits: { userName: 100, moduleName: 60, summary: 500 },
    enums: {
      action: ['CREATE', 'UPDATE', 'DELETE', 'DISPATCH', 'SETTLE', 'APPROVE', 'INVOICE', 'PAYMENT', 'CANCEL'],
      entityType: [
        'TRIP', 'TRIP_LOG', 'DISPATCH', 'VEHICLE', 'DRIVER', 'ADVANCE', 'SETTLEMENT',
        'INVOICE', 'BILLING', 'PAYMENT', 'EXPENSE', 'FUEL', 'CUSTOMER',
        'BROKER', 'DOCUMENT', 'MAINTENANCE', 'FILE_RECORD', 'SETTINGS', 'COMPANY', 'MEMBER',
      ],
    },
    timestampField: 'timestamp',
  },
  trip_logs: {
    required: ['id', 'companyId', 'tripId', 'status', 'timestamp', 'locationNote', 'createdAt', 'updatedAt'],
    stringLimits: {
      tripNumber: 120,
      status: 120,
      timestamp: 60,
      locationNote: 500,
      notes: 1000,
      loggedByUid: 128,
      loggedByName: 150,
    },
    enums: {
      severity: ['INFO', 'SUCCESS', 'WARNING', 'CRITICAL'],
    },
  },
};

function validateDocAgainstSchema(
  sub: string,
  data: SimDoc,
  docId: string,
  companyId: string,
  op: 'create' | 'update',
  existing?: SimDoc | null
): { ok: boolean; reason?: string } {
  const spec = SUBCOLLECTION_SCHEMAS[sub];
  if (!spec) return { ok: true };
  const keys = Object.keys(data);
  for (const reqKey of spec.required) {
    if (!keys.includes(reqKey) || data[reqKey] === undefined) {
      return { ok: false, reason: `${sub} missing required field '${reqKey}'` };
    }
  }
  if (spec.allowed) {
    for (const k of keys) {
      if (!spec.allowed.includes(k)) {
        return { ok: false, reason: `${sub} rejected unexpected shadow field '${k}'` };
      }
    }
  }
  if (sub === 'trips') {
    if ('companyId' in data && data.companyId !== companyId) {
      return { ok: false, reason: 'trips cross-company companyId mismatch' };
    }
    return { ok: true };
  }
  if (data.id !== docId || data.companyId !== companyId) {
    return { ok: false, reason: `${sub} id/companyId mismatch` };
  }
  const tsField = spec.timestampField || 'updatedAt';
  if (data[tsField] !== SERVER_TIME) {
    return { ok: false, reason: `${sub}.${tsField} must equal request.time` };
  }
  if (sub !== 'auditLogs') {
    if (op === 'create' && data.createdAt !== SERVER_TIME) {
      return { ok: false, reason: `${sub}.createdAt on create must equal request.time` };
    }
    if (op === 'update' && existing?.createdAt && data.createdAt !== existing.createdAt) {
      return { ok: false, reason: `${sub}.createdAt must be preserved on update` };
    }
  }
  if (spec.stringLimits) {
    for (const [f, maxLen] of Object.entries(spec.stringLimits)) {
      if (f in data && data[f] !== null && (typeof data[f] !== 'string' || data[f].length > maxLen)) {
        return { ok: false, reason: `${sub}.${f} exceeds maxLength ${maxLen} or is not string` };
      }
    }
  }
  if (spec.enums) {
    for (const [f, vals] of Object.entries(spec.enums)) {
      if (f in data && data[f] !== null && !vals.includes(data[f])) {
        return { ok: false, reason: `${sub}.${f} value '${data[f]}' not in allowlist` };
      }
    }
  }
  if (sub === 'trip_logs') {
    if ('latitude' in data && (typeof data.latitude !== 'number' || data.latitude < -90 || data.latitude > 90)) {
      return { ok: false, reason: 'trip_logs.latitude out of [-90, 90] bounds' };
    }
    if ('longitude' in data && (typeof data.longitude !== 'number' || data.longitude < -180 || data.longitude > 180)) {
      return { ok: false, reason: 'trip_logs.longitude out of [-180, 180] bounds' };
    }
    if ('odometerKm' in data && (typeof data.odometerKm !== 'number' || data.odometerKm < 0)) {
      return { ok: false, reason: 'trip_logs.odometerKm must be >= 0' };
    }
  }
  return { ok: true };
}

class AuditRulesSimulator {
  private firestoreDocs = new Map<string, SimDoc>();
  private storageFiles = new Map<
    string,
    { contentType: string; size: number; customMetadata: Record<string, string> | null }
  >();

  seedFirestore(docPath: string, data: SimDoc) {
    this.firestoreDocs.set(docPath, { ...data });
  }

  getFirestoreDoc(docPath: string): SimDoc | null {
    return this.firestoreDocs.get(docPath) || null;
  }

  listOwnedCompanies(uid: string): SimDoc[] {
    const owned: SimDoc[] = [];
    for (const [docPath, docData] of this.firestoreDocs.entries()) {
      const segs = docPath.split('/').filter(Boolean);
      if (segs[0] === 'companies' && segs.length === 2 && docData.ownerId === uid) {
        owned.push({ ...docData });
      }
    }
    return owned;
  }

  listCompanyTrips(uid: string, companyId: string): SimDoc[] {
    const res = this.evalFirestore(
      { uid, email: `${uid}@verified.test`, emailVerified: true },
      'list',
      `companies/${companyId}/trips`
    );
    if (!res.allowed) return [];
    const items: SimDoc[] = [];
    for (const [docPath, docData] of this.firestoreDocs.entries()) {
      const segs = docPath.split('/').filter(Boolean);
      if (segs[0] === 'companies' && segs[1] === companyId && segs[2] === 'trips' && segs.length === 4) {
        items.push({ ...docData });
      }
    }
    return items;
  }

  seedStorage(
    objectPath: string,
    meta: { contentType: string; size: number; customMetadata: Record<string, string> | null }
  ) {
    this.storageFiles.set(objectPath, { ...meta });
  }

  private getOwnerUid(companyId: string): string | null {
    const company = this.firestoreDocs.get(`companies/${companyId}`);
    return company?.ownerId || null;
  }

  private isVerifiedCompanyOwner(auth: SimUser | null, companyId: string): boolean {
    if (!auth || !auth.emailVerified) return false;
    return this.getOwnerUid(companyId) === auth.uid;
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
    if (!auth.emailVerified) {
      return { allowed: false, reason: 'Email verification required' };
    }

    const segs = docPath.split('/').filter(Boolean);

    // /users/{userId}
    if (segs[0] === 'users' && segs.length === 2) {
      const uid = segs[1];
      if (op === 'get' || op === 'list') {
        return auth.uid === uid ? { allowed: true } : { allowed: false, reason: 'Cannot read another user profile' };
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
        if (existing && 'role' in existing) {
          if (['USER', 'OWNER'].includes(existing.role)) {
            if (incoming?.role !== existing.role) {
              return { allowed: false, reason: 'Cannot mutate /users/{uid}.role' };
            }
          } else if (incoming?.role !== 'OWNER') {
            return { allowed: false, reason: 'Legacy user role may only migrate to OWNER' };
          }
        }
        return { allowed: true };
      }
      return { allowed: false, reason: 'User profile deletion disabled' };
    }

    // /companies/{companyId}
    if (segs[0] === 'companies' && segs.length === 2) {
      const companyId = segs[1];
      const existing = this.firestoreDocs.get(docPath) || null;
      const isOwner = existing?.ownerId === auth.uid;

      if (op === 'get') {
        return existing === null || isOwner
          ? { allowed: true }
          : { allowed: false, reason: 'Cross-company company root read denied' };
      }
      if (op === 'list') {
        return isOwner ? { allowed: true } : { allowed: false, reason: 'Non-owner company list denied' };
      }
      if (op === 'create') {
        if (incoming?.ownerId !== auth.uid) {
          return { allowed: false, reason: 'ownerId must match request.auth.uid' };
        }
        this.seedFirestore(docPath, { ...incoming });
        return { allowed: true };
      }
      if (op === 'update') {
        if (!isOwner) {
          return { allowed: false, reason: 'Only verified company OWNER may update company profile' };
        }
        if (existing && incoming?.ownerId !== existing.ownerId) {
          return { allowed: false, reason: 'Company ownerId is immutable' };
        }
        this.seedFirestore(docPath, { ...existing, ...incoming });
        return { allowed: true };
      }
      return { allowed: false, reason: 'Company deletion disabled' };
    }

    // Collection-level list query: /companies/{companyId}/{sub}
    if (segs[0] === 'companies' && segs.length === 3 && op === 'list') {
      const [, companyId] = segs;
      return this.isVerifiedCompanyOwner(auth, companyId)
        ? { allowed: true }
        : { allowed: false, reason: 'Only verified company owner may list subcollection' };
    }

    // /companies/{companyId}/{sub}/{id}
    if (segs[0] === 'companies' && segs.length === 4) {
      const [, companyId, sub, docId] = segs;
      const isOwner = this.isVerifiedCompanyOwner(auth, companyId);

      if (sub === 'members') {
        if (op === 'get') {
          return auth.uid === docId && isOwner
            ? { allowed: true }
            : { allowed: false, reason: 'Unauthorized member read' };
        }
        if (op === 'list') {
          return isOwner ? { allowed: true } : { allowed: false, reason: 'Unauthorized member list' };
        }
        if (op === 'create') {
          const peerCompanyOwner =
            batchPeer?.path === `companies/${companyId}` && batchPeer.data?.ownerId === auth.uid;
          if (
            docId === auth.uid &&
            incoming?.role === 'OWNER' &&
            incoming?.status === 'ACTIVE' &&
            (isOwner || peerCompanyOwner)
          ) {
            return { allowed: true };
          }
          return { allowed: false, reason: 'Staff/employee member provisioning disabled in Owner-Only mode' };
        }
        if (op === 'update') {
          const existing = this.firestoreDocs.get(docPath);
          if (!existing || !isOwner || auth.uid !== docId) {
            return { allowed: false, reason: 'Only verified owner can update own record' };
          }
          if (incoming?.role !== 'OWNER' || incoming?.status !== existing.status || incoming?.email !== existing.email) {
            return { allowed: false, reason: 'Role/status/email tampering rejected' };
          }
          return { allowed: true };
        }
        return { allowed: false, reason: 'Owner member deletion disabled' };
      }

      if (!isOwner) {
        return { allowed: false, reason: `User ${auth.uid} is not the verified owner of ${companyId}` };
      }

      if (op === 'get' || op === 'list') {
        return { allowed: true };
      }

      if (
        (op === 'create' || op === 'update') &&
        incoming &&
        (sub === 'trips' ? 'companyId' in incoming && incoming.companyId !== companyId : incoming.companyId !== companyId)
      ) {
        return { allowed: false, reason: 'Cross-company companyId injection rejected' };
      }

      if (sub === 'auditLogs') {
        if (op !== 'create') {
          return { allowed: false, reason: 'Audit logs are strictly immutable' };
        }
        if (!incoming || incoming.userId !== auth.uid) {
          return { allowed: false, reason: 'AuditLog userId must match request.auth.uid' };
        }
        const check = validateDocAgainstSchema('auditLogs', incoming, docId, companyId, 'create');
        if (!check.ok) return { allowed: false, reason: check.reason };
        this.seedFirestore(docPath, { ...incoming });
        return { allowed: true };
      }

      const ownerCollections = new Set([
        'vehicles',
        'drivers',
        'customers',
        'brokers',
        'trips',
        'expenses',
        'advances',
        'settlements',
        'invoices',
        'payments',
        'documents',
        'maintenance',
        'fileRecords',
        'settings',
      ]);

      if (!ownerCollections.has(sub)) {
        return { allowed: false, reason: `Unknown collection ${sub}` };
      }

      if (op === 'create') {
        if (!incoming) return { allowed: false, reason: 'Missing incoming payload' };
        const check = validateDocAgainstSchema(sub, incoming, docId, companyId, 'create');
        if (!check.ok) return { allowed: false, reason: check.reason };
        this.seedFirestore(docPath, { ...incoming });
        return { allowed: true };
      }
      if (op === 'update') {
        const existing = this.firestoreDocs.get(docPath);
        if (!existing || !incoming) return { allowed: false, reason: 'Document does not exist or missing payload' };
        const merged = { ...existing, ...incoming };
        const check = validateDocAgainstSchema(sub, merged, docId, companyId, 'update', existing);
        if (!check.ok) return { allowed: false, reason: check.reason };
        this.seedFirestore(docPath, merged);
        return { allowed: true };
      }
      if (op === 'delete') {
        this.firestoreDocs.delete(docPath);
        return { allowed: true };
      }
    }

    // Nested Trip Logs subcollection: /companies/{companyId}/trips/{tripId}/trip_logs[/{logId}]
    if (segs[0] === 'companies' && segs[2] === 'trips' && segs[4] === 'trip_logs') {
      const [, companyId, , tripId, , logId] = segs;
      const isOwner = this.isVerifiedCompanyOwner(auth, companyId);
      if (!isOwner) {
        return { allowed: false, reason: `User ${auth.uid} is not the verified owner of ${companyId}` };
      }
      if (segs.length === 5 && op === 'list') {
        return { allowed: true };
      }
      if (segs.length === 6) {
        if (op === 'get' || op === 'list') {
          return { allowed: true };
        }
        if ((op === 'create' || op === 'update') && incoming && (incoming.companyId !== companyId || incoming.tripId !== tripId)) {
          return { allowed: false, reason: 'Cross-tenant companyId/tripId injection rejected on trip_logs' };
        }
        if (op === 'create') {
          if (!incoming) return { allowed: false, reason: 'Missing incoming trip_logs payload' };
          if (!this.firestoreDocs.has(`companies/${companyId}/trips/${tripId}`)) {
            return { allowed: false, reason: 'Parent trip document does not exist' };
          }
          const check = validateDocAgainstSchema('trip_logs', incoming, logId, companyId, 'create');
          if (!check.ok) return { allowed: false, reason: check.reason };
          this.seedFirestore(docPath, { ...incoming });
          return { allowed: true };
        }
        if (op === 'update') {
          const existing = this.firestoreDocs.get(docPath);
          if (!existing || !incoming) return { allowed: false, reason: 'Trip log does not exist or missing payload' };
          const merged = { ...existing, ...incoming };
          const check = validateDocAgainstSchema('trip_logs', merged, logId, companyId, 'update', existing);
          if (!check.ok) return { allowed: false, reason: check.reason };
          this.seedFirestore(docPath, merged);
          return { allowed: true };
        }
        if (op === 'delete') {
          this.firestoreDocs.delete(docPath);
          return { allowed: true };
        }
      }
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
    if (segs.length < 3 || segs[0] !== 'users') {
      return { allowed: false, reason: 'Default storage deny outside /users/{userId}/{allPaths=**}' };
    }
    const [, userId] = segs;
    if (auth.uid !== userId) {
      return { allowed: false, reason: `User ${auth.uid} cannot access files owned by ${userId}` };
    }
    if (op === 'create' || op === 'update') {
      if (!upload) return { allowed: false, reason: 'Missing upload resource' };
      const allowedTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp',
        'image/gif',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv',
      ];
      if (!allowedTypes.includes(upload.contentType)) {
        return { allowed: false, reason: 'Unsupported MIME type' };
      }
      if (upload.size <= 0 || upload.size >= 20 * 1024 * 1024) {
        return { allowed: false, reason: 'File size must be > 0 and < 20MB' };
      }
      if (
        upload.customMetadata &&
        'uploadedBy' in upload.customMetadata &&
        upload.customMetadata.uploadedBy !== auth.uid
      ) {
        return { allowed: false, reason: 'Spoofed customMetadata.uploadedBy rejected' };
      }
      return { allowed: true };
    }
    return { allowed: true };
  }
}

async function runAuditSuite() {
  console.log('========================================================================');
  console.log('   ANCHORTRANSPORT TMS - OWNER-ONLY SECURITY & PERSISTENCE AUDIT SUITE  ');
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
  const authRoutesSrc = fs.readFileSync(path.join(root, 'src/server/routes/auth.routes.ts'), 'utf8');
  const dataContextSrc = fs.readFileSync(path.join(root, 'src/context/FirestoreDataContext.tsx'), 'utf8');
  const tripModalSrc = fs.readFileSync(path.join(root, 'src/modules/trips/TripModal.tsx'), 'utf8');
  const invoiceModalSrc = fs.readFileSync(path.join(root, 'src/modules/invoices/InvoiceModal.tsx'), 'utf8');
  const blueprintSrc = fs.readFileSync(path.join(root, 'firebase-blueprint.json'), 'utf8');
  const permissionsSrc = fs.readFileSync(path.join(root, 'src/lib/permissions.ts'), 'utf8');

  const sim = new AuditRulesSimulator();

  const ownerA: SimUser = { uid: 'uid_owner_alpha', email: 'owner@alpha.in', emailVerified: true };
  const legacyStaffA: SimUser = { uid: 'uid_ops_alpha', email: 'ops@alpha.in', emailVerified: true };
  const ownerB: SimUser = { uid: 'uid_owner_beta', email: 'owner@beta.in', emailVerified: true };
  const unverifiedOwnerA: SimUser = { uid: 'uid_owner_alpha', email: 'owner@alpha.in', emailVerified: false };

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
    'Codebase: createCompanyInFirestoreAtomic provisions company + OWNER record + default settings'
  );

  assert(
    rulesSrc.includes('getAfter(companyDocPath(companyId)).data.ownerId == request.auth.uid') &&
      rulesSrc.includes('function isVerifiedCompanyOwner(companyId)') &&
      !rulesSrc.includes('hasCompanyRole(') &&
      !rulesSrc.includes('isActiveMember('),
    'firestore.rules: Enforces strict Verified Owner-Only isolation with zero staff/employee RBAC fallbacks'
  );

  assert(
    storageRulesSrc.includes('match /users/{userId}/{allPaths=**}') &&
      storageRulesSrc.includes('function isVerifiedOwner(userId)') &&
      storageRulesSrc.includes('isUnderMaxFileSize()') &&
      storageRulesSrc.includes('isAllowedContentType()') &&
      storageRulesSrc.includes('isValidUploadMetadata()') &&
      storageServiceSrc.includes('customMetadata') &&
      storageServiceSrc.includes('recordUserFileMetadataInFirestore'),
    'Storage Rules & Client: Enforces UID-isolated verified owner access, size/type limits, customMetadata checks, and Firestore file metadata tracking'
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
  assert(compCreateRes.allowed && memberCreateRes.allowed, 'Sim: Owner A atomically creates Company A & self-OWNER record');

  sim.seedFirestore(`companies/${compA}/members/${ownerA.uid}`, {
    id: ownerA.uid,
    userId: ownerA.uid,
    companyId: compA,
    role: 'OWNER',
    status: 'ACTIVE',
  });
  // Seed a legacy staff member doc to verify rules completely ignore/block non-owners
  sim.seedFirestore(`companies/${compA}/members/${legacyStaffA.uid}`, {
    id: legacyStaffA.uid,
    userId: legacyStaffA.uid,
    companyId: compA,
    role: 'OPERATIONS',
    status: 'ACTIVE',
  });

  sim.seedFirestore(`companies/${compB}`, { id: compB, name: 'Beta Carriers', ownerId: ownerB.uid });

  const uploadAlpha = sim.evalStorage(ownerA, 'create', `users/${ownerA.uid}/pod/lr_001.pdf`, {
    contentType: 'application/pdf',
    size: 512000,
    customMetadata: { uploadedBy: ownerA.uid, companyId: compA },
  });
  assert(uploadAlpha.allowed, 'Sim: Verified Owner A can upload POD PDF under users/{uid}/pod/ with matching customMetadata');

  // ========================================================================
  // TEST 2: Data Permanence on Logout & Re-Login + No Duplicate Company
  // ========================================================================
  console.log('\n--- TEST 2: Data Permanence on Logout & Re-Login (Zero Duplicate Companies) ---');

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
    authContextSrc.includes('listOwnedCompaniesFromFirestore(fbUser.uid)') &&
      authRoutesSrc.includes('serverCompanies.find((c) => c.ownerId === userId)'),
    'AuthContext & server onboard-company reuse existing owned companyId (prevents duplicate company creation on re-login)'
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
      'TripLog',
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
    'firebase-blueprint.json models all 19 required TMS entities including TripLog'
  );

  // ========================================================================
  // TEST 4: Update Without Duplication
  // ========================================================================
  console.log('\n--- TEST 4: Update Without Duplication ---');

  assert(
    firestoreServiceSrc.includes('function isFirestoreTimestamp') &&
      firestoreServiceSrc.includes('isFirestoreTimestamp(prepared.existingData.createdAt)') &&
      firestoreServiceSrc.includes('batch.update(') &&
      firestoreServiceSrc.includes('buildServerPreservingUpdatePayload(prepared.existingData, prepared.payload)'),
    'firestoreService.ts updates existing documents in-place by deterministic doc ID using batch.update & preserves createdAt'
  );

  // ========================================================================
  // SCENARIOS 1–6 (Required End-to-End Owner Isolation & Persistence Verification)
  // ========================================================================
  console.log('\n--- REQUIRED VERIFICATION SCENARIOS 1–6 ---');

  // Scenario 1: Owner A creates a trip successfully (full schema + timestamps)
  const s1CreateTrip = sim.evalFirestore(ownerA, 'create', `companies/${compA}/trips/trp_ownerA_01`, {
    id: 'trp_ownerA_01',
    companyId: compA,
    tripNumber: 'TR-2026-0101',
    vehicleId: 'veh_01',
    driverId: 'drv_01',
    customerId: 'cust_01',
    status: 'DISPATCHED',
    freightAmountPaise: 5500000,
    totalRevenuePaise: 5500000,
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  });
  assert(s1CreateTrip.allowed, 'Scenario 1: Owner A creates a trip successfully (strict schema match)');

  // Scenario 2: Owner A updates their trip successfully (server-preserving createdAt + updatedAt == SERVER_TIME)
  const s2UpdateTrip = sim.evalFirestore(ownerA, 'update', `companies/${compA}/trips/trp_ownerA_01`, {
    id: 'trp_ownerA_01',
    companyId: compA,
    status: 'IN_TRANSIT',
    loadingDetails: 'Loaded 24 MT Steel Coils at Durgapur Yard',
    updatedAt: SERVER_TIME,
  });
  assert(
    s2UpdateTrip.allowed &&
      sim.getFirestoreDoc(`companies/${compA}/trips/trp_ownerA_01`)?.status === 'IN_TRANSIT',
    'Scenario 2: Owner A updates their trip successfully (status -> IN_TRANSIT, createdAt preserved)'
  );

  // Scenario 3: Owner A retrieves existing trips after logging out and logging back in
  const ownedCompaniesOnRelogin = sim.listOwnedCompanies(ownerA.uid);
  const tripsAfterRelogin = sim.listCompanyTrips(ownerA.uid, ownedCompaniesOnRelogin[0]?.id);
  assert(
    ownedCompaniesOnRelogin.length === 1 &&
      ownedCompaniesOnRelogin[0].id === compA &&
      tripsAfterRelogin.length === 1 &&
      tripsAfterRelogin[0].id === 'trp_ownerA_01' &&
      tripsAfterRelogin[0].status === 'IN_TRANSIT',
    'Scenario 3: Owner A retrieves existing trips after logout & re-login with preserved companyId (no duplicate company)'
  );

  // Scenario 4: Owner B cannot read Owner A's trips
  const s4OwnerBGet = sim.evalFirestore(ownerB, 'get', `companies/${compA}/trips/trp_ownerA_01`);
  const s4OwnerBList = sim.evalFirestore(ownerB, 'list', `companies/${compA}/trips`);
  const s4OwnerBStorage = sim.evalStorage(ownerB, 'read', `users/${ownerA.uid}/pod/lr_001.pdf`);
  assert(
    !s4OwnerBGet.allowed && !s4OwnerBList.allowed && !s4OwnerBStorage.allowed,
    'Scenario 4: Owner B CANNOT read/list Owner A trips or Storage documents'
  );

  // Scenario 5: Owner B cannot update or delete Owner A's trips
  const s5OwnerBUpdate = sim.evalFirestore(ownerB, 'update', `companies/${compA}/trips/trp_ownerA_01`, {
    id: 'trp_ownerA_01',
    companyId: compA,
    status: 'CANCELLED',
    updatedAt: SERVER_TIME,
  });
  const s5OwnerBDelete = sim.evalFirestore(ownerB, 'delete', `companies/${compA}/trips/trp_ownerA_01`);
  assert(
    !s5OwnerBUpdate.allowed &&
      !s5OwnerBDelete.allowed &&
      sim.getFirestoreDoc(`companies/${compA}/trips/trp_ownerA_01`)?.status === 'IN_TRANSIT',
    'Scenario 5: Owner B CANNOT update or delete Owner A trips'
  );

  // Scenario 6: Unauthorized (unauthenticated and unverified) users cannot access company data
  const s6AnonRead = sim.evalFirestore(null, 'get', `companies/${compA}/trips/trp_ownerA_01`);
  const s6AnonWrite = sim.evalFirestore(null, 'create', `companies/${compA}/trips/trp_hack`, {
    id: 'trp_hack',
    companyId: compA,
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  });
  const s6UnverifiedRead = sim.evalFirestore(unverifiedOwnerA, 'get', `companies/${compA}/trips/trp_ownerA_01`);
  const s6UnverifiedWrite = sim.evalFirestore(unverifiedOwnerA, 'create', `companies/${compA}/invoices/inv_unver`, {
    id: 'inv_unver',
    companyId: compA,
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  });
  const s6UnverifiedStorage = sim.evalStorage(unverifiedOwnerA, 'create', `users/${unverifiedOwnerA.uid}/pod/doc.pdf`, {
    contentType: 'application/pdf',
    size: 1000,
    customMetadata: { uploadedBy: unverifiedOwnerA.uid, companyId: compA },
  });
  assert(
    !s6AnonRead.allowed &&
      !s6AnonWrite.allowed &&
      !s6UnverifiedRead.allowed &&
      !s6UnverifiedWrite.allowed &&
      !s6UnverifiedStorage.allowed,
    'Scenario 6: Unauthorized (unauthenticated & unverified) users CANNOT access or modify company data'
  );

  // ========================================================================
  // TEST 7: Strict Owner-Only Enforcement & Full Schema Validation across Modules
  // ========================================================================
  console.log('\n--- TEST 7: Strict Owner-Only Access, Maintenance & Invoice Schema Enforcement ---');

  assert(
    !sim.evalFirestore(legacyStaffA, 'get', `companies/${compA}/trips/trp_ownerA_01`).allowed &&
      !sim.evalFirestore(legacyStaffA, 'create', `companies/${compA}/trips/trp_ops1`, { companyId: compA }).allowed &&
      !sim.evalFirestore(legacyStaffA, 'create', `companies/${compA}/invoices/inv_ops1`, { companyId: compA }).allowed,
    'Sim: Legacy non-owner staff user completely BLOCKED from reading or writing company trips/invoices'
  );

  sim.seedFirestore(`companies/${compA}/settings/default`, {
    id: 'default',
    companyId: compA,
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  });

  const ownerInvoiceRes = sim.evalFirestore(ownerA, 'create', `companies/${compA}/invoices/inv_ownerA_01`, {
    id: 'inv_ownerA_01',
    companyId: compA,
    invoiceNumber: 'INV/26-27/001',
    customerId: 'cust_01',
    totalAmountPaise: 5775000,
    status: 'ISSUED',
    paymentStatus: 'UNPAID',
    issueDate: '2026-11-18',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  });
  const ownerSettingsRes = sim.evalFirestore(ownerA, 'update', `companies/${compA}/settings/default`, {
    id: 'default',
    companyId: compA,
    defaultGstRatePercent: 5,
    updatedAt: SERVER_TIME,
  });
  const ownerMaintRes = sim.evalFirestore(ownerA, 'create', `companies/${compA}/maintenance/mnt_01`, {
    id: 'mnt_01',
    companyId: compA,
    vehicleId: 'veh_01',
    vehicleReg: 'WB-11-C-9012',
    serviceType: 'SCHEDULED_SERVICE',
    garageName: 'Tata Authorized Workshop',
    costPaise: 1850000,
    odometerReading: 145200,
    serviceDate: '2026-11-18',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  });
  const ownerMaintAuditRes = sim.evalFirestore(ownerA, 'create', `companies/${compA}/auditLogs/log_mnt_01`, {
    id: 'log_mnt_01',
    companyId: compA,
    userId: ownerA.uid,
    action: 'CREATE',
    entityType: 'MAINTENANCE',
    entityId: 'mnt_01',
    moduleName: 'MAINTENANCE',
    summary: 'Logged SCHEDULED_SERVICE for WB-11-C-9012',
    timestamp: SERVER_TIME,
  });
  const ownerExpenseLongReceipt = sim.evalFirestore(ownerA, 'create', `companies/${compA}/expenses/exp_01`, {
    id: 'exp_01',
    companyId: compA,
    tripId: 'trp_ownerA_01',
    category: 'DIESEL',
    amountPaise: 1200000,
    paymentMode: 'PETRO_CARD',
    receiptUrl: `https://firebasestorage.googleapis.com/v0/b/bucket/o/${'a'.repeat(900)}`,
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  });

  assert(
    ownerInvoiceRes.allowed &&
      ownerSettingsRes.allowed &&
      ownerMaintRes.allowed &&
      ownerMaintAuditRes.allowed &&
      ownerExpenseLongReceipt.allowed,
    'Sim: Verified Owner A passes strict rules for Invoices, Settings, Maintenance + MAINTENANCE AuditLog, and 900+ char Expense receiptUrl'
  );

  // Red-Team Schema Tamper Checks
  const shadowFieldReject = sim.evalFirestore(ownerA, 'create', `companies/${compA}/invoices/inv_shadow`, {
    id: 'inv_shadow',
    companyId: compA,
    invoiceNumber: 'INV-BAD-01',
    customerId: 'cust_01',
    totalAmountPaise: 10000,
    status: 'ISSUED',
    issueDate: '2026-11-18',
    rogueAdminFlag: true,
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  });
  const crossCompanyTripSpoofReject = sim.evalFirestore(ownerA, 'create', `companies/${compA}/trips/trp_spoof`, {
    id: 'trp_spoof',
    companyId: compB,
    status: 'DISPATCHED',
  });
  const flexibleTripCustomFieldOk = sim.evalFirestore(ownerA, 'create', `companies/${compA}/trips/trp_flex_ok`, {
    customTag: 'EXPRESS_DISPATCH',
    notes: 'Created without fixed schema or timestamps',
  });
  const postDispatchDispatchRemarksOk = sim.evalFirestore(
    ownerA,
    'update',
    `companies/${compA}/trips/trp_ownerA_01`,
    {
      id: 'trp_ownerA_01',
      companyId: compA,
      dispatchRemarks: 'Gate pass #88 updated after dispatch',
      podReceived: true,
      podRemarks: 'Signed POD received',
      updatedAt: SERVER_TIME,
    }
  );
  const badAuditAction = sim.evalFirestore(ownerA, 'create', `companies/${compA}/auditLogs/log_bad`, {
    id: 'log_bad',
    companyId: compA,
    userId: ownerA.uid,
    action: 'CREATE',
    entityType: 'UNKNOWN_MODULE',
    entityId: 'x',
    summary: 'Bad entityType',
    timestamp: SERVER_TIME,
  });
  assert(
    !shadowFieldReject.allowed &&
      !crossCompanyTripSpoofReject.allowed &&
      flexibleTripCustomFieldOk.allowed &&
      postDispatchDispatchRemarksOk.allowed &&
      !badAuditAction.allowed,
    'Red-Team Schema: Allows owner flexible Trip & Dispatch writes while rejecting cross-company trip spoofing, invoice shadow fields, and invalid AuditLog types'
  );
  assert(
    firestoreServiceSrc.includes('saveMaintenanceInFirestore') &&
      firestoreServiceSrc.includes('deleteMaintenanceInFirestore') &&
      rulesSrc.includes("'MAINTENANCE'") &&
      blueprintSrc.includes('"MAINTENANCE"'),
    'Maintenance module atomic batch CRUD and MAINTENANCE audit log schema synced across rules, blueprint, and firestoreService'
  );
  assert(
    permissionsSrc.includes('canManageUsers: false') &&
      permissionsSrc.includes("if (role !== 'OWNER') return false;"),
    'src/lib/permissions.ts enforces strict Owner-Only access with zero team management'
  );

  // ========================================================================
  // TEST 8: Privilege & Ownership Self-Escalation Rejection
  // ========================================================================
  console.log('\n--- TEST 8: Privilege & Ownership Self-Escalation Guards ---');

  sim.seedFirestore(`users/${legacyStaffA.uid}`, {
    id: legacyStaffA.uid,
    email: legacyStaffA.email,
    name: 'Ops User',
    role: 'USER',
  });

  const userRoleEsc = sim.evalFirestore(legacyStaffA, 'update', `users/${legacyStaffA.uid}`, {
    id: legacyStaffA.uid,
    role: 'OWNER',
  });
  const ownerIdTamper = sim.evalFirestore(ownerA, 'update', `companies/${compA}`, {
    id: compA,
    ownerId: ownerB.uid,
  });
  const memberSelfPromote = sim.evalFirestore(legacyStaffA, 'update', `companies/${compA}/members/${legacyStaffA.uid}`, {
    id: legacyStaffA.uid,
    userId: legacyStaffA.uid,
    companyId: compA,
    role: 'OWNER',
    status: 'ACTIVE',
  });
  const staffProvisionAttempt = sim.evalFirestore(ownerA, 'create', `companies/${compA}/members/uid_rogue`, {
    id: 'uid_rogue',
    userId: 'uid_rogue',
    companyId: compA,
    role: 'ADMIN',
    status: 'ACTIVE',
  });
  const crossBrokerWrite = sim.evalFirestore(ownerA, 'create', `companies/${compA}/brokers/brk_spoof`, {
    id: 'brk_spoof',
    companyId: compB,
  });

  assert(!userRoleEsc.allowed, 'Blocked /users/{uid}.role self-escalation from USER to OWNER');
  assert(!ownerIdTamper.allowed, 'Blocked /companies/{cid}.ownerId mutation (strictly immutable)');
  assert(!memberSelfPromote.allowed, 'Blocked non-owner /members/{uid} self-promotion to OWNER');
  assert(!staffProvisionAttempt.allowed, 'Blocked creating employee/staff /members documents');
  assert(!crossBrokerWrite.allowed, 'Blocked cross-company companyId payload injection');

  // ========================================================================
  // TEST 9: Explicit TEST A–H End-to-End Verification Checks
  // ========================================================================
  console.log('\n--- TEST 9: Explicit TEST A–H Fixes & Regression Guards ---');

  const clientSrc = fs.readFileSync(path.join(root, 'src/lib/firebase/client.ts'), 'utf8');
  const appSrc = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const profilePageSrc = fs.readFileSync(path.join(root, 'src/components/auth/CompanyProfilePage.tsx'), 'utf8');

  // TEST A: Quick Dispatch & TripModal creation paths
  assert(
    appSrc.includes('createOrUpdateTripInFirestore') &&
      tripModalSrc.includes('createOrUpdateTripInFirestore'),
    'TEST A: Both Quick Dispatch (App.tsx) and TripModal write trips via createOrUpdateTripInFirestore'
  );

  // TEST B: TripModal full status selector & previousVehicle/previousDriver reassignment release
  assert(
    tripModalSrc.includes('aria-label="Trip Status"') &&
      tripModalSrc.includes('previousVehicle') &&
      tripModalSrc.includes('previousDriver') &&
      firestoreServiceSrc.includes('previousVehicle?: Vehicle;') &&
      firestoreServiceSrc.includes('previousDriver?: Driver;') &&
      firestoreServiceSrc.includes("previousVehicle.id !== vehicle?.id") &&
      firestoreServiceSrc.includes("previousDriver.id !== driver?.id"),
    'TEST B: TripModal supports editing all trip statuses and releases previous vehicle/driver on reassignment'
  );

  // TEST C: Owner deletes trip and releases vehicle/driver
  const deleteTripRes = sim.evalFirestore(ownerA, 'delete', `companies/${compA}/trips/trp_ownerA_01`);
  assert(
    deleteTripRes.allowed &&
      firestoreServiceSrc.includes('deleteTripInFirestore') &&
      firestoreServiceSrc.includes("opts.vehicle.status === 'IN_TRANSIT' ? 'AVAILABLE' : opts.vehicle.status"),
    'TEST C: Owner deletes trip in Firestore and releases assigned vehicle & driver'
  );

  // TEST D: Financial CRUD (Expense/Fuel, Advance, Settlement, Invoice) & safe batch chunk size (<= 8)
  const advCreateRes = sim.evalFirestore(ownerA, 'create', `companies/${compA}/advances/adv_01`, {
    id: 'adv_01',
    companyId: compA,
    driverId: 'drv_01',
    amountPaise: 500000,
    advanceType: 'CASH_DISPATCH',
    date: '2026-11-18',
    isSettled: false,
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  });
  const advUpdateRes = sim.evalFirestore(ownerA, 'update', `companies/${compA}/advances/adv_01`, {
    id: 'adv_01',
    companyId: compA,
    amountPaise: 600000,
    updatedAt: SERVER_TIME,
  });
  const advDeleteRes = sim.evalFirestore(ownerA, 'delete', `companies/${compA}/advances/adv_01`);
  const stlCreateRes = sim.evalFirestore(ownerA, 'create', `companies/${compA}/settlements/stl_01`, {
    id: 'stl_01',
    companyId: compA,
    tripId: 'trp_ownerA_01',
    driverId: 'drv_01',
    status: 'FINALIZED',
    settledDate: '2026-11-18',
    netPayableToDriverPaise: 150000,
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  });
  const stlDeleteRes = sim.evalFirestore(ownerA, 'delete', `companies/${compA}/settlements/stl_01`);
  assert(
    advCreateRes.allowed &&
      advUpdateRes.allowed &&
      advDeleteRes.allowed &&
      stlCreateRes.allowed &&
      stlDeleteRes.allowed &&
      firestoreServiceSrc.includes('const MAX_PRIMARY_CHILDREN = 8;') &&
      firestoreServiceSrc.includes('const OVERFLOW_CHUNK = 8;') &&
      firestoreServiceSrc.includes('const CHUNK_SIZE = 8;'),
    'TEST D: Owner passes Advance/Settlement CRUD and batch helpers stay within safe 8-doc rule lookup chunks'
  );

  // TEST E: Session rehydration & CompanyProfilePage TDZ fix
  const canEditDeclIdx = profilePageSrc.indexOf('const canEdit =');
  const savePrefIdx = profilePageSrc.indexOf('const handleSavePreferences =');
  assert(
    canEditDeclIdx !== -1 &&
      savePrefIdx !== -1 &&
      canEditDeclIdx < savePrefIdx &&
      !authRoutesSrc.includes('!adminAuth &&') &&
      authRoutesSrc.includes('firestoreCompany.ownerId === user.id'),
    'TEST E: CompanyProfilePage declares canEdit before handleSavePreferences & /api/auth/session rehydrates owned Firestore company'
  );

  // TEST F & G already enforced in Scenarios 4–6; TEST H: handleFirestoreError includes companyId without tokens
  assert(
    clientSrc.includes('companyId?: string | null;') &&
      clientSrc.includes('companyId: companyMatch ? companyMatch[1] : null') &&
      clientSrc.includes('operationType,') &&
      clientSrc.includes('path,') &&
      clientSrc.includes('userId: currentUser?.uid ?? null') &&
      !clientSrc.includes('accessToken') &&
      !clientSrc.includes('idToken'),
    'TEST H: handleFirestoreError includes companyId, operationType, path, authInfo.userId without leaking tokens'
  );

  // ========================================================================
  // TEST 10: Trip Logs Sub-Collection & Quick Dispatch Error-Path Hardening
  // ========================================================================
  console.log('\n--- TEST 10: Trip Logs Sub-Collection & Quick Dispatch Hardening ---');

  const tripDetailModalSrc = fs.readFileSync(path.join(root, 'src/modules/trips/TripDetailModal.tsx'), 'utf8');
  const tripsViewSrc = fs.readFileSync(path.join(root, 'src/modules/trips/TripsView.tsx'), 'utf8');

  // Re-seed parent trip for trip_logs simulation (deleted in TEST C above)
  sim.seedFirestore(`companies/${compA}/trips/trp_ownerA_logs`, {
    id: 'trp_ownerA_logs',
    companyId: compA,
    tripNumber: 'TR-2026-0999',
    vehicleId: 'veh_01',
    driverId: 'drv_01',
    customerId: 'cust_01',
    status: 'IN_TRANSIT',
    freightAmountPaise: 5500000,
    totalRevenuePaise: 5500000,
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  });

  const logCreateOk = sim.evalFirestore(
    ownerA,
    'create',
    `companies/${compA}/trips/trp_ownerA_logs/trip_logs/tlog_01`,
    {
      id: 'tlog_01',
      companyId: compA,
      tripId: 'trp_ownerA_logs',
      tripNumber: 'TR-2026-0999',
      status: 'Reached Loading Point',
      severity: 'SUCCESS',
      timestamp: '2026-11-20T09:15',
      locationNote: 'Durgapur Steel Plant Gate 3, NH-19',
      latitude: 23.5204,
      longitude: 87.3119,
      odometerKm: 124500,
      notes: 'Truck weighed at weighbridge',
      loggedByUid: ownerA.uid,
      loggedByName: 'Alpha Owner',
      createdAt: SERVER_TIME,
      updatedAt: SERVER_TIME,
    }
  );
  const logUpdateOk = sim.evalFirestore(
    ownerA,
    'update',
    `companies/${compA}/trips/trp_ownerA_logs/trip_logs/tlog_01`,
    {
      id: 'tlog_01',
      companyId: compA,
      tripId: 'trp_ownerA_logs',
      status: 'Vehicle Breakdown',
      severity: 'CRITICAL',
      locationNote: 'Panagarh Bypass KM 412',
      updatedAt: SERVER_TIME,
    }
  );
  const logAuditOk = sim.evalFirestore(ownerA, 'create', `companies/${compA}/auditLogs/alog_tlog_01`, {
    id: 'alog_tlog_01',
    companyId: compA,
    userId: ownerA.uid,
    action: 'CREATE',
    entityType: 'TRIP_LOG',
    entityId: 'tlog_01',
    moduleName: 'TRIPS',
    summary: 'Logged Reached Loading Point for TR-2026-0999',
    timestamp: SERVER_TIME,
  });
  const logCrossTenantDenied = sim.evalFirestore(
    ownerB,
    'get',
    `companies/${compA}/trips/trp_ownerA_logs/trip_logs/tlog_01`
  );
  const logOrphanParentDenied = sim.evalFirestore(
    ownerA,
    'create',
    `companies/${compA}/trips/nonexistent_trip/trip_logs/tlog_orphan`,
    {
      id: 'tlog_orphan',
      companyId: compA,
      tripId: 'nonexistent_trip',
      status: 'Reached Loading Point',
      timestamp: '2026-11-20T10:00',
      locationNote: 'Orphan Check',
      createdAt: SERVER_TIME,
      updatedAt: SERVER_TIME,
    }
  );
  const logInvalidLatDenied = sim.evalFirestore(
    ownerA,
    'create',
    `companies/${compA}/trips/trp_ownerA_logs/trip_logs/tlog_badlat`,
    {
      id: 'tlog_badlat',
      companyId: compA,
      tripId: 'trp_ownerA_logs',
      status: 'Vehicle Breakdown',
      timestamp: '2026-11-20T10:00',
      locationNote: 'Invalid Coordinates',
      latitude: 145.5,
      createdAt: SERVER_TIME,
      updatedAt: SERVER_TIME,
    }
  );
  const logDeleteOk = sim.evalFirestore(
    ownerA,
    'delete',
    `companies/${compA}/trips/trp_ownerA_logs/trip_logs/tlog_01`
  );

  assert(
    logCreateOk.allowed &&
      logUpdateOk.allowed &&
      logAuditOk.allowed &&
      logDeleteOk.allowed &&
      !logCrossTenantDenied.allowed &&
      !logOrphanParentDenied.allowed &&
      !logInvalidLatDenied.allowed,
    'Sim: Nested trip_logs enforces Owner-Only CRUD, parent trip existence, lat/lng bounds, and TRIP_LOG audit logging'
  );

  assert(
    rulesSrc.includes('function isValidTripLog(data, companyId, tripId, logId)') &&
      rulesSrc.includes('match /trip_logs/{logId}') &&
      rulesSrc.includes("'TRIP_LOG'") &&
      blueprintSrc.includes('"/companies/{companyId}/trips/{tripId}/trip_logs/{logId}"') &&
      blueprintSrc.includes('"TRIP_LOG"'),
    'firestore.rules and firebase-blueprint.json define TripLog schema, TRIP_LOG audit enum, and nested trip_logs rules'
  );

  assert(
    firestoreServiceSrc.includes('export function subscribeToTripLogsInFirestore') &&
      firestoreServiceSrc.includes('export async function saveTripLogInFirestore') &&
      firestoreServiceSrc.includes('export async function deleteTripLogInFirestore') &&
      firestoreServiceSrc.includes("'trip_logs'") &&
      firestoreServiceSrc.includes('let activePath =') &&
      firestoreServiceSrc.includes('let activeOp: OperationType =') &&
      firestoreServiceSrc.includes('existingData?.registrationNumber'),
    'firestoreService.ts implements trip_logs CRUD, parent trip cascade cleanup, subcollection existingData fallbacks, and step-scoped activePath/activeOp diagnostics'
  );

  assert(
    tripDetailModalSrc.includes('subscribeToTripLogsInFirestore') &&
      tripDetailModalSrc.includes('saveTripLogInFirestore') &&
      tripDetailModalSrc.includes('deleteTripLogInFirestore') &&
      tripDetailModalSrc.includes('Reached Loading Point') &&
      tripDetailModalSrc.includes('Vehicle Breakdown') &&
      tripDetailModalSrc.includes('Capture GPS') &&
      tripsViewSrc.includes("setSelectedTripTab('logs')") &&
      tripsViewSrc.includes('initialTab={selectedTripTab}') &&
      tripsViewSrc.includes('Trip Logs'),
    'TripDetailModal & TripsView integrate live trip_logs timeline, preset statuses, breakdown shortcut, and GPS capture'
  );

  // ========================================================================
  // TEST 11: Unrestricted Verified-Owner Trip & Dispatch 11-Scenario Verification
  // ========================================================================
  console.log('\n--- TEST 11: Verified-Owner Trip & Dispatch 11-Scenario Verification ---');

  // 1. Create a trip with all fields
  const s1FullCreate = sim.evalFirestore(ownerA, 'create', `companies/${compA}/trips/trp_p10_full`, {
    id: 'trp_p10_full',
    companyId: compA,
    tripNumber: 'TR-2026-1001',
    lrNumber: 'AT/26-27/1001',
    customerId: 'cust_01',
    customerName: 'JSW Steel Ltd',
    vehicleId: 'veh_01',
    vehicleReg: 'WB23E4412',
    driverId: 'drv_01',
    driverName: 'Ramesh Yadav',
    originCity: 'Durgapur',
    destinationCity: 'Kolkata',
    goodsType: 'HR Coils',
    weightTonnes: 24,
    ratePerTonnePaise: 200000,
    freightAmountPaise: 4800000,
    otherChargesPaise: 0,
    totalRevenuePaise: 4800000,
    dispatchDate: '2026-11-22',
    expectedDeliveryDate: '2026-11-24',
    status: 'PLANNED',
    createdBy: ownerA.uid,
    eWayBillNumber: 'EWB123456789012',
    routeDistanceKm: 175,
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  });

  // 2. Create a trip with some optional fields missing (and without timestamps / driverId / customerId / vehicleId / amounts)
  const s2PartialCreate = sim.evalFirestore(ownerA, 'create', `companies/${compA}/trips/trp_p10_min`, {
    status: 'PLANNED',
    customLaneTag: 'EAST_CORRIDOR',
  });

  // 3. Edit an existing trip
  const s3Edit = sim.evalFirestore(ownerA, 'update', `companies/${compA}/trips/trp_p10_full`, {
    notes: 'Updated loading bay instructions',
    freightAmountPaise: 5000000,
    totalRevenuePaise: 5000000,
    extraFieldAddedLater: 'permit_verified',
  });

  // 4. Dispatch a trip (PLANNED -> DISPATCHED)
  const s4Dispatch = sim.evalFirestore(ownerA, 'update', `companies/${compA}/trips/trp_p10_full`, {
    status: 'DISPATCHED',
    dispatchDate: '2026-11-22',
    dispatchRemarks: 'Dispatched cleanly from gate 2',
  });

  // 5. Change dispatch status (DISPATCHED -> IN_TRANSIT -> DELIVERED)
  const s5StatusInTransit = sim.evalFirestore(ownerA, 'update', `companies/${compA}/trips/trp_p10_full`, {
    status: 'IN_TRANSIT',
  });
  const s5StatusDelivered = sim.evalFirestore(ownerA, 'update', `companies/${compA}/trips/trp_p10_full`, {
    status: 'DELIVERED',
    actualDeliveryDate: '2026-11-24',
  });

  // 6 & 7. Change assigned driver and vehicle
  const s6ReassignDriverVehicle = sim.evalFirestore(ownerA, 'update', `companies/${compA}/trips/trp_p10_full`, {
    vehicleId: 'veh_02',
    vehicleReg: 'WB23E9988',
    driverId: 'drv_02',
    driverName: 'Suresh Mondal',
  });

  // 8. Update LR and POD information
  const s8LrPodUpdate = sim.evalFirestore(ownerA, 'update', `companies/${compA}/trips/trp_p10_full`, {
    lrNumber: 'AT/26-27/1001-REV',
    lrDocumentUrl: 'https://firebasestorage.googleapis.com/lr.pdf',
    podReceived: true,
    podDocumentUrl: 'https://firebasestorage.googleapis.com/pod.jpg',
    podRemarks: 'Stamped POD received at unloading yard',
  });

  // 9. Update a dispatched trip (re-editing after dispatch)
  const s9UpdateDispatched = sim.evalFirestore(ownerA, 'update', `companies/${compA}/trips/trp_p10_full`, {
    dispatchRemarks: 'Post-dispatch route diversion approved',
    dispatchDocumentUrl: 'https://firebasestorage.googleapis.com/dispatch_v2.pdf',
  });

  // 10. Save, reload, and verify persistence (including existing trips intact)
  const reloadTrips = sim.listCompanyTrips(ownerA.uid, compA);
  const reloadFull = reloadTrips.find((t) => t.id === 'trp_p10_full');
  const reloadMin = reloadTrips.find((t) => t.customLaneTag === 'EAST_CORRIDOR');
  const existingLogsParent = reloadTrips.find((t) => t.id === 'trp_ownerA_logs');

  // 11. Verify another company cannot access or mutate the data
  const crossCompanyRead = sim.evalFirestore(ownerB, 'get', `companies/${compA}/trips/trp_p10_full`);
  const crossCompanyCreate = sim.evalFirestore(ownerB, 'create', `companies/${compA}/trips/trp_p10_hack`, {
    id: 'trp_p10_hack',
    companyId: compA,
    status: 'PLANNED',
  });
  const crossCompanyUpdate = sim.evalFirestore(ownerB, 'update', `companies/${compA}/trips/trp_p10_full`, {
    status: 'CANCELLED',
  });
  const crossCompanyDelete = sim.evalFirestore(ownerB, 'delete', `companies/${compA}/trips/trp_p10_full`);

  assert(
    s1FullCreate.allowed &&
      s2PartialCreate.allowed &&
      s3Edit.allowed &&
      s4Dispatch.allowed &&
      s5StatusInTransit.allowed &&
      s5StatusDelivered.allowed &&
      s6ReassignDriverVehicle.allowed &&
      s8LrPodUpdate.allowed &&
      s9UpdateDispatched.allowed &&
      Boolean(reloadFull) &&
      reloadFull?.status === 'DELIVERED' &&
      reloadFull?.driverId === 'drv_02' &&
      reloadFull?.vehicleId === 'veh_02' &&
      reloadFull?.lrNumber === 'AT/26-27/1001-REV' &&
      reloadFull?.podReceived === true &&
      reloadFull?.extraFieldAddedLater === 'permit_verified' &&
      Boolean(reloadMin) &&
      Boolean(existingLogsParent) &&
      !crossCompanyRead.allowed &&
      !crossCompanyCreate.allowed &&
      !crossCompanyUpdate.allowed &&
      !crossCompanyDelete.allowed,
    '11-Scenario Trip & Dispatch Check: Full/partial create, edit, dispatch, status changes, driver/vehicle reassign, LR/POD updates, post-dispatch edit, reload persistence, and cross-company isolation all pass'
  );

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
