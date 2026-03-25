/**
 * NOVA — Auth Module
 * L1: EIP-712 ClobAuthDomain signing → Polymarket L2 API credentials
 * L2: HMAC-SHA256 request signing
 *
 * ══════════════════════════════════════════════════════════════
 *  CRITICAL RULES — READ BEFORE TOUCHING THIS FILE
 *  These rules were learned the hard way across 10 debug sessions.
 *  Violating any one of them causes silent auth failures.
 * ══════════════════════════════════════════════════════════════
 *
 *  Rule 1 — nonce MUST be integer 0, never string '0'
 *    Phantom validates JSON value types against declared Solidity types.
 *    uint256 as a JSON string → "Missing or invalid parameters" before
 *    the signing prompt ever appears. Use Number(0) explicitly.
 *
 *  Rule 2 — EIP712Domain must NOT appear in types object
 *    Wallets compute domain separator internally. Including EIP712Domain
 *    in types causes Phantom to build type hash as "ClobAuth(...)EIP712Domain(...)"
 *    → different hash → ecrecover returns wrong address → Polymarket 401.
 *    Official Polymarket SDK excludes it. So do we.
 *
 *  Rule 3 — Address must be EIP-55 checksummed
 *    Phantom returns all-lowercase addresses from eth_requestAccounts.
 *    Polymarket's server does ecrecover → gets checksummed address → compares.
 *    Lowercase POLY_ADDRESS → mismatch → 401. Use ethers.utils.getAddress().
 *
 *  Rule 4 — POLY_* headers must be uppercased at the proxy
 *    Node.js lowercases all incoming HTTP header names.
 *    POLY_ADDRESS arrives as poly_address. Fixed in proxy.js.
 *    Auth module sends uppercase — proxy preserves them.
 *
 *  Rule 6 — params[0] to eth_signTypedData_v4 must be checksummed
 *    Phantom validates params[0] against its internally stored account record.
 *    Sending the raw lowercase address returned by eth_requestAccounts →
 *    "Invalid or missing parameters" before the signing prompt appears.
 *    Always pass toChecksumAddress(signerAddress) as params[0].
 *
 *  Rule 7 — timestamp must be an integer string, never a float string
 *    The CLOB /time endpoint may return a float (e.g. 1709876543.789).
 *    String("1709876543.789") passes EIP712 type validation (type: "string")
 *    but some Phantom versions reject it during payload pre-validation.
 *    Always Math.floor(parseFloat(serverTime)) before stringifying.
 */

import { EIP712_DOMAIN, EIP712_TYPES, AUTH_MESSAGE_TEXT, AUTH_NONCE } from './constants.js';
import { PM } from './state.js';
import { fetchServerTime, createOrDeriveL1Creds } from './api.js';

// R-AUTH-01: clock offset between local machine and Polymarket server.
// Computed at L1 auth time and refreshed periodically (every 30 min) so
// long-running sessions don't accumulate drift. Applied to every L2 HMAC
// timestamp to avoid per-order network calls while keeping timestamps accurate.
let _serverClockOffsetSeconds = 0;
let _clockOffsetComputedAt    = 0;           // Unix seconds when offset was last set
const CLOCK_OFFSET_MAX_AGE_S  = 30 * 60;    // 30 minutes

// ── EIP-55 Checksum ────────────────────────────────────────────────────────
// Uses ethers.js (loaded in index.html). Falls back gracefully if unavailable.
export function toChecksumAddress(addr) {
  if (!addr) return '';
  try {
    if (window.ethers?.utils?.getAddress) {
      return window.ethers.utils.getAddress(addr.toLowerCase());
    }
  } catch (e) {
    console.warn('[NOVA] ethers.utils.getAddress failed:', e.message);
  }
  // Fallback — may cause 401 if address is lowercase. Log a warning.
  console.warn('[NOVA] ⚠ ethers.js not available — address may not be checksummed');
  return addr;
}

