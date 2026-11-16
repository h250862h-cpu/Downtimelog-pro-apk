import React from 'react';
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  FlaskConical,
  Layers,
  Recycle,
  X,
} from 'lucide-react';
import { SopMixingReport, SopScrapRecord, UserPermissions } from '../types';

export type SopSubTab =
  | 'overview'
  | 'production'
  | 'qc'
  | 'scrap_send'
  | 'recycling'
  | 'mixing'
  | 'handover';

interface SopPopupAlertProps {
  scrapRecords: SopScrapRecord[];
  mixingReports: SopMixingReport[];
  permissions: UserPermissions;
  isAdmin: boolean;
  hasActiveDispatchPopup?: boolean;
  dismissedKeys: string[];
  onDismissKey: (key: string) => void;
  onNavigateToSopTab: (subTab: SopSubTab) => void;
}

export const SopPopupAlert: React.FC<SopPopupAlertProps> = ({
  scrapRecords,
  mixingReports,
  permissions,
  isAdmin,
  hasActiveDispatchPopup = false,
  dismissedKeys,
  onDismissKey,
  onNavigateToSopTab,
}) => {
  if (hasActiveDispatchPopup) return null;

  // 1. Scrap Sent -> Alert Recycling Team
  const pendingForRecycling = permissions.sopRecyclingConfirm
    ? scrapRecords.filter(
        (s) =>
          s.status === 'SENT_TO_RECYCLING' &&
          !dismissedKeys.includes(`SOP_${s.id}_SENT_TO_RECYCLING`)
      )
    : [];

  // 2. Scrap Processed into Usable Material -> Alert Mixers
  const pendingForMixer = permissions.sopMixingAccess
    ? scrapRecords.filter(
        (s) =>
          s.status === 'PROCESSED_FOR_MIXER' &&
          !dismissedKeys.includes(`SOP_${s.id}_PROCESSED_FOR_MIXER`)
      )
    : [];

  // 3. Mixing Complete -> Alert Production HOD / Admin with Stock & Sweeping Balances
  const pendingForHOD =
    isAdmin || permissions.dispatchHODConfirm
      ? mixingReports.filter(
          (m) =>
            m.status === 'PENDING_HOD' &&
            !dismissedKeys.includes(`SOP_MIX_${m.id}_PENDING_HOD`)
        )
      : [];

  if (
    pendingForRecycling.length === 0 &&
    pendingForMixer.length === 0 &&
    pendingForHOD.length === 0
  ) {
    return null;
  }

  // Priority order matching user's persona (or Recycling -> Mixer -> HOD)
  const mode: 'RECYCLING' | 'MIXER' | 'HOD' =
    pendingForRecycling.length > 0
      ? 'RECYCLING'
      : pendingForMixer.length > 0
      ? 'MIXER'
      : 'HOD';

  const handleCloseOne = () => {
    if (mode === 'RECYCLING') {
      const top = pendingForRecycling[0];
      onDismissKey(`SOP_${top.id}_SENT_TO_RECYCLING`);
    } else if (mode === 'MIXER') {
      const top = pendingForMixer[0];
      onDismissKey(`SOP_${top.id}_PROCESSED_FOR_MIXER`);
    } else {
      const top = pendingForHOD[0];
      onDismissKey(`SOP_MIX_${top.id}_PENDING_HOD`);
    }
  };

  const handleSnoozeAll = () => {
    if (mode === 'RECYCLING') {
      pendingForRecycling.forEach((s) => onDismissKey(`SOP_${s.id}_SENT_TO_RECYCLING`));
    } else if (mode === 'MIXER') {
      pendingForMixer.forEach((s) => onDismissKey(`SOP_${s.id}_PROCESSED_FOR_MIXER`));
    } else {
      pendingForHOD.forEach((m) => onDismissKey(`SOP_MIX_${m.id}_PENDING_HOD`));
    }
  };

  const handleNavigate = () => {
    handleSnoozeAll();
    if (mode === 'RECYCLING') onNavigateToSopTab('recycling');
    else onNavigateToSopTab('mixing');
  };

  const latestScrap =
    mode === 'RECYCLING' ? pendingForRecycling[0] : pendingForMixer[0];
  const latestMix = pendingForHOD[0];
  const count =
    mode === 'RECYCLING'
      ? pendingForRecycling.length
      : mode === 'MIXER'
      ? pendingForMixer.length
      : pendingForHOD.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden bg-slate-900 ${
          mode === 'RECYCLING'
            ? 'border-amber-500/60'
            : mode === 'MIXER'
            ? 'border-sky-500/60'
            : 'border-emerald-500/60'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-b ${
            mode === 'RECYCLING'
              ? 'bg-gradient-to-r from-amber-500/20 via-orange-500/10 to-slate-900 border-amber-500/30'
              : mode === 'MIXER'
              ? 'bg-gradient-to-r from-sky-500/20 via-blue-500/10 to-slate-900 border-sky-500/30'
              : 'bg-gradient-to-r from-emerald-500/20 via-teal-500/10 to-slate-900 border-emerald-500/30'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-xl text-slate-950 ${
                mode === 'RECYCLING'
                  ? 'bg-amber-500'
                  : mode === 'MIXER'
                  ? 'bg-sky-400'
                  : 'bg-emerald-400'
              }`}
            >
              {mode === 'RECYCLING' ? (
                <Recycle className="h-5 w-5" />
              ) : mode === 'MIXER' ? (
                <FlaskConical className="h-5 w-5" />
              ) : (
                <BellRing className="h-5 w-5" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wide text-white">
                {mode === 'RECYCLING'
                  ? 'Operator Scrap Logged -> Recycling Alert'
                  : mode === 'MIXER'
                  ? 'Scrap Processed -> Mixer Receipt Alert'
                  : 'Mixing Complete -> Production HOD Stock Alert'}
              </h3>
              <p className="text-[11px] text-slate-300">
                {count} pending floor handoff{count === 1 ? '' : 's'} requiring your confirmation
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCloseOne}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
            title="Dismiss this pop-up"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {mode !== 'HOD' && latestScrap && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-4 space-y-2.5 text-xs tabular-nums">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-mono font-black text-amber-300">{latestScrap.id}</span>
                <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-slate-300">
                  {latestScrap.date} • {latestScrap.time} ({latestScrap.shift})
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-500">Machine</div>
                  <div className="font-bold text-white">{latestScrap.machine}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-500">Product</div>
                  <div className="font-bold text-sky-300">{latestScrap.product}</div>
                </div>

                {mode === 'RECYCLING' ? (
                  <>
                    <div>
                      <div className="text-[10px] font-bold uppercase text-slate-500">
                        Scrap Logged
                      </div>
                      <div className="text-lg font-black text-amber-400">
                        {latestScrap.scrapKg} kg
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase text-slate-500">
                        Sent By Assistant
                      </div>
                      <div className="font-bold text-slate-200">
                        {latestScrap.sentByAssistant}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <div className="text-[10px] font-bold uppercase text-slate-500">
                        Usable Material Ready
                      </div>
                      <div className="text-lg font-black text-sky-400">
                        {latestScrap.usableMaterialKg ?? latestScrap.receivedKg ?? latestScrap.scrapKg} kg
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase text-slate-500">
                        Processed By (Recycling)
                      </div>
                      <div className="font-bold text-slate-200">
                        {latestScrap.processedBy || latestScrap.receivedBy || latestScrap.assignedRecycler}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {latestScrap.scrapReason && (
                <div className="text-[11px] text-slate-400 border-t border-slate-800/80 pt-1.5">
                  Reason: <b className="text-slate-200">{latestScrap.scrapReason}</b>
                </div>
              )}
            </div>
          )}

          {mode === 'HOD' && latestMix && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-4 space-y-2.5 text-xs tabular-nums">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-bold text-emerald-300 flex items-center gap-1.5">
                  <Layers className="h-4 w-4" />
                  {latestMix.machine} — {latestMix.mixerName}
                </span>
                <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-slate-300">
                  {latestMix.date} • {latestMix.shift}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2">
                  <div className="text-[10px] font-bold uppercase text-slate-500">
                    Scrap From Recycling
                  </div>
                  <div className="text-sm font-black text-sky-300">
                    {latestMix.scrapReceivedFromRecyclingKg} kg
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2">
                  <div className="text-[10px] font-bold uppercase text-slate-500">
                    Scrap Used in Mixing
                  </div>
                  <div className="text-sm font-black text-amber-300">
                    {latestMix.scrapUsedInMixingKg} kg
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2">
                  <div className="text-[10px] font-bold uppercase text-slate-500">
                    WH Material Used
                  </div>
                  <div className="text-sm font-black text-white">
                    {latestMix.whMaterialUsedKg} kg
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2">
                  <div className="text-[10px] font-bold uppercase text-slate-500">
                    Sweeping Generated
                  </div>
                  <div className="text-sm font-black text-rose-300">
                    {latestMix.sweepingMaterialKg} kg
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2">
                  <div className="text-[10px] font-bold uppercase text-slate-500">
                    Batches Mixed / Pending
                  </div>
                  <div className="text-sm font-black text-slate-100">
                    {latestMix.batchesMixed} / {latestMix.pendingMix}
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2">
                  <div className="text-[10px] font-bold uppercase text-emerald-300">
                    End-of-Mixing Stock
                  </div>
                  <div className="text-sm font-black text-emerald-300">
                    {latestMix.endOfMixingStockKg} kg
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-slate-400 border-t border-slate-800/80 pt-1.5 flex flex-wrap justify-between gap-2">
                <span>
                  WH Reserved: <b className="text-slate-200">{latestMix.whReservedMaterialKg} kg</b>
                </span>
                <span>
                  Assistant: <b className="text-slate-200">{latestMix.assistantName}</b>
                </span>
              </div>
            </div>
          )}

          {/* Actions */}
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
              onClick={handleNavigate}
              className={`flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-black text-slate-950 shadow-lg transition ${
                mode === 'RECYCLING'
                  ? 'bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400'
                  : mode === 'MIXER'
                  ? 'bg-gradient-to-r from-sky-400 to-blue-500 hover:from-sky-300 hover:to-blue-400'
                  : 'bg-gradient-to-r from-emerald-400 to-teal-500 hover:from-emerald-300 hover:to-teal-400'
              }`}
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>
                {mode === 'RECYCLING'
                  ? 'Open Recycling Receive & Process'
                  : mode === 'MIXER'
                  ? 'Receive Scrap & Log Mixing'
                  : 'Open Production HOD Mixing Review'}
              </span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
