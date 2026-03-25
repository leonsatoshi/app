/**
 * NOVA — Agent System
 * Modular AI agents. Each agent has a role, system prompt, and can be
 * invoked independently or as a pipeline. All API calls go through
 * the Anthropic API with the user's key from CFG.anthropicKey.
 */

import { AGENTS } from './constants.js';
import { CFG } from './state.js';

// ── Single Agent Call ──────────────────────────────────────────────────────
// Calls one agent with a user message and optional context.
// Returns { ok, agentId, text, error }
export async function runAgent(agentId, userMessage, context = {}) {
  const agent = AGENTS[agentId];
  if (!agent) return { ok: false, error: `Unknown agent: ${agentId}` };

  if (!CFG.anthropicKey) {
    return { ok: false, error: 'Anthropic API key not set — add it in Settings' };
  }

  const systemPrompt = buildSystemPrompt(agent, context);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            CFG.anthropicKey,
        'anthropic-version':    '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1024,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return { ok: false, agentId, error: `API error ${response.status}: ${body}` };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    return { ok: true, agentId, agent, text };

  } catch (err) {
    return { ok: false, agentId, error: err.message };
  }
}

// ── Pipeline — Run Multiple Agents ────────────────────────────────────────
// Runs a sequence of agents. Each agent receives the output of the previous.
// Returns array of { agentId, text } results.
export async function runPipeline(agentIds, userMessage, context = {}) {
  const results = [];
  let accumContext = { ...context, priorOutputs: [] };

  for (const agentId of agentIds) {
    const msg = buildPipelineMessage(userMessage, accumContext);
    const result = await runAgent(agentId, msg, accumContext);
    results.push(result);

    if (result.ok) {
      accumContext.priorOutputs.push({
        agent: AGENTS[agentId]?.name,
        text:  result.text,
      });
    }
  }

  return results;
}

// ── Full Analysis — All Agents ─────────────────────────────────────────────
// Runs all 5 agents in parallel on a market and synthesizes.
export async function fullAnalysis(market) {
  const context = buildMarketContext(market);
  const userMsg = `Analyze this prediction market: "${market.question}"`;

  // Run oracle, vega, shield in parallel (they're independent)
  const [oracle, vega, shield] = await Promise.all([
    runAgent('oracle', userMsg, context),
    runAgent('vega',   userMsg, context),
    runAgent('shield', userMsg, context),
  ]);

  // Synthesize
  const synthesis = await synthesize(market, [oracle, vega, shield]);

  return { oracle, vega, shield, synthesis };
}

// ── Quick Analysis — Single Agent ─────────────────────────────────────────
export async function quickAnalysis(market, agentId = 'oracle', customPrompt = '') {
  const context = buildMarketContext(market);
  const msg = customPrompt || `Give me a concise analysis of: "${market.question}"`;
  return runAgent(agentId, msg, context);
}

// ── Synthesis ─────────────────────────────────────────────────────────────
async function synthesize(market, agentResults) {
  const successfulResults = agentResults.filter(r => r.ok);
  if (!successfulResults.length) return { ok: false, error: 'No agent results to synthesize' };

  const priorAnalyses = successfulResults.map(r =>
    `${r.agent?.name} (${r.agent?.role}):\n${r.text}`
  ).join('\n\n---\n\n');

  const msg = `Based on these agent analyses for "${market.question}", provide a final recommendation:

${priorAnalyses}

Synthesize into: (1) overall probability assessment vs current price, (2) recommended action (buy YES / buy NO / skip), (3) suggested position size as % of bankroll, (4) key risks.`;

  return runAgent('vega', msg, buildMarketContext(market));
}

// ── Context Builders ───────────────────────────────────────────────────────
function buildMarketContext(market) {
  return {
    question:     market.question,
    yesPrice:     market.yesPrice,
    noPrice:      market.noPrice,
    volume:       market.volume,
    endDate:      market.endDate,
    category:     market.category,
    description:  market.description,
  };
}

function buildSystemPrompt(agent, context) {
  let prompt = agent.prompt;

  if (context.question) {
    prompt += `\n\nMarket context:
- Question: "${context.question}"
- YES price: ${context.yesPrice ? (context.yesPrice * 100).toFixed(1) + '¢' : 'unknown'}
- NO price:  ${context.noPrice  ? (context.noPrice  * 100).toFixed(1) + '¢' : 'unknown'}
- Volume:    ${context.volume ? '$' + Number(context.volume).toLocaleString() : 'unknown'}
- Closes:    ${context.endDate || 'unknown'}`;
  }

  prompt += '\n\nBe concise and actionable. Use data. Avoid hedging.';
  return prompt;
}

function buildPipelineMessage(userMsg, context) {
  if (!context.priorOutputs?.length) return userMsg;
  const prior = context.priorOutputs.map(o => `${o.agent}: ${o.text}`).join('\n\n');
  return `${userMsg}\n\nPrevious agent analyses:\n${prior}`;
}
