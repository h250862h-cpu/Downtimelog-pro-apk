import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import {
  auth,
  db,
  ensureFirebaseAuth,
  getActiveSessionUser,
  handleFirestoreError,
  isRestrictedShiftInChargeAccount,
  OperationType,
} from '../firebase';
import {
  DEFAULT_MACHINES,
  DEFAULT_REPORTERS,
  DowntimeEntry,
} from '../types';
import { dtl, ymd } from './downtimeCalc';

const LOG_KEY = 'dtlog';
const MACH_KEY = 'dtmach';
const GONE_KEY = 'dtgone';
const USER_KEY = 'dtuser';
const ADMINS_KEY = 'dtadmins';

// Primary Default Admin email from user prompt / system identity
export const DEFAULT_ADMIN_EMAILS = [
  'h250862h@hit.ac.zw',
];

export function getAdminEmails(): string[] {
  try {
    const raw = localStorage.getItem(ADMINS_KEY);
    if (raw) {
      const list: string[] = JSON.parse(raw);
      return Array.from(new Set([...DEFAULT_ADMIN_EMAILS, ...list.map((e) => e.toLowerCase())]));
    }
  } catch (e) {
    console.warn('Failed reading admin list:', e);
  }
  return DEFAULT_ADMIN_EMAILS;
}

export function isUserAdmin(email?: string | null): boolean {
  const effectiveEmail = email || getActiveSessionUser()?.email || auth.currentUser?.email;
  if (!effectiveEmail) {
    return false;
  }
  const norm = effectiveEmail.trim().toLowerCase();
  if (isRestrictedShiftInChargeAccount(norm)) {
    return false;
  }
  const admins = getAdminEmails();
  if (admins.some((a) => a.toLowerCase() === norm)) {
    return true;
  }
  try {
    const raw = localStorage.getItem('dt_plant_users');
    if (raw) {
      const users = JSON.parse(raw) as Array<{
        email?: string;
        displayName?: string;
        role?: string;
        status?: string;
      }>;
      const matched = users.find((u) => u.email?.trim().toLowerCase() === norm);
      if (
        matched &&
        matched.status !== 'suspended' &&
        !isRestrictedShiftInChargeAccount(matched.email, matched.displayName) &&
        (matched.role === 'Plant Administrator' || matched.role === 'Production HOD')
      ) {
        return true;
      }
    }
  } catch {}
  return false;
}

