/**
 * NOVA — Arb UI
 * Renders the Arb tab. Imports from arb.js for all logic.
 * No business logic here — pure rendering + event handling.
 */

import { S, PM, SIM, CFG } from './state.js';
import { runArbScan, computeLegs, deployCapital, analyzeSignal } from './arb.js';
import { fmtUSD, esc, trunc } from './utils.js';

// ── Scan ──────────────────────────────────────────────────────────────────
export async function scan() {
  const btn     = document.getElementById('arb-scan-btn');
  const listEl  = document.getElementById('arb-list');

  if (btn) { btn.disabled = true; btn.textContent = 'Scanning…'; }
  listEl.innerHTML = `
    <div class="empty-state" style="padding:32px 20px">
      <div class="spinner"></div>
      <div class="es-text" style="margin-top:10px">Scanning ${S.markets.length} markets…</div>
    </div>`;

  await new Promise(r => setTimeout(r, 600)); // let spinner show

  const results = await runArbScan();

  if (btn) { btn.disabled = false; btn.textContent = 'Scan'; }

  renderList();
  window.ArbView?.afterScan(results);

  const count = S.arbResults.length;
  window.showToast?.(
    count ? `Found ${count} spread opportunities` : 'No arb found — try again later',
    count ? 'success' : 'info'
  );
}

