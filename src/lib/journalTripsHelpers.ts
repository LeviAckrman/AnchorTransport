/**
 * AnchorTransport TMS - Trips Journal Helpers
 * Pure financial calculations, search tokenization, summary aggregation,
 * and Excel/CSV bulk import parser & template generator.
 *
 * Strictly isolated from live operational Trips, Driver Advances, and Settlements.
 */

import * as XLSX from 'xlsx';
import type {
  Customer,
  Driver,
  JournalEntryType,
  JournalTrip,
  JournalTripExpenseItem,
  JournalTripStatus,
  JournalTripSummaryStats,
  Vehicle,
} from '../types/tms';
import { rupeesToPaise, paiseToRupees } from './financialEngine';

export const STANDARD_JOURNAL_EXPENSE_NAMES = [
  'Loading Charges',
  'Unloading Charges',
  'Fuel Expenses',
  'Toll Expenses',
  'Driver Expenses',
  'Food Expenses',
  'Repair Expenses',
  'Other Expenses',
] as const;

export const JOURNAL_ENTRY_TYPE_LABELS: Record<JournalEntryType, string> = {
  offline: 'Offline Trip',
  historical: 'Historical Trip',
  manual_book: 'Manual Book Entry',
};

export const JOURNAL_STATUS_LABELS: Record<JournalTripStatus, string> = {
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const ALLOWED_JOURNAL_ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
] as const;

export const ALLOWED_JOURNAL_ATTACHMENT_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'] as const;

export function generateJournalTripId(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const ms = String(now.getTime()).slice(-4);
  return `JTR-${yy}${mm}${dd}-${ms}${rand}`;
}

/**
 * Normalizes a rupee input into safe integer paise (>= 0 for revenue/expenses).
 */
export function parseRupeesInputToPaise(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, rupeesToPaise(numeric));
}

/**
 * Computes total expenses and trip profit strictly in integer paise.
 */
export function calculateJournalFinancials(
  freightAmountPaise: number,
  expenses: JournalTripExpenseItem[]
): {
  freightAmountPaise: number;
  expenses: JournalTripExpenseItem[];
  totalExpensesPaise: number;
  profitPaise: number;
} {
  const safeFreight = Math.max(0, Math.round(Number.isFinite(freightAmountPaise) ? freightAmountPaise : 0));
  const sanitizedExpenses: JournalTripExpenseItem[] = (expenses || [])
    .map((item) => ({
      expenseName: String(item.expenseName || '').trim().slice(0, 120),
      amountPaise: Math.max(0, Math.round(Number.isFinite(item.amountPaise) ? item.amountPaise : 0)),
      description: String(item.description || '').trim().slice(0, 300),
    }))
    .filter((item) => item.expenseName.length > 0 && (item.amountPaise > 0 || item.description.length > 0));

  const totalExpensesPaise = sanitizedExpenses.reduce((sum, item) => sum + item.amountPaise, 0);
  const profitPaise = safeFreight - totalExpensesPaise;

  return {
    freightAmountPaise: safeFreight,
    expenses: sanitizedExpenses,
    totalExpensesPaise,
    profitPaise,
  };
}

/**
 * Auto-calculates distance travelled from odometer readings when both are valid.
 */
export function calculateJournalDistance(
  odometerStart: number | null | undefined,
  odometerEnd: number | null | undefined
): number | null {
  if (
    typeof odometerStart !== 'number' ||
    typeof odometerEnd !== 'number' ||
    !Number.isFinite(odometerStart) ||
    !Number.isFinite(odometerEnd) ||
    odometerStart < 0 ||
    odometerEnd < odometerStart
  ) {
    return null;
  }
  return Math.round((odometerEnd - odometerStart) * 100) / 100;
}

/**
 * Builds bounded lowercase search tokens for server-side Firestore `array-contains` queries.
 * Covers Trip ID, Vehicle Number, Driver Name, Customer Name, and External Ref.
 */
