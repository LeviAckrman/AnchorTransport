import React, { useState, useEffect } from 'react';
import {
  Receipt,
  Truck,
  IndianRupee,
  Calendar,
  Fuel,
  FileText,
  User,
  Navigation,
  ShieldCheck,
  CreditCard,
  Edit,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { TripExpense, UserRole } from '../../types/tms';
import { Modal } from '../../components/ui/Modal';
import { Badge, BadgeVariant } from '../../components/ui/Badge';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { formatINR } from '../../lib/currency';

interface ExpenseDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  expense: TripExpense | null;
  onEdit?: (expense: TripExpense) => void;
  onDelete?: (expense: TripExpense) => void;
  userRole?: UserRole;
}

export const ExpenseDetailModal: React.FC<ExpenseDetailModalProps> = ({
  isOpen,
  onClose,
  expense,
  onEdit,
  onDelete,
  userRole,
}) => {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setConfirmDeleteOpen(false);
    }
  }, [isOpen]);

  if (!expense) return null;

  const canEdit = userRole === 'OWNER' || userRole === 'ADMIN' || userRole === 'ACCOUNTANT';

  const getCategoryBadgeVariant = (cat: string): BadgeVariant => {
    switch (cat) {
      case 'FUEL':
      case 'DIESEL':
        return 'indigo';
      case 'TOLL':
      case 'TOLL_FASTAG':
        return 'blue';
      case 'REPAIR':
      case 'EN_ROUTE_REPAIR':
        return 'amber';
      case 'DRIVER_ALLOWANCE':
      case 'DRIVER_BATA':
        return 'purple';
      default:
        return 'default';
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Expense Voucher #${expense.voucherNumber || expense.id}`}
      maxWidth="xl"
    >
      <div className="space-y-6">
        {/* Header Hero Card */}
        <div className="bg-slate-900 text-white p-5 rounded-2xl flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant={getCategoryBadgeVariant(expense.category)}>
                {expense.category.replace('_', ' ')}
              </Badge>
              {expense.isSettled ? (
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> Audited & Settled
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-950 text-amber-300 border border-amber-800">
                  Pending Settlement
                </span>
              )}
            </div>
            <div className="text-3xl font-black tracking-tight text-white mt-1">
              {formatINR(expense.amountPaise)}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Date: {expense.expenseDate || expense.date || 'N/A'}
            </div>
          </div>
          <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-xs">
            <Receipt className="w-8 h-8 text-indigo-300" />
          </div>
        </div>

        {/* Trip & Vehicle Dossier */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
              <Navigation className="w-3.5 h-3.5 text-indigo-600" />
              <span>Trip Number</span>
            </div>
            <div className="font-bold text-slate-900">{expense.tripNumber || 'Direct Booking'}</div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
              <Truck className="w-3.5 h-3.5 text-blue-600" />
              <span>Vehicle Reg.</span>
            </div>
            <div className="font-bold text-slate-900">{expense.vehicleReg || 'Unassigned'}</div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
              <User className="w-3.5 h-3.5 text-emerald-600" />
              <span>Assigned Driver</span>
            </div>
            <div className="font-bold text-slate-900">{expense.driverName || 'N/A'}</div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
              <CreditCard className="w-3.5 h-3.5 text-purple-600" />
              <span>Payment Mode</span>
            </div>
            <div className="font-bold text-slate-900">{expense.paymentMode}</div>
          </div>
        </div>

        {/* Diesel / Fuel Breakdown if applicable */}
        {(expense.category === 'FUEL' || expense.category === 'DIESEL' || expense.litres) && (
          <div className="p-4 bg-indigo-50/50 border border-indigo-200 rounded-xl space-y-2 text-xs">
            <div className="flex items-center gap-2 font-bold text-indigo-900">
              <Fuel className="w-4 h-4 text-indigo-700" />
              Fuel Dispensation Record
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1 text-slate-700">
              <div>
                <span className="text-slate-500 block">Litres:</span>
                <span className="font-bold text-slate-900">{expense.litres || expense.litresFuel || '—'} L</span>
              </div>
              <div>
                <span className="text-slate-500 block">Rate / Litre:</span>
                <span className="font-bold text-slate-900">
                  {expense.ratePerLitrePaise ? formatINR(expense.ratePerLitrePaise, true) : '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Pump Name:</span>
                <span className="font-bold text-slate-900">{expense.petrolPumpName || expense.pumpName || '—'}</span>
              </div>
            </div>
          </div>
        )}

        {/* Receipt & References */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Verification & Receipts
          </h4>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-500">Voucher / Slip #:</span>
              <span className="font-mono font-semibold text-slate-900">{expense.voucherNumber || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Receipt / Bill #:</span>
              <span className="font-mono font-semibold text-slate-900">{expense.receiptNumber || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Disbursed By:</span>
              <span className="font-medium text-slate-900">
                {expense.isDriverDisbursed ? 'Driver (From Cash Advance)' : 'Company Direct Disbursal'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Recorded By:</span>
              <span className="font-medium text-slate-900">{expense.recordedBy}</span>
            </div>
          </div>

          {/* Receipt Attachment Link */}
          {expense.receiptUrl && (
            <div className="p-3 bg-slate-100 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 truncate text-slate-700">
                <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
                <span className="truncate">{expense.receiptUrl}</span>
              </div>
              <a
                href={expense.receiptUrl}
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-indigo-600 hover:text-indigo-800 flex items-center gap-1 shrink-0"
              >
                <span>View</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          {expense.notes && (
            <div className="text-xs text-slate-600 bg-white p-3 rounded-xl border border-slate-200">
              <span className="font-bold text-slate-800 block mb-1">Notes:</span>
              <p>{expense.notes}</p>
            </div>
          )}
        </div>

        {/* Modal Action Buttons */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-200">
          <div>
            {canEdit && onDelete && !expense.isSettled && (
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                className="px-3 py-2 text-xs font-semibold rounded-xl text-rose-700 hover:bg-rose-50 border border-rose-200 flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Voucher</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {canEdit && onEdit && (
              <button
                type="button"
                onClick={() => {
                  onEdit(expense);
                  onClose();
                }}
                className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-700 hover:bg-slate-100 border border-slate-300 flex items-center gap-1.5 transition-colors"
              >
                <Edit className="w-3.5 h-3.5" />
                <span>Edit Voucher</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-xl text-white bg-slate-900 hover:bg-slate-800 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => {
          setConfirmDeleteOpen(false);
          if (onDelete) onDelete(expense);
          onClose();
        }}
        title="Delete Expense Voucher"
        message="Delete this expense voucher? This will recompute trip contribution."
        confirmLabel="Delete Voucher"
        variant="danger"
      />
    </Modal>
  );
};
