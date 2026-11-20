import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { QualityTrialReport, normalizeMachineName } from '../types';
import { checkQualityTrialCompleteness } from './qualityTrialTemplates';
import { drawLgplastPdfHeader, ensureLgplastLogoLoaded } from './reportPdf';

/**
 * Generates Official LG PLAST Quality Trial Report PDF (Portrait A4).
 * Strictly locked until ALL trial information & QC tests are complete.
 * Engineered to fit on 1 page preferred (never exceeding 2 pages).
 */
export async function generateQualityTrialPdf(
  trial: QualityTrialReport
): Promise<{ ok: boolean; error?: string }> {
  const completeness = checkQualityTrialCompleteness(trial);
  if (!completeness.isComplete) {
    return {
      ok: false,
      error: `Complete all required fields before generating PDF: ${completeness.missingFields[0]}`,
    };
  }

  await ensureLgplastLogoLoaded();

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 9;
  const contentWidth = pageWidth - marginX * 2;

  // Compact spacing density based on test + formulation row count to prefer 1 page cleanly
  const totalTableRows =
    (trial.formulationRows?.length || 0) + (trial.qcTests?.length || 0);
  const ultraCompact = totalTableRows > 12;
  const cellPad = ultraCompact ? 1.25 : 1.55;
  const tblFont = ultraCompact ? 6.6 : 7.0;

  drawLgplastPdfHeader(
    doc,
    'QUALITY CONTROL TRIAL & COMPLIANCE REPORT',
    `QMS FORM ${trial.qmsDocCode} · CONFORMANCE: ${trial.applicableStandards.slice(0, 4).join(' / ')}`,
    [
      `Trial No: ${trial.trialNo}`,
      `Date: ${trial.date} (${trial.shift})`,
      `Decision: ${trial.overallVerdict.replace(/_/g, ' ')}`,
    ]
  );

  // Sub-banner: Applicable Standards & Product Family
  doc.setFillColor(241, 245, 249);
  doc.rect(marginX, 33, contentWidth, 6.8, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.rect(marginX, 33, contentWidth, 6.8, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.setTextColor(15, 47, 102);
  doc.text(`PRODUCT: ${trial.product}`, marginX + 2.5, 37.3, { maxWidth: 112 });
  doc.setTextColor(51, 65, 85);
  doc.text(
    `FAMILY: ${trial.productFamily}  |  MACHINE: ${normalizeMachineName(trial.machine)}`,
    pageWidth - marginX - 2.5,
    37.3,
    { align: 'right' }
  );

  // 1. Compact Trial Particulars Grid
  autoTable(doc, {
    startY: 41.2,
    margin: { left: marginX, right: marginX },
    head: [['Trial & Material Parameter', 'Recorded Value', 'Process & Standards Parameter', 'Recorded Value']],
    body: [
      [
        'Trial Category',
        trial.trialCategory,
        'Applicable Standards',
        trial.applicableStandards.join(', '),
      ],
      [
        'Objective / Scope',
        trial.objectiveSummary,
        'Scrap / Regrind Ratio',
        trial.scrapRatioPct?.trim() || '0% (Virgin Base / N/A)',
      ],
      [
        'Additive / Colourant',
        trial.additiveDetails?.trim() || 'Standard Recipe',
        'New Material / Supplier',
        trial.newMaterialSource?.trim() || 'Approved Current Vendor',
      ],
      [
        'Temp / Process Profile',
        trial.machineTempProfile?.trim() || 'Standard Zone Setpoints',
        'Output / Cycle Rate',
        trial.extrusionOrCycleRate?.trim() || 'Standard Nominal Rate',
      ],
    ],
    styles: {
      fontSize: 6.7,
      cellPadding: cellPad,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: [15, 47, 102],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 6.8,
    },
    columnStyles: {
      0: { cellWidth: 34, fontStyle: 'bold', fillColor: [248, 250, 252] },
      1: { cellWidth: 62 },
      2: { cellWidth: 36, fontStyle: 'bold', fillColor: [248, 250, 252] },
      3: { cellWidth: 60 },
    },
  });

  // 2. Formulation & Scrap / Additive Recipe Table
  const afterMetaY = ((doc as any).lastAutoTable?.finalY || 74) + 2.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.6);
  doc.setTextColor(15, 47, 102);
  doc.text('1. TRIAL FORMULATION, ADDITIVE & SCRAP RATIO COMPOSITION', marginX, afterMetaY);

  autoTable(doc, {
    startY: afterMetaY + 1.4,
    margin: { left: marginX, right: marginX },
    head: [['Component / Material Name', 'Classification / Role', 'Ratio / PHR / %', 'Batch Qty (kg)', 'Supplier / Lot Ref']],
    body: trial.formulationRows.map((r) => [
      r.ingredientName,
      r.role,
      r.ratioOrPhr,
      r.batchQtyKg?.trim() || '—',
      r.supplierOrLot?.trim() || '—',
    ]),
    styles: {
      fontSize: tblFont,
      cellPadding: cellPad,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: tblFont,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  // 3. Quality Control Laboratory & Inspection Tests (ISO / QMS / ASTM / SAZ)
  const afterFormY = ((doc as any).lastAutoTable?.finalY || 110) + 2.8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.6);
  doc.setTextColor(15, 47, 102);
  doc.text(
    '2. QUALITY CONTROL TEST MATRIX & STANDARDS CONFORMANCE (ISO / QMS / ASTM / SAZ)',
    marginX,
    afterFormY
  );

  autoTable(doc, {
    startY: afterFormY + 1.4,
    margin: { left: marginX, right: marginX },
    head: [['#', 'Quality Parameter / Test', 'Standard Ref', 'Method', 'Spec Requirement', 'Actual Result', 'Verdict']],
    body: trial.qcTests.map((t, idx) => [
      String(idx + 1),
      t.testName,
      t.standardRef,
      t.method,
      t.specRequirement,
      `${t.actualResult}${t.unit && t.unit !== 'Pass/Fail' && t.unit !== 'Visual' ? ` ${t.unit}` : ''}`,
      t.verdict,
    ]),
    styles: {
      fontSize: tblFont,
      cellPadding: cellPad,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: [15, 47, 102],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: tblFont,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 6, halign: 'center' },
      1: { cellWidth: 40, fontStyle: 'bold' },
      2: { cellWidth: 30 },
      3: { cellWidth: 28 },
      4: { cellWidth: 40 },
      5: { cellWidth: 32, fontStyle: 'bold' },
      6: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 6) {
        const val = String(data.cell.raw || '');
        if (val === 'PASS') {
          data.cell.styles.textColor = [4, 120, 87];
          data.cell.styles.fillColor = [236, 253, 245];
        } else if (val === 'FAIL') {
          data.cell.styles.textColor = [190, 18, 60];
          data.cell.styles.fillColor = [255, 241, 242];
        }
      }
    },
  });

  // 4. QA Disposition, Recommendations & 7-Tier Approval Signatures Hierarchy
  // (Keep cleanly on Page 1 if it fits, otherwise Page 2 max)
  let footerStartY = ((doc as any).lastAutoTable?.finalY || 185) + 2.8;
  const neededFooterHeight = 52;
  if (footerStartY + neededFooterHeight > pageHeight - 9) {
    doc.addPage();
    drawLgplastPdfHeader(
      doc,
      'QUALITY TRIAL QA DISPOSITION & SIGN-OFF',
      `${trial.qmsDocCode} · Trial No: ${trial.trialNo} (Page 2 of 2)`,
      [`Trial No: ${trial.trialNo}`, `Product: ${trial.product.slice(0, 22)}`, `Date: ${trial.date}`]
    );
    footerStartY = 36;
  }

  const passCount = trial.qcTests.filter((q) => q.verdict === 'PASS').length;
  const failCount = trial.qcTests.filter((q) => q.verdict === 'FAIL').length;

  // Disposition & Findings Box (Compact 13.5mm)
  const isApproved = trial.overallVerdict === 'APPROVED_FOR_PRODUCTION';
  const isRejected = trial.overallVerdict === 'REJECTED_HOLD';
  doc.setFillColor(
    isApproved ? 236 : isRejected ? 255 : 255,
    isApproved ? 253 : isRejected ? 241 : 251,
    isApproved ? 245 : isRejected ? 242 : 235
  );
  doc.setDrawColor(
    isApproved ? 16 : isRejected ? 225 : 217,
    isApproved ? 185 : isRejected ? 29 : 119,
    isApproved ? 129 : isRejected ? 72 : 6
  );
  doc.roundedRect(marginX, footerStartY, contentWidth, 13.5, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(15, 23, 42);
  doc.text(
    `3. QA RELEASE DECISION: ${trial.overallVerdict.replace(/_/g, ' ')}   (Tests Passed: ${passCount}/${trial.qcTests.length}${failCount > 0 ? ` · Failed: ${failCount}` : ''})`,
    marginX + 2.5,
    footerStartY + 4.2
  );
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.6);
  doc.setTextColor(51, 65, 85);
  doc.text(
    `Technical Recommendations: ${trial.recommendations}`,
    marginX + 2.5,
    footerStartY + 8.3,
    { maxWidth: contentWidth - 5 }
  );

  // 4. 7-Tier Approval Signatures Arranged Strictly by Hierarchy of Importance
  const sigHeaderY = footerStartY + 16.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.3);
  doc.setTextColor(15, 47, 102);
  doc.text(
    '4. OFFICIAL TRIAL APPROVAL & SIGN-OFF HIERARCHY (ARRANGED BY IMPORTANCE)',
    marginX,
    sigHeaderY
  );

  const approvals = trial.trialApprovals || {};
  const row1Roles = [
    {
      rank: '1. FACTORY MANAGER',
      sub: 'Final Executive Approval',
      name: approvals.factoryManager?.name || '',
      sig: approvals.factoryManager?.signature || '',
      date: approvals.factoryManager?.signedAt
        ? new Date(approvals.factoryManager.signedAt).toLocaleDateString()
        : '',
    },
    {
      rank: '2. PRODUCTION HOD',
      sub: 'Production Head Approval',
      name: approvals.productionHod?.name || trial.reviewedByHodName || '',
      sig: approvals.productionHod?.signature || trial.hodSignature || '',
      date: (approvals.productionHod?.signedAt || trial.hodReviewedAt)
        ? new Date(approvals.productionHod?.signedAt || trial.hodReviewedAt!).toLocaleDateString()
        : '',
    },
    {
      rank: '3. TECHNICAL HEAD',
      sub: 'Formulation & Engineering',
      name: approvals.technicalHead?.name || '',
      sig: approvals.technicalHead?.signature || '',
      date: approvals.technicalHead?.signedAt
        ? new Date(approvals.technicalHead.signedAt).toLocaleDateString()
        : '',
    },
    {
      rank: '4. DEPARTMENT HEAD',
      sub: 'Section Head Review',
      name: approvals.departmentHead?.name || '',
      sig: approvals.departmentHead?.signature || '',
      date: approvals.departmentHead?.signedAt
        ? new Date(approvals.departmentHead.signedAt).toLocaleDateString()
        : '',
    },
  ];

  const row2Roles = [
    {
      rank: '5. QUALITY CONTROL (QC)',
      sub: 'ISO / ASTM / SAZ Lab Verify',
      name: approvals.qc?.name || trial.conductedByName || '',
      sig: approvals.qc?.signature || trial.conductorSignature || '',
      date: (approvals.qc?.signedAt || trial.conductedAt)
        ? new Date(approvals.qc?.signedAt || trial.conductedAt).toLocaleDateString()
        : '',
    },
    {
      rank: '6. ELECTRICAL HEAD',
      sub: 'Heaters, Drives & Power',
      name: approvals.electricalHead?.name || '',
      sig: approvals.electricalHead?.signature || '',
      date: approvals.electricalHead?.signedAt
        ? new Date(approvals.electricalHead.signedAt).toLocaleDateString()
        : '',
    },
    {
      rank: '7. MACHINE OPERATOR',
      sub: 'Floor Trial Execution',
      name: approvals.operator?.name || '',
      sig: approvals.operator?.signature || '',
      date: approvals.operator?.signedAt
        ? new Date(approvals.operator.signedAt).toLocaleDateString()
        : '',
    },
  ];

  const drawSignatureGridRow = (
    items: typeof row1Roles,
    startY: number,
    boxHeight: number
  ) => {
    const gap = 2;
    const boxW = (contentWidth - gap * (items.length - 1)) / items.length;
    items.forEach((item, i) => {
      const bx = marginX + i * (boxW + gap);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(148, 163, 184);
      doc.setLineWidth(0.2);
      doc.roundedRect(bx, startY, boxW, boxHeight, 1.2, 1.2, 'FD');

      // Top dark navy rank bar
      doc.setFillColor(15, 47, 102);
      doc.rect(bx, startY, boxW, 4.2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.7);
      doc.setTextColor(255, 255, 255);
      doc.text(item.rank, bx + 1.5, startY + 2.9, { maxWidth: boxW - 3 });

      doc.setFont('helvetica', 'italic');
      doc.setFontSize(5.2);
      doc.setTextColor(71, 85, 105);
      doc.text(item.sub, bx + 1.5, startY + 6.7, { maxWidth: boxW - 3 });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.setTextColor(15, 23, 42);
      doc.text(
        `Name: ${item.name ? item.name.slice(0, 20) : '__________________'}`,
        bx + 1.5,
        startY + 9.8
      );

      if (item.sig) {
        try {
          doc.addImage(item.sig, 'PNG', bx + 8, startY + 10.3, Math.min(24, boxW - 12), 5.6);
        } catch {}
      } else {
        doc.text('Sign: ___________________', bx + 1.5, startY + 14.3);
      }

      doc.setFontSize(5.3);
      doc.setTextColor(71, 85, 105);
      doc.text(
        `Date: ${item.date || '____/____/20__'}`,
        bx + 1.5,
        startY + boxHeight - 1.3
      );
    });
  };

  drawSignatureGridRow(row1Roles, sigHeaderY + 1.5, 17.5);
  drawSignatureGridRow(row2Roles, sigHeaderY + 20.5, 17.5);

  // Page footer stamp across all generated pages (1 or max 2)
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `LG PLAST QMS Controlled Trial Record (${trial.qmsDocCode}) · ISO 9001 / ISO / ASTM / SAZ Compliant · Page ${p} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 4.5,
      { align: 'center' }
    );
  }

  const safeName = trial.product.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 32);
  doc.save(`LGPLAST_QMS_Trial_${trial.trialNo}_${safeName}.pdf`);
  return { ok: true };
}
