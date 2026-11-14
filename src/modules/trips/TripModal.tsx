import React, { useState, useEffect, useMemo } from 'react';
import {
  Navigation,
  Truck,
  Building2,
  AlertTriangle,
  Scale,
  MapPin,
} from 'lucide-react';
import { Trip, Vehicle, Driver, Customer, TripStatus, DriverAdvance } from '../../types/tms';
import { Modal } from '../../components/ui/Modal';
import { formatINR, rupeesToPaise } from '../../lib/currency';
import { useAuth } from '../../context/AuthContext';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import { getNextTripNumber, getNextLrNumber } from '../../lib/tmsCalculations';
import { createOrUpdateTripInFirestore } from '../../lib/firebase/firestoreService';

interface TripModalProps {
  isOpen: boolean;
  onClose: () => void;
  tripToEdit?: Trip | null;
  onSuccess: (trip: Trip, isEdit: boolean) => void;
  localVehicles: Vehicle[];
  localDrivers: Driver[];
  localCustomers: Customer[];
}

export const TripModal: React.FC<TripModalProps> = ({
  isOpen,
  onClose,
  tripToEdit,
  onSuccess,
  localVehicles = [],
  localDrivers = [],
  localCustomers = [],
}) => {
  const { user } = useAuth();
  const {
    company,
    trips: allTrips,
    vehicles: firestoreVehicles,
    drivers: firestoreDrivers,
    customers: firestoreCustomers,
  } = useFirestoreData();

  const effectiveCustomers = firestoreCustomers.length > 0 ? firestoreCustomers : localCustomers;
  const effectiveVehicles = firestoreVehicles.length > 0 ? firestoreVehicles : localVehicles;
  const effectiveDrivers = firestoreDrivers.length > 0 ? firestoreDrivers : localDrivers;

  const [customerId, setCustomerId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [originCity, setOriginCity] = useState('');
  const [destinationCity, setDestinationCity] = useState('');
  const [dispatchDate, setDispatchDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [goodsType, setGoodsType] = useState('');
  const [weightTonnes, setWeightTonnes] = useState('');
  const [ratePerTonneRupees, setRatePerTonneRupees] = useState('');
  const [otherChargesRupees, setOtherChargesRupees] = useState('0');
  const [initialAdvanceRupees, setInitialAdvanceRupees] = useState('0');
  const [status, setStatus] = useState<TripStatus>('DISPATCHED');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computedTripNumber = useMemo(
    () => (tripToEdit ? tripToEdit.tripNumber : getNextTripNumber(allTrips, company)),
    [tripToEdit, allTrips, company]
  );

  const computedLrNumber = useMemo(
    () => (tripToEdit ? tripToEdit.lrNumber : getNextLrNumber(allTrips, company)),
    [tripToEdit, allTrips, company]
  );

  const resetForm = () => {
    setCustomerId('');
    setVehicleId('');
    setDriverId('');
    setOriginCity('');
    setDestinationCity('');
    const todayStr = new Date().toISOString().split('T')[0];
    setDispatchDate(todayStr);
    const expDate = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().split('T')[0];
    setExpectedDeliveryDate(expDate);
    setGoodsType('');
    setWeightTonnes('');
    setRatePerTonneRupees('');
    setOtherChargesRupees('0');
    setInitialAdvanceRupees('0');
    setStatus('DISPATCHED');
    setNotes('');
    setError(null);
  };

  useEffect(() => {
    if (isOpen) {
      if (tripToEdit) {
        setCustomerId(tripToEdit.customerId);
        setVehicleId(tripToEdit.vehicleId);
        setDriverId(tripToEdit.driverId);
        setOriginCity(tripToEdit.originCity);
        setDestinationCity(tripToEdit.destinationCity);
        setDispatchDate(tripToEdit.dispatchDate.split('T')[0]);
        setExpectedDeliveryDate(
          tripToEdit.expectedDeliveryDate ? tripToEdit.expectedDeliveryDate.split('T')[0] : ''
        );
        setGoodsType(tripToEdit.goodsType);
        setWeightTonnes(tripToEdit.weightTonnes.toString());
        setRatePerTonneRupees((tripToEdit.ratePerTonnePaise / 100).toString());
        setOtherChargesRupees(((tripToEdit.otherChargesPaise || 0) / 100).toString());
        setInitialAdvanceRupees('0');
        setStatus(tripToEdit.status);
        setNotes(tripToEdit.notes || '');
        setError(null);
      } else {
        resetForm();
      }
    }
  }, [isOpen, tripToEdit]);

  if (!isOpen) return null;

  const selectedVehicle = effectiveVehicles.find((v) => v.id === vehicleId);
  const selectedDriver = effectiveDrivers.find((d) => d.id === driverId);
  const selectedCustomer = effectiveCustomers.find((c) => c.id === customerId);

  const weight = parseFloat(weightTonnes) || 0;
  const rateRupees = parseFloat(ratePerTonneRupees) || 0;
  const otherRupees = parseFloat(otherChargesRupees) || 0;
  const advanceRupees = parseFloat(initialAdvanceRupees) || 0;
  const computedFreightRupees = weight * rateRupees;
  const totalRevenueRupees = computedFreightRupees + otherRupees;

  const isVehicleBusy =
    selectedVehicle?.status === 'IN_TRANSIT' &&
    (!tripToEdit || tripToEdit.vehicleId !== selectedVehicle.id);
  const isVehicleInGarage = selectedVehicle?.status === 'UNDER_MAINTENANCE';
  const isDriverBusy =
    selectedDriver?.status === 'ON_TRIP' &&
    (!tripToEdit || tripToEdit.driverId !== selectedDriver.id);
  const isOverweight = selectedVehicle && weight > selectedVehicle.capacityTonnes;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!company?.id) {
        throw new Error('Active company profile is not loaded yet.');
      }
      if (!customerId || !selectedCustomer) {
        throw new Error('Please select a Customer / Consignor for this dispatch.');
      }
      if (!vehicleId || !selectedVehicle) {
        throw new Error('Please select an assigned Vehicle / Commercial Truck.');
      }
      if (!driverId || !selectedDriver) {
        throw new Error('Please select an assigned Commercial Driver.');
      }
      if (!originCity.trim() || !destinationCity.trim()) {
        throw new Error('Both loading origin and delivery destination cities are required.');
      }
      if (!goodsType.trim()) {
        throw new Error('Commodity / goods description is required.');
      }
      if (weight <= 0) {
        throw new Error('Cargo weight must be a positive number in tonnes.');
      }
      if (rateRupees <= 0) {
        throw new Error('Freight rate per tonne must be greater than zero.');
      }

      const finalExpectedDelivery =
        expectedDeliveryDate ||
        new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().split('T')[0];

      const freightAmountPaise = rupeesToPaise(computedFreightRupees);
      const otherChargesPaise = rupeesToPaise(otherRupees);
      const totalRevenuePaise = freightAmountPaise + otherChargesPaise;
      const initialAdvancePaise = !tripToEdit ? rupeesToPaise(Math.max(0, advanceRupees)) : 0;

      const tripId =
        tripToEdit?.id || `trp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      const existingExpensesPaise = tripToEdit?.totalExpensesPaise || 0;
      const existingAdvancesPaise = tripToEdit?.totalAdvancesPaise || 0;

      const tripPayload: Trip = {
        ...(tripToEdit || {}),
        id: tripId,
        companyId: company.id,
        tripNumber: computedTripNumber,
        lrNumber: computedLrNumber,
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        customerGstin: selectedCustomer.gstin || '',
        vehicleId: selectedVehicle.id,
        vehicleReg: selectedVehicle.registrationNumber,
        driverId: selectedDriver.id,
        driverName: selectedDriver.fullName,
        driverPhone: selectedDriver.phone || '',
        originCity: originCity.trim(),
        destinationCity: destinationCity.trim(),
        goodsType: goodsType.trim(),
        weightTonnes: weight,
        ratePerTonnePaise: rupeesToPaise(rateRupees),
        freightAmountPaise,
        otherChargesPaise,
        totalRevenuePaise,
        dispatchDate,
        expectedDeliveryDate: finalExpectedDelivery,
        status,
        startOdometerKm:
          tripToEdit?.startOdometerKm ?? selectedVehicle.currentOdometerKm ?? 0,
        podReceived: tripToEdit?.podReceived ?? false,
        totalExpensesPaise: existingExpensesPaise,
        totalAdvancesPaise: tripToEdit ? existingAdvancesPaise : initialAdvancePaise,
        tripContributionPaise: totalRevenuePaise - existingExpensesPaise,
        isSettled: tripToEdit?.isSettled ?? false,
        isInvoiced: tripToEdit?.isInvoiced ?? false,
        notes: notes.trim() || undefined,
        createdAt: tripToEdit?.createdAt || new Date().toISOString(),
      };

      const initialAdvance: DriverAdvance | null =
        !tripToEdit && initialAdvancePaise > 0
          ? {
              id: `adv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              companyId: company.id,
              tripId,
              tripNumber: computedTripNumber,
              driverId: selectedDriver.id,
              driverName: selectedDriver.fullName,
              vehicleReg: selectedVehicle.registrationNumber,
              amountPaise: initialAdvancePaise,
              advanceType: 'CASH_DISPATCH',
              date: dispatchDate,
              referenceNotes: 'Initial cash advance at trip dispatch',
              disbursedBy: user?.name || user?.email || 'Dispatcher',
              isSettled: false,
            }
          : null;

      await createOrUpdateTripInFirestore(company.id, {
        trip: tripPayload,
        vehicle: selectedVehicle,
        driver: selectedDriver,
        initialAdvance,
      });

      onSuccess(tripPayload, Boolean(tripToEdit));
      resetForm();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error occurred while saving trip to Firestore.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={tripToEdit ? `Edit Trip ${tripToEdit.tripNumber}` : 'Dispatch New Commercial Trip'}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-700 text-xs font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Numbers Header */}
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Trip Number</span>
              <span className="font-mono font-bold text-slate-900 text-sm">{computedTripNumber || 'Auto-generated'}</span>
            </div>
            <div className="h-6 w-px bg-slate-200" />
            <div>
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">LR / Bilty Number</span>
              <span className="font-mono font-bold text-indigo-700 text-sm">{computedLrNumber || 'Auto-generated'}</span>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Initial Status</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <label className="flex items-center gap-1 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="tripStatus"
                  value="DISPATCHED"
                  checked={status === 'DISPATCHED'}
                  onChange={() => setStatus('DISPATCHED')}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span>Dispatched</span>
              </label>
              <label className="flex items-center gap-1 text-xs font-medium text-slate-700 cursor-pointer ml-2">
                <input
                  type="radio"
                  name="tripStatus"
                  value="PLANNED"
                  checked={status === 'PLANNED'}
                  onChange={() => setStatus('PLANNED')}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span>Planned</span>
              </label>
            </div>
          </div>
        </div>

        {/* Section 1: Customer & Route */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-1 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-indigo-600" />
            <span>Customer & Route Booking</span>
          </h4>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Select Customer / Consignor <span className="text-rose-500">*</span>
            </label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium focus:ring-2 focus:ring-indigo-500 bg-white"
              required
            >
              <option value="">
                {effectiveCustomers.length === 0
                  ? '-- No Customer Parties Registered --'
                  : '-- Choose Consignor / Client --'}
              </option>
              {effectiveCustomers.map((c) => {
                const loc = [c.city, c.state].filter(Boolean).join(', ');
                return (
                  <option key={c.id} value={c.id}>
                    {c.name} (GSTIN: {c.gstin}{loc ? ` - ${loc}` : ''})
                  </option>
                );
              })}
            </select>
            {effectiveCustomers.length === 0 && (
              <div className="mt-1.5 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block">No customer parties registered yet.</span>
                  <span className="text-[11px] text-amber-700">
                    Customers will only appear here after you register them in the Customers (Parties) module.
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                <span>Loading Origin City</span>
              </label>
              <input
                type="text"
                value={originCity}
                onChange={(e) => setOriginCity(e.target.value)}
                placeholder="e.g. Kolkata, WB (Dankuni Hub)"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-indigo-500" />
                <span>Unloading Destination City</span>
              </label>
              <input
                type="text"
                value={destinationCity}
                onChange={(e) => setDestinationCity(e.target.value)}
                placeholder="e.g. Siliguri, WB / Jamshedpur, JH"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
          </div>
        </div>

        {/* Section 2: Fleet Assignment & Conflict Warnings */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-1 flex items-center gap-1.5">
            <Truck className="w-3.5 h-3.5 text-indigo-600" />
            <span>Vehicle & Driver Assignment</span>
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Assigned Truck <span className="text-rose-500">*</span>
              </label>
              <select
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg text-xs font-medium focus:ring-2 focus:ring-indigo-500 bg-white ${
                  isVehicleBusy || isVehicleInGarage ? 'border-amber-400 bg-amber-50/30' : 'border-slate-300'
                }`}
                required
              >
                <option value="">
                  {effectiveVehicles.length === 0
                    ? '-- No Commercial Trucks Registered --'
                    : '-- Choose Commercial Truck --'}
                </option>
                {effectiveVehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registrationNumber} — {v.makeModel} ({v.capacityTonnes}T | {v.status.replace('_', ' ')})
                  </option>
                ))}
              </select>

              {effectiveVehicles.length === 0 && (
                <div className="mt-1.5 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block">No commercial trucks registered yet.</span>
                    <span className="text-[11px] text-amber-700">
                      Trucks will only appear here after you register them in the Vehicles / Trucks module.
                    </span>
                  </div>
                </div>
              )}

              {isVehicleBusy && (
                <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-700 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>Truck is currently marked IN TRANSIT on another trip.</span>
                </div>
              )}
              {isVehicleInGarage && (
                <div className="mt-1 flex items-center gap-1 text-[11px] text-rose-700 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>Truck is under maintenance in workshop.</span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Assigned Driver <span className="text-rose-500">*</span>
              </label>
              <select
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg text-xs font-medium focus:ring-2 focus:ring-indigo-500 bg-white ${
                  isDriverBusy ? 'border-amber-400 bg-amber-50/30' : 'border-slate-300'
                }`}
                required
              >
                <option value="">
                  {effectiveDrivers.length === 0
                    ? '-- No Commercial Drivers Registered --'
                    : '-- Choose Commercial Driver --'}
                </option>
                {effectiveDrivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName} ({d.phone} | DL: {d.licenseNumber} | {d.status.replace('_', ' ')})
                  </option>
                ))}
              </select>

              {effectiveDrivers.length === 0 && (
                <div className="mt-1.5 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block">No commercial drivers registered yet.</span>
                    <span className="text-[11px] text-amber-700">
                      Drivers will only appear here after you register them in the Drivers module.
                    </span>
                  </div>
                </div>
              )}

              {isDriverBusy && (
                <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-700 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>Driver is currently assigned ON TRIP.</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Section 3: Cargo & Freight Financials */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-1 flex items-center gap-1.5">
            <Scale className="w-3.5 h-3.5 text-indigo-600" />
            <span>Cargo & Freight Agreement</span>
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Commodity / Goods</label>
              <input
                type="text"
                value={goodsType}
                onChange={(e) => setGoodsType(e.target.value)}
                placeholder="e.g. TMT Steel Bars, Cement"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Weight (Tonnes) <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                step="0.05"
                value={weightTonnes}
                onChange={(e) => setWeightTonnes(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-indigo-500"
                required
              />
              {isOverweight && (
                <span className="text-[10px] text-amber-600 font-medium mt-0.5 block">
                  Exceeds truck rated capacity ({selectedVehicle?.capacityTonnes}T)
                </span>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Rate (₹ / Tonne) <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                step="10"
                value={ratePerTonneRupees}
                onChange={(e) => setRatePerTonneRupees(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Other Loading / Detention Charges (₹)</label>
              <input
                type="number"
                value={otherChargesRupees}
                onChange={(e) => setOtherChargesRupees(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Initial Driver Cash Advance (₹)
              </label>
              <input
                type="number"
                value={initialAdvanceRupees}
                onChange={(e) => setInitialAdvanceRupees(e.target.value)}
                disabled={Boolean(tripToEdit)}
                placeholder="₹10,000 – ₹20,000 cash for diesel/toll"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100"
              />
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Advances are recorded as balance sheet float, not corporate expenses.
              </span>
            </div>
          </div>

          <div className="bg-emerald-50/80 p-3 rounded-xl border border-emerald-200 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wider block">
                Total Freight Revenue
              </span>
              <span className="text-xs text-emerald-700">
                {weight > 0 && rateRupees > 0 ? (
                  `${weight} Tonnes @ ₹${rateRupees}/Tonne ${otherRupees > 0 ? `+ ₹${otherRupees} extra charges` : ''}`
                ) : (
                  'Enter cargo weight and freight rate above to calculate agreed freight revenue'
                )}
              </span>
            </div>
            <div className="text-right">
              <span className="font-bold text-emerald-900 text-lg">
                {weight > 0 && rateRupees > 0
                  ? formatINR(rupeesToPaise(totalRevenueRupees))
                  : '₹0'}
              </span>
            </div>
          </div>
        </div>

        {/* Section 4: Schedule & Notes */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Dispatch Date</label>
            <input
              type="date"
              value={dispatchDate}
              onChange={(e) => setDispatchDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Expected Delivery Date</label>
            <input
              type="date"
              value={expectedDeliveryDate}
              onChange={(e) => setExpectedDeliveryDate(e.target.value)}
              min={dispatchDate}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Dispatch Notes / Consignment Special Instructions</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Tarpaulin cover mandatory, weighbridge token at Dankuni required..."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-200">
          <div>
            {!tripToEdit && (
              <button
                type="button"
                onClick={resetForm}
                disabled={loading}
                className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                title="Clear all fields"
              >
                Reset Form
              </button>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5"
            >
              {loading ? (
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Navigation className="w-4 h-4" />
              )}
              <span>{tripToEdit ? 'Save Changes' : status === 'DISPATCHED' ? 'Book & Dispatch Trip' : 'Book Planned Trip'}</span>
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
