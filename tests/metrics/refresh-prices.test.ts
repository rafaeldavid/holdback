// T-066: refresh-prices.mjs with fake JSON-RPC only. It reads Ethereum and Base mainnet for fee data, so these tests
// pin that it sends read methods only, that `asOf` never reads fresher than its oldest value, and that a refresh that
// read nothing changes nothing.
import { describe, expect, it } from 'vitest';
import { check } from '../../scripts/metrics/check.mjs';
import { Sources } from '../../scripts/metrics/lib.mjs';
import { CHAINLINK_ETH_USD, GAS_PRICE_ORACLE, READ_METHODS, RPC, gasPriceFromFeeHistory, refresh, usdMicrosFromRound } from '../../scripts/metrics/refresh-prices.mjs';
import { NOW, config } from './helpers';

const word = (n: bigint) => n.toString(16).padStart(64, '0');
const UPDATED_AT = BigInt(Math.floor(Date.parse('2026-11-05T15:25:11Z') / 1000));
/** latestRoundData's five words: round 1, answer 2,273.205 USD (8 decimals), started 0, updated 15:25:11 UTC, round 1. */
const ROUND = `0x${[1n, 227_320_500_000n, 0n, UPDATED_AT, 1n].map(word).join('')}`;
const L1_FEE = `0x${word(1_089_173_992_688n)}`;
const HISTORY = {
  // The next block's base fee is the last entry: 1 gwei on Ethereum, 0.01 gwei on Base.
  ethereum: { baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'], reward: [['0x5f5e100'], ['0x2faf080'], ['0x77359400']] },
  base: { baseFeePerGas: ['0x989680', '0x989680'], reward: [['0xf4240']] },
};

type Call = { id: number; method: string; params: unknown[] };

/** A fake fetch for both mainnet RPCs. It records every method sent; hosts in `down` refuse the connection. */
function fakeRpc({ down = [] as string[], chain = { ethereum: '0x1', base: '0x2105' } } = {}) {
  const methods: string[] = [];
  const net = (host: string) => (host === new URL(RPC.ethereum).host ? 'ethereum' : host === new URL(RPC.base).host ? 'base' : null);
  const fetchImpl = async (url: string, init: RequestInit) => {
    const host = new URL(url).host;
    const n = net(host);
    if (!n || down.includes(n)) throw new TypeError('fetch failed');
    const calls = JSON.parse(String(init.body)) as Call[];
    return new Response(JSON.stringify(calls.map((c) => {
      methods.push(c.method);
      const to = (c.params[0] as { to?: string } | undefined)?.to;
      let result: unknown = null;
      if (c.method === 'eth_chainId') result = chain[n];
      else if (c.method === 'eth_feeHistory') result = HISTORY[n];
      else if (c.method === 'eth_call' && n === 'ethereum' && to === CHAINLINK_ETH_USD) result = ROUND;
      else if (c.method === 'eth_call' && n === 'base' && to === GAS_PRICE_ORACLE) result = L1_FEE;
      return result === null ? { jsonrpc: '2.0', id: c.id, error: { code: -32601 } } : { jsonrpc: '2.0', id: c.id, result };
    })));
  };
  return { fetchImpl, methods };
}

/** The tracked price file with every value read on 2026-01-01, so a stale date shows. */
function stale() {
  const f = config('ops-cost-prices.json');
  const old = '2026-01-01T00:00:00Z';
  f.asOf = '2026-01-01';
  f.usdMicrosPerEth.readAt = old;
  f.gas.ethereum.readAt = old;
  f.gas.base.readAt = old;
  f.gas.base.l1Fee.readAt = old;
  return f;
}

describe('refresh-prices parsers', () => {
  it("prices gas as the next block's base fee plus the median tip", () => {
    // 1 gwei + the median of 0.1, 0.05 and 2 gwei (nearest rank: 0.1 gwei) = 1.1 gwei.
    expect(gasPriceFromFeeHistory(HISTORY.ethereum)).toBe('1100000000');
    expect(gasPriceFromFeeHistory({ baseFeePerGas: ['0x1'], reward: [] })).toBe(null);
    expect(gasPriceFromFeeHistory({ baseFeePerGas: ['not hex'], reward: [['0x1']] })).toBe(null);
    expect(gasPriceFromFeeHistory(null)).toBe(null);
  });

  it("reads Chainlink's 8-decimal answer as micro-USD per ETH, and refuses a malformed or negative one", () => {
    expect(usdMicrosFromRound(ROUND)).toEqual({ usdMicros: '2273205000', updatedAtMs: Number(UPDATED_AT) * 1000 });
    expect(usdMicrosFromRound(ROUND.slice(0, -2))).toBe(null);
    const negative = `0x${[1n, (1n << 256n) - 5n, 0n, UPDATED_AT, 1n].map(word).join('')}`;
    expect(usdMicrosFromRound(negative)).toBe(null);
    expect(usdMicrosFromRound(`0x${[1n, 0n, 0n, UPDATED_AT, 1n].map(word).join('')}`)).toBe(null);
  });
});

describe('refresh-prices against mainnet RPCs', () => {
  it('sends read methods only: eth_chainId, eth_feeHistory and eth_call', async () => {
    expect([...READ_METHODS]).toEqual(['eth_chainId', 'eth_feeHistory', 'eth_call']);
    const { fetchImpl, methods } = fakeRpc();
    await refresh({ current: stale(), sources: new Sources({ fetchImpl }), nowMs: NOW });
    expect(methods.length).toBe(6);
    expect(methods.every((m) => READ_METHODS.includes(m))).toBe(true);
  });

  it('refreshes all four values and dates the file by them', async () => {
    const { fetchImpl } = fakeRpc();
    const { file, refreshed, notes } = await refresh({ current: stale(), sources: new Sources({ fetchImpl }), nowMs: NOW });
    expect(refreshed).toBe(4);
    expect(notes).toEqual([]);
    expect(file.asOf).toBe('2026-11-05');
    expect(file.usdMicrosPerEth).toMatchObject({ value: '2273205000', readAt: '2026-11-05T15:00:00Z', basis: 'measured' });
    expect(file.gas.ethereum.gasPriceWei).toBe('1100000000');
    expect(file.gas.base.gasPriceWei).toBe('11000000');
    expect(file.gas.base.l1Fee).toMatchObject({ weiPerTx: '1089173992688', txBytes: 2400 });
    expect(check('ops-cost-prices', file)).toEqual({ ok: true, errors: [] });
  });

  it('keeps every value and the old date when every read fails', async () => {
    const { fetchImpl } = fakeRpc({ down: ['ethereum', 'base'] });
    const before = stale();
    const { file, refreshed } = await refresh({ current: before, sources: new Sources({ fetchImpl }), nowMs: NOW });
    expect(refreshed).toBe(0);
    expect(file).toEqual(before);
    expect(file.asOf).toBe('2026-01-01');
  });

  it('dates the file by its oldest value when only some reads succeed', async () => {
    const { fetchImpl } = fakeRpc({ down: ['base'] });
    const { file, refreshed, notes } = await refresh({ current: stale(), sources: new Sources({ fetchImpl }), nowMs: NOW });
    expect(refreshed).toBe(2);
    expect(file.gas.ethereum.readAt).toBe('2026-11-05T15:00:00Z');
    expect(file.gas.base.readAt).toBe('2026-01-01T00:00:00Z');
    expect(file.asOf).toBe('2026-01-01');
    expect(notes.some((n: string) => /^base: /.test(n))).toBe(true);
  });

  it('keeps a network as it was when its RPC answers another chain id', async () => {
    const { fetchImpl } = fakeRpc({ chain: { ethereum: '0xaa36a7', base: '0x2105' } });
    const { file, refreshed, notes } = await refresh({ current: stale(), sources: new Sources({ fetchImpl }), nowMs: NOW });
    expect(refreshed).toBe(2);
    expect(file.usdMicrosPerEth.readAt).toBe('2026-01-01T00:00:00Z');
    expect(notes).toContain('ethereum: the RPC did not answer chain id 1; its prices are kept as they were.');
  });
});
