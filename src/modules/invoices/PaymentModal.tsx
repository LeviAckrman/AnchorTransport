import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  Building,
  Calendar,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Invoice, Payment } from '../../types/tms';
import { formatINR, paiseToRupees, rupeesToPaise } from '../../lib/financialEngine';
import { parseResponseJson } from '../../lib/safeFetch';
import { useAuth } from '../../context/AuthContext';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  onSuccess: (payment: Payment) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  invoice,
  onSuccess,
}) => {
  const { token } = useAuth();
  const [amountRupees, setAmountRupees] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMode, setPaymentMode] = useState<'NEFT_RTGS' | 'CHEQUE' | 'UPI' | 'CASH' | 'BANK_TRANSFER'>('NEFT_RTGS');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [bankAccount, setBankAccount] = useState('HDFC Bank Ltd. (A/C ...1234)');
  const [tdsRupees, setTdsRupees] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize amount to full remaining balance due
  useEffect(() => {
    if (invoice) {
      const remainingRupees = paiseToRupees(invoice.balanceDuePaise);
      setAmountRupees(remainingRupees.toString());
      setReferenceNumber('');
      setNotes('');
      setError(null);
    }
  }, [invoice, isOpen]);

  if (!invoice) return null;

  const maxBalanceRupees = paiseToRupees(invoice.balanceDuePaise);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const enteredAmount = parseFloat(amountRupees);
    if (isNaN(enteredAmount) || enteredAmount <= 0) {
      setError('Please enter a valid positive payment amount.');
      return;
    }

    if (enteredAmount > maxBalanceRupees + 0.001) {
      setError(
        `Payment amount (₹${enteredAmount.toLocaleString('en-IN')}) cannot exceed current outstanding balance (₹${maxBalanceRupees.toLocaleString('en-IN')}). Overpayments are blocked.`
      );
      return;
    }

    if (!referenceNumber.trim()) {
      setError('A bank reference number (UTR / Cheque # / UPI ID) is required to prevent duplicate entries.');
      return;
    }

    setLoading(true);

    try {
      const amountPaise = rupeesToPaise(enteredAmount);
      const tdsPaise = tdsRupees ? rupeesToPaise(parseFloat(tdsRupees) || 0) : 0;

      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || ''}`,
        },
        body: JSON.stringify({
          invoiceId: invoice.id,
          amountPaise,
          paymentDate,
          paymentMode,
          referenceNumber: referenceNumber.trim(),
          tdsDeductedPaise: tdsPaise,
          bankAccount: bankAccount.trim(),
          notes: notes.trim(),
        }),
      });

      const data = await parseResponseJson(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to record payment');
      }

      onSuccess(data.payment);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Payment submission failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Record Payment for ${invoice.invoiceNumber}`}
      maxWidth="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-2.5 animate-in fade-in">
            <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Payment Guard Rejection</p>
              <p className="text-xs text-rose-700 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Invoice Summary Card */}
        <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 pb-3 mb-3">
            <div>
              <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider block">
                Billing Party
              </span>
              <h4 className="text-base font-bold text-white">{invoice.customerName}</h4>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                GSTIN: {invoice.customerGstin || 'Unregistered'}
              </p>
            </div>
            <div className="text-left sm:text-right">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                Invoice Total
              </span>
              <span className="text-lg font-bold text-white">
                {formatINR(invoice.totalAmountPaise)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-slate-800/80 rounded-xl p-2.5 border border-slate-700/60">
              <span className="text-slate-400 block mb-0.5">Already Collected</span>
              <span className="text-sm font-semibold text-emerald-400">
                {formatINR(invoice.amountPaidPaise)}
              </span>
            </div>
            <div className="bg-rose-950/60 rounded-xl p-2.5 border border-rose-900/60">
              <span className="text-rose-300 block mb-0.5">Outstanding Balance Due</span>
              <span className="text-sm font-bold text-rose-200">
                {formatINR(invoice.balanceDuePaise)}
              </span>
            </div>
          </div>
        </div>

        {/* Payment Amount & Date */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Payment Amount (₹) *
              </label>
              <button
                type="button"
                onClick={() => setAmountRupees(maxBalanceRupees.toString())}
                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                Pay Full (₹{maxBalanceRupees.toLocaleString('en-IN')})
              </button>
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                ₹
              </span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={maxBalanceRupees}
                required
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                placeholder="0.00"
                className="w-full pl-8 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 text-sm"
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
              <Lock className="w-3 h-3 text-slate-400" />
              Overpayments exceeding ₹{maxBalanceRupees.toLocaleString('en-IN')} are locked.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Payment Date *
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="date"
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
              />
            </div>
          </div>
        </div>

        {/* Payment Method & Reference */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Payment Method *
            </label>
            <select
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value as any)}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
            >
              <option value="NEFT_RTGS">NEFT / RTGS Bank Transfer</option>
              <option value="CHEQUE">Cheque / Demand Draft</option>
              <option value="UPI">UPI / Instant Online</option>
              <option value="BANK_TRANSFER">Direct IMPS / Wire</option>
              <option value="CASH">Cash in Hand Receipt</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Bank UTR / Cheque / Ref # *
            </label>
            <input
              type="text"
              required
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="e.g. HDFCR52026110500129"
              className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
            />
          </div>
        </div>

        {/* Bank Account & TDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Deposited Into Account
            </label>
            <div className="relative">
              <Building className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={bankAccount}
                onChange={(e) => setBankAccount(e.target.value)}
                placeholder="e.g. HDFC Bank Current A/C"
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              TDS Deducted u/s 194C (Optional ₹)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                ₹
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={tdsRupees}
                onChange={(e) => setTdsRupees(e.target.value)}
                placeholder="e.g. 1% or 2% TDS certificate"
                className="w-full pl-8 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
              />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            Payment Remarks / Narration
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Confirmed on bank statement. TDS certificate to be collected in Q3."
            className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
          />
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={loading}>
            <CheckCircle2 className="w-4 h-4 mr-1.5" />
            Record Payment
          </Button>
        </div>
      </form>
    </Modal>
  );
};