export function grantAdminPrivilege(email: string) {
  try {
    const current = getAdminEmails();
    const updated = Array.from(new Set([...current, email.trim().toLowerCase()]));
    localStorage.setItem(ADMINS_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed saving admin:', e);
  }
}

// Helpers for localStorage machines
export function getStoredCustomMachines(): string[] {
  try {
    return JSON.parse(localStorage.getItem(MACH_KEY) || '[]');
  } catch {
    return [];
  }
}

export function setStoredCustomMachines(arr: string[]) {
  try {
    localStorage.setItem(MACH_KEY, JSON.stringify(arr));
  } catch (e) {
    console.warn('Failed saving custom machines:', e);
  }
}

export function getStoredGoneMachines(): string[] {
  try {
    return JSON.parse(localStorage.getItem(GONE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function setStoredGoneMachines(arr: string[]) {
  try {
    localStorage.setItem(GONE_KEY, JSON.stringify(arr));
  } catch (e) {
    console.warn('Failed saving gone machines:', e);
  }
}

const OBSOLETE_MACHINES = [
  'extrusion machine 5',
  'extrusion machine 7',
  'extrusion machine 8',
  'extrusion machine 9',
  'line one',
  'line two',
  'line 6',
];

export function getActiveMachines(): string[] {
  const gone = getStoredGoneMachines().map((x) => x.toLowerCase());
  const custom = getStoredCustomMachines();
  const list: string[] = [...DEFAULT_MACHINES];

  custom.forEach((m) => {
    if (
      !list.some((existing) => existing.toLowerCase() === m.toLowerCase()) &&
      !OBSOLETE_MACHINES.includes(m.toLowerCase())
    ) {
      list.push(m);
    }
  });

  return list.filter(
    (m) => !gone.includes(m.toLowerCase()) && !OBSOLETE_MACHINES.includes(m.toLowerCase())
  );
}

/**
 * Admin: Add Machine
 * Checks that caller is Admin. Adds to custom list and syncs to Firestore.
 */
export async function addCustomMachine(
  name: string,
  userEmail?: string | null
): Promise<{ ok: boolean; message: string }> {
  const email = userEmail || auth.currentUser?.email;
  if (!isUserAdmin(email)) {
    return {
      ok: false,
      message: 'Access Denied: Only designated Plant Admins can add new machinery.',
    };
  }

  const cleaned = name.trim().replace(/\s+/g, ' ');
  if (!cleaned) return { ok: false, message: 'Please enter a valid machine name.' };

  const current = getActiveMachines();
  if (current.some((m) => m.toLowerCase() === cleaned.toLowerCase())) {
    return { ok: false, message: `"${cleaned}" already exists in the machine list.` };
  }

  // If it was previously hidden/gone, remove from gone list
  const gone = getStoredGoneMachines().filter((x) => x.toLowerCase() !== cleaned.toLowerCase());
  setStoredGoneMachines(gone);

  // If not in default base list, add to custom
  const custom = getStoredCustomMachines();
  if (!DEFAULT_MACHINES.some((b) => b.toLowerCase() === cleaned.toLowerCase())) {
    if (!custom.some((c) => c.toLowerCase() === cleaned.toLowerCase())) {
      custom.push(cleaned);
      setStoredCustomMachines(custom);
    }
  }

  // Push update to Firestore for all connected operators
  await syncMachineryConfigToFirebase();

  return { ok: true, message: `Machine "${cleaned}" added successfully by Admin.` };
}

/**
 * Admin: Remove Machine (Archive / Hide)
 * Hides machine from forms and active boards while preserving history
 */
export async function removeMachine(
  name: string,
  userEmail?: string | null
): Promise<{ ok: boolean; message: string }> {
  const email = userEmail || auth.currentUser?.email;
  if (!isUserAdmin(email)) {
    return {
      ok: false,
      message: 'Access Denied: Only designated Plant Admins can remove machines.',
    };
  }

  const gone = getStoredGoneMachines();
  if (!gone.some((x) => x.toLowerCase() === name.toLowerCase())) {
    gone.push(name);
    setStoredGoneMachines(gone);
  }

  await syncMachineryConfigToFirebase();

  return { ok: true, message: `Machine "${name}" archived from active view.` };
}

/**
 * Admin: Permanent Delete Machine
 * Permanently removes machine from custom machines list
 */
export async function deleteMachinePermanent(
  name: string,
  userEmail?: string | null
): Promise<{ ok: boolean; message: string }> {
  const email = userEmail || auth.currentUser?.email;
  if (!isUserAdmin(email)) {
    return {
      ok: false,
      message: 'Access Denied: Only designated Plant Admins can permanently delete machines.',
    };
  }

  // Remove from custom list
  const custom = getStoredCustomMachines().filter((m) => m.toLowerCase() !== name.toLowerCase());
  setStoredCustomMachines(custom);

  // Also add to gone if it was a default base machine
  const gone = getStoredGoneMachines();
  if (!gone.some((x) => x.toLowerCase() === name.toLowerCase())) {
    gone.push(name);
    setStoredGoneMachines(gone);
  }

  await syncMachineryConfigToFirebase();

  return { ok: true, message: `Machine "${name}" permanently deleted by Admin.` };
}

/**
 * Admin: Restore an archived / removed machine
 */
export async function restoreMachine(
  name: string,
  userEmail?: string | null
): Promise<{ ok: boolean; message: string }> {
  const email = userEmail || auth.currentUser?.email;
  if (!isUserAdmin(email)) {
    return {
      ok: false,
      message: 'Access Denied: Only designated Plant Admins can restore machines.',
    };
  }

  const gone = getStoredGoneMachines().filter((x) => x.toLowerCase() !== name.toLowerCase());
  setStoredGoneMachines(gone);

  await syncMachineryConfigToFirebase();

  return { ok: true, message: `Machine "${name}" restored to active plant list.` };
}

/**
 * Sync custom and gone machines to Firestore doc 'app_config/machinery'
 */
export async function syncMachineryConfigToFirebase() {
  try {
    const configDoc = doc(db, 'app_config', 'machinery');
    await setDoc(
      configDoc,
      {
        customMachines: getStoredCustomMachines(),
        goneMachines: getStoredGoneMachines(),
        updatedAt: Date.now(),
        updatedBy: auth.currentUser?.email || 'admin',
      },
      { merge: true }
    );
  } catch (err: any) {
    console.warn('Could not sync machinery config to Firebase:', err.message);
  }
}

/**
 * Listen for real-time machinery config updates from Firestore
 */
export function subscribeMachineryConfig(onUpdate: (machines: string[]) => void) {
  const configDoc = doc(db, 'app_config', 'machinery');
  return onSnapshot(
    configDoc,
    (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (Array.isArray(data.customMachines)) {
          setStoredCustomMachines(data.customMachines);
        }
        if (Array.isArray(data.goneMachines)) {
          setStoredGoneMachines(data.goneMachines);
        }
        onUpdate(getActiveMachines());
      }
    },
    (err) => {
      console.warn('Machinery subscription note:', err.message);
    }
  );
}

// User / Device identity
export function getCurrentReporterName(): string {
  try {
    return (
      localStorage.getItem(USER_KEY) ||
      auth.currentUser?.displayName ||
      auth.currentUser?.email?.split('@')[0].toUpperCase() ||
      DEFAULT_REPORTERS[0]
    );
  } catch {
    return DEFAULT_REPORTERS[0];
  }
}

export function setCurrentReporterName(name: string) {
  try {
    localStorage.setItem(USER_KEY, name);
  } catch (e) {
    console.warn('Failed saving user:', e);
  }
}

// Local entries management
export function getStoredEntries(): DowntimeEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) {
      return getInitialDemoEntries();
    }
    const arr: DowntimeEntry[] = JSON.parse(raw);
    arr.forEach((e) => {
      const g = /^(Mixer|Extrusion|Polypipe|Punching) (\d)$/.exec(e.m);
      if (g) e.m = `${g[1]} Machine ${g[2]}`;
      else if (e.m === 'Palletizer') e.m = 'Palletizer Machine';
      if (!e.upd) e.upd = new Date(e.start).getTime() || Date.now();
    });
    return arr;
  } catch {
    return getInitialDemoEntries();
  }
}

export function saveStoredEntries(entries: DowntimeEntry[]) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(entries));
  } catch (e) {
    console.warn('Failed saving entries to localStorage:', e);
  }
}

