import {
  collection,
  doc,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { QC_CSV_SEED_VERSION, SEEDED_QC_RECORDS } from '../data/qcCsvSeed';
import { db, deepSanitizeForFirestore, ensureFirebaseAuth, getCollectionDocsServerFirst } from '../firebase';
import {
  DispatchEntry,
  normalizeMachineName,
  SopMixingReport,
  SopProductionRecord,
  SopQcRecord,
  SopScrapRecord,
  SopShiftHandoverRecord,
} from '../types';
import { saveFileBlob, ymd } from './downtimeCalc';

// ======================================================
// STORAGE KEYS & FIRESTORE COLLECTIONS
// ======================================================
const PROD_KEY = 'lgplast_sop_prod_v1';
const PROD_PENDING_KEY = 'lgplast_sop_prod_pending_v1';
const PROD_COLLECTION = 'sop_production_logs';

const QC_KEY = 'lgplast_sop_qc_v1';
const QC_PENDING_KEY = 'lgplast_sop_qc_pending_v1';
const QC_COLLECTION = 'sop_qc_checks';

const SCRAP_KEY = 'lgplast_sop_scrap_v1';
const SCRAP_PENDING_KEY = 'lgplast_sop_scrap_pending_v1';
const SCRAP_COLLECTION = 'sop_scrap_pipeline';

const MIXING_KEY = 'lgplast_sop_mixing_v1';
const MIXING_PENDING_KEY = 'lgplast_sop_mixing_pending_v1';
const MIXING_COLLECTION = 'sop_mixing_reports';

const HANDOVER_KEY = 'lgplast_sop_handover_v1';
const HANDOVER_PENDING_KEY = 'lgplast_sop_handover_pending_v1';
const HANDOVER_COLLECTION = 'sop_shift_handovers';

// ======================================================
// GENERIC OFFLINE-FIRST FIRESTORE SYNC HELPERS
// ======================================================
function readLocalList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalList<T>(key: string, items: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch (e) {
    console.warn(`Failed saving ${key} to localStorage:`, e);
  }
}

function readPendingQueue(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function addPendingId(key: string, id: string) {
  try {
    const q = readPendingQueue(key);
    if (!q.includes(id)) {
      q.push(id);
      localStorage.setItem(key, JSON.stringify(q));
    }
  } catch {}
}

function removePendingId(key: string, id: string) {
  try {
    const q = readPendingQueue(key).filter((x) => x !== id);
    localStorage.setItem(key, JSON.stringify(q));
  } catch {}
}

function sanitizeForFirestore<T extends Record<string, any>>(obj: T): T {
  return deepSanitizeForFirestore(obj);
}

function mergeRecords<T extends { id: string; upd?: number }>(
  local: T[],
  remote: T[],
  normalizeFn?: (item: T) => T
): T[] {
  const map: Record<string, T> = {};
  local.forEach((raw) => {
    const item = normalizeFn ? normalizeFn(raw) : raw;
    if (item && item.id) map[item.id] = item;
  });
  remote.forEach((raw) => {
    const item = normalizeFn ? normalizeFn(raw) : raw;
    if (!item || !item.id) return;
    const existing = map[item.id];
    if (!existing || (item.upd || 0) >= (existing.upd || 0)) {
      map[item.id] = item;
    }
  });
  return Object.values(map).sort((a, b) => (b.upd || 0) - (a.upd || 0));
}

function createCollectionStore<T extends { id: string; upd?: number; sy?: number }>(
  storageKey: string,
  pendingKey: string,
  collectionName: string,
  normalizeFn?: (item: T) => T
) {
  const norm = (item: T): T => (normalizeFn ? normalizeFn(item) : item);
  const getLocal = () => readLocalList<T>(storageKey).map(norm);

  const save = async (
    item: T,
    options?: { preserveUpd?: boolean }
  ): Promise<{ ok: boolean; error?: string }> => {
    const updatedItem: T = norm({
      ...item,
      upd: options?.preserveUpd && item.upd ? item.upd : Date.now(),
    });

    const local = getLocal();
    const idx = local.findIndex((x) => x.id === updatedItem.id);
    const nextLocal = [...local];
    if (idx >= 0) {
      nextLocal[idx] = updatedItem;
    } else {
      nextLocal.unshift(updatedItem);
    }
    writeLocalList(storageKey, nextLocal);

    try {
      await ensureFirebaseAuth();
      const payload = sanitizeForFirestore({
        ...updatedItem,
        sy: Date.now(),
      });
      await setDoc(doc(db, collectionName, updatedItem.id), payload, { merge: true });
      removePendingId(pendingKey, updatedItem.id);

      const latest = getLocal().map((x) =>
        x.id === updatedItem.id ? { ...x, sy: payload.sy } : x
      );
      writeLocalList(storageKey, latest);
      return { ok: true };
    } catch (err: any) {
      addPendingId(pendingKey, updatedItem.id);
      return { ok: false, error: err?.message || `Failed syncing ${collectionName}` };
    }
  };

  const flush = async (): Promise<number> => {
    const pendingIds = readPendingQueue(pendingKey);
    if (!pendingIds.length) return 0;
    const local = getLocal();
    let count = 0;
    for (const id of pendingIds) {
      const found = local.find((x) => x.id === id);
      if (found) {
        const res = await save(found, { preserveUpd: true });
        if (res.ok) count++;
      } else {
        removePendingId(pendingKey, id);
      }
    }
    return count;
  };

  const poll = async (): Promise<T[]> => {
    try {
      await ensureFirebaseAuth();
      const snap = await getCollectionDocsServerFirst(collection(db, collectionName));
      const remote: T[] = [];
      snap.forEach((d) => {
        remote.push(norm(d.data() as T));
      });
      const merged = mergeRecords(getLocal(), remote, normalizeFn);
      writeLocalList(storageKey, merged);
      return merged;
    } catch {
      return getLocal();
    }
  };

  const subscribe = (onUpdate: (items: T[]) => void) => {
    onUpdate(getLocal());
    let unsub: () => void = () => {};
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const start = async () => {
      await ensureFirebaseAuth();
      if (cancelled) return;
      try {
        unsub = onSnapshot(
          collection(db, collectionName),
          { includeMetadataChanges: true },
          (snapshot) => {
            const remote: T[] = [];
            snapshot.forEach((d) => {
              remote.push(norm(d.data() as T));
            });
            const merged = mergeRecords(getLocal(), remote, normalizeFn);
            writeLocalList(storageKey, merged);
            onUpdate(merged);
            if (!snapshot.metadata.fromCache) {
              flush().catch(() => {});
            }
          },
          (err) => {
            console.warn(`${collectionName} listener fallback:`, err.message);
          }
        );
      } catch (e) {
        console.warn(`${collectionName} subscribe error:`, e);
      }

      poll()
        .then((merged) => {
          if (!cancelled) onUpdate(merged);
        })
        .catch(() => {});

      pollTimer = setInterval(() => {
        poll()
          .then((merged) => {
            if (!cancelled) onUpdate(merged);
          })
          .catch(() => {});
      }, 20000);
    };

    start();

    return () => {
      cancelled = true;
      unsub();
      if (pollTimer) clearInterval(pollTimer);
    };
  };

  return { getLocal, save, flush, poll, subscribe };
}

const prodStore = createCollectionStore<SopProductionRecord>(PROD_KEY, PROD_PENDING_KEY, PROD_COLLECTION, (r) => ({
  ...r,
  machine: normalizeMachineName(r.machine),
}));
const qcStore = createCollectionStore<SopQcRecord>(QC_KEY, QC_PENDING_KEY, QC_COLLECTION, (q) => ({
  ...q,
  machine: normalizeMachineName(q.machine),
}));
const scrapStore = createCollectionStore<SopScrapRecord>(SCRAP_KEY, SCRAP_PENDING_KEY, SCRAP_COLLECTION, (s) => ({
  ...s,
  machine: normalizeMachineName(s.machine),
  mixerMachine: s.mixerMachine ? normalizeMachineName(s.mixerMachine) : undefined,
}));
const mixingStore = createCollectionStore<SopMixingReport>(MIXING_KEY, MIXING_PENDING_KEY, MIXING_COLLECTION, (m) => ({
  ...m,
  machine: normalizeMachineName(m.machine),
}));
const handoverStore = createCollectionStore<SopShiftHandoverRecord>(HANDOVER_KEY, HANDOVER_PENDING_KEY, HANDOVER_COLLECTION);

let qcCsvSeedChecked = false;
function ensureQcCsvSeeded() {
  if (qcCsvSeedChecked) return;
  qcCsvSeedChecked = true;
  try {
    const alreadySeeded = localStorage.getItem(QC_CSV_SEED_VERSION) === '1';
    const existing = readLocalList<SopQcRecord>(QC_KEY);
    if (!alreadySeeded || existing.length === 0) {
      const merged = mergeRecords(
        SEEDED_QC_RECORDS,
        existing,
        (q) => ({ ...q, machine: normalizeMachineName(q.machine) })
      );
      writeLocalList(QC_KEY, merged);
      localStorage.setItem(QC_CSV_SEED_VERSION, '1');
    }
  } catch {}
}

export const getLocalSopProductionLogs = prodStore.getLocal;
export const saveSopProductionToFirebase = prodStore.save;
export const flushPendingSopProduction = prodStore.flush;
export const pollSopProduction = prodStore.poll;
export const subscribeSopProduction = prodStore.subscribe;

export function getLocalSopQcChecks(): SopQcRecord[] {
  ensureQcCsvSeeded();
  return qcStore.getLocal();
}
export const saveSopQcToFirebase = qcStore.save;
export const flushPendingSopQc = qcStore.flush;
export const pollSopQc = async (): Promise<SopQcRecord[]> => {
  ensureQcCsvSeeded();
  return qcStore.poll();
};
export const subscribeSopQc = (onUpdate: (items: SopQcRecord[]) => void) => {
  ensureQcCsvSeeded();
  return qcStore.subscribe(onUpdate);
};

export const getLocalSopScrapRecords = scrapStore.getLocal;
export const saveSopScrapToFirebase = scrapStore.save;
export const flushPendingSopScrap = scrapStore.flush;
export const pollSopScrap = scrapStore.poll;
export const subscribeSopScrap = scrapStore.subscribe;

export const getLocalSopMixingReports = mixingStore.getLocal;
export const saveSopMixingToFirebase = mixingStore.save;
export const flushPendingSopMixing = mixingStore.flush;
export const pollSopMixing = mixingStore.poll;
export const subscribeSopMixing = mixingStore.subscribe;

export const getLocalSopHandovers = handoverStore.getLocal;
export const saveSopHandoverToFirebase = handoverStore.save;
export const flushPendingSopHandovers = handoverStore.flush;
export const pollSopHandovers = handoverStore.poll;
export const subscribeSopHandovers = handoverStore.subscribe;

export function getTotalPendingSopCount(): number {
  return (
    readPendingQueue(PROD_PENDING_KEY).length +
    readPendingQueue(QC_PENDING_KEY).length +
    readPendingQueue(SCRAP_PENDING_KEY).length +
    readPendingQueue(MIXING_PENDING_KEY).length +
    readPendingQueue(HANDOVER_PENDING_KEY).length
  );
}

export async function flushAllPendingSopData(): Promise<number> {
  const counts = await Promise.all([
    flushPendingSopProduction().catch(() => 0),
    flushPendingSopQc().catch(() => 0),
    flushPendingSopScrap().catch(() => 0),
    flushPendingSopMixing().catch(() => 0),
    flushPendingSopHandovers().catch(() => 0),
  ]);
  return counts.reduce((a, b) => a + b, 0);
}

// ======================================================
// NORMALIZATION & DISPATCH <-> PRODUCTION SCRAP/WASTAGE LINK
// ======================================================
export function normalizeToIsoDate(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return ymd(new Date());
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // DD/MM/YYYY or D/M/YYYY or DD.MM.YY
  const dmy = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const mon = dmy[2].padStart(2, '0');
    let yr = dmy[3];
    if (yr.length === 2) yr = `20${yr}`;
    return `${yr}-${mon}-${day}`;
  }
  return ymd(new Date());
}

export function normalizeMachineMatchKey(name: string): string {
  const canonical = normalizeMachineName(name);
  const up = (canonical || name || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!up) return '';

  // Injection machines: IM1, IM 1, I.M. 1, Injection 1 -> IM1
  const im = up.match(/(?:I\.?\s*M\.?|INJECTION(?:\s*MACHINE)?)\s*0*(\d+)/);
  if (im) return `IM${Number(im[1])}`;

  // Extrusion lines: LINE 01, Extruder 1, Extrusion Machine 1 -> EXT1
  const ext = up.match(/(?:LINE|EXTRUSION(?:\s*MACHINE)?|EXTRUDER)\s*0*(\d+)/);
  if (ext) return `EXT${Number(ext[1])}`;

  // Mixer machines: Mixer 1, Mixer Machine 1 -> MIX1
  const mix = up.match(/MIXER(?:\s*MACHINE)?\s*0*(\d+)/);
  if (mix) return `MIX${Number(mix[1])}`;

  // Polypipe machines
  if (/POLY\s*PIPE\s*CRUSHER|POLYPIPE\s*CRUSHER/.test(up)) return 'POLYPIPECRUSHER';
  const poly = up.match(/POLY\s*PIPE(?:\s*MACHINE)?(?:\s*0*(\d+))?/);
  if (poly) return `POLY${Number(poly[1] || 1)}`;

  // Punching machines
  const punch = up.match(/PUNCHING(?:\s*MACHINE)?\s*0*(\d+)/);
  if (punch) return `PUNCH${Number(punch[1])}`;

  return up.replace(/[^A-Z0-9]/g, '');
}

export function mapParsedMachineToPlantMachine(rawMachine: string, plantMachines: string[]): string {
  const canonical = normalizeMachineName(rawMachine);
  const key = normalizeMachineMatchKey(canonical || rawMachine);
  if (!key) return plantMachines[0] || canonical || rawMachine;
  const exact = plantMachines.find(
    (m) => m.toLowerCase() === (canonical || rawMachine).trim().toLowerCase()
  );
  if (exact) return exact;
  const byKey = plantMachines.find((m) => normalizeMachineMatchKey(m) === key);
  if (byKey) return byKey;
  return canonical || rawMachine;
}

function normalizeProductTokens(product: string): string[] {
  return (product || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 2);
}

function productsLooselyMatch(a: string, b: string): boolean {
  const na = (a || '').trim().toUpperCase();
  const nb = (b || '').trim().toUpperCase();
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = normalizeProductTokens(na);
  const tb = normalizeProductTokens(nb);
  if (ta.length === 0 || tb.length === 0) return false;
  const overlap = ta.filter((t) => tb.includes(t));
  return overlap.length >= Math.min(2, Math.min(ta.length, tb.length));
}

export function getLinkedScrapAndWastageForDispatch(
  entry: DispatchEntry,
  prodLogs: SopProductionRecord[]
): { scrapKg: number; wastageKg: number; matchedCount: number } {
  if (!prodLogs || prodLogs.length === 0) {
    return { scrapKg: 0, wastageKg: 0, matchedCount: 0 };
  }

  const targetDate = normalizeToIsoDate(entry.date);
  const targetShift = (entry.shift || '').toLowerCase().startsWith('n') ? 'Night' : 'Day';
  const targetMachKey = normalizeMachineMatchKey(entry.machine);

  const dateShiftMachineMatches = prodLogs.filter((p) => {
    const pDate = normalizeToIsoDate(p.date);
    const pShift = (p.shift || '').toLowerCase().startsWith('n') ? 'Night' : 'Day';
    const pMachKey = normalizeMachineMatchKey(p.machine);
    return pDate === targetDate && pShift === targetShift && pMachKey === targetMachKey;
  });

  if (dateShiftMachineMatches.length === 0) {
    return { scrapKg: 0, wastageKg: 0, matchedCount: 0 };
  }

  const productMatches = dateShiftMachineMatches.filter((p) =>
    productsLooselyMatch(entry.product, p.product)
  );
  const chosen = productMatches.length > 0 ? productMatches : dateShiftMachineMatches;

  const scrapKg = chosen.reduce((acc, r) => acc + (Number(r.scrapKg) || 0), 0);
  const wastageKg = chosen.reduce((acc, r) => acc + (Number(r.wastageCdKg) || 0), 0);

  return {
    scrapKg: Number(scrapKg.toFixed(2)),
    wastageKg: Number(wastageKg.toFixed(2)),
    matchedCount: chosen.length,
  };
}

// ======================================================
// WHATSAPP PRODUCTION REPORT PARSER (PORTED FROM production-report-parser.html)
// ======================================================
function lev(a: string, b: string): number {
  const s1 = a || '';
  const s2 = b || '';
  const m = s1.length;
  const n = s2.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (s1[i - 1] === s2[j - 1] ? 0 : 1)
      );
    }
  }
  return d[m][n];
}

