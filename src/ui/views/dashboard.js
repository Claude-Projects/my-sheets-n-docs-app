import { h, replace } from '../../lib/dom.js';
import { fmtMoney, fmtDate, relativeDue, todayISO, pct } from '../../lib/format.js';
import { session, prefs } from '../../state.js';
import { listWorkbooks, openWorkbook, loadPlanRows } from '../../services/plans.js';
import { effectiveStatus, summarize } from '../../services/schedule.js';
import { listLedgers, loadYear, totalsByCategory } from '../../services/expenses.js';
import { ensureTodoSheet, loadTodos, todoBuckets } from '../../services/todos.js';
import { stat, badge, emptyState, progress } from '../components.js';

export async function render(root, { setTitle }) {
  setTitle('Dashboard');
  const user = session.get().user;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const head = h('div', { class: 'page-head' },
    h('div', null, h('h1', null, `${greeting}, ${(user?.name || '').split(' ')[0] || 'there'}`), h('p', { class: 'sub' }, `Today is ${fmtDate(todayISO(), { weekday: 'long' })}. Here is where everything stands.`)),
    h('div', { class: 'actions' },
      h('a', { class: 'btn primary', href: '#/plans?new=1' }, '+ New plan'),
      h('a', { class: 'btn', href: '#/expenses?add=1' }, '+ Expense'),
      h('a', { class: 'btn', href: '#/todos?add=1' }, '+ Todo')),
  );
  const statsRow = h('div', { class: 'grid cols-4' }, skeleton(), skeleton(), skeleton(), skeleton());
  const upcoming = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Upcoming & overdue payments')), h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'Reading your plans…'));
  const side = h('div', { class: 'grid', style: { gap: '16px' } });
  replace(root, head, statsRow, h('div', { class: 'two-col mt' }, upcoming, side));

  // Plans
  const allRows = [];
  const planCards = [];
  try {
    const { active } = await listWorkbooks();
    for (const wb of active) {
      const { plans } = await openWorkbook(wb.id);
      for (const plan of plans.filter((p) => p.status !== 'archived')) {
        const table = await loadPlanRows(wb.id, plan);
        const s = summarize(table.rows);
        for (const r of table.rows) allRows.push({ ...r, plan, wb });
        planCards.push({ wb, plan, s });
      }
    }
  } catch (e) { console.warn(e); }

  const s = summarize(allRows);
  const dueThisMonth = allRows.filter((r) => !['paid', 'waived'].includes(r.status) && (r.due_date || '').slice(0, 7) === todayISO().slice(0, 7)).reduce((a, r) => a + (Number(r.amount) || 0) - (r.status === 'partial' ? Number(r.paid_amount) || 0 : 0), 0);
  replace(statsRow,
    stat({ label: 'Remaining across plans', value: fmtMoney(s.remaining, { compact: true }), hint: `${pct(s.paid, s.total)}% paid of ${fmtMoney(s.total, { compact: true })}` }),
    stat({ label: 'Overdue', value: fmtMoney(s.overdue, { compact: true }), hint: `${s.overdueCount} installment(s)`, tone: s.overdueCount ? 'bad' : 'good' }),
    stat({ label: 'Due this month', value: fmtMoney(dueThisMonth, { compact: true }), hint: fmtDate(todayISO(), { month: 'long', year: 'numeric', day: undefined }) , tone: dueThisMonth ? 'warn' : '' }),
    stat({ label: 'Active plans', value: String(planCards.length), hint: `${s.paidCount} payments made so far` }),
  );

  const pendingRows = allRows.filter((r) => !['paid', 'waived'].includes(r.status)).sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999')).slice(0, 10);
  replace(upcoming,
    h('div', { class: 'card-head' }, h('h3', null, 'Upcoming & overdue payments'), h('a', { class: 'btn sm', href: '#/plans' }, 'All plans')),
    pendingRows.length
      ? h('div', { class: 'list' }, pendingRows.map((r) => {
        const st = effectiveStatus(r, { dueSoonDays: prefs.get().dueSoonDays });
        return h('a', { class: 'list-item', href: `#/plans/${r.wb.id}/${r.plan.id}`, style: { color: 'inherit' } },
          h('span', { class: 'color-swatch', style: { background: r.plan.color || '#0ea5e9' } }),
          h('div', { class: 'grow' }, h('div', { class: 't' }, r.title), h('div', { class: 's' }, `${r.plan.title} · ${fmtDate(r.due_date)} · ${relativeDue(r.due_date)}`)),
          badge(st),
          h('strong', { class: 'nowrap' }, fmtMoney(r.amount)));
      }))
      : h('div', { class: 'empty' }, planCards.length ? 'Nothing pending — you are fully paid up.' : h('span', null, 'No plans yet. ', h('a', { href: '#/plans?new=1' }, 'Create your first installment plan'), '.')),
  );

  // Plan progress cards
  if (planCards.length) {
    side.appendChild(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, 'Plan progress')),
      h('div', { class: 'list' }, planCards.map(({ wb, plan, s: ps }) => h('a', { class: 'list-item', href: `#/plans/${wb.id}/${plan.id}`, style: { color: 'inherit', display: 'block' } },
        h('div', { class: 'row-between' }, h('strong', null, plan.title), h('span', { class: 'muted' }, `${pct(ps.paid, ps.total)}%`)),
        h('div', { class: 'mt-s' }, progress(ps.paid, ps.total)),
        h('div', { class: 's muted mt-s', style: { fontSize: '12px' } }, `${fmtMoney(ps.paid, { compact: true })} of ${fmtMoney(ps.total, { compact: true })} · next: ${ps.next ? fmtDate(ps.next.due_date) : '—'}`)))),
    ));
  }

  // Expenses this month
  try {
    const { own } = await listLedgers();
    if (own.length) {
      const year = todayISO().slice(0, 4);
      const t = await loadYear(own[0].id, year).catch(() => ({ rows: [] }));
      const month = todayISO().slice(0, 7);
      const rows = t.rows.filter((r) => (r.date || '').startsWith(month));
      const total = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
      const cats = totalsByCategory(rows).slice(0, 4);
      side.appendChild(h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', null, 'Expenses this month'), h('a', { class: 'btn sm', href: '#/expenses' }, 'Open')),
        h('div', { class: 'card-body' },
          h('div', { class: 'stat', style: { padding: 0 } }, h('div', { class: 'value' }, fmtMoney(total)), h('div', { class: 'hint' }, `${rows.length} entries`)),
          cats.length ? h('div', { class: 'legend' }, cats.map(([k, v]) => h('span', null, h('strong', null, k), ` ${fmtMoney(v, { compact: true })}`))) : null),
      ));
    }
  } catch (e) { console.warn(e); }

  // Todos
  try {
    const file = await ensureTodoSheet();
    const t = await loadTodos(file.id);
    const b = todoBuckets(t.rows);
    const items = [...b.overdue, ...b.today].slice(0, 6);
    side.appendChild(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, 'Todos needing attention'), h('a', { class: 'btn sm', href: '#/todos' }, 'Open')),
      items.length
        ? h('div', { class: 'list' }, items.map((r) => h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, r.title), h('div', { class: 's' }, `${r.list} · due ${fmtDate(r.due_date)}`)), badge(r.due_date < todayISO() ? 'overdue' : 'due-soon', r.due_date < todayISO() ? 'overdue' : 'today'))))
        : h('div', { class: 'empty', style: { padding: '20px' } }, 'Nothing overdue or due today.'),
    ));
  } catch (e) { console.warn(e); }

  if (!side.children.length) side.appendChild(emptyState({ title: 'Get started', text: 'Create a plan, log an expense or add a todo — each becomes a Google Sheet in your Drive.' }));
}

function skeleton() {
  return h('div', { class: 'card stat' }, h('div', { class: 'label' }, '…'), h('div', { class: 'value muted' }, '—'));
}
