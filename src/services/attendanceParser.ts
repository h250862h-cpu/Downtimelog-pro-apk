import * as XLSX from 'xlsx';
import { AttendancePerson, ParsedAttendanceMessage } from '../types/attendance';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const pad = (n: number) => String(n).padStart(2, '0');

export function fmtDate(iso: string) {
  if (!iso || !iso.includes('-')) return iso || '';
  const [y, m, d] = iso.split('-').map(Number);
  return pad(d) + '-' + MONTHS[m - 1] + '-' + y;
}

export function todayISO() {
  const t = new Date();
  return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
}

export function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s.'\-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}

export function detectShift(text: string): 'Day' | 'Night' | 'Unknown' {
  const t = text.toLowerCase();
  if (/\bnight\b/.test(t)) return 'Night';
  if (/\b(morning|evening|day|afternoon)\b/.test(t)) return 'Day';
  return 'Unknown';
}

export function extractDate(text: string): string | null {
  const m =
    text.match(/\((\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\)/) ||
    text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return null;
  let d = +m[1];
  let mo = +m[2];
  let y = +m[3];
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return y + '-' + pad(mo) + '-' + pad(d);
}

export function extractReportedBy(text: string): string {
  const m = text.match(/^\s*[*_]*(?:reported\s+by|from)[*_]*\s*[:\-]?\s*([^\n\r]+)/im);
  if (!m) return '';
  return titleCase(
    m[1]
      .replace(/[*_~`]/g, '')
      .replace(/[^\p{L}.' ]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

const DEPT_W =
  'extrusion|extruders?|injection|mixing|mixers?|stores?|cleaning|cleaners?|assembl\\w*|gumboots?|punching|recycling|dispatch|maintenance|mtce|security|kitchen|polypipe|production|electrical|moulding|molding|packing|warehouse|factory|plant|workshop|office|canteen';
const META_W =
  'total|totals|attendance|labou?r|dayshift|nightshift|day|night|shift|morning|evening|afternoon|line|lines|section|department|dept|headcount|staff|employees?|workers|summary|report|sheet|list|manpower|grand|overall|operators?|assistants?|general|others?|unassigned';

const DEPT_TOK = new RegExp('^(?:' + DEPT_W + ')$', 'i');
const VOC_TOK = new RegExp(
  '^(?:' + DEPT_W + '|' + META_W + '|absent|abs|present|casuals?|and|of|the|for|&)$',
  'i'
);

const NOT_NAME = (t: string) => {
  const k = String(t)
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return (
    k.length > 0 &&
    k.every((w) => VOC_TOK.test(w)) &&
    k.some((w) => !/^(absent|abs|present|casuals?|and|of|the|for)$/i.test(w))
  );
};

const ABS_RE = /\b(absent|absentees?|abs|awol|no[\s-]?show)\b/i;
const CAS_RE = /\bcasuals?\b/i;
const ABS_MARK = /[\u274C\u2717\u2718]/u;

/* Staff Roster Cross-Reference */
export const ROSTER_RAW: [number | null, string, string, string][] = [
  [13, 'Kefas', 'Cleaner', 'staff'],
  [4, 'BOTHWELL MATIBHIRI', 'recycling', 'staff'],
  [14, 'KUDAKWASHE JEMWA', 'recycling', 'staff'],
  [1, 'ALLAN MHARANDU', 'Dispatch clerk', 'staff'],
  [52, 'BRIGHTON MUDAMBURI', 'electrician', 'staff'],
  [43, 'TRIED CHAKUBVA', 'extruder assistant', 'staff'],
  [50, 'FARAI MURONZWA', 'extruder operator', 'staff'],
  [19, 'MUNYARADZI MUHOMBA', 'extruder assistant', 'staff'],
  [20, 'NGONI MUTENA', 'extruder assistant', 'staff'],
  [12, 'JONATHAN CHIDINDI', 'extruder assistant', 'staff'],
  [11, 'JAMES MUSHAWATU', 'dispatch', 'staff'],
  [33, 'TAKUNDA KANHICHIRE', 'extruder operator', 'staff'],
  [40, 'TINASHE MAGWANISA', 'extruder operator', 'staff'],
  [45, 'VITALIS DENHERE', 'extruder operator', 'staff'],
  [53, 'FIDELIS CHUMA', 'mold setter', 'staff'],
  [57, 'DENNIS MUZANENHAMO', 'extruder operator', 'staff'],
  [47, 'WALTER MASIMBITI', 'extruder assistant', 'staff'],
  [24, 'OWEN GAMBO', 'injection assistant', 'staff'],
  [3, 'BLESSING MUTENA', 'dispatch', 'staff'],
  [37, 'THINKWELL MARUMANI', 'injection assistant', 'staff'],
  [26, 'REMOS TSIGA', 'injection assistant', 'staff'],
  [46, 'LIBERTY', 'dispatch', 'staff'],
  [34, 'TAKUNDA MAGAUZE', 'injection assistant', 'staff'],
  [6, 'ERIC NYAMAPANDA', 'shift in charge/ injection operator', 'staff'],
  [28, 'SIMON TARUBINGA', 'injection operator', 'staff'],
  [16, 'MARENZI LEORNARD', 'injection supervisor', 'staff'],
  [55, 'MASIMBA MUKUKU', 'maintenance', 'staff'],
  [17, 'MOREBLESSING MUTAURWA', 'maintenance', 'staff'],
  [60, 'Tinomutenda', 'maintenance', 'staff'],
  [38, 'TCHAONA MAKADHO', 'mixer operator', 'staff'],
  [31, 'TAFARA SHAVAYEMOMBE', 'WH Auto Mixer', 'staff'],
  [5, 'COLLEN CHAMANGA', 'Dispatch clerk', 'staff'],
  [8, 'FREEDOM. C. MAPFUMO', 'dispatch', 'staff'],
  [9, 'GARIKAI MADUBEKO', 'dispatch', 'staff'],
  [30, 'TADIWA MHINDURWA', 'dispatch', 'staff'],
  [35, 'TAWANDA WHITE', 'WH Auto Mixer', 'staff'],
  [2, 'BIGGIE MANGWENDE', 'mixing', 'staff'],
  [18, 'MUFARO SIYAMI', 'dispatch', 'staff'],
  [23, 'esmore urombo', 'gumboot machine operator', 'staff'],
  [36, 'TENDAI DZUNA', 'mixing', 'staff'],
  [25, 'VICTOR CHIPUNZA', 'plumber', 'staff'],
  [29, 'STANFORD TAKUDZWA', 'dispatch', 'staff'],
  [39, 'TINASHE CHIHOTA', 'Dispatch clerk', 'staff'],
  [49, 'MALVERN NZOMBE', 'injection assistant', 'staff'],
  [61, 'WITNESS GOVA', 'mixing', 'staff'],
  [67, 'PEDZISAI MARUFU', 'mixing', 'staff'],
  [74, 'CALUM DHIMINGWI', 'dispatch', 'staff'],
  [68, 'FRANK MUTSATSATI', 'extruder assistant', 'staff'],
  [95, 'Courage Chinzou', 'dispatch', 'staff'],
  [72, 'TAVONGA MUPWANYIWA', 'dispatch', 'staff'],
  [56, 'SIMBARASHE CHAUNOITA', 'production clerk', 'staff'],
  [59, 'Mapfumo', 'Security', 'staff'],
  [62, 'BATANAI MUSIIWA', 'dispatch', 'staff'],
  [63, 'CARLOS TAFRIREI', 'dispatch', 'staff'],
  [64, 'JENKINS MANVINEMA', 'injection assistant', 'staff'],
  [10, 'INNOCENT MAVHIYANI', 'shift in charge', 'staff'],
  [27, 'RONWELL', 'dispatch', 'staff'],
  [44, 'TRUST GWEME', 'shift in charge', 'staff'],
  [32, 'TAKUDZWA ZIMANI', 'Stores', 'staff'],
  [58, 'NEVER SHARA', 'supervisor', 'staff'],
  [65, 'CLIVE SHOKO', 'injection assistant', 'staff'],
  [76, 'PASSMORE', 'mixing', 'staff'],
  [77, 'SHAWN NYANINGWE', 'extruder assistant', 'staff'],
  [78, 'TREVOR MAZANHI', 'extruder assistant', 'staff'],
  [7, 'TAFADZWA CHIRENGWA', 'extruder assistant', 'staff'],
  [79, 'LENOX MUHLABA', 'extruder assistant', 'staff'],
  [80, 'PATSON MUSEKIWA', 'extruder assistant', 'staff'],
  [81, 'HAWARD', 'injection assistant', 'staff'],
  [82, 'TINOTENDA SAMUKANGE', 'maintenance', 'staff'],
  [83, 'EZIAS', 'gumboot machine operator', 'staff'],
  [84, 'GRAMMY NDODA', 'recycling', 'staff'],
  [85, 'PEARSON', 'mixing', 'staff'],
  [94, 'Joseph Sakunyepa', 'dispatch', 'staff'],
  [88, 'BOTHWELL MARENZI', 'injection operator', 'staff'],
  [87, 'BLESSED', 'polypipe operator', 'staff'],
  [89, 'FELIX SITHOLE', 'injection assistant', 'staff'],
  [91, 'SHELTON', 'dispatch', 'staff'],
  [92, 'Bernard Mafunhiya', 'dispatch', 'staff'],
  [96, 'TINASHE BVUNGO', 'gumboot machine assistant', 'staff'],
  [97, 'Given Wilson', 'gumboot machine assistant', 'staff'],
  [93, 'Farasteny Tozvireva', 'extruder assistant', 'staff'],
  [98, 'PASSION', 'mixing', 'staff'],
  [73, 'Isa', 'Cook', 'staff'],
  [null, 'Zvikomborero Vira', 'assemblings', 'casual'],
  [null, 'ALLAN MAPURISA', 'punching', 'casual'],
  [null, 'CLIVE SHOKO', 'assemblings', 'casual'],
  [null, 'Cristiane Jackson', 'assemblings', 'casual'],
  [null, 'Calum Dzingai', 'assemblings', 'casual'],
  [null, 'Given Wilson', 'assemblings / gumboot machine', 'casual'],
  [null, 'JONAH', 'punching', 'casual'],
  [null, 'ALBERT TAFIRENYIKA', 'recycling', 'casual'],
  [null, 'Allan Zisengwe', 'gumboot', 'casual'],
  [null, 'Ernest Muzanari', 'extrusion', 'casual'],
  [null, 'JOSEPH SAKUNYARA', 'recycling', 'casual'],
  [null, 'Elton Kutumba', 'punching', 'casual'],
  [null, 'Mathew Chiuto', 'gumboot', 'casual'],
  [null, 'Michael Dziganu', 'gumboot', 'casual'],
  [null, 'MPUMELELO MSILA', 'gumboot', 'casual'],
  [null, 'Perseverence Mutawu', 'gumboot', 'casual'],
  [null, 'Prosper Musangua', 'extrusion', 'casual'],
  [null, 'RAMECK MASUKA', 'recycling', 'casual'],
  [null, 'Tanaka Chinerumba', 'extrusion', 'casual'],
  [null, 'Tanaka Mawodzeka', 'recycling', 'casual'],
  [null, 'TINASHE BVUNGO', 'gumboot', 'casual'],
  [null, 'Tafadzwa Nyatawa', 'punching', 'casual'],
];

export function normName(s: string) {
  return String(s || '')
    .replace(/[.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function deptOfDesig(d: string) {
  d = String(d || '').toLowerCase();
  if (/inject/.test(d)) return 'injection';
  if (/extru|polypipe/.test(d)) return 'extrusion';
  if (/recycl/.test(d)) return 'recycling';
  if (/mix/.test(d)) return 'mixing';
  if (/gumboot|assembl|punch/.test(d)) return 'gumboot';
  if (/dispatch/.test(d)) return 'dispatch';
  if (/mainten|electric|plumb|mold|mould/.test(d)) return 'maintenance';
  if (/store/.test(d)) return 'stores';
  if (/clean/.test(d)) return 'cleaner';
  if (/shift in charge|supervisor|production clerk/.test(d)) return 'any';
  if (/secur/.test(d)) return 'security';
  if (/cook/.test(d)) return 'kitchen';
  return '';
}

export function deptOfSection(s: string) {
  s = String(s || '').toLowerCase();
  if (/inject/.test(s)) return 'injection';
  if (/extru|line/.test(s)) return 'extrusion';
  if (/recycl/.test(s)) return 'recycling';
  if (/mixing|mixer/.test(s)) return 'mixing';
  if (/gumboot|assembl|punch/.test(s)) return 'gumboot';
  if (/dispatch/.test(s)) return 'dispatch';
  if (/mtce|mainten|electric/.test(s)) return 'maintenance';
  if (/store/.test(s)) return 'stores';
  if (/clean/.test(s)) return 'cleaner';
  if (/secur/.test(s)) return 'security';
  if (/kitchen|cook/.test(s)) return 'kitchen';
  return '';
}

export interface RosterPerson {
  id: string;
  name: string;
  desig: string;
  casual: boolean;
  dept: string;
  toks: string[];
}

export const ROSTER: RosterPerson[] = (() => {
  const m = new Map<string, RosterPerson>();
  ROSTER_RAW.forEach((r) => {
    const name = titleCase(normName(r[1]));
    const key = name.toUpperCase();
    const o: RosterPerson = {
      id: r[0] == null ? '' : String(r[0]),
      name,
      desig: titleCase(r[2] || ''),
      casual: r[3] === 'casual',
      dept: deptOfDesig(r[2]),
      toks: key.split(' ').filter((t) => t.length >= 2),
    };
    if (m.has(key)) {
      if (m.get(key)!.casual && !o.casual) m.set(key, o);
    } else {
      m.set(key, o);
    }
  });
  return [...m.values()];
})();

export function lev(a: string, b: string): number {
  const m = a.length,
    n = b.length,
    d: number[][] = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

const allow = (l: number) => (l >= 8 ? 2 : l >= 5 ? 1 : 0);

export function nameToks(name: string) {
  return String(name)
    .toUpperCase()
    .replace(/[^A-Z' ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

export function findCands(name: string): RosterPerson[] {
  const tk = nameToks(name);
  if (!tk.length) return [];
  const ex = ROSTER.filter((p) => tk.every((t) => p.toks.includes(t)));
  if (ex.length) return ex;
  return ROSTER.filter((p) =>
    tk.every((t) => p.toks.some((x) => x === t || (x[0] === t[0] && lev(t, x) <= allow(t.length))))
  );
}

export function similar(name: string, p: RosterPerson): boolean {
  const tk = nameToks(name);
  return tk.some((t) => t.length >= 4 && p.toks.some((x) => x[0] === t[0] && lev(t, x) <= 3));
}

export function applyPerson(
  r: AttendancePerson,
  p: { id: string; name: string; desig: string; casual: boolean },
  notes: string[],
  numGiven: string
) {
  if (!numGiven && !r.id && p.id) notes.push('ID added from staff list');
  else if (numGiven && p.id && numGiven !== p.id) notes.push('ID corrected (was ' + r.id + ')');
  const wasCasualTag = r.type === 'Casual';
  r.name = p.name;
  r.id = p.id || r.id || '';
  r.designation = p.desig;
  r.type = p.casual ? 'Casual' : 'Employee';
  if (wasCasualTag && !p.casual) notes.push('Now on staff list');
}

export function resolveRow(r: AttendancePerson) {
  r.designation = '';
  if (/headcount/i.test(r.name)) return;
  const sd = deptOfSection(r.section);
  const given = String(r.id || '').replace(/^0+(?=\d)/, '');
  const numGiven = /^\d+$/.test(given) ? given : '';
  const notes: string[] = [];
  if (r.remark) notes.push(r.remark);

  const compat = (p: RosterPerson) => !sd || p.casual || !p.dept || p.dept === 'any' || p.dept === sd;
  let pool = findCands(r.name);
  const allCands = pool;
  if (pool.length > 1) {
    const f = pool.filter(compat);
    if (f.length) pool = f;
  }
  if (pool.length > 1 && sd) {
    const s1 = pool.filter((p) => p.dept === sd);
    if (s1.length) pool = s1;
  }
  let pick: RosterPerson | null = null;
  let amb: RosterPerson[] | null = null;
  if (pool.length > 1) {
    const byId = numGiven ? pool.filter((p) => p.id === numGiven) : [];
    if (byId.length === 1) pick = byId[0];
    else amb = pool;
  } else if (pool.length === 1) {
    pick = pool[0];
  }
  let hint: RosterPerson | null = null;
  if (
    pick &&
    numGiven &&
    pick.id &&
    pick.id !== numGiven &&
    !ROSTER.some((p) => p.id === numGiven) &&
    nameToks(r.name).length < 2 &&
    pick.toks.length > 1
  ) {
    hint = pick;
    pick = null;
  }
  if (pick && !compat(pick)) {
    if (numGiven && pick.id && pick.id !== numGiven) {
      notes.push('Not in staff list (first name matches ' + pick.name + ') - kept as given');
      pick = null;
    } else {
      notes.push('Department differs from staff list - check');
    }
  }
  if (!pick && !amb) {
    const byId = numGiven ? ROSTER.find((p) => p.id === numGiven) : null;
    if (byId && compat(byId) && similar(r.name, byId)) {
      pick = byId;
      notes.push('Spelling matched using ID');
    }
  }
  r.review = false;
  if (pick && allCands.length > 1 && numGiven) {
    const other = allCands.find((p) => p.id === numGiven && p !== pick);
    if (other) {
      notes.push('ID ' + numGiven + ' belongs to ' + other.name + ' (' + other.desig + ') - check');
      r.review = true;
    }
  }
  if (pick) {
    applyPerson(r, pick, notes, numGiven);
  } else if (amb) {
    r.name = titleCase(normName(r.name));
    r.cands = amb.map((p) => ({ name: p.name, id: p.id, desig: p.desig, casual: p.casual }));
    notes.push('Several staff match - choose the right one');
    r.review = true;
  } else {
    r.name = titleCase(normName(r.name));
    const owner = numGiven ? ROSTER.find((p) => p.id === numGiven) : null;
    notes.push(
      owner
        ? 'Not in staff list - ID ' + numGiven + ' is listed for ' + owner.name + ', kept as given'
        : 'Not in staff list - kept as given'
    );
    if (hint) {
      notes.pop();
      notes.push(
        'ID ' +
          numGiven +
          ' is not on the staff list (resigned ID re-used?) - kept as given. Choose ' +
          hint.name +
          ' if that is who it is'
      );
      r.cands = [{ name: hint.name, id: hint.id, desig: hint.desig, casual: hint.casual }];
    }
    r.review = true;
  }
  r.remark = notes.join('; ');
}

export function choosePerson(r: AttendancePerson, idx: number) {
  if (idx < 0 || !r.cands || !r.cands[idx]) return;
  const p = r.cands[idx];
  const notes: string[] = [];
  applyPerson(
    r,
    { id: p.id, name: p.name, desig: p.desig, casual: p.casual },
    notes,
    /^\d+$/.test(String(r.id)) ? String(r.id).replace(/^0+(?=\d)/, '') : ''
  );
  r.cands = null;
  r.review = false;
  r.remark = notes.join('; ');
}

export function parseMessage(text: string, ov?: { date?: string; shift?: 'Day' | 'Night' | 'Unknown' }): ParsedAttendanceMessage {
  ov = ov || {};
  const shift = ov.shift || detectShift(text);
  const date = ov.date || extractDate(text) || todayISO();
  const reportedBy = extractReportedBy(text);
  const rows: AttendancePerson[] = [];
  const skipped: { line: string; why: string }[] = [];
  const ctx = { section: 'General', absent: false, casual: false };
  let blockStart = true;
  const lines = text.replace(/\r/g, '').split('\n');
  const hasBlank = /\n\s*\n/.test(text);
  const nextHasId = (k: number) => {
    for (let j = k + 1; j < lines.length; j++) {
      if (lines[j].trim()) return /\d/.test(lines[j]);
    }
    return false;
  };

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    if (!raw.trim()) {
      blockStart = true;
      continue;
    }
    let line = raw
      .replace(/[*_~`]/g, '')
      .replace(/^\s*(?:[-\u2022\u25CF>]+|\d{1,3}[.)])\s+/u, '')
      .trim();
    const wasStart = blockStart;
    blockStart = false;
    if (!line) continue;
    const mark = ABS_MARK.test(line);
    line = line.replace(/[\u274C\u2717\u2718\u2705\u2714\uFE0F]/gu, '').trim();

    // Meta lines
    if (/^(from|reported\s+by)\b/i.test(line)) continue;
    if (
      /\b(attendance|good\s+(morning|evening|afternoon|night)|shift\s+(report|attendance))\b/i.test(line) &&
      !/\d{2,}\s*$/.test(line)
    )
      continue;
    if (/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/.test(line)) continue;
    if (/^total\b/i.test(line) && !CAS_RE.test(line)) continue;

    if (NOT_NAME(line)) {
      if (!/\d/.test(line)) {
        const dw = line
          .toLowerCase()
          .replace(/[^\p{L}\s]/gu, ' ')
          .split(/\s+/)
          .filter((w) => DEPT_TOK.test(w));
        if (dw.length) {
          ctx.absent = ABS_RE.test(line);
          ctx.casual = CAS_RE.test(line);
          ctx.section = titleCase(dw.join(' '));
        }
      }
      continue;
    }

    const hasDigit = /\d/.test(line);
    const upper = line === line.toUpperCase() && /\p{L}/u.test(line);
    const colon = /:\s*$/.test(line);
    const kwOnly =
      /^(casuals?|absent(ees)?|present)\b[\w\s&\/-]*$/i.test(line) &&
      !hasDigit &&
      line.split(/\s+/).length <= 4;
    const inMode = ctx.casual || ctx.absent;

    if (
      !hasDigit &&
      line.length <= 45 &&
      !(CAS_RE.test(line) && !kwOnly && !colon) &&
      (colon || kwOnly || (upper && (wasStart || (!hasBlank && !inMode && nextHasId(li)))))
    ) {
      const head = line.replace(/:\s*$/, '').trim();
      ctx.absent = ABS_RE.test(head);
      ctx.casual = CAS_RE.test(head);
      let sec = head
        .replace(ABS_RE, '')
        .replace(CAS_RE, '')
        .replace(/\bpresent\b/i, '')
        .replace(/[\s&\/-]+$/, '')
        .trim();
      if (/^(casuals?)/i.test(head) && !sec) sec = 'Casuals';
      if (sec) ctx.section = titleCase(sec);
      else if (!ctx.casual) ctx.section = 'Unassigned';
      continue;
    }

    // Person line
    const absent = ctx.absent || ABS_RE.test(line) || mark;
    const casual = ctx.casual || CAS_RE.test(line) || /\(c\)\s*$/i.test(line);
    let s = line
      .replace(ABS_RE, ' ')
      .replace(CAS_RE, ' ')
      .replace(/\bpresent\b/gi, ' ')
      .replace(/\(c\)/gi, ' ');
    let remark = '';
    let pid = '';
    s = s.replace(/\(([^)]*)\)/g, (_, a) => {
      a = a.trim();
      if (/^[A-Za-z]{0,3}\d+$/.test(a) && !pid) pid = a.toUpperCase();
      else remark = a;
      return ' ';
    });
    s = s.replace(/\s+/g, ' ').replace(/^[\s:,\-=#]+|[\s:,\-=#]+$/g, '');

    // Headcount only line, e.g. "Casuals 5"
    const cm = s.match(/^(?:total\s*)?(\d{1,3})$/i);
    if (cm && casual) {
      rows.push({
        section: ctx.section === 'General' || ctx.section === 'Unassigned' ? 'Casuals' : ctx.section,
        name: 'Casuals (headcount)',
        id: '',
        type: 'Casual',
        status: absent ? 'Absent' : 'Present',
        count: +cm[1],
        remark,
      });
      continue;
    }

    const lead = s.match(/^(?:id\s*[:#-]?\s*)?(\d+)\s*[-:.,)]*\s+(\p{L}[\p{L}.'\- ]*)$/iu);
    const m = lead ? ['', lead[2], lead[1]] : s.match(/^(\p{L}[\p{L}.'\- ]*?)\s*[-:,#]?\s*([A-Za-z]{0,3}\d+)?$/u);
    if (!m || !m[1] || m[1].trim().length < 2) {
      skipped.push({ line: raw.trim(), why: 'not a name/ID line' });
      continue;
    }
    if (NOT_NAME(m[1])) continue;

    const name = titleCase(m[1].trim().replace(/\s+/g, ' '));
    const id = (m[2] || pid || '').toUpperCase();
    const rk = remark;
    if (!id && !casual && !absent) {
      if (
        name.split(' ').length > 4 ||
        /\b(thank|thanks|regards|noted|okay|please|kindly|manpower|nil)\b/i.test(name)
      ) {
        skipped.push({ line: raw.trim(), why: 'no ID' });
        continue;
      }
    }
    rows.push({
      section: ctx.section,
      name,
      id,
      type: casual ? 'Casual' : 'Employee',
      status: absent ? 'Absent' : 'Present',
      count: 1,
      remark: rk,
    });
  }

  rows.forEach(resolveRow);

  const num = (v: string | undefined) => (v === undefined ? null : /nil|none/i.test(v) ? 0 : +v);
  const cp = text.match(/total[^\n=:]*?present\s*[=:\-]?\s*(\d+|nil|none)/i);
  const ca = text.match(/total[^\n=:]*?absent\s*[=:\-]?\s*(\d+|nil|none)/i);
  const claimed = { present: cp ? num(cp[1]) : null, absent: ca ? num(ca[1]) : null };

  return { date, shift, reportedBy, rows, skipped, claimed, rawText: text };
}

export function splitMessages(text: string): string[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let c: string[] = [];
  let body = false;
  const hdr = (l: string) =>
    /\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/.test(l) || /\b(attendance|shift\s+report)\b/i.test(l);
  for (const l of lines) {
    const t = l.trim();
    if (t && hdr(t) && body) {
      out.push(c.join('\n'));
      c = [];
      body = false;
    }
    c.push(l);
    if (t && !hdr(t) && !/^(from|reported\s+by)\b/i.test(t.replace(/[*_]/g, ''))) body = true;
  }
  out.push(c.join('\n'));
  return out.filter((x) => x.trim());
}

export function mergeMsg(ex: ParsedAttendanceMessage, inc: ParsedAttendanceMessage) {
  const st = { added: 0, updated: 0, dup: 0 };
  const key = (r: AttendancePerson) =>
    /headcount/i.test(r.name) ? 'H|' + r.section + '|' + r.type + '|' + r.status : 'N|' + r.name.toUpperCase();
  inc.rows.forEach((r) => {
    const k = key(r);
    const i = ex.rows.findIndex((x) => key(x) === k);
    if (i < 0) {
      ex.rows.push({ ...r });
      st.added++;
    } else {
      const o = ex.rows[i];
      if (o.status === r.status && o.count === r.count) {
        st.dup++;
      } else {
        ex.rows[i] = {
          ...r,
          id: r.id || o.id,
          remark: [r.remark, 'Updated by later message (was ' + o.status + ')'].filter(Boolean).join('; '),
        };
        st.updated++;
      }
    }
  });
  ex.reportedBy = [...new Set([ex.reportedBy, inc.reportedBy].filter(Boolean))].join(', ');
  if (ex.shift === 'Unknown') ex.shift = inc.shift;
  ex.msgs = (ex.msgs || 1) + 1;
  return st;
}

export function shiftOrder(s: string) {
  return s === 'Day' ? 0 : s === 'Night' ? 1 : 2;
}

export function counts(rows: AttendancePerson[]) {
  const t = { ep: 0, ea: 0, cp: 0, ca: 0 };
  rows.forEach((r) => {
    const k = (r.type === 'Casual' ? 'c' : 'e') + (r.status === 'Absent' ? 'a' : 'p');
    t[k as keyof typeof t] += r.count;
  });
  return t;
}

export function batchTotals(batch: ParsedAttendanceMessage[]) {
  const t = { ep: 0, ea: 0, cp: 0, ca: 0 };
  batch.forEach((b) =>
    b.rows.forEach((r) => {
      const k = (r.type === 'Casual' ? 'c' : 'e') + (r.status === 'Absent' ? 'a' : 'p');
      t[k as keyof typeof t] += r.count;
    })
  );
  return t;
}

/**
 * Generates formatted multi-sheet Excel Workbook with date filtering!
 * Sheets:
 * 1. Attendance (All records with Absent rows highlighted)
 * 2. Summary (Totals of present, absent, casuals, and by date & shift)
 * 3. Absent (Absentees only)
 * 4. Casuals (Casual workers)
 * 5. By Person (Attendance % per individual worker)
 */
export function generateAttendanceExcelWorkbook(
  batch: ParsedAttendanceMessage[],
  filterFromDate?: string,
  filterToDate?: string,
  shiftFilter: 'All' | 'Day' | 'Night' = 'All'
) {
  // Apply date range and shift filter, sorted chronologically
  const filteredBatch = batch
    .filter((b) => {
      if (filterFromDate && b.date < filterFromDate) return false;
      if (filterToDate && b.date > filterToDate) return false;
      if (shiftFilter !== 'All' && b.shift !== shiftFilter) return false;
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || shiftOrder(a.shift) - shiftOrder(b.shift));

  const wb = XLSX.utils.book_new();

  // 1. Flatten records
  const recs: {
    date: string;
    shift: string;
    section: string;
    name: string;
    id: string;
    type: string;
    status: string;
    count: number;
    by: string;
    remark: string;
    desig: string;
  }[] = [];

  filteredBatch.forEach((b) =>
    b.rows.forEach((r) =>
      recs.push({
        date: b.date,
        shift: b.shift,
        section: r.section,
        name: r.name,
        id: r.id,
        type: r.type,
        status: r.status,
        count: r.count,
        by: b.reportedBy,
        remark: r.remark || '',
        desig: r.designation || '',
      })
    )
  );

  recs.sort((a, b) => a.date.localeCompare(b.date) || shiftOrder(a.shift) - shiftOrder(b.shift));

  // 1. Sheet: Attendance
  const attHeaders = [
    'Date',
    'Shift',
    'Section',
    'Name',
    'ID',
    'Type',
    'Status',
    'Count',
    'Reported By',
    'Remark',
    'Designation',
  ];
  const attData: (string | number)[][] = [
    ['LG PLAST — Affordable / Durable / Complete'],
    ['ATTENDANCE SHIFT LOG REPORT'],
    [],
    attHeaders,
  ];
  recs.forEach((r) => {
    attData.push([
      r.date,
      r.shift,
      r.section,
      r.name,
      r.id,
      r.type,
      r.status,
      r.count,
      r.by,
      r.remark,
      r.desig,
    ]);
  });
  const wsAtt = XLSX.utils.aoa_to_sheet(attData);
  wsAtt['!cols'] = [
    { wch: 13 },
    { wch: 9 },
    { wch: 18 },
    { wch: 26 },
    { wch: 10 },
    { wch: 12 },
    { wch: 10 },
    { wch: 8 },
    { wch: 18 },
    { wch: 34 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, wsAtt, 'Attendance');

  // 2. Sheet: Summary
  const sum: (string | number)[][] = [
    ['LG PLAST — Affordable / Durable / Complete'],
    ['Warehouse & Plant Attendance Summary Report'],
    [
      `Period: ${filterFromDate || (filteredBatch[0]?.date || 'All')} to ${
        filterToDate || (filteredBatch[filteredBatch.length - 1]?.date || 'All')
      }`,
    ],
    [`Total Shift Reports Phased: ${filteredBatch.length}`],
    [],
    ['Overall Measures', 'Total Headcount'],
  ];

  const totals = batchTotals(filteredBatch);
  sum.push(['Employees Present', totals.ep]);
  sum.push(['Employees Absent', totals.ea]);
  sum.push(['Casuals Present', totals.cp]);
  sum.push(['Casuals Absent', totals.ca]);
  sum.push(['Total Present (Employees + Casuals)', totals.ep + totals.cp]);
  sum.push(['Total Absent (Employees + Casuals)', totals.ea + totals.ca]);
  sum.push(['Total Staff Listed', totals.ep + totals.ea + totals.cp + totals.ca]);
  const empAttPct = totals.ep + totals.ea > 0 ? (100 * totals.ep) / (totals.ep + totals.ea) : 0;
  sum.push(['Employee Attendance %', `${empAttPct.toFixed(1)}%`]);
  sum.push([]);

  // By Date & Shift
  sum.push(['By Date and Shift Breakdown']);
  sum.push([
    'Date',
    'Shift',
    'Employees Present',
    'Employees Absent',
    'Casuals Present',
    'Casuals Absent',
    'Total Present',
    'Total Absent',
    'Attendance %',
  ]);

  filteredBatch.forEach((b) => {
    const c = counts(b.rows);
    const p = c.ep + c.cp;
    const a = c.ea + c.ca;
    const pct = c.ep + c.ea > 0 ? (100 * c.ep) / (c.ep + c.ea) : 0;
    sum.push([b.date, b.shift, c.ep, c.ea, c.cp, c.ca, p, a, `${pct.toFixed(1)}%`]);
  });

  const wsSummary = XLSX.utils.aoa_to_sheet(sum);
  wsSummary['!cols'] = [{ wch: 32 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // 3. Sheet: Absent
  const absHeaders = [
    'Date',
    'Shift',
    'Section',
    'Name',
    'ID',
    'Type',
    'Count',
    'Reported By',
    'Remark',
    'Designation',
  ];
  const absData: (string | number)[][] = [
    ['LG PLAST — Affordable / Durable / Complete'],
    ['ABSENT STAFF REPORT'],
    [],
    absHeaders,
  ];
  recs
    .filter((r) => r.status === 'Absent')
    .forEach((r) => {
      absData.push([
        r.date,
        r.shift,
        r.section,
        r.name,
        r.id,
        r.type,
        r.count,
        r.by,
        r.remark,
        r.desig,
      ]);
    });
  const wsAbs = XLSX.utils.aoa_to_sheet(absData);
  wsAbs['!cols'] = [{ wch: 13 }, { wch: 9 }, { wch: 18 }, { wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 18 }, { wch: 34 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsAbs, 'Absent');

  // 4. Sheet: Casuals
  const casHeaders = [
    'Date',
    'Shift',
    'Section',
    'Name',
    'ID',
    'Status',
    'Count',
    'Reported By',
    'Remark',
    'Designation',
  ];
  const casData: (string | number)[][] = [
    ['LG PLAST — Affordable / Durable / Complete'],
    ['CASUALS ATTENDANCE REPORT'],
    [],
    casHeaders,
  ];
  recs
    .filter((r) => r.type === 'Casual')
    .forEach((r) => {
      casData.push([
        r.date,
        r.shift,
        r.section,
        r.name,
        r.id,
        r.status,
        r.count,
        r.by,
        r.remark,
        r.desig,
      ]);
    });
  const wsCas = XLSX.utils.aoa_to_sheet(casData);
  wsCas['!cols'] = [{ wch: 13 }, { wch: 9 }, { wch: 18 }, { wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 18 }, { wch: 34 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsCas, 'Casuals');

  // 5. Sheet: By Person
  const pmap = new Map<string, { name: string; id: string; type: string; p: number; a: number; desig: string }>();
  recs
    .filter((r) => !/headcount/i.test(r.name))
    .forEach((r) => {
      const k = (r.id || r.name).toUpperCase() + '|' + r.name.toUpperCase();
      if (!pmap.has(k)) {
        pmap.set(k, { name: r.name, id: r.id, type: r.type, p: 0, a: 0, desig: r.desig });
      }
      const o = pmap.get(k)!;
      if (r.status === 'Absent') o.a++;
      else o.p++;
      if (r.type === 'Casual') o.type = 'Casual';
    });

  const people = [...pmap.values()].sort((a, b) => b.a - a.a || a.name.localeCompare(b.name));
  const pHeaders = [
    'Name',
    'ID',
    'Type',
    'Shifts Present',
    'Shifts Absent',
    'Shifts Listed',
    'Attendance %',
    'Designation',
  ];
  const pData: (string | number)[][] = [
    ['LG PLAST — Affordable / Durable / Complete'],
    ['ATTENDANCE BY PERSON SUMMARY'],
    [],
    pHeaders,
  ];
  people.forEach((o) => {
    const tot = o.p + o.a;
    const pct = tot > 0 ? (100 * o.p) / tot : 0;
    pData.push([o.name, o.id, o.type, o.p, o.a, tot, `${pct.toFixed(1)}%`, o.desig]);
  });
  const wsPerson = XLSX.utils.aoa_to_sheet(pData);
  wsPerson['!cols'] = [{ wch: 28 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 13 }, { wch: 14 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsPerson, 'By Person');

  // Save Workbook
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const ds = filteredBatch.map((b) => b.date).sort();
  const fileName = `LGPLAST_Attendance_Report_${ds[0] || 'Batch'}${
    ds[ds.length - 1] && ds[ds.length - 1] !== ds[0] ? '_to_' + ds[ds.length - 1] : ''
  }.xlsx`;

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1500);

  return fileName;
}
