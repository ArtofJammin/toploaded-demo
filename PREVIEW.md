# Collector preview

The collector design was approved for promotion to the main site on September 9, 2026. The separate preview remains a historical comparison; use https://artofjammin.github.io/toploaded-demo/ for the current site.

Source: [collector-preview branch](https://github.com/ArtofJammin/toploaded-demo/tree/codex/collector-preview). The separate `toploaded-design-preview` repository hosts a static copy for comparison; it is not a replacement production deployment. Its inventory is a snapshot, not a scheduled live refresh.

Run `node tools/dev-server.mjs --port 8790` to preview locally. Build with `node tools/build.mjs`; verify with `node tools/check.mjs`.

The new homepage uses the existing inventory summary, product quick view, wishlist, calendar, and pack-opening features. The full inventory is fetched only when a feature needs it.

The historical preview retains `noindex` metadata and its separate `tl-collector-preview-` browser-storage namespace. The main site removes the preview tags and comparison strip and uses its original `tl-` namespace, preserving existing production browser settings and carts.

The preview deployment contains only the static site and its public assets. No API credentials, local notes, development data, or scheduled inventory workflows are published to the preview repository.

September 9 update: full-width responsive header, hamburger menu, single-pass navigation, theme-aware discovery panels and a customer account portal. Customer email sign-in and private credit history have backend implementations, but stay disabled on the static preview until the Worker and email sender are connected. See [launch checklist](https://github.com/ArtofJammin/toploaded-demo/blob/codex/collector-preview/LAUNCH-CHECKLIST.md) for the explicit go-live requirements.

Rip a Pack is a free simulation, not a physical pack opening or a giveaway. The homepage, setup, reveal, results and shared text now state that no real pack is opened and no cards or prizes are awarded. Prices are catalog references, not winnings or store credit; physical products are sold separately through a separate checkout. The simulator does not add items to the cart automatically.

Game navigation now uses shared inline SVG icons: Poké Ball, straw hat, Planeswalker, mecha helmet, and the existing ring motif for Lorcana. The universe shelf has theme-aware badges, keyboard/hover feedback, and a mobile two-column layout. The same symbols appear in shop filters and simulator game selection, without an external icon font or CDN. Source credits and license links are available in the site footer.

The collector panels and pack artwork now use the selected theme's accent and surface colors, without the purple override. Product photos retry once through TCGplayer's alternate image endpoint before showing an explicit "Photo unavailable" label. The scrolling wall starts its whole image set near the viewport rather than relying on per-image lazy loading inside the animation. External image availability still depends on TCGplayer and the visitor's network; photos are not hosted in this repository.
