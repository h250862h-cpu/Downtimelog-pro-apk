import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Eraser,
  FileSpreadsheet,
  Flame,
  Fuel,
  Link2,
  Lock,
  PenTool,
  Play,
  Power,
  Square,
  Zap,
} from 'lucide-react';
import { dtl, getCurrentShift, r2, ymd } from '../services/downtimeCalc';
import {
  calcDurationMinutes,
  closePowerCutLog,
  exportGeneratorExcel,
  exportPowerCutExcel,
  extractTimeLabel,
  formatDurationHm,
  logGeneratorStart,
  logGeneratorStop,
  savePowerCutLog,
} from '../services/powerGenStore';
import { DowntimeEntry, GeneratorLog, PowerCutLog } from '../types';

interface PowerCutAndGeneratorViewProps {
  powerCutLogs: PowerCutLog[];
  generatorLogs: GeneratorLog[];
  downtimeEntries: DowntimeEntry[];
  isAdmin: boolean;
  currentUserName: string;
  currentUserEmail: string;
  initialSubTab?: 'power_cuts' | 'generator';
  onDataChanged?: () => void;
}

const AFFECTED_AREAS = [
  'All Factory Floor',
  'Extrusion Section (Lines 1-6, Polypipe, Trunking)',
  'Injection Moulding Section',
  'Mixing & Recycling Section',
  'Warehouse, Dispatch & Offices',
];

