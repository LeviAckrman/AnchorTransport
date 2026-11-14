import React, { useState, useMemo } from 'react';
import {
  Receipt,
  Plus,
  Search,
  AlertTriangle,
  Fuel,
  ChevronLeft,
  ChevronRight,
  Eye,
  Edit,
  Trash2,
  CheckCircle2,
  TrendingDown,
  ShieldCheck,
  CreditCard,
  Truck,
} from 'lucide-react';
import { TripExpense, UserRole } from '../../types/tms';
import { formatINR } from '../../lib/currency';
import { Badge, BadgeVariant } from '../../components/ui/Badge';
import { PageHeader } from '../../components/layout/PageHeader';
import { ExpenseModal } from './ExpenseModal';
import { ExpenseDetailModal } from './ExpenseDetailModal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import { deleteExpenseInFirestore } from '../../lib/firebase/firestoreService';
import { getExpenseDate } from '../../lib/tmsCalculations';

interface ExpensesViewProps {
  userRole: UserRole;
  onNavigateTab?: (tab: any) => void;
}

export const ExpensesView: React.FC<ExpensesViewProps> = ({ userRole, onNavigateTab: _onNavigateTab }) => {
  const { company: authCompany } = useAuth();
  const { company: liveCompany, expenses: allExpenses, trips, loading, error } = useFirestoreData();
  const company = liveCompany?.id ? liveCompany : authCompany;

  // Pagination & Filtering
  const [page, setPage] = useState(1);
  const limit = 15;
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [paymentModeFilter, setPaymentModeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expenseToEdit, setExpenseToEdit] = useState<TripExpense | null>(null);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);
  const [expenseToDelete, setExpenseToDelete] = useState<TripExpense | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showNotification = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3500);
  };

  const tripMap = useMemo(() => new Map(trips.map((t) => [t.id, t])), [trips]);

  const enrichedExpenses = useMemo(() => {
    return allExpenses.map((exp) => {
      const trip = exp.tripId ? tripMap.get(exp.tripId) : undefined;
      return {
        ...exp,
        tripNumber: exp.tripNumber || trip?.tripNumber,
        vehicleReg: exp.vehicleReg || trip?.vehicleReg,
        driverName: exp.driverName || trip?.driverName,
      };
    });
  }, [allExpenses, tripMap]);

  const matchesCategoryFilter = (cat: string, filter: string): boolean => {
    if (!filter) return true;
    if (filter === 'FUEL') return cat === 'FUEL' || cat === 'DIESEL';
    if (filter === 'TOLL') return cat === 'TOLL' || cat === 'TOLL_FASTAG';
    if (filter === 'DRIVER_ALLOWANCE') return cat === 'DRIVER_ALLOWANCE' || cat === 'DRIVER_BATA';
    if (filter === 'REPAIR') return cat === 'REPAIR' || cat === 'EN_ROUTE_REPAIR' || cat === 'TYRE_PUNCTURE';
    return cat === filter;
  };

  const filteredExpenses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...enrichedExpenses]
      .filter((exp) => {
        if (!matchesCategoryFilter(exp.category, categoryFilter)) return false;
        if (paymentModeFilter && exp.paymentMode !== paymentModeFilter) return false;
        const dt = getExpenseDate(exp).slice(0, 10);
        if (startDate && dt && dt < startDate) return false;
        if (endDate && dt && dt > endDate) return false;
        if (q) {
          const hay = [
            exp.tripNumber,
            exp.vehicleReg,
            exp.driverName,
            exp.petrolPumpName,
            exp.pumpName,
            exp.voucherNumber,
            exp.receiptNumber,
            exp.description,
            exp.notes,
            exp.category,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const da = new Date(getExpenseDate(b) || 0).getTime();
        const db = new Date(getExpenseDate(a) || 0).getTime();
        return da - db;
      });
  }, [enrichedExpenses, categoryFilter, paymentModeFilter, startDate, endDate, searchQuery]);

  // Summary KPIs derived from filtered/live Firestore expenses
  const summary = useMemo(() => {
    let totalAmountPaise = 0;
    let fuelAmountPaise = 0;
    let tollAmountPaise = 0;
    let otherAmountPaise = 0;

    for (const exp of filteredExpenses) {
      const amt = exp.amountPaise || 0;
      totalAmountPaise += amt;
      if (exp.category === 'FUEL' || exp.category === 'DIESEL') {
        fuelAmountPaise += amt;
      } else if (exp.category === 'TOLL' || exp.category === 'TOLL_FASTAG') {
        tollAmountPaise += amt;
      } else {
        otherAmountPaise += amt;
      }
    }

    return {
      totalAmountPaise,
      fuelAmountPaise,
      tollAmountPaise,
      otherAmountPaise,
      count: filteredExpenses.length,
    };
  }, [filteredExpenses]);

  const totalCount = filteredExpenses.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const safePage = Math.min(page, totalPages);

  const expenses = useMemo(() => {
    const start = (safePage - 1) * limit;
    return filteredExpenses.slice(start, start + limit);
  }, [filteredExpenses, safePage]);

  const selectedExpenseForDetail = useMemo(
    () => (selectedExpenseId ? enrichedExpenses.find((e) => e.id === selectedExpenseId) || null : null),
    [enrichedExpenses, selectedExpenseId]
  );

  const handleModalSuccess = (savedExpense: TripExpense, isEdit: boolean) => {
    showNotification(
      isEdit
        ? `Updated expense voucher #${savedExpense.voucherNumber || savedExpense.id}.`
        : `Recorded ${savedExpense.category} expense of ${formatINR(savedExpense.amountPaise)}.`,
      'success'
    );
  };

  const handleDeleteExpense = async (expense: TripExpense) => {
    const activeCompanyId = company?.id || expense.companyId;
    if (!activeCompanyId) {
      showNotification('Company context unavailable.', 'error');
      return;
    }

    setIsDeleting(true);
    try {
      const trip = expense.tripId ? tripMap.get(expense.tripId) : undefined;
      const remainingTripExpenses = allExpenses.filter(
        (e) => e.tripId === expense.tripId && e.id !== expense.id
      );

      await deleteExpenseInFirestore(activeCompanyId, expense, trip, remainingTripExpenses);

      showNotification(`Expense voucher #${expense.voucherNumber || expense.id} removed.`);
      setExpenseToDelete(null);
      if (selectedExpenseId === expense.id) setSelectedExpenseId(null);
    } catch (err: any) {
      showNotification(err.message || 'Error removing expense.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

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
      case 'TYRE_PUNCTURE':
        return 'amber';
      case 'DRIVER_ALLOWANCE':
      case 'DRIVER_BATA':
        return 'purple';
      default:
        return 'default';
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto antialiased">
      {/* Toast Alert */}
      {toastMsg && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl shadow-xl text-xs sm:text-sm font-medium flex items-center gap-2 border animate-in fade-in slide-in-from-top-4 duration-200 ${
            toastMsg.type === 'success'
              ? 'bg-emerald-900 text-emerald-100 border-emerald-700'
              : 'bg-rose-900 text-rose-100 border-rose-700'
          }`}
        >
          {toastMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{toastMsg.text}</span>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        title="Trip Expenses & Fuel Logs"
        subtitle="Record diesel slips, FastTag electronic tolls, loading charges, en-route repairs, and driver allowances"
        actions={
          <button
            onClick={() => {
              setExpenseToEdit(null);
              setIsModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Record Expense</span>
          </button>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Total Recorded Spend
            </span>
            <div className="p-2 bg-rose-50 text-rose-700 rounded-xl">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-rose-700">
            {formatINR(summary.totalAmountPaise)}
          </div>
          <span className="mt-1 text-xs text-slate-500 block">
            {summary.count} operational vouchers
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Fuel & Diesel Spend
            </span>
            <div className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
              <Fuel className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">
            {formatINR(summary.fuelAmountPaise)}
          </div>
          <span className="mt-1 text-xs text-slate-500 block">
            {summary.totalAmountPaise > 0
              ? `${((summary.fuelAmountPaise / summary.totalAmountPaise) * 100).toFixed(0)}% of total spend`
              : 'Diesel dispensation'}
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Toll & FastTag Electronic
            </span>
            <div className="p-2 bg-blue-50 text-blue-700 rounded-xl">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">
            {formatINR(summary.tollAmountPaise)}
          </div>
          <span className="mt-1 text-xs text-slate-500 block">
            NHAI plaza electronic tolls
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Bata, Loading & Repairs
            </span>
            <div className="p-2 bg-amber-50 text-amber-700 rounded-xl">
              <TrendingDown className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">
            {formatINR(summary.otherAmountPaise)}
          </div>
          <span className="mt-1 text-xs text-slate-500 block">
            Driver bata, maintenance & parking
          </span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
            <input
              type="text"
              placeholder="Search trip #, vehicle, pump, voucher..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white"
            />
          </div>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white"
          >
            <option value="">All Categories</option>
            <option value="FUEL">Fuel / Diesel</option>
            <option value="TOLL">Toll / FastTag</option>
            <option value="PARKING">Parking Charges</option>
            <option value="DRIVER_ALLOWANCE">Driver Allowance (Bata)</option>
            <option value="LOADING">Loading Charges</option>
            <option value="UNLOADING">Unloading Charges</option>
            <option value="REPAIR">En-route Repair / Tyre</option>
            <option value="RTO_POLICE">RTO / Police Fees</option>
            <option value="OTHER">Other Expenses</option>
          </select>

          {/* Payment Mode Filter */}
          <select
            value={paymentModeFilter}
            onChange={(e) => {
              setPaymentModeFilter(e.target.value);
              setPage(1);
            }}
            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white"
          >
            <option value="">All Payment Modes</option>
            <option value="CASH">Cash (Driver Advance)</option>
            <option value="FASTAG">FastTag Electronic</option>
            <option value="PETRO_CARD">Petro Card / Fleet Card</option>
            <option value="UPI">UPI Online</option>
            <option value="BANK_TRANSFER">Bank Wire</option>
            <option value="DRIVER_POCKET">Driver Pocket</option>
          </select>

          {/* Clear Filters */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setSearchQuery('');
                setCategoryFilter('');
                setPaymentModeFilter('');
                setStartDate('');
                setEndDate('');
                setPage(1);
              }}
              className="px-3 py-2 text-xs font-semibold rounded-xl text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 flex-1 cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      {/* Main Expense Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        {loading && allExpenses.length === 0 ? (
          <div className="py-20 text-center space-y-3">
            <p className="text-sm font-semibold text-slate-600 animate-pulse">Loading trip expenses...</p>
          </div>
        ) : error ? (
          <div className="py-16 text-center space-y-3 px-4">
            <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto" />
            <p className="text-sm font-bold text-slate-800">{error}</p>
          </div>
        ) : expenses.length === 0 ? (
          <div className="py-20 text-center space-y-3 px-4">
            <Receipt className="w-12 h-12 text-slate-300 mx-auto" />
            <h3 className="text-base font-bold text-slate-800">No Expenses Recorded</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              No expense vouchers matched your criteria. Record diesel dispensations, FastTag tolls, or driver allowances.
            </p>
            <button
              onClick={() => {
                setExpenseToEdit(null);
                setIsModalOpen(true);
              }}
              className="mt-2 px-4 py-2 text-xs font-semibold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
            >
              Record First Expense
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4">Date & Category</th>
                  <th className="py-3 px-4">Trip & Vehicle</th>
                  <th className="py-3 px-4">Particulars / Pump</th>
                  <th className="py-3 px-4">Payment Method</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4 text-center">Settlement Status</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-normal text-slate-700">
                {expenses.map((exp) => (
                  <tr
                    key={exp.id}
                    className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                    onClick={() => setSelectedExpenseId(exp.id)}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <Badge variant={getCategoryBadgeVariant(exp.category)}>
                          {exp.category.replace('_', ' ')}
                        </Badge>
                      </div>
                      <span className="text-[11px] text-slate-500 block mt-1">
                        {exp.expenseDate || exp.date || '—'}
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">{exp.tripNumber || 'General Expense'}</div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                        <Truck className="w-3 h-3 text-slate-400" />
                        <span>{exp.vehicleReg || 'Unassigned'}</span>
                        {exp.driverName && (
                          <>
                            <span className="text-slate-300">•</span>
                            <span>{exp.driverName}</span>
                          </>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-4 max-w-xs">
                      <div className="font-medium text-slate-900 truncate">
                        {exp.petrolPumpName || exp.pumpName || exp.description || exp.notes || 'Operating expense'}
                      </div>
                      {exp.litres && (
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {exp.litres}L @ {exp.ratePerLitrePaise ? formatINR(exp.ratePerLitrePaise, true) : '—'}/L
                        </div>
                      )}
                      {exp.voucherNumber && (
                        <span className="text-[10px] text-slate-400 font-mono block">
                          #{exp.voucherNumber}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-medium text-slate-900 block">{exp.paymentMode}</span>
                      <span className="text-[11px] text-slate-500">
                        {exp.isDriverDisbursed ? 'Driver (Cash Advance)' : 'Company Direct'}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-right">
                      <span className="text-sm font-bold text-rose-700">
                        {formatINR(exp.amountPaise)}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-center">
                      {exp.isSettled ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <ShieldCheck className="w-3 h-3" /> Settled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          Unsettled
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setSelectedExpenseId(exp.id)}
                          className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                          title="View Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setExpenseToEdit(exp);
                            setIsModalOpen(true);
                          }}
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                          title="Edit Voucher"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        {!exp.isSettled && (
                          <button
                            onClick={() => setExpenseToDelete(exp)}
                            className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                            title="Delete Voucher"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="py-3 px-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs">
            <span className="text-slate-500">
              Showing page <strong>{safePage}</strong> of <strong>{totalPages}</strong> ({totalCount} items)
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white disabled:opacity-50 text-slate-700 hover:bg-slate-100"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white disabled:opacity-50 text-slate-700 hover:bg-slate-100"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Record / Edit Expense Modal */}
      <ExpenseModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleModalSuccess}
        expenseToEdit={expenseToEdit}
      />

      {/* Expense Detail Modal */}
      <ExpenseDetailModal
        isOpen={Boolean(selectedExpenseForDetail)}
        onClose={() => setSelectedExpenseId(null)}
        expense={selectedExpenseForDetail}
        userRole={userRole}
        onEdit={(exp) => {
          setSelectedExpenseId(null);
          setExpenseToEdit(exp);
          setIsModalOpen(true);
        }}
        onDelete={handleDeleteExpense}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(expenseToDelete)}
        onClose={() => setExpenseToDelete(null)}
        onConfirm={() => {
          if (expenseToDelete) handleDeleteExpense(expenseToDelete);
        }}
        title="Delete Expense Voucher"
        message={`Delete expense voucher ${expenseToDelete?.voucherNumber || expenseToDelete?.id || ''} (${expenseToDelete ? formatINR(expenseToDelete.amountPaise) : ''})? This will recompute trip operational contribution.`}
        confirmLabel="Delete Voucher"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
};
