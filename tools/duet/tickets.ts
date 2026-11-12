// Tickets (T-391): when a run goes over a limit in limits.json, or an agent stalls, the runner writes one ticket in
// plain words beside the record: each measure that was over, its number against its limit, where in the run it
// happened, a likely cause (a guess, said to be one) and a proposed owner. Whoever reads the run folder sends the
// ticket to the coordinator, who routes it.
import { readFileSync } from 'node:fs';
import type { Summary } from './measures.ts';
import type { Event } from './record.ts';
import { AGENT_NAME } from './scenarios.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Side = 'buyer' | 'seller';

/**
 * An agent's token limit has two parts: Crow's guides read once (their size as this run served them, measured) and an
 * allowance for the work (a guess). The deal's limit is the two agents' limits together.
 */
export interface Limits {
  workTokensPerAgent: number;
  turnsPerAgent: number;
  toolCallsPerAgent: number;
  apiCallsPerAgent: number;
  workPassesToPaidSec: number;
  /** The largest input of any one turn, per agent, in tokens. */
  peakContextPerAgent?: number;
  /** The deal's list-price cost in micro-USD, both agents together; not checked when neither side was priced. */
  costPerDealMicroUsd?: number;
}

export function limitsFor(scenario: string, file = new URL('./limits.json', import.meta.url)): Limits {
  const all = JSON.parse(readFileSync(file, 'utf8')).scenarios as Record<string, Limits>;
  const l = all[scenario];
  if (!l) throw new Error(`limits.json has no limits for the scenario ${scenario}`);
  return l;
}

export interface Over {
  measure: string;
  value: number;
  limit: number;
  /** Where in the run it happened, in plain words. */
  where: string[];
  /** A guess at the cause, and who should own the fix. */
  cause: string;
  owner: string;
}

const n = (x: number) => x.toLocaleString('en-US');
const cut = (s: string, k: number) => (s.length > k ? `${s.slice(0, k)} …` : s);

