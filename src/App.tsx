import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  Activity,
  BarChart3,
  Bell,
  BellRing,
  Calendar,
  ClipboardCheck,
  ClipboardList,
  CloudOff,
  FileSpreadsheet,
  FlaskConical,
  Fuel,
  LayoutDashboard,
  Layers,
  Lock,
  LogOut,
  Menu,
  Plus,
  Recycle,
  RefreshCw,
  Send,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Truck,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { AttendanceLoggerApp } from './components/AttendanceLoggerApp';
import { AuthModal } from './components/AuthModal';
import { DailyHoursView } from './components/DailyHoursView';
import { DieselBowserView } from './components/DieselBowserView';
import { DieselPopupAlert, DieselSubTab } from './components/DieselPopupAlert';
import { DispatchPopupAlert, DispatchSubStage } from './components/DispatchPopupAlert';
import { DispatchSystemView } from './components/DispatchSystemView';
import { LgplastLogo } from './components/LgplastLogo';
import { LogDowntimeView } from './components/LogDowntimeView';
import { LoginGate } from './components/LoginGate';
import { MachineStatusBoard } from './components/MachineStatusBoard';
import { PeriodProductionReportView } from './components/PeriodProductionReportView';
import { PeriodReportView } from './components/PeriodReportView';
import { ProductionPlanningView } from './components/ProductionPlanningView';
import { PWAInstallModal } from './components/PWAInstallModal';
import {
  ActiveScheduleSlot,
  getActiveWeightOutputSlot,
  getNextWeightOutputSlot,
  ShiftWeightOutputPopupAlert,
} from './components/ShiftWeightOutputPopupAlert';
import { SignedCertificateModal } from './components/SignedCertificateModal';
import { SopFloorApkView } from './components/SopFloorApkView';
import { SopPopupAlert, SopSubTab } from './components/SopPopupAlert';
import { SyncAndMachinesView } from './components/SyncAndMachinesView';
import {
  auth,
  ensureFirebaseAuth,
  getActiveSessionUser,
  getLocalPlantUsers,
  isRestrictedShiftInChargeAccount,
  logoutUser,
  resolveUserPermissions,
  subscribePlantUsers,
  testConnection,
} from './firebase';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { usePWAInstall } from './hooks/usePWAInstall';
import {
  flushPendingAttendanceBatches,
  getLocalAttendanceBatch,
  subscribeAttendanceBatches,
} from './services/attendanceStore';
import {
  flushPendingDieselData,
  getLocalDieselGrns,
  getLocalDieselRequests,
  getLocalDieselTank,
  pollDieselGrns,
  pollDieselRequests,
  pollDieselTank,
  subscribeDieselGrns,
  subscribeDieselRequests,
  subscribeDieselTank,
} from './services/dieselStore';
import {
  flushPendingDispatches,
  pollDispatchEntries,
  subscribeDispatchEntries,
} from './services/dispatchStore';
import { dtl, ymd } from './services/downtimeCalc';
import {
  flushPendingSyncQueue,
  getActiveMachines,
  getCurrentReporterName,
  getLastSyncError,
  getPendingSyncQueue,
  getStoredEntries,
  isUserAdmin,
  pollFirebaseEntries,
  saveStoredEntries,
  setCurrentReporterName,
  subscribeFirebaseEntries,
  subscribeMachineryConfig,
  syncEntryToFirebase,
} from './services/downtimeStore';
import {
  flushPendingProductionPlans,
  flushPendingUploadedBackgroundDispatches,
  getLocalProductionPlans,
  getLocalUploadedBackgroundDispatches,
  mergeAllDispatchesWithBackground,
  pollProductionPlans,
  pollUploadedBackgroundDispatches,
  subscribeProductionPlans,
  subscribeUploadedBackgroundDispatches,
} from './services/productionPlanStore';
import {
  flushAllPendingSopData,
  getLocalSopHandovers,
  getLocalSopMixingReports,
  getLocalSopProductionLogs,
  getLocalSopQcChecks,
  getLocalSopScrapRecords,
  pollSopHandovers,
  pollSopMixing,
  pollSopProduction,
  pollSopQc,
  pollSopScrap,
  subscribeSopHandovers,
  subscribeSopMixing,
  subscribeSopProduction,
  subscribeSopQc,
  subscribeSopScrap,
} from './services/sopStore';
import {
  ensurePushServiceWorkerRegistration,
  evaluateAndDispatchPushNotifications,
  getPushPermissionStatus,
  isPushSoundEnabled,
  OsPushNavigationPayload,
  requestPhonePushPermission,
  sendTestPhonePushNotification,
  setPushSoundEnabled,
  updateAppBadgeCount,
} from './services/pushNotifications';
import {
  DieselFuelRequest,
  DieselGrnRecord,
  DieselTankConfig,
  DispatchEntry,
  DowntimeEntry,
  PlantUserAccount,
  ProductionPlanItem,
  SopMixingReport,
  SopProductionRecord,
  SopQcRecord,
  SopScrapRecord,
  SopShiftHandoverRecord,
} from './types';
import { ParsedAttendanceMessage } from './types/attendance';

export type DowntimeTab =
  | 'status'
  | 'log'
  | 'daily'
  | 'dispatch'
  | 'prod_planning'
  | 'diesel'
  | 'sop_overview'
  | 'sop_production'
  | 'sop_qc'
  | 'sop_scrap'
  | 'sop_recycling'
  | 'sop_mixing'
  | 'sop_handover'
  | 'attendance'
  | 'prod_report'
  | 'rep'
  | 'data';

const SOP_TAB_TO_SUBTAB: Partial<Record<DowntimeTab, SopSubTab>> = {
  sop_overview: 'overview',
  sop_production: 'production',
  sop_qc: 'qc',
  sop_scrap: 'scrap_send',
  sop_recycling: 'recycling',
  sop_mixing: 'mixing',
  sop_handover: 'handover',
};

const SUBTAB_TO_SOP_TAB: Record<SopSubTab, DowntimeTab> = {
  overview: 'sop_overview',
  production: 'sop_production',
  qc: 'sop_qc',
  scrap_send: 'sop_scrap',
  recycling: 'sop_recycling',
  mixing: 'sop_mixing',
  handover: 'sop_handover',
};

