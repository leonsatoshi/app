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

export function normalizeOpenOrder(o) {
  const originalSize = parseFloat(o.original_size || o.originalSize || o.size || 0);
  const remainingSize = parseFloat(o.remaining_size || o.remainingSize || o.size || originalSize || 0);
  const filledSize = parseFloat(o.size_matched || o.filled_size || o.executed_size || o.matched_amount || (originalSize > 0 ? Math.max(originalSize - remainingSize, 0) : 0));
  const fillPct = originalSize > 0 ? Math.max(0, Math.min(100, (filledSize / originalSize) * 100)) : 0;
  const rawStatus = String(o.status || '').toLowerCase();
  let stateLabel = 'OPEN';
  if (rawStatus.includes('cancel')) stateLabel = 'CANCELLED';
  else if (rawStatus.includes('fail') || rawStatus.includes('reject') || rawStatus.includes('error')) stateLabel = 'FAILED';
  else if ((originalSize > 0 && remainingSize <= 0.0001) || (rawStatus.includes('fill') && !rawStatus.includes('partial'))) stateLabel = 'FILLED';
  else if (rawStatus.includes('partial') || (filledSize > 0 && remainingSize > 0.0001 && remainingSize < originalSize)) stateLabel = 'PARTIAL';
  else if (rawStatus.includes('open') || rawStatus.includes('live') || rawStatus.includes('unmatched') || !rawStatus) stateLabel = 'OPEN';

  const rawSide = String(o.side || '').toUpperCase();
  const side = rawSide === 'BUY' ? 'YES' : rawSide === 'SELL' ? 'NO' : 'UNKNOWN';

  return {
    id: o.id || o.order_id || '',
    market: o.market || o.asset_id || 'Unknown market',
    side,
    priceLabel: o.price ? (parseFloat(o.price) * 100).toFixed(1) + '¢' : '—',
    originalSize,
    remainingSize,
    filledSize,
    fillPct,
    stateLabel,
    raw: o,
  };
}

