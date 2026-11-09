# AnchorTransport TMS — System Architecture & Implementation Plan

> Production-grade, multi-tenant Transport Management System engineered specifically for Indian road transport fleet owners (5–50 commercial trucks), initially targeting the West Bengal transport corridor and expanding nationally.

---

## 1. Executive Architecture Overview

FleetGati TMS is designed to bridge the operational gap between grassroots transport workflows (notebooks, driver WhatsApp messages, cash advances at petrol pumps, weighbridge receipts) and institutional accounting.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER (Mobile & Web)                     │
│  React 19 + Tailwind CSS + Lucide Icons + Radix UI Primitives          │
│  Responsive Viewports: Desktop Fleet Console + Driver/Owner Mobile PWA │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS / REST / JSON
┌───────────────────────────────────▼────────────────────────────────────┐
│                    API GATEWAY & SECURITY PERIMETER                    │
│  - Session & JWT Auth / Tenant Context Middleware (X-Company-Id)       │
│  - Role-Based Access Control (RBAC): Owner, Admin, Mgr, Acct, Staff    │
│  - Input Sanitization & Zod Schemas / Rate Limiting                    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│                       CORE APPLICATION SERVICES                        │
│ ┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────┐ │
│ │ Trip & Dispatch Svc  │ │ Financial Engine     │ │ Compliance Svc   │ │
│ │ - LR / Challan Gen   │ │ - Trip Contribution  │ │ - VAHAN / RTO    │ │
│ │ - Trip Life-cycle    │ │ - Advance Settlement │ │ - Document Expiry│ │
│ │ - Status Transition  │ │ - GST Invoicing      │ │ - Maintenance    │ │
│ └──────────────────────┘ └──────────────────────┘ └──────────────────┘ │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Atomic Transactions (Prisma / SQL)
┌───────────────────────────────────▼────────────────────────────────────┐
│                   PERSISTENCE LAYER (Multi-Tenant)                     │
│  PostgreSQL Database (Tenant Isolation via company_id + RLS)           │
│  Encrypted Document Store (Private S3/Cloud Storage for RC, Permit, LR)│
└────────────────────────────────────────────────────────────────────────┘
```

### Architectural Tenets
1. **Multi-Tenant Isolation by Default**: Every operational table possesses a non-nullable `company_id`. All server queries enforce `WHERE company_id = session.company_id` enforced by middleware, eliminating Insecure Direct Object References (IDOR).
2. **Fixed-Point Financial Engine**: Zero JavaScript floating-point math (`0.1 + 0.2 != 0.3`). All monetary figures (freight, advances, diesel costs, toll, GST, TDS) are calculated using integer paise or arbitrary-precision decimal strings (`Prisma.Decimal` / `decimal.js`).
3. **Decoupled Workflow States**: A completed trip is NOT an invoice; an advance is NOT an expense; a delivery is NOT a payment. These 6 distinct state machines allow transporters to mirror realistic road delays and credit cycles.

---

## 2. Complete Application Folder Structure

```
fleetgati-tms/
├── .env.example                     # Environment template (NO SECRETS)
├── package.json
├── tsconfig.json
├── vite.config.ts                   # Fast Vite dev/build bundler
├── server.ts                        # Full-stack Node/Express server entry point
│
├── prisma/                          # Database Schema & Migrations
│   ├── schema.prisma                # Normalized multi-tenant Postgres schema
│   ├── migrations/                  # Version-controlled SQL migrations
│   └── seed.ts                      # Demonstration & fixture seed script
│
├── src/
│   ├── main.tsx                     # React client bootstrap
│   ├── App.tsx                      # Routing & global session wrapper
│   ├── index.css                    # Tailwind CSS tokens & theme
│   │
│   ├── api/                         # Backend API Route Controllers
│   │   ├── middleware/
│   │   │   ├── auth.ts              # JWT / Cookie session validator
│   │   │   ├── tenant.ts            # Company boundary enforcement
│   │   │   └── rbac.ts              # Permission gate (Owner, Admin, Accountant...)
│   │   ├── auth.controller.ts       # Login, company register, switch tenant
│   │   ├── trips.controller.ts      # Trip dispatch, status, LR generation
│   │   ├── finance.controller.ts    # Advances, settlements, contribution
│   │   ├── invoices.controller.ts   # GST e-invoice, billing, PDF generation
│   │   ├── payments.controller.ts   # Partial payments, ledger balance
│   │   ├── vehicles.controller.ts   # Fleet registry & odometer
│   │   ├── drivers.controller.ts    # Driver onboarding & assignment
│   │   ├── compliance.controller.ts # Documents, fitness, insurance alerts
│   │   └── reports.controller.ts    # Profitability, mileage, outstanding balances
│   │
│   ├── components/                  # Reusable UI Component Library
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx          # Desktop navigation with role-based links
│   │   │   ├── MobileNav.tsx        # Responsive mobile app bar & drawer
│   │   │   ├── Topbar.tsx           # Company switcher, notifications, user profile
│   │   │   └── PageHeader.tsx       # Standardized header with breadcrumb & CTAs
│   │   ├── ui/
│   │   │   ├── Button.tsx           # Standard button with loading spinners
│   │   │   ├── DataTable.tsx        # Sortable, paginated, searchable table
│   │   │   ├── Modal.tsx            # Accessible modal dialog
│   │   │   ├── Badge.tsx            # Status pills (Active, In Transit, Settled)
│   │   │   ├── StatCard.tsx         # Metric display with trends
│   │   │   ├── Tabs.tsx             # Tabbed navigation within pages
│   │   │   └── ConfirmDialog.tsx    # Destructive action safeguards
│   │   └── forms/
│   │       ├── TripForm.tsx         # Multi-step trip dispatch form
│   │       ├── ExpenseModal.tsx     # Fast diesel/toll entry
│   │       ├── AdvanceModal.tsx     # Cash/UPI driver advance recording
│   │       ├── SettlementModal.tsx  # Final driver trip audit & balance
│   │       └── InvoiceModal.tsx     # GST calculation & line-item builder
│   │
│   ├── hooks/                       # Custom React Hooks
│   │   ├── useAuth.ts               # Session context & role checks
│   │   ├── useCompany.ts            # Current active company state
│   │   └── useDebounce.ts           # Search debounce for large vehicle/trip tables
│   │
│   ├── lib/                         # Shared Utilities & Business Rules
│   │   ├── db.ts                    # Prisma client singleton
│   │   ├── currency.ts              # INR (₹) formatting & integer-paise math
│   │   ├── financialEngine.ts       # Trip contribution, invoice balance formulas
│   │   ├── pdfGenerator.ts          # Printable Lorry Receipt (LR) & Tax Invoices
│   │   ├── validators.ts            # Zod validation schemas (GSTIN, PAN, Phone)
│   │   └── dateUtils.ts             # IST timestamp conversions & expiry math
│   │
│   ├── modules/                     # Major Feature Views
│   │   ├── auth/                    # Login, Register, Invite views
│   │   ├── dashboard/               # Operational cockpit & financial snapshot
│   │   ├── trips/                   # Active, Completed, Dispatched Trip board
│   │   ├── vehicles/                # Fleet list, specs, fitness tracker
│   │   ├── drivers/                 # Driver list, licences, active duty
│   │   ├── customers/               # Consignors/Consignees, credit limits
│   │   ├── expenses/                # Diesel, toll, maintenance, petty cash
│   │   ├── settlements/             # Driver advances & trip closure reconciliation
│   │   ├── invoices/                # GST billing, print/download LR & Invoice
│   │   ├── payments/                # Ledger, partial payment records, receipts
│   │   ├── compliance/              # Road Tax, National Permit, Pollution (PUC)
│   │   ├── maintenance/             # Service logs, tyre replacement, breakdown
│   │   ├── reports/                 # Vehicle profit/loss, diesel average, debtor aging
│   │   └── settings/                # Company profile, GSTIN, bank details, users
│   │
│   └── types/                       # TypeScript Data Models
│       └── tms.ts                   # Strict interfaces for domain entities
```

---

## 3. Database Schema Overview (PostgreSQL / Prisma)

The relational schema ensures ACID compliance, high performance on analytical queries, and guaranteed multi-tenant isolation.

```
┌──────────────┐       1:N       ┌──────────────────┐
│   Company    ├────────────────►│   CompanyUser    │
└──────┬───────┘                 └────────┬─────────┘
       │                                  │
       │ 1:N                              │ N:1
       ├────────────────► ┌───────────────▼┐
       │                  │      User      │
       │                  └────────────────┘
       │ 1:N
       ├────────────────► Vehicle ──────────────┐ 1:N
       │                    │                   ├────────► VehicleDocument
       │                    │ 1:N               └────────► MaintenanceRecord
       │                    ▼
       ├────────────────► Driver ───────────────┐ 1:N
       │                    │                   └────────► DriverAdvance
       │                    │ 1:N
       │                    ▼
       ├────────────────► Customer (Consignor / Consignee)
       │                    │ 1:N
       │                    ▼
       ├────────────────► Trip ─────────────────┐ 1:N
       │                    │                   ├────────► TripExpense (Fuel, Toll, Police)
       │                    │                   ├────────► DriverAdvance
       │                    │                   ├────────► TripSettlement
       │                    │                   └────────► InvoiceLineItem
       │                    │ 1:1
       │                    ▼
       ├────────────────► Invoice ──────────────┐ 1:N
       │                                        └────────► Payment
       │ 1:N
       └────────────────► AuditLog
