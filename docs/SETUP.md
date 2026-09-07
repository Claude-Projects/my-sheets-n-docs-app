# Setup: enable Google sign-in for your deployment

Everything below is free and takes about five minutes. You will end up with an **OAuth Client ID** (a public identifier, not a secret) that you paste into `config.js`.

> Nothing you create here needs to be hidden. OAuth client IDs and browser API keys are designed to live in front-end code; Google protects them by only accepting requests from the **origins you whitelist**.

## 1. Publish the site on GitHub Pages

1. Push the repository to GitHub (public is fine).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Push to `main` (or run the *Deploy to GitHub Pages* workflow manually). Your site is now at
   `https://<user>.github.io/<repo>/` — note this **origin** (`https://<user>.github.io`), you need it in step 4.

## 2. Create a Google Cloud project and enable APIs

1. Open <https://console.cloud.google.com/> and create a project (e.g. *LedgerDrive*).
2. **APIs & Services → Library** — enable:
   * Google Drive API
   * Google Sheets API
   * Google Docs API
   * Google Slides API
   * *(optional, for "Pick from Drive")* Google Picker API

## 3. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding).
2. User type: **External**. App name, support email, developer email → save.
3. **Scopes → Add or remove scopes** and tick:
   * `.../auth/drive.file` — *See, edit, create, and delete only the specific Google Drive files you use with this app*
   * `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `openid`
4. **Audience / Test users**: while the app is in *Testing* status only listed test users can sign in (up to 100). Add yourself and anyone you share with.
   Because all scopes above are **non-sensitive**, you may also click **Publish app** — no Google verification review is required for these scopes. (Users will simply see the normal consent screen.)

## 4. Create the OAuth Client ID

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**. Name it anything.
3. **Authorized JavaScript origins** — add exactly:
   * `https://<user>.github.io`
   * `http://localhost:8080` *(optional, for local testing)*
4. **Authorized redirect URIs** — leave empty (the app uses the token flow, no redirects).
5. Create → copy the **Client ID** (`…apps.googleusercontent.com`).

## 5. Put it in `config.js`

```js
window.APP_CONFIG = {
  appName: "LedgerDrive",
  googleClientId: "1234567890-abc123.apps.googleusercontent.com",
  ...
};
```

Commit and push. Reload the site — the *Continue with Google* button is now active.

## 6. (Optional) Enable the Google Picker

The Picker lets a recipient browse *"Shared with me"* to connect a workbook someone shared with them. Without it, recipients paste the link instead (which works fine).

1. **Credentials → Create credentials → API key**.
2. **Restrict key**: Application restrictions → *Websites* → add `https://<user>.github.io/*`. API restrictions → *Google Picker API* only.
3. Copy the key into `googleApiKey` in `config.js`.
4. Copy your **Project number** (Cloud Console → project dashboard → *Project number*) into `googleProjectNumber`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Popup: *Error 400: redirect_uri_mismatch* or *origin_mismatch* | The site origin is not in **Authorized JavaScript origins**. Add `https://<user>.github.io` exactly (no path, no trailing slash). |
| *Access blocked: This app's request is invalid* / *403 access_denied* | App is in *Testing* and your account is not a test user — add it, or publish the app. |
| *This app isn't verified* | Only appears if you added sensitive scopes. Remove everything except the four scopes listed above. |
| Recipient sees "not shared with this app" | With `drive.file` the recipient's app instance must be introduced to the file once: they open the **app link** you copied from the Share dialog, or use **Shared with me → Pick from Drive**. |
| Sign-in works but nothing loads | Check that Drive, Sheets, Docs and Slides APIs are **enabled** in the same project as the client ID. |
