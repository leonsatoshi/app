/**
 * NOVA — API Layer
 * All network calls go through here. Never call fetch() directly in feature modules.
 * Handles: proxy detection, base URL switching, error normalization, retries.
 */

import { ENDPOINTS, PROXY_BASE } from './constants.js';
import { S } from './state.js';

// ── Proxy Detection ────────────────────────────────────────────────────────
export async function detectProxy() {
  try {
    const r = await fetch(`${PROXY_BASE}/ping`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) {
      S.proxyActive = true;
      console.log('[NOVA] ✓ Proxy active on', PROXY_BASE);
      return true;
    }
  } catch {
    // Proxy not running — fall through to direct mode
  }
  S.proxyActive = false;
  console.log('[NOVA] Proxy unreachable — direct API mode (CORS may block some calls)');
  return false;
}

// ── Base URL Resolver ──────────────────────────────────────────────────────
// Always call this to get the right base — never hardcode ENDPOINTS directly in modules.
export function base(service) {
  if (S.proxyActive) {
    const map = { gamma: '/gamma', clob: '/clob', data: '/data', rpc: '/polygon' };
    const path = map[service];
    if (!path) throw new Error(`Unknown service: ${service}`);
    return PROXY_BASE + path;
  }
  const url = ENDPOINTS[service];
  if (!url) throw new Error(`Unknown service: ${service}`);
  return url;
}

// ── Core Fetch Wrapper ─────────────────────────────────────────────────────
// Normalizes errors into a consistent { ok, data, error, status } shape.
export async function apiFetch(url, opts = {}) {
  const { retries = 1, timeout = 8000, ...fetchOpts } = opts;
  const MAX_RATE_LIMIT_RETRIES = 5;
  let rateLimitHits = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let timer;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeout);

      const r = await fetch(url, {
        ...fetchOpts,
        signal: controller.signal,
      });
      clearTimeout(timer);

      // R-NET-01: handle 429 rate limit — read Retry-After and back off before retrying.
      // IMPORTANT: decrement attempt before continue so the outer loop counter doesn't
      // advance. Without this, consecutive 429s exhaust (retries+1) iterations and the
      // function falls off the end of the for loop returning undefined — not an error object.
      // Every caller does result.ok which crashes with TypeError on undefined.
      if (r.status === 429) {
        rateLimitHits++;
        if (rateLimitHits > MAX_RATE_LIMIT_RETRIES) {
          return { ok: false, status: 429, error: `Rate limited — max retries (${MAX_RATE_LIMIT_RETRIES}) exceeded`, data: null };
        }
        const retryAfter = parseInt(r.headers.get('Retry-After') || '5', 10);
        console.warn(`[NOVA] Rate limited (429) — waiting ${retryAfter}s before retry ${rateLimitHits}/${MAX_RATE_LIMIT_RETRIES}`);
        window.showToast?.(`Rate limited — retrying in ${retryAfter}s`, 'warn');
        await new Promise(res => setTimeout(res, retryAfter * 1000));
        attempt--; // don't consume a normal retry slot for a 429 — loop again
        continue;
      }

      if (!r.ok) {
        const body = await r.text().catch(() => '');
        return { ok: false, status: r.status, error: body || `HTTP ${r.status}`, data: null };
      }

      const data = await r.json().catch(() => null);
      return { ok: true, status: r.status, data, error: null };

    } catch (err) {
      clearTimeout(timer); // cancel the abort timer if fetch threw
      if (attempt === retries) {
        const msg = err.name === 'AbortError' ? 'Request timed out' : err.message;

        // R-STATE-01: if a call to localhost fails with a network error, the proxy
        // may have been restarted mid-session. Re-detect and update the status dot.
        if (url.startsWith(PROXY_BASE) && err.name !== 'AbortError') {
          console.warn('[NOVA] localhost call failed — re-checking proxy status');
          detectProxy().then(up => {
            const dot = document.getElementById('proxy-dot');
            if (dot) {
              dot.className = up ? 'live' : 'dead';
              dot.title     = up ? 'Proxy active' : 'Proxy offline — backend unavailable';
            }
          });
        }

        return { ok: false, status: 0, error: msg, data: null };
      }
      await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
    }
  }
}

