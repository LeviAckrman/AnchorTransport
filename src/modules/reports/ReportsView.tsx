/**
 * AnchorTransport TMS - Reports & Analytics Engine
 *
 * Computes all operational & financial reports directly from live Firestore data:
 * 1. Trip Report
 * 2. Vehicle Performance Report
 * 3. Expense Analysis Report
 * 4. Customer Receivables Report
 * 5. Monthly Performance Report
 */

import React, { useState, useMemo } from 'react';
import {
  FileText,
  Truck,
  Receipt,
  Users,
  TrendingUp,
  Download,
  Filter,
  AlertTriangle,
  History,
  Search,
  BookOpen,
} from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { formatRupees, paiseToRupees } from '../../lib/financialEngine';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import {
  computeTripReport,
  computeVehicleReport,
  computeExpenseReport,
  computeReceivablesReport,
  computeMonthlyPerformanceReport,
  exportRowsToCsv,
  REPORT_ACCOUNTING_DISCLAIMER,
} from '../../lib/tmsCalculations';
import { fetchCompletedJournalTripsForReport } from '../../lib/firebase/journalTripsService';
import { JOURNAL_ENTRY_TYPE_LABELS, summarizeJournalTrips } from '../../lib/journalTripsHelpers';
import type { JournalTrip } from '../../types/tms';

export type ReportType = 'trips' | 'vehicles' | 'expenses' | 'receivables' | 'monthly' | 'audit';

