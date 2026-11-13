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
  clearStoreForNewCustomer,
} from './lib/storage';
import {
  clearCompanyOperationalDataInFirestore,
  syncEntityToFirestore,
  type HydratedCompanyBundle,
} from './lib/firebase/firestoreService';
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
  const {
    user,
    company: authCompany,
    role: authRole,
    isAuthenticated,
    needsOnboarding,
    isLoading,
    isEmailVerified,
    isFirebaseUser,
    resendVerification,
    refreshVerificationStatus,
  } = useAuth();
  const [authScreen, setAuthScreen] = useState<'login' | 'register'>('login');
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  const [store, setStore] = useState<TmsStore>(() => loadStore());
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [verificationBusy, setVerificationBusy] = useState(false);

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

  // Synchronize company context and clear store if unauthenticated
  useEffect(() => {
    if (!isAuthenticated) {
      setStore(clearStoreForNewCustomer());
      return;
    }
    if (authCompany) {
      setStore((prev) => ({
        ...prev,
        company: authCompany,
        currentRole: authRole || prev.currentRole,
      }));
    }
  }, [authCompany, authRole, isAuthenticated]);

  // Listen to full Firestore company hydration bundle
  useEffect(() => {
    const onHydrated = (e: Event) => {
      const custom = e as CustomEvent<{ companyId: string; bundle: HydratedCompanyBundle }>;
      const bundle = custom.detail?.bundle;
      if (!bundle) return;
      setStore((prev) => ({
        ...prev,
        vehicles: bundle.vehicles || [],
        drivers: bundle.drivers || [],
        customers: bundle.customers || [],
        trips: bundle.trips || [],
        expenses: bundle.expenses || [],
        advances: bundle.advances || [],
        settlements: bundle.settlements || [],
        invoices: bundle.invoices || [],
        payments: bundle.payments || [],
        documents: bundle.documents || [],
      }));
    };
    window.addEventListener('tms:firestore-hydrated', onHydrated);
    return () => window.removeEventListener('tms:firestore-hydrated', onHydrated);
  }, []);

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

  // Synchronize trips, expenses, advances, settlements, invoices, documents updates
  useEffect(() => {
    const fetchLiveOperations = async () => {
      try {
        const activeToken = localStorage.getItem('token') || '';
        if (!activeToken || !authCompany?.id) return;
        const headers = { Authorization: `Bearer ${activeToken}` };
        const [tRes, dRes] = await Promise.all([
          fetch('/api/trips?limit=100', { headers }),
          fetch('/api/fleet/documents?limit=100', { headers }),
        ]);
        const [tData, dData] = await Promise.all([
          parseResponseJson<any>(tRes),
          parseResponseJson<any>(dRes),
        ]);
        setStore((prev) => ({
          ...prev,
          trips: tRes.ok && tData?.success && Array.isArray(tData.data) ? tData.data : prev.trips,
          documents: dRes.ok && dData?.success && Array.isArray(dData.data) ? dData.data : prev.documents,
        }));
      } catch {
        // ignore
      }
    };

    const onOpsUpdated = () => fetchLiveOperations();
    window.addEventListener('tms:trip-updated', onOpsUpdated);
    window.addEventListener('tms:document-updated', onOpsUpdated);
    return () => {
      window.removeEventListener('tms:trip-updated', onOpsUpdated);
      window.removeEventListener('tms:document-updated', onOpsUpdated);
    };
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
    setIsResetDialogOpen(true);
  };

  const confirmResetAllData = async () => {
    setIsResetting(true);
    try {
      const activeToken = localStorage.getItem('token') || '';
      await fetch('/api/fleet/reset-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
        },
        body: JSON.stringify({ scope: 'current_company' }),
      });
      await clearCompanyOperationalDataInFirestore(authCompany?.id);
      const fresh = clearStoreForNewCustomer();
      setStore(fresh);
      if (authCompany?.id) {
        window.dispatchEvent(
          new CustomEvent('tms:firestore-hydrated', {
            detail: {
              companyId: authCompany.id,
              bundle: {
                vehicles: [],
                drivers: [],
                customers: [],
                trips: [],
                expenses: [],
                advances: [],
                settlements: [],
                invoices: [],
                payments: [],
                documents: [],
              },
            },
          })
        );
      }
      showToast('All operational company data cleared.');
    } catch (err: any) {
      showToast(err?.message || 'Failed to clear operational data.');
    } finally {
      setIsResetting(false);
      setIsResetDialogOpen(false);
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

  // Handle Quick Trip Submission via Backend API + Firestore Sync
  const handleCreateTrip = async (e: React.FormEvent) => {
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

    const advanceRupees = parseFloat(newTripAdvance) || 0;
    const activeToken = localStorage.getItem('token') || '';

    try {
      const res = await fetch('/api/trips', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
        },
        body: JSON.stringify({
          customerId: customerObj.id,
          vehicleId: vehicleObj.id,
          driverId: driverObj.id,
          originCity: newTripOrigin.trim(),
          destinationCity: newTripDestination.trim(),
          goodsType: newTripGoods.trim(),
          weightTonnes: weight,
          ratePerTonnePaise: Math.round(rateRupees * 100),
          initialAdvanceRupees: advanceRupees,
          status: 'DISPATCHED',
          startOdometerKm: vehicleObj.currentOdometerKm,
        }),
      });

      const data = await parseResponseJson<any>(res);
      if (!res.ok || !data || !data.success || !data.trip) {
        showToast(data?.error || 'Failed to dispatch trip.');
        return;
      }

      const activeCompanyId = authCompany?.id || store.company.id;
      await Promise.all([
        syncEntityToFirestore(activeCompanyId, 'trips', data.trip),
        data.vehicle ? syncEntityToFirestore(activeCompanyId, 'vehicles', data.vehicle) : Promise.resolve(),
        data.driver ? syncEntityToFirestore(activeCompanyId, 'drivers', data.driver) : Promise.resolve(),
        data.advance ? syncEntityToFirestore(activeCompanyId, 'advances', data.advance) : Promise.resolve(),
      ]);

      setStore((prev) => ({
        ...prev,
        trips: [data.trip, ...prev.trips.filter((t) => t.id !== data.trip.id)],
        vehicles: data.vehicle
          ? prev.vehicles.map((v) => (v.id === data.vehicle.id ? data.vehicle : v))
          : prev.vehicles,
        drivers: data.driver
          ? prev.drivers.map((d) => (d.id === data.driver.id ? data.driver : d))
          : prev.drivers,
        advances: data.advance
          ? [data.advance, ...prev.advances]
          : prev.advances,
      }));

      window.dispatchEvent(new CustomEvent('tms:trip-updated'));
      window.dispatchEvent(new CustomEvent('tms:vehicle-updated'));
      window.dispatchEvent(new CustomEvent('tms:driver-updated'));

      resetQuickTripForm();
      setIsQuickTripOpen(false);
      showToast(`Trip ${data.trip.tripNumber} (${vehicleObj.registrationNumber}) dispatched successfully!`);
    } catch (err: any) {
      showToast(err?.message || 'Network error dispatching trip.');
    }
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
            resetQuickTripForm();
            setIsQuickTripOpen(true);
          }}
          onOpenProfile={() => setIsProfileModalOpen(true)}
        />

        {/* Email Verification Reminder Banner for Unverified Firebase Users */}
        {isFirebaseUser && !isEmailVerified && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Verify your email address (<strong>{user?.email}</strong>) to unlock cloud persistence in Firestore.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={verificationBusy}
                onClick={async () => {
                  setVerificationBusy(true);
                  const res = await resendVerification();
                  setVerificationBusy(false);
                  showToast(res.sent ? 'Verification email sent. Check your inbox.' : res.error || 'Could not send email.');
                }}
                className="px-2.5 py-1 rounded border border-amber-300 bg-white hover:bg-amber-100 font-semibold text-amber-900 cursor-pointer disabled:opacity-50"
              >
                Resend Email
              </button>
              <button
                type="button"
                disabled={verificationBusy}
                onClick={async () => {
                  setVerificationBusy(true);
                  const res = await refreshVerificationStatus();
                  setVerificationBusy(false);
                  showToast(
                    res.verified
                      ? 'Email verified! Syncing your data to Firebase Firestore...'
                      : res.error || 'Email is not verified yet. Please click the link in your inbox.'
                  );
                }}
                className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer disabled:opacity-50"
              >
                I&apos;ve Verified &mdash; Sync Now
              </button>
            </div>
          </div>
        )}

        {/* Scrollable Viewport Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 pb-20 md:pb-6">
          {/* DASHBOARD VIEW */}
          {activeTab === 'dashboard' && (
            <DashboardView
              onQuickDispatch={() => {
                resetQuickTripForm();
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

      {/* Confirm Data Reset Dialog */}
      <ConfirmDialog
        isOpen={isResetDialogOpen}
        title="Clear All Operational Data?"
        message="This will remove all customers, trucks, drivers, trips, expenses, advances, settlements, and invoices for this company so you can start with an empty workspace. Your company profile and account remain intact."
        confirmLabel="Yes, Clear All Data"
        cancelLabel="Cancel"
        variant="danger"
        isLoading={isResetting}
        onConfirm={confirmResetAllData}
        onClose={() => setIsResetDialogOpen(false)}
      />

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
