import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { TqmCapaRecord } from '../types';
import { saveFileBlob } from './downtimeCalc';
import { drawLgplastPdfHeader, ensureLgplastLogoLoaded } from './reportPdf';
import { TqmUnifiedSnapshot } from './tqmStore';

function applyPageFooters(doc: jsPDF, footerTitle: string) {
  const totalPages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const stamp = new Date().toLocaleString();

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(203, 213, 225);
    doc.line(10, pageHeight - 13, pageWidth - 10, pageHeight - 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `LG PLAST — ${footerTitle}  •  Generated ${stamp}`,
      10,
      pageHeight - 8
    );
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - 10, pageHeight - 8, { align: 'right' });
  }
}

function drawGovernanceSignatures(doc: jsPDF, preparedByName: string) {
  const pageHeight = doc.internal.pageSize.getHeight();
  let sigY = ((doc as any).lastAutoTable?.finalY || 200) + 10;
  const sigBoxH = 36;
  if (sigY + sigBoxH + 18 > pageHeight) {
    doc.addPage();
    sigY = 22;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 47, 102);
  doc.text('TQM MANAGEMENT REVIEW & GOVERNANCE SIGN-OFF', 10, sigY - 2.5);

  const colW = 61;
  const gap = 3.5;
  ['1. QUALITY ASSURANCE LEAD', '2. PRODUCTION HOD', '3. PLANT ADMINISTRATOR'].forEach(
    (label, idx) => {
      const x = 10 + idx * (colW + gap);
      doc.setDrawColor(148, 163, 184);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, sigY, colW, sigBoxH, 1.8, 1.8, 'FD');
      doc.setFillColor(15, 47, 102);
      doc.rect(x, sigY, colW, 6, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(255, 255, 255);
      doc.text(label, x + colW / 2, sigY + 4.1, { align: 'center' });
      doc.setTextColor(51, 65, 85);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(
        idx === 0 && preparedByName ? `Name: ${preparedByName.slice(0, 22)}` : 'Name: _____________________',
        x + 3.5,
        sigY + 13.5
      );
      doc.text('Sign:  _____________________', x + 3.5, sigY + 23.5);
      doc.text('Date:  ____ / ____ / 20____', x + 3.5, sigY + 32);
    }
  );
}

function addSectionTitle(doc: jsPDF, title: string, fallbackY = 38): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = ((doc as any).lastAutoTable?.finalY || fallbackY) + 7;
  if (y + 24 > pageHeight) {
    doc.addPage();
    y = 16;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  doc.setTextColor(15, 47, 102);
  doc.text(title, 10, y);
  return y + 2.5;
}

/**
 * 1. Complete Multi-Section TQM Executive & COPQ Audit Report PDF (Full Plant Audit)
 */
