/**
 * AnchorTransport TMS - Client PDF Generation Utility (jsPDF)
 * Generates downloadable GST Tax Invoices (with authenticated company logo,
 * registered address, immutable company snapshot, aspect-ratio scaling, and zero text overlap)
 * and Trip Settlement reports.
 */

import { jsPDF } from 'jspdf';
import {
  fitLogoDimensions,
  loadCompanyLogoForPdf,
  resolveInvoiceCompanyBranding,
} from './invoiceBranding';
import { GTA_GST_DISCLAIMER } from '../types/tms';
import type { Company, Customer, Invoice, Trip, TripSettlement } from '../types/tms';

function formatMoneyPlain(paise: number | undefined): string {
  const val = (paise || 0) / 100;
  return `INR ${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function drawWrappedText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  align: 'left' | 'right' = 'left'
): number {
  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  for (const line of lines) {
    doc.text(line, x, y, { align });
    y += lineHeight;
  }
  return y;
}

function ensurePageSpace(doc: jsPDF, y: number, neededHeight: number): number {
  if (y + neededHeight > 790) {
    doc.addPage();
    return 48;
  }
  return y;
}

export async function downloadInvoicePdf(
  invoice: Invoice,
  company: Company | null,
  customer?: Customer,
  trip?: Trip
): Promise<void> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const left = 42;
  const right = 553;
  const contentWidth = right - left;

  const branding = resolveInvoiceCompanyBranding(invoice, company);
  const logoAsset = await loadCompanyLogoForPdf(branding.logoUrl, branding.logoStoragePath);

  // LEFT HEADER: Company Logo, Legal Name, Registered Office Address, City/State/PIN/Country, GSTIN, Phone, Email
  let leftY = 44;
  const leftMaxWidth = 300;

  if (logoAsset) {
    const fitted = fitLogoDimensions(logoAsset.width, logoAsset.height, 120, 46);
    try {
      doc.addImage(logoAsset.dataUrl, logoAsset.format, left, leftY, fitted.width, fitted.height);
      leftY += fitted.height + 10;
    } catch {
      // Skip invalid image bytes cleanly
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  leftY = drawWrappedText(doc, branding.legalName, left, leftY, leftMaxWidth, 17, 'left');

  if (branding.tradeName) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    leftY = drawWrappedText(doc, `Trading As: ${branding.tradeName}`, left, leftY, leftMaxWidth, 12, 'left');
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);

  if (branding.address) {
    leftY = drawWrappedText(doc, branding.address, left, leftY + 1, leftMaxWidth, 12, 'left');
  }
  if (branding.locationLine) {
    leftY = drawWrappedText(doc, branding.locationLine, left, leftY, leftMaxWidth, 12, 'left');
  }

  if (branding.gstin) {
    const gstLine = branding.stateCode
      ? `GSTIN: ${branding.gstin} (State Code: ${branding.stateCode})`
      : `GSTIN: ${branding.gstin}`;
    leftY = drawWrappedText(doc, gstLine, left, leftY + 2, leftMaxWidth, 12, 'left');
  }
  if (branding.phone) {
    leftY = drawWrappedText(doc, `Phone: ${branding.phone}`, left, leftY, leftMaxWidth, 12, 'left');
  }
  if (branding.email) {
    leftY = drawWrappedText(doc, `Email: ${branding.email}`, left, leftY, leftMaxWidth, 12, 'left');
  }

  // RIGHT HEADER: TAX INVOICE heading, Invoice #, Invoice Date, Due Date, Payment Status
  let rightY = 46;
  const rightMaxWidth = 195;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text('TAX INVOICE', right, rightY, { align: 'right' });
  rightY += 14;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(79, 70, 229);
  doc.text(
    invoice.isRcmApplicable ? 'GTA Reverse Charge (RCM)' : 'GTA Forward Charge GST',
    right,
    rightY,
    { align: 'right' }
  );
  rightY += 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  rightY = drawWrappedText(
    doc,
    `Invoice #: ${invoice.invoiceNumber}`,
    right,
    rightY,
    rightMaxWidth,
    13,
    'right'
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.text(`Invoice Date: ${invoice.issueDate}`, right, rightY, { align: 'right' });
  rightY += 13;

  if (invoice.dueDate) {
    doc.text(`Due Date: ${invoice.dueDate}`, right, rightY, { align: 'right' });
    rightY += 13;
  }

  const rawPaymentStatus =
    invoice.status === 'CANCELLED'
      ? 'CANCELLED'
      : invoice.status === 'DRAFT'
      ? 'DRAFT'
      : invoice.paymentStatus || invoice.status;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(`Payment Status: ${String(rawPaymentStatus).replace(/_/g, ' ')}`, right, rightY, {
    align: 'right',
  });
  rightY += 14;

  // Header divider cleanly below whichever side is taller
  let y = Math.max(leftY, rightY) + 10;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(1);
  doc.line(left, y, right, y);
  y += 18;

  // BILL TO & CONSIGNMENT DETAILS (two columns with independent height tracking)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('BILL TO', left, y);
  doc.text('CONSIGNMENT & TRIP DETAILS', 310, y);
  y += 14;

  let billLeftY = y;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  billLeftY = drawWrappedText(
    doc,
    invoice.customerName || customer?.name || 'Customer',
    left,
    billLeftY,
    245,
    13
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const billAddr =
    invoice.billingAddress ||
    [customer?.billingAddress, customer?.city, customer?.state, customer?.pincode].filter(Boolean).join(', ');
  if (billAddr) {
    billLeftY = drawWrappedText(doc, billAddr, left, billLeftY, 245, 12);
  }
  billLeftY = drawWrappedText(
    doc,
    `Customer GSTIN: ${invoice.customerGstin || customer?.gstin || 'Unregistered / N/A'}`,
    left,
    billLeftY + 2,
    245,
    12
  );

  let billRightY = y;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  billRightY = drawWrappedText(
    doc,
    `Trip #: ${invoice.tripNumber || trip?.tripNumber || 'Standalone Bill'}`,
    310,
    billRightY,
    243,
    12.5
  );
  billRightY = drawWrappedText(
    doc,
    `LR / Bilty #: ${invoice.lrNumber || trip?.lrNumber || '-'}`,
    310,
    billRightY,
    243,
    12.5
  );
  if (invoice.vehicleReg || trip?.vehicleReg) {
    billRightY = drawWrappedText(
      doc,
      `Vehicle: ${invoice.vehicleReg || trip?.vehicleReg} | SAC: ${invoice.hsnSacCode || '996511'}`,
      310,
      billRightY,
      243,
      12.5
    );
  }
  const driverLabel = invoice.driverName || trip?.driverName;
  if (driverLabel) {
    const driverPhone = invoice.driverPhone || trip?.driverPhone;
    billRightY = drawWrappedText(
      doc,
      `Driver: ${driverLabel}${driverPhone ? ` (${driverPhone})` : ''}`,
      310,
      billRightY,
      243,
      12.5
    );
  }
  const routeText =
    invoice.originCity || invoice.destinationCity
      ? `Route: ${invoice.originCity || '-'} -> ${invoice.destinationCity || '-'}`
      : 'Route: Direct Freight Billing';
  billRightY = drawWrappedText(doc, routeText, 310, billRightY, 243, 12.5);
  if (invoice.goodsType) {
    billRightY = drawWrappedText(
      doc,
      `Goods: ${invoice.goodsType}${invoice.weightTonnes ? ` (${invoice.weightTonnes} MT)` : ''}`,
      310,
      billRightY,
      243,
      12.5
    );
  }

  y = Math.max(billLeftY, billRightY) + 18;
  y = ensurePageSpace(doc, y, 120);

  // Charges Table Header
  doc.setFillColor(248, 250, 252);
  doc.rect(left, y, contentWidth, 22, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 41, 59);
  doc.text('Description of Freight & Allied Services', left + 10, y + 14);
  doc.text('Amount', right - 10, y + 14, { align: 'right' });
  y += 34;

  const lineItems: Array<[string, number]> = [
    ['Freight Transport Charges by Road', invoice.freightAmountPaise || 0],
    ['Loading / Crane Handling Charges', invoice.loadingChargesPaise || 0],
    ['Unloading Assistance Charges', invoice.unloadingChargesPaise || 0],
    ['Detention / Halting Charges', invoice.detentionChargesPaise || 0],
    ['Other Freight Charges', invoice.otherChargesPaise || 0],
  ].filter(([, amt]) => (amt as number) > 0) as Array<[string, number]>;

  if (lineItems.length === 0) {
    lineItems.push(['Transport Freight Services', invoice.taxableAmountPaise || invoice.totalAmountPaise || 0]);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  for (const [label, amt] of lineItems) {
    y = ensurePageSpace(doc, y, 22);
    doc.text(label, left + 10, y);
    doc.text(formatMoneyPlain(amt), right - 10, y, { align: 'right' });
    y += 18;
  }

  if ((invoice.discountPaise || 0) > 0) {
    y = ensurePageSpace(doc, y, 22);
    doc.setTextColor(180, 83, 9);
    doc.text('Less: Discount', left + 10, y);
    doc.text(`- ${formatMoneyPlain(invoice.discountPaise)}`, right - 10, y, { align: 'right' });
    y += 18;
  }

  doc.setDrawColor(226, 232, 240);
  doc.line(left, y, right, y);
  y += 16;

  y = ensurePageSpace(doc, y, 120);
  doc.setTextColor(51, 65, 85);
  doc.text('Taxable Value', 320, y);
  doc.text(formatMoneyPlain(invoice.taxableAmountPaise ?? invoice.totalAmountPaise), right - 10, y, { align: 'right' });
  y += 16;

  if (!invoice.isRcmApplicable) {
    if ((invoice.cgstAmountPaise || 0) > 0) {
      doc.text(`CGST (${invoice.cgstRatePercent ?? 2.5}%)`, 320, y);
      doc.text(formatMoneyPlain(invoice.cgstAmountPaise), right - 10, y, { align: 'right' });
      y += 15;
    }
    if ((invoice.sgstAmountPaise || 0) > 0) {
      doc.text(`SGST (${invoice.sgstRatePercent ?? 2.5}%)`, 320, y);
      doc.text(formatMoneyPlain(invoice.sgstAmountPaise), right - 10, y, { align: 'right' });
      y += 15;
    }
    if ((invoice.igstAmountPaise || 0) > 0) {
      doc.text(`IGST (${invoice.igstRatePercent ?? 5}%)`, 320, y);
      doc.text(formatMoneyPlain(invoice.igstAmountPaise), right - 10, y, { align: 'right' });
      y += 15;
    }
  } else {
    doc.setFontSize(8.5);
    doc.text('GST Payable under Reverse Charge Mechanism (RCM) by Recipient', 320, y, { maxWidth: 225 });
    y += 20;
  }

  doc.line(320, y, right, y);
  y += 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('Total Invoice Amount', 320, y);
  doc.text(formatMoneyPlain(invoice.totalAmountPaise), right - 10, y, { align: 'right' });

  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('Amount Paid', 320, y);
  doc.text(formatMoneyPlain(invoice.amountPaidPaise || 0), right - 10, y, { align: 'right' });

  y += 15;
  doc.setFont('helvetica', 'bold');
  doc.text('Balance Due', 320, y);
  doc.text(formatMoneyPlain(invoice.balanceDuePaise ?? invoice.totalAmountPaise), right - 10, y, { align: 'right' });
  y += 24;

  // Bank Details (from snapshot or active company profile if configured)
  if (branding.hasBankDetails) {
    y = ensurePageSpace(doc, y, 56);
    doc.setDrawColor(226, 232, 240);
    doc.line(left, y, right, y);
    y += 14;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text('Bank Details for Remittance', left, y);
    y += 13;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    const bankLine = [
      branding.bankName ? `Bank: ${branding.bankName}` : '',
      branding.accountNumber ? `A/C: ${branding.accountNumber}` : '',
      branding.ifscCode ? `IFSC: ${branding.ifscCode}` : '',
      branding.branch ? `Branch: ${branding.branch}` : '',
    ]
      .filter(Boolean)
      .join('  |  ');
    y = drawWrappedText(doc, bankLine, left, y, contentWidth, 12);
    y += 8;
  }

  if (invoice.notes) {
    y = ensurePageSpace(doc, y, 36);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    y = drawWrappedText(doc, `Notes: ${invoice.notes}`, left, y, contentWidth, 11.5);
    y += 8;
  }

  // Terms & Conditions / Statutory Disclaimer & Signatory
  y = ensurePageSpace(doc, y, 64);
  doc.setDrawColor(226, 232, 240);
  doc.line(left, y, right, y);
  y += 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  doc.text('Terms & Conditions / Statutory Notice:', left, y);
  y += 11;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  y = drawWrappedText(
    doc,
    invoice.termsAndConditions || GTA_GST_DISCLAIMER,
    left,
    y,
    contentWidth,
    10.5
  );

  y = ensurePageSpace(doc, y + 14, 28);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(branding.legalName, right, y, { align: 'right' });

  doc.save(`${invoice.invoiceNumber || invoice.id}.pdf`);
}

export function downloadSettlementPdf(
  settlement: TripSettlement,
  trip: Trip | undefined,
  company: Company | null
): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const left = 42;
  const right = 553;
  let y = 46;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(15, 23, 42);
  doc.text(company?.name || 'AnchorTransport Logistics', left, y);

  doc.setFontSize(11);
  doc.setTextColor(5, 150, 105);
  doc.text('DRIVER & TRIP SETTLEMENT VOUCHER', right, y, { align: 'right' });

  y += 22;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Settlement #: ${settlement.settlementNumber || settlement.id}`, left, y);
  doc.text(`Date: ${settlement.settledDate}`, right, y, { align: 'right' });

  y += 14;
  doc.text(`Status: ${settlement.status}`, left, y);
  if (settlement.approvedBy) {
    doc.text(`Approved By: ${settlement.approvedBy}`, right, y, { align: 'right' });
  }

  y += 18;
  doc.setDrawColor(226, 232, 240);
  doc.line(left, y, right, y);
  y += 18;

  // Trip & Driver Details
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(`Driver: ${settlement.driverName || '-'}`, left, y);
  doc.text(`Trip #: ${settlement.tripNumber || trip?.tripNumber || '-'}`, 310, y);

  y += 15;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Vehicle: ${settlement.vehicleReg || trip?.vehicleReg || '-'}`, left, y);
  if (trip?.originCity || trip?.destinationCity) {
    doc.text(`Route: ${trip.originCity || '-'} -> ${trip.destinationCity || '-'}`, 310, y);
  }

  y += 24;

  // Financial Summary Table
  const rows: Array<[string, string, boolean?]> = [
    ['Total Trip Revenue', formatMoneyPlain(settlement.totalRevenuePaise ?? trip?.totalRevenuePaise ?? 0), true],
    ['Fuel Expenses', formatMoneyPlain(settlement.fuelExpensesPaise || 0)],
    ['Toll / FASTag Expenses', formatMoneyPlain(settlement.tollExpensesPaise || 0)],
    ['Other Trip Expenses', formatMoneyPlain(settlement.otherExpensesPaise || 0)],
    ['Total Trip Expenses', formatMoneyPlain(settlement.totalExpensesPaise ?? trip?.totalExpensesPaise ?? 0), true],
    [
      'Net Trip Profit / (Loss)',
      formatMoneyPlain(
        settlement.tripProfitLossPaise ??
          ((settlement.totalRevenuePaise ?? trip?.totalRevenuePaise ?? 0) -
            (settlement.totalExpensesPaise ?? trip?.totalExpensesPaise ?? 0))
      ),
      true,
    ],
    ['Total Driver Advances Given', formatMoneyPlain(settlement.totalAdvanceGivenPaise || 0)],
    ['Driver Cash Out-of-Pocket Expenses', formatMoneyPlain(settlement.driverCashExpensesPaise || 0)],
    ['Driver Daily Bata Allowance', formatMoneyPlain(settlement.driverBataAllowancePaise || 0)],
    ['Approved Deductions', formatMoneyPlain(settlement.approvedDeductionsPaise || 0)],
    ['Remaining Driver Advance Balance', formatMoneyPlain(settlement.remainingDriverBalancePaise || 0)],
    [
      settlement.netPayableToDriverPaise >= 0
        ? 'Net Payable To Driver'
        : 'Recoverable From Driver',
      formatMoneyPlain(Math.abs(settlement.netPayableToDriverPaise || 0)),
      true,
    ],
  ];

  doc.setFillColor(248, 250, 252);
  doc.rect(left, y, right - left, 22, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 41, 59);
  doc.text('Settlement Line Item', left + 10, y + 14);
  doc.text('Amount', right - 10, y + 14, { align: 'right' });
  y += 32;

  for (const [label, value, isBold] of rows) {
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(isBold ? 15 : 71, isBold ? 23 : 85, isBold ? 42 : 105);
    doc.text(label, left + 10, y);
    doc.text(value, right - 10, y, { align: 'right' });
    y += 18;
    if (isBold) {
      doc.setDrawColor(241, 245, 249);
      doc.line(left, y - 10, right, y - 10);
    }
  }

  if (settlement.settlementNotes) {
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`Notes: ${settlement.settlementNotes}`, left, y, { maxWidth: right - left });
  }

  doc.save(`${settlement.settlementNumber || settlement.id}.pdf`);
}
