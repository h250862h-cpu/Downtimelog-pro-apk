import React, { useEffect, useMemo, useState } from 'react';
import {
  AlarmClock,
  ArrowRight,
  BellRing,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  PackageCheck,
  Truck,
  X,
} from 'lucide-react';
import { ymd } from '../services/downtimeCalc';
import { DispatchEntry, UserPermissions } from '../types';

export type DispatchSubStage = 'shift' | 'wh' | 'hod' | 'ledger';

export const DISPATCH_SCHEDULE_SLOTS = ['06:30', '15:45'] as const;
export type DispatchScheduleSlot = (typeof DISPATCH_SCHEDULE_SLOTS)[number];

const DISPATCH_SCHED_DONE_KEY = 'lgplast_dispatch_sched_done_v1';

interface ActiveDispatchSchedule {
  slot: DispatchScheduleSlot;
  slotKey: string;
  shiftLabel: string;
  elapsedMins: number;
}

function getActiveDispatchScheduleSlot(now: Date = new Date()): ActiveDispatchSchedule | null {
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
    // Active for 75 minutes starting at 06:30 AM and 15:45 Day Shift
    if (elapsedMins >= 0 && elapsedMins <= 75) {
      return {
        slot,
        slotKey: `${dateStr}_DSP_${slot}`,
        shiftLabel: slot === '06:30' ? 'Night Closing (06:30 AM)' : 'Day Shift (15:45)',
        elapsedMins,
      };
    }
  }
  return null;
}

