/**
 * AnchorTransport TMS - Professional Fleet Command Dashboard (Phase 4)
 * 
 * Features:
 * - 8 Required Metrics:
 *   1. Active trips
 *   2. Completed trips
 *   3. Freight revenue
 *   4. Recorded trip expenses
 *   5. Trip contribution (Gross fleet margin + %)
 *   6. Outstanding invoices (Receivables + open counts)
 *   7. Recent trips (High-density table with mobile card fallback)
 *   8. Vehicles requiring attention (Documents expiring/expired, in garage, low FastTag)
 * - Complete states: Loading skeleton, Error alert, Empty state
 * - Date Range Filter: All Time, Today, This Week, This Month, This Quarter, Custom Range
 * - Test mode toggle: Switch between Real Seed Data and Clean Slate (Empty State)
 * - Strict company-scoped data queries
 */

import React, { useState, useMemo } from 'react';
import {
  TrendingUp,
  Fuel,
  IndianRupee,
  Truck,
  AlertTriangle,
  ArrowRight,
  Calendar,
  Plus,
  FileText,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ShieldAlert,
} from 'lucide-react';
import { Trip, UserRole } from '../../types/tms';
import { formatINR } from '../../lib/currency';
import { useAuth } from '../../context/AuthContext';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import { Badge, BadgeVariant } from '../../components/ui/Badge';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { clearCompanyOperationalDataInFirestore } from '../../lib/firebase/firestoreService';
import { clearClientTmsCaches } from '../../lib/storage';
import { computeDashboardMetrics, type DatePeriod } from '../../lib/tmsCalculations';

export type { DatePeriod };

