@echo off
setlocal

cd /d "%~dp0..\frontend"

where yarn >nul 2>&1
if errorlevel 1 (
  echo Yarn not found. Install Node.js and run: npm install -g yarn
  pause
  exit /b 1
)

if not exist ".env.local" (
  > ".env.local" echo REACT_APP_BACKEND_URL=http://localhost:8001
)

set REACT_APP_BACKEND_URL=http://localhost:8001

echo Installing frontend dependencies...
yarn install

echo Starting NOVA frontend on http://localhost:3000
yarn start
