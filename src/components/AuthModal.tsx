import React, { useState } from 'react';
import {
  AlertCircle,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  ShieldCheck,
  X,
} from 'lucide-react';
import { loginWithEmail, loginWithGoogle, sendUserPasswordReset } from '../firebase';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);

    try {
      await loginWithEmail(email, password);
      setLoading(false);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setLoading(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('auth/operation-not-allowed')) {
        setErrorMsg(
          'Email/Password provider is not enabled in Firebase Console yet. Please enable it under Firebase Console -> Authentication -> Sign-in method.'
        );
      } else if (msg.includes('auth/user-not-found') || msg.includes('auth/invalid-credential')) {
        setErrorMsg('Invalid email/ID or password. You can use Google Sign-In below or tap Forgot / Reset Password.');
      } else {
        setErrorMsg(msg);
      }
    }
  };

  const handlePasswordReset = async () => {
    setErrorMsg('');
    setInfoMsg('');
    if (!email.trim()) {
      setErrorMsg('Enter your email or login ID first to send a password reset link.');
      return;
    }
    setLoading(true);
    try {
      const sentTo = await sendUserPasswordReset(email);
      setInfoMsg(`Password reset email sent to ${sentTo}.`);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);
    try {
      const res = await loginWithGoogle();
      setLoading(false);
      if (res) {
        onSuccess();
        onClose();
      }
    } catch (err: unknown) {
      setLoading(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith('AUTH_UNAUTHORIZED_DOMAIN:')) {
        const domain = msg.replace('AUTH_UNAUTHORIZED_DOMAIN:', '');
        setErrorMsg(
          `Add "${domain}" under Firebase Console -> Authentication -> Settings -> Authorized domains to enable Google Sign-In here, or sign in with Email/Password above.`
        );
      } else {
        setErrorMsg(msg);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl my-auto text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">Sign In to DowntimeLog</h3>
              <p className="text-[11px] text-slate-400">
                Role-Secured Plant Access • <code className="text-amber-300">downtime-log-d484f</code>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Admin-provisioned account notice */}
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 text-[11px] text-slate-300">
          <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            Staff accounts &amp; section permissions are issued by Plant Administration under{' '}
            <span className="font-semibold text-white">Admin Access &amp; Sync</span>.
          </div>
        </div>

        {/* Info / Error Notifications */}
        {infoMsg && (
          <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
            {infoMsg}
          </div>
        )}
        {errorMsg && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed">{errorMsg}</div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Work Email or Login ID</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="h250862h@hit.ac.zw or hod"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-850 pl-8 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-amber-500 outline-none"
                required
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-slate-400 block">Password</label>
              <button
                type="button"
                onClick={handlePasswordReset}
                disabled={loading}
                className="text-[11px] font-semibold text-amber-400 hover:underline disabled:opacity-50"
              >
                Forgot / Reset Password?
              </button>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-850 pl-8 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-amber-500 outline-none"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 py-2.5 text-xs font-bold text-slate-950 shadow-md shadow-amber-950/40 hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 transition"
          >
            {loading ? (
              <span>Authenticating...</span>
            ) : (
              <>
                <LogIn className="h-4 w-4" />
                <span>Sign In with Email / ID</span>
              </>
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="my-4 flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-widest">
          <div className="h-px flex-1 bg-slate-800" />
          <span>or sign in with</span>
          <div className="h-px flex-1 bg-slate-800" />
        </div>

        {/* Google Sign In */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-850 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50 transition"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.36 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.17 0 9.98 0 12s.45 3.83 1.25 5.42l4.03-3.15z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
            />
          </svg>
          <span>Continue with Google Account</span>
        </button>
      </div>
    </div>
  );
};
