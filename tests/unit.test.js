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