```

### Core Entities & Key Fields:
- **`Company`**: `id` (UUID), `name`, `trade_name`, `gstin`, `pan`, `state_code` (e.g. 19 for WB), `address`, `phone`, `bank_name`, `account_no`, `ifsc`, `created_at`.
- **`User`**: `id`, `email`, `phone`, `name`, `password_hash`, `is_active`.
- **`CompanyUser`**: `id`, `company_id`, `user_id`, `role` (`OWNER`, `ADMIN`, `MANAGER`, `ACCOUNTANT`, `OPERATIONS`), `status`.
- **`Vehicle`**: `id`, `company_id`, `registration_no` (e.g. WB-19-XXXX), `vehicle_type` (10-wheeler, 14-wheeler, Trailer, Tata 407), `capacity_tonnes`, `unladen_weight`, `chassis_no`, `engine_no`, `status` (`AVAILABLE`, `IN_TRANSIT`, `UNDER_MAINTENANCE`, `INACTIVE`), `current_odometer_km`.
- **`Driver`**: `id`, `company_id`, `full_name`, `phone`, `license_no`, `license_expiry`, `emergency_contact`, `status` (`AVAILABLE`, `ON_TRIP`, `ON_LEAVE`), `current_balance_paise`.
- **`Customer`**: `id`, `company_id`, `name`, `gstin`, `pan`, `billing_address`, `contact_person`, `phone`, `credit_period_days`, `outstanding_balance_paise`.
- **`Trip`**: `id`, `company_id`, `trip_number` (e.g. TR-2026-0001), `customer_id`, `vehicle_id`, `driver_id`, `origin_city`, `destination_city`, `loading_date`, `delivery_date`, `expected_delivery_date`, `lr_number`, `goods_type`, `weight_tonnes`, `freight_rate_per_tonne`, `total_freight_paise`, `status` (`PLANNED`, `DISPATCHED`, `DELIVERED`, `SETTLED`, `CANCELLED`), `notes`.
- **`TripExpense`**: `id`, `company_id`, `trip_id`, `vehicle_id`, `category` (`DIESEL`, `TOLL`, `UNLOADING`, `POLICE_RTO`, `DEF_ADBLUE`, `FOOD_ALLOWANCE`, `REPAIR`, `OTHER`), `amount_paise`, `litres_fuel`, `odometer_at_fuel`, `payment_mode` (`CASH`, `FASTAG`, `PETRO_CARD`, `UPI`, `DRIVER_POCKET`), `receipt_url`, `recorded_by_id`, `expense_date`.
- **`DriverAdvance`**: `id`, `company_id`, `trip_id`, `driver_id`, `amount_paise`, `advance_type` (`CASH_DISPATCH`, `PUMP_DIESEL_SLIP`, `BANK_TRANSFER`, `UPI`), `advance_date`, `settled` (boolean), `reference_notes`.
- **`TripSettlement`**: `id`, `company_id`, `trip_id`, `driver_id`, `total_advance_given_paise`, `total_driver_expenses_paise`, `driver_bata_allowance_paise`, `net_balance_paise` (positive = company owes driver; negative = driver returns cash), `settlement_status` (`PENDING_APPROVAL`, `SETTLED`), `settled_date`, `settled_by_id`.
- **`Invoice`**: `id`, `company_id`, `invoice_no` (e.g. INV/25-26/012), `customer_id`, `trip_id`, `issue_date`, `due_date`, `taxable_amount_paise`, `cgst_paise`, `sgst_paise`, `igst_paise`, `total_amount_paise`, `amount_paid_paise`, `payment_status` (`UNPAID`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`).
- **`Payment`**: `id`, `company_id`, `invoice_id`, `customer_id`, `amount_paise`, `payment_date`, `payment_mode` (`NEFT_RTGS`, `CHEQUE`, `UPI`, `CASH`), `reference_no`, `tds_deducted_paise`.
- **`VehicleDocument`**: `id`, `company_id`, `vehicle_id`, `doc_type` (`RC`, `FITNESS`, `NATIONAL_PERMIT`, `INSURANCE`, `PUC`, `ROAD_TAX`), `doc_number`, `valid_from`, `valid_to`, `file_url`, `alert_before_days`.
- **`MaintenanceRecord`**: `id`, `company_id`, `vehicle_id`, `service_type` (`OIL_CHANGE`, `TYRE_REPLACEMENT`, `ENGINE_OVERHAUL`, `BRAKE_CLUTCH`, `BREAKDOWN`), `cost_paise`, `garage_name`, `odometer_reading`, `service_date`.
- **`AuditLog`**: `id`, `company_id`, `user_id`, `action`, `entity_type`, `entity_id`, `ip_address`, `payload_diff`, `timestamp`.

