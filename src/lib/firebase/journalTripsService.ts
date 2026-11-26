/**
 * AnchorTransport TMS - Trips Journal Firestore Service
 *
 * Manages historical, offline, and manual book trips in:
 * /companies/{companyId}/journalTrips/{journalTripId}
 *
 * Strictly isolated from operational Trips, Dispatches, Vehicles status,
 * Drivers status, Driver Advances, and Settlements.
 */

import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getAggregateFromServer,
  getCountFromServer,
  sum,
  count,
  serverTimestamp,
  Timestamp,
  onSnapshot,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from './client';
import {
  assertWritableFirestoreUser,
  isValidDocSegment,
  normalizeTimestamps,
  writeAuditLogBestEffort,
} from './firestoreService';
import { deleteJournalAttachment } from './storageService';
import {
  buildJournalSearchTokens,
  calculateJournalDistance,
  calculateJournalFinancials,
  generateJournalTripId,
  type ParsedJournalImportRow,
} from '../journalTripsHelpers';
import type {
  JournalEntryType,
  JournalTrip,
  JournalTripExpenseItem,
  JournalTripStatus,
  JournalTripSummaryStats,
} from '../../types/tms';

export interface JournalTripFilterParams {
  searchQuery?: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  entryType?: JournalEntryType | '';
  vehicleId?: string;
  driverId?: string;
  status?: JournalTripStatus | '';
}

export interface JournalTripPageResult {
  items: JournalTrip[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  firstDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

export interface JournalTripSaveInput {
  journalTripId?: string;
  tripDate: string; // YYYY-MM-DD or ISO string
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
  odometerStart: number | null;
  odometerEnd: number | null;
  notes: string;
  attachmentPaths: string[];
  status: JournalTripStatus;
}

function parseTripDateToTimestamp(tripDateStr: string): Timestamp {
  const clean = (tripDateStr || '').trim();
  if (!clean) {
    throw new Error('Trip date is required.');
  }
  // Normalize YYYY-MM-DD to midday UTC so timezone offsets never shift calendar day
  const dateOnlyMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = dateOnlyMatch
    ? new Date(`${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}T12:00:00.000Z`)
    : new Date(clean);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid trip date provided.');
  }
  return Timestamp.fromDate(parsed);
}

function buildDateRangeBounds(startDate?: string, endDate?: string): {
  startTs?: Timestamp;
  endTs?: Timestamp;
} {
  let startTs: Timestamp | undefined;
  let endTs: Timestamp | undefined;

  if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate.trim())) {
    const s = new Date(`${startDate.trim()}T00:00:00.000Z`);
    if (!Number.isNaN(s.getTime())) startTs = Timestamp.fromDate(s);
  }
  if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate.trim())) {
    const e = new Date(`${endDate.trim()}T23:59:59.999Z`);
    if (!Number.isNaN(e.getTime())) endTs = Timestamp.fromDate(e);
  }
  return { startTs, endTs };
}

function extractPrimarySearchToken(searchQuery?: string): string | null {
  const q = (searchQuery || '').trim().toLowerCase();
  if (!q || q.length < 2) return null;
  // Prefer longest alphanumeric/token segment for highest Firestore selectivity
  const words = q.split(/[\s,/\\]+/).filter((w) => w.length >= 2);
  if (words.length === 0) return q.slice(0, 40);
  const longest = words.reduce((a, b) => (b.length > a.length ? b : a), words[0]);
  return longest.slice(0, 40);
}

