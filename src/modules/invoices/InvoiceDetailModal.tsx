import React, { useState } from 'react';
import {
  Printer,
  Download,
  CreditCard,
  XCircle,
  Truck,
  Building,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldCheck,
  FileText,
  FileCheck,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Invoice, Payment, Trip, Customer, GTA_GST_DISCLAIMER } from '../../types/tms';
import { formatINR, paiseToRupees } from '../../lib/financialEngine';
import { parseResponseJson } from '../../lib/safeFetch';
import { useAuth } from '../../context/AuthContext';
import { syncEntityToFirestore } from '../../lib/firebase/firestoreService';

interface InvoiceDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  payments: Payment[];
  onOpenPaymentModal: (invoice: Invoice) => void;
  onInvoiceCancelled: (cancelledInvoice: Invoice) => void;
}

export const InvoiceDetailModal: React.FC<InvoiceDetailModalProps> = ({
  isOpen,
  onClose,
  invoice,
  payments,
  onOpenPaymentModal,
  onInvoiceCancelled,
}) => {
  const { token, company } = useAuth();
  const [showCancelPrompt, setShowCancelPrompt] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  if (!invoice) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleCancelInvoice = async () => {
    if (!cancelReason.trim()) {
      setCancelError('Please provide a reason for cancelling this invoice.');
      return;
    }

    setCancelling(true);
    setCancelError(null);

    try {
      const res = await fetch(`/api/invoices/${invoice.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || ''}`,
        },
        body: JSON.stringify({ cancellationReason: cancelReason.trim() }),
      });

      const data = await parseResponseJson(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to cancel invoice');
      }

      const activeCompanyId = company?.id || data.invoice?.companyId;
      if (activeCompanyId) {
        if (data.invoice) await syncEntityToFirestore(activeCompanyId, 'invoices', data.invoice);
        if (data.trip) await syncEntityToFirestore(activeCompanyId, 'trips', data.trip);
        if (data.customer) await syncEntityToFirestore(activeCompanyId, 'customers', data.customer);
      }

      window.dispatchEvent(new CustomEvent('tms:invoice-updated'));
      window.dispatchEvent(new CustomEvent('tms:trip-updated'));
      window.dispatchEvent(new CustomEvent('tms:customer-updated'));

      onInvoiceCancelled(data.invoice);
      setShowCancelPrompt(false);
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
        return <Badge variant="neutral">{status}</Badge>;
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Tax Invoice: ${invoice.invoiceNumber}`}
      maxWidth="2xl"
    >
      <div className="space-y-6">
        {/* Printable Invoice Container */}
        <div id="printable-invoice" className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 shadow-xs space-y-6 text-slate-800">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-600"></span>
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-700">
                  Goods Transport Agency (GTA)
                </span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                {company?.tradeName || company?.name || 'Transport Company'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {[company?.address, company?.city, company?.state, company?.pincode].filter(Boolean).join(', ') || 'Registered Office Address Not Set'}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 mt-1 font-mono">
                <span>GSTIN: <strong>{company?.gstin || 'Not Provided'}</strong></span>
                <span>PAN: <strong>{company?.pan || 'Not Provided'}</strong></span>
                <span>
                  State Code: <strong>{company?.stateCode ? `${company.stateCode}${company.state ? ` (${company.state})` : ''}` : company?.state || 'Not Provided'}</strong>
                </span>
              </div>
            </div>

            <div className="text-left sm:text-right">
              <div className="flex sm:justify-end mb-1.5">
                {getStatusBadge(invoice.status)}
              </div>
              <h3 className="text-lg font-mono font-bold text-slate-900">{invoice.invoiceNumber}</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Date: <strong>{invoice.issueDate}</strong>
              </p>
              <p className="text-xs text-slate-500">
                Due Date: <strong className={invoice.status === 'OVERDUE' ? 'text-rose-700' : ''}>{invoice.dueDate}</strong>
              </p>
            </div>
          </div>

          {/* Bill To & Consignment Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs">
            <div>
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                Billed To (Consignor / Consignee)
              </span>
              <h4 className="text-sm font-bold text-slate-900">{invoice.customerName}</h4>
              <p className="text-slate-600 mt-1 leading-relaxed">
                {invoice.billingAddress || 'Billing address not provided'}
              </p>
              <div className="mt-2 font-mono text-slate-700 space-y-0.5">
                <p>GSTIN: <strong>{invoice.customerGstin || 'Unregistered'}</strong></p>
                <p>
                  Place of Supply:{' '}
                  <strong>
                    {invoice.customerGstin
                      ? `State Code ${invoice.customerGstin.substring(0, 2)}`
                      : company?.stateCode
                      ? `${company.state ? `${company.state} ` : ''}(${company.stateCode})`
                      : company?.state || 'Not Specified'}
                  </strong>
                </p>
              </div>
            </div>

            <div className="sm:border-l sm:border-slate-200 sm:pl-4">
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                Consignment & LR Particulars
              </span>
              <div className="grid grid-cols-2 gap-2 text-slate-700 mt-1">
                <div>
                  <span className="text-slate-600 block">Lorry Receipt (LR) #:</span>
                  <span className="font-bold text-slate-900 font-mono">{invoice.lrNumber}</span>
                </div>
                <div>
                  <span className="text-slate-600 block">Trip Number:</span>
                  <span className="font-bold text-slate-900 font-mono">{invoice.tripNumber}</span>
                </div>
                <div>
                  <span className="text-slate-600 block">Assigned Vehicle:</span>
                  <span className="font-bold text-slate-900">{invoice.vehicleReg || 'Company Truck'}</span>
                </div>
                <div>
                  <span className="text-slate-600 block">HSN/SAC Code:</span>
                  <span className="font-bold text-slate-900 font-mono">{invoice.hsnSacCode || '996511'}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-600 block">Route:</span>
                  <span className="font-semibold text-slate-800">
                    {invoice.originCity || 'Origin'} ➔ {invoice.destinationCity || 'Destination'}
                  </span>
                </div>
                {invoice.goodsType && (
                  <div className="col-span-2">
                    <span className="text-slate-600 block">Consignment Goods & Weight:</span>
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
                  <th className="py-2.5 px-3">Description of Freight Service</th>
                  <th className="py-2.5 px-3 text-center">SAC Code</th>
                  <th className="py-2.5 px-3 text-right">Taxable Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-3 px-3">
                    <span className="font-bold text-slate-900 block">
                      Freight Transport Charges by Road
                    </span>
                    <span className="text-slate-600">
                      Transport of {invoice.goodsType || 'Industrial cargo'} from {invoice.originCity} to {invoice.destinationCity}
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
                  <p className="text-slate-500 italic">Notes: {invoice.notes}</p>
                )}
              </div>

              <div className="w-full sm:w-64 space-y-1.5 text-xs text-slate-700">
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
                <table className="w-full text-left">
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

          {/* Statutory Compliance Footer Notice */}
          <div className="border-t border-slate-200 pt-4 text-[11px] text-slate-600 leading-relaxed bg-slate-50/80 p-3 rounded-xl border border-slate-200/80">
            <span className="font-semibold text-slate-700 block mb-0.5">Statutory Disclaimer:</span>
            {GTA_GST_DISCLAIMER}
          </div>
        </div>

        {/* Cancel Invoice Prompt */}
        {showCancelPrompt && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-xs space-y-3 animate-in fade-in">
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-slate-200">
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

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={handlePrint}>
              <Printer className="w-4 h-4 mr-1.5" />
              Print / PDF
            </Button>

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
