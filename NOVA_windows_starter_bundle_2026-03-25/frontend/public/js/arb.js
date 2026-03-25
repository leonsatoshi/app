/**
 * NOVA — Arbitrage Module
 *
 * Three scan types:
 *   1. Price Spread Arb  — YES + NO ask prices sum < 100% on same market
 *   2. Stat Arb          — correlated markets in same category diverging (z-score)
 *   3. Vol Risk Premium  — implied vol > realized vol (theta play)
 *
 * DATA HONESTY NOTES — read before modifying:
 *
 *   Spread Arb uses a two-pass approach:
 *     Pass 1 (FREE): Gamma API midpoint prices. outcomePrices[yesIdx] and
 *       outcomePrices[noIdx] are independently sourced from Polymarket's
 *       market maker — they do NOT sum to exactly 1.0. Any sum < 1.0 is a
 *       genuine midpoint-level signal, not fabricated. No noise is added.
 *     Pass 2 (VERIFIED): For the top N midpoint candidates, fetch the live
 *       CLOB order book (GET /clob/book?token_id=X) to get real best-ask
 *       prices. Only CLOB-verified results are flagged as tradeable.
 *       Midpoint-only results are shown as "Unverified — orderbook pending".
 *
 *   Stat Arb uses relative price divergence within a category.
 *     The z-score is a heuristic, not a proper historical z-score.
 *     Signals should be treated as leads for manual review, not
 *     automatic execution triggers.
 *
 *   VRP requires change24h from the Gamma API, which is rarely populated.
 *     If change24h is missing, IV = 0 and no VRP signals fire. This is
 *     correct — do not fabricate change24h.
 *
 * Deploy flow:
 *   - Both legs fire simultaneously via Promise.allSettled (no sequential exposure)
 *   - Pre-generated nonces prevent replay rejection on simultaneous orders
 *   - Partial fill handling: targeted retry of failed leg only
 *   - Full sim intercept when SIM.enabled
 */

import { S, PM, CFG, SIM } from './state.js';
import { getSafeNonce, fmtUSD, esc, trunc, delay } from './utils.js';
import { submitOrder } from './orders.js';
import { runAgent } from './agents.js';
import { apiFetch, base, fetchMarketHistory } from './api.js';

// ── Config (user-tunable via settings) ───────────────────────────────────
const ARB_CFG = {
  statArbZScore:  2.0,   // minimum z-score to surface a stat-arb signal
  vrpMinGap:      3.0,   // minimum IV-RV gap (ppt) for VRP signal
  minLiquidity:   10000, // markets below this are excluded from stat-arb
  minVolume:      50000, // markets below this are excluded from stat-arb
  feeEstimate:    0.002, // ~0.2% round-trip fee estimate
  maxBookFetches:    10,  // max CLOB orderbook fetches per scan
  maxStatArbFetches: 20,  // max price history fetches for stat arb (2 per pair = 10 pairs)
  maxSpikeScaFetches: 15,  // max history fetches for spike scanner
  vrpSpikeThreshold:  1.5, // min spike ratio (|move| / dailyRV) to surface a signal
};

export function updateArbConfig(overrides) {
  Object.assign(ARB_CFG, overrides);
}

// ── Main Scan Entry Point ─────────────────────────────────────────────────
export async function runArbScan() {
  if (!S.markets.length) {
    window.showToast?.('Load markets first', 'info');
    return [];
  }

  // 1. Price spread arb — two-pass: midpoints then CLOB verification
  const spreadResults = await scanPriceSpread(S.markets);

  // 2. Stat arb — correlated pairs
  const statResults = await runStatArbScan(S.markets);

  // 3. VRP scan
  const vrpResults = await runVRPScan(S.markets);

  S.arbResults    = spreadResults;
  S.statArb       = statResults;
  S.vrpSignals    = vrpResults;

  console.log(`[NOVA Arb] Spread: ${spreadResults.length} | Stat: ${statResults.length} | VRP: ${vrpResults.length}`);
  return { spread: spreadResults, stat: statResults, vrp: vrpResults };
}

