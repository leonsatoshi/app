/**
 * NOVA — Sidebar Module
 */

import { S, PM, SIM } from './state.js';
import { fmtUSD, fmtPnL, shortAddr, esc, trunc, load, save } from './utils.js';
import { STORAGE as KEYS } from './constants.js';
import { fetchOpenOrders, cancelOrder } from './api.js';
import { buildL2Headers } from './auth.js';

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
    <div class="wallet-stat"><span class="ws-label">Address</span><span class="ws-val" data-testid="sim-address-value" style="font-size:9px">SIM</span></div>`;
  }

  if (!PM.connected || !S.wallet) {
    return `<div class="empty-state"><div class="es-icon">◌</div><div class="es-text">Connect wallet to view portfolio</div></div>`;
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
    </div>`;
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
    <div class="section-title" style="margin-top:16px">Open Orders
      <span id="open-orders-count" data-testid="open-orders-count" style="font-size:10px;font-weight:400;color:var(--text3);margin-left:6px">loading…</span>
    </div>
    <div id="open-orders-list"><div class="empty-state" style="padding:8px 0"><div class="es-text" style="font-size:11px">Fetching…</div></div></div>`;

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
      return `
        <div class="position-item" style="border-left:2px solid var(--amber)">
          <div class="pos-question" style="font-size:10px;color:var(--text2)">${esc(trunc(o.market || o.asset_id || 'Unknown market', 55))}</div>
          <div class="pos-meta">
            <span class="${sideColor}">${side}</span>
            <span>${size} shares @ ${price}</span>
            <button class="btn btn-xs btn-red" data-testid="cancel-open-order-button" style="margin-left:auto;padding:2px 8px;font-size:10px"
              onclick="OpenOrders.cancel('${orderId}', this)">Cancel</button>
          </div>
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
        btn.closest('.position-item').remove();
        window.showToast?.('Order cancelled', 'success');
        const countEl = document.getElementById('open-orders-count');
        if (countEl) {
          const n = parseInt(countEl.textContent) - 1;
          countEl.textContent = n > 0 ? `${n} open` : '';
        }
      } else {
        btn.textContent = 'Cancel';
        btn.disabled    = false;
        window.showToast?.('Cancel failed: ' + (result.error || result.status), 'error');
      }
    } catch (err) {
      btn.textContent = 'Cancel';
      btn.disabled    = false;
      window.showToast?.('Cancel error: ' + err.message, 'error');
    }
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
      <button class="btn btn-xs btn-ghost" data-testid="watchlist-remove-button" onclick="event.stopPropagation();Watchlist.remove('${esc(w.id)}')">✕</button>
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
