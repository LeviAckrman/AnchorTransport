import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  Filter,
  IndianRupee,
  Plus,
  Receipt,
  Search,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { PageHeader } from '../../components/layout/PageHeader';
import { StatCard } from '../../components/ui/StatCard';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import { formatRupees } from '../../lib/financialEngine';
import {
  exportJournalTripsToExcel,
  JOURNAL_ENTRY_TYPE_LABELS,
  JOURNAL_STATUS_LABELS,
} from '../../lib/journalTripsHelpers';
import {
  deleteJournalTripInFirestore,
  fetchJournalTripSummaryStats,
  queryJournalTripsPaginated,
  type JournalTripFilterParams,
} from '../../lib/firebase/journalTripsService';
import { JournalTripFormModal } from './JournalTripFormModal';
import { JournalTripDetailModal } from './JournalTripDetailModal';
import { JournalExcelImportModal } from './JournalExcelImportModal';
import type {
  JournalEntryType,
  JournalTrip,
  JournalTripStatus,
  JournalTripSummaryStats,
  UserRole,
} from '../../types/tms';

interface TripsJournalViewProps {
  userRole: UserRole;
}

const PAGE_SIZE = 15;

export const TripsJournalView: React.FC<TripsJournalViewProps> = ({ userRole: _userRole }) => {
  const { company, vehicles, drivers, customers } = useFirestoreData();
  const companyId = company?.id || '';

  // Filters
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [entryType, setEntryType] = useState<JournalEntryType | ''>('');
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [status, setStatus] = useState<JournalTripStatus | ''>('');

  // Pagination & Data
  const [trips, setTrips] = useState<JournalTrip[]>([]);
  const [cursorStack, setCursorStack] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([
    null,
  ]);
  const [pageIndex, setPageIndex] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);

  const [stats, setStats] = useState<JournalTripSummaryStats>({
    totalTripsCount: 0,
    completedTripsCount: 0,
    cancelledTripsCount: 0,
    totalFreightRevenuePaise: 0,
    totalExpensesPaise: 0,
    totalProfitPaise: 0,
  });

  const [loading, setLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  // Modals
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<JournalTrip | null>(null);
  const [viewingTrip, setViewingTrip] = useState<JournalTrip | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [deletingTrip, setDeletingTrip] = useState<JournalTrip | null>(null);
  const [deletingLoading, setDeletingLoading] = useState(false);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const buildActiveFilters = useCallback((): JournalTripFilterParams => {
    return {
      searchQuery: debouncedSearch || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      entryType: entryType || undefined,
      vehicleId: vehicleId || undefined,
      driverId: driverId || undefined,
      status: status || undefined,
    };
  }, [debouncedSearch, startDate, endDate, entryType, vehicleId, driverId, status]);

  const loadPage = useCallback(
    async (
      targetPageIndex: number,
      afterCursor: QueryDocumentSnapshot<DocumentData> | null,
      refreshStats: boolean
    ) => {
      if (!companyId) return;
      const filters = buildActiveFilters();
      setLoading(true);
      setError(null);
      if (refreshStats) setStatsLoading(true);

      try {
        const pagePromise = queryJournalTripsPaginated(companyId, filters, {
          pageSize: PAGE_SIZE,
          afterCursor,
        });
        const statsPromise = refreshStats
          ? fetchJournalTripSummaryStats(companyId, filters)
          : Promise.resolve(null);

        const [pageRes, statsRes] = await Promise.all([pagePromise, statsPromise]);
        setTrips(pageRes.items);
        setHasMore(pageRes.hasMore);
        setNextCursor(pageRes.lastDoc);
        setPageIndex(targetPageIndex);
        if (statsRes) setStats(statsRes);
      } catch (err: any) {
        setError(err?.message || 'Failed to load Trips Journal entries.');
      } finally {
        setLoading(false);
        if (refreshStats) setStatsLoading(false);
      }
    },
    [companyId, buildActiveFilters]
  );

  // Reload from Page 0 whenever filters or company change
  useEffect(() => {
    if (!companyId) return;
    setCursorStack([null]);
    loadPage(0, null, true);
  }, [companyId, loadPage]);

  const handleNextPage = () => {
    if (!hasMore || !nextCursor || loading) return;
    const nextIdx = pageIndex + 1;
    setCursorStack((prev) => [...prev.slice(0, nextIdx), nextCursor]);
    loadPage(nextIdx, nextCursor, false);
  };

  const handlePrevPage = () => {
    if (pageIndex <= 0 || loading) return;
    const prevIdx = pageIndex - 1;
    const prevCursor = cursorStack[prevIdx] || null;
    loadPage(prevIdx, prevCursor, false);
  };

  const handleResetFilters = () => {
    setSearchInput('');
    setDebouncedSearch('');
    setStartDate('');
    setEndDate('');
    setEntryType('');
    setVehicleId('');
    setDriverId('');
    setStatus('');
  };

  const showNotice = (msg: string) => {
    setBannerMessage(msg);
    setTimeout(() => setBannerMessage(null), 4500);
  };

  const handleConfirmDelete = async () => {
    if (!companyId || !deletingTrip) return;
    setDeletingLoading(true);
    try {
      await deleteJournalTripInFirestore(companyId, deletingTrip);
      showNotice(`Deleted journal trip ${deletingTrip.journalTripId}.`);
      setDeletingTrip(null);
      setCursorStack([null]);
      await loadPage(0, null, true);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete journal trip.');
      setDeletingTrip(null);
    } finally {
      setDeletingLoading(false);
    }
  };

  const entryTypeBadgeVariant = (type: JournalEntryType) => {
    if (type === 'offline') return 'amber';
    if (type === 'manual_book') return 'blue';
    return 'indigo';
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trips Journal"
        subtitle="Permanent digital register for offline, historical, and physical-book trips — isolated from live dispatch"
        badge={<Badge variant="indigo">Historical Ledger</Badge>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportJournalTripsToExcel(trips)}
              disabled={trips.length === 0}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Excel</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setIsImportOpen(true)}>
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
              <span>Import Excel</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditingTrip(null);
                setIsFormOpen(true);
              }}
            >
              <Plus className="w-4 h-4" />
              <span>Add Journal Trip</span>
            </Button>
          </div>
        }
      />

      {bannerMessage && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs sm:text-sm font-medium">
          {bannerMessage}
        </div>
      )}

      {/* Summary Cards (Completed trips only — cancelled excluded) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Journal Trips"
          value={statsLoading ? '...' : String(stats.completedTripsCount)}
          subtitle={
            stats.cancelledTripsCount > 0
              ? `${stats.cancelledTripsCount} cancelled trip(s) excluded from totals`
              : 'Completed historical & offline records'
          }
          icon={BookOpen}
          accentColor="indigo"
        />
        <StatCard
          title="Total Freight Revenue"
          value={statsLoading ? '...' : formatRupees(stats.totalFreightRevenuePaise)}
          subtitle="Gross freight across completed entries"
          icon={IndianRupee}
          accentColor="emerald"
        />
        <StatCard
          title="Total Trip Expenses"
          value={statsLoading ? '...' : formatRupees(stats.totalExpensesPaise)}
          subtitle="Loading, fuel, toll, food & repair totals"
          icon={Receipt}
          accentColor="rose"
        />
        <StatCard
          title="Total Trip Profit"
          value={statsLoading ? '...' : formatRupees(stats.totalProfitPaise)}
          subtitle="Freight revenue minus trip expenses"
          icon={TrendingUp}
          accentColor={stats.totalProfitPaise >= 0 ? 'blue' : 'rose'}
        />
      </div>

      {/* Filters & Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider">
            <Filter className="w-4 h-4 text-indigo-600" />
            <span>Journal Search & Filters</span>
          </div>
          <button
            type="button"
            onClick={handleResetFilters}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
          >
            Reset Filters
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          <div className="xl:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Search (Trip ID, Vehicle, Driver, Customer)
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="e.g. JTR-25, WB19K4821, Ramesh..."
                className="w-full pl-8 pr-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">From Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white text-slate-900"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">To Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white text-slate-900"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Entry Type</label>
            <select
              value={entryType}
              onChange={(e) => setEntryType(e.target.value as JournalEntryType | '')}
              className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white text-slate-900"
            >
              <option value="">All Entry Types</option>
              <option value="offline">Offline Trip</option>
              <option value="historical">Historical Trip</option>
              <option value="manual_book">Manual Book Entry</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Vehicle</label>
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white text-slate-900"
            >
              <option value="">All Vehicles</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registrationNumber}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Driver / Status
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <select
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                aria-label="Filter by driver"
                className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white text-slate-900"
              >
                <option value="">Driver: All</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName}
                  </option>
                ))}
              </select>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as JournalTripStatus | '')}
                aria-label="Filter by status"
                className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white text-slate-900"
              >
                <option value="">Status: All</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between gap-3 text-xs text-rose-800">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => loadPage(pageIndex, cursorStack[pageIndex] || null, true)}>
            Retry
          </Button>
        </div>
      )}

      {/* Main Ledger Table / Cards */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {loading && trips.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs font-medium text-slate-500">Loading Trips Journal entries...</p>
          </div>
        ) : trips.length === 0 ? (
          <div className="py-16 px-4 text-center space-y-3">
            <BookOpen className="w-10 h-10 text-slate-300 mx-auto" />
            <div>
              <h3 className="text-sm font-bold text-slate-800">No Journal Trips Found</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Record completed offline trips, paper register entries, or bulk-import legacy Excel trip sheets without affecting live fleet dispatch.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setIsImportOpen(true)}>
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Import Excel</span>
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setEditingTrip(null);
                  setIsFormOpen(true);
                }}
              >
                <Plus className="w-4 h-4" />
                <span>Add Journal Trip</span>
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                    <th className="py-3 px-4">Trip ID</th>
                    <th className="py-3 px-4">Trip Date</th>
                    <th className="py-3 px-4">Vehicle Number</th>
                    <th className="py-3 px-4">Driver Name</th>
                    <th className="py-3 px-4">Customer Name</th>
                    <th className="py-3 px-4">From Location</th>
                    <th className="py-3 px-4">To Location</th>
                    <th className="py-3 px-4 text-right">Freight Amount</th>
                    <th className="py-3 px-4 text-right">Total Expenses</th>
                    <th className="py-3 px-4 text-right">Trip Profit</th>
                    <th className="py-3 px-4">Entry Type</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {trips.map((trip) => {
                    const isCancelled = trip.status === 'cancelled';
                    return (
                      <tr
                        key={trip.journalTripId}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          isCancelled ? 'opacity-70 bg-rose-50/20' : ''
                        }`}
                      >
                        <td className="py-3 px-4 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setViewingTrip(trip)}
                            className="font-mono font-bold text-indigo-700 hover:underline cursor-pointer block"
                          >
                            {trip.journalTripId}
                          </button>
                          {trip.externalReferenceNumber && (
                            <span className="text-[10px] text-slate-500 block">
                              Ref: {trip.externalReferenceNumber}
                            </span>
                          )}
                          {isCancelled && (
                            <Badge variant="danger" size="sm" className="mt-0.5">
                              {JOURNAL_STATUS_LABELS.cancelled}
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-slate-700">
                          {trip.tripDate
                            ? new Date(trip.tripDate).toLocaleDateString('en-IN')
                            : '—'}
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                          {trip.vehicleNumber}
                        </td>
                        <td className="py-3 px-4 text-slate-800">{trip.driverName}</td>
                        <td className="py-3 px-4 font-medium text-slate-800">{trip.customerName}</td>
                        <td className="py-3 px-4 text-slate-700">{trip.fromLocation}</td>
                        <td className="py-3 px-4 text-slate-700">{trip.toLocation}</td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {formatRupees(trip.freightAmountPaise)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-medium text-rose-700 tabular-nums whitespace-nowrap">
                          {formatRupees(trip.totalExpensesPaise)}
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-mono font-bold tabular-nums whitespace-nowrap ${
                            isCancelled
                              ? 'text-slate-400 line-through'
                              : trip.profitPaise >= 0
                              ? 'text-emerald-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {formatRupees(trip.profitPaise)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <Badge variant={entryTypeBadgeVariant(trip.entryType)} size="sm">
                            {JOURNAL_ENTRY_TYPE_LABELS[trip.entryType] || trip.entryType}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setViewingTrip(trip)}
                              className="p-1.5 rounded-lg text-slate-600 hover:text-indigo-700 hover:bg-indigo-50 cursor-pointer"
                              title="View details"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTrip(trip);
                                setIsFormOpen(true);
                              }}
                              className="p-1.5 rounded-lg text-slate-600 hover:text-indigo-700 hover:bg-indigo-50 cursor-pointer"
                              title="Edit journal trip"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingTrip(trip)}
                              className="p-1.5 rounded-lg text-slate-600 hover:text-rose-700 hover:bg-rose-50 cursor-pointer"
                              title="Delete journal trip"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card Layout */}
            <div className="lg:hidden divide-y divide-slate-200">
              {trips.map((trip) => {
                const isCancelled = trip.status === 'cancelled';
                return (
                  <div key={trip.journalTripId} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <button
                          type="button"
                          onClick={() => setViewingTrip(trip)}
                          className="font-mono text-xs font-bold text-indigo-700 hover:underline"
                        >
                          {trip.journalTripId}
                        </button>
                        <p className="text-xs text-slate-500">
                          {trip.tripDate ? new Date(trip.tripDate).toLocaleDateString('en-IN') : '—'} •{' '}
                          <span className="font-mono font-semibold text-slate-800">
                            {trip.vehicleNumber}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge variant={entryTypeBadgeVariant(trip.entryType)} size="sm">
                          {JOURNAL_ENTRY_TYPE_LABELS[trip.entryType]}
                        </Badge>
                        {isCancelled && (
                          <Badge variant="danger" size="sm">
                            Cancelled
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="text-xs font-semibold text-slate-900">
                      {trip.fromLocation} → {trip.toLocation}
                    </div>
                    <div className="text-xs text-slate-600">
                      Driver: <strong className="text-slate-800">{trip.driverName}</strong> • Party:{' '}
                      <strong className="text-slate-800">{trip.customerName}</strong>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                      <div>
                        <span className="text-[10px] uppercase text-slate-500 block">Freight</span>
                        <span className="font-mono font-semibold tabular-nums text-slate-900">
                          {formatRupees(trip.freightAmountPaise)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase text-slate-500 block">Expenses</span>
                        <span className="font-mono font-semibold tabular-nums text-rose-700">
                          {formatRupees(trip.totalExpensesPaise)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase text-slate-500 block">Profit</span>
                        <span
                          className={`font-mono font-bold tabular-nums ${
                            isCancelled
                              ? 'text-slate-400 line-through'
                              : trip.profitPaise >= 0
                              ? 'text-emerald-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {formatRupees(trip.profitPaise)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                      <Button variant="outline" size="sm" onClick={() => setViewingTrip(trip)}>
                        View
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingTrip(trip);
                          setIsFormOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => setDeletingTrip(trip)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination Footer */}
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
              <span>
                Showing <strong>{trips.length}</strong> record(s) on Page {pageIndex + 1}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pageIndex === 0 || loading}
                  onClick={handlePrevPage}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Previous</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!hasMore || loading}
                  onClick={handleNextPage}
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Add / Edit Modal */}
      {companyId && (
        <JournalTripFormModal
          isOpen={isFormOpen}
          onClose={() => {
            setIsFormOpen(false);
            setEditingTrip(null);
          }}
          companyId={companyId}
          vehicles={vehicles}
          drivers={drivers}
          customers={customers}
          initialTrip={editingTrip}
          onSaved={(msg) => {
            showNotice(msg);
            setCursorStack([null]);
            loadPage(0, null, true);
          }}
        />
      )}

      {/* View Detail Modal */}
      {companyId && (
        <JournalTripDetailModal
          isOpen={Boolean(viewingTrip)}
          onClose={() => setViewingTrip(null)}
          companyId={companyId}
          trip={viewingTrip}
          onEdit={(trip) => {
            setEditingTrip(trip);
            setIsFormOpen(true);
          }}
        />
      )}

      {/* Excel Bulk Import Modal */}
      {companyId && (
        <JournalExcelImportModal
          isOpen={isImportOpen}
          onClose={() => setIsImportOpen(false)}
          companyId={companyId}
          vehicles={vehicles}
          drivers={drivers}
          customers={customers}
          onImported={(count) => {
            showNotice(`Imported ${count} historical/offline trip(s) into Trips Journal.`);
            setCursorStack([null]);
            loadPage(0, null, true);
          }}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={Boolean(deletingTrip)}
        onClose={() => setDeletingTrip(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Journal Trip?"
        message={`Delete ${deletingTrip?.journalTripId || 'this record'} (${deletingTrip?.vehicleNumber || ''}: ${deletingTrip?.fromLocation || ''} → ${deletingTrip?.toLocation || ''})? This removes the historical entry and its attached documents permanently.`}
        confirmLabel="Yes, Delete Entry"
        cancelLabel="Cancel"
        variant="danger"
        isLoading={deletingLoading}
      />
    </div>
  );
};
