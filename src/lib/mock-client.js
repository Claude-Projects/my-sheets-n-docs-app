// In-browser stand-in for GoogleClient used by Demo mode. Data is kept in
// localStorage so visitors can try every feature without a Google account.

import { MIME, FILE_FIELDS } from './google-client.js';
import { uid } from './ids.js';

const KEY = 'ledgerdrive.demo.v1';

function colToIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Parses "A2:L5", "A:L", "A2:L", "B3" → zero-based {r0,c0,r1,c1} (r1/c1 may be Infinity). */
function parseRange(range) {
  if (!range) return { r0: 0, c0: 0, r1: Infinity, c1: Infinity };
  const [a, b] = range.split(':');
  const cell = (s, isEnd) => {
    const m = /^([A-Za-z]*)(\d*)$/.exec(s.trim());
    if (!m) throw new Error(`Bad range ${range}`);
    const c = m[1] ? colToIndex(m[1]) : (isEnd ? Infinity : 0);
    const r = m[2] ? Number(m[2]) - 1 : (isEnd ? Infinity : 0);
    return { r, c };
  };
  const s = cell(a, false);
  const e = b ? cell(b, true) : { r: s.r, c: s.c };
  return { r0: s.r, c0: s.c, r1: e.r, c1: e.c };
}

