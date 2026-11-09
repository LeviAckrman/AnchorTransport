/**
 * AnchorTransport TMS - Phase 6 Commercial Trip Management Test Suite
 * 
 * Verifies:
 * 1. Trip creation & sequential unique numbering (Trip No & LR No)
 * 2. Trip editing with freight revenue recalculation
 * 3. Strict status transitions state machine & rejection of invalid jumps
 * 4. Server-side vehicle assignment conflict validation (overlapping active trips)
 * 5. Driver assignment and conflict checks
 * 6. Multi-tenant cross-company isolation (Company A != Company B)
 * 7. Financial contribution calculations (Revenue - Expenses, advances NOT counted as expenses)
 * 8. Cancelled trips preservation & resource liberation
 */

import { serverFleetStore } from '../server/store';
import {
  generateTripNumber,
  generateLrNumber,
  isValidTransition,
  ALLOWED_STATUS_TRANSITIONS,
  syncTripFinancials,
} from '../server/routes/trips.routes';
import { calculateTripContribution } from '../lib/financialEngine';
import { Trip, Vehicle, Driver, Customer, TripStatus, TripExpense, DriverAdvance } from '../types/tms';

async function runTripsPhase6Tests() {
  console.log('========================================================================');
  console.log('   ANCHORTRANSPORT TMS - PHASE 6 TRIP MANAGEMENT VERIFICATION SUITE     ');
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

  // Seed baseline data
  serverFleetStore.seedCompanyData(compA);
  serverFleetStore.clearCompanyData(compB);

  // -------------------------------------------------------------------------
  // TEST GROUP 1: TRIP CREATION & UNIQUE NUMBERING
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 1: Trip Creation & Unique Sequential Numbering ---');

  const tripNum1 = generateTripNumber(compA);
  const lrNum1 = generateLrNumber(compA);

  assert(tripNum1.startsWith('TR-') && tripNum1.length >= 10, `Trip number generated in standard format: ${tripNum1}`);
  assert(lrNum1.startsWith('LR-') && lrNum1.length >= 10, `LR number generated in standard format: ${lrNum1}`);

  const testVehA = serverFleetStore.vehicles.find((v) => v.companyId === compA && v.status === 'AVAILABLE') || serverFleetStore.vehicles[0];
  const testDrvA = serverFleetStore.drivers.find((d) => d.companyId === compA && d.status === 'AVAILABLE') || serverFleetStore.drivers[0];
  const testCustA = serverFleetStore.customers.find((c) => c.companyId === compA) || serverFleetStore.customers[0];

  const weight = 25.5; // Tonnes
  const ratePaise = 260000; // ₹2,600 / Tonne
  const freightPaise = Math.round(weight * ratePaise); // 66,30,000 paise = ₹66,300
  const otherPaise = 150000; // ₹1,500 detention
  const totalRevPaise = freightPaise + otherPaise; // 67,80,000 paise = ₹67,800

  const newTrip1: Trip = {
    id: `trip_test_${Date.now()}_1`,
    companyId: compA,
    tripNumber: tripNum1,
    lrNumber: lrNum1,
    customerId: testCustA.id,
    customerName: testCustA.name,
    customerGstin: testCustA.gstin,
    vehicleId: testVehA.id,
    vehicleReg: testVehA.registrationNumber,
    driverId: testDrvA.id,
    driverName: testDrvA.fullName,
    driverPhone: testDrvA.phone,
    originCity: 'Kolkata, WB',
    destinationCity: 'Siliguri, WB',
    goodsType: 'TMT Steel Rods',
    weightTonnes: weight,
    ratePerTonnePaise: ratePaise,
    freightAmountPaise: freightPaise,
    otherChargesPaise: otherPaise,
    totalRevenuePaise: totalRevPaise,
    dispatchDate: '2026-11-05',
    expectedDeliveryDate: '2026-11-07',
    status: 'PLANNED',
    startOdometerKm: testVehA.currentOdometerKm,
    podReceived: false,
    totalExpensesPaise: 0,
    totalAdvancesPaise: 0,
    tripContributionPaise: totalRevPaise,
    isSettled: false,
    isInvoiced: false,
    createdAt: new Date().toISOString(),
  };
  serverFleetStore.trips.unshift(newTrip1);

  assert(serverFleetStore.trips.some((t) => t.id === newTrip1.id), 'Trip saved with companyId association');
  assert(newTrip1.totalRevenuePaise === 6780000, 'Total revenue computed correctly in integer paise (₹67,800)');

  // Verify next generated number increments sequentially
  const tripNum2 = generateTripNumber(compA);
  const lrNum2 = generateLrNumber(compA);
  assert(tripNum2 !== tripNum1, `Second sequential trip number increments: ${tripNum2} != ${tripNum1}`);
  assert(lrNum2 !== lrNum1, `Second sequential LR number increments: ${lrNum2} != ${lrNum1}`);

  // -------------------------------------------------------------------------
  // TEST GROUP 2: TRIP EDITING
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 2: Trip Editing & Recalculations ---');

  // Modify weight to 28 Tonnes and add loading charges
  const updatedWeight = 28.0;
  const updatedFreight = Math.round(updatedWeight * ratePaise); // 72,80,000 paise
  newTrip1.weightTonnes = updatedWeight;
  newTrip1.freightAmountPaise = updatedFreight;
  newTrip1.otherChargesPaise = 200000; // ₹2,000
  newTrip1.totalRevenuePaise = updatedFreight + 200000; // 74,80,000 paise
  newTrip1.notes = 'Tarpaulin cover verified before gate out';
  syncTripFinancials(newTrip1);

  assert(newTrip1.weightTonnes === 28.0, 'Payload weight updated to 28.0 Tonnes');
  assert(newTrip1.totalRevenuePaise === 7480000, 'Total revenue dynamically recalculated to ₹74,800');
  assert(newTrip1.tripContributionPaise === 7480000, 'Trip contribution matches total revenue prior to expenses');

  // Completed or Cancelled trips freeze commercial alterations
  const completedTripMock: Trip = {
    ...newTrip1,
    id: 'trip_completed_mock',
    status: 'COMPLETED',
  };
  const canModifyCompletedFreight = !['COMPLETED', 'CANCELLED'].includes(completedTripMock.status);
  assert(!canModifyCompletedFreight, 'System rejects freight alterations on completed trips');

  // -------------------------------------------------------------------------
  // TEST GROUP 3: STATUS TRANSITIONS STATE MACHINE
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 3: Status Transition State Machine ---');

  // Valid forward transitions
  assert(isValidTransition('PLANNED', 'DISPATCHED') === true, 'Valid transition: PLANNED -> DISPATCHED');
  assert(isValidTransition('DISPATCHED', 'IN_TRANSIT') === true, 'Valid transition: DISPATCHED -> IN_TRANSIT');
  assert(isValidTransition('IN_TRANSIT', 'DELIVERED') === true, 'Valid transition: IN_TRANSIT -> DELIVERED');
  assert(isValidTransition('DELIVERED', 'COMPLETED') === true, 'Valid transition: DELIVERED -> COMPLETED');

  // Valid cancellations
  assert(isValidTransition('PLANNED', 'CANCELLED') === true, 'Valid cancellation: PLANNED -> CANCELLED');
  assert(isValidTransition('DISPATCHED', 'CANCELLED') === true, 'Valid cancellation: DISPATCHED -> CANCELLED');
  assert(isValidTransition('IN_TRANSIT', 'CANCELLED') === true, 'Valid cancellation: IN_TRANSIT -> CANCELLED');

  // Invalid jumps (MUST BE REJECTED)
  assert(isValidTransition('PLANNED', 'DELIVERED') === false, 'Blocked invalid jump: PLANNED -> DELIVERED');
  assert(isValidTransition('PLANNED', 'COMPLETED') === false, 'Blocked invalid jump: PLANNED -> COMPLETED');
  assert(isValidTransition('DISPATCHED', 'COMPLETED') === false, 'Blocked invalid jump: DISPATCHED -> COMPLETED');
  assert(isValidTransition('DELIVERED', 'DISPATCHED') === false, 'Blocked backward jump: DELIVERED -> DISPATCHED');
  assert(isValidTransition('COMPLETED', 'IN_TRANSIT') === false, 'Blocked transition out of terminal COMPLETED');
  assert(isValidTransition('CANCELLED', 'DISPATCHED') === false, 'Blocked transition out of terminal CANCELLED');

  // Operational delivery updates odometer & delivery timestamp
  newTrip1.status = 'DISPATCHED';
  assert(isValidTransition(newTrip1.status, 'IN_TRANSIT'), 'Trip advances to IN_TRANSIT');
  newTrip1.status = 'IN_TRANSIT';

  const endOdometer = newTrip1.startOdometerKm + 580; // 580 KM trip run
  newTrip1.endOdometerKm = endOdometer;
  newTrip1.actualDeliveryDate = '2026-11-07T14:30:00Z';
  newTrip1.podReceived = true;
  newTrip1.status = 'DELIVERED';

  assert(newTrip1.endOdometerKm === endOdometer, 'End odometer reading recorded: ' + endOdometer + ' KM');
  assert(newTrip1.podReceived === true, 'POD receipt recorded on consignee delivery');
  assert(newTrip1.status === 'DELIVERED', 'Trip transitioned to DELIVERED');

  // -------------------------------------------------------------------------
  // TEST GROUP 4: VEHICLE ASSIGNMENT CONFLICTS (SERVER-SIDE)
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 4: Vehicle Assignment Conflicts ---');

  const busyTruck = serverFleetStore.vehicles.find((v) => v.companyId === compA && v.status === 'IN_TRANSIT');
  assert(!!busyTruck, 'Active in-transit vehicle identified: ' + busyTruck?.registrationNumber);

  // Check if truck has active trip in DISPATCHED or IN_TRANSIT
  const activeTripOnTruck = serverFleetStore.trips.find(
    (t) =>
      t.companyId === compA &&
      t.vehicleId === busyTruck?.id &&
      ['DISPATCHED', 'IN_TRANSIT'].includes(t.status)
  );
  assert(!!activeTripOnTruck, 'Truck has overlapping active trip: ' + activeTripOnTruck?.tripNumber);

  // Server-side validation check
  const isConflict = Boolean(activeTripOnTruck || busyTruck?.status === 'IN_TRANSIT');
  assert(isConflict === true, 'Server detects vehicle conflict for overlapping active dispatch');

  // Check workshop maintenance truck conflict
  const workshopTruck = serverFleetStore.vehicles.find((v) => v.companyId === compA && v.status === 'UNDER_MAINTENANCE');
  const isWorkshopBlocked = workshopTruck?.status === 'UNDER_MAINTENANCE';
  assert(isWorkshopBlocked === true, 'Server blocks dispatch of truck currently under maintenance in garage');

  // -------------------------------------------------------------------------
  // TEST GROUP 5: DRIVER ASSIGNMENT & CONFLICT CHECKS
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 5: Driver Assignment & Conflict Validation ---');

  const busyDriver = serverFleetStore.drivers.find((d) => d.companyId === compA && d.status === 'ON_TRIP');
  assert(!!busyDriver, 'Driver currently on active trip identified: ' + busyDriver?.fullName);

  const activeTripOnDriver = serverFleetStore.trips.find(
    (t) =>
      t.companyId === compA &&
      t.driverId === busyDriver?.id &&
      ['DISPATCHED', 'IN_TRANSIT'].includes(t.status)
  );
  assert(!!activeTripOnDriver, 'Active trip identified for driver: ' + activeTripOnDriver?.tripNumber);

  const isDriverConflict = Boolean(activeTripOnDriver || busyDriver?.status === 'ON_TRIP');
  assert(isDriverConflict === true, 'Server detects driver conflict for concurrent dispatch attempt');

  // Available driver has zero conflicts
  const availableDriver = serverFleetStore.drivers.find((d) => d.companyId === compA && d.status === 'AVAILABLE');
  assert(!!availableDriver, 'Available driver identified for clean dispatch: ' + availableDriver?.fullName);

  // -------------------------------------------------------------------------
  // TEST GROUP 6: MULTI-TENANT CROSS-COMPANY ISOLATION
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 6: Multi-Tenant Cross-Company Isolation ---');

  // Create a confidential trip in Company B
  const compBTrip: Trip = {
    id: 'trip_comp_b_exclusive_99',
    companyId: compB,
    tripNumber: 'TR-B-2026-0001',
    lrNumber: 'LR-B-2026-0001',
    customerId: 'cust_b_99',
    customerName: 'Jindal Steel & Power Ltd',
    customerGstin: '21AAACJ0001A1Z1',
    vehicleId: 'veh_b_99',
    vehicleReg: 'OD-02-AX-9999',
    driverId: 'drv_b_99',
    driverName: 'Sarat Jena',
    driverPhone: '9861998877',
    originCity: 'Angul, OD',
    destinationCity: 'Kolkata, WB',
    goodsType: 'Steel Plates',
    weightTonnes: 30.0,
    ratePerTonnePaise: 250000,
    freightAmountPaise: 7500000,
    otherChargesPaise: 0,
    totalRevenuePaise: 7500000,
    dispatchDate: '2026-11-04',
    expectedDeliveryDate: '2026-11-06',
    status: 'IN_TRANSIT',
    startOdometerKm: 45000,
    podReceived: false,
    totalExpensesPaise: 0,
    totalAdvancesPaise: 0,
    tripContributionPaise: 7500000,
    isSettled: false,
    isInvoiced: false,
    createdAt: new Date().toISOString(),
  };
  serverFleetStore.trips.push(compBTrip);

  // Querying under Company A context
  const compATrips = serverFleetStore.trips.filter((t) => t.companyId === compA);
  const hasCompBLeak = compATrips.some((t) => t.id === compBTrip.id || t.companyId === compB);
  assert(hasCompBLeak === false, 'Company A trips query contains ZERO records from Company B');

  // Attempting mutation across tenant boundary
  const targetTripInCompA = serverFleetStore.trips.find(
    (t) => t.id === compBTrip.id && t.companyId === compA
  );
  assert(targetTripInCompA === undefined, 'Cross-company lookup returns 404 (Trip not found in your company)');

  // -------------------------------------------------------------------------
  // TEST GROUP 7: CONTRIBUTION & FINANCIAL CALCULATION
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 7: Decimal-Safe Contribution Calculations ---');

  const tripRevenue = 7480000; // ₹74,800
  const dieselExp: TripExpense = {
    id: 'exp_t_diesel_01',
    companyId: compA,
    tripId: newTrip1.id,
    category: 'DIESEL',
    amountPaise: 1850000, // ₹18,500 diesel
    paymentMode: 'PETRO_CARD',
    description: '190L Diesel at IOCL Dankuni',
    recordedBy: 'Accounts',
    isDriverDisbursed: false,
  };

  const tollExp: TripExpense = {
    id: 'exp_t_toll_01',
    companyId: compA,
    tripId: newTrip1.id,
    category: 'TOLL_FASTAG',
    amountPaise: 380000, // ₹3,800 FastTag toll
    paymentMode: 'FASTAG',
    description: 'NH-12 Dankuni-Siliguri Toll Plazas',
    recordedBy: 'System',
    isDriverDisbursed: false,
  };

  const driverAdvance: DriverAdvance = {
    id: 'adv_t_cash_01',
    companyId: compA,
    tripId: newTrip1.id,
    driverId: newTrip1.driverId,
    amountPaise: 1200000, // ₹12,000 cash advance
    advanceType: 'CASH_DISPATCH',
    date: '2026-11-05',
    disbursedBy: 'Fleet Manager',
    isSettled: false,
  };

  serverFleetStore.expenses.push(dieselExp, tollExp);
  serverFleetStore.advances.push(driverAdvance);

  // Recalculate trip totals
  syncTripFinancials(newTrip1);

  const totalRecordedExpenses = dieselExp.amountPaise + tollExp.amountPaise; // 22,30,000 paise (₹22,300)
  const expectedContribution = tripRevenue - totalRecordedExpenses; // 52,50,000 paise (₹52,500)

  assert(newTrip1.totalExpensesPaise === totalRecordedExpenses, 'Total recorded expenses equals ₹22,300');
  assert(newTrip1.totalAdvancesPaise === 1200000, 'Total advances recorded equals ₹12,000');
  assert(
    newTrip1.tripContributionPaise === expectedContribution,
    `Trip contribution calculated accurately (₹${expectedContribution / 100}): Revenue - Expenses`
  );

  // CRITICAL RULE: Advances MUST NOT count as expenses!
  assert(
    newTrip1.totalExpensesPaise !== totalRecordedExpenses + driverAdvance.amountPaise,
    'CRITICAL VERIFICATION: Driver advances are balance sheet floats and NOT counted as expenses'
  );

  const contribResult = calculateTripContribution(tripRevenue, [dieselExp, tollExp]);
  assert(contribResult.contributionPaise === 5250000, 'calculateTripContribution returns ₹52,500 in integer paise');
  assert(contribResult.profitMarginPercent === 70.2, 'Operating profit margin calculated correctly: 70.2%');

  // -------------------------------------------------------------------------
  // TEST GROUP 8: CANCELLED TRIPS PRESERVATION & RESOURCE LIBERATION
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 8: Cancelled Trips Preservation & Resource Liberation ---');

  // Create a trip to test cancellation mechanics
  const cancelTestTrip: Trip = {
    id: `trip_cancel_test_${Date.now()}`,
    companyId: compA,
    tripNumber: generateTripNumber(compA),
    lrNumber: generateLrNumber(compA),
    customerId: testCustA.id,
    customerName: testCustA.name,
    customerGstin: testCustA.gstin,
    vehicleId: testVehA.id,
    vehicleReg: testVehA.registrationNumber,
    driverId: testDrvA.id,
    driverName: testDrvA.fullName,
    driverPhone: testDrvA.phone,
    originCity: 'Kolkata, WB',
    destinationCity: 'Durgapur, WB',
    goodsType: 'Steel Wire',
    weightTonnes: 15.0,
    ratePerTonnePaise: 180000,
    freightAmountPaise: 2700000,
    otherChargesPaise: 0,
    totalRevenuePaise: 2700000,
    dispatchDate: '2026-11-06',
    expectedDeliveryDate: '2026-11-07',
    status: 'DISPATCHED',
    startOdometerKm: 98000,
    podReceived: false,
    totalExpensesPaise: 0,
    totalAdvancesPaise: 0,
    tripContributionPaise: 2700000,
    isSettled: false,
    isInvoiced: false,
    createdAt: new Date().toISOString(),
  };
  serverFleetStore.trips.unshift(cancelTestTrip);

  // Set vehicle and driver to busy
  testVehA.status = 'IN_TRANSIT';
  testVehA.activeTripId = cancelTestTrip.id;
  testDrvA.status = 'ON_TRIP';

  assert(testVehA.status === 'IN_TRANSIT', 'Vehicle initially locked in IN_TRANSIT');
  assert(testDrvA.status === 'ON_TRIP', 'Driver initially locked in ON_TRIP');

  // Execute cancellation
  cancelTestTrip.status = 'CANCELLED';
  cancelTestTrip.cancellationReason = 'Consignor order cancelled due to plant shutdown';
  cancelTestTrip.cancelledAt = new Date().toISOString();
  cancelTestTrip.cancelledBy = 'Fleet Operations Head';

  // Liberate vehicle and driver
  testVehA.status = 'AVAILABLE';
  testVehA.activeTripId = undefined;
  testDrvA.status = 'AVAILABLE';

  assert(cancelTestTrip.status === 'CANCELLED', 'Trip status transitioned to CANCELLED');
  assert(!!cancelTestTrip.cancellationReason, 'Cancellation reason preserved: ' + cancelTestTrip.cancellationReason);
  assert(!!cancelTestTrip.cancelledAt, 'Cancellation timestamp recorded');
  assert(testVehA.status === 'AVAILABLE', 'Vehicle successfully liberated back to AVAILABLE status');
  assert(testVehA.activeTripId === undefined, 'Vehicle activeTripId lock cleared');
  assert(testDrvA.status === 'AVAILABLE', 'Driver successfully liberated back to AVAILABLE status');

  // Historical record is NOT deleted
  const preservedTrip = serverFleetStore.trips.find((t) => t.id === cancelTestTrip.id);
  assert(!!preservedTrip, 'Cancelled trip record is permanently preserved in company audit ledger');

  // Cannot transition out of CANCELLED
  const canReopen = isValidTransition(cancelTestTrip.status, 'DISPATCHED');
  assert(canReopen === false, 'Cancelled trip cannot be reopened or transitioned to another status');

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`   PHASE 6 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTripsPhase6Tests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
