import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
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
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { AuthModal } from './components/AuthModal';
import { DieselPopupAlert, DieselSubTab } from './components/DieselPopupAlert';
import { DispatchPopupAlert, DispatchSubStage } from './components/DispatchPopupAlert';
import { LgplastLogo } from './components/LgplastLogo';
import { LoginGate } from './components/LoginGate';
import { MachineStatusBoard } from './components/MachineStatusBoard';
import { PWAInstallModal } from './components/PWAInstallModal';
import {
  ActiveScheduleSlot,
  getActiveWeightOutputSlot,
  getNextWeightOutputSlot,
  ShiftWeightOutputPopupAlert,
} from './components/ShiftWeightOutputPopupAlert';
import { SignedCertificateModal } from './components/SignedCertificateModal';
import { SopPopupAlert, SopSubTab } from './components/SopPopupAlert';
import { SpecialOrderPopupAlert } from './components/SpecialOrderPopupAlert';
import type { SpecialOrderSubTab } from './components/SpecialOrdersView';
import polymerWatermarkImg from './assets/images/polymer_3d_watermark_1795109115357.jpg';

const AttendanceLoggerApp = lazy(() =>
  import('./components/AttendanceLoggerApp').then((m) => ({ default: m.AttendanceLoggerApp }))
);
const DailyHoursView = lazy(() =>
  import('./components/DailyHoursView').then((m) => ({ default: m.DailyHoursView }))
);
const DieselBowserView = lazy(() =>
  import('./components/DieselBowserView').then((m) => ({ default: m.DieselBowserView }))
);
const DispatchSystemView = lazy(() =>
  import('./components/DispatchSystemView').then((m) => ({ default: m.DispatchSystemView }))
);
const LogDowntimeView = lazy(() =>
  import('./components/LogDowntimeView').then((m) => ({ default: m.LogDowntimeView }))
);
const MaintenanceJobCardsView = lazy(() =>
  import('./components/MaintenanceJobCardsView').then((m) => ({
    default: m.MaintenanceJobCardsView,
  }))
);
const PeriodProductionReportView = lazy(() =>
  import('./components/PeriodProductionReportView').then((m) => ({
    default: m.PeriodProductionReportView,
  }))
);
const PeriodReportView = lazy(() =>
  import('./components/PeriodReportView').then((m) => ({ default: m.PeriodReportView }))
);
const PowerCutAndGeneratorView = lazy(() =>
  import('./components/PowerCutAndGeneratorView').then((m) => ({
    default: m.PowerCutAndGeneratorView,
  }))
);
const ProductionPlanningView = lazy(() =>
  import('./components/ProductionPlanningView').then((m) => ({ default: m.ProductionPlanningView }))
);
const QualityTrialView = lazy(() =>
  import('./components/QualityTrialView').then((m) => ({ default: m.QualityTrialView }))
);
const SopFloorApkView = lazy(() =>
  import('./components/SopFloorApkView').then((m) => ({ default: m.SopFloorApkView }))
);
const SpecialOrdersView = lazy(() =>
  import('./components/SpecialOrdersView').then((m) => ({ default: m.SpecialOrdersView }))
);
const SyncAndMachinesView = lazy(() =>
  import('./components/SyncAndMachinesView').then((m) => ({ default: m.SyncAndMachinesView }))
);
import {
  auth,
  canAccessFirestorePath,
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
  getLocalAttendanceBatch,
  subscribeAttendanceBatches,
} from './services/attendanceStore';
import {
  getLocalDieselGrns,
  getLocalDieselRequests,
  getLocalDieselTank,
  subscribeDieselGrns,
  subscribeDieselRequests,
  subscribeDieselTank,
} from './services/dieselStore';
import { getStoredDispatches, subscribeDispatchEntries } from './services/dispatchStore';
import { dtl, ymd } from './services/downtimeCalc';
import {
  getActiveMachines,
  getCurrentReporterName,
  getLastSyncError,
  getStoredEntries,
  isUserAdmin,
  saveStoredEntries,
  setCurrentReporterName,
  subscribeFirebaseEntries,
  subscribeMachineryConfig,
  syncEntryToFirebase,
} from './services/downtimeStore';
import {
  getLocalProductionPlans,
  getLocalUploadedBackgroundDispatches,
  mergeAllDispatchesWithBackground,
  subscribeProductionPlans,
  subscribeUploadedBackgroundDispatches,
} from './services/productionPlanStore';
import {
  getLocalSopHandovers,
  getLocalSopMixingReports,
  getLocalSopProductionLogs,
  getLocalSopQcChecks,
  getLocalSopScrapRecords,
  subscribeSopHandovers,
  subscribeSopMixing,
  subscribeSopProduction,
  subscribeSopQc,
  subscribeSopScrap,
} from './services/sopStore';
import {
  getLocalGeneratorLogs,
  getLocalPowerCutLogs,
  subscribeGeneratorLogs,
  subscribePowerCutLogs,
} from './services/powerGenStore';
import {
  getLocalQualityTrials,
  subscribeQualityTrials,
} from './services/qualityTrialStore';
import {
  getLocalMaintenanceJobCards,
  subscribeMaintenanceJobCards,
} from './services/maintenanceJobCardStore';
import {
  getLocalSpecialOrderProductions,
  getLocalSpecialOrders,
  getLocalSpecialOrderWhDispatches,
  subscribeSpecialOrderProductions,
  subscribeSpecialOrders,
  subscribeSpecialOrderWhDispatches,
} from './services/specialOrderStore';
import {
  getUnifiedPendingQueueBreakdown,
  repairAllPendingSyncQueues,
  runFullCloudSyncNow,
} from './services/cloudSyncService';
import { applyLiveAppUpdate, getCanonicalSharedAppUrl } from './services/appUpdateChecker';
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
  GeneratorLog,
  MaintenanceJobCard,
  PlantUserAccount,
  PowerCutLog,
  ProductionPlanItem,
  QualityTrialReport,
  SopMixingReport,
  SopProductionRecord,
  SopQcRecord,
  SopScrapRecord,
  SopShiftHandoverRecord,
  SpecialOrder,
  SpecialOrderFactoryProduction,
  SpecialOrderWhDispatch,
} from './types';
import { ParsedAttendanceMessage } from './types/attendance';

