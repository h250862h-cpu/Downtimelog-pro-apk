import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DowntimeEntry, normalizeMachineName } from '../types';
import {
  calculateDayStats,
  fmtT,
  getOpenEntry,
  getSummaryRows,
  r2,
  saveFileBlob,
  toTimestamp,
} from './downtimeCalc';

const LGPLAST_LOGO_PATH = '/assets/aistudio/image_65f70fd7.png';
let cachedLogoDataUrl: string | null = null;
let cachedLogoAspect = 608 / 500;
let logoLoadPromise: Promise<string | null> | null = null;

/**
 * Loads and caches the official LG PLAST image logo as a PNG data URL for jsPDF embedding.
 */
export function ensureLgplastLogoLoaded(): Promise<string | null> {
  if (cachedLogoDataUrl) return Promise.resolve(cachedLogoDataUrl);
  if (typeof window === 'undefined' || typeof Image === 'undefined') return Promise.resolve(null);
  if (logoLoadPromise) return logoLoadPromise;

  logoLoadPromise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = img.naturalWidth || 608;
        const h = img.naturalHeight || 500;
        cachedLogoAspect = w / h;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          cachedLogoDataUrl = canvas.toDataURL('image/png');
          resolve(cachedLogoDataUrl);
          return;
        }
      } catch (err) {
        console.warn('LG PLAST PDF logo canvas conversion failed:', err);
      }
      resolve(null);
    };
    img.onerror = () => resolve(null);
    img.src = LGPLAST_LOGO_PATH;
  });

  return logoLoadPromise;
}

// Eagerly preload so first PDF click is instant
if (typeof window !== 'undefined') {
  ensureLgplastLogoLoaded().catch(() => {});
}

/**
 * Draws the official LG PLAST header banner (Official LG PLAST Logo Image Box at Top-Left,
 * Centered Title & Subtitle, and Top-Right Metadata) onto any jsPDF A4 page.
 */
export function drawLgplastPdfHeader(
  doc: jsPDF,
  title: string,
  subtitle: string,
  metaRightLines: string[]
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const isPortrait = pageWidth < 230;

  // LG PLAST Royal Cobalt Header Bar
  doc.setFillColor(15, 47, 102); // #0f2f66
  doc.rect(10, 8, pageWidth - 20, 24, 'F');
  // Bottom sky-blue accent stripe (#00aeef)
  doc.setFillColor(0, 174, 239);
  doc.rect(10, 31.2, pageWidth - 20, 1.1, 'F');

  // Crisp White LG PLAST Logo Box (Top Left)
  const boxX = 12;
  const boxY = 10;
  const boxW = isPortrait ? 30 : 36;
  const boxH = 19.5;
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(boxX, boxY, boxW, boxH, 2, 2, 'F');
  doc.setDrawColor(0, 174, 239);
  doc.setLineWidth(0.4);
  doc.roundedRect(boxX, boxY, boxW, boxH, 2, 2, 'S');

  if (cachedLogoDataUrl) {
    try {
      const innerH = boxH - 2.2;
      const innerW = Math.min(boxW - 3, innerH * cachedLogoAspect);
      const imgX = boxX + (boxW - innerW) / 2;
      const imgY = boxY + (boxH - innerH) / 2;
      doc.addImage(cachedLogoDataUrl, 'PNG', imgX, imgY, innerW, innerH);
    } catch {
      drawFallbackVectorLogo(doc, boxX, boxY, boxW, boxH);
    }
  } else {
    drawFallbackVectorLogo(doc, boxX, boxY, boxW, boxH);
  }

  // Center Report Title (bounded safely between Logo and Right Meta)
  const centerX = isPortrait ? pageWidth / 2 - 2 : pageWidth / 2 + 6;
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isPortrait ? 11.2 : 14.5);
  doc.text(title, centerX, 17.8, { align: 'center', maxWidth: isPortrait ? 105 : 170 });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(isPortrait ? 6.8 : 8);
  doc.setTextColor(186, 230, 253); // Sky-200
  doc.text(subtitle, centerX, 24.8, { align: 'center', maxWidth: isPortrait ? 108 : 175 });

  // Right Metadata Lines
  doc.setFontSize(isPortrait ? 6.6 : 7.5);
  metaRightLines.slice(0, 3).forEach((line, idx) => {
    doc.setTextColor(idx === 2 ? 226 : 125, idx === 2 ? 232 : 211, idx === 2 ? 240 : 252);
    doc.text(line, pageWidth - 12, 14.2 + idx * 5, { align: 'right' });
  });
}

