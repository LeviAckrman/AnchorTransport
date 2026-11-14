import React, { useState, useMemo } from 'react';
import {
  Scale,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Eye,
  Edit,
} from 'lucide-react';
import { TripSettlement, UserRole } from '../../types/tms';
import { formatINR } from '../../lib/currency';
import { PageHeader } from '../../components/layout/PageHeader';
import { SettlementModal } from './SettlementModal';
import { SettlementDetailModal } from './SettlementDetailModal';
import { useFirestoreData } from '../../context/FirestoreDataContext';

interface SettlementsViewProps {
  userRole: UserRole;
  onNavigateTab?: (tab: any) => void;
}

export const SettlementsView: React.FC<SettlementsViewProps> = ({
  userRole,
  onNavigateTab: _onNavigateTab,
}) => {
  const { settlements: allSettlements, loading, error } = useFirestoreData();

  // Pagination & Filtering
  const [page, setPage] = useState(1);
  const limit = 15;
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [settlementToEdit, setSettlementToEdit] = useState<TripSettlement | null>(null);
  const [selectedSettlementId, setSelectedSettlementId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showNotification = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3500);
  };

  const filteredSettlements = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...allSettlements]
      .filter((s) => {
        if (statusFilter === 'FINALIZED') {
          if (s.status !== 'FINALIZED' && s.status !== 'APPROVED_SETTLED') return false;
        } else if (statusFilter) {
          if (s.status !== statusFilter) return false;
        }
        if (q) {
          const hay = [s.settlementNumber, s.tripNumber, s.driverName, s.vehicleReg, s.settledBy]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.settledDate || b.createdAt || 0).getTime() - new Date(a.settledDate || a.createdAt || 0).getTime());
  }, [allSettlements, statusFilter, searchQuery]);

  const summary = useMemo(() => {
    let totalSettledAmountPaise = 0;
    let finalizedCount = 0;
    let pendingCount = 0;

    for (const s of filteredSettlements) {
      totalSettledAmountPaise += Math.abs(s.netPayableToDriverPaise || 0);
      if (s.status === 'FINALIZED' || s.status === 'APPROVED_SETTLED') {
        finalizedCount += 1;
      } else {
        pendingCount += 1;
      }
    }

    return {
      totalSettledAmountPaise,
      finalizedCount,
      pendingCount,
    };
  }, [filteredSettlements]);

  const totalCount = filteredSettlements.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const safePage = Math.min(page, totalPages);

  const settlements = useMemo(() => {
    const start = (safePage - 1) * limit;
    return filteredSettlements.slice(start, start + limit);
  }, [filteredSettlements, safePage]);

  const handleModalSuccess = (settlement: TripSettlement, isEdit: boolean) => {
    showNotification(
      isEdit
        ? `Updated settlement dossier #${settlement.settlementNumber || settlement.id}.`
        : `Reconciled settlement #${settlement.settlementNumber || settlement.id} for trip ${settlement.tripNumber}.`,
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
        title="Trip Settlements & Driver Reconciliation"
        subtitle="Audit and reconcile driver cash advances against verified fuel receipts, toll vouchers, and daily allowances"
        actions={
          <button
            onClick={() => {
              setSettlementToEdit(null);
              setIsModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Settlement Reconciliation</span>
          </button>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Settlement Ledger Volume
            </span>
            <div className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
              <Scale className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">
            {formatINR(summary.totalSettledAmountPaise)}
          </div>
          <span className="mt-1 text-xs text-slate-500 block">
            {totalCount} trip settlement dossiers
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Finalized & Audited
            </span>
            <div className="p-2 bg-emerald-50 text-emerald-700 rounded-xl">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-emerald-700">
            {summary.finalizedCount}
          </div>
          <span className="mt-1 text-xs text-slate-500 block">
            Locked & verified in company ledger
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Pending / Draft Review
            </span>
            <div className="p-2 bg-amber-50 text-amber-700 rounded-xl">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-amber-700">
            {summary.pendingCount}
          </div>
          <span className="mt-1 text-xs text-slate-500 block">
            Awaiting receipt verification
          </span>
        </div>
      </div>

      {/* Filters and Search Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
          <input
            type="text"
            placeholder="Search trip #, driver, settlement #..."
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
            <option value="">All Audit States</option>
            <option value="FINALIZED">Finalized & Locked</option>
            <option value="PENDING_APPROVAL">Pending Approval</option>
            <option value="DRAFT">Draft</option>
          </select>
        </div>
      </div>

      {/* Main Settlements Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        {loading && allSettlements.length === 0 ? (
          <div className="py-20 text-center space-y-3">
            <p className="text-sm font-semibold text-slate-600 animate-pulse">Loading settlements...</p>
          </div>
        ) : error ? (
          <div className="py-16 text-center space-y-3 px-4">
            <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto" />
            <p className="text-sm font-bold text-slate-800">{error}</p>
          </div>
        ) : settlements.length === 0 ? (
          <div className="py-20 text-center space-y-3 px-4">
            <Scale className="w-12 h-12 text-slate-300 mx-auto" />
            <h3 className="text-base font-bold text-slate-800">No Settlements Recorded</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Reconcile delivered trips to balance cash advances against diesel slips and driver allowances.
            </p>
            <button
              onClick={() => {
                setSettlementToEdit(null);
                setIsModalOpen(true);
              }}
              className="mt-2 px-4 py-2 text-xs font-semibold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
            >
              Reconcile Trip
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4">Settlement #</th>
                  <th className="py-3 px-4">Trip & Driver</th>
                  <th className="py-3 px-4">Advances Given</th>
                  <th className="py-3 px-4">Driver Cash Vouchers</th>
                  <th className="py-3 px-4">Daily Bata</th>
                  <th className="py-3 px-4 text-right">Net Final Payment</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-normal text-slate-700">
                {settlements.map((s) => (
                  <tr
                    key={s.id}
                    className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                    onClick={() => setSelectedSettlementId(s.id)}
                  >
                    <td className="py-3 px-4">
                      <span className="font-mono font-bold text-indigo-700 block">
                        {s.settlementNumber || s.id}
                      </span>
                      <span className="text-[11px] text-slate-400 block">{s.settledDate}</span>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">{s.tripNumber}</div>
                      <span className="text-[11px] text-slate-500">{s.driverName}</span>
                    </td>

                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {formatINR(s.totalAdvanceGivenPaise)}
                    </td>

                    <td className="py-3 px-4 font-semibold text-emerald-700">
                      {formatINR(s.driverCashExpensesPaise)}
                    </td>

                    <td className="py-3 px-4 font-semibold text-emerald-700">
                      {formatINR(s.driverBataAllowancePaise)}
                    </td>

                    <td className="py-3 px-4 text-right font-bold">
                      <span
                        className={
                          s.netPayableToDriverPaise >= 0 ? 'text-indigo-700' : 'text-emerald-700'
                        }
                      >
                        {s.netPayableToDriverPaise >= 0
                          ? `Company: ${formatINR(s.netPayableToDriverPaise)}`
                          : `Refund: ${formatINR(Math.abs(s.netPayableToDriverPaise))}`}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-center">
                      {s.status === 'FINALIZED' || s.status === 'APPROVED_SETTLED' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <ShieldCheck className="w-3 h-3" /> Finalized
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          Draft / In Review
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setSelectedSettlementId(s.id)}
                          className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                          title="View Settlement Dossier"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setSettlementToEdit(s);
                            setIsModalOpen(true);
                          }}
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                          title="Review / Edit Settlement"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
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
              Showing page <strong>{safePage}</strong> of <strong>{totalPages}</strong> ({totalCount} dossiers)
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

      {/* Settlement Modal */}
      <SettlementModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleModalSuccess}
        settlementToEdit={settlementToEdit}
      />

      {/* Settlement Detail Modal */}
      <SettlementDetailModal
        isOpen={Boolean(selectedSettlementId)}
        onClose={() => setSelectedSettlementId(null)}
        settlementId={selectedSettlementId}
        userRole={userRole}
        onEdit={(stl) => {
          setSelectedSettlementId(null);
          setSettlementToEdit(stl);
          setIsModalOpen(true);
        }}
      />
    </div>
  );
};
