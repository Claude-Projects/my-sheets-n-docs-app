import { h, replace, clear } from '../lib/dom.js';
import { fmtMoney, fmtDate, parseAmount, todayISO } from '../lib/format.js';
import { openModal, field, select, toast, toastError } from './components.js';
import { TEMPLATES, templateById } from '../services/templates.js';
import { FREQUENCIES, generateSchedule, renumber, summarize } from '../services/schedule.js';
import { getRegistry } from '../services/workspace.js';
import { createPlan } from '../services/plans.js';

/** Multi-step wizard that creates a plan (tab) inside a workbook. Resolves with the created plan meta or null. */
export function openPlanWizard(workbookId, { onCreated } = {}) {
  let step = 0;
  let spec = templateById('plot-dev').build();
  let rows = [];
  const categories = getRegistry().installmentCategories;
  const body = h('div');
  const steps = h('div', { class: 'steps' });
  const modal = openModal({ title: 'New installment plan', size: 'wide', body: h('div', null, steps, body), footer: [] });

  function renderSteps() {
    replace(steps, [0, 1, 2].map((i) => h('span', { class: i <= step ? 'done' : '' })));
  }

  function go(n) { step = n; renderSteps(); render(); }

  function render() {
    if (step === 0) return renderTemplates();
    if (step === 1) return renderDetails();
    return renderPreview();
  }

  // ---- Step 1: template ----
  function renderTemplates() {
    replace(body, h('p', { class: 'muted mb' }, 'Pick a starting point. Everything is editable in the next step.'),
      h('div', { class: 'grid cols-2' }, TEMPLATES.map((t) => h('div', { class: 'card tile', onClick: () => { spec = t.build(); go(1); } },
        h('h3', null, t.name), h('div', { class: 'meta' }, t.description)))));
    modal.setFooter([h('button', { class: 'btn', onClick: () => modal.close(null) }, 'Cancel')]);
  }

  // ---- Step 2: details ----
  function renderDetails() {
    const m = spec.meta;
    const title = h('input', { type: 'text', value: m.title || '', placeholder: 'e.g. GFS Ph-3 Plot R-19', required: true });
    const asset = h('input', { type: 'text', value: m.asset || '', placeholder: 'Plot / flat / car…' });
    const scheme = h('input', { type: 'text', value: m.scheme || '', placeholder: 'Scheme / society / bank' });
    const total = h('input', { type: 'text', value: m.total_price ? String(m.total_price) : '', placeholder: 'e.g. 29 Lac or 2900000' });
    const dev = h('input', { type: 'text', value: m.dev_charges ? String(m.dev_charges) : '', placeholder: 'e.g. 1080K' });
    const notes = h('textarea', { rows: 2, placeholder: 'Anything worth remembering (refundable deposits, contact person…)' }, m.notes || '');

    const streamsBox = h('div', { class: 'grid', style: { gap: '10px' } });
    const oneOffBox = h('div', { class: 'grid', style: { gap: '10px' } });

    const renderStreams = () => {
      clear(streamsBox);
      spec.streams.forEach((s, i) => streamsBox.appendChild(h('div', { class: 'stream' }, h('div', { class: 'row' },
        field('Name', h('input', { type: 'text', value: s.name || '', onInput: (e) => { s.name = e.target.value; } })),
        field('Category', select(categories.map((c) => ({ value: c, label: c })), s.category || categories[0], { onChange: (e) => { s.category = e.target.value; } })),
        field('Amount each', h('input', { type: 'text', value: String(s.amount || ''), onInput: (e) => { s.amount = parseAmount(e.target.value); } })),
        field('Frequency', select(FREQUENCIES.map((f) => ({ value: f.id, label: f.label })), s.frequency || 'monthly', { onChange: (e) => { s.frequency = e.target.value; } })),
        field('Count', h('input', { type: 'number', min: 1, max: 600, value: String(s.count || 12), onInput: (e) => { s.count = Number(e.target.value); } })),
        h('button', { class: 'btn ghost icon', title: 'Remove stream', onClick: () => { spec.streams.splice(i, 1); renderStreams(); } }, '✕'),
      ), h('div', { class: 'row', style: { gridTemplateColumns: '1fr 1fr 2fr' } },
        field('First due date', h('input', { type: 'date', value: s.startDate || todayISO(), onInput: (e) => { s.startDate = e.target.value; } })),
        field('Fixed day of month (optional)', h('input', { type: 'number', min: 1, max: 31, value: s.dayOfMonth || '', placeholder: 'e.g. 10', onInput: (e) => { s.dayOfMonth = e.target.value ? Number(e.target.value) : null; } })),
        field('Notes for each row', h('input', { type: 'text', value: s.notes || '', onInput: (e) => { s.notes = e.target.value; } })),
      ))));
      streamsBox.appendChild(h('button', { class: 'btn sm', onClick: () => { spec.streams.push({ name: 'Installment', category: categories[0], amount: 0, frequency: 'monthly', startDate: todayISO(), count: 12 }); renderStreams(); } }, '+ Add recurring stream'));
    };
    const renderOneOffs = () => {
      clear(oneOffBox);
      spec.oneOffs.forEach((o, i) => oneOffBox.appendChild(h('div', { class: 'stream' }, h('div', { class: 'row', style: { gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto' } },
        field('Title', h('input', { type: 'text', value: o.title || '', onInput: (e) => { o.title = e.target.value; } })),
        field('Category', select(categories.map((c) => ({ value: c, label: c })), o.category || 'Other', { onChange: (e) => { o.category = e.target.value; } })),
        field('Amount', h('input', { type: 'text', value: String(o.amount || ''), onInput: (e) => { o.amount = parseAmount(e.target.value); } })),
        field('Due date', h('input', { type: 'date', value: o.dueDate || '', onInput: (e) => { o.dueDate = e.target.value; } })),
        field('Status', select(['pending', 'paid'], o.status || 'pending', { onChange: (e) => { o.status = e.target.value; if (o.status === 'paid' && !o.paidDate) o.paidDate = o.dueDate; } })),
        h('button', { class: 'btn ghost icon', title: 'Remove', onClick: () => { spec.oneOffs.splice(i, 1); renderOneOffs(); } }, '✕'),
      ))));
      oneOffBox.appendChild(h('button', { class: 'btn sm', onClick: () => { spec.oneOffs.push({ title: '', category: 'Other', amount: 0, dueDate: '' }); renderOneOffs(); } }, '+ Add one-off payment (booking, possession, fees…)'));
    };
    renderStreams();
    renderOneOffs();

    replace(body,
      h('div', { class: 'form-grid' },
        field('Plan name *', title), field('Asset', asset), field('Scheme / seller', scheme),
        field('Total price (info)', total, 'Accepts 29 Lac, 2.9M, 2900000'), field('Development charges (info)', dev),
        h('div', { class: 'field span-2' }, h('label', null, 'Notes'), notes)),
      h('h3', { class: 'mt mb-s' }, 'Recurring installments'),
      h('p', { class: 'help mb-s' }, 'Add one stream per component — e.g. “Plot 70K monthly × 22” and “Development 28K monthly × 20”. Bi-annual payments are just another stream with half-yearly frequency.'),
      streamsBox,
      h('h3', { class: 'mt mb-s' }, 'One-off payments'),
      oneOffBox,
    );
    modal.setFooter([
      h('button', { class: 'btn left', onClick: () => go(0) }, '← Templates'),
      h('button', { class: 'btn', onClick: () => modal.close(null) }, 'Cancel'),
      h('button', { class: 'btn primary', onClick: () => {
        if (!title.value.trim()) { title.focus(); toast('Give the plan a name', 'error'); return; }
        spec.meta = { ...m, title: title.value.trim(), asset: asset.value.trim(), scheme: scheme.value.trim(), total_price: parseAmount(total.value), dev_charges: parseAmount(dev.value), notes: notes.value.trim() };
        rows = generateSchedule(spec);
        go(2);
      } }, 'Preview schedule →'),
    ]);
  }

  // ---- Step 3: preview ----
  function renderPreview() {
    const s = summarize(rows);
    const tbody = h('tbody');
    const draw = () => {
      clear(tbody);
      rows.forEach((r, i) => tbody.appendChild(h('tr', null,
        h('td', { class: 'num muted' }, String(r.seq)),
        h('td', null, h('input', { type: 'date', class: 'cell-input', value: r.due_date, onChange: (e) => { r.due_date = e.target.value; } })),
        h('td', null, h('input', { type: 'text', class: 'cell-input', style: { width: '220px' }, value: r.title, onChange: (e) => { r.title = e.target.value; } })),
        h('td', null, r.category),
        h('td', { class: 'num' }, h('input', { type: 'text', class: 'cell-input', style: { width: '110px', textAlign: 'right' }, value: String(r.amount), onChange: (e) => { r.amount = parseAmount(e.target.value); } })),
        h('td', null, select(['pending', 'paid'], r.status, { class: 'cell-input', style: { width: 'auto' }, onChange: (e) => { r.status = e.target.value; if (r.status === 'paid') { r.paid_date = r.due_date; r.paid_amount = r.amount; } else { r.paid_date = ''; r.paid_amount = 0; } } })),
        h('td', null, h('button', { class: 'btn ghost xs', onClick: () => { rows.splice(i, 1); rows = renumber(rows); renderPreview(); } }, '✕')),
      )));
    };
    draw();
    replace(body,
      h('div', { class: 'grid cols-4 mb' },
        mini('Rows', String(rows.length)), mini('Total', fmtMoney(s.total, { compact: true })), mini('First due', rows[0] ? fmtDate(rows[0].due_date) : '—'), mini('Last due', rows.length ? fmtDate(rows[rows.length - 1].due_date) : '—')),
      Object.keys(s.byCategory).length ? h('div', { class: 'legend mb' }, Object.entries(s.byCategory).map(([k, v]) => h('span', { class: 'chip' }, h('strong', null, k), fmtMoney(v.total, { compact: true }), h('span', { class: 'faint' }, `× ${v.count}`)))) : null,
      h('p', { class: 'help mb-s' }, 'Fine-tune dates, titles or amounts here. Later you can edit rows singly or in bulk from the plan page.'),
      h('div', { class: 'table-wrap', style: { maxHeight: '46vh' } }, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Due'), h('th', null, 'Title'), h('th', null, 'Category'), h('th', { class: 'num' }, 'Amount'), h('th', null, 'Status'), h('th'))), tbody)),
    );
    const createBtn = h('button', { class: 'btn primary' }, 'Create plan in Google Sheets');
    createBtn.addEventListener('click', async () => {
      createBtn.disabled = true;
      createBtn.textContent = 'Creating…';
      try {
        rows = renumber(rows.filter((r) => r.title || r.amount));
        const plan = await createPlan(workbookId, spec.meta, rows);
        toast(`“${plan.title}” created with ${rows.length} rows`, 'success');
        modal.close(plan);
        onCreated?.(plan);
      } catch (e) {
        toastError(e);
        createBtn.disabled = false;
        createBtn.textContent = 'Create plan in Google Sheets';
      }
    });
    modal.setFooter([
      h('button', { class: 'btn left', onClick: () => go(1) }, '← Edit details'),
      h('button', { class: 'btn', onClick: () => { rows = renumber(rows); renderPreview(); } }, 'Re-sort by date'),
      createBtn,
    ]);
  }

  renderSteps();
  render();
  return modal;
}

function mini(label, value) {
  return h('div', { class: 'card stat', style: { padding: '10px 14px' } }, h('div', { class: 'label' }, label), h('div', { class: 'value', style: { fontSize: '18px' } }, value));
}
