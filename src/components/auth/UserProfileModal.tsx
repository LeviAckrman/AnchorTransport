import React, { useState } from 'react';
import { User, Building2, ShieldCheck, LogOut, CheckCircle2, Edit3, Phone, Save, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({ isOpen, onClose }) => {
  const { user, company, role, accessibleCompanies, switchCompany, updateUserProfile, logout } = useAuth();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(user?.name || '');
  const [editPhone, setEditPhone] = useState(user?.phone || '');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (!user || !company) return null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveStatus(null);

    const res = await updateUserProfile({ name: editName, phone: editPhone });
    setIsSaving(false);
    if (res.success) {
      setSaveStatus('Profile updated successfully.');
      setIsEditing(false);
      setTimeout(() => setSaveStatus(null), 3000);
    } else {
      setSaveStatus(res.error || 'Failed to update profile.');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="User Profile & Security Context"
      subtitle="Authenticated session and multi-tenant company memberships"
      maxWidth="md"
    >
      <div className="space-y-5">
        {saveStatus && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 text-xs rounded-xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{saveStatus}</span>
          </div>
        )}

        {/* User Card */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
          {!isEditing ? (
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center text-base shadow-sm">
                  {user.name.split(' ').map((n) => n[0]).join('')}
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">{user.name}</h4>
                  <p className="text-xs text-slate-500">{user.email}</p>
                  {user.phone && (
                    <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                      <Phone className="w-3 h-3 text-slate-400" />
                      {user.phone}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="purple" size="sm" dot>
                      {role}
                    </Badge>
                    <span className="text-[11px] font-mono text-slate-400">ID: {user.id}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setEditName(user.name);
                  setEditPhone(user.phone || '');
                  setIsEditing(true);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-white border border-transparent hover:border-slate-200 transition-all cursor-pointer"
                title="Edit Profile"
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  {isSaving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Active Company Context */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
            Current Active Tenant Company
          </label>
          <div className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Building2 className="w-4 h-4 text-indigo-700" />
              <div>
                <span className="font-bold text-xs text-indigo-950 block">{company.name}</span>
                <span className="text-[11px] text-indigo-700 font-mono">
                  GSTIN: {company.gstin} ({company.city}, {company.state})
                </span>
              </div>
            </div>
            <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded border border-indigo-200">
              Active Context
            </span>
          </div>
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
                  key={c.companyId}
                  onClick={() => {
                    switchCompany(c.companyId);
                    onClose();
                  }}
                  className={`w-full text-left p-3 rounded-lg border text-xs flex items-center justify-between transition-colors cursor-pointer ${
                    company.id === c.companyId
                      ? 'bg-slate-100 border-slate-300 font-bold text-slate-900'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-slate-500" />
                    <span>{c.companyName}</span>
                  </div>
                  <span className="text-[10px] uppercase font-bold text-slate-500">{c.role}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Logout Button */}
        <div className="pt-3 border-t border-slate-100 flex justify-between items-center">
          <span className="text-[11px] text-slate-400">Server Session: Active</span>
          <button
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
