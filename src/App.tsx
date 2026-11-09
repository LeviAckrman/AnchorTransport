/**
 * AnchorTransport TMS - Main Application Entry & Layout Architecture
 * Phase 3: Authentication & Multi-Tenant Company Isolation
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Truck,
  Navigation,
  Users,
  Building2,
  Receipt,
  Wallet,
  Scale,
  FileText,
  CreditCard,
  FileCheck2,
  Wrench,
  BarChart3,
  Building,
  ShieldCheck,
  Plus,
  AlertTriangle,
  TrendingUp,
  Fuel,
  ArrowRight,
  CheckCircle2,
  Clock,
  MapPin,
  Calendar,
  IndianRupee,
} from 'lucide-react';

import {
  TmsStore,
  loadStore,
  saveStore,
  resetStore,
} from './lib/storage';
import {
  UserRole,
  Trip,
  Vehicle,
  Driver,
  Customer,
  TripExpense,
  DriverAdvance,
  TripSettlement,
  Invoice,
  Payment,
  VehicleDocument,
} from './types/tms';
import { formatINR } from './lib/currency';

// UI Components
import { Sidebar, ActiveTab } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { MobileNav } from './components/layout/MobileNav';
import { PageHeader } from './components/layout/PageHeader';
import { StatCard } from './components/ui/StatCard';
import { Badge, BadgeVariant } from './components/ui/Badge';
import { DataTable, Column } from './components/ui/DataTable';
import { Modal } from './components/ui/Modal';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { DashboardView } from './modules/dashboard/DashboardView';
import { TripsView } from './modules/trips/TripsView';
import { VehiclesView } from './modules/vehicles/VehiclesView';
import { DriversView } from './modules/drivers/DriversView';
import { CustomersView } from './modules/customers/CustomersView';
import { ExpensesView } from './modules/financials/ExpensesView';
import { DriverAdvancesView } from './modules/financials/DriverAdvancesView';
import { SettlementsView } from './modules/financials/SettlementsView';
import { InvoicesView } from './modules/invoices/InvoicesView';
import { ReportsView } from './modules/reports/ReportsView';

// Auth & Security Components
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginPage } from './components/auth/LoginPage';
import { RegisterPage } from './components/auth/RegisterPage';
import { CompanyOnboardingPage } from './components/auth/CompanyOnboardingPage';
import { CompanyProfilePage } from './components/auth/CompanyProfilePage';
import { UserManagementPage } from './components/auth/UserManagementPage';
import { UserProfileModal } from './components/auth/UserProfileModal';

function AppContent() {
  const { user, company: authCompany, role: authRole, isAuthenticated, needsOnboarding, isLoading } = useAuth();
  const [authScreen, setAuthScreen] = useState<'login' | 'register'>('login');
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  const [store, setStore] = useState<TmsStore>(() => loadStore());
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Quick Dispatch Modal State
  const [isQuickTripOpen, setIsQuickTripOpen] = useState(false);
  const [newTripCustomer, setNewTripCustomer] = useState('');
  const [newTripVehicle, setNewTripVehicle] = useState('');
  const [newTripDriver, setNewTripDriver] = useState('');
  const [newTripOrigin, setNewTripOrigin] = useState('Kolkata, WB');
  const [newTripDestination, setNewTripDestination] = useState('Siliguri, WB');
  const [newTripWeight, setNewTripWeight] = useState('22.5');
  const [newTripRate, setNewTripRate] = useState('2600'); // ₹2,600/tonne
  const [newTripAdvance, setNewTripAdvance] = useState('15000'); // ₹15,000 cash advance
  const [newTripGoods, setNewTripGoods] = useState('TMT Steel Rods');

  // Synchronize company context when changed via AuthContext (multi-tenant switching)
  useEffect(() => {
    if (authCompany) {
      setStore((prev) => ({
        ...prev,
        company: authCompany,
        currentRole: authRole || prev.currentRole,
      }));
    }
  }, [authCompany, authRole]);

  // Sync state to localStorage whenever store changes
  useEffect(() => {
    saveStore(store);
  }, [store]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleRoleChange = (role: UserRole) => {
    setStore((prev) => ({ ...prev, currentRole: role }));
    showToast(`Switched active role to ${role}`);
  };

  const handleResetData = () => {
    if (window.confirm('Reset all demo fleet data to defaults?')) {
      const fresh = resetStore();
      setStore(fresh);
      showToast('Database reset to default West Bengal fleet seed records');
    }
  };

  // Derived counts & metrics for the whole fleet
  const metrics = useMemo(() => {
    const totalFreightRevenue = store.trips.reduce((sum, t) => sum + t.totalRevenuePaise, 0);
    const totalRecordedExpenses = store.expenses.reduce((sum, e) => sum + e.amountPaise, 0);
    const netFleetContribution = totalFreightRevenue - totalRecordedExpenses;
    const pendingSettlements = store.trips.filter((t) => t.status === 'DELIVERED' && !t.isSettled).length;
    
    const expiringDocuments = store.documents.filter(
      (d) => d.status === 'EXPIRING_SOON' || d.status === 'EXPIRED'
    ).length;

    const activeVehicles = store.vehicles.filter((v) => v.status === 'IN_TRANSIT').length;
    const totalVehicles = store.vehicles.length;

    const totalReceivables = store.invoices.reduce((sum, inv) => sum + inv.balanceDuePaise, 0);

    return {
      totalFreightRevenue,
      totalRecordedExpenses,
      netFleetContribution,
      pendingSettlements,
      expiringDocuments,
      activeVehicles,
      totalVehicles,
      totalReceivables,
    };
  }, [store]);

  // Handle Quick Trip Submission
  const handleCreateTrip = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTripCustomer || !newTripVehicle || !newTripDriver) {
      alert('Please select customer, vehicle, and driver');
      return;
    }

    const customerObj = store.customers.find((c) => c.id === newTripCustomer);
    const vehicleObj = store.vehicles.find((v) => v.id === newTripVehicle);
    const driverObj = store.drivers.find((d) => d.id === newTripDriver);

    if (!customerObj || !vehicleObj || !driverObj) return;

    const weight = parseFloat(newTripWeight) || 20;
    const rateRupees = parseFloat(newTripRate) || 2500;
    const freightAmountPaise = Math.round(weight * rateRupees * 100);
    const advancePaise = Math.round((parseFloat(newTripAdvance) || 0) * 100);

    const tripSeq = store.trips.length + 39;
    const newTripId = `trip_${Date.now()}`;
    const tripNum = `TR-2026-00${tripSeq}`;
    const lrNum = `${store.company.lrPrefix}01${tripSeq}`;

    const newTrip: Trip = {
      id: newTripId,
      companyId: store.company.id,
      tripNumber: tripNum,
      lrNumber: lrNum,
      customerId: customerObj.id,
      customerName: customerObj.name,
      customerGstin: customerObj.gstin,
      vehicleId: vehicleObj.id,
      vehicleReg: vehicleObj.registrationNumber,
      driverId: driverObj.id,
      driverName: driverObj.fullName,
      driverPhone: driverObj.phone,
      originCity: newTripOrigin,
      destinationCity: newTripDestination,
      goodsType: newTripGoods,
      weightTonnes: weight,
      ratePerTonnePaise: rateRupees * 100,
      freightAmountPaise,
      otherChargesPaise: 0,
      totalRevenuePaise: freightAmountPaise,
      dispatchDate: new Date().toISOString(),
      expectedDeliveryDate: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
      status: 'DISPATCHED',
      startOdometerKm: vehicleObj.currentOdometerKm,
      podReceived: false,
      totalExpensesPaise: 0,
      totalAdvancesPaise: advancePaise,
      tripContributionPaise: freightAmountPaise,
      isSettled: false,
      isInvoiced: false,
      createdAt: new Date().toISOString(),
    };

    // Update vehicle & driver status
    const updatedVehicles = store.vehicles.map((v) =>
      v.id === vehicleObj.id ? { ...v, status: 'IN_TRANSIT' as const, activeTripId: newTripId } : v
    );

    const updatedDrivers = store.drivers.map((d) =>
      d.id === driverObj.id
        ? {
            ...d,
            status: 'ON_TRIP' as const,
            currentAdvanceBalancePaise: d.currentAdvanceBalancePaise + advancePaise,
            assignedVehicleReg: vehicleObj.registrationNumber,
          }
        : d
    );

    // Record advance if given
    const newAdvances = [...store.advances];
    if (advancePaise > 0) {
      newAdvances.push({
        id: `adv_${Date.now()}`,
        companyId: store.company.id,
        tripId: newTripId,
        driverId: driverObj.id,
        amountPaise: advancePaise,
        advanceType: 'CASH_DISPATCH',
        date: new Date().toISOString().split('T')[0],
        referenceNotes: `Dispatched on trip ${tripNum} (${newTripOrigin} -> ${newTripDestination})`,
        disbursedBy: user?.name || 'Owner',
        isSettled: false,
      });
    }

    setStore((prev) => ({
      ...prev,
      trips: [newTrip, ...prev.trips],
      vehicles: updatedVehicles,
      drivers: updatedDrivers,
      advances: newAdvances,
    }));

    setIsQuickTripOpen(false);
    showToast(`Trip ${tripNum} (${vehicleObj.registrationNumber}) dispatched successfully!`);
  };

  // Status badge mappings
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
      case 'COMPLETED':
        return { label: 'Completed', variant: 'success' };
      case 'CANCELLED':
        return { label: 'Cancelled', variant: 'danger' };
      default:
        return { label: status, variant: 'slate' };
    }
  };

  const getVehicleBadge = (status: Vehicle['status']): { label: string; variant: BadgeVariant } => {
    switch (status) {
      case 'AVAILABLE':
        return { label: 'Available', variant: 'success' };
      case 'IN_TRANSIT':
        return { label: 'On Route', variant: 'purple' };
      case 'UNDER_MAINTENANCE':
        return { label: 'In Garage', variant: 'danger' };
      case 'INACTIVE':
        return { label: 'Inactive', variant: 'slate' };
    }
  };

  // Columns for Trips Table
  const tripColumns: Column<Trip>[] = [
    {
      header: 'Trip & LR No.',
      accessor: (t) => (
        <div>
          <span className="font-bold text-slate-900 block">{t.tripNumber}</span>
          <span className="text-[11px] text-slate-500 font-mono">LR: {t.lrNumber}</span>
        </div>
      ),
      sortable: true,
    },
    {
      header: 'Route & Goods',
      accessor: (t) => (
        <div>
          <div className="flex items-center gap-1 font-medium text-slate-900">
            <span>{t.originCity.split(',')[0]}</span>
            <ArrowRight className="w-3 h-3 text-slate-400" />
            <span>{t.destinationCity.split(',')[0]}</span>
          </div>
          <span className="text-xs text-slate-500">
            {t.goodsType} ({t.weightTonnes} MT)
          </span>
        </div>
      ),
    },
    {
      header: 'Vehicle & Driver',
      accessor: (t) => (
        <div>
          <span className="font-semibold text-slate-900 block">{t.vehicleReg}</span>
          <span className="text-xs text-slate-600">{t.driverName}</span>
        </div>
      ),
    },
    {
      header: 'Customer',
      accessor: (t) => (
        <span className="font-medium text-slate-800 line-clamp-1">{t.customerName}</span>
      ),
    },
    {
      header: 'Freight Revenue',
      accessor: (t) => (
        <span className="font-bold text-slate-900">{formatINR(t.totalRevenuePaise)}</span>
      ),
      sortable: true,
    },
    {
      header: 'Trip Expenses',
      accessor: (t) => (
        <span className="font-medium text-rose-600">{formatINR(t.totalExpensesPaise)}</span>
      ),
    },
    {
      header: 'Trip Contribution',
      accessor: (t) => {
        const contr = t.totalRevenuePaise - t.totalExpensesPaise;
        return (
          <span className="font-bold text-emerald-700">{formatINR(contr)}</span>
        );
      },
      sortable: true,
    },
    {
      header: 'Status',
      accessor: (t) => {
        const badge = getTripBadge(t.status);
        return <Badge variant={badge.variant} dot>{badge.label}</Badge>;
      },
    },
  ];

  // Columns for Vehicles Table
  const vehicleColumns: Column<Vehicle>[] = [
    {
      header: 'Registration No.',
      accessor: (v) => (
        <div>
          <span className="font-bold font-mono text-slate-900 text-sm">{v.registrationNumber}</span>
          <span className="block text-xs text-slate-500">{v.makeModel}</span>
        </div>
      ),
      sortable: true,
    },
    {
      header: 'Type & Capacity',
      accessor: (v) => (
        <div>
          <span className="font-medium text-slate-800">{v.vehicleType}</span>
          <span className="block text-xs text-slate-500">{v.capacityTonnes} Tonnes Payload</span>
        </div>
      ),
    },
    {
      header: 'Assigned Driver',
      accessor: (v) => v.assignedDriverName || <span className="text-slate-400 italic">Unassigned</span>,
    },
    {
      header: 'Odometer',
      accessor: (v) => `${v.currentOdometerKm.toLocaleString()} KM`,
      sortable: true,
    },
    {
      header: 'FastTag Balance',
      accessor: (v) => (
        <span className="font-semibold text-slate-800">{formatINR(v.fastagBalancePaise)}</span>
      ),
    },
    {
      header: 'Status',
      accessor: (v) => {
        const badge = getVehicleBadge(v.status);
        return <Badge variant={badge.variant} dot>{badge.label}</Badge>;
      },
    },
  ];

  // If loading session
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center text-white space-y-3">
          <div className="w-10 h-10 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-400 font-medium">Verifying AnchorTransport security session...</p>
        </div>
      </div>
    );
  }

  // If unauthenticated: render Login or Registration screen
  if (!isAuthenticated) {
    if (authScreen === 'register') {
      return <RegisterPage onSwitchToLogin={() => setAuthScreen('login')} />;
    }
    return <LoginPage onSwitchToRegister={() => setAuthScreen('register')} />;
  }

  // If authenticated but company setup pending: render Onboarding Wizard
  if (needsOnboarding) {
    return <CompanyOnboardingPage />;
  }

  // Authenticated Protected Dashboard
  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden text-slate-900 antialiased font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-xl text-xs sm:text-sm font-medium flex items-center gap-2 border border-slate-700 animate-in fade-in slide-in-from-top-4 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Desktop Sidebar (hidden on mobile) */}
      <div className="hidden md:block h-full">
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          userRole={store.currentRole}
          pendingSettlementsCount={metrics.pendingSettlements}
          expiringDocsCount={metrics.expiringDocuments}
        />
      </div>

      {/* Main App Container */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Topbar */}
        <Topbar
          company={store.company}
          currentRole={store.currentRole}
          onRoleChange={handleRoleChange}
          onResetData={handleResetData}
          onQuickDispatch={() => {
            if (store.customers[0]) setNewTripCustomer(store.customers[0].id);
            if (store.vehicles[0]) setNewTripVehicle(store.vehicles[0].id);
            if (store.drivers[0]) setNewTripDriver(store.drivers[0].id);
            setIsQuickTripOpen(true);
          }}
          onOpenProfile={() => setIsProfileModalOpen(true)}
        />

        {/* Scrollable Viewport Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 pb-20 md:pb-6">
          {/* DASHBOARD VIEW */}
          {activeTab === 'dashboard' && (
            <DashboardView
              onQuickDispatch={() => {
                if (store.customers[0]) setNewTripCustomer(store.customers[0].id);
                if (store.vehicles[0]) setNewTripVehicle(store.vehicles[0].id);
                if (store.drivers[0]) setNewTripDriver(store.drivers[0].id);
                setIsQuickTripOpen(true);
              }}
              onNavigateTab={setActiveTab}
              userRole={store.currentRole}
              localStoreTrips={store.trips}
              localStoreVehicles={store.vehicles}
            />
          )}

          {/* TRIPS VIEW */}
          {activeTab === 'trips' && (
            <TripsView
              userRole={store.currentRole}
              localVehicles={store.vehicles}
              localDrivers={store.drivers}
              localCustomers={store.customers}
            />
          )}

          {/* VEHICLES VIEW */}
          {activeTab === 'vehicles' && (
            <VehiclesView
              userRole={store.currentRole}
              localDrivers={store.drivers}
            />
          )}

          {/* DRIVERS VIEW */}
          {activeTab === 'drivers' && (
            <DriversView
              userRole={store.currentRole}
              localVehicles={store.vehicles}
            />
          )}

          {/* CUSTOMERS VIEW */}
          {activeTab === 'customers' && (
            <CustomersView
              userRole={store.currentRole}
            />
          )}

          {/* EXPENSES VIEW */}
          {activeTab === 'expenses' && (
            <ExpensesView userRole={authRole || 'OPERATIONS'} onNavigateTab={setActiveTab} />
          )}

          {/* ADVANCES VIEW */}
          {activeTab === 'advances' && (
            <DriverAdvancesView userRole={authRole || 'OPERATIONS'} onNavigateTab={setActiveTab} />
          )}

          {/* SETTLEMENTS VIEW */}
          {activeTab === 'settlements' && (
            <SettlementsView userRole={authRole || 'OPERATIONS'} onNavigateTab={setActiveTab} />
          )}

          {/* INVOICES & CUSTOMER PAYMENTS VIEW (PHASE 8) */}
          {(activeTab === 'invoices' || activeTab === 'payments') && (
            <InvoicesView userRole={authRole || 'OPERATIONS'} onNavigateTab={(tab) => setActiveTab(tab as ActiveTab)} />
          )}

          {/* DOCUMENTS COMPLIANCE VIEW */}
          {activeTab === 'documents' && (
            <div className="space-y-6 max-w-7xl mx-auto">
              <PageHeader
                title="Vehicle Document Compliance Vault"
                subtitle="Fitness certificates, National Permits, Road Tax, Insurance, and PUC expiry monitor"
              />

              <DataTable
                data={store.documents}
                keyExtractor={(d) => d.id}
                columns={[
                  {
                    header: 'Truck Registration',
                    accessor: (d) => <span className="font-bold font-mono text-slate-900">{d.vehicleReg}</span>,
                    sortable: true,
                  },
                  {
                    header: 'Document Type',
                    accessor: (d) => <span className="font-semibold text-slate-800">{d.docType.replace('_', ' ')}</span>,
                  },
                  {
                    header: 'Certificate No.',
                    accessor: (d) => <span className="font-mono text-xs text-slate-600">{d.documentNumber}</span>,
                  },
                  {
                    header: 'Authority',
                    accessor: 'issuingAuthority',
                  },
                  {
                    header: 'Expiry Date',
                    accessor: (d) => (
                      <div>
                        <span className="font-medium text-slate-900 block">{d.expiryDate}</span>
                        <span
                          className={`text-xs font-semibold ${
                            d.daysUntilExpiry < 0
                              ? 'text-rose-700'
                              : d.daysUntilExpiry <= 30
                              ? 'text-amber-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {d.daysUntilExpiry < 0
                            ? `Expired ${Math.abs(d.daysUntilExpiry)} days ago`
                            : `Expires in ${d.daysUntilExpiry} days`}
                        </span>
                      </div>
                    ),
                    sortable: true,
                  },
                  {
                    header: 'Status',
                    accessor: (d) => (
                      <Badge
                        variant={d.status === 'VALID' ? 'success' : d.status === 'EXPIRING_SOON' ? 'warning' : 'danger'}
                        dot
                      >
                        {d.status === 'VALID' ? 'Valid' : d.status === 'EXPIRING_SOON' ? 'Expiring Soon' : 'EXPIRED'}
                      </Badge>
                    ),
                  },
                ]}
              />
            </div>
          )}

          {/* SETTINGS VIEW (COMPANY PROFILE) */}
          {activeTab === 'settings' && <CompanyProfilePage />}

          {/* USERS VIEW (USER & ROLE MANAGEMENT) */}
          {activeTab === 'users' && <UserManagementPage />}

          {/* REPORTS & ANALYTICS VIEW */}
          {activeTab === 'reports' && (
            <ReportsView userRole={authRole || 'OPERATIONS'} />
          )}

          {/* OTHER TABS PLACEHOLDER WITH ARCHITECTURAL DETAIL */}
          {['maintenance'].includes(activeTab) && (
            <div className="max-w-4xl mx-auto py-12 text-center bg-white rounded-xl border border-slate-200 p-8 shadow-xs">
              <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 capitalize">
                {activeTab.replace('_', ' ')} Module Prepared
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-md mx-auto">
                Authentication, PostgreSQL models, and security permissions are active. Granular forms for this module will be activated in upcoming phases.
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors"
                >
                  Return to Dashboard
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        userRole={store.currentRole}
        pendingSettlementsCount={metrics.pendingSettlements}
      />

      {/* User Profile & Multi-Tenant Switch Modal */}
      <UserProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />

      {/* Quick Dispatch Modal */}
      <Modal
        isOpen={isQuickTripOpen}
        onClose={() => setIsQuickTripOpen(false)}
        title="Dispatch New Fleet Trip"
        subtitle="Assign vehicle, driver, load weight, and record initial cash advance"
        maxWidth="lg"
      >
        <form onSubmit={handleCreateTrip} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Select Customer / Consignor
              </label>
              <select
                value={newTripCustomer}
                onChange={(e) => setNewTripCustomer(e.target.value)}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500"
                required
              >
                {store.customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.city})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Select Vehicle / Truck
              </label>
              <select
                value={newTripVehicle}
                onChange={(e) => setNewTripVehicle(e.target.value)}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500"
                required
              >
                {store.vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registrationNumber} - {v.vehicleType} ({v.status})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Select Driver
              </label>
              <select
                value={newTripDriver}
                onChange={(e) => setNewTripDriver(e.target.value)}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500"
                required
              >
                {store.drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName} (DL: {d.licenseNumber})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Goods Description
              </label>
              <input
                type="text"
                value={newTripGoods}
                onChange={(e) => setNewTripGoods(e.target.value)}
                placeholder="e.g. TMT Steel, Paper, Jute, Cement"
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Origin City
              </label>
              <input
                type="text"
                value={newTripOrigin}
                onChange={(e) => setNewTripOrigin(e.target.value)}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Destination City
              </label>
              <input
                type="text"
                value={newTripDestination}
                onChange={(e) => setNewTripDestination(e.target.value)}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Weight (Metric Tonnes)
              </label>
              <input
                type="number"
                step="0.1"
                value={newTripWeight}
                onChange={(e) => setNewTripWeight(e.target.value)}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Agreed Freight Rate (₹ / Tonne)
              </label>
              <input
                type="number"
                value={newTripRate}
                onChange={(e) => setNewTripRate(e.target.value)}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Driver Cash Advance Handover (₹)
              </label>
              <input
                type="number"
                value={newTripAdvance}
                onChange={(e) => setNewTripAdvance(e.target.value)}
                placeholder="15000"
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                Cash given at dispatch for en-route diesel, toll, and food. Does NOT count as an expense until settled.
              </span>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
            <div className="text-xs text-slate-600">
              Est. Total Freight:{' '}
              <span className="font-bold text-indigo-700 text-sm">
                ₹{((parseFloat(newTripWeight) || 0) * (parseFloat(newTripRate) || 0)).toLocaleString()}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsQuickTripOpen(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs"
              >
                Confirm & Dispatch
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Mobile Bottom Navigation & Slide-out Drawer */}
      <MobileNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        userRole={store.currentRole}
        pendingSettlementsCount={metrics.pendingSettlements}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
