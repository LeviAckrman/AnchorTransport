import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Eye,
  FileText,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { FilePreviewModal } from '../../components/ui/FilePreviewModal';
import { formatRupees, paiseToRupees } from '../../lib/financialEngine';
import {
  calculateJournalDistance,
  calculateJournalFinancials,
  extractAttachmentFileName,
  generateJournalTripId,
  isValidJournalAttachmentFile,
  parseRupeesInputToPaise,
  STANDARD_JOURNAL_EXPENSE_NAMES,
} from '../../lib/journalTripsHelpers';
import {
  createJournalTripInFirestore,
  updateJournalTripInFirestore,
} from '../../lib/firebase/journalTripsService';
import {
  deleteJournalAttachment,
  getJournalAttachmentDownloadUrl,
  uploadJournalTripAttachment,
} from '../../lib/firebase/storageService';
import type {
  Customer,
  Driver,
  JournalEntryType,
  JournalTrip,
  JournalTripExpenseItem,
  JournalTripStatus,
  Vehicle,
} from '../../types/tms';

interface JournalTripFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  vehicles: Vehicle[];
  drivers: Driver[];
  customers: Customer[];
  initialTrip?: JournalTrip | null;
  onSaved: (message: string) => void;
}

interface CustomExpenseDraft {
  key: string;
  expenseName: string;
  amountRupees: string;
  description: string;
}

