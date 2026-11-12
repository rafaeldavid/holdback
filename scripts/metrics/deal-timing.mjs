#!/usr/bin/env node
// deal-timing.json (T-066, headline metric 3, Crow's side): how long each stage of a deal takes, over the deals of
// the last 7 days (at most 500), read from the operators' public event log and Sepolia block timestamps.
// Deterministic: no model and no inference. An event that carries payload.block is timed by that block's timestamp;
// any other event by its own `at`. A stage whose end reads earlier than its start (an off-chain event the operators
// record when the chain step it precedes lands) counts as 0 and is counted in `clamped`.
//
//   node scripts/metrics/deal-timing.mjs --out reports/scratch/deal-timing.json
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADDRESS, DEFAULTS, HEX32, ROOT, Sources, UINT, cli, crowAccounts, envelope, gitCommit, hexToDec, isMain, iso, msStats, readEvents, writeJson,
} from './lib.mjs';

export const WINDOW_DAYS = 7;
export const CAP = 500;

/** The moments of a deal, each the first event of these types. */
export const MOMENTS = {
  offered: ['commitment.offered'],
  accepted: ['adjudicator.accepted'],
  agreed: ['commitment.agreed'],
  funded: ['hold.funded'],
  delivered: ['delivery.submitted'],
  decided: ['judgment.decided'],
  settled: ['settlement.released', 'settlement.refunded'],
  final: ['appeal.expired', 'commitment.settled'],
};

export const STAGES = [
  { id: 'accept', from: 'offered', to: 'accepted', actor: 'the primary adjudicator', crow: true },
  { id: 'agree', from: 'accepted', to: 'agreed', actor: 'the buyer', crow: false },
  { id: 'fund', from: 'agreed', to: 'funded', actor: "the operator's relay and the chain", crow: true },
  { id: 'deliver', from: 'funded', to: 'delivered', actor: 'the seller, then the relay and the chain', crow: false },
  { id: 'decide', from: 'delivered', to: 'decided', actor: 'the adjudicator, the relay and the chain', crow: true },
  { id: 'settle', from: 'decided', to: 'settled', actor: 'the chain, usually the same transaction', crow: true },
  { id: 'final', from: 'settled', to: 'final', actor: 'the appeal window, a term the parties chose', crow: false },
];

/** The step a transaction is named by: the first of its events in this order. */
export const STEP_OF = [
  ['hold.funded', 'fund'],
  ['delivery.submitted', 'deliver'],
  ['judgment.decided', 'decide'],
  ['appeal.filed', 'appeal'],
  ['appeal.decided', 'appeal decision'],
  ['appeal.expired', 'appeal expiry'],
  ['settlement.refunded', 'settle'],
  ['settlement.released', 'settle'],
  ['settlement.reclaimed', 'reclaim'],
  ['commitment.settled', 'mutual settlement'],
  ['fee.operator', 'fund'],
];
const STEP = new Map(STEP_OF);

/** A transaction's primary event type, by STEP_OF's order. */
export function primaryEvent(types) {
  for (const [type] of STEP_OF) if (types.includes(type)) return type;
  return types[0];
}
export const stepOf = (type) => STEP.get(type) ?? 'other';

const lower = (a) => (typeof a === 'string' && ADDRESS.test(a) ? a.toLowerCase() : null);

/** "checks-only" or "rubric" from public terms; null when the terms are not disclosed. */
export function templateOf(terms) {
  const criteria = terms?.acceptance?.rubric?.criteria;
  if (!terms || typeof terms !== 'object' || !Array.isArray(criteria)) return null;
  return criteria.length ? 'rubric' : 'checks-only';
}

/** How many distinct deals in `events` have a hold.funded event, whatever their age. */
export function fundedDealsIn(events) {
  const ids = new Set();
  for (const e of events) if (e.type === 'hold.funded' && typeof e.commitmentId === 'string' && HEX32.test(e.commitmentId)) ids.add(e.commitmentId.toLowerCase());
  return ids.size;
}

