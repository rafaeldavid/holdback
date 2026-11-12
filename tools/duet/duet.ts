#!/usr/bin/env node
// pnpm duet (T-391): one deal between two model-driven agents from two vendors, who meet only through Crow, with a
// record anyone can replay. Test tokens only: SimChain locally, or a testnet world named by its operators.
//
//   pnpm duet list [--scenario <name>] [--buyer <vendor>] [--seller <vendor>]     what would run and what it may cost; sends nothing
//   pnpm duet run --scenario paid|refund|bad-offer|late-offer --buyer claude|deepseek|scripted --seller claude|deepseek|scripted
//                 [--brief guided|direct] [--buyer-model <id>] [--seller-model <id>] [--max-turns 60] [--max-tokens 3000000]
//                 [--world <operator URL>,<operator URL>] [--docs <guide URL>,<sell URL>] [--out <dir>] [--grace 90] [--timeout 1800]
//   pnpm duet replay <run folder>                                                 the summary and the page again, from record.jsonl
//   pnpm duet publish <run folder> [--to <file>]                                  the page for crow.direct/demo, into site/demo/index.html
//
// A live side reads the agents' own key from the environment, never the live judges': HOLDBACK_AGENT_ANTHROPIC_API_KEY for
// claude, HOLDBACK_AGENT_OPENAI_COMPATIBLE_API_KEY and HOLDBACK_AGENT_OPENAI_COMPATIBLE_BASE_URL (https) for deepseek.
// Give them with node's --env-file:
//   node --env-file=<your env file> tools/duet/duet.ts run --buyer deepseek --seller claude --scenario paid
// --brief picks what the company tells its agent: guided (the default) names Crow's guides and how to use them; direct
// gives only the intent, the limits and the company's own setup, and says "through crow.direct", so the agent finds
// the guides from the front door. A local run answers crow.direct from this machine's copy of the site.
// Before a live run sends anything it prints the two models, the caps and the most the run can cost at list prices,
// then waits 10 s (Ctrl-C stops it). A missing key stops it with one line, before anything is sent.
// Exit code: 0 when the run ended as the scenario says, 1 when it did not, 2 when it could not start.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { inputPrice, measure } from './measures.ts';
import { replayPage } from './replay.ts';
import { JUDGE_KEY_ENV, KEY_ENV, liveProvider, MAX_OUTPUT_TOKENS, pinnedModel, type Provider } from './providers.ts';
import type { Event } from './record.ts';
import { finish, REPO, runDuet, type Side } from './run.ts';
import { AGENT_NAME, type BriefMode } from './scenarios.ts';
import { SCENARIOS, scenario, type ScenarioName } from './scenarios.ts';

const argv = process.argv.slice(2);
const flag = (name: string, fallback?: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback; };
const fail = (line: string): never => { console.error(`duet: ${line}`); process.exit(2); };
const usd = (micro: number) => `USD ${(micro / 1_000_000).toFixed(2)}`;
const vendorOf = (v: string): 'anthropic' | 'deepseek' | 'scripted' => (v === 'claude' || v === 'anthropic' ? 'anthropic' : v === 'deepseek' ? 'deepseek' : v === 'scripted' ? 'scripted' : fail(`${v} is not a vendor: claude, deepseek or scripted`));

