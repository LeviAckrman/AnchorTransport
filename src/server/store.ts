/**
 * AnchorTransport TMS - Server-side Multi-Tenant Fleet Data Store
 * In-memory transactional store with company isolation, date-range filtering,
 * and optional Firestore synchronization.
 */

import {
  Trip,
  Vehicle,
  Driver,
  Customer,
  TripExpense,
  Invoice,
  VehicleDocument,
  DriverAdvance,
  TripSettlement,
  Payment,
} from '../types/tms';
import { adminDb } from '../lib/firebase/admin';
import {
  INITIAL_COMPANY,
  INITIAL_VEHICLES,
  INITIAL_DRIVERS,
  INITIAL_CUSTOMERS,
  INITIAL_TRIPS,
  INITIAL_EXPENSES,
  INITIAL_ADVANCES,
  INITIAL_SETTLEMENTS,
  INITIAL_INVOICES,
  INITIAL_PAYMENTS,
  INITIAL_DOCUMENTS,
} from '../lib/mockData';

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

class ServerFleetStore {
  public trips: Trip[] = [];
  public vehicles: Vehicle[] = [];
  public drivers: Driver[] = [];
  public customers: Customer[] = [];
  public expenses: TripExpense[] = [];
  public advances: DriverAdvance[] = [];
  public settlements: TripSettlement[] = [];
  public invoices: Invoice[] = [];
  public payments: Payment[] = [];
  public documents: VehicleDocument[] = [];

  private hydratedCompanies: Set<string> = new Set();

  /**
   * Hydrates company records from Firestore on-demand.
   * If Firestore has no records for this company, the store remains empty.
   */
  async hydrateFromFirestore(companyId: string, force = false): Promise<void> {
    if (!adminDb) return;
    if (this.hydratedCompanies.has(companyId) && !force) return;

    try {
      const companyRef = adminDb.collection('companies').doc(companyId);
      const [
        vehSnap,
        drvSnap,
        custSnap,
        tripSnap,
        docSnap,
        expSnap,
        advSnap,
        stlSnap,
        invSnap,
        paySnap,
      ] = await Promise.all([
        companyRef.collection('vehicles').get().catch(() => null),
        companyRef.collection('drivers').get().catch(() => null),
        companyRef.collection('customers').get().catch(() => null),
        companyRef.collection('trips').get().catch(() => null),
        companyRef.collection('documents').get().catch(() => null),
        companyRef.collection('expenses').get().catch(() => null),
        companyRef.collection('advances').get().catch(() => null),
        companyRef.collection('settlements').get().catch(() => null),
        companyRef.collection('invoices').get().catch(() => null),
        companyRef.collection('payments').get().catch(() => null),
      ]);

      if (vehSnap && !vehSnap.empty) {
        const items = vehSnap.docs.map((d) => d.data() as Vehicle);
        this.vehicles = this.vehicles.filter((v) => v.companyId !== companyId).concat(items);
      }
      if (drvSnap && !drvSnap.empty) {
        const items = drvSnap.docs.map((d) => d.data() as Driver);
        this.drivers = this.drivers.filter((d) => d.companyId !== companyId).concat(items);
      }
      if (custSnap && !custSnap.empty) {
        const items = custSnap.docs.map((d) => d.data() as Customer);
        this.customers = this.customers.filter((c) => c.companyId !== companyId).concat(items);
      }
      if (tripSnap && !tripSnap.empty) {
        const items = tripSnap.docs.map((d) => d.data() as Trip);
        this.trips = this.trips.filter((t) => t.companyId !== companyId).concat(items);
      }
      if (docSnap && !docSnap.empty) {
        const items = docSnap.docs.map((d) => d.data() as VehicleDocument);
        this.documents = this.documents.filter((d) => d.companyId !== companyId).concat(items);
      }
      if (expSnap && !expSnap.empty) {
        const items = expSnap.docs.map((d) => d.data() as TripExpense);
        this.expenses = this.expenses.filter((e) => e.companyId !== companyId).concat(items);
      }
      if (advSnap && !advSnap.empty) {
        const items = advSnap.docs.map((d) => d.data() as DriverAdvance);
        this.advances = this.advances.filter((a) => a.companyId !== companyId).concat(items);
      }
      if (stlSnap && !stlSnap.empty) {
        const items = stlSnap.docs.map((d) => d.data() as TripSettlement);
        this.settlements = this.settlements.filter((s) => s.companyId !== companyId).concat(items);
      }
      if (invSnap && !invSnap.empty) {
        const items = invSnap.docs.map((d) => d.data() as Invoice);
        this.invoices = this.invoices.filter((i) => i.companyId !== companyId).concat(items);
      }
      if (paySnap && !paySnap.empty) {
        const items = paySnap.docs.map((d) => d.data() as Payment);
        this.payments = this.payments.filter((p) => p.companyId !== companyId).concat(items);
      }

      this.hydratedCompanies.add(companyId);
    } catch (err) {
      console.warn('Hydration from Firestore note:', err);
    }
  }

