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
- Kept the uploaded NOVA app as its original static HTML/CSS/JS experience instead of rewriting the whole UI into React.
- Served the NOVA shell from `frontend/public/index.html` and kept CRA mounted to a hidden `#root` so it works cleanly inside the current environment.
- Implemented FastAPI proxy routes under `/api` for Polymarket Gamma, CLOB, Data, and Polygon RPC services.
- Hardened the proxy by moving from blocking `requests` to async `httpx.AsyncClient`.
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
- Added a top status banner with wallet/auth guidance and next-step actions.
- Added an in-app live wallet test checklist in the Wallet sidebar.
- Added an Order Activity panel in the Positions sidebar for submitted, cancelled, failed, and simulation events.
- Added persistent order activity state and UI refresh events.
- Verified wallet modal opening, market detail rendering, banner visibility, wallet checklist, and order activity section.
- Added backend regression tests for proxy endpoints.

## Prioritized Backlog
### P0
- Validate live wallet authorization (`Authorize`) end-to-end with a real browser wallet installed.
- Validate live order placement and cancellation with a funded test wallet.

### P1
- Add deeper live trading feedback after signature approval (submitted, open, partially filled, cancelled, rejected).
- Add clearer region/allowance explanations for common order failures.
- Add a reusable in-repo browser regression script for banner, checklist, and order activity flows.

### P2
- Port the static NOVA modules into a more componentized frontend structure over time.
- Add deeper observability for proxy latency and upstream service failures.
- Expand e2e coverage for settings, watchlist, and order workflows.

## Next Tasks
1. Run a manual live wallet pass with Phantom or MetaMask installed.
2. Validate authorize + balance refresh + positions using a real wallet.
3. Validate a small live CLOB order and cancellation flow.
4. Add a reusable browser regression script for the new wallet guidance and order activity UI.
