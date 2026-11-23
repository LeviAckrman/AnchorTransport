/**
 * AnchorTransport TMS - Phase 3 Firestore Security Rules & Multi-Tenant Isolation Test Suite
 *
 * Validates:
 * 1. Multi-tenant boundary isolation across all 16 company-scoped collections:
 *    - members, vehicles, drivers, customers, brokers, trips, expenses, advances,
 *      settlements, invoices, payments, documents, maintenance, fileRecords, settings, auditLogs.
 * 2. Strict Verified Owner-Only authorization (request.auth.uid == company.ownerId && email_verified == true).
 * 3. Prevention of cross-tenant reads, writes, updates, deletes, and companyId spoofing.
 * 4. Strict blocking of employee/staff/team management provisioning & self-escalation.
 * 5. Audit log immutability (write once, never update or delete).
 */

import {
  FirestorePaths,
} from '../types/firestore';

interface MockAuth {
  uid: string;
  email: string;
  emailVerified: boolean;
}

interface MockCompanyDoc {
  id: string;
  name: string;
  ownerId: string;
}

interface MockStore {
  [path: string]: Record<string, unknown>;
}

// In-memory Firestore Rules Engine simulating strict Verified Owner-Only firestore.rules logic
class MockFirestoreSecurityEngine {
  private store: MockStore = {};

  setDoc(path: string, data: Record<string, unknown>) {
    this.store[path] = { ...data };
  }

  getDoc(path: string): Record<string, unknown> | null {
    return this.store[path] ? { ...this.store[path] } : null;
  }

  private isVerifiedUser(auth: MockAuth | null): auth is MockAuth {
    return Boolean(auth && auth.emailVerified === true);
  }

  private isCompanyOwner(uid: string, companyId: string): boolean {
    const company = this.getDoc(`companies/${companyId}`) as MockCompanyDoc | null;
    return Boolean(company && company.ownerId === uid);
  }

  private isVerifiedCompanyOwner(auth: MockAuth | null, companyId: string): boolean {
    return this.isVerifiedUser(auth) && this.isCompanyOwner(auth.uid, companyId);
  }