function getCompletedDispatchSchedSlots(): string[] {
  try {
    const raw = localStorage.getItem(DISPATCH_SCHED_DONE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function markDispatchSchedSlotDone(slotKey: string) {
  try {
    const cur = getCompletedDispatchSchedSlots();
    if (!cur.includes(slotKey)) {
      localStorage.setItem(
        DISPATCH_SCHED_DONE_KEY,
        JSON.stringify([...cur.slice(-30), slotKey])
      );
    }
  } catch {}
}

interface DispatchPopupAlertProps {
  entries: DispatchEntry[];
  permissions: UserPermissions;
  dismissedKeys: string[];
  onDismissKey: (key: string) => void;
  onNavigateToStage: (stage: DispatchSubStage) => void;
}

export const DispatchPopupAlert: React.FC<DispatchPopupAlertProps> = ({
  entries,
  permissions,
  dismissedKeys,
  onDismissKey,
  onNavigateToStage,
}) => {
  const [now, setNow] = useState<Date>(() => new Date());
  const [completedSched, setCompletedSched] = useState<string[]>(() =>
    getCompletedDispatchSchedSlots()
  );
  const [snoozedSched, setSnoozedSched] = useState<string[]>([]);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const t = setInterval(tick, 15000);
    const onVis = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, []);

  // Pending entries needing WH confirmation
  const pendingWH = permissions.dispatchWHConfirm
    ? entries.filter(
        (e) =>
          e.status === 'PENDING_WH' &&
          !dismissedKeys.includes(`${e.id}_PENDING_WH`)
      )
    : [];

  // Pending entries needing Production HOD / Admin confirmation
  const pendingHOD = permissions.dispatchHODConfirm
    ? entries.filter(
        (e) =>
          e.status === 'PENDING_HOD' &&
          !dismissedKeys.includes(`${e.id}_PENDING_HOD`)
      )
    : [];

  // Scheduled Dispatch Update Reminder (06:30 AM & 15:45 Day Shift)
  const canReceiveDispatchReminder =
    permissions.dispatchShiftEntry ||
    permissions.dispatchWHConfirm ||
    permissions.dispatchHODConfirm;

  const activeSchedule = useMemo(() => {
    if (!canReceiveDispatchReminder) return null;
    const slot = getActiveDispatchScheduleSlot(now);
    if (!slot) return null;
    if (completedSched.includes(slot.slotKey) || snoozedSched.includes(slot.slotKey)) {
      return null;
    }
    return slot;
  }, [canReceiveDispatchReminder, now, completedSched, snoozedSched]);

  if (pendingWH.length === 0 && pendingHOD.length === 0 && !activeSchedule) {
    return null;
  }

  // If no pending trolley alerts, show the Scheduled 06:30 AM / 15:45 Dispatch Update Pop-Up
  if (pendingWH.length === 0 && pendingHOD.length === 0 && activeSchedule) {
    const targetStage: DispatchSubStage = permissions.dispatchShiftEntry
      ? 'shift'
      : permissions.dispatchWHConfirm
      ? 'wh'
      : 'hod';

    const todayStr = ymd(now);
    const todayEntries = entries.filter((e) => e.date === todayStr);
    const pendingWhCount = entries.filter((e) => e.status === 'PENDING_WH').length;
    const pendingHodCount = entries.filter((e) => e.status === 'PENDING_HOD').length;

    const handleAckSchedule = (openDispatch: boolean) => {
      markDispatchSchedSlotDone(activeSchedule.slotKey);
      setCompletedSched((prev) =>
        prev.includes(activeSchedule.slotKey) ? prev : [...prev, activeSchedule.slotKey]
      );
      if (openDispatch) {
        onNavigateToStage(targetStage);
      }
    };

    const handleSnoozeSchedule = () => {
      setSnoozedSched((prev) =>
        prev.includes(activeSchedule.slotKey) ? prev : [...prev, activeSchedule.slotKey]
      );
    };

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm animate-in fade-in duration-150">
        <div className="w-full max-w-lg rounded-2xl border border-sky-500/60 bg-slate-900 shadow-2xl shadow-sky-950/50 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-sky-500/30 bg-gradient-to-r from-sky-500/20 via-blue-600/15 to-slate-900">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-400 text-slate-950 animate-bounce">
                <AlarmClock className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-wide text-white">
                  {activeSchedule.slot === '06:30'
                    ? '06:30 AM Dispatch Update Reminder'
                    : '15:45 Day Shift Dispatch Update Reminder'}
                </h3>
                <p className="text-[11px] text-slate-300">
                  Scheduled Dispatch Check · {activeSchedule.shiftLabel}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleSnoozeSchedule}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
              title="Dismiss pop-up for now"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-5 space-y-4 text-xs">
            <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-4 space-y-2.5">
              <p className="text-slate-200 leading-relaxed font-medium">
                It is <b className="text-sky-300">{activeSchedule.slot}</b> — please update all ready dispatch trollies, unit weights, and confirm pending movement records before shift closing.
              </p>

              <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                <div className="rounded-lg border border-slate-800 bg-slate-900 p-2">
                  <span className="text-[10px] uppercase text-slate-400 block font-bold">
                    Today Logged
                  </span>
                  <span className="text-base font-black text-white">
                    {todayEntries.length}
                  </span>
                </div>
                <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-2">
                  <span className="text-[10px] uppercase text-amber-300 block font-bold">
                    Wait WH
                  </span>
                  <span className="text-base font-black text-amber-300">
                    {pendingWhCount}
                  </span>
                </div>
                <div className="rounded-lg border border-sky-500/30 bg-sky-950/20 p-2">
                  <span className="text-[10px] uppercase text-sky-300 block font-bold">
                    Wait HOD
                  </span>
                  <span className="text-base font-black text-sky-300">
                    {pendingHodCount}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-slate-400 pt-1 border-t border-slate-800/80">
                <Clock className="h-3.5 w-3.5 text-sky-400" />
                <span>Scheduled Dispatch Reminders: 06:30 AM &amp; 15:45 Day Shift</span>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleSnoozeSchedule}
                className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-4 py-2 text-xs font-bold text-slate-300 transition"
              >
                Remind Me Later
              </button>
              <button
                type="button"
                onClick={() => handleAckSchedule(false)}
                className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-4 py-2 text-xs font-bold text-emerald-300 transition"
              >
                Mark Checked
              </button>
              <button
                type="button"
                onClick={() => handleAckSchedule(true)}
                className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-blue-500 hover:from-sky-300 hover:to-blue-400 px-5 py-2 text-xs font-black text-slate-950 shadow-lg transition"
              >
                <Truck className="h-4 w-4" />
                <span>Open Dispatch Update</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Prioritize WH pending first if user has WH role, or HOD pending if HOD
  const isWHAlert = pendingWH.length > 0;
  const activeList = isWHAlert ? pendingWH : pendingHOD;
  const latest = activeList[0];
  const stageKey = `${latest.id}_${latest.status}`;
  const targetStage: DispatchSubStage = isWHAlert ? 'wh' : 'hod';

  const handleOpenConfirm = () => {
    activeList.forEach((item) => onDismissKey(`${item.id}_${item.status}`));
    onNavigateToStage(targetStage);
  };

  const handleSnoozeAll = () => {
    activeList.forEach((item) => onDismissKey(`${item.id}_${item.status}`));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden ${
          isWHAlert
            ? 'border-amber-500/60 bg-slate-900 shadow-amber-950/50'
            : 'border-emerald-500/60 bg-slate-900 shadow-emerald-950/50'
        }`}
      >
        {/* Urgent Notification Header */}
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-b ${
            isWHAlert
              ? 'bg-gradient-to-r from-amber-500/20 via-orange-500/15 to-slate-900 border-amber-500/30'
              : 'bg-gradient-to-r from-emerald-500/20 via-teal-500/15 to-slate-900 border-emerald-500/30'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-xl animate-bounce ${
                isWHAlert
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-emerald-500 text-slate-950'
              }`}
            >
              <BellRing className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black uppercase tracking-wide text-white">
                  {isWHAlert
                    ? 'New Dispatch Message → WH Confirmation Required'
                    : 'WH Confirmed → Production HOD Final Approval Required'}
                </h3>
              </div>
              <p className="text-[11px] text-slate-300">
                {activeList.length} pending dispatch {activeList.length === 1 ? 'entry' : 'entries'} awaiting your signature
              </p>
            </div>
          </div>

          <button
            onClick={() => onDismissKey(stageKey)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
            title="Dismiss pop-up for now"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Message Body */}
        <div className="p-5 space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-black text-amber-300">
                <Truck className="h-4 w-4" />
                Trolley #{latest.trolleyNo}
              </span>
              <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-slate-300">
                {latest.date} • {latest.shift} Shift
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-[10px] font-semibold uppercase text-slate-500">Machine</div>
                <div className="font-bold text-white">{latest.machine}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase text-slate-500">Product</div>
                <div className="font-bold text-blue-300">{latest.product}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase text-slate-500">
                  Shift In Charge Qty
                </div>
                <div className="text-base font-black text-amber-400">{latest.recordedQty}</div>
              </div>
              {isWHAlert ? (
                <div>
                  <div className="text-[10px] font-semibold uppercase text-slate-500">
                    Sent By (Shift In Charge)
                  </div>
                  <div className="font-bold text-slate-200">{latest.shiftInChargeName}</div>
                </div>
              ) : (
                <div>
                  <div className="text-[10px] font-semibold uppercase text-slate-500">
                    WH Qty Received
                  </div>
                  <div className="text-base font-black text-emerald-400">
                    {latest.whReceivedQty ?? '-'}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-1.5 border-t border-slate-800/80 text-[11px] text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
              <span>
                Operator: <b className="text-slate-200">{latest.operatorName}</b>
              </span>
              <span>
                Assistant: <b className="text-slate-200">{latest.assistantName}</b>
              </span>
              {!isWHAlert && latest.whPersonnelName && (
                <span>
                  WH Signed: <b className="text-emerald-300">{latest.whPersonnelName}</b>
                </span>
              )}
            </div>
          </div>

          {activeList.length > 1 && (
            <div className="text-xs font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 flex items-center gap-2">
              <PackageCheck className="h-4 w-4 shrink-0" />
              <span>
                Plus {activeList.length - 1} more pending{' '}
                {activeList.length - 1 === 1 ? 'trolley' : 'trolleys'} waiting in the queue.
              </span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleSnoozeAll}
              className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300 transition"
            >
              Remind Me Later
            </button>
            <button
              type="button"
              onClick={handleOpenConfirm}
              className={`flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-black text-slate-950 shadow-lg transition ${
                isWHAlert
                  ? 'bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400'
                  : 'bg-gradient-to-r from-emerald-400 to-teal-500 hover:from-emerald-300 hover:to-teal-400'
              }`}
            >
              {isWHAlert ? (
                <>
                  <ClipboardCheck className="h-4 w-4" />
                  <span>Open WH Confirmation &amp; Sign</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Open Production HOD Final Confirm</span>
                </>
              )}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
