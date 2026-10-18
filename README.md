# PeaBox IDE v0.3

A lightweight, local desktop development environment. No AI, accounts, telemetry, or cloud requirement in the editor itself.

## Developer features
- Monaco multi-tab editor with syntax highlighting, minimap, bracket coloring and built-in editor commands
- Project explorer; create files/folders; rename files
- Project-wide search with jump-to-line
- Quick Open (`Ctrl+P`)
- Save / Save All with dirty-tab indicators
- Format Document (`Alt+Shift+F`) where Monaco has a formatter registered
- Toggle line comments (`Ctrl+/`)
- Run/stop commands in the workspace with output and exit code
- Basic Git source-control panel: branch/status and unstaged diff, using the system Git executable
- Sidebar toggle (`Ctrl+B`)
- Portable Node auto-detection
- One-click setup/run BAT files
- electron-builder portable Windows EXE configuration

## Run without admin rights
Double-click `install-and-run.bat`. On this machine it automatically checks `%USERPROFILE%\\Downloads\\Apps\\helpers\\1\\node`. Alternatively put portable Node in `node` beside the BAT file.

Later launches: `run-peabox-ide.bat`.

## Portable Windows build
Double-click `build-portable-exe.bat`; output goes to `dist`.

## Notes
Git features require `git` to be callable on the machine. Format Document depends on a formatter being available for the current Monaco language. The output runner is not yet a fully interactive PTY terminal.
