import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  CheckSquare,
  ClipboardList,
  Cog,
  FileDown,
  Layers,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react';
import {
  MaintenanceJobCard,
  MaintenanceJobCardPriority,
  MaintenanceJobCardType,
  MaintenanceSparePartRow,
  getMachineDepartment,
  normalizeMachineName,
} from '../types';
import { ymd } from '../services/downtimeCalc';
import { generateMaintenanceJobCardPdf } from '../services/maintenanceJobCardPdf';
import {
  flushPendingMaintenanceJobCards,
  getLastMaintenanceSyncError,
  pollMaintenanceJobCards,
  saveMaintenanceJobCardToFirebase,
} from '../services/maintenanceJobCardStore';
import {
  ENGINEER_REPLACEMENT_POLICY_TEXT,
  buildDefaultStagesForCardType,
  countEngineerSignatures,
  deriveJobCardStatus,
  getCardTypeLabel,
  getDefaultDocCodeForCardType,
  getDefaultTeamForCardType,
  getDefaultWorkTitleForCardType,
} from '../services/maintenanceJobCardTemplates';
import { EasySignaturePad } from './EasySignaturePad';

interface MaintenanceJobCardsViewProps {
  machines: string[];
  jobCards: MaintenanceJobCard[];
  currentUserName: string;
  currentUserEmail: string;
  canIssueOrEdit: boolean;
  onDataChanged?: () => void;
}

function defaultMachineForType(
  cardType: MaintenanceJobCardType,
  machines: string[]
): string {
  if (cardType === 'EXTRUSION_DIE_CHANGE') {
    return (
      machines.find((m) => m.toLowerCase().includes('extrusion')) ||
      machines[0] ||
      'Extrusion Machine 1'
    );
  }
  if (cardType === 'INJECTION_MOULD_CHANGE') {
    return (
      machines.find((m) => /^im\s*\d+|gumboot/i.test(m)) ||
      machines[0] ||
      'IM 1'
    );
  }
  return machines[0] || 'Extrusion Machine 1';
}

