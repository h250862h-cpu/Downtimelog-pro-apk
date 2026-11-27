import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileDown,
  FileSpreadsheet,
  FlaskConical,
  Lock,
  PenTool,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { DigitalSignaturePad } from './DigitalSignaturePad';
import { ymd } from '../services/downtimeCalc';
import { generateQualityTrialPdf } from '../services/qualityTrialPdf';
import { exportQualityTrialsExcel, saveQualityTrialToFirebase } from '../services/qualityTrialStore';
import {
  checkQualityTrialCompleteness,
  generateQualityTrialTemplate,
} from '../services/qualityTrialTemplates';
import {
  QualityStandardTestItem,
  QualityTrialCategory,
  QualityTrialFormulationRow,
  QualityTrialReport,
  QualityTrialVerdict,
} from '../types';
import { MASTER_JOB_CARDS } from '../types/jobCards';

interface QualityTrialViewProps {
  machines: string[];
  trials: QualityTrialReport[];
  isAdmin: boolean;
  currentUserName: string;
  currentUserEmail: string;
}

const TRIAL_CATEGORIES: QualityTrialCategory[] = [
  'Additive / Formula Change',
  'Scrap / Regrind Ratio',
  'New Raw Material / Supplier',
  'Masterbatch / Colourant',
  'Process / Tooling Optimization',
  'New Product Qualification',
];