// ── Auth Schema Canary ─────────────────────────────────────────────────────
// Runs before every sign attempt. Fires visible console.assert errors if
// any rule is violated — making the root cause immediately obvious instead
// of a cryptic wallet rejection.
function validateAuthPayload(payload) {
  const m = payload.message;
  const d = payload.domain;

  console.assert(typeof m.nonce === 'number',
    '[NOVA] ❌ CANARY: nonce must be number, got', typeof m.nonce, '— value:', m.nonce);

  console.assert(m.nonce === 0,
    '[NOVA] ❌ CANARY: nonce must be 0, got', m.nonce);

  console.assert(typeof m.address === 'string' && m.address.startsWith('0x'),
    '[NOVA] ❌ CANARY: address invalid:', m.address);

  console.assert(!payload.types.EIP712Domain,
    '[NOVA] ❌ CANARY: EIP712Domain must NOT be in types — causes hash mismatch');

  console.assert(typeof d.chainId === 'number',
    '[NOVA] ❌ CANARY: chainId must be number, got', typeof d.chainId);

  // Checksum test — does address contain mixed case? (checksummed addresses do)
  const hasMixedCase = m.address !== m.address.toLowerCase() && m.address !== m.address.toUpperCase();
  if (!hasMixedCase && m.address !== '0x0000000000000000000000000000000000000000') {
    console.warn('[NOVA] ⚠ CANARY: address appears lowercase — may not be checksummed:', m.address);
  }

  console.log('[NOVA] ✓ Auth payload valid',
    '| nonce:', m.nonce, '(' + typeof m.nonce + ')',
    '| addr:', m.address.slice(0, 10) + '…',
    '| chainId:', d.chainId, '(' + typeof d.chainId + ')');
}

