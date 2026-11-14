import React, { useState, useEffect } from 'react';
import { X, Building2, AlertCircle, FileText, Phone, MapPin } from 'lucide-react';
import { Customer } from '../../types/tms';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import { saveCustomerInFirestore } from '../../lib/firebase/firestoreService';

interface CustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (customer: Customer, isEdit: boolean) => void;
  customerToEdit?: Customer | null;
  token?: string;
}

const INDIAN_STATES = [
  { code: '19', name: 'West Bengal' },
  { code: '21', name: 'Odisha' },
  { code: '10', name: 'Bihar' },
  { code: '20', name: 'Jharkhand' },
  { code: '18', name: 'Assam' },
  { code: '27', name: 'Maharashtra' },
  { code: '07', name: 'Delhi' },
  { code: '24', name: 'Gujarat' },
  { code: '29', name: 'Karnataka' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '36', name: 'Telangana' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '08', name: 'Rajasthan' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '06', name: 'Haryana' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '16', name: 'Tripura' },
];

export const CustomerModal: React.FC<CustomerModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  customerToEdit,
}) => {
  const { company, customers: allCustomers } = useFirestoreData();
  const isEdit = Boolean(customerToEdit);

  const [name, setName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [pincode, setPincode] = useState('');
  const [creditPeriodDays, setCreditPeriodDays] = useState('30');
  const [creditLimit, setCreditLimit] = useState('');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (customerToEdit) {
      setName(customerToEdit.name || '');
      setTradeName(customerToEdit.tradeName || '');
      setGstin(customerToEdit.gstin || '');
      setPan(customerToEdit.pan || '');
      setContactPerson(customerToEdit.contactPerson || '');
      setPhone(customerToEdit.phone?.replace(/[^0-9]/g, '').slice(-10) || '');
      setEmail(customerToEdit.email || '');
      setBillingAddress(customerToEdit.billingAddress || '');
      setCity(customerToEdit.city || '');
      setState(customerToEdit.state || '');
      setStateCode(customerToEdit.stateCode || '');
      setPincode(customerToEdit.pincode || '');
      setCreditPeriodDays(customerToEdit.creditPeriodDays?.toString() || '30');
      setCreditLimit(customerToEdit.creditLimitPaise ? (customerToEdit.creditLimitPaise / 100).toString() : '');
      setNotes(customerToEdit.notes || '');
    } else {
      setName('');
      setTradeName('');
      setGstin('');
      setPan('');
      setContactPerson('');
      setPhone('');
      setEmail('');
      setBillingAddress('');
      setCity('');
      setState('');
      setStateCode('');
      setPincode('');
      setCreditPeriodDays('30');
      setCreditLimit('');
      setNotes('');
    }
    setError(null);
  }, [customerToEdit, isOpen]);

  // Handle GSTIN change: auto-extract PAN and State code
  const handleGstinChange = (val: string) => {
    const uppercase = val.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setGstin(uppercase);

    if (uppercase.length >= 2) {
      const code = uppercase.substring(0, 2);
      const matched = INDIAN_STATES.find((s) => s.code === code);
      if (matched) {
        setStateCode(matched.code);
        setState(matched.name);
      }
    }

    if (uppercase.length >= 12) {
      const extractedPan = uppercase.substring(2, 12);
      setPan(extractedPan);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!company?.id) {
        throw new Error('Active company profile is required before saving a customer.');
      }

      if (!name.trim()) {
        throw new Error('Corporate customer name is required.');
      }

      const cleanGstin = gstin.trim().toUpperCase();
      const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
      if (!GST_REGEX.test(cleanGstin)) {
        throw new Error('Invalid GSTIN format. Must be a valid 15-character GST identification number (e.g. 19AAACS4128F1Z8).');
      }

      const duplicateGstin = allCustomers.find(
        (c) => c.id !== customerToEdit?.id && (c.gstin || '').trim().toUpperCase() === cleanGstin
      );
      if (duplicateGstin) {
        throw new Error(`GSTIN ${cleanGstin} is already registered to ${duplicateGstin.name}.`);
      }

      const cleanPhone = phone.replace(/[^0-9]/g, '').slice(-10);
      if (cleanPhone.length !== 10) {
        throw new Error('Please enter a valid 10-digit Indian phone number.');
      }

      const parsedCreditDays = parseInt(creditPeriodDays, 10) || 30;
      const customerId = customerToEdit?.id || `cust_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const nowIso = new Date().toISOString();

      const customerObj: Customer = {
        id: customerId,
        companyId: company.id,
        name: name.trim(),
        tradeName: tradeName.trim() || undefined,
        gstin: cleanGstin,
        pan: pan.trim().toUpperCase() || cleanGstin.substring(2, 12),
        contactPerson: contactPerson.trim() || 'Authorized Coordinator',
        phone: cleanPhone,
        email: email.trim().toLowerCase() || '',
        billingAddress: billingAddress.trim() || '',
        city: city.trim() || '',
        state: state.trim() || '',
        stateCode: stateCode.trim() || cleanGstin.substring(0, 2),
        pincode: pincode.trim() || '',
        creditPeriodDays: parsedCreditDays,
        paymentTermsDays: parsedCreditDays,
        creditLimitPaise: Math.round((parseFloat(creditLimit) || 0) * 100),
        currentOutstandingPaise: customerToEdit?.currentOutstandingPaise ?? 0,
        totalFreightBilledPaise: customerToEdit?.totalFreightBilledPaise ?? 0,
        notes: notes.trim() || undefined,
        createdAt: customerToEdit?.createdAt || nowIso,
        updatedAt: nowIso,
      };

      await saveCustomerInFirestore(company.id, customerObj);
      onSuccess(customerObj, isEdit);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error saving customer.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-indigo-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg">
                {isEdit ? `Edit Customer: ${customerToEdit?.name}` : 'Add Consignor / Corporate Customer'}
              </h3>
              <p className="text-xs text-slate-400">
                {isEdit
                  ? 'Update GSTIN, payment credit period, billing address, and credit limits'
                  : 'Register a consignor or consignee client for freight billing and Lorry Receipt generation'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Unable to save customer</p>
                <p className="text-xs mt-0.5 text-rose-700">{error}</p>
              </div>
            </div>
          )}

          {/* Section 1: Legal Entity & GST Information */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-2">
              <Building2 className="w-3.5 h-3.5 text-indigo-600" />
              <span>1. Corporate Identity & GSTIN</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Customer Legal Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Shyam Steel Industries Ltd."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Trade / Brand Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Shyam Steel Kolkata Hub"
                  value={tradeName}
                  onChange={(e) => setTradeName(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  GSTIN (15 characters) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={15}
                  placeholder="19AAACS4128F1Z8"
                  value={gstin}
                  onChange={(e) => handleGstinChange(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 font-mono font-bold uppercase bg-white text-slate-900 tracking-wider"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  First 2 digits match state code (e.g. 19 for West Bengal, 21 for Odisha)
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Company PAN Number
                </label>
                <input
                  type="text"
                  maxLength={10}
                  placeholder="AAACS4128F"
                  value={pan}
                  onChange={(e) => setPan(e.target.value.toUpperCase())}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 font-mono uppercase bg-white text-slate-900 font-semibold"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Contact Person & Communication */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-2">
              <Phone className="w-3.5 h-3.5 text-indigo-600" />
              <span>2. Contact Coordinator & Communication</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Contact Person Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Debabrata Roy (Logistics Mgr)"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Contact Mobile <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-xs font-mono font-bold">
                    +91
                  </span>
                  <input
                    type="tel"
                    required
                    maxLength={10}
                    placeholder="9830122890"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full pl-11 pr-3 py-2.5 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Billing Email
                </label>
                <input
                  type="email"
                  placeholder="logistics@shyamsteel.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Billing Address & State */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-2">
              <MapPin className="w-3.5 h-3.5 text-indigo-600" />
              <span>3. Billing Address & State Codes</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="sm:col-span-4">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Registered Billing Address
                </label>
                <input
                  type="text"
                  placeholder="Shyam Towers, EN-32, Sector V, Salt Lake City, Kolkata - 700091"
                  value={billingAddress}
                  onChange={(e) => setBillingAddress(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  City / Industrial Hub
                </label>
                <input
                  type="text"
                  placeholder="Kolkata"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  State / UT
                </label>
                <select
                  value={stateCode}
                  onChange={(e) => {
                    const code = e.target.value;
                    setStateCode(code);
                    const matched = INDIAN_STATES.find((s) => s.code === code);
                    setState(matched ? matched.name : '');
                  }}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900"
                >
                  <option value="">-- Select State --</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  GST State Code
                </label>
                <input
                  type="text"
                  readOnly
                  value={stateCode}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 font-mono bg-slate-100 text-slate-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Pincode
                </label>
                <input
                  type="text"
                  maxLength={6}
                  placeholder="700091"
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 font-mono bg-white text-slate-900"
                />
              </div>
            </div>
          </div>

          {/* Section 4: Agreed Commercial Payment Terms */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-2">
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
              <span>4. Agreed Commercial Payment Terms</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Agreed Credit Period (Days)
                </label>
                <select
                  value={creditPeriodDays}
                  onChange={(e) => setCreditPeriodDays(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 font-semibold"
                >
                  <option value="0">0 Days (Cash Against Delivery / Advance)</option>
                  <option value="15">15 Days (Net 15)</option>
                  <option value="30">30 Days (Standard Corporate Net 30)</option>
                  <option value="45">45 Days (Net 45)</option>
                  <option value="60">60 Days (Net 60)</option>
                  <option value="90">90 Days (Extended PSU)</option>
                </select>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Invoices automatically calculate due date from this term
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Total Credit Limit (₹)
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-xs font-bold">
                    ₹
                  </span>
                  <input
                    type="number"
                    value={creditLimit}
                    onChange={(e) => setCreditLimit(e.target.value)}
                    placeholder="500000"
                    className="w-full pl-7 pr-3 py-2.5 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900 font-semibold"
                  />
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Maximum permitted unpaid freight invoices
                </span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Internal Client Remarks & Loading Instructions
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Preferred loading bay at Dankuni hub, requires hard copy signed POD with physical invoice delivery"
              className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors"
            >
              {loading && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              <span>{isEdit ? 'Save Changes' : 'Register Customer'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
