// Google Identity Services (OAuth 2.0 token flow, browser-only).
// Tokens live in memory + sessionStorage (cleared when the tab closes) and are
// never sent anywhere except Google's own APIs.

import { config, bus } from '../state.js';

export const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const TOKEN_KEY = 'ledgerdrive.token.v1';
const GSI_SRC = 'https://accounts.google.com/gsi/client';

let tokenClient = null;
let current = loadStoredToken();
let gsiPromise = null;

function loadStoredToken() {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (!t.accessToken || !t.expiresAt || t.expiresAt < Date.now() + 30_000) return null;
    return t;
  } catch {
    return null;
  }
}

function storeToken(t) {
  current = t;
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t));
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

export function loadGsi() {
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve(window.google);
    const s = document.createElement('script');
    s.src = GSI_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error('Could not load Google Identity Services. Check your network or content blockers.'));
    document.head.appendChild(s);
  });
  return gsiPromise;
}

export const auth = {
  get isConfigured() {
    return Boolean(config.googleClientId);
  },

  hasValidToken() {
    return Boolean(current && current.expiresAt > Date.now() + 30_000);
  },

  getAccessToken() {
    return this.hasValidToken() ? current.accessToken : null;
  },

  async ensureClient() {
    if (tokenClient) return tokenClient;
    const google = await loadGsi();
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: config.googleClientId,
      scope: SCOPES.join(' '),
      callback: () => {},
      error_callback: () => {},
    });
    return tokenClient;
  },

  /**
   * Requests an access token. `prompt: ''` attempts a silent grant for users
   * who already consented; 'consent' forces the consent screen.
   */
  async requestToken({ prompt = '', hint = '' } = {}) {
    const client = await this.ensureClient();
    return new Promise((resolve, reject) => {
      client.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        const granted = (resp.scope || '').split(' ');
        if (!granted.includes('https://www.googleapis.com/auth/drive.file')) {
          return reject(new Error('Google Drive file permission was not granted. Please tick the Drive checkbox on the consent screen.'));
        }
        const token = {
          accessToken: resp.access_token,
          expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000,
          scope: resp.scope,
        };
        storeToken(token);
        resolve(token);
      };
      client.error_callback = (err) => reject(new Error(err?.message || err?.type || 'Sign-in was cancelled.'));
      client.requestAccessToken({ prompt, hint, include_granted_scopes: true });
    });
  },

  async signIn() {
    // First try silently (works when the user previously granted access and
    // is signed in to Google); fall back to the consent screen.
    try {
      return await this.requestToken({ prompt: '' });
    } catch {
      return this.requestToken({ prompt: 'consent' });
    }
  },

  async fetchUserInfo() {
    const token = this.getAccessToken();
    if (!token) throw new Error('Not signed in');
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error('Could not load your Google profile');
    const u = await r.json();
    return { id: u.sub, email: u.email, name: u.name || u.email, picture: u.picture || '' };
  },

  /** Called by the API layer on 401: try a silent refresh once, else ask user to sign in again. */
  async refresh() {
    try {
      const t = await this.requestToken({ prompt: '' });
      return t.accessToken;
    } catch (e) {
      storeToken(null);
      bus.emit('auth:expired', e);
      throw new Error('Your Google session expired. Please sign in again.');
    }
  },

  async signOut({ revoke = true } = {}) {
    const token = current?.accessToken;
    storeToken(null);
    if (revoke && token && window.google?.accounts?.oauth2) {
      await new Promise((res) => window.google.accounts.oauth2.revoke(token, res));
    }
  },
};
