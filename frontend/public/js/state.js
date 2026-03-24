/**
 * NOVA — State
 * Single source of truth. All modules read from / write to these objects.
 * Never create local state that duplicates what lives here.
 */

// ── App State ──────────────────────────────────────────────────────────────
export const S = {
  // Markets
  markets:    [],
  filtered:   [],
  selected:   null,
  filter:     'all',
  sort:       'volume',
  searchQuery: '',
  chartRange: '1W',

  // Watchlist
  watchlist:  [],

  // Alerts
  alerts:     [],

  // Whale tracker
  whales:     [],
  selectedWhale: null,

  // Arb
  arbResults: [],
  statArb:    [],
  vrpSignals: [],
  selectedArb: null,

  // P&L
  pnlTrades:  [],

  // Order activity
  orderActivity: [],

  // Wallet (display-side mirror of PM)
  wallet: null,

  // UI
  activeView:    'markets',
  activeSideTab: 'wallet',
  activeCalcTab: 'ev',
  activityFilter: 'all',
  lastOrderSyncAt: null,
  proxyActive:   false,
};

// ── Wallet / Polymarket State ──────────────────────────────────────────────
// PM is the authoritative source for all wallet + auth state.
// Use PM.makerAddress for any CLOB operation — it correctly resolves
// proxy wallet vs EOA depending on wallet type.
export const PM = {
  connected:    false,
  address:      null,   // EOA signer address (from Phantom)
  proxyAddress: null,   // Polymarket proxy wallet (holds USDC)
  provider:     null,
  chainId:      137,

  // L2 API credentials — derived via L1 EIP-712 auth
  apiKey:       null,
  apiSecret:    null,   // base64-encoded, for HMAC-SHA256
  apiPassphrase:null,

  // ── Computed getters ──────────────────────────────────────────────────
  get hasL2() {
    return !!(this.apiKey && this.apiSecret && this.apiPassphrase);
  },

  // ALWAYS use this for CLOB orders, balance queries, and POLY_ADDRESS header.
  // Proxy wallet holds the USDC — querying the EOA address gives zero balance.
  get makerAddress() {
    return this.proxyAddress || this.address;
  },

  get shortAddress() {
    const addr = this.makerAddress;
    if (!addr) return null;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  },

  // Reset all state on disconnect
  reset() {
    this.connected     = false;
    this.address       = null;
    this.proxyAddress  = null;
    this.provider      = null;
    this.apiKey        = null;
    this.apiSecret     = null;
    this.apiPassphrase = null;
  },
};

// ── Settings ───────────────────────────────────────────────────────────────
export const CFG = {
  anthropicKey:    '',
  useProxy:        true,
  tradingEnabled:  false,
  maxPositionUSD:  100,
  defaultOrderAmt: 10,
  simMode:         false,
  notifications:   false,
  theme:           'dark',
};

// ── Sim Mode State ─────────────────────────────────────────────────────────
export const SIM = {
  enabled:  false,
  balance:  5000,
  address:  '0xSIM000000000000000000000000000000000001',
  orders:   [],
  log:      [],
};
