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

function getInitialStore(): TmsStore {
  return {
    company: INITIAL_COMPANY,
    companyUsers: INITIAL_COMPANY_USERS,
    currentRole: 'OWNER',
    vehicles: INITIAL_VEHICLES,
    drivers: INITIAL_DRIVERS,
    customers: INITIAL_CUSTOMERS,
    trips: INITIAL_TRIPS,
    expenses: INITIAL_EXPENSES,
    advances: INITIAL_ADVANCES,
    settlements: INITIAL_SETTLEMENTS,
    invoices: INITIAL_INVOICES,
    payments: INITIAL_PAYMENTS,
    documents: INITIAL_DOCUMENTS,
    auditLogs: [
      {
        id: 'log_01',
        companyId: INITIAL_COMPANY.id,
        userId: 'usr_owner_01',
        userName: 'Anupam Ghosh',
        action: 'DISPATCH',
        entityType: 'TRIP',
        entityId: 'trip_01',
        summary: 'Dispatched trip TR-2026-0038 (Durgapur to Siliguri) on WB-19-K-4821',
        timestamp: '2026-11-01T08:30:00Z',
      },
    ],
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
