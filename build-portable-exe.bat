@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
if exist "%USERPROFILE%\Downloads\Apps\helpers\1\node\node.exe" set "PATH=%USERPROFILE%\Downloads\Apps\helpers\1\node;%PATH%"
call npm.cmd install --no-audit --no-fund
if errorlevel 1 pause&exit /b 1
call npm.cmd run build:portable
if errorlevel 1 pause&exit /b 1
echo Portable EXE and ZIP are in dist.
explorer "%~dp0dist"
pause
