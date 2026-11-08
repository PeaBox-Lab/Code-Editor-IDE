'use strict';

/* Static validation for PeaBox IDE. No dependencies, safe to run in CI.
   Checks syntax, DOM ids, preload API surface, IPC channels and icon names. */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const problems = [];
const rel = (p) => path.relative(root, p) || p;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

const REQUIRED = [
  'main.js', 'preload.js', 'renderer.js', 'shared.js',
  'index.html', 'style.css', 'package.json'
];

for (const file of REQUIRED) {
  if (!exists(file)) problems.push('Missing required file: ' + file);
}

const SCRIPTS = ['main.js', 'preload.js', 'renderer.js', 'shared.js', 'tools/validate.js', 'tools/postinstall.js'];
for (const file of SCRIPTS) {
  if (!exists(file)) continue;
  const res = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (res.status !== 0) {
    problems.push('Syntax error in ' + file + ':\n' + (res.stderr || res.stdout || '').trim());
  }
}

if (problems.length) {
  fail();
}

const html = read('index.html');
const renderer = read('renderer.js');
const preload = read('preload.js');
const main = read('main.js');
const pkg = JSON.parse(read('package.json'));

/* ---- DOM ids ---- */

const ids = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), (m) => m[1]));
const usedIds = new Set(Array.from(renderer.matchAll(/(?<!\$)\$\('([^']+)'\)/g), (m) => m[1]));
for (const id of usedIds) {
  if (!ids.has(id)) problems.push('Renderer references missing DOM id: #' + id);
}

/* ---- icon sprite ---- */

const symbols = new Set(Array.from(html.matchAll(/<symbol id="i-([^"]+)"/g), (m) => m[1]));
for (const m of html.matchAll(/href="#i-([^"]+)"/g)) {
  if (!symbols.has(m[1])) problems.push('HTML uses missing icon: #i-' + m[1]);
}
for (const m of renderer.matchAll(/\bicon\('([^']+)'/g)) {
  if (!symbols.has(m[1])) problems.push("Renderer uses missing icon: icon('" + m[1] + "')");
}

/* ---- preload namespaces ---- */

const apiUsed = new Set(Array.from(renderer.matchAll(/\bapi\.([A-Za-z0-9_]+)/g), (m) => m[1]));
const apiExposed = new Set(Array.from(preload.matchAll(/^  ([A-Za-z0-9_]+): \{/gm), (m) => m[1]));
for (const name of apiUsed) {
  if (!apiExposed.has(name)) problems.push('Renderer uses missing preload namespace: api.' + name);
}

/* ---- IPC channels ---- */

const mainHandles = new Set([
  ...Array.from(main.matchAll(/ipcMain\.(?:handle|on)\('([^']+)'/g), (m) => m[1])
]);
const mainSends = new Set(Array.from(main.matchAll(/\bsend\('([^']+)'/g), (m) => m[1]));
const preloadInvokes = new Set([
  ...Array.from(preload.matchAll(/\binvoke\('([^']+)'/g), (m) => m[1]),
  ...Array.from(preload.matchAll(/\bsend\('([^']+)'/g), (m) => m[1])
]);
const preloadSubscribes = new Set(Array.from(preload.matchAll(/\bsubscribe\('([^']+)'/g), (m) => m[1]));

for (const channel of preloadInvokes) {
  if (!mainHandles.has(channel)) problems.push('Preload invokes unknown IPC channel: ' + channel);
}
for (const channel of preloadSubscribes) {
  if (!mainSends.has(channel)) problems.push('Preload subscribes to channel main never sends: ' + channel);
}

/* ---- security checks ---- */

if (/window\.(prompt|confirm)\s*\(/.test(renderer)) problems.push('Renderer uses unsupported window.prompt/window.confirm.');
if (/nodeIntegration\s*:\s*true/.test(main)) problems.push('nodeIntegration must not be enabled.');
if (/contextIsolation\s*:\s*false/.test(main)) problems.push('contextIsolation must stay enabled.');
if (/sandbox\s*:\s*false/.test(main)) problems.push('sandbox must stay enabled.');
if (/shell\s*:\s*true/.test(main)) problems.push('Child processes must not use shell: true.');
if (/'unsafe-inline'[^;]*script-src|script-src[^;]*'unsafe-inline'/.test(html)) {
  problems.push('CSP must not allow unsafe-inline scripts.');
}

/* ---- version consistency ---- */

if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) problems.push('package.json version is not semver.');
if (!pkg.build || !Array.isArray(pkg.build.files) || !pkg.build.files.includes('shared.js')) {
  problems.push('electron-builder files must include shared.js.');
}
if (!pkg.scripts || !pkg.scripts.postinstall) {
  problems.push('package.json needs a postinstall script for electron-builder install-app-deps.');
}

function fail() {
  console.error('PeaBox validation failed:\n- ' + problems.join('\n- '));
  process.exit(1);
}

if (problems.length) fail();

console.log('PeaBox v' + pkg.version + ' validation passed (' +
  ids.size + ' DOM ids, ' + symbols.size + ' icons, ' + mainHandles.size + ' IPC handlers).');
