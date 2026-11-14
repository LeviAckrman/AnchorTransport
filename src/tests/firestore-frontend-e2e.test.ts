/**
 * AnchorTransport TMS - Firestore-Only Frontend E2E & Architecture Verification Suite
 *
 * Validates:
 * 1. Client-side calculation engine (dashboard metrics, trip/vehicle/expense/receivables/monthly reports, aging, numbering, CSV export).
 * 2. Architectural guarantee: every operational frontend module & component reads exclusively from Firestore (zero mockData, zero localStorage store, zero operational REST API fetches).
 * 3. Auth & Listener lifecycle guarantee: onAuthStateChanged verification, synchronous listener unsubscription & frontend state cleanup on logout without deleting Firestore documents.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  computeDashboardMetrics,
  computeTripReport,
  computeVehicleReport,
  computeExpenseReport,
  computeReceivablesReport,
  computeMonthlyPerformanceReport,
  computeCustomerReceivablesAging,
  getNextTripNumber,
  getNextLrNumber,
  getNextInvoiceNumber,
  getNextSettlementNumber,
  buildCsvString,
  REPORT_ACCOUNTING_DISCLAIMER,
} from '../lib/tmsCalculations';
import type {
  Company,
  Customer,
  Driver,
  Invoice,
  MaintenanceRecord,
  Payment,
  Trip,
  TripExpense,
  Vehicle,
  VehicleDocument,
} from '../types/tms';

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

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

async function runTests() {
  console.log('========================================================================');
  console.log('  ANCHORTRANSPORT TMS - FIRESTORE FRONTEND E2E VERIFICATION SUITE       ');
  console.log('========================================================================\n');

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const pastDue = new Date(today.getTime() - 45 * 86400 * 1000).toISOString().split('T')[0];
  const expiredDocDate = new Date(today.getTime() - 5 * 86400 * 1000).toISOString().split('T')[0];
  const expiringSoonDate = new Date(today.getTime() + 10 * 86400 * 1000).toISOString().split('T')[0];

  const company: Company = {
    id: 'comp_e2e_001',
    name: 'Anchor Freight Movers Pvt Ltd',
    tradeName: 'Anchor Freight',
    gstin: '19AABCA1234F1Z5',
    pan: 'AABCA1234F',
    phone: '9830011223',
    email: 'ops@anchorfreight.in',
    address: 'NH-6 Kona',
    city: 'Howrah',
    state: 'West Bengal',
    stateCode: '19',
    pincode: '711114',
    bankName: 'HDFC',
    accountNumber: '50200011223344',
    ifscCode: 'HDFC0000214',
    branch: 'Kona',
    lrPrefix: 'AF/26-27/',
    invoicePrefix: 'INV/26-27/',
    tripPrefix: 'TR-',
    createdAt: today.toISOString(),
  };

  const vehicles: Vehicle[] = [
    {
      id: 'veh_1',
      companyId: company.id,
      registrationNumber: 'WB-11-AB-1001',
      vehicleType: '12-Wheeler (21T)',
      makeModel: 'Tata Prima 2825',
      capacityTonnes: 25,
      unladenWeightTonnes: 9.5,
      chassisNumber: 'MAT1234567890001',
      engineNumber: 'ENG1234567890001',
      status: 'IN_TRANSIT',
      currentOdometerKm: 120000,
      fastagBalancePaise: 90000, // Low FastTag (< 150000)
      createdAt: today.toISOString(),
    },
    {
      id: 'veh_2',
      companyId: company.id,
      registrationNumber: 'WB-11-CD-2002',
      vehicleType: '10-Wheeler (16T)',
      makeModel: 'Ashok Leyland 2820',
      capacityTonnes: 16,
      unladenWeightTonnes: 7.5,
      chassisNumber: 'AL1234567890002',
      engineNumber: 'ALENG1234567890002',
      status: 'UNDER_MAINTENANCE',
      currentOdometerKm: 95000,
      fastagBalancePaise: 300000,
      createdAt: today.toISOString(),
    },
  ];

  const drivers: Driver[] = [
    {
      id: 'drv_1',
      companyId: company.id,
      fullName: 'Subrata Mondal',
      phone: '9830100001',
      licenseNumber: 'WB01-2020001234',
      licenseExpiry: '2030-01-01',
      address: 'Howrah, WB',
      emergencyContact: 'Rina Mondal',
      emergencyPhone: '9830100099',
      status: 'ON_TRIP',
      currentAdvanceBalancePaise: 500000,
      totalTripsCompleted: 14,
      perDayBataPaise: 50000,
      joinedDate: todayStr,
    },
  ];

  const customers: Customer[] = [
    {
      id: 'cust_1',
      companyId: company.id,
      name: 'Bengal Steel Industries',
      gstin: '19AAACB5555K1Z2',
      pan: 'AAACB5555K',
      contactPerson: 'S. Chatterjee',
      phone: '9830200002',
      email: 'billing@bengalsteel.in',
      billingAddress: 'Plot 12, Durgapur Industrial Area',
      city: 'Durgapur',
      state: 'West Bengal',
      stateCode: '19',
      pincode: '713201',
      creditPeriodDays: 30,
      paymentTermsDays: 30,
      creditLimitPaise: 50000000,
      currentOutstandingPaise: 7000000,
      totalFreightBilledPaise: 12000000,
      createdAt: today.toISOString(),
    },
  ];

  const trips: Trip[] = [
    {
      id: 'trip_1',
      companyId: company.id,
      tripNumber: 'TR-2026-0001',
      lrNumber: 'AF/26-27/0001',
      customerId: 'cust_1',
      customerName: 'Bengal Steel Industries',
      customerGstin: '19AAACB5555K1Z2',
      vehicleId: 'veh_1',
      vehicleReg: 'WB-11-AB-1001',
      driverId: 'drv_1',
      driverName: 'Subrata Mondal',
      driverPhone: '9830100001',
      originCity: 'Howrah',
      destinationCity: 'Durgapur',
      goodsType: 'TMT Bars',
      weightTonnes: 25,
      ratePerTonnePaise: 200000,
      freightAmountPaise: 5000000, // ₹50,000
      otherChargesPaise: 0,
      totalRevenuePaise: 5000000,
      dispatchDate: todayStr,
      expectedDeliveryDate: todayStr,
      status: 'IN_TRANSIT',
      startOdometerKm: 120000,
      podReceived: false,
      totalExpensesPaise: 1500000,
      totalAdvancesPaise: 500000,
      tripContributionPaise: 3500000,
      isSettled: false,
      isInvoiced: false,
      createdAt: today.toISOString(),
    },
    {
      id: 'trip_2',
      companyId: company.id,
      tripNumber: 'TR-2026-0002',
      lrNumber: 'AF/26-27/0002',
      customerId: 'cust_1',
      customerName: 'Bengal Steel Industries',
      customerGstin: '19AAACB5555K1Z2',
      vehicleId: 'veh_2',
      vehicleReg: 'WB-11-CD-2002',
      driverId: 'drv_1',
      driverName: 'Subrata Mondal',
      driverPhone: '9830100001',
      originCity: 'Haldia',
      destinationCity: 'Siliguri',
      goodsType: 'Cement',
      weightTonnes: 16,
      ratePerTonnePaise: 250000,
      freightAmountPaise: 4000000, // ₹40,000
      otherChargesPaise: 0,
      totalRevenuePaise: 4000000,
      dispatchDate: todayStr,
      expectedDeliveryDate: todayStr,
      status: 'COMPLETED',
      startOdometerKm: 94000,
      endOdometerKm: 95000,
      podReceived: true,
      totalExpensesPaise: 1000000,
      totalAdvancesPaise: 0,
      tripContributionPaise: 3000000,
      isSettled: false,
      isInvoiced: true,
      invoiceId: 'inv_1',
      createdAt: today.toISOString(),
    },
  ];

  const expenses: TripExpense[] = [
    {
      id: 'exp_1',
      companyId: company.id,
      tripId: 'trip_1',
      vehicleId: 'veh_1',
      category: 'DIESEL',
      amountPaise: 1200000,
      paymentMode: 'PETRO_CARD',
      date: todayStr,
      description: 'Diesel NH-6',
      isDriverDisbursed: false,
      recordedBy: 'uid_1',
    },
    {
      id: 'exp_2',
      companyId: company.id,
      tripId: 'trip_1',
      vehicleId: 'veh_1',
      category: 'TOLL_FASTAG',
      amountPaise: 300000,
      paymentMode: 'FASTAG',
      date: todayStr,
      description: 'Dankuni Toll',
      isDriverDisbursed: false,
      recordedBy: 'uid_1',
    },
    {
      id: 'exp_3',
      companyId: company.id,
      tripId: 'trip_2',
      vehicleId: 'veh_2',
      category: 'EN_ROUTE_REPAIR',
      amountPaise: 1000000,
      paymentMode: 'CASH',
      date: todayStr,
      description: 'Leaf spring repair',
      isDriverDisbursed: true,
      recordedBy: 'uid_1',
    },
  ];

  const invoices: Invoice[] = [
    {
      id: 'inv_1',
      companyId: company.id,
      invoiceNumber: 'INV/26-27/001',
      tripId: 'trip_2',
      tripNumber: 'TR-2026-0002',
      lrNumber: 'AF/26-27/0002',
      customerId: 'cust_1',
      customerName: 'Bengal Steel Industries',
      customerGstin: '19AAACB5555K1Z2',
      freightAmountPaise: 4000000,
      otherChargesPaise: 0,
      taxableAmountPaise: 4000000,
      isRcmApplicable: true,
      gstRatePercent: 5,
      cgstRatePercent: 0,
      sgstRatePercent: 0,
      igstRatePercent: 0,
      cgstAmountPaise: 0,
      sgstAmountPaise: 0,
      igstAmountPaise: 0,
      totalTaxPaise: 0,
      totalAmountPaise: 4000000,
      amountPaidPaise: 1000000,
      balanceDuePaise: 3000000,
      issueDate: pastDue,
      dueDate: pastDue,
      status: 'PARTIALLY_PAID',
      paymentStatus: 'PARTIALLY_PAID',
      createdAt: today.toISOString(),
    },
    {
      id: 'inv_cancelled',
      companyId: company.id,
      invoiceNumber: 'INV/26-27/002',
      tripId: 'trip_1',
      tripNumber: 'TR-2026-0001',
      lrNumber: 'AF/26-27/0001',
      customerId: 'cust_1',
      customerName: 'Bengal Steel Industries',
      customerGstin: '19AAACB5555K1Z2',
      freightAmountPaise: 5000000,
      otherChargesPaise: 0,
      taxableAmountPaise: 5000000,
      isRcmApplicable: true,
      gstRatePercent: 5,
      cgstRatePercent: 0,
      sgstRatePercent: 0,
      igstRatePercent: 0,
      cgstAmountPaise: 0,
      sgstAmountPaise: 0,
      igstAmountPaise: 0,
      totalTaxPaise: 0,
      totalAmountPaise: 5000000,
      amountPaidPaise: 0,
      balanceDuePaise: 5000000,
      issueDate: todayStr,
      dueDate: todayStr,
      status: 'CANCELLED',
      paymentStatus: 'UNPAID',
      createdAt: today.toISOString(),
    },
  ];

  const payments: Payment[] = [
    {
      id: 'pay_1',
      companyId: company.id,
      invoiceId: 'inv_1',
      invoiceNumber: 'INV/26-27/001',
      customerId: 'cust_1',
      customerName: 'Bengal Steel Industries',
      amountPaise: 960000,
      tdsDeductedPaise: 40000,
      paymentDate: todayStr,
      paymentMode: 'NEFT_RTGS',
      referenceNumber: 'UTR99887766',
      recordedBy: 'uid_1',
      createdAt: today.toISOString(),
    },
  ];

  const documents: VehicleDocument[] = [
    {
      id: 'doc_1',
      companyId: company.id,
      vehicleId: 'veh_1',
      vehicleReg: 'WB-11-AB-1001',
      docType: 'INSURANCE',
      documentNumber: 'POL-1234',
      issuingAuthority: 'Commercial Motor Insurer',
      issueDate: todayStr,
      expiryDate: expiredDocDate,
      daysUntilExpiry: -5,
      status: 'EXPIRED',
    },
    {
      id: 'doc_2',
      companyId: company.id,
      vehicleId: 'veh_2',
      vehicleReg: 'WB-11-CD-2002',
      docType: 'PUC',
      documentNumber: 'PUC-5678',
      issuingAuthority: 'Emission Testing Centre',
      issueDate: todayStr,
      expiryDate: expiringSoonDate,
      daysUntilExpiry: 10,
      status: 'EXPIRING_SOON',
    },
  ];

  const maintenance: MaintenanceRecord[] = [
    {
      id: 'mnt_1',
      companyId: company.id,
      vehicleId: 'veh_2',
      vehicleReg: 'WB-11-CD-2002',
      serviceType: 'BRAKE_SUSPENSION',
      garageName: 'Kona Truck Care',
      costPaise: 450000,
      odometerReading: 95000,
      serviceDate: todayStr,
    },
  ];

  console.log('--- SECTION 1: Dashboard Metrics & Reporting Calculations ---');

  const emptyMetrics = computeDashboardMetrics({
    trips: [],
    vehicles: [],
    expenses: [],
    invoices: [],
    documents: [],
    period: 'all',
  });
  assert(emptyMetrics.hasData === false && emptyMetrics.totalFreightRevenuePaise === 0, 'Empty Firestore bundle reports hasData=false and zero revenue');

  const metrics = computeDashboardMetrics({
    trips,
    vehicles,
    expenses,
    invoices,
    documents,
    period: 'all',
  });
  assert(metrics.hasData === true, 'Populated Firestore bundle reports hasData=true');
  assert(metrics.activeTripsCount === 1, 'Active trips count equals 1');
  assert(metrics.completedTripsCount === 1, 'Completed trips count equals 1');
  assert(metrics.totalFreightRevenuePaise === 9000000, 'Total freight revenue equals ₹90,000 (9,000,000 paise)');
  assert(metrics.totalRecordedExpensesPaise === 2500000, 'Total expenses equals ₹25,000 (2,500,000 paise)');
  assert(metrics.tripContributionPaise === 6500000, 'Trip contribution equals Revenue - Expenses (₹65,000)');
  assert(metrics.outstandingInvoicesPaise === 3000000 && metrics.outstandingInvoicesCount === 1, 'Cancelled invoice excluded from outstanding invoices');
  assert(metrics.vehiclesRequiringAttention.length === 2, 'Vehicles requiring attention flags expired doc, low FastTag, and maintenance');

  const tripRep = computeTripReport({ trips, vehicles, drivers, customers, expenses });
  assert(tripRep.summary.totalTrips === 2 && tripRep.summary.totalTripContributionPaise === 6500000, 'Trip report calculates 2 trips and ₹65,000 contribution');
  assert(tripRep.disclaimer === REPORT_ACCOUNTING_DISCLAIMER, 'Trip report includes standard operational disclaimer');

  const vehRep = computeVehicleReport({ vehicles, trips, expenses, maintenance }, { vehicleId: 'veh_2' });
  assert(
    vehRep.vehicles.length === 1 && vehRep.vehicles[0].maintenanceCostsPaise === 1450000,
    'Vehicle report combines repair expenses (10L paise) + maintenance records (4.5L paise)'
  );

  const expRep = computeExpenseReport({ expenses, vehicles, trips });
  assert(
    expRep.summary.totalCount === 3 &&
      expRep.summary.totalExpensePaise === 2500000 &&
      expRep.summary.categoryTotals['DIESEL'] === 1200000,
    'Expense report aggregates category totals accurately'
  );

  const recRep = computeReceivablesReport({ customers, invoices });
  assert(
    recRep.summary.totalInvoices === 1 &&
      recRep.summary.totalOutstandingBalancePaise === 3000000 &&
      recRep.summary.totalOverdueBalancePaise === 3000000,
    'Receivables report excludes cancelled invoices and flags overdue balances'
  );

  const monthlyRep = computeMonthlyPerformanceReport({ trips, expenses, invoices }, 6);
  assert(
    monthlyRep.months.length === 6 &&
      monthlyRep.summary.totalFreightRevenuePaise === 9000000 &&
      monthlyRep.summary.totalTripContributionPaise === 6500000,
    'Monthly performance report rolls up 6 months accurately'
  );

  const aging = computeCustomerReceivablesAging({ customers, invoices, payments });
  assert(
    aging.summary.totalOutstandingPaise === 3000000 &&
      aging.summary.agingBuckets.days31to60Paise === 3000000 &&
      aging.summary.totalTdsDeductedPaise === 40000,
    'Customer receivables aging classifies 45-day-old balance into 31-60 bucket & sums TDS'
  );

  console.log('\n--- SECTION 2: Sequential Numbering & RFC 4180 CSV Export ---');

  assert(
    getNextTripNumber(trips, company) === `TR-${today.getFullYear()}-0003`,
    'getNextTripNumber increments highest existing trip suffix'
  );
  assert(getNextLrNumber(trips, company) === 'AF/26-27/0003', 'getNextLrNumber increments highest LR suffix');
  assert(getNextInvoiceNumber(invoices, company) === 'INV/26-27/003', 'getNextInvoiceNumber increments highest invoice suffix');
  assert(
    getNextSettlementNumber(0, [{ settlementNumber: `STL-${today.getFullYear()}-0007` }]) ===
      `STL-${today.getFullYear()}-0008`,
    'getNextSettlementNumber increments highest settlement suffix'
  );

  const csv = buildCsvString(['Col,1', 'Col"2'], [['a,b', 'c"d']], '# Header');
  assert(csv.includes('"a,b","c""d"') && csv.startsWith('# Header\n'), 'buildCsvString escapes commas/quotes per RFC 4180');

  console.log('\n--- SECTION 3: Static Architecture & Logout Isolation Audit ---');

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(__dirname, '../..');
  const frontendFiles = [
    ...collectTsFiles(path.join(root, 'src/modules')),
    ...collectTsFiles(path.join(root, 'src/components')),
    path.join(root, 'src/App.tsx'),
    path.join(root, 'src/context/FirestoreDataContext.tsx'),
  ];

  const legacyTokenViolations: string[] = [];
  const legacyApiViolations: string[] = [];

  const forbiddenApiPattern =
    /\/api\/(vehicles|drivers|customers|trips|expenses|advances|settlements|invoices|payments|fleet|reports|dashboard|documents|maintenance|company\/users|company\/invite-user)/;

  for (const file of frontendFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const rel = path.relative(root, file);
    if (/(mockData|loadStore|saveStore|clearStoreForNewCustomer|syncEntityToFirestore)/.test(content)) {
      legacyTokenViolations.push(rel);
    }
    if (forbiddenApiPattern.test(content)) {
      legacyApiViolations.push(rel);
    }
  }

  assert(
    legacyTokenViolations.length === 0,
    'Zero mockData/localStorage-store/syncEntityToFirestore references in frontend UI',
    legacyTokenViolations.join(', ')
  );
  assert(
    legacyApiViolations.length === 0,
    'Zero operational REST /api/* calls in frontend modules, components, or FirestoreDataContext',
    legacyApiViolations.join(', ')
  );

  const fsContextSrc = fs.readFileSync(path.join(root, 'src/context/FirestoreDataContext.tsx'), 'utf8');
  assert(
    fsContextSrc.includes('registerLogoutCleanup') &&
      fsContextSrc.includes('unsubscribeRef.current()') &&
      fsContextSrc.includes('clearFrontendOperationalState()') &&
      !/deleteDoc|clearCompanyOperationalDataInFirestore|clearCompanyTripsDataInFirestore/.test(fsContextSrc),
    'FirestoreDataContext unsubscribes active listeners and clears frontend state on logout without deleting Firestore docs'
  );

  const authContextSrc = fs.readFileSync(path.join(root, 'src/context/AuthContext.tsx'), 'utf8');
  assert(
    authContextSrc.includes('onFirebaseAuthStateChange') &&
      authContextSrc.includes('runLogoutCleanupsSynchronously()') &&
      authContextSrc.includes('logoutFirebaseUser()') &&
      !/clearCompanyOperationalDataInFirestore|deleteDoc/.test(authContextSrc),
    'AuthContext uses onAuthStateChanged and cleans up listeners/session on logout without deleting Firestore docs'
  );

  console.log('\n========================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('E2E test failure:', err);
  process.exit(1);
});