function createEmptyTrial(
  userName: string,
  userEmail: string,
  defaultProduct = MASTER_JOB_CARDS[0]
): QualityTrialReport {
  const tpl = generateQualityTrialTemplate(defaultProduct, 'Additive / Formula Change');
  return {
    id: `QTR-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    trialNo: `TRL-${ymd(new Date()).replace(/-/g, '').slice(2)}-${String(Date.now()).slice(-3)}`,
    qmsDocCode: 'QMS-LG-TRL-04',
    date: ymd(new Date()),
    shift: new Date().getHours() >= 7 && new Date().getHours() < 19 ? 'Day' : 'Night',
    product: defaultProduct,
    productFamily: tpl.productFamily,
    machine: tpl.recommendedMachine,
    trialCategory: 'Additive / Formula Change',
    applicableStandards: tpl.applicableStandards,
    objectiveSummary: '',
    scrapRatioPct: '',
    additiveDetails: '',
    newMaterialSource: '',
    machineTempProfile: '',
    extrusionOrCycleRate: '',
    formulationRows: tpl.defaultFormulation,
    qcTests: tpl.tests,
    overallVerdict: '',
    recommendations: '',
    conductedByName: userName,
    conductedByEmail: userEmail,
    conductorSignature: '',
    conductedAt: new Date().toISOString(),
    reviewedByHodName: '',
    hodSignature: '',
    status: 'DRAFT',
    upd: Date.now(),
  };
}

export const QualityTrialView: React.FC<QualityTrialViewProps> = ({
  machines,
  trials,
  isAdmin,
  currentUserName,
  currentUserEmail,
}) => {
  const [subTab, setSubTab] = useState<'conduct' | 'register'>('conduct');
  const [trial, setTrial] = useState<QualityTrialReport>(() =>
    createEmptyTrial(currentUserName, currentUserEmail)
  );
  const [customProductMode, setCustomProductMode] = useState(false);
  const [sigTarget, setSigTarget] = useState<
    | null
    | 'conductor'
    | 'hod'
    | 'factoryManager'
    | 'productionHod'
    | 'technicalHead'
    | 'departmentHead'
    | 'qc'
    | 'electricalHead'
    | 'operator'
  >(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; isError?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');

  const completeness = useMemo(() => checkQualityTrialCompleteness(trial), [trial]);

  const showToast = (text: string, isError = false) => {
    setStatusMsg({ text, isError });
    setTimeout(() => setStatusMsg(null), 5000);
  };

  const applyProductAndCategoryTemplate = (
    nextProduct: string,
    nextCategory: QualityTrialCategory,
    preserveFilledResults = false
  ) => {
    const tpl = generateQualityTrialTemplate(nextProduct, nextCategory);
    setTrial((prev) => ({
      ...prev,
      product: nextProduct,
      productFamily: tpl.productFamily,
      machine: tpl.recommendedMachine,
      trialCategory: nextCategory,
      applicableStandards: tpl.applicableStandards,
      formulationRows:
        preserveFilledResults && prev.formulationRows.length > 0
          ? prev.formulationRows
          : tpl.defaultFormulation,
      qcTests: preserveFilledResults ? prev.qcTests : tpl.tests,
    }));
  };

  const handleSaveTrial = async () => {
    setSaving(true);
    const updated: QualityTrialReport = {
      ...trial,
      conductedAt: new Date().toISOString(),
      status: completeness.isComplete ? 'COMPLETED' : 'DRAFT',
      upd: Date.now(),
    };
    const res = await saveQualityTrialToFirebase(updated);
    setTrial(updated);
    setSaving(false);
    showToast(
      res.ok
        ? updated.status === 'COMPLETED'
          ? `Quality Trial ${updated.trialNo} saved as COMPLETED (PDF Unlocked).`
          : `Draft ${updated.trialNo} saved (${completeness.completedTestsCount}/${completeness.totalTestsCount} QC tests filled).`
        : `Saved locally (${res.error || 'offline'}).`
    );
  };

  const handleGeneratePdf = async () => {
    if (!completeness.isComplete) {
      showToast(
        `PDF Locked: Please complete all fields & QC tests (${completeness.missingFields[0]}).`,
        true
      );
      return;
    }
    setGeneratingPdf(true);
    const completedRecord: QualityTrialReport = {
      ...trial,
      status: 'COMPLETED',
      conductedAt: trial.conductedAt || new Date().toISOString(),
      upd: Date.now(),
    };
    await saveQualityTrialToFirebase(completedRecord);
    setTrial(completedRecord);

    const res = await generateQualityTrialPdf(completedRecord);
    setGeneratingPdf(false);
    if (!res.ok) {
      showToast(res.error || 'Could not generate QMS PDF.', true);
    } else {
      showToast(`Official LG PLAST QMS Trial PDF generated (${completedRecord.trialNo}).`);
    }
  };

  const handleUpdateTest = (
    id: string,
    patch: Partial<QualityStandardTestItem>
  ) => {
    setTrial((prev) => ({
      ...prev,
      qcTests: prev.qcTests.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  };

  const handleAddCustomTest = () => {
    const newRow: QualityStandardTestItem = {
      id: `TST-CUS-${Date.now().toString(36).toUpperCase()}`,
      testName: '',
      standardRef: 'QMS-LG-QC / ISO 9001',
      method: 'Lab Verification',
      unit: 'Pass/Fail',
      specRequirement: '',
      actualResult: '',
      verdict: '',
    };
    setTrial((prev) => ({ ...prev, qcTests: [...prev.qcTests, newRow] }));
  };

  const handleRemoveTest = (id: string) => {
    setTrial((prev) => ({
      ...prev,
      qcTests: prev.qcTests.filter((t) => t.id !== id),
    }));
  };

  const handleUpdateFormulation = (
    idx: number,
    patch: Partial<QualityTrialFormulationRow>
  ) => {
    setTrial((prev) => ({
      ...prev,
      formulationRows: prev.formulationRows.map((row, i) =>
        i === idx ? { ...row, ...patch } : row
      ),
    }));
  };

  const handleAddFormulationRow = () => {
    setTrial((prev) => ({
      ...prev,
      formulationRows: [
        ...prev.formulationRows,
        { ingredientName: '', role: 'Additive', ratioOrPhr: '', batchQtyKg: '' },
      ],
    }));
  };

  const filteredTrials = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    if (!q) return trials;
    return trials.filter(
      (t) =>
        t.trialNo.toLowerCase().includes(q) ||
        t.product.toLowerCase().includes(q) ||
        t.trialCategory.toLowerCase().includes(q) ||
        t.conductedByName.toLowerCase().includes(q)
    );
  }, [trials, searchFilter]);

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#0F1E36]">
              <FlaskConical className="h-4 w-4 text-sky-700" />
              <span>Quality Trials &amp; R&amp;D Formulation Control (ISO · QMS · ASTM · SAZ)</span>
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
              Product Quality Trial Evaluation &amp; Certificate
            </h2>
            <p className="text-xs text-slate-600">
              Select any LG PLAST product (additive, scrap ratio, or new raw material) to auto-generate ISO/QMS/ASTM/SAZ required QC tests. PDF unlocks only once 100% complete (1-page preferred, max 2 pages).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSubTab('conduct')}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                subTab === 'conduct'
                  ? 'bg-[#0F1E36] text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <ClipboardCheck className="h-3.5 w-3.5" />
              <span>Conduct Trial</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('register')}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                subTab === 'register'
                  ? 'bg-[#0F1E36] text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <FlaskConical className="h-3.5 w-3.5" />
              <span>Saved Trial Register ({trials.length})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTrial(createEmptyTrial(currentUserName, currentUserEmail));
                setCustomProductMode(false);
                setSubTab('conduct');
              }}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Blank Trial</span>
            </button>
          </div>
        </div>
      </div>

      {statusMsg && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs font-semibold ${
            statusMsg.isError
              ? 'border-rose-300 bg-rose-50 text-rose-800'
              : 'border-emerald-300 bg-emerald-50 text-emerald-900'
          }`}
        >
          {statusMsg.text}
        </div>
      )}

      {/* TAB 1: CONDUCT & COMPLETE TRIAL */}
      {subTab === 'conduct' && (
        <div className="space-y-4">
          {/* Completeness & PDF Unlock Progress Strip */}
          <div
            className={`rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              completeness.isComplete
                ? 'border-emerald-300 bg-emerald-50'
                : 'border-amber-300 bg-amber-50'
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold">
                {completeness.isComplete ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-700" />
                )}
                <span className={completeness.isComplete ? 'text-emerald-900' : 'text-amber-900'}>
                  {completeness.isComplete
                    ? `All Trial Fields & QC Tests Complete (${completeness.completedTestsCount}/${completeness.totalTestsCount}) — QMS Trial PDF Unlocked`
                    : `Trial Incomplete (${completeness.completedTestsCount}/${completeness.totalTestsCount} QC tests completed) — Complete all required fields to unlock PDF`}
                </span>
              </div>
              {!completeness.isComplete && (
                <div className="text-[11px] text-amber-800">
                  Remaining: {completeness.missingFields.slice(0, 4).join(' • ')}
                  {completeness.missingFields.length > 4
                    ? ` (+${completeness.missingFields.length - 4} more)`
                    : ''}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleSaveTrial}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{saving ? 'Saving...' : 'Save Trial'}</span>
              </button>

              <button
                type="button"
                onClick={handleGeneratePdf}
                disabled={!completeness.isComplete || generatingPdf}
                title={
                  completeness.isComplete
                    ? 'Generate Portrait A4 QMS Trial Report PDF (1-page preferred, max 2 pages)'
                    : 'Locked until all trial information and QC test results are completed'
                }
                className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition ${
                  completeness.isComplete
                    ? 'bg-[#0F1E36] hover:bg-[#193054] text-white shadow-xs'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
              >
                {completeness.isComplete ? (
                  <FileDown className="h-4 w-4" />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
                <span>
                  {generatingPdf ? 'Generating...' : 'Generate QMS Trial PDF'}
                </span>
              </button>
            </div>
          </div>

          {/* Section A: Product, Trial Scope & Standards Header */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
              <h3 className="text-sm font-bold text-[#0F1E36]">
                1. Product Selection, Standards &amp; Trial Parameters
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {trial.applicableStandards.map((std) => (
                  <span
                    key={std}
                    className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-900"
                  >
                    {std}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Trial Report No. *</label>
                <input
                  type="text"
                  value={trial.trialNo}
                  onChange={(e) => setTrial((p) => ({ ...p, trialNo: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono font-semibold"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Trial Date *</label>
                <input
                  type="date"
                  value={trial.date}
                  onChange={(e) => setTrial((p) => ({ ...p, date: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Shift</label>
                <select
                  value={trial.shift}
                  onChange={(e) =>
                    setTrial((p) => ({ ...p, shift: e.target.value as 'Day' | 'Night' }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="Day">Day Shift</option>
                  <option value="Night">Night Shift</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Trial Category *</label>
                <select
                  value={trial.trialCategory}
                  onChange={(e) =>
                    applyProductAndCategoryTemplate(
                      trial.product,
                      e.target.value as QualityTrialCategory,
                      true
                    )
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-semibold"
                >
                  {TRIAL_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700">
                    Product to be Trialed * (Auto-generates ISO/QMS/ASTM/SAZ tests)
                  </label>
                  <label className="flex items-center gap-1 text-[11px] font-semibold text-[#0F1E36] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={customProductMode}
                      onChange={(e) => setCustomProductMode(e.target.checked)}
                    />
                    Type Custom Product
                  </label>
                </div>
                <div className="flex gap-2">
                  {customProductMode ? (
                    <input
                      type="text"
                      value={trial.product}
                      onChange={(e) => setTrial((p) => ({ ...p, product: e.target.value }))}
                      placeholder="Enter any new or special polymer product name..."
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-semibold"
                    />
                  ) : (
                    <select
                      value={MASTER_JOB_CARDS.includes(trial.product) ? trial.product : MASTER_JOB_CARDS[0]}
                      onChange={(e) =>
                        applyProductAndCategoryTemplate(
                          e.target.value,
                          trial.trialCategory,
                          false
                        )
                      }
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-semibold"
                    >
                      {MASTER_JOB_CARDS.map((prod) => (
                        <option key={prod} value={prod}>
                          {prod}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      applyProductAndCategoryTemplate(trial.product, trial.trialCategory, false)
                    }
                    className="flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 px-3 py-2 font-semibold text-slate-800 shrink-0"
                    title="Auto-generate required standard QC tests for this product"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Load Tests</span>
                  </button>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Detected Family: <b className="text-[#0F1E36]">{trial.productFamily}</b>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Trial Machine *</label>
                <select
                  value={trial.machine}
                  onChange={(e) => setTrial((p) => ({ ...p, machine: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  {machines.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Scrap / Regrind Ratio (%)
                  {trial.trialCategory === 'Scrap / Regrind Ratio' && ' *'}
                </label>
                <input
                  type="text"
                  value={trial.scrapRatioPct || ''}
                  onChange={(e) => setTrial((p) => ({ ...p, scrapRatioPct: e.target.value }))}
                  placeholder="e.g. 15% Regrind / 85% Virgin"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Additive / Formula / Colourant Change
                  {(trial.trialCategory === 'Additive / Formula Change' ||
                    trial.trialCategory === 'Masterbatch / Colourant') &&
                    ' *'}
                </label>
                <input
                  type="text"
                  value={trial.additiveDetails || ''}
                  onChange={(e) => setTrial((p) => ({ ...p, additiveDetails: e.target.value }))}
                  placeholder="e.g. Ca-Zn Stabilizer 3.2 PHR + Impact Mod 1.5 PHR"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  New Raw Material / Supplier Lot
                  {trial.trialCategory === 'New Raw Material / Supplier' && ' *'}
                </label>
                <input
                  type="text"
                  value={trial.newMaterialSource || ''}
                  onChange={(e) =>
                    setTrial((p) => ({ ...p, newMaterialSource: e.target.value }))
                  }
                  placeholder="e.g. Formosa SG-5 Batch #F26-11"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="sm:col-span-1">
                <label className="block font-semibold text-slate-700 mb-1">
                  Barrel / Mould Temperature Profile
                </label>
                <input
                  type="text"
                  value={trial.machineTempProfile || ''}
                  onChange={(e) =>
                    setTrial((p) => ({ ...p, machineTempProfile: e.target.value }))
                  }
                  placeholder="e.g. Z1:165°C Z2:175°C Z3:182°C Die:188°C"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Running Output / Cycle Speed
                </label>
                <input
                  type="text"
                  value={trial.extrusionOrCycleRate || ''}
                  onChange={(e) =>
                    setTrial((p) => ({ ...p, extrusionOrCycleRate: e.target.value }))
                  }
                  placeholder="e.g. 145 kg/hr or 28s cycle"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Trial Objective / Purpose *
                </label>
                <input
                  type="text"
                  value={trial.objectiveSummary}
                  onChange={(e) => setTrial((p) => ({ ...p, objectiveSummary: e.target.value }))}
                  placeholder="e.g. Evaluate 15% regrind ratio on 110mm SWR drop impact"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
            </div>
          </div>

          {/* Section B: Formulation Recipe */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#0F1E36]">
                2. Trial Formulation / Material Recipe
              </h3>
              <button
                type="button"
                onClick={handleAddFormulationRow}
                className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Component</span>
              </button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-2.5 py-2 font-semibold">Material / Additive Name *</th>
                    <th className="px-2.5 py-2 font-semibold">Role</th>
                    <th className="px-2.5 py-2 font-semibold">Ratio / PHR / % *</th>
                    <th className="px-2.5 py-2 font-semibold">Batch Qty (kg)</th>
                    <th className="px-2.5 py-2 font-semibold">Supplier / Lot Ref</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {trial.formulationRows.map((row, idx) => (
                    <tr key={idx}>
                      <td className="p-2">
                        <input
                          type="text"
                          value={row.ingredientName}
                          onChange={(e) =>
                            handleUpdateFormulation(idx, { ingredientName: e.target.value })
                          }
                          className="w-full rounded border border-slate-300 px-2 py-1.5"
                          placeholder="Material name"
                        />
                      </td>
                      <td className="p-2">
                        <select
                          value={row.role}
                          onChange={(e) =>
                            handleUpdateFormulation(idx, {
                              role: e.target.value as QualityTrialFormulationRow['role'],
                            })
                          }
                          className="w-full rounded border border-slate-300 px-2 py-1.5"
                        >
                          <option value="Base Resin">Base Resin</option>
                          <option value="Recycled Scrap">Recycled Scrap</option>
                          <option value="Additive">Additive</option>
                          <option value="Stabilizer">Stabilizer</option>
                          <option value="Filler / CaCO3">Filler / CaCO3</option>
                          <option value="Pigment / Masterbatch">Pigment / Masterbatch</option>
                          <option value="Other">Other</option>
                        </select>
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={row.ratioOrPhr}
                          onChange={(e) =>
                            handleUpdateFormulation(idx, { ratioOrPhr: e.target.value })
                          }
                          className="w-full rounded border border-slate-300 px-2 py-1.5 font-semibold"
                          placeholder="e.g. 15% or 3.0 PHR"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={row.batchQtyKg || ''}
                          onChange={(e) =>
                            handleUpdateFormulation(idx, { batchQtyKg: e.target.value })
                          }
                          className="w-full rounded border border-slate-300 px-2 py-1.5 tabular-nums"
                          placeholder="kg"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={row.supplierOrLot || ''}
                          onChange={(e) =>
                            handleUpdateFormulation(idx, { supplierOrLot: e.target.value })
                          }
                          className="w-full rounded border border-slate-300 px-2 py-1.5"
                          placeholder="Lot #"
                        />
                      </td>
                      <td className="p-2 text-right">
                        {trial.formulationRows.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setTrial((p) => ({
                                ...p,
                                formulationRows: p.formulationRows.filter((_, i) => i !== idx),
                              }))
                            }
                            className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section C: Auto-Generated ISO/QMS/ASTM/SAZ Quality Control Tests */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-[#0F1E36]">
                  3. Required Quality Control Tests ({completeness.completedTestsCount}/
                  {completeness.totalTestsCount} Complete)
                </h3>
                <p className="text-xs text-slate-500">
                  Generated per ISO, QMS, ASTM &amp; SAZ standards for {trial.productFamily}. Every test requires an Actual Result and PASS/FAIL Verdict.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddCustomTest}
                className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Custom QC Test</span>
              </button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#0F1E36] text-white">
                  <tr>
                    <th className="px-2.5 py-2 font-semibold">#</th>
                    <th className="px-2.5 py-2 font-semibold">Quality Test</th>
                    <th className="px-2.5 py-2 font-semibold">ISO / QMS / ASTM / SAZ</th>
                    <th className="px-2.5 py-2 font-semibold">Specification Limit</th>
                    <th className="px-2.5 py-2 font-semibold">Actual Measured Result *</th>
                    <th className="px-2.5 py-2 font-semibold">Verdict *</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {trial.qcTests.map((t, idx) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-2.5 py-2 font-bold text-slate-500 tabular-nums">{idx + 1}</td>
                      <td className="p-2 min-w-[180px]">
                        <input
                          type="text"
                          value={t.testName}
                          onChange={(e) => handleUpdateTest(t.id, { testName: e.target.value })}
                          className="w-full rounded border border-slate-200 px-2 py-1 font-semibold text-slate-900"
                        />
                        <div className="text-[10px] text-slate-500 mt-0.5">{t.method}</div>
                      </td>
                      <td className="p-2 min-w-[140px]">
                        <input
                          type="text"
                          value={t.standardRef}
                          onChange={(e) => handleUpdateTest(t.id, { standardRef: e.target.value })}
                          className="w-full rounded border border-slate-200 px-2 py-1 font-mono text-[11px] text-[#0F1E36]"
                        />
                      </td>
                      <td className="p-2 min-w-[170px]">
                        <input
                          type="text"
                          value={t.specRequirement}
                          onChange={(e) =>
                            handleUpdateTest(t.id, { specRequirement: e.target.value })
                          }
                          className="w-full rounded border border-slate-200 px-2 py-1 text-[11px]"
                        />
                      </td>
                      <td className="p-2 min-w-[145px]">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={t.actualResult}
                            onChange={(e) =>
                              handleUpdateTest(t.id, { actualResult: e.target.value })
                            }
                            placeholder={`Enter (${t.unit})`}
                            className={`w-full rounded border px-2 py-1.5 font-semibold ${
                              t.actualResult.trim()
                                ? 'border-emerald-300 bg-white'
                                : 'border-amber-300 bg-amber-50/50'
                            }`}
                          />
                        </div>
                      </td>
                      <td className="p-2 min-w-[105px]">
                        <select
                          value={t.verdict}
                          onChange={(e) =>
                            handleUpdateTest(t.id, {
                              verdict: e.target.value as 'PASS' | 'FAIL' | '',
                            })
                          }
                          className={`w-full rounded border px-2 py-1.5 font-bold ${
                            t.verdict === 'PASS'
                              ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                              : t.verdict === 'FAIL'
                              ? 'border-rose-400 bg-rose-50 text-rose-800'
                              : 'border-amber-300 bg-amber-50 text-slate-700'
                          }`}
                        >
                          <option value="">Select...</option>
                          <option value="PASS">PASS</option>
                          <option value="FAIL">FAIL</option>
                        </select>
                      </td>
                      <td className="p-2 text-right">
                        {trial.qcTests.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveTest(t.id)}
                            className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                            title="Remove test row"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section D: QA Decision, Technical Recommendations & Digital Signatures */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-[#0F1E36]">
              4. QA Disposition Decision &amp; Official Signatures
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Overall Trial Decision *
                </label>
                <select
                  value={trial.overallVerdict}
                  onChange={(e) =>
                    setTrial((p) => ({
                      ...p,
                      overallVerdict: e.target.value as QualityTrialVerdict,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
                >
                  <option value="">Select Decision...</option>
                  <option value="APPROVED_FOR_PRODUCTION">APPROVED FOR PRODUCTION</option>
                  <option value="CONDITIONAL_RELEASE">CONDITIONAL RELEASE (MONITOR)</option>
                  <option value="REJECTED_HOLD">REJECTED / HOLD FORMULATION</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Trial Conductor Name *
                </label>
                <input
                  type="text"
                  value={trial.conductedByName}
                  onChange={(e) =>
                    setTrial((p) => ({ ...p, conductedByName: e.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  HOD / QA Reviewer Name (Optional)
                </label>
                <input
                  type="text"
                  value={trial.reviewedByHodName || ''}
                  onChange={(e) =>
                    setTrial((p) => ({ ...p, reviewedByHodName: e.target.value }))
                  }
                  placeholder="Production HOD or QA Manager"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
            </div>

            <div className="text-xs">
              <label className="block font-semibold text-slate-700 mb-1">
                Technical Findings &amp; Recommendations *
              </label>
              <textarea
                rows={2}
                value={trial.recommendations}
                onChange={(e) =>
                  setTrial((p) => ({ ...p, recommendations: e.target.value }))
                }
                placeholder="Summarize melt behaviour, mechanical test outcomes, colour consistency, and release recommendation..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="space-y-2.5 border-t border-slate-200 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-[#0F1E36] uppercase tracking-wider">
                    Trial Paper Form Sign-Off Hierarchy (Arranged by Importance)
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    All 7 approval boxes render in order of authority on the generated PDF paper form for digital or physical pen signing.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                {(
                  [
                    ['factoryManager', '1. Factory Manager', 'Executive Authorization'],
                    ['productionHod', '2. Production HOD', 'Production Approval'],
                    ['technicalHead', '3. Technical Head', 'Formulation & Process'],
                    ['departmentHead', '4. Department Head', 'Section Head Review'],
                    ['qc', '5. Quality Control (QC)', 'ISO / ASTM / SAZ Verify'],
                    ['electricalHead', '6. Electrical Head', 'Heaters & Power Drives'],
                    ['operator', '7. Machine Operator', 'Floor Trial Execution'],
                  ] as const
                ).map(([roleKey, roleTitle, roleSub]) => {
                  const slot = trial.trialApprovals?.[roleKey] || {};
                  const fallbackName =
                    roleKey === 'qc'
                      ? slot.name ?? trial.conductedByName
                      : roleKey === 'productionHod'
                      ? slot.name ?? (trial.reviewedByHodName || '')
                      : slot.name || '';
                  const hasSig =
                    Boolean(slot.signature) ||
                    (roleKey === 'qc' && Boolean(trial.conductorSignature)) ||
                    (roleKey === 'productionHod' && Boolean(trial.hodSignature));

                  return (
                    <div
                      key={roleKey}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-1.5"
                    >
                      <div className="text-[11px] font-bold text-[#0F1E36]">{roleTitle}</div>
                      <div className="text-[10px] text-slate-500">{roleSub}</div>
                      <input
                        type="text"
                        value={fallbackName}
                        onChange={(e) => {
                          const val = e.target.value;
                          setTrial((p) => ({
                            ...p,
                            ...(roleKey === 'qc' ? { conductedByName: val } : {}),
                            ...(roleKey === 'productionHod' ? { reviewedByHodName: val } : {}),
                            trialApprovals: {
                              ...(p.trialApprovals || {}),
                              [roleKey]: {
                                ...(p.trialApprovals?.[roleKey] || {}),
                                name: val,
                              },
                            },
                          }));
                        }}
                        placeholder="Signatory Name (or sign paper)"
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-[11px]"
                      />
                      <button
                        type="button"
                        onClick={() => setSigTarget(roleKey)}
                        className={`w-full flex items-center justify-center gap-1 rounded border px-2 py-1 text-[11px] font-semibold transition ${
                          hasSig
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <PenTool className="h-3 w-3" />
                        <span>{hasSig ? 'Signed Digitally ✓' : 'Capture Signature'}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSigTarget('conductor')}
                  className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold ${
                    trial.conductorSignature
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                      : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <PenTool className="h-3.5 w-3.5" />
                  <span>
                    {trial.conductorSignature
                      ? 'Conductor Signed ✓'
                      : 'Capture Conductor Signature *'}
                  </span>
                </button>

                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setSigTarget('hod')}
                    className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold ${
                      trial.hodSignature
                        ? 'border-sky-300 bg-sky-50 text-sky-900'
                        : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <PenTool className="h-3.5 w-3.5" />
                    <span>
                      {trial.hodSignature ? 'HOD Reviewed Signed ✓' : 'Add HOD Signature (Optional)'}
                    </span>
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={handleGeneratePdf}
                disabled={!completeness.isComplete || generatingPdf}
                className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-xs font-bold transition ${
                  completeness.isComplete
                    ? 'bg-[#0F1E36] hover:bg-[#193054] text-white shadow-xs'
                    : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                }`}
              >
                {completeness.isComplete ? (
                  <FileDown className="h-4 w-4" />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
                <span>
                  {completeness.isComplete
                    ? 'Generate 1-Page QMS Trial PDF'
                    : 'Fill All Required Info to Unlock PDF'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SAVED TRIAL REGISTER & ADMIN-ONLY EXCEL */}
      {subTab === 'register' && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search trials by product, trial no., category, or conductor..."
              className="w-full sm:w-80 rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
            {isAdmin && (
              <button
                type="button"
                onClick={async () => {
                  showToast('Compiling Quality Trials Excel (.xlsx) in background...');
                  await exportQualityTrialsExcel(trials, isAdmin);
                  showToast(`Downloaded Quality Trials Excel (${trials.length} records).`);
                }}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 px-4 py-2 text-xs font-bold text-white"
              >
                <FileSpreadsheet className="h-4 w-4" />
                <span>Download Quality Trials Excel (Admin)</span>
              </button>
            )}
          </div>

          {filteredTrials.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-6">
              No saved quality trial reports found.
            </p>
          ) : (
            <div className="space-y-2.5">
              {filteredTrials.map((item) => {
                const check = checkQualityTrialCompleteness(item);
                return (
                  <div
                    key={item.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-[#0F1E36]">{item.trialNo}</span>
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {item.date} · {item.machine}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                            check.isComplete
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {check.isComplete
                            ? item.overallVerdict.replace(/_/g, ' ')
                            : `DRAFT (${check.completedTestsCount}/${check.totalTestsCount} tests)`}
                        </span>
                      </div>
                      <div className="text-xs font-bold text-slate-900">{item.product}</div>
                      <div className="text-[11px] text-slate-600">
                        Category: <b>{item.trialCategory}</b> · Conductor: {item.conductedByName}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setTrial(item);
                          setCustomProductMode(!MASTER_JOB_CARDS.includes(item.product));
                          setSubTab('conduct');
                        }}
                        className="rounded-lg border border-slate-300 bg-white hover:bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-800"
                      >
                        Open / Edit
                      </button>
                      <button
                        type="button"
                        disabled={!check.isComplete}
                        onClick={() => generateQualityTrialPdf(item)}
                        className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold ${
                          check.isComplete
                            ? 'bg-[#0F1E36] hover:bg-[#193054] text-white'
                            : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        {check.isComplete ? (
                          <FileDown className="h-3.5 w-3.5" />
                        ) : (
                          <Lock className="h-3.5 w-3.5" />
                        )}
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

      <DigitalSignaturePad
        isOpen={sigTarget !== null}
        onClose={() => setSigTarget(null)}
        initialRole={
          sigTarget === 'hod' ||
          sigTarget === 'factoryManager' ||
          sigTarget === 'productionHod' ||
          sigTarget === 'technicalHead' ||
          sigTarget === 'departmentHead'
            ? 'supervisor'
            : 'technician'
        }
        initialName={
          sigTarget && sigTarget !== 'conductor' && sigTarget !== 'hod'
            ? trial.trialApprovals?.[sigTarget]?.name || currentUserName
            : currentUserName
        }
        logTitle={`Quality Trial ${trial.trialNo}`}
        equipmentId={trial.product}
        onSaveSignature={(data) => {
          const nowIso = new Date().toISOString();
          if (sigTarget === 'conductor') {
            setTrial((p) => ({
              ...p,
              conductedByName: data.name || p.conductedByName,
              conductorSignature: data.signature,
            }));
          } else if (sigTarget === 'hod' || sigTarget === 'productionHod') {
            setTrial((p) => ({
              ...p,
              reviewedByHodName: data.name || p.reviewedByHodName,
              hodSignature: data.signature,
              hodReviewedAt: nowIso,
              trialApprovals: {
                ...(p.trialApprovals || {}),
                productionHod: {
                  name: data.name || p.reviewedByHodName,
                  signature: data.signature,
                  signedAt: nowIso,
                },
              },
            }));
          } else if (sigTarget) {
            setTrial((p) => ({
              ...p,
              ...(sigTarget === 'qc' && !p.conductorSignature
                ? {
                    conductedByName: data.name || p.conductedByName,
                    conductorSignature: data.signature,
                  }
                : {}),
              trialApprovals: {
                ...(p.trialApprovals || {}),
                [sigTarget]: {
                  name: data.name,
                  signature: data.signature,
                  signedAt: nowIso,
                },
              },
            }));
          }
        }}
      />
    </div>
  );
};
