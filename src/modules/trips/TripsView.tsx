import React, { useState, useEffect } from 'react';
import {
  Navigation,
  Plus,
  Search,
  Filter,
  AlertTriangle,
  FileText,
  Truck,
  Users,
  Building2,
  CheckCircle2,
  Clock,
  Eye,
  Edit,
  Trash2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  MapPin,
  Calendar,
  XCircle,
  Scale,
  RotateCcw,
} from 'lucide-react';
import { Trip, Vehicle, Driver, Customer, UserRole, TripStatus } from '../../types/tms';
import { formatINR, paiseToRupees } from '../../lib/currency';
import { Badge, BadgeVariant } from '../../components/ui/Badge';
import { PageHeader } from '../../components/layout/PageHeader';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { TripModal } from './TripModal';
import { TripDetailModal } from './TripDetailModal';
import { TripStatusTransitionModal } from './TripStatusTransitionModal';
import { useAuth } from '../../context/AuthContext';
import { parseResponseJson } from '../../lib/safeFetch';
import { syncEntityToFirestore, clearCompanyTripsDataInFirestore } from '../../lib/firebase/firestoreService';

interface TripsViewProps {
  userRole: UserRole;
  localVehicles?: Vehicle[];
  localDrivers?: Driver[];
  localCustomers?: Customer[];
}

