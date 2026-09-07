// Expense ledger: one spreadsheet, one tab per year, grouped in the UI by month and day.

import { client, tag, KIND, PROPS } from './client.js';
import { MIME } from '../lib/google-client.js';
import { Table, tableFormatRequests } from './table.js';
import { folderId, getRegistry } from './workspace.js';
import { uid, nowISO } from '../lib/ids.js';

export const EXPENSE_COLUMNS = [
  { key: 'id', width: 130 }, { key: 'date', width: 110 }, { key: 'category', width: 140 }, { key: 'description', width: 260 }, { key: 'amount', type: 'number', width: 110 },
  { key: 'account', width: 110 }, { key: 'tags', width: 140 }, { key: 'attachments', width: 200 }, { key: 'notes', width: 220 }, { key: 'created_at', width: 170 }, { key: 'updated_at', width: 170 },
];

const YEAR_RE = /^\d{4}$/;

export async function listLedgers() {
  const c = client();
  const own = await c.listFiles({ parents: folderId('expenses'), mimeType: MIME.spreadsheet, appProperties: { [PROPS.kind]: KIND.expenses } });
  const linked = getRegistry().linkedFiles.filter((f) => f.kind === KIND.expenses);
  const shared = [];
  for (const l of linked) {
    try { shared.push({ ...(await c.getFile(l.id)), linked: true }); } catch { /* skip unavailable */ }
  }
  return { own, shared };
}

export async function ensureLedger(name = 'Expenses') {
  const { own } = await listLedgers();
  if (own.length) return own[0];
  return createLedger(name);
}

export async function createLedger(name) {
  const c = client();
  const file = await c.createFile({ name, mimeType: MIME.spreadsheet, parentId: folderId('expenses'), appProperties: tag(KIND.expenses) });
  const sp = await c.getSpreadsheet(file.id);
  const year = String(new Date().getFullYear());
  await c.sheetsBatchUpdate(file.id, [{ updateSheetProperties: { properties: { sheetId: sp.sheets[0].sheetId, title: year }, fields: 'title' } }]);
  await initYearSheet(file.id, year, sp.sheets[0].sheetId);
  return file;
}

async function initYearSheet(ledgerId, year, sheetId) {
  const t = new Table(ledgerId, year, EXPENSE_COLUMNS, sheetId);
  await client().setValues(ledgerId, year, `A1:${t.lastCol}1`, [t.headerRow()]);
  await client().sheetsBatchUpdate(ledgerId, tableFormatRequests(sheetId, EXPENSE_COLUMNS));
}

export async function listYears(ledgerId) {
  const sp = await client().getSpreadsheet(ledgerId);
  return sp.sheets.filter((s) => YEAR_RE.test(s.title)).map((s) => s.title).sort((a, b) => b.localeCompare(a));
}

export async function ensureYearSheet(ledgerId, year) {
  const c = client();
  const sp = await c.getSpreadsheet(ledgerId);
  const existing = sp.sheets.find((s) => s.title === year);
  if (existing) return existing.sheetId;
  const years = sp.sheets.filter((s) => YEAR_RE.test(s.title)).map((s) => s.title);
  const index = [...years, year].sort((a, b) => b.localeCompare(a)).indexOf(year);
  const replies = await c.sheetsBatchUpdate(ledgerId, [{ addSheet: { properties: { title: year, index } } }]);
  const sheetId = replies[0].addSheet.properties.sheetId;
  await initYearSheet(ledgerId, year, sheetId);
  return sheetId;
}

export async function loadYear(ledgerId, year) {
  const t = new Table(ledgerId, year, EXPENSE_COLUMNS);
  await t.load();
  t.rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.created_at || '').localeCompare(a.created_at || ''));
  return t;
}

export async function addExpense(ledgerId, expense) {
  const year = (expense.date || '').slice(0, 4);
  if (!YEAR_RE.test(year)) throw new Error('Please choose a valid date');
  await ensureYearSheet(ledgerId, year);
  const t = new Table(ledgerId, year, EXPENSE_COLUMNS);
  const rec = { id: uid(), attachments: '', tags: '', notes: '', account: '', ...expense, created_at: nowISO(), updated_at: nowISO() };
  await t.insert([rec]);
  return rec;
}

export async function updateExpense(ledgerId, table, id, patch) {
  const row = table.rows.find((r) => r.id === id);
  if (!row) throw new Error('Expense not found');
  const nextYear = (patch.date || row.date).slice(0, 4);
  if (nextYear !== table.sheetTitle) {
    await table.delete([id]);
    await ensureYearSheet(ledgerId, nextYear);
    const other = new Table(ledgerId, nextYear, EXPENSE_COLUMNS);
    await other.insert([{ ...row, ...patch, updated_at: nowISO() }]);
    return { moved: nextYear };
  }
  await table.update(id, { ...patch, updated_at: nowISO() });
  return { moved: null };
}

export async function deleteExpenses(table, ids) {
  await table.delete(ids);
}

/** Groups rows into [{ym, total, days:[{date, total, rows}]}] newest first. */
export function groupExpenses(rows) {
  const months = new Map();
  for (const r of rows) {
    const ym = (r.date || '').slice(0, 7) || 'Unknown';
    const m = months.get(ym) || { ym, total: 0, count: 0, days: new Map(), byCategory: {} };
    m.total += Number(r.amount) || 0;
    m.count += 1;
    m.byCategory[r.category || 'Other'] = (m.byCategory[r.category || 'Other'] || 0) + (Number(r.amount) || 0);
    const d = m.days.get(r.date) || { date: r.date, total: 0, rows: [] };
    d.total += Number(r.amount) || 0;
    d.rows.push(r);
    m.days.set(r.date, d);
    months.set(ym, m);
  }
  return [...months.values()].sort((a, b) => b.ym.localeCompare(a.ym)).map((m) => ({ ...m, days: [...m.days.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '')) }));
}

export function totalsByCategory(rows) {
  const out = {};
  for (const r of rows) out[r.category || 'Other'] = (out[r.category || 'Other'] || 0) + (Number(r.amount) || 0);
  return Object.entries(out).sort((a, b) => b[1] - a[1]);
}
