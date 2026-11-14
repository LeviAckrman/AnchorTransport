import React, { useState, useEffect } from 'react';
import { Building2, Save, CheckCircle2, AlertCircle, ShieldAlert, CreditCard, Hash, RotateCcw, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import { PageHeader } from '../layout/PageHeader';
import { clearClientTmsCaches } from '../../lib/storage';
import { clearCompanyOperationalDataInFirestore } from '../../lib/firebase/firestoreService';
import { ConfirmDialog } from '../ui/ConfirmDialog';

export const CompanyProfilePage: React.FC = () => {
  const { role, permissions, updateCompanyProfile } = useAuth();
  const { company } = useFirestoreData();

  const [name, setName] = useState(company?.name || '');
  const [tradeName, setTradeName] = useState(company?.tradeName || '');
  const [gstin, setGstin] = useState(company?.gstin || '');
  const [pan, setPan] = useState(company?.pan || '');
  const [phone, setPhone] = useState(company?.phone || '');
  const [email, setEmail] = useState(company?.email || '');
  const [address, setAddress] = useState(company?.address || '');
  const [city, setCity] = useState(company?.city || '');
  const [state, setState] = useState(company?.state || '');
  const [stateCode, setStateCode] = useState(company?.stateCode || '');
  const [pincode, setPincode] = useState(company?.pincode || '');

  // Banking
  const [bankName, setBankName] = useState(company?.bankName || '');
  const [accountNumber, setAccountNumber] = useState(company?.accountNumber || '');
  const [ifscCode, setIfscCode] = useState(company?.ifscCode || '');
  const [branch, setBranch] = useState(company?.branch || '');

  // Numbering Prefixes
  const [lrPrefix, setLrPrefix] = useState(company?.lrPrefix || 'AT/25-26/');
  const [invoicePrefix, setInvoicePrefix] = useState(company?.invoicePrefix || 'INV/25-26/');
  const [tripPrefix, setTripPrefix] = useState(company?.tripPrefix || 'TR-');
  const [logoUrl, setLogoUrl] = useState(company?.logoUrl || '');

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    setName(company?.name || '');
    setTradeName(company?.tradeName || '');
    setGstin(company?.gstin || '');
    setPan(company?.pan || '');
    setPhone(company?.phone || '');
    setEmail(company?.email || '');
    setAddress(company?.address || '');
    setCity(company?.city || '');
    setState(company?.state || '');
    setStateCode(company?.stateCode || '');
    setPincode(company?.pincode || '');
    setBankName(company?.bankName || '');
    setAccountNumber(company?.accountNumber || '');
    setIfscCode(company?.ifscCode || '');
    setBranch(company?.branch || '');
    setLrPrefix(company?.lrPrefix || 'AT/25-26/');
    setInvoicePrefix(company?.invoicePrefix || 'INV/25-26/');
    setTripPrefix(company?.tripPrefix || 'TR-');
    setLogoUrl(company?.logoUrl || '');
  }, [company]);

  const handleResetData = async () => {
    setResetting(true);
    try {
      await clearCompanyOperationalDataInFirestore(company?.id);
      clearClientTmsCaches();

      setFeedback({
        type: 'success',
        message: 'All operational data (vehicles, trips, drivers, invoices, expenses) has been cleared in Firestore.',
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to reset operational data.',
      });
    } finally {
      setResetting(false);
      setIsResetDialogOpen(false);
    }
  };

  const canEdit = permissions?.canManageCompany ?? false;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !company?.id) return;

    setSaving(true);
    setFeedback(null);

    const result = await updateCompanyProfile({
      name,
      tradeName,
      gstin,
      pan,
      phone,
      email,
      address,
      city,
      state,
      stateCode,
      pincode,
      bankName,
      accountNumber,
      ifscCode,
      branch,
      lrPrefix,
      invoicePrefix,
      tripPrefix,
      logoUrl,
    });

    setSaving(false);
    if (result.success) {
      setFeedback({ type: 'success', message: 'Company profile and banking details updated successfully.' });
    } else {
      setFeedback({ type: 'error', message: result.error || 'Failed to update company profile.' });
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader
        title="Company Profile & Business Settings"
        subtitle="Manage legal transport entity details, GSTIN, bank accounts, and invoice prefixes"
      />

      {!canEdit && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800">
            <span className="font-bold block">View-Only Permissions</span>
            You are logged in as <span className="font-bold uppercase text-amber-900">{role}</span>. Only company Owners and Admins can modify legal GSTIN, bank details, and numbering configurations.
          </div>
        </div>
      )}

      {feedback && (
        <div
          className={`p-4 rounded-xl flex items-center gap-2.5 text-xs font-medium border ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* General Business Information */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Building2 className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-sm text-slate-900">Legal Company Information</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Company Registered Name</label>
              <input
                type="text"
                disabled={!canEdit}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Trade / Fleet Brand Name</label>
              <input
                type="text"
                disabled={!canEdit}
                value={tradeName}
                onChange={(e) => setTradeName(e.target.value)}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">GSTIN (15 Alphanumeric)</label>
              <input
                type="text"
                disabled={!canEdit}
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                className="w-full text-xs sm:text-sm font-mono border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Permanent Account Number (PAN)</label>
              <input
                type="text"
                disabled={!canEdit}
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase())}
                className="w-full text-xs sm:text-sm font-mono border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Primary Phone / WhatsApp</label>
              <input
                type="text"
                disabled={!canEdit}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Official Freight Email</label>
              <input
                type="email"
                disabled={!canEdit}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Office Registered Address</label>
              <input
                type="text"
                disabled={!canEdit}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">City</label>
              <input
                type="text"
                disabled={!canEdit}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">State & GST Code (WB = 19)</label>
              <input
                type="text"
                disabled={!canEdit}
                value={`${state} (Code: ${stateCode})`}
                onChange={(e) => setState(e.target.value)}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
          </div>
        </div>

        {/* Banking Remittance Details */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <CreditCard className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-sm text-slate-900">Bank Details for Invoices & Client Remittance</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Bank Name</label>
              <input
                type="text"
                disabled={!canEdit}
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="e.g. HDFC Bank Ltd."
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Current Account Number</label>
              <input
                type="text"
                disabled={!canEdit}
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="50200088991234"
                className="w-full text-xs sm:text-sm font-mono border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">IFSC Code</label>
              <input
                type="text"
                disabled={!canEdit}
                value={ifscCode}
                onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
                placeholder="HDFC0000214"
                className="w-full text-xs sm:text-sm font-mono uppercase border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Branch Name</label>
              <input
                type="text"
                disabled={!canEdit}
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="Kona Expressway, Howrah"
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50"
              />
            </div>
          </div>
        </div>

        {/* Numbering Configurations */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Hash className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-sm text-slate-900">Custom Document Numbering Prefixes</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Lorry Receipt (LR) Prefix</label>
              <input
                type="text"
                disabled={!canEdit}
                value={lrPrefix}
                onChange={(e) => setLrPrefix(e.target.value)}
                placeholder="AT/25-26/"
                className="w-full text-xs sm:text-sm font-mono border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">Output: AT/25-26/0001</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Trip Numbering Prefix</label>
              <input
                type="text"
                disabled={!canEdit}
                value={tripPrefix}
                onChange={(e) => setTripPrefix(e.target.value)}
                placeholder="TR-"
                className="w-full text-xs sm:text-sm font-mono border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">Output: TR-2026-0001</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Company Logo URL / Icon</label>
              <input
                type="text"
                disabled={!canEdit}
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://... or data:image/svg+xml..."
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">Renders on printed invoices and receipts</span>
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl shadow-xs transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Saving Changes...' : 'Save Company Profile'}</span>
            </button>
          </div>
        )}
      </form>

      {/* Danger Zone: Data Reset for New Customers */}
      {canEdit && (
        <div className="bg-white rounded-2xl border border-rose-200 shadow-xs overflow-hidden mt-8">
          <div className="p-4 sm:p-6 bg-rose-50/50 border-b border-rose-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center font-bold">
                <Trash2 className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-slate-900">Danger Zone: Reset Company Data</h3>
                <p className="text-xs text-slate-500">
                  Wipe all demo vehicles, trips, drivers, and invoices to start completely fresh for new real customers.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={resetting}
              onClick={() => setIsResetDialogOpen(true)}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs sm:text-sm rounded-xl transition-colors flex items-center gap-2 shadow-xs disabled:opacity-50"
            >
              <RotateCcw className="w-4 h-4" />
              <span>{resetting ? 'Resetting...' : 'Reset All Data'}</span>
            </button>
          </div>
          <div className="p-4 sm:p-6 bg-white text-xs text-slate-600 space-y-1">
            <p>
              • <strong>What gets cleared:</strong> All vehicles, active & past trips, driver advance slips, trip expenses, customer billing records, and tax invoices for this company.
            </p>
            <p>
              • <strong>What is preserved:</strong> Your company profile, GST registration, bank account details, user accounts, and numbering configuration.
            </p>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={isResetDialogOpen}
        title="Reset All Data for New Customers?"
        message="Are you sure you want to reset all operational data? This will permanently delete all demo vehicles, trips, driver advances, settlements, and invoices for your company so you can start with a clean slate. Your company profile and login will remain intact."
        confirmLabel="Yes, Reset Everything to 0"
        cancelLabel="Cancel"
        variant="danger"
        isLoading={resetting}
        onConfirm={handleResetData}
        onClose={() => setIsResetDialogOpen(false)}
      />
    </div>
  );
};
