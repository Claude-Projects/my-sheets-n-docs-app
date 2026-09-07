import { h, icon } from '../lib/dom.js';
import { session, prefs, config } from '../state.js';
import { dropdown } from './components.js';

let titleEl = null;
let busyEl = null;

export function setTitle(text) {
  if (titleEl) titleEl.textContent = text;
  document.title = text ? `${text} · ${config.appName}` : config.appName;
}

export function setBusy(on) {
  if (busyEl) busyEl.hidden = !on;
}

const NAV = [
  { href: '#/', label: 'Dashboard', icon: 'home' },
  { section: 'Manage' },
  { href: '#/plans', label: 'Installment plans', icon: 'plans' },
  { href: '#/expenses', label: 'Expenses', icon: 'expenses' },
  { href: '#/todos', label: 'Todos', icon: 'todos' },
  { section: 'Create & share' },
  { href: '#/studio', label: 'Docs & Slides studio', icon: 'studio' },
  { href: '#/shared', label: 'Shared with me', icon: 'share' },
  { section: 'Account' },
  { href: '#/settings', label: 'Settings', icon: 'settings' },
];

export function renderShell(root, { signOut, resetDemo }) {
  const s = session.get();
  const user = s.user || {};
  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' }, h('div', { class: 'brand-logo' }, 'L'), h('div', null, h('div', { class: 'brand-name' }, config.appName), h('div', { class: 'brand-tag' }, 'Your data, your Google Drive'))),
    h('nav', { class: 'nav' }, NAV.map((n) => n.section
      ? h('div', { class: 'nav-section' }, n.section)
      : h('a', { href: n.href, onClick: () => sidebar.classList.remove('open') }, icon(n.icon), n.label))),
    h('div', { class: 'sidebar-footer' },
      dropdown(
        h('button', { class: 'user-chip btn ghost block', style: { justifyContent: 'flex-start' } },
          user.picture ? h('img', { src: user.picture, alt: '', referrerpolicy: 'no-referrer' }) : h('div', { class: 'avatar' }, (user.name || '?').slice(0, 1).toUpperCase()),
          h('div', { style: { textAlign: 'left', minWidth: 0 } }, h('div', { class: 'name truncate' }, user.name || 'Signed in'), h('div', { class: 'email' }, user.email || ''))),
        [
          { label: 'Settings', icon: 'settings', onClick: () => { location.hash = '#/settings'; } },
          s.mode === 'demo' ? { label: 'Reset demo data', icon: 'refresh', onClick: resetDemo } : null,
          'sep',
          { label: s.mode === 'demo' ? 'Exit demo' : 'Sign out', icon: 'logout', danger: true, onClick: signOut },
        ],
      ),
    ),
  );

  titleEl = h('div', { class: 'title' }, 'Dashboard');
  busyEl = h('span', { class: 'spinner', hidden: true, title: 'Syncing with Google Drive' });
  const themeBtn = h('button', { class: 'btn ghost icon', title: 'Toggle theme', onClick: () => {
    const cur = prefs.get().theme;
    const isDark = cur === 'dark' || (cur === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    prefs.set({ theme: isDark ? 'light' : 'dark' });
  } }, icon('moon'));
  const backdrop = h('div', { class: 'backdrop', hidden: true, onClick: () => { sidebar.classList.remove('open'); backdrop.hidden = true; } });
  const menuBtn = h('button', { class: 'btn ghost icon menu-btn', 'aria-label': 'Menu', onClick: () => { sidebar.classList.toggle('open'); backdrop.hidden = !sidebar.classList.contains('open'); } }, icon('menu'));
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) backdrop.hidden = true; });

  const main = h('main', { class: 'main' },
    s.mode === 'demo' ? h('div', { class: 'demo-banner' }, h('span', null, '🧪 Demo mode — data is stored only in this browser. Sign in with Google to use your real Drive.'), h('button', { class: 'btn xs', onClick: signOut }, 'Exit demo')) : null,
    h('header', { class: 'topbar' }, menuBtn, titleEl, busyEl, themeBtn),
    h('div', { class: 'content', id: 'view' }),
  );
  root.append(h('div', { class: 'shell' }, sidebar, main), backdrop);
}
