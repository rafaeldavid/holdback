// One duet run (T-391): a world, two agents that meet only through Crow, the record, the summary and the replay.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { runAgent, type AgentEnd, type Caps } from './loop.ts';
import { measure, type Summary } from './measures.ts';
import { scripted, type Provider } from './providers.ts';
import { Recorder, Secrets } from './record.ts';
import { replayPage } from './replay.ts';
import { AGENT_NAME, buyerBrief, ITEM, scenario, SCOPE, sellerBrief, type ScenarioName } from './scenarios.ts';
import { limitsFor, overLimits, ticket, type Limits, type Over } from './tickets.ts';
import type { Event } from './record.ts';
import { buyerScript, sellerScript } from './scripted.ts';
import { Toolbox, type Allow } from './tools.ts';
import { startWorld } from './world.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const REPO = realpathSync(new URL('../../', import.meta.url).pathname);
const SELLER_NAME = 'audit-reports';

/** A side's model: a live provider, or `scripted`, which plays the scenario's fixed calls. */
export type Side = Provider | 'scripted';

export interface RunOptions {
  scenario: ScenarioName;
  buyer: Side;
  seller: Side;
  /** Where the run's folder goes: the record, the summary, the page, and the agents' and companies' folders. */
  out: string;
  caps: Caps;
  /** Operators of a running world; left out, a local phase-one world starts in this process. */
  world?: string[];
  docs?: { guide: string; sell: string };
  /** Seconds the other agent may go on after one finishes. Default 90. */
  graceSec?: number;
  /** The whole run's limit in seconds. Default 1,800. */
  timeoutSec?: number;
  /** Command time limits in ms: quotes and checks, and the funded watch. */
  commandTimeoutMs?: { short: number; long: number };
  /** Secrets to scrub everywhere besides those the run makes: the model API keys. */
  secrets?: string[];
  /** Limits in place of limits.json's for this scenario (the tests set one low to see a ticket). */
  limits?: Partial<Limits>;
  log?: (line: string) => void;
}

export interface RunResult {
  dir: string;
  record: string;
  summary: Summary;
  page: string;
  ends: AgentEnd[];
  /** Whether any secret the run knew (keys, the world's secret, the model keys) appears in a text: for the tests' final scan. */
  leaks(text: string): boolean;
  /** The measures over their limits, and the ticket written for them (null when none was over). */
  over: Over[];
  ticket: string | null;
}

/**
 * The run's summary, its limits and the replay page, all from the record alone: what `run` writes at the end and
 * `replay` writes again. A measure over its limit, or a stalled agent, writes ticket.md beside the record.
 */
export function finish(dir: string, events: readonly Event[], limits?: Partial<Limits>): { summary: Summary; over: Over[]; ticket: string | null; page: string } {
  const summary = measure(events);
  const over = overLimits(summary, events, { ...limitsFor(summary.scenario), ...limits });
  const record = join(dir, 'record.jsonl');
  const page = join(dir, 'replay.html');
  const ticketPath = over.length ? join(dir, 'ticket.md') : null;
  if (ticketPath) writeFileSync(ticketPath, ticket(summary, over, { record, replay: page }));
  const withLimits = { ...summary, limits: summary.notStarted ? { within: null, note: `The run did not start (the ${summary.notStarted.role}'s model provider refused its first request), so it was not measured against its limits.` } : over.length ? { within: false, over: over.map((x) => ({ measure: x.measure, value: x.value, limit: x.limit })), ticket: ticketPath } : { within: true, note: 'Every measure is within its limit (tools/duet/limits.json).' } };
  writeFileSync(join(dir, 'summary.json'), `${JSON.stringify(withLimits, null, 2)}\n`);
  writeFileSync(page, replayPage(events, summary, { over, ticket: ticketPath }));
  return { summary, over, ticket: ticketPath, page };
}

const freePort = (): Promise<number> =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });

const originOf = (u: string) => new URL(u).origin;

function checkout(): { commit: string; dirty: boolean } {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'examples', 'apps', 'packages'], { cwd: REPO, encoding: 'utf8' }).trim() !== '';
    return { commit, dirty };
  } catch {
    return { commit: 'unknown', dirty: true };
  }
}

