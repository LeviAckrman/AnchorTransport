/**
 * AnchorTransport TMS - Client Firestore Service Layer (Phase 3)
 * Standardized data access patterns with ABAC tenant security and error handling.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  DocumentData,
  QueryConstraint
} from 'firebase/firestore';
import { db, auth } from './client';
import { FirestorePaths } from '../../types/firestore';
import type {
  FirestoreCompany,
  FirestoreCompanyMember,
  FirestoreVehicle,
  FirestoreDriver,
  FirestoreCustomer,
  FirestoreTrip,
  FirestoreTripExpense,
  FirestoreDriverAdvance,
  FirestoreTripSettlement,
  FirestoreInvoice,
  FirestorePayment,
  FirestoreVehicleDocument,
  FirestoreMaintenanceRecord,
  FirestoreAuditLog
} from '../../types/firestore';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('[Firestore Error]:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export class FirestoreTMSClient {
  private companyId: string;

  constructor(companyId: string) {
    if (!companyId) throw new Error('Company ID is required to instantiate FirestoreTMSClient');
    this.companyId = companyId;
  }

  // Vehicles
  async getVehicles(): Promise<FirestoreVehicle[]> {
    const path = FirestorePaths.vehicles(this.companyId);
    try {
      const snap = await getDocs(collection(db, path));
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as FirestoreVehicle));
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, path);
    }
  }

  async saveVehicle(vehicle: FirestoreVehicle): Promise<void> {
    const path = FirestorePaths.vehicle(this.companyId, vehicle.id);
    try {
      await setDoc(doc(db, path), { ...vehicle, companyId: this.companyId });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, path);
    }
  }

  // Drivers
  async getDrivers(): Promise<FirestoreDriver[]> {
    const path = FirestorePaths.drivers(this.companyId);
    try {
      const snap = await getDocs(collection(db, path));
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as FirestoreDriver));
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, path);
    }
  }

  async saveDriver(driver: FirestoreDriver): Promise<void> {
    const path = FirestorePaths.driver(this.companyId, driver.id);
    try {
      await setDoc(doc(db, path), { ...driver, companyId: this.companyId });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, path);
    }
  }

  // Customers
  async getCustomers(): Promise<FirestoreCustomer[]> {
    const path = FirestorePaths.customers(this.companyId);
    try {
      const snap = await getDocs(collection(db, path));
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as FirestoreCustomer));
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, path);
    }
  }

  async saveCustomer(customer: FirestoreCustomer): Promise<void> {
    const path = FirestorePaths.customer(this.companyId, customer.id);
    try {
      await setDoc(doc(db, path), { ...customer, companyId: this.companyId });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, path);
    }
  }

  // Trips
  async getTrips(statusFilter?: string): Promise<FirestoreTrip[]> {
    const path = FirestorePaths.trips(this.companyId);
    try {
      const constraints: QueryConstraint[] = [];
      if (statusFilter) {
        constraints.push(where('status', '==', statusFilter));
      }
      constraints.push(orderBy('startDate', 'desc'));
      const q = query(collection(db, path), ...constraints);
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as FirestoreTrip));
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, path);
    }
  }

  async saveTrip(trip: FirestoreTrip): Promise<void> {
    const path = FirestorePaths.trip(this.companyId, trip.id);
    try {
      await setDoc(doc(db, path), { ...trip, companyId: this.companyId });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, path);
    }
  }

  // Invoices
  async getInvoices(): Promise<FirestoreInvoice[]> {
    const path = FirestorePaths.invoices(this.companyId);
    try {
      const q = query(collection(db, path), orderBy('invoiceDate', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as FirestoreInvoice));
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, path);
    }
  }

  async saveInvoice(invoice: FirestoreInvoice): Promise<void> {
    const path = FirestorePaths.invoice(this.companyId, invoice.id);
    try {
      await setDoc(doc(db, path), { ...invoice, companyId: this.companyId });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, path);
    }
  }

  // Vehicle Documents
  async getDocuments(vehicleId?: string): Promise<FirestoreVehicleDocument[]> {
    const path = FirestorePaths.documents(this.companyId);
    try {
      const constraints: QueryConstraint[] = [];
      if (vehicleId) {
        constraints.push(where('vehicleId', '==', vehicleId));
      }
      constraints.push(orderBy('expiryDate', 'asc'));
      const q = query(collection(db, path), ...constraints);
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as FirestoreVehicleDocument));
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, path);
    }
  }

  // Audit Logs
  async createAuditLog(log: Omit<FirestoreAuditLog, 'companyId'>): Promise<void> {
    const path = FirestorePaths.auditLog(this.companyId, log.id);
    try {
      await setDoc(doc(db, path), { ...log, companyId: this.companyId });
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, path);
    }
  }
}