export function getInitialDemoEntries(): DowntimeEntry[] {
  const now = new Date();
  const todayStr = ymd(now);
  const hour = now.getHours();
  const SEED_TS = 1700000000000;

  return [
    {
      id: 'SEED-001',
      m: 'Extrusion Machine 3',
      cat: 'Breakdown',
      start: `${todayStr}T${hour >= 4 ? String(hour - 3).padStart(2, '0') : '06'}:30`,
      end: `${todayStr}T${hour >= 2 ? String(hour - 1).padStart(2, '0') : '08'}:15`,
      reason: 'Barrel heater zone 2 thermocouple open circuit. Replaced thermocouple sensor.',
      rep: 'ERIC NYAMAPANDA',
      jcn: 'JC-1042',
      jcp: 'Finished',
      by: 'eric@plant.co.zw',
      operator: 'TRIED CHAKUBVA',
      generalHand: 'MUNYARADZI MUHOMBA',
      mtncePerson: 'MASIMBA MUKUKU',
      outputPerHour: '160 m/hr',
      runningWeight: '540 kg',
      shift: 'Day (07:30 - 19:30)',
      loggedBy: 'ERIC NYAMAPANDA',
      loggedByEmail: 'eric@plant.co.zw',
      upd: SEED_TS,
      sy: SEED_TS,
      signature:
        'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="220" height="60"><path d="M10 40 Q40 10 70 35 T130 30 T190 20" stroke="%2310b981" fill="none" stroke-width="3"/></svg>',
      signedAt: new Date(SEED_TS).toISOString(),
    },
    {
      id: 'SEED-002',
      m: 'Mixer Machine 1',
      cat: 'Changeover (job card)',
      start: `${todayStr}T${hour >= 2 ? String(hour - 2).padStart(2, '0') : '07'}:00`,
      end: `${todayStr}T${hour >= 1 ? String(hour - 1).padStart(2, '0') : '08'}:00`,
      reason: 'Colour formulation changeover from Black Masterbatch to Grey Resin 40.',
      rep: 'INNOCENT MAVIYANI',
      jcn: 'JC-1055',
      jcp: 'Finished',
      by: 'innocent@plant.co.zw',
      operator: 'TCHAONA MAKADHO',
      generalHand: 'TAFARA SHAVAYEMOMBE',
      mtncePerson: 'MOREBLESSING MUTAURWA',
      outputPerHour: '300 kg/hr',
      runningWeight: '1,200 kg',
      shift: 'Day (07:30 - 19:30)',
      loggedBy: 'INNOCENT MAVIYANI',
      loggedByEmail: 'innocent@plant.co.zw',
      upd: SEED_TS,
      sy: SEED_TS,
      signature:
        'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="220" height="60"><path d="M15 35 Q50 5 90 40 T170 25" stroke="%233b82f6" fill="none" stroke-width="3"/></svg>',
      signedAt: new Date(SEED_TS).toISOString(),
    },
    {
      id: 'SEED-003',
      m: 'IM 2',
      cat: 'Breakdown',
      start: `${todayStr}T${String(Math.max(0, hour - 1)).padStart(2, '0')}:15`,
      end: '',
      reason: 'Hydraulic ejector pin safety interlock trip. Solenoid valve S2 under maintenance.',
      rep: 'TRUST GWEME',
      jcn: 'JC-1060',
      jcp: 'In progress',
      by: 'trust@plant.co.zw',
      operator: 'OWEN GAMBO',
      generalHand: 'THINKWELL MARUMANI',
      mtncePerson: 'MASIMBA MUKUKU',
      outputPerHour: '120 units/hr',
      runningWeight: '380 kg',
      shift: 'Day (07:30 - 19:30)',
      loggedBy: 'TRUST GWEME',
      loggedByEmail: 'trust@plant.co.zw',
      upd: SEED_TS,
      sy: SEED_TS,
      signature:
        'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="220" height="60"><path d="M20 40 Q60 55 100 25 T180 35" stroke="%23f59e0b" fill="none" stroke-width="3"/></svg>',
      signedAt: new Date(SEED_TS).toISOString(),
    },
    {
      id: 'SEED-004',
      m: 'Chiller',
      cat: 'Running update',
      start: `${todayStr}T07:30`,
      end: '',
      reason: 'Cooling loop circulating within spec.',
      rep: 'BRIGHTON MUDAMBURI',
      jcn: 'UT-CH-01',
      jcp: 'On Target',
      by: 'brighton@plant.co.zw',
      operator: 'BRIGHTON MUDAMBURI',
      generalHand: 'TINOMUTENDA',
      mtncePerson: 'BRIGHTON MUDAMBURI',
      outputPerHour: '100% flow',
      runningWeight: '-',
      shift: 'Day (07:30 - 19:30)',
      chillerTemp: 13.5,
      chillerPressure: 4.2,
      chillerFreq: 50.0,
      loggedBy: 'BRIGHTON MUDAMBURI',
      loggedByEmail: 'brighton@plant.co.zw',
      upd: SEED_TS,
      sy: SEED_TS,
    },
    {
      id: 'SEED-005',
      m: 'Generator',
      cat: 'Running update',
      start: `${todayStr}T08:00`,
      end: '',
      reason: 'Standby generator operational check.',
      rep: 'MASIMBA MUKUKU',
      jcn: 'UT-GEN-01',
      jcp: 'On Target',
      by: 'masimba@plant.co.zw',
      operator: 'MASIMBA MUKUKU',
      generalHand: 'KEFAS',
      mtncePerson: 'MASIMBA MUKUKU',
      outputPerHour: '380 kVA',
      runningWeight: '-',
      shift: 'Day (07:30 - 19:30)',
      genStartTime: '08:00',
      genStartFuel: 92,
      genOffTime: '12:00',
      genOffFuel: 84,
      loggedBy: 'MASIMBA MUKUKU',
      loggedByEmail: 'masimba@plant.co.zw',
      upd: SEED_TS,
      sy: SEED_TS,
    },
  ];
}

