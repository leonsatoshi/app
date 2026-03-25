/**
 * NOVA — Debug Module
 */

import { S, PM, CFG } from './state.js';
import { VERSION, PROXY_BASE } from './constants.js';
import { fetchBalance } from './wallet.js';

const MAX_LOG_LINES = 200;
const LOG_SESSION_KEY = 'nova_debug_log';

// R-DATA-02: restore log from sessionStorage on boot so entries survive page reloads.
// chainChanged forces a reload — without this, the error that caused it is lost.
const _log = (() => {
  try {
    const saved = sessionStorage.getItem(LOG_SESSION_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
})();

// ── Log ───────────────────────────────────────────────────────────────────
export function appendLog(msg, type = 'info') {
  const ts = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  _log.unshift({ ts, msg, type });
  if (_log.length > MAX_LOG_LINES) _log.pop();

  // Persist after every write — keeps the log alive across reloads
  try { sessionStorage.setItem(LOG_SESSION_KEY, JSON.stringify(_log)); } catch { /* storage full */ }

  const el = document.getElementById('dbg-log');
  if (!el) return;

  el.innerHTML = _log.map(l =>
    `<div style="color:${({ ok:'var(--green)',error:'var(--red)',warn:'var(--amber)',info:'var(--text2)' }[l.type]||'var(--text2)')}">
      <span style="color:var(--text3);user-select:none">${l.ts} </span>${l.msg}
    </div>`
  ).join('');
}

// ── Tab Switching ─────────────────────────────────────────────────────────
window.Debug = {
  switchTab(name, el) {
    document.querySelectorAll('.dbg-tab-btn').forEach(b => b.classList.remove('active'));
    el?.classList.add('active');
    document.querySelectorAll('.dbg-pane').forEach(p => p.classList.remove('active'));
    document.getElementById('dbg-' + name + '-pane')?.classList.add('active');
  },

  async runHealth() {
    const el = document.getElementById('dbg-health-results');
    el.innerHTML = '<div style="color:var(--text2);font-size:11px">Running checks…</div>';

    const checks = [];

    const check = (label, ok, note = '') =>
      checks.push({ label, ok, note });

    // Proxy
    try {
      const r = await fetch(`${PROXY_BASE}/ping`, { signal: AbortSignal.timeout(1500) });
      check('Proxy running', r.ok, r.ok ? PROXY_BASE : 'unreachable');
    } catch { check('Proxy running', false, 'backend proxy unavailable'); }

    // Wallet
    check('Wallet connected', PM.connected, PM.address?.slice(0,14) + '…' || 'not connected');
    check('L2 credentials', PM.hasL2, PM.hasL2 ? 'active' : 'click ⚡ Authorize');
    check('makerAddress resolves', !!PM.makerAddress, PM.makerAddress?.slice(0,14) + '…' || 'null');

    // Balance
    if (PM.connected) {
      try {
        const bal = await fetchBalance(PM.makerAddress);
        check('USDC.e balance readable', bal != null, bal != null ? '$' + bal.toFixed(2) : 'null');
      } catch (e) { check('USDC.e balance readable', false, e.message); }
    }

    // Anthropic key
    check('Anthropic key set', !!CFG.anthropicKey, CFG.anthropicKey ? 'sk-ant-…' + CFG.anthropicKey.slice(-4) : 'not set');

    // Markets
    check('Markets loaded', S.markets.length > 0, S.markets.length + ' markets');

    // ethers.js — required for EIP-55 checksumming
    const ethersLoaded = !!window.ethers?.utils?.getAddress;
    check('ethers.js loaded', ethersLoaded, ethersLoaded ? 'EIP-55 checksumming active' : '⚠ CDN failed — auth will use lowercase address → likely 401');

    el.innerHTML = checks.map(c => `
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:11px">
        <span style="color:${c.ok ? 'var(--green)' : 'var(--red)'};flex-shrink:0">${c.ok ? '✓' : '✗'}</span>
        <span style="color:var(--text2);flex:1">${c.label}</span>
        <span style="color:var(--text3);font-size:10px">${c.note}</span>
      </div>`).join('');
  },
};

// ── Changelog ─────────────────────────────────────────────────────────────
export function renderChangelog() {
  const el = document.getElementById('dbg-changelog-content');
  if (!el) return;

  const entries = [
    {
      version: 'v1.1.22',
      date:    '2026-03-22',
      title:   'Full static analysis — 10 bugs fixed',
      items: [
        { type: 'fix', text: 'C-1 (api.js): apiFetch returned undefined after consecutive 429s — added attempt-- before continue so the for loop cannot exit without a return statement.' },
        { type: 'fix', text: 'C-2 (auth.js/wallet.js): PM.proxyAddress not persisted to sessionStorage — lost on page reload, reverting all orders to signatureType 0 (EOA) → 401. Now stored in the nova_l2 session blob alongside credentials.' },
        { type: 'fix', text: 'C-3 (auth.js): atob() silently corrupted URL-safe base64 HMAC keys (- and _ chars). Normalize to standard base64 before atob() — wrong HMAC key on ~50% of secrets caused every signed request to return 401.' },
        { type: 'fix', text: 'C-4 (arb-ui.js): analyzeSelected() used "anchor" instead of "question" and omitted all price fields. .toFixed() on undefined threw TypeError — "Ask Pulse Agent" was completely broken for spread arb.' },
        { type: 'fix', text: 'H-1 (orders.js): salt was a JS Number, all other uint256 order fields are strings. CLOB API expects strings — JSON number for salt likely caused 422s on all live orders.' },
        { type: 'fix', text: 'H-2 (markets.js): selectMarket used onclick.toString().includes(id) — substring false-positive highlighted wrong markets. Now uses data-market-id attribute for exact matching.' },
        { type: 'fix', text: 'M-1 (arb.js): population std dev (÷n) used in z-score and spike RV calculations. Replaced with sample std dev (÷(n-1)) — inflated z-scores by ~5% at n=10.' },
        { type: 'fix', text: 'M-2 (auth.js): server clock offset never refreshed — stale after long sessions. Now auto-refreshes after 30 minutes in buildL2Headers().' },
        { type: 'fix', text: 'L-1 (settings.js): clearAll() did not reload the page — stale CFG in memory after clearing storage. Now reloads after 500ms.' },
        { type: 'fix', text: 'L-2 (markets.js): null endDate treated as epoch (1970) in date sort — open-ended markets appeared before all dated ones. Now pushed to end.' },
        { type: 'fix', text: 'L-3 (index.html): no user-visible indicator when ethers.js CDN fails — auth proceeds with lowercase address → 401. Added in-app banner warning.' },
      ],
    },
    {
      version: 'v1.1.19–21',
      date:    '2026-03-22',
      title:   'Proxy wallet, balance, token shape fixes',
      items: [
        { type: 'fix', text: 'v1.1.19: PM.proxyAddress set from L1 auth response — resolveProxyWallet() called before auth existed, always returned null. All live orders used signatureType 0 instead of 2 → CLOB rejected every order for deposited users.' },
        { type: 'fix', text: 'v1.1.20: Balance always showed $0 after connect — queried EOA not proxy wallet. Re-fetch triggered after authorize() sets PM.proxyAddress.' },
        { type: 'fix', text: 'v1.1.20: normalizeMarket() handles Gamma tokens object-array shape {token_id, outcome} — previously tokens[] was always empty for affected markets, "Could not determine token ID" on every order.' },
        { type: 'fix', text: 'v1.1.21: proxy.js parses URL once per request (was twice). Restored ANSI colors + OSC 8 clickable link in banner. S.searchQuery initialized in state.' },
      ],
    },
    {
      version: 'v1.1.18',
      date:    '2026-03-12',
      title:   'Bug fixes — Cyrillic, analyzeSignal, VERSION bump',
      items: [
        { type: 'fix', text: 'Fix 1: Cyrillic chars in clobSum variable (arb.js lines 154–163) — 0xD0 0xBE 0xD0 0xB1 (о,б) replaced with ASCII o,b. Worked in V8 but broke grep/linters/any ASCII parser.' },
        { type: 'fix', text: 'Fix 2: analyzeSignal() now handles SPREAD_ARB type — was falling through to spike scanner branch, sending Claude a prompt full of undefined/NaN fields. Added explicit SPREAD_ARB branch.' },
        { type: 'fix', text: 'Fix 3: VERSION bumped to 1.1.18 — /ping and debug changelog now report correct build.' },
        { type: 'fix', text: 'Fix 4 (critical): computeLegs (arb.js) and computeArb (calc.js) had YES/NO allocation swapped — yesAmt used noPrice and vice versa. Produced wildly unequal payouts on asymmetric markets (e.g. YES=30¢/NO=65¢: was +128% vs -51% depending on outcome). Fixed: yesAmt = capital × yesPrice / sum, noAmt = capital × noPrice / sum → equal shares and equal guaranteed payout.' },
        { type: 'fix', text: 'Fix 5: detail tab Overview/History did nothing on click — switching to Agents then back left agent cards in place. Fixed: Overview re-calls renderDetail(selected), History renders a clear stub.' },
        { type: 'fix', text: 'Fix 6: chart.js silently showed random demo data when CLOB history unavailable — indistinguishable from real history. Fixed: amber "Demo data — no history available" badge shown on chart-wrap when falling back to genDemoData().' },
      ],
    },
    {
      version: 'v1.1.17',
      date:    '2026-03-11',
      title:   'Audit fixes — all critical/high issues resolved',
      items: [
        { type: 'fix', text: 'Fix 1: renderArbList ReferenceError — applyFilter now calls Arb.renderList(); renderList added to window.Arb namespace' },
        { type: 'fix', text: 'Fix 2: ARB_CFG undeclared in arb-ui.js — replaced with hardcoded 10, eliminates ReferenceError in arb detail panel' },
        { type: 'fix', text: 'Fix 3: signer field corrected to PM.address (EOA) — was wrongly set to proxy wallet, silently failing on-chain sig verification' },
        { type: 'fix', text: 'Fix 4: VERSION bumped to 1.1.17 — /ping and debug panel now report correct build' },
        { type: 'fix', text: 'Fix 5: 429 infinite-loop closed — max 5 rate-limit retries before surfacing error' },
        { type: 'feat', text: 'Fix 6: Whales tab stubbed — renders "coming soon" instead of infinite spinner' },
        { type: 'fix', text: 'Fix 7: skippedNoChange dead variable removed from runVRPScan' },
        { type: 'fix', text: 'Fix 8: change24h diagnostic note added — spike scanner logs field name found (or none)' },
        { type: 'fix', text: 'Fix 9: stray {css,js,assets} empty directory removed from repo' },
        { type: 'fix', text: 'Fix 10: claude-sonnet-4-5 → claude-sonnet-4-6 in agents.js' },
      ],
    },
    {
      version: 'v1.1.3',
      date:    '2026-03-10',
      title:   'Risk Register fixes — Step 2 of Architecture Review',
      items: [
        { type: 'fix', text: 'R-ORDER-01: window._novaBalance (never set) replaced with S.wallet?.balance — live orders now unblocked' },
        { type: 'fix', text: 'R-ORDER-02: price ?? 0.5 default removed — throws "Market price unavailable" if price missing' },
        { type: 'fix', text: 'R-ORDER-03: timeout now checks fetchOpenOrders before surfacing error — prevents misleading "order failed" when it actually landed' },
        { type: 'fix', text: 'R-ORDER-04: conditionId fallback removed from extractTokenId — was wrong token type for CLOB, now throws explicitly' },
        { type: 'fix', text: 'R-ORDER-05: Open Orders section added to sidebar Positions tab with per-order Cancel button' },
        { type: 'fix', text: 'R-AUTH-01: buildL2Headers now applies server clock offset computed at auth time — eliminates order 401s from local clock drift' },
        { type: 'fix', text: 'R-AUTH-02: onAccountsChanged clears L2 creds before reconnecting — prevents stale credentials from old account being used' },
        { type: 'fix', text: 'R-NET-01: 429 responses now read Retry-After header and back off before retrying' },
        { type: 'fix', text: 'R-NET-03: null balance from unreachable RPC treated as "unavailable" not $0 — clear error message instead of blocking with confusing message' },
        { type: 'fix', text: 'R-STATE-01: apiFetch re-detects proxy on localhost connection refused — proxy status dot stays accurate after mid-session restart' },
        { type: 'fix', text: 'R-DATA-02: appendLog now persists to sessionStorage — debug log survives chainChanged page reloads' },
      ],
    },
    {
      version: 'v1.0.0',
      date:    '2026-03-09',
      title:   'NOVA — Initial Release',
      items: [
        { type: 'feat', text: 'Complete rebuild from APEX prototype — multi-file architecture, proper JS modules, CSS separate' },
        { type: 'feat', text: 'auth.js — L1 EIP-712 + L2 HMAC with all known bugs fixed from day one' },
        { type: 'feat', text: 'constants.js — all magic numbers, addresses, rules documented in one place' },
        { type: 'feat', text: 'state.js — PM.makerAddress getter, PM.reset(), single source of truth' },
        { type: 'feat', text: 'validateAuthPayload() canary — fires console.assert before every wallet sign' },
        { type: 'feat', text: 'Modular agent system — Oracle, Vega, Pulse, Shield, Echo via agents.js' },
        { type: 'feat', text: 'Proper error handling — apiFetch() normalizes all errors to { ok, data, error, status }' },
        { type: 'feat', text: 'Git version controlled from line 1' },
      ],
    },
    {
      version: 'APEX lessons',
      date:    'Prototype',
      title:   'Bugs fixed in NOVA from day one',
      items: [
        { type: 'fix', text: 'nonce: Number(0) — uint256 must be JSON integer, never string "0"' },
        { type: 'fix', text: 'EIP712Domain removed from types — causes hash mismatch → 401' },
        { type: 'fix', text: 'ethers.utils.getAddress() — Phantom returns lowercase, Polymarket needs EIP-55' },
        { type: 'fix', text: 'Proxy re-uppercases POLY_* headers — Node.js lowercases all headers' },
        { type: 'fix', text: 'PM.makerAddress getter — was undefined, caused fetchBalance(undefined) → balance "—"' },
        { type: 'fix', text: 'USDC.e contract (0x2791…) hardcoded in constants, not scattered across codebase' },
      ],
    },
  ];

  el.innerHTML = entries.map(e => `
    <div style="margin-bottom:16px">
      <div style="font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--blue);margin-bottom:8px">
        ${e.version} · ${e.date} · ${e.title}
      </div>
      ${e.items.map(i => {
        const colors = { feat:'var(--blue)', fix:'var(--green)', bug:'var(--red)' };
        return `<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid var(--border);font-size:11px">
          <span style="color:${colors[i.type]||'var(--text2)'};font-size:9px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;flex-shrink:0;width:28px">${i.type}</span>
          <span style="color:var(--text2)">${i.text}</span>
        </div>`;
      }).join('')}
    </div>`).join('');
}
