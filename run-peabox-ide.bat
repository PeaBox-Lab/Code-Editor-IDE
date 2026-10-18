@echo off
setlocal
cd /d "%~dp0"
if exist "%USERPROFILE%\Downloads\Apps\helpers\1\node\node.exe" set "PATH=%USERPROFILE%\Downloads\Apps\helpers\1\node;%PATH%"
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
if not exist node_modules\electron\dist\electron.exe goto INSTALL
call npm.cmd start
exit /b
:INSTALL
call install-and-run.bat
