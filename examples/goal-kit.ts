// What the three goal commands share (T-441): try-sell.ts, try-judged.ts and try-reclaim.ts, each bundled by
// site/build.mjs into one self-contained file with viem and tweetnacl inside, so an agent runs one pinned command
// with no install step. try.ts stays as it is, pinned by its own hash; this module repeats the few helpers it needs.
//
// Key handling, the same in all three: each command makes fresh keys with Web Crypto, keeps them in memory, never
// prints, sends or writes them, and signs only messages it rebuilt and checked itself (verify.ts, through agent.ts).
// Text from the other party is shown as one plain line (plain() below), so it cannot fake a step line.
import nacl from 'tweetnacl';
import { recoverTypedDataAddress, type Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { Agent } from './agent.ts';
import { commitmentIdOf, CREATED_AT_BAND, jcs, knownPins, operatorFeeOf, Refusal, sealKeyTo, typedOf, type Pin } from './verify.ts';

export type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// tweetnacl's random source, set explicitly to Web Crypto's rather than left to its environment probe (the bundle's
// createRequire also gives it node:crypto; this makes the source one line anyone can read).
nacl.setPRNG((x: Uint8Array, n: number) => x.set(crypto.getRandomValues(new Uint8Array(n))));

export const OPERATORS = (process.env['HOLDBACK_OPERATORS'] || 'https://api.crow.direct,https://api2.crow.direct').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
export const TEST_SELLER = 'https://crow.direct/agents/test-seller';
export const TEST_BUYER = 'https://crow.direct/agents/test-buyer';

/** A refusal to sign: exit 3. Unavailable: the other party could not take the deal: exit 1 with why. */
export { Refusal };
export class Unavailable extends Error {}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const short = (h: string) => `${h.slice(0, 8)}...${h.slice(-4)}`;
/** Base units of a 6-decimal token as a decimal string, in integer arithmetic. */
export const units = (base: string | bigint) => {
  const v = BigInt(base);
  const frac = (v % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${v / 1_000_000n}${frac ? `.${frac}` : ''}`;
};
export const sha256hex = async (b: Uint8Array) => Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(b))).toString('hex');
/** JSON with every 0x-hex string lowercased: addresses compare ignoring case. */
const lowerHex = (v: J): J => JSON.parse(JSON.stringify(v ?? null), (_k, x) => (typeof x === 'string' && /^0x[0-9a-fA-F]+$/.test(x) ? x.toLowerCase() : x));
export const same = (a: J, b: J) => jcs(lowerHex(a)) === jcs(lowerHex(b));
export const refuse = (why: string): never => {
  throw new Refusal(`refusing to agree: ${why}`);
};

const chars = (...ranges: Array<[number, number]>) => ranges.map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join('');
const LINE_BREAKS = new RegExp(`[${chars([0x0a, 0x0a], [0x0d, 0x0d], [0x2028, 0x2029])}]+`, 'g');
const CONTROLS = new RegExp(`[${chars([0x00, 0x1f], [0x7f, 0x9f])}]`, 'g');
const INVISIBLE = new RegExp(`[${chars([0x061c, 0x061c], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff], [0xe0000, 0xe007f])}]`, 'gu');
/** Text from another party as one plain line of at most `max` characters: no line breaks, controls, bidi or tags. */
export const plain = (s: unknown, max = 300) => String(s ?? '').replace(LINE_BREAKS, ' ').replace(CONTROLS, '').replace(INVISIBLE, '').slice(0, max);

/** One line per step: the step's name, padded, then the text. */
let step = 'start';
export const at = (name: string) => {
  step = name;
};
export const say = (text: string) => console.log(`${step.padEnd(9)} ${text}`);

/** The command's flags: `--name value` pairs, `--help` answered before anything runs (exit 0). */
export function flags(usage: string[], known: string[]): (name: string) => string | undefined {
  const args = process.argv.slice(2);
  if (args.some((a) => a === '--help' || a === '-h')) {
    console.log(usage.join('\n'));
    process.exit(0);
  }
  for (let i = 0; i < args.length; i += 2) {
    if (!known.includes(args[i]!) || args[i + 1] === undefined) {
      console.error(`${args[i]} is not an option here, or has no value\n${usage.join('\n')}`);
      process.exit(2);
    }
  }
  return (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
}

export interface World {
  pin: Pin;
  clubId: string;
  adjudicators: { primary: string; fallback: string; appeal: string };
  /** A fresh agent: a new signing key and encryption key, in memory only. */
  fresh(): Agent;
  tusd(base: string | bigint): string;
}

/** Discovery as every operator serves it, checked against the settlement layers this file pins (never the operator's). */
export async function connect(): Promise<World> {
  if (!globalThis.crypto?.subtle || typeof fetch !== 'function') throw new Error(`this needs Node 20 or later (Web Crypto and fetch); this is Node ${process.versions.node}`);
  const reader = new Agent(OPERATORS, generatePrivateKey(), crypto.getRandomValues(new Uint8Array(32)));
  const found = await reader.trusted('/.well-known/holdback.json', (x) => ({ domain: x.domain, clubId: x.demo?.clubId, token: x.demo?.token?.id, adjudicators: x.demo?.adjudicators }));
  const pins = knownPins();
  const pin = pins.find((p) => same(p.domain, found.domain));
  if (!pin) throw new Refusal(`refusing to sign: the operators serve EIP-712 domain ${jcs(found.domain)}, not one pinned here (${pins.map((p) => jcs(p.domain)).join(' or ')})`);
  if (found.token !== pin.token.id || !found.clubId) throw new Error(`these operators run no ${pin.token.symbol} demo (discovery has no demo.clubId or demo.token ${pin.token.id})`);
  const role = (r: string): string => {
    const a = found.adjudicators?.find((x: J) => x.role === r)?.address;
    if (!/^0x[0-9a-fA-F]{40}$/.test(a ?? '')) throw new Error(`discovery names no ${r} adjudicator under demo.adjudicators`);
    return String(a).toLowerCase();
  };
  if (pin.chain) say(`settling on chain ${pin.domain.chainId} through HoldbackRules ${pin.domain.verifyingContract}: each money step waits for a block`);
  return {
    pin,
    clubId: found.clubId,
    adjudicators: { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') },
    fresh: () => new Agent(OPERATORS, generatePrivateKey(), crypto.getRandomValues(new Uint8Array(32)), pin.domain, pin.chain),
    tusd: (base) => `${units(base)} ${pin.token.symbol}`,
  };
}

/** Test tUSDC and the demo club's mandate for `a`, from the faucet. */
export async function faucet(w: World, a: Agent): Promise<void> {
  const grant = await a.call('POST', '/v1/faucet', { address: a.address });
  if (grant.clubId !== w.clubId) throw new Error(`the faucet admitted to ${grant.clubId}, not ${w.clubId}`);
  say(`${w.tusd(grant.granted.amount)} from the faucet, admitted to ${plain(w.clubId, 60)}`);
}

/** A JSON answer from a test agent (a party, not an operator), or Unavailable with why. */
export async function fromParty(url: string, init: RequestInit = {}): Promise<{ status: number; body: J }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new Unavailable(`${plain(url)} did not answer (${plain((e as Error).message)})`);
  }
  const body = (await res.json().catch(() => null)) as J;
  if (res.status === 429 || res.status === 503) throw new Unavailable(`it is busy: ${plain(body?.error ?? body?.detail ?? res.status)}${Number.isSafeInteger(body?.retryAfterSec) ? `; retry in ${body.retryAfterSec} s` : ''}`);
  if (!res.ok || body === null) throw new Unavailable(`${plain(url)} answered ${res.status}${body?.error || body?.detail ? `: ${plain(body.error ?? body.detail)}` : ''}`);
  return { status: res.status, body };
}

/** Polls every operator until each reports one of `states`. A stall names the states seen and the operators' notices. */
export async function until(agent: Agent, id: Hex, states: string[], timeoutMs: number, everyMs = 1000): Promise<J> {
  let seen: J[] = [];
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(everyMs)) {
    seen = await Promise.all(agent.sources().map((api) => agent.call('GET', `/v1/commitments/${id}`, undefined, api)));
    if (seen.every((s) => states.includes(s.escrowState))) return seen[0];
  }
  const notices = [...new Set(seen.flatMap((s) => s.notices ?? []))];
  throw new Error(`still ${seen.map((s) => s.escrowState).join(' / ')} after ${Math.round(timeoutMs / 1000)} s, waiting for ${states.join(' or ')}${notices.length ? `; the operators say: ${notices.map((n) => plain(n)).join(' | ')}` : ''}`);
}

/** Crow's test seller's card, checked: a crow-agent card whose intake and status sit on the seller's own origin. */
export async function sellerCard(url: string): Promise<{ card: J; seller: string }> {
  const card = (await fromParty(`${url}/agent.json`)).body;
  const origin = new URL(url).origin;
  if (card?.type !== 'crow-agent' || typeof card.seller !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(card.seller)) throw new Unavailable(`${plain(url)}/agent.json is not a crow-agent card with a seller address`);
  if (new URL(card.intake?.api ?? 'x:').origin !== origin || new URL(card.intake?.status ?? 'x:').origin !== origin) throw new Unavailable(`the card's intake is not on ${origin}`);
  if (!/^[A-Za-z0-9_-]{43}$/.test(card.intake?.encryptionPublicKey ?? '')) throw new Unavailable("the card's intake has no x25519 encryptionPublicKey");
  return { card, seller: card.seller.toLowerCase() };
}

/**
 * The buyer's side of the intake convention (site/ref/intake.txt, "Two agents, two people"): seal the proposal to the
 * intake's key, store it on Crow, send the crow-request with the status token's hash, and poll the status until the
 * seller has offered. `from` is a free-text, self-asserted name of the sender; nothing checks it.
 */
export async function requestOffer(buyer: Agent, card: J, seller: string, proposal: J, from: string): Promise<Hex> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array([...iv, ...new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify(proposal))))]);
  const stored = await buyer.call('POST', '/v1/ciphertext', ct);
  if (stored.id !== `sha256:${await sha256hex(ct)}`) throw new Error('the ciphertext store answered another hash');
  // The status token stays here; the seller sees only its SHA-256.
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
  const request = { type: 'crow-request', proposal: { uri: stored.uri, sha256: stored.id }, sealedKey: sealKeyTo(key, 'intake', card.intake.encryptionPublicKey).ciphertext, statusTokenHash: await sha256hex(new TextEncoder().encode(token)), from };
  await fromParty(card.intake.api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  say(`sealed proposal stored on Crow (${ct.length} bytes) and sent to the intake, offer "${plain(proposal.offer)}"`);
  at('offered');
  let s: J;
  for (const end = Date.now() + 120_000; Date.now() < end; await sleep(1000)) {
    s = (await fromParty(`${card.intake.status}?token=${token}`)).body;
    if (s.status === 'failed') throw new Unavailable(`it failed the request: ${plain(s.detail)}`);
    if (s.status === 'offered' && /^0x[0-9a-f]{64}$/.test(s.commitmentId ?? '')) {
      if (String(s.seller).toLowerCase() !== seller) refuse(`the status names seller ${plain(s.seller)}, not the published ${seller}`);
      say(`${short(s.commitmentId)} offered by the test seller${s.countered ? ' as a counter-offer' : ''}`);
      return s.commitmentId as Hex;
    }
  }
  throw new Unavailable(`no offer within 120 s (status ${plain(s?.status ?? 'unknown')}${s?.detail ? `: ${plain(s.detail)}` : ''})`);
}

