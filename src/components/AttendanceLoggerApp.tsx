import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  Download,
  Edit3,
  FileSpreadsheet,
  Filter,
  Lock,
  MessageSquare,
  Plus,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import {
  batchTotals,
  choosePerson,
  counts,
  fmtDate,
  generateAttendanceExcelWorkbook,
  mergeMsg,
  parseMessage,
  splitMessages,
  todayISO,
} from '../services/attendanceParser';
import {
  getAttendanceHistorySummary,
  HISTORICAL_CONTINUATION_DATE,
  HISTORICAL_LAST_DATE,
  saveLocalAttendanceBatch,
  syncAttendanceBatchToFirebase,
} from '../services/attendanceStore';
import { AttendancePerson, ParsedAttendanceMessage } from '../types/attendance';
import { LgplastLogo } from './LgplastLogo';

interface AttendanceLoggerAppProps {
  batch: ParsedAttendanceMessage[];
  onUpdateBatch: (newBatch: ParsedAttendanceMessage[]) => void;
  onBackToDashboard?: () => void;
  userEmail: string;
  isAdmin?: boolean;
}

export const AttendanceLoggerApp: React.FC<AttendanceLoggerAppProps> = ({
  batch,
  onUpdateBatch,
  onBackToDashboard,
  userEmail,
  isAdmin = false,
}) => {
  const [inputText, setInputText] = useState('');
  const [previewList, setPreviewList] = useState<ParsedAttendanceMessage[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Date & Shift range filter for Attendance History & Excel export
  const [filterFromDate, setFilterFromDate] = useState<string>('2026-01-01');
  const [filterToDate, setFilterToDate] = useState<string>('');
  const [filterShift, setFilterShift] = useState<'All' | 'Day' | 'Night'>('All');

  // Phased records live in the background by default; inspector drawer is optional on demand
  const [showBackgroundRecords, setShowBackgroundRecords] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [visibleShiftCount, setVisibleShiftCount] = useState(25);

  const historyMeta = useMemo(() => getAttendanceHistorySummary(batch), [batch]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Sample WhatsApp template continuing cleanly after historical 2026-11-06 log
  const sampleWhatsAppText = `Morning shift attendance (07/11/2026)
from: Eric Nyamapanda

EXTRUSION
Farai Muronzwa 50
Dennis Muzanenhamo 57 absent
Tried Chakubva 43

INJECTION
Owen Gambo 24
Thinkwell Marumani 37

MIXING
Tchaona Makadho 38
Biggie Mangwende 2 absent

CASUALS
Tafadzwa Nyatawa
Allan Zisengwe absent
Casuals 4

ABSENT
Joseph Sakunyepa 94`;

  const handlePasteSample = () => {
    setInputText(sampleWhatsAppText);
    const msgs = splitMessages(sampleWhatsAppText).map((t) => parseMessage(t));
    setPreviewList(msgs);
    showToast('Loaded sample WhatsApp shift attendance message.');
  };

  // Parsing & Preview
  const handlePreview = () => {
    const text = inputText.trim();
    if (!text) {
      showToast('Please paste a WhatsApp message first.');
      return;
    }
    const msgs = splitMessages(text)
      .map((t) => parseMessage(t))
      .filter((m) => m.rows.length || m.skipped.length);
    setPreviewList(msgs);
    if (!msgs.length) {
      showToast('No valid attendance entries found in message.');
    } else {
      showToast(`Previewing ${msgs.length} attendance message(s).`);
    }
  };

  // Interactive Preview Corrections
  const handleToggleStatus = (msgIdx: number, rowIdx: number) => {
    const updated = [...previewList];
    const row = updated[msgIdx].rows[rowIdx];
    row.status = row.status === 'Absent' ? 'Present' : 'Absent';
    setPreviewList(updated);
  };

  const handleToggleType = (msgIdx: number, rowIdx: number) => {
    const updated = [...previewList];
    const row = updated[msgIdx].rows[rowIdx];
    row.type = row.type === 'Casual' ? 'Employee' : 'Casual';
    setPreviewList(updated);
  };

  const handleDeleteRow = (msgIdx: number, rowIdx: number) => {
    const updated = [...previewList];
    updated[msgIdx].rows.splice(rowIdx, 1);
    setPreviewList(updated);
  };

  const handleChooseCandidate = (msgIdx: number, rowIdx: number, candIdx: number) => {
    const updated = [...previewList];
    choosePerson(updated[msgIdx].rows[rowIdx], candIdx);
    setPreviewList(updated);
  };

  const handleAddSkipped = (msgIdx: number, skipIdx: number, type: 'Employee' | 'Casual') => {
    const updated = [...previewList];
    const msg = updated[msgIdx];
    const item = msg.skipped[skipIdx];
    if (!item) return;

    const idMatch = item.line.match(/[A-Za-z]{0,3}\d+/);
    const newPerson: AttendancePerson = {
      section: 'Unassigned',
      name: item.line.replace(/[^\p{L}.' \-]/gu, ' ').replace(/\s+/g, ' ').trim(),
      id: idMatch ? idMatch[0].toUpperCase() : '',
      type,
      status: 'Present',
      count: 1,
      remark: 'Manually added from unparsed line',
    };
    msg.rows.push(newPerson);
    msg.skipped.splice(skipIdx, 1);
    setPreviewList(updated);
  };

  const [editingBatchItem, setEditingBatchItem] = useState<ParsedAttendanceMessage | null>(null);

  // Phase (Store into background history + live multi-device Firebase sync)
  const handlePhase = async (msgsOverride?: ParsedAttendanceMessage[]) => {
    const msgs = (msgsOverride ?? previewList).filter((m) => m.rows.length);
    if (!msgs.length) {
      showToast('No valid attendance lines to phase.');
      return;
    }

    const currentBatch = [...batch];
    let addedCount = 0;
    let updatedCount = 0;

    msgs.forEach((m) => {
      const existingIdx = currentBatch.findIndex(
        (b) =>
          (b.date === m.date && b.shift === m.shift) ||
          (b.date === m.date && (b.shift === 'Unknown' || m.shift === 'Unknown'))
      );

      if (existingIdx >= 0) {
        const clone: ParsedAttendanceMessage = {
          ...currentBatch[existingIdx],
          rows: currentBatch[existingIdx].rows.map((r) => ({ ...r })),
          isHistorical: false,
          createdAt: Date.now(),
        };
        const stats = mergeMsg(clone, m);
        clone.loggedBy = userEmail;
        clone.loggedByEmail = userEmail;
        currentBatch[existingIdx] = clone;
        addedCount += stats.added;
        updatedCount += stats.updated;
        syncAttendanceBatchToFirebase(clone);
      } else {
        const newRecord: ParsedAttendanceMessage = {
          id: `ATT-${m.date}-${m.shift}-${Date.now()}`,
          date: m.date,
          shift: m.shift,
          reportedBy: m.reportedBy,
          loggedBy: userEmail,
          loggedByEmail: userEmail,
          msgs: 1,
          rows: m.rows.map((r) => ({ ...r })),
          skipped: [],
          claimed: m.claimed,
          createdAt: Date.now(),
          isHistorical: false,
        };
        currentBatch.push(newRecord);
        addedCount += m.rows.length;
        syncAttendanceBatchToFirebase(newRecord);
      }
    });

    const shiftRank = (s: string) => (s === 'Night' ? 0 : s === 'Day' ? 1 : 2);
    currentBatch.sort(
      (a, b) => b.date.localeCompare(a.date) || shiftRank(a.shift) - shiftRank(b.shift)
    );
    saveLocalAttendanceBatch(currentBatch);
    onUpdateBatch(currentBatch);

    setPreviewList([]);
    setInputText('');
    showToast(
      `Saved to background history & synced: ${addedCount} entries added${
        updatedCount ? `, ${updatedCount} updated` : ''
      }.`
    );
  };

  const handleSaveEditedBatch = async (updated: ParsedAttendanceMessage) => {
    const finalized: ParsedAttendanceMessage = {
      ...updated,
      loggedBy: userEmail,
      loggedByEmail: userEmail,
      isHistorical: false,
      createdAt: Date.now(),
    };
    const current = [...batch];
    const idx = current.findIndex((b) => b.id === finalized.id);
    if (idx >= 0) {
      current[idx] = finalized;
    } else {
      current.push(finalized);
    }
    saveLocalAttendanceBatch(current);
    onUpdateBatch(current);
    await syncAttendanceBatchToFirebase(finalized);
    setEditingBatchItem(null);
    showToast(`Updated & synced attendance for ${fmtDate(finalized.date)} ${finalized.shift} shift.`);
  };

  // Download Excel Report with Date & Shift Range Filtering (Admin Only)
  const handleDownloadExcel = async () => {
    if (!isAdmin) {
      showToast('Admin Only: Only Administrators can generate Attendance Reports.');
      return;
    }
    if (!filteredBatch.length) {
      showToast('No attendance records match the selected date range.');
      return;
    }
    showToast('Generating Attendance Excel (.xlsx) in background...');
    const fileName = await generateAttendanceExcelWorkbook(
      batch,
      filterFromDate,
      filterToDate,
      filterShift,
      isAdmin
    );
    if (fileName) {
      showToast(`Downloaded Excel report (${filteredBatch.length} shifts): ${fileName}`);
    }
  };

  // Quick Date Filter Presets
  const handlePreset = (
    preset: 'today' | '7days' | '30days' | 'thisMonth' | 'jan2026' | 'continuation' | 'all'
  ) => {
    const anchorStr = historyMeta.latestDate > todayISO() ? historyMeta.latestDate : todayISO();
    const anchorDate = new Date(`${anchorStr}T00:00:00`);
    if (preset === 'today') {
      const t = todayISO();
      setFilterFromDate(t);
      setFilterToDate(t);
    } else if (preset === '7days') {
      const f = new Date(anchorDate);
      f.setDate(f.getDate() - 6);
      setFilterFromDate(f.toISOString().slice(0, 10));
      setFilterToDate('');
    } else if (preset === '30days') {
      const f = new Date(anchorDate);
      f.setDate(f.getDate() - 29);
      setFilterFromDate(f.toISOString().slice(0, 10));
      setFilterToDate('');
    } else if (preset === 'thisMonth') {
      const refMonth = todayISO().slice(0, 7);
      setFilterFromDate(`${refMonth}-01`);
      setFilterToDate('');
    } else if (preset === 'jan2026') {
      setFilterFromDate('2026-01-01');
      setFilterToDate('');
    } else if (preset === 'continuation') {
      setFilterFromDate(HISTORICAL_CONTINUATION_DATE);
      setFilterToDate('');
    } else {
      setFilterFromDate('');
      setFilterToDate('');
    }
    setVisibleShiftCount(25);
  };

  // Filtered batch for KPI metrics, Excel download, and optional background inspector
  const filteredBatch = useMemo(() => {
    return batch.filter((b) => {
      if (filterFromDate && b.date < filterFromDate) return false;
      if (filterToDate && b.date > filterToDate) return false;
      if (filterShift !== 'All' && b.shift !== filterShift) return false;
      return true;
    });
  }, [batch, filterFromDate, filterToDate, filterShift]);

  const searchedBackgroundBatch = useMemo(() => {
    const q = historySearchQuery.trim().toLowerCase();
    if (!q) return filteredBatch;
    return filteredBatch.filter(
      (b) =>
        b.date.includes(q) ||
        b.shift.toLowerCase().includes(q) ||
        (b.reportedBy || '').toLowerCase().includes(q) ||
        b.rows.some(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            (r.id || '').toLowerCase().includes(q) ||
            (r.section || '').toLowerCase().includes(q)
        )
    );
  }, [filteredBatch, historySearchQuery]);

  const totals = useMemo(() => batchTotals(filteredBatch), [filteredBatch]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-8">
      {/* Navigation Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-3">
          {onBackToDashboard && (
            <button
              onClick={onBackToDashboard}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Dashboard</span>
            </button>
          )}
          <LgplastLogo size="sm" />
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30">
              <Users className="h-4 w-4" />
            </div>
            <h1 className="text-base sm:text-lg font-bold text-white">
              LG PLAST Attendance Logger APK
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5" />
            <span>
              {historyMeta.totalShifts} Shifts ({historyMeta.totalRows.toLocaleString()} Logs) in Background
            </span>
          </span>
        </div>
      </div>

      {/* Historical Continuation & Background Sync Status Strip */}
      <div className="rounded-2xl border border-sky-500/30 bg-slate-900/90 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
        <div className="flex items-start sm:items-center gap-2.5 text-slate-200">
          <Calendar className="h-4 w-4 text-sky-400 shrink-0 mt-0.5 sm:mt-0" />
          <div>
            <span className="font-bold text-white">Attendance History Loaded:</span>{' '}
            <span className="text-sky-300 font-semibold">
              {fmtDate(historyMeta.earliestDate)} – {fmtDate(historyMeta.latestDate)}
            </span>{' '}
            <span className="text-slate-400">
              (Archive through {fmtDate(HISTORICAL_LAST_DATE)} + {historyMeta.newContinuationShifts} new shift
              {historyMeta.newContinuationShifts === 1 ? '' : 's'})
            </span>
          </div>
        </div>
        <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-[11px] font-bold text-emerald-300 shrink-0">
          New Phased Shifts Continue From {fmtDate(historyMeta.nextContinuationDate)}
        </div>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl bg-slate-900 border border-blue-500 px-4 py-2.5 text-xs font-bold text-white shadow-2xl animate-fade-in">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 1. Paste WhatsApp Section */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-6 shadow-md backdrop-blur">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-emerald-400" />
              <span>1. Paste WhatsApp Attendance Message(s)</span>
            </h2>
            <p className="text-xs text-slate-400">
              Latest recorded shift: <b className="text-slate-200">{fmtDate(historyMeta.latestDate)}</b>. New phased shifts save straight to background history &amp; sync live without disturbing machine/dispatch logs.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePasteSample}
              className="rounded-xl border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 px-2.5 py-1 text-xs font-semibold text-blue-300 transition"
            >
              Load Sample Text
            </button>
            {inputText && (
              <button
                onClick={() => {
                  setInputText('');
                  setPreviewList([]);
                }}
                className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-750 px-2.5 py-1 text-xs font-semibold text-slate-400 hover:text-white transition"
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
          placeholder={`Paste WhatsApp message here (continues from ${fmtDate(
            historyMeta.nextContinuationDate
          )} onward), e.g.:\n\nMorning shift attendance (07/11/2026)\nfrom: Tinashe\n\nEXTRUSION\nFarai 50\nDennis 57 absent\n\nCASUALS\nTafadzwa\nGrammy absent\n\nABSENT\nJoseph 94`}
          className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs sm:text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500 max-w-xl">
            <b>Smart Detection:</b> Absent = &quot;absent&quot; / &quot;abs&quot; or ❌ mark. Casuals = &quot;CASUALS&quot; heading or &quot;casual&quot;. Names are verified against staff roster.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePreview}
              className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-750 px-4 py-2 text-xs font-bold text-slate-200 transition"
            >
              Preview Message
            </button>
            <button
              onClick={() => {
                if (previewList.some((m) => m.rows.length)) {
                  handlePhase(previewList);
                  return;
                }
                const text = inputText.trim();
                if (!text) {
                  showToast('Please paste a WhatsApp message first.');
                  return;
                }
                const msgs = splitMessages(text)
                  .map((t) => parseMessage(t))
                  .filter((m) => m.rows.length || m.skipped.length);
                if (!msgs.some((m) => m.rows.length)) {
                  setPreviewList(msgs);
                  showToast('No valid attendance entries found in message.');
                  return;
                }
                handlePhase(msgs);
              }}
              className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 px-4 py-2 text-xs font-bold text-white shadow transition active:scale-[0.98]"
            >
              Phase Now
            </button>
          </div>
        </div>
      </div>

      {/* 2. Preview Section */}
      {previewList.length > 0 && (
        <div className="rounded-2xl border border-blue-500/40 bg-slate-900/95 p-4 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Check className="h-5 w-5 text-emerald-400" />
                <span>2. Preview &amp; Verification ({previewList.length} Message{previewList.length > 1 ? 's' : ''})</span>
              </h2>
              <p className="text-xs text-slate-400">
                Verify detected names and departments before adding to the batch. Click status or type chips to toggle.
              </p>
            </div>
            <button
              onClick={() => handlePhase()}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 text-xs font-bold shadow transition active:scale-[0.98]"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Phase (Add to Batch)</span>
            </button>
          </div>

          {previewList.map((msg, mi) => {
            const c = counts(msg.rows);
            return (
              <div key={mi} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                {/* Message Header Controls */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-800/80">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-bold text-sm text-amber-400">Message {mi + 1}</span>
                    <div className="flex items-center gap-1.5">
                      <label className="text-[11px] text-slate-400">Date:</label>
                      <input
                        type="date"
                        value={msg.date}
                        onChange={(e) => {
                          const updated = [...previewList];
                          updated[mi].date = e.target.value;
                          setPreviewList(updated);
                        }}
                        className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <label className="text-[11px] text-slate-400">Shift:</label>
                      <select
                        value={msg.shift}
                        onChange={(e) => {
                          const updated = [...previewList];
                          updated[mi].shift = e.target.value as 'Day' | 'Night' | 'Unknown';
                          setPreviewList(updated);
                        }}
                        className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                      >
                        <option value="Day">Day</option>
                        <option value="Night">Night</option>
                        <option value="Unknown">Unknown</option>
                      </select>
                    </div>
                  </div>

                  <span className="text-xs text-slate-400">
                    Reported by: <b className="text-slate-200">{msg.reportedBy || '(unspecified)'}</b>
                  </span>
                </div>

                {/* Counts Chips */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-300">
                    Present: {c.ep + c.cp}
                  </span>
                  <span className="rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2.5 py-0.5 text-xs font-bold">
                    Absent: {c.ea + c.ca}
                  </span>
                  <span className="rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 text-xs font-bold">
                    Casuals: {c.cp + c.ca}
                  </span>
                </div>

                {/* Rows Table */}
                <div className="overflow-x-auto rounded-xl border border-slate-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900 text-slate-400 font-semibold whitespace-nowrap">
                        <th className="py-2 px-3">#</th>
                        <th className="py-2 px-3">Name</th>
                        <th className="py-2 px-3">ID</th>
                        <th className="py-2 px-3">Designation</th>
                        <th className="py-2 px-3">Section</th>
                        <th className="py-2 px-3">Type</th>
                        <th className="py-2 px-3">Status</th>
                        <th className="py-2 px-3">Count</th>
                        <th className="py-2 px-3">Check / Notes</th>
                        <th className="py-2 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {msg.rows.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="py-4 text-center text-slate-500">
                            No attendance lines extracted.
                          </td>
                        </tr>
                      ) : (
                        msg.rows.map((r, ri) => (
                          <tr
                            key={ri}
                            className={`transition-colors whitespace-nowrap ${
                              r.status === 'Absent' ? 'bg-rose-950/20 text-rose-300' : 'hover:bg-slate-900/60'
                            }`}
                          >
                            <td className="py-2 px-3 font-mono text-slate-500">{ri + 1}</td>
                            <td className="py-2 px-3 font-bold text-slate-100">
                              {r.cands && r.cands.length > 0 ? (
                                <select
                                  onChange={(e) => handleChooseCandidate(mi, ri, +e.target.value)}
                                  className="rounded border border-amber-500/50 bg-slate-900 px-2 py-0.5 text-xs text-amber-300"
                                >
                                  <option value="-1">{r.name} (as given)</option>
                                  {r.cands.map((x, xi) => (
                                    <option key={xi} value={xi}>
                                      {x.name} ({x.id || 'casual'}) - {x.desig}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                r.name
                              )}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-300">{r.id || '-'}</td>
                            <td className="py-2 px-3 text-slate-400">{r.designation || '-'}</td>
                            <td className="py-2 px-3 text-slate-300">{r.section}</td>
                            <td className="py-2 px-3">
                              <button
                                onClick={() => handleToggleType(mi, ri)}
                                className={`rounded px-2 py-0.5 text-[10px] font-bold border transition ${
                                  r.type === 'Casual'
                                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                    : 'bg-slate-800 text-slate-300 border-slate-700'
                                }`}
                              >
                                {r.type}
                              </button>
                            </td>
                            <td className="py-2 px-3">
                              <button
                                onClick={() => handleToggleStatus(mi, ri)}
                                className={`rounded px-2 py-0.5 text-[10px] font-bold border transition ${
                                  r.status === 'Absent'
                                    ? 'bg-rose-500 text-white border-rose-600'
                                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                }`}
                              >
                                {r.status}
                              </button>
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-300">{r.count}</td>
                            <td className="py-2 px-3 text-[11px] text-slate-400 whitespace-normal max-w-xs">
                              {r.remark || '-'}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <button
                                onClick={() => handleDeleteRow(mi, ri)}
                                className="text-slate-500 hover:text-rose-400 p-1"
                                title="Remove line"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Skipped Lines */}
                {msg.skipped.length > 0 && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs space-y-1.5">
                    <span className="font-bold text-amber-300 block">
                      {msg.skipped.length} Line(s) not automatically matched — tap to add:
                    </span>
                    {msg.skipped.map((s, si) => (
                      <div key={si} className="flex flex-wrap items-center gap-2 text-slate-300 text-[11px]">
                        <span className="font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                          {s.line}
                        </span>
                        <span className="text-slate-500">({s.why})</span>
                        <button
                          onClick={() => handleAddSkipped(mi, si, 'Employee')}
                          className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 hover:bg-slate-700"
                        >
                          + Employee
                        </button>
                        <button
                          onClick={() => handleAddSkipped(mi, si, 'Casual')}
                          className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] font-semibold text-amber-400 hover:bg-slate-700"
                        >
                          + Casual
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 3. Attendance History Filter & Excel Download (Phased Records Stored in Background) */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-6 shadow-md backdrop-blur space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
              <span>3. Attendance History &amp; Date-Filtered Excel Reports</span>
            </h2>
            <p className="text-xs text-slate-400">
              All phased &amp; historical attendance shifts run silently in background storage. Filter any period below and export 5-sheet Excel reports instantly.
            </p>
          </div>

          {/* Quick Date Range Filter Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => handlePreset('jan2026')}
              className={`rounded-xl border px-2.5 py-1 text-xs font-semibold transition ${
                filterFromDate === '2026-01-01' && !filterToDate
                  ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Jan 2026 – Latest
            </button>
            <button
              type="button"
              onClick={() => handlePreset('continuation')}
              className={`rounded-xl border px-2.5 py-1 text-xs font-semibold transition ${
                filterFromDate === HISTORICAL_CONTINUATION_DATE && !filterToDate
                  ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              New (07-Nov Onward)
            </button>
            <button
              type="button"
              onClick={() => handlePreset('30days')}
              className="rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition"
            >
              Last 30 days
            </button>
            <button
              type="button"
              onClick={() => handlePreset('7days')}
              className="rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition"
            >
              Last 7 days
            </button>
            <button
              type="button"
              onClick={() => handlePreset('thisMonth')}
              className="rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition"
            >
              This month
            </button>
            <button
              type="button"
              onClick={() => handlePreset('today')}
              className="rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => handlePreset('all')}
              className={`rounded-xl border px-2.5 py-1 text-xs font-semibold transition ${
                !filterFromDate && !filterToDate
                  ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              All History
            </button>
          </div>
        </div>

        {/* Date & Shift Filter Inputs & Download Action */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                Filter From Date
              </label>
              <input
                type="date"
                value={filterFromDate}
                onChange={(e) => {
                  setFilterFromDate(e.target.value);
                  setVisibleShiftCount(25);
                }}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs sm:text-sm font-semibold text-slate-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                Filter To Date
              </label>
              <input
                type="date"
                value={filterToDate}
                onChange={(e) => {
                  setFilterToDate(e.target.value);
                  setVisibleShiftCount(25);
                }}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs sm:text-sm font-semibold text-slate-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                Shift
              </label>
              <select
                value={filterShift}
                onChange={(e) => {
                  setFilterShift(e.target.value as 'All' | 'Day' | 'Night');
                  setVisibleShiftCount(25);
                }}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs sm:text-sm font-semibold text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="All">All Shifts</option>
                <option value="Day">Day Shift</option>
                <option value="Night">Night Shift</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isAdmin ? (
              <button
                onClick={handleDownloadExcel}
                disabled={!filteredBatch.length}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-md shadow-emerald-950/40 transition active:scale-[0.98] disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                <span>Download Excel Report ({filteredBatch.length} Shifts)</span>
              </button>
            ) : (
              <div
                className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-bold text-amber-300"
                title="Only Plant Administrators / Production HOD can generate Attendance Reports"
              >
                <Lock className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span>Admin Only: Attendance Report Export Locked</span>
              </div>
            )}
          </div>
        </div>

        {/* Aggregated KPI Metrics for Selected Date Range */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <span className="text-[11px] font-semibold text-slate-400 block">Filtered Shifts</span>
            <span className="text-xl font-black text-sky-400">{filteredBatch.length}</span>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <span className="text-[11px] font-semibold text-slate-400 block">Employees Present</span>
            <span className="text-xl font-black text-emerald-400">{totals.ep.toLocaleString()}</span>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <span className="text-[11px] font-semibold text-slate-400 block">Employees Absent</span>
            <span className="text-xl font-black text-rose-400">{totals.ea.toLocaleString()}</span>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <span className="text-[11px] font-semibold text-slate-400 block">Casuals Present</span>
            <span className="text-xl font-black text-blue-400">{totals.cp.toLocaleString()}</span>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <span className="text-[11px] font-semibold text-slate-400 block">Casuals Absent</span>
            <span className="text-xl font-black text-amber-400">{totals.ca.toLocaleString()}</span>
          </div>
        </div>

        {/* Background Phased Records Vault (Collapsed by Default) */}
        <div className="pt-2 border-t border-slate-800/80 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3.5 py-2.5">
            <div className="flex items-center gap-2 text-xs">
              <Database className="h-4 w-4 text-sky-400 shrink-0" />
              <span className="text-slate-200 font-semibold">
                Background Phased History Vault ({filteredBatch.length} shifts matching filter · {batch.length} total stored)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowBackgroundRecords((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 transition"
            >
              <Filter className="h-3.5 w-3.5 text-sky-400" />
              <span>{showBackgroundRecords ? 'Hide Background Records' : 'Inspect / Edit Records'}</span>
              {showBackgroundRecords ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {showBackgroundRecords && (
            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="relative flex-1 max-w-md">
                  <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={historySearchQuery}
                    onChange={(e) => {
                      setHistorySearchQuery(e.target.value);
                      setVisibleShiftCount(25);
                    }}
                    placeholder="Search by worker name, ID, date (2026-11-06), or reporter..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <span className="text-[11px] text-slate-400">
                  Showing {Math.min(visibleShiftCount, searchedBackgroundBatch.length)} of{' '}
                  {searchedBackgroundBatch.length} shift records
                </span>
              </div>

              {searchedBackgroundBatch.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-500">
                  No shift attendance records match your selected date filter or search query.
                </div>
              ) : (
                <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                  {searchedBackgroundBatch.slice(0, visibleShiftCount).map((item) => {
                    const c = counts(item.rows);
                    return (
                      <div
                        key={item.id || `${item.date}-${item.shift}`}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-xs"
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <b className="text-slate-100 font-mono">{fmtDate(item.date)}</b>
                          <span className="rounded-md bg-slate-800 px-2 py-0.5 font-semibold text-slate-300">
                            {item.shift} Shift
                          </span>
                          {item.isHistorical ? (
                            <span className="rounded-md bg-slate-800/80 border border-slate-700 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
                              Archive
                            </span>
                          ) : (
                            <span className="rounded-md bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                              Live Phased
                            </span>
                          )}
                          <span className="text-emerald-400 font-bold">Present: {c.ep + c.cp}</span>
                          <span className="text-rose-400 font-bold">Absent: {c.ea + c.ca}</span>
                          <span className="text-amber-400">Casuals: {c.cp + c.ca}</span>
                          {item.reportedBy && (
                            <span className="text-slate-500 hidden sm:inline">
                              Reported: {item.reportedBy}
                            </span>
                          )}
                          {item.loggedBy && (
                            <span className="text-slate-400 text-[11px] font-mono flex items-center gap-1 border-l border-slate-800 pl-2">
                              <ShieldCheck className="h-3 w-3 text-amber-400" />
                              Logged by: <b className="text-slate-300">{item.loggedBy}</b>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setEditingBatchItem(JSON.parse(JSON.stringify(item)))}
                            className="flex items-center gap-1 rounded-lg border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 px-2.5 py-1 text-xs font-semibold text-blue-300 transition"
                            title="Update attendance lines in this shift"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>Edit ({item.rows.length})</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {searchedBackgroundBatch.length > visibleShiftCount && (
                    <div className="pt-2 text-center">
                      <button
                        type="button"
                        onClick={() => setVisibleShiftCount((n) => n + 50)}
                        className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-4 py-1.5 text-xs font-bold text-slate-200 transition"
                      >
                        Load 50 More Shifts ({searchedBackgroundBatch.length - visibleShiftCount} remaining)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Interactive Modal to Update Attendance Records */}
      {editingBatchItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-4xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl max-h-[90vh] flex flex-col text-slate-100">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
                  <Edit3 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                    <span>Update Shift Attendance Records</span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-mono text-amber-400">
                      {fmtDate(editingBatchItem.date)} • {editingBatchItem.shift} Shift
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Correct names, toggle present/absent, toggle casuals, or add new floor staff
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setEditingBatchItem(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Shift Controls & Add Staff */}
            <div className="py-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <span className="text-slate-400 mr-1 font-semibold">Shift:</span>
                  <select
                    value={editingBatchItem.shift}
                    onChange={(e) =>
                      setEditingBatchItem({
                        ...editingBatchItem,
                        shift: e.target.value as 'Day' | 'Night' | 'Unknown',
                      })
                    }
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="Day">Day Shift</option>
                    <option value="Night">Night Shift</option>
                    <option value="Unknown">Unknown</option>
                  </select>
                </div>

                <div>
                  <span className="text-slate-400 mr-1 font-semibold">Reported by:</span>
                  <input
                    type="text"
                    value={editingBatchItem.reportedBy || ''}
                    onChange={(e) =>
                      setEditingBatchItem({
                        ...editingBatchItem,
                        reportedBy: e.target.value,
                      })
                    }
                    placeholder="Supervisor name"
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 w-36"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const updatedRows = [
                    ...editingBatchItem.rows,
                    {
                      section: 'Extrusion',
                      name: 'New Staff Member',
                      id: '',
                      type: 'Employee' as const,
                      status: 'Present' as const,
                      count: 1,
                      remark: 'Manually added',
                    },
                  ];
                  setEditingBatchItem({ ...editingBatchItem, rows: updatedRows });
                }}
                className="flex items-center gap-1 rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 px-3 py-1.5 text-xs font-bold transition"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>+ Add Staff Member</span>
              </button>
            </div>

            {/* Table of Personnel Rows */}
            <div className="overflow-y-auto pr-1 py-3 flex-1 text-xs">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold whitespace-nowrap">
                    <th className="py-2 px-2.5">#</th>
                    <th className="py-2 px-2.5">Staff Name</th>
                    <th className="py-2 px-2.5">ID No.</th>
                    <th className="py-2 px-2.5">Section</th>
                    <th className="py-2 px-2.5">Type</th>
                    <th className="py-2 px-2.5">Status</th>
                    <th className="py-2 px-2.5">Remark</th>
                    <th className="py-2 px-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {editingBatchItem.rows.map((row, ri) => (
                    <tr
                      key={ri}
                      className={row.status === 'Absent' ? 'bg-rose-950/20' : 'hover:bg-slate-850/50'}
                    >
                      <td className="py-2 px-2.5 font-mono text-slate-500">{ri + 1}</td>
                      <td className="py-2 px-2.5">
                        <input
                          type="text"
                          value={row.name}
                          onChange={(e) => {
                            const rows = [...editingBatchItem.rows];
                            rows[ri].name = e.target.value;
                            setEditingBatchItem({ ...editingBatchItem, rows });
                          }}
                          className="w-full min-w-[130px] rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs font-bold text-slate-100"
                        />
                      </td>
                      <td className="py-2 px-2.5">
                        <input
                          type="text"
                          value={row.id || ''}
                          onChange={(e) => {
                            const rows = [...editingBatchItem.rows];
                            rows[ri].id = e.target.value;
                            setEditingBatchItem({ ...editingBatchItem, rows });
                          }}
                          placeholder="ID"
                          className="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs font-mono text-slate-200"
                        />
                      </td>
                      <td className="py-2 px-2.5">
                        <input
                          type="text"
                          value={row.section}
                          onChange={(e) => {
                            const rows = [...editingBatchItem.rows];
                            rows[ri].section = e.target.value;
                            setEditingBatchItem({ ...editingBatchItem, rows });
                          }}
                          className="w-24 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs text-slate-300"
                        />
                      </td>
                      <td className="py-2 px-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            const rows = [...editingBatchItem.rows];
                            rows[ri].type = rows[ri].type === 'Casual' ? 'Employee' : 'Casual';
                            setEditingBatchItem({ ...editingBatchItem, rows });
                          }}
                          className={`rounded px-2 py-1 text-[10px] font-bold border transition ${
                            row.type === 'Casual'
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}
                        >
                          {row.type}
                        </button>
                      </td>
                      <td className="py-2 px-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            const rows = [...editingBatchItem.rows];
                            rows[ri].status = rows[ri].status === 'Absent' ? 'Present' : 'Absent';
                            setEditingBatchItem({ ...editingBatchItem, rows });
                          }}
                          className={`rounded px-2.5 py-1 text-[10px] font-bold border transition ${
                            row.status === 'Absent'
                              ? 'bg-rose-500 text-white border-rose-600'
                              : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          }`}
                        >
                          {row.status}
                        </button>
                      </td>
                      <td className="py-2 px-2.5">
                        <input
                          type="text"
                          value={row.remark || ''}
                          onChange={(e) => {
                            const rows = [...editingBatchItem.rows];
                            rows[ri].remark = e.target.value;
                            setEditingBatchItem({ ...editingBatchItem, rows });
                          }}
                          placeholder="Notes"
                          className="w-28 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs text-slate-400"
                        />
                      </td>
                      <td className="py-2 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            const rows = [...editingBatchItem.rows];
                            rows.splice(ri, 1);
                            setEditingBatchItem({ ...editingBatchItem, rows });
                          }}
                          className="text-slate-500 hover:text-rose-400 p-1"
                          title="Delete staff row"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Modal Actions */}
            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                Updating will save locally and auto-sync online to Firebase with user attribution.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingBatchItem(null)}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-750"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveEditedBatch(editingBatchItem)}
                  className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 px-5 py-2 text-xs font-bold text-white shadow"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Save &amp; Sync to Firebase</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
