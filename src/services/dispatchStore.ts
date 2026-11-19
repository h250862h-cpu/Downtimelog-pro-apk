import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db, ensureFirebaseAuth } from '../firebase';
import { DispatchEntry, normalizeMachineName, SopProductionRecord } from '../types';
import { FACTORY_STAFF_ROSTER } from '../types/factoryStaff';
import { saveFileBlob, ymd } from './downtimeCalc';
import { getLinkedScrapAndWastageForDispatch } from './sopStore';

/**
 * Matches a typed/saved name against the official Factory Staff Roster.
 * Supports exact case-insensitive match or unambiguous prefix/full-token match (min 4 chars).
 */
export function matchFactoryRosterStaff(rawName?: string) {
  const clean = (rawName || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!clean || clean === '—' || clean === '-') return null;

  const exact = FACTORY_STAFF_ROSTER.find(
    (s) => s.name.trim().toLowerCase().replace(/\s+/g, ' ') === clean
  );
  if (exact) return exact;

  if (clean.length >= 4) {
    const tokenMatches = FACTORY_STAFF_ROSTER.filter((s) => {
      const full = s.name.trim().toLowerCase().replace(/\s+/g, ' ');
      const firstWord = full.split(' ')[0];
      return full.startsWith(clean) || (firstWord.length >= 4 && firstWord === clean);
    });
    if (tokenMatches.length === 1) return tokenMatches[0];
  }
  return null;
}

/**
 * If an Operator or Assistant from the permanent factory staff list was mistakenly
 * entered as Casual Help (`isCasualAssistant` or `casualAssistantName`), returns them
 * cleanly to their proper area (Operator or Assistant) and clears the Casual tag.
 */
export function normalizeDispatchStaffAreas(entry: DispatchEntry): {
  entry: DispatchEntry;
  corrected: boolean;
} {
  let operatorName = (entry.operatorName || '').trim();
  let assistantName = (entry.assistantName || '').trim();
  let isCasualAssistant = Boolean(entry.isCasualAssistant);
  let casualAssistantName = (entry.casualAssistantName || '').trim();
  let corrected = false;

  const inspectCandidate = (rawName: string) => {
    const matched = matchFactoryRosterStaff(rawName);
    if (!matched) return null;
    const des = matched.designation.toLowerCase();
    const isOperator = des.includes('operator');
    const isAssistant = des.includes('assistant');
    return { matched, isOperator, isAssistant };
  };

  // 1. Check casualAssistantName field first
  if (casualAssistantName) {
    const res = inspectCandidate(casualAssistantName);
    if (res) {
      corrected = true;
      if (res.isOperator) {
        if (
          !operatorName ||
          operatorName.toLowerCase() === 'plant operator' ||
          operatorName.toLowerCase() === res.matched.name.toLowerCase()
        ) {
          operatorName = res.matched.name;
        } else if (!operatorName.toLowerCase().includes(res.matched.name.toLowerCase())) {
          operatorName = `${operatorName} / ${res.matched.name}`;
        }
        if (
          isCasualAssistant &&
          assistantName.toLowerCase().replace(/\s+/g, ' ') ===
            casualAssistantName.toLowerCase().replace(/\s+/g, ' ')
        ) {
          assistantName = '—';
        }
      } else {
        assistantName = res.matched.name;
      }
      casualAssistantName = '';
      isCasualAssistant = false;
    }
  }

  // 2. Check assistantName if marked as Casual or if an Operator was placed in Assistant
  if (assistantName && (isCasualAssistant || inspectCandidate(assistantName)?.isOperator)) {
    const res = inspectCandidate(assistantName);
    if (res) {
      corrected = true;
      if (res.isOperator) {
        if (
          !operatorName ||
          operatorName.toLowerCase() === 'plant operator' ||
          operatorName.toLowerCase() === res.matched.name.toLowerCase()
        ) {
          operatorName = res.matched.name;
        } else if (!operatorName.toLowerCase().includes(res.matched.name.toLowerCase())) {
          operatorName = `${operatorName} / ${res.matched.name}`;
        }
        assistantName = '—';
      } else {
        assistantName = res.matched.name;
      }
      isCasualAssistant = false;
      casualAssistantName = '';
    }
  }

  return {
    corrected,
    entry: {
      ...entry,
      operatorName,
      assistantName,
      isCasualAssistant,
      casualAssistantName: casualAssistantName || undefined,
    },
  };
}

const DISPATCH_STORAGE_KEY = 'dt_dispatch_entries_v1';
const DISPATCH_PENDING_KEY = 'dt_dispatch_pending_v1';
const DISPATCH_COLLECTION = 'dispatch_entries';

let lastDispatchSyncError: string | null = null;

export function getLastDispatchSyncError(): string | null {
  return lastDispatchSyncError;
}

