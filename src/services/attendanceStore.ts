import {
  collection,
  doc,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import historicalAttendanceRaw from '../data/historicalAttendance.json';
import {
  canAccessFirestorePath,
  db,
  deepSanitizeForFirestore,
  ensureFirebaseAuth,
  getCollectionDocsServerFirst,
  isFirestorePathBlockedByRules,
  isPermissionDeniedError,
  markFirestorePathBlockedByRules,
} from '../firebase';
import { normalizeMachineName } from '../types';
import { AttendancePerson, ParsedAttendanceMessage, QCInspectionRecord } from '../types/attendance';

const LEGACY_ATT_STORAGE_KEY = 'attlog_batch_v2';
const ATT_CUSTOM_STORAGE_KEY = 'attlog_custom_v3';
const ATT_PENDING_KEY = 'attlog_pending_sync_v1';
const QC_STORAGE_KEY = 'qclog_batch_v1';

export const HISTORICAL_LAST_DATE = '2026-11-06';
export const HISTORICAL_CONTINUATION_DATE = '2026-11-07';

interface CompactHistoricalAttendance {
  sec: string[];
  desig: string[];
  rep: string[];
  batches: Array<
    [
      string, // date YYYY-MM-DD
      'D' | 'N' | 'U', // shift code
      number, // reporter index
      Array<
        [
          number, // section index
          string, // name
          string, // id
          0 | 1, // 1 = Casual, 0 = Employee
          0 | 1, // 1 = Absent, 0 = Present
          number, // count
          number, // designation index
          string? // optional remark
        ]
      >
    ]
  >;
}

let cachedHistoricalBatches: ParsedAttendanceMessage[] | null = null;

export function getHistoricalAttendanceBatches(): ParsedAttendanceMessage[] {
  if (cachedHistoricalBatches) return cachedHistoricalBatches;

  const data = historicalAttendanceRaw as unknown as CompactHistoricalAttendance;
  const decoded: ParsedAttendanceMessage[] = (data.batches || []).map(([date, shiftCode, repIdx, rawRows]) => {
    const shift: 'Day' | 'Night' | 'Unknown' =
      shiftCode === 'N' ? 'Night' : shiftCode === 'D' ? 'Day' : 'Unknown';
    const rows: AttendancePerson[] = rawRows.map(([secIdx, name, id, isCas, isAbs, count, desigIdx, remark]) => {
      const designation = data.desig[desigIdx] || '';
      const row: AttendancePerson = {
        section: data.sec[secIdx] || 'General',
        name,
        id,
        type: isCas ? 'Casual' : 'Employee',
        status: isAbs ? 'Absent' : 'Present',
        count: count || 1,
      };
      if (designation) row.designation = designation;
      if (remark) row.remark = remark;
      return row;
    });

    return {
      id: `ATT-HIST-${date}-${shift}`,
      date,
      shift,
      reportedBy: data.rep[repIdx] || '',
      msgs: 1,
      rows,
      skipped: [],
      isHistorical: true,
      createdAt: new Date(`${date}T${shift === 'Night' ? '19:30:00' : '07:30:00'}Z`).getTime() || 1700000000000,
    };
  });

  cachedHistoricalBatches = decoded;
  return cachedHistoricalBatches;
}

function batchKey(b: Pick<ParsedAttendanceMessage, 'date' | 'shift'>): string {
  return `${b.date}|${b.shift || 'Unknown'}`;
}

function sortAttendanceBatchesDesc(list: ParsedAttendanceMessage[]): ParsedAttendanceMessage[] {
  const shiftRank = (s: string) => (s === 'Night' ? 0 : s === 'Day' ? 1 : 2);
  return [...list].sort(
    (a, b) => b.date.localeCompare(a.date) || shiftRank(a.shift) - shiftRank(b.shift)
  );
}

function sanitizeAttendanceForFirestore(item: ParsedAttendanceMessage): Record<string, any> {
  const cleanRows = (item.rows || []).map((r) => {
    const out: Record<string, any> = {
      section: r.section || 'General',
      name: r.name || '',
      id: r.id || '',
      type: r.type === 'Casual' ? 'Casual' : 'Employee',
      status: r.status === 'Absent' ? 'Absent' : 'Present',
      count: typeof r.count === 'number' && !Number.isNaN(r.count) ? r.count : 1,
    };
    if (r.remark !== undefined && r.remark !== '') out.remark = r.remark;
    if (r.designation !== undefined && r.designation !== '') out.designation = r.designation;
    return out;
  });

  const payload: Record<string, any> = {
    id: item.id || `ATT-${item.date}-${item.shift}-${Date.now()}`,
    date: item.date,
    shift: item.shift || 'Unknown',
    reportedBy: item.reportedBy || '',
    rows: cleanRows,
    skipped: Array.isArray(item.skipped) ? item.skipped : [],
    msgs: item.msgs || 1,
    createdAt: item.createdAt || Date.now(),
    isHistorical: false,
  };
  if (item.loggedBy) payload.loggedBy = item.loggedBy;
  if (item.loggedByEmail) payload.loggedByEmail = item.loggedByEmail;
  if (item.claimed) payload.claimed = item.claimed;
  if (item.rawText) payload.rawText = item.rawText;
  return deepSanitizeForFirestore(payload);
}

function getPendingAttendanceQueue(): ParsedAttendanceMessage[] {
  try {
    const raw = localStorage.getItem(ATT_PENDING_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x) => x && x.id !== 'ATT-SAMPLE-01') : [];
    }
  } catch {}
  return [];
}

