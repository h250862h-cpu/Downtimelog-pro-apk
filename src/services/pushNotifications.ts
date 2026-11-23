import { DISPATCH_SCHEDULE_SLOTS } from '../components/DispatchPopupAlert';
import { getActiveWeightOutputSlot } from '../components/ShiftWeightOutputPopupAlert';
import { ymd } from './downtimeCalc';
import {
  DieselFuelRequest,
  DispatchEntry,
  DowntimeEntry,
  SopMixingReport,
  SopScrapRecord,
  SpecialOrderFactoryProduction,
  SpecialOrderWhDispatch,
  UserPermissions,
  normalizeMachineName,
} from '../types';

export interface OsPushNavigationPayload {
  tag: string;
  title: string;
  body: string;
  targetTab: string;
  dispatchStage?: 'shift' | 'wh' | 'hod' | 'ledger';
  dieselSubTab?: 'request' | 'hod_approve' | 'dispense' | 'grn' | 'ledger';
  specialOrderSubTab?: 'stock' | 'factory_prod' | 'wh_dispatch' | 'reports';
  openWeightCheck?: boolean;
  urgent?: boolean;
}

const NOTIFIED_KEYS_STORAGE = 'lgplast_notified_push_keys_v1';
const SOUND_ENABLED_STORAGE = 'lgplast_push_sound_v1';
const DISPATCH_SCHED_DONE_KEY = 'lgplast_dispatch_sched_done_v1';
const WEIGHT_SCHED_DONE_KEY = 'lgplast_sic_weight_output_done_v1';

// Tracks whether the current browser session has completed initial bootstrap seeding per user
const sessionBootedUsers = new Set<string>();

export function isPushNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getPushPermissionStatus(): NotificationPermission | 'unsupported' {
  if (!isPushNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

export function isPushSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_ENABLED_STORAGE) !== '0';
  } catch {
    return true;
  }
}

export function setPushSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_ENABLED_STORAGE, enabled ? '1' : '0');
  } catch {}
}

export function playAlertChime(): void {
  if (!isPushSoundEnabled() || typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const playTone = (freq: number, startOffset: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.14, now + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + dur + 0.02);
    };

    playTone(880, 0, 0.14);
    playTone(1174.66, 0.16, 0.22);
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 650);
  } catch {}
}

export async function ensurePushServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) {
      return existing;
    }
    const swUrl = import.meta.env.PROD ? '/sw.js' : '/push-sw.js';
    const registered = await navigator.serviceWorker.register(swUrl, {
      scope: '/',
      updateViaCache: 'none',
    });
    return registered;
  } catch {
    return null;
  }
}

export async function sendOsPushNotification(
  payload: OsPushNavigationPayload
): Promise<boolean> {
  if (!isPushNotificationSupported() || Notification.permission !== 'granted') {
    return false;
  }

  playAlertChime();

  try {
    const regPromise = ensurePushServiceWorkerRegistration();
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 500)
    );
    const reg = await Promise.race([regPromise, timeoutPromise]);

    if (reg && typeof reg.showNotification === 'function') {
      const notifOptions: NotificationOptions & {
        renotify?: boolean;
        vibrate?: number[];
        timestamp?: number;
      } = {
        body: payload.body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: payload.tag,
        renotify: true,
        requireInteraction: payload.urgent !== false,
        vibrate: [240, 100, 240],
        timestamp: Date.now(),
        data: {
          targetTab: payload.targetTab,
          dispatchStage: payload.dispatchStage,
          dieselSubTab: payload.dieselSubTab,
          openWeightCheck: payload.openWeightCheck,
        },
      };
      await reg.showNotification(payload.title, notifOptions);
      return true;
    }
  } catch {
    // Fall back seamlessly to direct Notification constructor below
  }

  try {
    const notif = new Notification(payload.title, {
      body: payload.body,
      icon: '/pwa-192x192.png',
      tag: payload.tag,
      requireInteraction: payload.urgent !== false,
    });
    notif.onclick = () => {
      try {
        window.focus();
      } catch {}
      window.dispatchEvent(new CustomEvent('lgplast-nav-from-push', { detail: payload }));
      notif.close();
    };
    return true;
  } catch {
    return false;
  }
}

