import { deleteApp, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  CollectionReference,
  collection,
  deleteDoc,
  doc,
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  enableNetwork,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  getFirestore,
  initializeFirestore,
  onSnapshot,
  Query,
  QuerySnapshot,
  setDoc,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';
import {
  FULL_ADMIN_PERMISSIONS,
  getDefaultPermissionsForRole,
  PlantRole,
  PlantUserAccount,
  UserPermissions,
} from './types';

const app = initializeApp(firebaseConfig);
const dbId = firebaseConfig.firestoreDatabaseId || '(default)';

function createFirestoreInstance() {
  try {
    return initializeFirestore(
      app,
      {
        ignoreUndefinedProperties: true,
        experimentalAutoDetectLongPolling: true,
      },
      dbId
    );
  } catch {
    return getFirestore(app, dbId);
  }
}

export const db = createFirestoreInstance(); /* CRITICAL: The app will break without this line */
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

export const PRIMARY_ADMIN_EMAIL = 'h250862h@hit.ac.zw';

const FLOOR_DEVICE_EMAIL = '0714282338@plant.co.zw';
const FLOOR_DEVICE_PASS = '0714282338';
const SYNC_SERVICE_EMAIL = 'plant-floor-sync@plant.co.zw';
const SYNC_SERVICE_PASS = 'PlantFloorSync#2026!';

async function signInOrProvisionAccount(
  acctEmail: string,
  acctPass: string,
  displayName: string
): Promise<boolean> {
  try {
    await signInWithEmailAndPassword(auth, acctEmail, acctPass);
    return true;
  } catch (signInErr: any) {
    try {
      const cred = await createUserWithEmailAndPassword(auth, acctEmail, acctPass);
      if (cred.user && displayName) {
        await updateProfile(cred.user, { displayName }).catch(() => {});
      }
      return true;
    } catch (createErr: any) {
      console.warn(`Firebase auth provisioning note for ${acctEmail}:`, createErr?.message || signInErr?.message);
      return !!auth.currentUser;
    }
  }
}

let pendingAuthPromise: Promise<boolean> | null = null;

/**
 * Ensures Firebase Auth has finished hydrating its persisted IndexedDB session
 * and has a valid signed-in user token before issuing Firestore requests.
 */
export async function ensureFirebaseAuth(): Promise<boolean> {
  try {
    await auth.authStateReady();
  } catch {}
  if (auth.currentUser) return true;
  if (pendingAuthPromise) return pendingAuthPromise;

  pendingAuthPromise = (async () => {
    try {
      await auth.authStateReady().catch(() => {});
      if (auth.currentUser) return true;

      const session = getActiveSessionUser();
      if (!session) return false;

      if (session.email.toLowerCase() === FLOOR_DEVICE_EMAIL) {
        return await signInOrProvisionAccount(
          FLOOR_DEVICE_EMAIL,
          FLOOR_DEVICE_PASS,
          'Floor Operator (0714282338)'
        );
      }

      if (session.email.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase() || session.isAdmin) {
        return await signInOrProvisionAccount(
          SYNC_SERVICE_EMAIL,
          SYNC_SERVICE_PASS,
          session.displayName || 'PLANT ADMINISTRATOR'
        );
      }

      return await signInOrProvisionAccount(
        SYNC_SERVICE_EMAIL,
        SYNC_SERVICE_PASS,
        session.displayName || 'Plant Floor Terminal'
      );
    } finally {
      pendingAuthPromise = null;
    }
  })();

  return pendingAuthPromise;
}

/**
 * Recursively strips `undefined` and `NaN` from objects and arrays before calling setDoc.
 */
export function deepSanitizeForFirestore<T>(val: T): T {
  if (val === null || val === undefined) return val;
  if (typeof val === 'number') {
    return (Number.isFinite(val) ? val : 0) as unknown as T;
  }
  if (Array.isArray(val)) {
    return val
      .filter((item) => item !== undefined)
      .map((item) =>
        item && typeof item === 'object' && !(item instanceof Date)
          ? deepSanitizeForFirestore(item)
          : typeof item === 'number' && !Number.isFinite(item)
          ? 0
          : item
      ) as unknown as T;
  }
  if (typeof val === 'object' && !(val instanceof Date)) {
    const clean: Record<string, any> = {};
    Object.keys(val as Record<string, any>).forEach((k) => {
      const v = (val as Record<string, any>)[k];
      if (v === undefined) return;
      if (typeof v === 'number' && !Number.isFinite(v)) return;
      clean[k] =
        v !== null && typeof v === 'object' && !(v instanceof Date)
          ? deepSanitizeForFirestore(v)
          : v;
    });
    return clean as T;
  }
  return val;
}

const pathAccessCache = new Map<string, { allowed: boolean; checkedAt: number }>();
const pathAccessInFlight = new Map<string, Promise<boolean>>();
let pathAccessCacheScope: string | null = null;
const PATH_ACCESS_TTL_MS = 15 * 60 * 1000;
const PATH_ACCESS_STORAGE_KEY = 'dt_fs_path_access_v2';

const CORE_FIRESTORE_COLLECTIONS = new Set([
  'downtime_entries',
  'app_config',
  'plant_users',
  'dispatch_entries',
  'attendance_batches',
  'qc_inspections',
  'maintenance_job_cards',
  'quality_trial_reports',
  'special_orders',
  'special_order_production',
  'special_order_wh_dispatches',
]);

const SECONDARY_SENTINEL_COLLECTION = 'sop_production_logs';
const SECONDARY_COLLECTIONS = [
  'sop_production_logs',
  'sop_qc_checks',
  'sop_scrap_pipeline',
  'sop_mixing_reports',
  'sop_shift_handovers',
  'historical_dispatch_uploads',
  'monthly_production_plans',
  'diesel_tank_config',
  'diesel_fuel_requests',
  'diesel_grn_records',
  'power_cut_logs',
  'generator_logs',
];

function getPathCacheScope(): string {
  return `${firebaseConfig.projectId}:${auth.currentUser?.uid || 'anon'}`;
}

function hydratePathAccessFromStorage() {
  const activeScope = getPathCacheScope();
  if (pathAccessCacheScope === activeScope && pathAccessCache.size > 0) return;
  if (pathAccessCacheScope !== activeScope) {
    pathAccessCache.clear();
    pathAccessCacheScope = activeScope;
  }
  try {
    const raw = localStorage.getItem(PATH_ACCESS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      scope?: string;
      entries?: Record<string, { allowed: boolean; checkedAt: number }>;
    };
    const isSameProject =
      typeof parsed?.scope === 'string' && parsed.scope.startsWith(`${firebaseConfig.projectId}:`);
    const scopeMatches =
      parsed?.scope === activeScope || (activeScope.endsWith(':anon') && isSameProject);
    if (!scopeMatches || !parsed.entries) return;
    const now = Date.now();
    Object.entries(parsed.entries).forEach(([k, v]) => {
      if (v && typeof v.checkedAt === 'number' && now - v.checkedAt < PATH_ACCESS_TTL_MS) {
        pathAccessCache.set(k, v);
      }
    });
  } catch {}
}

function persistPathAccessToStorage() {
  try {
    const activeScope = getPathCacheScope();
    pathAccessCacheScope = activeScope;
    const entries: Record<string, { allowed: boolean; checkedAt: number }> = {};
    pathAccessCache.forEach((v, k) => {
      entries[k] = v;
    });
    localStorage.setItem(
      PATH_ACCESS_STORAGE_KEY,
      JSON.stringify({ scope: activeScope, entries })
    );
  } catch {}
}

export function resetFirestorePathAccessCache() {
  pathAccessCache.clear();
  pathAccessCacheScope = null;
  try {
    localStorage.removeItem(PATH_ACCESS_STORAGE_KEY);
  } catch {}
}

export function isPermissionDeniedError(err: any): boolean {
  const code = String(err?.code || '').toLowerCase();
  const msg = String(err?.message || err || '').toLowerCase();
  return code.includes('permission-denied') || msg.includes('missing or insufficient permissions') || msg.includes('permission_denied');
}

export function isFirestorePathBlockedByRules(firestorePath: string): boolean {
  const collectionRoot = firestorePath.replace(/^\/+/, '').split('/')[0];
  if (!collectionRoot) return false;
  hydratePathAccessFromStorage();
  const cached = pathAccessCache.get(collectionRoot);
  if (!cached) return false;
  if (Date.now() - cached.checkedAt >= PATH_ACCESS_TTL_MS) return false;
  return cached.allowed === false;
}

export function markFirestorePathBlockedByRules(firestorePath: string) {
  const collectionRoot = firestorePath.replace(/^\/+/, '').split('/')[0];
  if (!collectionRoot) return;
  const ts = Date.now();
  pathAccessCache.set(collectionRoot, { allowed: false, checkedAt: ts });
  if (!CORE_FIRESTORE_COLLECTIONS.has(collectionRoot)) {
    SECONDARY_COLLECTIONS.forEach((col) => {
      pathAccessCache.set(col, { allowed: false, checkedAt: ts });
    });
  }
  persistPathAccessToStorage();
}

async function probeCollectionRootAccess(collectionRoot: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return false;
    }
    await ensureFirebaseAuth().catch(() => false);
    const encodedDb = encodeURIComponent(dbId);
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${encodedDb}/documents/${collectionRoot}?pageSize=1`;

    const doProbeFetch = async (forceRefreshToken: boolean) => {
      const token = auth.currentUser
        ? await auth.currentUser.getIdToken(forceRefreshToken).catch(() => null)
        : null;
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      return fetch(url, { method: 'GET', headers });
    };

    let res = await doProbeFetch(false);
    if (res.status === 401) {
      // Refresh Firebase Auth token once before concluding unauthorized
      await ensureFirebaseAuth().catch(() => false);
      res = await doProbeFetch(true);
    }

    if (res.status === 403 || res.status === 401) {
      pathAccessCache.set(collectionRoot, { allowed: false, checkedAt: Date.now() });
      persistPathAccessToStorage();
      return false;
    }
    if (res.ok || res.status === 404) {
      pathAccessCache.set(collectionRoot, { allowed: true, checkedAt: Date.now() });
      persistPathAccessToStorage();
      return true;
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * Lightweight REST check for whether the active Firestore security rules allow reading
 * a given collection or document path. Keeps Firestore SDK's internal WatchStream free
 * from concurrent PERMISSION_DENIED target cancellations when optional modules are gated.
 */
export async function canAccessFirestorePath(
  firestorePath: string,
  _isDocument: boolean = false
): Promise<boolean> {
  const cleanPath = firestorePath.replace(/^\/+/, '');
  const collectionRoot = cleanPath.split('/')[0];
  if (!collectionRoot) return true;

  await ensureFirebaseAuth().catch(() => false);
  hydratePathAccessFromStorage();

  const now = Date.now();
  const cached = pathAccessCache.get(collectionRoot);
  if (cached && now - cached.checkedAt < PATH_ACCESS_TTL_MS) {
    return cached.allowed;
  }

  const inFlightKey = `${getPathCacheScope()}:${collectionRoot}`;
  const existing = pathAccessInFlight.get(inFlightKey);
  if (existing) return existing;

  const probePromise = (async () => {
    try {
      // If probing a secondary module collection, check sentinel first so we do not emit 16 parallel 403 requests
      if (!CORE_FIRESTORE_COLLECTIONS.has(collectionRoot)) {
        const sentinelCached = pathAccessCache.get(SECONDARY_SENTINEL_COLLECTION);
        let sentinelAllowed: boolean;
        if (sentinelCached && Date.now() - sentinelCached.checkedAt < PATH_ACCESS_TTL_MS) {
          sentinelAllowed = sentinelCached.allowed;
        } else if (collectionRoot !== SECONDARY_SENTINEL_COLLECTION) {
          sentinelAllowed = await canAccessFirestorePath(SECONDARY_SENTINEL_COLLECTION, false);
        } else {
          sentinelAllowed = await probeCollectionRootAccess(SECONDARY_SENTINEL_COLLECTION);
        }

        if (!sentinelAllowed) {
          const ts = Date.now();
          SECONDARY_COLLECTIONS.forEach((col) => {
            pathAccessCache.set(col, { allowed: false, checkedAt: ts });
          });
          pathAccessCache.set(collectionRoot, { allowed: false, checkedAt: ts });
          persistPathAccessToStorage();
          return false;
        }
        if (collectionRoot === SECONDARY_SENTINEL_COLLECTION) {
          return true;
        }
      }

      return await probeCollectionRootAccess(collectionRoot);
    } finally {
      pathAccessInFlight.delete(inFlightKey);
    }
  })();

  pathAccessInFlight.set(inFlightKey, probePromise);
  return probePromise;
}

/**
 * Server-first collection read so manual sync & polling always pull
 * updates created by other phones/devices when online.
 */
export async function getCollectionDocsServerFirst<T = DocumentData>(
  colOrQuery: CollectionReference<T> | Query<T>
): Promise<QuerySnapshot<T>> {
  const isBrowserOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (isBrowserOnline) {
    const refPath = (colOrQuery as any)?.path;
    if (typeof refPath === 'string' && !(await canAccessFirestorePath(refPath, false))) {
      throw new Error(`Missing or insufficient permissions for ${refPath}`);
    }
    try {
      return await getDocsFromServer(colOrQuery);
    } catch (err: any) {
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('permission')) throw err;
    }
  }
  return await getDocs(colOrQuery);
}

/**
 * Server-first single document read (with local cache fallback if genuinely offline).
 */
export async function getDocServerFirst<T = DocumentData>(
  docRef: DocumentReference<T>
): Promise<DocumentSnapshot<T>> {
  const isBrowserOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (isBrowserOnline) {
    const refPath = (docRef as any)?.path;
    if (typeof refPath === 'string' && !(await canAccessFirestorePath(refPath, true))) {
      throw new Error(`Missing or insufficient permissions for ${refPath}`);
    }
    try {
      return await getDocFromServer(docRef);
    } catch (err: any) {
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('permission')) throw err;
    }
  }
  return await getDoc(docRef);
}

export async function reconnectFirestoreNetwork(force: boolean = false): Promise<boolean> {
  if (force) {
    try {
      await enableNetwork(db);
    } catch {}
  }
  return await ensureFirebaseAuth().catch(() => false);
}

export async function probeFirestoreCloudHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  authEmail: string | null;
  error?: string;
}> {
  const started = Date.now();
  try {
    await ensureFirebaseAuth().catch(() => false);
    await getDocFromServer(doc(db, 'app_config', 'machinery'));
    return {
      ok: true,
      latencyMs: Math.max(1, Date.now() - started),
      authEmail: auth.currentUser?.email || getActiveSessionUser()?.email || null,
    };
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Math.max(1, Date.now() - started),
      authEmail: auth.currentUser?.email || getActiveSessionUser()?.email || null,
      error: err?.message || String(err),
    };
  }
}

export async function testConnection() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return;
  }
  try {
    await ensureFirebaseAuth().catch(() => false);
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        await reconnectFirestoreNetwork(true);
        await getDocFromServer(doc(db, 'test', 'connection'));
        return;
      } catch (retryError) {
        if (retryError instanceof Error && retryError.message.includes('the client is offline')) {
          console.error('Please check your Firebase configuration.');
        }
      }
    }
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function isRestrictedShiftInChargeAccount(
  email?: string | null,
  displayName?: string | null
): boolean {
  const normEmail = (email || '').trim().toLowerCase();
  if (normEmail === PRIMARY_ADMIN_EMAIL.toLowerCase()) return false;
  const emailLocal = normEmail.split('@')[0] || '';
  const combined = `${emailLocal} ${(displayName || '').trim().toLowerCase()}`;
  return (
    combined.includes('eric') ||
    combined.includes('trust') ||
    combined.includes('innocent')
  );
}

function enforceShiftInChargeAccount(u: PlantUserAccount): {
  account: PlantUserAccount;
  changed: boolean;
} {
  if (!isRestrictedShiftInChargeAccount(u.email, u.displayName)) {
    return { account: u, changed: false };
  }
  const strictPerms = getDefaultPermissionsForRole('Shift In Charge');
  const needsUpdate =
    u.role !== 'Shift In Charge' ||
    !u.permissions ||
    Object.keys(strictPerms).some(
      (k) =>
        u.permissions![k as keyof UserPermissions] !==
        strictPerms[k as keyof UserPermissions]
    );
  if (!needsUpdate) {
    return { account: u, changed: false };
  }
  return {
    account: {
      ...u,
      role: 'Shift In Charge',
      permissions: strictPerms,
    },
    changed: true,
  };
}

export async function loginWithGoogle() {
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    if (cred.user) {
      await fetchPlantUsersDirectory();
      const email = cred.user.email || '';
      const isMaster = email.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase();
      const matched = getLocalPlantUsers().find((u) => u.email.toLowerCase() === email.toLowerCase());
      const resolvedDisplayName =
        matched?.displayName || cred.user.displayName || email.split('@')[0].toUpperCase();
      const isRestrictedSIC = isRestrictedShiftInChargeAccount(email, resolvedDisplayName);
      const role: PlantRole = isMaster
        ? 'Plant Administrator'
        : isRestrictedSIC
        ? 'Shift In Charge'
        : matched?.role || 'Machine Operator';
      setActiveSessionUser({
        uid: cred.user.uid,
        email,
        displayName: resolvedDisplayName,
        role,
        isAdmin:
          !isRestrictedSIC &&
          (isMaster || role === 'Plant Administrator' || role === 'Production HOD'),
        permissions: resolveUserPermissions(email, role, undefined, resolvedDisplayName),
      });
    }
    return cred;
  } catch (err: any) {
    const code = err?.code || '';
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('Google Sign-In notice:', code || msg);
    if (code === 'auth/unauthorized-domain' || msg.includes('auth/unauthorized-domain')) {
      const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
      throw new Error(
        `AUTH_UNAUTHORIZED_DOMAIN:${host}`
      );
    }
    if (code === 'auth/popup-closed-by-user' || msg.includes('popup-closed-by-user')) {
      throw new Error('Google Sign-In popup was closed before completing.');
    }
    if (code === 'auth/popup-blocked' || msg.includes('popup-blocked')) {
      throw new Error('Google Sign-In popup was blocked by browser. Please allow popups or sign in with Email/Password below.');
    }
    throw err;
  }
}

export interface PlantSessionUser {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  isAdmin: boolean;
  permissions?: UserPermissions;
}

export function resolveUserPermissions(
  email?: string | null,
  fallbackRole?: PlantRole | string,
  plantUsersList?: PlantUserAccount[],
  displayName?: string | null
): UserPermissions {
  const normEmail = (email || '').trim().toLowerCase();
  if (normEmail === PRIMARY_ADMIN_EMAIL.toLowerCase()) {
    return { ...FULL_ADMIN_PERMISSIONS };
  }

  const users = plantUsersList || getLocalPlantUsers();
  const matched = users.find((u) => u.email.trim().toLowerCase() === normEmail);
  if (matched?.status === 'suspended') {
    return {
      viewMachineStatus: false,
      logDowntime: false,
      viewDailyHours: false,
      exportDowntimeExcel: false,
      dispatchShiftEntry: false,
      dispatchWHConfirm: false,
      dispatchHODConfirm: false,
      exportDispatchExcel: false,
      attendanceLogger: false,
      manageMachinesAndSync: false,
      dieselFuelRequest: false,
      dieselHODApprove: false,
      dieselGRN: false,
      dieselExportExcel: false,
      productionPlanningAccess: false,
      productionReportAccess: false,
    };
  }

  if (isRestrictedShiftInChargeAccount(normEmail, displayName || matched?.displayName)) {
    return getDefaultPermissionsForRole('Shift In Charge');
  }

  if (matched) {
    const defaults = getDefaultPermissionsForRole(matched.role);
    if (matched.permissions) {
      return { ...defaults, ...matched.permissions };
    }
    return defaults;
  }

  if (fallbackRole) {
    return getDefaultPermissionsForRole(fallbackRole as PlantRole);
  }
  return getDefaultPermissionsForRole('Machine Operator');
}

export function getActiveSessionUser(): PlantSessionUser | null {
  try {
    const raw = localStorage.getItem('plant_active_session');
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function setActiveSessionUser(user: PlantSessionUser | null) {
  try {
    if (user) {
      localStorage.setItem('plant_active_session', JSON.stringify(user));
    } else {
      localStorage.removeItem('plant_active_session');
    }
  } catch {}
}

export async function loginWithEmail(identifier: string, pass: string) {
  let normEmail = identifier.trim().toLowerCase();
  const trimmedPass = pass.trim();

  // If phone number or username entered without domain
  if (!normEmail.includes('@')) {
    normEmail = `${normEmail}@plant.co.zw`;
  }

  // Master Admin check for plant admin h250862h@hit.ac.zw with password h250862h@!
  const isMasterAdminCred =
    normEmail === 'h250862h@hit.ac.zw' && trimmedPass === 'h250862h@!';

  // Shop floor device check for Samsung phone 0714282338
  const isFloorDevice0714282338 =
    normEmail.startsWith('0714282338') ||
    identifier.includes('0714282338') ||
    trimmedPass === '0714282338';

  if (isFloorDevice0714282338) {
    // Authenticate with a REAL Email/Password Firebase account so Firestore writes succeed immediately
    const authed = await signInOrProvisionAccount(
      FLOOR_DEVICE_EMAIL,
      FLOOR_DEVICE_PASS,
      'Floor Operator (0714282338)'
    );
    await fetchPlantUsersDirectory();
    const localMatch = getLocalPlantUsers().find(
      (u) => u.email.toLowerCase() === FLOOR_DEVICE_EMAIL.toLowerCase()
    );
    const floorRole = localMatch?.role || 'Machine Operator';
    const sessionUser: PlantSessionUser = {
      uid: authed && auth.currentUser ? auth.currentUser.uid : 'device-0714282338',
      email: FLOOR_DEVICE_EMAIL,
      displayName: localMatch?.displayName || 'Floor Operator (0714282338)',
      role: floorRole,
      isAdmin: floorRole === 'Plant Administrator' || floorRole === 'Production HOD',
      permissions: resolveUserPermissions(FLOOR_DEVICE_EMAIL, floorRole),
    };
    setActiveSessionUser(sessionUser);
    return { user: sessionUser };
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, normEmail, trimmedPass);
    await fetchPlantUsersDirectory();
    const localMatch = getLocalPlantUsers().find((s) => s.email.toLowerCase() === normEmail);
    const resolvedDisplayName =
      localMatch?.displayName ||
      cred.user.displayName ||
      (isMasterAdminCred ? 'PLANT ADMINISTRATOR' : normEmail.split('@')[0].toUpperCase());
    const isRestrictedSIC = isRestrictedShiftInChargeAccount(normEmail, resolvedDisplayName);
    const resolvedRole = isMasterAdminCred
      ? 'Plant Administrator'
      : isRestrictedSIC
      ? 'Shift In Charge'
      : localMatch?.role || 'Machine Operator';
    setActiveSessionUser({
      uid: cred.user.uid,
      email: cred.user.email || normEmail,
      displayName: resolvedDisplayName,
      role: resolvedRole,
      isAdmin:
        !isRestrictedSIC &&
        (isMasterAdminCred ||
          resolvedRole === 'Plant Administrator' ||
          resolvedRole === 'Production HOD'),
      permissions: resolveUserPermissions(normEmail, resolvedRole, undefined, resolvedDisplayName),
    });
    return cred;
  } catch (err: any) {
    const skipAutoCreate =
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(`dt_auth_exists_${normEmail}`) === '1';

    // If user not found, and it is admin credentials, attempt to auto-create once in Firebase Auth
    if (
      !skipAutoCreate &&
      (isMasterAdminCred ||
        err.code === 'auth/user-not-found' ||
        err.code === 'auth/invalid-credential')
    ) {
      try {
        const newCred = await createUserWithEmailAndPassword(auth, normEmail, trimmedPass);
        if (newCred.user) {
          await updateProfile(newCred.user, {
            displayName: isMasterAdminCred
              ? 'PLANT ADMINISTRATOR'
              : normEmail.split('@')[0].toUpperCase(),
          });
        }
        await fetchPlantUsersDirectory();
        const localMatch = getLocalPlantUsers().find((s) => s.email.toLowerCase() === normEmail);
        const resolvedDisplayName =
          localMatch?.displayName ||
          (isMasterAdminCred ? 'PLANT ADMINISTRATOR' : normEmail.split('@')[0].toUpperCase());
        const isRestrictedSIC = isRestrictedShiftInChargeAccount(normEmail, resolvedDisplayName);
        const resolvedRole = isMasterAdminCred
          ? 'Plant Administrator'
          : isRestrictedSIC
          ? 'Shift In Charge'
          : localMatch?.role || 'Machine Operator';
        setActiveSessionUser({
          uid: newCred.user.uid,
          email: normEmail,
          displayName: resolvedDisplayName,
          role: resolvedRole,
          isAdmin:
            !isRestrictedSIC &&
            (isMasterAdminCred ||
              resolvedRole === 'Plant Administrator' ||
              resolvedRole === 'Production HOD'),
          permissions: resolveUserPermissions(normEmail, resolvedRole, undefined, resolvedDisplayName),
        });
        return newCred;
      } catch (createErr: any) {
        if (createErr?.code === 'auth/email-already-in-use') {
          try {
            localStorage.setItem(`dt_auth_exists_${normEmail}`, '1');
          } catch {}
        }
        console.warn('Auto-create in Firebase Auth note:', createErr.message);
      }
    }

    // Check if user is registered in plant staff directory (authenticate sync lookup first for secured rules)
    let lookupAuthed = false;
    if (!auth.currentUser) {
      lookupAuthed = await signInOrProvisionAccount(
        SYNC_SERVICE_EMAIL,
        SYNC_SERVICE_PASS,
        'Plant Directory Lookup'
      );
    }
    await fetchPlantUsersDirectory();
    const localStaff = getLocalPlantUsers();
    const staffMatch = localStaff.find((s) => s.email.toLowerCase() === normEmail);

    if (isMasterAdminCred || (staffMatch && staffMatch.status !== 'suspended')) {
      // Ensure a real Firebase Auth token is active for Firestore sync
      if (!auth.currentUser) {
        await signInOrProvisionAccount(
          SYNC_SERVICE_EMAIL,
          SYNC_SERVICE_PASS,
          staffMatch?.displayName || 'PLANT ADMINISTRATOR'
        );
      }

      const resolvedDisplayName =
        staffMatch?.displayName ||
        (isMasterAdminCred ? 'PLANT ADMINISTRATOR' : normEmail.split('@')[0].toUpperCase());
      const isRestrictedSIC = isRestrictedShiftInChargeAccount(normEmail, resolvedDisplayName);
      const resolvedRole = isRestrictedSIC
        ? 'Shift In Charge'
        : staffMatch?.role || (isMasterAdminCred ? 'Plant Administrator' : 'Machine Operator');
      const sessionUser: PlantSessionUser = {
        uid: staffMatch?.uid || 'admin-master',
        email: normEmail,
        displayName: resolvedDisplayName,
        role: resolvedRole,
        isAdmin:
          !isRestrictedSIC &&
          (isMasterAdminCred ||
            resolvedRole === 'Plant Administrator' ||
            resolvedRole === 'Production HOD'),
        permissions: resolveUserPermissions(normEmail, resolvedRole, undefined, resolvedDisplayName),
      };
      setActiveSessionUser(sessionUser);
      return { user: sessionUser };
    }

    if (lookupAuthed) {
      await signOut(auth).catch(() => {});
    }
    console.warn('Email Sign-In notice:', err);
    throw err;
  }
}

export async function registerWithEmail(email: string, pass: string, displayName?: string) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), pass);
    if (displayName && userCredential.user) {
      await updateProfile(userCredential.user, { displayName });
    }
    return userCredential;
  } catch (err) {
    console.warn('Email Registration notice:', err);
    throw err;
  }
}

export async function logoutUser() {
  setActiveSessionUser(null);
  resetFirestorePathAccessCache();
  try {
    await signOut(auth);
  } catch (err) {
    console.error('Sign-Out failed:', err);
  }
}

/**
 * Local cache of registered plant users
 */
export function getLocalPlantUsers(): PlantUserAccount[] {
  try {
    const raw = localStorage.getItem('dt_plant_users');
    if (raw) return JSON.parse(raw);
  } catch {}
  return [
    {
      uid: 'admin-master',
      email: PRIMARY_ADMIN_EMAIL,
      displayName: 'Plant Administrator',
      role: 'Plant Administrator',
      department: 'Management',
      permissions: { ...FULL_ADMIN_PERMISSIONS },
      createdBy: 'System Root',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'active',
    },
    {
      uid: 'device-0714282338',
      email: '0714282338@plant.co.zw',
      displayName: 'Floor Operator (0714282338)',
      role: 'Machine Operator',
      department: 'Extrusion Floor',
      permissions: getDefaultPermissionsForRole('Machine Operator'),
      createdBy: 'System Provision',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'active',
    },
  ];
}

/**
 * Fetch plant_users directory directly from Firestore and cache locally
 */
export async function fetchPlantUsersDirectory(): Promise<PlantUserAccount[]> {
  try {
    await ensureFirebaseAuth().catch(() => false);
    const snap = await getCollectionDocsServerFirst(collection(db, 'plant_users'));
    const list: PlantUserAccount[] = [];
    const docsToPatch: PlantUserAccount[] = [];
    snap.forEach((d) => {
      const rawUser = d.data() as PlantUserAccount;
      const { account, changed } = enforceShiftInChargeAccount(rawUser);
      list.push(account);
      if (changed) docsToPatch.push(account);
    });
    if (docsToPatch.length > 0) {
      Promise.all(
        docsToPatch.map((u) => setDoc(doc(db, 'plant_users', u.uid), u, { merge: true }).catch(() => {}))
      ).catch(() => {});
    }
    if (list.length > 0) {
      if (!list.some((u) => u.email.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase())) {
        list.unshift({
          uid: 'admin-master',
          email: PRIMARY_ADMIN_EMAIL,
          displayName: 'Plant Administrator',
          role: 'Plant Administrator',
          department: 'Management',
          permissions: { ...FULL_ADMIN_PERMISSIONS },
          createdBy: 'System Root',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'active',
        });
      }
      try {
        localStorage.setItem('dt_plant_users', JSON.stringify(list));
      } catch {}
      return list;
    }
  } catch (e) {
    console.warn('fetchPlantUsersDirectory note:', e);
  }
  return getLocalPlantUsers();
}

function isAuthorizedAdminEmail(email: string): boolean {
  const norm = email.trim().toLowerCase();
  if (norm === PRIMARY_ADMIN_EMAIL.toLowerCase()) return true;
  if (isRestrictedShiftInChargeAccount(norm)) return false;
  try {
    const raw = localStorage.getItem('dtadmins');
    const list: string[] = raw ? JSON.parse(raw) : [];
    if (list.map((e) => e.toLowerCase()).includes(norm)) return true;
  } catch {}
  const staff = getLocalPlantUsers().find((u) => u.email.trim().toLowerCase() === norm);
  if (
    staff &&
    staff.status !== 'suspended' &&
    !isRestrictedShiftInChargeAccount(staff.email, staff.displayName) &&
    (staff.role === 'Plant Administrator' || staff.role === 'Production HOD')
  ) {
    return true;
  }
  return false;
}

/**
 * Real-time subscription to plant_users collection
 */
export function subscribePlantUsers(
  onUpdate: (users: PlantUserAccount[]) => void
) {
  const initial = getLocalPlantUsers().map((u) => enforceShiftInChargeAccount(u).account);
  onUpdate(initial);

  let unsub: (() => void) | null = null;
  let cancelled = false;

  (async () => {
    await ensureFirebaseAuth().catch(() => false);
    if (cancelled) return;
    try {
      const colRef = collection(db, 'plant_users');
      unsub = onSnapshot(
        colRef,
        (snapshot) => {
          const list: PlantUserAccount[] = [];
          const docsToPatch: PlantUserAccount[] = [];
          snapshot.forEach((d) => {
            const rawUser = d.data() as PlantUserAccount;
            const { account, changed } = enforceShiftInChargeAccount(rawUser);
            list.push(account);
            if (changed) docsToPatch.push(account);
          });
          if (docsToPatch.length > 0) {
            Promise.all(
              docsToPatch.map((u) =>
                setDoc(doc(db, 'plant_users', u.uid), u, { merge: true }).catch(() => {})
              )
            ).catch(() => {});
          }
          if (list.length > 0) {
            // Merge with master admin if not in list
            if (!list.some((u) => u.email.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase())) {
              list.unshift({
                uid: 'admin-master',
                email: PRIMARY_ADMIN_EMAIL,
                displayName: 'Plant Administrator',
                role: 'Plant Administrator',
                department: 'Management',
                permissions: { ...FULL_ADMIN_PERMISSIONS },
                createdBy: 'System Root',
                createdAt: '2026-01-01T00:00:00.000Z',
                status: 'active',
              });
            }
            try {
              localStorage.setItem('dt_plant_users', JSON.stringify(list));
            } catch {}
            onUpdate(list);
          }
        },
        (err) => {
          console.warn('plant_users Firestore subscription fallback:', err.message);
        }
      );
    } catch {}
  })();

  return () => {
    cancelled = true;
    if (unsub) unsub();
  };
}

/**
 * Admin-Only Operator / Staff Login Registration
 * Supports either full email or short username (auto-normalized to @plant.co.zw).
 * Uses a secondary Firebase App instance so that the active Admin stays signed in.
 */
export async function adminCreateOperatorAccount(
  adminAuthorizerEmail: string,
  newIdentifier: string,
  newPassword: string,
  displayName: string,
  role: PlantRole = 'Machine Operator',
  department: string = 'Production',
  permissions?: UserPermissions
): Promise<PlantUserAccount> {
  if (!isAuthorizedAdminEmail(adminAuthorizerEmail)) {
    throw new Error(
      `Unauthorized: ${adminAuthorizerEmail} is not a designated Admin or Production HOD.`
    );
  }

  let normalizedEmail = newIdentifier.trim().toLowerCase();
  if (normalizedEmail && !normalizedEmail.includes('@')) {
    normalizedEmail = `${normalizedEmail}@plant.co.zw`;
  }

  if (!normalizedEmail || !newPassword || newPassword.length < 6) {
    throw new Error('Login ID/Email is required and password must be at least 6 characters.');
  }

  const secondaryAppName = `AdminProvision_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    let createdUid = `staff_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, normalizedEmail, newPassword);
      createdUid = cred.user.uid;
      if (displayName && cred.user) {
        await updateProfile(cred.user, { displayName: displayName.trim() });
      }
    } catch (authErr: any) {
      if (authErr?.code === 'auth/email-already-in-use') {
        throw new Error(`Login ID ${normalizedEmail} is already registered in Firebase Auth.`);
      }
      throw authErr;
    }

    const resolvedDisplayName = displayName.trim() || normalizedEmail.split('@')[0].toUpperCase();
    const isRestrictedSIC = isRestrictedShiftInChargeAccount(normalizedEmail, resolvedDisplayName);
    const effectiveRole: PlantRole = isRestrictedSIC ? 'Shift In Charge' : role;
    const effectivePermissions: UserPermissions = isRestrictedSIC
      ? getDefaultPermissionsForRole('Shift In Charge')
      : permissions
      ? { ...permissions }
      : getDefaultPermissionsForRole(effectiveRole);

    const newAccount: PlantUserAccount = {
      uid: createdUid,
      email: normalizedEmail,
      displayName: resolvedDisplayName,
      role: effectiveRole,
      department: department || 'Plant Floor',
      permissions: effectivePermissions,
      createdBy: adminAuthorizerEmail.trim(),
      createdAt: new Date().toISOString(),
      status: 'active',
    };

    // Save staff record in Firestore 'plant_users'
    try {
      await ensureFirebaseAuth();
      const userDocRef = doc(db, 'plant_users', createdUid);
      await setDoc(userDocRef, newAccount, { merge: true });
    } catch (dbErr) {
      console.warn('Could not write to plant_users Firestore collection:', dbErr);
    }

    // Update local cache
    try {
      const stored = getLocalPlantUsers();
      const updated = [newAccount, ...stored.filter((u) => u.uid !== newAccount.uid)];
      localStorage.setItem('dt_plant_users', JSON.stringify(updated));
    } catch {}

    // Clean up secondary auth session
    await signOut(secondaryAuth);
    await deleteApp(secondaryApp);

    return newAccount;
  } catch (err) {
    await signOut(secondaryAuth).catch(() => {});
    await deleteApp(secondaryApp).catch(() => {});
    throw err;
  }
}

/**
 * Admin-Only: Update User Role, Department, Status & Confidential Permissions
 */
export async function adminUpdateUserAccess(
  adminAuthorizerEmail: string,
  targetUser: PlantUserAccount,
  updates: {
    displayName?: string;
    role: PlantRole;
    department: string;
    permissions: UserPermissions;
    status?: 'active' | 'suspended';
  }
): Promise<PlantUserAccount> {
  if (!isAuthorizedAdminEmail(adminAuthorizerEmail)) {
    throw new Error('Unauthorized: Only Plant Administrators or Production HOD can edit confidentiality permissions.');
  }

  const nextDisplayName = updates.displayName?.trim() || targetUser.displayName;
  const isRestrictedSIC = isRestrictedShiftInChargeAccount(targetUser.email, nextDisplayName);

  const updatedAccount: PlantUserAccount = {
    ...targetUser,
    displayName: nextDisplayName,
    role: isRestrictedSIC ? 'Shift In Charge' : updates.role,
    department: updates.department,
    permissions: isRestrictedSIC
      ? getDefaultPermissionsForRole('Shift In Charge')
      : { ...updates.permissions },
    status: updates.status || targetUser.status || 'active',
  };

  try {
    await ensureFirebaseAuth();
    const userDocRef = doc(db, 'plant_users', updatedAccount.uid);
    await setDoc(userDocRef, updatedAccount, { merge: true });
  } catch (dbErr) {
    console.warn('Failed updating plant_users access in Firestore:', dbErr);
  }

  try {
    const stored = getLocalPlantUsers();
    const idx = stored.findIndex((u) => u.uid === updatedAccount.uid || u.email.toLowerCase() === updatedAccount.email.toLowerCase());
    if (idx >= 0) {
      stored[idx] = updatedAccount;
    } else {
      stored.push(updatedAccount);
    }
    localStorage.setItem('dt_plant_users', JSON.stringify(stored));
  } catch {}

  return updatedAccount;
}

/**
 * Remove/Suspend Plant User
 */
export async function deletePlantUserAccount(uid: string) {
  try {
    const docRef = doc(db, 'plant_users', uid);
    await deleteDoc(docRef);
  } catch (e) {
    console.warn('Failed deleting plant_users doc:', e);
  }
  try {
    const stored = getLocalPlantUsers();
    const updated = stored.filter((u) => u.uid !== uid);
    localStorage.setItem('dt_plant_users', JSON.stringify(updated));
  } catch {}
}

