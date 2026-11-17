import React, { useState, useEffect } from 'react';
import {
  Anchor,
  MailCheck,
  RefreshCw,
  Send,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface EmailVerificationPageProps {
  onBackToLogin: () => Promise<void> | void;
}

export const EmailVerificationPage: React.FC<EmailVerificationPageProps> = ({
  onBackToLogin,
}) => {
  const {
    user,
    verificationDispatchError,
    resendVerification,
    refreshVerificationStatus,
  } = useAuth();

  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [goingBack, setGoingBack] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (verificationDispatchError) {
      setStatusMessage({
        type: 'warning',
        text: verificationDispatchError,
      });
    }
  }, [verificationDispatchError]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  const inFlightCheckRef = React.useRef(false);

  // Automatically check user.reload() when the user returns to the browser tab
  useEffect(() => {
    let active = true;
    const handleReturnCheck = async () => {
      if (document.visibilityState === 'hidden' || inFlightCheckRef.current) return;
      inFlightCheckRef.current = true;
      try {
        const res = await refreshVerificationStatus();
        if (!active) return;
        if (res.verified) {
          setStatusMessage({
            type: 'success',
            text: 'Email verified! Redirecting to your AnchorTransports workspace...',
          });
        }
      } finally {
        inFlightCheckRef.current = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void handleReturnCheck();
      }
    };

    window.addEventListener('focus', handleReturnCheck);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      window.removeEventListener('focus', handleReturnCheck);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshVerificationStatus]);

  const handleCheckVerified = async () => {
    if (inFlightCheckRef.current) return;
    inFlightCheckRef.current = true;
    setStatusMessage(null);
    setChecking(true);
    try {
      const res = await refreshVerificationStatus();
      if (res.verified) {
        setStatusMessage({
          type: 'success',
          text: 'Email verified! Opening your AnchorTransports account...',
        });
      } else {
        setStatusMessage({
          type: 'warning',
          text:
            res.error ||
            'Your email address has not been verified yet. Please click the verification link in your inbox (or check Spam/Junk) and try again.',
        });
      }
    } finally {
      inFlightCheckRef.current = false;
      setChecking(false);
    }
  };

  const handleResend = async () => {
    if (cooldownSeconds > 0) return;
    setStatusMessage(null);
    setResending(true);
    try {
      const res = await resendVerification();
      if (res.alreadyVerified) {
        setStatusMessage({
          type: 'success',
          text: 'Your email is already verified! Loading your workspace...',
        });
      } else if (res.sent) {
        setCooldownSeconds(30);
        setStatusMessage({
          type: 'success',
          text: `A fresh verification link has been sent to ${user?.email || 'your email'}. Please check your inbox and spam folder.`,
        });
      } else {
        setStatusMessage({
          type: 'error',
          text: res.error || 'Could not resend verification email right now.',
        });
      }
    } finally {
      setResending(false);
    }
  };

  const handleBackToLogin = async () => {
    setGoingBack(true);
    try {
      await onBackToLogin();
    } finally {
      setGoingBack(false);
    }
  };

  const isBusy = checking || resending || goingBack;

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden select-none">
      {/* Ambient background glow */}
      <div className="absolute top-0 -left-10 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 -right-10 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center z-10">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 shadow-lg text-white mb-3 ring-4 ring-indigo-500/20">
          <Anchor className="w-8 h-8" />
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          Verify Your Email
        </h2>
        <p className="mt-1 text-xs sm:text-sm text-slate-400">
          AnchorTransports TMS Security &amp; Account Activation
        </p>
      </div>

      {/* Main Card */}
      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md z-10">
        <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-md space-y-5">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/15 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
              <MailCheck className="w-7 h-7" />
            </div>

            {user?.email && (
              <div className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700 text-center">
                <span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-400">
                  Registered Email Address
                </span>
                <span
                  data-testid="verification-email-address"
                  className="block text-sm font-semibold text-indigo-300 break-all mt-0.5 select-text"
                >
                  {user.email}
                </span>
              </div>
            )}

            <p className="text-sm text-slate-200 leading-relaxed">
              A verification link has been sent to your email address. Please check your inbox and click the verification link to activate your AnchorTransports account.
            </p>
          </div>

          {statusMessage && (
            <div
              className={`p-3.5 rounded-xl border flex items-start gap-2.5 text-xs ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200'
                  : statusMessage.type === 'warning'
                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-200'
                  : 'bg-rose-500/15 border-rose-500/30 text-rose-200'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    statusMessage.type === 'warning' ? 'text-amber-400' : 'text-rose-400'
                  }`}
                />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          <div className="space-y-3 pt-1">
            <button
              type="button"
              disabled={isBusy}
              onClick={handleCheckVerified}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {checking ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span>I Have Verified My Email</span>
            </button>

            <button
              type="button"
              disabled={isBusy || cooldownSeconds > 0}
              onClick={handleResend}
              className="w-full py-2.5 px-4 bg-slate-900/90 hover:bg-slate-900 border border-slate-600/80 hover:border-slate-500 text-slate-100 font-semibold rounded-xl text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {resending ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Send className="w-4 h-4 text-indigo-400" />
              )}
              <span>
                {cooldownSeconds > 0
                  ? `Resend Verification Email (${cooldownSeconds}s)`
                  : 'Resend Verification Email'}
              </span>
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={handleBackToLogin}
              className="w-full py-2 px-4 text-slate-300 hover:text-white hover:bg-slate-700/50 font-medium rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Login</span>
            </button>
          </div>

          <div className="pt-3 border-t border-slate-700/80 flex items-start gap-2 text-[11px] text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>
              Verification is checked directly with Firebase Authentication. Access to your fleet dashboard stays locked until your email is confirmed.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
