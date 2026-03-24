/**
 * NOVA — Main Bootstrap
 * Wires all modules. This is the only file that imports everything.
 * Feature modules import only what they need from constants/state/utils.
 */

import { S, PM, CFG, SIM } from './state.js';
import { STORAGE, TOAST_DURATION, REFRESH_INTERVAL, VERSION } from './constants.js';
import { load, save, fmtUSD, fmtPnL, shortAddr, debounce, trunc, esc } from './utils.js';
import { detectProxy } from './api.js';
import { connectWallet, disconnectWallet, authorize as authWallet, autoDetectWallet, detectAvailableWallets } from './wallet.js';
import { fetchAndRenderMarkets, filterMarkets, selectMarket, renderDetail } from './markets.js';
import { renderSidebar } from './sidebar.js';
import { loadSettings, renderSettingsPanel } from './settings.js';
import { appendLog, renderChangelog } from './debug.js';
import './arb-ui.js'; // registers window.Arb as side-effect
import './calc.js';   // registers window.Calc as side-effect

// ── Expose globals for inline onclick handlers ────────────────────────────
// NOTE: Do NOT pre-assign window.Arb / window.Settings / window.Debug / window.Calc here.
// Those modules assign window.X themselves as a side-effect when they evaluate.
// Pre-assigning empty objects here would overwrite their real implementations
// because ES module imports evaluate before this file's top-level code continues.

// ── Toast ─────────────────────────────────────────────────────────────────
let _toastTimer;
window.showToast = function(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show ' + type;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.className = '', TOAST_DURATION);
};

