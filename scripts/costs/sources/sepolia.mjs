// Sepolia ETH balances of the demo's gas payers, read with eth_getBalance on a public RPC: no credential.
// The funding lane and the demo adjudicators come from the demo's discovery document; the deal lanes and the
// deployer, which discovery does not name, come from `sepolia.addresses` in budgets.json. No address is
// hard-coded. A deal lane below the floor is read again after two minutes, because the world tops lanes up from
// the funding lane at most once a minute (apps/demo-cloud/src/world.ts): T-054's rule needs both reads.
import { compareDecimals, hexToDecimal, makeLine } from '../money.mjs';
import { SourceError, getJson } from './http.mjs';

export const id = 'sepolia';
export const credentials = [];

const SEPOLIA_CHAIN_ID = '11155111';
const DEFAULTS = {
  discoveryUrl: 'https://api.escrow.stream/',
  rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
  laneFloorWei: '10000000000000000',
  secondReadAfterMs: 120_000,
};
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

async function rpc(ctx, url, method, params) {
  const body = await getJson(ctx, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!body || body.error || typeof body.result !== 'string') throw new SourceError('chain');
  return body.result;
}

/** The public addresses to read: discovery's, then the configured ones, each once. */
export function addressesFrom(discovery, configured = []) {
  const out = [];
  const seen = new Set();
  const add = (label, address, kind) => {
    if (!ADDRESS.test(address ?? '') || seen.has(address.toLowerCase())) return;
    seen.add(address.toLowerCase());
    out.push({ label, address, kind });
  };
  const s = discovery?.settlement;
  if (s?.kind === 'chain' && String(s.chainId) === SEPOLIA_CHAIN_ID) {
    for (const note of Array.isArray(discovery.notes) ? discovery.notes : []) {
      const m = /funded from (0x[0-9a-fA-F]{40})/.exec(String(note));
      if (m) add('funding lane', m[1], 'funding-lane');
    }
    for (const a of Array.isArray(discovery?.demo?.adjudicators) ? discovery.demo.adjudicators : []) {
      add(`adjudicator (${String(a?.role ?? 'unnamed')})`, a?.address, 'adjudicator');
    }
  }
  for (const a of configured) add(String(a?.label ?? 'configured'), a?.address, String(a?.kind ?? 'other'));
  return out;
}

export async function collect(ctx) {
  const cfg = { ...DEFAULTS, ...(ctx.config?.sepolia ?? {}) };
  const discovery = await getJson(ctx, cfg.discoveryUrl);
  const addresses = addressesFrom(discovery, Array.isArray(cfg.addresses) ? cfg.addresses : []);
  if (addresses.length === 0) return [];
  if (hexToDecimal(await rpc(ctx, cfg.rpcUrl, 'eth_chainId', [])) !== SEPOLIA_CHAIN_ID) throw new SourceError('chain');
  const balance = async (a) => hexToDecimal(await rpc(ctx, cfg.rpcUrl, 'eth_getBalance', [a.address, 'latest']));
  const line = (product, wei) =>
    makeLine({ source: id, product, unit: 'wei', quantity: wei, basis: 'balance', periodFrom: ctx.period.to, periodTo: ctx.period.to });

  const lines = [];
  const low = [];
  for (const a of addresses) {
    const wei = await balance(a);
    lines.push(line(`Sepolia ${a.label} ${a.address}`, wei));
    if (a.kind === 'deal-lane' && compareDecimals(wei, cfg.laneFloorWei) < 0) low.push(a);
  }
  if (low.length) {
    await ctx.sleep(Number(cfg.secondReadAfterMs));
    for (const a of low) lines.push(line(`Sepolia ${a.label} ${a.address} (second read)`, await balance(a)));
  }
  return lines;
}
