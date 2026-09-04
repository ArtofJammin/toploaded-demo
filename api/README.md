# Top Loaded TCG API

A single Cloudflare Worker (free tier is enough) that gives the static GitHub Pages
site its dynamic pieces: settings the owner can edit, real form submissions, Square
checkout, Square webhooks → cross-channel alerts, a store-credit ledger, live-break
spots and chat, and an on-demand inventory refresh. The site works without it
(demo mode with localStorage), and lights features up when it can reach `/health`.

## Run locally (no install)

```bash
node tools/dev-server.mjs
```

Serves the site at http://localhost:8787 with the worker mounted at `/api/*` and an
in-memory KV persisted to `tools/.dev-kv.json`. Dev passcodes are `staff` / `admin`.
Copy `api/.dev.vars.example` to `api/.dev.vars` to add real keys.

Tests: `node --test "api/test/*.test.mjs"`

## Deploy

```bash
npm i -g wrangler && wrangler login
cd api
wrangler kv namespace create KV            # paste the id into wrangler.toml
node -e "console.log(require('crypto').createHash('sha256').update('STAFF PASSCODE').digest('hex'))"
wrangler secret put STAFF_PIN_HASH
wrangler secret put ADMIN_PIN_HASH
wrangler secret put TOKEN_SECRET           # any long random string
wrangler deploy                            # prints https://toploaded-api.<account>.workers.dev
```

Then put that URL in `src/head.html` (`<meta name="tl-api" content="…">`), rebuild,
commit. Optional secrets: `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`,
`SQUARE_WEBHOOK_SIGNATURE_KEY`, `RESEND_API_KEY`, `NOTIFY_EMAIL`, `EMAIL_FROM`,
`GITHUB_TOKEN`, `POKEMONTCG_API_KEY`. `/health` reports which are configured.

## Conventions

- Paths have **no** `/api` prefix on the worker; the dev server strips it.
- JSON in, JSON out. Errors: `{ "error": "message" }` with a 4xx/5xx status.
- Auth: `Authorization: Bearer <token>` from `POST /auth/login`. Roles `staff` and
  `admin`; admin passes every staff check. Tokens are HMAC-signed, 12 h.
- CORS: only origins listed in `SITE_ORIGIN` (comma separated, or `*`).
- Public write endpoints are rate limited per IP and carry a honeypot field `website`
  that must be empty.
- KV keys: `config`, `form:<kind>:<id>`, `alerts`, `credit:<id>`, `credit:index`,
  `credit:log:<id>`, `live:spots`, `live:chat`, `live:viewers`, `inventory:status`,
  `price:<game>:<hash>`, `rl:<key>:<bucket>`.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | – | `{ok, time, integrations:{kv,auth,square,squareWebhook,email,github,pokemontcg}}` |
