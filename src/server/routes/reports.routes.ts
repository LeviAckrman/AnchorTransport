/**
 * AnchorTransport TMS - Reports & Analytics Engine API Routes (Phase 9)
 * 
 * Implements:
 * 1. Trip Report (Trip number, Customer, Vehicle, Driver, Freight revenue, Expenses, Trip contribution, Status)
 * 2. Vehicle Report (Vehicle registration, Total trips, Freight revenue, Recorded expenses, Trip contribution, Maintenance costs)
 * 3. Expense Report (Expense category, Amount, Date, Vehicle, Trip, Payment method)
 * 4. Customer Receivables Report (Customer, Invoice count, Total invoiced, Total paid, Outstanding balance, Overdue balance)
 * 5. Monthly Performance Report (Freight revenue, Expenses, Trip contribution, Completed trips, Active vehicles, Outstanding invoices)
 * 6. Global multi-dimensional filters: Date range (startDate/endDate), Vehicle, Driver, Customer, Trip status
 * 7. Company-scoped CSV exports for all reports with RFC 4180 standard escaping
 * 8. Strict multi-tenant company isolation on every query
 * 9. Explicit disclaimer: Trip contribution is Gross Operational Margin before fixed truck EMI, tyre depreciation, and overheads.
 */

import { Router, Response } from 'express';
import { AuthenticatedRequest, requireAuth } from '../auth';
import { serverFleetStore } from '../store';
import { serverCompanies } from './auth.routes';
import { Trip, TripExpense, Invoice, Vehicle } from '../../types/tms';
import { calculateTripContribution, formatRupees } from '../../lib/financialEngine';

export const reportsRouter = Router();

export const REPORT_ACCOUNTING_DISCLAIMER =
  'Trip contribution represents gross operational margin (Freight Revenue minus direct trip expenses such as fuel, toll, loading/unloading, and en-route repairs). ' +
  'It does NOT calculate full company net profit, which requires accounting for fixed truck financing EMIs, permit & insurance amortization, tyre depreciation, and corporate overheads.';

/**
 * Escapes a cell value for RFC 4180 CSV export
 */
