# Launch readiness — September 9, 2026

The collector design is approved for the main GitHub Pages site. This publishes the storefront, not a working payments/account backend. Customer login, online payments, shared admin settings and Square sale notifications still require the connections below.

## Implemented in the storefront

- 94%-width desktop header; one row of links; hamburger disclosure below 1180px. Keyboard Escape, outside click, route-change dismissal and resize focus handling.
- Deep-link first paint and a single route transition. Native transitions animate content, not duplicate headers; their completion no longer restarts the CSS entry animation. Inventory loading no longer flashes sample showcase cards before real cards arrive.
- Shared theme tokens for navigation, customer accounts, discovery and trade panels. Intentional pack artwork retains its illustrative colors.
- Customer account screen, email-code authentication API, session logout and private credit-history reads. Store-credit changes remain staff-only; no automatic credit spending at checkout. Browser wishlists remain device-local.
- Admin-only identity-confirmed linking of a customer's email from Staff desk. Old unauthenticated phone balance lookup retired.

## Required before a real launch

1. Deploy the Worker with its KV binding, strict SITE_ORIGIN allowlist, real staff/admin secrets and TOKEN_SECRET. Set the website's tl-api URL. Changing admin settings on the current static preview only changes that browser, not the public site.
2. Configure RESEND_API_KEY and a verified EMAIL_FROM. Test actual delivery, expiration, logout and account linking with consenting staff-owned test email addresses. The public preview does not send codes or simulate a successful login.
3. Have an admin verify and link each customer's email to the correct server-side credit record. Reconcile any old device-local balances manually; do not automatically import demo money.
4. Before multi-counter credit redemption or online credit spending, use transactional ledger updates and idempotency. Current KV read-modify-write balances and KV-based session/code revocation are eventually consistent. The new customer portal is read-only; exact-once code use and globally immediate revocation are not guaranteed by KV.
5. Connect/test Square sandbox checkout, shipping/tax/pickup rules and payment confirmation before enabling production keys. Confirm out-of-stock behavior and cross-channel reconciliation.
6. Replace sample reviews, dashboard sales figures, TBD entry fees, vendor prices/terms, generic Bandai link and any unconfirmed policy promises. Set the next show date and real stream platform.
7. Inventory is scheduled three times daily at 02:17, 10:17 and 18:17 UTC. `Publish site` runs after successful imports so bot commits reach Pages. Admin's disconnected fallback opens GitHub's authenticated Run workflow page; one-click server dispatch requires the Worker and a GitHub token with Actions write permission on this repository.
8. For five-minute after-sale checks, create/bind the optional Cloudflare queues in `api/wrangler.toml`, connect signed Square `payment.updated` webhooks and a Square access token. Map POS variation SKUs explicitly as `tcg:PRODUCT_ID`. Test with Square sandbox before production. These checks report listing observations for staff; they never remove listings or automatically reconcile stock. Queues and KV can redeliver, and five minutes is a minimum delay, not an exact execution guarantee.

## Recommended next

- Real shop and community photography, replacing sample testimonials with permissioned customer quotes.
- Authenticated cross-device wishlist sync and order history only after customer accounts and checkout are verified live.
- A public policies/privacy page that accurately explains purchases, returns, credit, email sign-in and data retention.

## Verification scope

Run `node tools/check.mjs`: source build, script syntax, CSS/ID checks, API and frontend regressions. Account tests mock email delivery; they do not prove real deliverability. Sale checks mock Square, the queue and TCGplayer responses; a read-only live query separately verified the seller/product filter. No real purchases or customer records are created. Launch validation includes a real inventory import and the resulting Pages publication.