  /**
   * Hydrates company records from a client-fetched Firestore bundle
   * (Used when browser Firestore SDK has authenticated user access and server lacks GCP SA credentials)
   */
  hydrateFromClientBundle(
    companyId: string,
    bundle: Partial<{
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
    }>
  ): { [key: string]: number } {
    const scopeList = <T extends { companyId?: string }>(arr?: T[]): T[] =>
      Array.isArray(arr) ? arr.map((item) => ({ ...item, companyId })) : [];

    if (Array.isArray(bundle.vehicles)) {
      this.vehicles = this.vehicles.filter((v) => v.companyId !== companyId).concat(scopeList(bundle.vehicles));
    }
    if (Array.isArray(bundle.drivers)) {
      this.drivers = this.drivers.filter((d) => d.companyId !== companyId).concat(scopeList(bundle.drivers));
    }
    if (Array.isArray(bundle.customers)) {
      this.customers = this.customers.filter((c) => c.companyId !== companyId).concat(scopeList(bundle.customers));
    }
    if (Array.isArray(bundle.trips)) {
      this.trips = this.trips.filter((t) => t.companyId !== companyId).concat(scopeList(bundle.trips));
    }
    if (Array.isArray(bundle.expenses)) {
      this.expenses = this.expenses.filter((e) => e.companyId !== companyId).concat(scopeList(bundle.expenses));
    }
    if (Array.isArray(bundle.advances)) {
      this.advances = this.advances.filter((a) => a.companyId !== companyId).concat(scopeList(bundle.advances));
    }
    if (Array.isArray(bundle.settlements)) {
      this.settlements = this.settlements.filter((s) => s.companyId !== companyId).concat(scopeList(bundle.settlements));
    }
    if (Array.isArray(bundle.invoices)) {
      this.invoices = this.invoices.filter((i) => i.companyId !== companyId).concat(scopeList(bundle.invoices));
    }
    if (Array.isArray(bundle.payments)) {
      this.payments = this.payments.filter((p) => p.companyId !== companyId).concat(scopeList(bundle.payments));
    }
    if (Array.isArray(bundle.documents)) {
      this.documents = this.documents.filter((d) => d.companyId !== companyId).concat(scopeList(bundle.documents));
    }

    this.hydratedCompanies.add(companyId);

    return {
      vehicles: this.vehicles.filter((v) => v.companyId === companyId).length,
      drivers: this.drivers.filter((d) => d.companyId === companyId).length,
      customers: this.customers.filter((c) => c.companyId === companyId).length,
      trips: this.trips.filter((t) => t.companyId === companyId).length,
      expenses: this.expenses.filter((e) => e.companyId === companyId).length,
      advances: this.advances.filter((a) => a.companyId === companyId).length,
      settlements: this.settlements.filter((s) => s.companyId === companyId).length,
      invoices: this.invoices.filter((i) => i.companyId === companyId).length,
      payments: this.payments.filter((p) => p.companyId === companyId).length,
      documents: this.documents.filter((d) => d.companyId === companyId).length,
    };
  }

