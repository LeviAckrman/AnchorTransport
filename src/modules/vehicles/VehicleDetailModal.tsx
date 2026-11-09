import React, { useState, useEffect } from 'react';
import {
  X,
  Truck,
  ShieldCheck,
  Calendar,
  CreditCard,
  User,
  Wrench,
  AlertTriangle,
  Clock,
  CheckCircle2,
  FileText,
  Trash2,
  Edit,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { Vehicle, Driver, Trip, UserRole } from '../../types/tms';
import { formatINR } from '../../lib/currency';
import { parseResponseJson } from '../../lib/safeFetch';
import { Badge, BadgeVariant } from '../../components/ui/Badge';

interface VehicleDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  vehicleId: string | null;
  token: string;
  userRole: UserRole;
  onEdit: (vehicle: Vehicle) => void;
  onDelete: (vehicle: Vehicle) => void;
}

export const VehicleDetailModal: React.FC<VehicleDetailModalProps> = ({
  isOpen,
  onClose,
  vehicleId,
  token,
  userRole,
  onEdit,
  onDelete,
}) => {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !vehicleId) return;

    const fetchDetails = async () => {
      setLoading(true);
      setError(null);
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`/api/vehicles/${vehicleId}`, { headers });
        const data = await parseResponseJson<any>(res);
        if (!res.ok || !data || !data.success) {
          throw new Error(data?.error || 'Failed to load vehicle details.');
        }

        setVehicle(data.vehicle);
        setDriver(data.driver);
        setTrips(data.trips || []);
      } catch (err: any) {
        setError(err.message || 'Error fetching vehicle details.');
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [isOpen, vehicleId, token]);

  if (!isOpen) return null;

  const canDelete = userRole === 'OWNER' || userRole === 'ADMIN';

  const getStatusBadge = (status: Vehicle['status']): { variant: BadgeVariant; label: string } => {
    switch (status) {
      case 'AVAILABLE':
        return { variant: 'success', label: 'Available for Dispatch' };
      case 'IN_TRANSIT':
        return { variant: 'purple', label: 'In Transit (On Road)' };
      case 'UNDER_MAINTENANCE':
        return { variant: 'warning', label: 'Under Maintenance' };
      case 'INACTIVE':
        return { variant: 'slate', label: 'Inactive / Off Road' };
      default:
        return { variant: 'slate', label: status };
    }
  };

  const calculateDocExpiry = (expiryDate?: string) => {
    if (!expiryDate) return { status: 'MISSING', days: 0, text: 'Not Recorded', color: 'text-slate-400 bg-slate-100' };
    const today = new Date();
    const exp = new Date(expiryDate);
    const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 3600 * 24));

    if (diffDays < 0) {
      return {
        status: 'EXPIRED',
        days: diffDays,
        text: `Expired ${Math.abs(diffDays)} days ago`,
        color: 'text-rose-700 bg-rose-50 border-rose-200',
      };
    }
    if (diffDays <= 30) {
      return {
        status: 'EXPIRING_SOON',
        days: diffDays,
        text: `Expires in ${diffDays} days`,
        color: 'text-amber-700 bg-amber-50 border-amber-200',
      };
    }
    return {
      status: 'VALID',
      days: diffDays,
      text: `Valid for ${diffDays} days`,
      color: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    };
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-indigo-400 font-mono font-bold text-sm">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base sm:text-lg font-mono tracking-tight">
                  {vehicle?.registrationNumber || 'Vehicle Details'}
                </h3>
                {vehicle && (
                  <Badge variant={getStatusBadge(vehicle.status).variant} dot>
                    {getStatusBadge(vehicle.status).label}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-slate-400">
                {vehicle?.makeModel} • {vehicle?.vehicleType}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-16 text-center space-y-3">
              <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-slate-500 font-medium">Fetching truck record and compliance files...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          ) : vehicle ? (
            <>
              {/* Top Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">Payload Capacity</span>
                  <span className="text-base sm:text-lg font-bold text-slate-900 mt-0.5 block">
                    {vehicle.capacityTonnes} <span className="text-xs font-normal text-slate-500">Tonnes</span>
                  </span>
                  <span className="text-[10px] text-slate-500">Tare: {vehicle.unladenWeightTonnes || 0} MT</span>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">FastTag Toll Balance</span>
                  <span
                    className={`text-base sm:text-lg font-bold mt-0.5 block ${
                      vehicle.fastagBalancePaise < 150000 ? 'text-amber-600' : 'text-slate-900'
                    }`}
                  >
                    {formatINR(vehicle.fastagBalancePaise)}
                  </span>
                  {vehicle.fastagBalancePaise < 150000 ? (
                    <span className="text-[10px] text-amber-600 font-medium flex items-center gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" /> Low Balance
                    </span>
                  ) : (
                    <span className="text-[10px] text-emerald-600 font-medium">Toll Active</span>
                  )}
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">Current Odometer</span>
                  <span className="text-base sm:text-lg font-bold text-slate-900 mt-0.5 block font-mono">
                    {vehicle.currentOdometerKm.toLocaleString()} <span className="text-xs font-normal text-slate-500">km</span>
                  </span>
                  <span className="text-[10px] text-slate-500">Log verified</span>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">Assigned Driver</span>
                  <span className="text-sm font-bold text-slate-900 mt-1 block truncate">
                    {driver ? driver.fullName : vehicle.assignedDriverName || 'None'}
                  </span>
                  <span className="text-[10px] text-slate-500 truncate block">
                    {driver ? driver.phone : 'Unassigned'}
                  </span>
                </div>
              </div>

              {/* Technical Specifications */}
              <div className="border border-slate-200 rounded-xl p-4 bg-white">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-2">
                  <Truck className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Technical & Registration Details</span>
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="text-slate-500 block">Chassis Number</span>
                    <span className="font-mono font-bold text-slate-900">{vehicle.chassisNumber || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Engine Number</span>
                    <span className="font-mono font-bold text-slate-900">{vehicle.engineNumber || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Axle Classification</span>
                    <span className="font-semibold text-slate-900">{vehicle.vehicleType}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Fleet Onboarding</span>
                    <span className="font-medium text-slate-700">
                      {vehicle.createdAt ? new Date(vehicle.createdAt).toLocaleDateString() : 'N/A'}
                    </span>
                  </div>
                </div>
                {vehicle.notes && (
                  <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600">
                    <span className="font-semibold text-slate-700">Workshop & Maintenance Notes: </span>
                    {vehicle.notes}
                  </div>
                )}
              </div>

              {/* Statutory Documents & Compliance Grid */}
              <div className="border border-slate-200 rounded-xl p-4 bg-white">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-2">
                  <FileText className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Statutory Compliance Certificates</span>
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {/* Fitness Certificate */}
                  {(() => {
                    const doc = calculateDocExpiry(vehicle.fitnessExpiry);
                    return (
                      <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-900">Certificate of Fitness (CF)</span>
                          </div>
                          <span className="text-[11px] font-mono text-slate-600 block mt-0.5">
                            No: {vehicle.fitnessCertificateNumber || 'Not recorded'}
                          </span>
                          <span className="text-[11px] text-slate-500 block">
                            Expiry: {vehicle.fitnessExpiry || 'N/A'}
                          </span>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-1 rounded-md border ${doc.color}`}>
                          {doc.text}
                        </span>
                      </div>
                    );
                  })()}

                  {/* Commercial Insurance */}
                  {(() => {
                    const doc = calculateDocExpiry(vehicle.insuranceExpiry);
                    return (
                      <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-start justify-between">
                        <div>
                          <span className="font-bold text-slate-900 block">Commercial Insurance Policy</span>
                          <span className="text-[11px] font-mono text-slate-600 block mt-0.5">
                            Policy: {vehicle.insurancePolicyNumber || 'Not recorded'}
                          </span>
                          <span className="text-[11px] text-slate-500 block">
                            Expiry: {vehicle.insuranceExpiry || 'N/A'}
                          </span>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-1 rounded-md border ${doc.color}`}>
                          {doc.text}
                        </span>
                      </div>
                    );
                  })()}

                  {/* Road Permit */}
                  {(() => {
                    const doc = calculateDocExpiry(vehicle.permitExpiry);
                    return (
                      <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-start justify-between">
                        <div>
                          <span className="font-bold text-slate-900 block">
                            {vehicle.permitType === 'STATE' ? 'State Road Permit' : 'National Goods Permit'}
                          </span>
                          <span className="text-[11px] font-mono text-slate-600 block mt-0.5">
                            Permit No: {vehicle.permitNumber || 'Not recorded'}
                          </span>
                          <span className="text-[11px] text-slate-500 block">
                            Expiry: {vehicle.permitExpiry || 'N/A'}
                          </span>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-1 rounded-md border ${doc.color}`}>
                          {doc.text}
                        </span>
                      </div>
                    );
                  })()}

                  {/* Pollution PUC */}
                  {(() => {
                    const doc = calculateDocExpiry(vehicle.pucExpiry);
                    return (
                      <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-start justify-between">
                        <div>
                          <span className="font-bold text-slate-900 block">Pollution Certificate (PUC)</span>
                          <span className="text-[11px] font-mono text-slate-600 block mt-0.5">
                            PUC No: {vehicle.pucNumber || 'Not recorded'}
                          </span>
                          <span className="text-[11px] text-slate-500 block">
                            Expiry: {vehicle.pucExpiry || 'N/A'}
                          </span>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-1 rounded-md border ${doc.color}`}>
                          {doc.text}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Recent Trips Section */}
              <div className="border border-slate-200 rounded-xl p-4 bg-white">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Recent Trip Operations ({trips.length})</span>
                  </div>
                </h4>

                {trips.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-2">No past trips recorded for this vehicle yet.</p>
                ) : (
                  <div className="space-y-2">
                    {trips.map((t) => (
                      <div
                        key={t.id}
                        className="p-2.5 rounded-lg border border-slate-100 bg-slate-50 hover:bg-slate-100/80 transition-colors flex items-center justify-between text-xs"
                      >
                        <div>
                          <span className="font-bold font-mono text-slate-900">{t.tripNumber}</span>
                          <span className="text-slate-500 ml-2 font-mono text-[11px]">LR: {t.lrNumber}</span>
                          <div className="text-[11px] text-slate-600 flex items-center gap-1 mt-0.5">
                            <span>{t.originCity.split(',')[0]}</span>
                            <ArrowRight className="w-3 h-3 text-slate-400" />
                            <span>{t.destinationCity.split(',')[0]}</span>
                            <span className="text-slate-400">•</span>
                            <span className="font-medium text-slate-800 line-clamp-1">{t.customerName}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="font-bold text-slate-900">{formatINR(t.totalRevenuePaise)}</span>
                          <span className="block text-[10px] text-slate-500">{t.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Modal Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div>
            {canDelete && vehicle && (
              <button
                type="button"
                onClick={() => {
                  onDelete(vehicle);
                  onClose();
                }}
                className="px-3 py-2 text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete Truck</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
            >
              Close
            </button>
            {vehicle && (
              <button
                type="button"
                onClick={() => {
                  onEdit(vehicle);
                  onClose();
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              >
                <Edit className="w-4 h-4" />
                <span>Edit Vehicle</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
