/**
 * NOVA — Markets Module
 */

import { S } from './state.js';
import { fetchMarkets as apiFetchMarkets, fetchMarketHistory } from './api.js';
import { esc, trunc, fmtUSD, fmtDate, inferCategory, debounce } from './utils.js';

// ── Fetch & Render ────────────────────────────────────────────────────────
export async function fetchAndRenderMarkets(silent = false) {
  if (!silent) setListLoading(true);

  const result = await apiFetchMarkets(100);

  if (!result.ok) {
    if (!silent) {
      setListEmpty('Failed to load markets — backend connection unavailable.');
      window.showToast?.('Markets unavailable — backend connection unavailable', 'warn');
    }
    return;
  }

  const raw = result.data;
  const arr = Array.isArray(raw) ? raw : (raw?.data || raw?.markets || []);

  // DIAGNOSTIC: log the actual field names returned by the Gamma API on first load.
  // Open DevTools → Console and look for "[NOVA] Gamma raw fields" to verify
  // that change24h / volume24h candidates are being mapped correctly.
  if (arr.length > 0) {
    const sample = arr[0];
    const changeKeys  = Object.keys(sample).filter(k => /change|price.?change|day.?price/i.test(k));
    const volumeKeys  = Object.keys(sample).filter(k => /volume/i.test(k));
    console.log('[NOVA] Gamma raw fields — change candidates:', changeKeys.length ? changeKeys : '(none found)');
    console.log('[NOVA] Gamma raw fields — volume candidates:', volumeKeys.length ? volumeKeys : '(none found)');

    // Report exactly which field resolved for change24h so spike scanner status is clear
    const resolvedChangeKey = ['change24h','oneDayPriceChange','price_change','dayPriceChange','priceChange','changePercent24h','percentChange24h']
      .find(k => sample[k] != null);
    if (resolvedChangeKey) {
      console.log(`[NOVA] change24h resolved via field: "${resolvedChangeKey}" = ${sample[resolvedChangeKey]} — spike scanner active ✓`);
    } else {
      console.warn('[NOVA] ⚠ change24h: no matching field found in Gamma response — spike scanner will not fire. All keys:', Object.keys(sample).join(', '));
    }
  }

  S.markets = arr.map(normalizeMarket).filter(m => m.yesPrice > 0);

  document.getElementById('tb-markets').textContent = S.markets.length;

  filterMarkets();
  if (!silent) window.showToast?.('Markets loaded', 'success');
}

export function filterMarkets() {
  let list = [...S.markets];

  // Category filter
  if (S.filter && S.filter !== 'all') {
    list = list.filter(m => m.category === S.filter);
  }

  // Search
  if (S.searchQuery) {
    const q = S.searchQuery.toLowerCase();
    list = list.filter(m => m.question.toLowerCase().includes(q));
  }

  // Sort
  const FAR_FUTURE = new Date('2099-01-01').getTime();
  const sortFns = {
    volume: (a, b) => b.volume - a.volume,
    price:  (a, b) => b.yesPrice - a.yesPrice,
    // null endDate = open-ended market — push to end, not to epoch (1970)
    date:   (a, b) => (a.endDate ? new Date(a.endDate).getTime() : FAR_FUTURE)
                    - (b.endDate ? new Date(b.endDate).getTime() : FAR_FUTURE),
    newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  };
  list.sort(sortFns[S.sort] || sortFns.volume);

  S.filtered = list;
  renderMarketList();

  const countEl = document.getElementById('list-count');
  if (countEl) {
    countEl.textContent = list.length < S.markets.length
      ? `${list.length} of ${S.markets.length} markets`
      : `${S.markets.length} markets`;
  }
}

export function renderMarketList() {
  const el = document.getElementById('market-list');
  if (!el) return;

  if (!S.filtered.length) {
    el.innerHTML = `<div class="empty-state"><div class="es-icon">◎</div><div class="es-text">No markets match</div></div>`;
    return;
  }

  el.innerHTML = S.filtered.map(m => renderMarketItem(m)).join('');
}

