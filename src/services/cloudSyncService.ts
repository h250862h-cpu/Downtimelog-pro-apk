import {
  fetchPlantUsersDirectory,
  flushPendingPlantUsers,
  getPendingPlantUsersCount,
  isFirestorePathBlockedByRules,
  probeFirestoreCloudHealth,
  reconnectFirestoreNetwork,
  repairPendingPlantUsersQueue,
  resetFirestorePathAccessCache,
} from '../firebase';
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
} from '../types';
import { ParsedAttendanceMessage, QCInspectionRecord } from '../types/attendance';
import {
  flushPendingAttendanceBatches,
  flushPendingQCLogs,
  getAttendanceAndQcPendingBreakdown,
  pollAttendanceBatches,
  pollQCLogs,
  repairPendingAttendanceQueues,
} from './attendanceStore';
import {
  flushPendingDieselData,
  getDieselPendingBreakdown,
  pollDieselGrns,
  pollDieselRequests,
  pollDieselTank,
  repairPendingDieselQueues,
} from './dieselStore';
import {
  flushPendingDispatches,
  getLastDispatchSyncError,
  getPendingDispatchQueue,
  pollDispatchEntries,
  repairPendingDispatchQueue,
} from './dispatchStore';
import {
  flushPendingSyncQueue,
  getLastSyncError,
  getPendingSyncQueue,
  pollFirebaseEntries,
  pollMachineryConfig,
  repairPendingSyncQueue,
} from './downtimeStore';
import {
  flushPendingPowerGenData,
  getPowerGenPendingBreakdown,
  pollGeneratorLogs,
  pollPowerCutLogs,
  repairPendingPowerGenQueues,
} from './powerGenStore';
import {
  flushPendingProductionPlans,
  flushPendingUploadedBackgroundDispatches,
  getPlanningAndHistPendingBreakdown,
  pollProductionPlans,
  pollUploadedBackgroundDispatches,
  repairPendingPlanningQueues,
} from './productionPlanStore';
import {
  flushPendingQualityTrials,
  getQualityTrialsPendingBreakdown,
  pollQualityTrials,
  repairPendingQualityTrialQueues,
} from './qualityTrialStore';
import {
  flushPendingMaintenanceJobCards,
  getMaintenanceJobCardsPendingBreakdown,
  pollMaintenanceJobCards,
  repairPendingMaintenanceJobCardQueues,
} from './maintenanceJobCardStore';
import {
  flushAllPendingSopData,
  getSopPendingBreakdown,
  pollSopHandovers,
  pollSopMixing,
  pollSopProduction,
  pollSopQc,
  pollSopScrap,
  repairAllSopPendingQueues,
} from './sopStore';
import {
  flushPendingSpecialOrderData,
  getSpecialOrderPendingBreakdown,
  pollSpecialOrderProductions,
  pollSpecialOrders,
  pollSpecialOrderWhDispatches,
  repairPendingSpecialOrderQueues,
} from './specialOrderStore';

export interface PendingSyncBreakdown {
  downtime: number;
  dispatch: number;
  sop: number;
  diesel: number;
  powerGen: number;
  planningAndHist: number;
  attendanceAndQc: number;
  specialOrders: number;
  qualityTrials: number;
  maintenanceJobCards: number;
  plantUsers: number;
  ruleBlockedPending: number;
  totalPending: number;
}

export interface CloudSyncDiagnosticsResult {
  ok: boolean;
  checkedAtIso: string;
  latencyMs: number;
  authEmail: string | null;
  error?: string;
  flushedTotal: number;
  pendingBefore: PendingSyncBreakdown;
  pendingAfter: PendingSyncBreakdown;
  counts: {
    downtime: number;
    machines: number;
    dispatch: number;
    specialOrders: number;
    specialOrderProd: number;
    specialOrderWh: number;
    trials: number;
    maintenanceJobCards: number;
    sopProd: number;
    sopQc: number;
    sopScrap: number;
    sopMixing: number;
    sopHandover: number;
    dieselReqs: number;
    dieselGrns: number;
    powerCuts: number;
    generatorLogs: number;
    plans: number;
    attendance: number;
    users: number;
  };
  data: {
    entries: DowntimeEntry[];
    machines: string[];
    dispatches: DispatchEntry[];
    sopProduction: SopProductionRecord[];
    sopQc: SopQcRecord[];
    sopScrap: SopScrapRecord[];
    sopMixing: SopMixingReport[];
    sopHandovers: SopShiftHandoverRecord[];
    histDispatches: DispatchEntry[];
    plans: ProductionPlanItem[];
    dieselTank: DieselTankConfig;
    dieselRequests: DieselFuelRequest[];
    dieselGrns: DieselGrnRecord[];
    powerCutLogs: PowerCutLog[];
    generatorLogs: GeneratorLog[];
    specialOrders: SpecialOrder[];
    specialOrderProductions: SpecialOrderFactoryProduction[];
    specialOrderWhDispatches: SpecialOrderWhDispatch[];
    qualityTrials: QualityTrialReport[];
    maintenanceJobCards: MaintenanceJobCard[];
    attendanceBatches: ParsedAttendanceMessage[];
    qcLogs: QCInspectionRecord[];
    plantUsers: PlantUserAccount[];
  };
}

