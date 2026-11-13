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
  serverTimestamp,
  Timestamp,
  type DocumentData,
} from 'firebase/firestore';
import type { User as FirebaseUser } from 'firebase/auth';
import { db, auth, handleFirestoreError, OperationType } from './client';
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
        perDayBataPaise: toNum(item.perDayBataPaise),
        assignedVehicleId: clipStr(item.assignedVehicleId, 128),
        assignedVehicleReg: clipStr(item.assignedVehicleReg, 30),
        aadharNumber,
        panNumber,
        bankAccount,
        bankIfsc,
        bankName: clipStr(item.bankName, 80) ?? clipStr(existingData?.bankName, 80),
        bankBranch: clipStr(item.bankBranch, 80) ?? clipStr(existingData?.bankBranch, 80),
        joinedDate: clipStr(item.joinedDate, 30),
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
   * Hydrates all 10 operational collections from Firestore for the active company
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