// ── L1 Auth — EIP-712 Sign ─────────────────────────────────────────────────
// Signs a ClobAuthDomain message and exchanges it for L2 API credentials.
// Returns { ok: boolean, apiKey, apiSecret, apiPassphrase, error? }
export async function deriveL2Credentials(provider, signerAddress) {
  const checksumAddr = toChecksumAddress(signerAddress);

  // Use CLOB server time, not local clock.
  // Polymarket validates the timestamp in the signed message against their server.
  // A local clock skewed even 60s will produce a valid-looking signature that
  // the server rejects with a 401. fetchServerTime() falls back to local time
  // only if the /time endpoint is unreachable (proxy down etc).
  // Floor to integer — the CLOB /time endpoint may return a float (e.g. 1709876543.789).
  // String("1709876543.789") confuses some Phantom versions during eth_signTypedData_v4
  // parameter validation. Always use a whole-second integer string.
  const rawServerTime   = await fetchServerTime();
  const timestamp       = String(Math.floor(parseFloat(rawServerTime)));

  // R-AUTH-01: store offset so buildL2Headers can use accurate timestamps on every order
  // without making a network call each time. Record when it was computed so
  // buildL2Headers can refresh it if the session has been open > 30 minutes.
  const localNow = Math.floor(Date.now() / 1000);
  _serverClockOffsetSeconds = parseInt(timestamp, 10) - localNow;
  _clockOffsetComputedAt    = localNow;
  if (Math.abs(_serverClockOffsetSeconds) > 5) {
    console.warn(`[NOVA] ⚠ Clock skew detected: local is ${_serverClockOffsetSeconds}s off server time. Offset applied to all L2 headers.`);
  }

  const authPayload = {
    domain:      EIP712_DOMAIN,
    types:       EIP712_TYPES,
    primaryType: 'ClobAuth',
    message: {
      address:   checksumAddr,
      timestamp: timestamp,
      nonce:     Number(AUTH_NONCE), // explicit Number() cast — see Rule 1
      message:   AUTH_MESSAGE_TEXT,
    },
  };

  validateAuthPayload(authPayload);

  // Diagnostic: log the exact JSON Phantom receives — paste this into DevTools to inspect
  console.log('[NOVA] eth_signTypedData_v4 payload →', JSON.stringify(authPayload, null, 2));
  console.log('[NOVA] params[0] (signer) →', checksumAddr);

  let signature;
  try {
    // params[0] MUST be checksumAddr, not the raw lowercase signerAddress.
    // Phantom validates params[0] against its internally stored account record.
    // A case mismatch → "Invalid or missing parameters" before the prompt appears.
    signature = await provider.request({
      method: 'eth_signTypedData_v4',
      params: [checksumAddr, JSON.stringify(authPayload)],
    });
  } catch (err) {
    const msg = err.message || String(err);

    // Phantom (especially older EVM builds) sometimes rejects eth_signTypedData_v4
    // with "Missing or invalid parameters" even when the payload is correct.
    // This is a Phantom bug — it misreads the typed-data structure on certain versions.
    // Fallback: try eth_signTypedData (v3 style, same payload) which Phantom handles more reliably.
    const isParamErr = /missing|invalid.*param|parameter/i.test(msg);
    if (isParamErr) {
      console.warn('[NOVA] eth_signTypedData_v4 rejected with param error — retrying with eth_signTypedData');
      try {
        signature = await provider.request({
          method: 'eth_signTypedData',
          params: [checksumAddr, JSON.stringify(authPayload)],
        });
        console.log('[NOVA] ✓ eth_signTypedData fallback succeeded');
      } catch (err2) {
        console.error('[NOVA] Fallback eth_signTypedData also failed:', err2.message);
        // Surface the original error (more informative) with a helpful hint
        return {
          ok: false,
          error: `Wallet signing failed: "${msg}". ` +
            `If you're using Phantom, try: (1) open Phantom → Settings → Experimental → enable "Typed Data Signing", ` +
            `(2) switch to MetaMask, or (3) check DevTools console for [NOVA] canary errors.`,
        };
      }
    } else {
      console.error('[NOVA] Wallet signing failed:', msg);
      return { ok: false, error: msg };
    }
  }

  const l1Headers = {
    'POLY_ADDRESS':   checksumAddr,
    'POLY_SIGNATURE': signature,
    'POLY_TIMESTAMP': timestamp,
    'POLY_NONCE':     '0', // Header value is string — only the JSON message.nonce must be int
  };

  // Derive-first strategy:
  //   GET  /auth/derive-api-key  — retrieves existing credentials (returning users)
  //   POST /auth/api-key         — creates new credentials (first-time users, 404 fallback)
  // Calling POST on an account that already has credentials returns an error,
  // so we always try derive first and only create if no credentials exist yet.
  const result = await createOrDeriveL1Creds(l1Headers);

  if (!result.ok) {
    console.error('[NOVA] L1 auth exchange failed:', result.status, result.error);
    return { ok: false, error: `Auth server error ${result.status}: ${result.error}` };
  }

  const { apiKey, secret, passphrase, address: proxyAddress } = result.data;

  if (!apiKey || !secret || !passphrase) {
    console.error('[NOVA] L1 auth response missing fields:', result.data);
    return { ok: false, error: 'Auth response missing credentials' };
  }

  // The L1 auth response includes `address` — this is the Polymarket proxy wallet
  // that holds the user's USDC. It MUST be used as the maker/POLY_ADDRESS for orders.
  // signatureType 2 (POLY_PROXY) is required when a proxy wallet exists.
  // We return it here so wallet.js can store it on PM after L1 auth completes.
  if (proxyAddress) {
    console.log('[NOVA] ✓ Proxy wallet resolved from auth response:', proxyAddress.slice(0, 10) + '…');
  } else {
    console.warn('[NOVA] ⚠ No proxy wallet in auth response — EOA mode (signatureType 0). Orders will use signer address as maker.');
  }

  console.log('[NOVA] ✓ L2 credentials derived — key:', apiKey.slice(0, 8) + '…');
  return { ok: true, apiKey, apiSecret: secret, apiPassphrase: passphrase, proxyAddress: proxyAddress || null };
}