const PROD_UNITS = ['GOOD PIECES', 'BAGS', 'BUNDLES', 'PIPES'];

function matchKeyword(line: string, key: string): string | null {
  const m = line.match(/^([A-Za-z]+)\s*:?\s*(.*)$/);
  if (!m) return null;
  if (lev(m[1].toUpperCase(), key) <= 2) return m[2].trim();
  return null;
}

function extractProdMachine(line: string, dept: string): { machine: string; rest: string } | null {
  const up = line.toUpperCase();
  const tryLine = (re: RegExp, fmt: (m: RegExpMatchArray) => string) => {
    const m = up.match(re);
    if (!m) return null;
    const idx = up.indexOf(m[0]);
    const rest = (line.slice(0, idx) + line.slice(idx + m[0].length))
      .replace(/^[\s.,-]+/, '')
      .trim();
    return { machine: normalizeMachineName(fmt(m)), rest };
  };
  if (dept !== 'Extrusion') {
    const r = tryLine(/I\.?\s*M\.?\s*(\d+)/, (m) => `IM ${m[1]}`);
    if (r) return r;
  }
  const rPoly = tryLine(/POLY\s*PIPE(?:\s*(?:MACHINE|LINE))?(?:\s*0?(\d+))?/, (m) =>
    m[1] ? `Polypipe Machine ${Number(m[1])}` : 'Polypipe Machine 1'
  );
  if (rPoly) return rPoly;
  const rWordLine = tryLine(/LINE[\s-]*(ONE|TWO|THREE|FOUR|SIX|SEVEN|EIGHT)\b/, (m) => `Line ${m[1]}`);
  if (rWordLine) return rWordLine;
  const r2 = tryLine(/LINE\s*0?(\d+)/, (m) => `Line ${Number(m[1])}`);
  if (r2) return r2;
  const r3 = tryLine(/EXTRUD(?:ER|SION\s*MACHINE)\s*0?(\d+)/, (m) => `Extrusion Machine ${Number(m[1])}`);
  if (r3) return r3;
  if (dept === 'Extrusion') {
    return tryLine(/I\.?\s*M\.?\s*(\d+)/, (m) => `IM ${m[1]}`);
  }
  return null;
}

