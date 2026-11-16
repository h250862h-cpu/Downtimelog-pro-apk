export interface FactoryStaffMember {
  id: number;
  name: string;
  designation: string;
}

export const FACTORY_STAFF_ROSTER: FactoryStaffMember[] = [
  { id: 13, name: 'Kefas', designation: 'Cleaner' },
  { id: 4, name: 'BOTHWELL MATIBHIRI', designation: 'recycling' },
  { id: 14, name: 'KUDAKWASHE JEMWA', designation: 'recycling' },
  { id: 1, name: 'ALLAN MHARANDU', designation: 'Dispatch clerk' },
  { id: 52, name: 'BRIGHTON MUDAMBURI', designation: 'electrician' },
  { id: 43, name: 'TRIED CHAKUBVA', designation: 'extruder assistant' },
  { id: 50, name: 'FARAI MURONZWA', designation: 'extruder operator' },
  { id: 19, name: 'MUNYARADZI MUHOMBA', designation: 'extruder assistant' },
  { id: 20, name: 'NGONI MUTENA', designation: 'extruder assistant' },
  { id: 12, name: 'JONATHAN CHIDINDI', designation: 'extruder assistant' },
  { id: 11, name: 'JAMES MUSHAWATU', designation: 'dispatch' },
  { id: 33, name: 'TAKUNDA KANHICHIRE', designation: 'extruder operator' },
  { id: 40, name: 'TINASHE MAGWANISA', designation: 'extruder operator' },
  { id: 45, name: 'VITALIS DENHERE', designation: 'extruder operator' },
  { id: 53, name: 'FIDELIS CHUMA', designation: 'mold setter' },
  { id: 57, name: 'DENNIS MUZANENHAMO', designation: 'extruder operator' },
  { id: 99, name: 'AMON KAMANYIRA', designation: 'sheq Officer' },
  { id: 24, name: 'OWEN GAMBO', designation: 'injection assistant' },
  { id: 3, name: 'BLESSING MUTENA', designation: 'dispatch' },
  { id: 37, name: 'THINKWELL MARUMANI', designation: 'injection assistant' },
  { id: 26, name: 'REMOS TSIGA', designation: 'injection assistant' },
  { id: 46, name: 'LIBERTY', designation: 'dispatch' },
  { id: 34, name: 'TAKUNDA MAGAUZE', designation: 'injection assistant' },
  { id: 6, name: 'ERIC NYAMAPANDA', designation: 'shift in charge' },
  { id: 28, name: 'SIMON TARUBINGA', designation: 'injection operator' },
  { id: 16, name: 'MARENZI LEORNARD', designation: 'injection supervisor' },
  { id: 55, name: 'MASIMBA MUKUKU', designation: 'maintenance' },
  { id: 17, name: 'MOREBLESSING MUTAURWA', designation: 'maintenance' },
  { id: 60, name: 'Tinomutenda', designation: 'maintenance' },
  { id: 38, name: 'TCHAONA MAKADHO', designation: 'mixer operator' },
  { id: 31, name: 'TAFARA SHAVAYEMOMBE', designation: 'WH Auto Mixer' },
  { id: 5, name: 'COLLEN CHAMANGA', designation: 'Dispatch clerk' },
  { id: 8, name: 'FREEDOM. C. MAPFUMO', designation: 'dispatch' },
  { id: 9, name: 'GARIKAI MADUBEKO', designation: 'dispatch' },
  { id: 30, name: 'TADIWA MHINDURWA', designation: 'dispatch' },
  { id: 35, name: 'TAWANDA WHITE', designation: 'WH Auto Mixer' },
  { id: 2, name: 'BIGGIE MANGWENDE', designation: 'mixing' },
  { id: 18, name: 'MUFARO SIYAMI', designation: 'dispatch' },
  { id: 23, name: 'esmore urombo', designation: 'gumboot machine operator' },
  { id: 36, name: 'TENDAI DZUNA', designation: 'mixing' },
  { id: 25, name: 'VICTOR CHIPUNZA', designation: 'plumber' },
  { id: 29, name: 'STANFORD TAKUDZWA', designation: 'dispatch' },
  { id: 39, name: 'TINASHE CHIHOTA', designation: 'Dispatch clerk' },
  { id: 49, name: 'MALVERN NZOMBE', designation: 'injection assistant' },
  { id: 61, name: 'WITNESS GOVA', designation: 'mixing' },
  { id: 67, name: 'PEDZISAI MARUFU', designation: 'mixing' },
  { id: 74, name: 'CALUM DHIMINGWI', designation: 'dispatch' },
  { id: 68, name: 'FRANK MUTSATSATI', designation: 'extruder assistant' },
  { id: 95, name: 'Courage Chinzou', designation: 'dispatch' },
  { id: 72, name: 'TAVONGA MUPWANYIWA', designation: 'dispatch' },
  { id: 56, name: 'SIMBARASHE CHAUNOITA', designation: 'production clerk' },
  { id: 59, name: 'Mapfumo', designation: 'Security' },
  { id: 62, name: 'BATANAI MUSIIWA', designation: 'dispatch' },
  { id: 63, name: 'CARLOS TAFRIREI', designation: 'dispatch' },
  { id: 64, name: 'JENKINS MANVINEMA', designation: 'injection assistant' },
  { id: 10, name: 'INNOCENT MAVIYANI', designation: 'shift in charge' },
  { id: 27, name: 'RONWELL', designation: 'dispatch' },
  { id: 44, name: 'TRUST GWEME', designation: 'shift in charge' },
  { id: 32, name: 'TAKUDZWA ZIMANI', designation: 'Stores' },
  { id: 58, name: 'NEVER SHARA', designation: 'supervisor' },
  { id: 65, name: 'CLIVE SHOKO', designation: 'injection assistant' },
  { id: 76, name: 'PASSMORE', designation: 'mixing' },
  { id: 77, name: 'SHAWN NYANINGWE', designation: 'extruder assistant' },
  { id: 78, name: 'TREVOR MAZANHI', designation: 'extruder assistant' },
  { id: 7, name: 'TAFADZWA CHIRENGWA', designation: 'extruder assistant' },
  { id: 79, name: 'LENOX MUHLABA', designation: 'extruder assistant' },
  { id: 80, name: 'PATSON MUSEKIWA', designation: 'extruder assistant' },
  { id: 81, name: 'HAWARD', designation: 'injection assistant' },
  { id: 82, name: 'TINOTENDA SAMUKANGE', designation: 'maintenance' },
  { id: 83, name: 'EZIAS', designation: 'gumboot machine operator' },
  { id: 84, name: 'GRAMMY NDODA', designation: 'recycling' },
  { id: 85, name: 'PEARSON', designation: 'mixing' },
  { id: 94, name: 'Joseph Sakunyepa', designation: 'dispatch' },
  { id: 88, name: 'BOTHWELL MARENZI', designation: 'injection operator' },
  { id: 87, name: 'BLESSED', designation: 'polypipe operator' },
  { id: 89, name: 'FELIX SITHOLE', designation: 'injection assistant' },
  { id: 91, name: 'SHELTON', designation: 'dispatch' },
  { id: 92, name: 'Bernard Mafunhiya', designation: 'dispatch' },
  { id: 96, name: 'TINASHE BVUNGO', designation: 'gumboot machine assistant' },
  { id: 97, name: 'Given Wilson', designation: 'gumboot machine assistant' },
  { id: 93, name: 'Farasteny Tozvireva', designation: 'extruder assistant' },
  { id: 98, name: 'PASSION', designation: 'mixing' },
  { id: 100, name: 'EVANS', designation: 'stores' },
  { id: 73, name: 'Isa', designation: 'Cook' },
];