function savePendingAttendanceQueue(items: ParsedAttendanceMessage[]) {
  try {
    localStorage.setItem(ATT_PENDING_KEY, JSON.stringify(items));
  } catch {}
}

function enqueuePendingAttendance(item: ParsedAttendanceMessage) {
  const cleanItem: ParsedAttendanceMessage = { ...item, isHistorical: false };
  const queue = getPendingAttendanceQueue();
  const idx = queue.findIndex((q) => q.id === cleanItem.id || batchKey(q) === batchKey(cleanItem));
  if (idx >= 0) queue[idx] = cleanItem;
  else queue.unshift(cleanItem);
  savePendingAttendanceQueue(queue);
}

function removePendingAttendance(id: string) {
  const queue = getPendingAttendanceQueue().filter((q) => q.id !== id);
  savePendingAttendanceQueue(queue);
}

export function repairPendingAttendanceQueues(): number {
  const queue = getPendingAttendanceQueue();
  const seen = new Set<string>();
  const cleaned = queue.filter((q) => {
    if (!q || !q.id || !q.date || q.id === 'ATT-SAMPLE-01' || q.isHistorical || seen.has(q.id)) {
      return false;
    }
    seen.add(q.id);
    return true;
  });
  if (cleaned.length !== queue.length) {
    savePendingAttendanceQueue(cleaned);
  }
  return cleaned.length;
}

function clearSyncedFromAttendanceQueue(remoteList: ParsedAttendanceMessage[]) {
  const queue = getPendingAttendanceQueue();
  if (!queue.length || !remoteList.length) return;
  const byId = new Map(remoteList.map((r) => [r.id, r]));
  const byKey = new Map(remoteList.map((r) => [batchKey(r), r]));
  const remaining = queue.filter((pendingItem) => {
    const match = byId.get(pendingItem.id) || byKey.get(batchKey(pendingItem));
    if (match && (match.createdAt || 0) >= (pendingItem.createdAt || 0)) {
      return false;
    }
    return true;
  });
  if (remaining.length !== queue.length) {
    savePendingAttendanceQueue(remaining);
  }
}

