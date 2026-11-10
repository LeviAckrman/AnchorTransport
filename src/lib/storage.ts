/**
 * AnchorTransport TMS - Client State Store & Storage Persistence
 * Provides realistic in-browser data persistence with transactional mutations.
 */

import {
  Company,
  CompanyUser,
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
  AuditLog,
  UserRole
} from '../types/tms';
import { safeJsonParse } from './safeFetch';
import {
  INITIAL_COMPANY,
  INITIAL_COMPANY_USERS,
  INITIAL_VEHICLES,
  INITIAL_DRIVERS,
  INITIAL_CUSTOMERS,
  INITIAL_TRIPS,
  INITIAL_EXPENSES,
  INITIAL_ADVANCES,
  INITIAL_SETTLEMENTS,
  INITIAL_INVOICES,
  INITIAL_PAYMENTS,
  INITIAL_DOCUMENTS
} from './mockData';

const STORAGE_KEY = 'anchortransport_tms_store_v1';
const LEGACY_STORAGE_KEY = 'fleetgati_tms_store_v1';

export interface TmsStore {
  company: Company;
  companyUsers: CompanyUser[];
  currentRole: UserRole;
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
  auditLogs: AuditLog[];
}

export function getInitialStore(): TmsStore {
  return {
    company: INITIAL_COMPANY,
    companyUsers: INITIAL_COMPANY_USERS,
    currentRole: 'OWNER',
    vehicles: [],
    drivers: INITIAL_DRIVERS,
    customers: [],
    trips: INITIAL_TRIPS,
    expenses: INITIAL_EXPENSES,
    advances: INITIAL_ADVANCES,
    settlements: INITIAL_SETTLEMENTS,
    invoices: INITIAL_INVOICES,
    payments: INITIAL_PAYMENTS,
    documents: [],
    auditLogs: [],
  };
}

export function loadStore(): TmsStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw || typeof raw !== 'string' || !raw.trim() || raw === 'undefined' || raw === 'null') {
      const initial = getInitialStore();
      saveStore(initial);
      return initial;
    }
    const parsed = safeJsonParse<TmsStore>(raw);
    if (!parsed || typeof parsed !== 'object') {
      const initial = getInitialStore();
      saveStore(initial);
      return initial;
    }

    // Purge default mock customers from storage so customers only appear after user adds them
    if (Array.isArray(parsed.customers)) {
      parsed.customers = parsed.customers.filter(
        (c) =>
          c.id !== 'cust_01' &&
          c.id !== 'cust_02' &&
          c.id !== 'cust_03' &&
          c.name !== 'Shyam Steel Industries Ltd.' &&
          c.name !== 'Emami Paper Mills Ltd.' &&
          c.name !== 'Haldia Petrochemicals Ltd.'
      );
    } else {
      parsed.customers = [];
    }

    // Purge default mock vehicles from storage so trucks only appear after user adds them
    if (Array.isArray(parsed.vehicles)) {
      parsed.vehicles = parsed.vehicles.filter(
        (v) =>
          v.id !== 'veh_01' &&
          v.id !== 'veh_02' &&
          v.id !== 'veh_03' &&
          v.id !== 'veh_04' &&
          v.id !== 'veh_05' &&
          v.registrationNumber !== 'WB-19-K-4821' &&
          v.registrationNumber !== 'WB-29-B-7104' &&
          v.registrationNumber !== 'WB-11-D-9033' &&
          v.registrationNumber !== 'WB-23-C-1980' &&
          v.registrationNumber !== 'WB-02-Z-5510'
      );
    } else {
      parsed.vehicles = [];
    }

    // Purge default mock documents from storage
    if (Array.isArray(parsed.documents)) {
      parsed.documents = parsed.documents.filter(
        (d) =>
          d.id !== 'doc_01' &&
          d.id !== 'doc_02' &&
          d.id !== 'doc_03' &&
          d.id !== 'doc_04' &&
          d.id !== 'doc_05' &&
          d.vehicleReg !== 'WB-19-K-4821' &&
          d.vehicleReg !== 'WB-29-B-7104' &&
          d.vehicleReg !== 'WB-11-D-9033' &&
          d.vehicleReg !== 'WB-23-C-1980' &&
          d.vehicleReg !== 'WB-02-Z-5510'
      );
    } else {
      parsed.documents = [];
    }

    return parsed;
  } catch (err) {
    console.error('Failed to load AnchorTransport store from localStorage, resetting:', err);
    return getInitialStore();
  }
}

export function saveStore(store: TmsStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    console.error('Failed to persist AnchorTransport store:', err);
  }
}

export function resetStore(): TmsStore {
  const initial = getInitialStore();
  saveStore(initial);
  return initial;
}

/**
 * Resets all operational records (vehicles, trips, drivers, invoices, expenses)
 * to an empty clean slate for real new customers onboarding.
 */
export function clearStoreForNewCustomer(): TmsStore {
  const store = loadStore();
  const cleanStore: TmsStore = {
    ...store,
    vehicles: [],
    drivers: [],
    customers: [],
    trips: [],
    expenses: [],
    advances: [],
    settlements: [],
    invoices: [],
    payments: [],
    documents: [],
    auditLogs: [],
  };
  saveStore(cleanStore);
  return cleanStore;
}
