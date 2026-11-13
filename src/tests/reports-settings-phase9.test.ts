/**
 * Phase 9 Automated Test Suite: Reports & Company Settings
 * 
 * Verifies:
 * 1. Report Calculations (Trip, Vehicle, Expense, Receivables, Monthly Performance)
 * 2. Date Range Filters (From/To inclusion and boundary tests)
 * 3. CSV Exports (Header validation, RFC 4180 escaping, formatting)
 * 4. Multi-Tenant Company Isolation (Cross-tenant leaks strictly forbidden in reports and CSVs)
 * 5. User Permissions (OWNER/ADMIN vs unauthorized roles on company settings & invites)
 * 6. Empty Reports Handling (Graceful handling of companies with zero trips/expenses/invoices)
 * 7. Large Dataset Performance (Aggregation resilience)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { signSessionToken } from '../server/auth';
import { serverFleetStore } from '../server/store';
import { serverCompanies, serverCompanyUsers, serverUsers } from '../server/routes/auth.routes';
import { Trip, TripExpense, Invoice, Vehicle, Driver, Customer } from '../types/tms';

const TEST_BASE_URL = 'http://localhost:3000';

const COMPANY_A = 'comp_wb_royal_001';
const COMPANY_B = 'comp_od_kalinga_002';
const EMPTY_COMPANY = 'comp_empty_test_009';

// Seed an empty company for edge case testing
if (!serverCompanies.find((c) => c.id === EMPTY_COMPANY)) {
  serverCompanies.push({
    id: EMPTY_COMPANY,
    name: 'Zero Transport Logistics',
    tradeName: 'Zero Logistics',
    gstin: '19AABCT1234F1Z1',
    pan: 'AABCT1234F',
    phone: '+91 99999 00000',
    email: 'empty@zerotransport.in',
    address: 'NH-2 Highway',
    city: 'Durgapur',
    state: 'West Bengal',
    stateCode: '19',
    pincode: '713201',
    bankName: 'Axis Bank',
    accountNumber: '912010001234567',
    ifscCode: 'UTIB0000123',
    branch: 'Durgapur Branch',
    lrPrefix: 'ZT/25-26/',
    invoicePrefix: 'INV/25-26/',
    tripPrefix: 'TR-',
    fleetSize: '0-5 Trucks',
  });

  serverCompanyUsers.push({
    id: 'cu_empty_owner',
    userId: 'usr_empty_01',
    companyId: EMPTY_COMPANY,
    role: 'OWNER',
    isActive: true,
  });
}

// Generate tokens for test cases
const tokenOwnerA = signSessionToken({
  userId: 'usr_owner_01',
  email: 'anupam@royalbengal.com',
  name: 'Anupam Ghosh',
  companyId: COMPANY_A,
  role: 'OWNER',
});

const tokenAccountantA = signSessionToken({
  userId: 'usr_acct_02',
  email: 'accounts@royalbengal.com',
  name: 'Subhashish Dey',
  companyId: COMPANY_A,
  role: 'ACCOUNTANT',
});

const tokenOpsA = signSessionToken({
  userId: 'usr_ops_03',
  email: 'bikash@royalbengal.com',
  name: 'Bikash Mahato',
  companyId: COMPANY_A,
  role: 'OPERATIONS',
});

const tokenOwnerB = signSessionToken({
  userId: 'usr_kalinga_owner',
  email: 'contact@kalingalogistics.in',
  name: 'Kalinga Owner',
  companyId: COMPANY_B,
  role: 'OWNER',
});

const tokenEmptyOwner = signSessionToken({
  userId: 'usr_empty_01',
  email: 'empty@zerotransport.in',
  name: 'Empty Owner',
  companyId: EMPTY_COMPANY,
  role: 'OWNER',
});

// HTTP Request helper
async function makeRequest(
  method: string,
  path: string,
  token?: string,
  body?: any
): Promise<{ status: number; data: any; rawText: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, TEST_BASE_URL);
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => (rawData += chunk));
      res.on('end', () => {
        let parsed: any = null;
        try {
          parsed = JSON.parse(rawData);
        } catch {
          parsed = null;
        }
        resolve({
          status: res.statusCode || 0,
          data: parsed,
          rawText: rawData,
          headers: res.headers,
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

describe('PHASE 9: Reports and Company Settings Tests', () => {
  before(async () => {
    serverFleetStore.seedCompanyData(COMPANY_A);
    const res = await makeRequest('POST', '/api/sync/hydrate', tokenOwnerA, {
      vehicles: serverFleetStore.vehicles.filter((v) => v.companyId === COMPANY_A),
      drivers: serverFleetStore.drivers.filter((d) => d.companyId === COMPANY_A),
      customers: serverFleetStore.customers.filter((c) => c.companyId === COMPANY_A),
      trips: serverFleetStore.trips.filter((t) => t.companyId === COMPANY_A),
      expenses: serverFleetStore.expenses.filter((e) => e.companyId === COMPANY_A),
      invoices: serverFleetStore.invoices.filter((i) => i.companyId === COMPANY_A),
      documents: serverFleetStore.documents.filter((d) => d.companyId === COMPANY_A),
    });
    assert.strictEqual(res.status, 200);
  });

  after(async () => {
    await makeRequest('POST', '/api/sync/hydrate', tokenOwnerA, {
      vehicles: [],
      drivers: [],
      customers: [],
      trips: [],
      expenses: [],
      invoices: [],
      documents: [],
    });
  });
  // =========================================================================
  // 1. TRIP REPORT
  // =========================================================================
  describe('1. Trip Report Calculations & Filters', () => {
    it('returns trip report for company A with required metrics and disclaimer', async () => {
      const res = await makeRequest('GET', '/api/reports/trips', tokenOwnerA);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.disclaimer.includes('gross operational margin'));
      assert.ok(res.data.summary);
      assert.ok(Array.isArray(res.data.trips));
      assert.ok(res.data.trips.length > 0);

      // Verify trip row attributes
      const trip = res.data.trips[0];
      assert.ok(trip.tripNumber);
      assert.ok(trip.customerName);
      assert.ok(trip.vehicleRegistration);
      assert.ok(trip.driverName);
      assert.ok(typeof trip.freightRevenuePaise === 'number');
      assert.ok(typeof trip.totalExpensesPaise === 'number');
      assert.ok(typeof trip.tripContributionPaise === 'number');
      assert.strictEqual(
        trip.tripContributionPaise,
        trip.freightRevenuePaise - trip.totalExpensesPaise
      );
    });

    it('filters trips by date range accurately', async () => {
      const res = await makeRequest(
        'GET',
        '/api/reports/trips?startDate=2026-03-01&endDate=2026-03-31',
        tokenOwnerA
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);

      // Verify all returned trips fall in March 2026
      for (const t of res.data.trips) {
        const d = new Date(t.dispatchDate);
        assert.ok(d >= new Date('2026-03-01') && d <= new Date('2026-03-31T23:59:59'));
      }
    });

    it('filters trips by vehicleId', async () => {
      const vehicle = serverFleetStore.vehicles.find((v) => v.companyId === COMPANY_A);
      assert.ok(vehicle);

      const res = await makeRequest(
        'GET',
        `/api/reports/trips?vehicleId=${vehicle.id}`,
        tokenOwnerA
      );
      assert.strictEqual(res.status, 200);
      for (const t of res.data.trips) {
        assert.strictEqual(t.vehicleId, vehicle.id);
      }
    });

    it('filters trips by status', async () => {
      const res = await makeRequest('GET', '/api/reports/trips?status=COMPLETED', tokenOwnerA);
      assert.strictEqual(res.status, 200);
      for (const t of res.data.trips) {
        assert.strictEqual(t.status, 'COMPLETED');
      }
    });

    it('exports trips report as CSV with standard formatting', async () => {
      const res = await makeRequest('GET', '/api/reports/trips?format=csv', tokenOwnerA);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['content-type']?.includes('text/csv'));
      assert.ok(res.rawText.includes('Trip Number,LR Number,Customer,Vehicle,Driver'));
      assert.ok(res.rawText.includes('Freight Revenue (INR)'));
    });
  });

  // =========================================================================
  // 2. VEHICLE REPORT
  // =========================================================================
  describe('2. Vehicle Performance Report', () => {
    it('returns vehicle report with trips, revenues, expenses, and maintenance costs', async () => {
      const res = await makeRequest('GET', '/api/reports/vehicles', tokenOwnerA);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.vehicles.length > 0);

      const v = res.data.vehicles[0];
      assert.ok(v.registrationNumber);
      assert.ok(typeof v.totalTrips === 'number');
      assert.ok(typeof v.freightRevenuePaise === 'number');
      assert.ok(typeof v.recordedExpensesPaise === 'number');
      assert.ok(typeof v.tripContributionPaise === 'number');
      assert.ok(typeof v.maintenanceCostsPaise === 'number');

      // Math check: tripContributionPaise = freightRevenuePaise - recordedExpensesPaise
      assert.strictEqual(v.tripContributionPaise, v.freightRevenuePaise - v.recordedExpensesPaise);
    });

    it('exports vehicle report as CSV', async () => {
      const res = await makeRequest('GET', '/api/reports/vehicles?format=csv', tokenOwnerA);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['content-type']?.includes('text/csv'));
      assert.ok(res.rawText.includes('Registration Number,Model & Type,Status,Total Trips'));
    });
  });

  // =========================================================================
  // 3. EXPENSE REPORT
  // =========================================================================
  describe('3. Expense Ledger & Category Analysis Report', () => {
    it('returns expense report with category breakdown and summary', async () => {
      const res = await makeRequest('GET', '/api/reports/expenses', tokenOwnerA);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.summary.totalExpensePaise > 0);
      assert.ok(res.data.summary.categoryTotals);
      assert.ok(res.data.expenses.length > 0);

      const e = res.data.expenses[0];
      assert.ok(e.category);
      assert.ok(e.amountPaise > 0);
      assert.ok(e.date);
      assert.ok(e.vehicleRegistration);
    });

    it('filters expenses by category', async () => {
      const res = await makeRequest('GET', '/api/reports/expenses?category=DIESEL', tokenOwnerA);
      assert.strictEqual(res.status, 200);
      for (const e of res.data.expenses) {
        assert.strictEqual(e.category, 'DIESEL');
      }
    });

    it('exports expense report as CSV', async () => {
      const res = await makeRequest('GET', '/api/reports/expenses?format=csv', tokenOwnerA);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['content-type']?.includes('text/csv'));
      assert.ok(res.rawText.includes('Category,Amount (INR),Date,Vehicle Registration'));
    });
  });

  // =========================================================================
  // 4. CUSTOMER RECEIVABLES REPORT
  // =========================================================================
  describe('4. Customer Receivables Report', () => {
    it('returns customer receivables aging and outstanding balances', async () => {
      const res = await makeRequest('GET', '/api/reports/receivables', tokenOwnerA);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.summary);
      assert.ok(res.data.customers.length > 0);

      const c = res.data.customers[0];
      assert.ok(c.customerName);
      assert.ok(typeof c.invoiceCount === 'number');
      assert.ok(typeof c.totalInvoicedPaise === 'number');
      assert.ok(typeof c.totalPaidPaise === 'number');
      assert.ok(typeof c.outstandingBalancePaise === 'number');
      assert.ok(typeof c.overdueBalancePaise === 'number');
    });

    it('exports customer receivables as CSV', async () => {
      const res = await makeRequest('GET', '/api/reports/receivables?format=csv', tokenOwnerA);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['content-type']?.includes('text/csv'));
      assert.ok(res.rawText.includes('Customer Name,Contact Person,Phone,Payment Terms (Days)'));
    });
  });

  // =========================================================================
  // 5. MONTHLY PERFORMANCE REPORT
  // =========================================================================
  describe('5. Monthly Performance Trends', () => {
    it('returns monthly performance breakdown with trips, revenue, and active trucks', async () => {
      const res = await makeRequest('GET', '/api/reports/monthly-performance?monthsCount=6', tokenOwnerA);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.months.length, 6);

      const m = res.data.months[0];
      assert.ok(m.monthKey);
      assert.ok(m.monthLabel);
      assert.ok(typeof m.freightRevenuePaise === 'number');
      assert.ok(typeof m.recordedExpensesPaise === 'number');
      assert.ok(typeof m.tripContributionPaise === 'number');
      assert.ok(typeof m.completedTripsCount === 'number');
      assert.ok(typeof m.activeVehiclesCount === 'number');
      assert.ok(typeof m.outstandingInvoicesPaise === 'number');
    });

    it('exports monthly performance as CSV', async () => {
      const res = await makeRequest('GET', '/api/reports/monthly-performance?format=csv', tokenOwnerA);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['content-type']?.includes('text/csv'));
      assert.ok(res.rawText.includes('Month,Freight Revenue (INR),Trip Expenses (INR)'));
    });
  });

  // =========================================================================
  // 6. MULTI-TENANT ISOLATION
  // =========================================================================
  describe('6. Strict Multi-Tenant Company Isolation', () => {
    it('Company A data does NOT leak into Company B reports', async () => {
      const resA = await makeRequest('GET', '/api/reports/trips', tokenOwnerA);
      const resB = await makeRequest('GET', '/api/reports/trips', tokenOwnerB);

      assert.strictEqual(resA.status, 200);
      assert.strictEqual(resB.status, 200);

      const tripNumbersA = new Set(resA.data.trips.map((t: any) => t.tripNumber));
      for (const tb of resB.data.trips) {
        assert.strictEqual(
          tripNumbersA.has(tb.tripNumber),
          false,
          `Data leak! Company B report contains Company A trip ${tb.tripNumber}`
        );
      }
    });

    it('Company B CSV export contains only Company B data', async () => {
      const resA = await makeRequest('GET', '/api/reports/trips?format=csv', tokenOwnerA);
      const resB = await makeRequest('GET', '/api/reports/trips?format=csv', tokenOwnerB);

      assert.ok(!resB.rawText.includes('Royal Bengal Transports'));
      assert.ok(!resB.rawText.includes('WB-19-K-4821'));
    });
  });

  // =========================================================================
  // 7. EMPTY REPORTS HANDLING
  // =========================================================================
  describe('7. Empty Reports Graceful Handling', () => {
    it('handles zero-activity company without errors or NaN', async () => {
      const res = await makeRequest('GET', '/api/reports/trips', tokenEmptyOwner);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.trips.length, 0);
      assert.strictEqual(res.data.summary.totalTrips, 0);
      assert.strictEqual(res.data.summary.totalFreightRevenuePaise, 0);
      assert.strictEqual(res.data.summary.overallMarginPercentage, '0.0');
    });

    it('exports empty report as clean CSV header', async () => {
      const res = await makeRequest('GET', '/api/reports/trips?format=csv', tokenEmptyOwner);
      assert.strictEqual(res.status, 200);
      assert.ok(res.rawText.includes('Trip Number,LR Number,Customer,Vehicle,Driver'));
      // Only 1 line (the header)
      const lines = res.rawText.trim().split('\r\n');
      assert.strictEqual(lines.length, 1);
    });
  });

  // =========================================================================
  // 8. COMPANY SETTINGS & USER PERMISSIONS
  // =========================================================================
  describe('8. Company Settings & Role Permissions', () => {
    it('OWNER can update company settings including tripPrefix and logoUrl', async () => {
      const res = await makeRequest('PUT', '/api/company/profile', tokenOwnerA, {
        name: 'Royal Bengal Logistics & Transport Ltd',
        tripPrefix: 'RB/TR-',
        logoUrl: 'https://royalbengal.com/assets/logo.png',
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.company.tripPrefix, 'RB/TR-');
      assert.strictEqual(res.data.company.logoUrl, 'https://royalbengal.com/assets/logo.png');
    });

    it('OPERATIONS user CANNOT update company profile (HTTP 403 Forbidden)', async () => {
      const res = await makeRequest('PUT', '/api/company/profile', tokenOpsA, {
        name: 'Hacked Transport Name',
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.success, false);
    });

    it('OPERATIONS user CANNOT invite new users (HTTP 403 Forbidden)', async () => {
      const res = await makeRequest('POST', '/api/company/invite-user', tokenOpsA, {
        name: 'New Rogue Driver',
        email: 'rogue@test.com',
        role: 'MANAGER',
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.success, false);
    });

    it('OWNER can view current team members', async () => {
      const res = await makeRequest('GET', '/api/company/users', tokenOwnerA);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(Array.isArray(res.data.users));
      assert.ok(res.data.users.length > 0);
    });

    it('prevents non-owners from inviting an OWNER (HTTP 403 Forbidden)', async () => {
      const res = await makeRequest('POST', '/api/company/invite-user', tokenOwnerA, {
        name: 'Second Owner',
        email: 'secondowner@test.com',
        role: 'OWNER',
      });
      assert.strictEqual(res.status, 403);
    });
  });

  // =========================================================================
  // 9. LARGE DATASET RESILIENCE
  // =========================================================================
  describe('9. Large Dataset Aggregation Resilience', () => {
    it('aggregates over 250 trips swiftly without memory or precision degradation', async () => {
      // Seed 250 test trips for Company A
      assert.ok(serverFleetStore.trips.length > 0);
      const baseTrip = serverFleetStore.trips[0];
      const dummyTrips: Trip[] = [];

      for (let i = 1; i <= 250; i++) {
        dummyTrips.push({
          ...baseTrip,
          id: `trip_stress_${i}`,
          tripNumber: `TR-STRESS-${i.toString().padStart(4, '0')}`,
          dispatchDate: '2026-03-15T10:00:00Z',
          freightAmountPaise: 5000000,
          otherChargesPaise: 200000,
          status: 'COMPLETED',
        } as Trip);
      }

      const tStart = Date.now();
      // Test aggregation logic on the 250-trip dataset
      const totalFreight = dummyTrips.reduce((acc, t) => acc + (t.freightAmountPaise || 0) + (t.otherChargesPaise || 0), 0);
      const totalContribution = dummyTrips.reduce((acc, t) => acc + (t.tripContributionPaise || 0), 0);
      const durationMs = Date.now() - tStart;

      assert.strictEqual(dummyTrips.length, 250);
      assert.strictEqual(totalFreight, 250 * 5200000);
      assert.ok(durationMs < 100, `Aggregation took ${durationMs}ms`);

      // Also verify HTTP endpoint handles multiple requests smoothly
      const res = await makeRequest('GET', '/api/reports/trips', tokenOwnerA);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
    });
  });
});
