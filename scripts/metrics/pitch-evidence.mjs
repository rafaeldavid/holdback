#!/usr/bin/env node
// pitch-evidence.mjs (T-425): three measurements for the machine-first pitch, each rerunnable by one command.
//
//   deals   20 live test deals on Sepolia, one at a time, the way the published try command runs them
//           (examples/try.ts --seller <Crow's test seller>): fresh keys in memory, test tUSDC from the open faucet.
//           Each deal is timed from the operator's own events. Test tokens only; the operators pay the gas.
//   direct  On a local anvil chain only: a deal funded and delivered through the operators, both operators stopped,
//           then finished by calling HoldbackRules directly. Times the direct part (tests/metrics/pitch-evidence-direct).
//   leak    On a local anvil chain only: what the holder of a leaked buyer or seller key can and cannot do at each
//           stage, and the largest loss in token units (tests/metrics/pitch-evidence-leak).
//
// Each writes one JSON record with --out and prints a short table. Nothing here is real money.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT, gitCommit, isMain, iso, writeJson } from './lib.mjs';

export const SCHEMA = 'crow.metrics.pitch-evidence/1';
export const SCRIPT = 'scripts/metrics/pitch-evidence.mjs';
export const OPERATORS = ['https://api.crow.direct', 'https://api2.crow.direct'];
export const TEST_SELLER = 'https://crow.direct/agents/test-seller';
export const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
/**
 * Crow Control's low mark for the relayer's funding lane, in wei: 0.3 Sepolia ETH. It is set, marked guessed, in the
 * console's wallet list in the private repository (`control/wallets.json`, `funding-lane`); pass --low-eth to change it.
 */
export const FUNDING_LANE_LOW_WEI = 300_000_000_000_000_000n;
/** Gas one test deal costs the relayer on Sepolia: 1.56 million (LANE_FLOOR's note in apps/demo-cloud/src/world.ts, measured there). */
export const GAS_PER_DEAL = 1_560_000n;
/** The tip the operators' lanes assume on top of the base fee, in wei: 1 gwei (the same note). */
export const TIP_WEI = 1_000_000_000n;
/** The deal of 2026-11-14 10:49 UTC that took 33 s from offer to payment (the pitch note's "test deal"). */
export const MORNING_DEAL_MS = 33_000;
/** How long one try run may take before the series stops it: try itself waits up to 3 min for the outcome. */
export const DEAL_TIMEOUT_MS = 6 * 60_000;

const HELP = `pitch-evidence: three measurements for the machine-first pitch (T-425). Test tokens only.

usage:
  node scripts/metrics/pitch-evidence.mjs deals  [--count 20] [--out <file>] [--seller <url>] [--low-eth 0.3] [--check-only]
  node scripts/metrics/pitch-evidence.mjs direct [--out <file>]     local anvil only
  node scripts/metrics/pitch-evidence.mjs leak   [--out <file>]     local anvil only
  node scripts/metrics/pitch-evidence.mjs show   <file>             print a record's tables again

deals   runs test deals one after another against the live test service on Sepolia, as the published try command
        does (examples/try.ts --seller ${TEST_SELLER}). It first reads the relayer's test ETH and stops if the deals
        would take the funding lane below --low-eth (default 0.3 ETH, Crow Control's low mark). It stops the series at the first failed deal or any 429, except
        a faucet refusal, which it waits out as the faucet's answer says. --check-only reads the balances and stops.
direct  needs anvil on PATH and forge build output in contracts/out (cd contracts && forge build).
leak    the same.

example: node scripts/metrics/pitch-evidence.mjs deals --count 20 --out reports/scratch/t-425/deals.json`;

// ---------------------------------------------------------------------------------------------------------------
// Pure parts (tested in tests/metrics/pitch-evidence.test.ts)

/** The moments of one deal: the first event of each type, as the operators record it. */
export const MOMENTS = {
  offered: ['commitment.offered'],
  funded: ['hold.funded'],
  delivered: ['delivery.submitted'],
  paid: ['settlement.released', 'settlement.refunded'],
};

/** The four intervals the pitch quotes, each from one moment to another. */
export const INTERVALS = [
  { id: 'offerToFunding', from: 'offered', to: 'funded', label: 'offer to funding' },
  { id: 'fundingToDelivery', from: 'funded', to: 'delivered', label: 'funding to delivery' },
  { id: 'deliveryToPayment', from: 'delivered', to: 'paid', label: 'delivery to payment' },
  { id: 'offerToPayment', from: 'offered', to: 'paid', label: 'offer to payment' },
];

