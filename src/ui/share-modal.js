import { h, replace, copyText, icon } from '../lib/dom.js';
import { openModal, toast, toastError, loading, select, confirmDialog } from './components.js';
import { listShares, shareWith, changeRole, unshare, appLinkFor } from '../services/sharing.js';
import { fileLink } from '../lib/google-client.js';
import { isDemo } from '../services/client.js';

/**
 * Share dialog for any app spreadsheet. `extraFileIds` (e.g. the attachments
 * folder) receive the same permission so recipients can see screenshots too.
 */
export function openShareModal(file, { extraFileIds = [] } = {}) {
  const list = h('div', null, loading('Loading people…'));
  const email = h('input', { type: 'email', placeholder: 'name@example.com — separate several with commas', multiple: true, required: true });
  const role = select([{ value: 'reader', label: 'Can view' }, { value: 'writer', label: 'Can edit' }], 'writer');
  const message = h('textarea', { placeholder: 'Optional message included in the Google notification email', rows: 2 });
  const link = appLinkFor(file.id);

  const form = h('form', { onSubmit: async (e) => {
    e.preventDefault();
    const emails = email.value.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!emails.length) return;
    try {
      await shareWith(file.id, emails, role.value, { message: message.value, extraFileIds });
      toast(`Shared with ${emails.join(', ')}`, 'success');
      email.value = '';
      await refresh();
    } catch (err) { toastError(err); }
  } },
    h('div', { class: 'form-grid' },
      h('div', { class: 'field span-2' }, h('label', null, 'Invite people by email'), email),
      h('div', { class: 'field' }, h('label', null, 'Permission'), role),
      h('div', { class: 'field' }, h('label', null, ' '), h('button', { class: 'btn primary block', type: 'submit' }, 'Send invite')),
      h('div', { class: 'field span-2' }, h('label', null, 'Message'), message)),
  );

  async function refresh() {
    try {
      const perms = await listShares(file.id);
      replace(list, h('div', { class: 'list card', style: { boxShadow: 'none' } }, perms.map((p) => h('div', { class: 'list-item' },
        h('div', { class: 'avatar' }, (p.displayName || p.emailAddress || '?').slice(0, 1).toUpperCase()),
        h('div', { class: 'grow' }, h('div', { class: 't' }, p.displayName || p.emailAddress || (p.type === 'anyone' ? 'Anyone with the link' : p.type)), h('div', { class: 's' }, p.emailAddress || '')),
        p.role === 'owner'
          ? h('span', { class: 'badge' }, 'Owner')
          : h('div', { class: 'inline' },
            select([{ value: 'reader', label: 'Can view' }, { value: 'writer', label: 'Can edit' }], p.role, { class: 'input', style: { width: 'auto', minHeight: '32px', padding: '4px 8px' }, onChange: async (e) => { try { await changeRole(file.id, p.id, e.target.value); toast('Permission updated', 'success'); } catch (err) { toastError(err); } } }),
            h('button', { class: 'btn ghost icon', title: 'Remove access', onClick: async () => { if (await confirmDialog({ title: 'Remove access?', message: `${p.emailAddress || 'This person'} will no longer see this file.`, confirmText: 'Remove', danger: true })) { try { await unshare(file.id, p.id); await refresh(); } catch (err) { toastError(err); } } } }, icon('close'))),
      ))));
    } catch (e) {
      replace(list, h('div', { class: 'callout warn' }, e.message));
    }
  }
  refresh();

  openModal({
    title: `Share “${file.name}”`,
    subtitle: 'Sharing uses Google Drive permissions — exactly like sharing the Sheet itself.',
    body: h('div', { class: 'grid', style: { gap: '18px' } },
      form,
      h('div', null, h('div', { class: 'label mb-s' }, 'People with access'), list),
      h('div', { class: 'callout info' },
        h('strong', null, 'How recipients open it: '),
        'they sign in to this app and paste the app link below (or the Google Sheet link) under “Shared with me”. Because the app can only see files it has been given, this one step connects it for them.',
        h('div', { class: 'inline mt-s' },
          h('input', { class: 'mono', readonly: true, value: link, onFocus: (e) => e.target.select() }),
          h('button', { class: 'btn sm', onClick: async () => { (await copyText(link)) ? toast('App link copied', 'success') : toast('Copy failed'); } }, icon('copy'), 'Copy app link'),
          isDemo() ? null : h('a', { class: 'btn sm', href: fileLink(file), target: '_blank', rel: 'noopener' }, 'Open in Google Sheets'))),
    ),
  });
}
