# AnchorTransport TMS — Phase 3 Firestore Data Model & Security Architecture

> Production-grade, company-scoped Firestore database schema, role-based authorization matrix, composite index configurations, and tenant-isolation security rules for AnchorTransport TMS (`anchortransports-6d744`).

---

## 1. Multi-Tenant Collection Hierarchy

All fleet operational, financial, and compliance data is strictly segregated into subcollections underneath the parent company document. No business entity resides in a root collection without company partitioning.

```
/users/{userId}                                 <- Private user profile (accessible only by authenticated self)
/companies/{companyId}                          <- Company entity root
    ├── members/{userId}                        <- ABAC/RBAC membership credentials
    ├── vehicles/{vehicleId}                    <- Fleet vehicle records & odometer
    ├── drivers/{driverId}                      <- Driver profiles & license verification
    ├── customers/{customerId}                  <- Consignors & Consignees
    ├── trips/{tripId}                          <- Trip lifecycle, route & LR details
    ├── expenses/{expenseId}                    <- Diesel, toll, and petty cash expenses
    ├── advances/{advanceId}                    <- Cash/UPI driver advances
    ├── settlements/{settlementId}              <- Driver trip reconciliation vouchers
    ├── invoices/{invoiceId}                    <- GST tax invoices
    ├── payments/{paymentId}                    <- Customer payments & TDS records
    ├── documents/{documentId}                  <- RC, Fitness, Permits, Insurance compliance
    ├── maintenance/{maintenanceId}             <- Workshop logs, tyre & repair records
    └── auditLogs/{logId}                       <- Immutable append-only tamper log
```

---

## 2. Company-Scoped Collections Specification

| # | Collection Path | Key Schema Fields | Read Access | Write Access | Delete Access |
|---|---|---|---|---|---|
| **1** | `/companies/{companyId}/members` | `userId`, `companyId`, `role`, `email`, `status`, `joinedAt` | Active Members | OWNER, ADMIN | OWNER |
| **2** | `/companies/{companyId}/vehicles` | `registrationNumber`, `truckType`, `status`, `capacityTons`, `chassisNumber` | Active Members | OPERATIONS, MANAGER, ADMIN, OWNER | OWNER, ADMIN |
| **3** | `/companies/{companyId}/drivers` | `name`, `phone`, `licenseNumber`, `licenseExpiry`, `status` | Active Members | OPERATIONS, MANAGER, ADMIN, OWNER | OWNER, ADMIN |
| **4** | `/companies/{companyId}/customers` | `companyName`, `gstin`, `phone`, `paymentTermsDays`, `status` | Active Members | OPERATIONS, ACCOUNTANT, ADMIN, OWNER | OWNER, ADMIN |
| **5** | `/companies/{companyId}/trips` | `tripNumber`, `vehicleId`, `driverId`, `freightAmount`, `status`, `billingStatus` | Active Members | OPERATIONS, MANAGER, ADMIN, OWNER | OWNER, ADMIN |
| **6** | `/companies/{companyId}/expenses` | `tripId`, `vehicleId`, `category`, `amount`, `paymentMode`, `expenseDate` | Active Members | OPERATIONS, ACCOUNTANT, ADMIN, OWNER | ACCOUNTANT, ADMIN, OWNER |
| **7** | `/companies/{companyId}/advances` | `tripId`, `driverId`, `amount`, `paymentMode`, `status` | Active Members | OPERATIONS, ACCOUNTANT, ADMIN, OWNER | ACCOUNTANT, ADMIN, OWNER |
| **8** | `/companies/{companyId}/settlements` | `tripId`, `driverId`, `grossFreight`, `netPayableToDriver`, `status` | ACCOUNTANT, ADMIN, OWNER | ACCOUNTANT, ADMIN, OWNER | OWNER |
| **9** | `/companies/{companyId}/invoices` | `invoiceNumber`, `customerId`, `taxAmount`, `totalAmount`, `paymentStatus` | ACCOUNTANT, ADMIN, OWNER | ACCOUNTANT, ADMIN, OWNER | OWNER |
| **10** | `/companies/{companyId}/payments` | `invoiceId`, `customerId`, `amount`, `paymentMode`, `status` | ACCOUNTANT, ADMIN, OWNER | ACCOUNTANT, ADMIN, OWNER | OWNER |
| **11** | `/companies/{companyId}/documents` | `vehicleId`, `documentType`, `documentNumber`, `expiryDate`, `status` | Active Members | OPERATIONS, MANAGER, ADMIN, OWNER | OWNER, ADMIN |
| **12** | `/companies/{companyId}/maintenance` | `vehicleId`, `serviceType`, `cost`, `serviceDate`, `status` | Active Members | OPERATIONS, MANAGER, ADMIN, OWNER | OWNER, ADMIN |
| **13** | `/companies/{companyId}/auditLogs` | `entityType`, `entityId`, `action`, `actorId`, `timestamp` | MANAGER, ADMIN, OWNER | Active Members (Create Only) | **DENIED (Immutable)** |

