import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Fuel,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { TripExpense, ExpenseCategory, PaymentMode } from '../../types/tms';
import { Modal } from '../../components/ui/Modal';
import { useAuth } from '../../context/AuthContext';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import { saveExpenseInFirestore } from '../../lib/firebase/firestoreService';

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (expense: TripExpense, isEdit: boolean) => void;
  expenseToEdit?: TripExpense | null;
  defaultTripId?: string;
}

const EXPENSE_CATEGORIES: { id: ExpenseCategory; label: string; icon: string }[] = [
  { id: 'FUEL', label: 'Fuel / Diesel', icon: '⛽' },
  { id: 'TOLL', label: 'Toll / FastTag', icon: '🛣️' },
  { id: 'PARKING', label: 'Parking Charges', icon: '🅿️' },
  { id: 'DRIVER_ALLOWANCE', label: 'Driver Allowance (Bata)', icon: '🍱' },
  { id: 'LOADING', label: 'Loading Charges', icon: '📦' },
  { id: 'UNLOADING', label: 'Unloading Charges', icon: '📥' },
  { id: 'REPAIR', label: 'En-route Repair / Tyre', icon: '🔧' },
  { id: 'OTHER', label: 'Other Miscellaneous', icon: '📋' },
];

const PAYMENT_MODES: { id: PaymentMode; label: string; desc: string }[] = [
  { id: 'CASH', label: 'Cash (Driver Advance)', desc: 'Paid by driver from trip cash advance' },
  { id: 'FASTAG', label: 'FastTag Electronic', desc: 'Deducted directly from vehicle FastTag wallet' },
  { id: 'PETRO_CARD', label: 'Petro Card / Fleet Card', desc: 'IndianOil / HPCL / BPCL corporate fuel card' },
  { id: 'UPI', label: 'UPI Online (GPay/PhonePe)', desc: 'Paid directly from company UPI bank handle' },
  { id: 'BANK_TRANSFER', label: 'Bank IMPS / NEFT', desc: 'Direct corporate bank wire transfer' },
  { id: 'DRIVER_POCKET', label: 'Driver Own Pocket', desc: 'Driver paid own money, requires reimbursement' },
];

