import {
  MaintenanceJobCard,
  MaintenanceJobCardType,
  MaintenanceStageStep,
} from '../types';

export const ENGINEER_REPLACEMENT_POLICY_TEXT =
  'MANDATORY POLICY: NO REPLACEMENTS CAN BE DONE WITHOUT TWO (2) OR THREE (3) SIGNATURES FROM ENGINEERS BELOW.';

export function getCardTypeLabel(cardType: MaintenanceJobCardType): string {
  switch (cardType) {
    case 'EXTRUSION_DIE_CHANGE':
      return 'Extrusion Die Change Job Card (Up to Storage)';
    case 'INJECTION_MOULD_CHANGE':
      return 'Injection Mould Change Job Card (Up to Storage)';
    case 'STANDARD_MAINTENANCE':
    default:
      return 'Standard Maintenance Job Card';
  }
}

export function getDefaultDocCodeForCardType(cardType: MaintenanceJobCardType): string {
  switch (cardType) {
    case 'EXTRUSION_DIE_CHANGE':
      return 'LG-MNT-DIE-02';
    case 'INJECTION_MOULD_CHANGE':
      return 'LG-MNT-MLD-03';
    case 'STANDARD_MAINTENANCE':
    default:
      return 'LG-MNT-JC-01';
  }
}

export function getDefaultTeamForCardType(cardType: MaintenanceJobCardType): string {
  switch (cardType) {
    case 'EXTRUSION_DIE_CHANGE':
      return 'Extrusion Mould Setter & Maintenance Team';
    case 'INJECTION_MOULD_CHANGE':
      return 'Injection Mould Setter & Tooling Team';
    case 'STANDARD_MAINTENANCE':
    default:
      return 'Mechanical & Electrical Maintenance Team';
  }
}

export function getDefaultWorkTitleForCardType(cardType: MaintenanceJobCardType): string {
  switch (cardType) {
    case 'EXTRUSION_DIE_CHANGE':
      return 'Extrusion Die Head Changeover, Cleaning & Toolroom Storage';
    case 'INJECTION_MOULD_CHANGE':
      return 'Injection Mould Changeover, Preservation & Toolroom Storage';
    case 'STANDARD_MAINTENANCE':
    default:
      return '';
  }
}

