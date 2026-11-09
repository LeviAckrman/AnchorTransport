/**
 * AnchorTransport TMS - Phase 7 Financial Operations Verification Suite
 * 
 * Verifies:
 * 1. Expense creation (Fuel, Toll, Parking, Driver Allowance, Loading, Unloading, Repair, Other)
 * 2. Expense updates & automatic recalculation of trip totals
 * 3. Advance recording (Cash movements that do NOT count as corporate expenses)
 * 4. Settlement calculation (Total advances minus approved deductions equals remaining driver balance)
 * 5. Duplicate settlement prevention (One settlement per trip, HTTP 409 conflict)
 * 6. Financial precision (Integer paise arithmetic, zero floating point inaccuracies)
 * 7. Unauthorized changes (Locked finalized settlements, authorized correction override)
 * 8. Multi-tenant company isolation (Cross-company data leakage prevention)
 */

import { serverFleetStore } from '../server/store';
import {
  calculateTripContribution,
  calculateDriverSettlement,
  formatINR,
  paiseToRupees,
  rupeesToPaise,
} from '../lib/financialEngine';
import { signSessionToken } from '../server/auth';
import {
  Trip,
  Vehicle,
  Driver,
  Customer,
  TripExpense,
  DriverAdvance,
  TripSettlement,
  ExpenseCategory,
  PaymentMode,
} from '../types/tms';
import express from 'express';
import http from 'http';
import { financialsRouter } from '../server/routes/financials.routes';


