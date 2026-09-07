import { h } from '../lib/dom.js';
import { parseAmount, todayISO } from '../lib/format.js';
import { openModal, field, select, toast, toastError, confirmDialog } from './components.js';
import { STATUSES } from '../services/schedule.js';
import { getRegistry } from '../services/workspace.js';
import { attachmentsPanel } from './attachments-panel.js';

/**
 * Edit (or create) one installment row.
 * @param {object} opts { row, workbook, plan, onSave(patch), onDelete(), onAttachmentsChange(value) }
 */
export function openRowEditor({ row, workbook, plan, onSave, onDelete, onAttachmentsChange, isNew = false }) {
  const categories = [...new Set([...getRegistry().installmentCategories, row.category].filter(Boolean))];
  const title = h('input', { type: 'text', value: row.title || '', required: true });
  const category = select(categories.map((c) => ({ value: c, label: c })), row.category || categories[0]);
  const amount = h('input', { type: 'text', value: String(row.amount ?? ''), placeholder: '70K' });
  const due = h('input', { type: 'date', value: row.due_date || '' });
  const status = select(STATUSES, row.status || 'pending');
  const paidDate = h('input', { type: 'date', value: row.paid_date || '' });
  const paidAmount = h('input', { type: 'text', value: String(row.paid_amount ?? ''), placeholder: 'Only for partial' });
  const notes = h('textarea', { rows: 3 }, row.notes || '');

  const syncPaidFields = () => {
    const st = status.value;
    paidDate.disabled = !(st === 'paid' || st === 'partial');
    paidAmount.disabled = st !== 'partial';
    if (st === 'paid') { if (!paidDate.value) paidDate.value = todayISO(); paidAmount.value = amount.value; }
    if (st === 'pending' || st === 'waived') { paidDate.value = ''; paidAmount.value = ''; }
  };
  status.addEventListener('change', syncPaidFields);
  syncPaidFields();

  const attach = isNew ? h('p', { class: 'help' }, 'Save the row first, then attach screenshots.') : attachmentsPanel({
    value: row.attachments,
    folderKey: `att:${workbook.id}`,
    folderName: workbook.name,
    meta: { ld_plan: plan.title, ld_row: row.id },
    onChange: (v) => onAttachmentsChange(v),
  });

  const saveBtn = h('button', { class: 'btn primary' }, isNew ? 'Add row' : 'Save changes');
  saveBtn.addEventListener('click', async () => {
    if (!title.value.trim()) { title.focus(); return; }
    saveBtn.disabled = true;
    try {
      const patch = {
        title: title.value.trim(), category: category.value, amount: parseAmount(amount.value), due_date: due.value, status: status.value,
        paid_date: paidDate.disabled ? '' : paidDate.value, paid_amount: status.value === 'paid' ? parseAmount(amount.value) : status.value === 'partial' ? parseAmount(paidAmount.value) : 0, notes: notes.value.trim(),
      };
      await onSave(patch);
      toast(isNew ? 'Row added' : 'Saved', 'success');
      m.close(true);
    } catch (e) { toastError(e); saveBtn.disabled = false; }
  });

  const m = openModal({
    title: isNew ? `Add row to ${plan.title}` : `Edit: ${row.title}`,
    subtitle: isNew ? '' : `#${row.seq} · created ${(row.created_at || '').slice(0, 10)}`,
    body: h('div', { class: 'grid', style: { gap: '16px' } },
      h('div', { class: 'form-grid' },
        h('div', { class: 'field span-2' }, h('label', null, 'Title'), title),
        field('Category', category), field('Amount', amount),
        field('Due date', due), field('Status', status),
        field('Paid on', paidDate), field('Paid amount', paidAmount, 'For partial payments'),
        h('div', { class: 'field span-2' }, h('label', null, 'Notes'), notes)),
      h('div', null, h('div', { class: 'label mb-s' }, 'Attachments (screenshots, receipts)'), attach)),
    footer: [
      !isNew && onDelete ? h('button', { class: 'btn danger left', onClick: async () => { if (await confirmDialog({ title: 'Delete this row?', message: 'The installment row is removed from the sheet. Attachments stay in Drive.', confirmText: 'Delete', danger: true })) { try { await onDelete(); m.close(true); } catch (e) { toastError(e); } } } }, 'Delete row') : null,
      h('button', { class: 'btn', onClick: () => m.close(false) }, 'Cancel'),
      saveBtn,
    ],
  });
  return m;
}