export const TripsView: React.FC<TripsViewProps> = ({
  userRole,
  localVehicles = [],
  localDrivers = [],
  localCustomers = [],
}) => {
  const { token, company } = useAuth();
  const activeToken = token || (typeof window !== 'undefined' ? localStorage.getItem('token') || '' : '');

  const [trips, setTrips] = useState<Trip[]>([]);
  const [liveCustomers, setLiveCustomers] = useState<Customer[]>(localCustomers);
  const [liveVehicles, setLiveVehicles] = useState<Vehicle[]>(localVehicles);
  const [liveDrivers, setLiveDrivers] = useState<Driver[]>(localDrivers);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sync customers live from API whenever customer is added/updated in Customers tab
  useEffect(() => {
    const fetchCustomersList = async () => {
      try {
        const res = await fetch('/api/customers?limit=100', {
          headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : {},
        });
        const data = await parseResponseJson<any>(res);
        if (res.ok && data?.success && Array.isArray(data.data)) {
          setLiveCustomers(data.data);
        }
      } catch {
        // ignore
      }
    };
    fetchCustomersList();

    const onCustomerUpdated = () => fetchCustomersList();
    window.addEventListener('tms:customer-updated', onCustomerUpdated);
    window.addEventListener('tms:firestore-hydrated', onCustomerUpdated);
    return () => {
      window.removeEventListener('tms:customer-updated', onCustomerUpdated);
      window.removeEventListener('tms:firestore-hydrated', onCustomerUpdated);
    };
  }, [activeToken, company?.id]);

  // Sync vehicles live from API whenever truck is added/updated in Vehicles tab
  useEffect(() => {
    const fetchVehiclesList = async () => {
      try {
        const res = await fetch('/api/vehicles?limit=100', {
          headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : {},
        });
        const data = await parseResponseJson<any>(res);
        if (res.ok && data?.success && Array.isArray(data.data)) {
          setLiveVehicles(data.data);
        }
      } catch {
        // ignore
      }
    };
    fetchVehiclesList();

    const onVehicleUpdated = () => fetchVehiclesList();
    window.addEventListener('tms:vehicle-updated', onVehicleUpdated);
    window.addEventListener('tms:firestore-hydrated', onVehicleUpdated);
    return () => {
      window.removeEventListener('tms:vehicle-updated', onVehicleUpdated);
      window.removeEventListener('tms:firestore-hydrated', onVehicleUpdated);
    };
  }, [activeToken, company?.id]);

  // Sync drivers live from API whenever driver is added/updated in Drivers tab
  useEffect(() => {
    const fetchDriversList = async () => {
      try {
        const res = await fetch('/api/drivers?limit=100', {
          headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : {},
        });
        const data = await parseResponseJson<any>(res);
        if (res.ok && data?.success && Array.isArray(data.data)) {
          setLiveDrivers(data.data);
        }
      } catch {
        // ignore
      }
    };
    fetchDriversList();

    const onDriverUpdated = () => fetchDriversList();
    window.addEventListener('tms:driver-updated', onDriverUpdated);
    window.addEventListener('tms:firestore-hydrated', onDriverUpdated);
    return () => {
      window.removeEventListener('tms:driver-updated', onDriverUpdated);
      window.removeEventListener('tms:firestore-hydrated', onDriverUpdated);
    };
  }, [activeToken, company?.id]);

  // Filters and Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [vehicleFilter, setVehicleFilter] = useState<string>('ALL');
  const [driverFilter, setDriverFilter] = useState<string>('ALL');
  const [customerFilter, setCustomerFilter] = useState<string>('ALL');
  const [dateFilter, setDateFilter] = useState<'ALL' | 'TODAY' | 'THIS_MONTH' | 'CUSTOM'>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Summary Metrics
  const [summary, setSummary] = useState({
    totalTrips: 0,
    activeTrips: 0,
    deliveredTrips: 0,
    totalRevenuePaise: 0,
    totalExpensesPaise: 0,
    totalContributionPaise: 0,
  });

  // Modal States
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [tripToEdit, setTripToEdit] = useState<Trip | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [tripForStatusChange, setTripForStatusChange] = useState<{ trip: Trip; targetStatus: TripStatus } | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isResetTripsDialogOpen, setIsResetTripsDialogOpen] = useState(false);
  const [resettingTrips, setResettingTrips] = useState(false);

  const handleResetTrips = async () => {
    setResettingTrips(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;

      const res = await fetch('/api/trips/reset', { method: 'POST', headers });
      const data = await parseResponseJson<any>(res);
      if (!res.ok || !data || !data.success) {
        throw new Error(data?.error || 'Failed to reset trips.');
      }
      await clearCompanyTripsDataInFirestore(company?.id, data.vehicles || [], data.drivers || []);
      window.dispatchEvent(new CustomEvent('tms:trip-updated'));
      window.dispatchEvent(new CustomEvent('tms:vehicle-updated'));
      window.dispatchEvent(new CustomEvent('tms:driver-updated'));
      showNotification('All trips have been reset. Fleet is clean and ready for user dispatches.');
      setIsResetTripsDialogOpen(false);
      fetchTrips(1);
    } catch (err: any) {
      showNotification(err.message || 'Error resetting trips', 'error');
    } finally {
      setResettingTrips(false);
    }
  };

  const fetchTrips = async (targetPage = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: targetPage.toString(),
        limit: limit.toString(),
      });

      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (vehicleFilter !== 'ALL') params.append('vehicleId', vehicleFilter);
      if (driverFilter !== 'ALL') params.append('driverId', driverFilter);
      if (customerFilter !== 'ALL') params.append('customerId', customerFilter);
      if (dateFilter !== 'ALL') params.append('dateFilter', dateFilter);
      if (dateFilter === 'CUSTOM' && startDate && endDate) {
        params.append('startDate', startDate);
        params.append('endDate', endDate);
      }

      const headers: Record<string, string> = {};
      if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;

      const res = await fetch(`/api/trips?${params.toString()}`, { headers });
      const data = await parseResponseJson<any>(res);
      if (!res.ok || !data || !data.success) {
        throw new Error(data?.error || 'Failed to load trips from company database.');
      }

      setTrips(data.data || []);
      setPage(data.pagination.page);
      setTotalPages(data.pagination.totalPages);
      setTotalCount(data.pagination.total);
      if (data.summary) setSummary(data.summary);
    } catch (err: any) {
      setError(err.message || 'Error communicating with fleet trip API.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrips(1);
  }, [statusFilter, vehicleFilter, driverFilter, customerFilter, dateFilter, activeToken, company?.id]);

  useEffect(() => {
    const onTripsSync = () => fetchTrips(1);
    window.addEventListener('tms:firestore-hydrated', onTripsSync);
    window.addEventListener('tms:trip-updated', onTripsSync);
    return () => {
      window.removeEventListener('tms:firestore-hydrated', onTripsSync);
      window.removeEventListener('tms:trip-updated', onTripsSync);
    };
  }, [activeToken, company?.id]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchTrips(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, startDate, endDate]);

  const showNotification = (text: string, type: 'success' | 'error' = 'success') => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 3500);
  };

  const handleModalSuccess = (savedTrip: Trip, isEdit: boolean) => {
    showNotification(
      isEdit
        ? `Trip ${savedTrip.tripNumber} updated successfully.`
        : `Trip ${savedTrip.tripNumber} booked (LR: ${savedTrip.lrNumber}).`,
      'success'
    );
    fetchTrips(isEdit ? page : 1);
  };

  const getStatusBadge = (status: TripStatus): { variant: BadgeVariant; label: string } => {
    switch (status) {
      case 'PLANNED':
        return { variant: 'slate', label: 'Planned' };
      case 'DISPATCHED':
        return { variant: 'info', label: 'Dispatched' };
      case 'IN_TRANSIT':
        return { variant: 'purple', label: 'In Transit' };
      case 'DELIVERED':
        return { variant: 'warning', label: 'Delivered' };
      case 'COMPLETED':
      case 'SETTLED':
        return { variant: 'success', label: 'Completed' };
      case 'CANCELLED':
        return { variant: 'danger', label: 'Cancelled' };
      default:
        return { variant: 'slate', label: status };
    }
  };

  const handleStatusTransitionConfirm = async (transitionData: {
    targetStatus: TripStatus;
    cancellationReason?: string;
    actualDeliveryDate?: string;
    endOdometerKm?: number;
    podReceived?: boolean;
    podRemarks?: string;
  }) => {
    if (!tripForStatusChange) return;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;

      const res = await fetch(`/api/trips/${tripForStatusChange.trip.id}/status`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          status: transitionData.targetStatus,
          cancellationReason: transitionData.cancellationReason,
          actualDeliveryDate: transitionData.actualDeliveryDate,
          endOdometerKm: transitionData.endOdometerKm,
          podReceived: transitionData.podReceived,
          podRemarks: transitionData.podRemarks,
        }),
      });

      const json = await parseResponseJson<any>(res);
      if (!res.ok || !json || !json.success) {
        throw new Error(json?.error || 'Failed to advance trip status.');
      }

      await Promise.all([
        syncEntityToFirestore(company?.id, 'trips', json.trip),
        syncEntityToFirestore(company?.id, 'vehicles', json.vehicle),
        syncEntityToFirestore(company?.id, 'drivers', json.driver),
      ]);
      window.dispatchEvent(new CustomEvent('tms:trip-updated'));
      window.dispatchEvent(new CustomEvent('tms:vehicle-updated'));
      window.dispatchEvent(new CustomEvent('tms:driver-updated'));

      showNotification(`Trip ${tripForStatusChange.trip.tripNumber} is now ${transitionData.targetStatus}.`);
      setTripForStatusChange(null);
      fetchTrips(page);
    } catch (err: any) {
      showNotification(err.message || 'Status transition failed.', 'error');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto antialiased">
      {/* Toast Notification */}
      {actionMsg && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl shadow-xl text-xs sm:text-sm font-medium flex items-center gap-2 border animate-in fade-in slide-in-from-top-4 duration-200 ${
            actionMsg.type === 'success'
              ? 'bg-slate-900 text-white border-slate-700'
              : 'bg-rose-900 text-white border-rose-700'
          }`}
        >
          {actionMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400" />
          )}
          <span>{actionMsg.text}</span>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        title="Commercial Trips & Dispatch Console"
        subtitle="Manage company-owned truck dispatches, route execution, cargo bills, live contribution, and POD delivery receipts"
        actions={
          <div className="flex items-center gap-2">
            {(userRole === 'OWNER' || userRole === 'ADMIN' || userRole === 'MANAGER') && (
              <button
                onClick={() => setIsResetTripsDialogOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                title="Reset all trips and clear data until new dispatches are created"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                <span>Reset Trips</span>
              </button>
            )}
            <button
              onClick={() => setIsCreateOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Dispatch New Trip</span>
            </button>
          </div>
        }
      />

      {/* KPI Highlight Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Active On-Road</span>
          <span className="font-bold text-indigo-700 text-xl block mt-0.5">{summary.activeTrips}</span>
          <span className="text-[11px] text-slate-400">In Transit or Dispatched</span>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Delivered / Done</span>
          <span className="font-bold text-emerald-700 text-xl block mt-0.5">{summary.deliveredTrips}</span>
          <span className="text-[11px] text-slate-400">Safely Reached Destination</span>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Total Freight Revenue</span>
          <span className="font-bold text-slate-900 text-xl block mt-0.5">{formatINR(summary.totalRevenuePaise)}</span>
          <span className="text-[11px] text-slate-400">Across {summary.totalTrips} booked trips</span>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Recorded Expenses</span>
          <span className="font-bold text-rose-700 text-xl block mt-0.5">{formatINR(summary.totalExpensesPaise)}</span>
          <span className="text-[11px] text-slate-400">Diesel, toll & loading</span>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-emerald-200 shadow-2xs bg-emerald-50/20">
          <span className="text-[10px] font-semibold text-emerald-800 uppercase tracking-wider block">Net Trip Contribution</span>
          <span className="font-bold text-emerald-900 text-xl block mt-0.5">{formatINR(summary.totalContributionPaise)}</span>
          <span className="text-[11px] text-emerald-700">Gross operational margin</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Trip No, LR No, Vehicle, Driver, Customer, Route..."
              className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-indigo-500 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
              >
                Clear
              </button>
            )}
          </div>

          {/* Quick Refresh */}
          <button
            onClick={() => fetchTrips(page)}
            title="Refresh trips"
            className="p-2 border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 transition-colors shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Filter Pills & Dropdowns */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
          <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider mr-1">Status:</span>
          {['ALL', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'PLANNED', 'CANCELLED'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                statusFilter === st
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st === 'ALL' ? 'All Trips' : st.replace('_', ' ')}
            </button>
          ))}

          {/* Date Filter */}
          <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider ml-2 mr-1">Period:</span>
          {[
            { id: 'ALL', label: 'All Time' },
            { id: 'TODAY', label: 'Today' },
            { id: 'THIS_MONTH', label: 'This Month' },
            { id: 'CUSTOM', label: 'Custom Range' },
          ].map((df) => (
            <button
              key={df.id}
              onClick={() => setDateFilter(df.id as any)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                dateFilter === df.id
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {df.label}
            </button>
          ))}
        </div>

        {/* Custom Date Range Picker */}
        {dateFilter === 'CUSTOM' && (
          <div className="flex items-center gap-3 pt-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-medium">From:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-2.5 py-1 border border-slate-300 rounded-lg text-xs"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-medium">To:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-2.5 py-1 border border-slate-300 rounded-lg text-xs"
              />
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-medium">Loading commercial trip dispatches...</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-rose-200 p-8 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
          <p className="text-sm font-semibold text-slate-800">{error}</p>
          <button
            onClick={() => fetchTrips(1)}
            className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800"
          >
            Retry Connection
          </button>
        </div>
      ) : trips.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mx-auto">
            <Navigation className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto">
            <h4 className="text-base font-bold text-slate-900">No trips found</h4>
            <p className="text-xs text-slate-500 mt-1">
              {searchQuery || statusFilter !== 'ALL' || dateFilter !== 'ALL'
                ? 'No trips match your active filters. Try resetting search parameters.'
                : 'No commercial trips have been booked yet. Dispatch your first trip with an assigned truck and driver.'}
            </p>
          </div>
          {searchQuery || statusFilter !== 'ALL' || dateFilter !== 'ALL' ? (
            <button
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('ALL');
                setVehicleFilter('ALL');
                setDriverFilter('ALL');
                setCustomerFilter('ALL');
                setDateFilter('ALL');
              }}
              className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Reset Filters
            </button>
          ) : (
            <button
              onClick={() => setIsCreateOpen(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs"
            >
              Dispatch First Trip
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col">
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Trip & LR No.</th>
                  <th className="py-3 px-4">Customer & Route</th>
                  <th className="py-3 px-4">Assigned Fleet</th>
                  <th className="py-3 px-4">Freight Revenue</th>
                  <th className="py-3 px-4">Trip Contribution</th>
                  <th className="py-3 px-4">Dispatch Date</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {trips.map((t) => {
                  const status = getStatusBadge(t.status);
                  const marginPercent =
                    t.totalRevenuePaise > 0
                      ? Math.round((t.tripContributionPaise / t.totalRevenuePaise) * 100)
                      : 0;

                  return (
                    <tr key={t.id} className="hover:bg-slate-50/70 transition-colors group">
                      <td className="py-3.5 px-4">
                        <button
                          onClick={() => setSelectedTripId(t.id)}
                          className="font-mono font-bold text-slate-900 hover:text-indigo-600 text-left block"
                        >
                          {t.tripNumber}
                        </button>
                        <span className="font-mono text-[11px] text-indigo-700 block">LR: {t.lrNumber}</span>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className="font-bold text-slate-900 block truncate max-w-[170px]">{t.customerName}</span>
                        <span className="text-slate-500 flex items-center gap-1 text-[11px]">
                          {t.originCity} → {t.destinationCity}
                        </span>
                        <span className="text-slate-400 text-[10px]">
                          {t.goodsType} ({t.weightTonnes}T)
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className="font-mono font-semibold text-slate-800 block">{t.vehicleReg}</span>
                        <span className="text-slate-500 text-[11px]">{t.driverName}</span>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className="font-bold text-slate-900 block">{formatINR(t.totalRevenuePaise)}</span>
                        <span className="text-slate-400 text-[10px]">
                          ₹{paiseToRupees(t.ratePerTonnePaise)}/T
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`font-bold block ${
                            t.tripContributionPaise >= 0 ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {formatINR(t.tripContributionPaise)}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {marginPercent}% margin • Exp: {formatINR(t.totalExpensesPaise)}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-slate-600">
                        <span>{t.dispatchDate}</span>
                        {t.podReceived && (
                          <span className="text-emerald-600 font-medium block text-[10px]">✓ POD Received</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <Badge variant={status.variant} dot>
                          {status.label}
                        </Badge>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-90 group-hover:opacity-100">
                          <button
                            onClick={() => setSelectedTripId(t.id)}
                            title="View Full Trip Dossier"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {!['COMPLETED', 'CANCELLED'].includes(t.status) && (
                            <button
                              onClick={() => setTripToEdit(t)}
                              title="Edit Trip Details"
                              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                          )}
                          {/* Quick advance status button */}
                          {t.status === 'PLANNED' && (
                            <button
                              onClick={() => setTripForStatusChange({ trip: t, targetStatus: 'DISPATCHED' })}
                              title="Dispatch Now"
                              className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-[10px] font-semibold hover:bg-indigo-100 transition-colors"
                            >
                              Dispatch
                            </button>
                          )}
                          {t.status === 'DISPATCHED' && (
                            <button
                              onClick={() => setTripForStatusChange({ trip: t, targetStatus: 'IN_TRANSIT' })}
                              title="Mark In Transit"
                              className="px-2 py-1 bg-purple-50 text-purple-700 rounded-lg text-[10px] font-semibold hover:bg-purple-100 transition-colors"
                            >
                              En Route
                            </button>
                          )}
                          {t.status === 'IN_TRANSIT' && (
                            <button
                              onClick={() => setTripForStatusChange({ trip: t, targetStatus: 'DELIVERED' })}
                              title="Mark Delivered"
                              className="px-2 py-1 bg-amber-50 text-amber-700 rounded-lg text-[10px] font-semibold hover:bg-amber-100 transition-colors"
                            >
                              Deliver
                            </button>
                          )}
                          {t.status === 'DELIVERED' && (
                            <button
                              onClick={() => setTripForStatusChange({ trip: t, targetStatus: 'COMPLETED' })}
                              title="Complete Trip"
                              className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-[10px] font-semibold hover:bg-emerald-100 transition-colors"
                            >
                              Complete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden divide-y divide-slate-100">
            {trips.map((t) => {
              const status = getStatusBadge(t.status);
              return (
                <div key={t.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <button
                        onClick={() => setSelectedTripId(t.id)}
                        className="font-mono font-bold text-slate-900 text-sm hover:text-indigo-600 text-left"
                      >
                        {t.tripNumber}
                      </button>
                      <span className="font-mono text-xs text-indigo-700 block">LR: {t.lrNumber}</span>
                      <span className="text-xs font-semibold text-slate-800 block mt-0.5">{t.customerName}</span>
                    </div>
                    <Badge variant={status.variant} dot>
                      {status.label}
                    </Badge>
                  </div>

                  <div className="text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100 space-y-1.5">
                    <div className="flex items-center justify-between text-slate-700 font-medium">
                      <span>{t.originCity} → {t.destinationCity}</span>
                      <span className="font-mono font-bold text-slate-900">{t.vehicleReg}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-500 text-[11px]">
                      <span>Driver: {t.driverName}</span>
                      <span>{t.weightTonnes}T • {t.goodsType}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 text-xs">
                    <div>
                      <span className="text-slate-400 text-[10px] uppercase block">Freight Revenue</span>
                      <span className="font-bold text-slate-900 text-sm">{formatINR(t.totalRevenuePaise)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-slate-400 text-[10px] uppercase block">Contribution</span>
                      <span className="font-bold text-emerald-700 text-sm">{formatINR(t.tripContributionPaise)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    <button
                      onClick={() => setSelectedTripId(t.id)}
                      className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium"
                    >
                      Dossier
                    </button>
                    {!['COMPLETED', 'CANCELLED'].includes(t.status) && (
                      <button
                        onClick={() => setTripToEdit(t)}
                        className="px-3 py-1 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination Footer */}
          <div className="p-3.5 bg-slate-50/70 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <div>
              Showing <span className="font-semibold text-slate-700">{trips.length}</span> of{' '}
              <span className="font-semibold text-slate-700">{totalCount}</span> trips
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => fetchTrips(page - 1)}
                disabled={page <= 1}
                className="p-1.5 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed text-slate-700"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="px-2 font-medium">
                Page {page} of {totalPages}
              </span>

              <button
                onClick={() => fetchTrips(page + 1)}
                disabled={page >= totalPages}
                className="p-1.5 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed text-slate-700"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Booking / Edit Modal */}
      {isCreateOpen && (
        <TripModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onSuccess={handleModalSuccess}
          localVehicles={liveVehicles}
          localDrivers={liveDrivers}
          localCustomers={liveCustomers}
        />
      )}

      {tripToEdit && (
        <TripModal
          isOpen={Boolean(tripToEdit)}
          onClose={() => setTripToEdit(null)}
          tripToEdit={tripToEdit}
          onSuccess={handleModalSuccess}
          localVehicles={liveVehicles}
          localDrivers={liveDrivers}
          localCustomers={liveCustomers}
        />
      )}

      {/* Full Trip Dossier Modal */}
      {selectedTripId && (
        <TripDetailModal
          isOpen={Boolean(selectedTripId)}
          onClose={() => setSelectedTripId(null)}
          tripId={selectedTripId}
          onTripUpdated={() => fetchTrips(page)}
          userRole={userRole}
        />
      )}

      {/* Quick Status Transition Dialog */}
      {tripForStatusChange && (
        <TripStatusTransitionModal
          isOpen={Boolean(tripForStatusChange)}
          onClose={() => setTripForStatusChange(null)}
          trip={tripForStatusChange.trip}
          targetStatus={tripForStatusChange.targetStatus}
          onConfirm={handleStatusTransitionConfirm}
        />
      )}

      {/* Reset Trips Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isResetTripsDialogOpen}
        onClose={() => setIsResetTripsDialogOpen(false)}
        onConfirm={handleResetTrips}
        title="Reset All Commercial Trips"
        message="Are you sure you want to reset all commercial trips? This will clear all trip dispatches, related trip expenses, and driver advances, and return assigned trucks and drivers back to Available status. New data will only be added after you dispatch new trips."
        confirmLabel={resettingTrips ? 'Resetting...' : 'Reset All Trips'}
        cancelLabel="Keep Current Trips"
        variant="danger"
      />
    </div>
  );
};
