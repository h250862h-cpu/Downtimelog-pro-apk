import {
  collection,
  doc,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import {
  db,
  deepSanitizeForFirestore,
  ensureFirebaseAuth,
  getCollectionDocsServerFirst,
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
    const payload = sanitizeForFirestore({ ...updated, sy: Date.now() });
    await setDoc(doc(db, TRIAL_COLLECTION, updated.id), payload, { merge: true });
    removePendingId(updated.id);
    return { ok: true };
  } catch (err: any) {
    addPendingId(updated.id);
    return { ok: false, error: err?.message || 'Saved locally (offline)' };
  }
}

export function getPendingQualityTrialsCount(): number {
  return getPendingIds().length;
}

export async function flushPendingQualityTrials(): Promise<number> {
  const ids = getPendingIds();
  if (!ids.length) return 0;
  const local = readLocalTrials();
  let flushed = 0;
  for (const id of ids) {
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
    const snap = await getCollectionDocsServerFirst(collection(db, TRIAL_COLLECTION));
    const remote: QualityTrialReport[] = [];
    snap.forEach((d) => remote.push(d.data() as QualityTrialReport));
    const merged = mergeTrials(readLocalTrials(), remote);
    saveLocalTrials(merged);
    return merged;
  } catch {
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
    try {
      unsub = onSnapshot(
        collection(db, TRIAL_COLLECTION),
        { includeMetadataChanges: true },
        (snap) => {
          const remote: QualityTrialReport[] = [];
          snap.forEach((d) => remote.push(d.data() as QualityTrialReport));
          const merged = mergeTrials(readLocalTrials(), remote);
          saveLocalTrials(merged);
          onUpdate(merged);
          if (!snap.metadata.fromCache) {
            flushPendingQualityTrials().catch(() => {});
          }
        },
        (err) => console.warn('QualityTrials listener warning:', err.message)
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
