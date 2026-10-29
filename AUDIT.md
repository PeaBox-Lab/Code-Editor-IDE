# PeaBox IDE v0.14 Working Core Audit

## Fixed in v0.14.1

- **No integrated terminal:** added xterm.js with node-pty. Windows uses ConPTY.
- **Background Git status polluted the Run output and shared the runner lock:** Git now uses a quiet background process.
- **Atomic save could fail to replace an existing file on Windows:** replaced the custom rename implementation with `write-file-atomic`.
- **New File before opening a project called refresh with a null folder:** now opens the created file without refreshing a nonexistent project.
- **Saved Settings were not reflected in the controls after startup:** controls now initialize from persisted state.
- **Output and Terminal had no panel selection model:** added separate Terminal and Output tabs.
- **No launch or feature automation:** added Playwright Electron E2E coverage.
- **No unit check for save behavior and required terminal dependencies:** added core tests.

## Remaining limitations, visible and intentional

- Git UI stages a file on click; it still lacks unstage, discard, branches, stash and merge-conflict resolution.
- Run Current File still uses command strings and PATH runtimes. A runtime picker is not yet implemented.
- Explorer recursively loads the project and may be slow for very large repositories.
- No external file-change watcher or unsaved-crash recovery in this rebuilt core.
- No language-server intelligence, debugger, testing panel, extension system or multi-root workspaces. These were removed because the previous implementations were not consistently functional.
- The source terminal requires node-pty to install successfully. The Windows GitHub build supplies the native build environment; end users of the packaged EXE do not compile it.

## Release gates

A release is accepted only after `npm test` passes on Windows and the packaged EXE is manually smoke-tested without Node/npm installed.
