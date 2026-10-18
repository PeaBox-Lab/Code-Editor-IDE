# PeaBox IDE v0.7 — Developer Intelligence

## New in v0.7
- Always-on Pyright language server over JSON-RPC/LSP
- Semantic Python completion while typing
- Hover documentation and inferred types
- Go to Definition (`F12`)
- Find References (`Shift+F12`)
- Semantic project rename (`F2`)
- Live diagnostics as files change
- Quick Fix / Code Actions from Pyright where available
- Semantic Python Outline panel
- Language-server status in the status bar

## Existing strengths retained
Project-wide Pyright and TypeScript checks, project symbols, terminal, Git workflow, command palette, recent projects, session restoration, settings, autosave, project search, Monaco editor, no-admin setup, portable EXE/ZIP packaging.

## Install without admin rights
Extract the ZIP and double-click `setup-peabox-ide.bat`. The setup detects portable Node in a local `node` folder, your existing helpers path, or PATH. Later use `run-peabox-ide.bat`.

## Package for end users
Double-click `build-portable-exe.bat`. The `dist` folder receives the portable EXE and ZIP. End users of the packaged build do not need Node or npm. Building may require internet access for Electron packaging assets.

## Current scope
The live LSP client is focused on Python/Pyright. JavaScript and TypeScript continue to use Monaco's built-in language services plus project-wide `tsc` checks. Workspace edits are applied through Monaco; files involved in cross-file rename should be opened by Monaco when the edit is applied. A future release can add a generalized LSP registry for more languages.
