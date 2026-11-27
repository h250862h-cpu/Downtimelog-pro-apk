import * as XLSX from '../utils/xlsxCompat';
import {
  DieselFuelRequest,
  DieselGrnRecord,
  DieselTankConfig,
  DispatchEntry,
  DowntimeEntry,
  GeneratorLog,
  PowerCutLog,
  QualityTrialReport,
  ScrapSalesInvoice,
  SopShiftHandoverRecord,
  SopMixingReport,
  SopProductionRecord,
  SopQcRecord,
  SopScrapRecord,
  SpecialOrder,
  SpecialOrderFactoryProduction,
  SpecialOrderWhDispatch,
  TqmCapaRecord,
  ProductionPlanItem,
} from '../types';
import { ParsedAttendanceMessage, QCInspectionRecord } from '../types/attendance';
import { buildDowntimeExcelWorkbook, ymd } from './downtimeCalc';
import { buildDispatchExcelWorkbook } from './dispatchStore';
import { buildDieselExcelWorkbook } from './dieselStore';
import { buildGeneratorWorkbook, buildPowerCutWorkbook } from './powerGenStore';
import {
  buildUnifiedProductionReport,
  buildUnifiedProductionReportWorkbook,
} from './productionPlanStore';
import { buildQualityTrialsWorkbook } from './qualityTrialStore';
import { buildScrapSalesExcelWorkbook } from './scrapSalesStore';
import { buildSopMasterWorkbook } from './sopStore';
import { buildAttendanceExcelWorkbook, buildQcLogsExcelWorkbook } from './attendanceParser';
import { buildTqmMasterExcelWorkbook, buildUnifiedTqmAnalytics } from './tqmStore';

export type BackgroundExcelReportId =
  | 'downtime'
  | 'production_period'
  | 'dispatch'
  | 'diesel'
  | 'power_cut'
  | 'generator'
  | 'scrap_sales'
  | 'attendance'
  | 'qc_logs'
  | 'quality_trials'
  | 'sop_master'
  | 'tqm';

export type BackgroundExcelStatus = 'idle' | 'generating' | 'ready' | 'error';

export interface BackgroundExcelReportSnapshot {
  id: BackgroundExcelReportId;
  label: string;
  category: string;
  filename: string;
  status: BackgroundExcelStatus;
  blob: Blob | null;
  sizeBytes: number;
  rowCount: number;
  generatedAtIso: string | null;
  error: string | null;
}

export interface AdminExcelDataset {
  machines: string[];
  downtimeEntries: DowntimeEntry[];
  dispatches: DispatchEntry[];
  dieselRequests: DieselFuelRequest[];
  dieselGrns: DieselGrnRecord[];
  dieselTank: DieselTankConfig;
  powerCutLogs: PowerCutLog[];
  generatorLogs: GeneratorLog[];
  scrapSalesInvoices: ScrapSalesInvoice[];
  attendanceBatch: ParsedAttendanceMessage[];
  qcLogs: QCInspectionRecord[];
  qualityTrials: QualityTrialReport[];
  sopProductionLogs: SopProductionRecord[];
  sopQcChecks: SopQcRecord[];
  sopScrapPipeline: SopScrapRecord[];
  sopMixingReports: SopMixingReport[];
  sopHandovers: SopShiftHandoverRecord[];
  monthlyPlans?: ProductionPlanItem[];
  specialOrders?: SpecialOrder[];
  specialOrderProductions?: SpecialOrderFactoryProduction[];
  specialOrderWhDispatches?: SpecialOrderWhDispatch[];
  tqmCapas?: TqmCapaRecord[];
  supervisorName?: string;
}

const REPORT_DEFS: Record<
  BackgroundExcelReportId,
  { label: string; category: string; defaultFilename: string }
