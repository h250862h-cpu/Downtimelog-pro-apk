import { collection, doc, getDoc, getDocs, onSnapshot, setDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db, ensureFirebaseAuth } from '../firebase';
import {
  DieselFuelRequest,
  DieselGrnRecord,
  DieselTankConfig,
} from '../types';
import { generateFuelGrnPdf, generateFuelRequestApprovalPdf } from './dieselPdf';
import { r2, saveFileBlob } from './downtimeCalc';

const TANK_KEY = 'lgplast_diesel_tank_v1';
const TANK_PENDING_KEY = 'lgplast_diesel_tank_pending_v1';
const TANK_COLLECTION = 'diesel_tank_config';

const REQ_KEY = 'lgplast_diesel_requests_v1';
const REQ_PENDING_KEY = 'lgplast_diesel_requests_pending_v1';
const REQ_COLLECTION = 'diesel_fuel_requests';

const GRN_KEY = 'lgplast_diesel_grns_v1';
const GRN_PENDING_KEY = 'lgplast_diesel_grns_pending_v1';
const GRN_COLLECTION = 'diesel_grn_records';

export const DEFAULT_TANK_CONFIG: DieselTankConfig = {
  id: 'main_bowser',
  tankName: 'Main Factory Diesel Bowser Tank',
  capacityLitres: 10000,
  currentLevelLitres: 5000,
  currentMeterReading: 12000,
  totalReceivedLitres: 0,
  totalIssuedLitres: 0,
  lastUpdatedAt: new Date().toISOString(),
  lastUpdatedBy: 'Initial Setup',
  upd: 1,
};

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
    console.warn(`Failed writing ${key} to localStorage:`, e);
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