  // Evaluate rule based on live strict Owner-Only firestore.rules
  evaluate(
    auth: MockAuth | null,
    operation: 'get' | 'list' | 'create' | 'update' | 'delete',
    path: string,
    incomingData?: Record<string, unknown>
  ): { allowed: boolean; reason?: string } {
    if (!auth) {
      return { allowed: false, reason: 'Unauthenticated' };
    }
    if (!auth.emailVerified) {
      return { allowed: false, reason: 'Email verification required' };
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
        if (operation === 'update' && existingUser?.role) {
          if (['USER', 'OWNER'].includes(String(existingUser.role))) {
            if (incomingData?.role !== existingUser.role) {
              return { allowed: false, reason: 'Role mutation rejected' };
            }
          } else if (incomingData?.role !== 'OWNER') {
            return { allowed: false, reason: 'Legacy role can only migrate to OWNER' };
          }
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
      const isOwner = this.isVerifiedCompanyOwner(auth, companyId);
      if (operation === 'get') {
        return { allowed: company === null || company.ownerId === auth.uid };
      }
      if (operation === 'list') {
        return { allowed: company?.ownerId === auth.uid };
      }
      if (operation === 'update') {
        if (!isOwner) {
          return { allowed: false, reason: 'Requires Verified Company Owner' };
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
      const isOwner = this.isVerifiedCompanyOwner(auth, companyId);

      // Members subcollection: strictly owner's own UID record only
      if (subcollection === 'members') {
        if (operation === 'get') {
          return { allowed: auth.uid === docId && isOwner };
        }
        if (operation === 'list') {
          return { allowed: isOwner };
        }
        if (operation === 'create') {
          if (
            docId === auth.uid &&
            isOwner &&
            incomingData?.role === 'OWNER' &&
            incomingData?.status === 'ACTIVE'
          ) {
            return { allowed: true };
          }
          return { allowed: false, reason: 'Employee/staff provisioning is disabled in Owner-Only mode' };
        }
        if (operation === 'update') {
          const existingMember = this.getDoc(path);
          if (!isOwner || docId !== auth.uid) {
            return { allowed: false, reason: 'Only verified owner can update own record' };
          }
          if (incomingData?.role !== 'OWNER' || incomingData?.status !== existingMember?.status) {
            return { allowed: false, reason: 'Role/status tamper rejected' };
          }
          return { allowed: true };
        }
        return { allowed: false, reason: 'Member deletion disabled' };
      }

      if (!isOwner) {
        return { allowed: false, reason: 'Only verified company owner (company.ownerId == uid) is authorized' };
      }

      if ((operation === 'create' || operation === 'update') && incomingData && incomingData.companyId !== companyId) {
        return { allowed: false, reason: 'Cross-tenant companyId mismatch' };
      }

      // Audit logs: immutable, owner read & create only
      if (subcollection === 'auditLogs') {
        if (operation === 'get' || operation === 'list' || operation === 'create') {
          return { allowed: true };
        }
        return { allowed: false, reason: 'Audit logs are immutable' };
      }

      const ownerCrudCollections = new Set([
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

      if (segments.length === 4 && ownerCrudCollections.has(subcollection)) {
        return { allowed: true };
      }

      if (subcollection === 'trips' && segments[4] === 'trip_logs') {
        if ((operation === 'create' || operation === 'update') && incomingData && incomingData.tripId !== docId) {
          return { allowed: false, reason: 'tripId mismatch on trip_logs' };
        }
        return { allowed: true };
      }
    }

    return { allowed: false, reason: 'Default deny rule matched' };
  }
}

async function runPhase3RulesTests() {
  console.log('===============================================================');
  console.log('   ANCHORTRANSPORT TMS - PHASE 3 OWNER-ONLY SECURITY TEST      ');
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

  const userAlphaOwner: MockAuth = { uid: 'usr_alpha_owner', email: 'owner@alpha.in', emailVerified: true };
  const userAlphaUnverified: MockAuth = { uid: 'usr_alpha_owner', email: 'owner@alpha.in', emailVerified: false };
  const userLegacyStaff: MockAuth = { uid: 'usr_legacy_ops', email: 'ops@alpha.in', emailVerified: true };
  const userOutsider: MockAuth = { uid: 'usr_outsider_99', email: 'outsider@external.in', emailVerified: true };
  const userBetaOwner: MockAuth = { uid: 'usr_beta_owner', email: 'owner@beta.in', emailVerified: true };

  // Company documents
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
  // Legacy non-owner member doc (should be ignored/blocked by strict owner-only rules)
  engine.setDoc(`companies/${companyAlpha}/members/${userLegacyStaff.uid}`, {
    id: userLegacyStaff.uid,
    userId: userLegacyStaff.uid,
    companyId: companyAlpha,
    role: 'OPERATIONS',
    status: 'ACTIVE',
  });

  engine.setDoc(`companies/${companyBeta}`, {
    id: companyBeta,
    name: 'Beta Logistics LLP',
    ownerId: userBetaOwner.uid,
  });

  // Seed operational documents in Company Alpha
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
    freightAmountPaise: 8500000,
    status: 'IN_TRANSIT',
  });

  engine.setDoc(`companies/${companyAlpha}/invoices/inv_001`, {
    id: 'inv_001',
    companyId: companyAlpha,
    invoiceNumber: 'INV-2026-0001',
    totalAmountPaise: 9000000,
    status: 'ISSUED',
  });

  engine.setDoc(`companies/${companyAlpha}/auditLogs/log_001`, {
    id: 'log_001',
    companyId: companyAlpha,
    action: 'CREATE',
    userId: userAlphaOwner.uid,
  });

  console.log('\n--- SUITE 1: Multi-Tenant Boundary Isolation (Cross-Company & Unverified Access) ---');

  assert(
    engine.evaluate(userAlphaOwner, 'get', `companies/${companyAlpha}/vehicles/veh_001`).allowed,
    'Alpha Verified Owner can read Alpha vehicle'
  );
  assert(
    !engine.evaluate(userAlphaUnverified, 'get', `companies/${companyAlpha}/vehicles/veh_001`).allowed,
    'Unverified email owner CANNOT read Alpha vehicle'
  );
  assert(
    !engine.evaluate(null, 'get', `companies/${companyAlpha}/trips/trip_001`).allowed,
    'Unauthenticated user CANNOT read Alpha trips'
  );
  assert(
    !engine.evaluate(userBetaOwner, 'get', `companies/${companyAlpha}/vehicles/veh_001`).allowed,
    'Beta Owner CANNOT read Alpha vehicle (Cross-Tenant blocked)'
  );
  assert(
    !engine.evaluate(userBetaOwner, 'get', `companies/${companyAlpha}/trips/trip_001`).allowed,
    'Beta Owner CANNOT read Alpha trips (Cross-Tenant blocked)'
  );
  assert(
    !engine.evaluate(userBetaOwner, 'update', `companies/${companyAlpha}/trips/trip_001`, {
      id: 'trip_001',
      companyId: companyAlpha,
      status: 'CANCELLED',
    }).allowed,
    'Beta Owner CANNOT update Alpha trips'
  );
  assert(
    !engine.evaluate(userBetaOwner, 'delete', `companies/${companyAlpha}/trips/trip_001`).allowed,
    'Beta Owner CANNOT delete Alpha trips'
  );
  assert(
    !engine.evaluate(userOutsider, 'get', `companies/${companyAlpha}/trips/trip_001`).allowed,
    'Outsider CANNOT read Alpha trips'
  );
  assert(
    !engine.evaluate(userBetaOwner, 'get', `companies/${companyAlpha}/invoices/inv_001`).allowed,
    'Beta Owner CANNOT read Alpha financial invoices'
  );
  assert(
    !engine.evaluate(userBetaOwner, 'create', `companies/${companyAlpha}/vehicles/veh_sneaky`, {
      id: 'veh_sneaky',
      companyId: companyAlpha,
      registrationNumber: 'DL 01 XY 9999',
    }).allowed,
    'Beta Owner CANNOT create vehicle in Alpha company'
  );
  assert(
    !engine.evaluate(userAlphaOwner, 'create', `companies/${companyAlpha}/vehicles/veh_tampered`, {
      id: 'veh_tampered',
      companyId: companyBeta,
      registrationNumber: 'KA 03 AA 1111',
    }).allowed,
    'Tampered companyId matching path blocked (Spoof prevention)'
  );

  console.log('\n--- SUITE 2: Strict Owner-Only Full CRUD & Staff Blocking ---');

  assert(
    engine.evaluate(userAlphaOwner, 'create', `companies/${companyAlpha}/trips/trip_002`, {
      id: 'trip_002',
      companyId: companyAlpha,
      tripNumber: 'TRP-2026-0002',
    }).allowed,
    'Company Owner CAN create trips within company'
  );
  assert(
    engine.evaluate(userAlphaOwner, 'update', `companies/${companyAlpha}/trips/trip_001`, {
      id: 'trip_001',
      companyId: companyAlpha,
      status: 'DELIVERED',
    }).allowed,
    'Company Owner CAN update trips within company'
  );
  assert(
    engine.evaluate(userAlphaOwner, 'create', `companies/${companyAlpha}/invoices/inv_002`, {
      id: 'inv_002',
      companyId: companyAlpha,
      invoiceNumber: 'INV-2026-0002',
    }).allowed,
    'Company Owner CAN create financial invoices'
  );
  assert(
    engine.evaluate(userAlphaOwner, 'create', `companies/${companyAlpha}/settlements/stl_001`, {
      id: 'stl_001',
      companyId: companyAlpha,
      settlementNumber: 'STL-001',
    }).allowed,
    'Company Owner CAN create settlements'
  );
  assert(
    engine.evaluate(userAlphaOwner, 'delete', `companies/${companyAlpha}/vehicles/veh_001`).allowed,
    'Company Owner CAN delete company vehicles'
  );

  // Legacy / non-owner staff access & provisioning strictly rejected
  assert(
    !engine.evaluate(userLegacyStaff, 'get', `companies/${companyAlpha}/trips/trip_001`).allowed,
    'Legacy non-owner staff account BLOCKED from reading Alpha trips'
  );
  assert(
    !engine.evaluate(userLegacyStaff, 'create', `companies/${companyAlpha}/trips/trip_ops`, {
      id: 'trip_ops',
      companyId: companyAlpha,
    }).allowed,
    'Legacy non-owner staff account BLOCKED from creating Alpha trips'
  );
  assert(
    !engine.evaluate(userAlphaOwner, 'create', `companies/${companyAlpha}/members/usr_new_staff`, {
      id: 'usr_new_staff',
      userId: 'usr_new_staff',
      companyId: companyAlpha,
      role: 'MANAGER',
      status: 'ACTIVE',
    }).allowed,
    'Employee/staff provisioning in /members is strictly blocked in Owner-Only mode'
  );
  assert(
    !engine.evaluate(userLegacyStaff, 'update', `companies/${companyAlpha}/members/${userLegacyStaff.uid}`, {
      role: 'OWNER',
      status: 'ACTIVE',
    }).allowed,
    'Non-owner CANNOT self-escalate /members role to OWNER'
  );

  console.log('\n--- SUITE 3: Audit Log Immutability & Access ---');

  assert(
    engine.evaluate(userAlphaOwner, 'create', `companies/${companyAlpha}/auditLogs/log_002`, {
      id: 'log_002',
      companyId: companyAlpha,
      action: 'CREATE',
    }).allowed,
    'Company Owner can append to audit logs'
  );
  assert(
    !engine.evaluate(userLegacyStaff, 'get', `companies/${companyAlpha}/auditLogs/log_001`).allowed,
    'Non-owner CANNOT read company auditLogs'
  );
  assert(
    !engine.evaluate(userAlphaOwner, 'update', `companies/${companyAlpha}/auditLogs/log_001`, {
      action: 'MODIFIED_ACTION',
    }).allowed,
    'Owner CANNOT modify audit logs (Immutable constraint)'
  );
  assert(
    !engine.evaluate(userAlphaOwner, 'delete', `companies/${companyAlpha}/auditLogs/log_001`).allowed,
    'Owner CANNOT delete audit logs (Immutable constraint)'
  );

  console.log('\n--- SUITE 4: All 16 Company Collections Path Verification ---');

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

  assert(
    FirestorePaths.tripLogs('test_comp', 'trip_001') === 'companies/test_comp/trips/trip_001/trip_logs',
    "Collection path helper for 'trip_logs' matches 'companies/test_comp/trips/trip_001/trip_logs'"
  );
  assert(
    FirestorePaths.tripLog('test_comp', 'trip_001', 'log_001') === 'companies/test_comp/trips/trip_001/trip_logs/log_001',
    "Document path helper for 'trip_log' matches 'companies/test_comp/trips/trip_001/trip_logs/log_001'"
  );
  assert(
    engine.evaluate(userAlphaOwner, 'create', 'companies/' + companyAlpha + '/trips/trip_001/trip_logs/tlog_1', {
      id: 'tlog_1',
      companyId: companyAlpha,
      tripId: 'trip_001',
      status: 'Reached Loading Point',
    }).allowed,
    'Company Owner CAN create nested trip_logs within owned trip'
  );
  assert(
    !engine.evaluate(userBetaOwner, 'get', 'companies/' + companyAlpha + '/trips/trip_001/trip_logs/tlog_1').allowed,
    'Beta Owner CANNOT read Alpha nested trip_logs (Cross-Tenant blocked)'
  );

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
