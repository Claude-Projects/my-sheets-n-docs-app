import { h, icon } from '../../lib/dom.js';
import { config } from '../../state.js';
import { auth } from '../../lib/auth.js';

export function render(root, { signIn, startDemo, state }) {
  const configured = auth.isConfigured;
  const busy = state.status === 'signing-in';
  const isPages = /github\.io$/.test(location.hostname);

  const googleBtn = h('button', { class: 'btn google block', disabled: busy || !configured, onClick: signIn },
    busy ? h('span', { class: 'spinner' }) : h('span', { html: GOOGLE_G, 'aria-hidden': 'true', style: { display: 'inline-flex' } }),
    busy ? 'Connecting to Google…' : 'Continue with Google');

  root.append(h('div', { class: 'login' },
    h('section', { class: 'hero' },
      h('div', { class: 'brand' }, h('div', { class: 'brand-logo' }, 'L'), h('div', null, h('div', { class: 'brand-name' }, config.appName))),
      h('h1', null, 'Heavy-duty sheets, docs & slides — ', h('span', { style: { color: 'var(--primary-600)' } }, 'without the spreadsheet grind.')),
      h('p', { class: 'lead' }, 'Build complete installment plans in a few clicks, track expenses by year, month and day, keep your todos — all saved as real Google Sheets, Docs and Slides inside your own Google Drive. No servers, no passwords, nothing stored on this site.'),
      h('div', { class: 'features' },
        feature('Installment plans', 'Plot, development, possession, bi-annual… generate the whole schedule, tick payments off, bulk-edit, attach screenshots.'),
        feature('Expenses by period', 'Log daily spending; see it grouped by year → month → day with category breakdowns.'),
        feature('Docs & Slides studio', 'One-click payment statements and presentation decks generated from your data.'),
        feature('Private by default, share when you want', 'Everything is a file in your Drive. Share a plan by email exactly like any Google Sheet.'),
      ),
    ),
    h('section', { class: 'panel' },
      h('div', { class: 'card' },
        h('h2', null, 'Sign in'),
        h('p', { class: 'muted' }, 'Sign in with the Google account whose Drive should hold your files.'),
        googleBtn,
        state.error ? h('div', { class: 'callout danger' }, state.error) : null,
        !configured ? setupNotice(isPages) : null,
        h('div', { class: 'inline', style: { justifyContent: 'center' } }, h('span', { class: 'faint' }, 'or')),
        h('button', { class: 'btn block', disabled: busy, onClick: startDemo }, '🧪 Try the demo (no account needed)'),
        h('p', { class: 'trust' },
          icon('lock'), ' This app only asks for the ', h('code', null, 'drive.file'), ' permission: it can see and edit only the files it creates for you — never the rest of your Drive. Tokens stay in your browser tab and are sent only to Google. ',
          h('a', { href: 'https://github.com/Claude-Projects/my-sheets-n-docs-app/blob/main/SECURITY.md', target: '_blank', rel: 'noopener' }, 'Read the security notes'), '.'),
      ),
    ),
  ));
}

function feature(title, text) {
  return h('div', { class: 'feature' }, h('strong', null, title), h('span', null, text));
}

function setupNotice(isPages) {
  return h('div', { class: 'callout warn' },
    h('strong', null, 'Google sign-in is not configured yet.'),
    h('p', { class: 'mt-s' }, 'The site owner needs to create a free OAuth Client ID in Google Cloud and paste it into ', h('code', null, 'config.js'), '. It takes about five minutes — see ',
      h('a', { href: 'https://github.com/Claude-Projects/my-sheets-n-docs-app/blob/main/docs/SETUP.md', target: '_blank', rel: 'noopener' }, 'docs/SETUP.md'), '.'),
    isPages ? null : h('p', { class: 'mt-s faint' }, 'Tip: the demo works fully offline while you set that up.'),
  );
}

const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.1 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6C12.3 13.2 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.8A14.5 14.5 0 0 1 9.5 24c0-1.7.3-3.3.8-4.8l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.7-3.7-13.6-9l-7.8 6C6.5 42.6 14.6 48 24 48z"/></svg>';
