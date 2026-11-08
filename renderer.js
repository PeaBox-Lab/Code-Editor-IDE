'use strict';

(function () {

const PB = window.PeaBoxShared;
const api = window.api;
const $ = (id) => document.getElementById(id);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const S = {
  state: null,
  root: null,
  current: null,
  editor: null,
  models: new Map(),
  rootChildren: [],
  treeCache: new Map(),
  expanded: new Set(),
  selectedPath: null,
  fileIndex: null,
  fileIndexRoot: null,
  searchToken: 0,
  git: null,
  gitBusy: false,
  gitTimer: null,
  runId: null,
  running: false,
  runBuffer: null,
  runPendingExit: null,
  terminals: new Map(),
  activeTerminal: null,
  terminalSeq: 0,
  palette: { open: false, mode: 'files', items: [], index: 0, query: '' },
  modalOpen: false,
  menuCleanup: null,
  persistTimer: null,
  closePrompt: false,
  recoveryOffered: false,
  panel: 'terminalPane'
};

const settings = () => S.state.settings;
const currentEntry = () => (S.current ? S.models.get(S.current) : null);
const nameOf = (p) => PB.basename(p);
const notify = (message, type, timeout) => toast(message, type, timeout);

/* ---------------- DOM helpers ---------------- */

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function icon(name, cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls || 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.appendChild(use);
  return svg;
}

function badgeFor(file) {
  const b = PB.fileBadge(file);
  return el('span', 'file-badge ' + b.cls, b.label);
}

function setHidden(node, hidden) {
  if (node) node.classList.toggle('hidden', !!hidden);
}

/* ---------------- toasts ---------------- */

function toast(message, type, timeout) {
  const box = el('div', 'toast ' + (type || 'info'));
  const body = el('div', 't-body', message);
  const close = el('button', 't-close', '×');
  close.setAttribute('aria-label', 'Dismiss notification');
  close.onclick = () => box.remove();
  box.append(icon(type === 'error' ? 'warning' : type === 'success' ? 'check' : 'info'), body, close);
  $('toasts').appendChild(box);
  const ms = timeout === undefined ? 4200 : timeout;
  if (ms > 0) setTimeout(() => { if (box.isConnected) box.remove(); }, ms);
  return box;
}

/* ---------------- modals ---------------- */

function showModal(options) {
  return new Promise((resolve) => {
    const overlay = $('modal');
    const title = $('modalTitle');
    const body = $('modalBody');
    const footer = $('modalFooter');
    const previous = document.activeElement;

    title.textContent = options.title || '';
    body.replaceChildren();
    if (options.body instanceof Node) body.appendChild(options.body);
    else if (typeof options.body === 'string') body.innerHTML = options.body;

    footer.replaceChildren();
    let done = false;

    function finish(value) {
      if (done) return;
      done = true;
      overlay.classList.add('hidden');
      document.removeEventListener('keydown', onKey, true);
      S.modalOpen = false;
      if (previous && previous.focus) { try { previous.focus(); } catch { /* ignore */ } }
      resolve(value);
    }

    (options.actions || [{ label: 'Close', value: null }]).forEach((action) => {
      const btn = el('button', action.class || '', action.label);
      btn.onclick = () => finish(action.value === undefined ? action.label : action.value);
      footer.appendChild(btn);
    });

    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(null); }
      else if (event.key === 'Tab') {
        const focusables = $$('button, input, textarea, select, [tabindex]:not([tabindex="-1"])', overlay)
          .filter((n) => !n.disabled && n.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }

    overlay.classList.remove('hidden');
    S.modalOpen = true;
    document.addEventListener('keydown', onKey, true);

    const focusTarget = body.querySelector('input, textarea, select, button') || footer.querySelector('button');
    if (focusTarget) setTimeout(() => focusTarget.focus(), 20);

    if (typeof options.onReady === 'function') options.onReady({ body, footer, finish });
  });
}

function modalChoice(title, message, actions) {
  const body = el('div');
  body.appendChild(el('p', null, message));
  return showModal({ title, body, actions });
}

function modalInput(title, labelText, value, confirmLabel, note) {
  const body = el('div');
  const label = el('label', 'modal-note', labelText);
  const input = el('input', 'modal-input');
  input.type = 'text';
  input.value = value || '';
  input.spellcheck = false;
  body.append(label, input);
  if (note) body.appendChild(el('div', 'modal-note', note));
  return showModal({
    title, body,
    actions: [{ label: 'Cancel', value: null }, { label: confirmLabel || 'Create', value: '__ok', class: 'primary' }],
    onReady: ({ finish }) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish('__ok'); }
      });
      setTimeout(() => { input.focus(); input.select(); }, 30);
      input.dataset.finish = '1';
      input.addEventListener('input', () => { input.dataset.value = input.value; });
      input.__finish = finish;
    }
  }).then((v) => {
    if (v === '__ok') return input.value.trim();
    return null;
  });
}

/* ---------------- context menu ---------------- */

function hideContextMenu() {
  const menu = $('contextMenu');
  menu.classList.add('hidden');
  menu.replaceChildren();
  if (S.menuCleanup) { S.menuCleanup(); S.menuCleanup = null; }
}

function showContextMenu(x, y, items) {
  hideContextMenu();
  const menu = $('contextMenu');
  items.forEach((item) => {
    if (item.separator) { menu.appendChild(el('div', 'context-sep')); return; }
    const btn = el('button', 'context-item' + (item.danger ? ' danger' : ''));
    btn.appendChild(icon(item.icon || 'file'));
    btn.appendChild(el('span', null, item.label));
    btn.disabled = !!item.disabled;
    btn.onclick = () => { hideContextMenu(); item.run(); };
    menu.appendChild(btn);
  });
  menu.classList.remove('hidden');
  menu.style.left = Math.min(x, window.innerWidth - 210) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 8) + 'px';

  const close = (event) => {
    if (event.type === 'keydown' && event.key !== 'Escape') return;
    if (event.type === 'pointerdown' && menu.contains(event.target)) return;
    hideContextMenu();
  };
  document.addEventListener('pointerdown', close, true);
  document.addEventListener('keydown', close, true);
  window.addEventListener('blur', hideContextMenu, { once: true });
  document.addEventListener('scroll', hideContextMenu, true);
  S.menuCleanup = () => {
    document.removeEventListener('pointerdown', close, true);
    document.removeEventListener('keydown', close, true);
    document.removeEventListener('scroll', hideContextMenu, true);
  };
}

/* ---------------- theme / layout ---------------- */

function resolvedTheme() {
  if (settings().theme === 'system') {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return settings().theme;
}

function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  const btn = $('themeBtn');
  btn.replaceChildren(icon(theme === 'dark' ? 'sun' : 'moon'));
  btn.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  if (S.editor) monaco.editor.setTheme(theme === 'dark' ? 'peabox-dark' : 'peabox-light');
}

function applyLayout() {
  const s = settings();
  document.documentElement.style.setProperty('--sidebar-width', s.sidebarWidth + 'px');
  document.documentElement.style.setProperty('--panel-height', s.panelHeight + 'px');
  $('sidebar').classList.toggle('collapsed', !s.showSidebar);
  $('spacesStatus').textContent = 'Spaces: ' + s.tabSize;
}

function applyEditorOptions() {
  if (!S.editor) return;
  const s = settings();
  S.editor.updateOptions({
    fontSize: s.fontSize,
    fontFamily: s.fontFamily,
    tabSize: s.tabSize,
    wordWrap: s.wordWrap ? 'on' : 'off',
    minimap: { enabled: s.minimap }
  });
  $('spacesStatus').textContent = 'Spaces: ' + s.tabSize;
}

function bindResizers() {
  const sidebar = $('sidebar');
  const sidebarResizer = $('sidebarResizer');
  sidebarResizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebar.getBoundingClientRect().width;
    sidebarResizer.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const width = PB.clamp(startWidth + ev.clientX - startX, 180, 520);
      document.documentElement.style.setProperty('--sidebar-width', width + 'px');
    };
    const up = () => {
      sidebarResizer.removeEventListener('pointermove', move);
      sidebarResizer.removeEventListener('pointerup', up);
      settings().sidebarWidth = Math.round(sidebar.getBoundingClientRect().width);
      persistSoon();
    };
    sidebarResizer.addEventListener('pointermove', move);
    sidebarResizer.addEventListener('pointerup', up);
  });

  const panel = $('panel');
  const panelResizer = $('panelResizer');
  panelResizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = panel.getBoundingClientRect().height;
    panelResizer.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const height = PB.clamp(startHeight + startY - ev.clientY, 120, 700);
      document.documentElement.style.setProperty('--panel-height', height + 'px');
    };
    const up = () => {
      panelResizer.removeEventListener('pointermove', move);
      panelResizer.removeEventListener('pointerup', up);
      settings().panelHeight = Math.round(panel.getBoundingClientRect().height);
      persistSoon();
      if (S.activeTerminal) fitTerminal(S.activeTerminal);
    };
    panelResizer.addEventListener('pointermove', move);
    panelResizer.addEventListener('pointerup', up);
  });
}

function persistSoon() {
  if (!S.state) return;
  clearTimeout(S.persistTimer);
  S.persistTimer = setTimeout(() => persistNow(), 250);
}

function persistNow() {
  if (!S.state) return;
  S.state.lastFolder = S.root;
  S.state.openFiles = Array.from(S.models.values()).filter((e) => !e.virtual && e.path).map((e) => e.path);
  const cur = currentEntry();
  S.state.activeFile = cur && !cur.virtual ? cur.path : null;
  return api.app.saveState(S.state).catch((err) => toast('Could not save session: ' + err.message, 'error'));
}

/* ---------------- views ---------------- */

function showView(view) {
  const map = { explorer: 'explorerView', search: 'searchView', git: 'gitView' };
  Object.values(map).forEach((id) => setHidden($(id), true));
  setHidden($(map[view] || 'explorerView'), false);
  $$('.activity[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'git') refreshGit();
  if (view === 'search') setTimeout(() => $('searchInput').focus(), 20);
}

function toggleSidebar(force) {
  const s = settings();
  s.showSidebar = force === undefined ? !s.showSidebar : !!force;
  applyLayout();
  persistSoon();
  if (S.activeTerminal) fitTerminal(S.activeTerminal);
}

/* ---------------- editor ---------------- */

let monacoReadyResolve;
const monacoReady = new Promise((resolve) => { monacoReadyResolve = resolve; });

function initMonaco() {
  // Monaco's language workers cannot be fetched over file://. Provide an inert
  // worker so editing and Monarch tokenisation work without console errors.
  self.MonacoEnvironment = {
    getWorkerUrl: function () {
      return URL.createObjectURL(new Blob(['self.onmessage = function () {};'], { type: 'text/javascript' }));
    }
  };
  require.config({ paths: { vs: './node_modules/monaco-editor/min/vs' } });
  require(['vs/editor/editor.main'], () => {
    monaco.editor.defineTheme('peabox-dark', {
      base: 'vs-dark', inherit: true,
      rules: [
        { token: 'comment', foreground: '6f7c93', fontStyle: 'italic' },
        { token: 'keyword', foreground: '8ab4ff' },
        { token: 'string', foreground: 'a8d98b' },
        { token: 'number', foreground: 'e8c06a' },
        { token: 'type', foreground: '7fd6d0' }
      ],
      colors: {
        'editor.background': '#0f1116',
        'editor.foreground': '#dbe2ee',
        'editorLineNumber.foreground': '#4d5a70',
        'editorLineNumber.activeForeground': '#94a3ba',
        'editor.selectionBackground': '#24324a',
        'editor.inactiveSelectionBackground': '#1c2638',
        'editor.lineHighlightBackground': '#151b26',
        'editorCursor.foreground': '#4c8dff',
        'editorIndentGuide.background1': '#222a39',
        'editorIndentGuide.activeBackground1': '#3a4a63',
        'editorWidget.background': '#151922',
        'editorWidget.border': '#354054',
        'editorSuggestWidget.background': '#151922',
        'editorSuggestWidget.selectedBackground': '#26344c',
        'editorHoverWidget.background': '#151922',
        'editorHoverWidget.border': '#354054',
        'scrollbarSlider.background': '#35405480',
        'scrollbarSlider.hoverBackground': '#4d5a70a0'
      }
    });
    monaco.editor.defineTheme('peabox-light', {
      base: 'vs', inherit: true,
      rules: [
        { token: 'comment', foreground: '7a879c', fontStyle: 'italic' },
        { token: 'keyword', foreground: '1f5fd0' },
        { token: 'string', foreground: '2b7a3f' },
        { token: 'number', foreground: '9a6100' }
      ],
      colors: {
        'editor.background': '#fbfcfe',
        'editor.foreground': '#263244',
        'editor.lineHighlightBackground': '#f0f4fa',
        'editor.selectionBackground': '#cfe0ff',
        'editorCursor.foreground': '#2563eb',
        'editorWidget.background': '#f2f5fa',
        'editorWidget.border': '#c0cbdb',
        'editorSuggestWidget.background': '#f2f5fa',
        'editorSuggestWidget.selectedBackground': '#dbe8ff',
        'editorHoverWidget.background': '#f2f5fa',
        'editorHoverWidget.border': '#c0cbdb'
      }
    });

    S.editor = monaco.editor.create($('editor'), {
      theme: resolvedTheme() === 'dark' ? 'peabox-dark' : 'peabox-light',
      automaticLayout: true,
      fontSize: settings().fontSize,
      fontFamily: settings().fontFamily,
      tabSize: settings().tabSize,
      wordWrap: settings().wordWrap ? 'on' : 'off',
      minimap: { enabled: settings().minimap },
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      renderWhitespace: 'selection',
      renderLineHighlight: 'all',
      scrollBeyondLastLine: false,
      padding: { top: 10, bottom: 10 },
      overviewRulerBorder: false,
      fixedOverflowWidgets: true,
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true }
    });

    S.editor.onDidChangeCursorPosition((e) => {
      $('position').textContent = 'Ln ' + e.position.lineNumber + ', Col ' + e.position.column;
    });
    S.editor.onDidChangeModel(() => updateEol());
    monacoReadyResolve();
  });
}