// ── App ───────────────────────────────────────────────────────────────────
window.App = {
  async init() {
    console.log(`[NOVA] v${VERSION} — starting`);
    appendLog('NOVA v' + VERSION + ' initializing…');

    // Load persisted settings
    loadSettings();
    renderSettingsPanel();

    // Detect proxy
    const proxyUp = await detectProxy();
    document.getElementById('proxy-dot').className = proxyUp ? 'live' : 'dead';
    document.getElementById('proxy-dot').title = proxyUp ? 'Proxy active' : 'Proxy offline — backend unavailable';

    // Auto-detect wallet
    try {
      await autoDetectWallet();
    } catch (e) {
      console.log('[NOVA] Auto-detect wallet:', e.message);
    }

    // Load markets
    await fetchAndRenderMarkets();

    // Auto-refresh
    setInterval(() => fetchAndRenderMarkets(true), REFRESH_INTERVAL);

    // Render changelog in debug panel
    renderChangelog();

    appendLog('Boot complete', 'ok');
    console.log('[NOVA] Boot complete');
  },

  async toggleWallet() {
    if (PM.connected) {
      disconnectWallet();
      this._onDisconnect();
    } else {
      this._openWalletPicker();
    }
  },

  _openWalletPicker() {
    const wallets  = detectAvailableWallets();
    const optionsEl = document.getElementById('wallet-picker-options');
    const statusEl  = document.getElementById('wallet-picker-status');
    if (!optionsEl) return;

    statusEl.textContent = '';

    if (!wallets.length) {
      optionsEl.innerHTML = `
        <div style="text-align:center;padding:20px 0">
          <div style="font-size:28px;margin-bottom:10px">⚠</div>
          <div style="font-size:13px;color:var(--text2);margin-bottom:6px">No EVM wallet detected</div>
          <div style="font-size:11px;color:var(--text3);line-height:1.6">
            Install <a href="https://phantom.app" target="_blank" style="color:var(--blue)">Phantom</a>
            or <a href="https://metamask.io" target="_blank" style="color:var(--blue)">MetaMask</a>
            and refresh the page.
          </div>
        </div>`;
    } else {
      optionsEl.innerHTML = wallets.map(w => `
        <button class="wallet-option-btn" data-testid="wallet-option-${w.id}-button" onclick="App._connectWith('${w.id}')" id="wallet-opt-${w.id}">
          <span class="wo-icon">${w.icon}</span>
          <div class="wo-meta">
            <span class="wo-name">${w.name}</span>
            <span class="wo-desc">${w.desc}</span>
          </div>
          <span class="wo-arrow">→</span>
        </button>`).join('');
    }

    // Inject picker styles once
    if (!document.getElementById('wallet-picker-styles')) {
      const s = document.createElement('style');
      s.id = 'wallet-picker-styles';
      s.textContent = `
        .wallet-option-btn {
          display: flex; align-items: center; gap: 14px;
          width: 100%; padding: 14px 16px;
          background: var(--surface2); border: 1px solid var(--border2);
          border-radius: var(--radius2); cursor: pointer;
          transition: all var(--t); text-align: left;
          font-family: var(--font-ui);
        }
        .wallet-option-btn:hover { background: var(--surface3); border-color: var(--blue); }
        .wallet-option-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .wo-icon  { font-size: 28px; flex-shrink: 0; }
        .wo-meta  { display: flex; flex-direction: column; gap: 2px; flex: 1; }
        .wo-name  { font-size: 14px; font-weight: 600; color: var(--text); }
        .wo-desc  { font-size: 11px; color: var(--text3); }
        .wo-arrow { font-size: 14px; color: var(--text3); flex-shrink: 0; }
        .wallet-option-btn:hover .wo-arrow { color: var(--blue); }
        #wallet-picker-status.connecting { color: var(--text2); }
        #wallet-picker-status.error      { color: var(--red); }
      `;
      document.head.appendChild(s);
    }

    document.getElementById('wallet-picker-modal').classList.add('open');
  },

  async _connectWith(walletId) {
    const wallets  = detectAvailableWallets();
    const wallet   = wallets.find(w => w.id === walletId);
    const statusEl = document.getElementById('wallet-picker-status');

    if (!wallet) return;

    // Disable all buttons while connecting
    document.querySelectorAll('.wallet-option-btn').forEach(b => b.disabled = true);
    statusEl.className = 'connecting';
    statusEl.textContent = `Connecting to ${wallet.name}…`;

    try {
      await connectWallet(wallet.provider);
      document.getElementById('wallet-picker-modal').classList.remove('open');
      this._onConnect();
    } catch (err) {
      statusEl.className = 'error';
      statusEl.textContent = '✗ ' + err.message;
      document.querySelectorAll('.wallet-option-btn').forEach(b => b.disabled = false);
      appendLog('Wallet error: ' + err.message, 'error');
    }
  },

  _closeWalletPicker(e) {
    if (e && e.target.id !== 'wallet-picker-modal') return;
    document.getElementById('wallet-picker-modal').classList.remove('open');
  },

  async authorize() {
    try {
      showToast('Sign the auth message in your wallet…', 'info');
      await authWallet();
      document.getElementById('auth-btn').style.display = 'none';
      showToast('✓ Authorized — ready to trade', 'success');
      appendLog('L2 auth complete', 'ok');
    } catch (err) {
      showToast(err.message, 'error');
      appendLog('Auth error: ' + err.message, 'error');
    }
  },

  _onConnect() {
    const btn = document.getElementById('wallet-btn');
    btn.textContent = shortAddr(PM.makerAddress);
    btn.className = 'tb-btn connected';

    // Show auth button if not yet authorized
    if (!PM.hasL2) {
      document.getElementById('auth-btn').style.display = '';
    }

    // Update topbar metrics
    this._updateMetrics();
    renderSidebar('wallet');

    showToast('✓ Wallet connected', 'success');
    appendLog('Wallet connected: ' + PM.address?.slice(0, 14) + '…', 'ok');
  },

  _onDisconnect() {
    const btn = document.getElementById('wallet-btn');
    btn.textContent = 'Connect Wallet';
    btn.className = 'tb-btn';
    document.getElementById('auth-btn').style.display = 'none';
    document.getElementById('tb-balance').textContent = '—';
    document.getElementById('tb-pnl').textContent = '—';
    renderSidebar('wallet');
    showToast('Wallet disconnected', 'info');
  },

  _updateMetrics() {
    if (!S.wallet) return;
    const bal = S.wallet.balance;
    const pnl = S.wallet.pnl;
    document.getElementById('tb-balance').textContent = bal != null ? '$' + bal.toFixed(0) : '—';
    const pnlEl = document.getElementById('tb-pnl');
    pnlEl.textContent = pnl != null ? (pnl >= 0 ? '+' : '') + '$' + Math.abs(pnl).toFixed(0) : '—';
    pnlEl.className = 'tb-val mono-num ' + (pnl >= 0 ? 'val-green' : 'val-red');
  },
};

