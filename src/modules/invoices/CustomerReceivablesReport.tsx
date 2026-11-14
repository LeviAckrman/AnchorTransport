import React, { useState, useMemo } from 'react';
import {
  Receipt,
  CreditCard,
  Info,
} from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { formatINR } from '../../lib/financialEngine';
import { GTA_GST_DISCLAIMER } from '../../types/tms';
import { useFirestoreData } from '../../context/FirestoreDataContext';

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

interface CustomerReceivablesReportProps {
  onSelectCustomer?: (customerId: string) => void;
}

export const CustomerReceivablesReport: React.FC<CustomerReceivablesReportProps> = ({
  onSelectCustomer,
}) => {
  const { customers: allCustomers, invoices: allInvoices, payments: allPayments, loading, error } = useFirestoreData();
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);

  const { summary, customers } = useMemo(() => {
    const activeInvoices = allInvoices.filter((inv) => inv.status !== 'CANCELLED');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    let totalReceivablesPaise = 0;
    let totalOverduePaise = 0;
    let overdueInvoicesCount = 0;
    let totalBilledPaise = 0;
    let totalCollectedPaise = 0;
    let totalCustomersWithDues = 0;

    const rows: CustomerReportItem[] = allCustomers.map((c) => {
      const cInv = activeInvoices
        .filter((inv) => inv.customerId === c.id)
        .sort((a, b) => new Date(b.issueDate || b.createdAt || 0).getTime() - new Date(a.issueDate || a.createdAt || 0).getTime());

      const cPay = allPayments
        .filter((p) => p.customerId === c.id)
        .sort((a, b) => new Date(b.paymentDate || b.createdAt || 0).getTime() - new Date(a.paymentDate || a.createdAt || 0).getTime());

      let custBilled = 0;
      let custPaid = 0;
      let custOutstanding = 0;
      let custOverdue = 0;
      let custOverdueCount = 0;

      const aging = {
        bucket0to30Paise: 0,
        bucket31to60Paise: 0,
        bucket61to90Paise: 0,
        bucket90PlusPaise: 0,
      };

      for (const inv of cInv) {
        const totalAmt = inv.totalAmountPaise || 0;
        const paidAmt = inv.amountPaidPaise || 0;
        const bal = inv.balanceDuePaise ?? Math.max(0, totalAmt - paidAmt);

        custBilled += totalAmt;
        custPaid += paidAmt;
        custOutstanding += bal;

        if (bal > 0) {
          const refDate = new Date(inv.issueDate || inv.dueDate || inv.createdAt || todayStr);
          const ageDays = Number.isNaN(refDate.getTime())
            ? 0
            : Math.max(0, Math.floor((today.getTime() - refDate.getTime()) / (1000 * 3600 * 24)));

          if (ageDays <= 30) aging.bucket0to30Paise += bal;
          else if (ageDays <= 60) aging.bucket31to60Paise += bal;
          else if (ageDays <= 90) aging.bucket61to90Paise += bal;
          else aging.bucket90PlusPaise += bal;

          if (inv.status === 'OVERDUE' || (inv.dueDate && inv.dueDate < todayStr)) {
            custOverdue += bal;
            custOverdueCount += 1;
          }
        }
      }

      totalBilledPaise += custBilled;
      totalCollectedPaise += custPaid;
      totalReceivablesPaise += custOutstanding;
      totalOverduePaise += custOverdue;
      overdueInvoicesCount += custOverdueCount;
      if (custOutstanding > 0) totalCustomersWithDues += 1;

      return {
        customerId: c.id,
        customerName: c.name,
        gstin: c.gstin,
        phone: c.phone,
        paymentTermsDays: c.paymentTermsDays || c.creditPeriodDays || 30,
        creditLimitPaise: c.creditLimitPaise || 0,
        totalInvoicesCount: cInv.length,
        totalBilledPaise: custBilled,
        totalPaidPaise: custPaid,
        outstandingPaise: custOutstanding,
        overduePaise: custOverdue,
        overdueCount: custOverdueCount,
        aging,
        recentInvoices: cInv.slice(0, 5),
        recentPayments: cPay.slice(0, 5),
      };
    });

    rows.sort((a, b) => b.outstandingPaise - a.outstandingPaise || b.totalBilledPaise - a.totalBilledPaise);

    return {
      summary: {
        totalReceivablesPaise,
        totalOverduePaise,
        overdueInvoicesCount,
        totalBilledPaise,
        totalCollectedPaise,
        totalCustomersWithDues,
      },
      customers: rows,
    };
  }, [allCustomers, allInvoices, allPayments]);

  if (loading && allCustomers.length === 0) {
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

      {/* Customer Accounts Breakdown */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">Customer Aging & Receivables Ledger</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Breakdown of outstanding dues by aging buckets (0-30, 31-60, 61-90, 90+ days)
            </p>
          </div>
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
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400 italic">
                    No customer receivables found.
                  </td>
                </tr>
              ) : (
                customers.map((c) => {
                  const isExpanded = expandedCustomerId === c.customerId;
                  return (
                    <React.Fragment key={c.customerId}>
                      <tr className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4">
                          {onSelectCustomer ? (
                            <button
                              onClick={() => onSelectCustomer(c.customerId)}
                              className="font-bold text-slate-900 hover:text-indigo-700 text-left cursor-pointer"
                            >
                              {c.customerName}
                            </button>
                          ) : (
                            <div className="font-bold text-slate-900">{c.customerName}</div>
                          )}
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
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Compliance Disclaimer Notice */}
      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed flex items-start gap-2.5">
        <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-slate-700 block mb-0.5">Statutory GTA Disclaimer:</span>
          <span>{GTA_GST_DISCLAIMER}</span>
        </div>
      </div>
    </div>
  );
};