function renderMarketItem(m) {
  const priceClass = m.yesPrice > 0.65 ? 'high' : m.yesPrice > 0.35 ? 'mid' : 'low';
  const selected = S.selected?.id === m.id ? 'selected' : '';

  // Use data-market-id for selection tracking — do NOT use onclick.toString().includes(id)
  // which has false-positives when one ID is a substring of another (e.g. hex IDs).
  return `<div class="mkt-item ${selected}" data-market-id="${esc(m.id)}" data-testid="market-item-${esc(m.id)}" onclick="selectMarket('${esc(m.id)}')">
    <div class="mkt-question" data-testid="market-question-${esc(m.id)}">${esc(trunc(m.question, 100))}</div>
    <div class="mkt-meta">
      <span class="mkt-price ${priceClass}" data-testid="market-price-${esc(m.id)}">${(m.yesPrice * 100).toFixed(0)}¢</span>
      <span class="mkt-cat ${m.category}" data-testid="market-category-${esc(m.id)}">${m.category}</span>
      <span class="mkt-vol" data-testid="market-volume-${esc(m.id)}">${fmtUSD(m.volume)}</span>
    </div>
  </div>`;
}

// ── Select Market ─────────────────────────────────────────────────────────
export function selectMarket(id) {
  S.selected = S.filtered.find(m => m.id === id) || S.markets.find(m => m.id === id);
  if (!S.selected) return;

  // Use data-market-id for exact matching — onclick.toString().includes(id)
  // had false-positives when one market ID is a prefix of another (e.g. hex IDs).
  document.querySelectorAll('.mkt-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.marketId === id);
  });

  renderDetail(S.selected);
}

// Make available globally for onclick
window.selectMarket = selectMarket;

// ── Detail Render ─────────────────────────────────────────────────────────
export function renderDetail(m) {
  const el = document.getElementById('detail-content');
  if (!el) return;

  const priceBarWidth = (m.yesPrice * 100).toFixed(1);

  el.innerHTML = `
    <div id="detail-header">
      <div id="detail-question" data-testid="detail-question">${esc(m.question)}</div>
      <div class="price-row">
        <div class="price-card yes" data-testid="detail-yes-card" onclick="openOrderModal('YES')">
          <div class="pc-label">YES</div>
          <div class="pc-val">${(m.yesPrice * 100).toFixed(1)}¢</div>
          <div class="pc-sub">Click to buy</div>
        </div>
        <div class="price-card no" data-testid="detail-no-card" onclick="openOrderModal('NO')">
          <div class="pc-label">NO</div>
          <div class="pc-val">${(m.noPrice * 100).toFixed(1)}¢</div>
          <div class="pc-sub">Click to buy</div>
        </div>
      </div>
      <div class="stat-grid">
        <div class="stat-cell">
          <div class="sc-label">Volume</div>
          <div class="sc-val">${fmtUSD(m.volume)}</div>
        </div>
        <div class="stat-cell">
          <div class="sc-label">Closes</div>
          <div class="sc-val">${fmtDate(m.endDate)}</div>
        </div>
        <div class="stat-cell">
          <div class="sc-label">Liquidity</div>
          <div class="sc-val">${fmtUSD(m.liquidity)}</div>
        </div>
      </div>

      <!-- Price bar -->
      <div style="background:var(--red-dim);border-radius:4px;height:4px;margin-bottom:16px;overflow:hidden">
        <div style="background:var(--green);height:100%;width:${priceBarWidth}%;transition:width 0.4s ease;border-radius:4px"></div>
      </div>

      <!-- Chart -->
      <div class="chart-range-row">
        ${['1D','1W','1M','All'].map(r => `<button class="range-btn ${r === S.chartRange ? 'on' : ''}" data-testid="chart-range-${r.toLowerCase()}-button" onclick="Chart.setRange('${r}',this)">${r}</button>`).join('')}
      </div>
      <div id="chart-wrap" data-testid="market-chart-wrap">
        <canvas id="chart-canvas"></canvas>
      </div>

      <!-- Actions -->
      <div style="display:flex;gap:8px">
        <button class="btn btn-green" data-testid="buy-yes-button" onclick="openOrderModal('YES')">Buy YES</button>
        <button class="btn btn-red" data-testid="buy-no-button" onclick="openOrderModal('NO')">Buy NO</button>
        <button class="btn btn-ghost btn-sm" data-testid="watch-market-button" onclick="Watchlist.toggle()">☆ Watch</button>
        <button class="btn btn-ghost btn-sm" data-testid="open-polymarket-link-button" onclick="openPolymarketLink()">↗ Open</button>
      </div>
    </div>`;

  // Load chart
  import('./chart.js').then(m => m.loadChart(S.selected, S.chartRange));
}

