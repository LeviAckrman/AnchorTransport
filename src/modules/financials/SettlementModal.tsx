import React, { useState, useEffect } from 'react';
import {
  Scale,
  IndianRupee,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Receipt,
  Wallet,
  Clock,
  ShieldCheck,
  User,
  Truck,
  ArrowRight,
  Info,
} from 'lucide-react';
import { TripSettlement, Trip, DriverAdvance, TripExpense, SettlementStatus, UserRole } from '../../types/tms';
import { Modal } from '../../components/ui/Modal';
import { formatINR, paiseToRupees } from '../../lib/currency';
import { calculateDriverSettlement, DriverSettlementCalculation } from '../../lib/financialEngine';
import { parseResponseJson } from '../../lib/safeFetch';
import { useAuth } from '../../context/AuthContext';

interface SettlementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (settlement: TripSettlement, isEdit: boolean) => void;
  settlementToEdit?: TripSettlement | null;
  defaultTripId?: string;
}

export const SettlementModal: React.FC<SettlementModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  settlementToEdit,
  defaultTripId,
}) => {
  const { token, role } = useAuth();
  const isEdit = Boolean(settlementToEdit);
  const isAlreadyFinalized = settlementToEdit?.status === 'FINALIZED' || settlementToEdit?.status === 'APPROVED_SETTLED';

  const [trips, setTrips] = useState<Trip[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);

  // Form inputs
  const [tripId, setTripId] = useState(defaultTripId || '');
  const [driverBataDays, setDriverBataDays] = useState('2');
  const [deductionsRupees, setDeductionsRupees] = useState('0');
  const [deductionReason, setDeductionReason] = useState('');
  const [settlementNotes, setSettlementNotes] = useState('');
  const [targetStatus, setTargetStatus] = useState<SettlementStatus>('FINALIZED');

  // Authorized correction state for locked settlements
  const [isCorrectionAuthorized, setIsCorrectionAuthorized] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');

  // Trip dossier data
  const [advances, setAdvances] = useState<DriverAdvance[]>([]);
  const [expenses, setExpenses] = useState<TripExpense[]>([]);
  const [loadingDossier, setLoadingDossier] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch available trips
  useEffect(() => {
    if (isOpen) {
      setLoadingTrips(true);
      fetch('/api/trips?limit=100', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then((res) => parseResponseJson<any>(res))
        .then((data) => {
          if (data && data.success) {
            setTrips(data.data || []);
            if (!tripId && defaultTripId) {
              setTripId(defaultTripId);
            } else if (!tripId && data.data?.length > 0) {
              // Prefer trips in DELIVERED or IN_TRANSIT that are unsettled
              const delivered = data.data.find((t: Trip) => t.status === 'DELIVERED' && !t.isSettled);
              setTripId(delivered ? delivered.id : data.data[0].id);
            }
          }
        })
        .catch((err) => console.warn('Failed to load trips for settlement modal:', err))
        .finally(() => setLoadingTrips(false));
    }
  }, [isOpen, defaultTripId, token]);

  // Load trip-specific advances and expenses when tripId changes
  useEffect(() => {
    if (tripId && isOpen) {
      setLoadingDossier(true);
      fetch(`/api/trips/${tripId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then((res) => parseResponseJson<any>(res))
        .then((data) => {
          if (data && data.success) {
            setAdvances(data.advances || []);
            setExpenses(data.expenses || []);

            // Auto-compute trip days if dispatchDate and actualDeliveryDate exist
            if (data.trip) {
              const start = new Date(data.trip.dispatchDate).getTime();
              const end = data.trip.actualDeliveryDate ? new Date(data.trip.actualDeliveryDate).getTime() : Date.now();
              const diffDays = Math.max(1, Math.ceil((end - start) / (1000 * 3600 * 24)));
              if (!settlementToEdit) {
                setDriverBataDays(diffDays.toString());
              }
            }
          }
        })
        .catch((err) => console.warn('Failed to load trip dossier:', err))
        .finally(() => setLoadingDossier(false));
    }
  }, [tripId, isOpen, settlementToEdit, token]);

  // Populate from settlementToEdit if editing
  useEffect(() => {
    if (settlementToEdit) {
      setTripId(settlementToEdit.tripId);
      setDeductionsRupees(((settlementToEdit.approvedDeductionsPaise || settlementToEdit.otherDeductionsPaise || 0) / 100).toString());
      setDeductionReason(settlementToEdit.deductionReason || '');
      setSettlementNotes(settlementToEdit.settlementNotes || '');
      setTargetStatus(settlementToEdit.status);
      setIsCorrectionAuthorized(Boolean(settlementToEdit.isCorrectionAuthorized));
      setCorrectionReason(settlementToEdit.correctionReason || '');
    } else {
      setDeductionsRupees('0');
      setDeductionReason('');
      setSettlementNotes('');
      setTargetStatus('FINALIZED');
      setIsCorrectionAuthorized(false);
      setCorrectionReason('');
      setError(null);
    }
  }, [settlementToEdit, isOpen]);

  const selectedTrip = trips.find((t) => t.id === tripId);
  const perDayBataPaise = 50000; // ₹500 default daily driver bata

  const parsedDeductionsPaise = Math.round((parseFloat(deductionsRupees) || 0) * 100);
  const parsedDays = parseInt(driverBataDays, 10) || 1;

  // Live calculation
  const calc: DriverSettlementCalculation = calculateDriverSettlement(
    advances,
    expenses,
    parsedDays,
    perDayBataPaise,
    parsedDeductionsPaise
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!tripId) {
      setError('Please select a trip to reconcile.');
      return;
    }

    if (isAlreadyFinalized && isCorrectionAuthorized && !correctionReason.trim()) {
      setError('An authorized correction reason is required to alter a finalized settlement.');
      return;
    }

    setLoading(true);

    try {
      const payload = {
        tripId,
        status: targetStatus,
        driverBataDays: parsedDays,
        approvedDeductionsPaise: parsedDeductionsPaise,
        otherDeductionsPaise: parsedDeductionsPaise,
        deductionReason: deductionReason.trim() || undefined,
        settlementNotes: settlementNotes.trim() || undefined,
        isCorrectionAuthorized,
        correctionReason: correctionReason.trim() || undefined,
      };

      const url = isEdit ? `/api/settlements/${settlementToEdit!.id}` : '/api/settlements';
      const method = isEdit ? 'PUT' : 'POST';

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(payload),
      });

      const data = await parseResponseJson<any>(res);
      if (!res.ok || !data || !data.success) {
        throw new Error(data?.error || 'Failed to complete settlement.');
      }

      onSuccess(data.settlement, isEdit);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error occurred while saving settlement.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? `Review Settlement: ${settlementToEdit?.settlementNumber || settlementToEdit?.id}` : 'Reconcile Driver Trip Settlement'}
      maxWidth="2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Finalized Settlement Lock Banner */}
        {isAlreadyFinalized && (
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2">
            <div className="flex items-center gap-2 font-bold">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Finalized Audit Lock: This settlement has been finalized and audited into the company ledger.
            </div>
            <p>
              Modifications to finalized settlements require an authorized correction reason and Administrator privileges.
            </p>
            {(role === 'OWNER' || role === 'ADMIN') && (
              <div className="pt-2 border-t border-amber-200">
                <label className="flex items-center gap-2 font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isCorrectionAuthorized}
                    onChange={(e) => setIsCorrectionAuthorized(e.target.checked)}
                    className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                  />
                  <span>Authorize financial correction on finalized settlement</span>
                </label>
                {isCorrectionAuthorized && (
                  <input
                    type="text"
                    required
                    placeholder="Mandatory correction reason (e.g. Audit reconciliation adjustment for diesel slip #8492)..."
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                    className="mt-2 w-full px-3 py-1.5 text-xs rounded-lg border border-amber-300 bg-white"
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* 1. Trip Selection */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Trip to Settle <span className="text-rose-500">*</span>
          </label>
          <select
            value={tripId}
            onChange={(e) => setTripId(e.target.value)}
            disabled={isEdit && !isCorrectionAuthorized}
            required
            className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100"
          >
            {loadingTrips ? (
              <option value="">Loading trips...</option>
            ) : trips.length === 0 ? (
              <option value="">No trips available</option>
            ) : (
              trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.tripNumber} — {t.driverName} ({t.vehicleReg}) [{t.status}] {t.isSettled ? '✓ ALREADY SETTLED' : ''}
                </option>
              ))
            )}
          </select>
          {selectedTrip && (
            <div className="mt-2 flex items-center justify-between text-xs p-2.5 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex items-center gap-3">
                <span>Driver: <strong>{selectedTrip.driverName}</strong></span>
                <span className="text-slate-300">|</span>
                <span>Vehicle: <strong>{selectedTrip.vehicleReg}</strong></span>
                <span className="text-slate-300">|</span>
                <span>Route: <strong>{selectedTrip.originCity} → {selectedTrip.destinationCity}</strong></span>
              </div>
              <span className={`px-2 py-0.5 rounded-full font-bold ${
                selectedTrip.isSettled ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }`}>
                {selectedTrip.isSettled ? 'Settled' : 'Pending Settlement'}
              </span>
            </div>
          )}
        </div>

        {/* 2. Interactive Calculation Dashboard */}
        <div className="bg-slate-900 text-white p-5 rounded-2xl space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold block">
                Settlement Formula
              </span>
              <span className="text-xs text-indigo-300 font-medium">
                Total Advances − Approved Deductions & Cash Expenses = Remaining Balance
              </span>
            </div>
            <Scale className="w-5 h-5 text-indigo-400" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-white/5 rounded-xl border border-white/10">
              <span className="text-slate-400 block mb-1">Total Advances</span>
              <span className="text-lg font-bold text-white block">
                {formatINR(calc.totalAdvancesGivenPaise)}
              </span>
              <span className="text-[11px] text-slate-400">
                {advances.length} disbursement{advances.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="p-3 bg-white/5 rounded-xl border border-white/10">
              <span className="text-slate-400 block mb-1">Driver Cash Vouchers</span>
              <span className="text-lg font-bold text-emerald-400 block">
                {formatINR(calc.driverPaidExpensesPaise)}
              </span>
              <span className="text-[11px] text-slate-400">
                Paid from advance
              </span>
            </div>

            <div className="p-3 bg-white/5 rounded-xl border border-white/10">
              <span className="text-slate-400 block mb-1">Driver Bata ({parsedDays}d)</span>
              <span className="text-lg font-bold text-emerald-400 block">
                {formatINR(calc.driverBataAllowancePaise)}
              </span>
              <span className="text-[11px] text-slate-400">
                @ {formatINR(perDayBataPaise, true)}/day
              </span>
            </div>

            <div className="p-3 bg-white/5 rounded-xl border border-white/10">
              <span className="text-slate-400 block mb-1">Approved Deductions</span>
              <span className="text-lg font-bold text-rose-400 block">
                {formatINR(calc.approvedDeductionsPaise)}
              </span>
              <span className="text-[11px] text-slate-400">
                Shortages / fines
              </span>
            </div>
          </div>

          {/* Net Settlement Balance Result Card */}
          <div className="p-4 rounded-xl bg-white/10 border border-white/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <span className="text-xs uppercase font-bold tracking-wider text-slate-300 block">
                {calc.netPayableToDriverPaise >= 0 ? 'Net Final Payment to Driver' : 'Remaining Driver Cash Refund'}
              </span>
              <div className="text-2xl font-black mt-0.5">
                {calc.netPayableToDriverPaise >= 0 ? (
                  <span className="text-emerald-400">
                    Company Pays Driver: {formatINR(calc.netPayableToDriverPaise)}
                  </span>
                ) : (
                  <span className="text-amber-300">
                    Driver Refunds Cash: {formatINR(Math.abs(calc.netPayableToDriverPaise))}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Remaining Driver Balance: {formatINR(calc.remainingDriverBalancePaise)}
              </div>
            </div>

            <div className="text-xs px-3 py-1.5 rounded-lg font-bold bg-white/20 text-white">
              {calc.netPayableToDriverPaise >= 0 ? 'Payable Shortfall' : 'Surplus Float to Return'}
            </div>
          </div>
        </div>

        {/* 3. Input Controls: Bata Days & Deductions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Trip Duration (Days for Bata Allowance)
            </label>
            <input
              type="number"
              min="0"
              max="60"
              value={driverBataDays}
              onChange={(e) => setDriverBataDays(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 font-bold"
            />
            <span className="text-[11px] text-slate-500 mt-0.5 block">
              Driver daily bata rate: {formatINR(perDayBataPaise, true)}/day
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Approved Deductions (₹ Rupees)
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 font-bold">
                ₹
              </span>
              <input
                type="number"
                step="1"
                min="0"
                value={deductionsRupees}
                onChange={(e) => setDeductionsRupees(e.target.value)}
                placeholder="0"
                className="w-full pl-8 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 font-bold"
              />
            </div>
            <span className="text-[11px] text-slate-500 mt-0.5 block">
              Fuel shortfall penalties, cargo damage, or unverified vouchers
            </span>
          </div>
        </div>

        {/* Deduction Reason */}
        {parsedDeductionsPaise > 0 && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Approved Deduction Reason <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Unexplained 15L diesel shortage at Durgapur toll or damaged tarpaulin"
              value={deductionReason}
              onChange={(e) => setDeductionReason(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Settlement Notes / Remarks
          </label>
          <textarea
            rows={2}
            placeholder="Audit verification remarks, cash receipt voucher numbers, or handover notes..."
            value={settlementNotes}
            onChange={(e) => setSettlementNotes(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Status Selection */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Audit State & Finalization
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={`p-3 rounded-xl border text-xs cursor-pointer flex items-start gap-2.5 ${
              targetStatus === 'PENDING_APPROVAL' || targetStatus === 'DRAFT'
                ? 'border-indigo-600 bg-indigo-50/70 font-bold text-indigo-950'
                : 'border-slate-200 bg-white text-slate-700'
            }`}>
              <input
                type="radio"
                name="targetStatus"
                value="PENDING_APPROVAL"
                checked={targetStatus === 'PENDING_APPROVAL' || targetStatus === 'DRAFT'}
                onChange={() => setTargetStatus('PENDING_APPROVAL')}
                className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
              />
              <div>
                <span className="block font-bold">Draft / In Review</span>
                <span className="text-[11px] text-slate-500 font-normal">
                  Keeps the trip open for further voucher additions
                </span>
              </div>
            </label>

            <label className={`p-3 rounded-xl border text-xs cursor-pointer flex items-start gap-2.5 ${
              targetStatus === 'FINALIZED' || targetStatus === 'APPROVED_SETTLED'
                ? 'border-emerald-600 bg-emerald-50/70 font-bold text-emerald-950'
                : 'border-slate-200 bg-white text-slate-700'
            }`}>
              <input
                type="radio"
                name="targetStatus"
                value="FINALIZED"
                checked={targetStatus === 'FINALIZED' || targetStatus === 'APPROVED_SETTLED'}
                onChange={() => setTargetStatus('FINALIZED')}
                className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
              />
              <div>
                <span className="block font-bold">Finalize & Lock Settlement</span>
                <span className="text-[11px] text-slate-500 font-normal">
                  Locks vouchers and marks trip as settled
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2.5 text-xs font-semibold rounded-xl text-slate-700 hover:bg-slate-100 border border-slate-300 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || (isAlreadyFinalized && !isCorrectionAuthorized)}
            className="px-5 py-2.5 text-xs font-semibold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm shadow-indigo-200 flex items-center gap-2"
          >
            {loading ? (
              <span>Processing...</span>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>{targetStatus === 'FINALIZED' ? 'Finalize Settlement' : 'Save Draft Settlement'}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