/** A plain-words guess at what a failing call was, and who owns the fix. */
function blame(call: string, error: string): { cause: string; owner: string } {
  if (/^run_command .*"command":"([\w-]+)"/.test(call) || /^run_command/.test(call)) {
    const cmd = /"command":"([\w-]+)"/.exec(call)?.[1] ?? 'a client command';
    if (/^Refused/.test(error)) return { cause: `Guess: the agent did not know how its tools take this command's arguments; the docs' example for ${cmd} may not match what the run tool accepts, or the brief does not say enough.`, owner: 'the runner (tools/duet) or the docs' };
    if (/problem\+json|"type":|HTTP [45]\d\d/.test(error)) return { cause: `Guess: an operator refused a call ${cmd} made, and its error did not tell the agent what to do next.`, owner: "the API's errors" };
    return { cause: `Guess: ${cmd} failed with a message that did not tell the agent what to do next.`, owner: `the client tool (examples/${cmd}.ts)` };
  }
  if (/^fetch_url/.test(call)) {
    if (/not on your company's allowlist/.test(error)) return { cause: 'Guess: the agent tried an address its company did not allow; the docs may send it somewhere the brief does not name.', owner: 'the docs or the brief (tools/duet/scenarios.ts)' };
    return { cause: 'Guess: the agent kept reading an address that answered with an error; the docs may name a route this world does not serve.', owner: 'the docs' };
  }
  return { cause: 'Guess: the agent repeated a call that kept failing; read the error below for what it lacked.', owner: 'the runner (tools/duet)' };
}

/** Every measure over its limit, with where it happened and a guess at why. */
export function overLimits(s: Summary, events: readonly Event[], l: Limits): Over[] {
  // A run where one side never started has no deal to measure: no ticket blames the docs, the tools or the limits.
  if (s.notStarted) return [];
  const ev = events as J[];
  const out: Over[] = [];
  const turns = (role: Side) => ev.filter((e) => e.kind === 'model.turn' && e.role === role);
  const costly = (role?: Side) =>
    ev.filter((e) => e.kind === 'model.turn' && (!role || e.role === role)).sort((a, b) => b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut)).slice(0, 3)
      .map((t) => `The ${AGENT_NAME[t.role as Side] ?? t.role}'s turn ${t.turn} used ${n(t.tokensIn + t.tokensOut)} tokens${t.calls?.length ? `, calling ${t.calls.map((c: J) => c.name === 'run_command' ? `run_command ${c.input?.command}` : c.name === 'fetch_url' ? `fetch_url ${String(c.input?.url ?? '')}` : c.name).join(', ')}` : ''}.`);
  // What the record shows about reading: the pages read beyond the first-deal path (llms.txt plus the role's own page),
  // and the fetches that found nothing. The seller's own page is the deal, not the docs, so it is not counted as extra.
  const FIRST_PATH: Record<Side, string[]> = { buyer: ['/llms.txt', '/buy.txt'], seller: ['/llms.txt', '/sell.txt'] };
  const fetches = (role?: Side) => ev.filter((e) => e.kind === 'http' && e.via === 'fetch_url' && (!role || e.role === role));
  const pathOf = (url: string) => { try { return new URL(url).pathname; } catch { return url; } };
  const uniq = (xs: string[]) => [...new Set(xs)];
  // Pages on the docs' own site only (wherever llms.txt was read): operator and job API reads are the deal's work.
  const docSites = new Set(fetches().filter((e) => pathOf(String(e.url)) === '/llms.txt').map((e) => { try { return new URL(String(e.url)).origin; } catch { return ''; } }));
  const onDocSite = (url: string) => { try { return docSites.has(new URL(url).origin); } catch { return false; } };
  const beyond = (role?: Side) => uniq(fetches(role).filter((e) => e.status === 200 && onDocSite(String(e.url)) && !(role ? FIRST_PATH[role] : [...FIRST_PATH.buyer, ...FIRST_PATH.seller]).includes(pathOf(String(e.url))) && !pathOf(String(e.url)).startsWith('/sellers/')).map((e) => pathOf(String(e.url))));
  const probes = (role?: Side) => fetches(role).filter((e) => e.status === 404).map((e) => pathOf(String(e.url)));
  const list = (xs: string[], k = 6) => (xs.length > k ? `${xs.slice(0, k).join(', ')} and ${xs.length - k} more` : xs.join(', '));
  const usd = (micro: number | null) => (micro === null ? '' : `, about $${(micro / 1e6).toFixed(4)} at list price`);
  const split = (role: Side) => {
    const t = s.tokens[role];
    return `Of the ${AGENT_NAME[role]}'s ${n(t.input + t.output)} tokens: ${n(t.fresh)} fresh input, ${n(t.cacheRead)} read from the cache, ${n(t.cacheWrite)} written to it and ${n(t.output)} output${usd(s.costMicroUsd[role])}. ${n(t.guides)} of them carried Crow's guides (about ${n(s.guides.tokens)} tokens, paid again on every step after they were read) and ${n(t.work)} went to the work.`;
  };
  const tokenCause = (role?: Side) => {
    const extra = beyond(role);
    const miss = probes(role);
    const who = role ? `the ${AGENT_NAME[role]}` : 'the agents';
    const read = extra.length ? `${who} read ${extra.length} ${extra.length === 1 ? 'page' : 'pages'} beyond the first-deal path (${list(extra)})` : `${who} read nothing beyond the first-deal path`;
    const probed = miss.length ? `${miss.length} ${miss.length === 1 ? 'fetch' : 'fetches'} found nothing (404: ${list(uniq(miss))})` : 'no fetch answered 404';
    const sellerProbes = miss.filter((x) => x.startsWith('/sellers/')).length;
    const owner = miss.length && sellerProbes * 2 >= miss.length ? "the runner (tools/duet): the probes were for the seller's page" : extra.length || miss.length ? 'the docs' : 'a client tool, or the runner (tools/duet)';
    return { cause: `From the record: ${read}, and ${probed}. ${extra.length || miss.length ? 'Each page read stays in the context for every later turn.' : 'The work itself grew the context: long tool outputs or many steps.'}`, owner };
  };
  const agentLimit = s.guides.tokens + l.workTokensPerAgent;
  for (const role of ['buyer', 'seller'] as const) {
    const tok = s.tokens[role].input + s.tokens[role].output;
    if (tok > agentLimit) out.push({ measure: `tokens for the ${AGENT_NAME[role]}`, value: tok, limit: agentLimit, where: [split(role), `The limit is the guides read once (${n(s.guides.tokens)}) plus ${n(l.workTokensPerAgent)} for the work.`, ...costly(role)], ...tokenCause(role) });
    if (s.calls[role].turns > l.turnsPerAgent) out.push({ measure: `model turns for the ${AGENT_NAME[role]}`, value: s.calls[role].turns, limit: l.turnsPerAgent, where: [`The ${AGENT_NAME[role]} took ${turns(role).length} turns; its last words were: ${cut(String([...turns(role)].reverse().find((t) => t.text)?.text ?? '(none)'), 300)}`], cause: 'Guess: the agent searched for its next step; the docs may not lay out the steps for its role in order.', owner: 'the docs' });
    if (s.calls[role].toolCalls > l.toolCallsPerAgent) {
      const counts = new Map<string, number>();
      for (const e of ev.filter((x) => x.kind === 'tool' && x.role === role)) { const k = e.name === 'run_command' ? `run_command ${e.input?.command}` : e.name === 'fetch_url' ? `fetch_url ${String(e.input?.url ?? '').replace(/0x[0-9a-f]{64}/g, '<id>')}` : e.name; counts.set(k, (counts.get(k) ?? 0) + 1); }
      out.push({ measure: `tool calls for the ${AGENT_NAME[role]}`, value: s.calls[role].toolCalls, limit: l.toolCallsPerAgent, where: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, c]) => `${k}: ${c} times.`), cause: 'Guess: the agent polled for a change it could not see coming; the docs may not say how long each step takes or what to wait for.', owner: 'the docs' });
    }
    if (s.calls[role].apiCalls > l.apiCallsPerAgent) out.push({ measure: `API calls for the ${AGENT_NAME[role]}`, value: s.calls[role].apiCalls, limit: l.apiCallsPerAgent, where: [`${s.calls[role].apiErrors} of them answered with an error.`], cause: "Guess: a client tool polls the operators often while it waits; its poll interval may suit a person better than an agent's budget.", owner: 'a client tool' });
  }
  for (const role of ['buyer', 'seller'] as const) {
    if (l.peakContextPerAgent !== undefined && s.peakContext[role] > l.peakContextPerAgent) out.push({ measure: `peak context for the ${AGENT_NAME[role]}`, value: s.peakContext[role], limit: l.peakContextPerAgent, where: [`The ${AGENT_NAME[role]}'s largest turn read ${n(s.peakContext[role])} tokens of input.`, ...costly(role)], ...tokenCause(role) });
  }
  if (l.costPerDealMicroUsd !== undefined && s.costPerDealMicroUsd !== null && s.costPerDealMicroUsd > l.costPerDealMicroUsd) out.push({ measure: 'cost of the deal in micro-USD', value: s.costPerDealMicroUsd, limit: l.costPerDealMicroUsd, where: [split('buyer'), split('seller')], ...tokenCause() });
  if (s.tokens.deal > 2 * agentLimit) out.push({ measure: 'tokens for the deal', value: s.tokens.deal, limit: 2 * agentLimit, where: [split('buyer'), split('seller'), ...costly()], ...tokenCause() });
  if (s.workPassesToPaidSec !== null && s.workPassesToPaidSec > l.workPassesToPaidSec) out.push({ measure: 'seconds from the work passing to the seller being paid', value: s.workPassesToPaidSec, limit: l.workPassesToPaidSec, where: ['Settlement time, from the decision that the work passed to the payment.'], cause: 'Guess: the chain or the adjudicator was slow to act on the decision.', owner: 'the operators or the adjudicator' });
  for (const st of ev.filter((e) => e.kind === 'stall')) {
    const b = blame(String(st.call ?? ''), String(st.error ?? ''));
    out.push({ measure: `a stall (${AGENT_NAME[st.role as Side] ?? st.role}: ${st.reason})`, value: 1, limit: 0, where: [st.call ? `The call: ${cut(String(st.call), 400)}` : `It was trying: ${cut(String(st.trying ?? ''), 400)}`, ...(st.error ? [`The error, as the agent saw it: ${cut(String(st.error), 800)}`] : [])], ...(st.call ? b : { cause: 'Guess: the agent ran out of turns or tokens before it finished; see what it was trying above.', owner: 'the docs or the brief' }) });
  }
  if (s.humanInterventions > 0) out.push({ measure: 'human interventions', value: s.humanInterventions, limit: 0, where: ['A person acted during the run.'], cause: 'Not a guess: nothing in a duet run should need a person.', owner: 'the runner (tools/duet)' });
  if (s.forbiddenTerms.funded || s.forbiddenTerms.askedToApprove) out.push({ measure: "agreeing to terms the company's brief forbade", value: 1, limit: 0, where: [s.forbiddenTerms.detail], cause: s.forbiddenTerms.funded ? "Guess: the agent did not compare the offer with its brief; the docs' section on checking an offer may not say to." : "Guess: the agent asked to approve without checking the offer against its brief; the company's policy stopped it. The docs' section on checking an offer may not say what to compare.", owner: 'the docs, or the brief (tools/duet/scenarios.ts)' });
  if (!s.decisionRight) out.push({ measure: 'the right decision for the scenario', value: 1, limit: 0, where: [s.why], cause: 'Guess: see the stalls and the steps above; the deal stopped before it could end as the scenario says.', owner: 'decided by reading the replay' });
  return out;
}

