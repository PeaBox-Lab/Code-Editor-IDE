# PeaBox IDE v0.11 — Multi-language Intelligence

PeaBox now includes a reusable multi-process LSP Manager instead of treating Python as the IDE architecture.

## Language integrations
- Python: bundled Pyright language server
- Go: `gopls` when installed and on PATH
- Rust: `rust-analyzer` when installed and on PATH
- C/C++: `clangd` when installed and on PATH

## Shared LSP capabilities
For servers that implement them, PeaBox registers the same generic editor integrations: completion, hover, go to definition, references, rename, diagnostics and code actions. Each language server runs as a separate stdio JSON-RPC process with its own lifecycle, pending-request map and document synchronization.

## Language Intelligence view
Use the new `{ }` activity-bar entry to see which language servers PeaBox detects. Python/Pyright is bundled. External servers are started on demand when a matching source file is opened.

## Check your machine
Run `check-language-servers.bat` to see whether `gopls`, `rust-analyzer` and `clangd` are callable from PATH. Missing servers do not prevent PeaBox from running.

## Existing features retained
Python DAP debugging, breakpoints, call stack, variables, watches, Debug Console, visual Git diff, Source Control, split editors, project dashboard, run profiles, Markdown preview, themes, terminal and menu bar.

## Install
Run `setup-peabox-ide.bat`; later use `run-peabox-ide.bat`.
