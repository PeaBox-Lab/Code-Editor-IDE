'use strict';
const {
  app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard, screen
} = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const writeFileAtomic = require('write-file-atomic');
const PB = require('./shared');

const PKG = (() => { try { return require('./package.json'); } catch { return {}; } })();

const IS_WIN = process.platform === 'win32';
const TEST_MODE = process.env.PEABOX_TEST === '1';

if (TEST_MODE) {
  try { app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'peabox-test-'))); } catch { /* ignore */ }
} else if (process.env.PORTABLE_EXECUTABLE_DIR) {
  try { app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'PeaBox-IDE-Data')); } catch { /* ignore */ }
}

let win = null;
let runner = null;
let runSeq = 0;
let forceClose = false;
let closePromptShown = false;
let closeWatchdog = null;
const terminals = new Map();
let termSeq = 0;
const watchers = new Map();
const workspaceRoots = new Map();
const allowedFiles = new Set();
let workspaceWatcher = null;
let workspaceWatchTimer = null;

const userDir = () => app.getPath('userData');
const stateFile = () => path.join(userDir(), 'state.json');
const windowFile = () => path.join(userDir(), 'window.json');
const recoveryDir = () => path.join(userDir(), 'recovery');

const normKey = (p) => (IS_WIN ? String(p).toLowerCase() : String(p));
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(String(p)); } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

function send(channel, payload) {
  if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function log(...args) { if (!app.isPackaged) console.log('[peabox]', ...args); }

function isInside(rootPath, target) {
  const r = normKey(PB.normalizePath(rootPath));
  const t = normKey(PB.normalizePath(target));
  return !!r && (t === r || t.indexOf(r + '/') === 0);
}

function addAllowed(p) {
  if (!p) return;
  allowedFiles.add(normKey(real(p)));
}

function registerRoot(dir) {
  const abs = path.resolve(String(dir));
  if (!isDir(abs)) throw new Error('Not a folder: ' + abs);
  const rp = real(abs);
  workspaceRoots.set(normKey(rp), rp);
  addAllowed(rp);
  return rp;
}

function registeredRoot(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('Invalid folder path.');
  const rp = real(dir);
  if (workspaceRoots.has(normKey(rp))) return rp;
  throw new Error('Folder is not open in this workspace.');
}

function assertAllowed(target, allowMissing) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('Invalid absolute path.');
  const abs = path.normalize(target);
  let probe = abs;
  if (!fs.existsSync(abs)) {
    if (!allowMissing) throw new Error('File not found: ' + PB.basename(abs));
    probe = path.dirname(abs);
    if (!fs.existsSync(probe)) throw new Error('Parent folder not found.');
  }
  const rp = real(probe);
  const finalPath = probe === abs ? rp : path.join(rp, path.basename(abs));
  const key = normKey(finalPath);
  if (allowedFiles.has(key)) return finalPath;
  for (const rootPath of workspaceRoots.values()) {
    if (isInside(rootPath, finalPath)) return finalPath;
  }
  throw new Error('Path is outside the open workspace.');
}

function assertWorkspaceDir(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('Invalid working folder.');
  const rp = real(dir);
  if (!isDir(rp)) throw new Error('Working folder not found.');
  if (allowedFiles.has(normKey(rp))) return rp;
  for (const rootPath of workspaceRoots.values()) if (isInside(rootPath, rp)) return rp;
  for (const f of allowedFiles.values()) if (normKey(path.dirname(f)) === normKey(rp)) return rp;
  throw new Error('Working folder is outside the open workspace.');
}

/* ---------------- state ---------------- */

function readState() {
  try { return PB.sanitizeState(JSON.parse(fs.readFileSync(stateFile(), 'utf8'))); }
  catch { return PB.defaultState(); }
}

function writeState(raw) {
  const clean = PB.sanitizeState(raw);
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  writeFileAtomic.sync(stateFile(), JSON.stringify(clean, null, 2), { encoding: 'utf8', fsync: true });
  return clean;
}

function registerStatePaths(state) {
  const dirs = [state.lastFolder].concat(state.recent || []);
  for (const d of dirs) {
    try { if (d && isDir(d)) registerRoot(d); } catch { /* ignore stale */ }
  }
}

function readWindowState() {
  try {
    const w = JSON.parse(fs.readFileSync(windowFile(), 'utf8'));
    if (w && Number.isFinite(w.width) && Number.isFinite(w.height)) return w;
  } catch { /* ignore */ }
  return null;
}

let saveBoundsTimer = null;
function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    try {
      const b = win.getBounds();
      fs.mkdirSync(path.dirname(windowFile()), { recursive: true });
      writeFileAtomic.sync(windowFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }), { encoding: 'utf8' });
    } catch { /* ignore */ }
  }, 400);
}

/* ---------------- recovery ---------------- */

