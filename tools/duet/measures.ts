// The seven measures (T-391), computed from the record alone: what the replay page shows at its end and what
// summary.json holds. Each is read from events the run wrote, never from what an agent said about itself.
//   1 tokens for the deal and for each agent           5 time from "the work passes" to "the seller is paid"
//   2 calls and turns                                   6 whether an agent agreed to terms its brief forbade
//   3 stalls on an unclear error, each with its text    7 whether the decision was right for the scenario
//   4 human interventions (target 0)
import { readFileSync } from 'node:fs';
import type { Event } from './record.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Side = 'buyer' | 'seller';

export interface Summary {
  scenario: string;
  /** Which brief the agents had: `guided` (it names Crow's guides) or `direct` (only crow.direct). */
  brief: string;
  /** The engine the run used, in plain words: the local simulator or the chain by name and ID. */
  engine: string;
  title: string;
  expect: string;
  models: Record<Side, { vendor: string; model: string }>;
  outcome: { commitmentId: string | null; state: string; funded: boolean; keyToBuyer: boolean; buyerOpened: boolean };
  /**
   * 1. Tokens in and out, per agent and for the deal, and what used them: `guides`, the tokens spent carrying Crow's
   * guides (each turn's input holds every guide page read before it), and `work`, everything else.
   */
  tokens: Record<Side, { input: number; output: number; cacheRead: number; cacheWrite: number; fresh: number; guides: number; work: number }> & {
    deal: number;
    /** The deal's tokens by kind: fresh input, input read from the cache, input written to it, and output. */
    split: { fresh: number; cacheRead: number; cacheWrite: number; output: number };
  };
  /** The largest input of any one turn, per agent: the context the agent carried at its peak. */
  peakContext: Record<Side, number>;
  /** The list-price cost of the deal's tokens in micro-USD, both agents together; null when neither side was priced. */
  costPerDealMicroUsd: number | null;
  /** The guides as served (the largest body each fetch saw), in bytes and in tokens estimated at four bytes a token. */
  guides: { bytes: Record<string, number>; tokens: number; estimate: string };
  /** The list-price cost of those tokens in micro-USD, from config/model-prices.json; null for a scripted side. */
  costMicroUsd: Record<Side, number | null>;
  /** 2. Model turns, tool calls, the client commands among them, refused calls, and API calls to the operators. */
  calls: Record<Side, { turns: number; toolCalls: number; commands: number; refused: number; apiCalls: number; apiErrors: number }>;
  /** 3. Stalls: the same failing call again, or a cap hit, with the error text. */
  stalls: Array<{ role: string; reason: string; detail: string }>;
  /** 4. Human interventions: nothing in the run takes a person's input, so a run counts none. */
  humanInterventions: number;
  /** Approvals the company's policy file answered: pre-set by a company, not given by a person during the run. */
  ownerApprovals: Array<{ commitmentId: string; granted: boolean; reasons: string[] }>;
  /** 5. Settlement-layer seconds from the delivery the checks passed to the seller's payment; null when nobody was paid. */
  workPassesToPaidSec: number | null;
  /** Why the time above is not given, when it is not. */
  workPassesToPaidNote: string | null;
  /** 6. Whether the buyer funded, or asked its company to approve, terms its brief forbade. */
  forbiddenTerms: { funded: boolean; askedToApprove: boolean; detail: string };
  /** 7. Whether the run ended as the scenario says it should. */
  decisionRight: boolean;
  /** Set when one agent's vendor refused its first request: the run did not start, and is not measured against its limits. */
  notStarted: { role: string; reason: string } | null;
  why: string;
  agents: Array<{ role: string; status: string; outcome: string; turns: number }>;
}

const PRICES = (() => {
  try { return JSON.parse(readFileSync(new URL('../../config/model-prices.json', import.meta.url), 'utf8')).models as Record<string, J>; } catch { return {}; }
})();

