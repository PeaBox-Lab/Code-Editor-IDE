# PeaBox IDE v0.15.0

A fast, local-first desktop code editor built with Electron. PeaBox focuses on the
everyday loop: open a folder, edit, search, review Git changes, run code, and use a
real terminal — without sending your source anywhere.

## Highlights

- **Editor** — Monaco (the VS Code editor engine) with custom dark/light themes,
  syntax highlighting for 40+ languages, bracket-pair colouring, minimap, word wrap,
  adjustable font and tab size.
- **Explorer** — lazy-loaded folder tree. Large folders open instantly and only
  expanded directories are read. Right-click for new file/folder, rename, delete,
  copy path and reveal in Explorer.
- **Search** — async, chunked full-text search with match-case and whole-word
  options, grouped results, highlighted snippets, and click-to-jump to line/column.
- **Quick open & command palette** — `Ctrl+P` fuzzy-searches every file in the
  workspace; `Ctrl+Shift+P` runs any command.
- **Source control** — branch switching and creation, staged/unstaged sections,
  per-file stage/unstage/discard, diff viewer, commit, pull, push, stash and pop.
  Git runs through argument arrays with `shell: false` and no interactive prompts.
- **Run panel** — F5 runs the current Python, Node, Go, PowerShell or shell file
  with configurable runtimes. Output streams live; Shift+F5 stops the process tree.
- **Terminal** — multiple xterm.js sessions backed by node-pty/ConPTY with tabs,
  resize handling and automatic fit. The shipped prebuilt node-pty binary is
  verified against the bundled Electron runtime, so no C++ toolchain is needed.
- **Recovery** — unsaved buffers are written to a recovery folder as you type and
  offered back after a crash or forced exit.
- **Session restore** — reopens the last workspace and the files you had open.
- **Settings** — theme, typography, tabs, wrapping, minimap, auto-save, terminal
  shell, runtime paths (with a "Check" button), and search exclusions.
- **Polished UI** — resizable sidebar and panel, status bar, breadcrumbs, toasts,
  custom modals (no unsupported `window.prompt`), keyboard-navigable context menus,
  light/dark themes, reduced-motion support.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Quick open files | `Ctrl+P` |
| Command palette | `Ctrl+Shift+P` |
| Open folder | `Ctrl+O` |
| Open file | `Ctrl+Shift+O` |
| New file | `Ctrl+N` |
| Save / Save all | `Ctrl+S` / `Ctrl+Alt+S` |
| Close editor | `Ctrl+W` |
| Toggle sidebar | `Ctrl+B` |
| Toggle panel | `Ctrl+J` |
| Toggle terminal | ``Ctrl+` `` |
| Explorer / Search / Git | `Ctrl+Shift+E` / `F` / `G` |
| Find / Replace / Go to line | `Ctrl+F` / `Ctrl+H` / `Ctrl+G` |
| Editor font size up / down / reset | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Run / Stop | `F5` / `Shift+F5` |
| Settings | `Ctrl+,` |

## Requirements

- Windows 10/11 (current target), Node.js 20+ and npm 10+.
- `node-pty` ships a prebuilt binary for win32-x64 that is verified against the
  bundled Electron 38 runtime; no C++ toolchain is required. `tools/postinstall.js`
  checks the prebuilt binary first and only falls back to a source rebuild (then a
  non-fatal warning) if it cannot load.

## Development

```bat
npm install
npm start
```

Useful scripts:

```bat
npm run validate     :: static checks: syntax, DOM ids, icons, IPC, security
npm run test:unit    :: node:test unit suite for shared.js
npm run test:e2e     :: Playwright Electron smoke test
npm run build        :: validate + unit tests + portable/zip artifacts in dist/
```

`BUILD_WINDOWS.bat` and `START_SOURCE.bat` wrap the same commands and locate Node
on `PATH` (or in a local `node\` folder).

## Project layout

| File | Purpose |
| --- | --- |
| `main.js` | Electron main process: windows, persistence, IPC, filesystem, Git, runtimes, terminals, recovery. |
| `preload.js` | Context-isolated bridge exposing a small namespaced `window.api`. |
| `renderer.js` | The editor UI (plain classic script; Monaco/xterm are loaded first). |
| `shared.js` | Dependency-free UMD helpers used by main, renderer and tests. |
| `index.html` / `style.css` | Markup, icon sprite and the design system. |
| `tests/unit.test.js` | Unit coverage for the shared helpers. |
| `tests/electron.spec.js` | End-to-end smoke test, including nested-folder regression. |

## Data and safety

- App state and recovery data live under Electron's `userData` folder:
  `%APPDATA%\peabox-ide` for installed builds, or a `PeaBox-IDE-Data` folder next
  to a portable executable.
- Every renderer-supplied path is resolved with `realpath` and checked against the
  open workspace roots. Symlinks cannot escape a root.
- The renderer runs sandboxed with context isolation, a strict CSP, blocked
  navigation/`window.open`, denied permission requests, no `nodeIntegration` and no
  raw IPC channel names.
- Saves are atomic (`write-file-atomic`) and files over 50 MB, or binary/oversized
  reads, are refused with a clear message.

## Troubleshooting

- **Terminal says node-pty could not be loaded** — the prebuilt binary does not
  match this Electron version. Install "Desktop development with C++" from the
  Visual Studio Build Tools, then run `npx electron-builder install-app-deps` and
  restart. The editor, search, Git and run panel work without it.
- **`npm install` prints a native rebuild warning** — the prebuilt binary did not
  load and a source rebuild was attempted. Installation still succeeds; only the
  terminal is affected.
- **Editor is blank** — run `npm install` again so `monaco-editor` and `@xterm/*`
  are present, then restart.
- **Git commands time out** — check that Git is installed and on `PATH`, and that
  credentials are configured for non-interactive use (PeaBox disables prompts).
