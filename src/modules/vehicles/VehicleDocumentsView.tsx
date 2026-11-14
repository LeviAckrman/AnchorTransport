import React, { useState, useMemo } from 'react';
import {
  FileText,
  Plus,
  Search,
  AlertTriangle,
  Clock,
  CheckCircle2,
  AlertCircle,
  Truck,
  RotateCcw,
  Trash2,
  ExternalLink,
  ShieldAlert,
  X,
} from 'lucide-react';
import { VehicleDocument, DocumentType, UserRole } from '../../types/tms';
import { PageHeader } from '../../components/layout/PageHeader';
import { Badge, BadgeVariant } from '../../components/ui/Badge';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import { saveDocumentInFirestore, deleteDocumentInFirestore } from '../../lib/firebase/firestoreService';
import { calculateDocComplianceStatus } from '../../lib/tmsCalculations';

interface VehicleDocumentsViewProps {
  userRole: UserRole;
  onNavigateTab?: (tab: string) => void;
}

const DOCUMENT_TYPES: { type: DocumentType; label: string }[] = [
  { type: 'FITNESS', label: 'Certificate of Fitness (CF)' },
  { type: 'INSURANCE', label: 'Commercial Vehicle Insurance' },
  { type: 'NATIONAL_PERMIT', label: 'National Goods Permit' },
  { type: 'STATE_PERMIT', label: 'State Road Permit' },
  { type: 'PUC', label: 'Pollution Under Control (PUC)' },
  { type: 'ROAD_TAX', label: 'Road Tax Token' },
  { type: 'RC', label: 'Registration Certificate (RC)' },
];