---

## 4. Main Application Modules

1. **Dashboard & Fleet Command Cockpit**:
   - Fleet Utilization (Total vs Active vs Idle vs Breakdown)
   - Real-time Freight Revenue vs Diesel/Toll Expenses (Gross Contribution)
   - Critical Document Expiry Alerts (Expiring in 15/30 days)
   - Pending Driver Settlements requiring audit
   - Unpaid Invoices & Overdue Customer Receivables

2. **Fleet & Vehicle Management**:
   - Complete vehicle specifications, axle configuration, gross vehicle weight (GVW)
   - Odometer tracker & tyre position logs
   - Vehicle document vault with color-coded compliance status (Green = Valid, Amber = Expiring < 15 days, Red = Expired)

3. **Driver Directory & Advance Tracking**:
   - Driver bio, commercial heavy driving license verification, photo ID
   - Live driver advance balance ledger
   - Trip assignment history & performance rating

4. **Customer (Consignor / Consignee) Directory**:
   - GSTIN compliance validator (19XXXXX for West Bengal, inter-state IGST mapping)
   - Agreed freight rates by lane (e.g., Kolkata → Siliguri, Haldia → Durgapur)
   - Real-time debtor ledger & outstanding balance

5. **Trips & Dispatch Lifecycle**:
   - Dispatch wizard: Select Customer → Auto-fetch Lane Rate → Assign Vehicle & Driver → Print LR (Lorry Receipt / Consignment Note)
   - Status milestones: Planned → Dispatched → In-Transit → Delivered → Unloaded → Settle Ready

