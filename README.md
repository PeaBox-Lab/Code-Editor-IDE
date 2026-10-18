# PeaBox IDE v0.6

## New
- Project-wide Python type checking through Pyright JSON diagnostics
- Project-wide TypeScript/JavaScript checking through `tsc --noEmit` when a `tsconfig.json` exists
- Unified project Problems panel with file/line navigation
- Project symbol index across Python, JS, TS, Java, Go, Rust, C# and C/C++
- Project symbol search from the Command Palette
- Textual project reference search for the symbol under the cursor
- Improved admin-free setup with portable Node auto-detection and clearer error handling
- Portable Windows EXE plus ZIP packaging
- Portable settings stored beside the packaged executable

## Install without admin rights
Extract the source ZIP and double-click `setup-peabox-ide.bat`. It detects Node in a local `node` folder, the user's existing helper path, or PATH. Later use `run-peabox-ide.bat`.

## Type checking
Use **Check Project** in the toolbar or the Problems sidebar. Python projects can add `pyrightconfig.json`; `pyrightconfig.sample.json` is included. JS/TS projects should include `tsconfig.json`.

## Navigation
- `Ctrl+Shift+O`: project symbols
- `Ctrl+Shift+R`: textual references for the word under the cursor
- `Ctrl+G`: go to line
- `F12`: Monaco definition navigation where its language service supports it

## Portable package
Run `build-portable-exe.bat`. Distributables appear in `dist`. The packaged application includes its runtime and IDE dependencies; end users do not install Node/npm. Building requires internet access for packaging artifacts. See `PORTABLE.md`.

## Scope
Pyright provides real project-level Python static analysis. The code-navigation index is local and language-agnostic, but reference search is textual rather than semantic. A future always-on language-server client would be required for fully semantic cross-file completion, rename and references.
