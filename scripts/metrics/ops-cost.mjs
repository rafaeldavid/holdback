#!/usr/bin/env node
// ops-cost.json (T-066, headline metric 5): an estimate of what Crow pays to process one deal, by component, beside
// the operator fee the deal charged. Deterministic: gas comes from each Crow-sent transaction's Sepolia receipt, and
// from the operators' public event log (payload.gasUsed) where no receipt was read (perDeal.gas.source says which,
// T-413); receipts and logs come from a public Sepolia RPC, prices from the pinned tables in config/. Every amount
// is integer arithmetic on bigint, written as a decimal string of micro-USD.
// A component with no source reads null ("unknown") and is named in the total's `excludes`, never counted as 0.
//
//   node scripts/metrics/ops-cost.mjs --deal-timing reports/scratch/deal-timing.json --out reports/scratch/ops-cost.json
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadFallbackAccounts, run as runDealTiming } from './deal-timing.mjs';
import {
  ADDRESS, DEFAULTS, HEX32, ROOT, Sources, UINT, bigQuantile, cli, crowAccounts, divRound, envelope, gitCommit, hexToDec, isMain, weiToUsdMicros, writeJson,
} from './lib.mjs';

/** An adjudicator's own approve and deposit, once: 372,709 gas (measured on Sepolia by T-213; world.ts). */
export const ADJUDICATOR_SETUP_GAS = 372_709n;
export const SEATS_PER_PANEL = 3n;
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_TOPIC = `0x${'0'.repeat(64)}`;
const NETWORKS = ['sepolia', 'ethereum', 'base'];
const STEP_ORDER = ['fund', 'deliver', 'decide', 'appeal expiry'];
const MILLION = 1_000_000n;

const s = (b) => (b === null ? null : b.toString());
const big = (v) => (typeof v === 'string' && UINT.test(v) ? BigInt(v) : typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null);

/** The micro-USD value of `amount` base units of a token with `decimals`, at numerator/denominator USD each. */
export function tokenToUsdMicros(amount, decimals, numerator = 1n, denominator = 1n) {
  return divRound(BigInt(amount) * MILLION * BigInt(numerator), 10n ** BigInt(decimals) * BigInt(denominator));
}

/** Σ tokens × (micro-USD per million tokens) ÷ 10^6, rounded once at the end. */
export function tokensToUsdMicros(pairs) {
  let n = 0n;
  for (const [tokens, price] of pairs) n += BigInt(tokens) * BigInt(price);
  return divRound(n, MILLION);
}

/**
 * The gas of one deal's Crow-sent transactions, by step, as bigint. A transaction's gas is its Sepolia receipt's
 * (`receiptGas`: lowercase hash → decimal string, the primary source) where the build read it, and the event log's
 * `payload.gasUsed` otherwise (T-413). `fromReceipts`, `fromEventLog` and `mismatches` count the transactions.
 */
export function dealGas(deal, receiptGas = null) {
  const bySteps = new Map();
  let total = 0n;
  let txs = 0;
  let fromReceipts = 0;
  let fromEventLog = 0;
  let mismatches = 0;
  for (const t of deal.txs ?? []) {
    if (!t.crowSent) continue;
    const receipt = typeof t.tx === 'string' ? big(receiptGas?.get(t.tx.toLowerCase())) : null;
    const logged = big(t.gasUsed);
    const g = receipt ?? logged;
    if (g === null) continue;
    if (receipt !== null) fromReceipts += 1;
    else fromEventLog += 1;
    if (receipt !== null && logged !== null && receipt !== logged) mismatches += 1;
    bySteps.set(t.step, (bySteps.get(t.step) ?? 0n) + g);
    total += g;
    txs += 1;
  }
  return { bySteps, total, txs, fromReceipts, fromEventLog, mismatches };
}

/**
 * Builds ops-cost.json's body. Pure.
 * @param {{ dealTiming: object|null, prices: object|null, modelPrices: object|null, discovery: object|null,
 *           oneClick: object|null, faucetMintGas: string[], effectiveGasPrices: string[],
 *           balances: {address: string, role: string, wei: string|null}[],
 *           receiptGas: Map<string, string>|null }} input `receiptGas`: each read receipt's gasUsed, by lowercase hash
 */