export default function App() {
  const isOnline = useOnlineStatus();
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWAInstall();

  // Auth State (supports FirebaseUser and local verified PlantSessionUser)
  const [user, setUser] = useState<{
    uid: string;
    email: string | null;
    displayName: string | null;
    role?: string;
  } | null>(() => getActiveSessionUser());
  const [authLoading, setAuthLoading] = useState(true);
  const [plantUsers, setPlantUsers] = useState<PlantUserAccount[]>(() => getLocalPlantUsers());

  // Active Navigation Tab & Sub-stage Navigation
  const [activeDowntimeTab, setActiveDowntimeTab] = useState<DowntimeTab>('status');
  const [requestedDispatchStage, setRequestedDispatchStage] = useState<DispatchSubStage | null>(null);
  const [requestedDieselSubTab, setRequestedDieselSubTab] = useState<DieselSubTab | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Core Data State - Machinery Downtime, 3-Stage Dispatch, Planning, Diesel Bowser, SOP Floor APK & Attendance
  const [machines, setMachines] = useState<string[]>(getActiveMachines());
  const [entries, setEntries] = useState<DowntimeEntry[]>(getStoredEntries());
  const [dispatchEntries, setDispatchEntries] = useState<DispatchEntry[]>([]);
  const [uploadedBackgroundDispatches, setUploadedBackgroundDispatches] = useState<DispatchEntry[]>(
    () => getLocalUploadedBackgroundDispatches()
  );
  const [monthlyPlans, setMonthlyPlans] = useState<ProductionPlanItem[]>(() =>
    getLocalProductionPlans()
  );
  const [dieselTank, setDieselTank] = useState<DieselTankConfig>(() => getLocalDieselTank());
  const [dieselRequests, setDieselRequests] = useState<DieselFuelRequest[]>(() =>
    getLocalDieselRequests()
  );
  const [dieselGrns, setDieselGrns] = useState<DieselGrnRecord[]>(() => getLocalDieselGrns());
  const [sopProductionLogs, setSopProductionLogs] = useState<SopProductionRecord[]>(() =>
    getLocalSopProductionLogs()
  );
  const [sopQcChecks, setSopQcChecks] = useState<SopQcRecord[]>(() => getLocalSopQcChecks());
  const [sopScrapPipeline, setSopScrapPipeline] = useState<SopScrapRecord[]>(() =>
    getLocalSopScrapRecords()
  );
  const [sopMixingReports, setSopMixingReports] = useState<SopMixingReport[]>(() =>
    getLocalSopMixingReports()
  );
  const [sopHandovers, setSopHandovers] = useState<SopShiftHandoverRecord[]>(() =>
    getLocalSopHandovers()
  );
  const [attendanceBatch, setAttendanceBatch] = useState<ParsedAttendanceMessage[]>(() =>
    getLocalAttendanceBatch()
  );
  const [dismissedPopupKeys, setDismissedPopupKeys] = useState<string[]>([]);

  const allDispatchesWithBackground = useMemo(
    () => mergeAllDispatchesWithBackground(dispatchEntries, uploadedBackgroundDispatches),
    [dispatchEntries, uploadedBackgroundDispatches]
  );

  const [currentReporter, setCurrentReporter] = useState<string>(() => {
    const s = getActiveSessionUser();
    return s?.displayName || getCurrentReporterName();
  });
  const [prefilledMachine, setPrefilledMachine] = useState<string>('');

  // Firebase Sync Status & Pending Queue
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'offline' | 'error'>('synced');
  const [syncStatusMsg, setSyncStatusMsg] = useState<string>('Sync initialized');
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(() => getPendingSyncQueue().length);
  const [isManualSyncing, setIsManualSyncing] = useState(false);

  // Modals
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [certificateEntry, setCertificateEntry] = useState<DowntimeEntry | null>(null);
  const [isCertificateModalOpen, setIsCertificateModalOpen] = useState(false);
  const [manualWeightCheckSlot, setManualWeightCheckSlot] = useState<ActiveScheduleSlot | null>(
    null
  );

  // Link copy toast
  const [copiedLink, setCopiedLink] = useState(false);
  const [syncErrorMsg, setSyncErrorMsg] = useState<string | null>(null);

  // Phone OS Push Notification State
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    getPushPermissionStatus()
  );
  const [pushSoundOn, setPushSoundOn] = useState<boolean>(() => isPushSoundEnabled());
  const [pushBannerDismissed, setPushBannerDismissed] = useState(false);
  const [pushClockTick, setPushClockTick] = useState<number>(() => Date.now());
  const [pushTestStatus, setPushTestStatus] = useState<string | null>(null);

  // Wider display side interface colour theme (all colours selector — pure Tailwind gradients)
  const DISPLAY_THEMES = [
    {
      id: 'royal',
      label: 'Royal Blue',
      swatchClass: 'bg-blue-600',
      bgClass: 'bg-gradient-to-br from-[#0f2f66] via-[#14408a] to-[#0a214a]',
    },
    {
      id: 'sky',
      label: 'Sky Blue',
      swatchClass: 'bg-sky-500',
      bgClass: 'bg-gradient-to-br from-sky-950 via-sky-800 to-slate-950',
    },
    {
      id: 'teal',
      label: 'Ocean Teal',
      swatchClass: 'bg-teal-500',
      bgClass: 'bg-gradient-to-br from-teal-950 via-teal-800 to-slate-950',
    },
    {
      id: 'cyan',
      label: 'Cyan Surge',
      swatchClass: 'bg-cyan-500',
      bgClass: 'bg-gradient-to-br from-cyan-950 via-cyan-800 to-slate-950',
    },
    {
      id: 'emerald',
      label: 'Emerald Green',
      swatchClass: 'bg-emerald-500',
      bgClass: 'bg-gradient-to-br from-emerald-950 via-emerald-800 to-slate-950',
    },
    {
      id: 'green',
      label: 'Forest Green',
      swatchClass: 'bg-green-600',
      bgClass: 'bg-gradient-to-br from-green-950 via-green-800 to-slate-950',
    },
    {
      id: 'lime',
      label: 'Lime Olive',
      swatchClass: 'bg-lime-500',
      bgClass: 'bg-gradient-to-br from-lime-950 via-lime-900 to-slate-950',
    },
    {
      id: 'indigo',
      label: 'Cobalt Indigo',
      swatchClass: 'bg-indigo-500',
      bgClass: 'bg-gradient-to-br from-indigo-950 via-indigo-800 to-slate-950',
    },
    {
      id: 'violet',
      label: 'Deep Violet',
      swatchClass: 'bg-violet-500',
      bgClass: 'bg-gradient-to-br from-violet-950 via-violet-800 to-slate-950',
    },
    {
      id: 'purple',
      label: 'Royal Purple',
      swatchClass: 'bg-purple-500',
      bgClass: 'bg-gradient-to-br from-purple-950 via-purple-800 to-slate-950',
    },
    {
      id: 'fuchsia',
      label: 'Magenta Fuchsia',
      swatchClass: 'bg-fuchsia-500',
      bgClass: 'bg-gradient-to-br from-fuchsia-950 via-fuchsia-900 to-slate-950',
    },
    {
      id: 'rose',
      label: 'Crimson Rose',
      swatchClass: 'bg-rose-500',
      bgClass: 'bg-gradient-to-br from-rose-950 via-rose-800 to-slate-950',
    },
    {
      id: 'red',
      label: 'Cardinal Red',
      swatchClass: 'bg-red-600',
      bgClass: 'bg-gradient-to-br from-red-950 via-red-800 to-slate-950',
    },
    {
      id: 'orange',
      label: 'Burnt Orange',
      swatchClass: 'bg-orange-500',
      bgClass: 'bg-gradient-to-br from-orange-950 via-orange-800 to-slate-950',
    },
    {
      id: 'amber',
      label: 'Gold Amber',
      swatchClass: 'bg-amber-500',
      bgClass: 'bg-gradient-to-br from-amber-950 via-amber-800 to-slate-950',
    },
    {
      id: 'slate',
      label: 'Charcoal Slate',
      swatchClass: 'bg-slate-500',
      bgClass: 'bg-gradient-to-br from-slate-950 via-slate-800 to-zinc-950',
    },
  ] as const;

  const [displayTheme, setDisplayTheme] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('lgplast_display_theme');
      if (saved && DISPLAY_THEMES.some((t) => t.id === saved)) return saved;
    } catch {}
    return 'royal';
  });

  // Always-Live Screen Wake Lock & Heartbeat state
  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('lgplast_keep_awake') === '1';
    } catch {
      return false;
    }
  });
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [lastLiveHeartbeat, setLastLiveHeartbeat] = useState<string>(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );

  const handleSelectDisplayTheme = (theme: string) => {
    setDisplayTheme(theme);
    try {
      localStorage.setItem('lgplast_display_theme', theme);
    } catch {}
  };

  const activeDisplayTheme =
    DISPLAY_THEMES.find((t) => t.id === displayTheme) || DISPLAY_THEMES[0];

  const directAppUrl =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://ais-pre-4lub2q7zy24orxc7ww4y2p-197466423672.europe-west2.run.app';

  // Refresh machines and local entries
  const refreshLocalState = () => {
    setMachines(getActiveMachines());
    setEntries(getStoredEntries());
    setPendingSyncCount(getPendingSyncQueue().length);
    setSyncErrorMsg(getLastSyncError());
  };

  // 1. Auth Initialization & Listener
  useEffect(() => {
    testConnection();

    const session = getActiveSessionUser();
    if (session) {
      setUser(session);
      const namePart = session.displayName || session.email.split('@')[0].toUpperCase();
      setCurrentReporter(namePart);
      setCurrentReporterName(namePart);
      ensureFirebaseAuth().catch(() => {});
    }

    const unsubAuth = onAuthStateChanged(auth, (currentUser) => {
      const localSession = getActiveSessionUser();
      if (currentUser) {
        const resolvedUser = localSession
          ? {
              uid: currentUser.uid,
              email: localSession.email || currentUser.email,
              displayName: localSession.displayName || currentUser.displayName,
              role: localSession.role,
            }
          : currentUser;
        setUser(resolvedUser);
        setAuthLoading(false);
        const namePart =
          resolvedUser.displayName || resolvedUser.email?.split('@')[0].toUpperCase() || 'OPERATOR';
        setCurrentReporter(namePart);
        setCurrentReporterName(namePart);
      } else if (localSession) {
        setUser(localSession);
        const namePart = localSession.displayName || localSession.email.split('@')[0].toUpperCase();
        setCurrentReporter(namePart);
        setCurrentReporterName(namePart);
        setAuthLoading(false);
      } else {
        setUser(null);
        setAuthLoading(false);
      }
    });

    return () => {
      unsubAuth();
    };
  }, []);

  // 2. Real-time Firestore Subscriptions (Entries, Machinery, Plant Users RBAC, Dispatch)
  useEffect(() => {
    if (!user) return;

    const unsubEntries = subscribeFirebaseEntries(
      (newEntries) => {
        setEntries(newEntries);
        setPendingSyncCount(getPendingSyncQueue().length);
        setSyncErrorMsg(getLastSyncError());
      },
      (status, msg) => {
        setSyncStatus(status);
        if (msg) setSyncStatusMsg(msg);
        setPendingSyncCount(getPendingSyncQueue().length);
        setSyncErrorMsg(status === 'error' ? msg || getLastSyncError() : getLastSyncError());
      }
    );

    const unsubMachinery = subscribeMachineryConfig((newMachines) => {
      setMachines(newMachines);
    });

    const unsubUsers = subscribePlantUsers((usersList) => {
      setPlantUsers(usersList);
    });

    const unsubDispatch = subscribeDispatchEntries((dispatches) => {
      setDispatchEntries(dispatches);
    });

    const unsubAttendance = subscribeAttendanceBatches((batches) => {
      setAttendanceBatch(batches);
    });

    const unsubSopProd = subscribeSopProduction((rows) => {
      setSopProductionLogs(rows);
    });
    const unsubSopQc = subscribeSopQc((rows) => {
      setSopQcChecks(rows);
    });
    const unsubSopScrap = subscribeSopScrap((rows) => {
      setSopScrapPipeline(rows);
    });
    const unsubSopMixing = subscribeSopMixing((rows) => {
      setSopMixingReports(rows);
    });
    const unsubSopHandovers = subscribeSopHandovers((rows) => {
      setSopHandovers(rows);
    });
    const unsubHistBg = subscribeUploadedBackgroundDispatches((rows) => {
      setUploadedBackgroundDispatches(rows);
    });
    const unsubPlans = subscribeProductionPlans((rows) => {
      setMonthlyPlans(rows);
    });
    const unsubTank = subscribeDieselTank((t) => {
      setDieselTank(t);
    });
    const unsubDieselReqs = subscribeDieselRequests((reqs) => {
      setDieselRequests(reqs);
    });
    const unsubDieselGrns = subscribeDieselGrns((grns) => {
      setDieselGrns(grns);
    });

    const pendingTimer = setInterval(() => {
      setPendingSyncCount(getPendingSyncQueue().length);
      const err = getLastSyncError();
      setSyncErrorMsg(err);
      if (!err) {
        setSyncStatus((prev) => (prev === 'error' ? 'synced' : prev));
      }
    }, 2500);

    // 24/7 Always-Live Keep-Alive Heartbeat & Auto-Recovery (Visibility, Online, Periodic)
    const runLiveKeepAlive = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      try {
        await ensureFirebaseAuth();
        await Promise.all([
          flushPendingSyncQueue().catch(() => 0),
          flushPendingDispatches().catch(() => 0),
          flushPendingAttendanceBatches().catch(() => 0),
          flushAllPendingSopData().catch(() => 0),
          flushPendingUploadedBackgroundDispatches().catch(() => 0),
          flushPendingProductionPlans().catch(() => 0),
          flushPendingDieselData().catch(() => 0),
        ]);
        const [
          updated,
          updatedDispatches,
          updatedSopProd,
          updatedSopQc,
          updatedSopScrap,
          updatedSopMixing,
          updatedSopHandovers,
          updatedHistBg,
          updatedPlans,
          updatedTank,
          updatedDieselReqs,
          updatedDieselGrns,
        ] = await Promise.all([
          pollFirebaseEntries(),
          pollDispatchEntries().catch(() => null),
          pollSopProduction().catch(() => null),
          pollSopQc().catch(() => null),
          pollSopScrap().catch(() => null),
          pollSopMixing().catch(() => null),
          pollSopHandovers().catch(() => null),
          pollUploadedBackgroundDispatches().catch(() => null),
          pollProductionPlans().catch(() => null),
          pollDieselTank().catch(() => null),
          pollDieselRequests().catch(() => null),
          pollDieselGrns().catch(() => null),
        ]);
        setEntries(updated);
        if (updatedDispatches) setDispatchEntries(updatedDispatches);
        if (updatedSopProd) setSopProductionLogs(updatedSopProd);
        if (updatedSopQc) setSopQcChecks(updatedSopQc);
        if (updatedSopScrap) setSopScrapPipeline(updatedSopScrap);
        if (updatedSopMixing) setSopMixingReports(updatedSopMixing);
        if (updatedSopHandovers) setSopHandovers(updatedSopHandovers);
        if (updatedHistBg) setUploadedBackgroundDispatches(updatedHistBg);
        if (updatedPlans) setMonthlyPlans(updatedPlans);
        if (updatedTank) setDieselTank(updatedTank);
        if (updatedDieselReqs) setDieselRequests(updatedDieselReqs);
        if (updatedDieselGrns) setDieselGrns(updatedDieselGrns);
        setPendingSyncCount(getPendingSyncQueue().length);
        setLastLiveHeartbeat(
          new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        );
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then((regs) => {
            regs.forEach((r) => r.update().catch(() => {}));
          }).catch(() => {});
        }
      } catch {}
    };

    const handleVisibilityOrOnline = () => {
      if (document.visibilityState === 'visible' || navigator.onLine) {
        runLiveKeepAlive();
      }
    };

    const keepAliveTimer = setInterval(runLiveKeepAlive, 45000);
    document.addEventListener('visibilitychange', handleVisibilityOrOnline);
    window.addEventListener('online', handleVisibilityOrOnline);
    window.addEventListener('focus', handleVisibilityOrOnline);

    return () => {
      unsubEntries();
      unsubMachinery();
      unsubUsers();
      unsubDispatch();
      unsubAttendance();
      unsubSopProd();
      unsubSopQc();
      unsubSopScrap();
      unsubSopMixing();
      unsubSopHandovers();
      unsubHistBg();
      unsubPlans();
      unsubTank();
      unsubDieselReqs();
      unsubDieselGrns();
      clearInterval(pendingTimer);
      clearInterval(keepAliveTimer);
      document.removeEventListener('visibilitychange', handleVisibilityOrOnline);
      window.removeEventListener('online', handleVisibilityOrOnline);
      window.removeEventListener('focus', handleVisibilityOrOnline);
    };
  }, [user?.uid, user?.email]);

  // Screen Wake Lock Manager (Keeps shop-floor tablets/phones awake & live when toggled)
  useEffect(() => {
    let sentinel: { release?: () => Promise<void> } | null = null;
    let cancelled = false;

    const requestWakeLock = async () => {
      if (!keepAwakeEnabled || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
        setWakeLockActive(false);
        return;
      }
      try {
        const wl = await (navigator as unknown as {
          wakeLock: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
        }).wakeLock.request('screen');
        if (!cancelled) {
          sentinel = wl;
          setWakeLockActive(true);
        } else {
          wl.release().catch(() => {});
        }
      } catch {
        if (!cancelled) setWakeLockActive(false);
      }
    };

    requestWakeLock();

    const handleVis = () => {
      if (document.visibilityState === 'visible' && keepAwakeEnabled) {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVis);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVis);
      if (sentinel && sentinel.release) {
        sentinel.release().catch(() => {});
      }
      setWakeLockActive(false);
    };
  }, [keepAwakeEnabled]);

  // 3. Resolve Effective Confidentiality Permissions Live
  const matchedUserRecord = useMemo(() => {
    if (!user?.email) return undefined;
    return plantUsers.find(
      (u) => u.email.trim().toLowerCase() === user.email!.trim().toLowerCase()
    );
  }, [plantUsers, user?.email]);

  const isRestrictedSIC = isRestrictedShiftInChargeAccount(
    user?.email,
    matchedUserRecord?.displayName || user?.displayName
  );

  const isAdmin =
    !isRestrictedSIC &&
    (isUserAdmin(user?.email) ||
      (matchedUserRecord?.status !== 'suspended' &&
        (matchedUserRecord?.role === 'Plant Administrator' ||
          matchedUserRecord?.role === 'Production HOD' ||
          user?.role === 'Production HOD')));

  const effectivePermissions = useMemo(() => {
    return resolveUserPermissions(
      user?.email,
      matchedUserRecord?.role || user?.role,
      plantUsers,
      matchedUserRecord?.displayName || user?.displayName
    );
  }, [
    user?.email,
    user?.displayName,
    matchedUserRecord?.displayName,
    matchedUserRecord?.role,
    user?.role,
    plantUsers,
  ]);

  const effectiveRoleLabel = isRestrictedSIC
    ? 'Shift In Charge'
    : matchedUserRecord?.role === 'Production HOD' || user?.role === 'Production HOD'
    ? 'Production HOD (Admin)'
    : isAdmin
    ? 'Plant Administrator'
    : matchedUserRecord?.role || user?.role || 'Operator';

  // Count of pending dispatches actionable by current user
  const actionableDispatchCount = useMemo(() => {
    let count = 0;
    if (effectivePermissions.dispatchWHConfirm) {
      count += dispatchEntries.filter((e) => e.status === 'PENDING_WH').length;
    }
    if (effectivePermissions.dispatchHODConfirm) {
      count += dispatchEntries.filter((e) => e.status === 'PENDING_HOD').length;
    }
    return count;
  }, [dispatchEntries, effectivePermissions]);

  const hasActiveDispatchPopup = useMemo(() => {
    const whPending = effectivePermissions.dispatchWHConfirm
      ? dispatchEntries.some(
          (e) =>
            e.status === 'PENDING_WH' && !dismissedPopupKeys.includes(`${e.id}_PENDING_WH`)
        )
      : false;
    const hodPending = effectivePermissions.dispatchHODConfirm
      ? dispatchEntries.some(
          (e) =>
            e.status === 'PENDING_HOD' && !dismissedPopupKeys.includes(`${e.id}_PENDING_HOD`)
        )
      : false;
    return whPending || hodPending;
  }, [dispatchEntries, effectivePermissions, dismissedPopupKeys]);

  // Pending counts for spread SOP APKs
  const sopRecyclingBadgeCount = useMemo(() => {
    if (!isAdmin && !effectivePermissions.sopRecyclingConfirm) return 0;
    return sopScrapPipeline.filter((s) => s.status === 'SENT_TO_RECYCLING').length;
  }, [sopScrapPipeline, effectivePermissions.sopRecyclingConfirm, isAdmin]);

  const sopMixingBadgeCount = useMemo(() => {
    let count = 0;
    if (effectivePermissions.sopMixingAccess) {
      count += sopScrapPipeline.filter((s) => s.status === 'PROCESSED_FOR_MIXER').length;
    }
    if (isAdmin || effectivePermissions.dispatchHODConfirm) {
      count += sopMixingReports.filter((m) => m.status === 'PENDING_HOD').length;
    }
    return count;
  }, [sopScrapPipeline, sopMixingReports, effectivePermissions, isAdmin]);

  const isShiftInChargeWeightCheckUser =
    isRestrictedSIC ||
    matchedUserRecord?.role === 'Shift In Charge' ||
    user?.role === 'Shift In Charge' ||
    (effectivePermissions.dispatchShiftEntry && effectivePermissions.logDowntime);

  const hasActiveSopPopup = useMemo(() => {
    const recycleAlert = effectivePermissions.sopRecyclingConfirm
      ? sopScrapPipeline.some(
          (s) =>
            s.status === 'SENT_TO_RECYCLING' &&
            !dismissedPopupKeys.includes(`SOP_${s.id}_SENT_TO_RECYCLING`)
        )
      : false;
    const mixerAlert = effectivePermissions.sopMixingAccess
      ? sopScrapPipeline.some(
          (s) =>
            s.status === 'PROCESSED_FOR_MIXER' &&
            !dismissedPopupKeys.includes(`SOP_${s.id}_PROCESSED_FOR_MIXER`)
        )
      : false;
    const hodMixAlert =
      isAdmin || effectivePermissions.dispatchHODConfirm
        ? sopMixingReports.some(
            (m) =>
              m.status === 'PENDING_HOD' &&
              !dismissedPopupKeys.includes(`SOP_MIX_${m.id}_PENDING_HOD`)
          )
        : false;
    return recycleAlert || mixerAlert || hodMixAlert;
  }, [sopScrapPipeline, sopMixingReports, effectivePermissions, dismissedPopupKeys, isAdmin]);

  const hasDispatchAccess =
    effectivePermissions.dispatchShiftEntry ||
    effectivePermissions.dispatchWHConfirm ||
    effectivePermissions.dispatchHODConfirm ||
    effectivePermissions.exportDispatchExcel;

  const hasDieselAccess =
    isAdmin ||
    Boolean(effectivePermissions.dieselFuelRequest) ||
    Boolean(effectivePermissions.dieselHODApprove) ||
    Boolean(effectivePermissions.dieselGRN) ||
    Boolean(effectivePermissions.dieselExportExcel);

  const dieselBadgeCount = useMemo(() => {
    let count = 0;
    if (isAdmin || effectivePermissions.dieselHODApprove) {
      count += dieselRequests.filter((r) => r.status === 'PENDING_HOD').length;
    }
    if (effectivePermissions.dieselFuelRequest) {
      count += dieselRequests.filter(
        (r) => r.status === 'APPROVED_FOR_DISPENSE' && r.pdfUnlockedDispense
      ).length;
    }
    return count;
  }, [dieselRequests, effectivePermissions, isAdmin]);

  const hasActiveDieselPopup = useMemo(() => {
    const hodAlert =
      isAdmin || effectivePermissions.dieselHODApprove
        ? dieselRequests.some(
            (r) =>
              r.status === 'PENDING_HOD' &&
              !dismissedPopupKeys.includes(`DIESEL_${r.id}_PENDING_HOD`)
          )
        : false;
    const driverAlert =
      isAdmin || effectivePermissions.dieselFuelRequest
        ? dieselRequests.some(
            (r) =>
              r.status === 'APPROVED_FOR_DISPENSE' &&
              r.pdfUnlockedDispense &&
              !dismissedPopupKeys.includes(`DIESEL_${r.id}_APPROVED_FOR_DISPENSE`)
          )
        : false;
    return hodAlert || driverAlert;
  }, [dieselRequests, effectivePermissions, dismissedPopupKeys, isAdmin]);

  // 4. Phone OS Push Notification Engine + Deep-Link Tap Handling
  useEffect(() => {
    if (!user) return;

    const navigateFromPushPayload = (payload: Partial<OsPushNavigationPayload> | null | undefined) => {
      if (!payload) return;
      const validTabs: DowntimeTab[] = [
        'status',
        'log',
        'daily',
        'dispatch',
        'prod_planning',
        'diesel',
        'sop_overview',
        'sop_production',
        'sop_qc',
        'sop_scrap',
        'sop_recycling',
        'sop_mixing',
        'sop_handover',
        'attendance',
        'prod_report',
        'rep',
        'data',
      ];
      if (payload.targetTab && validTabs.includes(payload.targetTab as DowntimeTab)) {
        setActiveDowntimeTab(payload.targetTab as DowntimeTab);
      }
      if (payload.dispatchStage) {
        setRequestedDispatchStage(payload.dispatchStage);
      }
      if (payload.dieselSubTab) {
        setRequestedDieselSubTab(payload.dieselSubTab);
      }
      if (payload.openWeightCheck) {
        const now = new Date();
        const active = getActiveWeightOutputSlot(now);
        if (active) {
          setManualWeightCheckSlot(active);
        }
      }
    };

    // Check URL query params when opened fresh from OS notification click
    try {
      const params = new URLSearchParams(window.location.search);
      const openTab = params.get('openTab');
      if (openTab) {
        navigateFromPushPayload({
          targetTab: openTab,
          dispatchStage: (params.get('dispatchStage') as DispatchSubStage) || undefined,
          dieselSubTab: (params.get('dieselSubTab') as DieselSubTab) || undefined,
          openWeightCheck: params.get('weightCheck') === '1',
        });
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch {}

    const handleWindowPushNav = (ev: Event) => {
      const customEv = ev as CustomEvent<OsPushNavigationPayload>;
      navigateFromPushPayload(customEv.detail);
    };

    const handleSwMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'LGPLAST_NOTIFICATION_CLICK') {
        navigateFromPushPayload(event.data.payload);
      }
    };

    window.addEventListener('lgplast-nav-from-push', handleWindowPushNav);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }

    if (getPushPermissionStatus() === 'granted') {
      ensurePushServiceWorkerRegistration().catch(() => {});
    }

    const syncPermAndClock = () => {
      setPushPermission(getPushPermissionStatus());
      setPushClockTick(Date.now());
    };
    const timer = setInterval(syncPermAndClock, 15000);
    window.addEventListener('focus', syncPermAndClock);
    document.addEventListener('visibilitychange', syncPermAndClock);

    return () => {
      window.removeEventListener('lgplast-nav-from-push', handleWindowPushNav);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
      clearInterval(timer);
      window.removeEventListener('focus', syncPermAndClock);
      document.removeEventListener('visibilitychange', syncPermAndClock);
    };
  }, [user?.uid, user?.email]);

  useEffect(() => {
    if (!user?.email) return;
    evaluateAndDispatchPushNotifications({
      userEmail: user.email,
      isAdmin,
      isOnline,
      permissions: effectivePermissions,
      isShiftInChargeWeightCheckUser,
      dispatchEntries,
      sopScrapPipeline,
      sopMixingReports,
      dieselRequests,
      entries,
      now: new Date(pushClockTick),
    }).catch(() => {});
  }, [
    user?.email,
    isAdmin,
    isOnline,
    effectivePermissions,
    isShiftInChargeWeightCheckUser,
    dispatchEntries,
    sopScrapPipeline,
    sopMixingReports,
    dieselRequests,
    entries,
    pushClockTick,
    pushPermission,
  ]);

  const handleEnablePhonePush = async () => {
    const res = await requestPhonePushPermission();
    setPushPermission(res);
    if (res === 'granted') {
      setPushBannerDismissed(true);
      setPushTestStatus('Phone Alerts Active');
      setTimeout(() => setPushTestStatus(null), 3500);
    } else if (res === 'denied') {
      setPushTestStatus('Blocked in Browser Settings');
      setTimeout(() => setPushTestStatus(null), 4000);
    }
  };

  const handleTogglePushSound = () => {
    const next = !pushSoundOn;
    setPushSoundOn(next);
    setPushSoundEnabled(next);
  };

  const handleTestPhonePush = async () => {
    if (pushPermission !== 'granted') {
      await handleEnablePhonePush();
      return;
    }
    const ok = await sendTestPhonePushNotification();
    setPushTestStatus(ok ? 'Test Alert Sent!' : 'Check Browser Permission');
    setTimeout(() => setPushTestStatus(null), 3000);
  };

  // Compute allowed sidebar navigation tabs strictly from effectivePermissions & Admin-only report policy
  const allowedTabs = useMemo<DowntimeTab[]>(() => {
    const tabs: DowntimeTab[] = [];
    if (effectivePermissions.viewMachineStatus) tabs.push('status');
    if (effectivePermissions.logDowntime) tabs.push('log');
    if (effectivePermissions.viewDailyHours) tabs.push('daily');
    if (hasDispatchAccess) tabs.push('dispatch');
    if (
      isAdmin ||
      effectivePermissions.productionPlanningAccess ||
      effectivePermissions.dispatchShiftEntry
    ) {
      tabs.push('prod_planning');
    }
    if (hasDieselAccess) tabs.push('diesel');
    if (isAdmin || effectivePermissions.sopFloorAccess) {
      tabs.push('sop_overview', 'sop_production', 'sop_qc');
    }
    if (isAdmin || effectivePermissions.sopScrapSend || effectivePermissions.sopFloorAccess) {
      tabs.push('sop_scrap');
    }
    if (isAdmin || effectivePermissions.sopRecyclingConfirm) {
      tabs.push('sop_recycling');
    }
    if (isAdmin || effectivePermissions.sopMixingAccess || effectivePermissions.dispatchHODConfirm) {
      tabs.push('sop_mixing');
    }
    if (isAdmin || effectivePermissions.dispatchShiftEntry || effectivePermissions.sopFloorAccess) {
      tabs.push('sop_handover');
    }
    if (effectivePermissions.attendanceLogger || isAdmin) tabs.push('attendance');
    if (isAdmin || effectivePermissions.productionReportAccess) tabs.push('prod_report');
    if (isAdmin) tabs.push('rep');
    if (isAdmin || effectivePermissions.manageMachinesAndSync) tabs.push('data');
    return tabs;
  }, [effectivePermissions, hasDispatchAccess, hasDieselAccess, isAdmin]);

  // Automatically switch active view to the first permitted tab whenever permissions change
  useEffect(() => {
    if (allowedTabs.length > 0 && !allowedTabs.includes(activeDowntimeTab)) {
      setActiveDowntimeTab(allowedTabs[0]);
    }
  }, [allowedTabs, activeDowntimeTab]);

  // Handlers for Downtime Entries
  const handleSaveEntry = async (entry: DowntimeEntry) => {
    const current = getStoredEntries();
    const existingIdx = current.findIndex((e) => e.id === entry.id);
    let updated: DowntimeEntry[];
    if (existingIdx >= 0) {
      updated = [...current];
      updated[existingIdx] = entry;
    } else {
      updated = [entry, ...current];
    }
    saveStoredEntries(updated);
    setEntries(updated);
    setPendingSyncCount(getPendingSyncQueue().length);

    const res = await syncEntryToFirebase(entry);
    setEntries(getStoredEntries());
    setPendingSyncCount(getPendingSyncQueue().length);
    setSyncErrorMsg(res.ok ? null : res.error || getLastSyncError());
  };

  const handleSaveEntriesBatch = async (newEntries: DowntimeEntry[]) => {
    if (!newEntries.length) return;
    const current = getStoredEntries();
    const incomingIds = new Set(newEntries.map((e) => e.id));
    const filtered = current.filter((e) => !incomingIds.has(e.id));
    const updated = [...newEntries, ...filtered];
    saveStoredEntries(updated);
    setEntries(updated);
    setPendingSyncCount(getPendingSyncQueue().length);

    const results = await Promise.all(newEntries.map((entry) => syncEntryToFirebase(entry)));
    setEntries(getStoredEntries());
    setPendingSyncCount(getPendingSyncQueue().length);
    const failed = results.find((r) => !r.ok);
    setSyncErrorMsg(failed ? failed.error || getLastSyncError() : null);
  };

  const handleDeleteEntry = async (_id: string) => {
    // Posted entries are permanent audit records and cannot be deleted by anyone.
    return;
  };

  const handleRestoreRunning = async (entryId: string, _machineName: string) => {
    if (!effectivePermissions.logDowntime && !isAdmin) return;
    const current = getStoredEntries();
    const existing = current.find((e) => e.id === entryId);
    if (!existing) return;

    existing.end = dtl(new Date());
    existing.upd = Date.now();
    saveStoredEntries(current);
    setEntries([...current]);
    setPendingSyncCount(getPendingSyncQueue().length);

    const res = await syncEntryToFirebase(existing);
    setEntries(getStoredEntries());
    setPendingSyncCount(getPendingSyncQueue().length);
    setSyncErrorMsg(res.ok ? null : res.error || getLastSyncError());
  };

  const handleLogStoppageFromBoard = (machineName: string) => {
    if (!effectivePermissions.logDowntime && !isAdmin) return;
    setPrefilledMachine(machineName);
    setActiveDowntimeTab('log');
  };

  const handleReporterChange = (name: string) => {
    setCurrentReporter(name);
    setCurrentReporterName(name);
  };

  const handleCopyDirectLink = () => {
    navigator.clipboard.writeText(directAppUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleLogout = async () => {
    updateAppBadgeCount(0);
    await logoutUser();
    setUser(null);
  };

  const handleManualSyncNow = async () => {
    setIsManualSyncing(true);
    try {
      await Promise.all([
        flushPendingSyncQueue(),
        flushPendingDispatches().catch(() => 0),
        flushPendingAttendanceBatches().catch(() => 0),
        flushAllPendingSopData().catch(() => 0),
        flushPendingUploadedBackgroundDispatches().catch(() => 0),
        flushPendingProductionPlans().catch(() => 0),
        flushPendingDieselData().catch(() => 0),
      ]);
      const [
        updated,
        updatedDispatches,
        updatedSopProd,
        updatedSopQc,
        updatedSopScrap,
        updatedSopMixing,
        updatedSopHandovers,
        updatedHistBg,
        updatedPlans,
        updatedTank,
        updatedDieselReqs,
        updatedDieselGrns,
      ] = await Promise.all([
        pollFirebaseEntries(),
        pollDispatchEntries().catch(() => dispatchEntries),
        pollSopProduction().catch(() => sopProductionLogs),
        pollSopQc().catch(() => sopQcChecks),
        pollSopScrap().catch(() => sopScrapPipeline),
        pollSopMixing().catch(() => sopMixingReports),
        pollSopHandovers().catch(() => sopHandovers),
        pollUploadedBackgroundDispatches().catch(() => uploadedBackgroundDispatches),
        pollProductionPlans().catch(() => monthlyPlans),
        pollDieselTank().catch(() => dieselTank),
        pollDieselRequests().catch(() => dieselRequests),
        pollDieselGrns().catch(() => dieselGrns),
      ]);
      setEntries(updated);
      setDispatchEntries(updatedDispatches);
      setSopProductionLogs(updatedSopProd);
      setSopQcChecks(updatedSopQc);
      setSopScrapPipeline(updatedSopScrap);
      setSopMixingReports(updatedSopMixing);
      setSopHandovers(updatedSopHandovers);
      setUploadedBackgroundDispatches(updatedHistBg);
      setMonthlyPlans(updatedPlans);
      setDieselTank(updatedTank);
      setDieselRequests(updatedDieselReqs);
      setDieselGrns(updatedDieselGrns);
      setPendingSyncCount(getPendingSyncQueue().length);
      const err = getLastSyncError();
      setSyncErrorMsg(err);
      if (!err) {
        setSyncStatus('synced');
        setSyncStatusMsg(`Live synced with Firebase (${updated.length} records)`);
      }
    } finally {
      setIsManualSyncing(false);
    }
  };

  const handleSelectNavTab = (tab: DowntimeTab) => {
    setActiveDowntimeTab(tab);
    setMobileMenuOpen(false);
  };

  // 1. Initial Auth Loading Screen
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center text-slate-400 gap-3 font-sans">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse">
          <ShieldCheck className="h-7 w-7" />
        </div>
        <div className="text-xs font-semibold tracking-wider text-slate-300">
          INITIALIZING PLANTOPS SYSTEM...
        </div>
      </div>
    );
  }

  // 2. MANDATORY LOGIN GATE
  if (!user) {
    return (
      <LoginGate
        onLoginSuccess={() => {
          const session = getActiveSessionUser();
          if (session) {
            setUser(session);
            const namePart = session.displayName || session.email.split('@')[0].toUpperCase();
            setCurrentReporter(namePart);
            setCurrentReporterName(namePart);
          }
          setAuthLoading(false);
        }}
      />
    );
  }

  type NavItemConfig = {
    id: DowntimeTab;
    group: '1. Live Floor Operations' | '2. Daily SOP Floor APKs' | '3. Reports, Attendance & Admin';
    label: string;
    subtitle: string;
    icon: React.ReactNode;
    badge?: number;
    adminTag?: boolean;
  };

  // Arranged strictly by floor operational importance
  const allNavItems: NavItemConfig[] = [
    // Priority 1: Live Floor Operations
    {
      id: 'status',
      group: '1. Live Floor Operations',
      label: 'Machine Status',
      subtitle: 'Live Floor Board & Weight',
      icon: <Activity className="h-4 w-4" />,
    },
    {
      id: 'log',
      group: '1. Live Floor Operations',
      label: 'Log Downtime',
      subtitle: 'Single & All Machines',
      icon: <Plus className="h-4 w-4" />,
    },
    {
      id: 'dispatch',
      group: '1. Live Floor Operations',
      label: 'Dispatch System',
      subtitle: 'Shift → WH → HOD',
      icon: <Truck className="h-4 w-4" />,
      badge: actionableDispatchCount,
    },
    {
      id: 'prod_planning',
      group: '1. Live Floor Operations',
      label: 'Production Planning',
      subtitle: 'Monthly Plan & Uploads',
      icon: <ClipboardList className="h-4 w-4" />,
    },
    {
      id: 'diesel',
      group: '1. Live Floor Operations',
      label: 'Diesel Bowser & GRN',
      subtitle: 'Fuel Issue · Meter · Tank',
      icon: <Fuel className="h-4 w-4" />,
      badge: dieselBadgeCount,
    },
    // Priority 2: Daily SOP Floor APKs
    {
      id: 'sop_production',
      group: '2. Daily SOP Floor APKs',
      label: 'Production Logger',
      subtitle: 'Job Cards & WA Parser',
      icon: <ClipboardCheck className="h-4 w-4" />,
    },
    {
      id: 'sop_qc',
      group: '2. Daily SOP Floor APKs',
      label: 'QC Check APK',
      subtitle: 'Inspections & WA Parser',
      icon: <Sparkles className="h-4 w-4" />,
    },
    {
      id: 'sop_scrap',
      group: '2. Daily SOP Floor APKs',
      label: 'Scrap Send APK',
      subtitle: 'Operator → Recycling',
      icon: <Send className="h-4 w-4" />,
    },
    {
      id: 'sop_recycling',
      group: '2. Daily SOP Floor APKs',
      label: 'Recycling Team APK',
      subtitle: 'Process → Mixer Alert',
      icon: <Recycle className="h-4 w-4" />,
      badge: sopRecyclingBadgeCount,
    },
    {
      id: 'sop_mixing',
      group: '2. Daily SOP Floor APKs',
      label: 'Mixing & WH Stock',
      subtitle: 'Batches · Sweeping · HOD',
      icon: <FlaskConical className="h-4 w-4" />,
      badge: sopMixingBadgeCount,
    },
    {
      id: 'sop_handover',
      group: '2. Daily SOP Floor APKs',
      label: 'Shift Handover APK',
      subtitle: 'Supervisor Floor Log',
      icon: <Layers className="h-4 w-4" />,
    },
    {
      id: 'sop_overview',
      group: '2. Daily SOP Floor APKs',
      label: 'SOP Floor Overview',
      subtitle: 'KPIs & Downtime Pareto',
      icon: <LayoutDashboard className="h-4 w-4" />,
    },
    // Priority 3: Reports, Attendance & Admin
    {
      id: 'daily',
      group: '3. Reports, Attendance & Admin',
      label: 'Daily Hours',
      subtitle: 'Shift Availability',
      icon: <Calendar className="h-4 w-4" />,
    },
    {
      id: 'attendance',
      group: '3. Reports, Attendance & Admin',
      label: 'Attendance Logger',
      subtitle: 'WhatsApp Roll & Excel',
      icon: <Users className="h-4 w-4" />,
    },
    {
      id: 'prod_report',
      group: '3. Reports, Attendance & Admin',
      label: 'Production Report',
      subtitle: 'SUMIF · Shift · QC · Hrs',
      icon: <BarChart3 className="h-4 w-4" />,
      adminTag: isAdmin,
    },
    {
      id: 'rep',
      group: '3. Reports, Attendance & Admin',
      label: 'Downtime Excel',
      subtitle: 'Confidential Report',
      icon: <FileSpreadsheet className="h-4 w-4" />,
    },
    {
      id: 'data',
      group: '3. Reports, Attendance & Admin',
      label: isAdmin ? 'Admin Access & Sync' : 'Machines & Sync',
      subtitle: isAdmin ? 'Roles & Confidentiality' : 'Cloud Sync & Backup',
      icon: <RefreshCw className="h-4 w-4" />,
      adminTag: isAdmin,
    },
  ];

  const navItems = allNavItems.filter((item) => allowedTabs.includes(item.id));
  const navGroups: Array<NavItemConfig['group']> = [
    '1. Live Floor Operations',
    '2. Daily SOP Floor APKs',
    '3. Reports, Attendance & Admin',
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Compact Top Utility Header */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 backdrop-blur-md">
        <div className="flex items-center justify-between px-3 py-2 sm:px-5">
          <div className="flex items-center gap-2.5">
            {/* Mobile Left Drawer Toggle */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="md:hidden rounded-xl border border-slate-700 bg-slate-900 p-2 text-slate-200 hover:bg-slate-800"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>

            <LgplastLogo size="md" showSubtitle={false} />

            <div className="border-l border-slate-800 pl-2.5">
              <div className="flex items-center gap-1.5">
                <span className="text-sm sm:text-base font-black tracking-tight text-white">
                  LG PLAST
                </span>
                <span className="hidden sm:inline rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-extrabold text-sky-300 border border-sky-400/30">
                  LIVE APK
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className="flex items-center gap-1 font-medium">
                  {isOnline ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                      Always Live · {lastLiveHeartbeat}
                    </span>
                  ) : (
                    <span className="text-amber-400 flex items-center gap-1">
                      <CloudOff className="h-3 w-3" /> Offline Cache
                    </span>
                  )}
                </span>

                {syncErrorMsg || syncStatus === 'error' ? (
                  <button
                    onClick={handleManualSyncNow}
                    className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 transition"
                    title={syncErrorMsg || syncStatusMsg}
                  >
                    ⚠ Retry Cloud Sync
                  </button>
                ) : pendingSyncCount > 0 ? (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-500/40 animate-pulse">
                    ⚡ {pendingSyncCount} Syncing
                  </span>
                ) : (
                  <span className="hidden sm:inline rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/30">
                    ✓ Live Synced
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {actionableDispatchCount > 0 && hasDispatchAccess && (
              <button
                type="button"
                onClick={() => {
                  setActiveDowntimeTab('dispatch');
                  setRequestedDispatchStage(
                    effectivePermissions.dispatchWHConfirm ? 'wh' : 'hod'
                  );
                }}
                className="flex items-center gap-1.5 rounded-xl border border-amber-500/50 bg-amber-500/15 px-2.5 py-1.5 text-xs font-black text-amber-300 animate-pulse hover:bg-amber-500/25 transition"
              >
                <Bell className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Pending Dispatch:</span>
                <span>{actionableDispatchCount}</span>
              </button>
            )}

            {/* Phone OS Push Notification Controls */}
            {pushPermission !== 'unsupported' && (
              <div className="flex items-center gap-1">
                {pushPermission === 'granted' ? (
                  <>
                    <button
                      type="button"
                      onClick={handleTestPhonePush}
                      className="flex items-center gap-1 rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1.5 text-xs font-bold text-emerald-300 transition"
                      title="Phone push notifications active like email alerts — click to send test alert"
                    >
                      <BellRing className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="hidden md:inline">
                        {pushTestStatus || 'Phone Push: ON'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={handleTogglePushSound}
                      className="rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 p-1.5 text-slate-300 transition"
                      title={pushSoundOn ? 'Mute alert chime' : 'Unmute alert chime'}
                    >
                      {pushSoundOn ? (
                        <Volume2 className="h-3.5 w-3.5 text-sky-400" />
                      ) : (
                        <VolumeX className="h-3.5 w-3.5 text-slate-500" />
                      )}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleEnablePhonePush}
                    className={`flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-black transition ${
                      pushPermission === 'denied'
                        ? 'border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
                        : 'border-amber-400/60 bg-amber-500 text-slate-950 hover:bg-amber-400 animate-pulse'
                    }`}
                    title={
                      pushPermission === 'denied'
                        ? 'Notifications blocked in browser settings — allow notifications for this site in Chrome/Safari settings'
                        : 'Enable live OS phone push notifications like email alerts'
                    }
                  >
                    <BellRing className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">
                      {pushTestStatus ||
                        (pushPermission === 'denied' ? 'Push Blocked' : 'Enable Push')}
                    </span>
                  </button>
                )}
              </div>
            )}

            <button
              onClick={handleManualSyncNow}
              disabled={isManualSyncing}
              className="flex items-center gap-1 rounded-xl border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 px-2.5 py-1.5 text-xs font-semibold text-blue-300 transition"
              title="Force immediate cloud sync"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-blue-400 ${isManualSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isManualSyncing ? 'Syncing...' : 'Sync'}</span>
            </button>

            <button
              onClick={handleCopyDirectLink}
              className="flex items-center gap-1 rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 transition"
              title="Copy Direct App Link"
            >
              <Share2 className="h-3.5 w-3.5 text-emerald-400" />
              <span className="hidden lg:inline">{copiedLink ? 'Copied!' : 'Share Link'}</span>
            </button>

            {isInstallable && !isInstalled ? (
              <button
                onClick={() => install()}
                className="flex items-center gap-1 rounded-xl bg-sky-500 hover:bg-sky-400 px-2.5 py-1.5 text-xs font-black text-slate-950 transition shadow"
              >
                <Smartphone className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Install APK</span>
              </button>
            ) : (
              <button
                onClick={() => setIsInstallModalOpen(true)}
                className="hidden sm:flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition"
              >
                <Smartphone className="h-3.5 w-3.5 text-sky-400" />
                <span className="hidden lg:inline">Install APK</span>
              </button>
            )}

            <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold border uppercase ${
                  isAdmin
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                }`}
              >
                {isAdmin ? '★' : user.displayName?.slice(0, 1) || user.email?.slice(0, 1) || 'U'}
              </div>
              <div className="hidden sm:flex flex-col text-left">
                <span className="text-[11px] font-bold text-slate-200 leading-tight truncate max-w-[130px]">
                  {user.displayName || user.email?.split('@')[0]}
                </span>
                <span
                  className={`text-[9px] font-extrabold uppercase leading-none ${
                    isAdmin ? 'text-amber-400' : 'text-emerald-400'
                  }`}
                >
                  {effectiveRoleLabel}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400 transition"
                title="Sign Out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* RESHAPED SPLIT WORKSPACE: Left Section + 0.2cm Vertical Dividing Bar + Right Clicked View */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Mobile Overlay Backdrop */}
        {mobileMenuOpen && (
          <div
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 z-30 bg-slate-950/75 backdrop-blur-xs md:hidden"
          />
        )}

        {/* LEFT NAVIGATION PANEL (Dark Obsidian) */}
        <aside
          className={`${
            mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
          } fixed md:static inset-y-0 left-0 z-30 w-64 md:w-60 shrink-0 bg-[#070b14] flex flex-col justify-between transition-transform duration-200 pt-16 md:pt-4 pb-4 px-3 overflow-y-auto`}
        >
          <div className="space-y-4">
            {/* Official LG PLAST Factory Brand Card */}
            <div className="rounded-xl border border-sky-500/35 bg-slate-900/90 p-2.5 flex items-center justify-center">
              <LgplastLogo size="md" />
            </div>

            {/* Confidentiality Clearance Card */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Access Clearance
                </span>
                <Lock className="h-3 w-3 text-sky-400" />
              </div>
              <div className="text-xs font-black text-white truncate">{effectiveRoleLabel}</div>
              <div className="text-[10px] text-slate-400 truncate">{user.email}</div>
            </div>

            {/* Section Menu Buttons (Arranged by Floor Operational Importance) */}
            <nav className="space-y-3">
              {navGroups.map((groupTitle) => {
                const groupItems = navItems.filter((item) => item.group === groupTitle);
                if (groupItems.length === 0) return null;
                return (
                  <div key={groupTitle} className="space-y-1">
                    <div className="px-2 pt-1 text-[10px] font-black uppercase tracking-wider text-sky-400/80">
                      {groupTitle}
                    </div>
                    {groupItems.map((item) => {
                      const isActive = activeDowntimeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleSelectNavTab(item.id)}
                          className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-left transition ${
                            isActive
                              ? 'bg-gradient-to-r from-[#0284c7] to-[#2e3192] text-white shadow-lg shadow-blue-950/50 border border-sky-400/40'
                              : 'border border-transparent text-slate-300 hover:bg-slate-900 hover:border-slate-800 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                                isActive ? 'bg-white/15 text-white' : 'bg-slate-900 text-slate-400'
                              }`}
                            >
                              {item.icon}
                            </span>
                            <div className="min-w-0">
                              <div className="text-xs font-bold truncate flex items-center gap-1.5">
                                <span>{item.label}</span>
                                {item.adminTag && (
                                  <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[8px] font-black text-amber-300 border border-amber-500/40">
                                    ADMIN
                                  </span>
                                )}
                              </div>
                              <div
                                className={`text-[10px] truncate ${
                                  isActive ? 'text-sky-100' : 'text-slate-500'
                                }`}
                              >
                                {item.subtitle}
                              </div>
                            </div>
                          </div>

                          {typeof item.badge === 'number' && item.badge > 0 && (
                            <span className="shrink-0 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white">
                              {item.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </nav>
          </div>

          <div className="pt-4 mt-4 border-t border-slate-800/80 px-2 text-[10px] text-slate-500 space-y-1">
            <div className="font-semibold text-slate-400">Immutable Record Lock</div>
            <div>All posted Downtime &amp; Dispatch logs are permanent and cannot be deleted.</div>
          </div>
        </aside>

        {/* EXACT 0.2CM VERTICAL DIVIDING BAR (LG PLAST Sky-Blue to Royal-Blue) */}
        <div
          aria-hidden="true"
          className="w-[0.2cm] shrink-0 bg-gradient-to-b from-[#00aeef] via-[#2563eb] to-[#2e3192] border-x border-sky-300/20 shadow-inner"
          title="0.2cm LG PLAST Dashboard Divider"
        />

        {/* RIGHT WIDER DISPLAY INTERFACE (Distinct Colored Corporate Display Surface) */}
        <main
          className={`flex-1 min-w-0 px-3 py-4 sm:px-6 overflow-y-auto transition-colors duration-300 ${activeDisplayTheme.bgClass}`}
        >
          <div className="mx-auto max-w-6xl space-y-4">
            {/* Compact Display Bar: Full-Spectrum Colour Switcher + Always-Live Screen Wake Toggle */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-sky-400/25 bg-slate-950/45 backdrop-blur-sm px-3 py-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2 text-sky-100 font-semibold">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${activeDisplayTheme.swatchClass}`} />
                <span>Display Colour:</span>
                <select
                  aria-label="Select display background colour"
                  value={activeDisplayTheme.id}
                  onChange={(e) => handleSelectDisplayTheme(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-900/90 px-2 py-0.5 text-[11px] font-bold text-white focus:border-sky-400 focus:outline-none"
                >
                  {DISPLAY_THEMES.map((theme) => (
                    <option key={theme.id} value={theme.id}>
                      {theme.label}
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap items-center gap-1">
                  {DISPLAY_THEMES.map((theme) => {
                    const selected = activeDisplayTheme.id === theme.id;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => handleSelectDisplayTheme(theme.id)}
                        title={theme.label}
                        aria-label={`Select ${theme.label} background colour`}
                        className={`h-4 w-4 rounded-full transition border ${theme.swatchClass} ${
                          selected
                            ? 'ring-2 ring-white scale-110 border-white'
                            : 'border-white/30 opacity-80 hover:opacity-100 hover:scale-105'
                        }`}
                      />
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const next = !keepAwakeEnabled;
                  setKeepAwakeEnabled(next);
                  try {
                    localStorage.setItem('lgplast_keep_awake', next ? '1' : '0');
                  } catch {}
                }}
                className={`rounded-lg px-2.5 py-1 text-[10px] font-bold border transition ${
                  keepAwakeEnabled
                    ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50'
                    : 'bg-slate-900/70 text-slate-300 border-slate-700 hover:text-white'
                }`}
                title="Prevents device screen from sleeping so dashboard stays live continuously"
              >
                {keepAwakeEnabled
                  ? wakeLockActive
                    ? 'Screen Always On: ACTIVE'
                    : 'Keep Screen On: ENABLED'
                  : 'Keep Screen On: OFF'}
              </button>
            </div>

            {/* One-Tap Phone Push Notification Opt-In Banner */}
            {pushPermission === 'default' && !pushBannerDismissed && (
              <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-amber-400/50 bg-amber-500/15 px-3.5 py-2.5 text-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-slate-950">
                    <BellRing className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-black text-amber-200">
                      Turn On Phone Push Notifications (Like Email Alerts)
                    </div>
                    <div className="text-[11px] text-amber-100/90">
                      Receive instant phone alerts for Dispatch, Diesel fuel approvals, Scrap/Mixing, 09:45–06:45 Weight Checks &amp; Breakdowns whenever connected to network.
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleEnablePhonePush}
                    className="rounded-xl bg-amber-400 hover:bg-amber-300 px-3.5 py-1.5 text-xs font-black text-slate-950 shadow transition"
                  >
                    Allow Phone Alerts
                  </button>
                  <button
                    type="button"
                    onClick={() => setPushBannerDismissed(true)}
                    className="rounded-lg p-1 text-amber-200 hover:bg-amber-500/20 transition"
                    title="Dismiss banner"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
            {/* Quick Mobile Navigation Pills Bar (So phones also jump rapidly without opening drawer) */}
            <div className="flex md:hidden items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectNavTab(item.id)}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold whitespace-nowrap transition ${
                    activeDowntimeTab === item.id
                      ? 'bg-blue-600 text-white'
                      : 'border border-slate-800 bg-slate-900 text-slate-300'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {typeof item.badge === 'number' && item.badge > 0 && (
                    <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-black text-white">
                      {item.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {allowedTabs.length === 0 ? (
              <div className="rounded-2xl border border-rose-500/40 bg-slate-900/95 p-8 text-center space-y-2">
                <Lock className="h-10 w-10 text-rose-400 mx-auto" />
                <h3 className="text-base font-bold text-white">Account Access Restricted</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Your account is currently locked or has no sections enabled. Please contact the Plant Administrator (<span className="text-amber-300">h250862h@hit.ac.zw</span>).
                </p>
              </div>
            ) : (
              <>
                {activeDowntimeTab === 'status' && effectivePermissions.viewMachineStatus && (
                  <MachineStatusBoard
                    machines={machines}
                    entries={entries}
                    dispatchEntries={dispatchEntries}
                    sopProductionLogs={sopProductionLogs}
                    sopScrapPipeline={sopScrapPipeline}
                    onLogStoppage={handleLogStoppageFromBoard}
                    onRestoreRunning={handleRestoreRunning}
                    onSaveEntry={handleSaveEntry}
                    onOpenWeightOutputSchedule={
                      isShiftInChargeWeightCheckUser || isAdmin
                        ? () => {
                            const now = new Date();
                            const active = getActiveWeightOutputSlot(now);
                            if (active) {
                              setManualWeightCheckSlot(active);
                            } else {
                              const next = getNextWeightOutputSlot(now);
                              const todayLocal = ymd(now);
                              setManualWeightCheckSlot({
                                slot: next.slot,
                                slotKey: `${todayLocal}_MANUAL_${next.slot}`,
                                slotDateStr: todayLocal,
                                shiftLabel:
                                  now.getHours() >= 7 && now.getHours() < 19 ? 'Day' : 'Night',
                                elapsedMins: 0,
                              });
                            }
                          }
                        : undefined
                    }
                    canQuickLog={
                      isAdmin ||
                      effectivePermissions.logDowntime ||
                      effectivePermissions.sopFloorAccess ||
                      effectivePermissions.sopScrapSend
                    }
                    currentUserName={user.displayName || currentReporter}
                    currentUserEmail={user.email || ''}
                  />
                )}

                {activeDowntimeTab === 'log' && effectivePermissions.logDowntime && (
                  <LogDowntimeView
                    machines={machines}
                    entries={entries}
                    selectedMachineDefault={prefilledMachine}
                    onSaveEntry={handleSaveEntry}
                    onSaveEntriesBatch={handleSaveEntriesBatch}
                    onDeleteEntry={handleDeleteEntry}
                    currentUserName={user.displayName || currentReporter}
                    currentUserEmail={user.email || ''}
                    onViewCertificate={(entry) => {
                      setCertificateEntry(entry);
                      setIsCertificateModalOpen(true);
                    }}
                  />
                )}

                {activeDowntimeTab === 'daily' && effectivePermissions.viewDailyHours && (
                  <DailyHoursView machines={machines} entries={entries} isAdmin={isAdmin} />
                )}

                {activeDowntimeTab === 'dispatch' && hasDispatchAccess && (
                  <DispatchSystemView
                    machines={machines}
                    dispatchEntries={dispatchEntries}
                    allDispatchesWithBackground={allDispatchesWithBackground}
                    monthlyPlans={monthlyPlans}
                    sopProductionLogs={sopProductionLogs}
                    permissions={effectivePermissions}
                    isAdmin={isAdmin}
                    currentUserName={user.displayName || currentReporter}
                    currentUserEmail={user.email || ''}
                    requestedStage={requestedDispatchStage}
                    onStageHandled={() => setRequestedDispatchStage(null)}
                  />
                )}

                {activeDowntimeTab === 'prod_planning' &&
                  (isAdmin ||
                    effectivePermissions.productionPlanningAccess ||
                    effectivePermissions.dispatchShiftEntry) && (
                    <ProductionPlanningView
                      machines={machines}
                      allDispatches={allDispatchesWithBackground}
                      uploadedBackgroundDispatches={uploadedBackgroundDispatches}
                      monthlyPlans={monthlyPlans}
                      currentUserName={user.displayName || currentReporter}
                      isAdmin={isAdmin}
                    />
                  )}

                {activeDowntimeTab === 'diesel' && hasDieselAccess && (
                  <DieselBowserView
                    tank={dieselTank}
                    requests={dieselRequests}
                    grns={dieselGrns}
                    permissions={effectivePermissions}
                    isAdmin={isAdmin}
                    currentUserName={user.displayName || currentReporter}
                    currentUserEmail={user.email || ''}
                    requestedSubTab={requestedDieselSubTab}
                    onSubTabHandled={() => setRequestedDieselSubTab(null)}
                  />
                )}

                {SOP_TAB_TO_SUBTAB[activeDowntimeTab] && (
                  <SopFloorApkView
                    machines={machines}
                    downtimeEntries={entries}
                    productionLogs={sopProductionLogs}
                    qcChecks={sopQcChecks}
                    scrapPipeline={sopScrapPipeline}
                    mixingReports={sopMixingReports}
                    handovers={sopHandovers}
                    permissions={effectivePermissions}
                    isAdmin={isAdmin}
                    currentUserName={user.displayName || currentReporter}
                    currentUserEmail={user.email || ''}
                    forcedSubTab={SOP_TAB_TO_SUBTAB[activeDowntimeTab]}
                    standaloneMode
                  />
                )}

                {activeDowntimeTab === 'attendance' &&
                  (effectivePermissions.attendanceLogger || isAdmin) && (
                    <AttendanceLoggerApp
                      batch={attendanceBatch}
                      onUpdateBatch={setAttendanceBatch}
                      userEmail={user.email || ''}
                      isAdmin={isAdmin}
                    />
                  )}

                {activeDowntimeTab === 'prod_report' &&
                  (isAdmin || effectivePermissions.productionReportAccess) && (
                    <PeriodProductionReportView
                      machines={machines}
                      downtimeEntries={entries}
                      allDispatches={allDispatchesWithBackground}
                      sopProductionLogs={sopProductionLogs}
                      sopQcChecks={sopQcChecks}
                      currentUserName={user.displayName || currentReporter}
                      canExport={isAdmin || Boolean(effectivePermissions.productionReportAccess)}
                    />
                  )}

                {activeDowntimeTab === 'rep' && isAdmin && (
                  <PeriodReportView machines={machines} entries={entries} isAdmin={isAdmin} />
                )}

                {activeDowntimeTab === 'data' &&
                  (isAdmin || effectivePermissions.manageMachinesAndSync) && (
                    <SyncAndMachinesView
                      machines={machines}
                      entries={entries}
                      currentReporter={currentReporter}
                      isOnline={isOnline}
                      syncStatus={syncStatus}
                      syncStatusMessage={syncStatusMsg}
                      onReporterChange={handleReporterChange}
                      onRefreshData={refreshLocalState}
                      onOpenAuthModal={() => setIsAuthModalOpen(true)}
                      onOpenInstallModal={() => setIsInstallModalOpen(true)}
                    />
                  )}
              </>
            )}
          </div>
        </main>
      </div>

      {/* Real-Time Dispatch Pop-Up Notification Messages */}
      <DispatchPopupAlert
        entries={dispatchEntries}
        permissions={effectivePermissions}
        dismissedKeys={dismissedPopupKeys}
        onDismissKey={(key) =>
          setDismissedPopupKeys((prev) => (prev.includes(key) ? prev : [...prev, key]))
        }
        onNavigateToStage={(stage) => {
          setActiveDowntimeTab('dispatch');
          setRequestedDispatchStage(stage);
        }}
      />

      {/* Real-Time SOP Closed-Loop Pop-Up Notifications (Operator -> Recycling -> Mixer -> HOD) */}
      <SopPopupAlert
        scrapRecords={sopScrapPipeline}
        mixingReports={sopMixingReports}
        permissions={effectivePermissions}
        isAdmin={isAdmin}
        hasActiveDispatchPopup={hasActiveDispatchPopup}
        dismissedKeys={dismissedPopupKeys}
        onDismissKey={(key) =>
          setDismissedPopupKeys((prev) => (prev.includes(key) ? prev : [...prev, key]))
        }
        onNavigateToSopTab={(subTab) => {
          setActiveDowntimeTab(SUBTAB_TO_SOP_TAB[subTab]);
        }}
      />

      {/* Real-Time Diesel Bowser Request & Approval PDF Unlock Pop-Up Notifications */}
      <DieselPopupAlert
        requests={dieselRequests}
        permissions={effectivePermissions}
        isAdmin={isAdmin}
        currentUserEmail={user.email || ''}
        hasBlockingPopup={hasActiveDispatchPopup || hasActiveSopPopup}
        dismissedKeys={dismissedPopupKeys}
        onDismissKey={(key) =>
          setDismissedPopupKeys((prev) => (prev.includes(key) ? prev : [...prev, key]))
        }
        onNavigateToDieselTab={(subTab) => {
          setActiveDowntimeTab('diesel');
          setRequestedDieselSubTab(subTab);
        }}
      />

      {/* Scheduled Shift In Charge Pop-Up: Running Weight & Output Check (09:45, 12:45, 18:00, 23:45, 03:45, 06:45) */}
      <ShiftWeightOutputPopupAlert
        machines={machines}
        entries={entries}
        isEligibleUser={isShiftInChargeWeightCheckUser}
        hasBlockingPopup={hasActiveDispatchPopup || hasActiveSopPopup || hasActiveDieselPopup}
        manualOpenSlot={manualWeightCheckSlot}
        onCloseManual={() => setManualWeightCheckSlot(null)}
        onSaveEntry={handleSaveEntry}
        onOpenMachinesBoard={() => setActiveDowntimeTab('status')}
        currentUserName={user.displayName || currentReporter}
        currentUserEmail={user.email || ''}
      />

      {/* Modals */}
      <PWAInstallModal
        isOpen={isInstallModalOpen}
        onClose={() => setIsInstallModalOpen(false)}
        onInstallPrompt={install}
        isInstalled={isInstalled}
        isInstallable={isInstallable}
        isIOS={isIOS}
        isAndroid={isAndroid}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={() => setIsAuthModalOpen(false)}
      />

      <SignedCertificateModal
        isOpen={isCertificateModalOpen}
        onClose={() => {
          setIsCertificateModalOpen(false);
          setCertificateEntry(null);
        }}
        entry={certificateEntry}
      />
    </div>
  );
}