// ── 1. Price Spread Arb ───────────────────────────────────────────────────
//
// Real spread arb: buy YES + buy NO. If total cost < $1.00 per share,
// you are guaranteed $1.00 at resolution → risk-free profit.
//
// Data sources, in order of reliability:
//   CLOB orderbook best-ask (verified) > Gamma midpoint (estimated)
//
// The Gamma outcomePrices[yesIdx] and outcomePrices[noIdx] are independently
// sourced — they do NOT arithmetically sum to 1.0. Any gap is a real signal
// worth verifying against the CLOB order book.
//
// NO NOISE IS ADDED. Every number here comes directly from API data.
//
async function scanPriceSpread(markets) {
  // Pass 1: compute midpoint spreads from Gamma prices (no network calls)
  const candidates = markets
    .filter(m => m.clobTokenIds?.length >= 2) // must have tradeable tokens
    .map(m => {
      const sum        = m.yesPrice + m.noPrice;
      const grossProfit = (1 - sum) * 100;  // cents profit per dollar deployed
      const netProfit   = Math.max(0, (1 - sum - ARB_CFG.feeEstimate) * 100);

      return {
        type:         'SPREAD_ARB',
        id:           m.id,
        question:     m.question,
        category:     m.category,
        yesPrice:     m.yesPrice,
        noPrice:      m.noPrice,
        sum,
        grossProfit,
        netProfit,
        volume:       m.volume,
        liquidity:    m.liquidity,
        clobTokenIds: m.clobTokenIds,
        conditionId:  m.conditionId,
        gammaUrl:     m.gammaUrl,
        groupSlug:    m.groupSlug,
        slug:         m.slug,
        dataSource:   'midpoint',   // Gamma API midpoint — not yet verified
        verified:     false,
        score:        grossProfit * Math.log10(Math.max(m.volume, 1000)),
      };
    })
    .filter(r => r.sum < 1.0)     // only real midpoint gaps
    .sort((a, b) => b.score - a.score);

  // Pass 2: verify the top N candidates against the live CLOB order book.
  // The CLOB book gives us real best-ask prices for YES and NO tokens.
  // A verified arb requires: bestAsk(YES) + bestAsk(NO) < 1.0
  const toVerify = candidates.slice(0, ARB_CFG.maxBookFetches);

  if (toVerify.length > 0) {
    console.log(`[NOVA Arb] Verifying top ${toVerify.length} candidates against CLOB order book…`);
    await Promise.allSettled(toVerify.map(async (candidate) => {
      const [yesTokenId, noTokenId] = candidate.clobTokenIds;
      const [yesBook, noBook] = await Promise.all([
        fetchOrderBook(yesTokenId),
        fetchOrderBook(noTokenId),
      ]);

      if (!yesBook || !noBook) return; // order book unavailable — leave as midpoint

      const yesBestAsk = yesBook.asks?.[0]?.price;
      const noBestAsk  = noBook.asks?.[0]?.price;

      if (!yesBestAsk || !noBestAsk) return; // no liquidity on one side

      const yesAsk = parseFloat(yesBestAsk);
      const noAsk  = parseFloat(noBestAsk);
      const clobSum = yesAsk + noAsk;

      // Update with verified CLOB data
      candidate.yesPrice     = yesAsk;
      candidate.noPrice      = noAsk;
      candidate.sum          = clobSum;
      candidate.grossProfit  = (1 - clobSum) * 100;
      candidate.netProfit    = Math.max(0, (1 - clobSum - ARB_CFG.feeEstimate) * 100);
      candidate.dataSource   = 'clob_orderbook'; // real bid/ask confirmed
      candidate.verified     = clobSum < 1.0;
      candidate.score        = candidate.grossProfit * Math.log10(Math.max(candidate.volume, 1000));

      // Store best-ask sizes for the UI
      candidate.yesAskSize   = parseFloat(yesBook.asks?.[0]?.size || 0);
      candidate.noAskSize    = parseFloat(noBook.asks?.[0]?.size  || 0);
      candidate.maxTradeable = Math.min(candidate.yesAskSize, candidate.noAskSize);
    }));
  }

  // Return all candidates where sum < 1.0, sorted by score.
  // Verified (CLOB) results naturally rank above unverified (midpoint) at same spread
  // because CLOB prices already absorb the bid/ask — the gap is real if it survives.
  return candidates
    .filter(r => r.sum < 1.0)
    .sort((a, b) => {
      // Verified results first, then by score
      if (a.verified !== b.verified) return a.verified ? -1 : 1;
      return b.score - a.score;
    });
}

