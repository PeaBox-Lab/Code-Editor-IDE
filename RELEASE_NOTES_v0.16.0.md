# PeaBox IDE v0.16.0 — Release Notes

**Release Date:** 2026-11-10

## Overview

PeaBox IDE v0.16.0 is a feature and quality release that introduces Git fetch,
runtime auto-detection, and encoding/EOL awareness in the status bar. Existing
features and backward compatibility are fully preserved.

## What's New

### 1. Git Fetch Button
- Added a dedicated **Fetch** button in the Source Control panel next to Pull/Push
- New `git:remote` handler lists configured remotes (non-origin)
- `git:pull` now triggers a linked `git:fetch origin` and surfaces both results
- `git:fetch` handler exposed for explicit API-level fetch

### 2. Runtime Auto-Detect
- New `runtime:detect` IPC handler probes a runtime and returns its version
- Each Runtime row in Settings now has an **"Auto-Detect"** button that populates
  the configured path on success
- Useful for environments where the runtime is on PATH but not yet configured

### 3. Encoding & EOL Awareness
- New `file:encoding` handler detects UTF-8, UTF-16 (LE/BE) and UTF-32 (LE/BE)
  including BOM detection and NUL-byte binary markers
- New `file:eol` handler reports the active file's line ending (LF/CRLF/CR)
- Status bar now includes an **encoding indicator** alongside the EOL indicator
- `api.file.encoding` and `api.file.eol` exposed in the preload bridge

### 4. Shared Module Enhancements
- New `PB.detectFileEncoding(bytes, sampleSize)` — pure encoding detector usable
  in both browser and Node contexts
- New `PB.normalizeLineEndings(content, to)` — converts to LF/CRLF/CR
- Both functions are unit-tested

## Quality

- **20 unit tests** (up from 15), all passing
- **E2E smoke test** passing (11 scenarios including live terminal)
- **Validation** passing: 119 DOM ids, 36 icons, 56 IPC handlers
- **Build** produces Portable EXE and ZIP artifacts successfully

## Compatibility

- Backward compatible with v0.15.0 userData/state.json
- No breaking IPC changes; all new channels are additive
- Windows, macOS, Linux support maintained (as before)

## Known Limitations

- `fs.watch(..., { recursive: true })` remains Windows/macOS-only
- Git operations require configured non-interactive credentials
- node-pty requires the Win32-x64 prebuilt (or C++ toolchain fallback)

## Upgrade Path

1. Back up `%APPDATA%\peabox-ide\state.json` and `recovery/`
2. Uninstall v0.15.0 (keep userData)
3. Install v0.16.0
4. Launch — session state (workspace, open files, settings) is restored

## Artifacts

- `PeaBox-IDE-0.16.0-Windows-x64.exe` (portable, ~56 MB)
- `PeaBox-IDE-0.16.0-Windows-x64.zip` (~147 MB)
