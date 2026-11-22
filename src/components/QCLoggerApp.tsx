import React, { useState } from 'react';
import * as XLSX from '../utils/xlsxCompat';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Cloud,
  CloudOff,
  Download,
  FileSpreadsheet,
  Filter,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import {
  flushPendingQCLogs,
  saveLocalQCLogs,
  syncQCLogToFirebase,
} from '../services/attendanceStore';
import { normalizeMachineName } from '../types';
import { QCInspectionRecord } from '../types/attendance';
import { LgplastLogo } from './LgplastLogo';

interface QCLoggerAppProps {
  logs: QCInspectionRecord[];
  onUpdateLogs: (newLogs: QCInspectionRecord[]) => void;
  onBackToDashboard: () => void;
  machines: string[];
  userEmail: string;
  isAdmin?: boolean;
}

export const QCLoggerApp: React.FC<QCLoggerAppProps> = ({
  logs,
  onUpdateLogs,
  onBackToDashboard,
  machines,
  userEmail,
  isAdmin = false,
}) => {
  // WhatsApp copy-paste text state
  const [inputText, setInputText] = useState('');
  const [activeTab, setActiveTab] = useState<'paste' | 'manual' | 'history'>('paste');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isFlushingSync, setIsFlushingSync] = useState(false);

  const pendingCount = logs.filter((l) => l.synced === false).length;

  const handleFlushSync = async () => {
    setIsFlushingSync(true);
    const res = await flushPendingQCLogs();
    setIsFlushingSync(false);
    if (res.failed === 0) {
      showToast(`All ${res.success} pending records synced to Firebase!`);
    } else {
      showToast(`Synced ${res.success} records. ${res.failed} waiting for connection.`);
    }
  };

  // Manual Form State
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [shift, setShift] = useState<'Day' | 'Night' | 'Unknown'>('Day');
  const [machineOrLine, setMachineOrLine] = useState<string>(machines[0] || 'Extrusion Machine 1');
  const [product, setProduct] = useState<string>('');
  const [samplesTested, setSamplesTested] = useState<number>(10);
  const [passedCount, setPassedCount] = useState<number>(10);
  const [defectsCount, setDefectsCount] = useState<number>(0);
  const [defectReason, setDefectReason] = useState<string>('None');
  const [status, setStatus] = useState<'Passed' | 'Rejected' | 'Hold'>('Passed');
  const [inspector, setInspector] = useState<string>('INNOCENT MAVIYANI');
  const [notes, setNotes] = useState<string>('');

  // Date Filter for Excel Report
  const [filterFromDate, setFilterFromDate] = useState<string>('');
  const [filterToDate, setFilterToDate] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState('');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const sampleQCText = `QC SHIFT INSPECTION REPORT (23/10/2026)
Shift: Day
Inspector: Innocent Maviyani

Extrusion Machine 2 - 50mm Conduit Pipe PVC
Samples tested: 20
Passed: 19
Defects: 1 (Wall thickness variation on bell mouth)
Status: Passed

IM 3 - Electrical Junction Box 4x4
Samples tested: 15
Passed: 15
Defects: 0
Status: Passed

Gumboot Machine - Size 8 Safety Gumboot
Samples tested: 10
Passed: 8
Defects: 2 (Air bubble voids around heel)
Status: Hold`;

  const handlePasteSample = () => {
    setInputText(sampleQCText);
    showToast('Loaded sample WhatsApp QC report.');
  };

  // WhatsApp text parsing into QC Inspection Records
  const handleParseWhatsApp = async () => {
    const text = inputText.trim();
    if (!text) {
      showToast('Please paste a WhatsApp QC inspection message first.');
      return;
    }

    // Extract Date & Shift
    const dateMatch = text.match(/\((\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\)/);
    let parsedDate = new Date().toISOString().slice(0, 10);
    if (dateMatch) {
      let d = +dateMatch[1],
        m = +dateMatch[2],
        y = +dateMatch[3];
      if (y < 100) y += 2000;
      parsedDate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    let parsedShift: 'Day' | 'Night' | 'Unknown' = 'Day';
    if (/shift\s*:\s*night/i.test(text) || /\bnight\b/i.test(text)) parsedShift = 'Night';

    const inspMatch = text.match(/inspector\s*:\s*([^\n\r]+)/i);
    const parsedInspector = inspMatch ? inspMatch[1].trim() : 'Innocent Maviyani';

    // Split blocks by double newline or machine lines
    const blocks = text.split(/\n\s*\n/).filter((b) => !b.startsWith('QC SHIFT'));
    const parsedRecords: QCInspectionRecord[] = [];

    blocks.forEach((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) return;

      const headerLine = lines[0];
      const parts = headerLine.split(/[-–—]/);
      const machineName = parts[0]?.trim() || 'General Line';
      const productName = parts[1]?.trim() || 'Factory Component';

      let tested = 10;
      let passed = 10;
      let defects = 0;
      let reason = 'None';
      let recordStatus: 'Passed' | 'Rejected' | 'Hold' = 'Passed';

      lines.forEach((l) => {
        const testM = l.match(/tested\s*:\s*(\d+)/i);
        if (testM) tested = +testM[1];

        const passM = l.match(/passed\s*:\s*(\d+)/i);
        if (passM) passed = +passM[1];

        const defM = l.match(/defects\s*:\s*(\d+)(?:\s*\(([^)]+)\))?/i);
        if (defM) {
          defects = +defM[1];
          if (defM[2]) reason = defM[2].trim();
        }

        const statM = l.match(/status\s*:\s*(passed|rejected|hold)/i);
        if (statM) {
          const s = statM[1].toLowerCase();
          if (s === 'rejected') recordStatus = 'Rejected';
          else if (s === 'hold') recordStatus = 'Hold';
          else recordStatus = 'Passed';
        }
      });

      parsedRecords.push({
        id: `QC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        date: parsedDate,
        shift: parsedShift,
        machineOrLine: normalizeMachineName(machineName),
        product: productName,
        samplesTested: tested,
        passedCount: passed,
        defectsCount: defects,
        defectReason: reason,
        status: recordStatus,
        inspector: parsedInspector || userEmail.split('@')[0].toUpperCase(),
        notes: `Parsed from WhatsApp shift message`,
        createdAt: Date.now(),
        synced: false,
        loggedBy: userEmail.split('@')[0].toUpperCase(),
        loggedByEmail: userEmail,
      });
    });

    if (parsedRecords.length === 0) {
      showToast('Could not extract QC records. Please verify format.');
      return;
    }

    const updated = [...parsedRecords, ...logs];
    saveLocalQCLogs(updated);
    onUpdateLogs(updated);

    let syncedOk = 0;
    for (const r of parsedRecords) {
      const ok = await syncQCLogToFirebase(r);
      if (ok) syncedOk++;
    }

    setInputText('');
    if (syncedOk === parsedRecords.length) {
      showToast(`Parsed and synced ${parsedRecords.length} QC inspections to Firebase!`);
    } else {
      showToast(`Logged ${parsedRecords.length} records. ${parsedRecords.length - syncedOk} queued in Pending Sync.`);
    }
    setActiveTab('history');
  };

  // Manual save
  const handleManualSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const newRecord: QCInspectionRecord = {
      id: `QC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      date,
      shift,
      machineOrLine: normalizeMachineName(machineOrLine),
      product: product.trim() || 'Standard Part',
      samplesTested: Number(samplesTested) || 1,
      passedCount: Number(passedCount) || 0,
      defectsCount: Number(defectsCount) || 0,
      defectReason: defectReason.trim() || 'None',
      status,
      inspector: inspector.trim() || userEmail.split('@')[0].toUpperCase(),
      notes: notes.trim(),
      createdAt: Date.now(),
      synced: false,
      loggedBy: userEmail.split('@')[0].toUpperCase(),
      loggedByEmail: userEmail,
    };

    const updated = [newRecord, ...logs];
    saveLocalQCLogs(updated);
    onUpdateLogs(updated);

    const ok = await syncQCLogToFirebase(newRecord);
    if (ok) {
      showToast(`Saved and synced QC inspection for ${machineOrLine}.`);
    } else {
      showToast(`Saved locally. Record queued in Pending Sync.`);
    }

    setProduct('');
    setDefectReason('None');
    setNotes('');
    setActiveTab('history');
  };

  // Posted QC inspection records are permanent and cannot be deleted.

  // Excel Export with Date Filtering (Strictly Admin Only)
  const handleExportExcel = () => {
    if (!isAdmin) {
      showToast('QC Excel reports are restricted strictly to Plant Admin / Production HOD.');
      return;
    }
    const filtered = logs.filter((l) => {
      if (filterFromDate && l.date < filterFromDate) return false;
      if (filterToDate && l.date > filterToDate) return false;
      return true;
    });

    if (!filtered.length) {
      showToast('No QC inspection records found for selected dates.');
      return;
    }

    const wb = XLSX.utils.book_new();

    // 1. Inspections Sheet
    const headers = [
      'Date',
      'Shift',
      'Machine / Line',
      'Product',
      'Samples Tested',
      'Passed',
      'Defects',
      'Defect Reason',
      'QC Status',
      'Pass Rate %',
      'Inspector',
      'Notes',
    ];
    const data: (string | number)[][] = [
      ['LG PLAST — Affordable / Durable / Complete'],
      ['FACTORY QUALITY CONTROL (QC) INSPECTION REPORT'],
      [],
      headers,
    ];

    filtered.forEach((l) => {
      const passRate = l.samplesTested > 0 ? (100 * l.passedCount) / l.samplesTested : 0;
      data.push([
        l.date,
        l.shift,
        normalizeMachineName(l.machineOrLine),
        l.product,
        l.samplesTested,
        l.passedCount,
        l.defectsCount,
        l.defectReason,
        l.status,
        `${passRate.toFixed(1)}%`,
        l.inspector,
        l.notes || '',
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [
      { wch: 13 },
      { wch: 9 },
      { wch: 22 },
      { wch: 28 },
      { wch: 15 },
      { wch: 10 },
      { wch: 10 },
      { wch: 35 },
      { wch: 12 },
      { wch: 14 },
      { wch: 20 },
      { wch: 30 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'QC Inspections');

    // 2. Summary Sheet
    let totalTested = 0;
    let totalPassed = 0;
    let totalDefects = 0;
    filtered.forEach((l) => {
      totalTested += l.samplesTested;
      totalPassed += l.passedCount;
      totalDefects += l.defectsCount;
    });

    const overallPassRate = totalTested > 0 ? (100 * totalPassed) / totalTested : 0;

    const sumHeaders = [
      ['LG PLAST — Affordable / Durable / Complete'],
      ['Plant Quality Control (QC) Summary Report'],
      [`Period: ${filterFromDate || 'All'} to ${filterToDate || 'All'}`],
      [],
      ['Metric', 'Value'],
      ['Total Samples Inspected', totalTested],
      ['Total Passed Units', totalPassed],
      ['Total Defective Units', totalDefects],
      ['Overall Quality Pass Rate %', `${overallPassRate.toFixed(1)}%`],
      ['Total Inspection Lots Checked', filtered.length],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(sumHeaders);
    wsSummary['!cols'] = [{ wch: 30 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'QC Summary');

    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const fileName = `LGPLAST_QC_Report_${filterFromDate || 'Batch'}_to_${filterToDate || 'Current'}.xlsx`;

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1500);

    showToast(`Downloaded ${fileName}`);
  };

  const filteredLogs = logs
    .filter((l) => {
      if (filterFromDate && l.date < filterFromDate) return false;
      if (filterToDate && l.date > filterToDate) return false;
      if (searchFilter) {
        const q = searchFilter.toLowerCase();
        return (
          l.machineOrLine.toLowerCase().includes(q) ||
          l.product.toLowerCase().includes(q) ||
          l.defectReason.toLowerCase().includes(q) ||
          l.inspector.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-8">
      {/* Navigation Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToDashboard}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Dashboard</span>
          </button>
          <LgplastLogo size="sm" />
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <ClipboardCheck className="h-4 w-4" />
            </div>
            <h1 className="text-base sm:text-lg font-bold text-white">
              LG PLAST Quality Control (QC) APK
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Pending Sync Queue Badge */}
          {pendingCount > 0 ? (
            <button
              onClick={handleFlushSync}
              disabled={isFlushingSync}
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 border border-amber-500/40 px-3 py-1 text-xs font-bold text-amber-300 hover:bg-amber-500/30 transition animate-pulse"
              title="Local records waiting for network connection before uploading to Firebase"
            >
              <RefreshCw className={`h-3 w-3 text-amber-400 ${isFlushingSync ? 'animate-spin' : ''}`} />
              <span>Pending Sync: <b>{pendingCount}</b> queued</span>
              <span className="text-[10px] underline ml-0.5 font-bold">Upload</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Synced with Firebase</span>
            </span>
          )}

          <div className="flex items-center gap-1 rounded-xl bg-slate-900 border border-slate-800 p-1 text-xs font-semibold">
            <button
              onClick={() => setActiveTab('paste')}
              className={`px-3 py-1 rounded-lg transition ${
                activeTab === 'paste' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              WhatsApp Paste
            </button>
          <button
            onClick={() => setActiveTab('manual')}
            className={`px-3 py-1 rounded-lg transition ${
              activeTab === 'manual' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Manual Inspection
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1 rounded-lg transition ${
              activeTab === 'history' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            History ({logs.length})
          </button>
          </div>
        </div>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl bg-slate-900 border border-emerald-500 px-4 py-2.5 text-xs font-bold text-white shadow-2xl animate-fade-in">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 1. Tab: WhatsApp Copy-Paste */}
      {activeTab === 'paste' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-6 shadow-md backdrop-blur space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-emerald-400" />
                <span>Paste WhatsApp QC Inspection Report</span>
              </h2>
              <p className="text-xs text-slate-400">
                Copy text from factory QC WhatsApp group. Auto-extracts machine, product, tests, passed, and defects.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePasteSample}
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-300 transition"
              >
                Load Sample QC
              </button>
              {inputText && (
                <button
                  onClick={() => setInputText('')}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <textarea
            rows={7}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Paste WhatsApp QC message here, e.g.:\n\nQC SHIFT INSPECTION REPORT (23/10/2026)\nShift: Day\nInspector: Innocent Maviyani\n\nExtrusion Machine 2 - 50mm Conduit Pipe PVC\nSamples tested: 20\nPassed: 19\nDefects: 1 (Wall thickness variation)\nStatus: Passed`}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs sm:text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
          />

          <div className="flex justify-end">
            <button
              onClick={handleParseWhatsApp}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 px-6 py-2.5 text-xs sm:text-sm font-bold text-white shadow transition active:scale-[0.98]"
            >
              <ClipboardCheck className="h-4 w-4" />
              <span>Parse &amp; Save QC Report</span>
            </button>
          </div>
        </div>
      )}

      {/* 2. Tab: Manual Inspection Form */}
      {activeTab === 'manual' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-6 shadow-md backdrop-blur">
          <h2 className="text-base font-bold text-white mb-1 flex items-center gap-2">
            <Plus className="h-5 w-5 text-emerald-400" />
            <span>Log Quality Inspection Entry</span>
          </h2>
          <p className="text-xs text-slate-400 mb-4">
            Record physical QC dimensional, visual, or pressure test results for plant output
          </p>

          <form onSubmit={handleManualSave} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Date</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Shift</label>
              <select
                value={shift}
                onChange={(e) => setShift(e.target.value as 'Day' | 'Night' | 'Unknown')}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                <option value="Day">Day Shift</option>
                <option value="Night">Night Shift</option>
                <option value="Unknown">General</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Machine / Line</label>
              <select
                value={machineOrLine}
                onChange={(e) => setMachineOrLine(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                {machines.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Product Name</label>
              <input
                type="text"
                required
                placeholder="e.g. 50mm Conduit Pipe PVC"
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Samples Tested</label>
              <input
                type="number"
                min={1}
                required
                value={samplesTested}
                onChange={(e) => setSamplesTested(+e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Passed Count</label>
              <input
                type="number"
                min={0}
                required
                value={passedCount}
                onChange={(e) => setPassedCount(+e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Defects Count</label>
              <input
                type="number"
                min={0}
                required
                value={defectsCount}
                onChange={(e) => setDefectsCount(+e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">QC Decision Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'Passed' | 'Rejected' | 'Hold')}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                <option value="Passed">Passed (Approved)</option>
                <option value="Hold">Hold (Pending Review)</option>
                <option value="Rejected">Rejected (Non-compliant)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">QC Inspector Name</label>
              <input
                type="text"
                required
                value={inspector}
                onChange={(e) => setInspector(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-semibold text-slate-300 mb-1">Defect Reason / Cause</label>
              <input
                type="text"
                placeholder="e.g. Wall thickness variation, rough finish, blister"
                value={defectReason}
                onChange={(e) => setDefectReason(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-semibold text-slate-300 mb-1">Inspection Notes &amp; Action</label>
              <textarea
                rows={2}
                placeholder="e.g. Temperature adjusted on Zone 4; re-checked after 15 mins."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
              <button
                type="submit"
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 px-6 py-2.5 text-xs sm:text-sm font-bold text-white shadow transition active:scale-[0.98]"
              >
                <ClipboardCheck className="h-4 w-4" />
                <span>Save QC Inspection</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 3. History & Date-Filtered Excel Report */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-6 shadow-md backdrop-blur space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
              <span>QC Inspection History &amp; Excel Report</span>
            </h2>
            <p className="text-xs text-slate-400">
              Filter QC inspection logs by date and download formatted Excel workbook
            </p>
          </div>

          {isAdmin ? (
            <button
              onClick={handleExportExcel}
              disabled={!filteredLogs.length}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 px-4 py-2 text-xs font-bold text-white shadow transition active:scale-[0.98] disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              <span>Download QC Excel (.xlsx)</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/90 px-3.5 py-2 text-xs font-semibold text-slate-400">
              <Lock className="h-4 w-4 text-amber-400" />
              <span>QC Excel Report: Admin Only</span>
            </div>
          )}
        </div>

        {/* Date Filters & Search */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div>
              <label className="text-[11px] text-slate-400 block mb-0.5">From Date</label>
              <input
                type="date"
                value={filterFromDate}
                onChange={(e) => setFilterFromDate(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-200"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-0.5">To Date</label>
              <input
                type="date"
                value={filterToDate}
                onChange={(e) => setFilterToDate(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-200"
              />
            </div>
            {(filterFromDate || filterToDate) && (
              <button
                onClick={() => {
                  setFilterFromDate('');
                  setFilterToDate('');
                }}
                className="mt-4 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:text-white"
              >
                Reset Dates
              </button>
            )}
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search product, defect..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        {/* History Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950 text-slate-400 font-semibold whitespace-nowrap">
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Shift</th>
                <th className="py-2.5 px-3">Machine / Line</th>
                <th className="py-2.5 px-3">Product</th>
                <th className="py-2.5 px-3 text-right">Tested</th>
                <th className="py-2.5 px-3 text-right">Passed</th>
                <th className="py-2.5 px-3 text-right">Defects</th>
                <th className="py-2.5 px-3">Defect Reason</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3">Inspector</th>
                <th className="py-2.5 px-3 text-right">Status Lock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-6 text-center text-slate-500">
                    No QC inspection records found.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-850/50 whitespace-nowrap transition-colors">
                    <td className="py-2.5 px-3 font-mono text-slate-300">{log.date}</td>
                    <td className="py-2.5 px-3 text-slate-400">{log.shift}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-100">{log.machineOrLine}</td>
                    <td className="py-2.5 px-3 text-slate-200">{log.product}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-300">{log.samplesTested}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">{log.passedCount}</td>
                    <td className={`py-2.5 px-3 text-right font-mono font-bold ${log.defectsCount > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                      {log.defectsCount}
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 whitespace-normal max-w-xs">{log.defectReason}</td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          log.status === 'Passed'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : log.status === 'Hold'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-300">{log.inspector}</td>
                    <td className="py-2.5 px-3 text-right">
                      <span
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 px-2 py-0.5 text-[10px] font-semibold text-slate-400"
                        title="Posted QC records cannot be deleted"
                      >
                        <Lock className="h-3 w-3 text-amber-400" />
                        <span>Protected</span>
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
  );
};
