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
  gitFiles: {},
  gitBusy: false,
  gitTimer: null,
  focusCheckBusy: false,
  session: null,
  sessionTimer: null,
  cli: null,
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
  panel: 'terminalPane',
  problems: [],
  editor2: null,
  current2: null,
  navHistory: [],
  navIndex: -1,
  navNavigating: false,
  recentlyClosed: [],
  blameCache: new Map(),
  breakpoints: new Map(),
  debug: null,
  compare: null,
  diffEditor: null,
  dragKey: null,
  ai: {
    enabled: false,
    providers: [],
    keyStatus: {},
    model: '',
    endpoint: ''
  }
};

const settings = () => S.state.settings;
const currentEntry = () => (S.current ? S.models.get(S.current) : null);
const nameOf = (p) => PB.basename(p);
const notify = (message, type, timeout) => toast(message, type, timeout);

// Monaco cancels in-flight word-highlight requests when the editor model changes.
// The cancellation rejects with "Canceled"; it is expected during fast tab switches.
window.addEventListener('unhandledrejection', (event) => {
  const reason = event && event.reason;
  const message = reason && reason.message ? reason.message : String(reason || '');
  const stack = (reason && reason.stack) || '';
  if (message === 'Canceled' && stack.includes('monaco-editor')) event.preventDefault();
});

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
    minimap: { enabled: s.minimap },
    stickyScroll: s.stickyScroll
  });
  if (S.editor2) {
    S.editor2.updateOptions({
      fontSize: s.fontSize,
      fontFamily: s.fontFamily,
      tabSize: s.tabSize,
      wordWrap: s.wordWrap ? 'on' : 'off',
      minimap: { enabled: s.minimap },
      stickyScroll: s.stickyScroll
    });
  }
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

function captureCurrentPosition() {
  const entry = currentEntry();
  if (!entry || !S.editor) return;
  const pos = S.editor.getPosition();
  if (pos) {
    entry.cursorLine = pos.lineNumber;
    entry.cursorColumn = pos.column;
  }
  entry.scrollTop = S.editor.getScrollTop();
}

/* ---------------- navigation history ---------------- */

function pushNav(path, line, column) {
  if (!path) return;
  const stack = S.navHistory;
  const top = stack[S.navIndex];
  // Skip duplicate entries for the same location.
  if (top && top.path === path && (top.line || 1) === (line || 1) && (top.column || 1) === (column || 1)) return;
  // New navigation truncates any forward history.
  if (S.navIndex < stack.length - 1) stack.length = S.navIndex + 1;
  stack.push({ path, line: line || 1, column: column || 1 });
  if (stack.length > 80) stack.shift();
  S.navIndex = stack.length - 1;
}

function navJump(stackIndex) {
  const stack = S.navHistory;
  if (!stack || stackIndex < 0 || stackIndex >= stack.length || stackIndex === S.navIndex) return;
  const target = stack[stackIndex];
  S.navIndex = stackIndex;
  S.navNavigating = true;
  openFile(target.path, target.line, target.column).finally(() => { S.navNavigating = false; });
}

function navBack() {
  navJump(S.navIndex - 1);
}

function navForward() {
  navJump(S.navIndex + 1);
}

function cycleTabs(direction) {
  const keys = Array.from(S.models.keys());
  if (!keys.length) return;
  const currentIndex = keys.indexOf(S.current);
  const nextIndex = (currentIndex + direction + keys.length) % keys.length;
  activateEntry(keys[nextIndex]);
}

function reopenClosedEditor() {
  if (!S.recentlyClosed || !S.recentlyClosed.length) { toast('No recently closed editors.', 'info', 1800); return; }
  const path = S.recentlyClosed.pop();
  openFile(path).catch(() => toast('Could not reopen ' + nameOf(path), 'warn'));
}

function collectSession() {
  captureCurrentPosition();
  const active = currentEntry();
  const tabs = [];
  for (const entry of S.models.values()) {
    if (entry.virtual || !entry.path) continue;
    tabs.push({
      path: entry.path,
      line: entry.cursorLine || 1,
      column: entry.cursorColumn || 1,
      scrollTop: entry.scrollTop || 0
    });
  }
  return {
    version: 1,
    workspace: S.root,
    activeTab: active && !active.virtual ? active.path : (tabs[0] ? tabs[0].path : null),
    tabs: tabs
  };
}

function sessionSoon() {
  if (!S.state) return;
  clearTimeout(S.sessionTimer);
  S.sessionTimer = setTimeout(() => {
    api.session.save(collectSession()).catch(() => {});
  }, 450);
}

function sessionNow() {
  if (!S.state) return Promise.resolve();
  clearTimeout(S.sessionTimer);
  return api.session.save(collectSession()).catch(() => {});
}

function persistNow() {
  if (!S.state) return;
  S.state.lastFolder = S.root;
  S.state.openFiles = Array.from(S.models.values()).filter((e) => !e.virtual && e.path).map((e) => e.path);
  const cur = currentEntry();
  S.state.activeFile = cur && !cur.virtual ? cur.path : null;
  sessionSoon();
  return api.app.saveState(S.state).catch((err) => toast('Could not save session: ' + err.message, 'error'));
}

/* ---------------- views ---------------- */

function showView(view) {
  const map = { explorer: 'explorerView', search: 'searchView', git: 'gitView', outline: 'outlineView' };
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
      guides: { bracketPairs: true, indentation: true },
      autoClosingBrackets: 'always',
      autoClosingQuotes: 'always',
      autoIndent: 'full',
      formatOnType: false
    });

    S.editor.onDidChangeCursorPosition((e) => {
      $('position').textContent = 'Ln ' + e.position.lineNumber + ', Col ' + e.position.column;
      const entry = currentEntry();
      if (entry) {
        entry.cursorLine = e.position.lineNumber;
        entry.cursorColumn = e.position.column;
        sessionSoon();
      }
    });
    S.editor.onDidChangeModel(() => updateEol());
    // Clicking the glyph margin toggles a breakpoint at that line.
    S.editor.onMouseDown((event) => {
      const type = event && event.target && event.target.type;
      const GLYPH_MARGIN = (monaco.editor.MouseTargetType && monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) || 4;
      if (type !== GLYPH_MARGIN) return;
      const entry = currentEntry();
      if (!entry || !event.target.position) return;
      toggleBreakpoint(entry.path, event.target.position.lineNumber);
    });
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
  updateEncodingStatus();
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
  S.gitFiles = {};
  S.navHistory = [];
  S.navIndex = -1;
  S.recentlyClosed = [];
  S.blameCache.clear();
  exitCompare();
  stopDebugSession(true);
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

function gitCodeFor(path) {
  if (!S.root || !path) return null;
  const rel = PB.normalizePath(relativeToRoot(path));
  return S.gitFiles[rel] || S.gitFiles[rel.toLowerCase()] || null;
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
  if (!node.dir) {
    const code = gitCodeFor(node.path);
    if (code) row.appendChild(el('span', 'tree-git git-' + code, code));
  }

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

function reorderTabs(fromKey, toKey) {
  const keys = PB.reorderKeys(Array.from(S.models.keys()), fromKey, toKey);
  const next = new Map();
  for (const key of keys) next.set(key, S.models.get(key));
  S.models = next;
  renderTabs();
  persistSoon();
  sessionSoon();
}

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
    tab.draggable = true;
    tab.dataset.key = entry.key;
    tab.ondragstart = (e) => { S.dragKey = entry.key; e.dataTransfer.effectAllowed = 'move'; };
    tab.ondragover = (e) => { e.preventDefault(); tab.classList.add('drop-target'); };
    tab.ondragleave = () => tab.classList.remove('drop-target');
    tab.ondrop = (e) => {
      e.preventDefault();
      tab.classList.remove('drop-target');
      if (S.dragKey && S.dragKey !== entry.key) reorderTabs(S.dragKey, entry.key);
      S.dragKey = null;
    };
    tab.ondragend = () => {
      S.dragKey = null;
      $$('.tab').forEach(t => t.classList.remove('drop-target'));
    };
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
  const acc = [];
  parts.forEach((part, index) => {
    if (index) host.appendChild(el('span', 'sep', '›'));
    acc.push(part);
    const target = PB.normalizePath(S.root + '/' + acc.join('/'));
    const crumb = el('span', 'crumb', part);
    crumb.title = 'Reveal in Explorer';
    crumb.onclick = () => revealInExplorer(target);
    host.appendChild(crumb);
  });
}

async function revealInExplorer(path) {
  if (!S.root || !path) return;
  showView('explorer');
  const norm = PB.normalizePath(path).toLowerCase();
  const rootNorm = PB.normalizePath(S.root).toLowerCase();
  if (norm === rootNorm) { S.selectedPath = S.root; renderExplorer(); return; }
  const rel = PB.normalizePath(path).slice(PB.normalizePath(S.root).length + 1);
  const segments = rel.split('/');
  // Expand every ancestor folder, then select the final node.
  let acc = PB.normalizePath(S.root);
  for (let i = 0; i < segments.length - 1; i++) {
    acc = PB.normalizePath(acc + '/' + segments[i]);
    if (!S.expanded.has(acc)) {
      S.expanded.add(acc);
      if (!S.treeCache.has(acc)) {
        try { await loadChildren(acc); } catch { /* skip missing */ }
      }
    }
  }
  S.selectedPath = PB.normalizePath(path);
  renderExplorer();
  const row = $$('#tree .tree-row').find((r) => PB.normalizePath(r.dataset.path || '').toLowerCase() === norm);
  if (row) {
    $$('.tree-row.selected').forEach((n) => n.classList.remove('selected'));
    row.classList.add('selected');
    row.scrollIntoView({ block: 'nearest' });
  }
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
  if (S.compare) exitCompare();
  captureCurrentPosition();
  S.current = key;
  hideContextMenu();
  S.editor.updateOptions({ readOnly: !!entry.virtual });
  S.editor.setModel(entry.model);
  if (S.editor2) syncSplitModel();
  if (!entry.virtual) {
    const line = PB.clamp(entry.cursorLine || 1, 1, Math.max(1, entry.model.getLineCount()));
    const column = PB.clamp(entry.cursorColumn || 1, 1, 100000);
    S.editor.setPosition({ lineNumber: line, column: column });
    S.editor.setScrollTop(entry.scrollTop || 0);
  }
  renderTabs();
  renderBreadcrumb();
  updateStatus();
  syncWelcome();
  S.editor.focus();
  persistSoon();
  refreshOutline();
  sessionSoon();
  scheduleGitGutter(entry);
  wireBlameHover(entry.model.getLanguageId());
  scheduleBlameFetch(entry);
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
        mtime: res.mtimeMs !== undefined ? res.mtimeMs : res.mtime, size: res.size,
        cursorLine: 1, cursorColumn: 1, scrollTop: 0,
        saving: false, reloading: false, pendingSave: false,
        recoveryTimer: null, autosaveTimer: null
      };
      S.models.set(filePath, entry);
      bindModel(entry);
      applyBreakpointDecorations(entry);
      api.file.watchStart(filePath).catch(() => {});
    } catch (err) {
      toast('Could not open ' + nameOf(filePath) + ': ' + err.message, 'error', 6000);
      return;
    }
  }
  activateEntry(entry.key);
  if (line) {
    const pos = { lineNumber: PB.clamp(line, 1, Math.max(1, entry.model.getLineCount())), column: PB.clamp(column || 1, 1, 100000) };
    entry.cursorLine = pos.lineNumber;
    entry.cursorColumn = pos.column;
    S.editor.setPosition(pos);
    S.editor.revealPositionInCenter(pos);
  } else if (entry.scrollTop) {
    S.editor.setScrollTop(entry.scrollTop);
  }
  if (!S.navNavigating) pushNav(filePath, entry.cursorLine, entry.cursorColumn);
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
    scheduleGitGutter(entry);
  });
}

async function detectSaveConflict(entry) {
  if (!entry || !entry.path) return 0;
  let st;
  try { st = await api.file.stat(entry.path); } catch { return 0; }
  if (!st || !st.exists) return 0;
  const actual = st.mtimeMs !== undefined ? st.mtimeMs : st.mtime;
  if (!entry.mtime || !actual) return 0;
  if (Math.abs(actual - entry.mtime) < 1.5) return 0;
  if (entry.ignoredMtime && Math.abs(actual - entry.ignoredMtime) < 1.5) return 0;
  return actual;
}

async function saveFile(entry, options) {
  options = options || {};
  entry = entry || currentEntry();
  if (!entry || entry.virtual) return true;
  if (entry.saving) { entry.pendingSave = true; return false; }
  clearTimeout(entry.autosaveTimer);

  if (!options.force) {
    const conflict = await detectSaveConflict(entry);
    if (conflict) {
      const answer = await modalChoice(
        'File changed on disk',
        '"' + nameOf(entry.path) + '" was modified outside PeaBox. Overwrite the external changes?',
        [
          { label: 'Cancel', value: null },
          { label: 'Reload from Disk', value: 'reload' },
          { label: 'Overwrite', value: 'overwrite', class: 'primary' }
        ]
      );
      if (answer === 'reload') {
        try { await reloadEntry(entry); } catch (err) { toast(err.message, 'error'); }
        return false;
      }
      if (answer !== 'overwrite') return false;
      entry.ignoredMtime = conflict;
    }
  }

  entry.saving = true;
  const version = entry.model.getVersionId();
  if (settings().formatOnSave && currentEntry() === entry && !entry.virtual) {
    const langs = String(settings().formatOnSaveLanguages || '')
      .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    const langId = String(entry.model.getLanguageId() || '').toLowerCase();
    if (!langs.length || langs.includes(langId)) {
      try { editorAction('editor.action.formatDocument'); } catch { /* formatter unavailable */ }
    }
  }
  try {
    const res = await api.file.write(entry.path, entry.model.getValue());
    entry.mtime = res.mtimeMs !== undefined ? res.mtimeMs : res.mtime;
    entry.ignoredMtime = null;
    entry.deleted = false;
    if (entry.model.getVersionId() === version) entry.dirty = false;
    await api.recovery.clear(entry.path).catch(() => {});
    updateTab(entry);
    updateDirtyStatus();
    persistSoon();
    sessionSoon();
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
  if (!entry.virtual) {
    api.file.watchStop(entry.path).catch(() => {});
    S.recentlyClosed = S.recentlyClosed.filter((p) => p !== entry.path);
    S.recentlyClosed.push(entry.path);
    if (S.recentlyClosed.length > 12) S.recentlyClosed.shift();
  }
  if (S.editor2 && S.current2 === entry.key) { try { S.editor2.setModel(null); } catch { /* ignore */ } S.current2 = null; }
  try { entry.model.dispose(); } catch { /* ignore */ }
  S.models.delete(entry.key);
  if (S.current === entry.key) {
    const keys = Array.from(S.models.keys());
    S.current = keys.length ? keys[keys.length - 1] : null;
    const next = currentEntry();
    if (next) S.editor.setModel(next.model);
    else S.editor.setModel(null);
  }
  if (S.editor2) syncSplitModel();
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
  entry.mtime = res.mtimeMs !== undefined ? res.mtimeMs : res.mtime;
  entry.ignoredMtime = null;
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

async function checkExternalChangesOnFocus() {
  if (S.focusCheckBusy || !S.models.size) return;
  S.focusCheckBusy = true;
  const conflicts = [];
  try {
    for (const entry of Array.from(S.models.values())) {
      if (entry.virtual || entry.saving || !entry.path) continue;
      let st;
      try { st = await api.file.stat(entry.path); } catch { continue; }
      if (!st || !st.exists) {
        if (!entry.deleted) {
          entry.deleted = true;
          updateTab(entry);
          updateDirtyStatus();
        }
        continue;
      }
      const actual = st.mtimeMs !== undefined ? st.mtimeMs : st.mtime;
      if (!entry.mtime || !actual || Math.abs(actual - entry.mtime) < 1.5) continue;
      if (entry.ignoredMtime && Math.abs(actual - entry.ignoredMtime) < 1.5) continue;
      if (entry.dirty) {
        entry.externalMtime = actual;
        conflicts.push(nameOf(entry.path));
        continue;
      }
      try { await reloadEntry(entry); } catch { /* ignore unreadable */ }
    }
  } finally {
    S.focusCheckBusy = false;
  }
  if (conflicts.length) {
    toast(
      conflicts.length + ' file' + (conflicts.length === 1 ? '' : 's') +
      ' changed on disk: ' + conflicts.slice(0, 3).join(', ') +
      (conflicts.length > 3 ? '…' : '') + '. Saving will ask before overwriting.',
      'warn', 7000
    );
  }
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
  $('searchRegex').onclick = () => { $('searchRegex').classList.toggle('active'); runSearch(); };
  $('searchClear').onclick = () => { $('searchInput').value = ''; $('searchCase').classList.remove('active'); $('searchWord').classList.remove('active'); $('searchRegex').classList.remove('active'); clearResults(); };
  $('searchReplaceToggle').onclick = () => toggleReplaceRow();
  $('replaceAllBtn').onclick = () => { replaceAllFlow().catch((err) => toast(err.message, 'error')); };
  $('replaceInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); replaceAllFlow().catch((err) => toast(err.message, 'error')); }
  });
}

function toggleReplaceRow(force) {
  const row = $('searchReplaceRow');
  const show = force === undefined ? row.classList.contains('hidden') : !!force;
  row.classList.toggle('hidden', !show);
  $('searchReplaceToggle').classList.toggle('active', show);
  if (show) setTimeout(() => $('replaceInput').focus(), 30);
}

function openWorkspaceReplace() {
  showView('search');
  toggleReplaceRow(true);
  setTimeout(() => {
    const input = $('searchInput').value.trim() ? $('replaceInput') : $('searchInput');
    input.focus();
  }, 50);
}

async function replaceAllFlow() {
  if (!S.root) { toast('Open a folder first.', 'warn'); return; }
  const query = $('searchInput').value;
  if (!query.trim()) { toast('Enter search text first.', 'warn'); return; }
  const replacement = $('replaceInput').value;
  const options = {
    root: S.root, query, replacement,
    caseSensitive: $('searchCase').classList.contains('active'),
    wholeWord: $('searchWord').classList.contains('active'),
    useRegex: $('searchRegex').classList.contains('active'),
    excludes: PB.splitExcludes(settings().excludes)
  };
  let preview;
  try { preview = await api.workspace.replace({ ...options, dryRun: true }); }
  catch (err) { toast('Replace preview failed: ' + err.message, 'error', 6000); return; }
  if (!preview.total) { toast('No matches found for "' + query + '".', 'info', 2200); return; }

  const body = el('div');
  body.appendChild(el('p', null,
    preview.total + ' match' + (preview.total === 1 ? '' : 'es') + ' in ' +
    preview.files.length + ' file' + (preview.files.length === 1 ? '' : 's') +
    (preview.truncated ? ' (limited to 500 files)' : '') + '.'
  ));
  const list = el('div', 'modal-list');
  preview.files.slice(0, 60).forEach((file) => {
    const item = el('div', 'modal-item');
    const info = el('div', 'mi-body');
    info.append(
      el('div', 'mi-title', relativeToRoot(file.path) || file.rel),
      el('div', 'mi-sub', file.count + ' match' + (file.count === 1 ? '' : 'es'))
    );
    item.appendChild(info);
    list.appendChild(item);
  });
  if (preview.files.length > 60) {
    list.appendChild(el('div', 'modal-note', '…and ' + (preview.files.length - 60) + ' more files.'));
  }
  body.appendChild(list);

  const answer = await showModal({
    title: 'Replace in files',
    body,
    actions: [
      { label: 'Cancel', value: null },
      { label: 'Replace ' + preview.total, value: 'replace', class: 'primary' }
    ]
  });
  if (answer !== 'replace') return;

  let result;
  try { result = await api.workspace.replace({ ...options, dryRun: false }); }
  catch (err) { toast('Replace failed: ' + err.message, 'error', 7000); return; }
  toast('Replaced ' + result.total + ' match' + (result.total === 1 ? '' : 'es') +
    ' in ' + result.files.length + ' file' + (result.files.length === 1 ? '' : 's') + '.', 'success', 5000);

  const changed = new Set((result.files || []).map((f) => PB.normalizePath(f.path).toLowerCase()));
  for (const entry of Array.from(S.models.values())) {
    if (entry.virtual || !entry.path || !changed.has(PB.normalizePath(entry.path).toLowerCase())) continue;
    if (entry.dirty) {
      toast(nameOf(entry.path) + ' changed on disk and has unsaved edits.', 'warn', 6000);
      continue;
    }
    try { await reloadEntry(entry); } catch { /* keep tab as-is */ }
  }
  S.fileIndex = null;
  S.fileIndexRoot = null;
  await refreshExplorer();
  maybeRefreshGit();
  await runSearch();
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
      useRegex: $('searchRegex').classList.contains('active'),
      excludes: PB.splitExcludes(settings().excludes),
      maxResults: 800
    });
    if (token !== S.searchToken) return;
    if (res.error) {
      $('searchSummary').textContent = 'Invalid pattern.';
      $('searchResults').replaceChildren(el('div', 'search-empty', res.error));
      return;
    }
    renderSearchResults(res, query);
  } catch (err) {
    if (token !== S.searchToken) return;
    $('searchSummary').textContent = 'Search failed.';
    $('searchResults').replaceChildren(el('div', 'search-empty', err.message));
  }
}

