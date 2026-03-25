import { S, PM, CFG, SIM } from './state.js';
import { esc, shortAddr, trunc } from './utils.js';
import { syncOpenOrdersState } from './sidebar.js';

const STATUS_COLORS = {
  submitted: 'var(--green)',
  open: 'var(--blue)',
  partial: 'var(--amber)',
  filled: 'var(--green)',
  cancelled: 'var(--amber)',
  failed: 'var(--red)',
  'sim-filled': 'var(--blue)',
  signing: 'var(--text2)',
  connected: 'var(--blue)',
  disconnected: 'var(--text3)',
  authorized: 'var(--green)',
  'live-ready': 'var(--green)',
  review: 'var(--amber)',
};

function getFilteredActivity() {
  const search = S.historySearch.trim().toLowerCase();
  return S.orderActivity.filter(item => {
    if (S.historyCategory !== 'all' && item.category !== S.historyCategory) return false;
    if (S.historyStatus !== 'all' && item.status !== S.historyStatus) return false;
    if (S.historySelectedMarket && item.market !== S.historySelectedMarket) return false;
    if (!search) return true;
    const haystack = `${item.market || ''} ${item.note || ''} ${item.status || ''} ${item.category || ''}`.toLowerCase();
    return haystack.includes(search);
  });
}

function getDrilldowns() {
  const grouped = new Map();
  S.orderActivity
    .filter(item => item.category === 'order' && item.market && !['Wallet connection', 'Wallet authorization', 'Trading settings'].includes(item.market))
    .forEach(item => {
      const current = grouped.get(item.market) || { market: item.market, count: 0, lastStatus: item.status, lastTs: item.ts };
      current.count += 1;
      if (item.ts >= current.lastTs) {
        current.lastTs = item.ts;
        current.lastStatus = item.status;
      }
      grouped.set(item.market, current);
    });
  return [...grouped.values()].sort((a, b) => b.lastTs - a.lastTs);
}

function getChecklistSteps() {
  return [
    { label: 'Connect wallet in this browser', done: PM.connected, hint: PM.connected ? shortAddr(PM.address || PM.makerAddress) : 'Use Phantom or MetaMask, then return here' },
    { label: 'Authorize Polymarket access', done: PM.hasL2, hint: PM.hasL2 ? 'Auth complete' : 'Click Authorize in the top bar' },
    { label: 'Enable live trading in Settings', done: CFG.tradingEnabled || SIM.enabled, hint: SIM.enabled ? 'Simulation mode is still on' : 'Turn Live Trading on only when ready' },
    { label: 'Place a small order', done: S.orderActivity.some(item => item.category === 'order' && ['submitted', 'sim-filled'].includes(item.status)), hint: 'Use a small amount for the first live pass' },
    { label: 'Cancel or confirm the open order state', done: S.orderActivity.some(item => item.category === 'order' && item.status === 'cancelled'), hint: 'Use Positions → Sync now to confirm status changes' },
  ];
}

function renderStats(filtered, drilldowns) {
  const walletEvents = filtered.filter(item => item.category === 'wallet').length;
  const orderEvents = filtered.filter(item => item.category === 'order').length;
  const lastEvent = filtered[0];
  const cards = [
    ['Visible events', filtered.length],
    ['Wallet events', walletEvents],
    ['Order events', orderEvents],
    ['Tracked markets', drilldowns.length],
  ];

  return `
    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0 18px">
      ${cards.map(([label, value], index) => `
        <div data-testid="history-stat-${index + 1}" style="padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--surface)">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">${label}</div>
          <div style="font-size:20px;font-family:var(--font-mono);color:var(--text)">${value}</div>
        </div>`).join('')}
    </div>
    <div style="font-size:11px;color:var(--text3);margin-top:-8px;margin-bottom:14px">
      ${lastEvent ? `Last event: ${esc(lastEvent.market || 'Activity')} · ${esc(lastEvent.status)} at ${new Date(lastEvent.ts).toLocaleString()}` : 'No trade history yet — use the live wallet checklist to start your first pass.'}
    </div>`;
}

