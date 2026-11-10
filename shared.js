/* PeaBox shared helpers. Loaded as a classic script in the renderer and
   required by the main process and tests (UMD, no dependencies).

   This module provides utility functions for:
   - Path normalization and validation
   - File extension / language detection
   - Git status parsing
   - State sanitization and validation
   - Formatting utilities (bytes, duration, time)
   - Branch name validation
   - Search and matching algorithms

   All functions are pure where possible and have no external dependencies.
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PeaBoxShared = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULT_EXCLUDES = [
    'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage',
    '.venv', 'venv', '__pycache__', '.cache', '.idea', '.vs', 'target', '.turbo'
  ];

  var LANGUAGES = {
    py: 'python', pyw: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    jsx: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', jsonc: 'json',
    html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less', md: 'markdown',
    markdown: 'markdown', go: 'go', rs: 'rust', c: 'c', h: 'cpp', cc: 'cpp', cpp: 'cpp',
    cxx: 'cpp', hpp: 'cpp', cs: 'csharp', java: 'java', kt: 'kotlin', php: 'php',
    rb: 'ruby', sql: 'sql', ps1: 'powershell', psm1: 'powershell', sh: 'shell',
    bash: 'shell', zsh: 'shell', yml: 'yaml', yaml: 'yaml', xml: 'xml', svg: 'xml',
    toml: 'ini', ini: 'ini', conf: 'ini', vue: 'html', svelte: 'html', lua: 'lua',
    swift: 'swift', dart: 'dart', r: 'r', pl: 'perl', bat: 'bat', cmd: 'bat',
    dockerfile: 'dockerfile', makefile: 'makefile', gradle: 'groovy', groovy: 'groovy'
  };

  var BADGES = {
    js: ['JS', 'ext-js'], mjs: ['JS', 'ext-js'], cjs: ['JS', 'ext-js'], jsx: ['JSX', 'ext-js'],
    ts: ['TS', 'ext-ts'], tsx: ['TSX', 'ext-ts'], py: ['PY', 'ext-py'], pyw: ['PY', 'ext-py'],
    go: ['GO', 'ext-go'], rs: ['RS', 'ext-rs'], json: ['{}', 'ext-json'], jsonc: ['{}', 'ext-json'],
    html: ['<>', 'ext-html'], htm: ['<>', 'ext-html'], css: ['CSS', 'ext-css'], scss: ['SCSS', 'ext-css'],
    less: ['LESS', 'ext-css'], md: ['MD', 'ext-md'], markdown: ['MD', 'ext-md'],
    c: ['C', 'ext-c'], h: ['H', 'ext-c'], cpp: ['C++', 'ext-c'], hpp: ['H++', 'ext-c'],
    cs: ['C#', 'ext-cs'], java: ['JAVA', 'ext-java'], kt: ['KT', 'ext-java'], php: ['PHP', 'ext-php'],
    rb: ['RB', 'ext-rb'], sql: ['SQL', 'ext-sql'], ps1: ['PS', 'ext-ps'], sh: ['SH', 'ext-sh'],
    bash: ['SH', 'ext-sh'], yml: ['YML', 'ext-yml'], yaml: ['YML', 'ext-yml'], xml: ['XML', 'ext-xml'],
    svg: ['SVG', 'ext-xml'], toml: ['TML', 'ext-ini'], ini: ['INI', 'ext-ini'], lua: ['LUA', 'ext-lua'],
    swift: ['SW', 'ext-swift'], dart: ['DART', 'ext-dart'], vue: ['VUE', 'ext-vue'], svelte: ['SVELTE', 'ext-vue']
  };

  function str(v) { return v === null || v === undefined ? '' : String(v); }

  function basename(p) {
    var s = str(p).replace(/[\\/]+$/, '');
    var i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function dirname(p) {
    var s = str(p).replace(/[\\/]+$/, '');
    var i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    if (i <= 0) return i === 0 ? s.slice(0, 1) : '';
    return s.slice(0, i);
  }

  function extname(p) {
    var b = basename(p);
    var i = b.lastIndexOf('.');
    return i > 0 ? b.slice(i + 1).toLowerCase() : b.toLowerCase();
  }

  function normalizeLanguage(file) {
    var b = basename(file).toLowerCase();
    if (b === 'dockerfile') return 'dockerfile';
    if (b === 'makefile') return 'makefile';
    return LANGUAGES[extname(file)] || 'plaintext';
  }

  function fileBadge(file) {
    var b = basename(file).toLowerCase();
    if (b === 'dockerfile') return { label: 'DOCKER', cls: 'ext-docker' };
    if (b === 'makefile') return { label: 'MAKE', cls: 'ext-make' };
    if (b.charAt(0) === '.' && b.indexOf('.', 1) < 0) return { label: 'DOT', cls: 'ext-file' };
    var e = extname(file);
    var hit = BADGES[e];
    if (hit) return { label: hit[0], cls: hit[1] };
    return { label: e ? e.slice(0, 3).toUpperCase() : 'FILE', cls: 'ext-file' };
  }

  function escapeHtml(value) {
    return str(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clamp(n, min, max) {
    n = Number(n);
    if (!isFinite(n)) n = min;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  function normalizePath(p) {
    return str(p).replace(/[\\/]+/g, '/').replace(/\/+$/, '');
  }

  function isSubPath(rootPath, target) {
    var r = normalizePath(rootPath).toLowerCase();
    var t = normalizePath(target).toLowerCase();
    return !!r && (t === r || t.indexOf(r + '/') === 0);
  }

  function splitExcludes(value) {
    var parts = Array.isArray(value) ? value : str(value).split(/[,;\n]/);
    var out = [];
    parts.forEach(function (x) {
      x = str(x).trim();
      if (x && out.indexOf(x) < 0) out.push(x);
    });
    return out.length ? out : DEFAULT_EXCLUDES.slice();
  }

  function quoteCmdArg(value) {
    var s = str(value);
    if (!/[ \t"&|<>^]/.test(s)) return s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function fuzzyMatch(query, text) {
    var q = str(query).toLowerCase();
    var t = str(text).toLowerCase();
    if (!q) return { score: 0, positions: [] };
    var qi = 0, score = 0, positions = [], last = -2;
    for (var i = 0; i < t.length && qi < q.length; i++) {
      if (t.charAt(i) !== q.charAt(qi)) continue;
      positions.push(i);
      score += (i === last + 1 ? 8 : 1);
      if (i === 0 || /[\\/_.\- ]/.test(t.charAt(i - 1))) score += 5;
      last = i;
      qi++;
    }
    if (qi < q.length) return null;
    score -= t.length * 0.01;
    return { score: score, positions: positions };
  }

  function parseGitStatus(text) {
    var parts = str(text).split('\0');
    var changes = [];
    for (var i = 0; i < parts.length; i++) {
      var entry = parts[i];
      if (!entry || entry.slice(0, 3) === '## ') continue;
      if (entry.length < 4) continue;
      var x = entry.charAt(0), y = entry.charAt(1);
      var file = entry.slice(3);
      var origPath = null;
      if (x === 'R' || x === 'C' || y === 'R' || y === 'C') origPath = parts[++i] || null;
      if (!file) continue;
      var untracked = x === '?' && y === '?';
      changes.push({
        x: x, y: y, path: file, origPath: origPath, untracked: untracked,
        staged: !untracked && x !== ' ' && x !== '?',
        unstaged: !untracked && y !== ' ' && y !== '?'
      });
    }
    return changes;
  }

  function isWordChar(ch) { return !!ch && /[A-Za-z0-9_]/.test(ch); }

  function boundaryMatch(line, index, length) {
    var before = index > 0 ? line.charAt(index - 1) : '';
    var after = index + length < line.length ? line.charAt(index + length) : '';
    return !isWordChar(before) && !isWordChar(after);
  }

  function validateEntryName(name) {
    var n = str(name).trim();
    if (!n) return { ok: false, error: 'Name cannot be empty.' };
    if (n === '.' || n === '..') return { ok: false, error: 'That name is not allowed.' };
    if (/[\\/:*?"<>|\u0000]/.test(n)) return { ok: false, error: 'A name cannot contain \\ / : * ? " < > |' };
    if (/[. ]$/.test(n)) return { ok: false, error: 'A name cannot end with a dot or space.' };
    if (n.length > 255) return { ok: false, error: 'That name is too long.' };
    return { ok: true, value: n };
  }

  function validateBranchName(name) {
    var n = str(name).trim();
    if (!n) return { ok: false, error: 'Branch name is required.' };
    if (n === '@' || /\s/.test(n)) return { ok: false, error: 'Branch names cannot contain spaces.' };
    if (/[~^:?*\[\\]/.test(n)) return { ok: false, error: 'A branch name cannot contain ~ ^ : ? * [ \\' };
    if (n.indexOf('..') >= 0 || n.indexOf('@{') >= 0 || n.indexOf('//') >= 0) {
      return { ok: false, error: 'That branch name is not valid.' };
    }
    if (n.charAt(0) === '-' || n.charAt(0) === '/' || n.charAt(n.length - 1) === '/') {
      return { ok: false, error: 'A branch name cannot start with - or / and cannot end with /.' };
    }
    if (/[.]$/.test(n) || /[.]lock$/.test(n)) return { ok: false, error: 'A branch name cannot end with . or .lock.' };
    if (n.length > 200) return { ok: false, error: 'That branch name is too long.' };
    return { ok: true, value: n };
  }

  /**
   * Detects file encoding from a raw byte array or string.
   * Works in both browser and Node contexts.
   * @param {Array<number>|string} bytes - Raw bytes as an array of numbers, or a raw string sample.
   * @param {number} [sampleSize=4096] - Number of bytes to sample for detection.
   * @returns {object} { encoding, bomDetected, hasNul, isBinary }
   */
  function detectFileEncoding(bytes, sampleSize) {
    var sample = [];
    if (typeof bytes === 'string') {
      for (var i = 0; i < bytes.length && i < sampleSize; i++) sample.push(bytes.charCodeAt(i) & 0xFF);
    } else if (Array.isArray(bytes)) {
      sample = bytes.slice(0, sampleSize || 4096);
    } else if (bytes && typeof bytes.length === 'number') {
      for (var j = 0; j < bytes.length && j < (sampleSize || 4096); j++) sample.push(bytes[j]);
    }
    var encoding = 'utf-8';
    var bomDetected = false;
    var hasNul = false;
    if (sample.length >= 3 && sample[0] === 0xEF && sample[1] === 0xBB && sample[2] === 0xBF) { encoding = 'utf-8'; bomDetected = true; }
    else if (sample.length >= 2 && sample[0] === 0xFF && sample[1] === 0xFE) { encoding = 'utf-16-le'; bomDetected = true; }
    else if (sample.length >= 2 && sample[0] === 0xFE && sample[1] === 0xFF) { encoding = 'utf-16-be'; bomDetected = true; }
    else if (sample.length >= 4 && sample[0] === 0xFF && sample[1] === 0xFE && sample[2] === 0x00 && sample[3] === 0x00) { encoding = 'utf-32-le'; bomDetected = true; }
    else if (sample.length >= 4 && sample[0] === 0x00 && sample[1] === 0x00 && sample[2] === 0xFE && sample[3] === 0xFF) { encoding = 'utf-32-be'; bomDetected = true; }
    for (var k = 0; k < sample.length; k++) { if (sample[k] === 0) { hasNul = true; break; } }
    return { encoding: encoding, bomDetected: bomDetected, hasNul: hasNul, isBinary: hasNul && !bomDetected };
  }

  /**
   * Normalizes line endings in file content.
   * @param {string} content - File content to normalize.
   * @param {string} [to='lf'] - Target line ending ('lf', 'crlf', 'native'). Defaults to 'lf'.
   * @returns {string} Content with normalized line endings.
   */
  function normalizeLineEndings(content, to) {
    var s = str(content);
    s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var target = String(to || 'lf').toLowerCase();
    if (target === 'crlf') return s.replace(/\n/g, '\r\n');
    if (target === 'cr') return s.replace(/\n/g, '\r');
    return s;
  }

  function formatBytes(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatDuration(ms) {
    ms = Number(ms) || 0;
    if (ms < 1000) return ms + ' ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
    return Math.floor(ms / 60000) + 'm ' + Math.round((ms % 60000) / 1000) + 's';
  }

  function relativeTime(iso, now) {
    var t = Date.parse(iso);
    if (!t) return '';
    var diff = Math.max(0, (now || Date.now()) - t);
    if (diff < 45000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return new Date(t).toLocaleDateString();
  }

  function defaultSettings() {
    return {
      theme: 'dark', fontSize: 14, fontFamily: 'Consolas, "Cascadia Code", monospace',
      tabSize: 2, wordWrap: false, minimap: true, autoSave: false, autoSaveDelay: 800,
      terminalFontSize: 13, terminalShell: '',
      runtimes: { python: 'python', node: 'node', go: 'go', powershell: 'powershell.exe' },
      excludes: DEFAULT_EXCLUDES.join(', '),
      sidebarWidth: 280, panelHeight: 220, showSidebar: true
    };
  }

  function defaultState() {
    return {
      version: 2,
      recent: [],
      lastFolder: null,
      openFiles: [],
      activeFile: null,
      gitMessage: '',
      settings: defaultSettings()
    };
  }

  function sanitizeState(raw) {
    var base = defaultState();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
    var out = base;

    if (Array.isArray(raw.recent)) {
      out.recent = raw.recent.filter(function (x) { return typeof x === 'string' && x.length < 4096; }).slice(0, 15);
    }
    if (typeof raw.lastFolder === 'string') out.lastFolder = raw.lastFolder;
    var open = Array.isArray(raw.openFiles) ? raw.openFiles : (raw.session && Array.isArray(raw.session.openFiles) ? raw.session.openFiles : []);
    out.openFiles = open.filter(function (x) { return typeof x === 'string' && x.length < 4096; }).slice(0, 60);
    if (typeof raw.activeFile === 'string') out.activeFile = raw.activeFile;
    if (typeof raw.gitMessage === 'string') out.gitMessage = raw.gitMessage.slice(0, 5000);

    var rs = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    var s = out.settings;
    if (rs.theme === 'light' || rs.theme === 'dark' || rs.theme === 'system') s.theme = rs.theme;
    s.fontSize = clamp(rs.fontSize, 10, 30);
    if (typeof rs.fontFamily === 'string' && rs.fontFamily.trim()) s.fontFamily = rs.fontFamily.slice(0, 200);
    s.tabSize = clamp(rs.tabSize, 1, 8);
    s.wordWrap = !!rs.wordWrap;
    s.minimap = rs.minimap !== false;
    s.autoSave = !!rs.autoSave;
    s.autoSaveDelay = clamp(rs.autoSaveDelay, 250, 10000);
    s.terminalFontSize = clamp(rs.terminalFontSize, 9, 24);
    if (typeof rs.terminalShell === 'string') s.terminalShell = rs.terminalShell.slice(0, 1000);
    if (rs.runtimes && typeof rs.runtimes === 'object') {
      ['python', 'node', 'go', 'powershell'].forEach(function (k) {
        if (typeof rs.runtimes[k] === 'string' && rs.runtimes[k].trim()) s.runtimes[k] = rs.runtimes[k].trim().slice(0, 1000);
      });
    }
    if (typeof rs.excludes === 'string') s.excludes = rs.excludes.slice(0, 2000);
    s.sidebarWidth = clamp(rs.sidebarWidth, 180, 520);
    s.panelHeight = clamp(rs.panelHeight, 120, 700);
    s.showSidebar = rs.showSidebar !== false;
    return out;
  }

  return {
    DEFAULT_EXCLUDES: DEFAULT_EXCLUDES,
    LANGUAGES: LANGUAGES,
    str: str,
    basename: basename,
    dirname: dirname,
    extname: extname,
    normalizeLanguage: normalizeLanguage,
    fileBadge: fileBadge,
    escapeHtml: escapeHtml,
    clamp: clamp,
    normalizePath: normalizePath,
    isSubPath: isSubPath,
    splitExcludes: splitExcludes,
    quoteCmdArg: quoteCmdArg,
    fuzzyMatch: fuzzyMatch,
    parseGitStatus: parseGitStatus,
    boundaryMatch: boundaryMatch,
    validateEntryName: validateEntryName,
    validateBranchName: validateBranchName,
    formatBytes: formatBytes,
    formatDuration: formatDuration,
    relativeTime: relativeTime,
    defaultSettings: defaultSettings,
    defaultState: defaultState,
    sanitizeState: sanitizeState,
    detectFileEncoding: detectFileEncoding,
    normalizeLineEndings: normalizeLineEndings
  };
});