// ── UI ────────────────────────────────────────────────────────────────────
window.UI = {
  switchView(name, el) {
    // Hide all view panes
    document.querySelectorAll('.view-pane').forEach(p => {
      p.style.display = 'none';
      p.classList.remove('active');
    });

    // Show selected
    const target = document.getElementById('view-' + name);
    if (target) {
      target.style.display = name === 'markets' ? 'contents' : 'flex';
      target.classList.add('active');
    }

    // Update nav tabs
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    el?.classList.add('active');

    S.activeView = name;
    appendLog('View: ' + name);

    // Auto-render Calculators tab on first switch
    if (name === 'calculators' && !document.getElementById('calc-content')?.children.length) {
      // Calc module sets window.Calc — render default tab
      window.Calc?.switchTab(S.activeCalcTab || 'ev',
        document.querySelector('#calc-tabs .btn'));
    }
  },

  switchDetailTab(name, el) {
    document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
    el?.classList.add('active');

    if (name === 'agents' && S.selected) {
      import('./agents-ui.js').then(m => m.renderAgentsTab(S.selected));

    } else if (name === 'overview' && S.selected) {
      // Re-render market detail so switching back from Agents restores the overview.
      // Without this, detail-content is left showing agent cards after tab switch.
      renderDetail(S.selected);

    } else if (name === 'history') {
      // History tab: stub until full CLOB trade-history view is built.
      // Renders a clear placeholder so it doesn't appear broken.
      const el = document.getElementById('detail-content');
      if (el) {
        el.innerHTML = `
          <div class="empty-state" style="padding-top:60px">
            <div class="es-icon">📜</div>
            <div class="es-text" style="margin-bottom:8px">Trade History — Coming Soon</div>
            <div style="font-size:11px;color:var(--text3);max-width:280px;text-align:center;line-height:1.6">
              Full CLOB trade history and order book depth will display here.
              Use the Overview chart for price history in the meantime.
            </div>
          </div>`;
      }
    }
  },

  switchSideTab(name, el) {
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    el?.classList.add('active');
    renderSidebar(name);
  },

  openSettings() {
    document.getElementById('settings-modal').classList.add('open');
  },

  toggleDebug() {
    document.getElementById('debug-panel').classList.toggle('open');
  },

  openModal() {
    document.getElementById('order-modal').classList.add('open');
  },

  closeModal() {
    document.getElementById('order-modal').classList.remove('open');
  },

  closeModalOnOverlay(e) {
    if (e.target.id === 'order-modal') this.closeModal();
  },
};

// ── Markets namespace ─────────────────────────────────────────────────────
window.Markets = {
  setFilter(f, el) {
    document.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('on'));
    el?.classList.add('on');
    S.filter = f;
    filterMarkets();
  },

  onSearch: debounce(function(val) {
    S.searchQuery = val;
    filterMarkets();
  }, 250),
};

