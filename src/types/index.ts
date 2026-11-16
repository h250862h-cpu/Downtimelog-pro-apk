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
  const norm = m.toLowerCase();
  if (EXTRUSION_MACHINES.some((x) => x.toLowerCase() === norm)) return 'Extrusion';
  if (INJECTION_MACHINES.some((x) => x.toLowerCase() === norm)) return 'Injection';
  if (MIXER_MACHINES.some((x) => x.toLowerCase() === norm)) return 'Mixer';
  if (RECYCLING_MACHINES.some((x) => x.toLowerCase() === norm)) return 'Recycling';
  if (UTILITY_MACHINES.some((x) => x.toLowerCase() === norm)) return 'Utility';
  return 'Extrusion';
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
  genStartFuel?: number; // %
  genOffTime?: string; // e.g. "12:00"
  genOffFuel?: number; // %

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
  | 'Maintenance Technician'
  | 'QC Inspector'
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
};

export function getDefaultPermissionsForRole(role: PlantRole): UserPermissions {
  switch (role) {
    case 'Plant Administrator':
    case 'Production HOD':
      return { ...FULL_ADMIN_PERMISSIONS };
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
      };
    case 'Machine Operator':
    case 'Maintenance Technician':
    case 'QC Inspector':
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
  operatorName: string;
  assistantName: string;
  isCasualAssistant?: boolean;
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
}
