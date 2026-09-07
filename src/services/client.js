// Holds the active API client (real Google or demo mock).

let active = null;

export function setClient(client) { active = client; }

export function client() {
  if (!active) throw new Error('Not signed in');
  return active;
}

export function isDemo() { return active?.kind === 'demo'; }

export const PROPS = {
  app: 'ld_app',
  kind: 'ld_kind',
  role: 'ld_role',
  archived: 'ld_archived',
  owner: 'ld_owner',
  attFolder: 'ld_att_folder',
};

export const KIND = {
  root: 'root',
  folder: 'folder',
  registry: 'registry',
  plans: 'plans',
  expenses: 'expenses',
  todos: 'todos',
  attachment: 'attachment',
  document: 'document',
  presentation: 'presentation',
  sheet: 'sheet',
};

export function tag(kind, extra = {}) {
  return { [PROPS.app]: '1', [PROPS.kind]: kind, ...extra };
}
