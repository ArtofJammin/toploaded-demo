import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function boot() {
  const listeners = {}, images = [], events = {};
  const document = {addEventListener: (name, fn) => listeners[name] = fn,
    querySelectorAll: () => images,
    createElement: () => ({attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }})};
  const TL = {on: (name, fn) => events[name] = fn};
  vm.runInNewContext(readFileSync(new URL('../../src/js/07-card-images.js', import.meta.url), 'utf8'),
    {TL, document, requestAnimationFrame: fn => fn()});
  function photo(src, name = 'Test card') {
    const classes = new Set(['card-img']);
    const parent = {replaceChild(next, old) { this.replacement = next; old.parentNode = null; }};
    const img = {tagName: 'IMG', src, currentSrc: '', alt: name, dataset: {}, complete: false, naturalWidth: 0,
      parentNode: parent, classList: {contains: c => classes.has(c), add: c => classes.add(c)},
      style: {removeProperty() {}}, closest: () => null, removeAttribute() {},
      getAttribute: key => key === 'src' ? img.src : null};
    images.push(img);
    return {img, parent};
  }
  return {TL, listeners, photo};
}

test('a failed TCGplayer photo gets exactly one alternate source before a truthful fallback', () => {
  const {TL, photo} = boot();
  const {img, parent} = photo('https://tcgplayer-cdn.tcgplayer.com/product/88598_in_400x400.jpg', '<Card & name>');
  assert.equal(TL.cardImages.failed(img), true);
  assert.equal(img.src, 'https://product-images.tcgplayer.com/fit-in/400x400/88598.jpg');
  assert.equal(img.dataset.imageState, 'retrying');
  assert.equal(parent.replacement, undefined);
  assert.equal(TL.cardImages.failed(img), true);
  assert.equal(parent.replacement.textContent, 'Photo unavailable');
  assert.equal(parent.replacement.attrs['aria-label'], '<Card & name>: photo unavailable');
  assert.equal(TL.cardImages.failed(img), false, 'no retry loop after both sources fail');
});

test('successful cached photos become visible and retry errors cannot reach old hide handlers', () => {
  const {TL, photo, listeners} = boot();
  const {img} = photo('https://tcgplayer-cdn.tcgplayer.com/product/88598_in_200x200.jpg');
  let stopped = false;
  listeners.error({target: img, stopImmediatePropagation: () => stopped = true});
  assert.equal(stopped, true);
  img.complete = true; img.naturalWidth = 200;
  TL.cardImages.scan();
  assert.equal(img.dataset.imageState, 'loaded');
  assert.equal(img.classList.contains('ok'), true);
  assert.equal(TL.cardImages.alternate('https://tcgplayer-cdn.tcgplayer.com.evil.test/product/1_in_200x200.jpg'), '');
});

test('scrolling wall loads as a group and collector panels no longer have a purple override', () => {
  const wall = readFileSync(new URL('../../src/js/20-hero.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../src/css/98-collector.css', import.meta.url), 'utf8');
  assert.match(wall, /data-wall-src=/);
  assert.match(wall, /loading="eager" fetchpriority="low"/);
  assert.match(wall, /if\(wallImagesStarted\) wallLoadImages\(\)/);
  assert.doesNotMatch(wall, /onerror=/);
  assert.match(css, /--collect-play-bg:var\(--surface2\)/);
  assert.doesNotMatch(css, /collect-purple|#c6b7f3|#211835|#ddcef9|#9e8ac6|#bdaaeb/);
});