// ── L2 Auth — HMAC-SHA256 Request Signing ─────────────────────────────────
// Signs each CLOB API request with the L2 credentials.
// Returns headers object to merge into the request.
export async function buildL2Headers(method, path, body = '') {
  if (!PM.hasL2) {
    throw new Error('L2 credentials not available — run L1 auth first');
  }

  // R-AUTH-01: refresh the server clock offset if it is stale (> 30 min old).
  // The offset is computed at auth time and normally accurate for the whole session,
  // but a user who leaves the tab open for hours could accumulate enough drift to
  // push order timestamps outside Polymarket's ±60s tolerance window.
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - _clockOffsetComputedAt > CLOCK_OFFSET_MAX_AGE_S) {
    try {
      const { fetchServerTime } = await import('./api.js');
      const fresh = await fetchServerTime();
      const freshInt = parseInt(fresh, 10);
      const newOffset = freshInt - Math.floor(Date.now() / 1000);
      if (Math.abs(newOffset - _serverClockOffsetSeconds) > 2) {
        console.log(`[NOVA] Clock offset refreshed: ${_serverClockOffsetSeconds}s → ${newOffset}s`);
      }
      _serverClockOffsetSeconds = newOffset;
      _clockOffsetComputedAt    = Math.floor(Date.now() / 1000);
    } catch {
      // Non-fatal — use existing offset and warn
      console.warn('[NOVA] ⚠ Could not refresh clock offset — using cached value from', Math.round((nowSeconds - _clockOffsetComputedAt) / 60), 'min ago');
    }
  }

  // R-AUTH-01: apply stored server clock offset so order timestamps stay in sync
  // even if the user's local machine clock drifts. Offset is computed once at auth time.
  const localSeconds = Math.floor(Date.now() / 1000);
  const timestamp    = String(localSeconds + _serverClockOffsetSeconds);
  const what      = timestamp + method.toUpperCase() + path + body;
  const hmac      = await hmacSha256Base64(PM.apiSecret, what);

  return {
    'POLY_ADDRESS':    toChecksumAddress(PM.makerAddress),
    'POLY_SIGNATURE':  hmac,
    'POLY_TIMESTAMP':  timestamp,
    'POLY_NONCE':      '0',
    'POLY_API_KEY':    PM.apiKey,
    'POLY_PASSPHRASE': PM.apiPassphrase,
  };
}

// ── HMAC-SHA256 via WebCrypto (browser-native, no library) ────────────────
async function hmacSha256Base64(b64Secret, message) {
  const enc = new TextEncoder();
  // Polymarket API secrets are JWT-style URL-safe base64 (uses - and _ instead
  // of + and /). atob() only handles standard base64 — it silently decodes
  // - as ASCII 0x2D and _ as ASCII 0x5F rather than base64 positions 62 and 63,
  // producing a wrong HMAC key and a 401 on every signed request.
  // Normalize URL-safe → standard base64 before decoding.
  const std = b64Secret.replace(/-/g, '+').replace(/_/g, '/');
  const raw = Uint8Array.from(atob(std), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// ── Store L2 creds on PM ───────────────────────────────────────────────────
export function storeL2Credentials({ apiKey, apiSecret, apiPassphrase }) {
  PM.apiKey        = apiKey;
  PM.apiSecret     = apiSecret;
  PM.apiPassphrase = apiPassphrase;
  // Session-only — never persisted to localStorage (security).
  // Also store proxyAddress so it survives page reloads.
  // Without it, PM.proxyAddress is null after reload → signatureType='0' (EOA)
  // → every CLOB order rejected with 401 for proxy-wallet users.
  sessionStorage.setItem('nova_l2', JSON.stringify({
    apiKey,
    apiSecret,
    apiPassphrase,
    proxyAddress: PM.proxyAddress || null,
  }));
}

export function restoreL2Credentials() {
  try {
    const raw = sessionStorage.getItem('nova_l2');
    if (!raw) return false;
    const { apiKey, apiSecret, apiPassphrase, proxyAddress } = JSON.parse(raw);
    if (!apiKey || !apiSecret || !apiPassphrase) return false;
    PM.apiKey        = apiKey;
    PM.apiSecret     = apiSecret;
    PM.apiPassphrase = apiPassphrase;
    // Restore proxyAddress — without this, PM.proxyAddress stays null after
    // a page reload and every order uses signatureType '0' (EOA) instead of
    // '2' (POLY_PROXY), causing all CLOB orders to return 401.
    if (proxyAddress && /^0x[0-9a-fA-F]{40}$/.test(proxyAddress)) {
      PM.proxyAddress = proxyAddress;
      console.log('[NOVA] ✓ L2 credentials + proxy wallet restored from session');
    } else {
      console.log('[NOVA] ✓ L2 credentials restored from session (EOA mode)');
    }
    return true;
  } catch {
    return false;
  }
}

export function clearL2Credentials() {
  PM.apiKey = PM.apiSecret = PM.apiPassphrase = null;
  sessionStorage.removeItem('nova_l2');
}
