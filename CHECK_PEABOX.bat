@echo off
setlocal
cd /d "%~dp0"
echo PeaBox IDE v0.12.1 diagnostic
echo =================================
where node 2>nul || echo Node not found on PATH
where npm 2>nul || echo npm not found on PATH
if exist node\node.exe echo Portable Node found: %CD%\node\node.exe
if exist node_modules\electron\dist\electron.exe (echo Electron dependency: OK) else (echo Electron dependency: MISSING)
if exist package.json (echo package.json: OK) else (echo package.json: MISSING)
if exist main.js (echo main.js: OK) else (echo main.js: MISSING)
if exist renderer.js (echo renderer.js: OK) else (echo renderer.js: MISSING)
if exist peabox-startup.log echo Startup log: %CD%\peabox-startup.log
pause