function getCustomLocalAttendanceBatches(): ParsedAttendanceMessage[] {
  const collected: ParsedAttendanceMessage[] = [];
  try {
    const rawCustom = localStorage.getItem(ATT_CUSTOM_STORAGE_KEY);
    if (rawCustom) {
      const parsed = JSON.parse(rawCustom);
      if (Array.isArray(parsed)) {
        parsed.forEach((b) => {
          if (b && b.id !== 'ATT-SAMPLE-01' && !b.isHistorical) {
            collected.push(b);
          }
        });
      }
    }
    // One-time non-destructive migration of any real phased shifts saved in legacy storage key
    const rawLegacy = localStorage.getItem(LEGACY_ATT_STORAGE_KEY);
    if (rawLegacy) {
      const legacyParsed = JSON.parse(rawLegacy);
      if (Array.isArray(legacyParsed)) {
        let migratedAny = false;
        legacyParsed.forEach((b) => {
          if (b && b.id !== 'ATT-SAMPLE-01' && !b.isHistorical && !b.id?.startsWith('ATT-HIST-')) {
            if (!collected.some((c) => c.id === b.id || batchKey(c) === batchKey(b))) {
              collected.push({ ...b, isHistorical: false });
              migratedAny = true;
            }
          }
        });
        if (migratedAny) {
          localStorage.setItem(ATT_CUSTOM_STORAGE_KEY, JSON.stringify(collected));
        }
      }
      localStorage.removeItem(LEGACY_ATT_STORAGE_KEY);
    }
  } catch (e) {
    console.warn('Failed reading custom attendance batches from local storage:', e);
  }
  return collected;
}

/**
 * Merges static historical CSV batches (background archive up to 2026-11-06)
 * cleanly with live custom/phased/remote batches without ever dropping or
 * disturbing batches submitted from other devices.
 */
export function mergeAttendanceBatches(
  overlayBatches: ParsedAttendanceMessage[]
): ParsedAttendanceMessage[] {
  const map = new Map<string, ParsedAttendanceMessage>();

  // 1. Seed base historical records in memory
  getHistoricalAttendanceBatches().forEach((hist) => {
    map.set(batchKey(hist), {
      ...hist,
      rows: hist.rows.map((r) => ({ ...r })),
    });
  });

  // 2. Overlay custom, offline-queued, and remote multi-device batches
  overlayBatches.forEach((incoming) => {
    if (!incoming || !incoming.date || incoming.id === 'ATT-SAMPLE-01') return;
    const key = batchKey(incoming);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, incoming);
      return;
    }
    if (existing.isHistorical && !incoming.isHistorical) {
      map.set(key, incoming);
      return;
    }
    if ((incoming.createdAt || 0) >= (existing.createdAt || 0)) {
      map.set(key, incoming);
    }
  });

  return sortAttendanceBatchesDesc(Array.from(map.values()));
}

export function getLocalAttendanceBatch(): ParsedAttendanceMessage[] {
  const custom = getCustomLocalAttendanceBatches();
  const pending = getPendingAttendanceQueue();
  return mergeAttendanceBatches([...custom, ...pending]);
}

export function saveLocalAttendanceBatch(batch: ParsedAttendanceMessage[]) {
  try {
    // Only persist new/edited/synced non-historical shifts to localStorage to stay well under mobile quota
    const customOnly = batch
      .filter((b) => b && b.id !== 'ATT-SAMPLE-01' && !b.isHistorical)
      .map((b) => ({ ...b, isHistorical: false }));
    localStorage.setItem(ATT_CUSTOM_STORAGE_KEY, JSON.stringify(customOnly));
  } catch (e) {
    console.warn('Failed saving custom attendance to local storage:', e);
  }
}

export async function pollAttendanceBatches(): Promise<ParsedAttendanceMessage[]> {
  try {
    await ensureFirebaseAuth().catch(() => false);
    const snapshot = await getCollectionDocsServerFirst(collection(db, 'attendance_batches'));
    const remoteList: ParsedAttendanceMessage[] = [];
    snapshot.forEach((snap) => {
      const data = snap.data() as ParsedAttendanceMessage;
      if (snap.id !== 'ATT-SAMPLE-01' && data?.date) {
        remoteList.push({ ...data, id: snap.id, isHistorical: false });
      }
    });
    const localCustom = getCustomLocalAttendanceBatches();
    const pending = getPendingAttendanceQueue();
    const merged = mergeAttendanceBatches([...localCustom, ...remoteList, ...pending]);
    saveLocalAttendanceBatch(merged);
    clearSyncedFromAttendanceQueue(remoteList);
    return merged;
  } catch {
    return getLocalAttendanceBatch();
  }
}

