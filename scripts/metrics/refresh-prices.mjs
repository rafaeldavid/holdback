#!/usr/bin/env node
// Refreshes the gas and ETH prices in config/ops-cost-prices.json (T-066) from keyless public sources:
// - gas prices: eth_feeHistory over the last 20 blocks on public Ethereum and Base RPC endpoints: the next block's
//   base fee plus the median of each block's 50th-percentile tip;
// - Base's L1 data fee: the OP Stack GasPriceOracle predeploy's getL1FeeUpperBound(txBytes), for the transaction
//   size the file names;
// - the ETH price: Chainlink's ETH/USD feed on Ethereum, latestRoundData(), read with eth_call.
// It only reads fee data: it imports no settlement code, holds no key and signs nothing, and it sends only the
// JSON-RPC methods in READ_METHODS to mainnet. The Cloudflare prices and the tUSDC rate have no keyless source; they
// stay as entered by hand, with their dates.
// `asOf` is the date of the oldest of the four values it refreshes, so a value it could not read keeps the file's
// date old. When it reads nothing, it writes nothing and exits 1.
//
//   node scripts/metrics/refresh-prices.mjs --dry-run      # prints the new file and its sources
//   node scripts/metrics/refresh-prices.mjs                # writes config/ops-cost-prices.json (commit it by PR)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, Sources, bigQuantile, cli, hexToDec, isMain, iso, writeJson } from './lib.mjs';

export const RPC = { ethereum: 'https://ethereum-rpc.publicnode.com', base: 'https://base-rpc.publicnode.com' };
export const CHAIN_ID = { ethereum: '1', base: '8453' };
/** Chainlink ETH/USD on Ethereum mainnet (8 decimals). */
export const CHAINLINK_ETH_USD = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';
/** The OP Stack GasPriceOracle predeploy, the same address on every OP Stack chain. */
export const GAS_PRICE_ORACLE = '0x420000000000000000000000000000000000000F';
// Selectors, from viem's toFunctionSelector (measured 2026-11-05).
export const SELECTOR = { latestRoundData: '0xfeaf968c', getL1FeeUpperBound: '0xf1c7a58b' };
/** The only JSON-RPC methods this script sends to mainnet. Each one reads; none signs or sends a transaction. */
export const READ_METHODS = Object.freeze(['eth_chainId', 'eth_feeHistory', 'eth_call']);

/** The oldest `readAt` day among the four refreshed values, or null when none has one. */
export function oldestReadOn(file) {
  const days = [file?.usdMicrosPerEth?.readAt, file?.gas?.ethereum?.readAt, file?.gas?.base?.readAt, file?.gas?.base?.l1Fee?.readAt]
    .filter((t) => typeof t === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(t))
    .map((t) => t.slice(0, 10))
    .sort();
  return days.length ? days[0] : null;
}

/** The gas price from an eth_feeHistory result: the next block's base fee plus the median 50th-percentile tip. */
export function gasPriceFromFeeHistory(h) {
  const base = Array.isArray(h?.baseFeePerGas) ? hexToDec(h.baseFeePerGas[h.baseFeePerGas.length - 1]) : null;
  const tips = Array.isArray(h?.reward) ? h.reward.map((r) => (Array.isArray(r) ? hexToDec(r[0]) : null)).filter((v) => v !== null) : [];
  const tip = bigQuantile(tips, 50);
  return base === null || tip === null ? null : (BigInt(base) + BigInt(tip)).toString();
}

/** Chainlink's answer (8 decimals) as micro-USD per ETH, and its update time; null on a malformed answer. */
export function usdMicrosFromRound(hex) {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]{320}$/.test(hex)) return null;
  const word = (i) => BigInt(`0x${hex.slice(2 + 64 * i, 2 + 64 * (i + 1))}`);
  const answer = word(1);
  if (answer <= 0n || answer >= 1n << 255n) return null;
  return { usdMicros: (answer / 100n).toString(), updatedAtMs: Number(word(3)) * 1000 };
}

const word = (n) => BigInt(n).toString(16).padStart(64, '0');

/**
 * Reads new prices into a copy of `current`. Returns { file, notes, refreshed }: `refreshed` counts the values read
 * (0 to 4); a value that could not be read is kept as it was, with its old readAt.
 */