function isScrapLine(line: string): boolean {
  const w = (line.trim().split(/\s+/)[0] || '').toUpperCase().replace(/[^A-Z]/g, '');
  return w.length >= 3 && lev(w, 'SCRAP') <= 2;
}

function trailingNumericOrNil(line: string): number {
  const m = line.match(/([\d]+\.?[\d]*|NIL)\s*$/i);
  if (!m) return 0;
  if (m[1].toUpperCase() === 'NIL') return 0;
  const n = parseFloat(m[1]);
  return Number.isNaN(n) ? 0 : n;
}

function extractProdQty(line: string): { qty: number; unit: string } | null {
  const m = line.match(/^([\d][\d,]*)\s*(.*)$/);
  if (!m) return null;
  const qty = Number(m[1].replace(/,/g, ''));
  const raw = m[2].trim().toUpperCase();
  if (!raw) return null;
  let best: string | null = null;
  let bd = Infinity;
  PROD_UNITS.forEach((u) => {
    const d = lev(raw, u);
    const th = Math.ceil(u.length / 3) + 1;
    if (d <= th && d < bd) {
      bd = d;
      best = u;
    }
  });
  if (!best) return null;
  return { qty, unit: best };
}

export interface ParsedWhatsAppProdRow {
  tempId: string;
  date: string;
  shift: 'Day' | 'Night';
  dept: string;
  machine: string;
  operator: string;
  assistant: string;
  product: string;
  qty: number;
  unit: string;
  prodKg: number;
  scrapKg: number;
  wastageCdKg: number;
  reporter: string;
}