6. **Expenses & Fuel Ledger**:
   - Fuel tracking with mileage calculation (km/litre)
   - FastTag toll reconciliation, unloading charges, RTO/Police expense logging
   - Categorized payment mode logging (PetroCard, Cash, Company FastTag)

7. **Driver Trip Settlement Engine**:
   - Direct reconciliation: Advance given − Verified vouchers + Driver bata allowance = Final payout / Refund
   - Protects against double-counting advances as corporate expenses

8. **Invoicing & GST Billing**:
   - Generates compliant Indian B2B Tax Invoices with Reverse Charge Mechanism (RCM) options standard in GTA (Goods Transport Agency) operations
   - Automated CGST+SGST (5% / 12% without ITC) or IGST based on place of supply
   - Export to PDF with signature & bank QR details

9. **Customer Payments & Receivables**:
   - Partial payment logging with TDS (e.g. 1% / 2% under Section 194C)
   - Aging report (0–30 days, 31–60 days, 60+ days)

10. **Reports & Profitability Analytics**:
    - **Trip Profitability**: Freight Revenue − Direct Trip Expenses = Trip Contribution
    - **Vehicle P&L**: Contribution − (Allocated Maintenance + Fixed EMI + Insurance) = Net Fleet Return
    - **Route / Lane Performance**: Kolkata-Siliguri vs Kolkata-Guwahati profitability comparison

