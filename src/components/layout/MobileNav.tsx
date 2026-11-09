import React, { useState } from 'react';
import {
  Anchor,
  Menu,
  X,
  LayoutDashboard,
  Navigation,
  Receipt,
  Scale,
  MoreHorizontal,
  Truck,
  Users,
  Building2,
  Wallet,
  FileText,
  CreditCard,
  FileCheck2,
  Wrench,
  BarChart3,
  Building,
  ShieldCheck,
} from 'lucide-react';
import { ActiveTab } from './Sidebar';
import { UserRole } from '../../types/tms';

interface MobileNavProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  userRole: UserRole;
  pendingSettlementsCount?: number;
}

export const MobileNav: React.FC<MobileNavProps> = ({
  activeTab,
  onSelectTab,
  userRole,
  pendingSettlementsCount = 0,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const allNavItems: { id: ActiveTab; label: string; icon: React.ElementType; roles: UserRole[] }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'] },
    { id: 'trips', label: 'Trips & Dispatch', icon: Navigation, roles: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'] },
    { id: 'vehicles', label: 'Vehicles / Trucks', icon: Truck, roles: ['OWNER', 'ADMIN', 'MANAGER', 'OPERATIONS'] },
    { id: 'drivers', label: 'Drivers', icon: Users, roles: ['OWNER', 'ADMIN', 'MANAGER', 'OPERATIONS'] },
    { id: 'customers', label: 'Customers', icon: Building2, roles: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT'] },
    { id: 'expenses', label: 'Trip Expenses', icon: Receipt, roles: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'] },
    { id: 'advances', label: 'Driver Advances', icon: Wallet, roles: ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'] },
    { id: 'settlements', label: 'Trip Settlements', icon: Scale, roles: ['OWNER', 'ADMIN', 'ACCOUNTANT'] },
    { id: 'invoices', label: 'Invoices & Billing', icon: FileText, roles: ['OWNER', 'ADMIN', 'ACCOUNTANT'] },
    { id: 'payments', label: 'Payments', icon: CreditCard, roles: ['OWNER', 'ADMIN', 'ACCOUNTANT'] },
    { id: 'documents', label: 'Vehicle Documents', icon: FileCheck2, roles: ['OWNER', 'ADMIN', 'MANAGER', 'OPERATIONS'] },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench, roles: ['OWNER', 'ADMIN', 'MANAGER', 'OPERATIONS'] },
    { id: 'reports', label: 'Reports', icon: BarChart3, roles: ['OWNER', 'ADMIN', 'ACCOUNTANT'] },
    { id: 'settings', label: 'Company Settings', icon: Building, roles: ['OWNER', 'ADMIN'] },
    { id: 'users', label: 'User Roles', icon: ShieldCheck, roles: ['OWNER'] },
  ];

  const visibleDrawerItems = allNavItems.filter((i) => i.roles.includes(userRole));

  return (
    <>
      {/* Mobile Bottom Navigation Bar (md:hidden) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-slate-200 z-40 flex items-center justify-around px-2 shadow-lg">
        <button
          onClick={() => onSelectTab('dashboard')}
          className={`flex flex-col items-center justify-center flex-1 py-1 ${
            activeTab === 'dashboard' ? 'text-indigo-600 font-bold' : 'text-slate-500'
          }`}
        >
          <LayoutDashboard className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">Home</span>
        </button>

        <button
          onClick={() => onSelectTab('trips')}
          className={`flex flex-col items-center justify-center flex-1 py-1 ${
            activeTab === 'trips' ? 'text-indigo-600 font-bold' : 'text-slate-500'
          }`}
        >
          <Navigation className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">Trips</span>
        </button>

        <button
          onClick={() => onSelectTab('expenses')}
          className={`flex flex-col items-center justify-center flex-1 py-1 ${
            activeTab === 'expenses' ? 'text-indigo-600 font-bold' : 'text-slate-500'
          }`}
        >
          <Receipt className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">Fuel/Exp</span>
        </button>

        <button
          onClick={() => onSelectTab('settlements')}
          className={`relative flex flex-col items-center justify-center flex-1 py-1 ${
            activeTab === 'settlements' ? 'text-indigo-600 font-bold' : 'text-slate-500'
          }`}
        >
          <Scale className="w-5 h-5" />
          {pendingSettlementsCount > 0 && (
            <span className="absolute top-0 right-4 w-4 h-4 bg-amber-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center">
              {pendingSettlementsCount}
            </span>
          )}
          <span className="text-[10px] mt-0.5">Settle</span>
        </button>

        <button
          onClick={() => setDrawerOpen(true)}
          className="flex flex-col items-center justify-center flex-1 py-1 text-slate-500 hover:text-slate-900"
        >
          <MoreHorizontal className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">More</span>
        </button>
      </nav>

      {/* Slide-out Mobile Navigation Drawer */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
            onClick={() => setDrawerOpen(false)}
          />

          <div className="relative w-4/5 max-w-xs bg-slate-900 text-white flex flex-col h-full z-10 shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm">
                  <Anchor className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">AnchorTransport</h3>
                  <p className="text-[10px] text-slate-400">Fleet Management System</p>
                </div>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
              {visibleDrawerItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onSelectTab(item.id);
                      setDrawerOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-indigo-600 text-white font-semibold'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-4 h-4 text-slate-400" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="p-3 border-t border-slate-800 text-[11px] text-slate-400">
              Logged in as: <span className="font-bold text-indigo-400">{userRole}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
