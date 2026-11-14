import React, { useMemo } from 'react';
import {
  Scale,
  ShieldCheck,
  Receipt,
  Wallet,
  AlertTriangle,
  Edit,
  Printer,
} from 'lucide-react';
import { TripSettlement, UserRole } from '../../types/tms';
import { Modal } from '../../components/ui/Modal';
import { formatINR } from '../../lib/currency';
import { useFirestoreData } from '../../context/FirestoreDataContext';

interface SettlementDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  settlementId: string | null;
  onEdit?: (settlement: TripSettlement) => void;
  userRole?: UserRole;
}

export const SettlementDetailModal: React.FC<SettlementDetailModalProps> = ({
  isOpen,
  onClose,
  settlementId,
  onEdit,
  userRole: _userRole,
}) => {
  const { settlements, expenses: allExpenses, advances: allAdvances, loading, error } = useFirestoreData();

  const settlement = useMemo(
    () => (settlementId ? settlements.find((s) => s.id === settlementId) || null : null),
    [settlements, settlementId]
  );

  const expenses = useMemo(
    () => (settlement?.tripId ? allExpenses.filter((e) => e.tripId === settlement.tripId) : []),
    [allExpenses, settlement?.tripId]
  );

  const advances = useMemo(
    () => (settlement?.tripId ? allAdvances.filter((a) => a.tripId === settlement.tripId) : []),
    [allAdvances, settlement?.tripId]
  );

  if (!isOpen || !settlementId) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Settlement Dossier #${settlement?.settlementNumber || settlementId}`}
      maxWidth="2xl"
    >
      {loading && !settlement ? (
        <div className="py-20 text-center text-xs text-slate-500">
          Loading settlement reconciliation records...
        </div>
      ) : error ? (
        <div className="p-4 bg-rose-50 text-rose-800 text-xs rounded-xl flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600" />
          <span>{error}</span>
        </div>
      ) : settlement ? (
        <div className="space-y-5 text-xs text-slate-700">
          {/* Header Card */}
          <div className="bg-slate-900 text-white p-5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-xs uppercase px-2 py-0.5 rounded-full font-bold bg-indigo-500/30 text-indigo-200 border border-indigo-400/40">
                  {settlement.settlementNumber || 'STL-RECORD'}
                </span>
                {settlement.status === 'FINALIZED' || settlement.status === 'APPROVED_SETTLED' ? (
                  <span className="px-2.5 py-0.5 rounded-full font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" /> Finalized & Audited
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full font-bold bg-amber-950 text-amber-300 border border-amber-800">
                    Draft / Pending Review
                  </span>
                )}
              </div>
              <h3 className="text-xl font-black text-white mt-1">
                {settlement.driverName} ({settlement.tripNumber})
              </h3>
              <p className="text-slate-400 text-xs mt-0.5">
                Settled on {settlement.settledDate} by {settlement.settledBy}
              </p>
            </div>

            <div className="sm:text-right bg-white/10 p-3.5 rounded-xl border border-white/15">
              <span className="text-[11px] uppercase tracking-wider text-slate-400 font-bold block">
                {settlement.netPayableToDriverPaise >= 0 ? 'Net Company Disbursal' : 'Driver Cash Refund'}
              </span>
              <span className="text-2xl font-black block mt-0.5 text-white">
                {formatINR(Math.abs(settlement.netPayableToDriverPaise))}
              </span>
              <span className="text-[11px] font-semibold text-indigo-300">
                {settlement.netPayableToDriverPaise >= 0 ? 'Company Pays Driver' : 'Driver Refunds Cash to Company'}
              </span>
            </div>
          </div>

          {/* Authorized Correction Log if any */}
          {settlement.isCorrectionAuthorized && (
            <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl space-y-1 text-amber-950">
              <div className="flex items-center gap-1.5 font-bold text-xs">
                <AlertTriangle className="w-4 h-4 text-amber-700" />
                <span>Authorized Financial Correction Recorded</span>
              </div>
              <p className="text-xs">
                <strong>Reason:</strong> {settlement.correctionReason}
              </p>
              <p className="text-[11px] text-amber-800">
                Corrected by {settlement.correctedBy} on {settlement.correctedAt ? new Date(settlement.correctedAt).toLocaleString() : 'N/A'}
              </p>
            </div>
          )}

          {/* Reconciliation Breakdown Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs">
            <div className="p-3 bg-slate-50 border-b border-slate-200 font-bold text-slate-900 flex items-center justify-between">
              <span>Financial Reconciliation Calculation</span>
              <Scale className="w-4 h-4 text-slate-400" />
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-2.5 px-4 font-semibold text-slate-700">1. Total Driver Advances Given</td>
                  <td className="py-2.5 px-4 text-right font-bold text-slate-900">
                    {formatINR(settlement.totalAdvanceGivenPaise)}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-4 font-semibold text-slate-700">2. Approved Driver Cash Expenses (Vouchers)</td>
                  <td className="py-2.5 px-4 text-right font-bold text-emerald-700">
                    − {formatINR(settlement.driverCashExpensesPaise)}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-4 font-semibold text-slate-700">3. Driver Bata Allowance</td>
                  <td className="py-2.5 px-4 text-right font-bold text-emerald-700">
                    − {formatINR(settlement.driverBataAllowancePaise)}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-4 font-semibold text-slate-700">
                    4. Approved Deductions (Penalties / Fuel Shortages)
                    {settlement.deductionReason && (
                      <span className="block text-[11px] text-slate-500 font-normal">
                        Reason: {settlement.deductionReason}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-right font-bold text-rose-700">
                    + {formatINR(settlement.approvedDeductionsPaise || settlement.otherDeductionsPaise || 0)}
                  </td>
                </tr>
                <tr className="bg-slate-50 font-bold border-t border-slate-200 text-sm">
                  <td className="py-3 px-4 text-slate-900">
                    Final Net Balance ({settlement.netPayableToDriverPaise >= 0 ? 'Payable to Driver' : 'Refundable by Driver'})
                  </td>
                  <td className={`py-3 px-4 text-right font-black ${
                    settlement.netPayableToDriverPaise >= 0 ? 'text-indigo-700' : 'text-emerald-700'
                  }`}>
                    {settlement.netPayableToDriverPaise >= 0
                      ? `Company Pays: ${formatINR(settlement.netPayableToDriverPaise)}`
                      : `Driver Refund: ${formatINR(Math.abs(settlement.netPayableToDriverPaise))}`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Itemized Receipts & Advances Tabs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Attached Cash Expenses */}
            <div className="border border-slate-200 rounded-xl p-3 bg-white">
              <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-100">
                <span className="font-bold text-slate-900">
                  Driver Cash Vouchers ({expenses.filter((e) => e.isDriverDisbursed || e.paymentMode === 'CASH' || e.paymentMode === 'DRIVER_POCKET').length})
                </span>
                <Receipt className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {expenses
                  .filter((e) => e.isDriverDisbursed || e.paymentMode === 'CASH' || e.paymentMode === 'DRIVER_POCKET')
                  .map((e) => (
                    <div key={e.id} className="p-2 bg-slate-50 rounded-lg flex items-center justify-between text-[11px]">
                      <div>
                        <span className="font-semibold text-slate-800 block">{e.category.replace('_', ' ')}</span>
                        <span className="text-slate-500">{e.petrolPumpName || e.notes || e.expenseDate || e.date}</span>
                      </div>
                      <span className="font-bold text-rose-700">{formatINR(e.amountPaise)}</span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Attached Advances */}
            <div className="border border-slate-200 rounded-xl p-3 bg-white">
              <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-100">
                <span className="font-bold text-slate-900">Disbursed Advances ({advances.length})</span>
                <Wallet className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {advances.map((a) => (
                  <div key={a.id} className="p-2 bg-slate-50 rounded-lg flex items-center justify-between text-[11px]">
                    <div>
                      <span className="font-semibold text-slate-800 block">{a.advanceType.replace('_', ' ')}</span>
                      <span className="text-slate-500">{a.reference || a.referenceNotes || a.date}</span>
                    </div>
                    <span className="font-bold text-slate-900">{formatINR(a.amountPaise)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Notes */}
          {settlement.settlementNotes && (
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="font-bold text-slate-800 block mb-0.5">Auditor Notes:</span>
              <p className="text-slate-600">{settlement.settlementNotes}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3.5 py-2 text-xs font-semibold rounded-xl text-slate-700 hover:bg-slate-100 border border-slate-300 flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Voucher</span>
            </button>

            <div className="flex items-center gap-2">
              {onEdit && (
                <button
                  type="button"
                  onClick={() => {
                    onEdit(settlement);
                    onClose();
                  }}
                  className="px-4 py-2 text-xs font-semibold rounded-xl text-indigo-700 hover:bg-indigo-50 border border-indigo-200 flex items-center gap-1.5 cursor-pointer"
                >
                  <Edit className="w-3.5 h-3.5" />
                  <span>Review / Edit</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold rounded-xl text-white bg-slate-900 hover:bg-slate-800 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="py-12 text-center text-xs text-slate-500">
          Settlement dossier not found in active company records.
        </div>
      )}
    </Modal>
  );
};
