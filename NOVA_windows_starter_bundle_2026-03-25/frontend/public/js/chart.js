/**
 * NOVA — Chart Module
 */

import { S } from './state.js';
import { fetchMarketHistory } from './api.js';
import { CHART_PADDING } from './constants.js';

export async function loadChart(market, range = '1W') {
  S.chartRange = range;
  const canvas = document.getElementById('chart-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const { startTs, interval } = rangeParams(range);

  let data = null;

  if (market.clobTokenIds?.[0]) {
    const result = await fetchMarketHistory(market.clobTokenIds[0], startTs, interval);
    if (result.ok && result.data) {
      const h = result.data.history || result.data;
      if (Array.isArray(h) && h.length > 1) {
        data = h.map(p => ({ t: (p.t || p.timestamp) * 1000, p: parseFloat(p.p || p.price || 0) }))
                .filter(p => !isNaN(p.p) && p.p > 0);
      }
    }
  }

  let isDemo = false;
  if (!data || data.length < 2) {
    data   = genDemoData(market.yesPrice, range);
    isDemo = true;
  }

  drawChart(canvas, ctx, data, market.yesPrice);

  // R-CHART-01: always tell the user when they're looking at demo data.
  // A silently-generated random walk looks identical to real history and
  // could influence trading decisions. Show a prominent label if real
  // data was unavailable (no tokenId, proxy down, or CLOB returned nothing).
  const wrap = document.getElementById('chart-wrap');
  const old  = document.getElementById('chart-demo-badge');
  if (old) old.remove();
  if (isDemo && wrap) {
    const badge = document.createElement('div');
    badge.id = 'chart-demo-badge';
    badge.style.cssText = [
      'position:absolute', 'top:6px', 'right:8px',
      'font-size:9px', 'font-weight:700', 'letter-spacing:.8px',
      'text-transform:uppercase', 'color:var(--amber)',
      'background:rgba(255,184,0,0.12)',
      'border:1px solid rgba(255,184,0,0.3)',
      'border-radius:3px', 'padding:2px 6px',
      'pointer-events:none',
    ].join(';');
    badge.textContent = 'Demo data — no history available';
    // chart-wrap needs position:relative for the absolute badge to sit correctly
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    wrap.appendChild(badge);
  }
}

window.Chart = {
  setRange(range, el) {
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('on'));
    el?.classList.add('on');
    if (S.selected) loadChart(S.selected, range);
  },
};

function drawChart(canvas, ctx, data, currentPrice) {
  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;
  const P = CHART_PADDING;

  const minP = Math.min(...data.map(d => d.p)) * 0.95;
  const maxP = Math.max(...data.map(d => d.p)) * 1.05;
  const rangeP = maxP - minP || 0.01;

  const toX = t => P.left + ((t - data[0].t) / (data[data.length - 1].t - data[0].t)) * (W - P.left - P.right);
  const toY = p => P.top  + (1 - (p - minP) / rangeP) * (H - P.top - P.bottom);

  ctx.clearRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach(f => {
    const y = P.top + f * (H - P.top - P.bottom);
    ctx.beginPath(); ctx.moveTo(P.left, y); ctx.lineTo(W - P.right, y); ctx.stroke();
  });

  // Area fill
  const grad = ctx.createLinearGradient(0, P.top, 0, H - P.bottom);
  grad.addColorStop(0, 'rgba(0,200,255,0.15)');
  grad.addColorStop(1, 'rgba(0,200,255,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(toX(data[0].t), H - P.bottom);
  data.forEach(d => ctx.lineTo(toX(d.t), toY(d.p)));
  ctx.lineTo(toX(data[data.length - 1].t), H - P.bottom);
  ctx.closePath();
  ctx.fill();

  // Line
  ctx.strokeStyle = 'rgba(0,200,255,0.8)';
  ctx.lineWidth   = 1.5;
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  data.forEach((d, i) => i === 0 ? ctx.moveTo(toX(d.t), toY(d.p)) : ctx.lineTo(toX(d.t), toY(d.p)));
  ctx.stroke();

  // Current price dot
  const lastX = toX(data[data.length - 1].t);
  const lastY = toY(data[data.length - 1].p);
  ctx.fillStyle = 'var(--blue, #00C8FF)';
  ctx.beginPath();
  ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
  ctx.fill();

  // Y axis labels
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font      = '10px JetBrains Mono, monospace';
  ctx.textAlign = 'right';
  [minP, (minP + maxP) / 2, maxP].forEach(p => {
    ctx.fillText((p * 100).toFixed(0) + '¢', P.left - 4, toY(p) + 3);
  });
}

function rangeParams(r) {
  const now = Math.floor(Date.now() / 1000);
  const map = {
    '1D': { startTs: now - 86400,    interval: '1h' },
    '1W': { startTs: now - 604800,   interval: '6h' },
    '1M': { startTs: now - 2592000,  interval: '1d' },
    'All':{ startTs: 0,              interval: '1d' },
  };
  return map[r] || map['1W'];
}

function genDemoData(currentPrice, range) {
  const pts = { '1D': 24, '1W': 42, '1M': 60, 'All': 80 }[range] || 42;
  const span = { '1D': 86400000, '1W': 604800000, '1M': 2592000000, 'All': 7776000000 }[range] || 604800000;
  const now  = Date.now();
  const data = [];
  let v = Math.max(0.04, Math.min(0.96, currentPrice + (Math.random() - 0.5) * 0.2));
  for (let i = 0; i < pts; i++) {
    v += (Math.random() - 0.48) * 0.03;
    v = Math.max(0.03, Math.min(0.97, v));
    data.push({ t: now - span + (i / pts) * span, p: v });
  }
  data[data.length - 1].p = currentPrice;
  return data;
}
