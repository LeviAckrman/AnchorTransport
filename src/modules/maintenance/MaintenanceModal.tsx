import React, { useEffect, useState } from 'react';
import { AlertTriangle, Wrench } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { MaintenanceRecord } from '../../types/tms';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import { saveMaintenanceInFirestore } from '../../lib/firebase/firestoreService';

export const MAINTENANCE_SERVICE_TYPES: Array<{
  value: MaintenanceRecord['serviceType'];
  label: string;
}> = [
  { value: 'SCHEDULED_SERVICE', label: 'Scheduled Service & Oil Change' },
  { value: 'TYRE_REPLACEMENT', label: 'Tyre Replacement / Retreading' },
  { value: 'ENGINE_WORK', label: 'Engine & Gearbox Overhaul' },
  { value: 'BRAKE_SUSPENSION', label: 'Brakes, Clutch & Suspension' },
  { value: 'ACCIDENT_BREAKDOWN', label: 'Accident / En-Route Breakdown' },
];

interface MaintenanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  recordToEdit?: MaintenanceRecord | null;
  onSuccess: (record: MaintenanceRecord, isEdit: boolean) => void;
}

export const MaintenanceModal: React.FC<MaintenanceModalProps> = ({
  isOpen,
  onClose,
  recordToEdit,
  onSuccess,
}) => {
  const { company, vehicles } = useFirestoreData();
  const isEdit = Boolean(recordToEdit);

  const [vehicleId, setVehicleId] = useState('');
  const [serviceType, setServiceType] =
    useState<MaintenanceRecord['serviceType']>('SCHEDULED_SERVICE');
  const [serviceDate, setServiceDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [costRupees, setCostRupees] = useState('');
  const [odometerReading, setOdometerReading] = useState('');
  const [garageName, setGarageName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [partsReplaced, setPartsReplaced] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (recordToEdit) {
      setVehicleId(recordToEdit.vehicleId || '');
      setServiceType(recordToEdit.serviceType || 'SCHEDULED_SERVICE');
      setServiceDate(
        recordToEdit.serviceDate || new Date().toISOString().split('T')[0]
      );
      setCostRupees(
        recordToEdit.costPaise > 0
          ? (recordToEdit.costPaise / 100).toFixed(2)
          : '0'
      );
      setOdometerReading(
        recordToEdit.odometerReading !== undefined
          ? String(recordToEdit.odometerReading)
          : ''
      );
      setGarageName(recordToEdit.garageName || '');
      setInvoiceNumber(recordToEdit.invoiceNumber || '');
      setPartsReplaced(recordToEdit.partsReplaced || '');
      setNotes(recordToEdit.notes || '');
    } else {
      const firstVehicle = vehicles[0];
      setVehicleId(firstVehicle?.id || '');
      setServiceType('SCHEDULED_SERVICE');
      setServiceDate(new Date().toISOString().split('T')[0]);
      setCostRupees('');
      setOdometerReading(
        firstVehicle?.currentOdometerKm !== undefined
          ? String(firstVehicle.currentOdometerKm)
          : ''
      );
      setGarageName('');
      setInvoiceNumber('');
      setPartsReplaced('');
      setNotes('');
    }
  }, [isOpen, recordToEdit, vehicles]);

  const handleVehicleChange = (nextVehicleId: string) => {
    setVehicleId(nextVehicleId);
    if (!isEdit) {
      const matched = vehicles.find((v) => v.id === nextVehicleId);
      if (matched && matched.currentOdometerKm !== undefined) {
        setOdometerReading(String(matched.currentOdometerKm));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!company?.id) {
      setError('No active company found. Please reload or select your company.');
      return;
    }

    const selectedVehicle = vehicles.find((v) => v.id === vehicleId);
    if (!selectedVehicle) {
      setError('Please select a commercial truck from your fleet.');
      return;
    }

    if (!serviceDate) {
      setError('Service date is required.');
      return;
    }

    const parsedCostRupees = parseFloat(costRupees);
    if (Number.isNaN(parsedCostRupees) || parsedCostRupees < 0) {
      setError('Please enter a valid non-negative service cost in ₹.');
      return;
    }

    const parsedOdo =
      odometerReading.trim() !== '' ? parseInt(odometerReading, 10) : 0;
    if (Number.isNaN(parsedOdo) || parsedOdo < 0) {
      setError('Odometer reading must be a valid non-negative number.');
      return;
    }

    const record: MaintenanceRecord = {
      ...(recordToEdit || {}),
      id:
        recordToEdit?.id ||
        `mnt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      companyId: company.id,
      vehicleId: selectedVehicle.id,
      vehicleReg: selectedVehicle.registrationNumber,
      serviceType,
      garageName: garageName.trim().slice(0, 120) || 'Authorized Fleet Workshop',
      costPaise: Math.round(parsedCostRupees * 100),
      odometerReading: parsedOdo,
      serviceDate,
      partsReplaced: partsReplaced.trim()
        ? partsReplaced.trim().slice(0, 300)
        : undefined,
      invoiceNumber: invoiceNumber.trim()
        ? invoiceNumber.trim().slice(0, 60)
        : undefined,
      notes: notes.trim() ? notes.trim().slice(0, 400) : undefined,
      createdAt: recordToEdit?.createdAt || new Date().toISOString(),
    };

    setSubmitting(true);
    try {
      await saveMaintenanceInFirestore(company.id, record, selectedVehicle);
      onSuccess(record, isEdit);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save maintenance record to Firestore.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Maintenance Record' : 'Log Fleet Maintenance & Repair'}
      subtitle="Persist workshop service bills, parts replaced, and odometer history in Firestore"
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-700 text-xs font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Commercial Truck <span className="text-rose-500">*</span>
            </label>
            <select
              required
              value={vehicleId}
              onChange={(e) => handleVehicleChange(e.target.value)}
              className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900 font-mono"
            >
              <option value="">
                {vehicles.length === 0
                  ? 'No trucks registered yet'
                  : '-- Select Truck --'}
              </option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registrationNumber}
                  {v.makeModel ? ` (${v.makeModel})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Service Category <span className="text-rose-500">*</span>
            </label>
            <select
              required
              value={serviceType}
              onChange={(e) =>
                setServiceType(
                  e.target.value as MaintenanceRecord['serviceType']
                )
              }
              className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900"
            >
              {MAINTENANCE_SERVICE_TYPES.map((st) => (
                <option key={st.value} value={st.value}>
                  {st.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Service Date <span className="text-rose-500">*</span>
            </label>
            <input
              type="date"
              required
              value={serviceDate}
              onChange={(e) => setServiceDate(e.target.value)}
              className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900 font-mono tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Total Workshop Cost (₹) <span className="text-rose-500">*</span>
            </label>
            <input
              type="number"
              required
              min="0"
              step="0.01"
              placeholder="e.g. 18500"
              value={costRupees}
              onChange={(e) => setCostRupees(e.target.value)}
              className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900 font-mono tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Garage / Workshop Name
            </label>
            <input
              type="text"
              maxLength={120}
              placeholder="e.g. Tata Authorized Service Center"
              value={garageName}
              onChange={(e) => setGarageName(e.target.value)}
              className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Odometer Reading (km)
            </label>
            <input
              type="number"
              min="0"
              placeholder="e.g. 145200"
              value={odometerReading}
              onChange={(e) => setOdometerReading(e.target.value)}
              className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900 font-mono tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Garage Bill / Invoice No.
            </label>
            <input
              type="text"
              maxLength={60}
              placeholder="e.g. INV-SVC-4092"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Parts Replaced / Work Done
            </label>
            <input
              type="text"
              maxLength={300}
              placeholder="e.g. Engine oil, oil filter, rear brake shoes"
              value={partsReplaced}
              onChange={(e) => setPartsReplaced(e.target.value)}
              className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Workshop Remarks / Next Service Notes
          </label>
          <textarea
            rows={2}
            maxLength={400}
            placeholder="Next oil change due at 160,000 km or warranty details..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900"
          />
        </div>

        <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || vehicles.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>
              {submitting
                ? 'Saving...'
                : isEdit
                ? 'Update Record'
                : 'Save Maintenance Record'}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
