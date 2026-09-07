// Installment workbooks (one Google Sheet each) containing many plans (one tab each).

import { client, tag, KIND, PROPS } from './client.js';
import { MIME, a1 } from '../lib/google-client.js';
import { Table, tableFormatRequests, colLetter } from './table.js';
import { folderId, getRegistry, ensureSubfolder } from './workspace.js';
import { sanitizeSheetTitle } from '../lib/format.js';
import { uid, nowISO } from '../lib/ids.js';
import { STATUSES, renumber } from './schedule.js';

export const META_SHEET = '_meta';
export const SUMMARY_SHEET = 'Summary';

export const META_COLUMNS = [
  { key: 'id' }, { key: 'title', width: 220 }, { key: 'sheet_title', width: 160 }, { key: 'asset', width: 160 }, { key: 'scheme', width: 160 },
  { key: 'notes', width: 260 }, { key: 'status' }, { key: 'color' }, { key: 'total_price', type: 'number' }, { key: 'dev_charges', type: 'number' },
  { key: 'created_at' }, { key: 'updated_at' },
];

export const ROW_COLUMNS = [
  { key: 'id', width: 130 }, { key: 'seq', type: 'number', width: 50 }, { key: 'due_date', width: 110 }, { key: 'title', width: 220 }, { key: 'category', width: 130 },
  { key: 'amount', type: 'number', width: 110 }, { key: 'status', width: 90 }, { key: 'paid_date', width: 110 }, { key: 'paid_amount', type: 'number', width: 110 },
  { key: 'notes', width: 240 }, { key: 'attachments', width: 200 }, { key: 'stream', width: 120 }, { key: 'created_at', width: 170 }, { key: 'updated_at', width: 170 },
];

export const PLAN_COLORS = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

// ---------- Workbooks ----------

export async function listWorkbooks() {
  const c = client();
  const [own, archived] = await Promise.all([
    c.listFiles({ parents: folderId('plans'), mimeType: MIME.spreadsheet, appProperties: { [PROPS.kind]: KIND.plans } }),
    c.listFiles({ parents: folderId('archive'), mimeType: MIME.spreadsheet, appProperties: { [PROPS.kind]: KIND.plans } }),
  ]);
  const linked = getRegistry().linkedFiles.filter((f) => f.kind === KIND.plans);
  const shared = [];
  for (const l of linked) {
    try { shared.push({ ...(await c.getFile(l.id)), linked: true }); } catch { shared.push({ id: l.id, name: l.name, linked: true, unavailable: true, mimeType: MIME.spreadsheet }); }
  }
  return {
    active: own.map((f) => ({ ...f, archived: false })),
    archived: archived.map((f) => ({ ...f, archived: true })),
    shared,
  };
}

export async function createWorkbook(name) {
  const c = client();
  const file = await c.createFile({ name, mimeType: MIME.spreadsheet, parentId: folderId('plans'), appProperties: tag(KIND.plans) });
  const sp = await c.getSpreadsheet(file.id);
  const first = sp.sheets[0];
  const replies = await c.sheetsBatchUpdate(file.id, [
    { updateSheetProperties: { properties: { sheetId: first.sheetId, title: SUMMARY_SHEET }, fields: 'title' } },
    { addSheet: { properties: { title: META_SHEET, hidden: true } } },
  ]);
  const metaId = replies[1]?.addSheet?.properties?.sheetId;
  await c.setValues(file.id, META_SHEET, `A1:${colLetter(META_COLUMNS.length - 1)}1`, [META_COLUMNS.map((x) => x.key)]);
  if (metaId !== undefined) await c.sheetsBatchUpdate(file.id, tableFormatRequests(metaId, META_COLUMNS));
  await rebuildSummary(file.id, []);
  return file;
}

export async function renameWorkbook(id, name) {
  return client().updateFile(id, { name });
}

export async function archiveWorkbook(id) {
  return client().updateFile(id, { appProperties: { [PROPS.archived]: '1' } }, { addParents: folderId('archive'), removeParents: folderId('plans') });
}

export async function unarchiveWorkbook(id) {
  return client().updateFile(id, { appProperties: { [PROPS.archived]: null } }, { addParents: folderId('plans'), removeParents: folderId('archive') });
}

export async function trashWorkbook(id) {
  return client().trashFile(id);
}

/**
 * Attachments folder for a workbook. The folder id is remembered on the
 * workbook itself so people the workbook is shared with upload into the same
 * folder (they receive the same Drive permission on it). Falls back to a
 * private folder if that folder is not reachable.
 */
export async function attachmentsFolderFor(workbook) {
  const c = client();
  const remembered = workbook.appProperties?.[PROPS.attFolder];
  if (remembered) {
    try {
      const f = await c.getFile(remembered);
      if (!f.trashed) return f;
    } catch { /* fall through */ }
  }
  const folder = await ensureSubfolder('attachments', workbook.name, `att:${workbook.id}`);
  if (workbook.ownedByMe !== false && folder.id !== remembered) {
    try { await c.updateFile(workbook.id, { appProperties: { [PROPS.attFolder]: folder.id } }); workbook.appProperties = { ...workbook.appProperties, [PROPS.attFolder]: folder.id }; } catch { /* best effort */ }
  }
  return folder;
}

