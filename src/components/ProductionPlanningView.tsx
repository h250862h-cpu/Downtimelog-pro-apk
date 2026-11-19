import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertOctagon,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Database,
  FileSpreadsheet,
  Plus,
  Search,
  Upload,
} from 'lucide-react';
import { r2, ymd } from '../services/downtimeCalc';
import {
  computeMonthlyPlanProgress,
  getBuiltInHistoricalDispatches,
  parseDispatchAndPlanningWorkbook,
  saveProductionPlanBatch,
  saveProductionPlanItem,
  saveUploadedBackgroundDispatchesBatch,
} from '../services/productionPlanStore';
import { DispatchEntry, ProductionPlanItem } from '../types';
import { MASTER_JOB_CARDS } from '../types/jobCards';
import { LgplastLogo } from './LgplastLogo';

function getPlanProgressWidthClass(pct: number): string {
  if (pct <= 0) return 'w-0';
  if (pct < 12) return 'w-1/12';
  if (pct < 20) return 'w-1/6';
  if (pct < 30) return 'w-1/4';
  if (pct < 40) return 'w-1/3';
  if (pct < 55) return 'w-1/2';
  if (pct < 70) return 'w-2/3';
  if (pct < 80) return 'w-3/4';
  if (pct < 90) return 'w-5/6';
  if (pct < 99) return 'w-11/12';
  return 'w-full';
}

interface ProductionPlanningViewProps {
  machines: string[];
  allDispatches: DispatchEntry[];
  uploadedBackgroundDispatches: DispatchEntry[];
  monthlyPlans: ProductionPlanItem[];
  currentUserName: string;
  isAdmin: boolean;
}

