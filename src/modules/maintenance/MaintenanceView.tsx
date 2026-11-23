import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Edit,
  Plus,
  Search,
  Trash2,
  Truck,
  Wrench,
  X,
} from 'lucide-react';
import { MaintenanceRecord, UserRole } from '../../types/tms';
import { PageHeader } from '../../components/layout/PageHeader';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import { deleteMaintenanceInFirestore } from '../../lib/firebase/firestoreService';
import { formatINR } from '../../lib/financialEngine';
import {
  MAINTENANCE_SERVICE_TYPES,
  MaintenanceModal,
} from './MaintenanceModal';

interface MaintenanceViewProps {
  userRole: UserRole;
}

const SERVICE_LABEL_MAP: Record<MaintenanceRecord['serviceType'], string> = {
  SCHEDULED_SERVICE: 'Scheduled Service',
  TYRE_REPLACEMENT: 'Tyre Replacement',
  ENGINE_WORK: 'Engine Work',
  BRAKE_SUSPENSION: 'Brake & Suspension',
  ACCIDENT_BREAKDOWN: 'Breakdown / Accident',
};

export const MaintenanceView: React.FC<MaintenanceViewProps> = () => {
  const { company, maintenance, vehicles, loading, error } = useFirestoreData();

  const [searchQuery, setSearchQuery] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState('ALL');
  const [serviceTypeFilter, setServiceTypeFilter] = useState('ALL');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [recordToEdit, setRecordToEdit] = useState<MaintenanceRecord | null>(
    null
  );
  const [deleteTarget, setDeleteTarget] = useState<MaintenanceRecord | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);
  const [toastMsg, setToastMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const showToast = (type: 'success' | 'error', text: string) => {
    setToastMsg({ type, text });
    setTimeout(() => setToastMsg(null), 3500);
  };

  const enrichedRecords = useMemo(() => {
    return [...maintenance]
      .map((rec) => {
        const veh = vehicles.find((v) => v.id === rec.vehicleId);
        return {
          ...rec,
          vehicleReg: veh?.registrationNumber || rec.vehicleReg || 'Unknown Truck',
        };
      })
      .sort((a, b) => (b.serviceDate || '').localeCompare(a.serviceDate || ''));
  }, [maintenance, vehicles]);

  const summary = useMemo(() => {
    const now = new Date();
    const currentMonthPrefix = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, '0')}`;

    const totalCostPaise = enrichedRecords.reduce(
      (sum, r) => sum + (r.costPaise || 0),
      0
    );
    const thisMonthCostPaise = enrichedRecords
      .filter((r) => (r.serviceDate || '').startsWith(currentMonthPrefix))
      .reduce((sum, r) => sum + (r.costPaise || 0), 0);
    const breakdownCount = enrichedRecords.filter(
      (r) => r.serviceType === 'ACCIDENT_BREAKDOWN'
    ).length;

    return {
      totalRecords: enrichedRecords.length,
      totalCostPaise,
      thisMonthCostPaise,
      breakdownCount,
    };
  }, [enrichedRecords]);

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedRecords.filter((rec) => {
      if (vehicleFilter !== 'ALL' && rec.vehicleId !== vehicleFilter) {
        return false;
      }
      if (
        serviceTypeFilter !== 'ALL' &&
        rec.serviceType !== serviceTypeFilter
      ) {
        return false;
      }
      if (q) {
        const haystack = [
          rec.vehicleReg,
          rec.garageName,
          rec.invoiceNumber,
          rec.partsReplaced,
          rec.notes,
          SERVICE_LABEL_MAP[rec.serviceType] || rec.serviceType,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [enrichedRecords, vehicleFilter, serviceTypeFilter, searchQuery]);

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || !company?.id) return;
    setDeleting(true);
    try {
      await deleteMaintenanceInFirestore(
        company.id,
        deleteTarget.id,
        `${deleteTarget.vehicleReg} (${
          SERVICE_LABEL_MAP[deleteTarget.serviceType] || deleteTarget.serviceType
        })`
      );
      showToast('success', 'Maintenance record deleted from Firestore.');
      setDeleteTarget(null);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to delete maintenance record.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {toastMsg && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between text-xs sm:text-sm font-medium border shadow-sm ${
            toastMsg.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-rose-50 text-rose-900 border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {toastMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{toastMsg.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMsg(null)}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="Fleet Maintenance & Workshop Log"
          subtitle="Track scheduled servicing, tyre replacements, workshop invoices, and vehicle odometer history"
        />

        <button
          type="button"
          onClick={() => {
            setRecordToEdit(null);
            setIsModalOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm rounded-xl shadow-xs transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Log Maintenance</span>
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 bg-white rounded-xl border border-slate-200">
          <span className="text-xs font-semibold text-slate-500 block mb-1">
            Total Service Jobs
          </span>
          <span className="text-xl sm:text-2xl font-bold text-slate-900 font-mono tabular-nums block">
            {summary.totalRecords}
          </span>
          <span className="text-[11px] text-slate-500">
            Saved workshop entries
          </span>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200">
          <span className="text-xs font-semibold text-slate-500 block mb-1">
            Cumulative Fleet Spend
          </span>
          <span className="text-xl sm:text-2xl font-bold text-slate-900 font-mono tabular-nums block">
            {formatINR(summary.totalCostPaise)}
          </span>
          <span className="text-[11px] text-slate-500">
            All recorded repairs
          </span>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200">
          <span className="text-xs font-semibold text-slate-500 block mb-1">
            This Month Spend
          </span>
          <span className="text-xl sm:text-2xl font-bold text-indigo-700 font-mono tabular-nums block">
            {formatINR(summary.thisMonthCostPaise)}
          </span>
          <span className="text-[11px] text-slate-500">
            Current billing cycle
          </span>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200">
          <span className="text-xs font-semibold text-slate-500 block mb-1">
            Breakdown Incidents
          </span>
          <span
            className={`text-xl sm:text-2xl font-bold font-mono tabular-nums block ${
              summary.breakdownCount > 0 ? 'text-amber-700' : 'text-slate-900'
            }`}
          >
            {summary.breakdownCount}
          </span>
          <span className="text-[11px] text-slate-500">
            Accident / unscheduled jobs
          </span>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search truck, garage, parts, bill no..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white"
            />
          </div>

          <select
            value={vehicleFilter}
            onChange={(e) => setVehicleFilter(e.target.value)}
            className="w-full py-2 px-3 text-xs sm:text-sm border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-slate-50 font-mono text-slate-700"
          >
            <option value="ALL">All Trucks in Fleet</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.registrationNumber}
                {v.makeModel ? ` (${v.makeModel})` : ''}
              </option>
            ))}
          </select>

          <select
            value={serviceTypeFilter}
            onChange={(e) => setServiceTypeFilter(e.target.value)}
            className="w-full py-2 px-3 text-xs sm:text-sm border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-slate-50 text-slate-700"
          >
            <option value="ALL">All Service Categories</option>
            {MAINTENANCE_SERVICE_TYPES.map((st) => (
              <option key={st.value} value={st.value}>
                {st.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Records Table / States */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center space-y-3">
            <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-500 font-medium">
              Loading fleet maintenance logs...
            </p>
          </div>
        ) : error ? (
          <div className="p-8 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-rose-600 mx-auto" />
            <p className="text-sm font-semibold text-rose-800">{error}</p>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="py-16 px-4 text-center space-y-3">
            <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
              <Wrench className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-900">
              No Maintenance Records Found
            </h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {searchQuery ||
              vehicleFilter !== 'ALL' ||
              serviceTypeFilter !== 'ALL'
                ? 'No service records match your active filters. Clear filters to view all jobs.'
                : 'Log your first workshop service, tyre change, or repair invoice to keep fleet cost history in Firestore.'}
            </p>
            <button
              type="button"
              onClick={() => {
                setRecordToEdit(null);
                setIsModalOpen(true);
              }}
              className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Log First Service Entry</span>
            </button>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Truck</th>
                    <th className="py-3 px-4">Service & Parts</th>
                    <th className="py-3 px-4">Workshop / Bill No.</th>
                    <th className="py-3 px-4 text-right">Odometer</th>
                    <th className="py-3 px-4 text-right">Cost (₹)</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRecords.map((rec) => (
                    <tr
                      key={rec.id}
                      className="hover:bg-slate-50/70 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {rec.serviceDate}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Truck className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="font-mono font-semibold text-slate-900">
                            {rec.vehicleReg}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">
                          {SERVICE_LABEL_MAP[rec.serviceType] || rec.serviceType}
                        </div>
                        {rec.partsReplaced && (
                          <div className="text-xs text-slate-500 truncate max-w-xs">
                            {rec.partsReplaced}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-slate-800">
                          {rec.garageName || 'Authorized Workshop'}
                        </div>
                        {rec.invoiceNumber && (
                          <div className="text-xs text-slate-500 font-mono">
                            Bill: {rec.invoiceNumber}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {rec.odometerReading
                          ? `${rec.odometerReading.toLocaleString('en-IN')} km`
                          : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                        {formatINR(rec.costPaise)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setRecordToEdit(rec);
                              setIsModalOpen(true);
                            }}
                            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                            title="Edit Maintenance Record"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(rec)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Delete Maintenance Record"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile List */}
            <div className="md:hidden divide-y divide-slate-100">
              {filteredRecords.map((rec) => (
                <div key={rec.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-sm text-slate-900">
                        {SERVICE_LABEL_MAP[rec.serviceType] || rec.serviceType}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5 font-mono tabular-nums">
                        <span>{rec.vehicleReg}</span>
                        <span aria-hidden="true">·</span>
                        <span>{rec.serviceDate}</span>
                        {rec.odometerReading ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {rec.odometerReading.toLocaleString('en-IN')} km
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <span className="font-mono tabular-nums font-bold text-sm text-slate-900 whitespace-nowrap">
                      {formatINR(rec.costPaise)}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600">
                    {rec.garageName}
                    {rec.invoiceNumber ? ` · Bill ${rec.invoiceNumber}` : ''}
                  </div>
                  {rec.partsReplaced && (
                    <div className="text-xs text-slate-500">
                      Parts: {rec.partsReplaced}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setRecordToEdit(rec);
                        setIsModalOpen(true);
                      }}
                      className="px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 rounded-lg"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(rec)}
                      className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 rounded-lg"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <MaintenanceModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setRecordToEdit(null);
        }}
        recordToEdit={recordToEdit}
        onSuccess={(rec, isEdit) => {
          showToast(
            'success',
            isEdit
              ? `Updated maintenance log for ${rec.vehicleReg}.`
              : `Logged maintenance job for ${rec.vehicleReg} in Firestore.`
          );
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete Maintenance Record?"
        message={`Are you sure you want to permanently remove the service record for ${
          deleteTarget?.vehicleReg || 'this truck'
        } (${deleteTarget?.serviceDate || ''})?`}
        confirmLabel="Delete Record"
        cancelLabel="Cancel"
        variant="danger"
        isLoading={deleting}
        onConfirm={handleDeleteConfirm}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
};
