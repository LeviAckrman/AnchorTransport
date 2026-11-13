import React, { useState, useEffect } from 'react';
import {
  Building2,
  TrendingUp,
  AlertCircle,
  Clock,
  ArrowUpRight,
  Receipt,
  CreditCard,
  ChevronRight,
  Info,
  Calendar,
} from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { formatINR } from '../../lib/financialEngine';
import { parseResponseJson } from '../../lib/safeFetch';
import { useAuth } from '../../context/AuthContext';

interface CustomerReportItem {
  customerId: string;
  customerName: string;
  gstin?: string;
  phone?: string;
  paymentTermsDays: number;
  creditLimitPaise: number;
  totalInvoicesCount: number;
  totalBilledPaise: number;
  totalPaidPaise: number;
  outstandingPaise: number;
  overduePaise: number;
  overdueCount: number;
  aging: {
    bucket0to30Paise: number;
    bucket31to60Paise: number;
    bucket61to90Paise: number;
    bucket90PlusPaise: number;
  };
  recentInvoices: any[];
  recentPayments: any[];
}

interface ReceivablesSummary {
  totalReceivablesPaise: number;
  totalOverduePaise: number;
  overdueInvoicesCount: number;
  totalBilledPaise: number;
  totalCollectedPaise: number;
  totalCustomersWithDues: number;
}

interface CustomerReceivablesReportProps {
  onSelectCustomer?: (customerId: string) => void;
}

