import * as XLSX from 'xlsx';
import { DowntimeEntry, MachineDayStats, normalizeMachineName, PeriodSummaryRow } from '../types';

export function pad2(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

export function ymd(d: Date): string {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

export function dtl(d: Date): string {
  return ymd(d) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

export function getCurrentShift(d: Date = new Date()): { shift: 'Day' | 'Night'; label: string } {
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const totalMins = hours * 60 + minutes;
  // Day shift: 07:30 (450 mins) to 19:30 (1170 mins), Night shift: 19:30 to 07:30
  const isDay = totalMins >= 450 && totalMins < 1170;
  return {
    shift: isDay ? 'Day' : 'Night',
    label: isDay ? 'Day (07:30 - 19:30)' : 'Night (19:30 - 07:30)',
  };
}

export function fmtT(s?: string | number | Date | null): string {
  if (!s) return '-';
  const d = s instanceof Date ? s : new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return ymd(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

export function r2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function toTimestamp(s: string | number | Date): number {
  return new Date(s).getTime();
}

export function getCatCode(cat: string): 'bd' | 'co' | 'ot' {
  if (cat === 'Breakdown') return 'bd';
  if (cat.startsWith('Changeover')) return 'co';
  return 'ot';
}

export function getOpenEntry(m: string, entries: DowntimeEntry[]): DowntimeEntry | null {
  const target = normalizeMachineName(m).toLowerCase();
  for (let i = 0; i < entries.length; i++) {
    if (normalizeMachineName(entries[i].m).toLowerCase() === target && !entries[i].end && !entries[i].del) {
      return entries[i];
    }
  }
  return null;
}

/**
 * Exact calculation logic from original logger:
 * Calculates stats for machine m on a specific day (YYYY-MM-DD).
 * Basis: 24 hrs per day (today counts up to the current time).
 * Running hrs = day hrs minus down hrs.
 */
export function calculateDayStats(
  m: string,
  day: string,
  entries: DowntimeEntry[]
): MachineDayStats {
  const now = Date.now();
  const a = toTimestamp(day + 'T00:00');
  const b = Math.min(a + 864e5, now);
  const o: MachineDayStats = { avail: 0, run: 0, down: 0, bd: 0, co: 0, ot: 0, jc: 0, jct: 0 };

  if (b <= a) return o;
  o.avail = (b - a) / 36e5; // hours

  const intervals: [number, number][] = [];

  const target = normalizeMachineName(m).toLowerCase();
  entries.forEach((e) => {
    if (normalizeMachineName(e.m).toLowerCase() !== target || e.del) return;
    const s = toTimestamp(e.start);
    const en = e.end ? toTimestamp(e.end) : now;
    const x = Math.max(s, a);
    const y = Math.min(en, b);

    if (y > x) {
      intervals.push([x, y]);
      const catCode = getCatCode(e.cat);
      o[catCode] += (y - x) / 36e5;
    }

    if (ymd(new Date(s)) === day && e.jcn && e.cat !== 'Running Check') {
      o.jct++;
      if (e.jcp === 'Finished') o.jc++;
    }
  });

  // Merge overlapping intervals to get true non-overlapping downtime
  intervals.sort((p, q) => p[0] - q[0]);
  let tot = 0;
  let cs: number | null = null;
  let ce: number | null = null;

  intervals.forEach((v) => {
    if (cs === null) {
      cs = v[0];
      ce = v[1];
    } else if (v[0] <= (ce as number)) {
      ce = Math.max(ce as number, v[1]);
    } else {
      tot += (ce as number) - cs;
      cs = v[0];
      ce = v[1];
    }
  });

  if (cs !== null && ce !== null) {
    tot += ce - cs;
  }

  o.down = tot / 36e5;
  o.run = Math.max(0, o.avail - o.down);
  return o;
}

/**
 * Returns an array of day strings between f and t inclusive.
 */
export function getDaysList(from: string, to: string): string[] {
  const r: string[] = [];
  const d = new Date(from + 'T00:00');
  const e = new Date(to + 'T00:00');
  let safety = 0;
  while (d <= e && safety < 400) {
    r.push(ymd(d));
    d.setDate(d.getDate() + 1);
    safety++;
  }
  return r;
}

export interface BuildResult {
  daily: [string, string, MachineDayStats][]; // [date, machine, stats]
  sum: Record<string, MachineDayStats>;
}

export function buildPeriod(
  from: string,
  to: string,
  machines: string[],
  entries: DowntimeEntry[]
): BuildResult {
  const daily: [string, string, MachineDayStats][] = [];
  const sum: Record<string, MachineDayStats> = {};

  machines.forEach((m) => {
    sum[m] = { avail: 0, run: 0, down: 0, bd: 0, co: 0, ot: 0, jc: 0, jct: 0 };
  });

  const dayList = getDaysList(from, to);
  dayList.forEach((d) => {
    machines.forEach((m) => {
      const s = calculateDayStats(m, d, entries);
      if (s.avail <= 0) return;
      daily.push([d, m, s]);
      sum[m].avail += s.avail;
      sum[m].run += s.run;
      sum[m].down += s.down;
      sum[m].bd += s.bd;
      sum[m].co += s.co;
      sum[m].ot += s.ot;
      sum[m].jc += s.jc;
      sum[m].jct += s.jct;
    });
  });

  return { daily, sum };
}

export interface SummaryTableData {
  rows: (string | number)[][];
  structured: PeriodSummaryRow[];
  totalRow: (string | number)[];
  buildResult: BuildResult;
}

export function getSummaryRows(
  from: string,
  to: string,
  machines: string[],
  entries: DowntimeEntry[]
): SummaryTableData {
  const b = buildPeriod(from, to, machines, entries);
  const structured: PeriodSummaryRow[] = [];

  const headers = [
    'Machine',
    'Period hrs',
    'Hrs running',
    'Hrs OFF (total)',
    'Breakdown hrs',
    'Job card changeover hrs',
    'Other stoppage hrs',
    'Availability %',
    'Job cards finished',
    'Job cards logged',
  ];

  const tableRows: (string | number)[][] = [headers];

  machines.forEach((m) => {
    const s = b.sum[m] || { avail: 0, run: 0, down: 0, bd: 0, co: 0, ot: 0, jc: 0, jct: 0 };
    const avail = r2(s.avail);
    const run = r2(s.run);
    const down = r2(s.down);
    const bd = r2(s.bd);
    const co = r2(s.co);
    const ot = r2(s.ot);
    const pct = s.avail ? r2((100 * s.run) / s.avail) : 0;
    const jc = s.jc;
    const jct = s.jct;

    const canonicalM = normalizeMachineName(m);
    structured.push({
      machine: canonicalM,
      periodHrs: avail,
      runHrs: run,
      downHrs: down,
      breakdownHrs: bd,
      changeoverHrs: co,
      otherHrs: ot,
      availabilityPercent: pct,
      jobCardsFinished: jc,
      jobCardsLogged: jct,
    });

    tableRows.push([canonicalM, avail, run, down, bd, co, ot, pct, jc, jct]);
  });

  // Calculate TOTAL row
  const tot: (string | number)[] = ['TOTAL'];
  for (let c = 1; c < 10; c++) {
    let x = 0;
    for (let r = 1; r < tableRows.length; r++) {
      x += Number(tableRows[r][c]) || 0;
    }
    tot.push(r2(x));
  }
  // Availability for total is based on total run vs total avail
  const totalAvail = Number(tot[1]) || 0;
  const totalRun = Number(tot[2]) || 0;
  tot[7] = totalAvail ? r2((100 * totalRun) / totalAvail) : 0;

  tableRows.push(tot);

  return {
    rows: tableRows,
    structured,
    totalRow: tot,
    buildResult: b,
  };
}

export function saveFileBlob(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1500);
}

/**
 * Generates the full 3-sheet Excel (.xlsx) workbook matching original logger:
 * Sheet 1: "Summary" - Per machine period totals with TOTAL row
 * Sheet 2: "Daily" - Breakdown per day and per machine
 * Sheet 3: "Entries" - Granular stoppage records with signatures & job cards
 */
export function generateExcelWorkbook(
  from: string,
  to: string,
  machines: string[],
  entries: DowntimeEntry[],
  supervisorName?: string
) {
  const data = getSummaryRows(from, to, machines, entries);
  const wb = XLSX.utils.book_new();

  // 1. Summary Sheet
  const headerMeta: (string | number)[][] = [
    ['LG PLAST — Affordable / Durable / Complete'],
    ['PLANT DOWNTIME SUMMARY REPORT & MACHINE RUNNING HOURS'],
    ['Period:', `${from} to ${to}`],
    ['Basis:', '24 hrs per day (current day counted up to now)'],
    ['Exported at:', fmtT(new Date())],
    ['Supervisor / Approver:', supervisorName || 'Approved electronically'],
    [],
  ];
  const summarySheetData = headerMeta.concat(data.rows);
  const wsSummary = XLSX.utils.aoa_to_sheet(summarySheetData);
  wsSummary['!cols'] = [{ wch: 22 }].concat(new Array(9).fill({ wch: 18 }));
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // 2. Daily Sheet
  const dailyHeaders = [
    'Date',
    'Machine',
    'Hrs machine down',
    'Hrs machine running',
    'Breakdown hrs',
    'Job card changeover hrs',
    'Other stoppage hrs',
    'Job cards finished',
    'Job cards logged',
  ];
  const dailyData: (string | number)[][] = [
    ['LG PLAST — Affordable / Durable / Complete'],
    ['DAILY MACHINE HOURS BREAKDOWN', `Period: ${from} to ${to}`],
    [],
    dailyHeaders,
  ];
  data.buildResult.daily.forEach((x) => {
    const s = x[2];
    dailyData.push([
      x[0],
      normalizeMachineName(x[1]),
      r2(s.down),
      r2(s.run),
      r2(s.bd),
      r2(s.co),
      r2(s.ot),
      s.jc,
      s.jct,
    ]);
  });
  const wsDaily = XLSX.utils.aoa_to_sheet(dailyData);
  wsDaily['!cols'] = new Array(9).fill({ wch: 20 });
  XLSX.utils.book_append_sheet(wb, wsDaily, 'Daily');

  // 3. Entries Sheet
  const entryHeaders = [
    'Machine',
    'Type',
    'Stopped',
    'Running again',
    'Hrs down',
    'Reason',
    'Reported by',
    'Job card',
    'Job card plan',
    'Signed by Tech',
    'Supervisor Sign',
  ];
  const entriesData: (string | number)[][] = [
    ['LG PLAST — Affordable / Durable / Complete'],
    ['DETAILED DOWNTIME INCIDENT ENTRIES', `Period: ${from} to ${to}`],
    [],
    entryHeaders,
  ];
  const filteredEntries = entries.filter((e) => {
    if (e.del) return false;
    const s = ymd(new Date(e.start));
    return s >= from && s <= to;
  });

  filteredEntries.forEach((e) => {
    const sTime = toTimestamp(e.start);
    const eTime = e.end ? toTimestamp(e.end) : Date.now();
    const hrs = r2((eTime - sTime) / 36e5);
    entriesData.push([
      normalizeMachineName(e.m),
      e.cat,
      fmtT(e.start),
      e.end ? fmtT(e.end) : 'still OFF',
      hrs,
      e.reason,
      e.rep || '',
      e.jcn || '',
      e.jcp || 'Not applicable',
      e.signature ? 'Signed (Online)' : 'Pending',
      e.supervisorSignature ? `Signed (${e.supervisorName || 'Supervisor'})` : 'Unsigned',
    ]);
  });
  const wsEntries = XLSX.utils.aoa_to_sheet(entriesData);
  wsEntries['!cols'] = [
    { wch: 20 },
    { wch: 22 },
    { wch: 18 },
    { wch: 18 },
    { wch: 12 },
    { wch: 40 },
    { wch: 24 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, wsEntries, 'Entries');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveFileBlob(`LGPLAST_Downtime_Report_${from}_to_${to}.xlsx`, blob);
}

export function generateCSVReport(
  from: string,
  to: string,
  machines: string[],
  entries: DowntimeEntry[]
) {
  const data = getSummaryRows(from, to, machines, entries);
  const allRows: (string | number)[][] = [
    ['LG PLAST — Affordable / Durable / Complete'],
    ['PLANT DOWNTIME SUMMARY REPORT', `${from} to ${to}`],
    [],
    ...data.rows,
  ];
  const csv = allRows
    .map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(','))
    .join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  saveFileBlob(`LGPLAST_Downtime_Summary_${from}_to_${to}.csv`, blob);
}
