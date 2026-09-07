// Thin REST client for Drive v3, Sheets v4, Docs v1 and Slides v1.
// All calls go straight from the browser to googleapis.com with the user's token.

import { auth } from './auth.js';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4';
const DOCS = 'https://docs.googleapis.com/v1';
const SLIDES = 'https://slides.googleapis.com/v1';

export const MIME = {
  folder: 'application/vnd.google-apps.folder',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  document: 'application/vnd.google-apps.document',
  presentation: 'application/vnd.google-apps.presentation',
  json: 'application/json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export const FILE_FIELDS = 'id,name,mimeType,modifiedTime,createdTime,appProperties,parents,webViewLink,iconLink,thumbnailLink,owners(displayName,emailAddress,photoLink),shared,ownedByMe,size,trashed,capabilities(canEdit,canShare)';

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function request(url, { method = 'GET', body, headers = {}, raw = false, retry = 0 } = {}) {
  let token = auth.getAccessToken();
  if (!token) token = await auth.refresh();
  const init = { method, headers: { Authorization: `Bearer ${token}`, ...headers } };
  if (body !== undefined) {
    if (body instanceof Blob) init.body = body;
    else { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  }
  const res = await fetch(url, init);
  if (res.status === 401 && retry === 0) {
    await auth.refresh();
    return request(url, { method, body, headers, raw, retry: 1 });
  }
  if ((res.status === 429 || res.status >= 500 || (res.status === 403 && await looksLikeRateLimit(res.clone()))) && retry < 4) {
    await sleep(600 * 2 ** retry + Math.random() * 300);
    return request(url, { method, body, headers, raw, retry: retry + 1 });
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    let payload = null;
    try { payload = await res.json(); msg = payload?.error?.message || payload?.error_description || msg; } catch { /* not json */ }
    throw new ApiError(friendly(msg, res.status), res.status, payload);
  }
  if (raw) return res;
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function looksLikeRateLimit(res) {
  try {
    const j = await res.json();
    const reason = j?.error?.errors?.[0]?.reason || j?.error?.status || '';
    return /rateLimit|userRateLimit|quotaExceeded|RESOURCE_EXHAUSTED/i.test(reason);
  } catch { return false; }
}

function friendly(msg, status) {
  if (status === 403 && /insufficient|scope/i.test(msg)) return 'Google denied access: this app only has permission for files it created. If someone shared a file with you, open it via its link or the Drive picker first.';
  if (status === 404) return 'That file no longer exists or was not shared with you (or with this app).';
  return msg;
}

function q(parts) { return parts.filter(Boolean).join(' and '); }
function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

export function a1(sheetTitle, range) {
  const t = `'${String(sheetTitle).replace(/'/g, "''")}'`;
  return range ? `${t}!${range}` : t;
}

export class GoogleClient {
  constructor() { this.kind = 'google'; }

  // ---------- Drive ----------
  async listFiles({ parents, mimeType, appProperties, trashed = false, nameEquals, nameContains, orderBy = 'modifiedTime desc', pageSize = 200, sharedWithMe } = {}) {
    const parts = [
      trashed === null ? null : `trashed = ${trashed ? 'true' : 'false'}`,
      parents ? `'${esc(parents)}' in parents` : null,
      mimeType ? `mimeType = '${esc(mimeType)}'` : null,
      nameEquals ? `name = '${esc(nameEquals)}'` : null,
      nameContains ? `name contains '${esc(nameContains)}'` : null,
      sharedWithMe ? 'sharedWithMe = true' : null,
      ...Object.entries(appProperties || {}).map(([k, v]) => `appProperties has { key='${esc(k)}' and value='${esc(v)}' }`),
    ];
    const files = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ q: q(parts), fields: `nextPageToken,files(${FILE_FIELDS})`, pageSize: String(Math.min(pageSize, 1000)), orderBy, spaces: 'drive' });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await request(`${DRIVE}/files?${params}`);
      files.push(...(data.files || []));
      pageToken = data.nextPageToken || '';
    } while (pageToken && files.length < pageSize);
    return files;
  }

  getFile(id, fields = FILE_FIELDS) {
    return request(`${DRIVE}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`);
  }

  createFolder(name, parentId, appProperties = {}) {
    return this.createFile({ name, mimeType: MIME.folder, parentId, appProperties });
  }

  createFile({ name, mimeType, parentId, appProperties = {} }) {
    const meta = { name, mimeType, appProperties };
    if (parentId) meta.parents = [parentId];
    return request(`${DRIVE}/files?fields=${encodeURIComponent(FILE_FIELDS)}`, { method: 'POST', body: meta });
  }

  async uploadFile({ name, blob, parentId, appProperties = {}, fileId }) {
    const meta = { name, appProperties };
    if (parentId && !fileId) meta.parents = [parentId];
    const boundary = `ld_${Math.random().toString(36).slice(2)}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ]);
    const url = fileId
      ? `${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=${encodeURIComponent(FILE_FIELDS)}`
      : `${UPLOAD}/files?uploadType=multipart&fields=${encodeURIComponent(FILE_FIELDS)}`;
    return request(url, { method: fileId ? 'PATCH' : 'POST', body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } });
  }

  async downloadFile(id) {
    const res = await request(`${DRIVE}/files/${encodeURIComponent(id)}?alt=media`, { raw: true });
    return res.blob();
  }

  async downloadJson(id) {
    const blob = await this.downloadFile(id);
    return JSON.parse(await blob.text());
  }

  updateFile(id, metadata = {}, { addParents, removeParents } = {}) {
    const params = new URLSearchParams({ fields: FILE_FIELDS, supportsAllDrives: 'true' });
    if (addParents) params.set('addParents', addParents);
    if (removeParents) params.set('removeParents', removeParents);
    return request(`${DRIVE}/files/${encodeURIComponent(id)}?${params}`, { method: 'PATCH', body: metadata });
  }

  trashFile(id) { return this.updateFile(id, { trashed: true }); }
  untrashFile(id) { return this.updateFile(id, { trashed: false }); }
  deleteFile(id) { return request(`${DRIVE}/files/${encodeURIComponent(id)}?supportsAllDrives=true`, { method: 'DELETE' }); }

  async exportFile(id, mimeType) {
    const res = await request(`${DRIVE}/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(mimeType)}`, { raw: true });
    return res.blob();
  }

  async listPermissions(id) {
    const data = await request(`${DRIVE}/files/${encodeURIComponent(id)}/permissions?fields=permissions(id,type,role,emailAddress,displayName,photoLink,pendingOwner)&supportsAllDrives=true`);
    return data.permissions || [];
  }

  createPermission(id, { emailAddress, role = 'reader', sendNotificationEmail = true, message = '' }) {
    const params = new URLSearchParams({ sendNotificationEmail: String(sendNotificationEmail), supportsAllDrives: 'true', fields: 'id,type,role,emailAddress,displayName' });
    if (message && sendNotificationEmail) params.set('emailMessage', message);
    return request(`${DRIVE}/files/${encodeURIComponent(id)}/permissions?${params}`, { method: 'POST', body: { type: 'user', role, emailAddress } });
  }

  updatePermission(id, permissionId, role) {
    return request(`${DRIVE}/files/${encodeURIComponent(id)}/permissions/${encodeURIComponent(permissionId)}?supportsAllDrives=true`, { method: 'PATCH', body: { role } });
  }

  deletePermission(id, permissionId) {
    return request(`${DRIVE}/files/${encodeURIComponent(id)}/permissions/${encodeURIComponent(permissionId)}?supportsAllDrives=true`, { method: 'DELETE' });
  }

  // ---------- Sheets ----------
  async getSpreadsheet(id) {
    const data = await request(`${SHEETS}/spreadsheets/${encodeURIComponent(id)}?fields=spreadsheetId,properties.title,spreadsheetUrl,sheets.properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount))`);
    return {
      id: data.spreadsheetId,
      title: data.properties?.title || '',
      url: data.spreadsheetUrl,
      sheets: (data.sheets || []).map((s) => ({ sheetId: s.properties.sheetId, title: s.properties.title, index: s.properties.index, hidden: Boolean(s.properties.hidden), rows: s.properties.gridProperties?.rowCount, cols: s.properties.gridProperties?.columnCount })),
    };
  }

  async getValues(id, sheetTitle, range) {
    const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' });
    const data = await request(`${SHEETS}/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(a1(sheetTitle, range))}?${params}`);
    return data.values || [];
  }

  setValues(id, sheetTitle, range, values, { userEntered = false } = {}) {
    const params = new URLSearchParams({ valueInputOption: userEntered ? 'USER_ENTERED' : 'RAW' });
    return request(`${SHEETS}/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(a1(sheetTitle, range))}?${params}`, { method: 'PUT', body: { values } });
  }

  batchSetValues(id, data, { userEntered = false } = {}) {
    if (!data.length) return Promise.resolve(null);
    return request(`${SHEETS}/spreadsheets/${encodeURIComponent(id)}/values:batchUpdate`, {
      method: 'POST',
      body: { valueInputOption: userEntered ? 'USER_ENTERED' : 'RAW', data: data.map((d) => ({ range: a1(d.sheetTitle, d.range), values: d.values })) },
    });
  }

  appendValues(id, sheetTitle, values) {
    const params = new URLSearchParams({ valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' });
    return request(`${SHEETS}/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(a1(sheetTitle, 'A1'))}:append?${params}`, { method: 'POST', body: { values } });
  }

  clearValues(id, sheetTitle, range) {
    return request(`${SHEETS}/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(a1(sheetTitle, range))}:clear`, { method: 'POST', body: {} });
  }

  async sheetsBatchUpdate(id, requests) {
    if (!requests.length) return [];
    const data = await request(`${SHEETS}/spreadsheets/${encodeURIComponent(id)}:batchUpdate`, { method: 'POST', body: { requests } });
    return data.replies || [];
  }

  // ---------- Docs ----------
  getDocument(id) { return request(`${DOCS}/documents/${encodeURIComponent(id)}`); }
  docsBatchUpdate(id, requests) {
    if (!requests.length) return Promise.resolve(null);
    return request(`${DOCS}/documents/${encodeURIComponent(id)}:batchUpdate`, { method: 'POST', body: { requests } });
  }

  // ---------- Slides ----------
  getPresentation(id) { return request(`${SLIDES}/presentations/${encodeURIComponent(id)}`); }
  slidesBatchUpdate(id, requests) {
    if (!requests.length) return Promise.resolve(null);
    return request(`${SLIDES}/presentations/${encodeURIComponent(id)}:batchUpdate`, { method: 'POST', body: { requests } });
  }
}

export function fileLink(file) {
  if (file?.webViewLink) return file.webViewLink;
  if (!file?.id) return '#';
  switch (file.mimeType) {
    case MIME.spreadsheet: return `https://docs.google.com/spreadsheets/d/${file.id}/edit`;
    case MIME.document: return `https://docs.google.com/document/d/${file.id}/edit`;
    case MIME.presentation: return `https://docs.google.com/presentation/d/${file.id}/edit`;
    case MIME.folder: return `https://drive.google.com/drive/folders/${file.id}`;
    default: return `https://drive.google.com/file/d/${file.id}/view`;
  }
}
