# NOVA Windows Startup Guide

## What is in this package
- Full upgraded NOVA command center source code
- Windows startup scripts
- Desktop shortcut installer
- Console command reference
- Project log covering the original uploaded package and the upgrades completed in this chat

## Recommended setup
- Windows 10 or 11
- Python 3.11+
- Node.js 20+
- Yarn classic (`npm install -g yarn`)
- A browser wallet if you plan to trade live

## Fast start
1. Extract the ZIP to a normal folder like `C:\NOVA`
2. Open the extracted folder
3. Go into `windows`
4. Double-click `start-nova-local.bat`
5. Wait for two terminals to open:
   - backend on port `8001`
   - frontend on port `3000`
6. Open `http://localhost:3000`

## Desktop shortcut installer
1. Open the `windows` folder
2. Double-click `install-desktop-shortcut.bat`
3. A desktop shortcut named `NOVA Command Center` will be created
4. Use that shortcut later to launch NOVA quickly

## What the scripts do
- `start-backend.bat`
  - creates `backend\.venv` if needed
  - installs backend dependencies from `backend\requirements.txt`
  - starts FastAPI with uvicorn on `http://localhost:8001`
- `start-frontend.bat`
  - creates `frontend\.env.local` with `REACT_APP_BACKEND_URL=http://localhost:8001` if needed
  - installs frontend dependencies with Yarn
  - starts the React app on `http://localhost:3000`
- `start-nova-local.bat`
  - opens both scripts in separate terminals

## Local startup option with manual commands
Use the commands in `CONSOLE_COMMANDS_WINDOWS.md` if you prefer manual control.

## Troubleshooting

### Frontend does not start
- Make sure Node and Yarn are installed:
  - `node -v`
  - `yarn -v`
- Then run from `frontend`:
  - `yarn install`
  - `set REACT_APP_BACKEND_URL=http://localhost:8001`
  - `yarn start`

### Backend does not start
- Make sure Python is installed:
  - `py -3 --version`
- Then run from project root:
  - `py -3 -m venv backend\.venv`
  - `backend\.venv\Scripts\activate`
  - `pip install -r backend\requirements.txt`
  - `cd backend`
  - `python -m uvicorn server:app --reload --host 0.0.0.0 --port 8001`

### API health checks
- Backend ping:
  - `curl http://localhost:8001/api/ping`
- Gamma passthrough:
  - `curl "http://localhost:8001/api/gamma/markets?active=true&closed=false&limit=1"`
- CLOB time:
  - `curl http://localhost:8001/api/clob/time`
- Polygon RPC check:
  - `curl -X POST http://localhost:8001/api/polygon -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}"`

## Live trading test flow
1. Launch NOVA
2. Connect wallet
3. Authorize Polymarket access
4. Enable Live Trading in Settings
5. Place a very small order
6. Keep Positions or History open
7. Watch badges, diagnostics, notifications, ticker, and History updates
8. Cancel if needed and confirm the final state

## Zip usage notes
- This package is meant for local startup and review
- It does not include `node_modules` or Python virtual environment folders
- The startup scripts will install what is needed on first run