export function parseProductionWhatsAppText(
  text: string,
  plantMachines: string[] = []
): ParsedWhatsAppProdRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: ParsedWhatsAppProdRow[] = [];
  const ctx: {
    date: string;
    shift: 'Day' | 'Night';
    dept: string;
    lastMachine: Record<string, string>;
  } = {
    date: ymd(new Date()),
    shift: 'Day',
    dept: 'Extrusion',
    lastMachine: {},
  };

  let cur: ParsedWhatsAppProdRow | null = null;

  const push = () => {
    if (cur && (cur.operator || cur.product || cur.qty > 0 || cur.scrapKg > 0 || cur.wastageCdKg > 0)) {
      if (!cur.machine) cur.machine = ctx.lastMachine[cur.dept] || plantMachines[0] || '';
      else {
        cur.machine = mapParsedMachineToPlantMachine(cur.machine, plantMachines);
        ctx.lastMachine[cur.dept] = cur.machine;
      }
      out.push(cur);
    }
    cur = null;
  };

  const makeBlank = (): ParsedWhatsAppProdRow => ({
    tempId: `PARSED-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date: ctx.date,
    shift: ctx.shift,
    dept: ctx.dept,
    machine: '',
    operator: '',
    assistant: '',
    product: '',
    qty: 0,
    unit: 'GOOD PIECES',
    prodKg: 0,
    scrapKg: 0,
    wastageCdKg: 0,
    reporter: '',
  });

  for (const line of lines) {
    const up = line.toUpperCase();

    const dm = line.match(/\(?(\d{1,2}\/\d{1,2}\/\d{2,4})\)?/);
    if (dm && (line.includes('(') || !line.includes(':'))) {
      ctx.date = normalizeToIsoDate(dm[1]);
      if (up.includes('NIGHT')) ctx.shift = 'Night';
      else if (up.includes('DAY')) ctx.shift = 'Day';
      continue;
    }

    if (up.includes('SHIFT') && (up.includes('NIGHT') || up.includes('DAY'))) {
      ctx.shift = up.includes('NIGHT') ? 'Night' : 'Day';
      continue;
    }
    if (up === 'GOOD MORNING' || up.includes('PRODUCTION REPORT')) continue;

    const fm = line.match(/^FROM:?\s*(.+)/i);
    if (fm) {
      push();
      const reporter = fm[1].trim();
      out
        .filter((r) => r.date === ctx.date && r.shift === ctx.shift)
        .forEach((r) => {
          r.reporter = reporter;
        });
      continue;
    }

    if (/^[A-Za-z\s]+$/.test(line) && line.split(/\s+/).length <= 2) {
      let best: string | null = null;
      let bd = Infinity;
      for (const s of ['INJECTION', 'EXTRUSION', 'MIXING']) {
        const d = lev(up, s);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      if (best && bd <= 2) {
        push();
        ctx.dept = best[0] + best.slice(1).toLowerCase();
        continue;
      }
    }

    const om = matchKeyword(line, 'OPERATOR');
    if (om !== null) {
      push();
      cur = makeBlank();
      cur.operator = om;
      continue;
    }

    const am = matchKeyword(line, 'ASSISTANT');
    if (am !== null && cur) {
      cur.assistant = am;
      continue;
    }

    if (cur) {
      const mm = extractProdMachine(line, ctx.dept);
      if (mm) {
        cur.machine = mapParsedMachineToPlantMachine(mm.machine, plantMachines);
        if (mm.rest) cur.product = cur.product ? `${cur.product} ${mm.rest}` : mm.rest;
        continue;
      }
      if (isScrapLine(line)) {
        cur.scrapKg = trailingNumericOrNil(line);
        continue;
      }
      if (/^(CD|CUT\s*DUST|WASTAGE)\b/i.test(line)) {
        cur.wastageCdKg = trailingNumericOrNil(line);
        continue;
      }
      const kgLine = line.match(/^([\d,]+\.?\d*)\s*KGS?$/i);
      if (kgLine) {
        cur.prodKg = Number(kgLine[1].replace(/,/g, '')) || 0;
        continue;
      }
      const qm = extractProdQty(line);
      if (qm) {
        cur.qty = qm.qty;
        cur.unit = qm.unit;
        continue;
      }
      cur.product = cur.product ? `${cur.product} ${line}` : line;
    }
  }
  push();
  return out;
}

// ======================================================
// WHATSAPP QC REPORT PARSER (PORTED FROM qc-report-app.html)
// ======================================================
const QC_KEYS: Record<string, string> = {
  MACHINENUMBER: 'machine',
  PRODUCTNAME: 'product',
  PPH: 'pph',
  KGSPERHR: 'kgsPerHr',
  BUNDLEWEIGHT: 'weight:Bundle',
  PIPEWEIGHT: 'weight:Pipe',
  PRINTING: 'printing',
  LENGTH: 'lengthM',
  SOCKETSIZE: 'socketSize',
  DROPBENDTEST: 'dropBend',
  FITTINGTEST: 'fitting',
  UNIFORMCOLOR: 'color',
  UNIFORMCOLOUR: 'color',
  OD: 'od',
  ID: 'idMm',
  QCCHECKNUMBER: 'qcNo',
  SHIFT: 'shift',
  REPORTEDBY: 'reporter',
};

function matchQcKey(raw: string): string | null {
  const k = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (!k) return null;
  if (QC_KEYS[k]) return QC_KEYS[k];
  let best: string | null = null;
  let bd = Infinity;
  for (const key in QC_KEYS) {
    const th = key.length <= 4 ? 0 : key.length <= 8 ? 1 : 2;
    const d = lev(k, key);
    if (d <= th && d < bd) {
      bd = d;
      best = QC_KEYS[key];
    }
  }
  return best;
}

function parseQcNum(v: string): number | string {
  const m = String(v).replace(/,/g, '').match(/-?\d+\.?\d*/);
  return m ? parseFloat(m[0]) : '';
}

export interface ParsedWhatsAppQcRow {
  tempId: string;
  date: string;
  shift: 'Day' | 'Night';
  qcNo: string;
  machine: string;
  product: string;
  pph: number | string;
  pphUnit: string;
  kgsPerHr: number | string;
  weightType: string;
  weightKg: number | string;
  printing: string;
  lengthM: number | string;
  socketSize: string;
  dropBend: string;
  fitting: string;
  color: string;
  od: number | string;
  idMm: number | string;
  reporter: string;
  open?: boolean;
}

export function parseQcWhatsAppText(
  text: string,
  plantMachines: string[] = []
): ParsedWhatsAppQcRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: ParsedWhatsAppQcRow[] = [];
  const ctx = { date: ymd(new Date()) };
  let cur: ParsedWhatsAppQcRow | null = null;
  let footer = false;

  const makeQcRow = (): ParsedWhatsAppQcRow => ({
    tempId: `QC-PARSED-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date: ctx.date,
    shift: 'Day',
    qcNo: '',
    machine: '',
    product: '',
    pph: '',
    pphUnit: '',
    kgsPerHr: '',
    weightType: '',
    weightKg: '',
    printing: '',
    lengthM: '',
    socketSize: '',
    dropBend: 'Pass',
    fitting: 'Pass',
    color: 'Pass',
    od: '',
    idMm: '',
    reporter: '',
    open: true,
  });

  for (const line of lines) {
    const dm = line.match(/(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/);
    if (dm && !line.includes(':')) {
      ctx.date = normalizeToIsoDate(dm[1]);
      continue;
    }
    const ci = line.indexOf(':');
    if (ci < 0) continue;
    const field = matchQcKey(line.slice(0, ci));
    if (!field) continue;
    const val = line.slice(ci + 1).trim();

    if (field === 'machine') {
      if (footer) {
        out.forEach((r) => {
          r.open = false;
        });
        footer = false;
      }
      cur = makeQcRow();
      cur.machine = mapParsedMachineToPlantMachine(val, plantMachines);
      out.push(cur);
      continue;
    }

    if (field === 'qcNo' || field === 'shift' || field === 'reporter') {
      footer = true;
      let v = val;
      if (field === 'shift') {
        const u = val.toUpperCase();
        const resolved: 'Day' | 'Night' = /^N/.test(u) ? 'Night' : 'Day';
        out
          .filter((r) => r.open)
          .forEach((r) => {
            r.shift = resolved;
          });
      } else {
        out
          .filter((r) => r.open)
          .forEach((r) => {
            if (field === 'qcNo') r.qcNo = v;
            if (field === 'reporter') r.reporter = v;
          });
      }
      continue;
    }

    if (!cur) continue;
    if (field.startsWith('weight:')) {
      cur.weightType = field.split(':')[1];
      cur.weightKg = parseQcNum(val);
    } else if (field === 'pph') {
      cur.pph = parseQcNum(val);
      const u = val.toUpperCase();
      if (/BUNDLE/.test(u)) cur.pphUnit = 'Bundles/hr';
      else if (/PIPE|PCS|PIECE/.test(u)) cur.pphUnit = 'Pipes/hr';
    } else if (field === 'kgsPerHr' || field === 'lengthM' || field === 'od' || field === 'idMm') {
      (cur as any)[field] = parseQcNum(val);
    } else if (field === 'dropBend' || field === 'fitting' || field === 'color') {
      const upVal = val.toUpperCase();
      (cur as any)[field] = upVal.includes('FAIL') ? 'Fail' : upVal.includes('PASS') ? 'Pass' : val;
    } else {
      (cur as any)[field] = val;
    }
  }

  return out.map(({ open: _open, ...rest }) => rest);
}

