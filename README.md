# PeaBox IDE v0.14.0 - Reliable Core Rebuild

This release is a clean rebuild. It deliberately removes unfinished LSP, DAP, testing, task, workspace-trust and recovery interfaces from the visible product until they are implemented and tested end to end.

## Working scope

- Open and refresh a project folder
- Collapsible Explorer
- Create, rename and delete files
- Multi-tab Monaco editor
- Syntax highlighting for common languages
- Atomic file save
- Save All and dirty-file warnings
- Project-wide text search
- Run current Python, JavaScript or Go file
- Command output and process stop
- Git status, stage and commit
- Light/dark theme
- Font size and Auto Save
- Recent projects and session restoration
- Native desktop menu and keyboard shortcuts
- Portable Windows EXE/ZIP build

## Source run

Double-click `START_SOURCE.bat`.

## Portable Windows build

Double-click `BUILD_WINDOWS.bat`, or run the GitHub Actions workflow. End users of the resulting EXE do not need Node.js or npm.

## Design rule

A feature is not shown in PeaBox unless its main workflow is wired and validated. Advanced language intelligence, debugging and testing will return incrementally after automated Electron tests are added.