function drawFallbackVectorLogo(
  doc: jsPDF,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number
) {
  const cx = boxX + boxW / 2;
  const cy = boxY + 6.5;
  doc.setFillColor(46, 49, 146);
  doc.circle(cx, cy, 4.3, 'F');
  doc.setFillColor(0, 174, 239);
  doc.circle(cx - 0.6, cy + 0.6, 2.1, 'F');
  doc.setTextColor(0, 174, 239);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('LG PLAST', cx, boxY + 14.8, { align: 'center' });
  doc.setTextColor(51, 65, 85);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4);
  doc.text('Affordable / Durable / Complete', cx, boxY + 18, { align: 'center' });
}

/**
 * Generates an official LG PLAST-branded PORTRAIT PDF for the Plant Downtime & Running Hours Period Report
 */
export async function generateDowntimePeriodPdf(
  from: string,
  to: string,
  machines: string[],
  entries: DowntimeEntry[],
  supervisorName?: string
) {
  await ensureLgplastLogoLoaded();
  const data = getSummaryRows(from, to, machines, entries);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  drawLgplastPdfHeader(
    doc,
    'PLANT DOWNTIME & RUNNING HOURS',
    `PERIOD: ${from} TO ${to}  •  BASIS: 24 HRS/DAY`,
    [`From: ${from}`, `To: ${to}`, `Gen: ${fmtT(new Date())}`]
  );

  // KPI Sub-bar
  doc.setFillColor(241, 245, 249);
  doc.rect(10, 33, pageWidth - 20, 9, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.rect(10, 33, pageWidth - 20, 9, 'S');
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.text(`Supervisor: ${supervisorName || 'Plant Management'}`, 12.5, 38.7);
  doc.text(
    `Run: ${data.totalRow[2]}h  |  Down: ${data.totalRow[3]}h  |  Avail: ${data.totalRow[7]}%`,
    pageWidth - 12.5,
    38.7,
    { align: 'right' }
  );

  const summaryBody = data.structured.map((r) => [
    normalizeMachineName(r.machine),
    String(r.periodHrs),
    String(r.runHrs),
    String(r.downHrs),
    String(r.breakdownHrs),
    String(r.changeoverHrs),
    String(r.otherHrs),
    `${r.availabilityPercent}%`,
    String(r.jobCardsFinished),
    String(r.jobCardsLogged),
  ]);

  summaryBody.push([
    'TOTAL',
    String(data.totalRow[1]),
    String(data.totalRow[2]),
    String(data.totalRow[3]),
    String(data.totalRow[4]),
    String(data.totalRow[5]),
    String(data.totalRow[6]),
    `${data.totalRow[7]}%`,
    String(data.totalRow[8]),
    String(data.totalRow[9]),
  ]);

  autoTable(doc, {
    startY: 45,
    margin: { left: 10, right: 10 },
    head: [
      [
        'Machine',
        'Period',
        'Run Hrs',
        'OFF Hrs',
        'B/Down',
        'C/Over',
        'Other',
        'Avail %',
        'JC Fin',
        'JC Log',
      ],
    ],
    body: summaryBody,
    styles: {
      fontSize: 6.8,
      cellPadding: 1.7,
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
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 42 },
      1: { cellWidth: 16, halign: 'right' },
      2: { cellWidth: 16, halign: 'right' },
      3: { cellWidth: 16, halign: 'right' },
      4: { cellWidth: 16, halign: 'right' },
      5: { cellWidth: 16, halign: 'right' },
      6: { cellWidth: 16, halign: 'right' },
      7: { cellWidth: 18, halign: 'right' },
      8: { cellWidth: 17, halign: 'center' },
      9: { cellWidth: 17, halign: 'center' },
    },
    didParseCell: (hookData) => {
      if (hookData.row.index === summaryBody.length - 1) {
        hookData.cell.styles.fontStyle = 'bold';
        hookData.cell.styles.fillColor = [226, 232, 240];
      }
    },
  });

  // Page 2: Incident Logs within range (if any)
  const rangeEntries = entries
    .filter((e) => !e.del)
    .filter((e) => {
      const ds = fmtT(e.start).slice(0, 10);
      return ds >= from && ds <= to;
    })
    .sort((a, b) => toTimestamp(b.start) - toTimestamp(a.start));

  if (rangeEntries.length > 0) {
    doc.addPage();
    drawLgplastPdfHeader(
      doc,
      'PLANT DOWNTIME INCIDENT LOGS',
      `PERIOD: ${from} TO ${to}  •  TOTAL INCIDENTS: ${rangeEntries.length}`,
      [`From: ${from}`, `To: ${to}`, `Records: ${rangeEntries.length}`]
    );

    autoTable(doc, {
      startY: 36,
      margin: { left: 10, right: 10 },
      head: [['Machine', 'Category', 'Stopped', 'Running', 'Hrs', 'Reason', 'Reporter', 'JC']],
      body: rangeEntries.map((e) => {
        const sTime = toTimestamp(e.start);
        const eTime = e.end ? toTimestamp(e.end) : Date.now();
        return [
          normalizeMachineName(e.m),
          e.cat,
          fmtT(e.start),
          e.end ? fmtT(e.end) : 'Still OFF',
          String(r2((eTime - sTime) / 36e5)),
          e.reason || '-',
          e.rep || '-',
          e.jcn || '-',
        ];
      }),
      styles: { fontSize: 6.4, cellPadding: 1.5, textColor: [15, 23, 42] },
      headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 26 },
        1: { cellWidth: 20 },
        2: { cellWidth: 23 },
        3: { cellWidth: 23 },
        4: { cellWidth: 11, halign: 'right' },
        5: { cellWidth: 46 },
        6: { cellWidth: 23 },
        7: { cellWidth: 18 },
      },
    });
  }

  saveFileBlob(`LGPLAST_Downtime_Report_${from}_to_${to}.pdf`, doc.output('blob'));
}

