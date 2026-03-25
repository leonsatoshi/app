/**
 * NOVA — Agents UI
 * Renders the Agents tab inside the market detail pane.
 * Called dynamically via: import('./agents-ui.js').then(m => m.renderAgentsTab(market))
 */

import { AGENTS } from './constants.js';
import { CFG } from './state.js';
import { quickAnalysis, fullAnalysis } from './agents.js';
import { esc, trunc } from './utils.js';

// ── State ──────────────────────────────────────────────────────────────────
let _market   = null;
let _results  = {};   // agentId → { ok, text, error }
let _running  = false;

// ── Entry Point ────────────────────────────────────────────────────────────
export function renderAgentsTab(market) {
  _market  = market;
  _results = {};
  _render();
}

// ── Render ─────────────────────────────────────────────────────────────────
function _render() {
  const el = document.getElementById('detail-content');
  if (!el) return;

  if (!_market) {
    el.innerHTML = `<div class="empty-state"><div class="es-icon">◎</div><div class="es-text">Select a market to run agents</div></div>`;
    return;
  }

  const hasKey   = !!CFG.anthropicKey;
  const agentList = Object.values(AGENTS);

  el.innerHTML = `
    <div id="agents-root" style="padding:16px;overflow-y:auto;height:100%;display:flex;flex-direction:column;gap:16px">

      <!-- Header -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-shrink:0">
        <div style="min-width:0">
          <div style="font-size:10px;color:var(--text3);letter-spacing:.8px;text-transform:uppercase;margin-bottom:4px">AI Analysis</div>
          <div style="font-size:12px;color:var(--text2);line-height:1.4">${esc(trunc(_market.question, 100))}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-sm btn-primary" id="agents-run-all" onclick="AgentsUI.runAll()" ${_running || !hasKey ? 'disabled' : ''}>
            ${_running ? '<span class="spinner-xs"></span> Running…' : '⚡ Run All'}
          </button>
        </div>
      </div>

      ${!hasKey ? `
        <div style="background:var(--amber-dim);border:1px solid rgba(255,184,0,0.2);border-radius:var(--radius);padding:10px 12px;font-size:11px;color:var(--amber)">
          ⚠ Anthropic API key required. Add it in <button class="btn btn-xs btn-ghost" style="color:var(--amber);border-color:rgba(255,184,0,0.3)" onclick="UI.openSettings()">⚙ Settings</button>
        </div>` : ''}

      <!-- Agent Cards -->
      <div id="agents-grid" style="display:flex;flex-direction:column;gap:10px">
        ${agentList.map(a => _agentCard(a)).join('')}
      </div>

    </div>`;

  _injectStyles();
}

function _agentCard(agent) {
  const res     = _results[agent.id];
  const isLoading = _running && !res;

  let body = '';
  if (isLoading) {
    body = `<div class="agent-body loading"><span class="spinner-xs"></span> Analyzing…</div>`;
  } else if (res?.ok) {
    body = `<div class="agent-body result">${_formatText(res.text)}</div>`;
  } else if (res?.error) {
    body = `<div class="agent-body error">⚠ ${esc(res.error)}</div>`;
  } else {
    body = `<div class="agent-body idle">Click Run to get ${agent.name}'s analysis</div>`;
  }

  return `
    <div class="agent-card" id="agent-card-${agent.id}">
      <div class="agent-header">
        <span class="agent-icon">${agent.icon}</span>
        <div class="agent-meta">
          <span class="agent-name" style="color:${agent.color}">${agent.name}</span>
          <span class="agent-role">${agent.role}</span>
        </div>
        <button class="btn btn-xs btn-ghost agent-run-btn" onclick="AgentsUI.runOne('${agent.id}')"
          ${_running || !CFG.anthropicKey ? 'disabled' : ''} title="Run ${agent.name}">
          ${_running && !_results[agent.id] ? '…' : '▶'}
        </button>
      </div>
      ${body}
    </div>`;
}

