import React, { useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertOctagon,
  ArrowRight,
  Calendar,
  CheckCircle2,
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
  PenTool,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  User,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';
import { calculateDayStats, dtl, fmtT, getCurrentShift, getOpenEntry, r2, ymd } from '../services/downtimeCalc';
import {
  DowntimeEntry,
  EXTRUSION_MACHINES,
  getMachineDepartment,
  INJECTION_MACHINES,
  MachineDepartment,
  MIXER_MACHINES,
  RECYCLING_MACHINES,
  UTILITY_MACHINES,
} from '../types';

interface MachineStatusBoardProps {
  machines: string[];
  entries: DowntimeEntry[];
  onLogStoppage: (machine: string) => void;
  onRestoreRunning: (entryId: string, machine: string) => void;
  onViewCertificate?: (entry: DowntimeEntry) => void;
  currentUserName?: string;
  currentUserEmail?: string;
}

export const MachineStatusBoard: React.FC<MachineStatusBoardProps> = ({
  machines,
  entries,
  onLogStoppage,
  onRestoreRunning,
  onViewCertificate,
  currentUserName,
  currentUserEmail,
}) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'RUNNING' | 'BREAKDOWN' | 'NOPLANNING' | 'PLANFINISH' | 'CHANGEOVER' | 'OFF'>('ALL');
  const [deptFilter, setDeptFilter] = useState<MachineDepartment | 'ALL'>('ALL');

  // Machine Log History Modal State
  const [selectedHistoryMachine, setSelectedHistoryMachine] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');

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
    const open = getOpenEntry(m, entries);
    const dept = getMachineDepartment(m);
    const isUtility = dept === 'Utility';

    // Latest historical entries for this machine
    const machineEntries = entries
      .filter((e) => e.m.toLowerCase() === m.toLowerCase() && !e.del)
      .sort((a, b) => (b.upd || 0) - (a.upd || 0));

    const latestEntry = open || machineEntries[0];

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

    const todayStats = calculateDayStats(m, todayStr, entries);

    return {
      name: m,
      dept,
      isUtility,
      openEntry: open,
      latestEntry,
      isOff: !!open,
      isNoPlan,
      isPlanDone,
      stats: todayStats,
      historyCount: machineEntries.length,
    };
  });

  const runningCount = machines.length - offCount;

  // Filter machines based on search, status and department
  const filteredMachines = machineStates.filter((item) => {
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

  // History modal entries for selected machine
  const activeMachineHistory = selectedHistoryMachine
    ? entries
        .filter((e) => e.m.toLowerCase() === selectedHistoryMachine.toLowerCase() && !e.del)
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
      {/* Top Banner / Floor Overview */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-sm backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 via-teal-600 to-blue-600 text-slate-950 font-black shadow-md shadow-emerald-950/50">
            <Activity className="h-6 w-6 text-slate-950" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base sm:text-lg font-black text-white" id="sumline">
                {runningCount} Running • {offCount} Stopped of {machines.length} Units
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-black uppercase tracking-wider ${
                  breakdownCount > 0
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${breakdownCount > 0 ? 'bg-rose-500' : 'bg-emerald-400'}`} />
                {breakdownCount > 0
                  ? `${breakdownCount} Breakdown (Red) • ${noPlanningCount} No Planning (Yellow)`
                  : 'All Systems Operational'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1">
              <span className="inline-flex items-center gap-1 text-slate-300 font-semibold">
                <Clock className="h-3.5 w-3.5 text-amber-400" />
                Current Shift: <b className="text-amber-300">{currentShift.label}</b>
              </span>
              <span>•</span>
              <span className="text-emerald-400 font-bold">● Running (Green)</span>
              <span>•</span>
              <span className="text-yellow-400 font-bold">● No Planning (Yellow)</span>
              <span>•</span>
              <span className="text-amber-400 font-bold">● Plan Finish (Gold)</span>
              <span>•</span>
              <span className="text-rose-400 font-bold">● Breakdown (Red)</span>
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
              className="w-full rounded-xl border border-slate-800 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-slate-200 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="flex rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs font-semibold overflow-x-auto gap-1">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`rounded-lg px-2.5 py-1 transition whitespace-nowrap ${
                statusFilter === 'ALL' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({machines.length})
            </button>
            <button
              onClick={() => setStatusFilter('RUNNING')}
              className={`rounded-lg px-2.5 py-1 transition whitespace-nowrap ${
                statusFilter === 'RUNNING' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-emerald-400'
              }`}
            >
              Run ({runningCount})
            </button>
            <button
              onClick={() => setStatusFilter('BREAKDOWN')}
              className={`rounded-lg px-2.5 py-1 transition whitespace-nowrap ${
                statusFilter === 'BREAKDOWN' ? 'bg-rose-600 text-white shadow' : 'text-rose-400 hover:bg-rose-950/40'
              }`}
            >
              Breakdown ({breakdownCount})
            </button>
            <button
              onClick={() => setStatusFilter('NOPLANNING')}
              className={`rounded-lg px-2.5 py-1 transition whitespace-nowrap ${
                statusFilter === 'NOPLANNING' ? 'bg-yellow-500 text-slate-950 font-black shadow' : 'text-yellow-400 hover:bg-yellow-950/40'
              }`}
            >
              No Planning ({noPlanningCount})
            </button>
            <button
              onClick={() => setStatusFilter('PLANFINISH')}
              className={`rounded-lg px-2.5 py-1 transition whitespace-nowrap ${
                statusFilter === 'PLANFINISH' ? 'bg-amber-500 text-slate-950 font-black shadow' : 'text-amber-400 hover:bg-amber-950/40'
              }`}
            >
              Plan Finish ({planFinishCount})
            </button>
            <button
              onClick={() => setStatusFilter('CHANGEOVER')}
              className={`rounded-lg px-2.5 py-1 transition whitespace-nowrap ${
                statusFilter === 'CHANGEOVER' ? 'bg-orange-600 text-white shadow' : 'text-slate-400 hover:text-orange-400'
              }`}
            >
              Changeover ({changeoverCount})
            </button>
          </div>
        </div>
      </div>

      {/* Department Tabs Bar (Extrusion -> Injection -> Mixer -> Recycling -> Utility) */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-bold scrollbar-thin">
        <span className="text-[11px] uppercase tracking-wider text-slate-500 pr-1 shrink-0 font-extrabold">
          Section:
        </span>
        <button
          onClick={() => setDeptFilter('ALL')}
          className={`shrink-0 rounded-xl px-3 py-1.5 transition border ${
            deptFilter === 'ALL'
              ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm'
              : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          All Sections ({machines.length})
        </button>
        <button
          onClick={() => setDeptFilter('Extrusion')}
          className={`shrink-0 rounded-xl px-3 py-1.5 transition border ${
            deptFilter === 'Extrusion'
              ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
              : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          1. Extrusion ({EXTRUSION_MACHINES.length})
        </button>
        <button
          onClick={() => setDeptFilter('Injection')}
          className={`shrink-0 rounded-xl px-3 py-1.5 transition border ${
            deptFilter === 'Injection'
              ? 'bg-purple-600 text-white border-purple-500 shadow-sm'
              : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          2. Injection ({INJECTION_MACHINES.length})
        </button>
        <button
          onClick={() => setDeptFilter('Mixer')}
          className={`shrink-0 rounded-xl px-3 py-1.5 transition border ${
            deptFilter === 'Mixer'
              ? 'bg-amber-600 text-white border-amber-500 shadow-sm'
              : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          3. Mixer ({MIXER_MACHINES.length})
        </button>
        <button
          onClick={() => setDeptFilter('Recycling')}
          className={`shrink-0 rounded-xl px-3 py-1.5 transition border ${
            deptFilter === 'Recycling'
              ? 'bg-teal-600 text-white border-teal-500 shadow-sm'
              : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          4. Recycling ({RECYCLING_MACHINES.length})
        </button>
        <button
          onClick={() => setDeptFilter('Utility')}
          className={`shrink-0 rounded-xl px-3 py-1.5 transition border ${
            deptFilter === 'Utility'
              ? 'bg-cyan-600 text-white border-cyan-500 shadow-sm'
              : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          5. Utility ({UTILITY_MACHINES.length})
        </button>
      </div>

      {/* Grid of Machine Small Interfaces */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4" id="board">
        {filteredMachines.map((item) => {
          const isOff = item.isOff;
          const open = item.openEntry;
          const stats = item.stats;
          const latest = item.latestEntry;
          const isChiller = item.name.toLowerCase() === 'chiller';
          const isGenerator = item.name.toLowerCase() === 'generator';
          const isUtility = item.isUtility;

          // Exact Color Coding per factory floor specifications:
          // 1. RUNNING -> GREEN is OK
          // 2. NO PLANNING -> YELLOW color
          // 3. PLANNING FINISH -> GOLD color
          // 4. BREAKDOWN -> RED color
          let statusBadgeClass = 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
          let borderAccentClass = 'border-l-4 border-l-emerald-500 border-slate-800 bg-slate-900/90';
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
            // RED color
            statusBadgeClass = 'bg-rose-500/20 text-rose-300 border-rose-500/50';
            borderAccentClass = 'border-l-4 border-l-rose-500 border-rose-600/50 bg-rose-950/25 shadow-md shadow-rose-950/20';
            statusLabel = 'BREAKDOWN';
          } else if (isNoPlanning) {
            // YELLOW color
            statusBadgeClass = 'bg-yellow-400/20 text-yellow-300 border-yellow-400/60 font-bold';
            borderAccentClass = 'border-l-4 border-l-yellow-400 border-yellow-500/50 bg-yellow-950/25 shadow-md shadow-yellow-950/20';
            statusLabel = 'NO PLANNING';
          } else if (isPlanFinish) {
            // GOLD color
            statusBadgeClass = 'bg-amber-500/25 text-amber-300 border-amber-400/70 font-bold';
            borderAccentClass = 'border-l-4 border-l-amber-500 border-amber-500/50 bg-amber-950/30 shadow-md shadow-amber-950/20';
            statusLabel = 'PLAN FINISH';
          } else if (isChangeover) {
            // ORANGE color
            statusBadgeClass = 'bg-orange-500/20 text-orange-300 border-orange-500/50';
            borderAccentClass = 'border-l-4 border-l-orange-500 border-orange-600/50 bg-orange-950/20 shadow-md shadow-orange-950/20';
            statusLabel = 'CHANGEOVER';
          } else if (isOff && open?.cat.startsWith('Planned')) {
            // BLUE color
            statusBadgeClass = 'bg-blue-500/20 text-blue-300 border-blue-500/50';
            borderAccentClass = 'border-l-4 border-l-blue-500 border-blue-600/50 bg-blue-950/20';
            statusLabel = 'MAINTENANCE';
          } else if (isOff) {
            statusBadgeClass = 'bg-slate-700/60 text-slate-300 border-slate-600';
            borderAccentClass = 'border-l-4 border-l-slate-500 border-slate-700 bg-slate-900/90';
            statusLabel = 'OFF';
          }

          // Operational fields fallback
          const runningJobCard = open?.jcn || latest?.jcn || 'JC-RUNNING';
          const runningPlan = open?.jcp || latest?.jcp || (isOff ? 'In progress' : 'On Target');
          const runningOperator = open?.operator || latest?.operator || 'Plant Operator';
          const runningGeneralHand = open?.generalHand || latest?.generalHand || 'General Hand';
          const runningMtnce = open?.mtncePerson || latest?.mtncePerson || (isOff ? 'Technician Attending' : 'Standby');
          const runningOutput = open?.outputPerHour || latest?.outputPerHour || (isUtility ? 'Normal' : '150 kg/hr');
          const runningWeight = open?.runningWeight || latest?.runningWeight || (isUtility ? '-' : '650 kg');
          const shiftText = open?.shift || latest?.shift || currentShift.label;

          return (
            <div
              key={item.name}
              className={`flex flex-col justify-between rounded-2xl border p-4 transition-all duration-200 hover:shadow-lg ${borderAccentClass}`}
            >
              <div>
                {/* Header Line */}
                <div className="flex items-start justify-between gap-2 mb-2.5">
                  <div>
                    <span className="text-[10px] font-black tracking-wider uppercase text-slate-500 block">
                      {item.dept} SECTION
                    </span>
                    <h3 className="font-black text-sm sm:text-base text-white leading-tight">
                      {item.name}
                    </h3>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider border ${statusBadgeClass}`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        isOff ? 'bg-rose-400 animate-pulse' : 'bg-emerald-400'
                      }`}
                    />
                    {statusLabel}
                  </span>
                </div>

                {/* Stoppage Alert Banner if Stopped */}
                {isOff && open && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-2.5 mb-3 text-xs text-rose-200">
                    <div className="font-bold flex items-center justify-between">
                      <span className="text-rose-300">{open.cat}</span>
                      <span className="font-mono text-[10px] text-rose-400">Since {fmtT(open.start)}</span>
                    </div>
                    <p className="mt-1 text-slate-300 leading-snug line-clamp-2">{open.reason}</p>
                    {open.mtncePerson && (
                      <div className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-300 font-semibold">
                        <Wrench className="h-3 w-3 shrink-0" />
                        <span>Mtnce Attending: {open.mtncePerson}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Utility Special Interface: Chiller */}
                {isChiller && (
                  <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/30 p-2.5 mb-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-cyan-300 font-bold text-[11px] uppercase tracking-wider">
                      <span className="flex items-center gap-1">
                        <Gauge className="h-3.5 w-3.5" /> Chiller Telemetry
                      </span>
                      <span className="text-[10px] text-cyan-400/80">Online Loop</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 text-center pt-0.5">
                      <div className="rounded-lg bg-slate-950/70 p-1.5 border border-cyan-900/40">
                        <span className="text-[9px] uppercase text-slate-400 block font-bold">Temperature</span>
                        <span className="text-xs font-black text-cyan-300">
                          {open?.chillerTemp !== undefined ? `${open.chillerTemp} °C` : '13.5 °C'}
                        </span>
                      </div>
                      <div className="rounded-lg bg-slate-950/70 p-1.5 border border-cyan-900/40">
                        <span className="text-[9px] uppercase text-slate-400 block font-bold">Pressure</span>
                        <span className="text-xs font-black text-cyan-300">
                          {open?.chillerPressure !== undefined ? `${open.chillerPressure} bar` : '4.2 bar'}
                        </span>
                      </div>
                      <div className="rounded-lg bg-slate-950/70 p-1.5 border border-cyan-900/40">
                        <span className="text-[9px] uppercase text-slate-400 block font-bold">Frequency</span>
                        <span className="text-xs font-black text-cyan-300">
                          {open?.chillerFreq !== undefined ? `${open.chillerFreq} Hz` : '50.0 Hz'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Utility Special Interface: Generator */}
                {isGenerator && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-2.5 mb-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-amber-300 font-bold text-[11px] uppercase tracking-wider">
                      <span className="flex items-center gap-1">
                        <Zap className="h-3.5 w-3.5" /> Generator Telemetry
                      </span>
                      <span className="text-[10px] text-amber-400/80">Standby Ready</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-center pt-0.5">
                      <div className="rounded-lg bg-slate-950/70 p-1 border border-amber-900/40">
                        <span className="text-[9px] uppercase text-slate-400 block font-bold">Start Up</span>
                        <span className="text-[11px] font-black text-amber-300">
                          {open?.genStartTime || '08:00'}
                        </span>
                      </div>
                      <div className="rounded-lg bg-slate-950/70 p-1 border border-amber-900/40">
                        <span className="text-[9px] uppercase text-slate-400 block font-bold">Start Fuel</span>
                        <span className="text-[11px] font-black text-amber-300">
                          {open?.genStartFuel !== undefined ? `${open.genStartFuel}%` : '90%'}
                        </span>
                      </div>
                      <div className="rounded-lg bg-slate-950/70 p-1 border border-amber-900/40">
                        <span className="text-[9px] uppercase text-slate-400 block font-bold">Off Time</span>
                        <span className="text-[11px] font-black text-amber-300">
                          {open?.genOffTime || '12:00'}
                        </span>
                      </div>
                      <div className="rounded-lg bg-slate-950/70 p-1 border border-amber-900/40">
                        <span className="text-[9px] uppercase text-slate-400 block font-bold">Off Fuel</span>
                        <span className="text-[11px] font-black text-amber-300">
                          {open?.genOffFuel !== undefined ? `${open.genOffFuel}%` : '82%'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Small Interface Floor Data Grid */}
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-950/80 p-2.5 border border-slate-800 text-xs text-slate-300 mb-3">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Job Card / Plan</span>
                    <span className="font-mono font-bold text-amber-300 text-[11px] truncate block">
                      {runningJobCard}
                    </span>
                    <span className="text-[10px] text-slate-400">{runningPlan}</span>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Shift Timing</span>
                    <span className="font-semibold text-slate-200 text-[11px] truncate block">
                      {shiftText}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Run: <b className="text-emerald-400">{r2(stats.run)}h</b>
                    </span>
                  </div>

                  <div className="pt-1 border-t border-slate-800/80">
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Operator</span>
                    <span className="font-semibold text-slate-200 text-[11px] truncate block">
                      {runningOperator}
                    </span>
                  </div>

                  <div className="pt-1 border-t border-slate-800/80">
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">General Hand</span>
                    <span className="font-semibold text-slate-200 text-[11px] truncate block">
                      {runningGeneralHand}
                    </span>
                  </div>

                  <div className="col-span-2 pt-1 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-500">Output: </span>
                      <b className="text-emerald-400 font-mono">{runningOutput}</b>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-500">Weight: </span>
                      <b className="text-slate-200 font-mono">{runningWeight}</b>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons: Machine History & Stoppage Control */}
              <div className="space-y-1.5 pt-1">
                <div className="flex gap-1.5">
                  {/* Button: Click to show machine log history */}
                  <button
                    type="button"
                    onClick={() => setSelectedHistoryMachine(item.name)}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 hover:bg-slate-750 text-slate-200 py-2 px-2.5 text-xs font-semibold hover:border-blue-500/50 hover:text-blue-300 transition"
                    title={`View historical log entries for ${item.name}`}
                  >
                    <History className="h-3.5 w-3.5 text-blue-400" />
                    <span>Log History ({item.historyCount})</span>
                  </button>

                  {/* Primary Action Button */}
                  {isOff && open ? (
                    <button
                      type="button"
                      onClick={() => onRestoreRunning(open.id, item.name)}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white py-2 px-2.5 text-xs font-bold transition shadow-sm active:scale-[0.98]"
                      title="Clear stoppage and mark machine as running"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      <span>Back to running</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onLogStoppage(item.name)}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 py-2 px-2.5 text-xs font-bold transition active:scale-[0.98]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Log Stoppage</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredMachines.length === 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-400">
          <p className="text-sm">No machines match your search or filter.</p>
        </div>
      )}

      {/* ============================================================== */}
      {/* MACHINE LOG HISTORY MODAL (Requested: "Click button to show machine log history for that machine") */}
      {/* ============================================================== */}
      {selectedHistoryMachine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl max-h-[90vh] flex flex-col text-slate-100">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
                  <History className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                    <span>{selectedHistoryMachine}</span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                      {getMachineDepartment(selectedHistoryMachine)}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Floor Operational History • {activeMachineHistory.length} total entries recorded
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedHistoryMachine(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* History Search & Controls */}
            <div className="py-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search reason, job card, operator, technician..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  onLogStoppage(selectedHistoryMachine);
                  setSelectedHistoryMachine(null);
                }}
                className="flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 px-3 py-1.5 text-xs font-bold transition shadow"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Log New Entry for {selectedHistoryMachine}</span>
              </button>
            </div>

            {/* Scrollable History List */}
            <div className="overflow-y-auto pr-1 py-3 space-y-3 flex-1 text-xs">
              {activeMachineHistory.length > 0 ? (
                activeMachineHistory.map((entry) => {
                  const isCurrentOpen = !entry.end;
                  return (
                    <div
                      key={entry.id}
                      className={`rounded-xl border p-3.5 space-y-2 transition ${
                        isCurrentOpen
                          ? 'border-rose-500/60 bg-rose-950/20 shadow-md shadow-rose-950/20'
                          : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                              entry.cat === 'Breakdown'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                : entry.cat.startsWith('Changeover')
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                            }`}
                          >
                            {entry.cat}
                          </span>
                          <span className="font-mono text-xs text-amber-300 font-bold">
                            {entry.jcn || 'No JC'}
                          </span>
                          {isCurrentOpen && (
                            <span className="rounded bg-rose-600 px-1.5 py-0.2 text-[9px] font-black text-white uppercase animate-pulse">
                              Active Stoppage
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] font-mono text-slate-400">
                          {fmtT(entry.start)} ➔ {entry.end ? fmtT(entry.end) : 'Ongoing (OFF)'}
                        </div>
                      </div>

                      <p className="text-slate-200 leading-relaxed font-medium">
                        {entry.reason || 'No description provided.'}
                      </p>

                      {/* Floor Details Footer */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Operator</span>
                          <span className="text-slate-300 font-semibold">{entry.operator || entry.rep || '-'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">General Hand</span>
                          <span className="text-slate-300 font-semibold">{entry.generalHand || '-'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Mtnce Person</span>
                          <span className="text-amber-300 font-semibold">{entry.mtncePerson || '-'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Attributed To</span>
                          <span className="text-slate-300 font-mono text-[10px]">{entry.loggedByEmail || entry.by || '-'}</span>
                        </div>
                      </div>

                      {entry.signature && (
                        <div className="flex items-center gap-2 pt-1 text-[10px] text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Digitally signed by technician ({entry.signedAt ? fmtT(entry.signedAt) : 'Logged'})</span>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="p-8 text-center text-slate-500 space-y-1">
                  <p className="text-sm font-semibold">No log history records found for {selectedHistoryMachine}.</p>
                  <p className="text-xs">Click &quot;Log New Entry&quot; above to record breakdown or operational data.</p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedHistoryMachine(null)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-750"
              >
                Close History
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