export const JournalTripFormModal: React.FC<JournalTripFormModalProps> = ({
  isOpen,
  onClose,
  companyId,
  vehicles,
  drivers,
  customers,
  initialTrip,
  onSaved,
}) => {
  const isEditMode = Boolean(initialTrip);

  const [workingJournalTripId, setWorkingJournalTripId] = useState<string>('');
  const [tripDate, setTripDate] = useState<string>('');
  const [entryType, setEntryType] = useState<JournalEntryType>('historical');
  const [externalReferenceNumber, setExternalReferenceNumber] = useState<string>('');
  const [status, setStatus] = useState<JournalTripStatus>('completed');

  // Vehicle / Driver / Customer modes
  const [vehicleMode, setVehicleMode] = useState<'select' | 'manual'>('select');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');
  const [manualVehicleNumber, setManualVehicleNumber] = useState<string>('');

  const [driverMode, setDriverMode] = useState<'select' | 'manual'>('select');
  const [selectedDriverId, setSelectedDriverId] = useState<string>('');
  const [manualDriverName, setManualDriverName] = useState<string>('');

  const [customerMode, setCustomerMode] = useState<'select' | 'manual'>('select');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [manualCustomerName, setManualCustomerName] = useState<string>('');

  const [fromLocation, setFromLocation] = useState<string>('');
  const [toLocation, setToLocation] = useState<string>('');

  // Financial fields
  const [freightRupees, setFreightRupees] = useState<string>('');
  const [standardExpenses, setStandardExpenses] = useState<
    Record<string, { amountRupees: string; description: string }>
  >({});
  const [customExpenses, setCustomExpenses] = useState<CustomExpenseDraft[]>([]);

  // Additional info
  const [odometerStart, setOdometerStart] = useState<string>('');
  const [odometerEnd, setOdometerEnd] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [attachmentPaths, setAttachmentPaths] = useState<string[]>([]);
  const [sessionUploadedPaths, setSessionUploadedPaths] = useState<string[]>([]);

  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewAttachment, setPreviewAttachment] = useState<{ fileName: string; url: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setErrorMsg(null);
    setSessionUploadedPaths([]);

    const standardDefaults: Record<string, { amountRupees: string; description: string }> = {};
    for (const name of STANDARD_JOURNAL_EXPENSE_NAMES) {
      standardDefaults[name] = { amountRupees: '', description: '' };
    }

    if (initialTrip) {
      setWorkingJournalTripId(initialTrip.journalTripId);
      setTripDate((initialTrip.tripDate || '').slice(0, 10) || new Date().toISOString().slice(0, 10));
      setEntryType(initialTrip.entryType || 'historical');
      setExternalReferenceNumber(initialTrip.externalReferenceNumber || '');
      setStatus(initialTrip.status || 'completed');

      if (initialTrip.vehicleId && vehicles.some((v) => v.id === initialTrip.vehicleId)) {
        setVehicleMode('select');
        setSelectedVehicleId(initialTrip.vehicleId);
        setManualVehicleNumber(initialTrip.vehicleNumber || '');
      } else {
        setVehicleMode('manual');
        setSelectedVehicleId('');
        setManualVehicleNumber(initialTrip.vehicleNumber || '');
      }

      if (initialTrip.driverId && drivers.some((d) => d.id === initialTrip.driverId)) {
        setDriverMode('select');
        setSelectedDriverId(initialTrip.driverId);
        setManualDriverName(initialTrip.driverName || '');
      } else {
        setDriverMode('manual');
        setSelectedDriverId('');
        setManualDriverName(initialTrip.driverName || '');
      }

      if (initialTrip.customerId && customers.some((c) => c.id === initialTrip.customerId)) {
        setCustomerMode('select');
        setSelectedCustomerId(initialTrip.customerId);
        setManualCustomerName(initialTrip.customerName || '');
      } else {
        setCustomerMode('manual');
        setSelectedCustomerId('');
        setManualCustomerName(initialTrip.customerName || '');
      }

      setFromLocation(initialTrip.fromLocation || '');
      setToLocation(initialTrip.toLocation || '');
      setFreightRupees(
        initialTrip.freightAmountPaise > 0
          ? String(paiseToRupees(initialTrip.freightAmountPaise))
          : '0'
      );

      const customList: CustomExpenseDraft[] = [];
      for (const exp of initialTrip.expenses || []) {
        if ((STANDARD_JOURNAL_EXPENSE_NAMES as readonly string[]).includes(exp.expenseName)) {
          standardDefaults[exp.expenseName] = {
            amountRupees: exp.amountPaise > 0 ? String(paiseToRupees(exp.amountPaise)) : '',
            description: exp.description || '',
          };
        } else {
          customList.push({
            key: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            expenseName: exp.expenseName,
            amountRupees: exp.amountPaise > 0 ? String(paiseToRupees(exp.amountPaise)) : '',
            description: exp.description || '',
          });
        }
      }
      setStandardExpenses(standardDefaults);
      setCustomExpenses(customList);

      setOdometerStart(
        initialTrip.odometerStart !== null && initialTrip.odometerStart !== undefined
          ? String(initialTrip.odometerStart)
          : ''
      );
      setOdometerEnd(
        initialTrip.odometerEnd !== null && initialTrip.odometerEnd !== undefined
          ? String(initialTrip.odometerEnd)
          : ''
      );
      setNotes(initialTrip.notes || '');
      setAttachmentPaths(initialTrip.attachmentPaths || []);
    } else {
      setWorkingJournalTripId(generateJournalTripId());
      setTripDate(new Date().toISOString().slice(0, 10));
      setEntryType('offline');
      setExternalReferenceNumber('');
      setStatus('completed');

      setVehicleMode(vehicles.length > 0 ? 'select' : 'manual');
      setSelectedVehicleId('');
      setManualVehicleNumber('');

      setDriverMode(drivers.length > 0 ? 'select' : 'manual');
      setSelectedDriverId('');
      setManualDriverName('');

      setCustomerMode(customers.length > 0 ? 'select' : 'manual');
      setSelectedCustomerId('');
      setManualCustomerName('');

      setFromLocation('');
      setToLocation('');
      setFreightRupees('');
      setStandardExpenses(standardDefaults);
      setCustomExpenses([]);
      setOdometerStart('');
      setOdometerEnd('');
      setNotes('');
      setAttachmentPaths([]);
    }
  }, [isOpen, initialTrip, vehicles, drivers, customers]);

  // Live Expense & Profit computation (strictly integer paise)
  const financialPreview = useMemo(() => {
    const freightPaise = parseRupeesInputToPaise(freightRupees);
    const items: JournalTripExpenseItem[] = [];

    for (const name of STANDARD_JOURNAL_EXPENSE_NAMES) {
      const entry = standardExpenses[name];
      if (!entry) continue;
      const amtPaise = parseRupeesInputToPaise(entry.amountRupees);
      const desc = (entry.description || '').trim();
      if (amtPaise > 0 || desc.length > 0) {
        items.push({
          expenseName: name,
          amountPaise: amtPaise,
          description: desc,
        });
      }
    }

    for (const row of customExpenses) {
      const name = row.expenseName.trim();
      const amtPaise = parseRupeesInputToPaise(row.amountRupees);
      const desc = row.description.trim();
      if (name && (amtPaise > 0 || desc.length > 0)) {
        items.push({
          expenseName: name,
          amountPaise: amtPaise,
          description: desc,
        });
      }
    }

    return calculateJournalFinancials(freightPaise, items);
  }, [freightRupees, standardExpenses, customExpenses]);

  const parsedStartKm = odometerStart.trim() === '' ? null : Number(odometerStart);
  const parsedEndKm = odometerEnd.trim() === '' ? null : Number(odometerEnd);
  const calculatedDistance = calculateJournalDistance(
    parsedStartKm !== null && Number.isFinite(parsedStartKm) ? parsedStartKm : null,
    parsedEndKm !== null && Number.isFinite(parsedEndKm) ? parsedEndKm : null
  );

  const handleAddCustomExpense = () => {
    setCustomExpenses((prev) => [
      ...prev,
      {
        key: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        expenseName: '',
        amountRupees: '',
        description: '',
      },
    ]);
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrorMsg(null);
    setUploadingAttachment(true);
    setUploadProgress(0);
    try {
      const fileArray = Array.from(files);
      for (const file of fileArray) {
        if (attachmentPaths.length >= 15) {
          throw new Error('Maximum 15 attachments per journal trip reached.');
        }
        const check = isValidJournalAttachmentFile(file);
        if (!check.valid) {
          throw new Error(check.error || 'Invalid attachment file.');
        }
        setUploadProgress(0);
        const storagePath = await uploadJournalTripAttachment(
          companyId,
          workingJournalTripId,
          file,
          setUploadProgress
        );
        setAttachmentPaths((prev) => [...prev, storagePath]);
        setSessionUploadedPaths((prev) => [...prev, storagePath]);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to upload attachment.');
    } finally {
      setUploadingAttachment(false);
      setUploadProgress(0);
    }
  };

  const handleOpenAttachment = async (storagePath: string) => {
    try {
      const url = await getJournalAttachmentDownloadUrl(companyId, storagePath);
      setPreviewAttachment({
        fileName: extractAttachmentFileName(storagePath),
        url,
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to access attachment.');
    }
  };

  const handleRemoveAttachment = async (storagePath: string) => {
    // If uploaded in this unsaved session, delete from Firebase Storage first
    if (sessionUploadedPaths.includes(storagePath)) {
      try {
        await deleteJournalAttachment(companyId, storagePath);
        setSessionUploadedPaths((prev) => prev.filter((p) => p !== storagePath));
      } catch (err: any) {
        setErrorMsg(err?.message || 'Unable to delete attachment from Storage.');
        return;
      }
    }
    setAttachmentPaths((prev) => prev.filter((p) => p !== storagePath));
  };

  const handleCloseCancel = async () => {
    // Best-effort cleanup of newly uploaded orphaned attachments if user cancels modal
    if (sessionUploadedPaths.length > 0 && !submitting) {
      await Promise.allSettled(
        sessionUploadedPaths.map((p) => deleteJournalAttachment(companyId, p))
      );
    }
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!tripDate) {
      setErrorMsg('Trip Date is required.');
      return;
    }

    let resolvedVehicleId: string | null = null;
    let resolvedVehicleNumber = '';
    if (vehicleMode === 'select') {
      const v = vehicles.find((item) => item.id === selectedVehicleId);
      if (!v) {
        setErrorMsg('Please select a vehicle or switch to manual entry.');
        return;
      }
      resolvedVehicleId = v.id;
      resolvedVehicleNumber = v.registrationNumber;
    } else {
      resolvedVehicleNumber = manualVehicleNumber.trim().toUpperCase();
      if (!resolvedVehicleNumber) {
        setErrorMsg('Please enter the vehicle registration number.');
        return;
      }
    }

    let resolvedDriverId: string | null = null;
    let resolvedDriverName = '';
    if (driverMode === 'select') {
      const d = drivers.find((item) => item.id === selectedDriverId);
      if (!d) {
        setErrorMsg('Please select a driver or switch to manual entry.');
        return;
      }
      resolvedDriverId = d.id;
      resolvedDriverName = d.fullName;
    } else {
      resolvedDriverName = manualDriverName.trim();
      if (!resolvedDriverName) {
        setErrorMsg('Please enter the driver name.');
        return;
      }
    }

    let resolvedCustomerId: string | null = null;
    let resolvedCustomerName = '';
    if (customerMode === 'select') {
      const c = customers.find((item) => item.id === selectedCustomerId);
      if (!c) {
        setErrorMsg('Please select a customer or switch to manual entry.');
        return;
      }
      resolvedCustomerId = c.id;
      resolvedCustomerName = c.name;
    } else {
      resolvedCustomerName = manualCustomerName.trim();
      if (!resolvedCustomerName) {
        setErrorMsg('Please enter the customer / party name.');
        return;
      }
    }

    if (!fromLocation.trim() || !toLocation.trim()) {
      setErrorMsg('Both From Location and To Location are required.');
      return;
    }

    if (freightRupees.trim() === '' || Number(freightRupees) < 0 || Number.isNaN(Number(freightRupees))) {
      setErrorMsg('Please enter a valid Freight Amount (0 or greater).');
      return;
    }

    if (
      parsedStartKm !== null &&
      (!Number.isFinite(parsedStartKm) || parsedStartKm < 0)
    ) {
      setErrorMsg('Starting odometer must be a non-negative number.');
      return;
    }
    if (
      parsedEndKm !== null &&
      (!Number.isFinite(parsedEndKm) || parsedEndKm < 0)
    ) {
      setErrorMsg('Ending odometer must be a non-negative number.');
      return;
    }
    if (parsedStartKm !== null && parsedEndKm !== null && parsedEndKm < parsedStartKm) {
      setErrorMsg('Odometer End cannot be less than Odometer Start.');
      return;
    }

    // Validate custom expenses don't have amount without name
    for (const row of customExpenses) {
      const amt = parseRupeesInputToPaise(row.amountRupees);
      if (amt > 0 && !row.expenseName.trim()) {
        setErrorMsg('Please enter an Expense Name for every custom expense row.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        journalTripId: workingJournalTripId,
        tripDate,
        vehicleId: resolvedVehicleId,
        vehicleNumber: resolvedVehicleNumber,
        driverId: resolvedDriverId,
        driverName: resolvedDriverName,
        customerId: resolvedCustomerId,
        customerName: resolvedCustomerName,
        fromLocation: fromLocation.trim(),
        toLocation: toLocation.trim(),
        entryType,
        externalReferenceNumber: externalReferenceNumber.trim() || null,
        freightAmountPaise: financialPreview.freightAmountPaise,
        expenses: financialPreview.expenses,
        odometerStart: parsedStartKm,
        odometerEnd: parsedEndKm,
        notes: notes.trim(),
        attachmentPaths,
        status,
      };

      if (isEditMode && initialTrip) {
        await updateJournalTripInFirestore(companyId, initialTrip.journalTripId, payload);
        onSaved(`Journal trip ${initialTrip.journalTripId} updated.`);
      } else {
        await createJournalTripInFirestore(companyId, payload);
        onSaved(`Journal trip ${workingJournalTripId} recorded in Trips Journal.`);
      }
      setSessionUploadedPaths([]);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save journal trip.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCloseCancel}
      title={isEditMode ? `Edit Journal Trip (${initialTrip?.journalTripId})` : 'Record Offline / Historical Trip'}
      subtitle="Stored exclusively in Trips Journal — does not alter live vehicles, drivers, or operational settlements"
      maxWidth="2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-xs text-rose-800 font-medium">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Section A: Trip Information */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              A. Trip Information
            </h4>
            <span className="text-[11px] font-mono text-slate-500">ID: {workingJournalTripId}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Trip Date <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                value={tripDate}
                onChange={(e) => setTripDate(e.target.value)}
                required
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Entry Type <span className="text-rose-500">*</span>
              </label>
              <select
                value={entryType}
                onChange={(e) => setEntryType(e.target.value as JournalEntryType)}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="offline">Offline Trip</option>
                <option value="historical">Historical Trip</option>
                <option value="manual_book">Manual Book Entry</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                External Reference Number
              </label>
              <input
                type="text"
                value={externalReferenceNumber}
                onChange={(e) => setExternalReferenceNumber(e.target.value)}
                placeholder="Book Ref / Old LR / Excel ID"
                maxLength={100}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Vehicle Selection or Manual */}
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-700">
                  Vehicle <span className="text-rose-500">*</span>
                </label>
                {vehicles.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setVehicleMode(vehicleMode === 'select' ? 'manual' : 'select')}
                    className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                  >
                    {vehicleMode === 'select' ? 'Enter Manually' : 'Choose Registered'}
                  </button>
                )}
              </div>
              {vehicleMode === 'select' && vehicles.length > 0 ? (
                <select
                  value={selectedVehicleId}
                  onChange={(e) => setSelectedVehicleId(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2 bg-white text-slate-900"
                >
                  <option value="">-- Select Truck --</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.registrationNumber} {v.makeModel ? `(${v.makeModel})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={manualVehicleNumber}
                  onChange={(e) => setManualVehicleNumber(e.target.value)}
                  placeholder="e.g. WB-19-K-4821"
                  maxLength={40}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2 bg-white text-slate-900 uppercase font-mono"
                />
              )}
            </div>

            {/* Driver Selection or Manual */}
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-700">
                  Driver <span className="text-rose-500">*</span>
                </label>
                {drivers.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setDriverMode(driverMode === 'select' ? 'manual' : 'select')}
                    className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                  >
                    {driverMode === 'select' ? 'Enter Manually' : 'Choose Registered'}
                  </button>
                )}
              </div>
              {driverMode === 'select' && drivers.length > 0 ? (
                <select
                  value={selectedDriverId}
                  onChange={(e) => setSelectedDriverId(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2 bg-white text-slate-900"
                >
                  <option value="">-- Select Driver --</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fullName}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={manualDriverName}
                  onChange={(e) => setManualDriverName(e.target.value)}
                  placeholder="Driver full name"
                  maxLength={120}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2 bg-white text-slate-900"
                />
              )}
            </div>

            {/* Customer Selection or Manual */}
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-700">
                  Customer <span className="text-rose-500">*</span>
                </label>
                {customers.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCustomerMode(customerMode === 'select' ? 'manual' : 'select')}
                    className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                  >
                    {customerMode === 'select' ? 'Enter Manually' : 'Choose Registered'}
                  </button>
                )}
              </div>
              {customerMode === 'select' && customers.length > 0 ? (
                <select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2 bg-white text-slate-900"
                >
                  <option value="">-- Select Party --</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={manualCustomerName}
                  onChange={(e) => setManualCustomerName(e.target.value)}
                  placeholder="Customer / party name"
                  maxLength={150}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2 bg-white text-slate-900"
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                From Location <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={fromLocation}
                onChange={(e) => setFromLocation(e.target.value)}
                placeholder="e.g. Jamshedpur, JH"
                required
                maxLength={200}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                To Location <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={toLocation}
                onChange={(e) => setToLocation(e.target.value)}
                placeholder="e.g. Kolkata, WB"
                required
                maxLength={200}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </section>

        {/* Section B: Financial Information */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              B. Financial Information
            </h4>
            <span className="text-[11px] text-slate-500">All amounts in INR (₹)</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-center p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Freight Amount (₹) <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={freightRupees}
                onChange={(e) => setFreightRupees(e.target.value)}
                placeholder="0.00"
                required
                className="w-full text-sm font-mono font-semibold border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="lg:col-span-3 grid grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-white border border-slate-200">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
                  Freight Revenue
                </span>
                <span className="text-base font-bold text-emerald-700 tabular-nums">
                  {formatRupees(financialPreview.freightAmountPaise)}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-white border border-slate-200">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
                  Total Expenses
                </span>
                <span className="text-base font-bold text-rose-700 tabular-nums">
                  {formatRupees(financialPreview.totalExpensesPaise)}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-indigo-50/60 border border-indigo-200">
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-900 block">
                  Trip Profit
                </span>
                <span
                  className={`text-base font-bold tabular-nums ${
                    financialPreview.profitPaise >= 0 ? 'text-indigo-900' : 'text-rose-700'
                  }`}
                >
                  {formatRupees(financialPreview.profitPaise)}
                </span>
              </div>
            </div>
          </div>

          {/* Standard Expense Categories */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                Trip Expense Breakdown (Optional Categories)
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddCustomExpense}
                className="flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Custom Expense</span>
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {STANDARD_JOURNAL_EXPENSE_NAMES.map((expenseName) => {
                const draft = standardExpenses[expenseName] || { amountRupees: '', description: '' };
                return (
                  <div
                    key={expenseName}
                    className="p-2.5 rounded-lg border border-slate-200 bg-white grid grid-cols-12 gap-2 items-center"
                  >
                    <div className="col-span-5">
                      <span className="text-xs font-semibold text-slate-800 block">{expenseName}</span>
                    </div>
                    <div className="col-span-3">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={draft.amountRupees}
                        onChange={(e) =>
                          setStandardExpenses((prev) => ({
                            ...prev,
                            [expenseName]: { ...draft, amountRupees: e.target.value },
                          }))
                        }
                        placeholder="₹ 0"
                        aria-label={`${expenseName} amount`}
                        className="w-full text-xs font-mono border border-slate-300 rounded-md px-2 py-1.5 text-slate-900"
                      />
                    </div>
                    <div className="col-span-4">
                      <input
                        type="text"
                        value={draft.description}
                        onChange={(e) =>
                          setStandardExpenses((prev) => ({
                            ...prev,
                            [expenseName]: { ...draft, description: e.target.value },
                          }))
                        }
                        placeholder="Description"
                        maxLength={300}
                        aria-label={`${expenseName} description`}
                        className="w-full text-xs border border-slate-300 rounded-md px-2 py-1.5 text-slate-700"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Custom Expenses */}
            {customExpenses.length > 0 && (
              <div className="space-y-2 pt-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                  Custom Expenses
                </span>
                {customExpenses.map((row) => (
                  <div
                    key={row.key}
                    className="p-2.5 rounded-lg border border-indigo-200 bg-indigo-50/30 grid grid-cols-12 gap-2 items-center"
                  >
                    <div className="col-span-4">
                      <input
                        type="text"
                        value={row.expenseName}
                        onChange={(e) =>
                          setCustomExpenses((prev) =>
                            prev.map((item) =>
                              item.key === row.key ? { ...item, expenseName: e.target.value } : item
                            )
                          )
                        }
                        placeholder="Expense Name (e.g. Weighbridge)"
                        maxLength={120}
                        className="w-full text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white text-slate-900"
                      />
                    </div>
                    <div className="col-span-3">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.amountRupees}
                        onChange={(e) =>
                          setCustomExpenses((prev) =>
                            prev.map((item) =>
                              item.key === row.key ? { ...item, amountRupees: e.target.value } : item
                            )
                          )
                        }
                        placeholder="₹ Amount"
                        className="w-full text-xs font-mono border border-slate-300 rounded-md px-2 py-1.5 bg-white text-slate-900"
                      />
                    </div>
                    <div className="col-span-4">
                      <input
                        type="text"
                        value={row.description}
                        onChange={(e) =>
                          setCustomExpenses((prev) =>
                            prev.map((item) =>
                              item.key === row.key ? { ...item, description: e.target.value } : item
                            )
                          )
                        }
                        placeholder="Optional description"
                        maxLength={300}
                        className="w-full text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white text-slate-700"
                      />
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          setCustomExpenses((prev) => prev.filter((item) => item.key !== row.key))
                        }
                        className="p-1.5 rounded-md text-rose-600 hover:bg-rose-100 cursor-pointer"
                        title="Remove custom expense"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Section C: Additional Information */}
        <section className="space-y-4">
          <div className="border-b border-slate-200 pb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              C. Additional Information & Attachments
            </h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Odometer Start (KM)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={odometerStart}
                onChange={(e) => setOdometerStart(e.target.value)}
                placeholder="Optional"
                className="w-full text-xs sm:text-sm font-mono border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Odometer End (KM)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={odometerEnd}
                onChange={(e) => setOdometerEnd(e.target.value)}
                placeholder="Optional"
                className="w-full text-xs sm:text-sm font-mono border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Distance Travelled (Auto)
              </label>
              <div className="w-full text-xs sm:text-sm font-mono font-semibold border border-slate-200 rounded-lg p-2.5 bg-slate-50 text-slate-800 tabular-nums">
                {calculatedDistance !== null ? `${calculatedDistance} km` : '—'}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Notes / Trip Description
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              placeholder="Physical register page reference, consignee notes, or legacy sheet remarks..."
              className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900"
            />
          </div>

          {/* Attachments */}
          <div className="p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <span className="text-xs font-semibold text-slate-800 block">
                  Document / Bill Attachments (PDF, JPG, JPEG, PNG — Max 15 MB)
                </span>
                <span className="text-[11px] text-slate-500">
                  Stored privately in your company vault (receipts, register scans, legacy LR copies)
                </span>
              </div>
              <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shadow-xs shrink-0">
                {uploadingAttachment ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                ) : (
                  <Upload className="w-3.5 h-3.5 text-indigo-600" />
                )}
                <span>{uploadingAttachment ? `Uploading ${uploadProgress}%` : 'Upload Attachment'}</span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  multiple
                  disabled={uploadingAttachment || submitting}
                  onChange={(e) => {
                    handleUploadFiles(e.target.files);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </label>
            </div>

            {uploadingAttachment && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-semibold text-indigo-700">
                  <span>Uploading attachment to private Storage...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all duration-150"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {attachmentPaths.length > 0 && (
              <ul className="space-y-1.5">
                {attachmentPaths.map((path) => (
                  <li
                    key={path}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      <span className="truncate font-medium text-slate-800">
                        {extractAttachmentFileName(path)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenAttachment(path)}
                        className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Preview</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(path)}
                        className="text-rose-600 hover:text-rose-800 p-1 cursor-pointer"
                        title="Remove attachment"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Section D: Record Status */}
        <section className="space-y-3">
          <div className="border-b border-slate-200 pb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              D. Record Status
            </h4>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs sm:text-sm font-medium text-slate-800 cursor-pointer">
              <input
                type="radio"
                name="journalStatus"
                value="completed"
                checked={status === 'completed'}
                onChange={() => setStatus('completed')}
                className="text-indigo-600 focus:ring-indigo-500"
              />
              <span>Completed (Included in Trips Journal financial totals)</span>
            </label>

            <label className="flex items-center gap-2 text-xs sm:text-sm font-medium text-slate-800 cursor-pointer">
              <input
                type="radio"
                name="journalStatus"
                value="cancelled"
                checked={status === 'cancelled'}
                onChange={() => setStatus('cancelled')}
                className="text-rose-600 focus:ring-rose-500"
              />
              <span>Cancelled (Excluded from revenue, expense & profit totals)</span>
            </label>
          </div>
        </section>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={handleCloseCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={uploadingAttachment}
          >
            {isEditMode ? 'Save Changes' : 'Save Journal Trip'}
          </Button>
        </div>
      </form>

      {previewAttachment && (
        <FilePreviewModal
          isOpen={Boolean(previewAttachment)}
          onClose={() => setPreviewAttachment(null)}
          fileName={previewAttachment.fileName}
          downloadUrl={previewAttachment.url}
          categoryLabel="Trips Journal Attachment"
        />
      )}
    </Modal>
  );
};
