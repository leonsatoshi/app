/**
 * NOVA — Wallet Module
 * Handles: Phantom connect, chain switching, balance fetch,
 * positions fetch, Polymarket proxy wallet resolution.
 */

import { CHAIN_ID, POLYGON_CHAIN_CONFIG, USDC_E_ADDRESS, USDC_DECIMALS } from './constants.js';
import { PM, S, CFG } from './state.js';
import { toChecksumAddress, deriveL2Credentials, storeL2Credentials, restoreL2Credentials, clearL2Credentials } from './auth.js';
import { rpcCall, fetchPositions as apiFetchPositions } from './api.js';
import { shortAddr } from './utils.js';

// ── Provider Detection ─────────────────────────────────────────────────────
// Returns a map of available EVM providers keyed by wallet name.
// Used by the wallet picker UI to show only installed wallets.
export function detectAvailableWallets() {
  const wallets = [];

  // Phantom EVM — only present if Phantom extension is installed
  const phantomEvm = window.phantom?.ethereum;
  if (phantomEvm) {
    wallets.push({
      id:       'phantom',
      name:     'Phantom',
      icon:     '👻',
      desc:     'Phantom Wallet (EVM)',
      provider: phantomEvm,
    });
  }

  // MetaMask — window.ethereum with isMetaMask flag
  // Guard: don't double-list if Phantom is also injecting into window.ethereum
  const mmProvider = window.ethereum;
  if (mmProvider?.isMetaMask && mmProvider !== phantomEvm) {
    wallets.push({
      id:       'metamask',
      name:     'MetaMask',
      icon:     '🦊',
      desc:     'MetaMask Wallet',
      provider: mmProvider,
    });
  }

  // Generic EVM fallback — window.ethereum present but not identified above
  if (mmProvider && !mmProvider.isMetaMask && mmProvider !== phantomEvm) {
    wallets.push({
      id:       'injected',
      name:     'Browser Wallet',
      icon:     '🌐',
      desc:     'Injected EVM wallet',
      provider: mmProvider,
    });
  }

  return wallets;
}

// Internal — used by connectWallet when called with an explicit provider
function getProvider() {
  if (window.phantom?.solana) {
    return window.phantom?.ethereum ?? window.ethereum;
  }
  return window.ethereum;
}

// ── Connect Wallet ─────────────────────────────────────────────────────────
export async function connectWallet(explicitProvider = null) {
  const provider = explicitProvider || getProvider();

  if (!provider) {
    throw new Error('No EVM wallet detected. Install Phantom or MetaMask.');
  }

  // Request accounts
  let accounts;
  try {
    accounts = await provider.request({ method: 'eth_requestAccounts' });
  } catch (err) {
    if (err.code === 4001) throw new Error('Wallet connection rejected by user.');
    throw new Error('Failed to connect wallet: ' + err.message);
  }

  if (!accounts?.length) {
    throw new Error('No accounts returned from wallet.');
  }

  const rawAddress = accounts[0];

  // Ensure we're on Polygon
  await ensurePolygon(provider);

  // Store on PM
  PM.connected = true;
  PM.address   = rawAddress;
  PM.provider  = provider;

  // Proxy wallet resolution happens after L1 auth (authorize()), not here.
  // resolveProxyWallet() requires L1 auth headers that don't exist yet at connect time.
  // The /auth/derive-api-key response already returns the proxy wallet address —
  // it's extracted in authorize() and stored on PM.proxyAddress then.
  PM.proxyAddress = null; // Will be set by authorize() once L1 auth completes.

  console.log('[NOVA] Wallet connected:',
    rawAddress.slice(0, 10) + '…',
    PM.proxyAddress ? '| proxy: ' + PM.proxyAddress.slice(0, 10) + '…' : '| EOA mode');

  // Try to restore L2 creds from session (so user doesn't re-sign every page load)
  restoreL2Credentials();

  // Fetch balance + positions in parallel
  const [balance, positions] = await Promise.all([
    fetchBalance(PM.makerAddress),
    fetchPositions(PM.makerAddress),
  ]);

  // Mirror into S.wallet for UI
  S.wallet = {
    address:     rawAddress,
    proxyAddress: PM.proxyAddress,
    balance,
    positions,
    pnl: computePnL(positions),
  };

  // Listen for account/chain changes
  provider.on?.('accountsChanged', onAccountsChanged);
  provider.on?.('chainChanged',    onChainChanged);

  return S.wallet;
}

// ── Disconnect ─────────────────────────────────────────────────────────────
export function disconnectWallet() {
  const provider = PM.provider;
  provider?.removeListener?.('accountsChanged', onAccountsChanged);
  provider?.removeListener?.('chainChanged',    onChainChanged);
  PM.reset();
  clearL2Credentials();
  S.wallet = null;
  console.log('[NOVA] Wallet disconnected');
}

