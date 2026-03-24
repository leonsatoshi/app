/**
 * NOVA — Sidebar Module
 */

import { S, PM, SIM, CFG } from './state.js';
import { fmtUSD, fmtPnL, shortAddr, esc, trunc, load, save } from './utils.js';
import { STORAGE as KEYS } from './constants.js';
import { fetchOpenOrders, cancelOrder } from './api.js';
import { buildL2Headers } from './auth.js';
import { pushActivityItem } from './orders.js';

export function renderSidebar(tab = 'wallet') {
  const el = document.getElementById('sidebar-content');
  if (!el) return;

  if (tab === 'wallet')     el.innerHTML = renderWalletTab();
  if (tab === 'positions')  renderPositionsTab(el);  // async — fetches open orders
  if (tab === 'watchlist')  el.innerHTML = renderWatchlistTab();
}

function renderWalletTab() {
  if (SIM.enabled) {
    return `<div class="section-title">Simulation Mode</div>
    <div class="wallet-stat"><span class="ws-label">Balance</span><span class="ws-val val-blue" data-testid="sim-balance-value">$${SIM.balance.toFixed(2)}</span></div>
    <div class="wallet-stat"><span class="ws-label">Orders</span><span class="ws-val" data-testid="sim-orders-value">${SIM.orders.length}</span></div>
    <div class="wallet-stat"><span class="ws-label">Address</span><span class="ws-val" data-testid="sim-address-value" style="font-size:9px">SIM</span></div>
    ${renderGuidedChecklist()}`;
  }

  if (!PM.connected || !S.wallet) {
    return `${renderGuidedChecklist(true)}`;
  }

  const w = S.wallet;
  const pnlClass = (w.pnl || 0) >= 0 ? 'val-green' : 'val-red';

  return `<div class="section-title">Portfolio</div>
    <div class="wallet-stat">
      <span class="ws-label">${PM.proxyAddress ? 'Proxy Wallet' : 'Address'}</span>
      <span class="ws-val" data-testid="wallet-address-value" style="font-size:10px;font-family:var(--font-mono)">${shortAddr(PM.makerAddress)}</span>
    </div>
    ${PM.proxyAddress ? `<div class="wallet-stat">
      <span class="ws-label">Signer (EOA)</span>
      <span class="ws-val" data-testid="wallet-signer-value" style="font-size:10px;font-family:var(--font-mono)">${shortAddr(PM.address)}</span>
    </div>` : ''}
    <div class="wallet-stat">
      <span class="ws-label">USDC Balance</span>
      <span class="ws-val val-blue" data-testid="wallet-balance-value">${w.balance != null ? fmtUSD(w.balance) : '—'}</span>
    </div>
    <div class="wallet-stat">
      <span class="ws-label">Positions</span>
      <span class="ws-val" data-testid="wallet-positions-count">${w.positions?.length || 0}</span>
    </div>
    <div class="wallet-stat">
      <span class="ws-label">P&L</span>
      <span class="ws-val ${pnlClass}" data-testid="wallet-pnl-value">${w.pnl != null ? fmtPnL(w.pnl) : '—'}</span>
    </div>
    <div class="wallet-stat">
      <span class="ws-label">L2 Auth</span>
      <span class="ws-val ${PM.hasL2 ? 'val-green' : 'val-amber'}" data-testid="wallet-auth-status">${PM.hasL2 ? '✓ Active' : '⚡ Needed'}</span>
    </div>
    ${renderGuidedChecklist()}`;
}

