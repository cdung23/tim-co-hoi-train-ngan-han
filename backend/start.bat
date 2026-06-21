@echo off
chcp 65001 > nul
set PYTHONIOENCODING=utf-8
echo.
echo ============================================
echo  📊 APP PHÂN TÍCH KỸ THUẬT CỔ PHIẾU
echo ============================================
echo.
echo [1/3] Kiểm tra Python...

set "PYTHON_CMD=python"
%PYTHON_CMD% --version >nul 2>&1
if errorlevel 1 (
    if exist "C:\Program Files\Python311\python.exe" (
        set "PYTHON_CMD=C:\Program Files\Python311\python.exe"
    ) else (
        echo ❌ Python chưa được cài đặt hoặc không tìm thấy!
        echo Vui lòng cài Python 3.11 từ https://python.org
        pause
        exit /b 1
    )
)

echo ✅ Python OK

echo.
echo [2/3] Cài đặt thư viện (lần đầu chạy sẽ mất vài phút)...
"%PYTHON_CMD%" -m pip install -r requirements.txt -q
echo ✅ Thư viện OK

echo.
echo [3/3] Khởi động server...
echo.
echo ============================================
echo  🌐 Server đang chạy tại: http://localhost:8000
echo  📖 API Docs: http://localhost:8000/docs
echo  ❌ Nhấn Ctrl+C để dừng server
echo ============================================
echo.
"%PYTHON_CMD%" main.py
pause