// ── Polygon RPC (USDC.e balance) ───────────────────────────────────────────
export async function rpcCall(method, params) {
  const url = S.proxyActive ? `${PROXY_BASE}/polygon` : 'https://polygon-rpc.com';
  return apiFetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    timeout: 6000,
  });
}

// ── Market API calls ───────────────────────────────────────────────────────
export async function fetchMarkets(limit = 100) {
  const url = `${base('gamma')}/markets?active=true&closed=false&limit=${limit}&order=volume24hr&ascending=false`;
  return apiFetch(url, { retries: 2 });
}

export async function fetchMarketById(id) {
  return apiFetch(`${base('gamma')}/markets/${id}`);
}

export async function fetchMarketHistory(tokenId, startTs, interval) {
  const url = `${base('clob')}/prices-history?market=${tokenId}&startTs=${startTs}&interval=${interval}&fidelity=60`;
  return apiFetch(url, { timeout: 10000 });
}

export async function fetchPositions(address) {
  const url = `${base('data')}/positions?user=${address}&sizeThreshold=0.01&limit=50`;
  return apiFetch(url, { retries: 1 });
}

export async function fetchEvents(slug) {
  return apiFetch(`${base('gamma')}/events?slug=${encodeURIComponent(slug)}`);
}

// ── CLOB Auth API calls ────────────────────────────────────────────────────

// Fetch CLOB server time (Unix seconds as string).
// MUST be used for the EIP-712 timestamp — Polymarket validates it server-side.
// If the signed timestamp drifts too far from server time the signature is rejected.
// Falls back to local time only if the request fails (e.g. proxy down).
export async function fetchServerTime() {
  const result = await apiFetch(`${base('clob')}/time`, { timeout: 5000 });
  if (result.ok) {
    if (typeof result.data === 'number' || typeof result.data === 'string') {
      return String(result.data);
    }
    if (result.data?.time) {
      return String(result.data.time);
    }
  }
  // Fallback — warn loudly because clock skew will cause 401s
  console.warn('[NOVA] ⚠ Could not fetch server time — using local clock. Auth may fail if clock is skewed.');
  return String(Math.floor(Date.now() / 1000));
}

// Derive or create L2 credentials using L1 (EIP-712) headers.
//
// Polymarket has two distinct endpoints:
//   GET  /auth/derive-api-key  — retrieves EXISTING credentials for this wallet
//   POST /auth/api-key         — creates NEW credentials (fails if already exist)
//
// Strategy: try derive first (covers the 99% case for returning users),
// fall back to create if derive returns 404 (new wallet, no credentials yet).
export async function createOrDeriveL1Creds(l1Headers) {
  // 1. Try derive first — works for any wallet that has ever connected
  const deriveResult = await apiFetch(`${base('clob')}/auth/derive-api-key`, {
    method:  'GET',
    headers: l1Headers,
    timeout: 10000,
  });

  if (deriveResult.ok) return deriveResult;

  // 2. If 404, credentials don't exist yet — create them
  if (deriveResult.status === 404 || deriveResult.status === 400) {
    console.log('[NOVA] No existing credentials found (status', deriveResult.status, ') — creating new ones');
    return apiFetch(`${base('clob')}/auth/api-key`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...l1Headers },
      body:    JSON.stringify({}),
      timeout: 10000,
    });
  }

  // 3. Any other error (401, 5xx etc) — return as-is so caller can handle it
  console.error('[NOVA] Derive credentials failed:', deriveResult.status, deriveResult.error);
  return deriveResult;
}

// ── CLOB Order API ─────────────────────────────────────────────────────────
export async function postOrder(orderPayload, l2Headers) {
  return apiFetch(`${base('clob')}/order`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...l2Headers },
    body:    JSON.stringify(orderPayload),
    timeout: 15000,
  });
}

export async function cancelOrder(orderId, l2Headers) {
  return apiFetch(`${base('clob')}/order/${orderId}`, {
    method:  'DELETE',
    headers: l2Headers,
    timeout: 10000,
  });
}

export async function fetchOpenOrders(l2Headers) {
  return apiFetch(`${base('clob')}/orders`, {
    headers: l2Headers,
    timeout: 8000,
  });
}
