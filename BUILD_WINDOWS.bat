@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
if exist "%USERPROFILE%\Downloads\Apps\helpers\1\node\node.exe" set "PATH=%USERPROFILE%\Downloads\Apps\helpers\1\node;%PATH%"
call npm.cmd install --no-audit --no-fund || goto FAIL
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm.cmd run build:portable || goto FAIL
explorer dist
exit /b 0
:FAIL
echo Build failed.
pause