/** What the buyer agreed to ask for, and the longest windows it accepts, in seconds. */
export interface Want {
  price: { token: string; amount: string };
  deliverable: J;
  checks: J[];
  rubric: J;
  windows: { offer: number; fund: number; deliverBy: number; judge: number; fallback: number; appealWindow: number; appealDecide: number };
}

/**
 * The buyer's check of an offer it was sent only the ID of: the terms as every operator serves them, the ID
 * recomputed, the seller's signature recovered to the published seller, and every field this buyer cares about
 * against what it asked for. Returns the terms; refuses (exit 3) on any difference.
 */
export async function checkOffer(w: World, buyer: Agent, id: Hex, seller: string, want: Want): Promise<J> {
  at('accepted');
  await until(buyer, id, ['AcceptedByAdjudicator'], 60_000);
  say(`AcceptedByAdjudicator on every operator: the primary adjudicator ${short(w.adjudicators.primary)} takes the deal`);
  at('check');
  const { id: servedId, signatures, ...terms } = await buyer.trusted(`/v1/commitments/${id}/terms`);
  if (commitmentIdOf(terms) !== id || String(servedId).toLowerCase() !== id) refuse(`the commitment ID does not match the terms (recomputed ${commitmentIdOf(terms)})`);
  if (String(terms.seller).toLowerCase() !== seller) refuse(`the seller in the terms is ${plain(terms.seller)}, not the published ${seller}`);
  const signer = await recoverTypedDataAddress({ ...typedOf('CommitmentTerms', terms, buyer.domain), signature: signatures?.seller });
  if (signer.toLowerCase() !== seller) refuse("the seller's signature does not recover to the seller");
  const t = terms.timing, secs = (x: string) => Date.parse(x) / 1000;
  // The seller picks createdAt and every window counts from it: refuse one far from settlement time, or a seller could
  // date the offer a year ahead and lock the hold that long (red team F1; buyer-signer.ts does the same, T-388 H1).
  const now = (await buyer.settlementNow()) / 1000, created = secs(terms.createdAt);
  if (!(created >= now - CREATED_AT_BAND.behindSec && created <= now + CREATED_AT_BAND.aheadSec)) refuse(`the offer is dated ${plain(terms.createdAt, 40)}, not within ${CREATED_AT_BAND.behindSec} s before and ${CREATED_AT_BAND.aheadSec} s after settlement time`);
  const windows: Record<string, number> = { offer: secs(t.offerExpiresAt) - secs(terms.createdAt), fund: secs(t.fundBy) - secs(terms.createdAt), deliverBy: secs(t.deliverBy) - secs(terms.createdAt), judge: secs(t.judgeBy) - secs(t.deliverBy), fallback: secs(t.fallbackBy) - secs(t.judgeBy), appealWindow: Number(t.appealWindowSec), appealDecide: Number(t.appealDecideSec) };
  for (const [name, max] of Object.entries(want.windows)) if (!(windows[name]! <= max)) refuse(`the offer's ${name} window is ${windows[name]} s, longer than the ${max} s this buyer accepts`);
  if (Number(t.maxSubmissions) !== 1) refuse(`the offer allows ${t.maxSubmissions} deliveries, not 1`);
  // The money addresses: the buyer pays and is refunded from its own address; the seller is paid at the payout
  // address in the terms, which the card does not list (the test seller's is its signing address).
  const fields: Array<[string, J, J]> = [
    ['buyer', terms.buyer, buyer.address], ['buyerPaymentAddress', terms.buyerPaymentAddress, buyer.address], ['buyerEncryptionPublicKey', terms.buyerEncryptionPublicKey, buyer.encryptionPublicKey],
    ['price', terms.price, want.price], ['clubId', terms.clubId, w.clubId], ['deliverable', terms.deliverable, want.deliverable],
    ['acceptance', terms.acceptance, { deterministicChecks: want.checks, rubric: want.rubric }],
    ['adjudicators', [terms.adjudication.adjudicator, terms.adjudication.fallbackAdjudicator, terms.adjudication.appealAdjudicator], [w.adjudicators.primary, w.adjudicators.fallback, w.adjudicators.appeal]],
    ['adjudication.fee', terms.adjudication.fee, (await buyer.registration(w.adjudicators.primary)).fee.min],
  ];
  for (const [field, got, expected] of fields) if (!same(got, expected)) refuse(`${field} is ${plain(jcs(got), 600)}, not the agreed ${plain(jcs(expected), 600)}`);
  say(`same terms on every operator, ID recomputed, seller's signature recovers; price, checks, rubric and adjudicators as asked; the seller is paid at ${short(String(terms.sellerPayoutAddress).toLowerCase())}, the payout address in the terms`);
  return terms;
}