// ======================================================
// ADMIN-ONLY EXCEL EXPORTS FOR ALL SOP APKs
// ======================================================
function writeSheetFile(wb: XLSX.WorkBook, filename: string) {
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveFileBlob(filename, blob);
}

export function exportSopProductionExcel(rows: SopProductionRecord[], isAdmin: boolean = false) {
  if (!isAdmin) return;
  const wb = XLSX.utils.book_new();
  const data = rows.map((r) => ({
    Date: r.date,
    Shift: r.shift,
    Department: r.dept,
    Machine: normalizeMachineName(r.machine),
    Operator: r.operator,
    Assistant: r.assistant,
    Product: r.product,
    'Time Slot': r.timeSlot || '',
    Quantity: r.qty ?? '',
    Unit: r.unit || '',
    'Production (kg)': r.prodKg,
    'Scrap (kg)': r.scrapKg,
    'Wastage / Cut Dust (kg)': r.wastageCdKg,
    'Scrap Reason': r.scrapReason || '',
    'Breakdown Start': r.bdStart || '',
    'Breakdown End': r.bdEnd || '',
    'Breakdown Reason': r.bdReason || '',
    'Maintenance Technician': r.mtncePerson || '',
    'Reported By': r.reporter || r.loggedBy,
    Source: r.source,
  }));
  const ws = XLSX.utils.json_to_sheet(
    data.length ? data : [{ Notice: 'No production logs recorded yet.' }]
  );
  XLSX.utils.book_append_sheet(wb, ws, 'Production Log');
  writeSheetFile(wb, `LGPLAST_SOP_Production_${ymd(new Date())}.xlsx`);
}

