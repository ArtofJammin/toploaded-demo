# Top Loaded TCG API

A single Cloudflare Worker (free tier is enough) that gives the static GitHub Pages
site its dynamic pieces: settings the owner can edit, real form submissions, Square
checkout, Square webhooks → cross-channel alerts, a store-credit ledger, live-break
spots and chat, and an on-demand inventory refresh. The site works without it
(demo mode with localStorage), and lights features up when it can reach `/health`.

## Customer accounts (backend connection required)

The `#/account` page uses a separate customer session, never a staff token or a local demo balance.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/account/status` | Whether KV, RESEND_API_KEY and EMAIL_FROM are configured |
| POST | `/account/code` | `{email}`: emails a random 128-bit code, returns a challenge ID, never the code; identical flow for known and unknown emails |
| POST | `/account/verify` | `{challenge,code}`: 10-minute hashed code, up to five attempts; returns an opaque 12-hour customer session |
| GET | `/account/me` | Customer bearer token only; reads the single ledger matching the verified email. Ambiguous/unlinked emails get no balance. Excludes staff notes, phone numbers and customer IDs |
| POST | `/account/logout` | Deletes the customer session |
| PUT | `/credit/:id/email` | Admin only, `{email,confirmed:true}` after identity verification at the counter; rejects a duplicate linked email |

Set a verified `EMAIL_FROM` and `RESEND_API_KEY` to enable code delivery. No dry-run code is returned or logged. The client stores its customer session in sessionStorage, isolated from staff auth. Email/code endpoints have IP and email rate limits. Balances are private/no-store; customers cannot create credit, redeem it or choose a customer ID.

The old `/credit/lookup?phone=` endpoint now returns 410 to prevent bypassing account sign-in. Staff desk has a linking form for existing customers; device-local demo ledgers are not imported.

Operational limitation: the current KV implementation is eventually consistent, including code consumption and session revocation. Use a strongly consistent session/challenge store if globally immediate single-use/revocation guarantees are required. Ledger writes are also non-transactional; do not enable concurrent or online redemption without transactional storage and idempotency. See [launch checklist](../LAUNCH-CHECKLIST.md). Email delivery is mocked in automated tests and must be validated against the real sender before launch.

## Run locally (no install)

```bash
node tools/dev-server.mjs
```

Serves the site at http://localhost:8787 with the worker mounted at `/api/*` and an
in-memory KV persisted to `tools/.dev-kv.json`. Dev passcodes are `staff` / `admin`.
Copy `api/.dev.vars.example` to `api/.dev.vars` to add real keys.

Tests: `node --test "api/test/*.test.mjs"`

## Catalog-linked live-claim checkout (disabled until connected)

See [sales connection and acceptance](../SALES-CONNECTION.md). `GET /live/checkout/status` reports readiness; `GET /live/catalog?q=` (staff) searches Square variations. `POST /live/claims` may include `squareVariationId`, `tcgProductId` and `fulfillment`. Staff then call `POST /live/claims/:id/checkout` for the private payment link, or `POST /live/claims/:id/cancel-checkout` to cancel an unpaid link. `CLAIM_CHECKOUT_ENABLED=true`, Square, signed webhooks and shared storage are required. Public claims exclude Square IDs and checkout URLs. Payment confirmation is automated only for these linked claims; Square performs their inventory adjustment, not a second manual decrement. The existing ad-hoc `/checkout` cart is unchanged.

`reviews-google.json` contains dated excerpts verified from the public business listing, not Places API content. Google API responses are not persisted. Automatic Google review fetching still requires the Places configuration; its five-star filter cannot be lowered by the general minimum-rating setting.

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

### Optional five-minute after-sale checks

`payment.updated` with status `COMPLETED` schedules a read-only TCGplayer lookup with a 300-second minimum delay using Cloudflare Queues. Unsigned, pending, failed and merely-created orders do not schedule checks. Site checkout IDs map automatically; POS items need a variation SKU or line note beginning `tcg:PRODUCT_ID` (or `tcg-PRODUCT_ID`). For POS orders, the consumer verifies the whole order is completed, so a partial tender is not treated as a fully paid order.

Create `toploaded-sale-checks` and `toploaded-sale-checks-failed` queues, uncomment the producer/consumer declarations in `wrangler.toml`, and deploy the Worker with the real KV binding and Square credentials. Subscribe Square to the exact signed webhook URL. **This is not enabled by publishing GitHub Pages.** Check the account's queue limits/pricing before provisioning. `/health` and Admin show whether the queue and Square credentials are configured, not proof of successful delivery.

The consumer retries transient failures three times, then leaves a staff alert for manual checking. Queue-level failures go to the dead-letter queue for operator inspection. Successful results are kept under `sale-check:result:PAYMENT_ID` for 30 days. Duplicate messages/payment events are suppressed where possible; KV is eventually consistent, so this is not an exactly-once system. No stock, listing, payment or ledger mutation happens in the consumer.

The lookup verifies the product ID and seller key `5c356cdf` against the same marketplace endpoint used by the inventory importer. That endpoint is not a supported partner API contract and can change. An error is never treated as a sold-out listing. A positive result says how many units are shown, not that all conditions/printings were completely enumerated or that the quantity is wrong: the shop may still have copies. Unmapped items need staff review; the code does not guess IDs from card names.

References: [Cloudflare delayed messages/retries](https://developers.cloudflare.com/queues/configuration/batching-retries/), [GitHub bot commits and Pages](https://docs.github.com/en/actions/concepts/security/github_token).

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
| POST | `/checkout` | – | `{lines:[{id, name, price, qty, game?}], fulfillment:"pickup"|"ship", email?, note?}` → creates a Square Payment Link (ad-hoc line items, `SQUARE_ENV` sandbox/production). Returns `{url, orderId, mock:false}`. Without Square configured returns `{url:null, mock:true, orderId, total}` so the UI can show a demo confirmation. Validates qty 1-20, price 0.01-10000, ≤ 40 lines. **Prices and names are never taken from the client**: `tcg-<productId>` lines are priced from inventory.json, `live-spot-<n>` from `config.live.spotPrice` (qty forced to 1); ids are trimmed/lower-cased first. With Square configured any other id is a **400** and an unreachable inventory.json is a **503**; in mock mode such lines are accepted with the client's figures and flagged `trusted:false`. |
| POST | `/square/webhook` | Square signature | Verifies `x-square-hmacsha256-signature` (HMAC-SHA256 of `SQUARE_WEBHOOK_URL + body` with `SQUARE_WEBHOOK_SIGNATURE_KEY`). On `inventory.count.updated`, `order.created`, `payment.updated` appends to `alerts` (`{id, at, ch:"TCGplayer"|"Square", msg, source, ack:false}`), keeps the raw event under `square:event:<id>` for 7 days. Returns 200 always once verified; 401 on bad signature. |
| GET | `/alerts` | staff | `{alerts:[...open first...], open:n}` |
| POST | `/alerts` | staff | `{msg, ch}` → creates a manual alert (used when stock is edited on the site) |
| POST | `/alerts/:id/ack` | staff | mark done |
| GET | `/credit?q=` | staff | search customers by name/phone → `{customers:[{id,name,phone,balance,updatedAt}]}` (≤ 50) |
| POST | `/credit` | staff | `{name, phone}` → create customer |
| POST | `/credit/:id/add` | staff | `{cash, note?}` → adds `cash × (1 + config.buy.creditBonus)`; `{redeem:true, amount}` subtracts. Returns `{customer, entry}`; log under `credit:log:<id>` |
| GET | `/credit/:id` | staff | customer + last 50 ledger entries |
| GET | `/credit/lookup?phone=` | – | retired: 410, directs customers to verified account sign-in; never reveals balances |
| GET | `/live` | – | `{live:config.live, spots:{taken:[n…], price, total}, viewers}` |
| POST | `/live/spots/claim` | – | `{spot, name?}` → claims spot n if free (atomic-ish via KV read-modify-write + re-check), returns `{ok, spot, taken:[…]}`; 409 when taken, 409 `{reason:"limit"}` once a sid holds 3 unpaid spots (an IP 6); 10 / min per IP. Claims expire after 6 h unless `POST /live/spots/:n/confirm` (staff) |
| POST | `/live/spots/reset` | staff | clear all claims |
| GET | `/live/chat?since=<ts>` | – | `{messages:[{id, at, user, text, sys?}]}` newest last, max 60 |
| POST | `/live/chat` | – | `{user, text}` → append (text ≤ 200 chars, user ≤ 24, 20 msgs / min per IP, basic profanity/URL strip) |
| POST | `/live/viewers` | – | heartbeat `{sid}` → counts distinct sids in the last 60 s (at most 3 per IP; 12 / min per IP); returns `{viewers}` |
| GET | `/inventory/status` | – | `{generated, products, units, lastRun:{at, ok, message}, syncing}` — `generated` read from `SITE_URL + inventory-summary.json` (cached 5 min in KV) |
| POST | `/inventory/sync` | admin | Dispatches the `inventory.yml` GitHub Action via `POST /repos/{GITHUB_REPO}/actions/workflows/{GITHUB_WORKFLOW}/dispatches`; returns `{ok, dispatched:true}` or `{ok:false, reason}` when no `GITHUB_TOKEN` |
| GET | `/price?game=pk|op|mtg&q=` | – | Card price lookup for the buylist estimator: `{results:[{name, set, number?, img?, market, source:"scryfall"|"pokemontcg"|"inventory", url?}]}` ≤ 10. MTG → Scryfall `cards/search`; Pokemon → pokemontcg.io v2 (`POKEMONTCG_API_KEY` optional); One Piece / others → the shop's own inventory-summary/inventory (market field). Cached 6 h per query. 30 / 10 min per IP |

`scheduled()` (daily 11:00 UTC): prunes expired spot claims, trims chat to 60,
clears the inventory status cache.

## Additions made during the build (beyond the table above)

- `POST /checkout` also returns `subtotalCents`, `shippingCents`, `reason` and `lines:[{id, name, price, qty, trusted}]` (the
  server-priced cart); answers **409** `{error, items:[{id, available, reason}]}` when a `tcg-<id>` line exceeds inventory stock
  or a `live-spot-<n>` does not exist / has no price, **502** with Square's code/detail on Square errors. Shipping: `SHIPPING_CENTS`
  (default 499) flat, free at `FREE_SHIPPING_CENTS` (default 10000). Orders are kept 7 days with `priced` ∈ `inventory|mixed|client`
  and a `trusted` flag per line: `GET /checkout/orders` (staff, everything but the IP), `GET /checkout/orders/:id` (public) returns
  only `{order:{id, status, total, at, fulfillment}}` — never the note, email, lines or Square link.
- `POST /live/spots/claim` body is `{spot, name?, sid}`; `POST /live/spots/release {spot, sid}` frees a spot when the sid matches
  (staff token frees any) → `{ok, released, taken, mine}`; `GET /live?sid=` adds `spots.mine`, `spots.open`, `spots.claims`;
  `POST /live/spots/:n/confirm` (staff) accepts `{name?}`; `POST /live/chat` accepts `{sys:true}` from staff; `GET /live/chat`
  returns `{messages, now, viewers}`.
- `GET /alerts?status=open|acked`; alerts dedupe identical open messages (`count` increments). Webhook alerts carry
  `source:"square:<event>"` and `sku:"tcg:<productId>"`.
- `GET /inventory/status` also returns `hooks` (last webhook per event type), `square:{configured, env, webhook}`,
  `github:{configured, repo, workflow}`, `cached`, `unreachable`; `POST /inventory/sync` answers **429** when a run was
  dispatched in the last few minutes. `GITHUB_REF` (default `main`) picks the branch.
- Forms accept and store extra optional fields: vendor `phone, show, waitlist`; signup `eventName, date`;
  buylist `photosUrl`; newsletter `topic`. Unknown fields are dropped, never rejected.
- `signup` needs at least one of `contact`, `email`, `phone` (400 otherwise); all three are stored, `contact` falls back
  to the email or phone, and the notification email lists them (reply-to set when there is an email).
