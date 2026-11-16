import React, { useState } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Lock,
  PieChart,
  Play,
  RotateCcw,
} from 'lucide-react';
import {
  calculateDayStats,
  getOpenEntry,
  r2,
  saveFileBlob,
  ymd,
} from '../services/downtimeCalc';
import { generateDailyHoursPdf } from '../services/reportPdf';
import { DowntimeEntry } from '../types';
import { LgplastLogo } from './LgplastLogo';

interface DailyHoursViewProps {
  machines: string[];
  entries: DowntimeEntry[];
  isAdmin?: boolean;
}

export const DailyHoursView: React.FC<DailyHoursViewProps> = ({
  machines,
  entries,
  isAdmin = false,
}) => {
  const [selectedDate, setSelectedDate] = useState<string>(ymd(new Date()));

  // Handlers for previous / next / today
  const handleShiftDate = (days: number) => {
    const d = new Date(selectedDate + 'T00:00');
    d.setDate(d.getDate() + days);
    setSelectedDate(ymd(d));
  };

  const handleSetToday = () => {
    setSelectedDate(ymd(new Date()));
  };

  // Compute table rows
  let totalDown = 0;
  let totalRun = 0;
  let totalBd = 0;
  let totalCo = 0;
  let totalJc = 0;
  let totalJct = 0;
  let runningMachines = 0;
  let offMachines = 0;

  const rows = machines.map((m) => {
    const s = calculateDayStats(m, selectedDate, entries);
    const open = getOpenEntry(m, entries);
    const isOff = !!open;

    if (isOff) offMachines++;
    else runningMachines++;

    totalDown += s.down;
    totalRun += s.run;
    totalBd += s.bd;
    totalCo += s.co;
    totalJc += s.jc;
    totalJct += s.jct;

    return {
      machine: m,
      isOff,
      stats: s,
    };
  });

  const totalAvail = totalDown + totalRun;
  const plantAvailabilityPct = totalAvail > 0 ? r2((100 * totalRun) / totalAvail) : 100;

  const handleExportDailyCSV = () => {
    if (!isAdmin) return;
    const csvRows = [
      ['LGPLAST - PLASTICS & PACKAGING'],
      ['DAILY MACHINE HOURS BREAKDOWN REPORT', `Date: ${selectedDate}`],
      [],
      ['Machine', 'Status', 'Hrs machine down', 'Hrs machine running', 'Breakdown hrs', 'Changeover hrs', 'Job cards finished'],
    ];

    rows.forEach((r) => {
      csvRows.push([
        r.machine,
        r.isOff ? 'OFF' : 'RUNNING',
        String(r2(r.stats.down)),
        String(r2(r.stats.run)),
        String(r2(r.stats.bd)),
        String(r2(r.stats.co)),
        r.stats.jct ? `${r.stats.jc} of ${r.stats.jct}` : '-',
      ]);
    });

    csvRows.push([
      'TOTAL',
      `${runningMachines} RUN / ${offMachines} OFF`,
      String(r2(totalDown)),
      String(r2(totalRun)),
      String(r2(totalBd)),
      String(r2(totalCo)),
      totalJct ? `${totalJc} of ${totalJct}` : '-',
    ]);

    const csvContent = csvRows
      .map((row) => row.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(','))
      .join('\r\n');

    saveFileBlob(
      `LGPLAST_Daily_Hours_${selectedDate}.csv`,
      new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    );
  };

  return (
    <div className="space-y-4">
      {/* Date Filter & Quick Navigation Bar matching original #t-daily */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-sm backdrop-blur">
        <div className="flex items-center gap-3">
          <LgplastLogo size="sm" showSubtitle={false} />
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white">Daily Hours Breakdown</h2>
            <p className="text-xs text-slate-400">
              Per-machine operational run time vs. downtime on selected date
            </p>
          </div>
        </div>

        {/* Date Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-xl border border-slate-700 bg-slate-950 px-2 py-1">
            <button
              onClick={() => handleShiftDate(-1)}
              className="p-1 text-slate-400 hover:text-white"
              title="Previous Day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-xs sm:text-sm font-semibold text-slate-100 px-2 focus:outline-none"
            />
            <button
              onClick={() => handleShiftDate(1)}
              className="p-1 text-slate-400 hover:text-white"
              title="Next Day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={handleSetToday}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-750 transition"
          >
            Today
          </button>

          {isAdmin ? (
            <>
              <button
                onClick={() => generateDailyHoursPdf(selectedDate, machines, entries)}
                className="flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 px-3 py-1.5 text-xs font-black text-slate-950 transition shadow"
                title="Download LGPLAST Daily Hours PDF"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>LGPLAST PDF</span>
              </button>

              <button
                onClick={handleExportDailyCSV}
                className="flex items-center gap-1.5 rounded-xl border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-300 hover:bg-blue-500/20 transition"
                title="Download CSV report for this day"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Export CSV</span>
              </button>
            </>
          ) : (
            <div
              className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold text-amber-300"
              title="Only Plant Administrators / Production HOD can generate Machine Reports"
            >
              <Lock className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span>Machine Reports: Admin Only</span>
            </div>
          )}
        </div>
      </div>

      {/* Summary KPI Cards for the Date */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
          <span className="text-[11px] font-semibold text-slate-400">Running Hours</span>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-xl sm:text-2xl font-black text-emerald-400">
              {r2(totalRun)}
            </span>
            <span className="text-xs text-slate-500 font-mono">hrs</span>
          </div>
          <span className="text-[10px] text-slate-400">Total operational run time</span>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
          <span className="text-[11px] font-semibold text-slate-400">Downtime Hours</span>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-xl sm:text-2xl font-black text-rose-400">
              {r2(totalDown)}
            </span>
            <span className="text-xs text-slate-500 font-mono">hrs</span>
          </div>
          <span className="text-[10px] text-slate-400">
            {r2(totalBd)}h breakdown + {r2(totalCo)}h CO
          </span>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
          <span className="text-[11px] font-semibold text-slate-400">Plant Availability</span>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-xl sm:text-2xl font-black text-blue-400">
              {plantAvailabilityPct}%
            </span>
          </div>
          <span className="text-[10px] text-slate-400">
            {runningMachines} of {machines.length} running
          </span>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
          <span className="text-[11px] font-semibold text-slate-400">Job Cards</span>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-xl sm:text-2xl font-black text-amber-400">
              {totalJc}
            </span>
            <span className="text-xs text-slate-500 font-mono">/ {totalJct}</span>
          </div>
          <span className="text-[10px] text-slate-400">Finished job cards today</span>
        </div>
      </div>

      {/* Exact Daily Table matching original logger #dt */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-6 shadow-md">
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold whitespace-nowrap">
                <th className="py-2.5 px-3">Machine</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Hrs machine down</th>
                <th className="py-2.5 px-3 text-right">Hrs machine running</th>
                <th className="py-2.5 px-3 text-right">Breakdown hrs</th>
                <th className="py-2.5 px-3 text-right">Changeover hrs</th>
                <th className="py-2.5 px-3">Job cards finished</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.map((r) => {
                const s = r.stats;
                return (
                  <tr
                    key={r.machine}
                    className="hover:bg-slate-850/50 transition-colors whitespace-nowrap"
                  >
                    <td className="py-2.5 px-3 font-bold text-slate-100">{r.machine}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          r.isOff
                            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        }`}
                      >
                        {r.isOff ? 'OFF' : 'RUNNING'}
                      </span>
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono font-bold ${
                        s.down > 0 ? 'text-rose-400' : 'text-slate-400'
                      }`}
                    >
                      {r2(s.down)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                      {r2(s.run)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-300">
                      {r2(s.bd)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-300">
                      {r2(s.co)}
                    </td>
                    <td className="py-2.5 px-3 text-slate-300 font-medium">
                      {s.jct ? `${s.jc} of ${s.jct}` : '-'}
                    </td>
                  </tr>
                );
              })}

              {/* TOTAL ROW matching original sumRow structure */}
              <tr className="bg-slate-950 font-bold border-t-2 border-slate-700 text-slate-100">
                <td className="py-3 px-3">TOTAL</td>
                <td className="py-3 px-3 text-slate-400">
                  {runningMachines} Run / {offMachines} OFF
                </td>
                <td className="py-3 px-3 text-right text-rose-400 font-mono">
                  {r2(totalDown)}
                </td>
                <td className="py-3 px-3 text-right text-emerald-400 font-mono">
                  {r2(totalRun)}
                </td>
                <td className="py-3 px-3 text-right text-slate-200 font-mono">
                  {r2(totalBd)}
                </td>
                <td className="py-3 px-3 text-right text-slate-200 font-mono">
                  {r2(totalCo)}
                </td>
                <td className="py-3 px-3 text-amber-300">
                  {totalJct ? `${totalJc} of ${totalJct}` : '-'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Original Basis Note */}
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-400 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
          <Clock className="h-4 w-4 text-amber-400 shrink-0" />
          <span>
            <b>Basis:</b> 24 hrs per day (today counts up to the current time). Running hrs = day hrs minus down hrs.
          </span>
        </div>
      </div>
    </div>
  );
};
