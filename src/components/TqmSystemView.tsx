import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  Link2,
  Lock,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react';
import {
  DieselFuelRequest,
  DieselGrnRecord,
  DieselTankConfig,
  DispatchEntry,
  DowntimeEntry,
  GeneratorLog,
  PowerCutLog,
  ProductionPlanItem,
  QualityTrialReport,
  ScrapSalesInvoice,
  SopMixingReport,
  SopProductionRecord,
  SopQcRecord,
  SopScrapRecord,
  SopShiftHandoverRecord,
  SpecialOrder,
  SpecialOrderFactoryProduction,
  SpecialOrderWhDispatch,
  TqmCapaRecord,
  TqmCapaSeverity,
  TqmCapaStatus,
  TqmIshikawaCategory,
  TqmLinkedEntityRef,
  UserPermissions,
} from '../types';
import { ParsedAttendanceMessage, QCInspectionRecord } from '../types/attendance';
import { ymd } from '../services/downtimeCalc';
import {
  buildUnifiedTqmAnalytics,
  exportTqmCapasCsv,
  exportTqmMachinesCsv,
  exportTqmMasterExcelWorkbook,
  exportTqmProductsCsv,
  exportTqmSignalsCsv,
  generateNextTqmCapaNo,
  saveTqmCapaToFirebase,
  TqmDetectedSignal,
} from '../services/tqmStore';
import {
  generateTqmCapaPdf,
  generateTqmCapaRegisterPdf,
  generateTqmExecutivePdf,
  generateTqmMachineMatrixPdf,
  generateTqmProductTracePdf,
  generateTqmShiftAndLoopPdf,
} from '../services/tqmPdf';
import { DigitalSignaturePad } from './DigitalSignaturePad';
import { LgplastLogo } from './LgplastLogo';

export interface TqmSystemViewProps {
  machines: string[];
  downtimeEntries: DowntimeEntry[];
  dispatches: DispatchEntry[];
  monthlyPlans: ProductionPlanItem[];
  specialOrders: SpecialOrder[];
  specialOrderProductions: SpecialOrderFactoryProduction[];
  specialOrderWhDispatches: SpecialOrderWhDispatch[];
  qualityTrials: QualityTrialReport[];
  sopProductionLogs: SopProductionRecord[];
  sopQcChecks: SopQcRecord[];
  sopScrapPipeline: SopScrapRecord[];
  sopMixingReports: SopMixingReport[];
  sopHandovers: SopShiftHandoverRecord[];
  scrapSalesInvoices: ScrapSalesInvoice[];
  dieselRequests: DieselFuelRequest[];
  dieselGrns: DieselGrnRecord[];
  dieselTank: DieselTankConfig;
  powerCutLogs: PowerCutLog[];
  generatorLogs: GeneratorLog[];
  attendanceBatch: ParsedAttendanceMessage[];
  qcLogs: QCInspectionRecord[];
  tqmCapas: TqmCapaRecord[];
  permissions: UserPermissions;
  isAdmin: boolean;
  currentUserName: string;
  currentUserEmail: string;
}

type TqmSubTab = 'executive' | 'machines' | 'products' | 'loop_shifts' | 'capa' | 'reports';

const ISHIKAWA_CATEGORIES: TqmIshikawaCategory[] = [
  'Machine',
  'Material',
  'Method',
  'Man',
  'Measurement',
  'Environment',
];