/**
 * One deal's timing from its events (any order). Each moment is its first event's `at`; an on-chain moment also
 * keeps its block and transaction. Returns null for a moment that is missing, and null for an interval that needs it.
 */
export function dealTiming(events) {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const moments = {};
  for (const [name, types] of Object.entries(MOMENTS)) {
    const e = sorted.find((x) => types.includes(x.type));
    moments[name] = e ? { at: e.at, type: e.type, ...(e.payload?.tx ? { tx: e.payload.tx } : {}), ...(e.payload?.block ? { block: String(e.payload.block) } : {}) } : null;
  }
  const ms = {};
  for (const i of INTERVALS) {
    const a = moments[i.from], b = moments[i.to];
    ms[i.id] = a && b ? Date.parse(b.at) - Date.parse(a.at) : null;
  }
  const txs = [...new Set(sorted.map((e) => e.payload?.tx).filter((t) => typeof t === 'string'))];
  const gas = sorted.filter((e) => typeof e.payload?.gasUsed === 'string' && e.payload?.tx).reduce((m, e) => m.set(e.payload.tx, BigInt(e.payload.gasUsed)), new Map());
  return { moments, ms, transactions: txs.length, gasUsed: gas.size ? [...gas.values()].reduce((s, g) => s + g, 0n).toString() : null };
}

/** Median (the mean of the two middle values for an even count, rounded down to the millisecond), minimum, maximum, count. */
export function stats(values) {
  const s = values.filter((v) => Number.isSafeInteger(v)).sort((a, b) => a - b);
  if (!s.length) return { count: 0, medianMs: null, minMs: null, maxMs: null };
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 ? s[mid] : Math.floor((s[mid - 1] + s[mid]) / 2);
  return { count: s.length, medianMs: median, minMs: s[0], maxMs: s[s.length - 1] };
}

/** How many of `values` are below, equal to and above `x`: how typical one value is in the sample. */
export function rankOf(values, x) {
  const s = values.filter((v) => Number.isSafeInteger(v));
  return { below: s.filter((v) => v < x).length, equal: s.filter((v) => v === x).length, above: s.filter((v) => v > x).length };
}

/**
 * What try.ts printed: the commitment ID, the final state, whether Crow's test seller was the other party, the
 * step it stopped at and why, and whether any answer was a 429 (`rate_limited`) or the test seller was busy.
 */
export function parseTryOutput(stdout, stderr = '') {
  const done = /^done\s+commitment (0x[0-9a-f]{64}) (Released|Refunded)\s*$/m.exec(stdout);
  // try.ts's `short` prints 0x and 6 hex characters, three dots and the last 4.
  const id = done?.[1] ?? /^\S+\s+(0x[0-9a-f]{6}\.\.\.[0-9a-f]{4}) offered by the test seller/m.exec(stdout)?.[1] ?? null;
  const stop = /^(stopped|refused) at (\S+): (.*)$/m.exec(stderr);
  const final = /^final\s+(\w+) in (\d+) s (.*?);/m.exec(stdout);
  const unavailable = /^\S+\s+the test seller is unavailable: (.*)$/m.exec(stdout);
  const text = `${stdout}\n${stderr}`;
  return {
    commitmentId: done?.[1] ?? null,
    idPrefix: done ? null : id,
    state: done?.[2] ?? null,
    reportedSec: final ? Number(final[2]) : null,
    withTestSeller: /with Crow's test seller as the other party/.test(stdout),
    sellerUnavailable: unavailable ? unavailable[1] : null,
    stoppedAt: stop ? stop[2] : null,
    stopReason: stop ? stop[3] : null,
    refused: stop?.[1] === 'refused',
    rateLimited: /rate_limited|\b429\b|it is busy/.test(text),
  };
}