const PENDING_QUEUE_KEY = 'dt_pending_sync_queue';
let lastSyncError: string | null = null;

export function getLastSyncError(): string | null {
  return lastSyncError;
}

export function sanitizeForFirestore<T extends Record<string, any>>(obj: T): Record<string, any> {
  const clean: Record<string, any> = {};
  Object.keys(obj).forEach((key) => {
    const val = obj[key];
    if (val === undefined) return;
    if (typeof val === 'number' && Number.isNaN(val)) return;
    clean[key] = val;
  });
  return clean;
}

export function getPendingSyncQueue(): string[] {
  try {
    const raw = localStorage.getItem(PENDING_QUEUE_KEY);
    if (!raw) return [];
    const list: string[] = JSON.parse(raw);
    const filtered = list.filter((id) => typeof id === 'string' && !id.startsWith('SEED-'));
    if (filtered.length !== list.length) {
      localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(filtered));
    }
    return filtered;
  } catch {
    return [];
  }
}

export function addToPendingSyncQueue(id: string) {
  if (!id || id.startsWith('SEED-')) return;
  try {
    const queue = getPendingSyncQueue();
    if (!queue.includes(id)) {
      queue.push(id);
      localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue));
    }
  } catch {}
}

export function removeFromPendingSyncQueue(id: string) {
  try {
    const queue = getPendingSyncQueue().filter((x) => x !== id);
    localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue));
  } catch {}
}