> = {
  downtime: {
    label: 'Machines Downtime & Availability',
    category: 'Downtime & Running Hours',
    defaultFilename: 'LGPLAST_Downtime_Report.xlsx',
  },
  production_period: {
    label: 'Unified 6-Sheet Period Production & Utilities',
    category: 'Production & Utilities',
    defaultFilename: 'LGPLAST_Period_Production_Report.xlsx',
  },
  dispatch: {
    label: 'Confirmed Dispatch & Scrap Audit Ledger',
    category: 'Dispatch',
    defaultFilename: 'LGPLAST_Dispatch_Ledger.xlsx',
  },
  diesel: {
    label: 'Diesel Bowser Issues & Fuel GRNs',
    category: 'Utilities & Fuel',
    defaultFilename: 'LGPLAST_Diesel_Bowser_Ledger.xlsx',
  },
  power_cut: {
    label: 'ZESA / Power Cut Incidents',
    category: 'Utilities & Power',
    defaultFilename: 'LGPLAST_Power_Cuts.xlsx',
  },
  generator: {
    label: 'Generator Runtime & Fuel Consumption',
    category: 'Utilities & Power',
    defaultFilename: 'LGPLAST_Generator_Logs.xlsx',
  },
  scrap_sales: {
    label: 'Recycling Scrap Sales & Invoices',
    category: 'Scrap Sales',
    defaultFilename: 'LGPLAST_Scrap_Sales_Invoices.xlsx',
  },
  attendance: {
    label: 'Staff & Casuals Attendance (5 Sheets)',
    category: 'HR & Attendance',
    defaultFilename: 'LGPLAST_Attendance_Report.xlsx',
  },
  qc_logs: {
    label: 'Plant QC Inspection Lots & Pass Rate',
    category: 'Quality Control',
    defaultFilename: 'LGPLAST_QC_Report.xlsx',
  },
  quality_trials: {
    label: 'QMS Product & Material Trials',
    category: 'Quality Trials',
    defaultFilename: 'LGPLAST_Quality_Trials.xlsx',
  },
  sop_master: {
    label: 'Master Floor SOP Workbook (All 5 Sheets)',
    category: 'Floor SOP',
    defaultFilename: 'LGPLAST_SOP_Master_Report.xlsx',
  },
  tqm: {
    label: 'Total Quality Management (TQM) Linked Matrix & CAPA',
    category: 'TQM & Quality',
    defaultFilename: 'LGPLAST_TQM_Master_Audit.xlsx',
  },
};

const REPORT_ORDER: BackgroundExcelReportId[] = [
  'downtime',
  'production_period',
  'tqm',
  'dispatch',
  'scrap_sales',
  'diesel',
  'power_cut',
  'generator',
  'attendance',
  'qc_logs',
  'quality_trials',
  'sop_master',
];

function createEmptySnapshots(): Record<
  BackgroundExcelReportId,
  BackgroundExcelReportSnapshot
> {
  const out = {} as Record<BackgroundExcelReportId, BackgroundExcelReportSnapshot>;
  REPORT_ORDER.forEach((id) => {
    const def = REPORT_DEFS[id];
    out[id] = {
      id,
      label: def.label,
      category: def.category,
      filename: def.defaultFilename,
      status: 'idle',
      blob: null,
      sizeBytes: 0,
      rowCount: 0,
      generatedAtIso: null,
      error: null,
    };
  });
  return out;
}

const EXCEL_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let currentIsAdmin = false;
let latestDataset: AdminExcelDataset | null = null;
let snapshots: Record<BackgroundExcelReportId, BackgroundExcelReportSnapshot> =
  createEmptySnapshots();
let buildTimer: ReturnType<typeof setTimeout> | null = null;
let generationNonce = 0;
let buildInFlight = false;
const listeners = new Set<
  (list: BackgroundExcelReportSnapshot[]) => void
>();

function emit(): void {
  const ordered = REPORT_ORDER.map((id) => snapshots[id]);
  listeners.forEach((cb) => cb(ordered));
}

export function getBackgroundExcelSnapshots(): BackgroundExcelReportSnapshot[] {
  if (!currentIsAdmin) return [];
  return REPORT_ORDER.map((id) => snapshots[id]);
}

export function subscribeBackgroundExcelReports(
  cb: (list: BackgroundExcelReportSnapshot[]) => void
): () => void {
  listeners.add(cb);
  cb(getBackgroundExcelSnapshots());
  return () => {
    listeners.delete(cb);
  };
}

export function clearBackgroundExcelReports(): void {
  if (buildTimer) {
    clearTimeout(buildTimer);
    buildTimer = null;
  }
  generationNonce += 1;
  buildInFlight = false;
  latestDataset = null;
  snapshots = createEmptySnapshots();
  emit();
}

