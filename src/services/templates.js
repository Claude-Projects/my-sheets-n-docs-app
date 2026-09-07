// Ready-made plan templates for the wizard.

const gfs = () => {
  const both = (date) => [
    { title: 'Plot installment', category: 'Plot', amount: 70000, dueDate: date },
    { title: 'Development charges', category: 'Development', amount: 28000, dueDate: date },
  ];
  const rows = [
    { title: 'Booking / down payment (MTR 20K + 980K + 200K)', category: 'Booking', amount: 1200000, dueDate: '2024-08-01', notes: 'Exact day not recorded — adjust if needed' },
    { title: 'Plot installment', category: 'Plot', amount: 98000, dueDate: '2024-09-07', notes: '28K development pending' },
    { title: 'Development charges (Sep + Oct)', category: 'Development', amount: 56000, dueDate: '2024-10-06' },
    { title: 'Plot installment', category: 'Plot', amount: 42000, dueDate: '2024-10-06' },
    ...both('2024-11-09'), ...both('2024-12-08'),
    ...['2025-01-10', '2025-02-09', '2025-03-08', '2025-04-06', '2025-05-10', '2025-06-10', '2025-07-10', '2025-08-02', '2025-09-13', '2025-10-13', '2025-11-09', '2025-12-07'].flatMap(both),
    ...['2026-01-04', '2026-02-07', '2026-03-09', '2026-04-05', '2026-05-10', '2026-06-07'].flatMap(both),
    { title: 'Plot installment', category: 'Plot', amount: 70000, dueDate: '2026-07-10' },
    { title: 'Plot installment', category: 'Plot', amount: 70000, dueDate: '2026-08-08' },
    { title: 'Allocation & confirmation of R-19 — development', category: 'Allocation', amount: 264000, dueDate: '2025-08-01', status: 'paid', paidDate: '2025-08-01' },
    { title: 'Allocation & confirmation of R-19 — installment', category: 'Allocation', amount: 220000, dueDate: '2025-08-01', status: 'paid', paidDate: '2025-08-01' },
    { title: 'Map, security deposit & demarcation of R-19', category: 'Map & Demarcation', amount: 178000, dueDate: '2026-05-03', status: 'paid', paidDate: '2026-05-03', notes: '25K security deposit is refundable' },
  ];
  return {
    meta: { title: 'GFS Ph-3 Plot R-19', asset: 'Plot R-19', scheme: 'GFS Phase 3', total_price: 2900000, dev_charges: 1080000, notes: 'Plot 70K + Development 28K monthly. Development ends Jun 2026, plot ends Aug 2026. 25K security refundable.' },
    streams: [],
    oneOffs: rows,
  };
};

export const TEMPLATES = [
  {
    id: 'plot-dev',
    name: 'Plot + development charges',
    description: 'Two monthly streams (plot & development) with a booking amount and possession charges.',
    build: () => ({
      meta: { title: 'My Plot', asset: '', scheme: '', total_price: 0, dev_charges: 0 },
      streams: [
        { name: 'Plot installment', category: 'Plot', amount: 70000, frequency: 'monthly', startDate: firstOfNextMonth(), count: 24 },
        { name: 'Development charges', category: 'Development', amount: 28000, frequency: 'monthly', startDate: firstOfNextMonth(), count: 24 },
      ],
      oneOffs: [
        { title: 'Booking / down payment', category: 'Booking', amount: 500000, dueDate: today() },
        { title: 'Possession charges', category: 'Possession', amount: 300000, dueDate: '' },
      ],
    }),
  },
  {
    id: 'monthly-biannual',
    name: 'Monthly + half-yearly',
    description: 'Monthly installments plus larger bi-annual (half-yearly) payments — common for housing schemes.',
    build: () => ({
      meta: { title: 'Housing scheme plan', asset: '', scheme: '' },
      streams: [
        { name: 'Monthly installment', category: 'Plot', amount: 50000, frequency: 'monthly', startDate: firstOfNextMonth(), count: 36 },
        { name: 'Half-yearly installment', category: 'Plot', amount: 250000, frequency: 'half-yearly', startDate: firstOfNextMonth(), count: 6 },
      ],
      oneOffs: [{ title: 'Booking', category: 'Booking', amount: 500000, dueDate: today() }],
    }),
  },
  {
    id: 'simple',
    name: 'Simple monthly plan',
    description: 'One amount, every month, for N months. Good for a car, phone, appliance or committee.',
    build: () => ({
      meta: { title: 'Monthly plan', asset: '', scheme: '' },
      streams: [{ name: 'Installment', category: 'Other', amount: 25000, frequency: 'monthly', startDate: firstOfNextMonth(), count: 12 }],
      oneOffs: [],
    }),
  },
  {
    id: 'gfs-sample',
    name: 'Sample: GFS Ph-3 plot (R-19)',
    description: 'A real-world style plan with irregular dates, allocation fees and map/demarcation charges already filled in.',
    build: gfs,
  },
  {
    id: 'blank',
    name: 'Start from scratch',
    description: 'Empty plan — add streams and one-off payments yourself.',
    build: () => ({ meta: { title: '', asset: '', scheme: '' }, streams: [], oneOffs: [] }),
  },
];

function today() { return new Date().toISOString().slice(0, 10); }
function firstOfNextMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 1);
  return d.toISOString().slice(0, 10);
}

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
}
