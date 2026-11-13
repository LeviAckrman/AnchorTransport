import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Truck,
  Building,
  Calendar,
  IndianRupee,
  ShieldAlert,
  Info,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Trip, Customer, Invoice, GTA_GST_DISCLAIMER } from '../../types/tms';
import { formatINR, paiseToRupees, rupeesToPaise, calculateGstInvoice } from '../../lib/financialEngine';
import { parseResponseJson } from '../../lib/safeFetch';
import { useAuth } from '../../context/AuthContext';
import { syncEntityToFirestore } from '../../lib/firebase/firestoreService';

interface InvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (invoice: Invoice) => void;
  preselectedTripId?: string;
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  preselectedTripId,
}) => {
  const { token, company } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(false);

  // Form states
  const [selectedTripId, setSelectedTripId] = useState(preselectedTripId || '');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [freightRupees, setFreightRupees] = useState('');
  const [loadingRupees, setLoadingRupees] = useState('0');
  const [unloadingRupees, setUnloadingRupees] = useState('0');
  const [detentionRupees, setDetentionRupees] = useState('0');
  const [otherRupees, setOtherRupees] = useState('0');
  const [isRcmApplicable, setIsRcmApplicable] = useState(true);
  const [gstRatePercent, setGstRatePercent] = useState('5');
  const [invoiceStatus, setInvoiceStatus] = useState<'ISSUED' | 'DRAFT'>('ISSUED');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch candidate trips and customers
  useEffect(() => {
    if (isOpen) {
      setSelectedTripId(preselectedTripId || '');
      setSelectedCustomerId('');
      setIssueDate(new Date().toISOString().split('T')[0]);
      setDueDate('');
      setFreightRupees('');
      setLoadingRupees('0');
      setUnloadingRupees('0');
      setDetentionRupees('0');
      setOtherRupees('0');
      setNotes('');
      setError(null);
      setLoadingInitial(true);

      Promise.all([
        fetch('/api/trips?limit=100', {
          headers: { Authorization: `Bearer ${token || ''}` },
        }).then((r) => parseResponseJson(r)),
        fetch('/api/customers?limit=100', {
          headers: { Authorization: `Bearer ${token || ''}` },
        }).then((r) => parseResponseJson(r)),
      ])
        .then(([tripData, custData]) => {
          if (tripData && tripData.success) {
            const allTrips: Trip[] = tripData.data || [];
            setTrips(allTrips);
          }
          if (custData && custData.success) {
            setCustomers(custData.data || []);
          }
        })
        .catch((err) => {
          setError(err.message || 'Failed to load eligible trips');
        })
        .finally(() => {
          setLoadingInitial(false);
        });
    }
  }, [isOpen, token, company?.id, preselectedTripId]);

  // Selected trip memo
  const selectedTrip = useMemo(() => {
    return trips.find((t) => t.id === selectedTripId) || null;
  }, [trips, selectedTripId]);

  // When selected trip changes, populate fields
  useEffect(() => {
    if (selectedTrip) {
      setSelectedCustomerId(selectedTrip.customerId);
      const freightAmt = selectedTrip.freightAmountPaise || selectedTrip.totalRevenuePaise || 0;
      setFreightRupees(paiseToRupees(freightAmt).toString());
      setDetentionRupees(paiseToRupees(selectedTrip.otherChargesPaise || 0).toString());

      // Find customer payment terms
      const cust = customers.find((c) => c.id === selectedTrip.customerId);
      const termsDays = cust?.paymentTermsDays || 30;
      const d = new Date(issueDate);
      d.setDate(d.getDate() + termsDays);
      setDueDate(d.toISOString().split('T')[0]);

      setNotes(`Freight billing for ${selectedTrip.goodsType || 'consignment'} from ${selectedTrip.originCity} to ${selectedTrip.destinationCity}. LR #${selectedTrip.lrNumber || selectedTrip.tripNumber}.`);
    }
  }, [selectedTrip, customers, issueDate]);

  // Calculation memo
  const calculation = useMemo(() => {
    const freight = parseFloat(freightRupees) || 0;
    const loading = parseFloat(loadingRupees) || 0;
    const unloading = parseFloat(unloadingRupees) || 0;
    const detention = parseFloat(detentionRupees) || 0;
    const other = parseFloat(otherRupees) || 0;

    const taxableRupees = freight + loading + unloading + detention + other;
    const taxablePaise = rupeesToPaise(taxableRupees);

    const cust = customers.find((c) => c.id === selectedCustomerId);
    const customerState = cust?.stateCode || (cust?.gstin ? cust.gstin.substring(0, 2) : '');
    const companyState = company?.stateCode || (company?.gstin ? company.gstin.substring(0, 2) : '');

    const tax = calculateGstInvoice(
      taxablePaise,
      companyState,
      customerState,
      isRcmApplicable,
      parseFloat(gstRatePercent) || 5
    );

    return {
      taxableRupees,
      taxablePaise,
      tax,
    };
  }, [freightRupees, loadingRupees, unloadingRupees, detentionRupees, otherRupees, isRcmApplicable, gstRatePercent, selectedCustomerId, customers, company]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedTripId) {
      setError('Please select a commercial trip to generate an invoice.');
      return;
    }

    if (calculation.taxableRupees <= 0) {
      setError('Invoice freight and taxable value must be greater than zero.');
      return;
    }

    if (!dueDate) {
      setError('Payment due date is required.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || ''}`,
        },
        body: JSON.stringify({
          tripId: selectedTripId,
          customerId: selectedCustomerId,
          issueDate,
          dueDate,
          freightAmountPaise: rupeesToPaise(parseFloat(freightRupees) || 0),
          loadingChargesPaise: rupeesToPaise(parseFloat(loadingRupees) || 0),
          unloadingChargesPaise: rupeesToPaise(parseFloat(unloadingRupees) || 0),
          detentionChargesPaise: rupeesToPaise(parseFloat(detentionRupees) || 0),
          otherChargesPaise: rupeesToPaise(parseFloat(otherRupees) || 0),
          isRcmApplicable,
          gstRatePercent: parseFloat(gstRatePercent) || 5,
          notes: notes.trim(),
          status: invoiceStatus,
        }),
      });

      const data = await parseResponseJson(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create invoice');
      }

      const activeCompanyId = company?.id || data.invoice?.companyId;
      if (activeCompanyId) {
        if (data.invoice) await syncEntityToFirestore(activeCompanyId, 'invoices', data.invoice);
        if (data.trip) await syncEntityToFirestore(activeCompanyId, 'trips', data.trip);
        if (data.customer) await syncEntityToFirestore(activeCompanyId, 'customers', data.customer);
      }

      window.dispatchEvent(new CustomEvent('tms:invoice-updated'));
      window.dispatchEvent(new CustomEvent('tms:trip-updated'));
      window.dispatchEvent(new CustomEvent('tms:customer-updated'));

      onSuccess(data.invoice);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Invoice generation error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Generate Customer Transport Invoice"
      maxWidth="2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-2.5 animate-in fade-in">
            <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Billing Policy Alert</p>
              <p className="text-xs text-rose-700 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Notice of Operational Scope */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start gap-2">
          <Info className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold block">Goods Transport Agency (GTA) Freight Billing</span>
            <span>
              Invoices are issued under HSN/SAC 996511. Under Reverse Charge Mechanism (RCM), tax liability shifts to the recipient. Consult a tax professional for e-Invoice portal compliance.
            </span>
          </div>
        </div>

        {/* 1. Trip Selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            Select Completed Commercial Trip *
          </label>
          {loadingInitial ? (
            <div className="py-3 text-xs text-slate-500">Loading trips list...</div>
          ) : (
            <select
              required
              value={selectedTripId}
              onChange={(e) => setSelectedTripId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-medium"
            >
              <option value="">-- Choose Trip to Bill --</option>
              {trips.map((t) => (
                <option key={t.id} value={t.id} disabled={t.isInvoiced}>
                  {t.tripNumber} ({t.lrNumber || 'No LR'}) — {t.customerName} ({t.originCity} ➔ {t.destinationCity})
                  {t.isInvoiced ? ' [ALREADY INVOICED]' : ` [${t.status}]`}
                </option>
              ))}
            </select>
          )}

          {selectedTrip && (
            <div className="mt-2.5 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-600">
              <div>
                <span className="text-slate-600 block">Vehicle:</span>
                <span className="font-bold text-slate-800">{selectedTrip.vehicleReg}</span>
              </div>
              <div>
                <span className="text-slate-600 block">Weight:</span>
                <span className="font-bold text-slate-800">{selectedTrip.weightTonnes || 0} MT</span>
              </div>
              <div>
                <span className="text-slate-600 block">Consignment:</span>
                <span className="font-bold text-slate-800">{selectedTrip.goodsType}</span>
              </div>
              <div>
                <span className="text-slate-600 block">POD Status:</span>
                <span className={`font-bold ${selectedTrip.podReceived ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {selectedTrip.podReceived ? 'POD Signed' : 'POD Pending'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 2. Customer & Dates */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Customer Party *
            </label>
            <select
              required
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
            >
              <option value="">-- Select Customer --</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.gstin || 'Unregistered'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Invoice Issue Date *
            </label>
            <input
              type="date"
              required
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Payment Due Date *
            </label>
            <input
              type="date"
              required
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
            />
          </div>
        </div>

        {/* 3. Freight Charges Line Items */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
          <span className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
            Freight & Ancillary Charges (₹ INR)
          </span>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Base Freight *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={freightRupees}
                onChange={(e) => setFreightRupees(e.target.value)}
                className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 font-bold text-sm focus:outline-none focus:border-indigo-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Loading / Hamali
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={loadingRupees}
                onChange={(e) => setLoadingRupees(e.target.value)}
                className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-indigo-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Unloading
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={unloadingRupees}
                onChange={(e) => setUnloadingRupees(e.target.value)}
                className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-indigo-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Detention / Halting
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={detentionRupees}
                onChange={(e) => setDetentionRupees(e.target.value)}
                className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-indigo-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Other Charges
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={otherRupees}
                onChange={(e) => setOtherRupees(e.target.value)}
                className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:border-indigo-600"
              />
            </div>
          </div>
        </div>

        {/* 4. GST & Tax Policy Selector */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <span className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                GST Model on Road Transport
              </span>
              <p className="text-xs text-slate-500">
                Notification No. 13/2017-Central Tax (GTA Service Tax Provisions)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsRcmApplicable(true)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                  isRcmApplicable
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                RCM 5% (Recipient Liable)
              </button>
              <button
                type="button"
                onClick={() => setIsRcmApplicable(false)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                  !isRcmApplicable
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Forward Charge (Transporter Billed)
              </button>
            </div>
          </div>

          {!isRcmApplicable && (
            <div className="pt-2 border-t border-slate-100 flex items-center gap-4 text-xs">
              <span className="font-semibold text-slate-700">GST Rate:</span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="gstRate"
                  value="5"
                  checked={gstRatePercent === '5'}
                  onChange={() => setGstRatePercent('5')}
                />
                <span>5% (Without ITC)</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="gstRate"
                  value="12"
                  checked={gstRatePercent === '12'}
                  onChange={() => setGstRatePercent('12')}
                />
                <span>12% (With ITC)</span>
              </label>
            </div>
          )}
        </div>

        {/* 5. Summary Total Card */}
        <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-3 pb-3 border-b border-slate-800">
            <div>
              <span className="text-slate-400 block">Taxable Freight:</span>
              <span className="text-sm font-semibold text-white">
                ₹{calculation.taxableRupees.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Tax Model:</span>
              <span className="text-sm font-semibold text-purple-300">
                {isRcmApplicable ? 'GTA RCM (₹0 Tax on Bill)' : `Forward Charge (${gstRatePercent}%)`}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Total GST Calculated:</span>
              <span className="text-sm font-semibold text-emerald-400">
                {formatINR(calculation.tax.totalTaxPaise)}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Total Invoice Value:</span>
              <span className="text-base font-bold text-white">
                {formatINR(calculation.tax.totalInvoiceAmountPaise)}
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-slate-300">
            <span>
              SAC Code: <strong className="text-white">996511</strong> (Goods Transport by Road)
            </span>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="invoiceStatus"
                  value="ISSUED"
                  checked={invoiceStatus === 'ISSUED'}
                  onChange={() => setInvoiceStatus('ISSUED')}
                />
                <span className="text-white font-medium">Issue Immediately</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="invoiceStatus"
                  value="DRAFT"
                  checked={invoiceStatus === 'DRAFT'}
                  onChange={() => setInvoiceStatus('DRAFT')}
                />
                <span className="text-white font-medium">Save as Draft</span>
              </label>
            </div>
          </div>
        </div>

        {/* 6. Notes & Terms */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            Invoice Notes & Bank Instructions
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
          />
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={loading}>
            <CheckCircle2 className="w-4 h-4 mr-1.5" />
            {invoiceStatus === 'DRAFT' ? 'Save Draft Invoice' : 'Issue Invoice'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
