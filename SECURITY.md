# Security notes

LedgerDrive is designed for a **public repository** deployed on **GitHub Pages**. This document explains what that means and how the app stays safe.

## Threat model in one paragraph

There is no server and no database. The only place your data lives is *your* Google Drive. The site ships static files; the browser obtains a short-lived OAuth access token from Google and calls Google's APIs directly. An attacker who reads this repository learns nothing private, and an attacker who controls the hosted files could only act within the narrow permission the user grants during sign-in.

## What is (and is not) in the repository

| Item | In repo? | Why it is safe |
| --- | --- | --- |
| OAuth **Client ID** | Yes (`config.js`) | A public identifier by design. Google only honours it from the **Authorized JavaScript origins** you configure. |
| Browser **API key** (optional, Picker) | Yes | Restricted to your site's HTTP referrer and to the Picker API only. |
| Client secret | **No** | The browser token flow (Google Identity Services) never uses one. |
| Access / refresh tokens | **No** | Held in memory + `sessionStorage` of the signed-in tab; cleared when the tab closes; never sent anywhere except `*.googleapis.com`. |
| User data | **No** | Lives in the user's own Drive files. |

## Permissions requested

* `https://www.googleapis.com/auth/drive.file` — **non-sensitive**. The app can only see and edit files **it created** (or that the user deliberately opened with it). It cannot list, read or modify anything else in the user's Drive.
* `openid`, `userinfo.email`, `userinfo.profile` — to show who is signed in.

The Sheets, Docs and Slides APIs all accept `drive.file`, so no broader scope is needed.

## Sharing model

Sharing is a **Google Drive permission** on the spreadsheet (and its attachments folder). Only people you explicitly add can open a workbook, and Google enforces it — the app has no permission system of its own to get wrong. Revoking access in the app calls the Drive Permissions API; you can also revoke from Google Drive directly.

Because of `drive.file`, a recipient's copy of the app is not automatically aware of the shared file; they connect it once via an app link or the Google Picker. This is a deliberate trade-off for using the least-privileged scope.

## Hardening built into the app

* **Strict Content-Security-Policy** in `index.html`: scripts only from the site itself and Google's identity/API loaders; network only to `googleapis.com` / `accounts.google.com`; no `eval`, no inline scripts, `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`.
* **No third-party JavaScript dependencies** — zero supply-chain surface beyond Google's own loaders.
* **All user content is rendered as text nodes**, never as HTML (the tiny `innerHTML` use is for a static SVG icon).
* **Sheets writes use `valueInputOption=RAW`**, so notes like `=HYPERLINK(...)` typed by a user are stored as literal text, never executed as formulas.
* Drive queries are built from typed parameters with escaped string literals; user text is never concatenated into API paths.
* Tokens are refreshed silently and revoked on sign-out (`google.accounts.oauth2.revoke`).
* `referrer` policy is `strict-origin-when-cross-origin`; external links use `rel="noopener"`.

## Residual risks and recommendations

* **Shared devices**: `sessionStorage` is cleared when the tab closes, but sign out explicitly on a shared computer.
* **Browser extensions** can read any page, including tokens in memory. Use a trusted browser profile.
* **Repository compromise**: whoever can push to `main` can change the code that runs for users. Protect the branch, require reviews, and keep the Pages deployment tied to `main` only.
* **Attachments** are ordinary Drive files under `Attachments/`. Sharing a workbook also shares that workbook's attachments folder; don't attach documents you would not want the recipients to see.
* **Demo mode** stores sample data in `localStorage` only; use *Reset demo data* to clear it.

## Reporting

Open a GitHub issue (without secrets or personal data) or contact the repository owner directly.