export function buildJournalSearchTokens(fields: {
  journalTripId?: string | null;
  vehicleNumber?: string | null;
  driverName?: string | null;
  customerName?: string | null;
  externalReferenceNumber?: string | null;
}): string[] {
  const tokens = new Set<string>();
  const rawValues = [
    fields.journalTripId,
    fields.vehicleNumber,
    fields.driverName,
    fields.customerName,
    fields.externalReferenceNumber,
  ];

  const prefixCandidates: string[] = [];

  for (const val of rawValues) {
    if (!val) continue;
    const cleaned = val.trim().toLowerCase();
    if (!cleaned) continue;
    tokens.add(cleaned.slice(0, 64));

    const parts = cleaned.split(/[\s,/\\-]+/).filter((p) => p.length >= 2);
    for (const part of parts) {
      tokens.add(part.slice(0, 40));
      prefixCandidates.push(part);
    }

    // Also add alphanumeric stripped variant for vehicle reg like WB19K4821
    const compact = cleaned.replace(/[^a-z0-9]/g, '');
    if (compact.length >= 2) {
      tokens.add(compact.slice(0, 40));
      prefixCandidates.push(compact);
    }
  }

  for (const cand of prefixCandidates) {
    if (tokens.size >= 40) break;
    const maxPref = Math.min(cand.length, 8);
    for (let len = 2; len <= maxPref; len++) {
      if (tokens.size >= 40) break;
      tokens.add(cand.slice(0, len));
    }
  }

  return Array.from(tokens).slice(0, 40);
}

/**
 * Computes summary statistics across journal trips.
 * Cancelled trips NEVER contribute to completed-trip revenue, expenses, or profit totals.
 */
export function summarizeJournalTrips(trips: JournalTrip[]): JournalTripSummaryStats {
  let completedTripsCount = 0;
  let cancelledTripsCount = 0;
  let totalFreightRevenuePaise = 0;
  let totalExpensesPaise = 0;
  let totalProfitPaise = 0;

  for (const trip of trips) {
    if (trip.status === 'cancelled') {
      cancelledTripsCount++;
      continue;
    }
    completedTripsCount++;
    totalFreightRevenuePaise += trip.freightAmountPaise || 0;
    totalExpensesPaise += trip.totalExpensesPaise || 0;
    totalProfitPaise += (trip.freightAmountPaise || 0) - (trip.totalExpensesPaise || 0);
  }

  return {
    totalTripsCount: trips.length,
    completedTripsCount,
    cancelledTripsCount,
    totalFreightRevenuePaise,
    totalExpensesPaise,
    totalProfitPaise,
  };
}

/**
 * Filters journal trips by an inclusive [startDate, endDate] range,
 * sorting chronologically descending by tripDate.
 */
export function filterJournalTripsByDateRange(
  trips: JournalTrip[],
  startDate?: Date | null,
  endDate?: Date | null
): JournalTrip[] {
  const parseJournalDate = (raw?: string): Date | null => {
    const clean = (raw || '').trim();
    if (!clean) return null;
    const dateOnlyMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const dt = dateOnlyMatch
      ? new Date(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3]), 12, 0, 0, 0)
      : new Date(clean);
    return Number.isNaN(dt.getTime()) ? null : dt;
  };

  return [...(trips || [])]
    .filter((t) => {
      if (!startDate && !endDate) return true;
      const dt = parseJournalDate(t.tripDate || t.createdAt);
      if (!dt) return false;
      if (startDate && dt < startDate) return false;
      if (endDate && dt > endDate) return false;
      return true;
    })
    .sort((a, b) => {
      const da = parseJournalDate(a.tripDate || a.createdAt)?.getTime() ?? 0;
      const db = parseJournalDate(b.tripDate || b.createdAt)?.getTime() ?? 0;
      return db - da;
    });
}

