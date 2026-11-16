import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cloud,
  CloudOff,
  Copy,
  Download,
  ExternalLink,
  HardHat,
  Info,
  KeyRound,
  Lock,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
  User,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  adminCreateOperatorAccount,
  adminUpdateUserAccess,
  auth,
  deletePlantUserAccount,
  getActiveSessionUser,
  getLocalPlantUsers,
  isRestrictedShiftInChargeAccount,
  logoutUser,
  PRIMARY_ADMIN_EMAIL,
  subscribePlantUsers,
} from '../firebase';
import {
  addCustomMachine,
  deleteMachinePermanent,
  getStoredCustomMachines,
  getStoredGoneMachines,
  isUserAdmin,
  removeMachine,
  restoreMachine,
  saveStoredEntries,
  syncAllLocalToFirebase,
} from '../services/downtimeStore';
import { saveFileBlob, ymd } from '../services/downtimeCalc';
import {
  DEFAULT_REPORTERS,
  DowntimeEntry,
  getDefaultPermissionsForRole,
  PlantRole,
  PlantUserAccount,
  UserPermissions,
} from '../types';
import { LgplastLogo } from './LgplastLogo';

interface SyncAndMachinesViewProps {
  machines: string[];
  entries: DowntimeEntry[];
  currentReporter: string;
  isOnline: boolean;
  syncStatus: 'synced' | 'syncing' | 'offline' | 'error';
  syncStatusMessage: string;
  onReporterChange: (name: string) => void;
  onRefreshData: () => void;
  onOpenAuthModal: () => void;
  onOpenInstallModal: () => void;
}

