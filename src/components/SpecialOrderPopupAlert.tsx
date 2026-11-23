import React from 'react';
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  PackageCheck,
  X,
} from 'lucide-react';
import {
  SpecialOrderFactoryProduction,
  SpecialOrderWhDispatch,
  UserPermissions,
} from '../types';
import { SpecialOrderSubTab } from './SpecialOrdersView';

interface SpecialOrderPopupAlertProps {
  prodEntries: SpecialOrderFactoryProduction[];
  whDispatches: SpecialOrderWhDispatch[];
  permissions: UserPermissions;
  isAdmin: boolean;
  dismissedKeys: string[];
  onDismissKey: (key: string) => void;
  onNavigateToSpecialOrders: (subTab: SpecialOrderSubTab) => void;
}

export const SpecialOrderPopupAlert: React.FC<SpecialOrderPopupAlertProps> = ({
  prodEntries,
  whDispatches,
  permissions,
  isAdmin,
  dismissedKeys,
  onDismissKey,
  onNavigateToSpecialOrders,
}) => {
  const canHod =
    isAdmin || (Boolean(permissions.specialOrdersAccess) && Boolean(permissions.dispatchHODConfirm));
  const canWh =
    isAdmin || (Boolean(permissions.specialOrdersAccess) && Boolean(permissions.dispatchWHConfirm));

  const pendingFactoryHod = canHod
    ? prodEntries.filter(
        (p) =>
          !p.deleted &&
          p.status === 'PENDING_HOD_FACTORY' &&
          !dismissedKeys.includes(`SO_FAC_${p.id}`)
      )
    : [];

  const pendingWh = canWh
    ? whDispatches.filter(
        (w) =>
          !w.deleted &&
          w.status === 'PENDING_WH' &&
          !dismissedKeys.includes(`SO_WH_${w.id}`)
      )
    : [];

  const pendingHodWh = canHod
    ? whDispatches.filter(
        (w) =>
          !w.deleted &&
          w.status === 'PENDING_HOD' &&
          !dismissedKeys.includes(`SO_HOD_${w.id}`)
      )
    : [];

  if (
    pendingFactoryHod.length === 0 &&
    pendingWh.length === 0 &&
    pendingHodWh.length === 0
  ) {
    return null;
  }

  // Prioritize WH -> Final HOD WH -> Factory HOD confirmation
  const isWhNotice = pendingWh.length > 0;
  const isHodWhNotice = !isWhNotice && pendingHodWh.length > 0;

  if (isWhNotice || isHodWhNotice) {
    const activeList = isWhNotice ? pendingWh : pendingHodWh;
    const latest = activeList[0];
    const dismissKey = isWhNotice ? `SO_WH_${latest.id}` : `SO_HOD_${latest.id}`;
    return (
      <div className="pointer-events-auto w-full max-w-lg rounded-xl border border-slate-300 bg-white text-slate-900 shadow-2xl ring-1 ring-slate-900/15 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-[#0F1E36] text-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white border border-white/15">
              <Boxes className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight text-white">
                {isWhNotice
                  ? 'Special Order Ready — WH Receipt Required'
                  : 'Special Order Dispatch — HOD Final Approval'}
              </h3>
              <p className="text-[11px] text-slate-300">
                {activeList.length} pending movement{activeList.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onDismissKey(dismissKey)}
            className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 text-xs">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between font-bold text-[#0F1E36]">
              <span>
                {latest.orderNo} · {latest.dispatchRef}
              </span>
              <span className="tabular-nums">
                {latest.date} ({latest.shift})
              </span>
            </div>
            <div className="text-slate-700 font-medium">{latest.orderTitle}</div>
            <div className="text-slate-800">
              Total:{' '}
              <b className="tabular-nums">
                {latest.totalWhReceivedQty ?? latest.totalRecordedQty} units
              </b>{' '}
              — {(latest.whReceivedItems || latest.items).map((i) => `${i.sizeLabel}: ${i.qty}`).join(' | ')}
            </div>
            <div className="text-[11px] text-slate-500">
              Submitted by: <b>{latest.shiftInChargeName}</b>
              {latest.whPersonnelName && (
                <>
                  {' '}
                  · WH: <b className="text-emerald-700">{latest.whPersonnelName}</b>
                </>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onDismissKey(dismissKey)}
              className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-4 py-2 font-semibold text-slate-700"
            >
              Remind Later
            </button>
            <button
              type="button"
              onClick={() => {
                activeList.forEach((item) =>
                  onDismissKey(isWhNotice ? `SO_WH_${item.id}` : `SO_HOD_${item.id}`)
                );
                onNavigateToSpecialOrders('wh_dispatch');
              }}
              className="flex items-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-4 py-2 font-bold text-white"
            >
              {isWhNotice ? <PackageCheck className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              <span>{isWhNotice ? 'Review & Confirm WH' : 'HOD Final Confirm'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Pending HOD Factory Production Stock Confirmation
  const latestProd = pendingFactoryHod[0];
  const prodKey = `SO_FAC_${latestProd.id}`;
  return (
    <div className="pointer-events-auto w-full max-w-lg rounded-xl border border-slate-300 bg-white text-slate-900 shadow-2xl ring-1 ring-slate-900/15 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-[#0F1E36] text-white">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white border border-white/15">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold tracking-tight text-white">
              Special Order Factory Stock — HOD Confirmation
            </h3>
            <p className="text-[11px] text-slate-300">
              {pendingFactoryHod.length} daily batch{pendingFactoryHod.length === 1 ? '' : 'es'} awaiting HOD verification
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDismissKey(prodKey)}
          className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-5 space-y-3 text-xs">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-1.5">
          <div className="flex items-center justify-between font-bold text-[#0F1E36]">
            <span>
              {latestProd.orderNo} · {latestProd.batchNo}
            </span>
            <span className="tabular-nums">
              {latestProd.date} ({latestProd.shift})
            </span>
          </div>
          <div className="text-slate-700 font-medium">{latestProd.orderTitle}</div>
          <div className="text-slate-800">
            Produced Total: <b className="tabular-nums">{latestProd.totalQty} units</b> —{' '}
            {latestProd.items.map((i) => `${i.sizeLabel}: ${i.qty}`).join(' | ')}
          </div>
          <div className="text-[11px] text-slate-500">
            Shift In Charge: <b>{latestProd.shiftInChargeName}</b> · Rack {latestProd.rackOrTrolleyNo}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onDismissKey(prodKey)}
            className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-4 py-2 font-semibold text-slate-700"
          >
            Remind Later
          </button>
          <button
            type="button"
            onClick={() => {
              pendingFactoryHod.forEach((p) => onDismissKey(`SO_FAC_${p.id}`));
              onNavigateToSpecialOrders('factory_prod');
            }}
            className="flex items-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-4 py-2 font-bold text-white"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>Confirm Factory Stock</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
