import React, { useState, useEffect } from 'react';
import {
  Navigation,
  Truck,
  Users,
  Building2,
  Calendar,
  IndianRupee,
  AlertTriangle,
  Scale,
  Clock,
  MapPin,
  CheckCircle2,
  FileText,
  Fuel,
  Receipt,
  Plus,
  ArrowRight,
  TrendingUp,
  ShieldCheck,
  Phone,
  FileCheck2,
  Gauge,
  XCircle,
  CreditCard,
} from 'lucide-react';
import { Trip, Vehicle, Driver, Customer, TripExpense, DriverAdvance, TripStatus, UserRole } from '../../types/tms';
import { Modal } from '../../components/ui/Modal';
import { Badge, BadgeVariant } from '../../components/ui/Badge';
import { formatINR, paiseToRupees } from '../../lib/currency';
import { TripStatusTransitionModal } from './TripStatusTransitionModal';
import { useAuth } from '../../context/AuthContext';
import { parseResponseJson } from '../../lib/safeFetch';

interface TripDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  tripId: string | null;
  onTripUpdated?: () => void;
  userRole?: UserRole;
}

export const TripDetailModal: React.FC<TripDetailModalProps> = ({
  isOpen,
  onClose,
  tripId,
  onTripUpdated,
  userRole = 'OWNER',
}) => {
  const { token } = useAuth();
  const activeToken = token || (typeof window !== 'undefined' ? localStorage.getItem('token') || '' : '');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    trip: Trip;
    vehicle: Vehicle | null;
    driver: Driver | null;
    customer: Customer | null;
    expenses: TripExpense[];
    advances: DriverAdvance[];
    financials: {
      totalRevenuePaise: number;
      totalExpensesPaise: number;
      totalAdvancesPaise: number;
      tripContributionPaise: number;
      profitMarginPercent: number;
      fuelExpensesPaise: number;
      tollExpensesPaise: number;
      otherExpensesPaise: number;
    };
    allowedNextStatuses: TripStatus[];
  } | null>(null);

  const [activeTab, setActiveTab] = useState<'overview' | 'expenses' | 'advances' | 'workflow'>('overview');
  const [targetStatusToChange, setTargetStatusToChange] = useState<TripStatus | null>(null);

  // Quick Expense Modal State
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [expenseCategory, setExpenseCategory] = useState<'DIESEL' | 'TOLL_FASTAG' | 'DRIVER_BATA' | 'LOADING_UNLOADING' | 'OTHER'>('DIESEL');
  const [expenseAmountRupees, setExpenseAmountRupees] = useState('');
  const [expensePaymentMode, setExpensePaymentMode] = useState<'CASH' | 'FASTAG' | 'PETRO_CARD' | 'DRIVER_POCKET'>('CASH');
  const [expensePumpName, setExpensePumpName] = useState('');
  const [expenseLitres, setExpenseLitres] = useState('');
  const [expenseNotes, setExpenseNotes] = useState('');

  // Quick Advance Modal State
  const [isAddAdvanceOpen, setIsAddAdvanceOpen] = useState(false);
  const [advanceAmountRupees, setAdvanceAmountRupees] = useState('');
  const [advanceNotes, setAdvanceNotes] = useState('');

  const fetchTripDetails = async () => {
    if (!tripId) return;
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;

      const res = await fetch(`/api/trips/${tripId}`, { headers });
      const json = await parseResponseJson<any>(res);
      if (!res.ok || !json || !json.success) {
        throw new Error(json?.error || 'Failed to fetch trip details.');
      }
      setData(json);
    } catch (err: any) {
      setError(err.message || 'Error loading trip dossier.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && tripId) {
      fetchTripDetails();
    } else {
      setData(null);
      setActiveTab('overview');
    }
  }, [isOpen, tripId]);

  if (!isOpen) return null;

  const getStatusBadge = (status: TripStatus): { variant: BadgeVariant; label: string } => {
    switch (status) {
      case 'PLANNED':
        return { variant: 'slate', label: 'Planned' };
      case 'DISPATCHED':
        return { variant: 'info', label: 'Dispatched' };
      case 'IN_TRANSIT':
        return { variant: 'purple', label: 'In Transit' };
      case 'DELIVERED':
        return { variant: 'warning', label: 'Delivered' };
      case 'COMPLETED':
      case 'SETTLED':
        return { variant: 'success', label: 'Completed' };
      case 'CANCELLED':
        return { variant: 'danger', label: 'Cancelled' };
      default:
        return { variant: 'slate', label: status };
    }
  };

  const handleStatusTransitionConfirm = async (transitionData: {
    targetStatus: TripStatus;
    cancellationReason?: string;
    actualDeliveryDate?: string;
    endOdometerKm?: number;
    podReceived?: boolean;
    podRemarks?: string;
  }) => {
    if (!tripId) return;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;

    const res = await fetch(`/api/trips/${tripId}/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        status: transitionData.targetStatus,
        cancellationReason: transitionData.cancellationReason,
        actualDeliveryDate: transitionData.actualDeliveryDate,
        endOdometerKm: transitionData.endOdometerKm,
        podReceived: transitionData.podReceived,
        podRemarks: transitionData.podRemarks,
      }),
    });

    const json = await parseResponseJson<any>(res);
    if (!res.ok || !json || !json.success) {
      throw new Error(json?.error || 'Failed to transition status.');
    }

    await fetchTripDetails();
    if (onTripUpdated) onTripUpdated();
  };

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tripId) return;
    try {
      const amountPaise = Math.round(parseFloat(expenseAmountRupees) * 100);
      if (isNaN(amountPaise) || amountPaise <= 0) {
        throw new Error('Please enter a valid expense amount.');
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;

      const res = await fetch(`/api/trips/${tripId}/expenses`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          category: expenseCategory,
          amountPaise,
          paymentMode: expensePaymentMode,
          litres: expenseLitres ? parseFloat(expenseLitres) : undefined,
          petrolPumpName: expensePumpName,
          notes: expenseNotes,
        }),
      });

      const json = await parseResponseJson<any>(res);
      if (!res.ok || !json || !json.success) {
        throw new Error(json?.error || 'Failed to record expense.');
      }

      setIsAddExpenseOpen(false);
      setExpenseAmountRupees('');
      setExpenseNotes('');
      setExpensePumpName('');
      setExpenseLitres('');
      await fetchTripDetails();
      if (onTripUpdated) onTripUpdated();
    } catch (err: any) {
      alert(err.message || 'Error recording expense.');
    }
  };

  const handleCreateAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tripId) return;
    try {
      const amountPaise = Math.round(parseFloat(advanceAmountRupees) * 100);
      if (isNaN(amountPaise) || amountPaise <= 0) {
        throw new Error('Please enter a valid advance amount.');
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;

      const res = await fetch(`/api/trips/${tripId}/advances`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          amountPaise,
          advanceType: 'CASH_EN_ROUTE',
          referenceNotes: advanceNotes,
        }),
      });

      const json = await parseResponseJson<any>(res);
      if (!res.ok || !json || !json.success) {
        throw new Error(json?.error || 'Failed to disburse advance.');
      }

      setIsAddAdvanceOpen(false);
      setAdvanceAmountRupees('');
      setAdvanceNotes('');
      await fetchTripDetails();
      if (onTripUpdated) onTripUpdated();
    } catch (err: any) {
      alert(err.message || 'Error recording advance.');
    }
  };

  const trip = data?.trip;
  const statusBadge = trip ? getStatusBadge(trip.status) : { variant: 'slate' as BadgeVariant, label: '' };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="" size="xl">
      {loading ? (
        <div className="py-16 text-center space-y-3">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-medium">Loading Trip Dossier...</p>
        </div>
      ) : error || !data || !trip ? (
        <div className="py-12 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
          <p className="text-sm font-semibold text-slate-800">{error || 'Trip record not found.'}</p>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      ) : (
        <div className="space-y-5 antialiased">
          {/* Dossier Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-lg text-slate-900">{trip.tripNumber}</span>
                <span className="px-2 py-0.5 font-mono text-xs font-semibold bg-indigo-50 text-indigo-700 rounded-md border border-indigo-200">
                  LR: {trip.lrNumber}
                </span>
                <Badge variant={statusBadge.variant} dot>
                  {statusBadge.label}
                </Badge>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Booked for {trip.customerName} | Dispatched: {trip.dispatchDate}
              </p>
            </div>

            {/* Quick Status Action Buttons */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {data.allowedNextStatuses.map((st) => (
                <button
                  key={st}
                  onClick={() => setTargetStatusToChange(st)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer flex items-center gap-1 ${
                    st === 'CANCELLED'
                      ? 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                      : st === 'COMPLETED'
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  <span>Mark {st}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Cancellation Notice if Cancelled */}
          {trip.status === 'CANCELLED' && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
              <XCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <div>
                <span className="font-semibold block">Trip Cancelled</span>
                <span>
                  Reason: {trip.cancellationReason || 'No specific cancellation remarks logged.'}
                </span>
                {trip.cancelledAt && (
                  <span className="block text-[11px] text-rose-600 mt-0.5">
                    Cancelled on {new Date(trip.cancelledAt).toLocaleString()} by {trip.cancelledBy || 'User'}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Route & Cargo Banner */}
          <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-4 rounded-2xl shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm sm:text-base font-semibold">
                <span className="flex items-center gap-1 text-slate-200">
                  <MapPin className="w-4 h-4 text-emerald-400" />
                  {trip.originCity}
                </span>
                <span className="text-indigo-400 font-bold">→</span>
                <span className="flex items-center gap-1 text-white font-bold">
                  <MapPin className="w-4 h-4 text-indigo-400" />
                  {trip.destinationCity}
                </span>
              </div>

              <div className="text-right">
                <span className="text-[11px] text-indigo-300 uppercase tracking-wider block">Agreed Freight</span>
                <span className="font-bold text-lg text-emerald-300">
                  {formatINR(trip.totalRevenuePaise)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-indigo-900/60 text-xs text-indigo-200">
              <div>
                <span className="text-indigo-400 text-[10px] uppercase block">Cargo Goods</span>
                <span className="font-medium text-white">{trip.goodsType}</span>
              </div>
              <div>
                <span className="text-indigo-400 text-[10px] uppercase block">Weight & Rate</span>
                <span className="font-medium text-white">
                  {trip.weightTonnes} T @ ₹{paiseToRupees(trip.ratePerTonnePaise)}/T
                </span>
              </div>
              <div>
                <span className="text-indigo-400 text-[10px] uppercase block">Truck Assigned</span>
                <span className="font-medium font-mono text-white">{trip.vehicleReg}</span>
              </div>
              <div>
                <span className="text-indigo-400 text-[10px] uppercase block">Driver on Duty</span>
                <span className="font-medium text-white">{trip.driverName}</span>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 border-b border-slate-200 text-xs font-semibold">
            {[
              { id: 'overview', label: 'Overview & Specs', icon: FileText },
              { id: 'expenses', label: `Trip Expenses (${data.expenses.length})`, icon: Fuel },
              { id: 'advances', label: `Driver Advances (${data.advances.length})`, icon: CreditCard },
              { id: 'workflow', label: 'Operational Lifecycle', icon: CheckCircle2 },
            ].map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id as any)}
                  className={`pb-2.5 px-3 flex items-center gap-1.5 transition-colors border-b-2 ${
                    activeTab === t.id
                      ? 'border-indigo-600 text-indigo-600 font-bold'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* TAB 1: OVERVIEW & SPECS */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {/* Financial KPI Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Freight Revenue</span>
                  <span className="font-bold text-slate-900 text-base">{formatINR(data.financials.totalRevenuePaise)}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Recorded Expenses</span>
                  <span className="font-bold text-rose-700 text-base">{formatINR(data.financials.totalExpensesPaise)}</span>
                </div>
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                  <span className="text-[10px] font-semibold text-emerald-800 uppercase tracking-wider block">Trip Contribution</span>
                  <span className="font-bold text-emerald-900 text-base">{formatINR(data.financials.tripContributionPaise)}</span>
                </div>
                <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-200">
                  <span className="text-[10px] font-semibold text-indigo-800 uppercase tracking-wider block">Operating Margin</span>
                  <span className="font-bold text-indigo-900 text-base">{data.financials.profitMarginPercent}%</span>
                </div>
              </div>

              {/* Entity Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                {/* Customer */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 border-b border-slate-100 pb-1.5">
                    <Building2 className="w-4 h-4 text-indigo-600" />
                    <span>Customer & Billing</span>
                  </div>
                  <p className="font-semibold text-slate-800">{data.customer?.name || trip.customerName}</p>
                  <p className="font-mono text-slate-500 text-[11px]">GSTIN: {data.customer?.gstin || trip.customerGstin}</p>
                  {data.customer && (
                    <p className="text-slate-600 text-[11px]">
                      {data.customer.billingAddress}, {data.customer.city}, {data.customer.state} - {data.customer.pincode}
                    </p>
                  )}
                </div>

                {/* Truck */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 border-b border-slate-100 pb-1.5">
                    <Truck className="w-4 h-4 text-indigo-600" />
                    <span>Assigned Truck</span>
                  </div>
                  <p className="font-mono font-bold text-slate-900">{data.vehicle?.registrationNumber || trip.vehicleReg}</p>
                  <p className="text-slate-600">{data.vehicle?.makeModel} ({data.vehicle?.vehicleType})</p>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                    <span>Odometer: {data.vehicle?.currentOdometerKm.toLocaleString()} KM</span>
                    <span>FastTag: {formatINR(data.vehicle?.fastagBalancePaise || 0)}</span>
                  </div>
                </div>

                {/* Driver */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 border-b border-slate-100 pb-1.5">
                    <Users className="w-4 h-4 text-indigo-600" />
                    <span>Driver on Duty</span>
                  </div>
                  <p className="font-semibold text-slate-900">{data.driver?.fullName || trip.driverName}</p>
                  <p className="text-slate-600 flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>{data.driver?.phone || trip.driverPhone}</span>
                  </p>
                  <p className="text-slate-500 text-[11px]">DL: {data.driver?.licenseNumber}</p>
                </div>
              </div>

              {/* Operational Mileage & Readings */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2 text-xs">
                <span className="font-bold text-slate-900 uppercase tracking-wider text-[10px] block">
                  Trip Operational Readings & Consignee Remarks
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <span className="text-slate-400 text-[10px] block">Start Odometer</span>
                    <span className="font-mono font-semibold text-slate-800">{trip.startOdometerKm.toLocaleString()} KM</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">End Odometer</span>
                    <span className="font-mono font-semibold text-slate-800">
                      {trip.endOdometerKm ? `${trip.endOdometerKm.toLocaleString()} KM` : 'En Route'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">POD Status</span>
                    <span className={`font-semibold ${trip.podReceived ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {trip.podReceived ? '✓ Stamped POD Received' : 'Pending Stamped Copy'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">Actual Delivery Date</span>
                    <span className="font-semibold text-slate-800">
                      {trip.actualDeliveryDate ? trip.actualDeliveryDate.split('T')[0] : 'In Transit'}
                    </span>
                  </div>
                </div>

                {trip.podRemarks && (
                  <p className="text-[11px] text-slate-600 bg-white p-2 rounded-lg border border-slate-200 mt-2">
                    <strong>Receiver Note:</strong> {trip.podRemarks}
                  </p>
                )}
                {trip.notes && (
                  <p className="text-[11px] text-slate-600 bg-white p-2 rounded-lg border border-slate-200 mt-1">
                    <strong>Booking Instructions:</strong> {trip.notes}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: TRIP EXPENSES */}
          {activeTab === 'expenses' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Recorded Fuel, Toll & En-Route Expenses
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Total: {formatINR(data.financials.totalExpensesPaise)}
                  </p>
                </div>
                <button
                  onClick={() => setIsAddExpenseOpen(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Record Expense</span>
                </button>
              </div>

              {data.expenses.length === 0 ? (
                <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400 text-xs">
                  No expenses recorded for this trip yet. Click "Record Expense" to add diesel or FastTag toll slips.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white text-xs">
                  {data.expenses.map((exp) => (
                    <div key={exp.id} className="p-3 flex items-center justify-between hover:bg-slate-50">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">{exp.category.replace('_', ' ')}</span>
                          <span className="px-2 py-0.5 bg-slate-100 rounded text-[10px] font-medium text-slate-600">
                            {exp.paymentMode}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          {exp.expenseDate} {exp.petrolPumpName ? `• ${exp.petrolPumpName}` : ''} {exp.litres ? `• ${exp.litres}L` : ''} {exp.location ? `• ${exp.location}` : ''}
                        </p>
                        {exp.notes && <p className="text-[11px] text-slate-400 italic">{exp.notes}</p>}
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-rose-700 text-sm block">
                          {formatINR(exp.amountPaise)}
                        </span>
                        <span className="text-[10px] text-slate-400">By {exp.recordedBy}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: DRIVER ADVANCES */}
          {activeTab === 'advances' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Driver Cash & UPI Advances
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Total Disbursed: {formatINR(data.financials.totalAdvancesPaise)} (Advances do NOT reduce trip revenue)
                  </p>
                </div>
                <button
                  onClick={() => setIsAddAdvanceOpen(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Disburse Advance</span>
                </button>
              </div>

              {data.advances.length === 0 ? (
                <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400 text-xs">
                  No cash advances recorded for this trip. Click "Disburse Advance" to record cash handed to the driver.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white text-xs">
                  {data.advances.map((adv) => (
                    <div key={adv.id} className="p-3 flex items-center justify-between hover:bg-slate-50">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">{adv.advanceType.replace('_', ' ')}</span>
                          <Badge variant={adv.isSettled ? 'success' : 'amber'} size="sm">
                            {adv.isSettled ? 'Settled' : 'Pending Reconciliation'}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-slate-500">{adv.date} • Disbursed by {adv.disbursedBy}</p>
                        {adv.referenceNotes && <p className="text-[11px] text-slate-400">{adv.referenceNotes}</p>}
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-amber-700 text-sm block">
                          {formatINR(adv.amountPaise)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: OPERATIONAL WORKFLOW */}
          {activeTab === 'workflow' && (
            <div className="space-y-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                  Trip Operational Workflow Progression
                </span>
                <p className="text-xs text-slate-600 leading-relaxed">
                  AnchorTransport TMS follows a strict, sequential state machine ensuring fleet transparency, prevent duplicate driver assignments, and preserve audit histories.
                </p>

                {/* Visual Step Indicator */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2">
                  {[
                    { id: 'PLANNED', label: '1. Planned' },
                    { id: 'DISPATCHED', label: '2. Dispatched' },
                    { id: 'IN_TRANSIT', label: '3. In Transit' },
                    { id: 'DELIVERED', label: '4. Delivered' },
                    { id: 'COMPLETED', label: '5. Completed' },
                  ].map((st, i) => {
                    const isCurrent = trip.status === st.id;
                    const isPast = ['PLANNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'].indexOf(trip.status) >= i;
                    return (
                      <div
                        key={st.id}
                        className={`p-2.5 rounded-xl border text-center text-xs font-semibold ${
                          isCurrent
                            ? 'bg-indigo-600 text-white border-indigo-700 shadow-sm'
                            : isPast
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-white text-slate-400 border-slate-200'
                        }`}
                      >
                        {st.label}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Status Action Buttons */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                  Available Workflow Actions
                </span>

                {data.allowedNextStatuses.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">
                    This trip is in terminal state ({trip.status}). No further state changes are permitted.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {data.allowedNextStatuses.map((st) => (
                      <button
                        key={st}
                        onClick={() => setTargetStatusToChange(st)}
                        className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors shadow-xs ${
                          st === 'CANCELLED'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                            : st === 'COMPLETED'
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                            : 'bg-indigo-600 text-white hover:bg-indigo-700'
                        }`}
                      >
                        Advance to {st}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quick Expense Sub-Modal */}
          {isAddExpenseOpen && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4">
                <h4 className="font-bold text-sm text-slate-900">Record Trip Expense ({trip.tripNumber})</h4>
                <form onSubmit={handleCreateExpense} className="space-y-3 text-xs">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Expense Category</label>
                    <select
                      value={expenseCategory}
                      onChange={(e) => setExpenseCategory(e.target.value as any)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="DIESEL">Diesel / Fuel</option>
                      <option value="TOLL_FASTAG">FastTag / Toll Deduction</option>
                      <option value="DRIVER_BATA">Driver Bata / Daily Allowance</option>
                      <option value="LOADING_UNLOADING">Loading / Labour Charges</option>
                      <option value="OTHER">En-Route Repair / Weighbridge</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Amount (₹)</label>
                    <input
                      type="number"
                      value={expenseAmountRupees}
                      onChange={(e) => setExpenseAmountRupees(e.target.value)}
                      placeholder="e.g. 5500"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                      required
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Payment Mode</label>
                    <select
                      value={expensePaymentMode}
                      onChange={(e) => setExpensePaymentMode(e.target.value as any)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="CASH">Cash / Paid from Advance</option>
                      <option value="FASTAG">FastTag Wallet Deduction</option>
                      <option value="PETRO_CARD">Company PetroCard (IndianOil / HPCL)</option>
                      <option value="DRIVER_POCKET">Driver Out of Pocket (Reimbursable)</option>
                    </select>
                  </div>

                  {expenseCategory === 'DIESEL' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Litres</label>
                        <input
                          type="number"
                          step="0.1"
                          value={expenseLitres}
                          onChange={(e) => setExpenseLitres(e.target.value)}
                          placeholder="e.g. 60.5"
                          className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Petrol Pump Name</label>
                        <input
                          type="text"
                          value={expensePumpName}
                          onChange={(e) => setExpensePumpName(e.target.value)}
                          placeholder="e.g. IOCL Dankuni"
                          className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Notes / Slip Number</label>
                    <input
                      type="text"
                      value={expenseNotes}
                      onChange={(e) => setExpenseNotes(e.target.value)}
                      placeholder="e.g. Bill #8812, Panagarh bypass"
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsAddExpenseOpen(false)}
                      className="px-3 py-1.5 border border-slate-300 rounded-lg text-slate-600"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700"
                    >
                      Save Expense
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Quick Advance Sub-Modal */}
          {isAddAdvanceOpen && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4">
                <h4 className="font-bold text-sm text-slate-900">Disburse Driver Cash Advance</h4>
                <p className="text-xs text-slate-500">
                  Cash or UPI transfer handed to driver <strong>{trip.driverName}</strong> for en-route diesel and expenses.
                </p>
                <form onSubmit={handleCreateAdvance} className="space-y-3 text-xs">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Advance Amount (₹)</label>
                    <input
                      type="number"
                      value={advanceAmountRupees}
                      onChange={(e) => setAdvanceAmountRupees(e.target.value)}
                      placeholder="e.g. 10000"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm"
                      required
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Disbursement Remarks / Mode</label>
                    <input
                      type="text"
                      value={advanceNotes}
                      onChange={(e) => setAdvanceNotes(e.target.value)}
                      placeholder="e.g. Handed cash at Dankuni weighbridge / GPay to driver account"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsAddAdvanceOpen(false)}
                      className="px-3 py-1.5 border border-slate-300 rounded-lg text-slate-600"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700"
                    >
                      Record Advance
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Status Transition Modal */}
          {targetStatusToChange && (
            <TripStatusTransitionModal
              isOpen={Boolean(targetStatusToChange)}
              onClose={() => setTargetStatusToChange(null)}
              trip={trip}
              targetStatus={targetStatusToChange}
              onConfirm={handleStatusTransitionConfirm}
            />
          )}
        </div>
      )}
    </Modal>
  );
};
