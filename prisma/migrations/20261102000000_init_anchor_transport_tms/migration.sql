-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('AVAILABLE', 'IN_TRANSIT', 'UNDER_MAINTENANCE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('TEN_WHEELER_16T', 'TWELVE_WHEELER_21T', 'FOURTEEN_WHEELER_28T', 'SIXTEEN_WHEELER_35T', 'TRAILER_40T_PLUS', 'TATA_407_2_5T', 'EICHER_17FT_6T', 'CONTAINER_32FT');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('AVAILABLE', 'ON_TRIP', 'ON_LEAVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('DIESEL', 'TOLL_FASTAG', 'LOADING_UNLOADING', 'DRIVER_BATA', 'RTO_POLICE', 'DEF_ADBLUE', 'TYRE_PUNCTURE', 'EN_ROUTE_REPAIR', 'WEIGHBRIDGE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'FASTAG', 'PETRO_CARD', 'UPI', 'DRIVER_POCKET', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "AdvanceType" AS ENUM ('CASH_DISPATCH', 'PUMP_DIESEL_SLIP', 'UPI_ONLINE', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED_SETTLED');

-- CreateEnum
CREATE TYPE "InvoicePaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "PaymentRecordMode" AS ENUM ('NEFT_RTGS', 'CHEQUE', 'UPI', 'CASH');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('RC', 'FITNESS', 'NATIONAL_PERMIT', 'STATE_PERMIT', 'INSURANCE', 'PUC', 'ROAD_TAX');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('SCHEDULED_SERVICE', 'TYRE_REPLACEMENT', 'ENGINE_WORK', 'BRAKE_SUSPENSION', 'ACCIDENT_BREAKDOWN');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'DISPATCH', 'SETTLE', 'INVOICE', 'PAYMENT');

-- CreateEnum
CREATE TYPE "AuditEntity" AS ENUM ('TRIP', 'VEHICLE', 'DRIVER', 'SETTLEMENT', 'INVOICE', 'PAYMENT', 'EXPENSE', 'DOCUMENT', 'MAINTENANCE');

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "tradeName" VARCHAR(200),
    "gstin" VARCHAR(15) NOT NULL,
    "pan" VARCHAR(10) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "address" TEXT NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100) NOT NULL,
    "stateCode" VARCHAR(2) NOT NULL,
    "pincode" VARCHAR(10) NOT NULL,
    "bankName" VARCHAR(150) NOT NULL,
    "accountNumber" VARCHAR(50) NOT NULL,
    "ifscCode" VARCHAR(20) NOT NULL,
    "branch" VARCHAR(150) NOT NULL,
    "lrPrefix" VARCHAR(30) NOT NULL DEFAULT 'AT/25-26/',
    "invoicePrefix" VARCHAR(30) NOT NULL DEFAULT 'INV/25-26/',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "avatarUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyUser" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OPERATIONS',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "CompanyUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "registrationNumber" VARCHAR(20) NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "makeModel" VARCHAR(100) NOT NULL,
    "capacityTonnes" DECIMAL(8,2) NOT NULL,
    "unladenWeightTonnes" DECIMAL(8,2) NOT NULL,
    "chassisNumber" VARCHAR(50) NOT NULL,
    "engineNumber" VARCHAR(50) NOT NULL,
    "status" "VehicleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "currentOdometerKm" INTEGER NOT NULL DEFAULT 0,
    "fastagBalance" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "assignedDriverId" UUID,
    "activeTripId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "fullName" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "altPhone" VARCHAR(20),
    "licenseNumber" VARCHAR(50) NOT NULL,
    "licenseExpiry" DATE NOT NULL,
    "badgeNumber" VARCHAR(50),
    "address" TEXT NOT NULL,
    "emergencyContact" VARCHAR(150) NOT NULL,
    "emergencyPhone" VARCHAR(20) NOT NULL,
    "status" "DriverStatus" NOT NULL DEFAULT 'AVAILABLE',
    "currentAdvanceBalance" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "perDayBata" DECIMAL(10,2) NOT NULL DEFAULT 500.00,
    "totalTripsCompleted" INTEGER NOT NULL DEFAULT 0,
    "joinedDate" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "tradeName" VARCHAR(200),
    "gstin" VARCHAR(15) NOT NULL,
    "pan" VARCHAR(10) NOT NULL,
    "contactPerson" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(255),
    "billingAddress" TEXT NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100) NOT NULL,
    "stateCode" VARCHAR(2) NOT NULL,
    "pincode" VARCHAR(10) NOT NULL,
    "creditPeriodDays" INTEGER NOT NULL DEFAULT 30,
    "creditLimit" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "currentOutstanding" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "totalFreightBilled" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "tripNumber" VARCHAR(50) NOT NULL,
    "lrNumber" VARCHAR(50) NOT NULL,
    "customerId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "originCity" VARCHAR(100) NOT NULL,
    "destinationCity" VARCHAR(100) NOT NULL,
    "goodsType" VARCHAR(150) NOT NULL,
    "weightTonnes" DECIMAL(8,2) NOT NULL,
    "ratePerTonne" DECIMAL(10,2) NOT NULL,
    "freightAmount" DECIMAL(12,2) NOT NULL,
    "otherCharges" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "totalRevenue" DECIMAL(12,2) NOT NULL,
    "totalExpenses" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "totalAdvances" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "tripContribution" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "dispatchDate" TIMESTAMPTZ NOT NULL,
    "expectedDeliveryDate" TIMESTAMPTZ NOT NULL,
    "actualDeliveryDate" TIMESTAMPTZ,
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNED',
    "startOdometerKm" INTEGER NOT NULL DEFAULT 0,
    "endOdometerKm" INTEGER,
    "podReceived" BOOLEAN NOT NULL DEFAULT false,
    "podDocumentUrl" TEXT,
    "isSettled" BOOLEAN NOT NULL DEFAULT false,
    "isInvoiced" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripExpense" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "litresFuel" DECIMAL(8,2),
    "ratePerLitre" DECIMAL(8,2),
    "pumpName" VARCHAR(150),
    "odometerReading" INTEGER,
    "receiptNumber" VARCHAR(100),
    "receiptUrl" TEXT,
    "recordedBy" VARCHAR(150) NOT NULL,
    "isDriverDisbursed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "TripExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverAdvance" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "advanceType" "AdvanceType" NOT NULL,
    "date" DATE NOT NULL,
    "referenceNotes" TEXT,
    "disbursedBy" VARCHAR(150) NOT NULL,
    "isSettled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "DriverAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripSettlement" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "totalAdvanceGiven" DECIMAL(12,2) NOT NULL,
    "driverCashExpenses" DECIMAL(12,2) NOT NULL,
    "driverBataAllowance" DECIMAL(10,2) NOT NULL,
    "otherDeductions" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "netPayableToDriver" DECIMAL(12,2) NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "settledDate" DATE NOT NULL,
    "settledBy" VARCHAR(150) NOT NULL,
    "settlementNotes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "TripSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "invoiceNumber" VARCHAR(50) NOT NULL,
    "tripId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "issueDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "taxableAmount" DECIMAL(12,2) NOT NULL,
    "isRcmApplicable" BOOLEAN NOT NULL DEFAULT true,
    "cgstRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "sgstRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "igstRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "cgstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "sgstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "igstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "balanceDue" DECIMAL(12,2) NOT NULL,
    "paymentStatus" "InvoicePaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentDate" DATE NOT NULL,
    "paymentMode" "PaymentRecordMode" NOT NULL,
    "referenceNumber" VARCHAR(100) NOT NULL,
    "tdsDeducted" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "bankAccount" VARCHAR(150) NOT NULL,
    "recordedBy" VARCHAR(150) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleDocument" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "docType" "DocumentType" NOT NULL,
    "documentNumber" VARCHAR(100) NOT NULL,
    "issuingAuthority" VARCHAR(150) NOT NULL,
    "issueDate" DATE NOT NULL,
    "expiryDate" DATE NOT NULL,
    "documentUrl" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "VehicleDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRecord" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "serviceType" "MaintenanceType" NOT NULL,
    "garageName" VARCHAR(150) NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL,
    "odometerReading" INTEGER NOT NULL,
    "serviceDate" DATE NOT NULL,
    "partsReplaced" TEXT,
    "invoiceNumber" VARCHAR(100),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "MaintenanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "userName" VARCHAR(150) NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" "AuditEntity" NOT NULL,
    "entityId" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "ipAddress" VARCHAR(45),
    "previousStateJson" TEXT,
    "newStateJson" TEXT,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Company_stateCode_idx" ON "Company"("stateCode");

