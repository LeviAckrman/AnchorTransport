import React, { useState, useEffect } from 'react';
import {
  Building2,
  Plus,
  Search,
  Filter,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Edit,
  Trash2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileText,
  MapPin,
} from 'lucide-react';
import { Customer, UserRole } from '../../types/tms';
import { formatINR } from '../../lib/currency';
import { Badge, BadgeVariant } from '../../components/ui/Badge';
import { PageHeader } from '../../components/layout/PageHeader';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { CustomerModal } from './CustomerModal';
import { CustomerDetailModal } from './CustomerDetailModal';
import { useAuth } from '../../context/AuthContext';
import { parseResponseJson } from '../../lib/safeFetch';

interface CustomersViewProps {
  userRole: UserRole;
}

export const CustomersView: React.FC<CustomersViewProps> = ({ userRole }) => {
  const { token, company } = useAuth();
  const activeToken = token || (typeof window !== 'undefined' ? (localStorage.getItem('token') || '') : '');

  // Data states
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [balanceFilter, setBalanceFilter] = useState<string>('ALL'); // ALL, OUTSTANDING, CLEARED

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(8);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [customerToEdit, setCustomerToEdit] = useState<Customer | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);

  const fetchCustomers = async (targetPage = page) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: targetPage.toString(),
        limit: limit.toString(),
        search: searchQuery,
        balanceFilter: balanceFilter,
      });

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;

      const res = await fetch(`/api/customers?${params.toString()}`, { headers });
      const data = await parseResponseJson<any>(res);

      if (!res.ok || !data || !data.success) {
        throw new Error(data?.error || 'Failed to fetch customer accounts.');
      }

      setCustomers(data.data || []);
      setPage(data.pagination.page);
      setTotalPages(data.pagination.totalPages || 1);
      setTotalCount(data.pagination.total || 0);
    } catch (err: any) {
      console.warn('Customers fetch notice:', err);
      setError(err.message || 'Unable to load company customers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers(1);
  }, [searchQuery, balanceFilter, limit, company?.id]);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    setPage(newPage);
    fetchCustomers(newPage);
  };

  const showNotification = (text: string, type: 'success' | 'error' = 'success') => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 3500);
  };

  const handleModalSuccess = (customer: Customer, isEdit: boolean) => {
    showNotification(
      isEdit ? `Customer ${customer.name} updated successfully.` : `Customer ${customer.name} registered to company directory.`,
      'success'
    );
    window.dispatchEvent(new CustomEvent('tms:customer-updated'));
    fetchCustomers(isEdit ? page : 1);
  };

  const confirmDeleteCustomer = async () => {
    if (!customerToDelete) return;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;

      const res = await fetch(`/api/customers/${customerToDelete.id}`, {
        method: 'DELETE',
        headers,
      });

      const data = await parseResponseJson<any>(res);
      if (!res.ok || !data || !data.success) {
        throw new Error(data?.error || 'Failed to delete customer.');
      }

      showNotification(`Customer ${customerToDelete.name} deleted.`);
      setCustomerToDelete(null);
      window.dispatchEvent(new CustomEvent('tms:customer-updated'));
      fetchCustomers(page);
    } catch (err: any) {
      showNotification(err.message || 'Error deleting customer.', 'error');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto antialiased">
      {/* Toast Notification */}
      {actionMsg && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl shadow-xl text-xs sm:text-sm font-medium flex items-center gap-2 border animate-in fade-in slide-in-from-top-4 duration-200 ${
            actionMsg.type === 'success'
              ? 'bg-slate-900 text-white border-slate-700'
              : 'bg-rose-900 text-white border-rose-700'
          }`}
        >
          {actionMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400" />
          )}
          <span>{actionMsg.text}</span>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        title="Customers & Consignors"
        subtitle="Manage corporate consignors, GSTIN records, agreed payment terms, and outstanding balances"
        actions={
          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Customer</span>
          </button>
        }
      />

      {/* Controls Bar: Search & Balance Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Customer Name, Trade Name, GSTIN, or City..."
              className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm border border-slate-300 rounded-xl bg-slate-50/50 text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-hidden focus:border-indigo-500 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
              >
                Clear
              </button>
            )}
          </div>

          <button
            onClick={() => fetchCustomers(page)}
            title="Refresh customer accounts"
            className="p-2 border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 transition-colors shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
          <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider mr-1">Outstanding:</span>
          {[
            { id: 'ALL', label: 'All Customers' },
            { id: 'OUTSTANDING', label: 'Payment Due' },
            { id: 'CLEARED', label: 'Zero Dues' },
          ].map((bf) => (
            <button
              key={bf.id}
              onClick={() => setBalanceFilter(bf.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                balanceFilter === bf.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {bf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Table / Grid */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-medium">Loading customer directory...</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-rose-200 p-8 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
          <p className="text-sm font-semibold text-slate-800">{error}</p>
          <button
            onClick={() => fetchCustomers(1)}
            className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800"
          >
            Retry Connection
          </button>
        </div>
      ) : customers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mx-auto">
            <Building2 className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto">
            <h4 className="text-base font-bold text-slate-900">No customers found</h4>
            <p className="text-xs text-slate-500 mt-1">
              {searchQuery || balanceFilter !== 'ALL'
                ? 'No customer records match your search or filter. Try clearing your filters.'
                : 'No corporate clients or consignors registered yet. Add your first customer with GSTIN and payment terms.'}
            </p>
          </div>
          {searchQuery || balanceFilter !== 'ALL' ? (
            <button
              onClick={() => {
                setSearchQuery('');
                setBalanceFilter('ALL');
              }}
              className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Reset Filters
            </button>
          ) : (
            <button
              onClick={() => setIsCreateOpen(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs"
            >
              Add First Customer
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col">
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Customer / Legal Entity</th>
                  <th className="py-3 px-4">GSTIN & State</th>
                  <th className="py-3 px-4">Contact Person</th>
                  <th className="py-3 px-4">Payment Terms</th>
                  <th className="py-3 px-4">Credit Limit</th>
                  <th className="py-3 px-4">Outstanding Balance</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="py-3.5 px-4">
                      <button
                        onClick={() => setSelectedCustomerId(c.id)}
                        className="font-bold text-slate-900 text-sm hover:text-indigo-600 hover:underline text-left block cursor-pointer"
                      >
                        {c.name}
                      </button>
                      {c.tradeName && c.tradeName !== c.name && (
                        <span className="text-[11px] text-slate-500 block">{c.tradeName}</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 font-mono">
                      <span className="font-bold text-slate-800 block tracking-wide">{c.gstin}</span>
                      <span className="text-[10px] text-slate-500 font-sans">
                        {c.city}, {c.state} ({c.stateCode})
                      </span>
                    </td>

                    <td className="py-3.5 px-4">
                      <span className="font-semibold text-slate-900 block">{c.contactPerson}</span>
                      <span className="text-[11px] font-mono text-slate-500">{c.phone}</span>
                    </td>

                    <td className="py-3.5 px-4">
                      <span className="font-semibold text-slate-800 block">{c.creditPeriodDays} Days</span>
                      <span className="text-[10px] text-slate-400">Net billing</span>
                    </td>

                    <td className="py-3.5 px-4 font-medium text-slate-800">
                      {formatINR(c.creditLimitPaise)}
                    </td>

                    <td className="py-3.5 px-4">
                      <span
                        className={`font-bold ${
                          c.currentOutstandingPaise > 0 ? 'text-rose-600' : 'text-emerald-700'
                        }`}
                      >
                        {formatINR(c.currentOutstandingPaise)}
                      </span>
                      {c.currentOutstandingPaise > 0 ? (
                        <span className="block text-[10px] text-rose-500 font-medium">Unpaid dues</span>
                      ) : (
                        <span className="block text-[10px] text-emerald-600 font-medium">Cleared</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-90 group-hover:opacity-100">
                        <button
                          onClick={() => setSelectedCustomerId(c.id)}
                          title="Inspect Customer Account & Invoices"
                          className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setCustomerToEdit(c)}
                          title="Edit Customer"
                          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        {(userRole === 'OWNER' || userRole === 'ADMIN') && (
                          <button
                            onClick={() => setCustomerToDelete(c)}
                            title="Delete Customer"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden divide-y divide-slate-100">
            {customers.map((c) => (
              <div key={c.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <button
                      onClick={() => setSelectedCustomerId(c.id)}
                      className="font-bold text-slate-900 text-sm hover:text-indigo-600 text-left block"
                    >
                      {c.name}
                    </button>
                    <span className="text-xs font-mono text-slate-500 block">{c.gstin}</span>
                    <span className="text-[11px] text-slate-400 block">
                      {c.city}, {c.state}
                    </span>
                  </div>
                  <div className="text-right">
                    <span
                      className={`text-xs font-bold block ${
                        c.currentOutstandingPaise > 0 ? 'text-rose-600' : 'text-emerald-700'
                      }`}
                    >
                      {formatINR(c.currentOutstandingPaise)}
                    </span>
                    <span className="text-[10px] text-slate-400 block">{c.creditPeriodDays}d terms</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase block">Contact Person</span>
                    <span className="font-medium text-slate-800">{c.contactPerson}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400 text-[10px] uppercase block">Credit Limit</span>
                    <span className="font-semibold text-slate-800">{formatINR(c.creditLimitPaise)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    onClick={() => setSelectedCustomerId(c.id)}
                    className="px-2.5 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-lg"
                  >
                    Inspect
                  </button>
                  <button
                    onClick={() => setCustomerToEdit(c)}
                    className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg"
                  >
                    Edit
                  </button>
                  {(userRole === 'OWNER' || userRole === 'ADMIN') && (
                    <button
                      onClick={() => setCustomerToDelete(c)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-rose-600 bg-rose-50 rounded-lg"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination Bar */}
          <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <div>
              Showing <span className="font-semibold text-slate-900">{customers.length}</span> of{' '}
              <span className="font-semibold text-slate-900">{totalCount}</span> customers
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400">Rows per page:</span>
              <select
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value, 10))}
                className="border border-slate-300 rounded p-1 bg-white text-slate-800 text-xs"
              >
                <option value={8}>8</option>
                <option value={15}>15</option>
                <option value={25}>25</option>
              </select>

              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page <= 1}
                  className="p-1.5 rounded border border-slate-300 hover:bg-white disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="px-2 font-medium text-slate-700">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded border border-slate-300 hover:bg-white disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customer Create Modal */}
      {isCreateOpen && (
        <CustomerModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onSuccess={handleModalSuccess}
          token={activeToken}
        />
      )}

      {/* Customer Edit Modal */}
      {customerToEdit && (
        <CustomerModal
          isOpen={Boolean(customerToEdit)}
          onClose={() => setCustomerToEdit(null)}
          onSuccess={handleModalSuccess}
          customerToEdit={customerToEdit}
          token={activeToken}
        />
      )}

      {/* Customer Detail & Invoices Modal */}
      {selectedCustomerId && (
        <CustomerDetailModal
          isOpen={Boolean(selectedCustomerId)}
          onClose={() => setSelectedCustomerId(null)}
          customerId={selectedCustomerId}
          token={activeToken}
          userRole={userRole}
          onEdit={(cust) => {
            setSelectedCustomerId(null);
            setCustomerToEdit(cust);
          }}
          onDelete={(cust) => {
            setSelectedCustomerId(null);
            setCustomerToDelete(cust);
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {customerToDelete && (
        <ConfirmDialog
          isOpen={Boolean(customerToDelete)}
          title={`Delete Customer ${customerToDelete.name}?`}
          message={`Are you sure you want to delete customer ${customerToDelete.name} (GSTIN: ${customerToDelete.gstin})? This action cannot be undone.`}
          confirmLabel="Delete Customer"
          variant="danger"
          onConfirm={confirmDeleteCustomer}
          onClose={() => setCustomerToDelete(null)}
        />
      )}
    </div>
  );
};
