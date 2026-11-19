import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DieselFuelRequest, DieselGrnRecord, DieselTankConfig } from '../types';
import { saveFileBlob } from './downtimeCalc';
import { drawLgplastPdfHeader, ensureLgplastLogoLoaded } from './reportPdf';

/**
 * Generates Official Portrait A4 Fuel Request Authorization PDF with LG PLAST Logo
 * Used for 1-time Production HOD approval voucher & printable/digital Bowser Meter fill-in.
 */
export async function generateFuelRequestApprovalPdf(
  req: DieselFuelRequest,
  tank: DieselTankConfig
) {
  await ensureLgplastLogoLoaded();
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();

  drawLgplastPdfHeader(
    doc,
    'DIESEL BOWSER FUEL ISSUE VOUCHER',
    'AUTHORIZED FORKLIFT & FLEET FUEL RELEASE FORM',
    [
      `Voucher: ${req.requestNo}`,
      `Date: ${req.date} (${req.shift})`,
      `Status: ${req.status.replace(/_/g, ' ')}`,
    ]
  );

  // Sub-header tank reference strip
  doc.setFillColor(241, 245, 249);
  doc.rect(10, 33, pageWidth - 20, 9, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.rect(10, 33, pageWidth - 20, 9, 'S');
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text(`Tank: ${tank.tankName}`, 13, 38.7);
  doc.text(
    `Opening Tank Level: ${tank.currentLevelLitres.toLocaleString()} L  |  Current Bowser Meter: ${tank.currentMeterReading.toLocaleString()}`,
    pageWidth - 13,
    38.7,
    { align: 'right' }
  );

  // Request & HOD Approval Details Table
  autoTable(doc, {
    startY: 46,
    margin: { left: 10, right: 10 },
    head: [['Authorization Field', 'Recorded Particulars']],
    body: [
      ['Voucher / Request No.', req.requestNo],
      ['Date & Shift', `${req.date}  •  ${req.shift} Shift`],
      ['Vehicle / Forklift / Equipment', req.vehicleOrForklift],
      ['Driver / Requester Name', req.driverName],
      ['Fuel Requested (Litres)', `${req.requestedLitres.toFixed(2)} Litres`],
      [
        'Approved Allowance (HOD)',
        `${(req.hodApprovedLitres ?? req.requestedLitres).toFixed(2)} Litres`,
      ],
      ['Purpose / Operational Area', req.purpose || 'Factory Forklift & Material Handling'],
      ['Production HOD Decision', req.hodApprovedBy ? `APPROVED BY ${req.hodApprovedBy}` : 'PENDING'],
      ['HOD Approval Remarks', req.hodNotes || 'Standard authorized issue from Bowser Tank'],
    ],
    styles: { fontSize: 8.5, cellPadding: 2.8, textColor: [15, 23, 42] },
    headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 68, fontStyle: 'bold', textColor: [51, 65, 85] },
      1: { cellWidth: 122 },
    },
  });

  // Bowser Meter Readings Block (for easy filling on paper OR displaying digital dispensed readings)
  const afterReqY = ((doc as any).lastAutoTable?.finalY || 125) + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 47, 102);
  doc.text('BOWSER TANK METER READING & FUEL TAKEN RECORD', 10, afterReqY);

  autoTable(doc, {
    startY: afterReqY + 3,
    margin: { left: 10, right: 10 },
    head: [['Bowser Flow Meter Check', 'Reading / Value (Litres)', 'Verification Notes']],
    body: [
      [
        '1. First Meter Reading (Before Taking Fuel)',
        typeof req.firstMeterReading === 'number'
          ? `${req.firstMeterReading.toFixed(2)}`
          : '__________________________',
        'Record before opening bowser nozzle',
      ],
      [
        '2. Second Meter Reading (After Taking Fuel)',
        typeof req.secondMeterReading === 'number'
          ? `${req.secondMeterReading.toFixed(2)}`
          : '__________________________',
        'Record immediately after nozzle shut-off',
      ],
      [
        '3. Net Diesel Taken (Second - First Meter)',
        typeof req.actualLitresTaken === 'number'
          ? `${req.actualLitresTaken.toFixed(2)} Litres`
          : '____________________ Litres',
        'Automatically deducts from Bowser Tank Level',
      ],
      [
        '4. Bowser Tank Level After Issue (L)',
        typeof req.tankLevelAfter === 'number'
          ? `${req.tankLevelAfter.toFixed(2)} Litres`
          : '____________________ Litres',
        typeof req.tankLevelBefore === 'number'
          ? `Before Issue: ${req.tankLevelBefore.toFixed(2)} L`
          : 'Verify balance after dispense',
      ],
    ],
    styles: { fontSize: 8.5, cellPadding: 3.2, textColor: [15, 23, 42] },
    headStyles: { fillColor: [2, 132, 199], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 74, fontStyle: 'bold' },
      1: { cellWidth: 56, halign: 'center', fontStyle: 'bold' },
      2: { cellWidth: 60 },
    },
  });

  // Signatures Block (Portrait 3 Boxes Stacked / Side by Side)
  const sigY = ((doc as any).lastAutoTable?.finalY || 195) + 10;
  doc.setDrawColor(148, 163, 184);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(10, sigY, pageWidth - 20, 44, 2, 2, 'FD');

  // 1. Driver Request Signature
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);
  doc.text('1. DRIVER / REQUESTER SIGN', 13, sigY + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(`Name: ${req.driverName}`, 13, sigY + 11.5);
  if (req.driverRequestSignature) {
    try {
      doc.addImage(req.driverRequestSignature, 'PNG', 13, sigY + 14, 48, 18);
    } catch {}
  } else {
    doc.text('Sign: _______________________', 13, sigY + 30);
  }

  // 2. Production HOD Approval Signature
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('2. PRODUCTION HOD APPROVAL', 76, sigY + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(`HOD: ${req.hodApprovedBy || '__________________'}`, 76, sigY + 11.5);
  if (req.hodSignature) {
    try {
      doc.addImage(req.hodSignature, 'PNG', 76, sigY + 14, 48, 18);
    } catch {}
  } else {
    doc.text('Sign: _______________________', 76, sigY + 30);
  }

  // 3. Driver Dispense Receipt Signature (fill-in on voucher or digital)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('3. DISPENSE METER SIGN', 139, sigY + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(`Driver: ${req.driverName}`, 139, sigY + 11.5);
  if (req.driverDispenseSignature) {
    try {
      doc.addImage(req.driverDispenseSignature, 'PNG', 139, sigY + 14, 48, 18);
    } catch {}
  } else {
    doc.text('Sign: _______________________', 139, sigY + 30);
  }

  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text(
    'LG PLAST Factory Diesel Control  •  Generating this approval voucher unlocks Stage 3 Bowser Meter Entry for the Forklift Driver.',
    10,
    286
  );

  saveFileBlob(`LGPLAST_Fuel_Voucher_${req.requestNo}_${req.date}.pdf`, doc.output('blob'));
}

/**
 * Generates Official Portrait A4 Fuel GRN (Goods Received Note) PDF with LG PLAST Logo
 */
export async function generateFuelGrnPdf(grn: DieselGrnRecord) {
  await ensureLgplastLogoLoaded();
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();

  drawLgplastPdfHeader(
    doc,
    'DIESEL BOWSER TANK GRN',
    'GOODS RECEIVED NOTE  •  BULK FUEL OFFLOAD & METER VERIFICATION',
    [
      `GRN No: ${grn.grnNo}`,
      `Date: ${grn.date} (${grn.shift})`,
      `Litres: +${grn.litresAdded.toFixed(2)} L`,
    ]
  );

  autoTable(doc, {
    startY: 38,
    margin: { left: 10, right: 10 },
    head: [['Fuel Delivery & Tank Receipt Field', 'Verified Record']],
    body: [
      ['GRN Reference Number', grn.grnNo],
      ['Date & Shift', `${grn.date}  •  ${grn.shift} Shift`],
      ['Fuel Supplier Name', grn.supplierName],
      ['Supplier Delivery Note / Invoice No.', grn.deliveryNoteNo || 'N/A'],
      ['Receiving Officer (LG PLAST)', grn.receiverName],
      ['HOD / Admin Verifier', grn.hodVerifiedBy || grn.receiverName],
      ['First Meter Reading (Before Offload)', grn.firstMeterReading.toFixed(2)],
      ['Second Meter Reading (After Offload)', grn.secondMeterReading.toFixed(2)],
      ['Net Litres Added into Bowser Tank', `+${grn.litresAdded.toFixed(2)} Litres`],
      ['Tank Level Before Offload', `${grn.tankLevelBefore.toFixed(2)} Litres`],
      ['Tank Level After Offload (Updated)', `${grn.tankLevelAfter.toFixed(2)} Litres`],
      [
        'Unit Price / Total Value',
        typeof grn.unitPrice === 'number' && grn.unitPrice > 0
          ? `$${grn.unitPrice.toFixed(2)} / L   (Total: $${(grn.totalCost || grn.unitPrice * grn.litresAdded).toFixed(2)})`
          : 'Not specified',
      ],
      ['Delivery Remarks / Seals Check', grn.notes || 'Sealed & verified clean offload'],
    ],
    styles: { fontSize: 8.5, cellPadding: 2.8, textColor: [15, 23, 42] },
    headStyles: { fillColor: [15, 47, 102], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 74, fontStyle: 'bold', textColor: [51, 65, 85] },
      1: { cellWidth: 116 },
    },
  });

  // Signatures Block
  const sigY = ((doc as any).lastAutoTable?.finalY || 170) + 10;
  doc.setDrawColor(148, 163, 184);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(10, sigY, pageWidth - 20, 44, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('1. SUPPLIER REPRESENTATIVE SIGNATURE', 15, sigY + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`Supplier: ${grn.supplierName}`, 15, sigY + 12.5);
  if (grn.supplierSignature) {
    try {
      doc.addImage(grn.supplierSignature, 'PNG', 15, sigY + 15, 65, 20);
    } catch {}
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('2. LG PLAST RECEIVER SIGNATURE', 110, sigY + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`Receiver: ${grn.receiverName}`, 110, sigY + 12.5);
  if (grn.receiverSignature) {
    try {
      doc.addImage(grn.receiverSignature, 'PNG', 110, sigY + 15, 65, 20);
    } catch {}
  }

  saveFileBlob(`LGPLAST_Fuel_GRN_${grn.grnNo}_${grn.date}.pdf`, doc.output('blob'));
}