-- CreateIndex
CREATE UNIQUE INDEX "Company_gstin_key" ON "Company"("gstin");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "CompanyUser_companyId_role_idx" ON "CompanyUser"("companyId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyUser_companyId_userId_key" ON "CompanyUser"("companyId", "userId");

-- CreateIndex
CREATE INDEX "Vehicle_companyId_status_idx" ON "Vehicle"("companyId", "status");

-- CreateIndex
CREATE INDEX "Vehicle_companyId_vehicleType_idx" ON "Vehicle"("companyId", "vehicleType");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_companyId_registrationNumber_key" ON "Vehicle"("companyId", "registrationNumber");

-- CreateIndex
CREATE INDEX "Driver_companyId_status_idx" ON "Driver"("companyId", "status");

-- CreateIndex
CREATE INDEX "Driver_companyId_phone_idx" ON "Driver"("companyId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_companyId_licenseNumber_key" ON "Driver"("companyId", "licenseNumber");

-- CreateIndex
CREATE INDEX "Customer_companyId_name_idx" ON "Customer"("companyId", "name");

-- CreateIndex
CREATE INDEX "Customer_companyId_currentOutstanding_idx" ON "Customer"("companyId", "currentOutstanding");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_companyId_gstin_key" ON "Customer"("companyId", "gstin");

-- CreateIndex
CREATE INDEX "Trip_companyId_status_idx" ON "Trip"("companyId", "status");

-- CreateIndex
CREATE INDEX "Trip_companyId_dispatchDate_idx" ON "Trip"("companyId", "dispatchDate");

-- CreateIndex
CREATE INDEX "Trip_companyId_customerId_idx" ON "Trip"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "Trip_companyId_vehicleId_idx" ON "Trip"("companyId", "vehicleId");

-- CreateIndex
CREATE INDEX "Trip_companyId_driverId_idx" ON "Trip"("companyId", "driverId");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_companyId_tripNumber_key" ON "Trip"("companyId", "tripNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_companyId_lrNumber_key" ON "Trip"("companyId", "lrNumber");

-- CreateIndex
CREATE INDEX "TripExpense_companyId_tripId_idx" ON "TripExpense"("companyId", "tripId");

-- CreateIndex
CREATE INDEX "TripExpense_companyId_category_idx" ON "TripExpense"("companyId", "category");

-- CreateIndex
CREATE INDEX "TripExpense_companyId_date_idx" ON "TripExpense"("companyId", "date");

-- CreateIndex
CREATE INDEX "DriverAdvance_companyId_driverId_idx" ON "DriverAdvance"("companyId", "driverId");

-- CreateIndex
CREATE INDEX "DriverAdvance_companyId_tripId_idx" ON "DriverAdvance"("companyId", "tripId");

-- CreateIndex
CREATE INDEX "DriverAdvance_companyId_isSettled_idx" ON "DriverAdvance"("companyId", "isSettled");

-- CreateIndex
CREATE UNIQUE INDEX "TripSettlement_tripId_key" ON "TripSettlement"("tripId");

-- CreateIndex
CREATE INDEX "TripSettlement_companyId_status_idx" ON "TripSettlement"("companyId", "status");

-- CreateIndex
CREATE INDEX "TripSettlement_companyId_driverId_idx" ON "TripSettlement"("companyId", "driverId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tripId_key" ON "Invoice"("tripId");

-- CreateIndex
CREATE INDEX "Invoice_companyId_customerId_idx" ON "Invoice"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "Invoice_companyId_paymentStatus_idx" ON "Invoice"("companyId", "paymentStatus");

-- CreateIndex
CREATE INDEX "Invoice_companyId_issueDate_idx" ON "Invoice"("companyId", "issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_companyId_invoiceNumber_key" ON "Invoice"("companyId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "Payment_companyId_invoiceId_idx" ON "Payment"("companyId", "invoiceId");

-- CreateIndex
CREATE INDEX "Payment_companyId_customerId_idx" ON "Payment"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "Payment_companyId_paymentDate_idx" ON "Payment"("companyId", "paymentDate");

-- CreateIndex
CREATE INDEX "VehicleDocument_companyId_expiryDate_idx" ON "VehicleDocument"("companyId", "expiryDate");

-- CreateIndex
CREATE INDEX "VehicleDocument_companyId_docType_idx" ON "VehicleDocument"("companyId", "docType");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleDocument_vehicleId_docType_key" ON "VehicleDocument"("vehicleId", "docType");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_companyId_vehicleId_idx" ON "MaintenanceRecord"("companyId", "vehicleId");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_companyId_serviceDate_idx" ON "MaintenanceRecord"("companyId", "serviceDate");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_timestamp_idx" ON "AuditLog"("companyId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_entityType_entityId_idx" ON "AuditLog"("companyId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "CompanyUser" ADD CONSTRAINT "CompanyUser_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyUser" ADD CONSTRAINT "CompanyUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_assignedDriverId_fkey" FOREIGN KEY ("assignedDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripExpense" ADD CONSTRAINT "TripExpense_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripExpense" ADD CONSTRAINT "TripExpense_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripExpense" ADD CONSTRAINT "TripExpense_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverAdvance" ADD CONSTRAINT "DriverAdvance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverAdvance" ADD CONSTRAINT "DriverAdvance_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverAdvance" ADD CONSTRAINT "DriverAdvance_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripSettlement" ADD CONSTRAINT "TripSettlement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripSettlement" ADD CONSTRAINT "TripSettlement_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripSettlement" ADD CONSTRAINT "TripSettlement_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDocument" ADD CONSTRAINT "VehicleDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDocument" ADD CONSTRAINT "VehicleDocument_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

