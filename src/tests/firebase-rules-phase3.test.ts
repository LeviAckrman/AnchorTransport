/**
 * AnchorTransport TMS - Phase 3 Firestore Security Rules & Multi-Tenant Isolation Test Suite
 *
 * Validates:
 * 1. Multi-tenant boundary isolation across all 12 company-scoped collections:
 *    - vehicles, drivers, customers, trips, expenses, advances, settlements,
 *      invoices, payments, documents, maintenance, auditLogs.
 * 2. Strict company membership authorization (/companies/{companyId}/members/{userId}).
 * 3. Prevention of cross-tenant reads, writes, and companyId spoofing.
 * 4. Role-based access control (RBAC):
 *    - OWNER, ADMIN, MANAGER, ACCOUNTANT, OPERATIONS
 *    - Financial collection protection (invoices, settlements reserved for ACCOUNTANT, ADMIN, OWNER)
 * 5. Audit log immutability (write once, never update or delete).
 */

import {
  FirestorePaths,
  Role as FirestoreRole,
  FirestoreVehicle as CompanyVehicleDoc,
  FirestoreTrip as CompanyTripDoc,
  FirestoreInvoice as CompanyInvoiceDoc,
  FirestoreTripSettlement as CompanySettlementDoc,
  FirestoreAuditLog as CompanyAuditLogDoc,
} from '../types/firestore';

interface MockAuth {
  uid: string;
  email: string;
}

interface MockMemberDoc {
  userId: string;
  role: FirestoreRole;
  companyId: string;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
}

interface MockStore {
  [path: string]: Record<string, unknown>;
}

// In-memory Firestore Rules Engine simulating firestore.rules logic
class MockFirestoreSecurityEngine {
  private store: MockStore = {};

  setDoc(path: string, data: Record<string, unknown>) {
    this.store[path] = { ...data };
  }

  getDoc(path: string): Record<string, unknown> | null {
    return this.store[path] ? { ...this.store[path] } : null;
  }