function renderPnlAnalytics() {
  const positions = S.wallet?.positions || [];
  if (!positions.length) {
    return `
      <div style="padding:14px;border:1px solid var(--border);border-radius:16px;background:var(--surface);margin-bottom:16px">
        <div class="section-title">Per-Market P&amp;L</div>
        <div class="empty-state" style="padding:20px 12px"><div class="es-text">Connect and sync a wallet to populate market-level P&amp;L analytics.</div></div>
      </div>`;
  }

  const totalPnl = positions.reduce((sum, item) => sum + (item.pnl || 0), 0);
  const winners = positions.filter(item => (item.pnl || 0) >= 0).length;
  const losers = positions.length - winners;
  const topMarkets = [...positions].sort((a, b) => (b.pnl || 0) - (a.pnl || 0)).slice(0, 4);

  return `
    <div style="padding:14px;border:1px solid var(--border);border-radius:16px;background:var(--surface);margin-bottom:16px">
      <div class="section-title">Per-Market P&amp;L</div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px">
        <div data-testid="history-pnl-total-card" style="padding:10px;border:1px solid var(--border);border-radius:12px;background:var(--surface2)">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase">Open P&amp;L</div>
          <div style="font-size:18px;font-family:var(--font-mono);color:${totalPnl >= 0 ? 'var(--green)' : 'var(--red)'}">${totalPnl >= 0 ? '+' : ''}$${Math.abs(totalPnl).toFixed(2)}</div>
        </div>
        <div data-testid="history-pnl-winners-card" style="padding:10px;border:1px solid var(--border);border-radius:12px;background:var(--surface2)">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase">Winning Markets</div>
          <div style="font-size:18px;font-family:var(--font-mono);color:var(--green)">${winners}</div>
        </div>
        <div data-testid="history-pnl-losers-card" style="padding:10px;border:1px solid var(--border);border-radius:12px;background:var(--surface2)">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase">Losing Markets</div>
          <div style="font-size:18px;font-family:var(--font-mono);color:var(--red)">${losers}</div>
        </div>
      </div>
      ${topMarkets.map((item, index) => `
        <div data-testid="history-pnl-market-${index + 1}" style="padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface2);margin-bottom:8px">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
            <div style="font-size:11px;color:var(--text);font-weight:600;flex:1">${esc(trunc(item.question, 68))}</div>
            <div style="font-size:11px;color:${(item.pnl || 0) >= 0 ? 'var(--green)' : 'var(--red)'};font-family:var(--font-mono)">${(item.pnl || 0) >= 0 ? '+' : ''}$${Math.abs(item.pnl || 0).toFixed(2)}</div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:10px;color:var(--text3)">
            <span>${esc(item.side)} · ${item.shares.toFixed(1)} shares</span>
            <span>Avg ${((item.avgPrice || 0) * 100).toFixed(1)}¢</span>
          </div>
        </div>`).join('')}
    </div>`;
}

