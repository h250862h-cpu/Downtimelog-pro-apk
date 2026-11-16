import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  HardHat,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  User,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import {
  adminCreateOperatorAccount,
  loginWithEmail,
  loginWithGoogle,
  PRIMARY_ADMIN_EMAIL,
} from '../firebase';
import { isUserAdmin } from '../services/downtimeStore';
import { PlantRole } from '../types';
import { LgplastLogo } from './LgplastLogo';

interface LoginGateProps {
  onLoginSuccess: () => void;
}

export const LoginGate: React.FC<LoginGateProps> = ({ onLoginSuccess }) => {
  // Mode: 'signin' | 'admin_auth' | 'admin_provision' | 'provision_success'
  const [mode, setMode] = useState<
    'signin' | 'admin_auth' | 'admin_provision' | 'provision_success'
  >('signin');

  // Sign In inputs
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Admin Verification inputs
  const [adminEmail, setAdminEmail] = useState(PRIMARY_ADMIN_EMAIL);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminVerifiedEmail, setAdminVerifiedEmail] = useState<string | null>(null);

  // New Operator inputs
  const [newOpName, setNewOpName] = useState('');
  const [newOpEmail, setNewOpEmail] = useState('');
  const [newOpPassword, setNewOpPassword] = useState('');
  const [newOpRole, setNewOpRole] = useState<PlantRole>('Machine Operator');
  const [newOpDept, setNewOpDept] = useState('Extrusion & Production');

  // Last provisioned summary
  const [lastCreatedUser, setLastCreatedUser] = useState<{
    name: string;
    email: string;
    role: string;
    dept: string;
  } | null>(null);

  const [errorMsg, setErrorMsg] = useState('');
  const [unauthorizedDomain, setUnauthorizedDomain] = useState<string | null>(null);
  const [copiedDomain, setCopiedDomain] = useState(false);
  const [loading, setLoading] = useState(false);

  // 1. Regular Sign In Handler
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      await loginWithEmail(email, password);
      setLoading(false);
      onLoginSuccess();
    } catch (err: unknown) {
      setLoading(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('auth/operation-not-allowed')) {
        setErrorMsg(
          'Email/Password sign-in is pending activation in Firebase. Sign in with Google or enable Email/Password provider.'
        );
      } else if (
        msg.includes('auth/user-not-found') ||
        msg.includes('auth/invalid-credential') ||
        msg.includes('auth/wrong-password')
      ) {
        setErrorMsg('Invalid work email or password. Please verify your credentials or ask Plant Administration.');
      } else {
        setErrorMsg(msg);
      }
    }
  };

  // Google Sign In Handler
  const handleGoogleSignIn = async () => {
    setErrorMsg('');
    setUnauthorizedDomain(null);
    setLoading(true);
    try {
      await loginWithGoogle();
      setLoading(false);
      onLoginSuccess();
    } catch (err: unknown) {
      setLoading(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith('AUTH_UNAUTHORIZED_DOMAIN:')) {
        const domain = msg.replace('AUTH_UNAUTHORIZED_DOMAIN:', '');
        setUnauthorizedDomain(domain);
        setErrorMsg(
          `Google Sign-In requires adding "${domain}" to Firebase Authorized Domains, OR sign in below using Email / Phone Number (works immediately).`
        );
      } else {
        setErrorMsg(msg);
      }
    }
  };

  // 2. Admin Verification Handler (Blocks non-admins from opening the registration form)
  const handleAdminVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const normAdmin = adminEmail.trim().toLowerCase();
    if (!isUserAdmin(normAdmin)) {
      setErrorMsg(
        `Access Denied: ${adminEmail} is not an authorized plant administrator. Only ${PRIMARY_ADMIN_EMAIL} can register new staff.`
      );
      return;
    }

    setLoading(true);
    try {
      // Authenticate admin credentials with Firebase
      await loginWithEmail(adminEmail, adminPassword);
      setAdminVerifiedEmail(normAdmin);
      setLoading(false);
      setMode('admin_provision');
    } catch (err: unknown) {
      setLoading(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password')) {
        setErrorMsg('Admin password verification failed. Please check administrator credentials.');
      } else {
        setErrorMsg(`Admin authorization error: ${msg}`);
      }
    }
  };

  // 3. Admin Provision Operator Handler
  const handleAdminProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!adminVerifiedEmail) {
      setErrorMsg('Admin authorization expired. Please authenticate as Admin first.');
      setMode('admin_auth');
      return;
    }

    if (!newOpEmail.trim() || !newOpPassword.trim()) {
      setErrorMsg('Operator email and password are required.');
      return;
    }

    if (newOpPassword.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const created = await adminCreateOperatorAccount(
        adminVerifiedEmail,
        newOpEmail,
        newOpPassword,
        newOpName,
        newOpRole,
        newOpDept
      );

      setLastCreatedUser({
        name: created.displayName,
        email: created.email,
        role: created.role,
        dept: created.department,
      });

      // Reset operator inputs
      setNewOpName('');
      setNewOpEmail('');
      setNewOpPassword('');
      setLoading(false);
      setMode('provision_success');
    } catch (err: unknown) {
      setLoading(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('auth/email-already-in-use')) {
        setErrorMsg('This operator email is already registered in the system.');
      } else {
        setErrorMsg(msg);
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 sm:p-6 text-slate-100 selection:bg-amber-500 selection:text-slate-950 font-sans">
      <div className="w-full max-w-md space-y-6">
        {/* App Branding Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex rounded-2xl border border-amber-500/40 bg-slate-900/90 px-5 py-3 shadow-xl shadow-amber-950/40">
            <LgplastLogo size="lg" />
          </div>
          <div className="flex items-center justify-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              PlantOps Industrial Suite
            </h1>
            <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-xs font-extrabold text-amber-400 border border-amber-500/30">
              PRO APK
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 max-w-sm mx-auto">
            Equipment Downtime • 3-Stage Stock Dispatch • Shift Handover Logs
          </p>
        </div>

        {/* Auth Card Container */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl backdrop-blur-md">
          {/* ============================================================== */}
          {/* VIEW 1: REGULAR SIGN IN ONLY */}
          {/* ============================================================== */}
          {mode === 'signin' && (
            <div className="space-y-4">
              {/* Plant Access Lock Badge */}
              <div className="flex items-center gap-2.5 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-300">
                <Lock className="h-4 w-4 shrink-0 text-blue-400" />
                <span>
                  <b>Plant Access Restricted:</b> Sign in with your work email and password to access machinery logs and daily hours.
                </span>
              </div>

              {/* Google Sign In Option */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-750 p-2.5 text-xs font-bold text-slate-200 hover:text-white transition shadow-sm active:scale-[0.99] disabled:opacity-50"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>Continue with Google</span>
              </button>

              {unauthorizedDomain && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-200 space-y-2">
                  <div className="font-bold text-amber-300 flex items-center justify-between gap-2">
                    <span>Domain Not Yet Authorized for Google Popup</span>
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    Add this domain in <b>Firebase Console → Authentication → Settings → Authorized domains</b>, or sign in with your Email/Password or Phone below right now:
                  </p>
                  <div className="flex items-center gap-1.5">
                    <code className="flex-1 truncate rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-[10px] text-emerald-400">
                      {unauthorizedDomain}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(unauthorizedDomain);
                        setCopiedDomain(true);
                        setTimeout(() => setCopiedDomain(false), 2000);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2 py-1 text-[10px] font-bold text-white shrink-0"
                    >
                      <Copy className="h-3 w-3" />
                      <span>{copiedDomain ? 'Copied' : 'Copy'}</span>
                    </button>
                    <a
                      href="https://console.firebase.google.com/project/downtime-log-d484f/authentication/settings"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg bg-amber-500 hover:bg-amber-400 px-2 py-1 text-[10px] font-bold text-slate-950 shrink-0"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>Open Console</span>
                    </a>
                  </div>
                </div>
              )}

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-slate-800"></div>
                <span className="flex-shrink mx-3 text-[11px] text-slate-500 uppercase tracking-wider font-semibold">
                  Or Sign in with Email
                </span>
                <div className="flex-grow border-t border-slate-800"></div>
              </div>

              {/* Email/Password Form */}
              <form onSubmit={handleSignIn} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Work Email, Admin Login, or Phone Number
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. 0714282338, operator email, or admin email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                {errorMsg && (
                  <div className="flex items-start gap-2 rounded-xl bg-rose-500/10 border border-rose-500/30 p-2.5 text-xs text-rose-300">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
                    <span className="leading-snug">{errorMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 py-2.5 text-xs sm:text-sm font-bold text-slate-950 shadow-md shadow-amber-950/50 transition active:scale-[0.98] disabled:opacity-50"
                >
                  <LogIn className="h-4 w-4" />
                  <span>{loading ? 'Authenticating...' : 'Sign In to APK'}</span>
                </button>
              </form>

              {/* Registration Guard Notice: ONLY ADMIN CAN REGISTER */}
              <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-2 text-center">
                <div className="flex items-center justify-center gap-1.5 text-[11px] font-bold text-amber-400">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
                  <span>Need an Operator Account?</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Self-registration is disabled. New accounts are provisioned exclusively by the Plant Administrator.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg('');
                    setMode('admin_auth');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1.5 text-[11px] font-bold text-amber-300 transition"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  <span>Admin Registration Portal (Admin Login)</span>
                </button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* VIEW 2: ADMIN AUTHORIZATION CHALLENGE */}
          {/* ============================================================== */}
          {mode === 'admin_auth' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg('');
                    setMode('signin');
                  }}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-white"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Back to Sign In</span>
                </button>
                <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-black text-amber-400 uppercase">
                  ADMIN ONLY
                </span>
              </div>

              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-1 text-xs text-amber-200">
                <div className="flex items-center gap-1.5 font-bold text-amber-300">
                  <ShieldCheck className="h-4 w-4 text-amber-400" />
                  <span>Plant Admin Authorization Required</span>
                </div>
                <p className="text-[11px] text-amber-100/90 leading-relaxed">
                  Only designated Plant Administrators can register and provision new operator accounts. Please verify administrator identity below.
                </p>
              </div>

              <form onSubmit={handleAdminVerify} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Designated Admin Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                    <input
                      type="email"
                      required
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      placeholder="h250862h@hit.ac.zw"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <span className="text-[10px] text-slate-500">
                    Primary Plant Admin: <code className="text-amber-400">h250862h@hit.ac.zw</code>
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Admin Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                {errorMsg && (
                  <div className="flex items-start gap-2 rounded-xl bg-rose-500/10 border border-rose-500/30 p-2.5 text-xs text-rose-300">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
                    <span className="leading-snug">{errorMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 py-2.5 text-xs sm:text-sm font-bold text-slate-950 shadow-md shadow-amber-950/50 transition active:scale-[0.98] disabled:opacity-50"
                >
                  <KeyRound className="h-4 w-4" />
                  <span>{loading ? 'Verifying Admin...' : 'Unlock Registration Form'}</span>
                </button>
              </form>
            </div>
          )}

          {/* ============================================================== */}
          {/* VIEW 3: ADMIN PROVISION NEW OPERATOR FORM */}
          {/* ============================================================== */}
          {mode === 'admin_provision' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/40">
                    ✓
                  </span>
                  <div>
                    <span className="text-xs font-bold text-white block">
                      Admin Authorized
                    </span>
                    <span className="text-[10px] text-amber-400 font-mono">
                      {adminVerifiedEmail}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg('');
                    setMode('signin');
                  }}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Cancel / Sign In
                </button>
              </div>

              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <UserPlus className="h-4 w-4 text-amber-400" />
                <span>Provision New Plant User</span>
              </h3>

              <form onSubmit={handleAdminProvision} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Operator Full Name
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. Eric Nyamapanda"
                      value={newOpName}
                      onChange={(e) => setNewOpName(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Username or Work Email (Login ID)
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                    <input
                      type="text"
                      required
                      placeholder="wh1 or operator@plant.co.zw"
                      value={newOpEmail}
                      onChange={(e) => setNewOpEmail(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Set Initial Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                    <input
                      type="password"
                      required
                      placeholder="At least 6 characters"
                      value={newOpPassword}
                      onChange={(e) => setNewOpPassword(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Role
                    </label>
                    <select
                      value={newOpRole}
                      onChange={(e) => setNewOpRole(e.target.value as PlantRole)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                    >
                      <option value="WH Personnel">WH Personnel (WH Goods Confirm Only)</option>
                      <option value="Shift In Charge">Shift In Charge (Machines &amp; Shift Dispatch)</option>
                      <option value="Production HOD">Production HOD (Admin — All Sections &amp; Reports)</option>
                      <option value="Machine Operator">Machine Operator</option>
                      <option value="Maintenance Technician">Maintenance Technician</option>
                      <option value="QC Inspector">QC Inspector</option>
                      <option value="Shift Supervisor">Shift Supervisor</option>
                      <option value="Plant Administrator">Plant Administrator</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Department
                    </label>
                    <select
                      value={newOpDept}
                      onChange={(e) => setNewOpDept(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                    >
                      <option value="Warehouse & Dispatch (WH)">Warehouse &amp; Dispatch (WH)</option>
                      <option value="Extrusion & Production">Extrusion</option>
                      <option value="Production Management (HOD)">Production Management (HOD)</option>
                      <option value="Injection Moulding">Injection</option>
                      <option value="Mixing & Raw Materials">Mixing</option>
                      <option value="Polypipe & Crushing">Polypipe</option>
                      <option value="Quality Control (QC)">QC</option>
                      <option value="Plant Maintenance">Maintenance</option>
                    </select>
                  </div>
                </div>

                {errorMsg && (
                  <div className="flex items-start gap-2 rounded-xl bg-rose-500/10 border border-rose-500/30 p-2.5 text-xs text-rose-300">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
                    <span className="leading-snug">{errorMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 py-2.5 text-xs sm:text-sm font-bold text-slate-950 shadow-md shadow-emerald-950/50 transition active:scale-[0.98] disabled:opacity-50 mt-2"
                >
                  <UserPlus className="h-4 w-4" />
                  <span>{loading ? 'Creating Account in Firebase...' : 'Register Operator Account'}</span>
                </button>
              </form>
            </div>
          )}

          {/* ============================================================== */}
          {/* VIEW 4: PROVISION SUCCESS RECEIPT */}
          {/* ============================================================== */}
          {mode === 'provision_success' && lastCreatedUser && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                <CheckCircle2 className="h-8 w-8" />
              </div>

              <div>
                <h3 className="text-base font-bold text-white">
                  Operator Registered Successfully!
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  The account has been created in Firebase and is ready for login.
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-left space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Full Name:</span>
                  <span className="font-bold text-slate-200">{lastCreatedUser.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Login Email:</span>
                  <span className="font-mono text-emerald-400 font-semibold">
                    {lastCreatedUser.email}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Plant Role:</span>
                  <span className="font-semibold text-amber-400">{lastCreatedUser.role}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Department:</span>
                  <span className="text-slate-300">{lastCreatedUser.dept}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg('');
                    setMode('admin_provision');
                  }}
                  className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-750 py-2 text-xs font-bold text-slate-200 hover:text-white transition"
                >
                  <UserPlus className="h-3.5 w-3.5 text-amber-400" />
                  <span>Register Another Operator</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg('');
                    setMode('signin');
                  }}
                  className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 py-2 text-xs font-bold text-slate-950 transition shadow-md"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  <span>Go to Sign In Screen</span>
                </button>
              </div>
            </div>
          )}

          {/* Plant Admin Contact Footer */}
          <div className="mt-5 border-t border-slate-800/80 pt-4 text-center">
            <p className="text-[11px] text-slate-400">
              Designated Plant Admin: <span className="font-mono text-amber-400 font-semibold">{PRIMARY_ADMIN_EMAIL}</span>
            </p>
            <p className="text-[10px] text-slate-500 mt-1">
              Live Firebase Database: <span className="font-mono text-slate-400">downtime-log-d484f</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
