import React, { useState, useEffect } from 'react';
import {
  Receipt,
  Plus,
  Search,
  Filter,
  AlertTriangle,
  IndianRupee,
  Fuel,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Eye,
  Edit,
  Trash2,
  Calendar,
  CheckCircle2,
  TrendingDown,
  FileText,
  ShieldCheck,
  CreditCard,
  Truck,
} from 'lucide-react';
import { TripExpense, ExpenseCategory, PaymentMode, UserRole } from '../../types/tms';
import { formatINR } from '../../lib/currency';
import { Badge, BadgeVariant } from '../../components/ui/Badge';
import { PageHeader } from '../../components/layout/PageHeader';
import { ExpenseModal } from './ExpenseModal';
import { ExpenseDetailModal } from './ExpenseDetailModal';
import { useAuth } from '../../context/AuthContext';
import { parseResponseJson } from '../../lib/safeFetch';

interface ExpensesViewProps {
  userRole: UserRole;
  onNavigateTab?: (tab: any) => void;
}

export const ExpensesView: React.FC<ExpensesViewProps> = ({ userRole, onNavigateTab }) => {
  const { token, company } = useAuth();

  // State
  const [expenses, setExpenses] = useState<TripExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination & Filtering
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [paymentModeFilter, setPaymentModeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Summary KPIs
  const [summary, setSummary] = useState({
    totalAmountPaise: 0,
    fuelAmountPaise: 0,
    tollAmountPaise: 0,
    otherAmountPaise: 0,
    count: 0,
  });

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expenseToEdit, setExpenseToEdit] = useState<TripExpense | null>(null);
  const [selectedExpenseForDetail, setSelectedExpenseForDetail] = useState<TripExpense | null>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const fetchExpenses = async (targetPage = page) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: targetPage.toString(),
        limit: '15',
        search: searchQuery,
      });

      if (categoryFilter) params.append('category', categoryFilter);
      if (paymentModeFilter) params.append('paymentMode', paymentModeFilter);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/expenses?${params.toString()}`, { headers });
      const data = await parseResponseJson<any>(res);

      if (!res.ok || !data || !data.success) {
        throw new Error(data?.error || 'Failed to fetch trip expense records.');
      }

      setExpenses(data.data || []);
      setPage(data.pagination.page);
      setTotalPages(data.pagination.totalPages);
      setTotalCount(data.pagination.total);
      if (data.summary) {
        setSummary(data.summary);
      }
    } catch (err: any) {
      setError(err.message || 'Error loading expense ledger.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExpenses(1);
  }, [categoryFilter, paymentModeFilter, startDate, endDate, token, company?.id]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchExpenses(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const showNotification = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3500);
  };

  const handleModalSuccess = (savedExpense: TripExpense, isEdit: boolean) => {
    showNotification(
      isEdit
        ? `Updated expense voucher #${savedExpense.voucherNumber || savedExpense.id}.`
        : `Recorded ${savedExpense.category} expense of ${formatINR(savedExpense.amountPaise)}.`,
      'success'
    );
    fetchExpenses(isEdit ? page : 1);
  };

  const handleDeleteExpense = async (expense: TripExpense) => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/expenses/${expense.id}`, {
        method: 'DELETE',
        headers,
      });

      const data = await parseResponseJson<any>(res);
      if (!res.ok || !data || !data.success) {
        throw new Error(data?.error || 'Failed to delete expense voucher.');
      }

      showNotification(`Expense voucher #${expense.voucherNumber || expense.id} removed.`);
      fetchExpenses(page);
    } catch (err: any) {
      showNotification(err.message || 'Error removing expense.', 'error');
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
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white"
            />
          </div>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
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
            <option value="OTHER">Other Expenses</option>
          </select>

          {/* Payment Mode Filter */}
          <select
            value={paymentModeFilter}
            onChange={(e) => setPaymentModeFilter(e.target.value)}
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

          {/* Refresh & Clear Filters */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setSearchQuery('');
                setCategoryFilter('');
                setPaymentModeFilter('');
                setStartDate('');
                setEndDate('');
              }}
              className="px-3 py-2 text-xs font-semibold rounded-xl text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 flex-1"
            >
              Reset Filters
            </button>
            <button
              onClick={() => fetchExpenses(page)}
              className="p-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl border border-slate-200"
              title="Refresh Expenses"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Expense Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 text-center space-y-3">
            <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
            <p className="text-sm font-semibold text-slate-600">Loading trip expenses...</p>
          </div>
        ) : error ? (
          <div className="py-16 text-center space-y-3 px-4">
            <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto" />
            <p className="text-sm font-bold text-slate-800">{error}</p>
            <button
              onClick={() => fetchExpenses(page)}
              className="px-4 py-2 text-xs font-semibold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700"
            >
              Retry
            </button>
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
              className="mt-2 px-4 py-2 text-xs font-semibold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700"
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
                    onClick={() => setSelectedExpenseForDetail(exp)}
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
                          onClick={() => setSelectedExpenseForDetail(exp)}
                          className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg"
                          title="View Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setExpenseToEdit(exp);
                            setIsModalOpen(true);
                          }}
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded-lg"
                          title="Edit Voucher"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        {!exp.isSettled && (
                          <button
                            onClick={() => {
                              if (window.confirm('Delete this expense record?')) {
                                handleDeleteExpense(exp);
                              }
                            }}
                            className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-slate-100 rounded-lg"
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
              Showing page <strong>{page}</strong> of <strong>{totalPages}</strong> ({totalCount} items)
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={page <= 1}
                onClick={() => fetchExpenses(page - 1)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white disabled:opacity-50 text-slate-700 hover:bg-slate-100"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => fetchExpenses(page + 1)}
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
        onClose={() => setSelectedExpenseForDetail(null)}
        expense={selectedExpenseForDetail}
        userRole={userRole}
        onEdit={(exp) => {
          setSelectedExpenseForDetail(null);
          setExpenseToEdit(exp);
          setIsModalOpen(true);
        }}
        onDelete={handleDeleteExpense}
      />
    </div>
  );
};
