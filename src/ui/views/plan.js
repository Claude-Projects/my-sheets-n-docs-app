import { h, replace, icon, downloadBlob, debounce } from '../../lib/dom.js';
import { fmtMoney, fmtDate, relativeDue, pct, parseAmount, todayISO, safeFileName, addDays, parseISODate, toISODate } from '../../lib/format.js';
import { prefs } from '../../state.js';
import { openWorkbook, loadPlanRows, updateRows, markStatus, deleteRows, addRows, resequence, updatePlanMeta, deletePlan, attachmentsFolderFor, parseAttachments, PLAN_COLORS } from '../../services/plans.js';
import { effectiveStatus, summarize, groupByDate, STATUSES, generateSchedule, FREQUENCIES } from '../../services/schedule.js';
import { createDocFromBlocks, createDeck, statementBlocks, deckSlides, exportFile } from '../../services/documents.js';
import { getRegistry } from '../../services/workspace.js';
import { fileLink } from '../../lib/google-client.js';
import { isDemo } from '../../services/client.js';
import { openModal, confirmDialog, toast, toastError, emptyState, dropdown, loading, badge, stat, progress, field, select, segmented } from '../components.js';
import { openShareModal } from '../share-modal.js';
import { openPlanWizard } from '../plan-wizard.js';
import { openRowEditor } from '../row-editor.js';

