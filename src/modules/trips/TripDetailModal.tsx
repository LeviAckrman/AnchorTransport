import React, { useState, useEffect, useMemo } from 'react';
import {
  Truck,
  Users,
  Building2,
  AlertTriangle,
  MapPin,
  CheckCircle2,
  FileText,
  Fuel,
  Plus,
  Phone,
  XCircle,
  CreditCard,
  ExternalLink,
  Download,
  Navigation,
  Crosshair,
  Clock,
  Trash2,
  Edit3,
} from 'lucide-react';
import {
  Trip,
  TripExpense,
  DriverAdvance,
  TripStatus,
  TripLog,
  TripLogSeverity,
  TRIP_LOG_PRESET_STATUSES,
  UserRole,
} from '../../types/tms';
import { Modal } from '../../components/ui/Modal';
import { Badge, BadgeVariant } from '../../components/ui/Badge';
import { formatINR, paiseToRupees } from '../../lib/currency';
import { TripStatusTransitionModal } from './TripStatusTransitionModal';
import { useAuth } from '../../context/AuthContext';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import { getOperationalNextTripStatuses } from '../../lib/firebase/tripAuthorization';
import {
  transitionTripStatusInFirestore,
  saveExpenseInFirestore,
  createAdvanceInFirestore,
  subscribeToTripLogsInFirestore,
  saveTripLogInFirestore,
  deleteTripLogInFirestore,
} from '../../lib/firebase/firestoreService';

type TripDetailTab = 'overview' | 'expenses' | 'advances' | 'logs' | 'workflow';

