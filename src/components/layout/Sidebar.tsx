import React from 'react';
import {
  Anchor,
  LayoutDashboard,
  Navigation,
  Truck,
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
  ChevronRight,
} from 'lucide-react';
import { UserRole } from '../../types/tms';
import { ROLE_PERMISSIONS } from '../../lib/permissions';

export type ActiveTab = 
  | 'dashboard'
  | 'trips'
  | 'vehicles'
  | 'drivers'
  | 'customers'
  | 'expenses'
  | 'advances'
  | 'settlements'
  | 'invoices'
  | 'payments'
  | 'documents'
  | 'maintenance'
  | 'reports'
  | 'settings';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  userRole: UserRole;
  pendingSettlementsCount?: number;
  expiringDocsCount?: number;
}

interface NavItem {
  id: ActiveTab;
  label: string;
  icon: React.ElementType;
  badge?: number;
  badgeVariant?: 'amber' | 'emerald' | 'rose' | 'indigo';
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  userRole = 'OWNER',
  pendingSettlementsCount = 0,
  expiringDocsCount = 0,
}) => {
  const perms = ROLE_PERMISSIONS[userRole] || ROLE_PERMISSIONS.OWNER;
  const sections: NavSection[] = [
    {
      title: 'FLEET OPERATIONS',
      items: [
        {
          id: 'dashboard',
          label: 'Dashboard',
          icon: LayoutDashboard,
        },
        {
          id: 'trips',
          label: 'Trips & Dispatch',
          icon: Navigation,
        },
        {
          id: 'vehicles',
          label: 'Vehicles / Trucks',
          icon: Truck,
        },
        {
          id: 'drivers',
          label: 'Drivers',
          icon: Users,
        },
        {
          id: 'customers',
          label: 'Customers (Parties)',
          icon: Building2,
        },
      ],
    },
    {
      title: 'TRIP FINANCIALS',
      items: [
        {
          id: 'expenses',
          label: 'Expenses & Fuel',
          icon: Receipt,
        },
        {
          id: 'advances',
          label: 'Driver Advances',
          icon: Wallet,
        },
        {
          id: 'settlements',
          label: 'Trip Settlements',
          icon: Scale,
          badge: pendingSettlementsCount > 0 ? pendingSettlementsCount : undefined,
          badgeVariant: 'amber',
        },
        {
          id: 'invoices',
          label: 'Invoices & Billing',
          icon: FileText,
        },
        {
          id: 'payments',
          label: 'Payments & Ledger',
          icon: CreditCard,
        },
      ],
    },
    {
      title: 'COMPLIANCE & FLEET',
      items: [
        {
          id: 'documents',
          label: 'Vehicle Documents',
          icon: FileCheck2,
          badge: expiringDocsCount > 0 ? expiringDocsCount : undefined,
          badgeVariant: 'rose',
        },
        {
          id: 'maintenance',
          label: 'Maintenance',
          icon: Wrench,
        },
      ],
    },
    {
      title: 'ANALYTICS & CONTROL',
      items: [
        {
          id: 'reports',
          label: 'Business Reports',
          icon: BarChart3,
        },
        {
          id: 'settings',
          label: 'Company Settings',
          icon: Building,
        },
      ],
    },
  ];

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 text-slate-300 flex flex-col h-full shrink-0 select-none">
      {/* Brand Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
            <Anchor className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-white text-base tracking-tight leading-none">
              Anchor<span className="text-indigo-400">Transport</span>
            </h1>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">Fleet Management System</p>
          </div>
        </div>
      </div>

      {/* Navigation Menu */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {sections.map((section, sIdx) => (
          <div key={sIdx}>
            <h2 className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
              {section.title}
            </h2>
            <div className="space-y-0.5">
              {section.items
                .filter((item) => {
                  if (item.id === 'invoices') return perms.canGenerateInvoices;
                  if (item.id === 'payments') return perms.canRecordPayments;
                  if (item.id === 'settlements') return perms.canSettleTrips;
                  if (item.id === 'reports') return perms.canViewReports;
                  return true;
                })
                .map((item) => {
                const isActive = activeTab === item.id;
                const Icon = item.icon;

                return (
                  <button
                    key={item.id}
                    onClick={() => onSelectTab(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                      <span>{item.label}</span>
                    </div>

                    {item.badge !== undefined && (
                      <span
                        className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${
                          isActive
                            ? 'bg-white text-indigo-700'
                            : item.badgeVariant === 'amber'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer / Role Access Indicator */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/60">
        <div className="px-2 py-1.5 rounded-md bg-slate-900 border border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
          <span>Workspace Access:</span>
          <span className="font-semibold text-indigo-300 uppercase">{userRole}</span>
        </div>
      </div>
    </aside>
  );
};
