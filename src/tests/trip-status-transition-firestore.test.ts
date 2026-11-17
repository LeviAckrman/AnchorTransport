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
    serviceSrc.includes('function writePreparedBatchDoc') &&
      serviceSrc.includes('existingData.createdAt instanceof Timestamp') &&
      serviceSrc.includes('batch.update(') &&
      serviceSrc.includes('buildServerPreservingUpdatePayload(prepared.existingData, prepared.payload)'),
    'writePreparedBatchDoc uses batch.update with server-preserving payload for existing Timestamp docs'
  );

  assert(
    serviceSrc.includes('transitionTripStatusInFirestore') &&
      serviceSrc.includes('writePreparedBatchDoc(batch, tripDoc)') &&
      serviceSrc.includes('writePreparedBatchDoc(batch, vehDoc)') &&
      serviceSrc.includes('writePreparedBatchDoc(batch, drvDoc)') &&
      serviceSrc.includes('handleFirestoreError(err, OperationType.UPDATE, path)'),
    'transitionTripStatusInFirestore routes trip, vehicle, and driver through writePreparedBatchDoc and reports OperationType.UPDATE on error'
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

  console.log('\n--- SUITE 2: Firestore Rules Transition Alignment (Multi-Tenant RBAC) ---');

  assert(
    rulesSrc.includes('function isVerifiedUser()') &&
      rulesSrc.includes("('email_verified' in request.auth.token)") &&
      rulesSrc.includes('request.auth.token.email_verified == true'),
    'isVerifiedUser enforces verified email_verified claim on token'
  );

  assert(
    rulesSrc.includes('function isCompanyOwner(companyId)') &&
      rulesSrc.includes('get(companyDocPath(companyId)).data.ownerId == request.auth.uid') &&
      rulesSrc.includes('function isActiveMember(companyId)') &&
      rulesSrc.includes('function hasCompanyRole(companyId, allowedRoles)') &&
      rulesSrc.includes('match /members/{memberUid}'),
    'firestore.rules enforces isCompanyOwner, isActiveMember, hasCompanyRole, and /members/{memberUid} RBAC'
  );

  // Check isValidTrip allowlist fields used by transitionTripStatusInFirestore
  const tripValidatorMatch = rulesSrc.match(
    /function isValidTrip\(data, companyId, tripId\)[\s\S]*?\n    \}/
  );
  const tripValidatorBlock = tripValidatorMatch ? tripValidatorMatch[0] : '';

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
    'updatedAt',
  ];

  for (const field of expectedTripTransitionFields) {
    assert(
      tripValidatorBlock.includes(`'${field}'`),
      `isValidTrip rules allowlist includes transition field '${field}'`
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
    tripUpdateRule.includes('isVerifiedUser()') &&
      tripUpdateRule.includes('isValidTrip(incoming(), companyId, tripId)') &&
      tripUpdateRule.includes('isCreatedAtPreservedOrMigrated()') &&
      tripUpdateRule.includes('hasCompanyRole(companyId,') &&
      vehicleUpdateRule.includes('isVerifiedUser()') &&
      vehicleUpdateRule.includes('isValidVehicle(incoming(), companyId, vehicleId)') &&
      vehicleUpdateRule.includes('isCreatedAtPreservedOrMigrated()') &&
      vehicleUpdateRule.includes('hasCompanyRole(companyId,') &&
      driverUpdateRule.includes('isVerifiedUser()') &&
      driverUpdateRule.includes('isValidDriver(incoming(), companyId, driverId)') &&
      driverUpdateRule.includes('isCreatedAtPreservedOrMigrated()') &&
      driverUpdateRule.includes('hasCompanyRole(companyId,'),
    'trips, vehicles, and drivers allow update blocks enforce isVerifiedUser(), schema validator, isCreatedAtPreservedOrMigrated(), and hasCompanyRole(companyId, ...)'
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
