# PeaBox IDE v0.13.1 - Portable Stabilization

This release hardens startup, session recovery, diagnostics and the Windows portable release pipeline.

## End users
Download the Windows ZIP or portable EXE from GitHub Releases. Extract if required and run `PeaBox IDE.exe`. The packaged release does not require Node.js, npm, administrator rights, or installation.

## New in v0.13.1
- Interrupted-session detection and safe recovery banner
- Workspace restoration paused after an unclean shutdown
- Reset IDE state action
- Built-in diagnostics report with platform, Electron runtime and detected developer tools
- Access to PeaBox logs from the Environment view
- Portable state stored beside the portable executable
- Release validation checking required files, DOM references and preload APIs
- Static smoke tests for all JavaScript entry points
- GitHub Actions Windows build for portable EXE, ZIP and SHA-256 checksums
- Local `BUILD_PORTABLE_WINDOWS.bat` with log output

## Build on Windows
Run `BUILD_PORTABLE_WINDOWS.bat`. Output appears in `dist`.

## Build on GitHub
Run the **Build and verify Windows portable** workflow, or push tag `v0.13.1`.
