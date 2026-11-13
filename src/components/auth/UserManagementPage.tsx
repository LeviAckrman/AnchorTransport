import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Shield, ShieldCheck, Mail, Phone, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { UserRole } from '../../types/tms';
import { PageHeader } from '../layout/PageHeader';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { parseResponseJson } from '../../lib/safeFetch';
import { fetchCompanyMembersFromFirestore } from '../../lib/firebase/firestoreService';

interface TeamMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  active: boolean;
}

export const UserManagementPage: React.FC = () => {
  const { company, token, permissions } = useAuth();
  const [users, setUsers] = useState<TeamMember[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('OPERATIONS');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canManageUsers = permissions?.canManageUsers ?? false;
  const activeToken = token || (typeof window !== 'undefined' ? localStorage.getItem('token') || '' : '');

  useEffect(() => {
    const loadMembers = async () => {
      if (!company?.id) {
        setUsers([]);
        setLoadingUsers(false);
        return;
      }
      setLoadingUsers(true);
      try {
        const [apiRes, fsMembers] = await Promise.all([
          fetch('/api/company/users', {
            headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : {},
          }).catch(() => null),
          fetchCompanyMembersFromFirestore(company.id).catch(() => []),
        ]);

        const apiData = apiRes ? await parseResponseJson<any>(apiRes) : null;
        const apiList: TeamMember[] =
          apiRes && apiRes.ok && apiData?.success && Array.isArray(apiData.users) ? apiData.users : [];

        const merged = [...apiList];
        for (const fsM of fsMembers) {
          if (!merged.some((m) => m.userId === fsM.userId || m.email.toLowerCase() === fsM.email.toLowerCase())) {
            merged.push({
              membershipId: fsM.id || fsM.userId,
              userId: fsM.userId,
              name: fsM.name || fsM.email.split('@')[0],
              email: fsM.email,
              phone: '',
              role: fsM.role,
              active: fsM.status === 'ACTIVE',
            });
          }
        }
        setUsers(merged);
      } catch (err: any) {
        setErrorMsg(err?.message || 'Failed to load company team members.');
      } finally {
        setLoadingUsers(false);
      }
    };
    loadMembers();
  }, [company?.id, activeToken]);

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageUsers) return;

    setInviteLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/company/invite-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
        },
        body: JSON.stringify({
          name: inviteName,
          email: inviteEmail,
          phone: invitePhone,
          role: inviteRole,
        }),
      });

      const data = await parseResponseJson<any>(res);
      if (!res.ok || !data || !data.success) {
        setErrorMsg(data?.error || 'Failed to add user');
        return;
      }

      const newMember: TeamMember = {
        membershipId: `cu_${Date.now()}`,
        userId: data.user?.userId || `usr_${Date.now()}`,
        name: inviteName,
        email: inviteEmail,
        phone: invitePhone,
        role: inviteRole,
        active: true,
      };

      setUsers((prev) => [...prev, newMember]);
      setFeedback(`User ${inviteName} invited as ${inviteRole}.`);
      setIsInviteOpen(false);
      setInviteName('');
      setInviteEmail('');
      setInvitePhone('');
      setTimeout(() => setFeedback(null), 4000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error adding user.');
    } finally {
      setInviteLoading(false);
    }
  };

  const getRoleBadgeVariant = (r: UserRole) => {
    switch (r) {
      case 'OWNER':
        return 'purple';
      case 'ADMIN':
        return 'indigo';
      case 'ACCOUNTANT':
        return 'success';
      case 'MANAGER':
        return 'info';
      case 'OPERATIONS':
        return 'warning';
      default:
        return 'slate';
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="User Roles & Team Permissions"
        subtitle="Control staff access to dispatch, settlements, billing, and financial reports"
        actions={
          canManageUsers && (
            <button
              onClick={() => setIsInviteOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              <span>Add Staff / User</span>
            </button>
          )
        }
      />

      {feedback && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{feedback}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Role Permission Matrix Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <h3 className="font-bold text-xs uppercase tracking-wider text-slate-800 mb-3 flex items-center gap-2">
          <Shield className="w-4 h-4 text-indigo-600" />
          <span>Role Permission Architecture</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <span className="font-bold text-indigo-900 block mb-1">OWNER</span>
            <p className="text-slate-600 text-[11px]">Full access to fleet financials, bank accounts, user creation, and reports.</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <span className="font-bold text-indigo-800 block mb-1">ADMIN</span>
            <p className="text-slate-600 text-[11px]">Full operational & team governance, excluding financial owner takeover.</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <span className="font-bold text-blue-900 block mb-1">MANAGER</span>
            <p className="text-slate-600 text-[11px]">Truck dispatch, driver duty roster, LR printing, and fuel entry.</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <span className="font-bold text-emerald-900 block mb-1">ACCOUNTANT</span>
            <p className="text-slate-600 text-[11px]">Driver advance audits, trip settlements, GST invoicing, and debtor ledger.</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <span className="font-bold text-amber-900 block mb-1">OPERATIONS</span>
            <p className="text-slate-600 text-[11px]">FastTag, diesel pump slips, and cash advances. No access to P&L reports.</p>
          </div>
        </div>
      </div>

      {/* Team Members List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
          <h3 className="font-bold text-sm text-slate-900">Active Company Users ({users.length})</h3>
        </div>

        <div className="divide-y divide-slate-100">
          {loadingUsers ? (
            <div className="p-6 text-center text-xs text-slate-500">Loading company users...</div>
          ) : users.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No staff members added yet. Add staff members above to grant company access.
            </div>
          ) : (
            users.map((member) => (
              <div key={member.membershipId} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 text-slate-700 font-bold flex items-center justify-center text-sm">
                    {member.name
                      .split(' ')
                      .filter(Boolean)
                      .map((n) => n[0])
                      .join('')}
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-slate-900">{member.name}</h4>
                    <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                      <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{member.email}</span>
                      {member.phone && (
                        <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{member.phone}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Badge variant={getRoleBadgeVariant(member.role)} dot>
                    {member.role}
                  </Badge>
                  <span className="text-xs text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    Active
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Add User Modal */}
      <Modal
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        title="Add Staff Member to Transport Company"
        subtitle="Assign role permissions for truck operations or accounts"
        maxWidth="md"
      >
        <form onSubmit={handleInviteUser} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Staff Member Full Name *</label>
            <input
              type="text"
              required
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder="e.g. Ramesh Chandra Sen"
              className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Work Email Address *</label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="ramesh@transportcompany.com"
              className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Mobile / WhatsApp Number</label>
            <input
              type="text"
              value={invitePhone}
              onChange={(e) => setInvitePhone(e.target.value)}
              placeholder="+91 98300 XXXXX"
              className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Select System Role *</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as UserRole)}
              className="w-full text-xs sm:text-sm border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900"
            >
              <option value="OPERATIONS">Operations Staff (Entry of advances, diesel slips)</option>
              <option value="MANAGER">Fleet Manager (Trips, trucks, drivers)</option>
              <option value="ACCOUNTANT">Accountant (Settlements, invoices, ledgers)</option>
              <option value="ADMIN">Admin (Full operations & user setup)</option>
            </select>
          </div>

          <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsInviteOpen(false)}
              className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={inviteLoading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs"
            >
              {inviteLoading ? 'Creating User...' : 'Add Team Member'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
