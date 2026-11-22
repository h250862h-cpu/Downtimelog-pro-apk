import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertOctagon,
  ArrowRight,
  Boxes,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Factory,
  FileDown,
  FileSpreadsheet,
  Lock,
  PackageCheck,
  PenTool,
  Plus,
  ShieldCheck,
  Trash2,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import { DigitalSignaturePad } from './DigitalSignaturePad';
import { ymd } from '../services/downtimeCalc';
import {
  buildSpecialOrderSizeProductName,
  computeOrderFactoryStock,
  exportSpecialOrderFactoryStockExcel,
  exportSpecialOrderWhDispatchedExcel,
  generateSpecialOrderMovementPdf,
  hodConfirmSpecialOrderFactoryStock,
  hodConfirmSpecialOrderWhDispatch,
  hodDeleteSpecialOrderFactoryBatch,
  hodDeleteSpecialOrderWhDispatch,
  parseSpecialOrderSizePlanWorkbook,
  pullTargetsFromMonthlyPlans,
  saveSpecialOrderToFirebase,
  submitSpecialOrderProduction,
  submitSpecialOrderWhDispatch,
  updateSpecialOrderSizePlanning,
  whConfirmSpecialOrderDispatch,
} from '../services/specialOrderStore';
import {
  GUM_BOOT_SIZES,
  ProductionPlanItem,
  SpecialOrder,
  SpecialOrderFactoryProduction,
  SpecialOrderSizeItem,
  SpecialOrderWhDispatch,
  UserPermissions,
  normalizeMachineName,
} from '../types';
import { GENERAL_HAND_OPTIONS, OPERATOR_OPTIONS } from '../types/factoryStaff';

export type SpecialOrderSubTab = 'stock' | 'factory_prod' | 'wh_dispatch' | 'reports';

function getPlanProgressWidthClass(pct: number): string {
  if (pct <= 0) return 'w-0';
  if (pct < 12) return 'w-1/12';
  if (pct < 20) return 'w-1/6';
  if (pct < 30) return 'w-1/4';
  if (pct < 40) return 'w-1/3';
  if (pct < 55) return 'w-1/2';
  if (pct < 70) return 'w-2/3';
  if (pct < 80) return 'w-3/4';
  if (pct < 90) return 'w-5/6';
  if (pct < 99) return 'w-11/12';
  return 'w-full';
}

interface SpecialOrdersViewProps {
  machines: string[];
  orders: SpecialOrder[];
  prodEntries: SpecialOrderFactoryProduction[];
  whDispatches: SpecialOrderWhDispatch[];
  monthlyPlans?: ProductionPlanItem[];
  permissions: UserPermissions;
  isAdmin: boolean;
  currentUserName: string;
  currentUserEmail: string;
  requestedSubTab?: SpecialOrderSubTab | null;
  onSubTabHandled?: () => void;
  onDataChanged?: () => void;
}

