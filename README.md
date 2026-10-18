# PeaBox IDE v0.10 — Debugging

PeaBox now has a generic Debug Adapter Protocol client and a Python debugging integration using `debugpy`.

## New
- Python debugger
- Editor breakpoints: click the glyph margin or press F9
- Call Stack panel
- Variables/scopes panel
- Watch expressions
- Debug Console with expression evaluation
- Continue (`F5`)
- Step Over (`F10`)
- Step Into (`F11`)
- Step Out (`Shift+F11`)
- Stop (`Shift+F5`)
- Pause control
- Debug status indicator
- DAP request/response/event transport separated from the Python adapter

## Python debugger prerequisite
The Python interpreter used for the project must have `debugpy` available. Run `setup-python-debugger.bat`, or install it into the project's Python environment yourself. The IDE invokes Python as `python` in this release.

## Architecture
PeaBox speaks Debug Adapter Protocol messages to the adapter. The current adapter is debugpy, but the UI and transport are intentionally generic around DAP operations such as initialize, breakpoints, stackTrace, scopes, variables, evaluate and stepping.

## Existing features retained
Visual Git diff, Source Control, split editors, dashboard, run profiles, Markdown preview, enhanced Explorer, Pyright LSP, themes, terminal and menu bar.

## Install PeaBox
Run `setup-peabox-ide.bat`; later launches use `run-peabox-ide.bat`.