/** What to do after one try run: go on, wait out the faucet, or stop the series (one deal at a time, no retries around a failure). */
export function nextStep(parsed, exitCode, timedOut = false) {
  if (timedOut) return { action: 'stop', why: `try ran past ${DEAL_TIMEOUT_MS / 60_000} min and was stopped${parsed.stoppedAt ? ` at ${parsed.stoppedAt}` : ''}` };
  if (exitCode === 0 && parsed.commitmentId && parsed.state === 'Released' && parsed.withTestSeller && !parsed.rateLimited) return { action: 'next' };
  // Only the buyer's own grant: when the test seller was unavailable (a 429 or 503 there), try plays both sides and
  // asks the faucet for a second grant, and the series stops on the seller's answer instead.
  if (exitCode !== 0 && parsed.stoppedAt === 'faucet' && /rate_limited/.test(parsed.stopReason ?? '') && !parsed.sellerUnavailable) return { action: 'wait-faucet' };
  if (parsed.rateLimited) return { action: 'stop', why: `an answer was 429 or the test seller was busy${parsed.stopReason ? `: ${parsed.stopReason}` : parsed.sellerUnavailable ? `: ${parsed.sellerUnavailable}` : ''}` };
  if (exitCode === 0 && parsed.commitmentId && !parsed.withTestSeller) return { action: 'stop', why: `the deal ran with both sides played by the script, not with the test seller${parsed.sellerUnavailable ? ` (${parsed.sellerUnavailable})` : ''}` };
  return { action: 'stop', why: `try exited ${exitCode}${parsed.stoppedAt ? ` at ${parsed.stoppedAt}: ${parsed.stopReason}` : ''}${parsed.state && parsed.state !== 'Released' ? ` with ${parsed.state}` : ''}` };
}

/**
 * Whether `count` deals fit the relayer's test ETH: the funding lane, less the gas the deals need at the current gas
 * price plus the lanes' 1 gwei tip, must stay at or above its low mark. The deal lanes pay the gas but refill from the
 * funding lane and never pay back, so their balances are reported and not counted (the worst case: every deal's gas
 * comes from the funding lane).
 */
export function gasBudget({ fundingWei, laneWei, gasPriceWei, count, lowWei = FUNDING_LANE_LOW_WEI }) {
  const needWei = BigInt(count) * GAS_PER_DEAL * (BigInt(gasPriceWei) + TIP_WEI);
  const lanesWei = laneWei.reduce((s, w) => s + BigInt(w), 0n);
  const afterWei = BigInt(fundingWei) - needWei;
  return { ok: afterWei >= BigInt(lowWei), needWei: needWei.toString(), lanesWei: lanesWei.toString(), afterWei: afterWei.toString(), lowWei: BigInt(lowWei).toString() };
}

/** Wei as Sepolia ETH with 6 decimals, in integer arithmetic. */
export const eth = (wei) => {
  const v = BigInt(wei), neg = v < 0n, a = neg ? -v : v;
  return `${neg ? '-' : ''}${a / 10n ** 18n}.${((a % 10n ** 18n) / 10n ** 12n).toString().padStart(6, '0')}`;
};

/** Milliseconds as seconds with at most one decimal. */
export const sec = (ms) => (ms === null || ms === undefined ? 'missing' : `${Math.floor(ms / 1000)}${ms % 1000 ? `.${Math.floor((ms % 1000) / 100)}` : ''} s`);

/** The deals record's summary: per interval, the stats over the deals that completed, and how typical 33 s is. */
export function summarize(deals) {
  const ok = deals.filter((d) => d.outcome === 'Released' && d.timing);
  const intervals = Object.fromEntries(INTERVALS.map((i) => [i.id, stats(ok.map((d) => d.timing.ms[i.id]))]));
  const offerToPayment = ok.map((d) => d.timing.ms.offerToPayment);
  return { completed: ok.length, attempted: deals.length, intervals, wallMs: stats(ok.map((d) => d.wallMs)), morningDeal: { ms: MORNING_DEAL_MS, ...rankOf(offerToPayment, MORNING_DEAL_MS) } };
}

/** The tables a record prints, one per measurement. */
export function render(record) {
  const out = [];
  if (record.deals) {
    const s = record.deals.summary;
    out.push(`deals: ${s.completed} of ${s.attempted} completed${record.deals.stopped ? `; stopped: ${record.deals.stopped}` : ''}`);
    out.push('| Interval | Median | Minimum | Maximum | Deals |', '| --- | --- | --- | --- | --- |');
    for (const i of INTERVALS) {
      const x = s.intervals[i.id];
      out.push(`| ${i.label} | ${sec(x.medianMs)} | ${sec(x.minMs)} | ${sec(x.maxMs)} | ${x.count} |`);
    }
    out.push(`| wall time of the try run | ${sec(s.wallMs.medianMs)} | ${sec(s.wallMs.minMs)} | ${sec(s.wallMs.maxMs)} | ${s.wallMs.count} |`);
    out.push(`33 s offer to payment: ${s.morningDeal.below} deals faster, ${s.morningDeal.equal} equal, ${s.morningDeal.above} slower`);
  }
  if (record.direct) out.push(...(record.direct.lines ?? []));
  if (record.leak) out.push(...(record.leak.lines ?? []));
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Network and process parts

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (s) => console.log(`[${iso(Date.now())}] ${s}`);

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, retryAfter: res.headers.get('retry-after') };
}

