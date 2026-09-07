// Screenshots / receipts stored as regular files in Drive under Attachments/<workbook>/.

import { client, tag, KIND } from './client.js';
import { safeFileName } from '../lib/format.js';

const urlCache = new Map();

export async function uploadAttachment({ blob, name, folder, meta = {} }) {
  const ext = blob.type === 'image/png' ? '.png' : blob.type === 'image/jpeg' ? '.jpg' : blob.type === 'image/webp' ? '.webp' : blob.type === 'application/pdf' ? '.pdf' : '';
  const base = safeFileName(name || `attachment-${Date.now()}`);
  const fileName = ext && !base.toLowerCase().endsWith(ext) ? `${base}${ext}` : base;
  // appProperties are limited to ~124 bytes per key+value.
  const safeMeta = Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, String(v ?? '').slice(0, 100)]));
  return client().uploadFile({ name: fileName, blob, parentId: folder.id, appProperties: tag(KIND.attachment, safeMeta) });
}

export async function attachmentUrl(fileId) {
  if (urlCache.has(fileId)) return urlCache.get(fileId);
  const blob = await client().downloadFile(fileId);
  const url = URL.createObjectURL(blob);
  urlCache.set(fileId, url);
  return url;
}

export async function removeAttachment(fileId) {
  try { await client().trashFile(fileId); } catch { /* may already be gone */ }
  const u = urlCache.get(fileId);
  if (u) { URL.revokeObjectURL(u); urlCache.delete(fileId); }
}

export function isImageName(name) {
  return /\.(png|jpe?g|webp|gif)$/i.test(name || '');
}

/** Compresses large images client-side before upload (keeps Drive tidy and uploads fast). */
export async function normalizeImage(file, maxDim = 1800) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 900_000) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.86));
    return blob || file;
  } catch {
    return file;
  }
}
