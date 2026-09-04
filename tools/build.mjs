#!/usr/bin/env node
// Builds the Top Loaded site from modular source in src/ into two outputs:
//   index.html          - LEAN web build (no embedded demo card art). The live site
//                         loads real inventory.json; demo items fall back to drawn SVG faces.
//   tools/artifact.html - FAT build with demo card art embedded as data URIs, for
//                         publishing as a self-contained artifact.
//
// Source layout (all files concatenated in sorted filename order):
//   src/head.html       - <title>, <meta>, theme bootstrap, font link (emitted first)
//   src/css/*.css       - wrapped in one <style> block
//   src/html/*.html     - page markup: header, views, footer, cart, overlays
//   src/js/*.js         - wrapped in ONE IIFE: (function(){ "use strict"; ... })();
//                         Every js file shares the same closure, so a function declared in
//                         05-products.js is callable from 30-quickview.js. Files run in
//                         filename order at load time (script sits at the end of <body>).
//
// Usage:  node tools/build.mjs [--watch]
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, watch } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const tools = dirname(fileURLToPath(import.meta.url));
const repo = resolve(tools, '..');
const src = join(repo, 'src');

function listSorted(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith(ext)).sort().map(f => join(dir, f));
}
const read = f => readFileSync(f, 'utf8');

function jsonLd(cfg) {
  const days = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  const hours = Object.entries(cfg.hours || {}).filter(([, v]) => v).map(([d, v]) => ({
    '@type': 'OpeningHoursSpecification', dayOfWeek: days[d], opens: v[0], closes: v[1] }));
  return {
    '@context': 'https://schema.org', '@type': 'Store', name: 'Top Loaded Trading Cards',
    url: 'https://artofjammin.github.io/toploaded-demo/', telephone: cfg.phoneRaw, email: cfg.email,
    image: 'https://artofjammin.github.io/toploaded-demo/og-image.png',
    address: { '@type': 'PostalAddress', streetAddress: cfg.address.line1, addressLocality: cfg.address.city, addressRegion: cfg.address.state, postalCode: cfg.address.zip, addressCountry: 'US' },
    openingHoursSpecification: hours,
    sameAs: [cfg.links.facebook, cfg.links.instagram, cfg.links.tcgplayer].filter(Boolean),
    priceRange: '$',
  };
}

export function buildHtml() {
  const head = read(join(src, 'head.html'));
  const css = listSorted(join(src, 'css'), '.css').map(read).join('\n');
  const html = listSorted(join(src, 'html'), '.html').map(read).join('\n');
  const js = listSorted(join(src, 'js'), '.js').map(read).join('\n');
  // config.default.json is the single source of truth for site settings; the worker
  // imports the same file. Inlined so the page renders correct hours/events offline.
  const cfgObj = JSON.parse(read(join(repo, 'config.default.json')));
  const cfg = JSON.stringify(cfgObj);
  const ld = '<script type="application/ld+json">' + JSON.stringify(jsonLd(cfgObj)).replace(/</g, '\\u003c') + '</script>\n';
  const body = html + '\n' +
    '<script id="siteConfig">window.TL_DEFAULT_CONFIG=' + cfg.replace(/</g, '\\u003c') + ';</script>\n' +
    '<script id="cardArtData"></script>\n' +
    '<script>\n(function(){\n  "use strict";\n\n' + js + '})();\n</script>\n';
  return {
    // The web build is a complete standards-mode document.
    page: '<!DOCTYPE html>\n<html lang="en">\n<head>\n' + head + ld + '<style>\n' + css + '</style>\n</head>\n<body>\n' + body + '</body>\n</html>\n',
    // The artifact build stays bare: the artifact host wraps it in its own skeleton.
    bare: head + '<style>\n' + css + '</style>\n\n' + body,
  };
}

const ART_KEYS = ['pk-charizard151', 'pk-pikachuhat', 'pk-tatsugiri', 'pk-iono', 'pk-roaringmoon',
  'op-shanks-op09', 'op-luffy-op05', 'op-boa-op07', 'op-law-op01',
  'mtg-ragavan', 'mtg-sheoldred', 'mtg-onering', 'mtg-bowmasters'];
function dataUri(key) {
  const art = join(tools, 'cardart');
  const jpg = join(art, key + '.jpg'), png = join(art, key + '.png');
  const f = existsSync(jpg) ? jpg : existsSync(png) ? png : null;
  if (!f) throw new Error('missing card art ' + key);
  const mime = f.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,` + readFileSync(f).toString('base64');
}

export function build() {
  const { page, bare } = buildHtml();
  const marker = '<script id="cardArtData"></script>';
  if (!page.includes(marker)) throw new Error('cardArtData marker missing');
  writeFileSync(join(repo, 'index.html'), page);
  const kb = Math.round(statSync(join(repo, 'index.html')).size / 1024);
  console.log(`Built index.html (lean): ${kb} KB`);
  const pairs = ART_KEYS.map(k => JSON.stringify(k) + ':' + JSON.stringify(dataUri(k)));
  const block = '<script id="cardArtData">window.CARD_IMG={' + pairs.join(',') + '};</script>';
  writeFileSync(join(tools, 'artifact.html'), bare.replace(marker, block));
  const mb = (statSync(join(tools, 'artifact.html')).size / 1048576).toFixed(2);
  console.log(`Built tools/artifact.html (fat): ${mb} MB`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  build();
  if (process.argv.includes('--watch')) {
    let t = null;
    const rebuild = () => { clearTimeout(t); t = setTimeout(() => { try { build(); } catch (e) { console.error(e.message); } }, 120); };
    for (const d of [src, join(src, 'css'), join(src, 'html'), join(src, 'js')]) {
      if (existsSync(d)) watch(d, rebuild);
    }
    console.log('Watching src/ for changes...');
  }
}