export const PowerCutAndGeneratorView: React.FC<PowerCutAndGeneratorViewProps> = ({
  powerCutLogs,
  generatorLogs,
  downtimeEntries,
  isAdmin,
  currentUserName,
  currentUserEmail,
  initialSubTab = 'power_cuts',
  onDataChanged,
}) => {
  const shiftInfo = getCurrentShift();
  const todayStr = ymd(new Date());

  const [subTab, setSubTab] = useState<'power_cuts' | 'generator'>(initialSubTab);
  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  // Period filter shared cleanly across views
  const [fromDate, setFromDate] = useState<string>(() => `${todayStr.slice(0, 7)}-01`);
  const [toDate, setToDate] = useState<string>(() => todayStr);

  // Feedback banner
  const [notice, setNotice] = useState<{ text: string; isError?: boolean } | null>(null);
  const showNotice = (text: string, isError = false) => {
    setNotice({ text, isError });
    setTimeout(() => setNotice(null), 5000);
  };

  // ======================================================
  // 1. POWER CUT STATE & HANDLERS
  // ======================================================
  const [pwrDate, setPwrDate] = useState<string>(todayStr);
  const [pwrShift, setPwrShift] = useState<'Day' | 'Night'>(shiftInfo.shift);
  const [pwrTimeOut, setPwrTimeOut] = useState<string>(() => dtl(new Date()));
  const [pwrTimeBack, setPwrTimeBack] = useState<string>('');
  const [pwrArea, setPwrArea] = useState<string>(AFFECTED_AREAS[0]);
  const [pwrGenUsed, setPwrGenUsed] = useState<boolean>(true);
  const [pwrReason, setPwrReason] = useState<string>('ZESA Mains Power Outage');
  const [pwrSaving, setPwrSaving] = useState<boolean>(false);

  // Close ongoing power cut state keyed by log id
  const [closingTimeBackMap, setClosingTimeBackMap] = useState<Record<string, string>>({});
  const [closingGenUsedMap, setClosingGenUsedMap] = useState<Record<string, boolean>>({});
  const [closingId, setClosingId] = useState<string | null>(null);

  const ongoingPowerCuts = useMemo(
    () =>
      powerCutLogs
        .filter((l) => l.status === 'ONGOING' || !l.timeBack)
        .sort((a, b) => (b.timeOut || '').localeCompare(a.timeOut || '')),
    [powerCutLogs]
  );

  const filteredPowerCuts = useMemo(
    () =>
      powerCutLogs
        .filter((l) => (!fromDate || l.date >= fromDate) && (!toDate || l.date <= toDate))
        .sort((a, b) => (b.date + b.timeOut).localeCompare(a.date + a.timeOut)),
    [powerCutLogs, fromDate, toDate]
  );

  const totalPowerCutMins = useMemo(
    () =>
      filteredPowerCuts.reduce(
        (sum, l) => sum + (l.status === 'RESTORED' ? l.durationMinutes : calcDurationMinutes(l.timeOut)),
        0
      ),
    [filteredPowerCuts]
  );

  const handleSavePowerCut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwrTimeOut.trim()) {
      showNotice('Please enter Power Cut Time Out.', true);
      return;
    }
    if (pwrTimeBack.trim() && pwrTimeBack.trim() <= pwrTimeOut.trim()) {
      showNotice('Time Back must be after Time Out.', true);
      return;
    }
    setPwrSaving(true);
    try {
      const id = `PWR-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
      const newLog: PowerCutLog = {
        id,
        date: pwrDate || pwrTimeOut.slice(0, 10),
        shift: pwrShift,
        timeOut: pwrTimeOut,
        timeBack: pwrTimeBack.trim() || '',
        durationMinutes: pwrTimeBack.trim()
          ? calcDurationMinutes(pwrTimeOut, pwrTimeBack.trim())
          : 0,
        affectedArea: pwrArea,
        generatorUsed: pwrGenUsed,
        reason: pwrReason.trim() || 'Mains Power Outage',
        loggedBy: currentUserName,
        loggedByEmail: currentUserEmail,
        restoredBy: pwrTimeBack.trim() ? currentUserName : undefined,
        status: pwrTimeBack.trim() ? 'RESTORED' : 'ONGOING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        upd: Date.now(),
      };
      const res = await savePowerCutLog(newLog);
      onDataChanged?.();
      setPwrTimeOut(dtl(new Date()));
      setPwrTimeBack('');
      showNotice(
        res.ok
          ? `Power cut logged and synced (${newLog.status === 'RESTORED' ? formatDurationHm(newLog.durationMinutes) : 'Ongoing'}).`
          : `Power cut cached offline (${res.error || 'Queued for sync'}).`,
        false
      );
    } finally {
      setPwrSaving(false);
    }
  };

  const handleRestorePowerCut = async (log: PowerCutLog) => {
    const tb = (closingTimeBackMap[log.id] || dtl(new Date())).trim();
    if (!tb || tb <= log.timeOut) {
      showNotice('Time Back must be later than Time Out.', true);
      return;
    }
    setClosingId(log.id);
    try {
      const res = await closePowerCutLog({
        log,
        timeBack: tb,
        restoredBy: currentUserName,
        generatorUsed:
          typeof closingGenUsedMap[log.id] === 'boolean'
            ? closingGenUsedMap[log.id]
            : log.generatorUsed,
      });
      onDataChanged?.();
      showNotice(
        res.ok
          ? `Power restored logged (${formatDurationHm(res.saved.durationMinutes)} outage duration).`
          : `Power restored saved locally (${res.error || 'Queued for sync'}).`
      );
    } finally {
      setClosingId(null);
    }
  };

  // ======================================================
  // 2. GENERATOR START / STOP (LITRES) STATE & HANDLERS
  // ======================================================
  const [genMode, setGenMode] = useState<'start' | 'completed'>('start');
  const [genDate, setGenDate] = useState<string>(todayStr);
  const [genShift, setGenShift] = useState<'Day' | 'Night'>(shiftInfo.shift);
  const [genStartTime, setGenStartTime] = useState<string>(() => dtl(new Date()));
  const [genStartFuelLitres, setGenStartFuelLitres] = useState<string>('');
  const [genStopTime, setGenStopTime] = useState<string>(() => dtl(new Date()));
  const [genStopFuelLitres, setGenStopFuelLitres] = useState<string>('');
  const [genLinkedPowerCutId, setGenLinkedPowerCutId] = useState<string>('');
  const [genReason, setGenReason] = useState<string>('Mains Power Backup');
  const [genOperatorName, setGenOperatorName] = useState<string>(currentUserName);
  const [genStoppedByName, setGenStoppedByName] = useState<string>(currentUserName);
  const [genNotes, setGenNotes] = useState<string>('');
  const [genSaving, setGenSaving] = useState<boolean>(false);

  // Digital Signature for Start Form
  const startCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawingStartSig, setIsDrawingStartSig] = useState<boolean>(false);
  const [startSignature, setStartSignature] = useState<string>('');

  // Stop Active Generator state (for currently RUNNING generator log)
  const [activeStopTime, setActiveStopTime] = useState<string>(() => dtl(new Date()));
  const [activeStopFuelLitres, setActiveStopFuelLitres] = useState<string>('');
  const [activeStopBy, setActiveStopBy] = useState<string>(currentUserName);
  const [activeStopNotes, setActiveStopNotes] = useState<string>('');
  const [stoppingGenId, setStoppingGenId] = useState<string | null>(null);
  const stopCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawingStopSig, setIsDrawingStopSig] = useState<boolean>(false);
  const [stopSignature, setStopSignature] = useState<string>('');

  const runningGenerators = useMemo(
    () =>
      generatorLogs
        .filter((g) => g.status === 'RUNNING' || !g.stopTime)
        .sort((a, b) => (b.startTime || '').localeCompare(a.startTime || '')),
    [generatorLogs]
  );

  const latestGenerator = useMemo(
    () =>
      [...generatorLogs].sort((a, b) => (b.startTime || '').localeCompare(a.startTime || ''))[0],
    [generatorLogs]
  );

  const latestMachineGenEntry = useMemo(
    () =>
      downtimeEntries
        .filter((e) => !e.del && e.m.toLowerCase() === 'generator')
        .sort((a, b) => (b.upd || 0) - (a.upd || 0))[0],
    [downtimeEntries]
  );

  const filteredGeneratorLogs = useMemo(
    () =>
      generatorLogs
        .filter((g) => (!fromDate || g.date >= fromDate) && (!toDate || g.date <= toDate))
        .sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime)),
    [generatorLogs, fromDate, toDate]
  );

  const totalGenRunMins = useMemo(
    () =>
      filteredGeneratorLogs.reduce(
        (sum, g) => sum + (g.status === 'STOPPED' ? g.durationMinutes : calcDurationMinutes(g.startTime)),
        0
      ),
    [filteredGeneratorLogs]
  );

  const totalGenFuelLitres = useMemo(
    () => r2(filteredGeneratorLogs.reduce((sum, g) => sum + (g.fuelUsedLitres || 0), 0)),
    [filteredGeneratorLogs]
  );

  // Reusable canvas drawing helpers
  const beginCanvasStroke = (
    canvas: HTMLCanvasElement | null,
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
    setDrawing: (v: boolean) => void
  ) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setDrawing(true);
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
    ctx.strokeStyle = '#0F1E36';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  const moveCanvasStroke = (
    canvas: HTMLCanvasElement | null,
    isDrawing: boolean,
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawing || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
  };

  const endCanvasStroke = (
    canvas: HTMLCanvasElement | null,
    setDrawing: (v: boolean) => void,
    setData: (s: string) => void
  ) => {
    setDrawing(false);
    if (canvas) {
      setData(canvas.toDataURL('image/png'));
    }
  };

  const clearCanvas = (
    canvas: HTMLCanvasElement | null,
    setData: (s: string) => void
  ) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setData('');
  };

  const handleSubmitGeneratorStart = async (e: React.FormEvent) => {
    e.preventDefault();
    const startL = parseFloat(genStartFuelLitres);
    if (Number.isNaN(startL) || startL < 0) {
      showNotice('Please enter Start Fuel Level in Litres (e.g. 180).', true);
      return;
    }
    if (!genStartTime.trim()) {
      showNotice('Please enter Generator Start Time.', true);
      return;
    }
    if (!genOperatorName.trim()) {
      showNotice('Please enter Operator / Staff Name.', true);
      return;
    }

    let stopL: number | undefined;
    if (genMode === 'completed') {
      stopL = parseFloat(genStopFuelLitres);
      if (Number.isNaN(stopL) || stopL < 0) {
        showNotice('Please enter Stop Fuel Level in Litres.', true);
        return;
      }
      if (!genStopTime.trim() || genStopTime.trim() <= genStartTime.trim()) {
        showNotice('Stop Time must be later than Start Time.', true);
        return;
      }
      if (stopL > startL) {
        showNotice('Stop Fuel Level (L) cannot exceed Start Fuel Level (L).', true);
        return;
      }
    }

    setGenSaving(true);
    try {
      const startRes = await logGeneratorStart({
        date: genDate || genStartTime.slice(0, 10),
        shift: genShift,
        startTime: genStartTime,
        startFuelLitres: startL,
        linkedPowerCutId: genLinkedPowerCutId || undefined,
        reason: genReason,
        operatorName: genOperatorName,
        loggedByEmail: currentUserEmail,
        signature: startSignature || undefined,
        notes: genNotes,
      });

      if (genMode === 'completed' && typeof stopL === 'number') {
        await logGeneratorStop({
          log: startRes.saved,
          stopTime: genStopTime,
          stopFuelLitres: stopL,
          stoppedByName: genStoppedByName || genOperatorName,
          stopSignature: startSignature || undefined,
          notes: genNotes,
        });
      }

      onDataChanged?.();
      setGenStartFuelLitres('');
      setGenStopFuelLitres('');
      setGenNotes('');
      setGenLinkedPowerCutId('');
      setGenStartTime(dtl(new Date()));
      setGenStopTime(dtl(new Date()));
      clearCanvas(startCanvasRef.current, setStartSignature);

      showNotice(
        genMode === 'completed' && typeof stopL === 'number'
          ? `Generator Start & Stop logged (${r2(startL - stopL)} L consumed) and synced to Generator Machine Card.`
          : `Generator Start Up logged (${startL} L) — Machine Status Board updated to ON LOAD.`
      );
    } finally {
      setGenSaving(false);
    }
  };

  const handleStopActiveGenerator = async (genLog: GeneratorLog) => {
    const stopL = parseFloat(activeStopFuelLitres);
    if (Number.isNaN(stopL) || stopL < 0) {
      showNotice('Enter Stop Fuel Level in Litres before stopping.', true);
      return;
    }
    if (stopL > genLog.startFuelLitres) {
      showNotice(
        `Stop Fuel Level (${stopL} L) cannot exceed Start Fuel Level (${genLog.startFuelLitres} L).`,
        true
      );
      return;
    }
    const st = activeStopTime.trim() || dtl(new Date());
    if (st <= genLog.startTime) {
      showNotice('Stop Time must be after Generator Start Time.', true);
      return;
    }

    setStoppingGenId(genLog.id);
    try {
      const res = await logGeneratorStop({
        log: genLog,
        stopTime: st,
        stopFuelLitres: stopL,
        stoppedByName: activeStopBy.trim() || currentUserName,
        stopSignature: stopSignature || undefined,
        notes: activeStopNotes,
      });
      onDataChanged?.();
      setActiveStopFuelLitres('');
      setActiveStopNotes('');
      setActiveStopTime(dtl(new Date()));
      clearCanvas(stopCanvasRef.current, setStopSignature);
      showNotice(
        res.ok
          ? `Generator stopped & synced — ${res.saved.fuelUsedLitres ?? 0} L used over ${formatDurationHm(res.saved.durationMinutes)}.`
          : `Generator stop cached offline (${res.error || 'Queued for sync'}).`
      );
    } finally {
      setStoppingGenId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Card */}
      <div className="rounded-xl border border-slate-200 bg-white/95 p-4 sm:p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#0F1E36]">
              <Zap className="h-4 w-4 text-amber-600" />
              <span>LG PLAST Power Cut &amp; Generator Fuel Log (Litres)</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Permanent utility outage timestamps, total power cut durations, and start/stop generator fuel monitoring synced directly with Machine Status Board.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSubTab('power_cuts')}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition border ${
                subTab === 'power_cuts'
                  ? 'bg-[#0F1E36] text-white border-[#0F1E36] shadow-xs'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Power className="h-3.5 w-3.5" />
              <span>Power Cut Logs</span>
              {ongoingPowerCuts.length > 0 && (
                <span className="ml-1 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                  {ongoingPowerCuts.length} ONGOING
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setSubTab('generator')}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition border ${
                subTab === 'generator'
                  ? 'bg-[#0F1E36] text-white border-[#0F1E36] shadow-xs'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Fuel className="h-3.5 w-3.5" />
              <span>Generator Start / Stop (L)</span>
              {runningGenerators.length > 0 && (
                <span className="ml-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                  RUNNING
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Date Filter + Admin Report Bar */}
        <div className="mt-4 pt-3.5 border-t border-slate-200 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                From Date
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                To Date
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setFromDate('');
                setToDate('');
              }}
              className="rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              All Dates
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isAdmin ? (
              subTab === 'power_cuts' ? (
                <button
                  type="button"
                  onClick={() => exportPowerCutExcel(powerCutLogs, fromDate, toDate, isAdmin)}
                  disabled={filteredPowerCuts.length === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#1A2F52] px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download Power Cut Excel ({filteredPowerCuts.length})</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => exportGeneratorExcel(generatorLogs, fromDate, toDate, isAdmin)}
                  disabled={filteredGeneratorLogs.length === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#1A2F52] px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download Generator Excel ({filteredGeneratorLogs.length})</span>
                </button>
              )
            ) : (
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-600">
                <Lock className="h-3.5 w-3.5 text-slate-500" />
                <span>Excel Reports: Admin Only</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Feedback Banner */}
      {notice && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs font-semibold flex items-center gap-2 ${
            notice.isError
              ? 'border-rose-300 bg-rose-50 text-rose-800'
              : 'border-emerald-300 bg-emerald-50 text-emerald-800'
          }`}
        >
          {notice.isError ? (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {/* ====================================================== */}
      {/* TAB 1: POWER CUT LOGS                                  */}
      {/* ====================================================== */}
      {subTab === 'power_cuts' && (
        <div className="space-y-5">
          {/* KPI Summary Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 tabular-nums">
            <div className="rounded-xl border border-slate-200 bg-white/95 p-4 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500 uppercase">
                Power Cut Incidents (Filtered)
              </div>
              <div className="text-2xl font-bold text-[#0F1E36] mt-1">
                {filteredPowerCuts.length}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {ongoingPowerCuts.length} ongoing ·{' '}
                {filteredPowerCuts.filter((l) => l.status === 'RESTORED').length} restored
              </div>
            </div>

            <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4 shadow-xs">
              <div className="text-[11px] font-semibold text-rose-800 uppercase">
                Total Power Cut Duration
              </div>
              <div className="text-2xl font-bold text-rose-900 mt-1">
                {formatDurationHm(totalPowerCutMins)}
              </div>
              <div className="text-[11px] text-rose-700 mt-0.5">
                {r2(totalPowerCutMins / 60)} hrs total mains downtime
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white/95 p-4 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500 uppercase">
                Generator Supported Outages
              </div>
              <div className="text-2xl font-bold text-emerald-700 mt-1">
                {filteredPowerCuts.filter((l) => l.generatorUsed).length}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Outages backed up by Factory Generator
              </div>
            </div>
          </div>

          {/* Ongoing Power Cuts Alert Card with Quick Time Back Action */}
          {ongoingPowerCuts.length > 0 && (
            <div className="rounded-xl border border-rose-300 bg-rose-50/90 p-4 space-y-3 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-rose-900">
                  <AlertTriangle className="h-4 w-4 text-rose-700" />
                  <span>Active Ongoing Power Cut(s) — Awaiting Time Back</span>
                </div>
                <span className="text-[11px] font-semibold text-rose-700 tabular-nums">
                  {ongoingPowerCuts.length} Active
                </span>
              </div>

              <div className="space-y-2.5">
                {ongoingPowerCuts.map((log) => {
                  const elapsedMins = calcDurationMinutes(log.timeOut);
                  const tbVal = closingTimeBackMap[log.id] ?? dtl(new Date());
                  const genUsedVal =
                    typeof closingGenUsedMap[log.id] === 'boolean'
                      ? closingGenUsedMap[log.id]
                      : log.generatorUsed;

                  return (
                    <div
                      key={log.id}
                      className="rounded-lg border border-rose-200 bg-white p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                    >
                      <div className="space-y-1 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-[#0F1E36]">{log.affectedArea}</span>
                          <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                            {log.shift} Shift
                          </span>
                          <span className="text-[11px] font-semibold text-rose-700 tabular-nums">
                            Time Out: {log.date} {extractTimeLabel(log.timeOut)} ({formatDurationHm(elapsedMins)} elapsed)
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600">
                          Reason: {log.reason || 'Mains Power Outage'} · Logged by {log.loggedBy}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500">
                            Time Back
                          </label>
                          <input
                            type="datetime-local"
                            value={tbVal}
                            onChange={(e) =>
                              setClosingTimeBackMap((prev) => ({
                                ...prev,
                                [log.id]: e.target.value,
                              }))
                            }
                            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                          />
                        </div>
                        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 pt-3">
                          <input
                            type="checkbox"
                            checked={genUsedVal}
                            onChange={(e) =>
                              setClosingGenUsedMap((prev) => ({
                                ...prev,
                                [log.id]: e.target.checked,
                              }))
                            }
                            className="rounded border-slate-400"
                          />
                          <span>Gen Used</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => handleRestorePowerCut(log)}
                          disabled={closingId === log.id}
                          className="mt-3 rounded-lg bg-emerald-700 hover:bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition disabled:opacity-50"
                        >
                          {closingId === log.id ? 'Saving...' : 'Log Time Back'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Log Power Cut Form */}
          <form
            onSubmit={handleSavePowerCut}
            className="rounded-xl border border-slate-200 bg-white/95 p-4 sm:p-5 space-y-4 shadow-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#0F1E36]">
                <Clock className="h-4 w-4 text-rose-600" />
                <span>Log Power Cut (Time Out &amp; Time Back)</span>
              </div>
              <span className="text-[11px] text-slate-500">
                Leave Time Back blank if outage is still ongoing
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Date <span className="text-rose-600">*</span>
                </label>
                <input
                  type="date"
                  value={pwrDate}
                  onChange={(e) => setPwrDate(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Shift <span className="text-rose-600">*</span>
                </label>
                <select
                  value={pwrShift}
                  onChange={(e) => setPwrShift(e.target.value as 'Day' | 'Night')}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                >
                  <option value="Day">Day Shift (07:30 - 19:30)</option>
                  <option value="Night">Night Shift (19:30 - 07:30)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Time Out <span className="text-rose-600">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={pwrTimeOut}
                  onChange={(e) => setPwrTimeOut(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Time Back (Optional if Ongoing)
                </label>
                <input
                  type="datetime-local"
                  value={pwrTimeBack}
                  onChange={(e) => setPwrTimeBack(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Affected Area
                </label>
                <select
                  value={pwrArea}
                  onChange={(e) => setPwrArea(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                >
                  {AFFECTED_AREAS.map((area) => (
                    <option key={area} value={area}>
                      {area}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Reason / Fault Note
                </label>
                <input
                  type="text"
                  value={pwrReason}
                  onChange={(e) => setPwrReason(e.target.value)}
                  placeholder="e.g. ZESA Load Shedding / Feeder Trip"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                />
              </div>

              <div className="flex items-end pb-1.5">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={pwrGenUsed}
                    onChange={(e) => setPwrGenUsed(e.target.checked)}
                    className="rounded border-slate-400"
                  />
                  <span>Generator Started for Backup</span>
                </label>
              </div>
            </div>

            {pwrTimeBack && pwrTimeBack > pwrTimeOut && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-[#0F1E36] tabular-nums">
                Calculated Power Cut Duration:{' '}
                {formatDurationHm(calcDurationMinutes(pwrTimeOut, pwrTimeBack))} (
                {r2(calcDurationMinutes(pwrTimeOut, pwrTimeBack) / 60)} hrs)
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={pwrSaving}
                className="flex items-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#1A2F52] px-4 py-2 text-xs font-semibold text-white shadow-xs transition disabled:opacity-50"
              >
                <Power className="h-3.5 w-3.5" />
                <span>{pwrSaving ? 'Saving Power Cut...' : 'Save Permanent Power Cut Log'}</span>
              </button>
            </div>
          </form>

          {/* Filtered Power Cut History Table */}
          <div className="rounded-xl border border-slate-200 bg-white/95 overflow-hidden shadow-xs">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold text-[#0F1E36] uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                Power Cut Register ({filteredPowerCuts.length})
              </span>
              <span className="text-xs font-bold text-rose-800 tabular-nums">
                Total Duration: {formatDurationHm(totalPowerCutMins)} ({r2(totalPowerCutMins / 60)} hrs)
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="bg-slate-100 text-[11px] font-bold uppercase text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Shift</th>
                    <th className="px-3 py-2.5">Time Out</th>
                    <th className="px-3 py-2.5">Time Back</th>
                    <th className="px-3 py-2.5">Duration</th>
                    <th className="px-3 py-2.5">Area</th>
                    <th className="px-3 py-2.5">Gen Used</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Reason &amp; Sign-Off</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredPowerCuts.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                        No power cut entries found for this selected date range.
                      </td>
                    </tr>
                  ) : (
                    filteredPowerCuts.map((l) => {
                      const mins =
                        l.status === 'RESTORED'
                          ? l.durationMinutes
                          : calcDurationMinutes(l.timeOut);
                      return (
                        <tr key={l.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-semibold text-slate-900">{l.date}</td>
                          <td className="px-3 py-2 text-slate-700">{l.shift}</td>
                          <td className="px-3 py-2 font-semibold text-rose-700">
                            {extractTimeLabel(l.timeOut)}
                          </td>
                          <td className="px-3 py-2 font-semibold text-emerald-700">
                            {l.timeBack ? extractTimeLabel(l.timeBack) : 'ONGOING'}
                          </td>
                          <td className="px-3 py-2 font-bold text-[#0F1E36]">
                            {formatDurationHm(mins)} ({r2(mins / 60)}h)
                          </td>
                          <td className="px-3 py-2 text-slate-700">{l.affectedArea}</td>
                          <td className="px-3 py-2 text-slate-700">
                            {l.generatorUsed ? 'Yes' : 'No'}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${
                                l.status === 'RESTORED'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {l.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            <div>{l.reason || 'Mains Outage'}</div>
                            <div className="text-[10px] text-slate-400">
                              Out: {l.loggedBy}
                              {l.restoredBy ? ` · Back: ${l.restoredBy}` : ''}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {filteredPowerCuts.length > 0 && (
                  <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold text-[#0F1E36]">
                    <tr>
                      <td colSpan={4} className="px-3 py-2.5 uppercase text-[11px]">
                        Total Power Cut Duration ({filteredPowerCuts.length} incident(s))
                      </td>
                      <td className="px-3 py-2.5 text-rose-800">
                        {formatDurationHm(totalPowerCutMins)} ({r2(totalPowerCutMins / 60)} hrs)
                      </td>
                      <td colSpan={4} className="px-3 py-2.5 text-[11px] font-normal text-slate-600">
                        Exported to Power Cut Sheet &amp; Production Report Sheet 6
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================== */}
      {/* TAB 2: GENERATOR START UP & STOP LOG (LITRES)          */}
      {/* ====================================================== */}
      {subTab === 'generator' && (
        <div className="space-y-5">
          {/* Linked Machine Board Live Status Banner */}
          <div className="rounded-xl border border-slate-200 bg-white/95 p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                  runningGenerators.length > 0
                    ? 'bg-emerald-700 text-white'
                    : 'bg-[#0F1E36] text-white'
                }`}
              >
                <Flame className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-[#0F1E36]">
                  <span>Linked Machine: Generator</span>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                      runningGenerators.length > 0
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {runningGenerators.length > 0 ? 'ON LOAD (RUNNING)' : 'STANDBY'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5 tabular-nums">
                  <Link2 className="h-3 w-3" />
                  {latestGenerator ? (
                    <span>
                      Latest Run ({latestGenerator.date}): Start {extractTimeLabel(latestGenerator.startTime)} @{' '}
                      {latestGenerator.startFuelLitres} L
                      {latestGenerator.stopTime
                        ? ` → Stop ${extractTimeLabel(latestGenerator.stopTime)} @ ${latestGenerator.stopFuelLitres ?? 0} L (Used: ${latestGenerator.fuelUsedLitres ?? 0} L)`
                        : ' (Currently Running)'}
                    </span>
                  ) : latestMachineGenEntry ? (
                    <span>
                      Latest Machine Record: Start Fuel {latestMachineGenEntry.genStartFuel ?? 0} L
                      {latestMachineGenEntry.genOffFuel !== undefined
                        ? ` · Stop Fuel ${latestMachineGenEntry.genOffFuel} L`
                        : ''}
                    </span>
                  ) : (
                    <span>Start &amp; Stop fuel logs automatically update Machine Status Board in Litres (L).</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs tabular-nums">
              <div>
                <span className="text-[10px] text-slate-500 block uppercase">Period Run Hrs</span>
                <span className="font-bold text-[#0F1E36]">
                  {formatDurationHm(totalGenRunMins)} ({r2(totalGenRunMins / 60)}h)
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block uppercase">Period Fuel Used</span>
                <span className="font-bold text-amber-700">{totalGenFuelLitres} L</span>
              </div>
            </div>
          </div>

          {/* Active Running Generator -> Stop Form */}
          {runningGenerators.length > 0 && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50/85 p-4 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-emerald-900">
                  <Activity className="h-4 w-4 text-emerald-700" />
                  <span>Generator Currently Running — Log Stop &amp; Closing Fuel (L)</span>
                </div>
                <span className="rounded bg-emerald-700 px-2 py-0.5 text-[10px] font-bold text-white uppercase">
                  ON LOAD
                </span>
              </div>

              {runningGenerators.map((g) => {
                const enteredStopL = parseFloat(activeStopFuelLitres);
                const previewUsedL =
                  !Number.isNaN(enteredStopL) && enteredStopL >= 0
                    ? r2(Math.max(0, g.startFuelLitres - enteredStopL))
                    : null;

                return (
                  <div
                    key={g.id}
                    className="rounded-lg border border-emerald-200 bg-white p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs border-b border-slate-100 pb-2 tabular-nums">
                      <div>
                        <span className="font-bold text-[#0F1E36]">
                          Started: {g.date} {extractTimeLabel(g.startTime)}
                        </span>
                        <span className="ml-3 text-slate-600">
                          Start Fuel: <strong>{g.startFuelLitres} L</strong>
                        </span>
                        <span className="ml-3 text-slate-600">
                          Elapsed:{' '}
                          <strong>{formatDurationHm(calcDurationMinutes(g.startTime))}</strong>
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500">
                        Started By: {g.operatorName}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Stop Time <span className="text-rose-600">*</span>
                        </label>
                        <input
                          type="datetime-local"
                          value={activeStopTime}
                          onChange={(e) => setActiveStopTime(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Stop Fuel Level (Litres) <span className="text-rose-600">*</span>
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          placeholder={`Max ${g.startFuelLitres} L`}
                          value={activeStopFuelLitres}
                          onChange={(e) => setActiveStopFuelLitres(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Stopped By
                        </label>
                        <input
                          type="text"
                          value={activeStopBy}
                          onChange={(e) => setActiveStopBy(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Stop Notes
                        </label>
                        <input
                          type="text"
                          value={activeStopNotes}
                          onChange={(e) => setActiveStopNotes(e.target.value)}
                          placeholder="e.g. Mains power restored"
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
                          <span className="flex items-center gap-1">
                            <PenTool className="h-3 w-3" /> Stop Sign-Off Signature
                          </span>
                          <button
                            type="button"
                            onClick={() => clearCanvas(stopCanvasRef.current, setStopSignature)}
                            className="text-slate-500 hover:text-slate-800 flex items-center gap-0.5"
                          >
                            <Eraser className="h-3 w-3" /> Clear
                          </button>
                        </div>
                        <canvas
                          ref={stopCanvasRef}
                          width={260}
                          height={64}
                          onMouseDown={(e) =>
                            beginCanvasStroke(stopCanvasRef.current, e, setIsDrawingStopSig)
                          }
                          onMouseMove={(e) =>
                            moveCanvasStroke(stopCanvasRef.current, isDrawingStopSig, e)
                          }
                          onMouseUp={() =>
                            endCanvasStroke(
                              stopCanvasRef.current,
                              setIsDrawingStopSig,
                              setStopSignature
                            )
                          }
                          onMouseLeave={() => {
                            if (isDrawingStopSig) {
                              endCanvasStroke(
                                stopCanvasRef.current,
                                setIsDrawingStopSig,
                                setStopSignature
                              );
                            }
                          }}
                          onTouchStart={(e) =>
                            beginCanvasStroke(stopCanvasRef.current, e, setIsDrawingStopSig)
                          }
                          onTouchMove={(e) =>
                            moveCanvasStroke(stopCanvasRef.current, isDrawingStopSig, e)
                          }
                          onTouchEnd={() =>
                            endCanvasStroke(
                              stopCanvasRef.current,
                              setIsDrawingStopSig,
                              setStopSignature
                            )
                          }
                          className="rounded-lg border border-slate-300 bg-slate-50 touch-none cursor-crosshair"
                        />
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        {previewUsedL !== null && (
                          <div className="text-xs font-bold text-[#0F1E36] tabular-nums">
                            Calculated Fuel Used: <span className="text-amber-700">{previewUsedL} L</span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => handleStopActiveGenerator(g)}
                          disabled={stoppingGenId === g.id}
                          className="flex items-center gap-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition disabled:opacity-50"
                        >
                          <Square className="h-3.5 w-3.5" />
                          <span>
                            {stoppingGenId === g.id ? 'Stopping...' : 'Log Generator Stop'}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Start Up Generator / Log Completed Run Form */}
          <form
            onSubmit={handleSubmitGeneratorStart}
            className="rounded-xl border border-slate-200 bg-white/95 p-4 sm:p-5 space-y-4 shadow-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#0F1E36]">
                <Play className="h-4 w-4 text-emerald-700" />
                <span>Generator Start Up / Run Entry (Fuel in Litres)</span>
              </div>

              <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setGenMode('start')}
                  className={`rounded-md px-2.5 py-1 transition ${
                    genMode === 'start'
                      ? 'bg-[#0F1E36] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Start Generator Now
                </button>
                <button
                  type="button"
                  onClick={() => setGenMode('completed')}
                  className={`rounded-md px-2.5 py-1 transition ${
                    genMode === 'completed'
                      ? 'bg-[#0F1E36] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Log Full Start &amp; Stop Run
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Date <span className="text-rose-600">*</span>
                </label>
                <input
                  type="date"
                  value={genDate}
                  onChange={(e) => setGenDate(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Shift <span className="text-rose-600">*</span>
                </label>
                <select
                  value={genShift}
                  onChange={(e) => setGenShift(e.target.value as 'Day' | 'Night')}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
                >
                  <option value="Day">Day Shift (07:30 - 19:30)</option>
                  <option value="Night">Night Shift (19:30 - 07:30)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Start Time <span className="text-rose-600">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={genStartTime}
                  onChange={(e) => setGenStartTime(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Start Fuel Level (Litres) <span className="text-rose-600">*</span>
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder="e.g. 180.0 L"
                  value={genStartFuelLitres}
                  onChange={(e) => setGenStartFuelLitres(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
                />
              </div>

              {genMode === 'completed' && (
                <>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Stop Time <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="datetime-local"
                      value={genStopTime}
                      onChange={(e) => setGenStopTime(e.target.value)}
                      required
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Stop Fuel Level (Litres) <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="e.g. 142.5 L"
                      value={genStopFuelLitres}
                      onChange={(e) => setGenStopFuelLitres(e.target.value)}
                      required
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Stopped By
                    </label>
                    <input
                      type="text"
                      value={genStoppedByName}
                      onChange={(e) => setGenStoppedByName(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Link Power Cut Event (Optional)
                </label>
                <select
                  value={genLinkedPowerCutId}
                  onChange={(e) => setGenLinkedPowerCutId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
                >
                  <option value="">-- Standalone / Not Linked --</option>
                  {powerCutLogs.slice(0, 20).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.date} {extractTimeLabel(p.timeOut)} — {p.affectedArea} ({p.status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Operator / Started By <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  value={genOperatorName}
                  onChange={(e) => setGenOperatorName(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Reason / Load Description
                </label>
                <input
                  type="text"
                  value={genReason}
                  onChange={(e) => setGenReason(e.target.value)}
                  placeholder="e.g. Mains Outage / Extrusion Backup"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Additional Notes
                </label>
                <input
                  type="text"
                  value={genNotes}
                  onChange={(e) => setGenNotes(e.target.value)}
                  placeholder="Oil pressure, tank checks..."
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
                />
              </div>
            </div>

            {genMode === 'completed' &&
              genStartFuelLitres &&
              genStopFuelLitres &&
              !Number.isNaN(parseFloat(genStartFuelLitres)) &&
              !Number.isNaN(parseFloat(genStopFuelLitres)) && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-[#0F1E36] tabular-nums">
                  Run Summary Preview: Duration{' '}
                  {formatDurationHm(calcDurationMinutes(genStartTime, genStopTime))} · Fuel Used:{' '}
                  <span className="text-amber-700">
                    {r2(Math.max(0, parseFloat(genStartFuelLitres) - parseFloat(genStopFuelLitres)))} L
                  </span>
                </div>
              )}

            <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
                  <span className="flex items-center gap-1">
                    <PenTool className="h-3 w-3" /> Operator Digital Signature
                  </span>
                  <button
                    type="button"
                    onClick={() => clearCanvas(startCanvasRef.current, setStartSignature)}
                    className="text-slate-500 hover:text-slate-800 flex items-center gap-0.5"
                  >
                    <Eraser className="h-3 w-3" /> Clear
                  </button>
                </div>
                <canvas
                  ref={startCanvasRef}
                  width={260}
                  height={64}
                  onMouseDown={(e) =>
                    beginCanvasStroke(startCanvasRef.current, e, setIsDrawingStartSig)
                  }
                  onMouseMove={(e) =>
                    moveCanvasStroke(startCanvasRef.current, isDrawingStartSig, e)
                  }
                  onMouseUp={() =>
                    endCanvasStroke(
                      startCanvasRef.current,
                      setIsDrawingStartSig,
                      setStartSignature
                    )
                  }
                  onMouseLeave={() => {
                    if (isDrawingStartSig) {
                      endCanvasStroke(
                        startCanvasRef.current,
                        setIsDrawingStartSig,
                        setStartSignature
                      );
                    }
                  }}
                  onTouchStart={(e) =>
                    beginCanvasStroke(startCanvasRef.current, e, setIsDrawingStartSig)
                  }
                  onTouchMove={(e) =>
                    moveCanvasStroke(startCanvasRef.current, isDrawingStartSig, e)
                  }
                  onTouchEnd={() =>
                    endCanvasStroke(
                      startCanvasRef.current,
                      setIsDrawingStartSig,
                      setStartSignature
                    )
                  }
                  className="rounded-lg border border-slate-300 bg-slate-50 touch-none cursor-crosshair"
                />
              </div>

              <button
                type="submit"
                disabled={genSaving}
                className="flex items-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#1A2F52] px-4 py-2 text-xs font-semibold text-white shadow-xs transition disabled:opacity-50"
              >
                <Fuel className="h-3.5 w-3.5" />
                <span>
                  {genSaving
                    ? 'Syncing...'
                    : genMode === 'completed'
                    ? 'Save Complete Generator Run'
                    : 'Log Generator Start Up'}
                </span>
              </button>
            </div>
          </form>

          {/* Generator Run History Table */}
          <div className="rounded-xl border border-slate-200 bg-white/95 overflow-hidden shadow-xs">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold text-[#0F1E36] uppercase tracking-wider flex items-center gap-1.5">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Generator Start Up &amp; Stop Register ({filteredGeneratorLogs.length})
              </span>
              <span className="text-xs font-bold text-amber-800 tabular-nums">
                Total: {formatDurationHm(totalGenRunMins)} · {totalGenFuelLitres} L Used
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="bg-slate-100 text-[11px] font-bold uppercase text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Shift</th>
                    <th className="px-3 py-2.5">Start Time</th>
                    <th className="px-3 py-2.5">Start Fuel (L)</th>
                    <th className="px-3 py-2.5">Stop Time</th>
                    <th className="px-3 py-2.5">Stop Fuel (L)</th>
                    <th className="px-3 py-2.5">Fuel Used (L)</th>
                    <th className="px-3 py-2.5">Duration</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Operators &amp; Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredGeneratorLogs.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                        No generator runs logged for the selected date range.
                      </td>
                    </tr>
                  ) : (
                    filteredGeneratorLogs.map((g) => {
                      const mins =
                        g.status === 'STOPPED'
                          ? g.durationMinutes
                          : calcDurationMinutes(g.startTime);
                      return (
                        <tr key={g.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-semibold text-slate-900">{g.date}</td>
                          <td className="px-3 py-2 text-slate-700">{g.shift}</td>
                          <td className="px-3 py-2 font-semibold text-emerald-700">
                            {extractTimeLabel(g.startTime)}
                          </td>
                          <td className="px-3 py-2 font-semibold text-slate-900">
                            {r2(g.startFuelLitres)} L
                          </td>
                          <td className="px-3 py-2 font-semibold text-slate-700">
                            {g.stopTime ? extractTimeLabel(g.stopTime) : 'RUNNING'}
                          </td>
                          <td className="px-3 py-2 font-semibold text-slate-900">
                            {typeof g.stopFuelLitres === 'number'
                              ? `${r2(g.stopFuelLitres)} L`
                              : '—'}
                          </td>
                          <td className="px-3 py-2 font-bold text-amber-700">
                            {typeof g.fuelUsedLitres === 'number'
                              ? `${r2(g.fuelUsedLitres)} L`
                              : '—'}
                          </td>
                          <td className="px-3 py-2 font-semibold text-[#0F1E36]">
                            {formatDurationHm(mins)}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${
                                g.status === 'RUNNING'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {g.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            <div>{g.reason || 'Power Backup'}</div>
                            <div className="text-[10px] text-slate-400">
                              Start: {g.operatorName}
                              {g.stoppedByName ? ` · Stop: ${g.stoppedByName}` : ''}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {filteredGeneratorLogs.length > 0 && (
                  <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold text-[#0F1E36]">
                    <tr>
                      <td colSpan={6} className="px-3 py-2.5 uppercase text-[11px]">
                        Total Generator Consumption ({filteredGeneratorLogs.length} run(s))
                      </td>
                      <td className="px-3 py-2.5 text-amber-800">{totalGenFuelLitres} L</td>
                      <td className="px-3 py-2.5">
                        {formatDurationHm(totalGenRunMins)} ({r2(totalGenRunMins / 60)}h)
                      </td>
                      <td colSpan={2} className="px-3 py-2.5 text-[11px] font-normal text-slate-600">
                        Linked with Machine Card &amp; Period Production Report
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