export function normalizeDispatchEntry(entry: DispatchEntry): DispatchEntry {
  const { entry: areaNormalized } = normalizeDispatchStaffAreas(entry);
  return {
    ...areaNormalized,
    machine: normalizeMachineName(areaNormalized.machine),
  };
}

export function getStoredDispatches(): DispatchEntry[] {
  try {
    const raw = localStorage.getItem(DISPATCH_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeDispatchEntry) : [];
  } catch {
    return [];
  }
}

export function saveStoredDispatches(entries: DispatchEntry[]) {
  try {
    localStorage.setItem(DISPATCH_STORAGE_KEY, JSON.stringify(entries));
  } catch (e) {
    console.warn('Failed saving dispatches to localStorage:', e);
  }
}

export function getPendingDispatchQueue(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISPATCH_PENDING_KEY) || '[]');
  } catch {
    return [];
  }
}

function addPendingDispatchId(id: string) {
  try {
    const q = getPendingDispatchQueue();
    if (!q.includes(id)) {
      q.push(id);
      localStorage.setItem(DISPATCH_PENDING_KEY, JSON.stringify(q));
    }
  } catch {}
}

function removePendingDispatchId(id: string) {
  try {
    const q = getPendingDispatchQueue().filter((x) => x !== id);
    localStorage.setItem(DISPATCH_PENDING_KEY, JSON.stringify(q));
  } catch {}
}

function sanitizeDispatchForFirestore<T extends Record<string, any>>(obj: T): T {
  const clean: Record<string, any> = {};
  Object.keys(obj).forEach((k) => {
    const val = obj[k];
    if (val !== undefined && !Number.isNaN(val)) {
      clean[k] = val;
    }
  });
  return clean as T;
}

function mergeDispatches(local: DispatchEntry[], remote: DispatchEntry[]): DispatchEntry[] {
  const map: Record<string, DispatchEntry> = {};
  local.forEach((e) => {
    if (e && e.id) map[e.id] = normalizeDispatchEntry(e);
  });
  remote.forEach((r) => {
    if (!r || !r.id) return;
    const normR = normalizeDispatchEntry(r);
    const existing = map[normR.id];
    if (!existing || (normR.upd || 0) >= (existing.upd || 0)) {
      map[normR.id] = normR;
    }
  });
  return Object.values(map).sort((a, b) => (b.upd || 0) - (a.upd || 0));
}

export async function saveDispatchEntryToFirebase(
  entry: DispatchEntry
): Promise<{ ok: boolean; error?: string }> {
  const normEntry = normalizeDispatchEntry(entry);
  const updatedEntry: DispatchEntry = {
    ...normEntry,
    upd: Date.now(),
  };

  // Persist locally immediately
  const local = getStoredDispatches();
  const idx = local.findIndex((x) => x.id === updatedEntry.id);
  const nextLocal = [...local];
  if (idx >= 0) {
    nextLocal[idx] = updatedEntry;
  } else {
    nextLocal.unshift(updatedEntry);
  }
  saveStoredDispatches(nextLocal);

  try {
    await ensureFirebaseAuth();
    const payload = sanitizeDispatchForFirestore({
      ...updatedEntry,
      sy: Date.now(),
    });
    const docRef = doc(db, DISPATCH_COLLECTION, updatedEntry.id);
    await setDoc(docRef, payload, { merge: true });

    removePendingDispatchId(updatedEntry.id);
    lastDispatchSyncError = null;

    // Update sync timestamp in local cache
    const latest = getStoredDispatches().map((x) =>
      x.id === updatedEntry.id ? { ...x, sy: payload.sy } : x
    );
    saveStoredDispatches(latest);

    return { ok: true };
  } catch (err: any) {
    const msg = err?.message || 'Failed syncing dispatch entry to cloud';
    lastDispatchSyncError = msg;
    addPendingDispatchId(updatedEntry.id);
    return { ok: false, error: msg };
  }
}

export async function flushPendingDispatches(): Promise<number> {
  const pendingIds = getPendingDispatchQueue();
  if (!pendingIds.length) return 0;

  const local = getStoredDispatches();
  let flushed = 0;
  for (const id of pendingIds) {
    const found = local.find((e) => e.id === id);
    if (found) {
      const res = await saveDispatchEntryToFirebase(found);
      if (res.ok) flushed++;
    } else {
      removePendingDispatchId(id);
    }
  }
  return flushed;
}

export async function pollDispatchEntries(): Promise<DispatchEntry[]> {
  try {
    await ensureFirebaseAuth();
    const snap = await getDocs(collection(db, DISPATCH_COLLECTION));
    const remote: DispatchEntry[] = [];
    snap.forEach((d) => {
      remote.push(d.data() as DispatchEntry);
    });
    const merged = mergeDispatches(getStoredDispatches(), remote);
    saveStoredDispatches(merged);
    lastDispatchSyncError = null;
    return merged;
  } catch (err: any) {
    lastDispatchSyncError = err?.message || null;
    return getStoredDispatches();
  }
}

