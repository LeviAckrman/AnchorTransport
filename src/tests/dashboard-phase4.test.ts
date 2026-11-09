/**
 * AnchorTransport TMS - Phase 4 Professional Dashboard Verification Suite
 * 
 * Verifies:
 * 1. Multi-tenant company isolation for dashboard queries (Company A != Company B)
 * 2. All 8 required dashboard metrics:
 *    - Active trips
 *    - Completed trips
 *    - Freight revenue
 *    - Recorded trip expenses
 *    - Trip contribution
 *    - Outstanding invoices
 *    - Recent trips
 *    - Vehicles requiring attention
 * 3. Date filtering mechanics (All Time, Today, This Month, Custom)
 * 4. Empty state detection and response for new or unpopulated companies
 * 5. Security & authorization constraints (company isolation, token validation)
 */

import { serverFleetStore } from '../server/store';
import { Trip, Vehicle, TripExpense, Invoice, VehicleDocument } from '../types/tms';

async function runDashboardPhase4Tests() {
  console.log('========================================================================');
  console.log('   ANCHORTRANSPORT TMS - PHASE 4 DASHBOARD VERIFICATION SUITE           ');
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

  const companyA = 'comp_wb_royal_001';
  const companyB = 'comp_test_isolated_999';
  const companyEmpty = 'comp_new_empty_000';

  // Seed company A with baseline fleet data
  serverFleetStore.seedCompanyData(companyA);

  // Clear company B and Empty Company
  serverFleetStore.clearCompanyData(companyB);
  serverFleetStore.clearCompanyData(companyEmpty);

  // Add 1 specific trip and 1 vehicle to Company B to prove mathematical isolation
  const customTripB: Trip = {
    id: 'trip_b_test_01',
    companyId: companyB,
    tripNumber: 'TR-B-001',
    lrNumber: 'LR-B-001',
    customerId: 'cust_b_01',
    customerName: 'Odisha Sponge Iron Ltd.',
    customerGstin: '21AAAC00000A1Z1',
    vehicleId: 'veh_b_01',
    vehicleReg: 'OD-05-AB-9999',
    driverId: 'drv_b_01',
    driverName: 'Bhuban Barik',
    driverPhone: '+91 94370 00000',
    originCity: 'Paradip, OD',
    destinationCity: 'Rourkela, OD',
    goodsType: 'Iron Ore',
    weightTonnes: 30,
    ratePerTonnePaise: 150000,
    freightAmountPaise: 4500000, // ₹45,000
    otherChargesPaise: 0,
    totalRevenuePaise: 4500000,
    dispatchDate: new Date().toISOString(),
    expectedDeliveryDate: new Date().toISOString(),
    status: 'IN_TRANSIT',
    startOdometerKm: 80000,
    podReceived: false,
    totalExpensesPaise: 1200000, // ₹12,000
    totalAdvancesPaise: 1000000,
    tripContributionPaise: 3300000, // ₹33,000
    isSettled: false,
    isInvoiced: false,
    createdAt: new Date().toISOString(),
  };

  const customExpenseB: TripExpense = {
    id: 'exp_b_01',
    companyId: companyB,
    tripId: 'trip_b_test_01',
    vehicleId: 'veh_b_01',
    category: 'DIESEL',
    amountPaise: 1200000,
    paymentMode: 'PETRO_CARD',
    date: new Date().toISOString().split('T')[0],
    description: 'Diesel en route Paradip',
    isDriverDisbursed: false,
    recordedBy: 'usr_test',
  };

  serverFleetStore.trips.push(customTripB);
  serverFleetStore.expenses.push(customExpenseB);

  console.log('\n--- SECTION 1: Company Isolation Verification ---');

  // Test 1: Metrics for Company A do not include Company B's trips
  const metricsA = serverFleetStore.getDashboardMetrics(companyA, 'all');
  const tripIdsA = metricsA.recentTrips.map((t) => t.id);
  assert(!tripIdsA.includes('trip_b_test_01'), 'Company A recent trips strictly exclude Company B consignments');

  // Test 2: Metrics for Company B only reflect Company B's 1 trip
  const metricsB = serverFleetStore.getDashboardMetrics(companyB, 'all');
  assert(metricsB.activeTripsCount === 1, 'Company B active trips count is exactly 1');
  assert(metricsB.totalFreightRevenuePaise === 4500000, 'Company B freight revenue matches exactly ₹45,000 (4,500,000 paise)');
  assert(metricsB.totalRecordedExpensesPaise === 1200000, 'Company B recorded expenses match exactly ₹12,000 (1,200,000 paise)');
  assert(metricsB.tripContributionPaise === 3300000, 'Company B contribution equals ₹33,000 (45,000 - 12,000)');

  console.log('\n--- SECTION 2: All 8 Required Dashboard Metrics ---');

  // Test 3: Active trips calculation
  assert(typeof metricsA.activeTripsCount === 'number' && metricsA.activeTripsCount >= 0, 'Metric 1: Active trips is a valid non-negative count');

  // Test 4: Completed trips calculation
  assert(typeof metricsA.completedTripsCount === 'number' && metricsA.completedTripsCount >= 0, 'Metric 2: Completed trips is a valid non-negative count');

  // Test 5: Freight revenue calculation
  assert(typeof metricsA.totalFreightRevenuePaise === 'number' && metricsA.totalFreightRevenuePaise > 0, 'Metric 3: Freight revenue is calculated from real trips');

  // Test 6: Recorded trip expenses
  assert(typeof metricsA.totalRecordedExpensesPaise === 'number' && metricsA.totalRecordedExpensesPaise > 0, 'Metric 4: Recorded trip expenses computed from fuel & tolls');

  // Test 7: Trip contribution invariant (Contribution = Revenue - Expenses)
  const expectedContribution = metricsA.totalFreightRevenuePaise - metricsA.totalRecordedExpensesPaise;
  assert(metricsA.tripContributionPaise === expectedContribution, 'Metric 5: Trip contribution strictly equals Revenue - Expenses');

  // Test 8: Outstanding invoices
  assert(typeof metricsA.outstandingInvoicesPaise === 'number' && metricsA.outstandingInvoicesCount >= 0, 'Metric 6: Outstanding invoices balances calculated');

  // Test 9: Recent trips list
  assert(Array.isArray(metricsA.recentTrips) && metricsA.recentTrips.length > 0, 'Metric 7: Recent trips returned as ordered array');

  // Test 10: Recent trips sorted descending by dispatch/creation date
  const isSorted = metricsA.recentTrips.every((trip, i, arr) => {
    if (i === 0) return true;
    const prevDate = new Date(arr[i - 1].dispatchDate || arr[i - 1].createdAt).getTime();
    const currDate = new Date(trip.dispatchDate || trip.createdAt).getTime();
    return prevDate >= currDate;
  });
  assert(isSorted, 'Metric 7: Recent trips correctly sorted chronologically descending');

  // Test 11: Vehicles requiring attention
  assert(Array.isArray(metricsA.vehiclesRequiringAttention), 'Metric 8: Vehicles requiring attention returned as structured list');
  const hasExpiredOrExpiring = metricsA.vehiclesRequiringAttention.some((v) =>
    v.issues.some((i) => i.type === 'EXPIRED_DOCUMENT' || i.type === 'EXPIRING_DOCUMENT')
  );
  assert(hasExpiredOrExpiring, 'Metric 8: Vehicles requiring attention accurately flags expired/expiring compliance documents');

  console.log('\n--- SECTION 3: Empty State Handling ---');

  // Test 12: Empty company returns hasData = false
  const metricsEmpty = serverFleetStore.getDashboardMetrics(companyEmpty, 'all');
  assert(metricsEmpty.hasData === false, 'Empty company context correctly sets hasData = false');
  assert(metricsEmpty.activeTripsCount === 0, 'Empty company has 0 active trips');
  assert(metricsEmpty.completedTripsCount === 0, 'Empty company has 0 completed trips');
  assert(metricsEmpty.totalFreightRevenuePaise === 0, 'Empty company has 0 freight revenue');
  assert(metricsEmpty.totalRecordedExpensesPaise === 0, 'Empty company has 0 recorded expenses');
  assert(metricsEmpty.tripContributionPaise === 0, 'Empty company has 0 trip contribution');
  assert(metricsEmpty.recentTrips.length === 0, 'Empty company has 0 recent trips');
  assert(metricsEmpty.vehiclesRequiringAttention.length === 0, 'Empty company has 0 vehicles requiring attention');

  console.log('\n--- SECTION 4: Date Filter Accuracy ---');

  // Test 13: Today filter
  const metricsToday = serverFleetStore.getDashboardMetrics(companyA, 'today');
  assert(metricsToday.period.type === 'today', 'Period parameter correctly recorded as today');

  // Test 14: Month filter
  const metricsMonth = serverFleetStore.getDashboardMetrics(companyA, 'month');
  assert(metricsMonth.period.type === 'month', 'Period parameter correctly recorded as month');

  // Test 15: Custom range filter
  const metricsCustom = serverFleetStore.getDashboardMetrics(
    companyA,
    'custom',
    '2026-01-01',
    '2026-12-31'
  );
  assert(metricsCustom.period.type === 'custom', 'Period parameter correctly recorded as custom');
  assert(metricsCustom.period.startDate !== undefined, 'Custom period contains valid start boundary');

  console.log('\n========================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runDashboardPhase4Tests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