// ── ArbView ───────────────────────────────────────────────────────────────
window.ArbView = {
  _activeTab: 'spread',

  switchTab(name, el) {
    this._activeTab = name;
    document.querySelectorAll('.arb-type-tab').forEach(t => t.classList.remove('active'));
    el?.classList.add('active');

    document.getElementById('arb-spread-view').style.display = name === 'spread' ? 'flex' : 'none';
    document.getElementById('arb-stat-view').style.display   = name === 'stat'   ? 'flex' : 'none';
    document.getElementById('arb-vrp-view').style.display    = name === 'vrp'    ? 'flex' : 'none';
    document.getElementById('arb-spread-filters').style.display = name === 'spread' ? 'flex' : 'none';

    // Render if data already loaded
    if (name === 'stat' && S.statArb?.length)   this._renderStatArb(S.statArb);
    if (name === 'vrp'  && S.vrpSignals?.length) this._renderVRP(S.vrpSignals);
  },

  applyFilter() {
    const minProfit = parseFloat(document.getElementById('arb-min-profit')?.value) || 0;
    const category  = document.getElementById('arb-cat-filter')?.value || 'all';
    Arb.renderList({ minProfit, category });
    this._updateCount();
  },

  _updateCount() {
    const el = document.getElementById('arb-count');
    if (!el) return;
    const n = S.arbResults?.length || 0;
    el.textContent = n ? `${n} found` : '';
  },

  afterScan(results) {
    this._updateCount();
    if (this._activeTab === 'stat') this._renderStatArb(results.stat);
    if (this._activeTab === 'vrp')  this._renderVRP(results.vrp);
  },

  _renderStatArb(signals) {
    const el = document.getElementById('arb-stat-view');
    if (!el) return;
    if (!signals?.length) {
      el.innerHTML = `<div class="empty-state"><div class="es-icon">📊</div><div class="es-text">No stat-arb signals above z-score threshold (${2.0}σ)</div></div>`;
      return;
    }
    el.innerHTML = `
      <div style="max-width:700px;width:100%">
        <div class="section-title" style="margin-bottom:14px">Statistical Arbitrage — ${signals.length} signal${signals.length !== 1 ? 's' : ''}</div>
        ${signals.map(s => this._statArbCard(s)).join('')}
      </div>`;
  },

  _statArbCard(s) {
    const hasZ   = s.zScore !== null && s.zScore !== undefined;
    const isLead = s.dataSource === 'midpoint_only';

    const strengthBadge = s.strength
      ? `<span class="badge badge-${s.strength === 'STRONG' ? 'green' : s.strength === 'MODERATE' ? 'amber' : 'blue'}">${s.strength}</span>`
      : `<span class="badge" style="background:rgba(255,255,255,0.06);color:var(--text3)">LEAD</span>`;

    const zDisplay = hasZ
      ? `<span style="font-family:var(--font-mono);font-size:11px;color:var(--text2)">z = ${s.zScore}σ</span>`
      : `<span style="font-size:10px;color:var(--text3)">no history</span>`;

    const statsBlock = hasZ ? `
        <div class="arb-stat"><span>Spread (current)</span><span>${s.spread}</span></div>
        <div class="arb-stat"><span>30d mean</span><span>${s.spreadMean}</span></div>
        <div class="arb-stat"><span>30d σ</span><span>${s.spreadStd}</span></div>
        <div class="arb-stat"><span>Observations</span><span>${s.nObs} hrs</span></div>
        ${s.sizing ? `<div class="arb-stat"><span>Bankroll %</span><span class="val-green">${s.sizing.recommendedBankrollPct}%</span></div>
        <div class="arb-stat"><span>Leg edge</span><span>${s.sizing.legEdgePct}%</span></div>` : ''}
      ` : `
        <div class="arb-stat"><span>Raw spread</span><span>${s.spread}</span></div>
        <div style="font-size:10px;color:var(--amber);margin-top:6px;padding:6px 8px;background:rgba(255,184,0,0.08);border-radius:4px;border-left:2px solid var(--amber)">
          ⚠ No price history — z-score unavailable. Do not size a position from this signal.
        </div>
      `;

    return `
      <div class="arb-card" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          ${strengthBadge}
          ${zDisplay}
          <span class="mkt-cat ${s.category}" style="margin-left:auto">${s.category}</span>
        </div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:8px;line-height:1.5">
          <strong style="color:var(--text)">${esc(trunc(s.anchor, 60))}</strong><br>
          <span style="color:var(--text3)">vs</span>
          <strong style="color:var(--text)">${esc(trunc(s.leg, 60))}</strong>
        </div>
        <div style="font-size:10px;color:var(--blue);margin-bottom:8px;font-style:italic">${esc(s.edgeDirection)}</div>
        ${statsBlock}
        <div style="font-size:10px;color:var(--text3);margin-top:8px;line-height:1.5">${esc(s.rationale)}</div>
      </div>`;
  },

  _renderVRP(signals) {
    const el = document.getElementById('arb-vrp-view');
    if (!el) return;
    if (!signals?.length) {
      el.innerHTML = `<div class="empty-state"><div class="es-icon">📡</div><div class="es-text">No VRP signals found — try markets with higher volume</div></div>`;
      return;
    }
    el.innerHTML = `
      <div style="max-width:700px;width:100%">
        <div class="section-title" style="margin-bottom:14px">Price Spikes — ${signals.length} signal${signals.length !== 1 ? 's' : ''}</div>
        ${signals.map(s => this._vrpCard(s)).join('')}
      </div>`;
  },

  _vrpCard(s) {
    // "VRP" tab repurposed as Price Spike scanner — signals backed by real
    // realized volatility computed from CLOB price history, not fabricated IV.
    const spikeRatioParsed = parseFloat(s.spikeRatio || s.vrpGap || 0);
    const dailyRVPct = s.dailyRV != null ? (parseFloat(s.dailyRV) * 100).toFixed(2) : null;
    const movePct    = s.change24h != null ? (Math.abs(s.change24h) * 100).toFixed(2) : null;

    return `
      <div class="arb-card" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span class="badge badge-${s.strength === 'STRONG' ? 'green' : s.strength === 'MODERATE' ? 'amber' : 'blue'}">${s.strength}</span>
          <span class="badge badge-purple">${s.edgeType || s.scannerLabel || 'SPIKE'}</span>
          <span class="mkt-cat ${s.category}" style="margin-left:auto">${s.category}</span>
        </div>
        <div style="font-size:12px;font-weight:500;color:var(--text);margin-bottom:8px;line-height:1.4">${esc(trunc(s.market, 80))}</div>
        <div class="arb-stat"><span>YES price</span><span class="val-${s.yesPrice > 0.5 ? 'green' : 'red'}">${(s.yesPrice * 100).toFixed(1)}¢</span></div>
        ${movePct    ? `<div class="arb-stat"><span>24h move</span><span style="color:${s.change24h > 0 ? 'var(--green)' : 'var(--red)'}">${s.change24h > 0 ? '+' : ''}${(s.change24h * 100).toFixed(2)}¢</span></div>` : ''}
        ${dailyRVPct ? `<div class="arb-stat"><span>14d daily RV (σ)</span><span>${dailyRVPct}¢ <span style="color:var(--text3);font-size:10px">(${s.nObs} hourly obs)</span></span></div>` : ''}
        <div class="arb-stat"><span>Spike ratio</span><span class="val-green">${spikeRatioParsed.toFixed(1)}× normal range</span></div>
        <div class="arb-stat"><span>Direction</span><span style="color:${s.direction === 'FADE_UP' ? 'var(--red)' : 'var(--green)'}">${s.direction}</span></div>
        ${s.sizing ? `<div class="arb-stat"><span>Kelly (¼)</span><span class="val-green">${s.sizing.quarter}% bankroll</span></div>
        <div class="arb-stat"><span>EV</span><span class="${parseFloat(s.sizing.ev) > 0 ? 'val-green' : 'val-red'}">${s.sizing.ev}%</span></div>` : ''}
        <div style="font-size:10px;color:var(--text3);margin-top:8px;line-height:1.5">${esc(s.rationale)}</div>
      </div>`;
  },
};
// ── Order Modal ───────────────────────────────────────────────────────────
// Opens the order placement modal pre-filled for the selected market/side.
// Called from onclick handlers in markets.js renderDetail template.
window.openOrderModal = function(side) {
  const m = S.selected;
  if (!m) return;

  const price     = side === 'YES' ? m.yesPrice : m.noPrice;
  const priceDisp = (price * 100).toFixed(1);
  const defaultAmt = CFG.defaultOrderAmt || 10;
  const balance   = SIM.enabled ? SIM.balance : (S.wallet?.balance ?? null);
  const balDisp   = balance != null ? '$' + balance.toFixed(2) : '—';
  const sideColor = side === 'YES' ? 'var(--green)' : 'var(--red)';
  const sideClass = side === 'YES' ? 'btn-green' : 'btn-red';

  const body = document.getElementById('order-modal-body');
  if (!body) return;

  body.innerHTML = `
    <div style="margin-bottom:14px">
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">Market</div>
      <div style="font-size:12px;color:var(--text2);line-height:1.4">${esc(trunc(m.question, 90))}</div>
    </div>

    <div style="display:flex;gap:12px;margin-bottom:16px">
      <div style="flex:1;background:var(--surface2);border-radius:var(--radius);padding:10px;text-align:center">
        <div style="font-size:10px;color:var(--text3);margin-bottom:3px">Side</div>
        <div style="font-size:16px;font-weight:700;color:${sideColor}">${side}</div>
      </div>
      <div style="flex:1;background:var(--surface2);border-radius:var(--radius);padding:10px;text-align:center">
        <div style="font-size:10px;color:var(--text3);margin-bottom:3px">Price</div>
        <div style="font-size:16px;font-weight:700;font-family:var(--font-mono)">${priceDisp}¢</div>
      </div>
      <div style="flex:1;background:var(--surface2);border-radius:var(--radius);padding:10px;text-align:center">
        <div style="font-size:10px;color:var(--text3);margin-bottom:3px">Balance</div>
        <div style="font-size:13px;font-weight:600;font-family:var(--font-mono)">${balDisp}</div>
      </div>
    </div>

    <div style="margin-bottom:16px">
      <label style="display:flex;flex-direction:column;gap:6px">
        <span style="font-size:11px;color:var(--text2)">Order Amount (USDC)</span>
        <div style="display:flex;align-items:center;gap:8px">
          <input id="order-amount-input" data-testid="order-amount-input" type="number" min="1" max="10000" step="1"
            value="${defaultAmt}"
            style="flex:1;padding:9px 12px;background:var(--surface2);border:1px solid var(--border2);border-radius:var(--radius);color:var(--text);font-size:15px;font-family:var(--font-mono)"
            oninput="openOrderModal._updateShares(this.value)"
          >
          <span style="font-size:11px;color:var(--text3);white-space:nowrap">≈ <span id="order-shares-disp" data-testid="order-share-estimate">${(defaultAmt / price).toFixed(1)}</span> shares</span>
        </div>
        <div style="display:flex;gap:6px">
          ${[10,25,50,100].map(n =>
            `<button class="btn btn-xs btn-ghost" data-testid="order-quick-amount-${n}-button" onclick="document.getElementById('order-amount-input').value=${n};openOrderModal._updateShares(${n})">$${n}</button>`
          ).join('')}
        </div>
      </label>
    </div>

    ${SIM.enabled ? `<div style="font-size:10px;color:var(--amber);background:var(--amber-dim);border:1px solid rgba(255,184,0,0.2);border-radius:var(--radius);padding:6px 10px;margin-bottom:12px">⚡ Simulation Mode — no real funds used</div>` : ''}
    ${!PM.connected && !SIM.enabled ? `<div style="font-size:10px;color:var(--red);background:var(--red-dim);border:1px solid rgba(255,59,92,0.2);border-radius:var(--radius);padding:6px 10px;margin-bottom:12px">⚠ Wallet not connected</div>` : ''}
    ${PM.connected && !PM.hasL2 && !SIM.enabled ? `<div style="font-size:10px;color:var(--amber);background:var(--amber-dim);border:1px solid rgba(255,184,0,0.2);border-radius:var(--radius);padding:6px 10px;margin-bottom:12px">⚡ Click Authorize in the topbar before placing live orders</div>` : ''}

    <div id="order-status" data-testid="order-status-message" style="font-size:11px;margin-bottom:8px;min-height:18px"></div>

    <button class="btn ${sideClass}" style="width:100%;padding:10px"
      id="order-submit-btn"
      data-testid="order-submit-button"
      onclick="openOrderModal._submit('${side}')">
      Buy ${side} — <span id="order-btn-price">${priceDisp}¢</span>
    </button>`;

  UI.openModal();
};

