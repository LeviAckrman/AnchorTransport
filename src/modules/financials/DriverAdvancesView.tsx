import React, { useState, useEffect } from 'react';
import {
  Wallet,
  Plus,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  IndianRupee,
  Calendar,
  CheckCircle2,
  Clock,
  User,
  Navigation,
  FileText,
  ShieldCheck,
} from 'lucide-react';
import { DriverAdvance, UserRole } from '../../types/tms';
import { formatINR } from '../../lib/currency';
import { Badge } from '../../components/ui/Badge';
import { PageHeader } from '../../components/layout/PageHeader';
import { DriverAdvanceModal } from './DriverAdvanceModal';
import { useAuth } from '../../context/AuthContext';
import { parseResponseJson } from '../../lib/safeFetch';

interface DriverAdvancesViewProps {
  userRole: UserRole;
  onNavigateTab?: (tab: any) => void;
}

export const DriverAdvancesView: React.FC<DriverAdvancesViewProps> = ({ userRole, onNavigateTab }) => {
  const { token, company } = useAuth();

  const [advances, setAdvances] = useState<DriverAdvance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination & Filters
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(''); // 'settled' | 'pending' | ''

  // Summary
  const [summary, setSummary] = useState({
    totalAdvancesPaise: 0,
    settledAdvancesPaise: 0,
    pendingAdvancesPaise: 0,
    count: 0,
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const fetchAdvances = async (targetPage = page) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: targetPage.toString(),
        limit: '15',
        search: searchQuery,
      });

      if (statusFilter === 'settled') params.append('isSettled', 'true');
      if (statusFilter === 'pending') params.append('isSettled', 'false');

      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/advances?${params.toString()}`, { headers });
      const data = await parseResponseJson<any>(res);

      if (!res.ok || !data || !data.success) {
        throw new Error(data?.error || 'Failed to fetch driver advances.');
      }

      setAdvances(data.data || []);
      setPage(data.pagination.page);
      setTotalPages(data.pagination.totalPages);
      setTotalCount(data.pagination.total);
      if (data.summary) {
        setSummary(data.summary);
      }
    } catch (err: any) {
      setError(err.message || 'Error loading driver advances ledger.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdvances(1);
  }, [statusFilter, token, company?.id]);

  useEffect(() => {
    const handleRefresh = () => {
      fetchAdvances(page);
    };
    window.addEventListener('tms:firestore-hydrated', handleRefresh);
    window.addEventListener('tms:advance-updated', handleRefresh);
    window.addEventListener('tms:trip-updated', handleRefresh);
    return () => {
      window.removeEventListener('tms:firestore-hydrated', handleRefresh);
      window.removeEventListener('tms:advance-updated', handleRefresh);
      window.removeEventListener('tms:trip-updated', handleRefresh);
    };
  }, [page, statusFilter, searchQuery, token, company?.id]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchAdvances(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const showNotification = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3500);
  };

  const handleModalSuccess = (advance: DriverAdvance) => {
    showNotification(
      `Disbursed advance of ${formatINR(advance.amountPaise)} to ${advance.driverName}.`,
      'success'
    );
    fetchAdvances(1);
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
        title="Driver Advances Ledger"
        subtitle="Manage cash floats, UPI transfers, and diesel slips disbursed to drivers prior to trip reconciliation"
        actions={
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Disburse Advance</span>
          </button>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Total Advances Disbursed
            </span>
            <div className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">
            {formatINR(summary.totalAdvancesPaise)}
          </div>
          <span className="mt-1 text-xs text-slate-500 block">
            {summary.count} total disbursements recorded
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Pending Reconciliation
            </span>
            <div className="p-2 bg-amber-50 text-amber-700 rounded-xl">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-amber-700">
            {formatINR(summary.pendingAdvancesPaise)}
          </div>
          <span className="mt-1 text-xs text-slate-500 block">
            Cash in hands of active drivers
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Settled in Audit Dossiers
            </span>
            <div className="p-2 bg-emerald-50 text-emerald-700 rounded-xl">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-emerald-700">
            {formatINR(summary.settledAdvancesPaise)}
          </div>
          <span className="mt-1 text-xs text-slate-500 block">
            Reconciled against verified receipts
          </span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
          <input
            type="text"
            placeholder="Search driver, trip #, UTR, reference..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white"
          >
            <option value="">All Settlement States</option>
            <option value="pending">Pending Settlement</option>
            <option value="settled">Settled / Reconciled</option>
          </select>

          <button
            onClick={() => fetchAdvances(page)}
            className="p-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl border border-slate-200"
            title="Refresh Ledger"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 text-center space-y-3">
            <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
            <p className="text-sm font-semibold text-slate-600">Loading advances ledger...</p>
          </div>
        ) : error ? (
          <div className="py-16 text-center space-y-3 px-4">
            <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto" />
            <p className="text-sm font-bold text-slate-800">{error}</p>
          </div>
        ) : advances.length === 0 ? (
          <div className="py-20 text-center space-y-3 px-4">
            <Wallet className="w-12 h-12 text-slate-300 mx-auto" />
            <h3 className="text-base font-bold text-slate-800">No Advances Disbursed</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              No cash advances recorded yet. Disburse trip funds to drivers before departures.
            </p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="mt-2 px-4 py-2 text-xs font-semibold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700"
            >
              Disburse Advance
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4">Disbursement Date</th>
                  <th className="py-3 px-4">Driver & Vehicle</th>
                  <th className="py-3 px-4">Associated Trip</th>
                  <th className="py-3 px-4">Payment Method</th>
                  <th className="py-3 px-4">Reference / Notes</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-normal text-slate-700">
                {advances.map((adv) => (
                  <tr key={adv.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-medium text-slate-900">
                      {adv.date}
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">{adv.driverName || 'Driver'}</div>
                      {adv.vehicleReg && (
                        <span className="text-[11px] text-slate-500">{adv.vehicleReg}</span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-mono font-bold text-indigo-700">{adv.tripNumber || '—'}</span>
                    </td>

                    <td className="py-3 px-4">
                      <Badge variant="purple">{adv.advanceType.replace('_', ' ')}</Badge>
                    </td>

                    <td className="py-3 px-4 max-w-xs truncate">
                      <span className="text-slate-800">{adv.reference || adv.referenceNotes || 'Trip Float'}</span>
                      {adv.notes && (
                        <span className="text-[11px] text-slate-500 block truncate">{adv.notes}</span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <span className="text-sm font-bold text-slate-900">{formatINR(adv.amountPaise)}</span>
                    </td>

                    <td className="py-3 px-4 text-center">
                      {adv.isSettled ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <ShieldCheck className="w-3 h-3" /> Settled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          Pending Audit
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="py-3 px-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs">
            <span className="text-slate-500">
              Showing page <strong>{page}</strong> of <strong>{totalPages}</strong> ({totalCount} disbursements)
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={page <= 1}
                onClick={() => fetchAdvances(page - 1)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white disabled:opacity-50 text-slate-700 hover:bg-slate-100"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => fetchAdvances(page + 1)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white disabled:opacity-50 text-slate-700 hover:bg-slate-100"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      <DriverAdvanceModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleModalSuccess}
      />
    </div>
  );
};