export function isValidJournalAttachmentFile(file: { name?: string; type?: string; size?: number }): {
  valid: boolean;
  error?: string;
} {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  const size = typeof file.size === 'number' ? file.size : 0;

  if (size > 15 * 1024 * 1024) {
    return { valid: false, error: 'Attachment file size exceeds the 15 MB limit.' };
  }

  const hasValidMime = ALLOWED_JOURNAL_ATTACHMENT_MIME_TYPES.includes(type as any);
  const hasValidExt = ALLOWED_JOURNAL_ATTACHMENT_EXTENSIONS.some((ext) => name.endsWith(ext));

  if (!hasValidMime && !hasValidExt) {
    return {
      valid: false,
      error: 'Only PDF, JPG, JPEG, and PNG files are allowed for journal trip attachments.',
    };
  }

  if (type && !hasValidMime) {
    return {
      valid: false,
      error: 'Only PDF, JPG, JPEG, and PNG files are allowed for journal trip attachments.',
    };
  }

  return { valid: true };
}

export function extractAttachmentFileName(storagePath: string): string {
  const segs = (storagePath || '').split('/');
  const raw = segs[segs.length - 1] || 'attachment';
  // Strip leading timestamp prefix if formatted as 1795..._filename
  const match = raw.match(/^\d{10,}_(.+)$/);
  return match ? match[1] : raw;
}

// ---------------------------------------------------------------------------
// Excel / CSV Bulk Import & Template Generation
// ---------------------------------------------------------------------------

export interface ParsedJournalImportRow {
  rowNumber: number;
  isValid: boolean;
  errors: string[];
  tripDateStr: string; // YYYY-MM-DD
  vehicleId: string | null;
  vehicleNumber: string;
  driverId: string | null;
  driverName: string;
  customerId: string | null;
  customerName: string;
  fromLocation: string;
  toLocation: string;
  entryType: JournalEntryType;
  externalReferenceNumber: string | null;
  freightAmountPaise: number;
  expenses: JournalTripExpenseItem[];
  totalExpensesPaise: number;
  profitPaise: number;
  odometerStart: number | null;
  odometerEnd: number | null;
  distanceTravelled: number | null;
  notes: string;
  status: JournalTripStatus;
}

export interface ParsedJournalImportResult {
  rows: ParsedJournalImportRow[];
  validRows: ParsedJournalImportRow[];
  invalidRows: ParsedJournalImportRow[];
  totalFreightPaise: number;
  totalExpensesPaise: number;
  totalProfitPaise: number;
}

function normalizeHeaderKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/\(inr\)|\(₹\)|\(rs\)/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function pickCell(normalizedRow: Record<string, unknown>, aliases: string[]): unknown {
  for (const alias of aliases) {
    if (alias in normalizedRow && normalizedRow[alias] !== undefined && normalizedRow[alias] !== '') {
      return normalizedRow[alias];
    }
  }
  return undefined;
}

function parseExcelDateValue(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const yyyy = raw.getFullYear();
    const mm = String(raw.getMonth() + 1).padStart(2, '0');
    const dd = String(raw.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 1) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  const str = String(raw).trim();
  if (!str) return null;

  // YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const yyyy = isoMatch[1];
    const mm = isoMatch[2].padStart(2, '0');
    const dd = isoMatch[3].padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    const dd = dmyMatch[1].padStart(2, '0');
    const mm = dmyMatch[2].padStart(2, '0');
    const yyyy = dmyMatch[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  const dt = new Date(str);
  if (!Number.isNaN(dt.getTime())) {
    return dt.toISOString().slice(0, 10);
  }
  return null;
}

function parseOptionalNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function normalizeEntryType(raw: unknown): JournalEntryType {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'offline' || v === 'offline trip' || v === 'offline_trip') return 'offline';
  if (v === 'manual_book' || v === 'manual book' || v === 'manual book entry' || v === 'register' || v === 'paper') {
    return 'manual_book';
  }
  return 'historical';
}

function normalizeJournalStatus(raw: unknown): JournalTripStatus {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'cancelled' || v === 'canceled') return 'cancelled';
  return 'completed';
}