function searchMatchRanges(text, query, useRegex, caseSensitive, wholeWord) {
  const ranges = [];
  if (!query) return ranges;
  if (useRegex) {
    let re;
    try { re = new RegExp(query, caseSensitive ? 'g' : 'gi'); } catch { return ranges; }
    let m = re.exec(text);
    while (m) {
      if (m[0].length) ranges.push([m.index, m[0].length]);
      else re.lastIndex++;
      m = re.exec(text);
    }
    return ranges;
  }
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  let start = 0, index = hay.indexOf(needle);
  while (index >= 0) {
    if (!wholeWord || PB.boundaryMatch(text, index, needle.length)) ranges.push([index, needle.length]);
    start = index + Math.max(1, needle.length);
    index = hay.indexOf(needle, start);
  }
  return ranges;
}

function renderSearchResults(res, query) {
  const host = $('searchResults');
  host.replaceChildren();
  const hits = res.hits || [];
  const useRegex = $('searchRegex').classList.contains('active');
  const caseSensitive = $('searchCase').classList.contains('active');
  const wholeWord = $('searchWord').classList.contains('active');
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
    const chevron = el('span', 'search-chevron', '▾');
    head.append(chevron, badgeFor(file), el('span', 'path', relativeToRoot(file)), el('span', 'count', String(fileHits.length)));
    head.title = file;
    head.onclick = () => {
      const collapsed = group.classList.toggle('collapsed');
      chevron.textContent = collapsed ? '▸' : '▾';
    };
    group.appendChild(head);
    for (const hit of fileHits) {
      const row = el('div', 'search-hit');
      row.appendChild(el('span', 'line', String(hit.line)));
      const snippet = el('span', 'snippet');
      appendHighlighted(snippet, hit.text, query, useRegex, caseSensitive, wholeWord);
      row.appendChild(snippet);
      row.title = hit.text;
      row.onclick = () => openFile(hit.path, hit.line, hit.column);
      group.appendChild(row);
    }
    host.appendChild(group);
  }
}

function appendHighlighted(host, text, query, useRegex, caseSensitive, wholeWord) {
  const ranges = searchMatchRanges(text, query, useRegex, caseSensitive, wholeWord);
  if (!ranges.length) { host.textContent = text; return; }
  let start = 0;
  for (const [index, length] of ranges) {
    if (index > start) host.appendChild(document.createTextNode(text.slice(start, index)));
    host.appendChild(el('mark', null, text.slice(index, index + length)));
    start = index + length;
  }
  if (start < text.length) host.appendChild(document.createTextNode(text.slice(start)));
}

/* ---------------- git ---------------- */

function maybeRefreshGit() {
  if (!S.root) return;
  clearTimeout(S.gitTimer);
  S.gitTimer = setTimeout(() => refreshGit(), 700);
}

function changeCode(change) {
  if (!change) return 'M';
  if (change.untracked) return 'U';
  const x = change.x || ' ';
  const y = change.y || ' ';
  if (x === '?' && y === '?') return 'U';
  if (x === 'R' || y === 'R' || x === 'C' || y === 'C') return 'R';
  if (x === 'D' || y === 'D') return 'D';
  if (x === 'A' || y === 'A') return 'A';
  return 'M';
}

function applyGitFiles(st) {
  const map = {};
  if (st && st.files && typeof st.files === 'object') {
    for (const key of Object.keys(st.files)) map[PB.normalizePath(key)] = st.files[key];
  }
  if (!Object.keys(map).length && st && Array.isArray(st.changes)) {
    for (const change of st.changes) {
      if (!change || !change.path) continue;
      map[PB.normalizePath(change.path)] = changeCode(change);
    }
  }
  S.gitFiles = map;
  updateGitTreeBadges();
}

function updateGitTreeBadges() {
  for (const row of $$('.tree-row.file')) {
    const path = row.dataset.path;
    const old = row.querySelector('.tree-git');
    if (old) old.remove();
    const code = gitCodeFor(path);
    if (!code) continue;
    const name = row.querySelector('.tree-name');
    const badge = el('span', 'tree-git git-' + code, code);
    if (name && name.nextSibling) row.insertBefore(badge, name.nextSibling);
    else row.appendChild(badge);
  }
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
  scheduleGitGutter(currentEntry());
}

/* ---------------- git gutter + inline blame ---------------- */

function gitRelativePath(path) {
  if (!S.root || !path) return '';
  return PB.normalizePath(relativeToRoot(path));
}

function scheduleGitGutter(entry) {
  if (!entry || entry.virtual || !entry.path || !S.root || !S.git || !S.git.repo) return;
  clearTimeout(entry.gutterTimer);
  entry.gutterTimer = setTimeout(() => updateGitGutter(entry), 300);
}

async function updateGitGutter(entry) {
  if (!entry || entry.virtual || !entry.path || !S.root) return;
  if (!S.editor || S.editor.getModel() !== entry.model) return;
  const token = (entry.gutterToken || 0) + 1;
  entry.gutterToken = token;
  let marks = [];
  try {
    const rel = gitRelativePath(entry.path);
    const code = S.gitFiles[rel] || S.gitFiles[rel.toLowerCase()] || null;
    if (code === 'U' || code === 'A') {
      const lineCount = entry.model.getLineCount();
      for (let i = 1; i <= lineCount; i++) marks.push({ line: i, type: 'add' });
    } else if (code) {
      const res = await api.git.diffLines({ cwd: S.root, file: entry.path });
      if (token !== entry.gutterToken) return;
      if (res && res.ok) marks = res.marks || [];
    }
  } catch { marks = []; }
  if (token !== entry.gutterToken) return;
  applyGitGutter(entry, marks);
}

function applyGitGutter(entry, marks) {
  if (!entry || !S.editor || S.editor.getModel() !== entry.model) return;
  const ruler = {
    add: 'rgba(87,166,74,0.55)',
    mod: 'rgba(48,133,203,0.55)',
    del: 'rgba(190,80,70,0.55)'
  };
  const decorations = (marks || []).map((m) => ({
    range: new monaco.Range(m.line, 1, m.line, 1),
    options: {
      isWholeLine: false,
      glyphMarginClassName: 'git-gutter-' + m.type,
      glyphMarginHoverMessage: {
        value: m.type === 'del'
          ? (m.count || 1) + ' line' + ((m.count || 1) === 1 ? '' : 's') + ' deleted here'
          : (m.type === 'add' ? 'Added line' : 'Modified line') + ' (vs HEAD)'
      },
      overviewRuler: { color: ruler[m.type], position: monaco.editor.OverviewRulerLane.Left },
      minimap: null
    }
  }));
  const old = entry.gutterIds || [];
  try {
    entry.gutterIds = entry.model.deltaDecorations(old, decorations);
  } catch { entry.gutterIds = []; }
}

let blameHoverWired = new Set();
let blameFetchTimer = null;

function scheduleBlameFetch(entry) {
  clearTimeout(blameFetchTimer);
  blameFetchTimer = setTimeout(() => fetchBlame(entry), 350);
}

async function fetchBlame(entry) {
  if (!entry || entry.virtual || !entry.path || !S.root || !S.git || !S.git.repo) return;
  const rel = gitRelativePath(entry.path);
  if (!S.gitFiles[rel] && !S.gitFiles[rel.toLowerCase()]) {
    // Untracked by status? Still may be tracked; only skip when explicitly untracked.
    if (S.gitFiles[rel] === 'U' || S.gitFiles[rel.toLowerCase()] === 'U') return;
  }
  try {
    const res = await api.git.blame({ cwd: S.root, file: entry.path });
    if (!res || !res.ok) return;
    const records = PB.parseGitBlame(res.stdout || '');
    if (records.length) S.blameCache.set(entry.path, records);
    else S.blameCache.delete(entry.path);
  } catch { /* blame unavailable */ }
}

function blameForLine(entry, line) {
  if (!entry || !entry.path) return null;
  const records = S.blameCache.get(entry.path);
  if (!records || !records.length) return null;
  let lo = 0, hi = records.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const rec = records[mid];
    if (rec.line === line) return rec;
    if (rec.line < line) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

function wireBlameHover(lang) {
  if (blameHoverWired.has(lang)) return;
  blameHoverWired.add(lang);
  monaco.languages.registerHoverProvider(lang, {
    provideHover: (model, position) => {
      const entry = currentEntry();
      if (!entry || entry.model !== model) return null;
      const rec = blameForLine(entry, position.lineNumber);
      if (!rec) return null;
      const when = rec.time ? new Date(rec.time * 1000) : null;
      const whenText = when ? PB.relativeTime(when.getTime()) : 'unknown time';
      const lines = [
        '**' + (rec.author || 'Unknown') + '** · ' + whenText,
        '`' + rec.hash.slice(0, 8) + '` ' + (rec.text || '').slice(0, 120)
      ];
      return { contents: lines.map((value) => ({ value })) };
    }
  });
}

/* ---------------- debugging (DAP) ---------------- */

const DEBUG_PRESETS = [
  {
    id: 'python-debugpy',
    label: 'Python (debugpy adapter)',
    command: 'python',
    args: '-m debugpy.adapter',
    launch: { request: 'launch', program: '${program}', cwd: '${cwd}', console: 'internalConsole', justMyCode: false, stopOnEntry: false }
  },
  {
    id: 'node-js-debug',
    label: 'Node.js (js-debug adapter — npm i @vscode/js-debug)',
    command: 'node',
    args: '${jsDebugPath}/src/debugServerMain.js',
    launch: { type: 'pwa-node', request: 'launch', name: 'PeaBox Debug', program: '${program}', cwd: '${cwd}', console: 'internalConsole', stopOnEntry: false }
  },
  {
    id: 'custom',
    label: 'Custom adapter…',
    command: '',
    args: '',
    launch: { request: 'launch', program: '${program}', cwd: '${cwd}', stopOnEntry: false }
  }
];

async function startDebugFlow() {
  if (!S.root) { toast('Open a folder first.', 'warn'); return; }
  if (S.debug) { toast('A debug session is already running. Stop it first.', 'warn', 3000); return; }
  const entry = currentEntry();
  const body = el('div');
  const presetLabel = el('label', 'modal-note', 'Adapter');
  const presetSelect = el('select', 'modal-input');
  for (const preset of DEBUG_PRESETS) {
    const opt = el('option', null, preset.label);
    opt.value = preset.id;
    presetSelect.appendChild(opt);
  }
  const programLabel = el('label', 'modal-note', 'Program to debug');
  const programInput = el('input', 'modal-input');
  programInput.type = 'text';
  programInput.spellcheck = false;
  if (entry && entry.path) programInput.value = entry.path;
  const cmdLabel = el('label', 'modal-note', 'Adapter command');
  const cmdInput = el('input', 'modal-input');
  cmdInput.type = 'text';
  cmdInput.value = DEBUG_PRESETS[0].command;
  const argsLabel = el('label', 'modal-note', 'Adapter arguments (comma separated)');
  const argsInput = el('input', 'modal-input');
  argsInput.type = 'text';
  argsInput.value = DEBUG_PRESETS[0].args;
  const launchLabel = el('label', 'modal-note', 'Launch configuration (JSON)');
  const launchInput = el('textarea', 'modal-input');
  launchInput.rows = 6;
  launchInput.spellcheck = false;
  const syncPreset = () => {
    const preset = DEBUG_PRESETS.find((p) => p.id === presetSelect.value) || DEBUG_PRESETS[0];
    cmdInput.value = preset.command;
    argsInput.value = preset.args;
    const launch = Object.assign({}, preset.launch, { program: programInput.value || '', cwd: S.root });
    launchInput.value = JSON.stringify(launch, null, 2);
  };
  presetSelect.onchange = syncPreset;
  programInput.addEventListener('change', syncPreset);
  syncPreset();
  body.append(presetLabel, presetSelect, programLabel, programInput, cmdLabel, cmdInput, argsLabel, argsInput, launchLabel, launchInput);

  const answer = await showModal({
    title: 'Start Debugging',
    body,
    actions: [{ label: 'Cancel', value: null }, { label: 'Start', value: 'start', class: 'primary' }]
  });
  if (answer !== 'start') return;
  let launch;
  try { launch = JSON.parse(launchInput.value || '{}'); }
  catch (err) { toast('Launch configuration is not valid JSON: ' + err.message, 'error', 6000); return; }
  const command = cmdInput.value.trim();
  if (!command) { toast('Adapter command is required.', 'warn'); return; }
  const args = argsInput.value.split(',').map((x) => x.trim()).filter(Boolean);
  await startDebugSession({ command, args, launch, adapterId: presetSelect.value });
}

async function startDebugSession(config) {
  debugLogClear();
  debugLog('Starting adapter: ' + config.command + ' ' + (config.args || []).join(' '));
  let res;
  try { res = await api.dap.start({ id: 'peabox-debug', command: config.command, args: config.args, cwd: S.root }); }
  catch (err) { toast('Could not start adapter: ' + err.message, 'error', 6000); return false; }
  if (!res || !res.ok) { toast((res && res.error) || 'Adapter failed to start.', 'error', 6000); return false; }

  const session = {
    id: res.id,
    threadId: null,
    frames: [],
    stoppedLocation: null
  };
  S.debug = session;
  debugState('starting…');

  const initialized = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Adapter did not initialize within 10s.')), 10000);
    debugInitializedResolve = () => { clearTimeout(timer); resolve(); };
    debugInitializedReject = (err) => { clearTimeout(timer); reject(err); };
  });

  try {
    await api.dap.request({ id: session.id, method: 'initialize', params: {
      adapterID: config.adapterId || 'peabox',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsVariablePaging: false,
      supportsRunInTerminalRequest: false,
      locale: 'en'
    } });
    sendBreakpointsToAdapter();
    await initialized;
    await api.dap.request({ id: session.id, method: 'launch', params: config.launch || {} });
    await api.dap.request({ id: session.id, method: 'configurationDone', params: {} });
    debugState('running');
    debugLog('Session started.');
    showPanel('debugPane');
    toast('Debug session started.', 'success', 2200);
    updateDebugToolbar();
    return true;
  } catch (err) {
    toast('Debug startup failed: ' + err.message, 'error', 7000);
    debugLog('Startup failed: ' + err.message);
    await stopDebugSession(true);
    return false;
  }
}