export class MockClient {
  constructor() {
    this.kind = 'demo';
    this.db = this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { files: {}, sheets: {}, docs: {}, slides: {} };
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.db)); } catch (e) {
      console.warn('Demo storage full', e);
    }
  }

  reset() {
    this.db = { files: {}, sheets: {}, docs: {}, slides: {} };
    this.save();
  }

  view(f) {
    if (!f) return null;
    const { content, ...rest } = f;
    return { ...rest, webViewLink: `#/demo-file/${f.id}` };
  }

  now() { return new Date().toISOString(); }

  // ---------- Drive ----------
  async listFiles({ parents, mimeType, appProperties, trashed = false, nameEquals, nameContains, sharedWithMe } = {}) {
    return Object.values(this.db.files)
      .filter((f) => trashed === null || Boolean(f.trashed) === trashed)
      .filter((f) => !parents || (f.parents || []).includes(parents))
      .filter((f) => !mimeType || f.mimeType === mimeType)
      .filter((f) => !nameEquals || f.name === nameEquals)
      .filter((f) => !nameContains || f.name.toLowerCase().includes(nameContains.toLowerCase()))
      .filter((f) => !sharedWithMe)
      .filter((f) => Object.entries(appProperties || {}).every(([k, v]) => f.appProperties?.[k] === v))
      .sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''))
      .map((f) => this.view(f));
  }

  async getFile(id) {
    const f = this.db.files[id];
    if (!f) throw Object.assign(new Error('That file no longer exists (demo).'), { status: 404 });
    return this.view(f);
  }

  createFolder(name, parentId, appProperties = {}) {
    return this.createFile({ name, mimeType: MIME.folder, parentId, appProperties });
  }

  async createFile({ name, mimeType, parentId, appProperties = {} }) {
    const id = `demo_${uid(10)}`;
    const f = { id, name, mimeType, parents: parentId ? [parentId] : [], appProperties, trashed: false, createdTime: this.now(), modifiedTime: this.now(), ownedByMe: true, shared: false, capabilities: { canEdit: true, canShare: true }, owners: [{ displayName: 'Demo User', emailAddress: 'demo@example.com' }], permissions: [] };
    this.db.files[id] = f;
    if (mimeType === MIME.spreadsheet) this.db.sheets[id] = { nextSheetId: 1, sheets: [{ sheetId: 0, title: 'Sheet1', index: 0, hidden: false, grid: [] }] };
    if (mimeType === MIME.document) this.db.docs[id] = { requests: [] };
    if (mimeType === MIME.presentation) this.db.slides[id] = { requests: [] };
    this.save();
    return this.view(f);
  }

  async uploadFile({ name, blob, parentId, appProperties = {}, fileId }) {
    const content = await blobToDataUrl(blob);
    if (fileId && this.db.files[fileId]) {
      Object.assign(this.db.files[fileId], { name, content, modifiedTime: this.now(), appProperties: { ...this.db.files[fileId].appProperties, ...appProperties } });
      this.save();
      return this.view(this.db.files[fileId]);
    }
    const f = await this.createFile({ name, mimeType: blob.type || 'application/octet-stream', parentId, appProperties });
    this.db.files[f.id].content = content;
    this.db.files[f.id].size = String(blob.size);
    this.save();
    return this.view(this.db.files[f.id]);
  }

  async downloadFile(id) {
    const f = this.db.files[id];
    if (!f?.content) throw new Error('No content');
    return dataUrlToBlob(f.content);
  }

  async downloadJson(id) {
    const blob = await this.downloadFile(id);
    return JSON.parse(await blob.text());
  }

  async updateFile(id, metadata = {}, { addParents, removeParents } = {}) {
    const f = this.db.files[id];
    if (!f) throw new Error('Not found');
    if (metadata.appProperties) metadata = { ...metadata, appProperties: { ...f.appProperties, ...metadata.appProperties } };
    Object.assign(f, metadata, { modifiedTime: this.now() });
    if (removeParents) f.parents = (f.parents || []).filter((p) => p !== removeParents);
    if (addParents) f.parents = [...new Set([...(f.parents || []), addParents])];
    this.save();
    return this.view(f);
  }

  trashFile(id) { return this.updateFile(id, { trashed: true }); }
  untrashFile(id) { return this.updateFile(id, { trashed: false }); }
  async deleteFile(id) { delete this.db.files[id]; delete this.db.sheets[id]; this.save(); return null; }

  async exportFile(id, mimeType) {
    const sp = this.db.sheets[id];
    const csv = sp ? sp.sheets.map((s) => `# ${s.title}\n${s.grid.map((r) => r.map((c) => JSON.stringify(c ?? '')).join(',')).join('\n')}`).join('\n\n') : '';
    return new Blob([csv], { type: mimeType === MIME.pdf ? 'text/plain' : 'text/csv' });
  }

  async listPermissions(id) { return [{ id: 'owner', type: 'user', role: 'owner', emailAddress: 'demo@example.com', displayName: 'Demo User' }, ...(this.db.files[id]?.permissions || [])]; }
  async createPermission(id, { emailAddress, role }) {
    const p = { id: `perm_${uid(6)}`, type: 'user', role, emailAddress, displayName: emailAddress.split('@')[0] };
    this.db.files[id].permissions.push(p);
    this.db.files[id].shared = true;
    this.save();
    return p;
  }
  async updatePermission(id, permissionId, role) {
    const p = this.db.files[id].permissions.find((x) => x.id === permissionId);
    if (p) p.role = role;
    this.save();
    return p;
  }
  async deletePermission(id, permissionId) {
    this.db.files[id].permissions = this.db.files[id].permissions.filter((x) => x.id !== permissionId);
    this.save();
    return null;
  }

  // ---------- Sheets ----------
  sp(id) {
    const s = this.db.sheets[id];
    if (!s) throw Object.assign(new Error('Spreadsheet not found (demo).'), { status: 404 });
    return s;
  }
  sheet(id, title) {
    const s = this.sp(id).sheets.find((x) => x.title === title);
    if (!s) throw new Error(`Unable to parse range: ${title}`);
    return s;
  }
  touch(id) { if (this.db.files[id]) this.db.files[id].modifiedTime = this.now(); }

  async getSpreadsheet(id) {
    const sp = this.sp(id);
    const f = this.db.files[id];
    return { id, title: f?.name || '', url: `#/demo-file/${id}`, sheets: sp.sheets.map((s, i) => ({ sheetId: s.sheetId, title: s.title, index: i, hidden: s.hidden, rows: s.grid.length, cols: 26 })) };
  }

  async getValues(id, sheetTitle, range) {
    const s = this.sheet(id, sheetTitle);
    const { r0, c0, r1, c1 } = parseRange(range);
    const out = [];
    for (let r = r0; r <= Math.min(r1, s.grid.length - 1); r++) {
      const row = s.grid[r] || [];
      const slice = row.slice(c0, Math.min(c1 + 1, row.length));
      while (slice.length && (slice[slice.length - 1] === '' || slice[slice.length - 1] === undefined || slice[slice.length - 1] === null)) slice.pop();
      out.push(slice);
    }
    while (out.length && out[out.length - 1].length === 0) out.pop();
    return out;
  }

  async setValues(id, sheetTitle, range, values) {
    const s = this.sheet(id, sheetTitle);
    const { r0, c0 } = parseRange(range);
    values.forEach((row, i) => {
      while (s.grid.length <= r0 + i) s.grid.push([]);
      const target = s.grid[r0 + i];
      row.forEach((v, j) => { while (target.length < c0 + j) target.push(''); target[c0 + j] = v; });
    });
    this.touch(id);
    this.save();
    return { updatedRows: values.length };
  }

  async batchSetValues(id, data) {
    for (const d of data) await this.setValues(id, d.sheetTitle, d.range, d.values);
    return null;
  }

  async appendValues(id, sheetTitle, values) {
    const s = this.sheet(id, sheetTitle);
    let last = s.grid.length;
    while (last > 0 && (s.grid[last - 1] || []).every((c) => c === '' || c === undefined || c === null)) last--;
    s.grid.length = last;
    for (const row of values) s.grid.push([...row]);
    this.touch(id);
    this.save();
    return { updates: { updatedRows: values.length } };
  }

  async clearValues(id, sheetTitle, range) {
    const s = this.sheet(id, sheetTitle);
    const { r0, c0, r1, c1 } = parseRange(range);
    for (let r = r0; r <= Math.min(r1, s.grid.length - 1); r++) {
      const row = s.grid[r] || [];
      for (let c = c0; c <= Math.min(c1, row.length - 1); c++) row[c] = '';
    }
    this.touch(id);
    this.save();
    return null;
  }

  async sheetsBatchUpdate(id, requests) {
    const sp = this.sp(id);
    const replies = [];
    for (const req of requests) {
      if (req.addSheet) {
        const p = req.addSheet.properties || {};
        const sheet = { sheetId: sp.nextSheetId++, title: p.title || `Sheet${sp.sheets.length + 1}`, index: p.index ?? sp.sheets.length, hidden: Boolean(p.hidden), grid: [] };
        sp.sheets.splice(Math.min(sheet.index, sp.sheets.length), 0, sheet);
        replies.push({ addSheet: { properties: { sheetId: sheet.sheetId, title: sheet.title, index: sheet.index } } });
      } else if (req.deleteSheet) {
        sp.sheets = sp.sheets.filter((s) => s.sheetId !== req.deleteSheet.sheetId);
        replies.push({});
      } else if (req.updateSheetProperties) {
        const p = req.updateSheetProperties.properties;
        const s = sp.sheets.find((x) => x.sheetId === p.sheetId);
        if (s) {
          if (p.title !== undefined) s.title = p.title;
          if (p.hidden !== undefined) s.hidden = p.hidden;
          if (p.index !== undefined) { sp.sheets = sp.sheets.filter((x) => x !== s); sp.sheets.splice(Math.min(p.index, sp.sheets.length), 0, s); }
        }
        replies.push({});
      } else if (req.deleteDimension) {
        const { range } = req.deleteDimension;
        const s = sp.sheets.find((x) => x.sheetId === range.sheetId);
        if (s && range.dimension === 'ROWS') s.grid.splice(range.startIndex, range.endIndex - range.startIndex);
        replies.push({});
      } else if (req.insertDimension) {
        const { range } = req.insertDimension;
        const s = sp.sheets.find((x) => x.sheetId === range.sheetId);
        if (s && range.dimension === 'ROWS') for (let i = range.startIndex; i < range.endIndex; i++) s.grid.splice(i, 0, []);
        replies.push({});
      } else {
        replies.push({});
      }
    }
    this.touch(id);
    this.save();
    return replies;
  }

  // ---------- Docs / Slides (recorded only) ----------
  async getDocument(id) { return { documentId: id, body: { content: [] } }; }
  async docsBatchUpdate(id, requests) { (this.db.docs[id] ||= { requests: [] }).requests.push(...requests); this.save(); return null; }
  async getPresentation(id) { return { presentationId: id, slides: [{ objectId: 'p' }] }; }
  async slidesBatchUpdate(id, requests) { (this.db.slides[id] ||= { requests: [] }).requests.push(...requests); this.save(); return null; }
}

function dataUrlToBlob(dataUrl) {
  const [head, data] = dataUrl.split(',');
  const mime = /^data:([^;]+)/.exec(head)?.[1] || 'application/octet-stream';
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export { FILE_FIELDS };