// ── Authorize (L1 → L2) ────────────────────────────────────────────────────
export async function authorize() {
  if (!PM.connected) throw new Error('Wallet not connected');

  const result = await deriveL2Credentials(PM.provider, PM.address);

  if (!result.ok) throw new Error(result.error);

  // The L1 auth response returns the Polymarket proxy wallet address.
  // Set PM.proxyAddress BEFORE calling storeL2Credentials so it gets
  // captured in the sessionStorage snapshot (C-2 fix).
  if (result.proxyAddress && /^0x[0-9a-fA-F]{40}$/.test(result.proxyAddress)) {
    PM.proxyAddress = toChecksumAddress(result.proxyAddress);
    console.log('[NOVA] ✓ PM.proxyAddress set from L1 auth:', PM.proxyAddress.slice(0, 10) + '…');
  } else {
    PM.proxyAddress = null;
    console.log('[NOVA] ℹ No proxy wallet — EOA mode (signatureType 0)');
  }

  // Store creds NOW — after PM.proxyAddress is resolved.
  // storeL2Credentials reads PM.proxyAddress internally so the session
  // snapshot includes the proxy wallet, surviving page reloads.
  storeL2Credentials(result);

  // Re-fetch balance from the proxy wallet now that we know its address.
  if (PM.proxyAddress) {
    const [freshBalance, freshPositions] = await Promise.all([
      fetchBalance(PM.proxyAddress),
      fetchPositions(PM.proxyAddress),
    ]);
    if (S.wallet) {
      S.wallet.balance      = freshBalance;
      S.wallet.positions    = freshPositions;
      S.wallet.pnl          = computePnL(freshPositions);
      S.wallet.proxyAddress = PM.proxyAddress;
    }
    window.dispatchEvent(new CustomEvent('nova:balanceUpdated'));
    console.log('[NOVA] ✓ Balance refreshed from proxy wallet:', freshBalance != null ? '$' + freshBalance.toFixed(2) : 'unavailable');
  }

  console.log('[NOVA] ✓ Authorized — L2 credentials stored');
  return result;
}

// ── USDC.e Balance ─────────────────────────────────────────────────────────
// Queries the USDC.e (PoS bridged) contract on Polygon.
// MUST query makerAddress (proxy wallet) — not the EOA signer address.
// The proxy wallet is where Polymarket holds user funds.
export async function fetchBalance(address) {
  if (!address) return null;

  // eth_call: balanceOf(address) on USDC.e contract
  const data = '0x70a08231' +
    address.slice(2).toLowerCase().padStart(64, '0');

  const result = await rpcCall('eth_call', [{ to: USDC_E_ADDRESS, data }, 'latest']);

  if (!result.ok || !result.data?.result) return null;

  const raw = parseInt(result.data.result, 16);
  if (isNaN(raw)) return null;

  return raw / Math.pow(10, USDC_DECIMALS);
}

// ── Positions ──────────────────────────────────────────────────────────────
export async function fetchPositions(address) {
  if (!address) return [];
  const result = await apiFetchPositions(address);
  if (!result.ok || !result.data) return [];

  const raw = Array.isArray(result.data) ? result.data
    : (result.data.positions || result.data.data || []);

  return raw.map(p => ({
    question:     p.title || p.market || p.question || 'Unknown',
    side:         p.side || 'YES',
    shares:       parseFloat(p.size || p.shares || 0),
    avgPrice:     parseFloat(p.avgPrice || p.avg_price || 0.5),
    currentPrice: parseFloat(p.currentPrice || p.current_price || 0.5),
    pnl:          parseFloat(p.pnl || p.cashPnl || 0),
  })).filter(p => p.shares > 0.001);
}


// ── P&L Computation ────────────────────────────────────────────────────────
function computePnL(positions) {
  return positions.reduce((sum, p) => sum + p.pnl, 0);
}

// ── Chain Enforcement ──────────────────────────────────────────────────────
async function ensurePolygon(provider) {
  const chainIdHex = await provider.request({ method: 'eth_chainId' }).catch(() => null);
  const currentId  = chainIdHex ? parseInt(chainIdHex, 16) : 0;

  if (currentId === CHAIN_ID) return; // Already on Polygon

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: POLYGON_CHAIN_CONFIG.chainId }],
    });
  } catch (err) {
    if (err.code === 4902) {
      // Chain not added — add it
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [POLYGON_CHAIN_CONFIG],
      });
    } else {
      throw new Error('Please switch your wallet to Polygon (Chain ID 137).');
    }
  }
}

// ── Account / Chain Change Handlers ───────────────────────────────────────
function onAccountsChanged(accounts) {
  if (!accounts.length) {
    disconnectWallet();
    window.dispatchEvent(new CustomEvent('nova:walletDisconnected'));
  } else {
    // R-AUTH-02: clear the previous account's L2 credentials FIRST.
    // restoreL2Credentials() inside connectWallet() would otherwise load
    // the old account's keys into PM — wrong credentials for the new address.
    clearL2Credentials();
    connectWallet().then(() => {
      window.dispatchEvent(new CustomEvent('nova:walletConnected', { detail: S.wallet }));
    }).catch(console.error);
  }
}

function onChainChanged() {
  // Easiest safe recovery: reload
  window.location.reload();
}

// ── Auto-detect existing connection ───────────────────────────────────────
// Checks if wallet is already connected (e.g. user has Phantom authorized)
export async function autoDetectWallet() {
  const provider = getProvider();
  if (!provider) return false;

  try {
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (accounts?.length) {
      await connectWallet();
      window.dispatchEvent(new CustomEvent('nova:walletConnected', { detail: S.wallet }));
      return true;
    }
  } catch {
    // Not connected
  }
  return false;
}