// ── CLOB Order Book Fetch ─────────────────────────────────────────────────
// GET /clob/book?token_id={tokenId}
// Returns { bids: [{price, size}], asks: [{price, size}] } sorted best-first.
// No auth required — public endpoint.
async function fetchOrderBook(tokenId) {
  if (!tokenId) return null;
  const result = await apiFetch(`${base('clob')}/book?token_id=${tokenId}`, { timeout: 5000 });
  if (!result.ok || !result.data) return null;
  return result.data;
}

// ── 2. Statistical Arbitrage ──────────────────────────────────────────────
//
// Finds correlated market pairs whose price spread has diverged significantly
// from its recent historical mean, measured as a real statistical z-score.
//
// METHOD:
//   1. Fetch 30-day hourly price history for both YES tokens from CLOB.
//   2. Align the two series on timestamp (inner join, bucketed to nearest hour).
//   3. Compute spread series: spread[t] = priceA[t] - priceB[t]
//   4. μ = mean(spread), σ = stddev(spread)
//   5. z = (currentSpread - μ) / σ
//   A z of ±2 means the current spread is 2 standard deviations from its
//   30-day mean — a genuine statistical outlier.
//
// FALLBACK (history unavailable):
//   Pair is shown as a raw "Divergence Lead" — no z-score, no strength label,
//   no confidence score. No fabricated numbers are shown.
//
// Rate limit: ARB_CFG.maxStatArbFetches history fetches per scan.
//
async function runStatArbScan(markets) {
  const buckets = buildCategoryBuckets(markets);
  const signals = [];
  const candidates = [];

  for (const [cat, mkts] of Object.entries(buckets)) {
    if (mkts.length < 2) continue;

    const liquid = mkts
      .filter(m => m.liquidity > ARB_CFG.minLiquidity && m.volume > ARB_CFG.minVolume
                && m.clobTokenIds?.length >= 1)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 8);

    for (let i = 0; i < liquid.length; i++) {
      for (let j = i + 1; j < liquid.length; j++) {
        const rawSpread = liquid[i].yesPrice - liquid[j].yesPrice;
        candidates.push({
          mktA: liquid[i], mktB: liquid[j],
          category: cat,
          rawSpread,
          absRaw: Math.abs(rawSpread),
        });
      }
    }
  }

  // Prioritise highest raw divergence for history fetches (rate limit cap)
  candidates.sort((a, b) => b.absRaw - a.absRaw);
  const toFetch = candidates.slice(0, ARB_CFG.maxStatArbFetches);
  const startTs = Math.floor(Date.now() / 1000) - 30 * 86400;

  await Promise.allSettled(toFetch.map(async (c) => {
    const { mktA, mktB, category } = c;

    const [histA, histB] = await Promise.all([
      fetchPriceHistory(mktA.clobTokenIds[0], startTs),
      fetchPriceHistory(mktB.clobTokenIds[0], startTs),
    ]);

    if (!histA || !histB || histA.length < 10 || histB.length < 10) {
      if (c.absRaw >= 0.10) signals.push(buildDivergenceLead(mktA, mktB, category, c.rawSpread));
      return;
    }

    // Align on nearest-hour bucket
    const bucket  = ts => Math.round(ts / 3600) * 3600;
    const mapA    = new Map(histA.map(p => [bucket(p.t), p.p]));
    const series  = histB
      .map(p => { const pA = mapA.get(bucket(p.t)); return pA != null ? pA - p.p : null; })
      .filter(v => v !== null);

    if (series.length < 10) {
      if (c.absRaw >= 0.10) signals.push(buildDivergenceLead(mktA, mktB, category, c.rawSpread));
      return;
    }

    const n  = series.length;
    const mu = series.reduce((s, v) => s + v, 0) / n;
    // Sample std dev (/ (n-1)) not population (/ n) — with 10–30 obs the
    // difference is ~5–10% and population std dev inflates z-scores, surfacing
    // signals at lower true divergence than ARB_CFG.statArbZScore intends.
    const sigma = Math.sqrt(series.reduce((s, v) => s + (v - mu) ** 2, 0) / (n - 1));

    if (sigma < 0.001) return; // constant spread — no signal

    const currentSpread = c.rawSpread;
    const z    = (currentSpread - mu) / sigma;
    const absZ = Math.abs(z);

    if (absZ < ARB_CFG.statArbZScore) return;

    const [anchor, leg] = mktA.volume >= mktB.volume ? [mktA, mktB] : [mktB, mktA];

    signals.push({
      type:          'STAT_ARB',
      anchor:        anchor.question,
      anchorId:      anchor.id,
      anchorProb:    anchor.yesPrice,
      leg:           leg.question,
      legId:         leg.id,
      legProb:       leg.yesPrice,
      spread:        currentSpread.toFixed(4),
      spreadMean:    mu.toFixed(4),
      spreadStd:     sigma.toFixed(4),
      zScore:        z.toFixed(2),
      nObs:          n,
      category,
      combinedVolume: anchor.volume + leg.volume,
      strength:      absZ > 3 ? 'STRONG' : absZ > 2.5 ? 'MODERATE' : 'WEAK',
      // Confidence: function of both z-magnitude and sample size — both real inputs.
      // 60 hourly obs ≈ 2.5 days; 720 ≈ 30 days (full window).
      confidence:    Math.min(95, Math.round(Math.min(absZ / 4, 1) * Math.min(n / 60, 1) * 95)),
      edgeDirection: currentSpread > mu
        ? `SHORT "${trunc(anchor.question, 40)}" / LONG "${trunc(leg.question, 40)}"`
        : `LONG "${trunc(anchor.question, 40)}" / SHORT "${trunc(leg.question, 40)}"`,
      rationale: `30d spread: μ=${mu.toFixed(3)}, σ=${sigma.toFixed(3)}. ` +
        `Current ${currentSpread.toFixed(3)} is ${absZ.toFixed(1)}σ from mean ` +
        `(${n} hourly obs). Mean-reversion target: ${mu.toFixed(3)}.`,
      sizing:     computeStatArbSizing(absZ, n),
      dataSource: 'clob_history',
      ts:         Date.now(),
    });
  }));

  return signals.sort((a, b) =>
    Math.abs(parseFloat(b.zScore || 0)) - Math.abs(parseFloat(a.zScore || 0))
  );
}

