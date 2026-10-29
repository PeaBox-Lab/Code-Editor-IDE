# PeaBox IDE v0.13.2 - Core Reliability

This release implements the highest-priority reliability work from the PeaBox roadmap.

## Core improvements
- Atomic UTF-8 saves using temporary files, fsync and rename
- Automatic `.peabox-backup` before replacing existing files
- Unsaved recovery snapshots stored under `PeaBox-IDE-Data/recovery`
- Recovery dialog on startup
- External file-change watching and conflict handling
- Deleted-file notifications
- Binary-file rejection and a 20 MB safe editing limit
- Workspace Restricted Mode for untrusted projects
- Run, Debug and Git-write operations blocked until trust is granted
- Runtime execution uses explicit executable plus argument arrays instead of shell strings
- Selected portable Python runtime is used by Run Current File
- Optional `node-pty` backend for Windows ConPTY terminals, with compatibility fallback
- Terminal resize plumbing
- Updated portable EXE/ZIP workflow

## End-user installation
Download the Windows portable ZIP, extract it, and run `PeaBox IDE.exe`. The packaged release does not require Node.js, npm or administrator rights.

## Workspace trust
New projects open in Restricted Mode. Review the project before selecting **Trust this project**. Until trusted, PeaBox blocks project command execution, debugging and Git commits.

## Recovery
Unsaved buffers are captured after edits. On the next launch, PeaBox offers to restore or discard them. Successful saves clear the corresponding recovery snapshot.

## Build
Use GitHub Actions or `BUILD_PORTABLE_WINDOWS.bat`. `node-pty` is optional but recommended for the full Windows ConPTY terminal.
