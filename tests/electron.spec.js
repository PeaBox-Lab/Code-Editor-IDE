'use strict';

/* Playwright Electron smoke test.
   Run with: npm run test:e2e
   Requires Electron + Playwright to be installed locally. */

const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const fixture = path.resolve(__dirname, 'fixture');
const pkg = require('../package.json');
const createdPath = path.join(fixture, 'src', 'created-by-test.js');

(async () => {
  const app = await electron.launch({
    args: ['main.js'],
    cwd: projectRoot,
    env: { ...process.env, PEABOX_TEST: '1' }
  });

  const pageErrors = [];

  try {
    const win = await app.firstWindow();
    win.on('pageerror', (err) => pageErrors.push(err.message));
    await win.waitForLoadState('domcontentloaded');

    assert.equal(await win.title(), 'PeaBox IDE');
    await win.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 30000 });
    await win.waitForSelector('#welcome');
    assert.equal((await win.evaluate(() => window.api.app.info())).version, pkg.version);

    // Route the native folder picker to the fixture without touching the OS dialog.
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, fixture);

    await win.click('#welcomeOpen');
    await win.waitForFunction(
      () => (document.getElementById('workspace').textContent || '').includes('fixture'),
      null,
      { timeout: 15000 }
    );

    // Regression: a nested folder must render instead of crashing.
    await win.waitForSelector('.tree-row');
    await win.locator('.tree-row', { hasText: 'src' }).first().click();
    await win.waitForFunction(
      () => Array.from(document.querySelectorAll('.tree-row')).some((n) => n.textContent.includes('deep')),
      null,
      { timeout: 10000 }
    );
    await win.locator('.tree-row', { hasText: 'deep' }).first().click();
    await win.waitForFunction(
      () => Array.from(document.querySelectorAll('.tree-row')).some((n) => n.textContent.includes('leaf.js')),
      null,
      { timeout: 10000 }
    );
    await win.locator('.tree-row', { hasText: 'leaf.js' }).first().click();
    await win.waitForFunction(() => document.querySelectorAll('.tab').length === 1);
    assert.ok(await win.evaluate(() => !!window.monaco && !!document.querySelector('.monaco-editor')), 'Monaco did not initialize');

    // Open a top-level file as well.
    await win.locator('.tree-row', { hasText: 'app.py' }).first().click();
    await win.waitForFunction(() => document.querySelectorAll('.tab').length === 2);

    // Search across files, including the nested fixture.
    await win.click('[data-view="search"]');
    await win.fill('#searchInput', 'search marker');
    await win.press('#searchInput', 'Enter');
    await win.waitForSelector('.search-hit', { timeout: 15000 });
    assert.ok((await win.locator('.search-hit').count()) >= 1, 'expected search hits');

    // Ctrl+= adjusts and persists the editor font size.
    const fontBefore = await win.evaluate(async () => (await window.api.app.loadState()).settings.fontSize);
    await win.keyboard.press('Control+=');
    await win.waitForFunction(
      async (before) => (await window.api.app.loadState()).settings.fontSize === before + 1,
      fontBefore,
      { timeout: 8000 }
    );

    // Theme toggle flips the document root.
    await win.click('#themeBtn');
    assert.equal(await win.evaluate(() => document.documentElement.dataset.theme), 'light');

    // Settings modal opens and closes.
    await win.click('#settingsBtn');
    await win.waitForSelector('#modal:not(.hidden)');
    await win.click('#modalFooter button.primary');
    await win.waitForFunction(() => document.getElementById('modal').classList.contains('hidden'));

    // Command palette opens.
    await win.click('#commandButton');
    await win.waitForSelector('#palette:not(.hidden)');
    await win.press('#paletteInput', 'Escape');
    await win.waitForFunction(() => document.getElementById('palette').classList.contains('hidden'));

    // Create a file through the explorer context menu (custom modal + Enter).
    await win.click('[data-view="explorer"]');
    await win.waitForSelector('.tree-row');
    await win.locator('.tree-row', { hasText: 'src' }).first().click({ button: 'right' });
    await win.waitForSelector('#contextMenu:not(.hidden)');
    await win.locator('#contextMenu .context-item', { hasText: 'New File' }).click();
    await win.waitForSelector('#modal:not(.hidden)');
    await win.fill('#modalBody input', 'created-by-test.js');
    await win.press('#modalBody input', 'Enter');
    await win.waitForFunction(
      () => Array.from(document.querySelectorAll('.tree-row')).some((n) => n.textContent.includes('created-by-test.js')),
      null,
      { timeout: 10000 }
    );
    await win.waitForFunction(
      () => Array.from(document.querySelectorAll('.tab')).some((t) => t.textContent.includes('created-by-test.js')),
      null,
      { timeout: 10000 }
    );
    await win.keyboard.type('const createdByTest = true;', { delay: 15 });
    await win.keyboard.press('Control+S');
    await win.waitForFunction(
      () => !document.querySelector('.tab.active').classList.contains('dirty'),
      null,
      { timeout: 10000 }
    );

    // Open File dialog adds a file tab straight from disk.
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, path.join(fixture, 'notes.txt'));
    await win.keyboard.press('Control+Shift+O');
    await win.waitForFunction(
      () => Array.from(document.querySelectorAll('.tab')).some((t) => t.textContent.includes('notes.txt')),
      null,
      { timeout: 10000 }
    );

    // Terminal: a live xterm backed by node-pty must accept keyboard input.
    await win.click('#panelBtn');
    await win.waitForSelector('#panel:not(.hidden)');
    await win.click('#newTerminal');
    await win.waitForSelector('.xterm', { timeout: 20000 });
    assert.ok(
      await win.evaluate(() => document.getElementById('terminalError').classList.contains('hidden')),
      'terminal reported an error instead of starting'
    );

    await win.click('.terminal-pane.active .xterm');
    await win.keyboard.type('echo PEABOX_TERMINAL_OK', { delay: 25 });
    await win.keyboard.press('Enter');
    await win.waitForFunction(
      () => (document.querySelector('.terminal-pane.active .xterm-rows') || {}).textContent?.includes('PEABOX_TERMINAL_OK'),
      null,
      { timeout: 20000 }
    );

    assert.equal(
      fs.readFileSync(createdPath, 'utf8').trim(),
      'const createdByTest = true;',
      'created file was not saved to disk'
    );

    assert.deepEqual(pageErrors, [], 'renderer threw uncaught errors');
    console.log('E2E PASS: boot, nested folder, editor, search, theme, settings, palette, file create/save, open file, live terminal');
  } finally {
    await app.close();
    try { fs.rmSync(createdPath, { force: true }); } catch { /* ignore */ }
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
