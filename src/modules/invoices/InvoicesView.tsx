import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Plus,
  Search,
  Filter,
  CreditCard,
  Printer,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  TrendingUp,
  Receipt,
  XCircle,
  Eye,
  BarChart3,
  Layers,
} from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { InvoiceModal } from './InvoiceModal';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import { PaymentModal } from './PaymentModal';
import { CustomerReceivablesReport } from './CustomerReceivablesReport';
import { Invoice, Payment, InvoiceStatus, UserRole } from '../../types/tms';
import { formatINR, paiseToRupees } from '../../lib/financialEngine';
import { parseResponseJson } from '../../lib/safeFetch';
import { useAuth } from '../../context/AuthContext';

interface InvoicesViewProps {
  userRole: UserRole;
  onNavigateTab?: (tab: string) => void;
}

export const InvoicesView: React.FC<InvoicesViewProps> = ({
  userRole,
  onNavigateTab,
}) => {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState<'invoices' | 'receivables'>('invoices');

  // Invoices list state
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    totalBilledPaise: number;
    totalCollectedPaise: number;
    totalOutstandingPaise: number;
    totalOverduePaise: number;
    overdueCount: number;
    totalCount: number;
  }>({
    totalBilledPaise: 0,
    totalCollectedPaise: 0,
    totalOutstandingPaise: 0,
    totalOverduePaise: 0,
    overdueCount: 0,
    totalCount: 0,
  });

  // Filters & Pagination
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 15;

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [detailPayments, setDetailPayments] = useState<Payment[]>([]);

  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  // Toast
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showToast = (type: 'success' | 'error', text: string) => {
    setToastMsg({ type, text });
    setTimeout(() => setToastMsg(null), 4000);
  };

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: limit.toString(),
      });

      if (statusFilter) params.append('status', statusFilter);
      if (searchQuery.trim()) params.append('search', searchQuery.trim());

      const res = await fetch(`/api/invoices?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token || ''}` },
      });

      const data = await parseResponseJson(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch customer invoices');
      }

      setInvoices(data.data || []);
      setTotalPages(data.pagination?.totalPages || 1);
      if (data.summary) {
        setSummary(data.summary);
      }
    } catch (err: any) {
      setError(err.message || 'Error loading invoices');
    } finally {
      setLoading(false);
    }
  }, [token, currentPage, statusFilter, searchQuery]);

  useEffect(() => {
    if (activeTab === 'invoices') {
      fetchInvoices();
    }
  }, [fetchInvoices, activeTab]);

  const handleOpenDetail = async (inv: Invoice) => {
    setSelectedInvoice(inv);
    setIsDetailModalOpen(true);

    try {
      const res = await fetch(`/api/invoices/${inv.id}`, {
        headers: { Authorization: `Bearer ${token || ''}` },
      });
      const data = await parseResponseJson(res);
      if (data.success) {
        setSelectedInvoice(data.invoice);
        setDetailPayments(data.payments || []);
      }
    } catch {
      // Keep basic invoice
    }
  };

  const handleOpenPayment = (inv: Invoice) => {
    setPaymentInvoice(inv);
    setIsPaymentModalOpen(true);
  };

  const handlePaymentSuccess = (payment: Payment) => {
    showToast('success', `Recorded payment of ₹${(payment.amountPaise / 100).toLocaleString('en-IN')} (Ref: ${payment.referenceNumber}).`);
    fetchInvoices();
  };

  const handleInvoiceCreated = (newInv: Invoice) => {
    showToast('success', `Issued Invoice ${newInv.invoiceNumber} for ${newInv.customerName}.`);
    fetchInvoices();
  };

  const handleInvoiceCancelled = (cancelledInv: Invoice) => {
    showToast('success', `Cancelled Invoice ${cancelledInv.invoiceNumber}. Trip released for re-billing.`);
    fetchInvoices();
  };

  const getStatusBadge = (status: InvoiceStatus | string) => {
    switch (status) {
      case 'PAID':
        return <Badge variant="success">PAID</Badge>;
      case 'PARTIALLY_PAID':
        return <Badge variant="amber">PARTIAL</Badge>;
      case 'OVERDUE':
        return <Badge variant="danger">OVERDUE</Badge>;
      case 'ISSUED':
        return <Badge variant="indigo">ISSUED</Badge>;
      case 'DRAFT':
        return <Badge variant="neutral">DRAFT</Badge>;
      case 'CANCELLED':
        return <Badge variant="danger">CANCELLED</Badge>;
      default:
        return <Badge variant="neutral">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Toast Notification */}
      {toastMsg && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl shadow-xl text-xs sm:text-sm font-medium flex items-center gap-2 border animate-in fade-in slide-in-from-top-4 duration-200 ${
            toastMsg.type === 'success'
              ? 'bg-slate-900 text-white border-slate-700'
              : 'bg-rose-900 text-white border-rose-700'
          }`}
        >
          {toastMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400" />
          )}
          <span>{toastMsg.text}</span>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        title="Customer Invoices & Receivables Console"
        subtitle="Issue GTA freight invoices under SAC 996511, record bank payments, and audit customer receivables"
        actions={
          <div className="flex items-center gap-2.5">
            <div className="bg-slate-100 p-1 rounded-xl border border-slate-200 flex items-center">
              <button
                onClick={() => setActiveTab('invoices')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'invoices'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Invoices</span>
              </button>
              <button
                onClick={() => setActiveTab('receivables')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'receivables'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Receivables Report</span>
              </button>
            </div>

            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Generate Invoice</span>
            </button>
          </div>
        }
      />

      {/* VIEW: CUSTOMER RECEIVABLES REPORT */}
      {activeTab === 'receivables' && (
        <CustomerReceivablesReport
          onSelectCustomer={(custId) => {
            setActiveTab('invoices');
            // Filter by customer if needed
          }}
        />
      )}

      {/* VIEW: INVOICES LISTING & SUMMARY */}
      {activeTab === 'invoices' && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Total Invoiced
                </span>
                <span className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                  <Receipt className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-2 text-xl font-bold text-slate-900">
                {formatINR(summary.totalBilledPaise)}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {summary.totalCount} total billed consignments
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">
                  Collections Deposited
                </span>
                <span className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                  <CreditCard className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-2 text-xl font-bold text-emerald-700">
                {formatINR(summary.totalCollectedPaise)}
              </div>
              <p className="text-[11px] text-emerald-600 mt-0.5">
                Bank receipts & RTGS transfers
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Outstanding Receivables
                </span>
                <span className="p-2 bg-amber-50 text-amber-600 rounded-xl">
                  <Clock className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-2 text-xl font-bold text-slate-900">
                {formatINR(summary.totalOutstandingPaise)}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Pending customer payment balance
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-rose-600 uppercase tracking-wider">
                  Overdue Invoices
                </span>
                <span className="p-2 bg-rose-50 text-rose-600 rounded-xl">
                  <AlertTriangle className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-2 text-xl font-bold text-rose-700">
                {formatINR(summary.totalOverduePaise)}
              </div>
              <p className="text-[11px] text-rose-600 mt-0.5 font-medium">
                {summary.overdueCount} bills past credit due date
              </p>
            </div>
          </div>

          {/* Filters & Search Toolbar */}
          <div className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              {/* Search Bar */}
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Search by invoice number, customer name, LR #, or GSTIN..."
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs sm:text-sm focus:outline-none focus:bg-white focus:border-indigo-600 transition-colors"
                />
              </div>

              {/* Status Filter Pill Tabs */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
                {[
                  { id: '', label: 'All' },
                  { id: 'ISSUED', label: 'Issued' },
                  { id: 'PARTIALLY_PAID', label: 'Partial' },
                  { id: 'PAID', label: 'Paid' },
                  { id: 'OVERDUE', label: 'Overdue' },
                  { id: 'DRAFT', label: 'Drafts' },
                  { id: 'CANCELLED', label: 'Cancelled' },
                ].map((st) => (
                  <button
                    key={st.id}
                    onClick={() => {
                      setStatusFilter(st.id);
                      setCurrentPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                      statusFilter === st.id
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Invoices Data Table */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            {loading ? (
              <div className="py-20 text-center text-xs text-slate-500 animate-pulse">
                Loading customer invoices and receivables records...
              </div>
            ) : error ? (
              <div className="py-16 text-center text-xs text-rose-600">
                <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-rose-500" />
                <span>{error}</span>
              </div>
            ) : invoices.length === 0 ? (
              <div className="py-20 text-center text-slate-500">
                <Receipt className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                <h4 className="text-sm font-bold text-slate-800">No invoices found</h4>
                <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                  {statusFilter || searchQuery
                    ? 'No invoices match your active search and status filters.'
                    : 'No customer transport invoices have been issued yet. Click "Generate Invoice" to bill a delivered trip.'}
                </p>
                {!statusFilter && !searchQuery && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => setIsCreateModalOpen(true)}
                    className="mt-4"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Bill Completed Trip
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4">Invoice # & Date</th>
                      <th className="py-3 px-4">Customer Party</th>
                      <th className="py-3 px-3">Trip & Route</th>
                      <th className="py-3 px-3">Tax Model</th>
                      <th className="py-3 px-4 text-right">Invoice Total</th>
                      <th className="py-3 px-4 text-right">Balance Due</th>
                      <th className="py-3 px-3 text-center">Status</th>
                      <th className="py-3 px-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-4">
                          <button
                            onClick={() => handleOpenDetail(inv)}
                            className="font-mono font-bold text-indigo-600 hover:text-indigo-800 text-left block cursor-pointer"
                          >
                            {inv.invoiceNumber}
                          </button>
                          <span className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            {inv.issueDate}
                          </span>
                        </td>

                        <td className="py-3.5 px-4">
                          <span className="font-bold text-slate-900 block max-w-xs truncate">
                            {inv.customerName}
                          </span>
                          <span className="text-[11px] text-slate-500 font-mono">
                            {inv.customerGstin || 'Unregistered'}
                          </span>
                        </td>

                        <td className="py-3.5 px-3">
                          <span className="font-medium text-slate-800 font-mono block">
                            {inv.tripNumber} ({inv.lrNumber})
                          </span>
                          <span className="text-[11px] text-slate-500 truncate max-w-[180px] block">
                            {inv.originCity} ➔ {inv.destinationCity}
                          </span>
                        </td>

                        <td className="py-3.5 px-3">
                          <Badge variant={inv.isRcmApplicable ? 'purple' : 'info'}>
                            {inv.isRcmApplicable ? 'GTA RCM' : 'Forward Tax'}
                          </Badge>
                        </td>

                        <td className="py-3.5 px-4 text-right font-bold text-slate-900">
                          {formatINR(inv.totalAmountPaise)}
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <span
                            className={`font-bold block ${
                              inv.balanceDuePaise > 0 ? 'text-rose-700' : 'text-emerald-700'
                            }`}
                          >
                            {formatINR(inv.balanceDuePaise)}
                          </span>
                          {inv.balanceDuePaise > 0 && inv.dueDate && (
                            <span className="text-[10px] text-slate-400 block">
                              Due: {inv.dueDate}
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-3 text-center">
                          {getStatusBadge(inv.status)}
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenDetail(inv)}
                              title="View & Print Tax Invoice"
                              className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                            >
                              <Eye className="w-4 h-4" />
                            </button>

                            {inv.status !== 'PAID' && inv.status !== 'CANCELLED' && (
                              <button
                                onClick={() => handleOpenPayment(inv)}
                                title="Record Payment"
                                className="px-2.5 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                              >
                                <CreditCard className="w-3.5 h-3.5" />
                                <span>Pay</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Toolbar */}
            {totalPages > 1 && (
              <div className="p-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                <span>
                  Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Modals */}
      <InvoiceModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={handleInvoiceCreated}
      />

      <InvoiceDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        invoice={selectedInvoice}
        payments={detailPayments}
        onOpenPaymentModal={(inv) => {
          setIsDetailModalOpen(false);
          handleOpenPayment(inv);
        }}
        onInvoiceCancelled={handleInvoiceCancelled}
      />

      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        invoice={paymentInvoice}
        onSuccess={handlePaymentSuccess}
      />
    </div>
  );
};