function updateEol() {
  if (!S.editor || !S.editor.getModel()) { $('eolStatus').textContent = '—'; return; }
  $('eolStatus').textContent = S.editor.getModel().getEOL() === '\r\n' ? 'CRLF' : 'LF';
}

function updateStatus() {
  const entry = currentEntry();
  $('language').textContent = entry ? languageLabel(entry) : 'Plain Text';
  updateEol();
  updateDirtyStatus();
  updatePositionStatus();
}

function languageLabel(entry) {
  if (!entry) return 'Plain Text';
  if (entry.virtual) return 'Diff';
  const lang = PB.normalizeLanguage(entry.path);
  return lang.charAt(0).toUpperCase() + lang.slice(1);
}

function updatePositionStatus() {
  if (!S.editor) return;
  const pos = S.editor.getPosition();
  if (!pos) { $('position').textContent = 'Ln 1, Col 1'; return; }
  $('position').textContent = 'Ln ' + pos.lineNumber + ', Col ' + pos.column;
}

function updateDirtyStatus() {
  const dirty = Array.from(S.models.values()).filter((e) => e.dirty && !e.virtual).length;
  $('dirtyStatus').textContent = dirty ? dirty + ' unsaved' : '';
  $('dirtyStatus').style.display = dirty ? '' : 'none';
}

/* ---------------- workspace ---------------- */

function showWelcome(show) {
  setHidden($('welcome'), !show);
}

function syncWelcome() {
  showWelcome(!currentEntry());
}

function relativeToRoot(p) {
  if (!S.root) return p;
  const root = PB.normalizePath(S.root);
  const full = PB.normalizePath(p);
  if (full.toLowerCase() === root.toLowerCase()) return PB.basename(p);
  if (full.toLowerCase().indexOf(root.toLowerCase() + '/') === 0) return full.slice(root.length + 1);
  return p;
}

async function loadWorkspace(tree, options) {
  options = options || {};
  S.root = tree.root;
  S.rootChildren = tree.children || [];
  S.treeCache.clear();
  S.expanded.clear();
  S.selectedPath = null;
  S.fileIndex = null;
  S.fileIndexRoot = null;
  S.git = null;
  $('workspace').textContent = S.root;
  $('workspace').title = S.root;
  $('workspaceBtn').title = S.root;
  renderExplorer();
  hideContextMenu();
  if (!options.keepRecent) {
    S.state.recent = [S.root].concat((S.state.recent || []).filter((x) => x.toLowerCase() !== S.root.toLowerCase())).slice(0, 12);
  }
  renderRecent();
  setHidden($('gitSummary'), false);
  refreshGit();
  refreshBranches();
  api.workspace.watchStart(S.root).catch(() => {});
  persistSoon();
  if (!options.silent) toast('Opened ' + PB.basename(S.root), 'success', 1800);
}

async function openWorkspaceDialog() {
  try {
    const tree = await api.workspace.choose();
    if (!tree) return;
    await loadWorkspace(tree);
    showView('explorer');
  } catch (err) { toast(err.message, 'error'); }
}

async function openWorkspacePath(dir) {
  try {
    const tree = await api.workspace.load(dir);
    if (!tree) { toast('Folder not found: ' + dir, 'error'); return false; }
    await loadWorkspace(tree, { silent: true });
    return true;
  } catch (err) {
    toast(err.message, 'error');
    return false;
  }
}

async function openRecent(dir) {
  const ok = await openWorkspacePath(dir);
  if (!ok) {
    S.state.recent = (S.state.recent || []).filter((x) => x !== dir);
    renderRecent();
    persistSoon();
  }
}

function removeRecent(dir) {
  S.state.recent = (S.state.recent || []).filter((x) => x !== dir);
  renderRecent();
  persistSoon();
}

function renderRecent() {
  const host = $('recent');
  host.replaceChildren();
  const items = (S.state && S.state.recent) || [];
  if (!items.length) {
    host.appendChild(el('div', 'muted small', 'Projects you open will appear here.'));
    return;
  }
  items.forEach((dir) => {
    const row = el('div', 'recent-item');
    const body = el('div', 'recent-body');
    body.append(el('div', 'recent-name', PB.basename(dir) || dir), el('div', 'recent-path', dir));
    const remove = el('button', 'mini-btn', '');
    remove.appendChild(icon('close'));
    remove.title = 'Remove from recent';
    remove.onclick = (e) => { e.stopPropagation(); removeRecent(dir); };
    row.append(icon('folder'), body, remove);
    row.title = dir;
    row.onclick = () => openRecent(dir);
    host.appendChild(row);
  });
}

/* ---------------- explorer ---------------- */

function renderExplorer() {
  const host = $('tree');
  host.replaceChildren();
  host.classList.toggle('empty', !S.rootChildren.length);
  if (!S.root) { host.textContent = 'Open a folder to begin.'; return; }
  if (!S.rootChildren.length) { host.textContent = 'This folder is empty.'; return; }
  appendNodes(S.rootChildren, host, 0);
}

function appendNodes(nodes, host, depth) {
  for (const node of nodes) {
    const row = createTreeRow(node, depth);
    host.appendChild(row);
    if (node.dir && S.expanded.has(node.path)) {
      const kids = S.treeCache.get(node.path);
      const childHost = el('div', 'tree-children');
      host.appendChild(childHost);
      if (kids) appendNodes(kids, childHost, depth + 1);
      else {
        childHost.classList.add('loading');
        childHost.textContent = 'Loading…';
        loadChildren(node.path).then(() => renderExplorer());
      }
    }
  }
}

function createTreeRow(node, depth) {
  const row = el('div', 'tree-row ' + (node.dir ? 'dir' : 'file'));
  row.style.setProperty('--depth', depth);
  row.dataset.path = node.path;
  row.tabIndex = 0;
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-level', String(depth + 1));
  row.classList.toggle('selected', S.selectedPath === node.path);
  row.title = node.path;

  if (node.dir) {
    const open = S.expanded.has(node.path);
    row.setAttribute('aria-expanded', String(open));
    row.appendChild(icon(open ? 'chevron-down' : 'chevron-right', 'icon chevron'));
    row.appendChild(icon(open ? 'folder-open' : 'folder', 'icon folder-icon'));
  } else {
    row.appendChild(el('span', 'spacer'));
    row.appendChild(badgeFor(node.path));
  }
  row.appendChild(el('span', 'tree-name', node.name));

  row.onclick = (e) => {
    e.stopPropagation();
    S.selectedPath = node.path;
    $$('.tree-row.selected').forEach((n) => n.classList.remove('selected'));
    row.classList.add('selected');
    if (node.dir) toggleFolder(node);
    else openFile(node.path);
  };

  row.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (node.dir) toggleFolder(node); else openFile(node.path);
    } else if (e.key === 'ArrowRight' && node.dir && !S.expanded.has(node.path)) {
      e.preventDefault(); toggleFolder(node);
    } else if (e.key === 'ArrowLeft' && node.dir && S.expanded.has(node.path)) {
      e.preventDefault(); toggleFolder(node);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const rows = $$('.tree-row', $('tree'));
      const index = rows.indexOf(row);
      const next = rows[index + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) next.focus();
    }
  };

  row.oncontextmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    S.selectedPath = node.path;
    $$('.tree-row.selected').forEach((n) => n.classList.remove('selected'));
    row.classList.add('selected');
    showTreeMenu(e.clientX, e.clientY, node);
  };

  return row;
}

async function loadChildren(dir) {
  try {
    const kids = await api.workspace.children(dir);
    S.treeCache.set(dir, kids);
    return kids;
  } catch (err) {
    S.expanded.delete(dir);
    toast('Could not read folder: ' + err.message, 'error');
    return [];
  }
}

async function toggleFolder(node) {
  if (S.expanded.has(node.path)) {
    S.expanded.delete(node.path);
    renderExplorer();
    return;
  }
  S.expanded.add(node.path);
  if (!S.treeCache.has(node.path)) await loadChildren(node.path);
  renderExplorer();
}

async function refreshExplorer() {
  if (!S.root) return;
  const expanded = Array.from(S.expanded);
  try {
    const tree = await api.workspace.refresh(S.root);
    S.rootChildren = tree.children || [];
    S.treeCache.clear();
    for (const dir of expanded) {
      try { S.treeCache.set(dir, await api.workspace.children(dir)); } catch { S.expanded.delete(dir); }
    }
    renderExplorer();
    S.fileIndex = null;
    S.fileIndexRoot = null;
  } catch (err) { toast('Refresh failed: ' + err.message, 'error'); }
}

function targetDir() {
  if (!S.selectedPath) return S.root;
  if (S.selectedPath === S.root) return S.root;
  const node = findNode(S.selectedPath);
  if (node && node.dir) return node.path;
  return PB.dirname(S.selectedPath);
}

function findNode(target, nodes) {
  nodes = nodes || S.rootChildren;
  for (const node of nodes) {
    if (node.path === target) return node;
    if (node.dir) {
      const kids = S.treeCache.get(node.path);
      if (kids) {
        const hit = findNode(target, kids);
        if (hit) return hit;
      }
    }
  }
  return null;
}

function showTreeMenu(x, y, node) {
  const items = [];
  if (!node.dir) items.push({ label: 'Open', icon: 'file', run: () => openFile(node.path) });
  items.push(
    { label: 'New File…', icon: 'file-plus', run: () => createFileFlow(node.dir ? node.path : PB.dirname(node.path)) },
    { label: 'New Folder…', icon: 'folder-plus', run: () => createFolderFlow(node.dir ? node.path : PB.dirname(node.path)) },
    { separator: true },
    { label: 'Rename…', icon: 'edit', run: () => renameNode(node) },
    { label: 'Delete', icon: 'trash', danger: true, run: () => deleteNode(node) },
    { separator: true },
    { label: 'Copy Path', icon: 'copy', run: () => copyText(node.path) },
    { label: 'Copy Relative Path', icon: 'copy', run: () => copyText(relativeToRoot(node.path)) },
    { label: 'Reveal in File Explorer', icon: 'external', run: () => api.file.reveal(node.path).catch((e) => toast(e.message, 'error')) }
  );
  showContextMenu(x, y, items);
}

