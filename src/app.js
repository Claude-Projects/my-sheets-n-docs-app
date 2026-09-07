import { h, clear, replace } from './lib/dom.js';
import { session, workspace, bus, config } from './state.js';
import { auth } from './lib/auth.js';
import { GoogleClient } from './lib/google-client.js';
import { MockClient } from './lib/mock-client.js';
import { setClient, client } from './services/client.js';
import { initWorkspace } from './services/workspace.js';
import { seedDemo } from './services/demo.js';
import { route, startRouter, navigate, currentPath } from './router.js';
import { toast, toastError } from './ui/components.js';
import { renderShell, setTitle, setBusy } from './ui/layout.js';
import * as Login from './ui/views/login.js';
import * as Dashboard from './ui/views/dashboard.js';
import * as Plans from './ui/views/plans.js';
import * as Plan from './ui/views/plan.js';
import * as Expenses from './ui/views/expenses.js';
import * as Todos from './ui/views/todos.js';
import * as Studio from './ui/views/studio.js';
import * as Shared from './ui/views/shared.js';
import * as Settings from './ui/views/settings.js';
import * as Open from './ui/views/open.js';

const MODE_KEY = 'ledgerdrive.mode';
const app = document.getElementById('app');
let pendingPath = null;
let cleanup = null;

route('/', Dashboard);
route('/plans', Plans);
route('/plans/:workbookId', Plan);
route('/plans/:workbookId/:planId', Plan);
route('/expenses', Expenses);
route('/todos', Todos);
route('/studio', Studio);
route('/shared', Shared);
route('/settings', Settings);
route('/open/:fileId', Open);
route('/demo-file/:fileId', Open);

async function boot() {
  document.title = `${config.appName} — Sheets, Docs & Slides powered by your Google Drive`;
  const mode = localStorage.getItem(MODE_KEY);
  try {
    if (mode === 'demo') return await startDemo();
    if (mode === 'google' && auth.isConfigured && auth.hasValidToken()) return await startGoogle();
  } catch (e) {
    console.warn('Resume failed', e);
  }
  session.set({ status: 'signed-out', mode: null, user: null });
}

export async function startGoogle() {
  session.set({ status: 'signing-in', error: null });
  setClient(new GoogleClient());
  const user = await auth.fetchUserInfo();
  await initWorkspace();
  localStorage.setItem(MODE_KEY, 'google');
  session.set({ status: 'ready', mode: 'google', user, error: null });
}

export async function startDemo() {
  session.set({ status: 'signing-in', error: null });
  const mock = new MockClient();
  setClient(mock);
  const fresh = Object.keys(mock.db.files).length === 0;
  await initWorkspace();
  if (fresh) {
    try { await seedDemo(); } catch (e) { console.warn('seed failed', e); }
  }
  localStorage.setItem(MODE_KEY, 'demo');
  session.set({ status: 'ready', mode: 'demo', user: { name: 'Demo User', email: 'demo@example.com', picture: '' }, error: null });
}

export async function signIn() {
  try {
    session.set({ status: 'signing-in', error: null });
    await auth.signIn();
    await startGoogle();
    if (pendingPath) { const p = pendingPath; pendingPath = null; navigate(p, { replace: true }); }
  } catch (e) {
    session.set({ status: 'signed-out', error: e.message });
  }
}

export async function signOut() {
  const mode = session.get().mode;
  localStorage.removeItem(MODE_KEY);
  if (mode === 'google') await auth.signOut();
  workspace.set({ ready: false, root: null, folders: {}, registry: null });
  session.set({ status: 'signed-out', mode: null, user: null, error: null });
  navigate('/', { replace: true });
}

export function resetDemo() {
  const c = client();
  if (c.kind === 'demo') { c.reset(); localStorage.removeItem(MODE_KEY); location.hash = '#/'; location.reload(); }
}

bus.on('auth:expired', () => {
  toast('Your Google session expired — please sign in again.', 'error', 5000);
  pendingPath = currentPath();
  localStorage.removeItem(MODE_KEY);
  session.set({ status: 'signed-out', mode: null, user: null, error: null });
});

function renderRoot(state) {
  if (state.status === 'boot') return;
  if (state.status !== 'ready') {
    cleanup?.(); cleanup = null;
    if (currentPath().startsWith('/open/')) pendingPath = currentPath();
    clear(app);
    Login.render(app, { signIn, startDemo, state });
    return;
  }
  if (!app.querySelector('.shell')) {
    clear(app);
    renderShell(app, { signOut, resetDemo });
    startRouter(onRoute);
  }
}

async function onRoute(current, view) {
  if (session.get().status !== 'ready') return;
  const container = document.getElementById('view');
  if (!container) return;
  cleanup?.(); cleanup = null;
  window.scrollTo({ top: 0 });
  replace(container, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'Loading…'));
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${current.path}` || (current.path.startsWith('/plans') && a.getAttribute('href') === '#/plans')));
  if (!view) { navigate('/', { replace: true }); return; }
  try {
    setBusy(true);
    const result = await view.render(container, { ...current, setTitle, navigate });
    if (typeof result === 'function') cleanup = result;
  } catch (e) {
    toastError(e);
    replace(container, h('div', { class: 'card empty' }, h('div', { class: 'big' }, '⚠'), h('h3', null, 'Something went wrong'), h('p', null, e.message), h('div', { class: 'mt' }, h('button', { class: 'btn', onClick: () => onRoute(current, view) }, 'Retry'))));
  } finally {
    setBusy(false);
  }
}

session.subscribe(renderRoot);
boot();
