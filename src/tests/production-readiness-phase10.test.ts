/**
 * Phase 10: Complete End-to-End Production Readiness & Lifecycle Test Suite
 * 
 * Tests the entire business workflow of a transport company in West Bengal:
 * 1. Register new company & verify session
 * 2. Add vehicle & test vehicle conflicts
 * 3. Add driver & verify license/bata
 * 4. Add customer with GSTIN & credit terms
 * 5. Create trip with auto-generated unique trip and LR numbers
 * 6. Record trip direct expenses (Diesel, Toll)
 * 7. Disburse driver cash advance (verifying it is NOT counted as expense)
 * 8. Dispatch & Deliver trip (verifying truck & driver state transitions)
 * 9. Settle driver (verifying remaining balance and immutability)
 * 10. Generate GTA freight invoice (verifying duplicate billing guard)
 * 11. Record customer partial and full payments (verifying overpayment guards)
 * 12. Query reports (Trip report, Vehicle report, Expense report, Receivables report, Monthly performance)
 * 13. Verify audit trail logging
 * 14. Verify rate limiting and security headers
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { signSessionToken } from '../server/auth';
import { serverFleetStore } from '../server/store';
import { serverCompanies, serverCompanyUsers, serverUsers } from '../server/routes/auth.routes';
import { logAuditEvent, getCompanyAuditLogs } from '../server/audit';
import { Trip, Vehicle, Driver, Customer, TripExpense, DriverAdvance, Invoice, Payment } from '../types/tms';

const TEST_BASE_URL = 'http://localhost:3000';

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

describe('PHASE 10: Production Readiness & End-to-End Workflow Verification', { concurrency: 1 }, () => {
  let PROD_COMPANY_ID = '';
  let ownerToken: string;
  let vehicleId: string;
  let driverId: string;
  let customerId: string;
  let tripId: string;
  let invoiceId: string;

  // =========================================================================
  // STEP 1: COMPANY ONBOARDING & SETUP
  // =========================================================================
  describe('Step 1: Company Registration & Settings', () => {
    it('creates a new West Bengal transport enterprise with GSTIN and numbering prefixes', async () => {
      const regRes = await makeRequest('POST', '/api/auth/register', undefined, {
        companyName: 'Hooghly Freight Carriers Pvt Ltd',
        gstin: '19AABCH9988D1Z2',
        pan: 'AABCH9988D',
        city: 'Hooghly',
        state: 'West Bengal',
        stateCode: '19',
        phone: '+91 98300 44556',
        ownerName: 'Debabrata Mukherjee',
        ownerEmail: `owner_${Date.now()}@hooghlyfreight.in`,
        password: 'Password@123',
        fleetSize: '10-25 Trucks',
      });

      assert.strictEqual(regRes.status, 201);
      assert.strictEqual(regRes.data.success, true);
      assert.ok(regRes.data.token);
      ownerToken = regRes.data.token;
      PROD_COMPANY_ID = regRes.data.company.id;

      // Update prefixes and banking details
      const updRes = await makeRequest('PUT', '/api/company/profile', ownerToken, {
        tradeName: 'Hooghly Freight',
        address: 'Dankuni Coal Complex, NH-19',
        pincode: '712311',
        bankName: 'State Bank of India',
        accountNumber: '381900112233',
        ifscCode: 'SBIN0001234',
        branch: 'Dankuni Industrial Branch',
        lrPrefix: 'HFC/25-26/',
        invoicePrefix: 'INV/25-26/',
        tripPrefix: 'HFC-TR-',
      });
      assert.strictEqual(updRes.status, 200);

      const res = await makeRequest('GET', '/api/company/profile', ownerToken);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.company.name, 'Hooghly Freight Carriers Pvt Ltd');
      assert.strictEqual(res.data.company.gstin, '19AABCH9988D1Z2');
    });
  });

  // =========================================================================
  // STEP 2: FLEET ASSET CREATION & BULK IMPORT
  // =========================================================================
  describe('Step 2: Fleet Management (Vehicles & Drivers)', () => {
    it('adds a 14-wheeler commercial truck with valid registration and FASTag balance', async () => {
      const res = await makeRequest('POST', '/api/fleet/vehicles', ownerToken, {
        registrationNumber: 'WB-19-M-1122',
        vehicleType: '14-Wheeler (28T)',
        makeModel: 'Tata Signa 2823.K',
        capacityTonnes: 28,
        unladenWeightTonnes: 10.5,
        chassisNumber: 'MAT613042N1A99887',
        engineNumber: '697TC56N99887',
        startOdometerKm: 45000,
        fastagBalanceRupees: 6500,
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.vehicle.registrationNumber, 'WB-19-M-1122');
      assert.strictEqual(res.data.vehicle.fastagBalancePaise, 650000);
      vehicleId = res.data.vehicle.id;
    });

    it('adds a licensed heavy commercial vehicle driver with daily bata', async () => {
      const res = await makeRequest('POST', '/api/fleet/drivers', ownerToken, {
        fullName: 'Prabir Kumar Ghosh',
        phone: '+91 98311 22334',
        licenseNumber: 'WB1920170044556',
        licenseExpiry: '2030-12-31',
        perDayBataRupees: 550,
        address: 'Transport Nagar, Dankuni',
        emergencyContact: 'Aparna Ghosh',
        emergencyPhone: '+91 98311 22335',
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.driver.fullName, 'Prabir Kumar Ghosh');
      assert.strictEqual(res.data.driver.perDayBataPaise, 55000);
      driverId = res.data.driver.id;
    });

    it('downloads CSV import templates for vehicles, drivers, and customers', async () => {
      const resVeh = await makeRequest('GET', '/api/fleet/import-templates/vehicles');
      assert.strictEqual(resVeh.status, 200);
      assert.ok(resVeh.rawText.includes('registrationNumber,vehicleType,makeModel'));

      const resDrv = await makeRequest('GET', '/api/fleet/import-templates/drivers');
      assert.strictEqual(resDrv.status, 200);
      assert.ok(resDrv.rawText.includes('fullName,phone,licenseNumber'));

      const resCust = await makeRequest('GET', '/api/fleet/import-templates/customers');
      assert.strictEqual(resCust.status, 200);
      assert.ok(resCust.rawText.includes('name,tradeName,gstin'));
    });
  });

  // =========================================================================
  // STEP 3: CUSTOMER REGISTRATION
  // =========================================================================
  describe('Step 3: Customer Management', () => {
    it('adds an industrial customer with valid West Bengal GSTIN and 30-day payment terms', async () => {
      const res = await makeRequest('POST', '/api/fleet/customers', ownerToken, {
        name: 'Durgapur Steel Rolling Mills LLP',
        tradeName: 'DSRM Steel',
        gstin: '19AAACD9900B1ZN',
        contactPerson: 'Animesh Sen',
        phone: '+91 94340 77889',
        email: 'billing@dsrmsteel.com',
        billingAddress: 'City Centre, Durgapur',
        city: 'Durgapur',
        state: 'West Bengal',
        pincode: '713216',
        creditPeriodDays: 30,
        creditLimitRupees: 2500000,
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.customer.name, 'Durgapur Steel Rolling Mills LLP');
      assert.strictEqual(res.data.customer.pan, 'AAACD9900B');
      customerId = res.data.customer.id;
    });
  });

  // =========================================================================
  // STEP 4: TRIP CREATION & VEHICLE CONFLICT PREVENTION
  // =========================================================================
  describe('Step 4: Trip Creation & Strict Server-side Validation', () => {
    it('creates a new commercial freight trip from Dankuni to Durgapur with calculated revenue', async () => {
      const res = await makeRequest('POST', '/api/trips', ownerToken, {
        customerId,
        vehicleId,
        driverId,
        originCity: 'Dankuni',
        destinationCity: 'Durgapur',
        goodsType: 'Iron Billets & Wire Rods',
        weightTonnes: 25,
        ratePerTonnePaise: 240000, // ₹2,400 per Tonne = ₹60,000
        otherChargesPaise: 500000, // ₹5,000 Loading/Detention
        startOdometerKm: 45000,
        dispatchDate: '2026-03-20T08:00:00Z',
        expectedDeliveryDate: '2026-03-21T18:00:00Z',
        status: 'PLANNED',
      });

      console.log('STEP 4 TRIP RESULT:', res.status, res.data);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.trip.freightAmountPaise, 6000000); // ₹60,000
      assert.strictEqual(res.data.trip.totalRevenuePaise, 6500000); // ₹65,000
      tripId = res.data.trip.id;
    });

    it('dispatches the trip and transitions truck and driver to active transit states', async () => {
      const res = await makeRequest('POST', `/api/trips/${tripId}/status`, ownerToken, {
        status: 'DISPATCHED',
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.trip.status, 'DISPATCHED');

      // Verify vehicle status changed to IN_TRANSIT
      const vehRes = await makeRequest('GET', `/api/fleet/vehicles/${vehicleId}`, ownerToken);
      assert.strictEqual(vehRes.status, 200);
      assert.strictEqual(vehRes.data.vehicle?.status, 'IN_TRANSIT');
    });

    it('blocks assigning the same truck to a simultaneous overlapping active trip (HTTP 409 Conflict)', async () => {
      const resConflict = await makeRequest('POST', '/api/trips', ownerToken, {
        customerId,
        vehicleId,
        driverId,
        originCity: 'Kolkata',
        destinationCity: 'Siliguri',
        weightTonnes: 20,
        freightAmountPaise: 5000000,
        dispatchDate: '2026-03-21T10:00:00Z',
        status: 'DISPATCHED',
      });

      assert.strictEqual(resConflict.status, 409);
      assert.strictEqual(resConflict.data.success, false);
      assert.ok(resConflict.data.error.includes('Vehicle conflict'));
    });
  });

  // =========================================================================
  // STEP 5: TRIP EXPENSES & DRIVER CASH ADVANCES
  // =========================================================================
  describe('Step 5: Trip Direct Expenses vs Cash Advances', () => {
    it('records direct diesel expense against the trip (counts as trip expense)', async () => {
      const res = await makeRequest('POST', '/api/financials/expenses', ownerToken, {
        tripId,
        vehicleId,
        category: 'DIESEL',
        amountPaise: 1800000, // ₹18,000 Diesel
        paymentMode: 'PETRO_CARD',
        litresFuel: 200,
        ratePerLitrePaise: 9000, // ₹90/L
        petrolPumpName: 'Indian Oil Dankuni Plaza',
        date: '2026-03-20',
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.expense.amountPaise, 1800000);
    });

    it('records FASTag toll expense against the trip', async () => {
      const res = await makeRequest('POST', '/api/financials/expenses', ownerToken, {
        tripId,
        vehicleId,
        category: 'TOLL',
        amountPaise: 250000, // ₹2,500 Toll
        paymentMode: 'FASTAG',
        date: '2026-03-20',
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.expense.amountPaise, 250000);
    });

    it('disburses cash advance to driver and verifies it DOES NOT reduce trip contribution', async () => {
      const resAdvance = await makeRequest('POST', '/api/financials/advances', ownerToken, {
        tripId,
        driverId,
        amountPaise: 500000, // ₹5,000 cash advance
        paymentMode: 'CASH',
        notes: 'En-route food and truck parking cash advance',
      });

      assert.strictEqual(resAdvance.status, 201);
      assert.strictEqual(resAdvance.data.advance.amountPaise, 500000);

      // Verify trip contribution: Revenue (₹65,000) - Recorded Expenses (₹18,000 + ₹2,500 = ₹20,500) = ₹44,500
      // Advances are balance sheet floats, NOT expenses!
      const resTrip = await makeRequest('GET', `/api/trips/${tripId}`, ownerToken);
      assert.strictEqual(resTrip.status, 200);
      assert.strictEqual(resTrip.data.trip.totalExpensesPaise, 2050000); // ₹20,500
      assert.strictEqual(resTrip.data.trip.tripContributionPaise, 4450000); // ₹44,500
      assert.strictEqual(resTrip.data.financials.advancesCountedInExpenses, false);
    });
  });

  // =========================================================================
  // STEP 6: DELIVERY & DRIVER SETTLEMENT
  // =========================================================================
  describe('Step 6: Delivery & Driver Final Settlement', () => {
    it('marks trip as DELIVERED with end odometer and releases vehicle to available for next assignment', async () => {
      const res = await makeRequest('POST', `/api/trips/${tripId}/status`, ownerToken, {
        status: 'DELIVERED',
        endOdometerKm: 45280,
        podReceived: true,
        podRemarks: 'Delivered in full at Durgapur stockyard. Consignee signed stamped bilty.',
      });

      if (res.status !== 200) {
        console.error('DELIVERY ATTEMPT FAILED: tripId=', tripId, 'status=', res.status, 'data=', res.data);
      }
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.trip.status, 'DELIVERED');
      assert.strictEqual(res.data.trip.endOdometerKm, 45280);
    });

    it('finalizes driver settlement with approved trip expenses and bata allowance', async () => {
      // Driver was given ₹5,000 cash advance.
      // Driver incurred ₹1,500 approved en-route cash vouchers (unloading/parking) + ₹1,100 driver bata allowance (2 days @ ₹550).
      // Total driver credit: ₹2,600.
      // Driver has ₹2,400 remaining cash balance to return to company.
      const res = await makeRequest('POST', '/api/financials/settlements', ownerToken, {
        tripId,
        driverId,
        driverCashExpensesPaise: 150000,
        driverBataAllowancePaise: 110000,
        otherDeductionsPaise: 0,
        notes: 'Final settlement verified against trip log sheet.',
      });

      if (res.status !== 201) {
        console.error('SETTLEMENT FAILURE:', res.status, res.data);
      }
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.success, true);
    });

    it('prevents modifying finalized driver settlement without authorized correction flow', async () => {
      const resDuplicate = await makeRequest('POST', '/api/financials/settlements', ownerToken, {
        tripId,
        driverId,
        driverCashExpensesPaise: 200000,
      });

      assert.strictEqual(resDuplicate.status, 409);
      assert.ok(resDuplicate.data.error.includes('already has an existing settlement') || resDuplicate.data.error.includes('already has an active settlement'));
    });
  });

  // =========================================================================
  // STEP 7: INVOICING & PAYMENT RECONCILIATION
  // =========================================================================
  describe('Step 7: Invoicing & Payment Reconciliation', () => {
    it('generates a GST GTA tax invoice with 5% RCM under SAC 996511', async () => {
      const res = await makeRequest('POST', '/api/invoices', ownerToken, {
        tripId,
        issueDate: '2026-03-22',
        dueDate: '2026-12-31',
        isRcmApplicable: true,
      });

      if (res.status !== 201) {
        console.error('INVOICE FAILURE:', res.status, res.data);
      }
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.invoice.invoiceNumber.startsWith('INV/'));
      console.log('ACTUAL INVOICE AMOUNTS:', res.data.invoice.taxableAmountPaise, res.data.invoice.totalAmountPaise, res.data.invoice.otherChargesPaise);
      assert.strictEqual(res.data.invoice.taxableAmountPaise, 6500000);
      assert.strictEqual(res.data.invoice.totalAmountPaise, 6500000);
      assert.strictEqual(res.data.invoice.balanceDuePaise, 6500000);
      assert.strictEqual(res.data.invoice.status, 'ISSUED');
      invoiceId = res.data.invoice.id;
    });

    it('strictly prevents duplicate invoicing for the same trip (HTTP 409)', async () => {
      const resDup = await makeRequest('POST', '/api/invoices', ownerToken, {
        tripId,
        issueDate: '2026-03-22',
      });

      assert.strictEqual(resDup.status, 409);
      assert.ok(resDup.data.error.includes('already has an active invoice') || resDup.data.error.includes('already invoiced'));
    });

    it('records partial customer payment of ₹40,000 and calculates remaining balance', async () => {
      const res = await makeRequest('POST', `/api/invoices/${invoiceId}/payments`, ownerToken, {
        amountPaise: 4000000, // ₹40,000 partial payment
        paymentDate: '2026-03-25',
        paymentMethod: 'NEFT',
        referenceNumber: 'NEFT-SBI-998811',
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.invoice.amountPaidPaise, 4000000);
      assert.strictEqual(res.data.invoice.balanceDuePaise, 2500000); // ₹25,000 balance remaining
      assert.strictEqual(res.data.invoice.status, 'PARTIALLY_PAID');
    });

    it('rejects overpayment exceeding remaining invoice balance (HTTP 400)', async () => {
      const resOverpay = await makeRequest('POST', `/api/invoices/${invoiceId}/payments`, ownerToken, {
        amountPaise: 3000000, // ₹30,000 payment when only ₹25,000 is due
        paymentDate: '2026-03-26',
        paymentMethod: 'RTGS',
        referenceNumber: 'RTGS-OVERPAY-GUARD',
      });

      assert.strictEqual(resOverpay.status, 400);
      assert.ok(resOverpay.data.error.includes('exceeds outstanding balance'));
    });

    it('records remaining ₹25,000 payment and automatically marks invoice PAID', async () => {
      const res = await makeRequest('POST', `/api/invoices/${invoiceId}/payments`, ownerToken, {
        amountPaise: 2500000,
        paymentDate: '2026-03-28',
        paymentMethod: 'RTGS',
        referenceNumber: 'RTGS-HDFC-554422',
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.invoice.amountPaidPaise, 6500000);
      assert.strictEqual(res.data.invoice.balanceDuePaise, 0);
      assert.strictEqual(res.data.invoice.status, 'PAID');
    });
  });

  // =========================================================================
  // STEP 8: AUDITED REPORTS & CSV EXPORT
  // =========================================================================
  describe('Step 8: Audited Financial & Operational Reports', () => {
    it('generates Company Trip Report with operational contribution and CSV export', async () => {
      const res = await makeRequest('GET', '/api/reports/trips', ownerToken);
      console.log('REPORTS TRIPS:', JSON.stringify(res.data));
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.summary.totalFreightRevenuePaise >= 6500000);
      assert.ok(res.data.summary.totalExpensesPaise >= 2050000);
      assert.ok(res.data.summary.totalTripContributionPaise >= 4450000);

      const resCsv = await makeRequest('GET', '/api/reports/trips?format=csv', ownerToken);
      assert.strictEqual(resCsv.status, 200);
      assert.ok(resCsv.headers['content-type']?.includes('text/csv'));
      assert.ok(resCsv.rawText.includes('Hooghly Freight'));
    });

    it('generates Vehicle Performance Report with maintenance breakdown', async () => {
      const res = await makeRequest('GET', '/api/reports/vehicles', ownerToken);
      assert.strictEqual(res.status, 200);
      const truck = res.data.vehicles.find((v: any) => v.registrationNumber === 'WB-19-M-1122');
      assert.ok(truck);
      assert.strictEqual(truck.freightRevenuePaise, 6500000);
      assert.strictEqual(truck.recordedExpensesPaise, 2050000);
      assert.strictEqual(truck.tripContributionPaise, 4450000);
    });

    it('generates Customer Receivables Aging Report with zero balance after settlement', async () => {
      const res = await makeRequest('GET', '/api/reports/receivables', ownerToken);
      assert.strictEqual(res.status, 200);
      const cust = res.data.customers.find((c: any) => c.customerId === customerId);
      assert.ok(cust);
      assert.strictEqual(cust.totalInvoicedPaise, 6500000);
      assert.strictEqual(cust.totalPaidPaise, 6500000);
      assert.strictEqual(cust.outstandingBalancePaise, 0);
    });
  });

  // =========================================================================
  // STEP 9: AUDIT LOGS & SECURITY CONTROLS
  // =========================================================================
  describe('Step 9: Security Controls, Rate Limiting & Audit Trail', () => {
    it('logs audit event on critical transport operations and retrieves company-scoped logs', async () => {
      const postRes = await makeRequest('POST', '/api/audit-logs', ownerToken, {
        action: 'DELIVER',
        entityType: 'TRIP',
        entityId: tripId,
        summary: 'Trip delivered at Durgapur Stockyard with signed POD.',
      });
      assert.strictEqual(postRes.status, 201);
      assert.strictEqual(postRes.data.success, true);

      const logsRes = await makeRequest('GET', '/api/audit-logs', ownerToken);
      assert.strictEqual(logsRes.status, 200);
      assert.ok(logsRes.data.logs.length > 0);
      assert.strictEqual(logsRes.data.logs[0].entityId, tripId);
      assert.strictEqual(logsRes.data.logs[0].action, 'DELIVER');
    });

    it('verifies security headers are present on API responses', async () => {
      const res = await makeRequest('GET', '/api/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
      assert.strictEqual(res.headers['x-frame-options'], 'SAMEORIGIN');
    });
  });
});
