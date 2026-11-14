/**
 * AnchorTransport TMS - Client Firestore Service Layer
 * Direct persistence & hydration against Firestore DB:
 * ai-studio-anchortransportt-c5041a54-7d47-45d6-a1f6-5144adf1df5d
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  type DocumentData,
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
  Trip,
  TripExpense,
  DriverAdvance,
  TripSettlement,
  Invoice,
  Payment,
  VehicleDocument,
  MaintenanceRecord,
  AuditLog,
  UserRole,
} from '../../types/tms';

export { OperationType, handleFirestoreError };

export interface HydratedCompanyBundle {
  vehicles: Vehicle[];
  drivers: Driver[];
  customers: Customer[];
  trips: Trip[];
  expenses: TripExpense[];
  advances: DriverAdvance[];
  settlements: TripSettlement[];
  invoices: Invoice[];
  payments: Payment[];
  documents: VehicleDocument[];
  maintenance: MaintenanceRecord[];
}

export interface FirestoreUserProfile {
  id: string;
  email: string;
  name: string;
  phone?: string;
  defaultCompanyId?: string;
  activeCompanyId?: string;
  role?: UserRole;
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
  joinedAt?: string;
  updatedAt?: string;
}

/**
 * Checks whether the active Firebase user has verified their email address
 * (Required by firestore.rules isVerifiedUser() for all writes)
 */
export function isVerifiedEmailUser(): boolean {
  return Boolean(auth.currentUser && auth.currentUser.emailVerified);
}

function isValidDocSegment(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('/');
}

const BOOTSTRAPPED_ADMIN_EMAIL = 'kunduankit129@gmail.com';

function isBootstrappedAdminUser(): boolean {
  return Boolean(
    auth.currentUser &&
      auth.currentUser.emailVerified &&
      auth.currentUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL
  );
}

/**
 * Checks whether the active signed-in Firebase user holds an ACTIVE member record
 * at /companies/{companyId}/members/{uid} (or is the verified bootstrapped admin).
 * Reading one's own member document is always permitted for signed-in users.
 */
export async function hasActiveCompanyMembershipInFirestore(companyId: string): Promise<boolean> {
  if (!auth.currentUser || !isValidDocSegment(companyId) || !isValidDocSegment(auth.currentUser.uid)) {
    return false;
  }
  if (isBootstrappedAdminUser()) return true;
  try {
    const memberSnap = await getDoc(
      doc(db, 'companies', companyId.trim(), 'members', auth.currentUser.uid)
    );
    return memberSnap.exists() && memberSnap.data()?.status === 'ACTIVE';
  } catch {
    return false;
  }
}

/**
 * Recursively strips undefined fields before sending to Firestore
 */
