import React from 'react';
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Fuel,
  ShieldCheck,
  Unlock,
  X,
} from 'lucide-react';
import { DieselFuelRequest, UserPermissions } from '../types';

export type DieselSubTab = 'request' | 'hod_approve' | 'dispense' | 'grn' | 'ledger';

interface DieselPopupAlertProps {
  requests: DieselFuelRequest[];
  permissions: UserPermissions;
  isAdmin: boolean;
  currentUserEmail: string;
  hasBlockingPopup: boolean;
  dismissedKeys: string[];
  onDismissKey: (key: string) => void;
  onNavigateToDieselTab: (subTab: DieselSubTab) => void;
}

export const DieselPopupAlert: React.FC<DieselPopupAlertProps> = ({
  requests,
  permissions,
  isAdmin,
  currentUserEmail,
  hasBlockingPopup,
  dismissedKeys,
  onDismissKey,
  onNavigateToDieselTab,
}) => {
  if (hasBlockingPopup) return null;

  const canApproveHod = isAdmin || Boolean(permissions.dieselHODApprove);
  const canRequestOrDispense = isAdmin || Boolean(permissions.dieselFuelRequest);

  // Alert 1: Production HOD receives pop-up when Forklift Driver submits a Fuel Request
  const pendingHodRequests = canApproveHod
    ? requests.filter(
        (r) =>
          r.status === 'PENDING_HOD' &&
          !dismissedKeys.includes(`DIESEL_${r.id}_PENDING_HOD`)
      )
    : [];

  // Alert 2: Forklift Driver receives pop-up once HOD approves & generates the PDF (unlocking meter entry)
  const normEmail = (currentUserEmail || '').trim().toLowerCase();
  const unlockedForDriver = canRequestOrDispense
    ? requests.filter((r) => {
        if (r.status !== 'APPROVED_FOR_DISPENSE' || !r.pdfUnlockedDispense) return false;
        if (dismissedKeys.includes(`DIESEL_${r.id}_APPROVED_FOR_DISPENSE`)) return false;
        // If not admin, show own requests (or all if forklift operator without matching email tag)
        if (!isAdmin && normEmail && r.driverEmail && r.driverEmail.toLowerCase() !== normEmail) {
          return false;
        }
        return true;
      })
    : [];

  if (pendingHodRequests.length === 0 && unlockedForDriver.length === 0) {
    return null;
  }

  const isHodMode = pendingHodRequests.length > 0;
  const activeList = isHodMode ? pendingHodRequests : unlockedForDriver;
  const latest = activeList[0];
  const targetSubTab: DieselSubTab = isHodMode ? 'hod_approve' : 'dispense';

  const handleOpen = () => {
    activeList.forEach((r) => onDismissKey(`DIESEL_${r.id}_${r.status}`));
    onNavigateToDieselTab(targetSubTab);
  };

  const handleSnooze = () => {
    activeList.forEach((r) => onDismissKey(`DIESEL_${r.id}_${r.status}`));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden ${
          isHodMode
            ? 'border-amber-500/60 bg-slate-900 shadow-amber-950/50'
            : 'border-emerald-500/60 bg-slate-900 shadow-emerald-950/50'
        }`}
      >
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-b ${
            isHodMode
              ? 'bg-gradient-to-r from-amber-500/20 via-orange-500/15 to-slate-900 border-amber-500/30'
              : 'bg-gradient-to-r from-emerald-500/20 via-teal-500/15 to-slate-900 border-emerald-500/30'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-xl animate-bounce ${
                isHodMode ? 'bg-amber-500 text-slate-950' : 'bg-emerald-500 text-slate-950'
              }`}
            >
              {isHodMode ? <BellRing className="h-5 w-5" /> : <Unlock className="h-5 w-5" />}
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wide text-white">
                {isHodMode
                  ? 'Forklift Diesel Request → HOD Approval Required'
                  : 'Diesel Approved & PDF Issued → Bowser Meter Unlocked'}
              </h3>
              <p className="text-[11px] text-slate-300">
                {activeList.length}{' '}
                {isHodMode
                  ? 'fuel request(s) awaiting Production HOD approval & voucher PDF'
                  : 'approved voucher(s) ready for Bowser 1st & 2nd meter readings'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onDismissKey(`DIESEL_${latest.id}_${latest.status}`)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
            title="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-black text-amber-300 font-mono">
                <Fuel className="h-4 w-4" />
                {latest.requestNo}
              </span>
              <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-slate-300">
                {latest.date} • {latest.shift} Shift
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-[10px] font-semibold uppercase text-slate-500">
                  Vehicle / Forklift
                </div>
                <div className="font-bold text-white">{latest.vehicleOrForklift}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase text-slate-500">
                  Driver Name
                </div>
                <div className="font-bold text-sky-300">{latest.driverName}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase text-slate-500">
                  {isHodMode ? 'Requested Litres' : 'HOD Approved Litres'}
                </div>
                <div className="text-lg font-black text-amber-400 tabular-nums">
                  {isHodMode
                    ? `${latest.requestedLitres} L`
                    : `${latest.hodApprovedLitres ?? latest.requestedLitres} L`}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase text-slate-500">
                  {isHodMode ? 'Purpose' : 'Approved By'}
                </div>
                <div className="font-semibold text-slate-200 truncate">
                  {isHodMode
                    ? latest.purpose || 'Forklift Operations'
                    : latest.hodApprovedBy || 'Production HOD'}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleSnooze}
              className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300 transition"
            >
              Remind Me Later
            </button>
            <button
              type="button"
              onClick={handleOpen}
              className={`flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-black text-slate-950 shadow-lg transition ${
                isHodMode
                  ? 'bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400'
                  : 'bg-gradient-to-r from-emerald-400 to-teal-500 hover:from-emerald-300 hover:to-teal-400'
              }`}
            >
              {isHodMode ? (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  <span>Approve &amp; Generate Fuel PDF</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Enter Bowser Meter Readings</span>
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
