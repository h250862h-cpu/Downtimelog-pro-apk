import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  Edit3,
  Eraser,
  Eye,
  FileSpreadsheet,
  FileText,
  Lock,
  PackageCheck,
  PenTool,
  Search,
  Send,
  ShieldCheck,
  Truck,
  UserCheck,
  X,
} from 'lucide-react';
import { getCurrentShift, ymd } from '../services/downtimeCalc';
import { exportDispatchExcelWorkbook, saveDispatchEntryToFirebase } from '../services/dispatchStore';
import {
  DispatchShiftWindow,
  generateShiftStockMovementPdf,
  getWindowDisplayLabel,
  getWindowShift,
} from '../services/dispatchPdf';
import { DispatchEntry, UserPermissions } from '../types';
import {
  GENERAL_HAND_OPTIONS,
  OPERATOR_OPTIONS,
  SHIFT_IN_CHARGE_OPTIONS,
  WH_PERSONNEL_OPTIONS,
} from '../types/factoryStaff';
import { MASTER_JOB_CARDS } from '../types/jobCards';
import { DispatchSubStage } from './DispatchPopupAlert';
import { LgplastLogo } from './LgplastLogo';

interface ReusableSignaturePadProps {
  label: string;
  value: string;
  onChange: (dataUrl: string) => void;
  accentColor?: 'amber' | 'emerald' | 'blue';
}

const ReusableSignaturePad: React.FC<ReusableSignaturePadProps> = ({
  label,
  value,
  onChange,
  accentColor = 'amber',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const getCoords = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
    canvas: HTMLCanvasElement
  ) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX = 0;
    let clientY = 0;
    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const { x, y } = getCoords(e, canvas);
    ctx.strokeStyle =
      accentColor === 'emerald' ? '#34d399' : accentColor === 'blue' ? '#60a5fa' : '#f59e0b';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const moveDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoords(e, canvas);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const endDraw = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      onChange(canvas.toDataURL('image/png'));
    }
  };

  const clearPad = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    onChange('');
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
          <PenTool className="h-3.5 w-3.5 text-amber-400" />
          <span>{label}</span>
          {value ? (
            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-black text-emerald-300 border border-emerald-500/30">
              SIGNED
            </span>
          ) : (
            <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold text-rose-300 border border-rose-500/30">
              REQUIRED
            </span>
          )}
        </label>
        <button
          type="button"
          onClick={clearPad}
          className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-rose-400 transition"
        >
          <Eraser className="h-3 w-3" />
          <span>Clear</span>
        </button>
      </div>
      <div className="rounded-xl border border-slate-700 bg-slate-950 overflow-hidden touch-none">
        <canvas
          ref={canvasRef}
          width={480}
          height={120}
          onMouseDown={startDraw}
          onMouseMove={moveDraw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={moveDraw}
          onTouchEnd={endDraw}
          className="w-full h-[100px] cursor-crosshair block"
        />
      </div>
      <p className="text-[10px] text-slate-500">Sign with finger or mouse above.</p>
    </div>
  );
};

interface DispatchSystemViewProps {
  machines: string[];
  dispatchEntries: DispatchEntry[];
  permissions: UserPermissions;
  isAdmin?: boolean;
  currentUserName: string;
  currentUserEmail: string;
  requestedStage?: DispatchSubStage | null;
  onStageHandled?: () => void;
}

