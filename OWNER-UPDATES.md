# Owner-requested update — September 13, 2026

## Included

- Home: removed the Buy Desk ticker and duplicate featured-products section; kept the moving card wall. Collection trade-in now sits above Play Nights, with Find Your Universe below it. Each scheduled game has a shop-time countdown.
- Discovery and the free pack simulator: complete catalog snapshots for the selected set, including unstocked cards. Exact TCGplayer product IDs drive stock badges. No real packs, prizes or purchases result from the simulator.
- Card Show: countdown at the top; removed Past Shows. Admin → Card Show Floor Plan edits booth positions, sizes and types, validates overlaps/bounds, and publishes a labeled heatmap. TCG/Sports/Mixed percentages count vendor booths, excluding entry/food areas. An empty layout is explicitly unpublished.
- Live Stream: owner-provided wording and staff-confirmed card claims replace numbered pre-claim spots. Logged-in staff use the claim desk on the Live page. Viewers see updates within the five-second polling interval while the page is visible. Posting a claim does not take payment or adjust stock.
- Buy Collections: removed the estimator.
- Reviews: attributed, owner-curated highlights with a positive-review disclosure; optional Google Places connection. No sample customer quotes are published.

## Still requires the shop / deployment

1. Supply the real show date, booth layout and vendor assignments. No percentages or bookings were invented. The fallback show date remains clearly estimated.
2. Supply genuine TCGplayer review excerpts with author attribution/source links, or configure Google Places with the shop's Place ID. Google Places supplies a limited selection, not the entire review history. Automatic TCGplayer review scraping is not implemented; owner-curated TCGplayer reviews are supported.
3. Deploy the Cloudflare API described in `api/README.md`, replace the KV namespace placeholder and configure production credentials. Set the deployed URL in the `tl-api` meta tag and rebuild. The checked-in frontend has no production API URL: **admin saves on GitHub Pages are device-only until connected**.
4. The included `LIVE_CLAIMS` SQLite Durable Object binding/migration is required for shared claims. It serializes concurrent posts, keeps at most 100 recent claims and stops displaying claims older than 30 days. Local development uses an in-memory stand-in. This board is a public stream-handle display, not an order ledger.
5. For Google: set the worker secret `GOOGLE_PLACES_API_KEY`, configure `reviews.googlePlaceId` in Admin, and set `GOOGLE_REVIEWS_TERMS_URL` / `GOOGLE_REVIEWS_PRIVACY_URL` to the shop's published policies. Confirm API restrictions and billing budget before enabling. Provider content is not persisted; source/author attribution and filtering disclosure are displayed. Follow [Google Places policies](https://developers.google.com/maps/documentation/places/web-service/policies).
6. Enter the actual stream platform, URL and schedule in Admin. Old sample rip/break schedules have been removed rather than advertised as confirmed events.

## Maintenance and checking

- Existing inventory refresh remains three times daily plus Admin Sync Now (when the API/GitHub token is connected).
- `tools/update-catalog.mjs` publishes same-origin TCGCSV checklists. `Refresh catalog` runs each morning and can be dispatched manually; downloads are gated to at most once per 24 hours. The existing last-good files remain intact if fetching fails. `Publish site` packages these public JSON files and deploys after successful catalog/inventory workflows.
- Catalog assets total approximately 13 MB across individual set files. The page loads only the small index and a selected set, not the whole catalog.
- Run `node tools/check.mjs`. For disposable UI testing use `node tools/dev-server.mjs --port 8791 --fresh --ephemeral --no-watch` to avoid altering saved development data.
- PWA/install prompts remain deferred until after the sale.
