// Tiny DOM helpers. All user-provided strings become text nodes, never HTML.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'html') el.innerHTML = value; // only used with trusted, static markup
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
  } else if (attrs !== undefined && attrs !== null) {
    children.unshift(attrs);
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replace(el, ...children) {
  clear(el);
  return append(el, children);
}

export function frag(...children) {
  return append(document.createDocumentFragment(), children);
}

export function on(el, event, selector, handler) {
  el.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && el.contains(target)) handler(e, target);
  });
}

export function icon(name) {
  const span = h('span', { class: 'icon', 'aria-hidden': 'true' });
  span.textContent = ICONS[name] || name;
  return span;
}

const ICONS = {
  home: '⌂', plans: '▦', expenses: '◔', todos: '☑', studio: '✎', share: '⇪', settings: '⚙', archive: '▣',
  plus: '+', trash: '🗑', edit: '✎', check: '✓', close: '✕', back: '←', more: '⋯', link: '⛓', upload: '⬆', doc: '📄',
  slides: '📊', sheet: '📗', folder: '📁', paperclip: '📎', search: '🔍', calendar: '📅', warn: '⚠', star: '★', menu: '☰',
  sun: '☀', moon: '☾', logout: '⎋', refresh: '↻', download: '⬇', copy: '⧉', drive: '△', lock: '🔒', mail: '✉',
};

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