/**
 * Builds deal-timing.json's body from events, block times and Crow's accounts. Pure.
 * `events` is null when no operator served its event log: then every count reads null ("unknown"), never 0.
 * @param {{ events: object[]|null, blockTimes: Map<string, number>, crow: Set<string>, nowMs: number, readFrom?: number,
 *           complete?: boolean, windowDays?: number, cap?: number }} input
 */
export function buildDealTiming({ events, blockTimes, crow, nowMs, readFrom = 0, complete = true, windowDays = WINDOW_DAYS, cap = CAP }) {
  const gaps = [];
  const known = Array.isArray(events);
  if (!known) gaps.push('No operator node served its event log, so every figure reads unknown.');
  /** A count, or null when the log could not be read. */
  const count = (n) => (known ? n : null);
  const stats = (values) => {
    const m = msStats(values);
    return { ...m, deals: count(m.deals) };
  };
  const byDeal = new Map();
  for (const e of events ?? []) {
    if (typeof e.commitmentId !== 'string' || !HEX32.test(e.commitmentId)) continue;
    const id = e.commitmentId.toLowerCase();
    if (!byDeal.has(id)) byDeal.set(id, []);
    byDeal.get(id).push(e);
  }
  let byAt = 0;
  const timeOf = (e) => {
    const block = e.payload?.block;
    if (typeof block === 'string' && UINT.test(block)) {
      const t = blockTimes.get(block);
      if (Number.isSafeInteger(t)) return t;
      byAt += 1;
    }
    return Date.parse(e.at);
  };

  const windowFrom = nowMs - windowDays * 86_400_000;
  const all = [];
  for (const [commitmentId, evs] of byDeal) {
    evs.sort((a, b) => a.seq - b.seq);
    const offered = evs.find((e) => e.type === 'commitment.offered');
    if (!offered) continue; // offered before the read started
    const offeredMs = Date.parse(offered.at);
    if (offeredMs < windowFrom || offeredMs > nowMs) continue;
    all.push({ commitmentId, evs, offeredMs });
  }
  all.sort((a, b) => b.offeredMs - a.offeredMs || (a.commitmentId < b.commitmentId ? -1 : 1));
  const kept = all.slice(0, cap);
  if (all.length > cap) gaps.push(`The window holds ${all.length} deals; the newest ${cap} are kept, from ${iso(kept[kept.length - 1].offeredMs)}.`);
  if (known && readFrom > 0) gaps.push(`The event log was read from seq ${readFrom}, so a deal offered before that event is left out.`);
  if (known && !complete) gaps.push('The event log read stopped before the head, so the newest events may be missing.');

  const clamped = Object.fromEntries(STAGES.map((s) => [s.id, 0]));
  const stageMs = Object.fromEntries(STAGES.map((s) => [s.id, []]));
  const crowMs = [];
  const partyMs = [];
  const lifeMs = [];
  const lagMs = [];
  const outcomes = { Released: 0, Refunded: 0, other: 0 };
  let inProgress = 0;
  const deals = [];

  for (const { commitmentId, evs } of kept) {
    const ms = {};
    for (const [moment, types] of Object.entries(MOMENTS)) {
      const e = evs.find((x) => types.includes(x.type));
      if (e) ms[moment] = timeOf(e);
    }
    for (const e of evs) {
      const t = blockTimes.get(e.payload?.block);
      if (typeof e.payload?.block === 'string' && Number.isSafeInteger(t)) lagMs.push(Date.parse(e.at) - t);
    }
    const per = {};
    for (const s of STAGES) {
      if (ms[s.from] === undefined || ms[s.to] === undefined) continue;
      let d = ms[s.to] - ms[s.from];
      if (d < 0) {
        clamped[s.id] += 1;
        d = 0;
      }
      per[s.id] = d;
      stageMs[s.id].push(d);
    }
    if (['accept', 'fund', 'decide', 'settle'].every((k) => per[k] !== undefined)) crowMs.push(per.accept + per.fund + per.decide + per.settle);
    if (per.agree !== undefined && per.deliver !== undefined) partyMs.push(per.agree + per.deliver);
    if (ms.offered !== undefined && ms.settled !== undefined) lifeMs.push(Math.max(0, ms.settled - ms.offered));

    const types = new Set(evs.map((e) => e.type));
    const offered = evs.find((e) => e.type === 'commitment.offered');
    const terms = offered?.payload?.terms;
    let outcome = 'inProgress';
    if (types.has('settlement.released')) outcome = 'Released';
    else if (types.has('settlement.refunded')) outcome = 'Refunded';
    else if (types.has('settlement.reclaimed')) outcome = 'Reclaimed';
    else if (types.has('offer.expired')) outcome = 'Expired';
    else if (!types.has('hold.funded') && typeof terms?.timing?.fundBy === 'string' && Date.parse(terms.timing.fundBy) < nowMs) outcome = 'Expired';
    if (outcome === 'Released' || outcome === 'Refunded') outcomes[outcome] += 1;
    else if (outcome === 'inProgress') inProgress += 1;
    else outcomes.other += 1;

    const byTx = new Map();
    for (const e of evs) {
      const p = e.payload;
      if (!p || typeof p.tx !== 'string' || !HEX32.test(p.tx)) continue;
      const tx = p.tx.toLowerCase();
      if (!byTx.has(tx)) byTx.set(tx, { types: [], block: null, sender: null, gasUsed: null });
      const row = byTx.get(tx);
      row.types.push(e.type);
      if (typeof p.block === 'string' && UINT.test(p.block)) row.block ??= p.block;
      row.sender ??= lower(p.sender);
      if (typeof p.gasUsed === 'string' && UINT.test(p.gasUsed)) row.gasUsed ??= p.gasUsed;
    }
    const txs = [...byTx].map(([tx, r]) => {
      const t = r.block === null ? undefined : blockTimes.get(r.block);
      return {
        event: primaryEvent(r.types),
        step: stepOf(primaryEvent(r.types)),
        tx,
        block: r.block,
        blockTime: Number.isSafeInteger(t) ? iso(t) : null,
        sender: r.sender,
        crowSent: r.sender !== null && crow.has(r.sender),
        gasUsed: r.gasUsed,
      };
    });
    const feeEvent = evs.find((e) => e.type === 'fee.operator');
    const fee = feeEvent?.payload?.amount;
    const agreed = evs.find((e) => e.type === 'commitment.agreed');
    deals.push({
      commitmentId,
      outcome,
      template: templateOf(terms),
      buyer: lower(agreed?.actor) ?? lower(terms?.buyer),
      times: Object.fromEntries(Object.keys(MOMENTS).map((k) => [k, ms[k] === undefined ? null : iso(ms[k])])),
      stagesMs: per,
      fee: fee && typeof fee.amount === 'string' && UINT.test(fee.amount) && lower(fee.token) ? { amount: fee.amount, token: lower(fee.token) } : null,
      txs,
    });
  }
  if (byAt) gaps.push(`${byAt} chain events are timed by their \`at\`, because their block could not be read.`);
  for (const s of STAGES) {
    if (clamped[s.id]) gaps.push(`The ${s.id} stage read below 0 on ${clamped[s.id]} deals and counts as 0 there: its start is recorded when the chain step that ends it lands.`);
  }

  const oldest = kept.length ? kept[kept.length - 1].offeredMs : windowFrom;
  return {
    window: { from: iso(all.length > cap ? oldest : windowFrom), to: iso(nowMs), deals: count(kept.length), cappedAt: cap, inProgress: count(inProgress) },
    stages: STAGES.map((s) => ({
      id: s.id,
      from: MOMENTS[s.from].join(' or '),
      to: MOMENTS[s.to].join(' or '),
      actor: s.actor,
      crow: s.crow,
      ...stats(stageMs[s.id]),
      clamped: count(clamped[s.id]),
    })),
    totals: { crowProcessingMs: stats(crowMs), partyMs: stats(partyMs), offeredToSettledMs: stats(lifeMs) },
    indexLagMs: (({ medianMs, p90Ms }) => ({ medianMs, p90Ms, events: count(lagMs.length) }))(msStats(lagMs)),
    outcomes: known ? outcomes : { Released: null, Refunded: null, other: null },
    deals,
    gaps,
  };
}