export const VehicleDocumentsView: React.FC<VehicleDocumentsViewProps> = ({ userRole }) => {
  const { company, documents: rawDocuments, vehicles, loading, error } = useFirestoreData();

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState('ALL');
  const [docTypeFilter, setDocTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isRenewOpen, setIsRenewOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<VehicleDocument | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VehicleDocument | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form States (New Document)
  const [formVehicleId, setFormVehicleId] = useState('');
  const [formDocType, setFormDocType] = useState<DocumentType>('FITNESS');
  const [formDocNumber, setFormDocNumber] = useState('');
  const [formAuthority, setFormAuthority] = useState('');
  const [formIssueDate, setFormIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [formExpiryDate, setFormExpiryDate] = useState('');
  const [formDocUrl, setFormDocUrl] = useState('');

  // Form States (Renew Document)
  const [renewDocNumber, setRenewDocNumber] = useState('');
  const [renewAuthority, setRenewAuthority] = useState('');
  const [renewExpiryDate, setRenewExpiryDate] = useState('');
  const [renewDocUrl, setRenewDocUrl] = useState('');

  const canManage = userRole === 'OWNER' || userRole === 'ADMIN' || userRole === 'MANAGER' || userRole === 'OPERATIONS';

  const showToast = (type: 'success' | 'error', text: string) => {
    setToastMsg({ type, text });
    setTimeout(() => setToastMsg(null), 3500);
  };

  const enrichedDocs = useMemo(() => {
    return rawDocuments
      .map((d) => {
        const comp = calculateDocComplianceStatus(d.expiryDate);
        const veh = vehicles.find((v) => v.id === d.vehicleId);
        return {
          ...d,
          vehicleReg: veh?.registrationNumber || d.vehicleReg || '',
          daysUntilExpiry: comp.daysUntilExpiry,
          status: comp.status,
        };
      })
      .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  }, [rawDocuments, vehicles]);

  const summary = useMemo(() => {
    return {
      total: enrichedDocs.length,
      expired: enrichedDocs.filter((d) => d.status === 'EXPIRED').length,
      expiringSoon: enrichedDocs.filter((d) => d.status === 'EXPIRING_SOON').length,
      valid: enrichedDocs.filter((d) => d.status === 'VALID').length,
    };
  }, [enrichedDocs]);

  const documents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedDocs.filter((d) => {
      if (vehicleFilter !== 'ALL' && d.vehicleId !== vehicleFilter) return false;
      if (docTypeFilter !== 'ALL' && d.docType !== docTypeFilter) return false;
      if (statusFilter !== 'ALL' && d.status !== statusFilter) return false;
      if (q) {
        const hay = `${d.vehicleReg} ${d.documentNumber} ${d.docType} ${d.issuingAuthority || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enrichedDocs, vehicleFilter, docTypeFilter, statusFilter, searchQuery]);

  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company?.id) return;
    if (!formVehicleId || !formDocNumber.trim() || !formExpiryDate) {
      showToast('error', 'Please fill in required fields (Truck, Certificate No., Expiry Date).');
      return;
    }

    const matchingVehicle = vehicles.find((v) => v.id === formVehicleId);
    if (!matchingVehicle) {
      showToast('error', 'Selected vehicle could not be found.');
      return;
    }

    setSubmitting(true);
    try {
      const docObj: VehicleDocument = {
        id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        companyId: company.id,
        vehicleId: matchingVehicle.id,
        vehicleReg: matchingVehicle.registrationNumber,
        docType: formDocType,
        documentNumber: formDocNumber.trim().toUpperCase(),
        issuingAuthority: formAuthority.trim() || 'Regional Transport Office',
        issueDate: formIssueDate || new Date().toISOString().split('T')[0],
        expiryDate: formExpiryDate,
        documentUrl: formDocUrl.trim() || undefined,
        daysUntilExpiry: 0,
        status: 'VALID',
      };

      await saveDocumentInFirestore(company.id, docObj, matchingVehicle);

      showToast('success', 'Document saved to Firestore.');
      setIsCreateOpen(false);
      setFormVehicleId('');
      setFormDocNumber('');
      setFormExpiryDate('');
      setFormDocUrl('');
    } catch (err: any) {
      showToast('error', err.message || 'Failed to record document');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenRenew = (doc: VehicleDocument) => {
    setSelectedDoc(doc);
    setRenewDocNumber(doc.documentNumber);
    setRenewAuthority(doc.issuingAuthority);
    setRenewExpiryDate(doc.expiryDate);
    setRenewDocUrl(doc.documentUrl || '');
    setIsRenewOpen(true);
  };

  const handleRenewDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoc || !renewExpiryDate || !company?.id) return;

    const matchingVehicle = vehicles.find((v) => v.id === selectedDoc.vehicleId);

    setSubmitting(true);
    try {
      const updatedDoc: VehicleDocument = {
        ...selectedDoc,
        documentNumber: renewDocNumber.trim().toUpperCase(),
        issuingAuthority: renewAuthority.trim() || selectedDoc.issuingAuthority,
        expiryDate: renewExpiryDate,
        documentUrl: renewDocUrl.trim() || undefined,
      };
      await saveDocumentInFirestore(company.id, updatedDoc, matchingVehicle);
      showToast('success', 'Document renewed in Firestore.');
      setIsRenewOpen(false);
    } catch (err: any) {
      showToast('error', err.message || 'Failed to renew document');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || !company?.id) return;
    try {
      await deleteDocumentInFirestore(
        company.id,
        deleteTarget.id,
        `${deleteTarget.docType} (${deleteTarget.documentNumber})`
      );
      showToast('success', 'Document removed from Firestore.');
    } catch (err: any) {
      showToast('error', err.message || 'Failed to delete document');
    } finally {
      setDeleteTarget(null);
    }
  };

  const getStatusBadge = (status: VehicleDocument['status']): { variant: BadgeVariant; label: string } => {
    switch (status) {
      case 'VALID':
        return { variant: 'success', label: 'Valid & Active' };
      case 'EXPIRING_SOON':
        return { variant: 'warning', label: 'Expiring Soon' };
      case 'EXPIRED':
        return { variant: 'danger', label: 'EXPIRED' };
      default:
        return { variant: 'slate', label: status };
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Toast Alert */}
      {toastMsg && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between text-xs sm:text-sm font-medium border shadow-sm transition-all ${
            toastMsg.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-rose-50 text-rose-900 border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {toastMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600" />
            )}
            <span>{toastMsg.text}</span>
          </div>
          <button type="button" onClick={() => setToastMsg(null)} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="Vehicle Documents & Compliance Vault"
          subtitle="Track and renew Fitness Certificates, Insurance Policies, Road Permits, and Pollution (PUC) records"
        />

        {canManage && (
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm rounded-xl shadow-xs transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Record New Certificate</span>
          </button>
        )}
      </div>

      {/* Compliance Status KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase">Total Certificates</span>
            <FileText className="w-4 h-4 text-slate-400" />
          </div>
          <span className="text-xl sm:text-2xl font-bold text-slate-900 block">{summary.total}</span>
          <span className="text-[11px] text-slate-500">Across entire fleet</span>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-rose-200 bg-rose-50/20 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-rose-700 uppercase">Expired (Action Req.)</span>
            <ShieldAlert className="w-4 h-4 text-rose-600" />
          </div>
          <span className="text-xl sm:text-2xl font-bold text-rose-700 block">{summary.expired}</span>
          <span className="text-[11px] text-rose-600 font-medium">Off-road risk / Challan</span>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-amber-200 bg-amber-50/20 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-amber-700 uppercase">Expiring (30 Days)</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <span className="text-xl sm:text-2xl font-bold text-amber-700 block">{summary.expiringSoon}</span>
          <span className="text-[11px] text-amber-600 font-medium">Renewal in progress</span>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-emerald-200 bg-emerald-50/20 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-emerald-700 uppercase">Valid & Compliant</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <span className="text-xl sm:text-2xl font-bold text-emerald-700 block">{summary.valid}</span>
          <span className="text-[11px] text-emerald-600 font-medium">Good to dispatch</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search truck reg, cert no..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white"
            />
          </div>

          {/* Vehicle Filter */}
          <div>
            <select
              value={vehicleFilter}
              onChange={(e) => setVehicleFilter(e.target.value)}
              className="w-full py-2 px-3 text-xs sm:text-sm border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-slate-50 font-mono text-slate-700"
            >
              <option value="ALL">All Trucks in Fleet</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registrationNumber} ({v.makeModel})
                </option>
              ))}
            </select>
          </div>

          {/* Document Type Filter */}
          <div>
            <select
              value={docTypeFilter}
              onChange={(e) => setDocTypeFilter(e.target.value)}
              className="w-full py-2 px-3 text-xs sm:text-sm border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-slate-50 text-slate-700"
            >
              <option value="ALL">All Document Types</option>
              {DOCUMENT_TYPES.map((dt) => (
                <option key={dt.type} value={dt.type}>
                  {dt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full py-2 px-3 text-xs sm:text-sm border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-slate-50 text-slate-700"
            >
              <option value="ALL">All Expiry Statuses</option>
              <option value="EXPIRED">Expired Only</option>
              <option value="EXPIRING_SOON">Expiring Soon (30 Days)</option>
              <option value="VALID">Valid Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Documents Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 text-center space-y-3">
            <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-500 font-medium">Loading vehicle compliance records...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-rose-600 mx-auto" />
            <p className="text-sm font-semibold text-rose-800">{error}</p>
          </div>
        ) : documents.length === 0 ? (
          <div className="py-20 px-4 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <FileText className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-900">No Compliance Documents Found</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {searchQuery || vehicleFilter !== 'ALL' || docTypeFilter !== 'ALL' || statusFilter !== 'ALL'
                ? 'No documents matched your active search filters. Try clearing filters.'
                : 'No vehicle certificates recorded yet. Add your truck fitness, insurance, and permit records to stay compliant.'}
            </p>
            {canManage && (
              <button
                type="button"
                onClick={() => setIsCreateOpen(true)}
                className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl transition-colors shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Record Certificate</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold text-[11px] uppercase tracking-wider">
                  <th className="py-3 px-4">Truck Registration</th>
                  <th className="py-3 px-4">Document Type</th>
                  <th className="py-3 px-4">Certificate / Policy No.</th>
                  <th className="py-3 px-4">Issuing Authority</th>
                  <th className="py-3 px-4">Expiry Date</th>
                  <th className="py-3 px-4">Compliance Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {documents.map((doc) => {
                  const badge = getStatusBadge(doc.status);
                  return (
                    <tr key={doc.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <Truck className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="font-mono font-bold text-slate-900">{doc.vehicleReg}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-slate-800">
                        {doc.docType.replace('_', ' ')}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-700">
                        {doc.documentNumber}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        {doc.issuingAuthority || 'Regional Transport Office'}
                      </td>
                      <td className="py-3.5 px-4">
                        <div>
                          <span className="font-medium text-slate-900 block">{doc.expiryDate}</span>
                          <span
                            className={`text-[11px] font-semibold block ${
                              doc.daysUntilExpiry < 0
                                ? 'text-rose-700'
                                : doc.daysUntilExpiry <= 30
                                ? 'text-amber-700'
                                : 'text-slate-500'
                            }`}
                          >
                            {doc.daysUntilExpiry < 0
                              ? `Expired ${Math.abs(doc.daysUntilExpiry)} days ago`
                              : `Expires in ${doc.daysUntilExpiry} days`}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <Badge variant={badge.variant} dot>
                          {badge.label}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {doc.documentUrl && (
                            <a
                              href={doc.documentUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors"
                              title="View Document Certificate"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                          {canManage && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenRenew(doc)}
                                className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                title="Renew / Update Expiry"
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(doc)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                title="Delete Document"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record New Document Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden border border-slate-200">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-base">Record Vehicle Certificate</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateDocument} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Select Truck <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={formVehicleId}
                  onChange={(e) => setFormVehicleId(e.target.value)}
                  className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl font-mono"
                >
                  <option value="">
                    {vehicles.length === 0 ? 'No vehicles found in fleet' : '-- Choose Commercial Truck --'}
                  </option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.registrationNumber} ({v.makeModel})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Document Type <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formDocType}
                  onChange={(e) => setFormDocType(e.target.value as DocumentType)}
                  className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl"
                >
                  {DOCUMENT_TYPES.map((dt) => (
                    <option key={dt.type} value={dt.type}>
                      {dt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Certificate / Policy Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. WB/CF/2026/889912 or POL-HDFC-9911"
                  value={formDocNumber}
                  onChange={(e) => setFormDocNumber(e.target.value)}
                  className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl font-mono uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Issuing Authority</label>
                <input
                  type="text"
                  placeholder="e.g. Howrah RTO or The New India Assurance Co."
                  value={formAuthority}
                  onChange={(e) => setFormAuthority(e.target.value)}
                  className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Issue Date</label>
                  <input
                    type="date"
                    value={formIssueDate}
                    onChange={(e) => setFormIssueDate(e.target.value)}
                    className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Expiry Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={formExpiryDate}
                    onChange={(e) => setFormExpiryDate(e.target.value)}
                    className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Document URL / Parivahan Link</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={formDocUrl}
                  onChange={(e) => setFormDocUrl(e.target.value)}
                  className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 font-semibold text-xs sm:text-sm rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm rounded-xl disabled:opacity-50"
                >
                  {submitting ? 'Recording...' : 'Save Certificate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Renew Document Modal */}
      {isRenewOpen && selectedDoc && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden border border-slate-200">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-base">Renew {selectedDoc.docType.replace('_', ' ')}</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsRenewOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRenewDocument} className="p-6 space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                <Truck className="w-5 h-5 text-indigo-600" />
                <div>
                  <span className="font-mono font-bold text-slate-900 block">{selectedDoc.vehicleReg}</span>
                  <span className="text-[11px] text-slate-500">Current Expiry: {selectedDoc.expiryDate}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  New Certificate / Policy Number
                </label>
                <input
                  type="text"
                  required
                  value={renewDocNumber}
                  onChange={(e) => setRenewDocNumber(e.target.value)}
                  className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl font-mono uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Issuing Authority</label>
                <input
                  type="text"
                  value={renewAuthority}
                  onChange={(e) => setRenewAuthority(e.target.value)}
                  className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  New Expiry Date <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={renewExpiryDate}
                  onChange={(e) => setRenewExpiryDate(e.target.value)}
                  className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Certificate URL</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={renewDocUrl}
                  onChange={(e) => setRenewDocUrl(e.target.value)}
                  className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsRenewOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 font-semibold text-xs sm:text-sm rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm rounded-xl disabled:opacity-50"
                >
                  {submitting ? 'Updating...' : 'Update & Renew'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete Compliance Document?"
        message={`Are you sure you want to delete ${deleteTarget?.docType.replace('_', ' ')} (${deleteTarget?.documentNumber}) for truck ${deleteTarget?.vehicleReg}?`}
        confirmLabel="Yes, Delete Document"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
};
