import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Award,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Eraser,
  FileCheck2,
  Filter,
  Flame,
  Gauge,
  History,
  Lock,
  PenTool,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  User,
  UserCheck,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';
import { calculateDayStats, dtl, fmtT, getCurrentShift, getOpenEntry, r2, toTimestamp, ymd } from '../services/downtimeCalc';
import { syncMachineFormToGeneratorLog } from '../services/powerGenStore';
import {
  DEFAULT_REPORTERS,
  DowntimeEntry,
  EXTRUSION_MACHINES,
  getMachineDepartment,
  INJECTION_MACHINES,
  JOB_CARD_PLANS,
  JobCardPlan,
  MIXER_MACHINES,
  RECYCLING_MACHINES,
  STOPPAGE_CATEGORIES,
  StoppageCategory,
  UTILITY_MACHINES,
} from '../types';
import { MASTER_JOB_CARDS } from '../types/jobCards';
import {
  ALL_STAFF_SELECT_OPTIONS,
  GENERAL_HAND_OPTIONS,
  MAINTENANCE_OPTIONS,
  OPERATOR_OPTIONS,
} from '../types/factoryStaff';

interface LogDowntimeViewProps {
  machines: string[];
  entries: DowntimeEntry[];
  selectedMachineDefault?: string;
  onSaveEntry: (entry: DowntimeEntry) => Promise<void>;
  onSaveEntriesBatch?: (entries: DowntimeEntry[]) => Promise<void>;
  onDeleteEntry?: (id: string) => Promise<void>;
  onViewCertificate?: (entry: DowntimeEntry) => void;
  currentUserName?: string;
  currentUserEmail?: string;
}

