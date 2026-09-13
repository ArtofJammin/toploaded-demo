# Owner-requested update — September 13, 2026

## Included

- Home: removed the Buy Desk ticker and duplicate featured-products section; kept the moving card wall. Collection trade-in now sits above Play Nights, with Find Your Universe below it. Each scheduled game has a shop-time countdown.
- Discovery and the free pack simulator: complete catalog snapshots for the selected set, including unstocked cards. Exact TCGplayer product IDs drive stock badges. No real packs, prizes or purchases result from the simulator.
- Card Show: countdown at the top; removed Past Shows. Admin → Card Show Floor Plan edits booth positions, sizes and types, validates overlaps/bounds, and publishes a labeled heatmap. TCG/Sports/Mixed percentages count vendor booths, excluding entry/food areas. An empty layout is explicitly unpublished.
- Live Stream: owner-provided wording and staff-confirmed card claims replace numbered pre-claim spots. Logged-in staff use the claim desk on the Live page. Viewers see updates within the five-second polling interval while the page is visible. Posting a claim does not take payment or adjust stock.
- Buy Collections: removed both the estimator and online quote form. Buying categories, cash/credit details and large-collection contact remain; all offers direct customers to the store. The home FAQ matches this policy.
- Reviews: three genuine, attributed five-star TCGplayer highlights now refresh each morning, with a selection disclosure, review dates and a link to the full feedback. Owner-curated highlights and the optional Google Places connection remain available. No sample customer quotes are published.

## Still requires the shop / deployment

1. Supply the real show date, booth layout and vendor assignments. No percentages or bookings were invented. The fallback show date remains clearly estimated.
2. Optionally configure Google Places with the shop's Place ID. The automatic TCGplayer highlights work without a backend account; Google Places still requires the configuration below and supplies a limited selection, not the entire review history.
3. Deploy the Cloudflare API described in `api/README.md`, replace the KV namespace placeholder and configure production credentials. Set the deployed URL in the `tl-api` meta tag and rebuild. The checked-in frontend has no production API URL: **admin saves on GitHub Pages are device-only until connected**.
4. The included `LIVE_CLAIMS` SQLite Durable Object binding/migration is required for shared claims. It serializes concurrent posts, keeps at most 100 recent claims and stops displaying claims older than 30 days. Local development uses an in-memory stand-in. This board is a public stream-handle display, not an order ledger.
5. For Google: set the worker secret `GOOGLE_PLACES_API_KEY`, configure `reviews.googlePlaceId` in Admin, and set `GOOGLE_REVIEWS_TERMS_URL` / `GOOGLE_REVIEWS_PRIVACY_URL` to the shop's published policies. Confirm API restrictions and billing budget before enabling. Provider content is not persisted; source/author attribution and filtering disclosure are displayed. Follow [Google Places policies](https://developers.google.com/maps/documentation/places/web-service/policies).
6. Enter the actual stream platform, URL and schedule in Admin. Old sample rip/break schedules have been removed rather than advertised as confirmed events.

## Maintenance and checking

- The floor guide borrows Marketfloor's interaction pattern: vendor search/category filters, selectable booth details, pan, zoom and fit-to-floor. Admin has click-to-place, drag/arrow-key movement, rotation, a single-booth inspector and collision checks. The Hilton first-floor reference diagram is reused from Marketfloor with its source attribution. The editable room follows the Triple Crown Ballroom's published 96 × 41 ft proportions; grid allocations are not physical table measurements or approved aisle clearances. This is **not** a live import of Marketfloor vendor assignments. Real assignments still need to be supplied and published. An Admin draft can be downloaded before shared publishing is connected.
- The unconfirmed sample booking count has been removed. Leave the booked field blank until confirmed; the public booking meter stays hidden.
- `Refresh reviews` runs daily at 09:45 UTC and supports an immediate manual refresh. It reads the shop's public TCGplayer feedback without credentials and saves only short comments, masked public names, dates, stars and the source link—never order/account IDs. At most three complete comments and 25 words total are published. Failed requests preserve the last-good snapshot; the frontend hides automatic highlights after 30 days without a successful refresh. This public provider endpoint may change, so failed Actions need attention.

- Existing inventory refresh remains three times daily plus Admin Sync Now (when the API/GitHub token is connected).
- `tools/update-catalog.mjs` publishes same-origin TCGCSV checklists. `Refresh catalog` runs each morning and can be dispatched manually; downloads are gated to at most once per 24 hours. The existing last-good files remain intact if fetching fails. `Publish site` packages these public JSON files and deploys after successful catalog/inventory workflows.
- Catalog assets total approximately 13 MB across individual set files. The page loads only the small index and a selected set, not the whole catalog.
- Run `node tools/check.mjs`. For disposable UI testing use `node tools/dev-server.mjs --port 8791 --fresh --ephemeral --no-watch` to avoid altering saved development data.
- PWA/install prompts remain deferred until after the sale.