// Fallback: history unavailable — raw spread only, no z-score, no strength label.
function buildDivergenceLead(mktA, mktB, category, rawSpread) {
  const [anchor, leg] = mktA.volume >= mktB.volume ? [mktA, mktB] : [mktB, mktA];
  return {
    type:          'STAT_ARB',
    anchor:        anchor.question,
    anchorId:      anchor.id,
    anchorProb:    anchor.yesPrice,
    leg:           leg.question,
    legId:         leg.id,
    legProb:       leg.yesPrice,
    spread:        rawSpread.toFixed(4),
    spreadMean:    null,
    spreadStd:     null,
    zScore:        null,   // no z-score without history — explicitly null, not zero
    nObs:          0,
    category,
    combinedVolume: anchor.volume + leg.volume,
    strength:      null,   // no label without real z-score
    confidence:    null,
    edgeDirection: rawSpread > 0
      ? `SHORT "${trunc(anchor.question, 40)}" / LONG "${trunc(leg.question, 40)}"`
      : `LONG "${trunc(anchor.question, 40)}" / SHORT "${trunc(leg.question, 40)}"`,
    rationale:    'Price history unavailable — raw spread only. Verify manually before trading.',
    sizing:       null,
    dataSource:   'midpoint_only',
    ts:           Date.now(),
  };
}

// Fetch hourly price history for a single token from CLOB.
// Returns [{t, p}] or null on failure.
async function fetchPriceHistory(tokenId, startTs) {
  if (!tokenId) return null;
  const result = await fetchMarketHistory(tokenId, startTs, '1h');
  if (!result.ok || !result.data) return null;
  const raw = result.data.history || result.data;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  return raw
    .map(p => ({ t: p.t || p.timestamp, p: parseFloat(p.p || p.price || 0) }))
    .filter(p => p.t && !isNaN(p.p) && p.p > 0);
}

function computeStatArbSizing(absZ, nObs = 0) {
  const sampleConf = Math.min(1, nObs / 60);
  const legEdge = Math.min(0.10, (absZ - ARB_CFG.statArbZScore) * 0.02 * sampleConf);
  return {
    legEdgePct:             (legEdge * 100).toFixed(1),
    recommendedBankrollPct: (Math.min(3, legEdge * 100 * 0.5)).toFixed(1),
    note: `Based on ${nObs} hourly obs. Use 25% Kelly on each leg independently.`,
  };
}

