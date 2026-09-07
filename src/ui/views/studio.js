import { h, replace, icon, downloadBlob } from '../../lib/dom.js';
import { fmtDate, fmtMonth, todayISO, safeFileName } from '../../lib/format.js';
import { listWorkbooks, openWorkbook, loadPlanRows } from '../../services/plans.js';
import { listLedgers, listYears, loadYear } from '../../services/expenses.js';
import { createDocFromBlocks, createDeck, statementBlocks, deckSlides, expenseReportBlocks, listGenerated, createBlank, exportFile } from '../../services/documents.js';
import { fileLink, MIME } from '../../lib/google-client.js';
import { client, isDemo } from '../../services/client.js';
import { openModal, promptDialog, confirmDialog, toast, toastError, emptyState, dropdown, loading, field, select } from '../components.js';
import { openShareModal } from '../share-modal.js';

export async function render(root, { setTitle }) {
  setTitle('Docs & Slides studio');
  const list = h('div', null, loading('Loading documents…'));
  replace(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Docs & Slides studio'), h('p', { class: 'sub' }, 'Turn your sheets into polished Google Docs and Slides in one click. Files are saved to the Documents folder in your Drive.'))),
    h('div', { class: 'grid cols-3 mb' },
      tool('📄', 'Payment statement', 'A Google Doc with summary, category breakdown, payments made and what is still pending for one plan.', () => pickPlan('doc')),
      tool('📊', 'Plan presentation', 'Google Slides deck: at-a-glance numbers, category table and upcoming payments — ready to share.', () => pickPlan('slides')),
      tool('🧾', 'Expense report', 'A Google Doc for a whole year or a single month, grouped by category with every entry listed.', pickExpensePeriod),
      tool('📗', 'Blank Google Sheet', 'Start a spreadsheet in your LedgerDrive folder.', () => blank('sheet')),
      tool('📝', 'Blank Google Doc', 'Start a document in your LedgerDrive folder.', () => blank('doc')),
      tool('🖼', 'Blank Google Slides', 'Start a presentation in your LedgerDrive folder.', () => blank('slides'))),
    h('h2', { class: 'mb-s' }, 'Generated documents'),
    list,
  );

  async function loadList() {
    try {
      const files = await listGenerated();
      if (!files.length) { replace(list, emptyState({ emoji: '🗃', title: 'Nothing generated yet', text: 'Use a tool above — the result shows up here and in Drive → LedgerDrive → Documents.' })); return; }
      replace(list, h('div', { class: 'card' }, h('div', { class: 'list' }, files.map((f) => {
        const kind = f.mimeType === MIME.document ? 'doc' : f.mimeType === MIME.presentation ? 'slides' : 'sheet';
        const fmt = kind === 'doc' ? 'docx' : kind === 'slides' ? 'pptx' : 'xlsx';
        return h('div', { class: 'list-item' },
          h('span', { style: { fontSize: '22px' } }, kind === 'doc' ? '📄' : kind === 'slides' ? '📊' : '📗'),
          h('div', { class: 'grow' }, h('div', { class: 't' }, f.name), h('div', { class: 's' }, `Modified ${fmtDate(f.modifiedTime)}`)),
          !isDemo() ? h('a', { class: 'btn sm', href: fileLink(f), target: '_blank', rel: 'noopener' }, 'Open') : h('button', { class: 'btn sm', onClick: () => previewDemo(f) }, 'Preview'),
          dropdown(h('button', { class: 'btn ghost icon' }, icon('more')), [
            { label: `Download .${fmt}`, icon: 'download', onClick: async () => { try { downloadBlob(await exportFile(f, fmt), `${safeFileName(f.name)}.${fmt}`); } catch (e) { toastError(e); } } },
            { label: 'Download PDF', icon: 'download', onClick: async () => { try { downloadBlob(await exportFile(f, 'pdf'), `${safeFileName(f.name)}.pdf`); } catch (e) { toastError(e); } } },
            { label: 'Share…', icon: 'share', onClick: () => openShareModal(f) },
            'sep',
            { label: 'Move to trash', icon: 'trash', danger: true, onClick: async () => { if (await confirmDialog({ title: 'Move to trash?', message: f.name, confirmText: 'Trash', danger: true })) { try { await client().trashFile(f.id); loadList(); } catch (e) { toastError(e); } } } },
          ]));
      }))));
    } catch (e) { replace(list, h('div', { class: 'callout warn' }, e.message)); }
  }

  async function pickPlan(kind) {
    const { active } = await listWorkbooks();
    if (!active.length) return toast('Create an installment plan first', 'error');
    const options = [];
    for (const wb of active) {
      const { plans } = await openWorkbook(wb.id);
      for (const p of plans.filter((x) => x.status !== 'archived')) options.push({ value: `${wb.id}::${p.id}`, label: `${wb.name} › ${p.title}`, wb, p });
    }
    if (!options.length) return toast('No plans found', 'error');
    const sel = select(options, options[0].value);
    const m = openModal({ title: kind === 'doc' ? 'Payment statement' : 'Plan presentation', size: 'narrow', body: field('Which plan?', sel), footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
      const o = options.find((x) => x.value === sel.value);
      m.close();
      const t = toast('Generating…', 'info', 60000);
      try {
        const table = await loadPlanRows(o.wb.id, o.p);
        const file = kind === 'doc'
          ? await createDocFromBlocks(`${o.p.title} — Payment Statement ${todayISO()}`, statementBlocks({ workbook: o.wb, plan: o.p, rows: table.rows }))
          : await createDeck(`${o.p.title} — Overview ${todayISO()}`, deckSlides({ workbook: o.wb, plan: o.p, rows: table.rows }));
        t.remove(); done(file);
      } catch (e) { t.remove(); toastError(e); }
    } }, 'Generate')] });
  }

  async function pickExpensePeriod() {
    const { own } = await listLedgers();
    if (!own.length) return toast('No expenses yet', 'error');
    const years = await listYears(own[0].id);
    if (!years.length) return toast('No expenses yet', 'error');
    const ySel = select(years, years[0]);
    const mSel = select([{ value: '', label: 'Whole year' }, ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1).padStart(2, '0'), label: new Date(2000, i, 1).toLocaleString(undefined, { month: 'long' }) }))], '');
    const m = openModal({ title: 'Expense report', size: 'narrow', body: h('div', { class: 'form-grid' }, field('Year', ySel), field('Month', mSel)), footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
      m.close();
      const t = toast('Generating…', 'info', 60000);
      try {
        const table = await loadYear(own[0].id, ySel.value);
        const rows = mSel.value ? table.rows.filter((r) => (r.date || '').slice(5, 7) === mSel.value) : table.rows;
        const period = mSel.value ? fmtMonth(`${ySel.value}-${mSel.value}`) : ySel.value;
        const file = await createDocFromBlocks(`Expenses ${period}`, expenseReportBlocks({ title: `Expense report — ${period}`, rows, period }));
        t.remove(); done(file);
      } catch (e) { t.remove(); toastError(e); }
    } }, 'Generate')] });
  }

  async function blank(kind) {
    const name = await promptDialog({ title: `New ${kind === 'doc' ? 'Google Doc' : kind === 'slides' ? 'Google Slides' : 'Google Sheet'}`, label: 'Name', confirmText: 'Create' });
    if (!name) return;
    try { done(await createBlank(kind, name)); } catch (e) { toastError(e); }
  }

  function done(file) {
    loadList();
    const m = openModal({ title: 'Saved to Drive', size: 'narrow', body: h('p', null, `“${file.name}” is in Drive → LedgerDrive → Documents.`), footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'Close'), !isDemo() ? h('a', { class: 'btn primary', href: fileLink(file), target: '_blank', rel: 'noopener', onClick: () => m.close() }, 'Open') : null] });
  }

  async function previewDemo(f) {
    const c = client();
    const rec = c.db.docs?.[f.id] || c.db.slides?.[f.id];
    const texts = (rec?.requests || []).map((r) => r.insertText?.text).filter(Boolean);
    openModal({ title: f.name, subtitle: 'Demo preview — in Google mode this opens the real Doc/Slides.', body: texts.length ? h('pre', { style: { whiteSpace: 'pre-wrap' } }, texts.join('\n')) : h('p', { class: 'muted' }, 'Blank file.') });
  }

  await loadList();
}

function tool(emoji, title, text, onClick) {
  return h('div', { class: 'card tile', onClick }, h('h3', null, h('span', null, emoji), title), h('div', { class: 'meta' }, text));
}
