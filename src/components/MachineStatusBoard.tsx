import React, { useState } from 'react';
import {
  Activity,
  AlarmClock,
  AlertCircle,
  AlertOctagon,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  ExternalLink,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Filter,
  Flame,
  Gauge,
  History,
  Info,
  Maximize2,
  Package,
  PenTool,
  Play,
  Plus,
  Recycle,
  RefreshCw,
  Scale,
  Search,
  Sparkles,
  Trash2,
  Truck,
  User,
  Users,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { calculateDayStats, dtl, fmtT, getCurrentShift, getOpenEntry, r2, ymd } from '../services/downtimeCalc';
import { extractTimeLabel } from '../services/powerGenStore';
import {
  normalizeMachineMatchKey,
  saveSopProductionToFirebase,
  saveSopScrapToFirebase,
} from '../services/sopStore';
import {
  DispatchEntry,
  DowntimeEntry,
  EXTRUSION_MACHINES,
  GeneratorLog,
  getMachineDepartment,
  INJECTION_MACHINES,
  MachineDepartment,
  MIXER_MACHINES,
  normalizeMachineName,
  PowerCutLog,
  RECYCLING_MACHINES,
  SopProductionRecord,
  SopScrapRecord,
  UTILITY_MACHINES,
} from '../types';
import {
  GENERAL_HAND_OPTIONS,
  OPERATOR_OPTIONS,
  RECYCLING_OPTIONS,
} from '../types/factoryStaff';
import { MASTER_JOB_CARDS } from '../types/jobCards';

interface MachineStatusBoardProps {
  machines: string[];
  entries: DowntimeEntry[];
  dispatchEntries?: DispatchEntry[];
  sopProductionLogs?: SopProductionRecord[];
  sopScrapPipeline?: SopScrapRecord[];
  generatorLogs?: GeneratorLog[];
  powerCutLogs?: PowerCutLog[];
  onOpenPowerGenTab?: (sub?: 'power_cuts' | 'generator') => void;
  onLogStoppage: (machine: string) => void;
  onRestoreRunning: (entryId: string, machine: string) => void;
  onSaveEntry?: (entry: DowntimeEntry) => Promise<void> | void;
  onOpenWeightOutputSchedule?: () => void;
  onViewCertificate?: (entry: DowntimeEntry) => void;
  canQuickLog?: boolean;
  currentUserName?: string;
  currentUserEmail?: string;
}

export const MachineStatusBoard: React.FC<MachineStatusBoardProps> = ({
  machines,
  entries,
  dispatchEntries = [],
  sopProductionLogs = [],
  sopScrapPipeline = [],
  generatorLogs = [],
  powerCutLogs = [],
  onOpenPowerGenTab,
  onLogStoppage,
  onRestoreRunning,
  onSaveEntry,
  onOpenWeightOutputSchedule,
  onViewCertificate,
  canQuickLog = true,
  currentUserName,
  currentUserEmail,
}) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'RUNNING' | 'BREAKDOWN' | 'NOPLANNING' | 'PLANFINISH' | 'CHANGEOVER' | 'OFF'>('ALL');
  const [deptFilter, setDeptFilter] = useState<MachineDepartment | 'ALL'>('ALL');

  // Machine Log History Modal State
  const [selectedHistoryMachine, setSelectedHistoryMachine] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');

  // Quick Floor & SOP Log Modal State (Product, Weight, Output, Assistant Scrap, Wastage)
  const [quickLogMachine, setQuickLogMachine] = useState<string | null>(null);
  const [qlProduct, setQlProduct] = useState<string>(MASTER_JOB_CARDS[0] || '');
  const [qlCustomProduct, setQlCustomProduct] = useState<string>('');
  const [qlRunningWeight, setQlRunningWeight] = useState<string>('');
  const [qlRunningOutput, setQlRunningOutput] = useState<string>('');
  const [qlOperator, setQlOperator] = useState<string>(OPERATOR_OPTIONS[0]?.value || '');
  const [qlAssistant, setQlAssistant] = useState<string>(GENERAL_HAND_OPTIONS[0]?.value || '');
  const [qlIsCasualAssistant, setQlIsCasualAssistant] = useState<boolean>(false);
  const [qlCasualName, setQlCasualName] = useState<string>('');
  const [qlProdQty, setQlProdQty] = useState<string>('');
  const [qlProdKg, setQlProdKg] = useState<string>('');
  const [qlScrapKg, setQlScrapKg] = useState<string>('');
  const [qlScrapReason, setQlScrapReason] = useState<string>('');
  const [qlAssignedRecycler, setQlAssignedRecycler] = useState<string>(
    RECYCLING_OPTIONS[0]?.value || 'BOTHWELL MATIBHIRI'
  );
  const [qlSendScrapPopup, setQlSendScrapPopup] = useState<boolean>(true);
  const [qlWastageKg, setQlWastageKg] = useState<string>('');
  const [qlSaving, setQlSaving] = useState<boolean>(false);
  const [qlFeedback, setQlFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const todayStr = ymd(new Date());
  const currentShift = getCurrentShift();

  // Categorize machines strictly in the user's requested order:
  // Extrusion -> Injection -> Mixer -> Recycling -> Utility
  const sortMachines = (list: string[]) => {
    const deptOrder: Record<MachineDepartment, number> = {
      Extrusion: 1,
      Injection: 2,
      Mixer: 3,
      Recycling: 4,
      Utility: 5,
    };

    return [...list].sort((a, b) => {
      const deptA = getMachineDepartment(a);
      const deptB = getMachineDepartment(b);
      if (deptOrder[deptA] !== deptOrder[deptB]) {
        return deptOrder[deptA] - deptOrder[deptB];
      }
      return a.localeCompare(b);
    });
  };

  const orderedMachines = sortMachines(machines);

  // Compute machine stats
  let offCount = 0;
  let breakdownCount = 0;
  let noPlanningCount = 0;
  let planFinishCount = 0;
  let changeoverCount = 0;

  const machineStates = orderedMachines.map((m) => {
    const canonicalName = normalizeMachineName(m);
    const open = getOpenEntry(canonicalName, entries);
    const dept = getMachineDepartment(canonicalName);
    const isUtility = dept === 'Utility';
    const mKey = normalizeMachineMatchKey(canonicalName);

    // Latest historical entries for this machine
    const machineEntries = entries
      .filter((e) => normalizeMachineName(e.m).toLowerCase() === canonicalName.toLowerCase() && !e.del)
      .sort((a, b) => (b.upd || 0) - (a.upd || 0));

    const latestEntry = open || machineEntries[0];

    // Live Dispatch stock waiting on floor (PENDING_WH or PENDING_HOD) for this machine
    const waitingDispatches = dispatchEntries.filter(
      (d) =>
        (d.status === 'PENDING_WH' || d.status === 'PENDING_HOD') &&
        (normalizeMachineMatchKey(d.machine) === mKey ||
          d.machine.trim().toLowerCase() === m.trim().toLowerCase())
    );
    const waitingQty = waitingDispatches.reduce(
      (sum, d) => sum + Number(d.whReceivedQty ?? d.recordedQty ?? 0),
      0
    );
    const waitingWeightKg = r2(
      waitingDispatches.reduce(
        (sum, d) =>
          sum +
          Number(
            d.totalWeightKg ??
              (d.unitWeightKg || 0) * Number(d.whReceivedQty ?? d.recordedQty ?? 0)
          ),
        0
      )
    );
    const waitingWhCount = waitingDispatches.filter((d) => d.status === 'PENDING_WH').length;
    const waitingHodCount = waitingDispatches.filter((d) => d.status === 'PENDING_HOD').length;

    // Live SOP Production, Assistant SOP Scrap & Wastage for this machine
    const machineProdLogs = sopProductionLogs
      .filter(
        (p) =>
          normalizeMachineMatchKey(p.machine) === mKey ||
          p.machine.trim().toLowerCase() === m.trim().toLowerCase()
      )
      .sort((a, b) => (b.upd || 0) - (a.upd || 0));
    const latestProdLog = machineProdLogs[0];
    const todayProdLogs = machineProdLogs.filter((p) => p.date === todayStr);

    const todaySopScrapLogs = sopScrapPipeline.filter(
      (s) =>
        s.date === todayStr &&
        (normalizeMachineMatchKey(s.machine) === mKey ||
          s.machine.trim().toLowerCase() === m.trim().toLowerCase())
    );
    const todayAssistantScrapKg = r2(
      todaySopScrapLogs.reduce((sum, s) => sum + Number(s.scrapKg || 0), 0)
    );
    const todayProdScrapKg = r2(
      todayProdLogs.reduce((sum, p) => sum + Number(p.scrapKg || 0), 0)
    );
    const todayScrapKg =
      todayAssistantScrapKg > 0
        ? Math.max(todayAssistantScrapKg, todayProdScrapKg)
        : todayProdScrapKg;
    const todayWastageKg = r2(
      todayProdLogs.reduce((sum, p) => sum + Number(p.wastageCdKg || 0), 0)
    );
    const pendingRecycleCount = todaySopScrapLogs.filter(
      (s) => s.status === 'SENT_TO_RECYCLING'
    ).length;

    const isNoPlan =
      open?.cat === 'No planning' ||
      open?.jcp === 'No planning' ||
      (!open && latestEntry?.jcp === 'No planning');

    const isPlanDone =
      open?.cat === 'Production plan finish' ||
      open?.jcp === 'Production plan finish' ||
      open?.jcp === 'Finished' ||
      (!open && (latestEntry?.jcp === 'Production plan finish' || latestEntry?.jcp === 'Finished'));

    if (open) {
      offCount++;
      if (open.cat === 'Breakdown') breakdownCount++;
      else if (open.cat.startsWith('Changeover')) changeoverCount++;
    }

    if (isNoPlan) noPlanningCount++;
    if (isPlanDone) planFinishCount++;

    const todayStats = calculateDayStats(canonicalName, todayStr, entries);

    return {
      name: canonicalName,
      dept,
      isUtility,
      openEntry: open,
      latestEntry,
      latestProdLog,
      waitingDispatches,
      waitingQty,
      waitingWeightKg,
      waitingWhCount,
      waitingHodCount,
      todayScrapKg,
      todayWastageKg,
      pendingRecycleCount,
      isOff: !!open,
      isNoPlan,
      isPlanDone,
      stats: todayStats,
      historyCount: machineEntries.length,
    };
  });

  // Dynamically rearrange machines: all RUNNING machines first, all OFF/stopped machines last.
  // Inside each group, preserve factory section order (Extrusion -> Injection -> Mixer -> Recycling -> Utility) and name.
  const deptOrderRank: Record<MachineDepartment, number> = {
    Extrusion: 1,
    Injection: 2,
    Mixer: 3,
    Recycling: 4,
    Utility: 5,
  };
  const sortedMachineStates = [...machineStates].sort((a, b) => {
    if (a.isOff !== b.isOff) return a.isOff ? 1 : -1;
    if (deptOrderRank[a.dept] !== deptOrderRank[b.dept]) {
      return deptOrderRank[a.dept] - deptOrderRank[b.dept];
    }
    return a.name.localeCompare(b.name);
  });

  const runningCount = machines.length - offCount;
  const totalWaitingDispatchQty = machineStates.reduce((s, m) => s + m.waitingQty, 0);
  const totalWaitingDispatchWeight = r2(
    machineStates.reduce((s, m) => s + m.waitingWeightKg, 0)
  );
  const totalWaitingTrollies = machineStates.reduce((s, m) => s + m.waitingDispatches.length, 0);

  const openQuickLogModal = (machineItem: (typeof machineStates)[number]) => {
    const latest = machineItem.latestEntry;

    // Machine Dashboard reads strictly from Machine Board entries (never altered by Production Logger)
    const detectedProduct =
      latest?.jcn && latest.jcn !== 'JC-RUNNING' ? latest.jcn : latest?.jcn || '';

    const inMaster = MASTER_JOB_CARDS.includes(detectedProduct);
    setQlProduct(inMaster ? detectedProduct : detectedProduct ? '__CUSTOM__' : MASTER_JOB_CARDS[0] || '');
    setQlCustomProduct(inMaster ? '' : detectedProduct);
    setQlRunningWeight(latest?.runningWeight || '');
    setQlRunningOutput(latest?.outputPerHour || '');

    const detectedOp = latest?.operator || '';
    const opMatch = OPERATOR_OPTIONS.find(
      (o) => o.value.toLowerCase() === detectedOp.toLowerCase()
    );
    setQlOperator(opMatch ? opMatch.value : OPERATOR_OPTIONS[0]?.value || '');

    const detectedAst = latest?.generalHand || '';
    const astMatch = GENERAL_HAND_OPTIONS.find(
      (a) => a.value.toLowerCase() === detectedAst.toLowerCase()
    );
    if (astMatch) {
      setQlIsCasualAssistant(false);
      setQlAssistant(astMatch.value);
      setQlCasualName('');
    } else if (detectedAst && detectedAst !== 'General Hand') {
      setQlIsCasualAssistant(true);
      setQlCasualName(detectedAst);
    } else {
      setQlIsCasualAssistant(false);
      setQlAssistant(GENERAL_HAND_OPTIONS[0]?.value || '');
      setQlCasualName('');
    }

    setQlProdQty('');
    setQlProdKg('');
    setQlScrapKg('');
    setQlScrapReason('');
    setQlWastageKg('');
    setQlSendScrapPopup(true);
    setQlFeedback(null);
    setQuickLogMachine(machineItem.name);
  };

  const handleSaveQuickLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickLogMachine) return;
    const resolvedProduct =
      qlProduct === '__CUSTOM__' ? qlCustomProduct.trim() : qlProduct.trim();
    if (!resolvedProduct) {
      setQlFeedback({ type: 'err', text: 'Please select or enter the Running Product.' });
      return;
    }

    const resolvedAssistant = qlIsCasualAssistant
      ? qlCasualName.trim() || 'Casual Assistant'
      : qlAssistant;
    const scrapNum = Math.max(0, Number(qlScrapKg) || 0);
    const wastageNum = Math.max(0, Number(qlWastageKg) || 0);
    const prodQtyNum = Number(qlProdQty) || 0;
    const prodKgNum = Number(qlProdKg) || 0;
    const weightText = qlRunningWeight.trim();
    const outputText = qlRunningOutput.trim();

    setQlSaving(true);
    setQlFeedback(null);
    try {
      const now = new Date();
      const nowDtl = dtl(now);
      const dept = getMachineDepartment(quickLogMachine);
      const open = getOpenEntry(quickLogMachine, entries);

      // 1. Update live Machine Board DowntimeEntry snapshot (keeps stoppage status untouched)
      if (onSaveEntry) {
        if (open) {
          await onSaveEntry({
            ...open,
            jcn: resolvedProduct,
            operator: qlOperator,
            generalHand: resolvedAssistant,
            isCasual: qlIsCasualAssistant,
            runningWeight: weightText || open.runningWeight,
            outputPerHour: outputText || open.outputPerHour,
            upd: Date.now(),
          });
        } else {
          await onSaveEntry({
            id: `MQL_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            m: quickLogMachine,
            cat: 'Running Check',
            start: nowDtl,
            end: nowDtl,
            reason: `Floor Update: ${resolvedProduct}${
              weightText ? ` | Weight: ${weightText}` : ''
            }${outputText ? ` | Output: ${outputText}` : ''}${
              scrapNum > 0 ? ` | Scrap: ${scrapNum} kg` : ''
            }${wastageNum > 0 ? ` | Wastage: ${wastageNum} kg` : ''}`,
            jcn: resolvedProduct,
            jcp: 'On Target',
            rep: currentUserName || qlOperator || 'Floor User',
            by: currentUserEmail || '',
            operator: qlOperator,
            generalHand: resolvedAssistant,
            isCasual: qlIsCasualAssistant,
            outputPerHour: outputText || undefined,
            runningWeight: weightText || undefined,
            shift: currentShift.label,
            loggedBy: currentUserName || '',
            loggedByEmail: currentUserEmail || '',
            upd: Date.now(),
          });
        }
      }

      // 2. Only write to SOP Production Log when Scrap, Wastage, or Production Qty/Kg is explicitly logged
      if (scrapNum > 0 || wastageNum > 0 || prodQtyNum > 0 || prodKgNum > 0) {
        const parsedWeightNumeric = parseFloat(weightText.replace(/[^0-9.]/g, '')) || 0;
        const effectiveProdKg = prodKgNum > 0 ? prodKgNum : parsedWeightNumeric;
        await saveSopProductionToFirebase({
          id: `PROD_M_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          date: todayStr,
          shift: currentShift.shift,
          dept,
          machine: quickLogMachine,
          operator: qlOperator,
          assistant: resolvedAssistant,
          product: resolvedProduct,
          timeSlot: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          qty: prodQtyNum > 0 ? prodQtyNum : undefined,
          unit: prodQtyNum > 0 ? 'PCS' : 'KG',
          prodKg: effectiveProdKg,
          scrapKg: scrapNum,
          wastageCdKg: wastageNum,
          outputPerHour: outputText || undefined,
          runningWeight: weightText || undefined,
          scrapReason: qlScrapReason.trim() || undefined,
          reporter: currentUserName || currentUserEmail || qlOperator,
          source: 'MANUAL',
          loggedBy: currentUserEmail || currentUserName || 'Floor User',
          upd: Date.now(),
        });
      }

      // 3. If Assistant SOP Scrap > 0 & pop-up toggle enabled, send live handover to Recycling Team
      if (scrapNum > 0 && qlSendScrapPopup) {
        await saveSopScrapToFirebase({
          id: `SCRAP_M_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          date: todayStr,
          time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          shift: currentShift.shift,
          shiftInCharge: currentUserName || qlOperator,
          machine: quickLogMachine,
          product: resolvedProduct,
          sentByAssistant: resolvedAssistant,
          isCasualAssistant: qlIsCasualAssistant,
          scrapKg: scrapNum,
          scrapReason: qlScrapReason.trim() || 'Logged from Machine Interface',
          assignedRecycler: qlAssignedRecycler,
          sentAt: now.toISOString(),
          sentByEmail: currentUserEmail || '',
          status: 'SENT_TO_RECYCLING',
          upd: Date.now(),
        });
      }

      setQlFeedback({
        type: 'ok',
        text:
          scrapNum > 0 && qlSendScrapPopup
            ? `Saved! Product, weight, output, ${scrapNum} kg SOP scrap (Recycling Pop-Up sent!) & ${wastageNum} kg wastage updated live.`
            : 'Saved! Machine running details, background Production SOP log & wastage updated live.',
      });
      setQlScrapKg('');
      setQlScrapReason('');
      setQlWastageKg('');
      setQlProdQty('');
      setQlProdKg('');
    } catch (err: any) {
      setQlFeedback({
        type: 'err',
        text: err?.message || 'Failed to save machine update.',
      });
    } finally {
      setQlSaving(false);
    }
  };

  // Filter machines based on search, status and department (sorted Running first, OFF last)
  const filteredMachines = sortedMachineStates.filter((item) => {
    const matchesSearch = item.name.toLowerCase().includes(filterQuery.toLowerCase());

    const matchesDept = deptFilter === 'ALL' ? true : item.dept === deptFilter;

    let matchesStatus = true;
    if (statusFilter === 'RUNNING') matchesStatus = !item.isOff && !item.isNoPlan && !item.isPlanDone;
    else if (statusFilter === 'OFF') matchesStatus = item.isOff;
    else if (statusFilter === 'BREAKDOWN') matchesStatus = item.openEntry?.cat === 'Breakdown';
    else if (statusFilter === 'NOPLANNING') matchesStatus = item.isNoPlan;
    else if (statusFilter === 'PLANFINISH') matchesStatus = item.isPlanDone;
    else if (statusFilter === 'CHANGEOVER') matchesStatus = item.openEntry?.cat.startsWith('Changeover') ?? false;

    return matchesSearch && matchesDept && matchesStatus;
  });

  const firstOffIndex = filteredMachines.findIndex((item) => item.isOff);
  const runningFilteredCount = filteredMachines.filter((item) => !item.isOff).length;
  const offFilteredCount = filteredMachines.filter((item) => item.isOff).length;

  // History modal entries for selected machine
  const activeMachineHistory = selectedHistoryMachine
    ? entries
        .filter(
          (e) =>
            normalizeMachineName(e.m).toLowerCase() ===
              normalizeMachineName(selectedHistoryMachine).toLowerCase() && !e.del
        )
        .filter((e) => {
          if (!historySearch) return true;
          const q = historySearch.toLowerCase();
          return (
            e.reason?.toLowerCase().includes(q) ||
            e.jcn?.toLowerCase().includes(q) ||
            e.rep?.toLowerCase().includes(q) ||
            e.operator?.toLowerCase().includes(q) ||
            e.cat?.toLowerCase().includes(q)
          );
        })
        .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime())
    : [];

  return (
    <div className="space-y-4">
      {/* Top Banner / Floor Overview (Dark Blue Executive Machines Board) */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-xl border border-[#1E3A66] bg-[#0B1E3B] p-4 text-slate-100 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#163668] border border-blue-400/30 text-white shrink-0">
            <Activity className="h-5 w-5 text-emerald-300" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-base sm:text-lg font-bold tracking-tight text-white tabular-nums" id="sumline">
                {runningCount} Running · {offCount} Stopped ({machines.length} Units)
              </span>
              <span
                className={`text-xs font-semibold ${
                  breakdownCount > 0 ? 'text-rose-300' : 'text-emerald-300'
                }`}
              >
                {breakdownCount > 0
                  ? `${breakdownCount} Breakdown${noPlanningCount > 0 ? ` · ${noPlanningCount} No Planning` : ''}`
                  : 'Operational'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-300 mt-1 tabular-nums">
              <span>
                Shift: <b className="text-white">{currentShift.label}</b>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Dispatch Waiting: <b className="text-sky-300">{totalWaitingDispatchQty.toLocaleString()} pcs</b>
                {totalWaitingDispatchWeight > 0 ? ` (${totalWaitingDispatchWeight.toLocaleString()} kg)` : ''} · {totalWaitingTrollies} trollies
              </span>
              {onOpenWeightOutputSchedule && (
                <>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={onOpenWeightOutputSchedule}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-sky-300 underline decoration-sky-400/50 underline-offset-2 hover:text-white transition whitespace-nowrap"
                    title="Update Shift Running Weight & Output"
                  >
                    <AlarmClock className="h-3 w-3 text-sky-300" />
                    <span>Shift Weight Update</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Quick Filter Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="relative sm:w-52">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search machine..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-full rounded-lg border border-blue-400/35 bg-[#08152B] py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
            />
          </div>

          <div className="flex rounded-lg border border-blue-400/30 bg-[#08152B] p-1 text-xs font-semibold overflow-x-auto gap-1 tabular-nums">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`rounded-md px-2.5 py-1 transition whitespace-nowrap ${
                statusFilter === 'ALL' ? 'bg-[#1B3B6F] text-white shadow-xs' : 'text-slate-300 hover:text-white'
              }`}
            >
              All ({machines.length})
            </button>
            <button
              onClick={() => setStatusFilter('RUNNING')}
              className={`rounded-md px-2.5 py-1 transition whitespace-nowrap ${
                statusFilter === 'RUNNING' ? 'bg-emerald-600 text-white shadow-xs' : 'text-emerald-300 hover:bg-emerald-950/60'
              }`}
            >
              Run ({runningCount})
            </button>
            <button
              onClick={() => setStatusFilter('BREAKDOWN')}
              className={`rounded-md px-2.5 py-1 transition whitespace-nowrap ${
                statusFilter === 'BREAKDOWN' ? 'bg-rose-600 text-white shadow-xs' : 'text-rose-300 hover:bg-rose-950/60'
              }`}
            >
              Breakdown ({breakdownCount})
            </button>
            <button
              onClick={() => setStatusFilter('NOPLANNING')}
              className={`rounded-md px-2.5 py-1 transition whitespace-nowrap ${
                statusFilter === 'NOPLANNING' ? 'bg-amber-600 text-white shadow-xs' : 'text-amber-300 hover:bg-amber-950/50'
              }`}
            >
              No Plan ({noPlanningCount})
            </button>
            <button
              onClick={() => setStatusFilter('PLANFINISH')}
              className={`rounded-md px-2.5 py-1 transition whitespace-nowrap ${
                statusFilter === 'PLANFINISH' ? 'bg-[#1B3B6F] text-white shadow-xs' : 'text-slate-300 hover:text-white'
              }`}
            >
              Plan Finish ({planFinishCount})
            </button>
            <button
              onClick={() => setStatusFilter('CHANGEOVER')}
              className={`rounded-md px-2.5 py-1 transition whitespace-nowrap ${
                statusFilter === 'CHANGEOVER' ? 'bg-orange-600 text-white shadow-xs' : 'text-orange-300 hover:bg-orange-950/50'
              }`}
            >
              Changeover ({changeoverCount})
            </button>
          </div>
        </div>
      </div>

      {/* Department Tabs Bar (Extrusion -> Injection -> Mixer -> Recycling -> Utility) */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-semibold scrollbar-thin">
        <span className="text-[11px] text-slate-600 pr-1 shrink-0 font-semibold">
          Section:
        </span>
        <button
          onClick={() => setDeptFilter('ALL')}
          className={`shrink-0 rounded-lg px-3 py-1.5 transition border ${
            deptFilter === 'ALL'
              ? 'bg-[#0B1E3B] text-white border-emerald-500 shadow-xs'
              : 'border-blue-400/30 bg-[#0F264A]/90 text-slate-200 hover:bg-[#0B1E3B]'
          }`}
        >
          All ({machines.length})
        </button>
        <button
          onClick={() => setDeptFilter('Extrusion')}
          className={`shrink-0 rounded-lg px-3 py-1.5 transition border ${
            deptFilter === 'Extrusion'
              ? 'bg-[#0B1E3B] text-white border-emerald-500 shadow-xs'
              : 'border-blue-400/30 bg-[#0F264A]/90 text-slate-200 hover:bg-[#0B1E3B]'
          }`}
        >
          Extrusion ({EXTRUSION_MACHINES.length})
        </button>
        <button
          onClick={() => setDeptFilter('Injection')}
          className={`shrink-0 rounded-lg px-3 py-1.5 transition border ${
            deptFilter === 'Injection'
              ? 'bg-[#0B1E3B] text-white border-emerald-500 shadow-xs'
              : 'border-blue-400/30 bg-[#0F264A]/90 text-slate-200 hover:bg-[#0B1E3B]'
          }`}
        >
          Injection ({INJECTION_MACHINES.length})
        </button>
        <button
          onClick={() => setDeptFilter('Mixer')}
          className={`shrink-0 rounded-lg px-3 py-1.5 transition border ${
            deptFilter === 'Mixer'
              ? 'bg-[#0B1E3B] text-white border-emerald-500 shadow-xs'
              : 'border-blue-400/30 bg-[#0F264A]/90 text-slate-200 hover:bg-[#0B1E3B]'
          }`}
        >
          Mixer ({MIXER_MACHINES.length})
        </button>
        <button
          onClick={() => setDeptFilter('Recycling')}
          className={`shrink-0 rounded-lg px-3 py-1.5 transition border ${
            deptFilter === 'Recycling'
              ? 'bg-[#0B1E3B] text-white border-emerald-500 shadow-xs'
              : 'border-blue-400/30 bg-[#0F264A]/90 text-slate-200 hover:bg-[#0B1E3B]'
          }`}
        >
          Recycling ({RECYCLING_MACHINES.length})
        </button>
        <button
          onClick={() => setDeptFilter('Utility')}
          className={`shrink-0 rounded-lg px-3 py-1.5 transition border ${
            deptFilter === 'Utility'
              ? 'bg-[#0B1E3B] text-white border-emerald-500 shadow-xs'
              : 'border-blue-400/30 bg-[#0F264A]/90 text-slate-200 hover:bg-[#0B1E3B]'
          }`}
        >
          Utility ({UTILITY_MACHINES.length})
        </button>
      </div>

      {/* Grid of Machine Small Interfaces (Running Machines First -> OFF Machines Last) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4" id="board">
        {filteredMachines.map((item, idx) => {
          const showRunningBanner =
            idx === 0 && runningFilteredCount > 0 && offFilteredCount > 0;
          const showOffBanner =
            idx === firstOffIndex && offFilteredCount > 0 && runningFilteredCount > 0;
          const isOff = item.isOff;
          const open = item.openEntry;
          const stats = item.stats;
          const latest = item.latestEntry;
          const isChiller = item.name.toLowerCase() === 'chiller';
          const isGenerator = item.name.toLowerCase() === 'generator';
          const isUtility = item.isUtility;

          // Dark Blue Machines Board Card Styling:
          // - Running machines display bold green edges all around
          // - Off / Stopped machines display bold red edges all around
          let statusTextClass = 'text-emerald-300';
          let cardSurfaceClass =
            'border-2 border-emerald-500 ring-1 ring-emerald-500/45 bg-[#0B1E3B] shadow-[0_0_0_1px_rgba(16,185,129,0.22)]';
          let statusLabel = 'RUNNING';

          const isBreakdown = isOff && open?.cat === 'Breakdown';
          const isNoPlanning =
            open?.cat === 'No planning' ||
            open?.jcp === 'No planning' ||
            (!open && item.isNoPlan);
          const isPlanFinish =
            open?.cat === 'Production plan finish' ||
            open?.jcp === 'Production plan finish' ||
            open?.jcp === 'Finished' ||
            (!open && item.isPlanDone);
          const isChangeover = isOff && open?.cat.startsWith('Changeover');

          if (isBreakdown) {
            statusTextClass = 'text-rose-300';
            cardSurfaceClass =
              'border-2 border-rose-500 ring-1 ring-rose-500/50 bg-[#0B1E3B] shadow-[0_0_0_1px_rgba(244,63,94,0.28)]';
            statusLabel = 'BREAKDOWN';
          } else if (isOff) {
            cardSurfaceClass =
              'border-2 border-rose-500 ring-1 ring-rose-500/50 bg-[#0B1E3B] shadow-[0_0_0_1px_rgba(244,63,94,0.28)]';
            if (isNoPlanning) {
              statusTextClass = 'text-amber-300';
              statusLabel = 'NO PLANNING';
            } else if (isPlanFinish) {
              statusTextClass = 'text-amber-200';
              statusLabel = 'PLAN FINISH';
            } else if (isChangeover) {
              statusTextClass = 'text-orange-300';
              statusLabel = 'CHANGEOVER';
            } else if (open?.cat.startsWith('Planned')) {
              statusTextClass = 'text-sky-300';
              statusLabel = 'MAINTENANCE';
            } else {
              statusTextClass = 'text-rose-300';
              statusLabel = 'OFF';
            }
          } else if (isNoPlanning) {
            statusTextClass = 'text-amber-300';
            statusLabel = 'NO PLANNING';
          } else if (isPlanFinish) {
            statusTextClass = 'text-amber-200';
            statusLabel = 'PLAN FINISH';
          }

          // Machine Dashboard state resolved strictly from Machine Board entries
          const runningJobCard = open?.jcn || latest?.jcn || 'Not Set';
          const runningPlan = open?.jcp || latest?.jcp || (isOff ? 'In progress' : 'On Target');
          const runningOperator = open?.operator || latest?.operator || 'Plant Operator';
          const runningGeneralHand = open?.generalHand || latest?.generalHand || 'General Hand';
          const runningOutput =
            open?.outputPerHour || latest?.outputPerHour || (isUtility ? 'Normal' : '150 kg/hr');
          const runningWeight =
            open?.runningWeight || latest?.runningWeight || (isUtility ? '-' : '650 kg');
          const shiftText = open?.shift || latest?.shift || currentShift.label;

          return (
            <React.Fragment key={item.name}>
              {showRunningBanner && (
                <div className="col-span-full flex items-center justify-between border-2 border-emerald-500/80 bg-[#0B1E3B] rounded-lg px-3.5 py-2 text-xs font-bold text-emerald-300 shadow-xs">
                  <span>Running Machines ({runningFilteredCount})</span>
                  <span className="text-[11px] font-normal text-slate-300">
                    Active production units shown first
                  </span>
                </div>
              )}
              {showOffBanner && (
                <div className="col-span-full mt-2 flex items-center justify-between border-2 border-rose-500/80 bg-[#0B1E3B] rounded-lg px-3.5 py-2 text-xs font-bold text-rose-300 shadow-xs">
                  <span>Off / Stopped Machines ({offFilteredCount})</span>
                  <span className="text-[11px] font-normal text-slate-300">
                    Returns to Running section once restarted
                  </span>
                </div>
              )}
              <div
                className={`flex flex-col justify-between rounded-xl p-4 text-slate-100 transition-shadow duration-200 hover:shadow-md ${cardSurfaceClass}`}
              >
              <div>
                {/* Header Line */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <span className="text-[11px] font-medium text-slate-300 block">
                      {item.dept}
                    </span>
                    <h3 className="font-bold text-sm sm:text-base text-white leading-tight">
                      {item.name}
                    </h3>
                  </div>

                  <span
                    className={`text-[11px] font-bold tracking-wide shrink-0 ${statusTextClass}`}
                  >
                    {statusLabel}
                  </span>
                </div>

                {/* Stoppage Alert Banner if Stopped */}
                {isOff && open && (
                  <div className="rounded-lg border border-rose-400/50 bg-[#08152B] p-2.5 mb-3 text-xs text-slate-100">
                    <div className="font-semibold flex items-center justify-between">
                      <span className="text-rose-300">{open.cat}</span>
                      <span className="font-mono text-[10px] text-slate-300 tabular-nums">Since {fmtT(open.start)}</span>
                    </div>
                    <p className="mt-1 text-slate-200 leading-snug line-clamp-2">{open.reason}</p>
                    {open.mtncePerson && (
                      <div className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-200 font-medium">
                        <Wrench className="h-3 w-3 shrink-0 text-slate-300" />
                        <span>Technician: {open.mtncePerson}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Utility Special Interface: Chiller */}
                {isChiller && (
                  <div className="rounded-lg border border-blue-400/25 bg-[#08152B] p-2.5 mb-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-sky-200 font-semibold text-[11px]">
                      <span className="flex items-center gap-1">
                        <Gauge className="h-3.5 w-3.5 text-sky-300" /> Chiller Readings
                      </span>
                      <span className="text-[10px] text-slate-300">Loop Active</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 text-center pt-0.5 tabular-nums">
                      <div className="rounded-md bg-[#10284D] p-1.5 border border-blue-400/25">
                        <span className="text-[10px] text-slate-300 block">Temp</span>
                        <span className="text-xs font-bold text-white">
                          {open?.chillerTemp !== undefined ? `${open.chillerTemp} °C` : '13.5 °C'}
                        </span>
                      </div>
                      <div className="rounded-md bg-[#10284D] p-1.5 border border-blue-400/25">
                        <span className="text-[10px] text-slate-300 block">Pressure</span>
                        <span className="text-xs font-bold text-white">
                          {open?.chillerPressure !== undefined ? `${open.chillerPressure} bar` : '4.2 bar'}
                        </span>
                      </div>
                      <div className="rounded-md bg-[#10284D] p-1.5 border border-blue-400/25">
                        <span className="text-[10px] text-slate-300 block">Frequency</span>
                        <span className="text-xs font-bold text-white">
                          {open?.chillerFreq !== undefined ? `${open.chillerFreq} Hz` : '50.0 Hz'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Utility Special Interface: Generator (Litres & Linked with Power Cut / Generator Logs) */}
                {isGenerator && (() => {
                  const activeGenLog =
                    generatorLogs.find((g) => g.status === 'RUNNING') ||
                    [...generatorLogs].sort((a, b) =>
                      (b.date + b.startTime).localeCompare(a.date + a.startTime)
                    )[0];
                  const ongoingPwrCount = powerCutLogs.filter(
                    (p) => p.status === 'ONGOING' || !p.timeBack
                  ).length;
                  const isGenRunning = activeGenLog?.status === 'RUNNING';
                  const startTimeVal = activeGenLog
                    ? extractTimeLabel(activeGenLog.startTime)
                    : open?.genStartTime || latest?.genStartTime || '08:00';
                  const startFuelVal = activeGenLog
                    ? activeGenLog.startFuelLitres
                    : open?.genStartFuel ?? latest?.genStartFuel ?? 185;
                  const stopTimeVal = activeGenLog
                    ? activeGenLog.stopTime
                      ? extractTimeLabel(activeGenLog.stopTime)
                      : 'RUNNING'
                    : open?.genOffTime || latest?.genOffTime || '12:00';
                  const stopFuelVal = activeGenLog
                    ? activeGenLog.stopFuelLitres
                    : open?.genOffFuel ?? latest?.genOffFuel;
                  const usedFuelVal =
                    activeGenLog?.fuelUsedLitres ??
                    (typeof startFuelVal === 'number' && typeof stopFuelVal === 'number'
                      ? r2(Math.max(0, startFuelVal - stopFuelVal))
                      : undefined);

                  return (
                    <div className="rounded-lg border border-blue-400/25 bg-[#08152B] p-2.5 mb-3 space-y-2 text-xs">
                      <div className="flex items-center justify-between text-sky-200 font-semibold text-[11px]">
                        <span className="flex items-center gap-1">
                          <Zap className="h-3.5 w-3.5 text-amber-300" /> Generator Fuel (Litres)
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            isGenRunning
                              ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/40'
                              : 'bg-[#152E54] text-slate-200 border border-blue-400/30'
                          }`}
                        >
                          {isGenRunning ? 'ON LOAD' : 'STANDBY'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-center pt-0.5 tabular-nums">
                        <div className="rounded-md bg-[#10284D] p-1 border border-blue-400/25">
                          <span className="text-[10px] text-slate-300 block">Start</span>
                          <span className="text-[11px] font-bold text-white">
                            {startTimeVal}
                          </span>
                        </div>
                        <div className="rounded-md bg-[#10284D] p-1 border border-blue-400/25">
                          <span className="text-[10px] text-slate-300 block">Start Fuel</span>
                          <span className="text-[11px] font-bold text-white">
                            {`${r2(startFuelVal)} L`}
                          </span>
                        </div>
                        <div className="rounded-md bg-[#10284D] p-1 border border-blue-400/25">
                          <span className="text-[10px] text-slate-300 block">Stop</span>
                          <span className="text-[11px] font-bold text-white">
                            {stopTimeVal}
                          </span>
                        </div>
                        <div className="rounded-md bg-[#10284D] p-1 border border-blue-400/25">
                          <span className="text-[10px] text-slate-300 block">Stop Fuel</span>
                          <span className="text-[11px] font-bold text-white">
                            {typeof stopFuelVal === 'number' ? `${r2(stopFuelVal)} L` : '—'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px] tabular-nums">
                        <span className="font-semibold text-amber-300">
                          {typeof usedFuelVal === 'number'
                            ? `Fuel Used: ${usedFuelVal} L`
                            : 'Fuel Tracking Active (L)'}
                          {ongoingPwrCount > 0 ? ` · ${ongoingPwrCount} Power Cut Active` : ''}
                        </span>
                        {onOpenPowerGenTab && (
                          <button
                            type="button"
                            onClick={() => onOpenPowerGenTab('generator')}
                            className="rounded bg-[#1B3B6F] hover:bg-[#244D8F] border border-blue-400/40 px-2 py-1 text-[10px] font-semibold text-white transition whitespace-nowrap"
                          >
                            Start / Stop Log
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Floor Details Summary */}
                <div className="grid grid-cols-2 gap-2.5 rounded-lg bg-[#08152B] p-3 border border-blue-400/25 text-xs text-slate-200 mb-3 tabular-nums">
                  <div className="col-span-2">
                    <span className="text-[11px] font-medium text-slate-300 block">Running Product</span>
                    <span className="font-semibold text-white text-xs truncate block" title={runningJobCard}>
                      {runningJobCard}
                    </span>
                    <span className="text-[11px] text-slate-300">
                      Plan: {runningPlan} · {shiftText} · Run: <b className="text-emerald-300">{r2(stats.run)}h</b>
                    </span>
                  </div>

                  <div className="pt-1.5 border-t border-blue-400/20">
                    <span className="text-[11px] font-medium text-slate-300 block">Running Output</span>
                    <b className="text-emerald-300 font-mono text-xs">{runningOutput}</b>
                  </div>

                  <div className="pt-1.5 border-t border-blue-400/20">
                    <span className="text-[11px] font-medium text-slate-300 block">Running Weight</span>
                    <b className="text-white font-mono text-xs">{runningWeight}</b>
                  </div>

                  {!isUtility && (
                    <div
                      className={`col-span-2 mt-0.5 rounded-md border px-2.5 py-1.5 flex items-center justify-between gap-2 ${
                        item.waitingDispatches.length > 0
                          ? 'border-sky-400/45 bg-[#10284D] text-white'
                          : 'border-blue-400/20 bg-[#0D2142] text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Truck className={`h-3.5 w-3.5 shrink-0 ${item.waitingDispatches.length > 0 ? 'text-sky-300' : 'text-slate-400'}`} />
                        <div className="min-w-0">
                          <span className="text-[10px] font-medium block text-slate-300">
                            Stock Waiting Dispatch
                          </span>
                          <span className="text-[11px] font-semibold truncate block text-white">
                            {item.waitingDispatches.length > 0
                              ? `${item.waitingQty.toLocaleString()} pcs${item.waitingWeightKg > 0 ? ` (${item.waitingWeightKg} kg)` : ''}`
                              : '0 waiting'}
                          </span>
                        </div>
                      </div>
                      {item.waitingDispatches.length > 0 && (
                        <div className="text-right shrink-0 text-[10px] font-semibold space-y-0.5 text-slate-200">
                          {item.waitingWhCount > 0 && (
                            <span className="block text-amber-300">{item.waitingWhCount} WH Wait</span>
                          )}
                          {item.waitingHodCount > 0 && (
                            <span className="block text-sky-300">{item.waitingHodCount} HOD Wait</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="pt-1.5 border-t border-blue-400/20">
                    <span className="text-[11px] font-medium text-slate-300 block">Operator</span>
                    <span className="font-semibold text-white text-[11px] truncate block">
                      {runningOperator}
                    </span>
                  </div>

                  <div className="pt-1.5 border-t border-blue-400/20">
                    <span className="text-[11px] font-medium text-slate-300 block">Assistant</span>
                    <span className="font-semibold text-white text-[11px] truncate block">
                      {runningGeneralHand}
                    </span>
                  </div>

                  {!isUtility && (
                    <div className="col-span-2 pt-1.5 border-t border-blue-400/20 flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-1">
                        <span className="text-slate-300">SOP Scrap:</span>
                        <b className="text-amber-300 font-mono">{item.todayScrapKg} kg</b>
                        {item.pendingRecycleCount > 0 && (
                          <span className="text-[10px] font-semibold text-amber-200">
                            ({item.pendingRecycleCount} pending)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-slate-300">Wastage:</span>
                        <b className="text-rose-300 font-mono">{item.todayWastageKg} kg</b>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-1.5 pt-1">
                {canQuickLog && (
                  <button
                    type="button"
                    onClick={() => openQuickLogModal(item)}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-[#163668] hover:bg-[#1E4785] border border-blue-400/35 text-white py-2 px-3 text-xs font-semibold transition"
                    title={`Update product, weight, output, scrap & wastage for ${item.name}`}
                  >
                    <Scale className="h-3.5 w-3.5" />
                    <span>Update Product / Weight / Scrap</span>
                  </button>
                )}

                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedHistoryMachine(item.name)}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-blue-300/35 bg-[#10284D] hover:bg-[#173668] text-slate-100 py-2 px-2.5 text-xs font-semibold transition tabular-nums"
                    title={`View log history for ${item.name}`}
                  >
                    <History className="h-3.5 w-3.5 text-sky-300" />
                    <span>History ({item.historyCount})</span>
                  </button>

                  {isOff && open ? (
                    <button
                      type="button"
                      onClick={() => onRestoreRunning(open.id, item.name)}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white py-2 px-2.5 text-xs font-semibold transition"
                      title="Clear stoppage and mark machine as running"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      <span>Resume Run</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onLogStoppage(item.name)}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-rose-400/60 bg-rose-950/70 hover:bg-rose-900/90 text-rose-100 py-2 px-2.5 text-xs font-semibold transition"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Log Stoppage</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
            </React.Fragment>
          );
        })}
      </div>

      {filteredMachines.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white/95 p-8 text-center text-slate-600">
          <p className="text-sm">No machines match your search or filter.</p>
        </div>
      )}

      {/* MACHINE LOG HISTORY MODAL */}
      {selectedHistoryMachine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-xs">
          <div className="relative w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-5 shadow-2xl max-h-[90vh] flex flex-col text-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0F1E36] text-white">
                  <History className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-slate-900">
                    {selectedHistoryMachine} · {getMachineDepartment(selectedHistoryMachine)}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Operational History · {activeMachineHistory.length} recorded entries
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedHistoryMachine(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="py-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search reason, job card, operator, technician..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#0F1E36] focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  onLogStoppage(selectedHistoryMachine);
                  setSelectedHistoryMachine(null);
                }}
                className="flex items-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#193054] text-white px-3 py-1.5 text-xs font-semibold transition"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Log Stoppage</span>
              </button>
            </div>

            <div className="overflow-y-auto pr-1 py-3 space-y-3 flex-1 text-xs">
              {activeMachineHistory.length > 0 ? (
                activeMachineHistory.map((entry) => {
                  const isCurrentOpen = !entry.end;
                  return (
                    <div
                      key={entry.id}
                      className={`rounded-lg border p-3.5 space-y-2 ${
                        isCurrentOpen
                          ? 'border-rose-300 bg-rose-50/70'
                          : 'border-slate-200 bg-slate-50/80'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-semibold">
                          <span
                            className={
                              entry.cat === 'Breakdown'
                                ? 'text-rose-700'
                                : entry.cat.startsWith('Changeover')
                                ? 'text-amber-800'
                                : 'text-[#0F1E36]'
                            }
                          >
                            {entry.cat}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-slate-700">
                            {entry.jcn || 'No JC'}
                          </span>
                          {isCurrentOpen && (
                            <span className="text-[11px] font-bold text-rose-700">
                              (Active)
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                          {fmtT(entry.start)} — {entry.end ? fmtT(entry.end) : 'Ongoing (OFF)'}
                        </div>
                      </div>

                      <p className="text-slate-800 leading-relaxed font-medium">
                        {entry.reason || 'No description provided.'}
                      </p>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-200 text-[11px] text-slate-600">
                        <div>
                          <span className="text-[10px] font-medium text-slate-500 block">Operator</span>
                          <span className="text-slate-900 font-semibold">{entry.operator || entry.rep || '-'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-medium text-slate-500 block">Assistant</span>
                          <span className="text-slate-900 font-semibold">{entry.generalHand || '-'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-medium text-slate-500 block">Technician</span>
                          <span className="text-slate-900 font-semibold">{entry.mtncePerson || '-'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-medium text-slate-500 block">Logged By</span>
                          <span className="text-slate-700 font-mono text-[10px]">{entry.loggedByEmail || entry.by || '-'}</span>
                        </div>
                      </div>

                      {entry.signature && (
                        <div className="flex items-center gap-2 pt-1 text-[10px] text-emerald-700 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Digitally signed ({entry.signedAt ? fmtT(entry.signedAt) : 'Logged'})</span>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="p-8 text-center text-slate-500 space-y-1">
                  <p className="text-sm font-semibold">No records found for {selectedHistoryMachine}.</p>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedHistoryMachine(null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QUICK FLOOR & SOP LOG MODAL */}
      {quickLogMachine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-xs">
          <div className="relative w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-2xl max-h-[92vh] overflow-y-auto text-slate-900 space-y-4">
            <div className="flex items-start justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0F1E36] text-white">
                  <Scale className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {quickLogMachine} — Running &amp; SOP Update
                  </h3>
                  <p className="text-xs text-slate-500">
                    Record Running Product, Weight, Output Rate, SOP Scrap, and Wastage
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQuickLogMachine(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Live Dispatch Waiting Snapshot for this Machine */}
            {(() => {
              const mState = machineStates.find((ms) => ms.name === quickLogMachine);
              if (!mState) return null;
              return (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[#0F1E36] flex items-center gap-1.5">
                      <Truck className="h-3.5 w-3.5" />
                      Stock Waiting Dispatch ({mState.name})
                    </span>
                    <span className="font-bold text-slate-900 tabular-nums">
                      {mState.waitingQty.toLocaleString()} pcs
                      {mState.waitingWeightKg > 0 ? ` · ${mState.waitingWeightKg} kg` : ''} ({mState.waitingDispatches.length} trollies)
                    </span>
                  </div>
                  {mState.waitingDispatches.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 text-[10px]">
                      {mState.waitingDispatches.slice(0, 6).map((d) => (
                        <span
                          key={d.id}
                          className="rounded-md bg-white border border-slate-200 px-2 py-0.5 text-slate-700"
                        >
                          <b>#{d.trolleyNo}</b>: {d.product} — {d.whReceivedQty ?? d.recordedQty} pcs ({d.status === 'PENDING_WH' ? 'Wait WH' : 'Wait HOD'})
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">No trollies currently waiting dispatch for this machine.</p>
                  )}
                </div>
              );
            })()}

            {qlFeedback && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs font-semibold flex items-center gap-2 ${
                  qlFeedback.type === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-rose-200 bg-rose-50 text-rose-800'
                }`}
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{qlFeedback.text}</span>
              </div>
            )}

            <form onSubmit={handleSaveQuickLog} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Running Product *
                  </label>
                  <select
                    value={qlProduct}
                    onChange={(e) => setQlProduct(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                  >
                    {MASTER_JOB_CARDS.map((prod) => (
                      <option key={prod} value={prod}>
                        {prod}
                      </option>
                    ))}
                    <option value="__CUSTOM__">-- Enter Custom Product Name --</option>
                  </select>
                  {qlProduct === '__CUSTOM__' && (
                    <input
                      type="text"
                      value={qlCustomProduct}
                      onChange={(e) => setQlCustomProduct(e.target.value)}
                      placeholder="Type running product name..."
                      className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                    />
                  )}
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Running Weight (kg)
                  </label>
                  <input
                    type="text"
                    value={qlRunningWeight}
                    onChange={(e) => setQlRunningWeight(e.target.value)}
                    placeholder="e.g. 650 kg"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Running Output (per hr)
                  </label>
                  <input
                    type="text"
                    value={qlRunningOutput}
                    onChange={(e) => setQlRunningOutput(e.target.value)}
                    placeholder="e.g. 160 m/hr or 150 kg/hr"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Machine Operator
                  </label>
                  <select
                    value={qlOperator}
                    onChange={(e) => setQlOperator(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
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
                    <label className="text-[11px] font-semibold text-slate-700">
                      Operator Assistant (SOP)
                    </label>
                    <label className="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={qlIsCasualAssistant}
                        onChange={(e) => setQlIsCasualAssistant(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      <span>Casual Name</span>
                    </label>
                  </div>
                  {qlIsCasualAssistant ? (
                    <input
                      type="text"
                      value={qlCasualName}
                      onChange={(e) => setQlCasualName(e.target.value)}
                      placeholder="Enter casual assistant full name"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                    />
                  ) : (
                    <select
                      value={qlAssistant}
                      onChange={(e) => setQlAssistant(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                    >
                      {GENERAL_HAND_OPTIONS.map((ast) => (
                        <option key={ast.value} value={ast.value}>
                          {ast.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div className="text-[11px] font-bold text-[#0F1E36] flex items-center gap-1.5">
                  <Recycle className="h-3.5 w-3.5" />
                  <span>Assistant SOP Scrap &amp; Wastage Log</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="text-[11px] font-medium text-slate-600 block mb-1">
                      SOP Scrap (kg)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={qlScrapKg}
                      onChange={(e) => setQlScrapKg(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-slate-600 block mb-1">
                      Wastage (kg)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={qlWastageKg}
                      onChange={(e) => setQlWastageKg(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-slate-600 block mb-1">
                      Prod Qty (pcs)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={qlProdQty}
                      onChange={(e) => setQlProdQty(e.target.value)}
                      placeholder="Optional"
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-slate-600 block mb-1">
                      Prod Weight (kg)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={qlProdKg}
                      onChange={(e) => setQlProdKg(e.target.value)}
                      placeholder="Optional"
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] font-medium text-slate-600 block mb-1">
                      Scrap Reason
                    </label>
                    <input
                      type="text"
                      value={qlScrapReason}
                      onChange={(e) => setQlScrapReason(e.target.value)}
                      placeholder="e.g. Start-up purge, die trim, color change"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-slate-600 block mb-1">
                      Assign Recycling Team
                    </label>
                    <select
                      value={qlAssignedRecycler}
                      onChange={(e) => setQlAssignedRecycler(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#0F1E36] focus:outline-none"
                    >
                      {RECYCLING_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer pt-0.5">
                  <input
                    type="checkbox"
                    checked={qlSendScrapPopup}
                    onChange={(e) => setQlSendScrapPopup(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>
                    Notify Recycling Team when Scrap &gt; 0 kg
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setQuickLogMachine(null)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={qlSaving}
                  className="rounded-lg bg-[#0F1E36] hover:bg-[#193054] disabled:opacity-50 px-5 py-2 text-xs font-bold text-white transition shadow-xs"
                >
                  {qlSaving ? 'Saving Update...' : 'Save Update'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
