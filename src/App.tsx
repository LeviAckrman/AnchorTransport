/**
 * AnchorTransport TMS - Main Application Entry & Layout Architecture
 * Authoritative Firebase Auth + Real-Time Firestore Data Architecture
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  X,
} from 'lucide-react';

import {
  clearClientTmsCaches,
} from './lib/storage';
import {
  clearCompanyOperationalDataInFirestore,
  createOrUpdateTripInFirestore,
} from './lib/firebase/firestoreService';
import {
  calculateDocComplianceStatus,
  getNextLrNumber,
  getNextTripNumber,
} from './lib/tmsCalculations';
import {
  UserRole,
  Trip,
  DriverAdvance,
} from './types/tms';

// UI Components
import { Sidebar, ActiveTab } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { MobileNav } from './components/layout/MobileNav';
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
import { MaintenanceView } from './modules/maintenance/MaintenanceView';

// Auth, Firestore Data & Security Components
import { AuthProvider, useAuth } from './context/AuthContext';
import { FirestoreDataProvider, useFirestoreData } from './context/FirestoreDataContext';
import { LoginPage } from './components/auth/LoginPage';
import { RegisterPage } from './components/auth/RegisterPage';
import { EmailVerificationPage } from './components/auth/EmailVerificationPage';
import { CompanyOnboardingPage } from './components/auth/CompanyOnboardingPage';
import { CompanyProfilePage } from './components/auth/CompanyProfilePage';
import { UserProfileModal } from './components/auth/UserProfileModal';

function AppContent() {
  const {
    user,
    role: authRole,
    isAuthenticated,
    needsOnboarding,
    onboardingCompleted,
    isLoading,
    isEmailVerified,
    isFirebaseUser,
    logout,
    permissions,
  } = useAuth();

  const {
    company,
    vehicles,
    drivers,
    customers,
    trips,
    documents,
    error: firestoreError,
    clearError: clearFirestoreError,
  } = useFirestoreData();

  const pendingSettlementsCount = useMemo(
    () =>
      trips.filter(
        (t) => (t.status === 'DELIVERED' || t.status === 'COMPLETED') && !t.isSettled
      ).length,
    [trips]
  );

  const expiringDocsCount = useMemo(
    () =>
      documents.filter((d) => {
        const comp = calculateDocComplianceStatus(d.expiryDate);
        return comp.status === 'EXPIRED' || comp.status === 'EXPIRING_SOON';
      }).length,
    [documents]
  );

  const effectiveRole: UserRole = authRole || 'OWNER';

  const [authScreen, setAuthScreen] = useState<'login' | 'register'>('login');
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [toastMessage, setToastMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Quick Dispatch Modal State
  const [isQuickTripOpen, setIsQuickTripOpen] = useState(false);
  const [quickTripSubmitting, setQuickTripSubmitting] = useState(false);
  const [quickTripError, setQuickTripError] = useState<string | null>(null);
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
    setQuickTripError(null);
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

  // Reset ephemeral UI view state when signed out (never touches Firestore)
  useEffect(() => {
    if (!isAuthenticated) {
      setActiveTab('dashboard');
      setAuthScreen('login');
      setIsProfileModalOpen(false);
      setIsQuickTripOpen(false);
      setIsResetDialogOpen(false);
    }
  }, [isAuthenticated]);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleResetData = () => {
    if (!permissions?.canManageCompany) {
      showToast('Only the authorized company Owner can clear company operational data.', 'error');
      return;
    }
    setIsResetDialogOpen(true);
  };

  const confirmResetAllData = async () => {
    if (!company?.id) return;
    setIsResetting(true);
    try {
      await clearCompanyOperationalDataInFirestore(company.id);
      clearClientTmsCaches();
      showToast('All operational company data cleared in Firestore.');
    } catch (err: any) {
      showToast(err?.message || 'Failed to clear operational data.', 'error');
    } finally {
      setIsResetting(false);
      setIsResetDialogOpen(false);
    }
  };

  // Quick Dispatch Submission -> Atomic Firestore writeBatch
  const handleCreateTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuickTripError(null);
    if (!company?.id) {
      const msg = 'No active company selected.';
      setQuickTripError(msg);
      showToast(msg, 'error');
      return;
    }
    if (!newTripCustomer || !newTripVehicle || !newTripDriver) {
      const msg = 'Please select customer, vehicle, and driver.';
      setQuickTripError(msg);
      return;
    }
    if (!newTripOrigin.trim() || !newTripDestination.trim()) {
      const msg = 'Please provide both loading origin and unloading destination cities.';
      setQuickTripError(msg);
      return;
    }
    if (!newTripGoods.trim()) {
      const msg = 'Please enter commodity / goods description.';
      setQuickTripError(msg);
      return;
    }

    const weight = parseFloat(newTripWeight);
    const rateRupees = parseFloat(newTripRate);
    if (isNaN(weight) || weight <= 0) {
      setQuickTripError('Cargo weight must be a positive number in tonnes.');
      return;
    }
    if (isNaN(rateRupees) || rateRupees <= 0) {
      setQuickTripError('Freight rate per tonne must be greater than zero.');
      return;
    }

    const customerObj = customers.find((c) => c.id === newTripCustomer);
    const vehicleObj = vehicles.find((v) => v.id === newTripVehicle);
    const driverObj = drivers.find((d) => d.id === newTripDriver);

    if (!customerObj || !vehicleObj || !driverObj) {
      setQuickTripError('Selected customer, vehicle, or driver could not be found.');
      return;
    }

    const advanceRupees = parseFloat(newTripAdvance) || 0;
    const advancePaise = Math.max(0, Math.round(advanceRupees * 100));
    const ratePerTonnePaise = Math.round(rateRupees * 100);
    const freightAmountPaise = Math.round(weight * ratePerTonnePaise);
    const todayStr = new Date().toISOString().split('T')[0];

    const tripId = `trip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const tripNumber = getNextTripNumber(trips, company);
    const lrNumber = getNextLrNumber(trips, company);

    const newTrip: Trip = {
      id: tripId,
      companyId: company.id,
      tripNumber,
      lrNumber,
      customerId: customerObj.id,
      customerName: customerObj.name,
      ...(customerObj.gstin ? { customerGstin: customerObj.gstin } : {}),
      vehicleId: vehicleObj.id,
      vehicleReg: vehicleObj.registrationNumber,
      driverId: driverObj.id,
      driverName: driverObj.fullName,
      driverPhone: driverObj.phone,
      originCity: newTripOrigin.trim(),
      destinationCity: newTripDestination.trim(),
      goodsType: newTripGoods.trim(),
      weightTonnes: weight,
      ratePerTonnePaise,
      freightAmountPaise,
      otherChargesPaise: 0,
      totalRevenuePaise: freightAmountPaise,
      dispatchDate: todayStr,
      expectedDeliveryDate: new Date(Date.now() + 2 * 86400 * 1000).toISOString().split('T')[0],
      status: 'DISPATCHED',
      startOdometerKm: vehicleObj.currentOdometerKm || 0,
      podReceived: false,
      totalExpensesPaise: 0,
      totalAdvancesPaise: advancePaise,
      tripContributionPaise: freightAmountPaise,
      isSettled: false,
      isInvoiced: false,
      createdAt: new Date().toISOString(),
    };

    const initialAdvance: DriverAdvance | null =
      advancePaise > 0
        ? {
            id: `adv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            companyId: company.id,
            tripId,
            tripNumber,
            driverId: driverObj.id,
            driverName: driverObj.fullName,
            vehicleReg: vehicleObj.registrationNumber,
            amountPaise: advancePaise,
            advanceType: 'CASH_DISPATCH',
            paymentMode: 'CASH',
            date: todayStr,
            reference: 'Initial Dispatch Handover',
            disbursedBy: user?.name || 'Dispatch Desk',
            isSettled: false,
            createdAt: new Date().toISOString(),
          }
        : null;

    setQuickTripSubmitting(true);
    try {
      await createOrUpdateTripInFirestore(company.id, {
        trip: newTrip,
        vehicle: vehicleObj,
        driver: driverObj,
        initialAdvance,
      });

      resetQuickTripForm();
      setIsQuickTripOpen(false);
      showToast(`Trip ${tripNumber} (${vehicleObj.registrationNumber}) saved to Firestore!`, 'success');
    } catch (err: any) {
      const msg = err?.message || 'Failed to dispatch trip.';
      setQuickTripError(msg);
      showToast(msg, 'error');
    } finally {
      setQuickTripSubmitting(false);
    }
  };

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

  if (!isAuthenticated) {
    if (authScreen === 'register') {
      return <RegisterPage onSwitchToLogin={() => setAuthScreen('login')} />;
    }
    return <LoginPage onSwitchToRegister={() => setAuthScreen('register')} />;
  }

  // Strict Email Verification Protection: unverified users must NOT access onboarding or the TMS dashboard
  if (isFirebaseUser && !isEmailVerified) {
    return (
      <EmailVerificationPage
        onBackToLogin={async () => {
          setAuthScreen('login');
          await logout();
        }}
      />
    );
  }

  if (needsOnboarding && !onboardingCompleted) {
    return <CompanyOnboardingPage />;
  }

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden text-slate-900 antialiased font-sans">
      {toastMessage && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-lg shadow-xl text-xs sm:text-sm font-medium flex items-center gap-2 border animate-in fade-in slide-in-from-top-4 duration-200 ${
            toastMessage.type === 'success'
              ? 'bg-slate-900 text-white border-slate-700'
              : 'bg-rose-900 text-white border-rose-700'
          }`}
        >
          {toastMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-300 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Desktop Sidebar (hidden on mobile) */}
      <div className="hidden md:block h-full">
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          userRole={effectiveRole}
          pendingSettlementsCount={pendingSettlementsCount}
          expiringDocsCount={expiringDocsCount}
        />
      </div>

      {/* Main App Container */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <Topbar
          company={company}
          currentRole={effectiveRole}
          onResetData={handleResetData}
          onQuickDispatch={() => {
            resetQuickTripForm();
            setIsQuickTripOpen(true);
          }}
          onOpenProfile={() => setIsProfileModalOpen(true)}
        />

        {/* Firestore Sync Error Banner */}
        {firestoreError && (
          <div className="bg-rose-50 border-b border-rose-200 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-2 text-xs text-rose-900">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{firestoreError}</span>
            </div>
            <button
              type="button"
              onClick={clearFirestoreError}
              className="p-1 rounded hover:bg-rose-100 text-rose-700"
              aria-label="Dismiss error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Scrollable Viewport Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 pb-20 md:pb-6">
          {activeTab === 'dashboard' && (
            <DashboardView
              onQuickDispatch={() => {
                resetQuickTripForm();
                setIsQuickTripOpen(true);
              }}
              onNavigateTab={setActiveTab}
              userRole={effectiveRole}
            />
          )}

          {activeTab === 'trips' && <TripsView userRole={effectiveRole} />}
          {activeTab === 'vehicles' && <VehiclesView userRole={effectiveRole} />}
          {activeTab === 'drivers' && <DriversView userRole={effectiveRole} />}
          {activeTab === 'customers' && <CustomersView userRole={effectiveRole} />}
          {activeTab === 'expenses' && (
            <ExpensesView userRole={effectiveRole} onNavigateTab={setActiveTab} />
          )}
          {activeTab === 'advances' && (
            <DriverAdvancesView userRole={effectiveRole} onNavigateTab={setActiveTab} />
          )}
          {activeTab === 'settlements' && (
            <SettlementsView userRole={effectiveRole} onNavigateTab={setActiveTab} />
          )}
          {(activeTab === 'invoices' || activeTab === 'payments') && (
            <InvoicesView
              userRole={effectiveRole}
              initialTab={activeTab === 'payments' ? 'receivables' : 'invoices'}
              onNavigateTab={(tab) => setActiveTab(tab as ActiveTab)}
            />
          )}
          {activeTab === 'documents' && (
            <VehicleDocumentsView userRole={effectiveRole} onNavigateTab={(tab) => setActiveTab(tab as ActiveTab)} />
          )}
          {activeTab === 'settings' && <CompanyProfilePage />}
          {activeTab === 'reports' && <ReportsView userRole={effectiveRole} />}
          {activeTab === 'maintenance' && <MaintenanceView userRole={effectiveRole} />}
        </main>
      </div>

      {/* User Profile & Multi-Tenant Switch Modal */}
      <UserProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        fallbackCompany={company}
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
          {quickTripError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-700 text-xs font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{quickTripError}</span>
            </div>
          )}
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
                  {customers.length === 0
                    ? '-- No Customer Parties Registered --'
                    : '-- Choose Consignor / Client --'}
                </option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.city})
                  </option>
                ))}
              </select>
              {customers.length === 0 && (
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
                  {vehicles.length === 0
                    ? '-- No Commercial Trucks Registered --'
                    : '-- Choose Commercial Truck --'}
                </option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registrationNumber} - {v.vehicleType} ({v.status})
                  </option>
                ))}
              </select>
              {vehicles.length === 0 && (
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
                  {drivers.length === 0
                    ? '-- No Commercial Drivers Registered --'
                    : '-- Choose Commercial Driver --'}
                </option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName} (DL: {d.licenseNumber})
                  </option>
                ))}
              </select>
              {drivers.length === 0 && (
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
                disabled={quickTripSubmitting}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs disabled:opacity-50"
              >
                {quickTripSubmitting ? 'Dispatching...' : 'Confirm & Dispatch'}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Confirm Data Reset Dialog */}
      <ConfirmDialog
        isOpen={isResetDialogOpen}
        title="Clear All Operational Data?"
        message="This will permanently delete all customers, trucks, drivers, trips, expenses, advances, settlements, and invoices for this company from Firebase Firestore. Your company profile and account remain intact."
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
        userRole={effectiveRole}
        pendingSettlementsCount={pendingSettlementsCount}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <FirestoreDataProvider>
        <AppContent />
      </FirestoreDataProvider>
    </AuthProvider>
  );
}
