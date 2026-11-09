import React, { useState } from 'react';
import { Mail, ArrowRight, AlertCircle, CheckCircle2, KeyRound } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useAuth } from '../../context/AuthContext';

interface ForgotPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialEmail?: string;
}

export const ForgotPasswordModal: React.FC<ForgotPasswordModalProps> = ({
  isOpen,
  onClose,
  initialEmail = '',
}) => {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setStatus('loading');
    setMessage(null);

    const result = await resetPassword(email);
    if (result.success) {
      setStatus('success');
      setMessage(result.message || 'Password reset link dispatched to your email.');
    } else {
      setStatus('error');
      setMessage(result.error || 'Failed to dispatch reset link.');
    }
  };

  const handleClose = () => {
    setStatus('idle');
    setMessage(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Reset Account Password" maxWidth="sm">
      <div className="p-1">
        <div className="flex items-center gap-3 mb-4 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
          <div className="w-10 h-10 rounded-lg bg-indigo-600/20 flex items-center justify-center text-indigo-400 shrink-0">
            <KeyRound className="w-5 h-5" />
          </div>
          <p className="text-xs text-slate-300">
            Enter the registered email associated with your AnchorTransport TMS account to receive secure password recovery instructions.
          </p>
        </div>

        {status === 'success' ? (
          <div className="space-y-4 py-2">
            <div className="p-4 bg-emerald-500/15 border border-emerald-500/30 rounded-xl flex items-start gap-3 text-emerald-300">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <p className="font-semibold text-emerald-200">Reset Email Dispatched</p>
                <p>{message}</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md transition-all cursor-pointer"
            >
              Return to Login
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {status === 'error' && (
              <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl flex items-center gap-2.5 text-xs text-rose-300">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{message}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Registered Work Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. operations@transportfleet.com"
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-hidden focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-700">
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-2 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={status === 'loading'}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-sm transition-all cursor-pointer"
              >
                {status === 'loading' ? 'Sending Link...' : 'Send Reset Link'}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