function matchesClientFilterFallback(trip: JournalTrip, filters: JournalTripFilterParams): boolean {
  if (filters.status && trip.status !== filters.status) return false;
  if (filters.entryType && trip.entryType !== filters.entryType) return false;
  if (filters.vehicleId && trip.vehicleId !== filters.vehicleId) return false;
  if (filters.driverId && trip.driverId !== filters.driverId) return false;

  const q = (filters.searchQuery || '').trim().toLowerCase();
  if (q) {
    const hay = [
      trip.journalTripId,
      trip.vehicleNumber,
      trip.driverName,
      trip.customerName,
      trip.externalReferenceNumber,
      trip.fromLocation,
      trip.toLocation,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    if (!terms.every((t) => hay.includes(t))) return false;
  }
  return true;
}

function mapDocToJournalTrip(docSnap: QueryDocumentSnapshot<DocumentData> | { id: string; data: () => DocumentData }): JournalTrip {
  const raw = docSnap.data();
  const normalized = normalizeTimestamps<JournalTrip>({
    id: docSnap.id,
    ...raw,
  });
  return {
    ...normalized,
    id: docSnap.id,
    journalTripId: normalized.journalTripId || docSnap.id,
    expenses: Array.isArray(normalized.expenses) ? normalized.expenses : [],
    attachmentPaths: Array.isArray(normalized.attachmentPaths) ? normalized.attachmentPaths : [],
    notes: normalized.notes || '',
  };
}

function isIndexOrPreconditionError(err: unknown): boolean {
  const code = String((err as any)?.code || '').toLowerCase();
  const msg = String((err as any)?.message || err || '').toLowerCase();
  return code.includes('failed-precondition') || msg.includes('requires an index');
}

function buildSanitizedJournalDocPayload(params: {
  companyId: string;
  journalTripId: string;
  input: JournalTripSaveInput;
  uid: string;
  existingCreatedBy?: string;
  existingCreatedAt?: unknown;
  isCreate: boolean;
}): Record<string, any> {
  const {
    companyId,
    journalTripId,
    input,
    uid,
    existingCreatedBy,
    existingCreatedAt,
    isCreate,
  } = params;

  const vehicleNumber = (input.vehicleNumber || '').trim().toUpperCase().slice(0, 40);
  const driverName = (input.driverName || '').trim().slice(0, 120);
  const customerName = (input.customerName || '').trim().slice(0, 150);
  const fromLocation = (input.fromLocation || '').trim().slice(0, 200);
  const toLocation = (input.toLocation || '').trim().slice(0, 200);

  if (!vehicleNumber) throw new Error('Vehicle number is required.');
  if (!driverName) throw new Error('Driver name is required.');
  if (!customerName) throw new Error('Customer name is required.');
  if (!fromLocation) throw new Error('From location is required.');
  if (!toLocation) throw new Error('To location is required.');

  const tripDateTs = parseTripDateToTimestamp(input.tripDate);

  const entryType: JournalEntryType =
    input.entryType === 'offline' || input.entryType === 'manual_book'
      ? input.entryType
      : 'historical';

  const status: JournalTripStatus = input.status === 'cancelled' ? 'cancelled' : 'completed';

  const vehicleId =
    input.vehicleId && isValidDocSegment(input.vehicleId) ? input.vehicleId.trim() : null;
  const driverId =
    input.driverId && isValidDocSegment(input.driverId) ? input.driverId.trim() : null;
  const customerId =
    input.customerId && isValidDocSegment(input.customerId) ? input.customerId.trim() : null;

  const externalRef = input.externalReferenceNumber
    ? input.externalReferenceNumber.trim().slice(0, 100) || null
    : null;

  const { freightAmountPaise, expenses, totalExpensesPaise, profitPaise } =
    calculateJournalFinancials(input.freightAmountPaise, input.expenses);

  const odometerStart =
    typeof input.odometerStart === 'number' && Number.isFinite(input.odometerStart) && input.odometerStart >= 0
      ? Math.round(input.odometerStart * 100) / 100
      : null;
  const odometerEnd =
    typeof input.odometerEnd === 'number' && Number.isFinite(input.odometerEnd) && input.odometerEnd >= 0
      ? Math.round(input.odometerEnd * 100) / 100
      : null;

  if (odometerStart !== null && odometerEnd !== null && odometerEnd < odometerStart) {
    throw new Error('Ending odometer reading cannot be less than starting odometer reading.');
  }

  const distanceTravelled = calculateJournalDistance(odometerStart, odometerEnd);
  const notes = (input.notes || '').trim().slice(0, 2000);
  const activeUid = uid || auth.currentUser?.uid || '';
  const attachmentPaths = Array.isArray(input.attachmentPaths)
    ? input.attachmentPaths
        .filter(
          (p): p is string =>
            typeof p === 'string' &&
            ((activeUid !== '' && p.startsWith(`users/${activeUid}/`)) ||
              p.startsWith(`companies/${companyId}/journalTrips/`))
        )
        .slice(0, 15)
    : [];

  const searchTokens = buildJournalSearchTokens({
    journalTripId,
    vehicleNumber,
    driverName,
    customerName,
    externalReferenceNumber: externalRef,
  });

  const payload: Record<string, any> = {
    companyId,
    journalTripId,
    tripDate: tripDateTs,
    vehicleId,
    vehicleNumber,
    driverId,
    driverName,
    customerId,
    customerName,
    fromLocation,
    toLocation,
    entryType,
    externalReferenceNumber: externalRef,
    freightAmountPaise,
    expenses,
    totalExpensesPaise,
    profitPaise,
    odometerStart,
    odometerEnd,
    distanceTravelled,
    notes,
    attachmentPaths,
    status,
    searchTokens,
    updatedAt: serverTimestamp(),
    createdBy: isCreate ? uid : existingCreatedBy || uid,
    updatedBy: uid,
  };

  if (isCreate) {
    payload.createdAt = serverTimestamp();
  } else if (existingCreatedAt) {
    payload.createdAt = existingCreatedAt;
  }

  return payload;
}

/**
 * Fetches paginated Trips Journal records directly from Firestore using indexed queries.
 */
export async function queryJournalTripsPaginated(
  companyId: string,
  filters: JournalTripFilterParams = {},
  options: {
    pageSize?: number;
    afterCursor?: QueryDocumentSnapshot<DocumentData> | null;
  } = {}
): Promise<JournalTripPageResult> {
  if (!auth.currentUser || !isValidDocSegment(companyId)) {
    return { items: [], lastDoc: null, firstDoc: null, hasMore: false };
  }
  const safeCompanyId = companyId.trim();
  const pageSize = Math.min(Math.max(options.pageSize || 15, 5), 50);
  const colRef = collection(db, 'companies', safeCompanyId, 'journalTrips');
  const colPath = `companies/${safeCompanyId}/journalTrips`;

  const { startTs, endTs } = buildDateRangeBounds(filters.startDate, filters.endDate);
  const searchToken = extractPrimarySearchToken(filters.searchQuery);

  const buildConstraints = (mode: 'full' | 'primary_only' | 'date_only'): QueryConstraint[] => {
    const constraints: QueryConstraint[] = [];

    if (mode === 'full') {
      if (filters.status) constraints.push(where('status', '==', filters.status));
      if (searchToken) {
        constraints.push(where('searchTokens', 'array-contains', searchToken));
      } else if (filters.entryType) {
        constraints.push(where('entryType', '==', filters.entryType));
        if (filters.vehicleId) {
          constraints.push(where('vehicleId', '==', filters.vehicleId));
        } else if (filters.driverId) {
          constraints.push(where('driverId', '==', filters.driverId));
        }
      } else if (filters.vehicleId) {
        constraints.push(where('vehicleId', '==', filters.vehicleId));
      } else if (filters.driverId) {
        constraints.push(where('driverId', '==', filters.driverId));
      }
    } else if (mode === 'primary_only') {
      if (searchToken) {
        constraints.push(where('searchTokens', 'array-contains', searchToken));
      } else if (filters.status) {
        constraints.push(where('status', '==', filters.status));
      } else if (filters.entryType) {
        constraints.push(where('entryType', '==', filters.entryType));
      } else if (filters.vehicleId) {
        constraints.push(where('vehicleId', '==', filters.vehicleId));
      } else if (filters.driverId) {
        constraints.push(where('driverId', '==', filters.driverId));
      }
    }

    if (startTs) constraints.push(where('tripDate', '>=', startTs));
    if (endTs) constraints.push(where('tripDate', '<=', endTs));
    constraints.push(orderBy('tripDate', 'desc'));
    if (options.afterCursor) constraints.push(startAfter(options.afterCursor));
    constraints.push(limit(pageSize + 1));

    return constraints;
  };

  let snap;
  try {
    snap = await getDocs(query(colRef, ...buildConstraints('full')));
  } catch (err) {
    if (isIndexOrPreconditionError(err)) {
      try {
        snap = await getDocs(query(colRef, ...buildConstraints('primary_only')));
      } catch (err2) {
        if (isIndexOrPreconditionError(err2)) {
          try {
            snap = await getDocs(query(colRef, ...buildConstraints('date_only')));
          } catch (err3) {
            handleFirestoreError(err3, OperationType.LIST, colPath);
          }
        } else {
          handleFirestoreError(err2, OperationType.LIST, colPath);
        }
      }
    } else {
      handleFirestoreError(err, OperationType.LIST, colPath);
    }
  }

  const allDocs = snap.docs;
  const hasMore = allDocs.length > pageSize;
  const pageDocs = hasMore ? allDocs.slice(0, pageSize) : allDocs;
  const mapped = pageDocs
    .map((d) => mapDocToJournalTrip(d))
    .filter((item) => matchesClientFilterFallback(item, filters));

  return {
    items: mapped,
    firstDoc: pageDocs[0] || null,
    lastDoc: pageDocs[pageDocs.length - 1] || null,
    hasMore,
  };
}

/**
 * Subscribes to the most recent Trips Journal entries for real-time Dashboard visibility.
 * Strictly reads only /companies/{companyId}/journalTrips with bounded limit.
 */
export function subscribeToRecentJournalTripsInFirestore(
  companyId: string,
  onData: (items: JournalTrip[]) => void,
  onError?: (err: Error) => void,
  maxItems = 50
): Unsubscribe {
  if (!auth.currentUser || !isValidDocSegment(companyId)) {
    onData([]);
    return () => {};
  }

  const safeCompanyId = companyId.trim();
  const safeLimit = Math.min(Math.max(Math.round(maxItems) || 50, 1), 100);
  const colPath = `companies/${safeCompanyId}/journalTrips`;
  const colRef = collection(db, 'companies', safeCompanyId, 'journalTrips');
  const q = query(colRef, orderBy('tripDate', 'desc'), limit(safeLimit));

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => mapDocToJournalTrip(d));
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, colPath);
      } catch (wrapped: any) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

