export interface AttendancePerson {
  section: string;
  name: string;
  id: string;
  type: 'Employee' | 'Casual';
  status: 'Present' | 'Absent';
  count: number;
  remark?: string;
  designation?: string;
  review?: boolean;
  cands?: { name: string; id: string; desig: string; casual: boolean }[] | null;
}

export interface ParsedAttendanceMessage {
  id?: string;
  date: string; // YYYY-MM-DD
  shift: 'Day' | 'Night' | 'Unknown';
  reportedBy: string;
  loggedBy?: string;
  loggedByEmail?: string;
  rows: AttendancePerson[];
  skipped: { line: string; why: string }[];
  claimed?: { present: number | null; absent: number | null };
  msgs?: number;
  rawText?: string;
  createdAt?: number;
  isHistorical?: boolean;
}

export interface QCInspectionRecord {
  id: string;
  date: string; // YYYY-MM-DD
  shift: 'Day' | 'Night' | 'Unknown';
  machineOrLine: string;
  product: string;
  samplesTested: number;
  passedCount: number;
  defectsCount: number;
  defectReason: string;
  status: 'Passed' | 'Rejected' | 'Hold';
  inspector: string;
  notes?: string;
  createdAt?: number;
  synced?: boolean; // True if uploaded to Firebase, false if waiting in local queue
  loggedBy?: string; // Display name of logged-in user
  loggedByEmail?: string; // Email of user who logged the record
}

export type ActiveAppModule = 'dashboard' | 'downtime' | 'attendance' | 'qc';