  // Evaluate rule based on firestore.rules
  evaluate(
    auth: MockAuth | null,
    operation: 'get' | 'list' | 'create' | 'update' | 'delete',
    path: string,
    incomingData?: Record<string, unknown>
  ): { allowed: boolean; reason?: string } {
    if (!auth) {
      return { allowed: false, reason: 'Unauthenticated' };
    }

    const segments = path.split('/').filter(Boolean);

    // Root users collection: /users/{userId}
    if (segments[0] === 'users' && segments.length === 2) {
      const targetUserId = segments[1];
      if (operation === 'get' || operation === 'list') {
        return { allowed: auth.uid === targetUserId };
      }
      if (operation === 'create' || operation === 'update') {
        return { allowed: auth.uid === targetUserId };
      }
      return { allowed: false, reason: 'Deletes disabled for users' };
    }

    // Company subcollections: /companies/{companyId}/{subcollection}/{docId}
    if (segments[0] === 'companies' && segments.length >= 3) {
      const companyId = segments[1];
      const subcollection = segments[2];
      const docId = segments[3];

      // Check membership
      const memberPath = `companies/${companyId}/members/${auth.uid}`;
      const membership = this.getDoc(memberPath) as MockMemberDoc | null;

      if (!membership || membership.status !== 'ACTIVE') {
        return { allowed: false, reason: 'Not an active company member' };
      }

      const role = membership.role;
      const isOwner = role === 'OWNER';
      const isAdmin = role === 'ADMIN';
      const isManager = role === 'MANAGER';
      const isAccountant = role === 'ACCOUNTANT';
      const isOperations = role === 'OPERATIONS';

      // Membership subcollection
      if (subcollection === 'members') {
        if (operation === 'get' || operation === 'list') {
          return { allowed: true }; // any active member can list directory
        }
        if (isOwner || isAdmin) {
          return { allowed: true };
        }
        return { allowed: false, reason: 'Only Owner or Admin can manage company members' };
      }

      // Audit logs: immutable!
      if (subcollection === 'auditLogs') {
        if (operation === 'get' || operation === 'list') {
          return { allowed: isOwner || isAdmin || isManager };
        }
        if (operation === 'create') {
          // Any active member can record actions
          if (incomingData?.companyId !== companyId) {
            return { allowed: false, reason: 'Cross-company data injection detected' };
          }
          return { allowed: true };
        }
        // Strict immutability
        if (operation === 'update' || operation === 'delete') {
          return { allowed: false, reason: 'Audit logs are immutable' };
        }
      }

      // Financials: invoices, settlements, payments
      if (['invoices', 'settlements', 'payments'].includes(subcollection)) {
        if (operation === 'get' || operation === 'list') {
          return { allowed: isOwner || isAdmin || isManager || isAccountant };
        }
        if (operation === 'create' || operation === 'update') {
          if (!isOwner && !isAdmin && !isAccountant) {
            return { allowed: false, reason: 'Operations staff cannot create or modify financial records' };
          }
          if (incomingData && incomingData.companyId !== companyId) {
            return { allowed: false, reason: 'Cross-tenant companyId mismatch' };
          }
          return { allowed: true };
        }
        if (operation === 'delete') {
          return { allowed: isOwner };
        }
      }

      // Operational: vehicles, drivers, trips, maintenance, documents
      if (['vehicles', 'drivers', 'trips', 'maintenance', 'documents', 'customers'].includes(subcollection)) {
        if (operation === 'get' || operation === 'list') {
          return { allowed: true }; // all active company members can view operations
        }
        if (operation === 'create' || operation === 'update') {
          // Operations, Manager, Admin, Owner can edit operational entities
          if (incomingData && incomingData.companyId !== companyId) {
            return { allowed: false, reason: 'Cross-tenant companyId mismatch' };
          }
          return { allowed: true };
        }
        if (operation === 'delete') {
          // Deletions reserved for Owner/Admin
          return { allowed: isOwner || isAdmin };
        }
      }

      // Expenses & Advances
      if (['expenses', 'advances'].includes(subcollection)) {
        if (operation === 'get' || operation === 'list') {
          return { allowed: true };
        }
        if (operation === 'create' || operation === 'update') {
          if (incomingData && incomingData.companyId !== companyId) {
            return { allowed: false, reason: 'Cross-tenant companyId mismatch' };
          }
          return { allowed: true };
        }
        if (operation === 'delete') {
          return { allowed: isOwner || isAdmin || isAccountant };
        }
      }
    }

    return { allowed: false, reason: 'Default deny rule matched' };
  }
}

