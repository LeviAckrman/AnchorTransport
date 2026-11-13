/**
 * AnchorTransport TMS - Customer Invoicing & Receivables API Routes (Phase 8)
 * 
 * Implements:
 * 1. Invoice Generation from trips with unique sequential numbering (e.g. INV/25-26/0001)
 * 2. Strict Duplicate Invoicing Prevention (One active invoice per trip)
 * 3. Decimal-Safe Tax Calculations (GTA RCM 5% vs Forward Charge CGST/SGST/IGST under SAC 996511)
 * 4. Derived Invoice Statuses: DRAFT, ISSUED, PARTIALLY_PAID, PAID, OVERDUE, CANCELLED
 * 5. Payment Recording with Duplicate Submission Prevention & Overpayment Guards
 * 6. Customer Receivables & Aging Reports (0-30, 31-60, 61-90, 90+ days)
 * 7. Multi-Tenant Company Isolation across all endpoints
 * 8. Statutory Disclaimer highlighting operational TMS scope vs full GST ERP filing
 */

import { Router, Response } from 'express';
import { AuthenticatedRequest, requireAuth } from '../auth';
import { serverFleetStore } from '../store';
import { serverCompanies } from './auth.routes';
import {
  Invoice,
  Payment,
  InvoiceStatus,
  Trip,
  Customer,
} from '../../types/tms';
import { calculateGstInvoice } from '../../lib/financialEngine';

export const invoicesRouter = Router();

/**
 * Standard disclaimer note for operational GTA freight invoices
 */
export const GTA_GST_DISCLAIMER =
  'Operational TMS Invoice for Goods Transport Agency (GTA) freight services under SAC 996511. ' +
  'This document records operational freight billing. It does not replace an automated GSTR-1/GSTR-3B statutory filing platform. ' +
  'Consult your Chartered Accountant for e-Invoice IRN/QR code compliance under GST Rule 48(4) where turnover thresholds apply.';

/**
 * Generates sequential unique invoice number for a company context (e.g. INV/25-26/0001)
 */
export function generateInvoiceNumber(companyId: string): string {
  const currentYear = new Date().getFullYear();
  const nextYearShort = (currentYear + 1).toString().slice(-2);
  const currentYearShort = currentYear.toString().slice(-2);
  const defaultPrefix = `INV/${currentYearShort}-${nextYearShort}/`;

  const existingInvoices = serverFleetStore.invoices.filter((i) => i.companyId === companyId);
  const numbers = existingInvoices
    .map((i) => i.invoiceNumber || '')
    .filter((num) => num.includes('/'))
    .map((num) => {
      const parts = num.split('/');
      const last = parseInt(parts[parts.length - 1], 10);
      return isNaN(last) ? 0 : last;
    });

  const maxNum = numbers.length > 0 ? Math.max(...numbers) : 0;
  const nextNum = (maxNum + 1).toString().padStart(4, '0');
  return `${defaultPrefix}${nextNum}`;
}

/**
 * Derives accurate invoice status based on payment state and due date
 * (Overdue status is dynamically computed from due date & outstanding balance rather than manual mistake)
 */
export function deriveInvoiceStatus(invoice: Invoice, referenceDate: Date = new Date()): InvoiceStatus {
  if (invoice.status === 'CANCELLED') {
    return 'CANCELLED';
  }

  if (invoice.status === 'DRAFT') {
    return 'DRAFT';
  }

  // If balance is 0 or less, invoice is fully paid
  if (invoice.balanceDuePaise <= 0 || invoice.amountPaidPaise >= invoice.totalAmountPaise) {
    return 'PAID';
  }

  const todayStr = referenceDate.toISOString().split('T')[0];
  const isPastDue = invoice.dueDate && invoice.dueDate < todayStr;

  if (invoice.amountPaidPaise > 0) {
    return isPastDue ? 'OVERDUE' : 'PARTIALLY_PAID';
  }

  // 0 paid
  if (isPastDue) {
    return 'OVERDUE';
  }

  return 'ISSUED';
}

/**
 * Recomputes and updates customer current outstanding balance based on active invoices
 */