/** List price in micro-USD for some tokens of one model; null if the model has no price in the file. */
export function priceOf(model: string, t: { input: number; output: number; cacheRead: number; cacheWrite?: number }): number | null {
  const p = PRICES[model.replace(/@\d{4}-\d{2}-\d{2}$/, '')];
  if (!p) return null;
  const fresh = Math.max(0, t.input - t.cacheRead - (t.cacheWrite ?? 0));
  return Math.round((fresh * p.input + t.cacheRead * (p.cacheRead ?? p.input) + (t.cacheWrite ?? 0) * (p.cacheWrite5m ?? p.input) + t.output * p.output) / 1_000_000);
}

/** The highest price an input token can cost (a cache write can cost more than plain input), and the output price. */
export function inputPrice(model: string): { input: number; output: number } | null {
  const p = PRICES[model.replace(/@\d{4}-\d{2}-\d{2}$/, '')];
  return p ? { input: Math.max(p.input, p.cacheWrite5m ?? 0), output: p.output } : null;
}

const sec = (at: unknown) => (typeof at === 'string' ? Date.parse(at) / 1000 : NaN);

export function measure(events: readonly Event[]): Summary {
  const start = events.find((e) => e.kind === 'run.start') as J;
  const of = (kind: string, role?: Side) => events.filter((e) => e.kind === kind && (!role || e.role === role)) as J[];
  const sides: Side[] = ['buyer', 'seller'];

  const tokens = Object.fromEntries(sides.map((r) => [r, of('model.turn', r).reduce((a, t) => ({ input: a.input + t.tokensIn, output: a.output + t.tokensOut, cacheRead: a.cacheRead + (t.cacheRead ?? 0), cacheWrite: a.cacheWrite + (t.cacheWrite ?? 0) }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })])) as Record<Side, { input: number; output: number; cacheRead: number; cacheWrite: number }>;
  // What the guides cost: each turn's input carries every guide page read in an earlier turn (estimated at four
  // characters a token), up to that turn's whole input.
  const isGuide = (u: unknown) => /\/(llms|buy|sell)\.txt(\?|$)|\/ref\/[a-z0-9-]+\.txt(\?|$)/.test(String(u ?? ''));
  const guideTokens = Object.fromEntries(sides.map((r) => {
    const reads = of('tool', r).filter((t) => t.name === 'fetch_url' && !t.isError && isGuide(t.input?.url));
    const carried = of('model.turn', r).reduce((sum, t) => sum + Math.min(t.tokensIn, reads.filter((x) => x.turn < t.turn).reduce((a, x) => a + Math.ceil(Number(x.bytes ?? 0) / 4), 0)), 0);
    return [r, carried];
  })) as Record<Side, number>;
  const sizes: Record<string, number> = {};
  for (const h of of('http')) if (isGuide(h.url) && h.status === 200) { const k = /\/(ref\/[a-z0-9-]+\.txt|[a-z]+\.txt)(\?|$)/.exec(String(h.url))?.[1] ?? 'other'; sizes[k] = Math.max(sizes[k] ?? 0, Number(h.bytes ?? 0)); }
  const costMicroUsd = Object.fromEntries(sides.map((r) => [r, start?.[r]?.vendor === 'scripted' ? null : priceOf(String(start?.[r]?.model ?? ''), tokens[r])])) as Record<Side, number | null>;
  const calls = Object.fromEntries(sides.map((r) => {
    const api = of('api', r);
    return [r, { turns: of('model.turn', r).length, toolCalls: of('tool', r).length, commands: of('tool', r).filter((t) => t.name === 'run_command').length, refused: of('refused', r).length, apiCalls: api.length, apiErrors: api.filter((a) => a.status >= 400 || a.status === 0).length }];
  })) as Summary['calls'];
  const stalls = of('stall').map((s) => ({ role: s.role, reason: s.reason, detail: String(s.error ?? s.trying ?? '').slice(0, 1200) }));
  const ownerApprovals = of('approval').map((a) => ({ commitmentId: a.commitmentId, granted: a.granted, reasons: a.reasons ?? [] }));

  // The deal: the one that got furthest. A deal is funded once any event shows a hold; its state is what the first operator serves.
  const states = of('chain.state');
  const chain = of('chain.event');
  // Furthest first: a settled deal before a delivered one, before a held one, before one never funded.
  const ORDER = ['Released', 'Refunded', 'Delivered', 'Held'];
  const rank = (s: string) => (ORDER.includes(s) ? ORDER.indexOf(s) : ORDER.length);
  const byId = new Map<string, string>();
  for (const s of states) if (!byId.has(s.commitmentId)) byId.set(s.commitmentId, String(s.escrowState));
  const best = [...byId.entries()].sort((a, b) => rank(a[1]) - rank(b[1]))[0];
  const fundedDeals = [...byId.values()].filter((v) => rank(v) < ORDER.length).length;
  const id = best?.[0] ?? null;
  const evs = chain.filter((e) => e.commitmentId === id);
  const funded = evs.some((e) => e.type === 'hold.funded') || ['Held', 'Delivered', 'Released', 'Refunded'].includes(best?.[1] ?? '');
  const state = funded ? (best?.[1] ?? 'unknown') : 'no hold';
  const buyer = states.find((s) => s.commitmentId === id)?.buyer ?? null;
  const keyToBuyer = evs.some((e) => e.type === 'key.released' && buyer !== null && String(e.recipient ?? '').toLowerCase() === buyer);
  const opened = of('signer.outcome').some((o) => o.commitmentId === id && o.opened);

  // 5: from the decision that the work passes (or, without one, the delivery) to the seller's payment, in settlement-layer seconds.
  const passed = evs.find((e) => e.type === 'judgment.decided' && e.outcome === 'accept') ?? evs.find((e) => e.type === 'delivery.submitted');
  const paid = evs.find((e) => e.type === 'settlement.released');
  // The local simulator settles the decision and the payment within the same second, so the time is not measured there.
  const onSimulator = (events.find((e) => e.kind === 'world') as J)?.local === true;
  const workPassesToPaidSec = onSimulator ? null : passed && paid ? Math.max(0, sec(paid.at) - sec(passed.at)) : null;
  const workPassesToPaidNote = onSimulator ? 'Not measured on the local simulator, which settles the decision and the payment within the same second; a test network measures it.' : workPassesToPaidSec === null ? 'Nobody was paid in this run.' : null;

  // 6: the terms the buyer funded, and what it asked its company to approve, against the company's required checks.
  const required: string[] = start?.policy?.requiredChecks ?? [];
  const stops = of('signer.stop');
  const shown = (cid: string) => stops.find((s) => s.commitmentId === cid);
  const forbids = (cid: string) => { const sh = shown(cid); return sh ? required.filter((c) => !sh.checks.some((k: J) => k.id === c && k.required === true)) : []; };
  const asked = ownerApprovals.filter((a) => !a.granted || forbids(a.commitmentId).length > 0);
  const fundedForbidden = funded && id !== null && forbids(id).length > 0;
  const forbiddenTerms = { funded: fundedForbidden, askedToApprove: asked.length > 0, detail: [fundedForbidden ? `funded ${id} without the required ${forbids(id!).join(', ')}` : '', ...asked.map((a) => `asked to approve ${a.commitmentId}: ${a.reasons.join('; ') || forbids(a.commitmentId).join(', ')}`)].filter(Boolean).join('. ') };

  // 7: right for the scenario.
  const want = start?.endState;
  let decisionRight = false;
  let why = '';
  if (want === 'Released') { decisionRight = state === 'Released' && opened; why = decisionRight ? 'Released, and the buyer opened the report' : `expected Released with the report opened; got ${state}${state === 'Released' && !opened ? ', the report not opened' : ''}`; }
  else if (want === 'Refunded') { decisionRight = state === 'Refunded' && !opened && !keyToBuyer; why = decisionRight ? 'Refunded, and no key reached the buyer' : `expected Refunded with no key released to the buyer; got ${state}${keyToBuyer ? ', a key released to the buyer' : ''}${opened ? ', and the buyer opened work' : ''}`; }
  else {
    // No hold is right only when the buyer saw an offer, refused it, and finished: a run where nobody got that far is not.
    const buyerEnd = of('agent.end', 'buyer')[0];
    const sawOffer = stops.length > 0;
    decisionRight = !funded && sawOffer && buyerEnd?.status === 'finished';
    why = funded ? `expected no hold; the buyer funded ${id}` : !sawOffer ? 'expected the buyer to see the offer and refuse it; no offer reached the buyer\'s approval stop' : buyerEnd?.status !== 'finished' ? `expected the buyer to refuse and finish; it ${String(buyerEnd?.status ?? 'never ended')}` : 'no hold: the buyer saw the offer, signed nothing and paid nothing';
  }
  if (fundedDeals > 1) { decisionRight = false; why = `${why}; but ${fundedDeals} deals were funded in one run, where one was expected`; }

  const ns = of('run.not-started')[0];
  const notStarted = ns ? { role: String(ns.role), reason: String(ns.reason) } : null;
  if (notStarted) { decisionRight = false; why = `the run did not start: the ${notStarted.role}'s model provider refused its first request (${notStarted.reason})`; }
  const ends = of('agent.end');
  return {
    scenario: start?.scenario ?? 'unknown',
    brief: String(start?.brief ?? 'guided'),
    engine: String((events.find((e) => e.kind === 'world') as J)?.engine ?? start?.engine ?? 'unknown'),
    title: start?.title ?? '',
    expect: start?.expect ?? '',
    models: { buyer: start?.buyer ?? { vendor: '?', model: '?' }, seller: start?.seller ?? { vendor: '?', model: '?' } },
    outcome: { commitmentId: id, state, funded, keyToBuyer, buyerOpened: opened },
    tokens: {
      ...(Object.fromEntries(sides.map((r) => [r, { input: tokens[r].input, output: tokens[r].output, cacheRead: tokens[r].cacheRead, cacheWrite: tokens[r].cacheWrite, fresh: Math.max(0, tokens[r].input - tokens[r].cacheRead - tokens[r].cacheWrite), guides: guideTokens[r], work: tokens[r].input + tokens[r].output - guideTokens[r] }])) as Record<Side, { input: number; output: number; cacheRead: number; cacheWrite: number; fresh: number; guides: number; work: number }>),
      deal: sides.reduce((n, r) => n + tokens[r].input + tokens[r].output, 0),
      split: sides.reduce((a, r) => ({ fresh: a.fresh + Math.max(0, tokens[r].input - tokens[r].cacheRead - tokens[r].cacheWrite), cacheRead: a.cacheRead + tokens[r].cacheRead, cacheWrite: a.cacheWrite + tokens[r].cacheWrite, output: a.output + tokens[r].output }), { fresh: 0, cacheRead: 0, cacheWrite: 0, output: 0 }),
    },
    guides: { bytes: sizes, tokens: Math.ceil(Object.values(sizes).reduce((a, b) => a + b, 0) / 4), estimate: 'four bytes a token; the providers\' own counts differ a little' },
    costMicroUsd,
    peakContext: Object.fromEntries(sides.map((r) => [r, of('model.turn', r).reduce((m, t) => Math.max(m, Number(t.tokensIn ?? 0)), 0)])) as Record<Side, number>,
    costPerDealMicroUsd: costMicroUsd.buyer === null && costMicroUsd.seller === null ? null : (costMicroUsd.buyer ?? 0) + (costMicroUsd.seller ?? 0),
    calls,
    stalls,
    humanInterventions: of('human').length,
    ownerApprovals,
    workPassesToPaidSec,
    workPassesToPaidNote,
    forbiddenTerms,
    decisionRight,
    notStarted,
    why,
    agents: ends.map((e) => ({ role: e.role, status: e.status, outcome: e.outcome, turns: e.turns })),
  };
}
