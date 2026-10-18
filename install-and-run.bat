@echo off
setlocal
cd /d "%~dp0"
set "NODEDIR="
where node.exe >nul 2>nul && set "NODEDIR=PATH"
if not defined NODEDIR if exist "%USERPROFILE%\Downloads\Apps\helpers\1\node\node.exe" set "NODEDIR=%USERPROFILE%\Downloads\Apps\helpers\1\node"
if not defined NODEDIR if exist "%~dp0node\node.exe" set "NODEDIR=%~dp0node"
if not defined NODEDIR (
 echo Node.js was not found.
 echo Extract the portable Node.js ZIP into a folder named node beside this file,
 echo or keep it at %%USERPROFILE%%\Downloads\Apps\helpers\1\node
 pause
 exit /b 1
)
if not "%NODEDIR%"=="PATH" set "PATH=%NODEDIR%;%PATH%"
echo Using Node: & node.exe -v
if not exist node_modules\electron\dist\electron.exe (
 echo Installing PeaBox IDE dependencies...
 call npm.cmd install
 if errorlevel 1 (echo Installation failed.& pause& exit /b 1)
)
call npm.cmd start
