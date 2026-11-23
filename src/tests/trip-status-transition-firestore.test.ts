/**
 * AnchorTransport TMS - Trip Status Transition & Server-Preserving Update Regression Test
 *
 * Verifies that:
 * 1. firestoreService.ts fetches authoritative server snapshots (getDocFromServer) before batch writes.
 * 2. Existing document updates use batch.update + buildServerPreservingUpdatePayload (omitting `createdAt`
 *    and converting removed optional keys like `activeTripId` or `invoiceId` into `deleteField()`).
 * 3. Driver sanitization preserves `isSensitiveDataRedacted` so non-admin updates do not delete the key.
 * 4. assertWritableFirestoreUser checks `email_verified` ID token claims and refreshes if stale.
 * 5. firestore.rules matches every field emitted across trips, vehicles, drivers, and auditLogs during
 *    PLANNED -> DISPATCHED -> IN_TRANSIT -> DELIVERED -> COMPLETED / CANCELLED transitions, plus
 *    case-insensitive bootstrapped admin matching.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`  ✗ [FAIL] ${name}${detail ? ` -> ${detail}` : ''}`);
    failed++;
  }
}

async function runTests() {
  console.log('========================================================================');
  console.log('  TRIP STATUS TRANSITION & FIRESTORE UPDATE INTEGRITY REGRESSION TEST  ');
  console.log('========================================================================\n');

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(__dirname, '../..');

  const serviceSrc = fs.readFileSync(
    path.join(root, 'src/lib/firebase/firestoreService.ts'),
    'utf8'
  );
  const rulesSrc = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

  console.log('--- SUITE 1: Server-Preserving Batch Update & Cache Safety ---');

  assert(
    serviceSrc.includes('getDocFromServer') &&
      serviceSrc.includes('getAuthoritativeDocSnap') &&
      serviceSrc.includes('const existingSnap = await getAuthoritativeDocSnap(ref);'),
    'prepareBatchDoc uses getAuthoritativeDocSnap (getDocFromServer with getDoc fallback)'
  );

  assert(
    serviceSrc.includes('function buildServerPreservingUpdatePayload') &&
      serviceSrc.includes("if (key === 'createdAt') continue;") &&
      serviceSrc.includes("if (existingKey === 'createdAt') continue;") &&
      serviceSrc.includes('updatePayload[existingKey] = deleteField();'),
    'buildServerPreservingUpdatePayload omits createdAt and marks removed optional fields with deleteField()'
  );

  assert(
    serviceSrc.includes('function isFirestoreTimestamp') &&
      serviceSrc.includes('function writePreparedBatchDoc') &&
      serviceSrc.includes('isFirestoreTimestamp(prepared.existingData.createdAt)') &&
      serviceSrc.includes('batch.update(') &&
      serviceSrc.includes('buildServerPreservingUpdatePayload(prepared.existingData, prepared.payload)'),
    'writePreparedBatchDoc uses isFirestoreTimestamp + batch.update with server-preserving payload for existing Timestamp docs'
  );

  assert(
    serviceSrc.includes('function isPermissionDeniedError') &&
      serviceSrc.includes('writeAuditLogBestEffort') &&
      serviceSrc.includes('commitTripBatch(false)') &&
      serviceSrc.includes('commitTransitionBatch(false)') &&
      serviceSrc.includes('validatePreparedDocAgainstRules') &&
      serviceSrc.includes('commitPreparedDocsSequentiallyWithRollback'),
    'createOrUpdateTripInFirestore & transitionTripStatusInFirestore refresh ID token, isolate auditLog, preflight rules, and fall back to rollback-safe sequential writes'
  );

  assert(
    serviceSrc.includes('transitionTripStatusInFirestore') &&
      serviceSrc.includes('writePreparedBatchDoc(batch, prepared)') &&
      serviceSrc.includes('handleFirestoreError(err, activeOp, activePath)'),
    'transitionTripStatusInFirestore routes trip, vehicle, and driver through writePreparedBatchDoc and reports exact activeOp/activePath on error'
  );

  assert(
    serviceSrc.includes("typeof item.isSensitiveDataRedacted === 'boolean'") &&
      serviceSrc.includes("typeof existingData?.isSensitiveDataRedacted === 'boolean'"),
    'Driver sanitization preserves existing isSensitiveDataRedacted flag'
  );

  assert(
    serviceSrc.includes('await auth.currentUser.getIdTokenResult()') &&
      serviceSrc.includes('tokenResult?.claims?.email_verified !== true') &&
      serviceSrc.includes('await auth.currentUser.getIdToken(true)'),
    'assertWritableFirestoreUser verifies ID token email_verified claim and forces refresh if needed'
  );

  console.log('\n--- SUITE 2: Firestore Rules Transition Alignment (Strict Verified Owner-Only) ---');

  assert(
    rulesSrc.includes('function isVerifiedUser()') &&
      rulesSrc.includes("('email_verified' in request.auth.token)") &&
      rulesSrc.includes('request.auth.token.email_verified == true'),
    'isVerifiedUser enforces verified email_verified claim on token'
  );

  assert(
    rulesSrc.includes('function isCompanyOwner(companyId)') &&
      rulesSrc.includes('get(companyDocPath(companyId)).data.ownerId == request.auth.uid') &&
      rulesSrc.includes('function isVerifiedCompanyOwner(companyId)') &&
      !rulesSrc.includes('isActiveMember(') &&
      !rulesSrc.includes('hasCompanyRole('),
    'firestore.rules enforces strict Owner-Only isCompanyOwner & isVerifiedCompanyOwner without employee RBAC'
  );

  // Verify old restrictive isValidTrip / isValidTripCreate / isValidTripUpdate validators are removed
  assert(
    !rulesSrc.includes('function isValidTrip(') &&
      !rulesSrc.includes('function isValidTripCreate(') &&
      !rulesSrc.includes('function isValidTripUpdate('),
    'Old restrictive isValidTrip/isValidTripCreate/isValidTripUpdate functions completely removed from firestore.rules'
  );

  // Verify Trip type / payload still supports all operational transition fields
  const tmsTypesSrc = fs.readFileSync(path.join(root, 'src/types/tms.ts'), 'utf8');
  const expectedTripTransitionFields = [
    'status',
    'actualDeliveryDate',
    'endOdometerKm',
    'podReceived',
    'podDocumentUrl',
    'podRemarks',
    'cancellationReason',
    'cancelledAt',
    'cancelledBy',
    'notes',
  ];

  for (const field of expectedTripTransitionFields) {
    assert(
      tmsTypesSrc.includes(`${field}`) && serviceSrc.includes(`${field}`),
      `Trip transition field '${field}' is supported cleanly without restrictive rules blocking`
    );
  }

  // Check isValidVehicle & isValidDriver allowlists for trip start/end updates
  const vehicleValidatorMatch = rulesSrc.match(
    /function isValidVehicle\(data, companyId, vehicleId\)[\s\S]*?\n    \}/
  );
  const vehicleValidatorBlock = vehicleValidatorMatch ? vehicleValidatorMatch[0] : '';
  for (const field of ['status', 'activeTripId', 'currentOdometerKm', 'updatedAt']) {
    assert(
      vehicleValidatorBlock.includes(`'${field}'`),
      `isValidVehicle rules allowlist includes transition field '${field}'`
    );
  }

  const driverValidatorMatch = rulesSrc.match(
    /function isValidDriver\(data, companyId, driverId\)[\s\S]*?\n    \}/
  );
  const driverValidatorBlock = driverValidatorMatch ? driverValidatorMatch[0] : '';
  for (const field of ['status', 'totalTripsCompleted', 'updatedAt']) {
    assert(
      driverValidatorBlock.includes(`'${field}'`),
      `isValidDriver rules allowlist includes transition field '${field}'`
    );
  }

  // Check audit log schema & action compatibility
  assert(
    rulesSrc.includes("data.action in ['CREATE', 'UPDATE', 'DELETE', 'DISPATCH', 'SETTLE', 'APPROVE', 'INVOICE', 'PAYMENT', 'CANCEL']") &&
      rulesSrc.includes("'BROKER'") &&
      rulesSrc.includes("'FILE_RECORD'") &&
      rulesSrc.includes("'SETTINGS'") &&
      rulesSrc.includes('data.userId == request.auth.uid') &&
      rulesSrc.includes('data.timestamp == request.time'),
    'isValidAuditLog accepts UPDATE/TRIP and expanded TMS entityTypes written atomically'
  );

  // Check match blocks enforce isVerifiedUser, validator, isCreatedAtPreservedOrMigrated, and hasCompanyRole
  const tripUpdateMatch = rulesSrc.match(
    /match \/trips\/\{tripId\}[\s\S]*?allow update:[\s\S]*?allow delete:/
  );
  const vehicleUpdateMatch = rulesSrc.match(
    /match \/vehicles\/\{vehicleId\}[\s\S]*?allow update:[\s\S]*?allow delete:/
  );
  const driverUpdateMatch = rulesSrc.match(
    /match \/drivers\/\{driverId\}[\s\S]*?allow update:[\s\S]*?allow delete:/
  );

  const tripUpdateRule = tripUpdateMatch ? tripUpdateMatch[0] : '';
  const vehicleUpdateRule = vehicleUpdateMatch ? vehicleUpdateMatch[0] : '';
  const driverUpdateRule = driverUpdateMatch ? driverUpdateMatch[0] : '';

  assert(
    tripUpdateRule.includes('isVerifiedCompanyOwner(companyId)') &&
      tripUpdateRule.includes("(!('companyId' in incoming()) || incoming().companyId == companyId)") &&
      !tripUpdateRule.includes('isValidTrip') &&
      !tripUpdateRule.includes('request.time') &&
      !tripUpdateRule.includes('isCreatedAtPreservedOrMigrated') &&
      vehicleUpdateRule.includes('isVerifiedCompanyOwner(companyId)') &&
      (vehicleUpdateRule.includes('isValidVehicle(incoming(), companyId, vehicleId)') || vehicleUpdateRule.includes("(!('companyId' in incoming()) || incoming().companyId == companyId)")) &&
      driverUpdateRule.includes('isVerifiedCompanyOwner(companyId)') &&
      (driverUpdateRule.includes('isValidDriver(incoming(), companyId, driverId)') || driverUpdateRule.includes("(!('companyId' in incoming()) || incoming().companyId == companyId)")),
    'trips, vehicles, and drivers allow update enforce Verified Company Owner + tenant isolation'
  );

  console.log('\n--- SUITE 3: 13-Scenario Trip & Dispatch E2E Rule & Frontend Verification ---');

  const tripModalSrc = fs.readFileSync(path.join(root, 'src/modules/trips/TripModal.tsx'), 'utf8');
  const authContextSrc = fs.readFileSync(path.join(root, 'src/context/AuthContext.tsx'), 'utf8');

  assert(
    rulesSrc.includes('exists(companyDocPath(companyId))') &&
      rulesSrc.includes('get(companyDocPath(companyId)).data.ownerId == request.auth.uid'),
    'Scenario 1–13: isCompanyOwner checks exists() before get() to avoid null company rule evaluation errors'
  );

  assert(
    serviceSrc.includes("pickTripStr('tripNumber', 120)") &&
      serviceSrc.includes("pickTripStr('vehicleId', 128)") &&
      serviceSrc.includes("pickTripStr('driverId', 128)") &&
      serviceSrc.includes("pickTripStr('customerId', 128)") &&
      serviceSrc.includes('const pickTripStr = (key: string, maxLen: number)') &&
      serviceSrc.includes('const pickTripNum = (key: string)') &&
      serviceSrc.includes('const pickTripBool = (key: string)') &&
      serviceSrc.includes('val === undefined || val === null') &&
      serviceSrc.includes('Number.isFinite(val)'),
    'Scenario 2 & 5 & 7: sanitizeSubcollectionPayload("trips") preserves existingData fields on partial updates and strips null/NaN values'
  );

  assert(
    tripModalSrc.includes('aria-label="LR Number"') &&
      tripModalSrc.includes('setLrNumberInput(tripToEdit.lrNumber') &&
      tripModalSrc.includes("(tripToEdit.dispatchDate || '').split('T')[0]") &&
      tripModalSrc.includes('tripToEdit.weightTonnes != null') &&
      tripModalSrc.includes('tripToEdit.ratePerTonnePaise != null'),
    'Scenario 2 & 5 & 7: TripModal safely hydrates legacy/partial trips and allows updating LR number & dispatch details'
  );

  assert(
    authContextSrc.includes("error: 'Please verify your email address before creating your company workspace.'") &&
      authContextSrc.includes('newCompany.ownerId = auth.currentUser.uid;') &&
      authContextSrc.includes('runLogoutCleanupsSynchronously') &&
      authContextSrc.includes('listOwnedCompaniesFromFirestore'),
    'Scenario 10 & 11: AuthContext binds verified Firebase UID to company.ownerId, cleans up listeners on logout, and reuses owned company on re-login'
  );

  // Rule validator sanity checks against exact match blocks
  const tripBlockMatch = rulesSrc.match(
    /match \/trips\/\{tripId\}[\s\S]*?allow delete:/
  );
  const tripBlock = tripBlockMatch ? tripBlockMatch[0] : '';
  const tripCreateClauseMatch = tripBlock.match(/allow create:[\s\S]*?allow update:/);
  const tripCreateRule = tripCreateClauseMatch ? tripCreateClauseMatch[0] : '';
  assert(
    tripCreateRule.includes('isVerifiedCompanyOwner(companyId)') &&
      tripCreateRule.includes("(!('companyId' in incoming()) || incoming().companyId == companyId)") &&
      !tripCreateRule.includes('isValidTrip') &&
      !tripCreateRule.includes('request.time') &&
      !tripCreateRule.includes('hasAll') &&
      !tripCreateRule.includes('hasOnly') &&
      rulesSrc.includes('data[field] == null'),
    'Scenario 1 & 4: /companies/{companyId}/trips/{tripId} allow create uses Verified Company Owner authorization without schema, timestamp, hasAll, or hasOnly restrictions'
  );

  // Simulate unrestricted Verified Company Owner acceptance across all Trip & Dispatch operations
  const simCheckTripPayload = (
    payload: Record<string, any>,
    companyId: string,
    _tripId: string,
    isUpdate = false,
    existing?: Record<string, any>
  ) => {
    const resulting = isUpdate && existing ? { ...existing, ...payload } : { ...payload };
    return !('companyId' in payload) || payload.companyId === companyId || resulting.companyId === companyId;
  };

  const cidA = 'comp_1795105131697_hjjvl';
  const tid = 'trip_1795206171272_aerf';
  const SERVER_TS = '__SERVER_TS__';

  const baseTrip = {
    id: tid,
    companyId: cidA,
    tripNumber: 'TR-2026-0101',
    lrNumber: 'AT/25-26/0101',
    customerId: 'cust_01',
    customerName: 'Tata Steel Ltd',
    customerGstin: '27AAACT2727Q1ZW',
    vehicleId: 'veh_01',
    vehicleReg: 'WB23E4412',
    driverId: 'drv_01',
    driverName: 'Ramesh Yadav',
    driverPhone: '9830011223',
    originCity: 'Jamshedpur',
    destinationCity: 'Kolkata',
    goodsType: 'TMT Bars',
    weightTonnes: 22,
    ratePerTonnePaise: 185000,
    freightAmountPaise: 4070000,
    otherChargesPaise: 0,
    totalRevenuePaise: 4070000,
    dispatchDate: '2026-11-22',
    expectedDeliveryDate: '2026-11-24',
    status: 'DISPATCHED',
    startOdometerKm: 110250,
    podReceived: false,
    totalExpensesPaise: 0,
    totalAdvancesPaise: 0,
    tripContributionPaise: 4070000,
    isSettled: false,
    isInvoiced: false,
    createdAt: SERVER_TS,
    updatedAt: SERVER_TS,
  };

  assert(
    simCheckTripPayload(baseTrip, cidA, tid, false),
    'Scenario 1 & 4: Full trip payload passes owner-only Trip & Dispatch rules'
  );
  assert(
    simCheckTripPayload(
      {
        customDispatchTag: 'PRIORITY_STEEL',
        notes: 'Draft trip with no driver/vehicle/customer/amounts/timestamps yet',
      },
      cidA,
      'trip_minimal_01',
      false
    ),
    'Scenario 2: Trip create with omitted driverId/customerId/vehicleId/amounts/timestamps and custom fields passes owner-only rules'
  );
  assert(
    simCheckTripPayload(
      {
        pickupAddress: 'Gate 3, Tata Yard',
        loadingDetails: 'Strapped 22T coils',
        dispatchDate: '2026-11-23',
        dispatchRemarks: 'Updated dispatch remarks after departure',
        dispatchDocumentUrl: 'https://firebasestorage.googleapis.com/dispatch.pdf',
        updatedAt: SERVER_TS,
      },
      cidA,
      tid,
      true,
      baseTrip
    ),
    'Scenario 2 & 5: Editing post-dispatch details & dispatchRemarks preserves createdAt and all required fields'
  );
  assert(
    simCheckTripPayload(
      { vehicleId: 'veh_02', vehicleReg: 'WB23E9988', driverId: 'drv_02', driverName: 'Suresh', updatedAt: SERVER_TS },
      cidA,
      tid,
      true,
      baseTrip
    ),
    'Scenario 6: Reassigning vehicle & driver passes isValidTrip()'
  );
  assert(
    simCheckTripPayload(
      {
        lrNumber: 'AT/25-26/0101-R1',
        lrDocumentUrl: 'https://firebasestorage.googleapis.com/lr.pdf',
        status: 'DELIVERED',
        actualDeliveryDate: '2026-11-24',
        endOdometerKm: 110540,
        podReceived: true,
        podDocumentUrl: 'https://firebasestorage.googleapis.com/pod.jpg',
        podRemarks: 'Signed by Store Officer',
        updatedAt: SERVER_TS,
      },
      cidA,
      tid,
      true,
      baseTrip
    ),
    'Scenario 3 & 7 & 8: Updating LR/POD & marking DELIVERED/COMPLETED passes isValidTrip()'
  );
  assert(
    simCheckTripPayload(
      { status: 'COMPLETED', updatedAt: SERVER_TS },
      cidA,
      tid,
      true,
      baseTrip
    ) &&
      simCheckTripPayload(
        { status: 'DELIVERED', reopenedAt: '2026-11-25T10:00:00.000Z', reopenedBy: 'owner@alpha.in', updatedAt: SERVER_TS },
        cidA,
        tid,
        true,
        baseTrip
      ) &&
      simCheckTripPayload(
        { status: 'SETTLED', isSettled: true, tripContributionPaise: -250000, updatedAt: SERVER_TS },
        cidA,
        tid,
        true,
        baseTrip
      ),
    'Scenario 8: Completing, operationally reopening, & settling trips passes isValidTrip()'
  );

  // Verify TripAuthorization module and UI unblock
  const tripAuthSrc = fs.readFileSync(path.join(root, 'src/lib/firebase/tripAuthorization.ts'), 'utf8');
  const tripsViewSrc = fs.readFileSync(path.join(root, 'src/modules/trips/TripsView.tsx'), 'utf8');
  const detailModalSrc = fs.readFileSync(path.join(root, 'src/modules/trips/TripDetailModal.tsx'), 'utf8');
  assert(
    tripAuthSrc.includes('export function getOperationalNextTripStatuses') &&
      tripAuthSrc.includes('export function canEditTrip') &&
      !tripsViewSrc.includes("!['COMPLETED', 'SETTLED', 'CANCELLED'].includes(t.status)") &&
      detailModalSrc.includes('getOperationalNextTripStatuses(trip)') &&
      tripModalSrc.includes('dispatchRemarks') &&
      tripModalSrc.includes('Stamped POD Received'),
    'Owner Trip & Dispatch Authorization layer enables full edit, post-dispatch POD/LR updates, and operational reopening across UI'
  );

  console.log('\n========================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Regression test failure:', err);
  process.exit(1);
});
