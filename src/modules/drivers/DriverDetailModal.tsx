import React, { useState, useEffect } from 'react';
import {
  X,
  User,
  ShieldCheck,
  Calendar,
  CreditCard,
  Truck,
  Phone,
  Lock,
  AlertTriangle,
  Clock,
  CheckCircle2,
  FileText,
  Trash2,
  Edit,
  ArrowRight,
  Wallet,
} from 'lucide-react';
import { Driver, Trip, DriverAdvance, UserRole } from '../../types/tms';
import { formatINR } from '../../lib/currency';
import { Badge, BadgeVariant } from '../../components/ui/Badge';
import { parseResponseJson } from '../../lib/safeFetch';

interface DriverDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  driverId: string | null;
  token: string;
  userRole: UserRole;
  onEdit: (driver: Driver) => void;
  onDelete: (driver: Driver) => void;
}

export const DriverDetailModal: React.FC<DriverDetailModalProps> = ({
  isOpen,
  onClose,
  driverId,
  token,
  userRole,
  onEdit,
  onDelete,
}) => {
  const [driver, setDriver] = useState<Driver | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [advances, setAdvances] = useState<DriverAdvance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAccessSensitive = userRole === 'OWNER' || userRole === 'ADMIN' || userRole === 'ACCOUNTANT';
  const canDelete = userRole === 'OWNER' || userRole === 'ADMIN';

  useEffect(() => {
    if (!isOpen || !driverId) return;

    const fetchDetails = async () => {
      setLoading(true);
      setError(null);
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`/api/drivers/${driverId}`, { headers });
        const data = await parseResponseJson<any>(res);
        if (!res.ok || !data || !data.success) {
          throw new Error(data?.error || 'Failed to load driver details.');
        }

        setDriver(data.driver);
        setTrips(data.trips || []);
        setAdvances(data.advances || []);
      } catch (err: any) {
        setError(err.message || 'Error fetching driver record.');
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [isOpen, driverId, token]);

  if (!isOpen) return null;

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

  const calculateLicenseValidity = (expiryDate: string) => {
    const today = new Date();
    const exp = new Date(expiryDate);
    const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 3600 * 24));

    if (diffDays < 0) {
      return {
        status: 'EXPIRED',
        text: `Expired ${Math.abs(diffDays)} days ago`,
        color: 'text-rose-700 bg-rose-50 border-rose-200',
      };
    }
    if (diffDays <= 30) {
      return {
        status: 'EXPIRING_SOON',
        text: `Expires in ${diffDays} days (${expiryDate})`,
        color: 'text-amber-700 bg-amber-50 border-amber-200',
      };
    }
    return {
      status: 'VALID',
      text: `Valid until ${expiryDate} (${diffDays} days)`,
      color: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    };
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-indigo-400">
              <User className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base sm:text-lg tracking-tight">
                  {driver?.fullName || 'Driver Profile'}
                </h3>
                {driver && (
                  <Badge variant={getStatusBadge(driver.status).variant} dot>
                    {getStatusBadge(driver.status).label}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-slate-400">
                {driver?.phone} • Assigned Truck:{' '}
                <span className="font-mono text-white">{driver?.assignedVehicleReg || 'None'}</span>
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

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-16 text-center space-y-3">
              <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-slate-500 font-medium">Fetching driver dossier & trip logs...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          ) : driver ? (
            <>
              {/* Metric Highlights */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">Daily Bata Rate</span>
                  <span className="text-base sm:text-lg font-bold text-slate-900 mt-0.5 block">
                    {formatINR(driver.perDayBataPaise)} <span className="text-xs font-normal text-slate-500">/day</span>
                  </span>
                  <span className="text-[10px] text-slate-500">En-route allowance</span>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">Cash Advance Balance</span>
                  <span
                    className={`text-base sm:text-lg font-bold mt-0.5 block ${
                      driver.currentAdvanceBalancePaise > 0 ? 'text-amber-600' : 'text-slate-900'
                    }`}
                  >
                    {formatINR(driver.currentAdvanceBalancePaise)}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {driver.currentAdvanceBalancePaise > 0 ? 'Surplus cash in hand' : 'Zero balance'}
                  </span>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">Trips Completed</span>
                  <span className="text-base sm:text-lg font-bold text-slate-900 mt-0.5 block">
                    {driver.totalTripsCompleted || 0}
                  </span>
                  <span className="text-[10px] text-slate-500">Lifetime runs</span>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">Monthly Base Salary</span>
                  {canAccessSensitive ? (
                    <span className="text-base sm:text-lg font-bold text-slate-900 mt-0.5 block">
                      {driver.monthlySalaryPaise ? formatINR(driver.monthlySalaryPaise) : '₹0'}
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-1 rounded inline-block mt-1">
                      Restricted
                    </span>
                  )}
                  <span className="text-[10px] text-slate-500">Payroll account</span>
                </div>
              </div>

              {/* Driving License & Contact Details */}
              <div className="border border-slate-200 rounded-xl p-4 bg-white">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-2">
                  <FileText className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Driving License & Emergency Info</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="text-slate-500 block">Driving License No.</span>
                    <span className="font-mono font-bold text-slate-900 text-sm">{driver.licenseNumber}</span>
                  </div>

                  <div>
                    <span className="text-slate-500 block">DL Expiry & Validity</span>
                    {(() => {
                      const val = calculateLicenseValidity(driver.licenseExpiry);
                      return (
                        <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded border mt-0.5 ${val.color}`}>
                          {val.text}
                        </span>
                      );
                    })()}
                  </div>

                  <div>
                    <span className="text-slate-500 block">Badge / Trans Endorsement</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {driver.badgeNumber || 'Not specified'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-500 block">Primary Contact</span>
                    <span className="font-mono font-semibold text-slate-900">{driver.phone}</span>
                  </div>

                  <div>
                    <span className="text-slate-500 block">Alternate Phone</span>
                    <span className="font-mono text-slate-700">{driver.altPhone || 'None'}</span>
                  </div>

                  <div>
                    <span className="text-slate-500 block">Emergency Kin Contact</span>
                    <span className="font-medium text-slate-900 block">{driver.emergencyContact || 'Family'}</span>
                    <span className="text-slate-500 font-mono text-[11px]">{driver.emergencyPhone || 'N/A'}</span>
                  </div>

                  <div className="sm:col-span-3 pt-2 border-t border-slate-100">
                    <span className="text-slate-500 block">Permanent Residence</span>
                    <span className="text-slate-800">{driver.address || 'West Bengal'}</span>
                  </div>
                </div>
              </div>

              {/* SENSITIVE PERSONAL & BANKING DOSSIER */}
              <div className="border border-slate-200 rounded-xl p-4 bg-white">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-600" />
                    <span>Identity & Financial Records</span>
                  </h4>
                  <span className="text-[10px] font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                    {canAccessSensitive ? 'Confidential View' : 'Redacted for Privacy'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="text-slate-500 block">12-digit Aadhaar</span>
                    <span className="font-mono font-bold text-slate-900 tracking-wider">
                      {driver.aadharNumber || '•••• •••• ••••'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-500 block">Income Tax PAN</span>
                    <span className="font-mono font-bold text-slate-900 uppercase">
                      {driver.panNumber || '••••••••••'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-500 block">Bank Account No.</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {driver.bankAccount || '••••••••••••'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-500 block">IFSC & Branch</span>
                    <span className="font-mono font-semibold text-slate-900 block">
                      {driver.bankIfsc || '••••••••'}
                    </span>
                    <span className="text-[10px] text-slate-500 block truncate">
                      {driver.bankName ? `${driver.bankName} (${driver.bankBranch || ''})` : ''}
                    </span>
                  </div>
                </div>

                {!canAccessSensitive && (
                  <div className="mt-3 p-2.5 bg-amber-50/70 border border-amber-200/70 rounded-lg text-[11px] text-amber-800">
                    Sensitive identity numbers and salary are restricted to Owners, Admins, and Accountants under RBAC policies.
                  </div>
                )}
              </div>

              {/* Assigned Trips History */}
              <div className="border border-slate-200 rounded-xl p-4 bg-white">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Assigned Operational Trips ({trips.length})</span>
                  </div>
                </h4>

                {trips.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-2">No active or past trips assigned to this driver yet.</p>
                ) : (
                  <div className="space-y-2">
                    {trips.map((t) => (
                      <div
                        key={t.id}
                        className="p-2.5 rounded-lg border border-slate-100 bg-slate-50 flex items-center justify-between text-xs"
                      >
                        <div>
                          <span className="font-bold font-mono text-slate-900">{t.tripNumber}</span>
                          <span className="text-slate-500 ml-2 font-mono text-[11px]">Truck: {t.vehicleReg}</span>
                          <div className="text-[11px] text-slate-600 flex items-center gap-1 mt-0.5">
                            <span>{t.originCity.split(',')[0]}</span>
                            <ArrowRight className="w-3 h-3 text-slate-400" />
                            <span>{t.destinationCity.split(',')[0]}</span>
                            <span className="text-slate-400">•</span>
                            <span className="font-medium text-slate-800">{t.customerName}</span>
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

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div>
            {canDelete && driver && (
              <button
                type="button"
                onClick={() => {
                  onDelete(driver);
                  onClose();
                }}
                className="px-3 py-2 text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete Driver</span>
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
            {driver && (
              <button
                type="button"
                onClick={() => {
                  onEdit(driver);
                  onClose();
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              >
                <Edit className="w-4 h-4" />
                <span>Edit Profile</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
