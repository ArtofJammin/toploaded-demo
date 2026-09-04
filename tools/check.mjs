#!/usr/bin/env node
// Repo health check: builds the site, syntax-checks the assembled JS, flags
// duplicate element ids and JS references to ids that no HTML defines, and runs
// the API tests.  Exit code 1 on any hard failure.
//   node tools/check.mjs [--no-tests]
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { build } from './build.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0, warnings = 0;
const fail = (m) => { failures++; console.log('FAIL  ' + m); };
const warn = (m) => { warnings++; console.log('warn  ' + m); };

build();
const html = readFileSync(join(repo, 'index.html'), 'utf8');

// 1. JS syntax (the last <script> is the app IIFE)
const scripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)].filter(m => !/type="(application\/ld\+json|application\/json)"/.test(m[1] || '')).map(m => m[2]);
const app = scripts[scripts.length - 1];
try { new vm.Script(app, { filename: 'index.html(app)' }); console.log('ok    app script parses (' + Math.round(app.length / 1024) + ' KB)'); }
catch (e) { fail('app script syntax error: ' + e.message); }
for (const [i, s] of scripts.entries()) {
  if (s === app) continue;
  try { new vm.Script(s, { filename: `index.html(script ${i})` }); } catch (e) { fail(`inline script ${i} syntax error: ${e.message}`); }
}

// 2. CSS sanity: balanced braces
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
const open = (css.match(/\{/g) || []).length, close = (css.match(/\}/g) || []).length;
if (open !== close) fail(`CSS braces unbalanced (${open} open, ${close} close)`); else console.log('ok    CSS braces balanced');

// 3. Duplicate ids in static HTML
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const seen = new Map();
for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1);
const dupes = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
if (dupes.length) fail('duplicate ids: ' + dupes.join(', ')); else console.log(`ok    ${seen.size} unique ids`);

// 4. Ids referenced from JS but never defined in static HTML (dynamic ids get a warning only)
const refs = new Set();
for (const m of app.matchAll(/\$\(\s*"#([A-Za-z][\w-]*)"/g)) refs.add(m[1]);
for (const m of app.matchAll(/getElementById\(\s*["']([\w-]+)["']/g)) refs.add(m[1]);
const dynamicIds = new Set([...app.matchAll(/id=(?:\\)?["']([A-Za-z][\w-]*)(?:\\)?["']/g)].map(m => m[1]));
const missing = [...refs].filter(id => !seen.has(id) && !dynamicIds.has(id));
if (missing.length) warn('ids used in JS but not in HTML: ' + missing.join(', ')); else console.log('ok    every JS #id reference exists');

// 5. Required contracts
for (const needle of ['TL.go = go', 'TL.api = ', 'TL.auth = ', 'TL.emit("init")']) {
  if (!app.includes(needle)) fail('contract missing from app script: ' + needle);
}
if (!html.includes('id="view-home"') || !html.includes('id="main"')) fail('core markup missing');

// 6. API tests
if (!process.argv.includes('--no-tests')) {
  const r = spawnSync(process.execPath, ['--test', 'api/test/*.test.mjs'], { cwd: repo, encoding: 'utf8' });
  const summary = (r.stdout.match(/ℹ (tests|pass|fail) \d+/g) || []).join('  ');
  if (r.status !== 0) { fail('API tests failed  ' + summary); console.log(r.stdout.split('\n').filter(l => /✖|not ok|Error|error:/.test(l)).slice(0, 30).join('\n')); }
  else console.log('ok    API tests  ' + summary);
}

console.log(`\n${failures} failure(s), ${warnings} warning(s)`);
process.exit(failures ? 1 : 0);
