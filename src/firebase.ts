import { deleteApp, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
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
  query,
  Query,
  QuerySnapshot,
  setDoc,
  where,
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

let pendingAuthPromise: Promise<boolean> | null = null;

/**
 * Ensures Firebase Auth has finished hydrating its persisted IndexedDB session
 * and verifies an active authenticated Firebase user before issuing Firestore requests.
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
      return Boolean(auth.currentUser);
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

export function clearFirestorePathBlockedByRules(firestorePath: string) {
  const collectionRoot = firestorePath.replace(/^\/+/, '').split('/')[0];
  if (!collectionRoot) return;
  pathBlockedUntil.delete(collectionRoot);
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

export type CloudSyncTopic =
  | 'downtime'
  | 'dispatch'
  | 'sop'
  | 'special_orders'
  | 'quality_trials'
  | 'scrap_sales'
  | 'tqm_capas'
  | 'power_gen'
  | 'diesel'
  | 'production_plans'
  | 'attendance'
  | 'plant_users'
  | 'all';

const realtimeBusListeners = new Set<(topic: CloudSyncTopic) => void>();
let realtimeBusChannel: BroadcastChannel | null = null;

function getRealtimeBusChannel(): BroadcastChannel | null {
  if (realtimeBusChannel) return realtimeBusChannel;
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    realtimeBusChannel = new BroadcastChannel('lgplast_realtime_bus_v1');
    realtimeBusChannel.onmessage = (event) => {
      const topic = (event?.data?.topic || 'all') as CloudSyncTopic;
      realtimeBusListeners.forEach((cb) => {
        try {
          cb(topic);
        } catch {}
      });
    };
  } catch {
    realtimeBusChannel = null;
  }
  return realtimeBusChannel;
}

/**
 * Notifies in-app listeners and other open tabs/windows on the same device immediately (0ms delay)
 * whenever any store records/updates data or clears pending items.
 */
export function notifyCloudSyncBus(topic: CloudSyncTopic = 'all') {
  realtimeBusListeners.forEach((cb) => {
    try {
      cb(topic);
    } catch {}
  });
  try {
    getRealtimeBusChannel()?.postMessage({ topic, ts: Date.now() });
  } catch {}
}

export function subscribeCloudSyncBus(cb: (topic: CloudSyncTopic) => void): () => void {
  getRealtimeBusChannel();
  realtimeBusListeners.add(cb);
  return () => {
    realtimeBusListeners.delete(cb);
  };
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string = 'Request timed out'
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function setDocWithTimeout(
  docRef: DocumentReference<DocumentData>,
  data: Record<string, any>,
  options: { merge?: boolean } = { merge: true },
  timeoutMs: number = 12000
): Promise<void> {
  await withTimeout(
    setDoc(docRef, data, options),
    timeoutMs,
    'Saved locally — queued for cloud sync'
  );
}

/**
 * Server-first collection read so manual sync & polling always pull
 * updates created by other phones/devices when online (bounded by timeout).
 */
export async function getCollectionDocsServerFirst<T = DocumentData>(
  colOrQuery: CollectionReference<T> | Query<T>
): Promise<QuerySnapshot<T>> {
  const isBrowserOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (isBrowserOnline) {
    await ensureFirebaseAuth().catch(() => false);
    const refPath = (colOrQuery as any)?.path;
    try {
      return await withTimeout(
        getDocsFromServer(colOrQuery),
        10000,
        'Firestore server collection query timed out'
      );
    } catch (err: any) {
      if (isPermissionDeniedError(err)) {
        if (typeof refPath === 'string') {
          markFirestorePathBlockedByRules(refPath);
        }
        throw err;
      }
    }
  }
  return await withTimeout(getDocs(colOrQuery), 5000, 'Firestore local cache query timed out');
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
      return await withTimeout(
        getDocFromServer(docRef),
        8000,
        'Firestore server document read timed out'
      );
    } catch (err: any) {
      if (isPermissionDeniedError(err)) {
        if (typeof refPath === 'string') {
          markFirestorePathBlockedByRules(refPath);
        }
        throw err;
      }
    }
  }
  return await withTimeout(getDoc(docRef), 4000, 'Firestore local cache document read timed out');
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
    await withTimeout(
      getDocFromServer(doc(db, 'app_config', 'machinery')),
      4500,
      'Cloud health probe timed out'
    );
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
  const authed = await ensureFirebaseAuth().catch(() => false);
  if (!authed || !auth.currentUser) {
    return;
  }
  try {
    await withTimeout(
      getDocFromServer(doc(db, 'test', 'connection')),
      3500,
      'Initial connection check timed out'
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
      try {
        await reconnectFirestoreNetwork(true);
        if (!auth.currentUser) return;
        await withTimeout(
          getDocFromServer(doc(db, 'test', 'connection')),
          3500,
          'Retry connection check timed out'
        );
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

let plantUsersServerLoaded = false;
const plantUsersLoadListeners = new Set<() => void>();

function markPlantUsersServerLoaded() {
  if (!plantUsersServerLoaded) {
    plantUsersServerLoaded = true;
    plantUsersLoadListeners.forEach((cb) => cb());
  }
}

export function hasPlantUsersServerLoaded(): boolean {
  return plantUsersServerLoaded;
}

export function subscribePlantUsersServerLoaded(cb: () => void): () => void {
  plantUsersLoadListeners.add(cb);
  if (plantUsersServerLoaded) cb();
  return () => {
    plantUsersLoadListeners.delete(cb);
  };
}

export function isCreatedPlantAccountEmail(
  email?: string | null,
  plantUsersList?: PlantUserAccount[]
): boolean {
  const normEmail = (email || '').trim().toLowerCase();
  if (!normEmail) return false;
  if (normEmail === PRIMARY_ADMIN_EMAIL.toLowerCase()) return true;

  const users = plantUsersList || getLocalPlantUsers();
  const matched = users.find((u) => u.email.trim().toLowerCase() === normEmail);
  return Boolean(matched && matched.status !== 'suspended' && !matched.revoked);
}

export function normalizePlantLoginIdentifier(identifier: string): string {
  const norm = identifier.trim().toLowerCase();
  if (!norm) return '';
  return norm.includes('@') ? norm : `${norm}@plant.co.zw`;
}

function cacheVerifiedUserLocally(account: PlantUserAccount) {
  const existing = getLocalPlantUsers();
  const next = [
    account,
    ...existing.filter(
      (u) =>
        u.uid !== account.uid &&
        u.email.trim().toLowerCase() !== account.email.trim().toLowerCase()
    ),
  ];
  saveLocalPlantUsers(ensureSystemMasterAdminInList(next));
}

async function ensurePrimaryAdminPlantUserDoc(
  uid: string,
  email: string,
  emailVerified: boolean,
  displayName?: string | null
) {
  const normEmail = email.trim().toLowerCase();
  if (normEmail !== PRIMARY_ADMIN_EMAIL.toLowerCase() || !emailVerified || !uid) return;
  try {
    const ref = doc(db, 'plant_users', uid);
    const snap = await getDocFromServer(ref).catch(() => null);
    if (!snap || !snap.exists()) {
      const nowMs = Date.now();
      const masterRecord: PlantUserAccount = {
        uid,
        email: PRIMARY_ADMIN_EMAIL,
        displayName: (displayName || '').trim() || 'Plant Administrator',
        role: 'Plant Administrator',
        department: 'Management',
        permissions: { ...FULL_ADMIN_PERMISSIONS },
        createdBy: 'System Root',
        createdAt: '2026-01-01T00:00:00.000Z',
        status: 'active',
        revoked: false,
        upd: nowMs,
        sy: nowMs,
      };
      await setDocWithTimeout(ref, deepSanitizeForFirestore(masterRecord), { merge: true });
    }
  } catch {}
}

async function finalizeAuthenticatedPlantSession(
  firebaseUser: import('firebase/auth').User,
  normalizedHintEmail?: string
) {
  const email = (firebaseUser.email || normalizedHintEmail || '').trim().toLowerCase();
  const isMaster = email === PRIMARY_ADMIN_EMAIL.toLowerCase();

  if (isMaster && firebaseUser.emailVerified) {
    await ensurePrimaryAdminPlantUserDoc(
      firebaseUser.uid,
      email,
      true,
      firebaseUser.displayName
    );
  } else if (isMaster && !firebaseUser.emailVerified) {
    // Remind/send verification link once if Primary Admin signed in via Email/Password without verification
    const ownSnap = await getDocFromServer(doc(db, 'plant_users', firebaseUser.uid)).catch(() => null);
    if (!ownSnap || !ownSnap.exists()) {
      try {
        const sentKey = `dt_admin_verify_sent_${firebaseUser.uid}`;
        if (!sessionStorage.getItem(sentKey)) {
          sessionStorage.setItem(sentKey, '1');
          await sendEmailVerification(firebaseUser).catch(() => {});
        }
      } catch {}
    }
  }

  const latestUsers = await fetchPlantUsersDirectory();
  const matched = latestUsers.find((u) => u.email.trim().toLowerCase() === email);

  if (!isMaster && !matched) {
    setActiveSessionUser(null);
    await signOut(auth).catch(() => {});
    throw new Error(
      'Access Denied: Only accounts created by the Plant Administrator can sign in to this system.'
    );
  }

  if (!isMaster && (matched?.status === 'suspended' || matched?.revoked)) {
    setActiveSessionUser(null);
    await signOut(auth).catch(() => {});
    throw new Error('This account has been suspended or revoked by the Plant Administrator.');
  }

  const resolvedDisplayName =
    matched?.displayName ||
    firebaseUser.displayName ||
    (isMaster ? 'PLANT ADMINISTRATOR' : email.split('@')[0].toUpperCase());
  const resolvedRole: PlantRole = isMaster ? 'Plant Administrator' : matched!.role;
  resetFirestorePathAccessCache();
  const session: PlantSessionUser = {
    uid: firebaseUser.uid,
    email,
    displayName: resolvedDisplayName,
    role: resolvedRole,
    isAdmin:
      isMaster ||
      resolvedRole === 'Plant Administrator' ||
      resolvedRole === 'Production HOD',
    permissions: resolveUserPermissions(email, resolvedRole, latestUsers, resolvedDisplayName),
  };
  setActiveSessionUser(session);
  return session;
}

/**
 * Completes any pending Google redirect login (used on Android/iOS standalone PWA / APK).
 */
export async function completeGoogleRedirectSignIn(): Promise<PlantSessionUser | null> {
  try {
    const result = await getRedirectResult(auth);
    if (result?.user) {
      return await finalizeAuthenticatedPlantSession(result.user);
    }
  } catch (err) {
    console.warn('Google redirect completion notice:', err);
  }
  return null;
}

export async function loginWithGoogle() {
  const isStandaloneApk =
    typeof window !== 'undefined' &&
    window.self === window.top &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true);

  try {
    if (isStandaloneApk) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }

    const cred = await signInWithPopup(auth, googleProvider);
    if (cred.user) {
      await finalizeAuthenticatedPlantSession(cred.user);
    }
    return cred;
  } catch (err: any) {
    const code = err?.code || '';
    const msg = err instanceof Error ? err.message : String(err);

    if (
      typeof window !== 'undefined' &&
      window.self === window.top &&
      (code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment' ||
        msg.includes('popup-blocked'))
    ) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }

    console.warn('Google Sign-In notice:', code || msg);
    if (code === 'auth/unauthorized-domain' || msg.includes('auth/unauthorized-domain')) {
      const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
      throw new Error(`AUTH_UNAUTHORIZED_DOMAIN:${host}`);
    }
    if (code === 'auth/popup-closed-by-user' || msg.includes('popup-closed-by-user')) {
      throw new Error('Google Sign-In popup was closed before completing.');
    }
    if (code === 'auth/popup-blocked' || msg.includes('popup-blocked')) {
      throw new Error(
        'Google Sign-In popup was blocked by browser. Allow popups or sign in with your Email/Password below.'
      );
    }
    throw err;
  }
}

export async function sendUserPasswordReset(identifier: string): Promise<string> {
  const normEmail = normalizePlantLoginIdentifier(identifier);
  if (!normEmail || !normEmail.includes('@')) {
    throw new Error('Enter a valid work email or login ID first to reset your password.');
  }
  await sendPasswordResetEmail(auth, normEmail);
  return normEmail;
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
  _fallbackRole?: PlantRole | string,
  plantUsersList?: PlantUserAccount[],
  _displayName?: string | null
): UserPermissions {
  const normEmail = (email || '').trim().toLowerCase();
  if (normEmail === PRIMARY_ADMIN_EMAIL.toLowerCase()) {
    return { ...FULL_ADMIN_PERMISSIONS };
  }

  const users = plantUsersList || getLocalPlantUsers();
  const matched = users.find((u) => u.email.trim().toLowerCase() === normEmail);
  if (matched?.status === 'suspended' || matched?.revoked) {
    return { ...ZERO_PERMISSIONS };
  }

  if (matched) {
    if (matched.permissions) {
      return { ...ZERO_PERMISSIONS, ...matched.permissions };
    }
    return getDefaultPermissionsForRole(matched.role);
  }

  return { ...ZERO_PERMISSIONS };
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
  const normEmail = normalizePlantLoginIdentifier(identifier);
  const trimmedPass = pass.trim();

  if (!normEmail || !trimmedPass) {
    throw new Error('Email / Login ID and password are required.');
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, normEmail, trimmedPass);
    await finalizeAuthenticatedPlantSession(cred.user, normEmail);
    return cred;
  } catch (err: any) {
    console.warn('Email Sign-In notice:', err?.code || err?.message || err);
    throw err;
  }
}