async function copyText(text) {
  try { await api.app.copy(text); toast('Copied to clipboard', 'success', 1400); }
  catch (err) { toast(err.message, 'error'); }
}

async function createFileFlow(dir) {
  if (!S.root) return fileNewFlow();
  dir = dir || targetDir();
  const rel = relativeToRoot(dir);
  const name = await modalInput('New File', 'File name', '', 'Create', 'Created in ' + rel);
  if (!name) return;
  const check = PB.validateEntryName(name);
  if (!check.ok) { toast(check.error, 'error'); return; }
  try {
    const file = await api.workspace.createFile({ dir, name });
    await refreshExplorer();
    await openFile(file);
    maybeRefreshGit();
  } catch (err) { toast(err.message, 'error'); }
}

async function createFolderFlow(dir) {
  if (!S.root) { toast('Open a folder first.', 'warn'); return; }
  dir = dir || targetDir();
  const rel = relativeToRoot(dir);
  const name = await modalInput('New Folder', 'Folder name', '', 'Create', 'Created in ' + rel);
  if (!name) return;
  const check = PB.validateEntryName(name);
  if (!check.ok) { toast(check.error, 'error'); return; }
  try {
    await api.workspace.createFolder({ dir, name });
    await refreshExplorer();
    maybeRefreshGit();
  } catch (err) { toast(err.message, 'error'); }
}

async function fileNewFlow() {
  try {
    const file = await api.file.newFile(S.root);
    if (!file) return;
    await openFile(file);
    if (S.root && PB.isSubPath(S.root, file)) await refreshExplorer();
  } catch (err) { toast(err.message, 'error'); }
}

async function openFilesFlow() {
  try {
    const files = await api.file.openDialog();
    if (!files || !files.length) return;
    for (const file of files) await openFile(file);
  } catch (err) { toast(err.message, 'error'); }
}

async function renameNode(node) {
  if (!node) return;
  const name = await modalInput('Rename', 'New name', node.name, 'Rename', node.path);
  if (!name || name === node.name) return;
  const check = PB.validateEntryName(name);
  if (!check.ok) { toast(check.error, 'error'); return; }
  if (node.dir) {
    const prefix = PB.normalizePath(node.path).toLowerCase() + '/';
    const hasOpen = Array.from(S.models.values()).some((e) => e.path && PB.normalizePath(e.path).toLowerCase().indexOf(prefix) === 0);
    if (hasOpen) { toast('Close files inside this folder before renaming it.', 'warn', 5000); return; }
  }
  const entry = S.models.get(node.path);
  if (entry && entry.dirty) {
    const saved = await saveFile(entry);
    if (!saved || entry.dirty) return;
  }
  try {
    const newPath = await api.file.rename(node.path, name);
    if (entry) {
      await closeEntry(entry, true);
      await openFile(newPath);
    }
    S.selectedPath = newPath;
    await refreshExplorer();
    maybeRefreshGit();
    toast('Renamed to ' + name, 'success', 1600);
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteNode(node) {
  if (!node) return;
  if (node.dir) {
    const prefix = PB.normalizePath(node.path).toLowerCase() + '/';
    const hasOpen = Array.from(S.models.values()).some((e) => e.path && (PB.normalizePath(e.path).toLowerCase() === PB.normalizePath(node.path).toLowerCase() || PB.normalizePath(e.path).toLowerCase().indexOf(prefix) === 0));
    if (hasOpen) { toast('Close files inside this folder before deleting it.', 'warn', 5000); return; }
  }
  const answer = await modalChoice(
    'Delete ' + (node.dir ? 'folder' : 'file') + '?',
    'Permanently delete "' + node.name + '"? This cannot be undone.',
    [{ label: 'Cancel', value: null }, { label: 'Delete', value: 'delete', class: 'danger' }]
  );
  if (answer !== 'delete') return;
  const entry = S.models.get(node.path);
  if (entry) await closeEntry(entry, true);
  try {
    await api.file.remove(node.path);
    if (S.root && PB.normalizePath(S.selectedPath || '').toLowerCase().indexOf(PB.normalizePath(node.path).toLowerCase()) === 0) S.selectedPath = null;
    await refreshExplorer();
    maybeRefreshGit();
    toast('Deleted ' + node.name, 'success', 1800);
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------------- tabs / editor entries ---------------- */

function renderTabs() {
  const host = $('tabs');
  host.replaceChildren();
  for (const entry of S.models.values()) {
    const tab = el('div', 'tab' + (entry.key === S.current ? ' active' : '') + (entry.dirty ? ' dirty' : ''));
    tab.tabIndex = 0;
    tab.title = entry.virtual ? entry.label : entry.path;
    tab.appendChild(entry.virtual ? icon('diff', 'file-badge') : badgeFor(entry.path));
    tab.appendChild(el('span', 'tab-name', entry.virtual ? entry.label : nameOf(entry.path)));
    tab.appendChild(el('span', 'tab-dot'));
    const close = el('button', 'tab-close');
    close.appendChild(icon('close'));
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close ' + (entry.virtual ? entry.label : nameOf(entry.path)));
    close.onclick = (e) => { e.stopPropagation(); closeEntry(entry); };
    tab.appendChild(close);
    tab.onclick = () => activateEntry(entry.key);
    tab.onauxclick = (e) => { if (e.button === 1) { e.preventDefault(); closeEntry(entry); } };
    tab.oncontextmenu = (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Close', icon: 'close', run: () => closeEntry(entry) },
        { label: 'Close Others', icon: 'close', run: () => closeOthers(entry) },
        { label: 'Close All', icon: 'close', run: () => closeAll() },
        { separator: true },
        { label: 'Copy Path', icon: 'copy', disabled: entry.virtual, run: () => copyText(entry.path) },
        { label: 'Reveal in File Explorer', icon: 'external', disabled: entry.virtual, run: () => api.file.reveal(entry.path).catch((err) => toast(err.message, 'error')) }
      ]);
    };
    entry.tabEl = tab;
    host.appendChild(tab);
    if (entry.key === S.current) setTimeout(() => tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }), 0);
  }
  updateDirtyStatus();
}

function updateTab(entry) {
  if (!entry.tabEl) return;
  entry.tabEl.classList.toggle('active', entry.key === S.current);
  entry.tabEl.classList.toggle('dirty', !!entry.dirty);
  entry.tabEl.title = entry.virtual ? entry.label : entry.path;
  if (entry.virtual) return;
  const name = entry.tabEl.querySelector('.tab-name');
  if (name) name.textContent = nameOf(entry.path) + (entry.deleted ? ' (deleted)' : '');
}

function renderBreadcrumb() {
  const host = $('breadcrumb');
  const entry = currentEntry();
  if (!entry) { setHidden(host, true); host.replaceChildren(); return; }
  setHidden(host, false);
  host.replaceChildren();
  if (entry.virtual) {
    host.appendChild(el('span', 'crumb', entry.label));
    return;
  }
  const rel = relativeToRoot(entry.path);
  const parts = rel.split('/');
  parts.forEach((part, index) => {
    if (index) host.appendChild(el('span', 'sep', '›'));
    host.appendChild(el('span', 'crumb', part));
  });
}

function syncEditorState() {
  const entry = currentEntry();
  if (!S.editor) return;
  S.editor.updateOptions({ readOnly: !!(entry && entry.virtual) });
  if (entry) S.editor.setModel(entry.model);
  else S.editor.setModel(null);
  renderTabs();
  renderBreadcrumb();
  updateStatus();
  syncWelcome();
}

function activateEntry(key) {
  const entry = S.models.get(key);
  if (!entry) return;
  S.current = key;
  hideContextMenu();
  S.editor.updateOptions({ readOnly: !!entry.virtual });
  S.editor.setModel(entry.model);
  S.current = key;
  renderTabs();
  renderBreadcrumb();
  updateStatus();
  syncWelcome();
  S.editor.focus();
  persistSoon();
}

function openVirtual(label, content) {
  const key = 'virtual:' + label + ':' + Date.now();
  const model = monaco.editor.createModel(content, 'plaintext', monaco.Uri.parse('peabox-diff://' + encodeURIComponent(label) + '/' + Date.now()));
  const entry = {
    key, path: null, model, label, dirty: false, deleted: false, virtual: true,
    mtime: 0, saving: false, reloading: false, pendingSave: false
  };
  S.models.set(key, entry);
  activateEntry(key);
}

async function openFile(filePath, line, column) {
  if (!filePath) return;
  let entry = S.models.get(filePath);
  if (!entry) {
    try {
      const res = await api.file.read(filePath);
      const model = monaco.editor.createModel(res.content, PB.normalizeLanguage(filePath), monaco.Uri.file(filePath));
      entry = {
        key: filePath, path: filePath, model, dirty: false, deleted: false, virtual: false,
        mtime: res.mtime, size: res.size, saving: false, reloading: false, pendingSave: false,
        recoveryTimer: null, autosaveTimer: null
      };
      S.models.set(filePath, entry);
      bindModel(entry);
      api.file.watchStart(filePath).catch(() => {});
    } catch (err) {
      toast('Could not open ' + nameOf(filePath) + ': ' + err.message, 'error', 6000);
      return;
    }
  }
  activateEntry(entry.key);
  if (line) {
    const pos = { lineNumber: PB.clamp(line, 1, Math.max(1, entry.model.getLineCount())), column: PB.clamp(column || 1, 1, 100000) };
    S.editor.setPosition(pos);
    S.editor.revealPositionInCenter(pos);
  }
  S.editor.focus();
}

function bindModel(entry) {
  entry.model.onDidChangeContent(() => {
    if (entry.reloading || entry.virtual) return;
    if (!entry.dirty) {
      entry.dirty = true;
      updateTab(entry);
      updateDirtyStatus();
    }
    const s = settings();
    if (s.autoSave) {
      clearTimeout(entry.autosaveTimer);
      entry.autosaveTimer = setTimeout(() => saveFile(entry), s.autoSaveDelay);
    }
    clearTimeout(entry.recoveryTimer);
    entry.recoveryTimer = setTimeout(() => {
      if (!entry.dirty || entry.virtual) return;
      api.recovery.save({ file: entry.path, content: entry.model.getValue() }).catch(() => {});
    }, 650);
  });
}

async function saveFile(entry) {
  entry = entry || currentEntry();
  if (!entry || entry.virtual) return true;
  if (entry.saving) { entry.pendingSave = true; return false; }
  clearTimeout(entry.autosaveTimer);
  entry.saving = true;
  const version = entry.model.getVersionId();
  try {
    const res = await api.file.write(entry.path, entry.model.getValue());
    entry.mtime = res.mtime;
    entry.deleted = false;
    if (entry.model.getVersionId() === version) entry.dirty = false;
    await api.recovery.clear(entry.path).catch(() => {});
    updateTab(entry);
    updateDirtyStatus();
    persistSoon();
    maybeRefreshGit();
    if (entry.model.getVersionId() !== version) {
      const s = settings();
      if (s.autoSave) setTimeout(() => saveFile(entry), s.autoSaveDelay);
    }
    return true;
  } catch (err) {
    toast('Save failed: ' + err.message, 'error', 7000);
    return false;
  } finally {
    entry.saving = false;
    if (entry.pendingSave) {
      entry.pendingSave = false;
      if (entry.dirty) setTimeout(() => saveFile(entry), 30);
    }
  }
}

async function saveAll() {
  const dirty = Array.from(S.models.values()).filter((e) => e.dirty && !e.virtual);
  let failures = 0;
  for (const entry of dirty) {
    const ok = await saveFile(entry);
    if (!ok && entry.dirty) failures++;
  }
  if (!failures && dirty.length) toast('Saved ' + dirty.length + ' file' + (dirty.length === 1 ? '' : 's'), 'success', 1600);
  else if (failures) toast(failures + ' file(s) could not be saved.', 'error', 6000);
  return failures === 0;
}