/**
 * Computes summary metrics for Trips Journal using Firestore server-side aggregation.
 * Cancelled trips NEVER contribute to revenue, expenses, or profit totals.
 */
export async function fetchJournalTripSummaryStats(
  companyId: string,
  filters: JournalTripFilterParams = {}
): Promise<JournalTripSummaryStats> {
  const emptyStats: JournalTripSummaryStats = {
    totalTripsCount: 0,
    completedTripsCount: 0,
    cancelledTripsCount: 0,
    totalFreightRevenuePaise: 0,
    totalExpensesPaise: 0,
    totalProfitPaise: 0,
  };

  if (!auth.currentUser || !isValidDocSegment(companyId)) {
    return emptyStats;
  }

  const safeCompanyId = companyId.trim();
  const colRef = collection(db, 'companies', safeCompanyId, 'journalTrips');
  const colPath = `companies/${safeCompanyId}/journalTrips`;
  const { startTs, endTs } = buildDateRangeBounds(filters.startDate, filters.endDate);
  const searchToken = extractPrimarySearchToken(filters.searchQuery);

  const buildFilterConstraints = (includeSecondary: boolean): QueryConstraint[] => {
    const constraints: QueryConstraint[] = [];
    if (searchToken) {
      constraints.push(where('searchTokens', 'array-contains', searchToken));
    } else if (includeSecondary) {
      if (filters.entryType) constraints.push(where('entryType', '==', filters.entryType));
      else if (filters.vehicleId) constraints.push(where('vehicleId', '==', filters.vehicleId));
      else if (filters.driverId) constraints.push(where('driverId', '==', filters.driverId));
    }
    if (startTs) constraints.push(where('tripDate', '>=', startTs));
    if (endTs) constraints.push(where('tripDate', '<=', endTs));
    return constraints;
  };

  try {
    const baseFilters = buildFilterConstraints(true);
    const allQuery = filters.status
      ? query(colRef, where('status', '==', filters.status), ...baseFilters)
      : query(colRef, ...baseFilters);

    const countSnap = await getCountFromServer(allQuery);
    const totalTripsCount = countSnap.data().count || 0;

    // If user explicitly filtered for cancelled trips, revenue/expenses/profit cards stay 0
    if (filters.status === 'cancelled') {
      return {
        totalTripsCount,
        completedTripsCount: 0,
        cancelledTripsCount: totalTripsCount,
        totalFreightRevenuePaise: 0,
        totalExpensesPaise: 0,
        totalProfitPaise: 0,
      };
    }

    const completedQuery = query(colRef, where('status', '==', 'completed'), ...baseFilters);
    const aggSnap = await getAggregateFromServer(completedQuery, {
      completedCount: count(),
      totalFreightRevenuePaise: sum('freightAmountPaise'),
      totalExpensesPaise: sum('totalExpensesPaise'),
      totalProfitPaise: sum('profitPaise'),
    });

    const data = aggSnap.data();
    const completedTripsCount = Number(data.completedCount || 0);
    const totalFreightRevenuePaise = Math.round(Number(data.totalFreightRevenuePaise || 0));
    const totalExpensesPaise = Math.round(Number(data.totalExpensesPaise || 0));
    const totalProfitPaise = totalFreightRevenuePaise - totalExpensesPaise;

    return {
      totalTripsCount,
      completedTripsCount,
      cancelledTripsCount: Math.max(0, totalTripsCount - completedTripsCount),
      totalFreightRevenuePaise,
      totalExpensesPaise,
      totalProfitPaise,
    };
  } catch (err) {
    if (isIndexOrPreconditionError(err)) {
      // Fallback using single status equality index when multiple filters are combined
      try {
        const dateOnly = buildFilterConstraints(false);
        const completedSnap = await getAggregateFromServer(
          query(colRef, where('status', '==', 'completed'), ...dateOnly),
          {
            completedCount: count(),
            totalFreightRevenuePaise: sum('freightAmountPaise'),
            totalExpensesPaise: sum('totalExpensesPaise'),
            totalProfitPaise: sum('profitPaise'),
          }
        );
        const allCountSnap = await getCountFromServer(query(colRef, ...dateOnly));
        const d = completedSnap.data();
        const rev = Math.round(Number(d.totalFreightRevenuePaise || 0));
        const exp = Math.round(Number(d.totalExpensesPaise || 0));
        const comp = Number(d.completedCount || 0);
        const tot = allCountSnap.data().count || comp;
        return {
          totalTripsCount: tot,
          completedTripsCount: comp,
          cancelledTripsCount: Math.max(0, tot - comp),
          totalFreightRevenuePaise: rev,
          totalExpensesPaise: exp,
          totalProfitPaise: rev - exp,
        };
      } catch (err2) {
        handleFirestoreError(err2, OperationType.LIST, colPath);
      }
    }
    handleFirestoreError(err, OperationType.LIST, colPath);
  }
}

