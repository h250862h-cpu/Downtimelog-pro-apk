import { strToU8, zipSync } from 'fflate';
import type { WorkBook, WorkSheet } from '../utils/xlsxCompat';

function colIndexToLetter(colIdx: number): string {
  let n = colIdx + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters || 'A';
}

function escapeXmlText(input: unknown): string {
  const s = String(input ?? '').replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,
    ''
  );
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function serializeWorksheetXml(ws: WorkSheet): string {
  const grid = Array.isArray(ws['!aoa']) ? ws['!aoa'] : [];
  const colsMeta = Array.isArray(ws['!cols']) ? ws['!cols'] : [];

  let colsXml = '';
  if (colsMeta.length > 0) {
    const colEntries = colsMeta
      .map((col, idx) => {
        const w = col?.wch ?? col?.width;
        if (!w || !Number.isFinite(w)) return '';
        return `<col min="${idx + 1}" max="${idx + 1}" width="${Number(w).toFixed(2)}" customWidth="1"/>`;
      })
      .filter(Boolean)
      .join('');
    if (colEntries) {
      colsXml = `<cols>${colEntries}</cols>`;
    }
  }

  const rowXmlParts: string[] = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row) || row.length === 0) continue;
    const cellXmlParts: string[] = [];
    for (let c = 0; c < row.length; c++) {
      const val = row[c];
      if (val === undefined || val === null || val === '') continue;
      const cellRef = `${colIndexToLetter(c)}${r + 1}`;
      const styleAttr = r === 0 ? ' s="1"' : '';
      if (typeof val === 'number' && Number.isFinite(val)) {
        cellXmlParts.push(`<c r="${cellRef}"${styleAttr}><v>${val}</v></c>`);
      } else if (typeof val === 'boolean') {
        cellXmlParts.push(`<c r="${cellRef}" t="b"${styleAttr}><v>${val ? 1 : 0}</v></c>`);
      } else if (val instanceof Date && !Number.isNaN(val.getTime())) {
        const iso = val.toISOString().slice(0, 19).replace('T', ' ');
        cellXmlParts.push(
          `<c r="${cellRef}" t="inlineStr"${styleAttr}><is><t>${escapeXmlText(iso)}</t></is></c>`
        );
      } else {
        const str = String(val);
        const preserveSpace = /^\s|\s$/.test(str) ? ' xml:space="preserve"' : '';
        cellXmlParts.push(
          `<c r="${cellRef}" t="inlineStr"${styleAttr}><is><t${preserveSpace}>${escapeXmlText(str)}</t></is></c>`
        );
      }
    }
    if (cellXmlParts.length > 0) {
      rowXmlParts.push(`<row r="${r + 1}">${cellXmlParts.join('')}</row>`);
    }
  }

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    colsXml +
    `<sheetData>${rowXmlParts.join('')}</sheetData>` +
    `</worksheet>`
  );
}

const MINIMAL_STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2">` +
  `<font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
  `</fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `</cellXfs>` +
  `</styleSheet>`;

function buildXlsxBytes(wb: WorkBook): ArrayBuffer {
  const sheetNames = wb.SheetNames.length > 0 ? wb.SheetNames : ['Sheet1'];
  const entries: Record<string, Uint8Array> = {};

  const overrideTags: string[] = [
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`,
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`,
  ];
  const wbSheetTags: string[] = [];
  const wbRelTags: string[] = [];

  sheetNames.forEach((name, idx) => {
    const sheetNum = idx + 1;
    const relId = `rId${sheetNum}`;
    const ws = wb.Sheets[name] || { '!aoa': [] };
    entries[`xl/worksheets/sheet${sheetNum}.xml`] = strToU8(serializeWorksheetXml(ws));
    overrideTags.push(
      `<Override PartName="/xl/worksheets/sheet${sheetNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    );
    wbSheetTags.push(
      `<sheet name="${escapeXmlText(name)}" sheetId="${sheetNum}" r:id="${relId}"/>`
    );
    wbRelTags.push(
      `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetNum}.xml"/>`
    );
  });

  const stylesRelId = `rId${sheetNames.length + 1}`;
  wbRelTags.push(
    `<Relationship Id="${stylesRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
  );

  entries['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      overrideTags.join('') +
      `</Types>`
  );

  entries['_rels/.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`
  );

  entries['xl/workbook.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>${wbSheetTags.join('')}</sheets>` +
      `</workbook>`
  );

  entries['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      wbRelTags.join('') +
      `</Relationships>`
  );

  entries['xl/styles.xml'] = strToU8(MINIMAL_STYLES_XML);

  const zipped = zipSync(entries, { level: 6 });
  const copy = new Uint8Array(new ArrayBuffer(zipped.byteLength));
  copy.set(zipped);
  return copy.buffer;
}

self.onmessage = (event: MessageEvent<{ id: number; wb: WorkBook }>) => {
  const { id, wb } = event.data;
  try {
    const buffer = buildXlsxBytes(wb);
    (self as unknown as Worker).postMessage({ id, ok: true, buffer }, [buffer]);
  } catch (err: any) {
    (self as unknown as Worker).postMessage({
      id,
      ok: false,
      error: err?.message || 'Background Excel worker failed',
    });
  }
};
