import React, { useMemo, useState } from 'react';
import {
  Award,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Lock,
  PenTool,
  Printer,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import {
  fmtT,
  generateCSVReport,
  generateExcelWorkbook,
  getSummaryRows,
  r2,
  toTimestamp,
  ymd,
} from '../services/downtimeCalc';
import { generateDowntimePeriodPdf } from '../services/reportPdf';
import { DowntimeEntry } from '../types';
import { LgplastLogo } from './LgplastLogo';

interface PeriodReportViewProps {
  machines: string[];
  entries: DowntimeEntry[];
  isAdmin?: boolean;
}

export const PeriodReportView: React.FC<PeriodReportViewProps> = ({
  machines,
  entries,
  isAdmin = false,
}) => {
  // Date range state (default: current month from 1st to today)
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const [fromDate, setFromDate] = useState<string>(ymd(firstOfMonth));
  const [toDate, setToDate] = useState<string>(ymd(today));

  // Sub-view toggle
  const [activeReportSubTab, setActiveReportSubTab] = useState<'summary' | 'daily' | 'entries'>('summary');

  // Supervisor sign-off state
  const [supervisorName, setSupervisorName] = useState<string>('');
  const [isSignOffModalOpen, setIsSignOffModalOpen] = useState<boolean>(false);
  const [isSignedOff, setIsSignedOff] = useState<boolean>(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Preset handlers
  const handlePreset = (preset: 'today' | '7days' | 'thisMonth' | 'lastMonth') => {
    const n = new Date();
    let f = new Date();
    let t = new Date();

    if (preset === 'today') {
      f = n;
      t = n;
    } else if (preset === '7days') {
      f.setDate(n.getDate() - 6);
      t = n;
    } else if (preset === 'thisMonth') {
      f = new Date(n.getFullYear(), n.getMonth(), 1);
      t = n;
    } else if (preset === 'lastMonth') {
      f = new Date(n.getFullYear(), n.getMonth() - 1, 1);
      t = new Date(n.getFullYear(), n.getMonth(), 0);
    }

    setFromDate(ymd(f));
    setToDate(ymd(t));
  };

  // Calculate table data matching original sumRows(f, t)
  const reportData = useMemo(() => {
    if (!fromDate || !toDate || fromDate > toDate) {
      return null;
    }
    return getSummaryRows(fromDate, toDate, machines, entries);
  }, [fromDate, toDate, machines, entries]);

  // Handle Excel download (Admin Only)
  const handleDownloadExcel = () => {
    if (!isAdmin) {
      setExportNotice('Admin Only: Only Administrators can generate Machines Reports.');
      return;
    }
    if (!fromDate || !toDate || fromDate > toDate) {
      setExportNotice('Please select a valid From and To date range.');
      return;
    }
    setExportNotice('Generating multi-sheet Excel (.xlsx) workbook...');
    generateExcelWorkbook(fromDate, toDate, machines, entries, supervisorName);
    setTimeout(() => {
      setExportNotice('Excel report downloaded to your device.');
    }, 800);
  };

  // Handle CSV download (Admin Only)
  const handleDownloadCSV = () => {
    if (!isAdmin) {
      setExportNotice('Admin Only: Only Administrators can generate Machines Reports.');
      return;
    }
    if (!fromDate || !toDate || fromDate > toDate) {
      setExportNotice('Please select a valid From and To date range.');
      return;
    }
    generateCSVReport(fromDate, toDate, machines, entries);
    setExportNotice('LGPLAST CSV summary report downloaded.');
  };

  // Handle Branded PDF download (Admin Only)
  const handleDownloadPDF = () => {
    if (!isAdmin) {
      setExportNotice('Admin Only: Only Administrators can generate Machines Reports.');
      return;
    }
    if (!fromDate || !toDate || fromDate > toDate) {
      setExportNotice('Please select a valid From and To date range.');
      return;
    }
    generateDowntimePeriodPdf(fromDate, toDate, machines, entries, supervisorName);
    setExportNotice('LGPLAST branded PDF downtime report downloaded.');
  };

  // Entries within selected date range
  const rangeEntries = useMemo(() => {
    return entries
      .filter((e) => {
        if (e.del) return false;
        const entryDate = ymd(new Date(e.start));
        return entryDate >= fromDate && entryDate <= toDate;
      })
      .sort((a, b) => toTimestamp(b.start) - toTimestamp(a.start));
  }, [entries, fromDate, toDate]);

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-amber-500/40 bg-slate-900/95 p-8 text-center shadow-lg max-w-xl mx-auto">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
          <Lock className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-black text-white">Machines Report Restricted to Admins</h2>
        <p className="mt-2 text-xs text-slate-400">
          Only Plant Administrators and Production HOD can access and generate LGPLAST machine downtime &amp; running hours reports.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Filter Card matching original #t-rep .card */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-6 shadow-md backdrop-blur">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="flex flex-wrap items-center gap-3">
            <LgplastLogo size="sm" showSubtitle={false} />
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
                <span>LGPLAST Plant Downtime &amp; Running Hours Report</span>
              </h2>
              <p className="text-xs text-slate-400">
                Filter by date range for machine running time, downtime, breakdown hrs &amp; availability %
              </p>
            </div>
          </div>

          {/* Quick Date Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => handlePreset('today')}
              className="rounded-xl border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition"
            >
              Today
            </button>
            <button
              onClick={() => handlePreset('7days')}
              className="rounded-xl border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition"
            >
              Last 7 days
            </button>
            <button
              onClick={() => handlePreset('thisMonth')}
              className="rounded-xl border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition"
            >
              This month
            </button>
            <button
              onClick={() => handlePreset('lastMonth')}
              className="rounded-xl border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition"
            >
              Last month
            </button>
          </div>
        </div>

        {/* Date Pickers & Action Buttons */}
        <div className="mt-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                From Date
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs sm:text-sm font-semibold text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                To Date
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs sm:text-sm font-semibold text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Export Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleDownloadExcel}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 px-4 py-2 text-xs font-bold text-white shadow-md shadow-emerald-950/40 active:scale-[0.98] transition"
              title="Download formatted multi-sheet Excel workbook (.xlsx)"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span>Generate Excel (.xlsx)</span>
            </button>

            <button
              onClick={handleDownloadPDF}
              className="flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 px-3.5 py-2 text-xs font-black text-slate-950 shadow-md transition"
              title="Download LGPLAST branded PDF report"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>LGPLAST PDF</span>
            </button>

            <button
              onClick={handleDownloadCSV}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-750 transition"
              title="Download summary as comma-separated CSV"
            >
              <Download className="h-3.5 w-3.5" />
              <span>CSV</span>
            </button>

            <button
              onClick={() => setIsSignOffModalOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition"
              title="Supervisor Online Sign-Off Stamp"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-amber-400" />
              <span>{isSignedOff ? 'Signed by Supervisor' : 'Supervisor Sign'}</span>
            </button>
          </div>
        </div>

        {exportNotice && (
          <div className="mt-3 text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-2 rounded-xl flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            <span>{exportNotice}</span>
          </div>
        )}

        <div className="mt-3 text-xs text-slate-400">
          Workbook sheets: <b>Summary</b> (per machine running & downtime), <b>Daily</b> (date-by-date breakdown), <b>Entries</b> (signed individual stoppage logs).
        </div>
      </div>

      {/* Aggregate KPI Banner for Selected Period */}
      {reportData && reportData.totalRow && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <span className="text-[11px] font-semibold text-slate-400">Period Hours</span>
            <div className="mt-1 text-lg sm:text-xl font-black text-slate-100">
              {reportData.totalRow[1]} <span className="text-xs text-slate-400 font-normal">hrs</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <span className="text-[11px] font-semibold text-slate-400">Total Run Time</span>
            <div className="mt-1 text-lg sm:text-xl font-black text-emerald-400">
              {reportData.totalRow[2]} <span className="text-xs text-slate-400 font-normal">hrs</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <span className="text-[11px] font-semibold text-slate-400">Total Downtime</span>
            <div className="mt-1 text-lg sm:text-xl font-black text-rose-400">
              {reportData.totalRow[3]} <span className="text-xs text-slate-400 font-normal">hrs</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <span className="text-[11px] font-semibold text-slate-400">Breakdown Hrs</span>
            <div className="mt-1 text-lg sm:text-xl font-black text-amber-400">
              {reportData.totalRow[4]} <span className="text-xs text-slate-400 font-normal">hrs</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <span className="text-[11px] font-semibold text-slate-400">Changeovers</span>
            <div className="mt-1 text-lg sm:text-xl font-black text-blue-400">
              {reportData.totalRow[5]} <span className="text-xs text-slate-400 font-normal">hrs</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <span className="text-[11px] font-semibold text-slate-400">Availability %</span>
            <div className="mt-1 text-lg sm:text-xl font-black text-teal-400">
              {reportData.totalRow[7]}%
            </div>
          </div>
        </div>
      )}

      {/* Sub-Tabs: Summary (per machine) / Daily Breakdown / Filtered Entries */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-6 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs font-semibold">
            <button
              onClick={() => setActiveReportSubTab('summary')}
              className={`rounded-lg px-3 py-1.5 transition ${
                activeReportSubTab === 'summary'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Summary (Per Machine)
            </button>
            <button
              onClick={() => setActiveReportSubTab('daily')}
              className={`rounded-lg px-3 py-1.5 transition ${
                activeReportSubTab === 'daily'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Daily Breakdown
            </button>
            <button
              onClick={() => setActiveReportSubTab('entries')}
              className={`rounded-lg px-3 py-1.5 transition ${
                activeReportSubTab === 'entries'
                  ? 'bg-amber-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Incident Entries ({rangeEntries.length})
            </button>
          </div>

          <div className="text-xs text-slate-400 font-mono">
            Period: <span className="text-slate-200">{fromDate}</span> to{' '}
            <span className="text-slate-200">{toDate}</span>
          </div>
        </div>

        {/* Tab 1: Summary Table per Machine matching original #rp */}
        {activeReportSubTab === 'summary' && reportData && (
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left border-collapse text-xs" id="rp">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/90 text-slate-400 font-semibold whitespace-nowrap">
                  <th className="py-2.5 px-3">Machine</th>
                  <th className="py-2.5 px-3 text-right">Period hrs</th>
                  <th className="py-2.5 px-3 text-right">Hrs running</th>
                  <th className="py-2.5 px-3 text-right">Hrs OFF (total)</th>
                  <th className="py-2.5 px-3 text-right">Breakdown hrs</th>
                  <th className="py-2.5 px-3 text-right">Job card changeover hrs</th>
                  <th className="py-2.5 px-3 text-right">Other stoppage hrs</th>
                  <th className="py-2.5 px-3 text-right">Availability %</th>
                  <th className="py-2.5 px-3 text-center">Job cards finished</th>
                  <th className="py-2.5 px-3 text-center">Job cards logged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {reportData.structured.map((row) => (
                  <tr
                    key={row.machine}
                    className="hover:bg-slate-850/50 transition-colors whitespace-nowrap"
                  >
                    <td className="py-2.5 px-3 font-bold text-slate-100">{row.machine}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-400">
                      {row.periodHrs}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                      {row.runHrs}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono font-bold ${
                        row.downHrs > 0 ? 'text-rose-400' : 'text-slate-500'
                      }`}
                    >
                      {row.downHrs}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-300">
                      {row.breakdownHrs}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-300">
                      {row.changeoverHrs}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-400">
                      {row.otherHrs}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[11px] ${
                          row.availabilityPercent >= 90
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : row.availabilityPercent >= 75
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {row.availabilityPercent}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-slate-300 font-mono">
                      {row.jobCardsFinished}
                    </td>
                    <td className="py-2.5 px-3 text-center text-slate-400 font-mono">
                      {row.jobCardsLogged}
                    </td>
                  </tr>
                ))}

                {/* Exact TOTAL Row matching original logger */}
                <tr className="bg-slate-950 font-bold border-t-2 border-slate-700 text-slate-100">
                  <td className="py-3 px-3 uppercase tracking-wider text-amber-400">TOTAL</td>
                  <td className="py-3 px-3 text-right font-mono text-slate-300">
                    {reportData.totalRow[1]}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-emerald-400">
                    {reportData.totalRow[2]}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-rose-400">
                    {reportData.totalRow[3]}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-slate-200">
                    {reportData.totalRow[4]}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-slate-200">
                    {reportData.totalRow[5]}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-slate-400">
                    {reportData.totalRow[6]}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-teal-300 text-sm">
                    {reportData.totalRow[7]}%
                  </td>
                  <td className="py-3 px-3 text-center font-mono text-slate-200">
                    {reportData.totalRow[8]}
                  </td>
                  <td className="py-3 px-3 text-center font-mono text-slate-400">
                    {reportData.totalRow[9]}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 2: Daily Breakdown table */}
        {activeReportSubTab === 'daily' && reportData && (
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/90 text-slate-400 font-semibold whitespace-nowrap">
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Machine</th>
                  <th className="py-2.5 px-3 text-right">Hrs down</th>
                  <th className="py-2.5 px-3 text-right">Hrs running</th>
                  <th className="py-2.5 px-3 text-right">Breakdown hrs</th>
                  <th className="py-2.5 px-3 text-right">Changeover hrs</th>
                  <th className="py-2.5 px-3 text-right">Other stoppage</th>
                  <th className="py-2.5 px-3 text-center">Job cards finished</th>
                  <th className="py-2.5 px-3 text-center">Job cards logged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {reportData.buildResult.daily.map(([date, machine, stats], idx) => (
                  <tr key={`${date}-${machine}-${idx}`} className="hover:bg-slate-850/50 whitespace-nowrap">
                    <td className="py-2 px-3 font-mono text-slate-300">{date}</td>
                    <td className="py-2 px-3 font-medium text-slate-100">{machine}</td>
                    <td className={`py-2 px-3 text-right font-mono ${stats.down > 0 ? 'text-rose-400 font-bold' : 'text-slate-500'}`}>
                      {r2(stats.down)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-emerald-400 font-bold">
                      {r2(stats.run)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-300">
                      {r2(stats.bd)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-300">
                      {r2(stats.co)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-400">
                      {r2(stats.ot)}
                    </td>
                    <td className="py-2 px-3 text-center font-mono text-slate-300">
                      {stats.jc}
                    </td>
                    <td className="py-2 px-3 text-center font-mono text-slate-400">
                      {stats.jct}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 3: Granular Incident Entries */}
        {activeReportSubTab === 'entries' && (
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/90 text-slate-400 font-semibold whitespace-nowrap">
                  <th className="py-2.5 px-3">Machine</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Stopped</th>
                  <th className="py-2.5 px-3">Running again</th>
                  <th className="py-2.5 px-3 text-right">Hrs down</th>
                  <th className="py-2.5 px-3">Reason</th>
                  <th className="py-2.5 px-3">Reported by</th>
                  <th className="py-2.5 px-3">Job card</th>
                  <th className="py-2.5 px-3">Plan</th>
                  <th className="py-2.5 px-3 text-center">Signature</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {rangeEntries.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-500">
                      No stoppage entries recorded between {fromDate} and {toDate}.
                    </td>
                  </tr>
                ) : (
                  rangeEntries.map((e) => {
                    const sTime = toTimestamp(e.start);
                    const eTime = e.end ? toTimestamp(e.end) : Date.now();
                    const hrs = r2((eTime - sTime) / 36e5);
                    return (
                      <tr key={e.id} className="hover:bg-slate-850/50 whitespace-nowrap">
                        <td className="py-2.5 px-3 font-bold text-slate-100">{e.m}</td>
                        <td className="py-2.5 px-3">
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300">
                            {e.cat}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-300 text-[11px]">{fmtT(e.start)}</td>
                        <td className="py-2.5 px-3 font-mono text-[11px]">
                          {e.end ? fmtT(e.end) : <span className="text-rose-400 font-bold">still OFF</span>}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-300">{hrs}</td>
                        <td className="py-2.5 px-3 text-slate-300 whitespace-normal max-w-xs">{e.reason}</td>
                        <td className="py-2.5 px-3 text-slate-300">{e.rep || '-'}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-300">{e.jcn || '-'}</td>
                        <td className="py-2.5 px-3">
                          <span className="text-slate-300">{e.jcp || 'Not applicable'}</span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {e.signature ? (
                            <span className="text-emerald-400 font-semibold text-[11px]">Online Signed</span>
                          ) : (
                            <span className="text-slate-500 text-[11px]">Unsigned</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Supervisor Sign-Off Modal */}
      {isSignOffModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Supervisor Report Sign-Off</h3>
                <p className="text-xs text-slate-400">Period: {fromDate} to {toDate}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Supervisor Full Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. David K. Moyo (Plant Superintendent)"
                  value={supervisorName}
                  onChange={(e) => setSupervisorName(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400 space-y-1">
                <div>Total Plant Operating Hours: <b className="text-emerald-400">{reportData?.totalRow[2] || 0} hrs</b></div>
                <div>Total Downtime Loss: <b className="text-rose-400">{reportData?.totalRow[3] || 0} hrs</b></div>
                <div>Overall Availability: <b className="text-teal-400">{reportData?.totalRow[7] || 0}%</b></div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSignOffModalOpen(false)}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!supervisorName.trim()) {
                      setExportNotice('Please enter supervisor name before signing off.');
                      return;
                    }
                    setIsSignedOff(true);
                    setIsSignOffModalOpen(false);
                    setExportNotice(`Report signed electronically by ${supervisorName}.`);
                  }}
                  className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-xs font-bold text-slate-950 shadow hover:from-amber-400 hover:to-orange-400"
                >
                  Apply Signature & Approve
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