/**
 * Fetches completed journal trips ONLY when explicitly requested by Reports opt-in toggle.
 */
export async function fetchCompletedJournalTripsForReport(
  companyId: string,
  filters: { startDate?: string; endDate?: string; vehicleId?: string; driverId?: string } = {}
): Promise<JournalTrip[]> {
  if (!auth.currentUser || !isValidDocSegment(companyId)) return [];
  const safeCompanyId = companyId.trim();
  const colRef = collection(db, 'companies', safeCompanyId, 'journalTrips');
  const colPath = `companies/${safeCompanyId}/journalTrips`;
  const { startTs, endTs } = buildDateRangeBounds(filters.startDate, filters.endDate);

  const constraints: QueryConstraint[] = [where('status', '==', 'completed')];
  if (filters.vehicleId) constraints.push(where('vehicleId', '==', filters.vehicleId));
  else if (filters.driverId) constraints.push(where('driverId', '==', filters.driverId));
  if (startTs) constraints.push(where('tripDate', '>=', startTs));
  if (endTs) constraints.push(where('tripDate', '<=', endTs));
  constraints.push(orderBy('tripDate', 'desc'), limit(500));

  try {
    const snap = await getDocs(query(colRef, ...constraints));
    return snap.docs
      .map((d) => mapDocToJournalTrip(d))
      .filter((t) => (!filters.vehicleId || t.vehicleId === filters.vehicleId) && (!filters.driverId || t.driverId === filters.driverId));
  } catch (err) {
    if (isIndexOrPreconditionError(err)) {
      const fallbackSnap = await getDocs(
        query(colRef, where('status', '==', 'completed'), orderBy('tripDate', 'desc'), limit(500))
      );
      return fallbackSnap.docs
        .map((d) => mapDocToJournalTrip(d))
        .filter((t) => (!filters.vehicleId || t.vehicleId === filters.vehicleId) && (!filters.driverId || t.driverId === filters.driverId));
    }
    handleFirestoreError(err, OperationType.LIST, colPath);
  }
}

