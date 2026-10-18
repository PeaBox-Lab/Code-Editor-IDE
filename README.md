# PeaBox IDE

A deliberately small desktop coding IDE. No AI, accounts, telemetry, marketplace, debugger, Git UI or cloud services in v0.1.

## Features
- Open a local project folder
- Explorer tree
- Monaco code editor with syntax highlighting
- Create/open/edit/save files
- Ctrl+S
- Command runner/output panel
- Dark desktop UI

## Run
1. Install a current Node.js release.
2. Open a terminal in this folder.
3. `npm install`
4. `npm start`

Commands entered in Run execute on your local machine in the opened project directory. Only run code you trust.

## Architecture
Electron main process owns filesystem/dialog/process access. The renderer receives a limited API through the preload context bridge. Monaco provides editing.

## Suggested next iterations
Tabs, find/replace, integrated PTY terminal, Git status/commit, settings, keyboard shortcut editor, project search, language-server support, debugger, packaging.
