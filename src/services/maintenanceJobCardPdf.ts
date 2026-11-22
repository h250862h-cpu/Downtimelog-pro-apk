import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { MaintenanceJobCard, normalizeMachineName } from '../types';
import {
  ENGINEER_REPLACEMENT_POLICY_TEXT,
  countEngineerSignatures,
  getCardTypeLabel,
} from './maintenanceJobCardTemplates';
import { drawLgplastPdfHeader, ensureLgplastLogoLoaded } from './reportPdf';

function getPdfBannerTitle(card: MaintenanceJobCard): string {
  switch (card.cardType) {
    case 'EXTRUSION_DIE_CHANGE':
      return 'EXTRUSION DIE CHANGE JOB CARD (UP TO STORAGE)';
    case 'INJECTION_MOULD_CHANGE':
      return 'INJECTION MOULD CHANGE JOB CARD (UP TO STORAGE)';
    case 'STANDARD_MAINTENANCE':
    default:
      return 'STANDARD MAINTENANCE JOB CARD';
  }
}

/**
 * Generates an official LG PLAST Maintenance / Die & Mould Change Job Card PDF (Portrait A4)
 * featuring the LG PLAST logo banner, step-by-step execution/storage stages & log, spares table,
 * the mandatory 2-3 Engineer Replacement Authorization Policy notice, and 5 signature boxes.
 */
