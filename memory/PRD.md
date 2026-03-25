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
- Used a local persistent activity timeline to prepare the product for manual real-wallet verification without waiting on external wallet automation.
- Added a dedicated in-app History view rather than pushing more complexity into the sidebar alone, so wallet-pass guidance and trade analysis have their own focused surface.

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
- Added an Order Activity / Trade Timeline panel in the Positions sidebar.
- Added persistent timeline entries for wallet connection, authorization, settings changes, order submission, cancellation, failures, and simulation fills.
- Added timeline filters (`All`, `Wallet`, `Orders`) and a `Sync now` action in Positions.
- Added open-order state labels with sensible defaults for OPEN / PARTIAL / FILLED based on available order fields.
- Added raw fill diagnostics in open-order cards (`filled / original / remaining`) to help tune live partial-fill behavior.
- Added periodic Positions re-sync while that tab is active.
- Added a dedicated top-nav `History` page with:
  - manual live-wallet pass checklist,
  - summary stats,
  - search,
  - category/status filters,
  - JSON export,
  - CSV export,
  - per-market drilldowns,
  - trade timeline view for wallet and order events,
  - per-market P&L section backed by wallet positions,
  - live pass runbook with concrete manual verification steps.
- Added direct links from the wallet guide to the new History page.
- Hardened drilldown selection to use dataset-based handlers rather than inline quoted payloads.
- Verified wallet modal opening, market detail rendering, banner visibility, wallet checklist, sync controls, timeline filters, settings-driven activity entries, History page behaviors, CSV export button presence, P&L empty state, and the live pass runbook.
- Added backend regression tests for proxy endpoints.

## Prioritized Backlog
### P0
- Validate live wallet authorization (`Authorize`) end-to-end with a real browser wallet installed.
- Validate live order placement and cancellation with a funded test wallet.
- Confirm how Polymarket returns partial-fill fields on a real wallet so the open-order status display can be tuned against live data.

### P1
- Add deeper live trading feedback after signature approval (submitted, open, partially filled, cancelled, rejected).
- Add clearer region/allowance explanations for common order failures.
- Add a reusable in-repo browser regression script for banner, checklist, sync controls, History page, P&L cards, and trade timeline flows.

### P2
- Port the static NOVA modules into a more componentized frontend structure over time.
- Add deeper observability for proxy latency and upstream service failures.
- Expand e2e coverage for settings, watchlist, history filters, exports, and live order workflows.

## Next Tasks
1. Run a manual live wallet pass with Phantom or MetaMask installed.
2. Validate connect → authorize → balance refresh → small order → cancel flow with a real wallet.
3. Check how a real partially filled order appears, then tighten the partial/open/filled labels if needed.
4. Add a reusable browser regression script for the new wallet guidance, sync controls, History page, exports, and trade timeline UI.
