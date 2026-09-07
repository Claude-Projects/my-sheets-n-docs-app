// Hash-based router (works on GitHub Pages without server rewrites).

const routes = [];
let current = null;
let onChange = null;

export function route(pattern, handler) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ re, keys, handler });
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (replace) history.replaceState(null, '', target);
  else location.hash = target;
  if (replace) dispatch();
}

export function currentPath() {
  const hash = location.hash.replace(/^#/, '') || '/';
  return hash.startsWith('/') ? hash : `/${hash}`;
}

export function dispatch() {
  const full = currentPath();
  const [path, queryString] = full.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString || ''));
  for (const r of routes) {
    const m = r.re.exec(path);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    current = { path, params, query };
    onChange?.(current, r.handler);
    return;
  }
  current = { path, params: {}, query };
  onChange?.(current, null);
}

export function startRouter(handler) {
  onChange = handler;
  window.addEventListener('hashchange', dispatch);
  dispatch();
}

export function getCurrent() { return current; }
