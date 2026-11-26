/**
 * AnchorTransports TMS - Invoice Company Branding, Isolation, Snapshot Immutability & PDF Tests
 *
 * Verifies:
 * 1. Two-user / multi-tenant isolation (User A vs User B company profiles & logos never leak across invoices)
 * 2. Historical invoice immutability (finalized invoices preserve companySnapshot even when profile changes)
 * 3. Draft & legacy pre-snapshot invoices dynamically reflect active owner company profile
 * 4. Company profile completeness guard before finalizing (ISSUED) while allowing optional GSTIN
 * 5. Firestore payload sanitization preserves finalized companySnapshot during payment/edit updates
 * 6. Logo aspect ratio preservation & real jsPDF generation (with & without embedded PNG data-URL logo)
 * 7. Firestore rules & blueprint structural integrity for country, logoStoragePath, and snapshot lock
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { jsPDF } from 'jspdf';
import {
  buildCompanyInvoiceSnapshot,
  fitLogoDimensions,
  loadCompanyLogoForPdf,
  resolveInvoiceCompanyBranding,
  validateCompanyProfileForInvoicing,
} from '../lib/invoiceBranding';
import { downloadInvoicePdf } from '../lib/pdfGenerator';
import { sanitizeSubcollectionPayload } from '../lib/firebase/firestoreService';
import type { Company, Customer, Invoice, Trip } from '../types/tms';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../..');

// Valid 1x1 transparent PNG data URL for headless jsPDF embedding verification
const SAMPLE_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAECAYAAAC3OK7NAAAAFUlEQVR42mP8z8BQz0AEYBxVSF0AAHkSAwX8vN+zAAAAAElFTkSuQmCC';

async function runInvoiceBrandingTests() {
  console.log('========================================================================');
  console.log('   ANCHORTRANSPORTS - INVOICE COMPANY BRANDING & SNAPSHOT SUITE         ');
  console.log('========================================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${testName}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  const companyA: Company = {
    id: 'comp_alpha_transport',
    name: 'Alpha Roadlines Private Limited',
    tradeName: 'Alpha Freight',
    gstin: '19AABCA1234D1Z5',
    pan: 'AABCA1234D',
    phone: '+91 98300 11111',
    email: 'billing@alpharoadlines.in',
    address: 'Plot 14, Dankuni Freight Corridor, NH-19',
    city: 'Howrah',
    state: 'West Bengal',
    stateCode: '19',
    pincode: '711403',
    country: 'India',
    bankName: 'HDFC Bank Ltd.',
    accountNumber: '50200011223344',
    ifscCode: 'HDFC0000214',
    branch: 'Kona Expressway',
    lrPrefix: 'ALP/25-26/',
    invoicePrefix: 'ALP/INV/',
    tripPrefix: 'ALP-',
    logoUrl: SAMPLE_PNG_DATA_URL,
    logoStoragePath: 'users/uid_owner_a/company/comp_alpha_transport/logo_a.png',
    ownerId: 'uid_owner_a',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const companyB: Company = {
    id: 'comp_beta_carriers',
    name: 'Beta Heavy Carriers LLP',
    tradeName: 'Beta Logistics',
    gstin: '27AAACB9999K1Z2',
    pan: 'AAACB9999K',
    phone: '+91 99200 22222',
    email: 'accounts@betacarriers.in',
    address: 'Sector 19B, Kalamboli Steel Market',
    city: 'Navi Mumbai',
    state: 'Maharashtra',
    stateCode: '27',
    pincode: '410218',
    country: 'India',
    bankName: 'ICICI Bank',
    accountNumber: '000405009988',
    ifscCode: 'ICIC0000004',
    branch: 'Kalamboli',
    lrPrefix: 'BET/25-26/',
    invoicePrefix: 'BET/INV/',
    tripPrefix: 'BET-',
    logoUrl: 'https://firebasestorage.example.com/v0/b/bucket/o/users%2Fuid_owner_b%2Flogo.png',
    logoStoragePath: 'users/uid_owner_b/company/comp_beta_carriers/logo_b.png',
    ownerId: 'uid_owner_b',
    createdAt: '2026-01-02T00:00:00.000Z',
  };

  // -------------------------------------------------------------------------
  // 1. PROFILE COMPLETENESS GUARD BEFORE FINALIZING INVOICES
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 1: Company Profile Completeness Validation ---');

  const completeCheck = validateCompanyProfileForInvoicing(companyA);
  assert(completeCheck.complete === true && completeCheck.missingFields.length === 0, 'Complete company profile passes validation');

  const noGstinCompany: Company = { ...companyA, gstin: '', pan: '' };
  assert(
    validateCompanyProfileForInvoicing(noGstinCompany).complete === true,
    'Company profile without optional GSTIN/PAN still passes (GSTIN is optional)'
  );

  const incompleteCompany: Partial<Company> = {
    id: 'comp_incomplete',
    name: '   ',
    address: '',
    city: 'Kolkata',
    state: '',
    phone: '',
    email: '',
  };
  const incompleteRes = validateCompanyProfileForInvoicing(incompleteCompany);
  assert(incompleteRes.complete === false, 'Incomplete company profile blocked from finalizing');
  assert(
    incompleteRes.missingFields.includes('Company Legal Name') &&
      incompleteRes.missingFields.includes('Registered Office Address') &&
      incompleteRes.missingFields.includes('State') &&
      incompleteRes.missingFields.includes('Company Phone Number or Email'),
    'Incomplete check reports exact missing fields'
  );

  // -------------------------------------------------------------------------
  // 2. TWO-USER MULTI-TENANT BRANDING ISOLATION
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 2: Multi-User Tenant Isolation (User A vs User B) ---');

  const snapA = buildCompanyInvoiceSnapshot(companyA, '2026-11-10T10:00:00.000Z');
  const snapB = buildCompanyInvoiceSnapshot(companyB, '2026-11-10T10:05:00.000Z');

  const invoiceA: Invoice = {
    id: 'inv_a_001',
    companyId: companyA.id,
    invoiceNumber: 'ALP/INV/0001',
    customerId: 'cust_1',
    customerName: 'Tata Steel Ltd',
    customerGstin: '19AAACT0001A1Z1',
    billingAddress: 'Tata Centre, Kolkata',
    tripId: 'trip_a_1',
    tripNumber: 'ALP-2026-001',
    lrNumber: 'ALP/25-26/0001',
    vehicleReg: 'WB 11 AB 1234',
    driverName: 'Ramesh Yadav',
    driverPhone: '+91 98301 11223',
    originCity: 'Howrah',
    destinationCity: 'Jamshedpur',
    goodsType: 'HR Steel Coils',
    weightTonnes: 28,
    hsnSacCode: '996511',
    issueDate: '2026-11-10',
    dueDate: '2026-12-10',
    freightAmountPaise: 5000000,
    loadingChargesPaise: 150000,
    taxableAmountPaise: 5150000,
    isRcmApplicable: true,
    gstRatePercent: 5,
    cgstRatePercent: 0,
    sgstRatePercent: 0,
    igstRatePercent: 0,
    cgstAmountPaise: 0,
    sgstAmountPaise: 0,
    igstAmountPaise: 0,
    totalTaxPaise: 0,
    totalAmountPaise: 5150000,
    amountPaidPaise: 0,
    balanceDuePaise: 5150000,
    status: 'ISSUED',
    paymentStatus: 'UNPAID',
    companySnapshot: snapA,
    createdAt: '2026-11-10T10:00:00.000Z',
    updatedAt: '2026-11-10T10:00:00.000Z',
  };

  const invoiceB: Invoice = {
    ...invoiceA,
    id: 'inv_b_001',
    companyId: companyB.id,
    invoiceNumber: 'BET/INV/0001',
    companySnapshot: snapB,
  };

  const resolvedA = resolveInvoiceCompanyBranding(invoiceA, companyA);
  const resolvedB = resolveInvoiceCompanyBranding(invoiceB, companyB);

  assert(
    resolvedA.legalName === companyA.name &&
      resolvedA.gstin === companyA.gstin &&
      resolvedA.bankName === companyA.bankName &&
      resolvedA.locationLine === 'Howrah, West Bengal, 711403, India',
    'User A invoice resolves exclusively to User A branding'
  );
  assert(
    resolvedB.legalName === companyB.name &&
      resolvedB.gstin === companyB.gstin &&
      resolvedB.bankName === companyB.bankName &&
      resolvedB.locationLine === 'Navi Mumbai, Maharashtra, 410218, India',
    'User B invoice resolves exclusively to User B branding'
  );

  // Cross-tenant safety: even if Company B object were accidentally passed alongside Invoice A, Company B never leaks!
  const crossTenantDraft: Invoice = {
    ...invoiceA,
    status: 'DRAFT',
    companySnapshot: undefined,
  };
  const crossLeakCheck = resolveInvoiceCompanyBranding(crossTenantDraft, companyB);
  assert(
    crossLeakCheck.source === 'none' &&
      crossLeakCheck.legalName === 'Transport Company' &&
      crossLeakCheck.gstin === undefined &&
      crossLeakCheck.logoUrl === undefined,
    'Cross-tenant live company object (companyB for companyA invoice) is strictly rejected'
  );

  // -------------------------------------------------------------------------
  // 3. HISTORICAL SNAPSHOT IMMUTABILITY & DRAFT DYNAMIC UPDATES
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 3: Historical Snapshot Immutability ---');

  const updatedCompanyA: Company = {
    ...companyA,
    name: 'Alpha Express Logistics Pvt Ltd (Rebranded)',
    address: 'Tower B, Salt Lake Sector V',
    city: 'Kolkata',
    pincode: '700091',
    phone: '+91 98300 99999',
    bankName: 'State Bank of India',
    accountNumber: '30001122334455',
    logoUrl: 'https://firebasestorage.example.com/new-logo-a.png',
  };

  const historicalResolved = resolveInvoiceCompanyBranding(invoiceA, updatedCompanyA);
  assert(
    historicalResolved.source === 'snapshot' &&
      historicalResolved.isSnapshotLocked === true &&
      historicalResolved.legalName === 'Alpha Roadlines Private Limited' &&
      historicalResolved.address === 'Plot 14, Dankuni Freight Corridor, NH-19' &&
      historicalResolved.bankName === 'HDFC Bank Ltd.' &&
      historicalResolved.logoUrl === SAMPLE_PNG_DATA_URL,
    'Finalized historical invoice retains original companySnapshot after company profile edit'
  );

  const draftResolved = resolveInvoiceCompanyBranding(
    { ...invoiceA, status: 'DRAFT', companySnapshot: undefined },
    updatedCompanyA
  );
  assert(
    draftResolved.source === 'live_company' &&
      draftResolved.isSnapshotLocked === false &&
      draftResolved.legalName === updatedCompanyA.name &&
      draftResolved.bankName === 'State Bank of India',
    'Draft invoice dynamically picks up updated company profile until finalized'
  );

  // Firestore sanitizer preserves existing finalized snapshot against mutation or stripping
  const sanitizedPaymentUpdate = sanitizeSubcollectionPayload(
    'invoices',
    companyA.id,
    {
      ...invoiceA,
      amountPaidPaise: 2500000,
      balanceDuePaise: 2650000,
      status: 'PARTIALLY_PAID',
      paymentStatus: 'PARTIALLY_PAID',
      companySnapshot: { companyId: companyA.id, name: 'Tampered Name Attempt' },
    },
    {
      status: 'ISSUED',
      companySnapshot: snapA,
    } as any
  );
  assert(
    sanitizedPaymentUpdate !== null &&
      sanitizedPaymentUpdate.companySnapshot?.name === companyA.name &&
      sanitizedPaymentUpdate.companySnapshot?.bankName === companyA.bankName &&
      sanitizedPaymentUpdate.driverName === 'Ramesh Yadav',
    'sanitizeSubcollectionPayload preserves immutable companySnapshot and driverName on finalized invoice updates'
  );

  // -------------------------------------------------------------------------
  // 4. LOGO ASPECT RATIO & PDF GENERATION VERIFICATION
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 4: Logo Aspect Ratio & PDF Generation ---');

  const wide = fitLogoDimensions(400, 100, 120, 46);
  const tall = fitLogoDimensions(100, 400, 120, 46);
  const square = fitLogoDimensions(200, 200, 120, 46);

  assert(
    wide.width === 120 && wide.height === 30 && Math.abs(wide.width / wide.height - 4) < 0.01,
    'Wide logo scaled proportionally (400x100 -> 120x30)'
  );
  assert(
    tall.height === 46 && tall.width === 11.5 && Math.abs(tall.width / tall.height - 0.25) < 0.01,
    'Tall logo scaled proportionally (100x400 -> 11.5x46)'
  );
  assert(
    square.width === 46 && square.height === 46,
    'Square logo scaled proportionally (200x200 -> 46x46)'
  );

  const loadedDataLogo = await loadCompanyLogoForPdf(SAMPLE_PNG_DATA_URL);
  assert(
    loadedDataLogo !== null &&
      loadedDataLogo.format === 'PNG' &&
      loadedDataLogo.width === 10 &&
      loadedDataLogo.height === 4,
    'loadCompanyLogoForPdf parses PNG data URL and extracts true pixel dimensions (10x4)'
  );

  // Capture jsPDF binary output in-memory via API spy without writing files to disk
  const capture: { filename: string; buffer: ArrayBuffer | null } = {
    filename: '',
    buffer: null,
  };
  const origSave = (jsPDF.API as any).save;
  (jsPDF.API as any).save = function (this: jsPDF, filename: string) {
    capture.filename = filename;
    capture.buffer = this.output('arraybuffer');
    return this;
  };

  try {
    const customerA: Customer = {
      id: 'cust_1',
      companyId: companyA.id,
      name: 'Tata Steel Ltd',
      gstin: '19AAACT0001A1Z1',
      pan: 'AAACT0001A',
      contactPerson: 'Sanjay Sengupta',
      phone: '+91 98309 87654',
      email: 'billing@tatasteel.com',
      billingAddress: 'Tata Centre, 43 JL Nehru Road',
      city: 'Kolkata',
      state: 'West Bengal',
      stateCode: '19',
      pincode: '700071',
      creditPeriodDays: 30,
      creditLimitPaise: 50000000,
      currentOutstandingPaise: 5150000,
      totalFreightBilledPaise: 5150000,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const tripA: Trip = {
      id: 'trip_a_1',
      companyId: companyA.id,
      tripNumber: 'ALP-2026-001',
      lrNumber: 'ALP/25-26/0001',
      customerId: 'cust_1',
      customerName: 'Tata Steel Ltd',
      vehicleId: 'veh_1',
      vehicleReg: 'WB 11 AB 1234',
      driverId: 'drv_1',
      driverName: 'Ramesh Yadav',
      driverPhone: '+91 98301 11223',
      originCity: 'Howrah',
      destinationCity: 'Jamshedpur',
      goodsType: 'HR Steel Coils',
      weightTonnes: 28,
      ratePerTonnePaise: 178571,
      freightAmountPaise: 5000000,
      otherChargesPaise: 150000,
      totalRevenuePaise: 5150000,
      dispatchDate: '2026-11-08',
      expectedDeliveryDate: '2026-11-10',
      status: 'DELIVERED',
      startOdometerKm: 10000,
      podReceived: true,
      isInvoiced: true,
      isSettled: false,
      totalExpensesPaise: 1200000,
      totalAdvancesPaise: 500000,
      tripContributionPaise: 3950000,
      createdAt: '2026-11-08T00:00:00.000Z',
      updatedAt: '2026-11-08T00:00:00.000Z',
    };

    await downloadInvoicePdf(invoiceA, companyA, customerA, tripA);
    const pdfHeader = capture.buffer
      ? new TextDecoder().decode(new Uint8Array(capture.buffer).slice(0, 8))
      : '';
    assert(
      capture.filename === 'ALP/INV/0001.pdf' &&
        pdfHeader.startsWith('%PDF-') &&
        (capture.buffer?.byteLength || 0) > 2000,
      'downloadInvoicePdf generates valid PDF binary with PNG logo and snapshot company details'
    );

    // Fallback test without logo and with long multi-line company name/address
    capture.buffer = null;
    const longCompany: Company = {
      ...companyA,
      name: 'Sri Mahalaxmi Interstate Heavy Logistics & Multimodal Freight Carriers Private Limited',
      address: 'Building 42B, Logistics Hub Phase II, Near National Highway 19 Toll Plaza, Dankuni Industrial Estate',
      logoUrl: '',
      logoStoragePath: '',
    };
    const longInvoice: Invoice = {
      ...invoiceA,
      companySnapshot: undefined,
      status: 'DRAFT',
    };
    await downloadInvoicePdf(longInvoice, longCompany, customerA, tripA);
    const secondPdfBytes = (capture.buffer as ArrayBuffer | null)?.byteLength || 0;
    assert(
      secondPdfBytes > 2000,
      'downloadInvoicePdf succeeds cleanly without logo and wraps long legal name/address'
    );
  } finally {
    (jsPDF.API as any).save = origSave;
  }

  // -------------------------------------------------------------------------
  // 5. FIRESTORE RULES, BLUEPRINT & UI WIRING STRUCTURAL INTEGRITY
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 5: Security Rules, Blueprint & UI Integration Audit ---');

  const rulesSrc = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  const blueprintSrc = fs.readFileSync(path.join(root, 'firebase-blueprint.json'), 'utf8');
  const detailModalSrc = fs.readFileSync(path.join(root, 'src/modules/invoices/InvoiceDetailModal.tsx'), 'utf8');
  const invoiceModalSrc = fs.readFileSync(path.join(root, 'src/modules/invoices/InvoiceModal.tsx'), 'utf8');
  const companyProfileSrc = fs.readFileSync(path.join(root, 'src/components/auth/CompanyProfilePage.tsx'), 'utf8');

  assert(
    rulesSrc.includes('function isValidCompanyInvoiceSnapshot(snap, companyId)') &&
      rulesSrc.includes("'country'") &&
      rulesSrc.includes("'logoStoragePath'") &&
      rulesSrc.includes("data.logoStoragePath.matches('^users/' + request.auth.uid + '/.+')") &&
      rulesSrc.includes("incoming().companySnapshot == existing().companySnapshot"),
    'firestore.rules validates UID-owned logoStoragePath, country, and locks finalized companySnapshot'
  );
  assert(
    blueprintSrc.includes('"companySnapshot"') &&
      blueprintSrc.includes('"logoStoragePath"') &&
      blueprintSrc.includes('"country"'),
    'firebase-blueprint.json documents companySnapshot, logoStoragePath, and country'
  );
  assert(
    detailModalSrc.includes('resolveInvoiceCompanyBranding') &&
      detailModalSrc.includes('TAX INVOICE') &&
      detailModalSrc.includes('branding.hasBankDetails') &&
      detailModalSrc.includes('referrerPolicy="no-referrer"'),
    'InvoiceDetailModal renders company branding header, TAX INVOICE layout, and bank details safely'
  );
  assert(
    invoiceModalSrc.includes('validateCompanyProfileForInvoicing') &&
      invoiceModalSrc.includes('buildCompanyInvoiceSnapshot'),
    'InvoiceModal validates company completeness before issuing and embeds immutable snapshot'
  );
  assert(
    companyProfileSrc.includes('setCountry(') &&
      companyProfileSrc.includes('setPincode(') &&
      companyProfileSrc.includes('logoStoragePath'),
    'CompanyProfilePage persists country, pincode, and logoStoragePath'
  );

  console.log('\n========================================================================');
  console.log(`   INVOICE BRANDING RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runInvoiceBrandingTests().catch((err) => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
