import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DowntimeEntry } from '../types';
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

  // LG PLAST Royal Cobalt Header Bar
  doc.setFillColor(15, 47, 102); // #0f2f66
  doc.rect(10, 8, pageWidth - 20, 24, 'F');
  // Bottom sky-blue accent stripe (#00aeef)
  doc.setFillColor(0, 174, 239);
  doc.rect(10, 31.2, pageWidth - 20, 1.1, 'F');

  // Crisp White LG PLAST Logo Box (Top Left)
  const boxX = 12.5;
  const boxY = 10;
  const boxW = 36;
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

  // Center Report Title
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14.5);
  doc.text(title, pageWidth / 2 + 6, 18.5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(186, 230, 253); // Sky-200
  doc.text(subtitle, pageWidth / 2 + 6, 25.2, { align: 'center' });

  // Right Metadata Lines
  doc.setFontSize(7.5);
  metaRightLines.slice(0, 3).forEach((line, idx) => {
    doc.setTextColor(idx === 2 ? 226 : 125, idx === 2 ? 232 : 211, idx === 2 ? 240 : 252);
    doc.text(line, pageWidth - 13, 14.2 + idx * 5, { align: 'right' });
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
 * Generates an official LG PLAST-branded PDF for the Plant Downtime & Running Hours Period Report
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
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  drawLgplastPdfHeader(
    doc,
    'PLANT DOWNTIME & RUNNING HOURS REPORT',
    `PERIOD: ${from} TO ${to}  •  BASIS: 24 HRS/DAY`,
    [
      `From: ${from}`,
      `To: ${to}`,
      `Generated: ${fmtT(new Date())}`,
    ]
  );

  // KPI Sub-bar
  doc.setFillColor(241, 245, 249);
  doc.rect(10, 33, pageWidth - 20, 9, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.rect(10, 33, pageWidth - 20, 9, 'S');
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(`Approver / Supervisor: ${supervisorName || 'Plant Management'}`, 13, 38.7);
  doc.text(
    `Total Run: ${data.totalRow[2]} hrs  |  Total Down: ${data.totalRow[3]} hrs  |  Availability: ${data.totalRow[7]}%`,
    pageWidth - 13,
    38.7,
    { align: 'right' }
  );

  const summaryBody = data.structured.map((r) => [
    r.machine,
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
        'Period Hrs',
        'Hrs Running',
        'Hrs OFF (Total)',
        'Breakdown Hrs',
        'Changeover Hrs',
        'Other Stoppage Hrs',
        'Availability %',
        'JC Finished',
        'JC Logged',
      ],
    ],
    body: summaryBody,
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: [15, 47, 102],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
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
      head: [['Machine', 'Category', 'Stopped', 'Running Again', 'Hrs Down', 'Reason', 'Reported By', 'Job Card']],
      body: rangeEntries.map((e) => {
        const sTime = toTimestamp(e.start);
        const eTime = e.end ? toTimestamp(e.end) : Date.now();
        return [
          e.m,
          e.cat,
          fmtT(e.start),
          e.end ? fmtT(e.end) : 'Still OFF',
          String(r2((eTime - sTime) / 36e5)),
          e.reason || '-',
          e.rep || '-',
          e.jcn || '-',
        ];
      }),
      styles: { fontSize: 7, cellPadding: 1.8, textColor: [15, 23, 42] },
      headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: {
        5: { cellWidth: 72 },
      },
    });
  }

  saveFileBlob(`LGPLAST_Downtime_Report_${from}_to_${to}.pdf`, doc.output('blob'));
}

/**
 * Generates an official LGPLAST-branded PDF for Daily Machine Hours
 */
export async function generateDailyHoursPdf(selectedDate: string, machines: string[], entries: DowntimeEntry[]) {
  await ensureLgplastLogoLoaded();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
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
      m,
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
    [`Date: ${selectedDate}`, `Machines: ${machines.length}`, `Generated: ${fmtT(new Date())}`]
  );

  doc.setFillColor(241, 245, 249);
  doc.rect(10, 33, pageWidth - 20, 9, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.rect(10, 33, pageWidth - 20, 9, 'S');
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(`Running: ${runningMachines} | Stopped: ${offMachines}`, 13, 38.7);
  doc.text(
    `Run Hrs: ${r2(totalRun)}  |  Down Hrs: ${r2(totalDown)}  |  Availability: ${availPct}%`,
    pageWidth - 13,
    38.7,
    { align: 'right' }
  );

  autoTable(doc, {
    startY: 45,
    margin: { left: 10, right: 10 },
    head: [['Machine', 'Status', 'Hrs Down', 'Hrs Running', 'Breakdown Hrs', 'Changeover Hrs', 'Job Cards Finished']],
    body: tableRows,
    styles: { fontSize: 8, cellPadding: 2.2, textColor: [15, 23, 42] },
    headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    didParseCell: (hookData) => {
      if (hookData.row.index === tableRows.length - 1) {
        hookData.cell.styles.fontStyle = 'bold';
        hookData.cell.styles.fillColor = [226, 232, 240];
      }
    },
  });

  saveFileBlob(`LGPLAST_Daily_Hours_${selectedDate}.pdf`, doc.output('blob'));
}
