import { h, replace, icon } from '../lib/dom.js';
import { toast, toastError, lightbox, confirmDialog } from './components.js';
import { uploadAttachment, attachmentUrl, removeAttachment, isImageName, normalizeImage } from '../services/attachments.js';
import { parseAttachments, serializeAttachments } from '../services/plans.js';

/**
 * Renders thumbnails + upload zone. `value` is the encoded cell string.
 * onChange(newEncodedValue) is called after every successful upload/removal.
 * Supports click-to-browse, drag & drop and Ctrl/Cmd+V paste of screenshots.
 */
export function attachmentsPanel({ value, onChange, folderKey, folderName, meta = {} }) {
  let list = parseAttachments(value);
  const thumbs = h('div', { class: 'thumbs' });
  const fileInput = h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, hidden: true, onChange: () => addFiles([...fileInput.files]) });
  const zone = h('div', { class: 'dropzone', tabindex: 0, onClick: () => fileInput.click() },
    icon('upload'), ' Click to upload screenshots or receipts, drag & drop, or press ', h('span', { class: 'kbd' }, 'Ctrl+V'), ' with a screenshot on the clipboard.');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); addFiles(files); }
  };
  const root = h('div', { class: 'grid', style: { gap: '10px' } }, thumbs, zone, fileInput);
  root.addEventListener('paste', onPaste);
  // Paste anywhere inside the modal
  const modalBody = () => root.closest('.modal');
  setTimeout(() => modalBody()?.addEventListener('paste', onPaste), 0);

  async function addFiles(files) {
    for (const f of files) {
      const status = h('div', { class: 'thumb' }, h('span', { class: 'spinner' }));
      thumbs.appendChild(status);
      try {
        const blob = await normalizeImage(f);
        const name = f.name && f.name !== 'image.png' ? f.name : `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.${blob.type === 'image/jpeg' ? 'jpg' : 'png'}`;
        const file = await uploadAttachment({ blob, name, folderKey, folderName, meta });
        list = [...list, { id: file.id, name: file.name }];
        await onChange(serializeAttachments(list));
        toast('Attachment saved to Google Drive', 'success');
      } catch (e) {
        toastError(e);
      } finally {
        status.remove();
        draw();
      }
    }
  }

  function draw() {
    replace(thumbs, list.map((a) => {
      const img = h('img', { alt: a.name, loading: 'lazy' });
      const t = h('div', { class: 'thumb', title: a.name },
        isImageName(a.name) ? img : h('span', { style: { fontSize: '28px' } }, '📄'),
        h('button', { class: 'rm', title: 'Remove attachment', onClick: async (e) => {
          e.stopPropagation();
          if (!(await confirmDialog({ title: 'Remove attachment?', message: `“${a.name}” will be moved to your Drive trash.`, confirmText: 'Remove', danger: true }))) return;
          try {
            await removeAttachment(a.id);
            list = list.filter((x) => x.id !== a.id);
            await onChange(serializeAttachments(list));
            draw();
          } catch (err) { toastError(err); }
        } }, '✕'));
      t.addEventListener('click', async () => {
        try {
          const url = await attachmentUrl(a.id);
          if (isImageName(a.name)) lightbox(url, a.name); else window.open(url, '_blank', 'noopener');
        } catch (e) { toastError(e); }
      });
      if (isImageName(a.name)) attachmentUrl(a.id).then((u) => { img.src = u; }).catch(() => { img.alt = 'unavailable'; });
      return t;
    }));
    if (!list.length) thumbs.appendChild(h('span', { class: 'faint', style: { fontSize: '13px' } }, 'No attachments yet.'));
  }
  draw();
  return root;
}
