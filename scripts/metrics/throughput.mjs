#!/usr/bin/env node
// throughput.json (T-066, headline metric 4): how many deals Crow can run at once and in an hour, which limit binds,
// and how much of it the deals of the last 7 days used. Deterministic: every limit names its source, and capacity is
// integer arithmetic on them.
// - Relay capacity, deals an hour = deal lanes × 3,600 s ÷ (transactions per honest deal × seconds per transaction):
//   each lane waits for a receipt before it sends again (T-219).
// - Deals in progress at that capacity, by Little's law: arrival rate × the median time from offered to settled.
//
//   node scripts/metrics/throughput.mjs --deal-timing reports/scratch/deal-timing.json --out reports/scratch/throughput.json
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run as runDealTiming } from './deal-timing.mjs';
import { DEFAULTS, ROOT, Sources, cli, envelope, gitCommit, hexToDec, isMain, msStats, quantile, writeJson } from './lib.mjs';

export const SEATS_PER_PANEL = 3;
const HOUR_MS = 3_600_000;

/** A whole-number constant from a source file, such as `export const DEAL_LANES = 3;`, or null. */
export function constantFrom(text, name) {
  const m = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*(\\d{1,9})\\s*;`).exec(text ?? '');
  return m ? Number.parseInt(m[1], 10) : null;
}

const int = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);

/**
 * Builds throughput.json's body. Pure.
 * @param {{ discovery: object|null, agent: object|null, dealTiming: object|null, blockTimesMs: number[],
 *           code: { dealLanes: number|null, mintsPerDay: number|null, commit: string }, nowMs: number }} input
 */
export function buildThroughput({ discovery, agent, dealTiming, blockTimesMs, code, nowMs }) {
  const gaps = [];
  const commit = code.commit === 'unknown' ? 'unknown' : code.commit.slice(0, 12);

  // The live configuration, each value with its source.
  const publishedLanes = Array.isArray(discovery?.demo?.relayer?.dealLanes) ? discovery.demo.relayer.dealLanes.length : null;
  const dealLanes = publishedLanes
    ? { value: publishedLanes, source: 'discovery demo.relayer.dealLanes' }
    : { value: int(code.dealLanes), source: `DEAL_LANES in packages/settlement/evm/live.ts at ${commit}, not confirmed live` };

  const released = (dealTiming?.deals ?? []).filter((d) => d.outcome === 'Released');
  const txCounts = released.map((d) => d.txs.filter((t) => t.crowSent).length).sort((a, b) => a - b);
  const txPerHonestDeal = { value: quantile(txCounts, 50), source: `median Crow-sent transactions per Released deal in deal-timing.json (${txCounts.length} deals)` };

  const sorted = [...blockTimesMs].filter(Number.isSafeInteger).sort((a, b) => a - b);
  const gapsMs = sorted.slice(1).map((t, i) => t - sorted[i]);
  const block = msStats(gapsMs);
  const blockTimeMs = { medianMs: block.medianMs, p90Ms: block.p90Ms, blocks: sorted.length };
  const fund = dealTiming?.stages?.find((s) => s.id === 'fund');
  let secondsPerTx;
  if (fund && Number.isSafeInteger(fund.medianMs) && fund.medianMs > 0) secondsPerTx = { value: Math.ceil(fund.medianMs / 1000), source: 'median fund stage in deal-timing.json (submit to block)' };
  else if (block.medianMs !== null) secondsPerTx = { value: Math.ceil(block.medianMs / 1000), source: `median gap between the last ${sorted.length} Sepolia blocks (the fund stage reads 0: see deal-timing.json's gaps)` };
  else secondsPerTx = { value: null, source: 'unknown: no block times and no fund stage' };

  const limits = agent?.limits;
  const testSeller = limits && typeof limits === 'object'
    ? { open: int(limits.open), perHour: int(limits.perHour), perDay: int(limits.perDay), perClientPerHour: int(limits.perClientPerHour), perClientPerDay: int(limits.perClientPerDay), source: `${DEFAULTS.testSeller}, field limits` }
    : { open: null, perHour: null, perDay: null, perClientPerHour: null, perClientPerDay: null, source: 'unknown: agent.json could not be read' };
  const f = discovery?.demo?.faucet;
  const publishedMints = int(f?.mintsPerDay);
  const faucet = {
    perAddressEverySec: int(f?.perAddressEverySec),
    perClientPerWindow: int(f?.perClientPerWindow),
    mintsPerDay: publishedMints ?? int(code.mintsPerDay),
    source: publishedMints !== null ? 'discovery demo.faucet' : `discovery demo.faucet; mintsPerDay from FAUCET_MINTS_PER_DAY in apps/demo-cloud/src/world.ts at ${commit}, not confirmed live`,
  };
  const j = discovery?.demo?.judges;
  const liveJudges = { callsPerDay: int(j?.liveCallsPerDay), seatsPerPanel: SEATS_PER_PANEL, source: 'discovery demo.judges.liveCallsPerDay; three seats a panel' };

  // Capacity.
  const life = dealTiming?.totals?.offeredToSettledMs?.medianMs ?? null;
  const lanes = dealLanes.value;
  const perDeal = txPerHonestDeal.value;
  const spt = secondsPerTx.value;
  const relayDealsPerHour = lanes && perDeal && spt ? Math.floor((lanes * 3600) / (perDeal * spt)) : null;
  const inProgressAtRelayCapacity = relayDealsPerHour !== null && Number.isSafeInteger(life) ? Math.ceil((relayDealsPerHour * life) / HOUR_MS) : null;
  if (relayDealsPerHour === null) gaps.push('Relay capacity is unknown: a lane count, a transaction count or a block time is missing.');

  const list = [];
  const add = (id, kind, value, appliesTo, basis, perClient = false) => {
    if (value === null) {
      gaps.push(`The ${id} limit is unknown: its source could not be read.`);
      return;
    }
    list.push({ id, [kind]: value, appliesTo, perClient, basis });
  };
  add('relay', 'dealsPerHour', relayDealsPerHour, 'all', 'inferred');
  add('testSeller.open', 'inProgress', testSeller.open, 'testSeller', 'measured');
  add('testSeller.perHour', 'dealsPerHour', testSeller.perHour, 'testSeller', 'measured');
  add('testSeller.perDay', 'dealsPerDay', testSeller.perDay, 'testSeller', 'measured');
  add('testSeller.perClientPerHour', 'dealsPerHour', testSeller.perClientPerHour, 'testSeller', 'measured', true);
  add('testSeller.perClientPerDay', 'dealsPerDay', testSeller.perClientPerDay, 'testSeller', 'measured', true);
  add('faucet.mintsPerDay', 'dealsPerDay', faucet.mintsPerDay, 'newVisitor', publishedMints !== null ? 'measured' : 'inferred');
  add('faucet.perClientPerWindow', 'dealsPerHour', faucet.perClientPerWindow !== null && faucet.perAddressEverySec ? Math.floor((faucet.perClientPerWindow * 3600) / faucet.perAddressEverySec) : null, 'newVisitor', 'measured', true);
  add('fundingLane', 'dealsPerHour', spt ? Math.floor(3600 / spt) : null, 'newVisitor', 'inferred');
  add('liveJudges', 'dealsPerDay', liveJudges.callsPerDay === null ? null : Math.floor(liveJudges.callsPerDay / SEATS_PER_PANEL), 'rubric', 'measured');

  // The binding limit for a test-seller deal: the smallest number of deals one hour can hold, counting a day's cap
  // as an hour's ceiling and deals in progress by Little's law. Per-client limits bind one client, not Crow.
  const hourly = (l) => {
    if (l.dealsPerHour !== undefined) return l.dealsPerHour;
    if (l.dealsPerDay !== undefined) return l.dealsPerDay;
    return Number.isSafeInteger(life) && life > 0 ? Math.floor((l.inProgress * HOUR_MS) / life) : null;
  };
  const daily = (l) => {
    if (l.dealsPerDay !== undefined) return l.dealsPerDay;
    const h = hourly(l);
    return h === null ? null : h * 24;
  };
  const pick = (types, of) => {
    let best = null;
    for (const l of list) {
      if (l.perClient || !types.includes(l.appliesTo)) continue;
      const v = of(l);
      if (v !== null && (best === null || v < best.value)) best = { id: l.id, value: v };
    }
    return best;
  };
  const h = pick(['all', 'testSeller', 'newVisitor'], hourly);
  const d = pick(['all', 'testSeller', 'newVisitor'], daily);
  const binding = h
    ? { id: h.id, appliesTo: 'testSeller', assumes: 'a new visitor, who needs one faucet mint', dealsPerHour: h.value, perDay: d ? { id: d.id, dealsPerDay: d.value } : null, basis: 'inferred' }
    : null;

  // Observed: hold.funded per clock hour over the last 168 hours, zeros included.
  const hours = 168;
  const endHour = Math.floor(nowMs / HOUR_MS);
  const counts = new Array(hours).fill(0);
  for (const deal of dealTiming?.deals ?? []) {
    const t = Date.parse(deal.times?.funded ?? '');
    if (!Number.isFinite(t)) continue;
    const k = endHour - Math.floor(t / HOUR_MS);
    if (k >= 0 && k < hours) counts[k] += 1;
  }
  const sortedCounts = [...counts].sort((a, b) => a - b);
  const peakPerHour = sortedCounts[hours - 1];
  const observed = {
    dealsPerHour: { medianPerHour: quantile(sortedCounts, 50), peakPerHour, hours },
    utilizationBps: binding && binding.dealsPerHour > 0 ? Math.floor((peakPerHour * 10_000) / binding.dealsPerHour) : null,
    utilizationOf: 'the peak hour, against the binding limit',
  };
  if (!dealTiming) gaps.push('deal-timing.json could not be read, so the observed deals read unknown.');
  else if (dealTiming.window?.deals >= dealTiming.window?.cappedAt) gaps.push('deal-timing.json hit its cap of deals, so the observed counts are a lower bound.');

  return {
    config: { dealLanes, fundingLanes: { value: 1, source: 'packages/settlement/evm/live.ts: the relayer secret is the one funding lane (ADR-0028)' }, txPerHonestDeal, secondsPerTx, blockTimeMs, testSeller, faucet, liveJudges },
    capacity: { relayDealsPerHour, inProgressAtRelayCapacity, medianLifetimeMs: life, limits: list, binding },
    observed,
    gaps,
  };
}

/** The timestamps of the last `n` Sepolia blocks, in ms. */
export async function readRecentBlockTimes(sources, rpc, n = 100) {
  const [headHex] = await sources.rpc('sepolia-head', rpc, [{ method: 'eth_blockNumber', params: [] }]);
  const head = hexToDec(headHex);
  if (head === null) return [];
  const top = BigInt(head);
  const calls = [];
  for (let i = 0n; i < BigInt(n) && top - i >= 0n; i++) calls.push({ method: 'eth_getBlockByNumber', params: [`0x${(top - i).toString(16)}`, false] });
  // A Sepolia block lists its transaction hashes, up to about 20 KB each, so 20 go in one 1 MiB answer (measured:
  // 50 went over the cap, 2026-11-05).
  const results = await sources.rpc('sepolia-recent-blocks', rpc, calls, { batch: 20 });
  return results.map((r) => hexToDec(r?.timestamp)).filter((t) => t !== null).map((t) => Number(t) * 1000);
}

function readCode(rel) {
  try {
    return readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    return '';
  }
}

export async function run({ dealTimingFile, op1 = DEFAULTS.op1, op2 = DEFAULTS.op2, rpc = DEFAULTS.sepoliaRpc, sources = new Sources(), nowMs = Date.now() } = {}) {
  let dealTiming = null;
  if (dealTimingFile) {
    try {
      dealTiming = JSON.parse(readFileSync(dealTimingFile, 'utf8'));
      if (dealTiming?.schema !== 'crow.metrics.deal-timing/1') dealTiming = null;
    } catch {
      dealTiming = null;
    }
  } else {
    dealTiming = await runDealTiming({ op1, op2, sources, nowMs });
  }
  const discovery = (await sources.json('discovery', `${op1}/`)) ?? (await sources.json('discovery', `${op2}/`));
  const agent = await sources.json('test-seller', DEFAULTS.testSeller);
  const blockTimesMs = await readRecentBlockTimes(sources, rpc);
  const commit = gitCommit(ROOT);
  const code = {
    dealLanes: constantFrom(readCode('packages/settlement/evm/live.ts'), 'DEAL_LANES'),
    mintsPerDay: constantFrom(readCode('apps/demo-cloud/src/world.ts'), 'FAUCET_MINTS_PER_DAY'),
    commit,
  };
  const body = buildThroughput({ discovery, agent, dealTiming, blockTimesMs, code, nowMs });
  const { gaps, ...rest } = body;
  return { ...envelope('throughput', { script: 'scripts/metrics/throughput.mjs', commit, generatedAt: nowMs, sources: sources.list, gaps }), ...rest };
}

if (isMain(import.meta.url)) {
  const args = cli({ out: { type: 'string' }, 'deal-timing': { type: 'string' }, op1: { type: 'string' }, op2: { type: 'string' }, rpc: { type: 'string' } });
  const t0 = Date.now();
  const out = await run({
    ...(args['deal-timing'] ? { dealTimingFile: args['deal-timing'] } : {}),
    ...(args.op1 ? { op1: args.op1 } : {}),
    ...(args.op2 ? { op2: args.op2 } : {}),
    ...(args.rpc ? { rpc: args.rpc } : {}),
  });
  if (args.out) writeJson(args.out, out);
  else process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  console.error(`throughput: relay ${out.capacity.relayDealsPerHour ?? 'unknown'} deals an hour, binding ${out.capacity.binding?.id ?? 'unknown'}, in ${Date.now() - t0} ms`);
}