export function subscribeAttendanceBatches(
  onUpdate: (batch: ParsedAttendanceMessage[]) => void
) {
  onUpdate(getLocalAttendanceBatch());

  let unsub: (() => void) | null = null;
  let cancelled = false;

  const start = async () => {
    await ensureFirebaseAuth().catch(() => false);
    if (cancelled) return;
    if (!(await canAccessFirestorePath('attendance_batches', false))) return;
    if (cancelled) return;

    const colRef = collection(db, 'attendance_batches');
    unsub = onSnapshot(
      colRef,
      { includeMetadataChanges: true },
      (snapshot) => {
        const remoteList: ParsedAttendanceMessage[] = [];
        snapshot.forEach((snap) => {
          const data = snap.data() as ParsedAttendanceMessage;
          if (snap.id !== 'ATT-SAMPLE-01' && data?.date) {
            remoteList.push({ ...data, id: snap.id, isHistorical: false });
          }
        });

        const localCustom = getCustomLocalAttendanceBatches();
        const pending = getPendingAttendanceQueue();

        // Keep local un-synced/pending edits + all remote multi-device batches
        const merged = mergeAttendanceBatches([...localCustom, ...remoteList, ...pending]);
        saveLocalAttendanceBatch(merged);
        clearSyncedFromAttendanceQueue(remoteList);
        onUpdate(merged);

        if (!snapshot.metadata.fromCache) {
          flushPendingAttendanceBatches().catch(() => {});
        }
      },
      (err) => {
        console.warn('Attendance firestore listener notice:', err.message);
      }
    );
  };

  start();

  return () => {
    cancelled = true;
    if (unsub) unsub();
  };
}

export async function syncAttendanceBatchToFirebase(item: ParsedAttendanceMessage): Promise<boolean> {
  const id = item.id || `ATT-${item.date}-${item.shift}-${Date.now()}`;
  const cleanPayload = sanitizeAttendanceForFirestore({ ...item, id, isHistorical: false });
  const localItem: ParsedAttendanceMessage = { ...item, id, isHistorical: false };

  try {
    await ensureFirebaseAuth();
    const docRef = doc(db, 'attendance_batches', id);
    await setDoc(docRef, cleanPayload, { merge: true });
    removePendingAttendance(id);
    return true;
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules('attendance_batches');
    }
    console.warn('Attendance sync deferred locally:', err?.message || err);
    enqueuePendingAttendance(localItem);
    return false;
  }
}

export async function flushPendingAttendanceBatches(): Promise<number> {
  repairPendingAttendanceQueues();
  const pending = getPendingAttendanceQueue();
  if (!pending.length) return 0;
  if (!(await canAccessFirestorePath('attendance_batches', false))) return 0;
  let flushed = 0;
  for (const item of pending) {
    const ok = await syncAttendanceBatchToFirebase(item);
    if (ok) flushed++;
  }
  return flushed;
}

export function getAttendanceAndQcPendingBreakdown(): {
  active: number;
  ruleBlocked: number;
} {
  const attCount = getPendingAttendanceQueue().length;
  const qcCount = getPendingQCLogsCount();
  let active = 0;
  let ruleBlocked = 0;
  if (isFirestorePathBlockedByRules('attendance_batches')) {
    ruleBlocked += attCount;
  } else {
    active += attCount;
  }
  if (isFirestorePathBlockedByRules('qc_inspections')) {
    ruleBlocked += qcCount;
  } else {
    active += qcCount;
  }
  return { active, ruleBlocked };
}

export function getPendingAttendanceCount(): number {
  return getAttendanceAndQcPendingBreakdown().active;
}

export async function deleteAttendanceBatchFromFirebase(_id: string) {
  console.warn('Protected record: deleting posted attendance batches is disabled.');
}

