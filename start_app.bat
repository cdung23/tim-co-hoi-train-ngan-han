@echo off

echo ============================================
echo  KHOI DONG HE THONG PHAN TICH STOCKAI
echo ============================================
echo.

set "PYTHON_CMD=python"
%PYTHON_CMD% --version >nul 2>&1
if errorlevel 1 (
    if exist "C:\Program Files\Python311\python.exe" (
        set "PYTHON_CMD=C:\Program Files\Python311\python.exe"
    ) else (
        echo Khong tim thay Python! Vui long cai dat Python.
        pause
        exit /b 1
    )
)

echo [1/2] Dang khoi dong Backend API trong cua so moi...
start "StockAI Backend" cmd /c "cd backend && start.bat"

echo.
echo [2/2] Dang khoi dong Frontend Web Server...
echo Ung dung se chay tai dia chi: http://localhost:3000
echo.
echo Nhan Ctrl+C de dung server.
echo.

"%PYTHON_CMD%" -m http.server 3000 --directory frontend
pause
