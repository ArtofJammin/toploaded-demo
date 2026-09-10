# Top Loaded Trading Cards — website

The site for Top Loaded TCG (Crescent Springs, KY): live inventory from the shop's
TCGplayer store, cart + Square checkout, live rip-and-ship breaks, play nights, the
monthly card show, a buylist with a card-worth estimator, a virtual pack-rip game,
and a staff desk + admin back office. Static page on GitHub Pages, dynamic pieces
on a small Cloudflare Worker, and it runs in a full demo mode when the API is off.

Live: https://artofjammin.github.io/toploaded-demo/

## Run it

```bash
node tools/dev-server.mjs
```

http://localhost:8787 — builds the page, watches `src/`, serves the API at `/api`
with an in-memory KV (persisted to `tools/.dev-kv.json`). Dev passcodes:
`staff` / `admin`. Node 18+ only, no install.

## Edit it

| What | Where |
|---|---|
| Page markup, per view | `src/html/*.html` (files concatenate in name order; views are `<section class="view" id="view-…">`) |
| Styles | `src/css/*.css` (tokens in `00-tokens.css`; three themes: `tl`, `light`, `dark`) |
| Behaviour | `src/js/*.js` — one shared closure, files run in name order; contracts and events are documented in `src/js/00-core.js` |
| Shop facts the owner can change | `config.default.json` (hours, play nights, card show, live, links, buy rates, ticker, testimonials) — also editable in the Admin page |
| API | `api/` (see `api/README.md` for every endpoint) |
| Inventory | `inventory.json` + `inventory-summary.json`, refreshed by `tools/update-inventory.py` |

Build: `node tools/build.mjs` → `index.html` (commit it) and `tools/artifact.html`.
Check: `node tools/check.mjs` (build + syntax + ids + API tests). CI runs the same.

## Deploy

- **Site**: push `main`; `pages.yml` validates and publishes only the public site assets.
  Pages publishing source must be **GitHub Actions**, not the legacy branch builder.
  A successful inventory workflow also triggers publication (bot commits alone do not).
- **Inventory**: `.github/workflows/inventory.yml` runs at 02:17, 10:17 and 18:17 UTC and on
  demand (Actions → Refresh inventory → Run workflow, or the admin "Sync now" button
  once the API has a `GITHUB_TOKEN`). `tools/update-inventory.ps1` is the local fallback.
  In summer this is approximately 6:17 AM, 2:17 PM and 10:17 PM Eastern; winter is an hour earlier.
  Scheduled runs can be delayed by GitHub. An empty, failed or incomplete pull is not published.
  Without the API, Admin opens the authenticated GitHub workflow page for a manual run.
- **After-sale checks**: implemented but not active until the Worker, signed Square
  payment webhooks and the optional delayed queue are connected. See `api/README.md`.
- **API**: `api/README.md` — `wrangler deploy`, set the secrets, then put the worker URL in
  `src/head.html` (`<meta name="tl-api">`), rebuild, commit.
- **Passcodes**: production passcodes are Worker secrets (`STAFF_PIN_HASH`, `ADMIN_PIN_HASH`).
  The demo-mode placeholders live in `src/js/80-auth.js` and must be changed before launch.
