// Small reactive store + app-wide singletons (config, prefs, session).

export class Store {
  constructor(initial) {
    this.value = initial;
    this.listeners = new Set();
  }
  get() { return this.value; }
  set(patch) {
    this.value = typeof patch === 'function' ? patch(this.value) : { ...this.value, ...patch };
    for (const fn of this.listeners) fn(this.value);
  }
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export class Emitter {
  constructor() { this.map = new Map(); }
  on(evt, fn) {
    if (!this.map.has(evt)) this.map.set(evt, new Set());
    this.map.get(evt).add(fn);
    return () => this.map.get(evt)?.delete(fn);
  }
  emit(evt, payload) {
    for (const fn of this.map.get(evt) || []) fn(payload);
  }
}

export const bus = new Emitter();

const RAW = (typeof window !== 'undefined' && window.APP_CONFIG) || {};
export const config = Object.freeze({
  appName: RAW.appName || 'LedgerDrive',
  googleClientId: (RAW.googleClientId || '').trim(),
  googleApiKey: (RAW.googleApiKey || '').trim(),
  googleProjectNumber: (RAW.googleProjectNumber || '').trim(),
  driveRootFolderName: RAW.driveRootFolderName || 'LedgerDrive',
  defaultCurrency: RAW.defaultCurrency || 'PKR',
  defaultLocale: RAW.defaultLocale || 'en-PK',
});

const PREFS_KEY = 'ledgerdrive.prefs.v1';
function loadPrefs() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { saved = {}; }
  return {
    theme: 'auto',
    currency: config.defaultCurrency,
    locale: config.defaultLocale,
    numberStyle: config.defaultCurrency === 'PKR' || config.defaultCurrency === 'INR' ? 'lac' : 'intl',
    dueSoonDays: 7,
    groupByDate: true,
    ...saved,
  };
}
export const prefs = new Store(loadPrefs());
prefs.subscribe((v) => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(v)); } catch { /* storage may be unavailable */ }
  applyTheme(v.theme);
});
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}
applyTheme(prefs.get().theme);

/** session: { status: 'boot'|'signed-out'|'signing-in'|'ready', mode: 'google'|'demo'|null, user, error } */
export const session = new Store({ status: 'boot', mode: null, user: null, error: null });

/** Workspace handles (folder IDs etc.) resolved after sign-in. */
export const workspace = new Store({ ready: false, root: null, folders: {}, registry: null });
