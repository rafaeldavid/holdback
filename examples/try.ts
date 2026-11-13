// One test deal on the ’crow demo. Test tokens only (tUSD on SimChain, tUSDC on Sepolia): nothing here is real money.
//
// With --seller <intake URL>, this script is the buyer and Crow's test seller (apps/test-agents, D47) is the other
// party: the buyer seals a proposal to the seller's intake, as site/ref/intake.txt "Two agents, two people" describes,
// reads the commitment ID back with its status token, checks the offer on both operators against its own intent and
// the seller's published address, then agrees and funds; the seller delivers; the adjudicator's checks decide; the
// buyer opens its copy. With --outcome refund the buyer asks for work that fails a check, to see a refund. When the
// test seller is unreachable, busy or fails before it offers, the script says so and plays both sides itself.
//
// Without --seller it plays both sides with fresh keys: the faucet funds a buyer and a seller; the seller offers 3
// rows of customer_id,email for 25 test dollars under three declarative checks; the buyer checks the offer on both
// operators, then agrees and funds; the seller encrypts and delivers; the checks decide; the buyer opens its copy.
// Either way, every message an operator prepares is rebuilt from this script's own intent and checked before it is
// signed (verify.ts).
//
// It calls only the two operators below and the test seller you name, keeps its keys in memory and writes no files.
// It prints one line per step, then the commitment ID and the final state. It exits 0 when the deal ends as asked
// (Released, or Refunded with --outcome refund), 3 when it refuses to sign something, and 1 when anything else stops it.
//
//   node try.mjs [--seller <url>] [--outcome refund]   the bundle served at https://crow.direct/try.mjs (node site/build.mjs)
//   node examples/try.ts [--seller <url>]              from the repository
//   HOLDBACK_OPERATORS=<url>,<url>                     other operators (two distinct origins)
//
// Source: https://github.com/rafaeldavid/holdback/blob/main/examples/try.ts, with agent.ts and verify.ts.
import nacl from 'tweetnacl';
import { recoverTypedDataAddress, type Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { Agent } from './agent.ts';
import { finality } from './finality.ts';
import { commitmentIdOf, jcs, knownPins, operatorFeeOf, Refusal, sealKeyTo, typedOf } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const OPERATORS = (process.env['HOLDBACK_OPERATORS'] || 'https://api.crow.direct,https://api2.crow.direct').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const PRICE_UNITS = '25000000'; // 25 tUSD: 6 decimals
const DELIVERABLE = { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' };
const CHECKS = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
  { id: 'uniq', type: 'unique_key', required: true, columns: ['customer_id'] },
];
// The demo club's shortest judge, fallback and appeal-decision windows, and no appeal window (phase one): the decision is final.
const TIMING = { judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 };
const CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n';
/** What this script's own seller delivers when asked for a refund: 2 rows, which fail the rows check. */
const BAD_CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n';

const args = process.argv.slice(2);
// T-397: --help or -h first answers with what it does, the usage and an example, and runs nothing (exit 0); anywhere
// else it is a wrong call (exit 2). Kept here: try.mjs imports only viem and tweetnacl.
if (args.some((a) => a === '--help' || a === '-h')) {
  (args[0] === '--help' || args[0] === '-h' ? console.log : console.error)([
    "try: runs one test deal on Crow's demo with fresh keys, test tokens only. With --seller it is the buyer and Crow's test seller the other party; without, it plays both sides. --outcome refund asks for a refund.",
    'usage: node try.mjs [--seller <test seller URL>] [--outcome release|refund]',
    'example: node try.mjs --seller https://crow.direct/agents/test-seller',
  ].join('\n'));
  process.exit(args[0] === '--help' || args[0] === '-h' ? 0 : 2);
}
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const SELLER = option('--seller')?.replace(/\/+$/, '');
const OUTCOME = option('--outcome') ?? 'release';

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
const sha256hex = async (b: Uint8Array) => Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(b))).toString('hex');
/**
 * Text from the test seller, a party, as one plain line of at most 300 characters: line breaks become spaces, and
 * controls, bidi and tag characters go (as apps/demo/src/transcript/untrusted.ts), so it cannot fake a step line.
 */
