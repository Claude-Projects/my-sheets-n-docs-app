import { h, replace, icon, downloadBlob } from '../../lib/dom.js';
import { fmtDate, safeFileName } from '../../lib/format.js';
import { listWorkbooks, createWorkbook, renameWorkbook, archiveWorkbook, unarchiveWorkbook, trashWorkbook, attachmentsFolderFor } from '../../services/plans.js';
import { unlinkSharedFile } from '../../services/workspace.js';
import { exportFile } from '../../services/documents.js';
import { fileLink } from '../../lib/google-client.js';
import { isDemo } from '../../services/client.js';
import { openModal, promptDialog, confirmDialog, toast, toastError, emptyState, dropdown, loading, badge } from '../components.js';
import { openShareModal } from '../share-modal.js';

export async function render(root, { setTitle, query, navigate }) {
  setTitle('Installment plans');
  let tab = 'active';
  let data = null;

  const body = h('div', null, loading('Loading workbooks…'));
  const tabs = h('div', { class: 'tabs' });
  const head = h('div', { class: 'page-head' },
    h('div', null, h('h1', null, 'Installment plans'), h('p', { class: 'sub' }, 'Each workbook is one Google Sheet. Inside it, every plan (plot, car, scheme…) gets its own tab.')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onClick: () => newWorkbook() }, icon('sheet'), 'New workbook'),
      h('button', { class: 'btn primary', onClick: () => newPlan() }, icon('plus'), 'New plan')),
  );
  replace(root, head, tabs, body);

  async function load() {
    data = await listWorkbooks();
    renderTabs();
    renderList();
  }

  function renderTabs() {
    replace(tabs, [['active', 'My workbooks', data.active.length], ['shared', 'Shared with me', data.shared.length], ['archived', 'Archived', data.archived.length]].map(([id, label, n]) =>
      h('button', { class: tab === id ? 'active' : '', onClick: () => { tab = id; renderTabs(); renderList(); } }, label, h('span', { class: 'count' }, String(n)))));
  }

  function renderList() {
    const items = data[tab];
    if (!items.length) {
      const msg = { active: ['No workbooks yet', 'Create a workbook, then add plans to it. Try the sample template to see what a full plot plan looks like.', h('button', { class: 'btn primary', onClick: () => newPlan() }, 'Create your first plan')], shared: ['Nothing shared with you', 'When someone shares a workbook, open its app link or use “Shared with me” to connect it here.', h('a', { class: 'btn', href: '#/shared' }, 'Open shared file')], archived: ['No archived workbooks', 'Archived workbooks move to the Archive folder in Drive and stay out of your way.', null] }[tab];
      replace(body, emptyState({ emoji: '🗂', title: msg[0], text: msg[1], action: msg[2] }));
      return;
    }
    replace(body, h('div', { class: 'grid auto' }, items.map((wb) => tile(wb))));
  }

  function tile(wb) {
    const menu = dropdown(h('button', { class: 'btn ghost icon', 'aria-label': 'More', onClick: (e) => e.stopPropagation() }, icon('more')), [
      { label: 'Open', icon: 'plans', onClick: () => navigate(`/plans/${wb.id}`) },
      !wb.unavailable && !isDemo() ? { label: 'Open in Google Sheets', icon: 'link', onClick: () => window.open(fileLink(wb), '_blank', 'noopener') } : null,
      !wb.unavailable ? { label: 'Download as Excel (.xlsx)', icon: 'download', onClick: async () => { try { downloadBlob(await exportFile(wb, 'xlsx'), `${safeFileName(wb.name)}.xlsx`); } catch (e) { toastError(e); } } } : null,
      !wb.linked ? { label: 'Share…', icon: 'share', onClick: async () => { try { const f = await attachmentsFolderFor(wb); openShareModal(wb, { extraFileIds: [f.id] }); } catch (e) { toastError(e); } } } : null,
      !wb.linked ? { label: 'Rename', icon: 'edit', onClick: async () => { const name = await promptDialog({ title: 'Rename workbook', label: 'Name', value: wb.name }); if (name && name !== wb.name) { try { await renameWorkbook(wb.id, name); toast('Renamed', 'success'); load(); } catch (e) { toastError(e); } } } } : null,
      'sep',
      !wb.linked && !wb.archived ? { label: 'Archive', icon: 'archive', onClick: async () => { try { await archiveWorkbook(wb.id); toast('Archived', 'success'); load(); } catch (e) { toastError(e); } } } : null,
      !wb.linked && wb.archived ? { label: 'Restore', icon: 'refresh', onClick: async () => { try { await unarchiveWorkbook(wb.id); toast('Restored', 'success'); load(); } catch (e) { toastError(e); } } } : null,
      wb.linked ? { label: 'Remove from my list', icon: 'close', onClick: async () => { await unlinkSharedFile(wb.id); load(); } } : null,
      !wb.linked ? { label: 'Move to Drive trash', icon: 'trash', danger: true, onClick: async () => { if (await confirmDialog({ title: 'Move to trash?', message: `“${wb.name}” and all its plans go to your Google Drive trash (recoverable for 30 days).`, confirmText: 'Move to trash', danger: true })) { try { await trashWorkbook(wb.id); toast('Moved to trash', 'success'); load(); } catch (e) { toastError(e); } } } } : null,
    ]);
    const owner = wb.owners?.[0];
    return h('div', { class: 'card tile', onClick: (e) => { if (!e.target.closest('.dropdown')) navigate(`/plans/${wb.id}`); } },
      h('div', { class: 'row-between' }, h('h3', null, icon('sheet'), wb.name), menu),
      h('div', { class: 'meta' }, wb.unavailable ? h('span', { class: 'badge overdue' }, 'not accessible') : `Updated ${fmtDate(wb.modifiedTime)}`),
      h('div', { class: 'inline' },
        wb.linked ? badge('pending', `shared by ${owner?.emailAddress || owner?.displayName || 'someone'}`) : null,
        wb.shared && !wb.linked ? badge('', 'shared') : null,
        wb.archived ? badge('archived') : null),
    );
  }

  async function newWorkbook() {
    const name = await promptDialog({ title: 'New workbook', label: 'Workbook name', placeholder: 'e.g. Property — Plots', confirmText: 'Create' });
    if (!name) return null;
    try {
      const wb = await createWorkbook(name);
      toast('Workbook created in your Drive', 'success');
      await load();
      return wb;
    } catch (e) { toastError(e); return null; }
  }

  async function newPlan() {
    if (!data) return;
    if (!data.active.length) {
      const wb = await newWorkbook();
      if (wb) navigate(`/plans/${wb.id}?new=1`);
      return;
    }
    if (data.active.length === 1) return navigate(`/plans/${data.active[0].id}?new=1`);
    const m = openModal({
      title: 'Add the plan to which workbook?', size: 'narrow',
      body: h('div', { class: 'list' }, [
        ...data.active.map((wb) => h('button', { class: 'btn block', style: { justifyContent: 'flex-start', marginBottom: '8px' }, onClick: () => { m.close(); navigate(`/plans/${wb.id}?new=1`); } }, icon('sheet'), wb.name)),
        h('button', { class: 'btn ghost block', onClick: async () => { m.close(); const wb = await newWorkbook(); if (wb) navigate(`/plans/${wb.id}?new=1`); } }, '+ New workbook'),
      ]),
    });
  }

  await load();
  if (query.new) { history.replaceState(null, '', '#/plans'); newPlan(); }
}
