export const EXTRUSION_MACHINES = [
  'Extrusion Machine 1',
  'Extrusion Machine 2',
  'Extrusion Machine 3',
  'Extrusion Machine 4',
  'Extrusion Machine 6',
  'Trunking Machine',
  'Hose Pipe Machine',
  'Polypipe Machine 1',
  'Polypipe Machine 2',
  'Ducting Machine',
] as const;

export const INJECTION_MACHINES = [
  'IM 1',
  'IM 2',
  'IM 3',
  'IM 4',
  'IM 5',
  'IM 6',
  'IM 7',
  'Gumboot Machine',
  'Palletizer Machine',
  'Punching Machine 1',
  'Punching Machine 2',
] as const;

export const MIXER_MACHINES = [
  'Mixer Machine 1',
  'Mixer Machine 2',
  'Mixer Machine 3',
  'Mixer Machine 4',
  'Mixer Machine 5',
] as const;

export const RECYCLING_MACHINES = [
  'Shredder',
  'Pulverizer',
  'Crusher',
  'Yellow Crusher',
  'Green Crusher',
  'Polypipe Crusher',
  'Vibrator Machine',
] as const;

export const UTILITY_MACHINES = [
  'Chiller',
  'Generator',
] as const;

export type MachineDepartment =
  | 'Extrusion'
  | 'Injection'
  | 'Mixer'
  | 'Recycling'
  | 'Utility';

export function getMachineDepartment(m: string): MachineDepartment {
  const norm = normalizeMachineName(m).toLowerCase();
  if (EXTRUSION_MACHINES.some((x) => x.toLowerCase() === norm)) return 'Extrusion';
  if (INJECTION_MACHINES.some((x) => x.toLowerCase() === norm)) return 'Injection';
  if (MIXER_MACHINES.some((x) => x.toLowerCase() === norm)) return 'Mixer';
  if (RECYCLING_MACHINES.some((x) => x.toLowerCase() === norm)) return 'Recycling';
  if (UTILITY_MACHINES.some((x) => x.toLowerCase() === norm)) return 'Utility';
  return 'Extrusion';
}

const MACHINE_ALIAS_MAP: Record<string, string> = {
  '01': 'Extrusion Machine 1',
  '1': 'Extrusion Machine 1',
  'line one': 'Extrusion Machine 1',
  'line 1': 'Extrusion Machine 1',
  'line-1': 'Extrusion Machine 1',
  'line 01': 'Extrusion Machine 1',
  'extrusion 1': 'Extrusion Machine 1',
  'extrusion one': 'Extrusion Machine 1',
  'extrusion machine 1': 'Extrusion Machine 1',
  'extrusion machine one': 'Extrusion Machine 1',
  '02': 'Extrusion Machine 2',
  '2': 'Extrusion Machine 2',
  'line two': 'Extrusion Machine 2',
  'line 2': 'Extrusion Machine 2',
  'line-2': 'Extrusion Machine 2',
  'line 02': 'Extrusion Machine 2',
  'extrusion 2': 'Extrusion Machine 2',
  'extrusion two': 'Extrusion Machine 2',
  'extrusion machine 2': 'Extrusion Machine 2',
  'extrusion machine two': 'Extrusion Machine 2',
  '03': 'Extrusion Machine 3',
  '3': 'Extrusion Machine 3',
  'line three': 'Extrusion Machine 3',
  'line 3': 'Extrusion Machine 3',
  'line-3': 'Extrusion Machine 3',
  'line 03': 'Extrusion Machine 3',
  'extrusion 3': 'Extrusion Machine 3',
  'extrusion machine 3': 'Extrusion Machine 3',
  '04': 'Extrusion Machine 4',
  '4': 'Extrusion Machine 4',
  'line four': 'Extrusion Machine 4',
  'line 4': 'Extrusion Machine 4',
  'line-4': 'Extrusion Machine 4',
  'line 04': 'Extrusion Machine 4',
  'extrusion 4': 'Extrusion Machine 4',
  'extrusion machine 4': 'Extrusion Machine 4',
  '05': 'Trunking Machine',
  '5': 'Trunking Machine',
  'line 5': 'Trunking Machine',
  'line 05': 'Trunking Machine',
  'line five': 'Trunking Machine',
  '06': 'Extrusion Machine 6',
  '6': 'Extrusion Machine 6',
  'line 6': 'Extrusion Machine 6',
  'line-6': 'Extrusion Machine 6',
  'line 06': 'Extrusion Machine 6',
  'line six': 'Extrusion Machine 6',
  'extrusion 6': 'Extrusion Machine 6',
  'extrusion six': 'Extrusion Machine 6',
  'extrusion machine 6': 'Extrusion Machine 6',
  'extrusion machine six': 'Extrusion Machine 6',
  '07': 'Hose Pipe Machine',
  '7': 'Hose Pipe Machine',
  'line 7': 'Hose Pipe Machine',
  'line 07': 'Hose Pipe Machine',
  'line seven': 'Hose Pipe Machine',
  'hose pipe': 'Hose Pipe Machine',
  'hosepipe': 'Hose Pipe Machine',
  'hose pipe machine': 'Hose Pipe Machine',
  '08': 'Polypipe Machine 1',
  '8': 'Polypipe Machine 1',
  'line 8': 'Polypipe Machine 1',
  'line 08': 'Polypipe Machine 1',
  'line eight': 'Polypipe Machine 1',
  'poly pipe': 'Polypipe Machine 1',
  'poly-pipe': 'Polypipe Machine 1',
  'poly pipe 1': 'Polypipe Machine 1',
  'poly pipe machine': 'Polypipe Machine 1',
  'poly pipe machine 1': 'Polypipe Machine 1',
  'polypipe': 'Polypipe Machine 1',
  'polypipe 1': 'Polypipe Machine 1',
  'polypipe one': 'Polypipe Machine 1',
  'polypipe machine': 'Polypipe Machine 1',
  'polypipe machine 1': 'Polypipe Machine 1',
  'polypipe 2': 'Polypipe Machine 2',
  'polypipe two': 'Polypipe Machine 2',
  'poly pipe 2': 'Polypipe Machine 2',
  'polypipe machine 2': 'Polypipe Machine 2',
  'polypipe crusher': 'Polypipe Crusher',
  'trunking': 'Trunking Machine',
  'trunking machine': 'Trunking Machine',
  'ducting': 'Ducting Machine',
  'ducting machine': 'Ducting Machine',
  im1: 'IM 1',
  'im 1': 'IM 1',
  'im-1': 'IM 1',
  'injection maulding -1': 'IM 1',
  'injection moulding 1': 'IM 1',
  im2: 'IM 2',
  'im 2': 'IM 2',
  'im-2': 'IM 2',
  'injection maulding machine -2': 'IM 2',
  'injection moulding machine 2': 'IM 2',
  im3: 'IM 3',
  'im 3': 'IM 3',
  'im-3': 'IM 3',
  'injection maulding machine 3': 'IM 3',
  'injection moulding machine 3': 'IM 3',
  im4: 'IM 4',
  'im 4': 'IM 4',
  'im-4': 'IM 4',
  'imjectiopn moulding machine 4': 'IM 4',
  'injection moulding machine 4': 'IM 4',
  im5: 'IM 5',
  'im 5': 'IM 5',
  'im-5': 'IM 5',
  im6: 'IM 6',
  'im 6': 'IM 6',
  'im-6': 'IM 6',
  im7: 'IM 7',
  'im 7': 'IM 7',
  'im-7': 'IM 7',
  'gumboot': 'Gumboot Machine',
  'gumboot machine': 'Gumboot Machine',
  'palletizer': 'Palletizer Machine',
  'palletiser': 'Palletizer Machine',
  'palletizer machine': 'Palletizer Machine',
  'punching 1': 'Punching Machine 1',
  'punching machine 1': 'Punching Machine 1',
  'punching machine-1': 'Punching Machine 1',
  'punching 2': 'Punching Machine 2',
  'punching machine 2': 'Punching Machine 2',
  'punching machine-2': 'Punching Machine 2',
  'mixer 1': 'Mixer Machine 1',
  'mixer machine 1': 'Mixer Machine 1',
  'mixer 2': 'Mixer Machine 2',
  'mixer machine 2': 'Mixer Machine 2',
  'mixer 3': 'Mixer Machine 3',
  'mixer machine 3': 'Mixer Machine 3',
  'mixer 4': 'Mixer Machine 4',
  'mixer machine 4': 'Mixer Machine 4',
  'mixer 5': 'Mixer Machine 5',
  'mixer machine 5': 'Mixer Machine 5',
};