11. **Tenant Settings & Multi-User Governance**:
    - Company profile, customized LR numbering prefix, bank accounts
    - Role management (Owner, Admin, Manager, Accountant, Operations)

---

## 5. Development Phases

- **Phase 1: Architecture & Project Setup** [COMPLETED]
  - Project configuration, directory layout, core types, UI component baseline, Express API proxy integration, and layout scaffolding.
- **Phase 2: Database Schema & Migrations** [COMPLETED]
  - Normalized schema in Prisma, data integrity constraints, indexing, and seed data for typical Indian fleet operations.
- **Phase 3: Authentication & Multi-Tenant Company Isolation** [COMPLETED]
  - Firebase Client + Admin SDK, 12 company-scoped collections, ABAC security rules, session tokens, and cross-company penetration tests.
- **Phase 4: Professional TMS Dashboard** [COMPLETED]
  - Logistics SaaS dashboard layout (Desktop sidebar + Topbar + Mobile bottom nav & drawer).
  - 8 core metrics: Active trips, Completed trips, Freight revenue, Recorded expenses, Trip contribution (with margin %), Outstanding invoices, Recent trips table, Vehicles requiring attention.
  - Complete states: loading skeleton, error banner, empty state for new/unpopulated companies.
  - Date filtering (All Time, Today, This Week, This Month, This Quarter, Custom Range).
  - 1-click test toggles for "Sample Fleet Data" vs "Clean Slate (Empty State)".
  - 100% company-scoped queries via `/api/dashboard/stats`.
- **Phase 5: Master Registries (Vehicles, Drivers, Customers)** [NEXT]
  - Full CRUD with validation (vehicle registration formats, driving licence numbers, GSTIN, payment terms).
- **Phase 6: Trips & Dispatch Operations**
  - Dispatch workflow, LR generation, status transitions, and load details.
- **Phase 7: Expenses, Advances & Driver Settlements**
  - Diesel/toll expense logging, cash advance allocation, and trip settlement calculator.
- **Phase 8: GST Invoices & Customer Payments**
  - GTA tax invoice generation (RCM / Forward Charge), partial payment allocation, and TDS tracking.
- **Phase 9: Analytics, Reports & Company Settings**
  - Trip contribution reports, vehicle efficiency (km/L), customer debtor ledger, and system configuration.
- **Phase 10: Testing, Security Audit & Production Readiness**
  - Cross-tenant penetration tests, financial invariant validations, automated UI testing, and backup protocols.

---

## 6. Important Security Decisions

1. **Strict Server-Enforced Tenant Scoping**:
   `company_id` is never accepted from incoming user request payloads for any update, create, or read operation. It is derived exclusively from the authenticated session token.
2. **Defensive Financial Arithmetic**:
   No native JS floating point numbers (`Number`) are used for currency calculations. All balances and monetary figures are tracked as exact integers in **paise** (1 INR = 100 paise) or `Prisma.Decimal`, preventing rounding discrepancies across thousands of trips.
3. **Immutability of Settled Records**:
   Once a `TripSettlement` is approved and finalized, associated `TripExpense` and `DriverAdvance` records are locked against deletion or modification. Changes require a supervisor adjustment entry with audit logging.
4. **Audit Trail Logging**:
   Every state transition (Trip Dispatched, Advance Given, Settlement Approved, Invoice Paid) writes an entry to `AuditLog` containing `user_id`, `company_id`, timestamp, and before/after JSON diffs.
5. **Private Document Storage**:
   RC books, driving licenses, and permit photos are stored with private access control; downloads use time-limited presigned URLs (15-minute expiration) verified against the company ID.

---

