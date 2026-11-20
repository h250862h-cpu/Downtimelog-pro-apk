import {
  QualityStandardTestItem,
  QualityTrialCategory,
  QualityTrialFormulationRow,
  QualityTrialReport,
  normalizeMachineName,
} from '../types';

export interface ProductTrialTemplateResult {
  productFamily: string;
  recommendedMachine: string;
  applicableStandards: string[];
  tests: QualityStandardTestItem[];
  defaultFormulation: QualityTrialFormulationRow[];
}

export function classifyProductFamily(productName: string): string {
  const p = (productName || '').trim().toUpperCase();
  if (!p) return 'General Polymer Product';
  if (p.includes('GUM BOOT') || p.includes('BOOT')) return 'PVC Gum Boots (Footwear)';
  if (p.includes('WATER PIPE')) return 'uPVC Pressure Water Pipes';
  if (p.includes('DRAIN') || p.includes('SWR') || p.includes('WASTE PIPE')) {
    return 'uPVC Drain / SWR / Waste Pipes';
  }
  if (p.includes('POLY PIPE') || p.includes('HDPE')) return 'HDPE Poly Pipes';
  if (p.includes('CONDUIT')) return 'uPVC Electrical Conduits';
  if (p.includes('TRUNKING') || p.includes('GUTTER')) return 'uPVC Profile Trunking & Gutters';
  if (p.includes('BRAIDED HOSE') || p.includes('HOSE')) return 'Flexible PVC Braided Hoses';
  if (p.includes('GRANUAL') || p.includes('GRANULE')) return 'PVC Granules & Compounded Formulation';
  if (
    p.includes('BEND') ||
    p.includes('TEE') ||
    p.includes('COUPLENE') ||
    p.includes('NIPPLE') ||
    p.includes('BOX') ||
    p.includes('COVER') ||
    p.includes('VENT') ||
    p.includes('RODDEN') ||
    p.includes('PLUG') ||
    p.includes('CAP') ||
    p.includes('SEAL') ||
    p.includes('ORING') ||
    p.includes('CLIP') ||
    p.includes('FITTING')
  ) {
    return 'Injection Moulded Fittings & Accessories';
  }
  return 'General Polymer Product';
}

export function suggestMachineForProduct(productName: string): string {
  const family = classifyProductFamily(productName);
  switch (family) {
    case 'PVC Gum Boots (Footwear)':
      return 'Gumboot Machine';
    case 'HDPE Poly Pipes':
      return 'Polypipe Machine 1';
    case 'uPVC Profile Trunking & Gutters':
      return 'Trunking Machine';
    case 'Flexible PVC Braided Hoses':
      return 'Hose Pipe Machine';
    case 'Injection Moulded Fittings & Accessories':
      return 'IM 1';
    case 'PVC Granules & Compounded Formulation':
      return 'Mixer Machine 1';
    case 'uPVC Drain / SWR / Waste Pipes':
      return 'Extrusion Machine 1';
    case 'uPVC Pressure Water Pipes':
      return 'Extrusion Machine 2';
    default:
      return normalizeMachineName('Extrusion Machine 1');
  }
}