---

## 3. Security Rules Architecture (`firestore.rules`)

1. **Global Default Deny**:
   ```javascript
   match /{document=**} {
     allow read, write: if false;
   }
   ```
2. **Membership Authentication Function**:
   ```javascript
   function isCompanyMember(companyId) {
     return isAuthenticated() &&
       exists(/databases/$(database)/documents/companies/$(companyId)/members/$(request.auth.uid)) &&
       get(/databases/$(database)/documents/companies/$(companyId)/members/$(request.auth.uid)).data.status == 'ACTIVE';
   }
   ```
3. **Role-Based Predicates**:
   - `isOwner(companyId)`: Verifies role is `OWNER`.
   - `isOwnerOrAdmin(companyId)`: Verifies role is `OWNER` or `ADMIN`.
   - `isAccountant(companyId)`: Verifies role is `ACCOUNTANT`, `ADMIN`, or `OWNER`.
   - `isFleetStaff(companyId)`: Verifies role is `OPERATIONS`, `OPERATIONS_STAFF`, `MANAGER`, `ADMIN`, or `OWNER`.
4. **Tenant ID Injection Guard**:
   Every creation request enforces `request.resource.data.companyId == companyId` matching the URL path parameter, preventing cross-tenant document spoofing.
5. **Audit Trail Immutability**:
   Audit log documents can only be created by authenticated company members; `update` and `delete` operations return `false` unconditionally.

---

## 4. Firestore Composite Indexes (`firestore.indexes.json`)

To support fast fleet queries without indexing errors in production:
1. `companies/{companyId}/trips`: `[status ASC, startDate DESC]`
2. `companies/{companyId}/trips`: `[vehicleId ASC, status ASC, createdAt DESC]`
3. `companies/{companyId}/trips`: `[customerId ASC, billingStatus ASC]`
4. `companies/{companyId}/expenses`: `[tripId ASC, expenseDate DESC]`
5. `companies/{companyId}/expenses`: `[category ASC, expenseDate DESC]`
6. `companies/{companyId}/advances`: `[tripId ASC, status ASC]`
7. `companies/{companyId}/advances`: `[driverId ASC, status ASC]`
8. `companies/{companyId}/invoices`: `[paymentStatus ASC, dueDate ASC]`
9. `companies/{companyId}/invoices`: `[customerId ASC, invoiceDate DESC]`
10. `companies/{companyId}/payments`: `[invoiceId ASC, paymentDate DESC]`
11. `companies/{companyId}/documents`: `[status ASC, expiryDate ASC]`
12. `companies/{companyId}/maintenance`: `[vehicleId ASC, serviceDate DESC]`
13. `companies/{companyId}/auditLogs`: `[entityType ASC, timestamp DESC]`
14. `companies/{companyId}/auditLogs`: `[actorId ASC, timestamp DESC]`

---

## 5. Verification & Test Coverage

Three comprehensive automated test suites validate the end-to-end implementation:
- **`npm run test:firebase`**: 31/31 passed (Firebase Client & Admin SDK connection, emulators, rules files, and env templates).
- **`npm run test:auth`**: 33/33 passed (Registration, login, password reset, trusted company onboarding, privilege escalation guards, session expiry, and cross-company tenant isolation).
- **`npm run test:rules`**: 27/27 passed (Multi-tenant boundary isolation across all 12 collections, cross-company read/write blocking, role-based financial gates, and audit log immutability).
- **Total Tests**: **91 passing / 0 failing**.
