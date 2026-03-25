# NOVA Changelog

## [1.1.23] 2026-03-25 — Command center hardening + live monitoring upgrades

### Core platform upgrades
- Migrated NOVA into the current React/FastAPI environment while preserving the original command-center UX.
- Added FastAPI proxy routes for Gamma, CLOB, Data, and Polygon RPC and hardened them with async upstream requests.
- Fixed compressed upstream-response handling and replaced the failing Polygon RPC target with `polygon-bor-rpc.publicnode.com`.

### Wallet + live trading flow
- Added top status guidance for connect → authorize → enable live trading → place a small order.
- Added wallet test checklist, live pass runbook, and stronger manual live-trading preparation throughout the app.
- Added shared open-order syncing, fill diagnostics, lifecycle badges (`OPEN`, `PARTIAL`, `FILLED`, `CANCELLED`, `FAILED`), and 15-second live refresh while Positions or History is open.

### Monitoring + history
- Added compact live activity ticker beneath the status banner.
- Added topbar notification center with unread badge and recent activity feed.
- Added optional sound alerts for lifecycle changes in Settings.
- Added a dedicated `History` page with summary stats, search, filters, JSON export, CSV export, per-market drilldowns, trade timeline, per-market P&L cards, and a live order monitor.

### Reliability notes
- Guarded unknown upstream order sides so they no longer default incorrectly to `NO`.
- Confirmed public API health for `/api/ping`, Gamma markets passthrough, CLOB time, and Polygon RPC.

## [1.1.22] 2026-03-22 — Full static analysis — 12 bugs fixed

### Critical fixes
- **[api.js] C-1: `apiFetch` returned `undefined` after consecutive 429s** — `continue` in the for loop incremented the attempt counter even on rate-limit retries. With `retries=1` (the default), two back-to-back 429s exhausted both iterations and the function fell off the end returning `undefined`. Every caller then did `result.ok` → `TypeError` crash. Fix: `attempt--` before `continue` so 429 retries don't consume normal retry slots.
- **[auth.js / wallet.js] C-2: `PM.proxyAddress` lost on page reload → orders reverted to EOA mode** — `storeL2Credentials()` only stored `apiKey/apiSecret/apiPassphrase`. After a reload, credentials were restored but `PM.proxyAddress` stayed `null`, forcing `signatureType='0'` (EOA) on all orders → CLOB 401. Fix: store and restore `proxyAddress` in the sessionStorage blob; move `storeL2Credentials()` call to after `PM.proxyAddress` is set in `authorize()`.
- **[auth.js] C-3: `atob()` silently corrupted URL-safe base64 HMAC keys** — Polymarket API secrets are JWT-style (use `-` and `_`). `atob()` treated them as ASCII, producing a wrong key. Every signed request returned 401 for any user whose secret contained those characters (~50% of secrets). Fix: normalize to standard base64 before `atob()`.
- **[arb-ui.js] C-4: `analyzeSelected()` crashed with TypeError and sent garbage to Claude** — Used `anchor:` instead of `question:` and omitted all price fields. `.toFixed()` on `undefined` threw before the fetch. "Ask Pulse Agent" was completely broken. Fix: build signal with the fields `analyzeSignal()` SPREAD_ARB branch actually reads.

### High fixes
- **[orders.js] H-1: `order.salt` was a JS Number, all other uint256 fields are strings** — CLOB REST API expects all fields as strings; a JSON number for salt likely caused 422s on all live orders. Fix: `.toString()` on the `getRandomValues()` result.
- **[markets.js] H-2: `selectMarket()` highlighted wrong items via substring match** — `onclick.toString().includes(id)` had false-positives when one market ID is a prefix of another. Fix: `data-market-id` attribute + exact `dataset.marketId === id` comparison.

### Medium fixes
- **[arb.js] M-1: population std dev inflated z-scores by ~5–10%** — Both `runStatArbScan()` and `runVRPScan()` divided by `n` instead of `n-1`. Fix: sample std dev `÷(n-1)` in both.
- **[auth.js] M-2: server clock offset never refreshed — stale after long sessions** — Computed once at auth time, never updated. Fix: auto-refresh in `buildL2Headers()` if offset is >30 min old.
- **[debug.js] M-3: changelog frozen at v1.1.18** — All fixes since v1.1.19 invisible in debug panel. Fix: added entries for v1.1.19–v1.1.22.