export function syncCustomerOutstanding(customerId: string, companyId: string): void {
  const customer = serverFleetStore.customers.find((c) => c.id === customerId && c.companyId === companyId);
  if (!customer) return;

  const activeInvoices = serverFleetStore.invoices.filter(
    (i) => i.customerId === customerId && i.companyId === companyId && i.status !== 'CANCELLED'
  );

  customer.currentOutstandingPaise = activeInvoices.reduce((sum, inv) => sum + Math.max(0, inv.balanceDuePaise), 0);
  customer.updatedAt = new Date().toISOString();
  serverFleetStore.persistToFirestore(companyId, 'customers', customer.id, customer).catch(() => {});
}

// =========================================================================
// 1. INVOICE LISTING & DETAILS
// =========================================================================

/**
 * GET /api/invoices
 * Lists company invoices with pagination, status filters, search, and summary stats
 */
invoicesRouter.get('/invoices', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 15;
    const status = req.query.status as string;
    const customerId = req.query.customerId as string;
    const tripId = req.query.tripId as string;
    const search = ((req.query.search as string) || '').trim().toLowerCase();
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    let list = serverFleetStore.invoices.filter((i) => i.companyId === companyId);

    // Apply derived dynamic status
    list.forEach((inv) => {
      inv.status = deriveInvoiceStatus(inv);
    });

    if (status) {
      list = list.filter((i) => i.status === status);
    }

    if (customerId) {
      list = list.filter((i) => i.customerId === customerId);
    }

    if (tripId) {
      list = list.filter((i) => i.tripId === tripId);
    }

    if (startDate) {
      list = list.filter((i) => i.issueDate >= startDate);
    }

    if (endDate) {
      list = list.filter((i) => i.issueDate <= endDate);
    }

    if (search) {
      list = list.filter(
        (i) =>
          i.invoiceNumber.toLowerCase().includes(search) ||
          i.customerName.toLowerCase().includes(search) ||
          i.tripNumber.toLowerCase().includes(search) ||
          i.lrNumber.toLowerCase().includes(search) ||
          (i.customerGstin && i.customerGstin.toLowerCase().includes(search))
      );
    }

    // Sort newest issue date first
    list.sort((a, b) => new Date(b.issueDate || b.createdAt).getTime() - new Date(a.issueDate || a.createdAt).getTime());

    const total = list.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginated = list.slice(startIndex, startIndex + limit);

    // Calculate aggregated metrics
    const nonCancelled = serverFleetStore.invoices.filter(
      (i) => i.companyId === companyId && i.status !== 'CANCELLED'
    );
    const totalBilledPaise = nonCancelled.reduce((sum, i) => sum + i.totalAmountPaise, 0);
    const totalCollectedPaise = nonCancelled.reduce((sum, i) => sum + i.amountPaidPaise, 0);
    const totalOutstandingPaise = nonCancelled.reduce((sum, i) => sum + i.balanceDuePaise, 0);

    const overdueInvoices = nonCancelled.filter((i) => deriveInvoiceStatus(i) === 'OVERDUE');
    const totalOverduePaise = overdueInvoices.reduce((sum, i) => sum + i.balanceDuePaise, 0);

    res.json({
      success: true,
      data: paginated,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      summary: {
        totalBilledPaise,
        totalCollectedPaise,
        totalOutstandingPaise,
        totalOverduePaise,
        overdueCount: overdueInvoices.length,
        totalCount: total,
      },
      disclaimer: GTA_GST_DISCLAIMER,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to list invoices' });
  }
});

/**
 * GET /api/invoices/:id
 * Retrieves full invoice details with payments history and attached trip
 */
invoicesRouter.get('/invoices/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);
    const invoice = serverFleetStore.invoices.find((i) => i.id === req.params.id && i.companyId === companyId);

    if (!invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found in your company records.' });
      return;
    }

    // Refresh derived status
    invoice.status = deriveInvoiceStatus(invoice);

    const trip = serverFleetStore.trips.find((t) => t.id === invoice.tripId && t.companyId === companyId);
    const customer = serverFleetStore.customers.find((c) => c.id === invoice.customerId && c.companyId === companyId);
    const payments = serverFleetStore.payments.filter((p) => p.invoiceId === invoice.id && p.companyId === companyId);

    res.json({
      success: true,
      invoice,
      trip: trip || null,
      customer: customer || null,
      payments,
      disclaimer: GTA_GST_DISCLAIMER,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch invoice details' });
  }
});