async function closeEntry(entry, force) {
  if (!entry) return false;
  if (entry.saving) { toast('Wait for the save to finish.', 'warn', 2200); return false; }
  if (entry.dirty && !force) {
    const answer = await modalChoice(
      'Unsaved changes',
      '"' + (entry.virtual ? entry.label : nameOf(entry.path)) + '" has unsaved changes.',
      [{ label: 'Cancel', value: null }, { label: "Don't Save", value: 'discard' }, { label: 'Save', value: 'save', class: 'primary' }]
    );
    if (!answer) return false;
    if (answer === 'save') {
      const ok = await saveFile(entry);
      if (!ok || entry.dirty) return false;
    } else if (answer === 'discard' && !entry.virtual) {
      await api.recovery.clear(entry.path).catch(() => {});
    }
  }
  clearTimeout(entry.recoveryTimer);
  clearTimeout(entry.autosaveTimer);
  if (!entry.virtual) api.file.watchStop(entry.path).catch(() => {});
  try { entry.model.dispose(); } catch { /* ignore */ }
  S.models.delete(entry.key);
  if (S.current === entry.key) {
    const keys = Array.from(S.models.keys());
    S.current = keys.length ? keys[keys.length - 1] : null;
    const next = currentEntry();
    if (next) S.editor.setModel(next.model);
    else S.editor.setModel(null);
  }
  syncEditorState();
  persistSoon();
  return true;
}

async function closeOthers(keep) {
  for (const entry of Array.from(S.models.values())) {
    if (entry.key === keep.key) continue;
    if (entry.dirty) {
      const ok = await closeEntry(entry);
      if (!ok) continue;
    } else {
      await closeEntry(entry, true);
    }
  }
  activateEntry(keep.key);
}

async function closeAll() {
  for (const entry of Array.from(S.models.values())) {
    if (entry.dirty) {
      const ok = await closeEntry(entry);
      if (!ok) continue;
    } else {
      await closeEntry(entry, true);
    }
  }
  syncEditorState();
}

/* ---------------- external changes ---------------- */

async function reloadEntry(entry) {
  const res = await api.file.read(entry.path);
  entry.reloading = true;
  entry.model.setValue(res.content);
  entry.reloading = false;
  entry.dirty = false;
  entry.deleted = false;
  entry.mtime = res.mtime;
  await api.recovery.clear(entry.path).catch(() => {});
  updateTab(entry);
  updateDirtyStatus();
  updateEol();
  toast(nameOf(entry.path) + ' reloaded from disk', 'info', 1800);
}

async function showConflict(entry, event) {
  const answer = await modalChoice(
    'File changed on disk',
    '"' + nameOf(entry.path) + '" changed while you have unsaved edits. Reloading discards your changes.',
    [{ label: 'Keep Mine', value: 'keep' }, { label: 'Reload from Disk', value: 'reload', class: 'primary' }]
  );
  if (answer === 'reload') {
    try { await reloadEntry(entry); } catch (err) { toast(err.message, 'error'); }
  } else if (answer === 'keep') {
    entry.ignoredMtime = event.mtime;
  }
}

async function onFileChanged(event) {
  const entry = S.models.get(event.file);
  if (!entry || entry.virtual) return;
  if (entry.saving) return;
  if (event.deleted) {
    entry.deleted = true;
    updateTab(entry);
    updateDirtyStatus();
    toast(nameOf(entry.path) + ' was deleted on disk', 'warn', 5000);
    return;
  }
  if (!entry.dirty && Math.abs((event.mtime || 0) - (entry.mtime || 0)) < 1.5) return;
  if (entry.ignoredMtime && Math.abs(event.mtime - entry.ignoredMtime) < 1.5) return;
  if (entry.dirty) { await showConflict(entry, event); return; }
  try { await reloadEntry(entry); }
  catch (err) { toast('Could not reload ' + nameOf(entry.path) + ': ' + err.message, 'error'); }
}

/* ---------------- search ---------------- */

function bindSearch() {
  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => runSearch(), 380); };
  $('searchInput').addEventListener('input', schedule);
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); runSearch(); }
    if (e.key === 'Escape') { $('searchInput').value = ''; clearResults(); }
  });
  $('searchCase').onclick = () => { $('searchCase').classList.toggle('active'); runSearch(); };
  $('searchWord').onclick = () => { $('searchWord').classList.toggle('active'); runSearch(); };
  $('searchClear').onclick = () => { $('searchInput').value = ''; $('searchCase').classList.remove('active'); $('searchWord').classList.remove('active'); clearResults(); };
}

function clearResults() {
  S.searchToken++;
  $('searchResults').replaceChildren();
  $('searchSummary').textContent = 'Type to search the workspace.';
}

async function runSearch() {
  const query = $('searchInput').value;
  if (!S.root) { $('searchSummary').textContent = 'Open a folder to search.'; return; }
  if (!query.trim()) { clearResults(); return; }
  const token = ++S.searchToken;
  $('searchSummary').textContent = 'Searching…';
  $('searchResults').replaceChildren(el('div', 'search-empty', 'Searching…'));
  try {
    const res = await api.workspace.search({
      root: S.root, query,
      caseSensitive: $('searchCase').classList.contains('active'),
      wholeWord: $('searchWord').classList.contains('active'),
      excludes: PB.splitExcludes(settings().excludes),
      maxResults: 800
    });
    if (token !== S.searchToken) return;
    renderSearchResults(res, query);
  } catch (err) {
    if (token !== S.searchToken) return;
    $('searchSummary').textContent = 'Search failed.';
    $('searchResults').replaceChildren(el('div', 'search-empty', err.message));
  }
}

function renderSearchResults(res, query) {
  const host = $('searchResults');
  host.replaceChildren();
  const hits = res.hits || [];
  if (!hits.length) {
    $('searchSummary').textContent = 'No results' + (res.truncated ? ' (search limit reached)' : '');
    host.appendChild(el('div', 'search-empty', 'No matches for "' + query + '".'));
    return;
  }
  const groups = new Map();
  for (const hit of hits) {
    if (!groups.has(hit.path)) groups.set(hit.path, []);
    groups.get(hit.path).push(hit);
  }
  $('searchSummary').textContent = hits.length + ' result' + (hits.length === 1 ? '' : 's') + ' in ' + groups.size + ' file' + (groups.size === 1 ? '' : 's') + (res.truncated ? ' (truncated)' : '');
  for (const [file, fileHits] of groups) {
    const group = el('div', 'search-group');
    const head = el('div', 'search-file');
    head.append(badgeFor(file), el('span', 'path', relativeToRoot(file)), el('span', 'count', String(fileHits.length)));
    head.title = file;
    head.onclick = () => openFile(file);
    group.appendChild(head);
    for (const hit of fileHits) {
      const row = el('div', 'search-hit');
      row.appendChild(el('span', 'line', String(hit.line)));
      const snippet = el('span', 'snippet');
      appendHighlighted(snippet, hit.text, query, $('searchCase').classList.contains('active'));
      row.appendChild(snippet);
      row.title = hit.text;
      row.onclick = () => openFile(hit.path, hit.line, hit.column);
      group.appendChild(row);
    }
    host.appendChild(group);
  }
}

function appendHighlighted(host, text, query, caseSensitive) {
  if (!query) { host.textContent = text; return; }
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  let start = 0, index = hay.indexOf(needle);
  while (index >= 0) {
    if (index > start) host.appendChild(document.createTextNode(text.slice(start, index)));
    host.appendChild(el('mark', null, text.slice(index, index + query.length)));
    start = index + query.length;
    index = hay.indexOf(needle, start);
  }
  if (start < text.length) host.appendChild(document.createTextNode(text.slice(start)));
}

/* ---------------- git ---------------- */

function maybeRefreshGit() {
  if (!S.root) return;
  clearTimeout(S.gitTimer);
  S.gitTimer = setTimeout(() => refreshGit(), 700);
}

async function refreshGit() {
  if (!S.root) { renderGitNoRepo('Open a folder to use Git.'); return; }
  if (S.gitBusy) { S.gitPending = true; return; }
  S.gitBusy = true;
  try {
    const st = await api.git.status(S.root);
    S.git = st;
    renderGit(st);
    if (st.repo) await refreshBranches();
  } catch (err) {
    renderGitNoRepo(err.message);
  } finally {
    S.gitBusy = false;
    if (S.gitPending) { S.gitPending = false; setTimeout(() => refreshGit(), 80); }
  }
}

function renderGitNoRepo(message) {
  $('gitSummary').textContent = message;
  $('gitChanges').replaceChildren(el('div', 'git-empty', message));
  $('gitBranch').replaceChildren();
  $('gitStatus').classList.add('hidden');
}

function renderGit(st) {
  const host = $('gitChanges');
  host.replaceChildren();
  if (!st.repo) { renderGitNoRepo(st.text || 'Not a Git repository.'); return; }
  const changes = st.changes || [];
  $('gitSummary').textContent = st.branch + ' · ' + (changes.length ? changes.length + ' change' + (changes.length === 1 ? '' : 's') : 'working tree clean');
  const gs = $('gitStatus');
  gs.classList.remove('hidden');
  gs.textContent = '⎇ ' + st.branch + (changes.length ? ' · ' + changes.length : '');
  if (!changes.length) {
    host.appendChild(el('div', 'git-empty', 'No changes. Working tree is clean.'));
    return;
  }
  const staged = changes.filter((c) => c.staged);
  const unstaged = changes.filter((c) => !c.staged);
  if (staged.length) {
    host.appendChild(el('div', 'git-section-title', 'Staged Changes · ' + staged.length));
    staged.forEach((c) => host.appendChild(gitRow(c, true)));
  }
  if (unstaged.length) {
    host.appendChild(el('div', 'git-section-title', 'Changes · ' + unstaged.length));
    unstaged.forEach((c) => host.appendChild(gitRow(c, false)));
  }
}

function gitRow(change, staged) {
  const row = el('div', 'git-change');
  const code = el('span', 'git-code' + (staged ? ' staged' : ''), (change.x + change.y).replace(/ /g, '·'));
  code.title = (staged ? 'Staged' : 'Unstaged') + ' (' + change.x + change.y + ')';
  const file = el('span', 'git-path', change.path + (change.origPath ? ' ← ' + change.origPath : ''));
  file.title = change.path;
  file.onclick = () => openDiff(change, staged);
  row.append(code, file);

  const actions = el('div', 'git-actions');
  actions.appendChild(gitAction('diff', 'Show diff', () => openDiff(change, staged)));
  if (staged) actions.appendChild(gitAction('close', 'Unstage', () => gitSimple('unstage', change, 'Unstaged')));
  else if (change.untracked) actions.appendChild(gitAction('plus', 'Stage', () => gitSimple('stage', change, 'Staged')));
  else {
    actions.appendChild(gitAction('plus', 'Stage', () => gitSimple('stage', change, 'Staged')));
    actions.appendChild(gitAction('trash', 'Discard changes', () => discardChange(change)));
  }
  row.appendChild(actions);
  return row;
}

function gitAction(iconName, title, run) {
  const b = el('button', 'mini-btn');
  b.appendChild(icon(iconName));
  b.title = title;
  b.setAttribute('aria-label', title);
  b.onclick = (e) => { e.stopPropagation(); run(); };
  return b;
}

async function gitSimple(action, change, label) {
  if (!S.root) return;
  try {
    await api.git[action]({ cwd: S.root, file: change.path });
    toast(label + ': ' + change.path, 'success', 1500);
    await refreshGit();
  } catch (err) { toast(err.message, 'error'); }
}

async function discardChange(change) {
  const answer = await modalChoice(
    'Discard changes?',
    'Discard all changes in "' + change.path + '"? This cannot be undone.',
    [{ label: 'Cancel', value: null }, { label: 'Discard', value: 'yes', class: 'danger' }]
  );
  if (answer !== 'yes') return;
  try {
    await api.git.discard({ cwd: S.root, file: change.path });
    toast('Discarded changes in ' + change.path, 'success', 1800);
    await refreshGit();
  } catch (err) { toast(err.message, 'error'); }
}

