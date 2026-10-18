# PeaBox IDE v0.2

A lightweight desktop IDE focused on useful local coding. No AI, accounts, telemetry, cloud sync, extension marketplace, or admin installation.

## What is included

- Multi-tab Monaco editor with unsaved indicators
- Syntax highlighting for common development languages
- Project explorer with folder-first sorting
- Create file and folder, rename from explorer context menu
- Save and Save All
- Project-wide text search with line navigation
- Quick Open with `Ctrl+P`
- Run/stop local commands with an output panel
- Status bar with cursor position and language
- Keyboard shortcuts and welcome screen
- Portable Node detection
- One-click dependency setup and launch
- Portable EXE build configuration

## Fastest start on your computer

Double-click `install-and-run.bat`.

It automatically looks for portable Node at:

`%USERPROFILE%\Downloads\Apps\helpers\1\node`

You can alternatively create a `node` folder inside PeaBox IDE and extract portable Node there.

On the first launch the script installs dependencies. Later, double-click `run-peabox-ide.bat`.

## Build a portable EXE

Double-click `build-portable-exe.bat`. The result is written to `dist`.

## Security

The Run panel executes shell commands on the local machine inside the opened project folder. Only open and run trusted projects.

## Known v0.2 limitations

The output area is a command output panel, not yet a fully interactive PTY terminal. Debug adapters, Git UI, language servers, autocomplete beyond Monaco defaults, package managers, and extensions are intentionally not part of this version.