function buildWorkbookForId(
  id: BackgroundExcelReportId,
  ds: AdminExcelDataset
): { wb: XLSX.WorkBook; filename: string; rowCount: number } {
  const today = new Date();
  const toDate = ymd(today);
  const firstOfMonth = ymd(new Date(today.getFullYear(), today.getMonth(), 1));
  const fullFrom = '2020-01-01';
  const fullTo = '2099-12-31';

  switch (id) {
    case 'downtime': {
      const { wb, filename } = buildDowntimeExcelWorkbook(
        firstOfMonth,
        toDate,
        ds.machines,
        ds.downtimeEntries,
        ds.supervisorName || 'Plant Admin'
      );
      return {
        wb,
        filename,
        rowCount: ds.downtimeEntries.filter((e) => !e.del).length,
      };
    }
    case 'production_period': {
      const report = buildUnifiedProductionReport({
        fromDate: firstOfMonth,
        toDate,
        machines: ds.machines,
        downtimeEntries: ds.downtimeEntries,
        allDispatches: ds.dispatches,
        sopProductionLogs: ds.sopProductionLogs,
        sopQcChecks: ds.sopQcChecks,
        dieselRequests: ds.dieselRequests,
        dieselGrns: ds.dieselGrns,
        dieselTank: ds.dieselTank,
        generatorLogs: ds.generatorLogs,
        powerCutLogs: ds.powerCutLogs,
      });
      const { wb, filename } = buildUnifiedProductionReportWorkbook(report);
      const rowCount =
        report.dispatchRows.length +
        report.shiftProductionRows.length +
        report.qcRows.length +
        report.fuelIssueRows.length +
        report.fuelGrnRows.length +
        report.generatorRows.length +
        report.powerCutRows.length;
      return { wb, filename, rowCount };
    }
    case 'dispatch': {
      const { wb, filename } = buildDispatchExcelWorkbook(
        ds.dispatches,
        fullFrom,
        fullTo,
        ds.sopProductionLogs
      );
      return { wb, filename, rowCount: ds.dispatches.length };
    }
    case 'diesel': {
      const { wb, filename } = buildDieselExcelWorkbook(
        ds.dieselRequests,
        ds.dieselGrns,
        ds.dieselTank,
        '',
        ''
      );
      return {
        wb,
        filename,
        rowCount: ds.dieselRequests.length + ds.dieselGrns.length,
      };
    }
    case 'power_cut': {
      const { wb, filename } = buildPowerCutWorkbook(ds.powerCutLogs, '', '');
      return { wb, filename, rowCount: ds.powerCutLogs.length };
    }
    case 'generator': {
      const { wb, filename } = buildGeneratorWorkbook(ds.generatorLogs, '', '');
      return { wb, filename, rowCount: ds.generatorLogs.length };
    }
    case 'scrap_sales': {
      const { wb, filename } = buildScrapSalesExcelWorkbook(
        ds.scrapSalesInvoices,
        'All_Invoices'
      );
      return { wb, filename, rowCount: ds.scrapSalesInvoices.length };
    }
    case 'attendance': {
      const { wb, filename } = buildAttendanceExcelWorkbook(
        ds.attendanceBatch,
        '',
        '',
        'All'
      );
      return { wb, filename, rowCount: ds.attendanceBatch.length };
    }
    case 'qc_logs': {
      return buildQcLogsExcelWorkbook(ds.qcLogs, '', '');
    }
    case 'quality_trials': {
      const { wb, filename } = buildQualityTrialsWorkbook(ds.qualityTrials);
      return { wb, filename, rowCount: ds.qualityTrials.length };
    }
    case 'sop_master': {
      const { wb, filename } = buildSopMasterWorkbook({
        production: ds.sopProductionLogs,
        qcChecks: ds.sopQcChecks,
        scrapPipeline: ds.sopScrapPipeline,
        mixingReports: ds.sopMixingReports,
        handovers: ds.sopHandovers,
      });
      const rowCount =
        ds.sopProductionLogs.length +
        ds.sopQcChecks.length +
        ds.sopScrapPipeline.length +
        ds.sopMixingReports.length +
        ds.sopHandovers.length;
      return { wb, filename, rowCount };
    }
    case 'tqm': {
      const analytics = buildUnifiedTqmAnalytics({
        fromDate: firstOfMonth,
        toDate,
        machines: ds.machines,
        downtimeEntries: ds.downtimeEntries,
        dispatches: ds.dispatches,
        monthlyPlans: ds.monthlyPlans || [],
        specialOrders: ds.specialOrders || [],
        specialOrderProductions: ds.specialOrderProductions || [],
        specialOrderWhDispatches: ds.specialOrderWhDispatches || [],
        qualityTrials: ds.qualityTrials,
        sopProductionLogs: ds.sopProductionLogs,
        sopQcChecks: ds.sopQcChecks,
        sopScrapPipeline: ds.sopScrapPipeline,
        sopMixingReports: ds.sopMixingReports,
        sopHandovers: ds.sopHandovers,
        scrapSalesInvoices: ds.scrapSalesInvoices,
        dieselRequests: ds.dieselRequests,
        dieselGrns: ds.dieselGrns,
        dieselTank: ds.dieselTank,
        powerCutLogs: ds.powerCutLogs,
        generatorLogs: ds.generatorLogs,
        attendanceBatch: ds.attendanceBatch,
        qcLogs: ds.qcLogs,
        tqmCapas: ds.tqmCapas || [],
      });
      return buildTqmMasterExcelWorkbook(analytics, ds.tqmCapas || []);
    }
  }
}

