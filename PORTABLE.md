# Portable packaging

Run `build-portable-exe.bat`. It creates a no-install Windows executable and a ZIP in `dist`. The packaged app includes Electron, Monaco, Pyright, TypeScript and xterm.js, so end users do not need Node or npm. When launched through electron-builder's portable target, PeaBox IDE stores user state in `PeaBox-IDE-Data` beside the executable.

The build process itself downloads Electron/electron-builder artifacts and therefore needs internet access. Application code signing is not configured in this source package.
