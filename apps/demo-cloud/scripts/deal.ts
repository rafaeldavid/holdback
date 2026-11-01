// One checks-only deal between two fresh agents against a hosted Holdback (T-026): the public demo on
// Cloudflare, or `pnpm demo-cloud:dev` locally. Each agent makes its own keys, takes test tUSD and a mandate
// from POST /v1/faucet, and then runs the examples' agent (examples/agent.ts: fetch, viem, tweetnacl), which
// verifies every prepared message against its own intent before signing. Exits 0 once the deal is Released
// and final; prints each step and a JSON summary.
//
//   node apps/demo-cloud/scripts/deal.ts https://holdback-op1.<sub>.workers.dev https://holdback-op2.<sub>.workers.dev
import nacl from 'tweetnacl';
import { generatePrivateKey } from 'viem/accounts';
import { Agent } from '../../../examples/agent.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const urls = process.argv.slice(2).filter((a) => /^https?:\/\//.test(a)).map((u) => u.replace(/\/+$/, ''));
if (urls.length < 2) {
  console.error('usage: node apps/demo-cloud/scripts/deal.ts <operator 1 URL> <operator 2 URL>');
  process.exit(2);
}
const started = Date.now();
const log = (s: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s] ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const index = (await (await fetch(`${urls[0]}/`)).json()) as J;
if (index.chainId !== 31337) throw new Error(`refusing: ${urls[0]} is not on SimChain (chain id 31337)`);
log(`${index.notice}`);
const window = Number(index.minWindowSec ?? 60);

const fresh = () => new Agent(urls, generatePrivateKey(), nacl.randomBytes(32));
const buyer = fresh();
const seller = fresh();
for (const [name, a] of [['buyer', buyer], ['seller', seller]] as const) {
  const g = await a.call('POST', '/v1/faucet', { address: a.address });
  log(`${name} ${a.address}: faucet granted ${g.granted.amount} base units, mandate in ${g.clubId}`);
}

const [primary, fallback, appeal] = index.adjudicators.map((a: J) => a.address);
const offer = await seller.offer({
  template: 'checks-only',
  clubId: index.clubId,
  seller: seller.address,
  buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
  adjudicators: { primary, fallback, appeal },
  price: { token: 'tUSD', amount: '25000000' },
  deliverable: { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' },
  checks: [
    { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
    { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
    { id: 'uniq', type: 'unique_key', required: true, columns: ['customer_id'] },
  ],
  timing: { judgeWithinSec: window, fallbackWithinSec: window, appealWindowSec: window, appealDecideSec: window },
});
log(`offer ${offer.id}: ${offer.state.escrowState}`);
await buyer.waitFor(offer.id, ['AcceptedByAdjudicator'], 60_000);
log('primary adjudicator accepted the offer');
const held = await buyer.agreeAndFund(offer.terms, 30_000_000n);
log(`buyer agreed and funded: ${held.escrowState}, hold ${held.hold.amount.amount} base units`);
const csv = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n';
await seller.deliver(offer.terms, new TextEncoder().encode(csv));
log('seller delivered (encrypted, key sealed to the adjudicators and the buyer)');
const done = await buyer.waitFor(offer.id, ['Released', 'Refunded'], 120_000);
log(`outcome: ${done.escrowState}`);
let state: J = done;
for (const end = Date.now() + (window + 120) * 1000; !state.finalAt && Date.now() < end; await sleep(2000)) state = await buyer.call('GET', `/v1/commitments/${offer.id}`);
log(state.finalAt ? `final at ${state.finalAt}` : 'not final yet');
const opened = done.escrowState === 'Released' ? await buyer.openDelivery(offer.id) : '';
if (opened) log(`buyer opened the delivery: ${opened.split('\n').length - 1} lines, hashes match`);
const balance = async (a: Agent) => (await a.call('GET', `/v1/balances/${a.address}`)).amount;
const receipts = await Promise.all(urls.map(async (u) => (await buyer.call('GET', `/v1/commitments/${offer.id}/receipts`, undefined, u)).items.length));
const summary = {
  operators: urls,
  commitmentId: offer.id,
  escrowState: state.escrowState,
  settledAt: state.settledAt,
  finalAt: state.finalAt,
  balances: { buyer: await balance(buyer), seller: await balance(seller) },
  receiptsPerOperator: receipts,
  seconds: Math.round((Date.now() - started) / 1000),
};
console.log(JSON.stringify(summary, null, 2));
process.exit(state.escrowState === 'Released' && state.finalAt ? 0 : 1);