/**
 * Creates a new Trips Journal entry in /companies/{companyId}/journalTrips/{journalTripId}.
 */
export async function createJournalTripInFirestore(
  companyId: string,
  input: JournalTripSaveInput
): Promise<JournalTrip> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const uid = auth.currentUser!.uid;
  const journalTripId =
    input.journalTripId && isValidDocSegment(input.journalTripId)
      ? input.journalTripId.trim()
      : generateJournalTripId();

  const path = `companies/${safeCompanyId}/journalTrips/${journalTripId}`;
  const docRef = doc(db, 'companies', safeCompanyId, 'journalTrips', journalTripId);

  const payload = buildSanitizedJournalDocPayload({
    companyId: safeCompanyId,
    journalTripId,
    input,
    uid,
    isCreate: true,
  });

  try {
    await setDoc(docRef, payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }

  await writeAuditLogBestEffort(safeCompanyId, {
    action: 'CREATE',
    entityType: 'JOURNAL_TRIP',
    entityId: journalTripId,
    moduleName: 'TRIPS_JOURNAL',
    summary: `Recorded ${payload.entryType} journal trip ${journalTripId} (${payload.vehicleNumber}: ${payload.fromLocation} → ${payload.toLocation}, Freight ₹${(payload.freightAmountPaise / 100).toFixed(2)})`,
    updatedValues: {
      status: payload.status,
      entryType: payload.entryType,
      freightAmountPaise: payload.freightAmountPaise,
      totalExpensesPaise: payload.totalExpensesPaise,
      profitPaise: payload.profitPaise,
    },
  });

  const nowIso = new Date().toISOString();
  return {
    id: journalTripId,
    companyId: safeCompanyId,
    journalTripId,
    tripDate: payload.tripDate.toDate().toISOString(),
    vehicleId: payload.vehicleId,
    vehicleNumber: payload.vehicleNumber,
    driverId: payload.driverId,
    driverName: payload.driverName,
    customerId: payload.customerId,
    customerName: payload.customerName,
    fromLocation: payload.fromLocation,
    toLocation: payload.toLocation,
    entryType: payload.entryType,
    externalReferenceNumber: payload.externalReferenceNumber,
    freightAmountPaise: payload.freightAmountPaise,
    expenses: payload.expenses,
    totalExpensesPaise: payload.totalExpensesPaise,
    profitPaise: payload.profitPaise,
    odometerStart: payload.odometerStart,
    odometerEnd: payload.odometerEnd,
    distanceTravelled: payload.distanceTravelled,
    notes: payload.notes,
    attachmentPaths: payload.attachmentPaths,
    status: payload.status,
    searchTokens: payload.searchTokens,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: uid,
    updatedBy: uid,
  };
}

