'use strict';

/* Prepare native modules (node-pty) for the installed Electron version.

   node-pty ships prebuilt binaries for win32-x64. When those already load in
   Electron's Node runtime we skip the (slow, toolchain-dependent) rebuild, which
   keeps `npm install` clean on machines without Visual Studio C++ Build Tools.
   If the prebuilts do not load, we fall back to electron-builder's rebuild and
   treat failure as non-fatal: every feature except the terminal still works. */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const electronExe = path.join(root, 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron');

function electronCanLoadNodePty() {
  if (!fs.existsSync(electronExe)) return false;
  const probe = path.join(os.tmpdir(), 'peabox-pty-probe-' + process.pid + '.js');
  const nativePath = path.join(root, 'node_modules', 'node-pty').replace(/\\/g, '\\\\');
  fs.writeFileSync(probe, [
    "'use strict';",
    'try {',
    "  const pty = require('" + nativePath + "');",
    "  if (typeof pty.spawn !== 'function') process.exit(3);",
    '  process.exit(0);',
    '} catch (err) {',
    '  console.error(err && err.message);',
    '  process.exit(4);',
    '}'
  ].join('\n'));

  const result = spawnSync(electronExe, [probe], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeout: 30000,
    windowsHide: true
  });
  try { fs.unlinkSync(probe); } catch { /* ignore */ }
  return result.status === 0;
}

function rebuild() {
  let cli;
  try {
    cli = require.resolve('electron-builder/out/cli/cli.js');
  } catch {
    cli = path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
  }
  console.log('[peabox] Rebuilding native modules for Electron…');
  return spawnSync(process.execPath, [cli, 'install-app-deps'], {
    stdio: 'inherit',
    cwd: root,
    env: process.env
  });
}

if (process.env.PEABOX_SKIP_NATIVE_CHECK === '1') {
  console.log('[peabox] Native module check skipped.');
  process.exit(0);
}

if (electronCanLoadNodePty()) {
  console.log('[peabox] node-pty prebuilt binary works with this Electron version — rebuild skipped.');
  process.exit(0);
}

const result = rebuild();
if (result.error || result.status !== 0) {
  console.warn('');
  console.warn('[peabox] Native module rebuild failed — this is not fatal.');
  console.warn('[peabox] PeaBox will start; the integrated terminal needs node-pty.');
  console.warn('[peabox] Install "Desktop development with C++" from Visual Studio Build Tools, then run:');
  console.warn('         npx electron-builder install-app-deps');
  console.warn('');
}

process.exit(0);
