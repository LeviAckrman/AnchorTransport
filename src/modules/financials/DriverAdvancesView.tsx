import React, { useState, useMemo } from 'react';
import {
  Wallet,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { DriverAdvance, UserRole } from '../../types/tms';
import { formatINR } from '../../lib/currency';
import { Badge } from '../../components/ui/Badge';
import { PageHeader } from '../../components/layout/PageHeader';
import { DriverAdvanceModal } from './DriverAdvanceModal';
import { useFirestoreData } from '../../context/FirestoreDataContext';

interface DriverAdvancesViewProps {
  userRole: UserRole;
  onNavigateTab?: (tab: any) => void;
}

export const DriverAdvancesView: React.FC<DriverAdvancesViewProps> = ({
  userRole: _userRole,
  onNavigateTab: _onNavigateTab,
}) => {
  const { advances: allAdvances, trips, drivers, loading, error } = useFirestoreData();

  // Pagination & Filters
  const [page, setPage] = useState(1);
  const limit = 15;
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(''); // 'settled' | 'pending' | ''

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showNotification = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3500);
  };

  const tripMap = useMemo(() => new Map(trips.map((t) => [t.id, t])), [trips]);
  const driverMap = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);

  const enrichedAdvances = useMemo(() => {
    return allAdvances.map((adv) => {
      const trip = adv.tripId ? tripMap.get(adv.tripId) : undefined;
      const driver = adv.driverId ? driverMap.get(adv.driverId) : undefined;
      return {
        ...adv,
        tripNumber: adv.tripNumber || trip?.tripNumber,
        vehicleReg: adv.vehicleReg || trip?.vehicleReg,
        driverName: adv.driverName || driver?.fullName || trip?.driverName,
      };
    });
  }, [allAdvances, tripMap, driverMap]);

  const filteredAdvances = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...enrichedAdvances]
      .filter((adv) => {
        if (statusFilter === 'settled' && !adv.isSettled) return false;
        if (statusFilter === 'pending' && adv.isSettled) return false;
        if (q) {
          const hay = [
            adv.driverName,
            adv.tripNumber,
            adv.vehicleReg,
            adv.reference,
            adv.referenceNotes,
            adv.notes,
            adv.advanceType,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.date || b.createdAt || 0).getTime() - new Date(a.date || a.createdAt || 0).getTime());
  }, [enrichedAdvances, statusFilter, searchQuery]);

  const summary = useMemo(() => {
    let totalAdvancesPaise = 0;
    let settledAdvancesPaise = 0;
    let pendingAdvancesPaise = 0;

    for (const adv of filteredAdvances) {
      const amt = adv.amountPaise || 0;
      totalAdvancesPaise += amt;
      if (adv.isSettled) settledAdvancesPaise += amt;
      else pendingAdvancesPaise += amt;
    }

    return {
      totalAdvancesPaise,
      settledAdvancesPaise,
      pendingAdvancesPaise,
      count: filteredAdvances.length,
    };
  }, [filteredAdvances]);

  const totalCount = filteredAdvances.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const safePage = Math.min(page, totalPages);

  const advances = useMemo(() => {
    const start = (safePage - 1) * limit;
    return filteredAdvances.slice(start, start + limit);
  }, [filteredAdvances, safePage]);

  const handleModalSuccess = (advance: DriverAdvance) => {
    showNotification(
      `Disbursed advance of ${formatINR(advance.amountPaise)} to ${advance.driverName || 'Driver'}.`,
      'success'
    );
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
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white"
          >
            <option value="">All Settlement States</option>
            <option value="pending">Pending Settlement</option>
            <option value="settled">Settled / Reconciled</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        {loading && allAdvances.length === 0 ? (
          <div className="py-20 text-center space-y-3">
            <p className="text-sm font-semibold text-slate-600 animate-pulse">Loading advances ledger...</p>
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
              className="mt-2 px-4 py-2 text-xs font-semibold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
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
              Showing page <strong>{safePage}</strong> of <strong>{totalPages}</strong> ({totalCount} disbursements)
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

      <DriverAdvanceModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleModalSuccess}
      />
    </div>
  );
};
