import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  User,
} from 'lucide-react';
import { DriverAdvance, AdvanceType, PaymentMode } from '../../types/tms';
import { Modal } from '../../components/ui/Modal';
import { useAuth } from '../../context/AuthContext';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import {
  createAdvanceInFirestore,
  updateAdvanceInFirestore,
} from '../../lib/firebase/firestoreService';

interface DriverAdvanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (advance: DriverAdvance, isEdit?: boolean) => void;
  advanceToEdit?: DriverAdvance | null;
  defaultTripId?: string;
}

const ADVANCE_TYPES: { id: AdvanceType; label: string; desc: string }[] = [
  { id: 'CASH_DISPATCH', label: 'Cash Advance at Dispatch', desc: 'Handed over in cash before truck leaves yard' },
  { id: 'CASH_EN_ROUTE', label: 'Cash En-Route', desc: 'Disbursed at toll/dhabas/transporter partner counters' },
  { id: 'UPI_ONLINE', label: 'UPI Bank Transfer', desc: 'Sent to driver personal UPI handle (GPay/PhonePe)' },
  { id: 'PUMP_DIESEL_SLIP', label: 'Diesel Credit Slip', desc: 'Petro slip issued for en-route pump filling' },
  { id: 'BANK_TRANSFER', label: 'IMPS Direct to Driver Bank', desc: 'Bank wire to driver verified salary account' },
];