function escapeCsvCell(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Converts array of rows into CSV string
 */
function buildCsvString(headers: string[], rows: any[][]): string {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const rowLines = rows.map((row) => row.map(escapeCsvCell).join(','));
  return [headerLine, ...rowLines].join('\r\n');
}

/**
 * Utility to parse and filter by date range
 */
function isDateWithinRange(dateStr: string | undefined, start?: string, end?: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;

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

/**
 * GET /api/reports/trips
 * Trip Report with filters & CSV export
 */
reportsRouter.get('/trips', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.companyId!;
  const {
    startDate,
    endDate,
    vehicleId,
    driverId,
    customerId,
    status,
    format,
  } = req.query as Record<string, string | undefined>;

  // Filter trips strictly by company
  let trips = serverFleetStore.trips.filter((t) => t.companyId === companyId);

  // Apply filters
  if (startDate || endDate) {
    trips = trips.filter((t) => isDateWithinRange(t.dispatchDate || t.createdAt, startDate, endDate));
  }
  if (vehicleId) {
    trips = trips.filter((t) => t.vehicleId === vehicleId);
  }
  if (driverId) {
    trips = trips.filter((t) => t.driverId === driverId);
  }
  if (customerId) {
    trips = trips.filter((t) => t.customerId === customerId);
  }
  if (status) {
    trips = trips.filter((t) => t.status === status);
  }

  // Pre-load company entities for fast lookups
  const companyVehicles = new Map(serverFleetStore.vehicles.filter((v) => v.companyId === companyId).map((v) => [v.id, v]));
  const companyDrivers = new Map(serverFleetStore.drivers.filter((d) => d.companyId === companyId).map((d) => [d.id, d]));
  const companyCustomers = new Map(serverFleetStore.customers.filter((c) => c.companyId === companyId).map((c) => [c.id, c]));
  const companyExpenses = serverFleetStore.expenses.filter((e) => e.companyId === companyId);

  // Calculate detailed financial metrics per trip
  const rows = trips.map((trip) => {
    const vehicle = companyVehicles.get(trip.vehicleId);
    const driver = companyDrivers.get(trip.driverId);
    const customer = companyCustomers.get(trip.customerId);
    const tripExpenses = companyExpenses.filter((e) => e.tripId === trip.id);
    const totalExpensesPaise = tripExpenses.reduce((sum, e) => sum + (e.amountPaise || 0), 0);
    const freightRevenuePaise = (trip.freightAmountPaise || 0) + (trip.otherChargesPaise || 0);
    const contributionPaise = freightRevenuePaise - totalExpensesPaise;

    return {
      tripId: trip.id,
      tripNumber: trip.tripNumber || trip.id,
      lrNumber: trip.lrNumber || '',
      customerId: trip.customerId,
      customerName: customer?.name || 'Unknown Customer',
      vehicleId: trip.vehicleId,
      vehicleRegistration: vehicle?.registrationNumber || 'Unknown Vehicle',
      driverId: trip.driverId,
      driverName: driver?.fullName || 'Unknown Driver',
      dispatchDate: trip.dispatchDate || trip.createdAt,
      expectedDeliveryDate: trip.expectedDeliveryDate || '',
      status: trip.status,
      freightRevenuePaise,
      totalExpensesPaise,
      tripContributionPaise: contributionPaise,
      marginPercentage: freightRevenuePaise > 0 ? ((contributionPaise / freightRevenuePaise) * 100).toFixed(1) : '0.0',
    };
  });

  // Calculate totals
  const totalFreightPaise = rows.reduce((acc, r) => acc + r.freightRevenuePaise, 0);
  const totalExpensesPaise = rows.reduce((acc, r) => acc + r.totalExpensesPaise, 0);
  const totalContributionPaise = totalFreightPaise - totalExpensesPaise;

  if (format === 'csv') {
    const headers = [
      'Trip Number',
      'LR Number',
      'Customer',
      'Vehicle',
      'Driver',
      'Dispatch Date',
      'Status',
      'Freight Revenue (INR)',
      'Recorded Expenses (INR)',
      'Trip Contribution (INR)',
      'Margin %',
    ];
    const csvRows = rows.map((r) => [
      r.tripNumber,
      r.lrNumber,
      r.customerName,
      r.vehicleRegistration,
      r.driverName,
      r.dispatchDate.slice(0, 10),
      r.status,
      (r.freightRevenuePaise / 100).toFixed(2),
      (r.totalExpensesPaise / 100).toFixed(2),
      (r.tripContributionPaise / 100).toFixed(2),
      `${r.marginPercentage}%`,
    ]);

    const company = serverCompanies.find((c) => c.id === companyId);
    const companyHeader = `# Company: ${company?.name || company?.tradeName || companyId}\n`;
    const csvData = companyHeader + buildCsvString(headers, csvRows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="trips_report_${companyId}_${Date.now()}.csv"`);
    res.status(200).send(csvData);
    return;
  }

  res.json({
    success: true,
    disclaimer: REPORT_ACCOUNTING_DISCLAIMER,
    summary: {
      totalTrips: rows.length,
      totalFreightRevenuePaise: totalFreightPaise,
      totalExpensesPaise,
      totalTripContributionPaise: totalContributionPaise,
      overallMarginPercentage: totalFreightPaise > 0 ? ((totalContributionPaise / totalFreightPaise) * 100).toFixed(1) : '0.0',
    },
    trips: rows,
  });
});

/**
 * GET /api/reports/vehicles
 * Vehicle Performance Report (Trips, Revenue, Expenses, Contribution, Maintenance)
 */
reportsRouter.get('/vehicles', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { startDate, endDate, vehicleId, format } = req.query as Record<string, string | undefined>;

  let vehicles = serverFleetStore.vehicles.filter((v) => v.companyId === companyId);
  if (vehicleId) {
    vehicles = vehicles.filter((v) => v.id === vehicleId);
  }

  const allCompanyTrips = serverFleetStore.trips.filter((t) => t.companyId === companyId);
  const allCompanyExpenses = serverFleetStore.expenses.filter((e) => e.companyId === companyId);

  const vehicleRows = vehicles.map((v) => {
    // Filter trips for this vehicle by date if requested
    let vTrips = allCompanyTrips.filter((t) => t.vehicleId === v.id);
    if (startDate || endDate) {
      vTrips = vTrips.filter((t) => isDateWithinRange(t.dispatchDate || t.createdAt, startDate, endDate));
    }

    // Filter expenses for this vehicle by date if requested
    let vExpenses = allCompanyExpenses.filter((e) => e.vehicleId === v.id);
    if (startDate || endDate) {
      vExpenses = vExpenses.filter((e) => isDateWithinRange(e.date || e.createdAt, startDate, endDate));
    }

    const totalTrips = vTrips.length;
    const freightRevenuePaise = vTrips.reduce((acc, t) => acc + (t.freightAmountPaise || 0) + (t.otherChargesPaise || 0), 0);
    const recordedExpensesPaise = vExpenses.reduce((acc, e) => acc + (e.amountPaise || 0), 0);
    const tripContributionPaise = freightRevenuePaise - recordedExpensesPaise;

    // Maintenance costs: REPAIR, EN_ROUTE_REPAIR, TYRE_PUNCTURE
    const maintenanceExpenses = vExpenses.filter(
      (e) => e.category === 'REPAIR' || e.category === 'EN_ROUTE_REPAIR' || e.category === 'TYRE_PUNCTURE'
    );
    const maintenanceCostsPaise = maintenanceExpenses.reduce((acc, e) => acc + (e.amountPaise || 0), 0);

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
      maintenanceCostsPaise,
      fastagBalancePaise: v.fastagBalancePaise || 0,
    };
  });

  const totals = {
    totalVehicles: vehicleRows.length,
    totalTrips: vehicleRows.reduce((acc, r) => acc + r.totalTrips, 0),
    totalFreightRevenuePaise: vehicleRows.reduce((acc, r) => acc + r.freightRevenuePaise, 0),
    totalRecordedExpensesPaise: vehicleRows.reduce((acc, r) => acc + r.recordedExpensesPaise, 0),
    totalTripContributionPaise: vehicleRows.reduce((acc, r) => acc + r.tripContributionPaise, 0),
    totalMaintenanceCostsPaise: vehicleRows.reduce((acc, r) => acc + r.maintenanceCostsPaise, 0),
  };

  if (format === 'csv') {
    const headers = [
      'Registration Number',
      'Model & Type',
      'Status',
      'Total Trips',
      'Freight Revenue (INR)',
      'Recorded Expenses (INR)',
      'Trip Contribution (INR)',
      'Maintenance Costs (INR)',
      'FASTag Balance (INR)',
    ];
    const csvRows = vehicleRows.map((r) => [
      r.registrationNumber,
      `${r.makeModel} (${r.vehicleType})`,
      r.status,
      r.totalTrips,
      (r.freightRevenuePaise / 100).toFixed(2),
      (r.recordedExpensesPaise / 100).toFixed(2),
      (r.tripContributionPaise / 100).toFixed(2),
      (r.maintenanceCostsPaise / 100).toFixed(2),
      (r.fastagBalancePaise / 100).toFixed(2),
    ]);

    const csvData = buildCsvString(headers, csvRows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="vehicle_performance_${companyId}_${Date.now()}.csv"`);
    res.status(200).send(csvData);
    return;
  }

  res.json({
    success: true,
    disclaimer: REPORT_ACCOUNTING_DISCLAIMER,
    summary: totals,
    vehicles: vehicleRows,
  });
});

/**
 * GET /api/reports/expenses
 * Expense Analysis Report (Category breakdown, vehicle, trip, payment method)
 */
reportsRouter.get('/expenses', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.companyId!;
  const {
    startDate,
    endDate,
    vehicleId,
    category,
    paymentMethod,
    format,
  } = req.query as Record<string, string | undefined>;

  let expenses = serverFleetStore.expenses.filter((e) => e.companyId === companyId);

  if (startDate || endDate) {
    expenses = expenses.filter((e) => isDateWithinRange(e.date || e.createdAt, startDate, endDate));
  }
  if (vehicleId) {
    expenses = expenses.filter((e) => e.vehicleId === vehicleId);
  }
  if (category) {
    expenses = expenses.filter((e) => e.category === category);
  }
  if (paymentMethod) {
    expenses = expenses.filter((e) => e.paymentMode === paymentMethod);
  }

  const companyVehicles = new Map(serverFleetStore.vehicles.filter((v) => v.companyId === companyId).map((v) => [v.id, v]));
  const companyTrips = new Map(serverFleetStore.trips.filter((t) => t.companyId === companyId).map((t) => [t.id, t]));

  const rows = expenses.map((e) => {
    const v = e.vehicleId ? companyVehicles.get(e.vehicleId) : undefined;
    const t = e.tripId ? companyTrips.get(e.tripId) : undefined;

    return {
      id: e.id,
      category: e.category,
      amountPaise: e.amountPaise,
      date: e.date || e.expenseDate || e.createdAt || '',
      vehicleId: e.vehicleId || '',
      vehicleRegistration: v?.registrationNumber || 'N/A',
      tripId: e.tripId || null,
      tripNumber: t?.tripNumber || (e.tripId ? 'Trip Ref' : 'N/A'),
      paymentMethod: e.paymentMode,
      notes: e.description || '',
      receiptUrl: '',
    };
  });

  // Calculate category totals
  const categoryTotals: Record<string, number> = {};
  for (const r of rows) {
    categoryTotals[r.category] = (categoryTotals[r.category] || 0) + r.amountPaise;
  }

  const totalExpensePaise = rows.reduce((acc, r) => acc + r.amountPaise, 0);

  if (format === 'csv') {
    const headers = [
      'Category',
      'Amount (INR)',
      'Date',
      'Vehicle Registration',
      'Trip Number',
      'Payment Method',
      'Notes',
    ];
    const csvRows = rows.map((r) => [
      r.category,
      (r.amountPaise / 100).toFixed(2),
      (r.date || '').slice(0, 10),
      r.vehicleRegistration,
      r.tripNumber,
      r.paymentMethod,
      r.notes,
    ]);

    const csvData = buildCsvString(headers, csvRows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="expenses_report_${companyId}_${Date.now()}.csv"`);
    res.status(200).send(csvData);
    return;
  }

  res.json({
    success: true,
    summary: {
      totalCount: rows.length,
      totalExpensePaise,
      categoryTotals,
    },
    expenses: rows,
  });
});

/**
 * GET /api/reports/receivables
 * Customer Receivables Report (Invoices, Paid, Outstanding, Overdue balances)
 */
reportsRouter.get('/receivables', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { customerId, format } = req.query as Record<string, string | undefined>;

  let customers = serverFleetStore.customers.filter((c) => c.companyId === companyId);
  if (customerId) {
    customers = customers.filter((c) => c.id === customerId);
  }

  const allCompanyInvoices = serverFleetStore.invoices.filter((i) => i.companyId === companyId && i.status !== 'CANCELLED');
  const now = new Date();

  const customerRows = customers.map((c) => {
    const cInvoices = allCompanyInvoices.filter((i) => i.customerId === c.id);
    const invoiceCount = cInvoices.length;
    const totalInvoicedPaise = cInvoices.reduce((acc, i) => acc + (i.totalAmountPaise || 0), 0);
    const totalPaidPaise = cInvoices.reduce((acc, i) => acc + (i.amountPaidPaise || 0), 0);
    const outstandingBalancePaise = cInvoices.reduce((acc, i) => acc + (i.balanceDuePaise || 0), 0);

    // Overdue balance: balance due on invoices where dueDate < now
    const overdueInvoices = cInvoices.filter((i) => {
      if (i.balanceDuePaise <= 0) return false;
      const due = new Date(i.dueDate);
      return due < now;
    });

    const overdueBalancePaise = overdueInvoices.reduce((acc, i) => acc + i.balanceDuePaise, 0);

    return {
      customerId: c.id,
      customerName: c.name,
      contactPerson: c.contactPerson || '',
      phone: c.phone || '',
      paymentTermsDays: c.paymentTermsDays || 30,
      invoiceCount,
      totalInvoicedPaise,
      totalPaidPaise,
      outstandingBalancePaise,
      overdueBalancePaise,
    };
  });

  const totals = {
    customerCount: customerRows.length,
    totalInvoices: customerRows.reduce((acc, r) => acc + r.invoiceCount, 0),
    totalInvoicedPaise: customerRows.reduce((acc, r) => acc + r.totalInvoicedPaise, 0),
    totalPaidPaise: customerRows.reduce((acc, r) => acc + r.totalPaidPaise, 0),
    totalOutstandingBalancePaise: customerRows.reduce((acc, r) => acc + r.outstandingBalancePaise, 0),
    totalOverdueBalancePaise: customerRows.reduce((acc, r) => acc + r.overdueBalancePaise, 0),
  };

  if (format === 'csv') {
    const headers = [
      'Customer Name',
      'Contact Person',
      'Phone',
      'Payment Terms (Days)',
      'Invoice Count',
      'Total Invoiced (INR)',
      'Total Paid (INR)',
      'Outstanding Balance (INR)',
      'Overdue Balance (INR)',
    ];
    const csvRows = customerRows.map((r) => [
      r.customerName,
      r.contactPerson,
      r.phone,
      r.paymentTermsDays,
      r.invoiceCount,
      (r.totalInvoicedPaise / 100).toFixed(2),
      (r.totalPaidPaise / 100).toFixed(2),
      (r.outstandingBalancePaise / 100).toFixed(2),
      (r.overdueBalancePaise / 100).toFixed(2),
    ]);

    const csvData = buildCsvString(headers, csvRows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="customer_receivables_${companyId}_${Date.now()}.csv"`);
    res.status(200).send(csvData);
    return;
  }

  res.json({
    success: true,
    summary: totals,
    customers: customerRows,
  });
});

