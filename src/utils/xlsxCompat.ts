import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export interface WorkSheetCol {
  wch?: number;
  width?: number;
}

export interface WorkSheet {
  '!aoa': any[][];
  '!cols'?: WorkSheetCol[];
  '!ref'?: string;
  [cell: string]: any;
}

export interface WorkBook {
  SheetNames: string[];
  Sheets: Record<string, WorkSheet>;
}

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

function letterToColIndex(letters: string): number {
  let col = 0;
  const upper = letters.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    col = col * 26 + (upper.charCodeAt(i) - 64);
  }
  return Math.max(0, col - 1);
}

function parseCellOrigin(origin?: string | { r: number; c: number }): { r: number; c: number } {
  if (!origin) return { r: 0, c: 0 };
  if (typeof origin === 'object') {
    return { r: Math.max(0, origin.r || 0), c: Math.max(0, origin.c || 0) };
  }
  const m = String(origin).trim().match(/^([A-Za-z]+)(\d+)$/);
  if (!m) return { r: 0, c: 0 };
  return {
    r: Math.max(0, parseInt(m[2], 10) - 1),
    c: letterToColIndex(m[1]),
  };
}

function escapeXmlText(input: unknown): string {
  const s = String(input ?? '')
    // Remove illegal XML 1.0 control characters while preserving \t \n \r
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeSheetName(name: string, existingNames: string[]): string {
  let base = (name || 'Sheet')
    .replace(/[\\/?*[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31);
  if (!base) base = 'Sheet';
  let candidate = base;
  let counter = 2;
  while (existingNames.some((n) => n.toLowerCase() === candidate.toLowerCase())) {
    const suffix = ` (${counter++})`;
    candidate = base.slice(0, Math.max(1, 31 - suffix.length)) + suffix;
  }
  return candidate;
}

function setGridValue(grid: any[][], r: number, c: number, val: any) {
  while (grid.length <= r) grid.push([]);
  while (grid[r].length <= c) grid[r].push('');
  grid[r][c] = val ?? '';
}

function buildWorksheetRef(grid: any[][]): string {
  const rows = Math.max(1, grid.length);
  const cols = Math.max(
    1,
    grid.reduce((max, row) => Math.max(max, row ? row.length : 0), 0)
  );
  return `A1:${colIndexToLetter(cols - 1)}${rows}`;
}

function collectJsonHeaders(rows: Record<string, any>[]): string[] {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }
  return headers;
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

function isDateNumberFormat(numFmtId: number, formatCode?: string): boolean {
  if ((numFmtId >= 14 && numFmtId <= 22) || (numFmtId >= 45 && numFmtId <= 47)) {
    return true;
  }
  if (!formatCode) return false;
  const cleaned = formatCode.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  return /[ymdh]/i.test(cleaned);
}

function excelSerialToDate(serial: number): Date {
  // Excel epoch: 1899-12-30 UTC (accounts for 1900 leap year bug)
  const utcDays = serial - 25569;
  const utcMs = Math.round(utcDays * 86400 * 1000);
  return new Date(utcMs);
}

function parseSharedStringsXml(xmlText: string): string[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const items = Array.from(doc.getElementsByTagNameNS('*', 'si'));
  return items.map((si) => {
    const tNodes = Array.from(si.getElementsByTagNameNS('*', 't'));
    return tNodes.map((t) => t.textContent || '').join('');
  });
}

function parseStyleDateFlags(xmlText: string): boolean[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const customFmts = new Map<number, string>();
  Array.from(doc.getElementsByTagNameNS('*', 'numFmt')).forEach((el) => {
    const id = Number(el.getAttribute('numFmtId'));
    const code = el.getAttribute('formatCode') || '';
    if (Number.isFinite(id)) customFmts.set(id, code);
  });
  const cellXfsEl = doc.getElementsByTagNameNS('*', 'cellXfs')[0];
  if (!cellXfsEl) return [];
  const xfs = Array.from(cellXfsEl.getElementsByTagNameNS('*', 'xf'));
  return xfs.map((xf) => {
    const fmtId = Number(xf.getAttribute('numFmtId') || 0);
    return isDateNumberFormat(fmtId, customFmts.get(fmtId));
  });
}

function parseWorksheetXml(
  xmlText: string,
  sharedStrings: string[],
  styleDateFlags: boolean[],
  cellDates: boolean
): WorkSheet {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const grid: any[][] = [];
  const rows = Array.from(doc.getElementsByTagNameNS('*', 'row'));

  rows.forEach((rowEl, rowSeqIdx) => {
    const rowAttr = Number(rowEl.getAttribute('r'));
    const rowIdx = Number.isFinite(rowAttr) && rowAttr > 0 ? rowAttr - 1 : rowSeqIdx;
    const cells = Array.from(rowEl.getElementsByTagNameNS('*', 'c'));

    cells.forEach((cellEl, colSeqIdx) => {
      const refAttr = cellEl.getAttribute('r') || '';
      const refMatch = refAttr.match(/^([A-Za-z]+)(\d+)$/);
      const rIdx = refMatch ? Math.max(0, parseInt(refMatch[2], 10) - 1) : rowIdx;
      const cIdx = refMatch ? letterToColIndex(refMatch[1]) : colSeqIdx;
      const cellType = cellEl.getAttribute('t') || 'n';
      const styleIdx = Number(cellEl.getAttribute('s') || 0);
      const vEl = cellEl.getElementsByTagNameNS('*', 'v')[0];
      const rawVal = vEl?.textContent ?? '';

      let parsed: any = '';
      if (cellType === 's') {
        const sIdx = Number(rawVal);
        parsed = Number.isFinite(sIdx) ? (sharedStrings[sIdx] ?? '') : '';
      } else if (cellType === 'inlineStr') {
        const tNodes = Array.from(cellEl.getElementsByTagNameNS('*', 't'));
        parsed = tNodes.map((t) => t.textContent || '').join('');
      } else if (cellType === 'str' || cellType === 'e') {
        parsed = rawVal;
      } else if (cellType === 'b') {
        parsed = rawVal === '1' || rawVal.toLowerCase() === 'true';
      } else {
        if (rawVal === '') {
          parsed = '';
        } else {
          const num = Number(rawVal);
          if (Number.isFinite(num)) {
            if (cellDates && styleDateFlags[styleIdx]) {
              parsed = excelSerialToDate(num);
            } else {
              parsed = num;
            }
          } else {
            parsed = rawVal;
          }
        }
      }

      if (parsed !== '') {
        setGridValue(grid, rIdx, cIdx, parsed);
      }
    });
  });

  return {
    '!aoa': grid,
    '!ref': buildWorksheetRef(grid),
  };
}

function parseCsvToGrid(text: string): any[][] {
  const rows: any[][] = [];
  let row: any[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export const utils = {
  book_new(): WorkBook {
    return { SheetNames: [], Sheets: {} };
  },

  aoa_to_sheet(aoa: any[][]): WorkSheet {
    const grid = (Array.isArray(aoa) ? aoa : []).map((row) =>
      Array.isArray(row) ? row.map((v) => (v === undefined || v === null ? '' : v)) : []
    );
    return {
      '!aoa': grid,
      '!ref': buildWorksheetRef(grid),
    };
  },

  json_to_sheet(rows: Record<string, any>[]): WorkSheet {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { '!aoa': [], '!ref': 'A1:A1' };
    }
    const headers = collectJsonHeaders(rows);
    const grid: any[][] = [headers];
    for (const row of rows) {
      grid.push(headers.map((h) => (row && row[h] !== undefined && row[h] !== null ? row[h] : '')));
    }
    return {
      '!aoa': grid,
      '!ref': buildWorksheetRef(grid),
    };
  },

  sheet_add_json(
    ws: WorkSheet,
    rows: Record<string, any>[],
    options?: { origin?: string | { r: number; c: number }; skipHeader?: boolean }
  ): WorkSheet {
    if (!Array.isArray(rows) || rows.length === 0) return ws;
    const grid = Array.isArray(ws['!aoa']) ? ws['!aoa'] : (ws['!aoa'] = []);
    const { r: startRow, c: startCol } = parseCellOrigin(options?.origin);
    const headers = collectJsonHeaders(rows);
    let cursorRow = startRow;

    if (!options?.skipHeader) {
      headers.forEach((h, idx) => setGridValue(grid, cursorRow, startCol + idx, h));
      cursorRow++;
    }

    for (const row of rows) {
      headers.forEach((h, idx) => {
        const val = row && row[h] !== undefined && row[h] !== null ? row[h] : '';
        setGridValue(grid, cursorRow, startCol + idx, val);
      });
      cursorRow++;
    }

    ws['!ref'] = buildWorksheetRef(grid);
    return ws;
  },

  book_append_sheet(wb: WorkBook, ws: WorkSheet, name: string) {
    const safeName = sanitizeSheetName(name, wb.SheetNames);
    wb.SheetNames.push(safeName);
    wb.Sheets[safeName] = ws;
  },

  sheet_to_json<T = any>(
    ws: WorkSheet,
    options?: { header?: 1 | string[]; defval?: any }
  ): T[] {
    const grid = Array.isArray(ws?.['!aoa']) ? ws['!aoa'] : [];
    const defval = options && 'defval' in options ? options.defval : '';

    if (options?.header === 1) {
      const maxCols = grid.reduce((m, r) => Math.max(m, r?.length || 0), 0);
      return grid.map((r) => {
        const rowOut: any[] = [];
        for (let c = 0; c < maxCols; c++) {
          const val = r?.[c];
          rowOut.push(val === undefined || val === null ? defval : val);
        }
        return rowOut;
      }) as unknown as T[];
    }

    if (grid.length < 2) return [];
    const headers = (grid[0] || []).map((h, i) => {
      const s = String(h ?? '').trim();
      return s || `__EMPTY_${i}`;
    });

    const result: Record<string, any>[] = [];
    for (let r = 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const hasContent = row.some((v) => v !== undefined && v !== null && String(v).trim() !== '');
      if (!hasContent) continue;
      const obj: Record<string, any> = {};
      headers.forEach((h, idx) => {
        const val = row[idx];
        obj[h] = val === undefined || val === null ? defval : val;
      });
      result.push(obj);
    }
    return result as T[];
  },
};

export function read(
  data: ArrayBuffer | Uint8Array | string,
  options?: { type?: 'array' | 'string' | 'buffer'; cellDates?: boolean }
): WorkBook {
  const cellDates = Boolean(options?.cellDates);
  const bytes =
    typeof data === 'string'
      ? strToU8(data)
      : data instanceof Uint8Array
      ? data
      : new Uint8Array(data);

  // Check OLE2 legacy binary .xls signature (D0 CF 11 E0)
  if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new Error('Legacy binary .xls file detected. Please Save As .xlsx or .csv in Excel and upload again.');
  }

  // Check ZIP (.xlsx) signature (50 4B)
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const archive = unzipSync(bytes);
    const getEntryText = (path: string): string | null => {
      const normalized = path.replace(/^\/+/, '');
      const hit =
        archive[normalized] ||
        archive[Object.keys(archive).find((k) => k.toLowerCase() === normalized.toLowerCase()) || ''];
      return hit ? strFromU8(hit) : null;
    };

    const sharedXml = getEntryText('xl/sharedStrings.xml');
    const sharedStrings = sharedXml ? parseSharedStringsXml(sharedXml) : [];

    const stylesXml = getEntryText('xl/styles.xml');
    const styleDateFlags = stylesXml ? parseStyleDateFlags(stylesXml) : [];

    const wbXml = getEntryText('xl/workbook.xml');
    const relsXml = getEntryText('xl/_rels/workbook.xml.rels');

    const wb: WorkBook = { SheetNames: [], Sheets: {} };
    if (wbXml && relsXml) {
      const parser = new DOMParser();
      const relDoc = parser.parseFromString(relsXml, 'application/xml');
      const relTargets = new Map<string, string>();
      Array.from(relDoc.getElementsByTagNameNS('*', 'Relationship')).forEach((el) => {
        const id = el.getAttribute('Id') || '';
        const target = el.getAttribute('Target') || '';
        if (id && target) {
          relTargets.set(id, target.startsWith('xl/') ? target : `xl/${target.replace(/^\/+/, '')}`);
        }
      });

      const wbDoc = parser.parseFromString(wbXml, 'application/xml');
      const sheetEls = Array.from(wbDoc.getElementsByTagNameNS('*', 'sheet'));
      sheetEls.forEach((sEl, idx) => {
        const name = sEl.getAttribute('name') || `Sheet${idx + 1}`;
        const rId =
          sEl.getAttribute('r:id') ||
          sEl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ||
          '';
        const target = relTargets.get(rId) || `xl/worksheets/sheet${idx + 1}.xml`;
        const wsXml = getEntryText(target);
        if (wsXml) {
          wb.SheetNames.push(name);
          wb.Sheets[name] = parseWorksheetXml(wsXml, sharedStrings, styleDateFlags, cellDates);
        }
      });
    }

    // Fallback scan if workbook.xml relationships omitted any sheets
    if (wb.SheetNames.length === 0) {
      Object.keys(archive)
        .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
        .sort()
        .forEach((k, idx) => {
          const name = `Sheet${idx + 1}`;
          wb.SheetNames.push(name);
          wb.Sheets[name] = parseWorksheetXml(strFromU8(archive[k]), sharedStrings, styleDateFlags, cellDates);
        });
    }

    return wb;
  }

  // Fallback: CSV / plain text spreadsheet
  const text = strFromU8(bytes);
  const grid = parseCsvToGrid(text);
  return {
    SheetNames: ['Sheet1'],
    Sheets: {
      Sheet1: {
        '!aoa': grid,
        '!ref': buildWorksheetRef(grid),
      },
    },
  };
}

export function write(
  wb: WorkBook,
  _options?: { bookType?: 'xlsx'; type?: 'array' | 'uint8array' }
): Uint8Array<ArrayBuffer> {
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
  return copy;
}
