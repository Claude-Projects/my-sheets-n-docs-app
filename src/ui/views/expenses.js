import { h, replace, icon, debounce, downloadBlob } from '../../lib/dom.js';
import { fmtMoney, fmtDate, fmtMonth, parseAmount, todayISO, pct, safeFileName } from '../../lib/format.js';
import { ensureLedger, listYears, loadYear, addExpense, updateExpense, deleteExpenses, groupExpenses, totalsByCategory } from '../../services/expenses.js';
import { getRegistry, updateRegistry } from '../../services/workspace.js';
import { createDocFromBlocks, expenseReportBlocks, exportFile } from '../../services/documents.js';
import { fileLink } from '../../lib/google-client.js';
import { isDemo } from '../../services/client.js';
import { openModal, confirmDialog, toast, toastError, emptyState, dropdown, loading, stat, field, select } from '../components.js';
import { openShareModal } from '../share-modal.js';
import { attachmentsPanel } from '../attachments-panel.js';

const PALETTE = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b', '#a3e635'];

export async function render(root, { setTitle, query }) {
  setTitle('Expenses');
  const ledger = await ensureLedger();
  let years = await listYears(ledger.id);
  const thisYear = todayISO().slice(0, 4);
  if (!years.includes(thisYear)) years = [thisYear, ...years].sort((a, b) => b.localeCompare(a));
  let year = years.includes(query.year) ? query.year : thisYear;
  let table = null;
  let filter = { q: '', category: '' };
  const openMonths = new Set([todayISO().slice(0, 7)]);

  const head = h('div', { class: 'page-head' });
  const tabs = h('div', { class: 'tabs' });
  const body = h('div');
  replace(root, head, tabs, body);

  function renderHead() {
    const menu = dropdown(h('button', { class: 'btn icon' }, icon('more')), [
      !isDemo() ? { label: 'Open in Google Sheets', icon: 'link', onClick: () => window.open(fileLink(ledger), '_blank', 'noopener') } : null,
      { label: 'Download as Excel', icon: 'download', onClick: async () => { try { downloadBlob(await exportFile(ledger, 'xlsx'), `${safeFileName(ledger.name)}.xlsx`); } catch (e) { toastError(e); } } },
      { label: `Yearly report ${year} (Google Doc)`, icon: 'doc', onClick: () => report(table?.rows || [], `Expenses ${year}`, year) },
      'sep',
      { label: 'Share ledger…', icon: 'share', onClick: () => openShareModal(ledger) },
      { label: 'Manage categories & accounts', icon: 'settings', onClick: manageCategories },
    ]);
    replace(head,
      h('div', null, h('h1', null, 'Expenses'), h('p', { class: 'sub' }, 'One Google Sheet, one tab per year. Grouped here by month and day.')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: () => editExpense(null) }, icon('plus'), 'Add expense'), menu));
  }

  function renderTabs() {
    replace(tabs, years.map((y) => h('button', { class: y === year ? 'active' : '', onClick: () => { year = y; history.replaceState(null, '', `#/expenses?year=${y}`); renderTabs(); load(); } }, y)),
      h('button', { onClick: async () => { const y = prompt('Which year?', String(Number(years[0]) + 1)); if (y && /^\d{4}$/.test(y) && !years.includes(y)) { years = [...years, y].sort((a, b) => b.localeCompare(a)); year = y; renderTabs(); load(); } } }, '+ Year'));
  }

  async function load() {
    replace(body, loading(`Loading ${year}…`));
    try {
      table = await loadYear(ledger.id, year);
    } catch {
      table = { rows: [], sheetTitle: year };
    }
    draw();
  }

  function draw() {
    const rows = table.rows;
    const q = filter.q.trim().toLowerCase();
    const filtered = rows.filter((r) => (!filter.category || r.category === filter.category) && (!q || `${r.description} ${r.category} ${r.notes} ${r.tags} ${r.account}`.toLowerCase().includes(q)));
    const total = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const months = groupExpenses(filtered);
    const monthsWithData = new Set(rows.map((r) => (r.date || '').slice(0, 7))).size || 1;
    const thisMonth = rows.filter((r) => (r.date || '').startsWith(todayISO().slice(0, 7))).reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const cats = totalsByCategory(rows);
    const colorOf = (c) => PALETTE[Math.abs([...c].reduce((a, ch) => a + ch.charCodeAt(0), 0)) % PALETTE.length];

    const search = h('input', { type: 'search', placeholder: 'Search description, category, notes…', value: filter.q, onInput: debounce((e) => { filter.q = e.target.value; draw(); }, 150) });
    const catSel = select([{ value: '', label: 'All categories' }, ...cats.map(([c]) => ({ value: c, label: c }))], filter.category, { style: { width: 'auto' }, onChange: (e) => { filter.category = e.target.value; draw(); } });

    replace(body,
      h('div', { class: 'grid cols-4 mb' },
        stat({ label: `Total ${year}`, value: fmtMoney(total, { compact: true }), hint: `${rows.length} entries` }),
        stat({ label: 'This month', value: fmtMoney(thisMonth, { compact: true }), hint: fmtMonth(todayISO().slice(0, 7)), tone: 'warn' }),
        stat({ label: 'Average / month', value: fmtMoney(total / monthsWithData, { compact: true }), hint: `${monthsWithData} month(s) with data` }),
        stat({ label: 'Top category', value: cats[0]?.[0] || '—', hint: cats[0] ? `${fmtMoney(cats[0][1], { compact: true })} · ${pct(cats[0][1], total)}%` : '' })),
      cats.length ? h('div', { class: 'card pad mb' },
        h('div', { class: 'cat-bar' }, cats.map(([c, v]) => h('span', { style: { width: `${pct(v, total)}%`, background: colorOf(c) }, title: `${c}: ${fmtMoney(v)}` }))),
        h('div', { class: 'legend' }, cats.slice(0, 8).map(([c, v]) => h('span', null, h('span', { class: 'dot', style: { background: colorOf(c), marginRight: '6px' } }), c, ' ', h('strong', null, fmtMoney(v, { compact: true })))))) : null,
      h('div', { class: 'toolbar' }, search, catSel, h('span', { class: 'spacer' }), h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: months.every((m) => openMonths.has(m.ym)), onChange: (e) => { months.forEach((m) => e.target.checked ? openMonths.add(m.ym) : openMonths.delete(m.ym)); draw(); } }), 'Expand all')),
      months.length
        ? h('div', { class: 'grid', style: { gap: '12px' } }, months.map((m) => monthCard(m, colorOf)))
        : emptyState({ emoji: '🧾', title: rows.length ? 'Nothing matches' : `No expenses in ${year} yet`, text: rows.length ? 'Try clearing the filters.' : 'Log your first expense — it lands in the sheet instantly.', action: rows.length ? null : h('button', { class: 'btn primary', onClick: () => editExpense(null) }, 'Add expense') }),
    );
  }

  function monthCard(m, colorOf) {
    const open = openMonths.has(m.ym);
    const cats = Object.entries(m.byCategory).sort((a, b) => b[1] - a[1]);
    const card = h('div', { class: 'card' },
      h('div', { class: 'month-head', onClick: () => { open ? openMonths.delete(m.ym) : openMonths.add(m.ym); draw(); } },
        h('div', null, h('span', null, `${open ? '▾' : '▸'} ${fmtMonth(m.ym)}`), h('span', { class: 'muted', style: { fontWeight: 500, marginLeft: '10px', fontSize: '13px' } }, `${m.count} entries`)),
        h('div', { class: 'inline' },
          h('button', { class: 'btn xs', onClick: (e) => { e.stopPropagation(); report(m.days.flatMap((d) => d.rows), `Expenses ${fmtMonth(m.ym)}`, fmtMonth(m.ym)); } }, icon('doc'), 'Report'),
          h('strong', null, fmtMoney(m.total)))),
      open ? h('div', null,
        h('div', { style: { padding: '10px 16px 0' } }, h('div', { class: 'cat-bar' }, cats.map(([c, v]) => h('span', { style: { width: `${pct(v, m.total)}%`, background: colorOf(c) }, title: `${c}: ${fmtMoney(v)}` })))),
        m.days.map((d) => h('div', null,
          h('div', { class: 'day-head row-between' }, h('span', null, fmtDate(d.date, { weekday: 'short' })), h('span', null, fmtMoney(d.total))),
          h('div', { class: 'list' }, d.rows.map((r) => h('div', { class: 'list-item' },
            h('span', { class: 'dot', style: { background: colorOf(r.category || 'Other') } }),
            h('div', { class: 'grow' }, h('div', { class: 't' }, r.description || r.category), h('div', { class: 's' }, [r.category, r.account, r.tags].filter(Boolean).join(' · '), r.attachments ? ' · 📎' : '')),
            h('strong', { class: 'nowrap' }, fmtMoney(r.amount)),
            h('button', { class: 'btn ghost xs', onClick: () => editExpense(r) }, icon('edit')),
          )))))) : null,
    );
    return card;
  }

  function editExpense(row) {
    const reg = getRegistry();
    const isNew = !row;
    const r = row || { date: todayISO(), category: reg.expenseCategories[0], description: '', amount: '', account: reg.expenseAccounts[0], tags: '', notes: '', attachments: '' };
    const date = h('input', { type: 'date', value: r.date, required: true });
    const amount = h('input', { type: 'text', value: r.amount ? String(r.amount) : '', placeholder: '1,250 or 2.5K', required: true, inputmode: 'decimal' });
    const category = select([...new Set([...reg.expenseCategories, r.category].filter(Boolean))], r.category);
    const description = h('input', { type: 'text', value: r.description || '', placeholder: 'What was it?' });
    const account = select([...new Set([...reg.expenseAccounts, r.account].filter(Boolean))], r.account || reg.expenseAccounts[0]);
    const tags = h('input', { type: 'text', value: r.tags || '', placeholder: 'comma, separated' });
    const notes = h('textarea', { rows: 2 }, r.notes || '');
    let attachments = r.attachments || '';
    const attach = isNew ? h('p', { class: 'help' }, 'Save first, then attach receipts.') : attachmentsPanel({ value: attachments, folderKey: 'att:expenses', folderName: 'Expenses', meta: { ld_expense: r.id }, onChange: async (v) => { attachments = v; await updateExpense(ledger.id, table, r.id, { attachments: v }); } });

    const save = async (keepOpen = false) => {
      if (!date.value || !amount.value.trim()) { toast('Date and amount are required', 'error'); return; }
      const patch = { date: date.value, category: category.value, description: description.value.trim(), amount: parseAmount(amount.value), account: account.value, tags: tags.value.trim(), notes: notes.value.trim() };
      try {
        if (isNew) {
          await addExpense(ledger.id, patch);
          toast('Expense added', 'success');
          if (!years.includes(patch.date.slice(0, 4))) { years = [...years, patch.date.slice(0, 4)].sort((a, b) => b.localeCompare(a)); }
          if (keepOpen) { amount.value = ''; description.value = ''; amount.focus(); if (patch.date.slice(0, 4) === year) await load(); return; }
        } else {
          const res = await updateExpense(ledger.id, table, r.id, patch);
          toast(res.moved ? `Moved to ${res.moved}` : 'Saved', 'success');
        }
        m.close();
        if (patch.date.slice(0, 4) !== year) { year = patch.date.slice(0, 4); renderTabs(); }
        openMonths.add(patch.date.slice(0, 7));
        await load();
      } catch (e) { toastError(e); }
    };

    const m = openModal({
      title: isNew ? 'Add expense' : 'Edit expense',
      body: h('form', { onSubmit: (e) => { e.preventDefault(); save(false); } },
        h('div', { class: 'form-grid' },
          field('Date', date), field('Amount', amount), field('Category', category), field('Account', account),
          h('div', { class: 'field span-2' }, h('label', null, 'Description'), description),
          field('Tags', tags), h('div', { class: 'field' }, h('label', null, 'Notes'), notes),
          h('div', { class: 'field span-2' }, h('label', null, 'Receipts / screenshots'), attach))),
      footer: [
        !isNew ? h('button', { class: 'btn danger left', onClick: async () => { if (await confirmDialog({ title: 'Delete expense?', message: 'This row is removed from the sheet.', confirmText: 'Delete', danger: true })) { try { await deleteExpenses(table, [r.id]); m.close(); toast('Deleted', 'success'); await load(); } catch (e) { toastError(e); } } } }, 'Delete') : null,
        h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
        isNew ? h('button', { class: 'btn', onClick: () => save(true) }, 'Save & add another') : null,
        h('button', { class: 'btn primary', onClick: () => save(false) }, isNew ? 'Add expense' : 'Save'),
      ],
    });
    setTimeout(() => amount.focus(), 50);
  }

  function manageCategories() {
    const reg = getRegistry();
    const cats = h('textarea', { rows: 8 }, reg.expenseCategories.join('\n'));
    const accts = h('textarea', { rows: 4 }, reg.expenseAccounts.join('\n'));
    const m = openModal({ title: 'Categories & accounts', subtitle: 'One per line. Saved to workspace.json in your Drive.', body: h('div', { class: 'form-grid' }, field('Expense categories', cats), field('Accounts / payment methods', accts)), footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
      const lines = (t) => [...new Set(t.value.split('\n').map((x) => x.trim()).filter(Boolean))];
      try { await updateRegistry({ expenseCategories: lines(cats), expenseAccounts: lines(accts) }); m.close(); toast('Saved', 'success'); draw(); } catch (e) { toastError(e); }
    } }, 'Save')] });
  }

  async function report(rows, title, period) {
    if (!rows.length) return toast('No entries to report');
    const t = toast('Creating Google Doc…', 'info', 60000);
    try {
      const file = await createDocFromBlocks(title, expenseReportBlocks({ title, rows, period }));
      t.remove();
      const m = openModal({ title: 'Report ready', size: 'narrow', body: h('p', null, `“${file.name}” saved to Documents in your Drive.`), footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'Close'), h('a', { class: 'btn primary', href: isDemo() ? '#/studio' : fileLink(file), target: isDemo() ? '' : '_blank', rel: 'noopener', onClick: () => m.close() }, isDemo() ? 'View in Studio' : 'Open Google Doc')] });
    } catch (e) { t.remove(); toastError(e); }
  }

  renderHead();
  renderTabs();
  await load();
  if (query.add) { history.replaceState(null, '', '#/expenses'); editExpense(null); }
}
