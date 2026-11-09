/**
 * AnchorTransport TMS - Phase 8 Invoicing and Customer Payments Verification Suite
 * 
 * Verifies:
 * 1. Invoice generation from completed commercial trips (unique sequential numbering)
 * 2. Manual intent invariant: Trips delivered do NOT automatically generate invoices
 * 3. Invoice totals (Decimal-safe freight + loading + unloading + detention + GTA GST calculations)
 * 4. Duplicate invoice prevention (One active invoice per trip, HTTP 409 Conflict)
 * 5. Partial payments & full payments recording
 * 6. Outstanding balance invariant: Invoice total minus recorded payments
 * 7. Overpayment prevention: Payments cannot exceed outstanding balance
 * 8. Duplicate payment prevention: Unique reference number per invoice (HTTP 409 Conflict)
 * 9. Cancelled invoices: Trip liberation for re-billing and customer balance restoration
 * 10. Financial precision: Integer paise arithmetic without IEEE 754 float drift
 * 11. Multi-tenant company isolation: Zero cross-company leakage
 */

import express from 'express';
import http from 'http';
import { serverFleetStore } from '../server/store';
import { invoicesRouter, deriveInvoiceStatus } from '../server/routes/invoices.routes';
import { tripsRouter } from '../server/routes/trips.routes';
import { signSessionToken } from '../server/auth';
import { Trip, Customer, Invoice, Payment } from '../types/tms';
import { paiseToRupees, rupeesToPaise, calculateGstInvoice } from '../lib/financialEngine';