const chars = (...ranges: Array<[number, number]>) => ranges.map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join('');
const LINE_BREAKS = new RegExp(`[${chars([0x0a, 0x0a], [0x0d, 0x0d], [0x2028, 0x2029])}]+`, 'g');
const CONTROLS = new RegExp(`[${chars([0x00, 0x1f], [0x7f, 0x9f])}]`, 'g');
const INVISIBLE = new RegExp(`[${chars([0x061c, 0x061c], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff], [0xe0000, 0xe007f])}]`, 'gu');
const plain = (s: unknown) => String(s ?? '').replace(LINE_BREAKS, ' ').replace(CONTROLS, '').replace(INVISIBLE, '').slice(0, 300);
/**
 * The windows this buyer accepts from the test seller, in seconds: the seller's published ones. Longer windows would
 * lock the buyer's hold longer if the seller stalled, since the buyer can reclaim only at deliverBy.
 */
const SELLER_WINDOWS = { deliverBy: 3600, judge: 60, fallback: 60, appealWindow: 0, appealDecide: 60 };

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

/** The test seller could not take the deal before offering it: the script plays both sides instead. */
class Unavailable extends Error {}

/** A JSON answer from the test seller, or Unavailable with why. */
async function fromSeller(url: string, init: RequestInit = {}): Promise<{ status: number; body: J }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new Unavailable(`${plain(url)} did not answer (${plain((e as Error).message)})`);
  }
  const body = (await res.json().catch(() => null)) as J;
  if (res.status === 429 || res.status === 503) throw new Unavailable(`it is busy: ${plain(body?.error ?? res.status)}${Number.isSafeInteger(body?.retryAfterSec) ? `; retry in ${body.retryAfterSec} s` : ''}`);
  if (!res.ok || body === null) throw new Unavailable(`${plain(url)} answered ${res.status}${body?.error ? `: ${plain(body.error)}` : ''}`);
  return { status: res.status, body };
}

/**
 * The buyer's side of the intake convention: read the seller's card, seal the proposal (exactly this script's terms,
 * plus the outcome it asks for) to the intake's key, store it on Crow, send the pointer, and poll the status until the
 * seller has offered. Returns the commitment ID and the seller's published address.
 */
async function askTestSeller(buyer: Agent, price: J): Promise<{ id: Hex; seller: string }> {
  step = 'seller';
  const card = (await fromSeller(`${SELLER}/agent.json`)).body;
  const origin = new URL(SELLER!).origin;
  if (card?.type !== 'crow-agent' || typeof card.seller !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(card.seller)) throw new Unavailable(`${SELLER}/agent.json is not a crow-agent card with a seller address`);
  // The intake and the status are on the seller's own domain: that is what makes the offer the seller's.
  if (new URL(card.intake?.api ?? '').origin !== origin || new URL(card.intake?.status ?? '').origin !== origin) throw new Unavailable(`the card's intake is not on ${origin}`);
  if (!/^[A-Za-z0-9_-]{43}$/.test(card.intake?.encryptionPublicKey ?? '')) throw new Unavailable("the card's intake has no x25519 encryptionPublicKey");
  const seller = String(card.seller).toLowerCase();
  const total = card.offers?.[0]?.fees?.total?.amount;
  say(`Crow's test seller at ${SELLER}: it offers from ${short(seller)}${typeof total === 'string' && /^[0-9]{1,30}$/.test(total) ? `, ${tusd(total)} in all for this deal` : ''}`);

  step = 'propose';
  const proposal = {
    type: 'crow-proposal', buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, want: '3 rows of customer_id,email',
    budget: { token: price.token, amount: price.amount, covers: 'price' },
    terms: { price, deliverable: DELIVERABLE, template: 'checks-only', disclosure: 'public', checks: CHECKS },
    ...(OUTCOME === 'refund' ? { test: { outcome: 'refund' } } : {}),
  };
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array([...iv, ...new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify(proposal))))]);
  const stored = await buyer.call('POST', '/v1/ciphertext', ct);
  if (stored.id !== `sha256:${await sha256hex(ct)}`) throw new Error('the ciphertext store answered another hash');
  // The status token stays here; the seller sees only its SHA-256.
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
  const request = { type: 'crow-request', proposal: { uri: stored.uri, sha256: stored.id }, sealedKey: sealKeyTo(key, 'intake', card.intake.encryptionPublicKey).ciphertext, statusTokenHash: await sha256hex(new TextEncoder().encode(token)), from: 'try.mjs' };
  await fromSeller(card.intake.api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  say(`sealed proposal stored on Crow (${stored.bytes} bytes) and sent to the intake: ${OUTCOME === 'refund' ? 'asking for work that fails a check, to see a refund' : 'the seller\'s own terms'}`);

  step = 'offered';
  let s: J;
  for (const end = Date.now() + 120_000; Date.now() < end; await sleep(1000)) {
    s = (await fromSeller(`${card.intake.status}?token=${token}`)).body;
    if (s.status === 'failed') throw new Unavailable(`it failed the request: ${plain(s.detail)}`);
    if (s.status === 'offered' && /^0x[0-9a-f]{64}$/.test(s.commitmentId ?? '')) {
      if (String(s.seller).toLowerCase() !== seller) refuse(`the status names seller ${plain(s.seller)}, not the published ${seller}`);
      say(`${short(s.commitmentId)} offered by the test seller${s.countered ? ' as a counter-offer' : ''}`);
      return { id: s.commitmentId as Hex, seller };
    }
  }
  throw new Unavailable(`no offer within 120 s (status ${plain(s?.status ?? 'unknown')}${s?.detail ? `: ${plain(s.detail)}` : ''})`);
}

