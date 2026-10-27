@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Build PeaBox IDE v0.13 Portable
set "LOG=%~dp0portable-build.log"
echo PeaBox IDE portable build %DATE% %TIME%>"%LOG%"
set "NODEDIR="
if exist "%~dp0node\node.exe" set "NODEDIR=%~dp0node"
if not defined NODEDIR if exist "%USERPROFILE%\Downloads\Apps\helpers\1\node\node.exe" set "NODEDIR=%USERPROFILE%\Downloads\Apps\helpers\1\node"
if not defined NODEDIR for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined NODEDIR set "NODEDIR=%%~dpN"
if not defined NODEDIR (
 echo ERROR: Node.js was not found.
 echo Put portable Node in: %~dp0node
 echo See portable-build.log.
 pause
 exit /b 1
)
set "PATH=%NODEDIR%;%PATH%"
echo Node:>>"%LOG%"
node --version>>"%LOG%" 2>&1
call npm.cmd install --no-audit --no-fund>>"%LOG%" 2>&1
if errorlevel 1 goto FAIL
node --check main.js>>"%LOG%" 2>&1 || goto FAIL
node --check preload.js>>"%LOG%" 2>&1 || goto FAIL
node --check renderer.js>>"%LOG%" 2>&1 || goto FAIL
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm.cmd run build:portable>>"%LOG%" 2>&1
if errorlevel 1 goto FAIL
echo.
echo Build completed. Opening dist folder...
explorer "%~dp0dist"
pause
exit /b 0
:FAIL
echo.
echo Build failed. Open portable-build.log for details.
pause
exit /b 1
