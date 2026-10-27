@echo off
cd /d "%~dp0"
call npm.cmd install --no-audit --no-fund
call npm.cmd run build:portable
