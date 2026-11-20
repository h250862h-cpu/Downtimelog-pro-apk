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
  hasBlockingPopup?: boolean;
  dismissedKeys: string[];
  onDismissKey: (key: string) => void;
  onNavigateToDieselTab: (subTab: DieselSubTab) => void;
}

export const DieselPopupAlert: React.FC<DieselPopupAlertProps> = ({
  requests,
  permissions,
  isAdmin,
  currentUserEmail,
  dismissedKeys,
  onDismissKey,
  onNavigateToDieselTab,
}) => {
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
    <div className="pointer-events-auto w-full max-w-lg rounded-xl border border-slate-300 bg-white text-slate-900 shadow-2xl ring-1 ring-slate-900/15 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-[#0F1E36] text-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white border border-white/15">
              {isHodMode ? <BellRing className="h-5 w-5" /> : <Unlock className="h-5 w-5" />}
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight text-white">
                {isHodMode
                  ? 'Diesel Request — HOD Approval Required'
                  : 'Diesel Approved — Bowser Meter Entry Open'}
              </h3>
              <p className="text-[11px] text-slate-300">
                {activeList.length}{' '}
                {isHodMode
                  ? 'fuel request(s) awaiting Production HOD approval'
                  : 'approved voucher(s) ready for meter reading entry'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onDismissKey(`DIESEL_${latest.id}_${latest.status}`)}
            className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition"
            title="Dismiss notice"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0F1E36] font-mono">
                <Fuel className="h-4 w-4 text-slate-600" />
                {latest.requestNo}
              </span>
              <span className="text-[11px] font-medium text-slate-500 tabular-nums">
                {latest.date} · {latest.shift} Shift
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-[11px] font-medium text-slate-500">
                  Vehicle / Forklift
                </div>
                <div className="font-semibold text-slate-900">{latest.vehicleOrForklift}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">
                  Driver
                </div>
                <div className="font-semibold text-[#0F1E36]">{latest.driverName}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">
                  {isHodMode ? 'Requested Volume' : 'Approved Volume'}
                </div>
                <div className="text-base font-bold text-slate-900 tabular-nums">
                  {isHodMode
                    ? `${latest.requestedLitres} L`
                    : `${latest.hodApprovedLitres ?? latest.requestedLitres} L`}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">
                  {isHodMode ? 'Purpose' : 'Approved By'}
                </div>
                <div className="font-semibold text-slate-800 truncate">
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
              className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 transition"
            >
              Remind Later
            </button>
            <button
              type="button"
              onClick={handleOpen}
              className="flex items-center justify-center gap-2 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-5 py-2 text-xs font-bold text-white shadow-xs transition"
            >
              {isHodMode ? (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  <span>Review &amp; Issue Fuel PDF</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Enter Meter Readings</span>
                </>
              )}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
    </div>
  );
};