// =========================================================================
// 2. INVOICE CREATION & DUPLICATE PREVENTION
// =========================================================================

/**
 * POST /api/invoices
 * Creates an invoice from a completed/delivered trip.
 * 
 * ENFORCES:
 * 1. Do not automatically create an invoice when a trip is delivered (manual authorized intent).
 * 2. Prevent duplicate invoicing of the same trip unless an explicit billing workflow allows it.
 * 3. Decimal-safe GTA GST calculations (RCM 5% vs Forward Charge 5%/12%).
 */
invoicesRouter.post('/invoices', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const {
      tripId,
      customerId,
      issueDate = new Date().toISOString().split('T')[0],
      dueDate,
      freightAmountPaise,
      loadingChargesPaise = 0,
      unloadingChargesPaise = 0,
      detentionChargesPaise = 0,
      otherChargesPaise,
      isRcmApplicable = true, // GTA standard RCM
      gstRatePercent = 5,
      notes,
      status = 'ISSUED', // 'DRAFT' | 'ISSUED'
    } = req.body;

    if (!tripId) {
      res.status(400).json({ success: false, error: 'A completed commercial trip must be selected to generate an invoice.' });
      return;
    }

    const trip = serverFleetStore.trips.find((t) => t.id === tripId && t.companyId === companyId);
    if (!trip) {
      res.status(404).json({ success: false, error: 'Trip not found or does not belong to your company fleet.' });
      return;
    }

    // 1. PREVENT DUPLICATE INVOICING OF THE SAME TRIP
    const existingActiveInvoice = serverFleetStore.invoices.find(
      (i) => i.tripId === trip.id && i.companyId === companyId && i.status !== 'CANCELLED'
    );
    if (existingActiveInvoice) {
      res.status(409).json({
        success: false,
        error: `Trip ${trip.tripNumber} already has an active invoice (${existingActiveInvoice.invoiceNumber}). Duplicate invoicing for the same trip is strictly prohibited.`,
        existingInvoiceId: existingActiveInvoice.id,
        existingInvoiceNumber: existingActiveInvoice.invoiceNumber,
      });
      return;
    }

    const effectiveCustomerId = customerId || trip.customerId;
    const customer = serverFleetStore.customers.find((c) => c.id === effectiveCustomerId && c.companyId === companyId);
    if (!customer) {
      res.status(404).json({ success: false, error: 'Customer party not found in company records.' });
      return;
    }

    // Financial charge breakdown in integer paise
    const hasExplicitCharges = freightAmountPaise !== undefined || 
      Number(loadingChargesPaise) > 0 || 
      Number(unloadingChargesPaise) > 0 || 
      Number(detentionChargesPaise) > 0 || 
      otherChargesPaise !== undefined;

    let baseFreight = 0;
    let other = 0;

    if (hasExplicitCharges) {
      baseFreight = freightAmountPaise !== undefined ? (parseInt(freightAmountPaise, 10) || 0) : (trip.freightAmountPaise || 0);
      other = otherChargesPaise !== undefined ? (parseInt(otherChargesPaise, 10) || 0) : 0;
    } else {
      // 1-click billing: default to trip total revenue
      baseFreight = trip.freightAmountPaise || 0;
      other = trip.otherChargesPaise || 0;
    }

    const loading = parseInt(loadingChargesPaise, 10) || 0;
    const unloading = parseInt(unloadingChargesPaise, 10) || 0;
    const detention = parseInt(detentionChargesPaise, 10) || 0;

    const taxableAmountPaise = baseFreight + loading + unloading + detention + other;
    if (taxableAmountPaise <= 0) {
      res.status(400).json({ success: false, error: 'Invoice taxable freight amount must be greater than zero.' });
      return;
    }

    // Calculate GTA GST based on consignor state vs customer state
    const activeCompany = serverCompanies.find((c) => c.id === companyId);
    const companyStateCode = activeCompany?.stateCode || '19';
    const customerStateCode = customer.stateCode || (customer.gstin ? customer.gstin.substring(0, 2) : '19');

    const taxCalc = calculateGstInvoice(
      taxableAmountPaise,
      companyStateCode,
      customerStateCode,
      Boolean(isRcmApplicable),
      parseFloat(gstRatePercent) || 5
    );

    // Calculate due date based on customer credit terms if not manually specified
    let finalDueDate = dueDate;
    if (!finalDueDate) {
      const termsDays = customer.paymentTermsDays || 30;
      const d = new Date(issueDate);
      d.setDate(d.getDate() + termsDays);
      finalDueDate = d.toISOString().split('T')[0];
    }

    const invoiceNumber = generateInvoiceNumber(companyId);
    const isDraft = status === 'DRAFT';

    const newInvoice: Invoice = {
      id: `inv_${companyId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      companyId,
      invoiceNumber,
      tripId: trip.id,
      tripNumber: trip.tripNumber,
      lrNumber: trip.lrNumber || `LR-${trip.tripNumber}`,
      customerId: customer.id,
      customerName: customer.name,
      customerGstin: customer.gstin,
      billingAddress: customer.billingAddress,
      originCity: trip.originCity,
      destinationCity: trip.destinationCity,
      vehicleReg: trip.vehicleReg,
      goodsType: trip.goodsType,
      weightTonnes: trip.weightTonnes,
      ratePerTonnePaise: trip.ratePerTonnePaise,
      hsnSacCode: '996511', // SAC 996511: Goods transport services by road
      issueDate,
      dueDate: finalDueDate,
      freightAmountPaise: baseFreight,
      loadingChargesPaise: loading,
      unloadingChargesPaise: unloading,
      detentionChargesPaise: detention,
      otherChargesPaise: other,
      taxableAmountPaise,
      isRcmApplicable: Boolean(isRcmApplicable),
      gstRatePercent: taxCalc.isRcm ? 0 : (parseFloat(gstRatePercent) || 5),
      cgstRatePercent: taxCalc.cgstAmountPaise > 0 ? (parseFloat(gstRatePercent) / 2) : 0,
      sgstRatePercent: taxCalc.sgstAmountPaise > 0 ? (parseFloat(gstRatePercent) / 2) : 0,
      igstRatePercent: taxCalc.igstAmountPaise > 0 ? parseFloat(gstRatePercent) : 0,
      cgstAmountPaise: taxCalc.cgstAmountPaise,
      sgstAmountPaise: taxCalc.sgstAmountPaise,
      igstAmountPaise: taxCalc.igstAmountPaise,
      totalTaxPaise: taxCalc.totalTaxPaise,
      totalAmountPaise: taxCalc.totalInvoiceAmountPaise,
      amountPaidPaise: 0,
      balanceDuePaise: taxCalc.totalInvoiceAmountPaise,
      status: isDraft ? 'DRAFT' : 'ISSUED',
      paymentStatus: 'UNPAID',
      notes: notes?.trim() || `Freight invoice for ${trip.goodsType} from ${trip.originCity} to ${trip.destinationCity}.`,
      createdBy: req.user?.name || 'Accounts Dept',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    serverFleetStore.invoices.push(newInvoice);
    await serverFleetStore.persistToFirestore(companyId, 'invoices', newInvoice.id, newInvoice);

    // Link invoice to trip
    if (!isDraft) {
      trip.isInvoiced = true;
      trip.invoiceId = newInvoice.id;
      trip.invoiceNumber = newInvoice.invoiceNumber;
      trip.updatedAt = new Date().toISOString();
      await serverFleetStore.persistToFirestore(companyId, 'trips', trip.id, trip);

      // Update customer outstanding ledger
      syncCustomerOutstanding(customer.id, companyId);
      await serverFleetStore.persistToFirestore(companyId, 'customers', customer.id, customer);
    }

    res.status(201).json({
      success: true,
      message: isDraft 
        ? `Draft invoice ${invoiceNumber} created.`
        : `Invoice ${invoiceNumber} issued for ₹${(newInvoice.totalAmountPaise / 100).toLocaleString('en-IN')}.`,
      invoice: newInvoice,
      trip,
      customer: customer || null,
      taxCalculation: taxCalc,
      disclaimer: GTA_GST_DISCLAIMER,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to generate invoice' });
  }
});

/**
 * PUT /api/invoices/:id
 * Updates an invoice (allowed if not fully PAID or CANCELLED)
 */
invoicesRouter.put('/invoices/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const invoice = serverFleetStore.invoices.find((i) => i.id === req.params.id && i.companyId === companyId);

    if (!invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found in your company records.' });
      return;
    }

    if (invoice.status === 'CANCELLED') {
      res.status(403).json({ success: false, error: 'Cancelled invoices are immutable and cannot be updated.' });
      return;
    }

    const {
      dueDate,
      notes,
      loadingChargesPaise,
      unloadingChargesPaise,
      detentionChargesPaise,
      otherChargesPaise,
      status,
    } = req.body;

    if (dueDate) invoice.dueDate = dueDate;
    if (notes !== undefined) invoice.notes = notes.trim();

    // If still a DRAFT being finalized to ISSUED
    let updatedTrip: any = null;
    if (invoice.status === 'DRAFT' && status === 'ISSUED') {
      invoice.status = 'ISSUED';
      const trip = serverFleetStore.trips.find((t) => t.id === invoice.tripId && t.companyId === companyId);
      if (trip) {
        trip.isInvoiced = true;
        trip.invoiceId = invoice.id;
        trip.invoiceNumber = invoice.invoiceNumber;
        updatedTrip = trip;
        await serverFleetStore.persistToFirestore(companyId, 'trips', trip.id, trip);
      }
      syncCustomerOutstanding(invoice.customerId, companyId);
    }

    // Recalculate other charges if provided and not yet partially paid
    if (invoice.amountPaidPaise === 0) {
      if (loadingChargesPaise !== undefined) invoice.loadingChargesPaise = parseInt(loadingChargesPaise, 10) || 0;
      if (unloadingChargesPaise !== undefined) invoice.unloadingChargesPaise = parseInt(unloadingChargesPaise, 10) || 0;
      if (detentionChargesPaise !== undefined) invoice.detentionChargesPaise = parseInt(detentionChargesPaise, 10) || 0;
      if (otherChargesPaise !== undefined) invoice.otherChargesPaise = parseInt(otherChargesPaise, 10) || 0;

      const baseFreight = invoice.freightAmountPaise || 0;
      invoice.taxableAmountPaise =
        baseFreight +
        (invoice.loadingChargesPaise || 0) +
        (invoice.unloadingChargesPaise || 0) +
        (invoice.detentionChargesPaise || 0) +
        (invoice.otherChargesPaise || 0);

      const customer = serverFleetStore.customers.find((c) => c.id === invoice.customerId && c.companyId === companyId);
      const activeCompany = serverCompanies.find((c) => c.id === companyId);
      const companyState = activeCompany?.stateCode || '19';
      const customerState = customer?.stateCode || (customer?.gstin ? customer.gstin.substring(0, 2) : '19');
      const taxCalc = calculateGstInvoice(
        invoice.taxableAmountPaise,
        companyState,
        customerState,
        invoice.isRcmApplicable,
        invoice.gstRatePercent || 5
      );

      invoice.cgstAmountPaise = taxCalc.cgstAmountPaise;
      invoice.sgstAmountPaise = taxCalc.sgstAmountPaise;
      invoice.igstAmountPaise = taxCalc.igstAmountPaise;
      invoice.totalTaxPaise = taxCalc.totalTaxPaise;
      invoice.totalAmountPaise = taxCalc.totalInvoiceAmountPaise;
      invoice.balanceDuePaise = taxCalc.totalInvoiceAmountPaise;
    }

    invoice.status = deriveInvoiceStatus(invoice);
    invoice.updatedAt = new Date().toISOString();

    syncCustomerOutstanding(invoice.customerId, companyId);
    const updatedCustomer = serverFleetStore.customers.find((c) => c.id === invoice.customerId && c.companyId === companyId) || null;
    await serverFleetStore.persistToFirestore(companyId, 'invoices', invoice.id, invoice);
    if (updatedCustomer) {
      await serverFleetStore.persistToFirestore(companyId, 'customers', updatedCustomer.id, updatedCustomer);
    }

    res.json({
      success: true,
      message: `Invoice ${invoice.invoiceNumber} updated successfully.`,
      invoice,
      trip: updatedTrip,
      customer: updatedCustomer,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to update invoice' });
  }
});

/**
 * POST /api/invoices/:id/cancel
 * Cancels an invoice.
 * Reverses customer outstanding balance and unlocks the trip for billing re-attempt.
 */
invoicesRouter.post('/invoices/:id/cancel', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const invoice = serverFleetStore.invoices.find((i) => i.id === req.params.id && i.companyId === companyId);

    if (!invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found in your company records.' });
      return;
    }

    if (invoice.status === 'CANCELLED') {
      res.status(400).json({ success: false, error: 'Invoice is already cancelled.' });
      return;
    }

    // Cannot cancel invoice with active customer payments without refunding
    if (invoice.amountPaidPaise > 0) {
      res.status(400).json({
        success: false,
        error: `Cannot cancel invoice ${invoice.invoiceNumber}: It has recorded payments of ₹${(invoice.amountPaidPaise / 100).toLocaleString('en-IN')}. Reverse or reallocate the payments first.`,
      });
      return;
    }

    const { cancellationReason } = req.body;
    if (!cancellationReason || !cancellationReason.trim()) {
      res.status(400).json({ success: false, error: 'A valid cancellation reason is required to cancel an issued invoice.' });
      return;
    }

    invoice.status = 'CANCELLED';
    invoice.cancelledAt = new Date().toISOString();
    invoice.cancellationReason = cancellationReason.trim();
    invoice.updatedAt = new Date().toISOString();

    // Unlock trip so it can be re-billed if needed
    const trip = serverFleetStore.trips.find((t) => t.id === invoice.tripId && t.companyId === companyId);
    if (trip) {
      trip.isInvoiced = false;
      trip.invoiceId = undefined;
      trip.invoiceNumber = undefined;
      trip.updatedAt = new Date().toISOString();
      await serverFleetStore.persistToFirestore(companyId, 'trips', trip.id, trip);
    }

    // Sync customer outstanding
    syncCustomerOutstanding(invoice.customerId, companyId);
    const updatedCustomer = serverFleetStore.customers.find((c) => c.id === invoice.customerId && c.companyId === companyId) || null;
    await serverFleetStore.persistToFirestore(companyId, 'invoices', invoice.id, invoice);
    if (updatedCustomer) {
      await serverFleetStore.persistToFirestore(companyId, 'customers', updatedCustomer.id, updatedCustomer);
    }

    res.json({
      success: true,
      message: `Invoice ${invoice.invoiceNumber} has been cancelled. Trip ${invoice.tripNumber} is liberated for re-billing.`,
      invoice,
      trip: trip || null,
      customer: updatedCustomer,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to cancel invoice' });
  }
});

// =========================================================================
// 3. CUSTOMER PAYMENTS RECORDING & RECONCILIATION
// =========================================================================

/**
 * GET /api/payments
 * Lists recorded payments with invoice, customer, and date filters
 */
invoicesRouter.get('/payments', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);
    const invoiceId = req.query.invoiceId as string;
    const customerId = req.query.customerId as string;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 15;

    let list = serverFleetStore.payments.filter((p) => p.companyId === companyId);

    if (invoiceId) {
      list = list.filter((p) => p.invoiceId === invoiceId);
    }

    if (customerId) {
      list = list.filter((p) => p.customerId === customerId);
    }

    list.sort((a, b) => new Date(b.paymentDate || b.createdAt || 0).getTime() - new Date(a.paymentDate || a.createdAt || 0).getTime());

    const total = list.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginated = list.slice(startIndex, startIndex + limit);

    const totalCollectedPaise = list.reduce((sum, p) => sum + p.amountPaise, 0);

    res.json({
      success: true,
      data: paginated,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      summary: {
        totalCollectedPaise,
        totalCount: total,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to list payments' });
  }
});

/**
 * POST /api/payments
 * Records a customer payment against an invoice.
 * 
 * STRICT INVARIANTS:
 * 1. Calculate outstanding balance: Invoice total minus recorded payments.
 * 2. Do not allow payments to exceed outstanding balance.
 * 3. Prevent duplicate payment submissions (unique reference number per invoice).
 * 4. Atomic balance updating and status derivation.
 */
invoicesRouter.post('/invoices/:id/payments', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  await handlePaymentRecording(req, res);
});

invoicesRouter.post('/payments', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  await handlePaymentRecording(req, res);
});

async function handlePaymentRecording(req: AuthenticatedRequest, res: Response) {
  try {
    const companyId = req.companyId!;
    const invoiceId = req.params.id || req.body.invoiceId;
    const {
      amountPaise,
      paymentDate = new Date().toISOString().split('T')[0],
      referenceNumber,
      tdsDeductedPaise = 0,
      bankAccount,
      notes,
    } = req.body;
    const paymentMode = req.body.paymentMode || req.body.paymentMethod || 'NEFT_RTGS';

    if (!invoiceId) {
      res.status(400).json({ success: false, error: 'Invoice reference is mandatory to record a payment.' });
      return;
    }

    const invoice = serverFleetStore.invoices.find((i) => i.id === invoiceId && i.companyId === companyId);
    if (!invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found in your company ledger.' });
      return;
    }

    if (invoice.status === 'CANCELLED') {
      res.status(400).json({ success: false, error: 'Cannot record payments against a cancelled invoice.' });
      return;
    }

    const amount = parseInt(amountPaise, 10);
    if (isNaN(amount) || amount <= 0) {
      res.status(400).json({ success: false, error: 'Payment amount must be a positive integer in paise.' });
      return;
    }

    if (!referenceNumber || !referenceNumber.trim()) {
      res.status(400).json({ success: false, error: 'Bank UTR, Cheque number, or transaction reference is required.' });
      return;
    }

    const cleanRef = referenceNumber.trim();

    // 1. PREVENT DUPLICATE PAYMENT SUBMISSIONS
    const duplicatePayment = serverFleetStore.payments.find(
      (p) =>
        p.companyId === companyId &&
        p.invoiceId === invoice.id &&
        p.referenceNumber.toLowerCase() === cleanRef.toLowerCase()
    );
    if (duplicatePayment) {
      res.status(409).json({
        success: false,
        error: `A payment with reference "${cleanRef}" has already been processed for Invoice ${invoice.invoiceNumber}. Duplicate payment submissions are strictly prevented.`,
        existingPaymentId: duplicatePayment.id,
      });
      return;
    }

    // 2. CHECK OUTSTANDING BALANCE: PAYMENTS MUST NOT EXCEED BALANCE
    // Outstanding balance = Invoice total minus recorded payments
    const existingPayments = serverFleetStore.payments.filter(
      (p) => p.invoiceId === invoice.id && p.companyId === companyId
    );
    const totalRecordedPayments = existingPayments.reduce((sum, p) => sum + p.amountPaise, 0);
    const currentOutstandingPaise = Math.max(0, invoice.totalAmountPaise - totalRecordedPayments);

    if (amount > currentOutstandingPaise) {
      res.status(400).json({
        success: false,
        error: `Payment amount ₹${(amount / 100).toLocaleString('en-IN')} exceeds current outstanding balance (exceeds outstanding balance) of ₹${(currentOutstandingPaise / 100).toLocaleString('en-IN')} for Invoice ${invoice.invoiceNumber}. Overpayments are blocked without an advance credit agreement.`,
        currentOutstandingPaise,
      });
      return;
    }

    const newPayment: Payment = {
      id: `pay_${companyId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      companyId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      amountPaise: amount,
      paymentDate,
      paymentMode,
      referenceNumber: cleanRef,
      tdsDeductedPaise: parseInt(tdsDeductedPaise, 10) || 0,
      bankAccount: bankAccount?.trim(),
      recordedBy: req.user?.name || 'Accounts Officer',
      notes: notes?.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    serverFleetStore.payments.push(newPayment);

    // Update invoice totals and status atomically
    const newTotalPaid = totalRecordedPayments + amount;
    invoice.amountPaidPaise = newTotalPaid;
    invoice.balanceDuePaise = Math.max(0, invoice.totalAmountPaise - newTotalPaid);
    invoice.status = deriveInvoiceStatus(invoice);
    invoice.paymentStatus = invoice.balanceDuePaise === 0 ? 'PAID' : 'PARTIALLY_PAID';
    invoice.updatedAt = new Date().toISOString();

    // Sync customer outstanding
    syncCustomerOutstanding(invoice.customerId, companyId);
    const updatedCustomer = serverFleetStore.customers.find((c) => c.id === invoice.customerId && c.companyId === companyId) || null;
    await serverFleetStore.persistToFirestore(companyId, 'payments', newPayment.id, newPayment);
    await serverFleetStore.persistToFirestore(companyId, 'invoices', invoice.id, invoice);
    if (updatedCustomer) {
      await serverFleetStore.persistToFirestore(companyId, 'customers', updatedCustomer.id, updatedCustomer);
    }

    res.status(201).json({
      success: true,
      message: `Recorded payment of ₹${(amount / 100).toLocaleString('en-IN')} for Invoice ${invoice.invoiceNumber}. Balance remaining: ₹${(invoice.balanceDuePaise / 100).toLocaleString('en-IN')}.`,
      payment: newPayment,
      invoice,
      customer: updatedCustomer,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to record payment' });
  }
}

// =========================================================================
// 4. CUSTOMER REPORTS & RECEIVABLES SUMMARY
// =========================================================================

/**
 * GET /api/reports/receivables
 * Generates receivables breakdown and aging report by customer
 */
invoicesRouter.get('/reports/receivables', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);
    const customers = serverFleetStore.customers.filter((c) => c.companyId === companyId);
    const invoices = serverFleetStore.invoices.filter((i) => i.companyId === companyId && i.status !== 'CANCELLED');
    const payments = serverFleetStore.payments.filter((p) => p.companyId === companyId);

    const today = new Date();

    const customerReports = customers.map((customer) => {
      const custInvoices = invoices.filter((i) => i.customerId === customer.id);
      const custPayments = payments.filter((p) => p.customerId === customer.id);

      const totalBilledPaise = custInvoices.reduce((sum, i) => sum + i.totalAmountPaise, 0);
      const totalPaidPaise = custInvoices.reduce((sum, i) => sum + i.amountPaidPaise, 0);
      const outstandingPaise = custInvoices.reduce((sum, i) => sum + i.balanceDuePaise, 0);

      // Aging breakdown
      let bucket0to30Paise = 0;
      let bucket31to60Paise = 0;
      let bucket61to90Paise = 0;
      let bucket90PlusPaise = 0;
      let overduePaise = 0;
      let overdueCount = 0;

      custInvoices.forEach((inv) => {
        if (inv.balanceDuePaise <= 0) return;

        const due = new Date(inv.dueDate);
        const diffDays = Math.floor((today.getTime() - due.getTime()) / (1000 * 3600 * 24));

        if (diffDays > 0) {
          overduePaise += inv.balanceDuePaise;
          overdueCount++;
        }

        if (diffDays <= 30) {
          bucket0to30Paise += inv.balanceDuePaise;
        } else if (diffDays <= 60) {
          bucket31to60Paise += inv.balanceDuePaise;
        } else if (diffDays <= 90) {
          bucket61to90Paise += inv.balanceDuePaise;
        } else {
          bucket90PlusPaise += inv.balanceDuePaise;
        }
      });

      return {
        customerId: customer.id,
        customerName: customer.name,
        gstin: customer.gstin,
        phone: customer.phone,
        paymentTermsDays: customer.paymentTermsDays || 30,
        creditLimitPaise: customer.creditLimitPaise || 0,
        totalInvoicesCount: custInvoices.length,
        totalBilledPaise,
        totalPaidPaise,
        outstandingPaise,
        overduePaise,
        overdueCount,
        aging: {
          bucket0to30Paise,
          bucket31to60Paise,
          bucket61to90Paise,
          bucket90PlusPaise,
        },
        recentInvoices: custInvoices.slice(0, 5),
        recentPayments: custPayments.slice(0, 5),
      };
    });

    // Company wide summary
    const totalReceivablesPaise = invoices.reduce((sum, i) => sum + i.balanceDuePaise, 0);
    const overdueInvoices = invoices.filter((i) => deriveInvoiceStatus(i) === 'OVERDUE');
    const totalOverduePaise = overdueInvoices.reduce((sum, i) => sum + i.balanceDuePaise, 0);
    const totalBilledPaise = invoices.reduce((sum, i) => sum + i.totalAmountPaise, 0);
    const totalCollectedPaise = invoices.reduce((sum, i) => sum + i.amountPaidPaise, 0);

    res.json({
      success: true,
      summary: {
        totalReceivablesPaise,
        totalOverduePaise,
        overdueInvoicesCount: overdueInvoices.length,
        totalBilledPaise,
        totalCollectedPaise,
        totalCustomersWithDues: customerReports.filter((c) => c.outstandingPaise > 0).length,
      },
      customers: customerReports,
      disclaimer: GTA_GST_DISCLAIMER,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to generate receivables report' });
  }
});
