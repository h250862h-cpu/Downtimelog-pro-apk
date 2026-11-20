import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import {
  db,
  deepSanitizeForFirestore,
  ensureFirebaseAuth,
  getCollectionDocsServerFirst,
} from '../firebase';
import { DowntimeEntry, GeneratorLog, PowerCutLog } from '../types';
import { dtl, fmtT, r2, saveFileBlob, toTimestamp } from './downtimeCalc';
import { getStoredEntries, saveStoredEntries, syncEntryToFirebase } from './downtimeStore';

const POWER_CUT_KEY = 'lgplast_power_cut_logs_v1';
const POWER_CUT_PENDING_KEY = 'lgplast_power_cut_pending_v1';
const POWER_CUT_COLLECTION = 'power_cut_logs';

const GENERATOR_LOG_KEY = 'lgplast_generator_logs_v1';
const GENERATOR_LOG_PENDING_KEY = 'lgplast_generator_logs_pending_v1';
const GENERATOR_LOG_COLLECTION = 'generator_logs';

// ======================================================
// DURATION & TIME HELPERS
// ======================================================
export function calcDurationMinutes(startIso: string, endIso?: string): number {
  if (!startIso) return 0;
  const startMs = toTimestamp(startIso);
  const endMs = endIso && endIso.trim() ? toTimestamp(endIso) : Date.now();
  if (!startMs || !endMs || endMs <= startMs) return 0;
  return Math.max(0, Math.round((endMs - startMs) / 60000));
}

export function formatDurationHm(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes || 0));
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs === 0) return `${rem}m`;
  return `${hrs}h ${String(rem).padStart(2, '0')}m`;
}

export function extractTimeLabel(dtLocal?: string): string {
  if (!dtLocal) return '—';
  const s = dtLocal.trim();
  const tIdx = s.indexOf('T');
  if (tIdx >= 0) return s.slice(tIdx + 1, tIdx + 6);
  if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
  return fmtT(s);
}

// ======================================================
// LOCAL & QUEUE HELPERS
// ======================================================
function readList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, items: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch (e) {
    console.warn(`Failed saving ${key}:`, e);
  }
}