export function getAttendanceHistorySummary(batch: ParsedAttendanceMessage[]) {
  if (!batch.length) {
    return {
      earliestDate: HISTORICAL_LAST_DATE,
      latestDate: HISTORICAL_LAST_DATE,
      latestShift: 'Night' as const,
      nextContinuationDate: HISTORICAL_CONTINUATION_DATE,
      totalShifts: 0,
      historicalShifts: 0,
      newContinuationShifts: 0,
      totalRows: 0,
    };
  }
  const datesAsc = batch.map((b) => b.date).sort();
  const earliestDate = datesAsc[0];
  const latestDate = datesAsc[datesAsc.length - 1];
  const latestBatch = batch.find((b) => b.date === latestDate);
  const nextDt = new Date(`${latestDate}T00:00:00Z`);
  nextDt.setUTCDate(nextDt.getUTCDate() + 1);
  const nextContinuationDate = nextDt.toISOString().slice(0, 10);

  return {
    earliestDate,
    latestDate,
    latestShift: latestBatch?.shift || 'Day',
    nextContinuationDate,
    totalShifts: batch.length,
    historicalShifts: batch.filter((b) => b.date <= HISTORICAL_LAST_DATE).length,
    newContinuationShifts: batch.filter((b) => b.date > HISTORICAL_LAST_DATE).length,
    totalRows: batch.reduce((sum, b) => sum + (b.rows?.length || 0), 0),
  };
}

// ----------------- QC Log Storage & Sync -----------------
export const INITIAL_QC_LOGS: QCInspectionRecord[] = [
  {
    id: 'QC-001',
    date: '2026-11-01',
    shift: 'Day',
    machineOrLine: 'Extrusion Machine 2',
    product: '50mm Conduit Pipe PVC',
    samplesTested: 20,
    passedCount: 19,
    defectsCount: 1,
    defectReason: 'Wall thickness variation on bell mouth section',
    status: 'Passed',
    inspector: 'INNOCENT MAVIYANI',
    notes: 'Sample cut taken every 30 mins. Temperature adjusted on Zone 4.',
    createdAt: 1730446200000,
  },
  {
    id: 'QC-002',
    date: '2026-11-01',
    shift: 'Day',
    machineOrLine: 'IM 3',
    product: 'Electrical Junction Box 4x4',
    samplesTested: 15,
    passedCount: 15,
    defectsCount: 0,
    defectReason: 'None',
    status: 'Passed',
    inspector: 'TRUST GWEME',
    notes: 'Clean mould release, correct weight 145g.',
    createdAt: 1730448000000,
  },
  {
    id: 'QC-003',
    date: '2026-11-01',
    shift: 'Night',
    machineOrLine: 'Gumboot Machine',
    product: 'Size 8 Safety Gumboot',
    samplesTested: 10,
    passedCount: 8,
    defectsCount: 2,
    defectReason: 'Air bubble voids around sole heel injection port',
    status: 'Hold',
    inspector: 'SIMBARASHE CHAUNOITA',
    notes: 'Notified shift in charge. Raw material batch dried before resuming.',
    createdAt: 1730442600000,
  },
];

function normalizeQcInspectionRecord(r: QCInspectionRecord): QCInspectionRecord {
  return {
    ...r,
    machineOrLine: normalizeMachineName(r.machineOrLine),
  };
}

export function getLocalQCLogs(): QCInspectionRecord[] {
  try {
    const raw = localStorage.getItem(QC_STORAGE_KEY);
    if (raw) {
      const parsed: QCInspectionRecord[] = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(normalizeQcInspectionRecord) : [];
    }
  } catch (e) {
    console.warn('Failed reading QC logs from local storage:', e);
  }
  return INITIAL_QC_LOGS.map((q) => normalizeQcInspectionRecord({ ...q, synced: true }));
}

export function saveLocalQCLogs(logs: QCInspectionRecord[]) {
  try {
    localStorage.setItem(
      QC_STORAGE_KEY,
      JSON.stringify(logs.map(normalizeQcInspectionRecord))
    );
  } catch (e) {
    console.warn('Failed saving QC logs to local storage:', e);
  }
}

export function getPendingQCLogsCount(): number {
  const logs = getLocalQCLogs();
  return logs.filter((l) => l.synced === false).length;
}

export async function flushPendingQCLogs(): Promise<{ success: number; failed: number }> {
  const logs = getLocalQCLogs();
  const pending = logs.filter((l) => l.synced === false);
  let success = 0;
  let failed = 0;
  if (!pending.length) return { success, failed };
  if (!(await canAccessFirestorePath('qc_inspections', false))) return { success, failed };

  try {
    await ensureFirebaseAuth();
  } catch {}

  for (const item of pending) {
    try {
      const docRef = doc(db, 'qc_inspections', item.id);
      await setDoc(docRef, deepSanitizeForFirestore({ ...item, synced: true }), { merge: true });
      item.synced = true;
      success++;
    } catch (err: any) {
      if (isPermissionDeniedError(err)) {
        markFirestorePathBlockedByRules('qc_inspections');
        failed++;
        break;
      }
      failed++;
    }
  }

  saveLocalQCLogs(logs);
  return { success, failed };
}

