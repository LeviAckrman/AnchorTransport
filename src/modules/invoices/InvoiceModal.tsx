import React, { useState, useEffect, useMemo } from 'react';
import {
  Info,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Invoice } from '../../types/tms';
import { formatINR, paiseToRupees, rupeesToPaise, calculateGstInvoice } from '../../lib/financialEngine';
import { useAuth } from '../../context/AuthContext';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import { createInvoiceInFirestore, updateInvoiceInFirestore } from '../../lib/firebase/firestoreService';
import { getNextInvoiceNumber } from '../../lib/tmsCalculations';

interface InvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (invoice: Invoice, isEdit?: boolean) => void;
  preselectedTripId?: string;
  invoiceToEdit?: Invoice | null;
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  preselectedTripId,
  invoiceToEdit,
}) => {
  const { user, company: authCompany } = useAuth();
  const {
    company: liveCompany,
    companySettings,
    trips,
    customers,
    invoices,
    loading: dataLoading,
  } = useFirestoreData();
  const company = liveCompany?.id ? liveCompany : authCompany;

  const isEdit = Boolean(invoiceToEdit);

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
  const [discountRupees, setDiscountRupees] = useState('0');
  const [isRcmApplicable, setIsRcmApplicable] = useState(true);
  const [gstRatePercent, setGstRatePercent] = useState('5');
  const [invoiceStatus, setInvoiceStatus] = useState<'ISSUED' | 'DRAFT'>('ISSUED');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate or reset form on modal open
  useEffect(() => {
    if (!isOpen) return;
    setError(null);

    if (invoiceToEdit) {
      setSelectedTripId(invoiceToEdit.tripId || '');
      setSelectedCustomerId(invoiceToEdit.customerId || '');
      setIssueDate(invoiceToEdit.issueDate || new Date().toISOString().split('T')[0]);
      setDueDate(invoiceToEdit.dueDate || '');
      setFreightRupees(paiseToRupees(invoiceToEdit.freightAmountPaise ?? invoiceToEdit.taxableAmountPaise ?? 0).toString());
      setLoadingRupees(paiseToRupees(invoiceToEdit.loadingChargesPaise || 0).toString());
      setUnloadingRupees(paiseToRupees(invoiceToEdit.unloadingChargesPaise || 0).toString());
      setDetentionRupees(paiseToRupees(invoiceToEdit.detentionChargesPaise || 0).toString());
      setOtherRupees(paiseToRupees(invoiceToEdit.otherChargesPaise || 0).toString());
      setDiscountRupees(paiseToRupees(invoiceToEdit.discountPaise || 0).toString());
      setIsRcmApplicable(Boolean(invoiceToEdit.isRcmApplicable));
      setGstRatePercent((invoiceToEdit.gstRatePercent || 5).toString());
      setInvoiceStatus(invoiceToEdit.status === 'DRAFT' ? 'DRAFT' : 'ISSUED');
      setNotes(invoiceToEdit.notes || '');
    } else {
      const today = new Date().toISOString().split('T')[0];
      const defaultTerms = companySettings?.defaultCreditPeriodDays || 30;
      const defaultDue = new Date();
      defaultDue.setDate(defaultDue.getDate() + defaultTerms);
      setSelectedTripId(preselectedTripId || '');
      setSelectedCustomerId('');
      setIssueDate(today);
      setDueDate(defaultDue.toISOString().split('T')[0]);
      setFreightRupees('');
      setLoadingRupees('0');
      setUnloadingRupees('0');
      setDetentionRupees('0');
      setOtherRupees('0');
      setDiscountRupees('0');
      setIsRcmApplicable(companySettings?.defaultRcmEnabled ?? true);
      setGstRatePercent(String(companySettings?.defaultGstRatePercent ?? 5));
      setInvoiceStatus('ISSUED');
      setNotes('');
    }
  }, [isOpen, preselectedTripId, invoiceToEdit, companySettings]);

  // Selected trip memo
  const selectedTrip = useMemo(() => {
    return selectedTripId ? trips.find((t) => t.id === selectedTripId) || null : null;
  }, [trips, selectedTripId]);

  // When creating and selected trip changes, populate trip fields
  useEffect(() => {
    if (!isOpen || isEdit || !selectedTrip) return;

    setSelectedCustomerId(selectedTrip.customerId);
    const freightAmt = selectedTrip.freightAmountPaise || selectedTrip.totalRevenuePaise || 0;
    setFreightRupees(paiseToRupees(freightAmt).toString());
    setDetentionRupees(paiseToRupees(selectedTrip.otherChargesPaise || 0).toString());

    const cust = customers.find((c) => c.id === selectedTrip.customerId);
    const termsDays = cust?.paymentTermsDays || cust?.creditPeriodDays || 30;
    const d = new Date(issueDate || new Date().toISOString().split('T')[0]);
    if (!Number.isNaN(d.getTime())) {
      d.setDate(d.getDate() + termsDays);
      setDueDate(d.toISOString().split('T')[0]);
    }

    setNotes(
      `Freight billing for ${selectedTrip.goodsType || 'consignment'} from ${selectedTrip.originCity} to ${selectedTrip.destinationCity}. LR #${selectedTrip.lrNumber || selectedTrip.tripNumber}.`
    );
  }, [selectedTrip, customers, issueDate, isOpen, isEdit]);

  // Calculation memo
  const calculation = useMemo(() => {
    const freight = parseFloat(freightRupees) || 0;
    const loadingAmt = parseFloat(loadingRupees) || 0;
    const unloading = parseFloat(unloadingRupees) || 0;
    const detention = parseFloat(detentionRupees) || 0;
    const other = parseFloat(otherRupees) || 0;
    const discount = Math.max(0, parseFloat(discountRupees) || 0);

    const grossRupees = freight + loadingAmt + unloading + detention + other;
    const grossPaise = rupeesToPaise(grossRupees);
    const discountPaise = rupeesToPaise(discount);
    const taxableRupees = Math.max(0, grossRupees - discount);
    const taxablePaise = Math.max(0, grossPaise - discountPaise);

    const cust = customers.find((c) => c.id === selectedCustomerId);
    const customerState = cust?.stateCode || (cust?.gstin ? cust.gstin.substring(0, 2) : '');
    const companyState = company?.stateCode || (company?.gstin ? company.gstin.substring(0, 2) : '');

    const tax = calculateGstInvoice(
      grossPaise,
      companyState,
      customerState,
      isRcmApplicable,
      parseFloat(gstRatePercent) || 5,
      discountPaise
    );

    return {
      grossRupees,
      discountPaise,
      taxableRupees,
      taxablePaise,
      tax,
    };
  }, [
    freightRupees,
    loadingRupees,
    unloadingRupees,
    detentionRupees,
    otherRupees,
    discountRupees,
    isRcmApplicable,
    gstRatePercent,
    selectedCustomerId,
    customers,
    company,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!company?.id) {
      setError('Active company profile is required to issue an invoice.');
      return;
    }

    if (!isEdit && selectedTrip && selectedTrip.isInvoiced) {
      setError(`Trip ${selectedTrip.tripNumber} has already been invoiced.`);
      return;
    }

    if (!selectedCustomerId) {
      setError('Please select a customer billing party.');
      return;
    }

    if (calculation.tax.taxableAmountPaise <= 0) {
      setError('Invoice taxable freight value after discount must be greater than zero.');
      return;
    }

    if (!dueDate) {
      setError('Payment due date is required.');
      return;
    }

    setLoading(true);

    try {
      const matchedCustomer = customers.find((c) => c.id === selectedCustomerId);
      const gstRate = parseFloat(gstRatePercent) || 5;
      const tax = calculation.tax;
      const isIntra = !isRcmApplicable && tax.cgstAmountPaise > 0;
      const invoiceId =
        invoiceToEdit?.id || `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const invoiceNumber =
        invoiceToEdit?.invoiceNumber || getNextInvoiceNumber(invoices, company);
      const nowIso = new Date().toISOString();

      const customerBillingAddr = matchedCustomer
        ? [matchedCustomer.billingAddress, matchedCustomer.city, matchedCustomer.state, matchedCustomer.pincode]
            .filter(Boolean)
            .join(', ')
        : invoiceToEdit?.billingAddress;

      const existingPaidPaise = invoiceToEdit?.amountPaidPaise || 0;
      const newBalanceDuePaise = Math.max(0, tax.totalInvoiceAmountPaise - existingPaidPaise);
      const nextStatus: Invoice['status'] =
        invoiceToEdit && existingPaidPaise > 0
          ? newBalanceDuePaise === 0
            ? 'PAID'
            : 'PARTIALLY_PAID'
          : invoiceStatus;
      const nextPaymentStatus: Invoice['paymentStatus'] =
        nextStatus === 'PAID'
          ? 'PAID'
          : nextStatus === 'PARTIALLY_PAID'
          ? 'PARTIALLY_PAID'
          : 'UNPAID';

      const savedInvoice: Invoice = {
        ...(invoiceToEdit || {}),
        id: invoiceId,
        companyId: company.id,
        invoiceNumber,
        tripId: selectedTrip?.id ?? invoiceToEdit?.tripId,
        tripNumber: selectedTrip?.tripNumber ?? invoiceToEdit?.tripNumber,
        lrNumber: selectedTrip
          ? selectedTrip.lrNumber || selectedTrip.tripNumber
          : invoiceToEdit?.lrNumber,
        customerId: selectedCustomerId,
        customerName: (
          matchedCustomer?.name ||
          selectedTrip?.customerName ||
          invoiceToEdit?.customerName ||
          'Customer'
        ).slice(0, 150),
        customerGstin: (
          matchedCustomer?.gstin ||
          selectedTrip?.customerGstin ||
          invoiceToEdit?.customerGstin ||
          ''
        ).slice(0, 20),
        billingAddress: customerBillingAddr ? customerBillingAddr.slice(0, 300) : undefined,
        originCity: selectedTrip?.originCity?.slice(0, 100) ?? invoiceToEdit?.originCity,
        destinationCity: selectedTrip?.destinationCity?.slice(0, 100) ?? invoiceToEdit?.destinationCity,
        vehicleReg: selectedTrip?.vehicleReg?.slice(0, 30) ?? invoiceToEdit?.vehicleReg,
        goodsType: selectedTrip?.goodsType?.slice(0, 120) ?? invoiceToEdit?.goodsType,
        weightTonnes: selectedTrip?.weightTonnes ?? invoiceToEdit?.weightTonnes,
        ratePerTonnePaise: selectedTrip?.ratePerTonnePaise ?? invoiceToEdit?.ratePerTonnePaise,
        hsnSacCode: invoiceToEdit?.hsnSacCode || '996511',
        issueDate,
        dueDate,
        freightAmountPaise: rupeesToPaise(parseFloat(freightRupees) || 0),
        loadingChargesPaise: rupeesToPaise(parseFloat(loadingRupees) || 0),
        unloadingChargesPaise: rupeesToPaise(parseFloat(unloadingRupees) || 0),
        detentionChargesPaise: rupeesToPaise(parseFloat(detentionRupees) || 0),
        otherChargesPaise: rupeesToPaise(parseFloat(otherRupees) || 0),
        discountPaise: calculation.discountPaise > 0 ? calculation.discountPaise : undefined,
        taxableAmountPaise: tax.taxableAmountPaise,
        isRcmApplicable,
        gstRatePercent: isRcmApplicable ? 5 : gstRate,
        cgstRatePercent: isRcmApplicable ? 0 : isIntra ? gstRate / 2 : 0,
        sgstRatePercent: isRcmApplicable ? 0 : isIntra ? gstRate / 2 : 0,
        igstRatePercent: isRcmApplicable ? 0 : isIntra ? 0 : gstRate,
        cgstAmountPaise: tax.cgstAmountPaise,
        sgstAmountPaise: tax.sgstAmountPaise,
        igstAmountPaise: tax.igstAmountPaise,
        totalTaxPaise: tax.totalTaxPaise,
        totalAmountPaise: tax.totalInvoiceAmountPaise,
        amountPaidPaise: existingPaidPaise,
        balanceDuePaise: newBalanceDuePaise,
        status: nextStatus,
        paymentStatus: nextPaymentStatus,
        notes: notes.trim() ? notes.trim().slice(0, 500) : undefined,
        createdBy: invoiceToEdit?.createdBy || (user?.name || user?.email || 'Owner').slice(0, 100),
        createdAt: invoiceToEdit?.createdAt || nowIso,
      };

      if (invoiceToEdit) {
        await updateInvoiceInFirestore(company.id, savedInvoice, invoiceToEdit, matchedCustomer);
      } else {
        await createInvoiceInFirestore(company.id, savedInvoice, selectedTrip || undefined, matchedCustomer);
      }

      onSuccess(savedInvoice, isEdit);
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
      title={isEdit ? `Edit Customer Bill: ${invoiceToEdit?.invoiceNumber}` : 'Generate Customer Bill & Tax Invoice'}
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

        {/* 1. Trip Selector (Optional for Standalone Customer Bills) */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            Linked Commercial Trip (Optional)
          </label>
          {dataLoading && trips.length === 0 ? (
            <div className="py-3 text-xs text-slate-500">Loading trips list...</div>
          ) : (
            <select
              value={selectedTripId}
              disabled={isEdit}
              onChange={(e) => setSelectedTripId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-medium disabled:bg-slate-100"
            >
              <option value="">-- Standalone Customer Bill (No Trip) --</option>
              {trips
                .filter((t) => t.status !== 'CANCELLED' || t.id === selectedTripId)
                .map((t) => (
                  <option key={t.id} value={t.id} disabled={!isEdit && t.isInvoiced}>
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
              onChange={(e) => {
                const nextCustId = e.target.value;
                setSelectedCustomerId(nextCustId);
                const cust = customers.find((c) => c.id === nextCustId);
                if (cust && !isEdit) {
                  const termsDays = cust.paymentTermsDays || cust.creditPeriodDays || 30;
                  const d = new Date(issueDate || new Date().toISOString().split('T')[0]);
                  if (!Number.isNaN(d.getTime())) {
                    d.setDate(d.getDate() + termsDays);
                    setDueDate(d.toISOString().split('T')[0]);
                  }
                }
              }}
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

        {/* 3. Freight Charges & Discount Line Items */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
          <span className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
            Freight, Ancillary Charges & Discounts (₹ INR)
          </span>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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

            <div>
              <label className="block text-[11px] font-semibold text-amber-700 mb-1">
                Discount (₹)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={discountRupees}
                onChange={(e) => setDiscountRupees(e.target.value)}
                className="w-full px-2.5 py-2 bg-white border border-amber-200 rounded-lg text-amber-900 text-sm focus:outline-none focus:border-amber-500"
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
                {formatINR(calculation.tax.taxableAmountPaise)}
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
            {(!invoiceToEdit || invoiceToEdit.amountPaidPaise === 0) && (
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
            )}
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
            {isEdit
              ? 'Save Invoice Changes'
              : invoiceStatus === 'DRAFT'
              ? 'Save Draft Invoice'
              : 'Issue Invoice'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