// ── Render List ───────────────────────────────────────────────────────────
export function renderList(filter = {}) {
  const listEl = document.getElementById('arb-list');
  if (!listEl) return;

  const { minProfit = 0, category = 'all' } = filter;

  let results = [...(S.arbResults || [])].filter(r => r.grossProfit >= minProfit);
  if (category !== 'all') results = results.filter(r => r.category === category);

  if (!results.length) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">${S.arbResults?.length ? '🔎' : '⚡'}</div>
        <div class="es-text">${S.arbResults?.length
          ? 'No opportunities above threshold'
          : 'Click Scan to find opportunities'}</div>
      </div>`;
    return;
  }

  listEl.innerHTML = results.map(r => renderListItem(r)).join('');
}

function renderListItem(r) {
  const selected   = S.selectedArb?.id === r.id ? 'selected' : '';
  const sumColor   = r.sum < 0.95 ? 'var(--green)' : r.sum < 0.98 ? 'var(--amber)' : 'var(--red)';
  const profitSign = r.grossProfit > 0 ? '+' : '';
  // Data source badge — users must know whether this is verified CLOB data or a midpoint estimate
  const sourceBadge = r.verified
    ? `<span style="font-size:9px;font-weight:700;color:var(--green);letter-spacing:0.5px">✓ CLOB</span>`
    : `<span style="font-size:9px;color:var(--text3)">~ MID</span>`;

  return `
    <div class="arb-row ${selected}" onclick="Arb.select('${esc(r.id)}')">
      <div class="arb-row-question">${esc(trunc(r.question, 55))}</div>
      <div class="arb-row-meta">
        <span class="arb-price yes">${(r.yesPrice * 100).toFixed(1)}¢</span>
        <span class="arb-price no">${(r.noPrice * 100).toFixed(1)}¢</span>
        <span class="arb-sum" style="color:${sumColor}">${(r.sum * 100).toFixed(1)}¢</span>
        <span class="arb-profit val-green">${profitSign}${r.grossProfit.toFixed(2)}¢</span>
        ${sourceBadge}
      </div>
    </div>`;
}

// ── Select + Render Detail ────────────────────────────────────────────────
export function select(id) {
  S.selectedArb = (S.arbResults || []).find(r => r.id === id);
  if (!S.selectedArb) return;
  renderList(); // refresh to show selection
  renderDetail(S.selectedArb);
}

export function renderDetail(arb) {
  const el = document.getElementById('arb-detail-pane');
  if (!el) return;

  const capital = parseFloat(document.getElementById('arb-cap-input')?.value) || 1000;
  const legs    = computeLegs(arb, capital);
  const canTrade = PM.connected || SIM.enabled;

  el.innerHTML = `
    <!-- Opportunity Card -->
    <div class="arb-card">
      <div class="arb-card-title">📈 Opportunity</div>
      <div class="arb-market-question">${esc(arb.question)}</div>

      <div class="arb-price-viz">
        <div class="apv-side yes">
          <div class="apv-label">YES</div>
          <div class="apv-val">${(arb.yesPrice * 100).toFixed(1)}¢</div>
        </div>
        <div class="apv-divider">+</div>
        <div class="apv-side no">
          <div class="apv-label">NO</div>
          <div class="apv-val">${(arb.noPrice * 100).toFixed(1)}¢</div>
        </div>
        <div class="apv-divider">=</div>
        <div class="apv-side sum" style="color:${arb.sum < 0.96 ? 'var(--green)' : arb.sum < 0.99 ? 'var(--amber)' : 'var(--red)'}">
          <div class="apv-label">SUM</div>
          <div class="apv-val">${(arb.sum * 100).toFixed(1)}¢</div>
        </div>
      </div>

      <div class="arb-stats">
        <div class="arb-stat"><span>Gross spread</span><span class="val-green">+${arb.grossProfit.toFixed(2)}¢</span></div>
        <div class="arb-stat"><span>Net (~0.2% fees)</span><span class="val-green">+${arb.netProfit.toFixed(2)}¢</span></div>
        <div class="arb-stat"><span>Volume</span><span>${fmtUSD(arb.volume)}</span></div>
        <div class="arb-stat"><span>Category</span><span class="mkt-cat ${arb.category}">${arb.category}</span></div>
        <div class="arb-stat">
          <span>Price source</span>
          <span style="color:${arb.verified ? 'var(--green)' : 'var(--amber)'}">
            ${arb.verified ? '✓ CLOB best-ask (live)' : '~ Gamma midpoint (estimated)'}
          </span>
        </div>
        ${arb.maxTradeable ? `<div class="arb-stat"><span>Max tradeable (ask depth)</span><span>$${arb.maxTradeable.toFixed(0)}</span></div>` : ''}
        ${!arb.verified ? `<div style="font-size:10px;color:var(--amber);margin-top:8px;line-height:1.5;padding:6px 8px;background:rgba(255,184,0,0.08);border-radius:4px;border-left:2px solid var(--amber)">
          ⚠ Midpoint estimate — verify on Polymarket before deploying capital. CLOB fetch failed or market not in top 10 candidates.
        </div>` : ''}
      </div>
    </div>

    <!-- Leg Sizing -->
    <div class="arb-card">
      <div class="arb-card-title">💰 Leg Sizing</div>
      <div class="form-group">
        <label class="nova-label">Total Capital (USDC)</label>
        <input class="nova-input" id="arb-cap-input" type="number" value="${capital}" min="10"
          oninput="Arb.updateCalc(this.value)">
        <div class="amount-presets" style="margin-top:6px">
          ${[100,500,1000,5000].map(n =>
            `<button class="preset-btn" onclick="Arb.setCapital(${n})">\$${n}</button>`
          ).join('')}
        </div>
      </div>

      <div id="arb-calc" class="arb-calc-results">
        ${renderCalcRows(legs)}
      </div>
    </div>

    <!-- Deploy -->
    <div class="arb-card">
      <div class="arb-card-title">⚡ One-Click Deploy</div>
      ${canTrade
        ? `<div class="arb-deploy-info">
            Fires YES + NO simultaneously via Promise.allSettled.<br>
            Both orders hit the CLOB at the same instant — no sequential exposure.
            ${SIM.enabled ? '<br><strong style="color:var(--amber)">SIM MODE — no real orders</strong>' : ''}
           </div>`
        : `<div class="arb-wallet-gate">Connect wallet or enable sim mode to deploy</div>`
      }

      <button class="btn btn-primary" id="arb-deploy-btn" style="width:100%;margin-top:12px"
        ${canTrade ? '' : 'disabled'}
        onclick="Arb.deploy()">
        ${SIM.enabled ? '⚡ Deploy (SIM)' : canTrade ? '⚡ Deploy — Both Legs' : 'Connect Wallet to Deploy'}
      </button>

      <!-- Leg status indicators -->
      <div id="arb-leg-status" style="display:none;flex-direction:column;gap:6px;margin-top:12px">
        <div class="arb-leg-row">
          <div class="leg-dot" id="leg-dot-yes"></div>
          <span>YES leg — <strong id="arb-yes-amt">$${legs.yesAmt.toFixed(2)}</strong></span>
          <span id="arb-yes-result" style="margin-left:auto;font-size:11px"></span>
        </div>
        <div class="arb-leg-row">
          <div class="leg-dot" id="leg-dot-no"></div>
          <span>NO leg — <strong id="arb-no-amt">$${legs.noAmt.toFixed(2)}</strong></span>
          <span id="arb-no-result" style="margin-left:auto;font-size:11px"></span>
        </div>
        <div class="arb-leg-row" id="arb-summary-row" style="display:none">
          <div class="leg-dot filled"></div>
          <span id="arb-summary-label">Both legs filled</span>
          <span id="arb-summary-profit" class="val-green" style="margin-left:auto;font-size:11px"></span>
        </div>
      </div>
    </div>

    <!-- Tips -->
    <div class="arb-card">
      <div class="arb-card-title">💡 Execution Tips</div>
      <div class="arb-tips">
        <div>• Use <strong>limit orders</strong> to avoid slippage</div>
        <div>• Execute both legs <strong>within seconds</strong> — price can move</div>
        <div>• Check <strong>liquidity depth</strong> before sizing up</div>
        <div>• Arb profits are small per unit — <strong>size matters</strong></div>
      </div>
    </div>

    <!-- AI Analysis -->
    ${CFG.anthropicKey ? `
    <div class="arb-card">
      <div class="arb-card-title">🤖 AI Signal Validation</div>
      <button class="btn btn-sm" onclick="Arb.analyzeSelected()">Ask Pulse Agent</button>
      <div id="arb-ai-result" style="margin-top:10px;font-size:12px;color:var(--text2);line-height:1.6"></div>
    </div>` : ''}`;
}

function renderCalcRows(legs) {
  return `
    <div class="arb-stat"><span>Buy YES leg</span><span id="arb-yes-leg">$${legs.yesAmt.toFixed(2)}</span></div>
    <div class="arb-stat"><span>Buy NO leg</span><span id="arb-no-leg">$${legs.noAmt.toFixed(2)}</span></div>
    <div class="arb-stat"><span>Guaranteed profit</span><span class="val-green" id="arb-profit-val">$${legs.profit.toFixed(2)}</span></div>
    <div class="arb-stat"><span>ROI</span><span class="val-green" id="arb-roi-val">${legs.roi.toFixed(2)}%</span></div>`;
}

// ── Global Arb namespace (for onclick handlers) ────────────────────────────
window.Arb = {
  scan,
  select,
  renderList,

  updateCalc(capitalStr) {
    const capital = parseFloat(capitalStr) || 0;
    if (!S.selectedArb || !capital) return;
    const legs = computeLegs(S.selectedArb, capital);
    const set  = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('arb-yes-leg',   '$' + legs.yesAmt.toFixed(2));
    set('arb-no-leg',    '$' + legs.noAmt.toFixed(2));
    set('arb-profit-val','$' + legs.profit.toFixed(2));
    set('arb-roi-val',   legs.roi.toFixed(2) + '%');
    set('arb-yes-amt',   '$' + legs.yesAmt.toFixed(2));
    set('arb-no-amt',    '$' + legs.noAmt.toFixed(2));
  },

  setCapital(n) {
    const inp = document.getElementById('arb-cap-input');
    if (inp) { inp.value = n; this.updateCalc(n); }
  },

  async deploy() {
    const arb     = S.selectedArb;
    const capital = parseFloat(document.getElementById('arb-cap-input')?.value) || 1000;
    if (!arb) return;

    const legs = computeLegs(arb, capital);

    if (!SIM.enabled) {
      const ok = confirm(
        `Deploy $${capital} USDC into arb?\n\n` +
        `YES leg: $${legs.yesAmt.toFixed(2)}\n` +
        `NO leg:  $${legs.noAmt.toFixed(2)}\n` +
        `Profit:  $${legs.profit.toFixed(2)}\n\n` +
        `${trunc(arb.question, 80)}`
      );
      if (!ok) return;
    }

    const btn       = document.getElementById('arb-deploy-btn');
    const statusEl  = document.getElementById('arb-leg-status');
    const summaryEl = document.getElementById('arb-summary-row');

    statusEl.style.display = 'flex';
    summaryEl.style.display = 'none';
    if (btn) { btn.disabled = true; btn.textContent = 'Executing…'; }

    const setDot = (side, state) => {
      const el = document.getElementById(`leg-dot-${side.toLowerCase()}`);
      if (el) el.className = `leg-dot ${state}`;
    };

    const setResult = (side, text, color = '') => {
      const el = document.getElementById(`arb-${side.toLowerCase()}-result`);
      if (el) { el.textContent = text; el.style.color = color; }
    };

    await deployCapital(arb, capital, {
      onStatus: (state) => {
        if (btn) btn.textContent = state === 'executing' ? 'Executing…' : state;
      },

      onLeg: (side, state, errMsg) => {
        setDot(side, state);
        if (state === 'filled') setResult(side, 'Submitted', 'var(--green)');
        if (state === 'failed') setResult(side, 'Failed: ' + (errMsg || 'error'), 'var(--red)');
      },

      onDone: ({ success, profit, retried }) => {
        summaryEl.style.display = 'flex';
        const label  = document.getElementById('arb-summary-label');
        const profEl = document.getElementById('arb-summary-profit');
        if (label)  label.textContent  = success
          ? `Both legs ${retried ? '(retried) ' : ''}submitted`
          : 'Deploy failed';
        if (profEl) profEl.textContent = success ? `+$${profit.toFixed(2)} expected` : '';
        if (btn) {
          btn.disabled  = false;
          btn.className = success ? 'btn btn-primary' : 'btn btn-red';
          btn.textContent = success ? `✓ Done — +$${profit.toFixed(2)} locked` : 'Failed — retry?';
          if (!success) btn.onclick = () => Arb.deploy();
        }
        window.showToast?.(
          success ? `Arb deployed +$${profit.toFixed(2)}` : 'Deploy failed',
          success ? 'success' : 'error'
        );
      },

      onError: ({ partial, failedSide, failedAmt, profit, retry }) => {
        window.showToast?.(
          `${failedSide} leg failed — ${failedSide === 'YES' ? 'NO' : 'YES'} is LIVE. Tap to retry ${failedSide}.`,
          'warn'
        );
        if (btn) {
          btn.disabled  = false;
          btn.className = 'btn btn-red';
          btn.textContent = `Retry ${failedSide} leg ($${failedAmt.toFixed(2)})`;
          btn.onclick = async () => {
            btn.disabled = true;
            btn.textContent = 'Retrying…';
            const result = await retry();
            btn.disabled = false;
            if (result.ok) {
              btn.className   = 'btn btn-primary';
              btn.textContent = `✓ Both legs live — +$${profit.toFixed(2)}`;
              window.showToast?.('Both legs now live', 'success');
            } else {
              btn.textContent = `${failedSide} still failing — tap to retry`;
              btn.onclick = () => retry();
              window.showToast?.(failedSide + ' still failing: ' + result.error, 'error');
            }
          };
        }
      },
    });
  },

  async analyzeSelected() {
    const arb = S.selectedArb;
    if (!arb) return;

    const el = document.getElementById('arb-ai-result');
    if (!el) return;

    el.innerHTML = '<span style="color:var(--text3)">Asking Pulse…</span>';

    // Build signal with exactly the fields analyzeSignal()'s SPREAD_ARB branch reads:
    //   signal.question, signal.category, signal.yesPrice, signal.noPrice,
    //   signal.sum, signal.grossProfit, signal.netProfit, signal.verified,
    //   signal.dataSource, signal.volume
    // Previous code used 'anchor' instead of 'question' and omitted all price
    // fields → every field was undefined → .toFixed() threw TypeError before
    // the fetch was even attempted.
    const signal = {
      type:        'SPREAD_ARB',
      question:    arb.question,
      category:    arb.category,
      yesPrice:    arb.yesPrice,
      noPrice:     arb.noPrice,
      sum:         arb.sum,
      grossProfit: arb.grossProfit,
      netProfit:   arb.netProfit,
      verified:    arb.verified,
      dataSource:  arb.dataSource,
      volume:      arb.volume,
    };

    const result = await analyzeSignal(signal);

    if (result.ok) {
      el.innerHTML = result.text.replace(/\n/g, '<br>');
    } else {
      el.innerHTML = `<span style="color:var(--red)">${esc(result.error)}</span>`;
    }
  },
};

// ── CSS for arb-specific components (injected once) ───────────────────────
(function injectArbStyles() {
  if (document.getElementById('arb-styles')) return;
  const style = document.createElement('style');
  style.id = 'arb-styles';
  style.textContent = `
    .arb-row {
      padding: 9px 12px;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
      transition: background var(--t);
    }
    .arb-row:hover    { background: rgba(255,255,255,0.025); }
    .arb-row.selected { background: var(--blue-dim); border-left: 2px solid var(--blue); }

    .arb-row-question {
      font-size: 11px;
      color: var(--text);
      font-weight: 500;
      margin-bottom: 4px;
      line-height: 1.4;
    }

    .arb-row-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: var(--font-mono);
      font-size: 10px;
    }

    .arb-price.yes { color: var(--green); }
    .arb-price.no  { color: var(--red); }
    .arb-profit    { margin-left: auto; font-weight: 600; }

    .arb-card {
      padding: 14px 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius2);
      margin-bottom: 12px;
    }

    .arb-card-title {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      color: var(--text3);
      margin-bottom: 12px;
    }

    .arb-market-question {
      font-size: 13px;
      font-weight: 500;
      color: var(--text);
      line-height: 1.4;
      margin-bottom: 12px;
    }

    .arb-price-viz {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
      padding: 10px 12px;
      background: var(--surface2);
      border-radius: var(--radius);
    }

    .apv-side {
      text-align: center;
      flex: 1;
    }
    .apv-label { font-size: 9px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 3px; }
    .apv-val   { font-family: var(--font-mono); font-size: 18px; font-weight: 500; }
    .apv-side.yes .apv-label { color: var(--green); }
    .apv-side.yes .apv-val   { color: var(--green); }
    .apv-side.no  .apv-label { color: var(--red); }
    .apv-side.no  .apv-val   { color: var(--red); }
    .apv-divider { color: var(--text3); font-size: 16px; flex-shrink: 0; }

    .arb-stats { display: flex; flex-direction: column; gap: 0; }
    .arb-stat  {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
    }
    .arb-stat:last-child { border-bottom: none; }
    .arb-stat span:first-child { color: var(--text2); }
    .arb-stat span:last-child  { font-family: var(--font-mono); font-size: 11px; color: var(--text); }

    .arb-calc-results { margin-top: 8px; }

    .arb-deploy-info {
      font-size: 11px;
      color: var(--text2);
      line-height: 1.6;
      padding: 8px 10px;
      background: var(--surface2);
      border-radius: var(--radius);
      border-left: 2px solid var(--blue);
    }

    .arb-wallet-gate {
      font-size: 11px;
      color: var(--text3);
      padding: 8px 10px;
      background: var(--surface2);
      border-radius: var(--radius);
      border-left: 2px solid var(--text3);
    }

    .arb-leg-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 0;
      font-size: 12px;
      color: var(--text2);
    }

    .leg-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: var(--text3);
      flex-shrink: 0;
      transition: all 0.3s;
    }
    .leg-dot.sending { background: var(--amber); box-shadow: 0 0 6px var(--amber); animation: pulse 0.8s infinite; }
    .leg-dot.filled  { background: var(--green); box-shadow: 0 0 6px var(--green); }
    .leg-dot.failed  { background: var(--red);   box-shadow: 0 0 6px var(--red); }

    @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }

    .arb-tips {
      display: flex;
      flex-direction: column;
      gap: 5px;
      font-size: 11px;
      color: var(--text2);
      line-height: 1.6;
    }
    .arb-tips strong { color: var(--text); }
  `;
  document.head.appendChild(style);
})();