/**
 * GET /api/reports/monthly-performance
 * Monthly performance trends (Revenue, Expenses, Trip Contribution, Completed Trips, Active Vehicles, Outstanding Invoices)
 */
reportsRouter.get('/monthly-performance', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { monthsCount = '6', format } = req.query as Record<string, string | undefined>;
  const numMonths = Math.min(Math.max(parseInt(monthsCount, 10) || 6, 1), 24);

  const companyTrips = serverFleetStore.trips.filter((t) => t.companyId === companyId);
  const companyExpenses = serverFleetStore.expenses.filter((e) => e.companyId === companyId);
  const companyInvoices = serverFleetStore.invoices.filter((i) => i.companyId === companyId && i.status !== 'CANCELLED');

  // Build month slots from current month going back numMonths
  const now = new Date();
  const monthlyData: {
    monthKey: string; // "2026-03"
    monthLabel: string; // "Mar 2026"
    startDate: Date;
    endDate: Date;
    freightRevenuePaise: number;
    recordedExpensesPaise: number;
    tripContributionPaise: number;
    completedTripsCount: number;
    activeVehiclesCount: number;
    outstandingInvoicesPaise: number;
  }[] = [];

  for (let i = numMonths - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    const monthKey = `${start.getFullYear()}-${(start.getMonth() + 1).toString().padStart(2, '0')}`;
    const monthLabel = start.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

    // Trips within month
    const mTrips = companyTrips.filter((t) => {
      const dt = new Date(t.dispatchDate || t.createdAt);
      return dt >= start && dt <= end;
    });

    const completedTrips = mTrips.filter((t) => t.status === 'COMPLETED' || t.status === 'DELIVERED' || t.status === 'SETTLED');
    const freightRevenuePaise = mTrips.reduce((acc, t) => acc + (t.freightAmountPaise || 0) + (t.otherChargesPaise || 0), 0);

    // Active vehicles (distinct vehicles deployed in trips this month)
    const distinctVehicles = new Set(mTrips.map((t) => t.vehicleId));

    // Expenses recorded this month
    const mExpenses = companyExpenses.filter((e) => {
      const dtStr = e.date || e.expenseDate || e.createdAt;
      if (!dtStr) return false;
      const dt = new Date(dtStr);
      return dt >= start && dt <= end;
    });
    const recordedExpensesPaise = mExpenses.reduce((acc, e) => acc + (e.amountPaise || 0), 0);
    const tripContributionPaise = freightRevenuePaise - recordedExpensesPaise;

    // Invoices issued this month that are currently outstanding
    const mInvoices = companyInvoices.filter((inv) => {
      const dtStr = inv.issueDate || inv.createdAt;
      if (!dtStr) return false;
      const dt = new Date(dtStr);
      return dt >= start && dt <= end;
    });
    const outstandingInvoicesPaise = mInvoices.reduce((acc, inv) => acc + (inv.balanceDuePaise || 0), 0);

    monthlyData.push({
      monthKey,
      monthLabel,
      startDate: start,
      endDate: end,
      freightRevenuePaise,
      recordedExpensesPaise,
      tripContributionPaise,
      completedTripsCount: completedTrips.length,
      activeVehiclesCount: distinctVehicles.size,
      outstandingInvoicesPaise,
    });
  }

  const totals = {
    totalFreightRevenuePaise: monthlyData.reduce((acc, m) => acc + m.freightRevenuePaise, 0),
    totalTripExpensesPaise: monthlyData.reduce((acc, m) => acc + m.recordedExpensesPaise, 0),
    totalTripContributionPaise: monthlyData.reduce((acc, m) => acc + m.tripContributionPaise, 0),
    totalCompletedTrips: monthlyData.reduce((acc, m) => acc + m.completedTripsCount, 0),
    totalOutstandingInvoicesPaise: monthlyData.reduce((acc, m) => acc + m.outstandingInvoicesPaise, 0),
  };

  if (format === 'csv') {
    const headers = [
      'Month',
      'Freight Revenue (INR)',
      'Trip Expenses (INR)',
      'Trip Contribution (INR)',
      'Completed Trips',
      'Active Trucks',
      'Outstanding Invoices (INR)',
    ];
    const csvRows = monthlyData.map((m) => [
      m.monthLabel,
      (m.freightRevenuePaise / 100).toFixed(2),
      (m.recordedExpensesPaise / 100).toFixed(2),
      (m.tripContributionPaise / 100).toFixed(2),
      m.completedTripsCount,
      m.activeVehiclesCount,
      (m.outstandingInvoicesPaise / 100).toFixed(2),
    ]);

    const csvData = buildCsvString(headers, csvRows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="monthly_performance_${companyId}_${Date.now()}.csv"`);
    res.status(200).send(csvData);
    return;
  }

  res.json({
    success: true,
    disclaimer: REPORT_ACCOUNTING_DISCLAIMER,
    summary: totals,
    months: monthlyData,
  });
});