export async function syncOpenOrdersState(showToast = false) {
  if (!PM.hasL2) {
    S.syncedOpenOrders = [];
    return { ok: false, reason: 'unauthorized' };
  }

  try {
    const previousOrders = S.syncedOpenOrders || [];
    const previousById = new Map(previousOrders.map(order => [order.id, order]));
    const l2Headers = await buildL2Headers('GET', '/orders', '');
    const result = await fetchOpenOrders(l2Headers);
    if (!result.ok || !Array.isArray(result.data)) {
      S.syncedOpenOrders = [];
      return { ok: false, error: result.error || result.status };
    }

    S.syncedOpenOrders = result.data.map(normalizeOpenOrder);
    if (S.lastOrderSyncAt) {
      const nextById = new Map(S.syncedOpenOrders.map(order => [order.id, order]));
      S.syncedOpenOrders.forEach(order => {
        const previous = previousById.get(order.id);
        if (!previous) return;
        if (previous.stateLabel !== order.stateLabel || Math.floor(previous.fillPct) !== Math.floor(order.fillPct)) {
          pushActivityItem({
            category: 'order',
            status: order.stateLabel.toLowerCase(),
            market: order.market,
            side: order.side,
            orderId: order.id,
            note: `Auto-sync update: ${order.stateLabel} · ${order.filledSize.toFixed(1)}/${order.originalSize.toFixed(1)} shares`,
          });
          window.showToast?.(`${order.side} ${order.stateLabel.toLowerCase()} — ${trunc(order.market, 38)}`, 'info');
        }
      });

      previousOrders.forEach(previous => {
        if (!previous.id || nextById.has(previous.id)) return;
        const recentCancel = S.orderActivity.find(item => item.orderId === previous.id && item.status === 'cancelled' && Date.now() - item.ts < 10 * 60 * 1000);
        if (recentCancel) return;

        const inferredStatus = previous.stateLabel === 'PARTIAL' || previous.filledSize > 0 || previous.remainingSize <= 0.0001
          ? 'filled'
          : 'closed';

        pushActivityItem({
          category: 'order',
          status: inferredStatus,
          market: previous.market,
          side: previous.side,
          orderId: previous.id,
          note: inferredStatus === 'filled'
            ? 'Order disappeared from open orders after a partial/live state — treating it as filled.'
            : 'Order no longer appears in open orders. Review the final state in Polymarket if needed.',
        });
        window.showToast?.(`${previous.side} ${inferredStatus} — ${trunc(previous.market, 38)}`, 'info');
      });
    }
    S.lastOrderSyncAt = Date.now();
    if (showToast) window.showToast?.('Open orders synced', 'success');
    return { ok: true, data: S.syncedOpenOrders };
  } catch (err) {
    if (showToast) window.showToast?.('Sync failed: ' + err.message, 'error');
    return { ok: false, error: err.message };
  }
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
        <button class="btn btn-sm btn-ghost" data-testid="wallet-guide-history-button" onclick="UI.switchView('history', document.querySelector('[data-testid=&quot;nav-history-button&quot;]'))">History</button>
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
      open: 'var(--blue)',
      partial: 'var(--amber)',
      filled: 'var(--green)',
      closed: 'var(--text3)',
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
    S.syncedOpenOrders = [];
    document.getElementById('open-orders-list').innerHTML =
      `<div class="empty-state" style="padding:8px 0"><div class="es-text" style="font-size:11px;color:var(--amber)">Authorize wallet to view open orders</div></div>`;
    document.getElementById('open-orders-count').textContent = '';
    return;
  }

  try {
    const result = await syncOpenOrdersState(false);
    const listEl    = document.getElementById('open-orders-list');
    const countEl   = document.getElementById('open-orders-count');
    if (!listEl) return;

    if (!result.ok || !S.syncedOpenOrders.length) {
      listEl.innerHTML = `<div class="empty-state" style="padding:8px 0"><div class="es-text" style="font-size:11px">No open orders</div></div>`;
      countEl && (countEl.textContent = '');
      return;
    }

    const orders = S.syncedOpenOrders;
    countEl && (countEl.textContent = `${orders.length} open`);

    listEl.innerHTML = orders.map(o => {
      const sideColor = o.side === 'YES' ? 'val-green' : o.side === 'NO' ? 'val-red' : 'val-dim';
      const orderId   = esc(o.id);
      const hasDiagnostics = o.originalSize > 0 || o.filledSize > 0 || o.remainingSize > 0;
      return `
        <div class="position-item" style="border-left:2px solid var(--amber)">
          <div class="pos-question" style="font-size:10px;color:var(--text2)">${esc(trunc(o.market, 55))}</div>
          <div class="pos-meta">
            <span class="${sideColor}">${o.side}</span>
            <span>${o.originalSize ? o.originalSize.toFixed(1) : '—'} shares @ ${o.priceLabel}</span>
            <span class="badge ${o.stateLabel === 'OPEN' ? 'badge-blue' : o.stateLabel === 'PARTIAL' ? 'badge-amber' : o.stateLabel === 'FILLED' ? 'badge-green' : o.stateLabel === 'CANCELLED' ? 'badge-purple' : 'badge-red'}">${o.stateLabel}${o.fillPct > 0 && o.stateLabel !== 'FILLED' ? ` ${o.fillPct.toFixed(0)}%` : ''}</span>
            <button class="btn btn-xs btn-red" data-testid="cancel-open-order-${orderId}-button" style="margin-left:auto;padding:2px 8px;font-size:10px"
              onclick="OpenOrders.cancel('${orderId}', this)">Cancel</button>
          </div>
          ${hasDiagnostics ? `<div data-testid="open-order-diagnostics-${orderId}" style="font-size:10px;color:var(--text3);margin-top:6px">Filled ${o.filledSize.toFixed(1)} / ${o.originalSize.toFixed(1)} shares · Remaining ${o.remainingSize.toFixed(1)} · Status ${o.stateLabel}</div>` : ''}
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
          orderId,
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

  async sync() {
    await syncOpenOrdersState(true);
    renderSidebar('positions');
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