export async function generateTqmExecutivePdf(
  analytics: TqmUnifiedSnapshot,
  capas: TqmCapaRecord[],
  preparedByName: string
): Promise<void> {
  await ensureLgplastLogoLoaded();

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  drawLgplastPdfHeader(
    doc,
    'TOTAL QUALITY MANAGEMENT (TQM) AUDIT',
    'LG PLAST (PVT) LTD  •  PLANT-WIDE LINKED QUALITY, COPQ & CAPA REPORT',
    [
      `Period: ${analytics.periodLabel}`,
      `Prepared By: ${preparedByName || 'Quality / Admin'}`,
      `Generated: ${new Date().toLocaleDateString()}`,
    ]
  );

  // Section 1: Executive TQM Scorecard & COPQ
  autoTable(doc, {
    startY: 36,
    margin: { left: 10, right: 10 },
    head: [['PLANT TQM INDICATOR', 'ACTUAL VALUE', 'COST OF POOR QUALITY (COPQ) & LOOP', 'AMOUNT / QTY']],
    body: [
      [
        'Overall Plant TQM Index',
        `${analytics.overallTqmIndex}%`,
        'Scrap & Sweeping Loss ($1.25/kg)',
        `$${analytics.copqScrapLossUsd.toFixed(2)}`,
      ],
      [
        'First-Pass Quality Yield (FPY)',
        `${analytics.firstPassYieldPct}% (${analytics.totalQcFailHold} fail/hold)`,
        'Breakdown Downtime Loss ($28/hr)',
        `$${analytics.copqDowntimeLossUsd.toFixed(2)}`,
      ],
      [
        'Machine Availability',
        `${analytics.machineAvailabilityPct}%`,
        'QC Rejects & WH Variance Exposure',
        `$${analytics.copqQualityHoldLossUsd.toFixed(2)}`,
      ],
      [
        'Closed-Loop Regrind Recovery',
        `${analytics.closedLoopRecoveryPct}% (${analytics.usableRegrindProducedKg} kg)`,
        'Scrap Sales Revenue Recovered',
        `-$${analytics.scrapSalesRevenueUsd.toFixed(2)} (${analytics.scrapSoldNetKg} kg net)`,
      ],
      [
        'Monthly Plan Attainment',
        `${analytics.planAttainmentPct}% (${analytics.totalWhVariances} WH var)`,
        'NET UNRECOVERED COPQ EXPOSURE',
        `$${analytics.copqNetAfterRecoveryUsd.toFixed(2)}`,
      ],
    ],
    styles: {
      fontSize: 7.7,
      cellPadding: 2.1,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [15, 47, 102],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.3,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 48, fontStyle: 'bold' },
      1: { cellWidth: 46 },
      2: { cellWidth: 52, fontStyle: 'bold' },
      3: { cellWidth: 44, halign: 'right' },
    },
  });

  // Section 2: Ishikawa 6M & Auto-Detected Cross-Module Signals Summary
  const sigY = addSectionTitle(
    doc,
    `AUTO-DETECTED QUALITY SIGNALS (${analytics.detectedSignals.length}) & ISHIKAWA 6M`,
    88
  );
  autoTable(doc, {
    startY: sigY,
    margin: { left: 10, right: 10 },
    head: [['Severity', '6M', 'Date', 'Machine', 'Quality Signal / Anomaly', 'COPQ $', 'CAPA Link']],
    body: analytics.detectedSignals.length
      ? analytics.detectedSignals.slice(0, 25).map((s) => [
          s.severity,
          s.ishikawaCategory,
          s.date,
          s.machine,
          s.title,
          `$${s.estimatedCopqUsd.toFixed(2)}`,
          s.linkedCapa ? s.linkedCapa.capaNo : 'Unlinked',
        ])
      : [['—', '—', '—', '—', 'No quality anomalies flagged in selected audit window', '$0.00', 'Nominal']],
    styles: { fontSize: 7.1, cellPadding: 1.8, textColor: [15, 23, 42], lineColor: [203, 213, 225], lineWidth: 0.2 },
    headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.0 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 5: { halign: 'right' } },
  });

  // Section 3: Full Machine 360 Linked Risk Matrix (all machines with activity or all listed)
  const machY = addSectionTitle(doc, 'LINKED MACHINE 360 QUALITY & RELIABILITY MATRIX', 135);
  const allMachinesSorted = [...analytics.machineProfiles].sort((a, b) => a.qualityIndex - b.qualityIndex);
  autoTable(doc, {
    startY: machY,
    margin: { left: 10, right: 10 },
    head: [['Machine', 'TQM Idx', 'Avail %', 'BD Hrs', 'Prod (kg)', 'Scrap %', 'QC FPY %', 'Dispatch', 'WH Var', 'Open CAPA']],
    body: allMachinesSorted.length
      ? allMachinesSorted.map((m) => [
          m.machine,
          `${m.qualityIndex}%`,
          `${m.availabilityPct}%`,
          `${m.breakdownHrs}`,
          `${m.sopProdKg}`,
          `${m.scrapRatePct}%`,
          `${m.qcPassRatePct}%`,
          `${m.dispatchUnits}`,
          `${m.whVarianceCount}`,
          `${m.openCapaCount}`,
        ])
      : [['No machine profiles available', '-', '-', '-', '-', '-', '-', '-', '-', '-']],
    styles: { fontSize: 7.1, cellPadding: 1.8, textColor: [15, 23, 42], lineColor: [203, 213, 225], lineWidth: 0.2 },
    headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.0 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  // Section 4: Product & Dispatch End-to-End Traceability
  const prodY = addSectionTitle(
    doc,
    `PRODUCT & DISPATCH END-TO-END TRACEABILITY (${analytics.productProfiles.length} PRODUCTS)`
  );
  autoTable(doc, {
    startY: prodY,
    margin: { left: 10, right: 10 },
    head: [['Product', 'Line', 'Planned', 'Dispatched', 'Attain %', 'Prod (kg)', 'Scrap %', 'QC FPY %', 'Trials', 'CAPA']],
    body: analytics.productProfiles.length
      ? analytics.productProfiles.map((p) => [
          p.product,
          p.primaryMachine,
          `${p.plannedQty}`,
          `${p.dispatchedQty}`,
          p.plannedQty > 0 ? `${p.planAttainmentPct}%` : '—',
          `${p.sopProdKg}`,
          `${p.scrapPct}%`,
          `${p.qcPassRatePct}%`,
          p.trialsTotal > 0 ? `${p.trialsApproved}/${p.trialsTotal}` : '—',
          `${p.openCapaCount}`,
        ])
      : [['No product activity in selected period', '-', '-', '-', '-', '-', '-', '-', '-', '-']],
    styles: { fontSize: 7.0, cellPadding: 1.8, textColor: [15, 23, 42], lineColor: [203, 213, 225], lineWidth: 0.2 },
    headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.9 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  // Section 5: Shift Correlation & Closed-Loop Scrap / Utilities
  const shiftY = addSectionTitle(doc, 'SHIFT QUALITY CORRELATION, CLOSED-LOOP SCRAP & UTILITIES');
  autoTable(doc, {
    startY: shiftY,
    margin: { left: 10, right: 10 },
    head: [['Shift', 'Prod (kg)', 'Scrap (kg)', 'Scrap %', 'QC FPY %', 'BD (mins)', 'Avg Staff', 'Casuals %', 'Dispatched']],
    body: analytics.shiftCorrelation.map((s) => [
      `${s.shift} Shift`,
      `${s.sopProdKg}`,
      `${s.sopScrapKg}`,
      `${s.scrapPct}%`,
      `${s.qcPassRatePct}%`,
      `${s.breakdownMins}`,
      `${s.attendanceAvgHeadcount}`,
      `${s.casualRatioPct}%`,
      `${s.dispatchedQty}`,
    ]),
    styles: { fontSize: 7.2, cellPadding: 1.9, textColor: [15, 23, 42], lineColor: [203, 213, 225], lineWidth: 0.2 },
    headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.0 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  // Section 6: Full NCR / CAPA Register (all records)
  const capaY = addSectionTitle(
    doc,
    `CORRECTIVE & PREVENTIVE ACTION (CAPA) REGISTER (${capas.length} TOTAL)`
  );
  autoTable(doc, {
    startY: capaY,
    margin: { left: 10, right: 10 },
    head: [['CAPA No', 'Date', 'Machine / Product', '6M', 'Severity', 'Status', 'COPQ $', 'Owner']],
    body: capas.length
      ? capas.map((c) => [
          c.capaNo,
          c.date,
          `${c.machine} / ${c.product}`,
          c.ishikawaCategory,
          c.severity,
          c.status.replace(/_/g, ' '),
          `$${(c.estimatedCopqUsd || 0).toFixed(2)}`,
          c.ownerName || '-',
        ])
      : [['—', '—', 'No formal CAPAs raised yet', '—', '—', '—', '$0.00', '—']],
    styles: { fontSize: 7.1, cellPadding: 1.8, textColor: [15, 23, 42], lineColor: [203, 213, 225], lineWidth: 0.2 },
    headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.0 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 6: { halign: 'right' } },
  });

  drawGovernanceSignatures(doc, preparedByName);
  applyPageFooters(doc, `Total Quality Management Audit (${analytics.periodLabel})`);

  saveFileBlob(
    `LGPLAST_TQM_Executive_Audit_${analytics.fromDate}_to_${analytics.toDate}.pdf`,
    doc.output('blob')
  );
}

/**
 * 2. Dedicated Machine 360 Reliability & Quality Audit Report PDF
 */
export async function generateTqmMachineMatrixPdf(
  analytics: TqmUnifiedSnapshot,
  preparedByName: string,
  focusMachine?: string
): Promise<void> {
  await ensureLgplastLogoLoaded();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  drawLgplastPdfHeader(
    doc,
    focusMachine
      ? `TQM MACHINE AUDIT — ${focusMachine.toUpperCase()}`
      : 'TQM MACHINE 360 RELIABILITY & QUALITY REPORT',
    `LG PLAST (PVT) LTD  •  DOWNTIME, POWER LINKS, SCRAP %, QC FPY & DISPATCH (${analytics.periodLabel})`,
    [
      `Period: ${analytics.periodLabel}`,
      `Prepared By: ${preparedByName || 'Quality / Admin'}`,
      `Plant Availability: ${analytics.machineAvailabilityPct}%`,
    ]
  );

  const rows = [...analytics.machineProfiles]
    .filter((m) => !focusMachine || m.machine === focusMachine)
    .sort((a, b) => a.qualityIndex - b.qualityIndex);

  autoTable(doc, {
    startY: 36,
    margin: { left: 10, right: 10 },
    head: [
      [
        'Machine / Line',
        'TQM Index',
        'Avail %',
        'Run Hrs',
        'BD Hrs',
        'CO Hrs',
        'Power Stops',
        'Prod Qty',
        'Prod (kg)',
        'Scrap (kg)',
        'Waste (kg)',
        'Scrap %',
        'QC Checks',
        'QC FPY %',
        'Dispatch',
        'WH Var',
        'Open CAPA',
      ],
    ],
    body: rows.length
      ? rows.map((m) => [
          m.machine,
          `${m.qualityIndex}%`,
          `${m.availabilityPct}%`,
          `${m.runHrs}`,
          `${m.breakdownHrs}`,
          `${m.changeoverHrs}`,
          `${m.powerOutageLinkedCount}`,
          `${m.sopProdQty}`,
          `${m.sopProdKg}`,
          `${m.sopScrapKg}`,
          `${m.wastageKg}`,
          `${m.scrapRatePct}%`,
          `${m.qcChecksCount}`,
          `${m.qcPassRatePct}%`,
          `${m.dispatchUnits}`,
          `${m.whVarianceCount}`,
          `${m.openCapaCount}`,
        ])
      : [['No machine profiles found in selected audit window', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-']],
    styles: { fontSize: 7.2, cellPadding: 1.8, textColor: [15, 23, 42], lineColor: [203, 213, 225], lineWidth: 0.2 },
    headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.9 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  const sigs = analytics.detectedSignals.filter(
    (s) => !focusMachine || s.machine === focusMachine
  );
  if (sigs.length > 0) {
    const nextY = addSectionTitle(doc, `ACTIVE QUALITY SIGNALS ON MACHINE(S) (${sigs.length})`, 90);
    autoTable(doc, {
      startY: nextY,
      margin: { left: 10, right: 10 },
      head: [['Date', 'Shift', 'Machine', 'Severity', '6M', 'Signal', 'Summary', 'Est. COPQ $', 'CAPA']],
      body: sigs.map((s) => [
        s.date,
        s.shift,
        s.machine,
        s.severity,
        s.ishikawaCategory,
        s.title,
        s.summary,
        `$${s.estimatedCopqUsd.toFixed(2)}`,
        s.linkedCapa ? s.linkedCapa.capaNo : 'Unlinked',
      ]),
      styles: { fontSize: 7.2, cellPadding: 1.8, textColor: [15, 23, 42] },
      headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });
  }

  applyPageFooters(doc, `Machine 360 Quality Audit (${analytics.periodLabel})`);
  const slug = focusMachine ? focusMachine.replace(/[^a-zA-Z0-9_-]+/g, '_') : 'All_Machines';
  saveFileBlob(
    `LGPLAST_TQM_Machine_360_${slug}_${analytics.fromDate}_to_${analytics.toDate}.pdf`,
    doc.output('blob')
  );
}

/**
 * 3. Dedicated Product & Dispatch End-to-End Traceability Report PDF
 */
export async function generateTqmProductTracePdf(
  analytics: TqmUnifiedSnapshot,
  preparedByName: string
): Promise<void> {
  await ensureLgplastLogoLoaded();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  drawLgplastPdfHeader(
    doc,
    'TQM PRODUCT & DISPATCH TRACEABILITY REPORT',
    `LG PLAST (PVT) LTD  •  PLANNING → PRODUCTION → QC → TRIALS → WH DISPATCH (${analytics.periodLabel})`,
    [
      `Period: ${analytics.periodLabel}`,
      `Prepared By: ${preparedByName || 'Quality / Admin'}`,
      `Plan Attainment: ${analytics.planAttainmentPct}%`,
    ]
  );

  autoTable(doc, {
    startY: 36,
    margin: { left: 10, right: 10 },
    head: [
      [
        'Product',
        'Primary Line',
        'Planned Qty',
        'Dispatched Qty',
        'Dispatched (kg)',
        'Attain %',
        'SOP Prod (kg)',
        'Scrap+Waste (kg)',
        'Scrap %',
        'QC Checks',
        'QC FPY %',
        'Trials Pass',
        'Special Qty',
        'WH Var',
        'Open CAPA',
      ],
    ],
    body: analytics.productProfiles.length
      ? analytics.productProfiles.map((p) => [
          p.product,
          p.primaryMachine,
          p.plannedQty.toLocaleString(),
          p.dispatchedQty.toLocaleString(),
          `${p.dispatchedKg}`,
          p.plannedQty > 0 ? `${p.planAttainmentPct}%` : '—',
          `${p.sopProdKg}`,
          `${p.sopScrapKg}`,
          `${p.scrapPct}%`,
          `${p.qcTotalChecks}`,
          `${p.qcPassRatePct}%`,
          p.trialsTotal > 0 ? `${p.trialsApproved}/${p.trialsTotal}` : '—',
          `${p.specialOrderQty}`,
          `${p.whVarianceCount}`,
          `${p.openCapaCount}`,
        ])
      : [['No product production, QC, or dispatch activity in period', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-']],
    styles: { fontSize: 7.3, cellPadding: 1.9, textColor: [15, 23, 42], lineColor: [203, 213, 225], lineWidth: 0.2 },
    headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.0 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  applyPageFooters(doc, `Product Traceability Audit (${analytics.periodLabel})`);
  saveFileBlob(
    `LGPLAST_TQM_Product_Traceability_${analytics.fromDate}_to_${analytics.toDate}.pdf`,
    doc.output('blob')
  );
}

/**
 * 4. Dedicated Shift, Staffing & Closed-Loop Scrap / Utilities Report PDF
 */
export async function generateTqmShiftAndLoopPdf(
  analytics: TqmUnifiedSnapshot,
  preparedByName: string
): Promise<void> {
  await ensureLgplastLogoLoaded();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  drawLgplastPdfHeader(
    doc,
    'SHIFT, CLOSED-LOOP SCRAP & UTILITIES TQM REPORT',
    `LG PLAST (PVT) LTD  •  DAY/NIGHT CORRELATION, RECYCLING, MIXING & FUEL GOVERNANCE`,
    [
      `Period: ${analytics.periodLabel}`,
      `Prepared By: ${preparedByName || 'Quality / Admin'}`,
      `Recovery: ${analytics.closedLoopRecoveryPct}%`,
    ]
  );

  autoTable(doc, {
    startY: 36,
    margin: { left: 10, right: 10 },
    head: [['Shift', 'Prod (kg)', 'Scrap (kg)', 'Scrap %', 'QC FPY %', 'BD (mins)', 'Avg Staff', 'Casuals %', 'Dispatched']],
    body: analytics.shiftCorrelation.map((s) => [
      `${s.shift} Shift`,
      s.sopProdKg.toLocaleString(),
      s.sopScrapKg.toLocaleString(),
      `${s.scrapPct}%`,
      `${s.qcPassRatePct}%`,
      `${s.breakdownMins}`,
      `${s.attendanceAvgHeadcount}`,
      `${s.casualRatioPct}%`,
      s.dispatchedQty.toLocaleString(),
    ]),
    styles: { fontSize: 7.8, cellPadding: 2.2, textColor: [15, 23, 42] },
    headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  const loopY = addSectionTitle(doc, 'CLOSED-LOOP SCRAP, RECYCLING, MIXING & SALES LEDGER', 85);
  autoTable(doc, {
    startY: loopY,
    margin: { left: 10, right: 10 },
    head: [['Material / Closed-Loop Stage', 'Period Total / Metric']],
    body: [
      ['Floor Production Scrap + Wastage Logged', `${(analytics.totalSopScrapKg + analytics.totalWastageKg).toLocaleString()} kg`],
      ['Sent to Recycling Pipeline', `${analytics.scrapSentToRecyclingKg.toLocaleString()} kg`],
      ['Usable Regrind Produced (Recovery Rate)', `${analytics.usableRegrindProducedKg.toLocaleString()} kg (${analytics.closedLoopRecoveryPct}%)`],
      ['Recycling Process Waste Rejected', `${analytics.recyclingWasteKg.toLocaleString()} kg`],
      ['Mixer Consumed (WH Virgin / Regrind Used)', `${analytics.mixerWhUsedKg.toLocaleString()} kg WH / ${analytics.mixerScrapUsedKg.toLocaleString()} kg Regrind (${analytics.mixerBatchesTotal} batches)`],
      ['Floor & Mixer Sweepings Accumulated', `${analytics.mixerSweepingKg.toLocaleString()} kg`],
      ['External Recycling Scrap Sales (Gross / Net / Revenue)', `${analytics.scrapSoldGrossKg.toLocaleString()} kg gross / ${analytics.scrapSoldNetKg.toLocaleString()} kg net · $${analytics.scrapSalesRevenueUsd.toFixed(2)}`],
    ],
    styles: { fontSize: 8, cellPadding: 2.3, textColor: [15, 23, 42] },
    headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 96 }, 1: { halign: 'right' } },
  });

  const utilY = addSectionTitle(doc, 'UTILITIES RELIABILITY & DIESEL FUEL GOVERNANCE', 145);
  autoTable(doc, {
    startY: utilY,
    margin: { left: 10, right: 10 },
    head: [['Utility / Fuel Metric', 'Period Measurement']],
    body: [
      ['Mains / ZESA Power Cuts Recorded', `${analytics.powerCutCount} outages · ${analytics.powerCutHours} hrs`],
      ['Backup Generator Runtime & Fuel Consumed', `${analytics.generatorRunHours} hrs · ${analytics.generatorFuelLitres} L`],
      ['Diesel Bowser Fuel Issued (Period)', `${analytics.dieselIssuedLitres} L`],
      ['Bulk Diesel GRNs Received (Period)', `${analytics.dieselReceivedLitres} L`],
      ['Live Bowser Tank Stock Level', `${analytics.dieselTankLevelLitres} L`],
    ],
    styles: { fontSize: 8, cellPadding: 2.3, textColor: [15, 23, 42] },
    headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 96 }, 1: { halign: 'right' } },
  });

  drawGovernanceSignatures(doc, preparedByName);
  applyPageFooters(doc, `Shift & Closed-Loop Scrap Audit (${analytics.periodLabel})`);
  saveFileBlob(
    `LGPLAST_TQM_Shift_ClosedLoop_${analytics.fromDate}_to_${analytics.toDate}.pdf`,
    doc.output('blob')
  );
}

/**
 * 5. Dedicated NCR / CAPA Master Register Report PDF
 */
export async function generateTqmCapaRegisterPdf(
  analytics: TqmUnifiedSnapshot,
  capas: TqmCapaRecord[],
  preparedByName: string
): Promise<void> {
  await ensureLgplastLogoLoaded();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  drawLgplastPdfHeader(
    doc,
    'LINKED NCR & CAPA MASTER REGISTER REPORT',
    `LG PLAST (PVT) LTD  •  ISO 9001 NON-CONFORMANCE, 5-WHY ROOT CAUSE & CLOSURE AUDIT`,
    [
      `Window: ${analytics.periodLabel}`,
      `Total CAPAs: ${capas.length} (${analytics.closedCapaCount} Closed)`,
      `Closure Rate: ${analytics.capaClosureRatePct}%`,
    ]
  );

  autoTable(doc, {
    startY: 36,
    margin: { left: 10, right: 10 },
    head: [
      [
        'CAPA No',
        'Date',
        'Status',
        'Severity',
        '6M',
        'Machine / Product',
        'Problem & 5-Why Root Cause',
        'Corrective & Preventive Action',
        'COPQ $',
        'Owner / Due',
      ],
    ],
    body: capas.length
      ? capas.map((c) => [
          c.capaNo,
          `${c.date}\n(${c.shift})`,
          c.status.replace(/_/g, ' '),
          c.severity,
          c.ishikawaCategory,
          `${c.machine}\n${c.product}`,
          `${c.title}\n${c.problemStatement}${c.rootCause5Why ? `\n5-Why: ${c.rootCause5Why}` : ''}`,
          `CA: ${c.correctiveAction || '—'}\nPA: ${c.preventiveAction || '—'}`,
          `$${(c.estimatedCopqUsd || 0).toFixed(2)}`,
          `${c.ownerName || '—'}\nDue: ${c.targetDueDate}`,
        ])
      : [['—', '—', '—', '—', '—', '—', 'No formal CAPAs logged yet', '—', '$0.00', '—']],
    styles: { fontSize: 7.0, cellPadding: 1.8, textColor: [15, 23, 42], lineColor: [203, 213, 225], lineWidth: 0.2 },
    headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.9 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 8: { halign: 'right' } },
  });

  applyPageFooters(doc, `NCR & CAPA Master Register (${capas.length} records)`);
  saveFileBlob(
    `LGPLAST_TQM_CAPA_Register_${analytics.fromDate}_to_${analytics.toDate}.pdf`,
    doc.output('blob')
  );
}

/**
 * 6. Individual Linked NCR / CAPA Audit Certificate PDF with digital signatures.
 */
export async function generateTqmCapaPdf(capa: TqmCapaRecord): Promise<void> {
  await ensureLgplastLogoLoaded();

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageHeight = doc.internal.pageSize.getHeight();

  drawLgplastPdfHeader(
    doc,
    'NON-CONFORMANCE & CAPA REPORT',
    'LG PLAST (PVT) LTD  •  ISO 9001 / TQM CORRECTIVE & PREVENTIVE ACTION',
    [
      `CAPA No: ${capa.capaNo}`,
      `Status: ${capa.status.replace(/_/g, ' ')}`,
      `Severity: ${capa.severity}`,
    ]
  );

  autoTable(doc, {
    startY: 36,
    margin: { left: 10, right: 10 },
    head: [['CAPA METADATA', 'OPERATIONAL CONTEXT']],
    body: [
      [`Title: ${capa.title}`, `Machine: ${capa.machine}`],
      [`Date / Shift: ${capa.date} (${capa.shift})`, `Product: ${capa.product}`],
      [`Ishikawa 6M Root Category: ${capa.ishikawaCategory}`, `Action Owner: ${capa.ownerName}`],
      [
        `Est. COPQ Impact: $${(capa.estimatedCopqUsd || 0).toFixed(2)}`,
        `Target Due Date: ${capa.targetDueDate}`,
      ],
      [
        `Scrap / Downtime: ${capa.scrapImpactKg} kg / ${capa.downtimeImpactMins} mins`,
        `Raised By: ${capa.raisedByName}`,
      ],
    ],
    styles: { fontSize: 8, cellPadding: 2.3, textColor: [15, 23, 42] },
    headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold' },
  });

  const y1 = ((doc as any).lastAutoTable?.finalY || 82) + 5;
  autoTable(doc, {
    startY: y1,
    margin: { left: 10, right: 10 },
    head: [['TQM ROOT CAUSE & ACTION PLAN', 'DOCUMENTED DETAILS']],
    body: [
      ['Problem Statement', capa.problemStatement || '—'],
      ['5-Why Root Cause Analysis', capa.rootCause5Why || 'Pending analysis'],
      ['Immediate Containment', capa.containmentAction || 'Pending containment'],
      ['Corrective Action Plan', capa.correctiveAction || 'Pending action'],
      ['Preventive / Systemic Control', capa.preventiveAction || 'Pending systemic control'],
      [
        'Linked Plant Records',
        capa.linkedRefs.length
          ? capa.linkedRefs.map((r) => `[${r.module}] ${r.label}`).join('\n')
          : 'No specific record IDs attached',
      ],
      ['HOD Verification Notes', capa.verificationNotes || 'Pending HOD closure verification'],
    ],
    styles: { fontSize: 8, cellPadding: 2.5, textColor: [15, 23, 42] },
    headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 52, fontStyle: 'bold' }, 1: { cellWidth: 138 } },
  });

  let sigY = ((doc as any).lastAutoTable?.finalY || 175) + 8;
  if (sigY + 46 > pageHeight) {
    doc.addPage();
    sigY = 20;
  }

  const sigBoxes = [
    {
      title: 'RAISED BY (QUALITY / FLOOR)',
      name: capa.raisedByName,
      sig: capa.raisedSignature,
      date: capa.raisedAt?.slice(0, 10) || capa.date,
    },
    {
      title: 'HOD / ADMIN VERIFICATION & CLOSURE',
      name: capa.verifiedByHodName || 'Pending Verification',
      sig: capa.verifiedSignature,
      date: capa.verifiedAt?.slice(0, 10) || '____ / ____ / 20____',
    },
  ];

  sigBoxes.forEach((box, idx) => {
    const x = 10 + idx * 97;
    doc.setDrawColor(148, 163, 184);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, sigY, 93, 44, 2, 2, 'FD');
    doc.setFillColor(15, 47, 102);
    doc.rect(x, sigY, 93, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.4);
    doc.setTextColor(255, 255, 255);
    doc.text(box.title, x + 46.5, sigY + 4.1, { align: 'center' });
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(7.6);
    doc.text(`Name: ${box.name}`, x + 4, sigY + 12.5);
    if (box.sig) {
      try {
        doc.addImage(box.sig, 'PNG', x + 10, sigY + 15, 73, 18);
      } catch {}
    } else {
      doc.setDrawColor(148, 163, 184);
      doc.line(x + 6, sigY + 32, x + 87, sigY + 32);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.text(`Date: ${box.date}`, x + 4, sigY + 40);
  });

  applyPageFooters(doc, `TQM CAPA (${capa.capaNo})`);
  saveFileBlob(`LGPLAST_TQM_${capa.capaNo}_${capa.date}.pdf`, doc.output('blob'));
}