export const DispatchSystemView: React.FC<DispatchSystemViewProps> = ({
  machines,
  dispatchEntries,
  permissions,
  isAdmin = false,
  currentUserName,
  currentUserEmail,
  requestedStage,
  onStageHandled,
}) => {
  const allowedStages = useMemo<DispatchSubStage[]>(() => {
    const list: DispatchSubStage[] = [];
    if (permissions.dispatchShiftEntry) list.push('shift');
    if (permissions.dispatchWHConfirm) list.push('wh');
    if (permissions.dispatchHODConfirm) list.push('hod');
    if (permissions.exportDispatchExcel || permissions.dispatchHODConfirm) list.push('ledger');
    return list;
  }, [permissions]);

  const [activeStage, setActiveStage] = useState<DispatchSubStage>(() => allowedStages[0] || 'shift');

  useEffect(() => {
    if (requestedStage && allowedStages.includes(requestedStage)) {
      setActiveStage(requestedStage);
      onStageHandled?.();
    } else if (!allowedStages.includes(activeStage) && allowedStages.length > 0) {
      setActiveStage(allowedStages[0]);
    }
  }, [requestedStage, allowedStages, activeStage, onStageHandled]);

  // =====================================
  // STAGE 1: SHIFT IN CHARGE FORM STATE
  // =====================================
  const shiftInfo = getCurrentShift();
  const [date, setDate] = useState<string>(ymd(new Date()));
  const [shift, setShift] = useState<'Day' | 'Night'>(shiftInfo.shift);
  const [machine, setMachine] = useState<string>(machines[0] || 'Extrusion Machine 1');
  const [productSearch, setProductSearch] = useState<string>('');
  const [product, setProduct] = useState<string>(MASTER_JOB_CARDS[0] || '');
  const [trolleyNo, setTrolleyNo] = useState<string>('');
  const [recordedQty, setRecordedQty] = useState<string>('');
  const [operatorName, setOperatorName] = useState<string>(OPERATOR_OPTIONS[0]?.value || 'FARAI MURONZWA');
  const [assistantName, setAssistantName] = useState<string>(GENERAL_HAND_OPTIONS[0]?.value || 'TRIED CHAKUBVA');
  const [isCasualAssistant, setIsCasualAssistant] = useState<boolean>(false);
  const [casualAssistantText, setCasualAssistantText] = useState<string>('');
  const [shiftInChargeName, setShiftInChargeName] = useState<string>(
    SHIFT_IN_CHARGE_OPTIONS[0]?.value || currentUserName
  );
  const [shiftNotes, setShiftNotes] = useState<string>('');
  const [shiftSignature, setShiftSignature] = useState<string>('');
  const [shiftBanner, setShiftBanner] = useState<{ text: string; isError?: boolean } | null>(null);
  const [savingShift, setSavingShift] = useState(false);

  const filteredProducts = useMemo(
    () => MASTER_JOB_CARDS.filter((p) => p.toLowerCase().includes(productSearch.toLowerCase())),
    [productSearch]
  );

  // =====================================
  // STAGE 2: WH PERSONNEL FORM STATE (PER PENDING CARD)
  // =====================================
  const [whSelectedId, setWhSelectedId] = useState<string | null>(null);
  const [whQtyInput, setWhQtyInput] = useState<string>('');
  const [whPersonnelName, setWhPersonnelName] = useState<string>(
    WH_PERSONNEL_OPTIONS[0]?.value || currentUserName
  );
  const [whNotes, setWhNotes] = useState<string>('');
  const [whSignature, setWhSignature] = useState<string>('');
  const [whBanner, setWhBanner] = useState<{ text: string; isError?: boolean } | null>(null);
  const [savingWH, setSavingWH] = useState(false);

  // STAGE 2B: WH EDIT CONFIRMED STOCK QUANTITY + REASON STATE
  const [whEditSearch, setWhEditSearch] = useState<string>('');
  const [whEditingEntryId, setWhEditingEntryId] = useState<string | null>(null);
  const [whEditQtyInput, setWhEditQtyInput] = useState<string>('');
  const [whEditReasonInput, setWhEditReasonInput] = useState<string>('');
  const [whEditPersonnelName, setWhEditPersonnelName] = useState<string>(
    WH_PERSONNEL_OPTIONS[0]?.value || currentUserName
  );
  const [savingWHEdit, setSavingWHEdit] = useState(false);
  const [whEditSavedReadyPdf, setWhEditSavedReadyPdf] = useState<DispatchEntry | null>(null);

  const pendingWHList = useMemo(
    () => dispatchEntries.filter((e) => e.status === 'PENDING_WH'),
    [dispatchEntries]
  );

  const activeWHEntry = useMemo(() => {
    if (whSelectedId) {
      const found = pendingWHList.find((e) => e.id === whSelectedId);
      if (found) return found;
    }
    return pendingWHList[0] || null;
  }, [pendingWHList, whSelectedId]);

  useEffect(() => {
    if (activeWHEntry) {
      setWhQtyInput(String(activeWHEntry.recordedQty));
      setWhNotes('');
      setWhSignature('');
    }
  }, [activeWHEntry?.id]);

  // =====================================
  // STAGE 3: PRODUCTION HOD FORM STATE
  // =====================================
  const [hodSelectedId, setHodSelectedId] = useState<string | null>(null);
  const [hodConfirmerName, setHodConfirmerName] = useState<string>(currentUserName || 'Production HOD');
  const [hodNotes, setHodNotes] = useState<string>('');
  const [hodSignature, setHodSignature] = useState<string>('');
  const [hodBanner, setHodBanner] = useState<{ text: string; isError?: boolean } | null>(null);
  const [savingHOD, setSavingHOD] = useState(false);

  const pendingHODList = useMemo(
    () => dispatchEntries.filter((e) => e.status === 'PENDING_HOD'),
    [dispatchEntries]
  );

  const activeHODEntry = useMemo(() => {
    if (hodSelectedId) {
      const found = pendingHODList.find((e) => e.id === hodSelectedId);
      if (found) return found;
    }
    return pendingHODList[0] || null;
  }, [pendingHODList, hodSelectedId]);

  // =====================================
  // STAGE 4: LEDGER & CONFIDENTIAL EXCEL REPORT
  // =====================================
  const todayStr = ymd(new Date());
  const firstOfMonthStr = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [shiftLogSearch, setShiftLogSearch] = useState<string>('');
  const [ledgerStatusFilter, setLedgerStatusFilter] = useState<'ALL' | 'CONFIRMED' | 'PENDING_HOD' | 'PENDING_WH'>('ALL');
  const [ledgerSearch, setLedgerSearch] = useState<string>('');
  const [previewEntry, setPreviewEntry] = useState<DispatchEntry | null>(null);
  const [excelNotice, setExcelNotice] = useState<string | null>(null);

  const shiftReflectedEntries = useMemo(() => {
    const q = shiftLogSearch.trim().toLowerCase();
    if (!q) return dispatchEntries;
    return dispatchEntries.filter(
      (e) =>
        e.trolleyNo.toLowerCase().includes(q) ||
        e.product.toLowerCase().includes(q) ||
        e.machine.toLowerCase().includes(q) ||
        e.operatorName.toLowerCase().includes(q) ||
        e.shiftInChargeName.toLowerCase().includes(q) ||
        (e.whPersonnelName || '').toLowerCase().includes(q) ||
        e.date.includes(q)
    );
  }, [dispatchEntries, shiftLogSearch]);

  const ledgerEntries = useMemo(() => {
    return dispatchEntries.filter((e) => {
      if (fromDate && e.date < fromDate) return false;
      if (toDate && e.date > toDate) return false;
      if (ledgerStatusFilter !== 'ALL' && e.status !== ledgerStatusFilter) return false;
      if (ledgerSearch.trim()) {
        const q = ledgerSearch.toLowerCase();
        const hit =
          e.machine.toLowerCase().includes(q) ||
          e.product.toLowerCase().includes(q) ||
          e.trolleyNo.toLowerCase().includes(q) ||
          e.operatorName.toLowerCase().includes(q) ||
          e.shiftInChargeName.toLowerCase().includes(q) ||
          (e.whPersonnelName || '').toLowerCase().includes(q) ||
          e.date.includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [dispatchEntries, fromDate, toDate, ledgerStatusFilter, ledgerSearch]);

  const confirmedCount = useMemo(
    () => dispatchEntries.filter((e) => e.status === 'CONFIRMED').length,
    [dispatchEntries]
  );

  // =====================================
  // SHIFT STOCK MOVEMENT FORM (PDF) STATE & SCHEDULE LOCK
  // =====================================
  const [pdfDate, setPdfDate] = useState<string>(() => ymd(new Date()));
  const [pdfWindow, setPdfWindow] = useState<DispatchShiftWindow>(() => {
    const mins = new Date().getHours() * 60 + new Date().getMinutes();
    if (mins < 16 * 60) return 'NIGHT_0730';
    if (mins < 19 * 60) return 'DAY_1600';
    return 'DAY_1900';
  });
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [pdfBanner, setPdfBanner] = useState<{ text: string; isError?: boolean } | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const isHodOrAdmin = permissions.dispatchHODConfirm;
  const isPureWhRole =
    permissions.dispatchWHConfirm && !permissions.dispatchShiftEntry && !permissions.dispatchHODConfirm;
  const isShiftOnlyRole = permissions.dispatchShiftEntry && !permissions.dispatchHODConfirm;

  const pdfTargetShift = getWindowShift(pdfWindow);

  const entriesForPdfWindow = useMemo(
    () => dispatchEntries.filter((e) => e.date === pdfDate && e.shift === pdfTargetShift),
    [dispatchEntries, pdfDate, pdfTargetShift]
  );

  const whConfirmedEntriesForWindow = useMemo(
    () =>
      entriesForPdfWindow.filter(
        (e) =>
          typeof e.whReceivedQty === 'number' &&
          (e.status === 'PENDING_HOD' || e.status === 'CONFIRMED')
      ),
    [entriesForPdfWindow]
  );

  const pdfScheduleCheck = useMemo(() => {
    const now = new Date(nowTick);
    const todayLocal = ymd(now);
    const nowMins = now.getHours() * 60 + now.getMinutes();

    if (pdfDate < todayLocal) {
      return { unlocked: true, reason: 'Completed past shift date unlocked per schedule.' };
    }
    if (pdfDate > todayLocal) {
      return { unlocked: false, reason: 'Locked: Cannot generate PDF for a future shift date.' };
    }
    // Same day (todayLocal) strict schedule rules: Night 07:30, Day 16:00, Day 19:00
    if (pdfWindow === 'NIGHT_0730') {
      const ok = nowMins >= 7 * 60 + 30 && nowMins < 19 * 60 + 30;
      return ok
        ? { unlocked: true, reason: 'Night Shift 07:30 schedule window is OPEN (07:30 – 19:30).' }
        : {
            unlocked: false,
            reason:
              nowMins < 7 * 60 + 30
                ? 'Locked per schedule: Night Shift PDF opens at 07:30 (end of night shift).'
                : 'Locked per schedule: Active Night Shift PDF opens at 07:30 tomorrow (select previous shift date for past records).',
          };
    }
    if (pdfWindow === 'DAY_1600') {
      const ok = nowMins >= 16 * 60;
      return ok
        ? { unlocked: true, reason: 'Day Shift 16:00 schedule window is OPEN.' }
        : {
            unlocked: false,
            reason: 'Locked per schedule: Day Shift 16:00 Dispatch PDF opens at 16:00.',
          };
    }
    // DAY_1900
    const ok = nowMins >= 19 * 60;
    return ok
      ? { unlocked: true, reason: 'Day Shift 19:00 end-of-shift schedule window is OPEN.' }
      : {
          unlocked: false,
          reason: 'Locked per schedule: Day Shift 19:00 End-of-Shift PDF opens at 19:00.',
        };
  }, [nowTick, pdfDate, pdfWindow]);

  const effectivePdfRowsCount = isPureWhRole
    ? whConfirmedEntriesForWindow.length
    : entriesForPdfWindow.length;

  const canDownloadMovementPdf = useMemo(() => {
    if (!permissions.dispatchShiftEntry && !permissions.dispatchWHConfirm && !permissions.dispatchHODConfirm) {
      return false;
    }
    if (!pdfScheduleCheck.unlocked) {
      return false;
    }
    if (isPureWhRole) {
      return whConfirmedEntriesForWindow.length > 0;
    }
    return entriesForPdfWindow.length > 0;
  }, [
    permissions.dispatchShiftEntry,
    permissions.dispatchWHConfirm,
    permissions.dispatchHODConfirm,
    isPureWhRole,
    whConfirmedEntriesForWindow.length,
    entriesForPdfWindow.length,
    pdfScheduleCheck.unlocked,
  ]);

  const handleDownloadMovementPdf = () => {
    setPdfBanner(null);

    if (!pdfScheduleCheck.unlocked) {
      setPdfBanner({
        text: pdfScheduleCheck.reason,
        isError: true,
      });
      return;
    }

    if (isPureWhRole && whConfirmedEntriesForWindow.length === 0) {
      setPdfBanner({
        text: 'Locked for WH Personnel: Please confirm received quantity for at least 1 trolley in Stage 2 before generating this PDF.',
        isError: true,
      });
      return;
    }

    if (effectivePdfRowsCount === 0) {
      setPdfBanner({
        text: `No dispatch records found for ${pdfDate} (${pdfTargetShift} Shift).`,
        isError: true,
      });
      return;
    }

    const roleLabel = isHodOrAdmin
      ? 'Production HOD / Admin'
      : isPureWhRole
      ? 'WH Personnel'
      : 'Shift In Charge';

    generateShiftStockMovementPdf({
      date: pdfDate,
      shiftWindow: pdfWindow,
      entries: dispatchEntries,
      generatedByName: currentUserName,
      generatedByRole: roleLabel,
      whConfirmedOnly: isPureWhRole,
    });

    setPdfBanner({
      text: `Downloaded LGPLAST SHIFT STOCK MOVEMENT FORM PDF (${getWindowDisplayLabel(pdfWindow)} • ${pdfDate}) with ${effectivePdfRowsCount} record(s).`,
      isError: false,
    });
  };

  // Handlers
  const handleShiftSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShiftBanner(null);

    const qtyNum = Number(recordedQty);
    if (!trolleyNo.trim()) {
      setShiftBanner({ text: 'Please enter the Trolley Number.', isError: true });
      return;
    }
    if (!recordedQty || Number.isNaN(qtyNum) || qtyNum <= 0) {
      setShiftBanner({ text: 'Please enter a valid positive Quantity Recorded.', isError: true });
      return;
    }
    const finalAssistant = isCasualAssistant ? casualAssistantText.trim() : assistantName;
    if (!finalAssistant) {
      setShiftBanner({ text: 'Please select or enter the Assistant / General Hand name.', isError: true });
      return;
    }
    if (!shiftSignature) {
      setShiftBanner({ text: 'Shift In Charge digital signature is required before submitting.', isError: true });
      return;
    }

    setSavingShift(true);
    try {
      const entry: DispatchEntry = {
        id: `DSP-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
        date,
        shift,
        machine,
        product: product || MASTER_JOB_CARDS[0],
        trolleyNo: trolleyNo.trim().toUpperCase(),
        recordedQty: qtyNum,
        operatorName,
        assistantName: finalAssistant,
        isCasualAssistant,
        shiftInChargeName,
        shiftInChargeSignature: shiftSignature,
        shiftNotes: shiftNotes.trim() || undefined,
        shiftSubmittedAt: new Date().toISOString(),
        shiftSubmittedByEmail: currentUserEmail,
        status: 'PENDING_WH',
        upd: Date.now(),
      };

      const res = await saveDispatchEntryToFirebase(entry);
      setTrolleyNo('');
      setRecordedQty('');
      setShiftNotes('');
      setShiftSignature('');
      setCasualAssistantText('');
      setShiftBanner({
        text: res.ok
          ? `Dispatch ${entry.trolleyNo} (${entry.recordedQty} units) logged & Pop-up Message sent to WH Personnel!`
          : `Saved locally (${entry.trolleyNo}); cloud retry queued (${res.error || 'offline'}).`,
        isError: false,
      });
    } finally {
      setSavingShift(false);
    }
  };

  const handleWHConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWHEntry) return;
    setWhBanner(null);

    const whQtyNum = Number(whQtyInput);
    if (whQtyInput === '' || Number.isNaN(whQtyNum) || whQtyNum < 0) {
      setWhBanner({ text: 'Please enter the exact Quantity Received by WH.', isError: true });
      return;
    }
    if (whQtyNum !== activeWHEntry.recordedQty && !whNotes.trim()) {
      setWhBanner({
        text: `WH Qty (${whQtyNum}) differs from Shift Qty (${activeWHEntry.recordedQty}). Please enter a Reason in the WH Stock Qty Reason / Notes box.`,
        isError: true,
      });
      return;
    }
    if (!whPersonnelName.trim()) {
      setWhBanner({ text: 'Please select WH Personnel Name.', isError: true });
      return;
    }
    if (!whSignature) {
      setWhBanner({ text: 'WH Personnel signature is required to confirm receipt.', isError: true });
      return;
    }

    setSavingWH(true);
    try {
      const hasVariance = whQtyNum !== activeWHEntry.recordedQty;
      const updated: DispatchEntry = {
        ...activeWHEntry,
        whReceivedQty: whQtyNum,
        whPersonnelName: whPersonnelName.trim(),
        whSignature,
        whNotes: whNotes.trim() || undefined,
        whQtyEditReason: hasVariance ? whNotes.trim() : undefined,
        whConfirmedAt: new Date().toISOString(),
        whConfirmedByEmail: currentUserEmail,
        status: 'PENDING_HOD',
        upd: Date.now(),
      };

      const res = await saveDispatchEntryToFirebase(updated);
      setWhSelectedId(null);
      setWhSignature('');
      setWhNotes('');
      setWhBanner({
        text: res.ok
          ? `WH Confirmed Trolley #${updated.trolleyNo} (Received: ${whQtyNum}). Pop-up Message sent to Production HOD & unlocked for PDF!`
          : `Confirmed locally (#${updated.trolleyNo}); syncing to cloud.`,
        isError: false,
      });
    } finally {
      setSavingWH(false);
    }
  };

  const whConfirmedReceiptsList = useMemo(() => {
    const confirmed = dispatchEntries.filter(
      (e) => e.status === 'PENDING_HOD' || e.status === 'CONFIRMED'
    );
    if (!whEditSearch.trim()) return confirmed;
    const q = whEditSearch.toLowerCase();
    return confirmed.filter(
      (e) =>
        e.trolleyNo.toLowerCase().includes(q) ||
        e.product.toLowerCase().includes(q) ||
        e.machine.toLowerCase().includes(q) ||
        (e.whPersonnelName || '').toLowerCase().includes(q)
    );
  }, [dispatchEntries, whEditSearch]);

  const activeWHEditEntry = useMemo(
    () => dispatchEntries.find((e) => e.id === whEditingEntryId) || null,
    [dispatchEntries, whEditingEntryId]
  );

  const handleOpenWHEdit = (item: DispatchEntry) => {
    setWhEditingEntryId(item.id);
    setWhEditQtyInput(String(item.whReceivedQty ?? item.recordedQty));
    setWhEditReasonInput('');
    setWhEditPersonnelName(item.whPersonnelName || WH_PERSONNEL_OPTIONS[0]?.value || currentUserName);
    setWhEditSavedReadyPdf(null);
    setWhBanner(null);
  };

  const handleSaveWHQtyEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWHEditEntry) return;
    setWhBanner(null);

    const nextQty = Number(whEditQtyInput);
    if (whEditQtyInput === '' || Number.isNaN(nextQty) || nextQty < 0) {
      setWhBanner({ text: 'Please enter a valid updated WH Stock Quantity.', isError: true });
      return;
    }
    const reason = whEditReasonInput.trim();
    if (reason.length < 3) {
      setWhBanner({
        text: 'Please enter a clear Reason explaining why WH is editing this stock quantity.',
        isError: true,
      });
      return;
    }

    const prevQty =
      typeof activeWHEditEntry.whReceivedQty === 'number'
        ? activeWHEditEntry.whReceivedQty
        : activeWHEditEntry.recordedQty;
    const editedAt = new Date().toISOString();
    const editorName = whEditPersonnelName.trim() || currentUserName;

    setSavingWHEdit(true);
    try {
      const updatedHistory = [
        ...(activeWHEditEntry.whQtyEditHistory || []),
        {
          previousQty: prevQty,
          newQty: nextQty,
          reason,
          editedBy: editorName,
          editedAt,
        },
      ];

      const updated: DispatchEntry = {
        ...activeWHEditEntry,
        whPreviousReceivedQty: prevQty,
        whReceivedQty: nextQty,
        whPersonnelName: editorName,
        whQtyEditReason: reason,
        whQtyEditedAt: editedAt,
        whQtyEditedBy: editorName,
        whNotes: reason,
        whQtyEditHistory: updatedHistory,
        status: 'PENDING_HOD',
        upd: Date.now(),
      };

      const res = await saveDispatchEntryToFirebase(updated);

      // Sync PDF selector cleanly to this entry's date & shift so WH can immediately generate PDF
      setPdfDate(updated.date);
      if (updated.shift === 'Night') {
        setPdfWindow('NIGHT_0730');
      } else if (pdfWindow === 'NIGHT_0730') {
        setPdfWindow('DAY_1600');
      }

      setWhEditingEntryId(null);
      setWhEditReasonInput('');
      setWhEditSavedReadyPdf(updated);
      setWhBanner({
        text: res.ok
          ? `Updated Trolley #${updated.trolleyNo} WH Stock Qty (${prevQty} → ${nextQty}) with reason "${reason}". Ready to generate LGPLAST PDF!`
          : `Updated locally (#${updated.trolleyNo}: ${prevQty} → ${nextQty}); syncing to cloud. Ready for PDF.`,
        isError: false,
      });
    } finally {
      setSavingWHEdit(false);
    }
  };

  const handleHODFinalConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeHODEntry) return;
    setHodBanner(null);

    if (!hodConfirmerName.trim()) {
      setHodBanner({ text: 'Production HOD / Confirmer name is required.', isError: true });
      return;
    }
    if (!hodSignature) {
      setHodBanner({ text: 'Production HOD digital signature is required for final confirmation.', isError: true });
      return;
    }

    setSavingHOD(true);
    try {
      const updated: DispatchEntry = {
        ...activeHODEntry,
        hodConfirmedByName: hodConfirmerName.trim(),
        hodConfirmedByEmail: currentUserEmail,
        hodSignature,
        hodNotes: hodNotes.trim() || undefined,
        hodConfirmedAt: new Date().toISOString(),
        status: 'CONFIRMED',
        upd: Date.now(),
      };

      const res = await saveDispatchEntryToFirebase(updated);
      setHodSelectedId(null);
      setHodSignature('');
      setHodNotes('');
      setHodBanner({
        text: res.ok
          ? `Final Confirmation Complete! Trolley #${updated.trolleyNo} permanently logged into Confidential Dispatch Excel.`
          : `Final confirmation saved locally (#${updated.trolleyNo}); syncing to cloud.`,
        isError: false,
      });
    } finally {
      setSavingHOD(false);
    }
  };

  const handleDownloadDispatchExcel = () => {
    if (!isAdmin && !permissions.exportDispatchExcel) {
      setExcelNotice('Confidentiality Lock: Only Admin-authorized staff can download Dispatch Excel reports.');
      return;
    }
    const effectiveFrom = fromDate || '2020-01-01';
    const effectiveTo = toDate || '2099-12-31';
    exportDispatchExcelWorkbook(dispatchEntries, effectiveFrom, effectiveTo);
    setExcelNotice(
      `Confidential Dispatch Excel (.xlsx) downloaded (${fromDate || 'All Dates'} to ${toDate || 'Latest'}).`
    );
  };

  if (allowedStages.length === 0) {
    return (
      <div className="rounded-2xl border border-rose-500/40 bg-slate-900/90 p-8 text-center space-y-2">
        <Lock className="h-10 w-10 text-rose-400 mx-auto" />
        <h3 className="text-base font-bold text-white">Dispatch Section Restricted</h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Your account does not currently have access to any Dispatch workflow stage. Please contact the Plant Administrator to grant permissions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header & Stage Workflow Pipeline */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <LgplastLogo size="sm" showSubtitle={false} />
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-slate-950">
                <Truck className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-black text-white">
                  LGPLAST 3-Stage Dispatch Verification System
                </h2>
                <p className="text-xs text-slate-400">
                  1. Shift In Charge Logs → 2. WH Personnel Confirms / Edits Qty &amp; Signs → 3. Production HOD Final Confirm → PDF / Excel
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
            <span className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-300">
              Pending WH: {pendingWHList.length}
            </span>
            <span className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-blue-300">
              Pending HOD: {pendingHODList.length}
            </span>
            <span className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
              Confirmed: {confirmedCount}
            </span>
          </div>
        </div>

        {/* Permitted Stage Tabs */}
        <div className="mt-3 flex flex-wrap gap-2">
          {permissions.dispatchShiftEntry && (
            <button
              type="button"
              onClick={() => setActiveStage('shift')}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeStage === 'shift'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'border border-slate-700 bg-slate-950 text-slate-300 hover:text-white'
              }`}
            >
              <Send className="h-3.5 w-3.5" />
              <span>1. Shift In Charge (Record)</span>
            </button>
          )}

          {permissions.dispatchWHConfirm && (
            <button
              type="button"
              onClick={() => setActiveStage('wh')}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeStage === 'wh'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'border border-slate-700 bg-slate-950 text-slate-300 hover:text-white'
              }`}
            >
              <ClipboardCheck className="h-3.5 w-3.5" />
              <span>2. WH Personnel (Confirm Qty)</span>
              {pendingWHList.length > 0 && (
                <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white">
                  {pendingWHList.length}
                </span>
              )}
            </button>
          )}

          {permissions.dispatchHODConfirm && (
            <button
              type="button"
              onClick={() => setActiveStage('hod')}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeStage === 'hod'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'border border-slate-700 bg-slate-950 text-slate-300 hover:text-white'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>3. Production HOD (Final Confirm)</span>
              {pendingHODList.length > 0 && (
                <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-black text-slate-950">
                  {pendingHODList.length}
                </span>
              )}
            </button>
          )}

          {(permissions.exportDispatchExcel || permissions.dispatchHODConfirm) && (
            <button
              type="button"
              onClick={() => setActiveStage('ledger')}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeStage === 'ledger'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'border border-slate-700 bg-slate-950 text-slate-300 hover:text-white'
              }`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Dispatch Ledger &amp; Excel Report</span>
            </button>
          )}
        </div>
      </div>

      {/* ================================================= */}
      {/* SHARED DISPATCH FORM PDF: LGPLAST MOVEMENT FORM   */}
      {/* ================================================= */}
      <div className="rounded-2xl border border-amber-500/30 bg-slate-900/95 p-4 sm:p-5 shadow-lg space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-start sm:items-center gap-3">
            <div className="shrink-0 rounded-xl bg-amber-500 px-3 py-1.5 text-center shadow">
              <div className="text-xs font-black tracking-wider text-slate-950 leading-none">
                LGPLAST
              </div>
              <div className="text-[8px] font-bold tracking-tight text-slate-900 mt-0.5">
                DISPATCH PDF
              </div>
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-white flex flex-wrap items-center gap-2">
                <FileText className="h-4 w-4 text-amber-400" />
                <span>SHIFT STOCK MOVEMENT FORM (PDF Only)</span>
              </h3>
              <p className="text-[11px] text-slate-400">
                {isPureWhRole
                  ? 'WH Personnel can download this official dispatch movement PDF ONLY after confirming trolley quantities (excludes unconfirmed trolleys).'
                  : isShiftOnlyRole
                  ? 'Shift In Charge schedule: Night Shift unlocks at 07:30 • Day Shift unlocks at 16:00 & 19:00 to share matching trolley records with WH.'
                  : 'Generate the official LGPLAST Shift Stock Movement Form PDF with all trolleys, quantities, and signatures.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-[10px] font-bold text-slate-300">
              <Clock className="h-3 w-3 text-amber-400" />
              <span>
                Now:{' '}
                {new Date(nowTick).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}
              </span>
            </span>
            <span
              className={`rounded-lg border px-2.5 py-1 text-[10px] font-black uppercase ${
                canDownloadMovementPdf
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
              }`}
            >
              {isPureWhRole
                ? `WH Confirmed: ${whConfirmedEntriesForWindow.length} / ${entriesForPdfWindow.length}`
                : `Records: ${entriesForPdfWindow.length}`}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
              Shift Date
            </label>
            <input
              type="date"
              value={pdfDate}
              onChange={(e) => {
                setPdfDate(e.target.value);
                setPdfBanner(null);
              }}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-white focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="lg:col-span-2">
            <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
              Dispatch Schedule Window
            </label>
            <select
              value={pdfWindow}
              onChange={(e) => {
                setPdfWindow(e.target.value as DispatchShiftWindow);
                setPdfBanner(null);
              }}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-white focus:border-amber-500 focus:outline-none"
            >
              <option value="NIGHT_0730">Night Shift Closing — 07:30 (Night Shift Trolleys)</option>
              <option value="DAY_1600">Day Shift Dispatch — 16:00 (Day Shift Trolleys)</option>
              <option value="DAY_1900">Day Shift End-of-Shift — 19:00 (Day Shift Trolleys)</option>
            </select>
          </div>

          <div>
            <button
              type="button"
              onClick={handleDownloadMovementPdf}
              disabled={!canDownloadMovementPdf}
              className={`w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-black shadow-md transition ${
                canDownloadMovementPdf
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 cursor-pointer'
                  : 'border border-slate-700 bg-slate-800 text-slate-400 cursor-not-allowed opacity-75'
              }`}
            >
              {canDownloadMovementPdf ? (
                <Download className="h-4 w-4" />
              ) : (
                <Lock className="h-4 w-4 text-rose-400" />
              )}
              <span>Download Movement PDF</span>
            </button>
          </div>
        </div>

        {/* Live Gate / Eligibility Status Line */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2">
          <div className="flex items-center gap-2">
            {!pdfScheduleCheck.unlocked ? (
              <>
                <Lock className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                <span className="text-rose-300 font-semibold">{pdfScheduleCheck.reason}</span>
              </>
            ) : isPureWhRole && whConfirmedEntriesForWindow.length === 0 ? (
              <>
                <Lock className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                <span className="text-rose-300 font-semibold">
                  Schedule window open, but WH Confirmation Required: Confirm at least 1 trolley quantity for {pdfDate} ({pdfTargetShift} Shift) to unlock PDF export.
                </span>
              </>
            ) : effectivePdfRowsCount === 0 ? (
              <>
                <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span className="text-amber-300 font-semibold">
                  Window open per schedule, but 0 trolley records logged for {pdfDate} ({pdfTargetShift} Shift).
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span className="text-emerald-300 font-semibold">
                  {pdfScheduleCheck.reason} ({effectivePdfRowsCount} trolley record(s) ready
                  {isPureWhRole && entriesForPdfWindow.length > whConfirmedEntriesForWindow.length
                    ? `; ${entriesForPdfWindow.length - whConfirmedEntriesForWindow.length} awaiting WH confirmation excluded`
                    : ''}
                  ).
                </span>
              </>
            )}
          </div>

          <span className="text-[10px] text-slate-500">
            Format: LGPLAST Logo + SHIFT STOCK MOVEMENT FORM (A4 PDF)
          </span>
        </div>

        {pdfBanner && (
          <div
            className={`flex items-center gap-2 rounded-xl border p-2.5 text-xs font-semibold ${
              pdfBanner.isError
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            }`}
          >
            {pdfBanner.isError ? (
              <AlertCircle className="h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            )}
            <span>{pdfBanner.text}</span>
          </div>
        )}
      </div>

      {/* ================================================= */}
      {/* STAGE 1: SHIFT IN CHARGE FORM                     */}
      {/* ================================================= */}
      {activeStage === 'shift' && permissions.dispatchShiftEntry && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-6 shadow-md">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Send className="h-4 w-4 text-amber-400" />
                  <span>Stage 1: Shift In Charge Dispatch Recording Form</span>
                </h3>
                <p className="text-xs text-slate-400">
                  All machine, product, operator, and assistant dropdowns are linked directly from the Downtime Logger. Submitting alerts WH Personnel immediately.
                </p>
              </div>
              <span className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-[10px] font-bold text-amber-300">
                PERMANENT AUDIT ENTRY
              </span>
            </div>

            {shiftBanner && (
              <div
                className={`mb-4 flex items-center gap-2 rounded-xl border p-3 text-xs font-semibold ${
                  shiftBanner.isError
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                }`}
              >
                {shiftBanner.isError ? (
                  <AlertCircle className="h-4 w-4 shrink-0" />
                ) : (
                  <Bell className="h-4 w-4 shrink-0 text-emerald-400" />
                )}
                <span>{shiftBanner.text}</span>
              </div>
            )}

            <form onSubmit={handleShiftSubmit} className="space-y-4">
              {/* Row 1: Date, Shift, Machine Name, Trolley Number */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Dispatch Date
                  </label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Shift
                  </label>
                  <select
                    value={shift}
                    onChange={(e) => setShift(e.target.value as 'Day' | 'Night')}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white focus:border-amber-500 focus:outline-none"
                  >
                    <option value="Day">Day Shift (07:30 - 19:30)</option>
                    <option value="Night">Night Shift (19:30 - 07:30)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Machine Name (Downtime Logger)
                  </label>
                  <select
                    value={machine}
                    onChange={(e) => setMachine(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white focus:border-amber-500 focus:outline-none"
                  >
                    {machines.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Trolley Number *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. TR-014"
                    value={trolleyNo}
                    onChange={(e) => setTrolleyNo(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm font-mono uppercase text-amber-300 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Row 2: Product Dispatched (with Search Filter) & Quantity Recorded */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="lg:col-span-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[11px] font-bold text-slate-300">
                      Product Dispatched (Job Card Catalogue)
                    </label>
                    <div className="relative w-44 sm:w-56">
                      <Search className="h-3 w-3 text-slate-500 absolute left-2.5 top-2" />
                      <input
                        type="text"
                        placeholder="Filter products..."
                        value={productSearch}
                        onChange={(e) => {
                          const q = e.target.value;
                          setProductSearch(q);
                          const match = MASTER_JOB_CARDS.find((c) =>
                            c.toLowerCase().includes(q.toLowerCase())
                          );
                          if (match) setProduct(match);
                        }}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-7 pr-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <select
                    value={product}
                    onChange={(e) => setProduct(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white focus:border-amber-500 focus:outline-none"
                  >
                    {(filteredProducts.length > 0 ? filteredProducts : MASTER_JOB_CARDS).map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">
                    Quantity Recorded by Shift In Charge *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    placeholder="e.g. 250"
                    value={recordedQty}
                    onChange={(e) => setRecordedQty(e.target.value)}
                    className="w-full rounded-xl border border-amber-500/40 bg-slate-950 px-3 py-2 text-sm font-black text-amber-300 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Row 3: Operator, Assistant/General Hand, Shift In Charge Name */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Operator Name (Downtime Logger)
                  </label>
                  <select
                    value={operatorName}
                    onChange={(e) => setOperatorName(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white focus:border-amber-500 focus:outline-none"
                  >
                    {OPERATOR_OPTIONS.map((op) => (
                      <option key={op.label} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-slate-300">
                      Assistant / General Hand
                    </label>
                    <label className="flex items-center gap-1 text-[10px] text-amber-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isCasualAssistant}
                        onChange={(e) => setIsCasualAssistant(e.target.checked)}
                        className="rounded border-slate-600 bg-slate-950 text-amber-500"
                      />
                      <span>Casual</span>
                    </label>
                  </div>
                  {isCasualAssistant ? (
                    <input
                      type="text"
                      placeholder="Enter casual assistant name..."
                      value={casualAssistantText}
                      onChange={(e) => setCasualAssistantText(e.target.value)}
                      className="w-full rounded-xl border border-amber-500/40 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white focus:border-amber-500 focus:outline-none"
                    />
                  ) : (
                    <select
                      value={assistantName}
                      onChange={(e) => setAssistantName(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white focus:border-amber-500 focus:outline-none"
                    >
                      {GENERAL_HAND_OPTIONS.map((gh) => (
                        <option key={gh.label} value={gh.value}>
                          {gh.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Shift In Charge Name
                  </label>
                  <select
                    value={shiftInChargeName}
                    onChange={(e) => setShiftInChargeName(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white focus:border-amber-500 focus:outline-none"
                  >
                    {SHIFT_IN_CHARGE_OPTIONS.map((sic) => (
                      <option key={sic.label} value={sic.value}>
                        {sic.label}
                      </option>
                    ))}
                    {!SHIFT_IN_CHARGE_OPTIONS.some((x) => x.value === currentUserName) && (
                      <option value={currentUserName}>{currentUserName} (Logged In)</option>
                    )}
                  </select>
                </div>
              </div>

              {/* Row 4: Notes & Shift In Charge Signature */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Shift Notes / Remarks (Optional)
                  </label>
                  <textarea
                    rows={4}
                    placeholder="Optional packaging, bundle count, or trolley notes..."
                    value={shiftNotes}
                    onChange={(e) => setShiftNotes(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <ReusableSignaturePad
                  label="Shift In Charge Digital Signature *"
                  value={shiftSignature}
                  onChange={setShiftSignature}
                  accentColor="amber"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={savingShift}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 px-6 py-2.5 text-xs sm:text-sm font-black text-slate-950 shadow-lg transition disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  <span>
                    {savingShift ? 'Submitting & Alerting WH...' : 'Submit Dispatch & Send Message to WH'}
                  </span>
                </button>
              </div>
            </form>
          </div>

          {/* All Dispatches Reflected Live (No Truncation / No Delete) */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  All Dispatches Entered (Live Plant Feed · {shiftReflectedEntries.length} of {dispatchEntries.length})
                </h4>
                <p className="text-[11px] text-slate-400">
                  Every trolley dispatch entered across devices reflects here in real time. PDF exports remain gated to schedule times (07:30, 16:00, 19:00).
                </p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-2" />
                <input
                  type="text"
                  placeholder="Filter trolley, product, machine, date..."
                  value={shiftLogSearch}
                  onChange={(e) => setShiftLogSearch(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>
            {shiftReflectedEntries.length === 0 ? (
              <p className="text-xs text-slate-500">No dispatches matching your search yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[460px] overflow-y-auto pr-1">
                {shiftReflectedEntries.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-amber-300 font-mono">
                          {item.trolleyNo}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {item.date} ({item.shift})
                        </span>
                      </div>
                      <div className="text-xs font-bold text-white truncate">{item.product}</div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {item.machine} • SIC: {item.shiftInChargeName} • Qty: <b className="text-amber-300">{item.recordedQty}</b>
                        {typeof item.whReceivedQty === 'number' && (
                          <>
                            {' '}
                            → WH: <b className="text-emerald-400">{item.whReceivedQty}</b>
                          </>
                        )}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-black uppercase border ${
                        item.status === 'CONFIRMED'
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                          : item.status === 'PENDING_HOD'
                          ? 'border-blue-500/40 bg-blue-500/15 text-blue-300'
                          : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                      }`}
                    >
                      {item.status === 'CONFIRMED'
                        ? 'Confirmed'
                        : item.status === 'PENDING_HOD'
                        ? 'With HOD'
                        : 'With WH'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================= */}
      {/* STAGE 2: WH PERSONNEL CONFIRMATION SECTION        */}
      {/* ================================================= */}
      {activeStage === 'wh' && permissions.dispatchWHConfirm && (
        <div className="space-y-5">
          {whBanner && (
            <div
              className={`flex items-center gap-2 rounded-xl border p-3 text-xs font-semibold ${
                whBanner.isError
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              {whBanner.isError ? (
                <AlertCircle className="h-4 w-4 shrink-0" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              )}
              <span>{whBanner.text}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Left Queue of Incoming Shift In Charge Messages */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h3 className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                  <Bell className="h-4 w-4" />
                  <span>Incoming Dispatch Messages ({pendingWHList.length})</span>
                </h3>
              </div>

              {pendingWHList.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-center text-xs text-slate-400">
                  <PackageCheck className="h-8 w-8 text-emerald-500/60 mx-auto mb-2" />
                  All Shift In Charge dispatches have been confirmed by WH!
                </div>
              ) : (
                <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                  {pendingWHList.map((item) => {
                    const isSelected = activeWHEntry?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setWhSelectedId(item.id)}
                        className={`w-full text-left rounded-xl border p-3 transition ${
                          isSelected
                            ? 'border-blue-500 bg-blue-500/10 shadow-md'
                            : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black font-mono text-amber-300">
                            Trolley #{item.trolleyNo}
                          </span>
                          <span className="text-[10px] font-bold text-slate-400">
                            {item.date} • {item.shift}
                          </span>
                        </div>
                        <div className="text-xs font-bold text-white mt-1 truncate">
                          {item.product}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 flex items-center justify-between">
                          <span>{item.machine}</span>
                          <span className="font-black text-amber-400">
                            Qty: {item.recordedQty}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right WH Receipt Confirmation Panel (Side-by-Side Qty + WH Signature) */}
            <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-6">
              {!activeWHEntry ? (
                <div className="h-full flex flex-col items-center justify-center py-12 text-center text-slate-400">
                  <ClipboardCheck className="h-12 w-12 text-slate-600 mb-3" />
                  <p className="text-sm font-bold text-slate-300">No Pending WH Dispatches</p>
                  <p className="text-xs text-slate-500 mt-1">
                    When Shift In Charge submits a trolley dispatch, a pop-up message will appear here automatically.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleWHConfirm} className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div>
                      <h3 className="text-base font-bold text-white">
                        Confirm Receipt: Trolley #{activeWHEntry.trolleyNo}
                      </h3>
                      <p className="text-xs text-slate-400">
                        Verify physical quantity received next to Shift In Charge count and sign below.
                      </p>
                    </div>
                    <span className="rounded-lg bg-amber-500/15 border border-amber-500/40 px-2.5 py-1 text-[11px] font-black text-amber-300">
                      AWAITING WH CONFIRMATION
                    </span>
                  </div>

                  {/* Shift In Charge Details Summary */}
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase font-bold">Date / Shift</div>
                      <div className="font-bold text-white">
                        {activeWHEntry.date} ({activeWHEntry.shift})
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase font-bold">Machine</div>
                      <div className="font-bold text-white">{activeWHEntry.machine}</div>
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <div className="text-[10px] text-slate-500 uppercase font-bold">Product</div>
                      <div className="font-bold text-blue-300">{activeWHEntry.product}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase font-bold">Operator</div>
                      <div className="text-slate-200 font-semibold">{activeWHEntry.operatorName}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase font-bold">Assistant</div>
                      <div className="text-slate-200 font-semibold">
                        {activeWHEntry.assistantName}
                        {activeWHEntry.isCasualAssistant ? ' (Casual)' : ''}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase font-bold">Shift In Charge</div>
                      <div className="text-amber-300 font-bold">{activeWHEntry.shiftInChargeName}</div>
                    </div>
                  </div>

                  {/* Side-by-Side Quantity Recorded vs WH Quantity Received */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 items-center">
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                      <div className="text-[10px] font-bold uppercase text-slate-400">
                        Qty Recorded (Shift In Charge)
                      </div>
                      <div className="text-2xl font-black text-amber-400 mt-1">
                        {activeWHEntry.recordedQty}
                      </div>
                    </div>

                    <div className="rounded-xl border border-emerald-500/40 bg-slate-950 p-3">
                      <label className="block text-[10px] font-bold uppercase text-emerald-300 mb-1">
                        WH Qty Received (Enter Count) *
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        required
                        value={whQtyInput}
                        onChange={(e) => setWhQtyInput(e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xl font-black text-emerald-300 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                      <div className="text-[10px] font-bold uppercase text-slate-400">
                        Live Variance (WH - Shift)
                      </div>
                      {(() => {
                        const diff = (Number(whQtyInput) || 0) - activeWHEntry.recordedQty;
                        return (
                          <div
                            className={`text-xl font-black mt-1 ${
                              diff === 0
                                ? 'text-emerald-400'
                                : diff < 0
                                ? 'text-rose-400'
                                : 'text-amber-300'
                            }`}
                          >
                            {diff === 0 ? '0 (Exact Match)' : diff > 0 ? `+${diff} Over` : `${diff} Short`}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* WH Personnel Name, Notes & Signature */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-300 mb-1">
                          WH Personnel Name *
                        </label>
                        <select
                          value={whPersonnelName}
                          onChange={(e) => setWhPersonnelName(e.target.value)}
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white focus:border-blue-500 focus:outline-none"
                        >
                          {WH_PERSONNEL_OPTIONS.map((wh) => (
                            <option key={wh.label} value={wh.value}>
                              {wh.label}
                            </option>
                          ))}
                          {!WH_PERSONNEL_OPTIONS.some((x) => x.value === currentUserName) && (
                            <option value={currentUserName}>{currentUserName} (Logged In)</option>
                          )}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-300 mb-1">
                          WH Stock Qty Reason / Verification Notes{' '}
                          {Number(whQtyInput) !== activeWHEntry.recordedQty ? (
                            <span className="text-amber-400 font-black">* (Required for qty difference)</span>
                          ) : (
                            '(Optional)'
                          )}
                        </label>
                        <textarea
                          rows={3}
                          placeholder="Reason for stock quantity variance, damaged items, or storage bay notes..."
                          value={whNotes}
                          onChange={(e) => setWhNotes(e.target.value)}
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <ReusableSignaturePad
                      label="WH Personnel Signature *"
                      value={whSignature}
                      onChange={setWhSignature}
                      accentColor="blue"
                    />
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={savingWH}
                      className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 px-6 py-2.5 text-xs sm:text-sm font-black text-white shadow-lg transition disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>
                        {savingWH
                          ? 'Saving WH Confirmation...'
                          : 'Confirm Qty & Send Message to Production HOD'}
                      </span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* Direct PDF Shortcut After Editing WH Stock Qty (Respects Schedule Lock) */}
          {whEditSavedReadyPdf && (
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-emerald-200">
                <div className="font-black text-emerald-300">
                  Stock Qty Updated on Trolley #{whEditSavedReadyPdf.trolleyNo} ({whEditSavedReadyPdf.whPreviousReceivedQty ?? whEditSavedReadyPdf.recordedQty} → {whEditSavedReadyPdf.whReceivedQty})
                </div>
                <div>Reason recorded: "{whEditSavedReadyPdf.whQtyEditReason}"</div>
                {!pdfScheduleCheck.unlocked && (
                  <div className="text-[11px] text-amber-300 mt-1 font-semibold">
                    {pdfScheduleCheck.reason}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleDownloadMovementPdf}
                disabled={!canDownloadMovementPdf}
                className={`shrink-0 flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-black shadow-md transition ${
                  canDownloadMovementPdf
                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                    : 'border border-slate-700 bg-slate-800 text-slate-400 cursor-not-allowed opacity-75'
                }`}
              >
                {canDownloadMovementPdf ? <FileText className="h-4 w-4" /> : <Lock className="h-4 w-4 text-rose-400" />}
                <span>{canDownloadMovementPdf ? 'Generate Updated LGPLAST PDF' : 'PDF Locked Until Schedule'}</span>
              </button>
            </div>
          )}

          {/* Inline WH Confirmed Stock Qty + Reason Editor */}
          {activeWHEditEntry && (
            <form
              onSubmit={handleSaveWHQtyEdit}
              className="rounded-2xl border border-blue-500/50 bg-slate-900 p-4 sm:p-5 shadow-xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h4 className="text-sm font-black text-white flex items-center gap-2">
                    <Edit3 className="h-4 w-4 text-blue-400" />
                    <span>
                      Edit WH Confirmed Stock Qty — Trolley #{activeWHEditEntry.trolleyNo}
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    {activeWHEditEntry.date} ({activeWHEditEntry.shift} Shift) • {activeWHEditEntry.machine} • {activeWHEditEntry.product}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setWhEditingEntryId(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <div className="text-[10px] font-bold uppercase text-slate-400">
                    Shift Recorded Qty
                  </div>
                  <div className="text-lg font-black text-amber-300 mt-0.5">
                    {activeWHEditEntry.recordedQty}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <div className="text-[10px] font-bold uppercase text-slate-400">
                    Current WH Stock Qty
                  </div>
                  <div className="text-lg font-black text-blue-300 mt-0.5">
                    {activeWHEditEntry.whReceivedQty ?? activeWHEditEntry.recordedQty}
                  </div>
                </div>
                <div className="rounded-xl border border-emerald-500/40 bg-slate-950 p-3">
                  <label className="block text-[10px] font-bold uppercase text-emerald-300 mb-1">
                    New Edited WH Stock Qty *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={whEditQtyInput}
                    onChange={(e) => setWhEditQtyInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-base font-black text-emerald-300 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    WH Personnel Editing *
                  </label>
                  <select
                    value={whEditPersonnelName}
                    onChange={(e) => setWhEditPersonnelName(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                  >
                    {WH_PERSONNEL_OPTIONS.map((wh) => (
                      <option key={wh.label} value={wh.value}>
                        {wh.label}
                      </option>
                    ))}
                    {!WH_PERSONNEL_OPTIONS.some((x) => x.value === currentUserName) && (
                      <option value={currentUserName}>{currentUserName} (Logged In)</option>
                    )}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Reason for Stock Quantity Edit * (Printed on PDF &amp; Excel Audit)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Recounted short bundle on pallet / Found 15 extra pcs / Corrected count entry..."
                    value={whEditReasonInput}
                    onChange={(e) => setWhEditReasonInput(e.target.value)}
                    className="w-full rounded-xl border border-amber-500/40 bg-slate-950 px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setWhEditingEntryId(null)}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingWHEdit}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 px-5 py-2 text-xs font-black text-white shadow-md transition disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{savingWHEdit ? 'Saving Qty Edit...' : 'Save Stock Qty & Reason'}</span>
                </button>
              </div>
            </form>
          )}

          {/* WH Confirmed Receipts & Stock Qty Adjustment Log */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  WH Confirmed Stock Receipts ({whConfirmedReceiptsList.length})
                </h4>
                <p className="text-[11px] text-slate-500">
                  WH Personnel can edit any confirmed stock quantity with a reason, then download the updated LGPLAST PDF above.
                </p>
              </div>
              <div className="relative w-full sm:w-56">
                <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-2" />
                <input
                  type="text"
                  placeholder="Filter trolley or product..."
                  value={whEditSearch}
                  onChange={(e) => setWhEditSearch(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {whConfirmedReceiptsList.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                No WH-confirmed stock receipts yet.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-[500px] overflow-y-auto pr-1">
                {whConfirmedReceiptsList.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs space-y-2 flex flex-col justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-black text-amber-300">
                          #{item.trolleyNo} • {item.date} ({item.shift})
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${
                            item.status === 'CONFIRMED'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-blue-500/20 text-blue-300'
                          }`}
                        >
                          {item.status === 'CONFIRMED' ? 'HOD Confirmed' : 'Sent to HOD'}
                        </span>
                      </div>
                      <div className="font-bold text-white truncate">{item.product}</div>
                      <div className="text-[11px] text-slate-400">
                        Shift: <b className="text-amber-300">{item.recordedQty}</b> • WH Stock:{' '}
                        <b className="text-emerald-400">{item.whReceivedQty}</b> ({item.whPersonnelName})
                      </div>
                      {item.whQtyEditReason && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
                          <b>Edit Reason:</b> {item.whQtyEditReason}
                          {typeof item.whPreviousReceivedQty === 'number' && (
                            <span className="text-amber-400">
                              {' '}
                              (Was {item.whPreviousReceivedQty})
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleOpenWHEdit(item)}
                      className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 px-2.5 py-1.5 text-[11px] font-bold text-blue-300 transition"
                    >
                      <Edit3 className="h-3 w-3" />
                      <span>Edit Stock Qty &amp; Reason</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================= */}
      {/* STAGE 3: PRODUCTION HOD FINAL CONFIRMATION        */}
      {/* ================================================= */}
      {activeStage === 'hod' && permissions.dispatchHODConfirm && (
        <div className="space-y-5">
          {hodBanner && (
            <div
              className={`flex items-center gap-2 rounded-xl border p-3 text-xs font-semibold ${
                hodBanner.isError
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              {hodBanner.isError ? (
                <AlertCircle className="h-4 w-4 shrink-0" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              )}
              <span>{hodBanner.text}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Queue awaiting Production HOD confirmation */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h3 className="text-xs font-black uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4" />
                  <span>Awaiting HOD Final Confirm ({pendingHODList.length})</span>
                </h3>
              </div>

              {pendingHODList.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-center text-xs text-slate-400">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500/60 mx-auto mb-2" />
                  No dispatches awaiting Production HOD final confirmation.
                </div>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                  {pendingHODList.map((item) => {
                    const isSelected = activeHODEntry?.id === item.id;
                    const diff = (item.whReceivedQty ?? 0) - item.recordedQty;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setHodSelectedId(item.id)}
                        className={`w-full text-left rounded-xl border p-3 transition ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-500/10 shadow-md'
                            : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black font-mono text-amber-300">
                            Trolley #{item.trolleyNo}
                          </span>
                          <span
                            className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                              diff === 0
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-rose-500/20 text-rose-300'
                            }`}
                          >
                            {diff === 0 ? 'Match' : `Var: ${diff > 0 ? `+${diff}` : diff}`}
                          </span>
                        </div>
                        <div className="text-xs font-bold text-white mt-1 truncate">{item.product}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Shift: <b className="text-amber-300">{item.recordedQty}</b> → WH:{' '}
                          <b className="text-emerald-400">{item.whReceivedQty}</b>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Side-by-Side Shift + WH Audit Review & Final HOD Signature */}
            <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-6">
              {!activeHODEntry ? (
                <div className="h-full flex flex-col items-center justify-center py-12 text-center text-slate-400">
                  <ShieldCheck className="h-12 w-12 text-slate-600 mb-3" />
                  <p className="text-sm font-bold text-slate-300">All WH Receipts Reviewed</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Once WH Personnel confirms a trolley, it pops up here for Production HOD final sign-off into Excel.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleHODFinalConfirm} className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div>
                      <h3 className="text-base font-bold text-white">
                        Final Approval: Trolley #{activeHODEntry.trolleyNo} — {activeHODEntry.product}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {activeHODEntry.date} ({activeHODEntry.shift} Shift) • {activeHODEntry.machine}
                      </p>
                    </div>
                    <span className="rounded-lg border border-blue-500/40 bg-blue-500/15 px-2.5 py-1 text-[10px] font-black text-blue-300">
                      WH CONFIRMED → READY FOR HOD
                    </span>
                  </div>

                  {/* Two-Column Comparison: Shift In Charge vs WH Personnel */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Shift Section */}
                    <div className="rounded-xl border border-amber-500/30 bg-slate-950 p-3.5 space-y-2 text-xs">
                      <div className="text-[11px] font-black uppercase text-amber-400">
                        Section 1: Shift In Charge Record
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Qty Recorded:</span>
                        <span className="text-base font-black text-amber-300">
                          {activeHODEntry.recordedQty}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Shift In Charge:</span>
                        <span className="font-bold text-white">{activeHODEntry.shiftInChargeName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Operator:</span>
                        <span className="text-slate-200">{activeHODEntry.operatorName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Assistant:</span>
                        <span className="text-slate-200">{activeHODEntry.assistantName}</span>
                      </div>
                      {activeHODEntry.shiftInChargeSignature && (
                        <div className="pt-1 border-t border-slate-800">
                          <div className="text-[10px] text-slate-500 mb-1">Shift Signature:</div>
                          <img
                            src={activeHODEntry.shiftInChargeSignature}
                            alt="Shift Signature"
                            className="h-12 rounded bg-slate-900 border border-slate-800 p-1"
                          />
                        </div>
                      )}
                    </div>

                    {/* WH Section */}
                    <div className="rounded-xl border border-blue-500/30 bg-slate-950 p-3.5 space-y-2 text-xs">
                      <div className="text-[11px] font-black uppercase text-blue-400">
                        Section 2: WH Personnel Verification
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">WH Qty Received:</span>
                        <span className="text-base font-black text-emerald-400">
                          {activeHODEntry.whReceivedQty}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Variance:</span>
                        {(() => {
                          const diff =
                            (activeHODEntry.whReceivedQty ?? 0) - activeHODEntry.recordedQty;
                          return (
                            <span
                              className={`font-black ${
                                diff === 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {diff === 0 ? '0 (Exact Match)' : diff > 0 ? `+${diff}` : diff}
                            </span>
                          );
                        })()}
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">WH Personnel:</span>
                        <span className="font-bold text-white">{activeHODEntry.whPersonnelName}</span>
                      </div>
                      {activeHODEntry.whQtyEditReason && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
                          <b>WH Qty Edit Reason:</b> {activeHODEntry.whQtyEditReason}
                          {typeof activeHODEntry.whPreviousReceivedQty === 'number' && (
                            <span className="text-amber-400">
                              {' '}
                              (Previous: {activeHODEntry.whPreviousReceivedQty})
                            </span>
                          )}
                        </div>
                      )}
                      {activeHODEntry.whNotes && activeHODEntry.whNotes !== activeHODEntry.whQtyEditReason && (
                        <div className="text-[11px] text-slate-300 italic">
                          Note: "{activeHODEntry.whNotes}"
                        </div>
                      )}
                      {activeHODEntry.whSignature && (
                        <div className="pt-1 border-t border-slate-800">
                          <div className="text-[10px] text-slate-500 mb-1">WH Signature:</div>
                          <img
                            src={activeHODEntry.whSignature}
                            alt="WH Signature"
                            className="h-12 rounded bg-slate-900 border border-slate-800 p-1"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* HOD Final Sign-Off Inputs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-300 mb-1">
                          Production HOD / Admin Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={hodConfirmerName}
                          onChange={(e) => setHodConfirmerName(e.target.value)}
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white focus:border-emerald-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-300 mb-1">
                          Production HOD Final Remarks (Optional)
                        </label>
                        <textarea
                          rows={3}
                          placeholder="Final authorization remarks..."
                          value={hodNotes}
                          onChange={(e) => setHodNotes(e.target.value)}
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <ReusableSignaturePad
                      label="Production HOD Final Signature *"
                      value={hodSignature}
                      onChange={setHodSignature}
                      accentColor="emerald"
                    />
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={savingHOD}
                      className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 px-6 py-2.5 text-xs sm:text-sm font-black text-slate-950 shadow-lg transition disabled:opacity-50"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      <span>
                        {savingHOD
                          ? 'Logging to Confirmed Ledger...'
                          : 'Final Confirm & Log Into Dispatch Excel'}
                      </span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================= */}
      {/* STAGE 4: CONFIRMED LEDGER & CONFIDENTIAL EXCEL    */}
      {/* ================================================= */}
      {activeStage === 'ledger' && (permissions.exportDispatchExcel || permissions.dispatchHODConfirm) && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
                  <span>Confirmed Dispatch Excel Ledger (All Sections)</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Confidential audit trail combining Shift In Charge, WH Personnel, and Production HOD signatures. No records can be deleted.
                </p>
              </div>

              {isAdmin && permissions.exportDispatchExcel ? (
                <button
                  type="button"
                  onClick={handleDownloadDispatchExcel}
                  className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 text-xs font-black text-white shadow-md transition"
                >
                  <Download className="h-4 w-4" />
                  <span>Download Dispatch Excel (.xlsx)</span>
                </button>
              ) : (
                <div className="flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300">
                  <Lock className="h-4 w-4" />
                  <span>Excel Download Locked (Admin Confidentiality)</span>
                </div>
              )}
            </div>

            {excelNotice && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs font-semibold text-emerald-300">
                {excelNotice}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                }}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                  !fromDate && !toDate
                    ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                    : 'border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800'
                }`}
              >
                All Dispatches ({dispatchEntries.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setFromDate(todayStr);
                  setToDate(todayStr);
                }}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] font-bold text-slate-300 hover:bg-slate-800"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => {
                  setFromDate(firstOfMonthStr);
                  setToDate(todayStr);
                }}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] font-bold text-slate-300 hover:bg-slate-800"
              >
                This Month
              </button>
            </div>

            {/* Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  From Date
                </label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  To Date
                </label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  Workflow Status
                </label>
                <select
                  value={ledgerStatusFilter}
                  onChange={(e) => setLedgerStatusFilter(e.target.value as any)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                >
                  <option value="ALL">All Dispatches</option>
                  <option value="CONFIRMED">Confirmed (Logged to Excel)</option>
                  <option value="PENDING_HOD">Awaiting Production HOD</option>
                  <option value="PENDING_WH">Awaiting WH Personnel</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  Search Trolley / Product / Staff
                </label>
                <input
                  type="text"
                  placeholder="Search..."
                  value={ledgerSearch}
                  onChange={(e) => setLedgerSearch(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                />
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-[10px] font-black uppercase text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-2.5">Date / Shift</th>
                    <th className="px-3 py-2.5">Trolley</th>
                    <th className="px-3 py-2.5">Machine &amp; Product</th>
                    <th className="px-3 py-2.5">Operator / Assistant</th>
                    <th className="px-3 py-2.5 text-right">Shift Qty</th>
                    <th className="px-3 py-2.5 text-right">WH Qty</th>
                    <th className="px-3 py-2.5 text-right">Var</th>
                    <th className="px-3 py-2.5">WH Signed</th>
                    <th className="px-3 py-2.5">HOD Final</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5 text-center">Audit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 bg-slate-900/50">
                  {ledgerEntries.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-8 text-center text-slate-500">
                        No dispatch records match the selected date range and filters.
                      </td>
                    </tr>
                  ) : (
                    ledgerEntries.map((item) => {
                      const hasWH = typeof item.whReceivedQty === 'number';
                      const variance = hasWH ? item.whReceivedQty! - item.recordedQty : null;
                      return (
                        <tr key={item.id} className="hover:bg-slate-800/40 transition">
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <div className="font-bold text-slate-200">{item.date}</div>
                            <div className="text-[10px] text-slate-400">{item.shift}</div>
                          </td>
                          <td className="px-3 py-2.5 font-mono font-black text-amber-300 whitespace-nowrap">
                            {item.trolleyNo}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="font-bold text-white">{item.product}</div>
                            <div className="text-[10px] text-slate-400">
                              {item.machine} • SIC: {item.shiftInChargeName}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="text-slate-200">{item.operatorName}</div>
                            <div className="text-[10px] text-slate-400">{item.assistantName}</div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-black text-amber-300">
                            {item.recordedQty}
                          </td>
                          <td className="px-3 py-2.5 text-right font-black text-emerald-400">
                            {hasWH ? item.whReceivedQty : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-bold">
                            {variance === null ? (
                              '—'
                            ) : (
                              <span
                                className={
                                  variance === 0 ? 'text-emerald-400' : 'text-rose-400'
                                }
                              >
                                {variance > 0 ? `+${variance}` : variance}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-slate-300">
                            {item.whPersonnelName || 'Pending'}
                          </td>
                          <td className="px-3 py-2.5 text-slate-300">
                            {item.hodConfirmedByName || 'Pending'}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span
                              className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase border ${
                                item.status === 'CONFIRMED'
                                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                  : item.status === 'PENDING_HOD'
                                  ? 'border-blue-500/40 bg-blue-500/15 text-blue-300'
                                  : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                              }`}
                            >
                              {item.status === 'CONFIRMED'
                                ? 'CONFIRMED'
                                : item.status === 'PENDING_HOD'
                                ? 'PENDING HOD'
                                : 'PENDING WH'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => setPreviewEntry(item)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-200 hover:bg-slate-700"
                            >
                              <Eye className="h-3 w-3" />
                              <span>View</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Signature & Full 3-Section Audit Modal */}
      {previewEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-black text-white">
                  Dispatch Audit Certificate — Trolley #{previewEntry.trolleyNo}
                </h3>
                <p className="text-xs text-slate-400">
                  {previewEntry.date} ({previewEntry.shift}) • {previewEntry.machine} • {previewEntry.product}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewEntry(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="rounded-xl border border-amber-500/30 bg-slate-950 p-3 space-y-2">
                <div className="font-black text-amber-400 uppercase text-[10px]">
                  1. Shift In Charge
                </div>
                <div>Qty Recorded: <b className="text-amber-300">{previewEntry.recordedQty}</b></div>
                <div>Name: <b>{previewEntry.shiftInChargeName}</b></div>
                <div>Operator: <b>{previewEntry.operatorName}</b></div>
                <div>Assistant: <b>{previewEntry.assistantName}</b></div>
                {previewEntry.shiftInChargeSignature && (
                  <img
                    src={previewEntry.shiftInChargeSignature}
                    alt="Shift Sign"
                    className="h-12 w-full object-contain rounded bg-slate-900 border border-slate-800"
                  />
                )}
              </div>

              <div className="rounded-xl border border-blue-500/30 bg-slate-950 p-3 space-y-2">
                <div className="font-black text-blue-400 uppercase text-[10px]">
                  2. WH Personnel
                </div>
                <div>
                  Qty Received:{' '}
                  <b className="text-emerald-400">{previewEntry.whReceivedQty ?? 'Pending'}</b>
                </div>
                <div>Name: <b>{previewEntry.whPersonnelName || 'Pending'}</b></div>
                {previewEntry.whQtyEditReason && (
                  <div className="rounded bg-amber-500/10 border border-amber-500/30 p-1.5 text-[10px] text-amber-200">
                    <b>Qty Edit Reason:</b> {previewEntry.whQtyEditReason}
                  </div>
                )}
                {previewEntry.whNotes && previewEntry.whNotes !== previewEntry.whQtyEditReason && (
                  <div className="italic text-slate-400">{previewEntry.whNotes}</div>
                )}
                {previewEntry.whSignature && (
                  <img
                    src={previewEntry.whSignature}
                    alt="WH Sign"
                    className="h-12 w-full object-contain rounded bg-slate-900 border border-slate-800"
                  />
                )}
              </div>

              <div className="rounded-xl border border-emerald-500/30 bg-slate-950 p-3 space-y-2">
                <div className="font-black text-emerald-400 uppercase text-[10px]">
                  3. Production HOD
                </div>
                <div>Status: <b>{previewEntry.status}</b></div>
                <div>Confirmer: <b>{previewEntry.hodConfirmedByName || 'Pending'}</b></div>
                {previewEntry.hodNotes && <div className="italic text-slate-400">{previewEntry.hodNotes}</div>}
                {previewEntry.hodSignature && (
                  <img
                    src={previewEntry.hodSignature}
                    alt="HOD Sign"
                    className="h-12 w-full object-contain rounded bg-slate-900 border border-slate-800"
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
