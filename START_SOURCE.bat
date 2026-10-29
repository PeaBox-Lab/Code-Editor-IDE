@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
if exist "%USERPROFILE%\Downloads\Apps\helpers\1\node\node.exe" set "PATH=%USERPROFILE%\Downloads\Apps\helpers\1\node;%PATH%"
where node >nul 2>nul || (echo Node not found.&pause&exit /b 1)
if not exist node_modules\electron\dist\electron.exe call npm.cmd install --no-audit --no-fund
call npm.cmd run validate || pause
call npm.cmd start
