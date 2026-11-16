import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Database,
  Download,
  FileSpreadsheet,
  Filter,
  FlaskConical,
  Layers,
  Lock,
  MessageSquareText,
  Recycle,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { getCurrentShift, ymd } from '../services/downtimeCalc';
import {
  exportSopHandoverExcel,
  exportSopMasterWorkbook,
  exportSopMixingExcel,
  exportSopProductionExcel,
  exportSopQcExcel,
  exportSopScrapExcel,
  ParsedWhatsAppProdRow,
  ParsedWhatsAppQcRow,
  parseProductionWhatsAppText,
  parseQcWhatsAppText,
  saveSopHandoverToFirebase,
  saveSopMixingToFirebase,
  saveSopProductionToFirebase,
  saveSopQcToFirebase,
  saveSopScrapToFirebase,
} from '../services/sopStore';
import {
  DowntimeEntry,
  SopMixingReport,
  SopProductionRecord,
  SopQcRecord,
  SopScrapRecord,
  SopShiftHandoverRecord,
  UserPermissions,
} from '../types';
import {
  FLOOR_PRODUCTION_TEAM_OPTIONS,
  GENERAL_HAND_OPTIONS,
  MAINTENANCE_OPTIONS,
  MIXING_OPTIONS,
  OPERATOR_OPTIONS,
  RECYCLING_OPTIONS,
  SHIFT_IN_CHARGE_OPTIONS,
} from '../types/factoryStaff';
import { MASTER_JOB_CARDS } from '../types/jobCards';
import { LgplastLogo } from './LgplastLogo';
import { SopSubTab } from './SopPopupAlert';

const SCRAP_REASONS = [
  'Start-up scrap',
  'Die blockage',
  'Off-spec dimension',
  'Colour change',
  'Machine trial',
  'Purge / lump scrap',
  'Other',
];

const SCRAP_CONDITIONS = [
  'Clean / Dry',
  'Wet',
  'Contaminated - mixed material',
  'Contaminated - dirt/debris',
  'Mixed Colours',
];

const BREAKDOWN_REASONS = [
  'None',
  'Screw wear',
  'Heater failure',
  'Die blockage',
  'Mould change',
  'Power cut',
  'Material shortage',
  'Other',
];

interface SopFloorApkViewProps {
  machines: string[];
  downtimeEntries: DowntimeEntry[];
  productionLogs: SopProductionRecord[];
  qcChecks: SopQcRecord[];
  scrapPipeline: SopScrapRecord[];
  mixingReports: SopMixingReport[];
  handovers: SopShiftHandoverRecord[];
  permissions: UserPermissions;
  isAdmin: boolean;
  currentUserName: string;
  currentUserEmail: string;
  requestedSubTab?: SopSubTab | null;
  onSubTabHandled?: () => void;
  forcedSubTab?: SopSubTab;
  standaloneMode?: boolean;
}

