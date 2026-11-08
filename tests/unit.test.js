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
