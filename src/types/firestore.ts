/**
 * AnchorTransport TMS - Firestore Data Model & Schema Types (Phase 3)
 * Strongly-typed definitions for all 12 company-scoped collections and paths.
 */

export type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'ACCOUNTANT' | 'OPERATIONS' | 'OPERATIONS_STAFF';

export type TruckType = 'OPEN_BODY' | 'CONTAINER' | 'TRAILER' | 'TANKER' | 'TIPPER' | 'LCV';
export type VehicleStatus = 'AVAILABLE' | 'ON_TRIP' | 'MAINTENANCE' | 'INACTIVE';

export type DriverStatus = 'ACTIVE' | 'ON_TRIP' | 'ON_LEAVE' | 'INACTIVE';
export type CustomerStatus = 'ACTIVE' | 'INACTIVE' | 'BLOCKED';

export type TripStatus = 'PLANNED' | 'DISPATCHED' | 'IN_TRANSIT' | 'UNLOADED' | 'SETTLED' | 'CANCELLED';
export type BillingStatus = 'UNBILLED' | 'BILLED' | 'PAID';

export type ExpenseCategory = 'DIESEL' | 'TOLL' | 'REPAIR' | 'POLICE_CHALLAN' | 'LOADING_UNLOADING' | 'DRIVER_ALLOWANCE' | 'MISC';
export type ExpensePaymentMode = 'CASH' | 'CARD' | 'FASTAG' | 'UPI' | 'PETRO_CARD' | 'CREDIT';

export type AdvancePaymentMode = 'CASH' | 'BANK_TRANSFER' | 'UPI';
export type AdvanceStatus = 'PAID' | 'ADJUSTED' | 'RECOVERED';

export type SettlementStatus = 'DRAFT' | 'APPROVED' | 'SETTLED';

export type InvoicePaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';
export type CustomerPaymentMode = 'NEFT_RTGS' | 'CHEQUE' | 'UPI' | 'CASH';
export type PaymentStatus = 'COMPLETED' | 'PENDING' | 'FAILED';

export type VehicleDocumentType = 'RC' | 'FITNESS' | 'INSURANCE' | 'NATIONAL_PERMIT' | 'STATE_PERMIT' | 'PUC' | 'ROAD_TAX';
export type DocumentComplianceStatus = 'ACTIVE' | 'EXPIRED' | 'EXPIRING_SOON';

export type MaintenanceServiceType = 'SCHEDULED_SERVICE' | 'TYRE_REPLACEMENT' | 'ENGINE_REPAIR' | 'BRAKE_OVERHAUL' | 'ELECTRICAL' | 'ACCIDENT_REPAIR';
export type MaintenanceStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE' | 'SETTLE' | 'PAYMENT';

// Top-Level User Profile
export interface FirestoreUser {
  id: string;
  email: string;
  name: string;
  phone?: string;
  defaultCompanyId?: string;
  createdAt: string;
  updatedAt?: string;
}

// Company Root Document
export interface FirestoreCompany {
  id: string;
  name: string;
  gstin?: string;
  pan?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  ownerId: string;
  createdAt: string;
}

// Subcollection 1: Members
export interface FirestoreCompanyMember {
  userId: string;
  companyId: string;
  role: Role;
  name?: string;
  email: string;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  joinedAt: string;
}

// Subcollection 2: Vehicles
export interface FirestoreVehicle {
  id: string;
  companyId: string;
  registrationNumber: string;
  truckType: TruckType;
  make?: string;
  model?: string;
  capacityTons?: number;
  year?: number;
  status: VehicleStatus;
  chassisNumber?: string;
  engineNumber?: string;
  createdAt: string;
  updatedAt?: string;
}

// Subcollection 3: Drivers
export interface FirestoreDriver {
  id: string;
  companyId: string;
  name: string;
  phone: string;
  licenseNumber: string;
  licenseExpiry?: string;
  status: DriverStatus;
  address?: string;
  aadhaarNumber?: string;
  createdAt: string;
  updatedAt?: string;
}

// Subcollection 4: Customers
export interface FirestoreCustomer {
  id: string;
  companyId: string;
  companyName: string;
  contactPerson?: string;
  phone: string;
  email?: string;
  gstin?: string;
  address?: string;
  city?: string;
  state?: string;
  paymentTermsDays?: number;
  status: CustomerStatus;
  createdAt: string;
}

// Subcollection 5: Trips
export interface FirestoreTrip {
  id: string;
  companyId: string;
  tripNumber: string;
  vehicleId: string;
  driverId: string;
  customerId: string;
  originCity?: string;
  destinationCity?: string;
  freightAmount: number;
  advanceAmount?: number;
  driverAdvance?: number;
  status: TripStatus;
  billingStatus?: BillingStatus;
  startDate?: string;
  completedDate?: string;
  createdAt: string;
  updatedAt?: string;
}

// Subcollection 6: Expenses
export interface FirestoreTripExpense {
  id: string;
  companyId: string;
  tripId: string;
  vehicleId?: string;
  category: ExpenseCategory;
  amount: number;
  expenseDate: string;
  paymentMode?: ExpensePaymentMode;
  vendorName?: string;
  receiptDocUrl?: string;
  approvedBy?: string;
  createdAt: string;
}

