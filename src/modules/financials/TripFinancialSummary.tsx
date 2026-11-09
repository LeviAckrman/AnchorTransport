import React from 'react';
import { IndianRupee, TrendingUp, AlertCircle, Receipt, Wallet, Fuel, ShieldCheck } from 'lucide-react';
import { formatINR } from '../../lib/currency';
import { Trip, TripExpense, DriverAdvance, TripSettlement } from '../../types/tms';
import { calculateTripContribution } from '../../lib/financialEngine';

interface TripFinancialSummaryProps {
  trip: Trip;
  expenses?: TripExpense[];
  advances?: DriverAdvance[];
  settlement?: TripSettlement | null;
  className?: string;
}

export const TripFinancialSummary: React.FC<TripFinancialSummaryProps> = ({
  trip,
  expenses = [],
  advances = [],
  settlement = null,
  className = '',
}) => {
  const revenue = trip.totalRevenuePaise || trip.freightAmountPaise || 0;
  const contrib = calculateTripContribution(revenue, expenses);

  const totalAdvances = advances.reduce((sum, a) => sum + a.amountPaise, 0);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Primary Financial Metric Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Freight Revenue */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Freight Revenue
            </span>
            <span className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
              <IndianRupee className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">
            {formatINR(revenue)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {trip.weightTonnes}T @ {formatINR(trip.ratePerTonnePaise || 0, true)}/T
            {trip.otherChargesPaise ? ` + ${formatINR(trip.otherChargesPaise)} other` : ''}
          </div>
        </div>

        {/* Recorded Trip Expenses */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Recorded Expenses
            </span>
            <span className="p-1.5 bg-rose-100 text-rose-700 rounded-lg">
              <Receipt className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-rose-700">
            {formatINR(contrib.expensesPaise)}
          </div>
          <div className="mt-1 text-xs text-slate-500 flex items-center justify-between">
            <span>{expenses.length} voucher{expenses.length === 1 ? '' : 's'} recorded</span>
            <span>Fuel: {formatINR(contrib.fuelExpensesPaise)}</span>
          </div>
        </div>

        {/* Trip Contribution */}
        <div className={`border rounded-xl p-4 ${
          contrib.contributionPaise >= 0 ? 'bg-emerald-50/70 border-emerald-200' : 'bg-red-50/70 border-red-200'
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              Trip Contribution
            </span>
            <span className={`p-1.5 rounded-lg ${
              contrib.contributionPaise >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
            }`}>
              <TrendingUp className="w-4 h-4" />
            </span>
          </div>
          <div className={`mt-2 text-2xl font-bold ${
            contrib.contributionPaise >= 0 ? 'text-emerald-800' : 'text-red-800'
          }`}>
            {formatINR(contrib.contributionPaise)}
          </div>
          <div className="mt-1 text-xs font-medium text-slate-600 flex items-center justify-between">
            <span>Operating Margin</span>
            <span className="font-bold text-slate-900">{contrib.profitMarginPercent.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* Accounting Notice: Contribution vs Net Profit */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-amber-900">
        <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">Accounting Rule: </span>
          Trip contribution represents gross operational margin (Freight Revenue minus Recorded Direct Expenses).
          It does <strong>not</strong> equal company net profit, which excludes truck loan EMIs, vehicle depreciation, fleet insurance amortization, and general administration overheads.
        </div>
      </div>

      {/* Driver Cash Advance Ledger */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-indigo-600" />
            <h4 className="text-sm font-bold text-slate-900">Driver Cash Advance Ledger</h4>
          </div>
          <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            Cash Movement (Balance Sheet Asset)
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="p-3 bg-slate-50 rounded-lg">
            <span className="text-xs text-slate-500 block">Total Cash Disbursed</span>
            <span className="text-base font-bold text-slate-900">{formatINR(totalAdvances)}</span>
            <span className="text-xs text-slate-400 block mt-0.5">{advances.length} disbursement{advances.length === 1 ? '' : 's'}</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg">
            <span className="text-xs text-slate-500 block">Cash Expense Vouchers</span>
            <span className="text-base font-bold text-slate-900">
              {formatINR(
                expenses
                  .filter((e) => e.isDriverDisbursed || e.paymentMode === 'CASH' || e.paymentMode === 'DRIVER_POCKET')
                  .reduce((sum, e) => sum + e.amountPaise, 0)
              )}
            </span>
            <span className="text-xs text-slate-400 block mt-0.5">Submitted by driver</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg">
            <span className="text-xs text-slate-500 block">Settlement Audit Status</span>
            <div className="mt-1 flex items-center gap-1.5">
              {settlement ? (
                <span className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {settlement.status === 'FINALIZED' || settlement.status === 'APPROVED_SETTLED' ? 'Finalized' : 'Draft / In Review'} ({settlement.settlementNumber || 'STL'})
                </span>
              ) : (
                <span className="text-xs font-bold text-amber-700">
                  Unsettled ({formatINR(totalAdvances)} outstanding)
                </span>
              )}
            </div>
          </div>
        </div>

        <p className="mt-2.5 text-xs text-slate-500 italic">
          * Driver advances are temporary cash movements. In accordance with Indian transport accounting standards, advances are <strong>never</strong> subtracted as corporate trip expenses.
        </p>
      </div>
    </div>
  );
};
