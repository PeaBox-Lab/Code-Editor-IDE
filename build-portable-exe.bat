@echo off
call npm.cmd install --no-audit --no-fund
call npm.cmd run build:portable
pause