const recoveryId = (file) => crypto.createHash('sha1').update(normKey(path.normalize(String(file)))).digest('hex') + '.json';
const recoveryPath = (file) => path.join(recoveryDir(), recoveryId(file));

function readRecoveryFile(file) {
  try {
    const rec = JSON.parse(fs.readFileSync(recoveryPath(file), 'utf8'));
    return rec && typeof rec.content === 'string' ? rec : null;
  } catch { return null; }
}

function pruneRecovery() {
  let names = [];
  try { names = fs.readdirSync(recoveryDir()).filter((n) => n.endsWith('.json')); } catch { return; }
  const cutoff = Date.now() - 30 * 86400000;
  for (const name of names) {
    const full = path.join(recoveryDir(), name);
    try {
      const rec = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (!rec || !rec.file || !rec.savedAt || Date.parse(rec.savedAt) < cutoff) fs.rmSync(full, { force: true });
    } catch { try { fs.rmSync(full, { force: true }); } catch { /* ignore */ } }
  }
}

/* ---------------- process helpers ---------------- */

function killTree(child) {
  if (!child || !child.pid) return;
  if (IS_WIN) {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* ignore */ }
  } else {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
  }
}

function runProcess(exe, args, options) {
  options = options || {};
  return new Promise((resolve) => {
    let child;
    const started = Date.now();
    try {
      child = spawn(exe, (args || []).map(String), {
        cwd: options.cwd, shell: false, windowsHide: true,
        env: options.env || process.env, stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      return resolve({ code: -1, stdout: '', stderr: err.message, timedOut: false, duration: 0 });
    }
    let stdout = '', stderr = '', done = false, timedOut = false;
    const timer = setTimeout(() => {
      if (done) return;
      timedOut = true;
      killTree(child);
      setTimeout(() => { if (!done) { done = true; resolve({ code: -1, stdout, stderr: stderr + '\nTimed out.', timedOut: true, duration: Date.now() - started }); } }, 1500);
    }, options.timeout || 60000);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.message, timedOut, duration: Date.now() - started });
    });
    child.on('close', (code, signal) => {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve({ code: code == null ? -1 : code, signal, stdout, stderr, timedOut, duration: Date.now() - started });
    });
  });
}

const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_ASKPASS: 'echo' });

async function git(cwd, args, timeout) {
  const res = await runProcess('git', args, { cwd, env: gitEnv(), timeout: timeout || 60000 });
  return {
    ok: res.code === 0, code: res.code, timedOut: res.timedOut,
    stdout: res.stdout, stderr: res.stderr,
    text: (res.stdout || res.stderr || '').trim()
  };
}

/* ---------------- filesystem listing / search ---------------- */

function excluded(name, excludes) {
  return excludes.some((x) => x && (name === x || name.toLowerCase() === x.toLowerCase()));
}

