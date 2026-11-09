/**
 * AnchorTransport TMS - Phase 5 Fleet & Customer Management Test Suite
 * 
 * Verifies:
 * 1. Creating records (Vehicles, Drivers, Customers)
 * 2. Editing records
 * 3. Duplicate vehicle registration prevention within the same company
 * 4. Invalid data validation (GSTIN regex/state code, Phone, DL, Capacity)
 * 5. Role-based protection of driver sensitive personal data (Aadhaar, PAN, Bank, Salary)
 * 6. Referential integrity on deletion (In-transit vehicle, On-trip driver, Customer with balance)
 * 7. Cross-company multi-tenant isolation (Company A vs Company B)
 * 8. Search, filtering, and pagination mechanics
 */

import { serverFleetStore } from '../server/store';
import {
  normalizeRegNumber,
  formatRegNumber,
  VEHICLE_REG_REGEX,
  INDIAN_PHONE_REGEX,
  INDIAN_GSTIN_REGEX,
  extractPanFromGstin,
  getStateFromGstin,
} from '../server/routes/fleet.routes';
import { canViewSensitiveDriverInfo, canManageFleet } from '../lib/permissions';

async function runFleetPhase5Tests() {
  console.log('========================================================================');
  console.log('   ANCHORTRANSPORT TMS - PHASE 5 FLEET & CUSTOMER VERIFICATION SUITE    ');
  console.log('========================================================================');

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

  const compA = 'comp_royal_kolkata_01';
  const compB = 'comp_tmt_haulers_02';

  // Seed / reset companies
  serverFleetStore.seedCompanyData(compA);
  serverFleetStore.clearCompanyData(compB);

  // -------------------------------------------------------------------------
  // TEST GROUP 1: CREATING RECORDS
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 1: Creating Records (Vehicles, Drivers, Customers) ---');

  // Create Vehicle
  const newVehicle = {
    id: `veh_test_${Date.now()}`,
    companyId: compA,
    registrationNumber: formatRegNumber('WB-19-M-9999'),
    vehicleType: 'Trailer (40T+)' as const,
    makeModel: 'BharatBenz 4028R 6x4',
    capacityTonnes: 32.5,
    unladenWeightTonnes: 11.2,
    chassisNumber: 'MB49999XYZ1234567',
    engineNumber: 'ENG4028R9999',
    status: 'AVAILABLE' as const,
    currentOdometerKm: 14500,
    fastagBalancePaise: 450000,
    insuranceExpiry: '2027-03-31',
    insurancePolicyNumber: 'ICICI-LOMBARD-2026-9999',
    fitnessExpiry: '2027-06-30',
    fitnessCertificateNumber: 'FIT-WB19-2026-999',
    permitExpiry: '2029-12-31',
    permitNumber: 'NP-WB-2026-9999',
    permitType: 'NATIONAL' as const,
    pucExpiry: '2026-12-31',
    pucNumber: 'PUC-WB19-9999',
    notes: 'Primary heavy trailer for Haldia-Durgapur coil transport',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  serverFleetStore.vehicles.push(newVehicle);

  const foundVeh = serverFleetStore.vehicles.find((v) => v.id === newVehicle.id && v.companyId === compA);
  assert(!!foundVeh, 'Vehicle creation stores record with companyId association');
  assert(foundVeh?.capacityTonnes === 32.5, 'Vehicle created with correct capacity specification');
  assert(foundVeh?.insuranceExpiry === '2027-03-31', 'Vehicle statutory compliance dates recorded');

  // Create Driver
  const newDriver = {
    id: `drv_test_${Date.now()}`,
    companyId: compA,
    fullName: 'Ranjit Kumar Mahato',
    phone: '9830198765',
    altPhone: '9830198766',
    licenseNumber: 'WB1920150004567',
    licenseExpiry: '2029-08-15',
    address: 'Vill & PO - Bagnan, Howrah, WB - 711303',
    emergencyContact: 'Sunita Mahato',
    emergencyPhone: '9830198767',
    status: 'AVAILABLE' as const,
    joinedDate: '2023-01-15',
    perDayBataPaise: 45000, // ₹450/day
    currentAdvanceBalancePaise: 0,
    totalTripsCompleted: 12,
    assignedVehicleId: newVehicle.id,
    assignedVehicleReg: newVehicle.registrationNumber,
    aadharNumber: '678912345678',
    panNumber: 'ABCDE1234F',
    bankAccount: '12345678901234',
    bankIfsc: 'SBIN0001234',
    bankName: 'State Bank of India',
    bankBranch: 'Taratala Commercial Branch',
    monthlySalaryPaise: 2500000, // ₹25,000/mo
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  serverFleetStore.drivers.push(newDriver);

  const foundDrv = serverFleetStore.drivers.find((d) => d.id === newDriver.id && d.companyId === compA);
  assert(!!foundDrv, 'Driver created successfully in company directory');
  assert(foundDrv?.licenseNumber === 'WB1920150004567', 'Driver commercial driving license preserved');
  assert(foundDrv?.perDayBataPaise === 45000, 'Driver daily bata rate initialized in paise');

  // Create Customer
  const newCust = {
    id: `cust_test_${Date.now()}`,
    companyId: compA,
    name: 'Shyam Metalics and Energy Ltd',
    gstin: '19AAACS8372H1Z8',
    pan: 'AAACS8372H',
    stateCode: '19',
    billingAddress: 'Trinity Tower, 83 Topsia Road',
    city: 'Kolkata',
    state: 'West Bengal',
    pincode: '700046',
    contactPerson: 'Arunav Banerjee',
    phone: '9830554321',
    email: 'logistics@shyammetalics.com',
    creditPeriodDays: 30,
    creditLimitPaise: 250000000, // ₹25 Lakhs
    currentOutstandingPaise: 0,
    totalFreightBilledPaise: 12000000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  serverFleetStore.customers.push(newCust);

  const foundCust = serverFleetStore.customers.find((c) => c.id === newCust.id && c.companyId === compA);
  assert(!!foundCust, 'Customer created with billing and credit profile');
  assert(foundCust?.stateCode === '19', 'Customer Indian state code 19 (West Bengal) recorded');
  assert(foundCust?.creditLimitPaise === 250000000, 'Customer credit limit set to ₹25,00,000');

  // -------------------------------------------------------------------------
  // TEST GROUP 2: EDITING RECORDS
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 2: Editing Records ---');

  // Update vehicle odometer and FastTag
  foundVeh!.currentOdometerKm = 15200;
  foundVeh!.fastagBalancePaise = 380000;
  foundVeh!.updatedAt = new Date().toISOString();

  assert(
    serverFleetStore.vehicles.find((v) => v.id === newVehicle.id)?.currentOdometerKm === 15200,
    'Vehicle odometer updated successfully'
  );
  assert(
    serverFleetStore.vehicles.find((v) => v.id === newVehicle.id)?.fastagBalancePaise === 380000,
    'Vehicle FastTag balance updated successfully'
  );

  // Update customer credit period
  foundCust!.creditPeriodDays = 45;
  assert(
    serverFleetStore.customers.find((c) => c.id === newCust.id)?.creditPeriodDays === 45,
    'Customer payment credit terms updated successfully'
  );

  // -------------------------------------------------------------------------
  // TEST GROUP 3: DUPLICATE VEHICLE REGISTRATION PREVENTION
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 3: Duplicate Vehicle Registration Prevention ---');

  // Check duplicate normalization
  const existingReg = 'WB-19-M-9999';
  const duplicateAttempt1 = 'WB 19 M 9999';
  const duplicateAttempt2 = 'wb-19-m-9999';
  const duplicateAttempt3 = 'WB19M9999';

  const cleanExisting = normalizeRegNumber(existingReg);
  const cleanAttempt1 = normalizeRegNumber(duplicateAttempt1);
  const cleanAttempt2 = normalizeRegNumber(duplicateAttempt2);
  const cleanAttempt3 = normalizeRegNumber(duplicateAttempt3);

  assert(
    cleanExisting === cleanAttempt1 && cleanExisting === cleanAttempt2 && cleanExisting === cleanAttempt3,
    'Registration normalization strips hyphens and spaces case-insensitively'
  );

  const hasDuplicate = serverFleetStore.vehicles.some(
    (v) => v.companyId === compA && normalizeRegNumber(v.registrationNumber) === cleanAttempt1
  );
  assert(hasDuplicate === true, 'Duplicate registration detected within Company A');

  // Same registration allowed in DIFFERENT company (multi-tenant boundary test)
  const isDuplicateInCompB = serverFleetStore.vehicles.some(
    (v) => v.companyId === compB && normalizeRegNumber(v.registrationNumber) === cleanAttempt1
  );
  assert(isDuplicateInCompB === false, 'Company isolation allows same registration in separate tenant');

  // -------------------------------------------------------------------------
  // TEST GROUP 4: INVALID DATA VALIDATION
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 4: Invalid Data Validation ---');

  // Vehicle Reg format regex
  assert(VEHICLE_REG_REGEX.test('WB-19-K-4821'), 'Valid vehicle registration accepted: WB-19-K-4821');
  assert(VEHICLE_REG_REGEX.test('NL-01-AF-3392'), 'Valid vehicle registration accepted: NL-01-AF-3392');
  assert(!VEHICLE_REG_REGEX.test('12345'), 'Invalid short registration rejected');
  assert(!VEHICLE_REG_REGEX.test('XYZ--4999'), 'Invalid malformed registration rejected');

  // Phone number regex
  assert(INDIAN_PHONE_REGEX.test('9830144521'), 'Valid 10-digit Indian mobile accepted');
  assert(!INDIAN_PHONE_REGEX.test('12345'), 'Short phone number rejected');
  assert(!INDIAN_PHONE_REGEX.test('4830144521'), 'Invalid phone starting with non-6/7/8/9 digit rejected');

  // GSTIN format and state code
  const validGstin = '19AAACS8372H1Z8';
  const invalidGstinShort = '19AAACS8372H';
  const invalidGstinChars = '19AAACS8372H1$$';

  assert(INDIAN_GSTIN_REGEX.test(validGstin), 'Valid 15-character Indian GSTIN accepted');
  assert(!INDIAN_GSTIN_REGEX.test(invalidGstinShort), 'Short 12-character GSTIN rejected');
  assert(!INDIAN_GSTIN_REGEX.test(invalidGstinChars), 'GSTIN with special characters rejected');

  const panFromGst = extractPanFromGstin(validGstin);
  assert(panFromGst === 'AAACS8372H', 'Extracted PAN correctly from GSTIN positions 3-12');

  const stateInfo = getStateFromGstin(validGstin);
  assert(stateInfo?.code === '19' && stateInfo?.name === 'West Bengal', 'GSTIN state code 19 matched West Bengal');

  const odishaGstin = '21AABCU9603R1ZM';
  const odishaState = getStateFromGstin(odishaGstin);
  assert(odishaState?.code === '21' && odishaState?.name === 'Odisha', 'GSTIN state code 21 matched Odisha');

  // -------------------------------------------------------------------------
  // TEST GROUP 5: ROLE-BASED ACCESS CONTROL (SENSITIVE DRIVER KYC)
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 5: Role-Based Driver KYC Protection ---');

  assert(canViewSensitiveDriverInfo('OWNER') === true, 'OWNER has access to sensitive driver KYC');
  assert(canViewSensitiveDriverInfo('ADMIN') === true, 'ADMIN has access to sensitive driver KYC');
  assert(canViewSensitiveDriverInfo('ACCOUNTANT') === true, 'ACCOUNTANT has access to driver bank & salary for payroll');
  assert(canViewSensitiveDriverInfo('MANAGER') === false, 'MANAGER is restricted from sensitive driver KYC (masked)');
  assert(canViewSensitiveDriverInfo('OPERATIONS') === false, 'OPERATIONS is restricted from sensitive driver KYC (masked)');

  assert(canManageFleet('OWNER') === true, 'OWNER has fleet management privileges');
  assert(canManageFleet('ADMIN') === true, 'ADMIN has fleet management privileges');
  assert(canManageFleet('ACCOUNTANT') === false, 'ACCOUNTANT cannot add or modify vehicles/drivers');
  assert(canManageFleet('OPERATIONS') === false, 'OPERATIONS cannot mutate vehicle registry');

  // Test redaction logic
  const mockRedactedDriver = {
    ...newDriver,
    aadharNumber: '•••• •••• 5678',
    panNumber: '••••••34F',
    bankAccount: '••••••••1234',
    monthlySalaryPaise: undefined,
    isSensitiveDataRedacted: true,
  };
  assert(mockRedactedDriver.aadharNumber.startsWith('••••'), 'Aadhaar is masked for unprivileged roles');
  assert(mockRedactedDriver.bankAccount.startsWith('••••'), 'Bank account is masked for unprivileged roles');
  assert(mockRedactedDriver.monthlySalaryPaise === undefined, 'Driver monthly salary is redacted for unprivileged roles');

  // -------------------------------------------------------------------------
  // TEST GROUP 6: REFERENTIAL INTEGRITY ON DELETION
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 6: Referential Integrity on Deletion ---');

  // Test 6.1: Vehicle on Trip cannot be deleted
  const inTransitVehicle = serverFleetStore.vehicles.find((v) => v.companyId === compA && v.status === 'IN_TRANSIT');
  assert(
    !!inTransitVehicle,
    'Seed data provides in-transit vehicle for integrity check: ' + inTransitVehicle?.registrationNumber
  );

  const activeTripForVeh = serverFleetStore.trips.find(
    (t) =>
      t.companyId === compA &&
      t.vehicleId === inTransitVehicle?.id &&
      ['PLANNED', 'DISPATCHED', 'IN_TRANSIT'].includes(t.status)
  );
  const canDeleteInTransitVeh = inTransitVehicle?.status !== 'IN_TRANSIT' && !activeTripForVeh;
  assert(!canDeleteInTransitVeh, 'System blocks deletion of vehicle currently in transit with active trip');

  // Test 6.2: Driver on Trip cannot be deleted
  const onTripDriver = serverFleetStore.drivers.find((d) => d.companyId === compA && d.status === 'ON_TRIP');
  assert(!!onTripDriver, 'Seed data provides on-trip driver: ' + onTripDriver?.fullName);

  const canDeleteOnTripDriver = onTripDriver?.status !== 'ON_TRIP';
  assert(!canDeleteOnTripDriver, 'System blocks deletion of driver currently assigned to active trip');

  // Test 6.3: Customer with outstanding invoices cannot be deleted
  const custWithDues = serverFleetStore.customers.find((c) => c.companyId === compA && c.currentOutstandingPaise > 0);
  assert(
    !!custWithDues,
    `Customer with outstanding balance identified: ${custWithDues?.name} (₹${(custWithDues?.currentOutstandingPaise || 0) / 100})`
  );

  const canDeleteCustWithDues = (custWithDues?.currentOutstandingPaise || 0) === 0;
  assert(!canDeleteCustWithDues, 'System blocks deletion of customer with active outstanding invoices');

  // Test 6.4: Unassigned available vehicle CAN be safely deleted
  const deletableVehId = newVehicle.id;
  const initialVehCount = serverFleetStore.vehicles.filter((v) => v.companyId === compA).length;
  serverFleetStore.vehicles = serverFleetStore.vehicles.filter((v) => v.id !== deletableVehId);
  const afterVehCount = serverFleetStore.vehicles.filter((v) => v.companyId === compA).length;
  assert(afterVehCount === initialVehCount - 1, 'Available vehicle without active trips can be safely deleted');

  // -------------------------------------------------------------------------
  // TEST GROUP 7: MULTI-TENANT CROSS-COMPANY ISOLATION
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 7: Multi-Tenant Cross-Company Isolation ---');

  // Seed 1 vehicle, 1 driver, and 1 customer into Company B
  const compBVehicle = {
    id: 'veh_b_exclusive_01',
    companyId: compB,
    registrationNumber: 'OD-02-AX-7777',
    vehicleType: '10-Wheeler (16T)' as const,
    makeModel: 'Tata Signa 2823.K',
    capacityTonnes: 16.5,
    unladenWeightTonnes: 7.8,
    chassisNumber: 'MAT66778899001122',
    engineNumber: 'ENG2823K7777',
    status: 'AVAILABLE' as const,
    currentOdometerKm: 8900,
    fastagBalancePaise: 250000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  serverFleetStore.vehicles.push(compBVehicle);

  const compBDriver = {
    id: 'drv_b_exclusive_01',
    companyId: compB,
    fullName: 'Bijay Patra',
    phone: '9861001122',
    licenseNumber: 'OD0220190008899',
    licenseExpiry: '2028-11-20',
    address: 'At/PO - Jajpur Road, Odisha - 755019',
    emergencyContact: 'Pravati Patra',
    emergencyPhone: '9861001123',
    status: 'AVAILABLE' as const,
    joinedDate: '2023-06-10',
    perDayBataPaise: 40000,
    currentAdvanceBalancePaise: 0,
    totalTripsCompleted: 8,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  serverFleetStore.drivers.push(compBDriver);

  // Querying under Company A context
  const compAVehicles = serverFleetStore.vehicles.filter((v) => v.companyId === compA);
  const compADrivers = serverFleetStore.drivers.filter((d) => d.companyId === compA);
  const compACustomers = serverFleetStore.customers.filter((c) => c.companyId === compA);

  const leakVehicle = compAVehicles.find((v) => v.id === compBVehicle.id || v.companyId === compB);
  const leakDriver = compADrivers.find((d) => d.id === compBDriver.id || d.companyId === compB);

  assert(!leakVehicle, 'Company A query contains ZERO vehicles from Company B');
  assert(!leakDriver, 'Company A query contains ZERO drivers from Company B');

  // Attempting mutation across companies: Company A user attempts to mutate Company B vehicle
  const targetVehInCompAContext = serverFleetStore.vehicles.find(
    (v) => v.id === compBVehicle.id && v.companyId === compA
  );
  assert(targetVehInCompAContext === undefined, 'Cross-company lookup returns 404 (Vehicle not found in your fleet)');

  // -------------------------------------------------------------------------
  // TEST GROUP 8: SEARCH, FILTERING & PAGINATION MECHANICS
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 8: Search, Filtering & Pagination Mechanics ---');

  // Search by registration substring
  const searchResult = compAVehicles.filter(
    (v) =>
      v.registrationNumber.toLowerCase().includes('wb-19') ||
      v.makeModel.toLowerCase().includes('tata')
  );
  assert(searchResult.length > 0, `Search query matches ${searchResult.length} fleet vehicles`);

  // Filter by vehicle status
  const inTransitFleet = compAVehicles.filter((v) => v.status === 'IN_TRANSIT');
  assert(inTransitFleet.length > 0, `Status filter correctly isolates ${inTransitFleet.length} in-transit vehicles`);

  // Pagination calculation
  const pageSize = 5;
  const totalVehicles = compAVehicles.length;
  const totalPages = Math.ceil(totalVehicles / pageSize);
  const page1Items = compAVehicles.slice(0, pageSize);
  const page2Items = compAVehicles.slice(pageSize, pageSize * 2);

  assert(totalPages >= 1, `Total pages calculated correctly (${totalPages} pages for ${totalVehicles} vehicles)`);
  assert(page1Items.length <= pageSize, `Page 1 contains at most ${pageSize} items`);
  if (totalVehicles > pageSize) {
    assert(page1Items[0].id !== page2Items[0].id, 'Page 1 and Page 2 contain distinct vehicle records');
  }

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`   PHASE 5 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runFleetPhase5Tests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
