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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-[#0F1E36] text-white">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white border border-white/15">
                <AlarmClock className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold tracking-tight text-white">
                  {activeSchedule.slot === '06:30'
                    ? 'Morning Dispatch Update Required'
                    : 'Afternoon Dispatch Update Required'}
                </h3>
                <p className="text-[11px] text-slate-300">
                  {activeSchedule.shiftLabel}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleSnoozeSchedule}
              className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition"
              title="Dismiss for now"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-5 space-y-4 text-xs">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
              <p className="text-slate-700 leading-relaxed font-medium">
                Please record ready dispatch trollies, unit weights, and confirm pending floor movements before shift close.
              </p>

              <div className="grid grid-cols-3 gap-2 text-center tabular-nums">
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <span className="text-[11px] text-slate-500 block font-medium">
                    Logged Today
                  </span>
                  <span className="text-base font-bold text-slate-900">
                    {todayEntries.length}
                  </span>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                  <span className="text-[11px] text-amber-800 block font-medium">
                    Awaiting WH
                  </span>
                  <span className="text-base font-bold text-amber-800">
                    {pendingWhCount}
                  </span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <span className="text-[11px] text-slate-500 block font-medium">
                    Awaiting HOD
                  </span>
                  <span className="text-base font-bold text-[#0F1E36]">
                    {pendingHodCount}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleSnoozeSchedule}
                className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 transition"
              >
                Remind Later
              </button>
              <button
                type="button"
                onClick={() => handleAckSchedule(false)}
                className="rounded-lg border border-emerald-600/30 bg-emerald-50 hover:bg-emerald-100 px-4 py-2 text-xs font-semibold text-emerald-800 transition"
              >
                Mark Reviewed
              </button>
              <button
                type="button"
                onClick={() => handleAckSchedule(true)}
                className="flex items-center justify-center gap-2 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-5 py-2 text-xs font-bold text-white shadow-xs transition"
              >
                <Truck className="h-4 w-4" />
                <span>Open Dispatch</span>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl overflow-hidden">
        {/* Formal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-[#0F1E36] text-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white border border-white/15">
              <BellRing className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight text-white">
                {isWHAlert
                  ? 'Dispatch Notice — Warehouse Confirmation Required'
                  : 'Dispatch Notice — Production HOD Approval Required'}
              </h3>
              <p className="text-[11px] text-slate-300">
                {activeList.length} pending {activeList.length === 1 ? 'record' : 'records'} awaiting authorization
              </p>
            </div>
          </div>

          <button
            onClick={() => onDismissKey(stageKey)}
            className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition"
            title="Dismiss notice"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Message Body */}
        <div className="p-5 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0F1E36] tabular-nums">
                <Truck className="h-4 w-4 text-slate-600" />
                Trolley #{latest.trolleyNo}
              </span>
              <span className="text-[11px] font-medium text-slate-500 tabular-nums">
                {latest.date} · {latest.shift} Shift
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-[11px] font-medium text-slate-500">Machine</div>
                <div className="font-semibold text-slate-900">{latest.machine}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">Product</div>
                <div className="font-semibold text-[#0F1E36]">{latest.product}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">
                  Recorded Qty
                </div>
                <div className="text-base font-bold text-slate-900 tabular-nums">{latest.recordedQty}</div>
              </div>
              {isWHAlert ? (
                <div>
                  <div className="text-[11px] font-medium text-slate-500">
                    Submitted By
                  </div>
                  <div className="font-semibold text-slate-800">{latest.shiftInChargeName}</div>
                </div>
              ) : (
                <div>
                  <div className="text-[11px] font-medium text-slate-500">
                    WH Confirmed Qty
                  </div>
                  <div className="text-base font-bold text-emerald-700 tabular-nums">
                    {latest.whReceivedQty ?? '-'}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
              <span>
                Operator: <b className="text-slate-800">{latest.operatorName}</b>
              </span>
              <span>
                Assistant: <b className="text-slate-800">{latest.assistantName}</b>
              </span>
              {!isWHAlert && latest.whPersonnelName && (
                <span>
                  WH Verified: <b className="text-emerald-700">{latest.whPersonnelName}</b>
                </span>
              )}
            </div>
          </div>

          {activeList.length > 1 && (
            <div className="text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 flex items-center gap-2">
              <PackageCheck className="h-4 w-4 shrink-0 text-slate-600" />
              <span>
                {activeList.length - 1} additional{' '}
                {activeList.length - 1 === 1 ? 'entry is' : 'entries are'} pending review.
              </span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleSnoozeAll}
              className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 transition"
            >
              Remind Later
            </button>
            <button
              type="button"
              onClick={handleOpenConfirm}
              className="flex items-center justify-center gap-2 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-5 py-2 text-xs font-bold text-white shadow-xs transition"
            >
              {isWHAlert ? (
                <>
                  <ClipboardCheck className="h-4 w-4" />
                  <span>Review &amp; Confirm WH</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Review &amp; Approve</span>
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
