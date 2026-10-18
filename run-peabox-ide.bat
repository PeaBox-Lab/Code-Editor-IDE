@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
if exist "%USERPROFILE%\Downloads\Apps\helpers\1\node\node.exe" set "PATH=%USERPROFILE%\Downloads\Apps\helpers\1\node;%PATH%"
if not exist "node_modules\electron\dist\electron.exe" call setup-peabox-ide.bat&exit /b
call npm.cmd start
