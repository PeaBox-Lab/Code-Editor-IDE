# PeaBox IDE v0.13 Portable Windows Release

## GitHub build, recommended

1. Push this repository to GitHub.
2. Open **Actions**.
3. Select **Build Windows Portable**.
4. Choose **Run workflow**.
5. Download `PeaBox-IDE-v0.13.0-Windows-x64` from the workflow artifacts.

Creating and pushing a tag such as `v0.13.0` also attaches the generated EXE and ZIP to the GitHub Release.

## Local Windows build

Double-click `BUILD_WINDOWS_PORTABLE.bat`. It detects portable Node in either:

- `node` beside the script, or
- `%USERPROFILE%\Downloads\Apps\helpers\1\node`

Generated files appear in `dist`.

## End-user experience

The generated portable executable includes Electron and application dependencies. End users run the EXE directly and do not install Node.js, npm, or PeaBox IDE. The unsigned executable may trigger Microsoft SmartScreen until the application is code-signed.