async function runPhase3RulesTests() {
  console.log('===============================================================');
  console.log('   ANCHORTRANSPORT TMS - PHASE 3 FIRESTORE SECURITY RULES TEST  ');
  console.log('===============================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  const engine = new MockFirestoreSecurityEngine();

  // Seed two distinct companies and users
  const companyAlpha = 'comp_alpha_101';
  const companyBeta = 'comp_beta_202';

  const userAlphaOwner: MockAuth = { uid: 'usr_alpha_owner', email: 'owner@alpha.in' };
  const userAlphaOps: MockAuth = { uid: 'usr_alpha_ops', email: 'ops@alpha.in' };
  const userAlphaAcc: MockAuth = { uid: 'usr_alpha_acc', email: 'accounts@alpha.in' };

  const userBetaOwner: MockAuth = { uid: 'usr_beta_owner', email: 'owner@beta.in' };
  const userBetaOps: MockAuth = { uid: 'usr_beta_ops', email: 'ops@beta.in' };

  // Set company memberships
  engine.setDoc(`companies/${companyAlpha}/members/${userAlphaOwner.uid}`, {
    userId: userAlphaOwner.uid,
    role: 'OWNER',
    companyId: companyAlpha,
    status: 'ACTIVE',
  });
  engine.setDoc(`companies/${companyAlpha}/members/${userAlphaOps.uid}`, {
    userId: userAlphaOps.uid,
    role: 'OPERATIONS',
    companyId: companyAlpha,
    status: 'ACTIVE',
  });
  engine.setDoc(`companies/${companyAlpha}/members/${userAlphaAcc.uid}`, {
    userId: userAlphaAcc.uid,
    role: 'ACCOUNTANT',
    companyId: companyAlpha,
    status: 'ACTIVE',
  });

  engine.setDoc(`companies/${companyBeta}/members/${userBetaOwner.uid}`, {
    userId: userBetaOwner.uid,
    role: 'OWNER',
    companyId: companyBeta,
    status: 'ACTIVE',
  });
  engine.setDoc(`companies/${companyBeta}/members/${userBetaOps.uid}`, {
    userId: userBetaOps.uid,
    role: 'OPERATIONS',
    companyId: companyBeta,
    status: 'ACTIVE',
  });

  // Seed documents in Company Alpha
  engine.setDoc(`companies/${companyAlpha}/vehicles/veh_001`, {
    id: 'veh_001',
    companyId: companyAlpha,
    registrationNumber: 'MH 12 AB 1234',
    vehicleType: 'TRUCK_10_TYRE',
    status: 'AVAILABLE',
  });

  engine.setDoc(`companies/${companyAlpha}/trips/trip_001`, {
    id: 'trip_001',
    companyId: companyAlpha,
    tripNumber: 'TRP-2026-0001',
    vehicleId: 'veh_001',
    freightAmount: 85000,
    status: 'IN_TRANSIT',
  });

  engine.setDoc(`companies/${companyAlpha}/invoices/inv_001`, {
    id: 'inv_001',
    companyId: companyAlpha,
    invoiceNumber: 'INV-2026-0001',
    totalAmount: 90000,
    gstAmount: 5000,
    paymentStatus: 'UNPAID',
  });

  engine.setDoc(`companies/${companyAlpha}/auditLogs/log_001`, {
    id: 'log_001',
    companyId: companyAlpha,
    action: 'CREATE_TRIP',
    userId: userAlphaOwner.uid,
  });

  console.log('\n--- SUITE 1: Multi-Tenant Boundary Isolation (Cross-Company Access) ---');

  // Test 1: User Alpha Owner can read Alpha vehicle
  const r1 = engine.evaluate(userAlphaOwner, 'get', `companies/${companyAlpha}/vehicles/veh_001`);
  assert(r1.allowed, 'Alpha Owner can read Alpha vehicle');

  // Test 2: User Beta Owner CANNOT read Alpha vehicle (Isolation)
  const r2 = engine.evaluate(userBetaOwner, 'get', `companies/${companyAlpha}/vehicles/veh_001`);
  assert(!r2.allowed, 'Beta Owner CANNOT read Alpha vehicle (Cross-Tenant blocked)');

  // Test 3: User Beta Ops CANNOT read Alpha trips
  const r3 = engine.evaluate(userBetaOps, 'get', `companies/${companyAlpha}/trips/trip_001`);
  assert(!r3.allowed, 'Beta Operations CANNOT read Alpha trips');

  // Test 4: User Beta Owner CANNOT read Alpha invoices
  const r4 = engine.evaluate(userBetaOwner, 'get', `companies/${companyAlpha}/invoices/inv_001`);
  assert(!r4.allowed, 'Beta Owner CANNOT read Alpha financial invoices');

  // Test 5: User Beta Ops CANNOT write vehicle to Alpha company
  const r5 = engine.evaluate(userBetaOps, 'create', `companies/${companyAlpha}/vehicles/veh_sneaky`, {
    id: 'veh_sneaky',
    companyId: companyAlpha,
    registrationNumber: 'DL 01 XY 9999',
  });
  assert(!r5.allowed, 'Beta Ops CANNOT create vehicle in Alpha company');

  // Test 6: Tenant injection check - User Alpha creating doc with Beta companyId
  const r6 = engine.evaluate(userAlphaOps, 'create', `companies/${companyAlpha}/vehicles/veh_tampered`, {
    id: 'veh_tampered',
    companyId: companyBeta, // Spoofed companyId
    registrationNumber: 'KA 03 AA 1111',
  });
  assert(!r6.allowed, 'Tampered companyId matching path blocked (Spoof prevention)');

  console.log('\n--- SUITE 2: Role-Based Access Control (RBAC) ---');

  // Test 7: Operations staff can create trip in their company
  const r7 = engine.evaluate(userAlphaOps, 'create', `companies/${companyAlpha}/trips/trip_002`, {
    id: 'trip_002',
    companyId: companyAlpha,
    tripNumber: 'TRP-2026-0002',
  });
  assert(r7.allowed, 'Operations staff can create trips within company');

  // Test 8: Operations staff CANNOT create invoices
  const r8 = engine.evaluate(userAlphaOps, 'create', `companies/${companyAlpha}/invoices/inv_002`, {
    id: 'inv_002',
    companyId: companyAlpha,
    invoiceNumber: 'INV-2026-0002',
  });
  assert(!r8.allowed, 'Operations staff CANNOT create financial invoices');

  // Test 9: Operations staff CANNOT create settlements
  const r9 = engine.evaluate(userAlphaOps, 'create', `companies/${companyAlpha}/settlements/stl_001`, {
    id: 'stl_001',
    companyId: companyAlpha,
    settlementNumber: 'STL-001',
  });
  assert(!r9.allowed, 'Operations staff CANNOT create settlements');

  // Test 10: Accountant CAN create invoices and settlements
  const r10 = engine.evaluate(userAlphaAcc, 'create', `companies/${companyAlpha}/invoices/inv_003`, {
    id: 'inv_003',
    companyId: companyAlpha,
    invoiceNumber: 'INV-2026-0003',
  });
  assert(r10.allowed, 'Accountant CAN create invoices');

  // Test 11: Non-owner cannot delete company vehicle
  const r11 = engine.evaluate(userAlphaOps, 'delete', `companies/${companyAlpha}/vehicles/veh_001`);
  assert(!r11.allowed, 'Operations staff CANNOT delete company vehicles');

  const r12 = engine.evaluate(userAlphaOwner, 'delete', `companies/${companyAlpha}/vehicles/veh_001`);
  assert(r12.allowed, 'Company Owner CAN delete company vehicles');

  console.log('\n--- SUITE 3: Audit Log Immutability ---');

  // Test 13: Member can record audit log
  const r13 = engine.evaluate(userAlphaOps, 'create', `companies/${companyAlpha}/auditLogs/log_002`, {
    id: 'log_002',
    companyId: companyAlpha,
    action: 'RECORD_FUEL_EXPENSE',
  });
  assert(r13.allowed, 'Company member can append to audit logs');

  // Test 14: Owner CANNOT update audit log (Immutability)
  const r14 = engine.evaluate(userAlphaOwner, 'update', `companies/${companyAlpha}/auditLogs/log_001`, {
    action: 'MODIFIED_ACTION',
  });
  assert(!r14.allowed, 'Owner CANNOT modify audit logs (Immutable constraint)');

  // Test 15: Owner CANNOT delete audit log (Immutability)
  const r15 = engine.evaluate(userAlphaOwner, 'delete', `companies/${companyAlpha}/auditLogs/log_001`);
  assert(!r15.allowed, 'Owner CANNOT delete audit logs (Immutable constraint)');

  console.log('\n--- SUITE 4: All 12 Collections Path Verification ---');

  const collections = [
    { name: 'vehicles', path: FirestorePaths.vehicles('test_comp') },
    { name: 'drivers', path: FirestorePaths.drivers('test_comp') },
    { name: 'customers', path: FirestorePaths.customers('test_comp') },
    { name: 'trips', path: FirestorePaths.trips('test_comp') },
    { name: 'expenses', path: FirestorePaths.expenses('test_comp') },
    { name: 'advances', path: FirestorePaths.advances('test_comp') },
    { name: 'settlements', path: FirestorePaths.settlements('test_comp') },
    { name: 'invoices', path: FirestorePaths.invoices('test_comp') },
    { name: 'payments', path: FirestorePaths.payments('test_comp') },
    { name: 'documents', path: FirestorePaths.documents('test_comp') },
    { name: 'maintenance', path: FirestorePaths.maintenance('test_comp') },
    { name: 'auditLogs', path: FirestorePaths.auditLogs('test_comp') },
  ];

  for (const col of collections) {
    const expected = `companies/test_comp/${col.name}`;
    assert(col.path === expected, `Collection path helper for '${col.name}' matches '${expected}'`);
  }

  console.log('\n===============================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase3RulesTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