/**
 * Updates an existing Trips Journal entry while preserving immutable companyId, journalTripId, createdBy, and createdAt.
 */
export async function updateJournalTripInFirestore(
  companyId: string,
  journalTripId: string,
  input: JournalTripSaveInput
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  if (!isValidDocSegment(journalTripId)) {
    throw new Error('Invalid journal trip ID.');
  }
  const safeId = journalTripId.trim();
  const uid = auth.currentUser!.uid;
  const path = `companies/${safeCompanyId}/journalTrips/${safeId}`;
  const docRef = doc(db, 'companies', safeCompanyId, 'journalTrips', safeId);

  let existingSnap;
  try {
    try {
      existingSnap = await getDocFromServer(docRef);
    } catch {
      existingSnap = await getDoc(docRef);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }

  if (!existingSnap.exists()) {
    throw new Error(`Journal trip ${safeId} could not be found.`);
  }

  const existingData = existingSnap.data();
  const payload = buildSanitizedJournalDocPayload({
    companyId: safeCompanyId,
    journalTripId: safeId,
    input,
    uid,
    existingCreatedBy: existingData.createdBy || uid,
    existingCreatedAt: existingData.createdAt,
    isCreate: false,
  });

  // Omit createdAt when updating so existing server Timestamp is preserved bit-for-bit
  const updateFields = { ...payload };
  delete updateFields.createdAt;

  try {
    await updateDoc(docRef, updateFields);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }

  await writeAuditLogBestEffort(safeCompanyId, {
    action: 'UPDATE',
    entityType: 'JOURNAL_TRIP',
    entityId: safeId,
    moduleName: 'TRIPS_JOURNAL',
    summary: `Updated journal trip ${safeId} (${payload.vehicleNumber}: ${payload.fromLocation} → ${payload.toLocation})`,
    previousValues: {
      status: existingData.status,
      freightAmountPaise: existingData.freightAmountPaise,
      totalExpensesPaise: existingData.totalExpensesPaise,
    },
    updatedValues: {
      status: payload.status,
      freightAmountPaise: payload.freightAmountPaise,
      totalExpensesPaise: payload.totalExpensesPaise,
      profitPaise: payload.profitPaise,
    },
  });
}

/**
 * Deletes a Trips Journal entry and cleans up its private Storage attachments best-effort.
 */
export async function deleteJournalTripInFirestore(
  companyId: string,
  trip: JournalTrip
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  if (!isValidDocSegment(trip?.journalTripId)) {
    throw new Error('Invalid journal trip ID.');
  }
  const safeId = trip.journalTripId.trim();
  const path = `companies/${safeCompanyId}/journalTrips/${safeId}`;

  try {
    await deleteDoc(doc(db, 'companies', safeCompanyId, 'journalTrips', safeId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }

  // Best-effort attachment cleanup in Firebase Storage
  if (Array.isArray(trip.attachmentPaths) && trip.attachmentPaths.length > 0) {
    await Promise.allSettled(
      trip.attachmentPaths.map((storagePath) => deleteJournalAttachment(safeCompanyId, storagePath))
    );
  }

  await writeAuditLogBestEffort(safeCompanyId, {
    action: 'DELETE',
    entityType: 'JOURNAL_TRIP',
    entityId: safeId,
    moduleName: 'TRIPS_JOURNAL',
    summary: `Deleted journal trip ${safeId} (${trip.vehicleNumber}: ${trip.fromLocation} → ${trip.toLocation})`,
  });
}

/**
 * Bulk-imports validated Excel/CSV journal trip rows into Firestore in atomic chunks.
 */
export async function batchImportJournalTripsInFirestore(
  companyId: string,
  validRows: ParsedJournalImportRow[]
): Promise<{ importedCount: number }> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const uid = auth.currentUser!.uid;

  const cleanRows = validRows.filter((r) => r.isValid);
  if (cleanRows.length === 0) {
    return { importedCount: 0 };
  }

  const CHUNK_SIZE = 200; // Well below Firestore 500 writes-per-batch limit
  let importedCount = 0;

  for (let i = 0; i < cleanRows.length; i += CHUNK_SIZE) {
    const chunk = cleanRows.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);

    for (const row of chunk) {
      const journalTripId = generateJournalTripId();
      const docRef = doc(db, 'companies', safeCompanyId, 'journalTrips', journalTripId);
      const payload = buildSanitizedJournalDocPayload({
        companyId: safeCompanyId,
        journalTripId,
        input: {
          journalTripId,
          tripDate: row.tripDateStr,
          vehicleId: row.vehicleId,
          vehicleNumber: row.vehicleNumber,
          driverId: row.driverId,
          driverName: row.driverName,
          customerId: row.customerId,
          customerName: row.customerName,
          fromLocation: row.fromLocation,
          toLocation: row.toLocation,
          entryType: row.entryType,
          externalReferenceNumber: row.externalReferenceNumber,
          freightAmountPaise: row.freightAmountPaise,
          expenses: row.expenses,
          odometerStart: row.odometerStart,
          odometerEnd: row.odometerEnd,
          notes: row.notes,
          attachmentPaths: [],
          status: row.status,
        },
        uid,
        isCreate: true,
      });

      batch.set(docRef, payload);
    }

    try {
      await batch.commit();
      importedCount += chunk.length;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `companies/${safeCompanyId}/journalTrips`);
    }
  }

  await writeAuditLogBestEffort(safeCompanyId, {
    action: 'CREATE',
    entityType: 'JOURNAL_TRIP',
    entityId: `import_${Date.now()}`,
    moduleName: 'TRIPS_JOURNAL',
    summary: `Bulk imported ${importedCount} historical/offline journal trip(s) from Excel/CSV`,
  });

  return { importedCount };
}