| GET | `/config` | – | Merged site config (`config.default.json` shape ← KV `config`) |
| PUT | `/config` | admin | Deep-merge a patch; top-level keys must exist in the defaults; `logo` must be an image data URL ≤ 200 KB |
| DELETE | `/config` | admin | Reset to defaults |
| POST | `/auth/login` | – | `{pin}` → `{token, role, exp}`; 8 tries / 10 min per IP |
| GET | `/auth/me` | staff | `{role, exp}` |
| POST | `/auth/logout` | – | no-op (client forgets token) |
| POST | `/forms/:kind` | – | `kind` ∈ `vendor` (name, email, tables 1-3, game), `buylist` (name, contact, games, desc, photos? no), `signup` (name, seats 1-4, eventId), `newsletter` (email), `restock` (email, productId, productName), `contact` (name, email, message). Body also accepts `website` honeypot. Stores `form:<kind>:<id>` with `{id, kind, at, ip, ...fields, status:"new"}`, emails `NOTIFY_EMAIL` when configured. Returns `{ok, id, emailed}`. 5 / 10 min per IP per kind. |
| GET | `/forms?kind=&status=&limit=` | staff | Inbox, newest first |
| PUT | `/forms/:kind/:id` | staff | `{status:"new"|"done"|"archived", note?}` |
| POST | `/checkout` | – | `{lines:[{id, name, price, qty, game?}], fulfillment:"pickup"|"ship", email?, note?}` → creates a Square Payment Link (ad-hoc line items, `SQUARE_ENV` sandbox/production). Returns `{url, orderId, mock:false}`. Without Square configured returns `{url:null, mock:true, orderId, total}` so the UI can show a demo confirmation. Validates qty 1-20, price 0.01-10000, ≤ 40 lines. |
| POST | `/square/webhook` | Square signature | Verifies `x-square-hmacsha256-signature` (HMAC-SHA256 of `SQUARE_WEBHOOK_URL + body` with `SQUARE_WEBHOOK_SIGNATURE_KEY`). On `inventory.count.updated`, `order.created`, `payment.updated` appends to `alerts` (`{id, at, ch:"TCGplayer"|"Square", msg, source, ack:false}`), keeps the raw event under `square:event:<id>` for 7 days. Returns 200 always once verified; 401 on bad signature. |
| GET | `/alerts` | staff | `{alerts:[...open first...], open:n}` |
| POST | `/alerts` | staff | `{msg, ch}` → creates a manual alert (used when stock is edited on the site) |
| POST | `/alerts/:id/ack` | staff | mark done |
| GET | `/credit?q=` | staff | search customers by name/phone → `{customers:[{id,name,phone,balance,updatedAt}]}` (≤ 50) |
| POST | `/credit` | staff | `{name, phone}` → create customer |
| POST | `/credit/:id/add` | staff | `{cash, note?}` → adds `cash × (1 + config.buy.creditBonus)`; `{redeem:true, amount}` subtracts. Returns `{customer, entry}`; log under `credit:log:<id>` |
| GET | `/credit/:id` | staff | customer + last 50 ledger entries |
| GET | `/credit/lookup?phone=` | – | public balance check: returns `{found, balance}` only when the phone matches exactly (last 4 digits masked name); rate limited 10 / 10 min |
| GET | `/live` | – | `{live:config.live, spots:{taken:[n…], price, total}, viewers}` |
| POST | `/live/spots/claim` | – | `{spot, name?}` → claims spot n if free (atomic-ish via KV read-modify-write + re-check), returns `{ok, spot, taken:[…]}`; 409 when taken. Claims expire after 6 h unless `POST /live/spots/:n/confirm` (staff) |
| POST | `/live/spots/reset` | staff | clear all claims |
| GET | `/live/chat?since=<ts>` | – | `{messages:[{id, at, user, text, sys?}]}` newest last, max 60 |
| POST | `/live/chat` | – | `{user, text}` → append (text ≤ 200 chars, user ≤ 24, 20 msgs / min per IP, basic profanity/URL strip) |
| POST | `/live/viewers` | – | heartbeat `{sid}` → counts distinct sids in the last 60 s; returns `{viewers}` |
| GET | `/inventory/status` | – | `{generated, products, units, lastRun:{at, ok, message}, syncing}` — `generated` read from `SITE_URL + inventory-summary.json` (cached 5 min in KV) |
| POST | `/inventory/sync` | admin | Dispatches the `inventory.yml` GitHub Action via `POST /repos/{GITHUB_REPO}/actions/workflows/{GITHUB_WORKFLOW}/dispatches`; returns `{ok, dispatched:true}` or `{ok:false, reason}` when no `GITHUB_TOKEN` |
| GET | `/price?game=pk|op|mtg&q=` | – | Card price lookup for the buylist estimator: `{results:[{name, set, number?, img?, market, source:"scryfall"|"pokemontcg"|"inventory", url?}]}` ≤ 10. MTG → Scryfall `cards/search`; Pokemon → pokemontcg.io v2 (`POKEMONTCG_API_KEY` optional); One Piece / others → the shop's own inventory-summary/inventory (market field). Cached 6 h per query. 30 / 10 min per IP |

`scheduled()` (daily 11:00 UTC): prunes expired spot claims, trims chat to 60,
clears the inventory status cache.

## Additions made during the build (beyond the table above)

- `POST /checkout` also returns `subtotalCents`, `shippingCents`, `reason`; answers **409** `{error, items:[{id, available, reason}]}`
  when a `tcg-<id>` line exceeds inventory stock, **502** with Square's code/detail on Square errors. Shipping: `SHIPPING_CENTS`
  (default 499) flat, free at `FREE_SHIPPING_CENTS` (default 10000). Orders are kept 7 days: `GET /checkout/orders` (staff),
  `GET /checkout/orders/:id` (public, status only).
- `POST /live/spots/claim` body is `{spot, name?, sid}`; `POST /live/spots/release {spot, sid}` frees a spot when the sid matches
  (staff token frees any) → `{ok, released, taken, mine}`; `GET /live?sid=` adds `spots.mine`, `spots.open`, `spots.claims`;
  `POST /live/spots/:n/confirm` (staff) accepts `{name?}`; `POST /live/chat` accepts `{sys:true}` from staff; `GET /live/chat`
  returns `{messages, now, viewers}`.
- `GET /alerts?status=open|acked`; alerts dedupe identical open messages (`count` increments). Webhook alerts carry
  `source:"square:<event>"` and `sku:"tcg:<productId>"`.
- `GET /inventory/status` also returns `hooks` (last webhook per event type), `square:{configured, env, webhook}`,
  `github:{configured, repo, workflow}`, `cached`, `unreachable`; `POST /inventory/sync` answers **429** when a run was
  dispatched in the last few minutes. `GITHUB_REF` (default `main`) picks the branch.
- Forms accept and store extra optional fields: vendor `phone, show, waitlist`; signup `eventName, date, contact`;
  buylist `photosUrl`; newsletter `topic`. Unknown fields are dropped, never rejected.
