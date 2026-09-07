// Installment schedule generator: turns a few inputs into a full dated plan.

import { addMonths, addDays, parseISODate, toISODate, todayISO } from '../lib/format.js';
import { uid, nowISO } from '../lib/ids.js';

export const FREQUENCIES = [
  { id: 'monthly', label: 'Monthly', months: 1 },
  { id: 'bimonthly', label: 'Every 2 months', months: 2 },
  { id: 'quarterly', label: 'Quarterly', months: 3 },
  { id: 'half-yearly', label: 'Half-yearly (bi-annual)', months: 6 },
  { id: 'yearly', label: 'Yearly', months: 12 },
  { id: 'weekly', label: 'Weekly', days: 7 },
  { id: 'fortnightly', label: 'Every 2 weeks', days: 14 },
];

export const STATUSES = ['pending', 'paid', 'partial', 'waived'];

export function nthDate(start, frequency, n) {
  const f = FREQUENCIES.find((x) => x.id === frequency) || FREQUENCIES[0];
  return f.days ? addDays(start, f.days * n) : addMonths(start, f.months * n);
}

/**
 * @param {{streams: Array, oneOffs: Array}} spec
 * @returns {Array} rows ready for the plan table (without ids assigned yet unless given)
 */
export function generateSchedule(spec) {
  const rows = [];
  for (const [sIdx, s] of (spec.streams || []).entries()) {
    const start = parseISODate(s.startDate);
    const count = Math.max(0, Number(s.count) || 0);
    if (!start || !count) continue;
    for (let i = 0; i < count; i++) {
      const due = nthDate(start, s.frequency, i);
      if (s.dayOfMonth && !FREQUENCIES.find((x) => x.id === s.frequency)?.days) {
        const last = new Date(due.getFullYear(), due.getMonth() + 1, 0).getDate();
        due.setDate(Math.min(Number(s.dayOfMonth), last));
      }
      rows.push({
        id: uid(),
        seq: 0,
        due_date: toISODate(due),
        title: `${s.name || s.category || 'Installment'} ${i + 1}/${count}`,
        category: s.category || s.name || 'Installment',
        amount: Number(s.amount) || 0,
        status: 'pending',
        paid_date: '',
        paid_amount: 0,
        notes: s.notes || '',
        attachments: '',
        stream: s.name || s.category || `Stream ${sIdx + 1}`,
        created_at: nowISO(),
        updated_at: nowISO(),
      });
    }
  }
  for (const o of spec.oneOffs || []) {
    if (!o.dueDate && !o.title) continue;
    rows.push({
      id: uid(),
      seq: 0,
      due_date: o.dueDate || '',
      title: o.title || o.category || 'Payment',
      category: o.category || 'Other',
      amount: Number(o.amount) || 0,
      status: o.status || 'pending',
      paid_date: o.paidDate || (o.status === 'paid' ? o.dueDate : '') || '',
      paid_amount: o.status === 'paid' ? Number(o.amount) || 0 : Number(o.paidAmount) || 0,
      notes: o.notes || '',
      attachments: '',
      stream: o.category || 'One-off',
      created_at: nowISO(),
      updated_at: nowISO(),
    });
  }
  return renumber(rows);
}

export function renumber(rows) {
  const sorted = [...rows].sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || String(a.category).localeCompare(String(b.category)));
  sorted.forEach((r, i) => { r.seq = i + 1; });
  return sorted;
}

/** Derived status used everywhere in the UI. */
export function effectiveStatus(row, { dueSoonDays = 7 } = {}) {
  if (row.status === 'paid' || row.status === 'waived') return row.status;
  const today = todayISO();
  const due = row.due_date || '';
  if (row.status === 'partial') return due && due < today ? 'overdue' : 'partial';
  if (due && due < today) return 'overdue';
  if (due) {
    const d = parseISODate(due);
    const diff = Math.round((d - parseISODate(today)) / 86400000);
    if (diff <= dueSoonDays) return 'due-soon';
  }
  return 'pending';
}

export function summarize(rows) {
  const s = { total: 0, paid: 0, remaining: 0, overdue: 0, overdueCount: 0, pendingCount: 0, paidCount: 0, dueSoon: 0, dueSoonCount: 0, byCategory: {}, next: null, count: rows.length };
  for (const r of rows) {
    const amount = Number(r.amount) || 0;
    const paidAmt = r.status === 'paid' ? amount : r.status === 'partial' ? Number(r.paid_amount) || 0 : 0;
    const st = effectiveStatus(r);
    const cat = (s.byCategory[r.category] ||= { total: 0, paid: 0, count: 0 });
    cat.total += amount;
    cat.paid += paidAmt;
    cat.count += 1;
    if (r.status === 'waived') continue;
    s.total += amount;
    s.paid += paidAmt;
    if (st === 'paid') s.paidCount += 1;
    else {
      s.pendingCount += 1;
      if (st === 'overdue') { s.overdue += amount - paidAmt; s.overdueCount += 1; }
      if (st === 'due-soon') { s.dueSoon += amount - paidAmt; s.dueSoonCount += 1; }
      if (!s.next || (r.due_date && r.due_date < s.next.due_date)) s.next = r;
    }
  }
  s.remaining = s.total - s.paid;
  return s;
}

export function groupByDate(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = r.due_date || 'No date';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return [...map.entries()];
}
