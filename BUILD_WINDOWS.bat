@echo off
setlocal
cd /d "%~dp0"

rem Use a locally bundled Node if present, otherwise rely on PATH.
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"

where node >nul 2>nul || (
  echo Node.js 20 or newer is required but was not found on PATH.
  echo Install it from https://nodejs.org/ and run this script again.
  pause
  exit /b 1
)

call npm.cmd install --no-audit --no-fund || goto FAIL

set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm.cmd run build || goto FAIL

if exist dist explorer dist
exit /b 0

:FAIL
echo.
echo Build failed. Review the output above for details.
pause
exit /b 1
