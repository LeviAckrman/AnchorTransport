import React, { useMemo } from 'react';
import {
  X,
  User,
  Lock,
  Clock,
  FileText,
  Trash2,
  Edit,
  ArrowRight,
} from 'lucide-react';
import { Driver, UserRole } from '../../types/tms';
import { formatINR } from '../../lib/currency';
import { Badge, BadgeVariant } from '../../components/ui/Badge';
import { useFirestoreData } from '../../context/FirestoreDataContext';

interface DriverDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  driverId: string | null;
  token?: string;
  userRole: UserRole;
  onEdit: (driver: Driver) => void;
  onDelete: (driver: Driver) => void;
}

export const DriverDetailModal: React.FC<DriverDetailModalProps> = ({
  isOpen,
  onClose,
  driverId,
  userRole,
  onEdit,
  onDelete,
}) => {
  const { drivers, trips: allTrips, advances: allAdvances } = useFirestoreData();

  const canAccessSensitive = userRole === 'OWNER' || userRole === 'ADMIN' || userRole === 'ACCOUNTANT';
  const canDelete = userRole === 'OWNER' || userRole === 'ADMIN';

  const driver = useMemo(
    () => (driverId ? drivers.find((d) => d.id === driverId) || null : null),
    [drivers, driverId]
  );

  const trips = useMemo(() => {
    if (!driverId) return [];
    return allTrips
      .filter((t) => t.driverId === driverId)
      .sort((a, b) => new Date(b.dispatchDate || b.createdAt).getTime() - new Date(a.dispatchDate || a.createdAt).getTime());
  }, [allTrips, driverId]);

  const advances = useMemo(() => {
    if (!driverId) return [];
    return allAdvances
      .filter((a) => a.driverId === driverId)
      .sort((a, b) => new Date(b.date || b.createdAt || 0).getTime() - new Date(a.date || a.createdAt || 0).getTime());
  }, [allAdvances, driverId]);

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
          {!driver ? (
            <div className="py-12 text-center text-xs text-slate-500">
              Driver record not found in Firestore.
            </div>
          ) : (
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
                      {canAccessSensitive ? (driver.aadharNumber || 'Not recorded') : '•••• •••• ••••'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-500 block">Income Tax PAN</span>
                    <span className="font-mono font-bold text-slate-900 uppercase">
                      {canAccessSensitive ? (driver.panNumber || 'Not recorded') : '••••••••••'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-500 block">Bank Account No.</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {canAccessSensitive ? (driver.bankAccount || 'Not recorded') : '••••••••••••'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-500 block">IFSC & Branch</span>
                    <span className="font-mono font-semibold text-slate-900 block">
                      {canAccessSensitive ? (driver.bankIfsc || 'Not recorded') : '••••••••'}
                    </span>
                    <span className="text-[10px] text-slate-500 block truncate">
                      {canAccessSensitive && driver.bankName
                        ? `${driver.bankName}${driver.bankBranch ? ` (${driver.bankBranch})` : ''}`
                        : ''}
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
                  <span className="text-[11px] font-medium text-slate-500">
                    {advances.length} advances logged
                  </span>
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
          )}
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
