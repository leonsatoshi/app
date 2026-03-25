@echo off
setlocal

echo Launching NOVA backend and frontend...
start "NOVA Backend" /D "%~dp0" cmd /k start-backend.bat
timeout /t 3 /nobreak >nul
start "NOVA Frontend" /D "%~dp0" cmd /k start-frontend.bat

echo.
echo NOVA launch started.
echo Frontend: http://localhost:3000
echo Backend:  http://localhost:8001
echo.
pause
