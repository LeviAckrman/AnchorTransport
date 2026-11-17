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

interface MockCompanyDoc {
  id: string;
  name: string;
  ownerId: string;
}

interface MockStore {
  [path: string]: Record<string, unknown>;
}

// In-memory Firestore Rules Engine simulating multi-tenant & RBAC firestore.rules logic
class MockFirestoreSecurityEngine {
  private store: MockStore = {};

  setDoc(path: string, data: Record<string, unknown>) {
    this.store[path] = { ...data };
  }

  getDoc(path: string): Record<string, unknown> | null {
    return this.store[path] ? { ...this.store[path] } : null;
  }

  private isCompanyOwner(uid: string, companyId: string): boolean {
    const company = this.getDoc(`companies/${companyId}`) as MockCompanyDoc | null;
    return Boolean(company && company.ownerId === uid);
  }

  private getActiveMemberRole(uid: string, companyId: string): FirestoreRole | null {
    if (this.isCompanyOwner(uid, companyId)) return 'OWNER';
    const member = this.getDoc(`companies/${companyId}/members/${uid}`) as {
      companyId?: string;
      userId?: string;
      role?: FirestoreRole;
      status?: string;
    } | null;
    if (
      member &&
      member.companyId === companyId &&
      member.userId === uid &&
      member.status === 'ACTIVE' &&
      member.role
    ) {
      return member.role;
    }
    return null;
  }

