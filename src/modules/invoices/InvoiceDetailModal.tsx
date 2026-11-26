import React, { useEffect, useMemo, useState } from 'react';
import {
  Printer,
  CreditCard,
  XCircle,
  AlertTriangle,
  Download,
  Edit,
  Phone,
  Mail,
  Landmark,
  ShieldCheck,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Invoice, Payment, GTA_GST_DISCLAIMER } from '../../types/tms';
import { formatINR } from '../../lib/financialEngine';
import { useAuth } from '../../context/AuthContext';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import { cancelInvoiceInFirestore } from '../../lib/firebase/firestoreService';
import { downloadInvoicePdf } from '../../lib/pdfGenerator';
import {
  resolveDisplayLogoUrl,
  resolveInvoiceCompanyBranding,
} from '../../lib/invoiceBranding';
import { DocumentAttachmentsSection } from '../../components/ui/DocumentAttachmentsSection';

interface InvoiceDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  payments: Payment[];
  onEdit?: (invoice: Invoice) => void;
  onOpenPaymentModal: (invoice: Invoice) => void;
  onInvoiceCancelled: (cancelledInvoice: Invoice) => void;
}

export const InvoiceDetailModal: React.FC<InvoiceDetailModalProps> = ({
  isOpen,
  onClose,
  invoice,
  payments,
  onEdit,
  onOpenPaymentModal,
  onInvoiceCancelled,
}) => {
  const { company: authCompany } = useAuth();
  const { company: liveCompany, trips, customers } = useFirestoreData();
  const company = liveCompany?.id ? liveCompany : authCompany;

  const [showCancelPrompt, setShowCancelPrompt] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [resolvedLogoUrl, setResolvedLogoUrl] = useState<string | undefined>(undefined);
  const [logoImgError, setLogoImgError] = useState(false);

  const branding = useMemo(
    () => resolveInvoiceCompanyBranding(invoice, company),
    [invoice, company]
  );

  useEffect(() => {
    let cancelled = false;
    setLogoImgError(false);
    setPdfError(null);
    setResolvedLogoUrl(branding.logoUrl);

    if (!branding.logoUrl && branding.logoStoragePath) {
      resolveDisplayLogoUrl(branding.logoUrl, branding.logoStoragePath).then((url) => {
        if (!cancelled && url) {
          setResolvedLogoUrl(url);
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [branding.logoUrl, branding.logoStoragePath, invoice?.id]);

  if (!invoice) return null;

  const matchedTrip = trips.find((t) => t.id === invoice.tripId);
  const matchedCustomer = customers.find((c) => c.id === invoice.customerId);
  const driverName = invoice.driverName || matchedTrip?.driverName;
  const driverPhone = invoice.driverPhone || matchedTrip?.driverPhone;

  const handlePrint = () => {
    document.body.classList.add('printing-invoice');
    const cleanup = () => {
      document.body.classList.remove('printing-invoice');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(cleanup, 1500);
  };

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    setPdfError(null);
    try {
      await downloadInvoicePdf(invoice, company || null, matchedCustomer, matchedTrip);
    } catch (err: any) {
      setPdfError(err?.message || 'Failed to generate invoice PDF.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleCancelInvoice = async () => {
    const trimmedReason = cancelReason.trim();
    if (!trimmedReason) {
      setCancelError('Please provide a reason for cancelling this invoice.');
      return;
    }

    if (!company?.id) {
      setCancelError('Active company profile not loaded.');
      return;
    }

    setCancelling(true);
    setCancelError(null);

    try {
      await cancelInvoiceInFirestore(
        company.id,
        invoice,
        matchedTrip,
        matchedCustomer,
        trimmedReason.slice(0, 300)
      );

      onInvoiceCancelled({
        ...invoice,
        status: 'CANCELLED',
        paymentStatus: 'CANCELLED' as any,
        balanceDuePaise: 0,
        cancellationReason: trimmedReason,
        cancelledAt: new Date().toISOString(),
      });
      setShowCancelPrompt(false);
      setCancelReason('');
      onClose();
    } catch (err: any) {
      setCancelError(err.message || 'Invoice cancellation failed');
    } finally {
      setCancelling(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PAID':
        return <Badge variant="success">PAID</Badge>;
      case 'PARTIALLY_PAID':
        return <Badge variant="amber">PARTIALLY PAID</Badge>;
      case 'OVERDUE':
        return <Badge variant="danger">OVERDUE</Badge>;
      case 'ISSUED':
        return <Badge variant="indigo">ISSUED</Badge>;
      case 'DRAFT':
        return <Badge variant="neutral">DRAFT</Badge>;
      case 'CANCELLED':
        return <Badge variant="danger">CANCELLED</Badge>;
      default:
        return <Badge variant="neutral">{status.replace(/_/g, ' ')}</Badge>;
    }
  };

  const displayPaymentStatus =
    invoice.status === 'CANCELLED'
      ? 'CANCELLED'
      : invoice.status === 'DRAFT'
      ? 'DRAFT'
      : invoice.paymentStatus || invoice.status;

  const companyInitial = (branding.legalName || 'A').charAt(0).toUpperCase();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Tax Invoice: ${invoice.invoiceNumber}`}
      maxWidth="2xl"
      printFriendly
    >
      <div className="space-y-6">
        {/* Printable Invoice Container */}
        <div
          id="printable-invoice"
          className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-8 shadow-xs space-y-6 text-slate-800"
        >
          {/* Standardized 2-Column Header */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6 border-b border-slate-200 pb-6">
            {/* LEFT SIDE: Logo, Company Legal Name, Registered Address, City/State/PIN/Country, GSTIN, Phone, Email */}
            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="flex items-start gap-4">
                {resolvedLogoUrl && !logoImgError ? (
                  <img
                    src={resolvedLogoUrl}
                    alt={`${branding.legalName} logo`}
                    referrerPolicy="no-referrer"
                    onError={() => setLogoImgError(true)}
                    className="max-h-16 max-w-[160px] w-auto object-contain rounded-lg border border-slate-200 bg-white p-1 shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-700 font-bold text-lg shrink-0">
                    {companyInitial}
                  </div>
                )}

                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight wrap-break-word">
                    {branding.legalName}
                  </h2>
                  {branding.tradeName && (
                    <p className="text-xs font-medium text-slate-600 mt-0.5 wrap-break-word">
                      Trading as: {branding.tradeName}
                    </p>
                  )}
                </div>
              </div>

              <div className="text-xs text-slate-600 space-y-1 leading-relaxed">
                {branding.address && (
                  <p className="text-slate-700 wrap-break-word">{branding.address}</p>
                )}
                {branding.locationLine && (
                  <p className="text-slate-700 font-medium">{branding.locationLine}</p>
                )}
                {!branding.address && !branding.locationLine && (
                  <p className="text-slate-400 italic">Registered office address not configured</p>
                )}

                <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 font-mono text-slate-700">
                  {branding.gstin && (
                    <span>
                      GSTIN: <strong className="text-slate-900">{branding.gstin}</strong>
                    </span>
                  )}
                  {branding.pan && (
                    <span>
                      PAN: <strong className="text-slate-900">{branding.pan}</strong>
                    </span>
                  )}
                  {branding.stateCode && (
                    <span>
                      State Code: <strong className="text-slate-900">{branding.stateCode}</strong>
                    </span>
                  )}
                </div>

                {(branding.phone || branding.email) && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5 text-slate-600">
                    {branding.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="w-3 h-3 text-slate-400" />
                        <span>{branding.phone}</span>
                      </span>
                    )}
                    {branding.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="w-3 h-3 text-slate-400" />
                        <span>{branding.email}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT SIDE: TAX INVOICE heading, Invoice #, Invoice Date, Due Date, Payment Status */}
            <div className="text-left sm:text-right shrink-0 sm:min-w-[210px] space-y-2">
              <div>
                <h1 className="text-xl font-extrabold tracking-tight text-slate-900 uppercase">
                  TAX INVOICE
                </h1>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700 mt-0.5">
                  {invoice.isRcmApplicable ? 'GTA Reverse Charge (RCM)' : 'Forward Charge GST'}
                </p>
              </div>

              <div className="space-y-1 text-xs text-slate-600 pt-1">
                <div>
                  <span className="text-slate-500">Invoice #: </span>
                  <span className="text-sm font-mono font-bold text-slate-900">
                    {invoice.invoiceNumber}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Invoice Date: </span>
                  <strong className="text-slate-900 tabular-nums">{invoice.issueDate}</strong>
                </div>
                {invoice.dueDate && (
                  <div>
                    <span className="text-slate-500">Due Date: </span>
                    <strong
                      className={`tabular-nums ${
                        invoice.status === 'OVERDUE' ? 'text-rose-700' : 'text-slate-900'
                      }`}
                    >
                      {invoice.dueDate}
                    </strong>
                  </div>
                )}
                <div className="pt-1 flex sm:justify-end items-center gap-2">
                  <span className="text-slate-500">Payment Status:</span>
                  {getStatusBadge(displayPaymentStatus)}
                </div>
              </div>
            </div>
          </div>

          {/* Bill To & Consignment Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs">
            <div>
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                Billed To (Customer Details)
              </span>
              <h4 className="text-sm font-bold text-slate-900">{invoice.customerName}</h4>
              <p className="text-slate-600 mt-1 leading-relaxed wrap-break-word">
                {invoice.billingAddress ||
                  [
                    matchedCustomer?.billingAddress,
                    matchedCustomer?.city,
                    matchedCustomer?.state,
                    matchedCustomer?.pincode,
                  ]
                    .filter(Boolean)
                    .join(', ') ||
                  'Billing address not provided'}
              </p>
              <div className="mt-2 font-mono text-slate-700 space-y-0.5">
                <p>
                  GSTIN: <strong>{invoice.customerGstin || matchedCustomer?.gstin || 'Unregistered'}</strong>
                </p>
                <p>
                  Place of Supply:{' '}
                  <strong>
                    {invoice.customerGstin || matchedCustomer?.gstin
                      ? `State Code ${(invoice.customerGstin || matchedCustomer?.gstin || '').substring(0, 2)}`
                      : branding.stateCode
                      ? `${branding.state ? `${branding.state} ` : ''}(${branding.stateCode})`
                      : branding.state || 'Not Specified'}
                  </strong>
                </p>
              </div>
            </div>

            <div className="sm:border-l sm:border-slate-200 sm:pl-4">
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                Trip, Vehicle & Consignment Particulars
              </span>
              <div className="grid grid-cols-2 gap-2 text-slate-700 mt-1">
                <div>
                  <span className="text-slate-500 block">Lorry Receipt (LR) #:</span>
                  <span className="font-bold text-slate-900 font-mono">
                    {invoice.lrNumber || matchedTrip?.lrNumber || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Trip Number:</span>
                  <span className="font-bold text-slate-900 font-mono">
                    {invoice.tripNumber || matchedTrip?.tripNumber || 'Standalone Bill'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Vehicle Number:</span>
                  <span className="font-bold text-slate-900">
                    {invoice.vehicleReg || matchedTrip?.vehicleReg || 'Company Fleet'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">HSN/SAC Code:</span>
                  <span className="font-bold text-slate-900 font-mono">{invoice.hsnSacCode || '996511'}</span>
                </div>
                {driverName && (
                  <div className="col-span-2">
                    <span className="text-slate-500 block">Driver Details:</span>
                    <span className="font-semibold text-slate-800">
                      {driverName}
                      {driverPhone ? ` (${driverPhone})` : ''}
                    </span>
                  </div>
                )}
                <div className="col-span-2">
                  <span className="text-slate-500 block">Route:</span>
                  <span className="font-semibold text-slate-800">
                    {invoice.originCity || invoice.destinationCity
                      ? `${invoice.originCity || '—'} ➔ ${invoice.destinationCity || '—'}`
                      : 'Direct Freight Billing'}
                  </span>
                </div>
                {invoice.goodsType && (
                  <div className="col-span-2">
                    <span className="text-slate-500 block">Consignment Goods & Weight:</span>
                    <span className="font-semibold text-slate-800">
                      {invoice.goodsType} {invoice.weightTonnes ? `(${invoice.weightTonnes} MT)` : ''}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                  <th className="py-2.5 px-3">Description of Freight & Additional Charges</th>
                  <th className="py-2.5 px-3 text-center">SAC Code</th>
                  <th className="py-2.5 px-3 text-right">Taxable Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                <tr>
                  <td className="py-3 px-3">
                    <span className="font-bold text-slate-900 block">
                      Freight Transport Charges by Road
                    </span>
                    <span className="text-slate-600">
                      {invoice.originCity || invoice.destinationCity
                        ? `Transport of ${invoice.goodsType || 'freight cargo'} from ${invoice.originCity || '—'} to ${invoice.destinationCity || '—'}`
                        : `Transport of ${invoice.goodsType || 'freight cargo'}`}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-center font-mono text-slate-600">996511</td>
                  <td className="py-3 px-3 text-right font-semibold text-slate-900">
                    {formatINR(invoice.freightAmountPaise || invoice.taxableAmountPaise)}
                  </td>
                </tr>

                {(invoice.loadingChargesPaise || 0) > 0 && (
                  <tr>
                    <td className="py-2 px-3 text-slate-700">Loading / Crane Handling / Hamali</td>
                    <td className="py-2 px-3 text-center font-mono text-slate-600">996511</td>
                    <td className="py-2 px-3 text-right font-medium text-slate-900">
                      {formatINR(invoice.loadingChargesPaise || 0)}
                    </td>
                  </tr>
                )}

                {(invoice.unloadingChargesPaise || 0) > 0 && (
                  <tr>
                    <td className="py-2 px-3 text-slate-700">Consignee Yard Unloading Assistance</td>
                    <td className="py-2 px-3 text-center font-mono text-slate-600">996511</td>
                    <td className="py-2 px-3 text-right font-medium text-slate-900">
                      {formatINR(invoice.unloadingChargesPaise || 0)}
                    </td>
                  </tr>
                )}

                {(invoice.detentionChargesPaise || 0) > 0 && (
                  <tr>
                    <td className="py-2 px-3 text-slate-700">Demurrage & Detention Halting Charges</td>
                    <td className="py-2 px-3 text-center font-mono text-slate-600">996511</td>
                    <td className="py-2 px-3 text-right font-medium text-slate-900">
                      {formatINR(invoice.detentionChargesPaise || 0)}
                    </td>
                  </tr>
                )}

                {(invoice.otherChargesPaise || 0) > 0 && (
                  <tr>
                    <td className="py-2 px-3 text-slate-700">Ancillary Logistics & Weighment Charges</td>
                    <td className="py-2 px-3 text-center font-mono text-slate-600">996511</td>
                    <td className="py-2 px-3 text-right font-medium text-slate-900">
                      {formatINR(invoice.otherChargesPaise || 0)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Tax Calculation & Total Summary */}
          <div className="border-t border-slate-200 pt-3">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="sm:max-w-xs space-y-2 text-xs">
                {invoice.isRcmApplicable ? (
                  <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-purple-900">
                    <span className="font-bold block mb-1">Reverse Charge Mechanism (RCM)</span>
                    <span>
                      Tax on this invoice is payable by the recipient of services under GTA Notification No. 13/2017-Central Tax.
                    </span>
                  </div>
                ) : (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-indigo-900">
                    <span className="font-bold block mb-1">Forward Charge Mechanism</span>
                    <span>
                      GST collected by transporter: CGST {invoice.cgstRatePercent}% + SGST {invoice.sgstRatePercent}% (or IGST {invoice.igstRatePercent}%).
                    </span>
                  </div>
                )}

                {invoice.notes && (
                  <p className="text-slate-600">
                    <span className="font-semibold text-slate-700">Notes:</span> {invoice.notes}
                  </p>
                )}
              </div>

              <div className="w-full sm:w-64 space-y-1.5 text-xs text-slate-700 tabular-nums">
                {(invoice.discountPaise || 0) > 0 && (
                  <div className="flex justify-between py-1 text-amber-700 font-medium">
                    <span>Less: Discount:</span>
                    <span>− {formatINR(invoice.discountPaise || 0)}</span>
                  </div>
                )}

                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span>Taxable Freight Value:</span>
                  <span className="font-semibold text-slate-900">{formatINR(invoice.taxableAmountPaise)}</span>
                </div>

                {!invoice.isRcmApplicable && (
                  <>
                    {invoice.cgstAmountPaise > 0 && (
                      <div className="flex justify-between py-1 text-slate-600">
                        <span>CGST ({invoice.cgstRatePercent}%):</span>
                        <span>{formatINR(invoice.cgstAmountPaise)}</span>
                      </div>
                    )}
                    {invoice.sgstAmountPaise > 0 && (
                      <div className="flex justify-between py-1 text-slate-600">
                        <span>SGST ({invoice.sgstRatePercent}%):</span>
                        <span>{formatINR(invoice.sgstAmountPaise)}</span>
                      </div>
                    )}
                    {invoice.igstAmountPaise > 0 && (
                      <div className="flex justify-between py-1 text-slate-600">
                        <span>IGST ({invoice.igstRatePercent}%):</span>
                        <span>{formatINR(invoice.igstAmountPaise)}</span>
                      </div>
                    )}
                  </>
                )}

                <div className="flex justify-between py-2 border-t border-slate-200 text-sm font-bold text-slate-900">
                  <span>Total Invoice Amount:</span>
                  <span>{formatINR(invoice.totalAmountPaise)}</span>
                </div>

                <div className="flex justify-between py-1 text-emerald-700 font-medium">
                  <span>Total Amount Paid:</span>
                  <span>{formatINR(invoice.amountPaidPaise)}</span>
                </div>

                <div className="flex justify-between py-1.5 bg-slate-100 rounded-lg px-2 text-rose-700 font-bold">
                  <span>Balance Outstanding:</span>
                  <span>{formatINR(invoice.balanceDuePaise)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Payment Receipts Ledger */}
          {payments.length > 0 && (
            <div className="border-t border-slate-200 pt-4">
              <span className="text-xs font-bold text-slate-900 uppercase tracking-wider block mb-2">
                Recorded Customer Payments ({payments.length})
              </span>
              <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden text-xs">
                <table className="w-full text-left tabular-nums">
                  <thead className="bg-slate-100 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Mode</th>
                      <th className="py-2 px-3">Reference / UTR #</th>
                      <th className="py-2 px-3 text-right">TDS (194C)</th>
                      <th className="py-2 px-3 text-right">Amount Received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2 px-3 font-medium text-slate-900">{p.paymentDate}</td>
                        <td className="py-2 px-3">{p.paymentMode.replace('_', ' ')}</td>
                        <td className="py-2 px-3 font-mono text-slate-700">{p.referenceNumber}</td>
                        <td className="py-2 px-3 text-right text-slate-500">
                          {p.tdsDeductedPaise ? formatINR(p.tdsDeductedPaise) : '₹0'}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-emerald-700">
                          {formatINR(p.amountPaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Bank Details for Remittance (if configured) */}
          {branding.hasBankDetails && (
            <div className="border-t border-slate-200 pt-4 text-xs">
              <div className="flex items-center gap-1.5 text-slate-900 font-bold uppercase tracking-wider mb-2">
                <Landmark className="w-3.5 h-3.5 text-indigo-600" />
                <span>Bank Details for Remittance</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
                {branding.bankName && (
                  <div>
                    <span className="text-slate-500 block">Bank Name</span>
                    <span className="font-semibold text-slate-900">{branding.bankName}</span>
                  </div>
                )}
                {branding.accountNumber && (
                  <div>
                    <span className="text-slate-500 block">Account Number</span>
                    <span className="font-mono font-semibold text-slate-900">{branding.accountNumber}</span>
                  </div>
                )}
                {branding.ifscCode && (
                  <div>
                    <span className="text-slate-500 block">IFSC Code</span>
                    <span className="font-mono font-semibold text-slate-900">{branding.ifscCode}</span>
                  </div>
                )}
                {branding.branch && (
                  <div>
                    <span className="text-slate-500 block">Branch</span>
                    <span className="font-semibold text-slate-900">{branding.branch}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Terms & Conditions, Statutory Notice & Authorized Signatory */}
          <div className="border-t border-slate-200 pt-4 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="flex-1 text-[11px] text-slate-600 leading-relaxed bg-slate-50/80 p-3 rounded-xl border border-slate-200/80">
              <span className="font-semibold text-slate-700 block mb-0.5">
                Terms & Conditions / Statutory Notice:
              </span>
              {invoice.termsAndConditions || GTA_GST_DISCLAIMER}
            </div>
            <div className="sm:text-right shrink-0 text-xs pt-2 sm:pt-0">
              <span className="text-slate-500 block">Authorized Signatory</span>
              <span className="font-bold text-slate-900 block mt-3">{branding.legalName}</span>
              {branding.isSnapshotLocked && (
                <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 mt-1 print:hidden">
                  <ShieldCheck className="w-3 h-3 text-emerald-600" />
                  <span>Company profile snapshot preserved</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="print:hidden no-print">
          <DocumentAttachmentsSection
            companyId={company?.id}
            category="invoices"
            relatedRecordId={invoice.id}
            entityType="INVOICE"
            title="Signed Invoice & Supporting Documents"
            compact
          />
        </div>

        {pdfError && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2 print:hidden no-print">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{pdfError}</span>
          </div>
        )}

        {/* Cancel Invoice Prompt */}
        {showCancelPrompt && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-xs space-y-3 animate-in fade-in print:hidden no-print">
            <div className="flex items-center gap-2 text-rose-800 font-bold">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>Confirm Invoice Cancellation</span>
            </div>
            <p className="text-rose-700">
              Cancelling this invoice will release Trip <strong>{invoice.tripNumber}</strong> for re-billing and decrement the customer's outstanding dues. Cancelled invoices cannot be reinstated.
            </p>
            {cancelError && <p className="text-rose-800 font-semibold">{cancelError}</p>}
            <input
              type="text"
              required
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Enter mandatory cancellation reason (e.g. Consignor requested revised bill-to party)"
              className="w-full px-3 py-2 bg-white border border-rose-300 rounded-xl text-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-600"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowCancelPrompt(false)} disabled={cancelling}>
                Abort
              </Button>
              <Button size="sm" variant="danger" onClick={handleCancelInvoice} loading={cancelling}>
                Confirm Cancellation
              </Button>
            </div>
          </div>
        )}

        {/* Modal Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-slate-200 print:hidden no-print">
          <div>
            {invoice.status !== 'CANCELLED' && invoice.amountPaidPaise === 0 && !showCancelPrompt && (
              <button
                type="button"
                onClick={() => setShowCancelPrompt(true)}
                className="text-xs text-rose-600 hover:text-rose-800 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Cancel Invoice</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={handlePrint}>
              <Printer className="w-4 h-4 mr-1.5" />
              Print
            </Button>

            <Button
              type="button"
              variant="outline"
              loading={downloadingPdf}
              onClick={handleDownloadPdf}
            >
              <Download className="w-4 h-4 mr-1.5" />
              {downloadingPdf ? 'Generating PDF...' : 'Download PDF'}
            </Button>

            {onEdit && invoice.status !== 'PAID' && invoice.status !== 'CANCELLED' && (
              <Button
                type="button"
                variant="outline"
                onClick={() => onEdit(invoice)}
              >
                <Edit className="w-4 h-4 mr-1.5" />
                Edit
              </Button>
            )}

            {invoice.status !== 'PAID' && invoice.status !== 'CANCELLED' && (
              <Button
                type="button"
                variant="primary"
                onClick={() => onOpenPaymentModal(invoice)}
              >
                <CreditCard className="w-4 h-4 mr-1.5" />
                Record Payment
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