async function rpc(method, params) {
  const r = await getJson(SEPOLIA_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (typeof r.body?.result !== 'string') throw new Error(`${method} on ${SEPOLIA_RPC} answered ${r.status}`);
  return BigInt(r.body.result);
}

/** The relayer's test ETH: the addresses from discovery, the balances and gas price from the public RPC. */
async function relayerBalances(count, lowWei) {
  const d = await getJson(`${OPERATORS[0]}/.well-known/holdback.json`);
  const relayer = d.body?.demo?.relayer;
  if (!relayer?.fundingLane || !Array.isArray(relayer.dealLanes)) throw new Error('discovery names no demo.relayer');
  const fundingWei = await rpc('eth_getBalance', [relayer.fundingLane, 'latest']);
  const laneWei = [];
  for (const a of relayer.dealLanes) laneWei.push(await rpc('eth_getBalance', [a, 'latest']));
  const gasPriceWei = await rpc('eth_gasPrice', []);
  return { relayer, faucet: d.body?.demo?.faucet ?? null, fundingWei: fundingWei.toString(), laneWei: laneWei.map(String), gasPriceWei: gasPriceWei.toString(), budget: gasBudget({ fundingWei, laneWei, gasPriceWei, count, lowWei }) };
}

/** Runs examples/try.ts once as the published command does, with a time limit. */
function runTry(seller) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [join(ROOT, 'examples/try.ts'), '--seller', seller], { cwd: ROOT, env: { ...process.env, HOLDBACK_OPERATORS: OPERATORS.join(',') } });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, DEAL_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, startedAt: started, wallMs: Date.now() - started, timedOut });
    });
  });
}

/**
 * A refused faucet probe from a fresh random address tells how long the client window has left, and grants nothing.
 * If the window has just reset, the probe is granted: 1,000 test tUSDC to an address nobody holds, one of the
 * client's grants and one relayer mint. The series then runs the deal at once.
 */
