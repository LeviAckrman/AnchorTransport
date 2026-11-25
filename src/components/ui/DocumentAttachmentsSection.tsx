import React, { useMemo, useRef, useState } from 'react';
import {
  UploadCloud,
  Eye,
  Download,
  RefreshCw,
  Trash2,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  AlertCircle,
  Loader2,
  FolderOpen,
} from 'lucide-react';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import {
  uploadUserFile,
  replaceUserFile,
  deleteUserFile,
  formatFileSize,
  STORAGE_ACCEPT_ATTR,
  STORAGE_CATEGORY_LABELS,
} from '../../lib/firebase/storageService';
import type { StorageFileCategory, UserFileMetadata } from '../../types/tms';
import { FilePreviewModal } from './FilePreviewModal';

interface NormalizedAttachmentItem {
  fileId: string;
  fileName: string;
  originalFileName: string;
  storagePath: string;
  downloadURL: string;
  contentType: string;
  fileSize?: number;
  category: StorageFileCategory;
  uploadedAt?: string;
  relatedRecordId?: string;
  companyId?: string;
}

interface DocumentAttachmentsSectionProps {
  companyId?: string;
  category: StorageFileCategory;
  relatedRecordId: string;
  entityType?: string;
  title?: string;
  subtitle?: string;
  compact?: boolean;
  allowCategorySwitch?: boolean;
  onUploaded?: (file: UserFileMetadata) => void;
}

