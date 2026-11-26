import React, { useState, useEffect } from 'react';
import {
  Building2,
  Save,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  CreditCard,
  Hash,
  RotateCcw,
  Trash2,
  Sliders,
  FolderOpen,
  Download,
  Eye,
  UploadCloud,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import { PageHeader } from '../layout/PageHeader';
import { clearClientTmsCaches } from '../../lib/storage';
import {
  clearCompanyOperationalDataInFirestore,
  saveCompanySettingsInFirestore,
} from '../../lib/firebase/firestoreService';
import {
  uploadUserFile,
  replaceUserFile,
  deleteUserFile,
  formatFileSize,
  STORAGE_ACCEPT_ATTR,
  STORAGE_CATEGORY_LABELS,
} from '../../lib/firebase/storageService';
import type { StorageFileCategory } from '../../types/tms';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { FilePreviewModal } from '../ui/FilePreviewModal';

export const CompanyProfilePage: React.FC = () => {
  const { role, permissions, updateCompanyProfile } = useAuth();
  const { company, companySettings, fileRecords, userFiles } = useFirestoreData();

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
  const [country, setCountry] = useState(company?.country || 'India');

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
  const [logoStoragePath, setLogoStoragePath] = useState(company?.logoStoragePath || '');
  const [logoPreviewError, setLogoPreviewError] = useState(false);

  // Operational & Billing Preferences (persisted in /companies/{companyId}/settings/default)
  const [defaultGstRatePercent, setDefaultGstRatePercent] = useState(
    String(companySettings?.defaultGstRatePercent ?? 5)
  );
  const [defaultRcmEnabled, setDefaultRcmEnabled] = useState(
    companySettings?.defaultRcmEnabled ?? true
  );
  const [defaultCreditPeriodDays, setDefaultCreditPeriodDays] = useState(
    String(companySettings?.defaultCreditPeriodDays ?? 30)
  );
  const [lowFastagThresholdRupees, setLowFastagThresholdRupees] = useState(
    String(Math.round((companySettings?.lowFastagThresholdPaise ?? 100000) / 100))
  );
  const [expiryAlertDays, setExpiryAlertDays] = useState(
    String(companySettings?.expiryAlertDays ?? 30)
  );
  const [autoGenerateLr, setAutoGenerateLr] = useState(
    companySettings?.autoGenerateLr ?? true
  );
  const [savingSettings, setSavingSettings] = useState(false);

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Firebase Cloud Storage states
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoProgress, setLogoProgress] = useState(0);
  const [fileCategoryFilter, setFileCategoryFilter] = useState<string>('ALL');
  const [uploadCategory, setUploadCategory] = useState<StorageFileCategory>('company');
  const [uploadingVaultFile, setUploadingVaultFile] = useState(false);
  const [vaultProgress, setVaultProgress] = useState(0);
  const [replacingFileId, setReplacingFileId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<{
    fileName: string;
    downloadUrl: string;
    contentType?: string;
    fileSize?: number;
    uploadedAt?: string;
    category?: string;
  } | null>(null);
  const replaceInputRef = React.useRef<HTMLInputElement | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<{
    fileId: string;
    storagePath: string;
    downloadURL: string;
    category: StorageFileCategory;
    fileName: string;
    companyId?: string;
    relatedRecordId?: string;
  } | null>(null);

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
    setCountry(company?.country || 'India');
    setBankName(company?.bankName || '');
    setAccountNumber(company?.accountNumber || '');
    setIfscCode(company?.ifscCode || '');
    setBranch(company?.branch || '');
    setLrPrefix(company?.lrPrefix || 'AT/25-26/');
    setInvoicePrefix(company?.invoicePrefix || 'INV/25-26/');
    setTripPrefix(company?.tripPrefix || 'TR-');
    setLogoUrl(company?.logoUrl || '');
    setLogoStoragePath(company?.logoStoragePath || '');
    setLogoPreviewError(false);
  }, [company]);

  useEffect(() => {
    if (!companySettings) return;
    setDefaultGstRatePercent(String(companySettings.defaultGstRatePercent ?? 5));
    setDefaultRcmEnabled(companySettings.defaultRcmEnabled ?? true);
    setDefaultCreditPeriodDays(String(companySettings.defaultCreditPeriodDays ?? 30));
    setLowFastagThresholdRupees(
      String(Math.round((companySettings.lowFastagThresholdPaise ?? 100000) / 100))
    );
    setExpiryAlertDays(String(companySettings.expiryAlertDays ?? 30));
    setAutoGenerateLr(companySettings.autoGenerateLr ?? true);
  }, [companySettings]);

  const canEdit = permissions?.canManageCompany ?? true;

  const handleSavePreferences = async () => {
    if (!canEdit || !company?.id) return;
    setSavingSettings(true);
    setFeedback(null);
    try {
      await saveCompanySettingsInFirestore(company.id, {
        id: 'default',
        defaultGstRatePercent: parseFloat(defaultGstRatePercent) || 5,
        defaultRcmEnabled,
        defaultCreditPeriodDays: parseInt(defaultCreditPeriodDays, 10) || 30,
        defaultFuelUnit: 'LITRES',
        lowFastagThresholdPaise: Math.max(0, Math.round((parseFloat(lowFastagThresholdRupees) || 0) * 100)),
        expiryAlertDays: parseInt(expiryAlertDays, 10) || 30,
        autoGenerateLr,
        currency: 'INR',
      });
      setFeedback({
        type: 'success',
        message: 'Operational & GST billing preferences saved to Firestore.',
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to save preferences.',
      });
    } finally {
      setSavingSettings(false);
    }
  };

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
      country: country.trim() || 'India',
      bankName,
      accountNumber,
      ifscCode,
      branch,
      lrPrefix,
      invoicePrefix,
      tripPrefix,
      logoUrl,
      logoStoragePath: logoUrl.trim() ? logoStoragePath : '',
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
            <span className="font-bold block">Owner Authorization Required</span>
            You are signed in as <span className="font-bold uppercase text-amber-900">{role || 'USER'}</span>. Only the authorized company Owner can modify legal GSTIN, bank details, and numbering configurations.
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
              <label className="block text-xs font-semibold text-slate-700 mb-1">GSTIN (15 Alphanumeric, if registered)</label>
              <input
                type="text"
                disabled={!canEdit}
                maxLength={15}
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                placeholder="e.g. 19AABCA1234D1Z5"
                className="w-full text-xs sm:text-sm font-mono border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Permanent Account Number (PAN)</label>
              <input
                type="text"
                disabled={!canEdit}
                maxLength={10}
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase())}
                placeholder="e.g. AABCA1234D"
                className="w-full text-xs sm:text-sm font-mono border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">State</label>
                <input
                  type="text"
                  disabled={!canEdit}
                  maxLength={60}
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="e.g. West Bengal"
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">GST State Code (WB = 19)</label>
                <input
                  type="text"
                  disabled={!canEdit}
                  maxLength={5}
                  value={stateCode}
                  onChange={(e) => setStateCode(e.target.value)}
                  placeholder="e.g. 19"
                  className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 font-mono disabled:bg-slate-50 disabled:text-slate-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">PIN Code</label>
              <input
                type="text"
                disabled={!canEdit}
                maxLength={10}
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
                placeholder="e.g. 711403"
                className="w-full text-xs sm:text-sm font-mono border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Country</label>
              <input
                type="text"
                disabled={!canEdit}
                maxLength={80}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="India"
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
              <label className="block text-xs font-semibold text-slate-700 mb-1">Invoice Numbering Prefix</label>
              <input
                type="text"
                disabled={!canEdit}
                value={invoicePrefix}
                onChange={(e) => setInvoicePrefix(e.target.value)}
                placeholder="INV/25-26/"
                className="w-full text-xs sm:text-sm font-mono border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">Output: INV/25-26/0001</span>
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
              <label className="block text-xs font-semibold text-slate-700 mb-1">Company Logo URL / Storage Upload</label>
              <div className="flex items-center gap-2">
                {logoUrl && !logoPreviewError && (
                  <img
                    src={logoUrl}
                    alt="Company logo"
                    referrerPolicy="no-referrer"
                    onError={() => setLogoPreviewError(true)}
                    className="w-10 h-10 rounded-lg object-contain border border-slate-200 bg-slate-50 shrink-0 p-0.5"
                  />
                )}
                <input
                  type="text"
                  disabled={!canEdit}
                  value={logoUrl}
                  onChange={(e) => {
                    setLogoUrl(e.target.value);
                    setLogoStoragePath('');
                    setLogoPreviewError(false);
                  }}
                  placeholder="https://... or upload logo image"
                  className="flex-1 min-w-0 text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50"
                />
                {canEdit && (
                  <label className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-lg border border-indigo-200 cursor-pointer shrink-0">
                    {uploadingLogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                    <span>{uploadingLogo ? `${logoProgress}%` : 'Upload'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      disabled={uploadingLogo}
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file || !company?.id) return;
                        setUploadingLogo(true);
                        setLogoProgress(0);
                        setFeedback(null);
                        try {
                          const existingLogoRecord = (userFiles || []).find(
                            (f) => f.storagePath === logoStoragePath || f.downloadURL === logoUrl
                          );
                          const res = existingLogoRecord
                            ? await replaceUserFile({
                                file,
                                category: 'company',
                                companyId: company.id,
                                relatedRecordId: company.id,
                                entityType: 'COMPANY_LOGO',
                                entityId: company.id,
                                onProgress: setLogoProgress,
                                previousFile: {
                                  fileId: existingLogoRecord.fileId,
                                  storagePath: existingLogoRecord.storagePath,
                                  downloadUrl: existingLogoRecord.downloadURL,
                                  companyId: company.id,
                                  fileName: existingLogoRecord.originalFileName || existingLogoRecord.fileName,
                                },
                              })
                            : await uploadUserFile({
                                file,
                                category: 'company',
                                companyId: company.id,
                                relatedRecordId: company.id,
                                entityType: 'COMPANY_LOGO',
                                entityId: company.id,
                                onProgress: setLogoProgress,
                              });
                          setLogoUrl(res.downloadURL);
                          setLogoStoragePath(res.storagePath);
                          setLogoPreviewError(false);
                          await updateCompanyProfile({
                            logoUrl: res.downloadURL,
                            logoStoragePath: res.storagePath,
                          });
                          setFeedback({ type: 'success', message: 'Company logo uploaded and saved to profile & invoices.' });
                        } catch (err: any) {
                          setFeedback({ type: 'error', message: err?.message || 'Failed to upload company logo.' });
                        } finally {
                          setUploadingLogo(false);
                          setLogoProgress(0);
                        }
                      }}
                    />
                  </label>
                )}
                {canEdit && logoUrl && (
                  <button
                    type="button"
                    disabled={uploadingLogo}
                    onClick={async () => {
                      if (!company?.id) return;
                      setFeedback(null);
                      const prevUrl = logoUrl;
                      const prevPath = logoStoragePath;
                      try {
                        const existingLogoRecord = (userFiles || []).find(
                          (f) =>
                            (prevPath && f.storagePath === prevPath) ||
                            (prevUrl && f.downloadURL === prevUrl)
                        );
                        if (existingLogoRecord || (prevPath && prevPath.startsWith('users/'))) {
                          await deleteUserFile({
                            fileId: existingLogoRecord?.fileId,
                            storagePath: existingLogoRecord?.storagePath || prevPath,
                            downloadUrl: existingLogoRecord?.downloadURL || prevUrl,
                            companyId: company.id,
                            fileName: existingLogoRecord?.originalFileName || 'company-logo',
                          });
                        }
                        setLogoUrl('');
                        setLogoStoragePath('');
                        setLogoPreviewError(false);
                        await updateCompanyProfile({ logoUrl: '', logoStoragePath: '' });
                        setFeedback({ type: 'success', message: 'Company logo removed from profile.' });
                      } catch (err: any) {
                        setFeedback({ type: 'error', message: err?.message || 'Failed to remove company logo.' });
                      }
                    }}
                    className="p-2.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg border border-slate-200 transition-colors shrink-0 cursor-pointer"
                    title="Remove company logo"
                    aria-label="Remove company logo"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <span className="text-[11px] text-slate-500 mt-1 block">Renders automatically on every new Tax Invoice and PDF export</span>
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

      {/* Operational & Billing Preferences (persisted to /companies/{companyId}/settings/default) */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-indigo-600" />
            <div>
              <h3 className="font-bold text-sm text-slate-900">Operational & Billing Preferences</h3>
              <p className="text-[11px] text-slate-500">
                Auto-fills default GST rates, RCM flags, and payment credit terms across Invoices & Dispatch
              </p>
            </div>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={handleSavePreferences}
              disabled={savingSettings}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-50"
            >
              {savingSettings ? 'Saving...' : 'Save Preferences'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Default GST Rate (%)</label>
            <select
              disabled={!canEdit}
              value={defaultGstRatePercent}
              onChange={(e) => setDefaultGstRatePercent(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50"
            >
              <option value="5">5% (GTA Standard RCM)</option>
              <option value="12">12% (Forward Charge GTA)</option>
              <option value="18">18% (Allied Logistics)</option>
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Default Credit Period (Days)</label>
            <input
              type="number"
              min="0"
              disabled={!canEdit}
              value={defaultCreditPeriodDays}
              onChange={(e) => setDefaultCreditPeriodDays(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Compliance Expiry Alert (Days)</label>
            <input
              type="number"
              min="1"
              disabled={!canEdit}
              value={expiryAlertDays}
              onChange={(e) => setExpiryAlertDays(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Low FASTag Alert Threshold (₹)</label>
            <input
              type="number"
              min="0"
              disabled={!canEdit}
              value={lowFastagThresholdRupees}
              onChange={(e) => setLowFastagThresholdRupees(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 disabled:bg-slate-50"
            />
          </div>
          <label className="flex items-center gap-2 pt-5 cursor-pointer">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={defaultRcmEnabled}
              onChange={(e) => setDefaultRcmEnabled(e.target.checked)}
              className="rounded text-indigo-600 focus:ring-indigo-500"
            />
            <span className="font-semibold text-slate-700">Enable GTA RCM by default</span>
          </label>
          <label className="flex items-center gap-2 pt-5 cursor-pointer">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={autoGenerateLr}
              onChange={(e) => setAutoGenerateLr(e.target.checked)}
              className="rounded text-indigo-600 focus:ring-indigo-500"
            />
            <span className="font-semibold text-slate-700">Auto-generate sequential LR numbers</span>
          </label>
        </div>
      </div>

      {/* Private Firebase Cloud Storage Document Vault (/users/{uid}/files) */}
      {(() => {
        const mergedMap = new Map<
          string,
          {
            fileId: string;
            fileName: string;
            originalFileName: string;
            storagePath: string;
            downloadURL: string;
            contentType?: string;
            fileSize?: number;
            category: StorageFileCategory;
            uploadedAt?: string;
            companyId?: string;
            relatedRecordId?: string;
          }
        >();

        for (const u of userFiles || []) {
          mergedMap.set(u.fileId, {
            fileId: u.fileId,
            fileName: u.fileName,
            originalFileName: u.originalFileName || u.fileName,
            storagePath: u.storagePath,
            downloadURL: u.downloadURL,
            contentType: u.contentType,
            fileSize: u.fileSize,
            category: u.category,
            uploadedAt: u.uploadedAt,
            companyId: u.companyId,
            relatedRecordId: u.relatedRecordId,
          });
        }

        for (const r of fileRecords || []) {
          const fid = r.fileId || r.id;
          if (!mergedMap.has(fid)) {
            mergedMap.set(fid, {
              fileId: fid,
              fileName: r.fileName,
              originalFileName: r.originalFileName || r.fileName,
              storagePath: r.storagePath,
              downloadURL: r.downloadURL || r.downloadUrl,
              contentType: r.contentType || r.mimeType,
              fileSize: r.fileSize ?? r.sizeBytes,
              category: (r.category || r.folder) as StorageFileCategory,
              uploadedAt: r.uploadedAt || r.createdAt,
              companyId: r.companyId,
              relatedRecordId: r.relatedRecordId || r.entityId,
            });
          }
        }

        const allVaultFiles = Array.from(mergedMap.values()).sort((a, b) =>
          String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || ''))
        );
        const visibleFiles =
          fileCategoryFilter === 'ALL'
            ? allVaultFiles
            : allVaultFiles.filter((f) => f.category === fileCategoryFilter);

        return (
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-indigo-600" />
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    Private Document Vault ({visibleFiles.length})
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    UID-isolated Firebase Cloud Storage uploads • Max 20 MB per file
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={fileCategoryFilter}
                  onChange={(e) => setFileCategoryFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 text-slate-700 font-medium"
                  aria-label="Filter files by category"
                >
                  <option value="ALL">All Categories</option>
                  {Object.entries(STORAGE_CATEGORY_LABELS).map(([k, lbl]) => (
                    <option key={k} value={k}>
                      {lbl}
                    </option>
                  ))}
                </select>

                {canEdit && (
                  <>
                    <select
                      value={uploadCategory}
                      onChange={(e) => setUploadCategory(e.target.value as StorageFileCategory)}
                      className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 font-medium"
                      aria-label="Upload file category"
                    >
                      {Object.entries(STORAGE_CATEGORY_LABELS).map(([k, lbl]) => (
                        <option key={k} value={k}>
                          Upload to: {lbl}
                        </option>
                      ))}
                    </select>
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer transition-colors">
                      {uploadingVaultFile ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>{vaultProgress}%</span>
                        </>
                      ) : (
                        <>
                          <UploadCloud className="w-3.5 h-3.5" />
                          <span>Upload Document</span>
                        </>
                      )}
                      <input
                        type="file"
                        accept={STORAGE_ACCEPT_ATTR}
                        disabled={uploadingVaultFile}
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file) return;
                          setUploadingVaultFile(true);
                          setVaultProgress(0);
                          setFeedback(null);
                          try {
                            await uploadUserFile({
                              file,
                              category: uploadCategory,
                              companyId: company?.id,
                              relatedRecordId: company?.id,
                              entityType: 'COMPANY_VAULT',
                              entityId: company?.id,
                              onProgress: setVaultProgress,
                            });
                            setFeedback({ type: 'success', message: `${file.name} uploaded securely.` });
                          } catch (err: any) {
                            setFeedback({ type: 'error', message: err?.message || 'Upload failed.' });
                          } finally {
                            setUploadingVaultFile(false);
                            setVaultProgress(0);
                          }
                        }}
                      />
                    </label>
                  </>
                )}
              </div>
            </div>

            {(uploadingVaultFile || replacingFileId) && (
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold text-indigo-700">
                  <span>{replacingFileId ? 'Replacing file...' : 'Uploading to Firebase Storage...'}</span>
                  <span>{vaultProgress}%</span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all duration-150"
                    style={{ width: `${vaultProgress}%` }}
                  />
                </div>
              </div>
            )}

            <input
              ref={replaceInputRef}
              type="file"
              accept={STORAGE_ACCEPT_ATTR}
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                const target = replaceTarget;
                setReplaceTarget(null);
                if (!file || !target) return;
                setReplacingFileId(target.fileId);
                setVaultProgress(0);
                setFeedback(null);
                try {
                  await replaceUserFile({
                    file,
                    category: target.category,
                    companyId: target.companyId || company?.id,
                    relatedRecordId: target.relatedRecordId,
                    onProgress: setVaultProgress,
                    previousFile: {
                      fileId: target.fileId,
                      storagePath: target.storagePath,
                      downloadUrl: target.downloadURL,
                      companyId: target.companyId || company?.id,
                      fileName: target.fileName,
                    },
                  });
                  setFeedback({ type: 'success', message: `${target.fileName} replaced successfully.` });
                } catch (err: any) {
                  setFeedback({ type: 'error', message: err?.message || 'Failed to replace file.' });
                } finally {
                  setReplacingFileId(null);
                  setVaultProgress(0);
                }
              }}
            />

            {visibleFiles.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                No uploaded files found in this category. Upload company registrations, GST certificates, LR copies, POD scans, invoices, or receipts using the button above.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 text-xs">
                {visibleFiles.map((f) => (
                  <div key={f.fileId} className="py-2.5 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold text-slate-900 block truncate">{f.originalFileName}</span>
                      <span className="text-[11px] text-slate-500">
                        Category:{' '}
                        <span className="font-medium text-slate-700">
                          {STORAGE_CATEGORY_LABELS[f.category] || f.category}
                        </span>
                        {f.fileSize ? ` • ${formatFileSize(f.fileSize)}` : ''}
                        {f.uploadedAt
                          ? ` • ${new Date(f.uploadedAt).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}`
                          : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewFile({
                            fileName: f.originalFileName,
                            downloadUrl: f.downloadURL,
                            contentType: f.contentType,
                            fileSize: f.fileSize,
                            uploadedAt: f.uploadedAt,
                            category: STORAGE_CATEGORY_LABELS[f.category] || f.category,
                          })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg font-semibold hover:bg-indigo-100"
                      >
                        <Eye className="w-3 h-3" />
                        Preview
                      </button>
                      <a
                        href={f.downloadURL}
                        download={f.originalFileName}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg font-semibold hover:bg-slate-200"
                      >
                        <Download className="w-3 h-3" />
                        Download
                      </a>
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            disabled={replacingFileId === f.fileId}
                            onClick={() => {
                              setReplaceTarget({
                                fileId: f.fileId,
                                storagePath: f.storagePath,
                                downloadURL: f.downloadURL,
                                category: f.category,
                                fileName: f.originalFileName,
                                companyId: f.companyId,
                                relatedRecordId: f.relatedRecordId,
                              });
                              replaceInputRef.current?.click();
                            }}
                            className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg disabled:opacity-50"
                            title="Replace file"
                          >
                            {replacingFileId === f.fileId ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            disabled={deletingFileId === f.fileId}
                            onClick={async () => {
                              setDeletingFileId(f.fileId);
                              setFeedback(null);
                              try {
                                await deleteUserFile({
                                  fileId: f.fileId,
                                  storagePath: f.storagePath,
                                  downloadUrl: f.downloadURL,
                                  companyId: f.companyId || company?.id,
                                  fileName: f.originalFileName,
                                });
                                setFeedback({ type: 'success', message: `${f.originalFileName} deleted from Storage and Firestore.` });
                              } catch (err: any) {
                                setFeedback({ type: 'error', message: err?.message || 'Failed to delete file.' });
                              } finally {
                                setDeletingFileId(null);
                              }
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 disabled:opacity-50"
                            title="Delete file from Storage and Firestore"
                          >
                            {deletingFileId === f.fileId ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {previewFile && (
        <FilePreviewModal
          isOpen={Boolean(previewFile)}
          onClose={() => setPreviewFile(null)}
          fileName={previewFile.fileName}
          downloadUrl={previewFile.downloadUrl}
          contentType={previewFile.contentType}
          fileSize={previewFile.fileSize}
          uploadedAt={previewFile.uploadedAt}
          categoryLabel={previewFile.category}
        />
      )}

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
