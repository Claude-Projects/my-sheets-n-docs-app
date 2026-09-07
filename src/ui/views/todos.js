import { h, replace, icon } from '../../lib/dom.js';
import { fmtDate, relativeDue, todayISO } from '../../lib/format.js';
import { ensureTodoSheet, loadTodos, addTodo, updateTodo, bulkTodo, deleteTodos, todoBuckets, PRIORITIES, TODO_STATUSES } from '../../services/todos.js';
import { getRegistry, updateRegistry } from '../../services/workspace.js';
import { fileLink } from '../../lib/google-client.js';
import { isDemo } from '../../services/client.js';
import { openModal, confirmDialog, toast, toastError, emptyState, dropdown, loading, badge, field, select, segmented } from '../components.js';
import { openShareModal } from '../share-modal.js';

export async function render(root, { setTitle, query }) {
  setTitle('Todos');
  const file = await ensureTodoSheet();
  let table = null;
  let listFilter = '';
  let view = 'active';

  const head = h('div', { class: 'page-head' });
  const body = h('div', null, loading('Loading tasks…'));
  replace(root, head, body);

  function renderHead() {
    const menu = dropdown(h('button', { class: 'btn icon' }, icon('more')), [
      !isDemo() ? { label: 'Open in Google Sheets', icon: 'link', onClick: () => window.open(fileLink(file), '_blank', 'noopener') } : null,
      { label: 'Share todo list…', icon: 'share', onClick: () => openShareModal(file) },
      { label: 'Manage lists', icon: 'settings', onClick: manageLists },
      'sep',
      { label: 'Archive all completed', icon: 'archive', onClick: async () => { const done = table.rows.filter((r) => r.status === 'done' && r.archived !== 'yes'); if (!done.length) return toast('Nothing to archive'); try { await bulkTodo(table, done.map((r) => ({ id: r.id, patch: { archived: 'yes' } }))); toast(`${done.length} archived`, 'success'); await load(); } catch (e) { toastError(e); } } },
    ]);
    replace(head, h('div', null, h('h1', null, 'Todos'), h('p', { class: 'sub' }, 'A simple list that lives in a Google Sheet. Tick, snooze, archive.')), h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: () => editTodo(null) }, icon('plus'), 'New todo'), menu));
  }

  async function load() {
    table = await loadTodos(file.id);
    draw();
  }

  function draw() {
    const reg = getRegistry();
    const rows = table.rows.filter((r) => !listFilter || r.list === listFilter);
    const b = todoBuckets(rows);
    const quick = h('input', { type: 'text', placeholder: 'Quick add: “Pay dev charges tomorrow” … press Enter', onKeyDown: async (e) => {
      if (e.key !== 'Enter' || !quick.value.trim()) return;
      const parsed = parseQuick(quick.value.trim());
      try { await addTodo(table, { ...parsed, list: listFilter || reg.todoLists[0] }); quick.value = ''; toast('Added', 'success'); draw(); } catch (err) { toastError(err); }
    } });
    const lists = segmented([{ value: '', label: 'All lists' }, ...reg.todoLists.map((l) => ({ value: l, label: l }))], listFilter, (v) => { listFilter = v; draw(); });
    const views = segmented([{ value: 'active', label: `Active (${b.overdue.length + b.today.length + b.upcoming.length + b.someday.length})` }, { value: 'done', label: `Done (${b.done.length})` }, { value: 'archived', label: `Archived (${b.archived.length})` }], view, (v) => { view = v; draw(); });

    const sections = view === 'active'
      ? [['Overdue', b.overdue, 'overdue'], ['Today', b.today, 'due-soon'], ['Upcoming', b.upcoming, ''], ['Someday', b.someday, '']]
      : view === 'done' ? [['Completed', b.done, 'done']] : [['Archived', b.archived, 'archived']];
    const any = sections.some(([, items]) => items.length);

    replace(body,
      h('div', { class: 'card pad mb' }, quick),
      h('div', { class: 'toolbar' }, lists, h('span', { class: 'spacer' }), views),
      any ? sections.filter(([, items]) => items.length).map(([title, items, tone]) => h('div', { class: 'card mb' },
        h('div', { class: 'card-head' }, h('h3', null, title, ' ', h('span', { class: 'badge ' + tone }, String(items.length))),
          view === 'active' ? h('button', { class: 'btn xs', onClick: async () => { try { await bulkTodo(table, items.map((r) => ({ id: r.id, patch: { status: 'done' } }))); toast('Done!', 'success'); await load(); } catch (e) { toastError(e); } } }, '✓ Complete all') : null),
        h('div', { class: 'list' }, items.map((r) => todoRow(r)))))
        : emptyState({ emoji: view === 'active' ? '🎉' : '📭', title: view === 'active' ? 'All clear' : 'Nothing here', text: view === 'active' ? 'Add a task above — it is saved straight into your Todos sheet.' : '' }),
    );
  }

  function todoRow(r) {
    const done = r.status === 'done';
    return h('div', { class: `list-item ${done ? 'done' : ''}` },
      h('input', { type: 'checkbox', checked: done, title: done ? 'Mark open' : 'Complete', onChange: async (e) => { try { await updateTodo(table, r.id, { status: e.target.checked ? 'done' : 'open' }); await load(); } catch (err) { toastError(err); } } }),
      h('div', { class: 'grow', style: { cursor: 'pointer' }, onClick: () => editTodo(r) },
        h('div', { class: 't' }, r.title),
        h('div', { class: 's' }, [r.list, r.due_date ? `${fmtDate(r.due_date)} (${relativeDue(r.due_date)})` : null, r.notes].filter(Boolean).join(' · '))),
      r.status === 'in-progress' ? badge('in-progress') : null,
      badge(r.priority || 'medium'),
      dropdown(h('button', { class: 'btn ghost icon' }, icon('more')), [
        { label: 'Edit', icon: 'edit', onClick: () => editTodo(r) },
        { label: 'Snooze to tomorrow', icon: 'calendar', onClick: async () => { const d = new Date(); d.setDate(d.getDate() + 1); try { await updateTodo(table, r.id, { due_date: d.toISOString().slice(0, 10), status: r.status === 'done' ? 'open' : r.status }); await load(); } catch (e) { toastError(e); } } },
        { label: r.status === 'in-progress' ? 'Mark open' : 'Mark in progress', icon: 'refresh', onClick: async () => { try { await updateTodo(table, r.id, { status: r.status === 'in-progress' ? 'open' : 'in-progress' }); await load(); } catch (e) { toastError(e); } } },
        'sep',
        { label: r.archived === 'yes' ? 'Unarchive' : 'Archive', icon: 'archive', onClick: async () => { try { await updateTodo(table, r.id, { archived: r.archived === 'yes' ? '' : 'yes' }); await load(); } catch (e) { toastError(e); } } },
        { label: 'Delete', icon: 'trash', danger: true, onClick: async () => { if (await confirmDialog({ title: 'Delete todo?', message: r.title, confirmText: 'Delete', danger: true })) { try { await deleteTodos(table, [r.id]); await load(); } catch (e) { toastError(e); } } } },
      ]));
  }

  function editTodo(row) {
    const reg = getRegistry();
    const isNew = !row;
    const r = row || { title: '', notes: '', due_date: '', priority: 'medium', status: 'open', list: listFilter || reg.todoLists[0] };
    const title = h('input', { type: 'text', value: r.title, required: true });
    const notes = h('textarea', { rows: 3 }, r.notes || '');
    const due = h('input', { type: 'date', value: r.due_date || '' });
    const priority = select(PRIORITIES, r.priority || 'medium');
    const status = select(TODO_STATUSES, r.status || 'open');
    const list = select([...new Set([...reg.todoLists, r.list].filter(Boolean))], r.list);
    const m = openModal({ title: isNew ? 'New todo' : 'Edit todo', body: h('form', { onSubmit: (e) => { e.preventDefault(); save(); } }, h('div', { class: 'form-grid' },
      h('div', { class: 'field span-2' }, h('label', null, 'Title'), title), field('Due date', due), field('List', list), field('Priority', priority), field('Status', status),
      h('div', { class: 'field span-2' }, h('label', null, 'Notes'), notes))),
      footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: save }, isNew ? 'Add' : 'Save')] });
    async function save() {
      if (!title.value.trim()) return title.focus();
      const patch = { title: title.value.trim(), notes: notes.value.trim(), due_date: due.value, priority: priority.value, status: status.value, list: list.value };
      try { if (isNew) await addTodo(table, patch); else await updateTodo(table, r.id, patch); m.close(); toast('Saved', 'success'); await load(); } catch (e) { toastError(e); }
    }
  }

  function manageLists() {
    const reg = getRegistry();
    const ta = h('textarea', { rows: 6 }, reg.todoLists.join('\n'));
    const m = openModal({ title: 'Todo lists', subtitle: 'One per line.', size: 'narrow', body: field('Lists', ta), footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => { try { await updateRegistry({ todoLists: [...new Set(ta.value.split('\n').map((x) => x.trim()).filter(Boolean))] }); m.close(); listFilter = ''; draw(); } catch (e) { toastError(e); } } }, 'Save')] });
  }

  renderHead();
  await load();
  if (query.add) { history.replaceState(null, '', '#/todos'); editTodo(null); }
}

/** "Pay dev charges tomorrow !high" → {title, due_date, priority} */
function parseQuick(text) {
  let title = text;
  let due_date = '';
  let priority = 'medium';
  const pr = /!(high|medium|low)\b/i.exec(title);
  if (pr) { priority = pr[1].toLowerCase(); title = title.replace(pr[0], '').trim(); }
  const d = new Date();
  if (/\btoday\b/i.test(title)) { due_date = todayISO(); title = title.replace(/\btoday\b/i, '').trim(); }
  else if (/\btomorrow\b/i.test(title)) { d.setDate(d.getDate() + 1); due_date = d.toISOString().slice(0, 10); title = title.replace(/\btomorrow\b/i, '').trim(); }
  else { const m = /\b(\d{4}-\d{2}-\d{2})\b/.exec(title); if (m) { due_date = m[1]; title = title.replace(m[0], '').trim(); } }
  return { title: title.replace(/\s{2,}/g, ' '), due_date, priority };
}
