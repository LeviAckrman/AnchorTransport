/**
 * AnchorTransport TMS - Core Domain Types & Data Models
 * Multi-tenant Transport Management System for Indian Fleet Owners
 */

export type UserRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'ACCOUNTANT' | 'OPERATIONS';

export interface Company {
  id: string;
  name: string;
  tradeName: string;
  gstin: string; // Indian GSTIN (e.g. 19AAACC1206D1ZM for West Bengal)
  pan: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  stateCode: string; // e.g. "19" for West Bengal
  pincode: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  branch: string;
  lrPrefix: string; // e.g. "FG/25-26/"
  invoicePrefix: string; // e.g. "INV/25-26/"
  tripPrefix?: string; // e.g. "TR-"
  logoUrl?: string; // Company logo image URL or SVG data
  createdAt: string;
  updatedAt?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatarUrl?: string;
}

export interface CompanyUser {
  id: string;
  companyId: string;
  userId: string;
  role: UserRole;
  user: User;
  active: boolean;
  assignedBranches?: string[];
}

export type VehicleStatus = 'AVAILABLE' | 'IN_TRANSIT' | 'UNDER_MAINTENANCE' | 'INACTIVE';

export type VehicleType = 
  | '10-Wheeler (16T)'
  | '12-Wheeler (21T)'
  | '14-Wheeler (28T)'
  | '16-Wheeler (35T)'
  | 'Trailer (40T+)'
  | 'Tata 407 (2.5T)'
  | 'Eicher 17ft (6T)'
  | 'Container 32ft';