export type DowntimeTab =
  | 'status'
  | 'log'
  | 'daily'
  | 'dispatch'
  | 'special_orders'
  | 'prod_planning'
  | 'diesel'
  | 'power_gen'
  | 'maintenance_job_cards'
  | 'sop_overview'
  | 'sop_production'
  | 'sop_qc'
  | 'quality_trials'
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
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [plantUsers, setPlantUsers] = useState<PlantUserAccount[]>(() => getLocalPlantUsers());

  // Active Navigation Tab & Sub-stage Navigation
  const [activeDowntimeTab, setActiveDowntimeTab] = useState<DowntimeTab>('status');
  const [requestedDispatchStage, setRequestedDispatchStage] = useState<DispatchSubStage | null>(null);
  const [requestedDieselSubTab, setRequestedDieselSubTab] = useState<DieselSubTab | null>(null);
  const [requestedPowerGenSubTab, setRequestedPowerGenSubTab] = useState<'power_cuts' | 'generator'>(
    'power_cuts'
  );
  const [requestedSpecialOrderSubTab, setRequestedSpecialOrderSubTab] =
    useState<SpecialOrderSubTab | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Core Data State - Machinery Downtime, Dispatch, Special Orders, Quality Trials, Planning, Diesel, Power Cut & Generator, SOP Floor & Attendance
  const [machines, setMachines] = useState<string[]>(getActiveMachines());
  const [entries, setEntries] = useState<DowntimeEntry[]>(getStoredEntries());
  const [dispatchEntries, setDispatchEntries] = useState<DispatchEntry[]>([]);
  const [uploadedBackgroundDispatches, setUploadedBackgroundDispatches] = useState<DispatchEntry[]>(
    () => getLocalUploadedBackgroundDispatches()
  );
  const [monthlyPlans, setMonthlyPlans] = useState<ProductionPlanItem[]>(() =>
    getLocalProductionPlans()
  );
  const [specialOrders, setSpecialOrders] = useState<SpecialOrder[]>(() => getLocalSpecialOrders());
  const [specialOrderProductions, setSpecialOrderProductions] = useState<
    SpecialOrderFactoryProduction[]
  >(() => getLocalSpecialOrderProductions());
  const [specialOrderWhDispatches, setSpecialOrderWhDispatches] = useState<
    SpecialOrderWhDispatch[]
  >(() => getLocalSpecialOrderWhDispatches());
  const [qualityTrials, setQualityTrials] = useState<QualityTrialReport[]>(() =>
    getLocalQualityTrials()
  );
  const [maintenanceJobCards, setMaintenanceJobCards] = useState<MaintenanceJobCard[]>(() =>
    getLocalMaintenanceJobCards()
  );
  const [dieselTank, setDieselTank] = useState<DieselTankConfig>(() => getLocalDieselTank());
  const [dieselRequests, setDieselRequests] = useState<DieselFuelRequest[]>(() =>
    getLocalDieselRequests()
  );
  const [dieselGrns, setDieselGrns] = useState<DieselGrnRecord[]>(() => getLocalDieselGrns());
  const [powerCutLogs, setPowerCutLogs] = useState<PowerCutLog[]>(() => getLocalPowerCutLogs());
  const [generatorLogs, setGeneratorLogs] = useState<GeneratorLog[]>(() => getLocalGeneratorLogs());
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
  const [snoozedPopupMap, setSnoozedPopupMap] = useState<Record<string, number>>({});
  const [popupClockNow, setPopupClockNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setPopupClockNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const dismissedPopupKeys = useMemo(
    () =>
      Object.entries(snoozedPopupMap)
        .filter(([, until]) => until > popupClockNow)
        .map(([k]) => k),
    [snoozedPopupMap, popupClockNow]
  );

  const snoozePopupKey = (key: string) => {
    const until = Date.now() + 5 * 60 * 1000;
    setSnoozedPopupMap((prev) => ({ ...prev, [key]: until }));
  };

  const allDispatchesWithBackground = useMemo(
    () => mergeAllDispatchesWithBackground(dispatchEntries, uploadedBackgroundDispatches),
    [dispatchEntries, uploadedBackgroundDispatches]
  );

  const [currentReporter, setCurrentReporter] = useState<string>(() => {
    const s = getActiveSessionUser();
    return s?.displayName || getCurrentReporterName();
  });
  const [prefilledMachine, setPrefilledMachine] = useState<string>('');

  // Firebase Sync Status & Pending Queue (Across ALL App Modules)
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'offline' | 'error'>('synced');
  const [syncStatusMsg, setSyncStatusMsg] = useState<string>('Sync initialized');
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(() => {
    repairAllPendingSyncQueues();
    return getUnifiedPendingQueueBreakdown().totalPending;
  });
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [availableUpdateBuildId, setAvailableUpdateBuildId] = useState<string | null>(null);

  useEffect(() => {
    const onAppUpdate = (ev: Event) => {
      const customEv = ev as CustomEvent<string>;
      if (customEv.detail) {
        setAvailableUpdateBuildId(customEv.detail);
      }
    };
    window.addEventListener('lgplast-app-update-available', onAppUpdate);
    return () => window.removeEventListener('lgplast-app-update-available', onAppUpdate);
  }, []);

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

  // Formal Display Background Theme Selector (Default: Formal White; changeable via dropdown only)
  const DISPLAY_THEMES = [
    {
      id: 'white',
      label: 'Formal White',
      swatchClass: 'bg-slate-50 border-slate-300',
      bgClass: 'bg-[#F8FAFC] text-slate-900',
      isDarkCanvas: false,
    },
    {
      id: 'cream',
      label: 'Formal Cream',
      swatchClass: 'bg-[#FAF6EE] border-amber-200',
      bgClass: 'bg-[#FAF6EE] text-slate-900',
      isDarkCanvas: false,
    },
    {
      id: 'pearl',
      label: 'Executive Pearl',
      swatchClass: 'bg-slate-100 border-slate-300',
      bgClass: 'bg-[#F1F5F9] text-slate-900',
      isDarkCanvas: false,
    },
    {
      id: 'linen',
      label: 'Warm Linen',
      swatchClass: 'bg-[#F5F1E8] border-stone-300',
      bgClass: 'bg-[#F5F1E8] text-slate-900',
      isDarkCanvas: false,
    },
    {
      id: 'navy',
      label: 'Executive Navy',
      swatchClass: 'bg-[#0F1E36] border-slate-600',
      bgClass: 'bg-[#0F172A] text-slate-100',
      isDarkCanvas: true,
    },
    {
      id: 'charcoal',
      label: 'Charcoal Slate',
      swatchClass: 'bg-zinc-900 border-zinc-600',
      bgClass: 'bg-[#18181B] text-slate-100',
      isDarkCanvas: true,
    },
  ] as const;

  const [displayTheme, setDisplayTheme] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('lgplast_display_theme');
      if (saved && DISPLAY_THEMES.some((t) => t.id === saved)) return saved;
    } catch {}
    return 'white';
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

  const directAppUrl = getCanonicalSharedAppUrl();

  // Refresh machines and local entries
  const refreshLocalState = () => {
    repairAllPendingSyncQueues();
    setMachines(getActiveMachines());
    setEntries(getStoredEntries());
    setPendingSyncCount(getUnifiedPendingQueueBreakdown().totalPending);
    setSyncErrorMsg(getLastSyncError());
  };

  // 1. Auth Initialization & Listener (completes auth hydration BEFORE opening Firestore WatchStreams)
  useEffect(() => {
    let mounted = true;

    const initFirebaseSession = async () => {
      const session = getActiveSessionUser();
      if (session) {
        setUser(session);
        const namePart = session.displayName || session.email.split('@')[0].toUpperCase();
        setCurrentReporter(namePart);
        setCurrentReporterName(namePart);
        await ensureFirebaseAuth().catch(() => false);
      } else {
        await auth.authStateReady().catch(() => {});
      }

      if (!mounted) return;
      if (session || auth.currentUser) {
        await canAccessFirestorePath('sop_production_logs', false).catch(() => false);
        await testConnection().catch(() => {});
        if (mounted) {
          repairAllPendingSyncQueues();
          setPendingSyncCount(getUnifiedPendingQueueBreakdown().totalPending);
        }
      }
      if (mounted) {
        repairAllPendingSyncQueues();
        setPendingSyncCount(getUnifiedPendingQueueBreakdown().totalPending);
        setFirebaseReady(true);
        setAuthLoading(false);
      }
    };

    initFirebaseSession();

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
      mounted = false;
      unsubAuth();
    };
  }, []);

  // 2. Real-time Firestore Subscriptions (Entries, Machinery, Plant Users RBAC, Dispatch)
  const isUserSignedIn = Boolean(user);
  useEffect(() => {
    if (!isUserSignedIn || !firebaseReady) return;

    const unsubEntries = subscribeFirebaseEntries(
      (newEntries) => {
        setEntries(newEntries);
        setPendingSyncCount(getUnifiedPendingQueueBreakdown().totalPending);
        setSyncErrorMsg(getLastSyncError());
      },
      (status, msg) => {
        setSyncStatus(status);
        if (msg) setSyncStatusMsg(msg);
        setPendingSyncCount(getUnifiedPendingQueueBreakdown().totalPending);
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
    const unsubPowerCuts = subscribePowerCutLogs((rows) => {
      setPowerCutLogs(rows);
    });
    const unsubGenLogs = subscribeGeneratorLogs((rows) => {
      setGeneratorLogs(rows);
    });
    const unsubSpecialOrders = subscribeSpecialOrders((rows) => {
      setSpecialOrders(rows);
    });
    const unsubSpecialOrderProd = subscribeSpecialOrderProductions((rows) => {
      setSpecialOrderProductions(rows);
    });
    const unsubSpecialOrderWh = subscribeSpecialOrderWhDispatches((rows) => {
      setSpecialOrderWhDispatches(rows);
    });
    const unsubQualityTrials = subscribeQualityTrials((rows) => {
      setQualityTrials(rows);
    });
    const unsubMaintenanceJobCards = subscribeMaintenanceJobCards((rows) => {
      setMaintenanceJobCards(rows);
    });

    const pendingTimer = setInterval(() => {
      setPendingSyncCount(getUnifiedPendingQueueBreakdown().totalPending);
      const err = getLastSyncError();
      setSyncErrorMsg(err);
      if (!err) {
        setSyncStatus((prev) => (prev === 'error' ? 'synced' : prev));
      }
    }, 2500);

    // 24/7 Always-Live Keep-Alive Heartbeat & Server-First Cross-Device Reconciliation
    let keepAliveInFlight = false;
    let lastKeepAliveAt = 0;

    const runLiveKeepAlive = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (keepAliveInFlight) return;
      keepAliveInFlight = true;
      lastKeepAliveAt = Date.now();
      try {
        const res = await runFullCloudSyncNow();
        setEntries(res.data.entries);
        setMachines(res.data.machines);
        setDispatchEntries(res.data.dispatches);
        setSopProductionLogs(res.data.sopProduction);
        setSopQcChecks(res.data.sopQc);
        setSopScrapPipeline(res.data.sopScrap);
        setSopMixingReports(res.data.sopMixing);
        setSopHandovers(res.data.sopHandovers);
        setUploadedBackgroundDispatches(res.data.histDispatches);
        setMonthlyPlans(res.data.plans);
        setDieselTank(res.data.dieselTank);
        setDieselRequests(res.data.dieselRequests);
        setDieselGrns(res.data.dieselGrns);
        setPowerCutLogs(res.data.powerCutLogs);
        setGeneratorLogs(res.data.generatorLogs);
        setSpecialOrders(res.data.specialOrders);
        setSpecialOrderProductions(res.data.specialOrderProductions);
        setSpecialOrderWhDispatches(res.data.specialOrderWhDispatches);
        setQualityTrials(res.data.qualityTrials);
        setMaintenanceJobCards(res.data.maintenanceJobCards);
        setAttendanceBatch(res.data.attendanceBatches);
        setPlantUsers(res.data.plantUsers);
        setPendingSyncCount(res.pendingAfter.totalPending);
        if (res.ok) {
          setSyncErrorMsg(null);
          setSyncStatus('synced');
          setSyncStatusMsg(`Live synced (${res.latencyMs} ms)`);
        } else if (res.error) {
          setSyncErrorMsg(res.error);
        }
        setLastLiveHeartbeat(
          new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        );
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then((regs) => {
            regs.forEach((r) => r.update().catch(() => {}));
          }).catch(() => {});
        }
      } catch {} finally {
        keepAliveInFlight = false;
      }
    };

    // Auto-repair stale queues and pull/flush server updates immediately after listeners stabilize
    repairAllPendingSyncQueues();
    setPendingSyncCount(getUnifiedPendingQueueBreakdown().totalPending);
    canAccessFirestorePath('sop_production_logs', false)
      .then(() => {
        repairAllPendingSyncQueues();
        setPendingSyncCount(getUnifiedPendingQueueBreakdown().totalPending);
      })
      .catch(() => {});
    const initialPullTimer = setTimeout(() => {
      runLiveKeepAlive();
    }, 50);

    const handleVisibilityOrOnline = () => {
      if (document.visibilityState === 'visible' || navigator.onLine) {
        if (Date.now() - lastKeepAliveAt > 10000) {
          runLiveKeepAlive();
        }
      }
    };

    const keepAliveTimer = setInterval(runLiveKeepAlive, 15000);
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
      unsubPowerCuts();
      unsubGenLogs();
      unsubSpecialOrders();
      unsubSpecialOrderProd();
      unsubSpecialOrderWh();
      unsubQualityTrials();
      unsubMaintenanceJobCards();
      clearTimeout(initialPullTimer);
      clearInterval(pendingTimer);
      clearInterval(keepAliveTimer);
      document.removeEventListener('visibilitychange', handleVisibilityOrOnline);
      window.removeEventListener('online', handleVisibilityOrOnline);
      window.removeEventListener('focus', handleVisibilityOrOnline);
    };
  }, [isUserSignedIn, firebaseReady]);

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
        'special_orders',
        'prod_planning',
        'diesel',
        'power_gen',
        'maintenance_job_cards',
        'sop_overview',
        'sop_production',
        'sop_qc',
        'quality_trials',
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
      if (payload.specialOrderSubTab) {
        setRequestedSpecialOrderSubTab(payload.specialOrderSubTab);
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
      specialOrderProductions,
      specialOrderWhDispatches,
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
    specialOrderProductions,
    specialOrderWhDispatches,
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

  const specialOrderBadgeCount = useMemo(() => {
    let count = 0;
    if (isAdmin || effectivePermissions.dispatchHODConfirm) {
      count += specialOrderProductions.filter((p) => p.status === 'PENDING_HOD_FACTORY').length;
      count += specialOrderWhDispatches.filter((w) => w.status === 'PENDING_HOD').length;
    }
    if (isAdmin || effectivePermissions.dispatchWHConfirm) {
      count += specialOrderWhDispatches.filter((w) => w.status === 'PENDING_WH').length;
    }
    return count;
  }, [specialOrderProductions, specialOrderWhDispatches, effectivePermissions, isAdmin]);

  const hasSpecialOrderAccess =
    isAdmin ||
    Boolean(effectivePermissions.specialOrdersAccess) ||
    effectivePermissions.dispatchShiftEntry ||
    effectivePermissions.dispatchWHConfirm ||
    effectivePermissions.dispatchHODConfirm;

  const hasQualityTrialAccess =
    isAdmin ||
    Boolean(effectivePermissions.qualityTrialsAccess) ||
    Boolean(effectivePermissions.sopFloorAccess);

  const hasMaintenanceJobCardAccess =
    isAdmin ||
    Boolean(effectivePermissions.maintenanceJobCardsAccess) ||
    effectivePermissions.dispatchShiftEntry ||
    effectivePermissions.logDowntime;

  // Compute allowed sidebar navigation tabs strictly from effectivePermissions & Admin-only report policy
  const allowedTabs = useMemo<DowntimeTab[]>(() => {
    const tabs: DowntimeTab[] = [];
    if (effectivePermissions.viewMachineStatus) tabs.push('status');
    if (effectivePermissions.logDowntime) tabs.push('log');
    if (effectivePermissions.viewDailyHours) tabs.push('daily');
    if (hasDispatchAccess) tabs.push('dispatch');
    if (hasSpecialOrderAccess) tabs.push('special_orders');
    if (
      isAdmin ||
      effectivePermissions.productionPlanningAccess ||
      effectivePermissions.dispatchShiftEntry
    ) {
      tabs.push('prod_planning');
    }
    if (hasDieselAccess) tabs.push('diesel');
    if (isAdmin || effectivePermissions.logDowntime || effectivePermissions.viewMachineStatus) {
      tabs.push('power_gen');
    }
    if (hasMaintenanceJobCardAccess) tabs.push('maintenance_job_cards');
    if (isAdmin || effectivePermissions.sopFloorAccess) {
      tabs.push('sop_overview', 'sop_production', 'sop_qc');
    }
    if (hasQualityTrialAccess) tabs.push('quality_trials');
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
    if (isAdmin) tabs.push('prod_report', 'rep');
    if (isAdmin || effectivePermissions.manageMachinesAndSync) tabs.push('data');
    return tabs;
  }, [
    effectivePermissions,
    hasDispatchAccess,
    hasSpecialOrderAccess,
    hasQualityTrialAccess,
    hasMaintenanceJobCardAccess,
    hasDieselAccess,
    isAdmin,
  ]);

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
    setPendingSyncCount(getUnifiedPendingQueueBreakdown().totalPending);

    const res = await syncEntryToFirebase(entry);
    setEntries(getStoredEntries());
    setPendingSyncCount(getUnifiedPendingQueueBreakdown().totalPending);
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
    setPendingSyncCount(getUnifiedPendingQueueBreakdown().totalPending);

    const results = await Promise.all(newEntries.map((entry) => syncEntryToFirebase(entry)));
    setEntries(getStoredEntries());
    setPendingSyncCount(getUnifiedPendingQueueBreakdown().totalPending);
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
    setPendingSyncCount(getUnifiedPendingQueueBreakdown().totalPending);

    const res = await syncEntryToFirebase(existing);
    setEntries(getStoredEntries());
    setPendingSyncCount(getUnifiedPendingQueueBreakdown().totalPending);
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
      const res = await runFullCloudSyncNow(true);
      setEntries(res.data.entries);
      setMachines(res.data.machines);
      setDispatchEntries(res.data.dispatches);
      setSopProductionLogs(res.data.sopProduction);
      setSopQcChecks(res.data.sopQc);
      setSopScrapPipeline(res.data.sopScrap);
      setSopMixingReports(res.data.sopMixing);
      setSopHandovers(res.data.sopHandovers);
      setUploadedBackgroundDispatches(res.data.histDispatches);
      setMonthlyPlans(res.data.plans);
      setDieselTank(res.data.dieselTank);
      setDieselRequests(res.data.dieselRequests);
      setDieselGrns(res.data.dieselGrns);
      setPowerCutLogs(res.data.powerCutLogs);
      setGeneratorLogs(res.data.generatorLogs);
      setSpecialOrders(res.data.specialOrders);
      setSpecialOrderProductions(res.data.specialOrderProductions);
      setSpecialOrderWhDispatches(res.data.specialOrderWhDispatches);
      setQualityTrials(res.data.qualityTrials);
      setMaintenanceJobCards(res.data.maintenanceJobCards);
      setAttendanceBatch(res.data.attendanceBatches);
      setPlantUsers(res.data.plantUsers);
      setPendingSyncCount(res.pendingAfter.totalPending);
      setLastLiveHeartbeat(
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
      if (res.ok) {
        setSyncErrorMsg(null);
        setSyncStatus('synced');
        setSyncStatusMsg(
          `Cloud server verified (${res.latencyMs} ms · ${res.counts.downtime} downtime, ${res.counts.dispatch} dispatch, ${res.counts.specialOrderProd + res.counts.specialOrderWh} special order)`
        );
      } else {
        setSyncErrorMsg(res.error || 'Sync verification warning');
        setSyncStatus('error');
        setSyncStatusMsg(res.error || 'Cloud server verification failed');
      }
    } catch (e: any) {
      setSyncErrorMsg(e?.message || 'Sync error');
      setSyncStatus('error');
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
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center items-center text-slate-700 gap-3 font-sans">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#0F1E36] text-white shadow-sm">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div className="text-xs font-semibold tracking-wider text-slate-600 uppercase">
          Initializing LG PLAST Operations System
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
      id: 'special_orders',
      group: '1. Live Floor Operations',
      label: 'Special Orders (39–46)',
      subtitle: 'Factory Stock · WH Dispatch',
      icon: <Layers className="h-4 w-4" />,
      badge: specialOrderBadgeCount,
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
    {
      id: 'power_gen',
      group: '1. Live Floor Operations',
      label: 'Power Cut & Generator',
      subtitle: 'Outages · Gen Fuel (L)',
      icon: <Zap className="h-4 w-4" />,
      badge: powerCutLogs.filter((p) => p.status === 'ONGOING' || !p.timeBack).length,
    },
    {
      id: 'maintenance_job_cards',
      group: '1. Live Floor Operations',
      label: 'Maintenance Job Cards',
      subtitle: 'Mntce · Die & Mould PDF',
      icon: <Wrench className="h-4 w-4" />,
      badge: maintenanceJobCards.filter((c) => c.status !== 'COMPLETED').length,
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
      id: 'quality_trials',
      group: '2. Daily SOP Floor APKs',
      label: 'Quality Trial Reports',
      subtitle: 'ISO · QMS · ASTM · SAZ PDF',
      icon: <FlaskConical className="h-4 w-4" />,
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
      subtitle: 'All Entries · 6-Sheet Excel',
      icon: <BarChart3 className="h-4 w-4" />,
      adminTag: true,
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
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col font-sans">
      {/* Formal Corporate Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="flex items-center justify-between px-3 py-2 sm:px-5">
          <div className="flex items-center gap-2.5">
            {/* Mobile Left Drawer Toggle */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="md:hidden rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-100"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>

            <LgplastLogo size="md" variant="light" showSubtitle={false} />

            <div className="border-l border-slate-200 pl-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm sm:text-base font-bold tracking-tight text-[#0F1E36]">
                  LG PLAST
                </span>
                <span className="hidden sm:inline text-xs font-medium text-slate-500">
                  Plant Operations
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500 tabular-nums">
                <span className="flex items-center gap-1.5 font-medium">
                  {isOnline ? (
                    <span className="text-slate-600 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                      Online · {lastLiveHeartbeat}
                    </span>
                  ) : (
                    <span className="text-amber-700 flex items-center gap-1">
                      <CloudOff className="h-3 w-3" /> Offline Mode
                    </span>
                  )}
                </span>

                {syncErrorMsg || syncStatus === 'error' ? (
                  <button
                    onClick={handleManualSyncNow}
                    className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 transition"
                    title={syncErrorMsg || syncStatusMsg}
                  >
                    Retry Sync
                  </button>
                ) : pendingSyncCount > 0 ? (
                  <span className="text-[10px] font-medium text-amber-700">
                    · {pendingSyncCount} Pending Sync
                  </span>
                ) : (
                  <span className="hidden sm:inline text-[10px] font-medium text-emerald-700">
                    · Synced
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right Header Utility Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {availableUpdateBuildId && (
              <button
                type="button"
                onClick={() => applyLiveAppUpdate(availableUpdateBuildId)}
                className="flex items-center gap-1.5 rounded-lg border border-sky-400 bg-sky-600 hover:bg-sky-500 px-2.5 py-1.5 text-xs font-bold text-white transition shadow-2xs"
                title="A new Render deployment is live — tap to load the latest version"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Update Live · Refresh</span>
              </button>
            )}

            {actionableDispatchCount > 0 && hasDispatchAccess && (
              <button
                type="button"
                onClick={() => {
                  setActiveDowntimeTab('dispatch');
                  setRequestedDispatchStage(
                    effectivePermissions.dispatchWHConfirm ? 'wh' : 'hod'
                  );
                }}
                className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 transition tabular-nums"
              >
                <Bell className="h-3.5 w-3.5 text-amber-700" />
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
                      className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition"
                      title="Device push notifications active — click to send test alert"
                    >
                      <BellRing className="h-3.5 w-3.5 text-emerald-700" />
                      <span className="hidden md:inline">
                        {pushTestStatus || 'Push Active'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={handleTogglePushSound}
                      className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 p-1.5 text-slate-600 transition"
                      title={pushSoundOn ? 'Mute alert tone' : 'Unmute alert tone'}
                    >
                      {pushSoundOn ? (
                        <Volume2 className="h-3.5 w-3.5 text-[#0F1E36]" />
                      ) : (
                        <VolumeX className="h-3.5 w-3.5 text-slate-400" />
                      )}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleEnablePhonePush}
                    className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                      pushPermission === 'denied'
                        ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                        : 'border-[#0F1E36] bg-[#0F1E36] text-white hover:bg-[#193054]'
                    }`}
                    title={
                      pushPermission === 'denied'
                        ? 'Notifications blocked in browser settings — allow notifications for this site'
                        : 'Enable live device push notifications'
                    }
                  >
                    <BellRing className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">
                      {pushTestStatus ||
                        (pushPermission === 'denied' ? 'Alerts Blocked' : 'Enable Alerts')}
                    </span>
                  </button>
                )}
              </div>
            )}

            <button
              onClick={handleManualSyncNow}
              disabled={isManualSyncing}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition"
              title="Synchronize records"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-[#0F1E36] ${isManualSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isManualSyncing ? 'Syncing...' : 'Sync'}</span>
            </button>

            <button
              onClick={handleCopyDirectLink}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition"
              title="Copy Application Link"
            >
              <Share2 className="h-3.5 w-3.5 text-[#0F1E36]" />
              <span className="hidden lg:inline">{copiedLink ? 'Link Copied' : 'Share'}</span>
            </button>

            {isInstallable && !isInstalled ? (
              <button
                onClick={() => install()}
                className="flex items-center gap-1 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-2.5 py-1.5 text-xs font-semibold text-white transition shadow-2xs"
              >
                <Smartphone className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Install App</span>
              </button>
            ) : (
              <button
                onClick={() => setIsInstallModalOpen(true)}
                className="hidden sm:flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                <Smartphone className="h-3.5 w-3.5 text-[#0F1E36]" />
                <span className="hidden lg:inline">Install App</span>
              </button>
            )}

            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0F1E36] text-xs font-semibold text-white uppercase">
                {user.displayName?.slice(0, 1) || user.email?.slice(0, 1) || 'U'}
              </div>
              <div className="hidden sm:flex flex-col text-left">
                <span className="text-[11px] font-semibold text-slate-900 leading-tight truncate max-w-[130px]">
                  {user.displayName || user.email?.split('@')[0]}
                </span>
                <span className="text-[9px] font-medium text-slate-500 uppercase leading-none">
                  {effectiveRoleLabel}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-rose-700 transition"
                title="Sign Out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* FORMAL CORPORATE WORKSPACE: Executive Navy Sidebar + 0.2cm Divider + White/Cream Polymer Watermarked Canvas */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Mobile Overlay Backdrop */}
        {mobileMenuOpen && (
          <div
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-xs md:hidden"
          />
        )}

        {/* LEFT NAVIGATION PANEL (Executive Navy) */}
        <aside
          className={`${
            mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
          } fixed md:static inset-y-0 left-0 z-30 w-64 md:w-60 shrink-0 bg-[#0F1E36] border-r border-[#1E3A5F] flex flex-col justify-between transition-transform duration-200 pt-16 md:pt-4 pb-4 px-3 overflow-y-auto print:hidden`}
        >
          <div className="space-y-4">
            {/* Official LG PLAST Factory Brand Card */}
            <div className="rounded-lg border border-white/15 bg-white p-2.5 flex items-center justify-center shadow-2xs">
              <LgplastLogo size="md" variant="light" />
            </div>

            {/* Confidentiality Clearance Card */}
            <div className="rounded-lg border border-[#1E3A5F] bg-[#162947] p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                  Access Clearance
                </span>
                <Lock className="h-3 w-3 text-slate-300" />
              </div>
              <div className="text-xs font-semibold text-white truncate">{effectiveRoleLabel}</div>
              <div className="text-[10px] text-slate-300 truncate">{user.email}</div>
            </div>

            {/* Section Menu Buttons (Arranged by Floor Operational Importance) */}
            <nav className="space-y-3">
              {navGroups.map((groupTitle) => {
                const groupItems = navItems.filter((item) => item.group === groupTitle);
                if (groupItems.length === 0) return null;
                return (
                  <div key={groupTitle} className="space-y-1">
                    <div className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {groupTitle}
                    </div>
                    {groupItems.map((item) => {
                      const isActive = activeDowntimeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleSelectNavTab(item.id)}
                          className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition ${
                            isActive
                              ? 'bg-[#1E3A5F] text-white border border-[#3E6396] shadow-2xs'
                              : 'border border-transparent text-slate-200 hover:bg-[#162947] hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                                isActive ? 'bg-white/15 text-white' : 'bg-[#162947] text-slate-300'
                              }`}
                            >
                              {item.icon}
                            </span>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold truncate flex items-center gap-1.5">
                                <span>{item.label}</span>
                                {item.adminTag && (
                                  <span className="rounded bg-white/15 px-1 py-0.5 text-[8px] font-semibold text-slate-200 border border-white/20">
                                    ADMIN
                                  </span>
                                )}
                              </div>
                              <div
                                className={`text-[10px] truncate ${
                                  isActive ? 'text-slate-200' : 'text-slate-400'
                                }`}
                              >
                                {item.subtitle}
                              </div>
                            </div>
                          </div>

                          {typeof item.badge === 'number' && item.badge > 0 && (
                            <span className="shrink-0 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums">
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

          <div className="pt-4 mt-4 border-t border-[#1E3A5F] px-2 text-[10px] text-slate-400 space-y-1">
            <div className="font-semibold text-slate-300">Audit Record Policy</div>
            <div>Submitted production and dispatch entries are locked for compliance.</div>
          </div>
        </aside>

        {/* EXACT 0.2CM VERTICAL DIVIDING BAR (Executive Navy) */}
        <div
          aria-hidden="true"
          className="w-[0.2cm] shrink-0 bg-gradient-to-b from-[#1E3A5F] via-[#0F1E36] to-[#1E3A5F] border-x border-[#2B4B78] print:hidden"
          title="LG PLAST Workspace Divider"
        />

        {/* RIGHT WIDER DISPLAY INTERFACE (Formal White/Cream Default + Polymer Structure Watermark) */}
        <main
          className={`relative flex-1 min-w-0 px-3 py-4 sm:px-6 overflow-y-auto transition-colors duration-300 ${activeDisplayTheme.bgClass}`}
        >
          {/* 3D Polymer Molecular Structure Background Watermark (APK Workspace Only — Excluded from Reports) */}
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-y-0 right-0 left-0 md:left-[calc(15rem+0.2cm)] z-0 overflow-hidden select-none print:hidden"
          >
            <img
              src={polymerWatermarkImg}
              alt=""
              referrerPolicy="no-referrer"
              className={`h-full w-full object-cover transition-opacity duration-300 ${
                activeDisplayTheme.isDarkCanvas
                  ? 'opacity-[0.09] invert'
                  : 'opacity-[0.11] mix-blend-multiply'
              }`}
            />
          </div>

          <div className="relative z-10 mx-auto max-w-6xl space-y-4">
            {/* Compact Display Bar: Formal Dropdown Colour Selector Only + Screen Awake Toggle */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white/90 px-3.5 py-2 text-[11px] text-slate-700 shadow-2xs print:hidden">
              <div className="flex items-center gap-2 font-medium">
                <span className={`inline-block h-3 w-3 rounded border ${activeDisplayTheme.swatchClass}`} />
                <label htmlFor="lgplast-theme-select" className="text-slate-600 font-semibold">
                  Display Theme:
                </label>
                <select
                  id="lgplast-theme-select"
                  aria-label="Select display background colour"
                  value={activeDisplayTheme.id}
                  onChange={(e) => handleSelectDisplayTheme(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-900 focus:border-[#0F1E36] focus:outline-none focus:ring-1 focus:ring-[#0F1E36]"
                >
                  {DISPLAY_THEMES.map((theme) => (
                    <option key={theme.id} value={theme.id}>
                      {theme.label}
                    </option>
                  ))}
                </select>
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
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition ${
                  keepAwakeEnabled
                    ? 'bg-[#0F1E36] text-white border-[#0F1E36]'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
                title="Prevents device screen from sleeping so dashboard stays active continuously"
              >
                {keepAwakeEnabled
                  ? wakeLockActive
                    ? 'Screen Awake: Active'
                    : 'Keep Screen On: Enabled'
                  : 'Keep Screen On: Off'}
              </button>
            </div>

            {/* One-Tap Phone Push Notification Opt-In Banner */}
            {pushPermission === 'default' && !pushBannerDismissed && (
              <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 text-xs shadow-2xs print:hidden">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0F1E36] text-white">
                    <BellRing className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900">
                      Enable Device Push Notifications
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Receive instant phone and desktop notifications for Dispatch, Diesel approvals, SOP handovers, shift weight updates, and stoppages.
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleEnablePhonePush}
                    className="rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-3.5 py-1.5 text-xs font-semibold text-white transition"
                  >
                    Enable Notifications
                  </button>
                  <button
                    type="button"
                    onClick={() => setPushBannerDismissed(true)}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                    title="Dismiss banner"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Quick Mobile Navigation Bar */}
            <div className="flex md:hidden items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none print:hidden">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectNavTab(item.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition ${
                    activeDowntimeTab === item.id
                      ? 'bg-[#0F1E36] text-white'
                      : 'border border-slate-300 bg-white text-slate-700'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {typeof item.badge === 'number' && item.badge > 0 && (
                    <span className="rounded-full bg-rose-600 px-1.5 text-[10px] font-semibold text-white">
                      {item.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {allowedTabs.length === 0 ? (
              <div className="rounded-xl border border-rose-200 bg-white/95 p-8 text-center space-y-2 shadow-xs">
                <Lock className="h-9 w-9 text-rose-600 mx-auto" />
                <h3 className="text-base font-semibold text-slate-900">Account Access Restricted</h3>
                <p className="text-xs text-slate-600 max-w-md mx-auto">
                  Your account is currently restricted or has no modules assigned. Contact the Plant Administrator (<span className="font-mono font-semibold text-[#0F1E36]">h250862h@hit.ac.zw</span>).
                </p>
              </div>
            ) : (
              <Suspense
                fallback={
                  <div className="flex items-center justify-center py-16 text-xs font-semibold text-slate-400">
                    Loading module...
                  </div>
                }
              >
                {activeDowntimeTab === 'status' && effectivePermissions.viewMachineStatus && (
                  <MachineStatusBoard
                    machines={machines}
                    entries={entries}
                    dispatchEntries={dispatchEntries}
                    sopProductionLogs={sopProductionLogs}
                    sopScrapPipeline={sopScrapPipeline}
                    generatorLogs={generatorLogs}
                    powerCutLogs={powerCutLogs}
                    onOpenPowerGenTab={(sub) => {
                      setRequestedPowerGenSubTab(sub || 'generator');
                      setActiveDowntimeTab('power_gen');
                    }}
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

                {activeDowntimeTab === 'special_orders' && hasSpecialOrderAccess && (
                  <SpecialOrdersView
                    machines={machines}
                    orders={specialOrders}
                    prodEntries={specialOrderProductions}
                    whDispatches={specialOrderWhDispatches}
                    monthlyPlans={monthlyPlans}
                    permissions={effectivePermissions}
                    isAdmin={isAdmin}
                    currentUserName={user.displayName || currentReporter}
                    currentUserEmail={user.email || ''}
                    requestedSubTab={requestedSpecialOrderSubTab}
                    onSubTabHandled={() => setRequestedSpecialOrderSubTab(null)}
                    onDataChanged={() => {
                      setSpecialOrders(getLocalSpecialOrders());
                      setSpecialOrderProductions(getLocalSpecialOrderProductions());
                      setSpecialOrderWhDispatches(getLocalSpecialOrderWhDispatches());
                      setDispatchEntries(getStoredDispatches());
                    }}
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

                {activeDowntimeTab === 'power_gen' &&
                  (isAdmin ||
                    effectivePermissions.logDowntime ||
                    effectivePermissions.viewMachineStatus) && (
                    <PowerCutAndGeneratorView
                      powerCutLogs={powerCutLogs}
                      generatorLogs={generatorLogs}
                      downtimeEntries={entries}
                      isAdmin={isAdmin}
                      currentUserName={user.displayName || currentReporter}
                      currentUserEmail={user.email || ''}
                      initialSubTab={requestedPowerGenSubTab}
                      onDataChanged={() => {
                        setEntries(getStoredEntries());
                        setPowerCutLogs(getLocalPowerCutLogs());
                        setGeneratorLogs(getLocalGeneratorLogs());
                      }}
                    />
                  )}

                {activeDowntimeTab === 'maintenance_job_cards' && hasMaintenanceJobCardAccess && (
                  <MaintenanceJobCardsView
                    machines={machines}
                    jobCards={maintenanceJobCards}
                    currentUserName={user.displayName || currentReporter}
                    currentUserEmail={user.email || ''}
                    canIssueOrEdit={hasMaintenanceJobCardAccess}
                    onDataChanged={() => {
                      setMaintenanceJobCards(getLocalMaintenanceJobCards());
                    }}
                  />
                )}

                {activeDowntimeTab === 'quality_trials' && hasQualityTrialAccess && (
                  <QualityTrialView
                    machines={machines}
                    trials={qualityTrials}
                    isAdmin={isAdmin}
                    currentUserName={user.displayName || currentReporter}
                    currentUserEmail={user.email || ''}
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

                {activeDowntimeTab === 'prod_report' && isAdmin && (
                  <PeriodProductionReportView
                    machines={machines}
                    downtimeEntries={entries}
                    allDispatches={allDispatchesWithBackground}
                    sopProductionLogs={sopProductionLogs}
                    sopQcChecks={sopQcChecks}
                    dieselRequests={dieselRequests}
                    dieselGrns={dieselGrns}
                    dieselTank={dieselTank}
                    generatorLogs={generatorLogs}
                    powerCutLogs={powerCutLogs}
                    currentUserName={user.displayName || currentReporter}
                    isAdmin={isAdmin}
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
                      totalPendingCount={pendingSyncCount}
                      onReporterChange={handleReporterChange}
                      onRefreshData={refreshLocalState}
                      onFullCloudSync={handleManualSyncNow}
                      onOpenAuthModal={() => setIsAuthModalOpen(true)}
                      onOpenInstallModal={() => setIsInstallModalOpen(true)}
                    />
                  )}
              </Suspense>
            )}
          </div>
        </main>
      </div>

      {/* Non-Blocking Live Alert Stack (All Active Pop-Up Messages Continue Unblocked) */}
      <div className="fixed inset-0 z-50 pointer-events-none flex flex-col items-center justify-start gap-3 overflow-y-auto px-3 pt-4 pb-8 sm:px-5 sm:pt-8">
        <DispatchPopupAlert
          entries={dispatchEntries}
          permissions={effectivePermissions}
          dismissedKeys={dismissedPopupKeys}
          onDismissKey={snoozePopupKey}
          onNavigateToStage={(stage) => {
            setActiveDowntimeTab('dispatch');
            setRequestedDispatchStage(stage);
          }}
        />

        <SopPopupAlert
          scrapRecords={sopScrapPipeline}
          mixingReports={sopMixingReports}
          permissions={effectivePermissions}
          isAdmin={isAdmin}
          dismissedKeys={dismissedPopupKeys}
          onDismissKey={snoozePopupKey}
          onNavigateToSopTab={(subTab) => {
            setActiveDowntimeTab(SUBTAB_TO_SOP_TAB[subTab]);
          }}
        />

        <DieselPopupAlert
          requests={dieselRequests}
          permissions={effectivePermissions}
          isAdmin={isAdmin}
          currentUserEmail={user.email || ''}
          dismissedKeys={dismissedPopupKeys}
          onDismissKey={snoozePopupKey}
          onNavigateToDieselTab={(subTab) => {
            setActiveDowntimeTab('diesel');
            setRequestedDieselSubTab(subTab);
          }}
        />

        <SpecialOrderPopupAlert
          prodEntries={specialOrderProductions}
          whDispatches={specialOrderWhDispatches}
          permissions={effectivePermissions}
          isAdmin={isAdmin}
          dismissedKeys={dismissedPopupKeys}
          onDismissKey={snoozePopupKey}
          onNavigateToSpecialOrders={(subTab) => {
            setActiveDowntimeTab('special_orders');
            setRequestedSpecialOrderSubTab(subTab);
          }}
        />

        <ShiftWeightOutputPopupAlert
          machines={machines}
          entries={entries}
          isEligibleUser={isShiftInChargeWeightCheckUser}
          manualOpenSlot={manualWeightCheckSlot}
          onCloseManual={() => setManualWeightCheckSlot(null)}
          onSaveEntry={handleSaveEntry}
          onOpenMachinesBoard={() => setActiveDowntimeTab('status')}
          currentUserName={user.displayName || currentReporter}
          currentUserEmail={user.email || ''}
        />
      </div>

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
