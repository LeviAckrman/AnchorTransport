/**
 * AnchorTransport TMS - Client-Side Pure Calculation & Reporting Engine
 * Computes dashboard KPIs, financial reports, compliance status, numbering,
 * and RFC 4180 CSV exports strictly from live Firestore entity collections.
 */

import type {
  Company,
  CompanyDashboardMetrics,
  Customer,
  Driver,
  Invoice,
  MaintenanceRecord,
  Payment,
  Trip,
  TripExpense,
  Vehicle,
  VehicleAttentionItem,
  VehicleDocument,
} from '../types/tms';

export type DatePeriod = 'all' | 'today' | 'week' | 'month' | 'quarter' | 'custom';

export const REPORT_ACCOUNTING_DISCLAIMER =
  'Trip contribution represents gross operational margin (Freight Revenue minus direct trip expenses such as fuel, toll, loading/unloading, and en-route repairs). ' +
  'It does NOT calculate full company net profit, which requires accounting for fixed truck financing EMIs, permit & insurance amortization, tyre depreciation, and corporate overheads.';

export function isDateWithinRange(dateStr?: string, start?: string, end?: string): boolean {
  if (!start && !end) return true;
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;

  if (start) {
    const s = new Date(start);
    s.setHours(0, 0, 0, 0);
    if (d < s) return false;
  }
  if (end) {
    const e = new Date(end);
    e.setHours(23, 59, 59, 999);
    if (d > e) return false;
  }
  return true;
}

export function calculateDocComplianceStatus(expiryDate?: string): {
  daysUntilExpiry: number;
  status: VehicleDocument['status'];
} {
  if (!expiryDate) {
    return { daysUntilExpiry: 0, status: 'EXPIRED' };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiryDate);
  exp.setHours(0, 0, 0, 0);
  const daysUntilExpiry = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 3600 * 24));
  let status: VehicleDocument['status'] = 'VALID';
  if (daysUntilExpiry < 0) status = 'EXPIRED';
  else if (daysUntilExpiry <= 30) status = 'EXPIRING_SOON';
  return { daysUntilExpiry, status };
}

export function isInvoiceUnpaid(inv: Invoice): boolean {
  if (inv.status === 'CANCELLED' || inv.status === 'PAID') return false;
  const due = inv.balanceDuePaise ?? inv.totalAmountPaise ?? 0;
  if (due > 0) return true;
  return (
    inv.paymentStatus === 'UNPAID' ||
    inv.paymentStatus === 'PARTIALLY_PAID' ||
    inv.paymentStatus === 'OVERDUE'
  );
}

export function getExpenseDate(exp: TripExpense): string {
  return exp.date || exp.expenseDate || exp.createdAt || '';
}