export async function runDuet(o: RunOptions): Promise<RunResult> {
  const say = o.log ?? (() => undefined);
  const s = scenario(o.scenario);
  const dir = o.out;
  const paths = {
    buyerWork: join(dir, 'buyer', 'work'),
    buyerCompany: join(dir, 'buyer', 'company'),
    sellerWork: join(dir, 'seller', 'work'),
    sellerCompany: join(dir, 'seller', 'company'),
  };
  for (const p of Object.values(paths)) mkdirSync(p, { recursive: true, mode: 0o700 });
  mkdirSync(join(paths.sellerWork, 'public'), { recursive: true });
  const real = Object.fromEntries(Object.entries(paths).map(([k, v]) => [k, realpathSync(v)])) as typeof paths;
  const keyStore = join(real.buyerCompany, 'keys');

  const secrets = new Secrets();
  for (const v of o.secrets ?? []) secrets.add(v);
  const sellerKey = `0x${randomBytes(32).toString('hex')}`;
  secrets.add(sellerKey);
  const rec = new Recorder(join(dir, 'record.jsonl'), secrets);
  const vendorOf = (x: Side) => (x === 'scripted' ? { vendor: 'scripted', model: 'scripted' } : { vendor: x.vendor, model: x.model });
  rec.add('runner', 'run.start', { scenario: s.name, title: s.title, expect: s.expect, endState: s.endState, buyer: vendorOf(o.buyer), seller: vendorOf(o.seller), caps: o.caps, world: o.world ? 'running' : 'local phase-one world', checkout: checkout(), policy: s.policy, scope: SCOPE, item: ITEM, sellerRule: s.sellerRule ?? null, sellerRulePlain: s.sellerRulePlain ?? null, buyerRule: s.buyerRule ?? null, note: s.note ?? null, engine: o.world ? `the running world at ${o.world.join(', ')} (its chain is named in the next line)` : 'the local simulator, phase-one rules' });

  say(`Starting ${o.world ? `against ${o.world.join(', ')}` : 'the local phase-one world'}.`);
  const world = await startWorld({ rec, ...(o.world ? { world: o.world } : {}), ...(o.docs ? { docs: o.docs } : {}), sellerPublic: join(real.sellerWork, 'public'), sellerName: SELLER_NAME, report: s.report, onSecret: (v) => secrets.add(v) });
  let ends: AgentEnd[] = [];
  try {
    const adapterPort = await freePort();
    const sellerPage = `${world.web}/sellers/${SELLER_NAME}/`;
    const adapter = `http://127.0.0.1:${adapterPort}`;
    rec.add('runner', 'world', { engine: world.engine, docsChanges: world.docsChanges, local: world.local, chainId: world.chainId, token: world.token, operators: world.operators, docs: world.docs, sellerPage, jobApi: world.jobApi.api, adapter });

    const ops: Allow[] = world.operators.map((u) => ({ origin: originOf(u) }));
    const problems: Allow = { origin: 'https://crow.direct', paths: ['/problems/'] };
    const docAllow = (d: { guide: string; sell: string; buy: string }): Allow[] => [...[d.guide, d.sell, d.buy].map((u) => ({ origin: originOf(u), paths: [new URL(u).pathname] })), { origin: originOf(d.guide), paths: [new URL('ref/', d.guide).pathname] }];
    const page: Allow = { origin: originOf(world.web), paths: [`/sellers/${SELLER_NAME}/`] };
    const buyerAllow: Allow[] = [...ops, ...docAllow(world.docs), page, { origin: adapter, paths: ['/defaults', '/quote'] }, problems];
    const sellerAllow: Allow[] = [...ops, ...docAllow(world.docs), page, { origin: originOf(world.jobApi.url) }, { origin: adapter, paths: ['/defaults', '/quote'] }, problems];

    const timeouts = o.commandTimeoutMs ?? { short: 180_000, long: 1_200_000 };
    const stops = { buyer: new AbortController(), seller: new AbortController() };
    const buyerTools = new Toolbox({ signal: stops.buyer.signal, role: 'buyer', work: real.buyerWork, owner: real.buyerCompany, repo: REPO, operators: world.operators, allow: buyerAllow, secrets, rec, keyStore, policy: s.policy, timeoutMs: timeouts });
    const sellerTools = new Toolbox({ signal: stops.seller.signal, role: 'seller', work: real.sellerWork, owner: real.sellerCompany, repo: REPO, operators: world.operators, allow: sellerAllow, secrets, rec, sellerKey, adapterPort, jobApi: world.jobApi.url, timeoutMs: timeouts });
    const facts = () => ({ docs: world.docs, sellerPage, jobApi: world.jobApi.api, adapterPort, keyStore, token: world.token, local: world.local });
    const briefs = { buyer: buyerBrief(s, facts()), seller: sellerBrief(s, facts()) };
    const scriptFacts = () => ({ docs: world.docs, sellerPage, jobApi: { ...world.jobApi.api, url: world.jobApi.url }, adapterPort, keyStore, operator: world.operators[0]! });
    const providerOf = (role: 'buyer' | 'seller', side: Side): Provider => (side !== 'scripted' ? side : scripted(role === 'buyer' ? buyerScript(s.name, scriptFacts()) : sellerScript(s.name, scriptFacts())));

    // Both agents run at once. When one finishes, the other has graceSec more; the whole run has timeoutSec.
    const whole = setTimeout(() => { for (const c of Object.values(stops)) c.abort(`the run's limit of ${o.timeoutSec ?? 1800} s`); }, (o.timeoutSec ?? 1800) * 1000);
    const grace = (other: 'buyer' | 'seller') => setTimeout(() => stops[other].abort(`its counterparty finished ${o.graceSec ?? 90} s earlier`), (o.graceSec ?? 90) * 1000);
    const timers: NodeJS.Timeout[] = [];
    const play = (role: 'buyer' | 'seller', tools: Toolbox) =>
      runAgent({ role, provider: providerOf(role, role === 'buyer' ? o.buyer : o.seller), brief: briefs[role], tools, caps: o.caps, rec, signal: stops[role].signal }).then((end) => {
        say(`The ${AGENT_NAME[role]} ${end.status}: ${end.outcome}`);
        const other = role === 'buyer' ? 'seller' : 'buyer';
        if (end.status === 'error' && !end.started) {
          // One side never took a turn: there is no deal to watch, so the other stops now, with no grace, and the run
          // is marked as not started. Nothing it did after this point is a finding about the docs or the tools.
          rec.add('runner', 'run.not-started', { role, reason: end.outcome });
          stops[other].abort(`the ${AGENT_NAME[role]} could not start`);
        } else timers.push(grace(other));
        return end;
      });
    say('Both agents start.');

    try {
      ends = await Promise.all([play('seller', sellerTools), play('buyer', buyerTools)]);
    } finally {
      for (const c of Object.values(stops)) if (!c.signal.aborted) c.abort('the run ended'); // ends any command still running
      clearTimeout(whole);
      for (const t of timers) clearTimeout(t);
      await sellerTools.close();
    }

    // The chain's own account of each deal either side opened: state and events from every operator. The seller's
    // journal is in the seller agent's folder, so its IDs are only candidates: a deal counts only when its terms name
    // this run's buyer (a key in the company's key store) or this run's seller (the address its adapter logged at start).
    const ids = new Set<string>();
    const hex = (v: unknown) => (typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v) ? v.toLowerCase() : undefined);
    const journal = join(real.sellerWork, 'seller-adapter.journal.json');
    try { if (existsSync(journal)) for (const id of Object.keys(JSON.parse(readFileSync(journal, 'utf8'))?.deals ?? {})) { const h = hex(id); if (h) ids.add(h); } } catch { rec.add('runner', 'chain.error', { error: 'the seller adapter journal is not JSON' }); }
    const buyers = new Set<string>();
    if (existsSync(keyStore)) for (const n of readdirSync(keyStore)) if (/^0x[0-9a-f]{40}\.json$/.test(n)) { buyers.add(n.slice(0, 42)); const h = hex(JSON.parse(readFileSync(join(keyStore, n), 'utf8'))?.commitmentId); if (h) ids.add(h); }
    const sellerAddress = rec.events.filter((e) => e.kind === 'adapter.start').flatMap((e) => (e['lines'] as string[] | undefined) ?? []).map((l) => /Seller adapter for (0x[0-9a-fA-F]{40})/.exec(l)?.[1]?.toLowerCase()).find(Boolean);
    const tx = (h: string) => (world.chainId === 11155111 ? `https://sepolia.etherscan.io/tx/${h}` : null);
    for (const id of ids) {
      for (const op of world.operators) {
        try {
          const st: J = await (await fetch(`${op}/v1/commitments/${id}`, { signal: AbortSignal.timeout(30_000) })).json();
          const tr: J = await (await fetch(`${op}/v1/commitments/${id}/terms`, { signal: AbortSignal.timeout(30_000) })).json().catch(() => ({}));
          const terms = tr?.terms ?? tr;
          const addr = (p: J) => (String(p?.address ?? p ?? '').toLowerCase().match(/^0x[0-9a-f]{40}$/)?.[0] ?? null);
          const ours = (addr(terms?.buyer) !== null && buyers.has(addr(terms?.buyer)!)) || (sellerAddress !== undefined && addr(terms?.seller) === sellerAddress);
          if (!ours) { rec.add('runner', 'chain.skipped', { commitmentId: id, reason: "its terms name neither this run's buyer nor this run's seller" }); break; }
          rec.add('runner', 'chain.state', { commitmentId: id, operator: op, escrowState: st?.escrowState ?? null, price: terms?.price ?? null, buyer: addr(terms?.buyer), seller: addr(terms?.seller), finalAt: st?.finalAt ?? null });
          if (op !== world.operators[0]) continue;
          const ev: J = await (await fetch(`${op}/v1/commitments/${id}/events?limit=200`, { signal: AbortSignal.timeout(30_000) })).json();
          const items: J[] = Array.isArray(ev?.items) ? [...ev.items].sort((a, b) => a.seq - b.seq) : [];
          for (const e of items) rec.add('runner', 'chain.event', { commitmentId: id, seq: e.seq, type: e.type, at: e.at, actor: e.actor ?? null, tx: e.payload?.tx ?? null, link: e.payload?.tx ? tx(e.payload.tx) : null, amount: e.payload?.amount ?? e.payload?.price ?? null, recipient: e.payload?.recipient ?? null, outcome: e.payload?.outcome ?? e.payload?.decision ?? null });
        } catch (e) {
          rec.add('runner', 'chain.error', { commitmentId: id, operator: op, error: (e as Error).message });
        }
      }
    }
  } finally {
    await world.close();
  }
  rec.add('runner', 'run.end', { ends: ends.map((e) => ({ role: e.role, status: e.status, outcome: e.outcome })) });
  const done = finish(dir, rec.events, o.limits);
  return { dir, record: rec.file, summary: done.summary, page: done.page, ends, leaks: (text) => secrets.leaks(text), over: done.over, ticket: done.ticket };
}