  // Evaluate rule based on live Multi-Tenant RBAC firestore.rules
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
        if (auth.uid !== targetUserId) return { allowed: false, reason: 'UID mismatch' };
        const existingUser = this.getDoc(path);
        if (operation === 'create' && incomingData?.role && !['USER', 'OWNER'].includes(String(incomingData.role))) {
          return { allowed: false, reason: 'Self-assigned privileged role rejected' };
        }
        if (operation === 'update' && existingUser?.role && incomingData?.role !== existingUser.role) {
          return { allowed: false, reason: 'Role self-escalation rejected' };
        }
        return { allowed: true };
      }
      return { allowed: false, reason: 'Deletes disabled for users' };
    }

    // Company root document: /companies/{companyId}
    if (segments[0] === 'companies' && segments.length === 2) {
      const companyId = segments[1];
      const company = this.getDoc(`companies/${companyId}`) as MockCompanyDoc | null;
      if (operation === 'create') {
        if (incomingData?.ownerId !== auth.uid) {
          return { allowed: false, reason: 'Owner ID must match authenticated UID' };
        }
        return { allowed: true };
      }
      const role = this.getActiveMemberRole(auth.uid, companyId);
      if (operation === 'get') {
        return { allowed: company === null || role !== null };
      }
      if (operation === 'update') {
        if (!role || !['OWNER', 'ADMIN'].includes(role)) {
          return { allowed: false, reason: 'Requires OWNER or ADMIN' };
        }
        if (company && incomingData?.ownerId !== undefined && incomingData.ownerId !== company.ownerId) {
          return { allowed: false, reason: 'ownerId is immutable' };
        }
        return { allowed: true };
      }
      return { allowed: false, reason: 'Company deletion disabled' };
    }

    // Company subcollections: /companies/{companyId}/{subcollection}/{docId}
    if (segments[0] === 'companies' && segments.length >= 3) {
      const companyId = segments[1];
      const subcollection = segments[2];
      const docId = segments[3];
      const role = this.getActiveMemberRole(auth.uid, companyId);

      // Members subcollection: /companies/{companyId}/members/{memberUid}
      if (subcollection === 'members') {
        if (operation === 'get') {
          return { allowed: auth.uid === docId || role !== null };
        }
        if (operation === 'list') {
          return { allowed: role !== null };
        }
        if (operation === 'create') {
          const isOwner = this.isCompanyOwner(auth.uid, companyId);
          if (docId === auth.uid && isOwner && incomingData?.role === 'OWNER') {
            return { allowed: true };
          }
          if (docId !== auth.uid && isOwner && ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'].includes(String(incomingData?.role))) {
            return { allowed: true };
          }
          if (docId !== auth.uid && role === 'ADMIN' && ['MANAGER', 'ACCOUNTANT', 'OPERATIONS'].includes(String(incomingData?.role))) {
            return { allowed: true };
          }
          return { allowed: false, reason: 'Member creation/self-promotion denied' };
        }
        if (operation === 'update') {
          const existingMember = this.getDoc(path);
          if (docId === auth.uid) {
            if (incomingData?.role !== existingMember?.role || incomingData?.status !== existingMember?.status) {
              return { allowed: false, reason: 'Self role/status escalation denied' };
            }
            return { allowed: true };
          }
          if (this.isCompanyOwner(auth.uid, companyId) && existingMember?.role !== 'OWNER') {
            return { allowed: ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'].includes(String(incomingData?.role)) };
          }
          return { allowed: false, reason: 'Insufficient role to update member' };
        }
        if (operation === 'delete') {
          const existingMember = this.getDoc(path);
          if (docId === auth.uid || existingMember?.role === 'OWNER') {
            return { allowed: false, reason: 'Cannot delete OWNER or self' };
          }
          return { allowed: this.isCompanyOwner(auth.uid, companyId) || role === 'ADMIN' };
        }
      }

      if (!role) {
        return { allowed: false, reason: 'Not an active member or owner of this company' };
      }

      if ((operation === 'create' || operation === 'update') && incomingData && incomingData.companyId !== companyId) {
        return { allowed: false, reason: 'Cross-tenant companyId mismatch' };
      }

      // Audit logs: immutable, read restricted to OWNER/ADMIN/ACCOUNTANT
      if (subcollection === 'auditLogs') {
        if (operation === 'get' || operation === 'list') {
          return { allowed: ['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(role) };
        }
        if (operation === 'create') {
          return { allowed: true };
        }
        return { allowed: false, reason: 'Audit logs are immutable' };
      }

      // RBAC matrices matching firestore.rules
      const rbacWriteMap: Record<string, { createUpdate: FirestoreRole[]; delete: FirestoreRole[] }> = {
        vehicles: { createUpdate: ['OWNER', 'ADMIN', 'MANAGER', 'OPERATIONS'], delete: ['OWNER', 'ADMIN'] },
        drivers: { createUpdate: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'], delete: ['OWNER', 'ADMIN'] },
        customers: { createUpdate: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT'], delete: ['OWNER', 'ADMIN'] },
        brokers: { createUpdate: ['OWNER', 'ADMIN', 'MANAGER'], delete: ['OWNER', 'ADMIN'] },
        trips: { createUpdate: ['OWNER', 'ADMIN', 'MANAGER', 'OPERATIONS'], delete: ['OWNER', 'ADMIN', 'MANAGER'] },
        expenses: { createUpdate: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'], delete: ['OWNER', 'ADMIN', 'MANAGER'] },
        advances: { createUpdate: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT'], delete: ['OWNER', 'ADMIN'] },
        settlements: { createUpdate: ['OWNER', 'ADMIN', 'ACCOUNTANT'], delete: ['OWNER', 'ADMIN'] },
        invoices: { createUpdate: ['OWNER', 'ADMIN', 'ACCOUNTANT'], delete: ['OWNER', 'ADMIN'] },
        payments: { createUpdate: ['OWNER', 'ADMIN', 'ACCOUNTANT'], delete: ['OWNER', 'ADMIN'] },
        documents: { createUpdate: ['OWNER', 'ADMIN', 'MANAGER'], delete: ['OWNER', 'ADMIN'] },
        maintenance: { createUpdate: ['OWNER', 'ADMIN', 'MANAGER'], delete: ['OWNER', 'ADMIN'] },
        fileRecords: {
          createUpdate: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'],
          delete: ['OWNER', 'ADMIN'],
        },
        settings: { createUpdate: ['OWNER', 'ADMIN'], delete: ['OWNER'] },
      };

      const rule = rbacWriteMap[subcollection];
      if (rule) {
        if (operation === 'get' || operation === 'list') {
          return { allowed: true };
        }
        if (operation === 'create') {
          return { allowed: rule.createUpdate.includes(role) };
        }
        if (operation === 'update') {
          const allowedRoles =
            subcollection === 'trips'
              ? (['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'] as FirestoreRole[])
              : rule.createUpdate;
          return { allowed: allowedRoles.includes(role) };
        }
        if (operation === 'delete') {
          return { allowed: rule.delete.includes(role) };
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
  const userAlphaAcc: MockAuth = { uid: 'usr_alpha_acc', email: 'acc@alpha.in' };
  const userOutsider: MockAuth = { uid: 'usr_outsider_99', email: 'outsider@external.in' };
  const userBetaOwner: MockAuth = { uid: 'usr_beta_owner', email: 'owner@beta.in' };

  // Set company owner documents + active RBAC member records
  engine.setDoc(`companies/${companyAlpha}`, {
    id: companyAlpha,
    name: 'Alpha Roadlines Pvt Ltd',
    ownerId: userAlphaOwner.uid,
  });
  engine.setDoc(`companies/${companyAlpha}/members/${userAlphaOwner.uid}`, {
    id: userAlphaOwner.uid,
    userId: userAlphaOwner.uid,
    companyId: companyAlpha,
    role: 'OWNER',
    status: 'ACTIVE',
  });
  engine.setDoc(`companies/${companyAlpha}/members/${userAlphaOps.uid}`, {
    id: userAlphaOps.uid,
    userId: userAlphaOps.uid,
    companyId: companyAlpha,
    role: 'OPERATIONS',
    status: 'ACTIVE',
  });
  engine.setDoc(`companies/${companyAlpha}/members/${userAlphaAcc.uid}`, {
    id: userAlphaAcc.uid,
    userId: userAlphaAcc.uid,
    companyId: companyAlpha,
    role: 'ACCOUNTANT',
    status: 'ACTIVE',
  });

  engine.setDoc(`companies/${companyBeta}`, {
    id: companyBeta,
    name: 'Beta Logistics LLP',
    ownerId: userBetaOwner.uid,
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

  // Test 3: Outsider CANNOT read Alpha trips
  const r3 = engine.evaluate(userOutsider, 'get', `companies/${companyAlpha}/trips/trip_001`);
  assert(!r3.allowed, 'Non-member outsider CANNOT read Alpha trips');

  // Test 4: User Beta Owner CANNOT read Alpha invoices
  const r4 = engine.evaluate(userBetaOwner, 'get', `companies/${companyAlpha}/invoices/inv_001`);
  assert(!r4.allowed, 'Beta Owner CANNOT read Alpha financial invoices');

  // Test 5: User Beta Owner CANNOT write vehicle to Alpha company
  const r5 = engine.evaluate(userBetaOwner, 'create', `companies/${companyAlpha}/vehicles/veh_sneaky`, {
    id: 'veh_sneaky',
    companyId: companyAlpha,
    registrationNumber: 'DL 01 XY 9999',
  });
  assert(!r5.allowed, 'Beta Owner CANNOT create vehicle in Alpha company');

  // Test 6: Tenant injection check - Alpha Owner creating doc with Beta companyId
  const r6 = engine.evaluate(userAlphaOwner, 'create', `companies/${companyAlpha}/vehicles/veh_tampered`, {
    id: 'veh_tampered',
    companyId: companyBeta, // Spoofed companyId
    registrationNumber: 'KA 03 AA 1111',
  });
  assert(!r6.allowed, 'Tampered companyId matching path blocked (Spoof prevention)');

  console.log('\n--- SUITE 2: Multi-Tenant RBAC, /members Governance & Anti-Self-Escalation ---');

  // Test 7: Alpha Owner CAN create trips, invoices, settlements, brokers, and settings in Alpha company
  const r7 = engine.evaluate(userAlphaOwner, 'create', `companies/${companyAlpha}/trips/trip_002`, {
    id: 'trip_002',
    companyId: companyAlpha,
    tripNumber: 'TRP-2026-0002',
  });
  assert(r7.allowed, 'Company Owner CAN create trips within company');

  const r8 = engine.evaluate(userAlphaOwner, 'create', `companies/${companyAlpha}/invoices/inv_002`, {
    id: 'inv_002',
    companyId: companyAlpha,
    invoiceNumber: 'INV-2026-0002',
  });
  assert(r8.allowed, 'Company Owner CAN create financial invoices');

  const r9 = engine.evaluate(userAlphaOwner, 'create', `companies/${companyAlpha}/settlements/stl_001`, {
    id: 'stl_001',
    companyId: companyAlpha,
    settlementNumber: 'STL-001',
  });
  assert(r9.allowed, 'Company Owner CAN create settlements');

  // Test 10: RBAC enforcement - OPERATIONS can create trips but CANNOT create invoices/settings or delete vehicles
  const r10a = engine.evaluate(userAlphaOps, 'create', `companies/${companyAlpha}/trips/trip_003`, {
    id: 'trip_003',
    companyId: companyAlpha,
    tripNumber: 'TRP-2026-0003',
  });
  assert(r10a.allowed, 'Active OPERATIONS member CAN create trips in own company');

  const r10b = engine.evaluate(userAlphaOps, 'create', `companies/${companyAlpha}/invoices/inv_ops`, {
    id: 'inv_ops',
    companyId: companyAlpha,
    invoiceNumber: 'INV-OPS',
  });
  assert(!r10b.allowed, 'Active OPERATIONS member CANNOT create financial invoices');

  const r10c = engine.evaluate(userAlphaAcc, 'create', `companies/${companyAlpha}/invoices/inv_acc`, {
    id: 'inv_acc',
    companyId: companyAlpha,
    invoiceNumber: 'INV-ACC',
  });
  assert(r10c.allowed, 'Active ACCOUNTANT member CAN create financial invoices');

  // Test 10d: Owner can invite staff to /members, staff CANNOT self-promote role in /members
  const r10d = engine.evaluate(userAlphaOwner, 'create', `companies/${companyAlpha}/members/usr_new_mgr`, {
    id: 'usr_new_mgr',
    userId: 'usr_new_mgr',
    companyId: companyAlpha,
    role: 'MANAGER',
    status: 'ACTIVE',
  });
  assert(r10d.allowed, 'Company Owner CAN provision MANAGER/STAFF in /members');

  const r10e = engine.evaluate(userAlphaOps, 'update', `companies/${companyAlpha}/members/${userAlphaOps.uid}`, {
    role: 'OWNER',
    status: 'ACTIVE',
  });
  assert(!r10e.allowed, 'Staff member CANNOT self-escalate /members role to OWNER');

  // Test 11: Non-owner / OPERATIONS cannot delete company vehicle; Owner CAN
  const r11 = engine.evaluate(userOutsider, 'delete', `companies/${companyAlpha}/vehicles/veh_001`);
  assert(!r11.allowed, 'Non-member outsider CANNOT delete company vehicles');

  const r11b = engine.evaluate(userAlphaOps, 'delete', `companies/${companyAlpha}/vehicles/veh_001`);
  assert(!r11b.allowed, 'OPERATIONS member CANNOT delete company vehicles');

  const r12 = engine.evaluate(userAlphaOwner, 'delete', `companies/${companyAlpha}/vehicles/veh_001`);
  assert(r12.allowed, 'Company Owner CAN delete company vehicles');

  console.log('\n--- SUITE 3: Audit Log Immutability & Access ---');

  // Test 13: Owner can record audit log
  const r13 = engine.evaluate(userAlphaOwner, 'create', `companies/${companyAlpha}/auditLogs/log_002`, {
    id: 'log_002',
    companyId: companyAlpha,
    action: 'RECORD_FUEL_EXPENSE',
  });
  assert(r13.allowed, 'Company Owner can append to audit logs');

  const r13b = engine.evaluate(userAlphaOps, 'get', `companies/${companyAlpha}/auditLogs/log_001`);
  assert(!r13b.allowed, 'OPERATIONS member CANNOT read company auditLogs');

  // Test 14: Owner CANNOT update audit log (Immutability)
  const r14 = engine.evaluate(userAlphaOwner, 'update', `companies/${companyAlpha}/auditLogs/log_001`, {
    action: 'MODIFIED_ACTION',
  });
  assert(!r14.allowed, 'Owner CANNOT modify audit logs (Immutable constraint)');

  // Test 15: Owner CANNOT delete audit log (Immutability)
  const r15 = engine.evaluate(userAlphaOwner, 'delete', `companies/${companyAlpha}/auditLogs/log_001`);
  assert(!r15.allowed, 'Owner CANNOT delete audit logs (Immutable constraint)');

  console.log('\n--- SUITE 4: All 15 Company Collections Path Verification ---');

  const collections = [
    { name: 'members', path: FirestorePaths.members('test_comp') },
    { name: 'vehicles', path: FirestorePaths.vehicles('test_comp') },
    { name: 'drivers', path: FirestorePaths.drivers('test_comp') },
    { name: 'customers', path: FirestorePaths.customers('test_comp') },
    { name: 'brokers', path: FirestorePaths.brokers('test_comp') },
    { name: 'trips', path: FirestorePaths.trips('test_comp') },
    { name: 'expenses', path: FirestorePaths.expenses('test_comp') },
    { name: 'advances', path: FirestorePaths.advances('test_comp') },
    { name: 'settlements', path: FirestorePaths.settlements('test_comp') },
    { name: 'invoices', path: FirestorePaths.invoices('test_comp') },
    { name: 'payments', path: FirestorePaths.payments('test_comp') },
    { name: 'documents', path: FirestorePaths.documents('test_comp') },
    { name: 'maintenance', path: FirestorePaths.maintenance('test_comp') },
    { name: 'fileRecords', path: FirestorePaths.fileRecords('test_comp') },
    { name: 'settings', path: FirestorePaths.settings('test_comp') },
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
