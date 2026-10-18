# PeaBox IDE

**A lightweight, local-first development environment for developers who want the essentials without the clutter.**

PeaBox IDE combines the Monaco editing experience with multi-language LSP intelligence, DAP-based debugging, Git workflows, an integrated terminal, project tools, and portable Windows deployment.

It is designed around a simple principle:

> A good IDE should be useful before AI enters the picture.

PeaBox IDE focuses first on coding, navigation, debugging, source control, and developer productivity. AI capabilities can remain an optional layer rather than a requirement.

## Features

### Code Editing
- Monaco-powered code editor
- Multi-tab editing
- Split editors
- Syntax highlighting
- Project-wide search
- Command palette
- Symbols and code navigation
- Light and dark themes

### Multi-Language Intelligence
- Reusable Language Server Protocol (LSP) Manager
- Python intelligence using bundled Pyright
- Go support through gopls
- Rust support through rust-analyzer
- C/C++ support through clangd
- Semantic autocomplete
- Hover information
- Go to Definition
- Find References
- Rename Symbol
- Live diagnostics
- Code Actions

### Debugging
- Debug Adapter Protocol (DAP) architecture
- Python debugging through debugpy
- Breakpoints
- Call stack
- Variables and scopes
- Watch expressions
- Debug Console
- Continue
- Step Over
- Step Into
- Step Out
- Pause and Stop

### Source Control
- Git status
- Stage and unstage changes
- Commit
- Pull and push
- Branch switching
- Recent commit history
- Visual side-by-side Git diff

### Developer Workflow
- Integrated terminal
- Project Dashboard
- Run profiles
- Project type detection
- Problems panel
- Outline
- Enhanced Explorer
- Markdown preview
- Recent projects
- Session restoration

### Portable Development
- No-admin development setup
- Portable Node.js support
- Portable Windows executable builds
- ZIP distribution



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

## Installation

PeaBox IDE can be used as a portable Windows application or run directly from the source code.

### Option 1: Portable Windows Build

The portable build is the recommended option for regular users.

1. Open the repository’s **Releases** page.
2. Download one of the following:
   - `PeaBox-IDE-0.11.0-x64.exe`
   - `PeaBox-IDE-0.11.0-x64.zip`
3. If you downloaded the ZIP package, extract it to a folder.
4. Launch PeaBox IDE.

The packaged application includes its desktop runtime and IDE dependencies. Users do not need to install Node.js or npm separately.

> PeaBox IDE is currently distributed as an unsigned application. Windows SmartScreen may display a warning when launching the portable executable.

---

### Option 2: Run from Source

#### Requirements

- Windows 10 or Windows 11
- Node.js and npm
- Git, recommended
- Python, required for Python development and debugging

Clone the repository:

```powershell
git clone https://github.com/YOUR-USERNAME/peabox-ide.git
cd peabox-ide
```

Run the setup script:

```text
setup-peabox-ide.bat
```

The setup script will:

1. Detect Node.js
2. Install the required dependencies
3. Start PeaBox IDE

For later launches, use:

```text
run-peabox-ide.bat
```

---

### No-Admin Installation

PeaBox IDE supports a portable Node.js runtime, making it suitable for Windows computers where administrator access is unavailable.

Download the Windows x64 ZIP version of Node.js and extract it into a folder named `node` inside the PeaBox IDE directory:

```text
peabox-ide/
├── node/
│   ├── node.exe
│   ├── npm.cmd
│   ├── npx.cmd
│   └── node_modules/
├── setup-peabox-ide.bat
├── run-peabox-ide.bat
└── package.json
```

Then run:

```text
setup-peabox-ide.bat
```

No system-wide Node.js installation or permanent PATH modification is required.

---

## Python Debugging Setup

PeaBox IDE uses `debugpy` as its Python Debug Adapter Protocol implementation.

The Python environment used by the project must have `debugpy` installed.

Run the included helper:

```text
setup-python-debugger.bat
```

Alternatively, install it manually:

```powershell
python -m pip install --user debugpy
```

If the project uses a virtual environment, activate it before installing `debugpy`:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install debugpy
```

### Debugging Shortcuts

```text
F5          Start or continue debugging
F9          Toggle breakpoint
F10         Step over
F11         Step into
Shift+F11   Step out
Shift+F5    Stop debugging
```

---

## Multi-Language Intelligence

PeaBox IDE v0.11 includes a reusable Language Server Protocol Manager.

### Python

Pyright is bundled with PeaBox IDE. No additional Python language server installation is required.

### Go

Install `gopls` and ensure it is available through PATH:

```powershell
go install golang.org/x/tools/gopls@latest
```

### Rust

Install `rust-analyzer` and ensure the executable is available through PATH.

If Rust was installed through Rustup, add the component with:

```powershell
rustup component add rust-analyzer
```

### C and C++

Install `clangd` and ensure it is available through PATH.

For accurate project intelligence, C and C++ projects should provide a compilation database when possible:

```text
compile_commands.json
```

### Check Available Language Servers

Run:

```text
check-language-servers.bat
```

This checks whether PeaBox IDE can locate:

```text
Pyright
gopls
rust-analyzer
clangd
```

Missing optional language servers do not prevent PeaBox IDE from starting. Only the corresponding language-intelligence features will be unavailable.

---

## Build a Portable Windows Release

To create the portable executable and ZIP distribution, run:

```text
build-portable-exe.bat
```

Build artifacts are created inside:

```text
dist/
```

Expected output:

```text
dist/
├── PeaBox-IDE-0.11.0-x64.exe
└── PeaBox-IDE-0.11.0-x64.zip
```

The build process may require internet access to retrieve Electron and packaging components.

---

## First Launch

After launching PeaBox IDE:

1. Select **File → Open Folder**.
2. Choose a project directory.
3. Open a source file.
4. Check the **Language Intelligence** panel for detected language servers.
5. Open the integrated terminal with `Ctrl+``.
6. Use `Ctrl+Shift+P` to open the Command Palette.

For Python projects, semantic intelligence should start automatically through the bundled Pyright language server.

---

## Troubleshooting

### `npm` is not recognized

Use the portable Node.js layout described above, then run:

```text
setup-peabox-ide.bat
```

### Python debugging does not start

Verify Python:

```powershell
python --version
```

Verify `debugpy`:

```powershell
python -m debugpy --version
```

If necessary, install it:

```powershell
python -m pip install --user debugpy
```

### A language server is shown as missing

Run:

```text
check-language-servers.bat
```

Install the missing server and ensure its executable can be found through PATH.

### Git functionality is unavailable

Verify Git:

```powershell
git --version
```

PeaBox IDE’s Source Control functionality requires Git to be accessible from the application environment.
