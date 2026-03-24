/**
 * NOVA — Utils
 * Pure helper functions. No side effects. No state access.
 * All functions are exported individually for tree-shaking.
 */

// ── String / HTML ──────────────────────────────────────────────────────────
export function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

export function trunc(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function slug(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// escHtml: escape HTML special characters before inserting into the DOM.
// Applied to every capture group in fmtMD so that AI-generated output
// containing stray HTML tags can't become executable markup.
function escHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtMD(t) {
  if (!t) return '';
  // Escape first, then apply safe markdown substitutions.
  // Order matters: escape must run before the <strong>/<em>/<code> insertions
  // so that the injected HTML tags themselves are not re-escaped.
  return escHtml(t)
    .replace(/\*\*(.*?)\*\*/g, (_, m) => `<strong>${m}</strong>`)
    .replace(/\*(.*?)\*/g,   (_, m) => `<em>${m}</em>`)
    .replace(/`([^`]+)`/g,   (_, m) => `<code>${m}</code>`)
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

// ── Number / Currency ──────────────────────────────────────────────────────
export function fmtUSD(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return '$' + (n / 1_000).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

export function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return (n * 100).toFixed(1) + '%';
}

export function fmtProb(p) {
  if (p == null || isNaN(p)) return '—';
  const pct = (p * 100);
  return pct.toFixed(pct < 1 || pct > 99 ? 1 : 0) + '¢';
}

export function fmtPnL(n) {
  if (n == null || isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return sign + '$' + Math.abs(n).toFixed(2);
}

// ── Address ────────────────────────────────────────────────────────────────
export function shortAddr(a) {
  if (!a || a === '0xSIM000000000000000000000000000000000001') return 'SIM';
  if (a === '0xDEMO') return 'Demo';
  return a.slice(0, 6) + '…' + a.slice(-4);
}

// ── Date / Time ────────────────────────────────────────────────────────────
export function fmtDate(d) {
  if (!d) return 'Open';
  const dt = new Date(d);
  if (isNaN(dt)) return 'Open';
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}

export function fmtTS(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

// ── Local Storage ──────────────────────────────────────────────────────────
export function load(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v != null ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ── Math ───────────────────────────────────────────────────────────────────
export function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

export function kelly(prob, odds) {
  // Standard Kelly: (p * b - q) / b where b = decimal odds - 1
  const q = 1 - prob;
  const b = odds - 1;
  if (b <= 0) return 0;
  return clamp((prob * b - q) / b, 0, 1);
}

export function expectedValue(prob, price) {
  const odds = 1 / price;
  return (prob * odds) - 1;
}

// ── Nonce ──────────────────────────────────────────────────────────────────
// Monotonic nonce generator — safe for rapid sequential calls.
// Returns a guaranteed-unique integer each call within a session.
let _lastNonce = 0;
export function getSafeNonce() {
  const ts = Date.now();
  _lastNonce = ts > _lastNonce ? ts : _lastNonce + 1;
  return _lastNonce;
}

// ── Misc ───────────────────────────────────────────────────────────────────
export function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function inferCategory(q) {
  const s = (q || '').toLowerCase();
  // Word boundaries on short tokens that appear as substrings in common words:
  //   'sol' → 'consolidate', 'solar', 'resolve', 'resolution', 'console'
  //   'eth' → 'method', 'whether', 'together', 'health', 'bethlehem'
  //   'ai'  → 'rain', 'train', 'paid', 'brain', 'maintain'
  //   'win' → 'window', 'winning' (acceptable for sports but not 'winning')
  //   'llm' → rarely a substring but keep \b for consistency
  if (/\bbtc\b|bitcoin|ethereum|\beth\b|\bcrypto\b|\bsol\b|dogecoin|\bdoge\b/.test(s)) return 'crypto';
  if (/elect|president|senate|congress|\bvote\b|ballot|\bpoll\b|biden|trump/.test(s)) return 'politics';
  if (/\bnba\b|\bnfl\b|\bnhl\b|\bmlb\b|soccer|fifa|\bsport\b|champion|\bwin\b|\bwins\b/.test(s)) return 'sports';
  if (/\bfed\b|interest.?rate|\bgdp\b|inflation|recession|\bstock\b|nasdaq|s&p/.test(s)) return 'finance';
  if (/openai|anthropic|\bgpt\b|\bllm\b|\bai\b|\bmodel\b/.test(s)) return 'tech';
  return 'other';
}
