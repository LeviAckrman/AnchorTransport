import React, { useState } from 'react';
import {
  Building2,
  ShieldCheck,
  ChevronDown,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { Company, UserRole } from '../../types/tms';
import { useAuth } from '../../context/AuthContext';

interface TopbarProps {
  company: Company;
  currentRole: UserRole;
  onResetData: () => void;
  onQuickDispatch: () => void;
  onOpenProfile: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  company,
  currentRole,
  onResetData,
  onQuickDispatch,
  onOpenProfile,
}) => {
  const { user, accessibleCompanies, switchCompany, permissions } = useAuth();
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);

  const closeMenus = () => {
    setCompanyMenuOpen(false);
  };

  const locationSummary =
    company.city && company.state
      ? `${company.city}, ${company.state}${company.stateCode ? ` (Zone ${company.stateCode})` : ''}`
      : company.city || company.state || 'Company Workspace';

  return (
    <header className="relative h-16 bg-white border-b border-slate-200/90 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 shrink-0 select-none z-20">
      {companyMenuOpen && (
        <div
          className="fixed inset-0 z-30"
          onClick={closeMenus}
          aria-hidden="true"
        />
      )}

      {/* Left: Company Profile & Multi-Company Switcher */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <div className="relative min-w-0 max-w-full">
          <button
            type="button"
            onClick={() => setCompanyMenuOpen(!companyMenuOpen)}
            className="flex items-center gap-2.5 text-left p-1.5 rounded-xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-200 max-w-full min-w-0 cursor-pointer"
          >
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-700 hidden sm:block shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <h2 className="text-sm sm:text-base font-bold text-slate-900 leading-tight truncate">
                  {company.name || 'Transport Company'}
                </h2>
                {accessibleCompanies.length > 1 && (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 flex items-center gap-1.5 truncate">
                <span className="truncate">{locationSummary}</span>
                {company.gstin && (
                  <>
                    <span className="text-slate-300 hidden md:inline">•</span>
                    <span className="text-emerald-700 font-medium hidden md:inline shrink-0">
                      GSTIN: {company.gstin}
                    </span>
                  </>
                )}
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
                    type="button"
                    key={c.companyId}
                    onClick={() => {
                      switchCompany(c.companyId);
                      setCompanyMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex flex-col transition-colors cursor-pointer ${
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

      {/* Right Controls: Authoritative Role Badge, Quick Actions, User Profile */}
      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
        <div
          title="Active Firestore company membership role"
          className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 border border-slate-200"
        >
          <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0" />
          <span className="hidden sm:inline">Role:</span>
          <span className="text-indigo-700 font-bold">{currentRole}</span>
        </div>

        {/* Reset Data Button (Strictly OWNER / ADMIN) */}
        {permissions?.canManageCompany && (
          <button
            type="button"
            onClick={() => {
              closeMenus();
              onResetData();
            }}
            title="Clear operational company data"
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors border border-transparent hover:border-slate-200 hidden sm:flex items-center gap-1 text-xs cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Reset Data</span>
          </button>
        )}

        {/* Quick Dispatch CTA Button */}
        <button
          type="button"
          onClick={() => {
            closeMenus();
            onQuickDispatch();
          }}
          className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span className="hidden xs:inline sm:inline">New Trip</span>
        </button>

        {/* User Profile & Security Session Button */}
        <button
          type="button"
          onClick={() => {
            closeMenus();
            onOpenProfile();
          }}
          title="User profile & security session"
          aria-label="User profile and security session"
          className="relative z-40 flex items-center gap-2 p-1.5 sm:pl-2 sm:pr-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 active:bg-slate-100 transition-colors cursor-pointer shrink-0"
        >
          <div className="w-7 h-7 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
            {user?.name ? user.name.trim()[0]?.toUpperCase() || 'U' : 'U'}
          </div>
          <span className="text-xs font-semibold text-slate-800 hidden md:inline">
            {user?.name ? user.name.trim().split(/\s+/)[0] : 'Profile'}
          </span>
        </button>
      </div>
    </header>
  );
};