// ── 3. Price Spike / Mean-Reversion Scanner ──────────────────────────────
//
// Surfaces markets that moved significantly more today than their historical
// daily volatility suggests is normal — a real mean-reversion lead.
//
// METHOD — computed entirely from real price data:
//   1. Fetch 14d of hourly price history from the CLOB.
//   2. Compute hourly returns: r[t] = price[t] - price[t-1]
//   3. Historical hourly σ = std(r)
//   4. Daily RV = hourly σ × √24   (annualized to 1-day scale)
//   5. Spike ratio = |change24h| / dailyRV
//   A ratio > ARB_CFG.vrpSpikeThreshold (default 1.5) means today's move
//   was ≥1.5× the typical daily range — a genuine statistical observation.
//
// WHAT THIS IS NOT:
//   This is not implied volatility. Binary prediction markets have no
//   standard options pricing model from which IV can be extracted.
//   "VRP" implied a comparison between IV and RV that had no basis.
//   This scanner measures: did this market move unusually today?
//
// If change24h is absent or history is unavailable, no signal fires.
// No synthetic numbers are substituted.
//
async function runVRPScan(markets) {
  const signals = [];
  let skippedNoHistory = 0;

  // Candidates: liquid markets with a real observed 24h move
  const candidates = markets.filter(m =>
    m.liquidity >= 20000 &&
    m.volume    >= 100000 &&
    m.change24h != null &&
    Math.abs(m.change24h) > 0.001 &&  // at least 0.1% move
    m.clobTokenIds?.length >= 1
  );

  if (!candidates.length) {
    console.log('[NOVA Arb] Spike scan: no candidates with change24h data');
    return [];
  }

  // Fetch 14d hourly history for each candidate (reuses fetchPriceHistory)
  const startTs = Math.floor(Date.now() / 1000) - 14 * 86400;

  await Promise.allSettled(candidates.slice(0, ARB_CFG.maxSpikeScaFetches).map(async (m) => {
    const hist = await fetchPriceHistory(m.clobTokenIds[0], startTs);

    if (!hist || hist.length < 24) {  // need at least 24 hourly obs (1 day)
      skippedNoHistory++;
      return;
    }

    // Hourly returns: simple difference (not log — prices are bounded 0-1)
    const returns = [];
    for (let i = 1; i < hist.length; i++) {
      returns.push(hist[i].p - hist[i - 1].p);
    }

    const n       = returns.length;
    const mu_r    = returns.reduce((s, v) => s + v, 0) / n;
    const sigma_h = Math.sqrt(returns.reduce((s, v) => s + (v - mu_r) ** 2, 0) / (n - 1));

    if (sigma_h < 0.0001) return; // effectively constant price — no signal

    // Scale hourly σ to daily RV (1 trading day ≈ 24 hours for 24/7 markets)
    const dailyRV    = sigma_h * Math.sqrt(24);
    const absMove    = Math.abs(m.change24h);
    const spikeRatio = absMove / dailyRV;

    if (spikeRatio < ARB_CFG.vrpSpikeThreshold) return;

    const isNear50 = Math.abs(m.yesPrice - 0.5) < 0.15;
    const direction = m.change24h > 0 ? 'FADE_UP' : 'FADE_DOWN';

    // Confidence: function of spike magnitude AND sample size — both real inputs
    const sampleConf = Math.min(1, n / 168);  // 168h = 1 week of hourly data
    const confidence = Math.min(90, Math.round(
      Math.min(spikeRatio / 4, 1) * sampleConf * 90
    ));

    // Kelly sizing based on mean-reversion assumption:
    // If the market moved X above its normal range, expected reversion is back toward
    // the pre-spike price. We fade the move by estimating the "true" probability
    // as the pre-spike price (approximated as yesPrice - change24h).
    const preSpikePrice = Math.max(0.02, Math.min(0.98, m.yesPrice - m.change24h));
    const mktPrice      = direction === 'FADE_UP' ? m.yesPrice : (1 - m.yesPrice);
    const fadeProb      = direction === 'FADE_UP' ? preSpikePrice : (1 - preSpikePrice);

    signals.push({
      type:        'VRP',
      scannerLabel: 'Price Spike',
      market:      m.question,
      marketId:    m.id,
      yesPrice:    m.yesPrice,
      change24h:   m.change24h,
      dailyRV:     dailyRV.toFixed(4),   // real: std of returns × √24
      spikeRatio:  spikeRatio.toFixed(2), // real: |move| / dailyRV
      nObs:        n,
      // Keep field names for UI compatibility but rename semantically
      impliedVol:  null,   // not computed — no IV model for binary markets
      realizedVol: dailyRV.toFixed(4),  // this IS real: historical daily σ
      vrpGap:      spikeRatio.toFixed(2), // repurposed: spike ratio, not IV-RV gap
      edgeType:    isNear50 ? 'FADE_MOVE' : 'MEAN_REVERT',
      strength:    spikeRatio > 3 ? 'STRONG' : spikeRatio > 2 ? 'MODERATE' : 'WEAK',
      confidence,
      direction,
      rationale:   `14d daily RV = ${(dailyRV * 100).toFixed(2)}% (${n} hourly obs). ` +
        `Today's move: ${(absMove * 100).toFixed(2)}% = ${spikeRatio.toFixed(1)}× normal daily range. ` +
        (isNear50 ? 'Near-50%: mean reversion historically likely.' : 'Directional tilt: fade the move.'),
      sizing:      kellyFraction(fadeProb, mktPrice),
      category:    m.category,
      dataSource:  'clob_history',
      ts:          Date.now(),
    });
  }));

  if (skippedNoHistory > 0) {
    console.log(`[NOVA Arb] Spike scan: ${skippedNoHistory} skipped (no history)`);
  }

  return signals.sort((a, b) => parseFloat(b.spikeRatio) - parseFloat(a.spikeRatio));
}

