'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PB = require('../shared');

test('escapeHtml neutralises markup', () => {
  assert.equal(PB.escapeHtml('<b>"x" & \'y\'</b>'), '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
  assert.equal(PB.escapeHtml(null), '');
});

test('validateEntryName accepts normal names and rejects unsafe ones', () => {
  assert.deepEqual(PB.validateEntryName('app.js'), { ok: true, value: 'app.js' });
  assert.equal(PB.validateEntryName('  spaced  ').value, 'spaced');
  assert.equal(PB.validateEntryName('trailing ').value, 'trailing');
  for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'trailing.']) {
    assert.equal(PB.validateEntryName(bad).ok, false, 'should reject ' + JSON.stringify(bad));
  }
});

test('validateBranchName allows slashes and rejects Git-invalid names', () => {
  assert.equal(PB.validateBranchName('feature/login').ok, true);
  assert.equal(PB.validateBranchName('fix/bug-123').ok, true);
  for (const bad of ['', 'has space', 'a..b', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', 'a@{b', 'a//b', '-nope', '/nope', 'nope/', 'nope.', 'nope.lock', '@']) {
    assert.equal(PB.validateBranchName(bad).ok, false, 'should reject ' + JSON.stringify(bad));
  }
});

test('parseGitStatus understands porcelain v1 -z output', () => {
  const raw = [
    '## main',
    ' M src/app.js',
    '?? notes.txt',
    'A  staged.py',
    'R  new-name.js',
    'old-name.js',
    ''
  ].join('\0');
  const changes = PB.parseGitStatus(raw);
  assert.equal(changes.length, 4);
  assert.deepEqual(
    changes.map((c) => [c.x, c.y, c.path, c.staged, c.unstaged, c.untracked]),
    [
      [' ', 'M', 'src/app.js', false, true, false],
      ['?', '?', 'notes.txt', false, false, true],
      ['A', ' ', 'staged.py', true, false, false],
      ['R', ' ', 'new-name.js', true, false, false]
    ]
  );
  assert.equal(changes[3].origPath, 'old-name.js');
});

test('fuzzyMatch scores contiguous and boundary matches higher', () => {
  assert.equal(PB.fuzzyMatch('zzz', 'app.js'), null);
  const contiguous = PB.fuzzyMatch('app', 'app.js');
  const scattered = PB.fuzzyMatch('app', 'a-p-p.js');
  assert.ok(contiguous.score > scattered.score);
  assert.deepEqual(contiguous.positions, [0, 1, 2]);
});

test('isSubPath is case-insensitive and boundary aware', () => {
  assert.equal(PB.isSubPath('C:\\work', 'C:\\work\\src\\a.js'), true);
  assert.equal(PB.isSubPath('C:\\work', 'C:\\work'), true);
  assert.equal(PB.isSubPath('C:\\work', 'C:\\workshop\\a.js'), false);
  assert.equal(PB.isSubPath('/home/me', '/home/me/other/file.txt'), true);
  assert.equal(PB.isSubPath('/home/me', '/home/melon/file.txt'), false);
});

test('splitExcludes trims, dedupes and falls back to defaults', () => {
  assert.deepEqual(PB.splitExcludes(' node_modules , .git,node_modules\n dist '), ['node_modules', '.git', 'dist']);
  assert.deepEqual(PB.splitExcludes(''), PB.DEFAULT_EXCLUDES);
  assert.deepEqual(PB.splitExcludes(' , ; '), PB.DEFAULT_EXCLUDES);
});

test('clamp rounds and handles junk input', () => {
  assert.equal(PB.clamp(5.6, 1, 10), 6);
  assert.equal(PB.clamp(-4, 1, 10), 1);
  assert.equal(PB.clamp('nope', 2, 9), 2);
});

test('normalizeLanguage and fileBadge map common extensions', () => {
  assert.equal(PB.normalizeLanguage('src/main.ts'), 'typescript');
  assert.equal(PB.normalizeLanguage('Dockerfile'), 'dockerfile');
  assert.equal(PB.normalizeLanguage('unknown.zzz'), 'plaintext');
  assert.deepEqual(PB.fileBadge('a.tsx'), { label: 'TSX', cls: 'ext-ts' });
  assert.deepEqual(PB.fileBadge('.gitignore'), { label: 'DOT', cls: 'ext-file' });
  assert.equal(PB.fileBadge('a.zzz').cls, 'ext-file');
});

test('formatting helpers produce stable output', () => {
  assert.equal(PB.formatBytes(512), '512 B');
  assert.equal(PB.formatBytes(2048), '2.0 KB');
  assert.equal(PB.formatBytes(3 * 1024 * 1024), '3.0 MB');
  assert.equal(PB.formatDuration(750), '750 ms');
  assert.equal(PB.formatDuration(2500), '2.5 s');
});

test('relativeTime handles recent and older timestamps', () => {
  const now = Date.parse('2026-01-02T12:00:00Z');
  assert.equal(PB.relativeTime('2026-01-02T11:59:30Z', now), 'just now');
  assert.equal(PB.relativeTime('2026-01-02T11:30:00Z', now), '30m ago');
  assert.equal(PB.relativeTime('2026-01-02T09:00:00Z', now), '3h ago');
  assert.equal(PB.relativeTime('2025-12-31T12:00:00Z', now), '2d ago');
  assert.equal(PB.relativeTime('not a date', now), '');
});

test('boundaryMatch respects word characters', () => {
  assert.equal(PB.boundaryMatch('a needle b', 2, 6), true);
  assert.equal(PB.boundaryMatch('aneedleb', 1, 6), false);
});

test('sanitizeState repairs hostile or malformed state', () => {
  const state = PB.sanitizeState({
    recent: [42, 'C:\\one', 'C:\\two'],
    lastFolder: 'C:\\one',
    openFiles: ['a.js', null, 7],
    activeFile: 'a.js',
    gitMessage: 'x'.repeat(9000),
    settings: {
      theme: 'neon',
      fontSize: 999,
      tabSize: 0,
      autoSaveDelay: 1,
      sidebarWidth: 5,
      panelHeight: 9999,
      runtimes: { python: 'py -3', node: '' }
    }
  });
  assert.deepEqual(state.recent, ['C:\\one', 'C:\\two']);
  assert.deepEqual(state.openFiles, ['a.js']);
  assert.equal(state.gitMessage.length, 5000);
  assert.equal(state.settings.theme, 'dark');
  assert.equal(state.settings.fontSize, 30);
  assert.equal(state.settings.tabSize, 1);
  assert.equal(state.settings.autoSaveDelay, 250);
  assert.equal(state.settings.sidebarWidth, 180);
  assert.equal(state.settings.panelHeight, 700);
  assert.equal(state.settings.runtimes.python, 'py -3');
  assert.equal(state.settings.runtimes.node, 'node');
});

test('sanitizeState returns defaults for garbage', () => {
  assert.deepEqual(PB.sanitizeState(null), PB.defaultState());
  assert.deepEqual(PB.sanitizeState([]), PB.defaultState());
  assert.deepEqual(PB.sanitizeState('nope'), PB.defaultState());
});

test('defaultState matches the persisted schema', () => {
  const state = PB.defaultState();
  assert.equal(state.version, 2);
  assert.ok(Array.isArray(state.recent));
  assert.ok(state.settings && typeof state.settings === 'object');
  assert.equal(state.settings.theme, 'dark');
});

test('detectFileEncoding detects UTF-8 BOM', () => {
  const buf = [0xEF, 0xBB, 0xBF, 0x41, 0x42]; // BOM + "AB"
  const result = PB.detectFileEncoding(buf);
  assert.equal(result.bomDetected, true);
  assert.equal(result.encoding, 'utf-8');
  assert.equal(result.hasNul, false);
  assert.equal(result.isBinary, false);
});

test('detectFileEncoding detects UTF-16 LE BOM', () => {
  const buf = [0xFF, 0xFE, 0x41, 0x00, 0x42, 0x00];
  const result = PB.detectFileEncoding(buf);
  assert.equal(result.bomDetected, true);
  assert.equal(result.encoding, 'utf-16-le');
});

test('detectFileEncoding marks binary buffers with NUL bytes', () => {
  const buf = [0x00, 0xFF, 0x00, 0x42];
  const result = PB.detectFileEncoding(buf);
  assert.equal(result.hasNul, true);
  assert.equal(result.isBinary, true);
  assert.equal(result.bomDetected, false);
});

test('detectFileEncoding works with raw strings', () => {
  const result = PB.detectFileEncoding('plain ascii');
  assert.equal(result.encoding, 'utf-8');
  assert.equal(result.bomDetected, false);
  assert.equal(result.isBinary, false);
});

test('normalizeLineEndings converts mixed endings', () => {
  assert.equal(PB.normalizeLineEndings('a\nb\r\nc\rd'), 'a\nb\nc\nd');
  assert.equal(PB.normalizeLineEndings('a\nb\nc', 'crlf'), 'a\r\nb\r\nc');
  assert.equal(PB.normalizeLineEndings('a\r\nb\n', 'cr'), 'a\rb\r');
});

test('escapeRegExp escapes every regular expression metacharacter', () => {
  const raw = 'a.b*c+?[^]$(){}=!|\\';
  const escaped = PB.escapeRegExp(raw);
  assert.equal(new RegExp('^' + escaped + '$').test(raw), true);
  assert.equal(new RegExp('^' + escaped + '$').test('a.bc'), false);
});

test('scorePathMatch favours exact file stems over loose matches', () => {
  const exact = PB.scorePathMatch('app', 'src/app.js', 'app.js');
  const loose = PB.scorePathMatch('app', 'src/application.js', 'application.js');
  assert.ok(exact.score > loose.score);
  assert.deepEqual(exact.positions, [4, 5, 6]);
  assert.equal(PB.scorePathMatch('zzz', 'src/app.js', 'app.js'), null);
});

test('fuzzyMatchFiles orders by score, normalizes paths and honours limit', () => {
  const files = [
    'README.md',
    'src/apple.txt',
    { path: 'C:\\work\\src\\app.js', rel: 'src/app.js', name: 'app.js' },
    'src/App.css'
  ];
  const results = PB.fuzzyMatchFiles('app', files, 10);
  assert.equal(results.length, 3);
  assert.equal(results[0].rel, 'src/app.js');
  assert.equal(results[0].path, 'C:\\work\\src\\app.js');
  assert.ok(results[0].score > results[2].score);
  assert.equal(PB.fuzzyMatchFiles('app', files, 1).length, 1);
});

test('fuzzyMatchCommands preserves command objects and supports empty queries', () => {
  const commands = [
    { id: 'save', label: 'File: Save', key: 'Ctrl+S' },
    { id: 'saveAll', label: 'File: Save All', key: 'Ctrl+Alt+S' },
    { id: 'toggle', label: 'View: Toggle Panel' }
  ];
  const results = PB.fuzzyMatchCommands('save', commands);
  assert.deepEqual(results.map((c) => c.id), ['save', 'saveAll']);
  assert.equal(results[0].key, 'Ctrl+S');
  assert.equal(PB.fuzzyMatchCommands('', commands).length, 3);
  assert.equal(PB.fuzzyMatchCommands('zzz', commands).length, 0);
});

test('parseGitStatusPorcelain reports branch and per-file status codes', () => {
  const raw = [
    '## feature/login...origin/feature/login [ahead 2]',
    ' M src/app.js',
    '?? notes.txt',
    'A  staged.py',
    'R  old.js -> new.js',
    ' D gone.txt',
    ' M "dir/space file.txt"',
    ''
  ].join('\n');
  const status = PB.parseGitStatusPorcelain(raw);
  assert.equal(status.branch, 'feature/login');
  assert.deepEqual(status.files, {
    'src/app.js': 'M',
    'notes.txt': 'U',
    'staged.py': 'A',
    'new.js': 'R',
    'gone.txt': 'D',
    'dir/space file.txt': 'M'
  });
  assert.deepEqual(PB.parseGitStatusPorcelain('## No commits yet on main\n'), {
    branch: 'main', files: {}
  });
});

test('extractDocumentSymbols finds JavaScript declarations and methods', () => {
  const content = [
    'class Widget {',
    '  constructor() {}',
    '  render() {}',
    '}',
    'export async function loadData() {}',
    'const handler = async (event) => {};'
  ].join('\n');
  const symbols = PB.extractDocumentSymbols(content, '.js');
  assert.deepEqual(symbols.map((s) => [s.name, s.kind, s.line]), [
    ['Widget', 'class', 1],
    ['constructor', 'method', 2],
    ['render', 'method', 3],
    ['loadData', 'function', 5],
    ['handler', 'function', 6]
  ]);
});

test('extractDocumentSymbols finds Python and Markdown symbols', () => {
  const py = [
    'class Greeter:',
    '    def greet(self, name):',
    '        return name',
    '',
    'async def main():',
    '    pass'
  ].join('\n');
  const symbols = PB.extractDocumentSymbols(py, 'py');
  assert.deepEqual(symbols.map((s) => [s.name, s.kind, s.line, s.column]), [
    ['Greeter', 'class', 1, 7],
    ['greet', 'method', 2, 9],
    ['main', 'function', 5, 11]
  ]);

  const md = '# Title\n\n## **Section**\n';
  assert.deepEqual(
    PB.extractDocumentSymbols(md, 'md').map((s) => [s.name, s.kind, s.detail]),
    [['Title', 'heading', 'h1'], ['Section', 'heading', 'h2']]
  );
});

test('formatJsonText pretty-prints valid JSON and reports errors', () => {
  const ok = PB.formatJsonText('{"b":1,"a":[2]}', 2);
  assert.equal(ok.ok, true);
  assert.equal(ok.text, '{\n  "b": 1,\n  "a": [\n    2\n  ]\n}');
  const emptyIndent = PB.formatJsonText('{"a":1}', 0);
  assert.equal(emptyIndent.text, '{"a":1}');
  const bad = PB.formatJsonText('{nope');
  assert.equal(bad.ok, false);
  assert.ok(bad.error);
});

test('sortLines, dedupeLines and trimTrailingWhitespace preserve trailing newlines', () => {
  assert.equal(PB.sortLines('b\nA\nc\n'), 'A\nb\nc\n');
  assert.equal(PB.sortLines('b\nA\nc\n', { descending: true }), 'c\nb\nA\n');
  assert.equal(PB.sortLines('b\nA\nc\n', { caseSensitive: true }), 'A\nb\nc\n');
  assert.equal(PB.dedupeLines('a\na\nB\nb\n', { caseSensitive: false }), 'a\nB\n');
  assert.equal(PB.dedupeLines('a\na\nB\nb\n'), 'a\nB\nb\n');
  assert.equal(PB.trimTrailingWhitespace('a  \r\nb\t\nc '), 'a\r\nb\nc');
});

test('transformText applies named transforms and rejects unknown ids', () => {
  const sorted = PB.transformText('b\na\n', 'sort-lines');
  assert.deepEqual(sorted, { ok: true, text: 'a\nb\n', changed: true });
  assert.equal(PB.transformText('a\nb\n', 'trim-trailing-whitespace').changed, false);
  assert.equal(PB.transformText('{"a":1}', 'format-json').ok, true);
  assert.equal(PB.transformText('x', 'does-not-exist').ok, false);
});

test('applyCarriageReturns overwrites the current line for progress bars', () => {
  assert.equal(PB.applyCarriageReturns('', 'one\ntwo'), 'one\ntwo');
  assert.equal(
    PB.applyCarriageReturns('Progress: [█] 5%', '\rProgress: [██] 10%'),
    'Progress: [██] 10%'
  );
  // A shorter rewrite leaves the tail of the old line, exactly like a terminal.
  assert.equal(PB.applyCarriageReturns('Hello', '\rHi'), 'Hillo');
  // Incoming CRLF is normalised to a single newline.
  assert.equal(PB.applyCarriageReturns('a\r\nb', '\r\nc'), 'a\r\nb\nc');
  assert.equal(PB.applyCarriageReturns('x', ''), 'x');
  assert.equal(PB.applyCarriageReturns('done', '\nnext'), 'done\nnext');
});

test('parseDiagnostics extracts compiler diagnostics from text output', () => {
  const nodeErr = 'C:\\Users\\Rajesh\\Documents\\My Apps\\GitHub\\Code-Editor-IDE\\tests\\fixture\\run-input.js:1:0: Name?\nSyntaxError: Unexpected token "`"';
  const pyErr = 'File "C:\\path\\file.py", line 5:\n    x =\n    ^\n  SyntaxError: invalid syntax\nFile "C:\\path\\file2.py", line 3:\n    import os\n  ModuleNotFoundError: No module named \"os"\n';
  const gccErr = 'src/main.go:10:2: undefined: foo\n  cmdline: ./main.go:10:2: undefined: foo\n';

  var r1 = PB.parseDiagnostics(nodeErr);
  assert.ok(r1.some(function (d) { return d.message.indexOf('SyntaxError') !== -1; }));
  assert.ok(r1.some(function (d) { return d.file.indexOf('run-input.js') !== -1; }));
  assert.ok(r1.every(function (d) { return d.severity === 'error'; }));

  var r2 = PB.parseDiagnostics(pyErr);
  assert.equal(r2.length, 2);
  assert.equal(r2[0].file, 'C:\\path\\file.py');
  assert.equal(r2[0].line, 5);
  assert.ok(r2[0].message.indexOf('SyntaxError') !== -1);
  assert.equal(r2[1].file, 'C:\\path\\file2.py');
  assert.equal(r2[1].line, 3);

  var r3 = PB.parseDiagnostics(gccErr);
  assert.ok(r3.length >= 1);
  assert.ok(r3.some(function (d) { return d.file.indexOf('main.go') !== -1; }));
  assert.equal(r3[0].column, 2);
});

test('replaceInText supports case and whole-word options', () => {
  assert.deepEqual(
    PB.replaceInText('cat scatter Cat', 'cat', 'dog', { wholeWord: true }),
    { text: 'dog scatter dog', count: 2 }
  );
  assert.deepEqual(
    PB.replaceInText('cat Cat', 'cat', 'dog', { caseSensitive: true }),
    { text: 'dog Cat', count: 1 }
  );
  assert.deepEqual(PB.replaceInText('abc', '', 'x'), { text: 'abc', count: 0 });
});

test('defaultSession and sanitizeSession enforce the persisted schema', () => {
  assert.deepEqual(PB.defaultSession(), { version: 1, workspace: null, activeTab: null, tabs: [] });

  const session = PB.sanitizeSession({
    version: 9,
    workspace: 'C:\\work',
    activeTab: 'C:\\work\\a.js',
    tabs: [
      { path: 'C:\\work\\a.js', line: 3, column: 2, scrollTop: 40 },
      { path: 'C:\\work\\a.js', line: 9 },
      { path: '', line: 1 },
      { nope: true },
      { path: 'C:\\work\\b.js', line: -5, column: 'x', scrollTop: -2 }
    ]
  });
  assert.equal(session.version, 1);
  assert.equal(session.workspace, 'C:\\work');
  assert.equal(session.activeTab, 'C:\\work\\a.js');
  assert.deepEqual(session.tabs, [
    { path: 'C:\\work\\a.js', line: 3, column: 2, scrollTop: 40 },
    { path: 'C:\\work\\b.js', line: 1, column: 1, scrollTop: 0 }
  ]);
  assert.deepEqual(PB.sanitizeSession(null), PB.defaultSession());
  assert.deepEqual(PB.sanitizeSession('bad'), PB.defaultSession());
});

test('reorderKeys moves items without mutating the input', () => {
  assert.deepEqual(PB.reorderKeys(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  assert.deepEqual(PB.reorderKeys(['a', 'b', 'c'], 'a', 'c'), ['b', 'c', 'a']);
  const keys = ['a', 'b', 'c'];
  PB.reorderKeys(keys, 'c', 'a');
  assert.deepEqual(keys, ['a', 'b', 'c']);
  assert.deepEqual(PB.reorderKeys(['a', 'b'], 'z', 'a'), ['a', 'b']);
  assert.deepEqual(PB.reorderKeys([], 'a', 'b'), []);
});

test('parseGitHunks parses unified diff into hunks', () => {
  const diff = 'diff --git a/foo.js b/foo.js\n' +
    'index abc1234..def5678 100644\n' +
    '--- a/foo.js\n' +
    '+++ b/foo.js\n' +
    '@@ -1,3 +1,3 @@\n' +
    ' context line\n' +
    '+added line\n' +
    ' context line\n' +
    '-removed line\n' +
    '+added line2\n' +
    '--- a/bar.js\n' +
    '+++ b/bar.js\n' +
    '@@ -5,2 +5,3 @@\n' +
    ' context\n' +
    '+added\n' +
    '+added2\n';
  const hunks = PB.parseGitHunks(diff);
  assert.deepEqual(hunks.length, 2);
  assert.deepEqual(hunks[0].context, 'context line\ncontext line\n');
  assert.deepEqual(hunks[0].added, 'added line\nadded line2\n');
  assert.deepEqual(hunks[0].removed, 'removed line\n');
  assert.strictEqual(hunks[0].staged, false);
  assert.strictEqual(hunks[0].addedCount, 2);
  assert.strictEqual(hunks[0].removedCount, 1);
  assert.deepEqual(hunks[1].context, 'context\n');
  assert.deepEqual(hunks[1].added, 'added\nadded2\n');
  assert.strictEqual(hunks[1].addedCount, 2);
  assert.strictEqual(hunks[1].staged, false);
  assert.deepEqual(hunks[0].fileHeader, [
    'diff --git a/foo.js b/foo.js',
    'index abc1234..def5678 100644',
    '--- a/foo.js',
    '+++ b/foo.js'
  ]);
  assert.strictEqual(hunks[0].path, 'foo.js');
  assert.strictEqual(hunks[0].newStart, 1);
  assert.strictEqual(hunks[0].newLines, 3);
});

test('parseGitLog parses tab-separated commit records', () => {
  const text = 'abc1234def5678\tJohn Doe\tjohn@example.com\t2026-11-15T10:00:00Z\tfix the thing\n' +
    'fff1111eee2222\tJane\tjane@example.com\t2026-11-14T09:30:00Z\tadd helper\n';
  const commits = PB.parseGitLog(text);
  assert.deepEqual(commits.length, 2);
  assert.deepEqual(commits[0], {
    hash: 'abc1234def5678', shortHash: 'abc1234', author: 'John Doe', email: 'john@example.com', date: '2026-11-15T10:00:00Z', subject: 'fix the thing'
  });
  assert.deepEqual(commits[1].subject, 'add helper');
});

test('parseGitBlame builds line records from porcelain output', () => {
  const shaA = 'deadbeef00112233deadbeef00112233deadbeef';
  const shaB = '0123456789abcdef0123456789abcdef01234567';
  const text = shaA + ' 42 42\n' +
    'author Alice\n' +
    'author-mail <alice@example.com>\n' +
    'author-time 1725\n' +
    'committer-time 1725\n' +
    'summary some change\n' +
    'filename file.js\n' +
    '\tmodified line here\n' +
    shaB + ' 43 43\n' +
    'author Bob\n' +
    'author-mail <bob@example.com>\n' +
    'author-time 1726\n' +
    'committer-time 1726\n' +
    'summary def\n' +
    'filename file.js\n' +
    '\tdef\n';
  const records = PB.parseGitBlame(text);
  assert.equal(records.length, 2);
  assert.equal(records[0].author, 'Alice');
  assert.equal(records[0].authorMail, '<alice@example.com>');
  assert.equal(records[0].text, 'modified line here');
  assert.equal(records[0].origLine, 42);
  assert.equal(records[0].line, 42);
  assert.equal(records[1].author, 'Bob');
  assert.equal(records[1].text, 'def');
  assert.equal(records[1].origLine, 43);
  assert.equal(records[1].line, 43);
});

test('buildHunkPatch combines file header and hunk raw text', () => {
  const hunk = {
    fileHeader: ['diff --git a/foo.js b/foo.js', 'index abc1234..def5678 100644', '--- a/foo.js', '+++ b/foo.js'],
    raw: '@@ -1,3 +1,3 @@\n context line\n+added line\n'
  };
  const patch = PB.buildHunkPatch(hunk);
  assert.deepEqual(patch, 'diff --git a/foo.js b/foo.js\n' +
    'index abc1234..def5678 100644\n' +
    '--- a/foo.js\n' +
    '+++ b/foo.js\n' +
    '@@ -1,3 +1,3 @@\n' +
    ' context line\n' +
    '+added line\n');
});

test('utf8ByteLength counts multi-byte characters correctly', () => {
  assert.strictEqual(PB.utf8ByteLength(''), 0);
  assert.strictEqual(PB.utf8ByteLength('abc'), 3);
  assert.strictEqual(PB.utf8ByteLength('héllo'), 6); // é = 2 bytes
  assert.strictEqual(PB.utf8ByteLength('日本語'), 9); // 3 chars × 3 bytes
  assert.strictEqual(PB.utf8ByteLength('a😀b'), 6); // a=1 + 😀(4) + b=1
});

test('encodeLSPMessage produces valid LSP framing', () => {
  const framed = PB.encodeLSPMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.ok(framed.startsWith('Content-Length: '));
  assert.ok(framed.includes('\r\n\r\n'));
  const headerEnd = framed.indexOf('\r\n\r\n');
  const header = framed.slice(0, headerEnd);
  const body = framed.slice(headerEnd + 4);
  const m = header.match(/^Content-Length:\s*(\d+)$/);
  assert.ok(m, 'header must declare Content-Length');
  assert.strictEqual(Number(m[1]), Buffer.byteLength(body, 'utf8'));
  assert.deepStrictEqual(JSON.parse(body), { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
});

test('splitLSPMessages parses multiple frames and keeps partial tail', () => {
  const msg1 = PB.encodeLSPMessage({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } });
  const msg2 = PB.encodeLSPMessage({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'file:///a.js' } });
  const combined = msg1 + msg2;
  const parsed = PB.splitLSPMessages(combined);
  assert.strictEqual(parsed.messages.length, 2);
  assert.deepStrictEqual(parsed.messages[0], { jsonrpc: '2.0', id: 1, result: { capabilities: {} } });
  assert.deepStrictEqual(parsed.messages[1].method, 'textDocument/publishDiagnostics');
  assert.strictEqual(parsed.rest, '');

  // Partial body should remain in rest
  const partial = PB.splitLSPMessages(msg1.slice(0, msg1.length - 5));
  assert.strictEqual(partial.messages.length, 0);
  assert.strictEqual(partial.rest.length > 0, true);
});

test('lspMethodCapable detects supported methods in flat and nested capabilities', () => {
  assert.strictEqual(PB.lspMethodCapable({ textDocument: { completion: {} } }, 'textDocument/completion'), true);
  assert.strictEqual(PB.lspMethodCapable({ textDocument: { hover: {} } }, 'textDocument/hover'), true);
  assert.strictEqual(PB.lspMethodCapable({ textDocument: {} }, 'textDocument/completion'), false);
  assert.strictEqual(PB.lspMethodCapable({ 'textDocument/completion': {} }, 'textDocument/completion'), true);
  assert.strictEqual(PB.lspMethodCapable(null, 'textDocument/completion'), false);
});

test('toMonacoCompletionItem maps LSP fields to Monaco shape', () => {
  const item = PB.toMonacoCompletionItem({
    label: 'foo', kind: 2, documentation: 'A function', detail: 'fn()', filterText: 'fo', sortText: 'a'
  });
  assert.strictEqual(item.label, 'foo');
  assert.strictEqual(item.kind, 2);
  assert.strictEqual(item.documentation, 'A function');
  assert.strictEqual(item.detail, 'fn()');
  assert.strictEqual(item.filterText, 'fo');
  assert.strictEqual(item.sortText, 'a');
  assert.strictEqual(PB.toMonacoCompletionItem(null), null);
});

test('lspPositionToMonaco and monacoPositionToLSP convert positions both ways', () => {
  assert.deepStrictEqual(PB.lspPositionToMonaco({ line: 3, character: 7 }), { line: 3, column: 7 });
  assert.deepStrictEqual(PB.monacoPositionToLSP({ line: 3, column: 7 }), { line: 3, character: 7 });
  assert.deepStrictEqual(PB.lspPositionToMonaco(null), { line: 0, column: 0 });
  assert.deepStrictEqual(PB.monacoPositionToLSP(null), { line: 0, character: 0 });
});

test('toMonacoHover maps LSP hover to Monaco shape', () => {
  const hover = PB.toMonacoHover({ contents: [{ value: 'function foo()' }], range: { start: { line: 0, character: 0 } } });
  assert.deepStrictEqual(hover.contents, [{ value: 'function foo()' }]);
  assert.deepStrictEqual(hover.range, { start: { line: 0, character: 0 } });
  assert.deepStrictEqual(PB.toMonacoHover(null), { contents: [] });
});

test('toMonacoLocation maps LSP location uri to string', () => {
  const loc = PB.toMonacoLocation({ uri: { uri: 'file:///a.js' }, range: { start: { line: 1 } } });
  assert.strictEqual(loc.uri, 'file:///a.js');
  assert.deepStrictEqual(loc.range, { start: { line: 1 } });
  assert.strictEqual(PB.toMonacoLocation(null), null);
});

test('createLspClient correlates requests and parses streamed responses', () => {
  const sent = [];
  const client = PB.createLspClient({ write: (s) => sent.push(s) });

  // Fire request (id auto-incremented)
  client.request('textDocument/hover', { position: { line: 0, character: 0 } });

  // Simulate server reply
  const reply = PB.encodeLSPMessage({ jsonrpc: '2.0', id: 1, result: { contents: [{ value: 'hi' }] } });
  client.onData(reply);

  assert.strictEqual(sent.length, 1);
  assert.ok(sent[0].startsWith('Content-Length: '));
  const body = JSON.parse(sent[0].split('\r\n\r\n')[1]);
  assert.strictEqual(body.method, 'textDocument/hover');
  assert.strictEqual(body.id, 1);
  assert.strictEqual(client.pendingCount(), 0);
});

test('createLspClient handles error responses in notification dispatch', () => {
  const client = PB.createLspClient({ write: () => {} });
  client.request('textDocument/definition', {}).catch(() => {});
  const errorReply = PB.encodeLSPMessage({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } });
  client.onData(errorReply);
  assert.strictEqual(client.pendingCount(), 0);
});

test('createLspClient rejects requests on error responses', async () => {
  const client = PB.createLspClient({ write: () => {} });
  const p = client.request('textDocument/definition', {});
  client.onData(PB.encodeLSPMessage({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }));
  const err = await p.then(() => null, (e) => e);
  assert.ok(err instanceof Error);
  assert.strictEqual(err.message, 'Method not found');
});