export async function refresh({ current, sources = new Sources(), nowMs = Date.now() }) {
  const readAt = iso(nowMs);
  const out = structuredClone(current ?? {});
  const notes = [];
  let refreshed = 0;
  const txBytes = Number.isSafeInteger(current?.gas?.base?.l1Fee?.txBytes) ? current.gas.base.l1Fee.txBytes : 2400;

  for (const net of ['ethereum', 'base']) {
    const calls = [
      { method: 'eth_chainId', params: [] },
      { method: 'eth_feeHistory', params: ['0x14', 'latest', [50]] },
    ];
    if (net === 'base') calls.push({ method: 'eth_call', params: [{ to: GAS_PRICE_ORACLE, data: `${SELECTOR.getL1FeeUpperBound}${word(txBytes)}` }, 'latest'] });
    if (net === 'ethereum') calls.push({ method: 'eth_call', params: [{ to: CHAINLINK_ETH_USD, data: SELECTOR.latestRoundData }, 'latest'] });
    const unlisted = calls.find((c) => !READ_METHODS.includes(c.method));
    if (unlisted) throw new Error(`refresh-prices sends read methods only; ${unlisted.method} is not one`);
    const [chain, history, call] = await sources.rpc(`${net}-fees`, RPC[net], calls, { batch: 3 });
    if (hexToDec(chain) !== CHAIN_ID[net]) {
      notes.push(`${net}: the RPC did not answer chain id ${CHAIN_ID[net]}; its prices are kept as they were.`);
      continue;
    }
    const gasPriceWei = gasPriceFromFeeHistory(history);
    if (gasPriceWei !== null) {
      out.gas ??= {};
      out.gas[net] = {
        ...(out.gas[net] ?? {}),
        gasPriceWei,
        source: `eth_feeHistory over 20 blocks on ${RPC[net]}: the next block's base fee plus the median 50th-percentile tip`,
        readAt,
        basis: 'measured',
      };
      refreshed += 1;
    } else notes.push(`${net}: eth_feeHistory gave no gas price; it is kept as it was.`);
    if (net === 'base') {
      const fee = hexToDec(call);
      if (fee !== null) {
        out.gas ??= {};
        out.gas.base ??= {};
        out.gas.base.l1Fee = {
          ...(out.gas.base.l1Fee ?? {}),
          weiPerTx: fee,
          txBytes,
          method: `GasPriceOracle (${GAS_PRICE_ORACLE}) getL1FeeUpperBound(${txBytes}): an upper bound for one transaction of that size`,
          source: RPC.base,
          readAt,
          basis: 'inferred',
        };
        refreshed += 1;
      } else notes.push("base: the GasPriceOracle gave no L1 fee; it is kept as it was.");
    }
    if (net === 'ethereum') {
      const round = usdMicrosFromRound(call);
      if (round) {
        out.usdMicrosPerEth = {
          value: round.usdMicros,
          source: `Chainlink ETH/USD (${CHAINLINK_ETH_USD}) latestRoundData on ${RPC.ethereum}, updated ${iso(round.updatedAtMs)}`,
          readAt,
          basis: 'measured',
        };
        refreshed += 1;
      } else notes.push('ethereum: Chainlink gave no ETH price; it is kept as it was.');
    }
  }
  // The file is as fresh as its oldest value, never fresher.
  const asOf = oldestReadOn(out);
  if (asOf !== null) out.asOf = asOf;
  return { file: out, notes, refreshed };
}

if (isMain(import.meta.url)) {
  const args = cli({ 'dry-run': { type: 'boolean' } });
  const path = join(ROOT, 'config/ops-cost-prices.json');
  let current = null;
  try {
    current = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    current = null;
  }
  const sources = new Sources();
  const { file, notes, refreshed } = await refresh({ current, sources });
  for (const s of sources.list) console.error(`${s.ok ? 'ok  ' : 'FAIL'} ${s.id} ${s.url} ${s.ms} ms${s.error ? ` (${s.error})` : ''}`);
  for (const n of notes) console.error(n);
  if (!refreshed) {
    console.error('refresh-prices: no price could be read, so config/ops-cost-prices.json is left as it was');
    process.exit(1);
  }
  console.error(`refresh-prices: ${refreshed} of 4 values read; asOf ${file.asOf}`);
  if (args['dry-run']) process.stdout.write(`${JSON.stringify(file, null, 2)}\n`);
  else {
    writeJson(path, file);
    console.error('wrote config/ops-cost-prices.json; review the diff and commit it by PR');
  }
}