function markEntrySyncedLocally(entryId: string, syncTimestamp: number) {
  try {
    const current = getStoredEntries();
    let changed = false;
    const updated = current.map((e) => {
      if (e.id === entryId) {
        changed = true;
        return { ...e, sy: syncTimestamp };
      }
      return e;
    });
    if (changed) {
      saveStoredEntries(updated);
    }
  } catch {}
}

export async function flushPendingSyncQueue(): Promise<number> {
  await ensureFirebaseAuth().catch(() => false);

  const queue = getPendingSyncQueue();
  const allEntries = getStoredEntries();
  const toSyncMap = new Map<string, DowntimeEntry>();

  queue.forEach((id) => {
    if (id.startsWith('SEED-')) {
      removeFromPendingSyncQueue(id);
      return;
    }
    const found = allEntries.find((e) => e.id === id);
    if (found) {
      toSyncMap.set(id, found);
    } else {
      removeFromPendingSyncQueue(id);
    }
  });

  allEntries.forEach((e) => {
    if (e.id.startsWith('SEED-')) return;
    if (!e.sy || (e.upd && e.upd > e.sy)) {
      toSyncMap.set(e.id, e);
    }
  });

  if (toSyncMap.size === 0) return 0;

  let syncedCount = 0;
  for (const entry of Array.from(toSyncMap.values())) {
    try {
      const docRef = doc(db, 'downtime_entries', entry.id);
      const syncTs = Math.max(Date.now(), entry.upd || 0);
      const payload = sanitizeForFirestore({ ...entry, sy: syncTs });
      await setDoc(docRef, payload, { merge: true });
      entry.sy = syncTs;
      removeFromPendingSyncQueue(entry.id);
      syncedCount++;
      lastSyncError = null;
    } catch (err: any) {
      const msg = err?.message || String(err);
      lastSyncError = msg;
      console.warn(`Auto-sync retry note for ${entry.id}:`, msg);
      if (msg.toLowerCase().includes('permission')) {
        try {
          handleFirestoreError(err, OperationType.WRITE, `downtime_entries/${entry.id}`);
        } catch {}
      }
    }
  }

  if (syncedCount > 0) {
    saveStoredEntries(allEntries);
  }
  return syncedCount;
}

