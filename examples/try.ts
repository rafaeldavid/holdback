// One test deal on the ’crow demo, both sides played here with fresh keys. Test tokens only (tUSD on SimChain,
// tUSDC on Sepolia): nothing here is real money. The faucet funds a buyer and a seller; the seller offers 3 rows of
// customer_id,email for 25 test dollars
// under three declarative checks; the buyer checks the offer on both operators, then agrees and funds; the seller
// encrypts and delivers; the adjudicator's checks decide; the buyer opens its copy. Every message an operator
// prepares is rebuilt from this script's own intent and checked before it is signed (verify.ts).
//
// It calls only the two operators below, keeps its keys in memory and writes no files. It prints one line per
// step, then the commitment ID and the final state. It exits 0 when the deal is Released, 3 when it refuses to
// sign something, and 1 when anything else stops it.
//
//   node try.mjs                     the bundle served at https://escrow.stream/try.mjs (node site/build.mjs)
//   node examples/try.ts             from the repository
//   HOLDBACK_OPERATORS=<url>,<url>   other operators (two distinct origins)
//
// Source: https://github.com/rafaeldavid/holdback/blob/main/examples/try.ts, with agent.ts and verify.ts.
import nacl from 'tweetnacl';
import { recoverTypedDataAddress, type Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { Agent } from './agent.ts';
import { commitmentIdOf, jcs, knownPins, operatorFeeOf, Refusal, typedOf } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const OPERATORS = (process.env['HOLDBACK_OPERATORS'] || 'https://api.escrow.stream,https://api2.escrow.stream').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const PRICE_UNITS = '25000000'; // 25 tUSD: 6 decimals
const DELIVERABLE = { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' };
const CHECKS = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
  { id: 'uniq', type: 'unique_key', required: true, columns: ['customer_id'] },
];
// The demo club's shortest judge, fallback and appeal windows: the deal is final a minute after the decision.
const TIMING = { judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 60, appealDecideSec: 60 };
const CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n';

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;
/** Base units of a 6-decimal token as a decimal string, in integer arithmetic. */
const units = (base: string | bigint) => {
  const v = BigInt(base);
  const frac = (v % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${v / 1_000_000n}${frac ? `.${frac}` : ''}`;
};
/** The test token's symbol, from the settlement layer this script pins: tUSD on SimChain, tUSDC on Sepolia. */
let symbol = 'tUSD';
const tusd = (base: string | bigint) => `${units(base)} ${symbol}`;
/** JSON with every 0x-hex string lowercased: addresses compare ignoring case. */
const lowerHex = (v: J): J => JSON.parse(JSON.stringify(v), (_k, x) => (typeof x === 'string' && /^0x[0-9a-fA-F]+$/.test(x) ? x.toLowerCase() : x));
const same = (a: J, b: J) => jcs(lowerHex(a)) === jcs(lowerHex(b));
const refuse = (why: string): never => {
  throw new Refusal(`refusing to agree: ${why}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let step = 'start';
const say = (text: string) => console.log(`${step.padEnd(9)} ${text}`);

/** Polls every operator until each reports one of `states`. A stall names the states seen and the operators' notices. */
async function until(agent: Agent, id: Hex, states: string[], timeoutMs: number): Promise<J> {
  let seen: J[] = [];
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(400)) {
    seen = await Promise.all(agent.sources().map((api) => agent.call('GET', `/v1/commitments/${id}`, undefined, api)));
    if (seen.every((s) => states.includes(s.escrowState))) return seen[0];
  }
  const notices = [...new Set(seen.flatMap((s) => s.notices ?? []))];
  throw new Error(`still ${seen.map((s) => s.escrowState).join(' / ')} after ${timeoutMs / 1000} s, waiting for ${states.join(' or ')}${notices.length ? `; the operators say: ${notices.join(' | ')}` : ''}`);
}

async function main() {
  const started = Date.now();
  console.log(`’crow test deal on ${OPERATORS.join(' and ')}: test tokens only, nothing here is real money`);
  if (!globalThis.crypto?.subtle || typeof fetch !== 'function') throw new Error(`this needs Node 20 or later (Web Crypto and fetch); this is Node ${process.versions.node}`);

  step = 'keys';
  // Discovery as every operator serves it, and the settlement layers this script pins (never the operator's):
  // SimChain, and Sepolia's deployment, whose contracts and token it funds through.
  const reader = new Agent(OPERATORS, generatePrivateKey(), nacl.randomBytes(32));
  const found = await reader.trusted('/.well-known/holdback.json', (x) => ({ domain: x.domain, clubId: x.demo?.clubId, token: x.demo?.token?.id, adjudicators: x.demo?.adjudicators }));
  const pins = knownPins();
  const pin = pins.find((p) => same(p.domain, found.domain));
  if (!pin) throw new Refusal(`refusing to sign: the operators serve EIP-712 domain ${jcs(found.domain)}, not one pinned here (${pins.map((p) => jcs(p.domain)).join(' or ')})`);
  const PRICE = { token: pin.token.id, amount: PRICE_UNITS };
  symbol = pin.token.symbol;
  if (found.token !== PRICE.token || !found.clubId) throw new Error(`these operators run no ${symbol} demo (discovery has no demo.clubId or demo.token ${PRICE.token})`);
  const fresh = () => new Agent(OPERATORS, generatePrivateKey(), nacl.randomBytes(32), pin.domain, pin.chain);
  const buyer = fresh();
  const seller = fresh();
  if (pin.chain) say(`settling on chain ${pin.domain.chainId} through HoldbackRules ${pin.domain.verifyingContract}: each money step waits for a block`);
  const role = (r: string): string => {
    const a = found.adjudicators?.find((x: J) => x.role === r)?.address;
    if (!a) throw new Error(`discovery names no ${r} adjudicator under demo.adjudicators`);
    return a;
  };
  const [primary, fallback, appeal] = [role('primary'), role('fallback'), role('appeal')];
  say(`buyer ${short(buyer.address)}, seller ${short(seller.address)}: fresh keys, held in memory only`);

  step = 'faucet';
  const grants = await Promise.all([buyer, seller].map((a) => a.call('POST', '/v1/faucet', { address: a.address })));
  if (grants.some((g) => g.clubId !== found.clubId)) throw new Error(`the faucet admitted to ${grants.map((g) => g.clubId).join(', ')}, not ${found.clubId}`);
  say(`${tusd(grants[0].granted.amount)} each, both admitted to ${found.clubId}`);

  step = 'offer'; // the seller: the operator fills the terms; the seller rebuilds them from its request before signing
  const offer = await seller.offer({
    template: 'checks-only', clubId: found.clubId, seller: seller.address,
    buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey }, // what the buyer sent the seller
    adjudicators: { primary, fallback, appeal }, price: PRICE, deliverable: DELIVERABLE, checks: CHECKS, timing: TIMING,
  });
  say(`${short(offer.id)} ${offer.state.escrowState}: 3 rows of customer_id,email for ${tusd(PRICE.amount)}, checks ${CHECKS.map((c) => c.id).join(', ')}`);

  step = 'accepted';
  await until(buyer, offer.id, ['AcceptedByAdjudicator'], 60_000);
  say(`AcceptedByAdjudicator on every operator: the primary adjudicator ${short(primary)} takes the deal`);

  step = 'check'; // the buyer: the offer is a claim until checked against what every operator serves
  const terms = offer.terms; // as the seller sent it to the buyer
  const { id: servedId, signatures, ...served } = await buyer.trusted(`/v1/commitments/${offer.id}/terms`);
  if (!same(served, terms)) refuse('the terms the operators serve are not the ones the seller sent');
  const id = commitmentIdOf(terms);
  if (id !== offer.id || String(servedId).toLowerCase() !== id) refuse(`the commitment ID does not match the terms (recomputed ${id})`);
  const signer = await recoverTypedDataAddress({ ...typedOf('CommitmentTerms', terms, buyer.domain), signature: signatures?.seller });
  if (signer.toLowerCase() !== String(terms.seller).toLowerCase()) refuse("the seller's signature does not recover to the seller");
  const want: Array<[string, J, J]> = [
    ['buyer', terms.buyer, buyer.address], ['buyerEncryptionPublicKey', terms.buyerEncryptionPublicKey, buyer.encryptionPublicKey],
    ['price', terms.price, PRICE], ['clubId', terms.clubId, found.clubId], ['deliverable', terms.deliverable, DELIVERABLE],
    ['acceptance', terms.acceptance, { deterministicChecks: CHECKS, rubric: { criteria: [], passThreshold: 0 } }],
    ['adjudicators', [terms.adjudication.adjudicator, terms.adjudication.fallbackAdjudicator, terms.adjudication.appealAdjudicator], [primary, fallback, appeal]],
    ['adjudication.fee', terms.adjudication.fee, (await buyer.registration(primary)).fee.min],
  ];
  for (const [field, got, expected] of want) if (!same(got, expected)) refuse(`${field} is ${jcs(got)}, not the agreed ${jcs(expected)}`);
  const fee = BigInt(terms.adjudication.fee.amount);
  say(`the buyer: same terms on every operator, ID recomputed, seller's signature recovers; price, checks and adjudicators as agreed`);

  step = 'fund'; // the buyer: price plus adjudication fee into the hold, and the operator fee it computes itself
  const schedule = await buyer.operatorFeeSchedule();
  const operatorFee = schedule ? operatorFeeOf(terms.price, schedule) : 0n;
  const hold = BigInt(PRICE.amount) + fee;
  const held = await buyer.agreeAndFund(terms, hold + operatorFee);
  if (held.escrowState !== 'Held' || held.hold?.amount?.amount !== hold.toString()) throw new Error(`expected Held with ${hold} base units, got ${held.escrowState} ${jcs(held.hold?.amount ?? null)}`);
  say(`Held: ${tusd(hold)} held (${units(PRICE.amount)} price + ${units(fee)} adjudication fee), operator fee ${operatorFee ? tusd(operatorFee) : 'none'}`);

  step = 'deliver'; // the seller: once every operator shows Held, encrypt, upload, seal the key, sign the delivery
  await until(seller, id, ['Held'], 60_000);
  const { state: delivered, delivery } = await seller.deliverAndShare(terms, new TextEncoder().encode(CSV));
  if (!OPERATORS.some((op) => new URL(op).origin === new URL(delivery.ciphertext.uri).origin)) throw new Error(`the store answered a ciphertext URI on another host (${delivery.ciphertext.uri})`);
  say(`${delivered.escrowState}: ${delivery.ciphertext.bytes} encrypted bytes, the key sealed to ${delivery.encryptedKeys.length - 1} adjudicators and the buyer`);

  step = 'outcome';
  const done = await until(buyer, id, ['Released', 'Refunded'], 120_000);
  let decided = 'no judgment record served';
  try {
    const j = await buyer.call('GET', `/v1/commitments/${id}/judgment`);
    decided = `checks ${j.deterministic.map((c: J) => `${c.checkId} ${c.passed ? 'pass' : 'FAIL'}`).join(', ')}; decision ${j.aggregate.decision}`;
  } catch {
    // the record is informative only; the state above is what settled
  }
  say(`${done.escrowState}: ${decided}`);
  if (done.escrowState !== 'Released') throw new Error(`the deal ended ${done.escrowState}, not Released`);

  step = 'open'; // the buyer: its released envelope opens the content key; the hashes the seller signed are checked
  // The ciphertext is fetched from the URI the delivery event records: every operator must record the seller's.
  const recorded = await buyer.trusted(`/v1/commitments/${id}/events?limit=200`, (x) => x.items.find((e: J) => e.type === 'delivery.submitted')?.payload?.ciphertext?.uri ?? null);
  if (recorded !== delivery.ciphertext.uri) throw new Error(`the operators record the delivery at ${recorded}, not at ${delivery.ciphertext.uri} where the seller stored it`);
  const opened = await buyer.openDelivery(id);
  if (opened !== CSV) throw new Error('the buyer opened something other than what the seller delivered');
  const rows = opened.trimEnd().split('\n').slice(1);
  say(`the buyer decrypted its copy, sha256 checked: ${rows.length} rows, ${rows.join(' | ')}`);

  step = 'balances';
  const balance = async (a: Agent) => tusd(await a.trusted(`/v1/balances/${a.address}`, (x) => x.amount));
  say(`buyer ${await balance(buyer)}, seller ${await balance(seller)}`);

  if (pin.chain) {
    // Every money step is a transaction anyone can check: the hold, the delivery, the release with the buyer's key.
    step = 'chain';
    const events: J[] = await buyer.trusted(`/v1/commitments/${id}/events?limit=200`, (x) => x.items.filter((e: J) => typeof e.payload?.tx === 'string').map((e: J) => ({ seq: e.seq, type: e.type, tx: e.payload.tx })));
    const what: Record<string, string> = { 'fee.operator': 'funded', 'hold.funded': 'funded', 'delivery.submitted': 'delivered', 'judgment.decided': 'decided' };
    const seen = new Set<string>();
    for (const { type, tx } of events.sort((a, b) => a.seq - b.seq)) {
      if (seen.has(tx)) continue;
      seen.add(tx);
      say(`${(what[type] ?? type).padEnd(9)} ${pin.chain.explorer ? `${pin.chain.explorer}/tx/${tx}` : tx}`);
    }
  }

  step = 'final';
  say(`${done.escrowState} in ${Math.round((Date.now() - started) / 1000)} s; final at ${done.deadlines?.appealBy ?? 'the end of the appeal window'}, when the 60 s appeal window closes, with nobody needing to act`);
  step = 'done';
  say(`commitment ${id} ${done.escrowState}`);
}

try {
  await main();
  process.exit(0);
} catch (e) {
  const refused = e instanceof Refusal;
  console.error(`${refused ? 'refused' : 'stopped'} at ${step}: ${(e as Error).message}`);
  if (!refused) console.error('Nothing here is real money. Run it again for a fresh deal; the faucet allows 10 new addresses per hour per client.');
  process.exit(refused ? 3 : 1);
}