export const ProductionPlanningView: React.FC<ProductionPlanningViewProps> = ({
  machines,
  allDispatches,
  uploadedBackgroundDispatches,
  monthlyPlans,
  currentUserName,
  isAdmin,
}) => {
  const defaultMonth = useMemo(() => {
    const curMonth = ymd(new Date()).slice(0, 7);
    if (monthlyPlans.some((p) => p.month === curMonth)) return curMonth;
    if (monthlyPlans.length > 0) return monthlyPlans[0].month;
    return '2026-11';
  }, [monthlyPlans]);

  const [selectedMonth, setSelectedMonth] = useState<string>(defaultMonth);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'CLOSED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadBanner, setUploadBanner] = useState<{ text: string; isError?: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);

  // Manual Plan Item form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProduct, setNewProduct] = useState<string>(MASTER_JOB_CARDS[0] || '');
  const [newProductCustom, setNewProductCustom] = useState<string>('');
  const [newMachine, setNewMachine] = useState<string>('');
  const [newPlannedQty, setNewPlannedQty] = useState<string>('');
  const [newJobCardNo, setNewJobCardNo] = useState<string>('');
  const [savingItem, setSavingItem] = useState(false);

  const builtInArchiveCount = useMemo(() => getBuiltInHistoricalDispatches().length, []);

  const availableMonths = useMemo(() => {
    const set = new Set<string>(['2026-11', ymd(new Date()).slice(0, 7)]);
    monthlyPlans.forEach((p) => {
      if (p.month) set.add(p.month);
    });
    return Array.from(set).sort().reverse();
  }, [monthlyPlans]);

  // Month-strict planning progress (tracks ONLY dispatches dated in selectedMonth YYYY-MM)
  const planRows = useMemo(
    () => computeMonthlyPlanProgress(monthlyPlans, allDispatches, selectedMonth),
    [monthlyPlans, allDispatches, selectedMonth]
  );

  const filteredPlanRows = useMemo(() => {
    return planRows.filter((row) => {
      if (statusFilter === 'OPEN' && row.isClosed) return false;
      if (statusFilter === 'CLOSED' && !row.isClosed) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hit =
          row.product.toLowerCase().includes(q) ||
          (row.machine || '').toLowerCase().includes(q) ||
          (row.jobCardNo || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [planRows, statusFilter, searchQuery]);

  const monthDispatchCount = useMemo(
    () => allDispatches.filter((e) => (e.date || '').startsWith(selectedMonth)).length,
    [allDispatches, selectedMonth]
  );

  const closedCount = useMemo(() => planRows.filter((r) => r.isClosed).length, [planRows]);
  const openCount = planRows.length - closedCount;
  const totalPlannedQty = useMemo(
    () => r2(planRows.reduce((s, r) => s + r.plannedQty, 0)),
    [planRows]
  );
  const totalDispatchedQty = useMemo(
    () => r2(planRows.reduce((s, r) => s + r.dispatchedQty, 0)),
    [planRows]
  );

  const handleWorkbookUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadBanner(null);
    setUploading(true);

    try {
      const { historyEntries, planItems, sheetSummary } = await parseDispatchAndPlanningWorkbook(
        file,
        selectedMonth,
        currentUserName
      );

      if (historyEntries.length === 0 && planItems.length === 0) {
        setUploadBanner({
          text: `Could not detect Dispatch History (Sheet 1) or Production Planning (Sheet 2) rows in "${file.name}". Ensure columns include Product / Item Name & Qty / Planned Qty.`,
          isError: true,
        });
        return;
      }

      const msgs: string[] = [...sheetSummary];
      if (historyEntries.length > 0) {
        const histRes = await saveUploadedBackgroundDispatchesBatch(historyEntries);
        msgs.push(
          `Background Dispatch History saved (${histRes.saved} rows, ${histRes.cloudSynced} synced).`
        );
      }
      if (planItems.length > 0) {
        const planRes = await saveProductionPlanBatch(planItems);
        msgs.push(
          `Monthly Production Planning saved for ${selectedMonth} (${planRes.saved} products, ${planRes.cloudSynced} synced).`
        );
      }

      setUploadBanner({ text: msgs.join(' '), isError: false });
    } catch (err: any) {
      setUploadBanner({
        text: `Failed reading workbook "${file.name}": ${err?.message || 'Unknown error'}`,
        isError: true,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleAddManualPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalProd = (newProduct === '__CUSTOM__' ? newProductCustom : newProduct).trim();
    const qtyNum = Number(newPlannedQty);
    if (!finalProd || !qtyNum || Number.isNaN(qtyNum) || qtyNum <= 0) {
      setUploadBanner({
        text: 'Please select a Product and enter a positive Planned Quantity.',
        isError: true,
      });
      return;
    }

    setSavingItem(true);
    try {
      const safeKey = finalProd.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 48);
      const id = `PLAN-${selectedMonth}-${safeKey}${newMachine ? `-${newMachine.replace(/[^A-Z0-9]+/gi, '_')}` : ''}`;
      const item: ProductionPlanItem = {
        id,
        month: selectedMonth,
        product: finalProd,
        machine: newMachine || undefined,
        plannedQty: r2(qtyNum),
        jobCardNo: newJobCardNo.trim() || `JC-${selectedMonth}`,
        uploadedBy: currentUserName,
        updatedAt: new Date().toISOString(),
        upd: Date.now(),
      };
      await saveProductionPlanItem(item);
      setNewPlannedQty('');
      setNewJobCardNo('');
      setNewProductCustom('');
      setShowAddForm(false);
      setUploadBanner({
        text: `Added/updated Monthly Production Plan for "${finalProd}" (${qtyNum} pcs) in ${selectedMonth}.`,
        isError: false,
      });
    } finally {
      setSavingItem(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header + Multi-Sheet Upload Panel */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-5 shadow-lg space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <LgplastLogo size="sm" showSubtitle={false} />
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-amber-500 text-white shadow">
              <ClipboardList className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-black text-white">
                Monthly Production Planning &amp; Background Dispatch Continuation
              </h2>
              <p className="text-xs text-slate-400">
                Tracks ONLY dispatches logged during the selected planning month ({selectedMonth}). Completed job cards flag <b className="text-rose-400">RED — PLAN FINISHED</b> automatically.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5">
              <Calendar className="h-3.5 w-3.5 text-sky-400" />
              <label className="text-[10px] font-bold uppercase text-slate-400">
                Planning Month:
              </label>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-transparent text-xs font-black text-white focus:outline-none"
              />
            </div>

            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowAddForm((v) => !v)}
                className="flex items-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/15 hover:bg-sky-500/25 px-3 py-2 text-xs font-bold text-sky-300 transition"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Plan Item</span>
              </button>
            )}
          </div>
        </div>

        {/* Quick Month Switch Pills & Background Continuation Summary */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-400 font-bold">Quick Months:</span>
            {availableMonths.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setSelectedMonth(m)}
                className={`rounded-lg border px-2.5 py-1 font-bold transition ${
                  selectedMonth === m
                    ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                    : 'border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5 text-slate-300">
            <Database className="h-3.5 w-3.5 text-emerald-400" />
            <span>
              Background Continuation Active:{' '}
              <b className="text-emerald-300">{builtInArchiveCount.toLocaleString()}</b> built-in +{' '}
              <b className="text-sky-300">{uploadedBackgroundDispatches.length}</b> uploaded archive rows
            </span>
          </div>
        </div>

        {/* Upload Workbook Box */}
        <div className="rounded-xl border border-dashed border-sky-500/45 bg-slate-950/90 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-black text-white flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
              <span>Upload Workbook (.xlsx / .xls / .csv): Previous Records + Monthly Planning</span>
            </div>
            <p className="text-[11px] text-slate-400">
              • <b>Sheet 1</b> attaches previous months&apos; trolley/dispatch movements seamlessly in background. • <b>Sheet 2</b> uploads the target month&apos;s Production Plan (<b className="text-sky-300">{selectedMonth}</b>) to track live dispatch progress &amp; close finished job cards in Red.
            </p>
          </div>

          <label className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 px-4 py-2.5 text-xs font-black text-white shadow-lg cursor-pointer transition">
            <Upload className="h-4 w-4" />
            <span>{uploading ? 'Importing Sheets...' : 'Upload Excel / CSV'}</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={uploading}
              onChange={handleWorkbookUpload}
              className="hidden"
            />
          </label>
        </div>

        {uploadBanner && (
          <div
            className={`flex items-center gap-2 rounded-xl border p-3 text-xs font-semibold ${
              uploadBanner.isError
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            }`}
          >
            {uploadBanner.isError ? (
              <AlertCircle className="h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            )}
            <span>{uploadBanner.text}</span>
          </div>
        )}

        {/* Manual Plan Entry Form */}
        {showAddForm && (
          <form
            onSubmit={handleAddManualPlan}
            className="rounded-xl border border-sky-500/40 bg-slate-950 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end"
          >
            <div className="lg:col-span-2">
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                Product (Job Card Catalogue) *
              </label>
              <select
                value={newProduct}
                onChange={(e) => setNewProduct(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"
              >
                {MASTER_JOB_CARDS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                <option value="__CUSTOM__">+ Enter Custom Product Name</option>
              </select>
              {newProduct === '__CUSTOM__' && (
                <input
                  type="text"
                  placeholder="Custom product name..."
                  value={newProductCustom}
                  onChange={(e) => setNewProductCustom(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white"
                />
              )}
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                Machine (Optional)
              </label>
              <select
                value={newMachine}
                onChange={(e) => setNewMachine(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"
              >
                <option value="">Any / All Machines</option>
                {machines.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                Planned Qty ({selectedMonth}) *
              </label>
              <input
                type="number"
                min="1"
                step="any"
                required
                placeholder="e.g. 5000"
                value={newPlannedQty}
                onChange={(e) => setNewPlannedQty(e.target.value)}
                className="w-full rounded-xl border border-emerald-500/40 bg-slate-900 px-3 py-2 text-xs font-black text-emerald-300 tabular-nums"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={savingItem}
                className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3 py-2 text-xs font-black text-white"
              >
                {savingItem ? 'Saving...' : 'Save Plan'}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-300"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Month KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 tabular-nums">
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="text-[10px] font-bold uppercase text-slate-400">
              Planned Items ({selectedMonth})
            </div>
            <div className="text-xl font-black text-white mt-0.5">{planRows.length}</div>
          </div>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3">
            <div className="text-[10px] font-bold uppercase text-emerald-300">Open Job Cards</div>
            <div className="text-xl font-black text-emerald-300 mt-0.5">{openCount}</div>
          </div>
          <div className="rounded-xl border border-rose-500/50 bg-rose-950/35 p-3">
            <div className="text-[10px] font-bold uppercase text-rose-300 flex items-center gap-1">
              <AlertOctagon className="h-3.5 w-3.5" />
              Closed (RED Finished)
            </div>
            <div className="text-xl font-black text-rose-400 mt-0.5">{closedCount}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="text-[10px] font-bold uppercase text-slate-400">Planned Qty Sum</div>
            <div className="text-xl font-black text-sky-300 mt-0.5">
              {totalPlannedQty.toLocaleString()}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="text-[10px] font-bold uppercase text-slate-400">
              Month Dispatched ({monthDispatchCount} loads)
            </div>
            <div className="text-xl font-black text-amber-300 mt-0.5">
              {totalDispatchedQty.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* MONTHLY PLANNING TRACKER TABLE */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(['ALL', 'OPEN', 'CLOSED'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                  statusFilter === st
                    ? st === 'CLOSED'
                      ? 'border-rose-500 bg-rose-500/20 text-rose-300'
                      : 'border-sky-400 bg-sky-500/20 text-sky-200'
                    : 'border-slate-700 bg-slate-950 text-slate-300'
                }`}
              >
                {st === 'ALL'
                  ? `All (${planRows.length})`
                  : st === 'OPEN'
                  ? `Open (${openCount})`
                  : `Red Closed Finished (${closedCount})`}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search planned product or job card..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-white"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="bg-slate-950 text-[10px] font-black uppercase text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-3 py-2.5">Job Card</th>
                <th className="px-3 py-2.5">Product Name</th>
                <th className="px-3 py-2.5">Machine Scope</th>
                <th className="px-3 py-2.5 text-right">Planned Qty</th>
                <th className="px-3 py-2.5 text-right">Month Dispatched</th>
                <th className="px-3 py-2.5 text-right">Remaining</th>
                <th className="px-3 py-2.5 text-right">Month Wt (kg)</th>
                <th className="px-3 py-2.5 w-40">Progress</th>
                <th className="px-3 py-2.5 text-center">Plan Flag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-900/50">
              {filteredPlanRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    No monthly production plans uploaded for {selectedMonth} yet. Upload your workbook Sheet 2 or click &quot;Add Plan Item&quot;.
                  </td>
                </tr>
              ) : (
                filteredPlanRows.map((row) => (
                  <tr
                    key={row.id}
                    className={
                      row.isClosed
                        ? 'bg-rose-950/60 hover:bg-rose-950/80 border-l-4 border-l-rose-500 transition'
                        : 'hover:bg-slate-800/40 transition'
                    }
                  >
                    <td className="px-3 py-2.5 font-mono font-bold text-slate-300">
                      {row.jobCardNo || row.month}
                    </td>
                    <td
                      className={`px-3 py-2.5 font-bold ${
                        row.isClosed ? 'text-rose-200' : 'text-white'
                      }`}
                    >
                      {row.product}
                    </td>
                    <td className="px-3 py-2.5 text-slate-300">{row.machine || 'All Lines'}</td>
                    <td className="px-3 py-2.5 text-right font-black text-sky-300">
                      {row.plannedQty.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-black text-amber-300">
                      {row.dispatchedQty.toLocaleString()}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-black ${
                        row.isClosed ? 'text-rose-400' : 'text-emerald-300'
                      }`}
                    >
                      {row.remainingQty.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-200">
                      {row.dispatchedKg.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${getPlanProgressWidthClass(row.progressPct)} ${
                              row.isClosed ? 'bg-rose-500' : 'bg-emerald-400'
                            }`}
                          />
                        </div>
                        <span
                          className={`text-[10px] font-black ${
                            row.isClosed ? 'text-rose-300' : 'text-emerald-300'
                          }`}
                        >
                          {row.progressPct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {row.isClosed ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2 py-0.5 text-[10px] font-black text-white shadow">
                          <AlertOctagon className="h-3 w-3" />
                          CLOSED — FINISHED
                        </span>
                      ) : (
                        <span className="rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-300">
                          OPEN ({row.dispatchCount} loads)
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
    </div>
  );
};
