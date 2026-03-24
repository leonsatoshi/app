# PRD — NOVA Polymarket Trading Command Center Fix

## Original Problem Statement
User asked: “Fix this.”

Clarified issue:
- The app did not start immediately after launch.
- It did not let the user access information.
- It did not let the user connect a crypto wallet.
- Expected result: the app should connect to Polymarket APIs and support crypto wallet connection for a trading command center.
- Priority: startup/build issues, core functionality, and everything critical.

## Architecture Decisions
- Kept the uploaded NOVA app as its original static HTML/CSS/JS experience rather than rewriting the whole UI into React.
- Served the NOVA shell from `frontend/public/index.html` and kept CRA mounted to a hidden `#root` so the app runs cleanly in the current environment.
- Implemented FastAPI proxy routes under `/api` for Polymarket Gamma, CLOB, Data, and Polygon RPC services.
- Normalized upstream proxy behavior by forcing `Accept-Encoding: identity` to avoid compressed-response parsing failures in the browser.
- Switched Polygon RPC to `https://polygon-bor-rpc.publicnode.com` because the previous RPC target returned tenant-disabled errors.
- Added `data-testid` attributes across key interactive and user-facing elements for reliable UI validation.

## What's Implemented
- Migrated uploaded NOVA assets into the existing frontend app.
- Replaced the starter frontend shell with the real NOVA trading terminal UI.
- Added working backend proxy endpoints:
  - `/api/ping`
  - `/api/gamma/...`
  - `/api/clob/...`
  - `/api/data/...`
  - `/api/polygon`
- Fixed market loading so the app now renders live Polymarket markets.
- Fixed Polygon RPC access for balance-related wallet flows.
- Verified wallet modal opening and market detail rendering.
- Added backend regression tests for proxy endpoints.

## Prioritized Backlog
### P0
- Validate live wallet authorization (`Authorize`) end-to-end with a real browser wallet installed.
- Validate live order placement and cancellation with a funded test wallet.

### P1
- Replace synchronous `requests` calls in FastAPI proxy routes with async `httpx.AsyncClient` for better concurrency.
- Add clearer in-app error states for upstream rate limits and auth failures.
- Add richer wallet connection status messaging for unsupported/no-wallet environments.

### P2
- Port the static NOVA modules into a more componentized frontend structure over time.
- Add deeper observability for proxy latency and upstream service failures.
- Expand e2e coverage for settings, watchlist, and order workflows.

## Next Tasks
1. Test live wallet auth with Phantom or MetaMask installed.
2. Test authorize + positions + balance refresh using a real wallet.
3. Test live CLOB order submission/cancel flow against the current Polymarket setup.
4. Harden proxy performance with async upstream requests.
