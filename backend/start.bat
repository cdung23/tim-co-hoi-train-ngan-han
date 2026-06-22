@echo off
echo.
echo ============================================
echo  APP PHAN TICH KY THUAT CO PHIEU
echo ============================================
echo.
echo [1/3] Kiem tra Python...

set "PYTHON_CMD=python"
%PYTHON_CMD% --version >nul 2>&1
if errorlevel 1 (
    if exist "C:\Program Files\Python311\python.exe" (
        set "PYTHON_CMD=C:\Program Files\Python311\python.exe"
    ) else (
        echo Python chua duoc cai dat hoac khong tim thay!
        echo Vui long cai Python tu https://python.org
        pause
        exit /b 1
    )
)

echo Python OK

echo.
echo [2/3] Cai dat thu vien (co the mat vai phut)...
"%PYTHON_CMD%" -m pip install -r requirements.txt -q
echo Thu vien OK

echo.
echo [3/3] Khoi dong server...
echo.
echo ============================================
echo  Server dang chay tai: http://localhost:8000
echo  API Docs: http://localhost:8000/docs
echo  Nhan Ctrl+C de dung server
echo ============================================
echo.
"%PYTHON_CMD%" main.py
pause