export const DocumentAttachmentsSection: React.FC<DocumentAttachmentsSectionProps> = ({
  companyId,
  category,
  relatedRecordId,
  entityType,
  title = 'Attached Documents & Files',
  subtitle = 'Private Firebase Cloud Storage • Max 20 MB per file (PDF, Images, Word, Excel, CSV)',
  compact = false,
  allowCategorySwitch = false,
  onUploaded,
}) => {
  const { userFiles, fileRecords } = useFirestoreData();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<StorageFileCategory>(category);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [replacingFileId, setReplacingFileId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<NormalizedAttachmentItem | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<NormalizedAttachmentItem | null>(null);

  const items = useMemo<NormalizedAttachmentItem[]>(() => {
    const map = new Map<string, NormalizedAttachmentItem>();

    for (const f of userFiles || []) {
      const targetMatch =
        relatedRecordId === '*' ||
        f.relatedRecordId === relatedRecordId ||
        f.entityId === relatedRecordId;
      if (!targetMatch) continue;
      map.set(f.fileId, {
        fileId: f.fileId,
        fileName: f.fileName,
        originalFileName: f.originalFileName || f.fileName,
        storagePath: f.storagePath,
        downloadURL: f.downloadURL,
        contentType: f.contentType,
        fileSize: f.fileSize,
        category: f.category,
        uploadedAt: f.uploadedAt,
        relatedRecordId: f.relatedRecordId,
        companyId: f.companyId,
      });
    }

    for (const r of fileRecords || []) {
      const targetMatch =
        relatedRecordId === '*' ||
        r.relatedRecordId === relatedRecordId ||
        r.entityId === relatedRecordId;
      if (!targetMatch) continue;
      const fid = r.fileId || r.id;
      if (!map.has(fid)) {
        map.set(fid, {
          fileId: fid,
          fileName: r.fileName,
          originalFileName: r.originalFileName || r.fileName,
          storagePath: r.storagePath,
          downloadURL: r.downloadURL || r.downloadUrl,
          contentType: r.contentType || r.mimeType || 'application/octet-stream',
          fileSize: r.fileSize ?? r.sizeBytes,
          category: (r.category || r.folder) as StorageFileCategory,
          uploadedAt: r.uploadedAt || r.createdAt,
          relatedRecordId: r.relatedRecordId || r.entityId,
          companyId: r.companyId,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || ''))
    );
  }, [userFiles, fileRecords, relatedRecordId]);

  const handleUploadSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMsg(null);
    setUploading(true);
    setUploadProgress(0);
    try {
      const uploaded = await uploadUserFile({
        file,
        category: allowCategorySwitch ? selectedCategory : category,
        companyId,
        relatedRecordId: relatedRecordId === '*' ? undefined : relatedRecordId,
        entityType,
        entityId: relatedRecordId === '*' ? undefined : relatedRecordId,
        onProgress: setUploadProgress,
      });
      onUploaded?.(uploaded);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to upload file.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleReplaceSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const target = replaceTarget;
    setReplaceTarget(null);
    if (!file || !target) return;

    setErrorMsg(null);
    setReplacingFileId(target.fileId);
    setUploadProgress(0);
    try {
      const updated = await replaceUserFile({
        file,
        category: target.category || category,
        companyId: target.companyId || companyId,
        relatedRecordId: target.relatedRecordId || (relatedRecordId === '*' ? undefined : relatedRecordId),
        entityType,
        entityId: target.relatedRecordId || (relatedRecordId === '*' ? undefined : relatedRecordId),
        onProgress: setUploadProgress,
        previousFile: {
          fileId: target.fileId,
          storagePath: target.storagePath,
          downloadUrl: target.downloadURL,
          companyId: target.companyId || companyId,
          fileName: target.originalFileName,
        },
      });
      onUploaded?.(updated);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to replace file.');
    } finally {
      setReplacingFileId(null);
      setUploadProgress(0);
    }
  };

  const handleDelete = async (item: NormalizedAttachmentItem) => {
    setErrorMsg(null);
    setDeletingFileId(item.fileId);
    try {
      await deleteUserFile({
        fileId: item.fileId,
        storagePath: item.storagePath,
        downloadUrl: item.downloadURL,
        companyId: item.companyId || companyId,
        fileName: item.originalFileName,
      });
      setConfirmDeleteId(null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete file.');
    } finally {
      setDeletingFileId(null);
    }
  };

  const renderIcon = (item: NormalizedAttachmentItem) => {
    const mime = (item.contentType || '').toLowerCase();
    const name = (item.originalFileName || '').toLowerCase();
    if (mime.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/.test(name)) {
      return <ImageIcon className="w-4 h-4 text-amber-600" />;
    }
    if (mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv' || /\.(xls|xlsx|csv)$/.test(name)) {
      return <FileSpreadsheet className="w-4 h-4 text-emerald-600" />;
    }
    return <FileText className="w-4 h-4 text-blue-600" />;
  };

  return (
    <div className={`bg-white rounded-xl border border-slate-200 ${compact ? 'p-3.5' : 'p-4'} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-amber-600" />
            {title}
            <span className="text-xs font-semibold text-slate-500">({items.length})</span>
          </h4>
          {!compact && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-2">
          {allowCategorySwitch && (
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as StorageFileCategory)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 bg-white"
              aria-label="Upload category"
            >
              {Object.entries(STORAGE_CATEGORY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          )}
          <input
            ref={uploadInputRef}
            type="file"
            accept={STORAGE_ACCEPT_ATTR}
            onChange={handleUploadSelected}
            className="hidden"
          />
          <input
            ref={replaceInputRef}
            type="file"
            accept={STORAGE_ACCEPT_ATTR}
            onChange={handleReplaceSelected}
            className="hidden"
          />
          <button
            type="button"
            disabled={uploading || Boolean(replacingFileId)}
            onClick={() => uploadInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            {uploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Uploading {uploadProgress}%
              </>
            ) : (
              <>
                <UploadCloud className="w-3.5 h-3.5" />
                Upload File
              </>
            )}
          </button>
        </div>
      </div>

      {(uploading || replacingFileId) && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] font-semibold text-amber-700">
            <span>{replacingFileId ? 'Replacing file in Cloud Storage...' : 'Uploading to private Cloud Storage...'}</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all duration-150"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-4 px-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/70">
          <p className="text-xs text-slate-500">
            No files uploaded yet. Upload PDFs, photos, or spreadsheets up to 20 MB.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
          {items.map((item) => {
            const isConfirming = confirmDeleteId === item.fileId;
            const isDeleting = deletingFileId === item.fileId;
            const isReplacing = replacingFileId === item.fileId;

            return (
              <div
                key={item.fileId}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 bg-white hover:bg-slate-50/80 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    {renderIcon(item)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 truncate">
                      {item.originalFileName}
                    </p>
                    <p className="text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5">
                      <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 font-medium">
                        {STORAGE_CATEGORY_LABELS[item.category] || item.category}
                      </span>
                      <span>{formatFileSize(item.fileSize)}</span>
                      {item.uploadedAt && (
                        <span>
                          • {new Date(item.uploadedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setPreviewItem(item)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-100"
                    title="Preview file"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Preview
                  </button>
                  <a
                    href={item.downloadURL}
                    download={item.originalFileName}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-blue-700 hover:bg-blue-50"
                    title="Download file"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                  <button
                    type="button"
                    disabled={isReplacing || uploading}
                    onClick={() => {
                      setReplaceTarget(item);
                      replaceInputRef.current?.click();
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                    title="Replace file"
                  >
                    {isReplacing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  </button>
                  {isConfirming ? (
                    <div className="flex items-center gap-1 ml-1">
                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => handleDelete(item)}
                        className="px-2 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold"
                      >
                        {isDeleting ? 'Deleting...' : 'Confirm'}
                      </button>
                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => setConfirmDeleteId(item.fileId)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-red-600 hover:bg-red-50"
                      title="Delete file"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {previewItem && (
        <FilePreviewModal
          isOpen={Boolean(previewItem)}
          onClose={() => setPreviewItem(null)}
          fileName={previewItem.originalFileName}
          downloadUrl={previewItem.downloadURL}
          contentType={previewItem.contentType}
          fileSize={previewItem.fileSize}
          uploadedAt={previewItem.uploadedAt}
          categoryLabel={STORAGE_CATEGORY_LABELS[previewItem.category] || previewItem.category}
        />
      )}
    </div>
  );
};
