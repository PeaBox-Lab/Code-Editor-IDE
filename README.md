# PeaBox IDE v0.14.1 - Tested Core + Real Terminal

This release audits the v0.14 working core, fixes the identified workflows, adds automated Electron tests, and introduces a real interactive terminal.

## Real terminal

The terminal uses `xterm.js` in the renderer and `node-pty` in the Electron main process. On Windows, node-pty uses ConPTY on Windows 10 version 1809 and later. It supports interactive PowerShell input, command history, Ctrl+C, REPLs and terminal resize.

Open it using `Ctrl+`` or **View > Output**, then select **Terminal**.

## Automated tests

Run:

```text
npm test
```

The Playwright Electron test covers application launch, project opening, Monaco initialization, file opening, project search, theme switching and terminal startup. Core tests verify atomic save behavior and required dependencies.

## Audit

See `AUDIT.md` for broken v0.14 workflows fixed here and remaining intentional limitations.

## Build

- Source: `START_SOURCE.bat`
- Windows portable: `BUILD_WINDOWS.bat`
- CI: `.github/workflows/windows.yml`

End users of the packaged EXE do not need Node.js, npm, Python, or administrator access to launch the editor. Language runtimes are only needed when running code in those languages.
