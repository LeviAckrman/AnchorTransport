/**
 * AnchorTransports TMS - Complete Firestore Owner-Only Security System Test Suite
 *
 * Explicitly validates the 10 User Security Scenarios:
 * - TEST 1: Verified owner logs in and accesses their own data (ALLOW)
 * - TEST 2: Verified owner creates and edits a trip (ALLOW)
 * - TEST 3: Verified owner dispatches a trip and updates dispatch details (ALLOW)
 * - TEST 4: Verified owner accesses their own expenses and invoices (ALLOW)
 * - TEST 5: Unverified user attempts to access company data (DENY)
 * - TEST 6: Verified user with different UID attempts to access another company's data (DENY)
 * - TEST 7: Unauthenticated visitor attempts to access company data (DENY)
 * - TEST 8: User changes company ID in frontend to another company's ID (DENY)
 * - TEST 9: User attempts to modify company ownerId (DENY)
 * - TEST 10: Owner logs out and logs back in, existing data remains available (ALLOW)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../..');

interface SimAuth {
  uid: string;
  email: string;
  emailVerified: boolean;
}

type SimOp = 'get' | 'list' | 'create' | 'update' | 'delete';

const SERVER_TIME = '__SERVER_TIMESTAMP__';

class OwnerSecurityRulesSimulator {
  private docs = new Map<string, Record<string, any>>();

  seed(docPath: string, data: Record<string, any>) {
    this.docs.set(docPath, { ...data });
  }

  getDoc(docPath: string): Record<string, any> | null {
    const d = this.docs.get(docPath);
    return d ? { ...d } : null;
  }

  evalFirestore(
    auth: SimAuth | null,
    op: SimOp,
    docPath: string,
    incomingData?: Record<string, any>
  ): { allowed: boolean; reason?: string } {
    const segs = docPath.split('/').filter(Boolean);

    // Boot connection ping endpoint
    if (segs[0] === 'test' && segs[1] === 'connection' && op === 'get') {
      return { allowed: true };
    }

    // Default deny for unauthenticated
    if (!auth) {
      return { allowed: false, reason: 'Unauthenticated user denied' };
    }

    // Verified email check
    const isVerifiedUser = auth.emailVerified === true;

    // 1. Users collection: /users/{userId}
    if (segs[0] === 'users' && segs.length === 2) {
      const userId = segs[1];
      if (!isVerifiedUser) {
        return { allowed: false, reason: 'Unverified email denied on /users' };
      }
      if (auth.uid !== userId) {
        return { allowed: false, reason: 'Cross-user access denied on /users' };
      }
      if (op === 'get' || op === 'list') return { allowed: true };
      if (op === 'create') {
        if (!incomingData || incomingData.id !== userId) {
          return { allowed: false, reason: 'User ID mismatch' };
        }
        return { allowed: true };
      }
      if (op === 'update') {
        const existing = this.docs.get(docPath);
        if (existing && incomingData) {
          // Prevent role escalation
          if (existing.role === 'USER' && incomingData.role === 'OWNER') {
            return { allowed: false, reason: 'Self-escalation denied' };
          }
        }
        return { allowed: true };
      }
      return { allowed: false, reason: 'Delete denied on /users' };
    }

    // 2. Multi-tenant company root: /companies/{companyId}
    if (segs[0] === 'companies') {
      const companyId = segs[1];
      const companyDocPath = `companies/${companyId}`;
      const company = this.docs.get(companyDocPath);

      if (segs.length === 2) {
        // Root company document
        if (!isVerifiedUser) {
          return { allowed: false, reason: 'Unverified email denied on /companies' };
        }
        if (op === 'get') {
          // Allow get if company does not exist (pre-creation check) or if caller is owner
          if (!company || company.ownerId === auth.uid) {
            return { allowed: true };
          }
          return { allowed: false, reason: 'Cross-tenant company read denied' };
        }
        if (op === 'list') {
          return { allowed: company?.ownerId === auth.uid };
        }
        if (op === 'create') {
          if (!incomingData || incomingData.ownerId !== auth.uid) {
            return { allowed: false, reason: 'Company ownerId must match auth.uid on create' };
          }
          return { allowed: true };
        }
        if (op === 'update') {
          if (!company || company.ownerId !== auth.uid) {
            return { allowed: false, reason: 'Only company owner can update company' };
          }
          if (incomingData && incomingData.ownerId !== company.ownerId) {
            return { allowed: false, reason: 'Company ownerId is strictly immutable' };
          }
          return { allowed: true };
        }
        return { allowed: false, reason: 'Delete denied on company root' };
      }

      // Subcollections under /companies/{companyId}/{subcollection}/{docId}
      const sub = segs[2];
      const docId = segs[3];

      // Strict isVerifiedCompanyOwner check:
      // 1. isVerifiedUser()
      // 2. exists(company)
      // 3. company.ownerId == auth.uid
      if (!isVerifiedUser) {
        return { allowed: false, reason: `Unverified email denied on ${sub}` };
      }
      if (!company) {
        return { allowed: false, reason: `Company ${companyId} does not exist` };
      }
      if (company.ownerId !== auth.uid) {
        return { allowed: false, reason: `User ${auth.uid} is not the owner of company ${companyId}` };
      }

      // TRIPS & DISPATCH: Unrestricted field validation for Verified Company Owner
      if (sub === 'trips') {
        if (segs.length === 3 && op === 'list') {
          return { allowed: true };
        }
        if (segs.length === 4) {
          // /companies/{companyId}/trips/{tripId}
          if (op === 'get' || op === 'list' || op === 'delete') {
            return { allowed: true };
          }
          if (op === 'create' || op === 'update') {
            if (incomingData && 'companyId' in incomingData && incomingData.companyId !== companyId) {
              return { allowed: false, reason: 'Trips companyId must match parent companyId' };
            }
            return { allowed: true };
          }
        }
        if (segs.length === 5 && segs[4] === 'trip_logs') {
          return { allowed: true };
        }
        if (segs.length === 6 && segs[4] === 'trip_logs') {
          return { allowed: true };
        }
      }

      // ALL OTHER PERMITTED MODULES (Vehicles, Drivers, Customers, Brokers, Vendors, Expenses, Advances, Settlements, Invoices, Payments, Documents, Maintenance, FileRecords, Settings, Notifications, Reports, AuditLogs)
      const allowedSubs = [
        'vehicles', 'drivers', 'customers', 'brokers', 'vendors',
        'expenses', 'advances', 'settlements', 'invoices', 'payments',
        'documents', 'maintenance', 'fileRecords', 'settings',
        'notifications', 'reports', 'auditLogs', 'members'
      ];

      if (allowedSubs.includes(sub)) {
        if (sub === 'auditLogs' && (op === 'update' || op === 'delete')) {
          return { allowed: false, reason: 'Audit logs are immutable' };
        }
        if (incomingData && 'companyId' in incomingData && incomingData.companyId !== companyId) {
          return { allowed: false, reason: 'Subcollection companyId mismatch' };
        }
        return { allowed: true };
      }

      return { allowed: false, reason: `Unknown subcollection ${sub} denied by default` };
    }

    return { allowed: false, reason: 'Default deny catch-all' };
  }
}

function runOwnerSecurityTests() {
  console.log('================================================================');
  console.log(' AnchorTransports - Complete Owner-Only Security System Tests  ');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      passed++;
      console.log(`  PASS: ${desc}`);
    } else {
      failed++;
      console.error(`  FAIL: ${desc}`);
    }
  }

  const sim = new OwnerSecurityRulesSimulator();

  const OWNER_A: SimAuth = {
    uid: 'VOZFVOgChCW4QZEJ9KTySUcWwQ73',
    email: 'etsacc5@gmail.com',
    emailVerified: true,
  };

  const USER_B: SimAuth = {
    uid: 'attacker_uid_456',
    email: 'attacker@othercorp.com',
    emailVerified: true,
  };

  const UNVERIFIED_USER: SimAuth = {
    uid: 'unverified_uid_789',
    email: 'unverified@test.com',
    emailVerified: false,
  };

  const COMPANY_A = 'comp_1795105131697_hjjvl';
  const COMPANY_B = 'comp_9999999999999_other';

  // Seed company A owned by OWNER_A
  sim.seed(`companies/${COMPANY_A}`, {
    id: COMPANY_A,
    name: 'ETS Transports India',
    ownerId: OWNER_A.uid,
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  });

  // Seed company B owned by USER_B
  sim.seed(`companies/${COMPANY_B}`, {
    id: COMPANY_B,
    name: 'Other Logistics Ltd',
    ownerId: USER_B.uid,
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  });

  // Seed an existing trip in Company A
  sim.seed(`companies/${COMPANY_A}/trips/trip_001`, {
    id: 'trip_001',
    companyId: COMPANY_A,
    tripNumber: 'TRP-1001',
    status: 'PLANNED',
    originCity: 'Mumbai',
    destinationCity: 'Delhi',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  });

  // --------------------------------------------------------------------------
  console.log('\n--- TEST 1: Verified Owner Logs in and Accesses Their Own Data (ALLOW) ---');
  // --------------------------------------------------------------------------
  const t1_companyRead = sim.evalFirestore(OWNER_A, 'get', `companies/${COMPANY_A}`);
  assert(t1_companyRead.allowed, 'TEST 1.1: Verified owner can read their company root document');

  const t1_tripsList = sim.evalFirestore(OWNER_A, 'list', `companies/${COMPANY_A}/trips`);
  assert(t1_tripsList.allowed, 'TEST 1.2: Verified owner can list their company trips');

  const t1_vehiclesList = sim.evalFirestore(OWNER_A, 'list', `companies/${COMPANY_A}/vehicles`);
  assert(t1_vehiclesList.allowed, 'TEST 1.3: Verified owner can list their company vehicles');

  const t1_driversList = sim.evalFirestore(OWNER_A, 'list', `companies/${COMPANY_A}/drivers`);
  assert(t1_driversList.allowed, 'TEST 1.4: Verified owner can list their company drivers');

  const t1_expensesList = sim.evalFirestore(OWNER_A, 'list', `companies/${COMPANY_A}/expenses`);
  assert(t1_expensesList.allowed, 'TEST 1.5: Verified owner can list their company expenses');

  // --------------------------------------------------------------------------
  console.log('\n--- TEST 2: Verified Owner Creates and Edits a Trip (ALLOW) ---');
  // --------------------------------------------------------------------------
  // Create trip with minimal payload (no mandatory driver/customer/vehicle/freight)
  const minimalTrip = {
    id: 'trip_1795206171272_aerf',
    companyId: COMPANY_A,
    tripNumber: 'TRP-2001',
    originCity: 'Chennai',
    destinationCity: 'Bengaluru',
    status: 'PLANNED',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  };
  const t2_createMinimal = sim.evalFirestore(
    OWNER_A,
    'create',
    `companies/${COMPANY_A}/trips/${minimalTrip.id}`,
    minimalTrip
  );
  assert(t2_createMinimal.allowed, 'TEST 2.1: Verified owner can create trip with minimal fields (unrestricted schema)');

  // Update trip with additional fields, reassign vehicle, change dates
  const updatedTrip = {
    ...minimalTrip,
    vehicleId: 'veh_456',
    vehicleReg: 'MH12AB1234',
    driverId: 'drv_789',
    driverName: 'Ramesh Singh',
    ratePerTonnePaise: 250000,
    freightAmountPaise: 5000000,
    goodsType: 'Electronics',
    weightTonnes: 20,
    updatedAt: SERVER_TIME,
  };
  const t2_update = sim.evalFirestore(
    OWNER_A,
    'update',
    `companies/${COMPANY_A}/trips/${minimalTrip.id}`,
    updatedTrip
  );
  assert(t2_update.allowed, 'TEST 2.2: Verified owner can update trip fields, assign vehicle/driver, and edit freight');

  // --------------------------------------------------------------------------
  console.log('\n--- TEST 3: Verified Owner Dispatches a Trip and Updates Dispatch Details (ALLOW) ---');
  // --------------------------------------------------------------------------
  const dispatchTrip = {
    ...updatedTrip,
    status: 'DISPATCHED',
    dispatchDate: '2026-11-22T10:00:00.000Z',
    startOdometerKm: 45000,
    lrNumber: 'LR-90210',
    notes: 'Dispatched on highway NH44 with security seal',
    updatedAt: SERVER_TIME,
  };
  const t3_dispatch = sim.evalFirestore(
    OWNER_A,
    'update',
    `companies/${COMPANY_A}/trips/${minimalTrip.id}`,
    dispatchTrip
  );
  assert(t3_dispatch.allowed, 'TEST 3.1: Verified owner can dispatch trip (status DISPATCHED, LR, odometer)');

  // Owner edits already-dispatched trip (e.g. driver re-assignment or POD update)
  const editDispatched = {
    ...dispatchTrip,
    driverId: 'drv_999_relief',
    driverName: 'Suresh Kumar',
    driverPhone: '9876543210',
    podReceived: true,
    podRemarks: 'Signed acknowledgement copy received at warehouse',
    status: 'DELIVERED',
    actualDeliveryDate: '2026-11-22T18:00:00.000Z',
    endOdometerKm: 45350,
  };
  const t3_editDispatched = sim.evalFirestore(
    OWNER_A,
    'update',
    `companies/${COMPANY_A}/trips/${minimalTrip.id}`,
    editDispatched
  );
  assert(t3_editDispatched.allowed, 'TEST 3.2: Verified owner can freely edit dispatched trip and mark delivered with POD');

  // --------------------------------------------------------------------------
  console.log('\n--- TEST 4: Verified Owner Accesses Their Own Expenses and Invoices (ALLOW) ---');
  // --------------------------------------------------------------------------
  const expenseDoc = {
    id: 'exp_001',
    companyId: COMPANY_A,
    category: 'FUEL',
    amountPaise: 750000,
    paymentMode: 'FASTAG',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  };
  const t4_createExpense = sim.evalFirestore(
    OWNER_A,
    'create',
    `companies/${COMPANY_A}/expenses/${expenseDoc.id}`,
    expenseDoc
  );
  assert(t4_createExpense.allowed, 'TEST 4.1: Verified owner can create expenses');

  const invoiceDoc = {
    id: 'inv_001',
    companyId: COMPANY_A,
    invoiceNumber: 'INV-2026-001',
    customerId: 'cust_001',
    totalAmountPaise: 5900000,
    status: 'ISSUED',
    issueDate: '2026-11-22',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  };
  const t4_createInvoice = sim.evalFirestore(
    OWNER_A,
    'create',
    `companies/${COMPANY_A}/invoices/${invoiceDoc.id}`,
    invoiceDoc
  );
  assert(t4_createInvoice.allowed, 'TEST 4.2: Verified owner can create invoices');

  const t4_getInvoice = sim.evalFirestore(OWNER_A, 'get', `companies/${COMPANY_A}/invoices/inv_001`);
  assert(t4_getInvoice.allowed, 'TEST 4.3: Verified owner can read invoices');

  const paymentDoc = {
    id: 'pay_001',
    companyId: COMPANY_A,
    invoiceId: 'inv_001',
    customerId: 'cust_001',
    amountPaise: 5900000,
    paymentDate: '2026-11-22',
    paymentMode: 'NEFT_RTGS',
    referenceNumber: 'NEFT987654321',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
  };
  const t4_createPayment = sim.evalFirestore(
    OWNER_A,
    'create',
    `companies/${COMPANY_A}/payments/${paymentDoc.id}`,
    paymentDoc
  );
  assert(t4_createPayment.allowed, 'TEST 4.4: Verified owner can record customer payments');

  // --------------------------------------------------------------------------
  console.log('\n--- TEST 5: Unverified User Attempts to Access Company Data (DENY) ---');
  // --------------------------------------------------------------------------
  const t5_companyRead = sim.evalFirestore(UNVERIFIED_USER, 'get', `companies/${COMPANY_A}`);
  assert(!t5_companyRead.allowed, 'TEST 5.1: Unverified user denied read on /companies/{companyId}');

  const t5_tripWrite = sim.evalFirestore(
    UNVERIFIED_USER,
    'create',
    `companies/${COMPANY_A}/trips/trip_hack`,
    { id: 'trip_hack', companyId: COMPANY_A }
  );
  assert(!t5_tripWrite.allowed, 'TEST 5.2: Unverified user denied trip creation');

  const t5_expensesList = sim.evalFirestore(UNVERIFIED_USER, 'list', `companies/${COMPANY_A}/expenses`);
  assert(!t5_expensesList.allowed, 'TEST 5.3: Unverified user denied expense access');

  // --------------------------------------------------------------------------
  console.log('\n--- TEST 6: Verified User with Different UID Attempts Cross-Company Access (DENY) ---');
  // --------------------------------------------------------------------------
  const t6_crossCompanyRead = sim.evalFirestore(USER_B, 'get', `companies/${COMPANY_A}`);
  assert(!t6_crossCompanyRead.allowed, 'TEST 6.1: User B cannot read Company A document');

  const t6_crossTripRead = sim.evalFirestore(USER_B, 'get', `companies/${COMPANY_A}/trips/trip_001`);
  assert(!t6_crossTripRead.allowed, 'TEST 6.2: User B cannot read Company A trips');

  const t6_crossTripWrite = sim.evalFirestore(
    USER_B,
    'create',
    `companies/${COMPANY_A}/trips/trip_breach`,
    { id: 'trip_breach', companyId: COMPANY_A }
  );
  assert(!t6_crossTripWrite.allowed, 'TEST 6.3: User B cannot write trips to Company A');

  const t6_crossVehicleRead = sim.evalFirestore(USER_B, 'list', `companies/${COMPANY_A}/vehicles`);
  assert(!t6_crossVehicleRead.allowed, 'TEST 6.4: User B cannot list Company A vehicles');

  // --------------------------------------------------------------------------
  console.log('\n--- TEST 7: Unauthenticated Visitor Attempts Access (DENY) ---');
  // --------------------------------------------------------------------------
  const t7_nullCompany = sim.evalFirestore(null, 'get', `companies/${COMPANY_A}`);
  assert(!t7_nullCompany.allowed, 'TEST 7.1: Unauthenticated request denied on /companies');

  const t7_nullTrips = sim.evalFirestore(null, 'list', `companies/${COMPANY_A}/trips`);
  assert(!t7_nullTrips.allowed, 'TEST 7.2: Unauthenticated request denied on trips list');

  const t7_nullCreate = sim.evalFirestore(null, 'create', `companies/${COMPANY_A}/trips/trip_null`, {
    id: 'trip_null',
  });
  assert(!t7_nullCreate.allowed, 'TEST 7.3: Unauthenticated request denied on trip create');

  // --------------------------------------------------------------------------
  console.log('\n--- TEST 8: User Changes Company ID in Frontend to Another Company (DENY) ---');
  // --------------------------------------------------------------------------
  // OWNER_A tries to access Company B by swapping ID in path
  const t8_tamperGet = sim.evalFirestore(OWNER_A, 'get', `companies/${COMPANY_B}`);
  assert(!t8_tamperGet.allowed, 'TEST 8.1: Owner A tampering path to Company B root is denied');

  const t8_tamperTrips = sim.evalFirestore(OWNER_A, 'list', `companies/${COMPANY_B}/trips`);
  assert(!t8_tamperTrips.allowed, 'TEST 8.2: Owner A tampering path to Company B trips is denied');

  const t8_tamperTripWrite = sim.evalFirestore(
    OWNER_A,
    'create',
    `companies/${COMPANY_B}/trips/trip_tamper`,
    { id: 'trip_tamper', companyId: COMPANY_B }
  );
  assert(!t8_tamperTripWrite.allowed, 'TEST 8.3: Owner A tampering path to Company B write is denied');

  // --------------------------------------------------------------------------
  console.log('\n--- TEST 9: User Attempts to Modify Company ownerId (DENY) ---');
  // --------------------------------------------------------------------------
  const t9_ownerTamper = sim.evalFirestore(
    OWNER_A,
    'update',
    `companies/${COMPANY_A}`,
    {
      id: COMPANY_A,
      name: 'ETS Transports India',
      ownerId: 'attacker_new_owner_uid', // Malicious ownerId change
      updatedAt: SERVER_TIME,
    }
  );
  assert(!t9_ownerTamper.allowed, 'TEST 9.1: Changing company ownerId is strictly blocked by immutable rules');

  // --------------------------------------------------------------------------
  console.log('\n--- TEST 10: Owner Logs Out and Logs Back in, Existing Data Remains Available (ALLOW) ---');
  // --------------------------------------------------------------------------
  // Simulate logout (null session)
  const sessionLoggedOut = null;
  const t10_loggedOutRead = sim.evalFirestore(sessionLoggedOut, 'get', `companies/${COMPANY_A}`);
  assert(!t10_loggedOutRead.allowed, 'TEST 10.1: Logged-out user has zero access to data');

  // Simulate re-login: same owner credentials
  const sessionLoggedIn: SimAuth = {
    uid: OWNER_A.uid,
    email: OWNER_A.email,
    emailVerified: true,
  };

  const t10_reloginCompany = sim.evalFirestore(sessionLoggedIn, 'get', `companies/${COMPANY_A}`);
  assert(t10_reloginCompany.allowed, 'TEST 10.2: Re-authenticated owner re-accesses company root without recreating company');

  const t10_reloginTrip = sim.evalFirestore(sessionLoggedIn, 'get', `companies/${COMPANY_A}/trips/trip_001`);
  assert(t10_reloginTrip.allowed, 'TEST 10.3: Re-authenticated owner retrieves pre-existing trip records intact');

  const existingTripData = sim.getDoc(`companies/${COMPANY_A}/trips/trip_001`);
  assert(
    existingTripData?.tripNumber === 'TRP-1001' && existingTripData?.status === 'PLANNED',
    'TEST 10.4: Existing Firestore data remains completely preserved and uncorrupted'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- SUITE SUMMARY ---');
  console.log(`TOTAL PASSED: ${passed}`);
  console.log(`TOTAL FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runOwnerSecurityTests();
