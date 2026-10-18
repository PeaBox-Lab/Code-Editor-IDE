@echo off
setlocal
where python >nul 2>nul || (echo Python not found on PATH.&pause&exit /b 1)
python -m pip install --user debugpy
python -m debugpy --version
pause