export async function requestPhonePushPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (!isPushNotificationSupported()) return 'unsupported';
  try {
    await ensurePushServiceWorkerRegistration();
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      await sendOsPushNotification({
        tag: 'lgplast_alerts_enabled',
        title: 'LG PLAST — Phone Notifications Enabled',
        body: 'Official notifications are active. You will receive real-time alerts for Dispatch, Diesel, SOP Floor, Weight Updates, and Stoppages when connected to the network.',
        targetTab: 'status',
        urgent: false,
      });
    }
    return result;
  } catch {
    return getPushPermissionStatus();
  }
}

export async function sendTestPhonePushNotification(): Promise<boolean> {
  return sendOsPushNotification({
    tag: `lgplast_test_${Date.now()}`,
    title: 'LG PLAST — Notification Verification',
    body: 'Notifications are connected. Official plant updates will appear on your device tray while online.',
    targetTab: 'status',
    urgent: false,
  });
}

export function updateAppBadgeCount(count: number): void {
  if (typeof document !== 'undefined') {
    document.title =
      count > 0
        ? `(${count}) LG PLAST - Plant Operations System`
        : 'LG PLAST - Plant Operations System';
  }
  if (typeof navigator !== 'undefined') {
    const navAny = navigator as unknown as {
      setAppBadge?: (c: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    try {
      if (count > 0 && typeof navAny.setAppBadge === 'function') {
        navAny.setAppBadge(count).catch(() => {});
      } else if (count === 0 && typeof navAny.clearAppBadge === 'function') {
        navAny.clearAppBadge().catch(() => {});
      }
    } catch {}
  }
}

function getSeenPushKeys(userKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${NOTIFIED_KEYS_STORAGE}_${userKey}`);
    if (!raw) return new Set<string>();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set<string>(arr) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function saveSeenPushKeys(userKey: string, keys: Set<string>): void {
  try {
    const list = Array.from(keys).slice(-600);
    localStorage.setItem(`${NOTIFIED_KEYS_STORAGE}_${userKey}`, JSON.stringify(list));
  } catch {}
}

function readLocalList(storageKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getActiveDispatchSchedSlot(now: Date): {
  slot: string;
  slotKey: string;
} | null {
  const dateStr = ymd(now);
  for (const slot of DISPATCH_SCHEDULE_SLOTS) {
    const [hh, mm] = slot.split(':').map(Number);
    const target = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hh,
      mm,
      0,
      0
    );
    const elapsedMins = Math.floor((now.getTime() - target.getTime()) / 60000);
    if (elapsedMins >= 0 && elapsedMins <= 75) {
      return { slot, slotKey: `${dateStr}_DSP_${slot}` };
    }
  }
  return null;
}

export interface EvaluatePushInputs {
  userEmail: string | null | undefined;
  isAdmin: boolean;
  isOnline: boolean;
  permissions: UserPermissions;
  isShiftInChargeWeightCheckUser: boolean;
  dispatchEntries: DispatchEntry[];
  sopScrapPipeline: SopScrapRecord[];
  sopMixingReports: SopMixingReport[];
  dieselRequests: DieselFuelRequest[];
  specialOrderProductions?: SpecialOrderFactoryProduction[];
  specialOrderWhDispatches?: SpecialOrderWhDispatch[];
  entries: DowntimeEntry[];
  now?: Date;
}

/**
 * Evaluates all actionable live pop-up alerts and emits real OS push notifications
 * to the logged-in user's phone whenever they are online and have granted permission.
 * Returns total actionable pending count for app launcher badges.
 */
export async function evaluateAndDispatchPushNotifications(
  input: EvaluatePushInputs
): Promise<number> {
  const {
    userEmail,
    isAdmin,
    isOnline,
    permissions,
    isShiftInChargeWeightCheckUser,
    dispatchEntries,
    sopScrapPipeline,
    sopMixingReports,
    dieselRequests,
    specialOrderProductions = [],
    specialOrderWhDispatches = [],
    entries,
    now = new Date(),
  } = input;

  if (!userEmail) {
    updateAppBadgeCount(0);
    return 0;
  }

  const hasAnyPermission = isAdmin || Object.values(permissions).some(Boolean);
  if (!hasAnyPermission) {
    updateAppBadgeCount(0);
    return 0;
  }

  const userKey = userEmail.trim().toLowerCase();
  const candidates: OsPushNavigationPayload[] = [];
  const todayStr = ymd(now);

  // 1. Dispatch Pending WH Confirmation
  if (permissions.dispatchWHConfirm) {
    dispatchEntries
      .filter((e) => e.status === 'PENDING_WH')
      .forEach((e) => {
        candidates.push({
          tag: `PUSH_DSP_${e.id}_PENDING_WH`,
          title: `Dispatch WH Confirmation: Trolley #${e.trolleyNo}`,
          body: `${normalizeMachineName(e.machine)} / ${e.product} (${e.recordedQty}) — Submitted by ${e.shiftInChargeName}.`,
          targetTab: 'dispatch',
          dispatchStage: 'wh',
          urgent: true,
        });
      });
  }

  // 2. Dispatch Pending Production HOD Final Approval
  if (permissions.dispatchHODConfirm) {
    dispatchEntries
      .filter((e) => e.status === 'PENDING_HOD')
      .forEach((e) => {
        candidates.push({
          tag: `PUSH_DSP_${e.id}_PENDING_HOD`,
          title: `Dispatch HOD Approval: Trolley #${e.trolleyNo}`,
          body: `${normalizeMachineName(e.machine)} / ${e.product} — WH Qty: ${
            e.whReceivedQty ?? e.recordedQty
          }.`,
          targetTab: 'dispatch',
          dispatchStage: 'hod',
          urgent: true,
        });
      });
  }

  // 3. SOP Scrap Sent -> Recycling Team
  if (isAdmin || permissions.sopRecyclingConfirm) {
    sopScrapPipeline
      .filter((s) => s.status === 'SENT_TO_RECYCLING')
      .forEach((s) => {
        candidates.push({
          tag: `PUSH_SOP_REC_${s.id}_SENT_TO_RECYCLING`,
          title: `Recycling Handover: ${normalizeMachineName(s.machine)}`,
          body: `${s.scrapKg} kg (${s.product}) submitted by ${s.sentByAssistant}.`,
          targetTab: 'sop_recycling',
          urgent: true,
        });
      });
  }

  // 4. SOP Scrap Processed -> Mixer Receipt Alert
  if (permissions.sopMixingAccess) {
    sopScrapPipeline
      .filter((s) => s.status === 'PROCESSED_FOR_MIXER')
      .forEach((s) => {
        candidates.push({
          tag: `PUSH_SOP_MIX_${s.id}_PROCESSED_FOR_MIXER`,
          title: `Mixer Material Ready: ${normalizeMachineName(s.machine)}`,
          body: `${s.usableMaterialKg ?? s.receivedKg ?? s.scrapKg} kg processed by ${
            s.processedBy || s.receivedBy || 'Recycling'
          }.`,
          targetTab: 'sop_mixing',
          urgent: true,
        });
      });
  }

  // 5. SOP Mixing Report -> HOD Stock Review
  if (isAdmin || (permissions.sopMixingAccess && permissions.dispatchHODConfirm)) {
    sopMixingReports
      .filter((m) => m.status === 'PENDING_HOD')
      .forEach((m) => {
        candidates.push({
          tag: `PUSH_MIX_HOD_${m.id}_PENDING_HOD`,
          title: `Mixing Report HOD Review: ${normalizeMachineName(m.machine)}`,
          body: `Closing Stock: ${m.endOfMixingStockKg} kg · Sweeping: ${m.sweepingMaterialKg} kg (${m.batchesMixed} batches).`,
          targetTab: 'sop_mixing',
          urgent: true,
        });
      });
  }

  // 6. Diesel Fuel Request -> HOD Approval
  if (isAdmin || permissions.dieselHODApprove) {
    dieselRequests
      .filter((r) => r.status === 'PENDING_HOD')
      .forEach((r) => {
        candidates.push({
          tag: `PUSH_DSL_HOD_${r.id}_PENDING_HOD`,
          title: `Diesel Request Awaiting HOD Approval (${r.requestNo})`,
          body: `${r.requestedLitres} L requested for ${r.vehicleOrForklift} by ${r.driverName}.`,
          targetTab: 'diesel',
          dieselSubTab: 'hod_approve',
          urgent: true,
        });
      });
  }

  // 7. Diesel Approved & PDF Issued -> Forklift Driver Bowser Meter Entry
  if (isAdmin || permissions.dieselFuelRequest) {
    dieselRequests
      .filter((r) => {
        if (r.status !== 'APPROVED_FOR_DISPENSE' || !r.pdfUnlockedDispense) return false;
        if (!isAdmin && r.driverEmail && r.driverEmail.trim().toLowerCase() !== userKey) {
          return false;
        }
        return true;
      })
      .forEach((r) => {
        candidates.push({
          tag: `PUSH_DSL_DRV_${r.id}_APPROVED_FOR_DISPENSE`,
          title: `Diesel Approved — Bowser Meter Entry Open (${r.requestNo})`,
          body: `${r.hodApprovedLitres ?? r.requestedLitres} L approved by ${
            r.hodApprovedBy || 'Production HOD'
          }. Record opening and closing meter readings.`,
          targetTab: 'diesel',
          dieselSubTab: 'dispense',
          urgent: true,
        });
      });
  }

  // 8. Scheduled Dispatch Update Reminders (06:30 & 15:45)
  if (
    permissions.dispatchShiftEntry ||
    permissions.dispatchWHConfirm ||
    permissions.dispatchHODConfirm
  ) {
    const activeDspSched = getActiveDispatchSchedSlot(now);
    const doneDspSched = readLocalList(DISPATCH_SCHED_DONE_KEY);
    if (activeDspSched && !doneDspSched.includes(activeDspSched.slotKey)) {
      const stage: 'shift' | 'wh' | 'hod' = permissions.dispatchShiftEntry
        ? 'shift'
        : permissions.dispatchWHConfirm
        ? 'wh'
        : 'hod';
      candidates.push({
        tag: `PUSH_SCHED_DSP_${activeDspSched.slotKey}`,
        title: `Scheduled Dispatch Update (${activeDspSched.slot})`,
        body: 'Update ready dispatch trollies and confirm pending stock movements.',
        targetTab: 'dispatch',
        dispatchStage: stage,
        urgent: true,
      });
    }
  }

  // 9. Scheduled Shift In Charge Weight & Output Checks (09:45, 12:45, 18:00, 23:45, 03:45, 06:45)
  if (isShiftInChargeWeightCheckUser || isAdmin) {
    const activeWoSlot = getActiveWeightOutputSlot(now);
    const doneWoSched = readLocalList(WEIGHT_SCHED_DONE_KEY);
    if (activeWoSlot && !doneWoSched.includes(activeWoSlot.slotKey)) {
      candidates.push({
        tag: `PUSH_SCHED_WO_${activeWoSlot.slotKey}`,
        title: `Shift Running Weight & Output Update (${activeWoSlot.slot})`,
        body: 'Record updated running product weight and machine output rates.',
        targetTab: 'status',
        openWeightCheck: true,
        urgent: true,
      });
    }
  }

  // 10. Newly logged Critical Machine Breakdown Stoppage (today / active open)
  if (isAdmin || permissions.logDowntime || permissions.viewMachineStatus) {
    entries
      .filter(
        (e) =>
          !e.del &&
          !e.end &&
          e.cat === 'Breakdown' &&
          (!e.start || e.start.slice(0, 10) === todayStr)
      )
      .slice(0, 5)
      .forEach((e) => {
        const machineName = normalizeMachineName(e.m);
        candidates.push({
          tag: `PUSH_BD_${e.id}_${e.upd || 0}`,
          title: `Breakdown Notice: ${machineName}`,
          body: `${e.reason || 'Unplanned stoppage'} (${e.jcn || 'Production'}) — Logged by ${
            e.rep || 'Floor'
          }.`,
          targetTab: 'status',
          urgent: true,
        });
      });
  }

  // 11. Special Orders Pending HOD Factory Confirm, WH Confirm, or Final HOD Dispatch
  if (isAdmin || (permissions.specialOrdersAccess && permissions.dispatchHODConfirm)) {
    specialOrderProductions
      .filter((p) => p.status === 'PENDING_HOD_FACTORY')
      .forEach((p) => {
        candidates.push({
          tag: `PUSH_SO_FAC_${p.id}`,
          title: `Special Order Factory Stock (${p.orderNo})`,
          body: `${p.totalQty} units logged by ${p.shiftInChargeName} (${p.date} ${p.shift}) awaiting HOD confirmation.`,
          targetTab: 'special_orders',
          specialOrderSubTab: 'factory_prod',
          urgent: true,
        });
      });

    specialOrderWhDispatches
      .filter((w) => w.status === 'PENDING_HOD')
      .forEach((w) => {
        candidates.push({
          tag: `PUSH_SO_HOD_${w.id}`,
          title: `Special Order WH Dispatch HOD Approval (${w.dispatchRef})`,
          body: `${w.totalWhReceivedQty ?? w.totalRecordedQty} units verified by WH — confirm to post to Regular Dispatch.`,
          targetTab: 'special_orders',
          specialOrderSubTab: 'wh_dispatch',
          urgent: true,
        });
      });
  }

  if (isAdmin || (permissions.specialOrdersAccess && permissions.dispatchWHConfirm)) {
    specialOrderWhDispatches
      .filter((w) => w.status === 'PENDING_WH')
      .forEach((w) => {
        candidates.push({
          tag: `PUSH_SO_WH_${w.id}`,
          title: `Special Order Ready for WH (${w.orderNo})`,
          body: `${w.totalRecordedQty} units dispatched from Factory (Trolley #${w.trolleyNo}) awaiting WH verification.`,
          targetTab: 'special_orders',
          specialOrderSubTab: 'wh_dispatch',
          urgent: true,
        });
      });
  }

  // Update phone launcher badge & tab title count even before OS notifications permission
  updateAppBadgeCount(candidates.length);

  if (!isOnline || getPushPermissionStatus() !== 'granted') {
    return candidates.length;
  }

  const seenKeys = getSeenPushKeys(userKey);
  const unseen = candidates.filter((c) => !seenKeys.has(c.tag));

  if (unseen.length === 0) {
    sessionBootedUsers.add(userKey);
    return candidates.length;
  }

  const isFirstBootPass = !sessionBootedUsers.has(userKey);
  sessionBootedUsers.add(userKey);

  // Mark all unseen tags as seen immediately so parallel renders never duplicate pushes
  unseen.forEach((u) => seenKeys.add(u.tag));
  saveSeenPushKeys(userKey, seenKeys);

  // On very first boot if a backlog >= 3 alerts built up offline, deliver 1 clean email-style digest push;
  // otherwise deliver each live update individually!
  if (isFirstBootPass && unseen.length >= 3) {
    const first = unseen[0];
    await sendOsPushNotification({
      tag: `PUSH_DIGEST_${todayStr}_${unseen.length}`,
      title: `LG PLAST: ${unseen.length} Pending Action Items`,
      body: `${first.title} and ${unseen.length - 1} additional operational update(s).`,
      targetTab: first.targetTab,
      dispatchStage: first.dispatchStage,
      dieselSubTab: first.dieselSubTab,
      openWeightCheck: first.openWeightCheck,
      urgent: true,
    });
  } else {
    for (const item of unseen.slice(0, 4)) {
      await sendOsPushNotification(item);
    }
  }

  return candidates.length;
}