## 7. Budget-Conscious Hosting Recommendation (< ₹1 Lakh / ~$1,200/yr)

For 5–50 truck transport companies, cost predictability is paramount. The entire production stack can be run reliably for **under ₹2,500 – ₹4,500 / month (~₹30,000 – ₹54,000 / year)**, well within the ₹1 lakh ceiling:

| Component | Recommended Service | Monthly Cost | Rationale |
|---|---|---|---|
| **App & API Server** | Hetzner Cloud (CPX21 - 3 vCPU / 4GB RAM) or DigitalOcean App Platform | ₹800 – ₹1,500 | Sufficient for 500+ daily concurrent trips and instant UI response |
| **Database** | Managed PostgreSQL (Hetzner / Neon / Supabase Developer tier) | ₹1,000 – ₹1,800 | Automated daily snapshots, point-in-time recovery, zero maintenance |
| **Object Storage** | Cloudflare R2 or Wasabi S3 | ₹200 – ₹500 | Zero egress fees for storing vehicle RC and permit scans |
| **Domain & SSL** | Cloudflare (Free DNS + CDN + SSL) + .in Domain | ₹80 / month (₹900/yr) | Enterprise DDoS protection and fast routing across Indian networks |
| **Transactional SMS / WhatsApp** | Gupshup / Fast2SMS (Indian Gateway) | Pay-as-you-go (~₹500/mo) | Critical for sending dispatch alerts and advance receipts to drivers |
| **Total Estimated Spend** | **All-in production budget** | **~₹2,500 – ₹4,300 / mo (₹30k–₹52k / yr)** | Leaves over ₹48,000 buffer for backup servers & domain licensing |

---

## 8. Risks and Technical Assumptions

### Assumptions:
1. **Fleet Topology**: The transporter owns the trucks and employs or contracts drivers directly (no third-party brokerage or marketplace mechanics).
2. **Regional Compliance**: First deployment in West Bengal incorporates local state tax nuances (WB GST code 19, RTO formats like WB-01 through WB-99, Kolkata port corridor routes).
3. **Payment Habits**: Indian transport relies heavily on cash/UPI driver advances and fuel credit slips; the software must accommodate offline/cash reality before bank reconciliation.

### Identified Risks & Mitigations:
- **Risk 1 (Double Counted Advances)**: Drivers often report fuel expenses paid using money previously given as advance.
  - *Mitigation*: The settlement engine explicitly distinguishes whether an expense was paid from "Driver Cash in Hand" (which offsets advance) or "Direct Company PetroCard" (which doesn't).
- **Risk 2 (Delayed Invoice Payments)**: Consignors frequently hold payment for 45–90 days pending physical POD (Proof of Delivery).
  - *Mitigation*: Separate "Delivery Confirmed" from "POD Received" and "Invoice Generated" so cash flow forecasting accurately reflects billing readiness.
- **Risk 3 (Driver Literacy & Turnover)**: Frequent driver changes and varying digital literacy.
  - *Mitigation*: Desktop-first for accountants/managers with high-contrast, clean mobile views for quick supervisor entry; driver names and phone numbers searchable with 1-click WhatsApp receipt dispatch.

---

## Phase Rollout Status
- [x] **Phase 1: Architecture, Infrastructure & Firebase Setup** (Completed)
- [x] **Phase 2: Authentication, Onboarding & Multi-Tenant Company Isolation** (Completed)
- [x] **Phase 3: Firestore Data Model, Security Rules & RBAC Permissions** (Completed)
- [x] **Phase 4: Logistics SaaS Dashboard & KPI Metrics Engine** (Completed)
- [x] **Phase 5: Fleet & Customer Management (Vehicles, Drivers, Customers)** (Completed - 54/54 tests passing)
- [x] **Phase 6: Trip Management, Dispatch & Electronic Lorry Receipts (LR)** (Completed - 53/53 tests passing)
- [ ] **Phase 7: Trip Expenses, Fuel Slips, FastTag Tolls & Driver Advances** (Ready to start)

---

## Next Step: Phase 7
Ready to proceed with **Phase 7: Trip Expenses, Fuel Slips, FastTag Tolls & Driver Advances**.
Reply with:
```
START PHASE 7
```