export function exportSopQcExcel(rows: SopQcRecord[], isAdmin: boolean = false) {
  if (!isAdmin) return;
  const wb = XLSX.utils.book_new();
  const data = rows.map((q) => ({
    Date: q.date,
    'QC Check #': q.qcNo || '',
    Shift: q.shift,
    Machine: normalizeMachineName(q.machine),
    'Product Name': q.product,
    PPH: q.pph ?? '',
    'PPH Unit': q.pphUnit || '',
    'KGS per HR': q.kgsPerHr ?? '',
    Weight: q.weightKg ?? '',
    'Weight Type': q.weightType || '',
    Printing: q.printing || '',
    Length: q.lengthM ?? '',
    'Socket Size': q.socketSize || '',
    'Drop/Bend Test': q.dropBend,
    'Fitting Test': q.fitting,
    'Uniform Color': q.color,
    'O/D 1': q.od ?? '',
    'I/D': q.idMm ?? '',
    'Reported By': q.reporter || q.loggedBy,
    Time: q.time || '',
    Source: q.source,
  }));
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ Notice: 'No QC checks recorded yet.' }]);
  XLSX.utils.book_append_sheet(wb, ws, 'QC Check Report');
  writeSheetFile(wb, `LGPLAST_SOP_QC_${ymd(new Date())}.xlsx`);
}

