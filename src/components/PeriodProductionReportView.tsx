import React, { useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Clock,
  FileSpreadsheet,
  FileText,
  Fuel,
  Lock,
  Sparkles,
  Zap,
} from 'lucide-react';
import { ymd } from '../services/downtimeCalc';
import { extractTimeLabel, formatDurationHm } from '../services/powerGenStore';
import {
  buildUnifiedProductionReport,
  exportUnifiedProductionReportExcel,
} from '../services/productionPlanStore';
import { generatePeriodProductionReportPdf } from '../services/reportPdf';
import {
  DieselFuelRequest,
  DieselGrnRecord,
  DieselTankConfig,
  DispatchEntry,
  DowntimeEntry,
  GeneratorLog,
  PowerCutLog,
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
  dieselRequests: DieselFuelRequest[];
  dieselGrns: DieselGrnRecord[];
  dieselTank: DieselTankConfig;
  generatorLogs: GeneratorLog[];
  powerCutLogs: PowerCutLog[];
  currentUserName: string;
  isAdmin: boolean;
}

export const PeriodProductionReportView: React.FC<PeriodProductionReportViewProps> = ({
  machines,
  downtimeEntries,
  allDispatches,
  sopProductionLogs,
  sopQcChecks,
  dieselRequests,
  dieselGrns,
  dieselTank,
  generatorLogs,
  powerCutLogs,
  currentUserName,
  isAdmin,
}) => {
  const todayStr = ymd(new Date());
  const weekAgoDate = new Date();
  weekAgoDate.setDate(weekAgoDate.getDate() - 7);
  const weekAgoStr = ymd(weekAgoDate);

  const [fromDate, setFromDate] = useState<string>(weekAgoStr);
  const [toDate, setToDate] = useState<string>(todayStr);
  const [activeSubView, setActiveSubView] = useState<
    'dispatch' | 'production' | 'qc' | 'fuel' | 'generator' | 'powercut'
  >('dispatch');
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
        dieselRequests,
        dieselGrns,
        dieselTank,
        generatorLogs,
        powerCutLogs,
      }),
    [
      fromDate,
      toDate,
      machines,
      downtimeEntries,
      allDispatches,
      sopProductionLogs,
      sopQcChecks,
      dieselRequests,
      dieselGrns,
      dieselTank,
      generatorLogs,
      powerCutLogs,
    ]
  );

  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-rose-200 bg-white/95 p-8 text-center space-y-2 shadow-xs">
        <Lock className="h-9 w-9 text-rose-700 mx-auto" />
        <h3 className="text-base font-bold text-slate-900">
          Administrator Access Required
        </h3>
        <p className="text-xs text-slate-600 max-w-md mx-auto">
          Confidential report and Excel generation across LG PLAST is restricted strictly to Plant Administrators and Production HOD accounts.
        </p>
      </div>
    );
  }

  const applyPreset = (
    preset: 'today' | '7days' | 'thisMonth' | 'lastMonth'
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
    }
  };

  const handleDownloadExcel = async () => {
    if (!isAdmin) return;
    setExportNotice('Compiling 6-Sheet Period Production Excel (.xlsx) in background...');
    await exportUnifiedProductionReportExcel(report, isAdmin);
    setExportNotice(
      `Downloaded 6-Sheet Period Production Excel (${report.fromDate} to ${report.toDate}) — No SUMIF, All Entries Included.`
    );
  };

  const handleDownloadPdf = async () => {
    if (!isAdmin) return;
    await generatePeriodProductionReportPdf(report, currentUserName, isAdmin);
    setExportNotice(
      `Downloaded Portrait Period Production Report PDF (${report.fromDate} to ${report.toDate}) with LG PLAST Logo.`
    );
  };

  return (
    <div className="space-y-5">
      {/* Formal Corporate Header & Filters */}
      <div className="rounded-xl border border-slate-200 bg-white/95 p-4 sm:p-5 shadow-xs space-y-4 text-slate-900">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <LgplastLogo size="sm" showSubtitle={false} />
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0F1E36] text-white shadow-xs">
              <BarChart3 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                Period Production &amp; Utilities Report (Admin Multi-Sheet Entries)
              </h2>
              <p className="text-xs text-slate-600">
                Filtered period entries across 6 worksheets: Dispatch &amp; Production, Production Logs, QC Logs, Fuel Logs, Generator Logs (L), and Power Cut Logs.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleDownloadExcel}
              className="flex items-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-3.5 py-2 text-xs font-bold text-white shadow-xs transition"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span>Download Excel (6 Sheets .xlsx)</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-800 shadow-2xs transition"
            >
              <FileText className="h-4 w-4 text-[#0F1E36]" />
              <span>Portrait PDF</span>
            </button>
          </div>
        </div>

        {exportNotice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
            {exportNotice}
          </div>
        )}

        {/* Filter Controls */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['today', 'Today'],
                ['7days', 'Last 7 Days'],
                ['thisMonth', 'This Month'],
                ['lastMonth', 'Last Month'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => applyPreset(id)}
                className="rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                From Date
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                To Date
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
              />
            </div>
          </div>
        </div>

        {/* Executive KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 tabular-nums">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-[10px] font-bold uppercase text-slate-500">Dispatch Entries</div>
            <div className="text-lg font-bold text-[#0F1E36] mt-0.5">
              {report.dispatchRows.length.toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-600">
              {report.totals.totalPcs.toLocaleString()} pcs · {report.totals.totalKg.toLocaleString()} kg
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-[10px] font-bold uppercase text-slate-500">Prod &amp; QC Logs</div>
            <div className="text-lg font-bold text-slate-900 mt-0.5">
              {report.shiftProductionRows.length} / {report.qcRows.length}
            </div>
            <div className="text-[11px] text-slate-600">
              Scrap: {report.totals.totalScrapKg} kg
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-[10px] font-bold uppercase text-slate-500">Machine Hrs</div>
            <div className="text-lg font-bold text-emerald-800 mt-0.5">
              {report.totals.totalProdHrs}h
            </div>
            <div className="text-[11px] text-rose-700">
              Down: {report.totals.totalDownHrs}h
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-[10px] font-bold uppercase text-slate-500 flex items-center gap-1">
              <Fuel className="h-3 w-3 text-[#0F1E36]" /> Fuel Logs
            </div>
            <div className="text-lg font-bold text-slate-900 mt-0.5">
              {report.totals.totalFuelIssuedLitres} L
            </div>
            <div className="text-[11px] text-emerald-700">
              GRN: +{report.totals.totalFuelGrnLitres} L
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-[10px] font-bold uppercase text-slate-500 flex items-center gap-1">
              <Zap className="h-3 w-3 text-amber-700" /> Generator
            </div>
            <div className="text-lg font-bold text-slate-900 mt-0.5">
              {report.totals.totalGenFuelLitres} L
            </div>
            <div className="text-[11px] text-slate-600">
              {report.totals.totalGenRuns} run(s) · {report.totals.totalGenRunHm}
            </div>
          </div>

          <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-3">
            <div className="text-[10px] font-bold uppercase text-rose-800 flex items-center gap-1">
              <Clock className="h-3 w-3" /> Total Power Cut
            </div>
            <div className="text-lg font-bold text-rose-900 mt-0.5">
              {report.totals.totalPowerCutHm}
            </div>
            <div className="text-[11px] text-rose-700">
              {report.totals.totalPowerCutEvents} outage(s) · {report.totals.totalPowerCutHrs}h
            </div>
          </div>
        </div>

        {/* 6 Worksheet Preview Switch Tabs */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {(
            [
              ['dispatch', `1. Dispatch Entries (${report.dispatchRows.length})`],
              ['production', `2. Production Logs (${report.shiftProductionRows.length})`],
              ['qc', `3. QC Logs (${report.qcRows.length})`],
              ['fuel', `4. Fuel Logs (${report.fuelIssueRows.length + report.fuelGrnRows.length})`],
              ['generator', `5. Generator Logs (${report.generatorRows.length})`],
              ['powercut', `6. Power Cut Logs (${report.powerCutRows.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSubView(id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition ${
                activeSubView === id
                  ? 'bg-[#0F1E36] text-white border-[#0F1E36] shadow-2xs'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* SHEET 1: DISPATCH & PRODUCTION ENTRIES */}
      {activeSubView === 'dispatch' && (
        <div className="rounded-xl border border-slate-200 bg-white/95 p-4 space-y-3 text-slate-900 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#0F1E36]">
            Sheet 1: Dispatch &amp; Production Entries ({fromDate} to {toDate})
          </h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[540px] overflow-y-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <thead className="sticky top-0 bg-slate-100 text-[10px] font-bold uppercase text-slate-700 border-b border-slate-200">
                <tr>
                  <th className="px-2.5 py-2">Date</th>
                  <th className="px-2.5 py-2">Shift</th>
                  <th className="px-2.5 py-2">Machine</th>
                  <th className="px-2.5 py-2">Product</th>
                  <th className="px-2.5 py-2">Trolley</th>
                  <th className="px-2.5 py-2 text-right">Qty</th>
                  <th className="px-2.5 py-2 text-right">Weight (kg)</th>
                  <th className="px-2.5 py-2 text-right">Scrap (kg)</th>
                  <th className="px-2.5 py-2 text-right">Wastage (kg)</th>
                  <th className="px-2.5 py-2">Operator</th>
                  <th className="px-2.5 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {report.dispatchRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-slate-500">
                      No dispatch/production entries found between {fromDate} and {toDate}.
                    </td>
                  </tr>
                ) : (
                  report.dispatchRows.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-2.5 py-2 font-mono">{d.date}</td>
                      <td className="px-2.5 py-2">{d.shift}</td>
                      <td className="px-2.5 py-2 font-semibold text-slate-900">{d.machine}</td>
                      <td className="px-2.5 py-2 font-medium">{d.product}</td>
                      <td className="px-2.5 py-2 font-mono text-slate-600">{d.trolleyNo}</td>
                      <td className="px-2.5 py-2 text-right font-bold">{d.qty.toLocaleString()}</td>
                      <td className="px-2.5 py-2 text-right font-bold text-emerald-800">{d.kg.toLocaleString()}</td>
                      <td className="px-2.5 py-2 text-right text-rose-700">{d.scrapKg}</td>
                      <td className="px-2.5 py-2 text-right text-amber-700">{d.wastageKg}</td>
                      <td className="px-2.5 py-2 text-slate-700">{d.operatorName}</td>
                      <td className="px-2.5 py-2 text-[11px] font-semibold text-slate-700">{d.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SHEET 2: PRODUCTION LOGS */}
      {activeSubView === 'production' && (
        <div className="rounded-xl border border-slate-200 bg-white/95 p-4 space-y-3 text-slate-900 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#0F1E36]">
            Sheet 2: Production Logs (From Production Logger)
          </h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[540px] overflow-y-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <thead className="sticky top-0 bg-slate-100 text-[10px] font-bold uppercase text-slate-700 border-b border-slate-200">
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
              <tbody className="divide-y divide-slate-200">
                {report.shiftProductionRows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                      No Production Logger entries found between {fromDate} and {toDate}.
                    </td>
                  </tr>
                ) : (
                  report.shiftProductionRows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-2.5 py-2 font-mono">{r.date}</td>
                      <td className="px-2.5 py-2">{r.shift}</td>
                      <td className="px-2.5 py-2 text-slate-600">{r.dept}</td>
                      <td className="px-2.5 py-2 font-semibold">{r.machine}</td>
                      <td className="px-2.5 py-2">{r.operator}</td>
                      <td className="px-2.5 py-2 text-slate-600">{r.assistant}</td>
                      <td className="px-2.5 py-2 font-medium text-[#0F1E36]">{r.product}</td>
                      <td className="px-2.5 py-2 text-right font-semibold">
                        {r.qty ?? r.prodKg} {r.unit || 'KG'}
                      </td>
                      <td className="px-2.5 py-2 text-right font-bold text-emerald-800">{r.prodKg}</td>
                      <td className="px-2.5 py-2 text-right text-rose-700">{r.scrapKg}</td>
                      <td className="px-2.5 py-2 text-right text-amber-700">{r.wastageCdKg}</td>
                      <td className="px-2.5 py-2 text-slate-600">{r.reporter || r.loggedBy}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SHEET 3: QC LOGS */}
      {activeSubView === 'qc' && (
        <div className="rounded-xl border border-slate-200 bg-white/95 p-4 space-y-3 text-slate-900 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#0F1E36] flex items-center gap-1.5">
            <Sparkles className="h-4 w-4" />
            <span>Sheet 3: QC Inspection Logs</span>
          </h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[540px] overflow-y-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <thead className="sticky top-0 bg-slate-100 text-[10px] font-bold uppercase text-slate-700 border-b border-slate-200">
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
              <tbody className="divide-y divide-slate-200">
                {report.qcRows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                      No QC Inspection records between {fromDate} and {toDate}.
                    </td>
                  </tr>
                ) : (
                  report.qcRows.map((q) => (
                    <tr key={q.id} className="hover:bg-slate-50">
                      <td className="px-2.5 py-2 font-mono">{q.date}</td>
                      <td className="px-2.5 py-2">{q.shift}</td>
                      <td className="px-2.5 py-2 text-slate-500">{q.time || '—'}</td>
                      <td className="px-2.5 py-2 font-semibold">{q.machine}</td>
                      <td className="px-2.5 py-2 font-medium text-[#0F1E36]">{q.product}</td>
                      <td className="px-2.5 py-2 text-right">{q.pph ?? '—'}</td>
                      <td className="px-2.5 py-2 text-right">{q.kgsPerHr ?? '—'}</td>
                      <td className="px-2.5 py-2 text-right">{q.weightKg ?? '—'}</td>
                      <td className="px-2.5 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            String(q.dropBend).toLowerCase() === 'fail'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {q.dropBend}
                        </span>
                      </td>
                      <td className="px-2.5 py-2">{q.fitting}</td>
                      <td className="px-2.5 py-2">{q.color}</td>
                      <td className="px-2.5 py-2 text-slate-600">{q.reporter || q.loggedBy}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SHEET 4: FUEL LOGS */}
      {activeSubView === 'fuel' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white/95 p-4 space-y-3 text-slate-900 shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#0F1E36]">
              Sheet 4A: Diesel Bowser Fuel Issue Requests ({report.fuelIssueRows.length})
            </h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[380px] overflow-y-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="sticky top-0 bg-slate-100 text-[10px] font-bold uppercase text-slate-700 border-b border-slate-200">
                  <tr>
                    <th className="px-2.5 py-2">Voucher</th>
                    <th className="px-2.5 py-2">Date</th>
                    <th className="px-2.5 py-2">Vehicle / Equipment</th>
                    <th className="px-2.5 py-2">Driver</th>
                    <th className="px-2.5 py-2 text-right">Requested (L)</th>
                    <th className="px-2.5 py-2 text-right">1st Meter</th>
                    <th className="px-2.5 py-2 text-right">2nd Meter</th>
                    <th className="px-2.5 py-2 text-right">Taken (L)</th>
                    <th className="px-2.5 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {report.fuelIssueRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-6 text-center text-slate-500">
                        No diesel fuel issue records in this period.
                      </td>
                    </tr>
                  ) : (
                    report.fuelIssueRows.map((f) => (
                      <tr key={f.id} className="hover:bg-slate-50">
                        <td className="px-2.5 py-2 font-mono font-semibold">{f.requestNo}</td>
                        <td className="px-2.5 py-2">{f.date}</td>
                        <td className="px-2.5 py-2 font-semibold">{f.vehicleOrForklift}</td>
                        <td className="px-2.5 py-2">{f.driverName}</td>
                        <td className="px-2.5 py-2 text-right">{f.requestedLitres}</td>
                        <td className="px-2.5 py-2 text-right font-mono">{f.firstMeterReading ?? '—'}</td>
                        <td className="px-2.5 py-2 text-right font-mono">{f.secondMeterReading ?? '—'}</td>
                        <td className="px-2.5 py-2 text-right font-bold text-emerald-800">
                          {f.actualLitresTaken ?? '—'}
                        </td>
                        <td className="px-2.5 py-2 text-[11px] font-semibold">{f.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white/95 p-4 space-y-3 text-slate-900 shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#0F1E36]">
              Sheet 4B: Fuel GRN Replenishments ({report.fuelGrnRows.length})
            </h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="bg-slate-100 text-[10px] font-bold uppercase text-slate-700 border-b border-slate-200">
                  <tr>
                    <th className="px-2.5 py-2">GRN No</th>
                    <th className="px-2.5 py-2">Date</th>
                    <th className="px-2.5 py-2">Supplier</th>
                    <th className="px-2.5 py-2">Receiver</th>
                    <th className="px-2.5 py-2 text-right">1st Meter</th>
                    <th className="px-2.5 py-2 text-right">2nd Meter</th>
                    <th className="px-2.5 py-2 text-right">Added (+L)</th>
                    <th className="px-2.5 py-2 text-right">Tank After (L)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {report.fuelGrnRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                        No Fuel GRN records in this period.
                      </td>
                    </tr>
                  ) : (
                    report.fuelGrnRows.map((g) => (
                      <tr key={g.id} className="hover:bg-slate-50">
                        <td className="px-2.5 py-2 font-mono font-semibold">{g.grnNo}</td>
                        <td className="px-2.5 py-2">{g.date}</td>
                        <td className="px-2.5 py-2 font-semibold">{g.supplierName}</td>
                        <td className="px-2.5 py-2">{g.receiverName}</td>
                        <td className="px-2.5 py-2 text-right font-mono">{g.firstMeterReading}</td>
                        <td className="px-2.5 py-2 text-right font-mono">{g.secondMeterReading}</td>
                        <td className="px-2.5 py-2 text-right font-bold text-emerald-800">+{g.litresAdded} L</td>
                        <td className="px-2.5 py-2 text-right font-semibold">{g.tankLevelAfter.toLocaleString()} L</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SHEET 5: GENERATOR LOGS (LITRES) */}
      {activeSubView === 'generator' && (
        <div className="rounded-xl border border-slate-200 bg-white/95 p-4 space-y-3 text-slate-900 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#0F1E36]">
              Sheet 5: Generator Start Up &amp; Stop Logs (Litres)
            </h3>
            <span className="text-xs font-bold text-slate-800 tabular-nums">
              Period Totals: {report.totals.totalGenRunHm} · {report.totals.totalGenFuelLitres} L used
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs tabular-nums">
              <thead className="bg-slate-100 text-[10px] font-bold uppercase text-slate-700 border-b border-slate-200">
                <tr>
                  <th className="px-2.5 py-2">Date</th>
                  <th className="px-2.5 py-2">Shift</th>
                  <th className="px-2.5 py-2">Started</th>
                  <th className="px-2.5 py-2 text-right">Start Fuel (L)</th>
                  <th className="px-2.5 py-2">Stopped</th>
                  <th className="px-2.5 py-2 text-right">Stop Fuel (L)</th>
                  <th className="px-2.5 py-2 text-right">Fuel Used (L)</th>
                  <th className="px-2.5 py-2 text-right">Run Duration</th>
                  <th className="px-2.5 py-2">Operator</th>
                  <th className="px-2.5 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {report.generatorRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                      No Generator logs found between {fromDate} and {toDate}.
                    </td>
                  </tr>
                ) : (
                  report.generatorRows.map((g) => (
                    <tr key={g.id} className="hover:bg-slate-50">
                      <td className="px-2.5 py-2 font-mono">{g.date}</td>
                      <td className="px-2.5 py-2">{g.shift}</td>
                      <td className="px-2.5 py-2 font-mono">{extractTimeLabel(g.startTime)}</td>
                      <td className="px-2.5 py-2 text-right font-semibold">{g.startFuelLitres} L</td>
                      <td className="px-2.5 py-2 font-mono">
                        {g.stopTime ? extractTimeLabel(g.stopTime) : 'RUNNING'}
                      </td>
                      <td className="px-2.5 py-2 text-right font-semibold">
                        {typeof g.stopFuelLitres === 'number' ? `${g.stopFuelLitres} L` : '—'}
                      </td>
                      <td className="px-2.5 py-2 text-right font-bold text-amber-800">
                        {typeof g.fuelUsedLitres === 'number' ? `${g.fuelUsedLitres} L` : '—'}
                      </td>
                      <td className="px-2.5 py-2 text-right font-semibold">
                        {formatDurationHm(g.durationMinutes)}
                      </td>
                      <td className="px-2.5 py-2">{g.operatorName}</td>
                      <td className="px-2.5 py-2 font-semibold">{g.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SHEET 6: POWER CUT LOGS */}
      {activeSubView === 'powercut' && (
        <div className="rounded-xl border border-slate-200 bg-white/95 p-4 space-y-3 text-slate-900 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#0F1E36]">
              Sheet 6: Plant Power Cut Logs ({fromDate} to {toDate})
            </h3>
            <span className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-bold text-rose-900 tabular-nums">
              Total Power Cut Duration: {report.totals.totalPowerCutHm} ({report.totals.totalPowerCutHrs} hrs)
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs tabular-nums">
              <thead className="bg-slate-100 text-[10px] font-bold uppercase text-slate-700 border-b border-slate-200">
                <tr>
                  <th className="px-2.5 py-2">Date</th>
                  <th className="px-2.5 py-2">Shift</th>
                  <th className="px-2.5 py-2">Time Out</th>
                  <th className="px-2.5 py-2">Time Back</th>
                  <th className="px-2.5 py-2 text-right">Duration</th>
                  <th className="px-2.5 py-2">Affected Area</th>
                  <th className="px-2.5 py-2">Gen Started</th>
                  <th className="px-2.5 py-2">Status</th>
                  <th className="px-2.5 py-2">Notes</th>
                  <th className="px-2.5 py-2">Logged By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {report.powerCutRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                      No Power Cut logs found between {fromDate} and {toDate}.
                    </td>
                  </tr>
                ) : (
                  report.powerCutRows.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-2.5 py-2 font-mono">{p.date}</td>
                      <td className="px-2.5 py-2">{p.shift}</td>
                      <td className="px-2.5 py-2 font-mono font-semibold text-rose-800">
                        {extractTimeLabel(p.timeOut)}
                      </td>
                      <td className="px-2.5 py-2 font-mono font-semibold text-emerald-800">
                        {p.timeBack ? extractTimeLabel(p.timeBack) : 'ONGOING'}
                      </td>
                      <td className="px-2.5 py-2 text-right font-bold">
                        {formatDurationHm(p.durationMinutes)}
                      </td>
                      <td className="px-2.5 py-2">{p.affectedArea}</td>
                      <td className="px-2.5 py-2">{p.generatorUsed ? 'Yes' : 'No'}</td>
                      <td className="px-2.5 py-2 font-semibold">{p.status}</td>
                      <td className="px-2.5 py-2 text-slate-600">{p.reason || '—'}</td>
                      <td className="px-2.5 py-2 text-slate-600">{p.loggedBy}</td>
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
