# PeaBox IDE v0.12.1 - Developer Experience

A usability and product-hardening release focused on the workflows developers use every day.

## For users
Download the Windows release ZIP, extract it, and double-click `PeaBox IDE.exe`. No Node.js, npm, installer, administrator rights, or PATH changes are required for the packaged release.

## Highlights
- Streamlined Explorer, Search, Source Control and Run/Debug navigation
- Collapsible project tree with useful file icons
- Working tabs, dirty markers, close protection and session restore
- Quick Open with `Ctrl+P`
- Project search with clickable file and line results
- New file and folder actions
- Terminal, Problems, Output and Debug Console bottom-panel tabs
- Run current Python, JavaScript, Go and Rust files
- Git branch/status, stage, discard, diff, commit, pull and push workflows
- Environment health view for Python, Git, Go, Rust and clangd
- Persistent recent projects, theme, workspace and open files
- Consolidated generic LSP Manager; removed the duplicate Python-only client
- Existing DAP debugging, Markdown preview, split editors and Monaco editing retained

## Source development
Contributors need Node.js and npm only for source development and packaging:

```bat
START_PEABOX_IDE.bat
```

Build the portable Windows release with:

```bat
build-release.bat
```

The generated end-user artifacts are placed in `dist`.

## Optional developer tools
PeaBox itself launches without these tools. Individual workflows may use Python, Git, Go, Rust, debugpy, gopls, rust-analyzer or clangd. The Environment view shows what is available.

## If the window does not open

Run `CHECK_PEABOX.bat`, then inspect `peabox-startup.log`. The launcher now remains visible and reports missing Node, failed dependency installation, or Electron startup errors instead of closing silently.