export const CustomerReceivablesReport: React.FC<CustomerReceivablesReportProps> = ({
  onSelectCustomer,
}) => {
  const { token, company } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ReceivablesSummary | null>(null);
  const [customers, setCustomers] = useState<CustomerReportItem[]>([]);
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState('');

  useEffect(() => {
    fetchReport();
  }, [token, company?.id]);

  useEffect(() => {
    const handleRefresh = () => {
      fetchReport();
    };
    window.addEventListener('tms:firestore-hydrated', handleRefresh);
    window.addEventListener('tms:invoice-updated', handleRefresh);
    window.addEventListener('tms:payment-updated', handleRefresh);
    return () => {
      window.removeEventListener('tms:firestore-hydrated', handleRefresh);
      window.removeEventListener('tms:invoice-updated', handleRefresh);
      window.removeEventListener('tms:payment-updated', handleRefresh);
    };
  }, [token, company?.id]);

  const fetchReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/reports/receivables', {
        headers: { Authorization: `Bearer ${token || ''}` },
      });
      const data = await parseResponseJson(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch receivables report');
      }
      setSummary(data.summary);
      setCustomers(data.customers || []);
      setDisclaimer(data.disclaimer || '');
    } catch (err: any) {
      setError(err.message || 'Receivables report load error');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center text-xs text-slate-500 animate-pulse">
        Generating customer accounts receivables & aging ledger...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
              Total Receivables
            </span>
            <div className="flex items-baseline justify-between">
              <span className="text-xl font-bold text-slate-900">
                {formatINR(summary.totalReceivablesPaise)}
              </span>
              <span className="text-[11px] font-semibold text-slate-500">
                {summary.totalCustomersWithDues} parties
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Total outstanding across all accounts</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
            <span className="text-xs font-semibold text-rose-600 uppercase tracking-wider block mb-1">
              Overdue Balances
            </span>
            <div className="flex items-baseline justify-between">
              <span className="text-xl font-bold text-rose-700">
                {formatINR(summary.totalOverduePaise)}
              </span>
              <Badge variant={summary.overdueInvoicesCount > 0 ? 'danger' : 'neutral'}>
                {summary.overdueInvoicesCount} overdue bills
              </Badge>
            </div>
            <p className="text-[11px] text-rose-500 mt-1">Exceeded customer payment credit terms</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
              Total Invoiced (Billed)
            </span>
            <div className="flex items-baseline justify-between">
              <span className="text-xl font-bold text-indigo-700">
                {formatINR(summary.totalBilledPaise)}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Gross active freight billing</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
            <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider block mb-1">
              Total Collections
            </span>
            <div className="flex items-baseline justify-between">
              <span className="text-xl font-bold text-emerald-700">
                {formatINR(summary.totalCollectedPaise)}
              </span>
            </div>
            <p className="text-[11px] text-emerald-600 mt-1">Payments deposited & reconciled</p>
          </div>
        </div>
      )}

      {/* Customer Accounts Breakdown */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">Customer Aging & Receivables Ledger</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Breakdown of outstanding dues by aging buckets (0-30, 31-60, 61-90, 90+ days)
            </p>
          </div>
          <button
            onClick={fetchReport}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Customer Party</th>
                <th className="py-3 px-3 text-right">0-30 Days</th>
                <th className="py-3 px-3 text-right">31-60 Days</th>
                <th className="py-3 px-3 text-right">61-90 Days</th>
                <th className="py-3 px-3 text-right">90+ Days</th>
                <th className="py-3 px-3 text-right text-rose-600">Overdue</th>
                <th className="py-3 px-4 text-right font-bold text-slate-900">Total Dues</th>
                <th className="py-3 px-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.map((c) => {
                const isExpanded = expandedCustomerId === c.customerId;
                return (
                  <React.Fragment key={c.customerId}>
                    <tr className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{c.customerName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {c.gstin || 'Unregistered'} • Terms: {c.paymentTermsDays}d
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right text-slate-700">
                        {c.aging.bucket0to30Paise > 0 ? formatINR(c.aging.bucket0to30Paise) : '—'}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-700">
                        {c.aging.bucket31to60Paise > 0 ? formatINR(c.aging.bucket31to60Paise) : '—'}
                      </td>
                      <td className="py-3 px-3 text-right text-amber-700">
                        {c.aging.bucket61to90Paise > 0 ? formatINR(c.aging.bucket61to90Paise) : '—'}
                      </td>
                      <td className="py-3 px-3 text-right text-rose-700 font-medium">
                        {c.aging.bucket90PlusPaise > 0 ? formatINR(c.aging.bucket90PlusPaise) : '—'}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-rose-600">
                        {c.overduePaise > 0 ? formatINR(c.overduePaise) : '₹0'}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-900">
                        {formatINR(c.outstandingPaise)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <button
                          onClick={() => setExpandedCustomerId(isExpanded ? null : c.customerId)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                        >
                          {isExpanded ? 'Hide' : 'History'}
                        </button>
                      </td>
                    </tr>

                    {/* Expanded History Row */}
                    {isExpanded && (
                      <tr className="bg-slate-50/90">
                        <td colSpan={8} className="p-4 sm:p-5 border-y border-slate-200">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Invoices History */}
                            <div className="bg-white rounded-xl p-3 border border-slate-200">
                              <span className="text-xs font-bold text-slate-900 block mb-2 flex items-center gap-1.5">
                                <Receipt className="w-3.5 h-3.5 text-indigo-600" />
                                <span>Recent Invoices ({c.recentInvoices.length})</span>
                              </span>
                              {c.recentInvoices.length === 0 ? (
                                <p className="text-slate-400 text-xs italic">No invoices recorded yet.</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {c.recentInvoices.map((inv: any) => (
                                    <div
                                      key={inv.id}
                                      className="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0"
                                    >
                                      <div>
                                        <span className="font-bold text-slate-800">{inv.invoiceNumber}</span>
                                        <span className="text-[11px] text-slate-500 ml-1.5">
                                          Due: {inv.dueDate}
                                        </span>
                                      </div>
                                      <div className="text-right">
                                        <span className="font-bold text-slate-900 block">
                                          {formatINR(inv.totalAmountPaise)}
                                        </span>
                                        <span
                                          className={`text-[10px] font-semibold ${
                                            inv.balanceDuePaise > 0 ? 'text-rose-600' : 'text-emerald-600'
                                          }`}
                                        >
                                          Due: {formatINR(inv.balanceDuePaise)}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Payments History */}
                            <div className="bg-white rounded-xl p-3 border border-slate-200">
                              <span className="text-xs font-bold text-slate-900 block mb-2 flex items-center gap-1.5">
                                <CreditCard className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Recent Collections ({c.recentPayments.length})</span>
                              </span>
                              {c.recentPayments.length === 0 ? (
                                <p className="text-slate-400 text-xs italic">No payments recorded yet.</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {c.recentPayments.map((pay: any) => (
                                    <div
                                      key={pay.id}
                                      className="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0"
                                    >
                                      <div>
                                        <span className="font-medium text-slate-800">
                                          {pay.paymentMode.replace('_', ' ')}
                                        </span>
                                        <span className="text-[11px] text-slate-500 font-mono ml-1.5">
                                          {pay.referenceNumber}
                                        </span>
                                      </div>
                                      <div className="text-right">
                                        <span className="font-bold text-emerald-700">
                                          +{formatINR(pay.amountPaise)}
                                        </span>
                                        <span className="text-[10px] text-slate-500 block">
                                          {pay.paymentDate}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Compliance Disclaimer Notice */}
      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed flex items-start gap-2.5">
        <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-slate-700 block mb-0.5">Statutory GTA Disclaimer:</span>
          <span>{disclaimer}</span>
        </div>
      </div>
    </div>
  );
};