async function listDir(dir, excludes) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => !excluded(e.name, excludes))
    .map((e) => ({
      name: e.name,
      path: path.join(dir, e.name),
      dir: e.isDirectory(),
      symlink: e.isSymbolicLink()
    }))
    .sort((a, b) => (Number(b.dir) - Number(a.dir)) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

async function tree(root) {
  const rp = registeredRoot(root);
  return { root: rp, children: await listDir(rp, PB.DEFAULT_EXCLUDES) };
}

const TICK = () => new Promise((r) => setImmediate(r));

async function scanWorkspace(root, options, onFile) {
  const excludes = options.excludes && options.excludes.length ? options.excludes : PB.DEFAULT_EXCLUDES;
  const deadline = Date.now() + (options.timeout || 20000);
  const stack = [root];
  let files = 0, scanned = 0;
  while (stack.length) {
    if (Date.now() > deadline) return { truncated: true, files, scanned };
    const dir = stack.pop();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (excluded(e.name, excludes) || e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { stack.push(full); continue; }
      if (!e.isFile()) continue;
      scanned++;
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (await onFile(full, rel) === false) return { truncated: true, files, scanned };
      files++;
      if (files % 40 === 0) await TICK();
    }
    if (Date.now() > deadline) return { truncated: true, files, scanned };
  }
  return { truncated: false, files, scanned };
}

/* ---------------- menu ---------------- */

function sendCommand(id, arg) { send('menu:command', { id, arg }); }

function buildMenu() {
  const state = readState();
  const recent = (state.recent || []).slice(0, 10).map((p) => ({
    label: p, click: () => sendCommand('workspace.openRecent', p)
  }));
  const template = [
    {
      label: 'File', submenu: [
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => sendCommand('workspace.open') },
        { label: 'Open File…', accelerator: 'CmdOrCtrl+Shift+O', click: () => sendCommand('file.open') },
        { label: 'New File…', accelerator: 'CmdOrCtrl+N', click: () => sendCommand('file.new') },
        { label: 'Open Recent', submenu: recent.length ? recent : [{ label: 'No recent projects', enabled: false }] },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendCommand('file.save') },
        { label: 'Save All', accelerator: 'CmdOrCtrl+Alt+S', click: () => sendCommand('file.saveAll') },
        { label: 'Close Editor', accelerator: 'CmdOrCtrl+W', click: () => sendCommand('file.close') },
        { label: 'Close All Editors', click: () => sendCommand('file.closeAll') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => sendCommand('app.settings') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit', submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find', accelerator: 'CmdOrCtrl+F', click: () => sendCommand('editor.find') },
        { label: 'Replace', accelerator: 'CmdOrCtrl+H', click: () => sendCommand('editor.replace') },
        { label: 'Find in Files', accelerator: 'CmdOrCtrl+Shift+F', click: () => sendCommand('view.search') },
        { label: 'Go to Line…', accelerator: 'CmdOrCtrl+G', click: () => sendCommand('editor.gotoLine') }
      ]
    },
    {
      label: 'View', submenu: [
        { label: 'Command Palette…', accelerator: 'CmdOrCtrl+Shift+P', click: () => sendCommand('palette.commands') },
        { label: 'Quick Open…', accelerator: 'CmdOrCtrl+P', click: () => sendCommand('palette.files') },
        { type: 'separator' },
        { label: 'Explorer', accelerator: 'CmdOrCtrl+Shift+E', click: () => sendCommand('view.explorer') },
        { label: 'Search', accelerator: 'CmdOrCtrl+Shift+F', click: () => sendCommand('view.search') },
        { label: 'Source Control', accelerator: 'CmdOrCtrl+Shift+G', click: () => sendCommand('view.git') },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => sendCommand('view.sidebar') },
        { label: 'Toggle Panel', accelerator: 'CmdOrCtrl+J', click: () => sendCommand('view.panel') },
        { label: 'Terminal', accelerator: 'Ctrl+`', click: () => sendCommand('terminal.toggle') },
        { label: 'Output', click: () => sendCommand('view.output') },
        { type: 'separator' },
        { role: 'reload' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Toggle Developer Tools', accelerator: 'F12', click: () => { if (win) win.webContents.toggleDevTools(); } }
      ]
    },
    {
      label: 'Run', submenu: [
        { label: 'Run Current File', accelerator: 'F5', click: () => sendCommand('run.start') },
        { label: 'Stop', accelerator: 'Shift+F5', click: () => sendCommand('run.stop') }
      ]
    },
    {
      label: 'Help', submenu: [
        { label: 'Keyboard Shortcuts', click: () => sendCommand('app.shortcuts') },
        { label: 'About PeaBox IDE', click: () => dialog.showMessageBox(win, {
          type: 'info', message: 'PeaBox IDE ' + app.getVersion(),
          detail: 'A focused, local-first code editor.\nElectron ' + process.versions.electron + ' · Chromium ' + process.versions.chrome
        }) }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- window ---------------- */

function createWindow() {
  const saved = readWindowState();
  let bounds = { width: 1440, height: 900 };
  if (saved) {
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return saved.x < a.x + a.width && saved.x + saved.width > a.x && saved.y < a.y + a.height && saved.y + saved.height > a.y;
    });
    if (visible) bounds = { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  }

  win = new BrowserWindow({
    ...bounds, minWidth: 960, minHeight: 600, show: false,
    title: 'PeaBox IDE', backgroundColor: '#0f1116',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webviewTag: false, spellcheck: false
    }
  });

  win.loadFile('index.html');
  win.once('ready-to-show', () => {
    win.show();
    if (saved && saved.maximized) win.maximize();
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  win.on('resize', saveWindowState);
  win.on('move', saveWindowState);
  win.on('close', (e) => {
    if (!forceClose) {
      e.preventDefault();
      // A second close attempt means the user really wants to quit, even if the
      // renderer is busy or unresponsive.
      if (closePromptShown) {
        forceClose = true;
        win.close();
        return;
      }
      closePromptShown = true;
      send('app:close-request');
      // If the renderer is unresponsive (or has not finished booting), do not
      // trap the user in an unclosable window.
      clearTimeout(closeWatchdog);
      closeWatchdog = setTimeout(() => {
        closePromptShown = false;
        forceClose = true;
        try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* ignore */ }
      }, 8000);
      setTimeout(() => { closePromptShown = false; }, 15000);
      return;
    }
    clearTimeout(closeWatchdog);
    try {
      const b = win.getBounds();
      fs.mkdirSync(path.dirname(windowFile()), { recursive: true });
      writeFileAtomic.sync(windowFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }), { encoding: 'utf8' });
    } catch { /* ignore */ }
  });

  win.on('closed', () => {
    clearTimeout(closeWatchdog);
    closePromptShown = false;
    win = null;
  });

  buildMenu();
}

/* ---------------- IPC: app / dialogs ---------------- */

ipcMain.handle('app:info', () => ({
  version: PKG.version || app.getVersion(),
  platform: process.platform,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  packaged: app.isPackaged
}));