// ── Kelly Sizing ──────────────────────────────────────────────────────────
export function kellyFraction(prob, marketPrice, fraction = 0.25) {
  const b        = (1 / marketPrice) - 1;
  const q        = 1 - prob;
  const fullKelly = Math.max(0, (b * prob - q) / b);
  return {
    full:    (fullKelly * 100).toFixed(1),
    quarter: (fullKelly * fraction * 100).toFixed(1),
    ev:      ((prob * (1 / marketPrice - 1) - q) * 100).toFixed(2),
    edge:    ((prob - marketPrice) / marketPrice * 100).toFixed(1),
  };
}

// ── Leg Sizing Calculator ─────────────────────────────────────────────────
export function computeLegs(arb, capital) {
  const { yesPrice, noPrice, sum } = arb;
  // R-ARB-01: allocate proportional to each leg's OWN price so shares bought
  // are equal on both sides → guaranteed equal payout at resolution (true risk-free arb).
  // Formula: yesAmt = capital × yesPrice / sum, noAmt = capital × noPrice / sum.
  // Previous code had these SWAPPED (used noPrice for YES leg and vice versa),
  // producing wildly different payouts depending on outcome — not risk-free.
  const yesAmt   = (yesPrice / sum) * capital;
  const noAmt    = capital - yesAmt;
  const profit   = (capital / sum) - capital;
  const roi      = (profit / capital) * 100;
  return {
    yesAmt:  parseFloat(yesAmt.toFixed(2)),
    noAmt:   parseFloat(noAmt.toFixed(2)),
    profit:  parseFloat(profit.toFixed(2)),
    roi:     parseFloat(roi.toFixed(2)),
  };
}

// ── Deploy Both Legs ──────────────────────────────────────────────────────
// Fires YES + NO simultaneously. No sequential exposure.
export async function deployCapital(arb, capital, callbacks = {}) {
  const { onStatus, onLeg, onDone, onError } = callbacks;

  const { yesAmt, noAmt, profit } = computeLegs(arb, capital);

  onStatus?.('executing');

  // Pre-generate two unique nonces sequentially BEFORE Promise.allSettled.
  // getSafeNonce() is monotonic but synchronous — calling it inside each
  // concurrent submitOrder would still work, but pre-generating here makes
  // the uniqueness guarantee explicit and keeps the nonce assignment visible
  // at the call site. Both nonces are passed to submitOrder via _nonce and
  // used directly — getSafeNonce() inside submitOrder is not called when
  // _nonce is supplied.
  const nonceYes = getSafeNonce();
  const nonceNo  = getSafeNonce();

  onLeg?.('YES', 'sending');
  onLeg?.('NO',  'sending');

  const [yesResult, noResult] = await Promise.allSettled([
    submitOrder({ market: arb, side: 'YES', amountUSD: yesAmt, _nonce: nonceYes }),
    submitOrder({ market: arb, side: 'NO',  amountUSD: noAmt,  _nonce: nonceNo  }),
  ]);

  const yesFilled = yesResult.status === 'fulfilled';
  const noFilled  = noResult.status  === 'fulfilled';

  onLeg?.('YES', yesFilled ? 'filled' : 'failed', yesResult.reason?.message);
  onLeg?.('NO',  noFilled  ? 'filled' : 'failed', noResult.reason?.message);

  if (yesFilled && noFilled) {
    onDone?.({ success: true, profit, both: true });
    return { ok: true, profit };
  }

  if (!yesFilled && !noFilled) {
    const err = yesResult.reason?.message || 'Unknown error';
    onDone?.({ success: false, both: false, err });
    return { ok: false, error: err };
  }

  // Partial fill — one leg live, one failed. Dangerous state — one side exposed.
  const failedSide = yesFilled ? 'NO' : 'YES';
  const failedAmt  = yesFilled ? noAmt : yesAmt;

  onError?.({
    partial: true,
    filledSide: yesFilled ? 'YES' : 'NO',
    failedSide,
    failedAmt,
    profit,
    retry: () => retryLeg(arb, failedSide, failedAmt, profit, callbacks),
  });

  return { ok: false, partial: true, failedSide };
}

