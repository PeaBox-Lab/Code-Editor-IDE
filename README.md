# PeaBox IDE v0.14.3 - Tested Python Analysis

This release restores one advanced capability at a time: bundled Python static analysis through Pyright. It does not reintroduce the previous untested multi-language LSP layer.

## Working features added
- Analyze the current Python file
- Analyze the complete Python project
- Problems panel with errors and warnings
- Click a diagnostic to open the exact file, line and column
- Python class/function Outline
- Click Outline entries to navigate
- Python analysis status in the status bar
- Bundled Pyright, so users do not separately install it
- Automated analysis test containing a known type error

## Shortcuts
- `Ctrl+Shift+A`: analyze current Python file
- `Ctrl+Shift+M`: show Problems

## Testing
On Windows, run `npm test`. The test pipeline runs static validation, core tests, a real Pyright analysis test, and the Electron feature test.

## Scope
Semantic autocomplete, hover, rename, references, DAP debugging and Test Explorer remain withheld until each receives dedicated end-to-end coverage.