export async function pollFirebaseEntries(
  onUpdate?: (entries: DowntimeEntry[]) => void
): Promise<DowntimeEntry[]> {
  try {
    await ensureFirebaseAuth().catch(() => false);

    const colRef = collection(db, 'downtime_entries');
    const snapshot = await getDocs(colRef);
    lastSyncError = null;
    if (!snapshot.empty) {
      const remoteMap: Record<string, DowntimeEntry> = {};
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as DowntimeEntry;
        remoteMap[docSnap.id] = { ...data, id: docSnap.id };
      });

      const currentLocal = getStoredEntries();
      const mergedMap: Record<string, DowntimeEntry> = { ...remoteMap };

      currentLocal.forEach((e) => {
        if (e.id.startsWith('SEED-') && Object.keys(remoteMap).length > 0) {
          if (!mergedMap[e.id]) return;
        }
        if (!mergedMap[e.id]) {
          mergedMap[e.id] = e;
        } else if ((e.upd || 0) > (mergedMap[e.id].upd || 0)) {
          mergedMap[e.id] = e;
        }
      });

      const mergedList = Object.values(mergedMap).sort((a, b) => (b.upd || 0) - (a.upd || 0));
      saveStoredEntries(mergedList);
      if (onUpdate) onUpdate(mergedList);
      return mergedList;
    }
  } catch (err: any) {
    lastSyncError = err?.message || String(err);
    console.warn('Backup poll note:', lastSyncError);
  }
  return getStoredEntries();
}

export function subscribeFirebaseEntries(
  onUpdate: (entries: DowntimeEntry[]) => void,
  onSyncStatus: (status: 'synced' | 'syncing' | 'offline' | 'error', msg?: string) => void
) {
  const local = getStoredEntries();
  onUpdate(local);

  let unsubscribe: (() => void) | null = null;
  let listenerActive = false;
  let cancelled = false;
  const colRef = collection(db, 'downtime_entries');

  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel('dt_live_sync_channel');
    bc.onmessage = (event) => {
      if (event.data?.type === 'ENTRY_UPDATED') {
        const updated = getStoredEntries();
        onUpdate(updated);
      }
    };
  } catch {}

  const startLiveSync = async () => {
    if (cancelled || listenerActive) return;
    listenerActive = true;
    onSyncStatus('syncing', 'Connecting to Firebase Firestore real-time sync...');
    await ensureFirebaseAuth().catch(() => false);
    if (cancelled) {
      listenerActive = false;
      return;
    }

    flushPendingSyncQueue().catch(() => {});

    try {
      unsubscribe = onSnapshot(
        colRef,
        (snapshot) => {
          lastSyncError = null;
          const remoteMap: Record<string, DowntimeEntry> = {};
          snapshot.forEach((docSnap) => {
            const data = docSnap.data() as DowntimeEntry;
            remoteMap[docSnap.id] = { ...data, id: docSnap.id };
          });

          const currentLocal = getStoredEntries();
          const mergedMap: Record<string, DowntimeEntry> = {};

          Object.keys(remoteMap).forEach((id) => {
            mergedMap[id] = remoteMap[id];
          });

          currentLocal.forEach((e) => {
            if (e.id.startsWith('SEED-')) {
              if (!mergedMap[e.id] && Object.keys(remoteMap).length === 0) {
                mergedMap[e.id] = e;
              }
              return;
            }
            if (!mergedMap[e.id]) {
              mergedMap[e.id] = e;
              addToPendingSyncQueue(e.id);
            } else if ((e.upd || 0) > (mergedMap[e.id].upd || 0)) {
              mergedMap[e.id] = e;
              addToPendingSyncQueue(e.id);
            }
          });

          const mergedList = Object.values(mergedMap).sort((a, b) => (b.upd || 0) - (a.upd || 0));
          saveStoredEntries(mergedList);
          onUpdate(mergedList);
          onSyncStatus('synced', `Live synced with Firebase (${snapshot.size} records across plant)`);
        },
        (error) => {
          listenerActive = false;
          unsubscribe = null;
          lastSyncError = error.message;
          console.warn('Firestore subscription fallback:', error.message);
          onSyncStatus(
            error.code === 'permission-denied' ? 'error' : 'offline',
            error.code === 'permission-denied'
              ? 'Firestore Rules in downtime-log-d484f are blocking access — Publish open rules in Firebase Console.'
              : 'Working locally / offline. Updates queued for auto-sync.'
          );
        }
      );
    } catch (err: any) {
      listenerActive = false;
      unsubscribe = null;
      lastSyncError = err?.message || String(err);
      console.warn('Firestore error:', err);
      onSyncStatus('offline', 'Offline mode active');
    }
  };

  startLiveSync();

  const flushInterval = setInterval(() => {
    flushPendingSyncQueue().catch(() => {});
  }, 4000);

  const pollInterval = setInterval(() => {
    pollFirebaseEntries(onUpdate)
      .then(() => {
        if (!listenerActive && !lastSyncError) {
          startLiveSync();
        }
      })
      .catch(() => {});
  }, 12000);

  const handleOnline = () => {
    onSyncStatus('syncing', 'Network reconnected. Auto-flushing entries to Firebase...');
    flushPendingSyncQueue().catch(() => {});
    pollFirebaseEntries(onUpdate).catch(() => {});
    if (!listenerActive) {
      startLiveSync();
    }
  };
  window.addEventListener('online', handleOnline);

  return () => {
    cancelled = true;
    listenerActive = false;
    if (unsubscribe) unsubscribe();
    if (bc) bc.close();
    clearInterval(flushInterval);
    clearInterval(pollInterval);
    window.removeEventListener('online', handleOnline);
  };
}

