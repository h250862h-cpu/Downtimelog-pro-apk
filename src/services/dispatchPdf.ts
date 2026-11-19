import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DispatchEntry, normalizeMachineName } from '../types';
import { normalizeDispatchStaffAreas } from './dispatchStore';
import { saveFileBlob } from './downtimeCalc';
import { drawLgplastPdfHeader, ensureLgplastLogoLoaded } from './reportPdf';

export type DispatchShiftWindow = 'NIGHT_0730' | 'DAY_1600' | 'DAY_1900';

export function getWindowDisplayLabel(win: DispatchShiftWindow): string {
  switch (win) {
    case 'NIGHT_0730':
      return 'Night Shift Closing (07:30)';
    case 'DAY_1600':
      return 'Day Shift Dispatch (16:00)';
    case 'DAY_1900':
      return 'Day Shift End-of-Shift (19:00)';
  }
}

export function getWindowShift(win: DispatchShiftWindow): 'Day' | 'Night' {
  return win === 'NIGHT_0730' ? 'Night' : 'Day';
}

export interface GenerateShiftMovementPdfOptions {
  date: string;
  shiftWindow: DispatchShiftWindow;
  entries: DispatchEntry[];
  generatedByName: string;
  generatedByRole: string;
  whConfirmedOnly?: boolean;
}

