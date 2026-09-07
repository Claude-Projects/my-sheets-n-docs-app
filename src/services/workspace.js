// Drive folder structure + a small JSON registry stored in the user's Drive.
//
//   <Root>/                     (ld_kind=root)
//     Installment Plans/        workbooks (spreadsheets, ld_kind=plans)
//     Expenses/                 expense ledger spreadsheet(s)
//     Todos/                    todo spreadsheet
//     Attachments/<workbook>/   uploaded screenshots & receipts
//     Documents/                generated Docs & Slides
//     Archive/                  archived workbooks are moved here
//     workspace.json            registry: linked shared files, categories …

import { client, tag, KIND, PROPS } from './client.js';
import { MIME } from '../lib/google-client.js';
import { config, workspace } from '../state.js';

export const FOLDERS = {
  plans: 'Installment Plans',
  expenses: 'Expenses',
  todos: 'Todos',
  attachments: 'Attachments',
  documents: 'Documents',
  archive: 'Archive',
};

const DEFAULT_REGISTRY = () => ({
  version: 1,
  linkedFiles: [],            // spreadsheets other people shared with me: {id, kind, name, addedAt}
  expenseCategories: ['Groceries', 'Utilities', 'Rent', 'Transport', 'Fuel', 'Food & Dining', 'Health', 'Education', 'Shopping', 'Bills', 'Family', 'Plot / Property', 'Savings', 'Other'],
  expenseAccounts: ['Cash', 'Bank', 'Card', 'Mobile Wallet'],
  todoLists: ['Personal', 'Work', 'Property', 'Family'],
  installmentCategories: ['Plot', 'Development', 'Booking', 'Possession', 'Allocation', 'Map & Demarcation', 'Security Deposit', 'Transfer', 'Other'],
});

let registryFileId = null;

export async function initWorkspace() {
  const c = client();
  const root = await ensureFolder({ name: config.driveRootFolderName, appProperties: tag(KIND.root) });
  const folders = {};
  for (const [role, name] of Object.entries(FOLDERS)) {
    folders[role] = (await ensureFolder({ name, parentId: root.id, appProperties: tag(KIND.folder, { [PROPS.role]: role }) })).id;
  }
  const registry = await loadRegistry(root.id);
  workspace.set({ ready: true, root, folders, registry });
  return { root, folders, registry, client: c };
}

async function ensureFolder({ name, parentId, appProperties }) {
  const c = client();
  const found = await c.listFiles({ parents: parentId, mimeType: MIME.folder, appProperties: { [PROPS.kind]: appProperties[PROPS.kind], ...(appProperties[PROPS.role] ? { [PROPS.role]: appProperties[PROPS.role] } : {}) } });
  if (found.length) return found[0];
  return c.createFolder(name, parentId, appProperties);
}

async function loadRegistry(rootId) {
  const c = client();
  const files = await c.listFiles({ parents: rootId, appProperties: { [PROPS.kind]: KIND.registry } });
  if (files.length) {
    registryFileId = files[0].id;
    try {
      const data = await c.downloadJson(files[0].id);
      return { ...DEFAULT_REGISTRY(), ...data };
    } catch {
      return DEFAULT_REGISTRY();
    }
  }
  const reg = DEFAULT_REGISTRY();
  const blob = new Blob([JSON.stringify(reg, null, 2)], { type: 'application/json' });
  const file = await c.uploadFile({ name: 'workspace.json', blob, parentId: rootId, appProperties: tag(KIND.registry) });
  registryFileId = file.id;
  return reg;
}

export function getRegistry() {
  return workspace.get().registry || DEFAULT_REGISTRY();
}

export async function updateRegistry(patch) {
  const next = { ...getRegistry(), ...(typeof patch === 'function' ? patch(getRegistry()) : patch) };
  const blob = new Blob([JSON.stringify(next, null, 2)], { type: 'application/json' });
  await client().uploadFile({ name: 'workspace.json', blob, fileId: registryFileId, parentId: workspace.get().root?.id, appProperties: tag(KIND.registry) });
  workspace.set({ registry: next });
  return next;
}

export function folderId(role) {
  return workspace.get().folders[role];
}

export async function ensureSubfolder(parentRole, name, key) {
  const c = client();
  const parent = folderId(parentRole);
  const found = await c.listFiles({ parents: parent, mimeType: MIME.folder, appProperties: { [PROPS.role]: key } });
  if (found.length) return found[0];
  return c.createFolder(name, parent, tag(KIND.folder, { [PROPS.role]: key }));
}

export async function linkSharedFile(file, kind) {
  const linked = getRegistry().linkedFiles.filter((f) => f.id !== file.id);
  linked.push({ id: file.id, kind, name: file.name, addedAt: new Date().toISOString(), owner: file.owners?.[0]?.emailAddress || '' });
  return updateRegistry({ linkedFiles: linked });
}

export async function unlinkSharedFile(id) {
  return updateRegistry({ linkedFiles: getRegistry().linkedFiles.filter((f) => f.id !== id) });
}
