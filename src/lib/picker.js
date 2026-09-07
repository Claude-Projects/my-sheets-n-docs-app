// Google Picker: lets a user "open" a spreadsheet someone shared with them,
// which grants this app per-file access under the drive.file scope.

import { config } from '../state.js';
import { auth } from './auth.js';

let apiPromise = null;

export function pickerAvailable() {
  return Boolean(config.googleApiKey && auth.isConfigured);
}

function loadPickerApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const done = () => window.gapi.load('picker', { callback: () => resolve(window.google.picker), onerror: () => reject(new Error('Picker failed to load')) });
    if (window.gapi?.load) return done();
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.async = true;
    s.onload = done;
    s.onerror = () => reject(new Error('Could not load Google API loader'));
    document.head.appendChild(s);
  });
  return apiPromise;
}

/** Resolves with an array of picked file docs ({id, name, mimeType}) or [] if cancelled. */
export async function pickSpreadsheets({ multiple = true } = {}) {
  if (!pickerAvailable()) throw new Error('Picker is not configured (googleApiKey missing).');
  const token = auth.getAccessToken() || (await auth.refresh());
  const picker = await loadPickerApi();
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS).setIncludeFolders(false).setOwnedByMe(false);
    const shared = new picker.DocsView(picker.ViewId.SPREADSHEETS).setIncludeFolders(false);
    let builder = new picker.PickerBuilder()
      .addView(view)
      .addView(shared)
      .setOAuthToken(token)
      .setDeveloperKey(config.googleApiKey)
      .setTitle('Choose spreadsheets shared with you')
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) resolve((data.docs || []).map((d) => ({ id: d.id, name: d.name, mimeType: d.mimeType })));
        else if (data.action === picker.Action.CANCEL) resolve([]);
      });
    if (multiple) builder = builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
    if (config.googleProjectNumber) builder = builder.setAppId(config.googleProjectNumber);
    builder.build().setVisible(true);
  });
}
