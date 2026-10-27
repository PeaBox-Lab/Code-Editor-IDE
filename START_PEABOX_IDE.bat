@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title PeaBox IDE v0.12.1
set "LOG=%~dp0peabox-startup.log"
echo PeaBox IDE startup %DATE% %TIME%>"%LOG%"
set "NODEDIR="
if exist "%~dp0node\node.exe" set "NODEDIR=%~dp0node"
if not defined NODEDIR if exist "%USERPROFILE%\Downloads\Apps\helpers\1\node\node.exe" set "NODEDIR=%USERPROFILE%\Downloads\Apps\helpers\1\node"
if not defined NODEDIR for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined NODEDIR set "NODEDIR=%%~dpN"
if not defined NODEDIR (
 echo ERROR: Node.js could not be found.>>"%LOG%"
 echo.
 echo PeaBox source mode needs Node.js only once to build or run the source.
 echo Put portable Node.js in this folder as: node\node.exe
 echo Or place it at: %%USERPROFILE%%\Downloads\Apps\helpers\1\node
 echo.
 echo Details were written to peabox-startup.log
 pause
 exit /b 1
)
set "PATH=%NODEDIR%;%PATH%"
echo Node directory: %NODEDIR%>>"%LOG%"
node.exe --version>>"%LOG%" 2>&1
call npm.cmd --version>>"%LOG%" 2>&1
if not exist "node_modules\electron\dist\electron.exe" (
 echo Installing source dependencies. This may take a few minutes...
 call npm.cmd install --no-audit --no-fund >>"%LOG%" 2>&1
 if errorlevel 1 (
   echo.
   echo Dependency installation failed. Open peabox-startup.log for details.
   pause
   exit /b 1
 )
)
echo Starting PeaBox IDE...
call npm.cmd start >>"%LOG%" 2>&1
if errorlevel 1 (
 echo.
 echo PeaBox IDE stopped with an error. Open peabox-startup.log for details.
 pause
 exit /b 1
)