export async function render(root, { params, query, setTitle, navigate }) {
  const { workbookId } = params;
  let wb = await openWorkbook(workbookId);
  setTitle(wb.file.name);
  const readOnly = wb.file.capabilities && wb.file.capabilities.canEdit === false;

  let showArchived = false;
  let planId = params.planId || wb.plans.find((p) => p.status !== 'archived')?.id || wb.plans[0]?.id || null;
  let table = null;
  let plan = null;
  const selected = new Set();
  let filter = { q: '', status: 'all' };

  const head = h('div', { class: 'page-head' });
  const tabs = h('div', { class: 'tabs' });
  const panel = h('div');
  replace(root, head, tabs, panel);

  function renderHead() {
    const menu = dropdown(h('button', { class: 'btn icon', 'aria-label': 'Workbook actions' }, icon('more')), [
      !isDemo() ? { label: 'Open in Google Sheets', icon: 'link', onClick: () => window.open(fileLink(wb.file), '_blank', 'noopener') } : null,
      { label: 'Download as Excel (.xlsx)', icon: 'download', onClick: async () => { try { downloadBlob(await exportFile(wb.file, 'xlsx'), `${safeFileName(wb.file.name)}.xlsx`); } catch (e) { toastError(e); } } },
      { label: 'Download as PDF', icon: 'download', onClick: async () => { try { downloadBlob(await exportFile(wb.file, 'pdf'), `${safeFileName(wb.file.name)}.pdf`); } catch (e) { toastError(e); } } },
      'sep',
      { label: showArchived ? 'Hide archived plans' : 'Show archived plans', icon: 'archive', onClick: () => { showArchived = !showArchived; renderTabs(); } },
      { label: 'All workbooks', icon: 'back', onClick: () => navigate('/plans') },
    ]);
    replace(head,
      h('div', null,
        h('a', { href: '#/plans', class: 'muted', style: { fontSize: '13px' } }, '← Installment plans'),
        h('h1', null, icon('sheet'), ' ', wb.file.name),
        h('p', { class: 'sub' }, `${wb.plans.filter((p) => p.status !== 'archived').length} plan(s) · ${wb.file.ownedByMe === false ? `shared by ${wb.file.owners?.[0]?.emailAddress || 'someone'}` : 'stored in your Google Drive'}${readOnly ? ' · view only' : ''}`)),
      h('div', { class: 'actions' },
        wb.file.ownedByMe !== false ? h('button', { class: 'btn', onClick: async () => { try { const f = await attachmentsFolderFor(wb.file); openShareModal(wb.file, { extraFileIds: [f.id] }); } catch (e) { toastError(e); } } }, icon('share'), 'Share') : null,
        !readOnly ? h('button', { class: 'btn primary', onClick: () => openPlanWizard(workbookId, { onCreated: async (p) => { await reloadWorkbook(); selectPlan(p.id); } }) }, icon('plus'), 'New plan') : null,
        menu));
  }

  function renderTabs() {
    const visible = wb.plans.filter((p) => showArchived || p.status !== 'archived');
    replace(tabs, visible.map((p) => h('button', { class: p.id === planId ? 'active' : '', onClick: () => selectPlan(p.id) },
      h('span', { class: 'color-swatch', style: { background: p.color || '#94a3b8', marginRight: '8px' } }), p.title, p.status === 'archived' ? h('span', { class: 'count' }, 'archived') : null)),
    !readOnly ? h('button', { onClick: () => openPlanWizard(workbookId, { onCreated: async (p) => { await reloadWorkbook(); selectPlan(p.id); } }) }, '+ New plan') : null);
  }

  async function reloadWorkbook() {
    wb = await openWorkbook(workbookId);
    renderHead();
    renderTabs();
  }

  async function selectPlan(id) {
    planId = id;
    selected.clear();
    history.replaceState(null, '', `#/plans/${workbookId}/${id}`);
    renderTabs();
    await loadPlan();
  }

  async function loadPlan() {
    plan = wb.plans.find((p) => p.id === planId);
    if (!plan) {
      replace(panel, emptyState({ emoji: '🧾', title: 'No plans in this workbook yet', text: 'A plan is one tab in the sheet: a plot, a car, a scheme. Generate the full schedule in three steps.', action: !readOnly ? h('button', { class: 'btn primary', onClick: () => openPlanWizard(workbookId, { onCreated: async (p) => { await reloadWorkbook(); selectPlan(p.id); } }) }, 'Create a plan') : null }));
      return;
    }
    replace(panel, loading('Loading installments…'));
    try {
      table = await loadPlanRows(workbookId, plan);
    } catch (e) {
      replace(panel, emptyState({ emoji: '⚠', title: 'Could not read this tab', text: e.message }));
      return;
    }
    renderPlan();
  }

  // ---------- Plan panel ----------
  function renderPlan() {
    const rows = table.rows;
    const s = summarize(rows);
    const dueSoonDays = prefs.get().dueSoonDays;

    const planMenu = dropdown(h('button', { class: 'btn', 'aria-label': 'Plan actions' }, icon('more'), 'Plan'), [
      { label: 'Edit plan details', icon: 'edit', onClick: editPlanDetails },
      { label: 'Add rows (single or generated)', icon: 'plus', onClick: addRowsDialog },
      'sep',
      { label: 'Generate payment statement (Google Doc)', icon: 'doc', onClick: () => generate('doc') },
      { label: 'Generate presentation (Google Slides)', icon: 'slides', onClick: () => generate('slides') },
      'sep',
      { label: plan.status === 'archived' ? 'Unarchive plan' : 'Archive plan', icon: 'archive', onClick: async () => { try { await updatePlanMeta(workbookId, plan.id, { status: plan.status === 'archived' ? 'active' : 'archived' }); toast(plan.status === 'archived' ? 'Plan restored' : 'Plan archived (tab hidden in Sheets)', 'success'); await reloadWorkbook(); await loadPlan(); } catch (e) { toastError(e); } } },
      { label: 'Delete plan (tab)', icon: 'trash', danger: true, onClick: async () => { if (await confirmDialog({ title: `Delete “${plan.title}”?`, message: 'The tab and all its rows are removed from the spreadsheet. This cannot be undone (unless you restore the sheet version in Google Sheets).', confirmText: 'Delete plan', danger: true })) { try { await deletePlan(workbookId, plan); toast('Plan deleted', 'success'); await reloadWorkbook(); planId = wb.plans[0]?.id || null; await loadPlan(); } catch (e) { toastError(e); } } } },
    ]);

    const search = h('input', { type: 'search', placeholder: 'Search title, category, notes…', value: filter.q, onInput: debounce((e) => { filter.q = e.target.value; drawTable(); }, 150) });
    const statusSeg = segmented([{ value: 'all', label: `All (${rows.length})` }, { value: 'pending', label: `Pending (${s.pendingCount})` }, { value: 'overdue', label: `Overdue (${s.overdueCount})` }, { value: 'paid', label: `Paid (${s.paidCount})` }], filter.status, (v) => { filter.status = v; drawTable(); });
    const groupToggle = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: prefs.get().groupByDate, onChange: (e) => { prefs.set({ groupByDate: e.target.checked }); } }), 'Group by due date');
    const bulkbar = h('div', { class: 'bulkbar', hidden: true });
    const tableHost = h('div');

    replace(panel,
      h('div', { class: 'row-between mb' },
        h('div', null, h('h2', null, plan.title), h('p', { class: 'muted' }, [plan.asset, plan.scheme].filter(Boolean).join(' · ') || 'No asset/scheme set', plan.external ? ' · added directly in Google Sheets' : '')),
        h('div', { class: 'actions' }, !readOnly ? h('button', { class: 'btn primary', onClick: () => addRowsDialog() }, icon('plus'), 'Add row') : null, !readOnly ? planMenu : null)),
      h('div', { class: 'grid cols-4 mb' },
        stat({ label: 'Total payable', value: fmtMoney(s.total, { compact: true }), hint: `${rows.length} rows` }),
        stat({ label: 'Paid', value: fmtMoney(s.paid, { compact: true }), hint: `${pct(s.paid, s.total)}% · ${s.paidCount} paid`, tone: 'good' }),
        stat({ label: 'Remaining', value: fmtMoney(s.remaining, { compact: true }), hint: `${s.pendingCount} pending` }),
        stat({ label: s.overdueCount ? 'Overdue' : 'Next due', value: s.overdueCount ? fmtMoney(s.overdue, { compact: true }) : s.next ? fmtDate(s.next.due_date) : '—', hint: s.overdueCount ? `${s.overdueCount} installment(s) late` : s.next ? `${s.next.title} · ${fmtMoney(s.next.amount, { compact: true })} · ${relativeDue(s.next.due_date)}` : 'Nothing pending', tone: s.overdueCount ? 'bad' : 'warn' })),
      h('div', { class: 'card pad mb' },
        progress(s.paid, s.total),
        h('div', { class: 'legend' }, Object.entries(s.byCategory).map(([k, v]) => h('span', { class: 'chip' }, h('strong', null, k), `${fmtMoney(v.paid, { compact: true })} / ${fmtMoney(v.total, { compact: true })}`, h('span', { class: 'faint' }, `(${v.count})`)))),
        plan.notes ? h('p', { class: 'muted mt-s', style: { fontSize: '13px' } }, plan.notes) : null),
      h('div', { class: 'toolbar' }, search, statusSeg,
        s.next ? h('button', { class: 'btn sm', title: 'Scroll to the next unpaid installment', onClick: () => { tableHost.querySelector('tr[data-next]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, '↓ Next due') : null,
        h('span', { class: 'spacer' }), groupToggle),
      bulkbar,
      tableHost,
    );

    function visibleRows() {
      const q = filter.q.trim().toLowerCase();
      return rows.filter((r) => {
        const st = effectiveStatus(r, { dueSoonDays });
        if (filter.status === 'pending' && ['paid', 'waived'].includes(r.status)) return false;
        if (filter.status === 'overdue' && st !== 'overdue') return false;
        if (filter.status === 'paid' && r.status !== 'paid') return false;
        if (q && !`${r.title} ${r.category} ${r.notes} ${r.due_date}`.toLowerCase().includes(q)) return false;
        return true;
      }).sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.seq - b.seq);
    }

    function drawBulk() {
      const n = selected.size;
      bulkbar.hidden = n === 0;
      if (!n) return;
      const ids = [...selected];
      const paidDate = h('input', { type: 'date', value: todayISO(), style: { width: '150px', minHeight: '32px', padding: '4px 8px' } });
      replace(bulkbar,
        h('strong', null, `${n} selected`),
        h('button', { class: 'btn sm success', onClick: () => run(() => markStatus(table, ids, 'paid', { paidDate: paidDate.value }), `Marked ${n} as paid`) }, '✓ Mark paid on'), paidDate,
        h('button', { class: 'btn sm', onClick: () => run(() => markStatus(table, ids, 'pending'), 'Marked pending') }, 'Mark pending'),
        h('button', { class: 'btn sm', onClick: () => run(() => markStatus(table, ids, 'waived'), 'Marked waived') }, 'Waive'),
        h('button', { class: 'btn sm', onClick: bulkShiftDates }, icon('calendar'), 'Shift dates'),
        h('button', { class: 'btn sm', onClick: bulkSetField }, icon('edit'), 'Set amount / category'),
        h('button', { class: 'btn sm danger', onClick: async () => { if (await confirmDialog({ title: `Delete ${n} row(s)?`, message: 'They are removed from the sheet and the remaining rows are renumbered.', confirmText: 'Delete', danger: true })) run(() => deleteRows(table, ids), `Deleted ${n} rows`); } }, icon('trash'), 'Delete'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn ghost sm', onClick: () => { selected.clear(); drawBulk(); drawTable(); } }, 'Clear selection'));
    }

    async function run(fn, msg) {
      try { await fn(); selected.clear(); toast(msg, 'success'); renderPlan(); } catch (e) { toastError(e); }
    }

    function bulkShiftDates() {
      const days = h('input', { type: 'number', value: '0', placeholder: '+7 or -3' });
      const months = h('input', { type: 'number', value: '0' });
      const m = openModal({ title: 'Shift due dates', size: 'narrow', body: h('div', { class: 'form-grid' }, field('Days', days), field('Months', months), h('p', { class: 'help span-2' }, `Applies to ${selected.size} selected rows. Negative values move earlier.`)), footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => {
        const d = Number(days.value) || 0, mo = Number(months.value) || 0;
        const changes = [...selected].map((id) => { const r = rows.find((x) => x.id === id); const base = parseISODate(r.due_date); if (!base) return null; const shifted = new Date(base); shifted.setMonth(shifted.getMonth() + mo); return { id, patch: { due_date: toISODate(addDays(shifted, d)) } }; }).filter(Boolean);
        m.close();
        run(async () => { await updateRows(table, changes); await resequence(table); }, 'Dates shifted');
      } }, 'Apply')] });
    }

    function bulkSetField() {
      const categories = getRegistry().installmentCategories;
      const amount = h('input', { type: 'text', placeholder: 'Leave empty to keep' });
      const category = select([{ value: '', label: '(keep)' }, ...categories.map((c) => ({ value: c, label: c }))], '');
      const status = select([{ value: '', label: '(keep)' }, ...STATUSES], '');
      const m = openModal({ title: `Update ${selected.size} rows`, size: 'narrow', body: h('div', { class: 'form-grid' }, field('Amount', amount), field('Category', category), field('Status', status)), footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => {
        const patch = {};
        if (amount.value.trim()) patch.amount = parseAmount(amount.value);
        if (category.value) patch.category = category.value;
        if (status.value) { patch.status = status.value; if (status.value === 'paid') patch.paid_date = todayISO(); if (status.value !== 'paid' && status.value !== 'partial') { patch.paid_date = ''; patch.paid_amount = 0; } }
        m.close();
        run(() => updateRows(table, [...selected].map((id) => ({ id, patch: { ...patch, ...(patch.status === 'paid' ? { paid_amount: patch.amount ?? rows.find((r) => r.id === id)?.amount } : {}) } }))), 'Rows updated');
      } }, 'Apply')] });
    }

    function drawTable() {
      const list = visibleRows();
      if (!list.length) { replace(tableHost, emptyState({ emoji: '🔎', title: rows.length ? 'No rows match' : 'No rows yet', text: rows.length ? 'Try a different filter.' : 'Add rows manually or generate a schedule.', action: rows.length ? null : h('button', { class: 'btn primary', onClick: addRowsDialog }, 'Add rows') })); return; }
      const allChecked = list.every((r) => selected.has(r.id));
      const thead = h('thead', null, h('tr', null,
        h('th', { style: { width: '34px' } }, h('input', { type: 'checkbox', checked: allChecked, title: 'Select all visible', onChange: (e) => { list.forEach((r) => e.target.checked ? selected.add(r.id) : selected.delete(r.id)); drawBulk(); drawTable(); } })),
        h('th', { style: { width: '44px' }, title: 'Tick to mark paid' }, '✓'),
        h('th', null, '#'), h('th', null, 'Due'), h('th', null, 'Title'), h('th', null, 'Category'), h('th', { class: 'num' }, 'Amount'), h('th', null, 'Status'), h('th', null, 'Paid on'), h('th', null, '📎'), h('th')));
      const tbody = h('tbody');
      const groups = prefs.get().groupByDate ? groupByDate(list) : [[null, list]];
      for (const [date, grp] of groups) {
        if (date) {
          const total = grp.reduce((a, r) => a + (Number(r.amount) || 0), 0);
          const allPaid = grp.every((r) => r.status === 'paid' || r.status === 'waived');
          tbody.appendChild(h('tr', { class: 'group-row' }, h('td', { colspan: 11 }, h('div', { class: 'row-between' },
            h('span', null, `${fmtDate(date, { weekday: 'short' })} · ${relativeDue(date)} · ${grp.length} item(s) · ${fmtMoney(total)}`),
            !readOnly && !allPaid ? h('button', { class: 'btn xs success', onClick: () => run(() => markStatus(table, grp.filter((r) => r.status !== 'paid').map((r) => r.id), 'paid', { paidDate: date <= todayISO() ? date : todayISO() }), 'Marked paid') }, `✓ Mark all ${fmtMoney(total, { compact: true })} paid`) : null))));
        }
        for (const r of grp) tbody.appendChild(rowEl(r));
      }
      replace(tableHost, h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, thead, tbody)));
    }

    function rowEl(r) {
      const st = effectiveStatus(r, { dueSoonDays });
      const isPaid = r.status === 'paid';
      const atts = parseAttachments(r.attachments);
      const tr = h('tr', { class: `${st === 'overdue' ? 'overdue' : ''} ${isPaid ? 'paid' : ''} ${selected.has(r.id) ? 'selected' : ''}`, 'data-next': s.next && s.next.id === r.id ? '1' : null },
        h('td', null, h('input', { type: 'checkbox', checked: selected.has(r.id), onChange: (e) => { e.target.checked ? selected.add(r.id) : selected.delete(r.id); tr.classList.toggle('selected', e.target.checked); drawBulk(); } })),
        h('td', null, h('button', { class: `btn xs ${isPaid ? 'success' : ''}`, title: isPaid ? 'Paid — click to mark pending' : 'Mark as paid today', disabled: readOnly, style: { borderRadius: '999px', width: '28px', height: '28px', padding: 0 }, onClick: () => run(() => markStatus(table, [r.id], isPaid ? 'pending' : 'paid'), isPaid ? 'Marked pending' : 'Marked paid') }, isPaid ? '✓' : '')),
        h('td', { class: 'num muted' }, String(r.seq)),
        h('td', { class: 'due' }, fmtDate(r.due_date), st === 'overdue' || st === 'due-soon' ? h('div', { class: 'faint', style: { fontSize: '11px' } }, relativeDue(r.due_date)) : null),
        h('td', { class: 'title editable', onDblClick: () => edit(r) }, r.title, r.notes ? h('div', { class: 'faint truncate', style: { fontSize: '12px', maxWidth: '280px' } }, r.notes) : null),
        h('td', null, h('span', { class: 'chip' }, r.category)),
        h('td', { class: 'num amount' }, h('strong', null, fmtMoney(r.amount)), r.status === 'partial' ? h('div', { class: 'faint', style: { fontSize: '11px' } }, `paid ${fmtMoney(r.paid_amount)}`) : null),
        h('td', null, badge(st)),
        h('td', { class: 'muted' }, r.paid_date ? fmtDate(r.paid_date) : '—'),
        h('td', null, atts.length ? h('button', { class: 'btn ghost xs', title: atts.map((a) => a.name).join('\n'), onClick: () => edit(r) }, `📎 ${atts.length}`) : ''),
        h('td', null, h('button', { class: 'btn ghost xs', onClick: () => edit(r) }, icon('edit'), readOnly ? 'View' : 'Edit')),
      );
      return tr;
    }

    function edit(r) {
      openRowEditor({
        row: r, workbook: wb.file, plan,
        onSave: async (patch) => { await updateRows(table, [{ id: r.id, patch }]); if (patch.due_date !== r.due_date) await resequence(table); renderPlan(); },
        onDelete: async () => { await deleteRows(table, [r.id]); toast('Row deleted', 'success'); renderPlan(); },
        onAttachmentsChange: async (v) => { await updateRows(table, [{ id: r.id, patch: { attachments: v } }]); renderPlan(); },
      });
    }

    drawBulk();
    drawTable();
  }

  // ---------- Dialogs ----------
  function editPlanDetails() {
    const title = h('input', { type: 'text', value: plan.title });
    const asset = h('input', { type: 'text', value: plan.asset || '' });
    const scheme = h('input', { type: 'text', value: plan.scheme || '' });
    const total = h('input', { type: 'text', value: plan.total_price ? String(plan.total_price) : '' });
    const dev = h('input', { type: 'text', value: plan.dev_charges ? String(plan.dev_charges) : '' });
    const notes = h('textarea', { rows: 3 }, plan.notes || '');
    let color = plan.color || PLAN_COLORS[0];
    const swatches = h('div', { class: 'inline' });
    const drawSwatches = () => replace(swatches, PLAN_COLORS.map((c) => h('button', { class: 'btn icon', title: c, style: { background: c, borderColor: c === color ? 'var(--fg)' : c, borderWidth: c === color ? '3px' : '1px', width: '28px', height: '28px' }, onClick: () => { color = c; drawSwatches(); } })));
    drawSwatches();
    const m = openModal({ title: 'Plan details', body: h('div', { class: 'form-grid' }, h('div', { class: 'field span-2' }, h('label', null, 'Plan name'), title), field('Asset', asset), field('Scheme', scheme), field('Total price', total), field('Development charges', dev), h('div', { class: 'field span-2' }, h('label', null, 'Colour'), swatches), h('div', { class: 'field span-2' }, h('label', null, 'Notes'), notes)), footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
      try {
        await updatePlanMeta(workbookId, plan.id, { title: title.value.trim() || plan.title, asset: asset.value.trim(), scheme: scheme.value.trim(), total_price: parseAmount(total.value), dev_charges: parseAmount(dev.value), notes: notes.value.trim(), color });
        m.close(); toast('Plan updated', 'success'); await reloadWorkbook(); await loadPlan();
      } catch (e) { toastError(e); }
    } }, 'Save')] });
  }

  function addRowsDialog() {
    const categories = getRegistry().installmentCategories;
    let mode = 'single';
    const body = h('div');
    const single = () => {
      const m = openRowEditor({ row: { title: '', category: categories[0], amount: 0, due_date: todayISO(), status: 'pending' }, workbook: wb.file, plan, isNew: true, onSave: async (patch) => { await addRows(table, [patch]); renderPlan(); } });
      return m;
    };
    const generated = () => {
      const name = h('input', { type: 'text', value: 'Installment' });
      const category = select(categories.map((c) => ({ value: c, label: c })), categories[0]);
      const amount = h('input', { type: 'text', value: '70000' });
      const freq = select(FREQUENCIES.map((f) => ({ value: f.id, label: f.label })), 'monthly');
      const count = h('input', { type: 'number', min: 1, value: '12' });
      const start = h('input', { type: 'date', value: todayISO() });
      const m = openModal({ title: 'Generate more rows', body: h('div', { class: 'form-grid' }, field('Name', name), field('Category', category), field('Amount each', amount), field('Frequency', freq), field('How many', count), field('First due date', start)), footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
        const rows = generateSchedule({ streams: [{ name: name.value, category: category.value, amount: parseAmount(amount.value), frequency: freq.value, count: Number(count.value), startDate: start.value }] });
        try { await addRows(table, rows); m.close(); toast(`${rows.length} rows added`, 'success'); renderPlan(); } catch (e) { toastError(e); }
      } }, 'Add rows')] });
    };
    const m = openModal({ title: 'Add rows', size: 'narrow', body: h('div', { class: 'grid' },
      h('button', { class: 'btn block', onClick: () => { m.close(); single(); } }, '➕ One row (booking, possession, fee…)'),
      h('button', { class: 'btn block', onClick: () => { m.close(); generated(); } }, '⟳ Generate a recurring series')) });
  }

  async function generate(kind) {
    const owner = wb.file.owners?.[0]?.emailAddress;
    const t = toast(kind === 'doc' ? 'Creating Google Doc…' : 'Creating Google Slides…', 'info', 60000);
    try {
      const file = kind === 'doc'
        ? await createDocFromBlocks(`${plan.title} — Payment Statement ${todayISO()}`, statementBlocks({ workbook: wb.file, plan, rows: table.rows, owner }))
        : await createDeck(`${plan.title} — Overview ${todayISO()}`, deckSlides({ workbook: wb.file, plan, rows: table.rows }));
      t.remove();
      const m = openModal({ title: 'Ready', size: 'narrow', body: h('p', null, `“${file.name}” was saved to your Documents folder in Drive.`), footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'Close'), h('a', { class: 'btn primary', href: isDemo() ? '#/studio' : fileLink(file), target: isDemo() ? '' : '_blank', rel: 'noopener', onClick: () => m.close() }, isDemo() ? 'View in Studio' : `Open in Google ${kind === 'doc' ? 'Docs' : 'Slides'}`)] });
    } catch (e) { t.remove(); toastError(e); }
  }

  renderHead();
  renderTabs();
  await loadPlan();
  if (query.new && !readOnly) { history.replaceState(null, '', `#/plans/${workbookId}`); openPlanWizard(workbookId, { onCreated: async (p) => { await reloadWorkbook(); selectPlan(p.id); } }); }
  const unsub = prefs.subscribe(() => { if (table && plan) renderPlan(); });
  return unsub;
}