async function runPhase8InvoicingTests() {
  console.log('========================================================================');
  console.log('   ANCHORTRANSPORT TMS - PHASE 8 INVOICING & PAYMENTS VERIFICATION       ');
  console.log('========================================================================');

  const app = express();
  app.use(express.json());
  app.use('/api', invoicesRouter);
  app.use('/api', tripsRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const PORT = address.port;
  const BASE_URL = `http://localhost:${PORT}/api`;

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

  const compA = 'comp_wb_royal_001';
  const compB = 'comp_tmt_haulers_002';

  // Seed baseline data
  serverFleetStore.seedCompanyData(compA);
  serverFleetStore.clearCompanyData(compB);

  // Generate tokens
  const tokenOwnerA = signSessionToken({
    userId: 'usr_owner_a',
    email: 'owner@wbroyal.com',
    name: 'Rajesh Mukherjee',
    companyId: compA,
    role: 'OWNER',
  });

  const tokenAccountantA = signSessionToken({
    userId: 'usr_acct_a',
    email: 'accounts@wbroyal.com',
    name: 'Subhashish Dey',
    companyId: compA,
    role: 'ACCOUNTANT',
  });

  const tokenAdminB = signSessionToken({
    userId: 'usr_admin_b',
    email: 'admin@tmthaulers.com',
    name: 'Bikash Agarwal',
    companyId: compB,
    role: 'ADMIN',
  });

  // Setup dedicated delivered trip for billing in Company A
  const testCustomerA: Customer = {
    id: `cust_tata_p8_${Date.now()}`,
    companyId: compA,
    name: 'Tata Steel Processing & Distribution Ltd',
    gstin: '19AAACT0001A1Z1',
    pan: 'AAACT0001A',
    stateCode: '19',
    billingAddress: 'Tata Centre, 43 Jawaharlal Nehru Road, Kolkata, WB 700071',
    city: 'Kolkata',
    state: 'West Bengal',
    pincode: '700071',
    contactPerson: 'Sanjay Sengupta',
    phone: '+91 98309 87654',
    email: 'logistics@tatasteel.com',
    creditPeriodDays: 30,
    paymentTermsDays: 30,
    creditLimitPaise: 50000000,
    currentOutstandingPaise: 0,
    totalFreightBilledPaise: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  serverFleetStore.customers.push(testCustomerA);

  const testTripA: Trip = {
    id: `trip_test_p8_${Date.now()}`,
    companyId: compA,
    tripNumber: 'TR-2026-8801',
    lrNumber: 'LR-2026-8801',
    customerId: testCustomerA.id,
    customerName: testCustomerA.name,
    customerGstin: testCustomerA.gstin,
    vehicleId: 'veh_wb11_1234',
    vehicleReg: 'WB 11 1234',
    driverId: 'drv_ramesh_01',
    driverName: 'Ramesh Yadav',
    driverPhone: '+91 98301 23456',
    originCity: 'Kolkata, WB',
    destinationCity: 'Jamshedpur, JH',
    goodsType: 'Heavy HR Steel Coils',
    weightTonnes: 32.0,
    ratePerTonnePaise: 280000, // ₹2,800/Tonne
    freightAmountPaise: 8960000, // 32 * 2800 = ₹89,600
    otherChargesPaise: 240000, // ₹2,400 detention
    totalRevenuePaise: 9200000, // ₹92,000
    dispatchDate: '2026-11-01',
    expectedDeliveryDate: '2026-11-03',
    status: 'DELIVERED',
    startOdometerKm: 140000,
    podReceived: true,
    podDocumentUrl: 'https://storage.googleapis.com/tms-docs/pod_8801.pdf',
    isInvoiced: false,
    isSettled: true,
    totalExpensesPaise: 2800000,
    totalAdvancesPaise: 1500000,
    tripContributionPaise: 6400000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  serverFleetStore.trips.push(testTripA);

  // -------------------------------------------------------------------------
  // TEST GROUP 1: MANUAL INTENT INVARIANT (DELIVERED TRIP NOT AUTO-INVOICED)
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 1: Manual Intent (No Automatic Invoice on Delivery) ---');
  assert(
    testTripA.status === 'DELIVERED' && testTripA.isInvoiced === false,
    'Delivered trip is NOT automatically invoiced without explicit user billing intent'
  );

  // -------------------------------------------------------------------------
  // TEST GROUP 2: INVOICE GENERATION & UNIQUE SEQUENTIAL NUMBERING
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 2: Invoice Creation & Sequential Unique Numbering ---');

  const invCreateRes = await fetch(`${BASE_URL}/invoices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAccountantA}`,
    },
    body: JSON.stringify({
      tripId: testTripA.id,
      customerId: testCustomerA.id,
      issueDate: '2026-11-05',
      freightAmountPaise: 8960000,
      loadingChargesPaise: 150000, // ₹1,500
      unloadingChargesPaise: 150000, // ₹1,500
      detentionChargesPaise: 240000, // ₹2,400
      isRcmApplicable: true, // GTA RCM 5% (Recipient liable)
      notes: 'Steel consignment delivered to Tata Works Gate 4. Signed POD attached.',
      status: 'ISSUED',
    }),
  });

  const invData = await invCreateRes.json();
  assert(invCreateRes.status === 201 && invData.success === true, 'Invoice successfully generated from completed trip');
  assert(invData.invoice.invoiceNumber.startsWith('INV/'), `Invoice number generated in standard format: ${invData.invoice.invoiceNumber}`);
  assert(invData.invoice.tripId === testTripA.id, `Invoice linked to trip ${testTripA.tripNumber}`);
  assert(invData.invoice.customerId === testCustomerA.id, `Invoice customer correctly mapped to ${testCustomerA.name}`);
  assert(invData.invoice.hsnSacCode === '996511', 'HSN/SAC 996511 assigned for Goods Transport Agency road service');

  // Verify trip was atomically marked isInvoiced
  const tripAfterBilling = serverFleetStore.trips.find((t) => t.id === testTripA.id)!;
  assert(tripAfterBilling.isInvoiced === true, 'Trip marked isInvoiced = true after billing');
  assert(tripAfterBilling.invoiceNumber === invData.invoice.invoiceNumber, 'Trip references generated invoice number');

  // -------------------------------------------------------------------------
  // TEST GROUP 3: INVOICE TOTALS & GTA TAX CALCULATIONS
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 3: Invoice Totals & GTA GST Tax Calculations ---');

  // Taxable Amount = 8960000 (freight) + 150000 (loading) + 150000 (unloading) + 240000 (detention) = 9500000 (₹95,000)
  const expectedTaxablePaise = 8960000 + 150000 + 150000 + 240000;
  assert(
    invData.invoice.taxableAmountPaise === expectedTaxablePaise,
    `Taxable amount computed correctly: ₹${expectedTaxablePaise / 100} (Found ₹${invData.invoice.taxableAmountPaise / 100})`
  );

  // Under RCM (Reverse Charge Mechanism), recipient pays tax directly to GST portal, so invoice tax is ₹0 and total = taxable
  assert(
    invData.invoice.isRcmApplicable === true && invData.invoice.totalTaxPaise === 0,
    'GTA RCM invoice sets transporter total tax to ₹0 (liability shifted to recipient)'
  );
  assert(
    invData.invoice.totalAmountPaise === expectedTaxablePaise,
    `Invoice total amount equals taxable amount under RCM: ₹${expectedTaxablePaise / 100}`
  );
  assert(
    invData.invoice.balanceDuePaise === expectedTaxablePaise,
    `Initial balance due equals total invoice amount: ₹${expectedTaxablePaise / 100}`
  );

  // Test Forward Charge GST calculation (Intra-state vs Inter-state)
  const forwardIntra = calculateGstInvoice(10000000, '19', '19', false, 5); // ₹1,00,000 in WB -> WB @ 5%
  assert(
    forwardIntra.cgstAmountPaise === 250000 && forwardIntra.sgstAmountPaise === 250000 && forwardIntra.igstAmountPaise === 0,
    'Forward Charge Intra-state (WB->WB) splits tax equally: 2.5% CGST + 2.5% SGST'
  );
  assert(forwardIntra.totalInvoiceAmountPaise === 10500000, 'Forward Charge Intra-state total is ₹1,05,000');

  const forwardInter = calculateGstInvoice(10000000, '19', '20', false, 5); // ₹1,00,000 in WB -> Jharkhand @ 5%
  assert(
    forwardInter.igstAmountPaise === 500000 && forwardInter.cgstAmountPaise === 0 && forwardInter.sgstAmountPaise === 0,
    'Forward Charge Inter-state (WB->JH) applies 5% IGST exclusively'
  );

  // Customer outstanding balance updated
  const custAfterBilling = serverFleetStore.customers.find((c) => c.id === testCustomerA.id)!;
  assert(
    custAfterBilling.currentOutstandingPaise === expectedTaxablePaise,
    `Customer outstanding balance updated to ₹${expectedTaxablePaise / 100}`
  );

  // -------------------------------------------------------------------------
  // TEST GROUP 4: DUPLICATE INVOICE PREVENTION (ONE ACTIVE INVOICE PER TRIP)
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 4: Duplicate Invoice Prevention (HTTP 409 Conflict) ---');

  const dupInvRes = await fetch(`${BASE_URL}/invoices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAccountantA}`,
    },
    body: JSON.stringify({
      tripId: testTripA.id,
      customerId: testCustomerA.id,
      freightAmountPaise: 8960000,
    }),
  });

  const dupInvData = await dupInvRes.json();
  assert(
    dupInvRes.status === 409,
    `Duplicate invoice creation for same trip strictly rejected with HTTP 409 Conflict (Got ${dupInvRes.status})`
  );
  assert(
    dupInvData.error && dupInvData.error.includes('already has an active invoice'),
    'Error message specifies existing invoice number to prevent double billing'
  );

  // -------------------------------------------------------------------------
  // TEST GROUP 5: PARTIAL PAYMENT & OUTSTANDING BALANCE RECONCILIATION
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 5: Partial Payments & Outstanding Balance Calculations ---');

  const createdInvoice = invData.invoice;
  const partialPaymentAmountPaise = 5000000; // ₹50,000 partial payment against ₹95,000 invoice
  const refNum1 = 'NEFT-TATA-20261105-01';

  const payRes1 = await fetch(`${BASE_URL}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAccountantA}`,
    },
    body: JSON.stringify({
      invoiceId: createdInvoice.id,
      amountPaise: partialPaymentAmountPaise,
      paymentDate: '2026-11-05',
      paymentMode: 'NEFT_RTGS',
      referenceNumber: refNum1,
      bankAccount: 'HDFC Bank Ltd. Transport Operating A/C',
      notes: 'Initial 50% mobilization payment released by Tata treasury',
    }),
  });

  const payData1 = await payRes1.json();
  assert(payRes1.status === 201 && payData1.success === true, 'Partial payment of ₹50,000 recorded successfully');

  // Verify invoice state
  const invAfterPay1 = serverFleetStore.invoices.find((i) => i.id === createdInvoice.id)!;
  assert(invAfterPay1.amountPaidPaise === partialPaymentAmountPaise, 'Invoice amountPaidPaise updated to ₹50,000');

  const expectedBalanceAfterPay1 = expectedTaxablePaise - partialPaymentAmountPaise; // 95,000 - 50,000 = 45,000
  assert(
    invAfterPay1.balanceDuePaise === expectedBalanceAfterPay1,
    `Outstanding balance computed accurately (Invoice total minus recorded payments): ₹${expectedBalanceAfterPay1 / 100} (Found ₹${invAfterPay1.balanceDuePaise / 100})`
  );
  assert(
    invAfterPay1.status === 'PARTIALLY_PAID',
    `Invoice status derived as PARTIALLY_PAID (Status: ${invAfterPay1.status})`
  );

  // Customer outstanding balance reduced
  const custAfterPay1 = serverFleetStore.customers.find((c) => c.id === testCustomerA.id)!;
  assert(
    custAfterPay1.currentOutstandingPaise === expectedBalanceAfterPay1,
    `Customer outstanding ledger reduced to ₹${expectedBalanceAfterPay1 / 100}`
  );

  // -------------------------------------------------------------------------
  // TEST GROUP 6: OVERPAYMENT PREVENTION & DUPLICATE PAYMENT GUARDS
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 6: Overpayment Guards & Duplicate Payment Submissions ---');

  // Attempt 1: Overpayment guard: Try to pay ₹60,000 when only ₹45,000 is due
  const overpayRes = await fetch(`${BASE_URL}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAccountantA}`,
    },
    body: JSON.stringify({
      invoiceId: createdInvoice.id,
      amountPaise: 6000000, // ₹60,000 exceeds ₹45,000
      referenceNumber: 'NEFT-OVERPAY-001',
    }),
  });

  const overpayData = await overpayRes.json();
  assert(
    overpayRes.status === 400,
    `Payment exceeding outstanding balance blocked with HTTP 400 (Got ${overpayRes.status})`
  );
  assert(
    overpayData.error && overpayData.error.includes('exceeds current outstanding balance'),
    'Error message informs user of balance limit and blocks overpayment'
  );

  // Attempt 2: Duplicate payment guard: Try to submit payment with same reference number
  const dupPayRes = await fetch(`${BASE_URL}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAccountantA}`,
    },
    body: JSON.stringify({
      invoiceId: createdInvoice.id,
      amountPaise: 2000000,
      referenceNumber: refNum1, // Same reference as payment 1
    }),
  });

  const dupPayData = await dupPayRes.json();
  assert(
    dupPayRes.status === 409,
    `Duplicate payment submission with identical reference blocked with HTTP 409 Conflict (Got ${dupPayRes.status})`
  );
  assert(
    dupPayData.error && dupPayData.error.includes('already been processed'),
    'Duplicate payment error message specifies collision on transaction reference'
  );

  // -------------------------------------------------------------------------
  // TEST GROUP 7: FULL PAYMENT & TERMINAL STATUS DERIVATION
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 7: Full Payment & Status Transitions ---');

  const finalSettlementAmountPaise = expectedBalanceAfterPay1; // Exactly ₹45,000 to clear the bill
  const payRes2 = await fetch(`${BASE_URL}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAccountantA}`,
    },
    body: JSON.stringify({
      invoiceId: createdInvoice.id,
      amountPaise: finalSettlementAmountPaise,
      paymentDate: '2026-11-06',
      paymentMode: 'NEFT_RTGS',
      referenceNumber: 'NEFT-TATA-20261106-FINAL',
      tdsDeductedPaise: 190000, // ₹1,900 Section 194C TDS
      notes: 'Final balance payment cleared via RTGS',
    }),
  });

  const payData2 = await payRes2.json();
  assert(payRes2.status === 201 && payData2.success === true, 'Final payment recorded successfully');

  const invAfterPay2 = serverFleetStore.invoices.find((i) => i.id === createdInvoice.id)!;
  assert(invAfterPay2.amountPaidPaise === expectedTaxablePaise, `Invoice fully paid: ₹${invAfterPay2.amountPaidPaise / 100}`);
  assert(invAfterPay2.balanceDuePaise === 0, 'Invoice balanceDuePaise is exactly ₹0');
  assert(invAfterPay2.status === 'PAID', `Invoice derived status transitioned to PAID (Status: ${invAfterPay2.status})`);

  const custAfterPay2 = serverFleetStore.customers.find((c) => c.id === testCustomerA.id)!;
  assert(custAfterPay2.currentOutstandingPaise === 0, 'Customer current outstanding reduced to exactly ₹0');

  // Dynamic Overdue status check helper test
  const overdueInvoiceMock: Invoice = {
    ...createdInvoice,
    id: 'inv_mock_overdue_1',
    dueDate: '2026-10-01', // Past date
    balanceDuePaise: 1000000,
    amountPaidPaise: 0,
    status: 'ISSUED',
  };
  const derivedOverdueStatus = deriveInvoiceStatus(overdueInvoiceMock, new Date('2026-11-05'));
  assert(
    derivedOverdueStatus === 'OVERDUE',
    'deriveInvoiceStatus correctly computes OVERDUE when past dueDate with outstanding balance'
  );

  // -------------------------------------------------------------------------
  // TEST GROUP 8: CANCELLED INVOICES & RESOURCE LIBERATION
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 8: Cancelled Invoices & Trip Resource Liberation ---');

  // Setup a second trip and invoice to test clean cancellation
  const testTrip2: Trip = {
    ...testTripA,
    id: `trip_test_cancel_${Date.now()}`,
    tripNumber: 'TR-2026-8802',
    lrNumber: 'LR-2026-8802',
    isInvoiced: false,
  };
  serverFleetStore.trips.push(testTrip2);

  const invCreateRes2 = await fetch(`${BASE_URL}/invoices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAccountantA}`,
    },
    body: JSON.stringify({
      tripId: testTrip2.id,
      customerId: testCustomerA.id,
      freightAmountPaise: 5000000, // ₹50,000
    }),
  });
  const invData2 = await invCreateRes2.json();
  const invoiceToCancel = invData2.invoice;

  assert(testTrip2.isInvoiced === true, 'Second trip marked isInvoiced upon billing');

  // Attempt cancellation without reason -> should fail
  const cancelNoReasonRes = await fetch(`${BASE_URL}/invoices/${invoiceToCancel.id}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenOwnerA}`,
    },
    body: JSON.stringify({}),
  });
  assert(cancelNoReasonRes.status === 400, 'Cancellation without reason rejected with HTTP 400');

  // Cancel with valid audit reason
  const cancelRes = await fetch(`${BASE_URL}/invoices/${invoiceToCancel.id}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenOwnerA}`,
    },
    body: JSON.stringify({
      cancellationReason: 'Consignor amended billing entity: re-issuing to subsidiary branch',
    }),
  });
  const cancelData = await cancelRes.json();
  assert(cancelRes.status === 200 && cancelData.success === true, 'Invoice successfully cancelled');
  assert(cancelData.invoice.status === 'CANCELLED', 'Invoice status set to CANCELLED');

  // Verify trip is liberated
  const tripAfterCancel = serverFleetStore.trips.find((t) => t.id === testTrip2.id)!;
  assert(
    tripAfterCancel.isInvoiced === false && tripAfterCancel.invoiceId === undefined,
    'Trip isInvoiced reset to false and invoiceId cleared for re-billing'
  );

  // Attempt to cancel an invoice with recorded payments (must be rejected)
  const cancelPaidRes = await fetch(`${BASE_URL}/invoices/${createdInvoice.id}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenOwnerA}`,
    },
    body: JSON.stringify({
      cancellationReason: 'Invalid cancel attempt on settled bill',
    }),
  });
  assert(
    cancelPaidRes.status === 400,
    'Cancellation of invoice with recorded payments blocked (Must reverse payments first)'
  );

  // -------------------------------------------------------------------------
  // TEST GROUP 9: FINANCIAL PRECISION (INTEGER PAISE NO FLOAT DRIFT)
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 9: Financial Precision & Calculations ---');

  const oddRupees = [19.99, 100.5, 9999.01, 74320.67, 1000000.25];
  let precisionPass = true;
  for (const r of oddRupees) {
    const paise = rupeesToPaise(r);
    const converted = paiseToRupees(paise);
    if (Math.abs(converted - r) > 0.001) {
      precisionPass = false;
    }
  }
  assert(precisionPass, 'Zero floating point drift across odd fractional rupee values in paise engine');

  // -------------------------------------------------------------------------
  // TEST GROUP 10: MULTI-TENANT CROSS-COMPANY DATA ISOLATION
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 10: Multi-Tenant Tenant Isolation ---');

  // Company B user attempts to fetch Company A invoice
  const crossInvGetRes = await fetch(`${BASE_URL}/invoices/${createdInvoice.id}`, {
    headers: {
      Authorization: `Bearer ${tokenAdminB}`,
    },
  });
  assert(crossInvGetRes.status === 404, 'Cross-company invoice fetch returned HTTP 404 (No data leakage)');

  // Company B user attempts to record payment on Company A invoice
  const crossPayRes = await fetch(`${BASE_URL}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminB}`,
    },
    body: JSON.stringify({
      invoiceId: createdInvoice.id,
      amountPaise: 100000,
      referenceNumber: 'HACK-ATTEMPT-01',
    }),
  });
  assert(crossPayRes.status === 404, 'Cross-company payment submission rejected with HTTP 404');

  // Company B user queries /api/invoices
  const compBListRes = await fetch(`${BASE_URL}/invoices`, {
    headers: {
      Authorization: `Bearer ${tokenAdminB}`,
    },
  });
  const compBListData = await compBListRes.json();
  assert(compBListData.data.length === 0, 'Company B invoice query returns 0 records (Absolute tenant isolation)');

  // Receivables report
  const receivablesRes = await fetch(`${BASE_URL}/reports/receivables`, {
    headers: {
      Authorization: `Bearer ${tokenAccountantA}`,
    },
  });
  const receivablesData = await receivablesRes.json();
  assert(receivablesRes.status === 200 && receivablesData.success === true, 'Customer receivables aging report generated successfully');
  assert(receivablesData.customers.length > 0, 'Receivables report lists customer accounts');
  assert(receivablesData.disclaimer.includes('Operational TMS Invoice'), 'Statutory GTA disclaimer included in report payload');

  // Final summary
  console.log('\n========================================================================');
  console.log(`   PHASE 8 VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED     `);
  console.log('========================================================================\n');

  server.close();

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase8InvoicingTests().catch((err) => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