// Helpers attached to the function so they're accessible from inline handlers
openOrderModal._updateShares = function(amtStr) {
  const m     = S.selected;
  const side  = document.getElementById('order-submit-btn')?.textContent?.includes('YES') ? 'YES' : 'NO';
  const price = m ? (side === 'YES' ? m.yesPrice : m.noPrice) : 0.5;
  const amt   = parseFloat(amtStr) || 0;
  const el    = document.getElementById('order-shares-disp');
  if (el) el.textContent = price > 0 ? (amt / price).toFixed(1) : '—';
};

openOrderModal._submit = async function(side) {
  const m      = S.selected;
  const btn    = document.getElementById('order-submit-btn');
  const status = document.getElementById('order-status');
  const amt    = parseFloat(document.getElementById('order-amount-input')?.value) || 0;

  if (!m || amt <= 0) {
    if (status) { status.textContent = '⚠ Enter a valid amount'; status.style.color = 'var(--amber)'; }
    return;
  }

  btn.disabled     = true;
  btn.textContent  = 'Placing order…';
  if (status) { status.textContent = ''; }

  try {
    const { submitOrder } = await import('./orders.js');
    await submitOrder({ market: m, side, amountUSD: amt });
    if (status) { status.textContent = '✓ Order submitted'; status.style.color = 'var(--green)'; }
    btn.textContent = '✓ Done';
    showToast(`${side} order placed — $${amt}`, 'success');
    appendLog(`Order: ${side} $${amt} on "${trunc(m.question, 40)}"`, 'ok');
    setTimeout(() => UI.closeModal(), 1200);
  } catch (err) {
    if (status) { status.textContent = '✗ ' + err.message; status.style.color = 'var(--red)'; }
    btn.disabled    = false;
    btn.textContent = `Buy ${side}`;
    showToast(err.message, 'error');
    appendLog('Order failed: ' + err.message, 'error');
  }
};

