import {
  fetchPlantUsersDirectory,
  probeFirestoreCloudHealth,
  reconnectFirestoreNetwork,
} from '../firebase';
import {
  DieselFuelRequest,
  DieselGrnRecord,
  DieselTankConfig,
  DispatchEntry,
  DowntimeEntry,
  GeneratorLog,
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
  getPendingAttendanceCount,
  pollAttendanceBatches,
  pollQCLogs,
} from './attendanceStore';
import {
  flushPendingDieselData,
  getPendingDieselCount,
  pollDieselGrns,
  pollDieselRequests,
  pollDieselTank,
} from './dieselStore';
import {
  flushPendingDispatches,
  getLastDispatchSyncError,
  getPendingDispatchQueue,
  pollDispatchEntries,
} from './dispatchStore';
import {
  flushPendingSyncQueue,
  getLastSyncError,
  getPendingSyncQueue,
  pollFirebaseEntries,
  pollMachineryConfig,
} from './downtimeStore';
import {
  flushPendingPowerGenData,
  getPendingPowerGenCount,
  pollGeneratorLogs,
  pollPowerCutLogs,
} from './powerGenStore';
import {
  flushPendingProductionPlans,
  flushPendingUploadedBackgroundDispatches,
  getPendingPlanningAndHistCount,
  pollProductionPlans,
  pollUploadedBackgroundDispatches,
} from './productionPlanStore';
import {
  flushPendingQualityTrials,
  getPendingQualityTrialsCount,
  pollQualityTrials,
} from './qualityTrialStore';
import {
  flushAllPendingSopData,
  getTotalPendingSopCount,
  pollSopHandovers,
  pollSopMixing,
  pollSopProduction,
  pollSopQc,
  pollSopScrap,
} from './sopStore';
import {
  flushPendingSpecialOrderData,
  getPendingSpecialOrderCount,
  pollSpecialOrderProductions,
  pollSpecialOrders,
  pollSpecialOrderWhDispatches,
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
    attendanceBatches: ParsedAttendanceMessage[];
    qcLogs: QCInspectionRecord[];
    plantUsers: PlantUserAccount[];
  };
}

export function getUnifiedPendingQueueBreakdown(): PendingSyncBreakdown {
  const downtime = getPendingSyncQueue().length;
  const dispatch = getPendingDispatchQueue().length;
  const sop = getTotalPendingSopCount();
  const diesel = getPendingDieselCount();
  const powerGen = getPendingPowerGenCount();
  const planningAndHist = getPendingPlanningAndHistCount();
  const attendanceAndQc = getPendingAttendanceCount();
  const specialOrders = getPendingSpecialOrderCount();
  const qualityTrials = getPendingQualityTrialsCount();

  return {
    downtime,
    dispatch,
    sop,
    diesel,
    powerGen,
    planningAndHist,
    attendanceAndQc,
    specialOrders,
    qualityTrials,
    totalPending:
      downtime +
      dispatch +
      sop +
      diesel +
      powerGen +
      planningAndHist +
      attendanceAndQc +
      specialOrders +
      qualityTrials,
  };
}

/**
 * Forces a full Firestore network wake-up, flushes all queued mobile/desktop offline writes
 * across every plant module, and pulls fresh server-side snapshots (`getDocsFromServer`).
 */
export async function runFullCloudSyncNow(): Promise<CloudSyncDiagnosticsResult> {
  const pendingBefore = getUnifiedPendingQueueBreakdown();
  await reconnectFirestoreNetwork().catch(() => false);
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
    pollAttendanceBatches(),
    pollQCLogs(),
    fetchPlantUsersDirectory(),
  ]);

  const pendingAfter = getUnifiedPendingQueueBreakdown();
  const storeErr = getLastSyncError() || getLastDispatchSyncError();
  const combinedErr = !health.ok ? health.error || storeErr || 'Cloud server unreachable' : storeErr || undefined;

  return {
    ok: health.ok && !storeErr,
    checkedAtIso: new Date().toISOString(),
    latencyMs: health.latencyMs,
    authEmail: health.authEmail,
    error: combinedErr,
    flushedTotal,
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
      attendanceBatches,
      qcLogs,
      plantUsers,
    },
  };
}
