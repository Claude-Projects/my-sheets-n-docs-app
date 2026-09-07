// Todo list: one spreadsheet with a single "Tasks" tab.

import { client, tag, KIND, PROPS } from './client.js';
import { MIME } from '../lib/google-client.js';
import { Table, tableFormatRequests } from './table.js';
import { folderId } from './workspace.js';
import { uid, nowISO } from '../lib/ids.js';
import { todayISO } from '../lib/format.js';

export const TASKS_SHEET = 'Tasks';
export const TODO_STATUSES = ['open', 'in-progress', 'done'];
export const PRIORITIES = ['high', 'medium', 'low'];

export const TODO_COLUMNS = [
  { key: 'id', width: 130 }, { key: 'title', width: 280 }, { key: 'notes', width: 260 }, { key: 'due_date', width: 110 }, { key: 'priority', width: 90 },
  { key: 'status', width: 100 }, { key: 'list', width: 120 }, { key: 'archived', width: 80 }, { key: 'created_at', width: 170 }, { key: 'completed_at', width: 170 }, { key: 'updated_at', width: 170 },
];

export async function ensureTodoSheet() {
  const c = client();
  const found = await c.listFiles({ parents: folderId('todos'), mimeType: MIME.spreadsheet, appProperties: { [PROPS.kind]: KIND.todos } });
  if (found.length) return found[0];
  const file = await c.createFile({ name: 'Todos', mimeType: MIME.spreadsheet, parentId: folderId('todos'), appProperties: tag(KIND.todos) });
  const sp = await c.getSpreadsheet(file.id);
  const sheetId = sp.sheets[0].sheetId;
  await c.sheetsBatchUpdate(file.id, [{ updateSheetProperties: { properties: { sheetId, title: TASKS_SHEET }, fields: 'title' } }]);
  const t = new Table(file.id, TASKS_SHEET, TODO_COLUMNS, sheetId);
  await c.setValues(file.id, TASKS_SHEET, `A1:${t.lastCol}1`, [t.headerRow()]);
  await c.sheetsBatchUpdate(file.id, tableFormatRequests(sheetId, TODO_COLUMNS, { statusKey: 'status', statusValues: TODO_STATUSES }));
  return file;
}

export async function loadTodos(fileId) {
  const t = new Table(fileId, TASKS_SHEET, TODO_COLUMNS);
  await t.load();
  return t;
}

export async function addTodo(table, todo) {
  const rec = { id: uid(), notes: '', due_date: '', priority: 'medium', status: 'open', list: 'Personal', archived: '', completed_at: '', ...todo, created_at: nowISO(), updated_at: nowISO() };
  await table.insert([rec]);
  table.rows.push(rec);
  return rec;
}

export async function updateTodo(table, id, patch) {
  const p = { ...patch, updated_at: nowISO() };
  if (patch.status === 'done') p.completed_at = nowISO();
  if (patch.status && patch.status !== 'done') p.completed_at = '';
  await table.update(id, p);
}

export async function bulkTodo(table, changes) {
  await table.bulkUpdate(changes.map(({ id, patch }) => ({ id, patch: { ...patch, updated_at: nowISO(), ...(patch.status === 'done' ? { completed_at: nowISO() } : {}) } })));
}

export async function deleteTodos(table, ids) {
  await table.delete(ids);
}

export function todoBuckets(rows) {
  const today = todayISO();
  const b = { overdue: [], today: [], upcoming: [], someday: [], done: [], archived: [] };
  for (const r of rows) {
    if (r.archived === 'yes') { b.archived.push(r); continue; }
    if (r.status === 'done') { b.done.push(r); continue; }
    if (!r.due_date) b.someday.push(r);
    else if (r.due_date < today) b.overdue.push(r);
    else if (r.due_date === today) b.today.push(r);
    else b.upcoming.push(r);
  }
  const byDue = (a, c) => (a.due_date || '9999').localeCompare(c.due_date || '9999') || PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(c.priority);
  for (const k of ['overdue', 'today', 'upcoming', 'someday']) b[k].sort(byDue);
  b.done.sort((a, c) => (c.completed_at || '').localeCompare(a.completed_at || ''));
  return b;
}