export function buildOpsCost({ dealTiming, prices, modelPrices, discovery, oneClick = null, faucetMintGas = [], effectiveGasPrices = [], balances = [], receiptGas = null }) {
  const gaps = [];
  const released = (dealTiming?.deals ?? []).filter((d) => d.outcome === 'Released');
  // deal-timing.json with no event log behind it writes null counts: its deals are unknown, not none.
  const timingKnown = !!dealTiming && dealTiming.window?.deals !== null;
  if (!dealTiming) gaps.push('deal-timing.json could not be read, so the gas per deal reads unknown.');
  else if (!timingKnown) gaps.push('deal-timing.json has no event log, so the gas per deal reads unknown.');
  else if (!released.length) gaps.push('No Released deal is in the window, so the gas per deal reads unknown.');

  // Gas, by step: the median over Released deals of each step's gas, and the median of each deal's total.
  const perDeal = released.map((d) => dealGas(d, receiptGas));
  const steps = [...new Set(perDeal.flatMap((d) => [...d.bySteps.keys()]))].sort((a, b) => {
    const ia = STEP_ORDER.indexOf(a);
    const ib = STEP_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a < b ? -1 : 1);
  });
  const bySteps = steps.map((step) => ({
    step,
    deals: perDeal.filter((d) => d.bySteps.has(step)).length,
    gasUsed: { median: bigQuantile(perDeal.filter((d) => d.bySteps.has(step)).map((d) => d.bySteps.get(step).toString()), 50) },
  }));
  // A deal with no gas figure on any transaction (no receipt read, no payload.gasUsed) is unknown, not 0: it stays out
  // of the medians and of the count beside them (T-413).
  const measured = perDeal.filter((d) => d.txs > 0);
  const unmeasured = perDeal.length - measured.length;
  if (unmeasured) gaps.push(`${unmeasured} Released deal${unmeasured === 1 ? ' has' : 's have'} no gas figure (no receipt read, no gasUsed in the event log), so the gas per deal leaves ${unmeasured === 1 ? 'it' : 'them'} out.`);
  const dealTotal = big(bigQuantile(measured.map((d) => d.total.toString()), 50));
  // Where the number comes from, and when (T-413): receipts, the event log or both; the deals behind the median; the
  // window deal-timing read and the newest measured deal's settlement.
  const sum = (k) => measured.reduce((n, d) => n + d[k], 0);
  const [receiptTxs, eventLogTxs, mismatches] = [sum('fromReceipts'), sum('fromEventLog'), sum('mismatches')];
  const settledAt = released.filter((_, i) => perDeal[i].txs > 0).map((d) => d.times?.settled).filter((t) => typeof t === 'string').sort();
  const gasSource = dealTotal === null ? null : {
    basis: 'measured',
    from: receiptTxs && eventLogTxs ? 'receipts and event log' : receiptTxs ? 'receipts' : 'event log',
    deals: measured.length,
    receiptTxs,
    eventLogTxs,
    mismatches,
    window: dealTiming?.window ? { from: dealTiming.window.from ?? null, to: dealTiming.window.to ?? null } : null,
    newestDealAt: settledAt.at(-1) ?? null,
  };
  if (mismatches) gaps.push(`${mismatches} transaction${mismatches === 1 ? "'s" : "s'"} gas in the event log differs from its Sepolia receipt; the receipt counts.`);
  const txPerDeal = big(bigQuantile(measured.map((d) => String(d.txs)), 50));
  const faucet = big(bigQuantile(faucetMintGas, 50));
  if (faucet === null) gaps.push("No faucet mint was found for the window's buyers, so a new visitor's mint is left out of the gas.");

  // The adjudicators' one-time setup, spread over every funded deal the event log holds (eventLog.fundedDeals), not
  // only the window's; the window's count is a floor, and the only count a bare deal-timing body has. Discovery that
  // lists no adjudicator means no setup (0); discovery that cannot be read means an unknown setup (null).
  const adjudicators = Array.isArray(discovery?.demo?.adjudicators) ? BigInt(discovery.demo.adjudicators.length) : null;
  const windowFunded = BigInt((dealTiming?.deals ?? []).filter((d) => d.times?.funded).length);
  const logFunded = Number.isSafeInteger(dealTiming?.eventLog?.fundedDeals) ? BigInt(dealTiming.eventLog.fundedDeals) : 0n;
  const funded = logFunded > windowFunded ? logFunded : windowFunded;
  let setup = null;
  if (adjudicators === 0n) setup = 0n;
  else if (adjudicators !== null && funded > 0n) setup = (ADJUDICATOR_SETUP_GAS * adjudicators + funded - 1n) / funded;
  const readFrom = dealTiming?.eventLog?.from ?? 0;
  if (adjudicators === null) gaps.push("Discovery could not be read, so the adjudicators' setup gas is left out of the gas.");
  else if (setup !== null && setup > 0n && readFrom > 0) gaps.push(`The adjudicators' setup gas is spread over the funded deals in the event log read from seq ${readFrom}; the world has more, so it reads high.`);

  const totalGas = dealTotal === null ? null : dealTotal + (faucet ?? 0n) + (setup ?? 0n);
  const txsPriced = txPerDeal === null ? null : txPerDeal + (faucet === null ? 0n : 1n);

  // Prices.
  const usdPerEth = big(prices?.usdMicrosPerEth?.value);
  const gasPrice = { ethereum: big(prices?.gas?.ethereum?.gasPriceWei), base: big(prices?.gas?.base?.gasPriceWei) };
  const l1 = prices?.gas?.base?.l1Fee;
  const l1PerTx = big(l1?.weiPerTx);
  if (!prices) gaps.push('config/ops-cost-prices.json could not be read, so gas reads unknown off Sepolia.');
  if (l1PerTx === null) gaps.push("Base's L1 data fee is not included.");
  const gasUsd = { sepolia: totalGas === null ? null : 0n, ethereum: null, base: null };
  if (totalGas !== null && usdPerEth !== null) {
    if (gasPrice.ethereum !== null) gasUsd.ethereum = weiToUsdMicros(totalGas * gasPrice.ethereum, usdPerEth);
    if (gasPrice.base !== null) gasUsd.base = weiToUsdMicros(totalGas * gasPrice.base + (l1PerTx !== null && txsPriced !== null ? l1PerTx * txsPriced : 0n), usdPerEth);
  }

  // Cloudflare, from the newest harness run with tail counts.
  const cf = prices?.cloudflare ?? {};
  const unit = (k) => big(cf[k]?.usdMicrosPerMillion);
  // An unknown cost has no margin either, so usdMicrosAtMargin is null here and "0" only beside tail counts.
  let cloudflare = { basis: 'unknown', runId: null, requests: null, cpuMs: null, durableObjectRequests: null, durationGbS: null, usdMicrosAtList: null, usdMicrosAtMargin: null, pricesReadOn: cf.workersRequests?.readOn ?? null };
  const workers = oneClick?.cloudflare?.workers;
  if (workers && typeof workers === 'object') {
    let requests = 0n;
    let cpu = 0n;
    let cpuKnown = false;
    let doRequests = 0n;
    let doWallMs = 0n;
    let doWallSeen = false;
    for (const w of Object.values(workers)) {
      requests += big(w?.requests) ?? 0n;
      if (big(w?.cpuMs) !== null) {
        cpu += big(w.cpuMs);
        cpuKnown = true;
      }
      doRequests += big(w?.durableObjectRequests) ?? 0n;
      if (big(w?.durableObjectWallMs) !== null) {
        doWallMs += big(w.durableObjectWallMs);
        doWallSeen = true;
      }
    }
    // With no Durable Object request, the duration is 0; with requests but no wall time on any worker, it is unknown.
    const doWallKnown = doWallSeen || doRequests === 0n;
    // A Durable Object is billed at 128 MB while it runs: GB-s = wall ms × 0.125 ÷ 1,000 = micro-GB-s × 10^-6, where
    // micro-GB-s = wall ms × 125.
    const microGbS = doWallKnown ? doWallMs * 125n : null;
    const list = [[requests, unit('workersRequests')], [cpuKnown ? cpu : 0n, unit('workersCpuMs')], [doRequests, unit('durableObjectRequests')]];
    let atList = null;
    if (list.every(([, p]) => p !== null) && unit('durableObjectGbS') !== null) {
      atList = divRound(list.reduce((n, [q, p]) => n + q * p, 0n) * MILLION + (microGbS ?? 0n) * unit('durableObjectGbS'), MILLION * MILLION);
    }
    cloudflare = {
      basis: 'tail',
      runId: typeof oneClick.runId === 'string' ? oneClick.runId.slice(0, 64) : null,
      requests: s(requests),
      cpuMs: cpuKnown ? s(cpu) : null,
      durableObjectRequests: s(doRequests),
      durationGbS: microGbS === null ? null : `${microGbS / MILLION}.${(microGbS % MILLION).toString().padStart(6, '0')}`.replace(/\.?0+$/, '') || '0',
      usdMicrosAtList: s(atList),
      usdMicrosAtMargin: '0',
      pricesReadOn: cf.workersRequests?.readOn ?? null,
    };
    if (!cpuKnown) gaps.push('The tail carried no CPU time, so Cloudflare CPU is left out of its list price.');
    if (!doWallKnown) gaps.push("The tail carried no Durable Object wall time, so Durable Object duration is left out of Cloudflare's list price.");
  } else {
    gaps.push('No harness run with wrangler tail counts was found, so Cloudflare reads unknown.');
  }

  // Judge inference, rubric deals only: today's tokens per live call × the panel's three seats.
  const j = discovery?.demo?.judges;
  const models = modelPrices?.models ?? {};
  const calls = big(j?.liveCallsToday);
  let judges = { basis: 'unknown', usdMicros: null, calls: s(calls) };
  const byModel = j?.tokensToday?.byModel;
  if (calls && calls > 0n && byModel && typeof byModel === 'object' && Object.keys(byModel).length) {
    let n = 0n;
    let ok = true;
    for (const [id, t] of Object.entries(byModel)) {
      const p = models[id.split('@')[0]];
      if (!p || big(t?.input) === null || big(t?.output) === null) ok = false;
      else n += BigInt(t.input) * BigInt(p.input) + BigInt(t.output) * BigInt(p.output);
    }
    if (ok) judges = { basis: 'by model', usdMicros: s(divRound(n * SEATS_PER_PANEL, MILLION * calls)), calls: s(calls) };
  }
  if (judges.usdMicros === null && calls && calls > 0n && big(j?.tokensToday?.input) !== null && big(j?.tokensToday?.output) !== null) {
    const live = (Array.isArray(j.models) ? j.models : []).map((m) => models[String(m).split('@')[0]]).filter(Boolean);
    if (live.length) {
      const maxIn = live.reduce((m, p) => (BigInt(p.input) > m ? BigInt(p.input) : m), 0n);
      const maxOut = live.reduce((m, p) => (BigInt(p.output) > m ? BigInt(p.output) : m), 0n);
      const n = BigInt(j.tokensToday.input) * maxIn + BigInt(j.tokensToday.output) * maxOut;
      judges = { basis: 'upper bound', usdMicros: s(divRound(n * SEATS_PER_PANEL, MILLION * calls)), calls: s(calls) };
    }
  }
  if (judges.usdMicros === null) gaps.push("Judge inference for rubric deals reads unknown: no live call today, or no price for today's models.");

  // The fee the deal charged, at tUSDC = USD 1.
  const token = typeof discovery?.demo?.token?.id === 'string' ? discovery.demo.token.id.toLowerCase() : null;
  const decimals = Number.isSafeInteger(discovery?.demo?.token?.decimals) ? discovery.demo.token.decimals : null;
  const fees = released.map((d) => d.fee).filter((f) => f && (token === null || f.token === token)).map((f) => f.amount);
  const feeAmount = bigQuantile(fees, 50);
  const num = big(prices?.tusdcToUsd?.numerator) ?? null;
  const den = big(prices?.tusdcToUsd?.denominator) ?? null;
  const feeUsd = feeAmount !== null && decimals !== null && num !== null && den ? tokenToUsdMicros(feeAmount, decimals, num, den) : null;
  if (feeUsd === null) gaps.push('The operator fee reads unknown: no fee.operator event, token decimals or tUSDC rate.');

  // Totals and margins.
  const cfUsd = big(cloudflare.usdMicrosAtList);
  const judgeUsd = big(judges.usdMicros);
  const total = {};
  const covers = {};
  for (const template of ['checksOnly', 'rubric']) {
    const excludes = [];
    if (cfUsd === null) excludes.push('cloudflare');
    if (template === 'rubric' && judgeUsd === null) excludes.push('judges');
    if (faucet === null) excludes.push('faucet mint');
    if (setup === null) excludes.push('adjudicator setup');
    total[template] = { basis: 'inferred', excludes };
    covers[template] = {};
    for (const net of NETWORKS) {
      const g = gasUsd[net];
      const sum = g === null ? null : g + (cfUsd ?? 0n) + (template === 'rubric' ? judgeUsd ?? 0n : 0n);
      total[template][net] = s(sum);
      covers[template][net] = sum === null || feeUsd === null ? { covers: null, marginUsdMicros: null } : { covers: feeUsd >= sum, marginUsdMicros: s(feeUsd - sum) };
    }
  }

  // Runway: each lane's balance in deals at the median effective gas price of recent Crow transactions.
  const price = big(bigQuantile(effectiveGasPrices, 50));
  const need = (role) => (dealTotal === null || price === null ? null : (role === 'funding lane' ? dealTotal + (faucet ?? 0n) : dealTotal) * price);
  const lanes = balances.map((b) => {
    const wei = big(b.wei);
    const n = need(b.role);
    return { address: b.address, role: b.role, wei: s(wei), deals: wei === null || !n ? null : s(wei / n) };
  });
  const sumWei = lanes.reduce((n, l) => (l.wei === null ? n : n + BigInt(l.wei)), 0n);
  const everyone = need('funding lane');
  const runway = { basis: 'inferred', lanes, totalDeals: everyone && lanes.length ? s(sumWei / everyone) : null, effectiveGasPriceWei: { median: s(price), txs: effectiveGasPrices.length } };
  if (lanes.some((l) => l.wei === null)) gaps.push('A lane balance could not be read, so its runway reads unknown.');

  return {
    prices: {
      file: 'config/ops-cost-prices.json',
      asOf: prices?.asOf ?? null,
      usdMicrosPerEth: s(usdPerEth),
      gasPriceWei: { ethereum: s(gasPrice.ethereum), base: s(gasPrice.base) },
      baseL1FeeIncluded: l1PerTx !== null,
      modelPrices: { file: 'config/model-prices.json', readOn: modelPrices?.readOn ?? null },
    },
    perDeal: {
      deals: timingKnown ? released.length : null,
      gas: {
        bySteps,
        dealTxs: { median: s(txPerDeal) },
        faucetMintNewVisitor: { median: s(faucet), mints: faucetMintGas.length },
        adjudicatorSetupPerDeal: s(setup),
        dealGas: { median: s(dealTotal) },
        totalGas: { median: s(totalGas) },
        usdMicros: Object.fromEntries(NETWORKS.map((n) => [n, s(gasUsd[n])])),
        usdBasis: 'inferred',
        source: gasSource,
      },
      cloudflare,
      judges: { checksOnly: { usdMicros: '0' }, rubric: judges },
      rpc: { usdMicros: '0', basis: 'keyless public endpoints (docs/costs.md)' },
      total,
      operatorFee: { amount: feeAmount, token: 'tUSDC', decimals, usdMicrosAtPar: s(feeUsd), deals: fees.length, source: 'the fee.operator event of each Released deal (median)' },
      feeCoversCost: covers,
    },
    runway,
    gaps,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Reads.

const pad = (address) => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;

/** Gas of the faucet mints to the newest Released deals' buyers, from Crow's funding lane only. */
export async function readFaucetMints(sources, rpc, { deals, token, fundingLane, max = 10, range = 2000n }) {
  const picks = deals
    .filter((d) => d.outcome === 'Released' && d.buyer && d.txs.some((t) => t.step === 'fund' && t.block))
    .slice(0, max)
    .map((d) => ({ buyer: d.buyer, block: BigInt(d.txs.find((t) => t.step === 'fund' && t.block).block) }));
  if (!picks.length || !token) return [];
  const logs = await sources.rpc('sepolia-faucet-logs', rpc, picks.map((p) => ({
    method: 'eth_getLogs',
    params: [{ address: token, topics: [TRANSFER, ZERO_TOPIC, pad(p.buyer)], fromBlock: `0x${(p.block > range ? p.block - range : 0n).toString(16)}`, toBlock: `0x${p.block.toString(16)}` }],
  })));
  const txs = [];
  for (const found of logs) {
    if (!Array.isArray(found) || !found.length) continue;
    const last = found[found.length - 1];
    if (typeof last?.transactionHash === 'string' && HEX32.test(last.transactionHash)) txs.push(last.transactionHash);
  }
  if (!txs.length) return [];
  const receipts = await sources.rpc('sepolia-faucet-receipts', rpc, txs.map((h) => ({ method: 'eth_getTransactionReceipt', params: [h] })));
  return receipts
    .filter((r) => r && typeof r.from === 'string' && r.from.toLowerCase() === fundingLane && hexToDec(r.gasUsed) !== null)
    .map((r) => hexToDec(r.gasUsed));
}

/**
 * The gas used by the Crow-sent transactions of the newest Released deals, from their Sepolia receipts (T-413): a
 * Map of lowercase hash → decimal string. A receipt that does not name its own hash is left out.
 */
export async function readReceiptGas(sources, rpc, deals, max = 100) {
  const hashes = [];
  for (const d of deals) {
    if (d.outcome !== 'Released') continue;
    for (const t of d.txs ?? []) if (t.crowSent && typeof t.tx === 'string' && HEX32.test(t.tx) && hashes.length < max && !hashes.includes(t.tx.toLowerCase())) hashes.push(t.tx.toLowerCase());
  }
  const out = new Map();
  if (!hashes.length) return out;
  const receipts = await sources.rpc('sepolia-deal-receipts', rpc, hashes.map((h) => ({ method: 'eth_getTransactionReceipt', params: [h] })));
  receipts.forEach((r, i) => {
    const g = hexToDec(r?.gasUsed);
    if (g !== null && typeof r.transactionHash === 'string' && r.transactionHash.toLowerCase() === hashes[i]) out.set(hashes[i], g);
  });
  return out;
}

/** The effective gas price of the newest Crow-sent transactions. */
export async function readEffectiveGasPrices(sources, rpc, deals, max = 20) {
  const hashes = [];
  for (const d of deals) for (const t of d.txs) if (t.crowSent && hashes.length < max && !hashes.includes(t.tx)) hashes.push(t.tx);
  if (!hashes.length) return [];
  const receipts = await sources.rpc('sepolia-receipts', rpc, hashes.map((h) => ({ method: 'eth_getTransactionReceipt', params: [h] })));
  return receipts.map((r) => hexToDec(r?.effectiveGasPrice)).filter((v) => v !== null);
}

export async function readBalances(sources, rpc, accounts) {
  const lanes = [
    ...(accounts.fundingLane ? [{ address: accounts.fundingLane, role: 'funding lane' }] : []),
    ...accounts.dealLanes.map((a) => ({ address: a, role: 'deal lane' })),
  ];
  if (!lanes.length) return [];
  const results = await sources.rpc('sepolia-balances', rpc, lanes.map((l) => ({ method: 'eth_getBalance', params: [l.address, 'latest'] })));
  return lanes.map((l, i) => ({ ...l, wei: hexToDec(results[i]) }));
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The newest one-click run file in `dir` that passes `isValid` (its schema check) and carries Cloudflare counts.
 * Returns { run, skipped }: `run` is the file or null, and `skipped` counts the run files that failed the check.
 */
export function newestTailRun(dir, isValid) {
  const none = { run: null, skipped: 0 };
  if (!dir) return none;
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => /^[\w.-]+\.json$/.test(n)).sort().reverse();
  } catch {
    return none;
  }
  let skipped = 0;
  for (const n of names) {
    const f = readJsonFile(join(dir, n));
    if (f?.schema !== 'crow.metrics.one-click/1') continue;
    if (!isValid(f)) {
      skipped += 1;
      continue;
    }
    if (f.cloudflare && typeof f.cloudflare === 'object') return { run: f, skipped };
  }
  return { run: null, skipped };
}