function makeTest(
  idx: number,
  testName: string,
  standardRef: string,
  method: string,
  unit: string,
  specRequirement: string
): QualityStandardTestItem {
  return {
    id: `TST-${idx}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    testName,
    standardRef,
    method,
    unit,
    specRequirement,
    actualResult: '',
    verdict: '',
    remarks: '',
  };
}

export function buildDefaultFormulationForCategory(
  category: QualityTrialCategory,
  productFamily: string
): QualityTrialFormulationRow[] {
  const isHdpe = productFamily === 'HDPE Poly Pipes';
  const baseResin = isHdpe ? 'HDPE Virgin Resin (PE80/PE100)' : 'PVC Resin (SG-5 / K-67)';

  if (category === 'Scrap / Regrind Ratio') {
    return [
      { ingredientName: baseResin, role: 'Base Resin', ratioOrPhr: '85% Virgin Base', batchQtyKg: '' },
      { ingredientName: 'Clean Pulverized / Crushed Regrind', role: 'Recycled Scrap', ratioOrPhr: '15% Scrap Trial', batchQtyKg: '' },
      { ingredientName: 'Ca-Zn / Lead Heat Stabilizer', role: 'Stabilizer', ratioOrPhr: '3.0 PHR', batchQtyKg: '' },
      { ingredientName: 'Calcium Carbonate (CaCO3)', role: 'Filler / CaCO3', ratioOrPhr: '10 PHR', batchQtyKg: '' },
    ];
  }

  if (category === 'Additive / Formula Change') {
    return [
      { ingredientName: baseResin, role: 'Base Resin', ratioOrPhr: '100 PHR', batchQtyKg: '' },
      { ingredientName: 'Trial Processing Aid / Impact Modifier', role: 'Additive', ratioOrPhr: '1.5 PHR (Trial)', batchQtyKg: '' },
      { ingredientName: 'Thermal Stabilizer Package', role: 'Stabilizer', ratioOrPhr: '3.2 PHR', batchQtyKg: '' },
      { ingredientName: 'Titanium Dioxide / Masterbatch', role: 'Pigment / Masterbatch', ratioOrPhr: '1.0 PHR', batchQtyKg: '' },
    ];
  }

  if (category === 'Masterbatch / Colourant') {
    return [
      { ingredientName: baseResin, role: 'Base Resin', ratioOrPhr: '100%', batchQtyKg: '' },
      { ingredientName: 'Trial Colour Masterbatch / Pigment', role: 'Pigment / Masterbatch', ratioOrPhr: '2.0% Dosage', batchQtyKg: '' },
      { ingredientName: 'UV / Dispersion Additive', role: 'Additive', ratioOrPhr: '0.5 PHR', batchQtyKg: '' },
    ];
  }

  return [
    { ingredientName: baseResin, role: 'Base Resin', ratioOrPhr: '100 PHR', batchQtyKg: '' },
    { ingredientName: 'Heat & UV Stabilizer', role: 'Stabilizer', ratioOrPhr: '3.0 PHR', batchQtyKg: '' },
    { ingredientName: 'Filler / Modifier (Trial Grade)', role: 'Filler / CaCO3', ratioOrPhr: '8.0 PHR', batchQtyKg: '' },
  ];
}

export function generateQualityTrialTemplate(
  productName: string,
  category: QualityTrialCategory
): ProductTrialTemplateResult {
  const family = classifyProductFamily(productName);
  const recommendedMachine = suggestMachineForProduct(productName);
  const defaultFormulation = buildDefaultFormulationForCategory(category, family);

  switch (family) {
    case 'uPVC Pressure Water Pipes':
      return {
        productFamily: family,
        recommendedMachine,
        applicableStandards: ['ISO 1452-2', 'SAZS 530', 'ASTM D1785', 'ISO 9001 QMS'],
        defaultFormulation,
        tests: [
          makeTest(1, 'Surface Finish & Colour Uniformity', 'ISO 1452-2 §6 / QMS-QC-01', 'Visual Inspection (Daylight)', 'Visual', 'Smooth, clean, zero blisters/streaks'),
          makeTest(2, 'Mean Outside Diameter (OD) & Ovality', 'ISO 3126 / SAZS 530', 'Pi-Tape & Vernier Caliper', 'mm', 'Within class tolerance (e.g. ±0.3–0.6 mm)'),
          makeTest(3, 'Wall Thickness (Min / Max)', 'ISO 3126 / ASTM D2122', 'Ultrasonic / Ball-Tip Micrometer', 'mm', '>= Nominal Min Wall for Pressure Class'),
          makeTest(4, 'Drop Weight Impact Resistance (0°C)', 'ISO 3127 / SAZS 530', 'Falling Weight Striker Test', 'Pass/Fail', 'Zero cracks or shattering at specified Joule'),
          makeTest(5, 'Longitudinal Reversion (Heat 150°C)', 'ISO 2505 / QMS-QC-04', 'Oven / Glycerine Bath 150°C', '%', '<= 5.0% axial shrinkage, zero delamination'),
          makeTest(6, 'Vicat Softening Temperature (VST)', 'ISO 2507 / ASTM D1525', 'Oil Bath 50N Load 50°C/hr', '°C', '>= 79.0 °C (uPVC Pressure Grade)'),
          makeTest(7, 'Hydrostatic / Acetone Immersion Integrity', 'ISO 1167 / ISO 9852', 'Anhydrous Acetone / Pressure Rig', 'Pass/Fail', 'No swelling, flaking or burst in 60 min'),
          makeTest(8, 'Linear Unit Weight (Mass per Metre)', 'ISO 9001 QMS / LG-SPEC', 'Calibrated Digital Scale (1m)', 'kg/m', 'Within target class running weight ±3%'),
        ],
      };

    case 'uPVC Drain / SWR / Waste Pipes':
      return {
        productFamily: family,
        recommendedMachine,
        applicableStandards: ['ISO 3633', 'ISO 4435', 'SAZS 530', 'ASTM D2665', 'ISO 9001 QMS'],
        defaultFormulation,
        tests: [
          makeTest(1, 'Visual Appearance & Print Marking', 'ISO 3633 §5 / QMS-QC-01', 'Visual & Ink Adhesion Rub', 'Pass/Fail', 'Smooth bore/outer, legible permanent print'),
          makeTest(2, 'Mean Outside Diameter & Ovality', 'ISO 3126 / ASTM D2122', 'Pi-Tape / Vernier Caliper', 'mm', 'Within ISO 3633 / SAZS limits'),
          makeTest(3, 'Wall Thickness & Socket Fit', 'ISO 3126 / SAZS 530', 'Micrometer & Go/No-Go Plug Gauge', 'mm', '>= Class Min Wall; positive spigot-socket seal'),
          makeTest(4, 'Cold Impact / Drop Bend Resistance', 'ISO 3127 / ASTM D2444', 'Falling Weight Impact & Bend Check', 'Pass/Fail', 'No cracking, splitting or brittle fracture'),
          makeTest(5, 'Dichloromethane / Acetone Gelation Test', 'ISO 9852 / ISO 3633', 'Solvent Immersion (15 min)', 'Pass/Fail', 'Complete fusion; no outer/inner flaking'),
          makeTest(6, 'Thermal Stability / Longitudinal Reversion', 'ISO 2505 / QMS-QC-04', 'Hot Air Oven 150°C', '%', '<= 5.0% dimensional reversion'),
          makeTest(7, 'Flattening & Ring Stiffness (40% Deflection)', 'ASTM D2412 / ISO 9969', 'Compression Press Flattening', 'Pass/Fail', 'No wall cracking or crazing at 40% crush'),
        ],
      };

    case 'HDPE Poly Pipes':
      return {
        productFamily: family,
        recommendedMachine,
        applicableStandards: ['ISO 4427-2', 'SAZS 722', 'ASTM D3035', 'ISO 9001 QMS'],
        defaultFormulation,
        tests: [
          makeTest(1, 'Surface Finish & Carbon Black Dispersion', 'ISO 4427-2 / ISO 18553', 'Visual & Microscopic Check', 'Pass/Fail', 'Glossy homogeneous black; zero gel lumps'),
          makeTest(2, 'Mean OD & Wall Thickness (SDR Class)', 'ISO 3126 / ASTM D2122', 'Pi-Tape & Micrometer', 'mm', 'Within ISO 4427 SDR tolerance'),
          makeTest(3, 'Melt Flow Rate (MFR 190°C / 5kg)', 'ISO 1133 / ASTM D1238', 'Melt Indexer (190°C / 5 kg)', 'g/10 min', '0.20 – 1.40 g/10 min (ΔMFR <= 20%)'),
          makeTest(4, 'Density Verification (23°C)', 'ISO 1183 / ASTM D792', 'Archimedes Density Balance', 'g/cm³', '0.945 – 0.962 g/cm³ (PE80/PE100)'),
          makeTest(5, 'Elongation at Break (Tensile Strip)', 'ISO 6259 / ASTM D638', 'Tensile Bench Test (50 mm/min)', '%', '>= 350% ductile elongation before break'),
          makeTest(6, 'Longitudinal Reversion (110°C)', 'ISO 2505', 'Air Oven 110°C', '%', '<= 3.0% shrinkage, no blistering'),
          makeTest(7, 'Coil Weight & Winding Integrity', 'ISO 9001 QMS / LG-SPEC', 'Platform Scale & Visual Coil', 'kg', 'Matches 100m roll weight spec ±2%'),
        ],
      };

    case 'uPVC Electrical Conduits':
    case 'uPVC Profile Trunking & Gutters':
      return {
        productFamily: family,
        recommendedMachine,
        applicableStandards: ['IEC 61386-21', 'ASTM D1784', 'SAZS 530', 'ISO 9001 QMS'],
        defaultFormulation,
        tests: [
          makeTest(1, 'Surface Finish, Profile Geometry & Lid Snap', 'IEC 61386 / QMS-QC-02', 'Visual & Functional Lid Fit', 'Pass/Fail', 'Clean mitre/lid lock, uniform colour'),
          makeTest(2, 'Cross-Section Width, Height & Thickness', 'ISO 3126 / IEC 61386', 'Vernier Caliper / Micrometer', 'mm', 'Within ±0.25 mm profile spec'),
          makeTest(3, 'Cold Bend & Compression Recovery Test', 'IEC 61386-21 §10', '90° Bending Spring & Load Plate', 'Pass/Fail', 'No kinking, whitening or wall collapse'),
          makeTest(4, 'Impact Resistance (Drop Hammer Test)', 'IEC 61386-21 §10.3', '2 kg Striker at 100mm–300mm', 'Pass/Fail', 'Zero crack propagation after impact'),
          makeTest(5, 'Flame Retardance (Self-Extinguishing)', 'IEC 61386 §13 / UL 94 V-0', 'Vertical Flame Exposure (30s)', 'sec', 'Self-extinguishes < 30s after burner removal'),
          makeTest(6, 'Heat Deflection / Reversion (150°C)', 'ISO 2505 / QMS-QC-04', 'Thermal Oven Check', '%', '<= 4.0% distortion, lid remains functional'),
          makeTest(7, 'Unit Length & Bundle Weight', 'ISO 9001 QMS / LG-SPEC', 'Tape & Digital Scale', 'kg', 'Matches standard length (2.9m / 3m / 4m) ±2%'),
        ],
      };

    case 'Flexible PVC Braided Hoses':
      return {
        productFamily: family,
        recommendedMachine,
        applicableStandards: ['ISO 1401', 'ASTM D380', 'ISO 9001 QMS'],
        defaultFormulation,
        tests: [
          makeTest(1, 'Inner Core Clarity, Colour & Braid Pitch', 'ISO 1401 / QMS-QC-05', 'Visual & Yarn Tension Check', 'Pass/Fail', 'Uniform polyester braid, zero pinholes/bubbles'),
          makeTest(2, 'Internal Diameter (ID) & Wall Thickness', 'ASTM D380', 'Pin Gauge & Caliper', 'mm', 'ID within ±0.5 mm; uniform cover bond'),
          makeTest(3, 'Hydrostatic Burst / Working Pressure Check', 'ISO 1402 / ASTM D380', 'Hydro Pressure Rig', 'bar', '>= 3x Working Pressure (no ply separation)'),
          makeTest(4, 'Flexibility & Cold Kink Radius', 'ASTM D380 / QMS-QC-05', 'Mandrel 180° Bend Test', 'Pass/Fail', 'No collapse, cracking or yarn slip'),
          makeTest(5, 'Ply Adhesion (Core to Outer Cover)', 'ASTM D413 / QMS-QC-05', 'Peel / Strip Pull Check', 'Pass/Fail', 'Tight fusion around yarn reinforcement'),
          makeTest(6, 'Hardness (Shore A)', 'ASTM D2240 / ISO 868', 'Shore A Durometer', 'Shore A', '72 – 82 Shore A (flexible grade)'),
          makeTest(7, 'Roll Length & Coil Mass', 'ISO 9001 QMS / LG-SPEC', 'Counter & Digital Scale', 'kg', 'Matches 25m/45m/50m/100m roll spec'),
        ],
      };

    case 'PVC Gum Boots (Footwear)':
      return {
        productFamily: family,
        recommendedMachine,
        applicableStandards: ['ISO 20347', 'ISO 20344', 'SAZS 785', 'ASTM D2240', 'ISO 9001 QMS'],
        defaultFormulation,
        tests: [
          makeTest(1, 'Upper & Sole Compound Appearance / Gloss', 'ISO 20347 / QMS-GB-01', 'Visual Inspection', 'Pass/Fail', 'Zero flow marks, voids, or short-shot mould defects'),
          makeTest(2, 'Upper-to-Sole Bond Strength (2-Shot Fusion)', 'ISO 20344 §5.2', 'Manual & Strip Peel Test', 'N/mm', '>= 4.0 N/mm (zero sole separation)'),
          makeTest(3, 'Hardness — Sole vs Upper (Shore A)', 'ASTM D2240 / ISO 868', 'Shore A Durometer', 'Shore A', 'Sole: 58–66 Shore A | Upper: 48–56 Shore A'),
          makeTest(4, 'Sole Abrasion & Flexing Crack Resistance', 'ISO 20344 §8.4', '180° Repeated Flex Bend', 'Pass/Fail', 'Zero crack initiation across cleat groove'),
          makeTest(5, '100% Waterproof Leak Immersion Test', 'ISO 20344 §5.15 / SAZS 785', 'Water Tank Immersion (30 min)', 'Pass/Fail', 'Zero water ingress through sole seam or heel'),
          makeTest(6, 'Size Dimensional Gauge & Pair Weight', 'ISO 9001 QMS / LG-SPEC', 'Last Sizing & Digital Scale', 'kg/pair', 'Accurate Size 39–46 fit & uniform pair weight'),
          makeTest(7, 'Compound Density & Specific Gravity', 'ISO 1183 / ASTM D792', 'Density Balance Check', 'g/cm³', '1.18 – 1.28 g/cm³ (within formulation spec)'),
        ],
      };

    case 'Injection Moulded Fittings & Accessories':
      return {
        productFamily: family,
        recommendedMachine,
        applicableStandards: ['ISO 1452-3', 'ISO 3633', 'ASTM D2466', 'SAZS 530', 'ISO 9001 QMS'],
        defaultFormulation,
        tests: [
          makeTest(1, 'Surface Finish, Flash & Gate Trim', 'ISO 1452-3 / QMS-IM-01', 'Visual & Tactile Inspection', 'Pass/Fail', 'Zero sink marks, silver streaks, or sharp flash'),
          makeTest(2, 'Socket / Thread Fit & Dimensional Tolerance', 'ISO 3126 / ASTM D2466', 'Caliper & Pipe Sample Fit Check', 'mm', 'Snug interference / solvent-cement fit to pipe'),
          makeTest(3, 'Impact Drop & Crush Strength', 'ASTM D2444 / QMS-IM-03', '2m Concrete Drop / Press Check', 'Pass/Fail', 'Zero cracking or weld-line splitting'),
          makeTest(4, 'Oven Stress Relief / Weld-Line Integrity (150°C)', 'ISO 580 / QMS-IM-04', 'Hot Air Oven 150°C (30–60 min)', 'Pass/Fail', 'No blistering, parting-line opening, or peeling'),
          makeTest(5, 'Vicat Softening Temperature (VST)', 'ISO 2507 / ASTM D1525', 'Thermal Softening Bath', '°C', '>= 76.0 °C (Fitting Injection Grade)'),
          makeTest(6, 'Shot Weight Consistency (Sample n=5)', 'ISO 9001 QMS / LG-SPEC', 'Precision Scale (g)', 'g', 'Within ±1.5% of master shot weight'),
        ],
      };

    case 'PVC Granules & Compounded Formulation':
      return {
        productFamily: family,
        recommendedMachine,
        applicableStandards: ['ISO 1183', 'ASTM D792', 'ASTM D2240', 'ISO 1133', 'ISO 9001 QMS'],
        defaultFormulation,
        tests: [
          makeTest(1, 'Pellet Uniformity, Colour & Contamination', 'ISO 9001 QMS / LG-CMP-01', 'Visual Sample Tray (500g)', 'Pass/Fail', 'Uniform cut, zero charred specks or dust'),
          makeTest(2, 'Bulk Density & Moisture Content', 'ASTM D1895 / QMS-CMP-02', 'Moisture Analyser (105°C)', '%', 'Moisture <= 0.30%; consistent bulk flow'),
          makeTest(3, 'Specific Gravity / Compound Density', 'ISO 1183 / ASTM D792', 'Archimedes Density Balance', 'g/cm³', 'Matches target formulation density ±0.02'),
          makeTest(4, 'Thermal Stability (Congo Red / Oven 190°C)', 'ISO 182-1 / ASTM D2115', 'Thermal Stability Strip / Oven', 'min', 'No rapid yellowing/degradation < 25 min'),
          makeTest(5, 'Hardness (Shore A / D Moulded Plaque)', 'ASTM D2240 / ISO 868', 'Durometer Gauge', 'Shore', 'Within ±3 Shore units of target spec'),
          makeTest(6, 'Trial Extrusion / Moulding Processability', 'ISO 9001 QMS / LG-CMP-05', 'Pilot Machine Verification', 'Pass/Fail', 'Smooth melt pressure, stable amperage, clean finish'),
        ],
      };

    default:
      return {
        productFamily: family,
        recommendedMachine,
        applicableStandards: ['ISO 9001 QMS', 'ISO 1183', 'ASTM D638', 'SAZS QMS'],
        defaultFormulation,
        tests: [
          makeTest(1, 'Visual Surface Finish & Colour Match', 'ISO 9001 QMS / LG-QC-01', 'Visual & Master Sample Check', 'Pass/Fail', 'Free of burn marks, voids, or colour streaking'),
          makeTest(2, 'Key Dimensional Verification', 'ISO 3126 / QMS-QC-02', 'Calibrated Caliper / Micrometer', 'mm', 'Within engineering drawing tolerance'),
          makeTest(3, 'Mechanical Strength / Drop Impact', 'ASTM D2444 / QMS-QC-03', 'Impact / Tensile / Crush Test', 'Pass/Fail', 'Passes mechanical integrity without fracture'),
          makeTest(4, 'Thermal Stability / Oven Stress Test', 'ISO 2505 / ISO 580', 'Air Oven Test', '%', 'Zero blistering, delamination or distortion'),
          makeTest(5, 'Density & Unit Weight Verification', 'ISO 1183 / ASTM D792', 'Digital Scale / Density Rig', 'kg / g/cm³', 'Matches baseline recipe mass ±2%'),
          makeTest(6, 'Functional Assembly / Customer Fit Test', 'ISO 9001 QMS / LG-QC-06', 'Gauge / Mating Part Check', 'Pass/Fail', '100% functional compliance'),
        ],
      };
  }
}

export interface TrialCompletenessStatus {
  isComplete: boolean;
  missingFields: string[];
  completedTestsCount: number;
  totalTestsCount: number;
}

export function checkQualityTrialCompleteness(
  trial: QualityTrialReport
): TrialCompletenessStatus {
  const missing: string[] = [];

  if (!trial.trialNo?.trim()) missing.push('Trial Report Number');
  if (!trial.date?.trim()) missing.push('Trial Date');
  if (!trial.product?.trim()) missing.push('Product Name');
  if (!trial.machine?.trim()) missing.push('Machine');
  if (!trial.trialCategory?.trim()) missing.push('Trial Category');
  if (!trial.objectiveSummary?.trim()) missing.push('Trial Objective / Hypothesis');

  if (
    trial.trialCategory === 'Scrap / Regrind Ratio' &&
    !trial.scrapRatioPct?.trim()
  ) {
    missing.push('Scrap / Regrind Ratio (%)');
  }
  if (
    (trial.trialCategory === 'Additive / Formula Change' ||
      trial.trialCategory === 'Masterbatch / Colourant') &&
    !trial.additiveDetails?.trim()
  ) {
    missing.push('Additive / Colourant Details');
  }
  if (
    trial.trialCategory === 'New Raw Material / Supplier' &&
    !trial.newMaterialSource?.trim()
  ) {
    missing.push('New Material / Supplier Source');
  }

  const validFormulation = (trial.formulationRows || []).filter(
    (r) => r.ingredientName?.trim() && r.ratioOrPhr?.trim()
  );
  if (validFormulation.length === 0) {
    missing.push('Formulation / Material Recipe (min 1 ingredient & ratio)');
  }

  const tests = trial.qcTests || [];
  let completedTestsCount = 0;
  tests.forEach((t) => {
    const hasResult = Boolean(t.actualResult?.trim());
    const hasVerdict = t.verdict === 'PASS' || t.verdict === 'FAIL';
    if (hasResult && hasVerdict) {
      completedTestsCount++;
    }
  });

  if (tests.length === 0) {
    missing.push('Quality Standard Tests (at least 1 test required)');
  } else if (completedTestsCount < tests.length) {
    missing.push(
      `Complete all QC test results & PASS/FAIL verdicts (${completedTestsCount}/${tests.length} done)`
    );
  }

  if (!trial.overallVerdict) {
    missing.push('Overall QA Trial Decision');
  }
  if (!trial.recommendations?.trim()) {
    missing.push('Technical Findings & Recommendations');
  }
  if (!trial.conductedByName?.trim()) {
    missing.push('Trial Conductor Full Name');
  }
  if (!trial.conductorSignature) {
    missing.push('Conductor Digital Signature');
  }

  return {
    isComplete: missing.length === 0,
    missingFields: missing,
    completedTestsCount,
    totalTestsCount: tests.length,
  };
}