export function subscribeDispatchEntries(
  onUpdate: (entries: DispatchEntry[]) => void,
  onSyncError?: (msg: string | null) => void
) {
  onUpdate(getStoredDispatches());

  let unsub: () => void = () => {};
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let cancelled = false;

  const start = async () => {
    await ensureFirebaseAuth();
    if (cancelled) return;

    try {
      const colRef = collection(db, DISPATCH_COLLECTION);
      unsub = onSnapshot(
        colRef,
        (snapshot) => {
          const remote: DispatchEntry[] = [];
          snapshot.forEach((d) => {
            remote.push(d.data() as DispatchEntry);
          });
          const merged = mergeDispatches(getStoredDispatches(), remote);
          saveStoredDispatches(merged);
          lastDispatchSyncError = null;
          onSyncError?.(null);
          onUpdate(merged);
          flushPendingDispatches().catch(() => {});
        },
        (err) => {
          console.warn('Dispatch Firestore listener warning:', err.message);
          lastDispatchSyncError = err.message;
          onSyncError?.(err.message);
        }
      );
    } catch (e: any) {
      lastDispatchSyncError = e?.message || 'Dispatch subscription failed';
      onSyncError?.(lastDispatchSyncError);
    }

    pollDispatchEntries()
      .then((merged) => onUpdate(merged))
      .catch(() => {});

    pollTimer = setInterval(() => {
      pollDispatchEntries()
        .then((merged) => onUpdate(merged))
        .catch(() => {});
    }, 20000);
  };

  start();

  return () => {
    cancelled = true;
    unsub();
    if (pollTimer) clearInterval(pollTimer);
  };
}

/**
 * Generates Confidential Multi-Sheet Dispatch Excel Report (.xlsx)
 * Sheet 1: Standard Dispatch & Linked Production Scrap/Wastage Ledger
 * Sheet 2: Full 3-Stage Verification Audit (Trolley, Signatures, WH Variance)
 */