const WORD_NUM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bone\b/gi, '1'],
  [/\btwo\b/gi, '2'],
  [/\bthree\b/gi, '3'],
  [/\bfour\b/gi, '4'],
  [/\bfive\b/gi, '5'],
  [/\bsix\b/gi, '6'],
  [/\bseven\b/gi, '7'],
  [/\beight\b/gi, '8'],
];

export function normalizeMachineName(raw?: string): string {
  const clean = (raw || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '';

  const lower = clean.toLowerCase();
  const direct = MACHINE_ALIAS_MAP[lower];
  if (direct) return direct;

  // Normalize punctuation & word numbers (e.g. "LINE - ONE", "Poly Pipe 1", "Extrusion Line 6")
  let normalized = lower.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  WORD_NUM_REPLACEMENTS.forEach(([re, digit]) => {
    normalized = normalized.replace(re, digit);
  });

  const mappedAfterWords = MACHINE_ALIAS_MAP[normalized];
  if (mappedAfterWords) return mappedAfterWords;

  if (/polypipe\s*crusher|poly\s*pipe\s*crusher/.test(normalized)) {
    return 'Polypipe Crusher';
  }
  const polyMatch = normalized.match(/poly\s*pipe(?:\s*(?:machine|line))?\s*0*(\d+)?$/);
  if (polyMatch) {
    const num = Number(polyMatch[1] || '1');
    return num === 2 ? 'Polypipe Machine 2' : 'Polypipe Machine 1';
  }

  const extMatch = normalized.match(/^(?:extrusion\s*(?:machine|line)?|extruder|line)\s*0*(\d+)$/);
  if (extMatch) {
    const num = Number(extMatch[1]);
    if (num === 5) return 'Trunking Machine';
    if (num === 7) return 'Hose Pipe Machine';
    if (num === 8) return 'Polypipe Machine 1';
    return `Extrusion Machine ${num}`;
  }

  const imMatch = normalized.match(/^(?:i\.?\s*m\.?|injection(?:\s*(?:moulding|maulding|molding|machine))?)\s*0*(\d+)$/);
  if (imMatch) {
    return `IM ${Number(imMatch[1])}`;
  }

  const mixMatch = normalized.match(/^mixer(?:\s*machine)?\s*0*(\d+)$/);
  if (mixMatch) {
    return `Mixer Machine ${Number(mixMatch[1])}`;
  }

  const punchMatch = normalized.match(/^punching(?:\s*machine)?\s*0*(\d+)$/);
  if (punchMatch) {
    return `Punching Machine ${Number(punchMatch[1])}`;
  }

  return clean;
}

export const DEFAULT_MACHINES: string[] = [
  ...EXTRUSION_MACHINES,
  ...INJECTION_MACHINES,
  ...MIXER_MACHINES,
  ...RECYCLING_MACHINES,
  ...UTILITY_MACHINES,
];

export const DEFAULT_REPORTERS: string[] = [
  'ERIC NYAMAPANDA',
  'INNOCENT MAVIYANI',
  'TRUST GWEME',
  'SIMBARASHE CHAUNOITA',
  'PLANT ADMINISTRATOR',
];

export const STOPPAGE_CATEGORIES = [
  'Breakdown',
  'No planning',
  'Production plan finish',
  'Changeover (job card)',
  'Planned maintenance',
  'No raw material',
  'No power / utilities',
  'No operator / other',
  'Running update',
] as const;

export type StoppageCategory = (typeof STOPPAGE_CATEGORIES)[number];

export const JOB_CARD_PLANS = [
  'In progress',
  'Production plan finish',
  'No planning',
  'Finished',
  'On Target',
  'Scheduled',
  'Not applicable',
] as const;

export type JobCardPlan = (typeof JOB_CARD_PLANS)[number];

export interface DowntimeEntry {
  id: string;
  m: string; // Machine name
  cat: string; // Category
  start: string; // datetime-local format (YYYY-MM-DDTHH:mm)
  end: string; // datetime-local format or '' if still OFF
  reason: string;
  jcn?: string; // Job card running name or number
  jcp?: JobCardPlan | string; // Planning status
  rep?: string; // Reported by
  by?: string; // User identity / email
  upd: number; // Update timestamp
  sy?: number; // Sync timestamp
  del?: number; // 1 if soft deleted

  // Enhanced Operational Floor Data
  operator?: string; // Machine Operator name (from factory staff roster)
  generalHand?: string; // General hand name (roster or written casual)
  isCasual?: boolean; // True if general hand/assistant is casual (manual name)
  mtncePerson?: string; // Maintenance person attending if breakdown or changeover
  outputPerHour?: string; // Running output (e.g. 140 m/hr, 250 units/hr)
  runningWeight?: string; // Running weight (e.g. 640 kg)
  shift?: string; // Day (07:30 - 19:30) or Night (19:30 - 07:30)

  // Audit User Attribution (Tracks who entered the record)
  loggedBy?: string; // Display name of logged-in person
  loggedByEmail?: string; // Email of the user who entered the record

  // Utility Machine Telemetry
  chillerTemp?: number; // °C
  chillerPressure?: number; // bar
  chillerFreq?: number; // Hz
  genStartTime?: string; // e.g. "08:15"
  genStartFuel?: number; // Litres (L)
  genOffTime?: string; // e.g. "12:00"
  genOffFuel?: number; // Litres (L)
  genFuelUnit?: 'L' | '%';
  linkedGeneratorLogId?: string;

  // Digital signature fields
  signature?: string; // Base64 PNG data URL
  signedAt?: string;
  supervisorSignature?: string; // Supervisor Base64 PNG data URL
  supervisorName?: string;
  supervisorSignedAt?: string;

  // Optional legacy fields for backward compatibility
  equipmentId?: string;
  equipmentName?: string;
  location?: string;
  date?: string;
  category?: string;
  severity?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  faultDescription?: string;
  rootCause?: string;
  actionTaken?: string;
  status?: string;
  technicianName?: string;
  technicianBadge?: string;
  technicianSignature?: string;
  technicianSignedAt?: string;
  supervisorBadge?: string;
  digitalVerificationCode?: string;
  lostOutputUnits?: number;
  estimatedCostLoss?: number;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
}

export interface MachineDayStats {
  avail: number;
  run: number;
  down: number;
  bd: number;
  co: number;
  ot: number;
  jc: number;
  jct: number;
}

export interface PeriodSummaryRow {
  machine: string;
  periodHrs: number;
  runHrs: number;
  downHrs: number;
  breakdownHrs: number;
  changeoverHrs: number;
  otherHrs: number;
  availabilityPercent: number;
  jobCardsFinished: number;
  jobCardsLogged: number;
}

export interface SyncUser {
  user: string;
  lastSeen?: string;
  entriesSent: number;
}

export interface AppSyncSettings {
  url?: string;
  key?: string;
  user?: string;
}

export interface DailySummary {
  id: string;
  date: string;
  shift: string;
  totalIncidents: number;
  totalDowntimeMinutes: number;
  availabilityPercent: number;
  operatingHours: number;
  dailyNotes: string;
  shiftSupervisor: string;
  supervisorSignature?: string;
  isClosed: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface PlantEquipment {
  id: string;
  name: string;
  location: string;
  criticality: 'High' | 'Medium' | 'Low';
  department?: string;
}

export const INITIAL_EQUIPMENT_LIST: PlantEquipment[] = DEFAULT_MACHINES.map((m, idx) => ({
  id: `M-${idx + 1}`,
  name: m,
  location: 'Plant Floor',
  criticality: 'High',
  department: m.includes('Mixer') ? 'Mixing' : m.includes('Extrusion') ? 'Extrusion' : 'Production',
}));

export type DowntimeLog = DowntimeEntry;
export type ShiftType = string;
export type DowntimeCategory = string;
export type DowntimeSeverity = string;
export type DowntimeStatus = string;

export type PlantRole =
  | 'Machine Operator'
  | 'Operator Assistant'
  | 'Maintenance Technician'
  | 'QC Inspector'
  | 'Recycling Team'
  | 'Mixer Operator'
  | 'Forklift Driver'
  | 'Shift Supervisor'
  | 'Shift In Charge'
  | 'WH Personnel'
  | 'Production HOD'
  | 'Plant Administrator';

export interface UserPermissions {
  viewMachineStatus: boolean;
  logDowntime: boolean;
  viewDailyHours: boolean;
  exportDowntimeExcel: boolean;
  dispatchShiftEntry: boolean;
  dispatchWHConfirm: boolean;
  dispatchHODConfirm: boolean;
  exportDispatchExcel: boolean;
  attendanceLogger: boolean;
  manageMachinesAndSync: boolean;
  sopFloorAccess?: boolean;
  sopScrapSend?: boolean;
  sopRecyclingConfirm?: boolean;
  sopMixingAccess?: boolean;
  dieselFuelRequest?: boolean;
  dieselHODApprove?: boolean;
  dieselGRN?: boolean;
  dieselExportExcel?: boolean;
  productionPlanningAccess?: boolean;
  productionReportAccess?: boolean;
  specialOrdersAccess?: boolean;
  qualityTrialsAccess?: boolean;
}

export const FULL_ADMIN_PERMISSIONS: UserPermissions = {
  viewMachineStatus: true,
  logDowntime: true,
  viewDailyHours: true,
  exportDowntimeExcel: true,
  dispatchShiftEntry: true,
  dispatchWHConfirm: true,
  dispatchHODConfirm: true,
  exportDispatchExcel: true,
  attendanceLogger: true,
  manageMachinesAndSync: true,
  sopFloorAccess: true,
  sopScrapSend: true,
  sopRecyclingConfirm: true,
  sopMixingAccess: true,
  dieselFuelRequest: true,
  dieselHODApprove: true,
  dieselGRN: true,
  dieselExportExcel: true,
  productionPlanningAccess: true,
  productionReportAccess: true,
  specialOrdersAccess: true,
  qualityTrialsAccess: true,
};

export function getDefaultPermissionsForRole(role: PlantRole): UserPermissions {
  switch (role) {
    case 'Plant Administrator':
    case 'Production HOD':
      return { ...FULL_ADMIN_PERMISSIONS };
    case 'Forklift Driver':
      return {
        viewMachineStatus: true,
        logDowntime: false,
        viewDailyHours: false,
        exportDowntimeExcel: false,
        dispatchShiftEntry: false,
        dispatchWHConfirm: false,
        dispatchHODConfirm: false,
        exportDispatchExcel: false,
        attendanceLogger: false,
        manageMachinesAndSync: false,
        sopFloorAccess: false,
        sopScrapSend: false,
        sopRecyclingConfirm: false,
        sopMixingAccess: false,
        dieselFuelRequest: true,
        dieselHODApprove: false,
        dieselGRN: false,
        dieselExportExcel: false,
        productionPlanningAccess: false,
        productionReportAccess: false,
        specialOrdersAccess: false,
        qualityTrialsAccess: false,
      };
    case 'WH Personnel':
      return {
        viewMachineStatus: false,
        logDowntime: false,
        viewDailyHours: false,
        exportDowntimeExcel: false,
        dispatchShiftEntry: false,
        dispatchWHConfirm: true,
        dispatchHODConfirm: false,
        exportDispatchExcel: false,
        attendanceLogger: false,
        manageMachinesAndSync: false,
        sopFloorAccess: false,
        sopScrapSend: false,
        sopRecyclingConfirm: false,
        sopMixingAccess: false,
        dieselFuelRequest: false,
        dieselHODApprove: false,
        dieselGRN: true,
        dieselExportExcel: false,
        productionPlanningAccess: false,
        productionReportAccess: false,
        specialOrdersAccess: true,
        qualityTrialsAccess: false,
      };
    case 'Shift In Charge':
      return {
        viewMachineStatus: true,
        logDowntime: true,
        viewDailyHours: false,
        exportDowntimeExcel: false,
        dispatchShiftEntry: true,
        dispatchWHConfirm: false,
        dispatchHODConfirm: false,
        exportDispatchExcel: false,
        attendanceLogger: false,
        manageMachinesAndSync: false,
        sopFloorAccess: false,
        sopScrapSend: false,
        sopRecyclingConfirm: false,
        sopMixingAccess: false,
        dieselFuelRequest: false,
        dieselHODApprove: false,
        dieselGRN: false,
        dieselExportExcel: false,
        productionPlanningAccess: true,
        productionReportAccess: false,
        specialOrdersAccess: true,
        qualityTrialsAccess: false,
      };
    case 'Recycling Team':
      return {
        viewMachineStatus: true,
        logDowntime: false,
        viewDailyHours: false,
        exportDowntimeExcel: false,
        dispatchShiftEntry: false,
        dispatchWHConfirm: false,
        dispatchHODConfirm: false,
        exportDispatchExcel: false,
        attendanceLogger: false,
        manageMachinesAndSync: false,
        sopFloorAccess: true,
        sopScrapSend: false,
        sopRecyclingConfirm: true,
        sopMixingAccess: false,
        dieselFuelRequest: false,
        dieselHODApprove: false,
        dieselGRN: false,
        dieselExportExcel: false,
        productionPlanningAccess: false,
        productionReportAccess: false,
      };
    case 'Mixer Operator':
      return {
        viewMachineStatus: true,
        logDowntime: true,
        viewDailyHours: false,
        exportDowntimeExcel: false,
        dispatchShiftEntry: false,
        dispatchWHConfirm: false,
        dispatchHODConfirm: false,
        exportDispatchExcel: false,
        attendanceLogger: false,
        manageMachinesAndSync: false,
        sopFloorAccess: true,
        sopScrapSend: true,
        sopRecyclingConfirm: false,
        sopMixingAccess: true,
        dieselFuelRequest: false,
        dieselHODApprove: false,
        dieselGRN: false,
        dieselExportExcel: false,
        productionPlanningAccess: false,
        productionReportAccess: false,
        specialOrdersAccess: false,
        qualityTrialsAccess: true,
      };
    case 'Shift Supervisor':
      return {
        viewMachineStatus: true,
        logDowntime: true,
        viewDailyHours: true,
        exportDowntimeExcel: false,
        dispatchShiftEntry: true,
        dispatchWHConfirm: false,
        dispatchHODConfirm: false,
        exportDispatchExcel: false,
        attendanceLogger: true,
        manageMachinesAndSync: false,
        sopFloorAccess: true,
        sopScrapSend: true,
        sopRecyclingConfirm: false,
        sopMixingAccess: true,
        dieselFuelRequest: true,
        dieselHODApprove: false,
        dieselGRN: false,
        dieselExportExcel: false,
        productionPlanningAccess: true,
        productionReportAccess: false,
        specialOrdersAccess: true,
        qualityTrialsAccess: true,
      };
    case 'QC Inspector':
      return {
        viewMachineStatus: true,
        logDowntime: true,
        viewDailyHours: true,
        exportDowntimeExcel: false,
        dispatchShiftEntry: false,
        dispatchWHConfirm: false,
        dispatchHODConfirm: false,
        exportDispatchExcel: false,
        attendanceLogger: false,
        manageMachinesAndSync: false,
        sopFloorAccess: true,
        sopScrapSend: true,
        sopRecyclingConfirm: false,
        sopMixingAccess: false,
        dieselFuelRequest: false,
        dieselHODApprove: false,
        dieselGRN: false,
        dieselExportExcel: false,
        productionPlanningAccess: false,
        productionReportAccess: false,
        specialOrdersAccess: false,
        qualityTrialsAccess: true,
      };
    case 'Machine Operator':
    case 'Operator Assistant':
    case 'Maintenance Technician':
    default:
      return {
        viewMachineStatus: true,
        logDowntime: true,
        viewDailyHours: true,
        exportDowntimeExcel: false,
        dispatchShiftEntry: false,
        dispatchWHConfirm: false,
        dispatchHODConfirm: false,
        exportDispatchExcel: false,
        attendanceLogger: false,
        manageMachinesAndSync: false,
        sopFloorAccess: true,
        sopScrapSend: true,
        sopRecyclingConfirm: false,
        sopMixingAccess: false,
        dieselFuelRequest: false,
        dieselHODApprove: false,
        dieselGRN: false,
        dieselExportExcel: false,
        productionPlanningAccess: false,
        productionReportAccess: false,
        specialOrdersAccess: false,
        qualityTrialsAccess: false,
      };
  }
}

export interface PlantUserAccount {
  uid: string;
  email: string;
  displayName: string;
  role: PlantRole;
  department: string;
  permissions?: UserPermissions;
  createdBy: string;
  createdAt: string;
  status: 'active' | 'suspended';
}

export type DispatchStatus = 'PENDING_WH' | 'PENDING_HOD' | 'CONFIRMED';

export interface DispatchQtyEditRecord {
  previousQty: number;
  newQty: number;
  reason: string;
  editedBy: string;
  editedAt: string;
}

export interface DispatchEntry {
  id: string;
  date: string; // YYYY-MM-DD
  shift: 'Day' | 'Night';
  machine: string;
  product: string;
  trolleyNo: string;

  // Stage 1: Shift In Charge
  recordedQty: number;
  unitWeightKg?: number; // Weight of 1 item qty (kg)
  totalWeightKg?: number; // Calculated weight (qty * unitWeightKg)
  operatorName: string;
  assistantName: string;
  isCasualAssistant?: boolean;
  casualAssistantName?: string; // Name of casual who assisted
  shiftInChargeName: string;
  shiftInChargeSignature: string;
  shiftNotes?: string;
  shiftSubmittedAt: string;
  shiftSubmittedByEmail: string;

  // Stage 2: WH Personnel Confirmation & Stock Qty Adjustment
  whReceivedQty?: number;
  whPersonnelName?: string;
  whSignature?: string;
  whNotes?: string;
  whConfirmedAt?: string;
  whConfirmedByEmail?: string;
  whPreviousReceivedQty?: number;
  whQtyEditReason?: string;
  whQtyEditedAt?: string;
  whQtyEditedBy?: string;
  whQtyEditHistory?: DispatchQtyEditRecord[];

  // Stage 3: Production HOD / Admin Final Confirmation
  hodConfirmedByName?: string;
  hodConfirmedByEmail?: string;
  hodSignature?: string;
  hodNotes?: string;
  hodConfirmedAt?: string;

  // Workflow Status & Sync
  status: DispatchStatus;
  upd: number;
  sy?: number;

  // Historical Background Continuation Fields (From Uploaded/Previous Month Sheets)
  isHistoricalBackground?: boolean;
  sourceUploadBatch?: string;
  backgroundScrapKg?: number;
  backgroundWastageKg?: number;

  // Special Order WH Dispatch Linkage
  isSpecialOrderDispatch?: boolean;
  specialOrderId?: string;
  specialOrderDispatchId?: string;
}

// ======================================================
// UNIFIED SOP FLOOR APK DATA TYPES (PRODUCTION, QC, SCRAP, MIXING, HANDOVER)
// ======================================================

export interface SopProductionRecord {
  id: string;
  date: string; // YYYY-MM-DD
  shift: 'Day' | 'Night';
  dept: string; // Extrusion | Injection | Mixing | Maintenance
  machine: string;
  operator: string;
  assistant: string;
  product: string;
  timeSlot?: string;
  qty?: number;
  unit?: string; // GOOD PIECES | BAGS | BUNDLES | PIPES | KG
  prodKg: number;
  scrapKg: number;
  wastageCdKg: number; // Cut dust / wastage in kg
  outputPerHour?: string;
  runningWeight?: string;
  scrapReason?: string;
  bdStart?: string;
  bdEnd?: string;
  bdReason?: string;
  mtncePerson?: string;
  reporter?: string;
  source: 'MANUAL' | 'WHATSAPP_PARSER';
  loggedBy: string;
  upd: number;
  sy?: number;
}

export interface SopQcRecord {
  id: string;
  date: string; // YYYY-MM-DD
  shift: 'Day' | 'Night';
  time?: string;
  qcNo?: string;
  machine: string;
  product: string;
  pph?: number | string;
  pphUnit?: string;
  kgsPerHr?: number | string;
  weightType?: string;
  weightKg?: number | string;
  printing?: string;
  lengthM?: number | string;
  socketSize?: string;
  dropBend: 'Pass' | 'Fail' | string;
  fitting: 'Pass' | 'Fail' | string;
  color: 'Pass' | 'Fail' | string;
  od?: number | string;
  idMm?: number | string;
  reporter?: string;
  source: 'MANUAL' | 'WHATSAPP_PARSER';
  loggedBy: string;
  upd: number;
  sy?: number;
}

export type SopScrapPipelineStatus =
  | 'SENT_TO_RECYCLING'
  | 'RECEIVED_BY_RECYCLING'
  | 'PROCESSED_FOR_MIXER'
  | 'RECEIVED_BY_MIXER';

export interface SopScrapRecord {
  id: string;
  date: string; // YYYY-MM-DD
  time: string;
  shift: 'Day' | 'Night';
  shiftInCharge: string;
  machine: string;
  product: string;
  sentByAssistant: string;
  isCasualAssistant?: boolean;
  scrapKg: number;
  scrapReason?: string;
  assignedRecycler: string;
  sentAt: string;
  sentByEmail: string;

  // Stage 2A: Recycling Team Receipt
  receivedBy?: string;
  receivedAt?: string;
  receivedKg?: number;
  condition?: string;
  varianceKg?: number;
  verificationStatus?: 'Verified OK' | 'Discrepancy Flagged';

  // Stage 2B: Recycling Confirms Processed into Usable Material -> Triggers Mixer Pop-up
  usableMaterialKg?: number;
  recyclingWasteKg?: number;
  processedBy?: string;
  processedAt?: string;
  processingNotes?: string;

  // Stage 3: Mixer Receipt Link -> Triggers Production HOD Pop-up
  receivedByMixerName?: string;
  mixerMachine?: string;
  mixerReceivedAt?: string;
  mixingReportId?: string;

  status: SopScrapPipelineStatus;
  upd: number;
  sy?: number;
}

export interface SopMixingReport {
  id: string;
  date: string; // YYYY-MM-DD
  time: string;
  shift: 'Day' | 'Night';
  machine: string;
  mixerName: string;
  assistantName: string;

  // Linked Recycled Material & WH Reserved Stock Balance
  linkedScrapIds: string[];
  scrapReceivedFromRecyclingKg: number;
  whReservedMaterialKg: number;
  whMaterialUsedKg: number;
  scrapUsedInMixingKg: number;
  sweepingMaterialKg: number;
  batchesMixed: number;
  pendingMix: number;
  endOfMixingStockKg: number;

  // Technical Mixing Parameters
  ratio?: string;
  mixTimeMin?: number;
  speedRpm?: number;
  mixTempC?: number;
  coolerTimeMin?: number;
  coolerReleaseTempC?: number;
  hotReleaseTempC?: number;
  notes?: string;

  // Stage 4: Production HOD Notification & Confirmation
  status: 'PENDING_HOD' | 'HOD_CONFIRMED';
  loggedByEmail: string;
  submittedAt: string;
  hodConfirmedBy?: string;
  hodConfirmedAt?: string;
  hodNotes?: string;
  upd: number;
  sy?: number;
}

export interface SopShiftHandoverRecord {
  id: string;
  date: string; // YYYY-MM-DD
  shift: 'Day' | 'Night';
  inCharge: string;
  totalProdKg: number;
  totalScrapKg: number;
  scrapPct: number;
  breakdownNotes: string;
  silo1Kg: number;
  silo2Kg: number;
  silo3Kg: number;
  silo4Kg: number;
  loggedBy: string;
  upd: number;
  sy?: number;
}

// ======================================================
// MONTHLY PRODUCTION PLANNING & HISTORICAL CONTINUATION
// ======================================================

export interface ProductionPlanItem {
  id: string;
  month: string; // YYYY-MM e.g. '2026-11'
  product: string;
  machine?: string;
  plannedQty: number;
  plannedKg?: number;
  unitWeightKg?: number;
  jobCardNo?: string;
  notes?: string;
  sourceFile?: string;
  uploadedBy?: string;
  batchId?: string;
  adminSignature?: string;
  signedBy?: string;
  signedAt?: string;
  superseded?: boolean;
  supersededAt?: string;
  supersededByBatchId?: string;
  updatedAt: string;
  upd: number;
  sy?: number;
}

// ======================================================
// DIESEL BOWSER TANK ISSUE & FUEL GRN WORKFLOW
// ======================================================

export type DieselRequestStatus =
  | 'PENDING_HOD'
  | 'APPROVED_FOR_DISPENSE'
  | 'DISPENSED'
  | 'REJECTED';

export interface DieselTankConfig {
  id: 'main_bowser';
  tankName: string;
  capacityLitres: number;
  currentLevelLitres: number;
  currentMeterReading: number;
  totalReceivedLitres: number;
  totalIssuedLitres: number;
  lastUpdatedAt: string;
  lastUpdatedBy: string;
  upd: number;
  sy?: number;
}

export interface DieselFuelRequest {
  id: string;
  requestNo: string;
  date: string; // YYYY-MM-DD
  shift: 'Day' | 'Night';
  vehicleOrForklift: string;
  driverName: string;
  driverEmail: string;
  requestedLitres: number;
  purpose?: string;
  driverRequestSignature: string;
  requestedAt: string;

  // CSV / Ledger structure metadata
  tankEffect?: 'ADDING' | 'REMOVING';
  dateReceived?: string;
  qntySigned?: number;
  isHistoricalCsv?: boolean;

  // Stage 2: Production HOD Approval + Single-Generation PDF Unlock
  status: DieselRequestStatus;
  hodApprovedBy?: string;
  hodApprovedLitres?: number;
  hodNotes?: string;
  hodSignature?: string;
  hodApprovedAt?: string;
  pdfGeneratedOnce?: boolean;
  pdfGeneratedAt?: string;
  pdfUnlockedDispense?: boolean;

  // Stage 3: Forklift Driver Bowser Meter Dispense (Unlocked only after Stage 2 PDF generated)
  firstMeterReading?: number;
  secondMeterReading?: number;
  actualLitresTaken?: number;
  driverDispenseSignature?: string;
  dispensedAt?: string;
  tankLevelBefore?: number;
  tankLevelAfter?: number;

  upd: number;
  sy?: number;
}

export interface DieselGrnRecord {
  id: string;
  grnNo: string;
  date: string; // YYYY-MM-DD
  shift: 'Day' | 'Night';
  supplierName: string;
  deliveryNoteNo?: string;
  receiverName: string;
  receiverEmail: string;
  firstMeterReading: number;
  secondMeterReading: number;
  litresAdded: number;
  unitPrice?: number;
  totalCost?: number;
  notes?: string;
  supplierSignature: string;
  receiverSignature: string;
  hodVerifiedBy?: string;
  tankLevelBefore: number;
  tankLevelAfter: number;

  // CSV / Ledger structure metadata
  tankEffect?: 'ADDING';
  dateRequested?: string;
  requestedLitres?: number;
  purpose?: string;
  isHistoricalCsv?: boolean;

  createdAt: string;
  upd: number;
  sy?: number;
}

// ======================================================
// POWER CUT & GENERATOR START/STOP LOGS (LITRES)
// ======================================================

export interface PowerCutLog {
  id: string;
  date: string; // YYYY-MM-DD
  shift: 'Day' | 'Night';
  timeOut: string; // YYYY-MM-DDTHH:mm
  timeBack: string; // YYYY-MM-DDTHH:mm or '' if ongoing
  durationMinutes: number;
  affectedArea: string;
  generatorUsed: boolean;
  linkedGeneratorLogId?: string;
  reason?: string;
  loggedBy: string;
  loggedByEmail: string;
  restoredBy?: string;
  status: 'ONGOING' | 'RESTORED';
  createdAt: string;
  updatedAt: string;
  upd: number;
  sy?: number;
}

export interface GeneratorLog {
  id: string;
  date: string; // YYYY-MM-DD
  shift: 'Day' | 'Night';
  startTime: string; // YYYY-MM-DDTHH:mm
  startFuelLitres: number;
  stopTime: string; // YYYY-MM-DDTHH:mm or '' if still RUNNING
  stopFuelLitres?: number;
  fuelUsedLitres?: number;
  durationMinutes: number;
  linkedPowerCutId?: string;
  linkedDowntimeEntryId?: string;
  reason?: string;
  operatorName: string;
  stoppedByName?: string;
  signature?: string;
  stopSignature?: string;
  notes?: string;
  loggedByEmail: string;
  status: 'RUNNING' | 'STOPPED';
  createdAt: string;
  updatedAt: string;
  upd: number;
  sy?: number;
}

// ======================================================
// SPECIAL ORDERS (GUM BOOTS SIZES 39-46 & CUSTOM ORDERS)
// FACTORY STOCK -> READY DISPATCH TO WH -> REGULAR DISPATCH
// ======================================================

export const GUM_BOOT_SIZES = [
  'Size 39',
  'Size 40',
  'Size 41',
  'Size 42',
  'Size 43',
  'Size 44',
  'Size 45',
  'Size 46',
] as const;

export interface SpecialOrder {
  id: string;
  orderNo: string;
  title: string;
  customerName?: string;
  productPrefix: string; // e.g. 'GUM BOOT CAPTAIN BLACK'
  machine: string; // e.g. 'Gumboot Machine'
  sizes: string[]; // e.g. ['Size 39', ..., 'Size 46']
  sizeTargets?: Record<string, number>;
  unitWeightKgBySize?: Record<string, number>;
  status: 'ACTIVE' | 'READY_FOR_WH' | 'COMPLETED';
  notes?: string;
  createdBy: string;
  createdAt: string;
  upd: number;
  sy?: number;
}

export interface SpecialOrderSizeItem {
  sizeLabel: string;
  productName: string;
  qty: number;
  unitWeightKg?: number;
  totalWeightKg?: number;
}

export interface SpecialOrderFactoryProduction {
  id: string;
  batchNo: string;
  orderId: string;
  orderNo: string;
  orderTitle: string;
  date: string; // YYYY-MM-DD
  shift: 'Day' | 'Night';
  machine: string;
  rackOrTrolleyNo: string;
  items: SpecialOrderSizeItem[];
  totalQty: number;
  totalWeightKg: number;
  operatorName: string;
  assistantName: string;
  isCasualAssistant?: boolean;
  casualAssistantName?: string;

  // Stage 1: Shift In Charge Daily Factory Recording
  shiftInChargeName: string;
  shiftInChargeSignature: string;
  shiftNotes?: string;
  shiftSubmittedAt: string;
  shiftSubmittedByEmail: string;

  // Stage 2: Production HOD Factory Stock Confirmation
  hodConfirmedByName?: string;
  hodConfirmedByEmail?: string;
  hodSignature?: string;
  hodNotes?: string;
  hodConfirmedAt?: string;

  status: 'PENDING_HOD_FACTORY' | 'CONFIRMED_IN_FACTORY';
  upd: number;
  sy?: number;
}

export interface SpecialOrderWhDispatch {
  id: string;
  dispatchRef: string;
  orderId: string;
  orderNo: string;
  orderTitle: string;
  date: string; // YYYY-MM-DD
  shift: 'Day' | 'Night';
  machine: string;
  trolleyNo: string;

  // Stage 1: Shift In Charge Ready-Order Dispatch to WH
  items: SpecialOrderSizeItem[];
  totalRecordedQty: number;
  totalRecordedWeightKg: number;
  operatorName: string;
  assistantName: string;
  isCasualAssistant?: boolean;
  casualAssistantName?: string;
  shiftInChargeName: string;
  shiftInChargeSignature: string;
  shiftNotes?: string;
  shiftSubmittedAt: string;
  shiftSubmittedByEmail: string;

  // Stage 2: WH Personnel Verification & Qty Confirmation
  whReceivedItems?: SpecialOrderSizeItem[];
  totalWhReceivedQty?: number;
  totalWhWeightKg?: number;
  whPersonnelName?: string;
  whSignature?: string;
  whNotes?: string;
  whQtyEditReason?: string;
  whConfirmedAt?: string;
  whConfirmedByEmail?: string;

  // Stage 3: Production HOD Final Confirmation -> Syncs to Regular Dispatch Ledger & Excel
  hodConfirmedByName?: string;
  hodConfirmedByEmail?: string;
  hodSignature?: string;
  hodNotes?: string;
  hodConfirmedAt?: string;

  linkedRegularDispatchIds?: string[];
  syncedToRegularDispatchAt?: string;
  status: DispatchStatus;
  upd: number;
  sy?: number;
}

// ======================================================
// QUALITY TRIAL REPORTS (ISO / QMS / ASTM / SAZ STANDARDS)
// ======================================================

export type QualityTrialCategory =
  | 'Additive / Formula Change'
  | 'Scrap / Regrind Ratio'
  | 'New Raw Material / Supplier'
  | 'Masterbatch / Colourant'
  | 'Process / Tooling Optimization'
  | 'New Product Qualification';

export interface QualityTrialFormulationRow {
  ingredientName: string;
  role:
    | 'Base Resin'
    | 'Recycled Scrap'
    | 'Additive'
    | 'Stabilizer'
    | 'Filler / CaCO3'
    | 'Pigment / Masterbatch'
    | 'Other';
  ratioOrPhr: string;
  batchQtyKg?: string;
  supplierOrLot?: string;
}

export interface QualityStandardTestItem {
  id: string;
  testName: string;
  standardRef: string; // ISO / SAZ / ASTM / QMS clause
  method: string;
  unit: string;
  specRequirement: string;
  actualResult: string;
  verdict: 'PASS' | 'FAIL' | '';
  remarks?: string;
}

export type QualityTrialVerdict =
  | 'APPROVED_FOR_PRODUCTION'
  | 'CONDITIONAL_RELEASE'
  | 'REJECTED_HOLD'
  | '';

export interface QualityTrialReport {
  id: string;
  trialNo: string;
  qmsDocCode: string; // e.g. 'QMS-LG-TRL-04'
  date: string; // YYYY-MM-DD
  shift: 'Day' | 'Night';
  product: string;
  productFamily: string;
  machine: string;
  trialCategory: QualityTrialCategory;
  applicableStandards: string[];
  objectiveSummary: string;
  scrapRatioPct?: string;
  additiveDetails?: string;
  newMaterialSource?: string;
  machineTempProfile?: string;
  extrusionOrCycleRate?: string;
  formulationRows: QualityTrialFormulationRow[];
  qcTests: QualityStandardTestItem[];
  overallVerdict: QualityTrialVerdict;
  recommendations: string;
  conductedByName: string;
  conductedByEmail: string;
  conductorSignature: string;
  conductedAt: string;
  reviewedByHodName?: string;
  hodSignature?: string;
  hodReviewedAt?: string;
  trialApprovals?: {
    factoryManager?: { name?: string; signature?: string; signedAt?: string };
    productionHod?: { name?: string; signature?: string; signedAt?: string };
    technicalHead?: { name?: string; signature?: string; signedAt?: string };
    departmentHead?: { name?: string; signature?: string; signedAt?: string };
    qc?: { name?: string; signature?: string; signedAt?: string };
    electricalHead?: { name?: string; signature?: string; signedAt?: string };
    operator?: { name?: string; signature?: string; signedAt?: string };
  };
  status: 'DRAFT' | 'COMPLETED';
  upd: number;
  sy?: number;
}


