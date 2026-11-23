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
  ZERO_PERMISSIONS,
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

// Clear any legacy persisted path-access blocklist from earlier builds
try {
  localStorage.removeItem('dt_fs_path_access_v2');
} catch {}

// Short in-memory cooldown ONLY when a live, authenticated online Firestore SDK call throws permission-denied.
// Never persists to localStorage and never cross-blocks unrelated collections.
const pathBlockedUntil = new Map<string, number>();
let lastAuthUidForCooldown: string | null = null;
const PERMISSION_COOLDOWN_MS = 20 * 1000;

export function resetFirestorePathAccessCache() {
  pathBlockedUntil.clear();
  lastAuthUidForCooldown = auth.currentUser?.uid || null;
}

export function isPermissionDeniedError(err: any): boolean {
  const code = String(err?.code || '').toLowerCase();
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    code.includes('permission-denied') ||
    msg.includes('missing or insufficient permissions') ||
    msg.includes('permission_denied')
  );
}

export function isFirestorePathBlockedByRules(firestorePath: string): boolean {
  const currentUid = auth.currentUser?.uid || null;
  if (lastAuthUidForCooldown !== currentUid) {
    pathBlockedUntil.clear();
    lastAuthUidForCooldown = currentUid;
  }
  const collectionRoot = firestorePath.replace(/^\/+/, '').split('/')[0];
  if (!collectionRoot) return false;
  const blockedUntil = pathBlockedUntil.get(collectionRoot);
  if (!blockedUntil) return false;
  if (Date.now() >= blockedUntil) {
    pathBlockedUntil.delete(collectionRoot);
    return false;
  }
  return true;
}

export function markFirestorePathBlockedByRules(firestorePath: string) {
  if (!auth.currentUser) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const collectionRoot = firestorePath.replace(/^\/+/, '').split('/')[0];
  if (!collectionRoot) return;
  lastAuthUidForCooldown = auth.currentUser.uid;
  pathBlockedUntil.set(collectionRoot, Date.now() + PERMISSION_COOLDOWN_MS);
}

/**
 * Ensures Firebase Auth is ready before opening a Firestore WatchStream or query,
 * and checks only whether this specific collection is in a brief 20s permission cooldown.
 */
