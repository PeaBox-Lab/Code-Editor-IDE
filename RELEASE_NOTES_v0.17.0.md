# PeaBox IDE v0.17.0 — Release Notes

**Release Date:** 2026-11-14

## Overview

PeaBox IDE v0.17.0 is a workflow release focused on moving around large projects
and protecting work in progress. It unifies file, command and symbol navigation in
one palette, restores the full editing session on launch, detects changes made
outside the editor, and adds preview-first replace in files. Existing features and
v0.16.0 user data remain compatible.

## What's New

### 1. Unified Quick Open, Commands and Symbols

- `Ctrl+P` opens fuzzy file search across the workspace.
- `Ctrl+Shift+P` opens the command palette.
- `Ctrl+Shift+O` lists symbols in the active document and jumps to the selected line.
- The palette switches modes inline: start a query with `>` for commands or `@` for
  symbols.
- ArrowUp/ArrowDown move the selection, Enter accepts, and Escape closes.
- Symbols are extracted locally for JavaScript/TypeScript, Python, Markdown, HTML and
  CSS without touching a language server.
- **Open File** moved to `Ctrl+Alt+O` so `Ctrl+Shift+O` can be the standard symbol
  outline shortcut. The File menu and command palette reflect the new binding.

### 2. Full Session Persistence

- New `session:load` / `session:save` IPC handlers persist a dedicated
  `userData/session.json`.
- Restores the workspace, open tabs, active tab, cursor line/column and scroll offset.
- Session saves are debounced while editing and flushed on window focus, `beforeunload`
  and the normal close flow.
- A folder or file passed on the command line opens directly; file arguments are added
  to the allowed-path set before the renderer starts.
- Falls back to the existing `state.json` last-folder/open-files data when no hot-exit
  session exists.

### 3. External Change Protection

- Expanded disk watching now covers focus regained after editing in another program.
- Clean buffers reload automatically when the on-disk `mtime` changes.
- Dirty buffers are kept and flagged; saving opens a choice between **Reload from
  Disk**, **Overwrite**, or **Cancel**.
- Deleted files are marked in their tab instead of silently failing on save.
- The new `fs:stat` bridge returns existence, size and high-resolution `mtimeMs`.

### 4. Replace in Files

- `Ctrl+Shift+H`, the Search panel toggle, or **Search: Replace in Files…** opens the
  replace row.
- Replacements are previewed first: total matches, affected files and per-file counts.
- Supports the existing match-case, whole-word and search-exclusion settings.
- Applies changes atomically, skips binary and files over 2 MB, caps a pass at 500
  files, then reloads clean tabs and refreshes search/Git state.
- The new `workspace:replace` handler defaults to a dry run; writes only happen after
  explicit confirmation.

### 5. Faster Git Status and Explorer Badges

- `git:status` now runs `git status --porcelain=v1 -b` through `execFile` with a
  3000 ms timeout, `windowsHide` and a bounded buffer.
- A new `PB.parseGitStatusPorcelain` helper extracts the branch and per-file status
  codes without shell parsing.
- Changed, added, deleted, renamed and untracked files show compact badges in the
  Explorer tree; the status bar continues to show the branch and change count.
- The detailed `-z` status remains available for stage/unstage/diff actions.

### 6. Text Transforms and Small Commands

- Format JSON, sort lines ascending, remove duplicate lines, and trim trailing
  whitespace from the command palette.
- Toggle word wrap from the palette.
- All transforms use Monaco undo stacks, so they can be reverted with `Ctrl+Z`.

### 7. Interactive Run Input

- The Run panel now starts programs with a writable stdin pipe instead of an
  immediately closed input stream.
- When a program calls `input()`, `readline` or another stdin read, an **Input** bar
  appears below the Output panel. Enter forwards the line to the process and keeps
  the bar available for further reads.
- This fixes `EOFError: EOF when reading a line` for Python scripts that prompt for
  input, and works for Node, Go, PowerShell and shell programs too.
- The new `run:input` IPC handler writes only to the currently running process and
  caps a single submission at 64 KB.
- Python runs are launched with `PYTHONIOENCODING=utf-8`, `PYTHONUTF8=1` and
  `PYTHONUNBUFFERED=1`, fixing `UnicodeEncodeError: 'charmap' codec can't encode
  character '\u2588'` when a script prints box-drawing characters or emoji.
- stdout/stderr are decoded with a stateful UTF-8 decoder, so multi-byte characters
  split across chunks are never corrupted.
- Carriage-return updates are rendered like a terminal: a `\r` rewrites the current
  line, so progress bars animate in place instead of appending a line per update.

## Pure Logic Added to `shared.js`

- `fuzzyMatchFiles`, `fuzzyMatchCommands`, `scorePathMatch`, `escapeRegExp`
- `parseGitStatusPorcelain`
- `extractDocumentSymbols`
- `formatJsonText`, `sortLines`, `dedupeLines`, `trimTrailingWhitespace`
- `transformText`, `replaceInText`
- `defaultSession`, `sanitizeSession`

## Quality

- **32 unit tests** (up from 20), covering fuzzy matching, path scoring, symbol
  extraction, Git porcelain parsing, text transforms, literal replacement and session
  sanitisation.
- **E2E smoke test** passing, now including quick open, symbol jump and interactive
  run input in addition to boot, nested folders, editor, search, theme, settings,
  palette, file create/save, open file and the live terminal.
- **Validation** passing: 125 DOM ids, 36 icons, 61 IPC handlers, with syntax, icon,
  DOM and IPC parity checks.

## Security and Compatibility

- No build step was added: the app still runs with `electron .` and
  `BUILD_WINDOWS.bat`.
- Renderer isolation is unchanged: `contextIsolation: true`, `nodeIntegration: false`,
  sandboxed renderer, strict CSP, and path-sanitized IPC.
- All new IPC channels are additive; existing renderer callers keep working.
- `state.json` remains compatible. The new `session.json` is sanitised before writing
  and reading, and stale paths are skipped.
- Git continues to run with argument arrays and no interactive prompts.

## Known Limitations

- Symbol extraction is heuristic and line-based; it is not a full language server.
- `fs.watch(..., { recursive: true })` remains Windows/macOS-only, so other platforms
  rely on the focus-time `mtime` check.
- Replace in files skips binary files, files over 2 MB, and stops after 500 files.
- Git operations require configured non-interactive credentials.
- node-pty requires the Win32-x64 prebuilt (or a C++ toolchain fallback).

## Upgrade Path

1. Back up `%APPDATA%\peabox-ide\state.json`, `session.json` and `recovery/`.
2. Uninstall v0.16.0 (keep userData).
3. Install v0.17.0.
4. Launch — the last workspace, tabs, cursor positions and settings are restored.

## Artifacts

- `PeaBox-IDE-0.17.0-Windows-x64.exe` (portable)
- `PeaBox-IDE-0.17.0-Windows-x64.zip`
