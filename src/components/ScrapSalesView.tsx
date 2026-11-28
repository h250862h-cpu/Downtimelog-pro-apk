import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
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
  ShieldCheck,
  UserCheck,
  X,
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
  getScrapSalesSignatureCount,
  hasAllScrapSalesSignatures,
  isScrapSaleConfirmedForExcel,
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

function hasSig(sig?: string): boolean {
  return typeof sig === 'string' && sig.trim().length > 10;
}

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

  // 3-Signature capture on creation (or sign & confirm on saved invoice later)
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

  // Saved Invoice "Sign & Confirm Payment" modal state
  const [confirmModalInv, setConfirmModalInv] = useState<ScrapSalesInvoice | null>(null);
  const [modalSig1Name, setModalSig1Name] = useState<string>('');
  const [modalSig1Data, setModalSig1Data] = useState<string>('');
  const [modalSig1At, setModalSig1At] = useState<string>('');
  const [modalSig2Name, setModalSig2Name] = useState<string>('');
  const [modalSig2Data, setModalSig2Data] = useState<string>('');
  const [modalSig2At, setModalSig2At] = useState<string>('');
  const [modalSig3Name, setModalSig3Name] = useState<string>('');
  const [modalSig3Data, setModalSig3Data] = useState<string>('');
  const [modalSig3At, setModalSig3At] = useState<string>('');
  const [modalSigSlot, setModalSigSlot] = useState<1 | 2 | 3 | null>(null);
  const [savingConfirmModal, setSavingConfirmModal] = useState<boolean>(false);

  const [saving, setSaving] = useState<boolean>(false);
  const [exportingExcel, setExportingExcel] = useState<boolean>(false);
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

  const formSigCount = useMemo(
    () =>
      [sig1Data, sig2Data, sig3Data].filter((s) => hasSig(s)).length,
    [sig1Data, sig2Data, sig3Data]
  );
  const allFormSignaturesCaptured = formSigCount === 3;

  const modalSigCount = useMemo(
    () =>
      [modalSig1Data, modalSig2Data, modalSig3Data].filter((s) => hasSig(s)).length,
    [modalSig1Data, modalSig2Data, modalSig3Data]
  );
  const allModalSignaturesCaptured = modalSigCount === 3;

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

  const confirmedAllInvoices = useMemo(
    () => invoices.filter(isScrapSaleConfirmedForExcel),
    [invoices]
  );
  const heldAllInvoices = useMemo(
    () => invoices.filter((inv) => !isScrapSaleConfirmedForExcel(inv)),
    [invoices]
  );
  const confirmedFilteredInvoices = useMemo(
    () => filteredInvoices.filter(isScrapSaleConfirmedForExcel),
    [filteredInvoices]
  );

  const confirmedRevenueUsd = useMemo(
    () => confirmedAllInvoices.reduce((acc, inv) => acc + (Number(inv.totalCost) || 0), 0),
    [confirmedAllInvoices]
  );
  const totalBilledRevenueUsd = useMemo(
    () => invoices.reduce((acc, inv) => acc + (Number(inv.totalCost) || 0), 0),
    [invoices]
  );

  const handleQtyChange = (key: ScrapSalesCategoryKey, val: string) => {
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      setQuantities((prev) => ({ ...prev, [key]: val }));
    }
  };

  const clearFormSigSlot = (slot: 1 | 2 | 3) => {
    if (slot === 1) {
      setSig1Data('');
      setSig1At('');
    } else if (slot === 2) {
      setSig2Data('');
      setSig2At('');
    } else {
      setSig3Data('');
      setSig3At('');
    }
    if (status === 'PAID') {
      setStatus('ISSUED');
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

    if (status === 'PAID' && !allFormSignaturesCaptured) {
      setBanner({
        text: 'Payment confirmation (PAID) requires all 3 digital signatures (Prepared By, Approved By, and Buyer) before this record can enter Excel. Capture all 3 signatures or save as ISSUED first.',
        isError: true,
      });
      setShowSigPads(true);
      return;
    }

    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const nowMs = Date.now();
      const finalStatus: 'ISSUED' | 'PAID' =
        status === 'PAID' && allFormSignaturesCaptured ? 'PAID' : 'ISSUED';

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
        status: finalStatus,
        paidConfirmedAt: finalStatus === 'PAID' ? nowIso : undefined,
        paidConfirmedBy:
          finalStatus === 'PAID'
            ? currentUserName || currentUserEmail || 'Authorized Officer'
            : undefined,
        createdAt: nowIso,
        upd: nowMs,
      };

      const res = await saveScrapSalesInvoiceToFirebase(invoice);
      await generateScrapSalesInvoicePdf(invoice);
      resetForm();

      const enteredExcel = isScrapSaleConfirmedForExcel(invoice);
      setBanner({
        text: res.ok
          ? `${invoice.invoiceNo} saved (${enteredExcel ? 'PAID + 3/3 Signed — Entered into Excel' : 'Saved as ISSUED — Held from Excel until Payment & 3 Signatures confirmed'}) and PDF generated.`
          : `Saved ${invoice.invoiceNo} offline (${enteredExcel ? 'PAID + 3/3 Signed' : 'ISSUED — Held from Excel'}) & generated PDF. Cloud sync queued.`,
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

  const openSignAndConfirmModal = (inv: ScrapSalesInvoice) => {
    setConfirmModalInv(inv);
    setModalSig1Name(inv.signatures?.preparedBy?.name || inv.preparedByName || currentUserName || '');
    setModalSig1Data(inv.signatures?.preparedBy?.signature || '');
    setModalSig1At(inv.signatures?.preparedBy?.signedAt || '');

    setModalSig2Name(inv.signatures?.approvedBy?.name || '');
    setModalSig2Data(inv.signatures?.approvedBy?.signature || '');
    setModalSig2At(inv.signatures?.approvedBy?.signedAt || '');

    setModalSig3Name(inv.signatures?.buyer?.name || inv.buyerName || '');
    setModalSig3Data(inv.signatures?.buyer?.signature || '');
    setModalSig3At(inv.signatures?.buyer?.signedAt || '');
  };

  const handleSaveModalUpdates = async (targetStatus: 'ISSUED' | 'PAID') => {
    if (!confirmModalInv) return;

    if (targetStatus === 'PAID' && !allModalSignaturesCaptured) {
      setBanner({
        text: 'All 3 digital signatures (Prepared By, Approved By, and Buyer) are required before confirming payment into Excel.',
        isError: true,
      });
      return;
    }

    setSavingConfirmModal(true);
    try {
      const nowIso = new Date().toISOString();
      const updated: ScrapSalesInvoice = {
        ...confirmModalInv,
        signatures: {
          preparedBy: {
            ...EMPTY_SLOT(),
            name: modalSig1Name.trim() || confirmModalInv.preparedByName || 'Plant Operator',
            signature: modalSig1Data || undefined,
            signedAt: modalSig1Data ? modalSig1At || nowIso : '',
          },
          approvedBy: {
            ...EMPTY_SLOT(),
            name: modalSig2Name.trim(),
            signature: modalSig2Data || undefined,
            signedAt: modalSig2Data ? modalSig2At || nowIso : '',
          },
          buyer: {
            ...EMPTY_SLOT(),
            name: modalSig3Name.trim() || confirmModalInv.buyerName || '',
            signature: modalSig3Data || undefined,
            signedAt: modalSig3Data ? modalSig3At || nowIso : '',
          },
        },
        status: targetStatus === 'PAID' && allModalSignaturesCaptured ? 'PAID' : 'ISSUED',
        paidConfirmedAt:
          targetStatus === 'PAID' && allModalSignaturesCaptured
            ? confirmModalInv.paidConfirmedAt || nowIso
            : undefined,
        paidConfirmedBy:
          targetStatus === 'PAID' && allModalSignaturesCaptured
            ? currentUserName || currentUserEmail || 'Authorized Officer'
            : undefined,
        upd: Date.now(),
      };

      const res = await saveScrapSalesInvoiceToFirebase(updated);
      setConfirmModalInv(null);
      const enteredExcel = isScrapSaleConfirmedForExcel(updated);
      setBanner({
        text: enteredExcel
          ? `${updated.invoiceNo} confirmed PAID with 3/3 signatures — now unlocked in Admin Excel & TQM reports${res.ok ? '' : ' (queued offline)'}.`
          : `${updated.invoiceNo} signatures updated (${getScrapSalesSignatureCount(updated)}/3 signed, Status: ${updated.status}) — remains held from Excel until PAID with 3/3 signatures.`,
      });
    } catch (err) {
      setBanner({
        text: err instanceof Error ? err.message : 'Failed to update signatures & payment status.',
        isError: true,
      });
    } finally {
      setSavingConfirmModal(false);
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
    if (confirmedFilteredInvoices.length === 0) {
      setBanner({
        text: 'No scrap sales records eligible for Excel yet. Only invoices with BOTH confirmed payment (PAID) and all 3 signatures enter Excel.',
        isError: true,
      });
      return;
    }
    setExportingExcel(true);
    try {
      const fileName = await exportScrapSalesExcelWorkbook(
        confirmedFilteredInvoices,
        date || 'Confirmed',
        isAdmin
      );
      if (fileName) {
        setBanner({
          text: `Background Excel (.xlsx) generated for ${confirmedFilteredInvoices.length} confirmed Paid + 3-Signed invoice(s): ${fileName}`,
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
                Enter QNTY/KG for Colour Scrap, White Scrap, and Empty Bags. Records only enter Excel after Payment Confirmation (PAID) &amp; all 3 Signatures.
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
                disabled={exportingExcel || confirmedFilteredInvoices.length === 0}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3.5 py-2 text-xs font-black text-white shadow transition"
                title="Exports ONLY invoices confirmed PAID with all 3 digital signatures"
              >
                {exportingExcel ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                )}
                <span>
                  {exportingExcel
                    ? 'Generating in Background...'
                    : `Download Confirmed Excel (${confirmedFilteredInvoices.length})`}
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
              Excel-Confirmed vs Pending Invoices
            </div>
            <div className="text-2xl font-black text-white mt-0.5">
              {confirmedAllInvoices.length}{' '}
              <span className="text-xs font-semibold text-emerald-300">in Excel</span>
            </div>
            <div className="text-[11px] text-amber-300/90">
              {heldAllInvoices.length} held pending payment &amp; 3/3 signatures
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5">
            <div className="text-[11px] font-bold uppercase text-slate-400">
              Confirmed Scrap Sold (Net Billable 50%)
            </div>
            <div className="text-2xl font-black text-sky-300 mt-0.5">
              {confirmedAllInvoices
                .reduce((acc, inv) => acc + inv.totalNetKg, 0)
                .toFixed(2)}{' '}
              <span className="text-xs font-semibold text-slate-400">kg</span>
            </div>
            <div className="text-[11px] text-slate-400">
              All Invoices Gross:{' '}
              {invoices
                .reduce((acc, inv) => acc + inv.totalScrapQntyKg, 0)
                .toFixed(2)}{' '}
              kg
            </div>
          </div>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-3.5">
            <div className="text-[11px] font-bold uppercase text-emerald-300">
              Confirmed Paid + Signed Revenue (In Excel)
            </div>
            <div className="text-2xl font-black text-emerald-300 mt-0.5">
              ${confirmedRevenueUsd.toFixed(2)}
            </div>
            <div className="text-[11px] text-emerald-400/80">
              Total Issued (incl. unconfirmed): ${totalBilledRevenueUsd.toFixed(2)}
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
          {banner.isError ? (
            <AlertCircle className="h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          )}
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
              Input weights in QNTY/KG only. Records enter Excel only after PAID confirmation and all 3 signatures.
            </p>
          </div>
          <span
            className={`rounded-full border px-3 py-1 text-[11px] font-bold ${
              allFormSignaturesCaptured
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
            }`}
          >
            Signatures: {formSigCount}/3 Signed
          </span>
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
              Payment Confirmation
            </label>
            <select
              value={status}
              onChange={(e) => {
                const next = e.target.value === 'PAID' ? 'PAID' : 'ISSUED';
                if (next === 'PAID' && !allFormSignaturesCaptured) {
                  setShowSigPads(true);
                  setBanner({
                    text: 'Capture all 3 digital signatures below before marking payment as PAID for Excel.',
                    isError: true,
                  });
                  return;
                }
                setStatus(next);
              }}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="ISSUED">ISSUED (Held until Paid + 3 Signed)</option>
              <option value="PAID" disabled={!allFormSignaturesCaptured}>
                {allFormSignaturesCaptured
                  ? 'PAID (Confirmed + 3/3 Signed -> Enter Excel)'
                  : 'PAID (Locked — Needs 3/3 Signatures First)'}
              </option>
            </select>
          </div>
        </div>

        {/* Diesel-Request-Style Card Inputs (No Tables) */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {SCRAP_SALES_CATEGORIES.map((cfg) => (
              <div
                key={cfg.key}
                className="rounded-xl border border-slate-700 bg-slate-950/90 p-3.5 space-y-2"
              >
                <label className="block text-xs font-black uppercase tracking-wide text-emerald-300">
                  {cfg.name} (QNTY / KG)
                </label>
                <div className="relative">
                  <Scale className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-400" />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={quantities[cfg.key]}
                    onChange={(e) => handleQtyChange(cfg.key, e.target.value)}
                    placeholder="Enter Qnty (kg)"
                    className="w-full rounded-xl border border-emerald-500/40 bg-slate-900 pl-9 pr-3 py-2 text-sm font-black text-white tabular-nums focus:border-emerald-400 focus:outline-none"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Clean Summary Strip (No Tables — ONLY Total KG, Total Cost & Invoice Amount Due) */}
          <div className="rounded-xl border border-emerald-500/35 bg-slate-950 p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 tabular-nums">
            <div className="rounded-lg border border-slate-800 bg-slate-900/80 px-3.5 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-slate-400">TOTAL KG</span>
              <span className="text-base font-black text-white">
                {calculation.totalNetKg.toFixed(2)} kg
              </span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/80 px-3.5 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-slate-400">TOTAL COST</span>
              <span className="text-base font-black text-sky-300">
                ${calculation.totalCost.toFixed(2)}
              </span>
            </div>
            <div className="rounded-lg border border-emerald-500/50 bg-[#0F1E36] px-3.5 py-2.5 flex items-center justify-between">
              <span className="text-xs font-black uppercase text-emerald-300">
                INVOICE AMOUNT DUE
              </span>
              <span className="text-lg font-black text-emerald-300">
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

        {/* 3-Signature Pads (Required alongside PAID confirmation for Excel entry) */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
              <PenTool className="h-4 w-4 text-emerald-400" />
              <span>
                3-Signature Authorization (Required with Payment Confirmation to enter Excel)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowSigPads((prev) => !prev)}
              className="rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-[11px] font-bold text-emerald-300 transition"
            >
              {showSigPads
                ? 'Collapse Signature Pads'
                : `Open 3 Digital Signature Pads (${formSigCount}/3 Signed)`}
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
                      onClick={() => clearFormSigSlot(1)}
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
                      onClick={() => clearFormSigSlot(2)}
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
                      onClick={() => clearFormSigSlot(3)}
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] text-slate-400">
            {allFormSignaturesCaptured && status === 'PAID' ? (
              <span className="text-emerald-300 font-bold">
                Ready: 3/3 signed &amp; PAID — will enter Excel upon saving.
              </span>
            ) : (
              <span>
                Will save as <b className="text-slate-200">{status}</b> — you can complete any remaining signatures &amp; confirm payment in the register below.
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
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
              Complete all 3 digital signatures and Confirm Payment (PAID) on any invoice to unlock it into Excel reports &amp; TQM revenue.
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 tabular-nums">
          {filteredInvoices.length === 0 ? (
            <div className="md:col-span-2 rounded-xl border border-slate-800 bg-slate-950/60 py-8 text-center text-slate-500 text-xs">
              No recycling scrap sales invoices recorded yet.
            </div>
          ) : (
            filteredInvoices.map((inv) => {
              const sigCount = getScrapSalesSignatureCount(inv);
              const allSigned = hasAllScrapSalesSignatures(inv);
              const inExcel = isScrapSaleConfirmedForExcel(inv);

              return (
                <div
                  key={inv.id}
                  className={`rounded-xl border bg-slate-950/85 p-3.5 space-y-2.5 transition ${
                    inExcel
                      ? 'border-emerald-500/40 hover:border-emerald-400/60'
                      : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                    <div>
                      <span className="font-mono text-xs font-black text-emerald-300">
                        {inv.invoiceNo}
                      </span>
                      <span className="ml-2 text-[11px] font-mono text-slate-400">
                        {inv.date}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                          allSigned
                            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                            : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                        }`}
                      >
                        {sigCount}/3 Signed
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${
                          inExcel
                            ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
                            : 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                        }`}
                      >
                        {inExcel ? 'PAID · IN EXCEL' : `${inv.status} · HELD FROM EXCEL`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div>
                      <div className="font-bold text-white">{inv.buyerName}</div>
                      {inv.vehicleReg && (
                        <div className="text-[10px] text-slate-400">
                          Vehicle: {inv.vehicleReg}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-slate-400">
                        TOTAL KG:{' '}
                        <strong className="text-white">
                          {inv.totalNetKg.toFixed(2)} kg
                        </strong>
                      </div>
                      <div className="text-xs font-black text-emerald-300">
                        INVOICE AMOUNT DUE: ${inv.totalCost.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-800/60">
                    <span className="text-[10px] text-slate-400">
                      TOTAL COST: ${inv.totalCost.toFixed(2)}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openSignAndConfirmModal(inv)}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition ${
                          inExcel
                            ? 'border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300'
                            : 'border-emerald-500/50 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300'
                        }`}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        <span>{inExcel ? 'Signatures / Status' : 'Sign & Confirm Payment'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => generateScrapSalesInvoicePdf(inv)}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#0F1E36] hover:bg-[#1b345c] border border-slate-700 px-3 py-1.5 text-[11px] font-bold text-white transition"
                      >
                        <Download className="h-3 w-3" />
                        <span>PDF Invoice</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Saved Invoice: Sign & Confirm Payment Modal */}
      {confirmModalInv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden my-6">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4 bg-slate-950">
              <div>
                <h3 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span>
                    Sign &amp; Confirm Payment — {confirmModalInv.invoiceNo}
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  All 3 signatures + Payment Confirmation (PAID) are required before this record enters Excel reports.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmModalInv(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Diesel-style clean summary */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs tabular-nums">
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Buyer</div>
                  <div className="font-bold text-white truncate">{confirmModalInv.buyerName}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">TOTAL KG</div>
                  <div className="font-black text-white">{confirmModalInv.totalNetKg.toFixed(2)} kg</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">TOTAL COST</div>
                  <div className="font-black text-sky-300">${confirmModalInv.totalCost.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-emerald-300">INVOICE AMOUNT DUE</div>
                  <div className="font-black text-emerald-300">${confirmModalInv.totalCost.toFixed(2)}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Slot 1 */}
                <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                  <label className="block text-[11px] font-bold text-slate-200">
                    1. Prepared / Issued By
                  </label>
                  <input
                    type="text"
                    value={modalSig1Name}
                    onChange={(e) => setModalSig1Name(e.target.value)}
                    placeholder="Officer Name"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                  />
                  {hasSig(modalSig1Data) ? (
                    <div className="rounded-lg border border-emerald-500/40 bg-white p-2 flex items-center justify-between gap-2">
                      <img src={modalSig1Data} alt="Prepared signature" className="h-12 object-contain" />
                      <button
                        type="button"
                        onClick={() => { setModalSig1Data(''); setModalSig1At(''); }}
                        className="text-[10px] font-bold text-rose-600 hover:underline"
                      >
                        Clear
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setModalSigSlot(1)}
                      className="w-full rounded-lg border border-dashed border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/20 py-2.5 text-xs font-bold text-emerald-300 transition"
                    >
                      + Capture Signature 1
                    </button>
                  )}
                </div>

                {/* Slot 2 */}
                <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                  <label className="block text-[11px] font-bold text-slate-200">
                    2. Approved By (HOD / Admin)
                  </label>
                  <input
                    type="text"
                    value={modalSig2Name}
                    onChange={(e) => setModalSig2Name(e.target.value)}
                    placeholder="Approver Name"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                  />
                  {hasSig(modalSig2Data) ? (
                    <div className="rounded-lg border border-emerald-500/40 bg-white p-2 flex items-center justify-between gap-2">
                      <img src={modalSig2Data} alt="Approved signature" className="h-12 object-contain" />
                      <button
                        type="button"
                        onClick={() => { setModalSig2Data(''); setModalSig2At(''); }}
                        className="text-[10px] font-bold text-rose-600 hover:underline"
                      >
                        Clear
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setModalSigSlot(2)}
                      className="w-full rounded-lg border border-dashed border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/20 py-2.5 text-xs font-bold text-emerald-300 transition"
                    >
                      + Capture Signature 2
                    </button>
                  )}
                </div>

                {/* Slot 3 */}
                <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                  <label className="block text-[11px] font-bold text-slate-200">
                    3. Received By (Buyer)
                  </label>
                  <input
                    type="text"
                    value={modalSig3Name}
                    onChange={(e) => setModalSig3Name(e.target.value)}
                    placeholder="Buyer / Collector Name"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                  />
                  {hasSig(modalSig3Data) ? (
                    <div className="rounded-lg border border-emerald-500/40 bg-white p-2 flex items-center justify-between gap-2">
                      <img src={modalSig3Data} alt="Buyer signature" className="h-12 object-contain" />
                      <button
                        type="button"
                        onClick={() => { setModalSig3Data(''); setModalSig3At(''); }}
                        className="text-[10px] font-bold text-rose-600 hover:underline"
                      >
                        Clear
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setModalSigSlot(3)}
                      className="w-full rounded-lg border border-dashed border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/20 py-2.5 text-xs font-bold text-emerald-300 transition"
                    >
                      + Capture Signature 3
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-slate-300">
                  Signature Gate: <span className={allModalSignaturesCaptured ? 'text-emerald-300' : 'text-amber-300'}>{modalSigCount}/3 Signed</span>
                </span>
                <span className="text-[11px] text-slate-400">
                  {allModalSignaturesCaptured
                    ? 'All 3 signatures complete — click Confirm Payment (PAID) to enter this invoice into Excel.'
                    : 'Capture all 3 signatures to enable Payment Confirmation (PAID -> Enter Excel).'}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setConfirmModalInv(null)}
                  className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-4 py-2 text-xs font-bold text-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingConfirmModal}
                  onClick={() => handleSaveModalUpdates('ISSUED')}
                  className="rounded-xl border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 px-4 py-2 text-xs font-bold text-amber-200 transition disabled:opacity-50"
                >
                  {confirmModalInv.status === 'PAID' ? 'Save & Hold as ISSUED' : 'Save Signatures (Keep ISSUED)'}
                </button>
                <button
                  type="button"
                  disabled={savingConfirmModal || !allModalSignaturesCaptured}
                  onClick={() => handleSaveModalUpdates('PAID')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 px-4 py-2 text-xs font-black text-white shadow transition"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>
                    {savingConfirmModal
                      ? 'Confirming...'
                      : 'Confirm Payment (PAID) & Unlock for Excel'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Signature Capture Pad (Form or Saved Invoice Modal) */}
      <DigitalSignaturePad
        isOpen={activeSigSlot !== null || modalSigSlot !== null}
        onClose={() => {
          setActiveSigSlot(null);
          setModalSigSlot(null);
        }}
        initialRole={(activeSigSlot ?? modalSigSlot) === 2 ? 'supervisor' : 'technician'}
        initialName={
          modalSigSlot !== null
            ? modalSigSlot === 1
              ? modalSig1Name
              : modalSigSlot === 2
              ? modalSig2Name
              : modalSig3Name || confirmModalInv?.buyerName || ''
            : activeSigSlot === 1
            ? sig1Name
            : activeSigSlot === 2
            ? sig2Name
            : sig3Name || buyerName
        }
        logTitle={
          modalSigSlot !== null && confirmModalInv
            ? modalSigSlot === 1
              ? `Scrap Sales Invoice ${confirmModalInv.invoiceNo} — 1. Prepared / Issued By`
              : modalSigSlot === 2
              ? `Scrap Sales Invoice ${confirmModalInv.invoiceNo} — 2. Approved By`
              : `Scrap Sales Invoice ${confirmModalInv.invoiceNo} — 3. Received By (Buyer)`
            : activeSigSlot === 1
            ? `Scrap Sales Invoice ${nextInvoiceNo} — 1. Prepared / Issued By`
            : activeSigSlot === 2
            ? `Scrap Sales Invoice ${nextInvoiceNo} — 2. Approved By`
            : `Scrap Sales Invoice ${nextInvoiceNo} — 3. Received By (Buyer)`
        }
        equipmentId="Recycling Scrap Sales"
        onSaveSignature={(data) => {
          const ts = new Date().toISOString();
          if (modalSigSlot !== null) {
            if (modalSigSlot === 1) {
              setModalSig1Name(data.name);
              setModalSig1Data(data.signature);
              setModalSig1At(ts);
            } else if (modalSigSlot === 2) {
              setModalSig2Name(data.name);
              setModalSig2Data(data.signature);
              setModalSig2At(ts);
            } else if (modalSigSlot === 3) {
              setModalSig3Name(data.name);
              setModalSig3Data(data.signature);
              setModalSig3At(ts);
            }
            setModalSigSlot(null);
            return;
          }

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