ipcMain.handle('app:loadState', () => {
  const state = readState();
  registerStatePaths(state);
  for (const file of state.openFiles || []) {
    try { if (file && isFile(file)) addAllowed(file); } catch { /* ignore stale */ }
  }
  pruneRecovery();
  try {
    for (const name of fs.readdirSync(recoveryDir())) {
      if (!name.endsWith('.json')) continue;
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(recoveryDir(), name), 'utf8'));
        if (rec && rec.file && isFile(rec.file)) addAllowed(rec.file);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return state;
});

ipcMain.handle('app:saveState', (_, state) => writeState(state));
ipcMain.handle('app:copy', (_, text) => { clipboard.writeText(String(text || '').slice(0, 1024 * 1024)); return true; });
ipcMain.handle('app:close', (_, action) => {
  clearTimeout(closeWatchdog);
  closePromptShown = false;
  if (action === 'cancel') return false;
  forceClose = true;
  if (win && !win.isDestroyed()) win.close();
  return true;
});

ipcMain.handle('dialog:file', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
  if (r.canceled || !r.filePaths.length) return [];
  const paths = [];
  for (const candidate of r.filePaths) {
    try {
      const p = real(candidate);
      if (isFile(p)) { addAllowed(p); paths.push(p); }
    } catch { /* skip unreadable selections */ }
  }
  return paths;
});

/* ---------------- IPC: workspace ---------------- */

ipcMain.handle('workspace:choose', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const rootPath = registerRoot(r.filePaths[0]);
  return tree(rootPath);
});

ipcMain.handle('workspace:load', async (_, dir) => {
  if (!isDir(dir)) return null;
  const rp = real(dir);
  let known = false;
  for (const rootPath of workspaceRoots.values()) {
    if (normKey(rootPath) === normKey(rp)) { known = true; break; }
  }
  if (!known) {
    const st = readState();
    const candidates = [st.lastFolder].concat(st.recent || []);
    for (const candidate of candidates) {
      try {
        if (candidate && normKey(real(candidate)) === normKey(rp)) { known = true; break; }
      } catch { /* skip stale entry */ }
    }
  }
  if (!known) return null;
  const rootPath = registerRoot(rp);
  return tree(rootPath);
});

ipcMain.handle('workspace:refresh', (_, dir) => tree(dir));
ipcMain.handle('workspace:children', async (_, dir) => listDir(assertAllowed(dir), PB.DEFAULT_EXCLUDES));

ipcMain.handle('workspace:stat', (_, p) => {
  let safe;
  try { safe = assertAllowed(p, true); } catch { return { exists: false }; }
  try {
    const st = fs.statSync(safe);
    return { exists: true, dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs };
  } catch { return { exists: false }; }
});

ipcMain.handle('workspace:createFile', async (_, payload) => {
  const dir = assertWorkspaceDir(payload && payload.dir);
  const check = PB.validateEntryName(payload && payload.name);
  if (!check.ok) throw new Error(check.error);
  const full = path.join(dir, check.value);
  if (fs.existsSync(full)) throw new Error('An item with that name already exists.');
  await fsp.writeFile(full, '', { flag: 'wx' });
  addAllowed(full);
  return full;
});

ipcMain.handle('workspace:createFolder', async (_, payload) => {
  const dir = assertWorkspaceDir(payload && payload.dir);
  const check = PB.validateEntryName(payload && payload.name);
  if (!check.ok) throw new Error(check.error);
  const full = path.join(dir, check.value);
  if (fs.existsSync(full)) throw new Error('An item with that name already exists.');
  await fsp.mkdir(full);
  return full;
});

ipcMain.handle('workspace:files', async (_, payload) => {
  const rootPath = registeredRoot(payload && payload.root);
  const excludes = PB.splitExcludes(payload && payload.excludes);
  const files = [];
  let truncated = false;
  const result = await scanWorkspace(rootPath, { excludes, timeout: 15000 }, async (full, rel) => {
    files.push({ path: full, rel });
    if (files.length >= 25000) { truncated = true; return false; }
    return true;
  });
  return { files, truncated: truncated || result.truncated };
});