export const SpecialOrdersView: React.FC<SpecialOrdersViewProps> = ({
  machines,
  orders,
  prodEntries,
  whDispatches,
  monthlyPlans = [],
  permissions,
  isAdmin,
  currentUserName,
  currentUserEmail,
  requestedSubTab,
  onSubTabHandled,
  onDataChanged,
}) => {
  const [subTab, setSubTab] = useState<SpecialOrderSubTab>('stock');
  const [selectedOrderId, setSelectedOrderId] = useState<string>(
    orders[0]?.id || 'SO-GUMBOOT-39-46'
  );
  const [feedback, setFeedback] = useState<{ text: string; isError?: boolean } | null>(null);

  // Create New Special Order Drawer
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);
  const [newOrderNo, setNewOrderNo] = useState('');
  const [newOrderTitle, setNewOrderTitle] = useState('');
  const [newCustomer, setNewCustomer] = useState('');
  const [newProductPrefix, setNewProductPrefix] = useState('');
  const [newOrderMachine, setNewOrderMachine] = useState('Gumboot Machine');
  const [newSizesCsv, setNewSizesCsv] = useState(GUM_BOOT_SIZES.join(', '));

  // Factory Production Form (Shift In Charge)
  const [prodDate, setProdDate] = useState(() => ymd(new Date()));
  const [prodShift, setProdShift] = useState<'Day' | 'Night'>(() =>
    new Date().getHours() >= 7 && new Date().getHours() < 19 ? 'Day' : 'Night'
  );
  const [prodMachine, setProdMachine] = useState('Gumboot Machine');
  const [prodRack, setProdRack] = useState('FACTORY-RACK-01');
  const [prodOperator, setProdOperator] = useState('esmore urombo');
  const [prodAssistant, setProdAssistant] = useState('TINASHE BVUNGO');
  const [prodIsCasual, setProdIsCasual] = useState(false);
  const [prodCasualName, setProdCasualName] = useState('');
  const [prodNotes, setProdNotes] = useState('');
  const [prodSizeQtys, setProdSizeQtys] = useState<Record<string, string>>({});
  const [prodSizeUnitWt, setProdSizeUnitWt] = useState<Record<string, string>>({});
  const [prodSig, setProdSig] = useState('');
  const [submittingProd, setSubmittingProd] = useState(false);

  // Ready WH Dispatch Form (Shift In Charge -> WH -> HOD)
  const [whDate, setWhDate] = useState(() => ymd(new Date()));
  const [whShift, setWhShift] = useState<'Day' | 'Night'>(() =>
    new Date().getHours() >= 7 && new Date().getHours() < 19 ? 'Day' : 'Night'
  );
  const [whMachine, setWhMachine] = useState('Gumboot Machine');
  const [whTrolleyNo, setWhTrolleyNo] = useState('');
  const [whOperator, setWhOperator] = useState('esmore urombo');
  const [whAssistant, setWhAssistant] = useState('TINASHE BVUNGO');
  const [whIsCasual, setWhIsCasual] = useState(false);
  const [whCasualName, setWhCasualName] = useState('');
  const [whShiftNotes, setWhShiftNotes] = useState('');
  const [whSizeQtys, setWhSizeQtys] = useState<Record<string, string>>({});
  const [whSizeUnitWt, setWhSizeUnitWt] = useState<Record<string, string>>({});
  const [whShiftSig, setWhShiftSig] = useState('');
  const [submittingWh, setSubmittingWh] = useState(false);

  // Confirmation Action Modal (HOD Factory, WH Receive, HOD Final WH Dispatch)
  const [activeFactoryConfirm, setActiveFactoryConfirm] =
    useState<SpecialOrderFactoryProduction | null>(null);
  const [factoryHodNotes, setFactoryHodNotes] = useState('');
  const [factoryHodSig, setFactoryHodSig] = useState('');

  const [activeWhConfirm, setActiveWhConfirm] = useState<SpecialOrderWhDispatch | null>(null);
  const [whConfirmQtys, setWhConfirmQtys] = useState<Record<string, string>>({});
  const [whConfirmReason, setWhConfirmReason] = useState('');
  const [whConfirmNotes, setWhConfirmNotes] = useState('');
  const [whConfirmSig, setWhConfirmSig] = useState('');

  const [activeHodWhConfirm, setActiveHodWhConfirm] =
    useState<SpecialOrderWhDispatch | null>(null);
  const [hodWhNotes, setHodWhNotes] = useState('');
  const [hodWhSig, setHodWhSig] = useState('');

  // Signature Pad Target
  const [sigTarget, setSigTarget] = useState<
    null | 'prod_shift' | 'prod_hod' | 'wh_shift' | 'wh_receive' | 'wh_hod'
  >(null);

  // Per-Size Planning Modal State
  const [showPlanningModal, setShowPlanningModal] = useState(false);
  const [planDraftTargets, setPlanDraftTargets] = useState<Record<string, string>>({});
  const [planSourceNote, setPlanSourceNote] = useState('Manual Size Planning Entry');
  const [planImportMsg, setPlanImportMsg] = useState<string | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);
  const planFileInputRef = useRef<HTMLInputElement | null>(null);

  // HOD Delete Confirmation Modal State
  const [deleteTarget, setDeleteTarget] = useState<
    | null
    | { kind: 'factory'; entry: SpecialOrderFactoryProduction }
    | { kind: 'wh'; entry: SpecialOrderWhDispatch }
  >(null);
  const [deletingRecord, setDeletingRecord] = useState(false);

  useEffect(() => {
    if (requestedSubTab) {
      setSubTab(requestedSubTab);
      onSubTabHandled?.();
    }
  }, [requestedSubTab, onSubTabHandled]);

  const activeOrder = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) || orders[0],
    [orders, selectedOrderId]
  );

  useEffect(() => {
    if (activeOrder?.machine) {
      setProdMachine(activeOrder.machine);
      setWhMachine(activeOrder.machine);
    }
  }, [activeOrder?.id, activeOrder?.machine]);

  const stockSummary = useMemo(() => {
    if (!activeOrder) return null;
    return computeOrderFactoryStock(activeOrder, prodEntries, whDispatches);
  }, [activeOrder, prodEntries, whDispatches]);

  const orderProdEntries = useMemo(
    () =>
      prodEntries
        .filter((p) => !p.deleted && (!activeOrder || p.orderId === activeOrder.id))
        .sort((a, b) => (b.upd || 0) - (a.upd || 0)),
    [prodEntries, activeOrder]
  );

  const orderWhDispatches = useMemo(
    () =>
      whDispatches
        .filter((w) => !w.deleted && (!activeOrder || w.orderId === activeOrder.id))
        .sort((a, b) => (b.upd || 0) - (a.upd || 0)),
    [whDispatches, activeOrder]
  );

  const pendingFactoryHodCount = orderProdEntries.filter(
    (p) => p.status === 'PENDING_HOD_FACTORY'
  ).length;
  const pendingWhConfirmCount = orderWhDispatches.filter(
    (w) => w.status === 'PENDING_WH'
  ).length;
  const pendingHodWhCount = orderWhDispatches.filter(
    (w) => w.status === 'PENDING_HOD'
  ).length;

  const canShiftWrite = isAdmin || permissions.dispatchShiftEntry || permissions.specialOrdersAccess;
  const canWhConfirm = isAdmin || permissions.dispatchWHConfirm;
  const canHodConfirm = isAdmin || permissions.dispatchHODConfirm;
  const canManagePlanning = isAdmin || canHodConfirm || permissions.productionPlanningAccess;

  const flashMsg = (text: string, isError = false) => {
    setFeedback({ text, isError });
    setTimeout(() => setFeedback(null), 5000);
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedSizes = newSizesCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!newOrderNo.trim() || !newOrderTitle.trim() || parsedSizes.length === 0) {
      flashMsg('Order No, Title, and at least 1 size/variant are required.', true);
      return;
    }
    const order: SpecialOrder = {
      id: `SO-${Date.now()}`,
      orderNo: newOrderNo.trim().toUpperCase(),
      title: newOrderTitle.trim(),
      customerName: newCustomer.trim() || 'Special Contract',
      productPrefix: newProductPrefix.trim() || newOrderTitle.trim().toUpperCase(),
      machine: normalizeMachineName(newOrderMachine),
      sizes: parsedSizes,
      status: 'ACTIVE',
      createdBy: currentUserName,
      createdAt: new Date().toISOString(),
      upd: Date.now(),
    };
    const res = await saveSpecialOrderToFirebase(order);
    onDataChanged?.();
    setSelectedOrderId(order.id);
    setShowNewOrderModal(false);
    setNewOrderNo('');
    setNewOrderTitle('');
    setNewCustomer('');
    setNewProductPrefix('');
    flashMsg(
      res.ok
        ? `Special Order ${order.orderNo} created & synced.`
        : `Saved locally (${res.error || 'offline'}).`
    );
  };

  const openPlanningModal = () => {
    if (!activeOrder) return;
    const draft: Record<string, string> = {};
    activeOrder.sizes.forEach((sz) => {
      const existing = Number(activeOrder.sizeTargets?.[sz] || 0);
      draft[sz] = existing > 0 ? String(existing) : '';
    });
    setPlanDraftTargets(draft);
    setPlanSourceNote(activeOrder.planningSource || 'Manual Size Planning Entry');
    setPlanImportMsg(null);
    setShowPlanningModal(true);
  };

  const handlePullFromMonthlyPlan = () => {
    if (!activeOrder) return;
    const pulled = pullTargetsFromMonthlyPlans(activeOrder, monthlyPlans);
    if (pulled.matchedSizes === 0) {
      setPlanImportMsg(
        monthlyPlans.length === 0
          ? 'No active Monthly Production Plans found. Enter targets manually or upload an Excel/CSV file.'
          : 'No matching Gumboot/Size rows found in the latest Monthly Plan. Enter targets below or upload a spreadsheet.'
      );
      return;
    }
    const nextDraft: Record<string, string> = { ...planDraftTargets };
    Object.entries(pulled.targets).forEach(([sz, qty]) => {
      nextDraft[sz] = qty > 0 ? String(qty) : '';
    });
    setPlanDraftTargets(nextDraft);
    setPlanSourceNote(`Monthly Plan (${pulled.activeMonth || 'Active'})`);
    setPlanImportMsg(
      `Loaded ${pulled.matchedSizes} size target(s) from Monthly Plan (${pulled.activeMonth || 'Active'}). Review & click Save Size Planning.`
    );
  };

  const handlePlanExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeOrder) return;
    try {
      const parsed = await parseSpecialOrderSizePlanWorkbook(
        file,
        activeOrder.sizes,
        activeOrder.productPrefix
      );
      if (parsed.matchedCount === 0) {
        setPlanImportMsg(
          `Could not match any size rows (e.g. Size 39–46) in "${file.name}". Ensure columns include Size/Product and Planned Qty.`
        );
        return;
      }
      const nextDraft: Record<string, string> = { ...planDraftTargets };
      Object.entries(parsed.targets).forEach(([sz, qty]) => {
        nextDraft[sz] = qty > 0 ? String(qty) : '';
      });
      setPlanDraftTargets(nextDraft);
      setPlanSourceNote(`Excel Plan (${file.name})`);
      setPlanImportMsg(
        `Matched ${parsed.matchedCount} size target(s) from "${file.name}". Review & click Save Size Planning.`
      );
    } catch (err: any) {
      setPlanImportMsg(`Import failed: ${err?.message || 'Invalid workbook format'}`);
    }
  };

  const handleSaveSizePlanning = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrder) return;
    setSavingPlan(true);
    const numericTargets: Record<string, number> = {};
    activeOrder.sizes.forEach((sz) => {
      const val = Number(planDraftTargets[sz] || 0);
      numericTargets[sz] = Number.isFinite(val) && val > 0 ? Math.round(val) : 0;
    });
    const res = await updateSpecialOrderSizePlanning({
      order: activeOrder,
      sizeTargets: numericTargets,
      updatedBy: currentUserName,
      sourceLabel: planSourceNote,
    });
    setSavingPlan(false);
    onDataChanged?.();
    setShowPlanningModal(false);
    flashMsg(
      res.ok
        ? `Per-size planning targets saved & synced for ${activeOrder.orderNo}.`
        : `Planning targets saved locally (${res.error || 'offline sync queued'}).`
    );
  };

  const handleClearSizePlanning = async () => {
    if (!activeOrder) return;
    setSavingPlan(true);
    const cleared: Record<string, number> = {};
    activeOrder.sizes.forEach((sz) => {
      cleared[sz] = 0;
    });
    const res = await updateSpecialOrderSizePlanning({
      order: activeOrder,
      sizeTargets: cleared,
      updatedBy: currentUserName,
      sourceLabel: 'Cleared',
    });
    setSavingPlan(false);
    onDataChanged?.();
    setShowPlanningModal(false);
    flashMsg(
      res.ok
        ? `Cleared size planning targets for ${activeOrder.orderNo}.`
        : `Cleared locally (${res.error || 'offline sync queued'}).`
    );
  };

  const handleConfirmDeleteRaisedOrder = async () => {
    if (!deleteTarget || !canHodConfirm) return;
    if (
      (deleteTarget.kind === 'factory' && deleteTarget.entry.status === 'CONFIRMED_IN_FACTORY') ||
      (deleteTarget.kind === 'wh' && deleteTarget.entry.status === 'CONFIRMED')
    ) {
      setDeleteTarget(null);
      flashMsg('Confirmed stock cannot be deleted once locked.', true);
      return;
    }
    setDeletingRecord(true);
    if (deleteTarget.kind === 'factory') {
      const res = await hodDeleteSpecialOrderFactoryBatch({
        entry: deleteTarget.entry,
        hodName: currentUserName,
        hodEmail: currentUserEmail,
      });
      setDeletingRecord(false);
      setDeleteTarget(null);
      onDataChanged?.();
      flashMsg(
        res.ok
          ? `Deleted raised factory batch ${deleteTarget.entry.batchNo} permanently across synced devices.`
          : res.error || 'Delete failed.',
        !res.ok
      );
    } else {
      const res = await hodDeleteSpecialOrderWhDispatch({
        entry: deleteTarget.entry,
        hodName: currentUserName,
        hodEmail: currentUserEmail,
      });
      setDeletingRecord(false);
      setDeleteTarget(null);
      onDataChanged?.();
      flashMsg(
        res.ok
          ? `Deleted raised WH dispatch ${deleteTarget.entry.dispatchRef} permanently across synced devices.`
          : res.error || 'Delete failed.',
        !res.ok
      );
    }
  };

  const handleSubmitFactoryProd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrder) return;
    const items: SpecialOrderSizeItem[] = activeOrder.sizes
      .map((sizeLabel) => {
        const qty = Number(prodSizeQtys[sizeLabel] || 0);
        const unitWeightKg = Number(prodSizeUnitWt[sizeLabel] || 0) || undefined;
        const totalWeightKg =
          unitWeightKg && qty > 0 ? Number((qty * unitWeightKg).toFixed(2)) : undefined;
        return {
          sizeLabel,
          productName: buildSpecialOrderSizeProductName(activeOrder.productPrefix, sizeLabel),
          qty,
          unitWeightKg,
          totalWeightKg,
        };
      })
      .filter((i) => i.qty > 0);

    if (items.length === 0) {
      flashMsg('Enter daily produced quantity for at least one size (39–46).', true);
      return;
    }
    if (!prodSig) {
      flashMsg('Shift In Charge digital signature is required.', true);
      return;
    }

    setSubmittingProd(true);
    const res = await submitSpecialOrderProduction({
      order: activeOrder,
      date: prodDate,
      shift: prodShift,
      machine: prodMachine,
      rackOrTrolleyNo: prodRack,
      items,
      operatorName: prodOperator,
      assistantName: prodIsCasual ? prodCasualName.trim() || 'Casual Hand' : prodAssistant,
      isCasualAssistant: prodIsCasual,
      casualAssistantName: prodIsCasual ? prodCasualName.trim() : undefined,
      shiftInChargeName: currentUserName,
      shiftInChargeSignature: prodSig,
      shiftNotes: prodNotes.trim(),
      submittedByEmail: currentUserEmail,
    });
    setSubmittingProd(false);
    setProdSizeQtys({});
    setProdNotes('');
    setProdSig('');
    onDataChanged?.();
    flashMsg(
      res.ok
        ? `Factory production batch ${res.record.batchNo} submitted (${res.record.totalQty} units) — awaiting Production HOD confirmation.`
        : `Saved locally (${res.error}).`
    );
  };

  const handleConfirmFactoryHod = async () => {
    if (!activeFactoryConfirm) return;
    if (!factoryHodSig) {
      flashMsg('Production HOD digital signature is required to confirm factory stock.', true);
      return;
    }
    const res = await hodConfirmSpecialOrderFactoryStock({
      entry: activeFactoryConfirm,
      hodName: currentUserName,
      hodEmail: currentUserEmail,
      hodSignature: factoryHodSig,
      hodNotes: factoryHodNotes.trim(),
    });
    setActiveFactoryConfirm(null);
    setFactoryHodNotes('');
    setFactoryHodSig('');
    onDataChanged?.();
    flashMsg(
      res.ok
        ? `Confirmed into Factory Stock (${activeFactoryConfirm.batchNo}).`
        : `Confirmed locally (${res.error}).`
    );
  };

  const handleSubmitWhDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrder || !stockSummary) return;
    if (!whTrolleyNo.trim()) {
      flashMsg('Enter Trolley / Pallet Number for WH dispatch movement.', true);
      return;
    }
    const items: SpecialOrderSizeItem[] = activeOrder.sizes
      .map((sizeLabel) => {
        const qty = Number(whSizeQtys[sizeLabel] || 0);
        const unitWeightKg = Number(whSizeUnitWt[sizeLabel] || 0) || undefined;
        const totalWeightKg =
          unitWeightKg && qty > 0 ? Number((qty * unitWeightKg).toFixed(2)) : undefined;
        return {
          sizeLabel,
          productName: buildSpecialOrderSizeProductName(activeOrder.productPrefix, sizeLabel),
          qty,
          unitWeightKg,
          totalWeightKg,
        };
      })
      .filter((i) => i.qty > 0);

    if (items.length === 0) {
      flashMsg('Enter ready dispatch quantity for at least one size.', true);
      return;
    }

    // Warn / prevent exceeding confirmed factory stock
    for (const it of items) {
      const stockRow = stockSummary.rows.find((r) => r.sizeLabel === it.sizeLabel);
      if (stockRow && it.qty > stockRow.availableInFactory) {
        flashMsg(
          `${it.sizeLabel}: Requested dispatch (${it.qty}) exceeds confirmed available factory stock (${stockRow.availableInFactory}). Confirm daily production first.`,
          true
        );
        return;
      }
    }

    if (!whShiftSig) {
      flashMsg('Shift In Charge digital signature is required to release order to WH.', true);
      return;
    }

    setSubmittingWh(true);
    const res = await submitSpecialOrderWhDispatch({
      order: activeOrder,
      date: whDate,
      shift: whShift,
      machine: whMachine,
      trolleyNo: whTrolleyNo.trim(),
      items,
      operatorName: whOperator,
      assistantName: whIsCasual ? whCasualName.trim() || 'Casual Hand' : whAssistant,
      isCasualAssistant: whIsCasual,
      casualAssistantName: whIsCasual ? whCasualName.trim() : undefined,
      shiftInChargeName: currentUserName,
      shiftInChargeSignature: whShiftSig,
      shiftNotes: whShiftNotes.trim(),
      submittedByEmail: currentUserEmail,
    });
    setSubmittingWh(false);
    setWhSizeQtys({});
    setWhTrolleyNo('');
    setWhShiftNotes('');
    setWhShiftSig('');
    onDataChanged?.();
    flashMsg(
      res.ok
        ? `Ready WH Dispatch ${res.record.dispatchRef} submitted (${res.record.totalRecordedQty} units) — WH Personnel notified.`
        : `Saved locally (${res.error}).`
    );
  };

  const openWhReceiveModal = (dsp: SpecialOrderWhDispatch) => {
    const initial: Record<string, string> = {};
    dsp.items.forEach((it) => {
      initial[it.sizeLabel] = String(it.qty);
    });
    setWhConfirmQtys(initial);
    setWhConfirmReason('');
    setWhConfirmNotes('');
    setWhConfirmSig('');
    setActiveWhConfirm(dsp);
  };

  const handleConfirmWhReceive = async () => {
    if (!activeWhConfirm) return;
    if (!whConfirmSig) {
      flashMsg('WH Personnel digital signature is required.', true);
      return;
    }

    let anyChanged = false;
    const receivedItems: SpecialOrderSizeItem[] = activeWhConfirm.items.map((it) => {
      const q = Number(whConfirmQtys[it.sizeLabel] ?? it.qty);
      if (q !== it.qty) anyChanged = true;
      const totalWeightKg =
        it.unitWeightKg && q > 0 ? Number((q * it.unitWeightKg).toFixed(2)) : it.totalWeightKg;
      return { ...it, qty: q, totalWeightKg };
    });

    if (anyChanged && !whConfirmReason.trim()) {
      flashMsg('Enter a reason for adjusting received WH quantity vs Shift quantity.', true);
      return;
    }

    const res = await whConfirmSpecialOrderDispatch({
      entry: activeWhConfirm,
      whReceivedItems: receivedItems,
      whPersonnelName: currentUserName,
      whEmail: currentUserEmail,
      whSignature: whConfirmSig,
      whNotes: whConfirmNotes.trim(),
      whQtyEditReason: whConfirmReason.trim() || undefined,
    });
    setActiveWhConfirm(null);
    setWhConfirmSig('');
    onDataChanged?.();
    flashMsg(
      res.ok
        ? `WH receipt confirmed for ${activeWhConfirm.dispatchRef} — awaiting Production HOD final approval.`
        : `Confirmed locally (${res.error}).`
    );
  };

  const handleConfirmHodFinalWh = async () => {
    if (!activeHodWhConfirm) return;
    if (!hodWhSig) {
      flashMsg('Production HOD digital signature is required for final confirmation.', true);
      return;
    }
    const res = await hodConfirmSpecialOrderWhDispatch({
      entry: activeHodWhConfirm,
      hodName: currentUserName,
      hodEmail: currentUserEmail,
      hodSignature: hodWhSig,
      hodNotes: hodWhNotes.trim(),
    });
    setActiveHodWhConfirm(null);
    setHodWhNotes('');
    setHodWhSig('');
    onDataChanged?.();
    flashMsg(
      `Final HOD Confirmed! ${res.linkedDispatchIds.length} record(s) automatically posted into Regular Dispatch Excel & Ledger.`
    );
  };

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#0F1E36]">
              <Boxes className="h-4 w-4 text-sky-700" />
              <span>Special Orders Factory Stock &amp; WH Movement</span>
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
              {activeOrder?.title || 'Special Orders'}
            </h2>
            <p className="text-xs text-slate-600">
              Daily factory production (Shift In Charge → HOD Confirm) builds Factory Stock. When ready, dispatch to WH (Shift → WH → HOD) auto-posts to Regular Dispatch Excel.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={activeOrder?.id || ''}
              onChange={(e) => setSelectedOrderId(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#0F1E36] focus:outline-none"
            >
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.orderNo} — {o.title}
                </option>
              ))}
            </select>

            {(isAdmin || canShiftWrite) && (
              <button
                type="button"
                onClick={() => setShowNewOrderModal(true)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 transition"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>New Special Order</span>
              </button>
            )}
          </div>
        </div>

        {/* KPI Strip */}
        {stockSummary && (
          <div className="mt-4 space-y-2.5 tabular-nums">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] font-medium text-slate-500">Confirmed Produced</div>
                <div className="text-lg font-bold text-slate-900">
                  {stockSummary.totalProducedConfirmed.toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="text-[11px] font-medium text-amber-800">Pending HOD (Factory)</div>
                <div className="text-lg font-bold text-amber-900">
                  {stockSummary.totalPendingFactoryHod.toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-[11px] font-medium text-emerald-800">Available in Factory</div>
                <div className="text-lg font-bold text-emerald-900">
                  {stockSummary.totalAvailableInFactory.toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                <div className="text-[11px] font-medium text-sky-800">Dispatched to WH</div>
                <div className="text-lg font-bold text-sky-900">
                  {stockSummary.totalDispatchedToWh.toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-[#0F1E36] p-3 text-white col-span-2 sm:col-span-1">
                <div className="text-[11px] font-medium text-slate-300">Confirmed in WH &amp; Dispatch</div>
                <div className="text-lg font-bold text-white">
                  {stockSummary.totalConfirmedWh.toLocaleString()}
                </div>
              </div>
            </div>

            {stockSummary.totalTargetQty > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-sky-800">
                    Total Planned Required
                  </div>
                  <div className="text-base font-black text-sky-900">
                    {stockSummary.totalTargetQty.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                    Required Stock Remaining
                  </div>
                  <div className="text-base font-black text-emerald-900">
                    {stockSummary.totalRequiredRemaining.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                    Sizes Open (Required)
                  </div>
                  <div className="text-base font-black text-emerald-800">
                    {stockSummary.openPlanCount}
                  </div>
                </div>
                <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-rose-700">
                    Sizes Closed (Red · Plan Met)
                  </div>
                  <div className="text-base font-black text-rose-700">
                    {stockSummary.closedPlanCount}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sub-navigation Tabs */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-3">
          {(
            [
              { id: 'stock', label: 'Live Factory Stock (Sizes 39–46)', icon: <Boxes className="h-3.5 w-3.5" /> },
              {
                id: 'factory_prod',
                label: '1. Daily Factory Production (Shift → HOD)',
                icon: <Factory className="h-3.5 w-3.5" />,
                badge: pendingFactoryHodCount,
              },
              {
                id: 'wh_dispatch',
                label: '2. Ready Dispatch to WH (Shift → WH → HOD)',
                icon: <Truck className="h-3.5 w-3.5" />,
                badge: pendingWhConfirmCount + pendingHodWhCount,
              },
              {
                id: 'reports',
                label: 'Factory & WH Excel Reports (Admin)',
                icon: <FileSpreadsheet className="h-3.5 w-3.5" />,
              },
            ] as Array<{
              id: SpecialOrderSubTab;
              label: string;
              icon: React.ReactNode;
              badge?: number;
            }>
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                subTab === tab.id
                  ? 'bg-[#0F1E36] text-white shadow-2xs'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {typeof tab.badge === 'number' && tab.badge > 0 && (
                <span className="rounded-full bg-rose-600 px-1.5 py-0.2 text-[10px] font-bold text-white tabular-nums">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs font-semibold flex items-center justify-between ${
            feedback.isError
              ? 'border-rose-300 bg-rose-50 text-rose-800'
              : 'border-emerald-300 bg-emerald-50 text-emerald-900'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} className="p-1">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* TAB 1: LIVE FACTORY STOCK MATRIX */}
      {subTab === 'stock' && stockSummary && activeOrder && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Stock Held in Factory by Size — {activeOrder.orderNo}
              </h3>
              <p className="text-xs text-slate-500">
                Tracks Available Factory Stock against Planned Qty Required per size. Rows turn{' '}
                <span className="font-bold text-rose-700">RED (Closed)</span> once Available Stock reaches Planned Qty, matching Monthly Planning.
              </p>
              {activeOrder.planningUpdatedAt && (
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Planning loaded by <b>{activeOrder.planningUpdatedBy || 'Admin'}</b> (
                  {activeOrder.planningSource || 'Manual'})
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canManagePlanning && (
                <button
                  type="button"
                  onClick={openPlanningModal}
                  className="flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 hover:bg-sky-100 px-3 py-1.5 text-xs font-bold text-sky-900 transition"
                >
                  <Calendar className="h-3.5 w-3.5 text-sky-700" />
                  <span>Load Planning Qty / Size</span>
                </button>
              )}
              {canShiftWrite && (
                <button
                  type="button"
                  onClick={() => setSubTab('factory_prod')}
                  className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800"
                >
                  + Log Today&apos;s Production
                </button>
              )}
              {canShiftWrite && (
                <button
                  type="button"
                  onClick={() => setSubTab('wh_dispatch')}
                  className="flex items-center gap-1 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-3 py-1.5 text-xs font-semibold text-white"
                >
                  <span>Dispatch Ready Stock to WH</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs tabular-nums">
              <thead className="bg-[#0F1E36] text-white">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">Size</th>
                  <th className="px-3 py-2.5 font-semibold">Mapped Inventory Item</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Planned Qty</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Confirmed Produced</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Pending HOD</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Moved to WH</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Available in Factory</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Required Stock</th>
                  <th className="px-3 py-2.5 font-semibold w-36">Plan Progress</th>
                  <th className="px-3 py-2.5 font-semibold text-center">Plan Flag</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {stockSummary.rows.map((r) => (
                  <tr
                    key={r.sizeLabel}
                    className={
                      r.isPlanMet
                        ? 'bg-rose-50/90 hover:bg-rose-100/80 border-l-4 border-l-rose-600 transition'
                        : 'hover:bg-slate-50 transition'
                    }
                  >
                    <td
                      className={`px-3 py-2.5 font-bold ${
                        r.isPlanMet ? 'text-rose-800' : 'text-[#0F1E36]'
                      }`}
                    >
                      {r.sizeLabel}
                    </td>
                    <td
                      className={`px-3 py-2.5 font-medium ${
                        r.isPlanMet ? 'text-rose-900 font-semibold' : 'text-slate-700'
                      }`}
                    >
                      {r.productName}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold text-sky-700">
                      {r.targetQty > 0 ? r.targetQty.toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-slate-900">
                      {r.producedConfirmed.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-amber-700">
                      {r.pendingFactoryHod.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-sky-700">
                      {r.dispatchedToWh.toLocaleString()}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-bold ${
                        r.isPlanMet
                          ? 'text-rose-800 bg-rose-100/70'
                          : 'text-emerald-700 bg-emerald-50/60'
                      }`}
                    >
                      {r.availableInFactory.toLocaleString()}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-black ${
                        r.targetQty === 0
                          ? 'text-slate-400'
                          : r.isPlanMet
                          ? 'text-rose-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      {r.targetQty > 0 ? r.requiredRemaining.toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.targetQty > 0 ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${getPlanProgressWidthClass(
                                r.planProgressPct
                              )} ${r.isPlanMet ? 'bg-rose-500' : 'bg-emerald-500'}`}
                            />
                          </div>
                          <span
                            className={`text-[10px] font-black ${
                              r.isPlanMet ? 'text-rose-700' : 'text-emerald-700'
                            }`}
                          >
                            {r.planProgressPct}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {r.targetQty === 0 ? (
                        <span className="text-[11px] font-medium text-slate-400">No Plan</span>
                      ) : r.isPlanMet ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2 py-0.5 text-[10px] font-black text-white shadow-2xs">
                          <AlertOctagon className="h-3 w-3" />
                          CLOSED — PLAN MET
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-800">
                          OPEN · {r.requiredRemaining.toLocaleString()} REQ
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-100 font-bold text-slate-900">
                  <td className="px-3 py-2.5">TOTAL</td>
                  <td className="px-3 py-2.5">{activeOrder.title}</td>
                  <td className="px-3 py-2.5 text-right text-sky-800">
                    {stockSummary.totalTargetQty > 0
                      ? stockSummary.totalTargetQty.toLocaleString()
                      : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {stockSummary.totalProducedConfirmed.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right text-amber-800">
                    {stockSummary.totalPendingFactoryHod.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right text-sky-800">
                    {stockSummary.totalDispatchedToWh.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right text-emerald-800">
                    {stockSummary.totalAvailableInFactory.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right text-emerald-900">
                    {stockSummary.totalTargetQty > 0
                      ? stockSummary.totalRequiredRemaining.toLocaleString()
                      : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-[11px]">
                    {stockSummary.totalTargetQty > 0
                      ? `${Math.min(
                          100,
                          Math.round(
                            (stockSummary.totalAvailableInFactory / stockSummary.totalTargetQty) *
                              100
                          )
                        )}%`
                      : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center text-[10px]">
                    {stockSummary.totalTargetQty > 0
                      ? `${stockSummary.closedPlanCount} RED / ${stockSummary.openPlanCount} OPEN`
                      : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: DAILY FACTORY PRODUCTION (SHIFT IN CHARGE -> HOD) */}
      {subTab === 'factory_prod' && activeOrder && (
        <div className="space-y-4">
          {canShiftWrite && (
            <form
              onSubmit={handleSubmitFactoryProd}
              className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Stage 1 (Shift In Charge): Record Daily Special Order Factory Production
                  </h3>
                  <p className="text-xs text-slate-500">
                    Writes daily output into Factory Stock holding register — Production HOD must confirm before WH dispatch.
                  </p>
                </div>
                <span className="rounded bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-[#0F1E36]">
                  {activeOrder.orderNo}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={prodDate}
                    onChange={(e) => setProdDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Shift</label>
                  <select
                    value={prodShift}
                    onChange={(e) => setProdShift(e.target.value as 'Day' | 'Night')}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    <option value="Day">Day Shift (07:30 - 19:30)</option>
                    <option value="Night">Night Shift (19:30 - 07:30)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Machine</label>
                  <select
                    value={prodMachine}
                    onChange={(e) => setProdMachine(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    {machines.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Factory Rack / Holding Batch Ref
                  </label>
                  <input
                    type="text"
                    value={prodRack}
                    onChange={(e) => setProdRack(e.target.value)}
                    placeholder="e.g. RACK-GB-01"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Operator</label>
                  <select
                    value={prodOperator}
                    onChange={(e) => setProdOperator(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    {OPERATOR_OPTIONS.map((op) => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700">Assistant</label>
                    <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={prodIsCasual}
                        onChange={(e) => setProdIsCasual(e.target.checked)}
                      />
                      Casual
                    </label>
                  </div>
                  {prodIsCasual ? (
                    <input
                      type="text"
                      value={prodCasualName}
                      onChange={(e) => setProdCasualName(e.target.value)}
                      placeholder="Casual worker full name"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                  ) : (
                    <select
                      value={prodAssistant}
                      onChange={(e) => setProdAssistant(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      {GENERAL_HAND_OPTIONS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Shift Notes</label>
                  <input
                    type="text"
                    value={prodNotes}
                    onChange={(e) => setProdNotes(e.target.value)}
                    placeholder="Optional production notes"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
              </div>

              {/* Per-Size Quantity Grid */}
              <div>
                <div className="text-xs font-bold text-slate-800 mb-2">
                  Enter Daily Produced Quantities per Size ({activeOrder.sizes.join(', ')})
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {activeOrder.sizes.map((sizeLabel) => {
                    const rowPlan = stockSummary?.rows.find((r) => r.sizeLabel === sizeLabel);
                    return (
                      <div
                        key={sizeLabel}
                        className={`rounded-lg border p-2.5 space-y-1.5 ${
                          rowPlan?.isPlanMet
                            ? 'border-rose-300 bg-rose-50/70'
                            : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold text-[#0F1E36]">{sizeLabel}</span>
                          {rowPlan && rowPlan.targetQty > 0 && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                                rowPlan.isPlanMet
                                  ? 'bg-rose-600 text-white'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {rowPlan.isPlanMet ? 'Plan Met' : `Req: ${rowPlan.requiredRemaining}`}
                            </span>
                          )}
                        </div>
                        <input
                          type="number"
                          min={0}
                          placeholder="Qty (pairs/packs)"
                          value={prodSizeQtys[sizeLabel] || ''}
                          onChange={(e) =>
                            setProdSizeQtys((prev) => ({
                              ...prev,
                              [sizeLabel]: e.target.value,
                            }))
                          }
                          className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold tabular-nums"
                        />
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          placeholder="Unit Wt (kg opt)"
                          value={prodSizeUnitWt[sizeLabel] || ''}
                          onChange={(e) =>
                            setProdSizeUnitWt((prev) => ({
                              ...prev,
                              [sizeLabel]: e.target.value,
                            }))
                          }
                          className="w-full rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] tabular-nums"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-200 pt-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSigTarget('prod_shift')}
                    className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition ${
                      prodSig
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <PenTool className="h-3.5 w-3.5" />
                    <span>
                      {prodSig
                        ? 'Shift In Charge Signed ✓'
                        : 'Capture Shift In Charge Signature *'}
                    </span>
                  </button>
                  {prodSig && (
                    <img
                      src={prodSig}
                      alt="Shift signature"
                      className="h-9 rounded border border-slate-200 bg-white px-1"
                    />
                  )}
                </div>

                <button
                  type="submit"
                  disabled={submittingProd}
                  className="flex items-center justify-center gap-2 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-5 py-2.5 text-xs font-bold text-white shadow-xs transition disabled:opacity-50"
                >
                  <ClipboardCheck className="h-4 w-4" />
                  <span>
                    {submittingProd ? 'Submitting...' : 'Submit Factory Stock to HOD'}
                  </span>
                </button>
              </div>
            </form>
          )}

          {/* Daily Factory Production History & HOD Confirmation List */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900">
              Daily Factory Production Batches ({orderProdEntries.length})
            </h3>
            {orderProdEntries.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No daily special order production batches recorded yet.
              </p>
            ) : (
              <div className="space-y-2.5">
                {orderProdEntries.map((batch) => (
                  <div
                    key={batch.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-[#0F1E36]">{batch.batchNo}</span>
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {batch.date} · {batch.shift} · Rack {batch.rackOrTrolleyNo}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                            batch.status === 'CONFIRMED_IN_FACTORY'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {batch.status === 'CONFIRMED_IN_FACTORY'
                            ? 'CONFIRMED IN FACTORY'
                            : 'PENDING HOD CONFIRMATION'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-800 font-medium">
                        Total: <b className="tabular-nums">{batch.totalQty}</b> —{' '}
                        {batch.items.map((i) => `${i.sizeLabel}: ${i.qty}`).join(' | ')}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Shift In Charge: <b>{batch.shiftInChargeName}</b> · Op: {batch.operatorName}
                        {batch.hodConfirmedByName && (
                          <>
                            {' '}
                            · HOD Confirmed: <b className="text-emerald-700">{batch.hodConfirmedByName}</b>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {batch.status === 'PENDING_HOD_FACTORY' && canHodConfirm && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveFactoryConfirm(batch);
                            setFactoryHodNotes('');
                            setFactoryHodSig('');
                          }}
                          className="flex items-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>HOD Confirm Factory Stock</span>
                        </button>
                      )}
                      {canHodConfirm && batch.status === 'PENDING_HOD_FACTORY' && (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget({ kind: 'factory', entry: batch })}
                          className="flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 px-3 py-2 text-xs font-bold text-rose-700 transition"
                          title="Delete unconfirmed Shift In Charge raised batch permanently as HOD"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Delete</span>
                        </button>
                      )}
                      {batch.status === 'CONFIRMED_IN_FACTORY' && (
                        <span
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-emerald-800"
                          title="Confirmed stock is locked and cannot be deleted"
                        >
                          <Lock className="h-3 w-3" />
                          <span>Confirmed · Locked</span>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: READY DISPATCH TO WH (SHIFT -> WH -> HOD -> AUTO REGULAR DISPATCH) */}
      {subTab === 'wh_dispatch' && activeOrder && stockSummary && (
        <div className="space-y-4">
          {canShiftWrite && (
            <form
              onSubmit={handleSubmitWhDispatch}
              className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Stage 1 (Shift In Charge): Dispatch Ready Special Order to Warehouse (WH)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Moves confirmed Factory Stock through WH Personnel → Production HOD. Upon HOD confirmation, rows auto-post into Regular Dispatch Excel.
                  </p>
                </div>
                <span className="rounded bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[11px] font-bold text-emerald-800 tabular-nums">
                  Factory Avail: {stockSummary.totalAvailableInFactory}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Dispatch Date</label>
                  <input
                    type="date"
                    value={whDate}
                    onChange={(e) => setWhDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Shift</label>
                  <select
                    value={whShift}
                    onChange={(e) => setWhShift(e.target.value as 'Day' | 'Night')}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    <option value="Day">Day Shift</option>
                    <option value="Night">Night Shift</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Machine</label>
                  <select
                    value={whMachine}
                    onChange={(e) => setWhMachine(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    {machines.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Trolley / Dispatch Pallet No. *
                  </label>
                  <input
                    type="text"
                    required
                    value={whTrolleyNo}
                    onChange={(e) => setWhTrolleyNo(e.target.value)}
                    placeholder="e.g. T-GB-09"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Operator</label>
                  <select
                    value={whOperator}
                    onChange={(e) => setWhOperator(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    {OPERATOR_OPTIONS.map((op) => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700">Assistant</label>
                    <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={whIsCasual}
                        onChange={(e) => setWhIsCasual(e.target.checked)}
                      />
                      Casual
                    </label>
                  </div>
                  {whIsCasual ? (
                    <input
                      type="text"
                      value={whCasualName}
                      onChange={(e) => setWhCasualName(e.target.value)}
                      placeholder="Casual worker full name"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                  ) : (
                    <select
                      value={whAssistant}
                      onChange={(e) => setWhAssistant(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      {GENERAL_HAND_OPTIONS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Movement Notes</label>
                  <input
                    type="text"
                    value={whShiftNotes}
                    onChange={(e) => setWhShiftNotes(e.target.value)}
                    placeholder="Order ready remarks"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {stockSummary.rows.map((row) => (
                  <div
                    key={row.sizeLabel}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#0F1E36]">{row.sizeLabel}</span>
                      <span className="text-[10px] font-semibold text-emerald-700 tabular-nums">
                        Avail: {row.availableInFactory}
                      </span>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={row.availableInFactory}
                      placeholder="Dispatch Qty"
                      value={whSizeQtys[row.sizeLabel] || ''}
                      onChange={(e) =>
                        setWhSizeQtys((prev) => ({
                          ...prev,
                          [row.sizeLabel]: e.target.value,
                        }))
                      }
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold tabular-nums"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      placeholder="Unit Wt (kg)"
                      value={whSizeUnitWt[row.sizeLabel] || ''}
                      onChange={(e) =>
                        setWhSizeUnitWt((prev) => ({
                          ...prev,
                          [row.sizeLabel]: e.target.value,
                        }))
                      }
                      className="w-full rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] tabular-nums"
                    />
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-200 pt-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSigTarget('wh_shift')}
                    className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition ${
                      whShiftSig
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <PenTool className="h-3.5 w-3.5" />
                    <span>
                      {whShiftSig
                        ? 'Shift In Charge Signed ✓'
                        : 'Capture Shift In Charge Signature *'}
                    </span>
                  </button>
                  {whShiftSig && (
                    <img
                      src={whShiftSig}
                      alt="Shift WH dispatch sign"
                      className="h-9 rounded border border-slate-200 bg-white px-1"
                    />
                  )}
                </div>

                <button
                  type="submit"
                  disabled={submittingWh}
                  className="flex items-center justify-center gap-2 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-5 py-2.5 text-xs font-bold text-white shadow-xs transition disabled:opacity-50"
                >
                  <Truck className="h-4 w-4" />
                  <span>
                    {submittingWh ? 'Submitting...' : 'Send Ready Order to WH (Stage 1)'}
                  </span>
                </button>
              </div>
            </form>
          )}

          {/* WH Dispatch Movements Queue */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900">
              Special Order Dispatches to WH ({orderWhDispatches.length})
            </h3>
            {orderWhDispatches.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No Special Order dispatches sent to WH yet.
              </p>
            ) : (
              <div className="space-y-3">
                {orderWhDispatches.map((dsp) => (
                  <div
                    key={dsp.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-[#0F1E36]">{dsp.dispatchRef}</span>
                        <span className="text-[11px] font-semibold text-slate-600">
                          Trolley #{dsp.trolleyNo} · {dsp.date} ({dsp.shift})
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                            dsp.status === 'CONFIRMED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : dsp.status === 'PENDING_HOD'
                              ? 'bg-sky-100 text-sky-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {dsp.status === 'CONFIRMED'
                            ? 'CONFIRMED & POSTED TO REGULAR DISPATCH'
                            : dsp.status === 'PENDING_HOD'
                            ? 'WH VERIFIED · AWAITING HOD'
                            : 'AWAITING WH RECEIPT'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => generateSpecialOrderMovementPdf(dsp)}
                          className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700"
                        >
                          <FileDown className="h-3.5 w-3.5 text-[#0F1E36]" />
                          <span>Voucher PDF</span>
                        </button>

                        {dsp.status === 'PENDING_WH' && canWhConfirm && (
                          <button
                            type="button"
                            onClick={() => openWhReceiveModal(dsp)}
                            className="flex items-center gap-1 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-3 py-1.5 text-xs font-bold text-white"
                          >
                            <PackageCheck className="h-3.5 w-3.5" />
                            <span>WH Verify &amp; Receive</span>
                          </button>
                        )}

                        {dsp.status === 'PENDING_HOD' && canHodConfirm && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveHodWhConfirm(dsp);
                              setHodWhNotes('');
                              setHodWhSig('');
                            }}
                            className="flex items-center gap-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            <span>HOD Final Confirm &amp; Sync Dispatch</span>
                          </button>
                        )}

                        {canHodConfirm && dsp.status !== 'CONFIRMED' && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget({ kind: 'wh', entry: dsp })}
                            className="flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 px-2.5 py-1.5 text-[11px] font-bold text-rose-700 transition"
                            title="Delete unconfirmed Shift In Charge raised WH dispatch permanently as HOD"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Delete</span>
                          </button>
                        )}
                        {dsp.status === 'CONFIRMED' && (
                          <span
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-bold text-emerald-800"
                            title="Confirmed WH dispatch is locked and cannot be deleted"
                          >
                            <Lock className="h-3 w-3" />
                            <span>Confirmed · Locked</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-xs text-slate-800">
                      <span className="font-semibold">Sizes:</span>{' '}
                      {(dsp.whReceivedItems || dsp.items)
                        .map((i) => `${i.sizeLabel}: ${i.qty}`)
                        .join(' | ')}{' '}
                      · <b className="tabular-nums">Shift Total: {dsp.totalRecordedQty}</b>
                      {typeof dsp.totalWhReceivedQty === 'number' && (
                        <>
                          {' '}
                          · <b className="text-emerald-700 tabular-nums">WH Total: {dsp.totalWhReceivedQty}</b>
                        </>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
                      <span>Shift: <b>{dsp.shiftInChargeName}</b></span>
                      <span>WH: <b>{dsp.whPersonnelName || 'Pending'}</b></span>
                      <span>HOD: <b>{dsp.hodConfirmedByName || 'Pending'}</b></span>
                      {dsp.linkedRegularDispatchIds && dsp.linkedRegularDispatchIds.length > 0 && (
                        <span className="text-emerald-700 font-semibold">
                          Linked Regular Dispatch Rows: {dsp.linkedRegularDispatchIds.length}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: TWO ADMIN-ONLY EXCEL REPORTS */}
      {subTab === 'reports' && activeOrder && stockSummary && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <h3 className="text-sm font-bold text-slate-900">
              Special Order Dual Excel Reports — {activeOrder.orderNo}
            </h3>
            <p className="text-xs text-slate-500">
              Confidential Excel exports separated cleanly between Factory Stock vs Stock Dispatched to Warehouse (WH). All Excel downloads are restricted to Administrators.
            </p>
          </div>

          {!isAdmin ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center space-y-2">
              <Lock className="h-7 w-7 text-amber-700 mx-auto" />
              <div className="text-xs font-bold text-amber-900">
                Admin Authorization Required
              </div>
              <p className="text-xs text-amber-800 max-w-md mx-auto">
                Only the Plant Administrator / Production HOD can download Special Order Factory Stock and WH Dispatched Excel reports.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-[#0F1E36]">
                  <Factory className="h-4 w-4 text-emerald-700" />
                  <span>Report 1: Stock in Factory Excel</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Exports the live per-size Factory Stock Balance matrix (Sizes 39–46) plus every daily Shift In Charge entry and Production HOD confirmation before warehouse release.
                </p>
                <div className="text-xs font-semibold text-slate-800 tabular-nums">
                  Current Factory Balance: {stockSummary.totalAvailableInFactory} units across {activeOrder.sizes.length} sizes
                </div>
                <button
                  type="button"
                  onClick={() =>
                    exportSpecialOrderFactoryStockExcel({
                      order: activeOrder,
                      prodEntries,
                      whDispatches,
                      isAdmin,
                    })
                  }
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white transition"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  <span>Download Stock in Factory Excel (.xlsx)</span>
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-[#0F1E36]">
                  <Truck className="h-4 w-4 text-sky-700" />
                  <span>Report 2: Stock Dispatched to WH Excel</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Exports all Special Order movements dispatched from Factory to WH (Shift → WH → HOD) plus linked Regular Dispatch ledger IDs automatically posted upon HOD sign-off.
                </p>
                <div className="text-xs font-semibold text-slate-800 tabular-nums">
                  Dispatched to WH: {stockSummary.totalDispatchedToWh} units ({orderWhDispatches.length} movements)
                </div>
                <button
                  type="button"
                  onClick={() =>
                    exportSpecialOrderWhDispatchedExcel({
                      order: activeOrder,
                      whDispatches,
                      isAdmin,
                    })
                  }
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-4 py-2.5 text-xs font-bold text-white transition"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  <span>Download Stock Dispatched to WH Excel (.xlsx)</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL: CREATE NEW SPECIAL ORDER */}
      {showNewOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleCreateOrder}
            className="w-full max-w-lg rounded-xl border border-slate-300 bg-white p-5 shadow-2xl space-y-3 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
              <h4 className="text-sm font-bold text-[#0F1E36]">Create New Special Order</h4>
              <button
                type="button"
                onClick={() => setShowNewOrderModal(false)}
                className="p-1 text-slate-500 hover:text-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Order Number *</label>
                <input
                  type="text"
                  required
                  value={newOrderNo}
                  onChange={(e) => setNewOrderNo(e.target.value)}
                  placeholder="e.g. SO-2026-02"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Customer / Contract</label>
                <input
                  type="text"
                  value={newCustomer}
                  onChange={(e) => setNewCustomer(e.target.value)}
                  placeholder="Client or Tender name"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Order Title *</label>
              <input
                type="text"
                required
                value={newOrderTitle}
                onChange={(e) => setNewOrderTitle(e.target.value)}
                placeholder="e.g. Heavy Duty Gum Boots Batch 2"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Product Prefix</label>
                <input
                  type="text"
                  value={newProductPrefix}
                  onChange={(e) => setNewProductPrefix(e.target.value)}
                  placeholder="GUM BOOT CAPTAIN BLACK"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Machine</label>
                <select
                  value={newOrderMachine}
                  onChange={(e) => setNewOrderMachine(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  {machines.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Sizes / Variants (Comma-separated) *
              </label>
              <input
                type="text"
                required
                value={newSizesCsv}
                onChange={(e) => setNewSizesCsv(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewOrderModal(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-[#0F1E36] px-4 py-2 font-bold text-white"
              >
                Save Special Order
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: HOD CONFIRM FACTORY PRODUCTION */}
      {activeFactoryConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-300 bg-white p-5 shadow-2xl space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
              <h4 className="text-sm font-bold text-[#0F1E36]">
                Production HOD: Confirm Factory Stock ({activeFactoryConfirm.batchNo})
              </h4>
              <button type="button" onClick={() => setActiveFactoryConfirm(null)}>
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
              <div className="font-bold text-slate-900">
                Total Units: {activeFactoryConfirm.totalQty} ({activeFactoryConfirm.date} · {activeFactoryConfirm.shift})
              </div>
              <div className="text-slate-700">
                {activeFactoryConfirm.items.map((i) => `${i.sizeLabel}: ${i.qty}`).join(' | ')}
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">HOD Confirmation Notes</label>
              <input
                type="text"
                value={factoryHodNotes}
                onChange={(e) => setFactoryHodNotes(e.target.value)}
                placeholder="Verified in factory rack"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setSigTarget('prod_hod')}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 font-semibold ${
                  factoryHodSig
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-slate-300 bg-white text-slate-800'
                }`}
              >
                <PenTool className="h-3.5 w-3.5" />
                <span>{factoryHodSig ? 'HOD Signed ✓' : 'Sign as Production HOD *'}</span>
              </button>
              <button
                type="button"
                onClick={handleConfirmFactoryHod}
                className="rounded-lg bg-emerald-700 hover:bg-emerald-600 px-4 py-2 font-bold text-white"
              >
                Confirm Factory Stock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: WH RECEIVE SPECIAL ORDER DISPATCH */}
      {activeWhConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto">
          <div className="w-full max-w-xl rounded-xl border border-slate-300 bg-white p-5 shadow-2xl space-y-3 text-xs my-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
              <h4 className="text-sm font-bold text-[#0F1E36]">
                Stage 2 (WH Personnel): Verify &amp; Receive ({activeWhConfirm.dispatchRef})
              </h4>
              <button type="button" onClick={() => setActiveWhConfirm(null)}>
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {activeWhConfirm.items.map((it) => (
                <div key={it.sizeLabel} className="rounded border border-slate-200 bg-slate-50 p-2">
                  <div className="font-bold text-[#0F1E36]">{it.sizeLabel}</div>
                  <div className="text-[10px] text-slate-500 mb-1">Shift: {it.qty}</div>
                  <input
                    type="number"
                    min={0}
                    value={whConfirmQtys[it.sizeLabel] ?? String(it.qty)}
                    onChange={(e) =>
                      setWhConfirmQtys((prev) => ({ ...prev, [it.sizeLabel]: e.target.value }))
                    }
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 font-semibold tabular-nums"
                  />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Qty Adjustment Reason (If modified)
                </label>
                <input
                  type="text"
                  value={whConfirmReason}
                  onChange={(e) => setWhConfirmReason(e.target.value)}
                  placeholder="Required only if received != shift qty"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">WH Notes</label>
                <input
                  type="text"
                  value={whConfirmNotes}
                  onChange={(e) => setWhConfirmNotes(e.target.value)}
                  placeholder="Good condition received in WH"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
            </div>
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setSigTarget('wh_receive')}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 font-semibold ${
                  whConfirmSig
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-slate-300 bg-white text-slate-800'
                }`}
              >
                <PenTool className="h-3.5 w-3.5" />
                <span>{whConfirmSig ? 'WH Signed ✓' : 'Sign as WH Personnel *'}</span>
              </button>
              <button
                type="button"
                onClick={handleConfirmWhReceive}
                className="rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-4 py-2 font-bold text-white"
              >
                Confirm WH Receipt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: HOD FINAL CONFIRM WH DISPATCH -> POSTS TO REGULAR DISPATCH */}
      {activeHodWhConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-300 bg-white p-5 shadow-2xl space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
              <h4 className="text-sm font-bold text-[#0F1E36]">
                Stage 3 (Production HOD): Final Confirm WH Dispatch ({activeHodWhConfirm.dispatchRef})
              </h4>
              <button type="button" onClick={() => setActiveHodWhConfirm(null)}>
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-900 font-medium">
              Final approval automatically posts these WH-verified quantities into Regular Dispatch Ledger, Regular Dispatch Excel, and Monthly Planning.
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
              <div className="font-bold text-slate-900">
                WH Received Total: {activeHodWhConfirm.totalWhReceivedQty ?? activeHodWhConfirm.totalRecordedQty} units
              </div>
              <div className="text-slate-700">
                {(activeHodWhConfirm.whReceivedItems || activeHodWhConfirm.items)
                  .map((i) => `${i.sizeLabel}: ${i.qty}`)
                  .join(' | ')}
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">HOD Final Remarks</label>
              <input
                type="text"
                value={hodWhNotes}
                onChange={(e) => setHodWhNotes(e.target.value)}
                placeholder="Approved for WH dispatch ledger"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setSigTarget('wh_hod')}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 font-semibold ${
                  hodWhSig
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-slate-300 bg-white text-slate-800'
                }`}
              >
                <PenTool className="h-3.5 w-3.5" />
                <span>{hodWhSig ? 'HOD Signed ✓' : 'Sign as Production HOD *'}</span>
              </button>
              <button
                type="button"
                onClick={handleConfirmHodFinalWh}
                className="rounded-lg bg-emerald-700 hover:bg-emerald-600 px-4 py-2 font-bold text-white"
              >
                Final Confirm &amp; Post to Dispatch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: LOAD PLANNING QUANTITIES PER SIZE */}
      {showPlanningModal && activeOrder && stockSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveSizePlanning}
            className="w-full max-w-2xl rounded-xl border border-slate-300 bg-white p-5 shadow-2xl space-y-4 text-xs my-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h4 className="text-sm font-bold text-[#0F1E36]">
                  Load Planning Qty Required per Size — {activeOrder.orderNo}
                </h4>
                <p className="text-[11px] text-slate-500">
                  Factory Stock tracks Available Stock against these size targets and turns RED (Closed) when Required Stock reaches 0.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPlanningModal(false)}
                className="p-1 text-slate-500 hover:text-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <button
                type="button"
                onClick={handlePullFromMonthlyPlan}
                className="flex items-center gap-1.5 rounded-lg border border-sky-300 bg-white hover:bg-sky-50 px-3 py-1.5 font-bold text-sky-900 transition"
              >
                <Calendar className="h-3.5 w-3.5 text-sky-700" />
                <span>Pull from Monthly Plan</span>
              </button>

              <input
                ref={planFileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handlePlanExcelUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => planFileInputRef.current?.click()}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white hover:bg-emerald-50 px-3 py-1.5 font-bold text-emerald-800 transition"
              >
                <Upload className="h-3.5 w-3.5 text-emerald-700" />
                <span>Import Excel / CSV Plan</span>
              </button>

              <span className="ml-auto text-[11px] text-slate-500">
                Source: <b className="text-slate-700">{planSourceNote}</b>
              </span>
            </div>

            {planImportMsg && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-semibold text-sky-900">
                {planImportMsg}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[50vh] overflow-y-auto pr-1">
              {activeOrder.sizes.map((sz) => {
                const stockRow = stockSummary.rows.find((r) => r.sizeLabel === sz);
                const avail = stockRow?.availableInFactory ?? 0;
                const draftVal = Math.max(0, Number(planDraftTargets[sz] || 0) || 0);
                const previewReq = draftVal > 0 ? Math.max(0, draftVal - avail) : 0;
                const previewClosed = draftVal > 0 && avail >= draftVal;
                return (
                  <div
                    key={sz}
                    className={`rounded-lg border p-3 flex items-center justify-between gap-3 ${
                      previewClosed
                        ? 'border-rose-300 bg-rose-50/70'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-[#0F1E36]">{sz}</div>
                      <div className="text-[10px] text-slate-500 truncate">
                        Factory Avail: <b className="text-emerald-700 tabular-nums">{avail}</b>
                        {draftVal > 0 && (
                          <>
                            {' · '}
                            {previewClosed ? (
                              <span className="font-bold text-rose-700">CLOSED (MET)</span>
                            ) : (
                              <span className="font-bold text-emerald-800 tabular-nums">
                                Req: {previewReq}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      placeholder="Planned Qty"
                      value={planDraftTargets[sz] ?? ''}
                      onChange={(e) => {
                        setPlanSourceNote('Manual Size Planning Entry');
                        setPlanDraftTargets((prev) => ({ ...prev, [sz]: e.target.value }));
                      }}
                      className="w-28 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-right font-bold tabular-nums focus:border-[#0F1E36] focus:outline-none"
                    />
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
              <button
                type="button"
                disabled={savingPlan}
                onClick={handleClearSizePlanning}
                className="rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 px-3 py-2 font-semibold text-rose-700 disabled:opacity-50"
              >
                Clear All Planning
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPlanningModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPlan}
                  className="rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-4 py-2 font-bold text-white disabled:opacity-50"
                >
                  {savingPlan ? 'Saving...' : 'Save Size Planning'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: HOD PERMANENT DELETE OF SHIFT IN CHARGE RAISED ORDER */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-rose-300 bg-white p-5 shadow-2xl space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
              <div className="flex items-center gap-2 text-rose-700">
                <Trash2 className="h-4 w-4" />
                <h4 className="text-sm font-bold">
                  HOD Delete Raised Order (Permanent)
                </h4>
              </div>
              <button type="button" onClick={() => setDeleteTarget(null)}>
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>

            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-900 space-y-1">
              <p className="font-bold">
                {deleteTarget.kind === 'factory'
                  ? `Factory Batch ${deleteTarget.entry.batchNo}`
                  : `WH Dispatch ${deleteTarget.entry.dispatchRef}`}
              </p>
              <p>
                Raised by Shift In Charge: <b>{deleteTarget.entry.shiftInChargeName}</b> (
                {deleteTarget.entry.date} · {deleteTarget.entry.shift})
              </p>
              <p>
                Items:{' '}
                {deleteTarget.entry.items.map((i) => `${i.sizeLabel}: ${i.qty}`).join(' | ')}
              </p>
            </div>

            <p className="text-slate-600 leading-relaxed">
              Deleting as HOD permanently removes this Shift In Charge order from Factory Stock, pending HOD alerts, and Excel reports across all connected devices so it will not reappear.
              {deleteTarget.kind === 'wh' &&
                deleteTarget.entry.linkedRegularDispatchIds &&
                deleteTarget.entry.linkedRegularDispatchIds.length > 0 &&
                ' Linked Regular Dispatch ledger rows will also be removed.'}
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deletingRecord}
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingRecord}
                onClick={handleConfirmDeleteRaisedOrder}
                className="flex items-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 px-4 py-2 font-bold text-white disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{deletingRecord ? 'Deleting...' : 'Delete Permanently'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REUSABLE DIGITAL SIGNATURE PAD */}
      <DigitalSignaturePad
        isOpen={sigTarget !== null}
        onClose={() => setSigTarget(null)}
        initialRole={sigTarget === 'prod_hod' || sigTarget === 'wh_hod' ? 'supervisor' : 'technician'}
        initialName={currentUserName}
        logTitle={activeOrder?.title || 'Special Order Sign-Off'}
        equipmentId={activeOrder?.orderNo || 'SPECIAL-ORDER'}
        onSaveSignature={(data) => {
          if (sigTarget === 'prod_shift') setProdSig(data.signature);
          if (sigTarget === 'prod_hod') setFactoryHodSig(data.signature);
          if (sigTarget === 'wh_shift') setWhShiftSig(data.signature);
          if (sigTarget === 'wh_receive') setWhConfirmSig(data.signature);
          if (sigTarget === 'wh_hod') setHodWhSig(data.signature);
        }}
      />
    </div>
  );
};