### Low fixes
- **[settings.js] L-1: `clearAll()` didn't reload** — Stale `CFG`/`SIM` in memory after clearing storage. Fix: reload after 600ms.
- **[markets.js] L-2: `null` endDate sorted as epoch (1970)** — Open-ended markets appeared at top of date sort. Fix: use far-future sentinel (2099) for null dates.
- **[index.html] L-3: ethers.js CDN failure was invisible** — Only a console warning. Fix: `onerror` on the `<script>` tag injects a red in-app banner with a Reload button.



### Critical fix
- **[auth/wallet] Proxy wallet address now correctly resolved from L1 auth response**
  - `PM.proxyAddress` was always `null` — `resolveProxyWallet()` was called before
    auth existed and always failed with 401. All live CLOB orders were using
    `signatureType '0'` (EOA) instead of `'2'` (POLY_PROXY), causing every order
    to be rejected for users who have deposited funds to Polymarket.
  - Fix: `deriveL2Credentials()` now extracts `result.data.address` (the proxy
    wallet) from the `/auth/derive-api-key` response and returns it. `authorize()`
    stores it on `PM.proxyAddress`. Zero extra network calls.
  - Removed dead `resolveProxyWallet()` function entirely.

### Bug fixes
- **[wallet] Balance always showed $0 after connect**
  - At connect time `PM.proxyAddress` is null, so `fetchBalance()` queried the EOA.
    Polymarket holds all user USDC in the proxy wallet, not the EOA.
  - Fix: `authorize()` now re-fetches balance + positions from `PM.proxyAddress`
    immediately after setting it. Fires `nova:balanceUpdated` event so the topbar
    and sidebar refresh without a page reload.
- **[markets] Token ID extraction fails for markets using object-array format**
  - Gamma API sometimes returns `tokens: [{token_id, outcome}]` instead of
    `clobTokenIds: [string]`. Orders on those markets always threw "Could not
    determine token ID." `normalizeMarket()` now handles all three shapes.
- **[proxy] URL parsed twice per proxied request**
  - `new URL(req.url)` was called twice per request. Now parsed once at the top of
    the handler and shared by both proxy and static branches. Added `try/catch`
    guard so malformed URLs return 400 instead of crashing the handler.
- **[proxy] Restored ANSI color + OSC 8 clickable URL in startup banner**
  - `http://localhost:3500` is now a clickable hyperlink in Windows Terminal / iTerm2.
- **[state] `S.searchQuery` uninitialized**
  - Was read in `filterMarkets()` before being declared. Now initialized as `''`.



Complete rebuild from APEX prototype. All known bugs fixed from day one.

### Architecture
- Multi-file: HTML shell + CSS modules + JS ES modules
- No build step required — runs directly in browser + Node.js proxy
- Git initialized on day one

### Bugs fixed from APEX (baked in from the start)
- `nonce: Number(0)` — uint256 as JSON integer, never string
- No `EIP712Domain` in `types` — wallets handle it implicitly
- `ethers.utils.getAddress()` — EIP-55 checksumming
- Proxy re-uppercases `POLY_*` headers — Node.js lowercases them
- `PM.makerAddress` getter — returns proxyAddress || address
- USDC.e contract in `constants.js` — single source of truth

### New in NOVA vs APEX
- Proper ES module architecture (import/export)
- `validateAuthPayload()` canary — runs before every wallet sign
- `apiFetch()` wrapper — all errors normalized to `{ ok, data, error, status }`
- `state.js` — single source of truth, no duplicated state
- `constants.js` — all magic numbers documented with rules
- Agent system in dedicated `agents.js` module
- Sidebar, settings, debug all in separate modules
- `PM.reset()` method for clean disconnect
- `restoreL2Credentials()` — re-uses session creds on page reload
