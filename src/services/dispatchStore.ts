import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db, ensureFirebaseAuth } from '../firebase';
import { DispatchEntry } from '../types';
import { saveFileBlob, ymd } from './downtimeCalc';

const DISPATCH_STORAGE_KEY = 'dt_dispatch_entries_v1';
const DISPATCH_PENDING_KEY = 'dt_dispatch_pending_v1';
const DISPATCH_COLLECTION = 'dispatch_entries';

let lastDispatchSyncError: string | null = null;

export function getLastDispatchSyncError(): string | null {
  return lastDispatchSyncError;
}

export function getStoredDispatches(): DispatchEntry[] {
  try {
    const raw = localStorage.getItem(DISPATCH_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
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
    if (e && e.id) map[e.id] = e;
  });
  remote.forEach((r) => {
    if (!r || !r.id) return;
    const existing = map[r.id];
    if (!existing || (r.upd || 0) >= (existing.upd || 0)) {
      map[r.id] = r;
    }
  });
  return Object.values(map).sort((a, b) => (b.upd || 0) - (a.upd || 0));
}

export async function saveDispatchEntryToFirebase(
  entry: DispatchEntry
): Promise<{ ok: boolean; error?: string }> {
  const updatedEntry: DispatchEntry = {
    ...entry,
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
 * Includes all 3 sections: Shift In Charge -> WH Personnel -> Production HOD Confirmation
 */
export function exportDispatchExcelWorkbook(
  entries: DispatchEntry[],
  fromDate: string,
  toDate: string
) {
  const filtered = entries
    .filter((e) => e.date >= fromDate && e.date <= toDate)
    .sort((a, b) => (b.date + b.shiftSubmittedAt).localeCompare(a.date + a.shiftSubmittedAt));

  const confirmedOnly = filtered.filter((e) => e.status === 'CONFIRMED');

  const formatRow = (e: DispatchEntry) => {
    const whQty = typeof e.whReceivedQty === 'number' ? e.whReceivedQty : '';
    const variance =
      typeof e.whReceivedQty === 'number' ? e.whReceivedQty - e.recordedQty : '';
    return {
      'Dispatch ID': e.id,
      Date: e.date,
      Shift: e.shift,
      'Machine Name': e.machine,
      'Product Dispatched': e.product,
      'Trolley No.': e.trolleyNo,
      'Shift Qty Recorded': e.recordedQty,
      'Operator Name': e.operatorName,
      'Assistant / General Hand': e.isCasualAssistant
        ? `${e.assistantName} (Casual)`
        : e.assistantName,
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
      'WH Personnel Name': e.whPersonnelName || '',
      'WH Signature Captured': e.whSignature ? 'YES (Digitally Signed)' : 'Pending',
      'WH Confirmed Time': e.whConfirmedAt ? new Date(e.whConfirmedAt).toLocaleString() : '',
      'WH Notes': e.whNotes || '',
      'Production HOD Final Confirmer': e.hodConfirmedByName || '',
      'HOD Signature Captured': e.hodSignature ? 'YES (Digitally Signed)' : e.status === 'CONFIRMED' ? 'Verified' : 'Pending',
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

  const confirmedRows =
    confirmedOnly.length > 0
      ? confirmedOnly.map(formatRow)
      : [
          {
            Notice: `No Production HOD confirmed dispatches found between ${fromDate} and ${toDate}.`,
          },
        ];
  const wsConfirmed = XLSX.utils.aoa_to_sheet([
    ['LG PLAST — Affordable / Durable / Complete'],
    ['CONFIDENTIAL SHIFT STOCK DISPATCH VERIFICATION LEDGER (CONFIRMED)'],
    [`Period: ${fromDate} to ${toDate}`, `Generated: ${new Date().toLocaleString()}`],
    [],
  ]);
  XLSX.utils.sheet_add_json(wsConfirmed, confirmedRows, { origin: 'A5' });
  XLSX.utils.book_append_sheet(wb, wsConfirmed, 'Confirmed Dispatch Ledger');

  const allRows =
    filtered.length > 0
      ? filtered.map(formatRow)
      : [{ Notice: `No dispatch entries found between ${fromDate} and ${toDate}.` }];
  const wsAll = XLSX.utils.aoa_to_sheet([
    ['LG PLAST — Affordable / Durable / Complete'],
    ['CONFIDENTIAL DISPATCH PIPELINE REPORT (ALL STAGES)'],
    [`Period: ${fromDate} to ${toDate}`, `Generated: ${new Date().toLocaleString()}`],
    [],
  ]);
  XLSX.utils.sheet_add_json(wsAll, allRows, { origin: 'A5' });
  XLSX.utils.book_append_sheet(wb, wsAll, 'All Dispatch Pipeline');

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveFileBlob(`LGPLAST_confidential_dispatch_report_${fromDate}_to_${toDate}_${ymd(new Date())}.xlsx`, blob);
}