export async function generateShiftStockMovementPdf(options: GenerateShiftMovementPdfOptions) {
  await ensureLgplastLogoLoaded();
  const {
    date,
    shiftWindow,
    entries,
    generatedByName,
    generatedByRole,
    whConfirmedOnly = false,
  } = options;

  const shift = getWindowShift(shiftWindow);
  const windowLabel = getWindowDisplayLabel(shiftWindow);

  // Filter matching entries for selected Date & Shift
  let rows = entries
    .filter((e) => e.date === date && e.shift === shift)
    .sort((a, b) => (a.shiftSubmittedAt || '').localeCompare(b.shiftSubmittedAt || ''));

  if (whConfirmedOnly) {
    rows = rows.filter(
      (e) =>
        typeof e.whReceivedQty === 'number' &&
        (e.status === 'PENDING_HOD' || e.status === 'CONFIRMED')
    );
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // ===================================================
  // TOP BRANDING HEADER: LGPLAST LOGO + CENTERED HEADING
  // ===================================================
  drawLgplastPdfHeader(
    doc,
    'SHIFT STOCK MOVEMENT FORM',
    `GOODS READY FOR DISPATCH  •  ${windowLabel.toUpperCase()}`,
    [
      `Date: ${date}`,
      `Shift: ${shift}`,
      `Gen: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    ]
  );

  // Sub-header audit bar
  doc.setFillColor(241, 245, 249);
  doc.rect(10, 33, pageWidth - 20, 9.5, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.rect(10, 33, pageWidth - 20, 9.5, 'S');
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text(`Prepared By: ${generatedByName} (${generatedByRole})`, 12.5, 38.8);

  const totalShiftQty = rows.reduce((acc, r) => acc + (r.recordedQty || 0), 0);
  const totalWhQty = rows.reduce(
    (acc, r) => acc + (typeof r.whReceivedQty === 'number' ? r.whReceivedQty : 0),
    0
  );
  const totalWeightKg = rows.reduce((acc, r) => {
    const qty = typeof r.whReceivedQty === 'number' ? r.whReceivedQty : r.recordedQty;
    const kg =
      typeof r.unitWeightKg === 'number' && r.unitWeightKg > 0
        ? qty * r.unitWeightKg
        : typeof r.totalWeightKg === 'number'
        ? r.totalWeightKg
        : 0;
    return acc + kg;
  }, 0);
  doc.text(
    `Trolleys: ${rows.length} | Shift: ${totalShiftQty} | WH: ${totalWhQty} | Wt: ${totalWeightKg.toFixed(1)} kg`,
    pageWidth - 12.5,
    38.8,
    { align: 'right' }
  );

  // ===================================================
  // MOVEMENT RECORDS TABLE (PORTRAIT 190MM)
  // ===================================================
  const tableBody = rows.map((rawItem, idx) => {
    const { entry: item } = normalizeDispatchStaffAreas(rawItem);
    const hasWh = typeof item.whReceivedQty === 'number';
    const effectiveQty = hasWh ? item.whReceivedQty! : item.recordedQty;
    const weightKg =
      typeof item.unitWeightKg === 'number' && item.unitWeightKg > 0
        ? (effectiveQty * item.unitWeightKg).toFixed(1)
        : typeof item.totalWeightKg === 'number'
        ? item.totalWeightKg.toFixed(1)
        : '-';
    const variance = hasWh ? item.whReceivedQty! - item.recordedQty : null;
    const statusText =
      item.status === 'CONFIRMED'
        ? 'CONFIRMED'
        : item.status === 'PENDING_HOD'
        ? 'WH CONFIRMED'
        : 'SENT TO WH';
    const sigSummary = [
      item.shiftInChargeSignature ? 'SIC Signed' : 'SIC Open',
      item.whSignature ? 'WH Signed' : 'WH Open',
    ].join(' / ');

    const staffBlock = [
      `Op: ${item.operatorName}`,
      `Asst: ${item.isCasualAssistant ? `${item.assistantName} (Cas)` : item.assistantName}`,
      item.casualAssistantName ? `Cas: ${item.casualAssistantName}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const detailLines = [statusText, sigSummary];
    if (item.whQtyEditReason) {
      const prevTxt =
        typeof item.whPreviousReceivedQty === 'number'
          ? `${item.whPreviousReceivedQty}->${item.whReceivedQty}`
          : `->${item.whReceivedQty}`;
      detailLines.push(`Edit(${prevTxt}): ${item.whQtyEditReason}`);
    } else if (item.whNotes) {
      detailLines.push(`WH: ${item.whNotes}`);
    }

    return [
      String(idx + 1),
      item.trolleyNo,
      normalizeMachineName(item.machine),
      item.product,
      staffBlock,
      String(item.recordedQty),
      hasWh ? String(item.whReceivedQty) : 'Pend',
      weightKg,
      variance === null ? '-' : variance > 0 ? `+${variance}` : String(variance),
      item.whPersonnelName || 'Pending WH',
      detailLines.join('\n'),
    ];
  });

  if (tableBody.length === 0) {
    tableBody.push([
      '-',
      '-',
      '-',
      `No dispatch entries found for ${date} (${shift} Shift).`,
      '-',
      '0',
      '0',
      '0',
      '-',
      '-',
      '-',
    ]);
  }

  autoTable(doc, {
    startY: 45,
    margin: { left: 10, right: 10 },
    head: [
      [
        '#',
        'Trolley',
        'Machine',
        'Product Dispatched',
        'Floor Crew',
        'Shift',
        'WH',
        'Kg',
        'Var',
        'Issued To',
        'Status & Signs',
      ],
    ],
    body: tableBody,
    styles: {
      fontSize: 6.3,
      cellPadding: 1.5,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [15, 47, 102],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 6.4,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 7, halign: 'center' },
      1: { cellWidth: 15, fontStyle: 'bold' },
      2: { cellWidth: 20 },
      3: { cellWidth: 34 },
      4: { cellWidth: 28, fontSize: 5.9 },
      5: { cellWidth: 12, halign: 'right', fontStyle: 'bold' },
      6: { cellWidth: 12, halign: 'right', fontStyle: 'bold' },
      7: { cellWidth: 14, halign: 'right', fontStyle: 'bold' },
      8: { cellWidth: 10, halign: 'right' },
      9: { cellWidth: 16 },
      10: { cellWidth: 22, fontSize: 5.8 },
    },
  });

  // ===================================================
  // SIGN-OFF & VERIFICATION FOOTER BLOCK (PORTRAIT 190MM)
  // ===================================================
  const finalY = (doc as any).lastAutoTable?.finalY || 120;
  let footerY = finalY + 8;
  if (footerY + 36 > pageHeight - 10) {
    doc.addPage();
    footerY = 16;
  }

  doc.setDrawColor(148, 163, 184);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(10, footerY, pageWidth - 20, 32, 2, 2, 'FD');

  const latestSicSigned = [...rows].reverse().find((r) => r.shiftInChargeSignature);
  const latestWhSigned = [...rows].reverse().find((r) => r.whSignature);
  const latestHodSigned = [...rows].reverse().find((r) => r.hodSignature);

  // Col 1: Shift In Charge Sign
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(15, 23, 42);
  doc.text('1. SHIFT IN CHARGE', 13, footerY + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.text(
    `Name: ${latestSicSigned?.shiftInChargeName || '__________________'}`,
    13,
    footerY + 11.5
  );
  if (latestSicSigned?.shiftInChargeSignature) {
    try {
      doc.addImage(latestSicSigned.shiftInChargeSignature, 'PNG', 13, footerY + 13.5, 42, 13);
    } catch {}
  } else {
    doc.text('Sign: __________________', 13, footerY + 24);
  }

  // Col 2: WH Personnel Confirm Sign
  const col2X = 76;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.text('2. WH PERSONNEL RECEIPT', col2X, footerY + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.text(
    `Name: ${latestWhSigned?.whPersonnelName || '__________________'}`,
    col2X,
    footerY + 11.5
  );
  if (latestWhSigned?.whSignature) {
    try {
      doc.addImage(latestWhSigned.whSignature, 'PNG', col2X, footerY + 13.5, 42, 13);
    } catch {}
  } else {
    doc.text('Sign: __________________', col2X, footerY + 24);
  }

  // Col 3: Production HOD Sign
  const col3X = 139;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.text('3. PRODUCTION HOD VERIFY', col3X, footerY + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.text(
    `Name: ${latestHodSigned?.hodConfirmedByName || '__________________'}`,
    col3X,
    footerY + 11.5
  );
  if (latestHodSigned?.hodSignature) {
    try {
      doc.addImage(latestHodSigned.hodSignature, 'PNG', col3X, footerY + 13.5, 42, 13);
    } catch {}
  } else {
    doc.text('Sign: __________________', col3X, footerY + 24);
  }

  // Save PDF Blob
  const safeWin = shiftWindow.toLowerCase();
  const filename = `LGPLAST_Shift_Stock_Movement_${date}_${safeWin}.pdf`;
  const pdfBlob = doc.output('blob');
  saveFileBlob(filename, pdfBlob);
}
