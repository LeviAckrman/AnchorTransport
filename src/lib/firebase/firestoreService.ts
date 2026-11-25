/**
 * AnchorTransport TMS - Client Firestore Service Layer
 * Direct persistence & hydration against Firestore DB:
 * ai-studio-anchortransportt-c5041a54-7d47-45d6-a1f6-5144adf1df5d
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
  deleteField,
  writeBatch,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type FieldValue,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User as FirebaseUser } from 'firebase/auth';
import { db, auth, handleFirestoreError, OperationType } from './client';
import { calculateDocComplianceStatus } from '../tmsCalculations';
import type {
  Company,
  Vehicle,
  Driver,
  Customer,
  Broker,
  Trip,
  TripLog,
  TripLogSeverity,
  TripExpense,
  DriverAdvance,
  TripSettlement,
  Invoice,
  Payment,
  VehicleDocument,
  MaintenanceRecord,
  FileRecord,
  UserFileMetadata,
  StorageFileCategory,
  CompanySettings,
  AuditLog,
  UserRole,
} from '../../types/tms';

export { OperationType, handleFirestoreError };

export interface HydratedCompanyBundle {
  vehicles: Vehicle[];
  drivers: Driver[];
  customers: Customer[];
  brokers: Broker[];
  trips: Trip[];
  expenses: TripExpense[];
  advances: DriverAdvance[];
  settlements: TripSettlement[];
  invoices: Invoice[];
  payments: Payment[];
  documents: VehicleDocument[];
  maintenance: MaintenanceRecord[];
  fileRecords: FileRecord[];
  settings: CompanySettings | null;
}

export interface FirestoreUserProfile {
  id: string;
  email: string;
  name: string;
  phone?: string;
  defaultCompanyId?: string;
  activeCompanyId?: string;
  role?: UserRole | 'USER';
  photoUrl?: string;
  onboardingCompleted?: boolean;
  onboardingCompletedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FirestoreCompanyMember {
  id?: string;
  userId: string;
  companyId: string;
  role: UserRole;
  name?: string;
  email: string;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  invitedByUid?: string;
  joinedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

const VALID_COMPANY_MEMBER_ROLES: UserRole[] = ['OWNER'];

/**
 * Checks whether the active Firebase user has verified their email address
 * (Required by firestore.rules isVerifiedUser() for all writes)
 */
export function isVerifiedEmailUser(): boolean {
  return Boolean(auth.currentUser && auth.currentUser.emailVerified);
}

export function isValidDocSegment(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value.trim());
}

export function isFirestoreTimestamp(val: unknown): val is Timestamp {
  return (
    val instanceof Timestamp ||
    (typeof val === 'object' &&
      val !== null &&
      typeof (val as any).toDate === 'function' &&
      typeof (val as any).seconds === 'number')
  );
}

function isPermissionDeniedError(err: unknown): boolean {
  const code = String((err as any)?.code || '').toLowerCase();
  const msg = String((err as any)?.message || err || '').toLowerCase();
  return (
    code.includes('permission-denied') ||
    msg.includes('missing or insufficient permissions') ||
    msg.includes('permission-denied')
  );
}

/**
 * Resolves the authoritative role for a UID within /companies/{companyId}.
 * Strict Owner-Only: access is granted exclusively when company.ownerId === targetUid.
 */
