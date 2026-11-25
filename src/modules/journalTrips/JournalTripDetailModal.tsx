import React, { useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Download,
  Edit3,
  Eye,
  FileText,
  MapPin,
  Truck,
  User,
  Building2,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { FilePreviewModal } from '../../components/ui/FilePreviewModal';
import { formatRupees } from '../../lib/financialEngine';
import {
  extractAttachmentFileName,
  JOURNAL_ENTRY_TYPE_LABELS,
  JOURNAL_STATUS_LABELS,
} from '../../lib/journalTripsHelpers';
import { getJournalAttachmentDownloadUrl } from '../../lib/firebase/storageService';
import type { JournalTrip } from '../../types/tms';

interface JournalTripDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  trip: JournalTrip | null;
  onEdit: (trip: JournalTrip) => void;
}

export const JournalTripDetailModal: React.FC<JournalTripDetailModalProps> = ({
  isOpen,
  onClose,
  companyId,
  trip,
  onEdit,
}) => {
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [previewingPath, setPreviewingPath] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<{ fileName: string; url: string } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  if (!trip) return null;

  const isCancelled = trip.status === 'cancelled';

  const handlePreviewAttachment = async (storagePath: string) => {
    setDownloadError(null);
    setPreviewingPath(storagePath);
    try {
      const url = await getJournalAttachmentDownloadUrl(companyId, storagePath);
      setPreviewAttachment({
        fileName: extractAttachmentFileName(storagePath),
        url,
      });
    } catch (err: any) {
      setDownloadError(err?.message || 'Unable to preview attachment.');
    } finally {
      setPreviewingPath(null);
    }
  };

  const handleDownloadAttachment = async (storagePath: string) => {
    setDownloadError(null);
    setDownloadingPath(storagePath);
    try {
      const url = await getJournalAttachmentDownloadUrl(companyId, storagePath);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.download = extractAttachmentFileName(storagePath);
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch (err: any) {
      setDownloadError(err?.message || 'Unable to download attachment.');
    } finally {
      setDownloadingPath(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Journal Trip ${trip.journalTripId}`}
      subtitle={`${JOURNAL_ENTRY_TYPE_LABELS[trip.entryType] || trip.entryType} • Recorded ${new Date(
        trip.createdAt
      ).toLocaleDateString('en-IN')}`}
      maxWidth="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              onEdit(trip);
            }}
            className="flex items-center gap-1.5"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Edit Entry</span>
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {/* Status Banner & Badges */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isCancelled ? 'danger' : 'success'} dot>
              {JOURNAL_STATUS_LABELS[trip.status] || trip.status}
            </Badge>
            <Badge variant="indigo">
              {JOURNAL_ENTRY_TYPE_LABELS[trip.entryType] || trip.entryType}
            </Badge>
            {trip.externalReferenceNumber && (
              <Badge variant="default">Ref: {trip.externalReferenceNumber}</Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span>
              Trip Date:{' '}
              <strong className="text-slate-900">
                {trip.tripDate ? new Date(trip.tripDate).toLocaleDateString('en-IN') : '—'}
              </strong>
            </span>
          </div>
        </div>

        {isCancelled && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2.5 text-xs text-rose-800">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>
              This journal trip is marked <strong>Cancelled</strong>. Its freight, expenses, and profit
              are excluded from Trips Journal summary totals.
            </span>
          </div>
        )}

        {/* Route & Entity Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600">
              <MapPin className="w-3.5 h-3.5 text-indigo-600" />
              <span>Route & Mileage</span>
            </div>
            <div className="text-sm font-semibold text-slate-900">
              {trip.fromLocation} <span className="text-slate-400 mx-1">→</span> {trip.toLocation}
            </div>
            <div className="text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
              <span>
                Odometer Start:{' '}
                <strong className="font-mono text-slate-800">
                  {trip.odometerStart !== null ? `${trip.odometerStart} km` : '—'}
                </strong>
              </span>
              <span>
                Odometer End:{' '}
                <strong className="font-mono text-slate-800">
                  {trip.odometerEnd !== null ? `${trip.odometerEnd} km` : '—'}
                </strong>
              </span>
              <span>
                Distance:{' '}
                <strong className="font-mono text-indigo-700">
                  {trip.distanceTravelled !== null ? `${trip.distanceTravelled} km` : '—'}
                </strong>
              </span>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-600">
                <Truck className="w-3.5 h-3.5 text-slate-400" />
                Vehicle:
              </span>
              <span className="font-mono font-bold text-slate-900">
                {trip.vehicleNumber}{' '}
                <span className="font-sans font-normal text-[10px] text-slate-500">
                  ({trip.vehicleId ? 'Fleet Master' : 'Manual'})
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-600">
                <User className="w-3.5 h-3.5 text-slate-400" />
                Driver:
              </span>
              <span className="font-semibold text-slate-900">
                {trip.driverName}{' '}
                <span className="font-normal text-[10px] text-slate-500">
                  ({trip.driverId ? 'Driver Master' : 'Manual'})
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-600">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                Customer:
              </span>
              <span className="font-semibold text-slate-900">
                {trip.customerName}{' '}
                <span className="font-normal text-[10px] text-slate-500">
                  ({trip.customerId ? 'Customer Master' : 'Manual'})
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* Financial KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-xl border border-slate-200 bg-white">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block mb-1">
              Freight Amount
            </span>
            <span
              className={`text-xl font-bold tabular-nums ${
                isCancelled ? 'text-slate-400 line-through' : 'text-emerald-700'
              }`}
            >
              {formatRupees(trip.freightAmountPaise)}
            </span>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 bg-white">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block mb-1">
              Total Expenses
            </span>
            <span
              className={`text-xl font-bold tabular-nums ${
                isCancelled ? 'text-slate-400 line-through' : 'text-rose-700'
              }`}
            >
              {formatRupees(trip.totalExpensesPaise)}
            </span>
          </div>

          <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/40">
            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-900 block mb-1">
              Trip Profit
            </span>
            <span
              className={`text-xl font-bold tabular-nums ${
                isCancelled
                  ? 'text-slate-400 line-through'
                  : trip.profitPaise >= 0
                  ? 'text-indigo-900'
                  : 'text-rose-700'
              }`}
            >
              {formatRupees(trip.profitPaise)}
            </span>
          </div>
        </div>

        {/* Itemized Expense Breakdown */}
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Itemized Expense Breakdown
            </span>
            <span className="text-xs text-slate-500">{trip.expenses.length} line item(s)</span>
          </div>
          {trip.expenses.length > 0 ? (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="py-2 px-4 font-semibold">Expense Category</th>
                  <th className="py-2 px-4 font-semibold">Description</th>
                  <th className="py-2 px-4 font-semibold text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {trip.expenses.map((item, idx) => (
                  <tr key={`${item.expenseName}_${idx}`}>
                    <td className="py-2 px-4 font-medium text-slate-900">{item.expenseName}</td>
                    <td className="py-2 px-4 text-slate-600">{item.description || '—'}</td>
                    <td className="py-2 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {formatRupees(item.amountPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4 text-xs text-slate-500 italic">No itemized expenses recorded.</div>
          )}
        </div>

        {/* Notes */}
        {trip.notes && (
          <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
              Notes / Trip Description
            </span>
            <p className="text-xs sm:text-sm text-slate-800 whitespace-pre-line">{trip.notes}</p>
          </div>
        )}

        {/* Attachments */}
        <div className="space-y-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
            Attachments ({trip.attachmentPaths.length})
          </span>
          {downloadError && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {downloadError}
            </div>
          )}
          {trip.attachmentPaths.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {trip.attachmentPaths.map((path) => (
                <div
                  key={path}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 bg-white text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span className="truncate font-medium text-slate-800">
                      {extractAttachmentFileName(path)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={previewingPath === path}
                      onClick={() => handlePreviewAttachment(path)}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Preview</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={downloadingPath === path}
                      onClick={() => handleDownloadAttachment(path)}
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">No attachments uploaded for this trip.</p>
          )}
        </div>

        {/* Audit Metadata */}
        <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-500 flex flex-wrap justify-between gap-2">
          <span>
            Created: {trip.createdAt ? new Date(trip.createdAt).toLocaleString('en-IN') : '—'}
          </span>
          <span>
            Last Updated: {trip.updatedAt ? new Date(trip.updatedAt).toLocaleString('en-IN') : '—'}
          </span>
        </div>
      </div>

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