/** The distinct blocks the window's events name. */
export function blocksToRead(events, nowMs, windowDays = WINDOW_DAYS) {
  const from = nowMs - (windowDays + 1) * 86_400_000;
  const out = new Set();
  for (const e of events) {
    const b = e.payload?.block;
    if (typeof b === 'string' && UINT.test(b) && Date.parse(e.at) >= from) out.add(b);
  }
  return [...out];
}

/** Block timestamps in ms, from eth_getBlockByNumber, trying each RPC in turn for what is still missing. */
export async function readBlockTimes(sources, rpcs, blocks) {
  const times = new Map();
  for (const [i, url] of rpcs.entries()) {
    const missing = blocks.filter((b) => !times.has(b));
    if (!missing.length) break;
    // 20 blocks a request: a Sepolia block lists its transaction hashes, so 50 can pass the 1 MiB cap (measured).
    const results = await sources.rpc(i === 0 ? 'sepolia-blocks' : 'sepolia-blocks-fallback', url, missing.map((b) => ({ method: 'eth_getBlockByNumber', params: [`0x${BigInt(b).toString(16)}`, false] })), { batch: 20 });
    results.forEach((r, k) => {
      const ts = hexToDec(r?.timestamp);
      if (ts !== null) times.set(missing[k], Number(ts) * 1000);
    });
  }
  return times;
}