let debugInitializedResolve = null;
let debugInitializedReject = null;

async function stopDebugSession(silent) {
  const session = S.debug;
  clearPausedHighlight();
  S.debug = null;
  if (!session) return;
  try { await api.dap.stop({ id: session.id }); } catch { /* already gone */ }
  if (!silent) { debugState(''); toast('Debug session ended.', 'info', 1800); }
  debugState('');
  updateDebugToolbar();
}

async function debugCommand(method, params) {
  const session = S.debug;
  if (!session) { toast('No debug session running.', 'warn', 2000); return; }
  try {
    const res = await api.dap.request({ id: session.id, method, params: params || {} });
    if (!res || !res.ok) { toast((res && res.error) || (method + ' failed.'), 'error', 4000); }
  } catch (err) { toast(err.message, 'error', 4000); }
}

async function debugContinue() { if (S.debug) await debugCommand('continue', { threadId: S.debug.threadId || 0 }); }
async function debugPause() { if (S.debug) await debugCommand('pause', { threadId: S.debug.threadId || 0 }); }
async function debugStepOver() { if (S.debug) await debugCommand('next', { threadId: S.debug.threadId || 0 }); }
async function debugStepIn() { if (S.debug) await debugCommand('stepIn', { threadId: S.debug.threadId || 0 }); }
async function debugStepOut() { if (S.debug) await debugCommand('stepOut', { threadId: S.debug.threadId || 0 }); }

async function handleDapEvent(evt) {
  const event = evt && evt.event;
  const body = evt && evt.body;
  // Events arrive before S.debug exists for adapterError/adapterExit.
  if (event === 'adapterError') { debugLog('adapter: ' + ((body && body.text) || '').trim()); return; }
  if (event === 'adapterExit') { debugLog('adapter exited' + (body && body.code != null ? ' (code ' + body.code + ')' : '') + '.'); if (S.debug) { await stopDebugSession(true); } return; }
  if (!S.debug) return;
  switch (event) {
    case 'initialized':
      if (debugInitializedResolve) { const fn = debugInitializedResolve; debugInitializedResolve = null; fn(); }
      break;
    case 'process':
      debugLog('process: ' + ((body && body.name) || ''));
      break;
    case 'output':
      debugLog(((body && body.output) || '').replace(/\n$/, ''));
      break;
    case 'breakpoint':
      // Adapter may adjust breakpoint lines; accept the verified line.
      if (body && body.breakpoint && body.breakpoint.verified && body.breakpoint.line) {
        debugLog('breakpoint verified at line ' + body.breakpoint.line);
      }
      break;
    case 'stopped': {
      debugState('paused' + (body && body.reason ? ' (' + body.reason + ')' : ''));
      const threadId = body && body.threadId ? body.threadId : null;
      await refreshDebugStopped(threadId);
      break;
    }
    case 'continued':
      debugState('running');
      clearPausedHighlight();
      break;
    case 'exited':
      debugLog('program exited (code ' + ((body && body.exitCode) != null ? body.exitCode : '?') + ').');
      break;
    case 'terminated':
      await stopDebugSession(true);
      break;
    default:
      break;
  }
}

async function refreshDebugStopped(threadId) {
  const session = S.debug;
  if (!session) return;
  try {
    if (threadId) session.threadId = threadId;
    const threadsRes = await api.dap.request({ id: session.id, method: 'threads', params: {} });
    const threads = (threadsRes && threadsRes.ok && threadsRes.result && threadsRes.result.threads) || [];
    if (!session.threadId && threads.length) session.threadId = threads[0].id;
    const stackRes = await api.dap.request({ id: session.id, method: 'stackTrace', params: { threadId: session.threadId || (threads[0] && threads[0].id) || 0, levels: 20 } });
    const frames = (stackRes && stackRes.ok && stackRes.result && stackRes.result.stackFrames) || [];
    session.frames = frames;
    renderDebugStack(frames);
    if (frames.length) {
      const top = frames[0];
      if (top.source && top.source.path) {
        await openFile(top.source.path, top.line, top.column || 1);
        highlightPausedLine(top.source.path, top.line);
      }
    }
    const topFrame = frames[0];
    if (topFrame) await refreshDebugVariables(topFrame.id);
    showPanel('debugPane');
  } catch (err) {
    debugLog('Could not refresh stack: ' + err.message);
  }
}

async function refreshDebugVariables(frameId) {
  const session = S.debug;
  if (!session) return;
  const host = $('debugVariables');
  host.replaceChildren();
  try {
    const scopesRes = await api.dap.request({ id: session.id, method: 'scopes', params: { frameId } });
    const scopes = (scopesRes && scopesRes.ok && scopesRes.result && scopesRes.result.scopes) || [];
    for (const scope of scopes.slice(0, 6)) {
      const scopeRow = el('div', 'debug-scope', scope.name);
      host.appendChild(scopeRow);
      const varsRes = await api.dap.request({ id: session.id, method: 'variables', params: { variablesReference: scope.variablesReference, start: 0, count: 80 } });
      const vars = (varsRes && varsRes.ok && varsRes.result && varsRes.result.variables) || [];
      for (const v of vars) host.appendChild(debugVariableRow(v, 1));
    }
    if (!scopes.length) host.appendChild(el('div', 'debug-empty', 'No variables in scope.'));
  } catch (err) {
    host.replaceChildren(el('div', 'debug-empty', err.message));
  }
}

function debugVariableRow(variable, depth) {
  const row = el('div', 'debug-var');
  row.style.paddingLeft = (depth * 14) + 'px';
  const name = el('span', 'debug-var-name', variable.name);
  const value = el('span', 'debug-var-value', variable.value || '');
  row.append(name, value);
  row.title = variable.value || '';
  if (variable.variablesReference > 0 && depth < 4) {
    row.appendChild(el('span', 'debug-var-expand', '▸'));
    row.classList.add('expandable');
    let expanded = false;
    row.onclick = async () => {
      if (expanded) return;
      expanded = true;
      row.querySelector('.debug-var-expand').textContent = '▾';
      const session = S.debug;
      if (!session) return;
      try {
        const res = await api.dap.request({ id: session.id, method: 'variables', params: { variablesReference: variable.variablesReference, start: 0, count: 80 } });
        const vars = (res && res.ok && res.result && res.result.variables) || [];
        for (const v of vars) row.parentNode.insertBefore(debugVariableRow(v, depth + 1), row.nextSibling);
        if (!vars.length) row.parentNode.insertBefore(el('div', 'debug-empty', '(empty)'), row.nextSibling);
      } catch (err) { debugLog('variables: ' + err.message); }
    };
  }
  return row;
}

function renderDebugStack(frames) {
  const host = $('debugStack');
  host.replaceChildren();
  if (!frames || !frames.length) { host.appendChild(el('div', 'debug-empty', 'No frames.')); return; }
  frames.forEach((frame, index) => {
    const row = el('div', 'debug-frame' + (index === 0 ? ' top' : ''));
    const name = el('div', 'debug-frame-name', frame.name || '(anonymous)');
    const loc = el('div', 'debug-frame-loc', (frame.source && frame.source.name ? frame.source.name + ':' : '') + frame.line);
    row.append(name, loc);
    row.onclick = async () => {
      if (frame.source && frame.source.path) {
        await openFile(frame.source.path, frame.line, frame.column || 1);
        highlightPausedLine(frame.source.path, frame.line);
      }
    };
    host.appendChild(row);
  });
}

/* ---------------- breakpoints ---------------- */

function breakpointKey(path) {
  return PB.normalizePath(path || '').toLowerCase();
}

function toggleBreakpoint(path, line) {
  const key = breakpointKey(path);
  const lines = S.breakpoints.get(key) || [];
  const index = lines.indexOf(line);
  if (index >= 0) lines.splice(index, 1);
  else { lines.push(line); lines.sort((a, b) => a - b); }
  S.breakpoints.set(key, lines);
  renderBreakpoints();
  if (S.debug) sendBreakpointsToAdapter();
  return index < 0;
}

function renderBreakpoints() {
  for (const entry of S.models.values()) {
    if (entry.virtual || !entry.path) continue;
    applyBreakpointDecorations(entry);
  }
}

function applyBreakpointDecorations(entry) {
  if (!entry || !entry.model) return;
  const key = breakpointKey(entry.path);
  const lines = S.breakpoints.get(key) || [];
  const decorations = lines.map((line) => ({
    range: new monaco.Range(line, 1, line, 1),
    options: {
      isWholeLine: false,
      glyphMarginClassName: 'peabox-breakpoint',
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      overviewRuler: { color: 'rgba(229,83,75,0.8)', position: monaco.editor.OverviewRulerLane.Right }
    }
  }));
  const old = entry.bpIds || [];
  try { entry.bpIds = entry.model.deltaDecorations(old, decorations); } catch { entry.bpIds = []; }
}

async function sendBreakpointsToAdapter() {
  const session = S.debug;
  if (!session) return;
  for (const [key, lines] of S.breakpoints) {
    if (!lines.length) continue;
    const entry = Array.from(S.models.values()).find((e) => e.path && breakpointKey(e.path) === key);
    const path = entry ? entry.path : key;
    try {
      await api.dap.request({ id: session.id, method: 'setBreakpoints', params: {
        source: { path, name: PB.basename(path) },
        breakpoints: lines.map((line) => ({ line })),
        sourceModified: false
      } });
    } catch (err) { debugLog('breakpoints: ' + err.message); }
  }
}

function highlightPausedLine(path, line) {
  clearPausedHighlight();
  const entry = S.models.get(path) || Array.from(S.models.values()).find((e) => e.path && breakpointKey(e.path) === breakpointKey(path));
  if (!entry || !S.editor || S.editor.getModel() !== entry.model) return;
  entry.pausedIds = entry.model.deltaDecorations([], [{
    range: new monaco.Range(line, 1, line, 1),
    options: {
      isWholeLine: true,
      className: 'peabox-paused-line',
      linesDecorationsClassName: 'peabox-paused-arrow',
      overviewRuler: { color: 'rgba(229,175,58,0.9)', position: monaco.editor.OverviewRulerLane.Center }
    }
  }]);
}

function clearPausedHighlight() {
  for (const entry of S.models.values()) {
    if (entry.pausedIds && entry.model) {
      try { entry.model.deltaDecorations(entry.pausedIds, []); } catch { /* ignore */ }
      entry.pausedIds = null;
    }
  }
}

/* ---------------- debug pane UI ---------------- */

function debugState(text) {
  $('debugState').textContent = text || '';
}

function debugLogClear() {
  $('debugLog').textContent = '';
}

function debugLog(message) {
  const host = $('debugLog');
  host.textContent += (host.textContent ? '\n' : '') + message;
  host.scrollTop = host.scrollHeight;
}

function updateDebugToolbar() {
  const active = !!S.debug;
  ['debugContinue', 'debugPause', 'debugStepOver', 'debugStepIn', 'debugStepOut'].forEach((id) => {
    $(id).disabled = !active;
  });
  $('debugStop').disabled = !active;
  if (!active) {
    $('debugStack').replaceChildren(el('div', 'debug-empty', 'No active session.'));
    $('debugVariables').replaceChildren(el('div', 'debug-empty', 'No active session.'));
  }
}

function wireDebugUi() {
  $('debugContinue').onclick = () => debugContinue();
  $('debugPause').onclick = () => debugPause();
  $('debugStepOver').onclick = () => debugStepOver();
  $('debugStepIn').onclick = () => debugStepIn();
  $('debugStepOut').onclick = () => debugStepOut();
  $('debugStop').onclick = () => stopDebugSession();
  updateDebugToolbar();
  api.on.dapEvent((evt) => { handleDapEvent(evt).catch(() => {}); });
}

function renderGitNoRepo(message) {
  $('gitSummary').textContent = message;
  $('gitChanges').replaceChildren(el('div', 'git-empty', message));
  $('gitBranch').replaceChildren();
  $('gitStatus').classList.add('hidden');
  S.gitFiles = {};
  updateGitTreeBadges();
}

