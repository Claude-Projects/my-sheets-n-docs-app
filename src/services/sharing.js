// Sharing = Google Drive permissions. Nothing is stored outside Drive.

import { client, PROPS, KIND } from './client.js';
import { MIME } from '../lib/google-client.js';
import { linkSharedFile } from './workspace.js';

export function appLinkFor(fileId) {
  const base = `${location.origin}${location.pathname}`.replace(/index\.html$/, '');
  return `${base}#/open/${encodeURIComponent(fileId)}`;
}

export async function listShares(fileId) {
  const perms = await client().listPermissions(fileId);
  return perms.filter((p) => p.type === 'user' || p.type === 'group' || p.type === 'anyone');
}

export async function shareWith(fileId, emails, role, { message = '', extraFileIds = [] } = {}) {
  const results = [];
  for (const email of emails) {
    const e = email.trim();
    if (!e) continue;
    results.push(await client().createPermission(fileId, { emailAddress: e, role, sendNotificationEmail: true, message }));
    for (const extra of extraFileIds) {
      try { await client().createPermission(extra, { emailAddress: e, role, sendNotificationEmail: false }); } catch { /* best effort */ }
    }
  }
  return results;
}

export async function changeRole(fileId, permissionId, role) {
  return client().updatePermission(fileId, permissionId, role);
}

export async function unshare(fileId, permissionId) {
  return client().deletePermission(fileId, permissionId);
}

/** Opens a spreadsheet someone shared, verifies it belongs to this app, and remembers it. */
export async function openSharedById(fileId) {
  const file = await client().getFile(fileId);
  if (file.mimeType !== MIME.spreadsheet) throw new Error('That link does not point to a spreadsheet.');
  const kind = file.appProperties?.[PROPS.kind];
  if (![KIND.plans, KIND.expenses, KIND.todos].includes(kind)) throw new Error('This spreadsheet was not created by this app.');
  if (!file.ownedByMe) await linkSharedFile(file, kind);
  return { file, kind };
}