export function exportDispatchExcelWorkbook(
  entries: DispatchEntry[],
  fromDate: string,
  toDate: string,
  productionLogs: SopProductionRecord[] = []
) {
  const filtered = entries
    .filter((e) => e.date >= fromDate && e.date <= toDate)
    .sort((a, b) => (b.date + b.shiftSubmittedAt).localeCompare(a.date + a.shiftSubmittedAt));

  const formatStandardRow = (rawEntry: DispatchEntry) => {
    const { entry: e } = normalizeDispatchStaffAreas(rawEntry);
    const effectiveQty =
      typeof e.whReceivedQty === 'number' ? e.whReceivedQty : e.recordedQty;
    const totalKg =
      typeof e.unitWeightKg === 'number' && e.unitWeightKg > 0
        ? Number((effectiveQty * e.unitWeightKg).toFixed(2))
        : typeof e.totalWeightKg === 'number'
        ? Number(e.totalWeightKg.toFixed(2))
        : '';
    const linked = getLinkedScrapAndWastageForDispatch(e, productionLogs);
    const casualName =
      (e.casualAssistantName || '').trim() ||
      (e.isCasualAssistant ? e.assistantName : '') ||
      '—';

    return {
      Date: e.date,
      Shift: e.shift,
      Operator: e.operatorName,
      Assistant: e.assistantName,
      Product: e.product,
      Process: 'Dispatch',
      Machine: normalizeMachineName(e.machine),
      Qty: effectiveQty,
      'Qty (kg)': totalKg,
      'Scrap (kg)': linked.matchedCount > 0 ? linked.scrapKg : (e.backgroundScrapKg ?? 0),
      'Wastage (kg)': linked.matchedCount > 0 ? linked.wastageKg : (e.backgroundWastageKg ?? 0),
      'Issued To': e.whPersonnelName || 'Pending WH',
      'Casual Assisted': casualName,
    };
  };

  const formatAuditRow = (rawEntry: DispatchEntry) => {
    const { entry: e } = normalizeDispatchStaffAreas(rawEntry);
    const whQty = typeof e.whReceivedQty === 'number' ? e.whReceivedQty : '';
    const variance =
      typeof e.whReceivedQty === 'number' ? e.whReceivedQty - e.recordedQty : '';
    const effectiveQty =
      typeof e.whReceivedQty === 'number' ? e.whReceivedQty : e.recordedQty;
    const totalKg =
      typeof e.unitWeightKg === 'number' && e.unitWeightKg > 0
        ? Number((effectiveQty * e.unitWeightKg).toFixed(2))
        : typeof e.totalWeightKg === 'number'
        ? Number(e.totalWeightKg.toFixed(2))
        : '';
    const linked = getLinkedScrapAndWastageForDispatch(e, productionLogs);

    return {
      'Dispatch ID': e.id,
      Date: e.date,
      Shift: e.shift,
      'Machine Name': normalizeMachineName(e.machine),
      'Product Dispatched': e.product,
      Process: 'Dispatch',
      'Trolley No.': e.trolleyNo,
      'Shift Qty Recorded': e.recordedQty,
      'Unit Wt (kg)': typeof e.unitWeightKg === 'number' ? e.unitWeightKg : '',
      'Total Qty (kg)': totalKg,
      'Linked Production Scrap (kg)': linked.matchedCount > 0 ? linked.scrapKg : (e.backgroundScrapKg ?? 0),
      'Linked Production Wastage (kg)': linked.matchedCount > 0 ? linked.wastageKg : (e.backgroundWastageKg ?? 0),
      'Operator Name': e.operatorName,
      'Assistant / General Hand': e.isCasualAssistant
        ? `${e.assistantName} (Casual)`
        : e.assistantName,
      'Casual Who Assisted': e.casualAssistantName || (e.isCasualAssistant ? e.assistantName : '—'),
      'Shift In Charge': e.shiftInChargeName,
      'Shift Signature Captured': e.shiftInChargeSignature ? 'YES (Digitally Signed)' : 'No',
      'Shift Logged Time': e.shiftSubmittedAt ? new Date(e.shiftSubmittedAt).toLocaleString() : '',
      'Shift Notes': e.shiftNotes || '',
      'WH Qty Received': whQty,
      'Previous WH Qty':
        typeof e.whPreviousReceivedQty === 'number' ? e.whPreviousReceivedQty : '',
      'Qty Variance (WH - Shift)': variance,
      'WH Qty Edit Reason': e.whQtyEditReason || '',
      'WH Qty Edited By': e.whQtyEditedBy || '',
      'WH Qty Edited At': e.whQtyEditedAt ? new Date(e.whQtyEditedAt).toLocaleString() : '',
      'Issued To (WH Personnel)': e.whPersonnelName || '',
      'WH Signature Captured': e.whSignature ? 'YES (Digitally Signed)' : 'Pending',
      'WH Confirmed Time': e.whConfirmedAt ? new Date(e.whConfirmedAt).toLocaleString() : '',
      'WH Notes': e.whNotes || '',
      'Production HOD Final Confirmer': e.hodConfirmedByName || '',
      'HOD Signature Captured': e.hodSignature
        ? 'YES (Digitally Signed)'
        : e.status === 'CONFIRMED'
        ? 'Verified'
        : 'Pending',
      'HOD Final Confirmed Time': e.hodConfirmedAt ? new Date(e.hodConfirmedAt).toLocaleString() : '',
      'HOD Notes': e.hodNotes || '',
      'Workflow Status':
        e.status === 'CONFIRMED'
          ? 'CONFIRMED DISPATCH'
          : e.status === 'PENDING_HOD'
          ? 'Awaiting Production HOD'
          : 'Awaiting WH Personnel',
    };
  };

  const wb = XLSX.utils.book_new();

  const standardRows =
    filtered.length > 0
      ? filtered.map(formatStandardRow)
      : [
          {
            Notice: `No dispatch entries found between ${fromDate} and ${toDate}.`,
          },
        ];
  const wsStandard = XLSX.utils.aoa_to_sheet([
    ['LG PLAST — Affordable / Durable / Complete'],
    ['DISPATCH & LINKED PRODUCTION SCRAP / WASTAGE LEDGER'],
    [`Period: ${fromDate} to ${toDate}`, `Generated: ${new Date().toLocaleString()}`],
    [],
  ]);
  XLSX.utils.sheet_add_json(wsStandard, standardRows, { origin: 'A5' });
  XLSX.utils.book_append_sheet(wb, wsStandard, 'Dispatch Ledger');

  const auditRows =
    filtered.length > 0
      ? filtered.map(formatAuditRow)
      : [{ Notice: `No dispatch entries found between ${fromDate} and ${toDate}.` }];
  const wsAudit = XLSX.utils.aoa_to_sheet([
    ['LG PLAST — Affordable / Durable / Complete'],
    ['DISPATCH 3-STAGE VERIFICATION & AUDIT (TROLLEYS, WEIGHTS, SIGNATURES)'],
    [`Period: ${fromDate} to ${toDate}`, `Generated: ${new Date().toLocaleString()}`],
    [],
  ]);
  XLSX.utils.sheet_add_json(wsAudit, auditRows, { origin: 'A5' });
  XLSX.utils.book_append_sheet(wb, wsAudit, 'Verification Audit');

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveFileBlob(`LGPLAST_confidential_dispatch_report_${fromDate}_to_${toDate}_${ymd(new Date())}.xlsx`, blob);
}