interface DashboardViewProps {
  onQuickDispatch: () => void;
  onNavigateTab: (tab: any) => void;
  userRole: UserRole;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onQuickDispatch,
  onNavigateTab,
}) => {
  const { permissions } = useAuth();
  const {
    company,
    trips,
    vehicles,
    expenses,
    invoices,
    documents,
    loading,
    error: fsError,
    clearError,
  } = useFirestoreData();

  const companyId = company?.id || '';

  // Filter State
  const [period, setPeriod] = useState<DatePeriod>('all');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const [showCustomPicker, setShowCustomPicker] = useState<boolean>(false);

  const [localError, setLocalError] = useState<string | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [isClearDialogOpen, setIsClearDialogOpen] = useState<boolean>(false);

  const error = localError || fsError;

  const metrics = useMemo(
    () =>
      computeDashboardMetrics({
        trips,
        vehicles,
        expenses,
        invoices,
        documents,
        period,
        customStart,
        customEnd,
      }),
    [trips, vehicles, expenses, invoices, documents, period, customStart, customEnd]
  );

  const handlePeriodChange = (newPeriod: DatePeriod) => {
    setPeriod(newPeriod);
    if (newPeriod === 'custom') {
      setShowCustomPicker(true);
    } else {
      setShowCustomPicker(false);
    }
  };

  const handleApplyCustomDate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customStart) return;
    setPeriod('custom');
  };

  // Clear data for clean slate (OWNER / ADMIN only)
  const confirmClearData = async () => {
    if (!companyId) return;
    setActionLoading(true);
    setLocalError(null);
    try {
      await clearCompanyOperationalDataInFirestore(companyId);
      clearClientTmsCaches();
      setActionSuccessMsg('Fleet records cleared in Firestore. Viewing empty workspace.');
      setTimeout(() => setActionSuccessMsg(null), 3500);
    } catch (e: any) {
      setLocalError(e.message || 'Failed to clear data.');
    } finally {
      setActionLoading(false);
      setIsClearDialogOpen(false);
    }
  };

  // Status badge mapping for trips
  const getTripBadge = (status: Trip['status']): { label: string; variant: BadgeVariant } => {
    switch (status) {
      case 'PLANNED':
        return { label: 'Planned', variant: 'slate' };
      case 'DISPATCHED':
        return { label: 'Dispatched', variant: 'info' };
      case 'IN_TRANSIT':
        return { label: 'In Transit', variant: 'purple' };
      case 'DELIVERED':
        return { label: 'Delivered', variant: 'warning' };
      case 'SETTLED':
        return { label: 'Settled', variant: 'success' };
      case 'CANCELLED':
        return { label: 'Cancelled', variant: 'danger' };
      default:
        return { label: status, variant: 'slate' };
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Action Notification */}
      {actionSuccessMsg && (
        <div className="p-3 bg-emerald-900/90 text-emerald-100 rounded-lg text-xs font-medium flex items-center justify-between border border-emerald-700 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-300" />
            <span>{actionSuccessMsg}</span>
          </div>
          <button onClick={() => setActionSuccessMsg(null)} className="text-emerald-300 hover:text-white text-xs">
            &times;
          </button>
        </div>
      )}

      {/* Header & Date Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900">
                Fleet Command Cockpit
              </h2>
              <span className="text-xs text-slate-400 font-mono hidden sm:inline">
                [{company?.name || 'AnchorTransport'}]
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Real-time operational logistics, consignment progress, and cash margins
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {permissions?.canManageCompany && (
              <button
                onClick={() => setIsClearDialogOpen(true)}
                disabled={actionLoading}
                className="px-3 py-2 border border-slate-200 bg-slate-50 text-slate-600 hover:text-rose-700 hover:border-rose-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                title="Clear all operational records for this company"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                <span className="hidden sm:inline">Clear Fleet Data</span>
                <span className="sm:hidden">Clear</span>
              </button>
            )}

            <button
              onClick={onQuickDispatch}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Dispatch Consignment</span>
            </button>
          </div>
        </div>

        {/* Date Filter Bar */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs font-medium text-slate-500 mr-2 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>Period:</span>
            </span>

            {(
              [
                { id: 'all', label: 'All Time' },
                { id: 'today', label: 'Today' },
                { id: 'week', label: 'This Week' },
                { id: 'month', label: 'This Month' },
                { id: 'quarter', label: 'This Quarter' },
                { id: 'custom', label: 'Custom' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                onClick={() => handlePeriodChange(item.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  period === item.id
                    ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Active Period Display */}
          <div className="text-xs text-slate-500">
            {period === 'all' && <span>Showing all lifetime company consignments</span>}
            {period === 'today' && <span>Showing today&apos;s consignments</span>}
            {period === 'week' && <span>Showing current calendar week</span>}
            {period === 'month' && <span>Showing current month records</span>}
            {period === 'quarter' && <span>Showing current quarter (90 days)</span>}
          </div>
        </div>

        {/* Custom Date Range Picker */}
        {showCustomPicker && (
          <form
            onSubmit={handleApplyCustomDate}
            className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200 flex flex-wrap items-center gap-3 text-xs"
          >
            <div className="flex items-center gap-2">
              <label htmlFor="custom-start" className="font-medium text-slate-700">From:</label>
              <input
                id="custom-start"
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="bg-white border border-slate-300 rounded px-2.5 py-1 text-slate-800"
                required
              />
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="custom-end" className="font-medium text-slate-700">To:</label>
              <input
                id="custom-end"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="bg-white border border-slate-300 rounded px-2.5 py-1 text-slate-800"
              />
            </div>

            <button
              type="submit"
              className="px-3 py-1 bg-slate-900 text-white font-medium rounded hover:bg-slate-800 transition-colors"
            >
              Apply Filter
            </button>
          </form>
        )}
      </div>

      {/* ERROR STATE */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-bold text-rose-900">Firestore Sync Notice</h4>
            <p className="text-xs text-rose-700 mt-0.5">{error}</p>
            <button
              onClick={() => {
                setLocalError(null);
                clearError();
              }}
              className="mt-2 text-xs font-semibold text-rose-900 underline hover:text-rose-950"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* LOADING SKELETON STATE */}
      {loading ? (
        <div className="space-y-6 animate-pulse">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-28 bg-white border border-slate-200 rounded-xl p-4 space-y-2">
                <div className="w-20 h-3 bg-slate-200 rounded" />
                <div className="w-28 h-6 bg-slate-300 rounded" />
                <div className="w-16 h-3 bg-slate-100 rounded" />
              </div>
            ))}
          </div>
          <div className="h-44 bg-white border border-slate-200 rounded-xl p-5" />
          <div className="h-64 bg-white border border-slate-200 rounded-xl p-5" />
        </div>
      ) : (
        <>
          {/* EMPTY STATE (When company has zero records) */}
          {!metrics.hasData ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 sm:p-12 text-center space-y-4 shadow-xs">
              <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center mx-auto">
                <Truck className="w-8 h-8 text-indigo-600" />
              </div>

              <div className="max-w-md mx-auto space-y-1">
                <h3 className="text-base sm:text-lg font-bold text-slate-900">
                  No Logistics Data for This Company
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
                  You are viewing an empty company context. Once you register vehicles, assign drivers, and dispatch consignments, live trips and freight profitability will appear here.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  onClick={onQuickDispatch}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Dispatch First Consignment</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* 6 PRIMARY DASHBOARD METRIC TILES */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
                {/* 1. Active Trips */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs hover:border-slate-300 transition-all">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Active Trips</span>
                    <Truck className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-2xl font-bold tracking-tight text-slate-900 font-mono tabular-nums">
                      {metrics.activeTripsCount}
                    </span>
                    <span className="text-[11px] text-slate-400">on route</span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500 flex items-center justify-between pt-2 border-t border-slate-100">
                    <span>Moving fleet</span>
                    <span className="font-semibold text-indigo-700 font-mono">
                      {metrics.totalVehiclesCount > 0
                        ? `${Math.round((metrics.activeTripsCount / metrics.totalVehiclesCount) * 100)}%`
                        : '0%'}
                    </span>
                  </div>
                </div>

                {/* 2. Completed Trips */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs hover:border-slate-300 transition-all">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Completed Trips</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-2xl font-bold tracking-tight text-slate-900 font-mono tabular-nums">
                      {metrics.completedTripsCount}
                    </span>
                    <span className="text-[11px] text-slate-400">delivered</span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500 flex items-center justify-between pt-2 border-t border-slate-100">
                    <span>Total trips</span>
                    <span className="font-semibold text-slate-800 font-mono">{metrics.totalTripsCount}</span>
                  </div>
                </div>

                {/* 3. Freight Revenue */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs hover:border-slate-300 transition-all">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Freight Revenue</span>
                    <TrendingUp className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="mt-2">
                    <span className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 font-mono tabular-nums block truncate">
                      {formatINR(metrics.totalFreightRevenuePaise)}
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500 flex items-center justify-between pt-2 border-t border-slate-100">
                    <span>Billing gross</span>
                    <span className="text-slate-600 font-medium">{period}</span>
                  </div>
                </div>

                {/* 4. Recorded Trip Expenses */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs hover:border-slate-300 transition-all">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Trip Expenses</span>
                    <Fuel className="w-4 h-4 text-rose-600" />
                  </div>
                  <div className="mt-2">
                    <span className="text-xl sm:text-2xl font-bold tracking-tight text-rose-700 font-mono tabular-nums block truncate">
                      {formatINR(metrics.totalRecordedExpensesPaise)}
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500 flex items-center justify-between pt-2 border-t border-slate-100">
                    <span>Diesel, toll &amp; bata</span>
                    <span className="text-rose-600 font-mono">
                      {metrics.totalFreightRevenuePaise > 0
                        ? `${Math.round((metrics.totalRecordedExpensesPaise / metrics.totalFreightRevenuePaise) * 100)}%`
                        : '0%'}
                    </span>
                  </div>
                </div>

                {/* 5. Trip Contribution */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs hover:border-slate-300 transition-all">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Trip Contribution</span>
                    <IndianRupee className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="mt-2">
                    <span
                      className={`text-xl sm:text-2xl font-bold tracking-tight font-mono tabular-nums block truncate ${
                        metrics.tripContributionPaise >= 0 ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {formatINR(metrics.tripContributionPaise)}
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500 flex items-center justify-between pt-2 border-t border-slate-100">
                    <span>Operating Margin</span>
                    <span className="font-bold text-emerald-700 font-mono">
                      {metrics.contributionMarginPercent}%
                    </span>
                  </div>
                </div>

                {/* 6. Outstanding Invoices */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs hover:border-slate-300 transition-all">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Unpaid Invoices</span>
                    <FileText className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="mt-2">
                    <span className="text-xl sm:text-2xl font-bold tracking-tight text-amber-800 font-mono tabular-nums block truncate">
                      {formatINR(metrics.outstandingInvoicesPaise)}
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500 flex items-center justify-between pt-2 border-t border-slate-100">
                    <span>Open Bills</span>
                    <button
                      onClick={() => onNavigateTab('invoices')}
                      className="font-bold text-amber-800 hover:underline font-mono"
                    >
                      {metrics.outstandingInvoicesCount} invoices &rarr;
                    </button>
                  </div>
                </div>
              </div>

              {/* OPERATIONAL MARGIN & REVENUE BREAKDOWN STRIP */}
              {metrics.totalFreightRevenuePaise > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                        Operational Freight Margin Distribution
                      </h3>
                      <p className="text-xs text-slate-500">
                        Visual breakdown of total freight earnings absorbed by direct road costs vs. retained margin
                      </p>
                    </div>
                    <div className="text-xs font-mono font-medium text-slate-600">
                      Total Freight: <span className="font-bold text-slate-900">{formatINR(metrics.totalFreightRevenuePaise)}</span>
                    </div>
                  </div>

                  {/* Proportional Margin Bar */}
                  <div className="h-5 rounded-lg bg-slate-100 flex overflow-hidden border border-slate-200">
                    {/* Fuel & Expenses */}
                    <div
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round((metrics.totalRecordedExpensesPaise / metrics.totalFreightRevenuePaise) * 100)
                        )}%`,
                      }}
                      className="bg-rose-500 transition-all duration-500 flex items-center justify-center text-[10px] text-white font-bold"
                      title={`Direct Expenses: ${formatINR(metrics.totalRecordedExpensesPaise)}`}
                    >
                      {Math.round((metrics.totalRecordedExpensesPaise / metrics.totalFreightRevenuePaise) * 100) > 15 && (
                        <span>
                          Expenses {Math.round((metrics.totalRecordedExpensesPaise / metrics.totalFreightRevenuePaise) * 100)}%
                        </span>
                      )}
                    </div>

                    {/* Net Margin */}
                    <div
                      style={{
                        width: `${Math.max(
                          0,
                          100 - Math.round((metrics.totalRecordedExpensesPaise / metrics.totalFreightRevenuePaise) * 100)
                        )}%`,
                      }}
                      className="bg-emerald-600 transition-all duration-500 flex items-center justify-center text-[10px] text-white font-bold"
                      title={`Net Contribution: ${formatINR(metrics.tripContributionPaise)}`}
                    >
                      {100 - Math.round((metrics.totalRecordedExpensesPaise / metrics.totalFreightRevenuePaise) * 100) > 15 && (
                        <span>
                          Retained {100 - Math.round((metrics.totalRecordedExpensesPaise / metrics.totalFreightRevenuePaise) * 100)}%
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Clean unboxed legend with typographic separators */}
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                      <span>Direct Road Expenses: <strong className="text-slate-900 font-mono">{formatINR(metrics.totalRecordedExpensesPaise)}</strong></span>
                    </div>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
                      <span>Gross Operational Contribution: <strong className="text-slate-900 font-mono">{formatINR(metrics.tripContributionPaise)}</strong></span>
                    </div>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <div>
                      <span>Net Contribution Rate: <strong className="text-emerald-700 font-mono">{metrics.contributionMarginPercent}%</strong></span>
                    </div>
                  </div>
                </div>
              )}

              {/* 8. VEHICLES REQUIRING ATTENTION */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold">
                      <ShieldAlert className="w-4 h-4 text-amber-800" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        <span>Vehicles Requiring Attention</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-mono font-semibold">
                          {metrics.vehiclesRequiringAttention.length}
                        </span>
                      </h3>
                      <p className="text-xs text-slate-500">
                        Critical compliance documents, scheduled garage maintenance, and FastTag deficits
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => onNavigateTab('documents')}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 self-start sm:self-auto"
                  >
                    <span>Document Vault</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {metrics.vehiclesRequiringAttention.length === 0 ? (
                  <div className="p-6 text-center space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      All Fleet Trucks Are Road-Ready
                    </h4>
                    <p className="text-xs text-slate-500">
                      No expired documents, maintenance hold-ups, or depleted FastTag balances found for this fleet.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {metrics.vehiclesRequiringAttention.map((veh) => (
                      <div
                        key={veh.vehicleId}
                        className="p-4 sm:p-5 hover:bg-slate-50/80 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold font-mono text-slate-900 text-sm">
                              {veh.registrationNumber}
                            </span>
                            <span className="text-xs text-slate-500">· {veh.makeModel}</span>
                            <Badge
                              variant={veh.status === 'UNDER_MAINTENANCE' ? 'danger' : 'slate'}
                              size="sm"
                            >
                              {veh.status === 'UNDER_MAINTENANCE' ? 'In Garage' : veh.status}
                            </Badge>
                          </div>

                          {/* Issues list */}
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            {veh.issues.map((iss, iIdx) => (
                              <span
                                key={iIdx}
                                className={`text-xs px-2.5 py-1 rounded-md font-medium flex items-center gap-1.5 ${
                                  iss.severity === 'critical'
                                    ? 'bg-rose-50 text-rose-800 border border-rose-200'
                                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                                }`}
                              >
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                <span>{iss.title}: {iss.description}</span>
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right hidden sm:block">
                            <span className="text-[11px] text-slate-400 block">FastTag Balance</span>
                            <span
                              className={`text-xs font-mono font-bold ${
                                veh.fastagBalancePaise < 150000 ? 'text-amber-700' : 'text-slate-800'
                              }`}
                            >
                              {formatINR(veh.fastagBalancePaise)}
                            </span>
                          </div>

                          <button
                            onClick={() => onNavigateTab('vehicles')}
                            className="px-3 py-1.5 border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-lg transition-colors"
                          >
                            Manage Truck
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 7. RECENT TRIPS TABLE (WITH RESPONSIVE ADAPTATION) */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Recent Fleet Consignments
                    </h3>
                    <p className="text-xs text-slate-500">
                      Showing latest active and completed road trips for {company?.name}
                    </p>
                  </div>

                  <button
                    onClick={() => onNavigateTab('trips')}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 self-start sm:self-auto"
                  >
                    <span>View All Trips</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {metrics.recentTrips.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <p className="text-xs text-slate-500">
                      No consignments found for the selected date filter.
                    </p>
                    <button
                      onClick={() => handlePeriodChange('all')}
                      className="text-xs font-bold text-indigo-600 hover:underline"
                    >
                      Clear Date Filter
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Desktop Table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left text-xs text-slate-700">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                          <tr>
                            <th className="px-4 py-3">Trip &amp; LR #</th>
                            <th className="px-4 py-3">Route / Goods</th>
                            <th className="px-4 py-3">Truck &amp; Driver</th>
                            <th className="px-4 py-3">Customer Party</th>
                            <th className="px-4 py-3 text-right">Freight</th>
                            <th className="px-4 py-3 text-right">Expenses</th>
                            <th className="px-4 py-3 text-right">Contribution</th>
                            <th className="px-4 py-3 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-normal">
                          {metrics.recentTrips.map((trip) => {
                            const badge = getTripBadge(trip.status);
                            const contr = (trip.totalRevenuePaise || trip.freightAmountPaise) - (trip.totalExpensesPaise || 0);

                            return (
                              <tr key={trip.id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="px-4 py-3">
                                  <span className="font-bold text-slate-900 block">{trip.tripNumber}</span>
                                  <span className="text-[11px] text-slate-500 font-mono">LR: {trip.lrNumber}</span>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-1 font-medium text-slate-900">
                                    <span>{trip.originCity?.split(',')[0]}</span>
                                    <ArrowRight className="w-3 h-3 text-slate-400" />
                                    <span>{trip.destinationCity?.split(',')[0]}</span>
                                  </div>
                                  <span className="text-[11px] text-slate-500">
                                    {trip.goodsType} ({trip.weightTonnes} MT)
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className="font-semibold text-slate-900 block font-mono">
                                    {trip.vehicleReg}
                                  </span>
                                  <span className="text-slate-600 text-[11px]">{trip.driverName}</span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className="font-medium text-slate-800 line-clamp-1">
                                    {trip.customerName}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                                  {formatINR(trip.totalRevenuePaise || trip.freightAmountPaise)}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-rose-700">
                                  {formatINR(trip.totalExpensesPaise || 0)}
                                </td>
                                <td className="px-4 py-3 text-right font-mono font-bold text-emerald-700">
                                  {formatINR(contr)}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <Badge variant={badge.variant} dot size="sm">
                                    {badge.label}
                                  </Badge>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Card List (md:hidden) */}
                    <div className="md:hidden divide-y divide-slate-100">
                      {metrics.recentTrips.map((trip) => {
                        const badge = getTripBadge(trip.status);
                        const contr = (trip.totalRevenuePaise || trip.freightAmountPaise) - (trip.totalExpensesPaise || 0);

                        return (
                          <div key={trip.id} className="p-4 space-y-2.5">
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="font-bold text-sm text-slate-900">{trip.tripNumber}</span>
                                <span className="text-xs text-slate-500 font-mono block">LR: {trip.lrNumber}</span>
                              </div>
                              <Badge variant={badge.variant} dot size="sm">
                                {badge.label}
                              </Badge>
                            </div>

                            <div className="flex items-center gap-1 font-medium text-xs text-slate-800">
                              <span>{trip.originCity?.split(',')[0]}</span>
                              <ArrowRight className="w-3 h-3 text-slate-400" />
                              <span>{trip.destinationCity?.split(',')[0]}</span>
                              <span className="text-slate-400">·</span>
                              <span className="text-slate-500 font-normal">{trip.goodsType}</span>
                            </div>

                            <div className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                              <div>
                                <span className="text-slate-400 block text-[10px]">Truck / Driver</span>
                                <span className="font-mono font-bold text-slate-800">{trip.vehicleReg}</span>
                              </div>

                              <div className="text-right">
                                <span className="text-slate-400 block text-[10px]">Freight (Gross)</span>
                                <span className="font-mono font-bold text-slate-900">
                                  {formatINR(trip.totalRevenuePaise || trip.freightAmountPaise)}
                                </span>
                              </div>

                              <div className="text-right">
                                <span className="text-slate-400 block text-[10px]">Contribution</span>
                                <span className="font-mono font-bold text-emerald-700">
                                  {formatINR(contr)}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={isClearDialogOpen}
        title="Clear All Operational Records?"
        message="This will remove all vehicles, drivers, customers, trips, expenses, advances, settlements, and invoices for this company from Firestore and local storage."
        confirmLabel="Yes, Clear All Data"
        cancelLabel="Cancel"
        variant="danger"
        isLoading={actionLoading}
        onConfirm={confirmClearData}
        onClose={() => setIsClearDialogOpen(false)}
      />
    </div>
  );
};
