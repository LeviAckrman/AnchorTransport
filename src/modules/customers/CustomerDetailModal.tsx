import React, { useState, useEffect } from 'react';
import {
  X,
  Building2,
  FileText,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Trash2,
  Edit,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  Calendar,
} from 'lucide-react';
import { Customer, Invoice, Trip, UserRole } from '../../types/tms';
import { formatINR } from '../../lib/currency';
import { Badge, BadgeVariant } from '../../components/ui/Badge';
import { parseResponseJson } from '../../lib/safeFetch';

interface CustomerDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: string | null;
  token: string;
  userRole: UserRole;
  onEdit: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
}

export const CustomerDetailModal: React.FC<CustomerDetailModalProps> = ({
  isOpen,
  onClose,
  customerId,
  token,
  userRole,
  onEdit,
  onDelete,
}) => {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [recentTrips, setRecentTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = userRole === 'OWNER' || userRole === 'ADMIN';

  useEffect(() => {
    if (!isOpen || !customerId) return;

    const fetchCustomer = async () => {
      setLoading(true);
      setError(null);
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`/api/customers/${customerId}`, { headers });
        const data = await parseResponseJson<any>(res);
        if (!res.ok || !data || !data.success) {
          throw new Error(data?.error || 'Failed to fetch customer profile.');
        }

        setCustomer(data.customer);
        setInvoices(data.invoices || []);
        setRecentTrips(data.recentTrips || []);
      } catch (err: any) {
        setError(err.message || 'Error loading customer details.');
      } finally {
        setLoading(false);
      }
    };

    fetchCustomer();
  }, [isOpen, customerId, token]);

  if (!isOpen) return null;

  const getInvoiceBadge = (status: Invoice['paymentStatus']): { variant: BadgeVariant; label: string } => {
    switch (status) {
      case 'PAID':
        return { variant: 'success', label: 'Paid in Full' };
      case 'PARTIALLY_PAID':
        return { variant: 'amber', label: 'Partially Paid' };
      case 'OVERDUE':
        return { variant: 'danger', label: 'Overdue' };
      case 'UNPAID':
        return { variant: 'purple', label: 'Unpaid / Pending' };
      default:
        return { variant: 'slate', label: status || 'Pending' };
    }
  };

  const utilizationPercent =
    customer && customer.creditLimitPaise > 0
      ? Math.min(100, Math.round((customer.currentOutstandingPaise / customer.creditLimitPaise) * 100))
      : 0;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-indigo-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base sm:text-lg tracking-tight">
                  {customer?.name || 'Customer Account'}
                </h3>
              </div>
              <p className="text-xs text-slate-400">
                GSTIN: <span className="font-mono text-white">{customer?.gstin}</span> •{' '}
                {customer?.city}, {customer?.state}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-16 text-center space-y-3">
              <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-slate-500 font-medium">Fetching customer account and ledger history...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          ) : customer ? (
            <>
              {/* Financial Highlights */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">Outstanding Balance</span>
                  <span
                    className={`text-base sm:text-lg font-bold mt-0.5 block ${
                      customer.currentOutstandingPaise > 0 ? 'text-rose-600' : 'text-emerald-700'
                    }`}
                  >
                    {formatINR(customer.currentOutstandingPaise)}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {customer.currentOutstandingPaise > 0 ? 'Payment pending' : 'Zero dues'}
                  </span>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">Credit Limit</span>
                  <span className="text-base sm:text-lg font-bold text-slate-900 mt-0.5 block">
                    {formatINR(customer.creditLimitPaise)}
                  </span>
                  <span className="text-[10px] text-slate-500">Approved exposure</span>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">Payment Terms</span>
                  <span className="text-base sm:text-lg font-bold text-slate-900 mt-0.5 block">
                    {customer.creditPeriodDays} <span className="text-xs font-normal text-slate-500">Days</span>
                  </span>
                  <span className="text-[10px] text-slate-500">Net billing period</span>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">Total Freight Billed</span>
                  <span className="text-base sm:text-lg font-bold text-slate-900 mt-0.5 block">
                    {formatINR(customer.totalFreightBilledPaise)}
                  </span>
                  <span className="text-[10px] text-slate-500">Lifetime volume</span>
                </div>
              </div>

              {/* Credit Limit Utilization Progress Bar */}
              {customer.creditLimitPaise > 0 && (
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="text-slate-700">Credit Limit Utilization</span>
                    <span
                      className={`font-bold ${
                        utilizationPercent > 80 ? 'text-rose-600' : 'text-slate-900'
                      }`}
                    >
                      {utilizationPercent}% used ({formatINR(customer.currentOutstandingPaise)} of {formatINR(customer.creditLimitPaise)})
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 rounded-full ${
                        utilizationPercent > 85 ? 'bg-rose-500' : utilizationPercent > 60 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${utilizationPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Company Details & Billing Address */}
              <div className="border border-slate-200 rounded-xl p-4 bg-white">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-2">
                  <Building2 className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Tax & Contact Coordinates</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="text-slate-500 block">Customer GSTIN</span>
                    <span className="font-mono font-bold text-slate-900 text-sm tracking-wide">{customer.gstin}</span>
                  </div>

                  <div>
                    <span className="text-slate-500 block">Permanent Account No. (PAN)</span>
                    <span className="font-mono font-bold text-slate-900 text-sm uppercase">{customer.pan}</span>
                  </div>

                  <div>
                    <span className="text-slate-500 block">GST State & Code</span>
                    <span className="font-semibold text-slate-900 block">
                      {customer.state} ({customer.stateCode})
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-500 block">Billing Coordinator</span>
                    <span className="font-semibold text-slate-900">{customer.contactPerson}</span>
                  </div>

                  <div>
                    <span className="text-slate-500 block">Contact Phone</span>
                    <span className="font-mono font-semibold text-slate-900">{customer.phone}</span>
                  </div>

                  <div>
                    <span className="text-slate-500 block">Billing Email</span>
                    <span className="font-mono text-slate-700">{customer.email || 'N/A'}</span>
                  </div>

                  <div className="sm:col-span-3 pt-2 border-t border-slate-100">
                    <span className="text-slate-500 block">Official Registered Billing Address</span>
                    <span className="text-slate-800">
                      {customer.billingAddress}, {customer.city}, {customer.state} - {customer.pincode}
                    </span>
                  </div>
                </div>
              </div>

              {/* Customer Invoice History */}
              <div className="border border-slate-200 rounded-xl p-4 bg-white">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Customer Freight Invoices ({invoices.length})</span>
                  </div>
                </h4>

                {invoices.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-2">No invoices billed to this customer yet.</p>
                ) : (
                  <div className="space-y-2">
                    {invoices.map((inv) => {
                      const badge = getInvoiceBadge(inv.paymentStatus);
                      return (
                        <div
                          key={inv.id}
                          className="p-3 rounded-lg border border-slate-100 bg-slate-50 flex items-center justify-between text-xs"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold font-mono text-slate-900">{inv.invoiceNumber}</span>
                              <Badge variant={badge.variant}>{badge.label}</Badge>
                              {inv.isRcmApplicable && (
                                <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-mono">
                                  GTA RCM
                                </span>
                              )}
                            </div>
                            <span className="text-slate-500 text-[11px] block mt-0.5">
                              Issue: {inv.issueDate} • Due: {inv.dueDate}
                            </span>
                          </div>

                          <div className="text-right">
                            <span className="font-bold text-slate-900 block">{formatINR(inv.totalAmountPaise)}</span>
                            {inv.balanceDuePaise > 0 ? (
                              <span className="text-[11px] font-semibold text-rose-600 block">
                                Due: {formatINR(inv.balanceDuePaise)}
                              </span>
                            ) : (
                              <span className="text-[11px] font-medium text-emerald-600 block">Cleared</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div>
            {canDelete && customer && (
              <button
                type="button"
                onClick={() => {
                  onDelete(customer);
                  onClose();
                }}
                className="px-3 py-2 text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete Customer</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
            >
              Close
            </button>
            {customer && (
              <button
                type="button"
                onClick={() => {
                  onEdit(customer);
                  onClose();
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              >
                <Edit className="w-4 h-4" />
                <span>Edit Customer</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
