import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Truck,
  MapPin,
  Clock,
  FileCheck2,
  Gauge,
  Calendar,
} from 'lucide-react';
import { Trip, TripStatus } from '../../types/tms';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';

interface TripStatusTransitionModalProps {
  isOpen: boolean;
  onClose: () => void;
  trip: Trip;
  targetStatus: TripStatus;
  onConfirm: (transitionData: {
    targetStatus: TripStatus;
    cancellationReason?: string;
    actualDeliveryDate?: string;
    endOdometerKm?: number;
    podReceived?: boolean;
    podRemarks?: string;
  }) => Promise<void>;
  isLoading?: boolean;
}

export const TripStatusTransitionModal: React.FC<TripStatusTransitionModalProps> = ({
  isOpen,
  onClose,
  trip,
  targetStatus,
  onConfirm,
  isLoading = false,
}) => {
  const [cancellationReason, setCancellationReason] = useState('');
  const [endOdometerKm, setEndOdometerKm] = useState(
    trip.endOdometerKm ? trip.endOdometerKm.toString() : (trip.startOdometerKm + 350).toString()
  );
  const [actualDeliveryDate, setActualDeliveryDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [podReceived, setPodReceived] = useState(trip.podReceived || false);
  const [podRemarks, setPodRemarks] = useState(trip.podRemarks || '');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const getModalTitle = () => {
    switch (targetStatus) {
      case 'DISPATCHED':
        return `Dispatch Trip ${trip.tripNumber}`;
      case 'IN_TRANSIT':
        return `Mark Trip ${trip.tripNumber} En Route`;
      case 'DELIVERED':
        return `Confirm Consignee Delivery (${trip.tripNumber})`;
      case 'COMPLETED':
        return `Complete & Archive Trip ${trip.tripNumber}`;
      case 'CANCELLED':
        return `Cancel Trip ${trip.tripNumber}`;
      default:
        return `Update Trip Status to ${targetStatus}`;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (targetStatus === 'CANCELLED' && !cancellationReason.trim()) {
      setError('Please provide a specific reason for cancelling this trip booking.');
      return;
    }

    if (targetStatus === 'DELIVERED') {
      const odo = parseInt(endOdometerKm, 10);
      if (isNaN(odo) || odo < trip.startOdometerKm) {
        setError(`Ending odometer reading cannot be less than trip start odometer (${trip.startOdometerKm} KM).`);
        return;
      }
    }

    try {
      await onConfirm({
        targetStatus,
        cancellationReason: cancellationReason.trim() || undefined,
        actualDeliveryDate: targetStatus === 'DELIVERED' ? actualDeliveryDate : undefined,
        endOdometerKm: targetStatus === 'DELIVERED' ? parseInt(endOdometerKm, 10) : undefined,
        podReceived: targetStatus === 'DELIVERED' ? podReceived : undefined,
        podRemarks: targetStatus === 'DELIVERED' ? podRemarks.trim() || undefined : undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update trip status.');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={getModalTitle()} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Status Transition Header */}
        <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Current Status</span>
            <div className="flex items-center gap-1.5 font-medium text-slate-800 text-sm">
              <Badge variant="slate" dot>{trip.status}</Badge>
            </div>
          </div>
          <div className="text-slate-400 font-bold text-sm">→</div>
          <div className="space-y-0.5 text-right">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Target Status</span>
            <div>
              <Badge
                variant={
                  targetStatus === 'COMPLETED'
                    ? 'success'
                    : targetStatus === 'CANCELLED'
                    ? 'danger'
                    : targetStatus === 'DELIVERED'
                    ? 'warning'
                    : 'indigo'
                }
                dot
              >
                {targetStatus}
              </Badge>
            </div>
          </div>
        </div>

        {/* Trip Quick Context */}
        <div className="text-xs text-slate-600 bg-indigo-50/70 p-3 rounded-xl border border-indigo-100 flex items-center justify-between">
          <div>
            <span className="font-semibold text-slate-900 block">{trip.originCity} → {trip.destinationCity}</span>
            <span className="text-slate-500">Truck: {trip.vehicleReg} | Driver: {trip.driverName}</span>
          </div>
          <span className="font-mono font-bold text-indigo-700">{trip.lrNumber}</span>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-700 text-xs font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* TARGET SPECIFIC FIELDS */}

        {/* Case 1: DISPATCHED */}
        {targetStatus === 'DISPATCHED' && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 space-y-1.5">
            <p className="font-semibold flex items-center gap-1.5">
              <Truck className="w-4 h-4 text-blue-600" />
              <span>Confirming Vehicle & Driver Departure</span>
            </p>
            <p className="text-blue-700">
              Dispatching will mark truck <strong className="font-mono">{trip.vehicleReg}</strong> as <strong className="font-semibold">IN TRANSIT</strong> and lock it from being assigned to any other overlapping dispatch until delivered.
            </p>
          </div>
        )}

        {/* Case 2: DELIVERED */}
        {targetStatus === 'DELIVERED' && (
          <div className="space-y-3.5 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>Actual Delivery Date</span>
                </label>
                <input
                  type="date"
                  value={actualDeliveryDate}
                  onChange={(e) => setActualDeliveryDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                  <Gauge className="w-3.5 h-3.5 text-slate-400" />
                  <span>End Odometer (KM)</span>
                </label>
                <input
                  type="number"
                  value={endOdometerKm}
                  onChange={(e) => setEndOdometerKm(e.target.value)}
                  min={trip.startOdometerKm}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium font-mono focus:ring-2 focus:ring-indigo-500"
                  required
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  Trip started at {trip.startOdometerKm.toLocaleString()} KM
                </span>
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={podReceived}
                  onChange={(e) => setPodReceived(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                />
                <span className="text-xs font-semibold text-slate-800 flex items-center gap-1">
                  <FileCheck2 className="w-3.5 h-3.5 text-indigo-600" />
                  Physical / Stamped POD Received from Consignee
                </span>
              </label>

              <div>
                <input
                  type="text"
                  value={podRemarks}
                  onChange={(e) => setPodRemarks(e.target.value)}
                  placeholder="Receiver name, seal number, or weighment slip note (optional)..."
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs placeholder:text-slate-400 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* Case 3: COMPLETED */}
        {targetStatus === 'COMPLETED' && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 space-y-1.5">
            <p className="font-semibold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Operational Lifecycle Completion</span>
            </p>
            <p className="text-emerald-800 leading-relaxed">
              Completing this trip releases truck <strong className="font-mono">{trip.vehicleReg}</strong> and driver <strong className="font-semibold">{trip.driverName}</strong> back to <strong className="font-bold text-emerald-900">AVAILABLE</strong> for future trip dispatch.
            </p>
            <p className="text-[11px] text-emerald-700 italic">
              Note: Completing the trip does NOT automatically settle driver advances or mark invoices paid; financial reconciliation remains an explicit accounting step.
            </p>
          </div>
        )}

        {/* Case 4: CANCELLED */}
        {targetStatus === 'CANCELLED' && (
          <div className="space-y-3 pt-1">
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <XCircle className="w-4 h-4 text-rose-600" />
                <span>Trip Cancellation Warning</span>
              </p>
              <p className="text-rose-700">
                Cancelling this trip will liberate truck <strong className="font-mono">{trip.vehicleReg}</strong> and driver back to available duty. Historical records, LR numbers, and audit logs will be permanently retained.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Reason for Cancellation <span className="text-rose-500">*</span>
              </label>
              <textarea
                value={cancellationReason}
                onChange={(e) => setCancellationReason(e.target.value)}
                placeholder="e.g. Consignor cancelled order, mechanical breakdown before loading, weighbridge rejection..."
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-rose-500"
                required
              />
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className={`px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-xs transition-colors flex items-center gap-1.5 ${
              targetStatus === 'CANCELLED'
                ? 'bg-rose-600 hover:bg-rose-700'
                : targetStatus === 'COMPLETED'
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {isLoading ? (
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            <span>Confirm {targetStatus}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
