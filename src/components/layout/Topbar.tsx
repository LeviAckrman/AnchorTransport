import React, { useState } from 'react';
import {
  Building2,
  ShieldCheck,
  ChevronDown,
  Plus,
  RefreshCw,
  User,
  LogOut,
  SlidersHorizontal,
} from 'lucide-react';
import { Company, UserRole } from '../../types/tms';
import { useAuth } from '../../context/AuthContext';

interface TopbarProps {
  company: Company;
  currentRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  onResetData: () => void;
  onQuickDispatch: () => void;
  onOpenProfile: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  company,
  currentRole,
  onRoleChange,
  onResetData,
  onQuickDispatch,
  onOpenProfile,
}) => {
  const { user, accessibleCompanies, switchCompany, logout } = useAuth();
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);

  const roles: { id: UserRole; label: string; desc: string }[] = [
    { id: 'OWNER', label: 'Owner', desc: 'Full business & financial authority' },
    { id: 'ADMIN', label: 'Admin', desc: 'Fleet operations & user setup' },
    { id: 'MANAGER', label: 'Manager', desc: 'Trip dispatch, fleet & driver tracking' },
    { id: 'ACCOUNTANT', label: 'Accountant', desc: 'Trip settlement, billing & ledger' },
    { id: 'OPERATIONS', label: 'Operations Staff', desc: 'Daily log & driver advance entry' },
  ];

  return (
    <header className="h-16 bg-white border-b border-slate-200/90 px-4 sm:px-6 flex items-center justify-between shrink-0 select-none z-20">
      {/* Left: Company Profile & Multi-Company Switcher */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <button
            onClick={() => setCompanyMenuOpen(!companyMenuOpen)}
            className="flex items-center gap-2.5 text-left p-1.5 rounded-xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-200"
          >
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-700 hidden sm:block">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm sm:text-base font-bold text-slate-900 leading-tight">
                  {company.name}
                </h2>
                {accessibleCompanies.length > 1 && (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                )}
              </div>
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <span>{company.city}, {company.state} (Zone {company.stateCode})</span>
                <span className="text-slate-300">•</span>
                <span className="text-emerald-700 font-medium">GSTIN: {company.gstin}</span>
              </p>
            </div>
          </button>

          {/* Company Switcher Dropdown */}
          {companyMenuOpen && accessibleCompanies.length > 1 && (
            <div className="absolute left-0 mt-1.5 w-72 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50">
              <div className="px-3 py-2 border-b border-slate-100">
                <p className="text-xs font-bold text-slate-900">Switch Company / Tenant</p>
                <p className="text-[11px] text-slate-500">Your authorized fleet organizations</p>
              </div>
              <div className="py-1">
                {accessibleCompanies.map((c) => (
                  <button
                    key={c.companyId}
                    onClick={() => {
                      switchCompany(c.companyId);
                      setCompanyMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex flex-col transition-colors ${
                      company.id === c.companyId
                        ? 'bg-indigo-50 text-indigo-900 font-semibold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{c.companyName}</span>
                      {company.id === c.companyId && (
                        <span className="text-[10px] text-indigo-600 font-bold">Active</span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 uppercase">Role: {c.role}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Controls: Role Switcher, Quick Actions, User Profile */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Role Switcher Pill */}
        <div className="relative">
          <button
            onClick={() => setRoleMenuOpen(!roleMenuOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200/80 text-slate-700 border border-slate-200 transition-colors"
          >
            <ShieldCheck className="w-4 h-4 text-indigo-600" />
            <span className="hidden sm:inline">Role:</span>
            <span className="text-indigo-700 font-bold">{currentRole}</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {roleMenuOpen && (
            <div className="absolute right-0 mt-1.5 w-64 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50">
              <div className="px-3 py-2 border-b border-slate-100">
                <p className="text-xs font-bold text-slate-900">Switch Permission Role</p>
                <p className="text-[11px] text-slate-500">Test multi-role permissions in real-time</p>
              </div>
              <div className="py-1">
                {roles.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => {
                      onRoleChange(r.id);
                      setRoleMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex flex-col transition-colors ${
                      currentRole === r.id
                        ? 'bg-indigo-50 text-indigo-900 font-semibold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{r.label}</span>
                      {currentRole === r.id && (
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 font-normal">{r.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Reset Store Button */}
        <button
          onClick={onResetData}
          title="Reset to default seed data"
          className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors border border-transparent hover:border-slate-200 hidden sm:flex items-center gap-1 text-xs"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Reset Data</span>
        </button>

        {/* Quick Dispatch CTA Button */}
        <button
          onClick={onQuickDispatch}
          className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>New Trip</span>
        </button>

        {/* User Profile Avatar Button */}
        <button
          onClick={onOpenProfile}
          title="User profile & security session"
          className="flex items-center gap-2 p-1.5 pl-2 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">
            {user?.name ? user.name[0] : 'U'}
          </div>
          <span className="text-xs font-semibold text-slate-800 hidden md:inline">
            {user?.name ? user.name.split(' ')[0] : 'User'}
          </span>
        </button>
      </div>
    </header>
  );
};
