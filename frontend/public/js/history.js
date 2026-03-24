import { S, PM, CFG, SIM } from './state.js';
import { esc, shortAddr, trunc } from './utils.js';

const STATUS_COLORS = {
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
};