@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title PeaBox IDE v0.13.1 Portable Build
set "LOG=%~dp0portable-build.log"
echo Build started %DATE% %TIME%>"%LOG%"
set "NODEDIR="
if exist "%~dp0node\node.exe" set "NODEDIR=%~dp0node"
if not defined NODEDIR if exist "%USERPROFILE%\Downloads\Apps\helpers\1\node\node.exe" set "NODEDIR=%USERPROFILE%\Downloads\Apps\helpers\1\node"
if not defined NODEDIR for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined NODEDIR set "NODEDIR=%%~dpN"
if not defined NODEDIR (echo Node not found.&pause&exit /b 1)
set "PATH=%NODEDIR%;%PATH%"
call npm.cmd install --no-audit --no-fund>>"%LOG%" 2>&1 || goto FAIL
call npm.cmd run release:check>>"%LOG%" 2>&1 || goto FAIL
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm.cmd run build:portable>>"%LOG%" 2>&1 || goto FAIL
powershell -NoProfile -Command "Get-FileHash dist\* -Algorithm SHA256 | Format-Table -AutoSize | Out-File dist\SHA256SUMS.txt"
echo Build complete. Output is in dist.
explorer "%~dp0dist"
pause
exit /b 0
:FAIL
echo Build failed. Open portable-build.log.
pause
exit /b 1