function stripUndefined<T extends Record<string, any>>(obj: T): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue;
    if (
      val !== null &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      !(val instanceof Timestamp) &&
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

/**
 * Converts Firestore Timestamp fields back into ISO date strings for UI / REST consistency
 */
function normalizeTimestamps<T>(raw: DocumentData): T {
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
function sanitizeSubcollectionPayload(
  subcollection: CompanySubcollection,
  companyId: string,
  item: Record<string, any>,
  existingData?: DocumentData | null
): Record<string, any> | null {
  const createdAt =
    existingData?.createdAt instanceof Timestamp
      ? existingData.createdAt
      : serverTimestamp();
  const updatedAt = serverTimestamp();

  switch (subcollection) {
    case 'vehicles': {
      const reg = clipStr(item.registrationNumber, 30);
      const vType = clipStr(item.vehicleType, 60);
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
      const fullName = clipStr(item.fullName, 100);
      const phone = clipStr(item.phone, 20);
      const licenseNumber = clipStr(item.licenseNumber, 40);
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
        joinedDate: clipStr(item.joinedDate, 30) ?? clipStr(existingData?.joinedDate, 30),
        createdAt,
        updatedAt,
      });
    }

    case 'customers': {
      const name = clipStr(item.name, 150);
      const phone = clipStr(item.phone, 20);
      const gstin = clipStr(item.gstin, 20);
      if (!name || !phone || !gstin) return null;
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

    case 'trips': {
      const tripNumber = clipStr(item.tripNumber, 50);
      const vehicleId = clipStr(item.vehicleId, 128);
      const driverId = clipStr(item.driverId, 128);
      const customerId = clipStr(item.customerId, 128);
      const status = VALID_TRIP_STATUSES.includes(item.status) ? item.status : 'PLANNED';
      const freightAmountPaise = Math.max(0, toNum(item.freightAmountPaise, 0) || 0);
      const totalRevenuePaise = Math.max(0, toNum(item.totalRevenuePaise, freightAmountPaise) || 0);
      if (!tripNumber || !vehicleId || !driverId || !customerId) return null;
      return stripUndefined({
        id: item.id,
        companyId,
        tripNumber,
        lrNumber: clipStr(item.lrNumber, 50),
        customerId,
        customerName: clipStr(item.customerName, 150),
        customerGstin: clipStr(item.customerGstin, 20),
        vehicleId,
        vehicleReg: clipStr(item.vehicleReg, 30),
        driverId,
        driverName: clipStr(item.driverName, 100),
        driverPhone: clipStr(item.driverPhone, 20),
        originCity: clipStr(item.originCity, 100),
        destinationCity: clipStr(item.destinationCity, 100),
        goodsType: clipStr(item.goodsType, 120),
        weightTonnes: toNum(item.weightTonnes),
        ratePerTonnePaise: toNum(item.ratePerTonnePaise),
        freightAmountPaise,
        otherChargesPaise: toNum(item.otherChargesPaise),
        totalRevenuePaise,
        dispatchDate: clipStr(item.dispatchDate, 40),
        expectedDeliveryDate: clipStr(item.expectedDeliveryDate, 40),
        actualDeliveryDate: clipStr(item.actualDeliveryDate, 40),
        status,
        startOdometerKm: toNum(item.startOdometerKm),
        endOdometerKm: toNum(item.endOdometerKm),
        podReceived: typeof item.podReceived === 'boolean' ? item.podReceived : undefined,
        podDocumentUrl: clipStr(item.podDocumentUrl, 500),
        podRemarks: clipStr(item.podRemarks, 300),
        totalExpensesPaise: toNum(item.totalExpensesPaise),
        totalAdvancesPaise: toNum(item.totalAdvancesPaise),
        tripContributionPaise: toNum(item.tripContributionPaise),
        isSettled: typeof item.isSettled === 'boolean' ? item.isSettled : undefined,
        isInvoiced: typeof item.isInvoiced === 'boolean' ? item.isInvoiced : undefined,
        invoiceId: clipStr(item.invoiceId, 128),
        invoiceNumber: clipStr(item.invoiceNumber, 50),
        cancellationReason: clipStr(item.cancellationReason, 300),
        cancelledAt: clipStr(item.cancelledAt, 40),
        cancelledBy: clipStr(item.cancelledBy, 100),
        notes: clipStr(item.notes, 500),
        createdAt,
        updatedAt,
      });
    }

    case 'expenses': {
      const tripId = clipStr(item.tripId, 128);
      const category = VALID_EXPENSE_CATEGORIES.includes(item.category) ? item.category : 'OTHER';
      const paymentMode = VALID_EXPENSE_PAYMENT_MODES.includes(item.paymentMode) ? item.paymentMode : 'CASH';
      const amountPaise = toNum(item.amountPaise, 0) || 0;
      if (!tripId || amountPaise <= 0) return null;
      return stripUndefined({
        id: item.id,
        companyId,
        tripId,
        tripNumber: clipStr(item.tripNumber, 50),
        vehicleId: clipStr(item.vehicleId, 128),
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
        receiptUrl: clipStr(item.receiptUrl, 500),
        receiptAttachmentUrl: clipStr(item.receiptAttachmentUrl, 500),
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
      if (!tripId || !driverId || amountPaise <= 0) return null;
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
      if (!invoiceNumber || !tripId || !customerId) return null;
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
        documentUrl: clipStr(item.documentUrl, 500),
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

/**
 * Ensures /users/{uid} profile exists in Firestore and returns it
 */
export async function ensureFirestoreUserProfile(
  fbUser: FirebaseUser
): Promise<FirestoreUserProfile | null> {
  if (!auth.currentUser || !isValidDocSegment(fbUser?.uid)) return null;
  const userPath = `users/${fbUser.uid}`;
  const userRef = doc(db, 'users', fbUser.uid);

  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const existingRaw = snap.data();
      const existingProfile = normalizeTimestamps<FirestoreUserProfile>(existingRaw);
      // Legacy backfill: if user already has a company linked in Firestore, ensure onboardingCompleted is permanently true
      if (
        existingProfile.onboardingCompleted !== true &&
        (existingProfile.activeCompanyId || existingProfile.defaultCompanyId) &&
        isVerifiedEmailUser()
      ) {
        const completedAt = existingProfile.onboardingCompletedAt || new Date().toISOString();
        await updateDoc(userRef, {
          onboardingCompleted: true,
          updatedAt: serverTimestamp(),
          ...(existingRaw.onboardingCompletedAt === undefined
            ? { onboardingCompletedAt: completedAt }
            : {}),
        });
        return {
          ...existingProfile,
          onboardingCompleted: true,
          onboardingCompletedAt: completedAt,
        };
      }
      return existingProfile;
    }

    if (!isVerifiedEmailUser()) {
      // Security rules require email_verified == true to create /users/{uid}
      return {
        id: fbUser.uid,
        email: (fbUser.email || '').toLowerCase(),
        name: (fbUser.displayName || fbUser.email?.split('@')[0] || 'Fleet User').slice(0, 100),
        phone: fbUser.phoneNumber || '',
        onboardingCompleted: false,
      };
    }

    const newUserDoc = stripUndefined({
      id: fbUser.uid,
      email: (fbUser.email || '').toLowerCase().slice(0, 200),
      name: (fbUser.displayName || fbUser.email?.split('@')[0] || 'Fleet User').slice(0, 100),
      phone: clipStr(fbUser.phoneNumber, 20) || '',
      onboardingCompleted: false,
      ...(clipStr(fbUser.photoURL, 500) ? { photoUrl: clipStr(fbUser.photoURL, 500) } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
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
    let snap = await getDoc(userRef);
    if (!snap.exists()) {
      await ensureFirestoreUserProfile(auth.currentUser);
      snap = await getDoc(userRef);
    }
    if (!snap.exists()) return;
    const existingData = snap.data() || {};

    const alreadyCompleted = existingData.onboardingCompleted === true;
    const nextOnboardingCompleted = alreadyCompleted
      ? true
      : updates.onboardingCompleted !== undefined
      ? Boolean(updates.onboardingCompleted)
      : existingData.onboardingCompleted;

    const updatePayload: Record<string, any> = {
      updatedAt: serverTimestamp(),
    };

    const nextName = clipStr(updates.name, 100);
    if (nextName !== undefined) {
      updatePayload.name = nextName;
    }
    if (updates.phone !== undefined) {
      updatePayload.phone = clipStr(updates.phone, 20) || '';
    }
    const nextDefaultCompanyId = clipStr(updates.defaultCompanyId, 128);
    if (nextDefaultCompanyId !== undefined) {
      updatePayload.defaultCompanyId = nextDefaultCompanyId;
    }
    const nextActiveCompanyId = clipStr(updates.activeCompanyId, 128);
    if (nextActiveCompanyId !== undefined) {
      updatePayload.activeCompanyId = nextActiveCompanyId;
    }
    if (nextOnboardingCompleted !== undefined) {
      updatePayload.onboardingCompleted = nextOnboardingCompleted;
    }
    if (
      nextOnboardingCompleted === true &&
      existingData.onboardingCompletedAt === undefined
    ) {
      updatePayload.onboardingCompletedAt =
        clipStr(updates.onboardingCompletedAt, 40) || new Date().toISOString();
    }

    await updateDoc(userRef, updatePayload);
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
 * Fetches user's company & membership from Firestore
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
    const memberSnap = await getDoc(doc(db, 'companies', safeCompanyId, 'members', safeUid));
    if (!memberSnap.exists() && !isBootstrappedAdminUser()) {
      return null;
    }

    const companySnap = await getDoc(doc(db, 'companies', safeCompanyId));
    if (!companySnap.exists()) return null;

    const company = normalizeTimestamps<Company>(companySnap.data());
    const memberData = memberSnap.exists() ? memberSnap.data() : null;
    const role = (memberData?.role as UserRole) || 'OWNER';

    return { company, role };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, companyPath);
  }
}

/**
 * Fetches team members inside /companies/{companyId}/members from Firestore
 */
export async function fetchCompanyMembersFromFirestore(
  companyId: string
): Promise<FirestoreCompanyMember[]> {
  if (!auth.currentUser || !isValidDocSegment(companyId)) return [];
  const safeCompanyId = companyId.trim();
  const path = `companies/${safeCompanyId}/members`;
  try {
    const hasAccess = await hasActiveCompanyMembershipInFirestore(safeCompanyId);
    if (!hasAccess) return [];
    const snap = await getDocs(collection(db, 'companies', safeCompanyId, 'members'));
    return snap.docs.map((d) =>
      normalizeTimestamps<FirestoreCompanyMember>({ id: d.id, ...d.data() })
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

/**
 * Atomically creates Company + initial OWNER Member + updates User's defaultCompanyId
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

    const existingMemberSnap = await getDoc(doc(db, 'companies', company.id, 'members', fbUser.uid));
    if (existingMemberSnap.exists()) {
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

    const companyRef = doc(db, 'companies', company.id);
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
      logoUrl: clipStr(company.logoUrl, 500),
      ownerId: fbUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(companyRef, companyPayload);

    const memberRef = doc(db, 'companies', company.id, 'members', fbUser.uid);
    const memberPayload = stripUndefined({
      id: fbUser.uid,
      userId: fbUser.uid,
      companyId: company.id,
      role: 'OWNER',
      name: clipStr(fbUser.displayName || userExisting.name || company.name, 100),
      email: clipStr(fbUser.email || userExisting.email, 200)?.toLowerCase() || '',
      status: 'ACTIVE',
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(memberRef, memberPayload);

    const userRef = doc(db, 'users', fbUser.uid);
    const userUpdates: Record<string, any> = {
      defaultCompanyId: company.id,
      activeCompanyId: company.id,
      onboardingCompleted: true,
      updatedAt: serverTimestamp(),
    };
    if (userExisting.onboardingCompletedAt === undefined) {
      userUpdates.onboardingCompletedAt = new Date().toISOString();
    }
    batch.update(userRef, userUpdates);

    await batch.commit();
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
    const snap = await getDoc(companyRef);
    if (!snap.exists()) return;
    const existingData = snap.data();

    const payload = stripUndefined({
      id: company.id,
      name: clipStr(company.name, 150) || clipStr(existingData.name, 150) || 'Transport Company',
      tradeName: clipStr(company.tradeName, 150) ?? clipStr(existingData.tradeName, 150),
      gstin: clipStr(company.gstin, 15) ?? clipStr(existingData.gstin, 15),
      pan: clipStr(company.pan, 10) ?? clipStr(existingData.pan, 10),
      phone: clipStr(company.phone, 25) ?? clipStr(existingData.phone, 25),
      email: clipStr(company.email, 200) ?? clipStr(existingData.email, 200),
      address: clipStr(company.address, 300) ?? clipStr(existingData.address, 300),
      city: clipStr(company.city, 80) ?? clipStr(existingData.city, 80),
      state: clipStr(company.state, 60) ?? clipStr(existingData.state, 60),
      stateCode: clipStr(company.stateCode, 5) ?? clipStr(existingData.stateCode, 5),
      pincode: clipStr(company.pincode, 10) ?? clipStr(existingData.pincode, 10),
      bankName: clipStr(company.bankName, 100) ?? clipStr(existingData.bankName, 100),
      accountNumber: clipStr(company.accountNumber, 40) ?? clipStr(existingData.accountNumber, 40),
      ifscCode: clipStr(company.ifscCode, 15) ?? clipStr(existingData.ifscCode, 15),
      branch: clipStr(company.branch, 100) ?? clipStr(existingData.branch, 100),
      lrPrefix: clipStr(company.lrPrefix, 30) ?? clipStr(existingData.lrPrefix, 30),
      invoicePrefix: clipStr(company.invoicePrefix, 30) ?? clipStr(existingData.invoicePrefix, 30),
      tripPrefix: clipStr(company.tripPrefix, 30) ?? clipStr(existingData.tripPrefix, 30),
      fleetSize: clipStr(company.fleetSize, 50) ?? clipStr(existingData.fleetSize, 50),
      logoUrl: clipStr(company.logoUrl, 500) ?? clipStr(existingData.logoUrl, 500),
      ownerId: existingData.ownerId || auth.currentUser.uid,
      createdAt: existingData.createdAt instanceof Timestamp ? existingData.createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(companyRef, payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, companyPath);
  }
}

export type CompanySubcollection =
  | 'vehicles'
  | 'drivers'
  | 'customers'
  | 'trips'
  | 'expenses'
  | 'advances'
  | 'settlements'
  | 'invoices'
  | 'payments'
  | 'documents'
  | 'maintenance';

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
      const existingSnap = await getDoc(ref);
      const existingData = existingSnap.exists() ? existingSnap.data() : null;

      const payload = sanitizeSubcollectionPayload(
        subcollection,
        this.companyId,
        item as Record<string, any>,
        existingData
      );
      if (!payload) return;

      await setDoc(ref, payload);
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
        summary: clipStr(log.summary, 500) || 'Action logged',
        timestamp: serverTimestamp(),
      });
      await setDoc(doc(db, 'companies', this.companyId, 'auditLogs', safeLogId), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }

  /**
   * Hydrates all 11 operational collections from Firestore for the active company
   */
  async hydrateAll(): Promise<HydratedCompanyBundle> {
    const [
      vehicles,
      drivers,
      customers,
      trips,
      expenses,
      advances,
      settlements,
      invoices,
      payments,
      documents,
      maintenance,
    ] = await Promise.all([
      this.getVehicles(),
      this.getDrivers(),
      this.getCustomers(),
      this.getTrips(),
      this.getExpenses(),
      this.getAdvances(),
      this.getSettlements(),
      this.getInvoices(),
      this.getPayments(),
      this.getDocuments(),
      this.getMaintenance(),
    ]);

    return {
      vehicles,
      drivers,
      customers,
      trips,
      expenses,
      advances,
      settlements,
      invoices,
      payments,
      documents,
      maintenance,
    };
  }
}

/**
 * Deletes all docs in specified subcollections for a company in chunks <= 450 ops
 */
async function deleteSubcollectionsInChunks(
  companyId: string,
  subcollections: CompanySubcollection[]
): Promise<void> {
  if (!auth.currentUser || !isVerifiedEmailUser() || !isValidDocSegment(companyId)) return;
  if (!(await hasActiveCompanyMembershipInFirestore(companyId))) return;

  const refsToDelete = [];
  for (const sub of subcollections) {
    const path = `companies/${companyId}/${sub}`;
    try {
      const q = query(
        collection(db, 'companies', companyId, sub),
        where('companyId', '==', companyId)
      );
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        refsToDelete.push(d.ref);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  }

  const CHUNK_SIZE = 450;
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
  (bundle.vehicles || []).forEach((v) => ops.push(client.saveVehicle(v)));
  (bundle.drivers || []).forEach((d) => ops.push(client.saveDriver(d)));
  (bundle.documents || []).forEach((docItem) => ops.push(client.saveDocument(docItem)));
  (bundle.trips || []).forEach((t) => ops.push(client.saveTrip(t)));
  (bundle.expenses || []).forEach((e) => ops.push(client.saveExpense(e)));
  (bundle.advances || []).forEach((a) => ops.push(client.saveAdvance(a)));
  (bundle.settlements || []).forEach((s) => ops.push(client.saveSettlement(s)));
  (bundle.invoices || []).forEach((i) => ops.push(client.saveInvoice(i)));
  (bundle.payments || []).forEach((p) => ops.push(client.savePayment(p)));

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
  }
}

export async function deleteEntityFromFirestore(
  companyId: string | undefined | null,
  subcollection: 'vehicles' | 'drivers' | 'customers' | 'trips' | 'expenses' | 'documents',
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
    case 'trips':
      return client.deleteTrip(docId);
    case 'expenses':
      return client.deleteExpense(docId);
    case 'documents':
  return client.deleteDocument(docId);
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
  onTrips: (items: Trip[]) => void;
  onExpenses: (items: TripExpense[]) => void;
  onAdvances: (items: DriverAdvance[]) => void;
  onSettlements: (items: TripSettlement[]) => void;
  onInvoices: (items: Invoice[]) => void;
  onPayments: (items: Payment[]) => void;
  onDocuments: (items: VehicleDocument[]) => void;
  onMaintenance: (items: MaintenanceRecord[]) => void;
  onAuditLogs: (items: AuditLog[]) => void;
  onInitialLoadComplete?: () => void;
}

/**
 * Subscribes to live Firestore onSnapshot updates for all authorized company data.
 * Returns a synchronous unsubscribeAll() cleanup function that stops every active listener.
 */
export function subscribeToCompanyOperationalData(
  companyId: string,
  role: UserRole | null,
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

  const canReadAuditLogs =
    role === 'OWNER' || role === 'ADMIN' || isBootstrappedAdminUser();

  const totalCollections = canReadAuditLogs ? 14 : 13;

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

  hasActiveCompanyMembershipInFirestore(safeCompanyId)
    .then((hasAccess) => {
      if (cancelled) return;
      if (!hasAccess) {
        onError(new Error('Active company membership required to read company records.'));
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

      // 2. Members collection
      unsubs.push(
        onSnapshot(
          collection(db, 'companies', safeCompanyId, 'members'),
          (snap) => {
            if (cancelled) return;
            const list = snap.docs.map((d) =>
              normalizeTimestamps<FirestoreCompanyMember>({ id: d.id, ...d.data() })
            );
            callbacks.onMembers(list);
            markCollectionLoaded();
          },
          (err) => reportError(err, `companies/${safeCompanyId}/members`, OperationType.LIST)
        )
      );

      // 3-13. Operational subcollections (all filtered by companyId == safeCompanyId to match firestore.rules)
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
      subscribeSub<Trip>('trips', callbacks.onTrips);
      subscribeSub<TripExpense>('expenses', callbacks.onExpenses);
      subscribeSub<DriverAdvance>('advances', callbacks.onAdvances);
      subscribeSub<TripSettlement>('settlements', callbacks.onSettlements);
      subscribeSub<Invoice>('invoices', callbacks.onInvoices);
      subscribeSub<Payment>('payments', callbacks.onPayments);
      subscribeSub<VehicleDocument>('documents', callbacks.onDocuments);
      subscribeSub<MaintenanceRecord>('maintenance', callbacks.onMaintenance);

      // 14. Audit logs (strictly OWNER / ADMIN per firestore.rules)
      if (canReadAuditLogs) {
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

async function assertWritableFirestoreUser(companyId: string): Promise<string> {
  if (!auth.currentUser) {
    throw new Error('Authentication required. Please sign in to save changes.');
  }
  if (!isVerifiedEmailUser()) {
    throw new Error('Please verify your email address before saving changes to Firestore.');
  }
  if (!isValidDocSegment(companyId)) {
    throw new Error('A valid company ID is required.');
  }
  const safeCompanyId = companyId.trim();
  const hasAccess = await hasActiveCompanyMembershipInFirestore(safeCompanyId);
  if (!hasAccess) {
    throw new Error('Your account does not have active company membership.');
  }
  return safeCompanyId;
}

function addAuditLogToBatch(
  batch: ReturnType<typeof writeBatch>,
  companyId: string,
  entry: {
    action: AuditLog['action'];
    entityType: AuditLog['entityType'];
    entityId: string;
    summary: string;
  }
) {
  if (!auth.currentUser) return;
  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ref = doc(db, 'companies', companyId, 'auditLogs', logId);
  batch.set(
    ref,
    stripUndefined({
      id: logId,
      companyId,
      userId: auth.currentUser.uid,
      userName: clipStr(auth.currentUser.displayName || auth.currentUser.email, 100),
      action: entry.action,
      entityType: entry.entityType,
      entityId: clipStr(entry.entityId, 128) || 'system',
      summary: clipStr(entry.summary, 500) || 'Action logged',
      timestamp: serverTimestamp(),
    })
  );
}

async function prepareBatchDoc(
  companyId: string,
  subcollection: CompanySubcollection,
  item: Record<string, any> & { id: string }
): Promise<{ ref: ReturnType<typeof doc>; payload: Record<string, any>; isNew: boolean }> {
  if (!isValidDocSegment(item.id)) {
    throw new Error(`Invalid document ID for ${subcollection}`);
  }
  const safeDocId = item.id.trim();
  const ref = doc(db, 'companies', companyId, subcollection, safeDocId);
  const existingSnap = await getDoc(ref);
  const existingData = existingSnap.exists() ? existingSnap.data() : null;
  const payload = sanitizeSubcollectionPayload(subcollection, companyId, item, existingData);
  if (!payload) {
    throw new Error(`Missing required fields for ${subcollection} record.`);
  }
  return { ref, payload, isNew: !existingSnap.exists() };
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
    batch.set(vehDoc.ref, vehDoc.payload);

    for (const d of docsToUpsert) {
      const comp = calculateDocComplianceStatus(d.expiryDate);
      const prepared = await prepareBatchDoc(safeCompanyId, 'documents', {
        ...d,
        companyId: safeCompanyId,
        daysUntilExpiry: comp.daysUntilExpiry,
        status: comp.status,
      });
      batch.set(prepared.ref, prepared.payload);
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
    batch.set(drvDoc.ref, drvDoc.payload);
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
    batch.set(custDoc.ref, custDoc.payload);
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
    initialAdvance?: DriverAdvance | null;
  }
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const { trip, vehicle, driver, initialAdvance } = params;
  const path = `companies/${safeCompanyId}/trips/${trip.id}`;

  try {
    const batch = writeBatch(db);
    const tripDoc = await prepareBatchDoc(safeCompanyId, 'trips', trip);
    batch.set(tripDoc.ref, tripDoc.payload);

    if (initialAdvance && initialAdvance.amountPaise > 0) {
      const advDoc = await prepareBatchDoc(safeCompanyId, 'advances', initialAdvance);
      batch.set(advDoc.ref, advDoc.payload);
    }

    const isActiveTripStatus = trip.status === 'DISPATCHED' || trip.status === 'IN_TRANSIT';
    if (vehicle && isActiveTripStatus) {
      const updatedVeh: Vehicle = {
        ...vehicle,
        status: 'IN_TRANSIT',
        activeTripId: trip.id,
        assignedDriverId: driver?.id || vehicle.assignedDriverId,
        assignedDriverName: driver?.fullName || vehicle.assignedDriverName,
      };
      const vehDoc = await prepareBatchDoc(safeCompanyId, 'vehicles', updatedVeh);
      batch.set(vehDoc.ref, vehDoc.payload);
    }

    if (driver && (isActiveTripStatus || (initialAdvance && initialAdvance.amountPaise > 0))) {
      const advDelta = initialAdvance && initialAdvance.amountPaise > 0 ? initialAdvance.amountPaise : 0;
      const updatedDrv: Driver = {
        ...driver,
        status: isActiveTripStatus ? 'ON_TRIP' : driver.status,
        currentAdvanceBalancePaise: (driver.currentAdvanceBalancePaise || 0) + advDelta,
      };
      const drvDoc = await prepareBatchDoc(safeCompanyId, 'drivers', updatedDrv);
      batch.set(drvDoc.ref, drvDoc.payload);
    }

    addAuditLogToBatch(batch, safeCompanyId, {
      action: tripDoc.isNew ? (isActiveTripStatus ? 'DISPATCH' : 'CREATE') : 'UPDATE',
      entityType: 'TRIP',
      entityId: trip.id,
      summary: `${tripDoc.isNew ? 'Dispatched' : 'Updated'} trip ${trip.tripNumber} (${trip.vehicleReg})`,
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
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
  const path = `companies/${safeCompanyId}/trips/${trip.id}`;

  try {
    const batch = writeBatch(db);
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
      cancellationReason: nextStatus === 'CANCELLED' ? cancellationReason || trip.cancellationReason : trip.cancellationReason,
      cancelledAt: nextStatus === 'CANCELLED' ? new Date().toISOString() : trip.cancelledAt,
      cancelledBy: nextStatus === 'CANCELLED' ? cancelledBy || trip.cancelledBy : trip.cancelledBy,
    };

    const tripDoc = await prepareBatchDoc(safeCompanyId, 'trips', updatedTrip);
    batch.set(tripDoc.ref, tripDoc.payload);

    const isBecomingActive = nextStatus === 'DISPATCHED' || nextStatus === 'IN_TRANSIT';
    const isEndingTrip =
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
        batch.set(vehDoc.ref, vehDoc.payload);
      } else if (isEndingTrip) {
        const vehDoc = await prepareBatchDoc(safeCompanyId, 'vehicles', {
          ...vehicle,
          status: vehicle.status === 'IN_TRANSIT' ? 'AVAILABLE' : vehicle.status,
          activeTripId: vehicle.activeTripId === trip.id ? undefined : vehicle.activeTripId,
          currentOdometerKm:
            endOdometerKm !== undefined && endOdometerKm > (vehicle.currentOdometerKm || 0)
              ? endOdometerKm
              : vehicle.currentOdometerKm,
        });
        batch.set(vehDoc.ref, vehDoc.payload);
      }
    }

    if (driver) {
      if (isBecomingActive) {
        const drvDoc = await prepareBatchDoc(safeCompanyId, 'drivers', {
          ...driver,
          status: 'ON_TRIP',
        });
        batch.set(drvDoc.ref, drvDoc.payload);
      } else if (isEndingTrip) {
        const wasDeliveredBefore =
          trip.status === 'DELIVERED' || trip.status === 'COMPLETED' || trip.status === 'SETTLED';
        const incrementTripCount =
          (nextStatus === 'DELIVERED' || nextStatus === 'COMPLETED') && !wasDeliveredBefore ? 1 : 0;
        const drvDoc = await prepareBatchDoc(safeCompanyId, 'drivers', {
          ...driver,
          status: driver.status === 'ON_TRIP' ? 'AVAILABLE' : driver.status,
          totalTripsCompleted: (driver.totalTripsCompleted || 0) + incrementTripCount,
        });
        batch.set(drvDoc.ref, drvDoc.payload);
      }
    }

    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'UPDATE',
      entityType: 'TRIP',
      entityId: trip.id,
      summary: `Transitioned trip ${trip.tripNumber} status from ${trip.status} to ${nextStatus}`,
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteTripInFirestore(
  companyId: string,
  tripId: string,
  tripNumber?: string
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  if (!isValidDocSegment(tripId)) return;
  const path = `companies/${safeCompanyId}/trips/${tripId}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'companies', safeCompanyId, 'trips', tripId.trim()));
    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'DELETE',
      entityType: 'TRIP',
      entityId: tripId.trim(),
      summary: `Deleted trip ${tripNumber || tripId}`,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Atomic Save / Delete Trip Expense + Recalculate Trip Expenses & Contribution
 */
export async function saveExpenseInFirestore(
  companyId: string,
  expense: TripExpense,
  trip: Trip | undefined,
  existingTripExpenses: TripExpense[]
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/expenses/${expense.id}`;
  try {
    const batch = writeBatch(db);
    const expDoc = await prepareBatchDoc(safeCompanyId, 'expenses', expense);
    batch.set(expDoc.ref, expDoc.payload);

    if (trip) {
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
      batch.set(tripDoc.ref, tripDoc.payload);
    }

    addAuditLogToBatch(batch, safeCompanyId, {
      action: expDoc.isNew ? 'CREATE' : 'UPDATE',
      entityType: 'EXPENSE',
      entityId: expense.id,
      summary: `${expDoc.isNew ? 'Logged' : 'Updated'} ${expense.category} expense of ₹${(
        expense.amountPaise / 100
      ).toFixed(2)}`,
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
  remainingTripExpenses: TripExpense[]
): Promise<void> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const path = `companies/${safeCompanyId}/expenses/${expense.id}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'companies', safeCompanyId, 'expenses', expense.id.trim()));

    if (trip) {
      const newTotalExpenses = remainingTripExpenses
        .filter((e) => e.id !== expense.id)
        .reduce((s, e) => s + (e.amountPaise || 0), 0);
      const rev = trip.totalRevenuePaise || trip.freightAmountPaise || 0;
      const tripDoc = await prepareBatchDoc(safeCompanyId, 'trips', {
        ...trip,
        totalExpensesPaise: newTotalExpenses,
        tripContributionPaise: rev - newTotalExpenses,
      });
      batch.set(tripDoc.ref, tripDoc.payload);
    }

    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'DELETE',
      entityType: 'EXPENSE',
      entityId: expense.id,
      summary: `Deleted ${expense.category} expense of ₹${(expense.amountPaise / 100).toFixed(2)}`,
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Atomic Create Driver Advance + Increment Trip totalAdvancesPaise + Driver currentAdvanceBalancePaise
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
    const advDoc = await prepareBatchDoc(safeCompanyId, 'advances', advance);
    batch.set(advDoc.ref, advDoc.payload);

    if (trip) {
      const tripDoc = await prepareBatchDoc(safeCompanyId, 'trips', {
        ...trip,
        totalAdvancesPaise: (trip.totalAdvancesPaise || 0) + advance.amountPaise,
      });
      batch.set(tripDoc.ref, tripDoc.payload);
    }

    if (driver) {
      const drvDoc = await prepareBatchDoc(safeCompanyId, 'drivers', {
        ...driver,
        currentAdvanceBalancePaise: (driver.currentAdvanceBalancePaise || 0) + advance.amountPaise,
      });
      batch.set(drvDoc.ref, drvDoc.payload);
    }

    // firestore.rules auditLog entityType enum allows TRIP/DRIVER (not ADVANCE)
    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'CREATE',
      entityType: 'TRIP',
      entityId: trip?.id || advance.id,
      summary: `Disbursed advance of ₹${(advance.amountPaise / 100).toFixed(2)} to ${
        advance.driverName || driver?.fullName || 'driver'
      }`,
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

/**
 * Atomic Save / Finalize Driver Trip Settlement
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
    batch.set(stlDoc.ref, stlDoc.payload);

    const isFinalized = settlement.status === 'FINALIZED' || settlement.status === 'APPROVED_SETTLED';

    if (trip) {
      const nextTripStatus: Trip['status'] =
        settlement.status === 'FINALIZED' ? 'SETTLED' : trip.status;
      const tripDoc = await prepareBatchDoc(safeCompanyId, 'trips', {
        ...trip,
        isSettled: isFinalized,
        status: nextTripStatus,
      });
      batch.set(tripDoc.ref, tripDoc.payload);
    }

    if (isFinalized) {
      for (const adv of advancesToMarkSettled) {
        if (!adv.isSettled) {
          const advDoc = await prepareBatchDoc(safeCompanyId, 'advances', {
            ...adv,
            isSettled: true,
            settlementId: settlement.id,
          });
          batch.set(advDoc.ref, advDoc.payload);
        }
      }

      for (const exp of expensesToMarkSettled) {
        if (!exp.isSettled) {
          const expDoc = await prepareBatchDoc(safeCompanyId, 'expenses', {
            ...exp,
            isSettled: true,
            settlementId: settlement.id,
          });
          batch.set(expDoc.ref, expDoc.payload);
        }
      }

      if (driver) {
        const settledAdvanceSum = advancesToMarkSettled
          .filter((a) => !a.isSettled)
          .reduce((s, a) => s + a.amountPaise, 0);
        const remainingBal = Math.max(0, (driver.currentAdvanceBalancePaise || 0) - settledAdvanceSum);
        const drvDoc = await prepareBatchDoc(safeCompanyId, 'drivers', {
          ...driver,
          currentAdvanceBalancePaise: remainingBal,
        });
        batch.set(drvDoc.ref, drvDoc.payload);
      }
    }

    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'SETTLE',
      entityType: 'SETTLEMENT',
      entityId: settlement.id,
      summary: `${settlement.status} settlement ${settlement.settlementNumber || settlement.id} for ${
        settlement.driverName || 'driver'
      }`,
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

/**
 * Atomic Create / Cancel Invoice + Update Trip & Customer Balances
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
    const batch = writeBatch(db);
    const invDoc = await prepareBatchDoc(safeCompanyId, 'invoices', invoice);
    batch.set(invDoc.ref, invDoc.payload);

    if (trip) {
      const tripDoc = await prepareBatchDoc(safeCompanyId, 'trips', {
        ...trip,
        isInvoiced: true,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      });
      batch.set(tripDoc.ref, tripDoc.payload);
    }

    if (customer) {
      const custDoc = await prepareBatchDoc(safeCompanyId, 'customers', {
        ...customer,
        currentOutstandingPaise:
          (customer.currentOutstandingPaise || 0) + (invoice.balanceDuePaise ?? invoice.totalAmountPaise),
        totalFreightBilledPaise:
          (customer.totalFreightBilledPaise || 0) + invoice.totalAmountPaise,
      });
      batch.set(custDoc.ref, custDoc.payload);
    }

    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'INVOICE',
      entityType: 'INVOICE',
      entityId: invoice.id,
      summary: `Generated GST invoice ${invoice.invoiceNumber} for ₹${(
        invoice.totalAmountPaise / 100
      ).toFixed(2)}`,
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
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
    const batch = writeBatch(db);
    const invDoc = await prepareBatchDoc(safeCompanyId, 'invoices', {
      ...invoice,
      status: 'CANCELLED',
      paymentStatus: 'CANCELLED',
      balanceDuePaise: 0,
      cancelledAt: new Date().toISOString(),
      cancellationReason: reason,
    });
    batch.set(invDoc.ref, invDoc.payload);

    if (trip && trip.invoiceId === invoice.id) {
      const tripDoc = await prepareBatchDoc(safeCompanyId, 'trips', {
        ...trip,
        isInvoiced: false,
        invoiceId: undefined,
        invoiceNumber: undefined,
      });
      batch.set(tripDoc.ref, tripDoc.payload);
    }

    if (customer) {
      const deduction = invoice.balanceDuePaise ?? invoice.totalAmountPaise;
      const custDoc = await prepareBatchDoc(safeCompanyId, 'customers', {
        ...customer,
        currentOutstandingPaise: Math.max(0, (customer.currentOutstandingPaise || 0) - deduction),
      });
      batch.set(custDoc.ref, custDoc.payload);
    }

    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'UPDATE',
      entityType: 'INVOICE',
      entityId: invoice.id,
      summary: `Cancelled invoice ${invoice.invoiceNumber}: ${reason}`,
    });

    await batch.commit();
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
    const batch = writeBatch(db);
    const payDoc = await prepareBatchDoc(safeCompanyId, 'payments', payment);
    batch.set(payDoc.ref, payDoc.payload);

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
    batch.set(invDoc.ref, invDoc.payload);

    if (customer) {
      const custDoc = await prepareBatchDoc(safeCompanyId, 'customers', {
        ...customer,
        currentOutstandingPaise: Math.max(0, (customer.currentOutstandingPaise || 0) - creditAmount),
      });
      batch.set(custDoc.ref, custDoc.payload);
    }

    addAuditLogToBatch(batch, safeCompanyId, {
      action: 'PAYMENT',
      entityType: 'PAYMENT',
      entityId: payment.id,
      summary: `Recorded payment ₹${(payment.amountPaise / 100).toFixed(2)} against ${invoice.invoiceNumber}`,
    });

    await batch.commit();
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
    batch.set(docEntry.ref, docEntry.payload);

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
      batch.set(vehDoc.ref, vehDoc.payload);
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
      summary: `Deleted compliance document ${label || docId}`,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Adds or updates a staff member directly inside /companies/{companyId}/members/{memberId}
 * in Firestore (requires OWNER or ADMIN role per firestore.rules).
 */
export async function inviteCompanyMemberInFirestore(
  companyId: string,
  input: { name: string; email: string; role: UserRole }
): Promise<FirestoreCompanyMember> {
  const safeCompanyId = await assertWritableFirestoreUser(companyId);
  const cleanEmail = clipStr(input.email, 200)?.toLowerCase();
  const cleanName = clipStr(input.name, 100);
  if (!cleanEmail || !cleanName) {
    throw new Error('Staff full name and valid email address are required.');
  }
  const allowedRoles: UserRole[] = ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'];
  const role: UserRole = allowedRoles.includes(input.role) ? input.role : 'OPERATIONS';

  const sanitizedSlug = cleanEmail.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const memberId = `mem_${sanitizedSlug}_${Date.now().toString(36)}`.slice(0, 128);
  const path = `companies/${safeCompanyId}/members/${memberId}`;

  try {
    const memberRef = doc(db, 'companies', safeCompanyId, 'members', memberId);
    await setDoc(
      memberRef,
      stripUndefined({
        id: memberId,
        userId: memberId,
        companyId: safeCompanyId,
        role,
        name: cleanName,
        email: cleanEmail,
        status: 'ACTIVE',
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    return {
      id: memberId,
      userId: memberId,
      companyId: safeCompanyId,
      role,
      name: cleanName,
      email: cleanEmail,
      status: 'ACTIVE',
      joinedAt: new Date().toISOString(),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
    throw err;
  }
}

