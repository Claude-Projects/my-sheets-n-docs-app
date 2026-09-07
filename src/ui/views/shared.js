import { h, replace, icon } from '../../lib/dom.js';
import { fmtDate } from '../../lib/format.js';
import { getRegistry, unlinkSharedFile } from '../../services/workspace.js';
import { openSharedById } from '../../services/sharing.js';
import { pickerAvailable, pickSpreadsheets } from '../../lib/picker.js';
import { KIND, isDemo } from '../../services/client.js';
import { toast, toastError, emptyState } from '../components.js';

export async function render(root, { setTitle, navigate }) {
  setTitle('Shared with me');
  const input = h('input', { type: 'text', placeholder: 'Paste an app link or a Google Sheets link/ID…' });
  const list = h('div');

  const form = h('form', { class: 'card pad mb', onSubmit: async (e) => {
    e.preventDefault();
    const id = extractId(input.value.trim());
    if (!id) return toast('Could not find a file ID in that link', 'error');
    try {
      const { file, kind } = await openSharedById(id);
      toast(`Connected “${file.name}”`, 'success');
      input.value = '';
      go(file.id, kind);
    } catch (err) { toastError(err); }
  } },
    h('h3', { class: 'mb-s' }, 'Open something shared with you'),
    h('p', { class: 'muted mb' }, 'Because this app can only see files it has been given access to, connect a shared workbook once by pasting its link. The sender can copy an app link from the Share dialog, or you can paste the Google Sheets link from the notification email.'),
    h('div', { class: 'inline' }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Connect'),
      pickerAvailable() ? h('button', { class: 'btn', type: 'button', onClick: async () => {
        try {
          const docs = await pickSpreadsheets();
          for (const d of docs) { const { file, kind } = await openSharedById(d.id); toast(`Connected “${file.name}”`, 'success'); if (docs.length === 1) go(file.id, kind); }
          draw();
        } catch (err) { toastError(err); }
      } }, icon('drive'), 'Pick from Drive') : null),
    isDemo() ? h('p', { class: 'help mt-s' }, 'In demo mode there is nobody to share with — sign in with Google to use this.') : null,
  );
  replace(root, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Shared with me'), h('p', { class: 'sub' }, 'Workbooks, ledgers and todo lists other people shared with you.'))), form, list);

  function go(id, kind) {
    if (kind === KIND.plans) navigate(`/plans/${id}`);
    else if (kind === KIND.expenses) navigate('/expenses');
    else navigate('/todos');
  }

  function draw() {
    const linked = getRegistry().linkedFiles;
    if (!linked.length) { replace(list, emptyState({ emoji: '🤝', title: 'Nothing connected yet', text: 'Shared files you connect appear here and in the relevant section.' })); return; }
    replace(list, h('div', { class: 'card' }, h('div', { class: 'list' }, linked.map((f) => h('div', { class: 'list-item' },
      h('span', { style: { fontSize: '22px' } }, '📗'),
      h('div', { class: 'grow' }, h('div', { class: 't' }, f.name), h('div', { class: 's' }, `${f.kind} · from ${f.owner || 'unknown'} · connected ${fmtDate(f.addedAt)}`)),
      h('button', { class: 'btn sm', onClick: () => go(f.id, f.kind) }, 'Open'),
      h('button', { class: 'btn ghost sm', onClick: async () => { await unlinkSharedFile(f.id); draw(); } }, 'Remove'))))));
  }
  draw();
}

export function extractId(text) {
  if (!text) return '';
  const m = /\/d\/([a-zA-Z0-9_-]{10,})/.exec(text) || /#\/open\/([^/?&\s]+)/.exec(text) || /[?&]id=([a-zA-Z0-9_-]{10,})/.exec(text);
  if (m) return decodeURIComponent(m[1]);
  return /^[a-zA-Z0-9_-]{10,}$/.test(text) ? text : '';
}