function renderGuidedChecklist(showIntro = false) {
  const steps = [
    { label: 'Connect an EVM wallet', done: PM.connected, hint: PM.connected ? shortAddr(PM.address || PM.makerAddress) : 'Use Phantom or MetaMask in this browser' },
    { label: 'Authorize Polymarket access', done: PM.hasL2, hint: PM.hasL2 ? 'Authorization active' : 'Click the Authorize button in the topbar' },
    { label: 'Enable live trading', done: CFG.tradingEnabled || SIM.enabled, hint: SIM.enabled ? 'Simulation mode enabled' : 'Turn on Live Trading in Settings when ready' },
    { label: 'Confirm balance visibility', done: SIM.enabled || S.wallet?.balance != null, hint: SIM.enabled ? 'Simulation balance ready' : (S.wallet?.balance != null ? fmtUSD(S.wallet.balance) : 'Balance appears after connection/authorization') },
    { label: 'Place a small validation order', done: S.orderActivity.some(item => ['submitted', 'sim-filled', 'cancelled'].includes(item.status)), hint: 'Use a small amount and review Order Activity in Positions' },
  ];

  return `
    <div class="settings-section" data-testid="wallet-test-guide">
      <div class="section-title">Live Wallet Test Guide</div>
      ${showIntro ? `<div style="font-size:11px;color:var(--text2);line-height:1.6;margin-bottom:10px">Use this checklist to validate your own wallet in-browser without guessing the next step.</div>` : ''}
      ${steps.map((step, index) => `
        <div class="wallet-stat" data-testid="wallet-guide-step-${index + 1}">
          <span class="ws-label" style="display:flex;align-items:center;gap:8px">
            <span style="width:8px;height:8px;border-radius:999px;background:${step.done ? 'var(--green)' : 'var(--border2)'};display:inline-block"></span>
            ${step.label}
          </span>
          <span class="ws-val" style="font-size:10px;color:${step.done ? 'var(--green)' : 'var(--text3)'}">${step.done ? 'Done' : 'Pending'}</span>
        </div>
        <div style="font-size:10px;color:var(--text3);margin:-6px 0 8px 18px;line-height:1.6">${step.hint}</div>`).join('')}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn btn-sm btn-primary" data-testid="wallet-guide-connect-button" onclick="App.toggleWallet()">Connect</button>
        <button class="btn btn-sm btn-ghost" data-testid="wallet-guide-authorize-button" onclick="App.authorize()">Authorize</button>
        <button class="btn btn-sm btn-ghost" data-testid="wallet-guide-settings-button" onclick="UI.openSettings()">Settings</button>
      </div>
    </div>`;
}

function renderOrderActivity() {
  const filtered = S.orderActivity.filter(item => S.activityFilter === 'all' ? true : item.category === S.activityFilter);
  if (!filtered.length) {
    return `<div class="empty-state" style="padding:8px 0"><div class="es-text" style="font-size:11px">No live order activity yet</div></div>`;
  }

  return filtered.slice(0, 10).map(item => {
    const tone = {
      submitted: 'var(--green)',
      cancelled: 'var(--amber)',
      failed: 'var(--red)',
      'sim-filled': 'var(--blue)',
      signing: 'var(--text2)',
      connected: 'var(--blue)',
      disconnected: 'var(--text3)',
      authorized: 'var(--green)',
      'live-ready': 'var(--green)',
      review: 'var(--amber)',
    }[item.status] || 'var(--text2)';
    return `
      <div class="position-item" data-testid="order-activity-item-${esc(item.id)}" style="border-left:2px solid ${tone}">
        <div class="pos-question" style="font-size:11px">${esc(trunc(item.market || 'Order event', 58))}</div>
        <div class="pos-meta" style="gap:6px;flex-wrap:wrap">
          <span style="color:var(--text3);text-transform:uppercase">${esc(item.category || 'order')}</span>
          <span style="color:${tone};text-transform:uppercase">${esc(item.status)}</span>
          ${item.side ? `<span>${esc(item.side)}</span>` : ''}
          ${item.amountUSD != null ? `<span>$${Number(item.amountUSD).toFixed(2)}</span>` : ''}
          <span style="margin-left:auto">${new Date(item.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        ${item.note ? `<div style="font-size:10px;color:var(--text3);margin-top:6px;line-height:1.5">${esc(item.note)}</div>` : ''}
      </div>`;
  }).join('');
}