// ---------- Plans (tabs) ----------

export async function openWorkbook(id) {
  const c = client();
  const [file, sp] = await Promise.all([c.getFile(id), c.getSpreadsheet(id)]);
  const meta = new Table(id, META_SHEET, META_COLUMNS, sp.sheets.find((s) => s.title === META_SHEET)?.sheetId ?? null);
  let plans = [];
  try { plans = await meta.load(); } catch { plans = []; }
  const known = new Set(plans.map((p) => p.sheet_title));
  // Tabs someone added by hand in Google Sheets still show up (read-only meta).
  for (const s of sp.sheets) {
    if (s.title === META_SHEET || s.title === SUMMARY_SHEET || known.has(s.title)) continue;
    plans.push({ id: `sheet:${s.sheetId}`, title: s.title, sheet_title: s.title, status: 'active', external: true, color: '' });
  }
  return { file, spreadsheet: sp, plans, meta };
}

export async function createPlan(workbookId, planMeta, rows) {
  const c = client();
  const sp = await c.getSpreadsheet(workbookId);
  const titles = new Set(sp.sheets.map((s) => s.title));
  let sheetTitle = sanitizeSheetTitle(planMeta.title);
  let n = 2;
  while (titles.has(sheetTitle) || sheetTitle === META_SHEET || sheetTitle === SUMMARY_SHEET) sheetTitle = `${sanitizeSheetTitle(planMeta.title).slice(0, 80)} (${n++})`;

  const replies = await c.sheetsBatchUpdate(workbookId, [{ addSheet: { properties: { title: sheetTitle, gridProperties: { rowCount: Math.max(rows.length + 20, 100), columnCount: 26 } } } }]);
  const sheetId = replies[0].addSheet.properties.sheetId;
  const table = new Table(workbookId, sheetTitle, ROW_COLUMNS, sheetId);
  await c.setValues(workbookId, sheetTitle, `A1:${table.lastCol}1`, [table.headerRow()]);
  await c.sheetsBatchUpdate(workbookId, tableFormatRequests(sheetId, ROW_COLUMNS, { statusKey: 'status', statusValues: STATUSES }));
  const prepared = renumber(rows.map((r) => ({ ...r, id: r.id || uid(), created_at: r.created_at || nowISO(), updated_at: nowISO() })));
  if (prepared.length) await table.replaceAll(prepared);

  const meta = new Table(workbookId, META_SHEET, META_COLUMNS, sp.sheets.find((s) => s.title === META_SHEET)?.sheetId ?? null);
  await meta.load();
  const record = {
    id: uid(), title: planMeta.title, sheet_title: sheetTitle, asset: planMeta.asset || '', scheme: planMeta.scheme || '', notes: planMeta.notes || '',
    status: 'active', color: planMeta.color || PLAN_COLORS[meta.rows.length % PLAN_COLORS.length], total_price: Number(planMeta.total_price) || 0, dev_charges: Number(planMeta.dev_charges) || 0,
    created_at: nowISO(), updated_at: nowISO(),
  };
  await meta.insert([record]);
  await rebuildSummary(workbookId, [...meta.rows, record]);
  return record;
}

export async function updatePlanMeta(workbookId, planId, patch) {
  const meta = new Table(workbookId, META_SHEET, META_COLUMNS);
  await meta.load();
  const plan = meta.rows.find((p) => p.id === planId);
  if (!plan) throw new Error('Plan not found');
  const next = { ...patch, updated_at: nowISO() };
  if (patch.title && patch.title !== plan.title) {
    const sp = await client().getSpreadsheet(workbookId);
    const sheet = sp.sheets.find((s) => s.title === plan.sheet_title);
    const wanted = sanitizeSheetTitle(patch.title);
    if (sheet && !sp.sheets.some((s) => s.title === wanted)) {
      await client().sheetsBatchUpdate(workbookId, [{ updateSheetProperties: { properties: { sheetId: sheet.sheetId, title: wanted }, fields: 'title' } }]);
      next.sheet_title = wanted;
    }
  }
  if (patch.status) {
    const sp = await client().getSpreadsheet(workbookId);
    const sheet = sp.sheets.find((s) => s.title === (next.sheet_title || plan.sheet_title));
    if (sheet) await client().sheetsBatchUpdate(workbookId, [{ updateSheetProperties: { properties: { sheetId: sheet.sheetId, hidden: patch.status === 'archived' }, fields: 'hidden' } }]);
  }
  await meta.update(planId, next);
  await rebuildSummary(workbookId, meta.rows);
  return { ...plan, ...next };
}

export async function deletePlan(workbookId, plan) {
  const c = client();
  const sp = await c.getSpreadsheet(workbookId);
  const sheet = sp.sheets.find((s) => s.title === plan.sheet_title);
  if (sheet) await c.sheetsBatchUpdate(workbookId, [{ deleteSheet: { sheetId: sheet.sheetId } }]);
  if (!plan.external) {
    const meta = new Table(workbookId, META_SHEET, META_COLUMNS);
    await meta.load();
    await meta.delete([plan.id]);
    await rebuildSummary(workbookId, meta.rows);
  }
}