export const ExpenseModal: React.FC<ExpenseModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  expenseToEdit,
  defaultTripId,
}) => {
  const { user, role, company: authCompany } = useAuth();
  const { company: liveCompany, trips, expenses: allExpenses, loading: dataLoading } = useFirestoreData();
  const company = liveCompany?.id ? liveCompany : authCompany;

  const isEdit = Boolean(expenseToEdit);

  // Form states
  const [tripId, setTripId] = useState(defaultTripId || '');
  const [category, setCategory] = useState<ExpenseCategory>('FUEL');
  const [amountRupees, setAmountRupees] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('CASH');
  const [litres, setLitres] = useState('');
  const [ratePerLitreRupees, setRatePerLitreRupees] = useState('');
  const [petrolPumpName, setPetrolPumpName] = useState('');
  const [location, setLocation] = useState('');
  const [odometerReading, setOdometerReading] = useState('');
  const [voucherNumber, setVoucherNumber] = useState('');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [receiptUrl, setReceiptUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [isDriverDisbursed, setIsDriverDisbursed] = useState(true);

  // Authorized correction for settled vouchers
  const [isAuthorizedCorrection, setIsAuthorizedCorrection] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate form if editing or reset on open
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (expenseToEdit) {
      setTripId(expenseToEdit.tripId);
      setCategory(expenseToEdit.category);
      setAmountRupees((expenseToEdit.amountPaise / 100).toString());
      setExpenseDate(
        (expenseToEdit.expenseDate || expenseToEdit.date || '').split('T')[0] ||
          new Date().toISOString().split('T')[0]
      );
      setPaymentMode(expenseToEdit.paymentMode);
      setLitres((expenseToEdit.litres ?? expenseToEdit.litresFuel)?.toString() || '');
      setRatePerLitreRupees(
        expenseToEdit.ratePerLitrePaise ? (expenseToEdit.ratePerLitrePaise / 100).toString() : ''
      );
      setPetrolPumpName(expenseToEdit.petrolPumpName || expenseToEdit.pumpName || '');
      setLocation(expenseToEdit.location || '');
      setOdometerReading(expenseToEdit.odometerReading ? expenseToEdit.odometerReading.toString() : '');
      setVoucherNumber(expenseToEdit.voucherNumber || '');
      setReceiptNumber(expenseToEdit.receiptNumber || '');
      setReceiptUrl(expenseToEdit.receiptUrl || expenseToEdit.receiptAttachmentUrl || '');
      setNotes(expenseToEdit.notes || expenseToEdit.description || '');
      setIsDriverDisbursed(
        expenseToEdit.isDriverDisbursed ??
          (expenseToEdit.paymentMode === 'CASH' || expenseToEdit.paymentMode === 'DRIVER_POCKET')
      );
      setIsAuthorizedCorrection(false);
      setCorrectionReason('');
    } else {
      setTripId(defaultTripId || '');
      setCategory('FUEL');
      setAmountRupees('');
      setExpenseDate(new Date().toISOString().split('T')[0]);
      setPaymentMode('CASH');
      setLitres('');
      setRatePerLitreRupees('');
      setPetrolPumpName('');
      setLocation('');
      setOdometerReading('');
      setVoucherNumber('');
      setReceiptNumber('');
      setReceiptUrl('');
      setNotes('');
      setIsDriverDisbursed(true);
      setIsAuthorizedCorrection(false);
      setCorrectionReason('');
    }
  }, [expenseToEdit, defaultTripId, isOpen]);

  const handleLitresChange = (val: string) => {
    setLitres(val);
    const l = parseFloat(val);
    const r = parseFloat(ratePerLitreRupees);
    if (!isNaN(l) && l > 0 && !isNaN(r) && r > 0) {
      setAmountRupees((l * r).toFixed(0));
    }
  };

  const handleRateChange = (val: string) => {
    setRatePerLitreRupees(val);
    const l = parseFloat(litres);
    const r = parseFloat(val);
    if (!isNaN(l) && l > 0 && !isNaN(r) && r > 0) {
      setAmountRupees((l * r).toFixed(0));
    }
  };

  const selectedTrip = trips.find((t) => t.id === tripId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!company?.id) {
      setError('Active company profile is required to record expenses.');
      return;
    }

    const amount = Math.round(parseFloat(amountRupees) * 100);
    if (isNaN(amount) || amount <= 0) {
      setError('Please provide a valid positive expense amount.');
      return;
    }

    if (!tripId) {
      setError('Please select an active trip for this expense.');
      return;
    }

    if (expenseToEdit?.isSettled && isAuthorizedCorrection && !correctionReason.trim()) {
      setError('An authorized correction reason is required to alter a settled expense.');
      return;
    }

    setLoading(true);

    try {
      const isFuel = category === 'FUEL' || category === 'DIESEL';
      const parsedLitres = isFuel && litres ? parseFloat(litres) : undefined;
      const parsedRate = isFuel && ratePerLitreRupees ? Math.round(parseFloat(ratePerLitreRupees) * 100) : undefined;
      const cleanPump = petrolPumpName.trim() ? petrolPumpName.trim().slice(0, 120) : undefined;
      const cleanNotes = [
        notes.trim(),
        expenseToEdit?.isSettled && isAuthorizedCorrection && correctionReason.trim()
          ? `[Audit Correction: ${correctionReason.trim()}]`
          : '',
      ]
        .filter(Boolean)
        .join(' ')
        .slice(0, 400);

      const savedExpense: TripExpense = {
        ...(expenseToEdit || {}),
        id: expenseToEdit?.id || `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        companyId: company.id,
        tripId,
        tripNumber: selectedTrip?.tripNumber || expenseToEdit?.tripNumber,
        vehicleId: selectedTrip?.vehicleId || expenseToEdit?.vehicleId,
        vehicleReg: selectedTrip?.vehicleReg || expenseToEdit?.vehicleReg,
        driverId: selectedTrip?.driverId || expenseToEdit?.driverId,
        driverName: selectedTrip?.driverName || expenseToEdit?.driverName,
        category,
        amountPaise: amount,
        paymentMode,
        date: expenseDate,
        expenseDate,
        description: cleanNotes ? cleanNotes.slice(0, 300) : undefined,
        litres: parsedLitres,
        litresFuel: parsedLitres,
        ratePerLitrePaise: parsedRate,
        petrolPumpName: cleanPump,
        pumpName: cleanPump,
        location: location.trim() ? location.trim().slice(0, 120) : undefined,
        odometerReading: odometerReading ? parseInt(odometerReading, 10) : undefined,
        receiptNumber: receiptNumber.trim() ? receiptNumber.trim().slice(0, 60) : undefined,
        voucherNumber: voucherNumber.trim() ? voucherNumber.trim().slice(0, 60) : undefined,
        receiptUrl: receiptUrl.trim() ? receiptUrl.trim().slice(0, 500) : undefined,
        notes: cleanNotes || undefined,
        recordedBy: expenseToEdit?.recordedBy || (user?.name || user?.email || 'Dispatcher').slice(0, 100),
        isDriverDisbursed,
        isSettled: expenseToEdit?.isSettled ?? false,
        settlementId: expenseToEdit?.settlementId,
        createdAt: expenseToEdit?.createdAt || new Date().toISOString(),
      };

      const existingTripExpenses = allExpenses.filter((exp) => exp.tripId === tripId);
      await saveExpenseInFirestore(company.id, savedExpense, selectedTrip, existingTripExpenses);

      onSuccess(savedExpense, isEdit);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error occurred while saving expense.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? `Edit Expense Voucher: ${expenseToEdit?.voucherNumber || expenseToEdit?.id}` : 'Record Trip Expense'}
      maxWidth="2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-2 animate-in fade-in">
            <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Settled Audit Warning */}
        {expenseToEdit?.isSettled && (
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2">
            <div className="flex items-center gap-2 font-bold">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Settlement Lock: This expense voucher was audited in driver settlement #{expenseToEdit.settlementId || 'FINALIZED'}
            </div>
            <p>
              Modifications will alter financial ledger records. Administrator override is required.
            </p>
            {(role === 'OWNER' || role === 'ADMIN') && (
              <div className="pt-2 border-t border-amber-200">
                <label className="flex items-center gap-2 font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isAuthorizedCorrection}
                    onChange={(e) => setIsAuthorizedCorrection(e.target.checked)}
                    className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                  />
                  <span>Authorize financial correction on settled voucher</span>
                </label>
                {isAuthorizedCorrection && (
                  <input
                    type="text"
                    required
                    placeholder="Enter mandatory audit correction reason (e.g. Pump invoice rate discrepancy)..."
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                    className="mt-2 w-full px-3 py-1.5 text-xs rounded-lg border border-amber-300 bg-white"
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* 1. Trip Association */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Associated Trip <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <select
              value={tripId}
              onChange={(e) => setTripId(e.target.value)}
              disabled={isEdit}
              required
              className="w-full pl-3 pr-10 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-100"
            >
              {dataLoading && trips.length === 0 ? (
                <option value="">Loading active trips...</option>
              ) : trips.length === 0 ? (
                <option value="">No trips available</option>
              ) : (
                <>
                  <option value="">-- Choose Associated Trip --</option>
                  {trips.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.tripNumber} — {t.vehicleReg} ({t.originCity} → {t.destinationCity}) [{t.driverName}]
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>
          {selectedTrip && (
            <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-700">Truck:</span> {selectedTrip.vehicleReg}
              <span className="text-slate-300">|</span>
              <span className="font-semibold text-slate-700">Driver:</span> {selectedTrip.driverName}
              <span className="text-slate-300">|</span>
              <span className="font-semibold text-slate-700">Status:</span> {selectedTrip.status}
            </div>
          )}
        </div>

        {/* 2. Category Selection (Visual Grid) */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Expense Category <span className="text-rose-500">*</span>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {EXPENSE_CATEGORIES.map((cat) => (
              <button
                type="button"
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                className={`flex items-center gap-2 p-2.5 rounded-xl border text-left text-xs font-semibold transition-all cursor-pointer ${
                  category === cat.id
                    ? 'border-indigo-600 bg-indigo-50/70 text-indigo-900 shadow-xs'
                    : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                }`}
              >
                <span className="text-base">{cat.icon}</span>
                <span className="truncate">{cat.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 3. Amount & Date */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Amount (₹ Rupees) <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 font-bold">
                ₹
              </span>
              <input
                type="number"
                step="0.01"
                min="1"
                required
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                placeholder="e.g. 8500"
                className="w-full pl-8 pr-4 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Expense Date <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
              <input
                type="date"
                required
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* 4. Category-Specific Fields: Fuel / Diesel */}
        {(category === 'FUEL' || category === 'DIESEL') && (
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
              <Fuel className="w-4 h-4 text-indigo-600" />
              Fuel Dispensation Details
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-600 mb-1">Litres</label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 120"
                  value={litres}
                  onChange={(e) => handleLitresChange(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-600 mb-1">Rate / Litre (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 94.50"
                  value={ratePerLitreRupees}
                  onChange={(e) => handleRateChange(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-600 mb-1">Petrol Pump Name</label>
                <input
                  type="text"
                  placeholder="e.g. IOCL Dankuni COCO"
                  value={petrolPumpName}
                  onChange={(e) => setPetrolPumpName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* 5. Payment Method & Disbursed By */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate-700">
            Payment Mode <span className="text-rose-500">*</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PAYMENT_MODES.map((pm) => (
              <label
                key={pm.id}
                className={`flex items-start gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer transition-colors ${
                  paymentMode === pm.id
                    ? 'border-indigo-600 bg-indigo-50/70 text-indigo-950 font-semibold'
                    : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="paymentMode"
                  value={pm.id}
                  checked={paymentMode === pm.id}
                  onChange={() => {
                    setPaymentMode(pm.id);
                    setIsDriverDisbursed(pm.id === 'CASH' || pm.id === 'DRIVER_POCKET');
                  }}
                  className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <div className="font-semibold">{pm.label}</div>
                  <div className="text-slate-500 text-[11px] leading-tight mt-0.5">{pm.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Driver disbursement checkbox */}
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-slate-800">
            <input
              type="checkbox"
              checked={isDriverDisbursed}
              onChange={(e) => setIsDriverDisbursed(e.target.checked)}
              className="rounded text-indigo-600 focus:ring-indigo-500"
            />
            <span>Paid by Driver from Cash Advance (Reconciled in Driver Settlement)</span>
          </label>
          <p className="text-[11px] text-slate-500 mt-1 pl-6">
            If checked, this expense will appear as an approved deduction/voucher credit when closing the driver's trip settlement.
          </p>
        </div>

        {/* 6. Vouchers, Receipts & Notes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Voucher / Slip Number
            </label>
            <input
              type="text"
              placeholder="e.g. VCH-84920"
              value={voucherNumber}
              onChange={(e) => setVoucherNumber(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Receipt / Bill Reference
            </label>
            <input
              type="text"
              placeholder="e.g. GST-INV-4821"
              value={receiptNumber}
              onChange={(e) => setReceiptNumber(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Receipt Attachment URL */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Receipt Attachment Document URL
          </label>
          <input
            type="text"
            placeholder="Receipt document URL or reference identifier (optional)"
            value={receiptUrl}
            onChange={(e) => setReceiptUrl(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Notes / Location Details</label>
          <textarea
            rows={2}
            placeholder="Additional trip route details, toll plaza names, or breakdown remarks..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Modal Actions */}
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
            disabled={loading || (Boolean(expenseToEdit?.isSettled) && !isAuthorizedCorrection)}
            className="px-5 py-2.5 text-xs font-semibold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm shadow-indigo-200 transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer"
          >
            {loading ? (
              <span>Saving...</span>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>{isEdit ? 'Update Expense' : 'Record Expense'}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