function sanitizeObj<T extends Record<string, any>>(obj: T): T {
  const clean: Record<string, any> = {};
  Object.keys(obj).forEach((k) => {
    const v = obj[k];
    if (v !== undefined && !(typeof v === 'number' && Number.isNaN(v))) {
      clean[k] = v;
    }
  });
  return clean as T;
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
// 1. DIESEL BOWSER TANK CONFIG STORE
// ======================================================
export function getLocalDieselTank(): DieselTankConfig {
  try {
    const raw = localStorage.getItem(TANK_KEY);
    if (!raw) return DEFAULT_TANK_CONFIG;
    const parsed = JSON.parse(raw) as DieselTankConfig;
    if (!parsed || parsed.id !== 'main_bowser') return DEFAULT_TANK_CONFIG;
    return parsed;
  } catch {
    return DEFAULT_TANK_CONFIG;
  }
}

export function saveLocalDieselTank(tank: DieselTankConfig) {
  try {
    localStorage.setItem(TANK_KEY, JSON.stringify(tank));
  } catch {}
}

export async function saveDieselTankConfig(
  tank: DieselTankConfig
): Promise<{ ok: boolean; error?: string }> {
  const next: DieselTankConfig = {
    ...tank,
    id: 'main_bowser',
    upd: Date.now(),
    lastUpdatedAt: new Date().toISOString(),
  };
  saveLocalDieselTank(next);

  try {
    await ensureFirebaseAuth();
    await setDoc(doc(db, TANK_COLLECTION, 'main_bowser'), sanitizeObj({ ...next, sy: Date.now() }), {
      merge: true,
    });
    localStorage.removeItem(TANK_PENDING_KEY);
    return { ok: true };
  } catch (err: any) {
    try {
      localStorage.setItem(TANK_PENDING_KEY, '1');
    } catch {}
    return { ok: false, error: err?.message || 'Saved tank level locally; cloud sync queued' };
  }
}

export async function pollDieselTank(): Promise<DieselTankConfig> {
  const local = getLocalDieselTank();
  try {
    await ensureFirebaseAuth();
    const snap = await getDoc(doc(db, TANK_COLLECTION, 'main_bowser'));
    if (snap.exists()) {
      const remote = snap.data() as DieselTankConfig;
      if ((remote.upd || 0) >= (local.upd || 0)) {
        saveLocalDieselTank(remote);
        return remote;
      }
    }
  } catch {}
  return local;
}

export function subscribeDieselTank(onUpdate: (tank: DieselTankConfig) => void) {
  onUpdate(getLocalDieselTank());
  let unsub: () => void = () => {};
  let cancelled = false;

  const start = async () => {
    await ensureFirebaseAuth();
    if (cancelled) return;
    try {
      unsub = onSnapshot(
        doc(db, TANK_COLLECTION, 'main_bowser'),
        (snap) => {
          const local = getLocalDieselTank();
          if (snap.exists()) {
            const remote = snap.data() as DieselTankConfig;
            if ((remote.upd || 0) >= (local.upd || 0)) {
              saveLocalDieselTank(remote);
              onUpdate(remote);
            } else {
              onUpdate(local);
            }
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
// 2. DIESEL FUEL REQUESTS STORE
// ======================================================
export function getLocalDieselRequests(): DieselFuelRequest[] {
  return readLocalList<DieselFuelRequest>(REQ_KEY);
}

export async function saveDieselRequest(
  req: DieselFuelRequest
): Promise<{ ok: boolean; error?: string }> {
  const updated: DieselFuelRequest = { ...req, upd: Date.now() };
  const merged = mergeById(getLocalDieselRequests(), [updated]);
  writeLocalList(REQ_KEY, merged);

  try {
    await ensureFirebaseAuth();
    await setDoc(doc(db, REQ_COLLECTION, updated.id), sanitizeObj({ ...updated, sy: Date.now() }), {
      merge: true,
    });
    removeFromQueue(REQ_PENDING_KEY, updated.id);
    return { ok: true };
  } catch (err: any) {
    addToQueue(REQ_PENDING_KEY, updated.id);
    return { ok: false, error: err?.message || 'Offline cached; queued for sync' };
  }
}

export async function pollDieselRequests(): Promise<DieselFuelRequest[]> {
  try {
    await ensureFirebaseAuth();
    const snap = await getDocs(collection(db, REQ_COLLECTION));
    const remote: DieselFuelRequest[] = [];
    snap.forEach((d) => remote.push(d.data() as DieselFuelRequest));
    const merged = mergeById(getLocalDieselRequests(), remote);
    writeLocalList(REQ_KEY, merged);
    return merged;
  } catch {
    return getLocalDieselRequests();
  }
}

export function subscribeDieselRequests(onUpdate: (reqs: DieselFuelRequest[]) => void) {
  onUpdate(getLocalDieselRequests());
  let unsub: () => void = () => {};
  let cancelled = false;

  const start = async () => {
    await ensureFirebaseAuth();
    if (cancelled) return;
    try {
      unsub = onSnapshot(
        collection(db, REQ_COLLECTION),
        (snap) => {
          const remote: DieselFuelRequest[] = [];
          snap.forEach((d) => remote.push(d.data() as DieselFuelRequest));
          const merged = mergeById(getLocalDieselRequests(), remote);
          writeLocalList(REQ_KEY, merged);
          onUpdate(merged);
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
// 3. DIESEL FUEL GRN STORE
// ======================================================
export function getLocalDieselGrns(): DieselGrnRecord[] {
  return readLocalList<DieselGrnRecord>(GRN_KEY);
}

export async function saveDieselGrn(
  grn: DieselGrnRecord
): Promise<{ ok: boolean; error?: string }> {
  const updated: DieselGrnRecord = { ...grn, upd: Date.now() };
  const merged = mergeById(getLocalDieselGrns(), [updated]);
  writeLocalList(GRN_KEY, merged);

  try {
    await ensureFirebaseAuth();
    await setDoc(doc(db, GRN_COLLECTION, updated.id), sanitizeObj({ ...updated, sy: Date.now() }), {
      merge: true,
    });
    removeFromQueue(GRN_PENDING_KEY, updated.id);
    return { ok: true };
  } catch (err: any) {
    addToQueue(GRN_PENDING_KEY, updated.id);
    return { ok: false, error: err?.message || 'Offline cached; queued for sync' };
  }
}

export async function pollDieselGrns(): Promise<DieselGrnRecord[]> {
  try {
    await ensureFirebaseAuth();
    const snap = await getDocs(collection(db, GRN_COLLECTION));
    const remote: DieselGrnRecord[] = [];
    snap.forEach((d) => remote.push(d.data() as DieselGrnRecord));
    const merged = mergeById(getLocalDieselGrns(), remote);
    writeLocalList(GRN_KEY, merged);
    return merged;
  } catch {
    return getLocalDieselGrns();
  }
}

export function subscribeDieselGrns(onUpdate: (grns: DieselGrnRecord[]) => void) {
  onUpdate(getLocalDieselGrns());
  let unsub: () => void = () => {};
  let cancelled = false;

  const start = async () => {
    await ensureFirebaseAuth();
    if (cancelled) return;
    try {
      unsub = onSnapshot(
        collection(db, GRN_COLLECTION),
        (snap) => {
          const remote: DieselGrnRecord[] = [];
          snap.forEach((d) => remote.push(d.data() as DieselGrnRecord));
          const merged = mergeById(getLocalDieselGrns(), remote);
          writeLocalList(GRN_KEY, merged);
          onUpdate(merged);
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

export async function flushPendingDieselData(): Promise<number> {
  let flushed = 0;
  try {
    await ensureFirebaseAuth();
    if (localStorage.getItem(TANK_PENDING_KEY) === '1') {
      const tank = getLocalDieselTank();
      await setDoc(doc(db, TANK_COLLECTION, 'main_bowser'), sanitizeObj({ ...tank, sy: Date.now() }), {
        merge: true,
      });
      localStorage.removeItem(TANK_PENDING_KEY);
      flushed++;
    }

    const reqQueue = readQueue(REQ_PENDING_KEY);
    if (reqQueue.length) {
      const allReqs = getLocalDieselRequests();
      for (const id of reqQueue) {
        const found = allReqs.find((r) => r.id === id);
        if (!found) {
          removeFromQueue(REQ_PENDING_KEY, id);
          continue;
        }
        try {
          await setDoc(doc(db, REQ_COLLECTION, found.id), sanitizeObj({ ...found, sy: Date.now() }), {
            merge: true,
          });
          removeFromQueue(REQ_PENDING_KEY, found.id);
          flushed++;
        } catch {}
      }
    }

    const grnQueue = readQueue(GRN_PENDING_KEY);
    if (grnQueue.length) {
      const allGrns = getLocalDieselGrns();
      for (const id of grnQueue) {
        const found = allGrns.find((g) => g.id === id);
        if (!found) {
          removeFromQueue(GRN_PENDING_KEY, id);
          continue;
        }
        try {
          await setDoc(doc(db, GRN_COLLECTION, found.id), sanitizeObj({ ...found, sy: Date.now() }), {
            merge: true,
          });
          removeFromQueue(GRN_PENDING_KEY, found.id);
          flushed++;
        } catch {}
      }
    }
  } catch {}
  return flushed;
}

// ======================================================
// 4. WORKFLOW ACTIONS (3-STAGE BOWSER GATE + GRN TOP-UP)
// ======================================================
export async function submitFuelRequest(params: {
  date: string;
  shift: 'Day' | 'Night';
  vehicleOrForklift: string;
  driverName: string;
  driverEmail: string;
  requestedLitres: number;
  purpose: string;
  driverRequestSignature: string;
}): Promise<{ ok: boolean; request: DieselFuelRequest; error?: string }> {
  const now = new Date();
  const shortTime = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const reqNo = `FUEL-${params.date.replace(/-/g, '').slice(2)}-${shortTime}-${Math.floor(Math.random() * 90 + 10)}`;

  const req: DieselFuelRequest = {
    id: `DREQ-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
    requestNo: reqNo,
    date: params.date,
    shift: params.shift,
    vehicleOrForklift: params.vehicleOrForklift.trim(),
    driverName: params.driverName.trim(),
    driverEmail: params.driverEmail.trim(),
    requestedLitres: r2(params.requestedLitres),
    purpose: params.purpose.trim() || undefined,
    driverRequestSignature: params.driverRequestSignature,
    requestedAt: now.toISOString(),
    status: 'PENDING_HOD',
    pdfGeneratedOnce: false,
    pdfUnlockedDispense: false,
    upd: Date.now(),
  };

  const res = await saveDieselRequest(req);
  return { ok: res.ok, request: req, error: res.error };
}

/**
 * STAGE 2: Production HOD Approval + 1-Time PDF Generation
 * Strictly enforces generating the approval voucher PDF ONCE to unlock Stage 3 meter dispense.
 */
export async function approveFuelRequestAndUnlockPdf(params: {
  request: DieselFuelRequest;
  tank: DieselTankConfig;
  hodName: string;
  approvedLitres: number;
  hodNotes: string;
  hodSignature: string;
}): Promise<{ ok: boolean; updated?: DieselFuelRequest; error?: string }> {
  const { request, tank, hodName, approvedLitres, hodNotes, hodSignature } = params;

  if (request.pdfGeneratedOnce || request.status !== 'PENDING_HOD') {
    return {
      ok: false,
      error: `Voucher PDF for ${request.requestNo} was already generated once and Stage 3 is unlocked.`,
    };
  }

  const nowIso = new Date().toISOString();
  const updated: DieselFuelRequest = {
    ...request,
    status: 'APPROVED_FOR_DISPENSE',
    hodApprovedBy: hodName.trim(),
    hodApprovedLitres: r2(approvedLitres),
    hodNotes: hodNotes.trim() || undefined,
    hodSignature,
    hodApprovedAt: nowIso,
    pdfGeneratedOnce: true,
    pdfGeneratedAt: nowIso,
    pdfUnlockedDispense: true,
    upd: Date.now(),
  };

  const res = await saveDieselRequest(updated);
  await generateFuelRequestApprovalPdf(updated, tank);

  return { ok: res.ok, updated, error: res.error };
}

export async function rejectFuelRequest(params: {
  request: DieselFuelRequest;
  hodName: string;
  hodNotes: string;
}): Promise<{ ok: boolean; updated: DieselFuelRequest; error?: string }> {
  const updated: DieselFuelRequest = {
    ...params.request,
    status: 'REJECTED',
    hodApprovedBy: params.hodName.trim(),
    hodNotes: params.hodNotes.trim() || 'Request declined by Production HOD',
    hodApprovedAt: new Date().toISOString(),
    pdfUnlockedDispense: false,
    upd: Date.now(),
  };
  const res = await saveDieselRequest(updated);
  return { ok: res.ok, updated, error: res.error };
}

/**
 * STAGE 3: Forklift Driver Bowser Meter Dispense
 * Strictly blocked unless status === 'APPROVED_FOR_DISPENSE' AND pdfGeneratedOnce === true.
 */
export async function dispenseFuelWithMeterReadings(params: {
  request: DieselFuelRequest;
  tank: DieselTankConfig;
  firstMeterReading: number;
  secondMeterReading: number;
  driverDispenseSignature: string;
}): Promise<{
  ok: boolean;
  updatedRequest?: DieselFuelRequest;
  updatedTank?: DieselTankConfig;
  error?: string;
}> {
  const { request, tank, firstMeterReading, secondMeterReading, driverDispenseSignature } = params;

  if (
    request.status !== 'APPROVED_FOR_DISPENSE' ||
    !request.pdfGeneratedOnce ||
    !request.pdfUnlockedDispense
  ) {
    return {
      ok: false,
      error:
        'Locked: Bowser meter entry unlocks only after Production HOD approves and generates the Fuel Request PDF.',
    };
  }

  if (
    Number.isNaN(firstMeterReading) ||
    Number.isNaN(secondMeterReading) ||
    secondMeterReading <= firstMeterReading
  ) {
    return {
      ok: false,
      error: 'Second meter reading (after taking fuel) must be greater than First meter reading.',
    };
  }

  const actualLitresTaken = r2(secondMeterReading - firstMeterReading);
  const tankLevelBefore = r2(tank.currentLevelLitres);
  const tankLevelAfter = Math.max(0, r2(tankLevelBefore - actualLitresTaken));
  const nowIso = new Date().toISOString();

  const updatedRequest: DieselFuelRequest = {
    ...request,
    status: 'DISPENSED',
    firstMeterReading: r2(firstMeterReading),
    secondMeterReading: r2(secondMeterReading),
    actualLitresTaken,
    driverDispenseSignature,
    dispensedAt: nowIso,
    tankLevelBefore,
    tankLevelAfter,
    upd: Date.now(),
  };

  const updatedTank: DieselTankConfig = {
    ...tank,
    currentLevelLitres: tankLevelAfter,
    currentMeterReading: r2(secondMeterReading),
    totalIssuedLitres: r2((tank.totalIssuedLitres || 0) + actualLitresTaken),
    lastUpdatedAt: nowIso,
    lastUpdatedBy: `${request.driverName} (${request.requestNo})`,
    upd: Date.now(),
  };

  const reqSave = await saveDieselRequest(updatedRequest);
  const tankSave = await saveDieselTankConfig(updatedTank);

  return {
    ok: reqSave.ok && tankSave.ok,
    updatedRequest,
    updatedTank,
    error: reqSave.error || tankSave.error,
  };
}

/**
 * FUEL GRN: Offload bulk diesel into Bowser Tank, verify meter readings, collect signatures & print Portrait PDF
 */
export async function recordFuelGrnAndTopUpTank(params: {
  tank: DieselTankConfig;
  date: string;
  shift: 'Day' | 'Night';
  supplierName: string;
  deliveryNoteNo: string;
  receiverName: string;
  receiverEmail: string;
  firstMeterReading: number;
  secondMeterReading: number;
  unitPrice?: number;
  notes: string;
  supplierSignature: string;
  receiverSignature: string;
  hodVerifiedBy?: string;
}): Promise<{
  ok: boolean;
  grn?: DieselGrnRecord;
  updatedTank?: DieselTankConfig;
  error?: string;
}> {
  if (!params.supplierName.trim()) {
    return { ok: false, error: 'Fuel Supplier name is required.' };
  }
  if (
    Number.isNaN(params.firstMeterReading) ||
    Number.isNaN(params.secondMeterReading) ||
    params.secondMeterReading <= params.firstMeterReading
  ) {
    return {
      ok: false,
      error: 'GRN Second Meter Reading must be greater than First Meter Reading.',
    };
  }
  if (!params.supplierSignature || !params.receiverSignature) {
    return {
      ok: false,
      error: 'Both Supplier and LG PLAST Receiver digital signatures are required for Fuel GRN.',
    };
  }

  const now = new Date();
  const litresAdded = r2(params.secondMeterReading - params.firstMeterReading);
  const tankLevelBefore = r2(params.tank.currentLevelLitres);
  const tankLevelAfter = r2(tankLevelBefore + litresAdded);
  const unitPriceNum =
    typeof params.unitPrice === 'number' && params.unitPrice > 0 ? r2(params.unitPrice) : undefined;
  const totalCost = unitPriceNum ? r2(unitPriceNum * litresAdded) : undefined;
  const grnNo = `GRN-${params.date.replace(/-/g, '').slice(2)}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

  const grn: DieselGrnRecord = {
    id: `DGRN-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
    grnNo,
    date: params.date,
    shift: params.shift,
    supplierName: params.supplierName.trim(),
    deliveryNoteNo: params.deliveryNoteNo.trim() || undefined,
    receiverName: params.receiverName.trim(),
    receiverEmail: params.receiverEmail.trim(),
    firstMeterReading: r2(params.firstMeterReading),
    secondMeterReading: r2(params.secondMeterReading),
    litresAdded,
    unitPrice: unitPriceNum,
    totalCost,
    notes: params.notes.trim() || undefined,
    supplierSignature: params.supplierSignature,
    receiverSignature: params.receiverSignature,
    hodVerifiedBy: params.hodVerifiedBy || params.receiverName.trim(),
    tankLevelBefore,
    tankLevelAfter,
    createdAt: now.toISOString(),
    upd: Date.now(),
  };

  const updatedTank: DieselTankConfig = {
    ...params.tank,
    currentLevelLitres: tankLevelAfter,
    currentMeterReading: r2(params.secondMeterReading),
    totalReceivedLitres: r2((params.tank.totalReceivedLitres || 0) + litresAdded),
    lastUpdatedAt: now.toISOString(),
    lastUpdatedBy: `GRN ${grnNo} (${params.supplierName.trim()})`,
    upd: Date.now(),
  };

  const grnSave = await saveDieselGrn(grn);
  const tankSave = await saveDieselTankConfig(updatedTank);
  await generateFuelGrnPdf(grn);

  return {
    ok: grnSave.ok && tankSave.ok,
    grn,
    updatedTank,
    error: grnSave.error || tankSave.error,
  };
}

// ======================================================
// 5. DIESEL BOWSER USAGE & GRN EXCEL EXPORT
// ======================================================
export function exportDieselExcelWorkbook(
  requests: DieselFuelRequest[],
  grns: DieselGrnRecord[],
  tank: DieselTankConfig,
  fromDate: string,
  toDate: string
) {
  const wb = XLSX.utils.book_new();

  const filteredIssues = requests
    .filter((r) => (!fromDate || r.date >= fromDate) && (!toDate || r.date <= toDate))
    .sort((a, b) => (b.date + b.requestedAt).localeCompare(a.date + a.requestedAt));

  const filteredGrns = grns
    .filter((g) => (!fromDate || g.date >= fromDate) && (!toDate || g.date <= toDate))
    .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));

  const issuedInRange = r2(
    filteredIssues
      .filter((r) => r.status === 'DISPENSED')
      .reduce((s, r) => s + (r.actualLitresTaken || 0), 0)
  );
  const receivedInRange = r2(filteredGrns.reduce((s, g) => s + (g.litresAdded || 0), 0));

  const summaryRows = [
    { Metric: 'Bowser Tank Name', Value: tank.tankName },
    { Metric: 'Report Filter Period', Value: `${fromDate || 'All'} to ${toDate || 'Latest'}` },
    { Metric: 'Tank Capacity (Litres)', Value: tank.capacityLitres },
    { Metric: 'Current Live Tank Level (Litres)', Value: tank.currentLevelLitres },
    {
      Metric: 'Tank Fill Percentage (%)',
      Value: tank.capacityLitres > 0 ? r2((tank.currentLevelLitres / tank.capacityLitres) * 100) : 0,
    },
    { Metric: 'Current Bowser Flow Meter Reading', Value: tank.currentMeterReading },
    { Metric: 'Period Fuel Issued / Dispensed (Litres)', Value: issuedInRange },
    { Metric: 'Period Fuel Received via GRN (Litres)', Value: receivedInRange },
    { Metric: 'All-Time Total Issued (Litres)', Value: tank.totalIssuedLitres },
    { Metric: 'All-Time Total Received (Litres)', Value: tank.totalReceivedLitres },
    { Metric: 'Last Tank Activity', Value: `${tank.lastUpdatedBy} @ ${tank.lastUpdatedAt}` },
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 36 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Bowser Tank Summary');

  const issueSheetRows =
    filteredIssues.length > 0
      ? filteredIssues.map((r) => ({
          'Voucher No': r.requestNo,
          Date: r.date,
          Shift: r.shift,
          'Vehicle / Forklift': r.vehicleOrForklift,
          'Driver Name': r.driverName,
          'Requested (L)': r.requestedLitres,
          'HOD Approved (L)': r.hodApprovedLitres ?? '',
          'Approved By (HOD)': r.hodApprovedBy || 'Pending',
          'PDF Unlocked': r.pdfGeneratedOnce ? 'Yes' : 'No',
          '1st Meter Reading': r.firstMeterReading ?? '',
          '2nd Meter Reading': r.secondMeterReading ?? '',
          'Net Taken (L)': r.actualLitresTaken ?? '',
          'Tank Before (L)': r.tankLevelBefore ?? '',
          'Tank After (L)': r.tankLevelAfter ?? '',
          Purpose: r.purpose || '',
          Status: r.status,
          'Driver Request Signed': r.driverRequestSignature ? 'Signed' : 'No',
          'HOD Signed': r.hodSignature ? 'Signed' : 'No',
          'Driver Dispense Signed': r.driverDispenseSignature ? 'Signed' : 'No',
        }))
      : [{ Notice: 'No Diesel Issue records in selected period.' }];
  const wsIssues = XLSX.utils.json_to_sheet(issueSheetRows);
  XLSX.utils.book_append_sheet(wb, wsIssues, 'Diesel Issue Usage');

  const grnSheetRows =
    filteredGrns.length > 0
      ? filteredGrns.map((g) => ({
          'GRN No': g.grnNo,
          Date: g.date,
          Shift: g.shift,
          Supplier: g.supplierName,
          'Delivery Note No': g.deliveryNoteNo || '',
          'Receiver (LG PLAST)': g.receiverName,
          '1st Meter Reading': g.firstMeterReading,
          '2nd Meter Reading': g.secondMeterReading,
          'Litres Added (+L)': g.litresAdded,
          'Tank Before (L)': g.tankLevelBefore,
          'Tank After (L)': g.tankLevelAfter,
          'Unit Price': g.unitPrice ?? '',
          'Total Cost': g.totalCost ?? '',
          'Supplier Signed': g.supplierSignature ? 'Signed' : 'No',
          'Receiver Signed': g.receiverSignature ? 'Signed' : 'No',
          Notes: g.notes || '',
        }))
      : [{ Notice: 'No Fuel GRN records in selected period.' }];
  const wsGrns = XLSX.utils.json_to_sheet(grnSheetRows);
  XLSX.utils.book_append_sheet(wb, wsGrns, 'Fuel GRN Receipts');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveFileBlob(
    `LGPLAST_Diesel_Bowser_Report_${fromDate || 'All'}_to_${toDate || 'Latest'}.xlsx`,
    new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  );
}