export async function canAccessFirestorePath(
  firestorePath: string,
  _isDocument: boolean = false
): Promise<boolean> {
  await ensureFirebaseAuth().catch(() => false);
  return !isFirestorePathBlockedByRules(firestorePath);
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
    await ensureFirebaseAuth().catch(() => false);
    const refPath = (colOrQuery as any)?.path;
    try {
      return await getDocsFromServer(colOrQuery);
    } catch (err: any) {
      if (isPermissionDeniedError(err)) {
        if (typeof refPath === 'string') {
          markFirestorePathBlockedByRules(refPath);
        }
        throw err;
      }
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
    await ensureFirebaseAuth().catch(() => false);
    const refPath = (docRef as any)?.path;
    try {
      return await getDocFromServer(docRef);
    } catch (err: any) {
      if (isPermissionDeniedError(err)) {
        if (typeof refPath === 'string') {
          markFirestorePathBlockedByRules(refPath);
        }
        throw err;
      }
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
      if (!isMaster && matched?.status === 'suspended') {
        setActiveSessionUser(null);
        await signOut(auth).catch(() => {});
        throw new Error('This account has been suspended or revoked by the Plant Administrator.');
      }
      const resolvedDisplayName =
        matched?.displayName || cred.user.displayName || email.split('@')[0].toUpperCase();
      const isRestrictedSIC = isRestrictedShiftInChargeAccount(email, resolvedDisplayName);
      const role: PlantRole = isMaster
        ? 'Plant Administrator'
        : isRestrictedSIC
        ? 'Shift In Charge'
        : matched?.role || 'Machine Operator';
      resetFirestorePathAccessCache();
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
    return { ...ZERO_PERMISSIONS };
  }

  if (isRestrictedShiftInChargeAccount(normEmail, displayName || matched?.displayName)) {
    return getDefaultPermissionsForRole('Shift In Charge');
  }

  if (matched) {
    const defaults = getDefaultPermissionsForRole(matched.role);
    if (matched.permissions) {
      return { ...ZERO_PERMISSIONS, ...defaults, ...matched.permissions };
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

  // Shop floor shared device terminal login for Samsung phone 0714282338
  const isFloorDevice0714282338 =
    (normEmail === FLOOR_DEVICE_EMAIL || identifier.trim() === '0714282338') &&
    trimmedPass === FLOOR_DEVICE_PASS;

  if (isFloorDevice0714282338) {
    const authed = await signInOrProvisionAccount(
      FLOOR_DEVICE_EMAIL,
      FLOOR_DEVICE_PASS,
      'Floor Operator (0714282338)'
    );
    await fetchPlantUsersDirectory();
    const localMatch = getLocalPlantUsers().find(
      (u) => u.email.toLowerCase() === FLOOR_DEVICE_EMAIL.toLowerCase()
    );
    if (localMatch?.status === 'suspended') {
      setActiveSessionUser(null);
      await signOut(auth).catch(() => {});
      throw new Error('This terminal account has been suspended by the Plant Administrator.');
    }
    const floorRole = localMatch?.role || 'Machine Operator';
    resetFirestorePathAccessCache();
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
    if (!isMasterAdminCred && localMatch?.status === 'suspended') {
      setActiveSessionUser(null);
      await signOut(auth).catch(() => {});
      throw new Error('This account has been suspended or revoked by the Plant Administrator.');
    }
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
    resetFirestorePathAccessCache();
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
    // Only exact Master Admin credentials may auto-provision or recover on initial deployment
    if (isMasterAdminCred) {
      try {
        const newCred = await createUserWithEmailAndPassword(auth, normEmail, trimmedPass);
        if (newCred.user) {
          await updateProfile(newCred.user, { displayName: 'PLANT ADMINISTRATOR' });
        }
        resetFirestorePathAccessCache();
        setActiveSessionUser({
          uid: newCred.user.uid,
          email: normEmail,
          displayName: 'PLANT ADMINISTRATOR',
          role: 'Plant Administrator',
          isAdmin: true,
          permissions: { ...FULL_ADMIN_PERMISSIONS },
        });
        return newCred;
      } catch {
        const authed = await signInOrProvisionAccount(
          SYNC_SERVICE_EMAIL,
          SYNC_SERVICE_PASS,
          'PLANT ADMINISTRATOR'
        );
        if (authed && auth.currentUser) {
          resetFirestorePathAccessCache();
          const sessionUser: PlantSessionUser = {
            uid: 'admin-master',
            email: normEmail,
            displayName: 'PLANT ADMINISTRATOR',
            role: 'Plant Administrator',
            isAdmin: true,
            permissions: { ...FULL_ADMIN_PERMISSIONS },
          };
          setActiveSessionUser(sessionUser);
          return { user: sessionUser };
        }
      }
    }

    console.warn('Email Sign-In notice:', err?.code || err?.message || err);
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

const PLANT_USERS_PENDING_KEY = 'dt_plant_users_pending_v1';

function saveLocalPlantUsers(list: PlantUserAccount[]) {
  try {
    localStorage.setItem('dt_plant_users', JSON.stringify(list));
  } catch {}
}

function getPendingPlantUsersQueue(): string[] {
  try {
    const raw = localStorage.getItem(PLANT_USERS_PENDING_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string' && id) : [];
  } catch {
    return [];
  }
}

function addPendingPlantUser(uid: string) {
  if (!uid || uid === 'admin-master') return;
  try {
    const q = getPendingPlantUsersQueue();
    if (!q.includes(uid)) {
      localStorage.setItem(PLANT_USERS_PENDING_KEY, JSON.stringify([...q, uid]));
    }
  } catch {}
}

function removePendingPlantUser(uid: string) {
  try {
    const q = getPendingPlantUsersQueue().filter((x) => x !== uid);
    localStorage.setItem(PLANT_USERS_PENDING_KEY, JSON.stringify(q));
  } catch {}
}

export function repairPendingPlantUsersQueue(): number {
  try {
    const queue = getPendingPlantUsersQueue();
    if (!queue.length) return 0;
    const local = getLocalPlantUsers();
    const byUid = new Map(local.map((u) => [u.uid, u]));
    const cleaned = queue.filter((uid) => {
      const u = byUid.get(uid);
      if (!u || uid === 'admin-master') return false;
      if (u.sy && (!u.upd || u.sy >= u.upd)) return false;
      return true;
    });
    if (cleaned.length !== queue.length) {
      localStorage.setItem(PLANT_USERS_PENDING_KEY, JSON.stringify(cleaned));
    }
    return cleaned.length;
  } catch {
    return 0;
  }
}

export function getPendingPlantUsersCount(): number {
  return isFirestorePathBlockedByRules('plant_users') ? 0 : getPendingPlantUsersQueue().length;
}

function clearSyncedPlantUsersFromQueue(local: PlantUserAccount[], remote: PlantUserAccount[]) {
  const pending = getPendingPlantUsersQueue();
  if (!pending.length) return;
  const localMap = new Map(local.map((u) => [u.uid, u]));
  const remoteMap = new Map(remote.map((u) => [u.uid, u]));
  pending.forEach((uid) => {
    const r = remoteMap.get(uid);
    const l = localMap.get(uid);
    if (r && (!l || (r.upd || 0) >= (l.upd || 0))) {
      removePendingPlantUser(uid);
    }
  });
}

function queueLocalPlantUsersMissingFromRemote(
  merged: PlantUserAccount[],
  remote: PlantUserAccount[]
): PlantUserAccount[] {
  const remoteMap = new Map(remote.map((u) => [u.uid, u]));
  let mutated = false;
  const next = merged.map((u) => {
    if (!u?.uid || u.uid === 'admin-master' || u.uid === 'device-0714282338') return u;
    const r = remoteMap.get(u.uid);
    const needsUpload = !r || (u.upd || 0) > (r.upd || 0);
    if (needsUpload) {
      addPendingPlantUser(u.uid);
      if (u.sy !== 0) {
        mutated = true;
        return { ...u, sy: 0 };
      }
    }
    return u;
  });
  return mutated ? next : merged;
}

function ensureSystemMasterAdminInList(list: PlantUserAccount[]): PlantUserAccount[] {
  if (list.some((u) => u.email.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase())) {
    return list;
  }
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
    ...list,
  ];
}

function mergePlantUsers(local: PlantUserAccount[], remote: PlantUserAccount[]): PlantUserAccount[] {
  const map = new Map<string, PlantUserAccount>();
  local.forEach((u) => {
    if (u?.uid) map.set(u.uid, enforceShiftInChargeAccount(u).account);
  });
  remote.forEach((r) => {
    if (!r?.uid) return;
    const normR = enforceShiftInChargeAccount(r).account;
    const existing = map.get(normR.uid);
    if (!existing) {
      map.set(normR.uid, normR);
    } else if (existing.status === 'suspended' && normR.status !== 'suspended') {
      if ((normR.upd || 0) > (existing.upd || 0)) {
        map.set(normR.uid, normR);
      }
    } else if ((normR.upd || 0) >= (existing.upd || 0)) {
      map.set(normR.uid, normR);
    }
  });
  return ensureSystemMasterAdminInList(Array.from(map.values()));
}

export async function flushPendingPlantUsers(): Promise<number> {
  repairPendingPlantUsersQueue();
  await ensureFirebaseAuth().catch(() => false);
  if (isFirestorePathBlockedByRules('plant_users')) return 0;

  const local = getLocalPlantUsers();
  const pendingSet = new Set<string>(getPendingPlantUsersQueue());
  local.forEach((u) => {
    if (
      u?.uid &&
      u.uid !== 'admin-master' &&
      u.uid !== 'device-0714282338' &&
      (!u.sy || (u.upd && u.upd > u.sy))
    ) {
      pendingSet.add(u.uid);
    }
  });
  if (pendingSet.size === 0) return 0;

  let flushed = 0;
  for (const uid of Array.from(pendingSet)) {
    const found = local.find((u) => u.uid === uid);
    if (!found) {
      removePendingPlantUser(uid);
      continue;
    }
    try {
      const syncTs = Math.max(Date.now(), found.upd || 0);
      const payload = deepSanitizeForFirestore({ ...found, sy: syncTs });
      await setDoc(doc(db, 'plant_users', uid), payload, { merge: true });
      removePendingPlantUser(uid);
      const latest = getLocalPlantUsers().map((u) =>
        u.uid === uid ? { ...u, sy: syncTs } : u
      );
      saveLocalPlantUsers(latest);
      flushed++;
    } catch (err: any) {
      if (isPermissionDeniedError(err)) {
        markFirestorePathBlockedByRules('plant_users');
        break;
      }
    }
  }
  return flushed;
}

/**
 * Fetch plant_users directory directly from Firestore and cache locally
 */
export async function fetchPlantUsersDirectory(): Promise<PlantUserAccount[]> {
  try {
    await ensureFirebaseAuth().catch(() => false);
    const snap = await getCollectionDocsServerFirst(collection(db, 'plant_users'));
    const remote: PlantUserAccount[] = [];
    const docsToPatch: PlantUserAccount[] = [];
    snap.forEach((d) => {
      const rawUser = d.data() as PlantUserAccount;
      const { account, changed } = enforceShiftInChargeAccount({
        ...rawUser,
        uid: rawUser.uid || d.id,
        sy: rawUser.sy || rawUser.upd || 1,
      });
      remote.push(account);
      if (changed) docsToPatch.push(account);
    });
    if (docsToPatch.length > 0) {
      Promise.all(
        docsToPatch.map((u) =>
          setDoc(doc(db, 'plant_users', u.uid), deepSanitizeForFirestore(u), { merge: true }).catch(
            () => {}
          )
        )
      ).catch(() => {});
    }
    const local = getLocalPlantUsers();
    const mergedRaw = mergePlantUsers(local, remote);
    clearSyncedPlantUsersFromQueue(local, remote);
    const merged = queueLocalPlantUsersMissingFromRemote(mergedRaw, remote);
    saveLocalPlantUsers(merged);
    return merged;
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
 * Real-time subscription to plant_users collection (auto-retry + periodic server reconcile)
 */
export function subscribePlantUsers(
  onUpdate: (users: PlantUserAccount[]) => void
) {
  const initial = getLocalPlantUsers().map((u) => enforceShiftInChargeAccount(u).account);
  onUpdate(initial);

  let unsub: (() => void) | null = null;
  let cancelled = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  const scheduleRetry = () => {
    if (cancelled || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!cancelled) start();
    }, 15000);
  };

  const start = async () => {
    await ensureFirebaseAuth().catch(() => false);
    if (cancelled) return;
    try {
      if (unsub) {
        unsub();
        unsub = null;
      }
      const colRef = collection(db, 'plant_users');
      unsub = onSnapshot(
        colRef,
        { includeMetadataChanges: true },
        (snapshot) => {
          const remote: PlantUserAccount[] = [];
          const docsToPatch: PlantUserAccount[] = [];
          snapshot.forEach((d) => {
            const rawUser = d.data() as PlantUserAccount;
            const { account, changed } = enforceShiftInChargeAccount({
              ...rawUser,
              uid: rawUser.uid || d.id,
              sy: rawUser.sy || rawUser.upd || 1,
            });
            remote.push(account);
            if (changed) docsToPatch.push(account);
          });
          if (docsToPatch.length > 0) {
            Promise.all(
              docsToPatch.map((u) =>
                setDoc(doc(db, 'plant_users', u.uid), deepSanitizeForFirestore(u), {
                  merge: true,
                }).catch(() => {})
              )
            ).catch(() => {});
          }
          const local = getLocalPlantUsers();
          const mergedRaw = mergePlantUsers(local, remote);
          const merged = !snapshot.metadata.fromCache
            ? queueLocalPlantUsersMissingFromRemote(mergedRaw, remote)
            : mergedRaw;
          clearSyncedPlantUsersFromQueue(local, remote);
          saveLocalPlantUsers(merged);
          onUpdate(merged);

          if (!snapshot.metadata.fromCache) {
            flushPendingPlantUsers().catch(() => {});
          }
        },
        (err) => {
          if (isPermissionDeniedError(err)) {
            markFirestorePathBlockedByRules('plant_users');
          }
          console.warn('plant_users Firestore subscription fallback:', err.message);
          scheduleRetry();
        }
      );
    } catch {
      scheduleRetry();
    }
  };

  start();

  pollInterval = setInterval(() => {
    if (!cancelled) {
      flushPendingPlantUsers().catch(() => {});
      fetchPlantUsersDirectory()
        .then((users) => {
          if (!cancelled) onUpdate(users);
        })
        .catch(() => {});
    }
  }, 15000);

  return () => {
    cancelled = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (pollInterval) clearInterval(pollInterval);
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
      ? { ...ZERO_PERMISSIONS, ...permissions }
      : getDefaultPermissionsForRole(effectiveRole);

    const nowMs = Date.now();
    const newAccount: PlantUserAccount = {
      uid: createdUid,
      email: normalizedEmail,
      displayName: resolvedDisplayName,
      role: effectiveRole,
      department: department || 'Plant Floor',
      permissions: effectivePermissions,
      createdBy: adminAuthorizerEmail.trim(),
      createdAt: new Date(nowMs).toISOString(),
      status: 'active',
      upd: nowMs,
      sy: 0,
      revoked: false,
    };

    // Update local cache and queue immediately so cross-device flush recovers even if offline
    const stored = getLocalPlantUsers();
    const updatedLocal = [newAccount, ...stored.filter((u) => u.uid !== newAccount.uid)];
    saveLocalPlantUsers(updatedLocal);
    addPendingPlantUser(newAccount.uid);

    try {
      await ensureFirebaseAuth();
      const syncTs = Math.max(Date.now(), nowMs);
      const userDocRef = doc(db, 'plant_users', createdUid);
      await setDoc(userDocRef, deepSanitizeForFirestore({ ...newAccount, sy: syncTs }), {
        merge: true,
      });
      removePendingPlantUser(createdUid);
      saveLocalPlantUsers(
        getLocalPlantUsers().map((u) => (u.uid === createdUid ? { ...u, sy: syncTs } : u))
      );
    } catch (dbErr) {
      console.warn('Could not write to plant_users Firestore collection; queued in outbox:', dbErr);
    }

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
    throw new Error(
      'Unauthorized: Only Plant Administrators or Production HOD can edit confidentiality permissions.'
    );
  }

  const nextDisplayName = updates.displayName?.trim() || targetUser.displayName;
  const isRestrictedSIC = isRestrictedShiftInChargeAccount(targetUser.email, nextDisplayName);
  const nextStatus = updates.status || targetUser.status || 'active';
  const nowMs = Date.now();

  const updatedAccount: PlantUserAccount = {
    ...targetUser,
    displayName: nextDisplayName,
    role: isRestrictedSIC ? 'Shift In Charge' : updates.role,
    department: updates.department,
    permissions:
      nextStatus === 'suspended'
        ? { ...ZERO_PERMISSIONS }
        : isRestrictedSIC
        ? getDefaultPermissionsForRole('Shift In Charge')
        : { ...ZERO_PERMISSIONS, ...updates.permissions },
    status: nextStatus,
    revoked: nextStatus === 'suspended',
    revokedAt: nextStatus === 'suspended' ? new Date(nowMs).toISOString() : undefined,
    upd: nowMs,
    sy: 0,
  };

  // Persist locally & queue first so outbox guarantees delivery across devices
  const stored = getLocalPlantUsers();
  const idx = stored.findIndex(
    (u) => u.uid === updatedAccount.uid || u.email.toLowerCase() === updatedAccount.email.toLowerCase()
  );
  if (idx >= 0) {
    stored[idx] = updatedAccount;
  } else {
    stored.push(updatedAccount);
  }
  saveLocalPlantUsers(stored);
  addPendingPlantUser(updatedAccount.uid);

  try {
    await ensureFirebaseAuth();
    const syncTs = Math.max(Date.now(), nowMs);
    const userDocRef = doc(db, 'plant_users', updatedAccount.uid);
    await setDoc(userDocRef, deepSanitizeForFirestore({ ...updatedAccount, sy: syncTs }), {
      merge: true,
    });
    removePendingPlantUser(updatedAccount.uid);
    saveLocalPlantUsers(
      getLocalPlantUsers().map((u) => (u.uid === updatedAccount.uid ? { ...u, sy: syncTs } : u))
    );
  } catch (dbErr) {
    console.warn('Failed updating plant_users access in Firestore; queued in outbox:', dbErr);
  }

  return updatedAccount;
}

/**
 * Soft-Revoke / Suspend Plant User (compatible with firestore.rules `allow delete: if false;`)
 * Syncs immediately across all devices so the revoked user is locked out everywhere.
 */
export async function deletePlantUserAccount(uid: string) {
  if (!uid || uid === 'admin-master') return;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const stored = getLocalPlantUsers();
  const existing = stored.find((u) => u.uid === uid);

  const revokedRecord: PlantUserAccount = existing
    ? {
        ...existing,
        status: 'suspended',
        revoked: true,
        revokedAt: nowIso,
        permissions: { ...ZERO_PERMISSIONS },
        upd: nowMs,
        sy: 0,
      }
    : {
        uid,
        email: `${uid}@plant.co.zw`,
        displayName: 'Revoked Account',
        role: 'Machine Operator',
        department: 'Suspended',
        permissions: { ...ZERO_PERMISSIONS },
        createdBy: 'Admin Revoke',
        createdAt: nowIso,
        status: 'suspended',
        revoked: true,
        revokedAt: nowIso,
        upd: nowMs,
        sy: 0,
      };

  const nextLocal = stored.some((u) => u.uid === uid)
    ? stored.map((u) => (u.uid === uid ? revokedRecord : u))
    : [...stored, revokedRecord];
  saveLocalPlantUsers(nextLocal);
  addPendingPlantUser(uid);

  try {
    await ensureFirebaseAuth();
    const syncTs = Math.max(Date.now(), nowMs);
    const docRef = doc(db, 'plant_users', uid);
    await setDoc(docRef, deepSanitizeForFirestore({ ...revokedRecord, sy: syncTs }), {
      merge: true,
    });
    removePendingPlantUser(uid);
    saveLocalPlantUsers(
      getLocalPlantUsers().map((u) => (u.uid === uid ? { ...u, sy: syncTs } : u))
    );
  } catch (e) {
    console.warn('Deferred plant_users revoke sync in outbox:', e);
  }
}

