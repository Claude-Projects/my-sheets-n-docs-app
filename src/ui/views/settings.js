import { h, replace } from '../../lib/dom.js';
import { prefs, session, workspace, config } from '../../state.js';
import { getRegistry, updateRegistry, FOLDERS } from '../../services/workspace.js';
import { fileLink } from '../../lib/google-client.js';
import { isDemo } from '../../services/client.js';
import { auth } from '../../lib/auth.js';
import { field, select, toast, toastError, openModal } from '../components.js';

const CURRENCIES = ['PKR', 'INR', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'CAD', 'AUD', 'BDT', 'MYR', 'TRY'];

export async function render(root, { setTitle }) {
  setTitle('Settings');
  const p = prefs.get();
  const s = session.get();
  const ws = workspace.get();

  const currency = select(CURRENCIES.map((c) => ({ value: c, label: c })), p.currency, { onChange: (e) => prefs.set({ currency: e.target.value }) });
  const locale = h('input', { type: 'text', value: p.locale, placeholder: 'en-PK', onChange: (e) => prefs.set({ locale: e.target.value.trim() || 'en-PK' }) });
  const style = select([{ value: 'lac', label: 'Lac / Crore (29 Lac)' }, { value: 'intl', label: 'International (2.9M)' }], p.numberStyle, { onChange: (e) => prefs.set({ numberStyle: e.target.value }) });
  const theme = select([{ value: 'auto', label: 'Follow system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], p.theme, { onChange: (e) => prefs.set({ theme: e.target.value }) });
  const dueSoon = h('input', { type: 'number', min: 0, max: 60, value: String(p.dueSoonDays), onChange: (e) => prefs.set({ dueSoonDays: Math.max(0, Number(e.target.value) || 0) }) });

  const reg = getRegistry();
  const cats = h('textarea', { rows: 6 }, reg.installmentCategories.join('\n'));

  replace(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Settings'), h('p', { class: 'sub' }, 'Display preferences are saved in this browser; categories are saved to workspace.json in your Drive.'))),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'card pad grid', style: { gap: '14px' } },
        h('h3', null, 'Display'),
        field('Currency', currency), field('Locale (number & date format)', locale, 'e.g. en-PK, en-IN, en-US, ur-PK'), field('Large numbers', style), field('Theme', theme), field('“Due soon” window (days)', dueSoon)),
      h('div', { class: 'card pad grid', style: { gap: '14px' } },
        h('h3', null, 'Installment categories'),
        h('p', { class: 'help' }, 'One per line. Used in the plan wizard and row editor.'),
        cats,
        h('button', { class: 'btn primary', onClick: async () => { try { await updateRegistry({ installmentCategories: [...new Set(cats.value.split('\n').map((x) => x.trim()).filter(Boolean))] }); toast('Saved', 'success'); } catch (e) { toastError(e); } } }, 'Save categories')),
      h('div', { class: 'card pad grid', style: { gap: '10px' } },
        h('h3', null, 'Account & storage'),
        h('p', null, h('strong', null, s.user?.name), h('br'), h('span', { class: 'muted' }, s.user?.email)),
        h('p', { class: 'muted' }, `Mode: ${s.mode === 'demo' ? 'Demo (browser storage only)' : 'Google Drive'}`),
        ws.root ? h('p', null, 'Root folder: ', isDemo() ? h('code', null, ws.root.name) : h('a', { href: fileLink(ws.root), target: '_blank', rel: 'noopener' }, ws.root.name, ' ↗')) : null,
        h('ul', { class: 'muted', style: { margin: 0, paddingLeft: '18px', fontSize: '13px' } }, Object.values(FOLDERS).map((f) => h('li', null, f))),
        s.mode === 'google' ? h('button', { class: 'btn', onClick: async () => { try { await auth.requestToken({ prompt: 'consent' }); toast('Permissions refreshed', 'success'); } catch (e) { toastError(e); } } }, 'Re-authorise Google access') : null),
      h('div', { class: 'card pad grid', style: { gap: '10px' } },
        h('h3', null, 'Deployment'),
        h('p', { class: 'muted', style: { fontSize: '13px' } }, `App: ${config.appName} · Google sign-in ${auth.isConfigured ? 'configured' : 'not configured'} · Picker ${config.googleApiKey ? 'enabled' : 'disabled'}`),
        h('p', { class: 'muted', style: { fontSize: '13px' } }, 'This site has no server. All data is read and written directly between your browser and Google APIs using the ', h('code', null, 'drive.file'), ' scope.'),
        h('div', { class: 'inline' },
          h('a', { class: 'btn sm', href: 'https://github.com/Claude-Projects/my-sheets-n-docs-app/blob/main/docs/SETUP.md', target: '_blank', rel: 'noopener' }, 'Setup guide'),
          h('a', { class: 'btn sm', href: 'https://github.com/Claude-Projects/my-sheets-n-docs-app/blob/main/SECURITY.md', target: '_blank', rel: 'noopener' }, 'Security notes'),
          h('button', { class: 'btn sm', onClick: showDiagnostics }, 'Diagnostics'))),
    ),
  );

  function showDiagnostics() {
    const info = { origin: location.origin, path: location.pathname, mode: s.mode, hasToken: auth.hasValidToken(), rootFolderId: ws.root?.id, folders: ws.folders, prefs: prefs.get(), userAgent: navigator.userAgent };
    openModal({ title: 'Diagnostics', body: h('pre', { class: 'mono', style: { whiteSpace: 'pre-wrap' } }, JSON.stringify(info, null, 2)) });
  }
}
