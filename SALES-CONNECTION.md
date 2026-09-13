# Sales connection — prepared, not activated

The static GitHub site cannot itself receive private payment webhooks or change a seller's inventory. This release prepares the Square claim workflow behind `CLAIM_CHECKOUT_ENABLED=false`. No real payment was submitted during development.

## Staff workflow after activation

1. Search the connected Square catalog on Live → Staff claim desk. Select the exact condition/printing; each claim is one unit. Review the agreed price and shipping/pickup choice.
2. Set aside the physical card and confirm the claimant's public stream handle. Post the claim, then choose **Get payment link**.
3. Send the link privately to that buyer. Payment details and the checkout URL never appear on the public claims board. Square collects payment and shipping information.
4. A signed `payment.updated` webhook verifies the Square order, location, amount due, variation, quantity and price before marking the claim paid. The board updates within five seconds while open.
5. The order references the actual Square catalog variation, with inventory tracking enabled. Square owns the stock deduction; the webhook does **not** subtract again. Staff mark paid claims shipped after fulfillment.

There is one durable checkout intent per claim. Retrying a timed-out request uses the same Square idempotency key. Outstanding claim reservations are serialized to prevent two claims taking the same last available unit. A cancellation releases its reservation only after Square confirms that the unpaid checkout order was cancelled. Payment-managed claims cannot be manually marked paid or reverted to unpaid. Refund paid orders in Square; automatic refund-to-board reconciliation is not included yet.

## One-time connection / acceptance checklist

- Deploy the Worker with the real KV namespace, `LIVE_CLAIMS` Durable Object, private staff/admin credentials and token secret.
- Set the Square environment, access token and location. Use Sandbox first; verify the account/location and USD currency. The app needs Catalog/Inventory read and Orders/Payments access appropriate to hosted checkout. Never put credentials in page settings or Git.
- Set the exact webhook URL and signature secret; subscribe to `payment.updated` and the existing inventory/order events. Put the Worker URL in the frontend `tl-api` meta tag and rebuild.
- In Square, confirm real catalog variations, inventory tracking, opening stock, item tax rules and delivery settings. The claim link uses the staff-agreed price plus configured shipping and Square catalog taxes. Do not assume those commercial settings are correct just because a test passes.
- Set `CLAIM_CHECKOUT_ENABLED=true` in Sandbox. Test success, declined payment, duplicate click, lost response/retry, cancellation, two simultaneous last-unit claims, wrong location, tax/shipping totals and a refund. Verify the real Square stock count after payment, including pickup orders. Mocked automated tests do not replace this acceptance run.
- Only then connect production and enable the feature. Keep real checkout off until the owner signs off.

## Important inventory boundary

Square automatically adjusts **Square** inventory for catalog-linked sales. The public TCGplayer inventory importer cannot write TCGplayer listings. Automatic cross-channel removal requires an authorized seller connector and exact SKU mapping (product, condition, printing and language), not a name match. TCGplayer's public documentation currently says it is not granting new API access.

Until that connection is verified, reserve stream cards out of other selling channels and update their TCGplayer listings manually. A Square/POS or TCGplayer sale can race a pending site claim; this is not a global multi-channel stock lock. The existing optional queue checks TCGplayer at least five minutes after a paid sale and alerts staff, but does not change the listing.

The ordinary shop cart still uses the existing TCGplayer-snapshot/ad-hoc checkout path; it has **not** been converted into an exact condition-level Square catalog map. Do not enable broad production checkout under the assumption that this claim feature also solves that mapping. Store-credit redemption, table-booking payments and automatic refunds are separate workflows, not enabled by this release.

References: [Square inventory adjustments](https://developer.squareup.com/docs/inventory-api/how-it-works), [catalog-linked orders](https://developer.squareup.com/docs/orders-api/what-it-does), [payment-link cancellation](https://developer.squareup.com/reference/square/checkout-api/delete-payment-link), [TCGplayer API access](https://docs.tcgplayer.com/docs/getting-started).
