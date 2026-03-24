/**
 * NOVA — Calculators Module
 * Registers window.Calc for onclick handlers in index.html.
 * Tabs: EV · Kelly · Arb Legs · P&L
 */

import { S } from './state.js';
import { kelly, expectedValue, clamp } from './utils.js';

// ── Helpers ────────────────────────────────────────────────────────────────
function num(id, fallback = 0) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const v = parseFloat(el.value);
  return isNaN(v) ? fallback : v;
}

function pct(id, fallback = 0) {
  return num(id, fallback) / 100;
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function resultRow(label, value, cls = '') {
  return `<div class="calc-row"><span class="calc-label">${label}</span><span class="calc-value${cls ? ' ' + cls : ''}">${value}</span></div>`;
}

function fmt2(n) { return isNaN(n) ? '—' : n.toFixed(2); }
function fmtPct(n) { return isNaN(n) ? '—' : (n * 100).toFixed(2) + '%'; }
function fmtUSD(n) { return isNaN(n) ? '—' : '$' + n.toFixed(2); }
function colorClass(n) { return n > 0 ? 'val-green' : n < 0 ? 'val-red' : ''; }

// ── Tab Templates ──────────────────────────────────────────────────────────
const TABS = {

  // ── Expected Value ────────────────────────────────────────────────────
  ev: `
    <div class="calc-group">
      <div class="calc-title">Expected Value Calculator</div>
      <div class="calc-desc">Determines whether a bet has positive EV given your estimated probability vs the market price.</div>
    </div>
    <div class="calc-group">
      <label class="calc-field">
        <span>Your Estimated Probability (%)</span>
        <input id="ev-prob"  type="number" min="0" max="100" step="0.1" value="60" placeholder="60" oninput="Calc._ev()">
      </label>
      <label class="calc-field">
        <span>Market Price (¢ / cents)</span>
        <input id="ev-price" type="number" min="1"  max="99"  step="0.1" value="50" placeholder="50" oninput="Calc._ev()">
      </label>
      <label class="calc-field">
        <span>Bet Amount ($)</span>
        <input id="ev-stake" type="number" min="0" step="1" value="100" placeholder="100" oninput="Calc._ev()">
      </label>
    </div>
    <div id="ev-results" class="calc-results"></div>`,

  // ── Kelly Criterion ───────────────────────────────────────────────────
  kelly: `
    <div class="calc-group">
      <div class="calc-title">Kelly Criterion</div>
      <div class="calc-desc">Optimal fraction of bankroll to wager. Uses fractional Kelly (¼ and ½) for practical sizing.</div>
    </div>
    <div class="calc-group">
      <label class="calc-field">
        <span>Your Estimated Probability (%)</span>
        <input id="kl-prob"     type="number" min="0" max="100" step="0.1" value="60" placeholder="60" oninput="Calc._kelly()">
      </label>
      <label class="calc-field">
        <span>Market Price (¢ / cents)</span>
        <input id="kl-price"    type="number" min="1"  max="99"  step="0.1" value="50" placeholder="50" oninput="Calc._kelly()">
      </label>
      <label class="calc-field">
        <span>Bankroll ($)</span>
        <input id="kl-bankroll" type="number" min="0" step="10"  value="1000" placeholder="1000" oninput="Calc._kelly()">
      </label>
    </div>
    <div id="kl-results" class="calc-results"></div>`,

  // ── Arb Legs ──────────────────────────────────────────────────────────
  arb: `
    <div class="calc-group">
      <div class="calc-title">Arbitrage Leg Sizer</div>
      <div class="calc-desc">Given YES and NO ask prices that sum to less than 100¢, calculates how to split capital to lock in risk-free profit.</div>
    </div>
    <div class="calc-group">
      <label class="calc-field">
        <span>YES Ask Price (¢)</span>
        <input id="arb-yes"     type="number" min="1" max="98" step="0.1" value="48" placeholder="48" oninput="Calc._arb()">
      </label>
      <label class="calc-field">
        <span>NO Ask Price (¢)</span>
        <input id="arb-no"      type="number" min="1" max="98" step="0.1" value="48" placeholder="48" oninput="Calc._arb()">
      </label>
      <label class="calc-field">
        <span>Total Capital ($)</span>
        <input id="arb-capital" type="number" min="0" step="10" value="500" placeholder="500" oninput="Calc._arb()">
      </label>
    </div>
    <div id="arb-results" class="calc-results"></div>`,

  // ── P&L ───────────────────────────────────────────────────────────────
  pnl: `
    <div class="calc-group">
      <div class="calc-title">Position P&amp;L</div>
      <div class="calc-desc">Calculates profit, loss, and breakeven for an open prediction market position.</div>
    </div>
    <div class="calc-group">
      <label class="calc-field">
        <span>Entry Price (¢)</span>
        <input id="pnl-entry"   type="number" min="1" max="99" step="0.1" value="40" placeholder="40" oninput="Calc._pnl()">
      </label>
      <label class="calc-field">
        <span>Current Price (¢)</span>
        <input id="pnl-current" type="number" min="1" max="99" step="0.1" value="60" placeholder="60" oninput="Calc._pnl()">
      </label>
      <label class="calc-field">
        <span>Shares / Contracts</span>
        <input id="pnl-shares"  type="number" min="0" step="1" value="100" placeholder="100" oninput="Calc._pnl()">
      </label>
    </div>
    <div id="pnl-results" class="calc-results"></div>`,
};

// ── Calc Computations ──────────────────────────────────────────────────────
function computeEV() {
  const prob  = pct('ev-prob');
  const price = num('ev-price') / 100;
  const stake = num('ev-stake');
  if (!price || price <= 0 || price >= 1) return setHTML('ev-results', '<div class="calc-warn">Enter a valid market price (1–99¢).</div>');

  const odds     = 1 / price;
  const ev       = (prob * odds) - 1;
  const profitWin = stake * (odds - 1);
  const dollarEV  = ev * stake;
  const edge      = prob - price;
  const isPos     = ev > 0;

  setHTML('ev-results', `
    <div class="calc-result-box ${isPos ? 'positive' : 'negative'}">
      ${resultRow('Edge vs market', (edge * 100).toFixed(1) + '¢', colorClass(edge))}
      ${resultRow('Expected Value', fmtPct(ev), colorClass(ev))}
      ${resultRow('Dollar EV on $' + stake.toFixed(0), fmtUSD(dollarEV), colorClass(dollarEV))}
      ${resultRow('Profit if WIN', fmtUSD(profitWin), 'val-green')}
      ${resultRow('Loss if LOSE', fmtUSD(-stake), 'val-red')}
      ${resultRow('Decimal odds', fmt2(odds))}
      <div class="calc-verdict ${isPos ? 'verdict-yes' : 'verdict-no'}">${isPos ? '✓ Positive EV — edge exists' : '✗ Negative EV — market priced against you'}</div>
    </div>`);
}

function computeKelly() {
  const prob     = pct('kl-prob');
  const price    = num('kl-price') / 100;
  const bankroll = num('kl-bankroll');
  if (!price || price <= 0 || price >= 1) return setHTML('kl-results', '<div class="calc-warn">Enter a valid market price (1–99¢).</div>');

  const odds    = 1 / price;
  const full    = kelly(prob, odds);
  const half    = full / 2;
  const quarter = full / 4;

  const clampedFull    = clamp(full, 0, 1);
  const clampedHalf    = clamp(half, 0, 1);
  const clampedQuarter = clamp(quarter, 0, 1);

  const hasEdge = full > 0;

  setHTML('kl-results', `
    <div class="calc-result-box ${hasEdge ? 'positive' : 'negative'}">
      ${resultRow('Full Kelly', fmtPct(clampedFull), colorClass(full))}
      ${resultRow('½ Kelly (recommended)', fmtPct(clampedHalf), colorClass(half))}
      ${resultRow('¼ Kelly (conservative)', fmtPct(clampedQuarter), colorClass(quarter))}
      <div style="height:1px;background:var(--border);margin:10px 0"></div>
      ${resultRow('Full Kelly $', fmtUSD(bankroll * clampedFull), colorClass(full))}
      ${resultRow('½ Kelly $', fmtUSD(bankroll * clampedHalf), colorClass(half))}
      ${resultRow('¼ Kelly $', fmtUSD(bankroll * clampedQuarter), colorClass(quarter))}
      <div class="calc-verdict ${hasEdge ? 'verdict-yes' : 'verdict-no'}">${hasEdge ? '✓ Edge detected — size a position' : '✗ No edge — Kelly says pass'}</div>
    </div>`);
}

function computeArb() {
  const yes     = num('arb-yes') / 100;
  const no      = num('arb-no') / 100;
  const capital = num('arb-capital');
  const total   = yes + no;
  const spread  = 1 - total;

  if (total >= 1) {
    setHTML('arb-results', `<div class="calc-warn">YES + NO prices sum to ${(total * 100).toFixed(1)}¢ — no arb opportunity (need &lt; 100¢).</div>`);
    return;
  }

  // Optimal: allocate proportional to each leg's OWN price so shares are equal on both sides.
  // yesAmt = capital × yes / sum, noAmt = capital × no / sum.
  // This ensures yesAmt/yes = noAmt/no (equal shares → equal $1 payout at resolution).
  // Previous code had yes/no SWAPPED here, producing unequal payouts — not risk-free.
  const yesAmt   = capital * (yes / total);
  const noAmt    = capital * (no  / total);
  const payoutYes = yesAmt / yes;   // shares × $1
  const payoutNo  = noAmt  / no;
  const profit    = (payoutYes - capital);
  const roi       = profit / capital;

  setHTML('arb-results', `
    <div class="calc-result-box positive">
      ${resultRow('YES + NO total', (total * 100).toFixed(1) + '¢')}
      ${resultRow('Spread (arb gap)', (spread * 100).toFixed(1) + '¢', 'val-green')}
      <div style="height:1px;background:var(--border);margin:10px 0"></div>
      ${resultRow('Buy YES leg', fmtUSD(yesAmt))}
      ${resultRow('Buy NO leg',  fmtUSD(noAmt))}
      ${resultRow('Guaranteed payout', fmtUSD(payoutYes))}
      ${resultRow('Guaranteed profit', fmtUSD(profit), 'val-green')}
      ${resultRow('ROI', fmtPct(roi), 'val-green')}
      <div class="calc-verdict verdict-yes">✓ Risk-free profit on $${capital.toFixed(0)}</div>
    </div>`);
}

function computePnL() {
  const entry   = num('pnl-entry')   / 100;
  const current = num('pnl-current') / 100;
  const shares  = num('pnl-shares');
  const cost    = entry * shares;
  const value   = current * shares;
  const pnl     = value - cost;
  const pnlPct  = cost > 0 ? pnl / cost : 0;
  // Breakeven: price must reach entry to recover cost
  const bePrice = entry;
  // Potential P&L if resolved YES (price → $1)
  const resolveYes = (1 - entry) * shares;
  const resolveNo  = -cost;

  setHTML('pnl-results', `
    <div class="calc-result-box ${pnl >= 0 ? 'positive' : 'negative'}">
      ${resultRow('Cost basis', fmtUSD(cost))}
      ${resultRow('Current value', fmtUSD(value))}
      ${resultRow('Unrealised P&L', fmtUSD(pnl), colorClass(pnl))}
      ${resultRow('Return', fmtPct(pnlPct), colorClass(pnlPct))}
      <div style="height:1px;background:var(--border);margin:10px 0"></div>
      ${resultRow('Breakeven price', (bePrice * 100).toFixed(1) + '¢')}
      ${resultRow('If resolves YES', fmtUSD(resolveYes), 'val-green')}
      ${resultRow('If resolves NO',  fmtUSD(resolveNo),  'val-red')}
      <div class="calc-verdict ${pnl >= 0 ? 'verdict-yes' : 'verdict-no'}">${pnl >= 0 ? '✓ Currently in profit' : '✗ Currently at a loss'}</div>
    </div>`);
}

// ── Render Tab ─────────────────────────────────────────────────────────────
function renderTab(name) {
  const el = document.getElementById('calc-content');
  if (!el) return;
  el.innerHTML = TABS[name] || '';
  S.activeCalcTab = name;
  // Trigger initial compute
  switch (name) {
    case 'ev':    computeEV();    break;
    case 'kelly': computeKelly(); break;
    case 'arb':   computeArb();   break;
    case 'pnl':   computePnL();   break;
  }
}

// ── Inject Styles ──────────────────────────────────────────────────────────
(function injectCalcStyles() {
  if (document.getElementById('calc-styles')) return;
  const s = document.createElement('style');
  s.id = 'calc-styles';
  s.textContent = `
    .calc-group { margin-bottom: 20px; }
    .calc-title { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 6px; font-family: var(--font-display); }
    .calc-desc  { font-size: 11px; color: var(--text3); line-height: 1.5; }
    .calc-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
    .calc-field span { font-size: 11px; color: var(--text2); }
    .calc-field input, .calc-field select {
      padding: 7px 10px; background: var(--surface2); border: 1px solid var(--border2);
      border-radius: var(--radius); color: var(--text); font-size: 13px;
      font-family: var(--font-mono); width: 100%; transition: border-color var(--t);
    }
    .calc-field input:focus { outline: none; border-color: var(--blue); }
    .calc-results { margin-top: 4px; }
    .calc-result-box { border-radius: var(--radius2); padding: 14px 16px; background: var(--surface2); border: 1px solid var(--border); }
    .calc-result-box.positive { border-color: rgba(0,229,153,0.2); }
    .calc-result-box.negative { border-color: rgba(255,59,92,0.2); }
    .calc-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
    .calc-row:last-of-type { border-bottom: none; }
    .calc-label { color: var(--text2); }
    .calc-value { font-family: var(--font-mono); font-weight: 500; color: var(--text); }
    .calc-verdict { margin-top: 12px; font-size: 11px; font-weight: 600; padding: 7px 10px; border-radius: var(--radius); text-align: center; letter-spacing: 0.3px; }
    .verdict-yes { background: rgba(0,229,153,0.1); color: var(--green); border: 1px solid rgba(0,229,153,0.2); }
    .verdict-no  { background: rgba(255,59,92,0.1);  color: var(--red);   border: 1px solid rgba(255,59,92,0.2); }
    .calc-warn   { font-size: 11px; color: var(--amber); background: var(--amber-dim); border: 1px solid rgba(255,184,0,0.2); border-radius: var(--radius); padding: 8px 12px; }
    .active-tab  { background: var(--blue-dim) !important; border-color: var(--blue) !important; color: var(--blue) !important; }
    .val-green   { color: var(--green) !important; }
    .val-red     { color: var(--red) !important; }
  `;
  document.head.appendChild(s);
})();

// ── Global namespace ───────────────────────────────────────────────────────
window.Calc = {
  switchTab(name, el) {
    document.querySelectorAll('#calc-tabs .btn').forEach(b => b.classList.remove('active-tab'));
    el?.classList.add('active-tab');
    renderTab(name);
  },

  // Bound to oninput handlers
  _ev:    computeEV,
  _kelly: computeKelly,
  _arb:   computeArb,
  _pnl:   computePnL,
};
