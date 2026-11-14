import React, { useState, useEffect } from 'react';
import { X, User, ShieldCheck, Lock, AlertCircle, FileText } from 'lucide-react';
import { Driver, DriverStatus, Vehicle, UserRole } from '../../types/tms';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import { saveDriverInFirestore } from '../../lib/firebase/firestoreService';

interface DriverModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (driver: Driver, isEdit: boolean) => void;
  driverToEdit?: Driver | null;
  vehicles?: Vehicle[];
  token?: string;
  userRole: UserRole;
}

export const DriverModal: React.FC<DriverModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  driverToEdit,
  vehicles: propVehicles = [],
  userRole,
}) => {
  const { company, drivers: allDrivers, vehicles: firestoreVehicles } = useFirestoreData();
  const vehicles = firestoreVehicles.length > 0 ? firestoreVehicles : propVehicles;

  const isEdit = Boolean(driverToEdit);
  const canAccessSensitive = userRole === 'OWNER' || userRole === 'ADMIN' || userRole === 'ACCOUNTANT';
  const canEditSensitive = userRole === 'OWNER' || userRole === 'ADMIN';
  const sensitiveReadOnly = isEdit && canAccessSensitive && !canEditSensitive;

  // Basic Form States
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [altPhone, setAltPhone] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState('');
  const [badgeNumber, setBadgeNumber] = useState('');
  const [address, setAddress] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [status, setStatus] = useState<DriverStatus>('AVAILABLE');
  const [perDayBata, setPerDayBata] = useState('');
  const [assignedVehicleReg, setAssignedVehicleReg] = useState('');

  // Sensitive Personal Information
  const [monthlySalary, setMonthlySalary] = useState('');
  const [aadharNumber, setAadharNumber] = useState('');
  const [panNumber, setPanNumber] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankBranch, setBankBranch] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (driverToEdit) {
      setFullName(driverToEdit.fullName || '');
      setPhone(driverToEdit.phone?.replace(/[^0-9]/g, '').slice(-10) || '');
      setAltPhone(driverToEdit.altPhone?.replace(/[^0-9]/g, '').slice(-10) || '');
      setLicenseNumber(driverToEdit.licenseNumber || '');
      setLicenseExpiry(driverToEdit.licenseExpiry || '');
      setBadgeNumber(driverToEdit.badgeNumber || '');
      setAddress(driverToEdit.address || '');
      setEmergencyContact(driverToEdit.emergencyContact || '');
      setEmergencyPhone(driverToEdit.emergencyPhone?.replace(/[^0-9]/g, '').slice(-10) || '');
      setStatus(driverToEdit.status || 'AVAILABLE');
      setPerDayBata(driverToEdit.perDayBataPaise ? (driverToEdit.perDayBataPaise / 100).toString() : '');
      setAssignedVehicleReg(driverToEdit.assignedVehicleReg || '');

      if (canAccessSensitive) {
        setMonthlySalary(driverToEdit.monthlySalaryPaise ? (driverToEdit.monthlySalaryPaise / 100).toString() : '');
        setAadharNumber(driverToEdit.aadharNumber || '');
        setPanNumber(driverToEdit.panNumber || '');
        setBankAccount(driverToEdit.bankAccount || '');
        setBankIfsc(driverToEdit.bankIfsc || '');
        setBankName(driverToEdit.bankName || '');
        setBankBranch(driverToEdit.bankBranch || '');
      }
    } else {
      setFullName('');
      setPhone('');
      setAltPhone('');
      setLicenseNumber('');
      setLicenseExpiry('');
      setBadgeNumber('');
      setAddress('');
      setEmergencyContact('');
      setEmergencyPhone('');
      setStatus('AVAILABLE');
      setPerDayBata('');
      setAssignedVehicleReg('');
      setMonthlySalary('');
      setAadharNumber('');
      setPanNumber('');
      setBankAccount('');
      setBankIfsc('');
      setBankName('');
      setBankBranch('');
    }
    setError(null);
  }, [driverToEdit, isOpen, canAccessSensitive]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!company?.id) {
        throw new Error('Active company profile is required before saving a driver.');
      }

      const cleanPhone = phone.replace(/[^0-9]/g, '').slice(-10);
      if (cleanPhone.length !== 10) {
        throw new Error('Please enter a valid 10-digit Indian mobile number for the driver.');
      }

      const cleanDl = licenseNumber.trim().toUpperCase();
      if (!cleanDl || cleanDl.length < 6) {
        throw new Error('Driving license number is required (min 6 alphanumeric characters).');
      }

      if (!licenseExpiry) {
        throw new Error('Driving license expiry date is required.');
      }

      const duplicateDl = allDrivers.find(
        (d) => d.id !== driverToEdit?.id && (d.licenseNumber || '').trim().toUpperCase() === cleanDl
      );
      if (duplicateDl) {
        throw new Error(`Driving license ${cleanDl} is already registered to ${duplicateDl.fullName}.`);
      }

      const matchedVehicle = assignedVehicleReg
        ? vehicles.find((v) => v.registrationNumber === assignedVehicleReg)
        : undefined;

      const driverId = driverToEdit?.id || `drv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const nowIso = new Date().toISOString();

      const driverObj: Driver = {
        id: driverId,
        companyId: company.id,
        fullName: fullName.trim(),
        phone: cleanPhone,
        altPhone: altPhone.trim() || undefined,
        licenseNumber: cleanDl,
        licenseExpiry,
        badgeNumber: badgeNumber.trim() || undefined,
        address: address.trim() || 'Not specified',
        emergencyContact: emergencyContact.trim() || 'Family',
        emergencyPhone: emergencyPhone.trim() || cleanPhone,
        status,
        currentAdvanceBalancePaise: driverToEdit?.currentAdvanceBalancePaise ?? 0,
        totalTripsCompleted: driverToEdit?.totalTripsCompleted ?? 0,
        perDayBataPaise: Math.round((parseFloat(perDayBata) || 0) * 100),
        assignedVehicleId: matchedVehicle?.id || undefined,
        assignedVehicleReg: assignedVehicleReg || undefined,
        joinedDate: driverToEdit?.joinedDate || nowIso.split('T')[0],
        createdAt: driverToEdit?.createdAt || nowIso,
        updatedAt: nowIso,
        // Respect firestore.rules: non-OWNER/ADMIN updates cannot mutate sensitive PII/salary fields
        ...(canEditSensitive || !isEdit
          ? {
              monthlySalaryPaise: monthlySalary ? Math.round(parseFloat(monthlySalary) * 100) : undefined,
              aadharNumber: aadharNumber.trim() || undefined,
              panNumber: panNumber.trim().toUpperCase() || undefined,
              bankAccount: bankAccount.trim() || undefined,
              bankIfsc: bankIfsc.trim().toUpperCase() || undefined,
              bankName: bankName.trim() || undefined,
              bankBranch: bankBranch.trim() || undefined,
            }
          : {
              monthlySalaryPaise: driverToEdit?.monthlySalaryPaise,
              aadharNumber: driverToEdit?.aadharNumber,
              panNumber: driverToEdit?.panNumber,
              bankAccount: driverToEdit?.bankAccount,
              bankIfsc: driverToEdit?.bankIfsc,
              bankName: driverToEdit?.bankName,
              bankBranch: driverToEdit?.bankBranch,
            }),
      };

      await saveDriverInFirestore(company.id, driverObj);
      onSuccess(driverObj, isEdit);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error occurred while saving driver.');
    } finally {
      setLoading(false);
    }
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
              <h3 className="font-bold text-base sm:text-lg">
                {isEdit ? `Edit Driver: ${driverToEdit?.fullName}` : 'Onboard Commercial Driver'}
              </h3>
              <p className="text-xs text-slate-400">
                {isEdit
                  ? 'Update driver license, contact, daily bata, and assigned truck'
                  : 'Register a commercial heavy vehicle driver with driving license and emergency contacts'}
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

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Unable to save driver</p>
                <p className="text-xs mt-0.5 text-rose-700">{error}</p>
              </div>
            </div>
          )}

          {/* Section 1: Personal & Contact Information */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-2">
              <User className="w-3.5 h-3.5 text-indigo-600" />
              <span>1. Contact & Status Information</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rajesh Kumar Yadav"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Driver Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as DriverStatus)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 font-medium"
                >
                  <option value="AVAILABLE">Available for Dispatch</option>
                  <option value="ON_TRIP">On Trip (In Transit)</option>
                  <option value="ON_LEAVE">On Leave</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Primary Mobile Phone <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-xs font-mono font-bold">
                    +91
                  </span>
                  <input
                    type="tel"
                    required
                    maxLength={10}
                    placeholder="9732144501"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full pl-11 pr-3 py-2.5 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Alternate Phone
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-xs font-mono font-bold">
                    +91
                  </span>
                  <input
                    type="tel"
                    maxLength={10}
                    placeholder="9832281900"
                    value={altPhone}
                    onChange={(e) => setAltPhone(e.target.value)}
                    className="w-full pl-11 pr-3 py-2.5 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Assigned Truck
                </label>
                <select
                  value={assignedVehicleReg}
                  onChange={(e) => setAssignedVehicleReg(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 font-mono"
                >
                  <option value="">-- No Assigned Truck --</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.registrationNumber}>
                      {v.registrationNumber} ({v.vehicleType})
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-3">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Permanent Address / Native Village
                </label>
                <input
                  type="text"
                  placeholder="Vill: Bauria, PS: Uluberia, Dist: Howrah, West Bengal - 711310"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Emergency Contact Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Sunita Yadav (Wife)"
                  value={emergencyContact}
                  onChange={(e) => setEmergencyContact(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Emergency Contact Phone
                </label>
                <input
                  type="tel"
                  placeholder="+91 97321 44509"
                  value={emergencyPhone}
                  onChange={(e) => setEmergencyPhone(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Daily Trip Bata Allowance (₹/day)
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-xs font-bold">
                    ₹
                  </span>
                  <input
                    type="number"
                    value={perDayBata}
                    onChange={(e) => setPerDayBata(e.target.value)}
                    placeholder="600"
                    className="w-full pl-7 pr-3 py-2.5 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900 font-semibold"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Driving License & Badges */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-2">
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
              <span>2. Driving License & Endorsements</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Driving License (DL) No. <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. WB1920140029182"
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value.toUpperCase())}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 font-mono font-bold bg-white text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  License Expiry Date <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={licenseExpiry}
                  onChange={(e) => setLicenseExpiry(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Commercial Badge / Trans No.
                </label>
                <input
                  type="text"
                  placeholder="e.g. BDG-WB-8812"
                  value={badgeNumber}
                  onChange={(e) => setBadgeNumber(e.target.value.toUpperCase())}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 font-mono bg-white text-slate-900"
                />
              </div>
            </div>
          </div>

          {/* Section 3: SENSITIVE PERSONAL & FINANCIAL INFORMATION (Role-gated) */}
          <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/70">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-3">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-600" />
                <span>3. Sensitive Personal & Financial Information</span>
              </h4>
              <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-amber-700" />
                <span>
                  {canEditSensitive
                    ? 'Authorized Access'
                    : sensitiveReadOnly
                    ? 'Read-Only (Owner/Admin Edit)'
                    : 'Restricted (Owner/Accountant Only)'}
                </span>
              </span>
            </div>

            {canAccessSensitive ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Monthly Salary (₹/month)
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-xs font-bold">
                      ₹
                    </span>
                    <input
                      type="number"
                      readOnly={sensitiveReadOnly}
                      disabled={sensitiveReadOnly}
                      value={monthlySalary}
                      onChange={(e) => setMonthlySalary(e.target.value)}
                      placeholder="24000"
                      className="w-full pl-7 pr-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900 font-semibold disabled:bg-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    12-digit Aadhaar Card Number
                  </label>
                  <input
                    type="text"
                    maxLength={12}
                    readOnly={sensitiveReadOnly}
                    disabled={sensitiveReadOnly}
                    value={aadharNumber}
                    onChange={(e) => setAadharNumber(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="489210948210"
                    className="w-full p-2 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900 font-mono tracking-wider disabled:bg-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    PAN Card Number
                  </label>
                  <input
                    type="text"
                    maxLength={10}
                    readOnly={sensitiveReadOnly}
                    disabled={sensitiveReadOnly}
                    value={panNumber}
                    onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                    placeholder="CYPY9812A"
                    className="w-full p-2 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900 font-mono uppercase font-bold disabled:bg-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Bank Account Number
                  </label>
                  <input
                    type="text"
                    readOnly={sensitiveReadOnly}
                    disabled={sensitiveReadOnly}
                    value={bankAccount}
                    onChange={(e) => setBankAccount(e.target.value.trim())}
                    placeholder="302910492812"
                    className="w-full p-2 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900 font-mono disabled:bg-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Bank IFSC Code
                  </label>
                  <input
                    type="text"
                    maxLength={11}
                    readOnly={sensitiveReadOnly}
                    disabled={sensitiveReadOnly}
                    value={bankIfsc}
                    onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                    placeholder="SBIN0001829"
                    className="w-full p-2 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900 font-mono font-bold disabled:bg-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Bank Name & Branch
                  </label>
                  <input
                    type="text"
                    readOnly={sensitiveReadOnly}
                    disabled={sensitiveReadOnly}
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="SBI Uluberia Branch"
                    className="w-full p-2 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900 disabled:bg-slate-100"
                  />
                </div>
              </div>
            ) : (
              <div className="p-3 bg-amber-50/80 border border-amber-200/80 rounded-xl flex items-start gap-2.5 text-xs text-amber-800">
                <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Privacy & Security Guard</p>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    Driver Aadhaar, PAN, Bank Account, and Monthly Salary records are restricted to Company Owners, Admins, and Accountants. Your role ({userRole}) can update operational parameters like assigned truck, license validity, and daily bata.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors"
            >
              {loading && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              <span>{isEdit ? 'Save Driver' : 'Onboard Driver'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