/**
 * Generates an official LGPLAST-branded PORTRAIT PDF for Daily Machine Hours
 */
export async function generateDailyHoursPdf(selectedDate: string, machines: string[], entries: DowntimeEntry[]) {
  await ensureLgplastLogoLoaded();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  let totalDown = 0;
  let totalRun = 0;
  let totalBd = 0;
  let totalCo = 0;
  let totalJc = 0;
  let totalJct = 0;
  let runningMachines = 0;
  let offMachines = 0;

  const tableRows = machines.map((m) => {
    const s = calculateDayStats(m, selectedDate, entries);
    const open = getOpenEntry(m, entries);
    const isOff = !!open;
    if (isOff) offMachines++;
    else runningMachines++;
    totalDown += s.down;
    totalRun += s.run;
    totalBd += s.bd;
    totalCo += s.co;
    totalJc += s.jc;
    totalJct += s.jct;

    return [
      normalizeMachineName(m),
      isOff ? 'OFF' : 'RUNNING',
      String(r2(s.down)),
      String(r2(s.run)),
      String(r2(s.bd)),
      String(r2(s.co)),
      s.jct ? `${s.jc} of ${s.jct}` : '-',
    ];
  });

  const availPct = totalDown + totalRun > 0 ? r2((100 * totalRun) / (totalDown + totalRun)) : 100;
  tableRows.push([
    'TOTAL',
    `${runningMachines} RUN / ${offMachines} OFF`,
    String(r2(totalDown)),
    String(r2(totalRun)),
    String(r2(totalBd)),
    String(r2(totalCo)),
    totalJct ? `${totalJc} of ${totalJct}` : '-',
  ]);

  drawLgplastPdfHeader(
    doc,
    'DAILY MACHINE HOURS REPORT',
    `DATE: ${selectedDate}  •  PLANT AVAILABILITY: ${availPct}%`,
    [`Date: ${selectedDate}`, `Machines: ${machines.length}`, `Gen: ${fmtT(new Date())}`]
  );

  doc.setFillColor(241, 245, 249);
  doc.rect(10, 33, pageWidth - 20, 9, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.rect(10, 33, pageWidth - 20, 9, 'S');
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.3);
  doc.text(`Running: ${runningMachines} | Stopped: ${offMachines}`, 12.5, 38.7);
  doc.text(
    `Run: ${r2(totalRun)}h  |  Down: ${r2(totalDown)}h  |  Avail: ${availPct}%`,
    pageWidth - 12.5,
    38.7,
    { align: 'right' }
  );

  autoTable(doc, {
    startY: 45,
    margin: { left: 10, right: 10 },
    head: [['Machine', 'Status', 'Down Hrs', 'Run Hrs', 'B/Down', 'C/Over', 'Job Cards']],
    body: tableRows,
    styles: { fontSize: 7.4, cellPadding: 2, textColor: [15, 23, 42] },
    headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 46 },
      1: { cellWidth: 28 },
      2: { cellWidth: 22, halign: 'right' },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 28, halign: 'center' },
    },
    didParseCell: (hookData) => {
      if (hookData.row.index === tableRows.length - 1) {
        hookData.cell.styles.fontStyle = 'bold';
        hookData.cell.styles.fillColor = [226, 232, 240];
      }
    },
  });

  saveFileBlob(`LGPLAST_Daily_Hours_${selectedDate}.pdf`, doc.output('blob'));
}

