import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Lock,
  PenTool,
  Plus,
  Recycle,
  RefreshCw,
  Scale,
  Search,
  UserCheck,
} from 'lucide-react';
import {
  SCRAP_SALES_CATEGORIES,
  ScrapSalesCategoryKey,
  ScrapSalesInvoice,
  ScrapSalesSignatureSlot,
} from '../types';
import { ymd } from '../services/downtimeCalc';
import { generateScrapSalesInvoicePdf } from '../services/scrapSalesPdf';
import {
  calculateScrapSalesInvoiceValues,
  exportScrapSalesExcelWorkbook,
  generateNextScrapInvoiceNo,
  saveScrapSalesInvoiceToFirebase,
} from '../services/scrapSalesStore';
import { DigitalSignaturePad } from './DigitalSignaturePad';
import { LgplastLogo } from './LgplastLogo';

interface ScrapSalesViewProps {
  invoices: ScrapSalesInvoice[];
  isAdmin: boolean;
  currentUserName: string;
  currentUserEmail: string;
}

const EMPTY_SLOT = (): ScrapSalesSignatureSlot => ({
  name: '',
  signature: undefined,
  signedAt: '',
});

export const ScrapSalesView: React.FC<ScrapSalesViewProps> = ({
  invoices,
  isAdmin,
  currentUserName,
  currentUserEmail,
}) => {
  const [date, setDate] = useState<string>(ymd(new Date()));
  const [buyerName, setBuyerName] = useState<string>('');
  const [buyerPhone, setBuyerPhone] = useState<string>('');
  const [vehicleReg, setVehicleReg] = useState<string>('');
  const [status, setStatus] = useState<'ISSUED' | 'PAID'>('ISSUED');
  const [notes, setNotes] = useState<string>('');

  // User ONLY enters QNTY/KG for the three fixed scrap categories
  const [quantities, setQuantities] = useState<
    Record<ScrapSalesCategoryKey, string>
  >({
    colour_scrap: '',
    white_scrap: '',
    empty_bags: '',
  });

  // Optional 3 signatures captured electronically (PDF always keeps 3 signature lines)
  const [showSigPads, setShowSigPads] = useState<boolean>(false);
  const [sig1Name, setSig1Name] = useState<string>(currentUserName || '');
  const [sig1Data, setSig1Data] = useState<string>('');
  const [sig1At, setSig1At] = useState<string>('');
  const [sig2Name, setSig2Name] = useState<string>('');
  const [sig2Data, setSig2Data] = useState<string>('');
  const [sig2At, setSig2At] = useState<string>('');
  const [sig3Name, setSig3Name] = useState<string>('');
  const [sig3Data, setSig3Data] = useState<string>('');
  const [sig3At, setSig3At] = useState<string>('');
  const [activeSigSlot, setActiveSigSlot] = useState<1 | 2 | 3 | null>(null);

  const [saving, setSaving] = useState<boolean>(false);
  const [exportingExcel, setExportingExcel] = useState<boolean>(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    text: string;
    isError?: boolean;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const nextInvoiceNo = useMemo(
    () => generateNextScrapInvoiceNo(invoices, date),
    [invoices, date]
  );

  // Auto-calculate all columns strictly using CSV calculation rules
  const calculation = useMemo(
    () =>
      calculateScrapSalesInvoiceValues({
        colour_scrap: Number(quantities.colour_scrap) || 0,
        white_scrap: Number(quantities.white_scrap) || 0,
        empty_bags: Number(quantities.empty_bags) || 0,
      }),
    [quantities]
  );

  const filteredInvoices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...invoices]
      .filter((inv) => {
        if (!q) return true;
        return (
          inv.invoiceNo.toLowerCase().includes(q) ||
          inv.buyerName.toLowerCase().includes(q) ||
          (inv.vehicleReg || '').toLowerCase().includes(q) ||
          inv.date.includes(q)
        );
      })
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [invoices, searchQuery]);

  const handleQtyChange = (key: ScrapSalesCategoryKey, val: string) => {
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      setQuantities((prev) => ({ ...prev, [key]: val }));
    }
  };

  const resetForm = () => {
    setBuyerName('');
    setBuyerPhone('');
    setVehicleReg('');
    setNotes('');
    setStatus('ISSUED');
    setQuantities({ colour_scrap: '', white_scrap: '', empty_bags: '' });
    setSig1Data('');
    setSig1At('');
    setSig2Data('');
    setSig2At('');
    setSig3Data('');
    setSig3At('');
  };

  const handleSaveAndPdf = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);

    if (calculation.totalScrapQntyKg <= 0) {
      setBanner({
        text: 'Please enter QNTY/KG for at least one scrap category (Colour Scrap, White Scrap, or Empty Bags).',
        isError: true,
      });
      return;
    }

    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const nowMs = Date.now();

      const invoice: ScrapSalesInvoice = {
        id: `scrap_${nowMs}_${Math.random().toString(36).slice(2, 7)}`,
        invoiceNo: nextInvoiceNo,
        date: date || ymd(new Date()),
        buyerName: buyerName.trim() || 'CASH / WALK-IN BUYER',
        buyerPhone: buyerPhone.trim() || undefined,
        vehicleReg: vehicleReg.trim().toUpperCase() || undefined,
        notes: notes.trim() || undefined,
        items: calculation.items,
        totalScrapQntyKg: calculation.totalScrapQntyKg,
        totalNetKg: calculation.totalNetKg,
        totalCost: calculation.totalCost,
        preparedByName: currentUserName || 'Plant Operator',
        preparedByEmail: currentUserEmail || '',
        signatures: {
          preparedBy: {
            ...EMPTY_SLOT(),
            name: sig1Name.trim() || currentUserName || 'Plant Operator',
            signature: sig1Data || undefined,
            signedAt: sig1Data ? sig1At || nowIso : '',
          },
          approvedBy: {
            ...EMPTY_SLOT(),
            name: sig2Name.trim(),
            signature: sig2Data || undefined,
            signedAt: sig2Data ? sig2At || nowIso : '',
          },
          buyer: {
            ...EMPTY_SLOT(),
            name: sig3Name.trim() || buyerName.trim(),
            signature: sig3Data || undefined,
            signedAt: sig3Data ? sig3At || nowIso : '',
          },
        },
        status,
        createdAt: nowIso,
        upd: nowMs,
      };

      const res = await saveScrapSalesInvoiceToFirebase(invoice);
      await generateScrapSalesInvoicePdf(invoice);
      resetForm();

      setBanner({
        text: res.ok
          ? `Saved & synced ${invoice.invoiceNo} (Total Qnty: ${invoice.totalScrapQntyKg.toFixed(2)} kg · Total Cost: $${invoice.totalCost.toFixed(2)}) and generated 3-signature LG PLAST PDF Invoice.`
          : `Saved ${invoice.invoiceNo} offline & generated 3-signature PDF Invoice. Cloud sync queued automatically.`,
      });
    } catch (err) {
      setBanner({
        text:
          err instanceof Error
            ? err.message
            : 'Failed to save scrap sales invoice.',
        isError: true,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePaid = async (inv: ScrapSalesInvoice) => {
    setUpdatingId(inv.id);
    try {
      const updated: ScrapSalesInvoice = {
        ...inv,
        status: inv.status === 'PAID' ? 'ISSUED' : 'PAID',
        upd: Date.now(),
      };
      const res = await saveScrapSalesInvoiceToFirebase(updated);
      setBanner({
        text: res.ok
          ? `${inv.invoiceNo} updated to ${updated.status}.`
          : `${inv.invoiceNo} updated locally to ${updated.status} (queued for cloud sync).`,
      });
    } catch (err) {
      setBanner({
        text: err instanceof Error ? err.message : 'Failed to update invoice payment status.',
        isError: true,
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const handleExportExcel = async () => {
    if (!isAdmin) {
      setBanner({
        text: 'Admin Only: Excel reports are generated in background and restricted strictly to Plant Administrators.',
        isError: true,
      });
      return;
    }
    if (invoices.length === 0) {
      setBanner({
        text: 'No scrap sales invoices saved yet to export.',
        isError: true,
      });
      return;
    }
    setExportingExcel(true);
    try {
      const fileName = await exportScrapSalesExcelWorkbook(
        filteredInvoices,
        date || 'All',
        isAdmin
      );
      if (fileName) {
        setBanner({
          text: `Background Excel (.xlsx) generated & downloaded: ${fileName}`,
        });
      }
    } finally {
      setExportingExcel(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <LgplastLogo size="sm" showSubtitle={false} />
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300">
              <Recycle className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base sm:text-lg font-black text-white">
                Recycling Scrap Sales &amp; Invoice System
              </h2>
              <p className="text-xs text-slate-400">
                Enter QNTY/KG for Colour Scrap, White Scrap, and Empty Bags — unit rate, 50% net KG, Total Scrap Qnty &amp; Total Cost calculate automatically.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300 tabular-nums">
              Next Invoice: {nextInvoiceNo}
            </span>
            {isAdmin ? (
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={exportingExcel || filteredInvoices.length === 0}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3.5 py-2 text-xs font-black text-white shadow transition"
              >
                {exportingExcel ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                )}
                <span>
                  {exportingExcel
                    ? 'Generating in Background...'
                    : `Download Background Excel (${filteredInvoices.length})`}
                </span>
              </button>
            ) : (
              <span className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-[11px] font-bold text-slate-400">
                <Lock className="h-3.5 w-3.5 text-amber-400" />
                <span>Excel Export: Admin Only</span>
              </span>
            )}
          </div>
        </div>

        {/* Summary KPI Cards */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 tabular-nums">
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5">
            <div className="text-[11px] font-bold uppercase text-slate-400">
              Saved Invoices
            </div>
            <div className="text-2xl font-black text-white mt-0.5">
              {invoices.length}
            </div>
            <div className="text-[11px] text-slate-400">
              {invoices.filter((i) => i.status === 'PAID').length} paid ·{' '}
              {invoices.filter((i) => i.status === 'ISSUED').length} issued
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5">
            <div className="text-[11px] font-bold uppercase text-slate-400">
              Cumulative Scrap Sold (Gross)
            </div>
            <div className="text-2xl font-black text-sky-300 mt-0.5">
              {invoices
                .reduce((acc, inv) => acc + inv.totalScrapQntyKg, 0)
                .toFixed(2)}{' '}
              <span className="text-xs font-semibold text-slate-400">kg</span>
            </div>
            <div className="text-[11px] text-slate-400">
              Net Billable (50%):{' '}
              {invoices
                .reduce((acc, inv) => acc + inv.totalNetKg, 0)
                .toFixed(2)}{' '}
              kg
            </div>
          </div>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-3.5">
            <div className="text-[11px] font-bold uppercase text-emerald-300">
              Total Billed Revenue
            </div>
            <div className="text-2xl font-black text-emerald-300 mt-0.5">
              $
              {invoices
                .reduce((acc, inv) => acc + inv.totalCost, 0)
                .toFixed(2)}
            </div>
            <div className="text-[11px] text-emerald-400/80">
              Across Colour, White &amp; Empty Bags
            </div>
          </div>
        </div>
      </div>

      {banner && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs font-semibold flex items-center gap-2 ${
            banner.isError
              ? 'border-rose-500/40 bg-rose-950/50 text-rose-200'
              : 'border-emerald-500/40 bg-emerald-950/50 text-emerald-200'
          }`}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{banner.text}</span>
        </div>
      )}

      {/* Invoice Builder Form */}
      <form
        onSubmit={handleSaveAndPdf}
        className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-6 shadow-lg space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
              <Plus className="h-4 w-4 text-emerald-400" />
              <span>Create Recycling Scrap Sales Invoice ({nextInvoiceNo})</span>
            </h3>
            <p className="text-xs text-slate-400">
              Input weights in QNTY/KG only. Cost per KG and 50% Total KG formulas are locked to company billing rules.
            </p>
          </div>
        </div>

        {/* Invoice Metadata Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
              Invoice Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div className="lg:col-span-2">
            <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
              Buyer / Customer Name
            </label>
            <input
              type="text"
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
              placeholder="e.g. Harare Recyclers / Cash Buyer"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
              Vehicle Reg / Delivery Ref
            </label>
            <input
              type="text"
              value={vehicleReg}
              onChange={(e) => setVehicleReg(e.target.value)}
              placeholder="e.g. AFX 4821"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white uppercase focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
              Payment Status
            </label>
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value === 'PAID' ? 'PAID' : 'ISSUED')
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="ISSUED">ISSUED (Credit / Pending)</option>
              <option value="PAID">PAID (Settled)</option>
            </select>
          </div>
        </div>

        {/* Auto-Calculating Invoice Structure Matching FORMART OF INVOICE */}
        <div className="overflow-x-auto rounded-xl border border-slate-700 bg-white text-slate-900 shadow-inner">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#0F1E36] text-white uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4 font-black">NAME (SCRAP CATEGORY)</th>
                <th className="py-3 px-4 text-right font-black">COST PER KG</th>
                <th className="py-3 px-4 text-right font-black w-44">
                  QNTY / KG (ENTER HERE)
                </th>
                <th className="py-3 px-4 text-right font-black">
                  TOTAL KG (50%)
                </th>
                <th className="py-3 px-4 text-right font-black">
                  TOTAL COST ($)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 tabular-nums">
              {calculation.items.map((item, idx) => {
                const cfg = SCRAP_SALES_CATEGORIES[idx];
                const rateDisplay =
                  Math.abs(cfg.costPerKg - 0.066666667) < 0.0001
                    ? '0.066666667'
                    : cfg.costPerKg.toFixed(2);
                return (
                  <tr
                    key={item.key}
                    className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}
                  >
                    <td className="py-3 px-4 font-black text-[#0F1E36]">
                      {item.name}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-700">
                      ${rateDisplay}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        <Scale className="h-3.5 w-3.5 text-emerald-700" />
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={quantities[item.key]}
                          onChange={(e) =>
                            handleQtyChange(item.key, e.target.value)
                          }
                          placeholder="0.00"
                          className="w-32 rounded-lg border-2 border-emerald-500/70 bg-emerald-50/40 px-2.5 py-1.5 text-right text-xs font-black text-slate-900 focus:border-emerald-600 focus:bg-white focus:outline-none"
                        />
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-slate-800">
                      {item.totalKg.toFixed(2)} kg
                    </td>
                    <td className="py-3 px-4 text-right font-black text-[#0F1E36]">
                      ${item.totalCost.toFixed(2)}
                    </td>
                  </tr>
                );
              })}

              {/* TOTAL SCRAP QNTY & TOTAL COST ROW */}
              <tr className="bg-slate-100 border-t-2 border-slate-300 font-black text-[#0F1E36]">
                <td className="py-3 px-4" colSpan={2}>
                  TOTAL SCRAP QNTY &amp; TOTAL COST
                </td>
                <td className="py-3 px-4 text-right">
                  {calculation.totalScrapQntyKg.toFixed(2)} kg
                </td>
                <td className="py-3 px-4 text-right">
                  {calculation.totalNetKg.toFixed(2)} kg
                </td>
                <td className="py-3 px-4 text-right text-emerald-800">
                  ${calculation.totalCost.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Highlighted Grand TOTAL COST Footer */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-[#0F1E36] text-white px-4 py-3">
            <div className="text-xs font-semibold text-slate-200">
              TOTAL SCRAP QNTY:{' '}
              <b className="text-white">
                {calculation.totalScrapQntyKg.toFixed(2)} kg
              </b>{' '}
              (50% Net Billable:{' '}
              <b className="text-emerald-300">
                {calculation.totalNetKg.toFixed(2)} kg
              </b>
              )
            </div>
            <div className="text-sm sm:text-base font-black tracking-wide">
              TOTAL COST:{' '}
              <span className="text-emerald-300">
                ${calculation.totalCost.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Notes & Buyer Contact */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
              Buyer Phone / Contact (Optional)
            </label>
            <input
              type="text"
              value={buyerPhone}
              onChange={(e) => setBuyerPhone(e.target.value)}
              placeholder="e.g. +263 77 ..."
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
              Invoice Remarks / Scale Ticket Ref (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Weighbridge slip #..."
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Optional Electronic 3-Signature Pads (PDF always keeps 3 signature lines) */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
              <PenTool className="h-4 w-4 text-emerald-400" />
              <span>
                PDF Invoice 3-Signature Format (1. Prepared By · 2. Approved By · 3. Buyer Received By)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowSigPads((prev) => !prev)}
              className="rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-[11px] font-bold text-emerald-300 transition"
            >
              {showSigPads
                ? 'Hide Digital Signature Capture (Keep 3 Blank Lines on PDF)'
                : 'Sign Digitally Before Generating PDF (Optional)'}
            </button>
          </div>

          {showSigPads && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-2 border-t border-slate-800">
              <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <label className="block text-[11px] font-bold text-slate-300">
                  1. Prepared / Issued By Name
                </label>
                <input
                  type="text"
                  value={sig1Name}
                  onChange={(e) => setSig1Name(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                />
                {sig1Data ? (
                  <div className="rounded-lg border border-emerald-500/40 bg-white p-2 flex items-center justify-between gap-2">
                    <img src={sig1Data} alt="Prepared signature" className="h-10 object-contain" />
                    <button
                      type="button"
                      onClick={() => { setSig1Data(''); setSig1At(''); }}
                      className="text-[10px] font-bold text-rose-600 hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveSigSlot(1)}
                    className="w-full rounded-lg border border-dashed border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/20 py-2 text-xs font-bold text-emerald-300 transition"
                  >
                    + Capture Signature 1
                  </button>
                )}
              </div>

              <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <label className="block text-[11px] font-bold text-slate-300">
                  2. Approved By Name
                </label>
                <input
                  type="text"
                  value={sig2Name}
                  onChange={(e) => setSig2Name(e.target.value)}
                  placeholder="Manager / Supervisor"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                />
                {sig2Data ? (
                  <div className="rounded-lg border border-emerald-500/40 bg-white p-2 flex items-center justify-between gap-2">
                    <img src={sig2Data} alt="Approved signature" className="h-10 object-contain" />
                    <button
                      type="button"
                      onClick={() => { setSig2Data(''); setSig2At(''); }}
                      className="text-[10px] font-bold text-rose-600 hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveSigSlot(2)}
                    className="w-full rounded-lg border border-dashed border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/20 py-2 text-xs font-bold text-emerald-300 transition"
                  >
                    + Capture Signature 2
                  </button>
                )}
              </div>

              <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <label className="block text-[11px] font-bold text-slate-300">
                  3. Received By (Buyer) Name
                </label>
                <input
                  type="text"
                  value={sig3Name}
                  onChange={(e) => setSig3Name(e.target.value)}
                  placeholder="Driver / Buyer Name"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                />
                {sig3Data ? (
                  <div className="rounded-lg border border-emerald-500/40 bg-white p-2 flex items-center justify-between gap-2">
                    <img src={sig3Data} alt="Buyer signature" className="h-10 object-contain" />
                    <button
                      type="button"
                      onClick={() => { setSig3Data(''); setSig3At(''); }}
                      className="text-[10px] font-bold text-rose-600 hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveSigSlot(3)}
                    className="w-full rounded-lg border border-dashed border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/20 py-2 text-xs font-bold text-emerald-300 transition"
                  >
                    + Capture Signature 3
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Submit Actions */}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={resetForm}
            className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-4 py-2.5 text-xs font-bold text-slate-200 transition"
          >
            Clear Entries
          </button>
          <button
            type="submit"
            disabled={saving || calculation.totalScrapQntyKg <= 0}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-5 py-2.5 text-xs font-black text-white shadow-lg transition"
          >
            <FileText className="h-4 w-4" />
            <span>
              {saving
                ? 'Saving & Generating Invoice...'
                : 'Save Invoice & Generate 3-Signature PDF'}
            </span>
          </button>
        </div>
      </form>

      {/* Saved Scrap Sales Invoice Ledger */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-5 shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-emerald-400" />
              <span>Recycling Scrap Sales Invoice Register</span>
            </h3>
            <p className="text-xs text-slate-400">
              All saved scrap invoices synchronize live across plant devices. Re-print any 3-signature PDF invoice anytime.
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search invoice no., buyer, reg..."
              className="w-full sm:w-64 rounded-xl border border-slate-700 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950 text-slate-400 font-semibold whitespace-nowrap">
                <th className="py-2.5 px-3">Invoice No.</th>
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Buyer / Vehicle</th>
                <th className="py-2.5 px-3 text-right">Colour (kg)</th>
                <th className="py-2.5 px-3 text-right">White (kg)</th>
                <th className="py-2.5 px-3 text-right">Empty Bags (kg)</th>
                <th className="py-2.5 px-3 text-right">Total Qnty (kg)</th>
                <th className="py-2.5 px-3 text-right">Net 50% (kg)</th>
                <th className="py-2.5 px-3 text-right">Total Cost</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 tabular-nums">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td
                    colSpan={11}
                    className="py-8 text-center text-slate-500 text-xs"
                  >
                    No recycling scrap sales invoices recorded yet.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => {
                  const colour =
                    inv.items.find((i) => i.key === 'colour_scrap')?.qntyKg || 0;
                  const white =
                    inv.items.find((i) => i.key === 'white_scrap')?.qntyKg || 0;
                  const bags =
                    inv.items.find((i) => i.key === 'empty_bags')?.qntyKg || 0;
                  return (
                    <tr
                      key={inv.id}
                      className="hover:bg-slate-800/40 whitespace-nowrap transition"
                    >
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-300">
                        {inv.invoiceNo}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-300">
                        {inv.date}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-white">
                          {inv.buyerName}
                        </div>
                        {inv.vehicleReg && (
                          <div className="text-[10px] text-slate-400">
                            {inv.vehicleReg}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-300">
                        {colour.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-300">
                        {white.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-300">
                        {bags.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-white">
                        {inv.totalScrapQntyKg.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-sky-300">
                        {inv.totalNetKg.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-black text-emerald-300">
                        ${inv.totalCost.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleTogglePaid(inv)}
                          disabled={updatingId === inv.id}
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border transition ${
                            inv.status === 'PAID'
                              ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                              : 'border-amber-500/40 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                          }`}
                          title="Click to toggle ISSUED / PAID status"
                        >
                          {inv.status}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => generateScrapSalesInvoicePdf(inv)}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#0F1E36] hover:bg-[#1b345c] border border-slate-700 px-2.5 py-1 text-[11px] font-bold text-white transition"
                        >
                          <Download className="h-3 w-3" />
                          <span>PDF Invoice</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DigitalSignaturePad
        isOpen={activeSigSlot !== null}
        onClose={() => setActiveSigSlot(null)}
        initialRole={activeSigSlot === 2 ? 'supervisor' : 'technician'}
        initialName={
          activeSigSlot === 1
            ? sig1Name
            : activeSigSlot === 2
            ? sig2Name
            : sig3Name || buyerName
        }
        logTitle={
          activeSigSlot === 1
            ? `Scrap Sales Invoice ${nextInvoiceNo} — 1. Prepared / Issued By`
            : activeSigSlot === 2
            ? `Scrap Sales Invoice ${nextInvoiceNo} — 2. Approved By`
            : `Scrap Sales Invoice ${nextInvoiceNo} — 3. Received By (Buyer)`
        }
        equipmentId="Recycling Scrap Sales"
        onSaveSignature={(data) => {
          const ts = new Date().toISOString();
          if (activeSigSlot === 1) {
            setSig1Name(data.name);
            setSig1Data(data.signature);
            setSig1At(ts);
          } else if (activeSigSlot === 2) {
            setSig2Name(data.name);
            setSig2Data(data.signature);
            setSig2At(ts);
          } else if (activeSigSlot === 3) {
            setSig3Name(data.name);
            setSig3Data(data.signature);
            setSig3At(ts);
          }
          setActiveSigSlot(null);
        }}
      />
    </div>
  );
};
