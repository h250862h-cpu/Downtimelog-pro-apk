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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl overflow-hidden">
        {/* Formal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-[#0F1E36] text-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white border border-white/15">
              {mode === 'RECYCLING' ? (
                <Recycle className="h-5 w-5" />
              ) : mode === 'MIXER' ? (
                <FlaskConical className="h-5 w-5" />
              ) : (
                <BellRing className="h-5 w-5" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight text-white">
                {mode === 'RECYCLING'
                  ? 'Scrap Handover — Recycling Confirmation'
                  : mode === 'MIXER'
                  ? 'Processed Material — Mixer Receipt'
                  : 'Mixing Summary — Production HOD Review'}
              </h3>
              <p className="text-[11px] text-slate-300">
                {count} pending handover{count === 1 ? '' : 's'} requiring review
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCloseOne}
            className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition"
            title="Dismiss notice"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {mode !== 'HOD' && latestScrap && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2.5 text-xs tabular-nums">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="font-mono font-bold text-[#0F1E36]">{latestScrap.id}</span>
                <span className="text-[11px] font-medium text-slate-500">
                  {latestScrap.date} · {latestScrap.time} ({latestScrap.shift})
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] font-medium text-slate-500">Machine</div>
                  <div className="font-semibold text-slate-900">{latestScrap.machine}</div>
                </div>
                <div>
                  <div className="text-[11px] font-medium text-slate-500">Product</div>
                  <div className="font-semibold text-[#0F1E36]">{latestScrap.product}</div>
                </div>

                {mode === 'RECYCLING' ? (
                  <>
                    <div>
                      <div className="text-[11px] font-medium text-slate-500">
                        Scrap Recorded
                      </div>
                      <div className="text-base font-bold text-amber-800">
                        {latestScrap.scrapKg} kg
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-slate-500">
                        Submitted By
                      </div>
                      <div className="font-semibold text-slate-800">
                        {latestScrap.sentByAssistant}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <div className="text-[11px] font-medium text-slate-500">
                        Usable Material Ready
                      </div>
                      <div className="text-base font-bold text-emerald-700">
                        {latestScrap.usableMaterialKg ?? latestScrap.receivedKg ?? latestScrap.scrapKg} kg
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-slate-500">
                        Processed By
                      </div>
                      <div className="font-semibold text-slate-800">
                        {latestScrap.processedBy || latestScrap.receivedBy || latestScrap.assignedRecycler}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {latestScrap.scrapReason && (
                <div className="text-[11px] text-slate-600 border-t border-slate-200 pt-2">
                  Remarks: <b className="text-slate-900">{latestScrap.scrapReason}</b>
                </div>
              )}
            </div>
          )}

          {mode === 'HOD' && latestMix && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2.5 text-xs tabular-nums">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="font-bold text-[#0F1E36] flex items-center gap-1.5">
                  <Layers className="h-4 w-4" />
                  {latestMix.machine} — {latestMix.mixerName}
                </span>
                <span className="text-[11px] font-medium text-slate-500">
                  {latestMix.date} · {latestMix.shift}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <div className="text-[11px] font-medium text-slate-500">
                    Scrap Received
                  </div>
                  <div className="text-sm font-bold text-slate-900">
                    {latestMix.scrapReceivedFromRecyclingKg} kg
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <div className="text-[11px] font-medium text-slate-500">
                    Scrap Used
                  </div>
                  <div className="text-sm font-bold text-amber-800">
                    {latestMix.scrapUsedInMixingKg} kg
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <div className="text-[11px] font-medium text-slate-500">
                    WH Material
                  </div>
                  <div className="text-sm font-bold text-slate-900">
                    {latestMix.whMaterialUsedKg} kg
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <div className="text-[11px] font-medium text-slate-500">
                    Sweeping
                  </div>
                  <div className="text-sm font-bold text-rose-700">
                    {latestMix.sweepingMaterialKg} kg
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <div className="text-[11px] font-medium text-slate-500">
                    Batches Mixed
                  </div>
                  <div className="text-sm font-bold text-slate-900">
                    {latestMix.batchesMixed} / {latestMix.pendingMix}
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
                  <div className="text-[11px] font-medium text-emerald-800">
                    Closing Stock
                  </div>
                  <div className="text-sm font-bold text-emerald-800">
                    {latestMix.endOfMixingStockKg} kg
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-slate-600 border-t border-slate-200 pt-2 flex flex-wrap justify-between gap-2">
                <span>
                  WH Reserved: <b className="text-slate-900">{latestMix.whReservedMaterialKg} kg</b>
                </span>
                <span>
                  Assistant: <b className="text-slate-900">{latestMix.assistantName}</b>
                </span>
              </div>
            </div>
          )}

          {/* Actions */}
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
              onClick={handleNavigate}
              className="flex items-center justify-center gap-2 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-5 py-2 text-xs font-bold text-white shadow-xs transition"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>
                {mode === 'RECYCLING'
                  ? 'Open Recycling Confirmation'
                  : mode === 'MIXER'
                  ? 'Open Mixer Log'
                  : 'Review Mixing Report'}
              </span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
