import {
  collection,
  doc,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
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
import { QualityTrialReport, normalizeMachineName } from '../types';
import { saveFileBlob, ymd } from './downtimeCalc';

const TRIAL_STORAGE_KEY = 'lgplast_quality_trials_v1';
const TRIAL_PENDING_KEY = 'lgplast_quality_trials_pending_v1';
const TRIAL_COLLECTION = 'quality_trial_reports';

function sanitizeForFirestore<T extends Record<string, any>>(obj: T): T {
  return deepSanitizeForFirestore(obj);
}

function readLocalTrials(): QualityTrialReport[] {
  try {
    const raw = localStorage.getItem(TRIAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalTrials(items: QualityTrialReport[]) {
  try {
    localStorage.setItem(TRIAL_STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

function getPendingIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(TRIAL_PENDING_KEY) || '[]');
  } catch {
    return [];
  }
}

function addPendingId(id: string) {
  const q = getPendingIds();
  if (!q.includes(id)) {
    try {
      localStorage.setItem(TRIAL_PENDING_KEY, JSON.stringify([...q, id]));
    } catch {}
  }
}

function removePendingId(id: string) {
  const q = getPendingIds().filter((x) => x !== id);
  try {
    localStorage.setItem(TRIAL_PENDING_KEY, JSON.stringify(q));
  } catch {}
}

export function repairPendingQualityTrialQueues(): number {
  try {
    const raw = localStorage.getItem(TRIAL_PENDING_KEY);
    if (!raw) return 0;
    const queue = JSON.parse(raw);
    if (!Array.isArray(queue)) {
      localStorage.removeItem(TRIAL_PENDING_KEY);
      return 0;
    }
    const local = readLocalTrials() as Array<QualityTrialReport & { sy?: number }>;
    const byId = new Map(local.map((t) => [t.id, t]));
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const id of queue) {
      if (typeof id !== 'string' || !id || seen.has(id)) continue;
      const found = byId.get(id);
      if (!found) continue;
      if (found.sy && (!found.upd || found.sy >= found.upd)) continue;
      seen.add(id);
      cleaned.push(id);
    }
    if (cleaned.length !== queue.length) {
      localStorage.setItem(TRIAL_PENDING_KEY, JSON.stringify(cleaned));
    }
    return cleaned.length;
  } catch {
    return 0;
  }
}

function clearSyncedTrialsFromQueue(local: QualityTrialReport[], remote: QualityTrialReport[]) {
  const pending = getPendingIds();
  if (!pending.length) return;
  const localMap = new Map(local.map((t) => [t.id, t]));
  const remoteMap = new Map(remote.map((t) => [t.id, t]));
  pending.forEach((id) => {
    const r = remoteMap.get(id);
    const l = localMap.get(id);
    if (r && (!l || (r.upd || 0) >= (l.upd || 0))) {
      removePendingId(id);
    }
  });
}

function mergeTrials(
  local: QualityTrialReport[],
  remote: QualityTrialReport[]
): QualityTrialReport[] {
  const map: Record<string, QualityTrialReport> = {};
  local.forEach((t) => {
    if (t?.id) map[t.id] = t;
  });
  remote.forEach((t) => {
    if (!t?.id) return;
    const ex = map[t.id];
    if (!ex || (t.upd || 0) >= (ex.upd || 0)) {
      map[t.id] = t;
    }
  });
  return Object.values(map).sort((a, b) => (b.upd || 0) - (a.upd || 0));
}

export function getLocalQualityTrials(): QualityTrialReport[] {
  return readLocalTrials();
}

export async function saveQualityTrialToFirebase(
  trial: QualityTrialReport,
  options?: { preserveUpd?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const updated: QualityTrialReport = {
    ...trial,
    machine: normalizeMachineName(trial.machine),
    upd: options?.preserveUpd && trial.upd ? trial.upd : Date.now(),
  };

  const mergedLocal = mergeTrials(readLocalTrials(), [updated]);
  saveLocalTrials(mergedLocal);

  try {
    await ensureFirebaseAuth();
    const syncTs = Date.now();
    const payload = sanitizeForFirestore({ ...updated, sy: syncTs });
    await setDoc(doc(db, TRIAL_COLLECTION, updated.id), payload, { merge: true });
    removePendingId(updated.id);
    const latest = readLocalTrials().map((t) =>
      t.id === updated.id ? ({ ...t, sy: syncTs } as QualityTrialReport) : t
    );
    saveLocalTrials(latest);
    return { ok: true };
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(TRIAL_COLLECTION);
    }
    addPendingId(updated.id);
    return { ok: false, error: err?.message || 'Saved locally (offline)' };
  }
}

export function getQualityTrialsPendingBreakdown(): { active: number; ruleBlocked: number } {
  const len = getPendingIds().length;
  return isFirestorePathBlockedByRules(TRIAL_COLLECTION)
    ? { active: 0, ruleBlocked: len }
    : { active: len, ruleBlocked: 0 };
}

export function getPendingQualityTrialsCount(): number {
  return getQualityTrialsPendingBreakdown().active;
}

export async function flushPendingQualityTrials(): Promise<number> {
  repairPendingQualityTrialQueues();
  const ids = getPendingIds();
  if (!ids.length) return 0;
  if (!(await canAccessFirestorePath(TRIAL_COLLECTION, false))) return 0;
  const local = readLocalTrials();
  let flushed = 0;
  for (const id of ids) {
    if (isFirestorePathBlockedByRules(TRIAL_COLLECTION)) break;
    const found = local.find((t) => t.id === id);
    if (found) {
      const r = await saveQualityTrialToFirebase(found, { preserveUpd: true });
      if (r.ok) flushed++;
    } else {
      removePendingId(id);
    }
  }
  return flushed;
}

export async function pollQualityTrials(): Promise<QualityTrialReport[]> {
  try {
    await ensureFirebaseAuth();
    if (!(await canAccessFirestorePath(TRIAL_COLLECTION, false))) {
      return readLocalTrials();
    }
    const snap = await getCollectionDocsServerFirst(collection(db, TRIAL_COLLECTION));
    const remote: QualityTrialReport[] = [];
    snap.forEach((d) => {
      const raw = d.data() as QualityTrialReport & { sy?: number };
      remote.push({ ...raw, id: d.id, sy: raw.sy || raw.upd || 1 } as QualityTrialReport);
    });
    const local = readLocalTrials();
    const merged = mergeTrials(local, remote);
    saveLocalTrials(merged);
    clearSyncedTrialsFromQueue(local, remote);
    return merged;
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      markFirestorePathBlockedByRules(TRIAL_COLLECTION);
    }
    return readLocalTrials();
  }
}

export function subscribeQualityTrials(
  onUpdate: (trials: QualityTrialReport[]) => void
) {
  onUpdate(readLocalTrials());
  let unsub = () => {};
  let cancelled = false;
  (async () => {
    await ensureFirebaseAuth();
    if (cancelled) return;
    if (!(await canAccessFirestorePath(TRIAL_COLLECTION, false))) return;
    if (cancelled) return;
    try {
      unsub = onSnapshot(
        collection(db, TRIAL_COLLECTION),
        { includeMetadataChanges: true },
        (snap) => {
          const remote: QualityTrialReport[] = [];
          snap.forEach((d) => {
            const raw = d.data() as QualityTrialReport & { sy?: number };
            remote.push({ ...raw, id: d.id, sy: raw.sy || raw.upd || 1 } as QualityTrialReport);
          });
          const local = readLocalTrials();
          const merged = mergeTrials(local, remote);
          saveLocalTrials(merged);
          clearSyncedTrialsFromQueue(local, remote);
          onUpdate(merged);
          if (!snap.metadata.fromCache) {
            flushPendingQualityTrials().catch(() => {});
          }
        },
        (err) => {
          if (isPermissionDeniedError(err)) {
            markFirestorePathBlockedByRules(TRIAL_COLLECTION);
          }
          console.warn('QualityTrials listener warning:', err.message);
        }
      );
    } catch {}
  })();
  return () => {
    cancelled = true;
    unsub();
  };
}

/**
 * Admin-Only Excel Export of All Quality Trial Reports (Register + Full Test Results Matrix)
 */
export function exportQualityTrialsExcel(
  trials: QualityTrialReport[],
  isAdmin: boolean
) {
  if (!isAdmin) return;
  const sorted = [...trials].sort((a, b) =>
    (b.date + b.conductedAt).localeCompare(a.date + a.conductedAt)
  );

  const registerRows = sorted.map((t) => {
    const passCount = t.qcTests.filter((q) => q.verdict === 'PASS').length;
    const failCount = t.qcTests.filter((q) => q.verdict === 'FAIL').length;
    return {
      'Trial No.': t.trialNo,
      'QMS Doc Code': t.qmsDocCode,
      Date: t.date,
      Shift: t.shift,
      Product: t.product,
      'Product Family': t.productFamily,
      Machine: normalizeMachineName(t.machine),
      'Trial Category': t.trialCategory,
      Standards: t.applicableStandards.join(', '),
      'Scrap Ratio %': t.scrapRatioPct || '—',
      'Additive / Colourant': t.additiveDetails || '—',
      'New Material / Supplier': t.newMaterialSource || '—',
      'Tests Passed': `${passCount}/${t.qcTests.length}`,
      'Tests Failed': failCount,
      'Overall QA Decision': t.overallVerdict.replace(/_/g, ' ') || 'DRAFT',
      'Conducted By': t.conductedByName,
      'Signed By Conductor': t.conductorSignature ? 'YES' : 'No',
      'HOD Reviewer': t.reviewedByHodName || '—',
      Status: t.status,
      Recommendations: t.recommendations,
    };
  });

  const testDetailRows = sorted.flatMap((t) =>
    t.qcTests.map((q) => ({
      'Trial No.': t.trialNo,
      Date: t.date,
      Product: t.product,
      'Trial Category': t.trialCategory,
      'Quality Test': q.testName,
      'Standard (ISO/QMS/ASTM/SAZ)': q.standardRef,
      Method: q.method,
      Unit: q.unit,
      'Specification Limit': q.specRequirement,
      'Actual Measured Result': q.actualResult,
      Verdict: q.verdict || 'PENDING',
      Remarks: q.remarks || '',
    }))
  );

  const wb = XLSX.utils.book_new();
  const wsReg = XLSX.utils.aoa_to_sheet([
    ['LG PLAST — Affordable / Durable / Complete'],
    ['QUALITY TRIALS & R&D FORMULATION REGISTER (ISO / QMS / ASTM / SAZ)'],
    [`Generated: ${new Date().toLocaleString()}`],
    [],
  ]);
  XLSX.utils.sheet_add_json(
    wsReg,
    registerRows.length > 0 ? registerRows : [{ Notice: 'No quality trials recorded yet.' }],
    { origin: 'A5' }
  );
  XLSX.utils.book_append_sheet(wb, wsReg, 'Quality Trials Register');

  const wsTests = XLSX.utils.aoa_to_sheet([
    ['LG PLAST — Affordable / Durable / Complete'],
    ['QUALITY TRIAL LABORATORY TEST RESULTS MATRIX'],
    [`Generated: ${new Date().toLocaleString()}`],
    [],
  ]);
  XLSX.utils.sheet_add_json(
    wsTests,
    testDetailRows.length > 0 ? testDetailRows : [{ Notice: 'No test rows recorded yet.' }],
    { origin: 'A5' }
  );
  XLSX.utils.book_append_sheet(wb, wsTests, 'QC Test Results Matrix');

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveFileBlob(`LGPLAST_QMS_Quality_Trials_Register_${ymd(new Date())}.xlsx`, blob);
}
