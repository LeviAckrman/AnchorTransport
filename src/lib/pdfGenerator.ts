/**
 * AnchorTransport TMS - Client PDF Generation Utility (jsPDF)
 * Generates downloadable GST Tax Invoices and Trip Settlement reports
 */

import { jsPDF } from 'jspdf';
import type { Company, Customer, Invoice, Trip, TripSettlement } from '../types/tms';

function formatMoneyPlain(paise: number | undefined): string {
  const val = (paise || 0) / 100;
  return `INR ${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function downloadInvoicePdf(
  invoice: Invoice,
  company: Company | null,
  customer?: Customer
): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const left = 42;
  const right = 553;
  let y = 46;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  doc.text(company?.name || 'AnchorTransport Logistics', left, y);

  doc.setFontSize(11);
  doc.setTextColor(79, 70, 229);
  doc.text(invoice.isRcmApplicable ? 'GTA TAX INVOICE (RCM)' : 'TAX INVOICE', right, y, { align: 'right' });

  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  if (company?.gstin) {
    doc.text(`GSTIN: ${company.gstin}`, left, y);
    y += 12;
  }
  const companyAddr = [company?.address, company?.city, company?.state, company?.pincode]
    .filter(Boolean)
    .join(', ');
  if (companyAddr) {
    doc.text(companyAddr, left, y, { maxWidth: 320 });
    y += 14;
  }

  // Invoice Meta Box
  let metaY = 66;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(`Invoice #: ${invoice.invoiceNumber}`, right, metaY, { align: 'right' });
  metaY += 13;
  doc.setFont('helvetica', 'normal');
  doc.text(`Issue Date: ${invoice.issueDate}`, right, metaY, { align: 'right' });
  if (invoice.dueDate) {
    metaY += 13;
    doc.text(`Due Date: ${invoice.dueDate}`, right, metaY, { align: 'right' });
  }
  metaY += 13;
  doc.text(`Status: ${invoice.status}`, right, metaY, { align: 'right' });

  y = Math.max(y + 16, metaY + 18);
  doc.setDrawColor(226, 232, 240);
  doc.line(left, y, right, y);
  y += 18;

  // Bill To & Trip Summary
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text('BILL TO', left, y);
  doc.text('CONSIGNMENT DETAILS', 310, y);

  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(invoice.customerName || customer?.name || 'Customer', left, y);
  doc.text(`Trip #: ${invoice.tripNumber || 'Standalone Bill'}`, 310, y);

  y += 13;
  doc.setTextColor(71, 85, 105);
  doc.text(`GSTIN: ${invoice.customerGstin || customer?.gstin || 'Unregistered / N/A'}`, left, y);
  doc.text(`LR / Bilty #: ${invoice.lrNumber || '-'}`, 310, y);

  y += 13;
  const billAddr = invoice.billingAddress || customer?.billingAddress || '';
  if (billAddr) {
    doc.text(billAddr, left, y, { maxWidth: 240 });
  }
  const routeText =
    invoice.originCity || invoice.destinationCity
      ? `${invoice.originCity || '-'} -> ${invoice.destinationCity || '-'}`
      : 'Route: Standard Freight';
  doc.text(routeText, 310, y);

  y += 13;
  if (invoice.vehicleReg) {
    doc.text(`Vehicle: ${invoice.vehicleReg} | HSN/SAC: ${invoice.hsnSacCode || '996511'}`, 310, y);
  }

  y += 28;

  // Charges Table Header
  doc.setFillColor(248, 250, 252);
  doc.rect(left, y, right - left, 22, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 41, 59);
  doc.text('Description', left + 10, y + 14);
  doc.text('Amount', right - 10, y + 14, { align: 'right' });
  y += 34;

  const lineItems: Array<[string, number]> = [
    ['Freight Charges', invoice.freightAmountPaise || 0],
    ['Loading Charges', invoice.loadingChargesPaise || 0],
    ['Unloading Charges', invoice.unloadingChargesPaise || 0],
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
    doc.text(label, left + 10, y);
    doc.text(formatMoneyPlain(amt), right - 10, y, { align: 'right' });
    y += 18;
  }

  if ((invoice.discountPaise || 0) > 0) {
    doc.setTextColor(180, 83, 9);
    doc.text('Less: Discount', left + 10, y);
    doc.text(`- ${formatMoneyPlain(invoice.discountPaise)}`, right - 10, y, { align: 'right' });
    y += 18;
  }

  doc.setDrawColor(226, 232, 240);
  doc.line(left, y, right, y);
  y += 16;

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
    doc.text('GST Payable under Reverse Charge Mechanism (RCM) by Recipient', 320, y);
    y += 15;
  }

  doc.line(320, y, right, y);
  y += 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('Grand Total', 320, y);
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

  // Bank Details & Footer
  if (company?.bankName || company?.accountNumber) {
    y += 32;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Bank Details for Payment', left, y);
    y += 13;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(
      `Bank: ${company.bankName || '-'} | A/C: ${company.accountNumber || '-'} | IFSC: ${company.ifscCode || '-'}`,
      left,
      y
    );
  }

  if (invoice.notes) {
    y += 22;
    doc.setFontSize(8.5);
    doc.text(`Notes: ${invoice.notes}`, left, y, { maxWidth: right - left });
  }

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