export interface Vehicle {
  id: string;
  companyId: string;
  registrationNumber: string; // e.g. WB-19-K-4821
  vehicleType: VehicleType;
  makeModel: string; // e.g. Tata Signa 4825.TK, Ashok Leyland 2820
  capacityTonnes: number;
  unladenWeightTonnes: number;
  chassisNumber: string;
  engineNumber: string;
  status: VehicleStatus;
  currentOdometerKm: number;
  fastagBalancePaise: number;
  assignedDriverId?: string;
  assignedDriverName?: string;
  activeTripId?: string;
  insuranceExpiry?: string;
  insurancePolicyNumber?: string;
  fitnessExpiry?: string;
  fitnessCertificateNumber?: string;
  permitExpiry?: string;
  permitNumber?: string;
  permitType?: 'NATIONAL' | 'STATE';
  pucExpiry?: string;
  pucNumber?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export type DriverStatus = 'AVAILABLE' | 'ON_TRIP' | 'ON_LEAVE' | 'INACTIVE';

export interface Driver {
  id: string;
  companyId: string;
  fullName: string;
  phone: string;
  altPhone?: string;
  licenseNumber: string; // e.g. WB1920150012345
  licenseExpiry: string; // ISO date string
  badgeNumber?: string;
  address: string;
  emergencyContact: string;
  emergencyPhone: string;
  status: DriverStatus;
  currentAdvanceBalancePaise: number; // Positive = driver has excess cash to return/account
  totalTripsCompleted: number;
  monthlySalaryPaise?: number; // Sensitive
  perDayBataPaise: number; // Standard daily trip allowance in paise (e.g. ₹500/day = 50,000 paise)
  assignedVehicleId?: string;
  assignedVehicleReg?: string;
  aadharNumber?: string; // Sensitive
  panNumber?: string; // Sensitive
  bankAccount?: string; // Sensitive
  bankIfsc?: string; // Sensitive
  bankName?: string; // Sensitive
  bankBranch?: string; // Sensitive
  isSensitiveDataRedacted?: boolean;
  joinedDate: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Customer {
  id: string;
  companyId: string;
  name: string;
  tradeName?: string;
  gstin: string; // 15 characters
  pan: string;
  contactPerson: string;
  phone: string;
  email: string;
  billingAddress: string;
  city: string;
  state: string;
  stateCode: string; // e.g. 19 for WB, 10 for Bihar, 21 for Odisha
  pincode: string;
  creditPeriodDays: number; // e.g. 30 days
  paymentTermsDays?: number; // alias for creditPeriodDays
  creditLimitPaise: number;
  currentOutstandingPaise: number; // Total unpaid invoices
  totalFreightBilledPaise: number;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export type TripStatus = 'PLANNED' | 'DISPATCHED' | 'IN_TRANSIT' | 'DELIVERED' | 'COMPLETED' | 'SETTLED' | 'CANCELLED';

export interface Trip {
  id: string;
  companyId: string;
  tripNumber: string; // e.g. TR-2026-0042
  lrNumber: string; // Lorry Receipt / Bilty No.
  customerId: string;
  customerName: string;
  customerGstin: string;
  vehicleId: string;
  vehicleReg: string;
  driverId: string;
  driverName: string;
  driverPhone: string;
  originCity: string;
  destinationCity: string;
  goodsType: string; // e.g. "Steel Coils", "Jute Bags", "Cement Bags", "FMCG"
  weightTonnes: number;
  ratePerTonnePaise: number;
  freightAmountPaise: number; // weight * rate or fixed
  otherChargesPaise: number; // detention, loading, toll markup
  totalRevenuePaise: number; // freightAmountPaise + otherChargesPaise
  
  // Trip lifecycle
  dispatchDate: string;
  expectedDeliveryDate: string;
  actualDeliveryDate?: string;
  status: TripStatus;
  
  // Operational Readings
  startOdometerKm: number;
  endOdometerKm?: number;
  podReceived: boolean; // Proof of Delivery received from consignee
  podDocumentUrl?: string;
  podRemarks?: string;

  // Financial aggregates
  totalExpensesPaise: number;
  totalAdvancesPaise: number;
  tripContributionPaise: number; // totalRevenuePaise - totalExpensesPaise
  isSettled: boolean;
  isInvoiced: boolean;
  invoiceId?: string;
  invoiceNumber?: string;

  // Cancellation audit
  cancellationReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;

  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export type ExpenseCategory = 
  | 'FUEL'
  | 'DIESEL'
  | 'TOLL'
  | 'TOLL_FASTAG'
  | 'PARKING'
  | 'DRIVER_ALLOWANCE'
  | 'DRIVER_BATA'
  | 'LOADING'
  | 'UNLOADING'
  | 'LOADING_UNLOADING'
  | 'REPAIR'
  | 'EN_ROUTE_REPAIR'
  | 'TYRE_PUNCTURE'
  | 'DEF_ADBLUE'
  | 'RTO_POLICE'
  | 'WEIGHBRIDGE'
  | 'OTHER';

export type PaymentMode = 'CASH' | 'FASTAG' | 'PETRO_CARD' | 'UPI' | 'DRIVER_POCKET' | 'BANK_TRANSFER';

export interface TripExpense {
  id: string;
  companyId: string;
  tripId: string;
  tripNumber?: string;
  vehicleId?: string;
  vehicleReg?: string;
  driverName?: string;
  category: ExpenseCategory;
  amountPaise: number;
  paymentMode: PaymentMode;
  date?: string;
  expenseDate?: string;
  description?: string;
  litres?: number;
  litresFuel?: number; // Only for diesel
  ratePerLitrePaise?: number; // Only for diesel
  pumpName?: string;
  petrolPumpName?: string;
  location?: string;
  odometerReading?: number;
  receiptNumber?: string;
  voucherNumber?: string;
  receiptUrl?: string;
  receiptAttachmentUrl?: string;
  notes?: string;
  driverId?: string;
  recordedBy: string;
  createdBy?: string;
  isDriverDisbursed: boolean; // True if paid by driver from advance
  isSettled?: boolean;
  settlementId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type AdvanceType = 'CASH_DISPATCH' | 'CASH_EN_ROUTE' | 'PUMP_DIESEL_SLIP' | 'UPI_ONLINE' | 'BANK_TRANSFER';

export interface DriverAdvance {
  id: string;
  companyId: string;
  tripId: string;
  tripNumber?: string;
  driverId: string;
  driverName?: string;
  vehicleReg?: string;
  amountPaise: number;
  advanceType: AdvanceType;
  paymentMode?: PaymentMode;
  date: string;
  reference?: string;
  referenceNotes?: string;
  notes?: string;
  disbursedBy: string;
  isSettled: boolean;
  settlementId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type SettlementStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED_SETTLED' | 'FINALIZED';

export interface TripSettlement {
  id: string;
  companyId: string;
  tripId: string;
  tripNumber: string;
  driverId: string;
  driverName: string;
  vehicleId?: string;
  vehicleReg?: string;
  settlementNumber?: string; // e.g. STL-2026-0001
  totalAdvanceGivenPaise: number;
  driverCashExpensesPaise: number; // Expenses driver paid out of cash advance
  driverBataAllowancePaise: number; // Days * bata rate
  approvedDeductionsPaise?: number; // Deductions approved (penalties, shortages)
  otherDeductionsPaise: number; // e.g. unexplained fuel shortage
  deductionReason?: string;
  remainingDriverBalancePaise?: number; // Remaining driver balance (Advances - Deductions/Expenses)
  netPayableToDriverPaise: number; // If positive: company pays driver. If negative: driver refunds cash.
  isCompanyDue?: boolean;
  status: SettlementStatus;
  settledDate: string;
  settledBy: string;
  settlementNotes?: string;
  isCorrectionAuthorized?: boolean;
  correctionReason?: string;
  correctedBy?: string;
  correctedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';
export type InvoicePaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE';

export interface Invoice {
  id: string;
  companyId: string;
  invoiceNumber: string; // e.g. INV/25-26/089
  tripId: string;
  tripNumber: string;
  lrNumber: string;
  customerId: string;
  customerName: string;
  customerGstin: string;
  billingAddress?: string;
  originCity?: string;
  destinationCity?: string;
  vehicleReg?: string;
  goodsType?: string;
  weightTonnes?: number;
  ratePerTonnePaise?: number;
  hsnSacCode?: string; // Standard 996511 for GTA freight transport
  issueDate: string;
  dueDate: string;
  freightAmountPaise?: number;
  loadingChargesPaise?: number;
  unloadingChargesPaise?: number;
  detentionChargesPaise?: number;
  otherChargesPaise?: number;
  taxableAmountPaise: number;
  isRcmApplicable: boolean; // Reverse Charge Mechanism (GTA standard: 5% RCM or 12% forward)
  gstRatePercent?: number;
  cgstRatePercent: number; // 2.5 or 6 or 0
  sgstRatePercent: number; // 2.5 or 6 or 0
  igstRatePercent: number; // 5 or 12 or 0 (if interstate)
  cgstAmountPaise: number;
  sgstAmountPaise: number;
  igstAmountPaise: number;
  totalTaxPaise?: number;
  totalAmountPaise: number;
  amountPaidPaise: number;
  balanceDuePaise: number;
  status: InvoiceStatus;
  paymentStatus?: InvoicePaymentStatus; // Backwards-compatible
  cancelledAt?: string;
  cancellationReason?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Payment {
  id: string;
  companyId: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  amountPaise: number;
  paymentDate: string;
  paymentMode: 'NEFT_RTGS' | 'CHEQUE' | 'UPI' | 'CASH' | 'BANK_TRANSFER';
  referenceNumber: string;
  tdsDeductedPaise?: number; // Section 194C TDS (1% or 2%)
  bankAccount?: string;
  recordedBy: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type DocumentType = 'RC' | 'FITNESS' | 'NATIONAL_PERMIT' | 'STATE_PERMIT' | 'INSURANCE' | 'PUC' | 'ROAD_TAX';

export interface VehicleDocument {
  id: string;
  companyId: string;
  vehicleId: string;
  vehicleReg: string;
  docType: DocumentType;
  documentNumber: string;
  issuingAuthority: string;
  issueDate: string;
  expiryDate: string; // ISO date
  documentUrl?: string;
  daysUntilExpiry: number; // Derived
  status: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED'; // Green, Amber, Red
}

export interface MaintenanceRecord {
  id: string;
  companyId: string;
  vehicleId: string;
  vehicleReg: string;
  serviceType: 'SCHEDULED_SERVICE' | 'TYRE_REPLACEMENT' | 'ENGINE_WORK' | 'BRAKE_SUSPENSION' | 'ACCIDENT_BREAKDOWN';
  garageName: string;
  costPaise: number;
  odometerReading: number;
  serviceDate: string;
  partsReplaced?: string;
  invoiceNumber?: string;
  notes?: string;
}

export interface AuditLog {
  id: string;
  companyId: string;
  userId: string;
  userName: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'DISPATCH' | 'SETTLE' | 'INVOICE' | 'PAYMENT';
  entityType: 'TRIP' | 'VEHICLE' | 'DRIVER' | 'SETTLEMENT' | 'INVOICE' | 'PAYMENT' | 'EXPENSE';
  entityId: string;
  summary: string;
  timestamp: string;
}

export const GTA_GST_DISCLAIMER =
  'Operational TMS Invoice for Goods Transport Agency (GTA) freight services under SAC 996511. ' +
  'This document records operational freight billing. It does not replace an automated GSTR-1/GSTR-3B statutory filing platform. ' +
  'Consult your Chartered Accountant for e-Invoice IRN/QR code compliance under GST Rule 48(4) where turnover thresholds apply.';

export interface VehicleAttentionItem {
  vehicleId: string;
  registrationNumber: string;
  makeModel: string;
  status: Vehicle['status'];
  fastagBalancePaise: number;
  issues: {
    type: 'EXPIRED_DOCUMENT' | 'EXPIRING_DOCUMENT' | 'MAINTENANCE' | 'LOW_FASTAG';
    severity: 'critical' | 'warning';
    title: string;
    description: string;
    expiryDate?: string;
    daysRemaining?: number;
  }[];
}

export interface CompanyDashboardMetrics {
  activeTripsCount: number;
  completedTripsCount: number;
  totalFreightRevenuePaise: number;
  totalRecordedExpensesPaise: number;
  tripContributionPaise: number;
  contributionMarginPercent: number;
  outstandingInvoicesPaise: number;
  outstandingInvoicesCount: number;
  totalTripsCount: number;
  totalVehiclesCount: number;
  activeVehiclesCount: number;
  recentTrips: Trip[];
  vehiclesRequiringAttention: VehicleAttentionItem[];
  period: {
    type: 'all' | 'today' | 'week' | 'month' | 'quarter' | 'custom';
    startDate?: string;
    endDate?: string;
  };
  hasData: boolean;
}
