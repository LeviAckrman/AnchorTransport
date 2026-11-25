/**
 * AnchorTransport TMS - Trips Journal Comprehensive Test Suite
 *
 * Covers:
 * 1. Integer paise financial math & live expense breakdown summation
 * 2. Cancelled trips strictly excluded from summary totals
 * 3. Odometer distance auto-calculation & attachment validation
 * 4. Excel template builder & bulk import parser (valid + invalid rows + master linking)
 * 5. Operational isolation (never mutates live trips, vehicles, drivers, advances, or settlements;
 *    ReportsView defaults includeJournalTrips=false)
 * 6. Navigation placement (Trips Journal immediately below Dashboard in Sidebar & MobileNav)
 * 7. Firestore & Storage security rules enforcement (verified owner only, immutable audit fields)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

import {
  buildJournalExcelTemplateWorkbook,
  buildJournalSearchTokens,
  calculateJournalDistance,
  calculateJournalFinancials,
  extractAttachmentFileName,
  generateJournalTripId,
  isValidJournalAttachmentFile,
  parseJournalExcelBuffer,
  parseRupeesInputToPaise,
  summarizeJournalTrips,
} from '../lib/journalTripsHelpers';
import type { Customer, Driver, JournalTrip, Vehicle } from '../types/tms';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../..');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  FAIL: ${name} -> ${err?.message || err}`);
    failed++;
  }
}

console.log('\n=== TRIPS JOURNAL TEST SUITE ===\n');

// ---------------------------------------------------------------------------
// 1. Financial Calculations & Paise Precision
// ---------------------------------------------------------------------------
test('Financial calculations compute exact integer paise totals and net profit', () => {
  const freightPaise = parseRupeesInputToPaise('42,500.75');
  assert.equal(freightPaise, 4250075);

  const fin = calculateJournalFinancials(freightPaise, [
    { expenseName: 'Loading Charges', amountPaise: 150000, description: 'Dock labour' },
    { expenseName: 'Fuel Expenses', amountPaise: 1680025, description: 'Diesel pump' },
    { expenseName: 'Weighbridge Slip', amountPaise: 20000, description: 'Custom expense' },
    { expenseName: '', amountPaise: 50000, description: 'Ignored blank name' },
    { expenseName: 'Zero Item', amountPaise: 0, description: '' },
  ]);

  assert.equal(fin.expenses.length, 3);
  assert.equal(fin.totalExpensesPaise, 1850025);
  assert.equal(fin.profitPaise, 4250075 - 1850025);
  assert.equal(fin.profitPaise, 2400050);
});

test('Summary aggregation strictly excludes cancelled journal trips from revenue, expense, and profit', () => {
  const baseTrip: Omit<JournalTrip, 'journalTripId' | 'id' | 'status' | 'freightAmountPaise' | 'totalExpensesPaise' | 'profitPaise'> = {
    companyId: 'comp_1',
    tripDate: '2025-11-10T12:00:00.000Z',
    vehicleId: 'veh_1',
    vehicleNumber: 'WB-19-K-4821',
    driverId: 'drv_1',
    driverName: 'Ramesh Yadav',
    customerId: 'cust_1',
    customerName: 'Tata Steel',
    fromLocation: 'Jamshedpur',
    toLocation: 'Kolkata',
    entryType: 'historical',
    externalReferenceNumber: 'REG-1',
    expenses: [],
    odometerStart: 1000,
    odometerEnd: 1300,
    distanceTravelled: 300,
    notes: '',
    attachmentPaths: [],
    createdAt: '2025-11-10T12:00:00.000Z',
    updatedAt: '2025-11-10T12:00:00.000Z',
    createdBy: 'uid_owner',
    updatedBy: 'uid_owner',
  };

  const trips: JournalTrip[] = [
    {
      ...baseTrip,
      id: 'JTR-1',
      journalTripId: 'JTR-1',
      status: 'completed',
      freightAmountPaise: 5000000,
      totalExpensesPaise: 2000000,
      profitPaise: 3000000,
    },
    {
      ...baseTrip,
      id: 'JTR-2',
      journalTripId: 'JTR-2',
      status: 'cancelled',
      freightAmountPaise: 9900000,
      totalExpensesPaise: 1000000,
      profitPaise: 8900000,
    },
    {
      ...baseTrip,
      id: 'JTR-3',
      journalTripId: 'JTR-3',
      status: 'completed',
      freightAmountPaise: 2500000,
      totalExpensesPaise: 3000000,
      profitPaise: -500000,
    },
  ];

  const stats = summarizeJournalTrips(trips);
  assert.equal(stats.totalTripsCount, 3);
  assert.equal(stats.completedTripsCount, 2);
  assert.equal(stats.cancelledTripsCount, 1);
  assert.equal(stats.totalFreightRevenuePaise, 7500000);
  assert.equal(stats.totalExpensesPaise, 5000000);
  assert.equal(stats.totalProfitPaise, 2500000);
});

// ---------------------------------------------------------------------------
// 2. Odometer, IDs, Search Tokens & Attachments
// ---------------------------------------------------------------------------
test('Odometer distance auto-calculates or returns null when invalid', () => {
  assert.equal(calculateJournalDistance(124500, 124810.5), 310.5);
  assert.equal(calculateJournalDistance(1000, 900), null);
  assert.equal(calculateJournalDistance(null, 500), null);
});

test('Generated Journal Trip IDs follow readable JTR-YYMMDD-... format', () => {
  const id = generateJournalTripId();
  assert.match(id, /^JTR-\d{6}-[A-Z0-9]+$/);
});

test('Search tokens normalize vehicle registration, names, and trip ID for Firestore array-contains', () => {
  const tokens = buildJournalSearchTokens({
    journalTripId: 'JTR-251118-ABCD',
    vehicleNumber: 'WB-19-K-4821',
    driverName: 'Ramesh Yadav',
    customerName: 'Dalmia Cement',
    externalReferenceNumber: 'REG-104',
  });
  assert.ok(tokens.includes('wb19k4821'));
  assert.ok(tokens.includes('ramesh'));
  assert.ok(tokens.includes('dalmia'));
  assert.ok(tokens.includes('reg-104'));
  assert.ok(tokens.length <= 40);
});

test('Attachment validation accepts PDF/JPG/PNG <= 15MB and rejects >15MB or executable files', () => {
  assert.equal(
    isValidJournalAttachmentFile({ name: 'bilty.pdf', type: 'application/pdf', size: 1024 }).valid,
    true
  );
  assert.equal(
    isValidJournalAttachmentFile({ name: 'receipt.jpg', type: 'image/jpeg', size: 2048 }).valid,
    true
  );
  assert.equal(
    isValidJournalAttachmentFile({ name: 'huge.pdf', type: 'application/pdf', size: 16 * 1024 * 1024 })
      .valid,
    false
  );
  assert.equal(
    isValidJournalAttachmentFile({ name: 'script.exe', type: 'application/x-msdownload', size: 512 })
      .valid,
    false
  );
  assert.equal(
    extractAttachmentFileName('companies/comp_1/journalTrips/JTR-1/1760000000000_receipt.pdf'),
    'receipt.pdf'
  );
});

// ---------------------------------------------------------------------------
// 3. Excel Bulk Import Parser & Template Builder
// ---------------------------------------------------------------------------
test('Excel template workbook builds valid sample rows that round-trip cleanly through parser', () => {
  const wb = buildJournalExcelTemplateWorkbook();
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

  const mockVehicles: Vehicle[] = [
    {
      id: 'veh_tata_1',
      companyId: 'comp_1',
      registrationNumber: 'WB19K4821',
      vehicleType: '12-Wheeler (21T)',
      makeModel: 'Tata Prima',
      capacityTonnes: 21,
      unladenWeightTonnes: 9,
      chassisNumber: 'CHS123',
      engineNumber: 'ENG123',
      currentOdometerKm: 125000,
      fastagBalancePaise: 500000,
      status: 'AVAILABLE',
      createdAt: '',
    },
  ];
  const mockDrivers: Driver[] = [
    {
      id: 'drv_ramesh',
      companyId: 'comp_1',
      fullName: 'Ramesh Yadav',
      phone: '9876543210',
      licenseNumber: 'WB01-2019001',
      licenseExpiry: '2029-01-01',
      address: 'Kolkata',
      emergencyContact: 'Suresh',
      emergencyPhone: '9876543211',
      status: 'AVAILABLE',
      currentAdvanceBalancePaise: 0,
      totalTripsCompleted: 0,
      perDayBataPaise: 50000,
      joinedDate: '2022-01-01',
      monthlySalaryPaise: 2000000,
      createdAt: '',
    },
  ];
  const mockCustomers: Customer[] = [];

  const parsed = parseJournalExcelBuffer(buffer, {
    vehicles: mockVehicles,
    drivers: mockDrivers,
    customers: mockCustomers,
  });

  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.validRows.length, 2);
  assert.equal(parsed.invalidRows.length, 0);

  const row1 = parsed.validRows[0];
  assert.equal(row1.tripDateStr, '2025-11-18');
  assert.equal(row1.vehicleId, 'veh_tata_1'); // matched ignoring hyphens
  assert.equal(row1.driverId, 'drv_ramesh');
  assert.equal(row1.customerId, null); // preserved cleanly as manual text
  assert.equal(row1.customerName, 'Tata Steel Downstream Ltd');
  assert.equal(row1.freightAmountPaise, 4250000);
  assert.equal(row1.distanceTravelled, 310);
  assert.equal(row1.profitPaise, row1.freightAmountPaise - row1.totalExpensesPaise);
});

test('Excel parser isolates invalid rows with clear error reasons without crashing', () => {
  const sheet = XLSX.utils.json_to_sheet([
    {
      'Trip Date': '2025-10-05',
      'Vehicle Number': 'JH-01-AA-1234',
      'Driver Name': 'Amit Kumar',
      'Customer Name': 'Hindalco',
      'From Location': 'Renukoot',
      'To Location': 'Howrah',
      'Freight Amount (INR)': 30000,
      'Fuel Expenses (INR)': 10000,
      Status: 'cancelled',
    },
    {
      'Trip Date': '',
      'Vehicle Number': '',
      'Driver Name': 'Bad Row',
      'Customer Name': 'Party',
      'From Location': 'A',
      'To Location': 'B',
      'Freight Amount (INR)': -500,
    },
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Import');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

  const parsed = parseJournalExcelBuffer(buf);
  assert.equal(parsed.validRows.length, 1);
  assert.equal(parsed.invalidRows.length, 1);
  assert.ok(parsed.invalidRows[0].errors.length >= 2);
  // Row 1 is cancelled so completed totals must be 0
  assert.equal(parsed.totalFreightPaise, 0);
  assert.equal(parsed.totalProfitPaise, 0);
});

// ---------------------------------------------------------------------------
// 4. Architecture, Sidebar Placement, Reports Isolation & Security Rules
// ---------------------------------------------------------------------------
test('Sidebar and MobileNav place Trips Journal immediately below Dashboard without breaking existing tabs', () => {
  const sidebarSrc = fs.readFileSync(path.join(root, 'src/components/layout/Sidebar.tsx'), 'utf8');
  const mobileSrc = fs.readFileSync(path.join(root, 'src/components/layout/MobileNav.tsx'), 'utf8');

  const dashIdx = sidebarSrc.indexOf("id: 'dashboard'");
  const journalIdx = sidebarSrc.indexOf("id: 'journalTrips'");
  const tripsIdx = sidebarSrc.indexOf("id: 'trips'");
  assert.ok(dashIdx > 0 && journalIdx > dashIdx && tripsIdx > journalIdx, 'Sidebar order must be Dashboard -> Trips Journal -> Trips & Dispatch');

  const mDashIdx = mobileSrc.indexOf("id: 'dashboard'");
  const mJournalIdx = mobileSrc.indexOf("id: 'journalTrips'");
  const mTripsIdx = mobileSrc.indexOf("id: 'trips'");
  assert.ok(mDashIdx > 0 && mJournalIdx > mDashIdx && mTripsIdx > mJournalIdx, 'MobileNav order must be Dashboard -> Trips Journal -> Trips & Dispatch');
});

test('Trips Journal service & ReportsView preserve strict operational isolation', () => {
  const serviceSrc = fs.readFileSync(
    path.join(root, 'src/lib/firebase/journalTripsService.ts'),
    'utf8'
  );
  const reportsSrc = fs.readFileSync(
    path.join(root, 'src/modules/reports/ReportsView.tsx'),
    'utf8'
  );

  // Never writes to live operational collections
  assert.equal(/collection\([^)]*['"](trips|vehicles|drivers|driverAdvances|settlements|invoices)['"]/.test(serviceSrc), false);
  // Uses paginated & server aggregate Firestore queries
  assert.ok(serviceSrc.includes('limit('));
  assert.ok(serviceSrc.includes('startAfter('));
  assert.ok(serviceSrc.includes('getAggregateFromServer'));
  assert.ok(serviceSrc.includes('getCountFromServer'));

  // Reports default toggle is false
  assert.ok(reportsSrc.includes('useState<boolean>(false)'));
  assert.ok(reportsSrc.includes('Include Trips Journal (Historical / Offline)'));
});

test('Firestore rules and Storage rules enforce owner-only verified access and immutable journal audit fields', () => {
  const firestoreRules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  const storageRules = fs.readFileSync(path.join(root, 'storage.rules'), 'utf8');

  assert.ok(firestoreRules.includes('match /journalTrips/{journalTripId}'));
  assert.ok(firestoreRules.includes('function isValidJournalTrip('));
  assert.ok(firestoreRules.includes('isVerifiedCompanyOwner(companyId)'));
  assert.ok(firestoreRules.includes('incoming().journalTripId == existing().journalTripId'));
  assert.ok(firestoreRules.includes('incoming().createdBy == existing().createdBy'));
  assert.ok(firestoreRules.includes('incoming().createdAt == existing().createdAt'));
  assert.ok(firestoreRules.includes('data.profitPaise == data.freightAmountPaise - data.totalExpensesPaise'));

  assert.ok(storageRules.includes('match /users/{userId}/{allPaths=**}'));
  assert.ok(storageRules.includes('isVerifiedOwner(userId)'));
  assert.ok(storageRules.includes('isAllowedContentType()'));
  assert.ok(storageRules.includes('isUnderMaxFileSize()'));
});

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
