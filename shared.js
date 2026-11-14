/* PeaBox shared helpers. Loaded as a classic script in the renderer and
   required by the main process and tests (UMD, no dependencies).

   This module provides utility functions for:
   - Path normalization and validation
   - File extension / language detection
   - Git status parsing (porcelain v1 -z and -b)
   - State and session sanitization
   - Formatting utilities (bytes, duration, time)
   - Branch name validation
   - Search and matching algorithms (fuzzy files/commands)
   - Document symbol extraction
   - Dependency-free text transforms and literal replacement

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

  function escapeRegExp(value) {
    return str(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function scorePathMatch(query, rel, name) {
    var match = fuzzyMatch(query, rel);
    if (!match) return null;
    var q = str(query).toLowerCase();
    var base = str(name || basename(rel)).toLowerCase();
    var stem = base.replace(/\.[^.]+$/, '');
    var score = match.score;
    if (stem === q) score += 160;
    else if (base === q) score += 120;
    else if (stem.indexOf(q) === 0) score += 80;
    else if (base.indexOf(q) === 0) score += 60;
    else if (base.indexOf(q) >= 0) score += 25;
    if (rel.toLowerCase().indexOf('/' + q) >= 0) score += 12;
    return { score: score, positions: match.positions };
  }

  /**
   * Fuzzy-filters workspace files. Returns scored entries ordered best-first.
   * Accepts strings or objects shaped like { path, rel, name }.
   * @param {string} query - User query.
   * @param {Array<string|object>} fileList - Candidate files.
   * @param {number} [limit=200] - Maximum results.
   * @returns {Array<object>} { path, rel, name, score, positions, item }
   */
  function fuzzyMatchFiles(query, fileList, limit) {
    var q = str(query).trim();
    var list = Array.isArray(fileList) ? fileList : [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var raw = list[i];
      var rel, full, name, item = null;
      if (typeof raw === 'string') {
        rel = normalizePath(raw);
        full = raw;
        name = basename(rel);
      } else if (raw && typeof raw === 'object') {
        rel = normalizePath(raw.rel || raw.path || raw.name || '');
        full = raw.path || raw.rel || rel;
        name = str(raw.name || basename(rel));
        item = raw;
      } else {
        continue;
      }
      if (!rel) continue;
      var match = q ? scorePathMatch(q, rel, name) : { score: 0, positions: [] };
      if (!match) continue;
      out.push({ path: full, rel: rel, name: name, score: match.score, positions: match.positions, item: item });
    }
    out.sort(function (a, b) {
      return (b.score - a.score) || (a.rel.length - b.rel.length) ||
        a.rel.localeCompare(b.rel, undefined, { sensitivity: 'base' });
    });
    var max = limit === undefined ? 200 : clamp(limit, 1, 5000);
    return out.slice(0, max);
  }

  /**
   * Fuzzy-filters commands by their label. Original properties are preserved.
   * @param {string} query - User query.
   * @param {Array<string|object>} commandList - Commands with a label/title.
   * @param {number} [limit=200] - Maximum results.
   * @returns {Array<object>} Commands extended with score and positions.
   */
  function fuzzyMatchCommands(query, commandList, limit) {
    var q = str(query).trim();
    var list = Array.isArray(commandList) ? commandList : [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var raw = list[i];
      var label = typeof raw === 'string' ? raw : str(raw && (raw.label || raw.title || raw.id));
      if (!label) continue;
      var match = q ? fuzzyMatch(q, label) : { score: 0, positions: [] };
      if (!match) continue;
      var copy = typeof raw === 'string' ? { label: raw } : {};
      if (raw && typeof raw === 'object') {
        for (var key in raw) if (Object.prototype.hasOwnProperty.call(raw, key)) copy[key] = raw[key];
      }
      copy.score = match.score;
      copy.positions = match.positions;
      out.push(copy);
    }
    out.sort(function (a, b) {
      return (b.score - a.score) || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    });
    var max = limit === undefined ? 200 : clamp(limit, 1, 5000);
    return out.slice(0, max);
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

  function parseGitBranchHeader(raw) {
    var s = str(raw).trim();
    if (!s) return '';
    if (s.indexOf('No commits yet on ') === 0) return s.slice('No commits yet on '.length).trim();
    if (s.indexOf('Initial commit on ') === 0) return s.slice('Initial commit on '.length).trim();
    var dots = s.indexOf('...');
    if (dots >= 0) s = s.slice(0, dots);
    var bracket = s.indexOf(' [');
    if (bracket >= 0) s = s.slice(0, bracket);
    s = s.trim();
    if (s === 'HEAD (no branch)' || s === 'HEAD (detached)') return 'HEAD';
    return s;
  }

  function unquoteGitPath(raw) {
    var p = str(raw).trim();
    if (p.length >= 2 && p.charAt(0) === '"' && p.charAt(p.length - 1) === '"') {
      p = p.slice(1, -1);
      p = p.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\t/g, '\t').replace(/\\n/g, '\n');
    }
    return normalizePath(p);
  }

  /**
   * Parses `git status --porcelain=v1 -b` output.
   * @param {string} stdout - Raw porcelain output.
   * @returns {{branch: string, files: Record<string, 'M'|'A'|'D'|'U'|'R'>}}
   */
  function parseGitStatusPorcelain(stdout) {
    var out = { branch: '', files: {} };
    var lines = str(stdout).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line) continue;
      if (line.slice(0, 3) === '## ') {
        out.branch = parseGitBranchHeader(line.slice(3));
        continue;
      }
      if (line.charAt(0) === '#' || line.length < 4) continue;
      var x = line.charAt(0), y = line.charAt(1);
      var rest = line.slice(3);
      var code = 'M';
      if (x === '?' && y === '?') code = 'U';
      else if (x === 'R' || y === 'R' || x === 'C' || y === 'C') code = 'R';
      else if (x === 'D' || y === 'D') code = 'D';
      else if (x === 'A' || y === 'A') code = 'A';
      else if (x === 'U' || y === 'U') code = 'U';
      else if (x === 'M' || y === 'M') code = 'M';
      else continue;
      var arrow = rest.indexOf(' -> ');
      var path = unquoteGitPath(arrow >= 0 ? rest.slice(arrow + 4) : rest);
      if (!path) continue;
      out.files[path] = code;
    }
    return out;
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

  /* ---------------- document symbols ---------------- */

  /**
   * Extracts lightweight symbols from source text.
   * Supports .js/.ts, .py, .md, .html and .css.
   * @param {string} content - Document text.
   * @param {string} fileExtension - Extension with or without a leading dot.
   * @returns {Array<{name:string, kind:string, line:number, column:number, detail:string}>}
   */
  function extractDocumentSymbols(content, fileExtension) {
    var ext = str(fileExtension).toLowerCase().replace(/^\./, '');
    var aliases = {
      jsx: 'js', mjs: 'js', cjs: 'js', tsx: 'ts', pyw: 'py',
      markdown: 'md', htm: 'html', scss: 'css', less: 'css'
    };
    ext = aliases[ext] || ext;
    var lines = str(content).split(/\r?\n/);
    var out = [];
    var seen = {};

    function add(name, kind, index, column, detail) {
      name = str(name).replace(/\s+/g, ' ').trim();
      if (!name || name.length > 240) return;
      var line = index + 1;
      var key = kind + ':' + line + ':' + name;
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ name: name, kind: kind, line: line, column: column || 1, detail: detail || kind });
    }

    if (ext === 'js' || ext === 'ts') {
      var classRe = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
      var funcRe = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
      var varFnRe = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/;
      var methodRe = /^\s{2,}(?:static\s+|async\s+|get\s+|set\s+|\*\s*)*(#?[A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*\{/;
      var reserved = { if: 1, for: 1, while: 1, switch: 1, catch: 1, with: 1, function: 1, return: 1, do: 1, try: 1, else: 1 };
      for (var ji = 0; ji < lines.length; ji++) {
        var jline = lines[ji], jm;
        if ((jm = jline.match(classRe))) { add(jm[1], 'class', ji, jline.indexOf(jm[1]) + 1, 'class'); continue; }
        if ((jm = jline.match(funcRe))) { add(jm[1], 'function', ji, jline.indexOf(jm[1]) + 1, 'function'); continue; }
        if ((jm = jline.match(varFnRe))) { add(jm[1], 'function', ji, jline.indexOf(jm[1]) + 1, 'function'); continue; }
        if ((jm = jline.match(methodRe)) && !Object.prototype.hasOwnProperty.call(reserved, jm[1])) {
          add(jm[1], 'method', ji, jline.indexOf(jm[1]) + 1, 'method');
        }
      }
    } else if (ext === 'py') {
      for (var pi = 0; pi < lines.length; pi++) {
        var pline = lines[pi], pm;
        if ((pm = pline.match(/^(\s*)(?:async\s+)?class\s+([A-Za-z_]\w*)/))) {
          add(pm[2], 'class', pi, pline.indexOf(pm[2]) + 1, 'class');
        } else if ((pm = pline.match(/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)/))) {
          add(pm[2], pm[1].length ? 'method' : 'function', pi, pline.indexOf(pm[2]) + 1, pm[1].length ? 'method' : 'function');
        }
      }
    } else if (ext === 'md') {
      for (var mi = 0; mi < lines.length; mi++) {
        var mline = lines[mi];
        var mm = mline.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (!mm) continue;
        var title = mm[2].replace(/[*_`~]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
        add(title, 'heading', mi, mline.indexOf(mm[2]) + 1, 'h' + mm[1].length);
      }
    } else if (ext === 'html') {
      for (var hi = 0; hi < lines.length; hi++) {
        var hline = lines[hi];
        var heading = hline.match(/<h([1-6])\b[^>]*>(.*?)<\/h\1>/i);
        if (heading) {
          var htext = heading[2].replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').trim();
          add(htext, 'heading', hi, hline.indexOf(heading[2]) + 1, 'h' + heading[1]);
        }
        var idRe = /<([a-zA-Z][\w:-]*)\b[^>]*\bid=(?:"([^"]+)"|'([^']+)')/g;
        var idMatch;
        while ((idMatch = idRe.exec(hline))) add(idMatch[2] || idMatch[3], 'id', hi, hline.indexOf(idMatch[2] || idMatch[3]) + 1, idMatch[1]);
      }
    } else if (ext === 'css') {
      for (var ci = 0; ci < lines.length; ci++) {
        var cline = lines[ci];
        var keyframes = cline.match(/^\s*@(?:-webkit-)?keyframes\s+([\w-]+)/);
        if (keyframes) { add(keyframes[1], 'keyframes', ci, cline.indexOf(keyframes[1]) + 1, 'keyframes'); continue; }
        var selector = cline.match(/^\s*([^{}@/][^{}]*?)\s*\{\s*$/);
        if (selector) {
          var sel = selector[1].replace(/\s+/g, ' ').trim();
          if (sel && sel.length < 180) add(sel, 'selector', ci, cline.indexOf(selector[1]) + 1, 'selector');
        }
      }
    }

    out.sort(function (a, b) { return (a.line - b.line) || (a.column - b.column); });
    return out.slice(0, 2000);
  }

  /* ---------------- text transforms ---------------- */

  function splitLineList(content) {
    var source = str(content);
    var trailing = /(?:\r\n|\n|\r)$/.test(source);
    var lines = source.split(/\r\n|\n|\r/);
    if (trailing && lines.length) lines.pop();
    return { lines: lines, trailing: trailing };
  }

  function joinLineList(lines, trailing) {
    return lines.join('\n') + (trailing && lines.length ? '\n' : '');
  }

  /**
   * Pretty-prints JSON without throwing.
   * @returns {{ok: boolean, text?: string, error?: string}}
   */
  function formatJsonText(content, indent) {
    var source = str(content).replace(/^\uFEFF/, '');
    try {
      var value = JSON.parse(source);
      var spaces = indent === undefined ? 2 : clamp(indent, 0, 8);
      return { ok: true, text: JSON.stringify(value, null, spaces) };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'Invalid JSON.' };
    }
  }

  function sortLines(content, options) {
    options = options || {};
    var parts = splitLineList(content);
    var caseSensitive = !!options.caseSensitive;
    parts.lines.sort(function (a, b) {
      var x = caseSensitive ? a : a.toLowerCase();
      var y = caseSensitive ? b : b.toLowerCase();
      if (x < y) return -1;
      if (x > y) return 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    if (options.descending) parts.lines.reverse();
    return joinLineList(parts.lines, parts.trailing);
  }

  function dedupeLines(content, options) {
    options = options || {};
    var parts = splitLineList(content);
    var caseSensitive = options.caseSensitive !== false;
    var seen = {};
    var out = [];
    for (var i = 0; i < parts.lines.length; i++) {
      var line = parts.lines[i];
      var key = caseSensitive ? line : line.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(seen, key)) continue;
      seen[key] = 1;
      out.push(line);
    }
    return joinLineList(out, parts.trailing);
  }

  function trimTrailingWhitespace(content) {
    return str(content).replace(/[ \t]+(?=\r\n|\n|\r|$)/g, '');
  }

  /**
   * Appends terminal-style output, honouring carriage returns.
   * A `\r` moves the cursor to the start of the current line so progress bars
   * overwrite themselves instead of appending a new line for every update.
   * @param {string} existing - Text already displayed.
   * @param {string} chunk - Newly received text.
   * @returns {string} The combined text.
   */
  function applyCarriageReturns(existing, chunk) {
    let out = str(existing);
    const incoming = str(chunk);
    if (!incoming) return out;
    let cursor = out.length;
    let i = 0;
    while (i < incoming.length) {
      const ch = incoming[i];
      if (ch === '\r') {
        if (incoming[i + 1] === '\n') {
          out = out.slice(0, cursor) + '\n' + out.slice(cursor);
          cursor += 1;
          i += 2;
          continue;
        }
        const nl = out.lastIndexOf('\n', cursor - 1);
        cursor = nl + 1;
        i += 1;
        continue;
      }
      if (ch === '\n') {
        out = out.slice(0, cursor) + '\n' + out.slice(cursor);
        cursor += 1;
        i += 1;
        continue;
      }
      let j = i;
      while (j < incoming.length && incoming[j] !== '\r' && incoming[j] !== '\n') j += 1;
      const run = incoming.slice(i, j);
      if (cursor === out.length) out += run;
      else out = out.slice(0, cursor) + run + out.slice(cursor + run.length);
      cursor += run.length;
      i = j;
    }
    return out;
  }

  /**
   * Applies a named text transform.
   * @param {string} content - Document text.
   * @param {string} id - Transform id (format-json, sort-lines, dedupe-lines, trim-trailing-whitespace).
   * @param {object} [options] - Transform options.
   * @returns {{ok: boolean, text?: string, changed?: boolean, error?: string}}
   */
  function transformText(content, id, options) {
    options = options || {};
    var source = str(content);
    var text;
    if (id === 'format-json' || id === 'json') {
      var parsed = formatJsonText(source, options.indent);
      if (!parsed.ok) return parsed;
      text = parsed.text;
    } else if (id === 'sort-lines' || id === 'sort-lines-ascending') {
      text = sortLines(source, options);
    } else if (id === 'sort-lines-descending') {
      text = sortLines(source, { caseSensitive: options.caseSensitive, descending: true });
    } else if (id === 'dedupe-lines' || id === 'remove-duplicate-lines') {
      text = dedupeLines(source, options);
    } else if (id === 'trim-trailing-whitespace') {
      text = trimTrailingWhitespace(source);
    } else {
      return { ok: false, error: 'Unknown text transform.' };
    }
    return { ok: true, text: text, changed: text !== source };
  }

  /**
   * Replaces literal text with optional case sensitivity and whole-word matching.
   * @returns {{text: string, count: number}}
   */
  function replaceInText(content, query, replacement, options) {
    options = options || {};
    var source = str(content);
    var needle = str(query);
    if (!needle) return { text: source, count: 0 };
    var pattern = escapeRegExp(needle);
    if (options.wholeWord) pattern = '(?<![A-Za-z0-9_])' + pattern + '(?![A-Za-z0-9_])';
    var flags = options.caseSensitive ? 'g' : 'gi';
    var re = new RegExp(pattern, flags);
    var count = 0;
    var text = source.replace(re, function () { count++; return str(replacement); });
    return { text: text, count: count };
  }

  /* ---------------- session persistence ---------------- */

  function defaultSession() {
    return { version: 1, workspace: null, activeTab: null, tabs: [] };
  }

  /**
   * Repairs hostile or malformed persisted session data.
   * @param {*} raw - Parsed session JSON.
   * @returns {{version:number, workspace:string|null, activeTab:string|null, tabs:Array}}
   */
  function sanitizeSession(raw) {
    var out = defaultSession();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    if (typeof raw.workspace === 'string' && raw.workspace.length < 4096) out.workspace = raw.workspace;
    if (typeof raw.activeTab === 'string' && raw.activeTab.length < 4096) out.activeTab = raw.activeTab;
    var seen = {};
    var tabs = Array.isArray(raw.tabs) ? raw.tabs.slice(0, 80) : [];
    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i];
      if (!tab || typeof tab !== 'object' || Array.isArray(tab)) continue;
      if (typeof tab.path !== 'string' || !tab.path || tab.path.length >= 4096) continue;
      var key = normalizePath(tab.path).toLowerCase();
      if (seen[key]) continue;
      seen[key] = 1;
      out.tabs.push({
        path: tab.path,
        line: clamp(tab.line || 1, 1, 1000000),
        column: clamp(tab.column || 1, 1, 1000000),
        scrollTop: clamp(tab.scrollTop || 0, 0, 100000000)
      });
    }
    return out;
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
    escapeRegExp: escapeRegExp,
    scorePathMatch: scorePathMatch,
    fuzzyMatchFiles: fuzzyMatchFiles,
    fuzzyMatchCommands: fuzzyMatchCommands,
    parseGitStatus: parseGitStatus,
    parseGitStatusPorcelain: parseGitStatusPorcelain,
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
    normalizeLineEndings: normalizeLineEndings,
    extractDocumentSymbols: extractDocumentSymbols,
    formatJsonText: formatJsonText,
    sortLines: sortLines,
    dedupeLines: dedupeLines,
    trimTrailingWhitespace: trimTrailingWhitespace,
    applyCarriageReturns: applyCarriageReturns,
    transformText: transformText,
    replaceInText: replaceInText,
    defaultSession: defaultSession,
    sanitizeSession: sanitizeSession
  };
});
