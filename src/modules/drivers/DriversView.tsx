import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  Search,
  Filter,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Edit,
  Trash2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Lock,
  Phone,
  Truck,
} from 'lucide-react';
import { Driver, Vehicle, UserRole, DriverStatus } from '../../types/tms';
import { formatINR } from '../../lib/currency';
import { Badge, BadgeVariant } from '../../components/ui/Badge';
import { PageHeader } from '../../components/layout/PageHeader';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DriverModal } from './DriverModal';
import { DriverDetailModal } from './DriverDetailModal';
import { useAuth } from '../../context/AuthContext';
import { parseResponseJson } from '../../lib/safeFetch';
import { deleteEntityFromFirestore } from '../../lib/firebase/firestoreService';

interface DriversViewProps {
  userRole: UserRole;
  localVehicles?: Vehicle[];
}

export const DriversView: React.FC<DriversViewProps> = ({ userRole, localVehicles = [] }) => {
  const { token, company } = useAuth();
  const activeToken = token || (typeof window !== 'undefined' ? (localStorage.getItem('token') || '') : '');

  // Data states
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>(localVehicles);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [licenseFilter, setLicenseFilter] = useState<string>('ALL');

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(8);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [driverToEdit, setDriverToEdit] = useState<Driver | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [driverToDelete, setDriverToDelete] = useState<Driver | null>(null);

  const fetchVehicles = async () => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;
      const res = await fetch('/api/vehicles?limit=100', { headers });
      const data = await parseResponseJson<any>(res);
      if (data && data.success && data.data) {
        setVehicles(data.data);
      }
    } catch {
      // ignore
    }
  };

  const fetchDrivers = async (targetPage = page) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: targetPage.toString(),
        limit: limit.toString(),
        search: searchQuery,
        status: statusFilter,
        licenseFilter: licenseFilter,
      });

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;

      const res = await fetch(`/api/drivers?${params.toString()}`, { headers });
      const data = await parseResponseJson<any>(res);

      if (!res.ok || !data || !data.success) {
        throw new Error(data?.error || 'Failed to fetch driver records.');
      }

      setDrivers(data.data || []);
      setPage(data.pagination.page);
      setTotalPages(data.pagination.totalPages || 1);
      setTotalCount(data.pagination.total || 0);
    } catch (err: any) {
      console.warn('Drivers fetch notice:', err);
      setError(err.message || 'Unable to load company drivers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDrivers(1);
    fetchVehicles();
  }, [searchQuery, statusFilter, licenseFilter, limit, company?.id, activeToken]);

  useEffect(() => {
    const onVehicleUpdated = () => fetchVehicles();
    const onHydrated = () => {
      fetchDrivers(1);
      fetchVehicles();
    };
    window.addEventListener('tms:vehicle-updated', onVehicleUpdated);
    window.addEventListener('tms:firestore-hydrated', onHydrated);
    return () => {
      window.removeEventListener('tms:vehicle-updated', onVehicleUpdated);
      window.removeEventListener('tms:firestore-hydrated', onHydrated);
    };
  }, [company?.id, activeToken]);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    setPage(newPage);
    fetchDrivers(newPage);
  };

  const showNotification = (text: string, type: 'success' | 'error' = 'success') => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 3500);
  };

  const handleModalSuccess = (driver: Driver, isEdit: boolean) => {
    showNotification(
      isEdit ? `Driver ${driver.fullName} updated successfully.` : `Driver ${driver.fullName} onboarded to company directory.`,
      'success'
    );
    fetchDrivers(isEdit ? page : 1);
    // Broadcast event across modules
    window.dispatchEvent(new CustomEvent('tms:driver-updated'));
  };

  const confirmDeleteDriver = async () => {
    if (!driverToDelete) return;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;

      const res = await fetch(`/api/drivers/${driverToDelete.id}`, {
        method: 'DELETE',
        headers,
      });

      const data = await parseResponseJson<any>(res);
      if (!res.ok || !data || !data.success) {
        throw new Error(data?.error || 'Failed to delete driver.');
      }

      await deleteEntityFromFirestore(company?.id, 'drivers', driverToDelete.id);
      showNotification(`Driver ${driverToDelete.fullName} removed from company directory.`);
      setDriverToDelete(null);
      fetchDrivers(page);
      // Broadcast event across modules
      window.dispatchEvent(new CustomEvent('tms:driver-updated'));
    } catch (err: any) {
      showNotification(err.message || 'Error deleting driver.', 'error');
    }
  };

  const getStatusBadge = (status: Driver['status']): { variant: BadgeVariant; label: string } => {
    switch (status) {
      case 'AVAILABLE':
        return { variant: 'success', label: 'Available' };
      case 'ON_TRIP':
        return { variant: 'purple', label: 'On Trip' };
      case 'ON_LEAVE':
        return { variant: 'warning', label: 'On Leave' };
      case 'INACTIVE':
        return { variant: 'slate', label: 'Inactive' };
      default:
        return { variant: 'slate', label: status };
    }
  };

  const getLicenseValidityBadge = (expiry: string) => {
    const today = new Date().toISOString().split('T')[0];
    const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    if (expiry < today) {
      return { variant: 'danger' as BadgeVariant, label: 'DL Expired' };
    }
    if (expiry <= thirtyDays) {
      return { variant: 'amber' as BadgeVariant, label: 'Renewal Due' };
    }
    return { variant: 'success' as BadgeVariant, label: 'Valid DL' };
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
        title="Driver Directory & Advances"
        subtitle="Manage licensed commercial truck drivers, daily bata rates, cash advance balances, and KYC credentials"
        actions={
          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Onboard Driver</span>
          </button>
        }
      />

      {/* Controls Bar: Search & Status Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Driver Name, Mobile Phone (+91), or License Number..."
              className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm border border-slate-300 rounded-xl bg-slate-50/50 text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-hidden focus:border-indigo-500 transition-colors"
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

          <button
            onClick={() => fetchDrivers(page)}
            title="Refresh driver list"
            className="p-2 border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 transition-colors shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
          <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider mr-1">Status:</span>
          {['ALL', 'AVAILABLE', 'ON_TRIP', 'ON_LEAVE', 'INACTIVE'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === st
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st === 'ALL' ? 'All Drivers' : st.replace('_', ' ')}
            </button>
          ))}

          <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider ml-2 mr-1">DL Expiry:</span>
          {[
            { id: 'ALL', label: 'All Licenses' },
            { id: 'EXPIRING_SOON', label: 'Expiring in 30d' },
            { id: 'EXPIRED', label: 'Expired Alert' },
          ].map((lf) => (
            <button
              key={lf.id}
              onClick={() => setLicenseFilter(lf.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                licenseFilter === lf.id
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {lf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Table / Grid */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-medium">Loading driver directory...</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-rose-200 p-8 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
          <p className="text-sm font-semibold text-slate-800">{error}</p>
          <button
            onClick={() => fetchDrivers(1)}
            className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800"
          >
            Retry Connection
          </button>
        </div>
      ) : drivers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mx-auto">
            <Users className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto">
            <h4 className="text-base font-bold text-slate-900">No driver records found</h4>
            <p className="text-xs text-slate-500 mt-1">
              {searchQuery || statusFilter !== 'ALL' || licenseFilter !== 'ALL'
                ? 'No drivers match your search query or status filter. Try clearing your filters.'
                : 'No commercial drivers onboarded yet. Add your first driver to enable trip dispatching.'}
            </p>
          </div>
          {searchQuery || statusFilter !== 'ALL' || licenseFilter !== 'ALL' ? (
            <button
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('ALL');
                setLicenseFilter('ALL');
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
              Onboard First Driver
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
                  <th className="py-3 px-4">Driver Name & Contact</th>
                  <th className="py-3 px-4">Driving License</th>
                  <th className="py-3 px-4">Assigned Truck</th>
                  <th className="py-3 px-4">Daily Bata</th>
                  <th className="py-3 px-4">Cash Advance</th>
                  <th className="py-3 px-4">License Status</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {drivers.map((d) => {
                  const status = getStatusBadge(d.status);
                  const dlBadge = getLicenseValidityBadge(d.licenseExpiry);
                  return (
                    <tr key={d.id} className="hover:bg-slate-50/80 transition-colors group">
                      <td className="py-3.5 px-4">
                        <button
                          onClick={() => setSelectedDriverId(d.id)}
                          className="font-bold text-slate-900 text-sm hover:text-indigo-600 hover:underline text-left block cursor-pointer"
                        >
                          {d.fullName}
                        </button>
                        <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1">
                          <Phone className="w-3 h-3 text-slate-400" />
                          <span>{d.phone}</span>
                        </span>
                      </td>

                      <td className="py-3.5 px-4 font-mono">
                        <span className="font-semibold text-slate-900 block">{d.licenseNumber}</span>
                        <span className="text-[10px] text-slate-500">Exp: {d.licenseExpiry}</span>
                      </td>

                      <td className="py-3.5 px-4 font-mono font-semibold">
                        {d.assignedVehicleReg ? (
                          <span className="text-slate-900">{d.assignedVehicleReg}</span>
                        ) : (
                          <span className="text-slate-400 italic font-sans font-normal">None</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 font-medium text-slate-800">
                        {formatINR(d.perDayBataPaise)}/day
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`font-bold ${
                            d.currentAdvanceBalancePaise > 0 ? 'text-amber-600' : 'text-slate-900'
                          }`}
                        >
                          {formatINR(d.currentAdvanceBalancePaise)}
                        </span>
                        {d.currentAdvanceBalancePaise > 0 && (
                          <span className="block text-[10px] text-amber-600">Surplus cash</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <Badge variant={dlBadge.variant} dot>
                          {dlBadge.label}
                        </Badge>
                      </td>

                      <td className="py-3.5 px-4">
                        <Badge variant={status.variant} dot>
                          {status.label}
                        </Badge>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-90 group-hover:opacity-100">
                          <button
                            onClick={() => setSelectedDriverId(d.id)}
                            title="Inspect Driver Dossier"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDriverToEdit(d)}
                            title="Edit Driver Profile"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          {(userRole === 'OWNER' || userRole === 'ADMIN') && (
                            <button
                              onClick={() => setDriverToDelete(d)}
                              title="Delete Driver"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
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
            {drivers.map((d) => {
              const status = getStatusBadge(d.status);
              const dlBadge = getLicenseValidityBadge(d.licenseExpiry);
              return (
                <div key={d.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <button
                        onClick={() => setSelectedDriverId(d.id)}
                        className="font-bold text-slate-900 text-sm hover:text-indigo-600 text-left block"
                      >
                        {d.fullName}
                      </button>
                      <span className="text-xs text-slate-500 font-mono">{d.phone}</span>
                      <span className="text-[11px] text-slate-400 font-mono block">DL: {d.licenseNumber}</span>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={status.variant} dot>
                        {status.label}
                      </Badge>
                      <Badge variant={dlBadge.variant}>{dlBadge.label}</Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                    <div>
                      <span className="text-slate-400 text-[10px] uppercase block">Assigned Truck</span>
                      <span className="font-mono font-semibold text-slate-800">
                        {d.assignedVehicleReg || 'None'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] uppercase block">Cash Advance</span>
                      <span className="font-semibold text-slate-800">{formatINR(d.currentAdvanceBalancePaise)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] uppercase block">Daily Bata</span>
                      <span className="font-semibold text-slate-800">{formatINR(d.perDayBataPaise)}/d</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] uppercase block">Trips Completed</span>
                      <span className="font-semibold text-slate-800">{d.totalTripsCompleted || 0}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      onClick={() => setSelectedDriverId(d.id)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-lg"
                    >
                      Inspect
                    </button>
                    <button
                      onClick={() => setDriverToEdit(d)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg"
                    >
                      Edit
                    </button>
                    {(userRole === 'OWNER' || userRole === 'ADMIN') && (
                      <button
                        onClick={() => setDriverToDelete(d)}
                        className="px-2.5 py-1.5 text-xs font-semibold text-rose-600 bg-rose-50 rounded-lg"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination Bar */}
          <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <div>
              Showing <span className="font-semibold text-slate-900">{drivers.length}</span> of{' '}
              <span className="font-semibold text-slate-900">{totalCount}</span> drivers
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400">Rows per page:</span>
              <select
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value, 10))}
                className="border border-slate-300 rounded p-1 bg-white text-slate-800 text-xs"
              >
                <option value={8}>8</option>
                <option value={15}>15</option>
                <option value={25}>25</option>
              </select>

              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page <= 1}
                  className="p-1.5 rounded border border-slate-300 hover:bg-white disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="px-2 font-medium text-slate-700">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded border border-slate-300 hover:bg-white disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Driver Create Modal */}
      {isCreateOpen && (
        <DriverModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onSuccess={handleModalSuccess}
          vehicles={vehicles}
          token={activeToken}
          userRole={userRole}
        />
      )}

      {/* Driver Edit Modal */}
      {driverToEdit && (
        <DriverModal
          isOpen={Boolean(driverToEdit)}
          onClose={() => setDriverToEdit(null)}
          onSuccess={handleModalSuccess}
          driverToEdit={driverToEdit}
          vehicles={vehicles}
          token={activeToken}
          userRole={userRole}
        />
      )}

      {/* Driver Detail Inspector Modal */}
      {selectedDriverId && (
        <DriverDetailModal
          isOpen={Boolean(selectedDriverId)}
          onClose={() => setSelectedDriverId(null)}
          driverId={selectedDriverId}
          token={activeToken}
          userRole={userRole}
          onEdit={(drv) => {
            setSelectedDriverId(null);
            setDriverToEdit(drv);
          }}
          onDelete={(drv) => {
            setSelectedDriverId(null);
            setDriverToDelete(drv);
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {driverToDelete && (
        <ConfirmDialog
          isOpen={Boolean(driverToDelete)}
          title={`Remove Driver ${driverToDelete.fullName}?`}
          message={`Are you sure you want to remove ${driverToDelete.fullName} (DL: ${driverToDelete.licenseNumber}) from your company directory? This action cannot be undone.`}
          confirmLabel="Delete Driver"
          variant="danger"
          onConfirm={confirmDeleteDriver}
          onClose={() => setDriverToDelete(null)}
        />
      )}
    </div>
  );
};