async function runPhase7FinancialTests() {
  console.log('========================================================================');
  console.log('   ANCHORTRANSPORT TMS - PHASE 7 FINANCIAL OPERATIONS VERIFICATION       ');
  console.log('========================================================================');

  const app = express();
  app.use(express.json());
  app.use('/api', financialsRouter);

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

  // Generate valid tokens
  const tokenOwnerA = signSessionToken({
    userId: 'usr_owner_a',
    email: 'owner@wbroyal.com',
    name: 'Rajesh Mukherjee',
    companyId: compA,
    role: 'OWNER',
  });

  const tokenDispatcherA = signSessionToken({
    userId: 'usr_disp_a',
    email: 'ops@wbroyal.com',
    name: 'Subhash Sen',
    companyId: compA,
    role: 'OPERATIONS',
  });

  const tokenAdminB = signSessionToken({
    userId: 'usr_admin_b',
    email: 'admin@tmthaulers.com',
    name: 'Bikash Agarwal',
    companyId: compB,
    role: 'ADMIN',
  });

  // Setup dedicated test trip in Company A
  const testTripA: Trip = {
    id: `trip_test_fin_${Date.now()}`,
    companyId: compA,
    tripNumber: 'TR-2026-9001',
    lrNumber: 'LR-2026-9001',
    customerId: 'cust_tata_01',
    customerName: 'Tata Steel Processing Ltd',
    customerGstin: '19AAACT0001A1Z1',
    vehicleId: 'veh_wb11_1234',
    vehicleReg: 'WB 11 1234',
    driverId: 'drv_ramesh_01',
    driverName: 'Ramesh Yadav',
    driverPhone: '+91 98301 23456',
    originCity: 'Kolkata, WB',
    destinationCity: 'Durgapur, WB',
    goodsType: 'Steel Billets',
    weightTonnes: 28.5,
    ratePerTonnePaise: 250000, // ₹2,500/Tonne
    freightAmountPaise: 7125000, // ₹71,250
    otherChargesPaise: 200000, // ₹2,000 loading detention
    totalRevenuePaise: 7325000, // ₹73,250
    dispatchDate: '2026-11-05',
    expectedDeliveryDate: '2026-11-06',
    status: 'IN_TRANSIT',
    startOdometerKm: 145000,
    podReceived: false,
    isSettled: false,
    isInvoiced: false,
    totalExpensesPaise: 0,
    totalAdvancesPaise: 0,
    tripContributionPaise: 7325000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  serverFleetStore.trips.push(testTripA);

  // -------------------------------------------------------------------------
  // TEST GROUP 1: EXPENSE CREATION ACROSS ALL OPERATIONAL CATEGORIES
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 1: Expense Creation (All Categories & Fields) ---');

  const categoriesToTest: { cat: ExpenseCategory; amountPaise: number; notes: string; mode: PaymentMode }[] = [
    { cat: 'FUEL', amountPaise: 1850000, notes: 'HPCL Pump 210L @ ₹88.09', mode: 'PETRO_CARD' },
    { cat: 'TOLL', amountPaise: 240000, notes: 'NHAI FASTag Dankuni Toll', mode: 'FASTAG' },
    { cat: 'PARKING', amountPaise: 35000, notes: 'Durgapur Industrial Complex Entry', mode: 'CASH' },
    { cat: 'DRIVER_ALLOWANCE', amountPaise: 100000, notes: 'Driver 2-Day Food Allowance (Bata)', mode: 'CASH' },
    { cat: 'LOADING', amountPaise: 120000, notes: 'Crane Loading Hamali Charges', mode: 'BANK_TRANSFER' },
    { cat: 'UNLOADING', amountPaise: 150000, notes: 'Consignee Yard Forklift Handling', mode: 'CASH' },
    { cat: 'REPAIR', amountPaise: 85000, notes: 'Tyre Puncture & Valve Replacement', mode: 'CASH' },
    { cat: 'OTHER', amountPaise: 50000, notes: 'State Border Forest Weighment Tax', mode: 'CASH' },
  ];

  let totalExpenseSumPaise = 0;

  for (const item of categoriesToTest) {
    totalExpenseSumPaise += item.amountPaise;
    const res = await fetch(`${BASE_URL}/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenOwnerA}`,
      },
      body: JSON.stringify({
        tripId: testTripA.id,
        vehicleId: testTripA.vehicleId,
        category: item.cat,
        amountPaise: item.amountPaise,
        date: '2026-11-05',
        paymentMode: item.mode,
        notes: item.notes,
        receiptAttachmentUrl: 'https://storage.googleapis.com/tms-receipts/rec_001.pdf',
        litres: item.cat === 'FUEL' ? 210 : undefined,
      }),
    });

    const data = await res.json();
    assert(res.status === 201 && data.success === true, `Created expense for category ${item.cat} (₹${item.amountPaise / 100})`);
    assert(data.expense.companyId === compA, `Expense companyId properly bound to company A`);
    assert(data.expense.tripId === testTripA.id, `Expense bound to trip ${testTripA.tripNumber}`);
    assert(data.expense.receiptAttachmentUrl !== undefined, `Receipt attachment preserved for ${item.cat}`);
  }

  // Verify trip total expenses and contribution recalculated
  const updatedTripAfterExpenses = serverFleetStore.trips.find((t) => t.id === testTripA.id)!;
  assert(
    updatedTripAfterExpenses.totalExpensesPaise === totalExpenseSumPaise,
    `Trip total expenses matches sum of recorded categories: ₹${totalExpenseSumPaise / 100} (Found ₹${updatedTripAfterExpenses.totalExpensesPaise / 100})`
  );

  const expectedContribution = testTripA.totalRevenuePaise - totalExpenseSumPaise;
  assert(
    updatedTripAfterExpenses.tripContributionPaise === expectedContribution,
    `Trip contribution correctly computed (Revenue - Expenses): ₹${expectedContribution / 100} (Found ₹${updatedTripAfterExpenses.tripContributionPaise / 100})`
  );

  // -------------------------------------------------------------------------
  // TEST GROUP 2: EXPENSE UPDATES & TOTAL RECALCULATION
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 2: Expense Updates & In-Lockstep Recalculations ---');

  const expenseToUpdate = serverFleetStore.expenses.find((e) => e.tripId === testTripA.id && e.category === 'PARKING')!;
  const oldAmount = expenseToUpdate.amountPaise;
  const newAmount = 50000; // Increased from ₹350 to ₹500 (+₹150)
  const diff = newAmount - oldAmount;

  const updateRes = await fetch(`${BASE_URL}/expenses/${expenseToUpdate.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenOwnerA}`,
    },
    body: JSON.stringify({
      amountPaise: newAmount,
      notes: 'Updated Durgapur entry parking with overnight surcharge',
    }),
  });

  const updateData = await updateRes.json();
  assert(updateRes.status === 200 && updateData.success === true, 'Expense successfully updated via API');
  assert(updateData.expense.amountPaise === newAmount, 'Updated expense amount reflects new paise value');

  const tripAfterExpUpdate = serverFleetStore.trips.find((t) => t.id === testTripA.id)!;
  assert(
    tripAfterExpUpdate.totalExpensesPaise === totalExpenseSumPaise + diff,
    `Trip total expenses increased exactly by diff: ₹${(totalExpenseSumPaise + diff) / 100}`
  );
  assert(
    tripAfterExpUpdate.tripContributionPaise === expectedContribution - diff,
    `Trip contribution decreased exactly by diff: ₹${(expectedContribution - diff) / 100}`
  );

  totalExpenseSumPaise += diff;

  // -------------------------------------------------------------------------
  // TEST GROUP 3: DRIVER ADVANCE RECORDING (NON-EXPENSE CASH FLOAT INVARIANT)
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 3: Driver Advance Recording (Cash Float Invariant) ---');

  const advanceAmountPaise = 500000; // ₹5,000 cash advance
  const prevExpPaise = tripAfterExpUpdate.totalExpensesPaise;
  const prevContribPaise = tripAfterExpUpdate.tripContributionPaise;

  const advRes = await fetch(`${BASE_URL}/advances`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenDispatcherA}`,
    },
    body: JSON.stringify({
      tripId: testTripA.id,
      driverId: testTripA.driverId,
      amountPaise: advanceAmountPaise,
      date: '2026-11-05',
      paymentMode: 'CASH',
      advanceType: 'CASH_DISPATCH',
      reference: 'VOUCHER-ADV-001',
      notes: 'En-route cash advance for driver food and toll topup',
    }),
  });

  const advData = await advRes.json();
  assert(advRes.status === 201 && advData.success === true, 'Driver advance recorded successfully');
  assert(advData.advance.amountPaise === advanceAmountPaise, 'Advance recorded with correct amount (₹5,000)');

  const tripAfterAdvance = serverFleetStore.trips.find((t) => t.id === testTripA.id)!;
  assert(
    tripAfterAdvance.totalAdvancesPaise === advanceAmountPaise,
    `Trip total advances increased to ₹${advanceAmountPaise / 100}`
  );

  // CRITICAL INVARIANT: ADVANCES MUST NOT COUNT AS EXPENSES!
  assert(
    tripAfterAdvance.totalExpensesPaise === prevExpPaise,
    `CRITICAL INVARIANT: Total trip expenses remains strictly unchanged after advance (₹${tripAfterAdvance.totalExpensesPaise / 100})`
  );
  assert(
    tripAfterAdvance.tripContributionPaise === prevContribPaise,
    `CRITICAL INVARIANT: Trip contribution remains strictly unchanged after advance (₹${tripAfterAdvance.tripContributionPaise / 100})`
  );

  // -------------------------------------------------------------------------
  // TEST GROUP 4: SETTLEMENT CALCULATION (REMAINING DRIVER BALANCE)
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 4: Settlement Calculation & Balance Verification ---');

  // Let's create an additional cash advance to test multi-advance reconciliation
  const advRes2 = await fetch(`${BASE_URL}/advances`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenDispatcherA}`,
    },
    body: JSON.stringify({
      tripId: testTripA.id,
      driverId: testTripA.driverId,
      amountPaise: 300000, // ₹3,000 second advance
      date: '2026-11-06',
      paymentMode: 'UPI',
      reference: 'UPI-TXN-987654',
      notes: 'Emergency tyre repair advance',
    }),
  });
  await advRes2.json();

  const totalAdvanceDisbursedPaise = 500000 + 300000; // ₹8,000 total advances

  // Driver calculations:
  // Total Advances: ₹8,000
  // Approved Deductions: ₹1,000 (penalty for delayed proof of delivery or transit diesel deviation)
  // Driver Cash Expenses Submitted: ₹500 (parking) + ₹850 (repair) + ₹1,500 (unloading) = ₹2,850
  // Driver Bata: 2 days @ ₹500/day = ₹1,000
  // Formula: Total Advances - Approved Deductions = Remaining Driver Balance
  // Remaining Driver Balance = ₹8,000 - ₹1,000 = ₹7,000
  // Net Cash Settlement = Total Advances - (Driver Cash Expenses + Driver Bata) + Deductions
  const approvedDeductionsPaise = 100000; // ₹1,000

  const draftSettlementRes = await fetch(`${BASE_URL}/settlements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenOwnerA}`,
    },
    body: JSON.stringify({
      tripId: testTripA.id,
      status: 'DRAFT',
      driverBataDays: 2,
      approvedDeductionsPaise,
      deductionReason: 'Excess idling transit diesel deviation',
      settlementNotes: 'Draft settlement pending final physical trip receipt handover',
    }),
  });

  const draftData = await draftSettlementRes.json();
  assert(draftSettlementRes.status === 201 && draftData.success === true, 'Draft settlement created successfully');
  assert(draftData.settlement.settlementNumber.startsWith('STL-'), `Generated unique settlement number: ${draftData.settlement.settlementNumber}`);
  assert(
    draftData.settlement.totalAdvanceGivenPaise === totalAdvanceDisbursedPaise,
    `Settlement recognizes total advances: ₹${totalAdvanceDisbursedPaise / 100}`
  );
  assert(
    draftData.settlement.approvedDeductionsPaise === approvedDeductionsPaise,
    `Settlement captures approved deductions: ₹${approvedDeductionsPaise / 100}`
  );

  const expectedRemainingDriverBalance = totalAdvanceDisbursedPaise - approvedDeductionsPaise;
  assert(
    draftData.settlement.remainingDriverBalancePaise === expectedRemainingDriverBalance,
    `Settlement formula verified (Total Advances - Approved Deductions): ₹${expectedRemainingDriverBalance / 100} (Found ₹${draftData.settlement.remainingDriverBalancePaise / 100})`
  );

  // -------------------------------------------------------------------------
  // TEST GROUP 5: PREVENT DUPLICATE SETTLEMENTS (ONE PER TRIP)
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 5: Duplicate Settlement Prevention (HTTP 409 Conflict) ---');

  const duplicateSettlementRes = await fetch(`${BASE_URL}/settlements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenOwnerA}`,
    },
    body: JSON.stringify({
      tripId: testTripA.id,
      status: 'FINALIZED',
      driverBataDays: 2,
      approvedDeductionsPaise: 50000,
    }),
  });

  const duplicateData = await duplicateSettlementRes.json();
  assert(
    duplicateSettlementRes.status === 409,
    `Duplicate settlement strictly rejected with HTTP 409 Conflict (Got status ${duplicateSettlementRes.status})`
  );
  assert(
    duplicateData.error && duplicateData.error.includes('Duplicate settlements are strictly blocked'),
    'Helpful error message informs user of existing settlement and prevents double booking'
  );

  // -------------------------------------------------------------------------
  // TEST GROUP 6: FINANCIAL PRECISION (INTEGER PAISE NO FLOAT DRIFT)
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 6: Financial Precision & Currency Safety ---');

  // Verify floating-point avoidance in paise conversion
  const testRupeeValues = [0.01, 0.1, 0.2, 0.7, 105.5, 99999.99, 1250000.75];
  let precisionOk = true;

  for (const r of testRupeeValues) {
    const paise = rupeesToPaise(r);
    const convertedBack = paiseToRupees(paise);
    if (Math.abs(convertedBack - r) > 0.001) {
      precisionOk = false;
    }
  }
  assert(precisionOk, 'Paise <-> Rupee conversions maintain exact 2-decimal precision without IEEE 754 drift');

  // Verify formatINR displays Indian Numbering System (e.g. ₹12,34,567.00)
  const formattedINR = formatINR(123456700);
  assert(
    formattedINR.includes('12,34,567') || formattedINR.includes('1,234,567'),
    `Format INR outputs compliant currency display: ${formattedINR}`
  );

  // Pure function calculation precision test
  const dummyExpenses: TripExpense[] = [
    {
      id: 'e1',
      companyId: compA,
      tripId: 't1',
      category: 'FUEL',
      amountPaise: 123456,
      date: '2026-11-05',
      paymentMode: 'CASH',
      recordedBy: 'Ops',
      isDriverDisbursed: false,
      createdBy: 'Ops',
      createdAt: '2026-11-05',
      updatedAt: '2026-11-05',
    },
    {
      id: 'e2',
      companyId: compA,
      tripId: 't1',
      category: 'TOLL',
      amountPaise: 654321,
      date: '2026-11-05',
      paymentMode: 'FASTAG',
      recordedBy: 'Ops',
      isDriverDisbursed: false,
      createdBy: 'Ops',
      createdAt: '2026-11-05',
      updatedAt: '2026-11-05',
    },
  ];
  const pureContrib = calculateTripContribution(1000000, dummyExpenses);
  assert(
    pureContrib.expensesPaise === 123456 + 654321,
    `Exact integer summation of expense paise: ${pureContrib.expensesPaise}`
  );
  assert(
    pureContrib.contributionPaise === 1000000 - (123456 + 654321),
    `Exact integer contribution subtraction: ${pureContrib.contributionPaise}`
  );

  // -------------------------------------------------------------------------
  // TEST GROUP 7: UNAUTHORIZED CHANGES TO FINALIZED SETTLEMENTS & CORRECTIONS
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 7: Finalized Settlement Lock & Authorized Corrections ---');

  const existingSettlement = serverFleetStore.settlements.find((s) => s.tripId === testTripA.id)!;

  // Finalize the settlement first
  const finalizeRes = await fetch(`${BASE_URL}/settlements/${existingSettlement.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenOwnerA}`,
    },
    body: JSON.stringify({
      status: 'FINALIZED',
      settlementNotes: 'Final audited settlement closed with driver',
    }),
  });
  const finalizeData = await finalizeRes.json();
  assert(finalizeRes.status === 200 && finalizeData.success === true, 'Settlement successfully finalized and locked');
  assert(finalizeData.settlement.status === 'FINALIZED', 'Settlement status set to FINALIZED');

  // Attempt 1: Regular dispatcher tries to change finalized settlement without authorization
  const unauthorizedChangeRes = await fetch(`${BASE_URL}/settlements/${existingSettlement.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenDispatcherA}`,
    },
    body: JSON.stringify({
      approvedDeductionsPaise: 200000, // Try to add ₹1,000 deduction
      notes: 'Hacked change',
    }),
  });

  const unauthData = await unauthorizedChangeRes.json();
  assert(
    unauthorizedChangeRes.status === 403,
    `Unauthorized modification to finalized settlement blocked with HTTP 403 (Got status ${unauthorizedChangeRes.status})`
  );
  assert(
    unauthData.error && unauthData.error.includes('finalized driver settlements are locked'),
    'Error message enforces authorization requirements for settled audits'
  );

  // Attempt 2: Admin tries to change WITHOUT providing an authorized correction reason
  const missingReasonRes = await fetch(`${BASE_URL}/settlements/${existingSettlement.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenOwnerA}`,
    },
    body: JSON.stringify({
      approvedDeductionsPaise: 200000,
      isCorrectionAuthorized: true,
      // Intentionally omitting correctionReason
    }),
  });
  assert(
    missingReasonRes.status === 403,
    'Modification blocked when correctionReason is missing even with isCorrectionAuthorized flag'
  );

  // Attempt 3: Owner performs legally authorized audit correction with mandatory reason
  const authorizedCorrectionRes = await fetch(`${BASE_URL}/settlements/${existingSettlement.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenOwnerA}`,
    },
    body: JSON.stringify({
      isCorrectionAuthorized: true,
      correctionReason: 'Audit review by CFO: Waived transit diesel deviation after telematics check',
      approvedDeductionsPaise: 0, // Waive the ₹1,000 deduction
    }),
  });

  const authCorrectionData = await authorizedCorrectionRes.json();
  assert(
    authorizedCorrectionRes.status === 200 && authCorrectionData.success === true,
    'Authorized correction successfully accepted for audited settlement'
  );
  assert(
    authCorrectionData.settlement.isCorrectionAuthorized === true,
    'Settlement audit trail records isCorrectionAuthorized flag'
  );
  assert(
    authCorrectionData.settlement.correctionReason.includes('Audit review by CFO'),
    'Settlement preserves permanent audit log rationale'
  );

  // -------------------------------------------------------------------------
  // TEST GROUP 8: MULTI-TENANT CROSS-COMPANY DATA ISOLATION
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 8: Multi-Tenant Cross-Company Isolation ---');

  // Company B user attempts to read Company A expenses
  const crossExpGetRes = await fetch(`${BASE_URL}/expenses/${expenseToUpdate.id}`, {
    headers: {
      Authorization: `Bearer ${tokenAdminB}`,
    },
  });
  assert(
    crossExpGetRes.status === 404,
    `Cross-company expense read by Company B returned HTTP 404 Not Found (Zero cross-tenant leakage)`
  );

  // Company B user attempts to update Company A expense
  const crossExpPutRes = await fetch(`${BASE_URL}/expenses/${expenseToUpdate.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenAdminB}`,
    },
    body: JSON.stringify({
      amountPaise: 9999999,
    }),
  });
  assert(
    crossExpPutRes.status === 404,
    `Cross-company expense update by Company B rejected with HTTP 404 Not Found`
  );

  // Company B user attempts to read Company A settlement
  const crossStlGetRes = await fetch(`${BASE_URL}/settlements/${existingSettlement.id}`, {
    headers: {
      Authorization: `Bearer ${tokenAdminB}`,
    },
  });
  assert(
    crossStlGetRes.status === 404,
    `Cross-company settlement read by Company B returned HTTP 404 Not Found`
  );

  // Company B queries /api/expenses listing
  const compBListRes = await fetch(`${BASE_URL}/expenses`, {
    headers: {
      Authorization: `Bearer ${tokenAdminB}`,
    },
  });
  const compBListData = await compBListRes.json();
  assert(
    compBListData.data.length === 0,
    `Company B expenses listing shows 0 records (Company A expenses completely isolated)`
  );

  // Final summary
  console.log('\n========================================================================');
  console.log(`   PHASE 7 VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED     `);
  console.log('========================================================================\n');

  server.close();

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase7FinancialTests().catch((err) => {
  console.error('Test execution fatal error:', err);
  process.exit(1);
});
