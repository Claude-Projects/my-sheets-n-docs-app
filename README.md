# LedgerDrive

**Heavy-duty sheets, docs and slides — without the spreadsheet grind.**

LedgerDrive is a static web app (hosted on GitHub Pages) that signs you in with Google and turns a few clicks into complete, well-formatted Google Sheets, Docs and Slides — all saved in **your own Google Drive**. There is no backend, no database and no credentials stored anywhere: the browser talks directly to Google's APIs with a short-lived token.

Live app: `https://<your-github-user>.github.io/my-sheets-n-docs-app/` (see [docs/SETUP.md](docs/SETUP.md) to enable Google sign-in). A full **demo mode** works without any account.

## What you can do

| Module | Highlights |
| --- | --- |
| **Installment plans** | One Google Sheet ("workbook") holds many plans (plot, car, scheme…) — one tab each, plus an auto-generated *Summary* tab with live formulas. A 3-step wizard generates the whole schedule from streams (e.g. *Plot 70K monthly × 22* + *Development 28K monthly × 20* + half-yearly payments) and one-off items (booking, possession, allocation, map & demarcation…). Tick a row to mark it paid; select many rows for bulk *paid / pending / waive / shift dates / set amount / delete*. Pending, **overdue**, due-soon, partial and waived are tracked automatically. Attach screenshots or receipts to any row (click, drag-drop or `Ctrl+V`) — they are uploaded to `Attachments/<workbook>/` in Drive. Archive or delete plans and workbooks. |
| **Expenses** | One ledger sheet with a tab per year. The app groups entries **year → month → day** with totals and category bars, filters and search, receipts as attachments, and one-click monthly/yearly **expense report Docs**. |
| **Todos** | A separate sheet with quick-add (`Pay dev charges tomorrow !high`), lists, priorities, in-progress state, snooze, archive and bulk complete. |
| **Docs & Slides studio** | Generate a **payment statement (Google Doc)** or **plan presentation (Google Slides)** from any plan, expense reports, or blank files inside your LedgerDrive folder. Export anything as `.xlsx`, `.docx`, `.pptx` or PDF. |
| **Sharing** | Share a workbook by email exactly like a Google Sheet (view or edit) — the attachments folder is shared alongside. Recipients connect it via an *app link* or the Google Picker. Nobody sees your data unless you share it. |

Sample data: the wizard includes a **"Sample: GFS Ph-3 plot (R-19)"** template with irregular dates, allocation fees and demarcation charges, so you can see a real plan in one click.

## How it is built

```
index.html          static shell (strict CSP, no inline scripts)
config.js           public deployment config (OAuth client ID etc.)
src/
  app.js            boot, session, routing
  lib/              auth (Google Identity Services), REST client for Drive/Sheets/Docs/Slides,
                    demo mock client, Picker, DOM & formatting helpers
  services/         workspace folders, sheet-as-table layer, schedule generator,
                    plans / expenses / todos / attachments / sharing / document generators
  ui/               layout, components, views (dashboard, plans, plan, expenses, todos, studio, shared, settings)
styles/app.css      design system (light/dark, responsive)
```

* **Zero dependencies, zero build step** — vanilla ES modules, deployable as-is to GitHub Pages.
* **OAuth scope `drive.file` only** (non-sensitive): the app can read/write only files it created or that you explicitly opened with it. It can never see the rest of your Drive.
* **Data model** — every table is a normal sheet with a header row and an `id` column, so you can also open the files in Google Sheets. Rows are written with `valueInputOption=RAW`, so user text is never interpreted as a formula.

Drive layout created for each user:

```
LedgerDrive/
  Installment Plans/   workbooks (each a Google Sheet: Summary + _meta + one tab per plan)
  Expenses/            Expenses.gsheet (one tab per year)
  Todos/               Todos.gsheet
  Attachments/<workbook>/  screenshots & receipts
  Documents/           generated Docs, Slides, blank files
  Archive/             archived workbooks
  workspace.json       categories, lists, shared-file registry
```

## Run locally

```bash
python3 -m http.server 8080     # or any static server
# open http://localhost:8080 and click "Try the demo"
```

To test real Google sign-in locally add `http://localhost:8080` to the OAuth client's *Authorized JavaScript origins* (see setup guide).

## Deploy

1. Fork / push this repository (it can stay public — nothing in it is secret).
2. Repository **Settings → Pages → Source: GitHub Actions**. The included workflow ([.github/workflows/pages.yml](.github/workflows/pages.yml)) deploys `main` on every push.
3. Follow [docs/SETUP.md](docs/SETUP.md) to create an OAuth Client ID and paste it into `config.js`.

## Security

Read [SECURITY.md](SECURITY.md) for the threat model, what is (and is not) stored where, and hardening notes for a public repository.

## License

MIT — see [LICENSE](LICENSE).
