// Treats one sheet (tab) of a Google Spreadsheet as a table with a header row
// and an `id` column. All domain services are built on top of this.

import { client } from './client.js';
import { toNumber } from '../lib/format.js';

export function colLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export class Table {
  /**
   * @param {string} spreadsheetId
   * @param {string} sheetTitle
   * @param {Array<{key:string,type?:'number'|'text'}>} columns
   */
  constructor(spreadsheetId, sheetTitle, columns, sheetId = null) {
    this.spreadsheetId = spreadsheetId;
    this.sheetTitle = sheetTitle;
    this.columns = columns;
    this.sheetId = sheetId;
    this.headers = columns.map((c) => c.key);
    this.rows = [];
  }

  get lastCol() { return colLetter(this.headers.length - 1); }

  headerRow() { return this.columns.map((c) => c.key); }

  toRecord(values, rowNumber) {
    const rec = { _row: rowNumber };
    this.headers.forEach((key, i) => {
      const col = this.columns.find((c) => c.key === key);
      const v = values[i];
      if (col?.type === 'number') rec[key] = v === '' || v === undefined || v === null ? 0 : toNumber(v);
      else rec[key] = v === undefined || v === null ? '' : String(v);
    });
    return rec;
  }

  toValues(rec) {
    return this.headers.map((key) => {
      const col = this.columns.find((c) => c.key === key);
      const v = rec[key];
      if (col?.type === 'number') return toNumber(v);
      if (v === undefined || v === null) return '';
      // Written with valueInputOption=RAW, so text is stored verbatim and never parsed as a formula.
      return String(v);
    });
  }

  async load() {
    const values = await client().getValues(this.spreadsheetId, this.sheetTitle, `A1:${colLetter(Math.max(this.columns.length, 26) - 1)}`);
    const header = values[0] || [];
    if (header.length) {
      // Respect the sheet's header order, then append any columns this version knows but the sheet lacks.
      const known = new Set(this.columns.map((c) => c.key));
      this.headers = header.map((x) => String(x));
      for (const c of this.columns) if (!this.headers.includes(c.key)) this.headers.push(c.key);
      if (this.headers.length !== header.length && this.headers.some((h) => known.has(h))) {
        await client().setValues(this.spreadsheetId, this.sheetTitle, `A1:${this.lastCol}1`, [this.headers]);
      }
    } else {
      await client().setValues(this.spreadsheetId, this.sheetTitle, `A1:${this.lastCol}1`, [this.headerRow()]);
    }
    this.rows = values.slice(1).map((row, i) => this.toRecord(row, i + 2)).filter((r) => r.id);
    return this.rows;
  }

  async idIndex() {
    const values = await client().getValues(this.spreadsheetId, this.sheetTitle, 'A2:A');
    const map = new Map();
    values.forEach((row, i) => { if (row[0]) map.set(String(row[0]), i + 2); });
    return map;
  }

  async insert(records) {
    if (!records.length) return [];
    await client().appendValues(this.spreadsheetId, this.sheetTitle, records.map((r) => this.toValues(r)));
    return records;
  }

  async update(id, patch) {
    return this.bulkUpdate([{ id, patch }]);
  }

  /** @param {Array<{id:string, patch:object}>} changes */
  async bulkUpdate(changes) {
    if (!changes.length) return;
    const index = await this.idIndex();
    const byId = new Map(this.rows.map((r) => [r.id, r]));
    const data = [];
    for (const { id, patch } of changes) {
      const rowNum = index.get(id);
      if (!rowNum) continue;
      const base = byId.get(id) || { id };
      const merged = { ...base, ...patch };
      byId.set(id, merged);
      data.push({ sheetTitle: this.sheetTitle, range: `A${rowNum}:${this.lastCol}${rowNum}`, values: [this.toValues(merged)] });
    }
    await client().batchSetValues(this.spreadsheetId, data);
    // Mutate in place so views holding references to rows stay current.
    for (const r of this.rows) { const m = byId.get(r.id); if (m && m !== r) Object.assign(r, m); }
  }

  async delete(ids) {
    if (!ids.length) return;
    if (this.sheetId === null) await this.resolveSheetId();
    const index = await this.idIndex();
    const rowNums = ids.map((id) => index.get(id)).filter(Boolean).sort((a, b) => b - a);
    const requests = rowNums.map((n) => ({ deleteDimension: { range: { sheetId: this.sheetId, dimension: 'ROWS', startIndex: n - 1, endIndex: n } } }));
    await client().sheetsBatchUpdate(this.spreadsheetId, requests);
    const gone = new Set(ids);
    const kept = this.rows.filter((r) => !gone.has(r.id));
    this.rows.splice(0, this.rows.length, ...kept);
  }

  async replaceAll(records) {
    await client().clearValues(this.spreadsheetId, this.sheetTitle, `A2:${this.lastCol}`);
    if (records.length) await client().setValues(this.spreadsheetId, this.sheetTitle, `A2:${this.lastCol}${records.length + 1}`, records.map((r) => this.toValues(r)));
    this.rows.splice(0, this.rows.length, ...records.map((r, i) => ({ ...r, _row: i + 2 })));
  }

  async resolveSheetId() {
    const sp = await client().getSpreadsheet(this.spreadsheetId);
    const s = sp.sheets.find((x) => x.title === this.sheetTitle);
    if (!s) throw new Error(`Sheet "${this.sheetTitle}" not found`);
    this.sheetId = s.sheetId;
    return s.sheetId;
  }
}

/** Sheets batchUpdate requests that make a table look good when opened in Google Sheets. */
export function tableFormatRequests(sheetId, columns, { statusKey, statusValues, dateKeys = [] } = {}) {
  const n = columns.length;
  const reqs = [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: n },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.95, blue: 0.98 }, textFormat: { bold: true }, horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      },
    },
    { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: n } } } },
  ];
  columns.forEach((c, i) => {
    if (c.type === 'number') {
      reqs.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      });
    }
    if (c.width) {
      reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: c.width }, fields: 'pixelSize' } });
    }
  });
  const statusIdx = columns.findIndex((c) => c.key === statusKey);
  if (statusIdx >= 0 && statusValues) {
    reqs.push({
      setDataValidation: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: statusIdx, endColumnIndex: statusIdx + 1 },
        rule: { condition: { type: 'ONE_OF_LIST', values: statusValues.map((v) => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false },
      },
    });
    const colors = { paid: [0.85, 0.96, 0.87], done: [0.85, 0.96, 0.87], completed: [0.85, 0.96, 0.87], pending: [0.88, 0.9, 1], partial: [1, 0.95, 0.78], waived: [0.93, 0.93, 0.93], 'in-progress': [1, 0.95, 0.78] };
    statusValues.forEach((v, i) => {
      const rgb = colors[v];
      if (!rgb) return;
      reqs.push({
        addConditionalFormatRule: {
          index: i,
          rule: {
            ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: statusIdx, endColumnIndex: statusIdx + 1 }],
            booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: v }] }, format: { backgroundColor: { red: rgb[0], green: rgb[1], blue: rgb[2] } } },
          },
        },
      });
    });
  }
  return reqs;
}