ipcMain.handle('workspace:search', async (_, payload) => {
  const rootPath = registeredRoot(payload && payload.root);
  const query = String((payload && payload.query) || '');
  if (!query) return { hits: [], truncated: false, filesScanned: 0 };
  const caseSensitive = !!(payload && payload.caseSensitive);
  const wholeWord = !!(payload && payload.wholeWord);
  const maxResults = PB.clamp(payload && payload.maxResults || 800, 1, 2000);
  const excludes = PB.splitExcludes(payload && payload.excludes);
  const needle = caseSensitive ? query : query.toLowerCase();
  const hits = [];
  let truncated = false;

  const result = await scanWorkspace(rootPath, { excludes, timeout: 20000 }, async (full, rel) => {
    if (hits.length >= maxResults) { truncated = true; return false; }
    let st;
    try { st = await fsp.stat(full); } catch { return true; }
    if (st.size > 2 * 1024 * 1024) return true;
    let buf;
    try { buf = await fsp.readFile(full); } catch { return true; }
    if (buf.includes(0)) return true;
    const lines = buf.toString('utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hay = caseSensitive ? line : line.toLowerCase();
      let idx = hay.indexOf(needle);
      while (idx >= 0) {
        if (!wholeWord || PB.boundaryMatch(line, idx, query.length)) {
          hits.push({ path: full, rel, line: i + 1, column: idx + 1, text: line.trim().slice(0, 220) });
          if (hits.length >= maxResults) { truncated = true; break; }
        }
        idx = hay.indexOf(needle, idx + Math.max(1, needle.length));
      }
      if (truncated) break;
    }
    return !truncated;
  });

  return { hits, truncated: truncated || result.truncated, filesScanned: result.scanned };
});

ipcMain.handle('workspace:watchStart', (_, dir) => {
  const rootPath = registeredRoot(dir);
  try { if (workspaceWatcher) workspaceWatcher.close(); } catch { /* ignore */ }
  try {
    workspaceWatcher = fs.watch(rootPath, { recursive: true }, () => {
      clearTimeout(workspaceWatchTimer);
      workspaceWatchTimer = setTimeout(() => send('workspace:changed', { root: rootPath }), 450);
    });
    workspaceWatcher.on('error', () => { try { workspaceWatcher.close(); } catch { /* ignore */ } });
  } catch {
    workspaceWatcher = null;
  }
  return true;
});

ipcMain.handle('workspace:watchStop', () => {
  try { if (workspaceWatcher) workspaceWatcher.close(); } catch { /* ignore */ }
  workspaceWatcher = null;
  return true;
});

/* ---------------- IPC: files ---------------- */

ipcMain.handle('file:read', (_, file) => {
  const p = assertAllowed(file);
  const st = fs.statSync(p);
  if (!st.isFile()) throw new Error('Not a file.');
  if (st.size > 20 * 1024 * 1024) throw new Error('Files larger than 20 MB are not opened.');
  const buf = fs.readFileSync(p);
  if (buf.includes(0)) throw new Error('This looks like a binary file.');
  let content = buf.toString('utf8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  return { content, mtime: st.mtimeMs, size: st.size };
});

ipcMain.handle('file:write', (_, file, content) => {
  const p = assertAllowed(file, true);
  if (typeof content !== 'string') throw new Error('Invalid file contents.');
  if (content.length > 50 * 1024 * 1024) throw new Error('File is too large to save.');
  writeFileAtomic.sync(p, content, { encoding: 'utf8', fsync: true });
  return { mtime: fs.statSync(p).mtimeMs };
});

ipcMain.handle('file:new', async (_, rootPath) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: rootPath || app.getPath('documents') });
  if (r.canceled || !r.filePath) return null;
  const p = path.resolve(r.filePath);
  if (fs.existsSync(p)) throw new Error('A file with that name already exists.');
  await fsp.writeFile(p, '', { flag: 'wx' });
  addAllowed(p);
  return p;
});

ipcMain.handle('file:rename', (_, file, name) => {
  const src = assertAllowed(file);
  const check = PB.validateEntryName(name);
  if (!check.ok) throw new Error(check.error);
  const target = path.join(path.dirname(src), check.value);
  if (fs.existsSync(target)) throw new Error('An item with that name already exists.');
  if (isDir(src)) {
    const prefix = normKey(src) + path.sep;
    for (const f of allowedFiles) if (f.indexOf(prefix) === 0) throw new Error('Close files inside this folder before renaming it.');
  }
  fs.renameSync(src, target);
  allowedFiles.delete(normKey(src));
  addAllowed(target);
  return target;
});

ipcMain.handle('file:delete', (_, file) => {
  const p = assertAllowed(file);
  if (!fs.existsSync(p)) throw new Error('Item not found.');
  fs.rmSync(p, { recursive: true, force: true });
  allowedFiles.delete(normKey(p));
  return true;
});

ipcMain.handle('file:reveal', (_, file) => {
  const p = assertAllowed(file, true);
  shell.showItemInFolder(p);
  return true;
});

/* ---------------- IPC: git ---------------- */

ipcMain.handle('git:status', async (_, cwd) => {
  const dir = registeredRoot(cwd);
  const inside = await git(dir, ['rev-parse', '--is-inside-work-tree'], 10000);
  if (!inside.ok) return { repo: false, text: inside.text || 'Not a Git repository.' };
  const [branch, status] = await Promise.all([
    git(dir, ['branch', '--show-current'], 10000),
    git(dir, ['status', '--porcelain=v1', '-z'], 30000)
  ]);
  return {
    repo: true,
    branch: branch.stdout.trim() || 'HEAD',
    changes: PB.parseGitStatus(status.stdout),
    text: status.text
  };
});

