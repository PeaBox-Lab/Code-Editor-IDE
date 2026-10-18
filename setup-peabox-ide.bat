@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title PeaBox IDE Setup
set "NODEDIR="
if exist "%~dp0node\node.exe" set "NODEDIR=%~dp0node"
if not defined NODEDIR if exist "%USERPROFILE%\Downloads\Apps\helpers\1\node\node.exe" set "NODEDIR=%USERPROFILE%\Downloads\Apps\helpers\1\node"
if not defined NODEDIR for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined NODEDIR set "NODEDIR=%%~dpN"
if not defined NODEDIR (echo [ERROR] Portable Node was not found.&echo Put the Node ZIP contents in "%~dp0node".&pause&exit /b 1)
set "PATH=%NODEDIR%;%PATH%"
echo Node: & node.exe -v
echo npm: & call npm.cmd -v
if not exist package.json (echo [ERROR] package.json missing.&pause&exit /b 1)
echo Installing verified project dependencies...
call npm.cmd install --no-audit --no-fund
if errorlevel 1 (echo [ERROR] Dependency installation failed.&pause&exit /b 1)
echo Setup completed successfully.
call npm.cmd start
