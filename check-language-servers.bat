@echo off
setlocal
echo PeaBox IDE Language Server Check
echo.
where gopls >nul 2>nul && (echo [OK] Go - gopls) || (echo [--] Go - gopls not found)
where rust-analyzer >nul 2>nul && (echo [OK] Rust - rust-analyzer) || (echo [--] Rust - rust-analyzer not found)
where clangd >nul 2>nul && (echo [OK] C/C++ - clangd) || (echo [--] C/C++ - clangd not found)
echo [OK] Python - bundled Pyright
pause