/**
 * Automatically heals stuck pending-sync queues on any device:
 * removes SEED- entries, deleted/orphan IDs, duplicates, and items already marked synced.
 */
export function repairAllPendingSyncQueues(): number {
  const repairedTotal =
    repairPendingSyncQueue() +
    repairPendingDispatchQueue() +
    repairPendingAttendanceQueues() +
    repairAllSopPendingQueues() +
    repairPendingDieselQueues() +
    repairPendingPowerGenQueues() +
    repairPendingPlanningQueues() +
    repairPendingSpecialOrderQueues() +
    repairPendingQualityTrialQueues() +
    repairPendingMaintenanceJobCardQueues() +
    repairPendingPlantUsersQueue();
  return repairedTotal;
}

export function getUnifiedPendingQueueBreakdown(): PendingSyncBreakdown {
  const downtimeRaw = getPendingSyncQueue().length;
  const downtime = isFirestorePathBlockedByRules('downtime_entries') ? 0 : downtimeRaw;
  const dispatchRaw = getPendingDispatchQueue().length;
  const dispatch = isFirestorePathBlockedByRules('dispatch_entries') ? 0 : dispatchRaw;
  const sopB = getSopPendingBreakdown();
  const dieselB = getDieselPendingBreakdown();
  const powerGenB = getPowerGenPendingBreakdown();
  const planHistB = getPlanningAndHistPendingBreakdown();
  const attQcB = getAttendanceAndQcPendingBreakdown();
  const specialB = getSpecialOrderPendingBreakdown();
  const trialsB = getQualityTrialsPendingBreakdown();
  const mntCardsB = getMaintenanceJobCardsPendingBreakdown();
  const plantUsersRaw = getPendingPlantUsersCount();
  const plantUsers = isFirestorePathBlockedByRules('plant_users') ? 0 : plantUsersRaw;

  const ruleBlockedPending =
    (isFirestorePathBlockedByRules('downtime_entries') ? downtimeRaw : 0) +
    (isFirestorePathBlockedByRules('dispatch_entries') ? dispatchRaw : 0) +
    (isFirestorePathBlockedByRules('plant_users') ? plantUsersRaw : 0) +
    sopB.ruleBlocked +
    dieselB.ruleBlocked +
    powerGenB.ruleBlocked +
    planHistB.ruleBlocked +
    attQcB.ruleBlocked +
    specialB.ruleBlocked +
    trialsB.ruleBlocked +
    mntCardsB.ruleBlocked;

  return {
    downtime,
    dispatch,
    sop: sopB.active,
    diesel: dieselB.active,
    powerGen: powerGenB.active,
    planningAndHist: planHistB.active,
    attendanceAndQc: attQcB.active,
    specialOrders: specialB.active,
    qualityTrials: trialsB.active,
    maintenanceJobCards: mntCardsB.active,
    plantUsers,
    ruleBlockedPending,
    totalPending:
      downtime +
      dispatch +
      sopB.active +
      dieselB.active +
      powerGenB.active +
      planHistB.active +
      attQcB.active +
      specialB.active +
      trialsB.active +
      mntCardsB.active +
      plantUsers,
  };
}

/**
 * Forces a full Firestore network wake-up, auto-repairs stuck device outbox queues,
 * flushes all queued mobile/desktop offline writes across every plant module,
 * and pulls fresh server-side snapshots (`getDocsFromServer`).
 */