const cmd = argv[0];
if (cmd === 'publish') {
  // The page for crow.direct/demo, from one run's record: written to site/demo/index.html, which site/build.mjs publishes.
  const dir = resolve(argv[1] ?? fail('publish takes the run folder whose record the page shows'));
  const events = readFileSync(join(dir, 'record.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Event);
  const to = resolve(flag('to', join(REPO, 'site', 'demo', 'index.html'))!);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, replayPage(events, measure(events), { publish: true }));
  console.log(`Wrote ${to} from ${join(dir, 'record.jsonl')}. node site/build.mjs publishes it at /demo/.`);
  process.exit(0);
}
if (cmd === 'replay') {
  const dir = resolve(argv[1] ?? fail('replay takes the run folder'));
  const events = readFileSync(join(dir, 'record.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Event);
  const done = finish(dir, events);
  console.log(`Wrote ${join(dir, 'summary.json')} and ${done.page}.`);
  if (done.ticket) console.log(`Ticket: ${done.ticket}\nSend this ticket to the coordinator.`);
  process.exit(0);
}
if (cmd !== 'run' && cmd !== 'list') fail('usage: duet list | publish <run folder> | run --scenario <paid|refund|bad-offer|late-offer> --buyer <claude|deepseek|scripted> --seller <…> | replay <run folder>');

const caps = { turns: Number(flag('max-turns', '60')), tokens: Number(flag('max-tokens', '3000000')) };
if (!Number.isSafeInteger(caps.turns) || caps.turns < 1 || !Number.isSafeInteger(caps.tokens) || caps.tokens < 1) fail('--max-turns and --max-tokens are whole numbers above 0');
const scenarios: ScenarioName[] = flag('scenario') ? [flag('scenario') as ScenarioName] : cmd === 'list' ? [...SCENARIOS] : fail('run needs --scenario paid, refund, bad-offer or late-offer');
for (const s of scenarios) if (!SCENARIOS.includes(s)) fail(`${s} is not a scenario: ${SCENARIOS.join(', ')}`);
const sides = { buyer: vendorOf(flag('buyer', cmd === 'list' ? 'deepseek' : undefined) ?? fail('run needs --buyer claude, deepseek or scripted')), seller: vendorOf(flag('seller', cmd === 'list' ? 'claude' : undefined) ?? fail('run needs --seller claude, deepseek or scripted')) };
const pinned = (v: 'anthropic' | 'deepseek', id: string | undefined) => { try { return pinnedModel(v, id); } catch (e) { return fail((e as Error).message); } };
const models = { buyer: sides.buyer === 'scripted' ? null : pinned(sides.buyer, flag('buyer-model')), seller: sides.seller === 'scripted' ? null : pinned(sides.seller, flag('seller-model')) };
const brief = flag('brief', 'guided') as BriefMode;
if (brief !== 'guided' && brief !== 'direct') fail('--brief is guided or direct');
const graceSec = Number(flag('grace', '90')), timeoutSec = Number(flag('timeout', '1800'));
if (!Number.isSafeInteger(graceSec) || graceSec < 0 || !Number.isSafeInteger(timeoutSec) || timeoutSec < 1) fail('--grace and --timeout are whole seconds');

/** The most one agent can cost: every capped token at the dearest input price (a cache write), plus every turn's output cap at the output price. */
const ceiling = (model: string | undefined) => {
  const p = model ? inputPrice(model) : null;
  return p ? Math.round((caps.tokens * p.input + caps.turns * MAX_OUTPUT_TOKENS * p.output) / 1_000_000) : 0;
};
const plan = () => {
  const lines = (['buyer', 'seller'] as const).map((r) => `  ${`${AGENT_NAME[r]} (${r})`.padEnd(38)} ${sides[r] === 'scripted' ? 'scripted (no model, no key)' : `${sides[r]} ${models[r]!.model}, key ${KEY_ENV[sides[r] as 'anthropic' | 'deepseek']}`}`);
  const total = ceiling(models.buyer?.id) + ceiling(models.seller?.id);
  return [
    `Duet: ${scenarios.map((s) => `${s} (${scenario(s).expect})`).join('\n       ')}`,
    ...lines,
    `  caps   ${caps.turns} turns and ${caps.tokens.toLocaleString('en-US')} tokens per agent, ${MAX_OUTPUT_TOKENS} output tokens per turn`,
    `  cost   at most ${usd(total)} per run at list prices (config/model-prices.json): each agent's token cap at its dearest input price (a cache write) plus every turn's output cap at its output price; the loop stops before a turn that would pass the token cap`,
    `  engine ${flag('world') ? `the running world at ${flag('world')}` : 'the local simulator, phase-one rules (SimChain, test tokens), started in this process'}`,
  ].join('\n');
};

console.log(plan());
if (cmd === 'list') { console.log('Nothing was sent.'); process.exit(0); }

const env = process.env;
const live: Record<'buyer' | 'seller', Side> = { buyer: 'scripted', seller: 'scripted' };
const secrets: string[] = [];
for (const r of ['buyer', 'seller'] as const) {
  if (sides[r] === 'scripted') continue;
  const p = liveProvider(sides[r] as 'anthropic' | 'deepseek', models[r]!.model, env);
  if (typeof p === 'string') fail(p);
  live[r] = p as Provider;
}
for (const k of [...Object.values(KEY_ENV), ...JUDGE_KEY_ENV]) if (env[k]) secrets.push(env[k]!); // scrubbed wherever they might appear
if (live.buyer !== 'scripted' || live.seller !== 'scripted') {
  console.log('Sending starts in 10 s. Ctrl-C stops it.');
  await new Promise((r) => setTimeout(r, 10_000));
  // The key check: one smallest request for each live side, before the world starts. A key the vendor refuses (not
  // scoped to a workspace, revoked, out of credit) stops the run here, with nothing else sent.
  for (const r of ['buyer', 'seller'] as const) {
    const p = live[r];
    if (p === 'scripted') continue;
    try { await p.ping(AbortSignal.timeout(60_000)); } catch (e) { fail(`the ${AGENT_NAME[r]} cannot start: ${p.vendor} refused its key check (${(e as Error).message}). Nothing else was sent.`); }
  }
  console.log('Both keys work.');
}
const world = flag('world')?.split(',').filter(Boolean);
const docs = flag('docs')?.split(',');
if (world && world.length < 2) fail('--world takes two or more operator URLs, comma-separated');
if (docs && docs.length !== 2) fail('--docs takes the guide URL and the seller page URL, comma-separated');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, 'Z');
const out = resolve(flag('out', join(REPO, 'reports', 'scratch', 'duet'))!, `${scenarios[0]}-${sides.buyer}-${sides.seller}-${stamp}`);
try {
  const r = await runDuet({ scenario: scenarios[0]!, buyer: live.buyer, seller: live.seller, out, caps, brief, ...(world ? { world } : {}), ...(docs ? { docs: { guide: docs[0]!, sell: docs[1]! } } : {}), graceSec, timeoutSec, secrets, log: (l) => console.log(l) });
  const s = r.summary;
  if (s.notStarted) {
    console.log(`\nThe run did not start: the ${AGENT_NAME[s.notStarted.role as 'buyer' | 'seller'] ?? s.notStarted.role}'s model provider refused its first request (${s.notStarted.reason}). No ticket: there was no deal to measure.\n  record  ${r.record}\n  replay  ${r.page}`);
    process.exit(2);
  }
  console.log(`\n${s.decisionRight ? 'As expected' : 'Not as expected'}: ${s.why}.`);
  const k = (x: number) => x.toLocaleString('en-US');
  const cost = s.costPerDealMicroUsd === null ? 'not priced (scripted)' : `USD ${(s.costPerDealMicroUsd / 1e6).toFixed(2)} at list price`;
  console.log(`  brief ${s.brief}; ${s.engine}`);
  console.log(`  tokens ${k(s.tokens.deal)}: ${k(s.tokens.split.fresh)} fresh input, ${k(s.tokens.split.cacheRead)} cache reads, ${k(s.tokens.split.cacheWrite)} cache writes, ${k(s.tokens.split.output)} output; ${cost}; peak context ${k(s.peakContext.buyer)} (buyer), ${k(s.peakContext.seller)} (seller)`);
  console.log(`  deal ${s.outcome.commitmentId ?? 'none'}, ${s.outcome.state}; stalls ${s.stalls.length}; human interventions ${s.humanInterventions}; approvals by the buyer's standing rule ${s.ownerApprovals.length}`);
  console.log(`  record  ${r.record}\n  summary ${join(r.dir, 'summary.json')}\n  replay  ${r.page}`);
  if (r.ticket) console.log(`\n${r.over.length} ${r.over.length === 1 ? 'measure was' : 'measures were'} over the limit: ${r.over.map((x) => x.measure).join('; ')}.\nTicket: ${r.ticket}\nSend this ticket to the coordinator.`);
  else console.log('  Every measure is within its limit; no ticket.');
  process.exit(s.decisionRight ? 0 : 1);
} catch (e) {
  fail((e as Error).message);
}
