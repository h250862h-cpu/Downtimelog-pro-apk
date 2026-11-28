import { jsPDF } from 'jspdf';
import { ScrapSalesInvoice } from '../types';
import { saveFileBlob } from './downtimeCalc';
import { drawLgplastPdfHeader, ensureLgplastLogoLoaded } from './reportPdf';

/**
 * Generates the official LG PLAST Recycling Scrap Sales Invoice PDF (Portrait A4)
 * structured like the Diesel Fuel Issue Voucher: NO tables, clean card/voucher layout,
 * LG PLAST Logo header with formal heading, showing ONLY Total KG, Total Cost, and
 * Invoice Amount Due, plus the formatted 3-signature authorization block.
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
    'LG PLAST (PVT) LTD  •  OFFICIAL RECYCLING SCRAP SALES INVOICE',
    [
      `Invoice: ${invoice.invoiceNo}`,
      `Date: ${invoice.date}`,
      `Status: ${invoice.status}`,
    ]
  );

  // 2. Sub-header Reference Strip (matching Diesel Request Voucher header strip)
  doc.setFillColor(241, 245, 249);
  doc.rect(10, 33, pageWidth - 20, 9, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.rect(10, 33, pageWidth - 20, 9, 'S');
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text(`Invoice No: ${invoice.invoiceNo}  •  Status: ${invoice.status}`, 13, 38.7);
  doc.text(
    `Date: ${invoice.date}  |  Currency: USD ($)`,
    pageWidth - 13,
    38.7,
    { align: 'right' }
  );

  // 3. Clean Invoice & Customer Particulars Card (NO table)
  const detailsY = 47;
  const detailsH = 64;
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(10, detailsY, pageWidth - 20, detailsH, 2, 2, 'FD');

  doc.setFillColor(15, 47, 102);
  doc.rect(10, detailsY, pageWidth - 20, 7.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(255, 255, 255);
  doc.text('INVOICE & CUSTOMER PARTICULARS', 14, detailsY + 5.1);

  const detailFields: Array<[string, string]> = [
    ['Invoice Number', invoice.invoiceNo],
    ['Invoice Date', invoice.date],
    ['Buyer / Customer Name', invoice.buyerName || 'Walk-in / Cash Buyer'],
    ['Buyer Contact / Phone', invoice.buyerPhone || 'N/A'],
    ['Vehicle / Collection Reg', invoice.vehicleReg || 'N/A'],
    ['Prepared / Issued By', invoice.preparedByName || 'Plant Operator'],
    ['Payment Status', invoice.status === 'PAID' ? 'PAID (SETTLED)' : 'ISSUED (AMOUNT DUE)'],
    ['Remarks / Scale Ref', invoice.notes || 'Recycling scrap sale & dispatch'],
  ];

  let rowY = detailsY + 13.5;
  detailFields.forEach(([label, val], idx) => {
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(10.5, rowY - 4.2, pageWidth - 21, 6.2, 'F');
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(71, 85, 105);
    doc.text(`${label}:`, 14, rowY);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(val, 68, rowY, { maxWidth: pageWidth - 82 });
    rowY += 6.3;
  });

  // 4. Clean Invoice Summary Card (NO tables — ONLY Total KG, Total Cost, and Invoice Amount Due)
  const summaryY = detailsY + detailsH + 8;
  const summaryH = 48;
  doc.setDrawColor(148, 163, 184);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(10, summaryY, pageWidth - 20, summaryH, 2.2, 2.2, 'FD');

  doc.setFillColor(30, 58, 95);
  doc.rect(10, summaryY, pageWidth - 20, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text('INVOICE SUMMARY', 14, summaryY + 5.4);

  // Row 1: TOTAL KG
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(51, 65, 85);
  doc.text('TOTAL KG', 15, summaryY + 17);
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(
    `${invoice.totalNetKg.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} kg`,
    pageWidth - 15,
    summaryY + 17,
    { align: 'right' }
  );

  doc.setDrawColor(226, 232, 240);
  doc.line(15, summaryY + 21, pageWidth - 15, summaryY + 21);

  // Row 2: TOTAL COST
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(51, 65, 85);
  doc.text('TOTAL COST', 15, summaryY + 29);
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(`$${invoice.totalCost.toFixed(2)}`, pageWidth - 15, summaryY + 29, { align: 'right' });

  // Highlighted Bar: INVOICE AMOUNT DUE
  doc.setFillColor(15, 47, 102);
  doc.roundedRect(12, summaryY + 34, pageWidth - 24, 11, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(255, 255, 255);
  doc.text('INVOICE AMOUNT DUE', 16, summaryY + 41.2);
  doc.setFontSize(12);
  doc.setTextColor(167, 243, 208);
  doc.text(`$${invoice.totalCost.toFixed(2)}`, pageWidth - 16, summaryY + 41.2, { align: 'right' });

  // 5. Three Signatures Block (Formatted for 3 Signatures — Digital or Manual Ink Sign-Off)
  let sigY = summaryY + summaryH + 12;
  const sigBoxH = 52;
  if (sigY + sigBoxH + 16 > pageHeight) {
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
