@echo off
setlocal
cd /d "%~dp0"
if exist "%USERPROFILE%\Downloads\Apps\helpers\1\node\node.exe" set "PATH=%USERPROFILE%\Downloads\Apps\helpers\1\node;%PATH%"
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
call npm.cmd install --no-audit --no-fund
call npm.cmd start