async function compileReportInBackground(
  id: BackgroundExcelReportId,
  ds: AdminExcelDataset,
  nonce: number
): Promise<BackgroundExcelReportSnapshot | null> {
  if (!currentIsAdmin || nonce !== generationNonce) return null;

  snapshots = {
    ...snapshots,
    [id]: {
      ...snapshots[id],
      status: 'generating',
      error: null,
    },
  };
  emit();

  try {
    const { wb, filename, rowCount } = buildWorkbookForId(id, ds);
    const out = await XLSX.writeAsync(wb, { bookType: 'xlsx', type: 'array' });
    if (!currentIsAdmin || nonce !== generationNonce) return null;

    const blob = new Blob([out], { type: EXCEL_MIME });
    const nextSnap: BackgroundExcelReportSnapshot = {
      id,
      label: REPORT_DEFS[id].label,
      category: REPORT_DEFS[id].category,
      filename,
      status: 'ready',
      blob,
      sizeBytes: blob.size,
      rowCount,
      generatedAtIso: new Date().toISOString(),
      error: null,
    };
    snapshots = { ...snapshots, [id]: nextSnap };
    emit();
    return nextSnap;
  } catch (err) {
    if (!currentIsAdmin || nonce !== generationNonce) return null;
    const msg =
      err instanceof Error ? err.message : 'Background Excel generation failed';
    snapshots = {
      ...snapshots,
      [id]: {
        ...snapshots[id],
        status: 'error',
        error: msg,
      },
    };
    emit();
    return null;
  }
}

export async function buildAllAdminExcelReportsNow(
  isAdmin: boolean
): Promise<void> {
  if (!isAdmin || !currentIsAdmin || !latestDataset) return;
  if (buildInFlight) return;

  buildInFlight = true;
  const nonce = ++generationNonce;
  const ds = latestDataset;

  try {
    for (const id of REPORT_ORDER) {
      if (!currentIsAdmin || nonce !== generationNonce) break;
      await compileReportInBackground(id, ds, nonce);
      // Yield between reports so the UI remains completely responsive
      await new Promise((r) => setTimeout(r, 25));
    }
  } finally {
    buildInFlight = false;
  }
}

export function updateBackgroundExcelDataset(
  isAdmin: boolean,
  dataset: AdminExcelDataset | null
): void {
  if (!isAdmin || !dataset) {
    currentIsAdmin = false;
    clearBackgroundExcelReports();
    return;
  }

  currentIsAdmin = true;
  latestDataset = dataset;

  if (buildTimer) {
    clearTimeout(buildTimer);
  }
  // Debounce background compilation slightly when live snapshots stream in
  buildTimer = setTimeout(() => {
    buildTimer = null;
    void buildAllAdminExcelReportsNow(true);
  }, 1500);
}

export async function regenerateAdminExcelReport(
  id: BackgroundExcelReportId,
  isAdmin: boolean
): Promise<BackgroundExcelReportSnapshot | null> {
  if (!isAdmin || !currentIsAdmin || !latestDataset) return null;
  const nonce = generationNonce;
  return compileReportInBackground(id, latestDataset, nonce);
}

function triggerBlobDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1500);
}

export async function downloadBackgroundExcelReport(
  id: BackgroundExcelReportId,
  isAdmin: boolean
): Promise<string> {
  if (!isAdmin || !currentIsAdmin) return '';

  let snap: BackgroundExcelReportSnapshot | null = snapshots[id] || null;
  if (!snap || !snap.blob || snap.status !== 'ready') {
    snap = await regenerateAdminExcelReport(id, true);
  }
  const readyBlob = snap?.blob;
  if (!snap || !readyBlob) return '';

  triggerBlobDownload(snap.filename, readyBlob);
  return snap.filename;
}
