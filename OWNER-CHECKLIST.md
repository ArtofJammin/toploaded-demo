# Owner checklist — verified September 13, 2026

These statuses distinguish delivered page changes from services that still need the shop's accounts or confirmed information. No live payment has been taken in testing.

| Owner request | Result |
| --- | --- |
| Remove Home Buy Desk | Removed, including its ticker. |
| Expand Play Nights and show a clock for each game | One clock per **scheduled** game: Pokémon, One Piece and Gundam. Additional scheduled games appear automatically. No Magic night was invented. |
| Remove Home Card Show countdown; move it to Card Show | Home countdown removed; show timer is at the top of Card Show. Next show date still needs confirmation; the fallback is labeled estimated. |
| Find Your Universe below Play Nights | In the requested order. |
| Make Room for What's Next above Play Nights | In the requested order; the binder banner was left here for the owner to decide. |
| Meet Your Next Favorite uses any card in the selected set | Complete same-origin set checklists; random selection is not stock-only. Browser test drew an unstocked Base Set card. |
| Chase the Feeling / Rip a Pack uses complete sets | Uses the catalog-backed simulator; no real pack is opened or card awarded. Simulation rules are labeled, not represented as manufacturer odds. |
| Badge cards stocked by the shop | Exact product-ID stock matching; “In stock now” only when the current inventory confirms it. |
| Remove The Good Stuff, In Stock; retain In the Case Right Now | Duplicate featured section removed; moving card wall retained. |
| Positive Google / TCGplayer testimonials | Genuine attributed five-star highlights are shown. TCGplayer refreshes daily. Two Google excerpts are currently browser-verified saved highlights; automatic Google updates still require the provider connection. No lower-star Google reviews pass the filter. |
| Remove Rip & Ship; keep Streaming From the Shop Floor | Done. |
| Live Breaks → Live Stream and requested description | Done, including the two-business-day shipping wording. |
| Pre-Claim → Live Stream Claims, updating in real time | Board and staff posting delivered, with five-second visible-page refresh. **Shared public operation still needs the backend.** |
| Remove Past Shows | Removed. |
| Floor Plan with TCG / Sports percentages and heatmap | Hilton reference plus proportional editor and category-colored, searchable vendor guide. Percentages derive from entered vendor booths, not fabricated bookings. Actual vendor assignments still need supplying/publishing. |
| Remove collections estimator | Estimator and online quote form removed. Buying categories direct customers to in-store offers. |
| $30 per vendor table | One $30, two $60, three $90. |
| Collect claim payment and remove sold inventory | Square catalog search, private payment links, signed paid-order verification and Square-managed stock reduction are implemented behind a disabled activation flag. **Not live yet.** See `SALES-CONNECTION.md`; TCGplayer write access and ordinary-cart SKU mapping are separate remaining integration work. |

## Verification

- `node tools/check.mjs`: 92 API tests and 23 frontend regression tests pass (115 total), plus build, syntax and DOM-ID checks. One existing warning references removed optional ticker/featured IDs and dynamically generated game icons.
- Browser: requested Home order, three changing game clocks, whole-set unstocked discovery, five genuine review cards, $30/$60/$90 pricing, top-of-show timer, staff posting and pre-activation payment gating.
- Mobile: 390px viewport, no page overflow in the review section; both Google excerpts retain star and source attribution.
- Payment tests use mocks only: access control, exact catalog linkage, tracked/in-stock validation, concurrent last-unit reservations, retry reuse, cancellation acknowledgement, signed full-payment checks, stale failure events and recovery when the checkout index is missing.

## Not a production-readiness sign-off

The public GitHub page still has no production Worker URL. Shared Admin publishing, claims, payment collection, credit accounts and email cannot be called operational until the owning accounts are connected and tested. Google automatic refresh similarly needs its provider setup. Real vendor assignments and the next show date are still owner inputs.

PWA/install prompts remain deferred. No changes were made to the binder section's placement after the owner-decision request.