export function parseJournalExcelBuffer(
  data: ArrayBuffer | Uint8Array,
  context: {
    vehicles?: Vehicle[];
    drivers?: Driver[];
    customers?: Customer[];
  } = {}
): ParsedJournalImportResult {
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return {
      rows: [],
      validRows: [],
      invalidRows: [],
      totalFreightPaise: 0,
      totalExpensesPaise: 0,
      totalProfitPaise: 0,
    };
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rawObjects = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const vehicleMap = new Map<string, Vehicle>();
  for (const v of context.vehicles || []) {
    vehicleMap.set(v.registrationNumber.replace(/[^a-z0-9]/gi, '').toUpperCase(), v);
  }
  const driverMap = new Map<string, Driver>();
  for (const d of context.drivers || []) {
    driverMap.set(d.fullName.trim().toLowerCase(), d);
  }
  const customerMap = new Map<string, Customer>();
  for (const c of context.customers || []) {
    customerMap.set(c.name.trim().toLowerCase(), c);
  }

  const rows: ParsedJournalImportRow[] = [];

  rawObjects.forEach((rawRow, idx) => {
    const rowNumber = idx + 2; // 1-indexed with header row at 1
    const norm: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawRow)) {
      norm[normalizeHeaderKey(k)] = v;
    }

    // Skip completely empty rows
    const hasAnyValue = Object.values(norm).some((v) => String(v ?? '').trim() !== '');
    if (!hasAnyValue) return;

    const errors: string[] = [];

    const rawDate = pickCell(norm, ['tripdate', 'date', 'dispatchdate', 'journeydate']);
    const tripDateStr = parseExcelDateValue(rawDate) || '';
    if (!tripDateStr) {
      errors.push('Invalid or missing Trip Date');
    }

    const vehicleNumber = String(
      pickCell(norm, ['vehiclenumber', 'vehiclereg', 'vehicleregistration', 'trucknumber', 'vehicle', 'truck']) || ''
    )
      .trim()
      .toUpperCase();
    if (!vehicleNumber) errors.push('Vehicle Number is required');

    const driverName = String(pickCell(norm, ['drivername', 'driver']) || '').trim();
    if (!driverName) errors.push('Driver Name is required');

    const customerName = String(pickCell(norm, ['customername', 'customer', 'partyname', 'party', 'consignor']) || '').trim();
    if (!customerName) errors.push('Customer Name is required');

    const fromLocation = String(pickCell(norm, ['fromlocation', 'from', 'origin', 'origincity', 'loadingpoint']) || '').trim();
    if (!fromLocation) errors.push('From Location is required');

    const toLocation = String(pickCell(norm, ['tolocation', 'to', 'destination', 'destinationcity', 'unloadingpoint']) || '').trim();
    if (!toLocation) errors.push('To Location is required');

    const rawFreight = pickCell(norm, ['freightamount', 'freight', 'freightrevenue', 'revenue', 'amount']);
    const freightNum = parseOptionalNumber(rawFreight);
    if (freightNum === null || freightNum < 0) {
      errors.push('Valid Freight Amount (>= 0) is required');
    }
    const freightAmountPaise = freightNum !== null && freightNum >= 0 ? rupeesToPaise(freightNum) : 0;

    const expenseAliases: Array<{ name: string; aliases: string[] }> = [
      { name: 'Loading Charges', aliases: ['loadingcharges', 'loading', 'loadingexpense'] },
      { name: 'Unloading Charges', aliases: ['unloadingcharges', 'unloading', 'unloadingexpense'] },
      { name: 'Fuel Expenses', aliases: ['fuelexpenses', 'fuel', 'diesel', 'dieselfuel', 'dieselexpense'] },
      { name: 'Toll Expenses', aliases: ['tollexpenses', 'toll', 'fastag', 'tollfastag'] },
      { name: 'Driver Expenses', aliases: ['driverexpenses', 'driverallowance', 'driverbata', 'bata'] },
      { name: 'Food Expenses', aliases: ['foodexpenses', 'food', 'meals'] },
      { name: 'Repair Expenses', aliases: ['repairexpenses', 'repair', 'repairs', 'maintenance'] },
      { name: 'Other Expenses', aliases: ['otherexpenses', 'other', 'misc', 'miscellaneousexpenses'] },
    ];

    const expenses: JournalTripExpenseItem[] = [];
    for (const def of expenseAliases) {
      const cellVal = pickCell(norm, def.aliases);
      const val = parseOptionalNumber(cellVal);
      if (val !== null && val < 0) {
        errors.push(`${def.name} cannot be negative`);
      } else if (val !== null && val > 0) {
        expenses.push({
          expenseName: def.name,
          amountPaise: rupeesToPaise(val),
          description: 'Imported from Excel',
        });
      }
    }

    const customExpRaw = pickCell(norm, ['customexpenses', 'extraexpenses']);
    if (customExpRaw && typeof customExpRaw === 'string') {
      const chunks = customExpRaw.split(/[;|]/).map((s) => s.trim()).filter(Boolean);
      for (const chunk of chunks) {
        const [cName, cAmt, cDesc] = chunk.split(':').map((s) => s.trim());
        const amtNum = parseOptionalNumber(cAmt);
        if (cName && amtNum !== null && amtNum > 0) {
          expenses.push({
            expenseName: cName.slice(0, 120),
            amountPaise: rupeesToPaise(amtNum),
            description: (cDesc || 'Imported custom expense').slice(0, 300),
          });
        }
      }
    }

    const odometerStart = parseOptionalNumber(pickCell(norm, ['odometerstart', 'startodometer', 'startkm']));
    const odometerEnd = parseOptionalNumber(pickCell(norm, ['odometerend', 'endodometer', 'endkm']));
    if (odometerStart !== null && odometerStart < 0) {
      errors.push('Odometer Start cannot be negative');
    }
    if (odometerEnd !== null && odometerEnd < 0) {
      errors.push('Odometer End cannot be negative');
    }
    if (odometerStart !== null && odometerEnd !== null && odometerEnd < odometerStart) {
      errors.push('Odometer End must be >= Odometer Start');
    }

    const distanceTravelled = calculateJournalDistance(odometerStart, odometerEnd);
    const { totalExpensesPaise, profitPaise } = calculateJournalFinancials(freightAmountPaise, expenses);

    const matchedVehicle = vehicleMap.get(vehicleNumber.replace(/[^a-z0-9]/gi, '').toUpperCase());
    const matchedDriver = driverMap.get(driverName.toLowerCase());
    const matchedCustomer = customerMap.get(customerName.toLowerCase());

    const externalRefRaw = pickCell(norm, [
      'externalreferencenumber',
      'externalreference',
      'referencenumber',
      'refno',
      'bookref',
      'lrnumber',
      'biltyno',
    ]);
    const externalReferenceNumber = externalRefRaw ? String(externalRefRaw).trim().slice(0, 100) : null;

    const entryType = normalizeEntryType(pickCell(norm, ['entrytype', 'source', 'recordtype']));
    const status = normalizeJournalStatus(pickCell(norm, ['status', 'recordstatus']));
    const notes = String(pickCell(norm, ['notes', 'tripdescription', 'description', 'remarks']) || '')
      .trim()
      .slice(0, 2000);

    rows.push({
      rowNumber,
      isValid: errors.length === 0,
      errors,
      tripDateStr,
      vehicleId: matchedVehicle?.id || null,
      vehicleNumber,
      driverId: matchedDriver?.id || null,
      driverName,
      customerId: matchedCustomer?.id || null,
      customerName,
      fromLocation,
      toLocation,
      entryType,
      externalReferenceNumber,
      freightAmountPaise,
      expenses,
      totalExpensesPaise,
      profitPaise,
      odometerStart,
      odometerEnd,
      distanceTravelled,
      notes,
      status,
    });
  });

  const validRows = rows.filter((r) => r.isValid);
  const invalidRows = rows.filter((r) => !r.isValid);
  const completedValid = validRows.filter((r) => r.status === 'completed');

  return {
    rows,
    validRows,
    invalidRows,
    totalFreightPaise: completedValid.reduce((s, r) => s + r.freightAmountPaise, 0),
    totalExpensesPaise: completedValid.reduce((s, r) => s + r.totalExpensesPaise, 0),
    totalProfitPaise: completedValid.reduce((s, r) => s + r.profitPaise, 0),
  };
}