/**
 * Filtered list of qualified Machine Operators strictly (only operator designation)
 */
export const OPERATOR_OPTIONS: { label: string; value: string; designation: string }[] =
  FACTORY_STAFF_ROSTER.filter((s) => s.designation.toLowerCase().includes('operator'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({
      label: `${s.name} (${s.designation}) [ID: ${s.id}]`,
      value: s.name,
      designation: s.designation,
    }));

/**
 * Filtered list of Assistants strictly (only assistant designation)
 */
export const GENERAL_HAND_OPTIONS: { label: string; value: string; designation: string }[] =
  FACTORY_STAFF_ROSTER.filter((s) => s.designation.toLowerCase().includes('assistant'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({
      label: `${s.name} (${s.designation}) [ID: ${s.id}]`,
      value: s.name,
      designation: s.designation,
    }));

/**
 * Filtered list of Maintenance Personnel & Technicians
 */
export const MAINTENANCE_OPTIONS: { label: string; value: string; designation: string }[] =
  FACTORY_STAFF_ROSTER.filter((s) => {
    const des = s.designation.toLowerCase();
    return (
      des.includes('maintenance') ||
      des.includes('electrician') ||
      des.includes('plumber') ||
      des.includes('mold setter')
    );
  })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({
      label: `${s.name} (${s.designation}) [ID: ${s.id}]`,
      value: s.name,
      designation: s.designation,
    }));

/**
 * Filtered list of Shift In Charge & Supervisors
 */
export const SHIFT_IN_CHARGE_OPTIONS: { label: string; value: string; designation: string }[] =
  FACTORY_STAFF_ROSTER.filter((s) => {
    const des = s.designation.toLowerCase();
    return (
      des.includes('shift in charge') ||
      des.includes('supervisor') ||
      des.includes('production clerk')
    );
  })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({
      label: `${s.name} (${s.designation}) [ID: ${s.id}]`,
      value: s.name,
      designation: s.designation,
    }));

/**
 * Filtered list of Warehouse / Dispatch / Stores Personnel
 */
export const WH_PERSONNEL_OPTIONS: { label: string; value: string; designation: string }[] =
  FACTORY_STAFF_ROSTER.filter((s) => {
    const des = s.designation.toLowerCase();
    return (
      des.includes('dispatch') ||
      des.includes('stores') ||
      des.includes('wh')
    );
  })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({
      label: `${s.name} (${s.designation}) [ID: ${s.id}]`,
      value: s.name,
      designation: s.designation,
    }));

/**
 * All staff formatted for select options
 */
export const ALL_STAFF_SELECT_OPTIONS = [...FACTORY_STAFF_ROSTER]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((s) => ({
    label: `${s.name} - ${s.designation} (#${s.id})`,
    value: s.name,
    id: s.id,
    designation: s.designation,
  }));
