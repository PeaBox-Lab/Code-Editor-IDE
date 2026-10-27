@echo off
cd /d "%~dp0"
if not exist node_modules call npm.cmd install --no-audit --no-fund
call npm.cmd start