function toLocalDateTimeInput(isoOrDate?: string | Date): string {
  const d = isoOrDate ? new Date(isoOrDate) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${safe.getFullYear()}-${pad(safe.getMonth() + 1)}-${pad(safe.getDate())}T${pad(
    safe.getHours()
  )}:${pad(safe.getMinutes())}`;
}

interface TripDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  tripId: string | null;
  initialTab?: TripDetailTab;
  onTripUpdated?: () => void;
  onEditTrip?: (trip: Trip) => void;
  userRole?: UserRole;
}

export const TripDetailModal: React.FC<TripDetailModalProps> = ({
  isOpen,
  onClose,
  tripId,
  initialTab = 'overview',
  onTripUpdated,
  onEditTrip,
}) => {
  const { user } = useAuth();
  const {
    company,
    trips,
    vehicles,
    drivers,
    customers,
    expenses,
    advances,
    loading,
  } = useFirestoreData();

  const [activeTab, setActiveTab] = useState<TripDetailTab>(initialTab);
  const [targetStatusToChange, setTargetStatusToChange] = useState<TripStatus | null>(null);

  // Quick Expense Modal State
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [expenseCategory, setExpenseCategory] = useState<
    'DIESEL' | 'TOLL_FASTAG' | 'DRIVER_BATA' | 'LOADING_UNLOADING' | 'OTHER'
  >('DIESEL');
  const [expenseAmountRupees, setExpenseAmountRupees] = useState('');
  const [expensePaymentMode, setExpensePaymentMode] = useState<
    'CASH' | 'FASTAG' | 'PETRO_CARD' | 'DRIVER_POCKET'
  >('CASH');
  const [expensePumpName, setExpensePumpName] = useState('');
  const [expenseLitres, setExpenseLitres] = useState('');
  const [expenseNotes, setExpenseNotes] = useState('');
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [savingExpense, setSavingExpense] = useState(false);

  // Quick Advance Modal State
  const [isAddAdvanceOpen, setIsAddAdvanceOpen] = useState(false);
  const [advanceAmountRupees, setAdvanceAmountRupees] = useState('');
  const [advanceNotes, setAdvanceNotes] = useState('');
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [savingAdvance, setSavingAdvance] = useState(false);

  // Trip Logs (sub-collection) State
  const [tripLogs, setTripLogs] = useState<TripLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [isAddLogOpen, setIsAddLogOpen] = useState(false);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [logStatusPreset, setLogStatusPreset] = useState<string>(
    TRIP_LOG_PRESET_STATUSES[0].label
  );
  const [logCustomStatus, setLogCustomStatus] = useState('');
  const [logSeverity, setLogSeverity] = useState<TripLogSeverity>('INFO');
  const [logTimestampLocal, setLogTimestampLocal] = useState<string>(() =>
    toLocalDateTimeInput()
  );
  const [logLocationNote, setLogLocationNote] = useState('');
  const [logLatitude, setLogLatitude] = useState('');
  const [logLongitude, setLogLongitude] = useState('');
  const [logOdometerKm, setLogOdometerKm] = useState('');
  const [logNotes, setLogNotes] = useState('');
  const [capturingGps, setCapturingGps] = useState(false);
  const [gpsNotice, setGpsNotice] = useState<string | null>(null);
  const [logFormError, setLogFormError] = useState<string | null>(null);
  const [savingLog, setSavingLog] = useState(false);
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab || 'overview');
    } else {
      setActiveTab('overview');
      setIsAddLogOpen(false);
      setEditingLogId(null);
      setLogFormError(null);
      setGpsNotice(null);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen || !company?.id || !tripId) {
      setTripLogs([]);
      setLogsLoading(false);
      return;
    }

    setLogsLoading(true);
    setLogsError(null);
    const unsub = subscribeToTripLogsInFirestore(
      company.id,
      tripId,
      (logs) => {
        setTripLogs(logs);
        setLogsLoading(false);
      },
      (err) => {
        setLogsError(err.message || 'Unable to load trip logs from Firestore.');
        setLogsLoading(false);
      }
    );

    return () => {
      unsub();
    };
  }, [isOpen, company?.id, tripId]);

  const data = useMemo(() => {
    if (!tripId) return null;
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return null;

    const vehicle = vehicles.find((v) => v.id === trip.vehicleId) || null;
    const driver = drivers.find((d) => d.id === trip.driverId) || null;
    const customer = customers.find((c) => c.id === trip.customerId) || null;
    const tripExpenses = expenses.filter((e) => e.tripId === trip.id);
    const tripAdvances = advances.filter((a) => a.tripId === trip.id);
    const activeTripAdvances = tripAdvances.filter((a) => a.status !== 'CANCELLED');

    const totalRevenuePaise =
      trip.totalRevenuePaise || (trip.freightAmountPaise || 0) + (trip.otherChargesPaise || 0);
    const totalExpensesPaise =
      tripExpenses.length > 0
        ? tripExpenses.reduce((sum, e) => sum + (e.amountPaise || 0), 0)
        : trip.totalExpensesPaise || 0;
    const totalAdvancesPaise =
      tripAdvances.length > 0
        ? activeTripAdvances.reduce((sum, a) => sum + (a.amountPaise || 0), 0)
        : trip.totalAdvancesPaise || 0;
    const tripContributionPaise = totalRevenuePaise - totalExpensesPaise;
    const profitMarginPercent =
      totalRevenuePaise > 0 ? Math.round((tripContributionPaise / totalRevenuePaise) * 100) : 0;

    const fuelExpensesPaise = tripExpenses
      .filter((e) => e.category === 'FUEL' || e.category === 'DIESEL')
      .reduce((sum, e) => sum + (e.amountPaise || 0), 0);
    const tollExpensesPaise = tripExpenses
      .filter((e) => e.category === 'TOLL' || e.category === 'TOLL_FASTAG')
      .reduce((sum, e) => sum + (e.amountPaise || 0), 0);
    const otherExpensesPaise = totalExpensesPaise - fuelExpensesPaise - tollExpensesPaise;

    const allowedNextStatuses: TripStatus[] = getOperationalNextTripStatuses(trip);

    return {
      trip,
      vehicle,
      driver,
      customer,
      expenses: tripExpenses,
      advances: tripAdvances,
      financials: {
        totalRevenuePaise,
        totalExpensesPaise,
        totalAdvancesPaise,
        tripContributionPaise,
        profitMarginPercent,
        fuelExpensesPaise,
        tollExpensesPaise,
        otherExpensesPaise,
      },
      allowedNextStatuses,
    };
  }, [tripId, trips, vehicles, drivers, customers, expenses, advances]);

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
    podDocumentUrl?: string;
    podRemarks?: string;
  }) => {
    if (!data || !company?.id) return;
    await transitionTripStatusInFirestore(company.id, {
      trip: data.trip,
      nextStatus: transitionData.targetStatus,
      vehicle: data.vehicle || undefined,
      driver: data.driver || undefined,
      actualDeliveryDate: transitionData.actualDeliveryDate,
      endOdometerKm: transitionData.endOdometerKm,
      podReceived: transitionData.podReceived,
      podDocumentUrl: transitionData.podDocumentUrl,
      podRemarks: transitionData.podRemarks,
      cancellationReason: transitionData.cancellationReason,
      cancelledBy: user?.email || user?.name || 'Owner',
    });
    if (onTripUpdated) onTripUpdated();
  };

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data || !company?.id) return;
    setExpenseError(null);
    setSavingExpense(true);
    try {
      const amountPaise = Math.round(parseFloat(expenseAmountRupees) * 100);
      if (isNaN(amountPaise) || amountPaise <= 0) {
        throw new Error('Please enter a valid expense amount.');
      }

      const todayStr = new Date().toISOString().split('T')[0];
      const newExpense: TripExpense = {
        id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        companyId: company.id,
        tripId: data.trip.id,
        tripNumber: data.trip.tripNumber,
        vehicleId: data.trip.vehicleId,
        vehicleReg: data.trip.vehicleReg,
        driverId: data.trip.driverId,
        driverName: data.trip.driverName,
        category: expenseCategory,
        amountPaise,
        paymentMode: expensePaymentMode,
        date: todayStr,
        expenseDate: todayStr,
        litres: expenseLitres ? parseFloat(expenseLitres) : undefined,
        petrolPumpName: expensePumpName.trim() || undefined,
        notes: expenseNotes.trim() || undefined,
        recordedBy: user?.name || user?.email || 'System',
        isDriverDisbursed:
          expensePaymentMode === 'CASH' || expensePaymentMode === 'DRIVER_POCKET',
        isSettled: false,
      };

      await saveExpenseInFirestore(company.id, newExpense, data.trip, data.expenses);

      setIsAddExpenseOpen(false);
      setExpenseAmountRupees('');
      setExpenseNotes('');
      setExpensePumpName('');
      setExpenseLitres('');
      if (onTripUpdated) onTripUpdated();
    } catch (err: any) {
      setExpenseError(err.message || 'Error recording expense in Firestore.');
    } finally {
      setSavingExpense(false);
    }
  };

  const handleCreateAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data || !company?.id) return;
    setAdvanceError(null);
    setSavingAdvance(true);
    try {
      const amountPaise = Math.round(parseFloat(advanceAmountRupees) * 100);
      if (isNaN(amountPaise) || amountPaise <= 0) {
        throw new Error('Please enter a valid advance amount.');
      }

      const todayStr = new Date().toISOString().split('T')[0];
      const newAdvance: DriverAdvance = {
        id: `adv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        companyId: company.id,
        tripId: data.trip.id,
        tripNumber: data.trip.tripNumber,
        driverId: data.trip.driverId,
        driverName: data.trip.driverName,
        vehicleReg: data.trip.vehicleReg,
        amountPaise,
        advanceType: 'CASH_EN_ROUTE',
        date: todayStr,
        referenceNotes: advanceNotes.trim() || undefined,
        disbursedBy: user?.name || user?.email || 'System',
        isSettled: false,
      };

      await createAdvanceInFirestore(
        company.id,
        newAdvance,
        data.trip,
        data.driver || undefined
      );

      setIsAddAdvanceOpen(false);
      setAdvanceAmountRupees('');
      setAdvanceNotes('');
      if (onTripUpdated) onTripUpdated();
    } catch (err: any) {
      setAdvanceError(err.message || 'Error recording advance in Firestore.');
    } finally {
      setSavingAdvance(false);
    }
  };

  const openNewLogForm = (presetLabel?: string) => {
    const matchedPreset =
      TRIP_LOG_PRESET_STATUSES.find((p) => p.label === presetLabel) ||
      TRIP_LOG_PRESET_STATUSES[0];
    setEditingLogId(null);
    setLogStatusPreset(presetLabel ? matchedPreset.label : TRIP_LOG_PRESET_STATUSES[0].label);
    setLogCustomStatus('');
    setLogSeverity(matchedPreset.severity);
    setLogTimestampLocal(toLocalDateTimeInput(new Date()));
    setLogLocationNote('');
    setLogLatitude('');
    setLogLongitude('');
    setLogOdometerKm('');
    setLogNotes('');
    setLogFormError(null);
    setGpsNotice(null);
    setIsAddLogOpen(true);
  };

  const openEditLogForm = (log: TripLog) => {
    const isPreset = TRIP_LOG_PRESET_STATUSES.some((p) => p.label === log.status);
    setEditingLogId(log.id);
    setLogStatusPreset(isPreset ? log.status : 'CUSTOM');
    setLogCustomStatus(isPreset ? '' : log.status);
    setLogSeverity(
      log.severity ||
        (log.status.toLowerCase().includes('breakdown')
          ? 'CRITICAL'
          : log.status.toLowerCase().includes('delay')
          ? 'WARNING'
          : 'INFO')
    );
    setLogTimestampLocal(toLocalDateTimeInput(log.timestamp));
    setLogLocationNote(log.locationNote || '');
    setLogLatitude(typeof log.latitude === 'number' ? String(log.latitude) : '');
    setLogLongitude(typeof log.longitude === 'number' ? String(log.longitude) : '');
    setLogOdometerKm(typeof log.odometerKm === 'number' ? String(log.odometerKm) : '');
    setLogNotes(log.notes || '');
    setLogFormError(null);
    setGpsNotice(null);
    setIsAddLogOpen(true);
  };

  const handleCaptureGps = () => {
    setGpsNotice(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsNotice('Browser GPS is unavailable here. Enter coordinates or location checkpoint manually.');
      return;
    }
    setCapturingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude * 1000000) / 1000000;
        const lng = Math.round(pos.coords.longitude * 1000000) / 1000000;
        setLogLatitude(String(lat));
        setLogLongitude(String(lng));
        if (!logLocationNote.trim()) {
          setLogLocationNote(`GPS Pin (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
        }
        setGpsNotice(`Captured coordinates: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        setCapturingGps(false);
      },
      (geoErr) => {
        setGpsNotice(
          geoErr?.message
            ? `GPS unavailable (${geoErr.message}). Enter highway/toll landmark or coordinates manually.`
            : 'GPS permission unavailable. Enter location checkpoint manually.'
        );
        setCapturingGps(false);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  };

  const handleSaveTripLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data || !company?.id) return;
    setLogFormError(null);

    const resolvedStatus =
      logStatusPreset === 'CUSTOM' ? logCustomStatus.trim() : logStatusPreset.trim();
    if (!resolvedStatus) {
      setLogFormError('Please choose or enter a status update label.');
      return;
    }

    const trimmedLocation = logLocationNote.trim();
    if (!trimmedLocation) {
      setLogFormError('Location / GPS checkpoint note is required.');
      return;
    }

    const parsedDate = new Date(logTimestampLocal);
    if (Number.isNaN(parsedDate.getTime())) {
      setLogFormError('Please provide a valid date and time for this update.');
      return;
    }

    let parsedLat: number | undefined;
    if (logLatitude.trim() !== '') {
      parsedLat = Number(logLatitude);
      if (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90) {
        setLogFormError('Latitude must be between -90 and 90.');
        return;
      }
    }

    let parsedLng: number | undefined;
    if (logLongitude.trim() !== '') {
      parsedLng = Number(logLongitude);
      if (!Number.isFinite(parsedLng) || parsedLng < -180 || parsedLng > 180) {
        setLogFormError('Longitude must be between -180 and 180.');
        return;
      }
    }

    let parsedOdo: number | undefined;
    if (logOdometerKm.trim() !== '') {
      parsedOdo = Number(logOdometerKm);
      if (!Number.isFinite(parsedOdo) || parsedOdo < 0) {
        setLogFormError('Odometer reading must be a non-negative number.');
        return;
      }
    }

    setSavingLog(true);
    try {
      const logId =
        editingLogId || `tlog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      await saveTripLogInFirestore(company.id, data.trip.id, {
        id: logId,
        tripNumber: data.trip.tripNumber,
        status: resolvedStatus,
        severity: logSeverity,
        timestamp: parsedDate.toISOString(),
        locationNote: trimmedLocation,
        latitude: parsedLat,
        longitude: parsedLng,
        odometerKm: parsedOdo,
        notes: logNotes.trim() || undefined,
        loggedByUid: user?.id,
        loggedByName: user?.name || user?.email || 'Dispatcher',
      });

      setIsAddLogOpen(false);
      setEditingLogId(null);
      if (onTripUpdated) onTripUpdated();
    } catch (err: any) {
      setLogFormError(err?.message || 'Unable to save trip log to Firestore.');
    } finally {
      setSavingLog(false);
    }
  };

  const handleDeleteTripLog = async (log: TripLog) => {
    if (!data || !company?.id) return;
    setDeletingLogId(log.id);
    setLogsError(null);
    try {
      await deleteTripLogInFirestore(company.id, data.trip.id, log.id, log.status);
      if (onTripUpdated) onTripUpdated();
    } catch (err: any) {
      setLogsError(err?.message || 'Unable to delete trip log.');
    } finally {
      setDeletingLogId(null);
    }
  };

  const getLogSeverityBadge = (log: TripLog): { variant: BadgeVariant; label: string } => {
    const sev =
      log.severity ||
      (log.status.toLowerCase().includes('breakdown')
        ? 'CRITICAL'
        : log.status.toLowerCase().includes('delay')
        ? 'WARNING'
        : log.status.toLowerCase().includes('unloaded') ||
          log.status.toLowerCase().includes('loaded')
        ? 'SUCCESS'
        : 'INFO');
    switch (sev) {
      case 'CRITICAL':
        return { variant: 'danger', label: 'Alert' };
      case 'WARNING':
        return { variant: 'warning', label: 'Delay' };
      case 'SUCCESS':
        return { variant: 'success', label: 'Milestone' };
      default:
        return { variant: 'info', label: 'Checkpoint' };
    }
  };

  const trip = data?.trip;
  const statusBadge = trip
    ? getStatusBadge(trip.status)
    : { variant: 'slate' as BadgeVariant, label: '' };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="" size="xl">
      {loading && !data ? (
        <div className="py-16 text-center space-y-3">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-medium">Loading Trip Dossier...</p>
        </div>
      ) : !data || !trip ? (
        <div className="py-12 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
          <p className="text-sm font-semibold text-slate-800">Trip record not found in Firestore.</p>
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

            <div className="flex items-center gap-1.5 flex-wrap">
              {onEditTrip && (
                <button
                  type="button"
                  onClick={() => onEditTrip(trip)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 shadow-xs transition-colors cursor-pointer flex items-center gap-1"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit Dispatch / POD</span>
                </button>
              )}
              {data.allowedNextStatuses.map((st) => {
                const order = ['PLANNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'SETTLED'];
                const isReopenAction =
                  trip.status === 'CANCELLED' ||
                  (st !== 'CANCELLED' && order.indexOf(st) < order.indexOf(trip.status));
                return (
                  <button
                    key={st}
                    onClick={() => setTargetStatusToChange(st)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer flex items-center gap-1 ${
                      st === 'CANCELLED'
                        ? 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                        : st === 'COMPLETED'
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : isReopenAction
                        ? 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}
                  >
                    <span>{isReopenAction ? `Reopen to ${st}` : `Mark ${st}`}</span>
                  </button>
                );
              })}
            </div>
          </div>

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
          <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 text-xs font-semibold">
            {[
              { id: 'overview', label: 'Overview & Specs', icon: FileText },
              { id: 'logs', label: `Trip Logs (${tripLogs.length})`, icon: Navigation },
              { id: 'expenses', label: `Trip Expenses (${data.expenses.length})`, icon: Fuel },
              { id: 'advances', label: `Driver Advances (${data.advances.length})`, icon: CreditCard },
              { id: 'workflow', label: 'Operational Lifecycle', icon: CheckCircle2 },
            ].map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id as TripDetailTab)}
                  className={`pb-2.5 px-3 flex items-center gap-1.5 transition-colors border-b-2 whitespace-nowrap shrink-0 cursor-pointer ${
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

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 border-b border-slate-100 pb-1.5">
                    <Building2 className="w-4 h-4 text-indigo-600" />
                    <span>Customer & Billing</span>
                  </div>
                  <p className="font-semibold text-slate-800">{data.customer?.name || trip.customerName}</p>
                  <p className="font-mono text-slate-500 text-[11px]">GSTIN: {data.customer?.gstin || trip.customerGstin || 'Unregistered'}</p>
                  {data.customer && (
                    <p className="text-slate-600 text-[11px]">
                      {[data.customer.billingAddress, data.customer.city, data.customer.state].filter(Boolean).join(', ')}
                      {data.customer.pincode ? ` - ${data.customer.pincode}` : ''}
                    </p>
                  )}
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900 border-b border-slate-100 pb-1.5">
                    <Truck className="w-4 h-4 text-indigo-600" />
                    <span>Assigned Truck</span>
                  </div>
                  <p className="font-mono font-bold text-slate-900">{data.vehicle?.registrationNumber || trip.vehicleReg}</p>
                  <p className="text-slate-600">{data.vehicle?.makeModel} ({data.vehicle?.vehicleType})</p>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                    <span>Odometer: {(data.vehicle?.currentOdometerKm || 0).toLocaleString()} KM</span>
                    <span>FastTag: {formatINR(data.vehicle?.fastagBalancePaise || 0)}</span>
                  </div>
                </div>

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

              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2 text-xs">
                <span className="font-bold text-slate-900 uppercase tracking-wider text-[10px] block">
                  Trip Operational Readings & Consignee Remarks
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <span className="text-slate-400 text-[10px] block">Start Odometer</span>
                    <span className="font-mono font-semibold text-slate-800">{(trip.startOdometerKm || 0).toLocaleString()} KM</span>
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

                {(trip.pickupAddress || trip.deliveryAddress || trip.loadingDetails || trip.unloadingDetails) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-200">
                    {trip.pickupAddress && (
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase block">Pickup Address</span>
                        <span className="text-[11px] text-slate-700">{trip.pickupAddress}</span>
                      </div>
                    )}
                    {trip.deliveryAddress && (
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase block">Delivery Address</span>
                        <span className="text-[11px] text-slate-700">{trip.deliveryAddress}</span>
                      </div>
                    )}
                    {trip.loadingDetails && (
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase block">Loading Details</span>
                        <span className="text-[11px] text-slate-700">{trip.loadingDetails}</span>
                      </div>
                    )}
                    {trip.unloadingDetails && (
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase block">Unloading Details</span>
                        <span className="text-[11px] text-slate-700">{trip.unloadingDetails}</span>
                      </div>
                    )}
                  </div>
                )}

                {(trip.lrDocumentUrl || trip.dispatchDocumentUrl || trip.podDocumentUrl) && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200">
                    {trip.lrDocumentUrl && (
                      <a
                        href={trip.lrDocumentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-indigo-200 text-indigo-700 rounded-lg text-[11px] font-semibold hover:bg-indigo-50"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>LR / Bilty Document</span>
                        <Download className="w-3 h-3" />
                      </a>
                    )}
                    {trip.dispatchDocumentUrl && (
                      <a
                        href={trip.dispatchDocumentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-indigo-200 text-indigo-700 rounded-lg text-[11px] font-semibold hover:bg-indigo-50"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Dispatch Document</span>
                        <Download className="w-3 h-3" />
                      </a>
                    )}
                    {trip.podDocumentUrl && (
                      <a
                        href={trip.podDocumentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-emerald-200 text-emerald-700 rounded-lg text-[11px] font-semibold hover:bg-emerald-50"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Stamped POD Copy</span>
                        <Download className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}

                {trip.dispatchRemarks && (
                  <p className="text-[11px] text-slate-600 bg-white p-2 rounded-lg border border-slate-200 mt-2">
                    <strong>Dispatch Remarks:</strong> {trip.dispatchRemarks}
                  </p>
                )}
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
                  onClick={() => {
                    setExpenseError(null);
                    setIsAddExpenseOpen(true);
                  }}
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
                          {exp.expenseDate || exp.date} {exp.petrolPumpName ? `• ${exp.petrolPumpName}` : ''} {exp.litres ? `• ${exp.litres}L` : ''} {exp.location ? `• ${exp.location}` : ''}
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
                  onClick={() => {
                    setAdvanceError(null);
                    setIsAddAdvanceOpen(true);
                  }}
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
                          <Badge
                            variant={
                              adv.status === 'CANCELLED'
                                ? 'danger'
                                : adv.isSettled
                                ? 'success'
                                : 'amber'
                            }
                            size="sm"
                          >
                            {adv.status === 'CANCELLED'
                              ? 'Cancelled'
                              : adv.isSettled
                              ? 'Settled'
                              : 'Pending Reconciliation'}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-slate-500">{adv.date} • Disbursed by {adv.disbursedBy}</p>
                        {adv.cancellationReason && (
                          <p className="text-[11px] text-rose-600">Cancelled: {adv.cancellationReason}</p>
                        )}
                        {adv.referenceNotes && <p className="text-[11px] text-slate-400">{adv.referenceNotes}</p>}
                      </div>
                      <div className="text-right">
                        <span
                          className={`font-bold text-sm block ${
                            adv.status === 'CANCELLED' ? 'text-slate-400 line-through' : 'text-amber-700'
                          }`}
                        >
                          {formatINR(adv.amountPaise)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: TRIP LOGS (SUB-COLLECTION) */}
          {activeTab === 'logs' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    En-Route Status Checkpoints &amp; GPS Location Logs
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Stored in Firestore sub-collection for {trip.tripNumber} ({trip.vehicleReg})
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openNewLogForm('Vehicle Breakdown')}
                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  >
                    Report Breakdown
                  </button>
                  <button
                    type="button"
                    onClick={() => openNewLogForm()}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Status Log</span>
                  </button>
                </div>
              </div>

              {logsError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{logsError}</span>
                </div>
              )}

              {logsLoading ? (
                <div className="border border-slate-200 rounded-xl bg-white divide-y divide-slate-100">
                  {[0, 1].map((idx) => (
                    <div key={idx} className="p-4 space-y-2">
                      <div className="h-3.5 w-40 bg-slate-200 rounded animate-pulse" />
                      <div className="h-3 w-64 bg-slate-100 rounded animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : tripLogs.length === 0 ? (
                <div className="text-center py-10 px-4 bg-slate-50 rounded-xl border border-dashed border-slate-300 space-y-3">
                  <Navigation className="w-6 h-6 text-slate-400 mx-auto" />
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-800">
                      No en-route status logs recorded yet
                    </p>
                    <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                      Track loading gate arrival, toll checkpoints, vehicle breakdowns, or consignee delivery timestamps with GPS-like location notes.
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
                    <button
                      type="button"
                      onClick={() => openNewLogForm('Reached Loading Point')}
                      className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                    >
                      Log Reached Loading Point
                    </button>
                  </div>
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white divide-y divide-slate-100 text-xs">
                  {tripLogs.map((log) => {
                    const sevBadge = getLogSeverityBadge(log);
                    const formattedTs = (() => {
                      const d = new Date(log.timestamp);
                      if (Number.isNaN(d.getTime())) return log.timestamp;
                      return d.toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      });
                    })();
                    return (
                      <div
                        key={log.id}
                        className="p-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                      >
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-900 text-sm">
                              {log.status}
                            </span>
                            <Badge variant={sevBadge.variant} size="sm">
                              {sevBadge.label}
                            </Badge>
                          </div>

                          <div className="flex items-center gap-2 text-[11px] text-slate-700">
                            <MapPin className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                            <span className="font-medium break-words">{log.locationNote}</span>
                          </div>

                          <div className="flex items-center gap-2 text-[11px] text-slate-500 flex-wrap font-mono tabular-nums">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-400" />
                              {formattedTs}
                            </span>
                            {typeof log.latitude === 'number' && typeof log.longitude === 'number' && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>
                                  GPS {log.latitude.toFixed(4)}, {log.longitude.toFixed(4)}
                                </span>
                              </>
                            )}
                            {typeof log.odometerKm === 'number' && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{log.odometerKm.toLocaleString()} KM</span>
                              </>
                            )}
                            {log.loggedByName && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-sans">By {log.loggedByName}</span>
                              </>
                            )}
                          </div>

                          {log.notes && (
                            <p className="text-[11px] text-slate-600 pt-0.5 leading-relaxed">
                              {log.notes}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-start">
                          <button
                            type="button"
                            onClick={() => openEditLogForm(log)}
                            title="Edit status log"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTripLog(log)}
                            disabled={deletingLogId === log.id}
                            title="Delete status log"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: OPERATIONAL WORKFLOW */}
          {activeTab === 'workflow' && (
            <div className="space-y-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                  Trip Operational Workflow Progression
                </span>
                <p className="text-xs text-slate-600 leading-relaxed">
                  AnchorTransport TMS follows a strict, sequential state machine ensuring fleet transparency, prevent duplicate driver assignments, and preserve audit histories.
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2">
                  {[
                    { id: 'PLANNED', label: '1. Planned' },
                    { id: 'DISPATCHED', label: '2. Dispatched' },
                    { id: 'IN_TRANSIT', label: '3. In Transit' },
                    { id: 'DELIVERED', label: '4. Delivered' },
                    { id: 'COMPLETED', label: '5. Completed' },
                  ].map((st, i) => {
                    const isCurrent = trip.status === st.id;
                    const isPast =
                      ['PLANNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'].indexOf(
                        trip.status
                      ) >= i;
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

              <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                  Available Workflow Actions
                </span>

                {data.allowedNextStatuses.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">
                    No further workflow transitions available for {trip.status}.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {data.allowedNextStatuses.map((st) => {
                      const order = ['PLANNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'SETTLED'];
                      const isReopenAction =
                        trip.status === 'CANCELLED' ||
                        (st !== 'CANCELLED' && order.indexOf(st) < order.indexOf(trip.status));
                      return (
                        <button
                          key={st}
                          onClick={() => setTargetStatusToChange(st)}
                          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors shadow-xs cursor-pointer ${
                            st === 'CANCELLED'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                              : st === 'COMPLETED'
                              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                              : isReopenAction
                              ? 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
                              : 'bg-indigo-600 text-white hover:bg-indigo-700'
                          }`}
                        >
                          {isReopenAction ? `Reopen as ${st}` : `Advance to ${st}`}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Add / Edit Trip Log Sub-Modal */}
          {isAddLogOpen && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl p-5 max-w-lg w-full border border-slate-200 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="font-bold text-sm text-slate-900">
                      {editingLogId ? 'Edit Trip Status Log' : 'Add Trip Status Update'}
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      {trip.tripNumber} · {trip.vehicleReg} · {trip.originCity} → {trip.destinationCity}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAddLogOpen(false)}
                    className="text-xs text-slate-500 hover:text-slate-900 px-2 py-1 rounded-lg"
                  >
                    Close
                  </button>
                </div>

                {logFormError && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{logFormError}</span>
                  </div>
                )}

                <form onSubmit={handleSaveTripLog} className="space-y-3.5 text-xs">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1.5">
                      Status Checkpoint <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={logStatusPreset}
                      onChange={(e) => {
                        const val = e.target.value;
                        setLogStatusPreset(val);
                        const match = TRIP_LOG_PRESET_STATUSES.find((p) => p.label === val);
                        if (match) {
                          setLogSeverity(match.severity);
                        }
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 font-medium"
                    >
                      {TRIP_LOG_PRESET_STATUSES.map((p) => (
                        <option key={p.label} value={p.label}>
                          {p.label}
                        </option>
                      ))}
                      <option value="CUSTOM">Custom Status Update...</option>
                    </select>
                  </div>

                  {logStatusPreset === 'CUSTOM' && (
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Custom Status Label <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={logCustomStatus}
                        onChange={(e) => setLogCustomStatus(e.target.value)}
                        maxLength={80}
                        placeholder="e.g. Customs Inspection Cleared"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                        required
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-semibold text-slate-700">
                          Timestamp <span className="text-rose-500">*</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => setLogTimestampLocal(toLocalDateTimeInput(new Date()))}
                          className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                        >
                          Use Now
                        </button>
                      </div>
                      <input
                        type="datetime-local"
                        value={logTimestampLocal}
                        onChange={(e) => setLogTimestampLocal(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono tabular-nums text-slate-900"
                        required
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Priority / Severity
                      </label>
                      <select
                        value={logSeverity}
                        onChange={(e) => setLogSeverity(e.target.value as TripLogSeverity)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
                      >
                        <option value="INFO">Checkpoint (Normal)</option>
                        <option value="SUCCESS">Milestone Completed</option>
                        <option value="WARNING">Delay / Attention</option>
                        <option value="CRITICAL">Breakdown / Critical Alert</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <label className="font-semibold text-slate-700">
                        Location / GPS Checkpoint Note <span className="text-rose-500">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={handleCaptureGps}
                        disabled={capturingGps}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                      >
                        <Crosshair className="w-3 h-3" />
                        <span>{capturingGps ? 'Locating...' : 'Capture GPS'}</span>
                      </button>
                    </div>
                    <input
                      type="text"
                      value={logLocationNote}
                      onChange={(e) => setLogLocationNote(e.target.value)}
                      maxLength={250}
                      placeholder={
                        TRIP_LOG_PRESET_STATUSES.find((p) => p.label === logStatusPreset)
                          ?.placeholderLocation || 'e.g. NH-19 Dankuni Toll Plaza (22.6815, 88.3012)'
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                      required
                    />
                    {gpsNotice && (
                      <p className="text-[11px] text-slate-500 mt-1">{gpsNotice}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Latitude (Optional)
                      </label>
                      <input
                        type="number"
                        step="0.000001"
                        min="-90"
                        max="90"
                        value={logLatitude}
                        onChange={(e) => setLogLatitude(e.target.value)}
                        placeholder="e.g. 22.6815"
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Longitude (Optional)
                      </label>
                      <input
                        type="number"
                        step="0.000001"
                        min="-180"
                        max="180"
                        value={logLongitude}
                        onChange={(e) => setLogLongitude(e.target.value)}
                        placeholder="e.g. 88.3012"
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Odometer KM
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={logOdometerKm}
                        onChange={(e) => setLogOdometerKm(e.target.value)}
                        placeholder="e.g. 142500"
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono tabular-nums"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Driver / Dispatch Remarks
                    </label>
                    <textarea
                      rows={2}
                      maxLength={500}
                      value={logNotes}
                      onChange={(e) => setLogNotes(e.target.value)}
                      placeholder="e.g. Waiting at weighbridge bay 2; mechanic dispatched for rear tyre check."
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setIsAddLogOpen(false)}
                      disabled={savingLog}
                      className="px-4 py-2 border border-slate-300 rounded-lg text-slate-600 font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingLog}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                    >
                      {savingLog ? 'Saving...' : editingLogId ? 'Update Log' : 'Save Status Log'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Quick Expense Sub-Modal */}
          {isAddExpenseOpen && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4">
                <h4 className="font-bold text-sm text-slate-900">Record Trip Expense ({trip.tripNumber})</h4>
                {expenseError && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{expenseError}</span>
                  </div>
                )}
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
                      disabled={savingExpense}
                      className="px-3 py-1.5 border border-slate-300 rounded-lg text-slate-600"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingExpense}
                      className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700"
                    >
                      {savingExpense ? 'Saving...' : 'Save Expense'}
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
                {advanceError && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{advanceError}</span>
                  </div>
                )}
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
                      disabled={savingAdvance}
                      className="px-3 py-1.5 border border-slate-300 rounded-lg text-slate-600"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingAdvance}
                      className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700"
                    >
                      {savingAdvance ? 'Recording...' : 'Record Advance'}
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
