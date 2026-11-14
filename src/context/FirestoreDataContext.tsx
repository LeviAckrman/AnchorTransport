/**
 * AnchorTransport TMS - Authoritative Firestore Operational Data Context
 * Subscribes to real-time Firestore onSnapshot listeners for the active company,
 * guarantees synchronous listener unsubscription and state cleanup on logout,
 * and exposes live records + computed metrics to all frontend modules.
 */

import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from './AuthContext';
import {
  subscribeToCompanyOperationalData,
  type FirestoreCompanyMember,
} from '../lib/firebase/firestoreService';
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
  CompanyDashboardMetrics,
} from '../types/tms';
import { computeDashboardMetrics } from '../lib/tmsCalculations';
import { EMPTY_COMPANY } from '../lib/storage';

interface FirestoreDataContextType {
  company: Company;
  members: FirestoreCompanyMember[];
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
  auditLogs: AuditLog[];
  metrics: CompanyDashboardMetrics;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

const FirestoreDataContext = createContext<FirestoreDataContextType | undefined>(undefined);

export const FirestoreDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    company: authCompany,
    role,
    isAuthenticated,
    isFirebaseUser,
    needsOnboarding,
    onboardingCompleted,
    registerLogoutCleanup,
  } = useAuth();

  const [liveCompany, setLiveCompany] = useState<Company | null>(null);
  const [members, setMembers] = useState<FirestoreCompanyMember[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [expenses, setExpenses] = useState<TripExpense[]>([]);
  const [advances, setAdvances] = useState<DriverAdvance[]>([]);
  const [settlements, setSettlements] = useState<TripSettlement[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [documents, setDocuments] = useState<VehicleDocument[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const unsubscribeRef = useRef<(() => void) | null>(null);

  const clearFrontendOperationalState = () => {
    setLiveCompany(null);
    setMembers([]);
    setVehicles([]);
    setDrivers([]);
    setCustomers([]);
    setTrips([]);
    setExpenses([]);
    setAdvances([]);
    setSettlements([]);
    setInvoices([]);
    setPayments([]);
    setDocuments([]);
    setMaintenance([]);
    setAuditLogs([]);
    setError(null);
    setLoading(false);
  };

  // Register synchronous listener cleanup BEFORE Firebase signOut executes
  useEffect(() => {
    const unregister = registerLogoutCleanup(() => {
      if (unsubscribeRef.current) {
        try {
          unsubscribeRef.current();
        } catch {
          // Ignore unsubscribe errors
        }
        unsubscribeRef.current = null;
      }
      clearFrontendOperationalState();
    });
    return unregister;
  }, [registerLogoutCleanup]);

  // Manage live Firestore subscriptions tied strictly to authenticated UID & company membership
  useEffect(() => {
    // Tear down any previous company subscription before switching/exiting
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    const canSubscribe =
      isAuthenticated &&
      isFirebaseUser &&
      Boolean(authCompany?.id) &&
      (!needsOnboarding || onboardingCompleted);

    if (!canSubscribe || !authCompany?.id) {
      clearFrontendOperationalState();
      return;
    }

    setLoading(true);
    setError(null);

    const unsub = subscribeToCompanyOperationalData(
      authCompany.id,
      role,
      {
        onCompany: (c) => setLiveCompany(c),
        onMembers: (m) => setMembers(m),
        onVehicles: (items) => setVehicles(items),
        onDrivers: (items) => setDrivers(items),
        onCustomers: (items) => setCustomers(items),
        onTrips: (items) => setTrips(items),
        onExpenses: (items) => setExpenses(items),
        onAdvances: (items) => setAdvances(items),
        onSettlements: (items) => setSettlements(items),
        onInvoices: (items) => setInvoices(items),
        onPayments: (items) => setPayments(items),
        onDocuments: (items) => setDocuments(items),
        onMaintenance: (items) => setMaintenance(items),
        onAuditLogs: (items) => setAuditLogs(items),
        onInitialLoadComplete: () => setLoading(false),
      },
      (err) => {
        setError(err.message || 'Failed to synchronize company data from Firestore.');
        setLoading(false);
      }
    );

    unsubscribeRef.current = unsub;

    return () => {
      unsub();
      if (unsubscribeRef.current === unsub) {
        unsubscribeRef.current = null;
      }
    };
  }, [isAuthenticated, isFirebaseUser, authCompany?.id, role, needsOnboarding, onboardingCompleted]);

  const activeCompany = liveCompany || authCompany || EMPTY_COMPANY;

  const metrics = useMemo(
    () =>
      computeDashboardMetrics({
        trips,
        vehicles,
        expenses,
        invoices,
        documents,
        period: 'all',
      }),
    [trips, vehicles, expenses, invoices, documents]
  );

  return (
    <FirestoreDataContext.Provider
      value={{
        company: activeCompany,
        members,
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
        auditLogs,
        metrics,
        loading,
        error,
        clearError: () => setError(null),
      }}
    >
      {children}
    </FirestoreDataContext.Provider>
  );
};

export const useFirestoreData = () => {
  const ctx = useContext(FirestoreDataContext);
  if (!ctx) {
    throw new Error('useFirestoreData must be used within a FirestoreDataProvider');
  }
  return ctx;
};