export async function resolveCompanyRoleInFirestore(
  companyId: string,
  uid?: string
): Promise<UserRole | null> {
  const targetUid = (uid || auth.currentUser?.uid || '').trim();
  if (!auth.currentUser || !isValidDocSegment(companyId) || !isValidDocSegment(targetUid)) {
    return null;
  }
  if (targetUid !== auth.currentUser.uid) {
    return null;
  }
  const safeCompanyId = companyId.trim();
  try {
    const companySnap = await getAuthoritativeDocSnap(doc(db, 'companies', safeCompanyId));
    if (companySnap.exists() && companySnap.data()?.ownerId === targetUid) {
      return 'OWNER';
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Checks whether the active signed-in Firebase user owns /companies/{companyId}
 */
export async function isCompanyOwnerInFirestore(companyId: string): Promise<boolean> {
  const role = await resolveCompanyRoleInFirestore(companyId);
  return role === 'OWNER';
}

/**
 * Checks whether the active signed-in Firebase user is the authorized Owner
 */
export async function hasActiveCompanyAccessInFirestore(companyId: string): Promise<boolean> {
  const role = await resolveCompanyRoleInFirestore(companyId);
  return role === 'OWNER';
}

export const hasActiveCompanyMembershipInFirestore = hasActiveCompanyAccessInFirestore;

/**
 * Recursively strips undefined fields before sending to Firestore
 */
function stripUndefined<T extends Record<string, any>>(obj: T): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    if (typeof val === 'number' && !Number.isFinite(val)) continue;
    if (
      typeof val === 'object' &&
      !Array.isArray(val) &&
      !isFirestoreTimestamp(val) &&
      !(val instanceof Date)
    ) {
      if ('_methodName' in val) {
        clean[key] = val;
      } else {
        clean[key] = stripUndefined(val);
      }
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

async function getAuthoritativeDocSnap(
  ref: DocumentReference<DocumentData>
): Promise<DocumentSnapshot<DocumentData>> {
  try {
    return await getDocFromServer(ref);
  } catch (serverErr: any) {
    const code = String(serverErr?.code || '');
    const msg = String(serverErr?.message || '').toLowerCase();
    if (code === 'unavailable' || msg.includes('offline')) {
      const cachedSnap = await getDoc(ref);
      if (cachedSnap.exists()) {
        return cachedSnap;
      }
    }
    throw serverErr;
  }
}

/**
 * Builds an update payload for an existing document that already has a Firestore
 * Timestamp `createdAt`, omitting `createdAt` so Firestore preserves the server
 * value bit-for-bit (avoiding client Timestamp re-serialization mismatches) and
 * marking any removed optional keys with `deleteField()`.
 */
function buildServerPreservingUpdatePayload(
  existingData: DocumentData,
  fullPayload: Record<string, any>
): Record<string, any | FieldValue> {
  const updatePayload: Record<string, any | FieldValue> = {};
  for (const [key, val] of Object.entries(fullPayload)) {
    if (key === 'createdAt') continue;
    updatePayload[key] = val;
  }
  for (const existingKey of Object.keys(existingData)) {
    if (existingKey === 'createdAt') continue;
    if (!(existingKey in fullPayload)) {
      updatePayload[existingKey] = deleteField();
    }
  }
  return updatePayload;
}

/**
 * Converts Firestore Timestamp fields back into ISO date strings for UI / REST consistency
 */
export function normalizeTimestamps<T>(raw: DocumentData): T {
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (val instanceof Timestamp) {
      out[key] = val.toDate().toISOString();
    } else if (val && typeof val === 'object' && typeof (val as any).toDate === 'function') {
      out[key] = (val as any).toDate().toISOString();
    } else {
      out[key] = val;
    }
  }
  return out as T;
}

function clipStr(val: unknown, maxLen: number): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

function toNum(val: unknown, fallback?: number): number | undefined {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const n = Number(val);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

const VALID_VEHICLE_STATUSES = ['AVAILABLE', 'IN_TRANSIT', 'UNDER_MAINTENANCE', 'INACTIVE'];
const VALID_DRIVER_STATUSES = ['AVAILABLE', 'ON_TRIP', 'ON_LEAVE', 'INACTIVE'];
const VALID_CUSTOMER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'];
const VALID_BROKER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'];
const VALID_STORAGE_FOLDERS: StorageFileCategory[] = [
  'company',
  'documents',
  'invoices',
  'receipts',
  'trips',
  'drivers',
  'vehicles',
  'expenses',
  'fuel',
  'settlements',
  'customer-documents',
  'profile',
  'other',
  'dispatches',
  'pod',
];
const VALID_TRIP_STATUSES = ['PLANNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'SETTLED', 'CANCELLED'];
const VALID_EXPENSE_CATEGORIES = [
  'FUEL', 'DIESEL', 'TOLL', 'TOLL_FASTAG', 'PARKING', 'DRIVER_ALLOWANCE',
  'DRIVER_BATA', 'LOADING', 'UNLOADING', 'LOADING_UNLOADING', 'REPAIR',
  'EN_ROUTE_REPAIR', 'TYRE_PUNCTURE', 'DEF_ADBLUE', 'RTO_POLICE', 'WEIGHBRIDGE', 'OTHER',
];
const VALID_EXPENSE_PAYMENT_MODES = ['CASH', 'FASTAG', 'PETRO_CARD', 'UPI', 'DRIVER_POCKET', 'BANK_TRANSFER'];
const VALID_ADVANCE_TYPES = ['CASH_DISPATCH', 'CASH_EN_ROUTE', 'PUMP_DIESEL_SLIP', 'UPI_ONLINE', 'BANK_TRANSFER'];
const VALID_SETTLEMENT_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED_SETTLED', 'FINALIZED'];
const VALID_INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'];
const VALID_PAYMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'];
const VALID_PAYMENT_MODES = ['NEFT_RTGS', 'CHEQUE', 'UPI', 'CASH', 'BANK_TRANSFER'];
const VALID_DOC_TYPES = ['RC', 'FITNESS', 'NATIONAL_PERMIT', 'STATE_PERMIT', 'INSURANCE', 'PUC', 'ROAD_TAX'];
const VALID_DOC_STATUSES = ['VALID', 'EXPIRING_SOON', 'EXPIRED'];
const VALID_MAINTENANCE_TYPES = ['SCHEDULED_SERVICE', 'TYRE_REPLACEMENT', 'ENGINE_WORK', 'BRAKE_SUSPENSION', 'ACCIDENT_BREAKDOWN'];

/**
 * Sanitizes entity payloads strictly to the keys and bounds enforced by firestore.rules
 */
export function sanitizeSubcollectionPayload(
  subcollection: CompanySubcollection,
  companyId: string,
  item: Record<string, any>,
  existingData?: DocumentData | null
): Record<string, any> | null {
  const safeId = typeof item.id === 'string' ? item.id.trim() : '';
  if (!isValidDocSegment(safeId)) return null;
  item = { ...item, id: safeId };
  const createdAt = isFirestoreTimestamp(existingData?.createdAt)
    ? existingData!.createdAt
    : serverTimestamp();
  const updatedAt = serverTimestamp();

  switch (subcollection) {
    case 'vehicles': {
      const reg =
        clipStr(item.registrationNumber, 30) ||
        clipStr(existingData?.registrationNumber, 30);
      const vType =
        clipStr(item.vehicleType, 60) ||
        clipStr(existingData?.vehicleType, 60);
      const status = VALID_VEHICLE_STATUSES.includes(item.status) ? item.status : 'AVAILABLE';
      if (!reg || !vType) return null;
      return stripUndefined({
        id: item.id,
        companyId,
        registrationNumber: reg,
        vehicleType: vType,
        makeModel: clipStr(item.makeModel, 100),
        capacityTonnes: toNum(item.capacityTonnes),
        unladenWeightTonnes: toNum(item.unladenWeightTonnes),
        chassisNumber: clipStr(item.chassisNumber, 60),
        engineNumber: clipStr(item.engineNumber, 60),
        status,
        currentOdometerKm: toNum(item.currentOdometerKm),
        fastagBalancePaise: toNum(item.fastagBalancePaise),
        assignedDriverId: clipStr(item.assignedDriverId, 128),
        assignedDriverName: clipStr(item.assignedDriverName, 100),
        activeTripId: clipStr(item.activeTripId, 128),
        insuranceExpiry: clipStr(item.insuranceExpiry, 30),
        insurancePolicyNumber: clipStr(item.insurancePolicyNumber, 60),
        fitnessExpiry: clipStr(item.fitnessExpiry, 30),
        fitnessCertificateNumber: clipStr(item.fitnessCertificateNumber, 60),
        permitExpiry: clipStr(item.permitExpiry, 30),
        permitNumber: clipStr(item.permitNumber, 60),
        permitType: item.permitType === 'NATIONAL' || item.permitType === 'STATE' ? item.permitType : undefined,
        pucExpiry: clipStr(item.pucExpiry, 30),
        pucNumber: clipStr(item.pucNumber, 60),
        notes: clipStr(item.notes, 500),
        createdAt,
        updatedAt,
      });
    }

    case 'drivers': {
      const fullName =
        clipStr(item.fullName, 100) || clipStr(existingData?.fullName, 100);
      const phone = clipStr(item.phone, 20) || clipStr(existingData?.phone, 20);
      const licenseNumber =
        clipStr(item.licenseNumber, 40) || clipStr(existingData?.licenseNumber, 40);
      const status = VALID_DRIVER_STATUSES.includes(item.status) ? item.status : 'AVAILABLE';
      if (!fullName || !phone || !licenseNumber) return null;

      // Preserve existing unredacted PII if the payload received from REST was redacted for MANAGER/OPERATIONS
      const isMasked = (v: unknown) => typeof v === 'string' && v.includes('•');
      const aadharNumber = isMasked(item.aadharNumber)
        ? clipStr(existingData?.aadharNumber, 25)
        : clipStr(item.aadharNumber, 25) ?? clipStr(existingData?.aadharNumber, 25);
      const panNumber = isMasked(item.panNumber)
        ? clipStr(existingData?.panNumber, 15)
        : clipStr(item.panNumber, 15) ?? clipStr(existingData?.panNumber, 15);
      const bankAccount = isMasked(item.bankAccount)
        ? clipStr(existingData?.bankAccount, 40)
        : clipStr(item.bankAccount, 40) ?? clipStr(existingData?.bankAccount, 40);
      const bankIfsc = isMasked(item.bankIfsc)
        ? clipStr(existingData?.bankIfsc, 15)
        : clipStr(item.bankIfsc, 15) ?? clipStr(existingData?.bankIfsc, 15);
      const monthlySalaryPaise =
        item.isSensitiveDataRedacted && item.monthlySalaryPaise === undefined
          ? toNum(existingData?.monthlySalaryPaise)
          : toNum(item.monthlySalaryPaise);

      return stripUndefined({
        id: item.id,
        companyId,
        fullName,
        phone,
        altPhone: clipStr(item.altPhone, 20),
        licenseNumber,
        licenseExpiry: clipStr(item.licenseExpiry, 30),
        badgeNumber: clipStr(item.badgeNumber, 40),
        address: clipStr(item.address, 250),
        emergencyContact: clipStr(item.emergencyContact, 100),
        emergencyPhone: clipStr(item.emergencyPhone, 20),
        status,
        currentAdvanceBalancePaise: toNum(item.currentAdvanceBalancePaise),
        totalTripsCompleted: toNum(item.totalTripsCompleted),
        monthlySalaryPaise,
        perDayBataPaise: toNum(item.perDayBataPaise) ?? toNum(existingData?.perDayBataPaise),
        assignedVehicleId: clipStr(item.assignedVehicleId, 128),
        assignedVehicleReg: clipStr(item.assignedVehicleReg, 30),
        aadharNumber,
        panNumber,
        bankAccount,
        bankIfsc,
        bankName: clipStr(item.bankName, 80) ?? clipStr(existingData?.bankName, 80),
        bankBranch: clipStr(item.bankBranch, 80) ?? clipStr(existingData?.bankBranch, 80),
        isSensitiveDataRedacted:
          typeof item.isSensitiveDataRedacted === 'boolean'
            ? item.isSensitiveDataRedacted
            : typeof existingData?.isSensitiveDataRedacted === 'boolean'
            ? existingData.isSensitiveDataRedacted
            : undefined,
        joinedDate: clipStr(item.joinedDate, 30) ?? clipStr(existingData?.joinedDate, 30),
        createdAt,
        updatedAt,
      });
    }

    case 'customers': {
      const name = clipStr(item.name, 150);
      const phone = clipStr(item.phone, 20);
      const gstin = clipStr(item.gstin, 20);
      if (!name || !phone) return null;
      return stripUndefined({
        id: item.id,
        companyId,
        name,
        tradeName: clipStr(item.tradeName, 150),
        gstin,
        pan: clipStr(item.pan, 15),
        contactPerson: clipStr(item.contactPerson, 100),
        phone,
        email: clipStr(item.email, 200),
        billingAddress: clipStr(item.billingAddress, 300),
        city: clipStr(item.city, 80),
        state: clipStr(item.state, 60),
        stateCode: clipStr(item.stateCode, 5),
        pincode: clipStr(item.pincode, 10),
        creditPeriodDays: toNum(item.creditPeriodDays),
        paymentTermsDays: toNum(item.paymentTermsDays),
        creditLimitPaise: toNum(item.creditLimitPaise),
        currentOutstandingPaise: toNum(item.currentOutstandingPaise),
        totalFreightBilledPaise: toNum(item.totalFreightBilledPaise),
        notes: clipStr(item.notes, 500),
        status: VALID_CUSTOMER_STATUSES.includes(item.status) ? item.status : undefined,
        createdAt,
        updatedAt,
      });
    }

    case 'brokers': {
      const name = clipStr(item.name, 150);
      const phone = clipStr(item.phone, 20);
      if (!name || !phone) return null;
      return stripUndefined({
        id: item.id,
        companyId,
        name,
        companyName: clipStr(item.companyName, 150),
        phone,
        email: clipStr(item.email, 200),
        gstin: clipStr(item.gstin, 20),
        pan: clipStr(item.pan, 15),
        city: clipStr(item.city, 80),
        state: clipStr(item.state, 60),
        commissionRatePercent: toNum(item.commissionRatePercent),
        defaultCommissionPaise: toNum(item.defaultCommissionPaise),
        notes: clipStr(item.notes, 500),
        status: VALID_BROKER_STATUSES.includes(item.status) ? item.status : 'ACTIVE',
        createdAt,
        updatedAt,
      });
    }

    case 'trips': {
      // Preserve existing optional keys when omitted from a partial update payload,
      // while still allowing explicit clears (key in item with undefined/null/empty value).
      const pickTripStr = (key: string, maxLen: number): string | undefined =>
        key in item ? clipStr(item[key], maxLen) : clipStr(existingData?.[key], maxLen);
      const pickTripNum = (key: string): number | undefined =>
        key in item ? toNum(item[key]) : toNum(existingData?.[key]);
      const pickTripBool = (key: string): boolean | undefined =>
        key in item
          ? typeof item[key] === 'boolean'
            ? item[key]
            : undefined
          : typeof existingData?.[key] === 'boolean'
          ? existingData[key]
          : undefined;

      const tripNumber = pickTripStr('tripNumber', 120);
      const vehicleId = pickTripStr('vehicleId', 128);
      const driverId = pickTripStr('driverId', 128);
      const customerId = pickTripStr('customerId', 128);
      const status = VALID_TRIP_STATUSES.includes(item.status)
        ? item.status
        : VALID_TRIP_STATUSES.includes(existingData?.status)
        ? existingData!.status
        : 'PLANNED';

      const rawWeightTonnes = pickTripNum('weightTonnes');
      const weightTonnes = rawWeightTonnes !== undefined ? Math.max(0, rawWeightTonnes) : undefined;
      const rawFreight = pickTripNum('freightAmountPaise');
      const freightAmountPaise = rawFreight !== undefined ? Math.max(0, rawFreight) : undefined;
      const rawRevenue = pickTripNum('totalRevenuePaise');
      const totalRevenuePaise =
        rawRevenue !== undefined
          ? Math.max(0, rawRevenue)
          : freightAmountPaise !== undefined
          ? freightAmountPaise
          : undefined;

      // Preserve any extra frontend/dispatch fields while respecting explicit clears
      const extraTripFields: Record<string, any> = {};
      if (existingData) {
        for (const [k, v] of Object.entries(existingData)) {
          if (!(k in item)) {
            extraTripFields[k] = v;
          }
        }
      }
      for (const [k, v] of Object.entries(item)) {
        if (k !== 'createdAt' && k !== 'updatedAt' && k !== 'companyId' && k !== 'id') {
          extraTripFields[k] = v;
        }
      }

      return stripUndefined({
        ...extraTripFields,
        id: item.id,
        companyId,
        tripNumber,
        lrNumber: pickTripStr('lrNumber', 120),
        customerId,
        customerName: pickTripStr('customerName', 200),
        customerGstin: pickTripStr('customerGstin', 30),
        vehicleId,
        vehicleReg: pickTripStr('vehicleReg', 40),
        driverId,
        driverName: pickTripStr('driverName', 150),
        driverPhone: pickTripStr('driverPhone', 30),
        originCity: pickTripStr('originCity', 200),
        destinationCity: pickTripStr('destinationCity', 200),
        pickupAddress: pickTripStr('pickupAddress', 1000),
        deliveryAddress: pickTripStr('deliveryAddress', 1000),
        loadingDetails: pickTripStr('loadingDetails', 1000),
        unloadingDetails: pickTripStr('unloadingDetails', 1000),
        goodsType: pickTripStr('goodsType', 250),
        weightTonnes,
        ratePerTonnePaise: pickTripNum('ratePerTonnePaise'),
        freightAmountPaise,
        otherChargesPaise: pickTripNum('otherChargesPaise'),
        totalRevenuePaise,
        dispatchDate: pickTripStr('dispatchDate', 60),
        dispatchRemarks: pickTripStr('dispatchRemarks', 1000),
        expectedDeliveryDate: pickTripStr('expectedDeliveryDate', 60),
        actualDeliveryDate: pickTripStr('actualDeliveryDate', 60),
        status,
        startOdometerKm: pickTripNum('startOdometerKm'),
        endOdometerKm: pickTripNum('endOdometerKm'),
        podReceived: pickTripBool('podReceived'),
        podDocumentUrl: pickTripStr('podDocumentUrl', 2000),
        lrDocumentUrl: pickTripStr('lrDocumentUrl', 2000),
        dispatchDocumentUrl: pickTripStr('dispatchDocumentUrl', 2000),
        podRemarks: pickTripStr('podRemarks', 1000),
        brokerId: pickTripStr('brokerId', 128),
        brokerName: pickTripStr('brokerName', 200),
        brokerCommissionPaise: pickTripNum('brokerCommissionPaise'),
        totalExpensesPaise: pickTripNum('totalExpensesPaise'),
        totalAdvancesPaise: pickTripNum('totalAdvancesPaise'),
        tripContributionPaise: pickTripNum('tripContributionPaise'),
        isSettled: pickTripBool('isSettled'),
        isInvoiced: pickTripBool('isInvoiced'),
        invoiceId: pickTripStr('invoiceId', 128),
        invoiceNumber: pickTripStr('invoiceNumber', 80),
        cancellationReason: pickTripStr('cancellationReason', 1000),
        cancelledAt: pickTripStr('cancelledAt', 60),
        cancelledBy: pickTripStr('cancelledBy', 150),
        reopenedAt: pickTripStr('reopenedAt', 60),
        reopenedBy: pickTripStr('reopenedBy', 150),
        notes: pickTripStr('notes', 2000),
        createdBy: pickTripStr('createdBy', 150),
        eWayBillNumber: pickTripStr('eWayBillNumber', 60),
        routeDistanceKm: pickTripNum('routeDistanceKm'),
        createdAt,
        updatedAt,
      });
    }

    case 'expenses': {
      const tripId = clipStr(item.tripId, 128);
      const vehicleId = clipStr(item.vehicleId, 128);
      const category = VALID_EXPENSE_CATEGORIES.includes(item.category) ? item.category : 'OTHER';
      const paymentMode = VALID_EXPENSE_PAYMENT_MODES.includes(item.paymentMode) ? item.paymentMode : 'CASH';
      const amountPaise = toNum(item.amountPaise, 0) || 0;
      if (amountPaise <= 0 || (!tripId && !vehicleId)) return null;
      return stripUndefined({
        id: item.id,
        companyId,
        tripId,
        tripNumber: clipStr(item.tripNumber, 50),
        vehicleId,
        vehicleReg: clipStr(item.vehicleReg, 30),
        driverId: clipStr(item.driverId, 128),
        driverName: clipStr(item.driverName, 100),
        category,
        amountPaise,
        paymentMode,
        date: clipStr(item.date, 40),
        expenseDate: clipStr(item.expenseDate, 40),
        description: clipStr(item.description, 300),
        litres: toNum(item.litres),
        litresFuel: toNum(item.litresFuel),
        ratePerLitrePaise: toNum(item.ratePerLitrePaise),
        pumpName: clipStr(item.pumpName, 120),
        petrolPumpName: clipStr(item.petrolPumpName, 120),
        location: clipStr(item.location, 120),
        odometerReading: toNum(item.odometerReading),
        receiptNumber: clipStr(item.receiptNumber, 60),
        voucherNumber: clipStr(item.voucherNumber, 60),
        receiptUrl: clipStr(item.receiptUrl, 1500),
        receiptAttachmentUrl: clipStr(item.receiptAttachmentUrl, 1500),
        notes: clipStr(item.notes, 400),
        recordedBy: clipStr(item.recordedBy, 100),
        createdBy: clipStr(item.createdBy, 100),
        isDriverDisbursed: typeof item.isDriverDisbursed === 'boolean' ? item.isDriverDisbursed : undefined,
        isSettled: typeof item.isSettled === 'boolean' ? item.isSettled : undefined,
        settlementId: clipStr(item.settlementId, 128),
        createdAt,
        updatedAt,
      });
    }

    case 'advances': {
      const tripId = clipStr(item.tripId, 128);
      const driverId = clipStr(item.driverId, 128);
      const amountPaise = toNum(item.amountPaise, 0) || 0;
      const advanceType = VALID_ADVANCE_TYPES.includes(item.advanceType) ? item.advanceType : 'CASH_DISPATCH';
      const date = clipStr(item.date, 40) || new Date().toISOString().split('T')[0];
      const status =
        item.status === 'ACTIVE' || item.status === 'CANCELLED' || item.status === 'SETTLED'
          ? item.status
          : item.isSettled
          ? 'SETTLED'
          : 'ACTIVE';
      if (!driverId || amountPaise <= 0) return null;
      return stripUndefined({
        id: item.id,
        companyId,
        tripId,
        tripNumber: clipStr(item.tripNumber, 50),
        driverId,
        driverName: clipStr(item.driverName, 100),
        vehicleReg: clipStr(item.vehicleReg, 30),
        amountPaise,
        advanceType,
        paymentMode: clipStr(item.paymentMode, 30),
        date,
        reference: clipStr(item.reference, 100),
        referenceNotes: clipStr(item.referenceNotes, 300),
        notes: clipStr(item.notes, 300),
        disbursedBy: clipStr(item.disbursedBy, 100),
        status,
        cancelledAt: clipStr(item.cancelledAt, 40),
        cancellationReason: clipStr(item.cancellationReason, 300),
        cancelledBy: clipStr(item.cancelledBy, 100),
        isSettled: Boolean(item.isSettled),
        settlementId: clipStr(item.settlementId, 128),
        createdAt,
        updatedAt,
      });
    }

    case 'settlements': {
      const tripId = clipStr(item.tripId, 128);
      const driverId = clipStr(item.driverId, 128);
      const status = VALID_SETTLEMENT_STATUSES.includes(item.status) ? item.status : 'FINALIZED';
      const settledDate = clipStr(item.settledDate, 40) || new Date().toISOString().split('T')[0];
      const netPayableToDriverPaise = toNum(item.netPayableToDriverPaise, 0) ?? 0;
      if (!tripId || !driverId) return null;
      return stripUndefined({
        id: item.id,
        companyId,
        tripId,
        tripNumber: clipStr(item.tripNumber, 50),
        driverId,
        driverName: clipStr(item.driverName, 100),
        vehicleId: clipStr(item.vehicleId, 128),
        vehicleReg: clipStr(item.vehicleReg, 30),
        settlementNumber: clipStr(item.settlementNumber, 50),
        totalRevenuePaise: toNum(item.totalRevenuePaise),
        fuelExpensesPaise: toNum(item.fuelExpensesPaise),
        tollExpensesPaise: toNum(item.tollExpensesPaise),
        otherExpensesPaise: toNum(item.otherExpensesPaise),
        totalExpensesPaise: toNum(item.totalExpensesPaise),
        tripProfitLossPaise: toNum(item.tripProfitLossPaise),
        totalAdvanceGivenPaise: toNum(item.totalAdvanceGivenPaise),
        driverCashExpensesPaise: toNum(item.driverCashExpensesPaise),
        driverBataAllowancePaise: toNum(item.driverBataAllowancePaise),
        approvedDeductionsPaise: toNum(item.approvedDeductionsPaise),
        otherDeductionsPaise: toNum(item.otherDeductionsPaise),
        deductionReason: clipStr(item.deductionReason, 300),
        remainingDriverBalancePaise: toNum(item.remainingDriverBalancePaise),
        netPayableToDriverPaise,
        isCompanyDue: typeof item.isCompanyDue === 'boolean' ? item.isCompanyDue : undefined,
        status,
        settledDate,
        settledBy: clipStr(item.settledBy, 100),
        approvedBy: clipStr(item.approvedBy, 100),
        approvedAt: clipStr(item.approvedAt, 40),
        settlementNotes: clipStr(item.settlementNotes, 400),
        isCorrectionAuthorized: typeof item.isCorrectionAuthorized === 'boolean' ? item.isCorrectionAuthorized : undefined,
        correctionReason: clipStr(item.correctionReason, 300),
        correctedBy: clipStr(item.correctedBy, 100),
        correctedAt: clipStr(item.correctedAt, 40),
        createdAt,
        updatedAt,
      });
    }

    case 'invoices': {
      const invoiceNumber = clipStr(item.invoiceNumber, 50);
      const tripId = clipStr(item.tripId, 128);
      const customerId = clipStr(item.customerId, 128);
      const issueDate = clipStr(item.issueDate, 40) || new Date().toISOString().split('T')[0];
      const status = VALID_INVOICE_STATUSES.includes(item.status) ? item.status : 'ISSUED';
      const totalAmountPaise = Math.max(0, toNum(item.totalAmountPaise, 0) || 0);
      if (!invoiceNumber || !customerId) return null;
      return stripUndefined({
        id: item.id,
        companyId,
        invoiceNumber,
        tripId,
        tripNumber: clipStr(item.tripNumber, 50),
        lrNumber: clipStr(item.lrNumber, 50),
        customerId,
        customerName: clipStr(item.customerName, 150),
        customerGstin: clipStr(item.customerGstin, 20),
        billingAddress: clipStr(item.billingAddress, 300),
        originCity: clipStr(item.originCity, 100),
        destinationCity: clipStr(item.destinationCity, 100),
        vehicleReg: clipStr(item.vehicleReg, 30),
        goodsType: clipStr(item.goodsType, 120),
        weightTonnes: toNum(item.weightTonnes),
        ratePerTonnePaise: toNum(item.ratePerTonnePaise),
        hsnSacCode: clipStr(item.hsnSacCode, 15),
        issueDate,
        dueDate: clipStr(item.dueDate, 40),
        freightAmountPaise: toNum(item.freightAmountPaise),
        loadingChargesPaise: toNum(item.loadingChargesPaise),
        unloadingChargesPaise: toNum(item.unloadingChargesPaise),
        detentionChargesPaise: toNum(item.detentionChargesPaise),
        otherChargesPaise: toNum(item.otherChargesPaise),
        discountPaise: toNum(item.discountPaise),
        taxableAmountPaise: toNum(item.taxableAmountPaise),
        isRcmApplicable: typeof item.isRcmApplicable === 'boolean' ? item.isRcmApplicable : undefined,
        gstRatePercent: toNum(item.gstRatePercent),
        cgstRatePercent: toNum(item.cgstRatePercent),
        sgstRatePercent: toNum(item.sgstRatePercent),
        igstRatePercent: toNum(item.igstRatePercent),
        cgstAmountPaise: toNum(item.cgstAmountPaise),
        sgstAmountPaise: toNum(item.sgstAmountPaise),
        igstAmountPaise: toNum(item.igstAmountPaise),
        totalTaxPaise: toNum(item.totalTaxPaise),
        totalAmountPaise,
        amountPaidPaise: toNum(item.amountPaidPaise),
        balanceDuePaise: toNum(item.balanceDuePaise),
        status,
        paymentStatus: VALID_PAYMENT_STATUSES.includes(item.paymentStatus) ? item.paymentStatus : undefined,
        cancelledAt: clipStr(item.cancelledAt, 40),
        cancellationReason: clipStr(item.cancellationReason, 300),
        notes: clipStr(item.notes, 500),
        createdBy: clipStr(item.createdBy, 100),
        createdAt,
        updatedAt,
      });
    }

    case 'payments': {
      const invoiceId = clipStr(item.invoiceId, 128);
      const customerId = clipStr(item.customerId, 128);
      const amountPaise = toNum(item.amountPaise, 0) || 0;
      const paymentDate = clipStr(item.paymentDate, 40) || new Date().toISOString().split('T')[0];
      const paymentMode = VALID_PAYMENT_MODES.includes(item.paymentMode) ? item.paymentMode : 'NEFT_RTGS';
      const referenceNumber = clipStr(item.referenceNumber, 100);
      if (!invoiceId || !customerId || amountPaise <= 0 || !referenceNumber) return null;
      return stripUndefined({
        id: item.id,
        companyId,
        invoiceId,
        invoiceNumber: clipStr(item.invoiceNumber, 50),
        customerId,
        customerName: clipStr(item.customerName, 150),
        amountPaise,
        paymentDate,
        paymentMode,
        referenceNumber,
        tdsDeductedPaise: toNum(item.tdsDeductedPaise),
        bankAccount: clipStr(item.bankAccount, 80),
        recordedBy: clipStr(item.recordedBy, 100),
        notes: clipStr(item.notes, 400),
        createdAt,
        updatedAt,
      });
    }

    case 'documents': {
      const vehicleId = clipStr(item.vehicleId, 128);
      const docType = VALID_DOC_TYPES.includes(item.docType) ? item.docType : 'RC';
      const documentNumber = clipStr(item.documentNumber, 60);
      const expiryDate = clipStr(item.expiryDate, 40);
      const status = VALID_DOC_STATUSES.includes(item.status) ? item.status : 'VALID';
      if (!vehicleId || !documentNumber || !expiryDate) return null;
      return stripUndefined({
        id: item.id,
        companyId,
        vehicleId,
        vehicleReg: clipStr(item.vehicleReg, 30),
        docType,
        documentNumber,
        issuingAuthority: clipStr(item.issuingAuthority, 120),
        issueDate: clipStr(item.issueDate, 40),
        expiryDate,
        documentUrl: clipStr(item.documentUrl, 1500),
        daysUntilExpiry: toNum(item.daysUntilExpiry),
        status,
        createdAt,
        updatedAt,
      });
    }

    case 'maintenance': {
      const vehicleId = clipStr(item.vehicleId, 128);
      const serviceType = VALID_MAINTENANCE_TYPES.includes(item.serviceType) ? item.serviceType : 'SCHEDULED_SERVICE';
      const costPaise = Math.max(0, toNum(item.costPaise, 0) || 0);
      const serviceDate = clipStr(item.serviceDate, 40) || new Date().toISOString().split('T')[0];
      if (!vehicleId) return null;
      return stripUndefined({
        id: item.id,
        companyId,
        vehicleId,
        vehicleReg: clipStr(item.vehicleReg, 30),
        serviceType,
        garageName: clipStr(item.garageName, 120),
        costPaise,
        odometerReading: toNum(item.odometerReading),
        serviceDate,
        partsReplaced: clipStr(item.partsReplaced, 300),
        invoiceNumber: clipStr(item.invoiceNumber, 60),
        notes: clipStr(item.notes, 400),
        createdAt,
        updatedAt,
      });
    }

    case 'fileRecords': {
      const uploadedByUid = clipStr(item.uploadedByUid || item.uploadedBy || auth.currentUser?.uid, 128);
      const rawCat = item.category || item.folder;
      const folder: StorageFileCategory = VALID_STORAGE_FOLDERS.includes(rawCat) ? rawCat : 'documents';
      const fileName = clipStr(item.fileName, 250);
      const storagePath = clipStr(item.storagePath, 500);
      const downloadUrl = clipStr(item.downloadUrl || item.downloadURL, 2000);
      if (!uploadedByUid || !fileName || !storagePath || !downloadUrl) return null;
      const uploadedAt = isFirestoreTimestamp(existingData?.uploadedAt)
        ? existingData!.uploadedAt
        : isFirestoreTimestamp(item.uploadedAt)
        ? item.uploadedAt
        : createdAt;
      const sizeNum = toNum(item.fileSize ?? item.sizeBytes);
      return stripUndefined({
        id: item.id,
        fileId: clipStr(item.fileId, 128) || item.id,
        companyId,
        uploadedBy: uploadedByUid,
        uploadedByUid,
        uploadedByName: clipStr(item.uploadedByName, 100),
        folder,
        category: folder,
        fileName,
        originalFileName: clipStr(item.originalFileName, 250) || fileName,
        mimeType: clipStr(item.mimeType || item.contentType, 120),
        contentType: clipStr(item.contentType || item.mimeType, 120),
        sizeBytes: sizeNum,
        fileSize: sizeNum,
        storagePath,
        downloadUrl,
        downloadURL: downloadUrl,
        relatedRecordId: clipStr(item.relatedRecordId || item.entityId, 128),
        entityType: clipStr(item.entityType, 40),
        entityId: clipStr(item.entityId || item.relatedRecordId, 128),
        uploadedAt,
        createdAt,
        updatedAt,
      });
    }

    case 'settings': {
      return stripUndefined({
        id: item.id,
        companyId,
        defaultGstRatePercent: toNum(item.defaultGstRatePercent),
        defaultRcmEnabled: typeof item.defaultRcmEnabled === 'boolean' ? item.defaultRcmEnabled : undefined,
        defaultCreditPeriodDays: toNum(item.defaultCreditPeriodDays),
        defaultFuelUnit:
          item.defaultFuelUnit === 'LITRES' || item.defaultFuelUnit === 'GALLONS'
            ? item.defaultFuelUnit
            : undefined,
        lowFastagThresholdPaise: toNum(item.lowFastagThresholdPaise),
        expiryAlertDays: toNum(item.expiryAlertDays),
        autoGenerateLr: typeof item.autoGenerateLr === 'boolean' ? item.autoGenerateLr : undefined,
        currency: clipStr(item.currency, 10),
        updatedByUid: clipStr(item.updatedByUid || auth.currentUser?.uid, 128),
        createdAt,
        updatedAt,
      });
    }
  }
}

/**
 * Fetches /users/{uid} profile directly from Firestore
 */
export async function fetchUserDocFromFirestore(uid: string): Promise<FirestoreUserProfile | null> {
  if (!auth.currentUser || !isValidDocSegment(uid)) return null;
  const safeUid = uid.trim();
  const userPath = `users/${safeUid}`;
  try {
    const snap = await getDoc(doc(db, 'users', safeUid));
    if (!snap.exists()) return null;
    return normalizeTimestamps<FirestoreUserProfile>(snap.data());
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userPath);
  }
}

const ALLOWED_USER_DOC_KEYS = new Set([
  'id',
  'email',
  'name',
  'phone',
  'defaultCompanyId',
  'activeCompanyId',
  'role',
  'photoUrl',
  'onboardingCompleted',
  'onboardingCompletedAt',
  'createdAt',
  'updatedAt',
]);
const VALID_USER_ROLES: Array<UserRole | 'USER'> = ['USER', 'OWNER'];

function normalizeUserTimestampStr(val: unknown): string | undefined {
  if (typeof val === 'string') return clipStr(val, 40);
  if (val instanceof Timestamp) return clipStr(val.toDate().toISOString(), 40);
  if (val && typeof val === 'object' && typeof (val as any).toDate === 'function') {
    return clipStr((val as any).toDate().toISOString(), 40);
  }
  return undefined;
}

function userDocNeedsHealing(existingRaw: DocumentData, uid: string): boolean {
  const keys = Object.keys(existingRaw);
  if (keys.some((k) => !ALLOWED_USER_DOC_KEYS.has(k))) return true;
  if (existingRaw.id !== uid) return true;
  if (typeof existingRaw.email !== 'string' || !existingRaw.email.trim()) return true;
  if (typeof existingRaw.name !== 'string' || !existingRaw.name.trim()) return true;
  if (!isFirestoreTimestamp(existingRaw.createdAt)) return true;
  if (existingRaw.phone !== undefined && typeof existingRaw.phone !== 'string') return true;
  if (
    existingRaw.onboardingCompletedAt !== undefined &&
    typeof existingRaw.onboardingCompletedAt !== 'string'
  ) {
    return true;
  }
  if (existingRaw.role !== undefined && !VALID_USER_ROLES.includes(existingRaw.role)) {
    return true;
  }
  return false;
}

function buildSanitizedUserWritePayload(
  uid: string,
  fbUser: FirebaseUser | null,
  existingRaw: DocumentData | null | undefined,
  overrides: {
    name?: string;
    phone?: string;
    photoUrl?: string;
    defaultCompanyId?: string;
    activeCompanyId?: string;
    onboardingCompleted?: boolean;
    onboardingCompletedAt?: string;
  } = {}
): Record<string, any> {
  const existing = existingRaw || {};
  const fallbackEmail =
    clipStr((fbUser?.email || existing.email || '').toLowerCase(), 200) ||
    'user@anchortransport.in';
  const fallbackName =
    clipStr(
      overrides.name ??
        existing.name ??
        fbUser?.displayName ??
        fbUser?.email?.split('@')[0],
      100
    ) || 'Fleet Owner';

  const alreadyCompleted = existing.onboardingCompleted === true;
  const nextOnboardingCompleted = alreadyCompleted
    ? true
    : overrides.onboardingCompleted !== undefined
    ? Boolean(overrides.onboardingCompleted)
    : typeof existing.onboardingCompleted === 'boolean'
    ? existing.onboardingCompleted
    : false;

  const existingCompletedAt = normalizeUserTimestampStr(existing.onboardingCompletedAt);
  const nextCompletedAt =
    nextOnboardingCompleted === true
      ? existingCompletedAt ||
        clipStr(overrides.onboardingCompletedAt, 40) ||
        new Date().toISOString().slice(0, 40)
      : existingCompletedAt;

  const nextDefaultCompanyId =
    clipStr(overrides.defaultCompanyId, 128) ?? clipStr(existing.defaultCompanyId, 128);
  const nextActiveCompanyId =
    clipStr(overrides.activeCompanyId, 128) ?? clipStr(existing.activeCompanyId, 128);
  const nextPhone =
    overrides.phone !== undefined
      ? clipStr(overrides.phone, 20) || ''
      : clipStr(existing.phone, 20) ?? clipStr(fbUser?.phoneNumber, 20) ?? '';
  const nextPhotoUrl =
    overrides.photoUrl !== undefined
      ? clipStr(overrides.photoUrl, 1500)
      : clipStr(existing.photoUrl, 1500) ?? clipStr(fbUser?.photoURL, 1500);
  const preservedRole =
    typeof existing.role === 'string' && VALID_USER_ROLES.includes(existing.role as any)
      ? (existing.role as UserRole | 'USER')
      : 'OWNER';
  const nextRole: UserRole | 'USER' = preservedRole;

  return stripUndefined({
    id: uid,
    email: fallbackEmail,
    name: fallbackName,
    phone: nextPhone,
    defaultCompanyId: nextDefaultCompanyId,
    activeCompanyId: nextActiveCompanyId,
    role: nextRole,
    photoUrl: nextPhotoUrl,
    onboardingCompleted: nextOnboardingCompleted,
    onboardingCompletedAt: nextCompletedAt,
    createdAt: isFirestoreTimestamp(existing.createdAt) ? existing.createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Ensures /users/{uid} profile exists in Firestore and returns it
 */
export async function ensureFirestoreUserProfile(
  fbUser: FirebaseUser
): Promise<FirestoreUserProfile | null> {
  if (!auth.currentUser || !isValidDocSegment(fbUser?.uid)) return null;
  if (!isVerifiedEmailUser()) {
    // Security rules require email_verified == true to read/write /users/{uid}
    return {
      id: fbUser.uid,
      email: (fbUser.email || '').toLowerCase(),
      name: (fbUser.displayName || fbUser.email?.split('@')[0] || 'Fleet User').slice(0, 100),
      phone: fbUser.phoneNumber || '',
      onboardingCompleted: false,
    };
  }
  const userPath = `users/${fbUser.uid}`;
  const userRef = doc(db, 'users', fbUser.uid);

  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const existingRaw = snap.data();
      const existingProfile = normalizeTimestamps<FirestoreUserProfile>(existingRaw);
      const needsOnboardingBackfill =
        existingProfile.onboardingCompleted !== true &&
        Boolean(existingProfile.activeCompanyId || existingProfile.defaultCompanyId);
      const needsSchemaHeal = userDocNeedsHealing(existingRaw, fbUser.uid);

      // Legacy backfill & schema healing: write full sanitized user doc so unknown/null fields cannot block rules
      if (needsOnboardingBackfill || needsSchemaHeal) {
        const cleanDoc = buildSanitizedUserWritePayload(fbUser.uid, fbUser, existingRaw, {
          ...(needsOnboardingBackfill ? { onboardingCompleted: true } : {}),
        });
        await setDoc(userRef, cleanDoc);
        return {
          ...existingProfile,
          id: cleanDoc.id,
          email: cleanDoc.email,
          name: cleanDoc.name,
          phone: cleanDoc.phone,
          onboardingCompleted: cleanDoc.onboardingCompleted,
          onboardingCompletedAt: cleanDoc.onboardingCompletedAt,
        };
      }
      return existingProfile;
    }

    const newUserDoc = buildSanitizedUserWritePayload(fbUser.uid, fbUser, null, {
      onboardingCompleted: false,
    });

    await setDoc(userRef, newUserDoc);
    return {
      id: fbUser.uid,
      email: newUserDoc.email,
      name: newUserDoc.name,
      phone: newUserDoc.phone,
      photoUrl: fbUser.photoURL || undefined,
      onboardingCompleted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }
}

/**
 * Updates the current user's /users/{uid} profile in Firestore.
 * Enforces monotonic permanence: onboardingCompleted can never be reverted from true to false.
 */
export async function updateFirestoreUserProfile(
  uid: string,
  updates: {
    name?: string;
    phone?: string;
    photoUrl?: string;
    defaultCompanyId?: string;
    activeCompanyId?: string;
    onboardingCompleted?: boolean;
    onboardingCompletedAt?: string;
  }
): Promise<void> {
  if (!auth.currentUser || !isValidDocSegment(uid) || auth.currentUser.uid !== uid) return;
  if (!isVerifiedEmailUser()) return;

  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  try {
    let snap = await getAuthoritativeDocSnap(userRef);
    if (!snap.exists()) {
      await ensureFirestoreUserProfile(auth.currentUser);
      snap = await getAuthoritativeDocSnap(userRef);
    }
    if (!snap.exists()) return;
    const existingData = snap.data() || {};
    const cleanDoc = buildSanitizedUserWritePayload(uid, auth.currentUser, existingData, updates);

    if (isFirestoreTimestamp(existingData.createdAt)) {
      await updateDoc(userRef, buildServerPreservingUpdatePayload(existingData, cleanDoc));
    } else {
      await setDoc(userRef, cleanDoc);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, userPath);
  }
}

/**
 * Resolves companies owned by a UID via Firestore query (used if user doc lacks company reference)
 */
export async function listOwnedCompaniesFromFirestore(uid: string): Promise<Company[]> {
  if (!auth.currentUser || !isValidDocSegment(uid)) return [];
  const path = 'companies';
  try {
    const q = query(collection(db, 'companies'), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => normalizeTimestamps<Company>({ id: d.id, ...d.data() }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

/**
 * Fetches company profile and resolves authorized user's role (OWNER or active Member)
 */
export async function fetchUserCompanyFromFirestore(
  companyId: string,
  uid: string
): Promise<{ company: Company; role: UserRole } | null> {
  if (!auth.currentUser || !isValidDocSegment(companyId) || !isValidDocSegment(uid)) return null;
  const safeCompanyId = companyId.trim();
  const safeUid = uid.trim();
  const companyPath = `companies/${safeCompanyId}`;

  try {
    const companySnap = await getDoc(doc(db, 'companies', safeCompanyId));
    if (!companySnap.exists()) return null;

    const company = normalizeTimestamps<Company>({ id: companySnap.id, ...companySnap.data() });
    const role = await resolveCompanyRoleInFirestore(safeCompanyId, safeUid);
    if (!role) {
      return null;
    }

    return { company, role };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, companyPath);
  }
}

/**
 * Fetches members of a company from /companies/{companyId}/members
 */
export async function fetchCompanyMembersFromFirestore(
  companyId: string
): Promise<FirestoreCompanyMember[]> {
  if (!auth.currentUser || !isValidDocSegment(companyId)) return [];
  const safeCompanyId = companyId.trim();
  const path = `companies/${safeCompanyId}/members`;
  try {
    const q = query(
      collection(db, 'companies', safeCompanyId, 'members'),
      where('companyId', '==', safeCompanyId)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) =>
      normalizeTimestamps<FirestoreCompanyMember>({ id: d.id, ...d.data() })
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

/**
 * Updates only the company owner's own /companies/{companyId}/members/{ownerUid} record.
 * Employee/staff member provisioning is disabled in Owner-Only mode.
 */
export async function saveCompanyMemberInFirestore(
  companyId: string,
  member: Omit<FirestoreCompanyMember, 'companyId'> & { userId: string }
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  if (!isValidDocSegment(member?.userId)) {
    throw new Error('Valid owner UID is required.');
  }
  const safeMemberUid = member.userId.trim();
  if (safeMemberUid !== auth.currentUser?.uid) {
    throw new Error('Staff and employee member management is disabled in Owner-Only mode.');
  }
  const path = `companies/${safeCompanyId}/members/${safeMemberUid}`;
  const ref = doc(db, 'companies', safeCompanyId, 'members', safeMemberUid);

  try {
    const existingSnap = await getAuthoritativeDocSnap(ref);
    const existingData = existingSnap.exists() ? existingSnap.data() : null;
    const email = clipStr(member.email, 200)?.toLowerCase();
    if (!email) {
      throw new Error('Owner email address is required.');
    }

    const payload = stripUndefined({
      id: safeMemberUid,
      userId: safeMemberUid,
      companyId: safeCompanyId,
      role: 'OWNER' as UserRole,
      name: clipStr(member.name, 100),
      email,
      status: 'ACTIVE' as const,
      invitedByUid: clipStr(member.invitedByUid || auth.currentUser?.uid, 128),
      joinedAt: clipStr(member.joinedAt, 40),
      createdAt: isFirestoreTimestamp(existingData?.createdAt)
        ? existingData!.createdAt
        : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (existingData && isFirestoreTimestamp(existingData.createdAt)) {
      await updateDoc(ref, buildServerPreservingUpdatePayload(existingData, payload));
    } else {
      await setDoc(ref, payload);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function removeCompanyMemberInFirestore(
  _companyId: string,
  _memberUid: string
): Promise<void> {
  throw new Error('Removing company owner or managing staff members is disabled in Owner-Only mode.');
}

/**
 * Atomically creates Company owned by fbUser + updates User's defaultCompanyId/activeCompanyId
 */
export async function createCompanyInFirestoreAtomic(
  company: Company & { fleetSize?: string },
  fbUser: FirebaseUser
): Promise<void> {
  if (
    !auth.currentUser ||
    !isVerifiedEmailUser() ||
    !isValidDocSegment(company?.id) ||
    !isValidDocSegment(fbUser?.uid)
  ) {
    return;
  }
  const companyPath = `companies/${company.id}`;

  try {
    await ensureFirestoreUserProfile(fbUser);

    const companyRef = doc(db, 'companies', company.id);
    const existingCompanySnap = await getDoc(companyRef);
    const companyExists = existingCompanySnap.exists();

    if (companyExists) {
      const existingCompanyData = existingCompanySnap.data() || {};
      if (existingCompanyData.ownerId && existingCompanyData.ownerId !== fbUser.uid) {
        return;
      }
      await updateFirestoreUserProfile(fbUser.uid, {
        defaultCompanyId: company.id,
        activeCompanyId: company.id,
        onboardingCompleted: true,
      });
      return;
    }

    const userSnap = await getDoc(doc(db, 'users', fbUser.uid));
    const userExisting = userSnap.data() || {};

    const batch = writeBatch(db);

    const companyPayload = stripUndefined({
      id: company.id,
      name: clipStr(company.name, 150) || 'Transport Company',
      tradeName: clipStr(company.tradeName || company.name, 150),
      gstin: clipStr(company.gstin, 15),
      pan: clipStr(company.pan, 10),
      phone: clipStr(company.phone, 25),
      email: clipStr(company.email, 200),
      address: clipStr(company.address, 300),
      city: clipStr(company.city, 80),
      state: clipStr(company.state, 60),
      stateCode: clipStr(company.stateCode, 5),
      pincode: clipStr(company.pincode, 10),
      bankName: clipStr(company.bankName, 100),
      accountNumber: clipStr(company.accountNumber, 40),
      ifscCode: clipStr(company.ifscCode, 15),
      branch: clipStr(company.branch, 100),
      lrPrefix: clipStr(company.lrPrefix, 30),
      invoicePrefix: clipStr(company.invoicePrefix, 30),
      tripPrefix: clipStr(company.tripPrefix, 30),
      fleetSize: clipStr(company.fleetSize, 50),
      logoUrl: clipStr(company.logoUrl, 1500),
      ownerId: fbUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(companyRef, companyPayload);

    // Bootstrap OWNER member document atomically with company creation
    const memberRef = doc(db, 'companies', company.id, 'members', fbUser.uid);
    const ownerMemberPayload = stripUndefined({
      id: fbUser.uid,
      userId: fbUser.uid,
      companyId: company.id,
      role: 'OWNER',
      name: clipStr(userExisting.name || fbUser.displayName, 100) || 'Company Owner',
      email: clipStr((fbUser.email || userExisting.email || '').toLowerCase(), 200) || 'owner@anchortransport.in',
      status: 'ACTIVE',
      joinedAt: new Date().toISOString().slice(0, 40),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(memberRef, ownerMemberPayload);

    const userRef = doc(db, 'users', fbUser.uid);
    const sanitizedUserDoc = buildSanitizedUserWritePayload(fbUser.uid, fbUser, userExisting, {
      defaultCompanyId: company.id,
      activeCompanyId: company.id,
      onboardingCompleted: true,
    });
    batch.set(userRef, sanitizedUserDoc);

    await batch.commit();

    // Seed default operational settings once the company document exists
    try {
      const settingsRef = doc(db, 'companies', company.id, 'settings', 'default');
      const settingsSnap = await getDoc(settingsRef);
      if (!settingsSnap.exists()) {
        await setDoc(
          settingsRef,
          stripUndefined({
            id: 'default',
            companyId: company.id,
            defaultGstRatePercent: 5,
            defaultRcmEnabled: true,
            defaultCreditPeriodDays: 30,
            defaultFuelUnit: 'LITRES',
            lowFastagThresholdPaise: 100000,
            expiryAlertDays: 30,
            autoGenerateLr: true,
            currency: 'INR',
            updatedByUid: fbUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }
    } catch {
      // Non-fatal if settings seed is deferred
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, companyPath);
  }
}

/**
 * Updates existing company profile in Firestore
 */
export async function updateCompanyInFirestore(
  company: Company & { ownerId?: string; fleetSize?: string }
): Promise<void> {
  if (!auth.currentUser || !isValidDocSegment(company?.id) || !isVerifiedEmailUser()) return;
  const companyPath = `companies/${company.id}`;
  const companyRef = doc(db, 'companies', company.id);

  try {
    const snap = await getAuthoritativeDocSnap(companyRef);
    if (!snap.exists()) return;
    const existingData = snap.data();

    const pickOptStr = (key: keyof Company | 'fleetSize', maxLen: number) =>
      Object.prototype.hasOwnProperty.call(company, key)
        ? clipStr((company as any)[key], maxLen)
        : clipStr(existingData[key as string], maxLen);

    const payload = stripUndefined({
      id: company.id,
      name: clipStr(company.name, 150) || clipStr(existingData.name, 150) || 'Transport Company',
      tradeName: pickOptStr('tradeName', 150),
      gstin: pickOptStr('gstin', 15),
      pan: pickOptStr('pan', 10),
      phone: pickOptStr('phone', 25),
      email: pickOptStr('email', 200),
      address: pickOptStr('address', 300),
      city: pickOptStr('city', 80),
      state: pickOptStr('state', 60),
      stateCode: pickOptStr('stateCode', 5),
      pincode: pickOptStr('pincode', 10),
      bankName: pickOptStr('bankName', 100),
      accountNumber: pickOptStr('accountNumber', 40),
      ifscCode: pickOptStr('ifscCode', 15),
      branch: pickOptStr('branch', 100),
      lrPrefix: pickOptStr('lrPrefix', 30),
      invoicePrefix: pickOptStr('invoicePrefix', 30),
      tripPrefix: pickOptStr('tripPrefix', 30),
      fleetSize: pickOptStr('fleetSize', 50),
      logoUrl: pickOptStr('logoUrl', 1500),
      ownerId: existingData.ownerId || auth.currentUser.uid,
      createdAt: isFirestoreTimestamp(existingData.createdAt)
        ? existingData.createdAt
        : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (isFirestoreTimestamp(existingData.createdAt)) {
      await updateDoc(companyRef, buildServerPreservingUpdatePayload(existingData, payload));
    } else {
      await setDoc(companyRef, payload);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, companyPath);
  }
}

export type CompanySubcollection =
  | 'vehicles'
  | 'drivers'
  | 'customers'
  | 'brokers'
  | 'trips'
  | 'expenses'
  | 'advances'
  | 'settlements'
  | 'invoices'
  | 'payments'
  | 'documents'
  | 'maintenance'
  | 'fileRecords'
  | 'settings';

export class FirestoreTMSClient {
  private companyId: string;
  private membershipVerified = false;

  constructor(companyId: string) {
    if (!isValidDocSegment(companyId)) {
      throw new Error('Valid Company ID is required to instantiate FirestoreTMSClient');
    }
    this.companyId = companyId.trim();
  }

  private async ensureActiveAccess(): Promise<boolean> {
    if (!auth.currentUser) return false;
    if (this.membershipVerified) return true;
    const allowed = await hasActiveCompanyMembershipInFirestore(this.companyId);
    if (allowed) {
      this.membershipVerified = true;
    }
    return allowed;
  }

  private async upsertDoc<T extends { id: string }>(
    subcollection: CompanySubcollection,
    item: T
  ): Promise<void> {
    if (!auth.currentUser || !isValidDocSegment(item?.id)) return;
    if (!isVerifiedEmailUser()) {
      console.warn(`Skipped Firestore write (${subcollection}/${item.id}) until email is verified.`);
      return;
    }
    if (!(await this.ensureActiveAccess())) return;

    const safeDocId = item.id.trim();
    const path = `companies/${this.companyId}/${subcollection}/${safeDocId}`;
    const ref = doc(db, 'companies', this.companyId, subcollection, safeDocId);

    try {
      const existingSnap = await getAuthoritativeDocSnap(ref);
      const existingData = existingSnap.exists() ? existingSnap.data() : null;

      const payload = sanitizeSubcollectionPayload(
        subcollection,
        this.companyId,
        item as Record<string, any>,
        existingData
      );
      if (!payload) return;

      if (existingData && isFirestoreTimestamp(existingData.createdAt)) {
        await updateDoc(ref, buildServerPreservingUpdatePayload(existingData, payload));
      } else {
        await setDoc(ref, payload);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }

  private async removeDoc(subcollection: CompanySubcollection, docId: string): Promise<void> {
    if (!auth.currentUser || !isValidDocSegment(docId)) return;
    if (!isVerifiedEmailUser()) {
      console.warn(`Skipped Firestore delete (${subcollection}/${docId}) until email is verified.`);
      return;
    }
    if (!(await this.ensureActiveAccess())) return;

    const safeDocId = docId.trim();
    const path = `companies/${this.companyId}/${subcollection}/${safeDocId}`;
    try {
      await deleteDoc(doc(db, 'companies', this.companyId, subcollection, safeDocId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }

  private async listCollection<T>(subcollection: CompanySubcollection): Promise<T[]> {
    if (!auth.currentUser) return [];
    if (!(await this.ensureActiveAccess())) return [];

    const path = `companies/${this.companyId}/${subcollection}`;
    try {
      const q = query(
        collection(db, 'companies', this.companyId, subcollection),
        where('companyId', '==', this.companyId)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => normalizeTimestamps<T>({ id: d.id, ...d.data() }));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  }

  // Vehicles
  getVehicles = () => this.listCollection<Vehicle>('vehicles');
  saveVehicle = (vehicle: Vehicle) => this.upsertDoc('vehicles', vehicle);
  deleteVehicle = (vehicleId: string) => this.removeDoc('vehicles', vehicleId);

  // Drivers
  getDrivers = () => this.listCollection<Driver>('drivers');
  saveDriver = (driver: Driver) => this.upsertDoc('drivers', driver);
  deleteDriver = (driverId: string) => this.removeDoc('drivers', driverId);

  // Customers
  getCustomers = () => this.listCollection<Customer>('customers');
  saveCustomer = (customer: Customer) => this.upsertDoc('customers', customer);
  deleteCustomer = (customerId: string) => this.removeDoc('customers', customerId);

  // Brokers
  getBrokers = () => this.listCollection<Broker>('brokers');
  saveBroker = (broker: Broker) => this.upsertDoc('brokers', broker);
  deleteBroker = (brokerId: string) => this.removeDoc('brokers', brokerId);

  // Trips
  getTrips = () => this.listCollection<Trip>('trips');
  saveTrip = (trip: Trip) => this.upsertDoc('trips', trip);
  deleteTrip = (tripId: string) => this.removeDoc('trips', tripId);

  // Expenses
  getExpenses = () => this.listCollection<TripExpense>('expenses');
  saveExpense = (expense: TripExpense) => this.upsertDoc('expenses', expense);
  deleteExpense = (expenseId: string) => this.removeDoc('expenses', expenseId);

  // Advances
  getAdvances = () => this.listCollection<DriverAdvance>('advances');
  saveAdvance = (advance: DriverAdvance) => this.upsertDoc('advances', advance);
  deleteAdvance = (advanceId: string) => this.removeDoc('advances', advanceId);

  // Settlements
  getSettlements = () => this.listCollection<TripSettlement>('settlements');
  saveSettlement = (settlement: TripSettlement) => this.upsertDoc('settlements', settlement);
  deleteSettlement = (settlementId: string) => this.removeDoc('settlements', settlementId);

  // Invoices
  getInvoices = () => this.listCollection<Invoice>('invoices');
  saveInvoice = (invoice: Invoice) => this.upsertDoc('invoices', invoice);
  deleteInvoice = (invoiceId: string) => this.removeDoc('invoices', invoiceId);

  // Payments
  getPayments = () => this.listCollection<Payment>('payments');
  savePayment = (payment: Payment) => this.upsertDoc('payments', payment);
  deletePayment = (paymentId: string) => this.removeDoc('payments', paymentId);

  // Vehicle Compliance Documents
  getDocuments = () => this.listCollection<VehicleDocument>('documents');
  saveDocument = (docItem: VehicleDocument) => this.upsertDoc('documents', docItem);
  deleteDocument = (docId: string) => this.removeDoc('documents', docId);

  // Maintenance
  getMaintenance = () => this.listCollection<MaintenanceRecord>('maintenance');
  saveMaintenance = (rec: MaintenanceRecord) => this.upsertDoc('maintenance', rec);
  deleteMaintenance = (recId: string) => this.removeDoc('maintenance', recId);

  // Uploaded File Records
  getFileRecords = () => this.listCollection<FileRecord>('fileRecords');
  saveFileRecord = (rec: FileRecord) => this.upsertDoc('fileRecords', rec);
  deleteFileRecord = (fileId: string) => this.removeDoc('fileRecords', fileId);

  // Company Settings
  getSettings = () => this.listCollection<CompanySettings>('settings');
  saveSettings = (settingsDoc: CompanySettings) => this.upsertDoc('settings', settingsDoc);

  // Immutable Audit Logs
  async createAuditLog(log: Omit<AuditLog, 'companyId'>): Promise<void> {
    if (!auth.currentUser || !isVerifiedEmailUser() || !isValidDocSegment(log?.id)) return;
    if (!(await this.ensureActiveAccess())) return;
    const safeLogId = log.id.trim();
    const path = `companies/${this.companyId}/auditLogs/${safeLogId}`;
    try {
      const payload = stripUndefined({
        id: safeLogId,
        companyId: this.companyId,
        userId: auth.currentUser.uid,
        userName: clipStr((log as any).userName, 100),
        action: log.action,
        entityType: log.entityType,
        entityId: clipStr(log.entityId, 128) || 'system',
        moduleName: clipStr(log.moduleName, 60),
        summary: clipStr(log.summary, 500) || 'Action logged',
        previousValues: sanitizeAuditValueMap(log.previousValues),
        updatedValues: sanitizeAuditValueMap(log.updatedValues),
        timestamp: serverTimestamp(),
      });
      await setDoc(doc(db, 'companies', this.companyId, 'auditLogs', safeLogId), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }

  /**
   * Hydrates all operational collections from Firestore for the active company
   */
  async hydrateAll(): Promise<HydratedCompanyBundle> {
    const [
      vehicles,
      drivers,
      customers,
      brokers,
      trips,
      expenses,
      advances,
      settlements,
      invoices,
      payments,
      documents,
      maintenance,
      fileRecords,
      settingsList,
    ] = await Promise.all([
      this.getVehicles(),
      this.getDrivers(),
      this.getCustomers(),
      this.getBrokers(),
      this.getTrips(),
      this.getExpenses(),
      this.getAdvances(),
      this.getSettlements(),
      this.getInvoices(),
      this.getPayments(),
      this.getDocuments(),
      this.getMaintenance(),
      this.getFileRecords(),
      this.getSettings(),
    ]);

    return {
      vehicles,
      drivers,
      customers,
      brokers,
      trips,
      expenses,
      advances,
      settlements,
      invoices,
      payments,
      documents,
      maintenance,
      fileRecords,
      settings: settingsList.find((s) => s.id === 'default') || settingsList[0] || null,
    };
  }
}

/**
 * Deletes all docs in specified subcollections for a company in chunks <= 8 ops
 */
async function deleteSubcollectionsInChunks(
  companyId: string,
  subcollections: CompanySubcollection[]
): Promise<void> {
  if (!auth.currentUser || !isVerifiedEmailUser() || !isValidDocSegment(companyId)) return;
  if (!(await hasActiveCompanyMembershipInFirestore(companyId))) return;

  const refsToDelete: DocumentReference<DocumentData>[] = [];
  for (const sub of subcollections) {
    const path = `companies/${companyId}/${sub}`;
    try {
      const q = query(
        collection(db, 'companies', companyId, sub),
        where('companyId', '==', companyId)
      );
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        if (sub === 'trips') {
          try {
            const logsSnap = await getDocs(
              query(
                collection(db, 'companies', companyId, 'trips', d.id, 'trip_logs'),
                where('companyId', '==', companyId)
              )
            );
            for (const logDoc of logsSnap.docs) {
              refsToDelete.push(logDoc.ref);
            }
          } catch {
            // Continue deleting parent trip if trip_logs is empty or unavailable
          }
        }
        refsToDelete.push(d.ref);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  }

  const CHUNK_SIZE = 8;
  for (let i = 0; i < refsToDelete.length; i += CHUNK_SIZE) {
    const chunk = refsToDelete.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const ref of chunk) {
      batch.delete(ref);
    }
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `companies/${companyId}`);
    }
  }
}

/**
 * Clears all operational collections in Firestore for a company (full reset)
 */
export async function clearCompanyOperationalDataInFirestore(companyId?: string | null): Promise<void> {
  if (!auth.currentUser || !isVerifiedEmailUser() || !companyId) return;
  await deleteSubcollectionsInChunks(companyId, [
    'payments',
    'invoices',
    'settlements',
    'advances',
    'expenses',
    'trips',
    'documents',
    'maintenance',
    'vehicles',
    'drivers',
    'customers',
    'brokers',
    'fileRecords',
  ]);
}

/**
 * Clears trips, expenses, advances, settlements, invoices in Firestore and syncs reset vehicles/drivers
 */
export async function clearCompanyTripsDataInFirestore(
  companyId?: string | null,
  resetVehicles: Vehicle[] = [],
  resetDrivers: Driver[] = []
): Promise<void> {
  if (!auth.currentUser || !isVerifiedEmailUser() || !companyId) return;
  await deleteSubcollectionsInChunks(companyId, [
    'invoices',
    'settlements',
    'advances',
    'expenses',
    'trips',
  ]);

  const client = new FirestoreTMSClient(companyId);
  await Promise.all([
    ...resetVehicles.map((v) => client.saveVehicle(v)),
    ...resetDrivers.map((d) => client.saveDriver(d)),
  ]);
}

/**
 * Persists a full operational bundle from local/server store into Firestore (e.g. post verification)
 */
export async function syncBundleToFirestore(
  companyId: string | undefined | null,
  bundle: Partial<HydratedCompanyBundle>
): Promise<void> {
  if (!auth.currentUser || !isVerifiedEmailUser() || !companyId) return;
  const client = new FirestoreTMSClient(companyId);
  const ops: Promise<void>[] = [];

  (bundle.customers || []).forEach((c) => ops.push(client.saveCustomer(c)));
  (bundle.brokers || []).forEach((b) => ops.push(client.saveBroker(b)));
  (bundle.vehicles || []).forEach((v) => ops.push(client.saveVehicle(v)));
  (bundle.drivers || []).forEach((d) => ops.push(client.saveDriver(d)));
  (bundle.documents || []).forEach((docItem) => ops.push(client.saveDocument(docItem)));
  (bundle.trips || []).forEach((t) => ops.push(client.saveTrip(t)));
  (bundle.expenses || []).forEach((e) => ops.push(client.saveExpense(e)));
  (bundle.advances || []).forEach((a) => ops.push(client.saveAdvance(a)));
  (bundle.settlements || []).forEach((s) => ops.push(client.saveSettlement(s)));
  (bundle.invoices || []).forEach((i) => ops.push(client.saveInvoice(i)));
  (bundle.payments || []).forEach((p) => ops.push(client.savePayment(p)));
  (bundle.fileRecords || []).forEach((f) => ops.push(client.saveFileRecord(f)));
  if (bundle.settings) {
    ops.push(client.saveSettings(bundle.settings));
  }

  await Promise.all(ops);
}

/**
 * Convenience helper for modals/views to persist an entity when Firebase Auth is active
 */
export async function syncEntityToFirestore<T extends { id: string }>(
  companyId: string | undefined | null,
  subcollection: CompanySubcollection,
  item: T | null | undefined
): Promise<void> {
  if (!auth.currentUser || !companyId || !item || !item.id) return;
  const client = new FirestoreTMSClient(companyId);
  switch (subcollection) {
    case 'vehicles':
      return client.saveVehicle(item as unknown as Vehicle);
    case 'drivers':
      return client.saveDriver(item as unknown as Driver);
    case 'customers':
      return client.saveCustomer(item as unknown as Customer);
    case 'brokers':
      return client.saveBroker(item as unknown as Broker);
    case 'trips':
      return client.saveTrip(item as unknown as Trip);
    case 'expenses':
      return client.saveExpense(item as unknown as TripExpense);
    case 'advances':
      return client.saveAdvance(item as unknown as DriverAdvance);
    case 'settlements':
      return client.saveSettlement(item as unknown as TripSettlement);
    case 'invoices':
      return client.saveInvoice(item as unknown as Invoice);
    case 'payments':
      return client.savePayment(item as unknown as Payment);
    case 'documents':
      return client.saveDocument(item as unknown as VehicleDocument);
    case 'maintenance':
      return client.saveMaintenance(item as unknown as MaintenanceRecord);
    case 'fileRecords':
      return client.saveFileRecord(item as unknown as FileRecord);
    case 'settings':
      return client.saveSettings(item as unknown as CompanySettings);
  }
}

export async function deleteEntityFromFirestore(
  companyId: string | undefined | null,
  subcollection:
    | 'vehicles'
    | 'drivers'
    | 'customers'
    | 'brokers'
    | 'trips'
    | 'expenses'
    | 'documents'
    | 'maintenance'
    | 'fileRecords',
  docId: string
): Promise<void> {
  if (!auth.currentUser || !companyId || !docId) return;
  const client = new FirestoreTMSClient(companyId);
  switch (subcollection) {
    case 'vehicles':
      return client.deleteVehicle(docId);
    case 'drivers':
      return client.deleteDriver(docId);
    case 'customers':
      return client.deleteCustomer(docId);
    case 'brokers':
      return client.deleteBroker(docId);
    case 'trips':
      return client.deleteTrip(docId);
    case 'expenses':
      return client.deleteExpense(docId);
    case 'documents':
      return client.deleteDocument(docId);
    case 'maintenance':
      return client.deleteMaintenance(docId);
    case 'fileRecords':
      return client.deleteFileRecord(docId);
  }
}

/**
 * Resolves all companies a signed-in user belongs to via Firestore (owned + user doc refs)
 */
export async function listAccessibleCompaniesForUserFromFirestore(
  uid: string,
  userDoc?: FirestoreUserProfile | null
): Promise<Array<{ companyId: string; companyName: string; role: UserRole; company: Company }>> {
  if (!auth.currentUser || !isValidDocSegment(uid)) return [];
  const candidateIds = new Set<string>();

  if (isValidDocSegment(userDoc?.activeCompanyId)) {
    candidateIds.add(userDoc!.activeCompanyId!.trim());
  }
  if (isValidDocSegment(userDoc?.defaultCompanyId)) {
    candidateIds.add(userDoc!.defaultCompanyId!.trim());
  }

  try {
    const owned = await listOwnedCompaniesFromFirestore(uid);
    for (const c of owned) {
      if (isValidDocSegment(c.id)) candidateIds.add(c.id.trim());
    }
  } catch {
    // Ignore if query fails
  }

  const results: Array<{ companyId: string; companyName: string; role: UserRole; company: Company }> = [];
  for (const cid of candidateIds) {
    try {
      const res = await fetchUserCompanyFromFirestore(cid, uid);
      if (res?.company) {
        results.push({
          companyId: res.company.id,
          companyName: res.company.name,
          role: res.role,
          company: res.company,
        });
      }
    } catch {
      // Skip inaccessible company
    }
  }
  return results;
}

export interface CompanyRealtimeCallbacks {
  onCompany: (company: Company | null) => void;
  onMembers: (members: FirestoreCompanyMember[]) => void;
  onVehicles: (items: Vehicle[]) => void;
  onDrivers: (items: Driver[]) => void;
  onCustomers: (items: Customer[]) => void;
  onBrokers?: (items: Broker[]) => void;
  onTrips: (items: Trip[]) => void;
  onExpenses: (items: TripExpense[]) => void;
  onAdvances: (items: DriverAdvance[]) => void;
  onSettlements: (items: TripSettlement[]) => void;
  onInvoices: (items: Invoice[]) => void;
  onPayments: (items: Payment[]) => void;
  onDocuments: (items: VehicleDocument[]) => void;
  onMaintenance: (items: MaintenanceRecord[]) => void;
  onFileRecords?: (items: FileRecord[]) => void;
  onSettings?: (settings: CompanySettings | null) => void;
  onAuditLogs: (items: AuditLog[]) => void;
  onInitialLoadComplete?: () => void;
}

/**
 * Subscribes to live Firestore onSnapshot updates for all authorized company data.
 * Returns a synchronous unsubscribeAll() cleanup function that stops every active listener.
 */
export function subscribeToCompanyOperationalData(
  companyId: string,
  _role: UserRole | null,
  callbacks: CompanyRealtimeCallbacks,
  onError: (err: Error) => void
): () => void {
  if (!auth.currentUser || !isValidDocSegment(companyId)) {
    callbacks.onInitialLoadComplete?.();
    return () => {};
  }

  const safeCompanyId = companyId.trim();
  const unsubs: Unsubscribe[] = [];
  let cancelled = false;
  let completedCollections = 0;
  let initialFired = false;

  const totalCollections = 17; // company + members + 14 subcollections + auditLogs

  const markCollectionLoaded = () => {
    completedCollections += 1;
    if (!initialFired && completedCollections >= totalCollections) {
      initialFired = true;
      callbacks.onInitialLoadComplete?.();
    }
  };

  const reportError = (err: unknown, path: string, op: OperationType) => {
    if (cancelled) return;
    try {
      handleFirestoreError(err, op, path);
    } catch (wrapped: any) {
      onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
    }
    markCollectionLoaded();
  };

  resolveCompanyRoleInFirestore(safeCompanyId)
    .then((resolvedRole) => {
      if (cancelled) return;
      if (!resolvedRole) {
        onError(new Error('Authorized company membership or ownership is required to read company records.'));
        callbacks.onInitialLoadComplete?.();
        return;
      }

      // 1. Company document
      unsubs.push(
        onSnapshot(
          doc(db, 'companies', safeCompanyId),
          (snap) => {
            if (cancelled) return;
            callbacks.onCompany(snap.exists() ? normalizeTimestamps<Company>({ id: snap.id, ...snap.data() }) : null);
            markCollectionLoaded();
          },
          (err) => reportError(err, `companies/${safeCompanyId}`, OperationType.GET)
        )
      );

      // 2. Members subcollection
      const membersPath = `companies/${safeCompanyId}/members`;
      const membersQ = query(
        collection(db, 'companies', safeCompanyId, 'members'),
        where('companyId', '==', safeCompanyId)
      );
      unsubs.push(
        onSnapshot(
          membersQ,
          (snap) => {
            if (cancelled) return;
            const membersList = snap.docs.map((d) =>
              normalizeTimestamps<FirestoreCompanyMember>({ id: d.id, ...d.data() })
            );
            callbacks.onMembers(membersList);
            markCollectionLoaded();
          },
          (err) => reportError(err, membersPath, OperationType.LIST)
        )
      );

      // 3-15. Operational subcollections (all filtered by companyId == safeCompanyId to match firestore.rules)
      const subscribeSub = <T>(sub: CompanySubcollection, cb: (items: T[]) => void) => {
        const path = `companies/${safeCompanyId}/${sub}`;
        const q = query(
          collection(db, 'companies', safeCompanyId, sub),
          where('companyId', '==', safeCompanyId)
        );
        unsubs.push(
          onSnapshot(
            q,
            (snap) => {
              if (cancelled) return;
              const items = snap.docs.map((d) =>
                normalizeTimestamps<T>({ id: d.id, ...d.data() })
              );
              cb(items);
              markCollectionLoaded();
            },
            (err) => reportError(err, path, OperationType.LIST)
          )
        );
      };

      subscribeSub<Vehicle>('vehicles', callbacks.onVehicles);
      subscribeSub<Driver>('drivers', callbacks.onDrivers);
      subscribeSub<Customer>('customers', callbacks.onCustomers);
      subscribeSub<Broker>('brokers', (items) => callbacks.onBrokers?.(items));
      subscribeSub<Trip>('trips', callbacks.onTrips);
      subscribeSub<TripExpense>('expenses', callbacks.onExpenses);
      subscribeSub<DriverAdvance>('advances', callbacks.onAdvances);
      subscribeSub<TripSettlement>('settlements', callbacks.onSettlements);
      subscribeSub<Invoice>('invoices', callbacks.onInvoices);
      subscribeSub<Payment>('payments', callbacks.onPayments);
      subscribeSub<VehicleDocument>('documents', callbacks.onDocuments);
      subscribeSub<MaintenanceRecord>('maintenance', callbacks.onMaintenance);
      subscribeSub<FileRecord>('fileRecords', (items) => callbacks.onFileRecords?.(items));

      // 16. Company Settings subcollection
      subscribeSub<CompanySettings>('settings', (items) => {
        const def = items.find((s) => s.id === 'default') || items[0] || null;
        callbacks.onSettings?.(def);
      });

      // 17. Audit logs (strict Owner-Only per firestore.rules)
      if (resolvedRole === 'OWNER') {
        const auditPath = `companies/${safeCompanyId}/auditLogs`;
        const auditQ = query(
          collection(db, 'companies', safeCompanyId, 'auditLogs'),
          where('companyId', '==', safeCompanyId)
        );
        unsubs.push(
          onSnapshot(
            auditQ,
            (snap) => {
              if (cancelled) return;
              const logs = snap.docs.map((d) =>
                normalizeTimestamps<AuditLog>({ id: d.id, ...d.data() })
              );
              callbacks.onAuditLogs(logs);
              markCollectionLoaded();
            },
            (err) => reportError(err, auditPath, OperationType.LIST)
          )
        );
      } else {
        callbacks.onAuditLogs([]);
        markCollectionLoaded();
      }
    })
    .catch((err) => {
      if (!cancelled) {
        onError(err instanceof Error ? err : new Error(String(err)));
        callbacks.onInitialLoadComplete?.();
      }
    });

  return () => {
    cancelled = true;
    while (unsubs.length > 0) {
      const unsub = unsubs.pop();
      try {
        unsub?.();
      } catch {
        // Ignore unsubscribe cleanup errors
      }
    }
  };
}

export async function assertWritableFirestoreUser(companyId: string): Promise<string> {
  if (!auth.currentUser) {
    throw new Error('Authentication required. Please sign in to save changes.');
  }
  if (!isVerifiedEmailUser()) {
    throw new Error('Please verify your email address before saving changes to Firestore.');
  }
  try {
    let tokenResult = await auth.currentUser.getIdTokenResult();
    if (tokenResult?.claims?.email_verified !== true) {
      await auth.currentUser.getIdToken(true);
      tokenResult = await auth.currentUser.getIdTokenResult();
    }
    if (tokenResult?.claims?.email_verified !== true) {
      throw new Error('Your verified email session token has not propagated yet. Please try again.');
    }
  } catch (tokenErr: any) {
    if (tokenErr?.message?.includes('propagated')) {
      throw tokenErr;
    }
    // Proceed if token inspection is unavailable in unit tests
  }
  if (!isValidDocSegment(companyId)) {
    throw new Error('A valid company ID is required.');
  }
  const safeCompanyId = companyId.trim();
  try {
    const snap = await getAuthoritativeDocSnap(doc(db, 'companies', safeCompanyId));
    if (!snap.exists()) {
      throw new Error(`Company workspace ${safeCompanyId} does not exist.`);
    }
    if (snap.data()?.ownerId !== auth.currentUser.uid) {
      throw new Error(`Access denied. You are not the authorized owner of company ${safeCompanyId}.`);
    }
  } catch (checkErr: any) {
    if (
      checkErr?.message?.includes('does not exist') ||
      checkErr?.message?.includes('Access denied')
    ) {
      throw checkErr;
    }
    const role = await resolveCompanyRoleInFirestore(safeCompanyId);
    if (role !== 'OWNER') {
      throw new Error(
        `Access denied. You are not the authorized owner of company ${safeCompanyId}.`
      );
    }
  }
  return safeCompanyId;
}

function sanitizeAuditValueMap(
  raw?: Record<string, unknown>
): Record<string, string | number | boolean | null> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (count >= 40) break;
    if (v === undefined) continue;
    const key = clipStr(k, 50);
    if (!key) continue;
    if (v === null || typeof v === 'boolean') {
      out[key] = v;
      count += 1;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[key] = v;
      count += 1;
    } else if (typeof v === 'string') {
      out[key] = v.slice(0, 200);
      count += 1;
    }
  }
  return count > 0 ? out : undefined;
}

interface AuditLogBatchEntry {
  action: AuditLog['action'];
  entityType: AuditLog['entityType'];
  entityId: string;
  moduleName?: string;
  summary: string;
  previousValues?: Record<string, unknown>;
  updatedValues?: Record<string, unknown>;
}

function buildAuditLogPayload(
  companyId: string,
  entry: AuditLogBatchEntry
): { logId: string; payload: Record<string, any> } | null {
  if (!auth.currentUser) return null;
  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const payload = stripUndefined({
    id: logId,
    companyId,
    userId: auth.currentUser.uid,
    userName: clipStr(auth.currentUser.displayName || auth.currentUser.email, 100),
    action: entry.action,
    entityType: entry.entityType,
    entityId: clipStr(entry.entityId, 128) || 'system',
    moduleName: clipStr(entry.moduleName, 60),
    summary: clipStr(entry.summary, 500) || 'Action logged',
    previousValues: sanitizeAuditValueMap(entry.previousValues),
    updatedValues: sanitizeAuditValueMap(entry.updatedValues),
    timestamp: serverTimestamp(),
  });
  return { logId, payload };
}

function addAuditLogToBatch(
  batch: ReturnType<typeof writeBatch>,
  companyId: string,
  entry: AuditLogBatchEntry
) {
  const built = buildAuditLogPayload(companyId, entry);
  if (!built) return;
  const ref = doc(db, 'companies', companyId, 'auditLogs', built.logId);
  batch.set(ref, built.payload);
}

export async function writeAuditLogBestEffort(companyId: string, entry: AuditLogBatchEntry): Promise<void> {
  const built = buildAuditLogPayload(companyId, entry);
  if (!built) return;
  try {
    await setDoc(doc(db, 'companies', companyId, 'auditLogs', built.logId), built.payload);
  } catch {
    // Non-fatal: secondary audit log must never block core operational mutations
  }
}

interface PreparedBatchDoc {
  subcollection: CompanySubcollection;
  docId: string;
  ref: DocumentReference<DocumentData>;
  payload: Record<string, any>;
  existingData: DocumentData | null;
  isNew: boolean;
}

async function prepareBatchDoc(
  companyId: string,
  subcollection: CompanySubcollection,
  item: Record<string, any> & { id: string }
): Promise<PreparedBatchDoc> {
  if (!isValidDocSegment(item.id)) {
    throw new Error(`Invalid document ID for ${subcollection}`);
  }
  const safeDocId = item.id.trim();
  const ref = doc(db, 'companies', companyId, subcollection, safeDocId);
  const existingSnap = await getAuthoritativeDocSnap(ref);
  const existingData = existingSnap.exists() ? existingSnap.data() : null;
  const payload = sanitizeSubcollectionPayload(subcollection, companyId, item, existingData);
  if (!payload) {
    throw new Error(`Missing required fields for ${subcollection} record.`);
  }
  return { subcollection, docId: safeDocId, ref, payload, existingData, isNew: !existingSnap.exists() };
}

function writePreparedBatchDoc(
  batch: ReturnType<typeof writeBatch>,
  prepared: PreparedBatchDoc
): void {
  if (!prepared.isNew && prepared.existingData && isFirestoreTimestamp(prepared.existingData.createdAt)) {
    batch.update(
      prepared.ref,
      buildServerPreservingUpdatePayload(prepared.existingData, prepared.payload)
    );
  } else {
    batch.set(prepared.ref, prepared.payload);
  }
}

function isServerTimestampSentinel(val: unknown): boolean {
  return typeof val === 'object' && val !== null && (val as any)._methodName === 'serverTimestamp';
}

const RULE_SCHEMA_SPECS: Partial<
  Record<
    CompanySubcollection,
    {
      required: string[];
      allowed?: string[];
      reqStrings?: Record<string, number>;
      optStrings?: Record<string, number>;
      reqNumbers?: string[];
      optNumbers?: string[];
      optBools?: string[];
      reqBools?: string[];
      enums?: Record<string, string[]>;
    }
  >
> = {
  advances: {
    required: ['id', 'companyId', 'driverId', 'amountPaise', 'advanceType', 'date', 'isSettled', 'createdAt', 'updatedAt'],
    allowed: [
      'id', 'companyId', 'tripId', 'tripNumber', 'driverId', 'driverName',
      'vehicleReg', 'amountPaise', 'advanceType', 'paymentMode', 'date',
      'reference', 'referenceNotes', 'notes', 'disbursedBy',
      'status', 'cancelledAt', 'cancellationReason', 'cancelledBy',
      'isSettled', 'settlementId', 'createdAt', 'updatedAt',
    ],
    reqStrings: { driverId: 128, date: 40 },
    optStrings: {
      tripId: 128, tripNumber: 50, driverName: 100, vehicleReg: 30, paymentMode: 30,
      reference: 100, referenceNotes: 300, notes: 300, disbursedBy: 100,
      cancelledAt: 40, cancellationReason: 300, cancelledBy: 100, settlementId: 128,
    },
    reqNumbers: ['amountPaise'],
    reqBools: ['isSettled'],
    enums: {
      advanceType: VALID_ADVANCE_TYPES,
      status: ['ACTIVE', 'CANCELLED', 'SETTLED'],
    },
  },
  vehicles: {
    required: ['id', 'companyId', 'registrationNumber', 'vehicleType', 'status', 'createdAt', 'updatedAt'],
    allowed: [
      'id', 'companyId', 'registrationNumber', 'vehicleType', 'makeModel',
      'capacityTonnes', 'unladenWeightTonnes', 'chassisNumber', 'engineNumber',
      'status', 'currentOdometerKm', 'fastagBalancePaise', 'assignedDriverId',
      'assignedDriverName', 'activeTripId', 'insuranceExpiry', 'insurancePolicyNumber',
      'fitnessExpiry', 'fitnessCertificateNumber', 'permitExpiry', 'permitNumber',
      'permitType', 'pucExpiry', 'pucNumber', 'notes', 'createdAt', 'updatedAt',
    ],
    reqStrings: { registrationNumber: 30, vehicleType: 60 },
    optStrings: {
      makeModel: 100, chassisNumber: 60, engineNumber: 60, assignedDriverId: 128,
      assignedDriverName: 100, activeTripId: 128, insuranceExpiry: 30,
      insurancePolicyNumber: 60, fitnessExpiry: 30, fitnessCertificateNumber: 60,
      permitExpiry: 30, permitNumber: 60, pucExpiry: 30, pucNumber: 60, notes: 500,
    },
    optNumbers: ['capacityTonnes', 'unladenWeightTonnes', 'currentOdometerKm', 'fastagBalancePaise'],
    enums: {
      status: VALID_VEHICLE_STATUSES,
      permitType: ['NATIONAL', 'STATE'],
    },
  },
  drivers: {
    required: ['id', 'companyId', 'fullName', 'phone', 'licenseNumber', 'status', 'createdAt', 'updatedAt'],
    allowed: [
      'id', 'companyId', 'fullName', 'phone', 'altPhone', 'licenseNumber',
      'licenseExpiry', 'badgeNumber', 'address', 'emergencyContact', 'emergencyPhone',
      'status', 'currentAdvanceBalancePaise', 'totalTripsCompleted', 'monthlySalaryPaise',
      'perDayBataPaise', 'assignedVehicleId', 'assignedVehicleReg', 'aadharNumber',
      'panNumber', 'bankAccount', 'bankIfsc', 'bankName', 'bankBranch',
      'isSensitiveDataRedacted', 'joinedDate', 'createdAt', 'updatedAt',
    ],
    reqStrings: { fullName: 100, phone: 20, licenseNumber: 40 },
    optStrings: {
      altPhone: 20, licenseExpiry: 30, badgeNumber: 40, address: 250,
      emergencyContact: 100, emergencyPhone: 20, assignedVehicleId: 128,
      assignedVehicleReg: 30, aadharNumber: 25, panNumber: 15, bankAccount: 40,
      bankIfsc: 15, bankName: 80, bankBranch: 80, joinedDate: 30,
    },
    optNumbers: ['currentAdvanceBalancePaise', 'totalTripsCompleted', 'monthlySalaryPaise', 'perDayBataPaise'],
    optBools: ['isSensitiveDataRedacted'],
    enums: { status: VALID_DRIVER_STATUSES },
  },
};

function validatePreparedDocAgainstRules(prepared: PreparedBatchDoc, companyId: string): string | null {
  const { subcollection, docId, payload, existingData, isNew } = prepared;
  if (payload.id !== docId) {
    return `${subcollection}/${docId}: id mismatch (${String(payload.id)} !== ${docId})`;
  }
  if (payload.companyId !== companyId) {
    return `${subcollection}/${docId}: companyId mismatch (${String(payload.companyId)} !== ${companyId})`;
  }
  // Trips & Dispatch use flexible Verified Company Owner rules without rigid schema/timestamp locks
  if (subcollection === 'trips') {
    return null;
  }
  if (!isServerTimestampSentinel(payload.updatedAt)) {
    return `${subcollection}/${docId}: updatedAt must be serverTimestamp()`;
  }
  if (isNew || !existingData || !isFirestoreTimestamp(existingData.createdAt)) {
    if (!isServerTimestampSentinel(payload.createdAt)) {
      return `${subcollection}/${docId}: createdAt must be serverTimestamp() on create/migration`;
    }
  } else if (existingData.companyId !== companyId) {
    return `${subcollection}/${docId}: existing().companyId (${String(existingData.companyId)}) does not match ${companyId}`;
  }

  const spec = RULE_SCHEMA_SPECS[subcollection];
  if (!spec) return null;

  const keys = Object.keys(payload);
  for (const reqKey of spec.required) {
    if (!keys.includes(reqKey) || payload[reqKey] === undefined) {
      return `${subcollection}/${docId}: missing required field '${reqKey}'`;
    }
  }
  if (spec.allowed) {
    for (const key of keys) {
      if (!spec.allowed.includes(key)) {
        return `${subcollection}/${docId}: disallowed shadow field '${key}'`;
      }
    }
  }
  for (const [f, maxLen] of Object.entries(spec.reqStrings || {})) {
    if (typeof payload[f] !== 'string' || payload[f].length === 0 || payload[f].length > maxLen) {
      return `${subcollection}/${docId}: invalid required string '${f}'`;
    }
  }
  for (const [f, maxLen] of Object.entries(spec.optStrings || {})) {
    if (f in payload && (typeof payload[f] !== 'string' || payload[f].length > maxLen)) {
      return `${subcollection}/${docId}: invalid optional string '${f}'`;
    }
  }
  for (const f of spec.reqNumbers || []) {
    if (typeof payload[f] !== 'number' || !Number.isFinite(payload[f])) {
      return `${subcollection}/${docId}: invalid required number '${f}'`;
    }
  }
  for (const f of spec.optNumbers || []) {
    if (f in payload && (typeof payload[f] !== 'number' || !Number.isFinite(payload[f]))) {
      return `${subcollection}/${docId}: invalid optional number '${f}'`;
    }
  }
  for (const f of spec.reqBools || []) {
    if (typeof payload[f] !== 'boolean') {
      return `${subcollection}/${docId}: invalid required boolean '${f}'`;
    }
  }
  for (const f of spec.optBools || []) {
    if (f in payload && typeof payload[f] !== 'boolean') {
      return `${subcollection}/${docId}: invalid optional boolean '${f}'`;
    }
  }
  for (const [f, allowedVals] of Object.entries(spec.enums || {})) {
    if (f in payload && !allowedVals.includes(payload[f])) {
      return `${subcollection}/${docId}: enum field '${f}' has invalid value '${String(payload[f])}'`;
    }
  }
  if (subcollection === 'advances' && payload.amountPaise <= 0) {
    return `advances/${docId}: amountPaise must be > 0`;
  }
  return null;
}

async function commitPreparedDocsSequentiallyWithRollback(
  coreDocs: PreparedBatchDoc[],
  companyId: string,
  onTargetFailure: (failingPath: string, failingOp: OperationType) => void
): Promise<void> {
  for (const prepared of coreDocs) {
    const preflightIssue = validatePreparedDocAgainstRules(prepared, companyId);
    if (preflightIssue) {
      onTargetFailure(
        prepared.ref.path,
        prepared.isNew ? OperationType.CREATE : OperationType.UPDATE
      );
      throw new Error(`Firestore preflight schema validation failed: ${preflightIssue}`);
    }
  }

  const undoActions: Array<() => Promise<void>> = [];

  for (const prepared of coreDocs) {
    const op = prepared.isNew ? OperationType.CREATE : OperationType.UPDATE;
    const useUpdate =
      !prepared.isNew &&
      Boolean(prepared.existingData && isFirestoreTimestamp(prepared.existingData.createdAt));

    try {
      if (useUpdate) {
        const updatePayload = buildServerPreservingUpdatePayload(
          prepared.existingData!,
          prepared.payload
        );
        await updateDoc(prepared.ref, updatePayload);
        const prevSnapshotData = prepared.existingData!;
        const writtenPayload = prepared.payload;
        undoActions.push(async () => {
          const restorePayload = buildServerPreservingUpdatePayload(writtenPayload, {
            ...prevSnapshotData,
            updatedAt: serverTimestamp(),
          });
          await updateDoc(prepared.ref, restorePayload);
        });
      } else {
        await setDoc(prepared.ref, prepared.payload);
        if (prepared.isNew) {
          undoActions.push(async () => {
            await deleteDoc(prepared.ref);
          });
        } else if (prepared.existingData) {
          const prevSnapshotData = prepared.existingData;
          undoActions.push(async () => {
            await setDoc(prepared.ref, {
              ...prevSnapshotData,
              createdAt: isFirestoreTimestamp(prevSnapshotData.createdAt)
                ? prevSnapshotData.createdAt
                : serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          });
        }
      }
    } catch (docErr: any) {
      for (let i = undoActions.length - 1; i >= 0; i--) {
        try {
          await undoActions[i]();
        } catch {
          // Best-effort rollback on earlier sequential writes
        }
      }
      onTargetFailure(prepared.ref.path, op);
      const existingCreatedAtType = prepared.existingData
        ? isFirestoreTimestamp(prepared.existingData.createdAt)
          ? 'Timestamp'
          : typeof prepared.existingData.createdAt
        : 'none';
      const diag = [
        `isolatedPath=${prepared.ref.path}`,
        `mode=${useUpdate ? 'updateDoc' : 'setDoc'}`,
        `isNew=${prepared.isNew}`,
        `payloadKeys=[${Object.keys(prepared.payload).join(',')}]`,
        `existingCreatedAt=${existingCreatedAtType}`,
        `existingCompanyId=${String(prepared.existingData?.companyId ?? 'none')}`,
      ].join(' ');
      const baseMsg = docErr instanceof Error ? docErr.message : String(docErr);
      throw new Error(`${baseMsg} (${diag})`);
    }
  }
}

/**
 * Atomic Vehicle + Compliance Docs Save
 */
export async function saveVehicleWithDocsInFirestore(
  companyId: string,
  vehicle: Vehicle,
  docsToUpsert: VehicleDocument[] = []
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/vehicles/${vehicle.id}`;
  try {
    const batch = writeBatch(db);
    const vehDoc = await prepareBatchDoc(safeCompanyId, 'vehicles', vehicle);
    writePreparedBatchDoc(batch, vehDoc);

    for (const d of docsToUpsert) {
      const comp = calculateDocComplianceStatus(d.expiryDate);
      const prepared = await prepareBatchDoc(safeCompanyId, 'documents', {
        ...d,
        companyId: safeCompanyId,
        daysUntilExpiry: comp.daysUntilExpiry,
        status: comp.status,
      });
      writePreparedBatchDoc(batch, prepared);
    }

    addAuditLogToBatch(batch, safeCompanyId, {
      action: vehDoc.isNew ? 'CREATE' : 'UPDATE',
      entityType: 'VEHICLE',
      entityId: vehicle.id,
      summary: `${vehDoc.isNew ? 'Registered' : 'Updated'} truck ${vehicle.registrationNumber}`,
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

/**
 * Atomic Vehicle Delete + Cascade Delete Compliance Documents
 */
export async function deleteVehicleWithDocsInFirestore(
  companyId: string,
  vehicleId: string,
  regNo?: string
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  if (!isValidDocSegment(vehicleId)) return;
  const path = `companies/${safeCompanyId}/vehicles/${vehicleId}`;
  try {
    const docsSnap = await getDocs(
      query(
        collection(db, 'companies', safeCompanyId, 'documents'),
        where('companyId', '==', safeCompanyId),
        where('vehicleId', '==', vehicleId.trim())
      )
    );
    const batch = writeBatch(db);
    batch.delete(doc(db, 'companies', safeCompanyId, 'vehicles', vehicleId.trim()));
    docsSnap.docs.forEach((d) => batch.delete(d.ref));
    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'DELETE',
      entityType: 'VEHICLE',
      entityId: vehicleId.trim(),
      summary: `Deleted truck ${regNo || vehicleId}`,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Save / Delete Driver
 */
export async function saveDriverInFirestore(companyId: string, driver: Driver): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/drivers/${driver.id}`;
  try {
    const batch = writeBatch(db);
    const drvDoc = await prepareBatchDoc(safeCompanyId, 'drivers', driver);
    writePreparedBatchDoc(batch, drvDoc);
    addAuditLogToBatch(batch, safeCompanyId, {
      action: drvDoc.isNew ? 'CREATE' : 'UPDATE',
      entityType: 'DRIVER',
      entityId: driver.id,
      summary: `${drvDoc.isNew ? 'Added' : 'Updated'} driver ${driver.fullName}`,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteDriverInFirestore(
  companyId: string,
  driverId: string,
  fullName?: string
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  if (!isValidDocSegment(driverId)) return;
  const path = `companies/${safeCompanyId}/drivers/${driverId}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'companies', safeCompanyId, 'drivers', driverId.trim()));
    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'DELETE',
      entityType: 'DRIVER',
      entityId: driverId.trim(),
      summary: `Deleted driver ${fullName || driverId}`,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Save / Delete Customer
 */
export async function saveCustomerInFirestore(companyId: string, customer: Customer): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/customers/${customer.id}`;
  try {
    const batch = writeBatch(db);
    const custDoc = await prepareBatchDoc(safeCompanyId, 'customers', customer);
    writePreparedBatchDoc(batch, custDoc);
    addAuditLogToBatch(batch, safeCompanyId, {
      action: custDoc.isNew ? 'CREATE' : 'UPDATE',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      summary: `${custDoc.isNew ? 'Added' : 'Updated'} customer ${customer.name}`,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteCustomerInFirestore(
  companyId: string,
  customerId: string,
  name?: string
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  if (!isValidDocSegment(customerId)) return;
  const path = `companies/${safeCompanyId}/customers/${customerId}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'companies', safeCompanyId, 'customers', customerId.trim()));
    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'DELETE',
      entityType: 'CUSTOMER',
      entityId: customerId.trim(),
      summary: `Deleted customer ${name || customerId}`,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Atomic Trip Create/Update + Vehicle/Driver Assignment + Optional Dispatch Advance
 */
export async function createOrUpdateTripInFirestore(
  companyId: string,
  params: {
    trip: Trip;
    vehicle?: Vehicle;
    driver?: Driver;
    previousVehicle?: Vehicle;
    previousDriver?: Driver;
    initialAdvance?: DriverAdvance | null;
  }
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const { trip, vehicle, driver, previousVehicle, previousDriver, initialAdvance } = params;
  const defaultPath = `companies/${safeCompanyId}/trips/${trip.id}`;
  let activePath = defaultPath;
  let activeOp: OperationType = OperationType.WRITE;

  try {
    const coreDocs: PreparedBatchDoc[] = [];

    activePath = `companies/${safeCompanyId}/trips/${trip.id}`;
    activeOp = OperationType.GET;
    const tripDoc = await prepareBatchDoc(safeCompanyId, 'trips', trip);
    coreDocs.push(tripDoc);

    if (initialAdvance && initialAdvance.amountPaise > 0) {
      activePath = `companies/${safeCompanyId}/advances/${initialAdvance.id}`;
      activeOp = OperationType.GET;
      const advDoc = await prepareBatchDoc(safeCompanyId, 'advances', initialAdvance);
      coreDocs.push(advDoc);
    }

    const isActiveTripStatus = trip.status === 'DISPATCHED' || trip.status === 'IN_TRANSIT';

    // Release previous vehicle if trip was reassigned to a different truck
    if (
      previousVehicle &&
      previousVehicle.id !== vehicle?.id &&
      (previousVehicle.status === 'IN_TRANSIT' || previousVehicle.activeTripId === trip.id)
    ) {
      activePath = `companies/${safeCompanyId}/vehicles/${previousVehicle.id}`;
      activeOp = OperationType.GET;
      const releasedPrevVeh: Vehicle = {
        ...previousVehicle,
        status: previousVehicle.status === 'IN_TRANSIT' ? 'AVAILABLE' : previousVehicle.status,
        activeTripId:
          previousVehicle.activeTripId === trip.id ? undefined : previousVehicle.activeTripId,
      };
      const prevVehDoc = await prepareBatchDoc(safeCompanyId, 'vehicles', releasedPrevVeh);
      coreDocs.push(prevVehDoc);
    }

    // Release previous driver if trip was reassigned to a different driver
    if (
      previousDriver &&
      previousDriver.id !== driver?.id &&
      previousDriver.status === 'ON_TRIP'
    ) {
      activePath = `companies/${safeCompanyId}/drivers/${previousDriver.id}`;
      activeOp = OperationType.GET;
      const releasedPrevDrv: Driver = {
        ...previousDriver,
        status: 'AVAILABLE',
      };
      const prevDrvDoc = await prepareBatchDoc(safeCompanyId, 'drivers', releasedPrevDrv);
      coreDocs.push(prevDrvDoc);
    }

    if (vehicle) {
      if (isActiveTripStatus) {
        activePath = `companies/${safeCompanyId}/vehicles/${vehicle.id}`;
        activeOp = OperationType.GET;
        const updatedVeh: Vehicle = {
          ...vehicle,
          status: 'IN_TRANSIT',
          activeTripId: trip.id,
          assignedDriverId: driver?.id || vehicle.assignedDriverId,
          assignedDriverName: driver?.fullName || vehicle.assignedDriverName,
        };
        const vehDoc = await prepareBatchDoc(safeCompanyId, 'vehicles', updatedVeh);
        coreDocs.push(vehDoc);
      } else if (
        !tripDoc.isNew &&
        (vehicle.activeTripId === trip.id || (!vehicle.activeTripId && vehicle.status === 'IN_TRANSIT'))
      ) {
        activePath = `companies/${safeCompanyId}/vehicles/${vehicle.id}`;
        activeOp = OperationType.GET;
        const belongsToThisTrip = vehicle.activeTripId === trip.id || !vehicle.activeTripId;
        const releasedVeh: Vehicle = {
          ...vehicle,
          status:
            belongsToThisTrip && vehicle.status === 'IN_TRANSIT' ? 'AVAILABLE' : vehicle.status,
          activeTripId: vehicle.activeTripId === trip.id ? undefined : vehicle.activeTripId,
        };
        const vehDoc = await prepareBatchDoc(safeCompanyId, 'vehicles', releasedVeh);
        coreDocs.push(vehDoc);
      }
    }

    if (driver) {
      const advDelta = initialAdvance && initialAdvance.amountPaise > 0 ? initialAdvance.amountPaise : 0;
      const shouldReleaseDriver = !isActiveTripStatus && !tripDoc.isNew && driver.status === 'ON_TRIP';
      if (isActiveTripStatus || advDelta > 0 || shouldReleaseDriver) {
        activePath = `companies/${safeCompanyId}/drivers/${driver.id}`;
        activeOp = OperationType.GET;
        const updatedDrv: Driver = {
          ...driver,
          status: isActiveTripStatus
            ? 'ON_TRIP'
            : shouldReleaseDriver
            ? 'AVAILABLE'
            : driver.status,
          currentAdvanceBalancePaise: (driver.currentAdvanceBalancePaise || 0) + advDelta,
        };
        const drvDoc = await prepareBatchDoc(safeCompanyId, 'drivers', updatedDrv);
        coreDocs.push(drvDoc);
      }
    }

    const auditEntry: AuditLogBatchEntry = {
      action: tripDoc.isNew ? (isActiveTripStatus ? 'DISPATCH' : 'CREATE') : 'UPDATE',
      entityType: 'TRIP',
      entityId: trip.id,
      summary: `${tripDoc.isNew ? 'Dispatched' : 'Updated'} trip ${trip.tripNumber || trip.id}${
        trip.vehicleReg ? ` (${trip.vehicleReg})` : ''
      }`,
    };

    const commitTripBatch = async (includeAuditLog: boolean) => {
      const batch = writeBatch(db);
      for (const prepared of coreDocs) {
        writePreparedBatchDoc(batch, prepared);
      }
      if (includeAuditLog) {
        addAuditLogToBatch(batch, safeCompanyId, auditEntry);
      }
      await batch.commit();
    };

    activePath = defaultPath;
    activeOp = OperationType.WRITE;

    try {
      await commitTripBatch(true);
    } catch (firstErr) {
      if (!isPermissionDeniedError(firstErr)) {
        throw firstErr;
      }
      // Refresh ID token once in case email_verified or auth session claim rotated mid-session
      if (auth.currentUser) {
        try {
          await auth.currentUser.getIdToken(true);
        } catch {
          // Proceed to fallback attempt
        }
      }
      try {
        await commitTripBatch(true);
      } catch (retryErr) {
        if (!isPermissionDeniedError(retryErr)) {
          throw retryErr;
        }
        // Retry core atomic operational batch (trip + advance + vehicle + driver) without secondary auditLog
        try {
          await commitTripBatch(false);
        } catch (coreBatchErr) {
          if (!isPermissionDeniedError(coreBatchErr)) {
            throw coreBatchErr;
          }
          // Fall back to rollback-safe sequential execution to bypass batch rule quirks or isolate exact failing doc
          await commitPreparedDocsSequentiallyWithRollback(
            coreDocs,
            safeCompanyId,
            (failingPath, failingOp) => {
              activePath = failingPath;
              activeOp = failingOp;
            }
          );
        }
        await writeAuditLogBestEffort(safeCompanyId, auditEntry);
      }
    }
  } catch (err) {
    handleFirestoreError(err, activeOp, activePath);
  }
}

/**
 * Atomic Trip Status Transition (DISPATCHED -> IN_TRANSIT -> DELIVERED -> COMPLETED / CANCELLED)
 */
export async function transitionTripStatusInFirestore(
  companyId: string,
  params: {
    trip: Trip;
    nextStatus: Trip['status'];
    vehicle?: Vehicle;
    driver?: Driver;
    actualDeliveryDate?: string;
    endOdometerKm?: number;
    podReceived?: boolean;
    podDocumentUrl?: string;
    podRemarks?: string;
    cancellationReason?: string;
    cancelledBy?: string;
  }
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const {
    trip,
    nextStatus,
    vehicle,
    driver,
    actualDeliveryDate,
    endOdometerKm,
    podReceived,
    podDocumentUrl,
    podRemarks,
    cancellationReason,
    cancelledBy,
  } = params;
  let activePath = `companies/${safeCompanyId}/trips/${trip.id}`;
  let activeOp: OperationType = OperationType.UPDATE;

  try {
    const coreDocs: PreparedBatchDoc[] = [];
    const isReopening =
      (trip.status === 'CANCELLED' && nextStatus === 'PLANNED') ||
      (trip.status === 'COMPLETED' && nextStatus === 'DELIVERED') ||
      (trip.status === 'SETTLED' && (nextStatus === 'COMPLETED' || nextStatus === 'DELIVERED')) ||
      (trip.status === 'DELIVERED' && nextStatus === 'IN_TRANSIT') ||
      (trip.status === 'IN_TRANSIT' && nextStatus === 'DISPATCHED') ||
      (trip.status === 'DISPATCHED' && nextStatus === 'PLANNED');

    const updatedTrip: Trip = {
      ...trip,
      status: nextStatus,
      actualDeliveryDate:
        nextStatus === 'DELIVERED' || nextStatus === 'COMPLETED'
          ? actualDeliveryDate || trip.actualDeliveryDate || new Date().toISOString().split('T')[0]
          : trip.actualDeliveryDate,
      endOdometerKm: endOdometerKm !== undefined ? endOdometerKm : trip.endOdometerKm,
      podReceived: podReceived !== undefined ? podReceived : trip.podReceived,
      podDocumentUrl: podDocumentUrl !== undefined ? podDocumentUrl : trip.podDocumentUrl,
      podRemarks: podRemarks !== undefined ? podRemarks : trip.podRemarks,
      cancellationReason:
        nextStatus === 'CANCELLED'
          ? cancellationReason || trip.cancellationReason
          : isReopening && trip.status === 'CANCELLED'
          ? undefined
          : trip.cancellationReason,
      cancelledAt:
        nextStatus === 'CANCELLED'
          ? new Date().toISOString()
          : isReopening && trip.status === 'CANCELLED'
          ? undefined
          : trip.cancelledAt,
      cancelledBy:
        nextStatus === 'CANCELLED'
          ? cancelledBy || trip.cancelledBy
          : isReopening && trip.status === 'CANCELLED'
          ? undefined
          : trip.cancelledBy,
      reopenedAt: isReopening ? new Date().toISOString() : trip.reopenedAt,
      reopenedBy: isReopening ? cancelledBy || auth.currentUser?.email || 'Owner' : trip.reopenedBy,
    };

    const tripDoc = await prepareBatchDoc(safeCompanyId, 'trips', updatedTrip);
    coreDocs.push(tripDoc);

    const isBecomingActive = nextStatus === 'DISPATCHED' || nextStatus === 'IN_TRANSIT';
    const isEndingOrReopeningToPlanned =
      nextStatus === 'PLANNED' ||
      nextStatus === 'DELIVERED' ||
      nextStatus === 'COMPLETED' ||
      nextStatus === 'SETTLED' ||
      nextStatus === 'CANCELLED';

    if (vehicle) {
      if (isBecomingActive) {
        const vehDoc = await prepareBatchDoc(safeCompanyId, 'vehicles', {
          ...vehicle,
          status: 'IN_TRANSIT',
          activeTripId: trip.id,
        });
        coreDocs.push(vehDoc);
      } else if (isEndingOrReopeningToPlanned) {
        const belongsToThisTrip = vehicle.activeTripId === trip.id || !vehicle.activeTripId;
        const vehDoc = await prepareBatchDoc(safeCompanyId, 'vehicles', {
          ...vehicle,
          status:
            belongsToThisTrip && vehicle.status === 'IN_TRANSIT' ? 'AVAILABLE' : vehicle.status,
          activeTripId: vehicle.activeTripId === trip.id ? undefined : vehicle.activeTripId,
          currentOdometerKm:
            endOdometerKm !== undefined && endOdometerKm > (vehicle.currentOdometerKm || 0)
              ? endOdometerKm
              : vehicle.currentOdometerKm,
        });
        coreDocs.push(vehDoc);
      }
    }

    if (driver) {
      if (isBecomingActive) {
        const drvDoc = await prepareBatchDoc(safeCompanyId, 'drivers', {
          ...driver,
          status: 'ON_TRIP',
        });
        coreDocs.push(drvDoc);
      } else if (isEndingOrReopeningToPlanned) {
        const wasDeliveredBefore =
          trip.status === 'DELIVERED' || trip.status === 'COMPLETED' || trip.status === 'SETTLED';
        const incrementTripCount =
          (nextStatus === 'DELIVERED' || nextStatus === 'COMPLETED') && !wasDeliveredBefore ? 1 : 0;
        const drvDoc = await prepareBatchDoc(safeCompanyId, 'drivers', {
          ...driver,
          status: driver.status === 'ON_TRIP' ? 'AVAILABLE' : driver.status,
          totalTripsCompleted: (driver.totalTripsCompleted || 0) + incrementTripCount,
        });
        coreDocs.push(drvDoc);
      }
    }

    const auditEntry: AuditLogBatchEntry = {
      action: 'UPDATE',
      entityType: 'TRIP',
      entityId: trip.id,
      summary: `Transitioned trip ${trip.tripNumber} status from ${trip.status} to ${nextStatus}`,
    };

    const commitTransitionBatch = async (includeAuditLog: boolean) => {
      const batch = writeBatch(db);
      for (const prepared of coreDocs) {
        writePreparedBatchDoc(batch, prepared);
      }
      if (includeAuditLog) {
        addAuditLogToBatch(batch, safeCompanyId, auditEntry);
      }
      await batch.commit();
    };

    try {
      await commitTransitionBatch(true);
    } catch (firstErr) {
      if (!isPermissionDeniedError(firstErr)) {
        throw firstErr;
      }
      if (auth.currentUser) {
        try {
          await auth.currentUser.getIdToken(true);
        } catch {
          // Proceed to fallback attempt
        }
      }
      try {
        await commitTransitionBatch(true);
      } catch (retryErr) {
        if (!isPermissionDeniedError(retryErr)) {
          throw retryErr;
        }
        try {
          await commitTransitionBatch(false);
        } catch (coreBatchErr) {
          if (!isPermissionDeniedError(coreBatchErr)) {
            throw coreBatchErr;
          }
          await commitPreparedDocsSequentiallyWithRollback(
            coreDocs,
            safeCompanyId,
            (failingPath, failingOp) => {
              activePath = failingPath;
              activeOp = failingOp;
            }
          );
        }
        await writeAuditLogBestEffort(safeCompanyId, auditEntry);
      }
    }
  } catch (err) {
    handleFirestoreError(err, activeOp, activePath);
  }
}

export async function deleteTripInFirestore(
  companyId: string,
  tripId: string,
  tripNumberOrOptions?:
    | string
    | {
        tripNumber?: string;
        vehicle?: Vehicle;
        driver?: Driver;
      }
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  if (!isValidDocSegment(tripId)) return;
  const safeTripId = tripId.trim();
  const path = `companies/${safeCompanyId}/trips/${safeTripId}`;
  const opts =
    typeof tripNumberOrOptions === 'string'
      ? { tripNumber: tripNumberOrOptions }
      : tripNumberOrOptions || {};
  try {
    // Delete nested trip_logs sub-collection in chunks <= 8 first so no orphan docs remain
    try {
      const logsSnap = await getDocs(
        query(
          collection(db, 'companies', safeCompanyId, 'trips', safeTripId, 'trip_logs'),
          where('companyId', '==', safeCompanyId)
        )
      );
      for (let i = 0; i < logsSnap.docs.length; i += 8) {
        const logBatch = writeBatch(db);
        logsSnap.docs.slice(i, i + 8).forEach((d) => logBatch.delete(d.ref));
        await logBatch.commit();
      }
    } catch {
      // Non-fatal if trip_logs sub-collection does not exist
    }

    const batch = writeBatch(db);
    batch.delete(doc(db, 'companies', safeCompanyId, 'trips', safeTripId));

    if (opts.vehicle) {
      const updatedVeh: Vehicle = {
        ...opts.vehicle,
        status: opts.vehicle.status === 'IN_TRANSIT' ? 'AVAILABLE' : opts.vehicle.status,
        activeTripId: opts.vehicle.activeTripId === safeTripId ? undefined : opts.vehicle.activeTripId,
      };
      const vehDoc = await prepareBatchDoc(safeCompanyId, 'vehicles', updatedVeh);
      writePreparedBatchDoc(batch, vehDoc);
    }

    if (opts.driver && opts.driver.status === 'ON_TRIP') {
      const updatedDrv: Driver = {
        ...opts.driver,
        status: 'AVAILABLE',
      };
      const drvDoc = await prepareBatchDoc(safeCompanyId, 'drivers', updatedDrv);
      writePreparedBatchDoc(batch, drvDoc);
    }

    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'DELETE',
      entityType: 'TRIP',
      entityId: safeTripId,
      moduleName: 'TRIPS',
      summary: `Deleted trip ${opts.tripNumber || safeTripId}`,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

const VALID_TRIP_LOG_SEVERITIES: TripLogSeverity[] = ['INFO', 'SUCCESS', 'WARNING', 'CRITICAL'];

export function sanitizeTripLogPayload(
  companyId: string,
  tripId: string,
  log: Partial<TripLog> & { id: string },
  existingData?: DocumentData | null
): Record<string, any> | null {
  const safeLogId = typeof log.id === 'string' ? log.id.trim() : '';
  if (!isValidDocSegment(safeLogId) || !isValidDocSegment(companyId) || !isValidDocSegment(tripId)) {
    return null;
  }

  const status = clipStr(log.status, 80);
  const timestamp = clipStr(log.timestamp, 40) || new Date().toISOString();
  const locationNote = clipStr(log.locationNote, 250);
  if (!status || !locationNote) return null;

  const rawLat = toNum(log.latitude);
  const latitude =
    rawLat !== undefined && rawLat >= -90 && rawLat <= 90
      ? Math.round(rawLat * 1000000) / 1000000
      : undefined;

  const rawLng = toNum(log.longitude);
  const longitude =
    rawLng !== undefined && rawLng >= -180 && rawLng <= 180
      ? Math.round(rawLng * 1000000) / 1000000
      : undefined;

  const rawOdo = toNum(log.odometerKm);
  const odometerKm = rawOdo !== undefined && rawOdo >= 0 ? Math.round(rawOdo) : undefined;

  const severity =
    log.severity && VALID_TRIP_LOG_SEVERITIES.includes(log.severity) ? log.severity : undefined;

  const createdAt = isFirestoreTimestamp(existingData?.createdAt)
    ? existingData!.createdAt
    : serverTimestamp();

  return stripUndefined({
    id: safeLogId,
    companyId: companyId.trim(),
    tripId: tripId.trim(),
    tripNumber: clipStr(log.tripNumber, 50),
    status,
    severity,
    timestamp,
    locationNote,
    latitude,
    longitude,
    odometerKm,
    notes: clipStr(log.notes, 500),
    loggedByUid: clipStr(log.loggedByUid || auth.currentUser?.uid, 128),
    loggedByName: clipStr(
      log.loggedByName || auth.currentUser?.displayName || auth.currentUser?.email,
      100
    ),
    createdAt,
    updatedAt: serverTimestamp(),
  });
}

function sortTripLogsDescending(logs: TripLog[]): TripLog[] {
  return [...logs].sort((a, b) => {
    const tA = new Date(a.timestamp || a.createdAt || 0).getTime();
    const tB = new Date(b.timestamp || b.createdAt || 0).getTime();
    return (Number.isFinite(tB) ? tB : 0) - (Number.isFinite(tA) ? tA : 0);
  });
}

export function subscribeToTripLogsInFirestore(
  companyId: string,
  tripId: string,
  onData: (logs: TripLog[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!auth.currentUser || !isValidDocSegment(companyId) || !isValidDocSegment(tripId)) {
    onData([]);
    return () => {};
  }
  const safeCompanyId = companyId.trim();
  const safeTripId = tripId.trim();
  const path = `companies/${safeCompanyId}/trips/${safeTripId}/trip_logs`;

  const q = query(
    collection(db, 'companies', safeCompanyId, 'trips', safeTripId, 'trip_logs'),
    where('companyId', '==', safeCompanyId)
  );

  return onSnapshot(
    q,
    (snap) => {
      const logs = snap.docs.map((d) =>
        normalizeTimestamps<TripLog>({ id: d.id, ...d.data() })
      );
      onData(sortTripLogsDescending(logs));
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function getTripLogsFromFirestore(
  companyId: string,
  tripId: string
): Promise<TripLog[]> {
  if (!auth.currentUser || !isValidDocSegment(companyId) || !isValidDocSegment(tripId)) {
    return [];
  }
  const safeCompanyId = companyId.trim();
  const safeTripId = tripId.trim();
  const path = `companies/${safeCompanyId}/trips/${safeTripId}/trip_logs`;

  try {
    const q = query(
      collection(db, 'companies', safeCompanyId, 'trips', safeTripId, 'trip_logs'),
      where('companyId', '==', safeCompanyId)
    );
    const snap = await getDocs(q);
    const logs = snap.docs.map((d) =>
      normalizeTimestamps<TripLog>({ id: d.id, ...d.data() })
    );
    return sortTripLogsDescending(logs);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function saveTripLogInFirestore(
  companyId: string,
  tripId: string,
  log: Omit<TripLog, 'companyId' | 'tripId'> & { companyId?: string; tripId?: string }
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  if (!isValidDocSegment(tripId) || !isValidDocSegment(log?.id)) {
    throw new Error('Valid trip ID and log ID are required to save a trip log.');
  }
  const safeTripId = tripId.trim();
  const safeLogId = log.id.trim();
  const path = `companies/${safeCompanyId}/trips/${safeTripId}/trip_logs/${safeLogId}`;

  try {
    const ref = doc(db, 'companies', safeCompanyId, 'trips', safeTripId, 'trip_logs', safeLogId);
    const existingSnap = await getAuthoritativeDocSnap(ref);
    const existingData = existingSnap.exists() ? existingSnap.data() : null;
    const isNew = !existingSnap.exists();

    const payload = sanitizeTripLogPayload(safeCompanyId, safeTripId, { ...log, id: safeLogId }, existingData);
    if (!payload) {
      throw new Error('Status label and GPS/location note are required to save a trip log.');
    }

    const batch = writeBatch(db);
    if (!isNew && existingData && isFirestoreTimestamp(existingData.createdAt)) {
      batch.update(ref, buildServerPreservingUpdatePayload(existingData, payload));
    } else {
      batch.set(ref, payload);
    }

    addAuditLogToBatch(batch, safeCompanyId, {
      action: isNew ? 'CREATE' : 'UPDATE',
      entityType: 'TRIP_LOG',
      entityId: safeLogId,
      moduleName: 'TRIP_LOGS',
      summary: `${isNew ? 'Logged' : 'Updated'} trip status "${payload.status}" for ${
        payload.tripNumber || safeTripId
      } at ${payload.locationNote}`,
      updatedValues: {
        tripId: safeTripId,
        status: payload.status,
        locationNote: payload.locationNote,
      },
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteTripLogInFirestore(
  companyId: string,
  tripId: string,
  logId: string,
  statusLabel?: string
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  if (!isValidDocSegment(tripId) || !isValidDocSegment(logId)) return;
  const safeTripId = tripId.trim();
  const safeLogId = logId.trim();
  const path = `companies/${safeCompanyId}/trips/${safeTripId}/trip_logs/${safeLogId}`;

  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'companies', safeCompanyId, 'trips', safeTripId, 'trip_logs', safeLogId));
    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'DELETE',
      entityType: 'TRIP_LOG',
      entityId: safeLogId,
      moduleName: 'TRIP_LOGS',
      summary: `Removed trip log "${statusLabel || safeLogId}" from trip ${safeTripId}`,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Atomic Save / Delete Trip or Standalone Vehicle Expense + Recalculate Trip Expenses & Contribution
 */
export async function saveExpenseInFirestore(
  companyId: string,
  expense: TripExpense,
  trip: Trip | undefined,
  existingTripExpenses: TripExpense[] = []
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/expenses/${expense.id}`;
  try {
    const batch = writeBatch(db);
    const expDoc = await prepareBatchDoc(safeCompanyId, 'expenses', expense);
    writePreparedBatchDoc(batch, expDoc);

    if (trip && expense.tripId === trip.id) {
      const merged = [
        ...existingTripExpenses.filter((e) => e.id !== expense.id),
        expense,
      ];
      const newTotalExpenses = merged.reduce((s, e) => s + (e.amountPaise || 0), 0);
      const rev = trip.totalRevenuePaise || trip.freightAmountPaise || 0;
      const tripDoc = await prepareBatchDoc(safeCompanyId, 'trips', {
        ...trip,
        totalExpensesPaise: newTotalExpenses,
        tripContributionPaise: rev - newTotalExpenses,
      });
      writePreparedBatchDoc(batch, tripDoc);
    }

    const isFuel = expense.category === 'FUEL' || expense.category === 'DIESEL';
    addAuditLogToBatch(batch, safeCompanyId, {
      action: expDoc.isNew ? 'CREATE' : 'UPDATE',
      entityType: isFuel ? 'FUEL' : 'EXPENSE',
      entityId: expense.id,
      moduleName: isFuel ? 'FUEL' : 'EXPENSES',
      summary: `${expDoc.isNew ? 'Logged' : 'Updated'} ${expense.category} expense of ₹${(
        expense.amountPaise / 100
      ).toFixed(2)}`,
      previousValues: expDoc.existingData
        ? {
            category: expDoc.existingData.category,
            amountPaise: expDoc.existingData.amountPaise,
            paymentMode: expDoc.existingData.paymentMode,
          }
        : undefined,
      updatedValues: {
        category: expense.category,
        amountPaise: expense.amountPaise,
        paymentMode: expense.paymentMode,
      },
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteExpenseInFirestore(
  companyId: string,
  expense: TripExpense,
  trip: Trip | undefined,
  remainingTripExpenses: TripExpense[] = []
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/expenses/${expense.id}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'companies', safeCompanyId, 'expenses', expense.id.trim()));

    if (trip && expense.tripId === trip.id) {
      const newTotalExpenses = remainingTripExpenses
        .filter((e) => e.id !== expense.id)
        .reduce((s, e) => s + (e.amountPaise || 0), 0);
      const rev = trip.totalRevenuePaise || trip.freightAmountPaise || 0;
      const tripDoc = await prepareBatchDoc(safeCompanyId, 'trips', {
        ...trip,
        totalExpensesPaise: newTotalExpenses,
        tripContributionPaise: rev - newTotalExpenses,
      });
      writePreparedBatchDoc(batch, tripDoc);
    }

    const isFuel = expense.category === 'FUEL' || expense.category === 'DIESEL';
    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'DELETE',
      entityType: isFuel ? 'FUEL' : 'EXPENSE',
      entityId: expense.id,
      moduleName: isFuel ? 'FUEL' : 'EXPENSES',
      summary: `Deleted ${expense.category} expense of ₹${(expense.amountPaise / 100).toFixed(2)}`,
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Atomic Create, Update, Cancel, and Delete Driver Advances
 */
export async function createAdvanceInFirestore(
  companyId: string,
  advance: DriverAdvance,
  trip: Trip | undefined,
  driver: Driver | undefined
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/advances/${advance.id}`;
  try {
    const batch = writeBatch(db);
    const advDoc = await prepareBatchDoc(safeCompanyId, 'advances', {
      ...advance,
      status: advance.status || 'ACTIVE',
    });
    writePreparedBatchDoc(batch, advDoc);

    if (trip && advance.status !== 'CANCELLED') {
      const tripDoc = await prepareBatchDoc(safeCompanyId, 'trips', {
        ...trip,
        totalAdvancesPaise: (trip.totalAdvancesPaise || 0) + advance.amountPaise,
      });
      writePreparedBatchDoc(batch, tripDoc);
    }

    if (driver && advance.status !== 'CANCELLED') {
      const drvDoc = await prepareBatchDoc(safeCompanyId, 'drivers', {
        ...driver,
        currentAdvanceBalancePaise: (driver.currentAdvanceBalancePaise || 0) + advance.amountPaise,
      });
      writePreparedBatchDoc(batch, drvDoc);
    }

    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'CREATE',
      entityType: 'ADVANCE',
      entityId: advance.id,
      moduleName: 'ADVANCES',
      summary: `Disbursed advance of ₹${(advance.amountPaise / 100).toFixed(2)} to ${
        advance.driverName || driver?.fullName || 'driver'
      }`,
      updatedValues: {
        amountPaise: advance.amountPaise,
        advanceType: advance.advanceType,
        driverId: advance.driverId,
      },
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateAdvanceInFirestore(
  companyId: string,
  advance: DriverAdvance,
  trip: Trip | undefined,
  driver: Driver | undefined,
  allTripAdvances: DriverAdvance[] = [],
  allDriverAdvances: DriverAdvance[] = []
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/advances/${advance.id}`;
  try {
    const batch = writeBatch(db);
    const advDoc = await prepareBatchDoc(safeCompanyId, 'advances', advance);
    writePreparedBatchDoc(batch, advDoc);

    if (trip && advance.tripId === trip.id) {
      const nextTripAdvTotal = [...allTripAdvances.filter((a) => a.id !== advance.id), advance]
        .filter((a) => a.status !== 'CANCELLED')
        .reduce((s, a) => s + (a.amountPaise || 0), 0);
      const tripDoc = await prepareBatchDoc(safeCompanyId, 'trips', {
        ...trip,
        totalAdvancesPaise: nextTripAdvTotal,
      });
      writePreparedBatchDoc(batch, tripDoc);
    }

    if (driver && advance.driverId === driver.id) {
      const activeUnsettledDriverBal = [...allDriverAdvances.filter((a) => a.id !== advance.id), advance]
        .filter((a) => a.status !== 'CANCELLED' && !a.isSettled)
        .reduce((s, a) => s + (a.amountPaise || 0), 0);
      const drvDoc = await prepareBatchDoc(safeCompanyId, 'drivers', {
        ...driver,
        currentAdvanceBalancePaise: activeUnsettledDriverBal,
      });
      writePreparedBatchDoc(batch, drvDoc);
    }

    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'UPDATE',
      entityType: 'ADVANCE',
      entityId: advance.id,
      moduleName: 'ADVANCES',
      summary: `Updated advance record for ${advance.driverName || driver?.fullName || 'driver'} (₹${(
        advance.amountPaise / 100
      ).toFixed(2)})`,
      previousValues: advDoc.existingData
        ? {
            amountPaise: advDoc.existingData.amountPaise,
            advanceType: advDoc.existingData.advanceType,
            status: advDoc.existingData.status || 'ACTIVE',
          }
        : undefined,
      updatedValues: {
        amountPaise: advance.amountPaise,
        advanceType: advance.advanceType,
        status: advance.status || 'ACTIVE',
      },
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function cancelAdvanceInFirestore(
  companyId: string,
  advance: DriverAdvance,
  reason: string,
  cancelledBy?: string,
  trip?: Trip,
  driver?: Driver,
  allTripAdvances: DriverAdvance[] = [],
  allDriverAdvances: DriverAdvance[] = []
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/advances/${advance.id}`;
  try {
    const cancelledAdvance: DriverAdvance = {
      ...advance,
      status: 'CANCELLED',
      cancelledAt: new Date().toISOString(),
      cancellationReason: reason.trim(),
      cancelledBy: cancelledBy || auth.currentUser?.email || 'Owner',
    };

    const batch = writeBatch(db);
    const advDoc = await prepareBatchDoc(safeCompanyId, 'advances', cancelledAdvance);
    writePreparedBatchDoc(batch, advDoc);

    if (trip && advance.tripId === trip.id) {
      const nextTripAdvTotal = [
        ...allTripAdvances.filter((a) => a.id !== advance.id),
        cancelledAdvance,
      ]
        .filter((a) => a.status !== 'CANCELLED')
        .reduce((s, a) => s + (a.amountPaise || 0), 0);
      const tripDoc = await prepareBatchDoc(safeCompanyId, 'trips', {
        ...trip,
        totalAdvancesPaise: nextTripAdvTotal,
      });
      writePreparedBatchDoc(batch, tripDoc);
    }

    if (driver && advance.driverId === driver.id) {
      const activeUnsettledDriverBal = [
        ...allDriverAdvances.filter((a) => a.id !== advance.id),
        cancelledAdvance,
      ]
        .filter((a) => a.status !== 'CANCELLED' && !a.isSettled)
        .reduce((s, a) => s + (a.amountPaise || 0), 0);
      const drvDoc = await prepareBatchDoc(safeCompanyId, 'drivers', {
        ...driver,
        currentAdvanceBalancePaise: activeUnsettledDriverBal,
      });
      writePreparedBatchDoc(batch, drvDoc);
    }

    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'CANCEL',
      entityType: 'ADVANCE',
      entityId: advance.id,
      moduleName: 'ADVANCES',
      summary: `Cancelled advance of ₹${(advance.amountPaise / 100).toFixed(2)} for ${
        advance.driverName || driver?.fullName || 'driver'
      }: ${reason}`,
      previousValues: { status: advance.status || 'ACTIVE' },
      updatedValues: { status: 'CANCELLED', cancellationReason: reason },
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteAdvanceInFirestore(
  companyId: string,
  advance: DriverAdvance,
  trip?: Trip,
  driver?: Driver,
  remainingTripAdvances: DriverAdvance[] = [],
  remainingDriverAdvances: DriverAdvance[] = []
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/advances/${advance.id}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'companies', safeCompanyId, 'advances', advance.id.trim()));

    if (trip && advance.tripId === trip.id) {
      const nextTripAdvTotal = remainingTripAdvances
        .filter((a) => a.id !== advance.id && a.status !== 'CANCELLED')
        .reduce((s, a) => s + (a.amountPaise || 0), 0);
      const tripDoc = await prepareBatchDoc(safeCompanyId, 'trips', {
        ...trip,
        totalAdvancesPaise: nextTripAdvTotal,
      });
      writePreparedBatchDoc(batch, tripDoc);
    }

    if (driver && advance.driverId === driver.id) {
      const activeUnsettledDriverBal = remainingDriverAdvances
        .filter((a) => a.id !== advance.id && a.status !== 'CANCELLED' && !a.isSettled)
        .reduce((s, a) => s + (a.amountPaise || 0), 0);
      const drvDoc = await prepareBatchDoc(safeCompanyId, 'drivers', {
        ...driver,
        currentAdvanceBalancePaise: activeUnsettledDriverBal,
      });
      writePreparedBatchDoc(batch, drvDoc);
    }

    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'DELETE',
      entityType: 'ADVANCE',
      entityId: advance.id,
      moduleName: 'ADVANCES',
      summary: `Deleted advance of ₹${(advance.amountPaise / 100).toFixed(2)} for ${
        advance.driverName || 'driver'
      }`,
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Atomic Save / Finalize / Approve Driver Trip Settlement
 */
export async function saveSettlementInFirestore(
  companyId: string,
  settlement: TripSettlement,
  trip: Trip | undefined,
  driver: Driver | undefined,
  advancesToMarkSettled: DriverAdvance[] = [],
  expensesToMarkSettled: TripExpense[] = []
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/settlements/${settlement.id}`;
  try {
    const batch = writeBatch(db);
    const stlDoc = await prepareBatchDoc(safeCompanyId, 'settlements', settlement);
    writePreparedBatchDoc(batch, stlDoc);

    const isFinalized = settlement.status === 'FINALIZED' || settlement.status === 'APPROVED_SETTLED';

    if (trip) {
      const nextTripStatus: Trip['status'] =
        isFinalized ? 'SETTLED' : trip.status;
      const tripDoc = await prepareBatchDoc(safeCompanyId, 'trips', {
        ...trip,
        isSettled: isFinalized,
        status: nextTripStatus,
      });
      writePreparedBatchDoc(batch, tripDoc);
    }

    const overflowDocs: PreparedBatchDoc[] = [];
    const MAX_PRIMARY_CHILDREN = 8;
    let primaryChildCount = 0;

    if (isFinalized) {
      for (const adv of advancesToMarkSettled) {
        if (!adv.isSettled && adv.status !== 'CANCELLED') {
          const advDoc = await prepareBatchDoc(safeCompanyId, 'advances', {
            ...adv,
            status: 'SETTLED',
            isSettled: true,
            settlementId: settlement.id,
          });
          if (primaryChildCount < MAX_PRIMARY_CHILDREN) {
            writePreparedBatchDoc(batch, advDoc);
            primaryChildCount += 1;
          } else {
            overflowDocs.push(advDoc);
          }
        }
      }

      for (const exp of expensesToMarkSettled) {
        if (!exp.isSettled) {
          const expDoc = await prepareBatchDoc(safeCompanyId, 'expenses', {
            ...exp,
            isSettled: true,
            settlementId: settlement.id,
          });
          if (primaryChildCount < MAX_PRIMARY_CHILDREN) {
            writePreparedBatchDoc(batch, expDoc);
            primaryChildCount += 1;
          } else {
            overflowDocs.push(expDoc);
          }
        }
      }

      if (driver) {
        const settledAdvanceSum = advancesToMarkSettled
          .filter((a) => !a.isSettled && a.status !== 'CANCELLED')
          .reduce((s, a) => s + a.amountPaise, 0);
        const remainingBal = Math.max(0, (driver.currentAdvanceBalancePaise || 0) - settledAdvanceSum);
        const drvDoc = await prepareBatchDoc(safeCompanyId, 'drivers', {
          ...driver,
          currentAdvanceBalancePaise: remainingBal,
        });
        writePreparedBatchDoc(batch, drvDoc);
      }
    }

    addAuditLogToBatch(batch, safeCompanyId, {
      action: settlement.status === 'APPROVED_SETTLED' ? 'APPROVE' : 'SETTLE',
      entityType: 'SETTLEMENT',
      entityId: settlement.id,
      moduleName: 'SETTLEMENTS',
      summary: `${settlement.status} settlement ${settlement.settlementNumber || settlement.id} for ${
        settlement.driverName || 'driver'
      }`,
      updatedValues: {
        status: settlement.status,
        netPayableToDriverPaise: settlement.netPayableToDriverPaise,
        tripProfitLossPaise: settlement.tripProfitLossPaise,
      },
    });

    await batch.commit();

    const OVERFLOW_CHUNK = 8;
    for (let i = 0; i < overflowDocs.length; i += OVERFLOW_CHUNK) {
      const overflowBatch = writeBatch(db);
      for (const prepared of overflowDocs.slice(i, i + OVERFLOW_CHUNK)) {
        writePreparedBatchDoc(overflowBatch, prepared);
      }
      await overflowBatch.commit();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function approveSettlementInFirestore(
  companyId: string,
  settlement: TripSettlement,
  approvedBy: string,
  trip: Trip | undefined,
  driver: Driver | undefined,
  advancesToMarkSettled: DriverAdvance[] = [],
  expensesToMarkSettled: TripExpense[] = []
): Promise<void> {
  return saveSettlementInFirestore(
    companyId,
    {
      ...settlement,
      status: 'APPROVED_SETTLED',
      approvedBy,
      approvedAt: new Date().toISOString(),
    },
    trip,
    driver,
    advancesToMarkSettled,
    expensesToMarkSettled
  );
}

/**
 * Atomic Create / Update / Cancel Invoice + Update Trip & Customer Balances
 */
export async function createInvoiceInFirestore(
  companyId: string,
  invoice: Invoice,
  trip: Trip | undefined,
  customer: Customer | undefined
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/invoices/${invoice.id}`;
  try {
    const invDoc = await prepareBatchDoc(safeCompanyId, 'invoices', invoice);
    const tripDoc = trip
      ? await prepareBatchDoc(safeCompanyId, 'trips', {
          ...trip,
          isInvoiced: true,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
        })
      : null;
    const custDoc = customer
      ? await prepareBatchDoc(safeCompanyId, 'customers', {
          ...customer,
          currentOutstandingPaise:
            (customer.currentOutstandingPaise || 0) + (invoice.balanceDuePaise ?? invoice.totalAmountPaise),
          totalFreightBilledPaise:
            (customer.totalFreightBilledPaise || 0) + invoice.totalAmountPaise,
        })
      : null;

    try {
      const batch = writeBatch(db);
      writePreparedBatchDoc(batch, invDoc);
      if (tripDoc) writePreparedBatchDoc(batch, tripDoc);
      if (custDoc) writePreparedBatchDoc(batch, custDoc);
      await batch.commit();
    } catch (batchErr) {
      if (isPermissionDeniedError(batchErr)) {
        throw batchErr;
      }
      await setDoc(invDoc.ref, invDoc.payload);
      if (tripDoc) await setDoc(tripDoc.ref, tripDoc.payload);
      if (custDoc) await setDoc(custDoc.ref, custDoc.payload);
    }

    writeAuditLogBestEffort(safeCompanyId, {
      action: 'INVOICE',
      entityType: 'INVOICE',
      entityId: invoice.id,
      moduleName: 'INVOICES',
      summary: `Generated GST invoice ${invoice.invoiceNumber} for ₹${(
        invoice.totalAmountPaise / 100
      ).toFixed(2)}`,
      updatedValues: {
        invoiceNumber: invoice.invoiceNumber,
        totalAmountPaise: invoice.totalAmountPaise,
        status: invoice.status,
      },
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateInvoiceInFirestore(
  companyId: string,
  updatedInvoice: Invoice,
  previousInvoice: Invoice,
  customer: Customer | undefined
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/invoices/${updatedInvoice.id}`;
  try {
    const invDoc = await prepareBatchDoc(safeCompanyId, 'invoices', updatedInvoice);
    let custDoc: PreparedBatchDoc | null = null;
    if (customer) {
      const totalDelta = updatedInvoice.totalAmountPaise - previousInvoice.totalAmountPaise;
      const balanceDelta =
        (updatedInvoice.balanceDuePaise ?? updatedInvoice.totalAmountPaise) -
        (previousInvoice.balanceDuePaise ?? previousInvoice.totalAmountPaise);
      custDoc = await prepareBatchDoc(safeCompanyId, 'customers', {
        ...customer,
        currentOutstandingPaise: Math.max(0, (customer.currentOutstandingPaise || 0) + balanceDelta),
        totalFreightBilledPaise: Math.max(0, (customer.totalFreightBilledPaise || 0) + totalDelta),
      });
    }

    try {
      const batch = writeBatch(db);
      writePreparedBatchDoc(batch, invDoc);
      if (custDoc) writePreparedBatchDoc(batch, custDoc);
      await batch.commit();
    } catch (batchErr) {
      if (isPermissionDeniedError(batchErr)) {
        throw batchErr;
      }
      await setDoc(invDoc.ref, invDoc.payload);
      if (custDoc) await setDoc(custDoc.ref, custDoc.payload);
    }

    writeAuditLogBestEffort(safeCompanyId, {
      action: 'UPDATE',
      entityType: 'INVOICE',
      entityId: updatedInvoice.id,
      moduleName: 'INVOICES',
      summary: `Updated invoice ${updatedInvoice.invoiceNumber} (₹${(
        updatedInvoice.totalAmountPaise / 100
      ).toFixed(2)})`,
      previousValues: {
        totalAmountPaise: previousInvoice.totalAmountPaise,
        discountPaise: previousInvoice.discountPaise || 0,
        status: previousInvoice.status,
      },
      updatedValues: {
        totalAmountPaise: updatedInvoice.totalAmountPaise,
        discountPaise: updatedInvoice.discountPaise || 0,
        status: updatedInvoice.status,
      },
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function cancelInvoiceInFirestore(
  companyId: string,
  invoice: Invoice,
  trip: Trip | undefined,
  customer: Customer | undefined,
  reason: string
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/invoices/${invoice.id}`;
  try {
    const invDoc = await prepareBatchDoc(safeCompanyId, 'invoices', {
      ...invoice,
      status: 'CANCELLED',
      paymentStatus: 'CANCELLED',
      balanceDuePaise: 0,
      cancelledAt: new Date().toISOString(),
      cancellationReason: reason,
    });
    const tripDoc = (trip && trip.invoiceId === invoice.id)
      ? await prepareBatchDoc(safeCompanyId, 'trips', {
          ...trip,
          isInvoiced: false,
          invoiceId: undefined,
          invoiceNumber: undefined,
        })
      : null;
    const custDoc = customer
      ? await prepareBatchDoc(safeCompanyId, 'customers', {
          ...customer,
          currentOutstandingPaise: Math.max(
            0,
            (customer.currentOutstandingPaise || 0) - (invoice.balanceDuePaise ?? invoice.totalAmountPaise)
          ),
        })
      : null;

    try {
      const batch = writeBatch(db);
      writePreparedBatchDoc(batch, invDoc);
      if (tripDoc) writePreparedBatchDoc(batch, tripDoc);
      if (custDoc) writePreparedBatchDoc(batch, custDoc);
      await batch.commit();
    } catch (batchErr) {
      if (isPermissionDeniedError(batchErr)) {
        throw batchErr;
      }
      await setDoc(invDoc.ref, invDoc.payload);
      if (tripDoc) await setDoc(tripDoc.ref, tripDoc.payload);
      if (custDoc) await setDoc(custDoc.ref, custDoc.payload);
    }

    writeAuditLogBestEffort(safeCompanyId, {
      action: 'CANCEL',
      entityType: 'INVOICE',
      entityId: invoice.id,
      moduleName: 'INVOICES',
      summary: `Cancelled invoice ${invoice.invoiceNumber}: ${reason}`,
      previousValues: { status: invoice.status },
      updatedValues: { status: 'CANCELLED', cancellationReason: reason },
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

/**
 * Atomic Record Customer Payment + Update Invoice Paid/Balance + Decrement Customer Outstanding
 */
export async function recordPaymentInFirestore(
  companyId: string,
  payment: Payment,
  invoice: Invoice,
  customer: Customer | undefined
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/payments/${payment.id}`;
  try {
    const payDoc = await prepareBatchDoc(safeCompanyId, 'payments', payment);
    const creditAmount = payment.amountPaise + (payment.tdsDeductedPaise || 0);
    const newPaid = Math.min(invoice.totalAmountPaise, (invoice.amountPaidPaise || 0) + creditAmount);
    const newBalance = Math.max(0, invoice.totalAmountPaise - newPaid);
    const isFullyPaid = newBalance === 0;

    const invDoc = await prepareBatchDoc(safeCompanyId, 'invoices', {
      ...invoice,
      amountPaidPaise: newPaid,
      balanceDuePaise: newBalance,
      status: isFullyPaid ? 'PAID' : 'PARTIALLY_PAID',
      paymentStatus: isFullyPaid ? 'PAID' : 'PARTIALLY_PAID',
    });

    const custDoc = customer
      ? await prepareBatchDoc(safeCompanyId, 'customers', {
          ...customer,
          currentOutstandingPaise: Math.max(0, (customer.currentOutstandingPaise || 0) - creditAmount),
        })
      : null;

    try {
      const batch = writeBatch(db);
      writePreparedBatchDoc(batch, payDoc);
      writePreparedBatchDoc(batch, invDoc);
      if (custDoc) writePreparedBatchDoc(batch, custDoc);
      await batch.commit();
    } catch (batchErr) {
      if (isPermissionDeniedError(batchErr)) {
        throw batchErr;
      }
      await setDoc(payDoc.ref, payDoc.payload);
      await setDoc(invDoc.ref, invDoc.payload);
      if (custDoc) await setDoc(custDoc.ref, custDoc.payload);
    }

    writeAuditLogBestEffort(safeCompanyId, {
      action: 'PAYMENT',
      entityType: 'PAYMENT',
      entityId: payment.id,
      summary: `Recorded payment ₹${(payment.amountPaise / 100).toFixed(2)} against ${invoice.invoiceNumber}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

/**
 * Atomic Save / Delete Vehicle Compliance Document + Sync Inline Expiry on Vehicle
 */
export async function saveDocumentInFirestore(
  companyId: string,
  docItem: VehicleDocument,
  vehicle?: Vehicle
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/documents/${docItem.id}`;
  try {
    const comp = calculateDocComplianceStatus(docItem.expiryDate);
    const enrichedDoc: VehicleDocument = {
      ...docItem,
      daysUntilExpiry: comp.daysUntilExpiry,
      status: comp.status,
    };

    const batch = writeBatch(db);
    const docEntry = await prepareBatchDoc(safeCompanyId, 'documents', enrichedDoc);
    writePreparedBatchDoc(batch, docEntry);

    if (vehicle) {
      const updatedVeh = { ...vehicle };
      if (docItem.docType === 'INSURANCE') {
        updatedVeh.insuranceExpiry = docItem.expiryDate;
        updatedVeh.insurancePolicyNumber = docItem.documentNumber;
      } else if (docItem.docType === 'FITNESS') {
        updatedVeh.fitnessExpiry = docItem.expiryDate;
        updatedVeh.fitnessCertificateNumber = docItem.documentNumber;
      } else if (docItem.docType === 'NATIONAL_PERMIT' || docItem.docType === 'STATE_PERMIT') {
        updatedVeh.permitExpiry = docItem.expiryDate;
        updatedVeh.permitNumber = docItem.documentNumber;
        updatedVeh.permitType = docItem.docType === 'NATIONAL_PERMIT' ? 'NATIONAL' : 'STATE';
      } else if (docItem.docType === 'PUC') {
        updatedVeh.pucExpiry = docItem.expiryDate;
        updatedVeh.pucNumber = docItem.documentNumber;
      }
      const vehDoc = await prepareBatchDoc(safeCompanyId, 'vehicles', updatedVeh);
      writePreparedBatchDoc(batch, vehDoc);
    }

    addAuditLogToBatch(batch, safeCompanyId, {
      action: docEntry.isNew ? 'CREATE' : 'UPDATE',
      entityType: 'DOCUMENT',
      entityId: docItem.id,
      summary: `${docEntry.isNew ? 'Added' : 'Updated'} ${docItem.docType} (#${docItem.documentNumber})`,
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteDocumentInFirestore(
  companyId: string,
  docId: string,
  label?: string
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  if (!isValidDocSegment(docId)) return;
  const path = `companies/${safeCompanyId}/documents/${docId}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'companies', safeCompanyId, 'documents', docId.trim()));
    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'DELETE',
      entityType: 'DOCUMENT',
      entityId: docId.trim(),
      moduleName: 'DOCUMENTS',
      summary: `Deleted compliance document ${label || docId}`,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Atomic Save / Delete Vehicle Maintenance Record (+ optional odometer sync if newer)
 */
export async function saveMaintenanceInFirestore(
  companyId: string,
  record: MaintenanceRecord,
  vehicle?: Vehicle
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/maintenance/${record.id}`;
  try {
    const batch = writeBatch(db);
    const maintDoc = await prepareBatchDoc(safeCompanyId, 'maintenance', record);
    writePreparedBatchDoc(batch, maintDoc);

    if (
      vehicle &&
      typeof record.odometerReading === 'number' &&
      record.odometerReading > (vehicle.currentOdometerKm || 0)
    ) {
      const vehDoc = await prepareBatchDoc(safeCompanyId, 'vehicles', {
        ...vehicle,
        currentOdometerKm: record.odometerReading,
      });
      writePreparedBatchDoc(batch, vehDoc);
    }

    addAuditLogToBatch(batch, safeCompanyId, {
      action: maintDoc.isNew ? 'CREATE' : 'UPDATE',
      entityType: 'MAINTENANCE',
      entityId: record.id,
      moduleName: 'MAINTENANCE',
      summary: `${maintDoc.isNew ? 'Logged' : 'Updated'} ${record.serviceType} for ${
        record.vehicleReg || record.vehicleId
      } (₹${(record.costPaise / 100).toFixed(2)})`,
      updatedValues: {
        serviceType: record.serviceType,
        costPaise: record.costPaise,
        serviceDate: record.serviceDate,
      },
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteMaintenanceInFirestore(
  companyId: string,
  maintenanceId: string,
  label?: string
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  if (!isValidDocSegment(maintenanceId)) return;
  const safeId = maintenanceId.trim();
  const path = `companies/${safeCompanyId}/maintenance/${safeId}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'companies', safeCompanyId, 'maintenance', safeId));
    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'DELETE',
      entityType: 'MAINTENANCE',
      entityId: safeId,
      moduleName: 'MAINTENANCE',
      summary: `Deleted maintenance record ${label || safeId}`,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Save / Delete Broker
 */
export async function saveBrokerInFirestore(companyId: string, broker: Broker): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/brokers/${broker.id}`;
  try {
    const batch = writeBatch(db);
    const brkDoc = await prepareBatchDoc(safeCompanyId, 'brokers', broker);
    writePreparedBatchDoc(batch, brkDoc);
    addAuditLogToBatch(batch, safeCompanyId, {
      action: brkDoc.isNew ? 'CREATE' : 'UPDATE',
      entityType: 'BROKER',
      entityId: broker.id,
      moduleName: 'BROKERS',
      summary: `${brkDoc.isNew ? 'Added' : 'Updated'} freight broker ${broker.name}`,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteBrokerInFirestore(
  companyId: string,
  brokerId: string,
  name?: string
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  if (!isValidDocSegment(brokerId)) return;
  const path = `companies/${safeCompanyId}/brokers/${brokerId}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'companies', safeCompanyId, 'brokers', brokerId.trim()));
    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'DELETE',
      entityType: 'BROKER',
      entityId: brokerId.trim(),
      moduleName: 'BROKERS',
      summary: `Deleted freight broker ${name || brokerId}`,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Record / List / Delete Uploaded File Record Metadata in Firestore
 * Stores strict UID-isolated metadata at /users/{uid}/files/{fileId}
 * and optionally indexes company-linked records at /companies/{companyId}/fileRecords/{fileId}.
 */
export async function recordUserFileMetadataInFirestore(
  metadata: {
    fileId: string;
    fileName: string;
    originalFileName: string;
    storagePath: string;
    downloadURL: string;
    contentType: string;
    fileSize: number;
    category: StorageFileCategory;
    relatedRecordId?: string;
    companyId?: string;
    entityType?: string;
    entityId?: string;
    uploadedByName?: string;
  }
): Promise<UserFileMetadata> {
  if (!auth.currentUser) {
    throw new Error('Authentication required to save file metadata.');
  }
  if (!isVerifiedEmailUser()) {
    throw new Error('Email verification required to save file metadata.');
  }
  const uid = auth.currentUser.uid;
  const fileId = isValidDocSegment(metadata.fileId)
    ? metadata.fileId.trim()
    : `fil_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  if (!metadata.storagePath.startsWith(`users/${uid}/`)) {
    throw new Error('Access denied: file storagePath must belong to the authenticated user.');
  }

  const category: StorageFileCategory = VALID_STORAGE_FOLDERS.includes(metadata.category)
    ? metadata.category
    : 'other';
  const userFilePath = `users/${uid}/files/${fileId}`;

  const cleanFileName = clipStr(metadata.fileName, 250) || 'document';
  const cleanOriginalFileName = clipStr(metadata.originalFileName, 250) || cleanFileName;
  const cleanStoragePath = clipStr(metadata.storagePath, 500) || metadata.storagePath;
  const cleanDownloadURL = clipStr(metadata.downloadURL, 2000) || metadata.downloadURL;
  const cleanContentType = clipStr(metadata.contentType, 120) || 'application/octet-stream';
  const cleanFileSize = Math.max(1, Number(metadata.fileSize) || 1);
  const cleanRelatedRecordId = clipStr(metadata.relatedRecordId || metadata.entityId, 128);
  const cleanCompanyId = isValidDocSegment(metadata.companyId) ? metadata.companyId!.trim() : undefined;

  const userFilePayload = stripUndefined({
    id: fileId,
    fileId,
    companyId: cleanCompanyId,
    fileName: cleanFileName,
    originalFileName: cleanOriginalFileName,
    storagePath: cleanStoragePath,
    downloadURL: cleanDownloadURL,
    downloadUrl: cleanDownloadURL,
    contentType: cleanContentType,
    mimeType: cleanContentType,
    fileSize: cleanFileSize,
    sizeBytes: cleanFileSize,
    uploadedBy: uid,
    uploadedByUid: uid,
    uploadedByName: clipStr(
      metadata.uploadedByName || auth.currentUser.displayName || auth.currentUser.email || undefined,
      100
    ),
    uploadedAt: serverTimestamp(),
    relatedRecordId: cleanRelatedRecordId,
    entityType: clipStr(metadata.entityType, 40),
    entityId: clipStr(metadata.entityId || cleanRelatedRecordId, 128),
    category,
    folder: category,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await setDoc(doc(db, 'users', uid, 'files', fileId), userFilePayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, userFilePath);
  }

  if (cleanCompanyId) {
    await recordFileUploadInFirestore(cleanCompanyId, {
      id: fileId,
      fileId,
      companyId: cleanCompanyId,
      uploadedBy: uid,
      uploadedByUid: uid,
      uploadedByName: userFilePayload.uploadedByName,
      folder: category,
      category,
      fileName: cleanFileName,
      originalFileName: cleanOriginalFileName,
      mimeType: cleanContentType,
      contentType: cleanContentType,
      sizeBytes: cleanFileSize,
      fileSize: cleanFileSize,
      storagePath: cleanStoragePath,
      downloadUrl: cleanDownloadURL,
      downloadURL: cleanDownloadURL,
      relatedRecordId: cleanRelatedRecordId,
      entityType: userFilePayload.entityType,
      entityId: userFilePayload.entityId,
    });
  }

  return {
    fileId,
    fileName: cleanFileName,
    originalFileName: cleanOriginalFileName,
    storagePath: cleanStoragePath,
    downloadURL: cleanDownloadURL,
    contentType: cleanContentType,
    fileSize: cleanFileSize,
    uploadedBy: uid,
    uploadedAt: new Date().toISOString(),
    relatedRecordId: cleanRelatedRecordId,
    category,
    companyId: cleanCompanyId,
    entityType: userFilePayload.entityType,
    entityId: userFilePayload.entityId,
    uploadedByName: userFilePayload.uploadedByName,
  };
}

export async function fetchUserFilesFromFirestore(
  uid?: string
): Promise<UserFileMetadata[]> {
  if (!auth.currentUser || !isVerifiedEmailUser()) return [];
  const targetUid = (uid || auth.currentUser.uid).trim();
  if (!isValidDocSegment(targetUid) || targetUid !== auth.currentUser.uid) {
    throw new Error('Access denied: cannot query another user’s files.');
  }
  const path = `users/${targetUid}/files`;
  try {
    const snap = await getDocs(collection(db, 'users', targetUid, 'files'));
    return snap.docs
      .map((d) => normalizeTimestamps<UserFileMetadata>({ ...d.data(), fileId: d.id }))
      .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export function subscribeToUserFilesInFirestore(
  uid: string,
  onFiles: (files: UserFileMetadata[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!auth.currentUser || !isVerifiedEmailUser() || !isValidDocSegment(uid) || uid.trim() !== auth.currentUser.uid) {
    onFiles([]);
    return () => {};
  }
  const safeUid = uid.trim();
  const path = `users/${safeUid}/files`;
  return onSnapshot(
    collection(db, 'users', safeUid, 'files'),
    (snap) => {
      const items = snap.docs
        .map((d) => normalizeTimestamps<UserFileMetadata>({ ...d.data(), fileId: d.id }))
        .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
      onFiles(items);
    },
    (err) => {
      if (onError) onError(err);
      else console.warn(`User files listener notice (${path}):`, err);
    }
  );
}

export async function deleteUserFileMetadataInFirestore(params: {
  fileId: string;
  companyId?: string;
  fileName?: string;
}): Promise<void> {
  if (!auth.currentUser || !isVerifiedEmailUser()) {
    throw new Error('Verified authentication required to delete file metadata.');
  }
  const uid = auth.currentUser.uid;
  if (!isValidDocSegment(params.fileId)) {
    throw new Error('Valid fileId is required.');
  }
  const safeFileId = params.fileId.trim();
  const userFilePath = `users/${uid}/files/${safeFileId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'files', safeFileId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, userFilePath);
  }

  if (isValidDocSegment(params.companyId)) {
    try {
      await deleteFileRecordInFirestore(params.companyId!.trim(), safeFileId, params.fileName);
    } catch (err) {
      // If company fileRecord does not exist, ignore only missing errors; otherwise surface
      if (!String((err as any)?.code || '').includes('not-found')) {
        throw err;
      }
    }
  }
}

export async function recordFileUploadInFirestore(
  companyId: string,
  fileRec: FileRecord
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/fileRecords/${fileRec.id}`;
  try {
    const batch = writeBatch(db);
    const recDoc = await prepareBatchDoc(safeCompanyId, 'fileRecords', fileRec);
    writePreparedBatchDoc(batch, recDoc);
    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'CREATE',
      entityType: 'FILE_RECORD',
      entityId: fileRec.id,
      moduleName: 'DOCUMENTS',
      summary: `Uploaded ${fileRec.category || fileRec.folder} document: ${fileRec.originalFileName || fileRec.fileName}`,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteFileRecordInFirestore(
  companyId: string,
  fileId: string,
  fileName?: string
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  if (!isValidDocSegment(fileId)) return;
  const path = `companies/${safeCompanyId}/fileRecords/${fileId}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'companies', safeCompanyId, 'fileRecords', fileId.trim()));
    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'DELETE',
      entityType: 'FILE_RECORD',
      entityId: fileId.trim(),
      moduleName: 'DOCUMENTS',
      summary: `Removed file record ${fileName || fileId}`,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Save Company Operational & Billing Preferences (/companies/{companyId}/settings/{settingId})
 */
export async function saveCompanySettingsInFirestore(
  companyId: string,
  settings: Partial<CompanySettings> & { id?: string }
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const settingId = isValidDocSegment(settings.id) ? settings.id.trim() : 'default';
  const path = `companies/${safeCompanyId}/settings/${settingId}`;
  try {
    const batch = writeBatch(db);
    const stDoc = await prepareBatchDoc(safeCompanyId, 'settings', {
      ...settings,
      id: settingId,
      companyId: safeCompanyId,
      updatedByUid: auth.currentUser?.uid,
    });
    writePreparedBatchDoc(batch, stDoc);
    addAuditLogToBatch(batch, safeCompanyId, {
      action: stDoc.isNew ? 'CREATE' : 'UPDATE',
      entityType: 'SETTINGS',
      entityId: settingId,
      moduleName: 'SETTINGS',
      summary: `Updated company operational & GST billing preferences`,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}