export function buildJournalExcelTemplateWorkbook(): XLSX.WorkBook {
  const sampleRows = [
    {
      'Trip Date': '2025-11-18',
      'Vehicle Number': 'WB-19-K-4821',
      'Driver Name': 'Ramesh Yadav',
      'Customer Name': 'Tata Steel Downstream Ltd',
      'From Location': 'Jamshedpur, JH',
      'To Location': 'Kolkata, WB',
      'Entry Type': 'historical',
      'External Reference Number': 'REG-2025-104',
      'Freight Amount (INR)': 42500,
      'Loading Charges (INR)': 1500,
      'Unloading Charges (INR)': 1200,
      'Fuel Expenses (INR)': 16800,
      'Toll Expenses (INR)': 1450,
      'Driver Expenses (INR)': 1800,
      'Food Expenses (INR)': 650,
      'Repair Expenses (INR)': 0,
      'Other Expenses (INR)': 300,
      'Odometer Start': 124500,
      'Odometer End': 124810,
      Status: 'completed',
      Notes: 'Recorded from physical dispatch ledger book #4',
    },
    {
      'Trip Date': '2025-11-22',
      'Vehicle Number': 'OD-05-BG-9102',
      'Driver Name': 'Suresh Singh',
      'Customer Name': 'Dalmia Cement East',
      'From Location': 'Cuttack, OD',
      'To Location': 'Ranchi, JH',
      'Entry Type': 'offline',
      'External Reference Number': 'XLS-882',
      'Freight Amount (INR)': 54000,
      'Loading Charges (INR)': 1800,
      'Unloading Charges (INR)': 1500,
      'Fuel Expenses (INR)': 22400,
      'Toll Expenses (INR)': 2100,
      'Driver Expenses (INR)': 2000,
      'Food Expenses (INR)': 800,
      'Repair Expenses (INR)': 950,
      'Other Expenses (INR)': 250,
      'Odometer Start': 88400,
      'Odometer End': 88835,
      Status: 'completed',
      Notes: 'Migrated from legacy Excel sheet',
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Trips Journal Template');
  return workbook;
}

export function downloadJournalExcelTemplate(): void {
  const workbook = buildJournalExcelTemplateWorkbook();
  XLSX.writeFile(workbook, 'anchortransport-trips-journal-template.xlsx');
}

export function exportJournalTripsToExcel(trips: JournalTrip[]): void {
  const rows = trips.map((t) => ({
    'Trip ID': t.journalTripId,
    'Trip Date': (t.tripDate || '').slice(0, 10),
    'Vehicle Number': t.vehicleNumber,
    'Driver Name': t.driverName,
    'Customer Name': t.customerName,
    'From Location': t.fromLocation,
    'To Location': t.toLocation,
    'Entry Type': JOURNAL_ENTRY_TYPE_LABELS[t.entryType] || t.entryType,
    'External Reference Number': t.externalReferenceNumber || '',
    'Freight Amount (INR)': Number(paiseToRupees(t.freightAmountPaise).toFixed(2)),
    'Total Expenses (INR)': Number(paiseToRupees(t.totalExpensesPaise).toFixed(2)),
    'Trip Profit (INR)': Number(paiseToRupees(t.profitPaise).toFixed(2)),
    'Odometer Start': t.odometerStart ?? '',
    'Odometer End': t.odometerEnd ?? '',
    'Distance Travelled (KM)': t.distanceTravelled ?? '',
    Status: t.status,
    Notes: t.notes || '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Trips Journal');
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `trips-journal-export-${today}.xlsx`);
}