export async function pollQCLogs(): Promise<QCInspectionRecord[]> {
  try {
    await ensureFirebaseAuth().catch(() => false);
    const snapshot = await getCollectionDocsServerFirst(collection(db, 'qc_inspections'));
    if (!snapshot.empty) {
      const remoteMap: Record<string, QCInspectionRecord> = {};
      snapshot.forEach((snap) => {
        remoteMap[snap.id] = normalizeQcInspectionRecord({
          ...(snap.data() as QCInspectionRecord),
          id: snap.id,
          synced: true,
        });
      });

      const currentLocal = getLocalQCLogs();
      const merged: QCInspectionRecord[] = [];
      currentLocal.forEach((l) => {
        if (l.synced === false && !remoteMap[l.id]) {
          merged.push(l);
        }
      });
      Object.values(remoteMap).forEach((rem) => merged.push(rem));
      merged.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      saveLocalQCLogs(merged);
      return merged;
    }
  } catch {}
  return getLocalQCLogs();
}

export function subscribeQCLogs(onUpdate: (logs: QCInspectionRecord[]) => void) {
  onUpdate(getLocalQCLogs());
  let unsub: (() => void) | null = null;
  let cancelled = false;

  const start = async () => {
    await ensureFirebaseAuth().catch(() => false);
    if (cancelled) return;
    if (!(await canAccessFirestorePath('qc_inspections', false))) return;
    if (cancelled) return;
    const colRef = collection(db, 'qc_inspections');
    unsub = onSnapshot(
      colRef,
      { includeMetadataChanges: true },
      (snapshot) => {
        if (!snapshot.empty) {
          const remoteMap: Record<string, QCInspectionRecord> = {};
          snapshot.forEach((snap) => {
            remoteMap[snap.id] = normalizeQcInspectionRecord({
              ...(snap.data() as QCInspectionRecord),
              id: snap.id,
              synced: true,
            });
          });

          const currentLocal = getLocalQCLogs();
          const merged: QCInspectionRecord[] = [];

          // Keep local pending items that haven't reached remote yet
          currentLocal.forEach((l) => {
            if (l.synced === false && !remoteMap[l.id]) {
              merged.push(l);
            }
          });

          Object.values(remoteMap).forEach((rem) => {
            merged.push(rem);
          });

          merged.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          saveLocalQCLogs(merged);
          onUpdate(merged);
        }
        if (!snapshot.metadata.fromCache) {
          flushPendingQCLogs().catch(() => {});
        }
      },
      (err) => {
        console.warn('QC firestore listener notice:', err.message);
      }
    );
  };

  start();

  return () => {
    cancelled = true;
    if (unsub) unsub();
  };
}

export async function syncQCLogToFirebase(rawItem: QCInspectionRecord): Promise<boolean> {
  const item = normalizeQcInspectionRecord(rawItem);
  const docRef = doc(db, 'qc_inspections', item.id);
  try {
    await ensureFirebaseAuth();
    await setDoc(docRef, deepSanitizeForFirestore({ ...item, synced: true }), { merge: true });
    item.synced = true;
    const current = getLocalQCLogs();
    const idx = current.findIndex((l) => l.id === item.id);
    if (idx >= 0) current[idx].synced = true;
    saveLocalQCLogs(current);
    return true;
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules('qc_inspections');
    }
    console.warn('QC sync offline/deferred, queued locally:', err.message);
    item.synced = false;
    const current = getLocalQCLogs();
    const idx = current.findIndex((l) => l.id === item.id);
    if (idx >= 0) current[idx].synced = false;
    else current.unshift(item);
    saveLocalQCLogs(current);
    return false;
  }
}

export async function deleteQCLogFromFirebase(_id: string) {
  console.warn('Protected record: deleting posted QC inspections is disabled.');
}