export async function syncEntryToFirebase(
  entry: DowntimeEntry
): Promise<{ ok: boolean; error?: string }> {
  const now = Date.now();
  entry.upd = now;
  entry.sy = 0;
  addToPendingSyncQueue(entry.id);

  try {
    await ensureFirebaseAuth().catch(() => false);

    const docRef = doc(db, 'downtime_entries', entry.id);
    const syncTs = Math.max(Date.now(), entry.upd);
    const payload = sanitizeForFirestore({ ...entry, sy: syncTs });

    await setDoc(docRef, payload, { merge: true });

    entry.sy = syncTs;
    lastSyncError = null;
    removeFromPendingSyncQueue(entry.id);
    markEntrySyncedLocally(entry.id, syncTs);

    try {
      const bc = new BroadcastChannel('dt_live_sync_channel');
      bc.postMessage({ type: 'ENTRY_UPDATED', entryId: entry.id });
      bc.close();
    } catch {}

    return { ok: true };
  } catch (err: any) {
    const msg = err?.message || 'Network or permission error while uploading';
    lastSyncError = msg;
    console.warn('Failed to push to Firebase immediately (queued for auto-retry):', msg);
    if (msg.toLowerCase().includes('permission')) {
      try {
        handleFirestoreError(err, OperationType.WRITE, `downtime_entries/${entry.id}`);
      } catch {}
    }
    return { ok: false, error: msg };
  }
}

export async function syncAllLocalToFirebase(entries: DowntimeEntry[]): Promise<number> {
  let count = 0;
  await ensureFirebaseAuth().catch(() => false);

  for (const entry of entries) {
    if (entry.id.startsWith('SEED-')) continue;
    try {
      const docRef = doc(db, 'downtime_entries', entry.id);
      const syncTs = Math.max(Date.now(), entry.upd || 0);
      const payload = sanitizeForFirestore({ ...entry, sy: syncTs });
      await setDoc(docRef, payload, { merge: true });
      entry.sy = syncTs;
      removeFromPendingSyncQueue(entry.id);
      count++;
      lastSyncError = null;
    } catch (err: any) {
      lastSyncError = err?.message || String(err);
    }
  }
  saveStoredEntries(entries);
  return count;
}
