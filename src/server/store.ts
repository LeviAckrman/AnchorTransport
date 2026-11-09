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
  public trips: Trip[] = [...INITIAL_TRIPS];
  public vehicles: Vehicle[] = [...INITIAL_VEHICLES];
  public drivers: Driver[] = [...INITIAL_DRIVERS];
  public customers: Customer[] = [...INITIAL_CUSTOMERS];
  public expenses: TripExpense[] = [...INITIAL_EXPENSES];
  public advances: DriverAdvance[] = [...INITIAL_ADVANCES];
  public settlements: TripSettlement[] = [...INITIAL_SETTLEMENTS];
  public invoices: Invoice[] = [...INITIAL_INVOICES];
  public payments: Payment[] = [...INITIAL_PAYMENTS];
  public documents: VehicleDocument[] = [...INITIAL_DOCUMENTS];

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
