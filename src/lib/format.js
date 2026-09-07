import { prefs } from '../state.js';

export function todayISO() {
  return toISODate(new Date());
}

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s).trim());
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function addMonths(date, n) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

export function addDays(date, n) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

export function daysBetween(a, b) {
  const ms = 24 * 3600 * 1000;
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((db - da) / ms);
}

export function fmtDate(iso, opts = {}) {
  const d = parseISODate(iso);
  if (!d) return iso || '—';
  return d.toLocaleDateString(prefs.get().locale || undefined, { day: '2-digit', month: 'short', year: 'numeric', ...opts });
}

export function fmtMonth(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(prefs.get().locale || undefined, { month: 'long', year: 'numeric' });
}

export function toNumber(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Parses "70K", "2.9 Lac", "1.2M", "1,200,000" into a number. */
export function parseAmount(input) {
  if (typeof input === 'number') return input;
  const s = String(input || '').trim().toLowerCase().replace(/,/g, '');
  if (!s) return 0;
  const m = /^(-?\d+(?:\.\d+)?)\s*(k|m|lac|lakh|lacs|cr|crore|crores|b)?$/.exec(s);
  if (!m) return toNumber(s);
  const n = Number(m[1]);
  const mult = { k: 1e3, m: 1e6, lac: 1e5, lakh: 1e5, lacs: 1e5, cr: 1e7, crore: 1e7, crores: 1e7, b: 1e9 }[m[2]] || 1;
  return Math.round(n * mult);
}

export function fmtMoney(n, { compact = false, currency, signed = false } = {}) {
  const p = prefs.get();
  const cur = currency || p.currency || 'PKR';
  const value = toNumber(n);
  if (compact) return fmtCompact(value, cur, p.numberStyle);
  let out;
  try {
    out = new Intl.NumberFormat(p.locale || undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Math.abs(value));
  } catch {
    out = `${cur} ${Math.abs(value).toLocaleString()}`;
  }
  if (value < 0) return `-${out}`;
  return signed && value > 0 ? `+${out}` : out;
}

export function fmtNumber(n) {
  return toNumber(n).toLocaleString(prefs.get().locale || undefined, { maximumFractionDigits: 0 });
}

export function fmtCompact(value, cur, style) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const sym = currencySymbol(cur);
  if (style === 'lac') {
    if (abs >= 1e7) return `${sign}${sym}${trim(abs / 1e7)} Cr`;
    if (abs >= 1e5) return `${sign}${sym}${trim(abs / 1e5)} Lac`;
    if (abs >= 1e3) return `${sign}${sym}${trim(abs / 1e3)}K`;
    return `${sign}${sym}${abs}`;
  }
  if (abs >= 1e9) return `${sign}${sym}${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}${sym}${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}${sym}${trim(abs / 1e3)}K`;
  return `${sign}${sym}${abs}`;
}

function trim(n) {
  return Number(n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)).toString();
}

export function currencySymbol(cur) {
  try {
    const parts = new Intl.NumberFormat(prefs.get().locale || undefined, { style: 'currency', currency: cur }).formatToParts(1);
    const sym = parts.find((x) => x.type === 'currency')?.value || cur;
    if (sym.length > 3) return `${cur} `;
    return /[A-Za-z]$/.test(sym) ? `${sym} ` : sym;
  } catch {
    return `${cur} `;
  }
}

export function pct(part, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((toNumber(part) / toNumber(total)) * 100)));
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function sanitizeSheetTitle(title) {
  return String(title || 'Sheet').replace(/[\[\]*?:/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Sheet';
}

export function safeFileName(name) {
  return String(name || 'file').replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 120) || 'file';
}

export function relativeDue(iso) {
  const d = parseISODate(iso);
  if (!d) return '';
  const diff = daysBetween(new Date(), d);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff < 0) return `${-diff} days ago`;
  return `in ${diff} days`;
}