export const TqmSystemView: React.FC<TqmSystemViewProps> = ({
  machines,
  downtimeEntries,
  dispatches,
  monthlyPlans,
  specialOrders,
  specialOrderProductions,
  specialOrderWhDispatches,
  qualityTrials,
  sopProductionLogs,
  sopQcChecks,
  sopScrapPipeline,
  sopMixingReports,
  sopHandovers,
  scrapSalesInvoices,
  dieselRequests,
  dieselGrns,
  dieselTank,
  powerCutLogs,
  generatorLogs,
  attendanceBatch,
  qcLogs,
  tqmCapas,
  permissions,
  isAdmin,
  currentUserName,
  currentUserEmail,
}) => {
  const todayStr = ymd(new Date());
  const firstOfMonth = `${todayStr.slice(0, 7)}-01`;

  const [subTab, setSubTab] = useState<TqmSubTab>('executive');
  const [fromDate, setFromDate] = useState<string>(firstOfMonth);
  const [toDate, setToDate] = useState<string>(todayStr);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [signalSeverityFilter, setSignalSeverityFilter] = useState<string>('ALL');
  const [signalStateFilter, setSignalStateFilter] = useState<'ALL' | 'UNLINKED' | 'LINKED'>('ALL');
  const [capaStatusFilter, setCapaStatusFilter] = useState<'ALL' | TqmCapaStatus>('ALL');
  const [selectedMachineDetail, setSelectedMachineDetail] = useState<string>('');
  const [reportMachineScope, setReportMachineScope] = useState<string>('');
  const [showReportPreview, setShowReportPreview] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<{ text: string; isError?: boolean } | null>(null);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState<string | null>(null);

  // CAPA Drawer / Modal Form State
  const [showCapaModal, setShowCapaModal] = useState(false);
  const [editingCapaId, setEditingCapaId] = useState<string | null>(null);
  const [capaNo, setCapaNo] = useState<string>('');
  const [capaDate, setCapaDate] = useState<string>(todayStr);
  const [capaShift, setCapaShift] = useState<'Day' | 'Night'>('Day');
  const [capaTitle, setCapaTitle] = useState<string>('');
  const [capaSignalKey, setCapaSignalKey] = useState<string>('');
  const [capaMachine, setCapaMachine] = useState<string>(machines[0] || 'Extrusion Machine 1');
  const [capaProduct, setCapaProduct] = useState<string>('');
  const [capaCategory, setCapaCategory] = useState<TqmIshikawaCategory>('Machine');
  const [capaSeverity, setCapaSeverity] = useState<TqmCapaSeverity>('HIGH');
  const [capaStatus, setCapaStatus] = useState<TqmCapaStatus>('OPEN');
  const [capaProblem, setCapaProblem] = useState<string>('');
  const [capaRootCause, setCapaRootCause] = useState<string>('');
  const [capaContainment, setCapaContainment] = useState<string>('');
  const [capaCorrective, setCapaCorrective] = useState<string>('');
  const [capaPreventive, setCapaPreventive] = useState<string>('');
  const [capaCopqUsd, setCapaCopqUsd] = useState<string>('0');
  const [capaScrapKg, setCapaScrapKg] = useState<string>('0');
  const [capaDowntimeMins, setCapaDowntimeMins] = useState<string>('0');
  const [capaOwner, setCapaOwner] = useState<string>(currentUserName || '');
  const [capaDueDate, setCapaDueDate] = useState<string>(todayStr);
  const [capaLinkedRefs, setCapaLinkedRefs] = useState<TqmLinkedEntityRef[]>([]);
  const [capaAddRefKey, setCapaAddRefKey] = useState<string>('');
  const [capaRaisedSig, setCapaRaisedSig] = useState<string>('');
  const [capaVerifiedBy, setCapaVerifiedBy] = useState<string>('');
  const [capaVerifiedSig, setCapaVerifiedSig] = useState<string>('');
  const [capaVerifiedNotes, setCapaVerifiedNotes] = useState<string>('');
  const [savingCapa, setSavingCapa] = useState(false);

  const [sigTarget, setSigTarget] = useState<null | 'raised' | 'verified'>(null);

  const canHodVerify = isAdmin || Boolean(permissions.dispatchHODConfirm);

  const showNotice = (text: string, isError = false) => {
    setStatusNotice({ text, isError });
    setTimeout(() => setStatusNotice(null), 5000);
  };

  const applyDatePreset = (preset: 'today' | '7days' | 'month' | 'all') => {
    const n = new Date();
    if (preset === 'today') {
      const s = ymd(n);
      setFromDate(s);
      setToDate(s);
    } else if (preset === '7days') {
      const f = new Date(n);
      f.setDate(n.getDate() - 6);
      setFromDate(ymd(f));
      setToDate(ymd(n));
    } else if (preset === 'month') {
      setFromDate(`${ymd(n).slice(0, 7)}-01`);
      setToDate(ymd(n));
    } else {
      setFromDate('2025-01-01');
      setToDate(ymd(n));
    }
  };

  // Master Unified TQM Snapshot across ALL plant modules
  const analytics = useMemo(
    () =>
      buildUnifiedTqmAnalytics({
        fromDate,
        toDate,
        machines,
        downtimeEntries,
        dispatches,
        monthlyPlans,
        specialOrders,
        specialOrderProductions,
        specialOrderWhDispatches,
        qualityTrials,
        sopProductionLogs,
        sopQcChecks,
        sopScrapPipeline,
        sopMixingReports,
        sopHandovers,
        scrapSalesInvoices,
        dieselRequests,
        dieselGrns,
        dieselTank,
        powerCutLogs,
        generatorLogs,
        attendanceBatch,
        qcLogs,
        tqmCapas,
      }),
    [
      fromDate,
      toDate,
      machines,
      downtimeEntries,
      dispatches,
      monthlyPlans,
      specialOrders,
      specialOrderProductions,
      specialOrderWhDispatches,
      qualityTrials,
      sopProductionLogs,
      sopQcChecks,
      sopScrapPipeline,
      sopMixingReports,
      sopHandovers,
      scrapSalesInvoices,
      dieselRequests,
      dieselGrns,
      dieselTank,
      powerCutLogs,
      generatorLogs,
      attendanceBatch,
      qcLogs,
      tqmCapas,
    ]
  );

  // Filtered views
  const filteredSignals = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return analytics.detectedSignals.filter((s) => {
      if (signalSeverityFilter !== 'ALL' && s.severity !== signalSeverityFilter) return false;
      if (signalStateFilter === 'UNLINKED' && s.linkedCapa) return false;
      if (signalStateFilter === 'LINKED' && !s.linkedCapa) return false;
      if (
        q &&
        !`${s.title} ${s.machine} ${s.product} ${s.summary}`.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [analytics.detectedSignals, searchQuery, signalSeverityFilter, signalStateFilter]);

  const filteredMachines = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return analytics.machineProfiles
      .filter((m) => !q || m.machine.toLowerCase().includes(q))
      .sort((a, b) => a.qualityIndex - b.qualityIndex);
  }, [analytics.machineProfiles, searchQuery]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return analytics.productProfiles.filter(
      (p) =>
        !q ||
        p.product.toLowerCase().includes(q) ||
        p.primaryMachine.toLowerCase().includes(q)
    );
  }, [analytics.productProfiles, searchQuery]);

  const filteredCapas = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tqmCapas.filter((c) => {
      if (capaStatusFilter !== 'ALL' && c.status !== capaStatusFilter) return false;
      if (
        q &&
        !`${c.capaNo} ${c.title} ${c.machine} ${c.product} ${c.ownerName}`.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [tqmCapas, capaStatusFilter, searchQuery]);

  const activeMachineDrilldown = useMemo(() => {
    if (!selectedMachineDetail) return null;
    const profile = analytics.machineProfiles.find((m) => m.machine === selectedMachineDetail);
    const machineSignals = analytics.detectedSignals.filter(
      (s) => s.machine === selectedMachineDetail
    );
    const machineCapas = tqmCapas.filter((c) => c.machine === selectedMachineDetail);
    return { profile, machineSignals, machineCapas };
  }, [selectedMachineDetail, analytics, tqmCapas]);

  const openBlankCapaModal = () => {
    setEditingCapaId(null);
    setCapaNo(generateNextTqmCapaNo(tqmCapas, todayStr));
    setCapaDate(todayStr);
    setCapaShift('Day');
    setCapaTitle('');
    setCapaSignalKey('');
    setCapaMachine(machines[0] || 'Extrusion Machine 1');
    setCapaProduct('');
    setCapaCategory('Machine');
    setCapaSeverity('MEDIUM');
    setCapaStatus('OPEN');
    setCapaProblem('');
    setCapaRootCause('');
    setCapaContainment('');
    setCapaCorrective('');
    setCapaPreventive('');
    setCapaCopqUsd('0');
    setCapaScrapKg('0');
    setCapaDowntimeMins('0');
    setCapaOwner(currentUserName || '');
    setCapaDueDate(todayStr);
    setCapaLinkedRefs([]);
    setCapaRaisedSig('');
    setCapaVerifiedBy('');
    setCapaVerifiedSig('');
    setCapaVerifiedNotes('');
    setShowCapaModal(true);
  };

  const openCapaFromSignal = (sig: TqmDetectedSignal) => {
    if (sig.linkedCapa) {
      openEditCapaModal(sig.linkedCapa);
      return;
    }
    setEditingCapaId(null);
    setCapaNo(generateNextTqmCapaNo(tqmCapas, sig.date || todayStr));
    setCapaDate(sig.date || todayStr);
    setCapaShift(sig.shift);
    setCapaTitle(sig.title);
    setCapaSignalKey(sig.signalKey);
    setCapaMachine(sig.machine);
    setCapaProduct(sig.product);
    setCapaCategory(sig.ishikawaCategory);
    setCapaSeverity(sig.severity);
    setCapaStatus('OPEN');
    setCapaProblem(sig.summary);
    setCapaRootCause(sig.suggestedRootCause);
    setCapaContainment('');
    setCapaCorrective('');
    setCapaPreventive('');
    setCapaCopqUsd(String(sig.estimatedCopqUsd || 0));
    setCapaScrapKg(String(sig.scrapImpactKg || 0));
    setCapaDowntimeMins(String(sig.downtimeImpactMins || 0));
    setCapaOwner(currentUserName || '');
    setCapaDueDate(todayStr);
    setCapaLinkedRefs(sig.linkedRefs);
    setCapaRaisedSig('');
    setCapaVerifiedBy('');
    setCapaVerifiedSig('');
    setCapaVerifiedNotes('');
    setShowCapaModal(true);
  };

  const openEditCapaModal = (c: TqmCapaRecord) => {
    setEditingCapaId(c.id);
    setCapaNo(c.capaNo);
    setCapaDate(c.date);
    setCapaShift(c.shift);
    setCapaTitle(c.title);
    setCapaSignalKey(c.sourceSignalKey || '');
    setCapaMachine(c.machine);
    setCapaProduct(c.product);
    setCapaCategory(c.ishikawaCategory);
    setCapaSeverity(c.severity);
    setCapaStatus(c.status);
    setCapaProblem(c.problemStatement);
    setCapaRootCause(c.rootCause5Why);
    setCapaContainment(c.containmentAction);
    setCapaCorrective(c.correctiveAction);
    setCapaPreventive(c.preventiveAction);
    setCapaCopqUsd(String(c.estimatedCopqUsd || 0));
    setCapaScrapKg(String(c.scrapImpactKg || 0));
    setCapaDowntimeMins(String(c.downtimeImpactMins || 0));
    setCapaOwner(c.ownerName);
    setCapaDueDate(c.targetDueDate);
    setCapaLinkedRefs(c.linkedRefs || []);
    setCapaRaisedSig(c.raisedSignature || '');
    setCapaVerifiedBy(c.verifiedByHodName || '');
    setCapaVerifiedSig(c.verifiedSignature || '');
    setCapaVerifiedNotes(c.verificationNotes || '');
    setShowCapaModal(true);
  };

  const handleSaveCapa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!capaTitle.trim() || !capaProblem.trim()) {
      showNotice('CAPA Title and Problem Statement are required.', true);
      return;
    }
    if (capaStatus === 'VERIFIED_CLOSED' && !canHodVerify) {
      showNotice('Only Admin / Production HOD can verify and close a CAPA.', true);
      return;
    }

    setSavingCapa(true);
    try {
      const existing = editingCapaId ? tqmCapas.find((x) => x.id === editingCapaId) : undefined;
      const nowIso = new Date().toISOString();
      const record: TqmCapaRecord = {
        id: existing?.id || `capa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        capaNo: capaNo.trim() || generateNextTqmCapaNo(tqmCapas, capaDate),
        date: capaDate,
        shift: capaShift,
        title: capaTitle.trim(),
        sourceSignalKey: capaSignalKey || existing?.sourceSignalKey,
        machine: capaMachine,
        product: capaProduct.trim() || 'General Production',
        ishikawaCategory: capaCategory,
        severity: capaSeverity,
        status: capaStatus,
        problemStatement: capaProblem.trim(),
        rootCause5Why: capaRootCause.trim(),
        containmentAction: capaContainment.trim(),
        correctiveAction: capaCorrective.trim(),
        preventiveAction: capaPreventive.trim(),
        estimatedCopqUsd: Number(capaCopqUsd) || 0,
        scrapImpactKg: Number(capaScrapKg) || 0,
        downtimeImpactMins: Number(capaDowntimeMins) || 0,
        linkedRefs: capaLinkedRefs,
        ownerName: capaOwner.trim() || currentUserName,
        targetDueDate: capaDueDate,
        raisedByName: existing?.raisedByName || currentUserName,
        raisedByEmail: existing?.raisedByEmail || currentUserEmail,
        raisedSignature: capaRaisedSig || existing?.raisedSignature || '',
        raisedAt: existing?.raisedAt || nowIso,
        verifiedByHodName:
          capaStatus === 'VERIFIED_CLOSED'
            ? capaVerifiedBy || currentUserName
            : capaVerifiedBy || existing?.verifiedByHodName,
        verifiedSignature: capaVerifiedSig || existing?.verifiedSignature,
        verifiedAt:
          capaStatus === 'VERIFIED_CLOSED'
            ? existing?.verifiedAt || nowIso
            : existing?.verifiedAt,
        verificationNotes: capaVerifiedNotes.trim(),
        upd: Date.now(),
      };

      const res = await saveTqmCapaToFirebase(record);
      setShowCapaModal(false);
      showNotice(
        res.ok
          ? `Saved ${record.capaNo} (${record.linkedRefs.length} linked plant records) to cloud.`
          : `Saved ${record.capaNo} locally (queued for sync).`
      );
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Failed to save CAPA record.', true);
    } finally {
      setSavingCapa(false);
    }
  };

  const handleDownloadAdminExcel = async () => {
    if (!isAdmin) return;
    setExportingExcel(true);
    showNotice('Compiling Multi-Sheet TQM Audit Excel (.xlsx) in background...');
    try {
      await exportTqmMasterExcelWorkbook(analytics, tqmCapas, true);
      showNotice(`Downloaded TQM Audit Excel (${analytics.periodLabel}).`);
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'Failed to compile TQM Excel report.',
        true
      );
    } finally {
      setExportingExcel(false);
    }
  };

  const handleRunPdfReport = async (
    reportKey: 'executive' | 'machines' | 'products' | 'loop_shifts' | 'capa_register',
    focusMachine?: string
  ) => {
    setGeneratingPdf(reportKey);
    try {
      if (reportKey === 'executive') {
        await generateTqmExecutivePdf(analytics, tqmCapas, currentUserName);
        showNotice(`Downloaded Full TQM Executive Audit PDF (${analytics.periodLabel}).`);
      } else if (reportKey === 'machines') {
        await generateTqmMachineMatrixPdf(analytics, currentUserName, focusMachine);
        showNotice(
          focusMachine
            ? `Downloaded TQM Machine Audit PDF for ${focusMachine}.`
            : `Downloaded Machine 360 Reliability PDF (${analytics.periodLabel}).`
        );
      } else if (reportKey === 'products') {
        await generateTqmProductTracePdf(analytics, currentUserName);
        showNotice(`Downloaded Product & Dispatch Traceability PDF (${analytics.periodLabel}).`);
      } else if (reportKey === 'loop_shifts') {
        await generateTqmShiftAndLoopPdf(analytics, currentUserName);
        showNotice(`Downloaded Shift & Closed-Loop Scrap/Utilities PDF (${analytics.periodLabel}).`);
      } else if (reportKey === 'capa_register') {
        await generateTqmCapaRegisterPdf(analytics, tqmCapas, currentUserName);
        showNotice(`Downloaded Linked NCR & CAPA Register PDF (${tqmCapas.length} records).`);
      }
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'Failed to generate TQM PDF report.',
        true
      );
    } finally {
      setGeneratingPdf(null);
    }
  };

  const handleDownloadSingleCapaPdf = async (capa: TqmCapaRecord) => {
    setGeneratingPdf(capa.id);
    try {
      await generateTqmCapaPdf(capa);
      showNotice(`Downloaded CAPA Certificate PDF (${capa.capaNo}).`);
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : `Failed to generate PDF for ${capa.capaNo}.`,
        true
      );
    } finally {
      setGeneratingPdf(null);
    }
  };

  const handleRunCsvReport = (csvType: 'machines' | 'products' | 'capa' | 'signals') => {
    try {
      let file = '';
      if (csvType === 'machines') file = exportTqmMachinesCsv(analytics);
      else if (csvType === 'products') file = exportTqmProductsCsv(analytics);
      else if (csvType === 'capa')
        file = exportTqmCapasCsv(tqmCapas, analytics.fromDate, analytics.toDate);
      else file = exportTqmSignalsCsv(analytics);
      showNotice(`Downloaded ${file}.`);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Failed to export CSV report.', true);
    }
  };

  const getSeverityTextStyle = (sev: TqmCapaSeverity) => {
    if (sev === 'CRITICAL') return 'text-rose-700 bg-rose-50 border-rose-200';
    if (sev === 'HIGH') return 'text-amber-800 bg-amber-50 border-amber-200';
    if (sev === 'MEDIUM') return 'text-sky-800 bg-sky-50 border-sky-200';
    return 'text-slate-700 bg-slate-100 border-slate-200';
  };

  const getStatusTextStyle = (st: TqmCapaStatus) => {
    if (st === 'VERIFIED_CLOSED') return 'text-emerald-800 bg-emerald-50 border-emerald-200';
    if (st === 'IN_PROGRESS') return 'text-sky-800 bg-sky-50 border-sky-200';
    return 'text-rose-800 bg-rose-50 border-rose-200';
  };

  return (
    <div className="space-y-4">
      {/* Top Corporate TQM Header & Controls */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <LgplastLogo size="sm" showSubtitle={false} />
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                ISO 9001 · Cross-Module Quality Command Center
              </div>
              <h2 className="text-base sm:text-lg font-bold text-[#0F1E36]">
                Total Quality Management (TQM) Linked System
              </h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openBlankCapaModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Raise Linked CAPA</span>
            </button>

            <button
              type="button"
              onClick={() => setShowReportPreview(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0 transition"
            >
              <Eye className="h-3.5 w-3.5 text-[#0F1E36]" />
              <span>Preview &amp; Print</span>
            </button>

            <button
              type="button"
              disabled={generatingPdf !== null}
              onClick={() => handleRunPdfReport('executive')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0 transition disabled:opacity-50"
            >
              <FileText className="h-3.5 w-3.5 text-[#0F1E36]" />
              <span>{generatingPdf === 'executive' ? 'Preparing PDF...' : 'TQM Audit PDF'}</span>
            </button>

            {isAdmin ? (
              <button
                type="button"
                disabled={exportingExcel}
                onClick={handleDownloadAdminExcel}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition disabled:opacity-50"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span>{exportingExcel ? 'Compiling Excel...' : 'Admin TQM Excel (.xlsx)'}</span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-medium text-slate-500 whitespace-nowrap shrink-0">
                <Lock className="h-3.5 w-3.5" />
                <span>Excel: Admin Only</span>
              </span>
            )}
          </div>
        </div>

        {/* Date Filter & Unified Sub-Tab Bar */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5 font-medium text-slate-600">
              <Filter className="h-3.5 w-3.5" />
              <span>Audit Window:</span>
            </div>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 tabular-nums"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 tabular-nums"
            />
            <div className="flex items-center gap-1">
              {(
                [
                  ['today', 'Today'],
                  ['7days', '7 Days'],
                  ['month', 'This Month'],
                  ['all', 'All Data'],
                ] as const
              ).map(([preset, label]) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applyDatePreset(preset)}
                  className="rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700 whitespace-nowrap shrink-0"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative w-full xl:w-72">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter machines, products, CAPAs..."
              className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* Segmented Sub-Tab Navigation */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-1 border-t border-slate-100">
          {(
            [
              ['executive', `Executive & COPQ (${analytics.detectedSignals.filter((s) => !s.linkedCapa).length} alerts)`],
              ['machines', `Machine 360° (${analytics.machineProfiles.length})`],
              ['products', `Product & Dispatch Trace (${analytics.productProfiles.length})`],
              ['loop_shifts', 'Shifts, Staff & Scrap Loop'],
              ['capa', `NCR / CAPA Register (${tqmCapas.length})`],
              ['reports', 'Reports & Audits'],
            ] as [TqmSubTab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition ${
                subTab === id
                  ? 'bg-[#0F1E36] text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {statusNotice && (
        <div
          className={`rounded-lg border px-4 py-2.5 text-xs font-semibold flex items-center justify-between ${
            statusNotice.isError
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          <span>{statusNotice.text}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-slate-500 hover:text-slate-800"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 1: EXECUTIVE SCORECARD, COPQ & AUTO-LINKED QUALITY SIGNALS */}
      {/* ============================================================ */}
      {subTab === 'executive' && (
        <div className="space-y-4">
          {/* Flat 6-Column TQM Scorecard Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 border border-slate-200 bg-white rounded-xl overflow-hidden divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
            <div className="p-3.5 space-y-1">
              <div className="text-[11px] font-medium text-slate-500">Plant TQM Index</div>
              <div
                className={`text-xl font-bold tabular-nums ${
                  analytics.overallTqmIndex >= 85
                    ? 'text-emerald-700'
                    : analytics.overallTqmIndex >= 70
                    ? 'text-amber-700'
                    : 'text-rose-700'
                }`}
              >
                {analytics.overallTqmIndex}%
              </div>
              <div className="text-[10px] text-slate-500">Weighted 5-pillar score</div>
            </div>

            <div className="p-3.5 space-y-1">
              <div className="text-[11px] font-medium text-slate-500">First-Pass Yield</div>
              <div className="text-xl font-bold text-[#0F1E36] tabular-nums">
                {analytics.firstPassYieldPct}%
              </div>
              <div className="text-[10px] text-slate-500 tabular-nums">
                {analytics.totalQcInspections} checks · {analytics.totalQcFailHold} fail/hold
              </div>
            </div>

            <div className="p-3.5 space-y-1">
              <div className="text-[11px] font-medium text-slate-500">Availability</div>
              <div className="text-xl font-bold text-[#0F1E36] tabular-nums">
                {analytics.machineAvailabilityPct}%
              </div>
              <div className="text-[10px] text-slate-500 tabular-nums">
                {analytics.powerCutCount} power cuts · {analytics.powerCutHours}h
              </div>
            </div>

            <div className="p-3.5 space-y-1">
              <div className="text-[11px] font-medium text-slate-500">Scrap Recovery</div>
              <div className="text-xl font-bold text-emerald-700 tabular-nums">
                {analytics.closedLoopRecoveryPct}%
              </div>
              <div className="text-[10px] text-slate-500 tabular-nums">
                {analytics.usableRegrindProducedKg} kg regrind
              </div>
            </div>

            <div className="p-3.5 space-y-1">
              <div className="text-[11px] font-medium text-slate-500">Plan Attainment</div>
              <div className="text-xl font-bold text-[#0F1E36] tabular-nums">
                {analytics.planAttainmentPct}%
              </div>
              <div className="text-[10px] text-slate-500 tabular-nums">
                {analytics.totalWhVariances} WH variances
              </div>
            </div>

            <div className="p-3.5 space-y-1">
              <div className="text-[11px] font-medium text-slate-500">Open / Active CAPAs</div>
              <div className="text-xl font-bold text-rose-700 tabular-nums">
                {analytics.openCapaCount + analytics.inProgressCapaCount}
              </div>
              <div className="text-[10px] text-slate-500 tabular-nums">
                {analytics.closedCapaCount} closed ({analytics.capaClosureRatePct}%)
              </div>
            </div>
          </div>

          {/* Cost of Poor Quality (COPQ) + Ishikawa 6M Summary Row */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#0F1E36]">
                  Cost of Poor Quality (COPQ) &amp; Closed-Loop Recovery
                </h3>
                <span className="text-xs font-bold text-rose-700 tabular-nums">
                  Net COPQ: ${analytics.copqNetAfterRecoveryUsd.toFixed(2)}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] font-semibold text-slate-500">
                      <th className="py-1.5 pr-3">Cost / Recovery Driver</th>
                      <th className="py-1.5 pr-3">Linked Plant Basis</th>
                      <th className="py-1.5 text-right">Amount ($ USD)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    <tr>
                      <td className="py-2 pr-3 font-medium text-slate-800">
                        Production Scrap, Wastage &amp; Sweepings
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {(analytics.totalSopScrapKg + analytics.totalWastageKg + analytics.mixerSweepingKg).toFixed(1)} kg @ $1.25/kg
                      </td>
                      <td className="py-2 text-right font-semibold text-rose-700">
                        ${analytics.copqScrapLossUsd.toFixed(2)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 font-medium text-slate-800">
                        Unplanned Breakdown Stoppages
                      </td>
                      <td className="py-2 pr-3 text-slate-600">Downtime entries @ $28/hr benchmark</td>
                      <td className="py-2 text-right font-semibold text-rose-700">
                        ${analytics.copqDowntimeLossUsd.toFixed(2)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 font-medium text-slate-800">
                        QC Rejects, Holds &amp; WH Dispatch Variances
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {analytics.totalQcFailHold} QC fails + {analytics.totalWhVariances} WH variances
                      </td>
                      <td className="py-2 text-right font-semibold text-rose-700">
                        ${analytics.copqQualityHoldLossUsd.toFixed(2)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 font-medium text-emerald-800">
                        Offset: Internal Regrind + Sold Scrap Revenue
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {analytics.usableRegrindProducedKg} kg regrind + ${analytics.scrapSalesRevenueUsd.toFixed(2)} confirmed paid &amp; 3-signed invoices
                      </td>
                      <td className="py-2 text-right font-semibold text-emerald-700">
                        -${(analytics.usableRegrindProducedKg * 0.65 + analytics.scrapSalesRevenueUsd).toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#0F1E36]">
                  Ishikawa 6M Root Cause Distribution
                </h3>
                <span className="text-[11px] text-slate-500">CAPAs + Live Alerts</span>
              </div>
              <div className="space-y-2">
                {ISHIKAWA_CATEGORIES.map((cat) => {
                  const cnt = analytics.ishikawaCounts[cat] || 0;
                  const maxCnt = Math.max(
                    1,
                    ...ISHIKAWA_CATEGORIES.map((c) => analytics.ishikawaCounts[c] || 0)
                  );
                  const barW = Math.round((cnt / maxCnt) * 100);
                  return (
                    <div key={cat} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-700">{cat}</span>
                        <span className="font-semibold text-slate-900 tabular-nums">{cnt}</span>
                      </div>
                      <div className="h-2 w-full rounded bg-slate-100 overflow-hidden">
                        <div
                          className="h-full bg-[#0F1E36] transition-all"
                          style={{ width: `${barW}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Live Cross-Module Signal Feed */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#0F1E36] flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span>Auto-Detected Cross-Module Quality Signals ({filteredSignals.length})</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Real-time anomalies linked from QC Lots, SOP Floor QC, Quality Trials, High Scrap Shifts, Breakdowns, Power Cuts, and WH Dispatch Variances.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select
                  value={signalSeverityFilter}
                  onChange={(e) => setSignalSeverityFilter(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
                >
                  <option value="ALL">All Severities</option>
                  <option value="CRITICAL">Critical</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                </select>
                <select
                  value={signalStateFilter}
                  onChange={(e) =>
                    setSignalStateFilter(e.target.value as 'ALL' | 'UNLINKED' | 'LINKED')
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="UNLINKED">Needs CAPA</option>
                  <option value="LINKED">Linked to CAPA</option>
                </select>
              </div>
            </div>

            {filteredSignals.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 space-y-2">
                <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
                <div>No unaddressed cross-module quality alerts match the current filter.</div>
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {filteredSignals.map((sig) => (
                  <div
                    key={sig.signalKey}
                    className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${getSeverityTextStyle(
                            sig.severity
                          )}`}
                        >
                          {sig.severity}
                        </span>
                        <span className="text-xs font-bold text-slate-900">{sig.title}</span>
                        <span className="text-[11px] font-medium text-slate-500 tabular-nums">
                          {sig.date} · {sig.shift} · 6M: {sig.ishikawaCategory}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600">{sig.summary}</p>
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 tabular-nums">
                        <span>Machine: {sig.machine}</span>
                        <span>Product: {sig.product}</span>
                        <span className="text-rose-700 font-medium">
                          Est. COPQ: ${sig.estimatedCopqUsd.toFixed(2)}
                        </span>
                        {sig.linkedRefs[0] && (
                          <span className="inline-flex items-center gap-1 text-[#0F1E36] font-medium">
                            <Link2 className="h-3 w-3" />
                            {sig.linkedRefs[0].module}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      {sig.linkedCapa ? (
                        <button
                          type="button"
                          onClick={() => openEditCapaModal(sig.linkedCapa!)}
                          className="rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-800 whitespace-nowrap shrink-0"
                        >
                          CAPA {sig.linkedCapa.capaNo} ({sig.linkedCapa.status.replace(/_/g, ' ')})
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openCapaFromSignal(sig)}
                          className="rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition"
                        >
                          Raise Linked CAPA
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 2: MACHINE & UTILITIES 360 MATRIX                        */}
      {/* ============================================================ */}
      {subTab === 'machines' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <div>
                <h3 className="text-sm font-bold text-[#0F1E36]">
                  Machine 360° Linked Quality &amp; Reliability Matrix
                </h3>
                <p className="text-xs text-slate-500">
                  Sorted lowest Quality Index first. Click any machine row to inspect linked alerts and CAPAs.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={generatingPdf !== null}
                  onClick={() => handleRunPdfReport('machines')}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  <FileText className="h-3.5 w-3.5 text-[#0F1E36]" />
                  <span>{generatingPdf === 'machines' ? 'Preparing...' : 'Machine 360 PDF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRunCsvReport('machines')}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5 text-slate-700" />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-semibold text-slate-500">
                    <th className="py-2 pr-3">Machine</th>
                    <th className="py-2 px-2 text-right">TQM Index</th>
                    <th className="py-2 px-2 text-right">Avail %</th>
                    <th className="py-2 px-2 text-right">BD Hrs</th>
                    <th className="py-2 px-2 text-right">Power Link</th>
                    <th className="py-2 px-2 text-right">Prod (kg)</th>
                    <th className="py-2 px-2 text-right">Scrap+Waste %</th>
                    <th className="py-2 px-2 text-right">QC FPY %</th>
                    <th className="py-2 px-2 text-right">Dispatch</th>
                    <th className="py-2 px-2 text-right">WH Var</th>
                    <th className="py-2 pl-2 text-right">Open CAPA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {filteredMachines.map((m) => {
                    const isSelected = selectedMachineDetail === m.machine;
                    return (
                      <tr
                        key={m.machine}
                        onClick={() => setSelectedMachineDetail(isSelected ? '' : m.machine)}
                        className={`cursor-pointer transition ${
                          isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2 pr-3 font-semibold text-[#0F1E36] whitespace-nowrap">
                          {m.machine}
                        </td>
                        <td
                          className={`py-2 px-2 text-right font-bold ${
                            m.qualityIndex >= 85
                              ? 'text-emerald-700'
                              : m.qualityIndex >= 70
                              ? 'text-amber-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {m.qualityIndex}%
                        </td>
                        <td className="py-2 px-2 text-right">{m.availabilityPct}%</td>
                        <td className="py-2 px-2 text-right text-rose-700">{m.breakdownHrs}</td>
                        <td className="py-2 px-2 text-right">{m.powerOutageLinkedCount}</td>
                        <td className="py-2 px-2 text-right">{m.sopProdKg.toLocaleString()}</td>
                        <td
                          className={`py-2 px-2 text-right font-semibold ${
                            m.scrapRatePct >= 8 ? 'text-rose-700' : 'text-slate-700'
                          }`}
                        >
                          {m.scrapRatePct}%
                        </td>
                        <td className="py-2 px-2 text-right">{m.qcPassRatePct}%</td>
                        <td className="py-2 px-2 text-right">{m.dispatchUnits.toLocaleString()}</td>
                        <td className="py-2 px-2 text-right">{m.whVarianceCount}</td>
                        <td className="py-2 pl-2 text-right font-bold text-rose-700">
                          {m.openCapaCount}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {activeMachineDrilldown?.profile && (
            <div className="rounded-xl border border-[#0F1E36]/30 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <h4 className="text-sm font-bold text-[#0F1E36]">
                    Machine Drilldown: {activeMachineDrilldown.profile.machine}
                  </h4>
                  <p className="text-xs text-slate-500 tabular-nums">
                    Run: {activeMachineDrilldown.profile.runHrs}h · Breakdown: {activeMachineDrilldown.profile.breakdownHrs}h · Changeover: {activeMachineDrilldown.profile.changeoverHrs}h · Trials: {activeMachineDrilldown.profile.trialsCount}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={generatingPdf !== null}
                    onClick={() =>
                      handleRunPdfReport('machines', activeMachineDrilldown.profile!.machine)
                    }
                    className="inline-flex items-center gap-1 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-2.5 py-1 text-xs font-semibold text-white whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Machine Audit PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedMachineDetail('')}
                    className="text-xs text-slate-500 hover:text-slate-900"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="space-y-1.5">
                  <div className="font-semibold text-slate-700">
                    Detected Signals ({activeMachineDrilldown.machineSignals.length})
                  </div>
                  {activeMachineDrilldown.machineSignals.length === 0 ? (
                    <div className="text-slate-500">No anomalies detected on this machine.</div>
                  ) : (
                    activeMachineDrilldown.machineSignals.map((s) => (
                      <div key={s.signalKey} className="border-b border-slate-100 py-1.5 flex items-center justify-between gap-2">
                        <span className="text-slate-800">{s.title}</span>
                        <button
                          type="button"
                          onClick={() => openCapaFromSignal(s)}
                          className="text-[#0F1E36] font-semibold underline shrink-0"
                        >
                          {s.linkedCapa ? s.linkedCapa.capaNo : 'Raise CAPA'}
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="space-y-1.5">
                  <div className="font-semibold text-slate-700">
                    CAPAs on Machine ({activeMachineDrilldown.machineCapas.length})
                  </div>
                  {activeMachineDrilldown.machineCapas.length === 0 ? (
                    <div className="text-slate-500">No CAPAs logged for this machine.</div>
                  ) : (
                    activeMachineDrilldown.machineCapas.map((c) => (
                      <div key={c.id} className="border-b border-slate-100 py-1.5 flex items-center justify-between gap-2">
                        <span className="text-slate-800">
                          {c.capaNo} · {c.title}
                        </span>
                        <button
                          type="button"
                          onClick={() => openEditCapaModal(c)}
                          className="text-[#0F1E36] font-semibold underline shrink-0"
                        >
                          Open
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 3: PRODUCT & DISPATCH END-TO-END TRACEABILITY            */}
      {/* ============================================================ */}
      {subTab === 'products' && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div>
              <h3 className="text-sm font-bold text-[#0F1E36]">
                Product &amp; Dispatch End-to-End Traceability Matrix
              </h3>
              <p className="text-xs text-slate-500">
                Links Monthly Plan Targets → SOP Production Output &amp; Scrap → Floor QC &amp; Inspection Lots → ISO Quality Trials → Special Orders → Confirmed WH Dispatch.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={generatingPdf !== null}
                onClick={() => handleRunPdfReport('products')}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <FileText className="h-3.5 w-3.5 text-[#0F1E36]" />
                <span>{generatingPdf === 'products' ? 'Preparing...' : 'Product Trace PDF'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleRunCsvReport('products')}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5 text-slate-700" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>
          {filteredProducts.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">
              No active product production, plan, QC, or dispatch records found in this date range.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-semibold text-slate-500">
                    <th className="py-2 pr-3">Product</th>
                    <th className="py-2 px-2">Primary Machine</th>
                    <th className="py-2 px-2 text-right">Planned</th>
                    <th className="py-2 px-2 text-right">Dispatched</th>
                    <th className="py-2 px-2 text-right">Attain %</th>
                    <th className="py-2 px-2 text-right">SOP Prod (kg)</th>
                    <th className="py-2 px-2 text-right">Scrap %</th>
                    <th className="py-2 px-2 text-right">QC FPY %</th>
                    <th className="py-2 px-2 text-right">Trials Pass</th>
                    <th className="py-2 px-2 text-right">WH Var</th>
                    <th className="py-2 pl-2 text-right">Open CAPA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {filteredProducts.map((p) => (
                    <tr key={p.product} className="hover:bg-slate-50">
                      <td className="py-2 pr-3 font-semibold text-[#0F1E36]">{p.product}</td>
                      <td className="py-2 px-2 text-slate-600">{p.primaryMachine}</td>
                      <td className="py-2 px-2 text-right">{p.plannedQty.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right font-semibold">{p.dispatchedQty.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right">
                        {p.plannedQty > 0 ? `${p.planAttainmentPct}%` : '—'}
                      </td>
                      <td className="py-2 px-2 text-right">{p.sopProdKg.toLocaleString()}</td>
                      <td
                        className={`py-2 px-2 text-right font-semibold ${
                          p.scrapPct >= 8 ? 'text-rose-700' : 'text-slate-700'
                        }`}
                      >
                        {p.scrapPct}%
                      </td>
                      <td className="py-2 px-2 text-right">{p.qcPassRatePct}%</td>
                      <td className="py-2 px-2 text-right">
                        {p.trialsTotal > 0 ? `${p.trialsApproved}/${p.trialsTotal}` : '—'}
                      </td>
                      <td className="py-2 px-2 text-right">{p.whVarianceCount}</td>
                      <td className="py-2 pl-2 text-right font-bold text-rose-700">
                        {p.openCapaCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 4: SHIFT, ATTENDANCE & CLOSED-LOOP SCRAP / UTILITIES     */}
      {/* ============================================================ */}
      {subTab === 'loop_shifts' && (
        <div className="space-y-4">
          {/* Shift & Staffing Correlation */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <div>
                <h3 className="text-sm font-bold text-[#0F1E36]">
                  Day vs Night Shift Quality &amp; Staffing Correlation
                </h3>
                <p className="text-xs text-slate-500">
                  Correlates SOP output, scrap %, QC FPY %, downtime mins, shift handovers, dispatch units, and Attendance casual staffing ratio.
                </p>
              </div>
              <button
                type="button"
                disabled={generatingPdf !== null}
                onClick={() => handleRunPdfReport('loop_shifts')}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <FileText className="h-3.5 w-3.5 text-[#0F1E36]" />
                <span>{generatingPdf === 'loop_shifts' ? 'Preparing...' : 'Shift & Scrap PDF'}</span>
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-semibold text-slate-500">
                    <th className="py-2 pr-3">Shift</th>
                    <th className="py-2 px-2 text-right">SOP Prod (kg)</th>
                    <th className="py-2 px-2 text-right">Scrap (kg)</th>
                    <th className="py-2 px-2 text-right">Scrap %</th>
                    <th className="py-2 px-2 text-right">QC FPY %</th>
                    <th className="py-2 px-2 text-right">Downtime (m)</th>
                    <th className="py-2 px-2 text-right">Avg Staff Present</th>
                    <th className="py-2 px-2 text-right">Casuals Ratio</th>
                    <th className="py-2 pl-2 text-right">Dispatched Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {analytics.shiftCorrelation.map((s) => (
                    <tr key={s.shift}>
                      <td className="py-2.5 pr-3 font-bold text-[#0F1E36]">{s.shift} Shift</td>
                      <td className="py-2.5 px-2 text-right">{s.sopProdKg.toLocaleString()}</td>
                      <td className="py-2.5 px-2 text-right">{s.sopScrapKg.toLocaleString()}</td>
                      <td className="py-2.5 px-2 text-right font-semibold">{s.scrapPct}%</td>
                      <td className="py-2.5 px-2 text-right font-semibold text-emerald-700">
                        {s.qcPassRatePct}%
                      </td>
                      <td className="py-2.5 px-2 text-right text-rose-700">{s.breakdownMins}</td>
                      <td className="py-2.5 px-2 text-right">{s.attendanceAvgHeadcount}</td>
                      <td className="py-2.5 px-2 text-right">{s.casualRatioPct}%</td>
                      <td className="py-2.5 pl-2 text-right font-semibold">
                        {s.dispatchedQty.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Closed-Loop Recycling + Mixing + Scrap Sales + Utilities */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#0F1E36] border-b border-slate-100 pb-2">
                Closed-Loop Scrap, Recycling, Mixing &amp; Sales Chain
              </h3>
              <div className="divide-y divide-slate-100 text-xs tabular-nums">
                <div className="py-2 flex justify-between">
                  <span className="text-slate-600">Floor Scrap + Wastage Logged</span>
                  <span className="font-semibold text-slate-900">
                    {(analytics.totalSopScrapKg + analytics.totalWastageKg).toLocaleString()} kg
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-slate-600">Sent to Recycling Pipeline</span>
                  <span className="font-semibold text-slate-900">
                    {analytics.scrapSentToRecyclingKg.toLocaleString()} kg
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-slate-600">Usable Regrind Produced (Recovery %)</span>
                  <span className="font-semibold text-emerald-700">
                    {analytics.usableRegrindProducedKg.toLocaleString()} kg ({analytics.closedLoopRecoveryPct}%)
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-slate-600">Mixer Consumed (WH Virgin / Regrind)</span>
                  <span className="font-semibold text-slate-900">
                    {analytics.mixerWhUsedKg.toLocaleString()} / {analytics.mixerScrapUsedKg.toLocaleString()} kg ({analytics.mixerBatchesTotal} batches)
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-slate-600">Recycling Scrap Sales (Paid + 3-Signed)</span>
                  <span className="font-semibold text-[#0F1E36]">
                    {analytics.scrapSoldGrossKg.toLocaleString()} / {analytics.scrapSoldNetKg.toLocaleString()} kg · ${analytics.scrapSalesRevenueUsd.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#0F1E36] border-b border-slate-100 pb-2">
                Utilities Reliability &amp; Fuel Governance
              </h3>
              <div className="divide-y divide-slate-100 text-xs tabular-nums">
                <div className="py-2 flex justify-between">
                  <span className="text-slate-600">Power Cuts Recorded</span>
                  <span className="font-semibold text-slate-900">
                    {analytics.powerCutCount} outages · {analytics.powerCutHours} hrs
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-slate-600">Generator Runtime &amp; Fuel Consumed</span>
                  <span className="font-semibold text-slate-900">
                    {analytics.generatorRunHours} hrs · {analytics.generatorFuelLitres} L
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-slate-600">Diesel Bowser Issued (Period)</span>
                  <span className="font-semibold text-slate-900">{analytics.dieselIssuedLitres} L</span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-slate-600">Diesel Bulk GRNs Received (Period)</span>
                  <span className="font-semibold text-emerald-700">{analytics.dieselReceivedLitres} L</span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-slate-600">Live Diesel Bowser Tank Level</span>
                  <span className="font-semibold text-[#0F1E36]">{analytics.dieselTankLevelLitres} L</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 5: NCR & CAPA REGISTER + AUDITS                          */}
      {/* ============================================================ */}
      {subTab === 'capa' && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-[#0F1E36]">
                Linked Non-Conformance &amp; CAPA Register ({filteredCapas.length})
              </h3>
              <p className="text-xs text-slate-500">
                Full PDCA / 8D workflow with Ishikawa 6M classification, linked operational record IDs, and HOD Closure sign-off.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={capaStatusFilter}
                onChange={(e) => setCapaStatusFilter(e.target.value as 'ALL' | TqmCapaStatus)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
              >
                <option value="ALL">All Statuses</option>
                <option value="OPEN">Open</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="VERIFIED_CLOSED">Verified Closed</option>
              </select>
              <button
                type="button"
                disabled={generatingPdf !== null}
                onClick={() => handleRunPdfReport('capa_register')}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <FileText className="h-3.5 w-3.5 text-[#0F1E36]" />
                <span>Register PDF</span>
              </button>
              <button
                type="button"
                onClick={() => handleRunCsvReport('capa')}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5 text-slate-700" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={openBlankCapaModal}
                className="rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0"
              >
                + New CAPA
              </button>
            </div>
          </div>

          {filteredCapas.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 space-y-2">
              <ClipboardCheck className="h-8 w-8 text-slate-400 mx-auto" />
              <div>No CAPAs recorded yet. Raise one manually or from Executive Quality Signals.</div>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {filteredCapas.map((c) => (
                <div
                  key={c.id}
                  className="py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#0F1E36]">{c.capaNo}</span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${getStatusTextStyle(
                          c.status
                        )}`}
                      >
                        {c.status.replace(/_/g, ' ')}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${getSeverityTextStyle(
                          c.severity
                        )}`}
                      >
                        {c.severity}
                      </span>
                      <span className="text-xs font-semibold text-slate-900">{c.title}</span>
                    </div>
                    <p className="text-xs text-slate-600 line-clamp-2">{c.problemStatement}</p>
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 tabular-nums">
                      <span>Date: {c.date} ({c.shift})</span>
                      <span>Machine: {c.machine}</span>
                      <span>Product: {c.product}</span>
                      <span>6M: {c.ishikawaCategory}</span>
                      <span>Owner: {c.ownerName}</span>
                      <span>Due: {c.targetDueDate}</span>
                      <span>COPQ: ${(c.estimatedCopqUsd || 0).toFixed(2)}</span>
                      <span>Linked: {c.linkedRefs?.length || 0} record(s)</span>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEditCapaModal(c)}
                      className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0"
                    >
                      Edit / Verify
                    </button>
                    <button
                      type="button"
                      disabled={generatingPdf === c.id}
                      onClick={() => handleDownloadSingleCapaPdf(c)}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>{generatingPdf === c.id ? 'Generating...' : 'CAPA PDF'}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 6: TQMS REPORTS & AUDIT GENERATION CENTER                */}
      {/* ============================================================ */}
      {subTab === 'reports' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#0F1E36]">
                  TQMS Audit &amp; Compliance Report Center
                </h3>
                <p className="text-xs text-slate-500">
                  Generate live LG PLAST quality audit PDFs, CSV tables, on-screen printable management reviews, or Admin 5-sheet Excel workbooks for window {analytics.periodLabel}.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowReportPreview(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap shrink-0"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>Open Full Audit Preview</span>
                </button>
              </div>
            </div>

            {/* Report Scope Summary Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-5 border border-slate-200 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-slate-50 text-xs tabular-nums">
              <div className="p-3">
                <div className="text-[11px] text-slate-500">Audit Period</div>
                <div className="font-bold text-[#0F1E36]">{analytics.periodLabel}</div>
              </div>
              <div className="p-3">
                <div className="text-[11px] text-slate-500">Plant TQM Index</div>
                <div className="font-bold text-slate-900">{analytics.overallTqmIndex}%</div>
              </div>
              <div className="p-3">
                <div className="text-[11px] text-slate-500">Machines Tracked</div>
                <div className="font-bold text-slate-900">{analytics.machineProfiles.length} lines</div>
              </div>
              <div className="p-3">
                <div className="text-[11px] text-slate-500">Products Traced</div>
                <div className="font-bold text-slate-900">{analytics.productProfiles.length} SKUs</div>
              </div>
              <div className="p-3">
                <div className="text-[11px] text-slate-500">Net COPQ Exposure</div>
                <div className="font-bold text-rose-700">${analytics.copqNetAfterRecoveryUsd.toFixed(2)}</div>
              </div>
            </div>

            {/* 6 Standardized TQM Report Packs */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Pack 1: Full TQM Executive Audit */}
              <div className="rounded-lg border border-slate-200 p-4 flex flex-col justify-between gap-3 bg-white">
                <div className="space-y-1.5">
                  <div className="text-xs font-bold text-[#0F1E36]">
                    01. Complete Plant TQM Executive &amp; COPQ Audit
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Multi-page ISO 9001 audit PDF combining Scorecard, COPQ &amp; recovery, 6M distribution, active signals, all Machine 360° &amp; Product matrices, Shifts, CAPA register, and 3 sign-offs.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={generatingPdf !== null}
                    onClick={() => handleRunPdfReport('executive')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>{generatingPdf === 'executive' ? 'Building...' : 'Download Audit PDF'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowReportPreview(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span>Preview / Print</span>
                  </button>
                </div>
              </div>

              {/* Pack 2: Machine 360 Reliability Matrix */}
              <div className="rounded-lg border border-slate-200 p-4 flex flex-col justify-between gap-3 bg-white">
                <div className="space-y-2">
                  <div className="text-xs font-bold text-[#0F1E36]">
                    02. Machine 360° Reliability &amp; Breakdown Report
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Availability %, breakdown hours, power-cut links, SOP scrap %, QC FPY %, and machine-specific signals.
                  </p>
                  <select
                    value={reportMachineScope}
                    onChange={(e) => setReportMachineScope(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                  >
                    <option value="">All Plant Machines ({analytics.machineProfiles.length})</option>
                    {analytics.machineProfiles.map((m) => (
                      <option key={m.machine} value={m.machine}>
                        {m.machine} (Idx {m.qualityIndex}%)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={generatingPdf !== null}
                    onClick={() =>
                      handleRunPdfReport('machines', reportMachineScope || undefined)
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>{generatingPdf === 'machines' ? 'Building...' : 'Download PDF'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRunCsvReport('machines')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Export CSV</span>
                  </button>
                </div>
              </div>

              {/* Pack 3: Product & Dispatch Traceability */}
              <div className="rounded-lg border border-slate-200 p-4 flex flex-col justify-between gap-3 bg-white">
                <div className="space-y-1.5">
                  <div className="text-xs font-bold text-[#0F1E36]">
                    03. Product &amp; Dispatch Traceability Report
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Full batch traceability linking Monthly Plans, SOP Output, Floor QC, Quality Trials, Special Orders, and Confirmed WH Dispatches ({analytics.productProfiles.length} products).
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={generatingPdf !== null}
                    onClick={() => handleRunPdfReport('products')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>{generatingPdf === 'products' ? 'Building...' : 'Download PDF'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRunCsvReport('products')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Export CSV</span>
                  </button>
                </div>
              </div>

              {/* Pack 4: Shift, Staffing & Closed-Loop Scrap / Utilities */}
              <div className="rounded-lg border border-slate-200 p-4 flex flex-col justify-between gap-3 bg-white">
                <div className="space-y-1.5">
                  <div className="text-xs font-bold text-[#0F1E36]">
                    04. Shift Correlation, Scrap Loop &amp; Utilities
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Day vs Night staffing &amp; casuals impact, recycling regrind recovery ({analytics.closedLoopRecoveryPct}%), mixing usage, scrap sales, power cuts, and diesel bowser audit.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={generatingPdf !== null}
                    onClick={() => handleRunPdfReport('loop_shifts')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>{generatingPdf === 'loop_shifts' ? 'Building...' : 'Download PDF'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRunCsvReport('signals')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Signals CSV ({analytics.detectedSignals.length})</span>
                  </button>
                </div>
              </div>

              {/* Pack 5: Linked NCR & CAPA Master Register */}
              <div className="rounded-lg border border-slate-200 p-4 flex flex-col justify-between gap-3 bg-white">
                <div className="space-y-1.5">
                  <div className="text-xs font-bold text-[#0F1E36]">
                    05. Linked NCR &amp; CAPA Master Register
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Complete non-conformance register with 5-Why root causes, corrective/preventive actions, COPQ exposure, and HOD verification ({tqmCapas.length} records).
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={generatingPdf !== null}
                    onClick={() => handleRunPdfReport('capa_register')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>{generatingPdf === 'capa_register' ? 'Building...' : 'Download PDF'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRunCsvReport('capa')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Export CSV</span>
                  </button>
                </div>
              </div>

              {/* Pack 6: Admin-Only 5-Sheet Master Excel (.xlsx) */}
              <div className="rounded-lg border border-slate-200 p-4 flex flex-col justify-between gap-3 bg-slate-50">
                <div className="space-y-1.5">
                  <div className="text-xs font-bold text-[#0F1E36]">
                    06. Admin Master 5-Sheet TQM Workbook (.xlsx)
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Background-compiled 5-sheet workbook (Executive COPQ, Machine 360, Product Trace, Shift Attendance, CAPA Register). Strictly restricted to Plant Admin.
                  </p>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
                  {isAdmin ? (
                    <button
                      type="button"
                      disabled={exportingExcel}
                      onClick={handleDownloadAdminExcel}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      <span>{exportingExcel ? 'Compiling Excel...' : 'Download Master .xlsx'}</span>
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                      <Lock className="h-3.5 w-3.5" />
                      <span>Restricted to Plant Administrator</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: CREATE / EDIT / HOD-VERIFY LINKED CAPA                */}
      {/* ============================================================ */}
      {showCapaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveCapa}
            className="w-full max-w-3xl rounded-xl border border-slate-300 bg-white p-5 shadow-2xl space-y-4 text-xs my-auto max-h-[92vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  ISO 9001 Non-Conformance &amp; Corrective Action
                </div>
                <h3 className="text-base font-bold text-[#0F1E36]">
                  {editingCapaId ? `Update CAPA ${capaNo}` : `Raise Linked CAPA (${capaNo})`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCapaModal(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">CAPA Title *</label>
                <input
                  type="text"
                  required
                  value={capaTitle}
                  onChange={(e) => setCapaTitle(e.target.value)}
                  placeholder="Short non-conformance title"
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-900"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={capaDate}
                  onChange={(e) => setCapaDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-900"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Shift</label>
                <select
                  value={capaShift}
                  onChange={(e) => setCapaShift(e.target.value as 'Day' | 'Night')}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-900"
                >
                  <option value="Day">Day Shift</option>
                  <option value="Night">Night Shift</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Machine / Line</label>
                <select
                  value={capaMachine}
                  onChange={(e) => setCapaMachine(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-900"
                >
                  {machines.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  <option value="Plant Floor">Plant Floor / All Lines</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Product</label>
                <input
                  type="text"
                  value={capaProduct}
                  onChange={(e) => setCapaProduct(e.target.value)}
                  placeholder="e.g. 20mm Conduit / Gum Boot"
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-900"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ishikawa 6M</label>
                <select
                  value={capaCategory}
                  onChange={(e) => setCapaCategory(e.target.value as TqmIshikawaCategory)}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-900"
                >
                  {ISHIKAWA_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Severity &amp; Status</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={capaSeverity}
                    onChange={(e) => setCapaSeverity(e.target.value as TqmCapaSeverity)}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-slate-900"
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                  <select
                    value={capaStatus}
                    onChange={(e) => setCapaStatus(e.target.value as TqmCapaStatus)}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-slate-900"
                  >
                    <option value="OPEN">OPEN</option>
                    <option value="IN_PROGRESS">IN PROGRESS</option>
                    <option value="VERIFIED_CLOSED" disabled={!canHodVerify}>
                      CLOSED (HOD)
                    </option>
                  </select>
                </div>
              </div>
            </div>

            {/* Cross-Module Record Linker */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="font-semibold text-[#0F1E36] flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5" />
                <span>Link Plant Records ({capaLinkedRefs.length})</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={capaAddRefKey}
                  onChange={(e) => setCapaAddRefKey(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                >
                  <option value="">-- Select record from QC, Downtime, Dispatch, Trials, Scrap, or Power --</option>
                  {analytics.allLinkedEntityCatalog.map((item) => (
                    <option key={`${item.module}:${item.recordId}`} value={`${item.module}:${item.recordId}`}>
                      [{item.module}] {item.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (!capaAddRefKey) return;
                    const found = analytics.allLinkedEntityCatalog.find(
                      (x) => `${x.module}:${x.recordId}` === capaAddRefKey
                    );
                    if (
                      found &&
                      !capaLinkedRefs.some(
                        (r) => r.module === found.module && r.recordId === found.recordId
                      )
                    ) {
                      setCapaLinkedRefs((prev) => [...prev, found]);
                    }
                    setCapaAddRefKey('');
                  }}
                  className="rounded-lg bg-[#0F1E36] px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0"
                >
                  Attach Record
                </button>
              </div>
              {capaLinkedRefs.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {capaLinkedRefs.map((ref) => (
                    <span
                      key={`${ref.module}:${ref.recordId}`}
                      className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-800"
                    >
                      <span>[{ref.module}] {ref.label}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setCapaLinkedRefs((prev) =>
                            prev.filter(
                              (x) => !(x.module === ref.module && x.recordId === ref.recordId)
                            )
                          )
                        }
                        className="text-slate-400 hover:text-rose-600"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Problem Statement *</label>
                <textarea
                  rows={2}
                  required
                  value={capaProblem}
                  onChange={(e) => setCapaProblem(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-900"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">5-Why Root Cause Analysis</label>
                <textarea
                  rows={2}
                  value={capaRootCause}
                  onChange={(e) => setCapaRootCause(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-900"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Immediate Containment</label>
                <textarea
                  rows={2}
                  value={capaContainment}
                  onChange={(e) => setCapaContainment(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-900"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Corrective Action (Immediate Fix)</label>
                <textarea
                  rows={2}
                  value={capaCorrective}
                  onChange={(e) => setCapaCorrective(e.target.value)}
                  placeholder="Immediate corrective containment / parameter repair..."
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-900"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Preventive &amp; Systemic Control</label>
                <textarea
                  rows={2}
                  value={capaPreventive}
                  onChange={(e) => setCapaPreventive(e.target.value)}
                  placeholder="Long-term SOP revision, operator retraining, PM schedule or poka-yoke control..."
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Action Owner</label>
                <input
                  type="text"
                  value={capaOwner}
                  onChange={(e) => setCapaOwner(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-900"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Due Date</label>
                <input
                  type="date"
                  value={capaDueDate}
                  onChange={(e) => setCapaDueDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-900"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Est. COPQ ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={capaCopqUsd}
                  onChange={(e) => setCapaCopqUsd(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-900 tabular-nums"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Scrap Impact (kg)</label>
                <input
                  type="number"
                  step="0.1"
                  value={capaScrapKg}
                  onChange={(e) => setCapaScrapKg(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-900 tabular-nums"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Downtime (mins)</label>
                <input
                  type="number"
                  step="1"
                  value={capaDowntimeMins}
                  onChange={(e) => setCapaDowntimeMins(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-900 tabular-nums"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
              <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                <div className="font-semibold text-slate-800">1. Raised By Signature</div>
                {capaRaisedSig ? (
                  <img src={capaRaisedSig} alt="Raised signature" className="h-12 border border-slate-200 rounded" />
                ) : null}
                <button
                  type="button"
                  onClick={() => setSigTarget('raised')}
                  className="rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-800"
                >
                  {capaRaisedSig ? 'Re-Sign Raised Signature' : 'Sign Raised By'}
                </button>
              </div>

              <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                <div className="font-semibold text-slate-800 flex items-center justify-between">
                  <span>2. HOD Verification &amp; Closure</span>
                  {!canHodVerify && <span className="text-[10px] text-amber-700">HOD/Admin Only</span>}
                </div>
                <input
                  type="text"
                  disabled={!canHodVerify}
                  value={capaVerifiedNotes}
                  onChange={(e) => setCapaVerifiedNotes(e.target.value)}
                  placeholder="Effectiveness check / closure notes..."
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1 text-slate-900 disabled:bg-slate-50"
                />
                {capaVerifiedSig ? (
                  <img src={capaVerifiedSig} alt="HOD signature" className="h-12 border border-slate-200 rounded" />
                ) : null}
                {canHodVerify && (
                  <button
                    type="button"
                    onClick={() => setSigTarget('verified')}
                    className="rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-800"
                  >
                    {capaVerifiedSig ? 'Update HOD Verification Sign' : 'Sign & Verify Closure'}
                  </button>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowCapaModal(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingCapa}
                className="rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-5 py-2 text-xs font-semibold text-white transition disabled:opacity-50"
              >
                {savingCapa ? 'Saving CAPA...' : 'Save Linked CAPA'}
              </button>
            </div>
          </form>
        </div>
      )}

      <DigitalSignaturePad
        isOpen={sigTarget !== null}
        onClose={() => setSigTarget(null)}
        initialRole={sigTarget === 'verified' ? 'supervisor' : 'technician'}
        initialName={currentUserName}
        logTitle={capaNo || 'TQM CAPA Sign-Off'}
        equipmentId={capaMachine}
        onSaveSignature={(data) => {
          if (sigTarget === 'raised') {
            setCapaRaisedSig(data.signature);
          } else if (sigTarget === 'verified') {
            setCapaVerifiedBy(data.name || currentUserName);
            setCapaVerifiedSig(data.signature);
            setCapaStatus('VERIFIED_CLOSED');
          }
          setSigTarget(null);
        }}
      />

      {/* ============================================================ */}
      {/* MODAL: ON-SCREEN PRINTABLE TQM EXECUTIVE AUDIT PREVIEW       */}
      {/* ============================================================ */}
      {showReportPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-5 overflow-y-auto">
          <div className="w-full max-w-4xl rounded-xl border border-slate-300 bg-white shadow-2xl my-auto max-h-[92vh] flex flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-[#0F1E36] px-5 py-3.5 text-white print:hidden">
              <div>
                <div className="text-[11px] text-sky-200 uppercase tracking-wider">
                  LG PLAST · Total Quality Management Report Preview
                </div>
                <div className="text-sm font-bold">
                  Plant-Wide Audit ({analytics.periodLabel})
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={generatingPdf !== null}
                  onClick={() => handleRunPdfReport('executive')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>{generatingPdf === 'executive' ? 'Generating...' : 'Download Full PDF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Print View</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowReportPreview(false)}
                  className="rounded-lg p-1.5 text-slate-200 hover:bg-white/15"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 text-xs text-slate-900">
              {/* Printable Letterhead */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div className="flex items-center gap-3">
                  <LgplastLogo size="sm" showSubtitle={false} />
                  <div>
                    <h4 className="text-base font-bold text-[#0F1E36]">
                      LG PLAST (PVT) LTD — TQM EXECUTIVE AUDIT REPORT
                    </h4>
                    <div className="text-[11px] text-slate-500">
                      Window: {analytics.periodLabel} · Prepared By: {currentUserName || 'Quality / Admin'}
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-slate-500 tabular-nums sm:text-right">
                  <div>Plant TQM Index: <strong className="text-[#0F1E36]">{analytics.overallTqmIndex}%</strong></div>
                  <div>Net COPQ: <strong className="text-rose-700">${analytics.copqNetAfterRecoveryUsd.toFixed(2)}</strong></div>
                </div>
              </div>

              {/* KPI + COPQ Table */}
              <div>
                <h5 className="font-bold text-[#0F1E36] mb-1.5 uppercase tracking-wider text-[11px]">
                  01. Plant Quality Indicators &amp; Cost of Poor Quality
                </h5>
                <table className="w-full border border-slate-200 text-xs tabular-nums">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-left">
                      <th className="p-2">Indicator</th>
                      <th className="p-2">Value</th>
                      <th className="p-2">COPQ / Closed-Loop Driver</th>
                      <th className="p-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    <tr>
                      <td className="p-2 font-semibold">First-Pass Quality Yield</td>
                      <td className="p-2">{analytics.firstPassYieldPct}% ({analytics.totalQcFailHold} fail/hold)</td>
                      <td className="p-2">Scrap &amp; Sweepings Loss</td>
                      <td className="p-2 text-right text-rose-700 font-semibold">${analytics.copqScrapLossUsd.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td className="p-2 font-semibold">Machine Availability</td>
                      <td className="p-2">{analytics.machineAvailabilityPct}%</td>
                      <td className="p-2">Breakdown Downtime Loss</td>
                      <td className="p-2 text-right text-rose-700 font-semibold">${analytics.copqDowntimeLossUsd.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td className="p-2 font-semibold">Regrind Recovery Rate</td>
                      <td className="p-2">{analytics.closedLoopRecoveryPct}% ({analytics.usableRegrindProducedKg} kg)</td>
                      <td className="p-2">Scrap Sales Revenue Offset</td>
                      <td className="p-2 text-right text-emerald-700 font-semibold">-${analytics.scrapSalesRevenueUsd.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td className="p-2 font-semibold">Plan Attainment</td>
                      <td className="p-2">{analytics.planAttainmentPct}% ({analytics.totalWhVariances} WH var)</td>
                      <td className="p-2 font-bold">Net Unrecovered COPQ</td>
                      <td className="p-2 text-right font-bold text-rose-700">${analytics.copqNetAfterRecoveryUsd.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Machine Matrix Preview */}
              <div>
                <h5 className="font-bold text-[#0F1E36] mb-1.5 uppercase tracking-wider text-[11px]">
                  02. Machine 360° Reliability Summary ({analytics.machineProfiles.length} Lines)
                </h5>
                <div className="overflow-x-auto">
                  <table className="w-full border border-slate-200 text-xs tabular-nums">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 text-left">
                        <th className="p-2">Machine</th>
                        <th className="p-2 text-right">TQM Idx</th>
                        <th className="p-2 text-right">Avail %</th>
                        <th className="p-2 text-right">BD Hrs</th>
                        <th className="p-2 text-right">Prod (kg)</th>
                        <th className="p-2 text-right">Scrap %</th>
                        <th className="p-2 text-right">QC FPY %</th>
                        <th className="p-2 text-right">Open CAPA</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {analytics.machineProfiles.map((m) => (
                        <tr key={m.machine}>
                          <td className="p-2 font-semibold">{m.machine}</td>
                          <td className="p-2 text-right font-bold">{m.qualityIndex}%</td>
                          <td className="p-2 text-right">{m.availabilityPct}%</td>
                          <td className="p-2 text-right">{m.breakdownHrs}</td>
                          <td className="p-2 text-right">{m.sopProdKg}</td>
                          <td className="p-2 text-right">{m.scrapRatePct}%</td>
                          <td className="p-2 text-right">{m.qcPassRatePct}%</td>
                          <td className="p-2 text-right">{m.openCapaCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* CAPA Summary Preview */}
              <div>
                <h5 className="font-bold text-[#0F1E36] mb-1.5 uppercase tracking-wider text-[11px]">
                  03. Linked NCR &amp; CAPA Status ({tqmCapas.length} Total)
                </h5>
                {tqmCapas.length === 0 ? (
                  <p className="text-slate-500">No formal CAPAs logged in register.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border border-slate-200 text-xs tabular-nums">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200 text-left">
                          <th className="p-2">CAPA No</th>
                          <th className="p-2">Title</th>
                          <th className="p-2">Machine / Product</th>
                          <th className="p-2">Status</th>
                          <th className="p-2 text-right">COPQ $</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {tqmCapas.map((c) => (
                          <tr key={c.id}>
                            <td className="p-2 font-mono font-semibold">{c.capaNo}</td>
                            <td className="p-2">{c.title}</td>
                            <td className="p-2">{c.machine} / {c.product}</td>
                            <td className="p-2">{c.status.replace(/_/g, ' ')}</td>
                            <td className="p-2 text-right">${(c.estimatedCopqUsd || 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