// ── Text Formatter ─────────────────────────────────────────────────────────
// Lightweight markdown-ish formatter: **bold**, bullet lists, numbered lists
function _formatText(text) {
  if (!text) return '';
  return text
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .split('\n')
    .map(line => {
      const bullet   = line.match(/^[\-\*•]\s+(.+)/);
      const numbered = line.match(/^\d+\.\s+(.+)/);
      if (bullet)   return `<li>${bullet[1]}</li>`;
      if (numbered) return `<li>${numbered[1]}</li>`;
      return line ? `<p>${line}</p>` : '';
    })
    .join('')
    .replace(/(<li>.*<\/li>)+/g, m => `<ul>${m}</ul>`);
}

// ── Styles ─────────────────────────────────────────────────────────────────
function _injectStyles() {
  if (document.getElementById('agents-ui-styles')) return;
  const s = document.createElement('style');
  s.id = 'agents-ui-styles';
  s.textContent = `
    .agent-card {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: var(--radius2);
      overflow: hidden;
      transition: border-color var(--t);
    }
    .agent-card:hover { border-color: var(--border2); }

    .agent-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
    }
    .agent-icon   { font-size: 18px; flex-shrink: 0; }
    .agent-meta   { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .agent-name   { font-size: 12px; font-weight: 600; }
    .agent-role   { font-size: 10px; color: var(--text3); }
    .agent-run-btn { flex-shrink: 0; }

    .agent-body {
      padding: 10px 12px;
      font-size: 11px;
      line-height: 1.6;
      color: var(--text2);
    }
    .agent-body.idle    { color: var(--text3); font-style: italic; }
    .agent-body.loading { display: flex; align-items: center; gap: 8px; color: var(--text3); }
    .agent-body.error   { color: var(--amber); background: var(--amber-dim); }
    .agent-body.result  { color: var(--text2); }
    .agent-body.result p   { margin-bottom: 6px; }
    .agent-body.result p:last-child { margin-bottom: 0; }
    .agent-body.result ul  { padding-left: 16px; margin-bottom: 6px; }
    .agent-body.result li  { margin-bottom: 3px; }
    .agent-body.result strong { color: var(--text); font-weight: 600; }

    .spinner-xs {
      display: inline-block;
      width: 10px; height: 10px;
      border: 1.5px solid var(--border2);
      border-top-color: var(--blue);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(s);
}

// ── Global namespace (for onclick handlers generated above) ────────────────
window.AgentsUI = {
  async runAll() {
    if (_running || !_market) return;
    _running = true;
    _results = {};
    _render();

    const agentIds = Object.keys(AGENTS);

    // Run all agents in parallel
    const promises = agentIds.map(async id => {
      const res = await quickAnalysis(_market, id);
      _results[id] = res;
      // Patch just the one card to avoid full re-render mid-flight
      const cardEl = document.getElementById(`agent-card-${id}`);
      if (cardEl) cardEl.outerHTML = _agentCard(AGENTS[id]);
    });

    await Promise.allSettled(promises);
    _running = false;
    _render();
  },

  async runOne(agentId) {
    if (!_market) return;
    // Guard: don't start if a full runAll is already in flight
    if (_running) return;
    _running = true;

    // Optimistically update just this card to show loading
    const cardEl = document.getElementById(`agent-card-${agentId}`);
    const agent  = AGENTS[agentId];
    if (cardEl && agent) {
      // Temporarily show loading body without full re-render
      const bodyEl = cardEl.querySelector('.agent-body');
      if (bodyEl) {
        bodyEl.className = 'agent-body loading';
        bodyEl.innerHTML = `<span class="spinner-xs"></span> Analyzing…`;
      }
      // Disable run button during fetch
      const runBtn = cardEl.querySelector('.agent-run-btn');
      if (runBtn) runBtn.disabled = true;
    }

    const res = await quickAnalysis(_market, agentId);
    _results[agentId] = res;
    _running = false;

    // Only re-render the one card that changed
    const updated = document.getElementById(`agent-card-${agentId}`);
    if (updated && agent) {
      updated.outerHTML = _agentCard(agent);
    } else {
      _render(); // fallback
    }
  },
};