// Subcollection 7: Advances
export interface FirestoreDriverAdvance {
  id: string;
  companyId: string;
  tripId: string;
  driverId: string;
  amount: number;
  advanceDate: string;
  paymentMode?: AdvancePaymentMode;
  remarks?: string;
  status: AdvanceStatus;
  settledInSettlementId?: string;
  createdAt: string;
}

// Subcollection 8: Settlements
export interface FirestoreTripSettlement {
  id: string;
  companyId: string;
  tripId: string;
  driverId: string;
  grossFreight: number;
  driverAdvancesTotal?: number;
  fuelExpensesTotal?: number;
  tollExpensesTotal?: number;
  otherExpensesTotal?: number;
  netPayableToDriver?: number;
  settlementDate: string;
  status: SettlementStatus;
  settledBy?: string;
  createdAt: string;
}

// Subcollection 9: Invoices
export interface FirestoreInvoice {
  id: string;
  companyId: string;
  invoiceNumber: string;
  customerId: string;
  tripId?: string;
  subtotal?: number;
  taxRate?: number;
  taxAmount?: number;
  totalAmount: number;
  amountPaid?: number;
  balanceDue?: number;
  invoiceDate: string;
  dueDate?: string;
  paymentStatus: InvoicePaymentStatus;
  notes?: string;
  createdAt: string;
}

// Subcollection 10: Payments
export interface FirestorePayment {
  id: string;
  companyId: string;
  invoiceId: string;
  customerId: string;
  amount: number;
  paymentDate: string;
  paymentMode: CustomerPaymentMode;
  transactionRef?: string;
  status: PaymentStatus;
  receivedBy?: string;
  createdAt: string;
}

// Subcollection 11: Documents
export interface FirestoreVehicleDocument {
  id: string;
  companyId: string;
  vehicleId: string;
  documentType: VehicleDocumentType;
  documentNumber: string;
  issuedDate?: string;
  expiryDate: string;
  fileUrl?: string;
  alertDaysBeforeExpiry?: number;
  status: DocumentComplianceStatus;
  createdAt: string;
}

// Subcollection 12: Maintenance
export interface FirestoreMaintenanceRecord {
  id: string;
  companyId: string;
  vehicleId: string;
  serviceType: MaintenanceServiceType;
  odometerKm?: number;
  serviceDate: string;
  workshopName?: string;
  cost: number;
  partsReplaced?: string;
  nextServiceDueKm?: number;
  nextServiceDueDate?: string;
  status: MaintenanceStatus;
  createdAt: string;
}

// Subcollection 13: Audit Logs
export interface FirestoreAuditLog {
  id: string;
  companyId: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  actorId: string;
  actorEmail?: string;
  actorRole?: string;
  details?: string;
  ipAddress?: string;
  timestamp: string;
}

// Standardized collection path builders
export const FirestorePaths = {
  user: (userId: string) => `users/${userId}`,
  company: (companyId: string) => `companies/${companyId}`,
  members: (companyId: string) => `companies/${companyId}/members`,
  member: (companyId: string, userId: string) => `companies/${companyId}/members/${userId}`,
  vehicles: (companyId: string) => `companies/${companyId}/vehicles`,
  vehicle: (companyId: string, vehicleId: string) => `companies/${companyId}/vehicles/${vehicleId}`,
  drivers: (companyId: string) => `companies/${companyId}/drivers`,
  driver: (companyId: string, driverId: string) => `companies/${companyId}/drivers/${driverId}`,
  customers: (companyId: string) => `companies/${companyId}/customers`,
  customer: (companyId: string, customerId: string) => `companies/${companyId}/customers/${customerId}`,
  trips: (companyId: string) => `companies/${companyId}/trips`,
  trip: (companyId: string, tripId: string) => `companies/${companyId}/trips/${tripId}`,
  expenses: (companyId: string) => `companies/${companyId}/expenses`,
  expense: (companyId: string, expenseId: string) => `companies/${companyId}/expenses/${expenseId}`,
  advances: (companyId: string) => `companies/${companyId}/advances`,
  advance: (companyId: string, advanceId: string) => `companies/${companyId}/advances/${advanceId}`,
  settlements: (companyId: string) => `companies/${companyId}/settlements`,
  settlement: (companyId: string, settlementId: string) => `companies/${companyId}/settlements/${settlementId}`,
  invoices: (companyId: string) => `companies/${companyId}/invoices`,
  invoice: (companyId: string, invoiceId: string) => `companies/${companyId}/invoices/${invoiceId}`,
  payments: (companyId: string) => `companies/${companyId}/payments`,
  payment: (companyId: string, paymentId: string) => `companies/${companyId}/payments/${paymentId}`,
  documents: (companyId: string) => `companies/${companyId}/documents`,
  document: (companyId: string, docId: string) => `companies/${companyId}/documents/${docId}`,
  maintenance: (companyId: string) => `companies/${companyId}/maintenance`,
  maintenanceRecord: (companyId: string, recordId: string) => `companies/${companyId}/maintenance/${recordId}`,
  auditLogs: (companyId: string) => `companies/${companyId}/auditLogs`,
  auditLog: (companyId: string, logId: string) => `companies/${companyId}/auditLogs/${logId}`,
};