ipcMain.handle('git:branches', async (_, cwd) => {
  const dir = registeredRoot(cwd);
  const [list, current] = await Promise.all([
    git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], 10000),
    git(dir, ['branch', '--show-current'], 10000)
  ]);
  return {
    branches: list.stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
    current: current.stdout.trim()
  };
});

ipcMain.handle('git:diff', async (_, payload) => {
  const dir = registeredRoot(payload && payload.cwd);
  const file = String(payload && payload.file || '');
  const args = ['diff'];
  if (payload && payload.staged) args.push('--cached');
  args.push('--', file);
  const res = await git(dir, args, 30000);
  return res;
});

const gitFileAction = (handler) => async (_, payload) => {
  const dir = registeredRoot(payload && payload.cwd);
  const file = String(payload && payload.file || '');
  if (!file) throw new Error('No file specified.');
  return handler(dir, file);
};

ipcMain.handle('git:stage', gitFileAction((dir, file) => git(dir, ['add', '--', file], 30000)));
ipcMain.handle('git:unstage', gitFileAction((dir, file) => git(dir, ['restore', '--staged', '--', file], 30000)));
ipcMain.handle('git:discard', gitFileAction((dir, file) => git(dir, ['restore', '--', file], 30000)));
ipcMain.handle('git:stageAll', (_, cwd) => git(registeredRoot(cwd), ['add', '-A'], 60000));
ipcMain.handle('git:unstageAll', (_, cwd) => git(registeredRoot(cwd), ['reset'], 60000));

ipcMain.handle('git:commit', async (_, payload) => {
  const dir = registeredRoot(payload && payload.cwd);
  const message = String(payload && payload.message || '').trim();
  if (!message) throw new Error('Commit message is required.');
  if (message.length > 5000) throw new Error('Commit message is too long.');
  return git(dir, ['commit', '-m', message], 120000);
});

ipcMain.handle('git:switch', async (_, payload) => {
  const dir = registeredRoot(payload && payload.cwd);
  const branch = String(payload && payload.branch || '').trim();
  const check = PB.validateBranchName(branch);
  if (!check.ok) throw new Error(check.error);
  return git(dir, ['switch', check.value], 60000);
});

ipcMain.handle('git:createBranch', async (_, payload) => {
  const dir = registeredRoot(payload && payload.cwd);
  const branch = String(payload && payload.branch || '').trim();
  const check = PB.validateBranchName(branch);
  if (!check.ok) throw new Error(check.error);
  return git(dir, ['switch', '-c', check.value], 60000);
});

ipcMain.handle('git:pull', async (_, cwd) => {
  const dir = registeredRoot(cwd);
  const dirRes = await git(dir, ['rev-parse', '--is-inside-work-tree'], 10000);
  if (!dirRes.ok) return { ok: false, text: dirRes.text || 'Not a Git repository.' };
  const [pullRes, fetchRes] = await Promise.all([
    git(dir, ['pull'], 120000),
    git(dir, ['fetch', 'origin'], 120000).catch(() => ({ ok: false, code: -1, text: 'Fetch failed.' }))
  ]);
  return { ok: pullRes.ok, text: pullRes.text || fetchRes.text, pull: pullRes, fetch: fetchRes };
});
ipcMain.handle('git:push', async (_, cwd) => {
  const dir = registeredRoot(cwd);
  const dirRes = await git(dir, ['rev-parse', '--is-inside-work-tree'], 10000);
  if (!dirRes.ok) return { ok: false, text: dirRes.text || 'Not a Git repository.' };
  const res = await git(dir, ['push'], 120000);
  return { ok: res.ok, text: res.text, res };
});
ipcMain.handle('git:fetch', async (_, cwd) => {
  const dir = registeredRoot(cwd);
  const res = await git(dir, ['fetch', 'origin'], 120000);
  return { ok: res.ok, text: res.text, res };
});
ipcMain.handle('git:stash', (_, cwd) => git(registeredRoot(cwd), ['stash', 'push', '-u', '-m', 'PeaBox ' + new Date().toISOString()], 60000));
ipcMain.handle('git:stashPop', (_, cwd) => git(registeredRoot(cwd), ['stash', 'pop'], 60000));

ipcMain.handle('git:remote', async (_, cwd) => {
  const dir = registeredRoot(cwd);
  const res = await git(dir, ['remote', '-v'], 10000);
  const remotes = [];
  const lines = res.stdout.split(/\r?\n/).filter((x) => x && !x.startsWith('Fetching') && !x.startsWith('Pulling'));
  let url = null;
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      if (parts[0] !== 'origin') {
        remotes.push({ name: parts[0], url: parts[1], push: parts[2] || parts[1] });
      }
      url = parts[parts.length - 1];
    }
  }
  return { remotes };
});