export function computeDashboardMetrics(params: {
  trips: Trip[];
  vehicles: Vehicle[];
  expenses: TripExpense[];
  invoices: Invoice[];
  documents: VehicleDocument[];
  period?: DatePeriod;
  customStart?: string;
  customEnd?: string;
}): CompanyDashboardMetrics {
  const {
    trips,
    vehicles,
    expenses,
    invoices,
    documents,
    period = 'all',
    customStart,
    customEnd,
  } = params;

  const now = new Date();
  let startDate: Date | null = null;
  let endDate: Date | null = null;

  if (period === 'today') {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  } else if (period === 'week') {
    const dayOfWeek = now.getDay();
    const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    startDate = new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0, 0);
    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  } else if (period === 'month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  } else if (period === 'quarter') {
    const quarter = Math.floor(now.getMonth() / 3);
    startDate = new Date(now.getFullYear(), quarter * 3, 1, 0, 0, 0, 0);
    endDate = new Date(now.getFullYear(), quarter * 3 + 3, 0, 23, 59, 59, 999);
  } else if (period === 'custom' && customStart) {
    startDate = new Date(customStart);
    startDate.setHours(0, 0, 0, 0);
    endDate = customEnd ? new Date(customEnd) : new Date();
    endDate.setHours(23, 59, 59, 999);
  }

  const filteredTrips = trips.filter((t) => {
    if (!startDate) return true;
    const tripDate = new Date(t.dispatchDate || t.createdAt);
    if (Number.isNaN(tripDate.getTime())) return false;
    return endDate ? tripDate >= startDate && tripDate <= endDate : tripDate >= startDate;
  });

  const filteredExpenses = expenses.filter((e) => {
    if (!startDate) return true;
    const dtStr = getExpenseDate(e);
    if (!dtStr) return false;
    const expDate = new Date(dtStr);
    if (Number.isNaN(expDate.getTime())) return false;
    return endDate ? expDate >= startDate && expDate <= endDate : expDate >= startDate;
  });

  const activeTripsCount = filteredTrips.filter(
    (t) => t.status === 'IN_TRANSIT' || t.status === 'DISPATCHED' || t.status === 'PLANNED'
  ).length;

  const completedTripsCount = filteredTrips.filter(
    (t) => t.status === 'DELIVERED' || t.status === 'COMPLETED' || t.status === 'SETTLED'
  ).length;

  const totalFreightRevenuePaise = filteredTrips
    .filter((t) => t.status !== 'CANCELLED')
    .reduce((acc, t) => acc + (t.totalRevenuePaise || t.freightAmountPaise || 0), 0);

  const totalRecordedExpensesPaise = filteredExpenses.reduce(
    (acc, e) => acc + (e.amountPaise || 0),
    0
  );

  const tripContributionPaise = totalFreightRevenuePaise - totalRecordedExpensesPaise;
  const contributionMarginPercent =
    totalFreightRevenuePaise > 0
      ? Math.round((tripContributionPaise / totalFreightRevenuePaise) * 1000) / 10
      : 0;

  const unpaidInvoices = invoices.filter(isInvoiceUnpaid);
  const outstandingInvoicesPaise = unpaidInvoices.reduce(
    (acc, i) => acc + (i.balanceDuePaise ?? i.totalAmountPaise ?? 0),
    0
  );
  const outstandingInvoicesCount = unpaidInvoices.length;

  const sortedTrips = [...filteredTrips].sort(
    (a, b) =>
      new Date(b.dispatchDate || b.createdAt || 0).getTime() -
      new Date(a.dispatchDate || a.createdAt || 0).getTime()
  );
  const recentTrips = sortedTrips.slice(0, 10);

  const vehiclesRequiringAttention: VehicleAttentionItem[] = [];
  const todayStr = new Date().toISOString().split('T')[0];
  const thirtyDaysAhead = new Date();
  thirtyDaysAhead.setDate(thirtyDaysAhead.getDate() + 30);
  const thirtyDaysAheadStr = thirtyDaysAhead.toISOString().split('T')[0];

  for (const veh of vehicles) {
    const issues: VehicleAttentionItem['issues'] = [];

    if (veh.status === 'UNDER_MAINTENANCE') {
      issues.push({
        type: 'MAINTENANCE',
        severity: 'critical',
        title: 'Vehicle in Garage',
        description: 'Truck currently marked under active mechanical repair.',
      });
    }

    if ((veh.fastagBalancePaise ?? 0) < 150000) {
      issues.push({
        type: 'LOW_FASTAG',
        severity: 'warning',
        title: 'Low FastTag Toll Balance',
        description: `FastTag balance is ₹${((veh.fastagBalancePaise ?? 0) / 100).toFixed(0)} (Min recommended: ₹1,500).`,
      });
    }

    const docs = documents.filter((d) => d.vehicleId === veh.id);
    for (const d of docs) {
      const comp = calculateDocComplianceStatus(d.expiryDate);
      if (comp.status === 'EXPIRED' || d.expiryDate < todayStr) {
        issues.push({
          type: 'EXPIRED_DOCUMENT',
          severity: 'critical',
          title: `${d.docType.replace('_', ' ')} Expired`,
          description: `${d.docType} (#${d.documentNumber}) expired on ${d.expiryDate}.`,
          expiryDate: d.expiryDate,
          daysRemaining: 0,
        });
      } else if (
        comp.status === 'EXPIRING_SOON' ||
        (d.expiryDate >= todayStr && d.expiryDate <= thirtyDaysAheadStr)
      ) {
        issues.push({
          type: 'EXPIRING_DOCUMENT',
          severity: 'warning',
          title: `${d.docType.replace('_', ' ')} Expiring Soon`,
          description: `Renewal required within ${comp.daysUntilExpiry} days (${d.expiryDate}).`,
          expiryDate: d.expiryDate,
          daysRemaining: comp.daysUntilExpiry,
        });
      }
    }

    if (issues.length > 0) {
      vehiclesRequiringAttention.push({
        vehicleId: veh.id,
        registrationNumber: veh.registrationNumber,
        makeModel: veh.makeModel,
        status: veh.status,
        fastagBalancePaise: veh.fastagBalancePaise ?? 0,
        issues,
      });
    }
  }

  const hasData = trips.length > 0 || vehicles.length > 0 || invoices.length > 0 || expenses.length > 0;

  return {
    activeTripsCount,
    completedTripsCount,
    totalFreightRevenuePaise,
    totalRecordedExpensesPaise,
    tripContributionPaise,
    contributionMarginPercent,
    outstandingInvoicesPaise,
    outstandingInvoicesCount,
    totalTripsCount: trips.length,
    totalVehiclesCount: vehicles.length,
    activeVehiclesCount: vehicles.filter((v) => v.status === 'IN_TRANSIT').length,
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

export interface ReportFilterOptions {
  startDate?: string;
  endDate?: string;
  vehicleId?: string;
  driverId?: string;
  customerId?: string;
  status?: string;
  category?: string;
  paymentMethod?: string;
}

export function computeTripReport(
  params: {
    trips: Trip[];
    vehicles: Vehicle[];
    drivers: Driver[];
    customers: Customer[];
    expenses: TripExpense[];
  },
  filters: ReportFilterOptions = {}
) {
  const { trips, vehicles, drivers, customers, expenses } = params;
  const { startDate, endDate, vehicleId, driverId, customerId, status } = filters;

  let filtered = [...trips];
  if (startDate || endDate) {
    filtered = filtered.filter((t) =>
      isDateWithinRange(t.dispatchDate || t.createdAt, startDate, endDate)
    );
  }
  if (vehicleId) filtered = filtered.filter((t) => t.vehicleId === vehicleId);
  if (driverId) filtered = filtered.filter((t) => t.driverId === driverId);
  if (customerId) filtered = filtered.filter((t) => t.customerId === customerId);
  if (status) filtered = filtered.filter((t) => t.status === status);

  const vehMap = new Map(vehicles.map((v) => [v.id, v]));
  const drvMap = new Map(drivers.map((d) => [d.id, d]));
  const custMap = new Map(customers.map((c) => [c.id, c]));

  const rows = filtered.map((trip) => {
    const vehicle = vehMap.get(trip.vehicleId);
    const driver = drvMap.get(trip.driverId);
    const customer = custMap.get(trip.customerId);
    const tripExpenses = expenses.filter((e) => e.tripId === trip.id);
    const totalExpensesPaise =
      tripExpenses.length > 0
        ? tripExpenses.reduce((sum, e) => sum + (e.amountPaise || 0), 0)
        : trip.totalExpensesPaise || 0;
    const freightRevenuePaise =
      trip.totalRevenuePaise || (trip.freightAmountPaise || 0) + (trip.otherChargesPaise || 0);
    const contributionPaise = freightRevenuePaise - totalExpensesPaise;

    return {
      tripId: trip.id,
      tripNumber: trip.tripNumber || trip.id,
      lrNumber: trip.lrNumber || '',
      customerId: trip.customerId,
      customerName: customer?.name || trip.customerName || 'Unknown Customer',
      vehicleId: trip.vehicleId,
      vehicleRegistration: vehicle?.registrationNumber || trip.vehicleReg || 'Unknown Vehicle',
      driverId: trip.driverId,
      driverName: driver?.fullName || trip.driverName || 'Unknown Driver',
      dispatchDate: trip.dispatchDate || trip.createdAt || '',
      expectedDeliveryDate: trip.expectedDeliveryDate || '',
      status: trip.status,
      freightRevenuePaise,
      totalExpensesPaise,
      tripContributionPaise: contributionPaise,
      marginPercentage:
        freightRevenuePaise > 0
          ? ((contributionPaise / freightRevenuePaise) * 100).toFixed(1)
          : '0.0',
    };
  });

  const totalFreightRevenuePaise = rows.reduce((acc, r) => acc + r.freightRevenuePaise, 0);
  const totalExpensesPaise = rows.reduce((acc, r) => acc + r.totalExpensesPaise, 0);
  const totalTripContributionPaise = totalFreightRevenuePaise - totalExpensesPaise;

  return {
    disclaimer: REPORT_ACCOUNTING_DISCLAIMER,
    summary: {
      totalTrips: rows.length,
      totalFreightRevenuePaise,
      totalExpensesPaise,
      totalTripContributionPaise,
      overallMarginPercentage:
        totalFreightRevenuePaise > 0
          ? ((totalTripContributionPaise / totalFreightRevenuePaise) * 100).toFixed(1)
          : '0.0',
    },
    trips: rows,
  };
}

export function computeVehicleReport(
  params: {
    vehicles: Vehicle[];
    trips: Trip[];
    expenses: TripExpense[];
    maintenance?: MaintenanceRecord[];
  },
  filters: ReportFilterOptions = {}
) {
  const { vehicles, trips, expenses, maintenance = [] } = params;
  const { startDate, endDate, vehicleId } = filters;

  const targetVehicles = vehicleId ? vehicles.filter((v) => v.id === vehicleId) : vehicles;

  const vehicleRows = targetVehicles.map((v) => {
    let vTrips = trips.filter((t) => t.vehicleId === v.id);
    if (startDate || endDate) {
      vTrips = vTrips.filter((t) =>
        isDateWithinRange(t.dispatchDate || t.createdAt, startDate, endDate)
      );
    }

    let vExpenses = expenses.filter((e) => e.vehicleId === v.id);
    if (startDate || endDate) {
      vExpenses = vExpenses.filter((e) => isDateWithinRange(getExpenseDate(e), startDate, endDate));
    }

    let vMaint = maintenance.filter((m) => m.vehicleId === v.id);
    if (startDate || endDate) {
      vMaint = vMaint.filter((m) => isDateWithinRange(m.serviceDate, startDate, endDate));
    }

    const totalTrips = vTrips.length;
    const freightRevenuePaise = vTrips.reduce(
      (acc, t) => acc + (t.totalRevenuePaise || (t.freightAmountPaise || 0) + (t.otherChargesPaise || 0)),
      0
    );
    const recordedExpensesPaise = vExpenses.reduce((acc, e) => acc + (e.amountPaise || 0), 0);
    const tripContributionPaise = freightRevenuePaise - recordedExpensesPaise;

    const repairExpensesPaise = vExpenses
      .filter(
        (e) =>
          e.category === 'REPAIR' ||
          e.category === 'EN_ROUTE_REPAIR' ||
          e.category === 'TYRE_PUNCTURE'
      )
      .reduce((acc, e) => acc + (e.amountPaise || 0), 0);
    const maintenanceRecPaise = vMaint.reduce((acc, m) => acc + (m.costPaise || 0), 0);

    return {
      vehicleId: v.id,
      registrationNumber: v.registrationNumber,
      makeModel: v.makeModel,
      vehicleType: v.vehicleType,
      status: v.status,
      totalTrips,
      freightRevenuePaise,
      recordedExpensesPaise,
      tripContributionPaise,
      maintenanceCostsPaise: repairExpensesPaise + maintenanceRecPaise,
      fastagBalancePaise: v.fastagBalancePaise || 0,
    };
  });

  const summary = {
    totalVehicles: vehicleRows.length,
    totalTrips: vehicleRows.reduce((acc, r) => acc + r.totalTrips, 0),
    totalFreightRevenuePaise: vehicleRows.reduce((acc, r) => acc + r.freightRevenuePaise, 0),
    totalRecordedExpensesPaise: vehicleRows.reduce((acc, r) => acc + r.recordedExpensesPaise, 0),
    totalTripContributionPaise: vehicleRows.reduce((acc, r) => acc + r.tripContributionPaise, 0),
    totalMaintenanceCostsPaise: vehicleRows.reduce((acc, r) => acc + r.maintenanceCostsPaise, 0),
  };

  return {
    disclaimer: REPORT_ACCOUNTING_DISCLAIMER,
    summary,
    vehicles: vehicleRows,
  };
}

export function computeExpenseReport(
  params: {
    expenses: TripExpense[];
    vehicles: Vehicle[];
    trips: Trip[];
  },
  filters: ReportFilterOptions = {}
) {
  const { expenses, vehicles, trips } = params;
  const { startDate, endDate, vehicleId, category, paymentMethod } = filters;

  let filtered = [...expenses];
  if (startDate || endDate) {
    filtered = filtered.filter((e) => isDateWithinRange(getExpenseDate(e), startDate, endDate));
  }
  if (vehicleId) filtered = filtered.filter((e) => e.vehicleId === vehicleId);
  if (category) filtered = filtered.filter((e) => e.category === category);
  if (paymentMethod) filtered = filtered.filter((e) => e.paymentMode === paymentMethod);

  const vehMap = new Map(vehicles.map((v) => [v.id, v]));
  const tripMap = new Map(trips.map((t) => [t.id, t]));

  const rows = filtered.map((e) => {
    const v = e.vehicleId ? vehMap.get(e.vehicleId) : undefined;
    const t = e.tripId ? tripMap.get(e.tripId) : undefined;
    return {
      id: e.id,
      category: e.category,
      amountPaise: e.amountPaise,
      date: getExpenseDate(e),
      vehicleId: e.vehicleId || '',
      vehicleRegistration: v?.registrationNumber || e.vehicleReg || 'N/A',
      tripId: e.tripId || null,
      tripNumber: t?.tripNumber || e.tripNumber || (e.tripId ? 'Trip Ref' : 'N/A'),
      paymentMethod: e.paymentMode,
      notes: e.description || e.notes || '',
      receiptUrl: e.receiptUrl || e.receiptAttachmentUrl || '',
    };
  });

  const categoryTotals: Record<string, number> = {};
  for (const r of rows) {
    categoryTotals[r.category] = (categoryTotals[r.category] || 0) + r.amountPaise;
  }

  return {
    summary: {
      totalCount: rows.length,
      totalExpensePaise: rows.reduce((acc, r) => acc + r.amountPaise, 0),
      categoryTotals,
    },
    expenses: rows,
  };
}

export function computeReceivablesReport(
  params: {
    customers: Customer[];
    invoices: Invoice[];
  },
  filters: ReportFilterOptions = {}
) {
  const { customers, invoices } = params;
  const { customerId } = filters;

  const targetCustomers = customerId ? customers.filter((c) => c.id === customerId) : customers;
  const activeInvoices = invoices.filter((i) => i.status !== 'CANCELLED');
  const now = new Date();

  const customerRows = targetCustomers.map((c) => {
    const cInvoices = activeInvoices.filter((i) => i.customerId === c.id);
    const invoiceCount = cInvoices.length;
    const totalInvoicedPaise = cInvoices.reduce((acc, i) => acc + (i.totalAmountPaise || 0), 0);
    const totalPaidPaise = cInvoices.reduce((acc, i) => acc + (i.amountPaidPaise || 0), 0);
    const outstandingBalancePaise = cInvoices.reduce(
      (acc, i) => acc + (i.balanceDuePaise ?? 0),
      0
    );

    const overdueBalancePaise = cInvoices
      .filter((i) => {
        if ((i.balanceDuePaise ?? 0) <= 0) return false;
        const due = new Date(i.dueDate);
        return !Number.isNaN(due.getTime()) && due < now;
      })
      .reduce((acc, i) => acc + (i.balanceDuePaise ?? 0), 0);

    return {
      customerId: c.id,
      customerName: c.name,
      contactPerson: c.contactPerson || '',
      phone: c.phone || '',
      paymentTermsDays: c.paymentTermsDays || c.creditPeriodDays || 30,
      invoiceCount,
      totalInvoicedPaise,
      totalPaidPaise,
      outstandingBalancePaise,
      overdueBalancePaise,
    };
  });

  const summary = {
    customerCount: customerRows.length,
    totalInvoices: customerRows.reduce((acc, r) => acc + r.invoiceCount, 0),
    totalInvoicedPaise: customerRows.reduce((acc, r) => acc + r.totalInvoicedPaise, 0),
    totalPaidPaise: customerRows.reduce((acc, r) => acc + r.totalPaidPaise, 0),
    totalOutstandingBalancePaise: customerRows.reduce(
      (acc, r) => acc + r.outstandingBalancePaise,
      0
    ),
    totalOverdueBalancePaise: customerRows.reduce((acc, r) => acc + r.overdueBalancePaise, 0),
  };

  return {
    summary,
    customers: customerRows,
  };
}

export function computeMonthlyPerformanceReport(
  params: {
    trips: Trip[];
    expenses: TripExpense[];
    invoices: Invoice[];
  },
  monthsCount = 6
) {
  const { trips, expenses, invoices } = params;
  const numMonths = Math.min(Math.max(monthsCount || 6, 1), 24);
  const activeInvoices = invoices.filter((i) => i.status !== 'CANCELLED');
  const now = new Date();

  const months: {
    monthKey: string;
    monthLabel: string;
    startDate: string;
    endDate: string;
    freightRevenuePaise: number;
    recordedExpensesPaise: number;
    tripContributionPaise: number;
    completedTripsCount: number;
    activeVehiclesCount: number;
    outstandingInvoicesPaise: number;
  }[] = [];

  for (let i = numMonths - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    const monthKey = `${start.getFullYear()}-${(start.getMonth() + 1).toString().padStart(2, '0')}`;
    const monthLabel = start.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

    const mTrips = trips.filter((t) => {
      const dt = new Date(t.dispatchDate || t.createdAt);
      return !Number.isNaN(dt.getTime()) && dt >= start && dt <= end;
    });

    const completedTrips = mTrips.filter(
      (t) => t.status === 'COMPLETED' || t.status === 'DELIVERED' || t.status === 'SETTLED'
    );
    const freightRevenuePaise = mTrips
      .filter((t) => t.status !== 'CANCELLED')
      .reduce(
        (acc, t) => acc + (t.totalRevenuePaise || (t.freightAmountPaise || 0) + (t.otherChargesPaise || 0)),
        0
      );

    const distinctVehicles = new Set(mTrips.map((t) => t.vehicleId).filter(Boolean));

    const mExpenses = expenses.filter((e) => {
      const dtStr = getExpenseDate(e);
      if (!dtStr) return false;
      const dt = new Date(dtStr);
      return !Number.isNaN(dt.getTime()) && dt >= start && dt <= end;
    });
    const recordedExpensesPaise = mExpenses.reduce((acc, e) => acc + (e.amountPaise || 0), 0);
    const tripContributionPaise = freightRevenuePaise - recordedExpensesPaise;

    const mInvoices = activeInvoices.filter((inv) => {
      const dtStr = inv.issueDate || inv.createdAt;
      if (!dtStr) return false;
      const dt = new Date(dtStr);
      return !Number.isNaN(dt.getTime()) && dt >= start && dt <= end;
    });
    const outstandingInvoicesPaise = mInvoices.reduce(
      (acc, inv) => acc + (inv.balanceDuePaise ?? 0),
      0
    );

    months.push({
      monthKey,
      monthLabel,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      freightRevenuePaise,
      recordedExpensesPaise,
      tripContributionPaise,
      completedTripsCount: completedTrips.length,
      activeVehiclesCount: distinctVehicles.size,
      outstandingInvoicesPaise,
    });
  }

  return {
    disclaimer: REPORT_ACCOUNTING_DISCLAIMER,
    summary: {
      totalFreightRevenuePaise: months.reduce((acc, m) => acc + m.freightRevenuePaise, 0),
      totalTripExpensesPaise: months.reduce((acc, m) => acc + m.recordedExpensesPaise, 0),
      totalTripContributionPaise: months.reduce((acc, m) => acc + m.tripContributionPaise, 0),
      totalCompletedTrips: months.reduce((acc, m) => acc + m.completedTripsCount, 0),
      totalOutstandingInvoicesPaise: months.reduce(
        (acc, m) => acc + m.outstandingInvoicesPaise,
        0
      ),
    },
    months,
  };
}

export function computeCustomerReceivablesAging(params: {
  customers: Customer[];
  invoices: Invoice[];
  payments: Payment[];
}) {
  const { customers, invoices, payments } = params;
  const activeInvoices = invoices.filter((i) => i.status !== 'CANCELLED');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const agingBuckets = {
    currentPaise: 0,
    days1to30Paise: 0,
    days31to60Paise: 0,
    days60PlusPaise: 0,
  };

  let totalInvoicedPaise = 0;
  let totalCollectedPaise = 0;
  let totalOutstandingPaise = 0;
  let overdueAmountPaise = 0;

  for (const inv of activeInvoices) {
    totalInvoicedPaise += inv.totalAmountPaise || 0;
    totalCollectedPaise += inv.amountPaidPaise || 0;
    const bal = inv.balanceDuePaise ?? 0;
    totalOutstandingPaise += bal;

    if (bal > 0) {
      const due = new Date(inv.dueDate);
      const diffDays = Number.isNaN(due.getTime())
        ? 0
        : Math.floor((today.getTime() - due.getTime()) / (1000 * 3600 * 24));
      if (diffDays <= 0) {
        agingBuckets.currentPaise += bal;
      } else {
        overdueAmountPaise += bal;
        if (diffDays <= 30) agingBuckets.days1to30Paise += bal;
        else if (diffDays <= 60) agingBuckets.days31to60Paise += bal;
        else agingBuckets.days60PlusPaise += bal;
      }
    }
  }

  const totalTdsDeductedPaise = payments.reduce((acc, p) => acc + (p.tdsDeductedPaise || 0), 0);

  const customerSummaries = customers
    .map((c) => {
      const cInv = activeInvoices.filter((i) => i.customerId === c.id);
      const cPay = payments.filter((p) => p.customerId === c.id);
      const invoiced = cInv.reduce((s, i) => s + (i.totalAmountPaise || 0), 0);
      const paid = cInv.reduce((s, i) => s + (i.amountPaidPaise || 0), 0);
      const outstanding = cInv.reduce((s, i) => s + (i.balanceDuePaise ?? 0), 0);
      const overdue = cInv
        .filter((i) => (i.balanceDuePaise ?? 0) > 0 && new Date(i.dueDate) < today)
        .reduce((s, i) => s + (i.balanceDuePaise ?? 0), 0);
      const tds = cPay.reduce((s, p) => s + (p.tdsDeductedPaise || 0), 0);
      const lastPay = [...cPay].sort(
        (a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime()
      )[0];

      return {
        customerId: c.id,
        customerName: c.name,
        gstin: c.gstin,
        creditLimitPaise: c.creditLimitPaise || 0,
        invoiceCount: cInv.length,
        totalInvoicedPaise: invoiced,
        totalPaidPaise: paid,
        outstandingPaise: outstanding,
        overduePaise: overdue,
        tdsDeductedPaise: tds,
        lastPaymentDate: lastPay?.paymentDate,
      };
    })
    .filter((c) => c.invoiceCount > 0 || c.outstandingPaise > 0);

  return {
    summary: {
      totalInvoicedPaise,
      totalCollectedPaise,
      totalOutstandingPaise,
      overdueAmountPaise,
      totalTdsDeductedPaise,
      agingBuckets,
    },
    customerSummaries,
  };
}

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsvString(headers: string[], rows: unknown[][], commentHeader?: string): string {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const rowLines = rows.map((row) => row.map(escapeCsvCell).join(','));
  const body = [headerLine, ...rowLines].join('\r\n');
  return commentHeader ? `${commentHeader}\n${body}` : body;
}

export function exportRowsToCsv(
  filename: string,
  headers: string[],
  rows: unknown[][],
  commentHeader?: string
): void {
  const csv = buildCsvString(headers, rows, commentHeader);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function nextSequenceFromPrefix(existing: string[], prefix: string, padLength = 4): string {
  let maxNum = 0;
  for (const code of existing) {
    if (!code) continue;
    const m = code.match(/(\d+)\s*$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  }
  return `${prefix}${(maxNum + 1).toString().padStart(padLength, '0')}`;
}

export function getNextTripNumber(trips: Trip[], company?: Partial<Company> | null): string {
  const year = new Date().getFullYear();
  const basePrefix = `${company?.tripPrefix || 'TR-'}${year}-`;
  return nextSequenceFromPrefix(
    trips.map((t) => t.tripNumber),
    basePrefix,
    4
  );
}

export function getNextLrNumber(trips: Trip[], company?: Partial<Company> | null): string {
  const prefix = company?.lrPrefix || 'AT/25-26/';
  return nextSequenceFromPrefix(
    trips.map((t) => t.lrNumber),
    prefix,
    4
  );
}

export function getNextInvoiceNumber(invoices: Invoice[], company?: Partial<Company> | null): string {
  const prefix = company?.invoicePrefix || 'INV/25-26/';
  return nextSequenceFromPrefix(
    invoices.map((i) => i.invoiceNumber),
    prefix,
    3
  );
}

export function getNextSettlementNumber(existingCount: number, settlements: { settlementNumber?: string }[]): string {
  const year = new Date().getFullYear();
  const prefix = `STL-${year}-`;
  const existing = settlements.map((s) => s.settlementNumber || '').filter(Boolean);
  if (existing.length === 0 && existingCount > 0) {
    return `${prefix}${(existingCount + 1).toString().padStart(4, '0')}`;
  }
  return nextSequenceFromPrefix(existing, prefix, 4);
}
