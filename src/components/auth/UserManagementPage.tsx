import React, { useState, useMemo } from 'react';
import { UserPlus, Shield, Mail, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import { inviteCompanyMemberInFirestore } from '../../lib/firebase/firestoreService';
import { UserRole } from '../../types/tms';
import { PageHeader } from '../layout/PageHeader';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';

interface TeamMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
}

export const UserManagementPage: React.FC = () => {
  const { permissions } = useAuth();
  const { company, members: firestoreMembers, loading: fsLoading } = useFirestoreData();

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('OPERATIONS');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canManageUsers = permissions?.canManageUsers ?? false;

  const users: TeamMember[] = useMemo(() => {
    return firestoreMembers.map((fsM) => ({
      membershipId: fsM.id || fsM.userId,
      userId: fsM.userId,
      name: fsM.name || fsM.email.split('@')[0],
      email: fsM.email,
      role: fsM.role,
      status: fsM.status || 'ACTIVE',
    }));
  }, [firestoreMembers]);

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageUsers || !company?.id) return;

    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
      setErrorMsg(`A team member with email ${normalizedEmail} is already registered.`);
      return;
    }

    setInviteLoading(true);
    setErrorMsg(null);

    try {
      await inviteCompanyMemberInFirestore(company.id, {
        name: inviteName.trim(),
        email: normalizedEmail,
        role: inviteRole,
      });

      setFeedback(`User ${inviteName.trim()} added as ${inviteRole} in Firestore.`);
      setIsInviteOpen(false);
      setInviteName('');
      setInviteEmail('');
      setInviteRole('OPERATIONS');
      setTimeout(() => setFeedback(null), 4000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to add user in Firestore.');
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
          {fsLoading ? (
            <div className="p-6 text-center text-xs text-slate-500">Loading company users from Firestore...</div>
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
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Badge variant={getRoleBadgeVariant(member.role)} dot>
                    {member.role}
                  </Badge>
                  <span className="text-xs text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    {member.status === 'ACTIVE' ? 'Active' : member.status}
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