/**
 * Generates Portrait A4 Unified Period Production Report PDF with Official LG PLAST Logo
 */
export async function generatePeriodProductionReportPdf(
  report: {
    fromDate: string;
    toDate: string;
    totals: {
      totalPcs: number;
      totalKg: number;
      totalScrapKg: number;
      totalWastageKg: number;
      totalProdHrs: number;
      totalDownHrs: number;
    };
    productRows: Array<{
      product: string;
      prodPcs: number;
      prodKg: number;
      scrapKg: number;
      wastageKg: number;
    }>;
    machineRows: Array<{
      machine: string;
      prodPcs: number;
      prodKg: number;
      scrapKg: number;
      wastageKg: number;
      prodHrs: number;
      downHrs: number;
    }>;
    shiftProductionRows: Array<{
      date: string;
      shift: string;
      machine: string;
      product: string;
      qty?: number;
      unit?: string;
      prodKg: number;
      scrapKg: number;
      wastageCdKg: number;
      operator: string;
    }>;
    qcRows: Array<{
      date: string;
      shift: string;
      time?: string;
      machine: string;
      product: string;
      pph?: number | string;
      weightKg?: number | string;
      dropBend: string;
      fitting: string;
      color: string;
    }>;
  },
  preparedBy: string
) {
  await ensureLgplastLogoLoaded();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  drawLgplastPdfHeader(
    doc,
    'UNIFIED PERIOD PRODUCTION REPORT',
    `SUMIF PRODUCTION, SCRAP, MACHINE HOURS & QC  •  ${report.fromDate} TO ${report.toDate}`,
    [`From: ${report.fromDate}`, `To: ${report.toDate}`, `By: ${preparedBy}`]
  );

  // KPI Bar
  doc.setFillColor(241, 245, 249);
  doc.rect(10, 33, pageWidth - 20, 10, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.rect(10, 33, pageWidth - 20, 10, 'S');
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.0);
  doc.text(
    `Prod Pcs: ${report.totals.totalPcs.toLocaleString()}   |   Weight: ${report.totals.totalKg.toLocaleString()} kg   |   Scrap: ${report.totals.totalScrapKg.toLocaleString()} kg   |   Wastage: ${report.totals.totalWastageKg.toLocaleString()} kg`,
    13,
    37.2
  );
  doc.text(
    `Total Prod Hrs: ${report.totals.totalProdHrs.toLocaleString()} h   |   Total Downtime Hrs: ${report.totals.totalDownHrs.toLocaleString()} h`,
    13,
    41.3
  );

  // Table 1: Product SUMIF
  doc.setFontSize(8.5);
  doc.setTextColor(15, 47, 102);
  doc.text('1. PRODUCTION SUMMARY BY PRODUCT (SUMIF)', 10, 49);

  const prodBody = report.productRows.map((p) => [
    p.product,
    String(p.prodPcs),
    String(p.prodKg),
    String(p.scrapKg),
    String(p.wastageKg),
  ]);
  prodBody.push([
    'TOTAL PRODUCTION',
    String(report.totals.totalPcs),
    String(report.totals.totalKg),
    String(report.totals.totalScrapKg),
    String(report.totals.totalWastageKg),
  ]);

  autoTable(doc, {
    startY: 51,
    margin: { left: 10, right: 10 },
    head: [['Product Type', 'Prod. Pcs', 'Prod Kg', 'Scrap (kg)', 'Wastage (kg)']],
    body: prodBody,
    styles: { fontSize: 6.7, cellPadding: 1.6, textColor: [15, 23, 42] },
    headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 94 },
      1: { cellWidth: 24, halign: 'right' },
      2: { cellWidth: 26, halign: 'right' },
      3: { cellWidth: 23, halign: 'right' },
      4: { cellWidth: 23, halign: 'right' },
    },
    didParseCell: (hookData) => {
      if (hookData.row.index === prodBody.length - 1) {
        hookData.cell.styles.fontStyle = 'bold';
        hookData.cell.styles.fillColor = [226, 232, 240];
      }
    },
  });

  // Table 2: Machine SUMIF + Run/Down Hours
  let nextY = ((doc as any).lastAutoTable?.finalY || 120) + 7;
  if (nextY > 235) {
    doc.addPage();
    nextY = 16;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 47, 102);
  doc.text('2. PRODUCTION & HOURS PER MACHINE (SUMIF + DOWNTIME LOG)', 10, nextY);

  const machBody = report.machineRows.map((m) => [
    normalizeMachineName(m.machine),
    String(m.prodPcs),
    String(m.prodKg),
    String(m.scrapKg),
    String(m.wastageKg),
    String(m.prodHrs),
    String(m.downHrs),
  ]);
  machBody.push([
    'TOTAL PRODUCTION',
    String(report.totals.totalPcs),
    String(report.totals.totalKg),
    String(report.totals.totalScrapKg),
    String(report.totals.totalWastageKg),
    String(report.totals.totalProdHrs),
    String(report.totals.totalDownHrs),
  ]);

  autoTable(doc, {
    startY: nextY + 2,
    margin: { left: 10, right: 10 },
    head: [['Machine', 'Prod Pcs', 'Weight (kg)', 'Scrap', 'Wastage', 'Prod Hrs', 'Down Hrs']],
    body: machBody,
    styles: { fontSize: 6.7, cellPadding: 1.6, textColor: [15, 23, 42] },
    headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 52 },
      1: { cellWidth: 22, halign: 'right' },
      2: { cellWidth: 26, halign: 'right' },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 23, halign: 'right' },
      6: { cellWidth: 23, halign: 'right' },
    },
    didParseCell: (hookData) => {
      if (hookData.row.index === machBody.length - 1) {
        hookData.cell.styles.fontStyle = 'bold';
        hookData.cell.styles.fillColor = [226, 232, 240];
      }
    },
  });

  // Table 3 & 4 on fresh Portrait Page(s) if present
  if (report.shiftProductionRows.length > 0) {
    doc.addPage();
    drawLgplastPdfHeader(
      doc,
      'PRODUCTION PER SHIFT (LOGGER)',
      `${report.fromDate} TO ${report.toDate}  •  RECORDS: ${report.shiftProductionRows.length}`,
      [`Period: ${report.fromDate}`, `To: ${report.toDate}`, `Rows: ${report.shiftProductionRows.length}`]
    );
    autoTable(doc, {
      startY: 36,
      margin: { left: 10, right: 10 },
      head: [['Date', 'Shift', 'Machine', 'Product', 'Qty', 'Scrap', 'Cut Dust', 'Operator']],
      body: report.shiftProductionRows.map((r) => [
        r.date,
        r.shift,
        normalizeMachineName(r.machine),
        r.product,
        `${r.qty ?? r.prodKg} ${r.unit || 'kg'}`,
        String(r.scrapKg),
        String(r.wastageCdKg),
        r.operator,
      ]),
      styles: { fontSize: 6.4, cellPadding: 1.5, textColor: [15, 23, 42] },
      headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 20 },
        1: { cellWidth: 13 },
        2: { cellWidth: 28 },
        3: { cellWidth: 42 },
        4: { cellWidth: 24, halign: 'right' },
        5: { cellWidth: 16, halign: 'right' },
        6: { cellWidth: 17, halign: 'right' },
        7: { cellWidth: 30 },
      },
    });
  }

  if (report.qcRows.length > 0) {
    doc.addPage();
    drawLgplastPdfHeader(
      doc,
      'QC INSPECTION REPORT (PERIOD)',
      `${report.fromDate} TO ${report.toDate}  •  CHECKS: ${report.qcRows.length}`,
      [`Period: ${report.fromDate}`, `To: ${report.toDate}`, `Checks: ${report.qcRows.length}`]
    );
    autoTable(doc, {
      startY: 36,
      margin: { left: 10, right: 10 },
      head: [['Date', 'Shift', 'Time', 'Machine', 'Product', 'PPH', 'Wt', 'Drop', 'Fit', 'Col']],
      body: report.qcRows.map((q) => [
        q.date,
        q.shift,
        q.time || '-',
        normalizeMachineName(q.machine),
        q.product,
        String(q.pph ?? '-'),
        String(q.weightKg ?? '-'),
        q.dropBend,
        q.fitting,
        q.color,
      ]),
      styles: { fontSize: 6.4, cellPadding: 1.5, textColor: [15, 23, 42] },
      headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 20 },
        1: { cellWidth: 12 },
        2: { cellWidth: 13 },
        3: { cellWidth: 28 },
        4: { cellWidth: 45 },
        5: { cellWidth: 14, halign: 'right' },
        6: { cellWidth: 14, halign: 'right' },
        7: { cellWidth: 15, halign: 'center' },
        8: { cellWidth: 15, halign: 'center' },
        9: { cellWidth: 14, halign: 'center' },
      },
    });
  }

  saveFileBlob(`LGPLAST_Production_Report_${report.fromDate}_to_${report.toDate}.pdf`, doc.output('blob'));
}