// ── Polymarket Link ───────────────────────────────────────────────────────
window.openPolymarketLink = function() {
  const m = S.selected;
  if (!m) return;
  const url = m.gammaUrl
    || (m.slug       ? `https://polymarket.com/event/${m.slug}` : null)
    || (m.groupSlug  ? `https://polymarket.com/event/${m.groupSlug}` : null)
    || (m.conditionId? `https://polymarket.com/market/${m.conditionId}` : null);
  if (url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    showToast('No Polymarket link available for this market', 'info');
  }
};

document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && e.key === 'D') {
    e.preventDefault();
    UI.toggleDebug();
  }
  if (e.key === 'Escape') {
    UI.closeModal();
    Settings.close();
    document.getElementById('wallet-picker-modal')?.classList.remove('open');
  }
});

// ── Listen for wallet events ──────────────────────────────────────────────
window.addEventListener('nova:walletConnected',  () => App._onConnect());
window.addEventListener('nova:walletDisconnected', () => App._onDisconnect());
// Fired by wallet.js:authorize() after it re-fetches balance from the proxy wallet.
// Re-renders the topbar balance and sidebar so the correct USDC amount shows up.
window.addEventListener('nova:balanceUpdated', () => {
  App._updateMetrics();
  renderSidebar('wallet');
});

// ── Boot ──────────────────────────────────────────────────────────────────
if (!window.__NOVA_BOOTSTRAPPED__) {
  window.__NOVA_BOOTSTRAPPED__ = true;
  App.init();
}
