import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { formatRupees } from '../../lib/financialEngine';
import {
  downloadJournalExcelTemplate,
  parseJournalExcelBuffer,
  type ParsedJournalImportResult,
} from '../../lib/journalTripsHelpers';
import { batchImportJournalTripsInFirestore } from '../../lib/firebase/journalTripsService';
import type { Customer, Driver, Vehicle } from '../../types/tms';

interface JournalExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  vehicles: Vehicle[];
  drivers: Driver[];
  customers: Customer[];
  onImported: (importedCount: number) => void;
}

export const JournalExcelImportModal: React.FC<JournalExcelImportModalProps> = ({
  isOpen,
  onClose,
  companyId,
  vehicles,
  drivers,
  customers,
  onImported,
}) => {
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [parsedResult, setParsedResult] = useState<ParsedJournalImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const resetState = () => {
    setSelectedFileName('');
    setParsedResult(null);
    setParseError(null);
  };

  const handleFileChange = async (file: File | null) => {
    if (!file) return;
    setParseError(null);
    setSelectedFileName(file.name);

    try {
      const lower = file.name.toLowerCase();
      if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls') && !lower.endsWith('.csv')) {
        throw new Error('Please upload an Excel (.xlsx, .xls) or CSV (.csv) file.');
      }
      const buffer = await file.arrayBuffer();
      const result = parseJournalExcelBuffer(buffer, { vehicles, drivers, customers });
      if (result.rows.length === 0) {
        throw new Error('No trip rows were found in the uploaded sheet.');
      }
      setParsedResult(result);
    } catch (err: any) {
      setParsedResult(null);
      setParseError(err?.message || 'Could not parse spreadsheet file.');
    }
  };

  const handleConfirmImport = async () => {
    if (!parsedResult || parsedResult.validRows.length === 0) return;
    setParseError(null);
    setImporting(true);
    try {
      const { importedCount } = await batchImportJournalTripsInFirestore(
        companyId,
        parsedResult.validRows
      );
      resetState();
      onImported(importedCount);
      onClose();
    } catch (err: any) {
      setParseError(err?.message || 'Failed to import journal trips.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!importing) {
          resetState();
          onClose();
        }
      }}
      title="Import Historical / Offline Trips from Excel"
      subtitle="Upload Excel (.xlsx, .xls) or CSV ledgers directly into Trips Journal — isolated from live dispatch"
      maxWidth="2xl"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            disabled={importing}
            onClick={() => {
              resetState();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={importing}
            disabled={!parsedResult || parsedResult.validRows.length === 0}
            onClick={handleConfirmImport}
          >
            Import {parsedResult?.validRows.length || 0} Valid Trip(s)
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Step 1: Template Download & Upload */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-700 shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs sm:text-sm font-bold text-slate-900">
                Use Standard Trips Journal Spreadsheet Format
              </h4>
              <p className="text-xs text-slate-600 mt-0.5">
                Includes Trip Date, Vehicle Number, Driver Name, Customer Name, Route, Freight, and itemized expenses.
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={downloadJournalExcelTemplate}
            className="shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Sample Template</span>
          </Button>
        </div>

        {/* File Picker */}
        <label className="block p-6 rounded-xl border-2 border-dashed border-slate-300 hover:border-indigo-400 bg-white text-center cursor-pointer transition-colors">
          <Upload className="w-7 h-7 text-indigo-600 mx-auto mb-2" />
          <p className="text-xs sm:text-sm font-semibold text-slate-800">
            {selectedFileName
              ? `Selected: ${selectedFileName}`
              : 'Click to upload .xlsx, .xls, or .csv trip register'}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            Vehicles, drivers, and customers matching your registered master names are linked automatically; others are preserved cleanly as historical text.
          </p>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={importing}
            onChange={(e) => {
              handleFileChange(e.target.files?.[0] || null);
              e.target.value = '';
            }}
            className="hidden"
          />
        </label>

        {parseError && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-xs text-rose-800 font-medium">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{parseError}</span>
          </div>
        )}

        {/* Preview Summary & Rows */}
        {parsedResult && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="p-3 rounded-lg border border-slate-200 bg-white">
                <span className="text-[10px] font-semibold uppercase text-slate-500 block">
                  Total Rows
                </span>
                <span className="text-lg font-bold text-slate-900 tabular-nums">
                  {parsedResult.rows.length}
                </span>
              </div>
              <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/50">
                <span className="text-[10px] font-semibold uppercase text-emerald-800 block">
                  Ready to Import
                </span>
                <span className="text-lg font-bold text-emerald-700 tabular-nums">
                  {parsedResult.validRows.length}
                </span>
              </div>
              <div
                className={`p-3 rounded-lg border ${
                  parsedResult.invalidRows.length > 0
                    ? 'border-rose-200 bg-rose-50/60'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <span className="text-[10px] font-semibold uppercase text-slate-500 block">
                  Invalid Rows
                </span>
                <span
                  className={`text-lg font-bold tabular-nums ${
                    parsedResult.invalidRows.length > 0 ? 'text-rose-700' : 'text-slate-700'
                  }`}
                >
                  {parsedResult.invalidRows.length}
                </span>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 bg-white">
                <span className="text-[10px] font-semibold uppercase text-slate-500 block">
                  Completed Freight
                </span>
                <span className="text-sm font-bold text-emerald-700 tabular-nums">
                  {formatRupees(parsedResult.totalFreightPaise)}
                </span>
              </div>
              <div className="p-3 rounded-lg border border-indigo-200 bg-indigo-50/40">
                <span className="text-[10px] font-semibold uppercase text-indigo-900 block">
                  Expected Profit
                </span>
                <span className="text-sm font-bold text-indigo-900 tabular-nums">
                  {formatRupees(parsedResult.totalProfitPaise)}
                </span>
              </div>
            </div>

            {parsedResult.invalidRows.length > 0 && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                <strong>{parsedResult.invalidRows.length} row(s)</strong> have validation errors and will be
                skipped. Only valid rows are imported.
              </div>
            )}

            <div className="border border-slate-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                  <tr className="text-[11px] font-semibold uppercase text-slate-600">
                    <th className="py-2.5 px-3">Row</th>
                    <th className="py-2.5 px-3">Validation</th>
                    <th className="py-2.5 px-3">Trip Date</th>
                    <th className="py-2.5 px-3">Vehicle</th>
                    <th className="py-2.5 px-3">Driver</th>
                    <th className="py-2.5 px-3">Customer</th>
                    <th className="py-2.5 px-3">Route</th>
                    <th className="py-2.5 px-3 text-right">Freight</th>
                    <th className="py-2.5 px-3 text-right">Expenses</th>
                    <th className="py-2.5 px-3 text-right">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parsedResult.rows.slice(0, 100).map((row) => (
                    <tr key={row.rowNumber} className={row.isValid ? 'bg-white' : 'bg-rose-50/60'}>
                      <td className="py-2 px-3 font-mono text-slate-500">#{row.rowNumber}</td>
                      <td className="py-2 px-3">
                        {row.isValid ? (
                          <Badge variant="success" size="sm">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Valid</span>
                          </Badge>
                        ) : (
                          <span className="text-[11px] font-semibold text-rose-700">
                            {row.errors.join('; ')}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-slate-700">
                        {row.tripDateStr || '—'}
                      </td>
                      <td className="py-2 px-3 font-mono font-semibold text-slate-900">
                        {row.vehicleNumber || '—'}
                      </td>
                      <td className="py-2 px-3 text-slate-700">{row.driverName || '—'}</td>
                      <td className="py-2 px-3 text-slate-700">{row.customerName || '—'}</td>
                      <td className="py-2 px-3 text-slate-600">
                        {row.fromLocation || '—'} → {row.toLocation || '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900">
                        {formatRupees(row.freightAmountPaise)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-rose-700">
                        {formatRupees(row.totalExpensesPaise)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold tabular-nums text-indigo-800">
                        {formatRupees(row.profitPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