async function main() {
  const started = Date.now();
  console.log(`’crow test deal on ${OPERATORS.join(' and ')}: test tokens only, nothing here is real money`);
  if (!globalThis.crypto?.subtle || typeof fetch !== 'function') throw new Error(`this needs Node 20 or later (Web Crypto and fetch); this is Node ${process.versions.node}`);
  if (OUTCOME !== 'release' && OUTCOME !== 'refund') throw new Error(`--outcome is release or refund, not ${OUTCOME}`);
  if (args.includes('--seller') && !/^https?:\/\/\S+$/.test(SELLER ?? '')) throw new Error('--seller takes the intake URL, such as https://crow.direct/agents/test-seller');

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
  if (pin.chain) say(`settling on chain ${pin.domain.chainId} through HoldbackRules ${pin.domain.verifyingContract}: each money step waits for a block`);
  const role = (r: string): string => {
    const a = found.adjudicators?.find((x: J) => x.role === r)?.address;
    if (!a) throw new Error(`discovery names no ${r} adjudicator under demo.adjudicators`);
    return a;
  };
  const [primary, fallback, appeal] = [role('primary'), role('fallback'), role('appeal')];

  // With --seller, Crow's test seller is the other party; this script plays it only when the seller cannot.
  let deal: { id: Hex; seller: string } | undefined;
  let seller: Agent | undefined;
  if (SELLER) {
    say(`buyer ${short(buyer.address)}: fresh keys, held in memory only`);
    step = 'faucet';
    const grant = await buyer.call('POST', '/v1/faucet', { address: buyer.address });
    if (grant.clubId !== found.clubId) throw new Error(`the faucet admitted to ${grant.clubId}, not ${found.clubId}`);
    say(`${tusd(grant.granted.amount)}, admitted to ${found.clubId}`);
    try {
      deal = await askTestSeller(buyer, PRICE);
    } catch (e) {
      if (!(e instanceof Unavailable)) throw e;
      say(`the test seller is unavailable: ${e.message}. Playing both sides instead`);
    }
  }

  let terms: J;
  let reclaimAt: string | undefined;
  if (deal) {
    step = 'accepted';
    await until(buyer, deal.id, ['AcceptedByAdjudicator'], 60_000);
    say(`AcceptedByAdjudicator on every operator: the primary adjudicator ${short(primary)} takes the deal`);
    step = 'check'; // the buyer: the seller sent only the ID, so the terms are read from every operator and compared
    const { id: servedId, signatures, ...served } = await buyer.trusted(`/v1/commitments/${deal.id}/terms`);
    terms = served;
    if (commitmentIdOf(terms) !== deal.id || String(servedId).toLowerCase() !== deal.id) refuse(`the commitment ID does not match the terms (recomputed ${commitmentIdOf(terms)})`);
    if (String(terms.seller).toLowerCase() !== deal.seller) refuse(`the seller in the terms is ${terms.seller}, not the test seller's published ${deal.seller}`);
    const signer = await recoverTypedDataAddress({ ...typedOf('CommitmentTerms', terms, buyer.domain), signature: signatures?.seller });
    if (signer.toLowerCase() !== deal.seller) refuse("the seller's signature does not recover to the seller");
    // The windows are the seller's choice: refuse longer ones than it publishes, which would lock the hold longer.
    const t = terms.timing, secs = (x: string) => Date.parse(x) / 1000;
    const windows: Record<string, number> = { deliverBy: secs(t.deliverBy) - secs(terms.createdAt), judge: secs(t.judgeBy) - secs(t.deliverBy), fallback: secs(t.fallbackBy) - secs(t.judgeBy), appealWindow: Number(t.appealWindowSec), appealDecide: Number(t.appealDecideSec) };
    for (const [name, max] of Object.entries(SELLER_WINDOWS)) if (!(windows[name]! <= max)) refuse(`the offer's ${name} window is ${windows[name]} s, longer than the ${max} s this buyer accepts from the test seller`);
    if (Number(t.maxSubmissions) !== 1) refuse(`the offer allows ${t.maxSubmissions} deliveries, not 1`);
    reclaimAt = t.deliverBy;
  } else {
    seller = fresh();
    if (SELLER) say(`seller ${short(seller.address)}: fresh keys, played by this script`);
    else say(`buyer ${short(buyer.address)}, seller ${short(seller.address)}: fresh keys, held in memory only`);

    step = 'faucet';
    const grants = await Promise.all((SELLER ? [seller] : [buyer, seller]).map((a) => a.call('POST', '/v1/faucet', { address: a.address })));
    if (grants.some((g) => g.clubId !== found.clubId)) throw new Error(`the faucet admitted to ${grants.map((g) => g.clubId).join(', ')}, not ${found.clubId}`);
    say(`${tusd(grants[0].granted.amount)} ${SELLER ? 'to the seller' : 'each'}, ${SELLER ? '' : 'both '}admitted to ${found.clubId}`);

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
    terms = offer.terms; // as the seller sent it to the buyer
    const { id: servedId, signatures, ...served } = await buyer.trusted(`/v1/commitments/${offer.id}/terms`);
    if (!same(served, terms)) refuse('the terms the operators serve are not the ones the seller sent');
    const id = commitmentIdOf(terms);
    if (id !== offer.id || String(servedId).toLowerCase() !== id) refuse(`the commitment ID does not match the terms (recomputed ${id})`);
    const signer = await recoverTypedDataAddress({ ...typedOf('CommitmentTerms', terms, buyer.domain), signature: signatures?.seller });
    if (signer.toLowerCase() !== String(terms.seller).toLowerCase()) refuse("the seller's signature does not recover to the seller");
  }
  const id = commitmentIdOf(terms);
  const want: Array<[string, J, J]> = [
    ['buyer', terms.buyer, buyer.address], ['buyerEncryptionPublicKey', terms.buyerEncryptionPublicKey, buyer.encryptionPublicKey],
    ['price', terms.price, PRICE], ['clubId', terms.clubId, found.clubId], ['deliverable', terms.deliverable, DELIVERABLE],
    ['acceptance', terms.acceptance, { deterministicChecks: CHECKS, rubric: { criteria: [], passThreshold: 0 } }],
    ['adjudicators', [terms.adjudication.adjudicator, terms.adjudication.fallbackAdjudicator, terms.adjudication.appealAdjudicator], [primary, fallback, appeal]],
    ['adjudication.fee', terms.adjudication.fee, (await buyer.registration(primary)).fee.min],
  ];
  for (const [field, got, expected] of want) if (!same(got, expected)) refuse(`${field} is ${jcs(got)}, not the agreed ${jcs(expected)}`);
  const fee = BigInt(terms.adjudication.fee.amount);
  say(`the buyer: same terms on every operator, ID recomputed, seller's signature recovers; price, checks and adjudicators as agreed${reclaimAt ? `; if the seller never delivers, the buyer can reclaim its hold at ${reclaimAt}` : ''}`);

  step = 'fund'; // the buyer: price plus adjudication fee into the hold, and the operator fee it computes itself
  const schedule = await buyer.operatorFeeSchedule();
  const operatorFee = schedule ? operatorFeeOf(terms.price, schedule) : 0n;
  const hold = BigInt(PRICE.amount) + fee;
  const held = await buyer.agreeAndFund(terms, hold + operatorFee);
  if (held.escrowState !== 'Held' || held.hold?.amount?.amount !== hold.toString()) throw new Error(`expected Held with ${hold} base units, got ${held.escrowState} ${jcs(held.hold?.amount ?? null)}`);
  say(`Held: ${tusd(hold)} held (${units(PRICE.amount)} price + ${units(fee)} adjudication fee), operator fee ${operatorFee ? tusd(operatorFee) : 'none'}`);

  step = 'deliver'; // the seller: once every operator shows Held, encrypt, upload, seal the key, sign the delivery
  let storedAt: string | undefined;
  if (seller) {
    await until(seller, id, ['Held'], 60_000);
    const { state: delivered, delivery } = await seller.deliverAndShare(terms, new TextEncoder().encode(OUTCOME === 'refund' ? BAD_CSV : CSV));
    if (!OPERATORS.some((op) => new URL(op).origin === new URL(delivery.ciphertext.uri).origin)) throw new Error(`the store answered a ciphertext URI on another host (${delivery.ciphertext.uri})`);
    storedAt = delivery.ciphertext.uri;
    say(`${delivered.escrowState}: ${delivery.ciphertext.bytes} encrypted bytes, the key sealed to ${delivery.encryptedKeys.length - 1} adjudicators and the buyer`);
  } else {
    say('the test seller delivers once every operator shows Held; waiting for the decision');
  }

  step = 'outcome';
  const expected = OUTCOME === 'refund' ? 'Refunded' : 'Released';
  const done = await until(buyer, id, ['Released', 'Refunded'], 180_000);
  let decided = 'no judgment record served';
  try {
    const j = await buyer.call('GET', `/v1/commitments/${id}/judgment`);
    decided = `checks ${j.deterministic.map((c: J) => `${c.checkId} ${c.passed ? 'pass' : 'FAIL'}`).join(', ')}; decision ${j.aggregate.decision}`;
  } catch {
    // the record is informative only; the state above is what settled
  }
  say(`${done.escrowState}: ${decided}`);
  if (done.escrowState !== expected) throw new Error(`the deal ended ${done.escrowState}, not ${expected}`);

  if (done.escrowState === 'Released') {
    step = 'open'; // the buyer: its released envelope opens the content key; the hashes the seller signed are checked
    // The ciphertext is fetched from the URI the delivery event records: every operator must record the same one, on
    // an operator's own store, and when this script delivered, the one where it stored the work.
    const recorded = await buyer.trusted(`/v1/commitments/${id}/events?limit=200`, (x) => x.items.find((e: J) => e.type === 'delivery.submitted')?.payload?.ciphertext?.uri ?? null);
    if (!recorded || !OPERATORS.some((op) => new URL(op).origin === new URL(recorded).origin) || (storedAt && recorded !== storedAt)) throw new Error(`the operators record the delivery at ${recorded}, not ${storedAt ?? 'on an operator'}`);
    const opened = await buyer.openDelivery(id);
    if (seller && opened !== CSV) throw new Error('the buyer opened something other than what the seller delivered');
    const rows = opened.trimEnd().split('\n').slice(1);
    say(`the buyer decrypted its copy, sha256 checked: ${rows.length} rows, ${rows.join(' | ')}`);
  } else {
    step = 'refund';
    say(`the price came back to the buyer; no key was released, so the seller keeps the work. The buyer is down the ${units(fee)} adjudication fee and the ${operatorFee ? tusd(operatorFee) : 'zero'} operator fee`);
  }

  step = 'balances';
  const balance = async (a: Agent) => tusd(await a.trusted(`/v1/balances/${a.address}`, (x) => x.amount));
  say(seller ? `buyer ${await balance(buyer)}, seller ${await balance(seller)}` : `buyer ${await balance(buyer)}`);

  if (pin.chain) {
    // Every money step is a transaction anyone can check: the hold, the delivery, the release or refund.
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
  const party = deal ? "with Crow's test seller as the other party" : SELLER ? 'with both sides played here, since the test seller was unavailable' : 'with both sides played here';
  say(`${done.escrowState} in ${Math.round((Date.now() - started) / 1000)} s ${party}; ${finality(terms.timing?.appealWindowSec, done.deadlines?.appealBy)}`);
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