async function openDiff(change, staged) {
  if (!S.root) return;
  try {
    const res = await api.git.diff({ cwd: S.root, file: change.path, staged });
    const header = '# ' + change.path + ' · ' + (staged ? 'staged' : 'working tree') + '\n\n';
    openVirtual('Δ ' + PB.basename(change.path) + (staged ? ' (staged)' : ''), header + (res.stdout || '(no diff available)'));
  } catch (err) { toast(err.message, 'error'); }
}

async function refreshBranches() {
  if (!S.root) return;
  try {
    const res = await api.git.branches(S.root);
    const select = $('gitBranch');
    select.replaceChildren();
    const branches = res.branches.length ? res.branches : [res.current || 'HEAD'];
    for (const branch of branches) {
      const opt = el('option', null, branch);
      opt.value = branch;
      opt.selected = branch === res.current;
      select.appendChild(opt);
    }
  } catch { /* not a repo */ }
}

function validateBranchName(value) {
  const name = String(value || '').trim();
  if (!name) return { ok: false, error: 'Branch name is required.' };
  if (/[\s~^:?*\[\\]/.test(name) || name.indexOf('..') >= 0 || name.startsWith('-') ||
      name.endsWith('.') || name.endsWith('.lock') || name.indexOf('@{') >= 0 ||
      name.indexOf('//') >= 0 || name === '@') {
    return { ok: false, error: 'That branch name is not valid.' };
  }
  return { ok: true, value: name };
}

async function switchBranch(branch) {
  if (!S.root || !branch) return;
  const dirty = Array.from(S.models.values()).filter((e) => e.dirty && !e.virtual);
  if (dirty.length) {
    const answer = await modalChoice('Unsaved changes', 'You have ' + dirty.length + ' unsaved file(s). Switch branch anyway?', [
      { label: 'Cancel', value: null }, { label: 'Switch', value: 'switch', class: 'primary' }
    ]);
    if (answer !== 'switch') { await refreshBranches(); return; }
  }
  try {
    const res = await api.git.switchBranch({ cwd: S.root, branch });
    toast(res.ok ? 'Switched to ' + branch : (res.text || 'Could not switch branch'), res.ok ? 'success' : 'error', 4000);
    await refreshGit();
  } catch (err) { toast(err.message, 'error'); }
}

async function createBranch() {
  if (!S.root) { toast('Open a folder first.', 'warn'); return; }
  const value = await modalInput('New Branch', 'Branch name', '', 'Create');
  if (!value) return;
  const check = validateBranchName(value);
  if (!check.ok) { toast(check.error, 'error'); return; }
  try {
    const res = await api.git.createBranch({ cwd: S.root, branch: check.value });
    toast(res.ok ? 'Created branch ' + check.value : (res.text || 'Could not create branch'), res.ok ? 'success' : 'error', 4000);
    await refreshGit();
  } catch (err) { toast(err.message, 'error'); }
}

async function commitChanges() {
  if (!S.root) { toast('Open a folder first.', 'warn'); return; }
  const message = $('commitMessage').value.trim();
  if (!message) { toast('Enter a commit message.', 'warn'); return; }
  const btn = $('commitBtn');
  btn.disabled = true;
  btn.textContent = 'Committing…';
  try {
    const res = await api.git.commit({ cwd: S.root, message });
    const text = res.text || (res.ok ? 'Committed.' : 'Commit failed.');
    toast(text, res.ok ? 'success' : 'error', 5000);
    if (res.ok) {
      $('commitMessage').value = '';
      S.state.gitMessage = '';
      persistSoon();
    }
    await refreshGit();
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Commit'; }
}

async function gitBulk(kind) {
  if (!S.root) { toast('Open a folder first.', 'warn'); return; }
  try {
    let res;
    if (kind === 'stageAll') res = await api.git.stageAll(S.root);
    else if (kind === 'unstageAll') res = await api.git.unstageAll(S.root);
    else if (kind === 'pull') res = await api.git.pull(S.root);
    else if (kind === 'push') res = await api.git.push(S.root);
    else if (kind === 'stash') res = await api.git.stash(S.root);
    else if (kind === 'stashPop') res = await api.git.stashPop(S.root);
    if (!res) return;
    if (kind === 'pull' || kind === 'push' || kind === 'stash' || kind === 'stashPop') {
      showOutput('$ git ' + kind + '\n' + (res.text || '') + '\n');
    }
    toast(res.ok ? 'Git ' + kind + ' finished.' : (res.text || 'Git ' + kind + ' failed.'), res.ok ? 'success' : 'error', 4500);
    await refreshGit();
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------------- run ---------------- */

function bindRun() {
  $('runBtn').onclick = runCurrent;
  $('stopBtn').onclick = stopRun;
}

function runSpecFor(entry) {
  const s = settings();
  const lang = PB.normalizeLanguage(entry.path);
  const runtimes = s.runtimes;
  if (lang === 'python') return { exe: runtimes.python || 'python', args: [entry.path], name: 'Python' };
  if (lang === 'javascript') return { exe: runtimes.node || 'node', args: [entry.path], name: 'Node.js' };
  if (lang === 'go') return { exe: runtimes.go || 'go', args: ['run', entry.path], name: 'Go' };
  if (lang === 'powershell') return { exe: runtimes.powershell || 'powershell.exe', args: ['-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', entry.path], name: 'PowerShell' };
  if (lang === 'shell') return { exe: 'bash', args: [entry.path], name: 'Shell' };
  return null;
}

async function runCurrent() {
  const entry = currentEntry();
  if (!entry) { toast('Open a file to run.', 'warn'); return; }
  if (entry.virtual) { toast('Diff views cannot be run.', 'warn'); return; }
  if (entry.dirty) {
    const ok = await saveFile(entry);
    if (!ok) return;
  }
  const spec = runSpecFor(entry);
  if (!spec) { toast('No run configuration for ' + PB.normalizeLanguage(entry.path) + ' files.', 'warn', 5000); return; }
  showPanel('outputPane');
  $('output').textContent = '> ' + spec.name + ': ' + spec.exe + ' ' + spec.args.join(' ') + '\n\n';
  try {
    const res = await api.run.start({
      cwd: S.root || PB.dirname(entry.path), exe: spec.exe, args: spec.args, name: spec.name
    });
    S.runId = res.id;
    S.running = true;
    if (S.runBuffer && S.runBuffer.has(res.id)) {
      appendOutput(S.runBuffer.get(res.id));
      S.runBuffer.delete(res.id);
    }
    if (S.runPendingExit && S.runPendingExit.id === res.id) {
      const pending = S.runPendingExit;
      S.runPendingExit = null;
      onRunExit(pending);
      return;
    }
    $('runBtn').disabled = true;
    $('stopBtn').disabled = false;
    const rs = $('runStatus');
    rs.classList.remove('hidden');
    rs.classList.add('running');
    rs.textContent = 'Running ' + spec.name;
    $('status').textContent = 'Running ' + spec.name + '…';
  } catch (err) {
    S.running = false;
    toast('Run failed: ' + err.message, 'error', 6000);
  }
}

async function stopRun() {
  if (!S.running) return;
  try { await api.run.stop(); } catch { /* ignore */ }
  S.running = false;
  $('runBtn').disabled = false;
  $('stopBtn').disabled = true;
  $('runStatus').classList.remove('running');
  $('runStatus').textContent = 'Stopped';
  $('status').textContent = 'Run stopped';
  appendOutput('\n[stopped]\n');
}

function onRunOutput(payload) {
  if (S.runId === null) {
    if (!S.runBuffer) S.runBuffer = new Map();
    S.runBuffer.set(payload.id, (S.runBuffer.get(payload.id) || '') + payload.chunk);
    return;
  }
  if (payload.id !== S.runId) return;
  appendOutput(payload.chunk);
}

function onRunExit(payload) {
  if (S.runId === null) { S.runPendingExit = payload; return; }
  if (payload.id !== S.runId) return;
  S.running = false;
  S.runId = null;
  $('runBtn').disabled = false;
  $('stopBtn').disabled = true;
  const ok = payload.code === 0;
  $('runStatus').classList.remove('running');
  $('runStatus').textContent = ok ? 'Finished' : 'Exit ' + payload.code;
  $('status').textContent = 'Process exited with code ' + payload.code + ' (' + PB.formatDuration(payload.duration) + ')';
  appendOutput('\n[process exited with code ' + payload.code + ' · ' + PB.formatDuration(payload.duration) + ']\n');
  if (!ok) toast('Process exited with code ' + payload.code, 'warn', 4500);
}

function appendOutput(text) {
  const out = $('output');
  out.textContent += text;
  const pane = $('outputPane');
  pane.scrollTop = pane.scrollHeight;
}

function showOutput(text) {
  showPanel('outputPane');
  if (text !== undefined) {
    $('output').textContent = text;
    $('outputPane').scrollTop = 0;
  }
}

/* ---------------- terminal ---------------- */

function showPanel(panelName) {
  $('panel').classList.remove('hidden');
  S.panel = panelName || S.panel;
  $$('.panel-tab').forEach((b) => b.classList.toggle('active', b.dataset.panel === S.panel));
  setHidden($('terminalPane'), S.panel !== 'terminalPane');
  setHidden($('outputPane'), S.panel !== 'outputPane');
  if (S.panel === 'terminalPane' && S.activeTerminal) setTimeout(() => fitTerminal(S.activeTerminal), 30);
}

function togglePanel(panelName) {
  const panel = $('panel');
  if (!panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    return;
  }
  if (panelName) showPanel(panelName);
  else if (S.terminals.size) showPanel('terminalPane');
  else showPanel('outputPane');
}

function terminalTheme() {
  const dark = resolvedTheme() === 'dark';
  return {
    background: dark ? '#0f1116' : '#fbfcfe',
    foreground: dark ? '#dbe2ee' : '#263244',
    cursor: dark ? '#4c8dff' : '#2563eb',
    selectionBackground: dark ? '#2b3a55' : '#cfe0ff'
  };
}

async function createTerminal() {
  if (typeof Terminal === 'undefined' || typeof FitAddon === 'undefined') {
    toast('Terminal libraries are not loaded. Run npm install.', 'error', 7000);
    return;
  }
  showPanel('terminalPane');
  const localId = 'term-' + (++S.terminalSeq);
  const pane = el('div', 'terminal-pane');
  pane.dataset.term = localId;
  $('terminalHost').appendChild(pane);

  const term = new Terminal({
    cursorBlink: true,
    fontFamily: 'Consolas, "Cascadia Code", monospace',
    fontSize: settings().terminalFontSize,
    theme: terminalTheme(),
    allowProposedApi: true,
    scrollback: 5000
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(pane);
  const session = { localId, serverId: null, term, fit, pane, tab: null, ready: false };
  S.terminals.set(localId, session);
  addTerminalTab(session);
  activateTerminal(localId);
  fitTerminal(session);

  term.onData((data) => {
    if (session.serverId) api.terminal.input({ id: session.serverId, data });
    else session.pendingInput = (session.pendingInput || '') + data;
  });

  try {
    const res = await api.terminal.create({
      clientId: localId,
      cwd: S.root || null,
      shell: settings().terminalShell,
      cols: term.cols || 100,
      rows: term.rows || 30
    });
    if (!res.ok) {
      showTerminalError(res.error || 'Terminal could not start.');
      if (session.tab) session.tab.classList.add('failed');
      return;
    }
    session.serverId = res.id;
    session.shell = res.shell;
    session.ready = true;
    $('terminalError').classList.add('hidden');
    if (session.pendingInput) { api.terminal.input({ id: res.id, data: session.pendingInput }); session.pendingInput = ''; }
    if (S.termDataBuffer) {
      const buffered = S.termDataBuffer.get(localId) || S.termDataBuffer.get(res.id);
      if (buffered) term.write(buffered);
      S.termDataBuffer.delete(localId);
      S.termDataBuffer.delete(res.id);
    }
    fitTerminal(session);
    term.focus();
  } catch (err) {
    showTerminalError(err.message);
    if (session.tab) session.tab.classList.add('failed');
  }
}

function addTerminalTab(session) {
  const tab = el('div', 'terminal-tab');
  tab.appendChild(el('span', 'term-open', '●'));
  tab.appendChild(el('span', null, 'Terminal ' + (S.terminalSeq)));
  const close = el('button', 'term-close');
  close.appendChild(icon('close'));
  close.title = 'Close terminal';
  close.onclick = (e) => { e.stopPropagation(); closeTerminal(session.localId); };
  tab.appendChild(close);
  tab.onclick = () => activateTerminal(session.localId);
  session.tab = tab;
  $('terminalTabs').appendChild(tab);
}

function activateTerminal(localId) {
  const session = S.terminals.get(localId);
  if (!session) return;
  S.activeTerminal = session;
  $$('.terminal-pane').forEach((p) => p.classList.toggle('active', p.dataset.term === localId));
  $$('.terminal-tab').forEach((t) => t.classList.toggle('active', t === session.tab));
  showPanel('terminalPane');
  setTimeout(() => { fitTerminal(session); session.term.focus(); }, 30);
}

function fitTerminal(session) {
  if (!session || !session.fit) return;
  try {
    if ($('panel').classList.contains('hidden')) return;
    if (!session.pane.isConnected || !session.pane.classList.contains('active')) return;
    session.fit.fit();
    if (session.serverId) api.terminal.resize({ id: session.serverId, cols: session.term.cols, rows: session.term.rows });
  } catch { /* ignore */ }
}

async function closeTerminal(localId) {
  const session = S.terminals.get(localId);
  if (!session) return;
  if (session.serverId) { try { await api.terminal.kill(session.serverId); } catch { /* ignore */ } }
  try { session.term.dispose(); } catch { /* ignore */ }
  session.pane.remove();
  if (session.tab) session.tab.remove();
  S.terminals.delete(localId);
  if (S.activeTerminal === session) {
    S.activeTerminal = null;
    const remaining = Array.from(S.terminals.values());
    if (remaining.length) activateTerminal(remaining[remaining.length - 1].localId);
  }
}

function showTerminalError(message) {
  const box = $('terminalError');
  box.textContent = message;
  box.classList.remove('hidden');
  showPanel('terminalPane');
}

function onTerminalData(payload) {
  for (const session of S.terminals.values()) {
    if (session.serverId === payload.id || (payload.clientId && session.localId === payload.clientId)) {
      session.term.write(payload.data);
      return;
    }
  }
  const key = payload.clientId || ('id-' + payload.id);
  if (!S.termDataBuffer) S.termDataBuffer = new Map();
  S.termDataBuffer.set(key, (S.termDataBuffer.get(key) || '') + payload.data);
}

function onTerminalExit(payload) {
  for (const session of S.terminals.values()) {
    if (session.serverId === payload.id || (payload.clientId && session.localId === payload.clientId)) {
      session.term.write('\r\n[process exited: ' + payload.exitCode + ']\r\n');
      if (session.tab) session.tab.classList.add('exited');
      return;
    }
  }
}

/* ---------------- quick open file index ---------------- */

async function ensureFileIndex() {
  if (!S.root) return [];
  if (S.fileIndex && S.fileIndexRoot === S.root) return S.fileIndex;
  const res = await api.workspace.files({ root: S.root, excludes: PB.splitExcludes(settings().excludes) });
  S.fileIndex = res.files;
  S.fileIndexRoot = S.root;
  if (res.truncated) toast('File index truncated at 25,000 files.', 'warn', 4000);
  return S.fileIndex;
}

/* ---------------- commands ---------------- */

function commandList() {
  return [
    { id: 'file.new', label: 'File: New File', key: 'Ctrl+N', run: () => fileNewFlow() },
    { id: 'file.open', label: 'File: Open File…', key: 'Ctrl+Shift+O', run: () => openFilesFlow() },
    { id: 'workspace.open', label: 'File: Open Folder…', key: 'Ctrl+O', run: () => openWorkspaceDialog() },
    { id: 'file.save', label: 'File: Save', key: 'Ctrl+S', run: () => saveFile() },
    { id: 'file.saveAll', label: 'File: Save All', key: 'Ctrl+Alt+S', run: () => saveAll() },
    { id: 'file.close', label: 'File: Close Editor', key: 'Ctrl+W', run: () => closeEntry(currentEntry()) },
    { id: 'file.closeAll', label: 'File: Close All Editors', run: () => closeAll() },
    { id: 'view.explorer', label: 'View: Explorer', key: 'Ctrl+Shift+E', run: () => showView('explorer') },
    { id: 'view.search', label: 'View: Search', key: 'Ctrl+Shift+F', run: () => showView('search') },
    { id: 'view.git', label: 'View: Source Control', key: 'Ctrl+Shift+G', run: () => showView('git') },
    { id: 'view.sidebar', label: 'View: Toggle Sidebar', key: 'Ctrl+B', run: () => toggleSidebar() },
    { id: 'view.panel', label: 'View: Toggle Panel', key: 'Ctrl+J', run: () => togglePanel() },
    { id: 'view.terminal', label: 'View: Toggle Terminal', key: 'Ctrl+`', run: () => terminalToggle() },
    { id: 'view.output', label: 'View: Show Output', run: () => showPanel('outputPane') },
    { id: 'view.theme', label: 'View: Toggle Theme', run: () => toggleTheme() },
    { id: 'view.zoomIn', label: 'View: Increase Editor Font Size', key: 'Ctrl+=', run: () => zoomEditor(1) },
    { id: 'view.zoomOut', label: 'View: Decrease Editor Font Size', key: 'Ctrl+-', run: () => zoomEditor(-1) },
    { id: 'view.zoomReset', label: 'View: Reset Editor Font Size', key: 'Ctrl+0', run: () => zoomEditor(0) },
    { id: 'app.settings', label: 'Preferences: Open Settings', key: 'Ctrl+,', run: () => openSettings() },
    { id: 'app.shortcuts', label: 'Help: Keyboard Shortcuts', run: () => showShortcuts() },
    { id: 'git.refresh', label: 'Git: Refresh', run: () => refreshGit() },
    { id: 'git.commit', label: 'Git: Commit', key: 'Ctrl+Enter', run: () => commitChanges() },
    { id: 'git.stageAll', label: 'Git: Stage All', run: () => gitBulk('stageAll') },
    { id: 'git.unstageAll', label: 'Git: Unstage All', run: () => gitBulk('unstageAll') },
    { id: 'git.pull', label: 'Git: Pull', run: () => gitBulk('pull') },
    { id: 'git.push', label: 'Git: Push', run: () => gitBulk('push') },
    { id: 'git.stash', label: 'Git: Stash Changes', run: () => gitBulk('stash') },
    { id: 'git.stashPop', label: 'Git: Pop Stash', run: () => gitBulk('stashPop') },
    { id: 'git.newBranch', label: 'Git: Create Branch…', run: () => createBranch() },
    { id: 'run.start', label: 'Run: Run Current File', key: 'F5', run: () => runCurrent() },
    { id: 'run.stop', label: 'Run: Stop', key: 'Shift+F5', run: () => stopRun() },
    { id: 'terminal.new', label: 'Terminal: New Terminal', run: () => createTerminal() },
    { id: 'run.clearOutput', label: 'Output: Clear', run: () => { $('output').textContent = ''; showPanel('outputPane'); } },
    { id: 'editor.find', label: 'Editor: Find', key: 'Ctrl+F', run: () => editorAction('actions.find') },
    { id: 'editor.replace', label: 'Editor: Replace', key: 'Ctrl+H', run: () => editorAction('editor.action.startFindReplaceAction') },
    { id: 'editor.gotoLine', label: 'Editor: Go to Line…', key: 'Ctrl+G', run: () => editorAction('editor.action.gotoLine') },
    { id: 'editor.format', label: 'Editor: Format Document', key: 'Shift+Alt+F', run: () => editorAction('editor.action.formatDocument') }
  ];
}

function editorAction(id) {
  if (!S.editor) return;
  S.editor.focus();
  const action = S.editor.getAction(id);
  if (action) action.run();
}

function toggleTheme() {
  settings().theme = resolvedTheme() === 'dark' ? 'light' : 'dark';
  applyTheme();
  for (const session of S.terminals.values()) session.term.options.theme = terminalTheme();
  persistSoon();
}

function zoomEditor(delta) {
  const s = settings();
  s.fontSize = delta === 0 ? 14 : PB.clamp(s.fontSize + delta, 10, 30);
  applyEditorOptions();
  persistSoon();
  toast('Editor font size: ' + s.fontSize + 'px', 'info', 1400);
}

function terminalToggle() {
  if ($('panel').classList.contains('hidden')) {
    if (!S.terminals.size) createTerminal();
    else showPanel('terminalPane');
  } else if (S.panel === 'terminalPane') {
    $('panel').classList.add('hidden');
  } else {
    showPanel('terminalPane');
  }
}

/* ---------------- command palette / quick open ---------------- */

let paletteToken = 0;

function paletteModeFromInput(value) {
  return String(value).replace(/^\s+/, '').startsWith('>') ? 'commands' : 'files';
}

async function openPalette(mode) {
  const input = $('paletteInput');
  S.palette.open = true;
  S.palette.index = 0;
  S.palette.mode = mode === 'commands' ? 'commands' : 'files';
  input.value = S.palette.mode === 'commands' ? '>' : '';
  input.placeholder = S.palette.mode === 'commands' ? 'Type a command…' : 'Search files by name…';
  $('palette').classList.remove('hidden');
  hideContextMenu();
  await renderPalette();
  setTimeout(() => {
    input.focus();
    const end = input.value.length;
    try { input.setSelectionRange(end, end); } catch { /* ignore */ }
  }, 20);
}

function closePalette() {
  if (!S.palette.open) return;
  S.palette.open = false;
  paletteToken++;
  $('palette').classList.add('hidden');
  S.palette.items = [];
  S.palette.index = 0;
}

async function renderPalette() {
  const token = ++paletteToken;
  const value = $('paletteInput').value;
  const mode = paletteModeFromInput(value);
  const query = mode === 'commands' ? value.replace(/^\s*>\s*/, '') : value;
  S.palette.mode = mode;
  $('paletteInput').placeholder = mode === 'commands' ? 'Type a command…' : 'Search files by name…';

  let items = [];
  if (mode === 'commands') {
    items = commandList().map((c) => {
      const match = query ? PB.fuzzyMatch(query, c.label) : { score: 0 };
      return { item: { id: c.id, label: c.label, key: c.key, run: c.run }, match };
    }).filter((x) => x.match)
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, 80)
      .map((x) => x.item);
  } else if (!S.root) {
    $('paletteList').replaceChildren(el('div', 'search-empty', 'Open a folder to search files.'));
    $('paletteHint').textContent = '';
    S.palette.items = [];
    return;
  } else {
    let files = [];
    try { files = await ensureFileIndex(); }
    catch (err) { toast('Could not build file list: ' + err.message, 'error'); }
    if (token !== paletteToken) return;
    const scored = [];
    for (const f of files) {
      const match = query ? PB.fuzzyMatch(query, f.rel) : { score: 0 };
      if (!match) continue;
      scored.push({ f, match });
      if (!query && scored.length >= 120) break;
    }
    scored.sort((a, b) => b.match.score - a.match.score);
    items = scored.slice(0, 120).map(({ f }) => ({
      id: f.path, label: PB.basename(f.rel), path: f.rel, run: () => openFile(f.path)
    }));
  }

  if (token !== paletteToken) return;
  S.palette.items = items;
  if (S.palette.index >= items.length) S.palette.index = 0;
  renderPaletteList(items, query, mode);
}

function renderPaletteList(items, query, mode) {
  const host = $('paletteList');
  host.replaceChildren();
  if (!items.length) {
    host.appendChild(el('div', 'search-empty', mode === 'commands' ? 'No matching commands.' : 'No matching files.'));
    $('paletteHint').textContent = mode === 'files' && !S.root ? '' : 'Esc to close';
    return;
  }
  items.forEach((item, index) => {
    const row = el('div', 'palette-item' + (index === S.palette.index ? ' active' : ''));
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', index === S.palette.index ? 'true' : 'false');
    row.appendChild(icon(mode === 'commands' ? 'palette' : 'file'));
    const name = el('span', 'p-name');
    appendMatch(name, item.label, query, mode === 'commands');
    row.appendChild(name);
    if (item.path) row.appendChild(el('span', 'p-path', item.path));
    if (item.key) row.appendChild(el('span', 'p-key', item.key));
    row.onmouseenter = () => { S.palette.index = index; markPaletteActive(); };
    row.onclick = () => { S.palette.index = index; paletteAccept(); };
    host.appendChild(row);
  });
  $('paletteHint').textContent = items.length + ' result' + (items.length === 1 ? '' : 's') + ' · Enter to open · ↑↓ to navigate · Esc to close';
  markPaletteActive(true);
}

function appendMatch(host, text, query, fuzzy) {
  if (!query) { host.textContent = text; return; }
  if (fuzzy) {
    const match = PB.fuzzyMatch(query, text);
    if (match) {
      const positions = new Set(match.positions);
      let buffer = '';
      const flush = () => { if (buffer) { host.appendChild(document.createTextNode(buffer)); buffer = ''; } };
      for (let i = 0; i < text.length; i++) {
        if (positions.has(i)) { flush(); host.appendChild(el('mark', null, text.charAt(i))); }
        else buffer += text.charAt(i);
      }
      flush();
      return;
    }
  }
  host.textContent = text;
}

function markPaletteActive(scroll) {
  const rows = $$('.palette-item', $('paletteList'));
  rows.forEach((row, index) => {
    const active = index === S.palette.index;
    row.classList.toggle('active', active);
    row.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active && scroll && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  });
}

function paletteMove(delta) {
  const count = S.palette.items.length;
  if (!count) return;
  S.palette.index = (S.palette.index + delta + count) % count;
  markPaletteActive(true);
}

function paletteAccept() {
  const item = S.palette.items[S.palette.index];
  if (!item) return;
  closePalette();
  try { item.run(); } catch (err) { toast(err.message, 'error'); }
}

function bindPalette() {
  const input = $('paletteInput');
  input.addEventListener('input', () => { S.palette.index = 0; renderPalette(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); paletteMove(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); paletteMove(-1); }
    else if (event.key === 'Enter') { event.preventDefault(); paletteAccept(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePalette(); }
  });
  $('palette').addEventListener('pointerdown', (event) => {
    if (event.target === $('palette')) closePalette();
  });
}

/* ---------------- settings ---------------- */

function settingsRow(labelText, desc, control) {
  const row = el('div', 'settings-row');
  const left = el('div');
  left.appendChild(el('div', null, labelText));
  if (desc) left.appendChild(el('div', 'desc', desc));
  row.append(left, control);
  return row;
}

function textInput(value, type) {
  const input = el('input');
  input.type = type || 'text';
  input.value = value === undefined || value === null ? '' : String(value);
  return input;
}

function checkbox(value) {
  const input = el('input');
  input.type = 'checkbox';
  input.checked = !!value;
  return input;
}

function selectInput(options, value) {
  const select = el('select');
  for (const [val, label] of options) {
    const opt = el('option', null, label);
    opt.value = val;
    opt.selected = val === value;
    select.appendChild(opt);
  }
  return select;
}

async function openSettings() {
  const s = settings();
  const body = el('div', 'settings-grid');

  const appearance = el('section', 'settings-section');
  appearance.appendChild(el('h4', null, 'Appearance'));
  const theme = selectInput([['dark', 'Dark'], ['light', 'Light'], ['system', 'Match system']], s.theme);
  appearance.appendChild(settingsRow('Theme', 'Colour scheme for the editor and interface.', theme));
  const fontFamily = textInput(s.fontFamily);
  appearance.appendChild(settingsRow('Editor font', 'Any font installed on this system.', fontFamily));
  const fontSize = textInput(s.fontSize, 'number');
  fontSize.min = '10'; fontSize.max = '30';
  appearance.appendChild(settingsRow('Font size', 'In pixels.', fontSize));
  const tabSize = selectInput([['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['8', '8']], String(s.tabSize));
  appearance.appendChild(settingsRow('Tab size', 'Number of spaces per indentation level.', tabSize));
  const wordWrap = checkbox(s.wordWrap);
  appearance.appendChild(settingsRow('Word wrap', 'Wrap long lines instead of scrolling.', wordWrap));
  const minimap = checkbox(s.minimap);
  appearance.appendChild(settingsRow('Minimap', 'Show the code overview on the right.', minimap));
  body.appendChild(appearance);

  const editing = el('section', 'settings-section');
  editing.appendChild(el('h4', null, 'Editing'));
  const autoSave = checkbox(s.autoSave);
  editing.appendChild(settingsRow('Auto save', 'Save files shortly after you stop typing.', autoSave));
  const autoSaveDelay = textInput(s.autoSaveDelay, 'number');
  autoSaveDelay.min = '250'; autoSaveDelay.max = '10000'; autoSaveDelay.step = '50';
  editing.appendChild(settingsRow('Auto save delay', 'Milliseconds of inactivity before saving.', autoSaveDelay));
  body.appendChild(editing);

  const terminalSection = el('section', 'settings-section');
  terminalSection.appendChild(el('h4', null, 'Terminal'));
  const termFont = textInput(s.terminalFontSize, 'number');
  termFont.min = '9'; termFont.max = '24';
  terminalSection.appendChild(settingsRow('Terminal font size', 'In pixels.', termFont));
  const shell = textInput(s.terminalShell);
  shell.placeholder = 'Default shell';
  terminalSection.appendChild(settingsRow('Shell', 'Leave blank to use the system default.', shell));
  body.appendChild(terminalSection);

  const runtimes = el('section', 'settings-section');
  runtimes.appendChild(el('h4', null, 'Runtimes'));
  const runtimeInputs = {};
  const runtimeDefs = [
    ['python', 'Python', 'Used for .py files'],
    ['node', 'Node.js', 'Used for .js files'],
    ['go', 'Go', 'Used for .go files'],
    ['powershell', 'PowerShell', 'Used for .ps1 files']
  ];
  for (const [key, label, desc] of runtimeDefs) {
    const wrap = el('div', 'inline');
    const input = textInput(s.runtimes[key]);
    const test = el('button', null, 'Check');
    const status = el('div', 'runtime-status');
    test.onclick = async () => {
      test.disabled = true;
      status.textContent = 'Checking…';
      try {
        const res = await api.run.check(input.value.trim());
        status.textContent = res.ok ? (res.text.split('\n')[0] || 'Available') : (res.text || 'Not found');
        status.style.color = res.ok ? 'var(--green)' : 'var(--red)';
      } catch (err) { status.textContent = err.message; status.style.color = 'var(--red)'; }
      finally { test.disabled = false; }
    };
    wrap.append(input, test);
    const row = settingsRow(label, desc, wrap);
    row.appendChild(status);
    runtimeInputs[key] = input;
    runtimes.appendChild(row);
  }
  body.appendChild(runtimes);

  const advanced = el('section', 'settings-section');
  advanced.appendChild(el('h4', null, 'Workspace'));
  const excludes = textInput(s.excludes);
  excludes.placeholder = 'node_modules, .git, dist';
  advanced.appendChild(settingsRow('Excluded folders', 'Comma-separated names skipped by search and indexing.', excludes));
  body.appendChild(advanced);

  const note = el('p', 'modal-note', 'Changes apply immediately after saving. Restart is not required.');
  body.appendChild(note);

  const result = await showModal({
    title: 'Settings', body,
    actions: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'save', class: 'primary' }]
  });
  if (result !== 'save') return;

  s.theme = theme.value;
  s.fontFamily = fontFamily.value.trim() || 'Consolas, "Cascadia Code", monospace';
  s.fontSize = PB.clamp(fontSize.value, 10, 30);
  s.tabSize = PB.clamp(tabSize.value, 1, 8);
  s.wordWrap = wordWrap.checked;
  s.minimap = minimap.checked;
  s.autoSave = autoSave.checked;
  s.autoSaveDelay = PB.clamp(autoSaveDelay.value, 250, 10000);
  s.terminalFontSize = PB.clamp(termFont.value, 9, 24);
  s.terminalShell = shell.value.trim();
  s.excludes = excludes.value.trim() || PB.DEFAULT_EXCLUDES.join(', ');
  for (const key of Object.keys(runtimeInputs)) s.runtimes[key] = runtimeInputs[key].value.trim() || s.runtimes[key];

  applyTheme();
  applyLayout();
  applyEditorOptions();
  for (const session of S.terminals.values()) {
    session.term.options.fontSize = s.terminalFontSize;
    session.term.options.theme = terminalTheme();
    fitTerminal(session);
  }
  S.fileIndex = null;
  S.fileIndexRoot = null;
  persistSoon();
  toast('Settings saved', 'success', 1600);
}

function showShortcuts() {
  const rows = [
    ['Quick open files', 'Ctrl+P'],
    ['Command palette', 'Ctrl+Shift+P'],
    ['Open folder', 'Ctrl+O'],
    ['Save', 'Ctrl+S'],
    ['Save all', 'Ctrl+Alt+S'],
    ['Close editor', 'Ctrl+W'],
    ['Toggle sidebar', 'Ctrl+B'],
    ['Toggle panel', 'Ctrl+J'],
    ['Terminal', 'Ctrl+`'],
    ['Explorer', 'Ctrl+Shift+E'],
    ['Search', 'Ctrl+Shift+F'],
    ['Source control', 'Ctrl+Shift+G'],
    ['Settings', 'Ctrl+,'],
    ['Run current file', 'F5'],
    ['Stop', 'Shift+F5']
  ];
  const body = el('div', 'settings-grid');
  const list = el('div', 'shortcut-list');
  for (const [label, key] of rows) {
    const row = el('div');
    row.appendChild(el('dt', null, label));
    const dd = el('dd');
    dd.appendChild(el('kbd', null, key));
    row.appendChild(dd);
    list.appendChild(row);
  }
  body.appendChild(list);
  showModal({ title: 'Keyboard Shortcuts', body, actions: [{ label: 'Close', value: null, class: 'primary' }] });
}

/* ---------------- recovery ---------------- */

async function offerRecovery() {
  if (S.recoveryOffered) return;
  S.recoveryOffered = true;
  let list = [];
  try { list = await api.recovery.list(); } catch { return; }
  if (!Array.isArray(list) || !list.length) return;
  const usable = list.filter((r) => r.exists);
  if (!usable.length) {
    await Promise.all(list.map((r) => api.recovery.clear(r.file).catch(() => {})));
    return;
  }

  const body = el('div');
  body.appendChild(el('p', null, 'PeaBox found unsaved work from a previous session. Restore it?'));
  const box = el('div', 'modal-list');
  const chosen = new Set();
  for (const rec of usable) {
    const item = el('label', 'modal-item');
    const check = el('input');
    check.type = 'checkbox';
    check.checked = true;
    check.onchange = () => { if (check.checked) chosen.add(rec.file); else chosen.delete(rec.file); };
    if (check.checked) chosen.add(rec.file);
    const text = el('div', 'mi-body');
    text.append(
      el('div', 'mi-title', relativeToRoot(rec.file)),
      el('div', 'mi-sub', PB.relativeTime(rec.savedAt) + ' · ' + PB.formatBytes(rec.size))
    );
    item.append(check, text);
    box.appendChild(item);
  }
  body.appendChild(box);

  const answer = await showModal({
    title: 'Recover unsaved work', body,
    actions: [
      { label: 'Discard All', value: 'discard' },
      { label: 'Restore Selected', value: 'restore', class: 'primary' }
    ]
  });

  if (answer !== 'restore') {
    await Promise.all(usable.map((r) => api.recovery.clear(r.file).catch(() => {})));
    return;
  }

  let restored = 0;
  for (const rec of usable) {
    if (!chosen.has(rec.file)) { await api.recovery.clear(rec.file).catch(() => {}); continue; }
    try {
      const data = await api.recovery.read(rec.file);
      if (!data) continue;
      await openFile(rec.file);
      const entry = S.models.get(rec.file);
      if (!entry) continue;
      entry.model.setValue(data.content);
      entry.dirty = true;
      updateTab(entry);
      await api.recovery.clear(rec.file).catch(() => {});
      restored++;
    } catch { /* skip unreadable */ }
  }
  updateDirtyStatus();
  if (restored) {
    toast('Restored ' + restored + ' recovered file' + (restored === 1 ? '' : 's') + '. Review and save.', 'success', 6000);
  }
}

/* ---------------- close request ---------------- */

async function handleCloseRequest() {
  if (S.closePrompt) return;
  S.closePrompt = true;
  try {
    await persistNow();
    const dirty = Array.from(S.models.values()).filter((e) => e.dirty && !e.virtual);
    if (!dirty.length) { await api.app.close('close'); return; }
    const answer = await modalChoice(
      'Unsaved changes',
      'You have ' + dirty.length + ' unsaved file' + (dirty.length === 1 ? '' : 's') + '. Save before closing?',
      [
        { label: 'Cancel', value: null },
        { label: 'Close Without Saving', value: 'discard' },
        { label: 'Save and Close', value: 'save', class: 'primary' }
      ]
    );
    if (answer === 'save') {
      const ok = await saveAll();
      if (ok) await api.app.close('close');
    } else if (answer === 'discard') {
      await Promise.all(dirty.map((e) => api.recovery.clear(e.path).catch(() => {})));
      await api.app.close('close');
    }
  } finally {
    S.closePrompt = false;
  }
}

/* ---------------- menu commands ---------------- */

function handleMenuCommand(payload) {
  const id = payload && payload.id;
  const arg = payload && payload.arg;
  const map = {
    'workspace.open': () => openWorkspaceDialog(),
    'workspace.openRecent': () => openRecent(arg),
    'file.open': () => openFilesFlow(),
    'file.new': () => fileNewFlow(),
    'file.save': () => saveFile(),
    'file.saveAll': () => saveAll(),
    'file.close': () => closeEntry(currentEntry()),
    'file.closeAll': () => closeAll(),
    'app.settings': () => openSettings(),
    'app.shortcuts': () => showShortcuts(),
    'palette.commands': () => openPalette('commands'),
    'palette.files': () => openPalette('files'),
    'view.explorer': () => showView('explorer'),
    'view.search': () => showView('search'),
    'view.git': () => showView('git'),
    'view.sidebar': () => toggleSidebar(),
    'view.panel': () => togglePanel(),
    'view.output': () => showPanel('outputPane'),
    'view.zoomIn': () => zoomEditor(1),
    'view.zoomOut': () => zoomEditor(-1),
    'view.zoomReset': () => zoomEditor(0),
    'terminal.toggle': () => terminalToggle(),
    'run.start': () => runCurrent(),
    'run.stop': () => stopRun(),
    'editor.find': () => editorAction('actions.find'),
    'editor.replace': () => editorAction('editor.action.startFindReplaceAction'),
    'editor.gotoLine': () => editorAction('editor.action.gotoLine')
  };
  const fn = map[id];
  if (fn) fn();
}

/* ---------------- keyboard ---------------- */

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function onKeyDown(event) {
  if (S.modalOpen) return;
  if (event.key === 'Escape') {
    if (S.palette.open) { closePalette(); return; }
    hideContextMenu();
    return;
  }
  if (S.palette.open) return;

  const mod = event.ctrlKey || event.metaKey;
  const key = event.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;

  if (mod && event.shiftKey && lower === 'p') { event.preventDefault(); openPalette('commands'); return; }
  if (mod && !event.shiftKey && lower === 'p') { event.preventDefault(); openPalette('files'); return; }
  if (mod && event.shiftKey && lower === 'f') { event.preventDefault(); showView('search'); return; }
  if (mod && event.shiftKey && lower === 'e') { event.preventDefault(); showView('explorer'); return; }
  if (mod && event.shiftKey && lower === 'g') { event.preventDefault(); showView('git'); return; }
  if (mod && event.shiftKey && lower === 'o') { event.preventDefault(); openFilesFlow(); return; }
  if (mod && !event.shiftKey && lower === 'o') { event.preventDefault(); openWorkspaceDialog(); return; }
  if (mod && !event.shiftKey && lower === 's') { event.preventDefault(); if (event.altKey) saveAll(); else saveFile(); return; }
  if (mod && !event.shiftKey && lower === 'n') { event.preventDefault(); fileNewFlow(); return; }
  if (mod && !event.shiftKey && lower === 'w') { event.preventDefault(); closeEntry(currentEntry()); return; }
  if (mod && !event.shiftKey && lower === 'b') { event.preventDefault(); toggleSidebar(); return; }
  if (mod && !event.shiftKey && lower === 'j') { event.preventDefault(); togglePanel(); return; }
  if (mod && (key === '=' || key === '+')) { event.preventDefault(); zoomEditor(1); return; }
  if (mod && (key === '-' || key === '_')) { event.preventDefault(); zoomEditor(-1); return; }
  if (mod && key === '0') { event.preventDefault(); zoomEditor(0); return; }
  if (mod && !event.shiftKey && key === '`') { event.preventDefault(); terminalToggle(); return; }
  if (mod && key === ',') { event.preventDefault(); openSettings(); return; }
  if (mod && !event.shiftKey && lower === 'g') { event.preventDefault(); editorAction('editor.action.gotoLine'); return; }
  if (mod && !event.shiftKey && lower === 'f') { event.preventDefault(); editorAction('actions.find'); return; }
  if (mod && !event.shiftKey && lower === 'h') { event.preventDefault(); editorAction('editor.action.startFindReplaceAction'); return; }
  if (event.altKey && event.shiftKey && lower === 'f') { event.preventDefault(); editorAction('editor.action.formatDocument'); return; }
  if (key === 'F5') { event.preventDefault(); if (event.shiftKey) stopRun(); else runCurrent(); return; }
}

/* ---------------- init ---------------- */

function collapseAll() {
  S.expanded.clear();
  renderExplorer();
}

let workspaceRefreshTimer = null;
function onWorkspaceChanged() {
  clearTimeout(workspaceRefreshTimer);
  workspaceRefreshTimer = setTimeout(() => {
    S.fileIndex = null;
    S.fileIndexRoot = null;
    if (S.root) refreshExplorer();
    maybeRefreshGit();
  }, 500);
}

function bindEvents() {
  $('workspaceBtn').onclick = () => openWorkspaceDialog();
  $('welcomeOpen').onclick = () => openWorkspaceDialog();
  $('welcomeNew').onclick = () => fileNewFlow();
  $('welcomePalette').onclick = () => openPalette('commands');
  $('commandButton').onclick = () => openPalette('files');
  $('saveBtn').onclick = () => saveFile();
  $('themeBtn').onclick = () => toggleTheme();
  $('settingsBtn').onclick = () => openSettings();
  $('newFileBtn').onclick = () => createFileFlow();
  $('newFolderBtn').onclick = () => createFolderFlow();
  $('collapseBtn').onclick = () => collapseAll();
  $('refreshBtn').onclick = () => refreshExplorer();

  $$('.activity[data-view]').forEach((btn) => {
    btn.onclick = () => showView(btn.dataset.view);
  });

  $('gitRefresh').onclick = () => refreshGit();
  $('gitNewBranch').onclick = () => createBranch();
  $('gitBranch').onchange = (event) => switchBranch(event.target.value);
  $('commitBtn').onclick = () => commitChanges();
  $('gitStageAll').onclick = () => gitBulk('stageAll');
  $('gitUnstageAll').onclick = () => gitBulk('unstageAll');
  $('gitPull').onclick = () => gitBulk('pull');
  $('gitPush').onclick = () => gitBulk('push');
  $('gitStash').onclick = () => gitBulk('stash');
  $('gitStashPop').onclick = () => gitBulk('stashPop');

  $('commitMessage').addEventListener('input', (event) => {
    S.state.gitMessage = event.target.value;
    persistSoon();
  });
  $('commitMessage').addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      commitChanges();
    }
  });

  $$('.panel-tab').forEach((btn) => {
    btn.onclick = () => showPanel(btn.dataset.panel);
  });
  $('newTerminal').onclick = () => createTerminal();
  $('clearOutput').onclick = () => { $('output').textContent = ''; };
  $('closePanel').onclick = () => $('panel').classList.add('hidden');
  $('panelBtn').onclick = () => togglePanel();
  $('gitStatus').onclick = () => showView('git');

  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', () => { if (S.activeTerminal) fitTerminal(S.activeTerminal); });
  window.addEventListener('beforeunload', () => { try { persistNow(); } catch { /* ignore */ } });
}

function bindSubscriptions() {
  api.on.menu(handleMenuCommand);
  api.on.fileChanged((payload) => { onFileChanged(payload).catch(() => {}); });
  api.on.workspaceChanged(() => onWorkspaceChanged());
  api.on.runOutput(onRunOutput);
  api.on.runExit(onRunExit);
  api.on.terminalData(onTerminalData);
  api.on.terminalExit(onTerminalExit);
  api.on.closeRequest(() => { handleCloseRequest().catch(() => {}); });
}

async function restoreSession() {
  if (!S.state) return;
  if (S.state.lastFolder) {
    await openWorkspacePath(S.state.lastFolder);
  }
  if (S.state.gitMessage) $('commitMessage').value = S.state.gitMessage;
  const files = Array.isArray(S.state.openFiles) ? S.state.openFiles : [];
  for (const file of files) {
    if (!S.editor) break;
    try { await openFile(file); } catch { /* skip unavailable */ }
  }
  if (S.state.activeFile && S.models.has(S.state.activeFile)) activateEntry(S.state.activeFile);
  else if (S.models.size) activateEntry(Array.from(S.models.keys())[S.models.size - 1]);
  syncEditorState();
}

function hideBoot() {
  const boot = $('boot');
  if (!boot) return;
  boot.classList.add('fade');
  setTimeout(() => { if (boot.isConnected) boot.remove(); }, 320);
}

async function boot() {
  if (!PB) { document.body.textContent = 'PeaBox could not load its shared helpers.'; return; }
  bindEvents();
  bindSearch();
  bindRun();
  bindResizers();
  bindPalette();
  bindSubscriptions();

  try {
    S.state = await api.app.loadState();
  } catch (err) {
    S.state = PB.defaultState();
    toast('Could not load your session: ' + err.message, 'error', 6000);
  }
  if (!S.state || !S.state.settings) S.state = PB.defaultState();

  applyTheme();
  applyLayout();
  renderRecent();
  showWelcome(true);

  initMonaco();
  await Promise.race([monacoReady, new Promise((resolve) => setTimeout(resolve, 9000))]);

  if (!S.editor) {
    toast('The editor engine could not start. Try reinstalling dependencies with npm install.', 'error', 12000);
    showOutput('Editor engine failed to load.\nRun: npm install\nThen restart PeaBox IDE.\n');
  } else {
    await restoreSession();
    applyEditorOptions();
  }

  try { await offerRecovery(); } catch { /* ignore */ }

  const info = await api.app.info().catch(() => null);
  if (info) {
    $('status').textContent = 'PeaBox IDE ' + info.version + ' · Electron ' + info.electron;
    setTimeout(() => { if (!S.running) $('status').textContent = 'Ready'; }, 5000);
  }

  hideBoot();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { boot().catch((err) => {
    console.error(err);
    const bootEl = $('boot');
    if (bootEl) bootEl.remove();
    toast('PeaBox failed to start: ' + err.message, 'error', 12000);
  }); });
} else {
  boot().catch((err) => {
    console.error(err);
    const bootEl = $('boot');
    if (bootEl) bootEl.remove();
    toast('PeaBox failed to start: ' + err.message, 'error', 12000);
  });
}

})();