function createEmptyJobCard(
  cardType: MaintenanceJobCardType,
  machines: string[],
  userName: string,
  userEmail: string
): MaintenanceJobCard {
  const now = new Date();
  const machine = normalizeMachineName(defaultMachineForType(cardType, machines));
  const prefix =
    cardType === 'EXTRUSION_DIE_CHANGE'
      ? 'MNT-DIE'
      : cardType === 'INJECTION_MOULD_CHANGE'
      ? 'MNT-MLD'
      : 'MNT-JC';
  return {
    id: `MJC-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    jobCardNo: `${prefix}-${ymd(now).replace(/-/g, '').slice(2)}-${String(Date.now()).slice(-3)}`,
    docCode: getDefaultDocCodeForCardType(cardType),
    cardType,
    date: ymd(now),
    shift: now.getHours() >= 7 && now.getHours() < 19 ? 'Day' : 'Night',
    machine,
    department: getMachineDepartment(machine),
    priority: 'NORMAL',
    requestedStartTime: `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`,
    targetCompletionTime: '',
    workTitle: getDefaultWorkTitleForCardType(cardType),
    faultOrChangeoverDetails: '',
    assignedToTeam: getDefaultTeamForCardType(cardType),
    assignedTechnicianName: '',
    outgoingDieOrMould: '',
    incomingDieOrMould: '',
    productToRun: '',
    storageRackLocation: '',
    removedToolingCleanedAndPreserved: false,
    removedToolingStoredVerified: false,
    lotoIsolatedConfirmed: false,
    rootCauseFindings: '',
    correctiveActionTaken: '',
    stages: buildDefaultStagesForCardType(cardType),
    replacementRequired: false,
    sparesUsed: [],
    issuedByShiftInCharge: {
      name: userName,
      roleTitle: 'Shift In Charge',
      signature: '',
    },
    technicianOrSetter: {
      name: '',
      roleTitle:
        cardType === 'STANDARD_MAINTENANCE' ? 'Maintenance Technician' : 'Mould Setter',
      signature: '',
    },
    engineer1: {
      name: '',
      roleTitle: 'Engineer 1 (Mechanical / Plant)',
      signature: '',
    },
    engineer2: {
      name: '',
      roleTitle: 'Engineer 2 (Electrical / Automation)',
      signature: '',
    },
    engineer3: {
      name: '',
      roleTitle: 'Engineer 3 (Chief Eng / HOD)',
      signature: '',
    },
    issuedByEmail: userEmail,
    issuedAt: now.toISOString(),
    pdfIssuedCount: 0,
    status: 'ISSUED',
    upd: Date.now(),
  };
}

export const MaintenanceJobCardsView: React.FC<MaintenanceJobCardsViewProps> = ({
  machines,
  jobCards,
  currentUserName,
  currentUserEmail,
  canIssueOrEdit,
  onDataChanged,
}) => {
  const [subTab, setSubTab] = useState<'create' | 'log'>('create');
  const [card, setCard] = useState<MaintenanceJobCard>(() =>
    createEmptyJobCard('STANDARD_MAINTENANCE', machines, currentUserName, currentUserEmail)
  );
  const [saving, setSaving] = useState(false);
  const [issuingPdf, setIssuingPdf] = useState(false);
  const [syncingCards, setSyncingCards] = useState(false);
  const [toast, setToast] = useState<{ text: string; isError?: boolean } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | MaintenanceJobCardType>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const flashMsg = (text: string, isError = false) => {
    setToast({ text, isError });
    setTimeout(() => setToast(null), 6500);
  };

  const handleManualSyncCards = async () => {
    setSyncingCards(true);
    try {
      const flushed = await flushPendingMaintenanceJobCards();
      const latest = await pollMaintenanceJobCards(true);
      onDataChanged?.();
      const syncErr = getLastMaintenanceSyncError();
      if (syncErr) {
        flashMsg(`Cloud Sync Warning: ${syncErr}`, true);
      } else {
        flashMsg(
          `Synced ${latest.length} Maintenance Job Card(s) with Cloud${flushed > 0 ? ` (${flushed} uploaded from device)` : ''}.`
        );
      }
    } catch (err: any) {
      flashMsg(err?.message || 'Failed to sync Maintenance Job Cards.', true);
    } finally {
      setSyncingCards(false);
    }
  };

  const isToolingCard =
    card.cardType === 'EXTRUSION_DIE_CHANGE' || card.cardType === 'INJECTION_MOULD_CHANGE';
  const engSigCount = useMemo(() => countEngineerSignatures(card), [card]);
  const completedStagesCount = useMemo(
    () => card.stages.filter((s) => s.completed).length,
    [card.stages]
  );
  const anySpareReplacementFlagged = useMemo(
    () => card.replacementRequired || card.sparesUsed.some((r) => r.isReplacement),
    [card.replacementRequired, card.sparesUsed]
  );

  const handleSwitchCardType = (nextType: MaintenanceJobCardType) => {
    const nextMachine = normalizeMachineName(defaultMachineForType(nextType, machines));
    const prefix =
      nextType === 'EXTRUSION_DIE_CHANGE'
        ? 'MNT-DIE'
        : nextType === 'INJECTION_MOULD_CHANGE'
        ? 'MNT-MLD'
        : 'MNT-JC';
    const isExistingSaved = jobCards.some((j) => j.id === card.id);
    if (isExistingSaved) {
      // Switching format creates a fresh job card of the chosen template
      setCard(
        createEmptyJobCard(nextType, machines, currentUserName, currentUserEmail)
      );
      return;
    }
    setCard((prev) => ({
      ...prev,
      cardType: nextType,
      jobCardNo: `${prefix}-${prev.date.replace(/-/g, '').slice(2)}-${String(Date.now()).slice(-3)}`,
      docCode: getDefaultDocCodeForCardType(nextType),
      machine: nextMachine,
      department: getMachineDepartment(nextMachine),
      assignedToTeam: getDefaultTeamForCardType(nextType),
      workTitle: getDefaultWorkTitleForCardType(nextType),
      stages: buildDefaultStagesForCardType(nextType),
      technicianOrSetter: {
        ...prev.technicianOrSetter,
        roleTitle:
          nextType === 'STANDARD_MAINTENANCE' ? 'Maintenance Technician' : 'Mould Setter',
      },
    }));
  };

  const toggleStageComplete = (stageId: string) => {
    const nowIso = new Date().toISOString();
    setCard((prev) => ({
      ...prev,
      stages: prev.stages.map((st) => {
        if (st.id !== stageId) return st;
        const nextDone = !st.completed;
        return {
          ...st,
          completed: nextDone,
          completedBy: nextDone ? currentUserName : undefined,
          completedAt: nextDone ? nowIso : undefined,
        };
      }),
    }));
  };

  const updateStageRemark = (stageId: string, remarks: string) => {
    setCard((prev) => ({
      ...prev,
      stages: prev.stages.map((st) => (st.id === stageId ? { ...st, remarks } : st)),
    }));
  };

  const addSpareRow = () => {
    const blank: MaintenanceSparePartRow = {
      partName: '',
      partCodeOrSpec: '',
      qty: '1',
      unit: 'pcs',
      isReplacement: true,
      reason: '',
    };
    setCard((prev) => ({
      ...prev,
      replacementRequired: true,
      sparesUsed: [...prev.sparesUsed, blank],
    }));
  };

  const updateSpareRow = (
    idx: number,
    patch: Partial<MaintenanceSparePartRow>
  ) => {
    setCard((prev) => {
      const nextRows = prev.sparesUsed.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      const anyRep = nextRows.some((r) => r.isReplacement);
      return {
        ...prev,
        replacementRequired: prev.replacementRequired || anyRep,
        sparesUsed: nextRows,
      };
    });
  };

  const removeSpareRow = (idx: number) => {
    setCard((prev) => ({
      ...prev,
      sparesUsed: prev.sparesUsed.filter((_, i) => i !== idx),
    }));
  };

  const handleSaveCard = async (issuePdfAfterSave: boolean) => {
    if (!canIssueOrEdit) {
      flashMsg('Your role does not have permission to create or modify Maintenance Job Cards.', true);
      return;
    }
    if (!card.workTitle.trim()) {
      flashMsg('Enter a Work / Task Title before saving the Job Card.', true);
      return;
    }
    if (!card.issuedByShiftInCharge?.signature) {
      flashMsg(
        'Shift In Charge signature is required to issue the Maintenance Job Card (draw directly in Box 1 below).',
        true
      );
      return;
    }

    const nowIso = new Date().toISOString();
    const prepared: MaintenanceJobCard = {
      ...card,
      machine: normalizeMachineName(card.machine),
      department: getMachineDepartment(card.machine),
      replacementRequired: anySpareReplacementFlagged,
      pdfIssuedCount: issuePdfAfterSave
        ? (card.pdfIssuedCount || 0) + 1
        : card.pdfIssuedCount || 0,
      lastPdfIssuedAt: issuePdfAfterSave ? nowIso : card.lastPdfIssuedAt,
      upd: Date.now(),
    };
    prepared.status = deriveJobCardStatus(prepared);

    if (issuePdfAfterSave) setIssuingPdf(true);
    else setSaving(true);

    const res = await saveMaintenanceJobCardToFirebase(prepared);
    setCard(prepared);
    onDataChanged?.();

    if (issuePdfAfterSave) {
      await generateMaintenanceJobCardPdf(prepared);
      setIssuingPdf(false);
      flashMsg(
        res.ok
          ? `Job Card ${prepared.jobCardNo} saved & issued to Maintenance Team as PDF.`
          : `Job Card ${prepared.jobCardNo} PDF generated (${res.error || 'offline queue'}).`,
        !res.ok
      );
    } else {
      setSaving(false);
      flashMsg(
        res.ok
          ? `Job Card ${prepared.jobCardNo} saved & synced across devices.`
          : `Saved locally (${res.error || 'offline queue'}).`,
        !res.ok
      );
    }
  };

  const filteredLogCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...jobCards]
      .filter((c) => {
        if (typeFilter !== 'ALL' && c.cardType !== typeFilter) return false;
        if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
        if (!q) return true;
        return [
          c.jobCardNo,
          c.workTitle,
          c.machine,
          c.assignedToTeam,
          c.outgoingDieOrMould,
          c.incomingDieOrMould,
          c.storageRackLocation,
          c.issuedByShiftInCharge?.name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => (b.upd || 0) - (a.upd || 0));
  }, [jobCards, searchQuery, typeFilter, statusFilter]);

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#0F1E36]">
              <Wrench className="h-4 w-4 text-sky-700" />
              <span>Maintenance, Extrusion Die Change &amp; Injection Mould Change System</span>
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
              Maintenance Job Cards &amp; Toolroom Storage Log
            </h2>
            <p className="text-xs text-slate-600 max-w-3xl">
              Created &amp; issued by Shift In Charge to the Maintenance Team / Mould Setters as an official LG PLAST PDF. Includes complete Extrusion Die Change &amp; Injection Mould Change stages up to Toolroom Storage and enforces 2–3 Engineer signatures for any component replacements.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSubTab('create')}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                subTab === 'create'
                  ? 'bg-[#0F1E36] text-white shadow-xs'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create / Edit Job Card</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('log')}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                subTab === 'log'
                  ? 'bg-[#0F1E36] text-white shadow-xs'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <ClipboardList className="h-3.5 w-3.5" />
              <span>Issued Job Cards Log ({jobCards.length})</span>
            </button>
            <button
              type="button"
              disabled={syncingCards}
              onClick={handleManualSyncCards}
              className="flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 hover:bg-sky-100 px-3 py-2 text-xs font-bold text-sky-900 transition disabled:opacity-50"
              title="Pull latest Maintenance Job Cards from Cloud & push unsent local cards"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncingCards ? 'animate-spin' : ''}`} />
              <span>{syncingCards ? 'Syncing...' : 'Sync Cards'}</span>
            </button>
          </div>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs tabular-nums">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-[11px] font-medium text-slate-500">Total Issued Cards</div>
            <div className="text-lg font-bold text-slate-900">{jobCards.length}</div>
          </div>
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
            <div className="text-[11px] font-medium text-sky-800">Die / Mould Change Cards</div>
            <div className="text-lg font-bold text-sky-900">
              {
                jobCards.filter(
                  (j) =>
                    j.cardType === 'EXTRUSION_DIE_CHANGE' ||
                    j.cardType === 'INJECTION_MOULD_CHANGE'
                ).length
              }
            </div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="text-[11px] font-medium text-amber-800">Awaiting Engineer Signs</div>
            <div className="text-lg font-bold text-amber-900">
              {
                jobCards.filter(
                  (j) =>
                    j.status === 'AWAITING_ENGINEER_SIGNS' ||
                    (j.replacementRequired && countEngineerSignatures(j) < 2)
                ).length
              }
            </div>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-[11px] font-medium text-emerald-800">Completed &amp; Stored</div>
            <div className="text-lg font-bold text-emerald-900">
              {jobCards.filter((j) => j.status === 'COMPLETED').length}
            </div>
          </div>
        </div>
      </div>

      {/* Feedback Toast */}
      {toast && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs font-semibold flex items-center gap-2 shadow-xs ${
            toast.isError
              ? 'border-rose-300 bg-rose-50 text-rose-800'
              : 'border-emerald-300 bg-emerald-50 text-emerald-800'
          }`}
        >
          {toast.isError ? (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      {/* TAB 1: CREATE / ISSUE / UPDATE JOB CARD */}
      {subTab === 'create' && (
        <div className="space-y-4">
          {/* Job Card Format Selector */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  1. Select Maintenance Job Card Format
                </h3>
                <p className="text-xs text-slate-500">
                  Choose Standard Maintenance or Die/Mould Changeover (includes complete SOP stages up to Toolroom Storage).
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setCard(
                    createEmptyJobCard(
                      card.cardType,
                      machines,
                      currentUserName,
                      currentUserEmail
                    )
                  )
                }
                className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                + New Blank Job Card
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => handleSwitchCardType('STANDARD_MAINTENANCE')}
                className={`rounded-xl border p-3.5 text-left transition ${
                  card.cardType === 'STANDARD_MAINTENANCE'
                    ? 'border-[#0F1E36] bg-[#0F1E36] text-white shadow-xs'
                    : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="flex items-center gap-1.5 text-xs font-bold">
                    <Wrench className="h-4 w-4" />
                    Standard Maintenance
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      card.cardType === 'STANDARD_MAINTENANCE'
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    LG-MNT-JC-01
                  </span>
                </div>
                <p
                  className={`text-[11px] leading-snug ${
                    card.cardType === 'STANDARD_MAINTENANCE' ? 'text-slate-200' : 'text-slate-600'
                  }`}
                >
                  Mechanical, electrical &amp; breakdown repair job card with LOTO, spares replacement check &amp; engineer approvals.
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchCardType('EXTRUSION_DIE_CHANGE')}
                className={`rounded-xl border p-3.5 text-left transition ${
                  card.cardType === 'EXTRUSION_DIE_CHANGE'
                    ? 'border-[#0F1E36] bg-[#0F1E36] text-white shadow-xs'
                    : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="flex items-center gap-1.5 text-xs font-bold">
                    <Layers className="h-4 w-4" />
                    Extrusion Die Change
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      card.cardType === 'EXTRUSION_DIE_CHANGE'
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    LG-MNT-DIE-02
                  </span>
                </div>
                <p
                  className={`text-[11px] leading-snug ${
                    card.cardType === 'EXTRUSION_DIE_CHANGE' ? 'text-slate-200' : 'text-slate-600'
                  }`}
                >
                  For Mould Setters: Purge, LOTO, strip, hot cleaning, rust protection up to Toolroom Storage + new die heat soak &amp; QC.
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchCardType('INJECTION_MOULD_CHANGE')}
                className={`rounded-xl border p-3.5 text-left transition ${
                  card.cardType === 'INJECTION_MOULD_CHANGE'
                    ? 'border-[#0F1E36] bg-[#0F1E36] text-white shadow-xs'
                    : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="flex items-center gap-1.5 text-xs font-bold">
                    <Cog className="h-4 w-4" />
                    Injection Mould Change
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      card.cardType === 'INJECTION_MOULD_CHANGE'
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    LG-MNT-MLD-03
                  </span>
                </div>
                <p
                  className={`text-[11px] leading-snug ${
                    card.cardType === 'INJECTION_MOULD_CHANGE' ? 'text-slate-200' : 'text-slate-600'
                  }`}
                >
                  For Mould Setters: Water/hydraulic air purge, hoist removal, cavity protection up to Toolroom Storage + clamping &amp; 1st shot QC.
                </p>
              </button>
            </div>
          </div>

          {/* Core Job Card Header & Machine Assignment */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  2. Job Card Details &amp; Machine Assignment ({card.jobCardNo})
                </h3>
                <p className="text-xs text-slate-500">
                  Form {card.docCode} · Status: <b>{card.status.replace(/_/g, ' ')}</b>
                </p>
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(card.lotoIsolatedConfirmed)}
                  onChange={(e) =>
                    setCard((prev) => ({ ...prev, lotoIsolatedConfirmed: e.target.checked }))
                  }
                />
                <span>LOTO / Energy Isolation Verified</span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Job Card No.</label>
                <input
                  type="text"
                  value={card.jobCardNo}
                  onChange={(e) => setCard((prev) => ({ ...prev, jobCardNo: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold text-[#0F1E36]"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={card.date}
                  onChange={(e) => setCard((prev) => ({ ...prev, date: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Shift</label>
                <select
                  value={card.shift}
                  onChange={(e) =>
                    setCard((prev) => ({ ...prev, shift: e.target.value as 'Day' | 'Night' }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="Day">Day Shift (07:30 - 19:30)</option>
                  <option value="Night">Night Shift (19:30 - 07:30)</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Priority</label>
                <select
                  value={card.priority}
                  onChange={(e) =>
                    setCard((prev) => ({
                      ...prev,
                      priority: e.target.value as MaintenanceJobCardPriority,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-semibold"
                >
                  <option value="NORMAL">Normal Scheduled</option>
                  <option value="URGENT">Urgent Production Priority</option>
                  <option value="CRITICAL_BREAKDOWN">Critical Breakdown</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Machine / Line *</label>
                <select
                  value={card.machine}
                  onChange={(e) => {
                    const m = normalizeMachineName(e.target.value);
                    setCard((prev) => ({
                      ...prev,
                      machine: m,
                      department: getMachineDepartment(m),
                    }));
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-semibold"
                >
                  {machines.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Assigned Team</label>
                <input
                  type="text"
                  value={card.assignedToTeam}
                  onChange={(e) =>
                    setCard((prev) => ({ ...prev, assignedToTeam: e.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {isToolingCard ? 'Assigned Mould Setter Name' : 'Assigned Maintenance Tech'}
                </label>
                <input
                  type="text"
                  value={card.assignedTechnicianName || ''}
                  onChange={(e) =>
                    setCard((prev) => ({
                      ...prev,
                      assignedTechnicianName: e.target.value,
                      technicianOrSetter: {
                        ...prev.technicianOrSetter,
                        name: e.target.value,
                      },
                    }))
                  }
                  placeholder={isToolingCard ? 'e.g. T. Moyo (Mould Setter)' : 'e.g. Mechanic / Electrician'}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={card.requestedStartTime || ''}
                    onChange={(e) =>
                      setCard((prev) => ({ ...prev, requestedStartTime: e.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Target Finish</label>
                  <input
                    type="time"
                    value={card.targetCompletionTime || ''}
                    onChange={(e) =>
                      setCard((prev) => ({ ...prev, targetCompletionTime: e.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Work / Task Title *
                </label>
                <input
                  type="text"
                  value={card.workTitle}
                  onChange={(e) => setCard((prev) => ({ ...prev, workTitle: e.target.value }))}
                  placeholder="Describe fault, preventive job, or die/mould changeover..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-semibold"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Fault Symptoms / Changeover Scope Instructions
                </label>
                <input
                  type="text"
                  value={card.faultOrChangeoverDetails}
                  onChange={(e) =>
                    setCard((prev) => ({ ...prev, faultOrChangeoverDetails: e.target.value }))
                  }
                  placeholder="Specific instructions issued by Shift In Charge to maintenance team..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
            </div>

            {/* Tooling & Toolroom Storage Block (Extrusion Die Change & Injection Mould Change) */}
            {isToolingCard && (
              <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#0F1E36]">
                    <Archive className="h-4 w-4 text-sky-700" />
                    <span>
                      {card.cardType === 'EXTRUSION_DIE_CHANGE'
                        ? 'Extrusion Die Tooling & Toolroom Storage Tracking'
                        : 'Injection Mould Tooling & Toolroom Storage Tracking'}
                    </span>
                  </div>
                  <span className="rounded bg-white border border-sky-200 px-2 py-0.5 text-[10px] font-bold text-sky-800">
                    COVERS REMOVAL UP TO TOOLROOM STORAGE
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {card.cardType === 'EXTRUSION_DIE_CHANGE'
                        ? 'Outgoing Die ID / Size'
                        : 'Outgoing Mould ID / Name'}
                    </label>
                    <input
                      type="text"
                      value={card.outgoingDieOrMould || ''}
                      onChange={(e) =>
                        setCard((prev) => ({ ...prev, outgoingDieOrMould: e.target.value }))
                      }
                      placeholder={
                        card.cardType === 'EXTRUSION_DIE_CHANGE'
                          ? 'e.g. DIE-PVC-40MM-02'
                          : 'e.g. MLD-CRATE-20L-B'
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {card.cardType === 'EXTRUSION_DIE_CHANGE'
                        ? 'Incoming Die ID / Size'
                        : 'Incoming Mould ID / Name'}
                    </label>
                    <input
                      type="text"
                      value={card.incomingDieOrMould || ''}
                      onChange={(e) =>
                        setCard((prev) => ({ ...prev, incomingDieOrMould: e.target.value }))
                      }
                      placeholder={
                        card.cardType === 'EXTRUSION_DIE_CHANGE'
                          ? 'e.g. DIE-PVC-63MM-01'
                          : 'e.g. MLD-BUCKET-10L-A'
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Product to Run</label>
                    <input
                      type="text"
                      value={card.productToRun || ''}
                      onChange={(e) =>
                        setCard((prev) => ({ ...prev, productToRun: e.target.value }))
                      }
                      placeholder="Target production item"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Toolroom Storage Rack / Bay *
                    </label>
                    <input
                      type="text"
                      value={card.storageRackLocation || ''}
                      onChange={(e) =>
                        setCard((prev) => ({ ...prev, storageRackLocation: e.target.value }))
                      }
                      placeholder="e.g. Toolroom Rack B · Shelf 03"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 text-xs pt-1">
                  <label className="flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(card.removedToolingCleanedAndPreserved)}
                      onChange={(e) =>
                        setCard((prev) => ({
                          ...prev,
                          removedToolingCleanedAndPreserved: e.target.checked,
                        }))
                      }
                    />
                    <span>
                      Outgoing {card.cardType === 'EXTRUSION_DIE_CHANGE' ? 'Die' : 'Mould'} Cleaned, Air-Purged &amp; Anti-Rust Oiled
                    </span>
                  </label>

                  <label className="flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(card.removedToolingStoredVerified)}
                      onChange={(e) =>
                        setCard((prev) => ({
                          ...prev,
                          removedToolingStoredVerified: e.target.checked,
                        }))
                      }
                    />
                    <span>Tagged &amp; Stored Safely in Toolroom Rack Above</span>
                  </label>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Root Cause / Technical Findings
                </label>
                <input
                  type="text"
                  value={card.rootCauseFindings || ''}
                  onChange={(e) =>
                    setCard((prev) => ({ ...prev, rootCauseFindings: e.target.value }))
                  }
                  placeholder="Inspection findings recorded by technician / setter..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Corrective Action / Verification Summary
                </label>
                <input
                  type="text"
                  value={card.correctiveActionTaken || ''}
                  onChange={(e) =>
                    setCard((prev) => ({ ...prev, correctiveActionTaken: e.target.value }))
                  }
                  placeholder="Action completed & operational test verification..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Stage-by-Stage SOP Instructions & Log */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  3. Step-by-Step Instructions &amp; Stage Completion Log ({completedStagesCount}/{card.stages.length})
                </h3>
                <p className="text-xs text-slate-500">
                  {isToolingCard
                    ? 'Every stage from machine isolation up to outgoing die/mould preservation in Toolroom Storage is printed on the PDF with a live log.'
                    : 'Tick each stage as executed and record technician/setter remarks for the job card PDF log.'}
                </p>
              </div>
              <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-[#0F1E36] tabular-nums">
                Stages Completed: {completedStagesCount} / {card.stages.length}
              </span>
            </div>

            <div className="space-y-2.5">
              {card.stages.map((st) => (
                <div
                  key={st.id}
                  className={`rounded-xl border p-3.5 transition ${
                    st.completed
                      ? 'border-emerald-300 bg-emerald-50/50'
                      : 'border-slate-200 bg-slate-50/70'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-[#0F1E36] px-2 py-0.5 text-[10px] font-bold text-white tabular-nums">
                          #{st.stageNo}
                        </span>
                        <span className="text-xs font-bold text-slate-900">{st.stageTitle}</span>
                        {st.completed && st.completedAt && (
                          <span className="text-[10px] font-semibold text-emerald-700">
                            ✓ Logged by {st.completedBy || 'Team'} at{' '}
                            {st.completedAt.slice(0, 16).replace('T', ' ')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-700 leading-relaxed">{st.instruction}</p>
                      {st.safetyNote && (
                        <p className="text-[11px] font-semibold text-amber-800">
                          Safety / Control Note: {st.safetyNote}
                        </p>
                      )}
                      <input
                        type="text"
                        value={st.remarks || ''}
                        onChange={(e) => updateStageRemark(st.id, e.target.value)}
                        placeholder="Stage remarks / readings / Rack ID..."
                        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleStageComplete(st.id)}
                      className={`shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition ${
                        st.completed
                          ? 'bg-emerald-700 text-white hover:bg-emerald-600'
                          : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-100'
                      }`}
                    >
                      <CheckSquare className="h-3.5 w-3.5" />
                      <span>{st.completed ? 'Stage Done ✓' : 'Mark Stage Done'}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 4: Spares / Replacements Table */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  4. Component / Spares Replacement Schedule
                </h3>
                <p className="text-xs text-slate-500">
                  List any parts or components requested or replaced on this job card.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={card.replacementRequired}
                    onChange={(e) =>
                      setCard((prev) => ({
                        ...prev,
                        replacementRequired: e.target.checked,
                      }))
                    }
                  />
                  <span>Component Replacement Required</span>
                </label>
                <button
                  type="button"
                  onClick={addSpareRow}
                  className="flex items-center gap-1 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-3 py-1.5 text-xs font-bold text-white"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Spare / Part Row</span>
                </button>
              </div>
            </div>

            {card.sparesUsed.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                No replacement parts added yet. Click &quot;Add Spare / Part Row&quot; if any component needs replacement.
              </p>
            ) : (
              <div className="space-y-2">
                {card.sparesUsed.map((row, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs items-center"
                  >
                    <input
                      type="text"
                      value={row.partName}
                      onChange={(e) => updateSpareRow(idx, { partName: e.target.value })}
                      placeholder="Part / Component Name"
                      className="sm:col-span-3 rounded border border-slate-300 bg-white px-2.5 py-1.5"
                    />
                    <input
                      type="text"
                      value={row.partCodeOrSpec}
                      onChange={(e) => updateSpareRow(idx, { partCodeOrSpec: e.target.value })}
                      placeholder="Code / Rating"
                      className="sm:col-span-2 rounded border border-slate-300 bg-white px-2.5 py-1.5"
                    />
                    <input
                      type="text"
                      value={row.qty}
                      onChange={(e) => updateSpareRow(idx, { qty: e.target.value })}
                      placeholder="Qty"
                      className="sm:col-span-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-center"
                    />
                    <input
                      type="text"
                      value={row.unit}
                      onChange={(e) => updateSpareRow(idx, { unit: e.target.value })}
                      placeholder="Unit"
                      className="sm:col-span-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-center"
                    />
                    <label className="sm:col-span-2 flex items-center gap-1.5 font-semibold text-rose-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={row.isReplacement}
                        onChange={(e) =>
                          updateSpareRow(idx, { isReplacement: e.target.checked })
                        }
                      />
                      <span>Replacement</span>
                    </label>
                    <input
                      type="text"
                      value={row.reason}
                      onChange={(e) => updateSpareRow(idx, { reason: e.target.value })}
                      placeholder="Reason for replacement"
                      className="sm:col-span-2 rounded border border-slate-300 bg-white px-2.5 py-1.5"
                    />
                    <button
                      type="button"
                      onClick={() => removeSpareRow(idx)}
                      className="sm:col-span-1 flex items-center justify-center rounded border border-rose-200 bg-rose-50 hover:bg-rose-100 p-1.5 text-rose-700"
                      title="Remove part row"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 5: Mandatory Engineer Replacement Policy & Easy Inline Signatures */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-4">
            {/* Mandatory Policy Callout */}
            <div className="rounded-xl border-2 border-rose-500/80 bg-rose-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="h-5 w-5 text-rose-700 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="text-xs font-black tracking-wide text-rose-900">
                    {ENGINEER_REPLACEMENT_POLICY_TEXT}
                  </div>
                  <p className="text-[11px] font-medium text-rose-800">
                    Draw directly with finger or mouse inside each signature box below (auto-saves immediately). Issuing a Job Card PDF prints both completed digital signatures and blank physical engineer sign-off boxes.
                  </p>
                </div>
              </div>
              <div
                className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-black tabular-nums ${
                  engSigCount >= 2
                    ? 'border-emerald-300 bg-emerald-100 text-emerald-900'
                    : anySpareReplacementFlagged
                    ? 'border-rose-400 bg-white text-rose-800'
                    : 'border-slate-300 bg-white text-slate-800'
                }`}
              >
                Engineers Signed: {engSigCount} / 3{' '}
                {anySpareReplacementFlagged && engSigCount < 2 ? '(Need 2–3)' : ''}
              </div>
            </div>

            {/* Row 1: Shift In Charge + Technician / Mould Setter */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <EasySignaturePad
                label="1. Issued By — Shift In Charge *"
                signerName={card.issuedByShiftInCharge?.name || ''}
                onSignerNameChange={(name) =>
                  setCard((prev) => ({
                    ...prev,
                    issuedByShiftInCharge: { ...prev.issuedByShiftInCharge, name },
                  }))
                }
                signerNamePlaceholder="Shift In Charge Full Name"
                value={card.issuedByShiftInCharge?.signature || ''}
                onChange={(sig) =>
                  setCard((prev) => ({
                    ...prev,
                    issuedByShiftInCharge: {
                      ...prev.issuedByShiftInCharge,
                      signature: sig,
                      signedAt: sig ? new Date().toISOString() : undefined,
                    },
                  }))
                }
                requiredBadgeText="REQUIRED TO ISSUE"
                accentColor="navy"
              />

              <EasySignaturePad
                label={
                  isToolingCard
                    ? '2. Executed By — Mould Setter / Maintenance Tech'
                    : '2. Executed By — Maintenance Technician'
                }
                signerName={card.technicianOrSetter?.name || ''}
                onSignerNameChange={(name) =>
                  setCard((prev) => ({
                    ...prev,
                    assignedTechnicianName: name,
                    technicianOrSetter: { ...prev.technicianOrSetter, name },
                  }))
                }
                signerNamePlaceholder={
                  isToolingCard ? 'Mould Setter Name' : 'Maintenance Technician Name'
                }
                value={card.technicianOrSetter?.signature || ''}
                onChange={(sig) =>
                  setCard((prev) => ({
                    ...prev,
                    technicianOrSetter: {
                      ...prev.technicianOrSetter,
                      signature: sig,
                      signedAt: sig ? new Date().toISOString() : undefined,
                    },
                  }))
                }
                requiredBadgeText="EXECUTION SIGN"
                accentColor="emerald"
              />
            </div>

            {/* Row 2: 3 Engineer Signatures */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <EasySignaturePad
                label="3. Engineer 1 Signature (Mech / Plant)"
                signerName={card.engineer1?.name || ''}
                onSignerNameChange={(name) =>
                  setCard((prev) => ({
                    ...prev,
                    engineer1: { ...prev.engineer1, name },
                  }))
                }
                signerNamePlaceholder="Engineer 1 Name"
                value={card.engineer1?.signature || ''}
                onChange={(sig) =>
                  setCard((prev) => ({
                    ...prev,
                    engineer1: {
                      ...prev.engineer1,
                      signature: sig,
                      signedAt: sig ? new Date().toISOString() : undefined,
                    },
                  }))
                }
                requiredBadgeText="ENGINEER 1"
                accentColor="amber"
              />

              <EasySignaturePad
                label="4. Engineer 2 Signature (Elec / Auto)"
                signerName={card.engineer2?.name || ''}
                onSignerNameChange={(name) =>
                  setCard((prev) => ({
                    ...prev,
                    engineer2: { ...prev.engineer2, name },
                  }))
                }
                signerNamePlaceholder="Engineer 2 Name"
                value={card.engineer2?.signature || ''}
                onChange={(sig) =>
                  setCard((prev) => ({
                    ...prev,
                    engineer2: {
                      ...prev.engineer2,
                      signature: sig,
                      signedAt: sig ? new Date().toISOString() : undefined,
                    },
                  }))
                }
                requiredBadgeText="ENGINEER 2"
                accentColor="amber"
              />

              <EasySignaturePad
                label="5. Engineer 3 Signature (Chief Eng / HOD)"
                signerName={card.engineer3?.name || ''}
                onSignerNameChange={(name) =>
                  setCard((prev) => ({
                    ...prev,
                    engineer3: { ...prev.engineer3, name },
                  }))
                }
                signerNamePlaceholder="Engineer 3 / Chief Eng. Name"
                value={card.engineer3?.signature || ''}
                onChange={(sig) =>
                  setCard((prev) => ({
                    ...prev,
                    engineer3: {
                      ...prev.engineer3,
                      signature: sig,
                      signedAt: sig ? new Date().toISOString() : undefined,
                    },
                  }))
                }
                requiredBadgeText="ENGINEER 3"
                accentColor="rose"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <div className="text-[11px] text-slate-600">
                {anySpareReplacementFlagged && engSigCount < 2 ? (
                  <span className="font-bold text-rose-700">
                    Policy Hold: Part replacement flagged — physical/digital authorization requires 2 or 3 Engineer signatures before part replacement is executed.
                  </span>
                ) : (
                  <span className="font-medium text-emerald-700">
                    Ready to save &amp; issue official LG PLAST Job Card PDF to Maintenance Team.
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={saving || issuingPdf}
                  onClick={() => handleSaveCard(false)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-800 transition disabled:opacity-50"
                >
                  <Save className="h-4 w-4 text-[#0F1E36]" />
                  <span>{saving ? 'Saving...' : 'Save & Sync Job Card'}</span>
                </button>
                <button
                  type="button"
                  disabled={saving || issuingPdf}
                  onClick={() => handleSaveCard(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-5 py-2.5 text-xs font-bold text-white shadow-xs transition disabled:opacity-50"
                >
                  <FileDown className="h-4 w-4" />
                  <span>{issuingPdf ? 'Generating PDF...' : 'Save & Issue PDF'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ISSUED JOB CARDS LOG */}
      {subTab === 'log' && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <h3 className="text-sm font-bold text-slate-900">
              Issued Maintenance, Die &amp; Mould Job Cards ({filteredLogCards.length})
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search card no, machine, die/mould, rack..."
                  className="rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs w-60"
                />
              </div>
              <select
                value={typeFilter}
                onChange={(e) =>
                  setTypeFilter(e.target.value as 'ALL' | MaintenanceJobCardType)
                }
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold"
              >
                <option value="ALL">All Formats</option>
                <option value="STANDARD_MAINTENANCE">Standard Maintenance</option>
                <option value="EXTRUSION_DIE_CHANGE">Extrusion Die Change</option>
                <option value="INJECTION_MOULD_CHANGE">Injection Mould Change</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold"
              >
                <option value="ALL">All Statuses</option>
                <option value="ISSUED">Issued</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="AWAITING_ENGINEER_SIGNS">Awaiting Engineer Signs</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </div>
          </div>

          {filteredLogCards.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              No Maintenance or Die/Mould Change Job Cards match this filter yet.
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredLogCards.map((item) => {
                const engCount = countEngineerSignatures(item);
                const doneStages = item.stages.filter((s) => s.completed).length;
                const isTool =
                  item.cardType === 'EXTRUSION_DIE_CHANGE' ||
                  item.cardType === 'INJECTION_MOULD_CHANGE';
                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-black text-[#0F1E36]">{item.jobCardNo}</span>
                        <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-800">
                          {getCardTypeLabel(item.cardType)}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                            item.status === 'COMPLETED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : item.status === 'AWAITING_ENGINEER_SIGNS'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {item.status.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {item.date} ({item.shift}) · {item.machine}
                        </span>
                      </div>

                      <div className="text-xs font-bold text-slate-900">{item.workTitle}</div>

                      <div className="text-[11px] text-slate-600 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                        <span>
                          Issued By: <b>{item.issuedByShiftInCharge?.name || '—'}</b>
                        </span>
                        <span>
                          Stages Logged: <b>{doneStages}/{item.stages.length}</b>
                        </span>
                        <span
                          className={
                            item.replacementRequired && engCount < 2
                              ? 'font-bold text-rose-700'
                              : 'font-semibold text-emerald-700'
                          }
                        >
                          Engineer Signs: {engCount}/3
                          {item.replacementRequired && engCount < 2 ? ' (Need 2–3)' : ''}
                        </span>
                        {isTool && item.storageRackLocation && (
                          <span className="text-sky-800 font-semibold">
                            Storage Rack: {item.storageRackLocation}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setCard(item);
                          setSubTab('create');
                        }}
                        className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 px-3 py-2 text-xs font-bold text-slate-800"
                      >
                        <ShieldCheck className="h-3.5 w-3.5 text-[#0F1E36]" />
                        <span>Open / Update &amp; Sign</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => generateMaintenanceJobCardPdf(item)}
                        className="flex items-center gap-1 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-3 py-2 text-xs font-bold text-white"
                      >
                        <FileDown className="h-3.5 w-3.5" />
                        <span>PDF</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
