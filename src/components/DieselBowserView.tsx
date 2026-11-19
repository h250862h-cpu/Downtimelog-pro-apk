import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eraser,
  FileSpreadsheet,
  FileText,
  Fuel,
  Gauge,
  Lock,
  PackagePlus,
  PenTool,
  Send,
  Settings,
  ShieldCheck,
  Truck,
  Unlock,
  XCircle,
} from 'lucide-react';
import {
  approveFuelRequestAndUnlockPdf,
  dispenseFuelWithMeterReadings,
  exportDieselExcelWorkbook,
  recordFuelGrnAndTopUpTank,
  rejectFuelRequest,
  saveDieselTankConfig,
  submitFuelRequest,
} from '../services/dieselStore';
import { generateFuelGrnPdf, generateFuelRequestApprovalPdf } from '../services/dieselPdf';
import { getCurrentShift, r2, ymd } from '../services/downtimeCalc';
import {
  DieselFuelRequest,
  DieselGrnRecord,
  DieselTankConfig,
  UserPermissions,
} from '../types';
import { DieselSubTab } from './DieselPopupAlert';
import { LgplastLogo } from './LgplastLogo';

interface DieselSignaturePadProps {
  label: string;
  value: string;
  onChange: (dataUrl: string) => void;
  accentColor?: 'amber' | 'emerald' | 'sky';
}

const DieselSignaturePad: React.FC<DieselSignaturePadProps> = ({
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
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  };

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const { x, y } = getCoords(e, canvas);
    ctx.strokeStyle =
      accentColor === 'emerald' ? '#34d399' : accentColor === 'sky' ? '#38bdf8' : '#f59e0b';
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
          height={110}
          onMouseDown={startDraw}
          onMouseMove={moveDraw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={moveDraw}
          onTouchEnd={endDraw}
          className="w-full h-[92px] cursor-crosshair block"
        />
      </div>
    </div>
  );
};

function getProgressWidthClass(pct: number): string {
  if (pct <= 0) return 'w-0';
  if (pct < 12) return 'w-1/12';
  if (pct < 20) return 'w-1/6';
  if (pct < 30) return 'w-1/4';
  if (pct < 40) return 'w-1/3';
  if (pct < 55) return 'w-1/2';
  if (pct < 70) return 'w-2/3';
  if (pct < 80) return 'w-3/4';
  if (pct < 90) return 'w-5/6';
  if (pct < 98) return 'w-11/12';
  return 'w-full';
}

const VEHICLE_OPTIONS = [
  'Forklift 1 (Toyota 3T)',
  'Forklift 2 (Heavy 5T)',
  'Forklift 3 (Warehouse)',
  'Factory Standby Generator',
  'LG PLAST Delivery Truck',
  'Other Plant Equipment',
];

interface DieselBowserViewProps {
  tank: DieselTankConfig;
  requests: DieselFuelRequest[];
  grns: DieselGrnRecord[];
  permissions: UserPermissions;
  isAdmin: boolean;
  currentUserName: string;
  currentUserEmail: string;
  requestedSubTab?: DieselSubTab | null;
  onSubTabHandled?: () => void;
}

