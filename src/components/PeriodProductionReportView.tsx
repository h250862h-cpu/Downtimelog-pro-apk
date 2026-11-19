import React, { useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Lock,
  Sparkles,
} from 'lucide-react';
import { ymd } from '../services/downtimeCalc';
import {
  buildUnifiedProductionReport,
  exportUnifiedProductionReportExcel,
} from '../services/productionPlanStore';
import { generatePeriodProductionReportPdf } from '../services/reportPdf';
import {
  DispatchEntry,
  DowntimeEntry,
  SopProductionRecord,
  SopQcRecord,
} from '../types';
import { LgplastLogo } from './LgplastLogo';

interface PeriodProductionReportViewProps {
  machines: string[];
  downtimeEntries: DowntimeEntry[];
  allDispatches: DispatchEntry[];
  sopProductionLogs: SopProductionRecord[];
  sopQcChecks: SopQcRecord[];
  currentUserName: string;
  canExport: boolean;
}

export const PeriodProductionReportView: React.FC<PeriodProductionReportViewProps> = ({
  machines,
  downtimeEntries,
  allDispatches,
  sopProductionLogs,
  sopQcChecks,
  currentUserName,
  canExport,
}) => {
  const todayStr = ymd(new Date());
  const weekAgoDate = new Date();
  weekAgoDate.setDate(weekAgoDate.getDate() - 7);
  const weekAgoStr = ymd(weekAgoDate);

  const [fromDate, setFromDate] = useState<string>(weekAgoStr);
  const [toDate, setToDate] = useState<string>(todayStr);
  const [activeSubView, setActiveSubView] = useState<'summary' | 'shift' | 'qc'>('summary');
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const report = useMemo(
    () =>
      buildUnifiedProductionReport({
        fromDate,
        toDate,
        machines,
        downtimeEntries,
        allDispatches,
        sopProductionLogs,
        sopQcChecks,
      }),
    [fromDate, toDate, machines, downtimeEntries, allDispatches, sopProductionLogs, sopQcChecks]
  );

  const applyPreset = (
    preset: 'today' | '7days' | 'thisMonth' | 'lastMonth' | 'novW1'
  ) => {
    const n = new Date();
    if (preset === 'today') {
      const s = ymd(n);
      setFromDate(s);
      setToDate(s);
    } else if (preset === '7days') {
      const f = new Date();
      f.setDate(n.getDate() - 6);
      setFromDate(ymd(f));
      setToDate(ymd(n));
    } else if (preset === 'thisMonth') {
      setFromDate(ymd(new Date(n.getFullYear(), n.getMonth(), 1)));
      setToDate(ymd(n));
    } else if (preset === 'lastMonth') {
      setFromDate(ymd(new Date(n.getFullYear(), n.getMonth() - 1, 1)));
      setToDate(ymd(new Date(n.getFullYear(), n.getMonth(), 0)));
    } else if (preset === 'novW1') {
      setFromDate('2026-11-08');
      setToDate('2026-11-15');
    }
  };

  const handleDownloadExcel = () => {
    if (!canExport) {
      setExportNotice('Export Restricted: Admin / Production Report clearance required.');
      return;
    }
    exportUnifiedProductionReportExcel(report);
    setExportNotice(
      `Downloaded Unified Period Production Report Excel (${report.fromDate} to ${report.toDate}).`
    );
  };

  const handleDownloadPdf = async () => {
    if (!canExport) {
      setExportNotice('Export Restricted: Admin / Production Report clearance required.');
      return;
    }
    await generatePeriodProductionReportPdf(report, currentUserName);
    setExportNotice(
      `Downloaded Portrait Period Production Report PDF (${report.fromDate} to ${report.toDate}) with LG PLAST Logo.`
    );
  };

  return (
    <div className="space-y-5">
      {/* Header & Period Selector */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-5 shadow-lg space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <LgplastLogo size="sm" showSubtitle={false} />
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-sky-600 text-white shadow">
              <BarChart3 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-black text-white">
                Unified Period Production Report (SUMIF Structure)
              </h2>
              <p className="text-xs text-slate-400">
                Aggregates Dispatch History &amp; Live Movements (Product/Machine SUMIF), Machine Log Run &amp; Downtime Hrs, Production Logger Per Shift &amp; QC Inspections.
              </p>
            </div>
          </div>

          {canExport ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDownloadExcel}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-black text-white shadow transition"
              >
                <FileSpreadsheet className="h-4 w-4" />
                <span>Download Excel (.xlsx)</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadPdf}
                className="flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 px-3.5 py-2 text-xs font-black text-slate-950 shadow transition"
              >
                <FileText className="h-4 w-4" />
                <span>Portrait PDF</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300">
              <Lock className="h-4 w-4" />
              <span>Export Locked (Admin Only)</span>
            </div>
          )}
        </div>

        {exportNotice && (
          <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-2.5 text-xs font-semibold text-emerald-300">
            {exportNotice}
          </div>
        )}

        {/* Filter Controls */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => applyPreset('today')}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-slate-800"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => applyPreset('7days')}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-slate-800"
            >
              Last 7 Days
            </button>
            <button
              type="button"
              onClick={() => applyPreset('thisMonth')}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-slate-800"
            >
              This Month
            </button>
            <button
              type="button"
              onClick={() => applyPreset('lastMonth')}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-slate-800"
            >
              Last Month
            </button>
            <button
              type="button"
              onClick={() => applyPreset('novW1')}
              className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-1.5 text-[11px] font-bold text-sky-300 hover:bg-sky-500/25"
            >
              Nov W1 2026 (08–15)
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
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
          </div>
        </div>

        {/* 6 Top Period SUMIF KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 tabular-nums">
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="text-[10px] font-bold uppercase text-slate-400">PRODUCT (PCS)</div>
            <div className="text-lg font-black text-amber-300 mt-0.5">
              {report.totals.totalPcs.toLocaleString()}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="text-[10px] font-bold uppercase text-slate-400">WEIGHT (KG)</div>
            <div className="text-lg font-black text-emerald-300 mt-0.5">
              {report.totals.totalKg.toLocaleString()}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="text-[10px] font-bold uppercase text-slate-400">SCRAP (KG)</div>
            <div className="text-lg font-black text-rose-300 mt-0.5">
              {report.totals.totalScrapKg.toLocaleString()}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="text-[10px] font-bold uppercase text-slate-400">WASTAGE (KG)</div>
            <div className="text-lg font-black text-orange-300 mt-0.5">
              {report.totals.totalWastageKg.toLocaleString()}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1">
              <Clock className="h-3 w-3 text-sky-400" />
              TOTAL PROD HRS
            </div>
            <div className="text-lg font-black text-sky-300 mt-0.5">
              {report.totals.totalProdHrs.toLocaleString()} h
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1">
              <Activity className="h-3 w-3 text-rose-400" />
              TOTAL DOWN HRS
            </div>
            <div className="text-lg font-black text-rose-400 mt-0.5">
              {report.totals.totalDownHrs.toLocaleString()} h
            </div>
          </div>
        </div>

        {/* Section Switch Tabs */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveSubView('summary')}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
              activeSubView === 'summary'
                ? 'bg-sky-600 text-white shadow'
                : 'border border-slate-700 bg-slate-950 text-slate-300'
            }`}
          >
            1 &amp; 2. Product + Machine SUMIF ({report.productRows.length} items /{' '}
            {report.machineRows.length} machines)
          </button>
          <button
            type="button"
            onClick={() => setActiveSubView('shift')}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
              activeSubView === 'shift'
                ? 'bg-sky-600 text-white shadow'
                : 'border border-slate-700 bg-slate-950 text-slate-300'
            }`}
          >
            3. Production Per Shift ({report.shiftProductionRows.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSubView('qc')}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
              activeSubView === 'qc'
                ? 'bg-sky-600 text-white shadow'
                : 'border border-slate-700 bg-slate-950 text-slate-300'
            }`}
          >
            4. QC Report ({report.qcRows.length})
          </button>
        </div>
      </div>

      {/* SECTION 1 & 2: PRODUCT & MACHINE SUMIF TABLES */}
      {activeSubView === 'summary' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {/* Table 1: Product SUMIF */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-amber-300">
              Table 1: SUMIF Production By Product
            </h3>
            <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-[540px] overflow-y-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="sticky top-0 bg-slate-950 text-[10px] font-black uppercase text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-2.5 py-2">Product Type</th>
                    <th className="px-2.5 py-2 text-right">Prod. Pcs</th>
                    <th className="px-2.5 py-2 text-right">Prod Kg</th>
                    <th className="px-2.5 py-2 text-right">Scrap</th>
                    <th className="px-2.5 py-2 text-right">Wastage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-900/50">
                  {report.productRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                        No production/dispatch rows in selected date range.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {report.productRows.map((p) => (
                        <tr key={p.product} className="hover:bg-slate-800/40">
                          <td className="px-2.5 py-2 font-bold text-white">{p.product}</td>
                          <td className="px-2.5 py-2 text-right font-bold text-amber-300">
                            {p.prodPcs.toLocaleString()}
                          </td>
                          <td className="px-2.5 py-2 text-right font-bold text-emerald-300">
                            {p.prodKg.toLocaleString()}
                          </td>
                          <td className="px-2.5 py-2 text-right text-rose-300">
                            {p.scrapKg.toLocaleString()}
                          </td>
                          <td className="px-2.5 py-2 text-right text-orange-300">
                            {p.wastageKg.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-slate-950 font-black text-white border-t-2 border-slate-700">
                        <td className="px-2.5 py-2.5">TOTAL PRODUCTION</td>
                        <td className="px-2.5 py-2.5 text-right text-amber-300">
                          {report.totals.totalPcs.toLocaleString()}
                        </td>
                        <td className="px-2.5 py-2.5 text-right text-emerald-300">
                          {report.totals.totalKg.toLocaleString()}
                        </td>
                        <td className="px-2.5 py-2.5 text-right text-rose-300">
                          {report.totals.totalScrapKg.toLocaleString()}
                        </td>
                        <td className="px-2.5 py-2.5 text-right text-orange-300">
                          {report.totals.totalWastageKg.toLocaleString()}
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Table 2: Machine SUMIF + Run/Down Hrs */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-sky-300">
              Table 2: SUMIF Production &amp; Downtime Hrs Per Machine
            </h3>
            <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-[540px] overflow-y-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="sticky top-0 bg-slate-950 text-[10px] font-black uppercase text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-2.5 py-2">Machine</th>
                    <th className="px-2.5 py-2 text-right">Prod Pcs</th>
                    <th className="px-2.5 py-2 text-right">Weight (kg)</th>
                    <th className="px-2.5 py-2 text-right">Scrap</th>
                    <th className="px-2.5 py-2 text-right">Wastage</th>
                    <th className="px-2.5 py-2 text-right">Prod Hrs</th>
                    <th className="px-2.5 py-2 text-right">Down Hrs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-900/50">
                  {report.machineRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                        No machine logs in selected date range.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {report.machineRows.map((m) => (
                        <tr key={m.machine} className="hover:bg-slate-800/40">
                          <td className="px-2.5 py-2 font-bold text-white">{m.machine}</td>
                          <td className="px-2.5 py-2 text-right font-bold text-amber-300">
                            {m.prodPcs.toLocaleString()}
                          </td>
                          <td className="px-2.5 py-2 text-right font-bold text-emerald-300">
                            {m.prodKg.toLocaleString()}
                          </td>
                          <td className="px-2.5 py-2 text-right text-rose-300">
                            {m.scrapKg.toLocaleString()}
                          </td>
                          <td className="px-2.5 py-2 text-right text-orange-300">
                            {m.wastageKg.toLocaleString()}
                          </td>
                          <td className="px-2.5 py-2 text-right text-sky-300 font-bold">
                            {m.prodHrs}
                          </td>
                          <td className="px-2.5 py-2 text-right text-rose-400 font-bold">
                            {m.downHrs}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-slate-950 font-black text-white border-t-2 border-slate-700">
                        <td className="px-2.5 py-2.5">TOTAL PRODUCTION</td>
                        <td className="px-2.5 py-2.5 text-right text-amber-300">
                          {report.totals.totalPcs.toLocaleString()}
                        </td>
                        <td className="px-2.5 py-2.5 text-right text-emerald-300">
                          {report.totals.totalKg.toLocaleString()}
                        </td>
                        <td className="px-2.5 py-2.5 text-right text-rose-300">
                          {report.totals.totalScrapKg.toLocaleString()}
                        </td>
                        <td className="px-2.5 py-2.5 text-right text-orange-300">
                          {report.totals.totalWastageKg.toLocaleString()}
                        </td>
                        <td className="px-2.5 py-2.5 text-right text-sky-300">
                          {report.totals.totalProdHrs}
                        </td>
                        <td className="px-2.5 py-2.5 text-right text-rose-400">
                          {report.totals.totalDownHrs}
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: PRODUCTION PER SHIFT */}
      {activeSubView === 'shift' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 space-y-3">
          <h3 className="text-xs font-black uppercase tracking-wider text-emerald-300">
            Table 3: Production Per Shift (From Production Logger)
          </h3>
          <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-[560px] overflow-y-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <thead className="sticky top-0 bg-slate-950 text-[10px] font-black uppercase text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-2.5 py-2">Date</th>
                  <th className="px-2.5 py-2">Shift</th>
                  <th className="px-2.5 py-2">Dept</th>
                  <th className="px-2.5 py-2">Machine</th>
                  <th className="px-2.5 py-2">Operator</th>
                  <th className="px-2.5 py-2">Assistant</th>
                  <th className="px-2.5 py-2">Product</th>
                  <th className="px-2.5 py-2 text-right">Qty</th>
                  <th className="px-2.5 py-2 text-right">Prod (kg)</th>
                  <th className="px-2.5 py-2 text-right">Scrap</th>
                  <th className="px-2.5 py-2 text-right">Cut Dust</th>
                  <th className="px-2.5 py-2">Reported By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/50">
                {report.shiftProductionRows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                      No Production Logger shift records between {fromDate} and {toDate}.
                    </td>
                  </tr>
                ) : (
                  report.shiftProductionRows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/40">
                      <td className="px-2.5 py-2 font-bold text-slate-200">{r.date}</td>
                      <td className="px-2.5 py-2">{r.shift}</td>
                      <td className="px-2.5 py-2 text-slate-300">{r.dept}</td>
                      <td className="px-2.5 py-2 text-white font-semibold">{r.machine}</td>
                      <td className="px-2.5 py-2">{r.operator}</td>
                      <td className="px-2.5 py-2 text-slate-300">{r.assistant}</td>
                      <td className="px-2.5 py-2 font-bold text-sky-300">{r.product}</td>
                      <td className="px-2.5 py-2 text-right font-bold text-amber-300">
                        {r.qty ?? r.prodKg} {r.unit || 'KG'}
                      </td>
                      <td className="px-2.5 py-2 text-right font-bold text-emerald-300">
                        {r.prodKg}
                      </td>
                      <td className="px-2.5 py-2 text-right text-rose-300">{r.scrapKg}</td>
                      <td className="px-2.5 py-2 text-right text-orange-300">{r.wastageCdKg}</td>
                      <td className="px-2.5 py-2 text-slate-300">{r.reporter || r.loggedBy}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION 4: QC INSPECTION REPORT */}
      {activeSubView === 'qc' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 space-y-3">
          <h3 className="text-xs font-black uppercase tracking-wider text-sky-300 flex items-center gap-1.5">
            <Sparkles className="h-4 w-4" />
            <span>Table 4: QC Inspection Report (From QC Check APK)</span>
          </h3>
          <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-[560px] overflow-y-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <thead className="sticky top-0 bg-slate-950 text-[10px] font-black uppercase text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-2.5 py-2">Date</th>
                  <th className="px-2.5 py-2">Shift</th>
                  <th className="px-2.5 py-2">Time</th>
                  <th className="px-2.5 py-2">Machine</th>
                  <th className="px-2.5 py-2">Product</th>
                  <th className="px-2.5 py-2 text-right">PPH</th>
                  <th className="px-2.5 py-2 text-right">Kgs/Hr</th>
                  <th className="px-2.5 py-2 text-right">Weight</th>
                  <th className="px-2.5 py-2">Drop/Bend</th>
                  <th className="px-2.5 py-2">Fitting</th>
                  <th className="px-2.5 py-2">Colour</th>
                  <th className="px-2.5 py-2">Reporter</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/50">
                {report.qcRows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                      No QC Inspection records between {fromDate} and {toDate}.
                    </td>
                  </tr>
                ) : (
                  report.qcRows.map((q) => (
                    <tr key={q.id} className="hover:bg-slate-800/40">
                      <td className="px-2.5 py-2 font-bold text-slate-200">{q.date}</td>
                      <td className="px-2.5 py-2">{q.shift}</td>
                      <td className="px-2.5 py-2 text-slate-400">{q.time || '—'}</td>
                      <td className="px-2.5 py-2 text-white font-semibold">{q.machine}</td>
                      <td className="px-2.5 py-2 font-bold text-sky-300">{q.product}</td>
                      <td className="px-2.5 py-2 text-right">{q.pph ?? '—'}</td>
                      <td className="px-2.5 py-2 text-right">{q.kgsPerHr ?? '—'}</td>
                      <td className="px-2.5 py-2 text-right">{q.weightKg ?? '—'}</td>
                      <td className="px-2.5 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            String(q.dropBend).toLowerCase() === 'fail'
                              ? 'bg-rose-500/20 text-rose-300'
                              : 'bg-emerald-500/20 text-emerald-300'
                          }`}
                        >
                          {q.dropBend}
                        </span>
                      </td>
                      <td className="px-2.5 py-2">{q.fitting}</td>
                      <td className="px-2.5 py-2">{q.color}</td>
                      <td className="px-2.5 py-2 text-slate-300">{q.reporter || q.loggedBy}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