/* ---------------- IPC: run ---------------- */

ipcMain.handle('run:start', async (_, payload) => {
  const cwd = assertWorkspaceDir(payload && payload.cwd);
  const exe = String(payload && payload.exe || '').trim();
  const args = Array.isArray(payload && payload.args) ? payload.args.map(String) : [];
  const name = String(payload && payload.name || exe);
  if (!exe) throw new Error('No runtime configured.');
  if (/[\\/]/.test(exe) && !fs.existsSync(exe)) throw new Error('Runtime not found: ' + exe);

  if (runner) { killTree(runner.child); runner = null; }
  const id = ++runSeq;
  let child;
  try {
    child = spawn(exe, args, { cwd, shell: false, windowsHide: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    throw new Error(err.message);
  }
  const started = Date.now();
  runner = { id, child, name };
  child.stdout.on('data', (d) => send('run:output', { id, chunk: d.toString() }));
  child.stderr.on('data', (d) => send('run:output', { id, chunk: d.toString() }));
  child.on('error', (err) => {
    send('run:output', { id, chunk: '\n' + err.message + '\n' });
    send('run:exit', { id, code: -1, duration: Date.now() - started });
    if (runner && runner.id === id) runner = null;
  });
  child.on('close', (code, signal) => {
    if (runner && runner.id === id) runner = null;
    send('run:exit', { id, code: code == null ? -1 : code, signal, duration: Date.now() - started });
  });
  return { id, name, exe, args };
});

ipcMain.handle('run:stop', () => {
  if (runner) { killTree(runner.child); runner = null; }
  return true;
});

ipcMain.handle('run:check', async (_, exe) => {
  const command = String(exe || '').trim();
  if (!command) return { ok: false, text: 'No runtime path.' };
  const res = await runProcess(command, ['--version'], { timeout: 8000 });
  return { ok: res.code === 0, code: res.code, text: (res.stdout || res.stderr || '').trim(), timedOut: res.timedOut };
});

ipcMain.handle('runtime:detect', async (_, payload) => {
  const name = String(payload && payload.name || '').trim();
  const path = String(payload && payload.path || '').trim();
  if (!name) return { ok: false, text: 'No runtime name specified.' };
  const exe = path || name;
  const res = await runProcess(exe, ['--version'], { timeout: 10000 });
  return { ok: res.code === 0, name, path: exe, text: (res.stdout || res.stderr || '').trim(), code: res.code, timedOut: res.timedOut };
});

ipcMain.handle('file:encoding', async (_, payload) => {
  const file = assertAllowed(payload && payload.file);
  const buf = fs.readFileSync(file);
  let encoding = 'utf-8';
  let bomDetected = false;
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) { encoding = 'utf-8'; bomDetected = true; }
  else if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) { encoding = 'utf-16-le'; bomDetected = true; }
  else if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) { encoding = 'utf-16-be'; bomDetected = true; }
  else if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0xFE && buf[3] === 0xFF) { encoding = 'utf-32-be'; bomDetected = true; }
  else if (buf.length >= 4 && buf[0] === 0xFF && buf[1] === 0xFE && buf[2] === 0x00 && buf[3] === 0x00) { encoding = 'utf-32-le'; bomDetected = true; }
  const hasNul = buf.includes(0);
  let lineEnding = 'LF';
  if (buf.includes(0x0D0A)) lineEnding = 'CRLF';
  else if (buf.includes(0x0D)) lineEnding = 'CR';
  return { encoding, bomDetected, hasNul, lineEnding, size: buf.length };
});

ipcMain.handle('file:eol', async (_, payload) => {
  const file = assertAllowed(payload && payload.file);
  const buf = fs.readFileSync(file);
  const crlf = buf.includes(0x0D0A);
  const cr = buf.includes(0x0D) && !crlf;
  return { lineEnding: crlf ? 'CRLF' : cr ? 'CR' : 'LF', hasNul: buf.includes(0) };
});

/* ---------------- IPC: terminal ---------------- */

