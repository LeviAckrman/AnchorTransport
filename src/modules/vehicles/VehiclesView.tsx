import React, { useState, useEffect } from 'react';
import {
  Truck,
  Plus,
  Search,
  Filter,
  AlertTriangle,
  FileText,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Eye,
  Edit,
  Trash2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { Vehicle, Driver, UserRole, VehicleStatus, VehicleType } from '../../types/tms';
import { formatINR } from '../../lib/currency';
import { Badge, BadgeVariant } from '../../components/ui/Badge';
import { PageHeader } from '../../components/layout/PageHeader';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { VehicleModal } from './VehicleModal';
import { VehicleDetailModal } from './VehicleDetailModal';
import { useAuth } from '../../context/AuthContext';
import { parseResponseJson } from '../../lib/safeFetch';

interface VehiclesViewProps {
  userRole: UserRole;
  localDrivers?: Driver[];
}

export const VehiclesView: React.FC<VehiclesViewProps> = ({ userRole, localDrivers = [] }) => {
  const { token, company } = useAuth();
  const activeToken = token || (typeof window !== 'undefined' ? (localStorage.getItem('token') || '') : '');

  // Data state
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>(localDrivers);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [docFilter, setDocFilter] = useState<string>('ALL');

  // Pagination states
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(8);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [vehicleToEdit, setVehicleToEdit] = useState<Vehicle | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [vehicleToDelete, setVehicleToDelete] = useState<Vehicle | null>(null);

  const fetchDrivers = async () => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;
      const res = await fetch('/api/drivers?limit=100', { headers });
      const data = await parseResponseJson<any>(res);
      if (data && data.success && data.data) {
        setDrivers(data.data);
      }
    } catch {
      // ignore
    }
  };

  const fetchVehicles = async (targetPage = page) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: targetPage.toString(),
        limit: limit.toString(),
        search: searchQuery,
        status: statusFilter,
        vehicleType: typeFilter,
        docStatus: docFilter,
      });

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;

      const res = await fetch(`/api/vehicles?${params.toString()}`, { headers });
      const data = await parseResponseJson<any>(res);

      if (!res.ok || !data || !data.success) {
        throw new Error(data?.error || 'Failed to fetch vehicles.');
      }

      setVehicles(data.data || []);
      setPage(data.pagination.page);
      setTotalPages(data.pagination.totalPages || 1);
      setTotalCount(data.pagination.total || 0);
    } catch (err: any) {
      console.warn('Vehicles fetch notice:', err);
      setError(err.message || 'Unable to load company vehicles.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVehicles(1);
    fetchDrivers();
  }, [searchQuery, statusFilter, typeFilter, docFilter, limit, company?.id]);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    setPage(newPage);
    fetchVehicles(newPage);
  };

  const showNotification = (text: string, type: 'success' | 'error' = 'success') => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 3500);
  };

  const handleModalSuccess = (vehicle: Vehicle, isEdit: boolean) => {
    showNotification(
      isEdit ? `Vehicle ${vehicle.registrationNumber} updated successfully.` : `Truck ${vehicle.registrationNumber} added to company fleet.`,
      'success'
    );
    fetchVehicles(isEdit ? page : 1);
  };

  const confirmDeleteVehicle = async () => {
    if (!vehicleToDelete) return;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;

      const res = await fetch(`/api/vehicles/${vehicleToDelete.id}`, {
        method: 'DELETE',
        headers,
      });

      const data = await parseResponseJson<any>(res);
      if (!res.ok || !data || !data.success) {
        throw new Error(data?.error || 'Failed to delete vehicle.');
      }

      showNotification(`Vehicle ${vehicleToDelete.registrationNumber} removed from company fleet.`);
      setVehicleToDelete(null);
      fetchVehicles(page);
    } catch (err: any) {
      showNotification(err.message || 'Error deleting vehicle.', 'error');
    }
  };

  const getStatusBadge = (status: Vehicle['status']): { variant: BadgeVariant; label: string } => {
    switch (status) {
      case 'AVAILABLE':
        return { variant: 'success', label: 'Available' };
      case 'IN_TRANSIT':
        return { variant: 'purple', label: 'In Transit' };
      case 'UNDER_MAINTENANCE':
        return { variant: 'warning', label: 'Maintenance' };
      case 'INACTIVE':
        return { variant: 'slate', label: 'Inactive' };
      default:
        return { variant: 'slate', label: status };
    }
  };

  const getComplianceFlag = (v: Vehicle) => {
    const today = new Date().toISOString().split('T')[0];
    const isExpired = (d?: string) => Boolean(d && d < today);
    const isSoon = (d?: string) => {
      if (!d || d < today) return false;
      const days = Math.ceil((new Date(d).getTime() - new Date().getTime()) / (1000 * 3600 * 24));
      return days <= 30;
    };

    if (isExpired(v.fitnessExpiry) || isExpired(v.insuranceExpiry) || isExpired(v.permitExpiry) || isExpired(v.pucExpiry)) {
      return { variant: 'danger' as BadgeVariant, label: 'Docs Expired' };
    }
    if (isSoon(v.fitnessExpiry) || isSoon(v.insuranceExpiry) || isSoon(v.permitExpiry) || isSoon(v.pucExpiry)) {
      return { variant: 'amber' as BadgeVariant, label: 'Renewal Due' };
    }
    return { variant: 'success' as BadgeVariant, label: 'Compliant' };
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
        title="Fleet & Truck Registry"
        subtitle="Manage company-owned trucks, axle configurations, FASTag toll balance, and statutory certificates"
        actions={
          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Commercial Truck</span>
          </button>
        }
      />

      {/* Controls Bar: Search, Filters, Reset */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Bar */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Registration No (e.g. WB-19), Make/Model, or Driver..."
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

          {/* Quick Refresh */}
          <button
            onClick={() => fetchVehicles(page)}
            title="Refresh fleet list"
            className="p-2 border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 transition-colors shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
          <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider mr-1">Status:</span>
          {['ALL', 'AVAILABLE', 'IN_TRANSIT', 'UNDER_MAINTENANCE', 'INACTIVE'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === st
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st === 'ALL' ? 'All Trucks' : st.replace('_', ' ')}
            </button>
          ))}

          <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider ml-2 mr-1">Compliance:</span>
          {[
            { id: 'ALL', label: 'All Docs' },
            { id: 'EXPIRING_SOON', label: 'Expiring in 30d' },
            { id: 'EXPIRED', label: 'Expired Alert' },
          ].map((df) => (
            <button
              key={df.id}
              onClick={() => setDocFilter(df.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                docFilter === df.id
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {df.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content View (Table & Mobile Cards) */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-medium">Loading company fleet registry...</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-rose-200 p-8 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
          <p className="text-sm font-semibold text-slate-800">{error}</p>
          <button
            onClick={() => fetchVehicles(1)}
            className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800"
          >
            Retry Connection
          </button>
        </div>
      ) : vehicles.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mx-auto">
            <Truck className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto">
            <h4 className="text-base font-bold text-slate-900">No vehicles found</h4>
            <p className="text-xs text-slate-500 mt-1">
              {searchQuery || statusFilter !== 'ALL' || docFilter !== 'ALL'
                ? 'No commercial trucks match your search or filters. Try clearing your search parameters.'
                : 'Your company fleet has no registered vehicles yet. Register your first truck with RC and permit details.'}
            </p>
          </div>
          {searchQuery || statusFilter !== 'ALL' || docFilter !== 'ALL' ? (
            <button
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('ALL');
                setTypeFilter('ALL');
                setDocFilter('ALL');
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
              Add First Truck
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
                  <th className="py-3 px-4">Registration No.</th>
                  <th className="py-3 px-4">Type & Make</th>
                  <th className="py-3 px-4">Capacity</th>
                  <th className="py-3 px-4">FastTag Balance</th>
                  <th className="py-3 px-4">Assigned Driver</th>
                  <th className="py-3 px-4">Compliance</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {vehicles.map((v) => {
                  const status = getStatusBadge(v.status);
                  const compliance = getComplianceFlag(v);
                  return (
                    <tr key={v.id} className="hover:bg-slate-50/80 transition-colors group">
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900 text-sm">
                        <button
                          onClick={() => setSelectedVehicleId(v.id)}
                          className="hover:text-indigo-600 hover:underline text-left cursor-pointer"
                        >
                          {v.registrationNumber}
                        </button>
                        <span className="block text-[10px] font-normal text-slate-400 font-sans">
                          Chassis: {v.chassisNumber?.slice(-6) || 'N/A'}
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className="font-semibold text-slate-900 block">{v.makeModel}</span>
                        <span className="text-[11px] text-slate-500">{v.vehicleType}</span>
                      </td>

                      <td className="py-3.5 px-4 font-semibold text-slate-900">
                        {v.capacityTonnes} MT
                        <span className="block text-[10px] text-slate-400 font-normal">
                          Tare: {v.unladenWeightTonnes || 0} MT
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`font-bold ${
                            v.fastagBalancePaise < 150000 ? 'text-amber-600' : 'text-slate-900'
                          }`}
                        >
                          {formatINR(v.fastagBalancePaise)}
                        </span>
                        {v.fastagBalancePaise < 150000 && (
                          <span className="block text-[10px] text-amber-600 font-medium">Low Balance</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <span className="font-medium text-slate-800 block truncate max-w-[130px]">
                          {v.assignedDriverName || <span className="text-slate-400 italic">None</span>}
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <Badge variant={compliance.variant} dot>
                          {compliance.label}
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
                            onClick={() => setSelectedVehicleId(v.id)}
                            title="View Truck Details"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setVehicleToEdit(v)}
                            title="Edit Truck"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          {(userRole === 'OWNER' || userRole === 'ADMIN') && (
                            <button
                              onClick={() => setVehicleToDelete(v)}
                              title="Delete Truck"
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

          {/* Mobile Card View (Adaptable on small screens) */}
          <div className="md:hidden divide-y divide-slate-100">
            {vehicles.map((v) => {
              const status = getStatusBadge(v.status);
              const compliance = getComplianceFlag(v);
              return (
                <div key={v.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <button
                        onClick={() => setSelectedVehicleId(v.id)}
                        className="font-mono font-bold text-slate-900 text-sm hover:text-indigo-600 text-left"
                      >
                        {v.registrationNumber}
                      </button>
                      <span className="text-xs text-slate-500 block">{v.makeModel}</span>
                      <span className="text-[11px] text-slate-400 block">{v.vehicleType}</span>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={status.variant} dot>
                        {status.label}
                      </Badge>
                      <Badge variant={compliance.variant}>{compliance.label}</Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                    <div>
                      <span className="text-slate-400 text-[10px] uppercase block">Capacity</span>
                      <span className="font-semibold text-slate-800">{v.capacityTonnes} MT</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] uppercase block">FASTag Balance</span>
                      <span className="font-semibold text-slate-800">{formatINR(v.fastagBalancePaise)}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-400 text-[10px] uppercase block">Driver</span>
                      <span className="font-medium text-slate-800 truncate block">
                        {v.assignedDriverName || 'Unassigned'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      onClick={() => setSelectedVehicleId(v.id)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-lg"
                    >
                      Inspect
                    </button>
                    <button
                      onClick={() => setVehicleToEdit(v)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg"
                    >
                      Edit
                    </button>
                    {(userRole === 'OWNER' || userRole === 'ADMIN') && (
                      <button
                        onClick={() => setVehicleToDelete(v)}
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
              Showing <span className="font-semibold text-slate-900">{vehicles.length}</span> of{' '}
              <span className="font-semibold text-slate-900">{totalCount}</span> vehicles
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

      {/* Vehicle Create / Edit Modal */}
      {isCreateOpen && (
        <VehicleModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onSuccess={handleModalSuccess}
          drivers={drivers}
          token={activeToken}
        />
      )}

      {vehicleToEdit && (
        <VehicleModal
          isOpen={Boolean(vehicleToEdit)}
          onClose={() => setVehicleToEdit(null)}
          onSuccess={handleModalSuccess}
          vehicleToEdit={vehicleToEdit}
          drivers={drivers}
          token={activeToken}
        />
      )}

      {/* Vehicle Inspector Detail Modal */}
      {selectedVehicleId && (
        <VehicleDetailModal
          isOpen={Boolean(selectedVehicleId)}
          onClose={() => setSelectedVehicleId(null)}
          vehicleId={selectedVehicleId}
          token={activeToken}
          userRole={userRole}
          onEdit={(veh) => {
            setSelectedVehicleId(null);
            setVehicleToEdit(veh);
          }}
          onDelete={(veh) => {
            setSelectedVehicleId(null);
            setVehicleToDelete(veh);
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {vehicleToDelete && (
        <ConfirmDialog
          isOpen={Boolean(vehicleToDelete)}
          title={`Remove Vehicle ${vehicleToDelete.registrationNumber}?`}
          message={`Are you sure you want to delete vehicle ${vehicleToDelete.registrationNumber} (${vehicleToDelete.makeModel}) from your company fleet? This will also remove associated compliance records. This action cannot be undone.`}
          confirmLabel="Delete Vehicle"
          variant="danger"
          onConfirm={confirmDeleteVehicle}
          onClose={() => setVehicleToDelete(null)}
        />
      )}
    </div>
  );
};
