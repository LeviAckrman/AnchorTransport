import React, { useState } from 'react';
import { Anchor, Lock, Mail, ArrowRight, ShieldCheck, AlertCircle, Eye, EyeOff, KeyRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { UserRole } from '../../types/tms';
import { ForgotPasswordModal } from './ForgotPasswordModal';

interface LoginPageProps {
  onSwitchToRegister: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onSwitchToRegister }) => {
  const { login } = useAuth();
  const [email, setEmail] = useState('anupam@royalbengal.com');
  const [password, setPassword] = useState('Password@123');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await login(email, password);
      if (!result.success) {
        setError(result.error || 'Invalid credentials');
      }
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check network connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectDemoUser = (demoEmail: string, _demoRole: UserRole) => {
    setEmail(demoEmail);
    setPassword('Password@123');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden select-none">
      {/* Background ambient gradient glow */}
      <div className="absolute top-0 -left-4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 -right-4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header & Logo */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center z-10">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 shadow-lg text-white mb-3 ring-4 ring-indigo-500/20">
          <Anchor className="w-8 h-8" />
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          Anchor<span className="text-indigo-400">Transport</span> TMS
        </h2>
        <p className="mt-1 text-xs sm:text-sm text-slate-400">
          Indian Own-Fleet Freight, Trip & Accounting Management
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md z-10 px-4 sm:px-0">
        <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl py-8 px-6 sm:px-8 shadow-2xl backdrop-blur-md">
          {error && (
            <div className="mb-5 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-start gap-2.5 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Work Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="name@transportcompany.com"
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-900/80 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Account Password
                </label>
                <button
                  type="button"
                  onClick={() => setIsForgotModalOpen(true)}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••••••"
                  className="w-full pl-9 pr-10 py-2.5 text-sm bg-slate-900/80 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>Sign In to Fleet Console</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Quick Demo Access Bar */}
          <div className="mt-6 pt-5 border-t border-slate-700/60">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5 text-center">
              Quick Role Switch (Demo Mode)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleSelectDemoUser('anupam@royalbengal.com', 'OWNER')}
                className="p-2 rounded-lg bg-slate-900/60 hover:bg-slate-700/70 border border-slate-700/80 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between text-xs font-bold text-white">
                  <span>Anupam G.</span>
                  <span className="text-[9px] px-1 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">OWNER</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">Full Authority</p>
              </button>

              <button
                type="button"
                onClick={() => handleSelectDemoUser('accounts@royalbengal.com', 'ACCOUNTANT')}
                className="p-2 rounded-lg bg-slate-900/60 hover:bg-slate-700/70 border border-slate-700/80 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between text-xs font-bold text-white">
                  <span>Subhashish D.</span>
                  <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">ACCT</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">Invoicing & Settle</p>
              </button>

              <button
                type="button"
                onClick={() => handleSelectDemoUser('bikash@royalbengal.com', 'MANAGER')}
                className="p-2 rounded-lg bg-slate-900/60 hover:bg-slate-700/70 border border-slate-700/80 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between text-xs font-bold text-white">
                  <span>Bikash M.</span>
                  <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">MGR</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">Trips & Fleet</p>
              </button>

              <button
                type="button"
                onClick={() => handleSelectDemoUser('bikash@royalbengal.com', 'OPERATIONS')}
                className="p-2 rounded-lg bg-slate-900/60 hover:bg-slate-700/70 border border-slate-700/80 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between text-xs font-bold text-white">
                  <span>Ops Desk</span>
                  <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">OPS</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">Fuel & Advances</p>
              </button>
            </div>
          </div>

          {/* Switch to Register */}
          <div className="mt-6 text-center">
            <button
              onClick={onSwitchToRegister}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold transition-colors cursor-pointer"
            >
              Don't have a fleet account? Register your company &rarr;
            </button>
          </div>
        </div>
      </div>

      <ForgotPasswordModal
        isOpen={isForgotModalOpen}
        onClose={() => setIsForgotModalOpen(false)}
        initialEmail={email}
      />
    </div>
  );
};