// R-ORDER-05: positions tab now shows both filled positions AND open CLOB orders.
// Open orders are GTC and accumulate silently — users need visibility + cancel control.
async function renderPositionsTab(el) {
  const positions = S.wallet?.positions || [];

  // Build static positions HTML
  const posHtml = positions.length
    ? positions.map(p => `
      <div class="position-item">
        <div class="pos-question">${esc(trunc(p.question, 60))}</div>
        <div class="pos-meta">
          <span class="${p.side === 'YES' ? 'val-green' : 'val-red'}">${p.side}</span>
          <span>${p.shares.toFixed(1)} shares @ ${(p.avgPrice * 100).toFixed(1)}¢</span>
          <span class="${p.pnl >= 0 ? 'val-green' : 'val-red'}" style="margin-left:auto">${fmtPnL(p.pnl)}</span>
        </div>
      </div>`).join('')
    : `<div class="empty-state" style="padding:12px 0"><div class="es-text" style="font-size:11px">No filled positions</div></div>`;

  // Render immediately with a loading state for open orders
  el.innerHTML = `
    <div class="section-title">Filled Positions</div>
    ${posHtml}
    <div class="section-title" style="margin-top:16px;display:flex;align-items:center;gap:8px">Open Orders
      <span id="open-orders-count" data-testid="open-orders-count" style="font-size:10px;font-weight:400;color:var(--text3)">loading…</span>
      <button class="btn btn-xs btn-ghost" data-testid="open-orders-sync-button" style="margin-left:auto" onclick="ActivityFeed.sync()">Sync now</button>
    </div>
    <div id="open-orders-list"><div class="empty-state" style="padding:8px 0"><div class="es-text" style="font-size:11px">Fetching…</div></div></div>
    <div style="font-size:10px;color:var(--text3);margin-top:8px">${S.lastOrderSyncAt ? `Last synced ${new Date(S.lastOrderSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Sync after live trading actions to refresh order state'}</div>
    <div class="section-title" style="margin-top:16px;display:flex;align-items:center;gap:8px">Trade Timeline
      <div style="display:flex;gap:6px;margin-left:auto">
        ${['all','wallet','order'].map(filter => `<button class="btn btn-xs ${S.activityFilter === filter ? 'btn-primary' : 'btn-ghost'}" data-testid="activity-filter-${filter}-button" onclick="ActivityFeed.setFilter('${filter}')">${filter === 'all' ? 'All' : filter === 'wallet' ? 'Wallet' : 'Orders'}</button>`).join('')}
      </div>
    </div>
    <div id="order-activity-list" data-testid="order-activity-list">${renderOrderActivity()}</div>`;

  // Fetch open CLOB orders if authorized
  if (!PM.hasL2) {
    document.getElementById('open-orders-list').innerHTML =
      `<div class="empty-state" style="padding:8px 0"><div class="es-text" style="font-size:11px;color:var(--amber)">Authorize wallet to view open orders</div></div>`;
    document.getElementById('open-orders-count').textContent = '';
    return;
  }

  try {
    const l2Headers = await buildL2Headers('GET', '/orders', '');
    const result    = await fetchOpenOrders(l2Headers);
    const listEl    = document.getElementById('open-orders-list');
    const countEl   = document.getElementById('open-orders-count');
    S.lastOrderSyncAt = Date.now();
    if (!listEl) return;

    if (!result.ok || !Array.isArray(result.data) || !result.data.length) {
      listEl.innerHTML = `<div class="empty-state" style="padding:8px 0"><div class="es-text" style="font-size:11px">No open orders</div></div>`;
      countEl && (countEl.textContent = '');
      return;
    }

    const orders = result.data;
    countEl && (countEl.textContent = `${orders.length} open`);

    listEl.innerHTML = orders.map(o => {
      const side      = o.side === 'BUY' ? 'YES' : 'NO';
      const sideColor = side === 'YES' ? 'val-green' : 'val-red';
      const price     = o.price ? (parseFloat(o.price) * 100).toFixed(1) + '¢' : '—';
      const size      = o.original_size ? parseFloat(o.original_size).toFixed(1) : '—';
      const orderId   = esc(o.id || o.order_id || '');
      const originalSize = parseFloat(o.original_size || o.originalSize || o.size || 0);
      const remainingSize = parseFloat(o.remaining_size || o.remainingSize || o.size || originalSize || 0);
      const filledSize = parseFloat(o.size_matched || o.filled_size || o.executed_size || (originalSize > 0 ? Math.max(originalSize - remainingSize, 0) : 0));
      const fillPct = originalSize > 0 ? Math.max(0, Math.min(100, (filledSize / originalSize) * 100)) : 0;
      const stateLabel = fillPct > 0 ? (fillPct >= 100 ? 'FILLED' : 'PARTIAL') : 'OPEN';
      return `
        <div class="position-item" style="border-left:2px solid var(--amber)">
          <div class="pos-question" style="font-size:10px;color:var(--text2)">${esc(trunc(o.market || o.asset_id || 'Unknown market', 55))}</div>
          <div class="pos-meta">
            <span class="${sideColor}">${side}</span>
            <span>${size} shares @ ${price}</span>
            <span style="color:${fillPct > 0 ? 'var(--green)' : 'var(--text3)'}">${stateLabel}${fillPct > 0 ? ` · ${fillPct.toFixed(0)}%` : ''}</span>
            <button class="btn btn-xs btn-red" data-testid="cancel-open-order-${orderId}-button" style="margin-left:auto;padding:2px 8px;font-size:10px"
              onclick="OpenOrders.cancel('${orderId}', this)">Cancel</button>
          </div>
          ${fillPct > 0 && fillPct < 100 ? `<div style="font-size:10px;color:var(--text3);margin-top:6px">Filled ${filledSize.toFixed(1)} / ${originalSize.toFixed(1)} shares · Remaining ${remainingSize.toFixed(1)}</div>` : ''}
        </div>`;
    }).join('');

  } catch (err) {
    const listEl = document.getElementById('open-orders-list');
    if (listEl) listEl.innerHTML = `<div class="empty-state" style="padding:8px 0"><div class="es-text" style="font-size:11px;color:var(--red)">Failed to load: ${esc(err.message)}</div></div>`;
  }
}

// ── Open Orders actions ────────────────────────────────────────────────────
window.OpenOrders = {
  async cancel(orderId, btn) {
    if (!orderId || !PM.hasL2) return;
    btn.textContent = '…';
    btn.disabled    = true;
    try {
      const l2Headers = await buildL2Headers('DELETE', `/order/${orderId}`, '');
      const result    = await cancelOrder(orderId, l2Headers);
      if (result.ok) {
        pushActivityItem({
          category: 'order',
          status: 'cancelled',
          market: btn.closest('.position-item')?.querySelector('.pos-question')?.textContent || 'Open order',
          note: `Order ${orderId.slice(0, 8)} cancelled`,
        });
        btn.closest('.position-item').remove();
        window.showToast?.('Order cancelled', 'success');
        const countEl = document.getElementById('open-orders-count');
        if (countEl) {
          const n = parseInt(countEl.textContent) - 1;
          countEl.textContent = n > 0 ? `${n} open` : '';
        }
      } else {
        pushActivityItem({ category: 'order', status: 'failed', market: 'Open order', note: result.error || String(result.status) });
        btn.textContent = 'Cancel';
        btn.disabled    = false;
        window.showToast?.('Cancel failed: ' + (result.error || result.status), 'error');
      }
    } catch (err) {
      pushActivityItem({ category: 'order', status: 'failed', market: 'Open order', note: err.message });
      btn.textContent = 'Cancel';
      btn.disabled    = false;
      window.showToast?.('Cancel error: ' + err.message, 'error');
    }
  },
};

window.ActivityFeed = {
  setFilter(filter) {
    S.activityFilter = filter;
    renderSidebar('positions');
  },

  sync() {
    renderSidebar('positions');
    window.showToast?.('Order data refreshed', 'info');
  },
};

function renderWatchlistTab() {
  if (!S.watchlist.length) {
    return `<div class="empty-state"><div class="es-icon">☆</div><div class="es-text">No markets watched — click ☆ on a market to add</div></div>`;
  }

  return S.watchlist.map(w => `
    <div class="watch-item" data-testid="watchlist-item-${esc(w.id)}" onclick="selectMarket('${esc(w.id)}')">
      <span class="watch-q truncate">${esc(trunc(w.question, 55))}</span>
      <span class="mono-num" style="font-size:11px;flex-shrink:0">${(w.yesPrice * 100).toFixed(0)}¢</span>
      <button class="btn btn-xs btn-ghost" data-testid="watchlist-remove-${esc(w.id)}-button" onclick="event.stopPropagation();Watchlist.remove('${esc(w.id)}')">✕</button>
    </div>`).join('');
}

// ── Watchlist namespace ────────────────────────────────────────────────────

window.Watchlist = {
  toggle() {
    const m = S.selected;
    if (!m) return;
    const idx = S.watchlist.findIndex(w => w.id === m.id);
    if (idx >= 0) {
      S.watchlist.splice(idx, 1);
      window.showToast?.('Removed from watchlist', 'info');
    } else {
      S.watchlist.push({ id: m.id, question: m.question, yesPrice: m.yesPrice });
      window.showToast?.('Added to watchlist', 'success');
    }
    save(KEYS.watchlist, S.watchlist);
    renderSidebar('watchlist');
  },

  remove(id) {
    S.watchlist = S.watchlist.filter(w => w.id !== id);
    save(KEYS.watchlist, S.watchlist);
    renderSidebar('watchlist');
  },
};