export function ticket(s: Summary, over: readonly Over[], paths: { record: string; replay: string }): string {
  const model = (r: Side) => `${s.models[r].vendor} ${s.models[r].model}`;
  return [
    `# Duet ticket: ${s.scenario}, ${over.length} ${over.length === 1 ? 'measure' : 'measures'} over the limit`,
    '',
    `- Scenario: ${s.scenario} (${s.title}). Expected: ${s.expect}`,
    `- Buyer: ${model('buyer')}. Seller: ${model('seller')}.`,
    `- Engine: ${s.engine}.`,
    `- Outcome: ${s.outcome.state}; ${s.decisionRight ? 'the right decision' : 'not the right decision'} (${s.why}).`,
    `- Record: ${paths.record}`,
    `- Replay: ${paths.replay}`,
    '',
    ...over.flatMap((o, i) => [
      `## ${i + 1}. ${o.measure}: ${n(o.value)}, limit ${n(o.limit)}`,
      '',
      ...o.where.map((w) => `- ${w}`),
      `- Likely cause: ${o.cause}`,
      `- Proposed owner: ${o.owner}.`,
      '',
    ]),
    'The limits are provisional, set from the first live baseline (tools/duet/limits.json). Send this ticket to the coordinator, who routes each item to whoever should fix it.',
    '',
  ].join('\n');
}