export const DieselBowserView: React.FC<DieselBowserViewProps> = ({
  tank,
  requests,
  grns,
  permissions,
  isAdmin,
  currentUserName,
  currentUserEmail,
  requestedSubTab,
  onSubTabHandled,
}) => {
  const canRequestFuel = isAdmin || Boolean(permissions.dieselFuelRequest);
  const canHodApprove = isAdmin || Boolean(permissions.dieselHODApprove);
  const canGrn = isAdmin || Boolean(permissions.dieselGRN);
  const canExportExcel = isAdmin;

  const allowedSubTabs = useMemo<DieselSubTab[]>(() => {
    const list: DieselSubTab[] = [];
    if (canRequestFuel) list.push('request');
    if (canHodApprove) list.push('hod_approve');
    if (canRequestFuel || canHodApprove) list.push('dispense');
    if (canGrn) list.push('grn');
    list.push('ledger');
    return list;
  }, [canRequestFuel, canHodApprove, canGrn]);

  const [subTab, setSubTab] = useState<DieselSubTab>(() => allowedSubTabs[0] || 'request');

  useEffect(() => {
    if (requestedSubTab && allowedSubTabs.includes(requestedSubTab)) {
      setSubTab(requestedSubTab);
      onSubTabHandled?.();
    } else if (!allowedSubTabs.includes(subTab) && allowedSubTabs.length > 0) {
      setSubTab(allowedSubTabs[0]);
    }
  }, [requestedSubTab, allowedSubTabs, subTab, onSubTabHandled]);

  const shiftInfo = getCurrentShift();
  const todayStr = ymd(new Date());

  // Tank calibration modal/card (Admin only)
  const [showCalibrate, setShowCalibrate] = useState(false);
  const [calCap, setCalCap] = useState(String(tank.capacityLitres));
  const [calLevel, setCalLevel] = useState(String(tank.currentLevelLitres));
  const [calMeter, setCalMeter] = useState(String(tank.currentMeterReading));
  const [savingCal, setSavingCal] = useState(false);

  // Stage 1: Fuel Request Form State
  const [reqDate, setReqDate] = useState(todayStr);
  const [reqShift, setReqShift] = useState<'Day' | 'Night'>(shiftInfo.shift);
  const [reqVehicle, setReqVehicle] = useState(VEHICLE_OPTIONS[0]);
  const [reqCustomVehicle, setReqCustomVehicle] = useState('');
  const [reqDriverName, setReqDriverName] = useState(currentUserName || 'Forklift Driver');
  const [reqLitres, setReqLitres] = useState('');
  const [reqPurpose, setReqPurpose] = useState('Warehouse Loading & Scrap Yard Handling');
  const [reqSignature, setReqSignature] = useState('');
  const [reqBanner, setReqBanner] = useState<{ text: string; isError?: boolean } | null>(null);
  const [savingReq, setSavingReq] = useState(false);

  // Stage 2: HOD Approval + 1-Time PDF State
  const pendingHodList = useMemo(
    () => requests.filter((r) => r.status === 'PENDING_HOD'),
    [requests]
  );
  const [selectedHodId, setSelectedHodId] = useState<string | null>(null);
  const activeHodReq = useMemo(
    () => pendingHodList.find((r) => r.id === selectedHodId) || pendingHodList[0] || null,
    [pendingHodList, selectedHodId]
  );
  const [hodNameInput, setHodNameInput] = useState(currentUserName || 'Production HOD');
  const [hodApprovedLitresInput, setHodApprovedLitresInput] = useState('');
  const [hodNotesInput, setHodNotesInput] = useState('');
  const [hodSignature, setHodSignature] = useState('');
  const [hodBanner, setHodBanner] = useState<{ text: string; isError?: boolean } | null>(null);
  const [savingHod, setSavingHod] = useState(false);

  useEffect(() => {
    if (activeHodReq) {
      setHodApprovedLitresInput(String(activeHodReq.requestedLitres));
      setHodNotesInput('');
      setHodSignature('');
    }
  }, [activeHodReq?.id]);

  // Stage 3: Driver Bowser Meter Dispense State (Unlocked only after Stage 2 PDF)
  const unlockedDispenseList = useMemo(
    () =>
      requests.filter(
        (r) =>
          r.status === 'APPROVED_FOR_DISPENSE' &&
          r.pdfGeneratedOnce === true &&
          r.pdfUnlockedDispense === true
      ),
    [requests]
  );
  const [selectedDispenseId, setSelectedDispenseId] = useState<string | null>(null);
  const activeDispenseReq = useMemo(
    () =>
      unlockedDispenseList.find((r) => r.id === selectedDispenseId) ||
      unlockedDispenseList[0] ||
      null,
    [unlockedDispenseList, selectedDispenseId]
  );
  const [firstMeterInput, setFirstMeterInput] = useState(String(tank.currentMeterReading));
  const [secondMeterInput, setSecondMeterInput] = useState('');
  const [dispenseSignature, setDispenseSignature] = useState('');
  const [dispenseBanner, setDispenseBanner] = useState<{ text: string; isError?: boolean } | null>(
    null
  );
  const [savingDispense, setSavingDispense] = useState(false);

  useEffect(() => {
    setFirstMeterInput(String(tank.currentMeterReading));
    setSecondMeterInput('');
    setDispenseSignature('');
  }, [activeDispenseReq?.id, tank.currentMeterReading]);

  const liveDispenseTaken = useMemo(() => {
    const f = Number(firstMeterInput);
    const s = Number(secondMeterInput);
    if (Number.isNaN(f) || Number.isNaN(s) || s <= f) return 0;
    return r2(s - f);
  }, [firstMeterInput, secondMeterInput]);

  // Stage 4: Fuel GRN State
  const [grnDate, setGrnDate] = useState(todayStr);
  const [grnShift, setGrnShift] = useState<'Day' | 'Night'>(shiftInfo.shift);
  const [grnSupplier, setGrnSupplier] = useState('');
  const [grnDeliveryNote, setGrnDeliveryNote] = useState('');
  const [grnReceiver, setGrnReceiver] = useState(currentUserName || 'Receiving Officer');
  const [grnFirstMeter, setGrnFirstMeter] = useState(String(tank.currentMeterReading));
  const [grnSecondMeter, setGrnSecondMeter] = useState('');
  const [grnUnitPrice, setGrnUnitPrice] = useState('');
  const [grnNotes, setGrnNotes] = useState('');
  const [grnSupplierSig, setGrnSupplierSig] = useState('');
  const [grnReceiverSig, setGrnReceiverSig] = useState('');
  const [grnBanner, setGrnBanner] = useState<{ text: string; isError?: boolean } | null>(null);
  const [savingGrn, setSavingGrn] = useState(false);

  useEffect(() => {
    setGrnFirstMeter(String(tank.currentMeterReading));
  }, [tank.currentMeterReading]);

  const liveGrnLitresAdded = useMemo(() => {
    const f = Number(grnFirstMeter);
    const s = Number(grnSecondMeter);
    if (Number.isNaN(f) || Number.isNaN(s) || s <= f) return 0;
    return r2(s - f);
  }, [grnFirstMeter, grnSecondMeter]);

  // Stage 5: Ledger & Excel Filter State
  const [ledgerFrom, setLedgerFrom] = useState('');
  const [ledgerTo, setLedgerTo] = useState('');
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerBanner, setLedgerBanner] = useState<string | null>(null);

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (ledgerFrom && r.date < ledgerFrom) return false;
      if (ledgerTo && r.date > ledgerTo) return false;
      if (ledgerSearch.trim()) {
        const q = ledgerSearch.toLowerCase();
        const hit =
          r.requestNo.toLowerCase().includes(q) ||
          r.vehicleOrForklift.toLowerCase().includes(q) ||
          r.driverName.toLowerCase().includes(q) ||
          (r.hodApprovedBy || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [requests, ledgerFrom, ledgerTo, ledgerSearch]);

  const filteredGrns = useMemo(() => {
    return grns.filter((g) => {
      if (ledgerFrom && g.date < ledgerFrom) return false;
      if (ledgerTo && g.date > ledgerTo) return false;
      if (ledgerSearch.trim()) {
        const q = ledgerSearch.toLowerCase();
        const hit =
          g.grnNo.toLowerCase().includes(q) ||
          g.supplierName.toLowerCase().includes(q) ||
          g.receiverName.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [grns, ledgerFrom, ledgerTo, ledgerSearch]);

  const tankPct =
    tank.capacityLitres > 0
      ? Math.min(100, Math.max(0, r2((tank.currentLevelLitres / tank.capacityLitres) * 100)))
      : 0;

  // Handlers
  const handleSaveCalibration = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCal(true);
    try {
      const cap = Math.max(100, Number(calCap) || 10000);
      const lvl = Math.max(0, Number(calLevel) || 0);
      const mtr = Math.max(0, Number(calMeter) || 0);
      await saveDieselTankConfig({
        ...tank,
        capacityLitres: cap,
        currentLevelLitres: lvl,
        currentMeterReading: mtr,
        lastUpdatedBy: `Admin Calibrated (${currentUserName})`,
      });
      setShowCalibrate(false);
    } finally {
      setSavingCal(false);
    }
  };

  const handleSubmitFuelRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setReqBanner(null);
    const litresNum = Number(reqLitres);
    const finalVehicle =
      reqVehicle === 'Other Plant Equipment'
        ? reqCustomVehicle.trim()
        : reqVehicle;

    if (!finalVehicle) {
      setReqBanner({ text: 'Please select or enter Vehicle / Forklift.', isError: true });
      return;
    }
    if (!litresNum || Number.isNaN(litresNum) || litresNum <= 0) {
      setReqBanner({ text: 'Please enter a valid positive Litres Requested.', isError: true });
      return;
    }
    if (!reqDriverName.trim()) {
      setReqBanner({ text: 'Driver Name is required.', isError: true });
      return;
    }
    if (!reqSignature) {
      setReqBanner({
        text: 'Forklift Driver digital signature is required before submitting request.',
        isError: true,
      });
      return;
    }

    setSavingReq(true);
    try {
      const res = await submitFuelRequest({
        date: reqDate,
        shift: reqShift,
        vehicleOrForklift: finalVehicle,
        driverName: reqDriverName,
        driverEmail: currentUserEmail,
        requestedLitres: litresNum,
        purpose: reqPurpose,
        driverRequestSignature: reqSignature,
      });
      setReqLitres('');
      setReqSignature('');
      setReqCustomVehicle('');
      setReqBanner({
        text: res.ok
          ? `Fuel Request ${res.request.requestNo} (${res.request.requestedLitres} L) submitted! Pop-up alert sent to Production HOD.`
          : `Request ${res.request.requestNo} saved locally; cloud sync pending.`,
        isError: false,
      });
    } finally {
      setSavingReq(false);
    }
  };

  const handleApproveAndGeneratePdfOnce = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeHodReq) return;
    setHodBanner(null);

    const appLitres = Number(hodApprovedLitresInput);
    if (!appLitres || Number.isNaN(appLitres) || appLitres <= 0) {
      setHodBanner({ text: 'Please enter valid Approved Litres.', isError: true });
      return;
    }
    if (!hodNameInput.trim()) {
      setHodBanner({ text: 'Production HOD Name is required.', isError: true });
      return;
    }
    if (!hodSignature) {
      setHodBanner({ text: 'Production HOD signature is required.', isError: true });
      return;
    }

    setSavingHod(true);
    try {
      const res = await approveFuelRequestAndUnlockPdf({
        request: activeHodReq,
        tank,
        hodName: hodNameInput,
        approvedLitres: appLitres,
        hodNotes: hodNotesInput,
        hodSignature,
      });
      if (!res.updated) {
        setHodBanner({ text: res.error || 'Could not approve request.', isError: true });
        return;
      }
      setSelectedHodId(null);
      setHodSignature('');
      setHodNotesInput('');
      setHodBanner({
        text: `Approved ${res.updated.requestNo} & Generated Portrait PDF Voucher (1-Time Issue)! Bowser Meter Dispense section is now UNLOCKED for ${res.updated.driverName}.`,
        isError: false,
      });
    } finally {
      setSavingHod(false);
    }
  };

  const handleDeclineRequest = async () => {
    if (!activeHodReq) return;
    setSavingHod(true);
    try {
      await rejectFuelRequest({
        request: activeHodReq,
        hodName: hodNameInput || currentUserName,
        hodNotes: hodNotesInput || 'Declined by Production HOD',
      });
      setSelectedHodId(null);
      setHodSignature('');
      setHodBanner({ text: `Declined fuel request ${activeHodReq.requestNo}.`, isError: false });
    } finally {
      setSavingHod(false);
    }
  };

  const handleCommitDispenseMeters = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDispenseReq) return;
    setDispenseBanner(null);

    const firstNum = Number(firstMeterInput);
    const secondNum = Number(secondMeterInput);
    if (
      firstMeterInput === '' ||
      secondMeterInput === '' ||
      Number.isNaN(firstNum) ||
      Number.isNaN(secondNum) ||
      secondNum <= firstNum
    ) {
      setDispenseBanner({
        text: 'Second Meter Reading (after fuel) must be greater than First Meter Reading (before fuel).',
        isError: true,
      });
      return;
    }
    if (!dispenseSignature) {
      setDispenseBanner({
        text: 'Driver dispense confirmation signature is required.',
        isError: true,
      });
      return;
    }

    setSavingDispense(true);
    try {
      const res = await dispenseFuelWithMeterReadings({
        request: activeDispenseReq,
        tank,
        firstMeterReading: firstNum,
        secondMeterReading: secondNum,
        driverDispenseSignature: dispenseSignature,
      });
      if (res.error && !res.updatedRequest) {
        setDispenseBanner({ text: res.error, isError: true });
        return;
      }
      setSelectedDispenseId(null);
      setSecondMeterInput('');
      setDispenseSignature('');
      setDispenseBanner({
        text: `Recorded ${res.updatedRequest?.actualLitresTaken} L dispensed (${firstNum} → ${secondNum})! Bowser tank level reduced to ${res.updatedTank?.currentLevelLitres.toLocaleString()} L.`,
        isError: false,
      });
    } finally {
      setSavingDispense(false);
    }
  };

  const handleSubmitGrn = async (e: React.FormEvent) => {
    e.preventDefault();
    setGrnBanner(null);

    const fMeter = Number(grnFirstMeter);
    const sMeter = Number(grnSecondMeter);
    if (!grnSupplier.trim()) {
      setGrnBanner({ text: 'Supplier Name is required for Fuel GRN.', isError: true });
      return;
    }
    if (
      grnFirstMeter === '' ||
      grnSecondMeter === '' ||
      Number.isNaN(fMeter) ||
      Number.isNaN(sMeter) ||
      sMeter <= fMeter
    ) {
      setGrnBanner({
        text: 'Second Meter Reading (after offload) must be greater than First Meter Reading.',
        isError: true,
      });
      return;
    }
    if (!grnSupplierSig || !grnReceiverSig) {
      setGrnBanner({
        text: 'Both Supplier Representative and LG PLAST Receiver signatures are required.',
        isError: true,
      });
      return;
    }

    setSavingGrn(true);
    try {
      const res = await recordFuelGrnAndTopUpTank({
        tank,
        date: grnDate,
        shift: grnShift,
        supplierName: grnSupplier,
        deliveryNoteNo: grnDeliveryNote,
        receiverName: grnReceiver || currentUserName,
        receiverEmail: currentUserEmail,
        firstMeterReading: fMeter,
        secondMeterReading: sMeter,
        unitPrice: grnUnitPrice ? Number(grnUnitPrice) : undefined,
        notes: grnNotes,
        supplierSignature: grnSupplierSig,
        receiverSignature: grnReceiverSig,
        hodVerifiedBy: isAdmin ? currentUserName : undefined,
      });
      if (!res.grn) {
        setGrnBanner({ text: res.error || 'Failed to save Fuel GRN.', isError: true });
        return;
      }
      setGrnSupplier('');
      setGrnDeliveryNote('');
      setGrnSecondMeter('');
      setGrnUnitPrice('');
      setGrnNotes('');
      setGrnSupplierSig('');
      setGrnReceiverSig('');
      setGrnBanner({
        text: `GRN ${res.grn.grnNo} Recorded (+${res.grn.litresAdded} L from ${res.grn.supplierName}) & Portrait PDF Generated! Tank Level now ${res.updatedTank?.currentLevelLitres.toLocaleString()} L.`,
        isError: false,
      });
    } finally {
      setSavingGrn(false);
    }
  };

  const handleExportDieselExcel = () => {
    if (!canExportExcel) {
      setLedgerBanner('Excel Export Restricted: Please contact Plant Admin for access.');
      return;
    }
    exportDieselExcelWorkbook(requests, grns, tank, ledgerFrom, ledgerTo);
    setLedgerBanner(
      `Downloaded LGPLAST Diesel Bowser Usage & GRN Excel (.xlsx) covering ${filteredRequests.length} fuel issues & ${filteredGrns.length} GRNs.`
    );
  };

  return (
    <div className="space-y-5">
      {/* LIVE BOWSER TANK GAUGE & HEADER CARD */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-5 shadow-lg space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <LgplastLogo size="sm" showSubtitle={false} />
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-slate-950 shadow">
              <Fuel className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-black text-white">
                Factory Diesel Bowser Tank &amp; Fuel GRN System
              </h2>
              <p className="text-xs text-slate-400">
                1. Forklift Driver Requests → 2. HOD Approves &amp; Issues 1-Time Portrait PDF → 3. Driver Enters 1st &amp; 2nd Bowser Meter Readings → Tank Updates Live
              </p>
            </div>
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setCalCap(String(tank.capacityLitres));
                setCalLevel(String(tank.currentLevelLitres));
                setCalMeter(String(tank.currentMeterReading));
                setShowCalibrate((v) => !v);
              }}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 hover:bg-slate-800 px-3 py-2 text-xs font-bold text-slate-300 transition self-start lg:self-auto"
            >
              <Settings className="h-3.5 w-3.5 text-amber-400" />
              <span>Calibrate Tank / Meter</span>
            </button>
          )}
        </div>

        {/* Live Bowser Tank Telemetry Bar */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2 rounded-xl border border-amber-500/35 bg-slate-950 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-300 flex items-center gap-1.5">
                <Fuel className="h-4 w-4 text-amber-400" />
                {tank.tankName}
              </span>
              <span
                className={`font-black tabular-nums ${
                  tankPct <= 20 ? 'text-rose-400' : tankPct <= 45 ? 'text-amber-300' : 'text-emerald-400'
                }`}
              >
                {tankPct}% Full
              </span>
            </div>
            <div className="h-3 w-full rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${getProgressWidthClass(tankPct)} ${
                  tankPct <= 20 ? 'bg-rose-500' : tankPct <= 45 ? 'bg-amber-400' : 'bg-emerald-500'
                }`}
              />
            </div>
            <div className="flex items-center justify-between text-xs tabular-nums">
              <span className="font-black text-white text-base">
                {tank.currentLevelLitres.toLocaleString()} L{' '}
                <span className="text-[11px] font-semibold text-slate-400">
                  / {tank.capacityLitres.toLocaleString()} L Capacity
                </span>
              </span>
              <span className="text-[10px] text-slate-500 truncate max-w-[180px]">
                {tank.lastUpdatedBy}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-sky-500/30 bg-slate-950 p-3.5 flex flex-col justify-between">
            <div className="text-[10px] font-bold uppercase text-sky-300 flex items-center gap-1">
              <Gauge className="h-3.5 w-3.5" />
              Current Bowser Meter Reading
            </div>
            <div className="text-2xl font-black text-white font-mono tabular-nums mt-1">
              {tank.currentMeterReading.toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-500">Live cumulative flow meter</div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 flex flex-col justify-between text-xs tabular-nums">
            <div className="flex justify-between">
              <span className="text-slate-400 font-semibold">Total GRN Added:</span>
              <span className="font-black text-emerald-400">
                +{tank.totalReceivedLitres.toLocaleString()} L
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-semibold">Total Issued Out:</span>
              <span className="font-black text-amber-300">
                -{tank.totalIssuedLitres.toLocaleString()} L
              </span>
            </div>
            <div className="flex justify-between pt-1 border-t border-slate-800">
              <span className="text-slate-400">Pending HOD / Meter:</span>
              <span className="font-bold text-white">
                {pendingHodList.length} / {unlockedDispenseList.length}
              </span>
            </div>
          </div>
        </div>

        {/* Admin Calibration Panel */}
        {showCalibrate && isAdmin && (
          <form
            onSubmit={handleSaveCalibration}
            className="rounded-xl border border-amber-500/40 bg-slate-950 p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
          >
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                Tank Capacity (L)
              </label>
              <input
                type="number"
                step="any"
                value={calCap}
                onChange={(e) => setCalCap(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                Current Dip / Level (L)
              </label>
              <input
                type="number"
                step="any"
                value={calLevel}
                onChange={(e) => setCalLevel(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                Bowser Meter Reading
              </label>
              <input
                type="number"
                step="any"
                value={calMeter}
                onChange={(e) => setCalMeter(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white tabular-nums"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={savingCal}
                className="flex-1 rounded-xl bg-amber-500 hover:bg-amber-400 px-3 py-1.5 text-xs font-black text-slate-950"
              >
                {savingCal ? 'Saving...' : 'Apply Reading'}
              </button>
              <button
                type="button"
                onClick={() => setShowCalibrate(false)}
                className="rounded-xl border border-slate-700 px-3 py-1.5 text-xs text-slate-300"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Sub-tab Navigation Buttons */}
        <div className="flex flex-wrap gap-2">
          {canRequestFuel && (
            <button
              type="button"
              onClick={() => setSubTab('request')}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                subTab === 'request'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'border border-slate-700 bg-slate-950 text-slate-300 hover:text-white'
              }`}
            >
              <Send className="h-3.5 w-3.5" />
              <span>1. Forklift Fuel Request</span>
            </button>
          )}

          {canHodApprove && (
            <button
              type="button"
              onClick={() => setSubTab('hod_approve')}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                subTab === 'hod_approve'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'border border-slate-700 bg-slate-950 text-slate-300 hover:text-white'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>2. HOD Approval &amp; 1-Time PDF</span>
              {pendingHodList.length > 0 && (
                <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white">
                  {pendingHodList.length}
                </span>
              )}
            </button>
          )}

          {(canRequestFuel || canHodApprove) && (
            <button
              type="button"
              onClick={() => setSubTab('dispense')}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                subTab === 'dispense'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'border border-slate-700 bg-slate-950 text-slate-300 hover:text-white'
              }`}
            >
              <Gauge className="h-3.5 w-3.5" />
              <span>3. Bowser Meter Entry</span>
              {unlockedDispenseList.length > 0 && (
                <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-black text-slate-950">
                  {unlockedDispenseList.length}
                </span>
              )}
            </button>
          )}

          {canGrn && (
            <button
              type="button"
              onClick={() => setSubTab('grn')}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                subTab === 'grn'
                  ? 'bg-sky-600 text-white shadow-md'
                  : 'border border-slate-700 bg-slate-950 text-slate-300 hover:text-white'
              }`}
            >
              <PackagePlus className="h-3.5 w-3.5" />
              <span>4. Fuel GRN (Add Tank Fuel)</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setSubTab('ledger')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
              subTab === 'ledger'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'border border-slate-700 bg-slate-950 text-slate-300 hover:text-white'
            }`}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>5. Fuel Ledger &amp; Excel</span>
          </button>
        </div>
      </div>

      {/* STAGE 1: FORKLIFT DRIVER FUEL REQUEST */}
      {subTab === 'request' && canRequestFuel && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-6 shadow-md space-y-4">
          <div className="border-b border-slate-800 pb-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Truck className="h-4 w-4 text-amber-400" />
              <span>Stage 1: Forklift Driver Diesel Request</span>
            </h3>
            <p className="text-xs text-slate-400">
              Submitting sends an immediate pop-up message to Production HOD. Bowser meter reading entry remains locked until HOD approves and generates the 1-time PDF voucher.
            </p>
          </div>

          {reqBanner && (
            <div
              className={`flex items-center gap-2 rounded-xl border p-3 text-xs font-semibold ${
                reqBanner.isError
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              {reqBanner.isError ? (
                <AlertCircle className="h-4 w-4 shrink-0" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              )}
              <span>{reqBanner.text}</span>
            </div>
          )}

          <form onSubmit={handleSubmitFuelRequest} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">Date</label>
                <input
                  type="date"
                  required
                  value={reqDate}
                  onChange={(e) => setReqDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">Shift</label>
                <select
                  value={reqShift}
                  onChange={(e) => setReqShift(e.target.value as 'Day' | 'Night')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                >
                  <option value="Day">Day Shift</option>
                  <option value="Night">Night Shift</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Vehicle / Forklift *
                </label>
                <select
                  value={reqVehicle}
                  onChange={(e) => setReqVehicle(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                >
                  {VEHICLE_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Litres Requested (L) *
                </label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  required
                  placeholder="e.g. 60"
                  value={reqLitres}
                  onChange={(e) => setReqLitres(e.target.value)}
                  className="w-full rounded-xl border border-amber-500/40 bg-slate-950 px-3 py-2 text-sm font-black text-amber-300 tabular-nums"
                />
              </div>
            </div>

            {reqVehicle === 'Other Plant Equipment' && (
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Specify Vehicle / Equipment Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Enter vehicle or equipment name..."
                  value={reqCustomVehicle}
                  onChange={(e) => setReqCustomVehicle(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Forklift Driver / Requester Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={reqDriverName}
                    onChange={(e) => setReqDriverName(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Operational Purpose
                  </label>
                  <textarea
                    rows={2}
                    value={reqPurpose}
                    onChange={(e) => setReqPurpose(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>

              <DieselSignaturePad
                label="Forklift Driver Request Signature *"
                value={reqSignature}
                onChange={setReqSignature}
                accentColor="amber"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingReq}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 px-6 py-2.5 text-xs font-black text-slate-950 shadow-lg transition disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                <span>
                  {savingReq
                    ? 'Sending to Production HOD...'
                    : 'Submit Fuel Request & Alert Production HOD'}
                </span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* STAGE 2: PRODUCTION HOD APPROVAL + 1-TIME PDF GENERATION */}
      {subTab === 'hod_approve' && canHodApprove && (
        <div className="space-y-4">
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
            <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 space-y-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-amber-300 border-b border-slate-800 pb-2">
                Pending Fuel Requests ({pendingHodList.length})
              </h3>
              {pendingHodList.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">
                  No pending fuel requests awaiting HOD approval.
                </p>
              ) : (
                <div className="space-y-2 max-h-[420px] overflow-y-auto">
                  {pendingHodList.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedHodId(r.id)}
                      className={`w-full text-left rounded-xl border p-3 transition ${
                        activeHodReq?.id === r.id
                          ? 'border-blue-500 bg-blue-500/10'
                          : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-black text-amber-300">
                          {r.requestNo}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {r.date} ({r.shift})
                        </span>
                      </div>
                      <div className="text-xs font-bold text-white mt-1">{r.vehicleOrForklift}</div>
                      <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                        <span>{r.driverName}</span>
                        <span className="font-black text-amber-400 tabular-nums">
                          {r.requestedLitres} L
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-6">
              {!activeHodReq ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  <ShieldCheck className="h-10 w-10 text-slate-600 mx-auto mb-2" />
                  Select a pending fuel request to approve &amp; issue the 1-time PDF voucher.
                </div>
              ) : (
                <form onSubmit={handleApproveAndGeneratePdfOnce} className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div>
                      <h3 className="text-base font-bold text-white">
                        Approve Request {activeHodReq.requestNo} — {activeHodReq.vehicleOrForklift}
                      </h3>
                      <p className="text-xs text-slate-400">
                        Driver: {activeHodReq.driverName} • Requested: {activeHodReq.requestedLitres} L
                      </p>
                    </div>
                    <span className="rounded-lg border border-blue-500/40 bg-blue-500/15 px-2.5 py-1 text-[10px] font-black text-blue-300">
                      1-TIME APPROVAL PDF UNLOCKS METER
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                      <div className="text-[10px] font-bold uppercase text-slate-400">
                        Driver Requested
                      </div>
                      <div className="text-xl font-black text-amber-300 tabular-nums mt-0.5">
                        {activeHodReq.requestedLitres} L
                      </div>
                    </div>
                    <div className="rounded-xl border border-emerald-500/40 bg-slate-950 p-3">
                      <label className="block text-[10px] font-bold uppercase text-emerald-300 mb-1">
                        HOD Approved Litres *
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="any"
                        required
                        value={hodApprovedLitresInput}
                        onChange={(e) => setHodApprovedLitresInput(e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-lg font-black text-emerald-300 tabular-nums"
                      />
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                      <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">
                        Driver Request Sign
                      </div>
                      {activeHodReq.driverRequestSignature && (
                        <img
                          src={activeHodReq.driverRequestSignature}
                          alt="Driver Request Sign"
                          className="h-10 object-contain rounded bg-slate-900"
                        />
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-300 mb-1">
                          Production HOD Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={hodNameInput}
                          onChange={(e) => setHodNameInput(e.target.value)}
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-300 mb-1">
                          HOD Remarks
                        </label>
                        <textarea
                          rows={2}
                          placeholder="Authorization notes..."
                          value={hodNotesInput}
                          onChange={(e) => setHodNotesInput(e.target.value)}
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                        />
                      </div>
                    </div>

                    <DieselSignaturePad
                      label="Production HOD Signature *"
                      value={hodSignature}
                      onChange={setHodSignature}
                      accentColor="sky"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                    <button
                      type="button"
                      disabled={savingHod}
                      onClick={handleDeclineRequest}
                      className="flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 px-4 py-2 text-xs font-bold text-rose-300 transition"
                    >
                      <XCircle className="h-4 w-4" />
                      <span>Decline Request</span>
                    </button>

                    <button
                      type="submit"
                      disabled={savingHod}
                      className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 px-5 py-2.5 text-xs font-black text-white shadow-lg transition disabled:opacity-50"
                    >
                      <FileText className="h-4 w-4" />
                      <span>
                        {savingHod
                          ? 'Approving & Generating PDF...'
                          : 'Approve & Generate Voucher PDF Once (Unlocks Meter)'}
                      </span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* STAGE 3: FORKLIFT DRIVER BOWSER METER ENTRY */}
      {subTab === 'dispense' && (
        <div className="space-y-4">
          {dispenseBanner && (
            <div
              className={`flex items-center gap-2 rounded-xl border p-3 text-xs font-semibold ${
                dispenseBanner.isError
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              {dispenseBanner.isError ? (
                <AlertCircle className="h-4 w-4 shrink-0" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              )}
              <span>{dispenseBanner.text}</span>
            </div>
          )}

          {unlockedDispenseList.length === 0 ? (
            <div className="rounded-2xl border border-rose-500/35 bg-slate-900/95 p-8 text-center space-y-2">
              <Lock className="h-10 w-10 text-rose-400 mx-auto" />
              <h3 className="text-base font-bold text-white">
                Bowser Meter Dispense Section Locked
              </h3>
              <p className="text-xs text-slate-400 max-w-lg mx-auto">
                Forklift Drivers can only enter Bowser 1st &amp; 2nd meter readings AFTER Production HOD approves a Fuel Request and generates the 1-time Portrait PDF Voucher.
              </p>
              {pendingHodList.length > 0 && (
                <p className="text-xs font-bold text-amber-300">
                  {pendingHodList.length} fuel request(s) currently waiting for HOD Approval &amp; PDF release.
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-emerald-300 flex items-center gap-1.5 border-b border-slate-800 pb-2">
                  <Unlock className="h-4 w-4" />
                  <span>Unlocked Vouchers ({unlockedDispenseList.length})</span>
                </h3>
                <div className="space-y-2">
                  {unlockedDispenseList.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedDispenseId(r.id)}
                      className={`w-full text-left rounded-xl border p-3 transition ${
                        activeDispenseReq?.id === r.id
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : 'border-slate-800 bg-slate-950'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-black text-emerald-300">
                          {r.requestNo}
                        </span>
                        <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-black text-emerald-300">
                          PDF ISSUED
                        </span>
                      </div>
                      <div className="text-xs font-bold text-white mt-1">{r.vehicleOrForklift}</div>
                      <div className="text-[11px] text-slate-400 flex justify-between mt-1">
                        <span>{r.driverName}</span>
                        <span className="font-black text-amber-300 tabular-nums">
                          Limit: {r.hodApprovedLitres ?? r.requestedLitres} L
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {activeDispenseReq && (
                <form
                  onSubmit={handleCommitDispenseMeters}
                  className="lg:col-span-2 rounded-2xl border border-emerald-500/40 bg-slate-900/95 p-4 sm:p-6 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div>
                      <h3 className="text-base font-bold text-white">
                        Stage 3: Enter Bowser Meter Readings — {activeDispenseReq.requestNo}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {activeDispenseReq.vehicleOrForklift} • Driver: {activeDispenseReq.driverName} • HOD Approved:{' '}
                        <b className="text-emerald-300">
                          {activeDispenseReq.hodApprovedLitres ?? activeDispenseReq.requestedLitres} L
                        </b>
                      </p>
                    </div>
                    <span className="rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-1 text-[10px] font-black text-emerald-300">
                      VOUCHER PDF GENERATED ONCE · UNLOCKED
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">
                        1st Meter Reading (Before Fuel) *
                      </label>
                      <input
                        type="number"
                        step="any"
                        required
                        value={firstMeterInput}
                        onChange={(e) => setFirstMeterInput(e.target.value)}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-base font-black text-sky-300 font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">
                        2nd Meter Reading (After Fuel) *
                      </label>
                      <input
                        type="number"
                        step="any"
                        required
                        placeholder="e.g. > 1st reading"
                        value={secondMeterInput}
                        onChange={(e) => setSecondMeterInput(e.target.value)}
                        className="w-full rounded-xl border border-emerald-500/40 bg-slate-950 px-3 py-2 text-base font-black text-emerald-300 font-mono tabular-nums"
                      />
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 flex flex-col justify-center">
                      <div className="text-[10px] font-bold uppercase text-slate-400">
                        Net Diesel Taken (2nd - 1st)
                      </div>
                      <div className="text-xl font-black text-amber-400 tabular-nums mt-0.5">
                        {liveDispenseTaken > 0 ? `${liveDispenseTaken} L` : '—'}
                      </div>
                      {liveDispenseTaken > 0 && (
                        <div className="text-[10px] text-emerald-400 tabular-nums">
                          New Tank: {Math.max(0, r2(tank.currentLevelLitres - liveDispenseTaken)).toLocaleString()} L
                        </div>
                      )}
                    </div>
                  </div>

                  <DieselSignaturePad
                    label="Forklift Driver Dispense Confirmation Signature *"
                    value={dispenseSignature}
                    onChange={setDispenseSignature}
                    accentColor="emerald"
                  />

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={savingDispense}
                      className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 px-6 py-2.5 text-xs font-black text-slate-950 shadow-lg transition disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>
                        {savingDispense
                          ? 'Updating Bowser Tank...'
                          : 'Confirm Dispense & Deduct Tank Level'}
                      </span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}

      {/* STAGE 4: FUEL GRN (ADD FUEL INTO BOWSER TANK) */}
      {subTab === 'grn' && canGrn && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-6 shadow-md space-y-4">
          <div className="border-b border-slate-800 pb-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <PackagePlus className="h-4 w-4 text-sky-400" />
              <span>Fuel GRN (Bulk Bowser Tank Replenishment &amp; Portrait PDF)</span>
            </h3>
            <p className="text-xs text-slate-400">
              Record Fuel Supplier details, 1st &amp; 2nd bowser offload meter readings, collect both Supplier &amp; LG PLAST Receiver signatures, top up live tank level, and print the official Portrait GRN PDF.
            </p>
          </div>

          {grnBanner && (
            <div
              className={`flex items-center gap-2 rounded-xl border p-3 text-xs font-semibold ${
                grnBanner.isError
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              {grnBanner.isError ? (
                <AlertCircle className="h-4 w-4 shrink-0" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              )}
              <span>{grnBanner.text}</span>
            </div>
          )}

          <form onSubmit={handleSubmitGrn} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">GRN Date</label>
                <input
                  type="date"
                  required
                  value={grnDate}
                  onChange={(e) => setGrnDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">Shift</label>
                <select
                  value={grnShift}
                  onChange={(e) => setGrnShift(e.target.value as 'Day' | 'Night')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                >
                  <option value="Day">Day Shift</option>
                  <option value="Night">Night Shift</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Fuel Supplier Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Zuva Petroleum / Total / Trek"
                  value={grnSupplier}
                  onChange={(e) => setGrnSupplier(e.target.value)}
                  className="w-full rounded-xl border border-sky-500/40 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Supplier Delivery Note / Inv No.
                </label>
                <input
                  type="text"
                  placeholder="e.g. DN-44210"
                  value={grnDeliveryNote}
                  onChange={(e) => setGrnDeliveryNote(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  1st Meter Reading (Before Offload) *
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={grnFirstMeter}
                  onChange={(e) => setGrnFirstMeter(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-black text-sky-300 font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  2nd Meter Reading (After Offload) *
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  placeholder="Enter after offload"
                  value={grnSecondMeter}
                  onChange={(e) => setGrnSecondMeter(e.target.value)}
                  className="w-full rounded-xl border border-emerald-500/40 bg-slate-950 px-3 py-2 text-sm font-black text-emerald-300 font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  LG PLAST Receiver Name *
                </label>
                <input
                  type="text"
                  required
                  value={grnReceiver}
                  onChange={(e) => setGrnReceiver(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>
              <div className="rounded-xl border border-emerald-500/35 bg-slate-950 p-2.5 flex flex-col justify-center">
                <div className="text-[10px] font-bold uppercase text-slate-400">
                  Litres Added to Tank
                </div>
                <div className="text-lg font-black text-emerald-400 tabular-nums">
                  {liveGrnLitresAdded > 0 ? `+${liveGrnLitresAdded} L` : '—'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Unit Price ($/L) Optional
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Optional price per litre"
                  value={grnUnitPrice}
                  onChange={(e) => setGrnUnitPrice(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Delivery Inspection Remarks
                </label>
                <input
                  type="text"
                  placeholder="Tanker seals intact, water check passed..."
                  value={grnNotes}
                  onChange={(e) => setGrnNotes(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <DieselSignaturePad
                label="Supplier Representative Signature *"
                value={grnSupplierSig}
                onChange={setGrnSupplierSig}
                accentColor="sky"
              />
              <DieselSignaturePad
                label="LG PLAST Receiver Signature *"
                value={grnReceiverSig}
                onChange={setGrnReceiverSig}
                accentColor="emerald"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingGrn}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 px-6 py-2.5 text-xs font-black text-white shadow-lg transition disabled:opacity-50"
              >
                <FileText className="h-4 w-4" />
                <span>
                  {savingGrn
                    ? 'Saving GRN & Updating Tank...'
                    : 'Commit Fuel GRN, Top Up Tank & Print Portrait PDF'}
                </span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* STAGE 5: FUEL LEDGER & EXCEL REPORT */}
      {subTab === 'ledger' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
                <span>Diesel Usage &amp; Fuel GRN Ledger</span>
              </h3>
              <p className="text-xs text-slate-400">
                Complete signed audit trail of Bowser fuel issues and bulk supplier GRN deliveries.
              </p>
            </div>

            {canExportExcel ? (
              <button
                type="button"
                onClick={handleExportDieselExcel}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-black text-white shadow-md transition"
              >
                <Download className="h-4 w-4" />
                <span>Export Diesel Usage &amp; GRN Excel (.xlsx)</span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300">
                <Lock className="h-4 w-4" />
                <span>Excel Export Locked (Admin)</span>
              </div>
            )}
          </div>

          {ledgerBanner && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs font-semibold text-emerald-300">
              {ledgerBanner}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                From Date
              </label>
              <input
                type="date"
                value={ledgerFrom}
                onChange={(e) => setLedgerFrom(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                To Date
              </label>
              <input
                type="date"
                value={ledgerTo}
                onChange={(e) => setLedgerTo(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                Search Voucher / Driver / Supplier
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

          {/* Fuel Issues Table */}
          <div className="space-y-2">
            <h4 className="text-xs font-black uppercase tracking-wider text-amber-300">
              Diesel Fuel Issue History ({filteredRequests.length})
            </h4>
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="bg-slate-950 text-[10px] font-black uppercase text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-2.5 py-2">Voucher</th>
                    <th className="px-2.5 py-2">Date / Shift</th>
                    <th className="px-2.5 py-2">Vehicle</th>
                    <th className="px-2.5 py-2">Driver</th>
                    <th className="px-2.5 py-2 text-right">Req (L)</th>
                    <th className="px-2.5 py-2 text-right">1st Meter</th>
                    <th className="px-2.5 py-2 text-right">2nd Meter</th>
                    <th className="px-2.5 py-2 text-right">Taken (L)</th>
                    <th className="px-2.5 py-2 text-right">Tank After</th>
                    <th className="px-2.5 py-2">HOD</th>
                    <th className="px-2.5 py-2">Status</th>
                    <th className="px-2.5 py-2 text-center">PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-900/50">
                  {filteredRequests.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-4 py-6 text-center text-slate-500">
                        No diesel fuel requests match this filter.
                      </td>
                    </tr>
                  ) : (
                    filteredRequests.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-800/40">
                        <td className="px-2.5 py-2 font-mono font-bold text-amber-300">
                          {r.requestNo}
                        </td>
                        <td className="px-2.5 py-2 text-slate-300">
                          {r.date} ({r.shift})
                        </td>
                        <td className="px-2.5 py-2 font-bold text-white">{r.vehicleOrForklift}</td>
                        <td className="px-2.5 py-2 text-slate-200">{r.driverName}</td>
                        <td className="px-2.5 py-2 text-right">{r.requestedLitres}</td>
                        <td className="px-2.5 py-2 text-right font-mono text-sky-300">
                          {r.firstMeterReading ?? '—'}
                        </td>
                        <td className="px-2.5 py-2 text-right font-mono text-emerald-300">
                          {r.secondMeterReading ?? '—'}
                        </td>
                        <td className="px-2.5 py-2 text-right font-black text-amber-300">
                          {r.actualLitresTaken ?? '—'}
                        </td>
                        <td className="px-2.5 py-2 text-right font-bold text-slate-200">
                          {typeof r.tankLevelAfter === 'number'
                            ? `${r.tankLevelAfter.toLocaleString()} L`
                            : '—'}
                        </td>
                        <td className="px-2.5 py-2 text-slate-300">
                          {r.hodApprovedBy || 'Pending'}
                        </td>
                        <td className="px-2.5 py-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${
                              r.status === 'DISPENSED'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : r.status === 'APPROVED_FOR_DISPENSE'
                                ? 'bg-sky-500/20 text-sky-300'
                                : r.status === 'REJECTED'
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {r.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-2.5 py-2 text-center">
                          {r.status === 'DISPENSED' && isAdmin ? (
                            <button
                              type="button"
                              onClick={() => generateFuelRequestApprovalPdf(r, tank)}
                              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-200 hover:bg-slate-700"
                            >
                              <FileText className="h-3 w-3" />
                              <span>Audit</span>
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-500">
                              {r.pdfGeneratedOnce ? 'Issued 1x' : 'Locked'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Fuel GRN Table */}
          <div className="space-y-2 pt-2">
            <h4 className="text-xs font-black uppercase tracking-wider text-sky-300">
              Bulk Fuel GRN Receipts ({filteredGrns.length})
            </h4>
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="bg-slate-950 text-[10px] font-black uppercase text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-2.5 py-2">GRN No</th>
                    <th className="px-2.5 py-2">Date</th>
                    <th className="px-2.5 py-2">Supplier</th>
                    <th className="px-2.5 py-2">Receiver</th>
                    <th className="px-2.5 py-2 text-right">1st Meter</th>
                    <th className="px-2.5 py-2 text-right">2nd Meter</th>
                    <th className="px-2.5 py-2 text-right">Added (+L)</th>
                    <th className="px-2.5 py-2 text-right">Tank After</th>
                    <th className="px-2.5 py-2 text-center">GRN PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-900/50">
                  {filteredGrns.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-6 text-center text-slate-500">
                        No Fuel GRN deliveries recorded in selected period.
                      </td>
                    </tr>
                  ) : (
                    filteredGrns.map((g) => (
                      <tr key={g.id} className="hover:bg-slate-800/40">
                        <td className="px-2.5 py-2 font-mono font-bold text-sky-300">{g.grnNo}</td>
                        <td className="px-2.5 py-2 text-slate-300">
                          {g.date} ({g.shift})
                        </td>
                        <td className="px-2.5 py-2 font-bold text-white">{g.supplierName}</td>
                        <td className="px-2.5 py-2 text-slate-200">{g.receiverName}</td>
                        <td className="px-2.5 py-2 text-right font-mono">{g.firstMeterReading}</td>
                        <td className="px-2.5 py-2 text-right font-mono">{g.secondMeterReading}</td>
                        <td className="px-2.5 py-2 text-right font-black text-emerald-400">
                          +{g.litresAdded} L
                        </td>
                        <td className="px-2.5 py-2 text-right font-bold text-white">
                          {g.tankLevelAfter.toLocaleString()} L
                        </td>
                        <td className="px-2.5 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => generateFuelGrnPdf(g)}
                            className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/15 px-2 py-1 text-[10px] font-bold text-sky-300 hover:bg-sky-500/25"
                          >
                            <FileText className="h-3 w-3" />
                            <span>Portrait PDF</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