export function loadFallbackAccounts() {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'scripts/metrics/crow-accounts.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** Reads every source and returns the whole file. */
export async function run({ op1 = DEFAULTS.op1, op2 = DEFAULTS.op2, rpcs = [DEFAULTS.sepoliaRpc, DEFAULTS.sepoliaRpcFallback], back = 8000, sources = new Sources(), nowMs = Date.now() } = {}) {
  const discovery = (await sources.json('discovery', `${op1}/`)) ?? (await sources.json('discovery', `${op2}/`));
  const accounts = crowAccounts(discovery, loadFallbackAccounts());
  const log = await readEvents(sources, [op1, op2], { back });
  const events = log ? log.events : null;
  const blockTimes = await readBlockTimes(sources, rpcs, blocksToRead(events ?? [], nowMs));
  const body = buildDealTiming({ events, blockTimes, crow: accounts.all, nowMs, readFrom: log?.from ?? 0, complete: log?.complete ?? true });
  if (!discovery) body.gaps.push("Discovery could not be read, so Crow's accounts come from scripts/metrics/crow-accounts.json only.");
  if (accounts.dealLanesSource !== 'discovery demo.relayer.dealLanes') body.gaps.push(`The deal lanes come from ${accounts.dealLanesSource}.`);
  return {
    ...envelope('deal-timing', { script: 'scripts/metrics/deal-timing.mjs', commit: gitCommit(ROOT), generatedAt: nowMs, sources: sources.list, gaps: body.gaps }),
    // fundedDeals counts every funded deal the read holds, not only the window's: ops-cost spreads one-time setup gas
    // over it.
    eventLog: log ? { node: log.node, from: log.from, head: log.head, events: log.events.length, complete: log.complete, fundedDeals: fundedDealsIn(log.events) } : null,
    ...Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'gaps')),
  };
}

if (isMain(import.meta.url)) {
  const args = cli({ out: { type: 'string' }, op1: { type: 'string' }, op2: { type: 'string' }, rpc: { type: 'string' }, back: { type: 'string' } });
  const t0 = Date.now();
  const out = await run({
    ...(args.op1 ? { op1: args.op1 } : {}),
    ...(args.op2 ? { op2: args.op2 } : {}),
    ...(args.rpc ? { rpcs: [args.rpc] } : {}),
    ...(args.back ? { back: Number.parseInt(args.back, 10) } : {}),
  });
  if (args.out) writeJson(args.out, out);
  else process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  const failed = out.sources.filter((s) => !s.ok).map((s) => s.id);
  console.error(`deal-timing: ${out.window.deals ?? 'unknown'} deals, ${out.outcomes.Released ?? 'unknown'} Released, in ${Date.now() - t0} ms${failed.length ? `; failed sources: ${failed.join(', ')}` : ''}`);
}