function renderGit(st) {
  const host = $('gitChanges');
  host.replaceChildren();
  if (!st.repo) { renderGitNoRepo(st.text || 'Not a Git repository.'); return; }
  applyGitFiles(st);
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
  actions.appendChild(gitAction('list', 'Show hunks', () => openHunkDiff(change, staged)));
  actions.appendChild(gitAction('history', 'Show history', () => openFileHistory(change.path)));
  actions.appendChild(gitAction('blame', 'Show blame', () => openFileBlame(change.path)));
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

/* ---------------- per-hunk staging UI ---------------- */

async function openHunkDiff(change, staged) {
  if (!S.root) return;
  try {
    const res = await api.git.diff({ cwd: S.root, file: change.path, staged });
    const hunks = PB.parseGitHunks(res.stdout || '');
    if (!hunks.length) { toast('No hunks in this diff', 'info', 1500); return; }
    const body = el('div', 'hunk-modal-body');
    for (const h of hunks) {
      const card = el('div', 'hunk-card');
      const meta = el('div', 'hunk-meta');
      meta.textContent = 'L' + h.newStart + ' · +' + h.addedCount + ' −' + h.removedCount + ' · ' + PB.basename(change.path);
      card.appendChild(meta);
      const code = el('pre', 'hunk-code');
      code.textContent = h.raw;
      card.appendChild(code);
      const btn = el('button', 'mini-btn');
      btn.textContent = staged ? 'Unstage hunk' : 'Stage hunk';
      btn.onclick = async () => {
        const patch = PB.buildHunkPatch(h);
        try {
          const action = staged ? 'unstageHunk' : 'stageHunk';
          const r = await api.git[action]({ cwd: S.root, patch });
          if (r && r.ok) { toast((staged ? 'Unstaged' : 'Staged') + ' hunk in ' + PB.basename(change.path), 'success', 1500); }
          else { toast(r && r.text ? r.text : 'Hunk action failed', 'error'); }
          await refreshGit();
        } catch (err) { toast(err.message, 'error'); }
      };
      card.appendChild(btn);
      body.appendChild(card);
    }
    await showModal({
      title: 'Hunks · ' + PB.basename(change.path) + (staged ? ' (staged)' : ''),
      body,
      actions: [{ label: 'Close', value: null }]
    });
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------------- history / blame UI ---------------- */

async function openFileHistory(path) {
  if (!S.root) return;
  try {
    const res = await api.git.log({ cwd: S.root, file: path });
    if (!res || !res.ok) { toast(res && res.text ? res.text : 'Failed to fetch history', 'error'); return; }
    const commits = PB.parseGitLog(res.stdout || '');
    const body = el('div', 'history-modal-body');
    body.replaceChildren();

    if (!commits.length) {
      body.appendChild(el('div', 'no-commits', 'No commit history for this file.'));
    } else {
      commits.forEach((c, i) => {
        const card = el('div', 'history-card');
        const meta = el('div', 'history-meta');
        meta.textContent = `${c.shortHash} ${c.date} ${c.subject}`;
        card.appendChild(meta);

        const diffBtn = el('button', 'mini-btn');
        diffBtn.textContent = 'Diff';
        diffBtn.onclick = async () => {
          const showRes = await api.git.show({ cwd: S.root, hash: c.hash, file: path });
          if (showRes && showRes.ok) {
            await openVirtual(`📄 ${c.shortHash} ${PB.basename(path)} (${c.subject})`);
            openVirtual(showRes.stdout || '(no diff)');
          } else {
            toast(showRes && showRes.text ? showRes.text : 'Failed to show diff', 'error');
          }
        };
        card.appendChild(diffBtn);

        body.appendChild(card);
      });
    }

    await showModal({
      title: 'History · ' + PB.basename(path),
      body,
      actions: [{ label: 'Close', value: null }]
    });
  } catch (err) { toast(err.message, 'error'); }
}

async function openFileBlame(path) {
  if (!S.root) return;
  try {
    const res = await api.git.blame({ cwd: S.root, file: path });
    if (!res || !res.ok) { toast(res && res.text ? res.text : 'Failed to fetch blame', 'error'); return; }
    const records = PB.parseGitBlame(res.stdout || '');
    const body = el('div', 'blame-modal-body');
    body.replaceChildren();

    if (!records.length) {
      body.appendChild(el('div', 'no-blame', 'No blame information available.'));
      return;
    }

    records.forEach(record => {
      const card = el('div', 'blame-card');
      const meta = el('div', 'blame-meta');
      meta.textContent = `L${record.line} (${record.hash.slice(0, 7)})`;
      card.appendChild(meta);

      const text = el('pre', 'blame-text');
      text.textContent = record.text;
      card.appendChild(text);

      const info = el('div', 'blame-info');
      info.textContent = `${record.author} <${record.authorMail}>`;
      card.appendChild(info);

      body.appendChild(card);
    });

    await showModal({
      title: 'Blame · ' + PB.basename(path),
      body,
      actions: [{ label: 'Close', value: null }]
    });
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

async function deleteBranchFlow() {
  if (!S.root) { toast('Open a folder first.', 'warn'); return; }
  let branches, current;
  try {
    const res = await api.git.branches(S.root);
    branches = res.branches || [];
    current = res.current || '';
  } catch (err) { toast(err.message, 'error'); return; }
  const candidates = branches.filter((b) => b !== current);
  if (!candidates.length) { toast('No other branches to delete.', 'info', 2200); return; }
  const body = el('div');
  body.appendChild(el('p', null, 'Delete a branch. The current branch (' + current + ') cannot be deleted.'));
  const list = el('div', 'modal-list');
  const selected = { value: null };
  candidates.forEach((branch) => {
    const item = el('div', 'modal-item');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = 'delete-branch';
    radio.value = branch;
    radio.onchange = () => { if (radio.checked) selected.value = branch; };
    const info = el('div', 'mi-body');
    info.appendChild(el('div', 'mi-title', branch));
    item.append(radio, info);
    item.style.cursor = 'pointer';
    item.onclick = () => { radio.checked = true; selected.value = branch; };
    list.appendChild(item);
  });
  body.appendChild(list);
  const answer = await showModal({
    title: 'Delete Branch',
    body,
    actions: [
      { label: 'Cancel', value: null },
      { label: 'Delete', value: 'delete' },
      { label: 'Force Delete', value: 'force' }
    ]
  });
  if (!answer || !selected.value) return;
  try {
    const res = await api.git.deleteBranch({ cwd: S.root, branch: selected.value, force: answer === 'force' });
    const text = (res.text || '').trim();
    if (res.ok) toast('Deleted branch ' + selected.value + '.', 'success', 3000);
    else toast(text || 'Could not delete branch (try Force Delete).', 'error', 5000);
    await refreshGit();
  } catch (err) { toast(err.message, 'error'); }
}

async function amendCommitFlow() {
  if (!S.root) { toast('Open a folder first.', 'warn'); return; }
  let lastSubject = '';
  try {
    const res = await api.git.log(S.root);
    const commits = PB.parseGitLog(res.stdout || '');
    if (commits.length) lastSubject = commits[0].subject || '';
  } catch { /* unknown */ }
  const message = await modalInput('Amend Last Commit', 'New commit message', lastSubject, 'Amend',
    'This rewrites the most recent commit. Only do this if it has not been pushed.');
  if (!message) return;
  try {
    const res = await api.git.commit({ cwd: S.root, message, amend: true });
    toast(res.ok ? 'Commit amended.' : (res.text || 'Amend failed.'), res.ok ? 'success' : 'error', 5000);
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

/* ---------------- language server (LSP) UI ---------------- */

function lspRow(server) {
  const row = el('div', 'lsp-row');
  const name = el('span', 'lsp-name', server.id + ' · ' + server.command);
  name.title = (server.args || []).join(' ');
  row.appendChild(name);
  const state = el('span', 'lsp-state ' + (server.alive ? 'alive' : 'dead'), server.alive ? 'running' : 'stopped');
  row.appendChild(state);
  return row;
}

async function showLspServers() {
  try {
    const res = await api.lsp.list();
    const body = el('div', 'lsp-list');
    const servers = (res && res.servers) || [];
    if (!servers.length) body.appendChild(el('div', 'lsp-empty', 'No language servers running.'));
    for (const s of servers) body.appendChild(lspRow(s));
    await showModal({ title: 'Language Servers', body, actions: [{ label: 'Close', value: null }] });
  } catch (err) { toast(err.message, 'error'); }
}

async function openLspStart() {
  const body = el('div', 'lsp-form');
  body.appendChild(el('div', 'lsp-hint', 'Start a language server that speaks LSP over stdio.'));
  const mkField = (label, placeholder, value) => {
    const wrap = el('div', 'lsp-field');
    wrap.appendChild(el('label', 'lsp-label', label));
    const input = el('input', 'lsp-input');
    input.placeholder = placeholder;
    input.value = value || '';
    wrap.appendChild(input);
    return wrap;
  };
  const idField = mkField('Server id', 'e.g. ts-lsp');
  const cmdField = mkField('Command', 'e.g. typescript-language-server --stdio');
  const argsField = mkField('Args (comma separated)', 'e.g. --stdio', '');
  body.append(idField, cmdField, argsField);
  const res = await showModal({
    title: 'Start Language Server',
    body,
    actions: [{ label: 'Start', value: true, class: 'primary' }, { label: 'Cancel', value: null }]
  });
  if (!res) return;
  const id = idField.querySelector('input').value.trim();
  const command = cmdField.querySelector('input').value.trim();
  const argsRaw = argsField.querySelector('input').value.trim();
  if (!command) { toast('Command is required.', 'warn'); return; }
  const args = argsRaw ? argsRaw.split(',').map((x) => x.trim()).filter(Boolean) : [];
  try {
    const start = await api.lsp.start({ id: id || undefined, command, args, cwd: S.root || undefined });
    if (start && start.ok) {
      toast('Language server ' + (start.alreadyRunning ? 'already running' : 'started') + ': ' + start.id, 'success', 2500);
    } else {
      toast((start && start.error) || 'Failed to start language server.', 'error', 4000);
    }
  } catch (err) { toast(err.message, 'error'); }
}

async function wireLspToEditor() {
  const entry = currentEntry();
  const editor = S.editor;
  if (!entry || !editor || !editor.getModel()) { toast('Open a file first.', 'warn'); return; }
  const model = editor.getModel();
  const lang = model.getLanguageId();
  try {
    const res = await api.lsp.list();
    const servers = (res && res.servers) || [];
    const alive = servers.filter((s) => s.alive);
    if (!alive.length) { toast('No running language servers.', 'warn'); return; }
    const server = alive[0];
    const caps = server.capabilities || {};
    const lsp = api.lsp;
    // Wire completion provider if supported.
    if (PB.lspMethodCapable(caps, 'textDocument/completion')) {
      monaco.languages.registerCompletionItemProvider(lang, {
        provideCompletionItems: async (model, position) => {
          const pos = PB.monacoPositionToLSP({ line: position.lineNumber - 1, column: position.column - 1 });
          const result = await lsp.request({ id: server.id, method: 'textDocument/completion', params: {
            textDocument: { uri: model.uri.toString() }, position: pos
          } });
          if (!result || !result.ok || !result.result) return { suggestions: [] };
          const items = (result.result.items || result.result).map(PB.toMonacoCompletionItem).filter(Boolean);
          return { suggestions: items };
        }
      });
    }
    // Wire hover provider if supported.
    if (PB.lspMethodCapable(caps, 'textDocument/hover')) {
      monaco.languages.registerHoverProvider(lang, {
        provideHover: async (model, position) => {
          const pos = PB.monacoPositionToLSP({ line: position.lineNumber - 1, column: position.column - 1 });
          const result = await lsp.request({ id: server.id, method: 'textDocument/hover', params: {
            textDocument: { uri: model.uri.toString() }, position: pos
          } });
          if (!result || !result.ok || !result.result) return null;
          return PB.toMonacoHover(result.result);
        }
      });
    }
    toast('Wired LSP (' + server.id + ') for ' + lang + '.', 'success', 2500);
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------------- LSP navigation commands ---------------- */

async function activeLspServer() {
  const entry = currentEntry();
  if (!entry || entry.virtual) return null;
  try {
    const res = await api.lsp.list();
    const servers = (res && res.servers) || [];
    return servers.find((s) => s.alive) || null;
  } catch { return null; }
}

function currentLspParams(model) {
  const entry = currentEntry();
  const pos = S.editor.getPosition();
  return {
    entry,
    uri: model.uri.toString(),
    position: { line: Math.max(0, pos.lineNumber - 1), character: Math.max(0, pos.column - 1) }
  };
}

function openLspLocation(loc) {
  if (!loc) return;
  const uri = String(loc.uri || '');
  if (!uri.startsWith('file://')) return;
  const filePath = decodeURIComponent(uri.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1'));
  const line = ((loc.range && loc.range.start && loc.range.start.line) || 0) + 1;
  const col = ((loc.range && loc.range.start && loc.range.start.character) || 0) + 1;
  openFile(filePath, line, col);
}

async function goToDefinition() {
  const entry = currentEntry();
  if (!entry || !S.editor || !S.editor.getModel()) { toast('Open a file first.', 'warn'); return; }
  const server = await activeLspServer();
  if (!server) { toast('No running language server. Start one from the palette.', 'warn', 3000); return; }
  const model = S.editor.getModel();
  const params = currentLspParams(model);
  try {
    const res = await api.lsp.definition({ id: server.id, uri: params.uri, position: params.position });
    if (!res || !res.ok) { toast((res && res.error) || 'Definition lookup failed.', 'error', 3500); return; }
    const result = res.result;
    if (!result) { toast('No definition found.', 'info', 1800); return; }
    const loc = Array.isArray(result) ? result[0] : result;
    openLspLocation(loc);
  } catch (err) { toast(err.message, 'error'); }
}

async function findLspReferences() {
  const entry = currentEntry();
  if (!entry || !S.editor || !S.editor.getModel()) { toast('Open a file first.', 'warn'); return; }
  const server = await activeLspServer();
  if (!server) { toast('No running language server. Start one from the palette.', 'warn', 3000); return; }
  const model = S.editor.getModel();
  const params = currentLspParams(model);
  try {
    const res = await api.lsp.references({ id: server.id, uri: params.uri, position: params.position });
    if (!res || !res.ok) { toast((res && res.error) || 'References lookup failed.', 'error', 3500); return; }
    const refs = res.result || [];
    if (!refs.length) { toast('No references found.', 'info', 1800); return; }
    // Show references in the output panel with clickable lines.
    showPanel('outputPane');
    $('output').textContent = 'References (' + refs.length + '):\n\n';
    for (const loc of refs) {
      $('output').textContent += String(loc.snippet || (loc.uri + ':' + loc.line)) + '\n';
    }
    toast(refs.length + ' reference(s) found (see Output panel).', 'info', 3000);
  } catch (err) { toast(err.message, 'error'); }
}

async function renameSymbolLsp() {
  const entry = currentEntry();
  if (!entry || !S.editor || !S.editor.getModel()) { toast('Open a file first.', 'warn'); return; }
  const server = await activeLspServer();
  if (!server) { toast('No running language server. Start one from the palette.', 'warn', 3000); return; }
  const model = S.editor.getModel();
  const params = currentLspParams(model);
  // Derive the current word as the default name.
  const pos = S.editor.getPosition();
  const wordAtPos = model.getWordAtPosition(pos);
  const defaultName = wordAtPos ? wordAtPos.word : '';
  const body = el('div');
  body.appendChild(el('p', null, 'Rename the symbol under the cursor. Changes will be applied across the project.'));
  const input = el('input', null, defaultName);
  input.placeholder = 'New name';
  input.style.cssText = 'width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 5px; background: var(--bg-2); color: var(--fg); margin-top: 8px;';
  body.appendChild(input);
  const result = await showModal({
    title: 'Rename Symbol',
    body,
    actions: [{ label: 'Cancel', value: null }, { label: 'Rename', value: 'ok', class: 'primary' }]
  });
  if (result !== 'ok') return;
  const newName = input.value.trim();
  if (!newName) { toast('Enter a new name.', 'warn'); return; }
  try {
    const res = await api.lsp.rename({ id: server.id, uri: params.uri, position: params.position, newName });
    if (!res || !res.ok) { toast((res && res.error) || 'Rename failed.', 'error', 4000); return; }
    const edits = res.result;
    if (!edits || !edits.changes) { toast('No edits returned by the language server.', 'info', 2500); return; }
    // Apply changes to open models.
    let count = 0;
    for (const [rawUri, changes] of Object.entries(edits.changes)) {
      const filePath = decodeURIComponent(rawUri.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1'));
      const openEntry = S.models.get(filePath);
      if (openEntry && openEntry.model) {
        // Sort edits descending by position to keep offsets stable.
        const sorted = changes.slice().sort((a, b) => {
          if (b.range.start.line !== a.range.start.line) return b.range.start.line - a.range.start.line;
          return b.range.start.character - a.range.start.character;
        });
        openEntry.model.pushStackElement();
        for (const edit of sorted) {
          const range = new monaco.Range(edit.range.start.line + 1, edit.range.start.character + 1, edit.range.end.line + 1, edit.range.end.character + 1);
          openEntry.model.pushEditOperations([], [{ range, text: edit.newText }], () => null);
          count++;
        }
        openEntry.model.pushStackElement();
      }
    }
    if (count) {
      toast('Renamed via language server (' + count + ' edit(s) applied).', 'success', 2500);
    } else {
      toast('Rename edits returned, but no matching open buffers (open the files first).', 'info', 4000);
    }
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------------- AI: inline completions + chat ---------------- */

let aiInlineWired = new Set();
let aiDebounceTimer = null;

function initAi() {
  // Load providers and key status.
  return api.ai.providers().then((res) => {
    if (res && Array.isArray(res.providers)) S.ai.providers = res.providers;
    return api.ai.keyStatus();
  }).then((res) => {
    if (res && typeof res === 'object') S.ai.keyStatus = res;
    S.ai.enabled = !!settings().ai.enabled;
    S.ai.model = settings().ai.model || '';
    S.ai.endpoint = settings().ai.endpoint || '';
  }).catch(() => {});
}

function hasAiKey(providerId) {
  // Providers that don't require a key (e.g. Ollama local) are always usable.
  const list = (S.ai.providers && S.ai.providers.length) ? S.ai.providers : (PB.aiProviders ? PB.aiProviders() : []);
  const prov = list.find((p) => p.id === providerId);
  if (prov && prov.needsKey === false) return true;
  return S.ai.keyStatus && !!S.ai.keyStatus[providerId];
}

function wireAiCompletion(lang) {
  if (!monaco || aiInlineWired.has(lang)) return;
  if (typeof monaco.languages.registerInlineCompletionsProvider !== 'function') return;
  aiInlineWired.add(lang);
  monaco.languages.registerInlineCompletionsProvider(lang, {
    provideInlineCompletions: async (model, position, context, token) => {
      if (!S.ai || !S.ai.enabled) return { items: [] };
      const provider = settings().ai.provider;
      if (!provider || !hasAiKey(provider)) return { items: [] };
      // Debounce: avoid hammering on every keystroke.
      if (aiDebounceTimer) clearTimeout(aiDebounceTimer);
      await new Promise((resolve) => { aiDebounceTimer = setTimeout(resolve, 300); });
      if (token.isCancellationRequested) return { items: [] };
      // Grab prefix/suffix.
      const totalLines = model.getLineCount();
      const endCol = model.getLineMaxColumn(totalLines);
      const prefix = model.getValueInRange({
        startLineNumber: 1, startColumn: 1,
        endLineNumber: position.lineNumber, endColumn: position.column
      });
      const suffix = model.getValueInRange({
        startLineNumber: position.lineNumber, startColumn: position.column,
        endLineNumber: totalLines, endColumn: endCol
      });
      const language = model.getLanguageId();
      try {
        const res = await api.ai.complete({
          provider: provider,
          language: language,
          prefix: prefix.slice(-8000),
          suffix: suffix.slice(0, 2000)
        });
        const text = (res && res.completion) || '';
        if (!text) return { items: [] };
        return {
          items: [{
            insertText: text,
            range: {
              startLineNumber: position.lineNumber,
              startColumn: position.column,
              endLineNumber: position.lineNumber,
              endColumn: position.column
            }
          }]
        };
      } catch (err) {
        // Silently ignore inline completion errors.
        return { items: [] };
      }
    },
    freeInlineCompletions: () => {}
  });
}

function wireAiLanguages() {
  if (!monaco) return;
  const langs = new Set();
  try { for (const k of Object.keys(PB.LANGUAGES || {})) langs.add(PB.LANGUAGES[k]); } catch { /* ignore */ }
  ['plaintext', 'javascript', 'typescript', 'python', 'json', 'html', 'css', 'markdown'].forEach((l) => langs.add(l));
  for (const lang of langs) wireAiCompletion(lang);
}

async function triggerAiCompletion() {
  const entry = currentEntry();
  if (!entry || !S.editor || !S.editor.getModel()) { toast('Open a file first.', 'warn'); return; }
  if (!S.ai.enabled) { toast('Enable AI in Settings first.', 'warn'); return; }
  const provider = settings().ai.provider;
  if (!provider || !hasAiKey(provider)) { toast('No API key set for ' + provider + '.', 'warn'); return; }
  sizeEdit();
  const lang = S.editor.getModel().getLanguageId();
  wireAiCompletion(lang);
  try {
    S.editor.focus();
    S.editor.trigger('ai', 'editor.action.inlineSuggest.trigger', {});
  } catch (err) { toast(err.message, 'error'); }
}

async function openAiChat() {
  const s = settings();
  if (!s.ai.enabled) { toast('Enable AI in Settings first.', 'warn'); return; }
  const provider = s.ai.provider;
  if (!provider || !hasAiKey(provider)) { toast('No API key set for ' + provider + '.', 'warn'); return; }
  const body = el('div', 'ai-chat-modal');
  const question = el('textarea', 'ai-chat-question');
  question.placeholder = 'Ask the AI to explain, refactor, or write code…';
  question.rows = 4;
  question.spellcheck = false;
  const contextCheck = el('div', 'inline');
  const includeCtx = el('input', null, '');
  includeCtx.type = 'checkbox';
  includeCtx.checked = true;
  includeCtx.id = 'aiIncludeContext';
  contextCheck.append(includeCtx, el('label', null, 'Include current file context'));
  const response = el('div', 'ai-chat-response');
  response.textContent = 'Ask a question to get started.';
  body.append(question, contextCheck, response);
  await showModal({
    title: 'AI Chat',
    body,
    actions: [{ label: 'Close', value: null }],
    onReady: ({ finish, body, footer }) => {
      const sendBtn = el('button', 'primary', 'Send');
      sendBtn.style.marginTop = '8px';
      footer.appendChild(sendBtn);
      const send = async () => {
        const q = question.value.trim();
        if (!q) return;
        sendBtn.disabled = true;
        sendBtn.textContent = 'Thinking…';
        response.textContent = '';
        let ctx = '';
        if (includeCtx.checked) {
          const entry = currentEntry();
          if (entry && entry.model) ctx = entry.model.getValue().slice(0, 12000);
        }
        try {
          const res = await api.ai.chat({ provider: provider, question: q, context: ctx });
          response.textContent = (res && res.text) || '';
        } catch (err) {
          response.textContent = 'Error: ' + err.message;
        } finally {
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send';
        }
      };
      sendBtn.onclick = send;
      question.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
      });
      question.focus();
    }
  });
}

async function openAiSettings() {
  const s = settings();
  const body = el('div', 'ai-settings-body');
  // Enable AI
  const aiEnabled = checkbox(s.ai.enabled);
  body.appendChild(settingsRow('Enable AI', 'Turn on AI-powered completions and chat.', aiEnabled));
  // Provider list
  const providers = S.ai.providers.length ? S.ai.providers : (PB.aiProviders ? PB.aiProviders() : []);
  const providerSelect = selectInput(providers.map((p) => [p.id, p.label]), s.ai.provider);
  body.appendChild(settingsRow('Provider', 'Choose the AI provider.', providerSelect));
  // Model
  const modelInput = textInput(s.ai.model || '', 'text');
  modelInput.placeholder = 'e.g. gpt-4o-mini, claude-3-5-sonnet-latest';
  body.appendChild(settingsRow('Model', 'Model name (leave blank for default).', modelInput));
  // Endpoint override
  const endpointInput = textInput(s.ai.endpoint || '', 'text');
  endpointInput.placeholder = 'Optional custom endpoint URL';
  body.appendChild(settingsRow('Endpoint', 'Override default endpoint (advanced).', endpointInput));
  body.appendChild(el('hr'));
  // Per-provider key inputs
  const keyRows = el('div', 'ai-key-rows');
  keyRows.appendChild(el('h4', null, 'API Keys'));
  keyRows.appendChild(el('p', 'desc', 'Keys are stored encrypted locally and never leave this machine.'));
  for (const prov of providers) {
    const row = el('div', 'ai-key-row');
    const label = el('label', null, prov.label + ' (' + prov.id + ')');
    const status = S.ai.keyStatus && S.ai.keyStatus[prov.id] ? el('span', 'ai-key-status', 'Set (' + S.ai.keyStatus[prov.id] + ')') : el('span', 'ai-key-status empty', 'Not set');
    const input = el('input', 'ai-key-input');
    input.type = 'password';
    input.placeholder = 'Enter API key…';
    input.value = '';
    const saveBtn = el('button', 'ai-key-btn', 'Save');
    const clearBtn = el('button', 'ai-key-btn danger', 'Clear');
    const testBtn = el('button', 'ai-key-btn', 'Test connection');
    saveBtn.onclick = async () => {
      const key = input.value.trim();
      if (!key) { toast('Enter a key first.', 'warn'); return; }
      saveBtn.disabled = true;
      try {
        const res = await api.ai.setKey({ provider: prov.id, key: key });
        if (res.ok) {
          status.textContent = 'Set (' + res.masked + ')';
          status.className = 'ai-key-status';
          input.value = '';
          // Refresh cached key status so the rest of the app sees the key immediately.
          try {
            const updated = await api.ai.keyStatus();
            if (updated && typeof updated === 'object') S.ai.keyStatus = updated;
          } catch { /* ignore */ }
          // Saving a key should make that provider active and enable AI, otherwise
          // requests keep going to the previous (keyless) provider and fail.
          s.ai.provider = prov.id;
          s.ai.enabled = true;
          S.ai.enabled = true;
          try { providerSelect.value = prov.id; } catch { /* ignore */ }
          try { aiEnabled.checked = true; } catch { /* ignore */ }
          persistSoon();
          toast('Key saved for ' + prov.label + ' — provider set to ' + prov.label, 'success', 2200);
        } else {
          toast(res.error || 'Failed to save key.', 'error');
        }
      } catch (err) { toast(err.message, 'error'); }
      finally { saveBtn.disabled = false; }
    };
    clearBtn.onclick = async () => {
      clearBtn.disabled = true;
      try {
        const res = await api.ai.setKey({ provider: prov.id, key: '' });
        if (res.ok) {
          status.textContent = 'Not set';
          status.className = 'ai-key-status empty';
          input.value = '';
          // Refresh cached key status so the rest of the app sees the key immediately.
          try {
            const updated = await api.ai.keyStatus();
            if (updated && typeof updated === 'object') S.ai.keyStatus = updated;
          } catch { /* ignore */ }
          toast('Key cleared for ' + prov.label, 'info', 1600);
        } else {
          toast(res.error || 'Failed to clear key.', 'error');
        }
      } catch (err) { toast(err.message, 'error'); }
      finally { clearBtn.disabled = false; }
    };
    testBtn.onclick = async () => {
      testBtn.disabled = true;
      const oldLabel = testBtn.textContent;
      testBtn.textContent = 'Testing…';
      try {
        const res = await api.ai.diagnose({ provider: prov.id });
        if (res && res.ok) {
          testBtn.textContent = '✓ Connected';
          testBtn.classList.add('ok');
          toast((res.message || 'Connected') + ' — provider is working.', 'success', 2500);
        } else {
          testBtn.textContent = '✗ Failed';
          testBtn.classList.add('bad');
          toast(res && res.error ? res.error : 'Connection failed.', 'error', 4500);
        }
        setTimeout(() => { testBtn.textContent = oldLabel; testBtn.classList.remove('ok', 'bad'); }, 3500);
      } catch (err) {
        testBtn.textContent = '✗ Failed';
        testBtn.classList.add('bad');
        toast(err.message, 'error', 4500);
        setTimeout(() => { testBtn.textContent = oldLabel; testBtn.classList.remove('ok', 'bad'); }, 3500);
      } finally {
        testBtn.disabled = false;
      }
    };
    row.append(label, input, saveBtn, clearBtn, testBtn, status);
    keyRows.appendChild(row);
  }
  body.appendChild(keyRows);
  await showModal({
    title: 'AI Settings',
    body,
    actions: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'save', class: 'primary' }]
  });
  // Apply AI settings to settings object
  s.ai.enabled = aiEnabled.checked;
  s.ai.provider = providerSelect.value;
  s.ai.model = modelInput.value.trim();
  s.ai.endpoint = endpointInput.value.trim();
  S.ai.enabled = aiEnabled.checked;   // ✅ Keep runtime cache in sync
  persistSoon();
  toast('AI settings saved', 'success', 1600);
}

/* ---------------- AI: file creation & scaffolding ---------------- */

let aiPendingConfirm = null;   // one-shot safety confirmation state

async function aiEnsureDir(baseDir, relPath) {
  // Create nested folders one segment at a time; tolerate "already exists".
  const normalized = String(relPath).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const parts = normalized.split('/').filter(Boolean);
  let current = baseDir;
  for (const seg of parts) {
    try { await api.ai.createFolder({ dir: current, name: seg }); } catch (err) { /* ignore if exists */ }
    current = current.replace(/[\\/]+$/, '') + '/' + seg;
  }
  return current;
}

async function aiConfirmCreate(files) {
  // Safety: confirm once per operation, listing every file to be written.
  const body = el('div');
  body.appendChild(el('p', null, 'The AI wants to create or write the following file(s):'));
  const list = el('div');
  for (const f of files) {
    const row = el('div');
    row.style.cssText = 'margin: 6px 0; padding: 6px; border: 1px solid var(--border); border-radius: 5px; font-size: 12px;';
    row.innerHTML = '<strong>' + PB.escapeHtml(f.path || f.name) + '</strong> ' +
      (f.size !== undefined ? '(' + f.size + ' bytes)' : '') +
      '<div style="margin-top:4px; white-space: pre-wrap; font-family: monospace; font-size: 11px; color: var(--muted); overflow: auto; max-height: 120px;">' +
      PB.escapeHtml((f.preview || f.content || '').slice(0, 2000)) + '</div>';
    list.appendChild(row);
  }
  body.appendChild(list);
  body.appendChild(el('p', 'modal-note', 'Confirm once to create all files listed above. No further prompts for this operation.'));
  const result = await showModal({
    title: 'AI: Confirm File Creation',
    body,
    actions: [
      { label: 'Cancel', value: null },
      { label: 'Create Files', value: 'ok', class: 'primary' }
    ]
  });
  return result === 'ok';
}

async function openAiFileCreator() {
  const s = settings();
  if (!s.ai.enabled) { toast('Enable AI in Settings first.', 'warn'); return; }
  const provider = s.ai.provider;
  if (!provider || !hasAiKey(provider)) { toast('No API key set for ' + provider + '.', 'warn'); return; }
  if (!S.root) { toast('Open a folder/workspace first.', 'warn'); return; }

  const body = el('div');
  body.style.cssText = 'display: flex; flex-direction: column; gap: 8px; width: 560px;';

  body.appendChild(el('label', null, 'Target folder'));
  const dirInput = el('input', null, S.root);
  dirInput.readOnly = true;
  body.appendChild(dirInput);

  body.appendChild(el('label', null, 'File name (relative to target folder)'));
  const nameInput = el('input', null, '');
  nameInput.placeholder = 'e.g. src/utils.js';
  body.appendChild(nameInput);

  body.appendChild(el('label', null, 'What should the AI create?'));
  const prompt = el('textarea', null, '');
  prompt.placeholder = 'Describe the file you want the AI to generate…';
  prompt.rows = 6;
  prompt.spellcheck = false;
  body.appendChild(prompt);

  const result = await showModal({
    title: 'AI: Create File',
    body,
    actions: [{ label: 'Cancel', value: null }, { label: 'Generate', value: 'go', class: 'primary' }]
  });
  if (result !== 'go') return;

  const nm = nameInput.value.trim();
  if (!nm) { toast('Enter a file name.', 'warn'); return; }
  const desc = prompt.value.trim();
  if (!desc) { toast('Enter a description.', 'warn'); return; }

  const rel = nm.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  let content = '';
  try {
    toast('Generating file with AI…', 'info', 1200);
    const res = await api.ai.codegen({ provider: provider, filePath: rel, description: desc });
    content = (res && res.text) || '';
    if (!content) { toast('AI returned no content.', 'warn'); return; }
  } catch (err) { toast(err.message, 'error'); return; }

  const plan = [{ name: rel, path: rel, content, preview: content }];
  if (!(await aiConfirmCreate(plan))) { toast('AI action cancelled.', 'info', 1200); return; }
  try {
    const slash = rel.lastIndexOf('/');
    const relDir = slash >= 0 ? rel.slice(0, slash) : '';
    const fileName = slash >= 0 ? rel.slice(slash + 1) : rel;
    const targetDir = relDir ? await aiEnsureDir(S.root, relDir) : S.root;
    await api.ai.createFile({ dir: targetDir, name: fileName, content });
    toast('File created: ' + rel, 'success', 1600);
    await refreshExplorer();
  } catch (err) { toast(err.message, 'error'); }
}

async function openAiProjectScaffold() {
  const s = settings();
  if (!s.ai.enabled) { toast('Enable AI in Settings first.', 'warn'); return; }
  const provider = s.ai.provider;
  if (!provider || !hasAiKey(provider)) { toast('No API key set for ' + provider + '.', 'warn'); return; }
  if (!S.root) { toast('Open a folder/workspace first.', 'warn'); return; }

  const body = el('div');
  body.style.cssText = 'display: flex; flex-direction: column; gap: 8px; width: 600px;';

  const promptLabel = el('label', null, 'Describe the project to scaffold');
  const prompt = el('textarea', null, '');
  prompt.placeholder = 'e.g. A Node.js Express API with routes, controllers, models, and tests';
  prompt.rows = 6;
  prompt.spellcheck = false;
  body.appendChild(promptLabel, prompt);

  const result = await showModal({
    title: 'AI: Scaffold Project',
    body,
    actions: [{ label: 'Cancel', value: null }, { label: 'Generate Plan', value: 'go', class: 'primary' }]
  });
  if (result !== 'go') return;

  const desc = prompt.value.trim();
  if (!desc) { toast('Enter a description.', 'warn'); return; }

  let files = [];
  try {
    toast('Planning project structure…', 'info', 1200);
    const res = await api.ai.scaffold({ provider: provider, description: desc });
    let parsed = [];
    try { parsed = JSON.parse((res && res.text) || '[]'); } catch { /* fall through */ }
    if (!Array.isArray(parsed) || parsed.length === 0) { toast('Could not parse the AI file plan.', 'warn'); return; }
    files = parsed;
  } catch (err) { toast(err.message, 'error'); return; }

  const plan = files.map((f) => ({ name: String(f.path || ''), path: String(f.path || ''), content: String(f.content || ''), preview: String(f.content || '') }));
  if (!(await aiConfirmCreate(plan))) { toast('AI action cancelled.', 'info', 1200); return; }

  try {
    for (const f of plan) {
      const normalized = f.name.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const slash = normalized.lastIndexOf('/');
      const relDir = slash >= 0 ? normalized.slice(0, slash) : '';
      const fileName = slash >= 0 ? normalized.slice(slash + 1) : normalized;
      const targetDir = relDir ? await aiEnsureDir(S.root, relDir) : S.root;
      await api.ai.createFile({ dir: targetDir, name: fileName, content: f.content });
    }
    toast('Project scaffolded: ' + plan.length + ' file(s) created.', 'success', 2200);
    await refreshExplorer();
  } catch (err) { toast(err.message, 'error'); }
}

async function applyAiToCurrentFile() {
  const entry = currentEntry();
  if (!entry || !S.editor || !S.editor.getModel()) { toast('Open a file first.', 'warn'); return; }
  const s = settings();
  if (!s.ai.enabled) { toast('Enable AI in Settings first.', 'warn'); return; }
  const provider = s.ai.provider;
  if (!provider || !hasAiKey(provider)) { toast('No API key set for ' + provider + '.', 'warn'); return; }

  const body = el('div');
  body.style.cssText = 'display: flex; flex-direction: column; gap: 8px; width: 560px;';

  const promptLabel = el('label', null, 'How should the AI modify this file?');
  const prompt = el('textarea', null, '');
  prompt.placeholder = 'e.g. Add error handling, refactor this function, add comments…';
  prompt.rows = 5;
  prompt.spellcheck = false;
  body.appendChild(promptLabel, prompt);

  const preview = el('div', null, '');
  preview.style.cssText = 'margin-top: 6px; padding: 8px; border: 1px solid var(--border); border-radius: 5px; background: var(--bg-2); font-family: monospace; font-size: 11px; color: var(--muted); max-height: 200px; overflow: auto; white-space: pre-wrap;';
  preview.textContent = 'Modified content appears after generation.';
  body.appendChild(preview);

  const result = await showModal({
    title: 'AI: Apply to Current File',
    body,
    actions: [{ label: 'Cancel', value: null }, { label: 'Generate', value: 'go', class: 'primary' }]
  });
  if (result !== 'go') return;

  const p = prompt.value.trim();
  if (!p) { toast('Enter instructions.', 'warn'); return; }

  const cur = S.editor.getModel().getValue();
  let content = '';
  try {
    toast('Generating file update…', 'info', 1200);
    const res = await api.ai.edit({ provider: provider, filePath: entry.name || 'current', instructions: p, content: cur });
    content = (res && res.text) || '';
    if (!content) { toast('AI returned no content.', 'warn'); return; }
  } catch (err) { toast(err.message, 'error'); return; }

  const plan = [{ path: entry.path || entry.name, name: entry.name || 'current', content, preview: content }];
  if (!(await aiConfirmCreate(plan))) { toast('AI action cancelled.', 'info', 1200); return; }

  try {
    await api.file.write(plan[0].path, plan[0].content);
    toast('File updated successfully.', 'success', 1800);
    await refreshExplorer();
    // Reload the current buffer so the editor shows the new content.
    try {
      if (S.editor && S.editor.getModel()) {
        S.editor.getModel().setValue(content);
      }
    } catch { /* ignore */ }
  } catch (err) { toast(err.message, 'error'); }
}

/**
 * Explicitly fetches from origin and refreshes the Git view.
 */
async function gitFullFetch() {
  if (!S.root) { toast('Open a folder first.', 'warn'); return; }
  try {
    const res = await api.git.fetch(S.root);
    if (res.ok) {
      showOutput('$ git fetch origin\n' + (res.text || 'Done.') + '\n');
      toast('Git fetch completed.', 'success', 2000);
    } else {
      toast(res.text || 'Fetch failed.', 'error', 4500);
    }
    await refreshGit();
  } catch (err) { toast(err.message, 'error'); }
}

/**
 * Updates the encoding and EOL indicators in the status bar.
 */
async function updateEncodingStatus() {
  const entry = currentEntry();
  if (!entry || entry.virtual) {
    $('encodingStatus').textContent = '—';
    return;
  }
  try {
    const [enc, eol] = await Promise.all([
      api.file.encoding(entry.path),
      api.file.eol(entry.path)
    ]);
    $('encodingStatus').textContent = (enc.encoding || 'utf-8').toUpperCase() + (enc.bomDetected ? ' (BOM)' : '');
    if (eol && eol.lineEnding) $('eolStatus').textContent = eol.lineEnding;
  } catch { /* ignore */ }
}

/* ---------------- run ---------------- */

function bindRun() {
  $('runBtn').onclick = runCurrent;
  $('stopBtn').onclick = stopRun;
  $('runInputRow').addEventListener('submit', (event) => {
    event.preventDefault();
    sendRunInput();
  });
}

function updateRunInput() {
  const row = $('runInputRow');
  if (!row) return;
  row.classList.toggle('hidden', !S.running || S.panel !== 'outputPane');
}

function focusRunInput() {
  setTimeout(() => { if (S.running && S.panel === 'outputPane') $('runInput').focus(); }, 30);
}

async function sendRunInput() {
  if (!S.running) { updateRunInput(); return; }
  const input = $('runInput');
  const text = input.value;
  try {
    const ok = await api.run.input(text + '\n');
    if (!ok) { toast('The program is not accepting input.', 'warn', 3000); return; }
  } catch (err) {
    toast('Could not send input: ' + err.message, 'error', 5000);
    return;
  }
  appendOutput(text + '\n');
  input.value = '';
  input.focus();
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
    updateRunInput();
    focusRunInput();
    $('runBtn').disabled = true;
    $('stopBtn').disabled = false;
    const rs = $('runStatus');
    rs.classList.remove('hidden');
    rs.classList.add('running');
    rs.textContent = 'Running ' + spec.name;
    $('status').textContent = 'Running ' + spec.name + '…';
  } catch (err) {
    S.running = false;
    updateRunInput();
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
  $('runInput').value = '';
  updateRunInput();
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

/* ---------------- problems ---------------- */

function renderProblems(diagnostics) {
  const list = $('problemsList');
  list.replaceChildren();
  if (!diagnostics.length) {
    list.appendChild(el('div', 'problems-empty', 'No problems found.'));
    return;
  }
  for (const d of diagnostics) {
    const row = el('button', 'problem-item ' + (d.severity === 'warning' ? 'warning' : 'error'));
    row.appendChild(icon(d.severity === 'warning' ? 'warning' : 'warning'));
    const body = el('div', 'problem-body');
    body.appendChild(el('div', 'problem-title', d.message));
    body.appendChild(el('div', 'problem-loc', PB.basename(d.file) + ':' + d.line + ':' + d.column));
    row.appendChild(body);
    row.onclick = () => { if (d.file) openFile(d.file, d.line, d.column); };
    list.appendChild(row);
  }
}

async function runProblemsCheck() {
  const entry = currentEntry();
  if (!entry || entry.virtual) { toast('Open a file to check.', 'info', 1800); return; }
  const res = await api.problems.check({
    file: entry.path, lang: PB.normalizeLanguage(entry.path),
    cwd: S.root, runtimes: settings().runtimes
  });
  if (!res.ok) { toast('Problems check failed: ' + (res.error || 'unknown'), 'error', 6000); return; }
  S.problems = res.diagnostics || [];
  renderProblems(S.problems);
  showPanel('problemsPane');
}

async function clearProblems() {
  S.problems = [];
  renderProblems([]);
  showPanel('outputPane');
}

function onRunExit(payload) {
  if (S.runId === null) { S.runPendingExit = payload; return; }
  if (payload.id !== S.runId) return;
  S.running = false;
  S.runId = null;
  $('runBtn').disabled = false;
  $('stopBtn').disabled = true;
  $('runInput').value = '';
  updateRunInput();
  const ok = payload.code === 0;
  $('runStatus').classList.remove('running');
  $('runStatus').textContent = ok ? 'Finished' : 'Exit ' + payload.code;
  $('status').textContent = 'Process exited with code ' + payload.code + ' (' + PB.formatDuration(payload.duration) + ')';
  appendOutput('\n[process exited with code ' + payload.code + ' · ' + PB.formatDuration(payload.duration) + ']\n');
  if (!ok) toast('Process exited with code ' + payload.code, 'warn', 4500);
}

function appendOutput(text) {
  const out = $('output');
  out.textContent = PB.applyCarriageReturns(out.textContent, text);
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
  setHidden($('problemsPane'), S.panel !== 'problemsPane');
  setHidden($('debugPane'), S.panel !== 'debugPane');
  updateRunInput();
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
    { id: 'file.open', label: 'File: Open File…', key: 'Ctrl+Alt+O', run: () => openFilesFlow() },
    { id: 'workspace.open', label: 'File: Open Folder…', key: 'Ctrl+O', run: () => openWorkspaceDialog() },
    { id: 'file.save', label: 'File: Save', key: 'Ctrl+S', run: () => saveFile() },
    { id: 'file.saveAll', label: 'File: Save All', key: 'Ctrl+Alt+S', run: () => saveAll() },
    { id: 'file.close', label: 'File: Close Editor', key: 'Ctrl+W', run: () => closeEntry(currentEntry()) },
    { id: 'file.closeAll', label: 'File: Close All Editors', run: () => closeAll() },
    { id: 'file.compare', label: 'File: Compare Files…', run: () => compareFilesFlow() },
    { id: 'file.insertSnippet', label: 'Editor: Insert Snippet…', run: () => insertSnippetFlow() },
    { id: 'view.explorer', label: 'View: Explorer', key: 'Ctrl+Shift+E', run: () => showView('explorer') },
    { id: 'view.search', label: 'View: Search', key: 'Ctrl+Shift+F', run: () => showView('search') },
    { id: 'view.replace', label: 'Search: Replace in Files…', key: 'Ctrl+Shift+H', run: () => openWorkspaceReplace() },
    { id: 'view.git', label: 'View: Source Control', key: 'Ctrl+Shift+G', run: () => showView('git') },
    { id: 'view.sidebar', label: 'View: Toggle Sidebar', key: 'Ctrl+B', run: () => toggleSidebar() },
    { id: 'view.panel', label: 'View: Toggle Panel', key: 'Ctrl+J', run: () => togglePanel() },
    { id: 'view.terminal', label: 'View: Toggle Terminal', key: 'Ctrl+`', run: () => terminalToggle() },
    { id: 'view.output', label: 'View: Show Output', run: () => showPanel('outputPane') },
    { id: 'view.theme', label: 'View: Toggle Theme', run: () => toggleTheme() },
    { id: 'view.wordWrap', label: 'View: Toggle Word Wrap', run: () => toggleWordWrap() },
    { id: 'view.stickyScroll', label: 'View: Toggle Sticky Scroll', key: 'Ctrl+Shift+S', run: () => toggleStickyScroll() },
    { id: 'view.outline', label: 'View: Show Outline', key: 'Ctrl+Shift+U', run: () => showView('outline') },
    { id: 'view.split', label: 'View: Toggle Split Editor', key: 'Ctrl+\\', run: () => toggleSplit() },
    { id: 'view.symbols', label: 'View: Go to Symbol…', key: 'Ctrl+Shift+O', run: () => openPalette('symbols') },
    { id: 'workbench.navBack', label: 'Go Back', key: 'Alt+←', run: () => navBack() },
    { id: 'workbench.navForward', label: 'Go Forward', key: 'Alt+→', run: () => navForward() },
    { id: 'workbench.nextEditor', label: 'View: Open Next Editor', key: 'Ctrl+Tab', run: () => cycleTabs(1) },
    { id: 'workbench.prevEditor', label: 'View: Open Previous Editor', key: 'Ctrl+Shift+Tab', run: () => cycleTabs(-1) },
    { id: 'workbench.reopenClosed', label: 'File: Reopen Closed Editor', key: 'Ctrl+Shift+T', run: () => reopenClosedEditor() },
    { id: 'view.zoomIn', label: 'View: Increase Editor Font Size', key: 'Ctrl+=', run: () => zoomEditor(1) },
    { id: 'view.zoomOut', label: 'View: Decrease Editor Font Size', key: 'Ctrl+-', run: () => zoomEditor(-1) },
    { id: 'view.zoomReset', label: 'View: Reset Editor Font Size', key: 'Ctrl+0', run: () => zoomEditor(0) },
    { id: 'transform.json', label: 'Transform: Format JSON', run: () => applyTextTransform('format-json') },
    { id: 'transform.sort', label: 'Transform: Sort Lines Ascending', run: () => applyTextTransform('sort-lines') },
    { id: 'transform.dedupe', label: 'Transform: Remove Duplicate Lines', run: () => applyTextTransform('dedupe-lines') },
    { id: 'transform.trim', label: 'Transform: Trim Trailing Whitespace', run: () => applyTextTransform('trim-trailing-whitespace') },
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
    { id: 'git.deleteBranch', label: 'Git: Delete Branch…', run: () => deleteBranchFlow() },
    { id: 'git.amend', label: 'Git: Amend Last Commit…', run: () => amendCommitFlow() },
    { id: 'run.start', label: 'Run: Run Current File', key: 'F5', run: () => runCurrent() },
    { id: 'run.stop', label: 'Run: Stop', key: 'Shift+F5', run: () => stopRun() },
    { id: 'debug.start', label: 'Debug: Start Debugging…', run: () => startDebugFlow() },
    { id: 'debug.stop', label: 'Debug: Stop Session', key: 'Shift+F5', run: () => stopDebugSession() },
    { id: 'debug.toggleBreakpoint', label: 'Debug: Toggle Breakpoint at Cursor', key: 'F9', run: () => debugToggleBreakpointAtCursor() },
    { id: 'debug.continue', label: 'Debug: Continue', key: 'F5', run: () => debugContinue() },
    { id: 'debug.stepOver', label: 'Debug: Step Over', key: 'F10', run: () => debugStepOver() },
    { id: 'debug.stepIn', label: 'Debug: Step In', key: 'F11', run: () => debugStepIn() },
    { id: 'debug.stepOut', label: 'Debug: Step Out', key: 'Shift+F11', run: () => debugStepOut() },
    { id: 'terminal.new', label: 'Terminal: New Terminal', run: () => createTerminal() },
    { id: 'run.clearOutput', label: 'Output: Clear', run: () => { $('output').textContent = ''; showPanel('outputPane'); } },
    { id: 'editor.find', label: 'Editor: Find', key: 'Ctrl+F', run: () => editorAction('actions.find') },
    { id: 'editor.replace', label: 'Editor: Replace', key: 'Ctrl+H', run: () => editorAction('editor.action.startFindReplaceAction') },
    { id: 'editor.gotoLine', label: 'Editor: Go to Line…', key: 'Ctrl+G', run: () => editorAction('editor.action.gotoLine') },
    { id: 'editor.format', label: 'Editor: Format Document', key: 'Shift+Alt+F', run: () => editorAction('editor.action.formatDocument') },
    { id: 'editor.goToDefinition', label: 'Editor: Go to Definition', key: 'F12', run: () => goToDefinition() },
    { id: 'editor.findReferences', label: 'Editor: Find All References', key: 'Shift+F12', run: () => findLspReferences() },
    { id: 'editor.renameSymbol', label: 'Editor: Rename Symbol', key: 'F2', run: () => renameSymbolLsp() },
    { id: 'editor.foldAll', label: 'Editor: Fold All', run: () => editorAction('editor.action.foldAll') },
    { id: 'editor.unfoldAll', label: 'Editor: Unfold All', run: () => editorAction('editor.action.unfoldAll') },
    { id: 'editor.toggleFolds', label: 'Editor: Toggle All Folds', run: () => editorAction('editor.action.toggleAllFolding') },
    { id: 'editor.multiCursorNext', label: 'Editor: Add Cursor at Next Match', key: 'Ctrl+D', run: () => editorAction('editor.action.addSelectionToNextFindMatch') },
    { id: 'editor.multiCursorAll', label: 'Editor: Select All Occurrences', key: 'Ctrl+Shift+L', run: () => editorAction('editor.action.selectHighlights') },
    { id: 'editor.cursorAbove', label: 'Editor: Add Cursor Above', key: 'Ctrl+Alt+↑', run: () => editorAction('editor.action.insertCursorAbove') },
    { id: 'editor.cursorBelow', label: 'Editor: Add Cursor Below', key: 'Ctrl+Alt+↓', run: () => editorAction('editor.action.insertCursorBelow') },
    { id: 'editor.deleteLine', label: 'Editor: Delete Line', key: 'Ctrl+Shift+K', run: () => editorAction('editor.action.deleteLines') },
    { id: 'editor.toggleComment', label: 'Editor: Toggle Line Comment', key: 'Ctrl+/', run: () => editorAction('editor.action.toggleComment') },
    { id: 'editor.blockComment', label: 'Editor: Toggle Block Comment', key: 'Shift+Alt+A', run: () => editorAction('editor.action.blockComment') },
    { id: 'editor.formatSelection', label: 'Editor: Format Selection', key: 'Ctrl+Alt+F', run: () => editorAction('editor.action.formatSelection') },
    { id: 'editor.indentLines', label: 'Editor: Indent Selection', run: () => editorAction('editor.action.indentLines') },
    { id: 'editor.outdentLines', label: 'Editor: Outdent Selection', run: () => editorAction('editor.action.outdentLines') },
    { id: 'editor.joinLines', label: 'Editor: Join Lines', run: () => editorAction('editor.action.joinLines') },
    { id: 'editor.copyLineDown', label: 'Editor: Duplicate Line Down', key: 'Shift+Alt+↓', run: () => editorAction('editor.action.copyLinesDownAction') },
    { id: 'editor.copyLineUp', label: 'Editor: Duplicate Line Up', key: 'Shift+Alt+↑', run: () => editorAction('editor.action.copyLinesUpAction') },
    { id: 'editor.moveLineDown', label: 'Editor: Move Line Down', key: 'Alt+↓', run: () => editorAction('editor.action.moveLinesDownAction') },
    { id: 'editor.moveLineUp', label: 'Editor: Move Line Up', key: 'Alt+↑', run: () => editorAction('editor.action.moveLinesUpAction') },
    { id: 'editor.jumpToBracket', label: 'Editor: Jump to Matching Bracket', key: 'Ctrl+Shift+\\', run: () => editorAction('editor.action.jumpToBracket') },
    { id: 'editor.insertLineBefore', label: 'Editor: Insert Line Above', key: 'Ctrl+Shift+Enter', run: () => editorAction('editor.action.insertLineBefore') },
    { id: 'editor.insertLineAfter', label: 'Editor: Insert Line Below', key: 'Ctrl+Enter', run: () => editorAction('editor.action.insertLineAfter') },
    { id: 'editor.formatOnSave', label: 'Editor: Toggle Format On Save', run: () => toggleFormatOnSave() },
    { id: 'problems.check', label: 'Problems: Check Current File', run: () => runProblemsCheck() },
    { id: 'problems.show', label: 'View: Show Problems', run: () => runProblemsCheck() },
    { id: 'lsp.list', label: 'Language Servers: List', run: () => showLspServers() },
    { id: 'lsp.start', label: 'Language Servers: Start…', run: () => openLspStart() },
    { id: 'lsp.wire', label: 'Language Servers: Wire to Current Editor', run: () => wireLspToEditor() },
    { id: 'ai.settings', label: 'AI: Open AI Settings', run: () => openAiSettings() },
    { id: 'ai.chat', label: 'AI: Chat', run: () => openAiChat() },
    { id: 'ai.complete', label: 'AI: Trigger Inline Completion', run: async () => { await triggerAiCompletion(); } },
    { id: 'ai.codegen', label: 'AI: Create File', run: async () => { await openAiFileCreator(); } },
    { id: 'ai.scaffold', label: 'AI: Scaffold Project', run: async () => { await openAiProjectScaffold(); } },
    { id: 'ai.edit', label: 'AI: Edit Current File', run: async () => { await applyAiToCurrentFile(); } }
  ];
}

function toggleFormatOnSave() {
  const s = settings();
  s.formatOnSave = !s.formatOnSave;
  persistSoon();
  toast('Format on save ' + (s.formatOnSave ? 'enabled' : 'disabled'), 'info', 1600);
}

function toggleWordWrap() {
  const s = settings();
  s.wordWrap = !s.wordWrap;
  applyEditorOptions();
  persistSoon();
  toast('Word wrap ' + (s.wordWrap ? 'enabled' : 'disabled'), 'info', 1600);
}

function toggleStickyScroll() {
  const s = settings();
  s.stickyScroll = !s.stickyScroll;
  applyEditorOptions();
  persistSoon();
  toast('Sticky scroll ' + (s.stickyScroll ? 'enabled' : 'disabled'), 'info', 1600);
}

function editorOptions() {
  return {
    theme: resolvedTheme() === 'dark' ? 'peabox-dark' : 'peabox-light',
    automaticLayout: true,
    fontSize: settings().fontSize,
    fontFamily: settings().fontFamily,
    tabSize: settings().tabSize,
    wordWrap: settings().wordWrap ? 'on' : 'off',
    minimap: { enabled: settings().minimap },
    glyphMargin: true,
    smoothScrolling: true,
    stickyScroll: settings().stickyScroll,
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
  };
}

function toggleSplit() {
  const area = $('editorArea');
  const host2 = $('editor2');
  if (S.editor2) {
    try { S.editor2.dispose(); } catch { /* ignore */ }
    S.editor2 = null;
    S.current2 = null;
    setHidden(host2, true);
    area.classList.remove('split');
    if (S.editor && S.editor.layout) S.editor.layout();
    toast('Split editor closed', 'info', 1400);
    return;
  }
  const entry = currentEntry();
  if (!entry || entry.virtual) { toast('Open a regular file first.', 'info', 1800); return; }
  setHidden(host2, false);
  area.classList.add('split');
  S.editor2 = monaco.editor.create($('editor2'), Object.assign(editorOptions(), { model: entry.model }));
  S.current2 = entry.key;
  if (S.editor && S.editor.layout) S.editor.layout();
  toast('Split editor opened', 'info', 1400);
}

function syncSplitModel() {
  if (!S.editor2) return;
  const entry = currentEntry();
  if (!entry) { S.current2 = null; return; }
  S.current2 = entry.key;
  try { S.editor2.setModel(entry.model); } catch (err) { /* model may be disposed */ }
}

/* ---------------- compare files (diff view) ---------------- */

async function compareFilesFlow() {
  try {
    const originals = await api.file.openDialog();
    if (!originals || !originals.length) return;
    const modified = await api.file.openDialog();
    if (!modified || !modified.length) return;
    await openCompare(originals[0], modified[0]);
  } catch (err) { toast(err.message, 'error'); }
}

async function openCompare(originalPath, modifiedPath) {
  let a, b;
  try { a = await api.file.read(originalPath); }
  catch (err) { toast('Could not read ' + nameOf(originalPath) + ': ' + err.message, 'error', 5000); return; }
  try { b = await api.file.read(modifiedPath); }
  catch (err) { toast('Could not read ' + nameOf(modifiedPath) + ': ' + err.message, 'error', 5000); return; }
  exitCompare();
  const originalModel = monaco.editor.createModel(a.content, PB.normalizeLanguage(originalPath), monaco.Uri.parse('peabox-compare://' + encodeURIComponent(originalPath)));
  const modifiedModel = monaco.editor.createModel(b.content, PB.normalizeLanguage(modifiedPath), monaco.Uri.parse('peabox-compare://' + encodeURIComponent(modifiedPath)));
  S.compare = { originalModel, modifiedModel, originalPath, modifiedPath };
  setHidden($('editor'), true);
  setHidden($('editor2'), true);
  setHidden($('breadcrumb'), true);
  setHidden($('diffEditor'), false);
  S.diffEditor = monaco.editor.createDiffEditor($('diffEditor'), Object.assign(editorOptions(), {
    readOnly: true,
    renderSideBySide: true,
    originalEditable: false,
    enableSplitViewResizing: true,
    ignoreTrimWhitespace: false
  }));
  S.diffEditor.setModel({ original: originalModel, modified: modifiedModel });
  toast('Comparing ' + nameOf(originalPath) + ' ↔ ' + nameOf(modifiedPath) + ' · Esc to exit', 'info', 4200);
}

function exitCompare() {
  if (!S.compare) return;
  const compare = S.compare;
  S.compare = null;
  try { if (S.diffEditor) S.diffEditor.dispose(); } catch { /* ignore */ }
  S.diffEditor = null;
  try { compare.originalModel.dispose(); } catch { /* ignore */ }
  try { compare.modifiedModel.dispose(); } catch { /* ignore */ }
  setHidden($('diffEditor'), true);
  setHidden($('editor'), false);
  setHidden($('breadcrumb'), !currentEntry());
  const entry = currentEntry();
  if (entry) {
    S.editor.setModel(entry.model);
    S.editor.focus();
  }
}

function applyTextTransform(id) {
  const entry = currentEntry();
  if (!entry) { toast('Open a file to transform.', 'warn'); return; }
  if (entry.virtual) { toast('Diff views cannot be transformed.', 'warn'); return; }
  const before = entry.model.getValue();
  const result = PB.transformText(before, id, { indent: settings().tabSize });
  if (!result.ok) { toast('Transform failed: ' + result.error, 'error', 6000); return; }
  if (!result.changed) { toast('No changes needed.', 'info', 1600); return; }
  const range = entry.model.getFullModelRange();
  entry.model.pushStackElement();
  entry.model.pushEditOperations([], [{ range, text: result.text, forceMoveMarkers: true }], () => null);
  entry.model.pushStackElement();
  toast('Transformed ' + nameOf(entry.path), 'success', 1800);
}

/* ---------------- snippets ---------------- */

async function insertSnippetFlow() {
  const entry = currentEntry();
  if (!entry || !S.editor) { toast('Open a file to insert a snippet.', 'warn'); return; }
  if (entry.virtual) { toast('This editor is read-only.', 'warn'); return; }
  const langId = entry.model.getLanguageId();
  let snippets = PB.snippetsFor(langId);
  if (!snippets.length && entry.path) snippets = PB.snippetsFor(PB.extname(entry.path));
  if (!snippets.length) { toast('No snippets available for ' + languageLabel(entry) + '.', 'info', 2500); return; }

  const body = el('div');
  const filter = el('input', 'modal-input');
  filter.type = 'text';
  filter.placeholder = 'Filter snippets…';
  filter.spellcheck = false;
  body.appendChild(filter);
  const list = el('div', 'modal-list snippet-list');
  body.appendChild(list);

  const picked = await showModal({
    title: 'Insert Snippet',
    body,
    actions: [{ label: 'Cancel', value: null }],
    onReady: ({ finish }) => {
      const renderItems = (query) => {
        list.replaceChildren();
        const q = (query || '').toLowerCase();
        const matches = snippets.filter((s) => !q || s.name.toLowerCase().includes(q));
        if (!matches.length) { list.appendChild(el('div', 'modal-note', 'No matching snippets.')); return; }
        matches.forEach((snippet) => {
          const item = el('div', 'modal-item');
          item.appendChild(el('div', 'mi-title', snippet.name));
          item.appendChild(el('div', 'mi-sub', snippet.body.split('\n')[0].slice(0, 90)));
          item.tabIndex = 0;
          item.setAttribute('role', 'option');
          item.onclick = () => finish(snippet);
          item.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(snippet); } };
          list.appendChild(item);
        });
      };
      filter.addEventListener('input', () => renderItems(filter.value));
      filter.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const first = list.querySelector('.modal-item');
          if (first) first.click();
        }
      });
      renderItems('');
      setTimeout(() => filter.focus(), 30);
    }
  });
  if (picked) insertSnippet(picked);
}

function insertSnippet(snippet) {
  const entry = currentEntry();
  if (!entry || !S.editor) return;
  const before = entry.model.getValue();
  try {
    S.editor.focus();
    S.editor.trigger('peabox', 'editor.action.insertSnippet', { snippet: snippet.body });
  } catch { /* fall through to plain insert */ }
  if (entry.model.getValue() === before) {
    // Fallback: strip tabstops/placeholders and insert as plain text.
    const plain = snippet.body
      .replace(/\$\{\d+:([^}]*)\}/g, '$1')
      .replace(/\$\d+/g, '');
    const pos = S.editor.getPosition();
    S.editor.executeEdits('peabox-snippets', [{ range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: plain, forceMoveMarkers: true }]);
  }
  persistSoon();
}

function editorAction(id, args) {
  if (!S.editor) return;
  S.editor.focus();
  const action = S.editor.getAction(id);
  if (action) { action.run(); return; }
  try { S.editor.trigger('peabox', id, args || {}); } catch { /* command id not registered */ }
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

function debugToggleBreakpointAtCursor() {
  const entry = currentEntry();
  if (!entry || !S.editor) { toast('Open a file first.', 'warn'); return; }
  const pos = S.editor.getPosition();
  if (!pos) return;
  const added = toggleBreakpoint(entry.path, pos.lineNumber);
  toast((added ? 'Breakpoint set at' : 'Breakpoint removed from') + ' line ' + pos.lineNumber + '.', 'info', 1600);
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

const PALETTE_PLACEHOLDERS = {
  files: 'Search files by name…',
  commands: 'Type a command…',
  symbols: 'Jump to a symbol…'
};

function paletteModeFromInput(value) {
  const clean = String(value).replace(/^\s+/, '');
  if (clean.charAt(0) === '>') return 'commands';
  if (clean.charAt(0) === '@') return 'symbols';
  return 'files';
}

function paletteQuery(value, mode) {
  const source = String(value);
  if (mode === 'commands') return source.replace(/^\s*>\s*/, '').trim();
  if (mode === 'symbols') return source.replace(/^\s*@\s*/, '').trim();
  return source.trim();
}

async function openPalette(mode) {
  const input = $('command-palette-input');
  const target = mode === 'commands' ? 'commands' : mode === 'symbols' ? 'symbols' : 'files';
  S.palette.open = true;
  S.palette.index = 0;
  S.palette.mode = target;
  input.value = target === 'commands' ? '>' : target === 'symbols' ? '@' : '';
  input.placeholder = PALETTE_PLACEHOLDERS[target];
  $('command-palette-overlay').classList.remove('hidden');
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
  $('command-palette-overlay').classList.add('hidden');
  S.palette.items = [];
  S.palette.index = 0;
}

function jumpToSymbol(symbol) {
  const entry = currentEntry();
  if (!entry || !S.editor) return;
  const line = PB.clamp(symbol.line || 1, 1, Math.max(1, entry.model.getLineCount()));
  const column = PB.clamp(symbol.column || 1, 1, 100000);
  entry.cursorLine = line;
  entry.cursorColumn = column;
  const pos = { lineNumber: line, column: column };
  S.editor.setPosition(pos);
  S.editor.revealPositionInCenter(pos);
  S.editor.focus();
  updatePositionStatus();
  sessionSoon();
}

function refreshOutline() {
  const host = $('outlineTree');
  host.replaceChildren();
  const entry = currentEntry();
  if (!entry || entry.virtual) {
    host.appendChild(el('div', 'tree empty', 'Open a file to see symbols.'));
    return;
  }
  const ext = PB.extname(entry.path);
  const symbols = PB.extractDocumentSymbols(entry.model.getValue(), ext);
  if (!symbols.length) {
    host.appendChild(el('div', 'tree empty', 'No symbols found in this file.'));
    return;
  }
  for (const sym of symbols) {
    const row = el('div', 'outline-item');
    row.appendChild(el('span', 'outline-kind ' + (sym.kind || ''), (sym.kind || 'sym').slice(0, 2).toUpperCase()));
    row.appendChild(el('span', 'outline-name', sym.name));
    row.title = sym.name + '  (line ' + sym.line + ')';
    row.onclick = () => jumpToSymbol(sym);
    host.appendChild(row);
  }
}

function symbolPaletteItems(query) {
  const entry = currentEntry();
  if (!entry) return [];
  const extension = entry.virtual ? '' : PB.extname(entry.path);
  const symbols = PB.extractDocumentSymbols(entry.model.getValue(), extension);
  const scored = [];
  for (const symbol of symbols) {
    const match = query ? PB.fuzzyMatch(query, symbol.name) : { score: 0, positions: [] };
    if (!match) continue;
    scored.push({ symbol, match });
  }
  scored.sort((a, b) => b.match.score - a.match.score || a.symbol.line - b.symbol.line);
  return scored.map(({ symbol, match }) => ({
    id: 'symbol:' + symbol.line + ':' + symbol.name,
    label: symbol.name,
    kind: symbol.kind,
    detail: symbol.detail,
    line: symbol.line,
    positions: match.positions,
    run: () => jumpToSymbol(symbol)
  }));
}

async function renderPalette() {
  const token = ++paletteToken;
  const input = $('command-palette-input');
  const value = input.value;
  const mode = paletteModeFromInput(value);
  const query = paletteQuery(value, mode);
  S.palette.mode = mode;
  input.placeholder = PALETTE_PLACEHOLDERS[mode];

  let items = [];
  if (mode === 'commands') {
    items = PB.fuzzyMatchCommands(query, commandList(), 80).map((c) => ({
      id: c.id, label: c.label, key: c.key, run: c.run, positions: c.positions
    }));
  } else if (mode === 'symbols') {
    items = symbolPaletteItems(query).slice(0, 200);
    if (!currentEntry()) {
      $('command-palette-results').replaceChildren(el('div', 'search-empty', 'Open a file to list its symbols.'));
      $('command-palette-hint').textContent = 'Esc to close';
      S.palette.items = [];
      return;
    }
  } else if (!S.root) {
    $('command-palette-results').replaceChildren(el('div', 'search-empty', 'Open a folder to search files.'));
    $('command-palette-hint').textContent = '';
    S.palette.items = [];
    return;
  } else {
    let files = [];
    try { files = await ensureFileIndex(); }
    catch (err) { toast('Could not build file list: ' + err.message, 'error'); }
    if (token !== paletteToken) return;
    items = PB.fuzzyMatchFiles(query, files, 150).map((f) => ({
      id: f.path, label: f.name, path: f.rel, positions: f.positions, run: () => openFile(f.path)
    }));
  }

  if (token !== paletteToken) return;
  S.palette.items = items;
  if (S.palette.index >= items.length) S.palette.index = 0;
  renderPaletteList(items, query, mode);
}

function renderPaletteList(items, query, mode) {
  const host = $('command-palette-results');
  host.replaceChildren();
  if (!items.length) {
    const message = mode === 'commands' ? 'No matching commands.'
      : mode === 'symbols' ? 'No matching symbols.' : 'No matching files.';
    host.appendChild(el('div', 'search-empty', message));
    $('command-palette-hint').textContent = mode === 'files' && !S.root ? '' : 'Esc to close';
    return;
  }
  const rowIcon = mode === 'commands' ? 'palette' : mode === 'symbols' ? 'list' : 'file';
  items.forEach((item, index) => {
    const row = el('div', 'palette-item' + (index === S.palette.index ? ' active' : ''));
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', index === S.palette.index ? 'true' : 'false');
    row.appendChild(icon(rowIcon));
    const name = el('span', 'p-name');
    appendMatch(name, item.label, query, mode !== 'files', item.positions);
    row.appendChild(name);
    if (item.path) row.appendChild(el('span', 'p-path', item.path));
    if (mode === 'symbols') {
      row.appendChild(el('span', 'p-kind', item.kind || 'symbol'));
      row.appendChild(el('span', 'p-line', 'Ln ' + item.line));
    }
    if (item.key) row.appendChild(el('span', 'p-key', item.key));
    row.onmouseenter = () => { S.palette.index = index; markPaletteActive(); };
    row.onclick = () => { S.palette.index = index; paletteAccept(); };
    host.appendChild(row);
  });
  const verb = mode === 'symbols' ? 'jump' : 'open';
  $('command-palette-hint').textContent = items.length + ' result' + (items.length === 1 ? '' : 's') +
    ' · Enter to ' + verb + ' · ↑↓ to navigate · Esc to close';
  markPaletteActive(true);
}

function appendMatch(host, text, query, fuzzy, knownPositions) {
  if (!query) { host.textContent = text; return; }
  if (fuzzy) {
    const match = knownPositions ? { positions: knownPositions } : PB.fuzzyMatch(query, text);
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
  const rows = $$('.palette-item', $('command-palette-results'));
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
  const input = $('command-palette-input');
  input.addEventListener('input', () => { S.palette.index = 0; renderPalette(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); paletteMove(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); paletteMove(-1); }
    else if (event.key === 'Enter') { event.preventDefault(); paletteAccept(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePalette(); }
  });
  $('command-palette-overlay').addEventListener('pointerdown', (event) => {
    if (event.target === $('command-palette-overlay')) closePalette();
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
  const stickyScroll = checkbox(s.stickyScroll);
  appearance.appendChild(settingsRow('Sticky scroll', 'Keep the cursor at the top while scrolling.', stickyScroll));
  body.appendChild(appearance);

  const editing = el('section', 'settings-section');
  editing.appendChild(el('h4', null, 'Editing'));
  const autoSave = checkbox(s.autoSave);
  editing.appendChild(settingsRow('Auto save', 'Save files shortly after you stop typing.', autoSave));
  const autoSaveDelay = textInput(s.autoSaveDelay, 'number');
  autoSaveDelay.min = '250'; autoSaveDelay.max = '10000'; autoSaveDelay.step = '50';
  editing.appendChild(settingsRow('Auto save delay', 'Milliseconds of inactivity before saving.', autoSaveDelay));
  const formatOnSave = checkbox(s.formatOnSave);
  editing.appendChild(settingsRow('Format on save', 'Run the Monaco formatter before saving. Languages: ' + (s.formatOnSaveLanguages || '').replace(/,/g, ', '), formatOnSave));
  const formatOnSaveLanguages = textInput(s.formatOnSaveLanguages, 'text');
  formatOnSaveLanguages.placeholder = 'javascript,typescript,json,html,css,scss,less,markdown';
  editing.appendChild(settingsRow('Format on save languages', 'Comma-separated Monaco language ids that may be formatted.', formatOnSaveLanguages));
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
    const detect = el('button', null, 'Detect');
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
    detect.onclick = async () => {
      detect.disabled = true;
      status.textContent = 'Detecting…';
      status.style.color = 'var(--faint)';
      try {
        const res = await api.runtime.detect({ name: input.value.trim() || key, path: input.value.trim() });
        if (res.ok) {
          input.value = res.path;
          status.textContent = 'Detected: ' + (res.text.split('\n')[0] || 'OK');
          status.style.color = 'var(--green)';
        } else {
          status.textContent = (res.text || 'Not found');
          status.style.color = 'var(--red)';
        }
      } catch (err) { status.textContent = err.message; status.style.color = 'var(--red)'; }
      finally { detect.disabled = false; }
    };
    wrap.append(input, test, detect);
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

  const aiSection = el('section', 'settings-section');
  aiSection.appendChild(el('h4', null, 'AI'));
  const aiEnabled = checkbox(s.ai.enabled);
  aiSection.appendChild(settingsRow('Enable AI', 'Turn on AI-powered inline completions and chat.', aiEnabled));
  const aiProviderList = (S.ai.providers.length ? S.ai.providers : (PB.aiProviders ? PB.aiProviders() : [])).map((p) => [p.id, p.label]);
  const aiProvider = selectInput(aiProviderList, s.ai.provider);
  aiSection.appendChild(settingsRow('Provider', 'Choose the AI provider.', aiProvider));
  const aiModel = textInput(s.ai.model || '', 'text');
  aiModel.placeholder = 'e.g. gpt-4o-mini, claude-3-5-sonnet-latest';
  aiSection.appendChild(settingsRow('Model', 'Model name (leave blank for default).', aiModel));
  const aiEndpoint = textInput(s.ai.endpoint || '', 'text');
  aiEndpoint.placeholder = 'Optional custom endpoint URL';
  aiSection.appendChild(settingsRow('Endpoint', 'Override default endpoint (advanced).', aiEndpoint));
  const aiKeysBtn = el('button', 'mini-btn', 'Manage API Keys…');
  aiKeysBtn.onclick = () => { openAiSettings(); };
  aiSection.appendChild(settingsRow('API Keys', 'Set provider API keys (encrypted at rest).', aiKeysBtn));
  body.appendChild(aiSection);

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
  s.formatOnSave = formatOnSave.checked;
  s.formatOnSaveLanguages = formatOnSaveLanguages.value.trim() || s.formatOnSaveLanguages;
  s.terminalFontSize = PB.clamp(termFont.value, 9, 24);
  s.terminalShell = shell.value.trim();
  s.excludes = excludes.value.trim() || PB.DEFAULT_EXCLUDES.join(', ');
  for (const key of Object.keys(runtimeInputs)) s.runtimes[key] = runtimeInputs[key].value.trim() || s.runtimes[key];

  s.ai.enabled = aiEnabled.checked;
  s.ai.provider = aiProvider.value;
  s.ai.model = aiModel.value.trim();
  s.ai.endpoint = aiEndpoint.value.trim();
  S.ai.enabled = aiEnabled.checked;   // ✅ Keep runtime cache in sync

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
    ['Go to symbol', 'Ctrl+Shift+O'],
    ['Sticky scroll', 'Ctrl+Shift+S'],
    ['Open file', 'Ctrl+Alt+O'],
    ['Open folder', 'Ctrl+O'],
    ['Save', 'Ctrl+S'],
    ['Save all', 'Ctrl+Alt+S'],
    ['Close editor', 'Ctrl+W'],
    ['Reopen closed editor', 'Ctrl+Shift+T'],
    ['Next / previous editor', 'Ctrl+Tab / Ctrl+Shift+Tab'],
    ['Navigate back / forward', 'Alt+← / Alt+→'],
    ['Go to definition', 'F12'],
    ['Find references', 'Shift+F12'],
    ['Rename symbol', 'F2'],
    ['Toggle sidebar', 'Ctrl+B'],
    ['Toggle split editor', 'Ctrl+\\'],
    ['Toggle panel', 'Ctrl+J'],
    ['Terminal', 'Ctrl+`'],
    ['Explorer', 'Ctrl+Shift+E'],
    ['Search', 'Ctrl+Shift+F'],
    ['Replace in files', 'Ctrl+Shift+H'],
    ['Source control', 'Ctrl+Shift+G'],
    ['Outline', 'Ctrl+Shift+U'],
    ['Settings', 'Ctrl+,'],
    ['Run current file', 'F5'],
    ['Stop', 'Shift+F5'],
    ['Toggle breakpoint', 'F9'],
    ['Step over / in / out', 'F10 / F11 / Shift+F11'],
    ['Continue (debugging)', 'F5']
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
    await sessionNow();
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
    'workbench.navBack': () => navBack(),
    'workbench.navForward': () => navForward(),
    'workbench.nextEditor': () => cycleTabs(1),
    'workbench.prevEditor': () => cycleTabs(-1),
    'workbench.reopenClosed': () => reopenClosedEditor(),
    'file.compare': () => compareFilesFlow(),
    'file.insertSnippet': () => insertSnippetFlow(),
    'app.settings': () => openSettings(),
    'app.shortcuts': () => showShortcuts(),
    'palette.commands': () => openPalette('commands'),
    'palette.files': () => openPalette('files'),
    'palette.symbols': () => openPalette('symbols'),
    'view.explorer': () => showView('explorer'),
    'view.search': () => showView('search'),
    'view.replace': () => openWorkspaceReplace(),
    'view.wordWrap': () => toggleWordWrap(),
    'view.git': () => showView('git'),
    'view.sidebar': () => toggleSidebar(),
    'view.panel': () => togglePanel(),
    'view.output': () => showPanel('outputPane'),
    'view.zoomIn': () => zoomEditor(1),
    'view.zoomOut': () => zoomEditor(-1),
    'view.zoomReset': () => zoomEditor(0),
    'editor.split': () => toggleSplit(),
    'terminal.toggle': () => terminalToggle(),
    'run.start': () => runCurrent(),
    'run.stop': () => stopRun(),
    'debug.start': () => startDebugFlow(),
    'debug.stop': () => stopDebugSession(),
    'debug.toggleBreakpoint': () => debugToggleBreakpointAtCursor(),
    'debug.continue': () => debugContinue(),
    'debug.stepOver': () => debugStepOver(),
    'debug.stepIn': () => debugStepIn(),
    'debug.stepOut': () => debugStepOut(),
    'editor.find': () => editorAction('actions.find'),
    'editor.replace': () => editorAction('editor.action.startFindReplaceAction'),
    'editor.gotoLine': () => editorAction('editor.action.gotoLine'),
    'editor.foldAll': () => editorAction('editor.action.foldAll'),
    'editor.unfoldAll': () => editorAction('editor.action.unfoldAll'),
    'editor.toggleFolds': () => editorAction('editor.action.toggleAllFolding'),
    'editor.multiCursorNext': () => editorAction('editor.action.addSelectionToNextFindMatch'),
    'editor.multiCursorAll': () => editorAction('editor.action.selectHighlights'),
    'editor.cursorAbove': () => editorAction('editor.action.insertCursorAbove'),
    'editor.cursorBelow': () => editorAction('editor.action.insertCursorBelow'),
    'editor.deleteLine': () => editorAction('editor.action.deleteLines'),
    'editor.toggleComment': () => editorAction('editor.action.toggleComment'),
    'editor.blockComment': () => editorAction('editor.action.blockComment'),
    'editor.formatSelection': () => editorAction('editor.action.formatSelection'),
    'editor.indentLines': () => editorAction('editor.action.indentLines'),
    'editor.outdentLines': () => editorAction('editor.action.outdentLines'),
    'editor.joinLines': () => editorAction('editor.action.joinLines'),
    'editor.copyLineDown': () => editorAction('editor.action.copyLinesDownAction'),
    'editor.copyLineUp': () => editorAction('editor.action.copyLinesUpAction'),
    'editor.moveLineDown': () => editorAction('editor.action.moveLinesDownAction'),
    'editor.moveLineUp': () => editorAction('editor.action.moveLinesUpAction'),
    'editor.jumpToBracket': () => editorAction('editor.action.jumpToBracket'),
    'editor.insertLineBefore': () => editorAction('editor.action.insertLineBefore'),
    'editor.insertLineAfter': () => editorAction('editor.action.insertLineAfter'),
    'editor.goToDefinition': () => goToDefinition(),
    'editor.findReferences': () => findLspReferences(),
    'editor.renameSymbol': () => renameSymbolLsp(),
    'git.newBranch': () => createBranch(),
    'git.deleteBranch': () => deleteBranchFlow(),
    'git.amend': () => amendCommitFlow()
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

/* ---------------- external drag & drop (from OS file explorer) ---------------- */

function isFileDrag(event) {
  return event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files');
}

function wireExternalDragDrop() {
  let depth = 0;
  document.addEventListener('dragenter', (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    depth++;
    document.body.classList.add('drop-overlay');
  });
  document.addEventListener('dragover', (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', (event) => {
    if (!isFileDrag(event)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove('drop-overlay');
  });
  document.addEventListener('drop', (event) => {
    depth = 0;
    document.body.classList.remove('drop-overlay');
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files || []);
    if (!files.length) return;
    handleDroppedFiles(files);
  });
}

async function handleDroppedFiles(files) {
  for (const file of files) {
    const path = file.path;
    if (!path) { toast('Could not determine the dropped file path.', 'warn', 3000); continue; }
    try {
      const st = await api.file.stat(path);
      if (st.isDirectory) {
        await openWorkspacePath(path);
        showView('explorer');
      } else if (st.isFile) {
        await openFile(path);
      } else {
        toast('Unsupported drop target: ' + nameOf(path), 'warn', 3000);
      }
    } catch (err) {
      toast('Could not open dropped item: ' + err.message, 'error', 4000);
    }
  }
}

function onKeyDown(event) {
  if (S.modalOpen) return;
  if (event.key === 'Escape') {
    if (S.palette.open) { closePalette(); return; }
    if (S.compare) { exitCompare(); return; }
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
  if (mod && event.shiftKey && lower === 'h') { event.preventDefault(); openWorkspaceReplace(); return; }
  if (mod && event.shiftKey && lower === 'e') { event.preventDefault(); showView('explorer'); return; }
  if (mod && event.shiftKey && lower === 'g') { event.preventDefault(); showView('git'); return; }
  if (mod && event.shiftKey && lower === 'u') { event.preventDefault(); showView('outline'); return; }
  if (mod && event.shiftKey && lower === 's') { event.preventDefault(); toggleStickyScroll(); return; }
  if (mod && event.shiftKey && lower === 'o') { event.preventDefault(); openPalette('symbols'); return; }
  if (mod && event.altKey && lower === 'o') { event.preventDefault(); openFilesFlow(); return; }
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
  if (mod && key === '\\') { event.preventDefault(); if (event.shiftKey) { editorAction('editor.action.jumpToBracket'); } else { toggleSplit(); } return; }
  if (mod && key === ',') { event.preventDefault(); openSettings(); return; }
  if (mod && !event.shiftKey && lower === 'g') { event.preventDefault(); editorAction('editor.action.gotoLine'); return; }
  if (mod && !event.shiftKey && lower === 'f') { event.preventDefault(); editorAction('actions.find'); return; }
  if (mod && !event.shiftKey && lower === 'h') { event.preventDefault(); editorAction('editor.action.startFindReplaceAction'); return; }
  if (event.altKey && event.shiftKey && lower === 'f') { event.preventDefault(); editorAction('editor.action.formatDocument'); return; }
  if (event.altKey && event.shiftKey && lower === 'a') { event.preventDefault(); editorAction('editor.action.blockComment'); return; }
  if (mod && event.altKey && lower === 'f') { event.preventDefault(); editorAction('editor.action.formatSelection'); return; }
  if (mod && !event.shiftKey && lower === 'd') { event.preventDefault(); editorAction('editor.action.addSelectionToNextFindMatch'); return; }
  if (mod && event.shiftKey && lower === 'l') { event.preventDefault(); editorAction('editor.action.selectHighlights'); return; }
  if (mod && event.shiftKey && lower === 'k') { event.preventDefault(); editorAction('editor.action.deleteLines'); return; }
  if (mod && lower === '/') { event.preventDefault(); editorAction('editor.action.toggleComment'); return; }
  if (mod && key === 'Enter') {
    if (isTypingTarget(event.target)) return;
    event.preventDefault();
    if (event.shiftKey) editorAction('editor.action.insertLineBefore');
    else editorAction('editor.action.insertLineAfter');
    return;
  }
  if (event.altKey && event.shiftKey && key === 'ArrowDown') { event.preventDefault(); editorAction('editor.action.copyLinesDownAction'); return; }
  if (event.altKey && event.shiftKey && key === 'ArrowUp') { event.preventDefault(); editorAction('editor.action.copyLinesUpAction'); return; }
  if (event.altKey && key === 'ArrowDown') { event.preventDefault(); editorAction('editor.action.moveLinesDownAction'); return; }
  if (event.altKey && key === 'ArrowUp') { event.preventDefault(); editorAction('editor.action.moveLinesUpAction'); return; }
  if (mod && key === 'Enter') {
    if (isTypingTarget(event.target)) return;
    event.preventDefault();
    if (event.shiftKey) editorAction('editor.action.insertLineBefore');
    else editorAction('editor.action.insertLineAfter');
    return;
  }
  if (event.altKey && event.shiftKey && key === 'ArrowDown') { event.preventDefault(); editorAction('editor.action.copyLinesDownAction'); return; }
  if (event.altKey && event.shiftKey && key === 'ArrowUp') { event.preventDefault(); editorAction('editor.action.copyLinesUpAction'); return; }
  if (event.altKey && key === 'ArrowDown') { event.preventDefault(); editorAction('editor.action.moveLinesDownAction'); return; }
  if (event.altKey && key === 'ArrowUp') { event.preventDefault(); editorAction('editor.action.moveLinesUpAction'); return; }
  if (key === 'F12') { event.preventDefault(); if (event.shiftKey) findLspReferences(); else goToDefinition(); return; }
  if (key === 'F2') { event.preventDefault(); renameSymbolLsp(); return; }
  if (key === 'F9') { event.preventDefault(); debugToggleBreakpointAtCursor(); return; }
  if (S.debug && key === 'F5') { event.preventDefault(); debugContinue(); return; }
  if (S.debug && key === 'F10') { event.preventDefault(); debugStepOver(); return; }
  if (S.debug && key === 'F11') { event.preventDefault(); if (event.shiftKey) debugStepOut(); else debugStepIn(); return; }
  if (key === 'F5') { event.preventDefault(); if (event.shiftKey) stopRun(); else runCurrent(); return; }
  if (mod && key === 'Tab' && event.shiftKey) { event.preventDefault(); cycleTabs(-1); return; }
  if (mod && key === 'Tab' && !event.shiftKey) { event.preventDefault(); cycleTabs(1); return; }
  if (event.altKey && key === 'ArrowLeft') { event.preventDefault(); navBack(); return; }
  if (event.altKey && key === 'ArrowRight') { event.preventDefault(); navForward(); return; }
  if (mod && event.shiftKey && lower === 't') { event.preventDefault(); reopenClosedEditor(); return; }
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
  $('outlineBtn').onclick = () => showView('outline');
  $('outlineRefresh').onclick = () => refreshOutline();
  $('gitNewBranch').onclick = () => createBranch();
  $('gitBranch').onchange = (event) => switchBranch(event.target.value);
  $('commitBtn').onclick = () => commitChanges();
  $('gitStageAll').onclick = () => gitBulk('stageAll');
  $('gitUnstageAll').onclick = () => gitBulk('unstageAll');
  $('gitPull').onclick = () => gitBulk('pull');
  $('gitPush').onclick = () => gitBulk('push');
  $('gitFetch').onclick = () => gitFullFetch();
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
  wireExternalDragDrop();
  wireDebugUi();
  window.addEventListener('resize', () => { if (S.activeTerminal) fitTerminal(S.activeTerminal); });
  window.addEventListener('focus', () => {
    checkExternalChangesOnFocus().catch(() => {});
    maybeRefreshGit();
    sessionSoon();
  });
  window.addEventListener('beforeunload', () => {
    try { persistNow(); sessionNow(); } catch { /* ignore */ }
  });
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
  let session = null;
  try { session = await api.session.load(); } catch { /* fall back to state.json */ }
  const cli = S.cli;

  let workspace = session && session.workspace ? session.workspace : (S.state && S.state.lastFolder);
  if (cli && cli.isDir) workspace = cli.path;
  if (workspace) await openWorkspacePath(workspace);

  if (S.state.gitMessage) $('commitMessage').value = S.state.gitMessage;

  const savedTabs = session && Array.isArray(session.tabs) ? session.tabs : [];
  const tabs = savedTabs.length
    ? savedTabs
    : (Array.isArray(S.state.openFiles) ? S.state.openFiles : []).map((p) => ({ path: p, line: 1, column: 1, scrollTop: 0 }));

  for (const tab of tabs) {
    if (!S.editor) break;
    if (!tab || !tab.path) continue;
    try { await openFile(tab.path); } catch { /* skip unavailable */ }
    const entry = S.models.get(tab.path);
    if (!entry) continue;
    entry.cursorLine = tab.line || 1;
    entry.cursorColumn = tab.column || 1;
    entry.scrollTop = tab.scrollTop || 0;
  }

  const cliFile = cli && !cli.isDir ? cli.path : null;
  if (cliFile) {
    try { await openFile(cliFile); } catch { /* ignore unreadable */ }
  }

  const active = (session && session.activeTab) || (S.state && S.state.activeFile) || cliFile;
  if (active && S.models.has(active)) activateEntry(active);
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

  const info = await api.app.info().catch(() => null);
  if (info) S.cli = info.cli || null;

  try {
    S.state = await api.app.loadState();
  } catch (err) {
    S.state = PB.defaultState();
    toast('Could not load your session: ' + err.message, 'error', 6000);
  }
  if (!S.state || !S.state.settings) S.state = PB.defaultState();

  // Load AI providers, saved key status, and enabled flag from main process / settings.
  await initAi();

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
