# NOVA Console Commands for Windows

## 1) Install prerequisites
```bat
node -v
yarn -v
py -3 --version
```

## 2) Backend setup
```bat
cd backend
py -3 -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m uvicorn server:app --reload --host 0.0.0.0 --port 8001
```

## 3) Frontend setup
Open a second terminal:
```bat
cd frontend
yarn install
set REACT_APP_BACKEND_URL=http://localhost:8001
yarn start
```

## 4) Local API checks
```bat
curl http://localhost:8001/api/ping
curl "http://localhost:8001/api/gamma/markets?active=true&closed=false&limit=1"
curl http://localhost:8001/api/clob/time
curl -X POST http://localhost:8001/api/polygon -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}"
```

## 5) Useful frontend checks
```bat
cd frontend
yarn install
yarn start
```

## 6) If you want a clean reinstall
```bat
rmdir /s /q backend\.venv
rmdir /s /q frontend\node_modules
```
Then run the startup scripts again.

## 7) Common recovery commands
```bat
cd backend
.venv\Scripts\activate
pip install -r requirements.txt
```

```bat
cd frontend
yarn install
```

## 8) Manual live-trade observation flow
```text
Connect wallet -> Authorize -> Enable Live Trading -> Place small order -> Keep Positions or History open -> Watch ticker, notifications, badges, diagnostics, and History
```