function renderLiveOrderMonitor() {
  if (!PM.hasL2) {
    return `
      <div style="padding:14px;border:1px solid var(--border);border-radius:16px;background:var(--surface);margin-bottom:16px">
        <div class="section-title">Live Order Monitor</div>
        <div class="empty-state" style="padding:20px 12px"><div class="es-text">Authorize your wallet to enable auto-refreshing live order updates here.</div></div>
      </div>`;
  }

  if (!S.syncedOpenOrders.length) {
    return `
      <div style="padding:14px;border:1px solid var(--border);border-radius:16px;background:var(--surface);margin-bottom:16px">
        <div class="section-title">Live Order Monitor</div>
        <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:11px;color:var(--text3)">Auto-refresh runs every 15 seconds while History stays open.</div>
          <button class="btn btn-sm btn-ghost" data-testid="history-sync-live-orders-button" onclick="HistoryView.syncLiveOrders()">Sync now</button>
        </div>
        <div class="empty-state" style="padding:20px 12px"><div class="es-text">No synced open orders yet — place a small order, then sync to inspect lifecycle badges.</div></div>
      </div>`;
  }

  return `
    <div style="padding:14px;border:1px solid var(--border);border-radius:16px;background:var(--surface);margin-bottom:16px">
      <div class="section-title">Live Order Monitor</div>
      <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:11px;color:var(--text3)">Auto-refresh on · last sync ${S.lastOrderSyncAt ? new Date(S.lastOrderSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'pending'}</div>
        <button class="btn btn-sm btn-ghost" data-testid="history-sync-live-orders-button" onclick="HistoryView.syncLiveOrders()">Sync now</button>
      </div>
      ${S.syncedOpenOrders.slice(0, 6).map((order, index) => `
        <div data-testid="history-live-order-${index + 1}" style="padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface2);margin-bottom:8px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
            <div style="font-size:11px;color:var(--text);font-weight:600;flex:1">${esc(trunc(order.market, 64))}</div>
            <span class="badge ${order.stateLabel === 'OPEN' ? 'badge-blue' : order.stateLabel === 'PARTIAL' ? 'badge-amber' : order.stateLabel === 'FILLED' ? 'badge-green' : order.stateLabel === 'CANCELLED' ? 'badge-purple' : 'badge-red'}">${order.stateLabel}${order.fillPct > 0 && order.stateLabel !== 'FILLED' ? ` ${order.fillPct.toFixed(0)}%` : ''}</span>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:10px;color:var(--text3)">
            <span>${esc(order.side)} @ ${order.priceLabel}</span>
            <span>Filled ${order.filledSize.toFixed(1)} / ${order.originalSize.toFixed(1)}</span>
            <span>Remaining ${order.remainingSize.toFixed(1)}</span>
          </div>
        </div>`).join('')}
    </div>`;
}

function renderRunbook() {
  const notes = [
    'Connect your wallet and wait for the address to appear in the top bar.',
    'Click Authorize and approve the Polymarket signature in your wallet.',
    'Open Settings and enable Live Trading only when you are ready.',
    'Place a very small order, then switch to Positions and click Sync now.',
    'Use the OPEN / PARTIAL / FILLED labels plus the raw share counts in Positions to inspect the live Polymarket fill fields.',
    'Cancel the order if needed, then return here to review the timeline and export CSV if you want a record.',
  ];

  return `
    <div style="padding:14px;border:1px solid var(--border);border-radius:16px;background:var(--surface);margin:16px 0">
      <div class="section-title">Live Pass Runbook</div>
      ${notes.map((note, index) => `
        <div data-testid="history-runbook-step-${index + 1}" style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:${index === notes.length - 1 ? 'none' : '1px solid var(--border)'}">
          <div style="width:18px;height:18px;border-radius:999px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--blue);flex-shrink:0">${index + 1}</div>
          <div style="font-size:11px;color:var(--text2);line-height:1.7">${note}</div>
        </div>`).join('')}
    </div>`;
}

function renderTimeline(items) {
  if (!items.length) {
    return `<div class="empty-state" style="padding:30px 18px"><div class="es-text">No history matches these filters yet</div></div>`;
  }

  return items.slice(0, 30).map(item => {
    const color = STATUS_COLORS[item.status] || 'var(--text2)';
    return `
      <div data-testid="history-timeline-item-${esc(item.id)}" style="padding:12px 14px;border:1px solid var(--border);border-left:3px solid ${color};border-radius:12px;background:var(--surface);margin-bottom:10px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
          <span style="font-size:10px;color:var(--text3);text-transform:uppercase">${esc(item.category || 'order')}</span>
          <span style="font-size:10px;color:${color};text-transform:uppercase">${esc(item.status)}</span>
          ${item.side ? `<span style="font-size:10px;color:var(--text2)">${esc(item.side)}</span>` : ''}
          ${item.amountUSD != null ? `<span style="font-size:10px;color:var(--text2)">$${Number(item.amountUSD).toFixed(2)}</span>` : ''}
          <span style="margin-left:auto;font-size:10px;color:var(--text3)">${new Date(item.ts).toLocaleString()}</span>
        </div>
        <div style="font-size:12px;color:var(--text);font-weight:600;margin-bottom:4px">${esc(trunc(item.market || 'Activity', 80))}</div>
        ${item.note ? `<div style="font-size:11px;color:var(--text2);line-height:1.6">${esc(item.note)}</div>` : ''}
      </div>`;
  }).join('');
}

