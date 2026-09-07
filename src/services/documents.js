// Generates Google Docs and Slides from your data (payment statements, plan decks, expense reports).

import { client, tag, KIND, PROPS } from './client.js';
import { MIME } from '../lib/google-client.js';
import { folderId } from './workspace.js';
import { fmtMoney, fmtDate, fmtMonth, pct } from '../lib/format.js';
import { uid } from '../lib/ids.js';
import { effectiveStatus, summarize } from './schedule.js';

// ---------- Generic document builder (blocks → Docs API requests) ----------

/**
 * blocks: [{type:'h1'|'h2'|'h3'|'p'|'small'|'bullets'|'table', text?, items?, rows?, header?:boolean}]
 */
export async function createDocFromBlocks(title, blocks) {
  const c = client();
  const file = await c.createFile({ name: title, mimeType: MIME.document, parentId: folderId('documents'), appProperties: tag(KIND.document) });

  const first = [];
  const flat = [];
  for (const b of blocks) {
    if (b.type === 'table') {
      const rows = b.rows.filter((r) => r.length);
      if (!rows.length) continue;
      flat.push({ ...b, rows });
      first.push({ insertTable: { rows: rows.length, columns: rows[0].length, endOfSegmentLocation: { segmentId: '' } } });
    } else if (b.type === 'bullets') {
      for (const item of b.items) {
        flat.push({ type: 'bullet', text: String(item) });
        first.push({ insertText: { text: `${String(item).replace(/\n/g, ' ')}\n`, endOfSegmentLocation: { segmentId: '' } } });
      }
    } else {
      const text = String(b.text ?? '').replace(/\n/g, ' ');
      flat.push({ ...b, text });
      first.push({ insertText: { text: `${text}\n`, endOfSegmentLocation: { segmentId: '' } } });
    }
  }
  await c.docsBatchUpdate(file.id, first);

  // Second pass needs real indices → read the document back.
  const doc = await c.getDocument(file.id);
  const elements = (doc.body?.content || []).filter((e) => e.paragraph || e.table);
  const second = [];
  const cellInserts = [];
  let ei = 0;
  for (const b of flat) {
    if (b.type === 'table') {
      // insertTable also adds an empty paragraph before the table; skip to the table itself.
      while (ei < elements.length && !elements[ei].table) ei++;
      const t = elements[ei];
      ei++;
      if (!t?.table) continue;
      const tableStart = t.startIndex;
      t.table.tableRows.forEach((tr, ri) => {
        tr.tableCells.forEach((cell, ci) => {
          const idx = cell.content?.[0]?.startIndex ?? (cell.startIndex + 1);
          const text = String(b.rows[ri]?.[ci] ?? '');
          if (text) cellInserts.push({ index: idx, text, bold: b.header !== false && ri === 0 });
        });
      });
      if (b.header !== false) {
        second.push({
          updateTableCellStyle: {
            tableRange: { tableCellLocation: { tableStartLocation: { index: tableStart }, rowIndex: 0, columnIndex: 0 }, rowSpan: 1, columnSpan: b.rows[0].length },
            tableCellStyle: { backgroundColor: { color: { rgbColor: { red: 0.93, green: 0.95, blue: 0.98 } } } },
            fields: 'backgroundColor',
          },
        });
      }
      continue;
    }
    const el = elements[ei];
    ei++;
    if (!el?.paragraph) continue;
    const range = { startIndex: el.startIndex, endIndex: el.endIndex };
    const style = { h1: 'HEADING_1', h2: 'HEADING_2', h3: 'HEADING_3', title: 'TITLE', subtitle: 'SUBTITLE' }[b.type];
    if (style) second.push({ updateParagraphStyle: { range, paragraphStyle: { namedStyleType: style }, fields: 'namedStyleType' } });
    if (b.type === 'small') second.push({ updateTextStyle: { range, textStyle: { fontSize: { magnitude: 9, unit: 'PT' }, foregroundColor: { color: { rgbColor: { red: 0.45, green: 0.47, blue: 0.5 } } } }, fields: 'fontSize,foregroundColor' } });
    if (b.type === 'bullet') second.push({ createParagraphBullets: { range, bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' } });
  }
  cellInserts.sort((x, y) => y.index - x.index);
  for (const ins of cellInserts) {
    second.push({ insertText: { location: { index: ins.index }, text: ins.text } });
    if (ins.bold) second.push({ updateTextStyle: { range: { startIndex: ins.index, endIndex: ins.index + ins.text.length }, textStyle: { bold: true }, fields: 'bold' } });
  }
  await c.docsBatchUpdate(file.id, second);
  return file;
}

// ---------- Slides builder ----------

const PT = (magnitude) => ({ magnitude, unit: 'PT' });
const SLIDE_W = 720;

/**
 * slides: [{type:'title', title, subtitle} | {type:'bullets', title, items} | {type:'table', title, rows}]
 */
export async function createDeck(title, slides) {
  const c = client();
  const file = await c.createFile({ name: title, mimeType: MIME.presentation, parentId: folderId('documents'), appProperties: tag(KIND.presentation) });
  const pres = await c.getPresentation(file.id);
  const reqs = [];

  for (const s of slides) {
    const pageId = `ld_${uid(8)}`;
    if (s.type === 'title') {
      const t = `${pageId}_t`, sub = `${pageId}_s`;
      reqs.push({ createSlide: { objectId: pageId, slideLayoutReference: { predefinedLayout: 'TITLE' }, placeholderIdMappings: [{ layoutPlaceholder: { type: 'CENTERED_TITLE', index: 0 }, objectId: t }, { layoutPlaceholder: { type: 'SUBTITLE', index: 0 }, objectId: sub }] } });
      reqs.push({ insertText: { objectId: t, text: s.title || ' ' } });
      if (s.subtitle) reqs.push({ insertText: { objectId: sub, text: s.subtitle } });
    } else if (s.type === 'bullets') {
      const t = `${pageId}_t`, body = `${pageId}_b`;
      reqs.push({ createSlide: { objectId: pageId, slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' }, placeholderIdMappings: [{ layoutPlaceholder: { type: 'TITLE', index: 0 }, objectId: t }, { layoutPlaceholder: { type: 'BODY', index: 0 }, objectId: body }] } });
      reqs.push({ insertText: { objectId: t, text: s.title || ' ' } });
      const text = (s.items || []).map(String).join('\n') || ' ';
      reqs.push({ insertText: { objectId: body, text } });
      if (s.items?.length) reqs.push({ createParagraphBullets: { objectId: body, textRange: { type: 'ALL' }, bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' } });
    } else if (s.type === 'table') {
      const rows = s.rows.filter((r) => r.length);
      if (!rows.length) continue;
      const t = `${pageId}_t`, table = `${pageId}_tb`;
      reqs.push({ createSlide: { objectId: pageId, slideLayoutReference: { predefinedLayout: 'TITLE_ONLY' }, placeholderIdMappings: [{ layoutPlaceholder: { type: 'TITLE', index: 0 }, objectId: t }] } });
      reqs.push({ insertText: { objectId: t, text: s.title || ' ' } });
      const height = Math.min(300, 24 * rows.length);
      reqs.push({ createTable: { objectId: table, elementProperties: { pageObjectId: pageId, size: { width: PT(SLIDE_W - 80), height: PT(height) }, transform: { scaleX: 1, scaleY: 1, translateX: 40, translateY: 90, unit: 'PT' } }, rows: rows.length, columns: rows[0].length } });
      rows.forEach((r, ri) => r.forEach((cell, ci) => {
        const text = String(cell ?? '');
        if (!text) return;
        reqs.push({ insertText: { objectId: table, cellLocation: { rowIndex: ri, columnIndex: ci }, text, insertionIndex: 0 } });
        reqs.push({ updateTextStyle: { objectId: table, cellLocation: { rowIndex: ri, columnIndex: ci }, style: { fontSize: PT(rows.length > 10 ? 9 : 11), bold: ri === 0 }, textRange: { type: 'ALL' }, fields: 'fontSize,bold' } });
      }));
    }
  }
  // Remove the default blank slide only after the new ones exist.
  for (const s of pres.slides || []) reqs.push({ deleteObject: { objectId: s.objectId } });
  await c.slidesBatchUpdate(file.id, reqs);
  return file;
}

// ---------- Domain generators ----------

export function statementBlocks({ workbook, plan, rows, owner }) {
  const s = summarize(rows);
  const paid = rows.filter((r) => r.status === 'paid' || r.status === 'partial');
  const pending = rows.filter((r) => !['paid', 'waived'].includes(r.status));
  const money = (n) => fmtMoney(n);
  return [
    { type: 'title', text: `${plan.title} — Payment Statement` },
    { type: 'subtitle', text: `${workbook.name}${plan.asset ? ` · ${plan.asset}` : ''}${plan.scheme ? ` · ${plan.scheme}` : ''}` },
    { type: 'small', text: `Generated ${new Date().toLocaleString()}${owner ? ` for ${owner}` : ''} by LedgerDrive` },
    { type: 'h2', text: 'Summary' },
    { type: 'table', rows: [
      ['Metric', 'Value'],
      ['Total payable', money(s.total)],
      ['Paid so far', `${money(s.paid)} (${pct(s.paid, s.total)}%)`],
      ['Remaining', money(s.remaining)],
      ['Overdue', `${money(s.overdue)} across ${s.overdueCount} installment(s)`],
      ['Next due', s.next ? `${fmtDate(s.next.due_date)} — ${s.next.title} — ${money(s.next.amount)}` : '—'],
    ] },
    { type: 'h2', text: 'Breakdown by category' },
    { type: 'table', rows: [['Category', 'Total', 'Paid', 'Remaining', 'Items'], ...Object.entries(s.byCategory).map(([k, v]) => [k, money(v.total), money(v.paid), money(v.total - v.paid), String(v.count)])] },
    { type: 'h2', text: `Payments made (${paid.length})` },
    { type: 'table', rows: [['#', 'Due', 'Paid on', 'Title', 'Category', 'Amount', 'Paid'], ...paid.map((r) => [String(r.seq), fmtDate(r.due_date), fmtDate(r.paid_date), r.title, r.category, money(r.amount), money(r.status === 'paid' ? r.amount : r.paid_amount)])] },
    { type: 'h2', text: `Upcoming & pending (${pending.length})` },
    { type: 'table', rows: [['#', 'Due', 'Title', 'Category', 'Amount', 'Status'], ...pending.map((r) => [String(r.seq), fmtDate(r.due_date), r.title, r.category, money(r.amount), effectiveStatus(r)])] },
    ...(plan.notes ? [{ type: 'h2', text: 'Notes' }, { type: 'p', text: plan.notes }] : []),
  ];
}

export function deckSlides({ workbook, plan, rows }) {
  const s = summarize(rows);
  const money = (n) => fmtMoney(n, { compact: true });
  const pending = rows.filter((r) => !['paid', 'waived'].includes(r.status));
  const chunks = [];
  for (let i = 0; i < pending.length; i += 12) chunks.push(pending.slice(i, i + 12));
  return [
    { type: 'title', title: plan.title, subtitle: `${workbook.name}${plan.asset ? ` · ${plan.asset}` : ''} · ${new Date().toLocaleDateString()}` },
    { type: 'bullets', title: 'At a glance', items: [
      `Total payable: ${money(s.total)}`,
      `Paid: ${money(s.paid)} (${pct(s.paid, s.total)}%) across ${s.paidCount} installments`,
      `Remaining: ${money(s.remaining)} across ${s.pendingCount} installments`,
      `Overdue: ${money(s.overdue)} (${s.overdueCount})`,
      s.next ? `Next due: ${fmtDate(s.next.due_date)} — ${s.next.title} (${money(s.next.amount)})` : 'Nothing pending',
    ] },
    { type: 'table', title: 'By category', rows: [['Category', 'Total', 'Paid', 'Remaining'], ...Object.entries(s.byCategory).map(([k, v]) => [k, money(v.total), money(v.paid), money(v.total - v.paid)])] },
    ...chunks.map((chunk, i) => ({ type: 'table', title: `Upcoming payments ${chunks.length > 1 ? `(${i + 1}/${chunks.length})` : ''}`, rows: [['#', 'Due', 'Title', 'Amount', 'Status'], ...chunk.map((r) => [String(r.seq), fmtDate(r.due_date), r.title, money(r.amount), effectiveStatus(r)])] })),
    { type: 'bullets', title: 'Notes', items: plan.notes ? plan.notes.split('\n').filter(Boolean) : ['Generated by LedgerDrive from your Google Sheet', 'Data lives in your own Google Drive'] },
  ];
}

export function expenseReportBlocks({ title, rows, period }) {
  const total = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const byCat = {};
  for (const r of rows) byCat[r.category || 'Other'] = (byCat[r.category || 'Other'] || 0) + (Number(r.amount) || 0);
  const sorted = [...rows].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return [
    { type: 'title', text: title },
    { type: 'subtitle', text: `Period: ${period} · ${rows.length} entries · Total ${fmtMoney(total)}` },
    { type: 'small', text: `Generated ${new Date().toLocaleString()} by LedgerDrive` },
    { type: 'h2', text: 'By category' },
    { type: 'table', rows: [['Category', 'Amount', 'Share'], ...Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, fmtMoney(v), `${pct(v, total)}%`])] },
    { type: 'h2', text: 'All entries' },
    { type: 'table', rows: [['Date', 'Category', 'Description', 'Account', 'Amount'], ...sorted.map((r) => [fmtDate(r.date), r.category, r.description, r.account || '', fmtMoney(r.amount)])] },
  ];
}

export async function listGenerated() {
  const c = client();
  const files = await c.listFiles({ parents: folderId('documents') });
  return files.filter((f) => [MIME.document, MIME.presentation, MIME.spreadsheet].includes(f.mimeType));
}

export async function createBlank(kind, name) {
  const mime = { doc: MIME.document, slides: MIME.presentation, sheet: MIME.spreadsheet }[kind];
  const k = { doc: KIND.document, slides: KIND.presentation, sheet: KIND.sheet }[kind];
  return client().createFile({ name, mimeType: mime, parentId: folderId('documents'), appProperties: tag(k) });
}

export async function exportFile(file, format) {
  const mime = { xlsx: MIME.xlsx, pdf: MIME.pdf, docx: MIME.docx, pptx: MIME.pptx }[format];
  return client().exportFile(file.id, mime);
}

export { fmtMonth, PROPS };
