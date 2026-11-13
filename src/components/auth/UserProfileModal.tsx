import React, { useState, useEffect } from 'react';
import {
  Building2,
  ShieldCheck,
  LogOut,
  CheckCircle2,
  Edit3,
  Phone,
  Save,
  AlertCircle,
  KeyRound,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { Company } from '../../types/tms';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  fallbackCompany?: Company | null;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  fallbackCompany,
}) => {
  const {
    user,
    company,
    role,
    accessibleCompanies,
    onboardingCompleted,
    isEmailVerified,
    isFirebaseUser,
    switchCompany,
    updateUserProfile,
    refreshVerificationStatus,
    logout,
  } = useAuth();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(user?.name || '');
  const [editPhone, setEditPhone] = useState(user?.phone || '');
  const [saveFeedback, setSaveFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSwitching, setIsSwitching] = useState<string | null>(null);
  const [isRefreshingVerify, setIsRefreshingVerify] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setEditName(user?.name || '');
      setEditPhone(user?.phone || '');
      setSaveFeedback(null);
      setIsEditing(false);
    }
  }, [isOpen, user?.name, user?.phone]);

  if (!isOpen || !user) return null;

  const activeCompany =
    company || (fallbackCompany && fallbackCompany.id ? fallbackCompany : null);

  const initials =
    (user.name || user.email || 'U')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((n) => n[0]?.toUpperCase() || '')
      .join('') || 'U';

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveFeedback(null);

    const res = await updateUserProfile({ name: editName, phone: editPhone });
    setIsSaving(false);
    if (res.success) {
      setSaveFeedback({ type: 'success', text: 'Profile updated successfully.' });
      setIsEditing(false);
      setTimeout(() => setSaveFeedback(null), 3000);
    } else {
      setSaveFeedback({ type: 'error', text: res.error || 'Failed to update profile.' });
    }
  };

  const handleSwitchCompany = async (companyId: string) => {
    setIsSwitching(companyId);
    setSaveFeedback(null);
    const res = await switchCompany(companyId);
    setIsSwitching(null);
    if (res.success) {
      onClose();
    } else {
      setSaveFeedback({ type: 'error', text: res.error || 'Failed to switch company context.' });
    }
  };

  const handleRefreshSecurityStatus = async () => {
    setIsRefreshingVerify(true);
    setSaveFeedback(null);
    const res = await refreshVerificationStatus();
    setIsRefreshingVerify(false);
    setSaveFeedback(
      res.verified
        ? { type: 'success', text: 'Email & Firestore security session verified.' }
        : { type: 'error', text: res.error || 'Email is not verified yet.' }
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="User Profile & Security Session"
      subtitle="Authenticated session, role permissions, and company memberships"
      maxWidth="md"
    >
      <div className="space-y-5">
        {saveFeedback && (
          <div
            className={`p-3 border text-xs rounded-xl flex items-center gap-2 ${
              saveFeedback.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-700'
            }`}
          >
            {saveFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{saveFeedback.text}</span>
          </div>
        )}

        {/* User Card */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
          {!isEditing ? (
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-12 h-12 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center text-base shadow-sm shrink-0">
                  {initials}
                </div>
                <div className="min-w-0">
                  <h4 className="font-bold text-slate-900 text-sm truncate">{user.name || 'Fleet User'}</h4>
                  <p className="text-xs text-slate-500 truncate">{user.email}</p>
                  {user.phone && (
                    <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                      <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                      <span>{user.phone}</span>
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Badge variant="purple" size="sm" dot>
                      {role || 'OPERATIONS'}
                    </Badge>
                    <span className="text-[11px] font-mono text-slate-400 truncate max-w-[180px]">
                      ID: {user.id}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setEditName(user.name || '');
                  setEditPhone(user.phone || '');
                  setIsEditing(true);
                }}
                className="p-2 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-white border border-slate-200/70 hover:border-slate-300 transition-all cursor-pointer shrink-0"
                title="Edit Profile"
                aria-label="Edit Profile"
              >
                <Edit3 className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <form onSubmit={handleSaveProfile} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Display Name
                  </label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-hidden focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-hidden focus:border-indigo-500"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {isSaving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Security Session Details */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
            Security Session & Verification
          </label>
          <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-slate-700 font-medium">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Authenticated Session</span>
              </div>
              <Badge variant="success" size="sm" dot>
                Active
              </Badge>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-slate-700">
                <KeyRound className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>Auth Provider</span>
              </div>
              <span className="font-medium text-slate-800">
                {isFirebaseUser ? 'Firebase Auth + Session Token' : 'Session Token'}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-600">Onboarding Status</span>
              <span className="font-semibold text-emerald-700">
                {onboardingCompleted ? 'Completed' : 'Pending Setup'}
              </span>
            </div>

            {isFirebaseUser && (
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                <span className="text-slate-600">Email Verification</span>
                <div className="flex items-center gap-2">
                  <Badge variant={isEmailVerified ? 'success' : 'warning'} size="sm">
                    {isEmailVerified ? 'Verified' : 'Unverified'}
                  </Badge>
                  {!isEmailVerified && (
                    <button
                      type="button"
                      disabled={isRefreshingVerify}
                      onClick={handleRefreshSecurityStatus}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 text-[11px] font-semibold text-indigo-700 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${isRefreshingVerify ? 'animate-spin' : ''}`} />
                      Verify
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Active Company Context */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
            Current Active Tenant Company
          </label>
          {activeCompany ? (
            <div className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/50 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Building2 className="w-4 h-4 text-indigo-700 shrink-0" />
                <div className="min-w-0">
                  <span className="font-bold text-xs text-indigo-950 block truncate">
                    {activeCompany.name}
                  </span>
                  <span className="text-[11px] text-indigo-700 font-mono block truncate">
                    GSTIN: {activeCompany.gstin || 'N/A'}
                    {activeCompany.city ? ` (${activeCompany.city}, ${activeCompany.state})` : ''}
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded border border-indigo-200 shrink-0">
                Active Context
              </span>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-600 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
              <span>No company context selected yet.</span>
            </div>
          )}
        </div>

        {/* Switch Company if user belongs to multiple */}
        {accessibleCompanies.length > 1 && (
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Switch Tenant Organization
            </label>
            <div className="space-y-1.5">
              {accessibleCompanies.map((c) => (
                <button
                  type="button"
                  key={c.companyId}
                  disabled={isSwitching === c.companyId}
                  onClick={() => handleSwitchCompany(c.companyId)}
                  className={`w-full text-left p-3 rounded-lg border text-xs flex items-center justify-between transition-colors cursor-pointer disabled:opacity-60 ${
                    activeCompany?.id === c.companyId
                      ? 'bg-slate-100 border-slate-300 font-bold text-slate-900'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-slate-500" />
                    <span>{c.companyName}</span>
                  </div>
                  <span className="text-[10px] uppercase font-bold text-slate-500">
                    {isSwitching === c.companyId ? 'Switching...' : c.role}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Footer / Sign Out */}
        <div className="pt-3 border-t border-slate-100 flex justify-between items-center">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => {
              logout();
              onClose();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>
    </Modal>
  );
};