export function exportSopScrapExcel(rows: SopScrapRecord[], isAdmin: boolean = false) {
  if (!isAdmin) return;
  const wb = XLSX.utils.book_new();
  const data = rows.map((s) => ({
    'Scrap ID': s.id,
    Date: s.date,
    Time: s.time,
    Shift: s.shift,
    'Shift In Charge': s.shiftInCharge,
    Machine: normalizeMachineName(s.machine),
    Product: s.product,
    'Sent By (Operator Assistant)': s.isCasualAssistant ? `${s.sentByAssistant} (Casual)` : s.sentByAssistant,
    'Scrap Sent (kg)': s.scrapKg,
    'Scrap Reason': s.scrapReason || '',
    'Assigned Recycler': s.assignedRecycler,
    'Received By (Recycling)': s.receivedBy || 'Pending',
    'Weighed Received (kg)': s.receivedKg ?? '',
    'Variance (kg)': s.varianceKg ?? '',
    Condition: s.condition || '',
    'Verification Status': s.verificationStatus || 'Awaiting',
    'Usable Material Processed (kg)': s.usableMaterialKg ?? '',
    'Recycling Waste Loss (kg)': s.recyclingWasteKg ?? '',
    'Processed By': s.processedBy || '',
    'Received By Mixer': s.receivedByMixerName || '',
    'Mixer Machine': s.mixerMachine ? normalizeMachineName(s.mixerMachine) : '',
    'Pipeline Status': s.status,
  }));
  const ws = XLSX.utils.json_to_sheet(
    data.length ? data : [{ Notice: 'No scrap pipeline records logged yet.' }]
  );
  XLSX.utils.book_append_sheet(wb, ws, 'Scrap & Recycling Pipeline');
  writeSheetFile(wb, `LGPLAST_SOP_Scrap_Recycling_${ymd(new Date())}.xlsx`);
}

export function exportSopMixingExcel(rows: SopMixingReport[], isAdmin: boolean = false) {
  if (!isAdmin) return;
  const wb = XLSX.utils.book_new();
  const data = rows.map((m) => ({
    'Mixing ID': m.id,
    Date: m.date,
    Time: m.time,
    Shift: m.shift,
    'Mixer Machine': normalizeMachineName(m.machine),
    'Mixer Operator': m.mixerName,
    'Mixer Assistant': m.assistantName,
    'WH Reserved Material Stock (kg)': m.whReservedMaterialKg,
    'Scrap Received from Recycling (kg)': m.scrapReceivedFromRecyclingKg,
    'WH Material Used in Mixing (kg)': m.whMaterialUsedKg,
    'Scrap Used in Mixing (kg)': m.scrapUsedInMixingKg,
    'Sweeping Material Generated (kg)': m.sweepingMaterialKg,
    'Batches Mixed': m.batchesMixed,
    'Pending Mix': m.pendingMix,
    'End-of-Mixing Stock Balance (kg)': m.endOfMixingStockKg,
    Ratio: m.ratio || '',
    'Mix Time/Batch (min)': m.mixTimeMin ?? '',
    'Speed (rpm)': m.speedRpm ?? '',
    'Mix Temp (°C)': m.mixTempC ?? '',
    'Cooler Time (min)': m.coolerTimeMin ?? '',
    'Cooler Release Temp (°C)': m.coolerReleaseTempC ?? '',
    'Hot Release Temp (°C)': m.hotReleaseTempC ?? '',
    'HOD Status': m.status,
    'Confirmed By HOD': m.hodConfirmedBy || 'Pending HOD',
    'HOD Notes': m.hodNotes || '',
  }));
  const ws = XLSX.utils.json_to_sheet(
    data.length ? data : [{ Notice: 'No mixing reports logged yet.' }]
  );
  XLSX.utils.book_append_sheet(wb, ws, 'Mixing & Stock Balance');
  writeSheetFile(wb, `LGPLAST_SOP_Mixing_Report_${ymd(new Date())}.xlsx`);
}

export function exportSopHandoverExcel(rows: SopShiftHandoverRecord[], isAdmin: boolean = false) {
  if (!isAdmin) return;
  const wb = XLSX.utils.book_new();
  const data = rows.map((h) => ({
    Date: h.date,
    Shift: h.shift,
    'Shift In Charge': h.inCharge,
    'Total Prod (kg)': h.totalProdKg,
    'Total Scrap (kg)': h.totalScrapKg,
    'Scrap %': h.scrapPct,
    'Ongoing Breakdown Notes': h.breakdownNotes,
    'Silo 1 (kg)': h.silo1Kg,
    'Silo 2 (kg)': h.silo2Kg,
    'Silo 3 (kg)': h.silo3Kg,
    'Silo 4 (kg)': h.silo4Kg,
    'Logged By': h.loggedBy,
  }));
  const ws = XLSX.utils.json_to_sheet(
    data.length ? data : [{ Notice: 'No shift handovers recorded yet.' }]
  );
  XLSX.utils.book_append_sheet(wb, ws, 'Shift Handover');
  writeSheetFile(wb, `LGPLAST_SOP_Shift_Handover_${ymd(new Date())}.xlsx`);
}

