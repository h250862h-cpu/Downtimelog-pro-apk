import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DispatchEntry } from '../types';
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
    orientation: 'landscape',
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
    `GOODS READY FOR DISPATCH & MOVEMENT RECORD  •  ${windowLabel.toUpperCase()}`,
    [
      `Date: ${date}`,
      `Shift: ${shift}`,
      `Generated: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    ]
  );

  // Sub-header audit bar
  doc.setFillColor(241, 245, 249);
  doc.rect(10, 33, pageWidth - 20, 9, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.rect(10, 33, pageWidth - 20, 9, 'S');
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(`Prepared / Downloaded By: ${generatedByName} (${generatedByRole})`, 13, 38.7);

  const totalShiftQty = rows.reduce((acc, r) => acc + (r.recordedQty || 0), 0);
  const totalWhQty = rows.reduce(
    (acc, r) => acc + (typeof r.whReceivedQty === 'number' ? r.whReceivedQty : 0),
    0
  );
  doc.text(
    `Total Trolleys: ${rows.length}   |   Total Shift Qty: ${totalShiftQty}   |   Total WH Confirmed Qty: ${totalWhQty}`,
    pageWidth - 13,
    38.7,
    { align: 'right' }
  );

  // ===================================================
  // MOVEMENT RECORDS TABLE
  // ===================================================
  const tableBody = rows.map((item, idx) => {
    const hasWh = typeof item.whReceivedQty === 'number';
    const variance = hasWh ? item.whReceivedQty! - item.recordedQty : null;
    const statusText =
      item.status === 'CONFIRMED'
        ? 'CONFIRMED'
        : item.status === 'PENDING_HOD'
        ? 'WH CONFIRMED'
        : 'READY / SENT TO WH';
    const sigSummary = [
      item.shiftInChargeSignature ? 'SIC Signed' : 'SIC Pending',
      item.whSignature ? 'WH Signed' : 'WH Pending',
    ].join(' | ');

    const detailLines = [statusText, sigSummary];
    if (item.whQtyEditReason) {
      const prevTxt =
        typeof item.whPreviousReceivedQty === 'number'
          ? `${item.whPreviousReceivedQty}->${item.whReceivedQty}`
          : `->${item.whReceivedQty}`;
      detailLines.push(`Qty Edit (${prevTxt}): ${item.whQtyEditReason}`);
    } else if (item.whNotes) {
      detailLines.push(`WH Note: ${item.whNotes}`);
    }

    return [
      String(idx + 1),
      item.trolleyNo,
      item.machine,
      item.product,
      item.operatorName,
      item.isCasualAssistant ? `${item.assistantName} (Casual)` : item.assistantName,
      item.shiftInChargeName,
      String(item.recordedQty),
      hasWh ? String(item.whReceivedQty) : 'Pending',
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
      '-',
      '-',
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
        'Trolley No',
        'Machine',
        'Product Dispatched',
        'Operator',
        'Assistant',
        'Shift In Charge',
        'Shift Qty',
        'WH Qty',
        'Var',
        'WH Personnel',
        'Status, Qty Reason & Signs',
      ],
    ],
    body: tableBody,
    styles: {
      fontSize: 7.2,
      cellPadding: 2,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [15, 47, 102],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.2,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 19, fontStyle: 'bold' },
      2: { cellWidth: 25 },
      3: { cellWidth: 40 },
      4: { cellWidth: 24 },
      5: { cellWidth: 24 },
      6: { cellWidth: 24 },
      7: { cellWidth: 15, halign: 'right', fontStyle: 'bold' },
      8: { cellWidth: 15, halign: 'right', fontStyle: 'bold' },
      9: { cellWidth: 12, halign: 'right' },
      10: { cellWidth: 23 },
      11: { cellWidth: 48, fontSize: 6.5 },
    },
  });

  // ===================================================
  // SIGN-OFF & VERIFICATION FOOTER BLOCK
  // ===================================================
  const finalY = (doc as any).lastAutoTable?.finalY || 120;
  let footerY = finalY + 8;
  if (footerY + 34 > pageHeight - 10) {
    doc.addPage();
    footerY = 16;
  }

  doc.setDrawColor(148, 163, 184);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(10, footerY, pageWidth - 20, 30, 2, 2, 'FD');

  const latestSicSigned = [...rows].reverse().find((r) => r.shiftInChargeSignature);
  const latestWhSigned = [...rows].reverse().find((r) => r.whSignature);
  const latestHodSigned = [...rows].reverse().find((r) => r.hodSignature);

  // Col 1: Shift In Charge Sign
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('1. SHIFT IN CHARGE HANDOVER', 14, footerY + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(
    `Name: ${latestSicSigned?.shiftInChargeName || '_______________________'}`,
    14,
    footerY + 11.5
  );
  if (latestSicSigned?.shiftInChargeSignature) {
    try {
      doc.addImage(latestSicSigned.shiftInChargeSignature, 'PNG', 14, footerY + 13, 36, 13);
    } catch {}
  } else {
    doc.text('Signature: _______________________', 14, footerY + 23);
  }

  // Col 2: WH Personnel Confirm Sign
  const col2X = pageWidth / 3 + 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('2. WH PERSONNEL RECEIPT CONFIRMATION', col2X, footerY + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(
    `Name: ${latestWhSigned?.whPersonnelName || '_______________________'}`,
    col2X,
    footerY + 11.5
  );
  if (latestWhSigned?.whSignature) {
    try {
      doc.addImage(latestWhSigned.whSignature, 'PNG', col2X, footerY + 13, 36, 13);
    } catch {}
  } else {
    doc.text('Signature: _______________________', col2X, footerY + 23);
  }

  // Col 3: Production HOD Sign
  const col3X = (pageWidth / 3) * 2 + 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('3. PRODUCTION HOD VERIFICATION', col3X, footerY + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(
    `Name: ${latestHodSigned?.hodConfirmedByName || '_______________________'}`,
    col3X,
    footerY + 11.5
  );
  if (latestHodSigned?.hodSignature) {
    try {
      doc.addImage(latestHodSigned.hodSignature, 'PNG', col3X, footerY + 13, 36, 13);
    } catch {}
  } else {
    doc.text('Signature: _______________________', col3X, footerY + 23);
  }

  // Save PDF Blob
  const safeWin = shiftWindow.toLowerCase();
  const filename = `LGPLAST_Shift_Stock_Movement_${date}_${safeWin}.pdf`;
  const pdfBlob = doc.output('blob');
  saveFileBlob(filename, pdfBlob);
}
