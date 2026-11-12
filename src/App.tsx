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
import { parseResponseJson } from './lib/safeFetch';
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
import { VehicleDocumentsView } from './modules/vehicles/VehicleDocumentsView';

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
  const [newTripOrigin, setNewTripOrigin] = useState('');
  const [newTripDestination, setNewTripDestination] = useState('');
  const [newTripWeight, setNewTripWeight] = useState('');
  const [newTripRate, setNewTripRate] = useState('');
  const [newTripAdvance, setNewTripAdvance] = useState('');
  const [newTripGoods, setNewTripGoods] = useState('');

  const resetQuickTripForm = () => {
    setNewTripCustomer('');
    setNewTripVehicle('');
    setNewTripDriver('');
    setNewTripOrigin('');
    setNewTripDestination('');
    setNewTripWeight('');
    setNewTripRate('');
    setNewTripAdvance('');
    setNewTripGoods('');
  };

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

  // Dynamically synchronize customers from API so customers only show after user adds them
  useEffect(() => {
    const fetchLiveCustomers = async () => {
      try {
        const activeToken = localStorage.getItem('token') || '';
        const res = await fetch('/api/customers?limit=100', {
          headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : {},
        });
        const data = await parseResponseJson<any>(res);
        if (res.ok && data?.success && Array.isArray(data.data)) {
          setStore((prev) => ({
            ...prev,
            customers: data.data,
          }));
        }
      } catch {
        // ignore
      }
    };

    fetchLiveCustomers();

    const onCustomerUpdated = () => fetchLiveCustomers();
    window.addEventListener('tms:customer-updated', onCustomerUpdated);
    return () => window.removeEventListener('tms:customer-updated', onCustomerUpdated);
  }, [authCompany?.id]);

  // Dynamically synchronize vehicles from API so trucks only show after user adds them
  useEffect(() => {
    const fetchLiveVehicles = async () => {
      try {
        const activeToken = localStorage.getItem('token') || '';
        const res = await fetch('/api/vehicles?limit=100', {
          headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : {},
        });
        const data = await parseResponseJson<any>(res);
        if (res.ok && data?.success && Array.isArray(data.data)) {
          setStore((prev) => ({
            ...prev,
            vehicles: data.data,
          }));
        }
      } catch {
        // ignore
      }
    };

    fetchLiveVehicles();

    const onVehicleUpdated = () => fetchLiveVehicles();
    window.addEventListener('tms:vehicle-updated', onVehicleUpdated);
    return () => window.removeEventListener('tms:vehicle-updated', onVehicleUpdated);
  }, [authCompany?.id]);

  // Dynamically synchronize drivers from API so drivers only show after user adds them
  useEffect(() => {
    const fetchLiveDrivers = async () => {
      try {
        const activeToken = localStorage.getItem('token') || '';
        const res = await fetch('/api/drivers?limit=100', {
          headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : {},
        });
        const data = await parseResponseJson<any>(res);
        if (res.ok && data?.success && Array.isArray(data.data)) {
          setStore((prev) => ({
            ...prev,
            drivers: data.data,
          }));
        }
      } catch {
        // ignore
      }
    };

    fetchLiveDrivers();

    const onDriverUpdated = () => fetchLiveDrivers();
    window.addEventListener('tms:driver-updated', onDriverUpdated);
    return () => window.removeEventListener('tms:driver-updated', onDriverUpdated);
  }, [authCompany?.id]);

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
      showToast('Please select customer, vehicle, and driver.');
      return;
    }
    if (!newTripOrigin.trim() || !newTripDestination.trim()) {
      showToast('Please provide both loading origin and unloading destination cities.');
      return;
    }
    if (!newTripGoods.trim()) {
      showToast('Please enter commodity / goods description.');
      return;
    }

    const weight = parseFloat(newTripWeight);
    const rateRupees = parseFloat(newTripRate);
    if (isNaN(weight) || weight <= 0) {
      showToast('Cargo weight must be a positive number in tonnes.');
      return;
    }
    if (isNaN(rateRupees) || rateRupees <= 0) {
      showToast('Freight rate per tonne must be greater than zero.');
      return;
    }

    const customerObj = store.customers.find((c) => c.id === newTripCustomer);
    const vehicleObj = store.vehicles.find((v) => v.id === newTripVehicle);
    const driverObj = store.drivers.find((d) => d.id === newTripDriver);

    if (!customerObj || !vehicleObj || !driverObj) {
      showToast('Selected customer, vehicle, or driver could not be found.');
      return;
    }

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
      originCity: newTripOrigin.trim(),
      destinationCity: newTripDestination.trim(),
      goodsType: newTripGoods.trim(),
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
        referenceNotes: `Dispatched on trip ${tripNum} (${newTripOrigin.trim()} -> ${newTripDestination.trim()})`,
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

    resetQuickTripForm();
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
            <VehicleDocumentsView userRole={authRole || 'OPERATIONS'} onNavigateTab={(tab) => setActiveTab(tab as ActiveTab)} />
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
        onClose={() => {
          resetQuickTripForm();
          setIsQuickTripOpen(false);
        }}
        title="Dispatch New Fleet Trip"
        subtitle="Assign vehicle, driver, load weight, and record initial cash advance"
        maxWidth="lg"
      >
        <form onSubmit={handleCreateTrip} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Select Customer / Consignor <span className="text-rose-500">*</span>
              </label>
              <select
                value={newTripCustomer}
                onChange={(e) => setNewTripCustomer(e.target.value)}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500"
                required
              >
                <option value="">
                  {store.customers.length === 0
                    ? '-- No Customer Parties Registered --'
                    : '-- Choose Consignor / Client --'}
                </option>
                {store.customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.city})
                  </option>
                ))}
              </select>
              {store.customers.length === 0 && (
                <div className="mt-1.5 p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between text-[11px] text-amber-800">
                  <span>No parties found. Add in Customer (Parties) first.</span>
                  <button
                    type="button"
                    onClick={() => {
                      resetQuickTripForm();
                      setIsQuickTripOpen(false);
                      setActiveTab('customers');
                    }}
                    className="text-indigo-700 font-bold underline hover:text-indigo-900 cursor-pointer ml-2"
                  >
                    Add Customer
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Select Vehicle / Truck <span className="text-rose-500">*</span>
              </label>
              <select
                value={newTripVehicle}
                onChange={(e) => setNewTripVehicle(e.target.value)}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500"
                required
              >
                <option value="">
                  {store.vehicles.length === 0
                    ? '-- No Commercial Trucks Registered --'
                    : '-- Choose Commercial Truck --'}
                </option>
                {store.vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registrationNumber} - {v.vehicleType} ({v.status})
                  </option>
                ))}
              </select>
              {store.vehicles.length === 0 && (
                <div className="mt-1.5 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start justify-between gap-2">
                  <div className="flex items-start gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold block">No commercial trucks registered yet.</span>
                      <span className="text-[11px] text-amber-700">
                        Trucks will only appear after you register them in Vehicles / Trucks.
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsQuickTripOpen(false);
                      setActiveTab('vehicles');
                    }}
                    className="px-2 py-1 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded shrink-0 cursor-pointer"
                  >
                    Go to Trucks
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Select Driver <span className="text-rose-500">*</span>
              </label>
              <select
                value={newTripDriver}
                onChange={(e) => setNewTripDriver(e.target.value)}
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500"
                required
              >
                <option value="">
                  {store.drivers.length === 0
                    ? '-- No Commercial Drivers Registered --'
                    : '-- Choose Commercial Driver --'}
                </option>
                {store.drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName} (DL: {d.licenseNumber})
                  </option>
                ))}
              </select>
              {store.drivers.length === 0 && (
                <div className="mt-1.5 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start justify-between gap-2">
                  <div className="flex items-start gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold block">No commercial drivers registered yet.</span>
                      <span className="text-[11px] text-amber-700">
                        Drivers will only appear after you register them in Drivers.
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsQuickTripOpen(false);
                      setActiveTab('drivers');
                    }}
                    className="px-2 py-1 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded shrink-0 cursor-pointer"
                  >
                    Go to Drivers
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Goods Description <span className="text-rose-500">*</span>
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
                Origin City <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={newTripOrigin}
                onChange={(e) => setNewTripOrigin(e.target.value)}
                placeholder="e.g. Kolkata, WB (Dankuni Hub)"
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Destination City <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={newTripDestination}
                onChange={(e) => setNewTripDestination(e.target.value)}
                placeholder="e.g. Siliguri, WB / Jamshedpur, JH"
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Weight (Metric Tonnes) <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                step="0.05"
                value={newTripWeight}
                onChange={(e) => setNewTripWeight(e.target.value)}
                placeholder="e.g. 24.5"
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800 font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Agreed Freight Rate (₹ / Tonne) <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                step="10"
                value={newTripRate}
                onChange={(e) => setNewTripRate(e.target.value)}
                placeholder="e.g. 2600"
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800 font-mono"
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
                placeholder="0"
                className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800 font-mono"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                Cash given at dispatch for en-route diesel, toll, and food. Does NOT count as an expense until settled.
              </span>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
            <div className="text-xs text-slate-600">
              {newTripWeight && newTripRate ? (
                <>
                  Est. Total Freight:{' '}
                  <span className="font-bold text-indigo-700 text-sm">
                    ₹{((parseFloat(newTripWeight) || 0) * (parseFloat(newTripRate) || 0)).toLocaleString()}
                  </span>
                </>
              ) : (
                <span className="text-slate-400 italic">Enter weight and rate to view freight estimate</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={resetQuickTripForm}
                className="px-3 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                title="Clear all fields"
              >
                Reset Form
              </button>
              <button
                type="button"
                onClick={() => {
                  resetQuickTripForm();
                  setIsQuickTripOpen(false);
                }}
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