export const LogDowntimeView: React.FC<LogDowntimeViewProps> = ({
  machines,
  entries,
  selectedMachineDefault,
  onSaveEntry,
  onSaveEntriesBatch,
  onViewCertificate,
  currentUserName = 'Operator',
  currentUserEmail = '',
}) => {
  const currentShiftInfo = getCurrentShift();

  // Form State
  const [machine, setMachine] = useState<string>(selectedMachineDefault || machines[0] || 'Extrusion Machine 1');
  const [isMultiMachineMode, setIsMultiMachineMode] = useState<boolean>(false);
  const [selectedMachines, setSelectedMachines] = useState<string[]>(machines);
  const [category, setCategory] = useState<string>(STOPPAGE_CATEGORIES[0]);
  const [startTime, setStartTime] = useState<string>(dtl(new Date()));
  const [endTime, setEndTime] = useState<string>('');

  // Job Card State (Dropdown + Quick Filter Search)
  const [jobCardNo, setJobCardNo] = useState<string>(MASTER_JOB_CARDS[0]);
  const [jobCardSearch, setJobCardSearch] = useState<string>('');
  const [jobCardPlan, setJobCardPlan] = useState<JobCardPlan>('In progress');

  // Staff State with Dropdowns + Casual Hand Checkbox
  const [operator, setOperator] = useState<string>(OPERATOR_OPTIONS[0]?.value || 'FARAI MURONZWA');
  const [generalHand, setGeneralHand] = useState<string>(GENERAL_HAND_OPTIONS[0]?.value || 'TRIED CHAKUBVA');
  const [isCasualAssistant, setIsCasualAssistant] = useState<boolean>(false);
  const [casualHandName, setCasualHandName] = useState<string>('');

  const [mtncePerson, setMtncePerson] = useState<string>(MAINTENANCE_OPTIONS[0]?.value || 'MASIMBA MUKUKU');
  const [isCustomMtnce, setIsCustomMtnce] = useState<boolean>(false);
  const [customMtnceName, setCustomMtnceName] = useState<string>('');

  const [reportedBy, setReportedBy] = useState<string>(currentUserName || DEFAULT_REPORTERS[0]);
  const [customReporter, setCustomReporter] = useState<string>('');
  const [reason, setReason] = useState<string>('');

  useEffect(() => {
    if (selectedMachineDefault) {
      setIsMultiMachineMode(false);
      setMachine(selectedMachineDefault);
    }
  }, [selectedMachineDefault]);

  useEffect(() => {
    if (!isMultiMachineMode && (!machine || machine.startsWith('__') || (machines.length > 0 && !machines.includes(machine)))) {
      setMachine(selectedMachineDefault || machines[0] || 'Extrusion Machine 1');
    }
  }, [machines, isMultiMachineMode, machine, selectedMachineDefault]);

  useEffect(() => {
    if (currentUserName && reportedBy !== 'OTHER') {
      setReportedBy(currentUserName);
    }
  }, [currentUserName]);

  // Operational floor fields
  const [shift, setShift] = useState<'Day' | 'Night'>(currentShiftInfo.shift);
  const [outputPerHour, setOutputPerHour] = useState<string>('');
  const [runningWeight, setRunningWeight] = useState<string>('');

  // Utility Machine Telemetry
  const [chillerTemp, setChillerTemp] = useState<string>('');
  const [chillerPressure, setChillerPressure] = useState<string>('');
  const [chillerFreq, setChillerFreq] = useState<string>('');

  const [genStartTime, setGenStartTime] = useState<string>('');
  const [genStartFuel, setGenStartFuel] = useState<string>('');
  const [genOffTime, setGenOffTime] = useState<string>('');
  const [genOffFuel, setGenOffFuel] = useState<string>('');

  // Digital Signature
  const [signatureData, setSignatureData] = useState<string>('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Status / Feedback
  const [formMsg, setFormMsg] = useState<{ text: string; isError?: boolean } | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  const isUtility = machine.toLowerCase().includes('chiller') || machine.toLowerCase().includes('generator');
  const isChiller = machine.toLowerCase().includes('chiller');
  const isGenerator = machine.toLowerCase().includes('generator');
  const isBreakdownOrChange = category === 'Breakdown' || category.toLowerCase().includes('changeover');

  // Categorize machines for the select dropdown
  const extList = machines.filter((m) => EXTRUSION_MACHINES.includes(m as any) || m.toLowerCase().includes('extrusion') || m.toLowerCase().includes('pipe') || m.toLowerCase().includes('trunk') || m.toLowerCase().includes('duct'));
  const injList = machines.filter((m) => INJECTION_MACHINES.includes(m as any) || m.toLowerCase().includes('im ') || m.toLowerCase().includes('boot') || m.toLowerCase().includes('punch') || m.toLowerCase().includes('pallet'));
  const mixList = machines.filter((m) => MIXER_MACHINES.includes(m as any) || m.toLowerCase().includes('mixer'));
  const recList = machines.filter((m) => RECYCLING_MACHINES.includes(m as any) || m.toLowerCase().includes('crush') || m.toLowerCase().includes('shred') || m.toLowerCase().includes('pulver') || m.toLowerCase().includes('vib'));
  const utilList = machines.filter((m) => UTILITY_MACHINES.includes(m as any) || m.toLowerCase().includes('chiller') || m.toLowerCase().includes('gen'));

  const otherList = machines.filter(
    (m) =>
      !extList.includes(m) &&
      !injList.includes(m) &&
      !mixList.includes(m) &&
      !recList.includes(m) &&
      !utilList.includes(m)
  );

  // Filtered Job Cards based on search query
  const filteredJobCards = MASTER_JOB_CARDS.filter((jc) =>
    jc.toLowerCase().includes(jobCardSearch.toLowerCase())
  );

  // Canvas drawing handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = '#10b981'; // emerald-500
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      setSignatureData(canvas.toDataURL('image/png'));
    }
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureData('');
  };

  const handleMachineSelectChange = (val: string) => {
    if (val === '__ALL_MACHINES__') {
      setMachine(val);
      setIsMultiMachineMode(true);
      setSelectedMachines([...machines]);
    } else if (val === '__ALL_PRODUCTION__') {
      setMachine(val);
      setIsMultiMachineMode(true);
      setSelectedMachines(machines.filter((m) => !utilList.includes(m)));
    } else if (val === '__ALL_EXTRUSION__') {
      setMachine(val);
      setIsMultiMachineMode(true);
      setSelectedMachines([...extList]);
    } else if (val === '__ALL_INJECTION__') {
      setMachine(val);
      setIsMultiMachineMode(true);
      setSelectedMachines([...injList]);
    } else if (val === '__ALL_MIXER__') {
      setMachine(val);
      setIsMultiMachineMode(true);
      setSelectedMachines([...mixList]);
    } else if (val === '__ALL_RECYCLING__') {
      setMachine(val);
      setIsMultiMachineMode(true);
      setSelectedMachines([...recList]);
    } else {
      setMachine(val);
      setIsMultiMachineMode(false);
    }
  };

  const toggleMultiMachineItem = (mName: string) => {
    setSelectedMachines((prev) => {
      const next = prev.includes(mName) ? prev.filter((x) => x !== mName) : [...prev, mName];
      return next;
    });
    setMachine('__CUSTOM_MULTI__');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormMsg(null);

    const s = startTime;
    const en = endTime.trim();
    const finalReporter = reportedBy === 'OTHER' ? customReporter.trim() : reportedBy;
    const finalGeneralHand = isCasualAssistant ? casualHandName.trim() : generalHand.trim();
    const finalMtnce = isCustomMtnce ? customMtnceName.trim() : mtncePerson.trim();

    if (!finalReporter) {
      setFormMsg({ text: 'Please select or enter the person reporting.', isError: true });
      return;
    }

    if (en && toTimestamp(en) <= toTimestamp(s)) {
      setFormMsg({ text: 'Running-again time must be after the stop time.', isError: true });
      return;
    }

    const baseNow = Date.now();
    const buildEntryForMachine = (targetMachine: string, idx: number): DowntimeEntry => {
      const targetIsChiller = targetMachine.toLowerCase().includes('chiller');
      const targetIsGen = targetMachine.toLowerCase().includes('generator');
      return {
        id: `DT-${baseNow}-${idx}-${Math.floor(Math.random() * 1000)}`,
        m: targetMachine,
        cat: category,
        start: s,
        end: en,
        reason: reason.trim(),
        jcn: jobCardNo.trim() || undefined,
        jcp: jobCardPlan,
        rep: finalReporter,
        by: finalReporter,
        loggedBy: currentUserEmail || currentUserName || finalReporter,
        loggedByEmail: currentUserEmail || undefined,
        shift,
        operator: operator.trim() || undefined,
        generalHand: finalGeneralHand || undefined,
        isCasual: isCasualAssistant,
        mtncePerson: finalMtnce || undefined,
        outputPerHour: outputPerHour.trim() || undefined,
        runningWeight: runningWeight.trim() || undefined,
        chillerTemp: targetIsChiller && chillerTemp ? parseFloat(chillerTemp) : undefined,
        chillerPressure: targetIsChiller && chillerPressure ? parseFloat(chillerPressure) : undefined,
        chillerFreq: targetIsChiller && chillerFreq ? parseFloat(chillerFreq) : undefined,
        genStartTime: targetIsGen && genStartTime ? genStartTime : undefined,
        genStartFuel: targetIsGen && genStartFuel ? parseFloat(genStartFuel) : undefined,
        genOffTime: targetIsGen && genOffTime ? genOffTime : undefined,
        genOffFuel: targetIsGen && genOffFuel ? parseFloat(genOffFuel) : undefined,
        genFuelUnit: targetIsGen ? 'L' : undefined,
        upd: baseNow + idx,
        sy: 0,
        signature: signatureData || undefined,
        signedAt: signatureData ? new Date().toISOString() : undefined,
      };
    };

    try {
      if (isMultiMachineMode) {
        if (selectedMachines.length === 0) {
          setFormMsg({ text: 'Please select at least one machine in the multi-machine list.', isError: true });
          return;
        }

        const eligibleMachines: string[] = [];
        const skippedMachines: string[] = [];

        selectedMachines.forEach((targetM) => {
          if (!en && getOpenEntry(targetM, entries)) {
            skippedMachines.push(targetM);
          } else {
            eligibleMachines.push(targetM);
          }
        });

        if (eligibleMachines.length === 0) {
          setFormMsg({
            text: 'All selected machines already have active open stoppages. Enter a Running-again time or uncheck machines already OFF.',
            isError: true,
          });
          return;
        }

        const batchEntries = eligibleMachines.map((targetM, idx) => buildEntryForMachine(targetM, idx));
        if (onSaveEntriesBatch) {
          await onSaveEntriesBatch(batchEntries);
        } else {
          for (const item of batchEntries) {
            await onSaveEntry(item);
          }
        }
        await Promise.all(
          batchEntries
            .filter((item) => item.m.toLowerCase() === 'generator')
            .map((item) => syncMachineFormToGeneratorLog(item))
        );

        setReason('');
        setEndTime('');
        if (isCasualAssistant) setCasualHandName('');
        if (isCustomMtnce) setCustomMtnceName('');
        setOutputPerHour('');
        setRunningWeight('');
        setChillerTemp('');
        setChillerPressure('');
        setChillerFreq('');
        setGenStartTime('');
        setGenStartFuel('');
        setGenOffTime('');
        setGenOffFuel('');
        clearSignature();
        setStartTime(dtl(new Date()));
        setIsMultiMachineMode(false);
        setMachine(selectedMachineDefault || machines[0] || 'Extrusion Machine 1');
        setFormMsg({
          text: `Saved same stoppage across ${batchEntries.length} machines and synced online!${
            skippedMachines.length > 0 ? ` (${skippedMachines.length} already OFF skipped)` : ''
          }`,
        });
        return;
      }

      const m = machine.trim();
      // Check if machine already has an open stoppage if leaving end blank
      if (!en) {
        const open = getOpenEntry(m, entries);
        if (open) {
          setFormMsg({
            text: `${m} already has an active open stoppage (since ${fmtT(open.start)}). Mark it back to running first.`,
            isError: true,
          });
          return;
        }
      }

      const newEntry = buildEntryForMachine(m, 0);
      await onSaveEntry(newEntry);
      if (m.toLowerCase() === 'generator') {
        await syncMachineFormToGeneratorLog(newEntry);
      }
      setReason('');
      setEndTime('');
      if (isCasualAssistant) setCasualHandName('');
      if (isCustomMtnce) setCustomMtnceName('');
      setOutputPerHour('');
      setRunningWeight('');
      setChillerTemp('');
      setChillerPressure('');
      setChillerFreq('');
      setGenStartTime('');
      setGenStartFuel('');
      setGenOffTime('');
      setGenOffFuel('');
      clearSignature();
      setStartTime(dtl(new Date()));
      setFormMsg({ text: `Saved stoppage for ${m} and synced online!` });
    } catch (err: any) {
      setFormMsg({ text: err?.message || 'Error saving entry.', isError: true });
    }
  };

  // Filtered entries list
  const activeEntries = entries
    .filter((e) => !e.del)
    .filter((e) => {
      const q = searchFilter.toLowerCase();
      const matchesSearch =
        e.m.toLowerCase().includes(q) ||
        e.reason.toLowerCase().includes(q) ||
        (e.rep && e.rep.toLowerCase().includes(q)) ||
        (e.operator && e.operator.toLowerCase().includes(q)) ||
        (e.generalHand && e.generalHand.toLowerCase().includes(q)) ||
        (e.loggedBy && e.loggedBy.toLowerCase().includes(q)) ||
        (e.loggedByEmail && e.loggedByEmail.toLowerCase().includes(q)) ||
        (e.by && e.by.toLowerCase().includes(q)) ||
        (e.jcn && e.jcn.toLowerCase().includes(q));
      const matchesCat = categoryFilter === 'ALL' || e.cat === categoryFilter;
      return matchesSearch && matchesCat;
    })
    .sort((a, b) => toTimestamp(b.start) - toTimestamp(a.start));

  return (
    <div className="space-y-6">
      {/* Form Card */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-6 shadow-md backdrop-blur">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <Plus className="h-5 w-5 text-amber-400" />
              <span>Log a Stoppage / Machine Status</span>
            </h2>
            <p className="text-xs text-slate-400">
              Select Job Cards &amp; Roster Staff via Dropdown • Casuals Supported • Color Coded Status (Green/Yellow/Gold/Red)
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 text-[11px] font-bold text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              Auto-Sync Online Active
            </span>
          </div>
        </div>

        {/* User Attribution Banner */}
        <div className="mb-4 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2 text-xs">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-amber-400" />
            <span className="text-slate-300">
              Active User Account: <b className="text-white font-mono">{currentUserEmail || currentUserName}</b>
            </span>
          </div>
          <span className="text-[10px] text-slate-500 hidden sm:inline">
            Every entry is permanently credited to your account
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isMultiMachineMode && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    <Zap className="h-4 w-4 text-amber-400" />
                    <span>
                      Bulk Stoppage Mode: {selectedMachines.length} of {machines.length} Machines Selected
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    One stoppage entry with the same reason &amp; signature will be saved across all checked machines.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleMachineSelectChange('__ALL_MACHINES__')}
                    className="rounded-lg border border-amber-500/40 bg-amber-500/20 px-2 py-1 text-[10px] font-bold text-amber-200 hover:bg-amber-500/30"
                  >
                    All Plant ({machines.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMachineSelectChange('__ALL_PRODUCTION__')}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    Production Only ({machines.length - utilList.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMachineSelectChange('__ALL_EXTRUSION__')}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    Extrusion ({extList.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMachineSelectChange('__ALL_INJECTION__')}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    Injection ({injList.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedMachines([]);
                      setMachine('__CUSTOM_MULTI__');
                    }}
                    className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/20"
                  >
                    Uncheck All
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1.5 max-h-48 overflow-y-auto pr-1">
                {machines.map((mName) => {
                  const checked = selectedMachines.includes(mName);
                  const alreadyOff = Boolean(getOpenEntry(mName, entries));
                  return (
                    <label
                      key={mName}
                      className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] cursor-pointer transition ${
                        checked
                          ? 'border-amber-500/50 bg-amber-500/15 text-slate-100 font-semibold'
                          : 'border-slate-800 bg-slate-950/70 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMultiMachineItem(mName)}
                        className="h-3.5 w-3.5 rounded accent-amber-500 shrink-0"
                      />
                      <span className="truncate flex-1">{mName}</span>
                      {alreadyOff && (
                        <span
                          className="rounded bg-rose-500/20 text-rose-300 px-1 text-[9px] font-bold shrink-0"
                          title="Already has an active open stoppage"
                        >
                          OFF
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {/* Machine Dropdown Grouped by Department + Select All Machines */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-300">
                  Machine <span className="text-rose-400">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (isMultiMachineMode) {
                      setIsMultiMachineMode(false);
                      setMachine(machines[0] || 'Extrusion Machine 1');
                    } else {
                      handleMachineSelectChange('__ALL_MACHINES__');
                    }
                  }}
                  className={`rounded-lg px-2 py-0.5 text-[10px] font-bold border transition ${
                    isMultiMachineMode
                      ? 'bg-amber-500 text-slate-950 border-amber-400'
                      : 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25'
                  }`}
                >
                  {isMultiMachineMode ? `✓ All Selected (${selectedMachines.length})` : '⚡ Select All Machines'}
                </button>
              </div>
              <select
                value={machine}
                onChange={(e) => handleMachineSelectChange(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-amber-500 focus:outline-none font-semibold"
              >
                {extList.length > 0 && (
                  <optgroup label="1. EXTRUSION MACHINES">
                    {extList.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </optgroup>
                )}
                {injList.length > 0 && (
                  <optgroup label="2. INJECTION MOULDING MACHINES">
                    {injList.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </optgroup>
                )}
                {mixList.length > 0 && (
                  <optgroup label="3. MIXER MACHINES">
                    {mixList.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </optgroup>
                )}
                {recList.length > 0 && (
                  <optgroup label="4. RECYCLING MACHINES">
                    {recList.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </optgroup>
                )}
                {utilList.length > 0 && (
                  <optgroup label="5. UTILITY MACHINES">
                    {utilList.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </optgroup>
                )}
                {otherList.length > 0 && (
                  <optgroup label="OTHER MACHINES">
                    {otherList.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="BULK MULTI-MACHINE (ALL / DEPT)">
                  <option value="__ALL_MACHINES__">
                    ★ ALL MACHINES — Select All ({machines.length})
                  </option>
                  <option value="__ALL_PRODUCTION__">
                    ★ ALL PRODUCTION MACHINES ({machines.length - utilList.length})
                  </option>
                  <option value="__ALL_EXTRUSION__">
                    ★ ALL EXTRUSION MACHINES ({extList.length})
                  </option>
                  <option value="__ALL_INJECTION__">
                    ★ ALL INJECTION MACHINES ({injList.length})
                  </option>
                  <option value="__ALL_MIXER__">
                    ★ ALL MIXER MACHINES ({mixList.length})
                  </option>
                  <option value="__ALL_RECYCLING__">
                    ★ ALL RECYCLING MACHINES ({recList.length})
                  </option>
                  {machine === '__CUSTOM_MULTI__' && (
                    <option value="__CUSTOM_MULTI__">
                      ★ CUSTOM MULTI-SELECTION ({selectedMachines.length} machines)
                    </option>
                  )}
                </optgroup>
              </select>
            </div>

            {/* Type / Stoppage Category with Color Badging */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Stoppage Type <span className="text-rose-400">*</span>
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-amber-500 focus:outline-none font-semibold"
              >
                <option value="Breakdown">Breakdown (Red)</option>
                <option value="No planning">No planning (Yellow)</option>
                <option value="Production plan finish">Production plan finish (Gold)</option>
                <option value="Changeover (job card)">Changeover - Job card (Orange)</option>
                <option value="Planned maintenance">Planned maintenance (Blue)</option>
                <option value="No raw material">No raw material</option>
                <option value="No power / utilities">No power / utilities</option>
                <option value="No operator / other">No operator / other</option>
                <option value="Running update">Running update (Green)</option>
              </select>
            </div>

            {/* Shift Selection */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Shift <span className="text-rose-400">*</span>
              </label>
              <select
                value={shift}
                onChange={(e) => setShift(e.target.value as 'Day' | 'Night')}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
              >
                <option value="Day">Day Shift (07:30 - 19:30)</option>
                <option value="Night">Night Shift (19:30 - 07:30)</option>
              </select>
            </div>

            {/* Machine Stopped Datetime */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Machine stopped (date and time) <span className="text-rose-400">*</span>
              </label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>

            {/* Machine Running Again Datetime */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Machine running again <span className="text-slate-400 font-normal">(blank if still OFF)</span>
              </label>
              <div className="flex gap-1.5">
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                />
                {endTime ? (
                  <button
                    type="button"
                    onClick={() => setEndTime('')}
                    className="rounded-xl border border-slate-700 px-2 text-xs text-slate-400 hover:text-white"
                    title="Leave blank (still OFF)"
                  >
                    Clear
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEndTime(dtl(new Date()))}
                    className="rounded-xl border border-slate-700 bg-slate-800 px-2 text-xs text-slate-300 hover:text-white whitespace-nowrap"
                    title="Set to current time"
                  >
                    Now
                  </button>
                )}
              </div>
            </div>

            {/* Job Card Selection via Dropdown (with quick search helper) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-300">
                  Job Card Running Name <span className="text-amber-400">*</span>
                </label>
                <span className="text-[10px] text-slate-400 font-mono">
                  {filteredJobCards.length} in catalogue
                </span>
              </div>
              <div className="space-y-1">
                <select
                  value={jobCardNo}
                  onChange={(e) => setJobCardNo(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 font-bold focus:border-amber-500 focus:outline-none"
                >
                  <option value="">-- Select Job Card from Catalogue --</option>
                  {filteredJobCards.map((jc) => (
                    <option key={jc} value={jc}>
                      {jc}
                    </option>
                  ))}
                  <option value="CUSTOM">Other / Custom Job Card...</option>
                </select>

                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Quick filter 130+ cards (e.g. 110, hose, gumboot)..."
                    value={jobCardSearch}
                    onChange={(e) => setJobCardSearch(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900/80 pl-7 pr-2 py-1 text-[11px] text-slate-300 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Job Card Planning Status */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Job Card Planning Status
              </label>
              <select
                value={jobCardPlan}
                onChange={(e) => setJobCardPlan(e.target.value as JobCardPlan)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-amber-500 focus:outline-none font-semibold"
              >
                <option value="In progress">In progress (Green/Active)</option>
                <option value="Production plan finish">Production plan finish (Gold)</option>
                <option value="No planning">No planning (Yellow)</option>
                <option value="Finished">Finished (Complete)</option>
                <option value="On Target">On Target</option>
                <option value="Scheduled">Scheduled</option>
                <option value="Not applicable">Not applicable</option>
              </select>
            </div>

            {/* Operator Name via Dropdown */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Operator Name (Factory Staff Dropdown) <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                <select
                  value={operator}
                  onChange={(e) => setOperator(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 py-2 text-xs sm:text-sm text-slate-100 font-semibold focus:border-amber-500 focus:outline-none"
                >
                  <optgroup label="Qualified Operators & Supervisors">
                    {OPERATOR_OPTIONS.map((op) => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="All Factory Staff">
                    {ALL_STAFF_SELECT_OPTIONS.filter(
                      (s) => !OPERATOR_OPTIONS.some((o) => o.value === s.value)
                    ).map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
            </div>

            {/* General Hand / Assistant: Dropdown or Manual Type if Casual */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-300">
                  General Hand / Assistant
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-amber-300 font-bold cursor-pointer bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-lg hover:bg-amber-500/20 transition">
                  <input
                    type="checkbox"
                    checked={isCasualAssistant}
                    onChange={(e) => setIsCasualAssistant(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-0"
                  />
                  <span>Casual (Click to write name)</span>
                </label>
              </div>

              {isCasualAssistant ? (
                <div className="relative">
                  <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-amber-400" />
                  <input
                    type="text"
                    required
                    placeholder="Write casual worker full name..."
                    value={casualHandName}
                    onChange={(e) => setCasualHandName(e.target.value)}
                    className="w-full rounded-xl border border-amber-500/50 bg-slate-950 pl-9 pr-3 py-2 text-xs sm:text-sm text-amber-200 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none font-semibold shadow-inner"
                  />
                </div>
              ) : (
                <div className="relative">
                  <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                  <select
                    value={generalHand}
                    onChange={(e) => setGeneralHand(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 py-2 text-xs sm:text-sm text-slate-100 font-semibold focus:border-amber-500 focus:outline-none"
                  >
                    <optgroup label="Extruder & Injection Assistants">
                      {GENERAL_HAND_OPTIONS.map((gh) => (
                        <option key={gh.value} value={gh.value}>
                          {gh.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="All Staff Roster">
                      {ALL_STAFF_SELECT_OPTIONS.filter(
                        (s) => !GENERAL_HAND_OPTIONS.some((g) => g.value === s.value)
                      ).map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              )}
            </div>

            {/* Maintenance Person Attending via Dropdown */}
            <div className={isBreakdownOrChange ? 'sm:col-span-2 lg:col-span-1 rounded-xl p-2.5 bg-rose-500/10 border border-rose-500/30' : ''}>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-300">
                  Mtnce Person Attending {isBreakdownOrChange && <span className="text-rose-400 font-bold">(Breakdown)</span>}
                </label>
                <button
                  type="button"
                  onClick={() => setIsCustomMtnce(!isCustomMtnce)}
                  className="text-[10px] text-slate-400 hover:text-amber-300 underline"
                >
                  {isCustomMtnce ? 'Pick from staff' : 'Custom'}
                </button>
              </div>

              {isCustomMtnce ? (
                <input
                  type="text"
                  placeholder="Enter external technician or contractor..."
                  value={customMtnceName}
                  onChange={(e) => setCustomMtnceName(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              ) : (
                <div className="relative">
                  <Wrench className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-amber-400" />
                  <select
                    value={mtncePerson}
                    onChange={(e) => setMtncePerson(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 py-2 text-xs sm:text-sm text-slate-100 font-semibold focus:border-amber-500 focus:outline-none"
                  >
                    <optgroup label="Maintenance & Electrical Crew">
                      {MAINTENANCE_OPTIONS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Other Staff">
                      {ALL_STAFF_SELECT_OPTIONS.filter(
                        (s) => !MAINTENANCE_OPTIONS.some((o) => o.value === s.value)
                      ).map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              )}
            </div>

            {/* Running Output & Weight */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Running Output (speed/rate)
              </label>
              <input
                type="text"
                placeholder="e.g. 140 m/hr or 220 units/hr"
                value={outputPerHour}
                onChange={(e) => setOutputPerHour(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Running Weight
              </label>
              <input
                type="text"
                placeholder="e.g. 640 kg"
                value={runningWeight}
                onChange={(e) => setRunningWeight(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>

            {/* Person Reporting */}
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Person Reporting / Signing <span className="text-rose-400">*</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  value={reportedBy}
                  onChange={(e) => setReportedBy(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-amber-500 focus:outline-none font-semibold"
                >
                  {currentUserName && <option value={currentUserName}>{currentUserName} (Current Session)</option>}
                  {DEFAULT_REPORTERS.filter((n) => n !== currentUserName).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                  <option value="OTHER">Other / Custom Name...</option>
                </select>

                {reportedBy === 'OTHER' && (
                  <input
                    type="text"
                    placeholder="Enter technician / operator name..."
                    value={customReporter}
                    onChange={(e) => setCustomReporter(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                  />
                )}
              </div>
            </div>

            {/* Special Utility Telemetry for Chiller */}
            {isChiller && (
              <div className="sm:col-span-2 lg:col-span-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3.5 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
                  <Gauge className="h-4 w-4 text-cyan-400" />
                  <span>Utility Machine: Chiller Telemetry</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Water Temperature (°C)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="e.g. 11.5"
                      value={chillerTemp}
                      onChange={(e) => setChillerTemp(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Water Pressure (bar)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="e.g. 3.4"
                      value={chillerPressure}
                      onChange={(e) => setChillerPressure(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Frequency (Hz)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="e.g. 50.0"
                      value={chillerFreq}
                      onChange={(e) => setChillerFreq(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Special Utility Telemetry for Generator (Linked with Power Cut & Generator Fuel Log in Litres) */}
            {isGenerator && (
              <div className="sm:col-span-2 lg:col-span-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-amber-300">
                  <span className="flex items-center gap-2">
                    <Flame className="h-4 w-4 text-amber-400" />
                    <span>Utility Machine: Generator Log (Synced to Generator Register in Litres)</span>
                  </span>
                  {genStartFuel &&
                    genOffFuel &&
                    !Number.isNaN(parseFloat(genStartFuel)) &&
                    !Number.isNaN(parseFloat(genOffFuel)) && (
                      <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold text-amber-200 tabular-nums">
                        Fuel Used: {r2(Math.max(0, parseFloat(genStartFuel) - parseFloat(genOffFuel)))} L
                      </span>
                    )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Start Up Time
                    </label>
                    <input
                      type="time"
                      value={genStartTime}
                      onChange={(e) => setGenStartTime(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Start Fuel Level (Litres)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="e.g. 185 L"
                      value={genStartFuel}
                      onChange={(e) => setGenStartFuel(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Stop / Off Time
                    </label>
                    <input
                      type="time"
                      value={genOffTime}
                      onChange={(e) => setGenOffTime(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Stop Fuel Level (Litres)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="e.g. 152 L"
                      value={genOffFuel}
                      onChange={(e) => setGenOffFuel(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Reason for Downtime */}
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Reason for Downtime / Observations <span className="text-rose-400">*</span>
              </label>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                placeholder="e.g. heater band failed, die changeover to 110mm, scheduled cleaning, limit switch inspection"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
              />
            </div>

            {/* Digital Online Signature Box */}
            <div className="sm:col-span-2 lg:col-span-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <PenTool className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-bold text-slate-200">
                    Digital Signature (Sign Online)
                  </span>
                  <span className="text-[10px] text-slate-400 hidden sm:inline">
                    Draw with finger or stylus on phone screen
                  </span>
                </div>
                {signatureData && (
                  <button
                    type="button"
                    onClick={clearSignature}
                    className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300 hover:text-white"
                  >
                    <Eraser className="h-3 w-3" />
                    <span>Clear signature</span>
                  </button>
                )}
              </div>

              <div className="relative rounded-xl border border-dashed border-slate-700 bg-slate-900/50 overflow-hidden flex items-center justify-center min-h-[90px]">
                <canvas
                  ref={canvasRef}
                  width={600}
                  height={120}
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                  className="w-full h-[90px] cursor-crosshair touch-none"
                />
                {!signatureData && !isDrawing && (
                  <div className="pointer-events-none absolute text-xs text-slate-500 flex items-center gap-1.5">
                    <PenTool className="h-3.5 w-3.5" />
                    <span>Sign with touch or mouse here</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Form Actions & Message */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 px-6 py-2.5 text-xs sm:text-sm font-bold text-slate-950 shadow-md shadow-amber-950/40 active:scale-[0.98] transition"
              >
                <Plus className="h-4 w-4" />
                <span>
                  {isMultiMachineMode
                    ? `Save Stoppage for ${selectedMachines.length} Machines (Auto Sync)`
                    : 'Save Entry (Auto Sync Online)'}
                </span>
              </button>
            </div>

            {formMsg && (
              <div
                className={`text-xs font-semibold px-3 py-1.5 rounded-xl border flex items-center gap-1.5 ${
                  formMsg.isError
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                }`}
              >
                {formMsg.isError ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                <span>{formMsg.text}</span>
              </div>
            )}
          </div>
        </form>
      </div>

      {/* Entries List / Table matching color coding */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-6 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <FileCheck2 className="h-5 w-5 text-blue-400" />
              <span>Entries Log ({activeEntries.length})</span>
            </h2>
            <p className="text-xs text-slate-400">Color Coded: Red (Breakdown) • Yellow (No Planning) • Gold (Plan Finish) • Green (Running)</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search reason, machine, operator, user..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="rounded-xl border border-slate-800 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-xl border border-slate-800 bg-slate-950 py-1.5 px-2.5 text-xs text-slate-300 focus:border-blue-500 focus:outline-none"
            >
              <option value="ALL">All Categories</option>
              {STOPPAGE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Scrollable Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold whitespace-nowrap">
                <th className="py-2.5 px-3">Machine</th>
                <th className="py-2.5 px-3">Status / Type</th>
                <th className="py-2.5 px-3">Shift</th>
                <th className="py-2.5 px-3">Stopped</th>
                <th className="py-2.5 px-3">Running again</th>
                <th className="py-2.5 px-3 text-right">Hrs down</th>
                <th className="py-2.5 px-3">Reason</th>
                <th className="py-2.5 px-3">Operator</th>
                <th className="py-2.5 px-3">General Hand</th>
                <th className="py-2.5 px-3">Mtnce Person</th>
                <th className="py-2.5 px-3">Logged By</th>
                <th className="py-2.5 px-3">Job card</th>
                <th className="py-2.5 px-3">Plan</th>
                <th className="py-2.5 px-3 text-center">Sign</th>
                <th className="py-2.5 px-3 text-right">Status Lock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {activeEntries.length === 0 ? (
                <tr>
                  <td colSpan={15} className="py-8 text-center text-slate-500">
                    No downtime entries recorded yet.
                  </td>
                </tr>
              ) : (
                activeEntries.map((e) => {
                  const sTime = toTimestamp(e.start);
                  const eTime = e.end ? toTimestamp(e.end) : Date.now();
                  const downHours = r2((eTime - sTime) / 36e5);

                  // Color badge logic
                  const isBreakdown = e.cat === 'Breakdown';
                  const isNoPlan = e.cat === 'No planning' || e.jcp === 'No planning';
                  const isPlanDone = e.cat === 'Production plan finish' || e.jcp === 'Production plan finish' || e.jcp === 'Finished';
                  const isChangeover = e.cat.startsWith('Changeover');

                  let badgeColor = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
                  if (isBreakdown) {
                    badgeColor = 'bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold';
                  } else if (isNoPlan) {
                    badgeColor = 'bg-yellow-400/25 text-yellow-300 border border-yellow-400/60 font-bold';
                  } else if (isPlanDone) {
                    badgeColor = 'bg-amber-500/25 text-amber-300 border border-amber-400/60 font-bold';
                  } else if (isChangeover) {
                    badgeColor = 'bg-orange-500/20 text-orange-300 border border-orange-500/40';
                  }

                  return (
                    <tr
                      key={e.id}
                      className="hover:bg-slate-850/50 transition-colors whitespace-nowrap"
                    >
                      <td className="py-2.5 px-3 font-bold text-slate-100">{e.m}</td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] ${badgeColor}`}>
                          {e.cat}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            e.shift === 'Night'
                              ? 'bg-indigo-500/20 text-indigo-300'
                              : 'bg-amber-500/20 text-amber-300'
                          }`}
                        >
                          {e.shift || 'Day'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-300 font-mono text-[11px]">
                        {fmtT(e.start)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px]">
                        {e.end ? (
                          <span className="text-slate-300">{fmtT(e.end)}</span>
                        ) : (
                          <span className="inline-block rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-400 border border-rose-500/30">
                            still OFF
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-300">
                        {downHours}
                      </td>
                      <td
                        className="py-2.5 px-3 text-slate-300 whitespace-normal max-w-xs text-xs"
                        style={{ minWidth: '160px' }}
                      >
                        {e.reason}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300 font-medium">
                        {e.operator || '-'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300 font-medium">
                        {e.generalHand ? (
                          <span className="flex items-center gap-1">
                            <span>{e.generalHand}</span>
                            {e.isCasual && (
                              <span className="rounded bg-amber-500/20 text-amber-300 px-1 py-0.2 text-[9px] font-bold">
                                Casual
                              </span>
                            )}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-amber-300 font-medium">
                        {e.mtncePerson || '-'}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px]">
                        {(e.loggedByEmail || e.loggedBy || e.rep || '').includes('0714282338') ? (
                          <span className="inline-flex items-center gap-1 rounded bg-blue-500/20 px-2 py-0.5 text-blue-300 font-bold border border-blue-500/40">
                            📱 0714282338 (Floor)
                          </span>
                        ) : (
                          <span className="text-slate-400">{e.loggedByEmail || e.loggedBy || e.rep || '-'}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300 font-mono font-semibold">
                        {e.jcn || '-'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${
                            e.jcp === 'No planning'
                              ? 'bg-yellow-400/20 text-yellow-300 border border-yellow-400/40'
                              : e.jcp === 'Production plan finish' || e.jcp === 'Finished'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {e.jcp || '-'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {e.signature ? (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 cursor-pointer hover:underline"
                            onClick={() => onViewCertificate && onViewCertificate(e)}
                            title="Signed online. Click to view verification receipt"
                          >
                            <FileCheck2 className="h-3.5 w-3.5" />
                            <span>Signed</span>
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[11px]">Unsigned</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] font-semibold text-slate-400"
                          title="Permanent record — posted logs cannot be deleted"
                        >
                          <Lock className="h-3 w-3 text-amber-400" />
                          <span>Protected</span>
                        </span>
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
  );
};