export function planTable(workbookId, plan, sheetId = null) {
  return new Table(workbookId, plan.sheet_title, ROW_COLUMNS, sheetId);
}

export async function loadPlanRows(workbookId, plan) {
  const t = planTable(workbookId, plan);
  await t.load();
  return t;
}

/** Adds rows and keeps seq numbers in date order. */
export async function addRows(table, rows) {
  const all = renumber([...table.rows, ...rows.map((r) => ({ ...r, id: r.id || uid(), created_at: nowISO(), updated_at: nowISO(), attachments: r.attachments || '' }))]);
  await table.replaceAll(all);
  return all;
}

export async function updateRows(table, changes) {
  const stamped = changes.map(({ id, patch }) => ({ id, patch: { ...patch, updated_at: nowISO() } }));
  await table.bulkUpdate(stamped);
  return table.rows;
}

export async function markStatus(table, ids, status, { paidDate } = {}) {
  const today = paidDate || new Date().toISOString().slice(0, 10);
  const changes = ids.map((id) => {
    const row = table.rows.find((r) => r.id === id);
    const patch = { status };
    if (status === 'paid') { patch.paid_date = today; patch.paid_amount = Number(row?.amount) || 0; }
    if (status === 'pending' || status === 'waived') { patch.paid_date = ''; patch.paid_amount = 0; }
    return { id, patch };
  });
  return updateRows(table, changes);
}

export async function deleteRows(table, ids) {
  await table.delete(ids);
  const all = renumber(table.rows);
  await table.replaceAll(all);
  return all;
}

export async function resequence(table) {
  const all = renumber(table.rows);
  await table.replaceAll(all);
  return all;
}

// ---------- Summary tab (formulas so it also works inside Google Sheets) ----------

export async function rebuildSummary(workbookId, plans) {
  const c = client();
  const active = plans.filter((p) => p.status !== 'archived' && !p.external);
  const header = ['Plan', 'Asset', 'Scheme', 'Total', 'Paid', 'Remaining', 'Pending #', 'Overdue #', 'Next due'];
  const rows = active.map((p, i) => {
    const r = i + 2;
    const s = (col) => `${a1(p.sheet_title, `${col}2:${col}`)}`;
    return [
      p.title, p.asset || '', p.scheme || '',
      `=SUMIF(${s('G')},"<>waived",${s('F')})`,
      `=SUMIF(${s('G')},"paid",${s('F')})+SUMIF(${s('G')},"partial",${s('I')})`,
      `=D${r}-E${r}`,
      `=COUNTIF(${s('G')},"pending")+COUNTIF(${s('G')},"partial")`,
      `=IFERROR(ROWS(FILTER(${s('A')},(${s('G')}="pending")+(${s('G')}="partial"),ARRAYFORMULA(IFERROR(DATEVALUE(${s('C')}),0))<TODAY(),ARRAYFORMULA(IFERROR(DATEVALUE(${s('C')}),0))>0)),0)`,
      `=IFERROR(TEXT(MIN(FILTER(ARRAYFORMULA(IFERROR(DATEVALUE(${s('C')}),0)),(${s('G')}="pending")+(${s('G')}="partial"),ARRAYFORMULA(IFERROR(DATEVALUE(${s('C')}),0))>0)),"yyyy-mm-dd"),"")`,
    ];
  });
  const totalRow = active.length
    ? ['Total', '', '', `=SUM(D2:D${active.length + 1})`, `=SUM(E2:E${active.length + 1})`, `=SUM(F2:F${active.length + 1})`, `=SUM(G2:G${active.length + 1})`, `=SUM(H2:H${active.length + 1})`, '']
    : [];
  await c.clearValues(workbookId, SUMMARY_SHEET, 'A1:K200');
  const values = [header, ...rows];
  if (totalRow.length) values.push([], totalRow);
  values.push([], ['Managed by LedgerDrive. Edit plans in the app; this tab is regenerated automatically.']);
  await c.setValues(workbookId, SUMMARY_SHEET, `A1:I${values.length}`, values, { userEntered: true });
  try {
    const sp = await c.getSpreadsheet(workbookId);
    const sheetId = sp.sheets.find((s) => s.title === SUMMARY_SHEET)?.sheetId;
    if (sheetId !== undefined) {
      await c.sheetsBatchUpdate(workbookId, [
        { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: header.length }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.95, blue: 0.98 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
        { repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 6 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' } } }, fields: 'userEnteredFormat.numberFormat' } },
        { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: header.length } } },
      ]);
    }
  } catch { /* formatting is best-effort */ }
}

// ---------- Attachments encoded in a cell ----------

export function parseAttachments(cell) {
  if (!cell) return [];
  return String(cell).split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [id, ...rest] = s.split('|');
    return { id, name: rest.join('|') || 'attachment' };
  });
}

export function serializeAttachments(list) {
  return list.map((a) => `${a.id}|${(a.name || '').replace(/[;|]/g, ' ')}`).join(';');
}