export async function generateMaintenanceJobCardPdf(
  card: MaintenanceJobCard
): Promise<{ ok: boolean; error?: string }> {
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
  const isToolingCard =
    card.cardType === 'EXTRUSION_DIE_CHANGE' || card.cardType === 'INJECTION_MOULD_CHANGE';

  drawLgplastPdfHeader(
    doc,
    getPdfBannerTitle(card),
    `${card.docCode} · ${getCardTypeLabel(card.cardType).toUpperCase()}`,
    [
      `Job Card No: ${card.jobCardNo}`,
      `Date: ${card.date} (${card.shift})`,
      `Priority: ${card.priority.replace(/_/g, ' ')}`,
    ]
  );

  // Sub-banner strip
  doc.setFillColor(241, 245, 249);
  doc.rect(marginX, 33, contentWidth, 6.5, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.rect(marginX, 33, contentWidth, 6.5, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.setTextColor(15, 47, 102);
  doc.text(
    `MACHINE: ${normalizeMachineName(card.machine)}  (${card.department || 'Plant'})`,
    marginX + 2.5,
    37.2,
    { maxWidth: 108 }
  );
  doc.setTextColor(51, 65, 85);
  const completedStages = card.stages.filter((s) => s.completed).length;
  const engSignsCount = countEngineerSignatures(card);
  doc.text(
    `STATUS: ${card.status.replace(/_/g, ' ')}  |  STAGES: ${completedStages}/${card.stages.length}  |  ENG SIGNS: ${engSignsCount}/3`,
    pageWidth - marginX - 2.5,
    37.2,
    { align: 'right' }
  );

  // 1. Job Card Particulars Table
  const infoRows: Array<[string, string, string, string]> = [
    [
      'Work / Task Title',
      card.workTitle || getCardTypeLabel(card.cardType),
      'Assigned Team',
      card.assignedToTeam || 'Maintenance Team',
    ],
    [
      'Issued By (Shift In Charge)',
      card.issuedByShiftInCharge?.name || 'Shift In Charge',
      'Lead Tech / Setter',
      card.assignedTechnicianName?.trim() ||
        card.technicianOrSetter?.name ||
        'Assigned on Receipt',
    ],
    [
      'Start / Target Finish',
      `${card.requestedStartTime || 'Immediate'} -> ${card.targetCompletionTime || 'End of Shift'}`,
      'LOTO & Isolation',
      card.lotoIsolatedConfirmed ? 'VERIFIED & LOCKED OUT' : 'MANDATORY PRIOR TO WORK',
    ],
  ];

  if (isToolingCard) {
    infoRows.push([
      card.cardType === 'EXTRUSION_DIE_CHANGE' ? 'Outgoing Die ID' : 'Outgoing Mould ID',
      card.outgoingDieOrMould?.trim() || 'To be recorded',
      card.cardType === 'EXTRUSION_DIE_CHANGE' ? 'Incoming Die ID' : 'Incoming Mould ID',
      card.incomingDieOrMould?.trim() || 'To be mounted',
    ]);
    infoRows.push([
      'Product to Run',
      card.productToRun?.trim() || 'As per Production Plan',
      'Toolroom Storage Rack/Bin',
      card.storageRackLocation?.trim() || 'Assign Rack / Bay on Storage',
    ]);
    infoRows.push([
      'Preserved & Rust-Protected',
      card.removedToolingCleanedAndPreserved ? 'YES — CLEANED & OILED' : 'Pending Verification',
      'Stored in Toolroom',
      card.removedToolingStoredVerified ? 'YES — STORED & TAGGED' : 'Pending Storage Check',
    ]);
  }

  infoRows.push([
    'Fault / Changeover Scope',
    card.faultOrChangeoverDetails?.trim() || 'Execute standard SOP stages below.',
    'Root Cause / Action Taken',
    [card.rootCauseFindings?.trim(), card.correctiveActionTaken?.trim()]
      .filter(Boolean)
      .join(' | ') || 'Record on completion below',
  ]);

  autoTable(doc, {
    startY: 40.8,
    margin: { left: marginX, right: marginX },
    head: [['Job Card Particulars', 'Recorded Value', 'Assignment & Control', 'Recorded Value']],
    body: infoRows,
    styles: {
      fontSize: 6.6,
      cellPadding: 1.45,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: [15, 47, 102],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 6.7,
    },
    columnStyles: {
      0: { cellWidth: 34, fontStyle: 'bold', fillColor: [248, 250, 252] },
      1: { cellWidth: 62 },
      2: { cellWidth: 35, fontStyle: 'bold', fillColor: [248, 250, 252] },
      3: { cellWidth: 61 },
    },
  });

  // 2. Stages & Instructions + Execution Log
  const stagesStartY = ((doc as any).lastAutoTable?.finalY || 90) + 3.2;
  autoTable(doc, {
    startY: stagesStartY,
    margin: { left: marginX, right: marginX },
    head: [
      [
        '#',
        isToolingCard
          ? 'Stage & SOP Instructions (Machine Setup -> Outgoing Tooling up to Toolroom Storage)'
          : 'Maintenance Stage & Execution Instructions',
        'Stage Log / Status',
        'Verified By & Remarks',
      ],
    ],
    body: card.stages.map((st) => [
      String(st.stageNo),
      `${st.stageTitle}\n${st.instruction}${st.safetyNote ? `\nSafety: ${st.safetyNote}` : ''}`,
      st.completed
        ? `DONE\n${st.completedAt ? st.completedAt.slice(0, 16).replace('T', ' ') : ''}`
        : '[  ] PENDING',
      [st.completedBy, st.remarks].filter(Boolean).join(' · ') || '____________________',
    ]),
    styles: {
      fontSize: 6.2,
      cellPadding: 1.4,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [15, 47, 102],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 6.4,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 7, halign: 'center', fontStyle: 'bold' },
      1: { cellWidth: 118 },
      2: { cellWidth: 23, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 44 },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 2) {
        const val = String(data.cell.raw || '');
        if (val.startsWith('DONE')) {
          data.cell.styles.textColor = [6, 95, 70];
        } else {
          data.cell.styles.textColor = [146, 64, 14];
        }
      }
    },
  });

  // 3. Spares / Component Replacements Table
  const sparesStartY = ((doc as any).lastAutoTable?.finalY || 175) + 3.2;
  const activeSpares = (card.sparesUsed || []).filter(
    (sp) => sp.partName.trim() || sp.partCodeOrSpec.trim() || sp.qty.trim()
  );
  const spareRows =
    activeSpares.length > 0
      ? activeSpares.map((sp) => [
          sp.partName || '—',
          sp.partCodeOrSpec || '—',
          `${sp.qty || '0'} ${sp.unit || 'pcs'}`,
          sp.isReplacement ? 'YES (2–3 ENG SIGNS REQ)' : 'Consumable / No',
          sp.reason || '—',
        ])
      : [
          [
            card.replacementRequired
              ? 'Part replacement flagged — record item before work'
              : 'No part replacement listed (Adjustment / Changeover only)',
            '—',
            '—',
            card.replacementRequired ? 'YES (2–3 ENG SIGNS REQ)' : 'No',
            '—',
          ],
        ];

  autoTable(doc, {
    startY: sparesStartY,
    margin: { left: marginX, right: marginX },
    head: [['Component / Spare Part', 'Part Code / Spec', 'Qty', 'Replacement?', 'Justification / Notes']],
    body: spareRows,
    styles: {
      fontSize: 6.3,
      cellPadding: 1.35,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 6.4,
    },
    columnStyles: {
      0: { cellWidth: 52 },
      1: { cellWidth: 36 },
      2: { cellWidth: 20, halign: 'center' },
      3: { cellWidth: 36, halign: 'center', fontStyle: 'bold' },
      4: { cellWidth: 48 },
    },
  });

  // 4. Mandatory Replacement Notice + 5-Box Signature Matrix
  let footerCursorY = ((doc as any).lastAutoTable?.finalY || 225) + 3.5;
  const policyPlusSigHeight = 49;
  if (footerCursorY + policyPlusSigHeight > pageHeight - 7) {
    doc.addPage();
    footerCursorY = 14;
  }

  // Mandatory Warning Banner (Always prominent at the end before signatures)
  doc.setFillColor(254, 242, 242); // rose-50
  doc.setDrawColor(190, 18, 60); // rose-700
  doc.setLineWidth(0.45);
  doc.roundedRect(marginX, footerCursorY, contentWidth, 9.5, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.1);
  doc.setTextColor(159, 18, 57);
  doc.text(ENGINEER_REPLACEMENT_POLICY_TEXT, pageWidth / 2, footerCursorY + 4.0, {
    align: 'center',
    maxWidth: contentWidth - 6,
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.1);
  doc.setTextColor(136, 19, 55);
  doc.text(
    `Active Engineer Approvals Logged on Card: ${engSignsCount} of 3 Engineer Signatures  |  Replacement Flagged: ${
      card.replacementRequired ? 'YES (Minimum 2–3 Engineer Signatures Mandatory)' : 'NO'
    }`,
    pageWidth / 2,
    footerCursorY + 7.8,
    { align: 'center' }
  );

  // 5 Signature Boxes: Top row (2 boxes: Shift In Charge, Maintenance Tech/Mould Setter) + Bottom row (3 Engineer boxes)
  const sigStartY = footerCursorY + 11.2;
  const row1H = 16.5;
  const row2H = 18.0;
  const topColW = (contentWidth - 3) / 2;
  const botColW = (contentWidth - 6) / 3;

  const drawSignBox = (
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    name: string | undefined,
    sigDataUrl: string | undefined,
    signedAt: string | undefined,
    isEngineerBox = false
  ) => {
    doc.setDrawColor(isEngineerBox ? 15 : 148, isEngineerBox ? 47 : 163, isEngineerBox ? 102 : 184);
    doc.setFillColor(isEngineerBox ? 248 : 255, isEngineerBox ? 250 : 255, isEngineerBox ? 252 : 255);
    doc.setLineWidth(isEngineerBox ? 0.3 : 0.2);
    doc.roundedRect(x, y, w, h, 1.2, 1.2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.7);
    doc.setTextColor(15, 47, 102);
    doc.text(title, x + 2, y + 3.4, { maxWidth: w - 4 });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.5);
    doc.setTextColor(51, 65, 85);
    doc.text(`Name: ${name?.trim() || '____________________'}`, x + 2, y + 6.4, {
      maxWidth: w - 4,
    });

    if (sigDataUrl) {
      try {
        doc.addImage(sigDataUrl, 'PNG', x + 4, y + 7.2, Math.min(34, w - 8), h - 10.2);
      } catch {}
    } else {
      doc.setDrawColor(203, 213, 225);
      doc.line(x + 2, y + h - 3.6, x + w - 2, y + h - 3.6);
    }

    doc.setFontSize(4.9);
    doc.setTextColor(100, 116, 139);
    doc.text(
      signedAt ? `Signed: ${signedAt.slice(0, 16).replace('T', ' ')}` : 'Sign & Date:',
      x + 2,
      y + h - 1.1,
      { maxWidth: w - 4 }
    );
  };

  drawSignBox(
    marginX,
    sigStartY,
    topColW,
    row1H,
    '1. ISSUED BY — SHIFT IN CHARGE',
    card.issuedByShiftInCharge?.name,
    card.issuedByShiftInCharge?.signature,
    card.issuedByShiftInCharge?.signedAt
  );
  drawSignBox(
    marginX + topColW + 3,
    sigStartY,
    topColW,
    row1H,
    isToolingCard
      ? '2. EXECUTED BY — MOULD SETTER / TECH'
      : '2. EXECUTED BY — MAINTENANCE TECHNICIAN',
    card.technicianOrSetter?.name || card.assignedTechnicianName,
    card.technicianOrSetter?.signature,
    card.technicianOrSetter?.signedAt
  );

  const row2Y = sigStartY + row1H + 2;
  drawSignBox(
    marginX,
    row2Y,
    botColW,
    row2H,
    '3. ENGINEER 1 SIGNATURE (MECH / PLANT)',
    card.engineer1?.name,
    card.engineer1?.signature,
    card.engineer1?.signedAt,
    true
  );
  drawSignBox(
    marginX + botColW + 3,
    row2Y,
    botColW,
    row2H,
    '4. ENGINEER 2 SIGNATURE (ELEC / AUTO)',
    card.engineer2?.name,
    card.engineer2?.signature,
    card.engineer2?.signedAt,
    true
  );
  drawSignBox(
    marginX + (botColW + 3) * 2,
    row2Y,
    botColW,
    row2H,
    '5. ENGINEER 3 SIGNATURE (CHIEF ENG / HOD)',
    card.engineer3?.name,
    card.engineer3?.signature,
    card.engineer3?.signedAt,
    true
  );

  // Subtle footer line
  doc.setFontSize(5.8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `LG PLAST · ${card.docCode} · Issued ${card.issuedAt.slice(0, 16).replace('T', ' ')} · No replacements without 2–3 Engineer signatures.`,
    pageWidth / 2,
    pageHeight - 4.5,
    { align: 'center' }
  );

  doc.save(`LGPLAST_JobCard_${card.jobCardNo.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`);
  return { ok: true };
}
