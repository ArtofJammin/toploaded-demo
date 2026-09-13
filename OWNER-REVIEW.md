# Top Loaded — owner review

September 13, 2026 · [Open the updated site](https://artofjammin.github.io/toploaded-demo/)

## Changes ready to review

- **Home:** Buy Desk and the duplicate stock section removed. Collection trade-in sits above the expanded Play Nights area, followed by Find Your Universe. Each scheduled game has a countdown. The moving card wall stays.
- **Card discovery:** random cards come from complete set catalogs, not just shop stock. Available cards receive an in-stock badge.
- **Reviews:** genuine five-star TCGplayer highlights refresh every morning. Two five-star Google excerpts verified on the supplied business listing are included with author/source links and a verification date. They are explicitly saved highlights, not a live Google feed; the automatic Google provider still needs activation.
- **Live:** updated to “Live Stream” and the requested card-show-style description. The claims board, Square catalog search, private payment links and signed-payment confirmation are built and tested. Payment-linked Square inventory is supported; production operation still needs the sales connection/acceptance steps.
- **Card Show:** countdown moved to the top; Past Shows removed. The Hilton first-floor reference and Triple Crown Ballroom proportions are included. The Marketfloor-style vendor guide supports TCG/Sports percentages, category colors, search, booth details and zoom. Admin supports positioning, resizing, rotating and downloading a layout draft.
- **Rip a Pack:** clearly a free digital simulator. No real pack, purchase, prize or ownership of the displayed cards.
- **We Buy Collections:** advertises buying categories and directs people to the shop. Both the estimator and online quote form are removed.

## Needed before operational sign-off

1. **Confirm the next Hilton show date and vendor assignments.** Table pricing is confirmed at **$30 per table** ($60 for two, $90 for three). The hotel reference is available, but no vendor placements or booking percentages have been invented. An estimated date is not a confirmed show announcement.
2. **Connect the production backend.** Until connected, Admin changes on the public site save on that device only—not for every visitor. Shared claims, customer sign-in/credit, email delivery and Admin inventory dispatch need the appropriate backend/service credentials. Choose the owning Cloudflare account and production staff/admin credentials privately.
3. **Confirm the live platform and schedule; activate the sales connection when ready.** See `SALES-CONNECTION.md`. A linked, paid claim reduces Square catalog stock through Square; automatic TCGplayer removal still requires its authorized connector. The ordinary shop cart is not yet an exact-SKU Square integration.
4. **Automatic Google reviews:** supply the shop's Place ID and configure the provider connection and policy links. Five-star-only filtering is enforced. The public-page automated fetch returned a JavaScript-only page, so it is not advertised as a working scraper. Verified Google excerpts are hidden after 30 days without renewal; TCGplayer highlights are already automatic.

The floor editor is an organizer's planning tool, not a venue-approved safety plan. Confirm exits, aisles, table sizes and clearance requirements with the Hilton before publishing assignments.

PWA/app-install prompts remain deferred until after the sale.
