import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlarmClock,
  ArrowRight,
  CheckCircle2,
  Clock,
  RefreshCw,
  Scale,
  X,
} from 'lucide-react';
import { dtl, getCurrentShift, getOpenEntry, ymd } from '../services/downtimeCalc';
import {
  DowntimeEntry,
  getMachineDepartment,
  normalizeMachineName,
} from '../types';

// Exact scheduled check times requested for Shift In Charge (Day: 09:45, 12:45, 18:00 | Night: 23:45, 03:45, 06:45)
export const WEIGHT_OUTPUT_SCHEDULE_SLOTS = [
  '09:45',
  '12:45',
  '18:00',
  '23:45',
  '03:45',
  '06:45',
] as const;

export type WeightOutputSlotTime = (typeof WEIGHT_OUTPUT_SCHEDULE_SLOTS)[number];

const DONE_SLOTS_STORAGE_KEY = 'lgplast_sic_weight_output_done_v1';

export interface ActiveScheduleSlot {
  slot: WeightOutputSlotTime;
  slotKey: string; // YYYY-MM-DD_HH:mm
  slotDateStr: string;
  shiftLabel: 'Day' | 'Night';
  elapsedMins: number;
}

export function getActiveWeightOutputSlot(now: Date = new Date()): ActiveScheduleSlot | null {
  const candidates: ActiveScheduleSlot[] = [];
  const baseDates = [
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
    new Date(now.getFullYear(), now.getMonth(), now.getDate()),
  ];

  for (const base of baseDates) {
    const dateStr = ymd(base);
    for (const slot of WEIGHT_OUTPUT_SCHEDULE_SLOTS) {
      const [hh, mm] = slot.split(':').map(Number);
      const slotDate = new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate(),
        hh,
        mm,
        0,
        0
      );
      const elapsedMins = Math.floor((now.getTime() - slotDate.getTime()) / 60000);
      // Active for 90 minutes starting exactly at each scheduled time (09:45, 12:45, 15:45, 23:45, 03:45, 06:45)
      if (elapsedMins >= 0 && elapsedMins <= 90) {
        candidates.push({
          slot,
          slotKey: `${dateStr}_${slot}`,
          slotDateStr: dateStr,
          shiftLabel: hh >= 7 && hh < 19 ? 'Day' : 'Night',
          elapsedMins,
        });
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.elapsedMins - b.elapsedMins);
  return candidates[0];
}

export function getNextWeightOutputSlot(now: Date = new Date()): {
  slot: WeightOutputSlotTime;
  minsUntil: number;
} {
  let best: { slot: WeightOutputSlotTime; minsUntil: number } | null = null;
  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    const base = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + dayOffset
    );
    for (const slot of WEIGHT_OUTPUT_SCHEDULE_SLOTS) {
      const [hh, mm] = slot.split(':').map(Number);
      const target = new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate(),
        hh,
        mm,
        0,
        0
      );
      const diffMins = Math.ceil((target.getTime() - now.getTime()) / 60000);
      if (diffMins > 0 && (!best || diffMins < best.minsUntil)) {
        best = { slot, minsUntil: diffMins };
      }
    }
  }
  return best || { slot: '09:45', minsUntil: 0 };
}