  /**
   * Persist a user entity mutation into Firestore
   */
  async persistToFirestore(companyId: string, subcollection: string, docId: string, data: any): Promise<void> {
    if (!adminDb) return;
    try {
      await adminDb
        .collection('companies')
        .doc(companyId)
        .collection(subcollection)
        .doc(docId)
        .set(data, { merge: true });
    } catch (err) {
      console.warn(`Firestore save error (${subcollection}/${docId}):`, err);
    }
  }

  /**
   * Delete an entity from Firestore
   */
  async deleteFromFirestore(companyId: string, subcollection: string, docId: string): Promise<void> {
    if (!adminDb) return;
    try {
      await adminDb
        .collection('companies')
        .doc(companyId)
        .collection(subcollection)
        .doc(docId)
        .delete();
    } catch (err) {
      console.warn(`Firestore delete error (${subcollection}/${docId}):`, err);
    }
  }

  /**
   * Calculate company-scoped metrics with optional date range filter
   */
  getDashboardMetrics(
    companyId: string,
    period: 'all' | 'today' | 'week' | 'month' | 'quarter' | 'custom' = 'all',
    customStart?: string,
    customEnd?: string
  ): CompanyDashboardMetrics {
    // 1. Filter strictly by company
    const companyTrips = this.trips.filter((t) => t.companyId === companyId);
    const companyVehicles = this.vehicles.filter((v) => v.companyId === companyId);
    const companyExpenses = this.expenses.filter((e) => e.companyId === companyId);
    const companyInvoices = this.invoices.filter((i) => i.companyId === companyId);
    const companyDocs = this.documents.filter((d) => d.companyId === companyId);

    // 2. Compute date bounds
    const now = new Date();
    let startDate: Date | null = null;
    let endDate: Date | null = null;

    if (period === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    } else if (period === 'week') {
      const dayOfWeek = now.getDay();
      const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Monday
      startDate = new Date(now.setDate(diff));
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date();
      endDate.setHours(23, 59, 59, 999);
    } else if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else if (period === 'quarter') {
      const quarter = Math.floor(now.getMonth() / 3);
      startDate = new Date(now.getFullYear(), quarter * 3, 1, 0, 0, 0);
      endDate = new Date(now.getFullYear(), quarter * 3 + 3, 0, 23, 59, 59);
    } else if (period === 'custom' && customStart) {
      startDate = new Date(customStart);
      startDate.setHours(0, 0, 0, 0);
      endDate = customEnd ? new Date(customEnd) : new Date();
      endDate.setHours(23, 59, 59, 999);
    }

    // 3. Filter trips by date if required
    const filteredTrips = companyTrips.filter((t) => {
      if (!startDate) return true;
      const tripDate = new Date(t.dispatchDate || t.createdAt);
      if (endDate) {
        return tripDate >= startDate && tripDate <= endDate;
      }
      return tripDate >= startDate;
    });

    // 4. Filter expenses by date
    const filteredExpenses = companyExpenses.filter((e) => {
      if (!startDate) return true;
      const expDate = new Date(e.date || e.expenseDate || e.createdAt || Date.now());
      if (endDate) {
        return expDate >= startDate && expDate <= endDate;
      }
      return expDate >= startDate;
    });

    // 5. Active trips vs Completed trips
    const activeTripsCount = filteredTrips.filter(
      (t) => t.status === 'IN_TRANSIT' || t.status === 'DISPATCHED' || t.status === 'PLANNED'
    ).length;

    const completedTripsCount = filteredTrips.filter(
      (t) => t.status === 'DELIVERED' || t.status === 'SETTLED'
    ).length;

    // 6. Financial metrics
    const totalFreightRevenuePaise = filteredTrips.reduce((acc, t) => acc + (t.totalRevenuePaise || t.freightAmountPaise || 0), 0);
    const totalRecordedExpensesPaise = filteredExpenses.reduce((acc, e) => acc + (e.amountPaise || 0), 0);
    const tripContributionPaise = totalFreightRevenuePaise - totalRecordedExpensesPaise;
    const contributionMarginPercent =
      totalFreightRevenuePaise > 0
        ? Math.round((tripContributionPaise / totalFreightRevenuePaise) * 1000) / 10
        : 0;

    // 7. Outstanding invoices (company-scoped)
    const unpaidInvoices = companyInvoices.filter(
      (i) => i.paymentStatus === 'UNPAID' || i.paymentStatus === 'PARTIALLY_PAID' || i.paymentStatus === 'OVERDUE'
    );
    const outstandingInvoicesPaise = unpaidInvoices.reduce((acc, i) => acc + (i.balanceDuePaise || i.totalAmountPaise || 0), 0);
    const outstandingInvoicesCount = unpaidInvoices.length;

    // 8. Recent trips (sorted descending by date)
    const sortedTrips = [...filteredTrips].sort(
      (a, b) => new Date(b.dispatchDate || b.createdAt).getTime() - new Date(a.dispatchDate || a.createdAt).getTime()
    );
    const recentTrips = sortedTrips.slice(0, 10);

    // 9. Vehicles requiring attention
    const vehiclesRequiringAttention: VehicleAttentionItem[] = [];
    const todayStr = new Date().toISOString().split('T')[0];
    const thirtyDaysAhead = new Date();
    thirtyDaysAhead.setDate(thirtyDaysAhead.getDate() + 30);
    const thirtyDaysAheadStr = thirtyDaysAhead.toISOString().split('T')[0];

    for (const veh of companyVehicles) {
      const issues: VehicleAttentionItem['issues'] = [];

      // Check maintenance status
      if (veh.status === 'UNDER_MAINTENANCE') {
        issues.push({
          type: 'MAINTENANCE',
          severity: 'critical',
          title: 'Vehicle in Garage',
          description: 'Truck currently marked under active mechanical repair.',
        });
      }

      // Check FastTag balance (< ₹1,500 = 150000 paise)
      if (veh.fastagBalancePaise < 150000) {
        issues.push({
          type: 'LOW_FASTAG',
          severity: 'warning',
          title: 'Low FastTag Toll Balance',
          description: `FastTag balance is ₹${(veh.fastagBalancePaise / 100).toFixed(0)} (Min recommended: ₹1,500).`,
        });
      }

      // Check vehicle documents
      const docs = companyDocs.filter((d) => d.vehicleId === veh.id);
      for (const doc of docs) {
        if (doc.status === 'EXPIRED' || doc.expiryDate < todayStr) {
          issues.push({
            type: 'EXPIRED_DOCUMENT',
            severity: 'critical',
            title: `${doc.docType.replace('_', ' ')} Expired`,
            description: `${doc.docType} (#${doc.documentNumber}) expired on ${doc.expiryDate}.`,
            expiryDate: doc.expiryDate,
            daysRemaining: 0,
          });
        } else if (doc.status === 'EXPIRING_SOON' || (doc.expiryDate >= todayStr && doc.expiryDate <= thirtyDaysAheadStr)) {
          const days = Math.ceil((new Date(doc.expiryDate).getTime() - new Date().getTime()) / (1000 * 3600 * 24));
          issues.push({
            type: 'EXPIRING_DOCUMENT',
            severity: 'warning',
            title: `${doc.docType.replace('_', ' ')} Expiring Soon`,
            description: `Renewal required within ${days} days (${doc.expiryDate}).`,
            expiryDate: doc.expiryDate,
            daysRemaining: days,
          });
        }
      }

      if (issues.length > 0) {
        vehiclesRequiringAttention.push({
          vehicleId: veh.id,
          registrationNumber: veh.registrationNumber,
          makeModel: veh.makeModel,
          status: veh.status,
          fastagBalancePaise: veh.fastagBalancePaise,
          issues,
        });
      }
    }

    const hasData = companyTrips.length > 0 || companyVehicles.length > 0;

    return {
      activeTripsCount,
      completedTripsCount,
      totalFreightRevenuePaise,
      totalRecordedExpensesPaise,
      tripContributionPaise,
      contributionMarginPercent,
      outstandingInvoicesPaise,
      outstandingInvoicesCount,
      totalTripsCount: companyTrips.length,
      totalVehiclesCount: companyVehicles.length,
      activeVehiclesCount: companyVehicles.filter((v) => v.status === 'IN_TRANSIT').length,
      recentTrips,
      vehiclesRequiringAttention,
      period: {
        type: period,
        startDate: startDate ? startDate.toISOString() : undefined,
        endDate: endDate ? endDate.toISOString() : undefined,
      },
      hasData,
    };
  }