export function buildDefaultStagesForCardType(
  cardType: MaintenanceJobCardType
): MaintenanceStageStep[] {
  if (cardType === 'EXTRUSION_DIE_CHANGE') {
    return [
      {
        id: 'ext-die-1',
        stageNo: 1,
        stageTitle: 'Stage 1 · Purge, Thermal Shutdown & LOTO Isolation',
        instruction:
          'Purge barrel with cleaning compound until melt runs clean; switch off main drive, isolate breaker, lock-out/tag-out (LOTO), and wear heat-resistant PPE/visor.',
        safetyNote: 'Confirm zero screw rotation and verify barrel/die temperature safe before unbolting.',
        completed: false,
      },
      {
        id: 'ext-die-2',
        stageNo: 2,
        stageTitle: 'Stage 2 · Heater/TC Disconnect & Outgoing Die Removal',
        instruction:
          'Tag & disconnect die heater bands and thermocouples cleanly; support die head weight on chain block/trolley, loosen flange bolts in cross-pattern, and remove outgoing die & breaker plate.',
        safetyNote: 'Never pull thermocouple wires; use calibrated lifting sling.',
        completed: false,
      },
      {
        id: 'ext-die-3',
        stageNo: 3,
        stageTitle: 'Stage 3 · Hot Die Strip-Down, Scraping & Mandrel Cleaning',
        instruction:
          'Strip outgoing die while warm using brass/copper scrapers ONLY (never steel scrapers). Clean spider legs, mandrel, die lip lands, and breaker plate holes; inspect for score marks or wear.',
        safetyNote: 'Protect precision sealing faces from burrs or impact.',
        completed: false,
      },
      {
        id: 'ext-die-4',
        stageNo: 4,
        stageTitle: 'Stage 4 · Anti-Rust Preservation & Toolroom Storage Sign-Off',
        instruction:
          'Allow outgoing die to cool safely, coat internal melt channels, threads & polished lands with anti-corrosion oil, fit protective plastic/wooden end covers, attach Die ID tag, and log onto designated Toolroom Storage Rack/Bin.',
        safetyNote: 'Record exact Storage Rack / Bin location on this job card.',
        completed: false,
      },
      {
        id: 'ext-die-5',
        stageNo: 5,
        stageTitle: 'Stage 5 · Incoming Die Cleaning, Assembly & Alignment',
        instruction:
          'Verify incoming die cavity/sizing sleeve condition; apply high-temp anti-seize on flange bolts, mount die onto adapter, torque bolts evenly in stages, reconnect heaters & thermocouples, and align haul-off/vacuum tank centerlines.',
        completed: false,
      },
      {
        id: 'ext-die-6',
        stageNo: 6,
        stageTitle: 'Stage 6 · Controlled Heat Soak, Trial Extrusion & QC Release',
        instruction:
          'Ramp barrel & die zones to target setpoint and soak 30–45 min; re-torque hot flange bolts; start slow extrusion, adjust die centering bolts for uniform wall thickness, and obtain QC clearance.',
        completed: false,
      },
    ];
  }

  if (cardType === 'INJECTION_MOULD_CHANGE') {
    return [
      {
        id: 'inj-mld-1',
        stageNo: 1,
        stageTitle: 'Stage 1 · Production Stop, Barrel Purge & LOTO Lockout',
        instruction:
          'Finish last shot cleanly, retract injection carriage, purge barrel neutral material, close safety gate, switch machine to Setup/Manual, and lock out hydraulic pump & main isolator (LOTO).',
        safetyNote: 'Verify overhead crane inspection tag & zero residual hydraulic pressure.',
        completed: false,
      },
      {
        id: 'inj-mld-2',
        stageNo: 2,
        stageTitle: 'Stage 2 · Chiller/Water, Core-Pull Draining & Air Purge',
        instruction:
          'Close cooling manifold valves, drain water hoses completely, and blow compressed air through EVERY cooling circuit on the outgoing mould to expel 100% residual water; cap hydraulic quick-couplers cleanly.',
        safetyNote: 'Residual water causes severe internal channel rust in storage.',
        completed: false,
      },
      {
        id: 'inj-mld-3',
        stageNo: 3,
        stageTitle: 'Stage 3 · Ejector Uncouple, Hoist Rigging & Platen Removal',
        instruction:
          'Close platen to light contact, fit lifting eye-bolt & safety lock strap between A/B mould halves, hook overhead hoist taut, release mould clamps/ejector coupling rod, open platen slowly, and lift outgoing mould onto setter trolley.',
        completed: false,
      },
      {
        id: 'inj-mld-4',
        stageNo: 4,
        stageTitle: 'Stage 4 · Cavity Cleaning, Rust Protection & Toolroom Storage',
        instruction:
          'Wipe cavities, cores, vents & parting lines with mould cleaner; grease guide pillars/bushes; apply protective anti-rust spray over cavities & mating faces; close & lock safety strap; tag Mould ID and place in Toolroom Storage Rack/Bay.',
        safetyNote: 'Confirm Storage Rack / Bay number & preservation check below.',
        completed: false,
      },
      {
        id: 'inj-mld-5',
        stageNo: 5,
        stageTitle: 'Stage 5 · Incoming Mould Mounting, Clamping & Utility Hookup',
        instruction:
          'Inspect platen faces & locating ring; hoist incoming mould into platen center, verify clamp tonnage/height, fit minimum 4 clamps per half symmetrically, reconnect ejector bar, water IN/OUT hoses (leak test) & core-pull/hot-runner leads.',
        completed: false,
      },
      {
        id: 'inj-mld-6',
        stageNo: 6,
        stageTitle: 'Stage 6 · Stroke Setup, Low-Pressure Protect & First-Shot QC',
        instruction:
          'Remove safety strap before dry-cycling! Set mould open/close stroke, low-pressure mould safety protect, and ejector stroke; dry-cycle 5 times; run first test shots and obtain QC dimensional/visual release.',
        safetyNote: 'CRITICAL: Confirm mould safety strap is removed before closing platen.',
        completed: false,
      },
    ];
  }

  return [
    {
      id: 'std-mnt-1',
      stageNo: 1,
      stageTitle: 'Stage 1 · Machine Shutdown, Energy Isolation & LOTO Verification',
      instruction:
        'Stop machine safely at Shift In Charge handover, isolate main power/air/hydraulic supplies, fit personal LOTO padlock & warning tag, and confirm zero stored energy.',
      safetyNote: 'Never bypass interlocks during fault check unless supervised under test protocol.',
      completed: false,
    },
    {
      id: 'std-mnt-2',
      stageNo: 2,
      stageTitle: 'Stage 2 · Root Cause Diagnosis & Replacement Authorization Gate',
      instruction:
        'Inspect mechanical, electrical, pneumatic, or heater control fault. Record root cause. IMPORTANT: If ANY component/part replacement is needed, obtain 2 or 3 Engineer signatures below BEFORE replacing any part.',
      safetyNote: 'No replacements may proceed without 2 or 3 Engineer signatures.',
      completed: false,
    },
    {
      id: 'std-mnt-3',
      stageNo: 3,
      stageTitle: 'Stage 3 · Repair Execution, Calibration & Guard Restoration',
      instruction:
        'Execute approved repair/adjustment/approved replacement using calibrated tools. Torqued fasteners marked, wiring dressed inside trunking, and all safety guards/switches restored.',
      completed: false,
    },
    {
      id: 'std-mnt-4',
      stageNo: 4,
      stageTitle: 'Stage 4 · Post-Repair Functional Test, 5S Cleanup & Handover',
      instruction:
        'Clear tools from machine envelope, remove LOTO, perform 10-minute operational load test, verify safety E-stops, and obtain Shift In Charge & Engineer sign-off.',
      completed: false,
    },
  ];
}

export function countEngineerSignatures(card: MaintenanceJobCard): number {
  let count = 0;
  if (card.engineer1?.signature) count++;
  if (card.engineer2?.signature) count++;
  if (card.engineer3?.signature) count++;
  return count;
}

export function deriveJobCardStatus(card: MaintenanceJobCard): MaintenanceJobCard['status'] {
  const allStagesDone = card.stages.length > 0 && card.stages.every((s) => s.completed);
  const engSigns = countEngineerSignatures(card);
  const techSigned = Boolean(card.technicianOrSetter?.signature);
  const anyStageDone = card.stages.some((s) => s.completed);

  if (allStagesDone && techSigned && (!card.replacementRequired || engSigns >= 2)) {
    return 'COMPLETED';
  }
  if (card.replacementRequired && engSigns < 2 && (anyStageDone || techSigned)) {
    return 'AWAITING_ENGINEER_SIGNS';
  }
  if (anyStageDone || techSigned || engSigns > 0) {
    return 'IN_PROGRESS';
  }
  return 'ISSUED';
}