export const SopFloorApkView: React.FC<SopFloorApkViewProps> = ({
  machines,
  downtimeEntries,
  productionLogs,
  qcChecks,
  scrapPipeline,
  mixingReports,
  handovers,
  permissions,
  isAdmin,
  currentUserName,
  currentUserEmail,
  requestedSubTab,
  onSubTabHandled,
  forcedSubTab,
  standaloneMode = false,
}) => {
  const allowedSubTabs = useMemo<SopSubTab[]>(() => {
    const tabs: SopSubTab[] = [];
    if (isAdmin || permissions.sopFloorAccess) {
      tabs.push('overview');
    }
    if (isAdmin || permissions.sopFloorAccess) {
      tabs.push('production');
      tabs.push('qc');
    }
    if (isAdmin || permissions.sopScrapSend || permissions.sopFloorAccess) {
      tabs.push('scrap_send');
    }
    if (isAdmin || permissions.sopRecyclingConfirm) {
      tabs.push('recycling');
    }
    if (isAdmin || permissions.sopMixingAccess || permissions.dispatchHODConfirm) {
      tabs.push('mixing');
    }
    if (isAdmin || permissions.dispatchShiftEntry || permissions.sopFloorAccess) {
      tabs.push('handover');
    }
    // Remove duplicates while preserving order
    return Array.from(new Set(tabs));
  }, [isAdmin, permissions]);

  const [internalSubTab, setInternalSubTab] = useState<SopSubTab>(
    () => forcedSubTab || allowedSubTabs[0] || 'overview'
  );
  const activeSubTab: SopSubTab =
    forcedSubTab && allowedSubTabs.includes(forcedSubTab) ? forcedSubTab : internalSubTab;

  useEffect(() => {
    if (requestedSubTab && allowedSubTabs.includes(requestedSubTab)) {
      setInternalSubTab(requestedSubTab);
      onSubTabHandled?.();
    } else if (!allowedSubTabs.includes(internalSubTab) && allowedSubTabs.length > 0) {
      setInternalSubTab(allowedSubTabs[0]);
    }
  }, [requestedSubTab, allowedSubTabs, internalSubTab, onSubTabHandled]);

  const shiftNow = getCurrentShift();
  const todayIso = ymd(new Date());
  const timeNow = new Date().toTimeString().slice(0, 5);

  const mixerMachines = useMemo(() => {
    const list = machines.filter((m) => m.toLowerCase().includes('mixer'));
    return list.length > 0 ? list : machines;
  }, [machines]);

  // =====================================
  // BANNER STATE
  // =====================================
  const [banner, setBanner] = useState<{ text: string; isError?: boolean } | null>(null);
  const showMsg = (text: string, isError = false) => {
    setBanner({ text, isError });
  };

  // =====================================
  // 1. PRODUCTION JOB CARD + WHATSAPP PARSER
  // =====================================
  const [pDate, setPDate] = useState(todayIso);
  const [pShift, setPShift] = useState<'Day' | 'Night'>(shiftNow.shift);
  const [pDept, setPDept] = useState('Extrusion');
  const [pMachine, setPMachine] = useState(machines[0] || 'Extrusion Machine 1');
  const [pOperator, setPOperator] = useState(OPERATOR_OPTIONS[0]?.value || 'FARAI MURONZWA');
  const [pAssistant, setPAssistant] = useState(GENERAL_HAND_OPTIONS[0]?.value || 'TRIED CHAKUBVA');
  const [pIsCasual, setPIsCasual] = useState(false);
  const [pCasualName, setPCasualName] = useState('');
  const [pProductSearch, setPProductSearch] = useState('');
  const [pProduct, setPProduct] = useState(MASTER_JOB_CARDS[0] || '');
  const [pSlot, setPSlot] = useState('07:30-19:30');
  const [pQty, setPQty] = useState('');
  const [pUnit, setPUnit] = useState('GOOD PIECES');
  const [pProdKg, setPProdKg] = useState('');
  const [pScrapKg, setPScrapKg] = useState('');
  const [pWastageKg, setPWastageKg] = useState('');
  const [pScrapReason, setPScrapReason] = useState(SCRAP_REASONS[0]);
  const [pBdStart, setPBdStart] = useState('');
  const [pBdEnd, setPBdEnd] = useState('');
  const [pBdReason, setPBdReason] = useState('None');
  const [pMtnce, setPMtnce] = useState('');
  const [pWaText, setPWaText] = useState('');
  const [pParsedRows, setPParsedRows] = useState<ParsedWhatsAppProdRow[]>([]);
  const [savingProd, setSavingProd] = useState(false);
  const [showProdBackgroundRecords, setShowProdBackgroundRecords] = useState(false);

  // Unified Report Filters (Date Range, Presets, Shift, Machine, Search) matching Attendance & Machines Excel
  const [reportFromDate, setReportFromDate] = useState('');
  const [reportToDate, setReportToDate] = useState('');
  const [reportShift, setReportShift] = useState<'ALL' | 'Day' | 'Night'>('ALL');
  const [reportMachine, setReportMachine] = useState<string>('ALL');
  const [reportSearch, setReportSearch] = useState('');

  const applyReportPreset = (
    preset: 'all' | 'today' | '7days' | '30days' | 'thisMonth' | 'lastMonth'
  ) => {
    if (preset === 'all') {
      setReportFromDate('');
      setReportToDate('');
      return;
    }
    const n = new Date();
    let f = new Date();
    let t = new Date();
    if (preset === 'today') {
      f = n;
      t = n;
    } else if (preset === '7days') {
      f.setDate(n.getDate() - 6);
      t = n;
    } else if (preset === '30days') {
      f.setDate(n.getDate() - 29);
      t = n;
    } else if (preset === 'thisMonth') {
      f = new Date(n.getFullYear(), n.getMonth(), 1);
      t = n;
    } else if (preset === 'lastMonth') {
      f = new Date(n.getFullYear(), n.getMonth() - 1, 1);
      t = new Date(n.getFullYear(), n.getMonth(), 0);
    }
    setReportFromDate(ymd(f));
    setReportToDate(ymd(t));
  };

  const filteredProdCards = useMemo(
    () => MASTER_JOB_CARDS.filter((c) => c.toLowerCase().includes(pProductSearch.toLowerCase())),
    [pProductSearch]
  );

  const filteredProductionLogs = useMemo(() => {
    const q = reportSearch.trim().toLowerCase();
    return productionLogs.filter((p) => {
      if (reportFromDate && p.date < reportFromDate) return false;
      if (reportToDate && p.date > reportToDate) return false;
      if (reportShift !== 'ALL' && p.shift !== reportShift) return false;
      if (reportMachine !== 'ALL' && p.machine !== reportMachine) return false;
      if (q) {
        const hit =
          p.machine.toLowerCase().includes(q) ||
          p.product.toLowerCase().includes(q) ||
          p.operator.toLowerCase().includes(q) ||
          p.assistant.toLowerCase().includes(q) ||
          (p.dept || '').toLowerCase().includes(q) ||
          (p.scrapReason || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [productionLogs, reportFromDate, reportToDate, reportShift, reportMachine, reportSearch]);

  const handleSaveManualProduction = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalAssistant = pIsCasual ? pCasualName.trim() : pAssistant;
    if (!pMachine || !pProduct || !finalAssistant) {
      showMsg('Please fill Machine, Product, Operator, and Assistant.', true);
      return;
    }
    setSavingProd(true);
    try {
      const rec: SopProductionRecord = {
        id: `PRD-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
        date: pDate,
        shift: pShift,
        dept: pDept,
        machine: pMachine,
        operator: pOperator,
        assistant: finalAssistant,
        product: pProduct,
        timeSlot: pSlot.trim() || undefined,
        qty: pQty ? Number(pQty) : undefined,
        unit: pUnit,
        prodKg: Number(pProdKg || 0),
        scrapKg: Number(pScrapKg || 0),
        wastageCdKg: Number(pWastageKg || 0),
        scrapReason: pScrapReason,
        bdStart: pBdStart || undefined,
        bdEnd: pBdEnd || undefined,
        bdReason: pBdReason !== 'None' ? pBdReason : undefined,
        mtncePerson: pMtnce || undefined,
        reporter: currentUserName,
        source: 'MANUAL',
        loggedBy: currentUserName,
        upd: Date.now(),
      };
      const res = await saveSopProductionToFirebase(rec);
      setPQty('');
      setPProdKg('');
      setPScrapKg('');
      setPWastageKg('');
      setPBdStart('');
      setPBdEnd('');
      showMsg(
        res.ok
          ? `Production Job Card saved to background & linked to Dispatch (${rec.machine} • Scrap: ${rec.scrapKg} kg, Wastage: ${rec.wastageCdKg} kg).`
          : `Saved locally; cloud sync queued (${res.error || 'offline'}).`
      );
    } finally {
      setSavingProd(false);
    }
  };

  const handleParseProdWa = () => {
    if (!pWaText.trim()) {
      showMsg('Paste WhatsApp Production report message first.', true);
      return;
    }
    const parsed = parseProductionWhatsAppText(pWaText, machines);
    setPParsedRows(parsed);
    if (parsed.length === 0) {
      showMsg('No production records detected in pasted WhatsApp text.', true);
    } else {
      showMsg(`Parsed ${parsed.length} production line(s) from WhatsApp message. Review & Phase to Background below.`);
    }
  };

  const handleSaveParsedProdToBackground = async () => {
    if (pParsedRows.length === 0) return;
    setSavingProd(true);
    try {
      let savedCount = 0;
      for (const row of pParsedRows) {
        const rec: SopProductionRecord = {
          id: `PRD-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`,
          date: row.date,
          shift: row.shift,
          dept: row.dept || 'Extrusion',
          machine: row.machine || machines[0] || 'Extrusion Machine 1',
          operator: row.operator || pOperator,
          assistant: row.assistant || pAssistant,
          product: row.product || pProduct,
          qty: row.qty || undefined,
          unit: row.unit || 'GOOD PIECES',
          prodKg: row.prodKg || 0,
          scrapKg: row.scrapKg || 0,
          wastageCdKg: row.wastageCdKg || 0,
          reporter: row.reporter || currentUserName,
          source: 'WHATSAPP_PARSER',
          loggedBy: currentUserName,
          upd: Date.now(),
        };
        await saveSopProductionToFirebase(rec);
        savedCount++;
      }
      setPParsedRows([]);
      setPWaText('');
      showMsg(
        `Phased & saved ${savedCount} production record(s) to background cloud storage. Scrap & Wastage now auto-link to Dispatch!`
      );
    } finally {
      setSavingProd(false);
    }
  };

  // =====================================
  // 2. QC CHECK REPORT + WHATSAPP PARSER
  // =====================================
  const [qDate, setQDate] = useState(todayIso);
  const [qShift, setQShift] = useState<'Day' | 'Night'>(shiftNow.shift);
  const [qTime, setQTime] = useState(timeNow);
  const [qNo, setQNo] = useState('');
  const [qMachine, setQMachine] = useState(machines[0] || 'Extrusion Machine 1');
  const [qProductSearch, setQProductSearch] = useState('');
  const [qProduct, setQProduct] = useState(MASTER_JOB_CARDS[0] || '');
  const [qPph, setQPph] = useState('');
  const [qKgsHr, setQKgsHr] = useState('');
  const [qOd, setQOd] = useState('');
  const [qIdMm, setQIdMm] = useState('');
  const [qDropBend, setQDropBend] = useState<'Pass' | 'Fail'>('Pass');
  const [qFitting, setQFitting] = useState<'Pass' | 'Fail'>('Pass');
  const [qColor, setQColor] = useState<'Pass' | 'Fail'>('Pass');
  const [qWaText, setQWaText] = useState('');
  const [qParsedRows, setQParsedRows] = useState<ParsedWhatsAppQcRow[]>([]);
  const [savingQc, setSavingQc] = useState(false);
  const [showQcBackgroundRecords, setShowQcBackgroundRecords] = useState(false);

  const filteredQcCards = useMemo(
    () => MASTER_JOB_CARDS.filter((c) => c.toLowerCase().includes(qProductSearch.toLowerCase())),
    [qProductSearch]
  );

  const filteredQcChecks = useMemo(() => {
    const q = reportSearch.trim().toLowerCase();
    return qcChecks.filter((item) => {
      if (reportFromDate && item.date < reportFromDate) return false;
      if (reportToDate && item.date > reportToDate) return false;
      if (reportShift !== 'ALL' && item.shift !== reportShift) return false;
      if (reportMachine !== 'ALL' && item.machine !== reportMachine) return false;
      if (q) {
        const hit =
          item.machine.toLowerCase().includes(q) ||
          item.product.toLowerCase().includes(q) ||
          (item.qcNo || '').toLowerCase().includes(q) ||
          (item.reporter || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [qcChecks, reportFromDate, reportToDate, reportShift, reportMachine, reportSearch]);

  const filteredScrapPipeline = useMemo(() => {
    const q = reportSearch.trim().toLowerCase();
    return scrapPipeline.filter((s) => {
      if (reportFromDate && s.date < reportFromDate) return false;
      if (reportToDate && s.date > reportToDate) return false;
      if (reportShift !== 'ALL' && s.shift !== reportShift) return false;
      if (reportMachine !== 'ALL' && s.machine !== reportMachine) return false;
      if (q) {
        const hit =
          s.machine.toLowerCase().includes(q) ||
          s.product.toLowerCase().includes(q) ||
          s.sentByAssistant.toLowerCase().includes(q) ||
          (s.assignedRecycler || '').toLowerCase().includes(q) ||
          (s.receivedBy || '').toLowerCase().includes(q) ||
          s.status.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [scrapPipeline, reportFromDate, reportToDate, reportShift, reportMachine, reportSearch]);

  const filteredMixingReports = useMemo(() => {
    const q = reportSearch.trim().toLowerCase();
    return mixingReports.filter((m) => {
      if (reportFromDate && m.date < reportFromDate) return false;
      if (reportToDate && m.date > reportToDate) return false;
      if (reportShift !== 'ALL' && m.shift !== reportShift) return false;
      if (reportMachine !== 'ALL' && m.machine !== reportMachine) return false;
      if (q) {
        const hit =
          m.machine.toLowerCase().includes(q) ||
          m.mixerName.toLowerCase().includes(q) ||
          m.assistantName.toLowerCase().includes(q) ||
          m.status.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [mixingReports, reportFromDate, reportToDate, reportShift, reportMachine, reportSearch]);

  const filteredHandovers = useMemo(() => {
    const q = reportSearch.trim().toLowerCase();
    return handovers.filter((h) => {
      if (reportFromDate && h.date < reportFromDate) return false;
      if (reportToDate && h.date > reportToDate) return false;
      if (reportShift !== 'ALL' && h.shift !== reportShift) return false;
      if (q) {
        const hit =
          h.inCharge.toLowerCase().includes(q) ||
          (h.breakdownNotes || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [handovers, reportFromDate, reportToDate, reportShift, reportSearch]);

  const handleSaveManualQc = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingQc(true);
    try {
      const rec: SopQcRecord = {
        id: `QC-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
        date: qDate,
        shift: qShift,
        time: qTime,
        qcNo: qNo.trim() || undefined,
        machine: qMachine,
        product: qProduct,
        pph: qPph ? Number(qPph) : '',
        kgsPerHr: qKgsHr ? Number(qKgsHr) : '',
        od: qOd || '',
        idMm: qIdMm || '',
        dropBend: qDropBend,
        fitting: qFitting,
        color: qColor,
        reporter: currentUserName,
        source: 'MANUAL',
        loggedBy: currentUserName,
        upd: Date.now(),
      };
      await saveSopQcToFirebase(rec);
      setQPph('');
      setQKgsHr('');
      setQOd('');
      setQIdMm('');
      showMsg(`QC Check saved to background vault (${rec.machine} — ${rec.product}).`);
    } finally {
      setSavingQc(false);
    }
  };

  const handleParseQcWa = () => {
    if (!qWaText.trim()) {
      showMsg('Paste WhatsApp QC report message first.', true);
      return;
    }
    const parsed = parseQcWhatsAppText(qWaText, machines);
    setQParsedRows(parsed);
    showMsg(
      parsed.length > 0
        ? `Parsed ${parsed.length} QC record(s) from WhatsApp. Review or Phase directly to Background.`
        : 'No QC checks detected — check message formatting (Field: Value).'
    );
  };

  const persistParsedQcRows = async (rowsToSave: ParsedWhatsAppQcRow[]) => {
    if (rowsToSave.length === 0) return;
    setSavingQc(true);
    try {
      for (const r of rowsToSave) {
        const rec: SopQcRecord = {
          id: `QC-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`,
          date: r.date,
          shift: r.shift,
          qcNo: r.qcNo || undefined,
          machine: r.machine || qMachine,
          product: r.product || qProduct,
          pph: r.pph,
          pphUnit: r.pphUnit || undefined,
          kgsPerHr: r.kgsPerHr,
          weightType: r.weightType || undefined,
          weightKg: r.weightKg,
          printing: r.printing || undefined,
          lengthM: r.lengthM,
          socketSize: r.socketSize || undefined,
          dropBend: r.dropBend || 'Pass',
          fitting: r.fitting || 'Pass',
          color: r.color || 'Pass',
          od: r.od,
          idMm: r.idMm,
          reporter: r.reporter || currentUserName,
          source: 'WHATSAPP_PARSER',
          loggedBy: currentUserName,
          upd: Date.now(),
        };
        await saveSopQcToFirebase(rec);
      }
      const savedN = rowsToSave.length;
      setQParsedRows([]);
      setQWaText('');
      showMsg(`Saved ${savedN} QC record(s) silently to background cloud vault.`);
    } finally {
      setSavingQc(false);
    }
  };

  const handleSaveParsedQc = () => persistParsedQcRows(qParsedRows);

  const handleParseAndPhaseQcWa = async () => {
    if (!qWaText.trim()) {
      showMsg('Paste WhatsApp QC report message first.', true);
      return;
    }
    const parsed = parseQcWhatsAppText(qWaText, machines);
    if (parsed.length === 0) {
      showMsg('No QC checks detected — check message formatting (Field: Value).', true);
      return;
    }
    await persistParsedQcRows(parsed);
  };

  const handleParseAndPhaseProdWa = async () => {
    if (!pWaText.trim()) {
      showMsg('Paste WhatsApp Production report message first.', true);
      return;
    }
    const parsed = parseProductionWhatsAppText(pWaText, machines);
    if (parsed.length === 0) {
      showMsg('No production records detected in pasted WhatsApp text.', true);
      return;
    }
    setSavingProd(true);
    try {
      let savedCount = 0;
      for (const row of parsed) {
        const rec: SopProductionRecord = {
          id: `PRD-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`,
          date: row.date,
          shift: row.shift,
          dept: row.dept || 'Extrusion',
          machine: row.machine || machines[0] || 'Extrusion Machine 1',
          operator: row.operator || pOperator,
          assistant: row.assistant || pAssistant,
          product: row.product || pProduct,
          qty: row.qty || undefined,
          unit: row.unit || 'GOOD PIECES',
          prodKg: row.prodKg || 0,
          scrapKg: row.scrapKg || 0,
          wastageCdKg: row.wastageCdKg || 0,
          reporter: row.reporter || currentUserName,
          source: 'WHATSAPP_PARSER',
          loggedBy: currentUserName,
          upd: Date.now(),
        };
        await saveSopProductionToFirebase(rec);
        savedCount++;
      }
      setPParsedRows([]);
      setPWaText('');
      showMsg(
        `Phased & saved ${savedCount} production record(s) to background vault. Scrap & Wastage now auto-link to Dispatch!`
      );
    } finally {
      setSavingProd(false);
    }
  };

  // =====================================
  // 3. SCRAP SENT (OPERATOR ASSISTANT -> RECYCLING POP-UP)
  // =====================================
  const [sDate, setSDate] = useState(todayIso);
  const [sTime, setSTime] = useState(timeNow);
  const [sShift, setSShift] = useState<'Day' | 'Night'>(shiftNow.shift);
  const [sInCharge, setSInCharge] = useState(SHIFT_IN_CHARGE_OPTIONS[0]?.value || 'ERIC NYAMAPANDA');
  const [sMachine, setSMachine] = useState(machines[0] || 'Extrusion Machine 1');
  const [sProductSearch, setSProductSearch] = useState('');
  const [sProduct, setSProduct] = useState(MASTER_JOB_CARDS[0] || '');
  const [sSentBy, setSSentBy] = useState(GENERAL_HAND_OPTIONS[0]?.value || FLOOR_PRODUCTION_TEAM_OPTIONS[0]?.value || '');
  const [sIsCasual, setSIsCasual] = useState(false);
  const [sCasualName, setSCasualName] = useState('');
  const [sScrapKg, setSScrapKg] = useState('');
  const [sReason, setSReason] = useState(SCRAP_REASONS[0]);
  const [sRecycler, setSRecycler] = useState(RECYCLING_OPTIONS[0]?.value || 'TINAYE ZHOU');
  const [savingScrap, setSavingScrap] = useState(false);

  const filteredScrapCards = useMemo(
    () => MASTER_JOB_CARDS.filter((c) => c.toLowerCase().includes(sProductSearch.toLowerCase())),
    [sProductSearch]
  );

  const handleLogScrapSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const kg = Number(sScrapKg);
    const finalSender = sIsCasual ? sCasualName.trim() : sSentBy;
    if (!kg || kg <= 0 || !finalSender) {
      showMsg('Enter valid Scrap Weight (kg) and Assistant / Sender Name.', true);
      return;
    }
    setSavingScrap(true);
    try {
      const rec: SopScrapRecord = {
        id: `SCR-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
        date: sDate,
        time: sTime,
        shift: sShift,
        shiftInCharge: sInCharge,
        machine: sMachine,
        product: sProduct,
        sentByAssistant: finalSender,
        isCasualAssistant: sIsCasual,
        scrapKg: kg,
        scrapReason: sReason,
        assignedRecycler: sRecycler,
        sentAt: new Date().toISOString(),
        sentByEmail: currentUserEmail,
        status: 'SENT_TO_RECYCLING',
        upd: Date.now(),
      };
      const res = await saveSopScrapToFirebase(rec);
      setSScrapKg('');
      setSCasualName('');
      showMsg(
        res.ok
          ? `Scrap Handover ${rec.id} (${rec.scrapKg} kg) logged & Pop-up Message sent to Recycling Team!`
          : `Scrap handover saved locally; cloud sync queued (${res.error || 'offline'}).`
      );
    } finally {
      setSavingScrap(false);
    }
  };

  // =====================================
  // 4. RECYCLING TEAM RECEIVE & PROCESS -> MIXER POP-UP
  // =====================================
  const pendingReceiveList = useMemo(
    () => scrapPipeline.filter((s) => s.status === 'SENT_TO_RECYCLING'),
    [scrapPipeline]
  );
  const pendingProcessList = useMemo(
    () =>
      scrapPipeline.filter(
        (s) => s.status === 'SENT_TO_RECYCLING' || s.status === 'RECEIVED_BY_RECYCLING'
      ),
    [scrapPipeline]
  );

  const [rSelectedId, setRSelectedId] = useState<string>('');
  const [rReceivedBy, setRReceivedBy] = useState(RECYCLING_OPTIONS[0]?.value || 'TINAYE ZHOU');
  const [rReceivedKg, setRReceivedKg] = useState('');
  const [rCondition, setRCondition] = useState(SCRAP_CONDITIONS[0]);
  const [rUsableKg, setRUsableKg] = useState('');
  const [rWasteKg, setRWasteKg] = useState('');
  const [rNotes, setRNotes] = useState('');
  const [savingRecycle, setSavingRecycle] = useState(false);

  const activeRecycleRecord = useMemo(() => {
    if (rSelectedId) {
      const found = pendingProcessList.find((x) => x.id === rSelectedId);
      if (found) return found;
    }
    return pendingProcessList[0] || null;
  }, [pendingProcessList, rSelectedId]);

  useEffect(() => {
    if (activeRecycleRecord) {
      setRReceivedKg(String(activeRecycleRecord.receivedKg ?? activeRecycleRecord.scrapKg));
      setRUsableKg(
        String(
          activeRecycleRecord.usableMaterialKg ??
            activeRecycleRecord.receivedKg ??
            activeRecycleRecord.scrapKg
        )
      );
      setRWasteKg(String(activeRecycleRecord.recyclingWasteKg ?? 0));
    }
  }, [activeRecycleRecord?.id]);

  const handleConfirmRecyclingProcess = async (markProcessedNow: boolean) => {
    if (!activeRecycleRecord) return;
    const weighedKg = Number(rReceivedKg || activeRecycleRecord.receivedKg || activeRecycleRecord.scrapKg);
    if (!weighedKg || weighedKg <= 0) {
      showMsg('Enter valid Received Scrap Weight (kg).', true);
      return;
    }
    const variance = Number((activeRecycleRecord.scrapKg - weighedKg).toFixed(2));
    const diffPct =
      activeRecycleRecord.scrapKg > 0
        ? Math.abs(variance / activeRecycleRecord.scrapKg) * 100
        : 0;
    const verificationStatus: 'Verified OK' | 'Discrepancy Flagged' =
      diffPct <= 5 ? 'Verified OK' : 'Discrepancy Flagged';

    const usableNum = markProcessedNow ? Number(rUsableKg || weighedKg) : undefined;
    const wasteNum = markProcessedNow
      ? Number(rWasteKg !== '' ? rWasteKg : Math.max(0, weighedKg - (usableNum || 0)).toFixed(2))
      : undefined;

    if (markProcessedNow && (!usableNum || usableNum <= 0)) {
      showMsg('Enter valid Usable Material Output (kg) before alerting Mixers.', true);
      return;
    }

    setSavingRecycle(true);
    try {
      const nowIso = new Date().toISOString();
      const updated: SopScrapRecord = {
        ...activeRecycleRecord,
        receivedBy: rReceivedBy,
        receivedAt: activeRecycleRecord.receivedAt || nowIso,
        receivedKg: weighedKg,
        condition: rCondition,
        varianceKg: variance,
        verificationStatus,
        usableMaterialKg: usableNum,
        recyclingWasteKg: wasteNum,
        processedBy: markProcessedNow ? rReceivedBy : activeRecycleRecord.processedBy,
        processedAt: markProcessedNow ? nowIso : activeRecycleRecord.processedAt,
        processingNotes: rNotes.trim() || undefined,
        status: markProcessedNow ? 'PROCESSED_FOR_MIXER' : 'RECEIVED_BY_RECYCLING',
        upd: Date.now(),
      };
      await saveSopScrapToFirebase(updated);
      setRSelectedId('');
      setRNotes('');
      showMsg(
        markProcessedNow
          ? `Scrap ${updated.id} processed (${usableNum} kg usable material)! Pop-up Alert sent to Mixers!`
          : `Receipt verified for ${updated.id} (${verificationStatus}). Confirm processing when ready for Mixers.`
      );
    } finally {
      setSavingRecycle(false);
    }
  };

  // =====================================
  // 5. MIXING REPORT (MIXER -> PRODUCTION HOD POP-UP)
  // =====================================
  const readyForMixerScrap = useMemo(
    () => scrapPipeline.filter((s) => s.status === 'PROCESSED_FOR_MIXER'),
    [scrapPipeline]
  );
  const pendingHodMixingList = useMemo(
    () => mixingReports.filter((m) => m.status === 'PENDING_HOD'),
    [mixingReports]
  );

  const [mSelectedScrapIds, setMSelectedScrapIds] = useState<string[]>([]);
  const [mDate, setMDate] = useState(todayIso);
  const [mTime, setMTime] = useState(timeNow);
  const [mShift, setMShift] = useState<'Day' | 'Night'>(shiftNow.shift);
  const [mMachine, setMMachine] = useState(mixerMachines[0] || 'Mixer Machine 1');
  const [mMixerName, setMMixerName] = useState(MIXING_OPTIONS[0]?.value || currentUserName);
  const [mAssistant, setMAssistant] = useState(MIXING_OPTIONS[1]?.value || MIXING_OPTIONS[0]?.value || '');
  const [mWhReservedKg, setMWhReservedKg] = useState('');
  const [mScrapReceivedKg, setMScrapReceivedKg] = useState('');
  const [mWhUsedKg, setMWhUsedKg] = useState('');
  const [mScrapUsedKg, setMScrapUsedKg] = useState('');
  const [mSweepingKg, setMSweepingKg] = useState('');
  const [mBatchesMixed, setMBatchesMixed] = useState('');
  const [mPendingMix, setMPendingMix] = useState('');
  const [mRatio, setMRatio] = useState('');
  const [mMixTime, setMMixTime] = useState('');
  const [mSpeedRpm, setMSpeedRpm] = useState('');
  const [mMixTemp, setMMixTemp] = useState('');
  const [mCoolerTime, setMCoolerTime] = useState('');
  const [mCoolerRelease, setMCoolerRelease] = useState('');
  const [mHotRelease, setMHotRelease] = useState('');
  const [mNotes, setMNotes] = useState('');
  const [hodMixNotes, setHodMixNotes] = useState('');
  const [savingMix, setSavingMix] = useState(false);

  const toggleSelectScrapForMixer = (id: string) => {
    setMSelectedScrapIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      const totalSelectedKg = readyForMixerScrap
        .filter((s) => next.includes(s.id))
        .reduce((acc, s) => acc + (s.usableMaterialKg ?? s.receivedKg ?? s.scrapKg), 0);
      setMScrapReceivedKg(String(Number(totalSelectedKg.toFixed(2))));
      return next;
    });
  };

  const calculatedEndStockKg = useMemo(() => {
    const resWh = Number(mWhReservedKg || 0);
    const usedWh = Number(mWhUsedKg || 0);
    return Number(Math.max(0, resWh - usedWh).toFixed(2));
  }, [mWhReservedKg, mWhUsedKg]);

  const handleSubmitMixingReport = async (e: React.FormEvent) => {
    e.preventDefault();
    const whReserved = Number(mWhReservedKg || 0);
    const scrapRecv = Number(mScrapReceivedKg || 0);
    const whUsed = Number(mWhUsedKg || 0);
    const scrapUsed = Number(mScrapUsedKg || 0);
    const sweeping = Number(mSweepingKg || 0);
    const batches = Number(mBatchesMixed || 0);
    const pending = Number(mPendingMix || 0);

    if (whReserved < 0 || whUsed < 0 || batches <= 0) {
      showMsg('Enter valid Batches Mixed (> 0) and WH Reserved / Used quantities.', true);
      return;
    }

    setSavingMix(true);
    try {
      const reportId = `MIX-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
      const report: SopMixingReport = {
        id: reportId,
        date: mDate,
        time: mTime,
        shift: mShift,
        machine: mMachine,
        mixerName: mMixerName,
        assistantName: mAssistant,
        linkedScrapIds: mSelectedScrapIds,
        scrapReceivedFromRecyclingKg: scrapRecv,
        whReservedMaterialKg: whReserved,
        whMaterialUsedKg: whUsed,
        scrapUsedInMixingKg: scrapUsed,
        sweepingMaterialKg: sweeping,
        batchesMixed: batches,
        pendingMix: pending,
        endOfMixingStockKg: calculatedEndStockKg,
        ratio: mRatio.trim() || undefined,
        mixTimeMin: mMixTime ? Number(mMixTime) : undefined,
        speedRpm: mSpeedRpm ? Number(mSpeedRpm) : undefined,
        mixTempC: mMixTemp ? Number(mMixTemp) : undefined,
        coolerTimeMin: mCoolerTime ? Number(mCoolerTime) : undefined,
        coolerReleaseTempC: mCoolerRelease ? Number(mCoolerRelease) : undefined,
        hotReleaseTempC: mHotRelease ? Number(mHotRelease) : undefined,
        notes: mNotes.trim() || undefined,
        status: 'PENDING_HOD',
        loggedByEmail: currentUserEmail,
        submittedAt: new Date().toISOString(),
        upd: Date.now(),
      };

      await saveSopMixingToFirebase(report);

      // Update any selected PROCESSED_FOR_MIXER scrap batches -> RECEIVED_BY_MIXER
      for (const sid of mSelectedScrapIds) {
        const sObj = scrapPipeline.find((x) => x.id === sid);
        if (sObj) {
          await saveSopScrapToFirebase({
            ...sObj,
            receivedByMixerName: mMixerName,
            mixerMachine: mMachine,
            mixerReceivedAt: new Date().toISOString(),
            mixingReportId: reportId,
            status: 'RECEIVED_BY_MIXER',
            upd: Date.now(),
          });
        }
      }

      setMSelectedScrapIds([]);
      setMWhUsedKg('');
      setMScrapUsedKg('');
      setMSweepingKg('');
      setMBatchesMixed('');
      setMPendingMix('');
      setMNotes('');
      showMsg(
        `Mixing Report ${reportId} saved! Pop-up sent to Production HOD (Scrap Recvd: ${scrapRecv} kg, Scrap Used: ${scrapUsed} kg, Sweeping: ${sweeping} kg, End WH Stock: ${calculatedEndStockKg} kg).`
      );
    } finally {
      setSavingMix(false);
    }
  };

  const handleHodConfirmMixing = async (report: SopMixingReport) => {
    if (!isAdmin && !permissions.dispatchHODConfirm) return;
    setSavingMix(true);
    try {
      await saveSopMixingToFirebase({
        ...report,
        status: 'HOD_CONFIRMED',
        hodConfirmedBy: currentUserName,
        hodConfirmedAt: new Date().toISOString(),
        hodNotes: hodMixNotes.trim() || undefined,
        upd: Date.now(),
      });
      setHodMixNotes('');
      showMsg(`Production HOD confirmed Mixing Report ${report.id} (${report.batchesMixed} batches, End Stock: ${report.endOfMixingStockKg} kg).`);
    } finally {
      setSavingMix(false);
    }
  };

  // =====================================
  // 6. SHIFT HANDOVER
  // =====================================
  const [hDate, setHDate] = useState(todayIso);
  const [hShift, setHShift] = useState<'Day' | 'Night'>(shiftNow.shift);
  const [hInCharge, setHInCharge] = useState(SHIFT_IN_CHARGE_OPTIONS[0]?.value || 'ERIC NYAMAPANDA');
  const [hTotalProd, setHTotalProd] = useState('');
  const [hTotalScrap, setHTotalScrap] = useState('');
  const [hNotes, setHNotes] = useState('');
  const [hSilo1, setHSilo1] = useState('');
  const [hSilo2, setHSilo2] = useState('');
  const [hSilo3, setHSilo3] = useState('');
  const [hSilo4, setHSilo4] = useState('');
  const [savingHandover, setSavingHandover] = useState(false);

  const handleAutoFillHandoverTotals = () => {
    const dayProd = productionLogs.filter((p) => p.date === hDate && p.shift === hShift);
    const prodSum = dayProd.reduce((a, b) => a + (Number(b.prodKg) || 0), 0);
    const scrapSum = dayProd.reduce((a, b) => a + (Number(b.scrapKg) || 0), 0);
    setHTotalProd(String(Number(prodSum.toFixed(1))));
    setHTotalScrap(String(Number(scrapSum.toFixed(1))));
  };

  const handleSaveHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    const tp = Number(hTotalProd || 0);
    const ts = Number(hTotalScrap || 0);
    const pct = tp + ts > 0 ? Number(((ts / (tp + ts)) * 100).toFixed(1)) : 0;
    setSavingHandover(true);
    try {
      await saveSopHandoverToFirebase({
        id: `HOV-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
        date: hDate,
        shift: hShift,
        inCharge: hInCharge,
        totalProdKg: tp,
        totalScrapKg: ts,
        scrapPct: pct,
        breakdownNotes: hNotes.trim() || 'No major breakdowns reported',
        silo1Kg: Number(hSilo1 || 0),
        silo2Kg: Number(hSilo2 || 0),
        silo3Kg: Number(hSilo3 || 0),
        silo4Kg: Number(hSilo4 || 0),
        loggedBy: currentUserName,
        upd: Date.now(),
      });
      setHNotes('');
      showMsg(`Shift Handover logged (${hDate} ${hShift} Shift).`);
    } finally {
      setSavingHandover(false);
    }
  };

  // =====================================
  // KPI & PARETO CALCULATIONS (RESPECTS ACTIVE REPORT FILTERS)
  // =====================================
  const floorKpis = useMemo(() => {
    const totalProd = filteredProductionLogs.reduce((a, b) => a + (Number(b.prodKg) || 0), 0);
    const totalScrap = filteredProductionLogs.reduce((a, b) => a + (Number(b.scrapKg) || 0), 0);
    const totalWastage = filteredProductionLogs.reduce((a, b) => a + (Number(b.wastageCdKg) || 0), 0);
    const scrapPct = totalProd + totalScrap > 0 ? (totalScrap / (totalProd + totalScrap)) * 100 : 0;

    let passCount = 0;
    let totalTests = 0;
    filteredQcChecks.forEach((q) => {
      [q.dropBend, q.fitting, q.color].forEach((val) => {
        if (val === 'Pass' || val === 'Fail') {
          totalTests++;
          if (val === 'Pass') passCount++;
        }
      });
    });
    const qcPassRate = totalTests > 0 ? (passCount / totalTests) * 100 : 100;

    // Combine SOP Production Breakdown minutes + Live Plant Downtime Logger incidents
    const reasonTotals: Record<string, number> = {};
    let totalDowntimeMin = 0;
    const toMins = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      return h * 60 + m;
    };
    filteredProductionLogs.forEach((p) => {
      if (p.bdStart && p.bdEnd) {
        const s = toMins(p.bdStart);
        const e = toMins(p.bdEnd);
        if (s !== null && e !== null && e > s) {
          const diff = e - s;
          totalDowntimeMin += diff;
          const r = p.bdReason || 'Production Breakdown';
          reasonTotals[r] = (reasonTotals[r] || 0) + diff;
        }
      }
    });
    downtimeEntries
      .filter((d) => {
        if (d.del || !d.start) return false;
        const dDate = ymd(new Date(d.start));
        if (reportFromDate && dDate < reportFromDate) return false;
        if (reportToDate && dDate > reportToDate) return false;
        if (reportMachine !== 'ALL' && d.m !== reportMachine) return false;
        return true;
      })
      .slice(0, 300)
      .forEach((d) => {
        if (d.end) {
          const ms = new Date(d.end).getTime() - new Date(d.start).getTime();
          if (ms > 0) {
            const mins = Math.round(ms / 60000);
            totalDowntimeMin += mins;
            const label = d.cat || 'Downtime';
            reasonTotals[label] = (reasonTotals[label] || 0) + mins;
          }
        }
      });

    const pareto = Object.entries(reasonTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const latestMix = filteredMixingReports[0];
    return {
      totalProd,
      totalScrap,
      totalWastage,
      scrapPct,
      qcPassRate,
      downtimeHours: totalDowntimeMin / 60,
      pareto,
      latestEndStockKg: latestMix?.endOfMixingStockKg ?? 0,
      totalSweepingKg: filteredMixingReports.reduce((a, b) => a + (b.sweepingMaterialKg || 0), 0),
    };
  }, [
    filteredProductionLogs,
    filteredQcChecks,
    downtimeEntries,
    filteredMixingReports,
    reportFromDate,
    reportToDate,
    reportMachine,
  ]);

  if (allowedSubTabs.length === 0) {
    return (
      <div className="rounded-2xl border border-rose-500/40 bg-slate-900/90 p-8 text-center space-y-2">
        <Lock className="h-10 w-10 text-rose-400 mx-auto" />
        <h3 className="text-base font-bold text-white">SOP Floor Modules Restricted</h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Your role does not have SOP Digital Floor modules enabled. Contact the Plant Administrator.
        </p>
      </div>
    );
  }

  const subTabMeta: { id: SopSubTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'overview', label: 'Floor Dashboard', icon: <Activity className="h-3.5 w-3.5" /> },
    { id: 'production', label: 'Production & WA Parser', icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
    { id: 'qc', label: 'QC Check & WA Parser', icon: <Sparkles className="h-3.5 w-3.5" /> },
    { id: 'scrap_send', label: 'Scrap Sent (Operators)', icon: <Send className="h-3.5 w-3.5" /> },
    {
      id: 'recycling',
      label: 'Recycling Team',
      icon: <Recycle className="h-3.5 w-3.5" />,
      badge: pendingReceiveList.length,
    },
    {
      id: 'mixing',
      label: 'Mixing & WH Stock',
      icon: <FlaskConical className="h-3.5 w-3.5" />,
      badge: readyForMixerScrap.length + ((isAdmin || permissions.dispatchHODConfirm) ? pendingHodMixingList.length : 0),
    },
    { id: 'handover', label: 'Shift Handover', icon: <Layers className="h-3.5 w-3.5" /> },
  ];

  const renderAdminExcelBtn = (onClick: () => void, label: string) =>
    isAdmin ? (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-black text-white shadow transition"
      >
        <Download className="h-3.5 w-3.5" />
        <span>{label}</span>
      </button>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-[11px] font-bold text-slate-400">
        <Lock className="h-3.5 w-3.5 text-rose-400" />
        <span>Excel Download: Admin Only</span>
      </span>
    );

  const renderReportFilterBar = (opts: {
    includeMachine?: boolean;
    placeholder?: string;
  }) => (
    <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-3 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-sky-300">
          <Filter className="h-3.5 w-3.5" />
          <span>Report Filter (Applies to View &amp; Excel Download)</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              ['all', 'All History'],
              ['today', 'Today'],
              ['7days', 'Last 7 Days'],
              ['30days', 'Last 30 Days'],
              ['thisMonth', 'This Month'],
              ['lastMonth', 'Last Month'],
            ] as const
          ).map(([presetKey, presetLabel]) => (
            <button
              key={presetKey}
              type="button"
              onClick={() => applyReportPreset(presetKey)}
              className={`rounded-lg border px-2 py-1 text-[10px] font-bold transition ${
                presetKey === 'all' && !reportFromDate && !reportToDate
                  ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {presetLabel}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`grid grid-cols-1 sm:grid-cols-2 ${
          opts.includeMachine ? 'lg:grid-cols-5' : 'lg:grid-cols-4'
        } gap-2`}
      >
        <div>
          <label className="block text-[10px] font-bold text-slate-400 mb-0.5">From Date</label>
          <input
            type="date"
            value={reportFromDate}
            onChange={(e) => setReportFromDate(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 mb-0.5">To Date</label>
          <input
            type="date"
            value={reportToDate}
            onChange={(e) => setReportToDate(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 mb-0.5">Shift</label>
          <select
            value={reportShift}
            onChange={(e) => setReportShift(e.target.value as 'ALL' | 'Day' | 'Night')}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
          >
            <option value="ALL">All Shifts</option>
            <option value="Day">Day Shift</option>
            <option value="Night">Night Shift</option>
          </select>
        </div>
        {opts.includeMachine && (
          <div>
            <label className="block text-[10px] font-bold text-slate-400 mb-0.5">Machine</label>
            <select
              value={reportMachine}
              onChange={(e) => setReportMachine(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
            >
              <option value="ALL">All Machines</option>
              {machines.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-[10px] font-bold text-slate-400 mb-0.5">
            Search Product / Staff
          </label>
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-2" />
            <input
              type="text"
              placeholder={opts.placeholder || 'Filter keyword...'}
              value={reportSearch}
              onChange={(e) => setReportSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 pl-7 pr-2.5 py-1.5 text-xs text-white placeholder:text-slate-600"
            />
          </div>
        </div>
      </div>
    </div>
  );

  const headerCopyByTab: Record<SopSubTab, { title: string; subtitle: string }> = {
    overview: {
      title: 'LGPLAST SOP Floor Dashboard',
      subtitle:
        'Live Floor KPIs • Reject Rate • Downtime Pareto & End-of-Mixing WH Stock Balance',
    },
    production: {
      title: 'LGPLAST Production Logger APK',
      subtitle:
        'Job Card Entry & Embedded WhatsApp Parser (Auto-Links Scrap & Wastage to Dispatch)',
    },
    qc: {
      title: 'LGPLAST QC Check APK',
      subtitle:
        'Quality Control Inspection Log & Embedded WhatsApp QC Report Parser',
    },
    scrap_send: {
      title: 'LGPLAST Scrap Handover APK (Operators → Recycling)',
      subtitle:
        'Operator Assistant logs scrap handover to trigger instant Recycling Team pop-up alerts',
    },
    recycling: {
      title: 'LGPLAST Recycling Team APK (Verify & Process Regrind)',
      subtitle:
        'Verify incoming scrap weight & mark All Processed into Usable Material to alert Mixers',
    },
    mixing: {
      title: 'LGPLAST Mixing & WH Stock APK (Mixer → Production HOD)',
      subtitle:
        'Log WH Reserved Stock, Recycled Scrap Used, Sweeping, Batches & End Stock (Alerts HOD)',
    },
    handover: {
      title: 'LGPLAST Shift Handover APK',
      subtitle:
        'Digital Supervisor Shift Handover Sign-Off using unified plant staff & machine dropdowns',
    },
  };
  const currentHeader = headerCopyByTab[activeSubTab];

  return (
    <div className="space-y-4">
      {/* Header & Integrated Module Navigation */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-5 shadow-lg">
        <div
          className={`flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
            !standaloneMode && !forcedSubTab ? 'pb-3 border-b border-slate-800' : ''
          }`}
        >
          <div className="flex items-center gap-3">
            <LgplastLogo size="sm" showSubtitle={false} />
            <div>
              <h2 className="text-lg font-black text-white">
                {standaloneMode || forcedSubTab
                  ? currentHeader.title
                  : 'LGPLAST Integrated SOP Floor APK'}
              </h2>
              <p className="text-xs text-slate-400">
                {standaloneMode || forcedSubTab
                  ? currentHeader.subtitle
                  : 'Production Job Cards (Linked to Dispatch) • QC Checks • Closed-Loop Scrap → Recycling → Mixing → Production HOD • Shift Handover'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold tabular-nums">
            <span className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-300">
              Awaiting Recycling: {pendingReceiveList.length}
            </span>
            <span className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-sky-300">
              Ready for Mixer: {readyForMixerScrap.length}
            </span>
            <span className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
              HOD Pending Mix: {pendingHodMixingList.length}
            </span>
          </div>
        </div>

        {!standaloneMode && !forcedSubTab && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {subTabMeta
              .filter((t) => allowedSubTabs.includes(t.id))
              .map((tab) => {
                const active = activeSubTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setInternalSubTab(tab.id);
                      setBanner(null);
                    }}
                    className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                      active
                        ? 'bg-[#00aeef] text-slate-950 shadow-md'
                        : 'border border-slate-700 bg-slate-950 text-slate-300 hover:text-white'
                    }`}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                    {typeof tab.badge === 'number' && tab.badge > 0 && (
                      <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white">
                        {tab.badge}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        )}
      </div>

      {banner && (
        <div
          className={`flex items-center justify-between gap-2 rounded-xl border p-3 text-xs font-semibold ${
            banner.isError
              ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
              : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {banner.isError ? (
              <AlertCircle className="h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            )}
            <span>{banner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-[11px] opacity-75 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ================================================= */}
      {/* TAB 1: FLOOR DASHBOARD & KPI OVERVIEW             */}
      {/* ================================================= */}
      {activeSubTab === 'overview' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">
                  Floor KPIs, Scrap Pipeline &amp; WH Material Balance
                </h3>
                <p className="text-xs text-slate-400">
                  Real-time figures calculated from filtered Production, QC, Recycling, Mixing &amp; Downtime logs.
                </p>
              </div>
              {renderAdminExcelBtn(
                () =>
                  exportSopMasterWorkbook({
                    production: filteredProductionLogs,
                    qcChecks: filteredQcChecks,
                    scrapPipeline: filteredScrapPipeline,
                    mixingReports: filteredMixingReports,
                    handovers: filteredHandovers,
                  }),
                `Download Filtered Master SOP Excel (.xlsx)`
              )}
            </div>

            {renderReportFilterBar({
              includeMachine: true,
              placeholder: 'Filter product, operator, mixer...',
            })}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 tabular-nums">
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <div className="text-[10px] font-bold uppercase text-slate-400">
                  Total Production Output
                </div>
                <div className="text-2xl font-black text-white mt-1">
                  {floorKpis.totalProd.toLocaleString()} kg
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {filteredProductionLogs.length} matching logs
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <div className="text-[10px] font-bold uppercase text-slate-400">
                  Scrap Rate (Scrap + Wastage)
                </div>
                <div
                  className={`text-2xl font-black mt-1 ${
                    floorKpis.scrapPct > 5 ? 'text-rose-400' : 'text-amber-300'
                  }`}
                >
                  {floorKpis.scrapPct.toFixed(1)}%
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Scrap: {floorKpis.totalScrap} kg • CD: {floorKpis.totalWastage} kg
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <div className="text-[10px] font-bold uppercase text-slate-400">
                  QC Pass Rate
                </div>
                <div
                  className={`text-2xl font-black mt-1 ${
                    floorKpis.qcPassRate < 95 ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {floorKpis.qcPassRate.toFixed(1)}%
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Across {filteredQcChecks.length} QC checks
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <div className="text-[10px] font-bold uppercase text-slate-400">
                  End-of-Mixing WH Stock Balance
                </div>
                <div className="text-2xl font-black text-sky-300 mt-1">
                  {floorKpis.latestEndStockKg} kg
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Total Sweeping: {floorKpis.totalSweepingKg.toFixed(1)} kg
                </div>
              </div>
            </div>

            {/* Top Downtime Reasons Pareto */}
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2.5">
              <div className="text-xs font-black uppercase tracking-wider text-slate-300">
                Top Downtime Reasons (Pareto — Production &amp; Downtime Logs)
              </div>
              {floorKpis.pareto.length === 0 ? (
                <div className="text-xs text-slate-500">No downtime incidents recorded yet.</div>
              ) : (
                <div className="space-y-2 tabular-nums">
                  {floorKpis.pareto.map(([reason, mins]) => {
                    const max = floorKpis.pareto[0][1] || 1;
                    const pct = Math.round((mins / max) * 100);
                    return (
                      <div key={reason} className="flex items-center gap-3 text-xs">
                        <div className="w-40 shrink-0 text-slate-300 truncate font-medium">
                          {reason}
                        </div>
                        <div className="flex-1 h-3 rounded bg-slate-900 overflow-hidden">
                          <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="w-20 text-right font-mono font-bold text-slate-200">
                          {mins} min
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================= */}
      {/* TAB 2: PRODUCTION JOB CARD + WHATSAPP PARSER      */}
      {/* ================================================= */}
      {activeSubTab === 'production' && (
        <div className="space-y-4">
          {/* Embedded WhatsApp Production Parser */}
          <div className="rounded-2xl border border-sky-500/35 bg-slate-900/95 p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <div>
                <h3 className="text-sm font-black text-white flex items-center gap-2">
                  <MessageSquareText className="h-4 w-4 text-sky-400" />
                  <span>WhatsApp Production Report Parser (Feeds Dispatch Scrap &amp; Wastage)</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Paste WhatsApp shift production reports. Misspelled headers, IM/LINE machine names, units, Scrap, and Cut Dust (CD) are extracted automatically and saved to background logs.
                </p>
              </div>
            </div>

            <textarea
              rows={4}
              value={pWaText}
              onChange={(e) => setPWaText(e.target.value)}
              placeholder="Paste WhatsApp shift production report here (e.g. NIGHT SHIFT (15/11/2026), EXTRUSION, Operator: ..., LINE 01, 450 BUNDLES, SCRAP 18, CD 4)..."
              className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white placeholder:text-slate-600 focus:border-sky-400 focus:outline-none"
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={savingProd}
                onClick={handleParseAndPhaseProdWa}
                className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-black text-white transition disabled:opacity-50"
              >
                {savingProd ? 'Saving...' : 'Parse & Phase Directly to Background'}
              </button>
              <button
                type="button"
                onClick={handleParseProdWa}
                className="rounded-xl bg-sky-500 hover:bg-sky-400 px-4 py-2 text-xs font-black text-slate-950 transition"
              >
                Preview Parsed Lines
              </button>
              {pParsedRows.length > 0 && (
                <button
                  type="button"
                  disabled={savingProd}
                  onClick={handleSaveParsedProdToBackground}
                  className="rounded-xl bg-amber-500 hover:bg-amber-400 px-4 py-2 text-xs font-black text-slate-950 transition disabled:opacity-50"
                >
                  {savingProd
                    ? 'Saving to Cloud...'
                    : `Save ${pParsedRows.length} Previewed Line(s) to Background`}
                </button>
              )}
              {pWaText && (
                <button
                  type="button"
                  onClick={() => {
                    setPWaText('');
                    setPParsedRows([]);
                  }}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300"
                >
                  Clear
                </button>
              )}
            </div>

            {pParsedRows.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
                <table className="w-full text-left text-[11px] tabular-nums">
                  <thead className="bg-slate-900 text-slate-400 font-black uppercase">
                    <tr>
                      <th className="p-2">Date</th>
                      <th className="p-2">Shift</th>
                      <th className="p-2">Machine</th>
                      <th className="p-2">Operator</th>
                      <th className="p-2">Assistant</th>
                      <th className="p-2">Product</th>
                      <th className="p-2 text-right">Qty</th>
                      <th className="p-2 text-right">Scrap (kg)</th>
                      <th className="p-2 text-right">Wastage/CD (kg)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {pParsedRows.map((row, idx) => (
                      <tr key={row.tempId}>
                        <td className="p-2 text-slate-200">{row.date}</td>
                        <td className="p-2 text-slate-300">{row.shift}</td>
                        <td className="p-2">
                          <select
                            value={row.machine}
                            onChange={(e) =>
                              setPParsedRows((prev) =>
                                prev.map((x, i) =>
                                  i === idx ? { ...x, machine: e.target.value } : x
                                )
                              )
                            }
                            className="rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px] text-white"
                          >
                            {machines.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                            {!machines.includes(row.machine) && row.machine && (
                              <option value={row.machine}>{row.machine}</option>
                            )}
                          </select>
                        </td>
                        <td className="p-2 text-slate-200">{row.operator}</td>
                        <td className="p-2 text-slate-300">{row.assistant}</td>
                        <td className="p-2 text-sky-300 font-semibold">{row.product}</td>
                        <td className="p-2 text-right">
                          {row.qty} {row.unit}
                        </td>
                        <td className="p-2 text-right font-bold text-rose-300">{row.scrapKg}</td>
                        <td className="p-2 text-right font-bold text-amber-300">
                          {row.wastageCdKg}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Manual Production Entry + Collapsed Background Vault */}
          <div className="space-y-4">
            <form
              onSubmit={handleSaveManualProduction}
              className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-5 space-y-3"
            >
              <h3 className="text-sm font-black text-white border-b border-slate-800 pb-2">
                New Production Job Card Entry (Saves to Background)
              </h3>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={pDate}
                    onChange={(e) => setPDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Shift</label>
                  <select
                    value={pShift}
                    onChange={(e) => setPShift(e.target.value as 'Day' | 'Night')}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="Day">Day Shift</option>
                    <option value="Night">Night Shift</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">
                    Department
                  </label>
                  <select
                    value={pDept}
                    onChange={(e) => setPDept(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="Extrusion">Extrusion</option>
                    <option value="Injection">Injection</option>
                    <option value="Mixing">Mixing</option>
                    <option value="Maintenance">Maintenance</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">
                    Machine
                  </label>
                  <select
                    value={pMachine}
                    onChange={(e) => setPMachine(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  >
                    {machines.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-bold text-slate-400">
                    Product (Master Job Cards)
                  </label>
                  <input
                    type="text"
                    placeholder="Filter..."
                    value={pProductSearch}
                    onChange={(e) => {
                      const q = e.target.value;
                      setPProductSearch(q);
                      const m = MASTER_JOB_CARDS.find((c) =>
                        c.toLowerCase().includes(q.toLowerCase())
                      );
                      if (m) setPProduct(m);
                    }}
                    className="w-28 rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] text-white"
                  />
                </div>
                <select
                  value={pProduct}
                  onChange={(e) => setPProduct(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                >
                  {(filteredProdCards.length ? filteredProdCards : MASTER_JOB_CARDS).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">Operator</label>
                <select
                  value={pOperator}
                  onChange={(e) => setPOperator(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                >
                  {OPERATOR_OPTIONS.map((op) => (
                    <option key={op.label} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-bold text-slate-400">
                    Operator Assistant
                  </label>
                  <label className="flex items-center gap-1 text-[10px] text-amber-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pIsCasual}
                      onChange={(e) => setPIsCasual(e.target.checked)}
                    />
                    <span>Casual</span>
                  </label>
                </div>
                {pIsCasual ? (
                  <input
                    type="text"
                    placeholder="Enter casual assistant name..."
                    value={pCasualName}
                    onChange={(e) => setPCasualName(e.target.value)}
                    className="w-full rounded-xl border border-amber-500/40 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  />
                ) : (
                  <select
                    value={pAssistant}
                    onChange={(e) => setPAssistant(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  >
                    {GENERAL_HAND_OPTIONS.map((gh) => (
                      <option key={gh.label} value={gh.value}>
                        {gh.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Qty</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={pQty}
                    onChange={(e) => setPQty(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Unit</label>
                  <select
                    value={pUnit}
                    onChange={(e) => setPUnit(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  >
                    <option value="GOOD PIECES">GOOD PIECES</option>
                    <option value="BAGS">BAGS</option>
                    <option value="BUNDLES">BUNDLES</option>
                    <option value="PIPES">PIPES</option>
                    <option value="KG">KG</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">
                    Prod (kg)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={pProdKg}
                    onChange={(e) => setPProdKg(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[10px] font-bold text-rose-300 mb-1">
                    Scrap (kg) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={pScrapKg}
                    onChange={(e) => setPScrapKg(e.target.value)}
                    className="w-full rounded-xl border border-rose-500/40 bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-rose-300 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-amber-300 mb-1">
                    Wastage / CD (kg) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={pWastageKg}
                    onChange={(e) => setPWastageKg(e.target.value)}
                    className="w-full rounded-xl border border-amber-500/40 bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-amber-300 tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">
                    Scrap Reason
                  </label>
                  <select
                    value={pScrapReason}
                    onChange={(e) => setPScrapReason(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  >
                    {SCRAP_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">
                    Mtnce Tech
                  </label>
                  <select
                    value={pMtnce}
                    onChange={(e) => setPMtnce(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  >
                    <option value="">None</option>
                    {MAINTENANCE_OPTIONS.map((mt) => (
                      <option key={mt.label} value={mt.value}>
                        {mt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">BD Start</label>
                  <input
                    type="time"
                    value={pBdStart}
                    onChange={(e) => setPBdStart(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">BD End</label>
                  <input
                    type="time"
                    value={pBdEnd}
                    onChange={(e) => setPBdEnd(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">BD Reason</label>
                  <select
                    value={pBdReason}
                    onChange={(e) => setPBdReason(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                  >
                    {BREAKDOWN_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={savingProd}
                className="w-full rounded-xl bg-amber-500 hover:bg-amber-400 py-2.5 text-xs font-black text-slate-950 shadow transition disabled:opacity-50"
              >
                {savingProd ? 'Saving to Background...' : 'Log Production Job Card'}
              </button>
            </form>

            {/* Background Production Records Vault (Collapsed by Default) */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Database className="h-4 w-4 text-sky-400 shrink-0" />
                  <div>
                    <span className="text-xs font-black uppercase tracking-wider text-slate-200 block">
                      Background Production Records Vault ({filteredProductionLogs.length} matching · {productionLogs.length} total stored)
                    </span>
                    <span className="text-[11px] text-slate-400">
                      All logged &amp; parsed production records run silently in cloud background &amp; link live Scrap/Wastage to Dispatch.
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {renderAdminExcelBtn(
                    () => exportSopProductionExcel(filteredProductionLogs),
                    `Download Production Excel (${filteredProductionLogs.length})`
                  )}
                  <button
                    type="button"
                    onClick={() => setShowProdBackgroundRecords((v) => !v)}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 transition"
                  >
                    <span>
                      {showProdBackgroundRecords
                        ? 'Hide Background Records'
                        : 'View Background Records'}
                    </span>
                    {showProdBackgroundRecords ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {renderReportFilterBar({
                includeMachine: true,
                placeholder: 'Product, operator, assistant...',
              })}

              {showProdBackgroundRecords && (
                <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-[540px]">
                  <table className="w-full text-left text-xs tabular-nums">
                    <thead className="bg-slate-950 text-[10px] font-black uppercase text-slate-400 sticky top-0">
                      <tr>
                        <th className="p-2.5">Date / Shift</th>
                        <th className="p-2.5">Machine</th>
                        <th className="p-2.5">Product</th>
                        <th className="p-2.5">Operator / Assistant</th>
                        <th className="p-2.5 text-right">Prod (kg)</th>
                        <th className="p-2.5 text-right">Scrap (kg)</th>
                        <th className="p-2.5 text-right">Wastage (kg)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {filteredProductionLogs.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-6 text-center text-slate-500">
                            No production records matching filter.
                          </td>
                        </tr>
                      ) : (
                        filteredProductionLogs.map((p) => (
                          <tr key={p.id} className="hover:bg-slate-800/40">
                            <td className="p-2.5 whitespace-nowrap">
                              <div className="font-bold text-slate-200">{p.date}</div>
                              <div className="text-[10px] text-slate-400">{p.shift}</div>
                            </td>
                            <td className="p-2.5 whitespace-nowrap text-slate-200">{p.machine}</td>
                            <td className="p-2.5 font-semibold text-white">{p.product}</td>
                            <td className="p-2.5">
                              <div className="text-slate-200">{p.operator}</div>
                              <div className="text-[10px] text-slate-400">{p.assistant}</div>
                            </td>
                            <td className="p-2.5 text-right font-bold text-emerald-300">
                              {p.prodKg}
                            </td>
                            <td className="p-2.5 text-right font-bold text-rose-300">{p.scrapKg}</td>
                            <td className="p-2.5 text-right font-bold text-amber-300">
                              {p.wastageCdKg}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================= */}
      {/* TAB 3: QC CHECK REPORT + WHATSAPP QC PARSER       */}
      {/* ================================================= */}
      {activeSubTab === 'qc' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-indigo-500/35 bg-slate-900/95 p-4 sm:p-5 space-y-3">
            <h3 className="text-sm font-black text-white flex items-center gap-2 border-b border-slate-800 pb-2">
              <MessageSquareText className="h-4 w-4 text-indigo-400" />
              <span>WhatsApp QC Check Report Parser</span>
            </h3>
            <textarea
              rows={4}
              value={qWaText}
              onChange={(e) => setQWaText(e.target.value)}
              placeholder="Paste WhatsApp QC Check report(s) here (Machine Number:, Product Name:, PPH:, Kgs/Hr:, Drop/Bend Test:, Fitting Test:, Uniform Colour:, O/D:, I/D:, QC Check Number:, Shift:, Reported By:)..."
              className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white placeholder:text-slate-600 focus:border-indigo-400 focus:outline-none"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={savingQc}
                onClick={handleParseAndPhaseQcWa}
                className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-black text-white transition disabled:opacity-50"
              >
                {savingQc ? 'Saving...' : 'Parse & Save Directly to Background'}
              </button>
              <button
                type="button"
                onClick={handleParseQcWa}
                className="rounded-xl bg-indigo-500 hover:bg-indigo-400 px-4 py-2 text-xs font-black text-white transition"
              >
                Preview Parsed QC
              </button>
              {qParsedRows.length > 0 && (
                <button
                  type="button"
                  disabled={savingQc}
                  onClick={handleSaveParsedQc}
                  className="rounded-xl bg-amber-500 hover:bg-amber-400 px-4 py-2 text-xs font-black text-slate-950 transition"
                >
                  Save {qParsedRows.length} Previewed QC Record(s) to Background
                </button>
              )}
              {qWaText && (
                <button
                  type="button"
                  onClick={() => {
                    setQWaText('');
                    setQParsedRows([]);
                  }}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300"
                >
                  Clear
                </button>
              )}
            </div>
            {qParsedRows.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
                <table className="w-full text-left text-[11px] tabular-nums">
                  <thead className="bg-slate-900 text-slate-400 font-black uppercase">
                    <tr>
                      <th className="p-2">Date</th>
                      <th className="p-2">Shift</th>
                      <th className="p-2">Machine</th>
                      <th className="p-2">Product</th>
                      <th className="p-2">PPH</th>
                      <th className="p-2">Drop/Bend</th>
                      <th className="p-2">Fitting</th>
                      <th className="p-2">Colour</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {qParsedRows.map((q) => (
                      <tr key={q.tempId}>
                        <td className="p-2">{q.date}</td>
                        <td className="p-2">{q.shift}</td>
                        <td className="p-2 font-bold text-white">{q.machine}</td>
                        <td className="p-2 text-sky-300">{q.product}</td>
                        <td className="p-2">{q.pph}</td>
                        <td
                          className={`p-2 font-bold ${
                            q.dropBend === 'Fail' ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                        >
                          {q.dropBend}
                        </td>
                        <td
                          className={`p-2 font-bold ${
                            q.fitting === 'Fail' ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                        >
                          {q.fitting}
                        </td>
                        <td
                          className={`p-2 font-bold ${
                            q.color === 'Fail' ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                        >
                          {q.color}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <form
              onSubmit={handleSaveManualQc}
              className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 sm:p-5 space-y-3"
            >
              <h3 className="text-sm font-black text-white border-b border-slate-800 pb-2">
                New QC Check Entry (Saves to Background)
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={qDate}
                    onChange={(e) => setQDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Shift</label>
                  <select
                    value={qShift}
                    onChange={(e) => setQShift(e.target.value as 'Day' | 'Night')}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  >
                    <option value="Day">Day</option>
                    <option value="Night">Night</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Time</label>
                  <input
                    type="time"
                    value={qTime}
                    onChange={(e) => setQTime(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Machine</label>
                  <select
                    value={qMachine}
                    onChange={(e) => setQMachine(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  >
                    {machines.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">
                    QC Check No
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. QC-04"
                    value={qNo}
                    onChange={(e) => setQNo(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-bold text-slate-400">Product</label>
                  <input
                    type="text"
                    placeholder="Filter..."
                    value={qProductSearch}
                    onChange={(e) => {
                      const q = e.target.value;
                      setQProductSearch(q);
                      const m = MASTER_JOB_CARDS.find((c) =>
                        c.toLowerCase().includes(q.toLowerCase())
                      );
                      if (m) setQProduct(m);
                    }}
                    className="w-28 rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] text-white"
                  />
                </div>
                <select
                  value={qProduct}
                  onChange={(e) => setQProduct(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                >
                  {(filteredQcCards.length ? filteredQcCards : MASTER_JOB_CARDS).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">PPH</label>
                  <input
                    type="number"
                    step="any"
                    value={qPph}
                    onChange={(e) => setQPph(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Kgs/Hr</label>
                  <input
                    type="number"
                    step="any"
                    value={qKgsHr}
                    onChange={(e) => setQKgsHr(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">O/D (mm)</label>
                  <input
                    type="text"
                    value={qOd}
                    onChange={(e) => setQOd(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">I/D (mm)</label>
                  <input
                    type="text"
                    value={qIdMm}
                    onChange={(e) => setQIdMm(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">
                    Drop/Bend
                  </label>
                  <select
                    value={qDropBend}
                    onChange={(e) => setQDropBend(e.target.value as 'Pass' | 'Fail')}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  >
                    <option value="Pass">Pass</option>
                    <option value="Fail">Fail</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Fitting</label>
                  <select
                    value={qFitting}
                    onChange={(e) => setQFitting(e.target.value as 'Pass' | 'Fail')}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  >
                    <option value="Pass">Pass</option>
                    <option value="Fail">Fail</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Colour</label>
                  <select
                    value={qColor}
                    onChange={(e) => setQColor(e.target.value as 'Pass' | 'Fail')}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  >
                    <option value="Pass">Pass</option>
                    <option value="Fail">Fail</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={savingQc}
                className="w-full rounded-xl bg-indigo-500 hover:bg-indigo-400 py-2.5 text-xs font-black text-white shadow transition"
              >
                {savingQc ? 'Saving...' : 'Log QC Check'}
              </button>
            </form>

            {/* Background QC Records Vault (Collapsed by Default) */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Database className="h-4 w-4 text-indigo-400 shrink-0" />
                  <div>
                    <span className="text-xs font-black uppercase tracking-wider text-slate-200 block">
                      Background QC Check Records Vault ({filteredQcChecks.length} matching · {qcChecks.length} total stored)
                    </span>
                    <span className="text-[11px] text-slate-400">
                      All logged &amp; parsed QC inspections are saved silently to background cloud storage.
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {renderAdminExcelBtn(
                    () => exportSopQcExcel(filteredQcChecks),
                    `Download QC Excel (${filteredQcChecks.length})`
                  )}
                  <button
                    type="button"
                    onClick={() => setShowQcBackgroundRecords((v) => !v)}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 transition"
                  >
                    <span>
                      {showQcBackgroundRecords
                        ? 'Hide Background Records'
                        : 'View Background Records'}
                    </span>
                    {showQcBackgroundRecords ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {renderReportFilterBar({
                includeMachine: true,
                placeholder: 'Product, QC No, inspector...',
              })}

              {showQcBackgroundRecords && (
                <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-[500px]">
                  <table className="w-full text-left text-xs tabular-nums">
                    <thead className="bg-slate-950 text-[10px] font-black uppercase text-slate-400 sticky top-0">
                      <tr>
                        <th className="p-2.5">Date / Shift</th>
                        <th className="p-2.5">Machine</th>
                        <th className="p-2.5">Product</th>
                        <th className="p-2.5">PPH / Kgs</th>
                        <th className="p-2.5">O/D · I/D</th>
                        <th className="p-2.5">Drop/Bend</th>
                        <th className="p-2.5">Fitting</th>
                        <th className="p-2.5">Colour</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {filteredQcChecks.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-6 text-center text-slate-500">
                            No QC checks matching filter.
                          </td>
                        </tr>
                      ) : (
                        filteredQcChecks.map((q) => (
                          <tr key={q.id} className="hover:bg-slate-800/40">
                            <td className="p-2.5 whitespace-nowrap">
                              <div className="font-bold text-slate-200">{q.date}</div>
                              <div className="text-[10px] text-slate-400">
                                {q.shift} {q.time ? `• ${q.time}` : ''}
                              </div>
                            </td>
                            <td className="p-2.5 whitespace-nowrap text-slate-200">{q.machine}</td>
                            <td className="p-2.5 font-semibold text-white">{q.product}</td>
                            <td className="p-2.5 text-slate-300">
                              {q.pph || '-'} / {q.kgsPerHr || '-'}
                            </td>
                            <td className="p-2.5 text-slate-300">
                              {q.od || '-'} / {q.idMm || '-'}
                            </td>
                            <td
                              className={`p-2.5 font-black ${
                                String(q.dropBend).toUpperCase().includes('FAIL')
                                  ? 'text-rose-400'
                                  : 'text-emerald-400'
                              }`}
                            >
                              {q.dropBend}
                            </td>
                            <td
                              className={`p-2.5 font-black ${
                                String(q.fitting).toUpperCase().includes('FAIL')
                                  ? 'text-rose-400'
                                  : 'text-emerald-400'
                              }`}
                            >
                              {q.fitting}
                            </td>
                            <td
                              className={`p-2.5 font-black ${
                                String(q.color).toUpperCase().includes('FAIL')
                                  ? 'text-rose-400'
                                  : 'text-emerald-400'
                              }`}
                            >
                              {q.color}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================= */}
      {/* TAB 4: SCRAP HANDOVER (OPERATOR ASSISTANT -> RECYCLING POP-UP) */}
      {/* ================================================= */}
      {activeSubTab === 'scrap_send' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <form
            onSubmit={handleLogScrapSend}
            className="rounded-2xl border border-amber-500/35 bg-slate-900/95 p-4 space-y-3"
          >
            <div className="border-b border-slate-800 pb-2">
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <Send className="h-4 w-4 text-amber-400" />
                <span>Stage 1: Operator Assistant Scrap Handover</span>
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Logging scrap immediately triggers a live pop-up alert for the Recycling Team.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">Date</label>
                <input
                  type="date"
                  required
                  value={sDate}
                  onChange={(e) => setSDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">Time</label>
                <input
                  type="time"
                  required
                  value={sTime}
                  onChange={(e) => setSTime(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">Shift</label>
                <select
                  value={sShift}
                  onChange={(e) => setSShift(e.target.value as 'Day' | 'Night')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                >
                  <option value="Day">Day</option>
                  <option value="Night">Night</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">
                  Shift In Charge
                </label>
                <select
                  value={sInCharge}
                  onChange={(e) => setSInCharge(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                >
                  {SHIFT_IN_CHARGE_OPTIONS.map((sic) => (
                    <option key={sic.label} value={sic.value}>
                      {sic.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">Machine</label>
                <select
                  value={sMachine}
                  onChange={(e) => setSMachine(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                >
                  {machines.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-bold text-slate-400">
                  Sent By (Operator Assistant)
                </label>
                <label className="flex items-center gap-1 text-[10px] text-amber-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sIsCasual}
                    onChange={(e) => setSIsCasual(e.target.checked)}
                  />
                  <span>Casual</span>
                </label>
              </div>
              {sIsCasual ? (
                <input
                  type="text"
                  required
                  placeholder="Enter casual assistant name..."
                  value={sCasualName}
                  onChange={(e) => setSCasualName(e.target.value)}
                  className="w-full rounded-xl border border-amber-500/40 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                />
              ) : (
                <select
                  value={sSentBy}
                  onChange={(e) => setSSentBy(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                >
                  {GENERAL_HAND_OPTIONS.map((gh) => (
                    <option key={gh.label} value={gh.value}>
                      {gh.label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-bold text-slate-400">Product</label>
                <input
                  type="text"
                  placeholder="Filter..."
                  value={sProductSearch}
                  onChange={(e) => {
                    const q = e.target.value;
                    setSProductSearch(q);
                    const m = MASTER_JOB_CARDS.find((c) =>
                      c.toLowerCase().includes(q.toLowerCase())
                    );
                    if (m) setSProduct(m);
                  }}
                  className="w-28 rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] text-white"
                />
              </div>
              <select
                value={sProduct}
                onChange={(e) => setSProduct(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              >
                {(filteredScrapCards.length ? filteredScrapCards : MASTER_JOB_CARDS).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-amber-300 mb-1">
                  Scrap Weight (kg) *
                </label>
                <input
                  type="number"
                  min="0.1"
                  step="any"
                  required
                  value={sScrapKg}
                  onChange={(e) => setSScrapKg(e.target.value)}
                  className="w-full rounded-xl border border-amber-500/40 bg-slate-950 px-2.5 py-1.5 text-xs font-black text-amber-300 tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">
                  Scrap Reason
                </label>
                <select
                  value={sReason}
                  onChange={(e) => setSReason(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                >
                  {SCRAP_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 mb-1">
                Assigned Receiver (Recycling Team)
              </label>
              <select
                value={sRecycler}
                onChange={(e) => setSRecycler(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              >
                {RECYCLING_OPTIONS.map((rc) => (
                  <option key={rc.label} value={rc.value}>
                    {rc.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={savingScrap}
              className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 py-2.5 text-xs font-black text-slate-950 shadow transition disabled:opacity-50"
            >
              {savingScrap
                ? 'Logging & Alerting...'
                : 'Log Scrap & Send Pop-Up to Recycling Team'}
            </button>
          </form>

          {/* Scrap Pipeline Table */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/95 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-slate-200">
                Scrap Handover &amp; Closed-Loop Pipeline ({filteredScrapPipeline.length} matching · {scrapPipeline.length} total)
              </span>
              {renderAdminExcelBtn(
                () => exportSopScrapExcel(filteredScrapPipeline),
                `Download Scrap Excel (${filteredScrapPipeline.length})`
              )}
            </div>

            {renderReportFilterBar({
              includeMachine: true,
              placeholder: 'Product, assistant, status...',
            })}

            <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-[540px]">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="bg-slate-950 text-[10px] font-black uppercase text-slate-400 sticky top-0">
                  <tr>
                    <th className="p-2.5">Date / Time</th>
                    <th className="p-2.5">Machine / Product</th>
                    <th className="p-2.5">Sent By</th>
                    <th className="p-2.5 text-right">Sent (kg)</th>
                    <th className="p-2.5 text-right">Usable (kg)</th>
                    <th className="p-2.5">Pipeline Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredScrapPipeline.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-slate-500">
                        No scrap handovers matching filter.
                      </td>
                    </tr>
                  ) : (
                    filteredScrapPipeline.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-800/40">
                        <td className="p-2.5 whitespace-nowrap">
                          <div className="font-bold text-slate-200">{s.date}</div>
                          <div className="text-[10px] text-slate-400">
                            {s.time} ({s.shift})
                          </div>
                        </td>
                        <td className="p-2.5">
                          <div className="font-bold text-white">{s.product}</div>
                          <div className="text-[10px] text-slate-400">{s.machine}</div>
                        </td>
                        <td className="p-2.5">
                          <div className="text-slate-200">{s.sentByAssistant}</div>
                          <div className="text-[10px] text-slate-500">To: {s.assignedRecycler}</div>
                        </td>
                        <td className="p-2.5 text-right font-black text-amber-300">{s.scrapKg}</td>
                        <td className="p-2.5 text-right font-black text-sky-300">
                          {s.usableMaterialKg ?? '—'}
                        </td>
                        <td className="p-2.5 whitespace-nowrap">
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-black border ${
                              s.status === 'RECEIVED_BY_MIXER'
                                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                : s.status === 'PROCESSED_FOR_MIXER'
                                ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                                : s.status === 'RECEIVED_BY_RECYCLING'
                                ? 'border-blue-500/40 bg-blue-500/15 text-blue-300'
                                : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                            }`}
                          >
                            {s.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================================================= */}
      {/* TAB 5: RECYCLING TEAM VERIFY & PROCESS -> MIXER   */}
      {/* ================================================= */}
      {activeSubTab === 'recycling' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <div className="rounded-2xl border border-sky-500/35 bg-slate-900/95 p-4 space-y-3">
            <div className="border-b border-slate-800 pb-2">
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <Recycle className="h-4 w-4 text-sky-400" />
                <span>Stage 2: Recycling Verify &amp; Process</span>
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Weigh incoming scrap, verify tolerance (&le;5%), and confirm when processed into usable material to trigger the Mixer Pop-up.
              </p>
            </div>

            {pendingProcessList.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-center text-xs text-slate-400">
                All operator scrap batches have already been processed for Mixers!
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">
                    Select Incoming Scrap Record ({pendingProcessList.length})
                  </label>
                  <select
                    value={activeRecycleRecord?.id || ''}
                    onChange={(e) => setRSelectedId(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white"
                  >
                    {pendingProcessList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.date} — {s.machine} — {s.scrapKg}kg ({s.status.replace(/_/g, ' ')})
                      </option>
                    ))}
                  </select>
                </div>

                {activeRecycleRecord && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs space-y-1 tabular-nums">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Product:</span>
                      <span className="font-bold text-white">{activeRecycleRecord.product}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Sent By:</span>
                      <span className="text-slate-200">{activeRecycleRecord.sentByAssistant}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Sent Weight:</span>
                      <span className="font-black text-amber-300">
                        {activeRecycleRecord.scrapKg} kg
                      </span>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">
                    Recycling Team Member
                  </label>
                  <select
                    value={rReceivedBy}
                    onChange={(e) => setRReceivedBy(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  >
                    {RECYCLING_OPTIONS.map((rc) => (
                      <option key={rc.label} value={rc.value}>
                        {rc.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">
                      Weighed Received (kg)
                    </label>
                    <input
                      type="number"
                      min="0.1"
                      step="any"
                      value={rReceivedKg}
                      onChange={(e) => setRReceivedKg(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-white tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">
                      Condition
                    </label>
                    <select
                      value={rCondition}
                      onChange={(e) => setRCondition(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                    >
                      {SCRAP_CONDITIONS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {activeRecycleRecord && Number(rReceivedKg) > 0 && (
                  <div
                    className={`text-[11px] font-bold rounded-lg px-2.5 py-1.5 border tabular-nums ${
                      Math.abs((activeRecycleRecord.scrapKg - Number(rReceivedKg)) / activeRecycleRecord.scrapKg) * 100 <= 5
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                    }`}
                  >
                    Variance: {(activeRecycleRecord.scrapKg - Number(rReceivedKg)).toFixed(1)} kg (
                    {Math.abs(
                      ((activeRecycleRecord.scrapKg - Number(rReceivedKg)) /
                        activeRecycleRecord.scrapKg) *
                        100
                    ).toFixed(1)}
                    %)
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800">
                  <div>
                    <label className="block text-[10px] font-bold text-sky-300 mb-1">
                      Usable Material Processed (kg) *
                    </label>
                    <input
                      type="number"
                      min="0.1"
                      step="any"
                      value={rUsableKg}
                      onChange={(e) => setRUsableKg(e.target.value)}
                      className="w-full rounded-xl border border-sky-500/40 bg-slate-950 px-2.5 py-1.5 text-xs font-black text-sky-300 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">
                      Recycling Waste Loss (kg)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={rWasteKg}
                      onChange={(e) => setRWasteKg(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 tabular-nums"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">
                    Processing Notes (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Crushed & dried, clean pellets/regrind ready"
                    value={rNotes}
                    onChange={(e) => setRNotes(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  />
                </div>

                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    disabled={savingRecycle}
                    onClick={() => handleConfirmRecyclingProcess(false)}
                    className="w-full rounded-xl border border-blue-500/40 bg-blue-500/15 hover:bg-blue-500/25 py-2 text-xs font-bold text-blue-200 transition"
                  >
                    Confirm Physical Receipt Only
                  </button>
                  <button
                    type="button"
                    disabled={savingRecycle}
                    onClick={() => handleConfirmRecyclingProcess(true)}
                    className="w-full rounded-xl bg-gradient-to-r from-sky-400 to-blue-500 hover:from-sky-300 hover:to-blue-400 py-2.5 text-xs font-black text-slate-950 shadow transition"
                  >
                    All Scrap Processed into Usable Material -&gt; Alert Mixers
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/95 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-slate-200">
                Recycling Verification &amp; Usable Output Ledger ({filteredScrapPipeline.length} matching · {scrapPipeline.length} total)
              </span>
              {renderAdminExcelBtn(
                () => exportSopScrapExcel(filteredScrapPipeline),
                `Download Recycling Excel (${filteredScrapPipeline.length})`
              )}
            </div>

            {renderReportFilterBar({
              includeMachine: true,
              placeholder: 'Product, recycler, status...',
            })}

            <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-[540px]">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="bg-slate-950 text-[10px] font-black uppercase text-slate-400 sticky top-0">
                  <tr>
                    <th className="p-2.5">Date</th>
                    <th className="p-2.5">Machine / Product</th>
                    <th className="p-2.5 text-right">Sent</th>
                    <th className="p-2.5 text-right">Recvd</th>
                    <th className="p-2.5 text-right">Usable</th>
                    <th className="p-2.5">Recycler</th>
                    <th className="p-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredScrapPipeline.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-slate-500">
                        No recycling records matching filter.
                      </td>
                    </tr>
                  ) : (
                    filteredScrapPipeline.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-800/40">
                      <td className="p-2.5 whitespace-nowrap text-slate-200 font-bold">{s.date}</td>
                      <td className="p-2.5">
                        <div className="font-bold text-white">{s.product}</div>
                        <div className="text-[10px] text-slate-400">{s.machine}</div>
                      </td>
                      <td className="p-2.5 text-right text-amber-300 font-bold">{s.scrapKg}</td>
                      <td className="p-2.5 text-right text-slate-200">{s.receivedKg ?? '—'}</td>
                      <td className="p-2.5 text-right font-black text-sky-300">
                        {s.usableMaterialKg ?? '—'}
                      </td>
                      <td className="p-2.5 text-slate-300">
                        {s.processedBy || s.receivedBy || s.assignedRecycler}
                      </td>
                      <td className="p-2.5 whitespace-nowrap">
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                            s.status === 'RECEIVED_BY_MIXER'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : s.status === 'PROCESSED_FOR_MIXER'
                              ? 'bg-sky-500/20 text-sky-300'
                              : 'bg-amber-500/20 text-amber-300'
                          }`}
                        >
                          {s.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================================================= */}
      {/* TAB 6: MIXING REPORT & WH STOCK -> HOD POP-UP     */}
      {/* ================================================= */}
      {activeSubTab === 'mixing' && (
        <div className="space-y-4">
          {/* Production HOD Approval Queue (shown to Admin / HOD when pending reports exist) */}
          {(isAdmin || permissions.dispatchHODConfirm) && pendingHodMixingList.length > 0 && (
            <div className="rounded-2xl border border-emerald-500/45 bg-emerald-950/20 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-black text-emerald-300 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  <span>Production HOD Review Required ({pendingHodMixingList.length} Mixing Report)</span>
                </h3>
                <input
                  type="text"
                  placeholder="Optional HOD confirmation note..."
                  value={hodMixNotes}
                  onChange={(e) => setHodMixNotes(e.target.value)}
                  className="w-full sm:w-72 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 tabular-nums">
                {pendingHodMixingList.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-xl border border-emerald-500/30 bg-slate-950 p-3.5 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-black text-white">
                        {m.machine} • {m.mixerName}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {m.date} ({m.shift})
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        Scrap Recvd: <b className="text-sky-300">{m.scrapReceivedFromRecyclingKg} kg</b>
                      </div>
                      <div>
                        Scrap Used: <b className="text-amber-300">{m.scrapUsedInMixingKg} kg</b>
                      </div>
                      <div>
                        WH Used: <b className="text-white">{m.whMaterialUsedKg} kg</b>
                      </div>
                      <div>
                        Sweeping: <b className="text-rose-300">{m.sweepingMaterialKg} kg</b>
                      </div>
                      <div>
                        Batches / Pend: <b>{m.batchesMixed} / {m.pendingMix}</b>
                      </div>
                      <div>
                        End WH Stock: <b className="text-emerald-300">{m.endOfMixingStockKg} kg</b>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={savingMix}
                      onClick={() => handleHodConfirmMixing(m)}
                      className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 py-2 text-xs font-black text-slate-950 transition"
                    >
                      Confirm Mixing &amp; WH Stock Balance
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <form
              onSubmit={handleSubmitMixingReport}
              className="rounded-2xl border border-sky-500/35 bg-slate-900/95 p-4 space-y-3"
            >
              <div className="border-b border-slate-800 pb-2">
                <h3 className="text-sm font-black text-white flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-sky-400" />
                  <span>Stage 3: Mixing Report &amp; WH Stock</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Receive processed scrap from Recycling, log WH material usage &amp; sweeping generated, and send stock balance pop-up to Production HOD.
                </p>
              </div>

              {/* Select Ready Processed Scrap Batches */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-2.5 space-y-1.5">
                <div className="text-[10px] font-black uppercase text-sky-300 flex items-center justify-between">
                  <span>Processed Scrap From Recycling ({readyForMixerScrap.length})</span>
                </div>
                {readyForMixerScrap.length === 0 ? (
                  <p className="text-[11px] text-slate-500">
                    No unreceived Recycling batches pending; you can still log a virgin/WH mixing batch below.
                  </p>
                ) : (
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {readyForMixerScrap.map((s) => (
                      <label
                        key={s.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 px-2 py-1 text-[11px] cursor-pointer hover:border-sky-500/50"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={mSelectedScrapIds.includes(s.id)}
                            onChange={() => toggleSelectScrapForMixer(s.id)}
                          />
                          <span className="truncate text-slate-200">
                            {s.date} • {s.product}
                          </span>
                        </div>
                        <span className="font-black text-sky-300 shrink-0 tabular-nums">
                          {s.usableMaterialKg ?? s.receivedKg ?? s.scrapKg} kg
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={mDate}
                    onChange={(e) => setMDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Time</label>
                  <input
                    type="time"
                    value={mTime}
                    onChange={(e) => setMTime(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Shift</label>
                  <select
                    value={mShift}
                    onChange={(e) => setMShift(e.target.value as 'Day' | 'Night')}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  >
                    <option value="Day">Day</option>
                    <option value="Night">Night</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">
                    Mixer Machine
                  </label>
                  <select
                    value={mMachine}
                    onChange={(e) => setMMachine(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  >
                    {mixerMachines.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">
                    Mixer Operator
                  </label>
                  <select
                    value={mMixerName}
                    onChange={(e) => setMMixerName(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  >
                    {MIXING_OPTIONS.map((mx) => (
                      <option key={mx.label} value={mx.value}>
                        {mx.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">
                    Mixer Assistant
                  </label>
                  <select
                    value={mAssistant}
                    onChange={(e) => setMAssistant(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  >
                    {MIXING_OPTIONS.map((mx) => (
                      <option key={mx.label} value={mx.value}>
                        {mx.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Mandatory Quantities for Production HOD Pop-up */}
              <div className="grid grid-cols-2 gap-2.5 tabular-nums">
                <div>
                  <label className="block text-[10px] font-bold text-slate-300 mb-1">
                    WH Reserved Material (kg) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={mWhReservedKg}
                    onChange={(e) => setMWhReservedKg(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-sky-300 mb-1">
                    Scrap Recvd From Recycling (kg) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={mScrapReceivedKg}
                    onChange={(e) => setMScrapReceivedKg(e.target.value)}
                    className="w-full rounded-xl border border-sky-500/40 bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-sky-300"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-300 mb-1">
                    WH Material Used in Mixing (kg) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={mWhUsedKg}
                    onChange={(e) => setMWhUsedKg(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-amber-300 mb-1">
                    Scrap Used in Mixing (kg) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={mScrapUsedKg}
                    onChange={(e) => setMScrapUsedKg(e.target.value)}
                    className="w-full rounded-xl border border-amber-500/40 bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-amber-300"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-rose-300 mb-1">
                    Sweeping Generated (kg) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={mSweepingKg}
                    onChange={(e) => setMSweepingKg(e.target.value)}
                    className="w-full rounded-xl border border-rose-500/40 bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-rose-300"
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-300 mb-1">
                      Batches Mixed *
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      required
                      value={mBatchesMixed}
                      onChange={(e) => setMBatchesMixed(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs font-bold text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-300 mb-1">
                      Pending Mix
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={mPendingMix}
                      onChange={(e) => setMPendingMix(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs font-bold text-white"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 flex items-center justify-between text-xs tabular-nums">
                <span className="font-bold text-emerald-200">
                  End-of-Mixing Material Stock (WH Balance):
                </span>
                <span className="text-base font-black text-emerald-300">
                  {calculatedEndStockKg} kg
                </span>
              </div>

              {/* Technical Mixing Specs */}
              <div className="grid grid-cols-4 gap-1.5">
                <input
                  type="text"
                  placeholder="Ratio 100:5"
                  value={mRatio}
                  onChange={(e) => setMRatio(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-white"
                />
                <input
                  type="number"
                  placeholder="Mix min"
                  value={mMixTime}
                  onChange={(e) => setMMixTime(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-white"
                />
                <input
                  type="number"
                  placeholder="RPM"
                  value={mSpeedRpm}
                  onChange={(e) => setMSpeedRpm(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-white"
                />
                <input
                  type="number"
                  placeholder="Mix °C"
                  value={mMixTemp}
                  onChange={(e) => setMMixTemp(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-white"
                />
                <input
                  type="number"
                  placeholder="Cool min"
                  value={mCoolerTime}
                  onChange={(e) => setMCoolerTime(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-white"
                />
                <input
                  type="number"
                  placeholder="Cool °C"
                  value={mCoolerRelease}
                  onChange={(e) => setMCoolerRelease(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-white"
                />
                <input
                  type="number"
                  placeholder="Hot °C"
                  value={mHotRelease}
                  onChange={(e) => setMHotRelease(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-white"
                />
                <input
                  type="text"
                  placeholder="Notes"
                  value={mNotes}
                  onChange={(e) => setMNotes(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-white"
                />
              </div>

              <button
                type="submit"
                disabled={savingMix}
                className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 py-2.5 text-xs font-black text-slate-950 shadow transition"
              >
                {savingMix
                  ? 'Submitting Mixing Report...'
                  : 'Submit Mixing & Alert Production HOD'}
              </button>
            </form>

            {/* Mixing Reports Table */}
            <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/95 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-slate-200">
                  Mixing Batches &amp; WH Material Balance ({filteredMixingReports.length} matching · {mixingReports.length} total)
                </span>
                {renderAdminExcelBtn(
                  () => exportSopMixingExcel(filteredMixingReports),
                  `Download Mixing Excel (${filteredMixingReports.length})`
                )}
              </div>

              {renderReportFilterBar({
                includeMachine: true,
                placeholder: 'Mixer name, machine, status...',
              })}

              <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-[560px]">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead className="bg-slate-950 text-[10px] font-black uppercase text-slate-400 sticky top-0">
                    <tr>
                      <th className="p-2.5">Date / Shift</th>
                      <th className="p-2.5">Machine / Mixer</th>
                      <th className="p-2.5 text-right">WH Resv</th>
                      <th className="p-2.5 text-right">Scrap Recvd</th>
                      <th className="p-2.5 text-right">WH Used</th>
                      <th className="p-2.5 text-right">Scrap Used</th>
                      <th className="p-2.5 text-right">Sweeping</th>
                      <th className="p-2.5 text-right">Batches / Pend</th>
                      <th className="p-2.5 text-right">End Stock</th>
                      <th className="p-2.5">HOD</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredMixingReports.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="p-6 text-center text-slate-500">
                          No mixing reports matching filter.
                        </td>
                      </tr>
                    ) : (
                      filteredMixingReports.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-800/40">
                          <td className="p-2.5 whitespace-nowrap">
                            <div className="font-bold text-slate-200">{m.date}</div>
                            <div className="text-[10px] text-slate-400">{m.shift}</div>
                          </td>
                          <td className="p-2.5">
                            <div className="font-bold text-white">{m.machine}</div>
                            <div className="text-[10px] text-slate-400">{m.mixerName}</div>
                          </td>
                          <td className="p-2.5 text-right text-slate-200">
                            {m.whReservedMaterialKg}
                          </td>
                          <td className="p-2.5 text-right text-sky-300 font-bold">
                            {m.scrapReceivedFromRecyclingKg}
                          </td>
                          <td className="p-2.5 text-right text-slate-200">{m.whMaterialUsedKg}</td>
                          <td className="p-2.5 text-right text-amber-300 font-bold">
                            {m.scrapUsedInMixingKg}
                          </td>
                          <td className="p-2.5 text-right text-rose-300 font-bold">
                            {m.sweepingMaterialKg}
                          </td>
                          <td className="p-2.5 text-right text-white">
                            {m.batchesMixed} / {m.pendingMix}
                          </td>
                          <td className="p-2.5 text-right font-black text-emerald-300">
                            {m.endOfMixingStockKg} kg
                          </td>
                          <td className="p-2.5 whitespace-nowrap">
                            <span
                              className={`rounded px-2 py-0.5 text-[10px] font-black ${
                                m.status === 'HOD_CONFIRMED'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-amber-500/20 text-amber-300'
                              }`}
                            >
                              {m.status === 'HOD_CONFIRMED' ? 'Confirmed' : 'Pending HOD'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================= */}
      {/* TAB 7: SHIFT HANDOVER                             */}
      {/* ================================================= */}
      {activeSubTab === 'handover' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <form
            onSubmit={handleSaveHandover}
            className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 space-y-3"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-sm font-black text-white">New Shift Handover</h3>
              <button
                type="button"
                onClick={handleAutoFillHandoverTotals}
                className="text-[10px] font-bold text-sky-300 hover:underline"
              >
                Auto-fill from Prod Logs
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">Date</label>
                <input
                  type="date"
                  required
                  value={hDate}
                  onChange={(e) => setHDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">Shift</label>
                <select
                  value={hShift}
                  onChange={(e) => setHShift(e.target.value as 'Day' | 'Night')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                >
                  <option value="Day">Day Shift</option>
                  <option value="Night">Night Shift</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 mb-1">
                Shift In Charge
              </label>
              <select
                value={hInCharge}
                onChange={(e) => setHInCharge(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              >
                {SHIFT_IN_CHARGE_OPTIONS.map((sic) => (
                  <option key={sic.label} value={sic.value}>
                    {sic.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">
                  Total Prod (kg)
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={hTotalProd}
                  onChange={(e) => setHTotalProd(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">
                  Total Scrap (kg)
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={hTotalScrap}
                  onChange={(e) => setHTotalScrap(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 mb-1">
                Ongoing Breakdown Notes
              </label>
              <input
                type="text"
                placeholder="e.g. Extrusion Machine 1 heater replaced"
                value={hNotes}
                onChange={(e) => setHNotes(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              />
            </div>

            <div className="grid grid-cols-4 gap-2">
              <input
                type="number"
                placeholder="Silo 1"
                value={hSilo1}
                onChange={(e) => setHSilo1(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
              />
              <input
                type="number"
                placeholder="Silo 2"
                value={hSilo2}
                onChange={(e) => setHSilo2(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
              />
              <input
                type="number"
                placeholder="Silo 3"
                value={hSilo3}
                onChange={(e) => setHSilo3(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
              />
              <input
                type="number"
                placeholder="Silo 4"
                value={hSilo4}
                onChange={(e) => setHSilo4(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
              />
            </div>

            <button
              type="submit"
              disabled={savingHandover}
              className="w-full rounded-xl bg-amber-500 hover:bg-amber-400 py-2.5 text-xs font-black text-slate-950 shadow transition"
            >
              {savingHandover ? 'Saving...' : 'Log Shift Handover'}
            </button>
          </form>

          <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/95 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-slate-200">
                Shift Handover Records ({filteredHandovers.length} matching · {handovers.length} total)
              </span>
              {renderAdminExcelBtn(
                () => exportSopHandoverExcel(filteredHandovers),
                `Download Handover Excel (${filteredHandovers.length})`
              )}
            </div>

            {renderReportFilterBar({
              includeMachine: false,
              placeholder: 'Shift in charge, notes...',
            })}

            <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-[500px]">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="bg-slate-950 text-[10px] font-black uppercase text-slate-400 sticky top-0">
                  <tr>
                    <th className="p-2.5">Date / Shift</th>
                    <th className="p-2.5">In Charge</th>
                    <th className="p-2.5 text-right">Total Prod</th>
                    <th className="p-2.5 text-right">Total Scrap</th>
                    <th className="p-2.5 text-right">Scrap %</th>
                    <th className="p-2.5">Silos (1–4)</th>
                    <th className="p-2.5">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredHandovers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-slate-500">
                        No shift handovers matching filter.
                      </td>
                    </tr>
                  ) : (
                    filteredHandovers.map((h) => (
                      <tr key={h.id} className="hover:bg-slate-800/40">
                        <td className="p-2.5 whitespace-nowrap">
                          <div className="font-bold text-slate-200">{h.date}</div>
                          <div className="text-[10px] text-slate-400">{h.shift}</div>
                        </td>
                        <td className="p-2.5 font-semibold text-white">{h.inCharge}</td>
                        <td className="p-2.5 text-right font-bold text-emerald-300">
                          {h.totalProdKg} kg
                        </td>
                        <td className="p-2.5 text-right font-bold text-rose-300">
                          {h.totalScrapKg} kg
                        </td>
                        <td className="p-2.5 text-right font-bold text-amber-300">
                          {h.scrapPct}%
                        </td>
                        <td className="p-2.5 text-slate-300">
                          {h.silo1Kg}/{h.silo2Kg}/{h.silo3Kg}/{h.silo4Kg}
                        </td>
                        <td className="p-2.5 text-slate-300">{h.breakdownNotes}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