export function exportSopMasterWorkbook(
  args: {
    production: SopProductionRecord[];
    qcChecks: SopQcRecord[];
    scrapPipeline: SopScrapRecord[];
    mixingReports: SopMixingReport[];
    handovers: SopShiftHandoverRecord[];
  },
  isAdmin: boolean = false
) {
  if (!isAdmin) return;
  const wb = XLSX.utils.book_new();

  const totalProdKg = args.production.reduce((a, b) => a + (Number(b.prodKg) || 0), 0);
  const totalScrapKg = args.production.reduce((a, b) => a + (Number(b.scrapKg) || 0), 0);
  const totalWastageKg = args.production.reduce((a, b) => a + (Number(b.wastageCdKg) || 0), 0);
  const summaryRows = [
    { Metric: 'Total Production Output (kg)', Value: totalProdKg },
    { Metric: 'Total Scrap Logged (kg)', Value: totalScrapKg },
    { Metric: 'Total Wastage / Cut Dust (kg)', Value: totalWastageKg },
    { Metric: 'Total QC Checks', Value: args.qcChecks.length },
    { Metric: 'Total Scrap Handovers', Value: args.scrapPipeline.length },
    { Metric: 'Total Mixing Batches Reports', Value: args.mixingReports.length },
    { Metric: 'Total Shift Handovers', Value: args.handovers.length },
    { Metric: 'Generated At', Value: new Date().toLocaleString() },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary');

  const prodRows = args.production.map((r) => ({
    Date: r.date,
    Shift: r.shift,
    Department: r.dept,
    Machine: normalizeMachineName(r.machine),
    Operator: r.operator,
    Assistant: r.assistant,
    Product: r.product,
    Qty: r.qty ?? '',
    Unit: r.unit || '',
    'Prod (kg)': r.prodKg,
    'Scrap (kg)': r.scrapKg,
    'Wastage/CD (kg)': r.wastageCdKg,
    'Scrap Reason': r.scrapReason || '',
    'BD Start': r.bdStart || '',
    'BD End': r.bdEnd || '',
    'BD Reason': r.bdReason || '',
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(prodRows.length ? prodRows : [{ Notice: 'No entries' }]),
    'Production'
  );

  const qcRows = args.qcChecks.map((q) => ({
    Date: q.date,
    Shift: q.shift,
    Time: q.time || '',
    'QC No': q.qcNo || '',
    Machine: normalizeMachineName(q.machine),
    Product: q.product,
    PPH: q.pph ?? '',
    'Kgs/Hr': q.kgsPerHr ?? '',
    'Weight (kg)': q.weightKg ?? '',
    'O/D': q.od ?? '',
    'I/D': q.idMm ?? '',
    'Drop/Bend': q.dropBend,
    Fitting: q.fitting,
    Colour: q.color,
    'Reported By': q.reporter || q.loggedBy,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(qcRows.length ? qcRows : [{ Notice: 'No entries' }]),
    'QC Checks'
  );

  const scrapRows = args.scrapPipeline.map((s) => ({
    Date: s.date,
    Time: s.time,
    'Shift In Charge': s.shiftInCharge,
    Machine: normalizeMachineName(s.machine),
    Product: s.product,
    'Sent By': s.sentByAssistant,
    'Scrap Sent (kg)': s.scrapKg,
    Recycler: s.assignedRecycler,
    'Received (kg)': s.receivedKg ?? '',
    'Usable Material (kg)': s.usableMaterialKg ?? '',
    'Waste Loss (kg)': s.recyclingWasteKg ?? '',
    Status: s.status,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(scrapRows.length ? scrapRows : [{ Notice: 'No entries' }]),
    'Scrap & Recycling'
  );

  const mixRows = args.mixingReports.map((m) => ({
    Date: m.date,
    Shift: m.shift,
    Machine: normalizeMachineName(m.machine),
    'Mixer Operator': m.mixerName,
    'Mixer Assistant': m.assistantName,
    'WH Reserved (kg)': m.whReservedMaterialKg,
    'Scrap Recvd (kg)': m.scrapReceivedFromRecyclingKg,
    'WH Used (kg)': m.whMaterialUsedKg,
    'Scrap Used (kg)': m.scrapUsedInMixingKg,
    'Sweeping (kg)': m.sweepingMaterialKg,
    'Batches Mixed': m.batchesMixed,
    'Pending Mix': m.pendingMix,
    'End Stock (kg)': m.endOfMixingStockKg,
    Status: m.status,
    'HOD Confirmed By': m.hodConfirmedBy || 'Pending',
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(mixRows.length ? mixRows : [{ Notice: 'No entries' }]),
    'Mixing Reports'
  );

  const handRows = args.handovers.map((h) => ({
    Date: h.date,
    Shift: h.shift,
    'In Charge': h.inCharge,
    'Total Prod (kg)': h.totalProdKg,
    'Total Scrap (kg)': h.totalScrapKg,
    'Scrap %': h.scrapPct,
    Notes: h.breakdownNotes,
    'Silo 1': h.silo1Kg,
    'Silo 2': h.silo2Kg,
    'Silo 3': h.silo3Kg,
    'Silo 4': h.silo4Kg,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(handRows.length ? handRows : [{ Notice: 'No entries' }]),
    'Shift Handover'
  );

  writeSheetFile(wb, `LGPLAST_SOP_MASTER_${ymd(new Date())}.xlsx`);
}