export function renderHistoryView() {
  const el = document.getElementById('history-view-content');
  if (!el) return;

  const filtered = getFilteredActivity();
  const drilldowns = getDrilldowns();
  const steps = getChecklistSteps();
  const uniqueStatuses = [...new Set(S.orderActivity.map(item => item.status).filter(Boolean))];

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:minmax(0,1.5fr) minmax(280px,0.9fr);gap:16px;min-height:100%">
      <div style="min-width:0">
        <div style="padding:16px;border:1px solid var(--border);border-radius:16px;background:var(--surface)">
          <div class="section-title">Manual Live Wallet Pass</div>
          <div style="font-size:12px;color:var(--text2);line-height:1.7">Use this page as your operating checklist while you connect, authorize, place a small order, sync the result, and verify the timeline.</div>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px">
            ${steps.map((step, index) => `
              <div data-testid="history-checklist-step-${index + 1}" style="padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--surface2)">
                <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px">
                  <span style="font-size:11px;color:var(--text);font-weight:600">${step.label}</span>
                  <span style="font-size:10px;color:${step.done ? 'var(--green)' : 'var(--text3)'}">${step.done ? 'Done' : 'Pending'}</span>
                </div>
                <div style="font-size:10px;color:var(--text3);line-height:1.6">${step.hint}</div>
              </div>`).join('')}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
            <button class="btn btn-sm btn-primary" data-testid="history-connect-wallet-button" onclick="App.toggleWallet()">Connect Wallet</button>
            <button class="btn btn-sm btn-ghost" data-testid="history-authorize-wallet-button" onclick="App.authorize()">Authorize</button>
            <button class="btn btn-sm btn-ghost" data-testid="history-open-settings-button" onclick="UI.openSettings()">Settings</button>
            <button class="btn btn-sm btn-ghost" data-testid="history-open-positions-button" onclick="UI.switchSideTab('positions', document.querySelector('[data-testid=&quot;sidebar-positions-tab&quot;]'))">Positions</button>
          </div>
        </div>

        ${renderStats(filtered, drilldowns)}
        ${renderPnlAnalytics()}
        ${renderLiveOrderMonitor()}
        ${renderRunbook()}

        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
          <input id="history-search-input" data-testid="history-search-input" value="${esc(S.historySearch)}" oninput="HistoryView.setSearch(this.value)" placeholder="Search markets, notes, or statuses…" style="flex:1;min-width:220px;padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:12px;color:var(--text)">
          <select id="history-category-select" data-testid="history-category-select" onchange="HistoryView.setCategory(this.value)" style="padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:12px;color:var(--text2)">
            <option value="all" ${S.historyCategory === 'all' ? 'selected' : ''}>All categories</option>
            <option value="wallet" ${S.historyCategory === 'wallet' ? 'selected' : ''}>Wallet</option>
            <option value="order" ${S.historyCategory === 'order' ? 'selected' : ''}>Orders</option>
          </select>
          <select id="history-status-select" data-testid="history-status-select" onchange="HistoryView.setStatus(this.value)" style="padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:12px;color:var(--text2)">
            <option value="all">All statuses</option>
            ${uniqueStatuses.map(status => `<option value="${esc(status)}" ${S.historyStatus === status ? 'selected' : ''}>${esc(status)}</option>`).join('')}
          </select>
          <button class="btn btn-sm btn-ghost" data-testid="history-export-csv-button" onclick="HistoryView.exportCsv()">Export CSV</button>
          <button class="btn btn-sm btn-ghost" data-testid="history-export-button" onclick="HistoryView.exportJson()">Export</button>
        </div>

        ${S.historySelectedMarket ? `<div style="font-size:11px;color:var(--text3);margin-bottom:12px">Focused market: <span style="color:var(--text)">${esc(S.historySelectedMarket)}</span> <button class="btn btn-xs btn-ghost" data-testid="history-clear-market-button" onclick="HistoryView.clearFocusedMarket()">Clear</button></div>` : ''}

        <div data-testid="history-timeline-list">${renderTimeline(filtered)}</div>
      </div>

      <div style="min-width:0">
        <div style="padding:16px;border:1px solid var(--border);border-radius:16px;background:var(--surface);position:sticky;top:0">
          <div class="section-title">Market Drilldowns</div>
          <div style="font-size:11px;color:var(--text3);line-height:1.6;margin-bottom:12px">Focus the timeline on a single market to inspect live order attempts, retries, and cancellations.</div>
          ${drilldowns.length ? drilldowns.slice(0, 12).map((group, index) => `
            <button data-testid="history-drilldown-${index + 1}-button" data-market="${esc(group.market)}" onclick="HistoryView.focusMarketFromEvent(event)" style="width:100%;text-align:left;padding:12px;border:1px solid ${S.historySelectedMarket === group.market ? 'rgba(0,200,255,0.35)' : 'var(--border)'};border-radius:12px;background:${S.historySelectedMarket === group.market ? 'var(--blue-dim)' : 'var(--surface2)'};color:var(--text);margin-bottom:10px;cursor:pointer">
              <div style="font-size:11px;font-weight:600;line-height:1.6">${esc(trunc(group.market, 56))}</div>
              <div style="display:flex;gap:8px;align-items:center;margin-top:8px;font-size:10px;color:var(--text3)">
                <span>${group.count} event${group.count !== 1 ? 's' : ''}</span>
                <span style="color:${STATUS_COLORS[group.lastStatus] || 'var(--text2)'}">${esc(group.lastStatus)}</span>
                <span style="margin-left:auto">${new Date(group.lastTs).toLocaleDateString()}</span>
              </div>
            </button>`).join('') : `<div class="empty-state" style="padding:24px 10px"><div class="es-text">Market drilldowns will appear after your first tracked order events.</div></div>`}
        </div>
      </div>
    </div>`;
}

window.HistoryView = {
  setSearch(value) {
    S.historySearch = value;
    renderHistoryView();
  },

  setCategory(value) {
    S.historyCategory = value;
    renderHistoryView();
  },

  setStatus(value) {
    S.historyStatus = value;
    renderHistoryView();
  },

  focusMarket(market) {
    S.historySelectedMarket = market;
    renderHistoryView();
  },

  focusMarketFromEvent(event) {
    const market = event?.currentTarget?.dataset?.market || '';
    this.focusMarket(market);
  },

  clearFocusedMarket() {
    S.historySelectedMarket = '';
    renderHistoryView();
  },

  exportJson() {
    const payload = JSON.stringify(getFilteredActivity(), null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nova-trade-history.json';
    a.click();
    URL.revokeObjectURL(url);
    window.showToast?.('Trade history exported', 'success');
  },

  exportCsv() {
    const rows = getFilteredActivity();
    const header = ['timestamp', 'category', 'status', 'market', 'side', 'amount_usd', 'note'];
    const csv = [header.join(',')].concat(rows.map(item => [
      new Date(item.ts).toISOString(),
      item.category || '',
      item.status || '',
      item.market || '',
      item.side || '',
      item.amountUSD ?? '',
      (item.note || '').replace(/"/g, '""'),
    ].map(value => `"${String(value)}"`).join(','))).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nova-trade-history.csv';
    a.click();
    URL.revokeObjectURL(url);
    window.showToast?.('CSV exported', 'success');
  },

  async syncLiveOrders() {
    await syncOpenOrdersState(true);
    renderHistoryView();
  },
};