async function faucetWait() {
  const address = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(20))).toString('hex')}`;
  const r = await getJson(`${OPERATORS[0]}/v1/faucet`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ address }) });
  if (r.status === 429) return { sec: Number(r.body?.retryAfterSec ?? r.retryAfter ?? 600), detail: r.body?.detail ?? 'rate_limited' };
  return { sec: 0, detail: `the probe was granted (${r.status}): the window had reset` };
}

async function readEvents(id) {
  const answers = [];
  for (const op of OPERATORS) answers.push(await getJson(`${op}/v1/commitments/${id}/events?limit=200`));
  const [a, b] = answers;
  if (a.status !== 200 || !Array.isArray(a.body?.items)) throw new Error(`events of ${id} answered ${a.status}`);
  const same = b.status === 200 && JSON.stringify(a.body.items) === JSON.stringify(b.body?.items);
  return { items: a.body.items, operatorsAgree: same };
}

async function deals({ count, out, seller, checkOnly, lowWei }) {
  const record = {
    schema: SCHEMA, generatedAt: iso(Date.now()), generator: { script: SCRIPT, commit: gitCommit(ROOT) },
    deals: { operators: OPERATORS, seller, count, preflight: null, items: [], waits: [], stopped: null, summary: null },
  };
  const save = () => {
    record.deals.summary = summarize(record.deals.items);
    if (out) writeJson(out, record);
  };
  const pre = await relayerBalances(count, lowWei);
  record.deals.preflight = { readAt: iso(Date.now()), ...pre };
  say(`relayer funding lane ${pre.relayer.fundingLane}: ${eth(pre.fundingWei)} ETH; deal lanes ${pre.laneWei.map(eth).join(', ')} ETH; gas price ${pre.gasPriceWei} wei`);
  say(`${count} deals need at most ${eth(pre.budget.needWei)} ETH at ${GAS_PER_DEAL} gas a deal and a 1 gwei tip; the funding lane would keep ${eth(pre.budget.afterWei)} ETH, low mark ${eth(pre.budget.lowWei)} ETH`);
  if (!pre.budget.ok) {
    record.deals.stopped = 'the deals would take the relayer below its low mark';
    save();
    say(`stopped before the first deal: ${record.deals.stopped}`);
    return 1;
  }
  save();
  if (checkOnly) return 0;

  let waitsInSlot = 0;
  for (let n = 1; n <= count; ) {
    say(`deal ${n} of ${count}: node examples/try.ts --seller ${seller}`);
    const run = await runTry(seller);
    const parsed = parseTryOutput(run.stdout, run.stderr);
    const next = nextStep(parsed, run.code, run.timedOut);
    if (next.action === 'wait-faucet') {
      if (++waitsInSlot > 2) {
        record.deals.stopped = `the faucet refused deal ${n} three times`;
        break;
      }
      const w = await faucetWait();
      record.deals.waits.push({ beforeDeal: n, at: iso(Date.now()), sec: w.sec, detail: w.detail });
      save();
      say(`the faucet refused the grant (${parsed.stopReason}); waiting ${w.sec + 5} s as its answer says`);
      await sleep((w.sec + 5) * 1000);
      continue;
    }
    waitsInSlot = 0;
    const item = { n, startedAt: iso(run.startedAt), wallMs: run.wallMs, exitCode: run.code, commitmentId: parsed.commitmentId, outcome: parsed.state, reportedSec: parsed.reportedSec, withTestSeller: parsed.withTestSeller, timing: null, operatorsAgree: null };
    if (parsed.commitmentId) {
      try {
        const ev = await readEvents(parsed.commitmentId);
        item.timing = dealTiming(ev.items);
        item.operatorsAgree = ev.operatorsAgree;
      } catch (e) {
        item.eventsError = e.message;
      }
    }
    if (next.action === 'stop') {
      item.stoppedAt = parsed.stoppedAt;
      item.stopReason = parsed.stopReason;
      item.output = `${run.stdout}\n${run.stderr}`.slice(-4000);
      record.deals.items.push(item);
      record.deals.stopped = `deal ${n}: ${next.why}`;
      break;
    }
    record.deals.items.push(item);
    save();
    say(`deal ${n}: ${parsed.commitmentId} ${parsed.state}, offer to payment ${sec(item.timing?.ms.offerToPayment)}, wall ${sec(run.wallMs)}`);
    n++;
  }
  save();
  console.log(render(record));
  if (record.deals.stopped) say(`series stopped: ${record.deals.stopped}`);
  return record.deals.stopped ? 1 : 0;
}

/** direct and leak: the anvil tests write the record through PITCH_EVIDENCE_OUT. */
function local(kind, out) {
  if (!existsSync(join(ROOT, 'contracts/out/HoldbackRules.sol/HoldbackRules.json')) || spawnSync('anvil', ['--version']).status !== 0) {
    console.error(`${kind} needs anvil on PATH and forge build output in contracts/out: run (cd contracts && forge build) first`);
    return 2;
  }
  const file = `tests/metrics/pitch-evidence-${kind}.test.ts`;
  const target = out ?? join(ROOT, `reports/scratch/t-425/${kind}.json`);
  const r = spawnSync('pnpm', ['exec', 'vitest', 'run', file], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PITCH_EVIDENCE_OUT: target } });
  if (r.status === 0 && existsSync(target)) console.log(render(JSON.parse(readFileSync(target, 'utf8'))));
  return r.status ?? 1;
}

export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return argv.length ? 0 : 2;
  }
  const [kind, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: kind === 'show', strict: true,
    options: { count: { type: 'string', default: '20' }, out: { type: 'string' }, seller: { type: 'string', default: TEST_SELLER }, 'check-only': { type: 'boolean', default: false }, 'low-eth': { type: 'string', default: '0.3' } },
  });
  if (kind === 'deals') {
    const count = Number(values.count);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error(`--count is a whole number from 1, not ${values.count}`);
    const low = /^(\d+)(?:\.(\d{1,18}))?$/.exec(values['low-eth']);
    if (!low) throw new Error(`--low-eth is ETH as a decimal, such as 0.3, not ${values['low-eth']}`);
    const lowWei = BigInt(low[1]) * 10n ** 18n + BigInt((low[2] ?? '').padEnd(18, '0') || '0');
    return deals({ count, out: values.out, seller: values.seller.replace(/\/+$/, ''), checkOnly: values['check-only'], lowWei });
  }
  if (kind === 'direct' || kind === 'leak') return local(kind, values.out);
  if (kind === 'show') {
    if (positionals.length !== 1) throw new Error('show takes one record file');
    console.log(render(JSON.parse(readFileSync(positionals[0], 'utf8'))));
    return 0;
  }
  console.error(`unknown measurement ${kind}: deals, direct, leak or show\n\n${HELP}`);
  return 2;
}

if (isMain(import.meta.url)) {
  main().then((code) => process.exit(code), (e) => {
    console.error(`pitch-evidence: ${e.message}`);
    process.exit(1);
  });
}