export const SyncAndMachinesView: React.FC<SyncAndMachinesViewProps> = ({
  machines,
  entries,
  currentReporter,
  isOnline,
  syncStatus,
  syncStatusMessage,
  onReporterChange,
  onRefreshData,
  onOpenAuthModal,
  onOpenInstallModal,
}) => {
  const [newMachineName, setNewMachineName] = useState('');
  const [machineMessage, setMachineMessage] = useState<{ text: string; isError?: boolean } | null>(null);
  const [selectedRemoveMachine, setSelectedRemoveMachine] = useState<string>(machines[0] || '');
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [isSyncingNow, setIsSyncingNow] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedGitCmd, setCopiedGitCmd] = useState(false);

  // Plant Operator Accounts State (Admin Managed)
  const [plantUsers, setPlantUsers] = useState<PlantUserAccount[]>(getLocalPlantUsers());
  const [newOpName, setNewOpName] = useState('');
  const [newOpEmail, setNewOpEmail] = useState('');
  const [newOpPassword, setNewOpPassword] = useState('');
  const [newOpRole, setNewOpRole] = useState<PlantRole>('WH Personnel');
  const [newOpDept, setNewOpDept] = useState('Warehouse & Dispatch (WH)');
  const [newOpPerms, setNewOpPerms] = useState<UserPermissions>(() =>
    getDefaultPermissionsForRole('WH Personnel')
  );
  const [opMsg, setOpMsg] = useState<{ text: string; isError?: boolean } | null>(null);
  const [opLoading, setOpLoading] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState<{
    displayName: string;
    email: string;
    password: string;
    role: PlantRole;
  } | null>(null);
  const [copiedCreds, setCopiedCreds] = useState(false);

  // Admin Edit User Access / Confidentiality Modal State
  const [editingUser, setEditingUser] = useState<PlantUserAccount | null>(null);
  const [editRole, setEditRole] = useState<PlantRole>('Machine Operator');
  const [editDept, setEditDept] = useState('Extrusion & Production');
  const [editPerms, setEditPerms] = useState<UserPermissions>(() =>
    getDefaultPermissionsForRole('Machine Operator')
  );
  const [editStatus, setEditStatus] = useState<'active' | 'suspended'>('active');
  const [savingEdit, setSavingEdit] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const goneMachines = getStoredGoneMachines();
  const directAppUrl =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://ais-pre-4lub2q7zy24orxc7ww4y2p-197466423672.europe-west2.run.app';

  // Admin Check (supports active session user and Firebase auth email)
  const currentUserEmail = getActiveSessionUser()?.email || auth.currentUser?.email;
  const userIsAdmin = isUserAdmin(currentUserEmail);

  useEffect(() => {
    const unsub = subscribePlantUsers((users) => {
      setPlantUsers(users);
    });
    return () => unsub();
  }, []);

  const applyRolePreset = (role: PlantRole) => {
    setNewOpRole(role);
    setNewOpPerms(getDefaultPermissionsForRole(role));
    if (role === 'WH Personnel') {
      setNewOpDept('Warehouse & Dispatch (WH)');
    } else if (role === 'Production HOD' || role === 'Plant Administrator') {
      setNewOpDept('Production Management (HOD)');
    } else if (role === 'Recycling Team') {
      setNewOpDept('Polypipe & Crushing');
    } else if (role === 'Mixer Operator') {
      setNewOpDept('Mixing & Raw Materials');
    } else {
      setNewOpDept('Extrusion & Production');
    }
  };

  const handleAdminProvisionOperator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUserEmail || !userIsAdmin) {
      setOpMsg({ text: 'Access Denied: Only Plant Administrators or Production HOD can register logins.', isError: true });
      return;
    }
    if (!newOpEmail.trim() || !newOpPassword.trim()) {
      setOpMsg({ text: 'Login ID / Email and password are required.', isError: true });
      return;
    }
    if (newOpPassword.length < 6) {
      setOpMsg({ text: 'Password must be at least 6 characters.', isError: true });
      return;
    }

    setOpLoading(true);
    setOpMsg(null);
    const plainPassword = newOpPassword;
    try {
      const created = await adminCreateOperatorAccount(
        currentUserEmail,
        newOpEmail,
        plainPassword,
        newOpName,
        newOpRole,
        newOpDept,
        newOpPerms
      );
      setCreatedCredentials({
        displayName: created.displayName,
        email: created.email,
        password: plainPassword,
        role: created.role,
      });
      setCopiedCreds(false);
      setOpMsg({
        text: `Login created for ${created.displayName} (${created.email}) as ${created.role}! Live across all devices.`,
        isError: false,
      });
      setNewOpName('');
      setNewOpEmail('');
      setNewOpPassword('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setOpMsg({ text: msg, isError: true });
    } finally {
      setOpLoading(false);
    }
  };

  const openEditUserAccess = (target: PlantUserAccount) => {
    setEditingUser(target);
    setEditRole(target.role);
    setEditDept(target.department || 'Extrusion & Production');
    setEditPerms(
      target.permissions
        ? { ...getDefaultPermissionsForRole(target.role), ...target.permissions }
        : getDefaultPermissionsForRole(target.role)
    );
    setEditStatus(target.status || 'active');
  };

  const handleSaveUserAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || !currentUserEmail || !userIsAdmin) return;
    setSavingEdit(true);
    try {
      const updated = await adminUpdateUserAccess(currentUserEmail, editingUser, {
        role: editRole,
        department: editDept,
        permissions: editPerms,
        status: editStatus,
      });
      setOpMsg({
        text: `Updated confidentiality permissions for ${updated.displayName} (${updated.role}). Live on all devices!`,
        isError: false,
      });
      setEditingUser(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setOpMsg({ text: msg, isError: true });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteOperator = async (uid: string, name: string) => {
    if (!userIsAdmin) return;
    if (window.confirm(`Are you sure you want to revoke account for ${name}?`)) {
      await deletePlantUserAccount(uid);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(directAppUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleAddMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMachineName.trim()) return;

    if (!userIsAdmin) {
      setMachineMessage({
        text: 'Access Denied: Only designated Plant Admins (h250862h@hit.ac.zw) can add machinery.',
        isError: true,
      });
      return;
    }

    const res = await addCustomMachine(newMachineName, currentUserEmail);
    setMachineMessage({ text: res.message, isError: !res.ok });
    if (res.ok) {
      setNewMachineName('');
      onRefreshData();
    }
  };

  const handleArchiveMachine = async () => {
    if (!selectedRemoveMachine) return;

    if (!userIsAdmin) {
      setMachineMessage({
        text: 'Access Denied: Only designated Plant Admins can remove machinery.',
        isError: true,
      });
      return;
    }

    // Safety check: is machine currently OFF?
    const hasOpen = entries.some((e) => e.m === selectedRemoveMachine && !e.end && !e.del);
    if (hasOpen) {
      setMachineMessage({
        text: `${selectedRemoveMachine} is currently OFF. Please mark it back to running first before removing.`,
        isError: true,
      });
      return;
    }

    if (
      window.confirm(
        `Archive "${selectedRemoveMachine}" from the active machine list?\n\nIts past downtime history will remain safe and it can be restored anytime.`
      )
    ) {
      const res = await removeMachine(selectedRemoveMachine, currentUserEmail);
      setMachineMessage({ text: res.message, isError: !res.ok });
      onRefreshData();
    }
  };

  const handlePermanentDelete = async () => {
    if (!selectedRemoveMachine) return;

    if (!userIsAdmin) {
      setMachineMessage({
        text: 'Access Denied: Only designated Plant Admins can permanently delete machinery.',
        isError: true,
      });
      return;
    }

    // Safety check: is machine currently OFF?
    const hasOpen = entries.some((e) => e.m === selectedRemoveMachine && !e.end && !e.del);
    if (hasOpen) {
      setMachineMessage({
        text: `Cannot delete ${selectedRemoveMachine}: It has an active open stoppage. Restore it to running first.`,
        isError: true,
      });
      return;
    }

    if (
      window.confirm(
        `⚠️ PERMANENT DELETE WARNING:\n\nAre you sure you want to permanently delete "${selectedRemoveMachine}"?\n\nThis will remove the machine from the system.`
      )
    ) {
      const res = await deleteMachinePermanent(selectedRemoveMachine, currentUserEmail);
      setMachineMessage({ text: res.message, isError: !res.ok });
      onRefreshData();
    }
  };

  const handleRestoreMachine = async (m: string) => {
    if (!userIsAdmin) {
      setMachineMessage({
        text: 'Access Denied: Only designated Plant Admins can restore machinery.',
        isError: true,
      });
      return;
    }

    const res = await restoreMachine(m, currentUserEmail);
    setMachineMessage({ text: res.message, isError: !res.ok });
    onRefreshData();
  };

  // Manual Trigger Sync
  const handleManualSync = async () => {
    setIsSyncingNow(true);
    try {
      const count = await syncAllLocalToFirebase(entries);
      setBackupMessage(`Synced ${count} entries with Firebase project downtime-log-d484f.`);
    } catch (e: any) {
      setBackupMessage(`Sync error: ${e?.message || 'Check internet connection.'}`);
    } finally {
      setIsSyncingNow(false);
    }
  };

  // JSON Backup
  const handleSaveBackup = () => {
    const backupData = {
      ev: entries,
      mach: getStoredCustomMachines(),
      gone: getStoredGoneMachines(),
      exportedAt: new Date().toISOString(),
      version: '2.0',
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], {
      type: 'application/json',
    });
    saveFileBlob(`downtime_backup_${ymd(new Date())}.json`, blob);
    setBackupMessage('Backup file downloaded to your device.');
  };

  // JSON Restore
  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (!parsed || (!parsed.ev && !Array.isArray(parsed))) {
          setBackupMessage('Invalid backup file format.');
          return;
        }

        const restoredEntries: DowntimeEntry[] = Array.isArray(parsed) ? parsed : parsed.ev || [];
        const existingMap: Record<string, DowntimeEntry> = {};
        entries.forEach((x) => (existingMap[x.id] = x));

        let addedCount = 0;
        restoredEntries.forEach((item) => {
          if (item && item.id && item.m && item.start) {
            if (!existingMap[item.id]) {
              existingMap[item.id] = { ...item, upd: Date.now() };
              addedCount++;
            }
          }
        });

        // Restore custom machines
        if (parsed.mach && Array.isArray(parsed.mach)) {
          const currentCustom = getStoredCustomMachines();
          parsed.mach.forEach((m: string) => {
            if (typeof m === 'string' && !currentCustom.includes(m)) {
              currentCustom.push(m);
            }
          });
          localStorage.setItem('dtmach', JSON.stringify(currentCustom));
        }

        saveStoredEntries(Object.values(existingMap));
        onRefreshData();
        setBackupMessage(`Successfully restored ${addedCount} entries from backup!`);
      } catch (err: any) {
        setBackupMessage(`Failed to read backup: ${err?.message || 'Corrupted file'}`);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      {/* 1. Admin Role & Permissions Card */}
      <div
        className={`rounded-2xl border p-4 sm:p-5 shadow-lg backdrop-blur transition-all ${
          userIsAdmin
            ? 'border-amber-500/50 bg-gradient-to-r from-amber-950/30 via-slate-900 to-slate-900'
            : 'border-slate-800 bg-slate-900/90'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-xl font-bold shadow-md ${
                userIsAdmin
                  ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-slate-950'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {userIsAdmin ? <ShieldCheck className="h-6 w-6" /> : <Lock className="h-5 w-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-white">
                  {userIsAdmin ? 'Plant Administrator Privileges Active' : 'Operator / Technician Access'}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide border ${
                    userIsAdmin
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {userIsAdmin ? 'ADMIN' : 'OPERATOR'}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Logged in as: <b className="text-slate-100">{currentUserEmail || 'Guest'}</b> •{' '}
                {userIsAdmin
                  ? 'Authorized to Add, Archive, and Permanently Delete machinery.'
                  : 'Machinery catalog changes are restricted to Plant Admin (h250862h@hit.ac.zw).'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={logoutUser}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-rose-400 hover:border-rose-500/50 transition"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Direct Mobile App Link & APK Instructions */}
      <div className="rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-900 p-4 sm:p-6 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500 text-slate-950 font-bold">
                <Smartphone className="h-4 w-4" />
              </span>
              <h3 className="text-base font-bold text-white">
                Direct Mobile App Link (Open via Login)
              </h3>
            </div>
            <p className="text-xs text-slate-300">
              When this link is shared with any operator or supervisor, they will be required to authenticate with their login email/password or Google account before accessing the logs:
            </p>
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-emerald-400 break-all select-all">
              <span>{directAppUrl}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-xs font-bold transition shadow"
            >
              <Copy className="h-4 w-4" />
              <span>{copiedLink ? 'Copied!' : 'Copy Direct Link'}</span>
            </button>
            <a
              href={directAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:text-white transition"
            >
              <ExternalLink className="h-4 w-4" />
              <span>Test Login URL</span>
            </a>
            <button
              onClick={onOpenInstallModal}
              className="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition"
            >
              <Smartphone className="h-4 w-4" />
              <span>Install APK</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2B. 24/7 Always-Live Hosting (GitHub + Render) Assistant */}
      <div className="rounded-2xl border border-sky-500/40 bg-gradient-to-br from-sky-950/40 via-slate-900 to-slate-900 p-4 sm:p-6 shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <LgplastLogo size="sm" />
            <div>
              <h3 className="text-base font-bold text-white">
                24/7 Always-Live Deployment (GitHub + Render)
              </h3>
              <p className="text-xs text-slate-300">
                Keep this LG PLAST APK permanently online 24/7 with zero sleep &amp; automatic updates on every push.
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 border border-sky-400/40 px-3 py-1 text-[11px] font-bold text-sky-300 shrink-0">
            Static CDN · Never Sleeps
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs text-slate-300">
          <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-3.5 space-y-2">
            <div className="font-bold text-sky-300">Step 1: Push Project to GitHub</div>
            <p className="text-[11px] text-slate-400">
              Use the top-right <b>GitHub / Export</b> button in AI Studio, or push the downloaded project with:
            </p>
            <pre className="rounded-lg border border-slate-800 bg-slate-900 p-2.5 font-mono text-[10px] text-sky-200 overflow-x-auto">
{`git init
git add .
git commit -m "LG PLAST Live APK"
git branch -M main
git remote add origin https://github.com/YOUR_USER/lgplast-apk.git
git push -u origin main`}
            </pre>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(
                  'git init && git add . && git commit -m "LG PLAST Live APK" && git branch -M main && git remote add origin https://github.com/YOUR_USER/lgplast-apk.git && git push -u origin main'
                );
                setCopiedGitCmd(true);
                setTimeout(() => setCopiedGitCmd(false), 2500);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 px-3 py-1.5 text-[11px] font-black text-slate-950 transition"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>{copiedGitCmd ? 'Copied Git Commands!' : 'Copy Git Push Commands'}</span>
            </button>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-3.5 space-y-2">
            <div className="font-bold text-emerald-300">Step 2: Deploy Free 24/7 on Render</div>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-300">
              <li>
                Open <b>dashboard.render.com</b> → click <b>New +</b> → <b>Blueprint</b> (uses <code className="text-sky-300">render.yaml</code> automatically) or <b>Static Site</b>.
              </li>
              <li>
                Build Command: <code className="bg-slate-900 px-1.5 py-0.5 rounded text-emerald-300">npm install &amp;&amp; npm run build</code>
              </li>
              <li>
                Publish Directory: <code className="bg-slate-900 px-1.5 py-0.5 rounded text-emerald-300">dist</code>
              </li>
              <li>
                Add your <code className="text-amber-300">.onrender.com</code> domain inside{' '}
                <a
                  href="https://console.firebase.google.com/project/downtime-log-d484f/authentication/settings"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400 underline font-semibold"
                >
                  Firebase Authorized Domains
                </a>{' '}
                for Google Sign-In.
              </li>
            </ol>
            <div className="pt-1 flex flex-wrap gap-2">
              <a
                href="https://dashboard.render.com/select-repo?type=blueprint"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 text-[11px] font-black text-slate-950 transition"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Open Render Deploy</span>
              </a>
              <a
                href="https://console.firebase.google.com/project/downtime-log-d484f/authentication/settings"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-750 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Firebase Domains</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Feedback Notice */}
      {machineMessage && (
        <div
          className={`flex items-center gap-2 text-xs font-semibold p-3 rounded-xl border ${
            machineMessage.isError
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          }`}
        >
          {machineMessage.isError ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          )}
          <span>{machineMessage.text}</span>
        </div>
      )}

      {/* 3. Machine Management (Admin Add Machine & Delete Machine) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Add Machine Card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-6 shadow-md flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="h-5 w-5 text-emerald-400" />
                <span>Add a Machine</span>
              </h3>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  userIsAdmin
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                {userIsAdmin ? 'Admin Enabled' : 'Admin Only'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Add a new production machine to plant dropdowns, daily hours, and reports across all synced devices.
            </p>

            <form onSubmit={handleAddMachine} className="space-y-3">
              <div>
                <input
                  type="text"
                  placeholder="e.g. Mixer Machine 6 or Blue Crusher"
                  disabled={!userIsAdmin}
                  value={newMachineName}
                  onChange={(e) => setNewMachineName(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                />
              </div>

              <button
                type="submit"
                disabled={!userIsAdmin}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-xs font-bold transition shadow disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
                <span>Add machine to plant</span>
              </button>
            </form>
          </div>

          {!userIsAdmin && (
            <p className="text-[11px] text-amber-400/90 mt-3 flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              <span>Only Plant Admin (h250862h@hit.ac.zw) is authorized to add machines.</span>
            </p>
          )}
        </div>

        {/* Delete Machine Card (Admin Only) */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-6 shadow-md flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-rose-400" />
                <span>Delete / Archive Machine</span>
              </h3>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  userIsAdmin
                    ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                {userIsAdmin ? 'Admin Enabled' : 'Admin Only'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Remove obsolete or decommissioned machines from active plant boards and dropdowns.
            </p>

            <div className="space-y-3">
              <select
                disabled={!userIsAdmin}
                value={selectedRemoveMachine}
                onChange={(e) => setSelectedRemoveMachine(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-rose-500 focus:outline-none disabled:opacity-50"
              >
                {machines.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!userIsAdmin}
                  onClick={handleArchiveMachine}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-750 text-slate-200 px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40"
                  title="Hide machine while keeping past logs"
                >
                  <Trash2 className="h-3.5 w-3.5 text-amber-400" />
                  <span>Archive (Keep Logs)</span>
                </button>

                <button
                  type="button"
                  disabled={!userIsAdmin}
                  onClick={handlePermanentDelete}
                  className="flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 px-3 py-1.5 text-xs font-bold transition disabled:opacity-40"
                  title="Permanently delete machine from system"
                >
                  <ShieldAlert className="h-3.5 w-3.5 text-rose-400" />
                  <span>Permanent Delete</span>
                </button>
              </div>
            </div>
          </div>

          {!userIsAdmin && (
            <p className="text-[11px] text-amber-400/90 mt-3 flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              <span>Only Plant Admin (h250862h@hit.ac.zw) is authorized to delete machines.</span>
            </p>
          )}
        </div>
      </div>

      {/* 4. Removed / Archived Machines List with Restore */}
      {goneMachines.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 sm:p-6">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-slate-200">
              Archived / Removed Machines ({goneMachines.length})
            </h4>
            {userIsAdmin && (
              <span className="text-[10px] text-emerald-400 font-semibold">
                Admin: Click Restore to reactivate
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mb-3">
            These machines are hidden from active status boards and forms. Admins can restore them anytime:
          </p>
          <div className="flex flex-wrap gap-2">
            {goneMachines.map((m) => (
              <button
                key={m}
                disabled={!userIsAdmin}
                onClick={() => handleRestoreMachine(m)}
                className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:border-emerald-500/50 transition disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3 text-emerald-400" />
                <span>Restore {m}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 5. Plant Staff & Operator Accounts Management (Admin Exclusive) */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-6 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Users className="h-4 w-4" />
              </span>
              <h3 className="text-base font-bold text-white">
                Plant Staff &amp; Operator Accounts
              </h3>
              {userIsAdmin ? (
                <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-black text-amber-300 uppercase border border-amber-500/30">
                  Admin Active
                </span>
              ) : (
                <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                  Admin Restricted
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {userIsAdmin
                ? 'Only administrators can provision new login accounts. Operators use these credentials to sign in.'
                : 'Account registration is managed strictly by Plant Administration (h250862h@hit.ac.zw).'}
            </p>
          </div>

          <div className="text-xs text-slate-400">
            Registered: <b className="text-white">{plantUsers.length}</b> staff members
          </div>
        </div>

        {/* Admin Provision Form */}
        {userIsAdmin ? (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                <UserPlus className="h-4 w-4" />
                <span>Create Personnel Login (Confidential Role-Based Access)</span>
              </h4>
              <span className="text-[10px] text-slate-400">
                Select a template below to auto-lock permitted sections
              </span>
            </div>

            {/* 3 Quick Role Templates */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => applyRolePreset('WH Personnel')}
                className={`text-left rounded-xl border p-3 transition ${
                  newOpRole === 'WH Personnel'
                    ? 'border-blue-500 bg-blue-500/15 shadow-md'
                    : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
                }`}
              >
                <div className="text-xs font-black text-blue-300">1. WH Personnel Login</div>
                <div className="text-[10px] text-slate-300 mt-0.5">
                  Sees ONLY WH Dispatch section to confirm goods received &amp; sign. No machine/HOD/Excel access.
                </div>
              </button>

              <button
                type="button"
                onClick={() => applyRolePreset('Shift In Charge')}
                className={`text-left rounded-xl border p-3 transition ${
                  newOpRole === 'Shift In Charge'
                    ? 'border-amber-500 bg-amber-500/15 shadow-md'
                    : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
                }`}
              >
                <div className="text-xs font-black text-amber-300">2. Shift In Charge Login</div>
                <div className="text-[10px] text-slate-300 mt-0.5">
                  Sees ONLY Machines &amp; Shift Dispatch of Trolleys. No WH confirm or confidential Excel reports.
                </div>
              </button>

              <button
                type="button"
                onClick={() => applyRolePreset('Production HOD')}
                className={`text-left rounded-xl border p-3 transition ${
                  newOpRole === 'Production HOD'
                    ? 'border-emerald-500 bg-emerald-500/15 shadow-md'
                    : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
                }`}
              >
                <div className="text-xs font-black text-emerald-300">3. Production HOD (Admin)</div>
                <div className="text-[10px] text-slate-300 mt-0.5">
                  Full Admin access: sees ALL sections, Final HOD Confirm, User Access &amp; Excel report downloads.
                </div>
              </button>
            </div>

            <form onSubmit={handleAdminProvisionOperator} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Staff Full Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={
                      newOpRole === 'WH Personnel'
                        ? 'e.g. Allan Mharandu (WH)'
                        : newOpRole === 'Production HOD'
                        ? 'e.g. Production HOD'
                        : 'e.g. Eric Nyamapanda'
                    }
                    value={newOpName}
                    onChange={(e) => setNewOpName(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Login Username or Work Email
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={
                      newOpRole === 'WH Personnel'
                        ? 'wh1 or wh@plant.co.zw'
                        : newOpRole === 'Production HOD'
                        ? 'hod or hod@plant.co.zw'
                        : 'shift1 or shift@plant.co.zw'
                    }
                    value={newOpEmail}
                    onChange={(e) => setNewOpEmail(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Login Password (Min 6 chars)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Plant@2026"
                    value={newOpPassword}
                    onChange={(e) => setNewOpPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Assigned Role (Auto-Sets Confidential Access)
                  </label>
                  <select
                    value={newOpRole}
                    onChange={(e) => applyRolePreset(e.target.value as PlantRole)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                  >
                    <option value="WH Personnel">WH Personnel (WH Confirm Goods Section Only)</option>
                    <option value="Shift In Charge">Shift In Charge (Machines &amp; Shift Trolley Dispatch Only)</option>
                    <option value="Production HOD">Production HOD (Admin — All Sections &amp; Reports)</option>
                    <option value="Operator Assistant">Operator Assistant (SOP Prod, QC &amp; Send Scrap)</option>
                    <option value="Recycling Team">Recycling Team (Receive &amp; Process Scrap → Mixers)</option>
                    <option value="Mixer Operator">Mixer Operator (Receive Regrind, Mix &amp; Report to HOD)</option>
                    <option value="Machine Operator">Machine Operator (Machine Status &amp; Log)</option>
                    <option value="Maintenance Technician">Maintenance Technician</option>
                    <option value="QC Inspector">QC Inspector</option>
                    <option value="Shift Supervisor">Shift Supervisor</option>
                    <option value="Plant Administrator">Plant Administrator</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Department
                  </label>
                  <select
                    value={newOpDept}
                    onChange={(e) => setNewOpDept(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                  >
                    <option value="Warehouse & Dispatch (WH)">Warehouse &amp; Dispatch (WH)</option>
                    <option value="Extrusion & Production">Extrusion &amp; Production</option>
                    <option value="Production Management (HOD)">Production Management (HOD)</option>
                    <option value="Injection Moulding">Injection Moulding</option>
                    <option value="Mixing & Raw Materials">Mixing &amp; Raw Materials</option>
                    <option value="Polypipe & Crushing">Polypipe &amp; Crushing</option>
                    <option value="Quality Control (QC)">Quality Control (QC)</option>
                    <option value="Plant Maintenance">Plant Maintenance</option>
                  </select>
                </div>
              </div>

              {/* Confidentiality Permissions Grid */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 space-y-2">
                <div className="text-[11px] font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" />
                  <span>Confidential Dashboard &amp; Report Permissions</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[11px]">
                  {(
                    [
                      ['viewMachineStatus', 'View Machine Status Board'],
                      ['logDowntime', 'Log & Restore Downtime'],
                      ['viewDailyHours', 'View Daily Hours'],
                      ['exportDowntimeExcel', 'Download Downtime Excel (Confidential)'],
                      ['dispatchShiftEntry', 'Dispatch: Shift In Charge Entry'],
                      ['dispatchWHConfirm', 'Dispatch: WH Personnel Confirm Qty'],
                      ['dispatchHODConfirm', 'Dispatch: Production HOD Final Confirm'],
                      ['exportDispatchExcel', 'Download Dispatch Excel (Confidential)'],
                      ['attendanceLogger', 'Attendance Logger (WhatsApp & Excel)'],
                      ['sopFloorAccess', 'SOP Floor: Production, QC & Dashboard'],
                      ['sopScrapSend', 'SOP Scrap: Operator Send (Alerts Recycling)'],
                      ['sopRecyclingConfirm', 'SOP Recycling: Verify & Process (Alerts Mixers)'],
                      ['sopMixingAccess', 'SOP Mixing: Mix & WH Stock (Alerts HOD)'],
                      ['manageMachinesAndSync', 'Admin Machines, Sync & Backup'],
                    ] as [keyof UserPermissions, string][]
                  ).map(([permKey, permLabel]) => (
                    <label
                      key={permKey}
                      className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5 cursor-pointer hover:border-amber-500/40"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(newOpPerms[permKey])}
                        onChange={(e) =>
                          setNewOpPerms((prev) => ({
                            ...prev,
                            [permKey]: e.target.checked,
                          }))
                        }
                        className="rounded border-slate-600 bg-slate-950 text-amber-500"
                      />
                      <span className="text-slate-200 font-medium">{permLabel}</span>
                    </label>
                  ))}
                </div>
              </div>

              {opMsg && (
                <div
                  className={`p-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                    opMsg.isError
                      ? 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                      : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                  }`}
                >
                  {opMsg.isError ? (
                    <AlertCircle className="h-4 w-4 shrink-0" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                  )}
                  <span>{opMsg.text}</span>
                </div>
              )}

              {createdCredentials && (
                <div className="rounded-xl border border-emerald-500/40 bg-slate-950 p-3.5 space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-black text-emerald-300 uppercase text-[11px]">
                      Ready to Sign In — {createdCredentials.role}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const txt = `PlantOps Login (${createdCredentials.role})\nName: ${createdCredentials.displayName}\nLogin ID / Email: ${createdCredentials.email}\nPassword: ${createdCredentials.password}\nApp URL: ${directAppUrl}`;
                        navigator.clipboard.writeText(txt);
                        setCopiedCreds(true);
                        setTimeout(() => setCopiedCreds(false), 2500);
                      }}
                      className="flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-[11px] font-bold text-white"
                    >
                      <Copy className="h-3 w-3" />
                      <span>{copiedCreds ? 'Copied!' : 'Copy Login Details'}</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[11px] bg-slate-900 rounded-lg p-2.5 border border-slate-800">
                    <div>
                      <span className="text-slate-500 block font-sans text-[10px]">Staff Name</span>
                      <span className="text-white font-bold">{createdCredentials.displayName}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block font-sans text-[10px]">Login ID / Email</span>
                      <span className="text-amber-300 font-bold">{createdCredentials.email}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block font-sans text-[10px]">Password</span>
                      <span className="text-emerald-300 font-bold">{createdCredentials.password}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={opLoading}
                  className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 px-4 py-2 text-xs font-bold text-slate-950 shadow transition disabled:opacity-50"
                >
                  <UserPlus className="h-4 w-4" />
                  <span>{opLoading ? 'Creating in Firebase...' : 'Create Confidential Account'}</span>
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 flex items-center gap-3 text-xs text-slate-400">
            <Lock className="h-5 w-5 text-amber-400 shrink-0" />
            <div>
              <span className="font-semibold text-slate-200 block">Registration Protected:</span>
              <span>
                Only the designated Plant Administrator (<code className="text-amber-400">h250862h@hit.ac.zw</code>) is authorized to register and configure confidential user access.
              </span>
            </div>
          </div>
        )}

        {/* Inline Edit User Confidentiality Drawer */}
        {userIsAdmin && editingUser && (
          <form
            onSubmit={handleSaveUserAccess}
            className="mt-4 rounded-xl border border-blue-500/50 bg-blue-950/20 p-4 space-y-3"
          >
            <div className="flex items-center justify-between border-b border-blue-500/20 pb-2">
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-blue-300 flex items-center gap-1.5">
                  <KeyRound className="h-4 w-4" />
                  <span>Edit Confidentiality &amp; Access: {editingUser.displayName}</span>
                </h4>
                <p className="text-[11px] text-slate-400">{editingUser.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800"
              >
                Cancel
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">Role</label>
                <select
                  value={editRole}
                  onChange={(e) => {
                    const r = e.target.value as PlantRole;
                    setEditRole(r);
                    setEditPerms(getDefaultPermissionsForRole(r));
                  }}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                >
                  <option value="Shift In Charge">Shift In Charge</option>
                  <option value="WH Personnel">WH Personnel</option>
                  <option value="Production HOD">Production HOD</option>
                  <option value="Operator Assistant">Operator Assistant</option>
                  <option value="Recycling Team">Recycling Team</option>
                  <option value="Mixer Operator">Mixer Operator</option>
                  <option value="Machine Operator">Machine Operator</option>
                  <option value="Maintenance Technician">Maintenance Technician</option>
                  <option value="QC Inspector">QC Inspector</option>
                  <option value="Shift Supervisor">Shift Supervisor</option>
                  <option value="Plant Administrator">Plant Administrator</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Department
                </label>
                <input
                  type="text"
                  value={editDept}
                  onChange={(e) => setEditDept(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Account Status
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as 'active' | 'suspended')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended (Lock All Access)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[11px]">
              {(
                [
                  ['viewMachineStatus', 'View Machine Status Board'],
                  ['logDowntime', 'Log & Restore Downtime'],
                  ['viewDailyHours', 'View Daily Hours'],
                  ['exportDowntimeExcel', 'Download Downtime Excel (Confidential)'],
                  ['dispatchShiftEntry', 'Dispatch: Shift In Charge Entry'],
                  ['dispatchWHConfirm', 'Dispatch: WH Personnel Confirm Qty'],
                  ['dispatchHODConfirm', 'Dispatch: Production HOD Final Confirm'],
                  ['exportDispatchExcel', 'Download Dispatch Excel (Confidential)'],
                  ['attendanceLogger', 'Attendance Logger (WhatsApp & Excel)'],
                  ['sopFloorAccess', 'SOP Floor: Production, QC & Dashboard'],
                  ['sopScrapSend', 'SOP Scrap: Operator Send (Alerts Recycling)'],
                  ['sopRecyclingConfirm', 'SOP Recycling: Verify & Process (Alerts Mixers)'],
                  ['sopMixingAccess', 'SOP Mixing: Mix & WH Stock (Alerts HOD)'],
                  ['manageMachinesAndSync', 'Admin Machines, Sync & Backup'],
                ] as [keyof UserPermissions, string][]
              ).map(([permKey, permLabel]) => (
                <label
                  key={permKey}
                  className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/90 px-2.5 py-1.5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(editPerms[permKey])}
                    onChange={(e) =>
                      setEditPerms((prev) => ({
                        ...prev,
                        [permKey]: e.target.checked,
                      }))
                    }
                    className="rounded border-slate-600 bg-slate-950 text-blue-500"
                  />
                  <span className="text-slate-200">{permLabel}</span>
                </label>
              ))}
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingEdit}
                className="rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-2 text-xs font-black text-white shadow transition disabled:opacity-50"
              >
                {savingEdit ? 'Saving to Cloud...' : 'Save Confidentiality Permissions'}
              </button>
            </div>
          </form>
        )}

        {/* Registered Users Roster */}
        <div className="mt-4">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5">
            Active Registered Plant Personnel ({plantUsers.length})
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {plantUsers.map((u) => {
              const isItemAdmin = u.email.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase();
              const isLockedSIC = isRestrictedShiftInChargeAccount(u.email, u.displayName);
              const resolvedPerms = isLockedSIC
                ? getDefaultPermissionsForRole('Shift In Charge')
                : u.permissions
                ? { ...getDefaultPermissionsForRole(u.role), ...u.permissions }
                : getDefaultPermissionsForRole(u.role);
              const totalSections = Object.keys(resolvedPerms).length;
              const allowedCount = Object.values(resolvedPerms).filter(Boolean).length;
              return (
                <div
                  key={u.uid}
                  className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-white truncate max-w-[150px]">
                        {u.displayName}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${
                          isItemAdmin
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : isLockedSIC
                            ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                            : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                        }`}
                      >
                        {isLockedSIC ? 'Shift In Charge' : u.role}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 truncate">
                      {u.email}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between">
                      <span>
                        Dept: <span className="text-slate-300">{u.department}</span>
                      </span>
                      <span className="text-emerald-400 font-semibold">
                        {allowedCount}/{totalSections} sections
                      </span>
                    </div>
                    {isLockedSIC && (
                      <div className="mt-1.5 rounded bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[9px] font-bold text-amber-300">
                        Locked: Machines &amp; Shift Dispatch Only
                      </div>
                    )}
                  </div>

                  {userIsAdmin && !isItemAdmin && (
                    <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => openEditUserAccess(u)}
                        className="flex items-center gap-1 text-[10px] font-bold text-blue-400 hover:text-blue-300"
                      >
                        <KeyRound className="h-3 w-3" />
                        <span>Edit Access</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteOperator(u.uid, u.displayName)}
                        className="flex items-center gap-1 text-[10px] text-rose-400 hover:text-rose-300"
                        title="Revoke access"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Revoke</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 5. Online Firebase Sync Status */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-6 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Cloud className="h-5 w-5 text-blue-400" />
              <span>Online Firebase Sync</span>
            </h3>
            <p className="text-xs text-slate-400">
              Active Project: <b className="text-slate-200 font-mono">downtime-log-d484f</b> •{' '}
              <span className={syncStatus === 'error' ? 'text-rose-400 font-semibold' : 'text-slate-300'}>
                {syncStatusMessage}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
                syncStatus === 'error'
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  : isOnline
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  syncStatus === 'error'
                    ? 'bg-rose-400'
                    : isOnline
                    ? 'bg-emerald-400 animate-pulse'
                    : 'bg-amber-400'
                }`}
              />
              {syncStatus === 'error' ? 'Sync Error' : isOnline ? 'Online Sync Active' : 'Offline Mode'}
            </span>

            <button
              onClick={handleManualSync}
              disabled={isSyncingNow || !isOnline}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-750 disabled:opacity-50 transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncingNow ? 'animate-spin' : ''}`} />
              <span>Sync now</span>
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Active Shift Reporter Name
            </label>
            <select
              value={currentReporter}
              onChange={(e) => onReporterChange(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              {DEFAULT_REPORTERS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              Used as the default reporting technician on this device.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 flex flex-col justify-between">
            <div>
              <div className="text-xs font-semibold text-slate-300">Firebase Authenticated Account</div>
              <div className="text-xs text-slate-400 mt-0.5">
                {currentUserEmail ? (
                  <span className="text-emerald-400">
                    Logged in as <b>{currentUserEmail}</b> ({userIsAdmin ? 'Admin' : 'Operator'}) • Auth:{' '}
                    <span className="font-mono">{auth.currentUser ? 'Connected' : 'Pending'}</span>
                  </span>
                ) : (
                  <span>Guest / Offline</span>
                )}
              </div>
            </div>

            <div className="mt-2">
              <button
                onClick={async () => {
                  await logoutUser();
                  window.location.reload();
                }}
                className="flex items-center gap-1 text-xs text-rose-400 hover:underline"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign out from APK</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 6. JSON Backup & Restore */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-6 shadow-md">
        <h3 className="text-base font-bold text-white flex items-center gap-2 mb-2">
          <Download className="h-5 w-5 text-amber-400" />
          <span>Offline Backup & Restore (JSON)</span>
        </h3>
        <p className="text-xs text-slate-400 mb-4">
          Save an offline backup of all downtime incident logs and custom machine names, or restore past backups:
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleSaveBackup}
            className="flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-100 px-4 py-2 text-xs font-bold transition"
          >
            <Download className="h-4 w-4 text-amber-400" />
            <span>Save backup file (.json)</span>
          </button>

          <div>
            <input
              type="file"
              ref={fileInputRef}
              accept=".json,application/json"
              onChange={handleRestoreFile}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 rounded-xl border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 px-4 py-2 text-xs font-bold transition"
            >
              <Upload className="h-4 w-4" />
              <span>Restore from backup file</span>
            </button>
          </div>
        </div>

        {backupMessage && (
          <div className="mt-3 text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded-xl">
            {backupMessage}
          </div>
        )}
      </div>
    </div>
  );
};