/**
 * The one-click schema check from check.mjs, or null when Ajv cannot be loaded. The import is lazy: the console's
 * build job checks out holdback without installing its packages, and the rest of ops-cost needs none.
 */
export async function loadRunCheck() {
  try {
    const { check, loadSchemas } = await import('./check.mjs');
    const schemas = loadSchemas();
    return (f) => check('one-click', f, schemas).ok;
  } catch {
    return null;
  }
}

export async function run({ dealTimingFile, runsDir, op1 = DEFAULTS.op1, op2 = DEFAULTS.op2, rpc = DEFAULTS.sepoliaRpc, sources = new Sources(), nowMs = Date.now() } = {}) {
  let dealTiming = null;
  if (dealTimingFile) {
    dealTiming = readJsonFile(dealTimingFile);
    if (dealTiming?.schema !== 'crow.metrics.deal-timing/1') dealTiming = null;
  } else {
    dealTiming = await runDealTiming({ op1, op2, sources, nowMs });
  }
  const discovery = (await sources.json('discovery', `${op1}/`)) ?? (await sources.json('discovery', `${op2}/`));
  const accounts = crowAccounts(discovery, loadFallbackAccounts());
  const prices = readJsonFile(join(ROOT, 'config/ops-cost-prices.json'));
  const modelPrices = readJsonFile(join(ROOT, 'config/model-prices.json'));
  const deals = dealTiming?.deals ?? [];
  const token = typeof discovery?.demo?.token?.id === 'string' && ADDRESS.test(discovery.demo.token.id) ? discovery.demo.token.id.toLowerCase() : null;
  const [faucetMintGas, effectiveGasPrices, balances, receiptGas] = await Promise.all([
    readFaucetMints(sources, rpc, { deals, token, fundingLane: accounts.fundingLane }),
    readEffectiveGasPrices(sources, rpc, deals),
    readBalances(sources, rpc, accounts),
    readReceiptGas(sources, rpc, deals),
  ]);
  // Only a run file that passes the one-click schema is priced: one with a worker missing its request count would
  // otherwise read as 0 requests and USD 0.
  const isValid = runsDir ? await loadRunCheck() : null;
  const tail = isValid ? newestTailRun(runsDir, isValid) : { run: null, skipped: 0 };
  const body = buildOpsCost({ dealTiming, prices, modelPrices, discovery, oneClick: tail.run, faucetMintGas, effectiveGasPrices, balances, receiptGas });
  const { gaps, ...rest } = body;
  if (runsDir && !isValid) gaps.push('Ajv could not be loaded, so no run file can be checked against its schema and Cloudflare reads unknown.');
  if (tail.skipped) gaps.push(`${tail.skipped} run files failed the one-click schema check and are left out.`);
  if (accounts.dealLanesSource !== 'discovery demo.relayer.dealLanes') gaps.push(`The deal lanes come from ${accounts.dealLanesSource}.`);
  const commit = gitCommit(ROOT);
  return { ...envelope('ops-cost', { script: 'scripts/metrics/ops-cost.mjs', commit, generatedAt: nowMs, sources: sources.list, gaps }), ...rest };
}

if (isMain(import.meta.url)) {
  const args = cli({ out: { type: 'string' }, 'deal-timing': { type: 'string' }, runs: { type: 'string' }, op1: { type: 'string' }, op2: { type: 'string' }, rpc: { type: 'string' } });
  const t0 = Date.now();
  const out = await run({
    ...(args['deal-timing'] ? { dealTimingFile: args['deal-timing'] } : {}),
    ...(args.runs ? { runsDir: args.runs } : {}),
    ...(args.op1 ? { op1: args.op1 } : {}),
    ...(args.op2 ? { op2: args.op2 } : {}),
    ...(args.rpc ? { rpc: args.rpc } : {}),
  });
  if (args.out) writeJson(args.out, out);
  else process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  const t = out.perDeal.total.checksOnly;
  console.error(`ops-cost: ${out.perDeal.gas.totalGas.median ?? 'unknown'} gas a deal; checks-only total micro-USD sepolia ${t.sepolia ?? 'unknown'}, ethereum ${t.ethereum ?? 'unknown'}, base ${t.base ?? 'unknown'}; fee ${out.perDeal.operatorFee.usdMicrosAtPar ?? 'unknown'}; in ${Date.now() - t0} ms`);
}
