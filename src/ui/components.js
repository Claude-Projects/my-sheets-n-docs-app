import { h, clear, icon, append } from '../lib/dom.js';
import { fmtMoney } from '../lib/format.js';

// ---------- Toasts ----------
export function toast(message, type = 'info', ms = 3200) {
  const host = document.getElementById('toasts');
  const el = h('div', { class: `toast ${type}`, role: 'status' }, message);
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, ms);
  return el;
}

export function toastError(err) {
  console.error(err);
  toast(err?.message || String(err), 'error', 6000);
}

// ---------- Modals ----------
/**
 * openModal({title, body, footer, size, onClose}) → { close, el }
 */
export function openModal({ title, subtitle, body, footer, size = '', onClose, closable = true }) {
  const host = document.getElementById('modals');
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.(result);
  };
  const onKey = (e) => { if (e.key === 'Escape' && closable) close(); };
  const modal = h('div', { class: `modal ${size}`, role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-head' },
      h('div', null, h('h2', null, title), subtitle ? h('p', { class: 'muted', style: { marginTop: '4px', fontSize: '13px' } }, subtitle) : null),
      closable ? h('button', { class: 'btn ghost icon', 'aria-label': 'Close', onClick: () => close() }, icon('close')) : null),
    h('div', { class: 'modal-body' }, body),
    footer ? h('div', { class: 'modal-foot' }, footer) : null,
  );
  const backdrop = h('div', { class: 'modal-backdrop', onClick: (e) => { if (e.target === backdrop && closable) close(); } }, modal);
  host.appendChild(backdrop);
  document.addEventListener('keydown', onKey);
  setTimeout(() => modal.querySelector('input,select,textarea,button:not(.ghost)')?.focus(), 30);
  return { close, el: modal, setFooter(nodes) { const f = modal.querySelector('.modal-foot'); if (f) { clear(f); append(f, [nodes]); } } };
}

export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false, extra = null }) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      size: 'narrow',
      body: h('div', null, h('p', null, message), extra),
      footer: [
        h('button', { class: 'btn', onClick: () => m.close(false) }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onClick: () => m.close(true) }, confirmText),
      ],
      onClose: (r) => resolve(Boolean(r)),
    });
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', confirmText = 'Save', type = 'text' }) {
  return new Promise((resolve) => {
    const input = h('input', { type, value, placeholder });
    const form = h('form', { onSubmit: (e) => { e.preventDefault(); m.close(input.value.trim()); } }, h('div', { class: 'field' }, h('label', null, label), input));
    const m = openModal({
      title, size: 'narrow', body: form,
      footer: [h('button', { class: 'btn', onClick: () => m.close(null) }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => m.close(input.value.trim()) }, confirmText)],
      onClose: (r) => resolve(r ?? null),
    });
  });
}

// ---------- Dropdown ----------
export function dropdown(trigger, items) {
  const wrap = h('div', { class: 'dropdown' }, trigger);
  let menu = null;
  const closeMenu = () => { menu?.remove(); menu = null; document.removeEventListener('click', onDoc); };
  const onDoc = (e) => { if (!wrap.contains(e.target)) closeMenu(); };
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu) return closeMenu();
    menu = h('div', { class: 'dropdown-menu', onClick: (ev) => ev.stopPropagation() }, items.filter(Boolean).map((it) => it === 'sep'
      ? h('hr')
      : h('button', { class: it.danger ? 'danger' : '', onClick: (ev) => { ev.stopPropagation(); closeMenu(); it.onClick(); } }, it.icon ? icon(it.icon) : null, it.label)));
    wrap.appendChild(menu);
    setTimeout(() => document.addEventListener('click', onDoc), 0);
  });
  return wrap;
}

// ---------- Small building blocks ----------
export function badge(status, text) {
  return h('span', { class: `badge ${status}` }, text || status.replace('-', ' '));
}

export function stat({ label, value, hint, tone = '' }) {
  return h('div', { class: `card stat ${tone}` }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), hint ? h('div', { class: 'hint' }, hint) : null);
}

export function emptyState({ emoji = '📭', title, text, action }) {
  return h('div', { class: 'card empty' }, h('div', { class: 'big' }, emoji), h('h3', null, title), h('p', null, text), action ? h('div', { class: 'mt' }, action) : null);
}

export function loading(text = 'Loading…') {
  return h('div', { class: 'loading' }, h('span', { class: 'spinner' }), text);
}

export function progress(part, total) {
  const p = total ? Math.min(100, Math.round((part / total) * 100)) : 0;
  return h('div', { class: 'progress', title: `${p}%` }, h('span', { style: { width: `${p}%` } }));
}

export function field(label, control, help) {
  return h('div', { class: 'field' }, h('label', null, label), control, help ? h('div', { class: 'help' }, help) : null);
}

export function select(options, value, attrs = {}) {
  const sel = h('select', attrs, options.map((o) => {
    const opt = typeof o === 'string' ? { value: o, label: o } : o;
    return h('option', { value: opt.value, selected: opt.value === value }, opt.label);
  }));
  return sel;
}

export function money(n, opts) {
  return h('span', { class: 'nowrap' }, fmtMoney(n, opts));
}

export function busyButton(btn, fn) {
  return async (...args) => {
    const original = btn.textContent;
    btn.disabled = true;
    const spinner = h('span', { class: 'spinner', style: { width: '14px', height: '14px' } });
    btn.prepend(spinner);
    try { return await fn(...args); } finally { spinner.remove(); btn.disabled = false; btn.textContent = original; }
  };
}

export function segmented(options, value, onChange) {
  const seg = h('div', { class: 'seg' });
  const render = (current) => {
    clear(seg);
    for (const o of options) {
      seg.appendChild(h('button', { type: 'button', class: o.value === current ? 'active' : '', onClick: () => { render(o.value); onChange(o.value); } }, o.label));
    }
  };
  render(value);
  return seg;
}

export function lightbox(url, name) {
  const lb = h('div', { class: 'lightbox', onClick: () => lb.remove() }, h('img', { src: url, alt: name || 'attachment' }));
  document.body.appendChild(lb);
}
