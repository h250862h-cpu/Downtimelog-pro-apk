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
  FileSpreadsheet,
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
  logoutUser,
  PRIMARY_ADMIN_EMAIL,
  sendUserPasswordReset,
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
  CloudSyncDiagnosticsResult,
  getUnifiedPendingQueueBreakdown,
  PendingSyncBreakdown,
  runFullCloudSyncNow,
} from '../services/cloudSyncService';
import {
  BackgroundExcelReportId,
  BackgroundExcelReportSnapshot,
  buildAllAdminExcelReportsNow,
  downloadBackgroundExcelReport,
  subscribeBackgroundExcelReports,
} from '../services/backgroundExcelService';
import {
  applyLiveAppUpdate,
  checkForLiveServerUpdate,
  CURRENT_APP_BUILD_ID,
  getCanonicalSharedAppUrl,
} from '../services/appUpdateChecker';
import {
  DEFAULT_REPORTERS,
  DowntimeEntry,
  getDefaultPermissionsForRole,
  PlantRole,
  PlantUserAccount,
  UserPermissions,
  ZERO_PERMISSIONS,
} from '../types';
import { LgplastLogo } from './LgplastLogo';

interface SyncAndMachinesViewProps {
  machines: string[];
  entries: DowntimeEntry[];
  currentReporter: string;
  isOnline: boolean;
  syncStatus: 'synced' | 'syncing' | 'offline' | 'error';
  syncStatusMessage: string;
  totalPendingCount?: number;
  isAdmin?: boolean;
  onReporterChange: (name: string) => void;
  onRefreshData: () => void;
  onFullCloudSync?: () => Promise<void>;
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
  totalPendingCount,
  isAdmin: isAdminProp,
  onReporterChange,
  onRefreshData,
  onFullCloudSync,
  onOpenAuthModal,
  onOpenInstallModal,
}) => {
  const [newMachineName, setNewMachineName] = useState('');
  const [machineMessage, setMachineMessage] = useState<{ text: string; isError?: boolean } | null>(null);
  const [selectedRemoveMachine, setSelectedRemoveMachine] = useState<string>(machines[0] || '');
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [isSyncingNow, setIsSyncingNow] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [cloudDiag, setCloudDiag] = useState<CloudSyncDiagnosticsResult | null>(null);
  const [pendingBreakdown, setPendingBreakdown] = useState<PendingSyncBreakdown>(() =>
    getUnifiedPendingQueueBreakdown()
  );
  const [swUpdateNote, setSwUpdateNote] = useState<string | null>(null);
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
  const directAppUrl = getCanonicalSharedAppUrl();

  // Admin Check (supports explicit App state override + active session user + Firebase auth email)
  const currentUserEmail = getActiveSessionUser()?.email || auth.currentUser?.email;
  const userIsAdmin = typeof isAdminProp === 'boolean' ? isAdminProp : isUserAdmin(currentUserEmail);

  const [bgExcelReports, setBgExcelReports] = useState<BackgroundExcelReportSnapshot[]>([]);
  const [downloadingExcelId, setDownloadingExcelId] = useState<BackgroundExcelReportId | null>(null);
  const [regeneratingAllExcel, setRegeneratingAllExcel] = useState(false);

  useEffect(() => {
    const unsub = subscribePlantUsers((users) => {
      setPlantUsers(users);
    });
    const unsubBgExcel = userIsAdmin
      ? subscribeBackgroundExcelReports((list) => {
          setBgExcelReports(list);
        })
      : () => {};
    if (!userIsAdmin) setBgExcelReports([]);
    const refreshPending = setInterval(() => {
      setPendingBreakdown(getUnifiedPendingQueueBreakdown());
    }, 3000);
    return () => {
      unsub();
      unsubBgExcel();
      clearInterval(refreshPending);
    };
  }, [userIsAdmin]);

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
    } else if (role === 'Forklift Driver') {
      setNewOpDept('Logistics, Forklift & Bowser Fuel');
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
        ? {
            ...ZERO_PERMISSIONS,
            ...target.permissions,
          }
        : { ...ZERO_PERMISSIONS, ...getDefaultPermissionsForRole(target.role) }
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
    setPendingConfirm({
      title: 'Suspend & Revoke User Access',
      message: `Are you sure you want to suspend and revoke access for ${name}? Their session will lock automatically on all devices.`,
      confirmLabel: 'Suspend Access',
      danger: true,
      onConfirm: async () => {
        await deletePlantUserAccount(uid);
        setOpMsg({
          text: `Suspended access for ${name}. Their session will lock automatically on all devices.`,
          isError: false,
        });
      },
    });
  };

  const handleReactivateOperator = async (target: PlantUserAccount) => {
    if (!userIsAdmin || !currentUserEmail) return;
    try {
      const restoredPerms = target.permissions
        ? {
            ...ZERO_PERMISSIONS,
            ...target.permissions,
          }
        : {
            ...ZERO_PERMISSIONS,
            ...getDefaultPermissionsForRole(target.role),
          };
      const updated = await adminUpdateUserAccess(currentUserEmail, target, {
        role: target.role,
        department: target.department,
        permissions: restoredPerms,
        status: 'active',
      });
      setOpMsg({
        text: `Reactivated ${updated.displayName} (${updated.role}) across all devices.`,
        isError: false,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setOpMsg({ text: msg, isError: true });
    }
  };

  const handleSendPasswordResetForUser = async (target: PlantUserAccount) => {
    if (!userIsAdmin) return;
    if (target.email.endsWith('@plant.co.zw') || target.email.endsWith('@plant.com')) {
      setOpMsg({
        text: `Short internal IDs like ${target.email} do not have external inboxes. Create or reset real-email accounts via Admin Access, or update the user's clearance below.`,
        isError: true,
      });
      return;
    }
    try {
      const sentTo = await sendUserPasswordReset(target.email);
      setOpMsg({
        text: `Password reset email sent to ${sentTo}. Ask the user to check inbox/spam.`,
        isError: false,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setOpMsg({ text: msg, isError: true });
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

    setPendingConfirm({
      title: 'Archive Machine',
      message: `Archive "${selectedRemoveMachine}" from the active machine list? Its past downtime history will remain safe and it can be restored anytime.`,
      confirmLabel: 'Archive Machine',
      danger: false,
      onConfirm: async () => {
        const res = await removeMachine(selectedRemoveMachine, currentUserEmail);
        setMachineMessage({ text: res.message, isError: !res.ok });
        onRefreshData();
      },
    });
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

    setPendingConfirm({
      title: 'Permanent Machine Removal',
      message: `Are you sure you want to permanently remove "${selectedRemoveMachine}" from the active machine configuration?`,
      confirmLabel: 'Delete Permanently',
      danger: true,
      onConfirm: async () => {
        const res = await deleteMachinePermanent(selectedRemoveMachine, currentUserEmail);
        setMachineMessage({ text: res.message, isError: !res.ok });
        onRefreshData();
      },
    });
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

  // Manual Full Cloud Sync & Cross-Device Diagnostics
  const handleManualSync = async () => {
    setIsSyncingNow(true);
    try {
      await syncAllLocalToFirebase(entries).catch(() => 0);
      const diag = await runFullCloudSyncNow(true);
      setCloudDiag(diag);
      setPendingBreakdown(diag.pendingAfter);
      if (onFullCloudSync) {
        await onFullCloudSync();
      } else {
        onRefreshData();
      }
      if (diag.ok) {
        setBackupMessage(
          `Cloud Sync Verified (${diag.latencyMs} ms): ${diag.flushedTotal} outbox item(s) uploaded, server collections refreshed cleanly.`
        );
      } else {
        setBackupMessage(
          `Sync warning: ${diag.error || 'Could not reach Firebase server. Pending on device: ' + diag.pendingAfter.totalPending}`
        );
      }
    } catch (e: any) {
      setBackupMessage(`Sync error: ${e?.message || 'Check internet connection.'}`);
    } finally {
      setIsSyncingNow(false);
    }
  };

  // Check for Latest Published App / Service Worker Update
  const handleCheckAppVersionUpdate = async () => {
    setSwUpdateNote('Checking live server for latest Render build...');
    try {
      const check = await checkForLiveServerUpdate({ autoReloadIfDifferent: false });
      if (check.updateAvailable && check.serverBuildId) {
        setSwUpdateNote(
          `New build (${check.serverBuildId}) found on server — clearing cache & reloading...`
        );
        setTimeout(() => {
          applyLiveAppUpdate(check.serverBuildId || undefined);
        }, 400);
        return;
      }
      setSwUpdateNote(
        `Force refreshing browser cache (Build ${CURRENT_APP_BUILD_ID})...`
      );
      setTimeout(() => {
        applyLiveAppUpdate(check.serverBuildId || undefined);
      }, 400);
    } catch {
      window.location.reload();
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
              All shared APK links route to this unified plant address and share the same live Firestore cloud database — any entry or update on one device appears automatically across all links:
            </p>
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-emerald-400 break-all select-all">
              <span>{directAppUrl}</span>
            </div>
            {typeof window !== 'undefined' && window.location.origin !== directAppUrl && (
              <p className="text-[11px] text-sky-300 mt-1">
                Active preview mirror ({window.location.origin}) is connected to the exact same live cloud database as {directAppUrl}.
              </p>
            )}
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
                Publish Directory: <code className="bg-slate-900 px-1.5 py-0.5 rounded text-emerald-300">dist</code>{' '}
                <span className="text-amber-300 font-semibold">(type <code>dist</code>, NOT <code>dict</code>)</span>
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

            {/* 4 Quick Role Templates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
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

              <button
                type="button"
                onClick={() => applyRolePreset('Plant Administrator')}
                className={`text-left rounded-xl border p-3 transition ${
                  newOpRole === 'Plant Administrator'
                    ? 'border-purple-500 bg-purple-500/15 shadow-md'
                    : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
                }`}
              >
                <div className="text-xs font-black text-purple-300">4. Plant Administrator (Admin)</div>
                <div className="text-[10px] text-slate-300 mt-0.5">
                  Full APK Administrator account: manages staff logins, machinery, background Excel &amp; all approvals.
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
                    <option value="Forklift Driver">Forklift Driver (Fuel Request &amp; Bowser Meter Entry)</option>
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
                      ['exportDowntimeExcel', 'Download Downtime Excel (Admin Only)'],
                      ['dispatchShiftEntry', 'Dispatch: Shift In Charge Entry'],
                      ['dispatchWHConfirm', 'Dispatch: WH Personnel Confirm Qty'],
                      ['dispatchHODConfirm', 'Dispatch: Production HOD Final Confirm'],
                      ['exportDispatchExcel', 'Download Dispatch Excel (Admin Only)'],
                      ['attendanceLogger', 'Attendance Logger (WhatsApp)'],
                      ['sopFloorAccess', 'SOP Floor: Production, QC & Dashboard'],
                      ['sopScrapSend', 'SOP Scrap: Operator Send (Alerts Recycling)'],
                      ['sopRecyclingConfirm', 'SOP Recycling: Verify & Process (Alerts Mixers)'],
                      ['scrapSalesAccess', 'Recycling Scrap Sales & 3-Sig Invoice'],
                      ['sopMixingAccess', 'SOP Mixing: Mix & WH Stock (Alerts HOD)'],
                      ['sopHandoverAccess', 'SOP Shift Handover APK'],
                      ['powerGenAccess', 'Power Cut & Generator Logs'],
                      ['productionPlanningAccess', 'Production Planning & Plan Closure View'],
                      ['productionReportAccess', 'Period Production Report & Excel (Admin Only)'],
                      ['dieselFuelRequest', 'Diesel Bowser: Request Fuel & Meter Readings'],
                      ['dieselHODApprove', 'Diesel Bowser: Production HOD Approve & Unlock PDF'],
                      ['dieselGRN', 'Diesel Bowser: Receive Tank GRN (Supplier Signed)'],
                      ['dieselExportExcel', 'Diesel Bowser: Export Fuel Excel (Admin Only)'],
                      ['specialOrdersAccess', 'Special Orders: Gum Boots & Factory/WH Stock'],
                      ['qualityTrialsAccess', 'Quality Trials: ISO/QMS/ASTM/SAZ Trials & PDF'],
                      ['tqmAccess', 'Total Quality Management (TQM) & CAPA System'],
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
                  <option value="Forklift Driver">Forklift Driver</option>
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
                  ['exportDowntimeExcel', 'Download Downtime Excel (Admin Only)'],
                  ['dispatchShiftEntry', 'Dispatch: Shift In Charge Entry'],
                  ['dispatchWHConfirm', 'Dispatch: WH Personnel Confirm Qty'],
                  ['dispatchHODConfirm', 'Dispatch: Production HOD Final Confirm'],
                  ['exportDispatchExcel', 'Download Dispatch Excel (Admin Only)'],
                  ['attendanceLogger', 'Attendance Logger (WhatsApp)'],
                  ['sopFloorAccess', 'SOP Floor: Production, QC & Dashboard'],
                  ['sopScrapSend', 'SOP Scrap: Operator Send (Alerts Recycling)'],
                  ['sopRecyclingConfirm', 'SOP Recycling: Verify & Process (Alerts Mixers)'],
                  ['scrapSalesAccess', 'Recycling Scrap Sales & 3-Sig Invoice'],
                  ['sopMixingAccess', 'SOP Mixing: Mix & WH Stock (Alerts HOD)'],
                  ['sopHandoverAccess', 'SOP Shift Handover APK'],
                  ['powerGenAccess', 'Power Cut & Generator Logs'],
                  ['productionPlanningAccess', 'Production Planning & Plan Closure View'],
                  ['productionReportAccess', 'Period Production Report & Excel (Admin Only)'],
                  ['dieselFuelRequest', 'Diesel Bowser: Request Fuel & Meter Readings'],
                  ['dieselHODApprove', 'Diesel Bowser: Production HOD Approve & Unlock PDF'],
                  ['dieselGRN', 'Diesel Bowser: Receive Tank GRN (Supplier Signed)'],
                  ['dieselExportExcel', 'Diesel Bowser: Export Fuel Excel (Admin Only)'],
                  ['specialOrdersAccess', 'Special Orders: Gum Boots & Factory/WH Stock'],
                  ['qualityTrialsAccess', 'Quality Trials: ISO/QMS/ASTM/SAZ Trials & PDF'],
                  ['tqmAccess', 'Total Quality Management (TQM) & CAPA System'],
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

        {/* Registered Users Roster (Admin Exclusive) */}
        {userIsAdmin && (
          <div className="mt-4">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5">
            Registered Plant Personnel (
            {plantUsers.filter((u) => u.status !== 'suspended' && !u.revoked).length} active
            {plantUsers.some((u) => u.status === 'suspended' || u.revoked)
              ? ` · ${plantUsers.filter((u) => u.status === 'suspended' || u.revoked).length} suspended`
              : ''}
            )
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {plantUsers.map((u) => {
              const isItemAdmin = u.email.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase();
              const isSuspended = u.status === 'suspended' || Boolean(u.revoked);
              const resolvedPerms: UserPermissions = isSuspended
                ? { ...ZERO_PERMISSIONS }
                : u.permissions
                ? { ...ZERO_PERMISSIONS, ...u.permissions }
                : { ...ZERO_PERMISSIONS, ...getDefaultPermissionsForRole(u.role) };
              const totalSections = Object.keys(ZERO_PERMISSIONS).length;
              const allowedCount = Object.values(resolvedPerms).filter(Boolean).length;
              return (
                <div
                  key={u.uid}
                  className={`rounded-xl border p-3 flex flex-col justify-between ${
                    isSuspended
                      ? 'border-rose-500/40 bg-rose-950/20 opacity-85'
                      : 'border-slate-800 bg-slate-950/70'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1.5 mb-1">
                      <span className="text-xs font-bold text-white truncate max-w-[140px]">
                        {u.displayName}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {isSuspended && (
                          <span className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase bg-rose-500/20 text-rose-300 border border-rose-500/40">
                            SUSPENDED
                          </span>
                        )}
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${
                            isItemAdmin
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : u.role === 'WH Personnel'
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          }`}
                        >
                          {u.role}
                        </span>
                      </div>
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 truncate">
                      {u.email}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between">
                      <span>
                        Dept: <span className="text-slate-300">{u.department}</span>
                      </span>
                      <span
                        className={`font-semibold ${
                          isSuspended ? 'text-rose-400' : 'text-emerald-400'
                        }`}
                      >
                        {allowedCount}/{totalSections} sections
                      </span>
                    </div>
                  </div>

                  {userIsAdmin && (
                    <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                      {!isItemAdmin ? (
                        <button
                          type="button"
                          onClick={() => openEditUserAccess(u)}
                          className="flex items-center gap-1 text-[10px] font-bold text-blue-400 hover:text-blue-300"
                        >
                          <KeyRound className="h-3 w-3" />
                          <span>Edit Access</span>
                        </button>
                      ) : (
                        <span className="text-[10px] font-bold text-amber-400">
                          Primary System Admin
                        </span>
                      )}

                      <div className="flex items-center gap-2.5">
                        {!u.email.endsWith('@plant.co.zw') && !u.email.endsWith('@plant.com') && (
                          <button
                            type="button"
                            onClick={() => handleSendPasswordResetForUser(u)}
                            className="flex items-center gap-1 text-[10px] font-semibold text-sky-400 hover:text-sky-300"
                            title="Send password reset email via Firebase Auth"
                          >
                            <KeyRound className="h-3 w-3" />
                            <span>Reset PW</span>
                          </button>
                        )}

                        {!isItemAdmin &&
                          (isSuspended ? (
                            <button
                              type="button"
                              onClick={() => handleReactivateOperator(u)}
                              className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 hover:text-emerald-300"
                              title="Restore access across all devices"
                            >
                              <UserCheck className="h-3 w-3" />
                              <span>Reactivate</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleDeleteOperator(u.uid, u.displayName)}
                              className="flex items-center gap-1 text-[10px] text-rose-400 hover:text-rose-300"
                              title="Suspend & revoke access"
                            >
                              <Trash2 className="h-3 w-3" />
                              <span>Revoke</span>
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        )}
      </div>

      {/* 5. Online Firebase Sync Status & Cross-Device Diagnostics */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-6 shadow-md space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Cloud className="h-5 w-5 text-blue-400" />
              <span>Online Firebase Cloud Sync &amp; Server Diagnostics</span>
            </h3>
            <p className="text-xs text-slate-400">
              Active Project: <b className="text-slate-200 font-mono">downtime-log-d484f</b> (Database: <code className="text-slate-300">(default)</code>) •{' '}
              <span className={syncStatus === 'error' ? 'text-rose-400 font-semibold' : 'text-slate-300'}>
                {syncStatusMessage}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
                syncStatus === 'error'
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  : (totalPendingCount ?? pendingBreakdown.totalPending) > 0
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : isOnline
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  syncStatus === 'error'
                    ? 'bg-rose-400'
                    : (totalPendingCount ?? pendingBreakdown.totalPending) > 0
                    ? 'bg-amber-400 animate-pulse'
                    : isOnline
                    ? 'bg-emerald-400 animate-pulse'
                    : 'bg-amber-400'
                }`}
              />
              {syncStatus === 'error'
                ? 'Sync Error'
                : (totalPendingCount ?? pendingBreakdown.totalPending) > 0
                ? `${totalPendingCount ?? pendingBreakdown.totalPending} Unsent on Device`
                : isOnline
                ? 'Server Synced'
                : 'Offline Mode'}
            </span>

            <button
              onClick={handleManualSync}
              disabled={isSyncingNow || !isOnline}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 px-3.5 py-1.5 text-xs font-bold text-white disabled:opacity-50 transition shadow"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncingNow ? 'animate-spin' : ''}`} />
              <span>{isSyncingNow ? 'Verifying Server...' : 'Force Full Sync & Probe'}</span>
            </button>

            <button
              type="button"
              onClick={handleCheckAppVersionUpdate}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition"
              title="Fetch latest deployed app bundle & clear stale PWA cache"
            >
              <RotateCcw className="h-3.5 w-3.5 text-sky-400" />
              <span>Reload App Version</span>
            </button>
          </div>
        </div>

        {/* Live Cloud Diagnostics Summary */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              {cloudDiag ? (
                cloudDiag.ok ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-400 font-bold">
                    <CheckCircle2 className="h-4 w-4" />
                    Server Connected ({cloudDiag.latencyMs} ms) • Auth: {cloudDiag.authEmail || 'Active'}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-rose-400 font-bold">
                    <AlertCircle className="h-4 w-4" />
                    Server Issue: {cloudDiag.error || 'Unreachable'}
                  </span>
                )
              ) : (
                <span className="text-slate-400">
                  Click <b className="text-slate-200">Force Full Sync &amp; Probe</b> to test live phone-to-cloud connectivity and pull the latest server records across all modules.
                </span>
              )}
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              Device Outbox: <b className={pendingBreakdown.totalPending > 0 ? 'text-amber-300' : 'text-emerald-400'}>{pendingBreakdown.totalPending} pending</b>
              {pendingBreakdown.ruleBlockedPending > 0 && (
                <span className="ml-2 text-slate-500">
                  ({pendingBreakdown.ruleBlockedPending} saved locally)
                </span>
              )}
            </div>
          </div>

          {pendingBreakdown.totalPending > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200 flex flex-wrap gap-x-4 gap-y-1">
              <span className="font-bold text-amber-300">Unsent Items Waiting on This Device:</span>
              {pendingBreakdown.downtime > 0 && <span>Downtime: {pendingBreakdown.downtime}</span>}
              {pendingBreakdown.dispatch > 0 && <span>Dispatch: {pendingBreakdown.dispatch}</span>}
              {pendingBreakdown.specialOrders > 0 && <span>Special Orders: {pendingBreakdown.specialOrders}</span>}
              {pendingBreakdown.qualityTrials > 0 && <span>Trials: {pendingBreakdown.qualityTrials}</span>}
              {pendingBreakdown.scrapSales > 0 && <span>Scrap Sales: {pendingBreakdown.scrapSales}</span>}
              {pendingBreakdown.tqmCapas > 0 && <span>TQM CAPAs: {pendingBreakdown.tqmCapas}</span>}
              {pendingBreakdown.sop > 0 && <span>SOP Logs: {pendingBreakdown.sop}</span>}
              {pendingBreakdown.diesel > 0 && <span>Diesel: {pendingBreakdown.diesel}</span>}
              {pendingBreakdown.powerGen > 0 && <span>Power/Gen: {pendingBreakdown.powerGen}</span>}
              {pendingBreakdown.planningAndHist > 0 && <span>Plans/History: {pendingBreakdown.planningAndHist}</span>}
              {pendingBreakdown.attendanceAndQc > 0 && <span>Attendance/QC: {pendingBreakdown.attendanceAndQc}</span>}
              {pendingBreakdown.plantUsers > 0 && <span>User Accounts: {pendingBreakdown.plantUsers}</span>}
            </div>
          )}

          {cloudDiag && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[11px]">
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
                <div className="text-slate-400">Downtime Logs</div>
                <div className="font-bold text-white">{cloudDiag.counts.downtime}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
                <div className="text-slate-400">Dispatch Records</div>
                <div className="font-bold text-white">{cloudDiag.counts.dispatch}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
                <div className="text-slate-400">Special Orders</div>
                <div className="font-bold text-white">
                  {cloudDiag.counts.specialOrderProd} fac / {cloudDiag.counts.specialOrderWh} WH
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
                <div className="text-slate-400">Quality Trials</div>
                <div className="font-bold text-white">{cloudDiag.counts.trials}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
                <div className="text-slate-400">Scrap Sales Inv.</div>
                <div className="font-bold text-white">{cloudDiag.counts.scrapSales}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
                <div className="text-slate-400">TQM CAPAs</div>
                <div className="font-bold text-white">{cloudDiag.counts.tqmCapas}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
                <div className="text-slate-400">SOP Floor / QC</div>
                <div className="font-bold text-white">
                  {cloudDiag.counts.sopProd} prod / {cloudDiag.counts.sopQc} QC
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
                <div className="text-slate-400">Diesel / GRNs</div>
                <div className="font-bold text-white">
                  {cloudDiag.counts.dieselReqs} req / {cloudDiag.counts.dieselGrns} GRN
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
                <div className="text-slate-400">Power Cut / Gen</div>
                <div className="font-bold text-white">
                  {cloudDiag.counts.powerCuts} cut / {cloudDiag.counts.generatorLogs} gen
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
                <div className="text-slate-400">Monthly Plans</div>
                <div className="font-bold text-white">{cloudDiag.counts.plans}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
                <div className="text-slate-400">Attendance Batches</div>
                <div className="font-bold text-white">{cloudDiag.counts.attendance}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
                <div className="text-slate-400">Machines / Staff</div>
                <div className="font-bold text-white">
                  {cloudDiag.counts.machines} mach / {cloudDiag.counts.users} staff
                </div>
              </div>
            </div>
          )}

          {swUpdateNote && (
            <div className="text-[11px] font-semibold text-sky-300 bg-sky-500/10 border border-sky-500/20 px-2.5 py-1.5 rounded-lg">
              {swUpdateNote}
            </div>
          )}

          <div className="rounded-lg border border-blue-500/20 bg-blue-950/20 p-2.5 text-[11px] text-slate-300 flex items-start gap-2">
            <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
            <span>
              <b>Note on Render, Shared Link &amp; Live Data (Build {CURRENT_APP_BUILD_ID}):</b> Render Blueprint (<code className="text-sky-300">render.yaml</code>) deploys via <code className="text-slate-200">npm install &amp;&amp; npm run build</code> with no-cache headers on <code className="text-slate-200">index.html</code>, <code className="text-slate-200">sw.js</code>, and <code className="text-slate-200">version.json</code> so new updates appear automatically on phones. Tap <b>Reload App Version</b> above anytime to force-clear older PWA cache.
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

      {/* 6. Admin-Only Background Excel Reports Vault */}
      {userIsAdmin && (
        <div className="rounded-2xl border border-emerald-500/40 bg-slate-900/95 p-4 sm:p-6 shadow-lg space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
                <span>Admin-Only Background Excel Reports Vault (.xlsx)</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                All Excel reports are compiled silently in a background worker exclusively for Admin accounts. Tap any report to download immediately.
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                setRegeneratingAllExcel(true);
                try {
                  await buildAllAdminExcelReportsNow(true);
                } finally {
                  setRegeneratingAllExcel(false);
                }
              }}
              disabled={regeneratingAllExcel}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3.5 py-2 text-xs font-black text-white shadow transition shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${regeneratingAllExcel ? 'animate-spin' : ''}`} />
              <span>{regeneratingAllExcel ? 'Compiling in Background...' : 'Regenerate All in Background'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {bgExcelReports.map((rep) => (
              <div
                key={rep.id}
                className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 flex flex-col justify-between gap-2.5"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {rep.category}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                        rep.status === 'ready'
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                          : rep.status === 'generating'
                          ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                          : rep.status === 'error'
                          ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                          : 'border-slate-700 bg-slate-900 text-slate-400'
                      }`}
                    >
                      {rep.status === 'ready'
                        ? 'Ready'
                        : rep.status === 'generating'
                        ? 'Generating...'
                        : rep.status === 'error'
                        ? 'Error'
                        : 'Queued'}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-white">{rep.label}</div>
                  <div className="text-[11px] text-slate-400 tabular-nums">
                    {rep.rowCount} records
                    {rep.sizeBytes > 0 ? ` · ${(rep.sizeBytes / 1024).toFixed(1)} KB` : ''}
                    {rep.generatedAtIso
                      ? ` · Updated ${new Date(rep.generatedAtIso).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`
                      : ''}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    setDownloadingExcelId(rep.id);
                    try {
                      await downloadBackgroundExcelReport(rep.id, userIsAdmin);
                    } finally {
                      setDownloadingExcelId(null);
                    }
                  }}
                  disabled={downloadingExcelId === rep.id || rep.status === 'generating'}
                  className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#193054] border border-slate-700 disabled:opacity-50 px-3 py-1.5 text-xs font-bold text-white transition"
                >
                  <Download className="h-3.5 w-3.5 text-emerald-400" />
                  <span>
                    {downloadingExcelId === rep.id ? 'Preparing .xlsx...' : 'Download Excel (.xlsx)'}
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 7. JSON Backup & Restore (Admin Only) */}
      {userIsAdmin && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-6 shadow-md">
          <h3 className="text-base font-bold text-white flex items-center gap-2 mb-2">
            <Download className="h-5 w-5 text-amber-400" />
            <span>Offline Backup &amp; Restore (JSON)</span>
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
      )}

      {pendingConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl space-y-4">
            <h4 className="text-base font-bold text-white">{pendingConfirm.title}</h4>
            <p className="text-xs text-slate-300 leading-relaxed">{pendingConfirm.message}</p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-750"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const action = pendingConfirm.onConfirm;
                  setPendingConfirm(null);
                  await action();
                }}
                className={`rounded-xl px-4 py-2 text-xs font-semibold text-white ${
                  pendingConfirm.danger
                    ? 'bg-rose-600 hover:bg-rose-500'
                    : 'bg-amber-600 hover:bg-amber-500'
                }`}
              >
                {pendingConfirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
