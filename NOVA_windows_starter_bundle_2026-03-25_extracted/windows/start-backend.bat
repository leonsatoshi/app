@echo off
setlocal

cd /d "%~dp0..\backend"

where py >nul 2>&1
if errorlevel 1 (
  echo Python launcher not found. Install Python 3.11+ first.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\activate.bat" (
  echo Creating backend virtual environment...
  py -3 -m venv .venv
)

call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip
pip install -r requirements.txt

echo Starting NOVA backend on http://localhost:8001
python -m uvicorn server:app --reload --host 0.0.0.0 --port 8001