export interface ReportsViewProps {
  userRole?: string;
  initialReport?: ReportType;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  userRole: _userRole = 'OWNER',
  initialReport = 'trips',
}) => {
  const {
    company,
    vehicles,
    drivers,
    customers,
    trips,
    expenses,
    invoices,
    maintenance,
    auditLogs,
    loading,
    error,
  } = useFirestoreData();

  const [activeReport, setActiveReport] = useState<ReportType>(initialReport);

  // Filters state
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');
  const [selectedDriverId, setSelectedDriverId] = useState<string>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [selectedTripStatus, setSelectedTripStatus] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('');
  const [auditActionFilter, setAuditActionFilter] = useState<string>('');
  const [auditEntityFilter, setAuditEntityFilter] = useState<string>('');
  const [auditSearchQuery, setAuditSearchQuery] = useState<string>('');

  // Explicit Opt-In for Trips Journal (default false — never mixed silently with operational reports)
  const [includeJournalTrips, setIncludeJournalTrips] = useState<boolean>(false);
  const [optInJournalTrips, setOptInJournalTrips] = useState<JournalTrip[]>([]);
  const [journalReportLoading, setJournalReportLoading] = useState<boolean>(false);

  React.useEffect(() => {
    let active = true;
    const supportsJournalToggle =
      activeReport === 'trips' ||
      activeReport === 'vehicles' ||
      activeReport === 'expenses' ||
      activeReport === 'monthly';

    if (!includeJournalTrips || !supportsJournalToggle || !company?.id) {
      setOptInJournalTrips([]);
      return;
    }

    setJournalReportLoading(true);
    fetchCompletedJournalTripsForReport(company.id, {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      vehicleId: selectedVehicleId || undefined,
      driverId: selectedDriverId || undefined,
    })
      .then((rows) => {
        if (active) setOptInJournalTrips(rows);
      })
      .catch(() => {
        if (active) setOptInJournalTrips([]);
      })
      .finally(() => {
        if (active) setJournalReportLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    includeJournalTrips,
    activeReport,
    company?.id,
    startDate,
    endDate,
    selectedVehicleId,
    selectedDriverId,
  ]);

  const optInJournalStats = useMemo(
    () => summarizeJournalTrips(optInJournalTrips),
    [optInJournalTrips]
  );

  const reportData = useMemo(() => {
    const filters = {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      vehicleId: selectedVehicleId || undefined,
      driverId: selectedDriverId || undefined,
      customerId: selectedCustomerId || undefined,
      status: selectedTripStatus || undefined,
      category: selectedCategory || undefined,
      paymentMethod: selectedPaymentMethod || undefined,
    };

    switch (activeReport) {
      case 'trips':
        return computeTripReport({ trips, vehicles, drivers, customers, expenses }, filters);
      case 'vehicles':
        return computeVehicleReport({ vehicles, trips, expenses, maintenance }, filters);
      case 'expenses':
        return computeExpenseReport({ expenses, vehicles, trips }, filters);
      case 'receivables':
        return computeReceivablesReport({ customers, invoices }, filters);
      case 'monthly':
        return computeMonthlyPerformanceReport({ trips, expenses, invoices }, 6);
      case 'audit':
      default:
        return { audit: true };
    }
  }, [
    activeReport,
    startDate,
    endDate,
    selectedVehicleId,
    selectedDriverId,
    selectedCustomerId,
    selectedTripStatus,
    selectedCategory,
    selectedPaymentMethod,
    trips,
    vehicles,
    drivers,
    customers,
    expenses,
    invoices,
    maintenance,
  ]);

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearchQuery.trim().toLowerCase();
    return [...auditLogs]
      .filter((log) => {
        const tsDate = log.timestamp ? log.timestamp.slice(0, 10) : '';
        if (startDate && tsDate && tsDate < startDate) return false;
        if (endDate && tsDate && tsDate > endDate) return false;
        if (auditActionFilter && log.action !== auditActionFilter) return false;
        if (auditEntityFilter && log.entityType !== auditEntityFilter) return false;
        if (q) {
          const hay = [
            log.action,
            log.entityType,
            log.entityId,
            log.moduleName,
            log.summary,
            log.userName,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
  }, [auditLogs, startDate, endDate, auditActionFilter, auditEntityFilter, auditSearchQuery]);

  const handleExportCsv = () => {
    const dateSuffix = new Date().toISOString().split('T')[0];

    if (activeReport === 'trips' && 'trips' in reportData) {
      const headers = [
        'Trip #',
        'LR #',
        'Customer',
        'Vehicle',
        'Driver',
        'Dispatch Date',
        'Status',
        'Freight Revenue (INR)',
        'Direct Expenses (INR)',
        'Trip Contribution (INR)',
        'Margin %',
      ];
      const rows = reportData.trips.map((r) => [
        r.tripNumber,
        r.lrNumber,
        r.customerName,
        r.vehicleRegistration,
        r.driverName,
        r.dispatchDate?.slice(0, 10),
        r.status,
        paiseToRupees(r.freightRevenuePaise).toFixed(2),
        paiseToRupees(r.totalExpensesPaise).toFixed(2),
        paiseToRupees(r.tripContributionPaise).toFixed(2),
        `${r.marginPercentage}%`,
      ]);
      exportRowsToCsv(`trip-report-${dateSuffix}.csv`, headers, rows, `# ${REPORT_ACCOUNTING_DISCLAIMER}`);
    } else if (activeReport === 'vehicles' && 'vehicles' in reportData) {
      const headers = [
        'Registration',
        'Model',
        'Type',
        'Status',
        'Total Trips',
        'Freight Revenue (INR)',
        'Recorded Expenses (INR)',
        'Maintenance Costs (INR)',
        'Trip Contribution (INR)',
        'FASTag Balance (INR)',
      ];
      const rows = reportData.vehicles.map((r) => [
        r.registrationNumber,
        r.makeModel,
        r.vehicleType,
        r.status,
        r.totalTrips,
        paiseToRupees(r.freightRevenuePaise).toFixed(2),
        paiseToRupees(r.recordedExpensesPaise).toFixed(2),
        paiseToRupees(r.maintenanceCostsPaise).toFixed(2),
        paiseToRupees(r.tripContributionPaise).toFixed(2),
        paiseToRupees(r.fastagBalancePaise).toFixed(2),
      ]);
      exportRowsToCsv(`vehicle-performance-${dateSuffix}.csv`, headers, rows, `# ${REPORT_ACCOUNTING_DISCLAIMER}`);
    } else if (activeReport === 'expenses' && 'expenses' in reportData) {
      const headers = ['Date', 'Category', 'Vehicle', 'Trip #', 'Payment Method', 'Notes', 'Amount (INR)'];
      const rows = reportData.expenses.map((r) => [
        r.date?.slice(0, 10),
        r.category,
        r.vehicleRegistration,
        r.tripNumber,
        r.paymentMethod,
        r.notes,
        paiseToRupees(r.amountPaise).toFixed(2),
      ]);
      exportRowsToCsv(`expense-report-${dateSuffix}.csv`, headers, rows);
    } else if (activeReport === 'receivables' && 'customers' in reportData) {
      const headers = [
        'Customer',
        'Contact',
        'Phone',
        'Credit Terms (Days)',
        'Invoices',
        'Total Invoiced (INR)',
        'Total Paid (INR)',
        'Outstanding Balance (INR)',
        'Overdue Balance (INR)',
      ];
      const rows = reportData.customers.map((r) => [
        r.customerName,
        r.contactPerson,
        r.phone,
        r.paymentTermsDays,
        r.invoiceCount,
        paiseToRupees(r.totalInvoicedPaise).toFixed(2),
        paiseToRupees(r.totalPaidPaise).toFixed(2),
        paiseToRupees(r.outstandingBalancePaise).toFixed(2),
        paiseToRupees(r.overdueBalancePaise).toFixed(2),
      ]);
      exportRowsToCsv(`customer-receivables-${dateSuffix}.csv`, headers, rows);
    } else if (activeReport === 'monthly' && 'months' in reportData) {
      const headers = [
        'Billing Month',
        'Completed Trips',
        'Active Vehicles',
        'Freight Revenue (INR)',
        'Trip Expenses (INR)',
        'Trip Contribution (INR)',
        'Outstanding Invoices (INR)',
      ];
      const rows = reportData.months.map((r) => [
        r.monthLabel,
        r.completedTripsCount,
        r.activeVehiclesCount,
        paiseToRupees(r.freightRevenuePaise).toFixed(2),
        paiseToRupees(r.recordedExpensesPaise).toFixed(2),
        paiseToRupees(r.tripContributionPaise).toFixed(2),
        paiseToRupees(r.outstandingInvoicesPaise).toFixed(2),
      ]);
      exportRowsToCsv(`monthly-performance-${dateSuffix}.csv`, headers, rows, `# ${REPORT_ACCOUNTING_DISCLAIMER}`);
    } else if (activeReport === 'audit') {
      const headers = ['Timestamp', 'Action', 'Entity Type', 'Entity ID', 'Module', 'Actor', 'Summary'];
      const rows = filteredAuditLogs.map((log) => [
        log.timestamp || '',
        log.action,
        log.entityType,
        log.entityId,
        log.moduleName || log.entityType,
        log.userName || 'Owner',
        log.summary,
      ]);
      exportRowsToCsv(`owner-audit-trail-${dateSuffix}.csv`, headers, rows);
    }
  };

  const handleResetFilters = () => {
    setStartDate('');
    setEndDate('');
    setSelectedVehicleId('');
    setSelectedDriverId('');
    setSelectedCustomerId('');
    setSelectedTripStatus('');
    setSelectedCategory('');
    setSelectedPaymentMethod('');
    setAuditActionFilter('');
    setAuditEntityFilter('');
    setAuditSearchQuery('');
    setIncludeJournalTrips(false);
  };

  const tripsReport = activeReport === 'trips' && 'trips' in reportData ? reportData : null;
  const vehiclesReport = activeReport === 'vehicles' && 'vehicles' in reportData ? reportData : null;
  const expensesReport = activeReport === 'expenses' && 'expenses' in reportData ? reportData : null;
  const receivablesReport = activeReport === 'receivables' && 'customers' in reportData ? reportData : null;
  const monthlyReport = activeReport === 'monthly' && 'months' in reportData ? reportData : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet Financial & Operational Reports"
        subtitle="Audited operational metrics, truck profit contributions, receivables, and category expenses"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              disabled={loading}
              className="flex items-center gap-1.5"
            >
              <Download className="w-4 h-4 text-slate-600" />
              <span>Export CSV</span>
            </Button>
          </div>
        }
      />

      {/* Statutory Accounting Disclaimer Notice */}
      <div className="p-4 rounded-xl bg-amber-50 border border-amber-200/80 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900 leading-relaxed">
          <span className="font-bold block mb-0.5">Financial & Accounting Measure Definition:</span>
          <strong>Trip Contribution</strong> represents <em>Gross Operational Margin</em> (Freight Revenue minus direct recorded trip expenses such as fuel, toll, loading/unloading, and en-route repairs). It does <strong>NOT</strong> calculate full corporate net profit, which requires accounting for truck capital loan EMIs, permit and comprehensive insurance amortization, tyre depreciation, and administrative overheads.
        </div>
      </div>

      {/* Report Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        <button
          onClick={() => setActiveReport('trips')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            activeReport === 'trips'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Trip Report</span>
        </button>

        <button
          onClick={() => setActiveReport('vehicles')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            activeReport === 'vehicles'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Truck className="w-4 h-4" />
          <span>Vehicle Report</span>
        </button>

        <button
          onClick={() => setActiveReport('expenses')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            activeReport === 'expenses'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>Expense Analysis</span>
        </button>

        <button
          onClick={() => setActiveReport('receivables')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            activeReport === 'receivables'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Customer Receivables</span>
        </button>

        <button
          onClick={() => setActiveReport('monthly')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            activeReport === 'monthly'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          <span>Monthly Performance</span>
        </button>

        <button
          onClick={() => setActiveReport('audit')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            activeReport === 'audit'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Audit Trail ({auditLogs.length})</span>
        </button>
      </div>

      {/* Global Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider">
            <Filter className="w-4 h-4 text-indigo-600" />
            <span>Report Filters</span>
          </div>
          <button
            onClick={handleResetFilters}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
          >
            Reset Filters
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Start Date */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">From Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* End Date */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">To Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Vehicle Filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Vehicle</label>
            <select
              value={selectedVehicleId}
              onChange={(e) => setSelectedVehicleId(e.target.value)}
              className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Vehicles</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registrationNumber} ({v.makeModel || 'Truck'})
                </option>
              ))}
            </select>
          </div>

          {/* Driver Filter */}
          {activeReport === 'trips' && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Driver</label>
              <select
                value={selectedDriverId}
                onChange={(e) => setSelectedDriverId(e.target.value)}
                className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All Drivers</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Customer Filter */}
          {(activeReport === 'trips' || activeReport === 'receivables') && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Customer</label>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All Customers</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Status Filter for Trips */}
          {activeReport === 'trips' && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Trip Status</label>
              <select
                value={selectedTripStatus}
                onChange={(e) => setSelectedTripStatus(e.target.value)}
                className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All Statuses</option>
                <option value="PLANNED">Planned</option>
                <option value="DISPATCHED">Dispatched</option>
                <option value="IN_TRANSIT">In Transit</option>
                <option value="DELIVERED">Delivered</option>
                <option value="SETTLED">Settled</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          )}

          {/* Expense Category Filter */}
          {activeReport === 'expenses' && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Category</label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All Categories</option>
                <option value="FUEL">Fuel</option>
                <option value="DIESEL">Diesel</option>
                <option value="TOLL">Toll</option>
                <option value="TOLL_FASTAG">Toll (FASTag)</option>
                <option value="PARKING">Parking / Border Check</option>
                <option value="DRIVER_ALLOWANCE">Driver Allowance</option>
                <option value="DRIVER_BATA">Driver Bata</option>
                <option value="LOADING">Loading Charges</option>
                <option value="UNLOADING">Unloading Charges</option>
                <option value="REPAIR">Repair & Maintenance</option>
                <option value="EN_ROUTE_REPAIR">En-Route Repair</option>
                <option value="TYRE_PUNCTURE">Tyre & Puncture</option>
                <option value="RTO_POLICE">RTO / Transit Fees</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          )}

          {/* Audit Filters */}
          {activeReport === 'audit' && (
            <>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Action</label>
                <select
                  value={auditActionFilter}
                  onChange={(e) => setAuditActionFilter(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">All Actions</option>
                  <option value="CREATE">Create</option>
                  <option value="UPDATE">Update</option>
                  <option value="DELETE">Delete</option>
                  <option value="DISPATCH">Dispatch</option>
                  <option value="SETTLE">Settle</option>
                  <option value="APPROVE">Approve</option>
                  <option value="INVOICE">Invoice</option>
                  <option value="PAYMENT">Payment</option>
                  <option value="CANCEL">Cancel</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Module / Entity</label>
                <select
                  value={auditEntityFilter}
                  onChange={(e) => setAuditEntityFilter(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">All Modules</option>
                  <option value="TRIP">Trips</option>
                  <option value="JOURNAL_TRIP">Trips Journal</option>
                  <option value="DISPATCH">Dispatch</option>
                  <option value="EXPENSE">Expenses</option>
                  <option value="FUEL">Fuel</option>
                  <option value="ADVANCE">Advances</option>
                  <option value="SETTLEMENT">Settlements</option>
                  <option value="INVOICE">Invoices</option>
                  <option value="PAYMENT">Payments</option>
                  <option value="VEHICLE">Vehicles</option>
                  <option value="DRIVER">Drivers</option>
                  <option value="CUSTOMER">Customers</option>
                  <option value="DOCUMENT">Documents</option>
                  <option value="COMPANY">Company</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Search Summary</label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
                  <input
                    type="text"
                    value={auditSearchQuery}
                    onChange={(e) => setAuditSearchQuery(e.target.value)}
                    placeholder="Keyword or ID..."
                    className="w-full pl-8 pr-2 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {(activeReport === 'trips' ||
          activeReport === 'vehicles' ||
          activeReport === 'expenses' ||
          activeReport === 'monthly') && (
          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeJournalTrips}
                onChange={(e) => setIncludeJournalTrips(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
              <span>Include Trips Journal (Historical / Offline)</span>
            </label>
            <span className="text-[11px] text-slate-500">
              Kept separated from live operational metrics unless opted in
            </span>
          </div>
        )}
      </div>

      {/* Loading & Error States */}
      {loading && trips.length === 0 && vehicles.length === 0 && (
        <div className="py-16 text-center">
          <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs font-medium text-slate-500">Synchronizing Firestore records...</p>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
          {error}
        </div>
      )}

      {/* REPORT CONTENT VIEWS */}
      {!error && (
        <div className="space-y-6">
          {/* 1. TRIP REPORT */}
          {tripsReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Total Filtered Trips
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{tripsReport.summary.totalTrips}</span>
                </div>
                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Freight Revenue
                  </span>
                  <span className="text-2xl font-bold text-emerald-700">
                    {formatRupees(tripsReport.summary.totalFreightRevenuePaise)}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Recorded Direct Expenses
                  </span>
                  <span className="text-2xl font-bold text-rose-700">
                    {formatRupees(tripsReport.summary.totalExpensesPaise)}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-white border border-indigo-200 bg-indigo-50/40 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider block mb-1">
                      Trip Contribution
                    </span>
                    <span className="text-xs font-bold text-indigo-700">
                      {tripsReport.summary.overallMarginPercentage}%
                    </span>
                  </div>
                  <span className="text-2xl font-bold text-indigo-900">
                    {formatRupees(tripsReport.summary.totalTripContributionPaise)}
                  </span>
                  <span className="text-[10px] text-indigo-700 block mt-0.5 font-medium">Gross Operational Margin</span>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">Trip Performance Breakdown</h3>
                  <span className="text-xs text-slate-500">{tripsReport.trips.length} records</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold uppercase tracking-wider text-[11px]">
                        <th className="py-3 px-4">Trip #</th>
                        <th className="py-3 px-4">Customer</th>
                        <th className="py-3 px-4">Vehicle</th>
                        <th className="py-3 px-4">Driver</th>
                        <th className="py-3 px-4">Dispatch Date</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Freight Revenue</th>
                        <th className="py-3 px-4 text-right">Expenses</th>
                        <th className="py-3 px-4 text-right">Trip Contribution</th>
                        <th className="py-3 px-4 text-right">Margin %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {tripsReport.trips.length > 0 ? (
                        tripsReport.trips.map((row) => (
                          <tr key={row.tripId} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3 px-4 font-mono font-medium text-slate-900">
                              {row.tripNumber}
                              {row.lrNumber && (
                                <span className="block text-[10px] text-slate-400 font-sans">LR: {row.lrNumber}</span>
                              )}
                            </td>
                            <td className="py-3 px-4 font-medium text-slate-800">{row.customerName}</td>
                            <td className="py-3 px-4 font-mono text-slate-700">{row.vehicleRegistration}</td>
                            <td className="py-3 px-4 text-slate-700">{row.driverName}</td>
                            <td className="py-3 px-4 text-slate-600">{row.dispatchDate?.slice(0, 10)}</td>
                            <td className="py-3 px-4">
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                  row.status === 'COMPLETED' || row.status === 'DELIVERED' || row.status === 'SETTLED'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : row.status === 'IN_TRANSIT'
                                    ? 'bg-blue-100 text-blue-800'
                                    : row.status === 'CANCELLED'
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {row.status}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-medium text-slate-900">
                              {formatRupees(row.freightRevenuePaise)}
                            </td>
                            <td className="py-3 px-4 text-right text-rose-700 font-medium">
                              {formatRupees(row.totalExpensesPaise)}
                            </td>
                            <td className="py-3 px-4 text-right font-bold text-indigo-700">
                              {formatRupees(row.tripContributionPaise)}
                            </td>
                            <td className="py-3 px-4 text-right font-semibold text-slate-700">
                              {row.marginPercentage}%
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={10} className="py-8 text-center text-slate-400 italic">
                            No trips found matching the selected criteria.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 2. VEHICLE PERFORMANCE REPORT */}
          {vehiclesReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Fleet Vehicles Analyzed
                  </span>
                  <span className="text-2xl font-bold text-slate-900">{vehiclesReport.summary.totalVehicles}</span>
                </div>
                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Freight Generated
                  </span>
                  <span className="text-2xl font-bold text-emerald-700">
                    {formatRupees(vehiclesReport.summary.totalFreightRevenuePaise)}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Maintenance & Repairs
                  </span>
                  <span className="text-2xl font-bold text-rose-700">
                    {formatRupees(vehiclesReport.summary.totalMaintenanceCostsPaise)}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-white border border-indigo-200 bg-indigo-50/40 shadow-xs">
                  <span className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider block mb-1">
                    Fleet Trip Contribution
                  </span>
                  <span className="text-2xl font-bold text-indigo-900">
                    {formatRupees(vehiclesReport.summary.totalTripContributionPaise)}
                  </span>
                  <span className="text-[10px] text-indigo-700 block mt-0.5 font-medium">Gross Operational Margin</span>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">Vehicle Utilization & Unit Economics</h3>
                  <span className="text-xs text-slate-500">{vehiclesReport.vehicles.length} trucks</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold uppercase tracking-wider text-[11px]">
                        <th className="py-3 px-4">Vehicle Registration</th>
                        <th className="py-3 px-4">Model & Type</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-center">Total Trips</th>
                        <th className="py-3 px-4 text-right">Freight Revenue</th>
                        <th className="py-3 px-4 text-right">Recorded Expenses</th>
                        <th className="py-3 px-4 text-right">Maintenance Costs</th>
                        <th className="py-3 px-4 text-right">Trip Contribution</th>
                        <th className="py-3 px-4 text-right">FASTag Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {vehiclesReport.vehicles.length > 0 ? (
                        vehiclesReport.vehicles.map((row) => (
                          <tr key={row.vehicleId} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3 px-4 font-mono font-bold text-slate-900">
                              {row.registrationNumber}
                            </td>
                            <td className="py-3 px-4 text-slate-700">
                              {row.makeModel} <span className="text-slate-400 text-[10px]">({row.vehicleType})</span>
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                  row.status === 'AVAILABLE'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : row.status === 'IN_TRANSIT'
                                    ? 'bg-blue-100 text-blue-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {row.status}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-center font-semibold text-slate-900">{row.totalTrips}</td>
                            <td className="py-3 px-4 text-right font-medium text-slate-900">
                              {formatRupees(row.freightRevenuePaise)}
                            </td>
                            <td className="py-3 px-4 text-right text-rose-700 font-medium">
                              {formatRupees(row.recordedExpensesPaise)}
                            </td>
                            <td className="py-3 px-4 text-right font-semibold text-amber-800">
                              {formatRupees(row.maintenanceCostsPaise)}
                            </td>
                            <td className="py-3 px-4 text-right font-bold text-indigo-700">
                              {formatRupees(row.tripContributionPaise)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-slate-700">
                              {formatRupees(row.fastagBalancePaise)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-slate-400 italic">
                            No vehicles found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 3. EXPENSE REPORT */}
          {expensesReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {Object.entries(expensesReport.summary.categoryTotals).map(([cat, amt]) => (
                  <div key={cat} className="p-3 rounded-xl bg-white border border-slate-200 shadow-xs">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-0.5">
                      {cat.replace(/_/g, ' ')}
                    </span>
                    <span className="text-sm font-bold text-slate-900">{formatRupees(amt)}</span>
                  </div>
                ))}
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Direct Expense Ledger</h3>
                    <span className="text-xs text-slate-500">
                      Total: {formatRupees(expensesReport.summary.totalExpensePaise)} ({expensesReport.expenses.length} entries)
                    </span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold uppercase tracking-wider text-[11px]">
                        <th className="py-3 px-4">Date</th>
                        <th className="py-3 px-4">Category</th>
                        <th className="py-3 px-4">Vehicle</th>
                        <th className="py-3 px-4">Trip #</th>
                        <th className="py-3 px-4">Payment Method</th>
                        <th className="py-3 px-4">Notes</th>
                        <th className="py-3 px-4 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {expensesReport.expenses.length > 0 ? (
                        expensesReport.expenses.map((row) => (
                          <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3 px-4 text-slate-600">{row.date?.slice(0, 10)}</td>
                            <td className="py-3 px-4">
                              <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-800 uppercase">
                                {row.category.replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono font-medium text-slate-900">{row.vehicleRegistration}</td>
                            <td className="py-3 px-4 font-mono text-slate-700">{row.tripNumber}</td>
                            <td className="py-3 px-4 text-slate-600">{row.paymentMethod}</td>
                            <td className="py-3 px-4 text-slate-500 max-w-xs truncate">{row.notes || '—'}</td>
                            <td className="py-3 px-4 text-right font-bold text-rose-700">
                              {formatRupees(row.amountPaise)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-400 italic">
                            No expenses recorded matching the query.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 4. CUSTOMER RECEIVABLES REPORT */}
          {receivablesReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Total Invoiced
                  </span>
                  <span className="text-2xl font-bold text-slate-900">
                    {formatRupees(receivablesReport.summary.totalInvoicedPaise)}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Total Collections Received
                  </span>
                  <span className="text-2xl font-bold text-emerald-700">
                    {formatRupees(receivablesReport.summary.totalPaidPaise)}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Outstanding Balance
                  </span>
                  <span className="text-2xl font-bold text-amber-700">
                    {formatRupees(receivablesReport.summary.totalOutstandingBalancePaise)}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-rose-50/50 border border-rose-200 shadow-xs">
                  <span className="text-[11px] font-bold text-rose-900 uppercase tracking-wider block mb-1">
                    Overdue Balance
                  </span>
                  <span className="text-2xl font-bold text-rose-700">
                    {formatRupees(receivablesReport.summary.totalOverdueBalancePaise)}
                  </span>
                  <span className="text-[10px] text-rose-600 block mt-0.5 font-medium">Exceeded Customer Credit Terms</span>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">Customer Balance Aging Ledger</h3>
                  <span className="text-xs text-slate-500">{receivablesReport.customers.length} clients</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold uppercase tracking-wider text-[11px]">
                        <th className="py-3 px-4">Customer</th>
                        <th className="py-3 px-4">Contact / Phone</th>
                        <th className="py-3 px-4 text-center">Credit Terms</th>
                        <th className="py-3 px-4 text-center">Invoices</th>
                        <th className="py-3 px-4 text-right">Total Invoiced</th>
                        <th className="py-3 px-4 text-right">Total Paid</th>
                        <th className="py-3 px-4 text-right">Outstanding Balance</th>
                        <th className="py-3 px-4 text-right">Overdue Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {receivablesReport.customers.length > 0 ? (
                        receivablesReport.customers.map((row) => (
                          <tr key={row.customerId} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3 px-4 font-bold text-slate-900">{row.customerName}</td>
                            <td className="py-3 px-4 text-slate-600">
                              {row.contactPerson || 'Direct'}
                              {row.phone && <span className="block text-[10px] text-slate-400">{row.phone}</span>}
                            </td>
                            <td className="py-3 px-4 text-center font-medium text-slate-700">
                              {row.paymentTermsDays} Days
                            </td>
                            <td className="py-3 px-4 text-center font-semibold text-slate-800">{row.invoiceCount}</td>
                            <td className="py-3 px-4 text-right font-medium text-slate-900">
                              {formatRupees(row.totalInvoicedPaise)}
                            </td>
                            <td className="py-3 px-4 text-right text-emerald-700 font-medium">
                              {formatRupees(row.totalPaidPaise)}
                            </td>
                            <td className="py-3 px-4 text-right font-bold text-slate-900">
                              {formatRupees(row.outstandingBalancePaise)}
                            </td>
                            <td className="py-3 px-4 text-right font-bold text-rose-700">
                              {formatRupees(row.overdueBalancePaise)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-400 italic">
                            No receivables found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 5. MONTHLY PERFORMANCE REPORT */}
          {monthlyReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Total Freight Revenue
                  </span>
                  <span className="text-2xl font-bold text-emerald-700">
                    {formatRupees(monthlyReport.summary.totalFreightRevenuePaise)}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Total Direct Expenses
                  </span>
                  <span className="text-2xl font-bold text-rose-700">
                    {formatRupees(monthlyReport.summary.totalTripExpensesPaise)}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-white border border-indigo-200 bg-indigo-50/40 shadow-xs">
                  <span className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider block mb-1">
                    Total Trip Contribution
                  </span>
                  <span className="text-2xl font-bold text-indigo-900">
                    {formatRupees(monthlyReport.summary.totalTripContributionPaise)}
                  </span>
                  <span className="text-[10px] text-indigo-700 block mt-0.5 font-medium">Gross Operational Margin</span>
                </div>
                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Completed Trips
                  </span>
                  <span className="text-2xl font-bold text-slate-900">
                    {monthlyReport.summary.totalCompletedTrips}
                  </span>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">Monthly Operational & Margin Trends</h3>
                  <span className="text-xs text-slate-500">{monthlyReport.months.length} months period</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold uppercase tracking-wider text-[11px]">
                        <th className="py-3 px-4">Billing Month</th>
                        <th className="py-3 px-4 text-center">Completed Trips</th>
                        <th className="py-3 px-4 text-center">Active Trucks Deployed</th>
                        <th className="py-3 px-4 text-right">Freight Revenue</th>
                        <th className="py-3 px-4 text-right">Trip Expenses</th>
                        <th className="py-3 px-4 text-right">Trip Contribution</th>
                        <th className="py-3 px-4 text-right">Outstanding Invoices</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {monthlyReport.months.length > 0 ? (
                        monthlyReport.months.map((row) => (
                          <tr key={row.monthKey} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3 px-4 font-bold text-slate-900">{row.monthLabel}</td>
                            <td className="py-3 px-4 text-center font-semibold text-slate-800">
                              {row.completedTripsCount}
                            </td>
                            <td className="py-3 px-4 text-center font-mono font-medium text-slate-700">
                              {row.activeVehiclesCount} Trucks
                            </td>
                            <td className="py-3 px-4 text-right font-medium text-slate-900">
                              {formatRupees(row.freightRevenuePaise)}
                            </td>
                            <td className="py-3 px-4 text-right text-rose-700 font-medium">
                              {formatRupees(row.recordedExpensesPaise)}
                            </td>
                            <td className="py-3 px-4 text-right font-bold text-indigo-700">
                              {formatRupees(row.tripContributionPaise)}
                            </td>
                            <td className="py-3 px-4 text-right font-semibold text-amber-700">
                              {formatRupees(row.outstandingInvoicesPaise)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-400 italic">
                            No historical monthly data found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 6. AUDIT TRAIL REPORT */}
          {activeReport === 'audit' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Immutable Owner Activity & Financial Audit Log</h3>
                  <span className="text-xs text-slate-500">
                    {filteredAuditLogs.length} recorded actions
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold uppercase tracking-wider text-[11px]">
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">Action</th>
                      <th className="py-3 px-4">Module / Entity</th>
                      <th className="py-3 px-4">Summary</th>
                      <th className="py-3 px-4">Actor</th>
                      <th className="py-3 px-4">Change Snapshot</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAuditLogs.length > 0 ? (
                      filteredAuditLogs.slice(0, 150).map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                            {log.timestamp ? new Date(log.timestamp).toLocaleString('en-IN') : '—'}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                log.action === 'DELETE' || log.action === 'CANCEL'
                                  ? 'bg-rose-100 text-rose-800'
                                  : log.action === 'APPROVE' || log.action === 'PAYMENT'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-indigo-100 text-indigo-800'
                              }`}
                            >
                              {log.action}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-semibold text-slate-800 block">
                              {log.moduleName || log.entityType}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">{log.entityId}</span>
                          </td>
                          <td className="py-3 px-4 text-slate-800 max-w-md">{log.summary}</td>
                          <td className="py-3 px-4 text-slate-600">{log.userName || 'Owner'}</td>
                          <td className="py-3 px-4 text-[11px] font-mono text-slate-500 max-w-xs truncate">
                            {log.updatedValues
                              ? Object.entries(log.updatedValues)
                                  .slice(0, 3)
                                  .map(([k, v]) => `${k}: ${String(v)}`)
                                  .join(' • ')
                              : '—'}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400 italic">
                          No audit log entries match the active filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* OPT-IN TRIPS JOURNAL (HISTORICAL / OFFLINE) BREAKDOWN */}
          {includeJournalTrips &&
            (activeReport === 'trips' ||
              activeReport === 'vehicles' ||
              activeReport === 'expenses' ||
              activeReport === 'monthly') && (
              <div className="bg-white rounded-xl border border-indigo-200 shadow-xs overflow-hidden">
                <div className="p-4 border-b border-indigo-100 bg-indigo-50/40 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-indigo-700" />
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Trips Journal (Historical / Offline) — Opt-In Breakdown
                      </h3>
                      <p className="text-[11px] text-slate-600">
                        Completed historical & offline journal entries only (cancelled records excluded)
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-indigo-800">
                    {journalReportLoading
                      ? 'Loading journal records...'
                      : `${optInJournalStats.completedTripsCount} completed journal trip(s)`}
                  </span>
                </div>

                <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 border-b border-slate-100">
                  <div className="p-3 rounded-lg border border-slate-200 bg-white">
                    <span className="text-[11px] font-semibold uppercase text-slate-500 block">
                      Journal Freight Revenue
                    </span>
                    <span className="text-lg font-bold text-emerald-700 tabular-nums">
                      {formatRupees(optInJournalStats.totalFreightRevenuePaise)}
                    </span>
                  </div>
                  <div className="p-3 rounded-lg border border-slate-200 bg-white">
                    <span className="text-[11px] font-semibold uppercase text-slate-500 block">
                      Journal Trip Expenses
                    </span>
                    <span className="text-lg font-bold text-rose-700 tabular-nums">
                      {formatRupees(optInJournalStats.totalExpensesPaise)}
                    </span>
                  </div>
                  <div className="p-3 rounded-lg border border-indigo-200 bg-indigo-50/40">
                    <span className="text-[11px] font-bold uppercase text-indigo-900 block">
                      Journal Net Profit
                    </span>
                    <span className="text-lg font-bold text-indigo-900 tabular-nums">
                      {formatRupees(optInJournalStats.totalProfitPaise)}
                    </span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold uppercase tracking-wider text-[11px]">
                        <th className="py-3 px-4">Journal Trip ID</th>
                        <th className="py-3 px-4">Trip Date</th>
                        <th className="py-3 px-4">Vehicle</th>
                        <th className="py-3 px-4">Driver</th>
                        <th className="py-3 px-4">Customer</th>
                        <th className="py-3 px-4">Route</th>
                        <th className="py-3 px-4">Entry Type</th>
                        <th className="py-3 px-4 text-right">Freight</th>
                        <th className="py-3 px-4 text-right">Expenses</th>
                        <th className="py-3 px-4 text-right">Profit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {optInJournalTrips.length > 0 ? (
                        optInJournalTrips.map((jt) => (
                          <tr key={jt.journalTripId} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-4 font-mono font-semibold text-indigo-700">
                              {jt.journalTripId}
                            </td>
                            <td className="py-2.5 px-4 text-slate-600">
                              {jt.tripDate ? new Date(jt.tripDate).toLocaleDateString('en-IN') : '—'}
                            </td>
                            <td className="py-2.5 px-4 font-mono font-medium text-slate-900">
                              {jt.vehicleNumber}
                            </td>
                            <td className="py-2.5 px-4 text-slate-700">{jt.driverName}</td>
                            <td className="py-2.5 px-4 text-slate-800 font-medium">{jt.customerName}</td>
                            <td className="py-2.5 px-4 text-slate-600">
                              {jt.fromLocation} → {jt.toLocation}
                            </td>
                            <td className="py-2.5 px-4 text-slate-600">
                              {JOURNAL_ENTRY_TYPE_LABELS[jt.entryType] || jt.entryType}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-900">
                              {formatRupees(jt.freightAmountPaise)}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums text-rose-700">
                              {formatRupees(jt.totalExpensesPaise)}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono font-bold tabular-nums text-indigo-800">
                              {formatRupees(jt.profitPaise)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={10} className="py-6 text-center text-slate-400 italic">
                            {journalReportLoading
                              ? 'Loading Trips Journal entries...'
                              : 'No completed Trips Journal records match the active filters.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
};