async function retryLeg(arb, side, amount, profit, callbacks) {
  const { onLeg, onDone } = callbacks;
  onLeg?.(side, 'sending');
  try {
    await submitOrder({ market: arb, side, amountUSD: amount });
    onLeg?.(side, 'filled');
    onDone?.({ success: true, profit, retried: true });
    return { ok: true };
  } catch (err) {
    onLeg?.(side, 'failed', err.message);
    return { ok: false, error: err.message };
  }
}

// ── AI Analysis on Signal ─────────────────────────────────────────────────
export async function analyzeSignal(signal) {
  let msg;

  if (signal.type === 'STAT_ARB') {
    msg = `Validate this stat-arb signal:\n\nStrength: ${signal.strength} (z=${signal.zScore})\nPair: "${signal.anchor}" vs "${signal.leg}"\nCategory: ${signal.category}\nDirection: ${signal.edgeDirection}\nRationale: ${signal.rationale}\n\nIs this real edge or noise? Max 100 words.`;

  } else if (signal.type === 'SPREAD_ARB') {
    // Price spread arb: YES + NO cost < $1.00 — risk-free at resolution.
    // Fields: signal.question, signal.grossProfit, signal.yesPrice, signal.noPrice,
    //         signal.sum, signal.verified, signal.dataSource, signal.volume.
    // (No anchor/zScore/strength/rationale — those belong to STAT_ARB and VRP signals.)
    msg = `Validate this price spread arb signal:\n\nMarket: "${signal.question}"\nCategory: ${signal.category}\nYES: ${(signal.yesPrice * 100).toFixed(1)}c  NO: ${(signal.noPrice * 100).toFixed(1)}c  Sum: ${(signal.sum * 100).toFixed(1)}c\nGross spread: +${signal.grossProfit.toFixed(2)}c per $1 deployed\nNet (after ~0.2% fees): +${signal.netProfit.toFixed(2)}c\nPrice source: ${signal.verified ? 'CLOB best-ask (verified)' : 'Gamma midpoint (unverified)'}\nVolume: $${Number(signal.volume).toLocaleString()}\n\nIs this a genuine arb or likely a stale/illiquid quote? What are the main execution risks? Max 100 words.`;

  } else {
    // VRP / price spike scanner
    msg = `Validate this price spike signal:\n\nStrength: ${signal.strength} (${signal.spikeRatio}× normal daily range)\nMarket: "${signal.market}"\nYES price: ${(signal.yesPrice * 100).toFixed(1)}% | 24h move: ${(signal.change24h * 100).toFixed(2)}% | 14d daily RV: ${(parseFloat(signal.dailyRV || 0) * 100).toFixed(2)}% (${signal.nObs} hourly obs)\nDirection: ${signal.direction}\nRationale: ${signal.rationale}\n\nShould we fade this move based on historical volatility? Max 100 words.`;
  }

  return runAgent('pulse', msg);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function buildCategoryBuckets(markets) {
  const buckets = {};
  for (const m of markets) {
    const cat = m.category || 'other';
    if (!buckets[cat]) buckets[cat] = [];
    buckets[cat].push(m);
  }
  return buckets;
}