export async function runFullCloudSyncNow(
  forceRefresh: boolean = false
): Promise<CloudSyncDiagnosticsResult> {
  if (forceRefresh) {
    resetFirestorePathAccessCache();
  }
  repairAllPendingSyncQueues();
  const pendingBefore = getUnifiedPendingQueueBreakdown();
  await reconnectFirestoreNetwork(false).catch(() => false);
  const health = await probeFirestoreCloudHealth();

  const flushCounts = await Promise.all([
    flushPendingSyncQueue().catch(() => 0),
    flushPendingDispatches().catch(() => 0),
    flushPendingAttendanceBatches().catch(() => 0),
    flushPendingQCLogs()
      .then((r) => r.success)
      .catch(() => 0),
    flushAllPendingSopData().catch(() => 0),
    flushPendingUploadedBackgroundDispatches().catch(() => 0),
    flushPendingProductionPlans().catch(() => 0),
    flushPendingDieselData().catch(() => 0),
    flushPendingPowerGenData().catch(() => 0),
    flushPendingSpecialOrderData().catch(() => 0),
    flushPendingQualityTrials().catch(() => 0),
    flushPendingMaintenanceJobCards().catch(() => 0),
    flushPendingPlantUsers().catch(() => 0),
  ]);
  const flushedTotal = flushCounts.reduce((s, n) => s + (Number(n) || 0), 0);

  const [
    entries,
    machines,
    dispatches,
    sopProduction,
    sopQc,
    sopScrap,
    sopMixing,
    sopHandovers,
    histDispatches,
    plans,
    dieselTank,
    dieselRequests,
    dieselGrns,
    powerCutLogs,
    generatorLogs,
    specialOrders,
    specialOrderProductions,
    specialOrderWhDispatches,
    qualityTrials,
    maintenanceJobCards,
    attendanceBatches,
    qcLogs,
    plantUsers,
  ] = await Promise.all([
    pollFirebaseEntries(),
    pollMachineryConfig(),
    pollDispatchEntries(),
    pollSopProduction(),
    pollSopQc(),
    pollSopScrap(),
    pollSopMixing(),
    pollSopHandovers(),
    pollUploadedBackgroundDispatches(),
    pollProductionPlans(),
    pollDieselTank(),
    pollDieselRequests(),
    pollDieselGrns(),
    pollPowerCutLogs(),
    pollGeneratorLogs(),
    pollSpecialOrders(),
    pollSpecialOrderProductions(),
    pollSpecialOrderWhDispatches(),
    pollQualityTrials(),
    pollMaintenanceJobCards(),
    pollAttendanceBatches(),
    pollQCLogs(),
    fetchPlantUsersDirectory(),
  ]);

  repairAllPendingSyncQueues();
  const pendingMid = getUnifiedPendingQueueBreakdown();
  let extraFlushed = 0;
  if (pendingMid.totalPending > 0 && health.ok) {
    const flushPass2 = await Promise.all([
      flushPendingSyncQueue().catch(() => 0),
      flushPendingDispatches().catch(() => 0),
      flushPendingAttendanceBatches().catch(() => 0),
      flushPendingQCLogs()
        .then((r) => r.success)
        .catch(() => 0),
      flushAllPendingSopData().catch(() => 0),
      flushPendingUploadedBackgroundDispatches().catch(() => 0),
      flushPendingProductionPlans().catch(() => 0),
      flushPendingDieselData().catch(() => 0),
      flushPendingPowerGenData().catch(() => 0),
      flushPendingSpecialOrderData().catch(() => 0),
      flushPendingQualityTrials().catch(() => 0),
      flushPendingMaintenanceJobCards().catch(() => 0),
      flushPendingPlantUsers().catch(() => 0),
    ]);
    extraFlushed = flushPass2.reduce((s, n) => s + (Number(n) || 0), 0);
    repairAllPendingSyncQueues();
  }

  const totalFlushed = flushedTotal + extraFlushed;
  const pendingAfter = getUnifiedPendingQueueBreakdown();
  const storeErr = getLastSyncError() || getLastDispatchSyncError();
  const combinedErr = !health.ok ? health.error || storeErr || 'Cloud server unreachable' : storeErr || undefined;

  return {
    ok: health.ok && !storeErr,
    checkedAtIso: new Date().toISOString(),
    latencyMs: health.latencyMs,
    authEmail: health.authEmail,
    error: combinedErr,
    flushedTotal: totalFlushed,
    pendingBefore,
    pendingAfter,
    counts: {
      downtime: entries.length,
      machines: machines.length,
      dispatch: dispatches.length,
      specialOrders: specialOrders.length,
      specialOrderProd: specialOrderProductions.length,
      specialOrderWh: specialOrderWhDispatches.length,
      trials: qualityTrials.length,
      maintenanceJobCards: maintenanceJobCards.length,
      sopProd: sopProduction.length,
      sopQc: sopQc.length,
      sopScrap: sopScrap.length,
      sopMixing: sopMixing.length,
      sopHandover: sopHandovers.length,
      dieselReqs: dieselRequests.length,
      dieselGrns: dieselGrns.length,
      powerCuts: powerCutLogs.length,
      generatorLogs: generatorLogs.length,
      plans: plans.length,
      attendance: attendanceBatches.length,
      users: plantUsers.length,
    },
    data: {
      entries,
      machines,
      dispatches,
      sopProduction,
      sopQc,
      sopScrap,
      sopMixing,
      sopHandovers,
      histDispatches,
      plans,
      dieselTank,
      dieselRequests,
      dieselGrns,
      powerCutLogs,
      generatorLogs,
      specialOrders,
      specialOrderProductions,
      specialOrderWhDispatches,
      qualityTrials,
      maintenanceJobCards,
      attendanceBatches,
      qcLogs,
      plantUsers,
    },
  };
}
