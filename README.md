# PeaBox IDE v0.4

A lightweight local IDE with five major usability upgrades.

## v0.4 features
- Persistent interactive shell panel using xterm.js and a local PowerShell/CMD process
- Git stage, unstage, discard, commit, pull, push, branch listing/switching, status and diff
- Command Palette (`Ctrl+Shift+P`)
- Recent projects and restoration of the last workspace, open tabs and active file
- Settings for autosave, format-on-save, font size, minimap, word wrap and terminal shell

Also retained: Monaco tabs, project explorer, search, quick editing, run/output, syntax highlighting and portable packaging.

## Install and run without admin rights
1. Extract the ZIP.
2. Double-click `install-and-run.bat`.
3. Later, double-click `run-peabox-ide.bat`.

The launcher checks your portable Node path under `%USERPROFILE%\Downloads\Apps\helpers\1\node`, or a `node` folder beside the application.

## Build a portable EXE
Double-click `build-portable-exe.bat`. Output goes to `dist`.

## Notes
- Git actions require Git to be available on PATH.
- The shell is persistent and accepts keyboard input, but this version uses standard process pipes rather than a native Windows pseudoterminal binding. Most ordinary PowerShell/CMD commands work; full-screen console programs may not render correctly.
- Review changes before using discard, pull, push or branch switching.
