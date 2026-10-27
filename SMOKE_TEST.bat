@echo off
setlocal
cd /d "%~dp0"
echo Checking PeaBox IDE v0.13 source...
node --check main.js || goto FAIL
node --check preload.js || goto FAIL
node --check renderer.js || goto FAIL
findstr /c:"\"version\": \"0.13.0\"" package.json >nul || goto FAIL
echo Static smoke tests passed.
pause
exit /b 0
:FAIL
echo Smoke test failed.
pause
exit /b 1
