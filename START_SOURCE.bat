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

if not exist "node_modules\electron\dist\electron.exe" (
  call npm.cmd install --no-audit --no-fund || goto FAIL
)

call npm.cmd run validate || goto FAIL
call npm.cmd start
exit /b 0

:FAIL
echo.
echo PeaBox could not start. Review the output above for details.
pause
exit /b 1