// ── Helpers ───────────────────────────────────────────────────────────────
function normalizeMarket(raw) {
  // The Gamma API sometimes returns outcomes and outcomePrices as JSON-encoded
  // strings rather than parsed arrays (e.g. '["Yes","No"]'). Parse them if so.
  let outcomes = raw.outcomes || [];
  if (typeof outcomes === 'string') {
    try { outcomes = JSON.parse(outcomes); } catch { outcomes = []; }
  }

  let prices = raw.outcomePrices || [];
  if (typeof prices === 'string') {
    try { prices = JSON.parse(prices); } catch { prices = []; }
  }

  // clobTokenIds — the CLOB token IDs for YES and NO sides.
  // The Gamma API returns this in two possible shapes:
  //   Shape A (string array): clobTokenIds: ["123...", "456..."]  ← index 0=YES, 1=NO
  //   Shape B (object array): tokens: [{token_id:"123...", outcome:"Yes"}, ...]
  // We normalize both into a flat [yesTokenId, noTokenId] string array so the
  // rest of the app (orders.js:extractTokenId) never has to care about the raw format.
  let tokens = [];
  if (Array.isArray(raw.clobTokenIds) && raw.clobTokenIds.length) {
    // Shape A — already a string array
    tokens = raw.clobTokenIds;
  } else if (Array.isArray(raw.tokens) && raw.tokens.length) {
    if (typeof raw.tokens[0] === 'string') {
      // Shape A via `tokens` key instead of `clobTokenIds`
      tokens = raw.tokens;
    } else {
      // Shape B — array of {token_id, outcome} objects
      // Sort so index 0 = YES, index 1 = NO to match the rest of the codebase
      const sorted = [...raw.tokens].sort((a, b) => {
        const aYes = /yes/i.test(a.outcome || '') ? 0 : 1;
        const bYes = /yes/i.test(b.outcome || '') ? 0 : 1;
        return aYes - bYes;
      });
      tokens = sorted.map(t => String(t.token_id || t.tokenId || t.id || ''));
    }
  }

  const yesIdx = outcomes.findIndex(o => o?.toUpperCase() === 'YES');
  const noIdx  = outcomes.findIndex(o => o?.toUpperCase() === 'NO');

  const yesPrice = parseFloat(
    (yesIdx >= 0 ? prices[yesIdx] : null) ?? raw.lastTradePrice ?? raw.bestAsk ?? 0
  );
  // Use actual NO price from data rather than assuming 1-yes (spread means they don't sum to 1)
  const noPrice = parseFloat(
    (noIdx >= 0 ? prices[noIdx] : null) ?? (yesPrice > 0 ? 1 - yesPrice : 0)
  );

  return {
    id:          raw.id          || raw.conditionId || '',
    question:    raw.question    || raw.title || 'Unknown',
    description: raw.description || '',
    category:    inferCategory(raw.question || ''),
    yesPrice:    Math.min(Math.max(yesPrice, 0.01), 0.99),
    noPrice:     Math.min(Math.max(noPrice,  0.01), 0.99),
    volume:      parseFloat(raw.volume || raw.volume24hr || 0),
    volume24hr:  parseFloat(raw.volume24hr || 0),
    // volume24h: alias for volume24hr — both names used in downstream code.
    volume24h:   parseFloat(raw.volume24hr || raw.volume24h || 0),
    liquidity:   parseFloat(raw.liquidity || 0),
    // change24h: actual 24h YES price move, as a decimal (e.g. 0.03 = 3¢ move up).
    // The Gamma API field name has not been confirmed by live inspection — we try
    // all plausible candidates in priority order. null if none present — the
    // spike scanner will skip this market and rely on price history instead.
    // Run the app and check DevTools for "[NOVA] Gamma raw fields" to confirm
    // which key is actually returned.
    change24h: (() => {
      const v = raw.change24h         // most likely name
               ?? raw.oneDayPriceChange
               ?? raw.price_change
               ?? raw.dayPriceChange
               ?? raw.priceChange
               ?? raw.changePercent24h
               ?? raw.percentChange24h;
      return v != null ? parseFloat(v) : null;
    })(),
    endDate:     raw.endDate || raw.endDateIso || null,
    createdAt:   raw.createdAt || null,
    conditionId: raw.conditionId || raw.id || '',
    clobTokenIds: tokens,
    outcomes,
    gammaUrl:    raw.url || null,
    groupSlug:   raw.groupSlug || null,
    slug:        raw.slug || null,
    active:      raw.active !== false,
  };
}

function setListLoading(loading) {
  if (loading) {
    document.getElementById('market-list').innerHTML =
      `<div class="empty-state"><div class="spinner"></div><div class="es-text" style="margin-top:8px">Loading…</div></div>`;
  }
}

function setListEmpty(msg) {
  document.getElementById('market-list').innerHTML =
    `<div class="empty-state"><div class="es-icon">⚠</div><div class="es-text">${esc(msg)}</div></div>`;
}