/** Agree and fund: price plus adjudication fee into the hold, and the operator fee this buyer computes itself. */
export async function fund(w: World, buyer: Agent, terms: J, maxTotal: bigint): Promise<void> {
  at('fund');
  const fee = BigInt(terms.adjudication.fee.amount);
  const schedule = await buyer.operatorFeeSchedule();
  const operatorFee = schedule ? operatorFeeOf(terms.price, schedule) : 0n;
  const hold = BigInt(terms.price.amount) + fee;
  if (hold + operatorFee > maxTotal) refuse(`the deal costs ${w.tusd(hold + operatorFee)} in all, more than the ${w.tusd(maxTotal)} this command pays`);
  const held = await buyer.agreeAndFund(terms, hold + operatorFee);
  if (held.escrowState !== 'Held' || held.hold?.amount?.amount !== hold.toString()) throw new Error(`expected Held with ${hold} base units, got ${held.escrowState} ${jcs(held.hold?.amount ?? null)}`);
  say(`Held: ${w.tusd(hold)} held (${units(terms.price.amount)} price + ${units(fee)} adjudication fee), operator fee ${operatorFee ? w.tusd(operatorFee) : 'none'}`);
}

/** The deal's transactions, one Etherscan link each, in order. */
export async function chainLines(w: World, a: Agent, id: Hex): Promise<void> {
  if (!w.pin.chain) return;
  at('chain');
  const events: J[] = await a.trusted(`/v1/commitments/${id}/events?limit=200`, (x) => x.items.filter((e: J) => typeof e.payload?.tx === 'string').map((e: J) => ({ seq: e.seq, type: e.type, tx: e.payload.tx })));
  const what: Record<string, string> = { 'fee.operator': 'funded', 'hold.funded': 'funded', 'delivery.submitted': 'delivered', 'judgment.decided': 'decided' };
  const seen = new Set<string>();
  for (const { type, tx } of events.sort((a, b) => a.seq - b.seq)) {
    if (seen.has(tx)) continue;
    seen.add(tx);
    say(`${plain(what[type] ?? type).padEnd(9)} ${w.pin.chain.explorer ? `${w.pin.chain.explorer}/tx/${plain(tx)}` : plain(tx)}`);
  }
}

/** Runs a command's main: exit 0 when it ended as asked, 3 when it refused to sign, 1 when anything else stopped it. */
export async function run(main: () => Promise<void>): Promise<never> {
  try {
    await main();
    process.exit(0);
  } catch (e) {
    const refused = e instanceof Refusal;
    console.error(`${refused ? 'refused' : 'stopped'} at ${step}: ${plain((e as Error).message, 2000)}`);
    if (!refused) console.error('Nothing here is real money. Run it again for a fresh deal; the faucet allows 10 new addresses per hour per client.');
    process.exit(refused ? 3 : 1);
  }
}