  /**
   * Seed realistic development records for a given company context
   */
  seedCompanyData(companyId: string): void {
    // Clear any existing
    this.clearCompanyData(companyId);

    // Clone templates with target companyId
    const seededVehicles = INITIAL_VEHICLES.map((v, idx) => ({
      ...v,
      id: `veh_${companyId}_${idx + 1}`,
      companyId,
    }));

    const seededDrivers = INITIAL_DRIVERS.map((d, idx) => ({
      ...d,
      id: `drv_${companyId}_${idx + 1}`,
      companyId,
    }));

    const seededCustomers = INITIAL_CUSTOMERS.map((c, idx) => ({
      ...c,
      id: `cust_${companyId}_${idx + 1}`,
      companyId,
    }));

    const seededTrips = INITIAL_TRIPS.map((t, idx) => ({
      ...t,
      id: `trip_${companyId}_${idx + 1}`,
      companyId,
      vehicleId: seededVehicles[idx % seededVehicles.length].id,
      driverId: seededDrivers[idx % seededDrivers.length].id,
      customerId: seededCustomers[idx % seededCustomers.length].id,
    }));

    const seededExpenses = INITIAL_EXPENSES.map((e, idx) => ({
      ...e,
      id: `exp_${companyId}_${idx + 1}`,
      companyId,
      tripId: seededTrips[idx % seededTrips.length]?.id || `trip_${companyId}_1`,
    }));

    const seededInvoices = INITIAL_INVOICES.map((i, idx) => ({
      ...i,
      id: `inv_${companyId}_${idx + 1}`,
      companyId,
      customerId: seededCustomers[idx % seededCustomers.length].id,
    }));

    const seededDocs = INITIAL_DOCUMENTS.map((d, idx) => ({
      ...d,
      id: `doc_${companyId}_${idx + 1}`,
      companyId,
      vehicleId: seededVehicles[idx % seededVehicles.length].id,
    }));

    this.vehicles.push(...seededVehicles);
    this.drivers.push(...seededDrivers);
    this.customers.push(...seededCustomers);
    this.trips.push(...seededTrips);
    this.expenses.push(...seededExpenses);
    this.invoices.push(...seededInvoices);
    this.documents.push(...seededDocs);
  }

  /**
   * Clear all operational data for a given company (to test empty state)
   */
  clearCompanyData(companyId: string): void {
    this.hydratedCompanies.delete(companyId);
    this.trips = this.trips.filter((t) => t.companyId !== companyId);
    this.expenses = this.expenses.filter((e) => e.companyId !== companyId);
    this.advances = this.advances.filter((a) => a.companyId !== companyId);
    this.settlements = this.settlements.filter((s) => s.companyId !== companyId);
    this.invoices = this.invoices.filter((i) => i.companyId !== companyId);
    this.payments = this.payments.filter((p) => p.companyId !== companyId);
    this.vehicles = this.vehicles.filter((v) => v.companyId !== companyId);
    this.drivers = this.drivers.filter((d) => d.companyId !== companyId);
    this.customers = this.customers.filter((c) => c.companyId !== companyId);
    this.documents = this.documents.filter((d) => d.companyId !== companyId);
  }
}

export const serverFleetStore = new ServerFleetStore();