export async function verifyAdminCredentialsOnly(
  identifier: string,
  pass: string
): Promise<{ email: string; displayName: string; role: PlantRole }> {
  const normEmail = normalizePlantLoginIdentifier(identifier);
  const trimmedPass = pass.trim();
  if (!normEmail || !trimmedPass) {
    throw new Error('Administrator email / ID and password are required.');
  }

  const verifyAppName = `AdminVerify_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const verifyApp = initializeApp(firebaseConfig, verifyAppName);
  const verifyAuth = getAuth(verifyApp);

  try {
    const cred = await signInWithEmailAndPassword(verifyAuth, normEmail, trimmedPass);
    const verifyDb = getFirestore(verifyApp, dbId);
    let matched: PlantUserAccount | undefined;

    try {
      const ownDoc = await getDocFromServer(doc(verifyDb, 'plant_users', cred.user.uid));
      if (ownDoc.exists()) {
        matched = { ...(ownDoc.data() as PlantUserAccount), uid: ownDoc.id };
      }
    } catch {}

    if (!matched) {
      try {
        const q = query(collection(verifyDb, 'plant_users'), where('email', '==', normEmail));
        const qSnap = await getDocsFromServer(q);
        qSnap.forEach((d) => {
          const u = d.data() as PlantUserAccount;
          matched = { ...u, uid: u.uid || d.id };
        });
      } catch {}
    }

    const isPrimary = normEmail === PRIMARY_ADMIN_EMAIL.toLowerCase();
    const isAdminOrHod =
      isPrimary ||
      Boolean(
        matched &&
          matched.status !== 'suspended' &&
          !matched.revoked &&
          (matched.role === 'Plant Administrator' || matched.role === 'Production HOD')
      );

    if (!isAdminOrHod) {
      throw new Error(
        `Access Denied: ${normEmail} is not an active Plant Administrator or Production HOD.`
      );
    }

    const resolvedRole: PlantRole = isPrimary
      ? 'Plant Administrator'
      : matched!.role;
    const resolvedDisplayName =
      matched?.displayName || cred.user.displayName || 'Plant Administrator';

    if (matched) {
      cacheVerifiedUserLocally({
        ...matched,
        uid: matched.uid || cred.user.uid,
        email: normEmail,
        displayName: resolvedDisplayName,
        role: resolvedRole,
        status: 'active',
        revoked: false,
      });
    }

    return { email: normEmail, displayName: resolvedDisplayName, role: resolvedRole };
  } finally {
    await signOut(verifyAuth).catch(() => {});
    await deleteApp(verifyApp).catch(() => {});
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
    if (!u?.uid || u.uid === 'admin-master') return u;
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
    if (u?.uid) map.set(u.uid, u);
  });
  remote.forEach((r) => {
    if (!r?.uid) return;
    const existing = map.get(r.uid);
    if (!existing) {
      map.set(r.uid, r);
    } else if (existing.status === 'suspended' && r.status !== 'suspended') {
      if ((r.upd || 0) > (existing.upd || 0)) {
        map.set(r.uid, r);
      }
    } else if ((r.upd || 0) >= (existing.upd || 0)) {
      map.set(r.uid, r);
    }
  });
  return ensureSystemMasterAdminInList(Array.from(map.values()));
}

export async function flushPendingPlantUsers(): Promise<number> {
  repairPendingPlantUsersQueue();
  const authed = await ensureFirebaseAuth().catch(() => false);
  if (!authed || !auth.currentUser) return 0;
  if (isFirestorePathBlockedByRules('plant_users')) return 0;
  const currentEmail = (auth.currentUser.email || '').trim().toLowerCase();
  if (!isAuthorizedAdminEmail(currentEmail)) return 0;

  const local = getLocalPlantUsers();
  const pendingSet = new Set<string>(getPendingPlantUsersQueue());
  local.forEach((u) => {
    if (
      u?.uid &&
      u.uid !== 'admin-master' &&
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
      await setDocWithTimeout(doc(db, 'plant_users', uid), payload, { merge: true });
      removePendingPlantUser(uid);
      const latest = getLocalPlantUsers().map((u) =>
        u.uid === uid ? { ...found, sy: syncTs } : u
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

function isCurrentSignedInUserAdminHint(): boolean {
  const email = (auth.currentUser?.email || getActiveSessionUser()?.email || '').trim().toLowerCase();
  if (!email) return false;
  if (email === PRIMARY_ADMIN_EMAIL.toLowerCase()) return true;
  const cached = getLocalPlantUsers().find((u) => u.email.trim().toLowerCase() === email);
  return Boolean(
    cached &&
      cached.status !== 'suspended' &&
      !cached.revoked &&
      (cached.role === 'Plant Administrator' || cached.role === 'Production HOD')
  );
}

/**
 * Fetch plant_users directory directly from Firestore (Admins get full roster; non-admins read only their own clearance doc to isolate PII).
 */
export async function fetchPlantUsersDirectory(): Promise<PlantUserAccount[]> {
  try {
    const authed = await ensureFirebaseAuth().catch(() => false);
    if (!authed || !auth.currentUser) return getLocalPlantUsers();

    const currentUid = auth.currentUser.uid;
    const currentEmail = (auth.currentUser.email || '').trim().toLowerCase();

    // First verify own clearance document so we know whether this user is Admin/HOD
    let ownAccount: PlantUserAccount | null = null;
    try {
      const ownSnap = await getDocServerFirst(doc(db, 'plant_users', currentUid));
      if (ownSnap.exists()) {
        const raw = ownSnap.data() as PlantUserAccount;
        ownAccount = { ...raw, uid: raw.uid || ownSnap.id, sy: raw.sy || raw.upd || 1 };
      } else if (currentEmail) {
        const q = query(collection(db, 'plant_users'), where('email', '==', currentEmail));
        const qSnap = await getCollectionDocsServerFirst(q);
        qSnap.forEach((d) => {
          const raw = d.data() as PlantUserAccount;
          ownAccount = { ...raw, uid: raw.uid || d.id, sy: raw.sy || raw.upd || 1 };
        });
      }
    } catch {}

    const isAdminUser =
      currentEmail === PRIMARY_ADMIN_EMAIL.toLowerCase() ||
      Boolean(
        ownAccount &&
          ownAccount.status !== 'suspended' &&
          !ownAccount.revoked &&
          (ownAccount.role === 'Plant Administrator' || ownAccount.role === 'Production HOD')
      );

    if (currentEmail === PRIMARY_ADMIN_EMAIL.toLowerCase() && auth.currentUser.emailVerified && !ownAccount) {
      await ensurePrimaryAdminPlantUserDoc(
        currentUid,
        currentEmail,
        true,
        auth.currentUser.displayName
      );
    }

    if (isAdminUser) {
      const snap = await getCollectionDocsServerFirst(collection(db, 'plant_users'));
      const remote: PlantUserAccount[] = [];
      snap.forEach((d) => {
        const rawUser = d.data() as PlantUserAccount;
        remote.push({
          ...rawUser,
          uid: rawUser.uid || d.id,
          sy: rawUser.sy || rawUser.upd || 1,
        });
      });
      const local = getLocalPlantUsers();
      const mergedRaw = mergePlantUsers(local, remote);
      clearSyncedPlantUsersFromQueue(local, remote);
      const merged = queueLocalPlantUsersMissingFromRemote(mergedRaw, remote);
      saveLocalPlantUsers(merged);
      markPlantUsersServerLoaded();
      return merged;
    }

    // Non-admins only retain their own verified record (prevents cross-user PII caching)
    const scopedList = ensureSystemMasterAdminInList(ownAccount ? [ownAccount] : []);
    saveLocalPlantUsers(scopedList);
    markPlantUsersServerLoaded();
    return scopedList;
  } catch (e) {
    console.warn('fetchPlantUsersDirectory note:', e);
  }
  return getLocalPlantUsers();
}

function isAuthorizedAdminEmail(email: string): boolean {
  const norm = normalizePlantLoginIdentifier(email);
  if (!norm) return false;
  if (norm === PRIMARY_ADMIN_EMAIL.toLowerCase()) return true;
  const staff = getLocalPlantUsers().find((u) => u.email.trim().toLowerCase() === norm);
  if (
    staff &&
    staff.status !== 'suspended' &&
    !staff.revoked &&
    (staff.role === 'Plant Administrator' || staff.role === 'Production HOD')
  ) {
    return true;
  }
  return false;
}

/**
 * Real-time subscription to plant_users clearance (Admins listen to roster; non-admins listen strictly to their own doc)
 */
export function subscribePlantUsers(
  onUpdate: (users: PlantUserAccount[]) => void
) {
  const initial = getLocalPlantUsers();
  onUpdate(initial);

  let unsub: (() => void) | null = null;
  let cancelled = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let activeMode: 'all' | 'self' | null = null;

  const scheduleRetry = () => {
    if (cancelled || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!cancelled) start();
    }, 3000);
  };

  const unsubBus = subscribeCloudSyncBus((topic) => {
    if (!cancelled && (topic === 'plant_users' || topic === 'all')) {
      onUpdate(getLocalPlantUsers());
    }
  });

  const start = async () => {
    const authed = await ensureFirebaseAuth().catch(() => false);
    if (cancelled || !authed || !auth.currentUser) return;
    try {
      let useAdminRoster = isCurrentSignedInUserAdminHint();
      if (!useAdminRoster) {
        const ownUid = auth.currentUser.uid;
        try {
          const ownCheck = await getDocServerFirst(doc(db, 'plant_users', ownUid));
          if (ownCheck.exists()) {
            const rawOwn = ownCheck.data() as PlantUserAccount;
            const ownUser: PlantUserAccount = {
              ...rawOwn,
              uid: rawOwn.uid || ownCheck.id,
              sy: rawOwn.sy || rawOwn.upd || 1,
            };
            cacheVerifiedUserLocally(ownUser);
            if (
              ownUser.status !== 'suspended' &&
              !ownUser.revoked &&
              (ownUser.role === 'Plant Administrator' || ownUser.role === 'Production HOD')
            ) {
              useAdminRoster = true;
            }
          }
        } catch {}
      }
      if (cancelled || !auth.currentUser) return;

      const targetMode: 'all' | 'self' = useAdminRoster ? 'all' : 'self';
      if (unsub && activeMode === targetMode) return;
      if (unsub) {
        unsub();
        unsub = null;
        activeMode = null;
      }

      if (targetMode === 'all') {
        activeMode = 'all';
        const colRef = collection(db, 'plant_users');
        unsub = onSnapshot(
          colRef,
          { includeMetadataChanges: true },
          (snapshot) => {
            clearFirestorePathBlockedByRules('plant_users');
            const remote: PlantUserAccount[] = [];
            snapshot.forEach((d) => {
              const rawUser = d.data() as PlantUserAccount;
              remote.push({
                ...rawUser,
                uid: rawUser.uid || d.id,
                sy: rawUser.sy || rawUser.upd || 1,
              });
            });
            const local = getLocalPlantUsers();
            const mergedRaw = mergePlantUsers(local, remote);
            const merged = !snapshot.metadata.fromCache
              ? queueLocalPlantUsersMissingFromRemote(mergedRaw, remote)
              : mergedRaw;
            clearSyncedPlantUsersFromQueue(local, remote);
            saveLocalPlantUsers(merged);
            onUpdate(merged);

            if (!snapshot.metadata.fromCache) {
              markPlantUsersServerLoaded();
              flushPendingPlantUsers().catch(() => {});
            }
          },
          (err) => {
            activeMode = null;
            if (isPermissionDeniedError(err)) {
              markFirestorePathBlockedByRules('plant_users');
            }
            console.warn('plant_users Firestore subscription fallback:', err.message);
            scheduleRetry();
          }
        );
      } else {
        activeMode = 'self';
        const currentUid = auth.currentUser.uid;
        unsub = onSnapshot(
          doc(db, 'plant_users', currentUid),
          { includeMetadataChanges: true },
          (docSnap) => {
            clearFirestorePathBlockedByRules('plant_users');
            const remote: PlantUserAccount[] = [];
            let promotedToAdmin = false;
            if (docSnap.exists()) {
              const rawUser = docSnap.data() as PlantUserAccount;
              const ownAccount: PlantUserAccount = {
                ...rawUser,
                uid: rawUser.uid || docSnap.id,
                sy: rawUser.sy || rawUser.upd || 1,
              };
              remote.push(ownAccount);
              if (
                ownAccount.status !== 'suspended' &&
                !ownAccount.revoked &&
                (ownAccount.role === 'Plant Administrator' || ownAccount.role === 'Production HOD')
              ) {
                promotedToAdmin = true;
                cacheVerifiedUserLocally(ownAccount);
              }
            }
            if (promotedToAdmin) {
              if (!docSnap.metadata.fromCache) {
                markPlantUsersServerLoaded();
              }
              start();
              return;
            }
            const scoped = ensureSystemMasterAdminInList(remote);
            saveLocalPlantUsers(scoped);
            onUpdate(scoped);
            if (!docSnap.metadata.fromCache) {
              markPlantUsersServerLoaded();
            }
          },
          (err) => {
            activeMode = null;
            if (isPermissionDeniedError(err)) {
              markFirestorePathBlockedByRules('plant_users');
            }
            scheduleRetry();
          }
        );
      }
    } catch {
      activeMode = null;
      scheduleRetry();
    }
  };

  start();

  const handleOnline = () => {
    if (cancelled) return;
    flushPendingPlantUsers().catch(() => {});
    fetchPlantUsersDirectory()
      .then((users) => {
        if (!cancelled) onUpdate(users);
      })
      .catch(() => {});
    start();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
  }

  pollInterval = setInterval(() => {
    if (!cancelled && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      flushPendingPlantUsers().catch(() => {});
      fetchPlantUsersDirectory()
        .then((users) => {
          if (!cancelled) onUpdate(users);
        })
        .catch(() => {});
    }
  }, 20000);

  return () => {
    cancelled = true;
    unsubBus();
    if (retryTimer) clearTimeout(retryTimer);
    if (pollInterval) clearInterval(pollInterval);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
    }
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
  permissions?: UserPermissions,
  adminPassword?: string
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
    const effectiveRole: PlantRole = role;
    const effectivePermissions: UserPermissions = permissions
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
    notifyCloudSyncBus('plant_users');

    try {
      const syncTs = Math.max(Date.now(), nowMs);
      const syncedPayload = deepSanitizeForFirestore({ ...newAccount, sy: syncTs });

      if (auth.currentUser) {
        const userDocRef = doc(db, 'plant_users', createdUid);
        await setDocWithTimeout(userDocRef, syncedPayload, { merge: true });
      } else if (adminPassword) {
        await signOut(secondaryAuth).catch(() => {});
        await signInWithEmailAndPassword(
          secondaryAuth,
          adminAuthorizerEmail.trim().toLowerCase(),
          adminPassword.trim()
        );
        const adminSecondaryDb = getFirestore(secondaryApp, dbId);
        await setDocWithTimeout(doc(adminSecondaryDb, 'plant_users', createdUid), syncedPayload, {
          merge: true,
        });
      }

      if (auth.currentUser || adminPassword) {
        removePendingPlantUser(createdUid);
        saveLocalPlantUsers(
          getLocalPlantUsers().map((u) => (u.uid === createdUid ? { ...u, sy: syncTs } : u))
        );
        notifyCloudSyncBus('plant_users');
      }
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
  const nextStatus = updates.status || targetUser.status || 'active';
  const nowMs = Date.now();

  const updatedAccount: PlantUserAccount = {
    ...targetUser,
    displayName: nextDisplayName,
    role: updates.role,
    department: updates.department,
    permissions:
      nextStatus === 'suspended'
        ? { ...ZERO_PERMISSIONS }
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
  notifyCloudSyncBus('plant_users');

  try {
    await ensureFirebaseAuth();
    const syncTs = Math.max(Date.now(), nowMs);
    const userDocRef = doc(db, 'plant_users', updatedAccount.uid);
    await setDocWithTimeout(
      userDocRef,
      deepSanitizeForFirestore({ ...updatedAccount, sy: syncTs }),
      { merge: true }
    );
    removePendingPlantUser(updatedAccount.uid);
    saveLocalPlantUsers(
      getLocalPlantUsers().map((u) => (u.uid === updatedAccount.uid ? { ...u, sy: syncTs } : u))
    );
    notifyCloudSyncBus('plant_users');
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
  notifyCloudSyncBus('plant_users');

  try {
    await ensureFirebaseAuth();
    const syncTs = Math.max(Date.now(), nowMs);
    const docRef = doc(db, 'plant_users', uid);
    await setDocWithTimeout(docRef, deepSanitizeForFirestore({ ...revokedRecord, sy: syncTs }), {
      merge: true,
    });
    removePendingPlantUser(uid);
    saveLocalPlantUsers(
      getLocalPlantUsers().map((u) => (u.uid === uid ? { ...u, sy: syncTs } : u))
    );
    notifyCloudSyncBus('plant_users');
  } catch (e) {
    console.warn('Deferred plant_users revoke sync in outbox:', e);
  }
}