export const DriverAdvanceModal: React.FC<DriverAdvanceModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  advanceToEdit,
  defaultTripId,
}) => {
  const { user, company: authCompany } = useAuth();
  const { company: liveCompany, trips, drivers, advances, loading: dataLoading } = useFirestoreData();
  const company = liveCompany?.id ? liveCompany : authCompany;

  const isEdit = Boolean(advanceToEdit);

  const [tripId, setTripId] = useState(defaultTripId || '');
  const [driverId, setDriverId] = useState('');
  const [amountRupees, setAmountRupees] = useState('');
  const [advanceType, setAdvanceType] = useState<AdvanceType>('CASH_DISPATCH');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (advanceToEdit) {
      setTripId(advanceToEdit.tripId || '');
      setDriverId(advanceToEdit.driverId || '');
      setAmountRupees((advanceToEdit.amountPaise / 100).toString());
      setAdvanceType(advanceToEdit.advanceType);
      setDate((advanceToEdit.date || '').split('T')[0] || new Date().toISOString().split('T')[0]);
      setReference(advanceToEdit.reference || advanceToEdit.referenceNotes || '');
      setNotes(advanceToEdit.notes || '');
    } else {
      const initialTrip = defaultTripId ? trips.find((t) => t.id === defaultTripId) : undefined;
      setTripId(defaultTripId || '');
      setDriverId(initialTrip?.driverId || '');
      setAmountRupees('');
      setAdvanceType('CASH_DISPATCH');
      setDate(new Date().toISOString().split('T')[0]);
      setReference('');
      setNotes('');
    }
  }, [isOpen, defaultTripId, advanceToEdit]);

  const selectedTrip = trips.find((t) => t.id === tripId);
  const selectedDriver = drivers.find((d) => d.id === driverId);

  const handleTripSelect = (nextTripId: string) => {
    setTripId(nextTripId);
    const matched = trips.find((t) => t.id === nextTripId);
    if (matched?.driverId) {
      setDriverId(matched.driverId);
    }
  };

  const mapAdvancePaymentMode = (type: AdvanceType): PaymentMode => {
    if (type === 'UPI_ONLINE') return 'UPI';
    if (type === 'BANK_TRANSFER') return 'BANK_TRANSFER';
    if (type === 'PUMP_DIESEL_SLIP') return 'PETRO_CARD';
    return 'CASH';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!company?.id) {
      setError('Active company profile is required to disburse an advance.');
      return;
    }

    const amount = Math.round(parseFloat(amountRupees) * 100);
    if (isNaN(amount) || amount <= 0) {
      setError('Please provide a valid positive advance amount.');
      return;
    }

    if (!driverId) {
      setError('Please select a driver for this advance disbursement.');
      return;
    }

    setLoading(true);

    try {
      const matchedDriver = drivers.find((d) => d.id === driverId);
      const cleanRef = reference.trim() ? reference.trim().slice(0, 100) : undefined;
      const cleanNotes = notes.trim() ? notes.trim().slice(0, 300) : undefined;

      const advance: DriverAdvance = {
        ...(advanceToEdit || {}),
        id: advanceToEdit?.id || `adv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        companyId: company.id,
        tripId: selectedTrip?.id || undefined,
        tripNumber: selectedTrip?.tripNumber || undefined,
        driverId,
        driverName: (matchedDriver?.fullName || selectedTrip?.driverName || advanceToEdit?.driverName || 'Driver').slice(0, 100),
        vehicleReg: (selectedTrip?.vehicleReg || matchedDriver?.assignedVehicleReg || advanceToEdit?.vehicleReg)?.slice(0, 30),
        amountPaise: amount,
        advanceType,
        paymentMode: mapAdvancePaymentMode(advanceType),
        date,
        reference: cleanRef,
        referenceNotes: cleanRef,
        notes: cleanNotes,
        disbursedBy: advanceToEdit?.disbursedBy || (user?.name || user?.email || 'Owner').slice(0, 100),
        status: advanceToEdit?.status || 'ACTIVE',
        isSettled: advanceToEdit?.isSettled ?? false,
        settlementId: advanceToEdit?.settlementId,
        createdAt: advanceToEdit?.createdAt || new Date().toISOString(),
      };

      if (advanceToEdit) {
        const tripAdvances = selectedTrip ? advances.filter((a) => a.tripId === selectedTrip.id) : [];
        const driverAdvances = advances.filter((a) => a.driverId === driverId);
        await updateAdvanceInFirestore(
          company.id,
          advance,
          selectedTrip,
          matchedDriver,
          tripAdvances,
          driverAdvances
        );
      } else {
        await createAdvanceInFirestore(company.id, advance, selectedTrip, matchedDriver);
      }

      onSuccess(advance, isEdit);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error occurred while saving advance.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Driver Advance Record' : 'Disburse Driver Cash Advance'}
      maxWidth="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm">
            {error}
          </div>
        )}

        {/* Financial Regulation Warning Banner */}
        <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-xl text-xs text-indigo-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
          <div>
            <span className="font-bold">Accounting Rule: </span>
            Driver advances are <strong>cash movements</strong> and balance sheet receivables.
            They are reconciled against receipts during driver settlement and do <strong>not</strong> count as trip expenses.
          </div>
        </div>

        {/* 1. Driver & Optional Trip Selection */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Driver <span className="text-rose-500">*</span>
            </label>
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              required
              disabled={isEdit && Boolean(advanceToEdit?.isSettled)}
              className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100"
            >
              {dataLoading && drivers.length === 0 ? (
                <option value="">Loading drivers...</option>
              ) : (
                <>
                  <option value="">-- Select Driver --</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fullName} ({d.phone})
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Trip Association <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <select
              value={tripId}
              onChange={(e) => handleTripSelect(e.target.value)}
              disabled={isEdit && Boolean(advanceToEdit?.isSettled)}
              className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100"
            >
              <option value="">-- Direct / General Advance (No Trip) --</option>
              {trips
                .filter((t) => t.status !== 'CANCELLED' || t.id === tripId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.tripNumber} — {t.driverName} ({t.vehicleReg}) [{t.originCity} → {t.destinationCity}]
                  </option>
                ))}
            </select>
          </div>
        </div>

        {(selectedTrip || selectedDriver) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
            <User className="w-3.5 h-3.5 text-slate-400" />
            <span>
              Driver: <strong>{selectedDriver?.fullName || selectedTrip?.driverName || 'Selected'}</strong>
            </span>
            {(selectedTrip?.vehicleReg || selectedDriver?.assignedVehicleReg) && (
              <>
                <span className="text-slate-300">|</span>
                <span>
                  Truck: <strong>{selectedTrip?.vehicleReg || selectedDriver?.assignedVehicleReg}</strong>
                </span>
              </>
            )}
          </div>
        )}

        {/* 2. Amount & Date */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Advance Amount (₹ Rupees) <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 font-bold">
                ₹
              </span>
              <input
                type="number"
                step="1"
                min="1"
                required
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                placeholder="e.g. 15000"
                className="w-full pl-8 pr-4 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Disbursement Date <span className="text-rose-500">*</span>
            </label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* 3. Advance Type / Payment Method */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Payment Method <span className="text-rose-500">*</span>
          </label>
          <div className="grid grid-cols-1 gap-2">
            {ADVANCE_TYPES.map((type) => (
              <label
                key={type.id}
                className={`flex items-start gap-2.5 p-2 rounded-xl border text-xs cursor-pointer ${
                  advanceType === type.id
                    ? 'border-indigo-600 bg-indigo-50/70 text-indigo-950 font-semibold'
                    : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="advanceType"
                  value={type.id}
                  checked={advanceType === type.id}
                  onChange={() => setAdvanceType(type.id)}
                  className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <div className="font-semibold">{type.label}</div>
                  <div className="text-slate-500 text-[11px] leading-tight">{type.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* 4. Reference / Notes */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Reference / UTR / Cash Slip #
          </label>
          <input
            type="text"
            placeholder="e.g. UTR-948201482 or Cash Voucher #042"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Notes / Route Purpose
          </label>
          <textarea
            rows={2}
            placeholder="e.g. Trip dispatch diesel & toll float for Kolkata - Siliguri run"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2.5 text-xs font-semibold rounded-xl text-slate-700 hover:bg-slate-100 border border-slate-300 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2.5 text-xs font-semibold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm shadow-indigo-200 flex items-center gap-2 cursor-pointer"
          >
            {loading ? (
              <span>Saving...</span>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>{isEdit ? 'Save Advance Changes' : 'Disburse Advance'}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
