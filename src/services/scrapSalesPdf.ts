import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ScrapSalesInvoice } from '../types';
import { saveFileBlob } from './downtimeCalc';
import { drawLgplastPdfHeader, ensureLgplastLogoLoaded } from './reportPdf';

/**
 * Generates the official LG PLAST Recycling Scrap Sales Invoice PDF (Portrait A4)
 * featuring the LG PLAST Logo header, formal heading, the exact 3-category
 * calculation breakdown, Total Scrap Qnty & Total Cost summary, Total Cost footer,
 * and formatted blocks for 3 signatures.
 */
export async function generateScrapSalesInvoicePdf(invoice: ScrapSalesInvoice) {
  await ensureLgplastLogoLoaded();

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // 1. Official LG PLAST Header Banner with LG Logo + Proper Invoice Heading
  drawLgplastPdfHeader(
    doc,
    'RECYCLING SCRAP SALES INVOICE',
    'LG PLAST (PVT) LTD  •  OFFICIAL RECYCLING SCRAP SALES & WEIGHT BILLING',
    [
      `Invoice No: ${invoice.invoiceNo}`,
      `Date: ${invoice.date}`,
      `Status: ${invoice.status}`,
    ]
  );

  // 2. Customer / Invoice Metadata Card
  autoTable(doc, {
    startY: 36,
    margin: { left: 10, right: 10 },
    head: [['INVOICE & CUSTOMER DETAILS', 'DOCUMENT & BILLING REFERENCE']],
    body: [
      [
        `Buyer / Customer: ${invoice.buyerName || 'Walk-in / Cash Buyer'}`,
        `Invoice Number: ${invoice.invoiceNo}`,
      ],
      [
        `Contact / Ref: ${invoice.buyerPhone || 'N/A'}`,
        `Invoice Date: ${invoice.date}`,
      ],
      [
        `Vehicle / Collection Reg: ${invoice.vehicleReg || 'N/A'}`,
        `Prepared By: ${invoice.preparedByName}`,
      ],
      [
        `Remarks: ${invoice.notes || 'Recycling scrap dispatch & sale'}`,
        `Currency: USD ($)  •  Net Billing Basis: 50% of Gross Qnty`,
      ],
    ],
    styles: {
      fontSize: 8.2,
      cellPadding: 2.3,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [15, 47, 102],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 98 },
      1: { cellWidth: 92 },
    },
  });

  const afterMetaY = ((doc as any).lastAutoTable?.finalY || 72) + 6;

  // Section Label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 47, 102);
  doc.text('SCRAP WEIGHT & BILLING CALCULATION', 10, afterMetaY);

  // 3. Exact Spreadsheet-Structure Line Items + Total Scrap Qnty & Total Cost + Grand Total Cost
  const formatCostPerKg = (rate: number): string => {
    if (Math.abs(rate - 0.066666667) < 0.0001) return '$0.066666667';
    return `$${rate.toFixed(2)}`;
  };

  const bodyRows: any[][] = invoice.items.map((item) => [
    item.name,
    formatCostPerKg(item.costPerKg),
    `${item.qntyKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`,
    `${item.totalKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`,
    `$${item.totalCost.toFixed(2)}`,
  ]);

  // Row showing TOTAL SCRAP QNTY and TOTAL COST
  bodyRows.push([
    {
      content: 'TOTAL SCRAP QNTY & TOTAL COST',
      styles: { fontStyle: 'bold', fillColor: [226, 232, 240], textColor: [15, 23, 42] },
    },
    {
      content: '—',
      styles: { halign: 'center', fillColor: [226, 232, 240], textColor: [71, 85, 105] },
    },
    {
      content: `${invoice.totalScrapQntyKg.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} kg`,
      styles: { halign: 'right', fontStyle: 'bold', fillColor: [226, 232, 240], textColor: [15, 23, 42] },
    },
    {
      content: `${invoice.totalNetKg.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} kg`,
      styles: { halign: 'right', fontStyle: 'bold', fillColor: [226, 232, 240], textColor: [15, 23, 42] },
    },
    {
      content: `$${invoice.totalCost.toFixed(2)}`,
      styles: { halign: 'right', fontStyle: 'bold', fillColor: [226, 232, 240], textColor: [15, 23, 42] },
    },
  ]);

  // Grand TOTAL COST Summary Row
  bodyRows.push([
    {
      content: 'TOTAL COST (INVOICE AMOUNT DUE)',
      colSpan: 4,
      styles: {
        fontStyle: 'bold',
        fontSize: 10,
        fillColor: [15, 47, 102],
        textColor: [255, 255, 255],
        halign: 'right',
      },
    },
    {
      content: `$${invoice.totalCost.toFixed(2)}`,
      styles: {
        fontStyle: 'bold',
        fontSize: 10.5,
        fillColor: [15, 47, 102],
        textColor: [255, 255, 255],
        halign: 'right',
      },
    },
  ]);

  autoTable(doc, {
    startY: afterMetaY + 3,
    margin: { left: 10, right: 10 },
    head: [['NAME', 'COST PER KG', 'QNTY / KG', 'TOTAL KG', 'TOTAL COST']],
    body: bodyRows,
    styles: {
      fontSize: 9,
      cellPadding: 3.4,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.25,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 52, fontStyle: 'bold' },
      1: { cellWidth: 36, halign: 'right' },
      2: { cellWidth: 34, halign: 'right' },
      3: { cellWidth: 34, halign: 'right' },
      4: { cellWidth: 34, halign: 'right', fontStyle: 'bold' },
    },
  });

  const afterTableY = ((doc as any).lastAutoTable?.finalY || 135) + 6;

  // 4. Calculation Note Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(10, afterTableY, pageWidth - 20, 14, 1.8, 1.8, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.6);
  doc.setTextColor(15, 47, 102);
  doc.text('CALCULATION BASIS:', 14, afterTableY + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text(
    'TOTAL KG = 50% of entered QNTY/KG  •  TOTAL COST = TOTAL KG × COST PER KG  •  Total Scrap Qnty & Grand Total Cost auto-summed.',
    14,
    afterTableY + 10.5
  );

  // 5. Three Signatures Block (Formatted for 3 Signatures — Digital or Manual Ink Sign-Off)
  let sigY = afterTableY + 22;
  const sigBoxH = 52;
  if (sigY + sigBoxH + 14 > pageHeight) {
    doc.addPage();
    sigY = 20;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 47, 102);
  doc.text('AUTHORIZATION & RECEIPT SIGNATURES (3 SIGNATORIES)', 10, sigY - 2.5);

  const colWidth = 61;
  const colGap = 3.5;
  const sigConfigs = [
    {
      title: '1. PREPARED / ISSUED BY',
      subtitle: 'Recycling / Dispatch Officer',
      slot: invoice.signatures?.preparedBy,
      defaultName: invoice.preparedByName || '',
    },
    {
      title: '2. APPROVED BY',
      subtitle: 'Plant HOD / Management',
      slot: invoice.signatures?.approvedBy,
      defaultName: '',
    },
    {
      title: '3. RECEIVED BY (BUYER)',
      subtitle: 'Customer / Collector Sign',
      slot: invoice.signatures?.buyer,
      defaultName: invoice.buyerName || '',
    },
  ];

  sigConfigs.forEach((cfg, idx) => {
    const x = 10 + idx * (colWidth + colGap);
    doc.setDrawColor(148, 163, 184);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, sigY, colWidth, sigBoxH, 2, 2, 'FD');

    // Top colored strip
    doc.setFillColor(15, 47, 102);
    doc.rect(x, sigY, colWidth, 6.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(255, 255, 255);
    doc.text(cfg.title, x + colWidth / 2, sigY + 4.4, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    doc.setTextColor(100, 116, 139);
    doc.text(cfg.subtitle, x + colWidth / 2, sigY + 10.5, { align: 'center' });

    const resolvedName = (cfg.slot?.name || cfg.defaultName || '').trim();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `Name: ${resolvedName || '_______________________'}`,
      x + 3.5,
      sigY + 16.5,
      { maxWidth: colWidth - 7 }
    );

    // Signature Area
    if (cfg.slot?.signature) {
      try {
        doc.addImage(cfg.slot.signature, 'PNG', x + 6, sigY + 19, colWidth - 12, 19);
      } catch {
        doc.setDrawColor(100, 116, 139);
        doc.line(x + 4, sigY + 37, x + colWidth - 4, sigY + 37);
      }
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(100, 116, 139);
      doc.text('Signature:', x + 3.5, sigY + 25);
      doc.setDrawColor(100, 116, 139);
      doc.setLineWidth(0.3);
      doc.line(x + 4, sigY + 37, x + colWidth - 4, sigY + 37);
    }

    const signedDate = cfg.slot?.signedAt
      ? cfg.slot.signedAt.slice(0, 10)
      : cfg.slot?.signature
      ? invoice.date
      : '';
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(51, 65, 85);
    doc.text(
      `Date: ${signedDate || '____ / ____ / 20____'}`,
      x + 3.5,
      sigY + 46.5
    );
  });

  // 6. Official Footer Strip
  doc.setDrawColor(203, 213, 225);
  doc.line(10, pageHeight - 14, pageWidth - 10, pageHeight - 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `LG PLAST — Affordable / Durable / Complete  •  Recycling Scrap Sales Invoice (${invoice.invoiceNo})  •  Generated ${new Date().toLocaleString()}`,
    pageWidth / 2,
    pageHeight - 9,
    { align: 'center' }
  );

  saveFileBlob(`LGPLAST_Scrap_Sales_Invoice_${invoice.invoiceNo}_${invoice.date}.pdf`, doc.output('blob'));
}
