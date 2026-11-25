import React from 'react';
import {
  X,
  Download,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  File as FileIcon,
} from 'lucide-react';
import { formatFileSize } from '../../lib/firebase/storageService';

interface FilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  downloadUrl: string;
  contentType?: string;
  fileSize?: number;
  uploadedAt?: string;
  categoryLabel?: string;
}

function detectFileKind(fileName: string, contentType?: string): 'image' | 'pdf' | 'spreadsheet' | 'document' {
  const mime = (contentType || '').toLowerCase();
  const cleanName = (fileName || '').toLowerCase().split('?')[0];
  if (mime.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/.test(cleanName)) {
    return 'image';
  }
  if (mime === 'application/pdf' || cleanName.endsWith('.pdf')) {
    return 'pdf';
  }
  if (
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    mime === 'text/csv' ||
    /\.(xls|xlsx|csv)$/.test(cleanName)
  ) {
    return 'spreadsheet';
  }
  return 'document';
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  isOpen,
  onClose,
  fileName,
  downloadUrl,
  contentType,
  fileSize,
  uploadedAt,
  categoryLabel,
}) => {
  if (!isOpen || !downloadUrl) return null;

  const kind = detectFileKind(fileName, contentType);
  const formattedDate = uploadedAt
    ? new Date(uploadedAt).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${fileName}`}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              {kind === 'image' ? (
                <ImageIcon className="w-5 h-5" />
              ) : kind === 'spreadsheet' ? (
                <FileSpreadsheet className="w-5 h-5" />
              ) : (
                <FileText className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 truncate">{fileName}</h3>
              <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-slate-500">
                {categoryLabel && (
                  <span className="px-2 py-0.5 rounded-md bg-slate-200/80 text-slate-700 font-semibold">
                    {categoryLabel}
                  </span>
                )}
                {fileSize && fileSize > 0 ? <span>{formatFileSize(fileSize)}</span> : null}
                {formattedDate ? <span>• Uploaded {formattedDate}</span> : null}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={downloadUrl}
              download={fileName}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors"
              aria-label="Close preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5 bg-slate-100 flex items-center justify-center">
          {kind === 'image' ? (
            <img
              src={downloadUrl}
              alt={fileName}
              className="max-w-full max-h-[72vh] object-contain rounded-xl shadow-sm bg-white"
            />
          ) : kind === 'pdf' ? (
            <iframe
              src={downloadUrl}
              title={fileName}
              className="w-full h-[72vh] rounded-xl border border-slate-200 bg-white"
            />
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 max-w-md w-full text-center shadow-sm">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center mx-auto mb-4">
                {kind === 'spreadsheet' ? (
                  <FileSpreadsheet className="w-7 h-7 text-emerald-600" />
                ) : (
                  <FileIcon className="w-7 h-7 text-blue-600" />
                )}
              </div>
              <p className="text-sm font-bold text-slate-900 break-all">{fileName}</p>
              <p className="text-xs text-slate-500 mt-1.5">
                Inline browser preview is available for images and PDFs. Download this file to open it locally.
              </p>
              <a
                href={downloadUrl}
                download={fileName}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 mt-5 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors"
              >
                <Download className="w-4 h-4" />
                Download File
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
