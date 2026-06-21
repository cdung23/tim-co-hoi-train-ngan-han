@echo off
chcp 65001 > nul
set PYTHONIOENCODING=utf-8

echo.
echo ============================================
echo  📊 KHỞI ĐỘNG HỆ THỐNG PHÂN TÍCH STOCKAI
echo ============================================
echo.

set "PYTHON_CMD=python"
%PYTHON_CMD% --version >nul 2>&1
if errorlevel 1 (
    if exist "C:\Program Files\Python311\python.exe" (
        set "PYTHON_CMD=C:\Program Files\Python311\python.exe"
    ) else (
        echo ❌ Không tìm thấy Python! Vui lòng cài đặt Python.
        pause
        exit /b 1
    )
)

echo [1/2] Đang khởi động Backend API trong cửa sổ mới...
start "StockAI Backend" cmd /c "cd backend && start.bat"

echo.
echo [2/2] Đang khởi động Frontend Web Server...
echo 🌐 Ứng dụng sẽ chạy tại địa chỉ: http://localhost:3000
echo.
echo Nhấn Ctrl+C để dừng server.
echo.

"%PYTHON_CMD%" -m http.server 3000 --directory frontend
pause