export function getCompletedWeightSlots(): string[] {
  try {
    const raw = localStorage.getItem(DONE_SLOTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function markWeightSlotCompleted(slotKey: string) {
  try {
    const current = getCompletedWeightSlots();
    if (!current.includes(slotKey)) {
      const next = [...current.slice(-40), slotKey];
      localStorage.setItem(DONE_SLOTS_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {}
}

interface MachineRowDraft {
  machine: string;
  dept: string;
  product: string;
  weight: string;
  output: string;
  operator: string;
  assistant: string;
  dirty: boolean;
}

interface ShiftWeightOutputPopupAlertProps {
  machines: string[];
  entries: DowntimeEntry[];
  isEligibleUser: boolean; // Shift In Charge (and optionally Admin/HOD if configured)
  hasBlockingPopup?: boolean;
  manualOpenSlot?: ActiveScheduleSlot | null;
  onCloseManual?: () => void;
  onSaveEntry: (entry: DowntimeEntry) => Promise<void> | void;
  onOpenMachinesBoard: () => void;
  currentUserName: string;
  currentUserEmail: string;
}

export const ShiftWeightOutputPopupAlert: React.FC<ShiftWeightOutputPopupAlertProps> = ({
  machines,
  entries,
  isEligibleUser,
  hasBlockingPopup = false,
  manualOpenSlot = null,
  onCloseManual,
  onSaveEntry,
  onOpenMachinesBoard,
  currentUserName,
  currentUserEmail,
}) => {
  const [now, setNow] = useState<Date>(() => new Date());
  const [completedSlots, setCompletedSlots] = useState<string[]>(() =>
    getCompletedWeightSlots()
  );
  const [snoozedSlotsUntil, setSnoozedSlotsUntil] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, MachineRowDraft>>({});
  const [deptFilter, setDeptFilter] = useState<'ALL' | 'Extrusion' | 'Injection' | 'Mixer' | 'Recycling'>('ALL');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Check clock every 15 seconds so pop-up fires right at 09:45, 12:45, 18:00, 23:45, 03:45, 06:45
  useEffect(() => {
    const checkClock = () => setNow(new Date());
    const timer = setInterval(checkClock, 15000);
    const onVis = () => {
      if (document.visibilityState === 'visible') checkClock();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, []);

  const scheduledActive = useMemo(() => {
    if (!isEligibleUser) return null;
    const slot = getActiveWeightOutputSlot(now);
    if (!slot) return null;
    const snoozeExp = snoozedSlotsUntil[slot.slotKey] || 0;
    if (completedSlots.includes(slot.slotKey) || now.getTime() < snoozeExp) {
      return null;
    }
    return slot;
  }, [isEligibleUser, now, completedSlots, snoozedSlotsUntil]);

  const activeSlot = manualOpenSlot || scheduledActive;

  // Build baseline machine list (exclude utility like Chiller/Generator unless needed)
  const productionMachines = useMemo(
    () => machines.filter((m) => getMachineDepartment(m) !== 'Utility'),
    [machines]
  );

  // Sync drafts strictly from Machine Board entries (never altered by Production Logger updates)
  useEffect(() => {
    if (!activeSlot) return;
    const nextDrafts: Record<string, MachineRowDraft> = {};
    productionMachines.forEach((m) => {
      const open = getOpenEntry(m, entries);
      const normM = normalizeMachineName(m).toLowerCase();
      const machineEntries = entries
        .filter((e) => normalizeMachineName(e.m).toLowerCase() === normM && !e.del)
        .sort((a, b) => (b.upd || 0) - (a.upd || 0));
      const latest = open || machineEntries[0];

      nextDrafts[m] = {
        machine: m,
        dept: getMachineDepartment(m),
        product: latest?.jcn && latest.jcn !== 'JC-RUNNING' ? latest.jcn : latest?.jcn || '',
        weight: latest?.runningWeight || '',
        output: latest?.outputPerHour || '',
        operator: latest?.operator || '',
        assistant: latest?.generalHand || '',
        dirty: false,
      };
    });
    setDrafts(nextDrafts);
    setFeedback(null);
  }, [activeSlot?.slotKey]);

  if (!activeSlot) return null;

  const updateRowField = (
    machine: string,
    field: 'product' | 'weight' | 'output',
    val: string
  ) => {
    setDrafts((prev) => {
      const row = prev[machine];
      if (!row) return prev;
      return {
        ...prev,
        [machine]: {
          ...row,
          [field]: val,
          dirty: true,
        },
      };
    });
  };

  const handleDismissForNow = () => {
    if (manualOpenSlot && onCloseManual) {
      onCloseManual();
      return;
    }
    const fiveMinsMs = Date.now() + 5 * 60 * 1000;
    setSnoozedSlotsUntil((prev) => ({
      ...prev,
      [activeSlot.slotKey]: fiveMinsMs,
    }));
  };

  const handleConfirmNoChanges = () => {
    markWeightSlotCompleted(activeSlot.slotKey);
    setCompletedSlots((prev) =>
      prev.includes(activeSlot.slotKey) ? prev : [...prev, activeSlot.slotKey]
    );
    if (manualOpenSlot && onCloseManual) {
      onCloseManual();
    }
  };

  const dirtyRows = (Object.values(drafts) as MachineRowDraft[]).filter(
    (d) => d.dirty && (d.weight.trim() || d.output.trim() || d.product.trim())
  );

  const visibleRows = (Object.values(drafts) as MachineRowDraft[]).filter(
    (r) => deptFilter === 'ALL' || r.dept === deptFilter
  );

  const handleSaveAllUpdates = async () => {
    if (dirtyRows.length === 0) {
      handleConfirmNoChanges();
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const nowDate = new Date();
      const nowDtl = dtl(nowDate);
      const shiftInfo = getCurrentShift(nowDate);

      for (const row of dirtyRows) {
        const open = getOpenEntry(row.machine, entries);
        const weightTrim = row.weight.trim();
        const outputTrim = row.output.trim();
        const prodTrim = row.product.trim() || 'Running Production';

        if (open) {
          await onSaveEntry({
            ...open,
            jcn: prodTrim,
            runningWeight: weightTrim || open.runningWeight,
            outputPerHour: outputTrim || open.outputPerHour,
            upd: Date.now(),
          });
        } else {
          await onSaveEntry({
            id: `SIC_WO_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            m: row.machine,
            cat: 'Running Check',
            start: nowDtl,
            end: nowDtl,
            reason: `Scheduled ${activeSlot.slot} Check — Weight: ${
              weightTrim || '-'
            } | Output: ${outputTrim || '-'}`,
            jcn: prodTrim,
            jcp: 'On Target',
            rep: currentUserName || 'Shift In Charge',
            by: currentUserEmail || '',
            operator: row.operator || 'Plant Operator',
            generalHand: row.assistant || 'General Hand',
            outputPerHour: outputTrim || undefined,
            runningWeight: weightTrim || undefined,
            shift: shiftInfo.label,
            loggedBy: currentUserName || '',
            loggedByEmail: currentUserEmail || '',
            upd: Date.now(),
          });
        }
      }

      markWeightSlotCompleted(activeSlot.slotKey);
      setCompletedSlots((prev) =>
        prev.includes(activeSlot.slotKey) ? prev : [...prev, activeSlot.slotKey]
      );
      setFeedback(
        `Updated ${dirtyRows.length} machine(s) for ${activeSlot.slot} scheduled check!`
      );
      setTimeout(() => {
        if (manualOpenSlot && onCloseManual) onCloseManual();
      }, 650);
    } catch (err: any) {
      setFeedback(err?.message || 'Error saving machine weight/output updates.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pointer-events-auto w-full max-w-4xl rounded-xl border border-slate-300 bg-white text-slate-900 shadow-2xl ring-1 ring-slate-900/15 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-[#0F1E36] text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white border border-white/15 shrink-0">
              <AlarmClock className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold tracking-tight text-white">
                Running Weight &amp; Machine Output Update
              </h3>
              <p className="text-[11px] text-slate-300">
                Enter updated running weight (kg) and output rate (/hr) for active shift machines.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDismissForNow}
            className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition"
            title="Dismiss notice"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Dept Filter & Quick Jump */}
        <div className="px-5 py-2.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            {(['ALL', 'Extrusion', 'Injection', 'Mixer', 'Recycling'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDeptFilter(d)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition ${
                  deptFilter === d
                    ? 'bg-[#0F1E36] text-white border-[#0F1E36]'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {d === 'ALL' ? `All (${productionMachines.length})` : d}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-slate-600 tabular-nums">
              Modified: <b className="text-[#0F1E36]">{dirtyRows.length}</b>
            </span>
            <button
              type="button"
              onClick={() => {
                handleDismissForNow();
                onOpenMachinesBoard();
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 px-2.5 py-1 font-semibold text-slate-700 transition"
            >
              <Activity className="h-3 w-3 text-emerald-700" />
              <span>Machine Board</span>
            </button>
          </div>
        </div>

        {feedback && (
          <div className="mx-5 mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{feedback}</span>
          </div>
        )}

        {/* Scrollable Fast-Edit Machine Table */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1">
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 sticky top-0">
                <tr>
                  <th className="p-2.5">Machine</th>
                  <th className="p-2.5">Running Product</th>
                  <th className="p-2.5">Running Weight (kg)</th>
                  <th className="p-2.5">Machine Output (/hr)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {visibleRows.map((row) => (
                  <tr
                    key={row.machine}
                    className={row.dirty ? 'bg-blue-50/60' : 'hover:bg-slate-50'}
                  >
                    <td className="p-2 whitespace-nowrap">
                      <div className="font-semibold text-slate-900">{row.machine}</div>
                      <div className="text-[10px] text-slate-500">{row.dept}</div>
                    </td>
                    <td className="p-2 min-w-[180px]">
                      <input
                        type="text"
                        value={row.product}
                        onChange={(e) =>
                          updateRowField(row.machine, 'product', e.target.value)
                        }
                        placeholder="Running product"
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                      />
                    </td>
                    <td className="p-2 min-w-[130px]">
                      <input
                        type="text"
                        value={row.weight}
                        onChange={(e) =>
                          updateRowField(row.machine, 'weight', e.target.value)
                        }
                        placeholder="e.g. 650 kg"
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                      />
                    </td>
                    <td className="p-2 min-w-[140px]">
                      <input
                        type="text"
                        value={row.output}
                        onChange={(e) =>
                          updateRowField(row.machine, 'output', e.target.value)
                        }
                        placeholder="e.g. 160 m/hr"
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono tabular-nums text-emerald-800 focus:border-[#0F1E36] focus:outline-none"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
            <Clock className="h-3.5 w-3.5 text-slate-500" />
            <span>
              {activeSlot.shiftLabel} Shift · {activeSlot.slot}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleDismissForNow}
              className="rounded-lg border border-slate-300 bg-white hover:bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-700 transition"
            >
              Remind Later
            </button>
            <button
              type="button"
              onClick={handleConfirmNoChanges}
              className="rounded-lg border border-emerald-600/30 bg-emerald-50 hover:bg-emerald-100 px-3.5 py-2 text-xs font-semibold text-emerald-800 transition"
            >
              Confirm No Change
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSaveAllUpdates}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#193054] disabled:opacity-50 px-5 py-2 text-xs font-bold text-white shadow-xs transition"
            >
              {saving ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Scale className="h-3.5 w-3.5" />
              )}
              <span>
                {saving
                  ? 'Saving Updates...'
                  : dirtyRows.length > 0
                  ? `Save ${dirtyRows.length} Update(s)`
                  : 'Confirm All Weights OK'}
              </span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
    </div>
  );
};
