// Seeds Demo mode with realistic data the first time it is opened.

import { createWorkbook, createPlan } from './plans.js';
import { generateSchedule } from './schedule.js';
import { templateById } from './templates.js';
import { ensureLedger, addExpense } from './expenses.js';
import { ensureTodoSheet, loadTodos, addTodo } from './todos.js';
import { todayISO, toISODate, addDays } from '../lib/format.js';

export async function seedDemo() {
  const wb = await createWorkbook('Property — Plots');
  const spec = templateById('gfs-sample').build();
  const rows = generateSchedule(spec).map((r) => {
    if (r.due_date < '2026-08-01' && r.status !== 'paid') return { ...r, status: 'paid', paid_date: r.due_date, paid_amount: r.amount };
    return r;
  });
  await createPlan(wb.id, spec.meta, rows);

  const car = templateById('simple').build();
  car.meta = { title: 'Car — Honda City', asset: 'Car', scheme: 'Bank lease', total_price: 1800000 };
  car.streams[0] = { ...car.streams[0], name: 'Lease installment', category: 'Other', amount: 62000, startDate: toISODate(addDays(new Date(), -400)), count: 36 };
  const carRows = generateSchedule(car).map((r) => (r.due_date < todayISO() ? { ...r, status: 'paid', paid_date: r.due_date, paid_amount: r.amount } : r));
  carRows[carRows.length - 30].status = 'pending';
  carRows[carRows.length - 30].paid_amount = 0;
  await createPlan(wb.id, car.meta, carRows);

  const ledger = await ensureLedger();
  const cats = [['Groceries', 4500, 'Weekly groceries'], ['Fuel', 6000, 'Petrol'], ['Utilities', 12500, 'Electricity bill'], ['Food & Dining', 2800, 'Dinner out'], ['Transport', 900, 'Ride'], ['Bills', 3000, 'Internet'], ['Health', 2200, 'Pharmacy'], ['Shopping', 7800, 'Clothes']];
  for (let i = 0; i < 40; i++) {
    const [category, amount, description] = cats[i % cats.length];
    const date = toISODate(addDays(new Date(), -Math.floor(i * 2.3)));
    await addExpense(ledger.id, { date, category, description, amount: Math.round(amount * (0.7 + ((i * 37) % 60) / 100)), account: i % 3 ? 'Cash' : 'Card' });
  }

  const todoFile = await ensureTodoSheet();
  const todos = await loadTodos(todoFile.id);
  await addTodo(todos, { title: 'Pay September plot installment', due_date: todayISO(), priority: 'high', list: 'Property' });
  await addTodo(todos, { title: 'Collect 25K security deposit refund', due_date: toISODate(addDays(new Date(), 14)), priority: 'medium', list: 'Property', notes: 'Refundable after demarcation' });
  await addTodo(todos, { title: 'Scan and attach payment receipts', due_date: '', priority: 'low', list: 'Personal' });
  await addTodo(todos, { title: 'Share plan with family', due_date: toISODate(addDays(new Date(), -2)), priority: 'medium', list: 'Family' });
}