function readQueue(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function addToQueue(key: string, id: string) {
  try {
    const q = readQueue(key);
    if (!q.includes(id)) {
      q.push(id);
      localStorage.setItem(key, JSON.stringify(q));
    }
  } catch {}
}

function removeFromQueue(key: string, id: string) {
  try {
    localStorage.setItem(key, JSON.stringify(readQueue(key).filter((x) => x !== id)));
  } catch {}
}

function sanitizeObj<T extends Record<string, any>>(obj: T): Record<string, any> {
  return deepSanitizeForFirestore(obj);
}

function mergeById<T extends { id: string; upd?: number }>(local: T[], remote: T[]): T[] {
  const map: Record<string, T> = {};
  local.forEach((x) => {
    if (x?.id) map[x.id] = x;
  });
  remote.forEach((x) => {
    if (!x?.id) return;
    const prev = map[x.id];
    if (!prev || (x.upd || 0) >= (prev.upd || 0)) {
      map[x.id] = x;
    }
  });
  return Object.values(map).sort((a, b) => (b.upd || 0) - (a.upd || 0));
}

// ======================================================
// 1. POWER CUT LOGS STORE
// ======================================================
export function getLocalPowerCutLogs(): PowerCutLog[] {
  return readList<PowerCutLog>(POWER_CUT_KEY);
}

export async function savePowerCutLog(
  log: PowerCutLog,
  options?: { preserveUpd?: boolean }
): Promise<{ ok: boolean; saved: PowerCutLog; error?: string }> {
  const nowIso = new Date().toISOString();
  const durationMinutes = log.timeBack
    ? calcDurationMinutes(log.timeOut, log.timeBack)
    : 0;
  const saved: PowerCutLog = {
    ...log,
    durationMinutes,
    status: log.timeBack ? 'RESTORED' : 'ONGOING',
    updatedAt: options?.preserveUpd && log.updatedAt ? log.updatedAt : nowIso,
    upd: options?.preserveUpd && log.upd ? log.upd : Date.now(),
  };

  const merged = mergeById(getLocalPowerCutLogs(), [saved]);
  writeList(POWER_CUT_KEY, merged);

  try {
    await ensureFirebaseAuth();
    await setDoc(
      doc(db, POWER_CUT_COLLECTION, saved.id),
      sanitizeObj({ ...saved, sy: Date.now() }),
      { merge: true }
    );
    removeFromQueue(POWER_CUT_PENDING_KEY, saved.id);
    return { ok: true, saved };
  } catch (err: any) {
    addToQueue(POWER_CUT_PENDING_KEY, saved.id);
    return {
      ok: false,
      saved,
      error: err?.message || 'Offline cached; queued for cloud sync',
    };
  }
}

export async function closePowerCutLog(params: {
  log: PowerCutLog;
  timeBack: string;
  restoredBy: string;
  generatorUsed?: boolean;
  reason?: string;
}): Promise<{ ok: boolean; saved: PowerCutLog; error?: string }> {
  const updated: PowerCutLog = {
    ...params.log,
    timeBack: params.timeBack,
    durationMinutes: calcDurationMinutes(params.log.timeOut, params.timeBack),
    restoredBy: params.restoredBy,
    generatorUsed:
      typeof params.generatorUsed === 'boolean'
        ? params.generatorUsed
        : params.log.generatorUsed,
    reason: params.reason !== undefined ? params.reason : params.log.reason,
    status: 'RESTORED',
    updatedAt: new Date().toISOString(),
    upd: Date.now(),
  };
  return savePowerCutLog(updated);
}

export async function pollPowerCutLogs(): Promise<PowerCutLog[]> {
  try {
    await ensureFirebaseAuth();
    const snap = await getCollectionDocsServerFirst(collection(db, POWER_CUT_COLLECTION));
    const remote: PowerCutLog[] = [];
    snap.forEach((d) => remote.push(d.data() as PowerCutLog));
    const merged = mergeById(getLocalPowerCutLogs(), remote);
    writeList(POWER_CUT_KEY, merged);
    return merged;
  } catch {
    return getLocalPowerCutLogs();
  }
}

export function subscribePowerCutLogs(onUpdate: (logs: PowerCutLog[]) => void) {
  onUpdate(getLocalPowerCutLogs());
  let unsub: () => void = () => {};
  let cancelled = false;

  const start = async () => {
    await ensureFirebaseAuth();
    if (cancelled) return;
    try {
      unsub = onSnapshot(
        collection(db, POWER_CUT_COLLECTION),
        { includeMetadataChanges: true },
        (snap) => {
          const remote: PowerCutLog[] = [];
          snap.forEach((d) => remote.push(d.data() as PowerCutLog));
          const merged = mergeById(getLocalPowerCutLogs(), remote);
          writeList(POWER_CUT_KEY, merged);
          onUpdate(merged);
          if (!snap.metadata.fromCache) {
            flushPendingPowerGenData().catch(() => {});
          }
        },
        () => {}
      );
    } catch {}
  };
  start();

  return () => {
    cancelled = true;
    unsub();
  };
}

// ======================================================
// 2. GENERATOR START / STOP LOGS STORE + MACHINE LINKAGE
// ======================================================
export function getLocalGeneratorLogs(): GeneratorLog[] {
  return readList<GeneratorLog>(GENERATOR_LOG_KEY);
}

export async function saveGeneratorLog(
  log: GeneratorLog,
  options?: { preserveUpd?: boolean }
): Promise<{ ok: boolean; saved: GeneratorLog; error?: string }> {
  const stopLitresValid =
    typeof log.stopFuelLitres === 'number' && !Number.isNaN(log.stopFuelLitres);
  const fuelUsedLitres =
    log.stopTime && stopLitresValid
      ? r2(Math.max(0, log.startFuelLitres - (log.stopFuelLitres as number)))
      : log.fuelUsedLitres;
  const durationMinutes = log.stopTime
    ? calcDurationMinutes(log.startTime, log.stopTime)
    : 0;

  const saved: GeneratorLog = {
    ...log,
    fuelUsedLitres,
    durationMinutes,
    status: log.stopTime ? 'STOPPED' : 'RUNNING',
    updatedAt: options?.preserveUpd && log.updatedAt ? log.updatedAt : new Date().toISOString(),
    upd: options?.preserveUpd && log.upd ? log.upd : Date.now(),
  };

  const merged = mergeById(getLocalGeneratorLogs(), [saved]);
  writeList(GENERATOR_LOG_KEY, merged);

  try {
    await ensureFirebaseAuth();
    await setDoc(
      doc(db, GENERATOR_LOG_COLLECTION, saved.id),
      sanitizeObj({ ...saved, sy: Date.now() }),
      { merge: true }
    );
    removeFromQueue(GENERATOR_LOG_PENDING_KEY, saved.id);
    return { ok: true, saved };
  } catch (err: any) {
    addToQueue(GENERATOR_LOG_PENDING_KEY, saved.id);
    return {
      ok: false,
      saved,
      error: err?.message || 'Offline cached; queued for cloud sync',
    };
  }
}

/**
 * Syncs Generator start/stop data onto the linked 'Generator' machine record in downtimeStore
 * so Machine Status Board shows live Start Time, Start Fuel (L), Stop Time, Stop Fuel (L), Fuel Used (L).
 */
async function syncGeneratorToMachineBoardEntry(genLog: GeneratorLog): Promise<string> {
  const allEntries = getStoredEntries();
  const entryId = genLog.linkedDowntimeEntryId || `DT-GEN-${genLog.id}`;
  const existingIdx = allEntries.findIndex((e) => e.id === entryId);
  const startLabel = extractTimeLabel(genLog.startTime);
  const stopLabel = genLog.stopTime ? extractTimeLabel(genLog.stopTime) : '';
  const fuelSummary =
    genLog.status === 'STOPPED' && typeof genLog.stopFuelLitres === 'number'
      ? `Start: ${genLog.startFuelLitres} L → Stop: ${genLog.stopFuelLitres} L (Used: ${genLog.fuelUsedLitres ?? 0} L)`
      : `Running — Start Fuel: ${genLog.startFuelLitres} L`;

  const syncedEntry: DowntimeEntry = {
    ...(existingIdx >= 0 ? allEntries[existingIdx] : {}),
    id: entryId,
    m: 'Generator',
    cat: 'Running update',
    start: genLog.startTime,
    // Keep end set at stopTime when stopped so Generator is not stuck flagged as a plant breakdown
    end: genLog.stopTime || genLog.startTime,
    reason: `${genLog.reason || 'Factory standby power supply'} | ${fuelSummary}`,
    jcn: genLog.linkedPowerCutId ? `PWR-${genLog.linkedPowerCutId.slice(-6)}` : 'UT-GEN',
    jcp: genLog.status === 'RUNNING' ? 'In progress' : 'Finished',
    rep: genLog.stoppedByName || genLog.operatorName,
    by: genLog.stoppedByName || genLog.operatorName,
    operator: genLog.operatorName,
    shift: genLog.shift === 'Night' ? 'Night (19:30 - 07:30)' : 'Day (07:30 - 19:30)',
    outputPerHour: genLog.status === 'RUNNING' ? 'ON LOAD' : 'STANDBY',
    runningWeight:
      genLog.status === 'STOPPED' && typeof genLog.fuelUsedLitres === 'number'
        ? `Used ${genLog.fuelUsedLitres} L`
        : `${genLog.startFuelLitres} L Start`,
    genStartTime: startLabel,
    genStartFuel: r2(genLog.startFuelLitres),
    genOffTime: stopLabel || undefined,
    genOffFuel:
      typeof genLog.stopFuelLitres === 'number' ? r2(genLog.stopFuelLitres) : undefined,
    genFuelUnit: 'L',
    linkedGeneratorLogId: genLog.id,
    loggedBy: genLog.stoppedByName || genLog.operatorName,
    loggedByEmail: genLog.loggedByEmail,
    signature: genLog.stopSignature || genLog.signature,
    signedAt: new Date().toISOString(),
    upd: Date.now(),
    sy: 0,
  };

  let nextList: DowntimeEntry[];
  if (existingIdx >= 0) {
    nextList = [...allEntries];
    nextList[existingIdx] = syncedEntry;
  } else {
    nextList = [syncedEntry, ...allEntries];
  }
  saveStoredEntries(nextList);
  await syncEntryToFirebase(syncedEntry).catch(() => {});
  return entryId;
}

export async function logGeneratorStart(params: {
  date: string;
  shift: 'Day' | 'Night';
  startTime: string;
  startFuelLitres: number;
  linkedPowerCutId?: string;
  reason?: string;
  operatorName: string;
  loggedByEmail: string;
  signature?: string;
  notes?: string;
}): Promise<{
  ok: boolean;
  saved: GeneratorLog;
  onSyncMachineBoard?: () => void;
  error?: string;
}> {
  const id = `GEN-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
  const nowIso = new Date().toISOString();
  const baseLog: GeneratorLog = {
    id,
    date: params.date,
    shift: params.shift,
    startTime: params.startTime,
    startFuelLitres: r2(params.startFuelLitres),
    stopTime: '',
    durationMinutes: 0,
    linkedPowerCutId: params.linkedPowerCutId || undefined,
    linkedDowntimeEntryId: `DT-GEN-${id}`,
    reason: params.reason?.trim() || 'Power Backup / Mains Outage',
    operatorName: params.operatorName.trim(),
    signature: params.signature || undefined,
    notes: params.notes?.trim() || undefined,
    loggedByEmail: params.loggedByEmail,
    status: 'RUNNING',
    createdAt: nowIso,
    updatedAt: nowIso,
    upd: Date.now(),
  };

  await syncGeneratorToMachineBoardEntry(baseLog);
  const res = await saveGeneratorLog(baseLog);

  // Also flag linked ongoing power cut as Generator Used
  if (params.linkedPowerCutId) {
    const pwr = getLocalPowerCutLogs().find((p) => p.id === params.linkedPowerCutId);
    if (pwr) {
      await savePowerCutLog({
        ...pwr,
        generatorUsed: true,
        linkedGeneratorLogId: res.saved.id,
      }).catch(() => {});
    }
  }

  return res;
}

export async function logGeneratorStop(params: {
  log: GeneratorLog;
  stopTime: string;
  stopFuelLitres: number;
  stoppedByName: string;
  stopSignature?: string;
  notes?: string;
}): Promise<{ ok: boolean; saved: GeneratorLog; error?: string }> {
  const fuelUsedLitres = r2(Math.max(0, params.log.startFuelLitres - params.stopFuelLitres));
  const durationMinutes = calcDurationMinutes(params.log.startTime, params.stopTime);

  const updated: GeneratorLog = {
    ...params.log,
    stopTime: params.stopTime,
    stopFuelLitres: r2(params.stopFuelLitres),
    fuelUsedLitres,
    durationMinutes,
    stoppedByName: params.stoppedByName.trim(),
    stopSignature: params.stopSignature || params.log.stopSignature,
    notes: params.notes?.trim() || params.log.notes,
    status: 'STOPPED',
    updatedAt: new Date().toISOString(),
    upd: Date.now(),
  };

  await syncGeneratorToMachineBoardEntry(updated);
  return saveGeneratorLog(updated);
}

/**
 * Allows logging both Start Up + Stop together OR linking when logged directly from Machines Board ('Generator').
 */
export async function syncMachineFormToGeneratorLog(entry: DowntimeEntry): Promise<GeneratorLog | null> {
  if (entry.m.toLowerCase() !== 'generator') return null;
  const datePart = (entry.start || dtl(new Date())).slice(0, 10);
  const startDt = entry.genStartTime
    ? entry.genStartTime.includes('T')
      ? entry.genStartTime
      : `${datePart}T${entry.genStartTime}`
    : entry.start || dtl(new Date());
  const stopDt = entry.genOffTime
    ? entry.genOffTime.includes('T')
      ? entry.genOffTime
      : `${datePart}T${entry.genOffTime}`
    : entry.end && entry.end !== entry.start
    ? entry.end
    : '';

  const startFuelLitres =
    typeof entry.genStartFuel === 'number' && !Number.isNaN(entry.genStartFuel)
      ? r2(entry.genStartFuel)
      : 0;
  const stopFuelLitres =
    typeof entry.genOffFuel === 'number' && !Number.isNaN(entry.genOffFuel)
      ? r2(entry.genOffFuel)
      : undefined;

  const existing = entry.linkedGeneratorLogId
    ? getLocalGeneratorLogs().find((g) => g.id === entry.linkedGeneratorLogId)
    : undefined;

  const genLog: GeneratorLog = {
    id: existing?.id || `GEN-MACH-${entry.id}`,
    date: datePart,
    shift: entry.shift?.toLowerCase().includes('night') ? 'Night' : 'Day',
    startTime: startDt,
    startFuelLitres,
    stopTime: stopDt,
    stopFuelLitres,
    fuelUsedLitres:
      stopDt && typeof stopFuelLitres === 'number'
        ? r2(Math.max(0, startFuelLitres - stopFuelLitres))
        : undefined,
    durationMinutes: stopDt ? calcDurationMinutes(startDt, stopDt) : 0,
    linkedDowntimeEntryId: entry.id,
    reason: entry.reason || 'Logged from Generator Machine Card',
    operatorName: entry.operator || entry.rep || entry.loggedBy || 'Operator',
    stoppedByName: stopDt ? entry.rep || entry.loggedBy || 'Operator' : undefined,
    signature: entry.signature,
    loggedByEmail: entry.loggedByEmail || '',
    status: stopDt ? 'STOPPED' : 'RUNNING',
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    upd: Date.now(),
  };

  const res = await saveGeneratorLog(genLog);
  return res.saved;
}

export async function pollGeneratorLogs(): Promise<GeneratorLog[]> {
  try {
    await ensureFirebaseAuth();
    const snap = await getCollectionDocsServerFirst(collection(db, GENERATOR_LOG_COLLECTION));
    const remote: GeneratorLog[] = [];
    snap.forEach((d) => remote.push(d.data() as GeneratorLog));
    const merged = mergeById(getLocalGeneratorLogs(), remote);
    writeList(GENERATOR_LOG_KEY, merged);
    return merged;
  } catch {
    return getLocalGeneratorLogs();
  }
}

export function subscribeGeneratorLogs(onUpdate: (logs: GeneratorLog[]) => void) {
  onUpdate(getLocalGeneratorLogs());
  let unsub: () => void = () => {};
  let cancelled = false;

  const start = async () => {
    await ensureFirebaseAuth();
    if (cancelled) return;
    try {
      unsub = onSnapshot(
        collection(db, GENERATOR_LOG_COLLECTION),
        { includeMetadataChanges: true },
        (snap) => {
          const remote: GeneratorLog[] = [];
          snap.forEach((d) => remote.push(d.data() as GeneratorLog));
          const merged = mergeById(getLocalGeneratorLogs(), remote);
          writeList(GENERATOR_LOG_KEY, merged);
          onUpdate(merged);
          if (!snap.metadata.fromCache) {
            flushPendingPowerGenData().catch(() => {});
          }
        },
        () => {}
      );
    } catch {}
  };
  start();

  return () => {
    cancelled = true;
    unsub();
  };
}

export function getPendingPowerGenCount(): number {
  return readQueue(POWER_CUT_PENDING_KEY).length + readQueue(GENERATOR_LOG_PENDING_KEY).length;
}

export async function flushPendingPowerGenData(): Promise<number> {
  let flushed = 0;
  try {
    await ensureFirebaseAuth();
    const pwrQueue = readQueue(POWER_CUT_PENDING_KEY);
    if (pwrQueue.length) {
      const allPwr = getLocalPowerCutLogs();
      for (const id of pwrQueue) {
        const found = allPwr.find((x) => x.id === id);
        if (!found) {
          removeFromQueue(POWER_CUT_PENDING_KEY, id);
          continue;
        }
        try {
          await setDoc(
            doc(db, POWER_CUT_COLLECTION, found.id),
            sanitizeObj({ ...found, sy: Date.now() }),
            { merge: true }
          );
          removeFromQueue(POWER_CUT_PENDING_KEY, found.id);
          flushed++;
        } catch {}
      }
    }

    const genQueue = readQueue(GENERATOR_LOG_PENDING_KEY);
    if (genQueue.length) {
      const allGen = getLocalGeneratorLogs();
      for (const id of genQueue) {
        const found = allGen.find((x) => x.id === id);
        if (!found) {
          removeFromQueue(GENERATOR_LOG_PENDING_KEY, id);
          continue;
        }
        try {
          await setDoc(
            doc(db, GENERATOR_LOG_COLLECTION, found.id),
            sanitizeObj({ ...found, sy: Date.now() }),
            { merge: true }
          );
          removeFromQueue(GENERATOR_LOG_PENDING_KEY, found.id);
          flushed++;
        } catch {}
      }
    }
  } catch {}
  return flushed;
}

// ======================================================
// 3. ADMIN-ONLY EXCEL EXPORTS FOR POWER CUT & GENERATOR
// ======================================================
export function exportPowerCutExcel(
  logs: PowerCutLog[],
  fromDate: string,
  toDate: string,
  isAdmin: boolean
) {
  if (!isAdmin) return;
  const filtered = logs
    .filter((l) => (!fromDate || l.date >= fromDate) && (!toDate || l.date <= toDate))
    .sort((a, b) => (a.date + a.timeOut).localeCompare(b.date + b.timeOut));

  const totalMins = filtered.reduce(
    (s, l) => s + (l.status === 'RESTORED' ? l.durationMinutes : calcDurationMinutes(l.timeOut)),
    0
  );

  const aoa: (string | number)[][] = [
    ['LG PLAST — PLANT POWER CUT REPORT'],
    [`Period: ${fromDate || 'All'} to ${toDate || 'Latest'}`, `Generated: ${new Date().toLocaleString()}`],
    [
      'Total Power Cut Events',
      filtered.length,
      'Total Power Cut Duration',
      formatDurationHm(totalMins),
      'Total Hours',
      r2(totalMins / 60),
    ],
    [],
    [
      'Date',
      'Shift',
      'Time Out',
      'Time Back',
      'Duration (mins)',
      'Duration (hrs)',
      'Duration (H:M)',
      'Affected Area',
      'Generator Started?',
      'Status',
      'Reason / Notes',
      'Logged By',
      'Restored By',
    ],
  ];

  filtered.forEach((l) => {
    const mins = l.status === 'RESTORED' ? l.durationMinutes : calcDurationMinutes(l.timeOut);
    aoa.push([
      l.date,
      l.shift,
      extractTimeLabel(l.timeOut),
      l.timeBack ? extractTimeLabel(l.timeBack) : 'ONGOING',
      mins,
      r2(mins / 60),
      formatDurationHm(mins),
      l.affectedArea,
      l.generatorUsed ? 'Yes' : 'No',
      l.status,
      l.reason || '',
      l.loggedBy,
      l.restoredBy || '',
    ]);
  });

  aoa.push([
    'TOTAL POWER CUT DURATION',
    '',
    '',
    '',
    totalMins,
    r2(totalMins / 60),
    formatDurationHm(totalMins),
    `${filtered.length} incident(s)`,
    '',
    '',
    '',
    '',
    '',
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 13 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 15 },
    { wch: 14 },
    { wch: 14 },
    { wch: 24 },
    { wch: 18 },
    { wch: 12 },
    { wch: 30 },
    { wch: 20 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Power Cut Logs');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveFileBlob(
    `LGPLAST_Power_Cut_Report_${fromDate || 'All'}_to_${toDate || 'Latest'}.xlsx`,
    new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  );
}

export function exportGeneratorExcel(
  logs: GeneratorLog[],
  fromDate: string,
  toDate: string,
  isAdmin: boolean
) {
  if (!isAdmin) return;
  const filtered = logs
    .filter((l) => (!fromDate || l.date >= fromDate) && (!toDate || l.date <= toDate))
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));

  const totalMins = filtered.reduce(
    (s, l) => s + (l.status === 'STOPPED' ? l.durationMinutes : calcDurationMinutes(l.startTime)),
    0
  );
  const totalFuelLitres = r2(filtered.reduce((s, l) => s + (l.fuelUsedLitres || 0), 0));

  const aoa: (string | number)[][] = [
    ['LG PLAST — GENERATOR RUN & FUEL CONSUMPTION REPORT (LITRES)'],
    [`Period: ${fromDate || 'All'} to ${toDate || 'Latest'}`, `Generated: ${new Date().toLocaleString()}`],
    [
      'Total Generator Runs',
      filtered.length,
      'Total Run Duration',
      formatDurationHm(totalMins),
      'Total Fuel Used (L)',
      totalFuelLitres,
    ],
    [],
    [
      'Date',
      'Shift',
      'Time Started',
      'Start Fuel Level (L)',
      'Time Stopped',
      'Stop Fuel Level (L)',
      'Fuel Used (L)',
      'Run Duration (hrs)',
      'Run Duration (H:M)',
      'Status',
      'Power Cut / Reason',
      'Started By',
      'Stopped By',
      'Notes',
    ],
  ];

  filtered.forEach((l) => {
    const mins = l.status === 'STOPPED' ? l.durationMinutes : calcDurationMinutes(l.startTime);
    aoa.push([
      l.date,
      l.shift,
      extractTimeLabel(l.startTime),
      r2(l.startFuelLitres),
      l.stopTime ? extractTimeLabel(l.stopTime) : 'RUNNING',
      typeof l.stopFuelLitres === 'number' ? r2(l.stopFuelLitres) : '',
      typeof l.fuelUsedLitres === 'number' ? r2(l.fuelUsedLitres) : '',
      r2(mins / 60),
      formatDurationHm(mins),
      l.status,
      l.reason || '',
      l.operatorName,
      l.stoppedByName || '',
      l.notes || '',
    ]);
  });

  aoa.push([
    'TOTAL GENERATOR USAGE',
    '',
    '',
    '',
    '',
    '',
    totalFuelLitres,
    r2(totalMins / 60),
    formatDurationHm(totalMins),
    `${filtered.length} run(s)`,
    '',
    '',
    '',
    '',
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 13 },
    { wch: 10 },
    { wch: 13 },
    { wch: 18 },
    { wch: 13 },
    { wch: 18 },
    { wch: 15 },
    { wch: 16 },
    { wch: 16 },
    { wch: 12 },
    { wch: 28 },
    { wch: 18 },
    { wch: 18 },
    { wch: 26 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Generator Logs');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveFileBlob(
    `LGPLAST_Generator_Report_${fromDate || 'All'}_to_${toDate || 'Latest'}.xlsx`,
    new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  );
}
