/**
 * NOVA — Constants
 * Single source of truth for all magic numbers, addresses, and config.
 * NEVER hardcode these elsewhere.
 */

// ── Polymarket API Endpoints ───────────────────────────────────────────────
export const ENDPOINTS = {
  gamma:  'https://gamma-api.polymarket.com',
  clob:   'https://clob.polymarket.com',
  data:   'https://data-api.polymarket.com',
};

// ── Local Proxy ────────────────────────────────────────────────────────────
export const PROXY_PORT  = 3500;
const BACKEND_BASE = window.NOVA_BACKEND_URL;
if (!BACKEND_BASE || BACKEND_BASE.startsWith('%REACT_APP_')) {
  throw new Error('NOVA backend URL is missing. Set REACT_APP_BACKEND_URL in frontend/.env.');
}
export const PROXY_BASE  = `${BACKEND_BASE}/api`;

// ── Polygon / Blockchain ───────────────────────────────────────────────────
export const CHAIN_ID = 137; // Polygon mainnet

// USDC.e (PoS bridged) — the ONLY USDC that Polymarket accepts.
// Do NOT use native USDC (0xA0b86a33E6417aEb...) — it will not work.
export const USDC_E_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
export const USDC_DECIMALS  = 6;

// ── EIP-712 Auth ───────────────────────────────────────────────────────────
// Critical rules — DO NOT change these without reading auth.js comments:
//   1. nonce MUST be integer 0 — NOT string '0'
//   2. EIP712Domain must NOT appear in the types object
//   3. chainId must be number 137 — NOT string
export const EIP712_DOMAIN = {
  name:    'ClobAuthDomain',
  version: '1',
  chainId: CHAIN_ID, // number, not string
};

export const EIP712_TYPES = {
  // NO EIP712Domain key here — wallets handle domain separator implicitly.
  // Adding it causes a type hash mismatch → Polymarket 401.
  ClobAuth: [
    { name: 'address',   type: 'address' },
    { name: 'timestamp', type: 'string'  },
    { name: 'nonce',     type: 'uint256' },
    { name: 'message',   type: 'string'  },
  ],
};

export const AUTH_MESSAGE_TEXT = 'This message attests that I control the given wallet';
export const AUTH_NONCE        = 0; // integer — see rules above

// ── Polygon RPC ────────────────────────────────────────────────────────────
export const POLYGON_RPC = 'https://polygon-bor-rpc.publicnode.com';

// ── Polygon Chain Config (for wallet_switchEthereumChain) ─────────────────
export const POLYGON_CHAIN_CONFIG = {
  chainId:         '0x89', // 137 in hex
  chainName:       'Polygon Mainnet',
  nativeCurrency:  { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
  rpcUrls:         [POLYGON_RPC],
  blockExplorerUrls: ['https://polygonscan.com'],
};

// ── Storage Keys ───────────────────────────────────────────────────────────
export const STORAGE = {
  settings:   'nova_settings_v1',
  watchlist:  'nova_watchlist_v1',
  alerts:     'nova_alerts_v1',
  pnl:        'nova_pnl_v1',
};

// ── Agent Definitions ─────────────────────────────────────────────────────
export const AGENTS = {
  oracle: {
    id:      'oracle',
    name:    'Oracle',
    icon:    '🔮',
    color:   'var(--blue)',
    role:    'Market Research & Sentiment',
    prompt:  'You are Oracle, a prediction market research specialist. Analyze market sentiment, news, and fundamentals.',
  },
  vega: {
    id:      'vega',
    name:    'Vega',
    icon:    '📊',
    color:   'var(--purple)',
    role:    'Quantitative Analysis',
    prompt:  'You are Vega, a quantitative analyst. Focus on probability calibration, Kelly sizing, and statistical edges.',
  },
  pulse: {
    id:      'pulse',
    name:    'Pulse',
    icon:    '⚡',
    color:   'var(--green)',
    role:    'Arbitrage Detection',
    prompt:  'You are Pulse, an arbitrage specialist. Identify mispricings, correlated markets, and spread opportunities.',
  },
  shield: {
    id:      'shield',
    name:    'Shield',
    icon:    '🛡️',
    color:   'var(--amber)',
    role:    'Risk Management',
    prompt:  'You are Shield, a risk manager. Evaluate position sizing, exposure limits, and downside scenarios.',
  },
  echo: {
    id:      'echo',
    name:    'Echo',
    icon:    '📡',
    color:   'var(--red)',
    role:    'Market Monitoring',
    prompt:  'You are Echo, a market monitor. Track price movements, volume spikes, and liquidity shifts.',
  },
};

// ── UI Constants ───────────────────────────────────────────────────────────
export const TOAST_DURATION    = 3500;  // ms
export const REFRESH_INTERVAL  = 60000; // ms — auto-refresh markets
export const CHART_PADDING     = { top: 10, right: 12, bottom: 24, left: 40 };

// ── Version ────────────────────────────────────────────────────────────────
export const VERSION = '1.1.23';
export const BUILD   = '2026-03-22';