ipcMain.handle('terminal:create', async (_, payload) => {
  let pty;
  try { pty = require('node-pty'); }
  catch (err) { return { ok: false, error: 'node-pty could not be loaded. Run npm install and restart; if it persists, rebuild it with Visual Studio C++ Build Tools. ' + err.message }; }

  let cwd;
  try { cwd = payload && payload.cwd ? assertWorkspaceDir(payload.cwd) : app.getPath('home'); }
  catch { cwd = app.getPath('home'); }

  let shellPath = String(payload && payload.shell || '').trim();
  if (!shellPath) {
    if (IS_WIN) shellPath = fs.existsSync(process.env.COMSPEC || '') ? (process.env.COMSPEC || 'powershell.exe') : 'powershell.exe';
    else shellPath = process.env.SHELL || '/bin/bash';
  }
  if (IS_WIN && /powershell\.exe$/i.test(shellPath) && !fs.existsSync(shellPath)) shellPath = 'powershell.exe';
  const args = IS_WIN && /powershell\.exe$/i.test(shellPath) ? ['-NoLogo'] : [];
  const cols = PB.clamp(payload && payload.cols || 100, 10, 400);
  const rows = PB.clamp(payload && payload.rows || 30, 5, 200);

  try {
    const proc = pty.spawn(shellPath, args, {
      name: 'xterm-256color', cols, rows, cwd,
      env: process.env, useConpty: IS_WIN
    });
    const id = ++termSeq;
    const clientId = String(payload && payload.clientId || '');
    terminals.set(id, { proc, shell: shellPath, clientId });
    proc.onData((data) => send('terminal:data', { id, clientId, data }));
    proc.onExit((e) => {
      terminals.delete(id);
      send('terminal:exit', { id, clientId, exitCode: e.exitCode });
    });
    return { ok: true, id, clientId, shell: shellPath, conpty: IS_WIN };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.on('terminal:input', (_, payload) => {
  const t = terminals.get(payload && payload.id);
  if (t) { try { t.proc.write(String(payload.data)); } catch { /* ignore */ } }
});

ipcMain.on('terminal:resize', (_, payload) => {
  const t = terminals.get(payload && payload.id);
  if (t) { try { t.proc.resize(PB.clamp(payload.cols, 2, 400), PB.clamp(payload.rows, 1, 200)); } catch { /* ignore */ } }
});

ipcMain.handle('terminal:kill', (_, id) => {
  const t = terminals.get(id);
  if (t) { try { t.proc.kill(); } catch { /* ignore */ } terminals.delete(id); }
  return true;
});

/* ---------------- IPC: recovery ---------------- */

ipcMain.handle('recovery:save', (_, payload) => {
  const file = assertAllowed(payload && payload.file);
  const content = payload && payload.content;
  if (typeof content !== 'string') throw new Error('Invalid recovery content.');
  if (content.length > 20 * 1024 * 1024) throw new Error('File is too large for recovery.');
  fs.mkdirSync(recoveryDir(), { recursive: true });
  writeFileAtomic.sync(recoveryPath(file), JSON.stringify({
    file, content, savedAt: new Date().toISOString(), size: content.length
  }), { encoding: 'utf8', fsync: true });
  return true;
});

ipcMain.handle('recovery:list', () => {
  pruneRecovery();
  let names = [];
  try { names = fs.readdirSync(recoveryDir()).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const name of names) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(recoveryDir(), name), 'utf8'));
      if (!rec || !rec.file || typeof rec.content !== 'string') continue;
      out.push({
        file: rec.file, savedAt: rec.savedAt, size: rec.size || rec.content.length,
        exists: isFile(rec.file)
      });
      if (isFile(rec.file)) addAllowed(rec.file);
    } catch { /* ignore broken entry */ }
  }
  return out.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
});

ipcMain.handle('recovery:read', (_, file) => {
  const rec = readRecoveryFile(String(file || ''));
  if (!rec) return null;
  return { content: rec.content, savedAt: rec.savedAt };
});

ipcMain.handle('recovery:clear', (_, file) => {
  try { fs.rmSync(recoveryPath(String(file || '')), { force: true }); return true; } catch { return false; }
});

/* ---------------- file watchers ---------------- */

ipcMain.handle('watch:start', (_, file) => {
  const p = assertAllowed(file);
  if (watchers.has(normKey(p))) return true;
  try {
    const w = fs.watch(p, { persistent: false }, () => {
      try {
        const st = fs.statSync(p);
        send('file:changed', { file: p, mtime: st.mtimeMs });
      } catch {
        send('file:changed', { file: p, deleted: true });
      }
    });
    w.on('error', () => { try { w.close(); } catch { /* ignore */ } watchers.delete(normKey(p)); });
    watchers.set(normKey(p), w);
    return true;
  } catch { return false; }
});

ipcMain.handle('watch:stop', (_, file) => {
  const key = normKey(file);
  try { watchers.get(key)?.close(); } catch { /* ignore */ }
  watchers.delete(key);
  return true;
});

/* ---------------- lifecycle ---------------- */

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
} else {
  app.quit();
}

app.whenReady().then(() => {
  app.on('web-contents-created', (_, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    contents.on('will-attach-webview', (e) => e.preventDefault());
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (runner) { killTree(runner.child); runner = null; }
  for (const t of terminals.values()) { try { t.proc.kill(); } catch { /* ignore */ } }
  terminals.clear();
  for (const w of watchers.values()) { try { w.close(); } catch { /* ignore */ } }
  watchers.clear();
  try { if (workspaceWatcher) workspaceWatcher.close(); } catch { /* ignore */ }
});

process.on('uncaughtException', (err) => {
  log('uncaught exception', err);
});
process.on('unhandledRejection', (err) => {
  log('unhandled rejection', err);
});

