// The buyer's side of one Crow deal, as one file a seller ships inside its own client (T-319). Test tokens only:
// it signs only under a settlement layer pinned in verify.ts (SimChain, Sepolia, or HOLDBACK_DEPLOYMENT).
//
// The buyer's agent approves a quoted deal once. This file then, on the buyer's own machine:
//   makeKeys      makes a signing key and an x25519 key for one deal and saves them in a directory the caller names
//                 (file mode 0600). The keys never leave that machine: nothing here sends, returns or prints one.
//   quote         asks the seller's quote route for an offer. The seller learns the buyer's address, its public
//                 encryption key and the scope, nothing else, plus a bearer credential when the seller requires one
//                 (Options.quoteCredentialEnv names the environment variable that holds it).
//   testFunds     on the test service, asks the faucet for the deal's total and a mandate in the demo club.
//   readOffer     reads the offer from both operators, for the buyer's agent to approve. Given the seller's published
//                 defaults, it lists what the offer changes from them: each check, window and requirement, old and
//                 new (T-330). It records what it showed.
//   checkOffer    reads the offer again and refuses unless it equals what readOffer showed, and unless the price, the
//                 fees, the deliverable, the checks, the deadlines, the adjudicators and the buyer's own address and
//                 encryption key equal what the buyer approved. The settlement mode, the disclosure level, the club,
//                 its rulebook hash and the primary adjudicator's policy and registry are shown too, and both
//                 readOffer and checkOffer refuse them unless they equal what the buyer expects (Options.expect) and
//                 what every operator publishes (T-332).
//   agreeAndFund  signs the agreement, the funding and the operator fee, each rebuilt from the approved terms and
//                 checked against what the operator prepared (verify.ts; site/llms.txt section 4).
//   watch         follows the funded deal until the operators confirm its outcome, and tells the buyer's agent
//                 (onReport) when it is released, refunded, unconfirmed, or past deliverBy with nothing delivered.
//                 Then it sends the reclaim itself (T-325). Its record is `<address>.watch.json` beside the key file.
//   openDelivery  watches, then opens the buyer's envelope, checks the plaintext hash and returns the work.
//   openDeals     after a restart: the funded deals in a key store with no confirmed outcome yet.
//
// The operator only relays: every state-changing message is signed here, by the buyer's key. The one exception is the
// reclaim: the protocol's timeout trigger takes no signature, since the deadline both parties signed is its authority,
// and the settlement layer refuses it before deliverBy (site/llms.txt, "Your own trigger"). The protocol steps are
// agent.ts and verify.ts; this file adds the key store and the comparison with what the buyer approved. A buyer who
// wants no seller code in its path uses the HTTP API directly (site/llms.txt sections 1 to 8).
//
// The work a seller delivers is untrusted data. This file returns it; it never prints it, runs it or reads
// instructions from it. Neither should the client around it.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import { recoverTypedDataAddress, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { Agent } from './agent.ts';
import { command } from './entry.ts';
import { dealRecord, type DealRecord } from './deal-record.ts';
import { commitmentIdOf, CREATED_AT_BAND, deliveryHashOf, digestOfFile, isAddressText, jcs, knownPins, moneyAddressWarnings, openEnvelopeKey, operatorFeeOf, paymentSentence, Refusal, typedDataFile, typedOf, type Intent, type Pin } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A token amount in base units, as a decimal string. No floats. */
export type Money = { token: string; amount: string };
/** What the buyer pays on top of the price, and the sum of all three. */
export type Fees = { adjudication: Money; operator: Money; total: Money };
/** What a seller's quote route answers. A claim: checkOffer compares the offer itself, not this. */
export type Quote = { commitmentId: Hex; price: Money; fees: J; expiresAt: string };
/** The offer as both operators serve it: what the buyer's agent approves. */
export type Offer = {
  commitmentId: Hex;
  seller: string;
  price: Money;
  fees: Fees;
  deliverable: J;
  /** The deterministic checks, in order. On a checks-only deal they are the whole contract. */
  checks: J[];
  /** The rubric the judges score; `{criteria: [], passThreshold: 0}` on a checks-only deal. */
  rubric: J;
  /** The terms' timing: offerExpiresAt, fundBy, deliverBy, judgeBy, fallbackBy, the appeal windows, maxSubmissions. */
  deadlines: J;
  /** The same deadlines as windows in whole seconds, as a seller configures them (`Defaults.timing`). */
  windows: Record<Window, number>;
  /** How many deliveries the seller may make (`deadlines.maxSubmissions`), shown on its own (T-332). */
  maxSubmissions: number;
  adjudicators: { primary: string; fallback: string; appeal: string };
  /**
   * How settlement pays out on a decision (`guaranteed_on_decision`, `settle_after_window` or `optimistic`). Checked
   * against `expect.settlementMode`, or else the modes every operator's discovery lists (T-332).
   */
  settlement: { mode: string };
  /** Who may read the terms and records. Always `public`: the one level whose terms this file can read and show (T-332). */
  disclosure: { level: string };
  /** The club whose rulebook governs the deal. Checked against `expect.clubId`, or else discovery's demo club (T-332). */
  clubId: string;
  /** The hash of that club's rulebook. Checked against the club every operator serves (T-332). */
  rulebookHash: Hex;
  /** The primary adjudicator's policy ID, policy hash and model registry hash. Checked against its registration as every operator serves it (T-332). */
  policyId: string;
  policyHash: Hex;
  registryHash: Hex;
  /**
   * Where the money comes from and goes (ADR-0033): the buyer's payment address, which funds the hold and receives
   * every refund, and the seller's payout address, which receives the price. Each may equal its party's signing address.
   */
  buyerPaymentAddress: string;
  sellerPayoutAddress: string;
  /** The rest of what the buyer signs (T-332's follow-up): the schema version, the remedy on a reject, the terms' nonce and when the seller made them. */
  schemaVersion: string;
  remedy: { onReject: string };
  nonce: Hex;
  createdAt: string;
  /** The one token of the deal: the price's, the fee's and the settlement's, checked against the pinned settlement layer and discovery. */
  token: { id: string; symbol: string; decimals: number };
  /**
   * When the offer was shown: `createdAt` and each deadline as a date and its distance from settlement time then, so
   * a far date shows at a glance (T-390). Shown only, never compared: it changes as time passes.
   */
  timeline?: Record<string, { at: string; fromNow: string }>;
  /**
   * With `defaults` given to readOffer: what this offer changes from the seller's published defaults (T-330). Also,
   * with or without defaults, `createdAt` outside the band around the operators' clock, and the operators' clocks
   * apart by more than it (T-390).
   */
  differences?: Difference[];
};
/** The seven signed fields T-332 shows, and maxSubmissions on its own: an approval may name each. */
type Signed = 'settlement' | 'disclosure' | 'clubId' | 'rulebookHash' | 'policyId' | 'policyHash' | 'registryHash' | 'maxSubmissions';
/**
 * What the buyer approved. `seller`, `rubric`, `fees.total`, `commitmentId`, `differences` and the seven fields of
 * T-332 are optional: without `rubric` the offer must have none, and without `seller` any seller whose signature
 * recovers passes. The seven are checked against `Options.expect` and the operators either way.
 */
export type Approved = Pick<Offer, 'price' | 'deliverable' | 'checks' | 'deadlines' | 'adjudicators'> & Partial<Pick<Offer, Signed>> & {
  fees: { adjudication: Money; operator: Money; total?: Money };
  seller?: string;
  /** The seller's payout address the buyer approved. Without it, the one shown must stay (ADR-0033 §6). */
  sellerPayoutAddress?: string;
  rubric?: J;
  commitmentId?: Hex;
  differences?: Difference[];
};
/**
 * What the buyer expects of the seven signed fields T-332 shows. Each is the buyer's setting: the signer judges no
 * value (D28) and adds no limit (D31). Without one, the signer compares with what every operator publishes.
 */
export type Expect = {
  /** Without it: a mode every operator's discovery lists in `settlementModes`. */
  settlementMode?: string;
  // No setting for disclosure.level: it must be `public`, the one level whose terms carry the deliverable and the
  // checks in the clear for this file to show. A private deal needs a signer that opens privateTerms (ADR-0024).
  /** Without it: the demo club every operator's discovery names (`demo.clubId`). With neither, the signer refuses. */
  clubId?: string;
  /** Compared as well as the club's hash every operator serves. */
  rulebookHash?: string;
  /** Each compared as well as the primary adjudicator's registration every operator serves. Hashes compare ignoring case. */
  policyId?: string;
  policyHash?: string;
  registryHash?: string;
};
export type Window = 'offerExpiresInSec' | 'fundWithinSec' | 'deliverWithinSec' | 'judgeWithinSec' | 'fallbackWithinSec' | 'appealWindowSec' | 'appealDecideSec';
const WINDOWS: Window[] = ['offerExpiresInSec', 'fundWithinSec', 'deliverWithinSec', 'judgeWithinSec', 'fallbackWithinSec', 'appealWindowSec', 'appealDecideSec'];
/**
 * A seller's published defaults (GET /defaults on a seller adapter; the card's `pricing.defaults`): the terms it
 * usually offers. `{{field}}` stands for a field of the scope this key sent, `{{field.length}}` for a list's size, and
 * `\{{field}}` for the text `{{field}}`, as in the seller adapter's template. The seller's claim: it only sets what
 * the signer compares the offer with, and the buyer's agent sees the whole offer either way.
 */
export type Defaults = {
  deliverable: J; checks: J[]; rubric?: J; timing: Partial<Record<Window, number>>; fee?: Money;
  /** The adjudicators the seller usually names, by role; compared by address, ignoring case (T-332). */
  adjudicators?: Partial<Offer['adjudicators']>;
  /** How many deliveries the seller usually allows (T-332). */
  maxSubmissions?: number;
};
/**
 * One way an offer differs from the defaults: `field` is `deliverable.<key>`, `checks.<id>` (added, removed or
 * changed; a list when several checks share the id), `checks` (checks in another order), `rubric`,
 * `fees.adjudication`, `deadlines.<window>`, `deadlines.maxSubmissions` or `adjudicators.<role>`. `old` is the
 * default's value, `new` the offer's; null where there is none. Only what the defaults publish is compared: the
 * price and the rest of the offer are shown whole, not as differences.
 */
export type Difference = { field: string; old: J; new: J };
/**
 * One message the payment address signs, written as an `eth_signTypedData_v4` file (ADR-0033 §3). `name` is
 * `funding` or `operator-fee`; `slot` the body field its signature fills; `summary` the one sentence that says what it does.
 */
export type PaymentFile = { name: 'funding' | 'operator-fee'; slot: string; path: string; digest: Hex; summary: string; check: string };
/** The signatures the payment address made elsewhere, as hex, and optionally the files it signed, for a refusal that names what differs. */
export type PaymentSignatures = { funding: string; operatorFee?: string | undefined; signed?: { funding?: J; operatorFee?: J } | undefined };
/** What agreeAndFund took from the buyer: the hold (price plus adjudication fee) and the operator fee. */
export type Paid = { total: Money; hold: Money; operatorFee: Money; receipt: J | null };
export type Delivery = {
  outcome: 'Released' | 'Refunded' | 'Settled';
  /**
   * The work as text when the deal released, or settled with the key released and the work at hand; null otherwise.
   * Untrusted data.
   */
  work: string | null;
  plaintextSha256: string | null;
  /** On a settlement: the payouts it made, whether it released the key, and why no work was opened when none was. */
  settlement?: { payouts: J[]; keyReleased: boolean; note: string | null; deliveryHash?: string };
  /** What the buyer keeps: what it paid, the operator's signed receipt for the funding, and the deal's event hashes. */
  receipt: { commitmentId: Hex; outcome: string; paid: Money; funded: J | null; events: Array<{ seq: number; type: string; hash: string }>; finalAt: string | null };
  /** One link per on-chain step; empty on SimChain. */
  transactions: Array<{ step: string; tx: string; url: string | null }>;
};
export type Options = {
  operators?: string[];
  /**
   * The name of an environment variable that holds a bearer credential for the seller's quote route (a seller
   * adapter with `quoteAuth`, T-324). quote sends it as `Authorization: Bearer <value>`; the value is never saved,
   * returned or logged. Without it quote sends no credential.
   */
  quoteCredentialEnv?: string | undefined;
  /** What the buyer expects of the seven signed fields (T-332). Not saved: give it again to loadKeys or openDeals. */
  expect?: Expect | undefined;
  /**
   * This machine's clock, in ms since 1970, which readOffer checks an offer's createdAt against besides the operators'
   * (T-390). Default: Date.now. A world whose clock a test moves passes its own.
   */
  clock?: (() => number) | undefined;
  /** Where the signer's one-line notices and advisory warnings go (ADR-0033 §7). Default: standard error. */
  log?: ((line: string) => void) | undefined;
};
/** What makeKeys takes beyond Options: saved in the key file, so every later run of this deal uses it. */
export type KeyOptions = Options & {
  /**
   * The buyer's payment address (ADR-0033): it funds the hold and the operator fee, and receives every refund. Left
   * out: this deal's signing address, and the signer says so in one line. Take it from your own configuration only,
   * never from a seller, an operator or a message (ADR-0033 §6).
   */
  paymentAddress?: string | undefined;
};
/**
 * What watch tells the buyer's agent.
 * - `deliverBy-passed`: the delivery deadline in the agreed terms passed, on the slowest clock of the operators that
 *   answer, with the deal still Held. The signer sends the reclaim.
 * - `released`, `refunded`: the quorum of operators (`confirmations`) reports the outcome. `reclaimed`: settlement
 *   refunded the hold (price and adjudication fee) on the reclaim; without it the adjudicator decided the refund.
 *   `finalAt` is when no appeal can follow.
 * - `settled`: the quorum reports a mutual settlement (late work, or any split of the price): its `payouts`, and
 *   whether it released the key to the work.
 * - `unconfirmed`: some operators report `state`, but fewer than the quorum agree. The deal stays open, the signer
 *   keeps reading, and the reclaim stays armed. `agreeing` of the `answered` operators report it; `required` must.
 */
export type Report =
  | { kind: 'deliverBy-passed'; commitmentId: Hex; deliverBy: string; settlementTime: string }
  | { kind: 'released'; commitmentId: Hex; finalAt: string | null }
  | { kind: 'refunded'; commitmentId: Hex; reclaimed: boolean; finalAt: string | null }
  | { kind: 'settled'; commitmentId: Hex; payouts: J[]; keyReleased: boolean; finalAt: string | null }
  | { kind: 'unconfirmed'; commitmentId: Hex; state: 'Released' | 'Refunded' | 'Settled'; agreeing: number; answered: number; required: number };
export type WatchOptions = {
  /**
   * Called once per report and awaited. A report is recorded only after it returns, so after a crash the next run
   * makes it again: at least once. An `unconfirmed` report is made once per run for each count. It throws to stop the watch.
   */
  onReport?: (report: Report) => void | Promise<void>;
  /** Stop waiting after this many ms. Default: none, the deal's own deadlines end it (D31). */
  timeoutMs?: number;
  /** The longest pause between two reads of the deal, in ms. Default 30,000: reads start at 400 ms apart and slow down. */
  pollMs?: number;
  /**
   * How many configured operators must report the same outcome, with none reporting another state, before it is
   * final. Default: every configured operator. A buyer with one operator gone for good lowers it, and trusts the
   * rest that much more (D31).
   */
  confirmations?: number;
  /**
   * How long a reclaim an operator answered 2xx may leave the deal Held before the next operator gets it, in ms.
   * Default 120,000: on Sepolia a relayed reclaim lands within about a minute.
   */
  reclaimRetryMs?: number;
};
/** How the deal ended, as watch returns it and the watch file keeps it. */
export type Outcome = {
  commitmentId: Hex;
  outcome: 'Released' | 'Refunded' | 'Settled';
  reclaimed: boolean;
  finalAt: string | null;
  /** On Settled: the payouts every agreeing operator records, and whether the settlement released the key. */
  settlement?: { payouts: J[]; keyReleased: boolean };
};

type Saved = {
  version: 1;
  address: string;
  privateKey: Hex;
  encryptionSecretKey: string;
  createdAt: string;
  /** The buyer's payment address, lowercase, when it is not the signing address (ADR-0033). */
  paymentAddress?: string;
  /** The Idempotency-Key of the quote request, so a retry after a crash replays the seller's answer. */
  quoteKey?: string;
  commitmentId?: Hex;
  quote?: Quote;
  /** The scope and options quote sent: the defaults' placeholders are filled from this scope. */
  scope?: J;
  options?: J;
  /** The offer readOffer last showed the buyer's agent, and the filled defaults it compared it with. */
  shown?: { commitmentId: Hex; offer: Offer; defaults: Defaults | null };
  /** The terms checkOffer passed, and the offer the buyer approved. */
  checked?: { terms: J; offer: Offer };
  /**
   * With a separate payment address: the funding as fundingFiles prepared it. The nonces repeat the preparation,
   * so the messages stay the ones written to the files; each file's digest is the one its signature must be over.
   */
  funding?: { commitmentId: Hex; nonces: { agreeNonce: Hex; fundingNonce: Hex; operatorFeeNonce?: Hex }; files: PaymentFile[] };
  paid?: Paid;
};

/**
 * What watch has done for one deal, in `<address>.watch.json` beside the key file, which watch never writes (T-325).
 * A restart reads it, so the deal is not lost and no reclaim goes twice to an operator that took it.
 */
type Watched = {
  version: 1;
  commitmentId: Hex;
  /** The report kinds onReport has returned from. `unconfirmed` is never recorded: each run reports it again. */
  reported: Report['kind'][];
  /**
   * The reclaim request, saved before it is sent. `answeredBy` is the operator that answered it 2xx, at `answeredAt`
   * (ms since 1970). Without it the answer is unknown, and the next try reads the state first and reuses the key.
   * `from` is where in the configured operators the next try starts.
   */
  reclaim?: { idempotencyKey: string; from: number; answeredBy?: string; answeredAt?: number };
  /** Saved only once the quorum of operators reports it. */
  outcome?: Outcome;
};
const watchFile = (store: string, address: string) => join(store, `${address}.watch.json`);
function readWatched(store: string, address: string, id: Hex): Watched {
  const file = watchFile(store, address);
  if (!existsSync(file)) return { version: 1, commitmentId: id, reported: [] };
  const w = JSON.parse(readFileSync(file, 'utf8')) as Watched;
  if (w.version !== 1 || w.commitmentId !== id) throw new Error(`${file} is not this file's record of ${id}`);
  return w;
}
function saveWatched(store: string, address: string, w: Watched): void {
  const file = watchFile(store, address);
  writeFileSync(`${file}.tmp`, `${JSON.stringify(w, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

const DEC = /^(0|[1-9][0-9]{0,77})$/;
const ID = /^0x[0-9a-f]{64}$/;
const EMPTY_RUBRIC = { criteria: [], passThreshold: 0 };
const isMoney = (m: J): m is Money => typeof m?.token === 'string' && typeof m?.amount === 'string' && DEC.test(m.amount);
/** JSON with every 0x-hex string lowercased: addresses compare ignoring case. */
const lowerHex = (v: J): J => JSON.parse(JSON.stringify(v ?? null), (_k, x) => (typeof x === 'string' && /^0x[0-9a-fA-F]+$/.test(x) ? x.toLowerCase() : x));
const same = (a: J, b: J) => jcs(lowerHex(a)) === jcs(lowerHex(b));
const refuse = (why: string): never => {
  throw new Refusal(`refusing to sign: ${why}`);
};
/**
 * Code points a terminal hides or uses to reorder text, by Unicode property: controls (Cc), format characters (Cf:
 * the bidirectional marks, embeddings, overrides and isolates, the zero-width characters, the tags), the line and
 * paragraph separators, and every default-ignorable code point (the variation selectors and their supplement, the
 * Hangul fillers, the combining grapheme joiner).
 */
const HIDDEN = /^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]$/u;
/**
 * JSON text with every control, bidirectional and invisible format character escaped as `\uXXXX`: it parses to the
 * same value, and a terminal shows no hidden or reordered seller text. JSON's own syntax is ASCII, so only
 * characters inside strings change.
 */
export const printable = (json: string): string =>
  [...json].map((c) => (HIDDEN.test(c) ? [...Array(c.length).keys()].map((i) => `\\u${c.charCodeAt(i).toString(16).padStart(4, '0')}`).join('') : c)).join(''); // each UTF-16 unit, so a code point above U+FFFF escapes as its surrogate pair
/** A value from the offer in an error message: canonical JSON, its first 200 code points, printable. */
const shown = (v: J) => printable([...jcs(lowerHex(v))].slice(0, 200).join(''));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRecord = (v: J): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);

const PLACEHOLDER = /(\\?)\{\{([A-Za-z][A-Za-z0-9]*)(\.length)?\}\}/g;
const WHOLE_PLACEHOLDER = /^\{\{([A-Za-z][A-Za-z0-9]*)(\.length)?\}\}$/;
/** The defaults with each placeholder replaced by the scope's value, in one pass, as the seller adapter fills its template. */
function fillWith(node: J, scope: J): J {
  const value = (name: string, length: string | undefined): J => {
    const v = isRecord(scope) && Object.hasOwn(scope, name) ? scope[name] : undefined;
    if (v === undefined || (length && !Array.isArray(v))) throw new Error(`the defaults use {{${name}${length ?? ''}}}, which the scope this key sent does not hold`);
    return length ? v.length : v;
  };
  if (typeof node === 'string') {
    const whole = WHOLE_PLACEHOLDER.exec(node);
    if (whole) return structuredClone(value(whole[1]!, whole[2]));
    return node.replace(PLACEHOLDER, (m: string, escaped: string, name: string, length?: string) => {
      if (escaped) return m.slice(1);
      const v = value(name, length);
      return Array.isArray(v) ? v.join(', ') : String(v);
    });
  }
  if (Array.isArray(node)) return node.map((n) => fillWith(n, scope));
  if (isRecord(node)) return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fillWith(v, scope)]));
  return node;
}

/** The defaults as data, or an error naming what is malformed. Unknown fields (the seller's scope and option rules) are left out. */
function defaultsOf(d: J): Defaults {
  if (!isRecord(d) || !isRecord(d.deliverable) || !Array.isArray(d.checks) || !d.checks.every((c: J) => isRecord(c) && typeof c.id === 'string') || !isRecord(d.timing)) {
    throw new Error('the defaults are not {deliverable, checks (each with an id), timing}');
  }
  for (const [k, v] of Object.entries(d.timing)) if (!(WINDOWS as string[]).includes(k) || !Number.isSafeInteger(v) || (v as number) < 0) throw new Error(`the defaults' timing.${k.slice(0, 40)} is not a window in whole seconds`);
  if (d.rubric !== undefined && !isRecord(d.rubric)) throw new Error('the defaults\' rubric is not an object');
  if (d.fee !== undefined && !isMoney(d.fee)) throw new Error('the defaults\' fee is not {token, amount} in base units');
  const roles = ['primary', 'fallback', 'appeal'];
  if (d.adjudicators !== undefined && (!isRecord(d.adjudicators) || !Object.entries(d.adjudicators).every(([k, v]) => roles.includes(k) && typeof v === 'string'))) throw new Error('the defaults\' adjudicators are not {primary?, fallback?, appeal?} addresses');
  if (d.maxSubmissions !== undefined && (!Number.isSafeInteger(d.maxSubmissions) || d.maxSubmissions < 0)) throw new Error('the defaults\' maxSubmissions is not a whole number');
  return {
    deliverable: d.deliverable, checks: d.checks, timing: d.timing, ...(d.rubric === undefined ? {} : { rubric: d.rubric }), ...(d.fee === undefined ? {} : { fee: { token: d.fee.token, amount: d.fee.amount } }),
    ...(d.adjudicators === undefined ? {} : { adjudicators: { ...d.adjudicators } }), ...(d.maxSubmissions === undefined ? {} : { maxSubmissions: d.maxSubmissions }),
  };
}

/** The differences readOffer finds against the clock, which checkOffer keeps from the shown offer (T-390). */
const CLOCK_FIELDS = ['createdAt', 'settlementTime'];
/** A distance in seconds as a person reads it: "in 5 years 1 day", "12 min ago". A year is 365 days here. */
export function fromNow(sec: number): string {
  const r = Math.abs(Math.round(sec));
  const a = r >= 86_400 ? Math.round(r / 60) * 60 : r; // past a day, to the minute: seconds of drift do not change the words
  const y = Math.floor(a / (365 * 86_400)), d = Math.floor((a % (365 * 86_400)) / 86_400), h = Math.floor((a % 86_400) / 3600), m = Math.floor((a % 3600) / 60);
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? '' : 's'}`;
  const text = y ? [n(y, 'year'), ...(d ? [n(d, 'day')] : [])].join(' ') : d ? [n(d, 'day'), ...(h ? [`${h} h`] : [])].join(' ') : h ? `${h} h ${m} min` : m ? `${m} min` : `${a} s`;
  return a === 0 ? 'now' : sec > 0 ? `in ${text}` : `${text} ago`;
}

/**
 * What an offer changes from a seller's defaults (filled with the scope): each changed deliverable field, check,
 * rubric, adjudication fee and window, old value and new. Shown to the buyer's agent so it can decide; the signer
 * judges none of them (D28).
 */
export function differencesOf(defaults: Defaults, offer: Offer): Difference[] {
  const out: Difference[] = [];
  // Exact canonical JSON: a change of case in a check's value is a change (no address lowercasing here).
  const add = (field: string, old: J, now: J) => {
    if (jcs(old ?? null) !== jcs(now ?? null)) out.push({ field, old: old ?? null, new: now ?? null });
  };
  for (const k of [...new Set([...Object.keys(defaults.deliverable), ...Object.keys(offer.deliverable ?? {})])]) add(`deliverable.${k}`, defaults.deliverable[k], offer.deliverable?.[k]);
  // By id. Each id once, in order of first appearance; an id held by more than one check compares as the list of them.
  const ids = (list: J[]) => list.map((c) => String(c.id));
  const withId = (list: J[], id: string) => list.filter((c) => c.id === id);
  const one = (list: J[]) => (list.length === 0 ? null : list.length === 1 ? list[0] : list);
  for (const id of [...new Set([...ids(defaults.checks), ...ids(offer.checks)])]) add(`checks.${id}`, one(withId(defaults.checks, id)), one(withId(offer.checks, id)));
  // Checks run in order: the ids both lists hold, in another order, are a change of their own.
  const common = (list: J[], other: J[]) => [...new Set(ids(list))].filter((id) => ids(other).includes(id));
  if (jcs(common(defaults.checks, offer.checks)) !== jcs(common(offer.checks, defaults.checks))) out.push({ field: 'checks', old: ids(defaults.checks), new: ids(offer.checks) });
  add('rubric', defaults.rubric ?? EMPTY_RUBRIC, offer.rubric);
  if (defaults.fee) add('fees.adjudication', defaults.fee, offer.fees.adjudication);
  for (const w of WINDOWS) if (defaults.timing[w] !== undefined) add(`deadlines.${w}`, defaults.timing[w], offer.windows[w]);
  if (defaults.maxSubmissions !== undefined) add('deadlines.maxSubmissions', defaults.maxSubmissions, offer.maxSubmissions);
  // Addresses ignore case; the offer's are lowercase already.
  for (const role of ['primary', 'fallback', 'appeal'] as const) {
    const d = defaults.adjudicators?.[role];
    if (d !== undefined) add(`adjudicators.${role}`, d.toLowerCase(), String(offer.adjudicators[role]).toLowerCase());
  }
  return out;
}
const OFFER_FIELDS: Array<[string, (o: Offer) => J]> = [
  ['commitmentId', (o) => o.commitmentId], ['seller', (o) => o.seller], ['price', (o) => o.price],
  ['fees.adjudication', (o) => o.fees.adjudication], ['fees.operator', (o) => o.fees.operator], ['fees.total', (o) => o.fees.total],
  ['deliverable', (o) => o.deliverable], ['checks', (o) => o.checks], ['rubric', (o) => o.rubric], ['deadlines', (o) => o.deadlines],
  ['windows', (o) => o.windows], ['maxSubmissions', (o) => o.maxSubmissions], ['adjudicators', (o) => o.adjudicators],
  ['settlement.mode', (o) => o.settlement?.mode], ['disclosure.level', (o) => o.disclosure?.level], ['clubId', (o) => o.clubId], ['rulebookHash', (o) => o.rulebookHash],
  ['policyId', (o) => o.policyId], ['policyHash', (o) => o.policyHash], ['registryHash', (o) => o.registryHash],
  ['buyerPaymentAddress', (o) => o.buyerPaymentAddress], ['sellerPayoutAddress', (o) => o.sellerPayoutAddress],
  ['schemaVersion', (o) => o.schemaVersion], ['token', (o) => o.token], ['remedy.onReject', (o) => o.remedy?.onReject], ['nonce', (o) => o.nonce], ['createdAt', (o) => o.createdAt],
  ['differences', (o) => o.differences ?? null],
];
/** The seven of T-332 and maxSubmissions, as OFFER_FIELDS names them. An Approved holds each under the name's first part. */
const SIGNED_FIELDS = OFFER_FIELDS.filter(([f]) => ['settlement.mode', 'disclosure.level', 'clubId', 'rulebookHash', 'policyId', 'policyHash', 'registryHash', 'maxSubmissions'].includes(f));
const sha256 = async (b: Uint8Array) => `sha256:${Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(b))).toString('hex')}`;
const defaultOperators = () => (process.env['HOLDBACK_OPERATORS'] || 'https://api.crow.direct,https://api2.crow.direct').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);

const EXPECT_KEYS = ['settlementMode', 'clubId', 'rulebookHash', 'policyId', 'policyHash', 'registryHash'];
/** The buyer's expectations, or an error naming the setting that is not one: a misspelt key must not fall back unseen. */
function expectOf(e: unknown): Expect {
  if (e === undefined) return {};
  if (!isRecord(e)) throw new Error(`expect is not an object of ${EXPECT_KEYS.join(', ')}`);
  for (const [k, v] of Object.entries(e as J)) {
    if (!EXPECT_KEYS.includes(k)) throw new Error(`expect.${printable(JSON.stringify(k.slice(0, 40)))} is not a setting: the settings are ${EXPECT_KEYS.join(', ')}`);
    if (typeof v !== 'string') throw new Error(`expect.${k} is not a string`);
  }
  return { ...(e as Expect) };
}

/**
 * Why a file a wallet signed is not the message the signer wrote, by name: another payer, another deal, more than the
 * approved amount, or anything else (the domain, the types, the recipient, the dates). Null when they are the same.
 */
function signedFileDiffers(name: string, got: J, mine: J): string | null {
  let digest: string;
  try {
    digest = digestOfFile(got);
  } catch {
    return `the signed ${name} file is not EIP-712 typed data`;
  }
  if (digest === digestOfFile(mine)) return null;
  const g = isRecord(got?.message) ? got.message : {}, m = mine.message;
  const lc = (v: J) => String(v).toLowerCase();
  if (lc(g.from) !== lc(m.from)) return `the signed ${name} message pays from ${shown(g.from ?? null)}, not the payment address ${m.from}`;
  if (m.commitmentId !== undefined && lc(g.commitmentId) !== lc(m.commitmentId)) return `the signed ${name} message is for another deal: ${shown(g.commitmentId ?? null)}, not ${m.commitmentId}`;
  if (lc(g.nonce) !== lc(m.nonce)) return m.commitmentId !== undefined ? `the signed ${name} message has the nonce ${shown(g.nonce ?? null)}, not the ${m.nonce} the signer wrote for this deal: sign the file it wrote last` : `the signed ${name} message is for another deal: its nonce ${shown(g.nonce ?? null)} is not this deal's ${m.nonce}`;
  if (DEC.test(String(g.value)) && BigInt(g.value) > BigInt(m.value)) return `the signed ${name} message pays ${g.value} base units, more than the approved ${m.value}`;
  return `the signed ${name} message is not the one the signer wrote (its domain, types, recipient, amount or dates differ)`;
}

/** Writes one key file: a temporary file with mode 0600, then a rename, so a crash leaves the old file or the new one. */
function save(store: string, s: Saved): void {
  mkdirSync(store, { recursive: true, mode: 0o700 });
  const file = join(store, `${s.address}.json`);
  writeFileSync(`${file}.tmp`, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 });
  chmodSync(`${file}.tmp`, 0o600); // whatever the umask
  renameSync(`${file}.tmp`, file);
}

/** One deal's buyer keys and the buyer steps they sign. Make one with makeKeys; reopen one with loadKeys. */
export class BuyerSigner {
  /** The buyer's address in this deal: the per-deal signing key's. */
  readonly address: string;
  /** The buyer's x25519 public key, base64url: the seller seals the work's key to it. */
  readonly encryptionPublicKey: string;
  /** The directory that holds the key file, `<address>.json`. */
  readonly store: string;
  readonly #operators: string[];
  readonly #quoteCredentialEnv: string | undefined;
  readonly #expect: Expect;
  readonly #saved: Saved;
  readonly #log: (line: string) => void;
  readonly #clockNow: () => number;
  #connected: Promise<{ agent: Agent; pin: Pin }> | undefined;

  /**
   * The buyer's payment address (ADR-0033): it funds the hold and the operator fee and receives every refund. The
   * signing address unless makeKeys was given another.
   */
  get paymentAddress(): string {
    return this.#saved.paymentAddress ?? this.address;
  }
  /** The deal this key serves, once quote or checkOffer bound it. */
  get commitmentId(): Hex | undefined {
    return this.#saved.commitmentId;
  }
  /** The offer readOffer last showed with this key, differences included: what an approval given in a later run names (T-368). */
  get shownOffer(): Offer | undefined {
    return this.#saved.shown ? structuredClone(this.#saved.shown.offer) : undefined;
  }
  /** What agreeAndFund took, once it funded the hold: what a resumed client reports. */
  get paid(): Paid | undefined {
    return this.#saved.paid;
  }

  /** Use makeKeys, loadKeys or openDeals. */
  constructor(store: string, saved: unknown, options: Options = {}) {
    const s = saved as Saved;
    this.store = store;
    this.#saved = s;
    this.#operators = options.operators ?? defaultOperators();
    this.#quoteCredentialEnv = options.quoteCredentialEnv;
    this.#expect = expectOf(options.expect);
    this.#log = options.log ?? ((line) => console.error(line));
    this.#clockNow = options.clock ?? Date.now;
    this.address = privateKeyToAccount(s.privateKey).address.toLowerCase();
    this.encryptionPublicKey = Buffer.from(nacl.box.keyPair.fromSecretKey(new Uint8Array(Buffer.from(s.encryptionSecretKey, 'base64url'))).publicKey).toString('base64url');
    if (s.version !== 1 || s.address !== this.address) throw new Error(`the key file for ${s.address} in ${store} is not one this file wrote`);
    if (s.paymentAddress !== undefined && !/^0x[0-9a-f]{40}$/.test(s.paymentAddress)) throw new Error(`the key file for ${s.address} in ${store} names a payment address that is not one`);
  }

  /**
   * The agent for this key, under the settlement layer the operators serve, which must be one pinned in verify.ts.
   * Every operator that answers must name the same domain, and it must be a pinned one, so one offline operator does
   * not stop a restarted signer from following its deal.
   */
  #connect(): Promise<{ agent: Agent; pin: Pin }> {
    this.#connected ??= (async () => {
      const secret = new Uint8Array(Buffer.from(this.#saved.encryptionSecretKey, 'base64url'));
      const boot = new Agent(this.#operators, this.#saved.privateKey, secret);
      const found = await this.#agreed(boot.sources(), '/.well-known/holdback.json', (x) => x.domain);
      const pins = knownPins();
      const pin = pins.find((p) => same(p.domain, found)) ?? refuse(`the operators serve EIP-712 domain ${shown(found)}, not one pinned here (${pins.map((p) => jcs(p.domain)).join(' or ')})`);
      return { agent: new Agent(this.#operators, this.#saved.privateKey, secret, pin.domain, pin.chain), pin };
    })();
    return this.#connected;
  }

  /**
   * The deal's one token (plan section 2c): the pinned settlement layer's, which every operator's discovery must name
   * too, or the signer refuses. A tool takes it from here and never from a template.
   */
  async token(): Promise<Pin['token']> {
    const { agent, pin } = await this.#connect();
    const listed = await agent.trusted('/.well-known/holdback.json', (x) => (typeof x.demo?.token?.id === 'string' ? x.demo.token.id.toLowerCase() : null));
    if (listed !== null && listed !== pin.token.id.toLowerCase()) refuse(`the operators' discovery names the token ${shown(listed)}, and the pinned settlement layer holds ${pin.token.id} (${pin.token.symbol})`);
    return { ...pin.token };
  }

  /**
   * The buyer's own terms (the defaults' format, as `--expect-terms` takes them) in the deal's one token: a `price` or
   * `fee` that names no token takes it, and one that names another is refused, naming both, before any quote is asked.
   */
  async inToken<T>(terms: T): Promise<T> {
    const token = await this.token();
    const t = structuredClone(terms) as J;
    for (const k of ['price', 'fee']) {
      if (!isRecord(t?.[k])) continue;
      if (t[k].token !== undefined && String(t[k].token).toLowerCase() !== token.id.toLowerCase()) refuse(`your terms' ${k} names the token ${shown(t[k].token)}, and these operators settle in ${token.id} (${token.symbol}) only: name that token, or leave the token out`);
      t[k] = { token: token.id, amount: t[k].amount };
    }
    return t as T;
  }

  /** A key serves one deal: binds it to `id`, or stops when it already serves another. */
  #bind(id: Hex): void {
    const bound = this.#saved.commitmentId;
    if (bound && bound !== id) throw new Error(`this key already serves ${bound}: one key, one deal. Call makeKeys for another deal`);
    this.#saved.commitmentId = id;
  }

  /**
   * GET `path` from each operator in `sources`, with the answers of those that answered 2xx within 15 s. An operator
   * that is offline or fails is left out; the caller decides what the others' answers are worth.
   */
  async #answers(sources: string[], path: string): Promise<Array<{ api: string; body: J }>> {
    const got = await Promise.all(
      sources.map(async (api) => {
        try {
          const res = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(15_000) });
          return res.ok ? { api, body: (await res.json()) as J } : null;
        } catch {
          return null;
        }
      }),
    );
    return got.filter((a): a is { api: string; body: J } => a !== null);
  }

  /** One value every answering operator agrees on (on `pick`); it stops when none answers or two disagree. */
  async #agreed<T>(sources: string[], path: string, pick: (x: J) => T): Promise<T> {
    const answers = await this.#answers(sources, path);
    if (answers.length === 0) throw new Error(`no operator answered GET ${path} (${sources.join(', ')})`);
    const picked = answers.map((a) => pick(a.body));
    if (new Set(picked.map((p) => jcs(lowerHex(p)))).size !== 1) throw new Error(`operators disagree on ${path}; do not proceed`);
    return picked[0]!;
  }

  /** Polls every operator until each reports one of `states`. */
  async #until(id: Hex, states: string[], timeoutMs: number): Promise<J> {
    const { agent } = await this.#connect();
    let seen: J[] = [];
    for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(400)) {
      seen = await Promise.all(agent.sources().map((api) => agent.call('GET', `/v1/commitments/${id}`, undefined, api)));
      if (seen.every((s) => states.includes(s.escrowState))) return seen[0];
    }
    throw new Error(`${id} is still ${seen.map((s) => s.escrowState).join(' / ')} after ${timeoutMs / 1000} s, waiting for ${states.join(' or ')}`);
  }

  /**
   * Asks a seller's quote route for an offer to this key: POST `quoteUrl` with `{buyer, buyerEncryptionPublicKey,
   * scope, options?}`, answered by `{commitmentId, price, fees, expiresAt}`. `options` are the seller's own (its
   * published defaults list them). The answer is the seller's claim; readOffer and checkOffer read the offer itself
   * from the operators.
   */
  async quote(quoteUrl: string, scope: unknown, options?: unknown): Promise<Quote> {
    if (this.#saved.commitmentId) throw new Error(`this key already serves ${this.#saved.commitmentId}: one key, one deal. Call makeKeys for another deal`);
    const name = this.#quoteCredentialEnv;
    const credential = name === undefined ? undefined : process.env[name];
    // The variable's name in the error, never its value.
    if (name !== undefined && !credential) throw new Error(`quoteCredentialEnv names ${name}, which is not set: set it to the seller's quote credential`);
    // ADR-0033 §7: the one line that says where the money comes from when no payment address is set.
    if (this.#saved.paymentAddress === undefined) this.#log(`Payment address: not set. The signing address ${this.address} funds the hold, and refunds return to it.`);
    else this.#log(`Payment address: ${this.paymentAddress} funds the hold and the operator fee, and refunds return to it. The signing address ${this.address} receives none of the deal's money.`);
    this.#saved.quoteKey ??= crypto.randomUUID();
    this.#saved.scope = scope;
    if (options === undefined) delete this.#saved.options;
    else this.#saved.options = options;
    save(this.store, this.#saved);
    const res = await fetch(quoteUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': this.#saved.quoteKey, ...(credential ? { authorization: `Bearer ${credential}` } : {}) },
      body: JSON.stringify({ buyer: this.address, buyerEncryptionPublicKey: this.encryptionPublicKey, ...(this.#saved.paymentAddress === undefined ? {} : { buyerPaymentAddress: this.#saved.paymentAddress }), scope, ...(options === undefined ? {} : { options }) }),
      signal: AbortSignal.timeout(120_000),
    });
    const q = (await res.json().catch(() => null)) as J;
    // The seller's own words for a refusal, as printable text, at most 200 characters: untrusted, shown and never followed.
    const why = typeof q?.detail === 'string' ? `: ${q.detail.replace(/[^\x20-\x7e]/g, '?').slice(0, 200)}` : '';
    if (!res.ok || q === null) throw new Error(`the seller's quote route answered ${res.status}${why}`);
    const id = String(q.commitmentId).toLowerCase() as Hex;
    if (!ID.test(id) || !isMoney(q.price) || typeof q.expiresAt !== 'string') throw new Error("the seller's quote is not {commitmentId, price, fees, expiresAt}");
    const quote: Quote = { commitmentId: id, price: { token: q.price.token, amount: q.price.amount }, fees: q.fees ?? null, expiresAt: q.expiresAt };
    this.#bind(id);
    this.#saved.quote = quote;
    save(this.store, this.#saved);
    return quote;
  }

  /**
   * Test service only: asks the faucet for `amount` base units of the test token (the deal's total) for the payment
   * address, and a mandate in the demo club for the signing key, which a fresh key needs before it can agree. With
   * the two addresses apart the signing key gets the mandate and no tokens. The faucet serves a signing key once an hour.
   */
  async testFunds(amount: string): Promise<Money> {
    if (!DEC.test(amount) || amount === '0') throw new Error('amount is base units as a decimal string, above 0');
    const { agent, pin } = await this.#connect();
    if (this.paymentAddress === this.address) {
      const grant = await agent.call('POST', '/v1/faucet', { address: this.address, amount });
      return { token: grant.granted.token, amount: grant.granted.amount };
    }
    // ADR-0033 §5 (T-378): one grant, the tokens to the payment address and the mandate to the signing key, which gets
    // no tokens. The faucet mints nothing to a payment address that already holds the amount.
    const heldNow = async () => String((await agent.trusted(`/v1/balances/${this.paymentAddress}`, (x) => x.amount)) ?? '0');
    let grant: J = null;
    try {
      grant = await agent.call('POST', '/v1/faucet', { address: this.address, amount, paymentAddress: this.paymentAddress });
    } catch (e) {
      // A second run within the hour (an approve after a stop): the first grant stands when the payment address holds the total.
      const h = await heldNow();
      if (!/: rate_limited: /.test((e as Error).message) || !DEC.test(h) || BigInt(h) < BigInt(amount)) throw e;
    }
    const held = await heldNow();
    if (!DEC.test(held) || BigInt(held) < BigInt(amount)) throw new Error(`the faucet did not fund the payment address ${this.paymentAddress} (it holds ${held} base units): these operators predate the faucet's payment address (T-378)`);
    return { token: grant?.granted?.token ?? pin.token.id, amount: grant?.granted?.amount ?? '0' };
  }

  /**
   * The offer against every configured operator's settlement time (T-390, T-388 H1): a difference when `createdAt` is
   * outside CREATED_AT_BAND of any operator's time or of this machine's clock, or when the operators' times are further
   * apart than the band; and the timeline from this machine's clock. Advisory: a difference stops a one-run buy for approval and refuses nothing (D31).
   */
  async #clock(sources: string[], offer: Offer): Promise<{ clock: Difference[]; timeline: NonNullable<Offer['timeline']> }> {
    const answers = await this.#answers(sources, '/.well-known/holdback.json');
    const times = answers.map((a) => ({ api: a.api, at: Date.parse(String(a.body?.settlementTime)) })).filter((x) => Number.isFinite(x.at));
    if (times.length === 0) throw new Error('no operator reports its settlement time: the offer cannot be read against the clock');
    const { behindSec, aheadSec } = CREATED_AT_BAND;
    const clock: Difference[] = [];
    const spread = (Math.max(...times.map((t) => t.at)) - Math.min(...times.map((t) => t.at))) / 1000;
    if (spread > behindSec + aheadSec) clock.push({ field: 'settlementTime', old: `the operators' clocks within ${behindSec + aheadSec} s of each other`, new: Object.fromEntries(times.map((t) => [t.api, new Date(t.at).toISOString()])) });
    const created = Date.parse(String(offer.createdAt));
    // This machine's clock too (PR red team, Medium): both configured operators may be one party, and a time only they
    // report is a time they choose. A machine whose own clock is off stops honest offers for approval, and loses nothing.
    const local = this.#clockNow();
    const offsets = [...times.map((t) => t.at), local].map((at) => (created - at) / 1000);
    if (!Number.isFinite(created) || offsets.some((o) => o > aheadSec || o < -behindSec)) clock.push({ field: 'createdAt', old: `within ${behindSec} s behind and ${aheadSec} s ahead of every operator's settlement time and of this machine's clock`, new: offer.createdAt });
    // From now on this machine's clock: the distances a person reads, which no operator sets.
    const now = local;
    const timeline: NonNullable<Offer['timeline']> = {};
    for (const [k, v] of [['createdAt', offer.createdAt], ...['offerExpiresAt', 'fundBy', 'deliverBy', 'judgeBy', 'fallbackBy'].map((k) => [k, offer.deadlines?.[k]])] as Array<[string, J]>) {
      const ms = Date.parse(String(v));
      timeline[k] = { at: String(v), fromNow: Number.isFinite(ms) ? fromNow((ms - now) / 1000) : 'not a date' };
    }
    return { clock, timeline };
  }

  /** The terms of `id` as both operators serve them, with the ID recomputed and the seller's signature recovered. */
  async #served(id: Hex): Promise<{ terms: J; offer: Offer }> {
    const { agent, pin } = await this.#connect();
    const { id: servedId, signatures, ...terms } = await agent.trusted(`/v1/commitments/${id}/terms`);
    // The level first: at private and judgment an operator serves no plain deliverable or acceptance (ADR-0024), so
    // the ID below would not recompute. Name the level, not a mismatch that reads like tampering (T-332).
    if (terms.disclosure?.level !== 'public') refuse(`disclosure.level is ${shown(terms.disclosure?.level ?? null)}, not "public", the one level whose terms this file can read and show`);
    if (commitmentIdOf(terms) !== id || String(servedId).toLowerCase() !== id) refuse(`the commitment ID does not match the terms the operators serve (recomputed ${commitmentIdOf(terms)})`);
    const signer = await recoverTypedDataAddress({ ...typedOf('CommitmentTerms', terms, agent.domain), signature: signatures?.seller }).catch(() => '');
    if (signer.toLowerCase() !== String(terms.seller).toLowerCase()) refuse("the seller's signature does not recover to the seller in the terms");
    const price: Money = terms.price, adjudication: Money = terms.adjudication.fee;
    if (!isMoney(price) || !isMoney(adjudication) || adjudication.token !== price.token || terms.settlement?.token !== price.token) refuse('the price, the adjudication fee and the settlement are not in one token');
    // One token (plan section 2c): the pinned settlement layer's, which every operator's discovery must name too.
    const listed = await agent.trusted('/.well-known/holdback.json', (x) => (typeof x.demo?.token?.id === 'string' ? x.demo.token.id.toLowerCase() : null));
    if (listed !== null && listed !== pin.token.id.toLowerCase()) refuse(`the operators' discovery names the token ${shown(listed)}, and the pinned settlement layer holds ${pin.token.id} (${pin.token.symbol})`);
    if (price.token.toLowerCase() !== pin.token.id.toLowerCase()) refuse(`the offer is in ${shown(price.token)}, and this settlement layer holds ${pin.token.id} (${pin.token.symbol}): the operators refuse any other`);
    // The operator fee: computed here from the schedule both operators publish, never read from the seller.
    const schedule = await agent.operatorFeeSchedule();
    const operator = schedule ? operatorFeeOf(price, schedule) : 0n;
    const a = terms.adjudication;
    // The deadlines as the windows the seller configured: the first three from createdAt, judge from deliverBy,
    // fallback from judgeBy (apps/operator/src/terms.ts, completeTerms).
    const t = terms.timing, at = (s: J) => Date.parse(String(s)) / 1000;
    const windows: Record<Window, number> = {
      offerExpiresInSec: at(t.offerExpiresAt) - at(terms.createdAt), fundWithinSec: at(t.fundBy) - at(terms.createdAt), deliverWithinSec: at(t.deliverBy) - at(terms.createdAt),
      judgeWithinSec: at(t.judgeBy) - at(t.deliverBy), fallbackWithinSec: at(t.fallbackBy) - at(t.judgeBy), appealWindowSec: t.appealWindowSec, appealDecideSec: t.appealDecideSec,
    };
    const offer: Offer = {
      commitmentId: id, seller: String(terms.seller).toLowerCase(), price,
      fees: { adjudication, operator: { token: price.token, amount: operator.toString() }, total: { token: price.token, amount: (BigInt(price.amount) + BigInt(adjudication.amount) + operator).toString() } },
      deliverable: terms.deliverable, checks: terms.acceptance.deterministicChecks, rubric: terms.acceptance.rubric, deadlines: terms.timing, windows, maxSubmissions: t.maxSubmissions,
      adjudicators: { primary: a.adjudicator, fallback: a.fallbackAdjudicator, appeal: a.appealAdjudicator },
      settlement: { mode: terms.settlement?.mode }, disclosure: { level: terms.disclosure?.level }, clubId: terms.clubId, rulebookHash: terms.rulebookHash,
      policyId: a.policyId, policyHash: a.policyHash, registryHash: a.registryHash,
      buyerPaymentAddress: String(terms.buyerPaymentAddress).toLowerCase(), sellerPayoutAddress: String(terms.sellerPayoutAddress).toLowerCase(),
      schemaVersion: terms.schemaVersion, remedy: { onReject: terms.remedy?.onReject }, nonce: String(terms.nonce).toLowerCase() as Hex, createdAt: terms.createdAt,
      token: { ...pin.token },
    };
    await this.#expected(agent, offer);
    return { terms, offer };
  }

  /**
   * Refuses (naming the field) unless each of the seven signed fields of T-332 equals what the buyer expects
   * (Options.expect) and what every operator publishes: the settlement modes and the demo club in discovery, the
   * club's rulebook hash, and the primary adjudicator's policy and registry. Every read must answer the same on every
   * operator (Agent.trusted), and the club and policy hashes are checked against the bodies they hash.
   */
  async #expected(agent: Agent, offer: Offer): Promise<void> {
    const e = this.#expect;
    const differs = (field: string, got: J, want: J, from: string) => {
      if (!same(got ?? null, want ?? null)) refuse(`${field} is ${shown(got ?? null)}, not ${from}`);
    };
    const mine = (field: string, got: J, key: keyof Expect) => {
      if (e[key] !== undefined) differs(field, got, e[key], `the expected ${shown(e[key])} (expect.${key})`);
    };
    const found = await agent.trusted('/.well-known/holdback.json', (x) => ({ modes: Array.isArray(x.settlementModes) ? x.settlementModes : [], clubId: typeof x.demo?.clubId === 'string' ? x.demo.clubId : null }));

    const mode = offer.settlement.mode;
    if (e.settlementMode !== undefined) mine('settlement.mode', mode, 'settlementMode');
    else if (!found.modes.includes(mode)) refuse(`settlement.mode is ${shown(mode ?? null)}, not a mode every operator lists (${shown(found.modes)}): set expect.settlementMode to sign another`);
    // disclosure.level: #served refused anything but public before it read the terms.

    if (e.clubId !== undefined) mine('clubId', offer.clubId, 'clubId');
    else if (found.clubId === null) refuse(`clubId is ${shown(offer.clubId ?? null)}, and the operators name no demo club: set expect.clubId to the club you expect`);
    else differs('clubId', offer.clubId, found.clubId, `the demo club every operator names (${shown(found.clubId)}): set expect.clubId to sign another`);
    // The club is now the expected one: its rulebook as every operator serves it, hash checked against the body.
    const { rulebookHash } = await agent.club(offer.clubId);
    differs('rulebookHash', offer.rulebookHash, rulebookHash, `the hash every operator serves for club ${shown(offer.clubId)} (${shown(rulebookHash)})`);
    mine('rulebookHash', offer.rulebookHash, 'rulebookHash');

    // The primary adjudicator's registration as every operator serves it, its policy hash checked against the policy.
    const reg = await agent.registration(offer.adjudicators.primary);
    const theirs = (v: J) => `the primary adjudicator's as every operator serves it (${shown(v ?? null)})`;
    differs('policyId', offer.policyId, reg.policy?.id, theirs(reg.policy?.id));
    mine('policyId', offer.policyId, 'policyId');
    differs('policyHash', offer.policyHash, reg.policyHash, theirs(reg.policyHash));
    mine('policyHash', offer.policyHash, 'policyHash');
    differs('registryHash', offer.registryHash, reg.registry?.hash, theirs(reg.registry?.hash));
    mine('registryHash', offer.registryHash, 'registryHash');
  }

  /**
   * The offer as both operators serve it, for the buyer's agent to approve. Signs nothing. With `defaults` (the
   * seller's published defaults, or the URL that serves them) it adds `differences`: each check, window and
   * requirement this offer changes, old value and new. The key file records what was shown; checkOffer refuses an
   * offer that differs from it. It refuses to show an offer whose settlement mode, disclosure level, club, rulebook
   * hash or adjudicator policy differs from Options.expect or from what every operator publishes (T-332).
   */
  async readOffer(commitmentId: string, options: { defaults?: Defaults | string } = {}): Promise<Offer> {
    const id = commitmentId.toLowerCase() as Hex;
    let defaults: Defaults | null = null;
    if (options.defaults !== undefined) {
      let given: J = options.defaults;
      if (typeof given === 'string') {
        const res = await fetch(given, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`the seller's defaults at ${new URL(given).origin}${new URL(given).pathname.slice(0, 120)} answered ${res.status}`); // no query: it may hold a token
        given = await res.json();
      }
      defaults = fillWith(defaultsOf(given), this.#saved.scope) as Defaults;
    }
    const { offer } = await this.#served(id);
    const { pin, agent } = await this.#connect();
    // ADR-0033 §7: advisory lines for an odd money address. They refuse nothing; checkOffer refuses a payment address that is not this buyer's.
    for (const w of [...moneyAddressWarnings('payout', offer.sellerPayoutAddress, pin, offer.adjudicators), ...moneyAddressWarnings('payment', offer.buyerPaymentAddress, pin, offer.adjudicators)]) this.#log(w);
    // T-390 (T-388 H1): the windows count from the seller's createdAt, so a createdAt far from the clock moves every
    // deadline though no window differs. Judged now, when the offer is shown; checkOffer keeps this verdict.
    const { clock, timeline } = await this.#clock(agent.sources(), offer);
    for (const d of clock) {
      this.#log(d.field === 'createdAt'
        ? `Warning: the offer's createdAt, ${shown(d.new)}, is ${timeline['createdAt']?.fromNow ?? 'off'} by this machine's clock, and every deadline moves with it: deliverBy is ${timeline['deliverBy']?.fromNow ?? 'unknown'}. An honest offer's createdAt is ${d.old}. Approve it only if you mean these deadlines.`
        : `Warning: the operators' clocks are further apart than ${CREATED_AT_BAND.behindSec + CREATED_AT_BAND.aheadSec} s (${shown(d.new)}): the offer's times cannot be read against one clock. Approve it only if you mean its deadlines.`);
    }
    const found = defaults ? differencesOf(defaults, offer) : [];
    const showing: Offer = { ...offer, timeline, ...(defaults || clock.length ? { differences: [...found, ...clock] } : {}) };
    this.#saved.shown = { commitmentId: id, offer: showing, defaults };
    save(this.store, this.#saved);
    return showing;
  }

  /**
   * Reads the offer from both operators and refuses (throws Refusal, naming the field) unless it equals the offer
   * readOffer showed with this key, differences included (compared again with the same defaults), and what the buyer
   * approved: the price, each fee, the deliverable, the checks, the rubric, the deadlines, the adjudicators, the
   * differences when given, the seven signed fields of T-332 when given, and this key's own address and encryption key
   * as the buyer. The seven are also checked against Options.expect and the operators, as readOffer does. Waits up to `timeoutMs` for
   * the primary adjudicator to take the deal. Once it passes, agreeAndFund signs exactly these terms.
   */
  async checkOffer(commitmentId: string, approved: Approved, options: { timeoutMs?: number } = {}): Promise<Offer> {
    const id = commitmentId.toLowerCase() as Hex;
    if (!ID.test(id)) throw new Error('commitmentId is 0x and 64 hex characters');
    const shownBefore = this.#saved.shown;
    if (shownBefore?.commitmentId !== id) return refuse(`readOffer has not shown ${id} with this key: show the buyer's agent the offer first`);
    this.#bind(id);
    const { terms, offer: read } = await this.#served(id);
    // The offer read again from every operator, compared with what the buyer's agent was shown.
    // The clock's verdict is the one made when the offer was shown (readOffer): createdAt grows older while it waits.
    const clock = (shownBefore.offer.differences ?? []).filter((d) => CLOCK_FIELDS.includes(d.field));
    const offer: Offer = { ...read, ...(shownBefore.offer.timeline ? { timeline: shownBefore.offer.timeline } : {}), ...(shownBefore.defaults || clock.length ? { differences: [...(shownBefore.defaults ? differencesOf(shownBefore.defaults, read) : []), ...clock] } : {}) };
    for (const [field, of] of OFFER_FIELDS) if (!same(of(offer), of(shownBefore.offer))) refuse(`${field} is ${shown(of(offer))}, not the shown ${shown(of(shownBefore.offer))}`);
    const want: Array<[string, J, J]> = [
      ['buyer', terms.buyer, this.address],
      ['buyerEncryptionPublicKey', terms.buyerEncryptionPublicKey, this.encryptionPublicKey],
      // ADR-0033 §6: the payment address is this buyer's own, from its key file and nowhere else.
      ['buyerPaymentAddress', offer.buyerPaymentAddress, this.paymentAddress],
      ...(approved.sellerPayoutAddress ? [['sellerPayoutAddress', offer.sellerPayoutAddress, approved.sellerPayoutAddress] as [string, J, J]] : []),
      ['price', offer.price, approved.price],
      ['fees.adjudication', offer.fees.adjudication, approved.fees?.adjudication],
      ['fees.operator', offer.fees.operator, approved.fees?.operator],
      ...(approved.fees?.total ? [['fees.total', offer.fees.total, approved.fees.total] as [string, J, J]] : []),
      ['deliverable', offer.deliverable, approved.deliverable],
      ['checks', offer.checks, approved.checks],
      ['rubric', offer.rubric, approved.rubric ?? EMPTY_RUBRIC],
      ['deadlines', offer.deadlines, approved.deadlines],
      ['adjudicators', offer.adjudicators, approved.adjudicators],
      ...(approved.seller ? [['seller', offer.seller, approved.seller] as [string, J, J]] : []),
      ...(approved.commitmentId ? [['commitmentId', id, approved.commitmentId] as [string, J, J]] : []),
      ...(approved.differences ? [['differences', offer.differences ?? null, approved.differences] as [string, J, J]] : []),
      // T-332: each of the seven the approval names. Each was checked against Options.expect and the operators above.
      ...SIGNED_FIELDS.filter(([f]) => (approved as J)[f.split('.')[0]!] !== undefined).map(([f, of]) => [f, of(offer), of(approved as Offer)] as [string, J, J]),
    ];
    for (const [field, got, expected] of want) if (!same(got, expected)) refuse(`${field} is ${shown(got)}, not the approved ${shown(expected)}`);
    await this.#until(id, ['AcceptedByAdjudicator'], options.timeoutMs ?? 60_000);
    this.#saved.checked = { terms, offer };
    save(this.store, this.#saved);
    return offer;
  }

  /** The prepared funding for the checked terms, with the payment address apart; `nonces` repeat an earlier preparation. */
  async #prepareFunding(checked: { terms: J; offer: Offer }, nonces?: { agreeNonce: Hex; fundingNonce: Hex; operatorFeeNonce?: Hex }) {
    const { agent } = await this.#connect();
    const { price, fees } = checked.offer;
    const schedule = await agent.operatorFeeSchedule();
    const fee = schedule ? operatorFeeOf(price, schedule) : 0n;
    if (fee.toString() !== fees.operator.amount) refuse(`the operator fee is now ${fee} base units, not the approved ${fees.operator.amount}`);
    return agent.prepareAgreeAndFund(checked.terms, BigInt(fees.total.amount), { paymentAddress: this.paymentAddress, ...(nonces ? { nonces } : {}) });
  }

  /**
   * With a payment address apart from this key (ADR-0033): writes each message the payment address must sign as a
   * file in the standard typed-data form `eth_signTypedData_v4` takes, `<address>.funding.typed.json` and, when the
   * operators charge a fee, `<address>.operator-fee.typed.json`, beside the key file. Each message is rebuilt from the
   * approved terms and checked against what the operators prepared (verify.ts), so the two cannot take more than the
   * approved total. It returns one sentence for each (who pays whom how much, until when, for which deal, and the
   * offer's expiry), its digest, and the check the wallet's holder runs before signing (pay-from-wallet.ts check),
   * with the terms written beside the files for it. The holder should run that check where the wallet is: a file
   * replaced on the way would fund another deal (red team M-1). Then give the signatures to agreeAndFund. Calling it
   * again writes the same messages. It signs and sends nothing, and it refuses once the offer has expired.
   */
  async fundingFiles(commitmentId: string): Promise<PaymentFile[]> {
    const id = commitmentId.toLowerCase() as Hex;
    const checked = this.#saved.commitmentId === id ? this.#saved.checked : undefined;
    if (!checked) return refuse(`checkOffer has not passed for ${id} with this key`);
    if (this.paymentAddress === this.address) throw new Error('this key is its own payment address: agreeAndFund signs the funding itself');
    if (this.#saved.paid) throw new Error(`${id} is funded already`);
    const { agent, pin } = await this.#connect();
    const expires = Date.parse(String(checked.terms.timing.offerExpiresAt));
    if ((await agent.settlementNow()) >= expires) throw new Error(`the offer ${id} expired at ${checked.terms.timing.offerExpiresAt}: nothing can fund it now, so no files are written`);
    const saved = this.#saved.funding?.commitmentId === id ? this.#saved.funding : undefined;
    const { intent, slots } = await this.#prepareFunding(checked, saved?.nonces);
    const termsPath = join(this.store, `${this.address}.terms.json`);
    const sh = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);
    const out: Array<{ file: J } & PaymentFile> = slots.filter((x) => x.signer === this.paymentAddress).map((s) => {
      const name = s.slot === 'fund.signature' ? 'funding' : 'operator-fee';
      const file = typedDataFile(s.typed);
      const path = join(this.store, `${this.address}.${name}.typed.json`);
      const fee = name === 'operator-fee' ? ` --fee ${file.message.to} ${file.message.value}` : '';
      // From wherever the command runs, as buy-with-signer.ts builds its own lines.
      const check = `${command('pay-from-wallet', import.meta.url)} check ${sh(path)} ${sh(termsPath)} ${this.address}${fee}${pin.chain ? '' : ' --sim'}`;
      return { file, name, slot: s.slot, path, digest: s.digest, check, summary: `The ${name === 'funding' ? 'funding' : 'operator fee'} (digest ${s.digest}): ${paymentSentence(file, id, pin.token, checked.terms)}` };
    });
    // The record first, so a crash before the files leaves a record that writes the same files again (red team I-2).
    const i = intent as Extract<Intent, { kind: 'agree-and-fund' }>;
    const files: PaymentFile[] = out.map(({ file: _f, ...f }) => f); // eslint-disable-line @typescript-eslint/no-unused-vars
    this.#saved.funding = { commitmentId: id, nonces: { agreeNonce: i.agreeNonce, fundingNonce: i.fundingNonce, ...(i.operatorFee ? { operatorFeeNonce: i.operatorFee.nonce } : {}) }, files };
    save(this.store, this.#saved);
    const write = (path: string, v: J) => {
      writeFileSync(`${path}.tmp`, `${JSON.stringify(v, null, 2)}\n`, { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
    };
    write(termsPath, checked.terms);
    for (const f of out) write(f.path, f.file);
    return files.map((f) => ({ ...f }));
  }

  /**
   * Signs the agreement, the funding authorisation and the operator fee authorisation for the terms checkOffer
   * passed, and returns what the buyer paid. Each prepared message is rebuilt from those terms and compared before it
   * is signed, and the three together cannot take more than the approved total (verify.ts).
   *
   * With a payment address apart from this key, that address signs the funding and the fee elsewhere, from the files
   * fundingFiles wrote, and `signatures` brings them back as hex. This key signs only the agreement. Nothing is sent
   * unless each signature recovers to the payment address over the message this signer rebuilt from the approved
   * terms, which is the one in its file. With `signatures.signed` (the files the wallet signed), a file that differs
   * is refused by name: another payer, another deal, or more than the approved amount.
   */
  async agreeAndFund(commitmentId: string, signatures?: PaymentSignatures): Promise<Paid> {
    const id = commitmentId.toLowerCase() as Hex;
    const checked = this.#saved.commitmentId === id ? this.#saved.checked : undefined;
    if (!checked) return refuse(`checkOffer has not passed for ${id} with this key`);
    if (this.#saved.paid) return this.#saved.paid;
    const { agent } = await this.#connect();
    const { price, fees } = checked.offer;
    const hold = BigInt(price.amount) + BigInt(fees.adjudication.amount);
    const paid: Paid = { total: fees.total, hold: { token: price.token, amount: hold.toString() }, operatorFee: fees.operator, receipt: null };
    const apart = this.paymentAddress !== this.address;
    const written = this.#saved.funding?.commitmentId === id ? this.#saved.funding : undefined;
    if (apart && !written) throw new Error(`the payment address ${this.paymentAddress} signs the funding: call fundingFiles, sign its files with that wallet, and pass the signatures here`);
    if (!apart && signatures) throw new Error('this key is its own payment address: it signs the funding itself, and takes no signatures');
    const state = (await agent.trusted(`/v1/commitments/${id}`, (x) => x.escrowState)) as string;
    if (state === 'AcceptedByAdjudicator') {
      let held: J;
      if (apart) {
        const { prepared, intent, slots } = await this.#prepareFunding(checked, written!.nonces);
        for (const f of written!.files) {
          if (slots.find((s) => s.slot === f.slot)?.digest !== f.digest) refuse(`the operators now prepare another ${f.name} message than the one in ${f.path}: call fundingFiles again, and sign the new file`);
        }
        held = await agent.submitAgreeAndFund(prepared, intent, this.#outsideSignatures(written!, signatures, slots));
      } else {
        const schedule = await agent.operatorFeeSchedule();
        const fee = schedule ? operatorFeeOf(price, schedule) : 0n;
        if (fee.toString() !== fees.operator.amount) refuse(`the operator fee is now ${fee} base units, not the approved ${fees.operator.amount}`);
        held = await agent.agreeAndFund(checked.terms, BigInt(fees.total.amount));
      }
      if (held.escrowState !== 'Held' || held.hold?.amount?.amount !== paid.hold.amount) throw new Error(`expected Held with ${paid.hold.amount} base units, got ${held.escrowState} ${shown(held.hold?.amount ?? null)}`);
      paid.receipt = held.receipt ?? null;
    } else {
      // Not waiting for the agreement any more. When both operators record the funding, an earlier run funded the hold
      // and stopped before it saved: only this key could have agreed. What it paid is what the approved terms say; that
      // run's receipt is gone. Without a recorded funding there is nothing this key paid, and nothing left to fund.
      const funded = await agent.trusted(`/v1/commitments/${id}/events?limit=200`, (x) => x.items.some((e: J) => e.type === 'hold.funded'));
      if (!funded) throw new Error(`${id} is ${state} and no funding is recorded: there is nothing to fund`);
    }
    this.#saved.paid = paid;
    save(this.store, this.#saved);
    return paid;
  }

  /**
   * The outside signatures by slot, after the checks that name what is wrong: one for each file written, as hex,
   * and each signed file given compared with the file written. Agent.submitAgreeAndFund then recovers each signature
   * over this signer's own message, which is what makes a wrong one fail.
   */
  #outsideSignatures(written: NonNullable<Saved['funding']>, given: PaymentSignatures | undefined, slots: Array<{ slot: string; typed: J }>): Record<string, Hex> {
    const out: Record<string, Hex> = {};
    const keys = written.files.map((f) => (f.name === 'funding' ? 'funding' : 'operatorFee'));
    for (const k of ['funding', 'operatorFee'] as const) if (given?.[k] !== undefined && !keys.includes(k)) refuse(`there is no ${k === 'funding' ? 'funding' : 'operator-fee'} message for the payment address to sign in this deal`);
    for (const f of written.files) {
      // Red team M-1: a file replaced after it was written leads the wallet to sign another deal's message. Name it.
      let onDisk: string | null = null;
      try {
        onDisk = digestOfFile(JSON.parse(readFileSync(f.path, 'utf8')));
      } catch {
        onDisk = existsSync(f.path) ? 'unreadable' : null;
      }
      if (onDisk !== null && onDisk !== f.digest) refuse(`${f.path} is not the file the signer wrote: it now hashes to ${onDisk}, not ${f.digest}. Someone replaced it; a signature over it pays for another message. Write the files again with fundingFiles, run the check where the wallet is, and sign the new ones`);
      const key = f.name === 'funding' ? 'funding' : 'operatorFee';
      const sig = given?.[key];
      if (typeof sig !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(sig.trim())) refuse(`the ${f.name} signature is missing or not 65 bytes as 0x and 130 hex characters: sign ${f.path} with the wallet that holds ${this.paymentAddress}`);
      const signed = given?.signed?.[key];
      if (signed !== undefined) {
        const why = signedFileDiffers(f.name, signed, typedDataFile(slots.find((s) => s.slot === f.slot)!.typed));
        if (why) refuse(why);
      }
      out[f.slot] = String(sig).trim() as Hex;
    }
    return out;
  }

  /**
   * Follows a deal this key funded until its outcome is confirmed, and returns it. On the way it tells the buyer's
   * agent (onReport) when the deal is released, refunded, or past the agreed terms' deliverBy with nothing delivered,
   * and when some operators report an outcome too few others confirm. Past deliverBy it sends the reclaim itself.
   *
   * It reads every configured operator and goes on with those that answer. An outcome is final, and saved, only when
   * `confirmations` operators (default: all configured) report it and none reports another state; until then the
   * deal stays open and the reclaim stays armed, so one silent or lying operator cannot close it. The reclaim goes to
   * each operator that reports Held, and to the next one when an operator takes it and the deal stays Held. It adds
   * no deadline of its own (D31): without `timeoutMs` it waits as long as the terms say. The watch file keeps what it
   * has done, so a signer reopened after a restart (loadKeys or openDeals) picks the deal up. Settlement refunds a
   * hold once, however many operators get the reclaim.
   */
  async watch(commitmentId: string, options: WatchOptions = {}): Promise<Outcome> {
    const id = commitmentId.toLowerCase() as Hex;
    const s = this.#saved;
    if (s.commitmentId !== id || !s.paid || !s.checked) throw new Error(`this key funded no hold for ${id}: call agreeAndFund first`);
    const w = readWatched(this.store, this.address, id);
    const keep = () => saveWatched(this.store, this.address, w);
    const unconfirmed = new Set<string>(); // the unconfirmed reports this run made
    const report = async (r: Report) => {
      if (r.kind === 'unconfirmed') {
        const k = `${r.state}/${r.agreeing}/${r.answered}`;
        if (unconfirmed.has(k)) return;
        await options.onReport?.(r);
        unconfirmed.add(k);
        return;
      }
      if (w.reported.includes(r.kind)) return;
      await options.onReport?.(r);
      w.reported.push(r.kind);
      keep();
    };
    const final = async (o: Outcome) => {
      await report(
        o.outcome === 'Released' ? { kind: 'released', commitmentId: id, finalAt: o.finalAt }
        : o.outcome === 'Settled' ? { kind: 'settled', commitmentId: id, payouts: o.settlement?.payouts ?? [], keyReleased: o.settlement?.keyReleased === true, finalAt: o.finalAt }
        : { kind: 'refunded', commitmentId: id, reclaimed: o.reclaimed, finalAt: o.finalAt },
      );
      return o;
    };
    if (w.outcome) return final(w.outcome);

    const { agent } = await this.#connect();
    const sources = agent.sources();
    const required = options.confirmations ?? sources.length;
    if (!Number.isSafeInteger(required) || required < 1 || required > sources.length) throw new Error(`confirmations is a whole number from 1 to the ${sources.length} configured operators`);
    const deliverBy = Date.parse(String(s.checked.terms.timing.deliverBy));
    const maxPause = Math.max(1, options.pollMs ?? 30_000);
    const end = options.timeoutMs === undefined ? Infinity : Date.now() + options.timeoutMs;
    let pause = Math.min(400, maxPause);
    let seen = 'no answer';
    for (;;) {
      const views = await this.#answers(sources, `/v1/commitments/${id}`);
      const stateOf = (v: { body: J }) => String(v.body?.escrowState);
      const states = [...new Set(views.map(stateOf))];
      seen = states.length ? states.join(' / ') : 'no answer';
      let wake = Infinity; // ms until deliverBy on the fastest clock, while the deal is Held before it
      let sent = false;
      for (const state of ['Released', 'Refunded', 'Settled'] as const) {
        const agreeing = views.filter((v) => stateOf(v) === state);
        if (agreeing.length === 0) continue;
        if (agreeing.length >= required && agreeing.length === views.length) {
          const events = await this.#answers(agreeing.map((v) => v.api), `/v1/commitments/${id}/events?limit=200`);
          const reclaimed = events.length > 0 && events.every((a) => Array.isArray(a.body?.items) && a.body.items.some((e: J) => e.type === 'settlement.reclaimed'));
          // A settlement's payouts and key release, as every agreeing operator's event records them: they must be one.
          const settled = events.map((a) => (Array.isArray(a.body?.items) ? a.body.items : []).filter((e: J) => e.type === 'commitment.settled').at(-1)?.payload ?? null);
          const one = state === 'Settled' && events.length === agreeing.length && settled.every((p) => p !== null) && new Set(settled.map((p) => jcs(lowerHex({ payouts: p.payouts ?? null, keyReleased: p.keyReleased === true })))).size === 1;
          if (state !== 'Settled' || one) {
            w.outcome = { commitmentId: id, outcome: state, reclaimed, finalAt: agreeing[0]!.body.finalAt ?? null, ...(state === 'Settled' ? { settlement: { payouts: lowerHex(settled[0]!.payouts ?? []), keyReleased: settled[0]!.keyReleased === true } } : {}) };
            keep();
            return final(w.outcome);
          }
        }
        await report({ kind: 'unconfirmed', commitmentId: id, state, agreeing: agreeing.length, answered: views.length, required });
      }
      const held = views.filter((v) => stateOf(v) === 'Held').map((v) => v.api);
      if (held.length > 0) {
        // Each answering operator's settlement clock: the slowest decides the report, the fastest the reclaim, which
        // settlement refuses while it is early.
        const times = (await this.#answers(views.map((v) => v.api), '/.well-known/holdback.json')).map((a) => Date.parse(a.body?.settlementTime)).filter(Number.isFinite);
        if (times.length > 0) {
          const slowest = Math.min(...times), fastest = Math.max(...times);
          if (slowest > deliverBy) await report({ kind: 'deliverBy-passed', commitmentId: id, deliverBy: String(s.checked.terms.timing.deliverBy), settlementTime: new Date(slowest).toISOString() });
          if (fastest > deliverBy) sent = await this.#reclaim(w, keep, id, sources, held, options.reclaimRetryMs ?? 120_000);
          else wake = deliverBy - fastest + 1000;
        }
      }
      if (sent) {
        pause = Math.min(400, maxPause);
        continue; // read the outcome at once
      }
      if (Date.now() >= end) throw new Error(`${id} is still ${seen} after ${options.timeoutMs! / 1000} s, waiting for ${required} of ${sources.length} operators to report Released or Refunded`);
      await sleep(Math.max(0, Math.min(pause, wake, end - Date.now())));
      pause = Math.min(Math.ceil(pause * 1.5), maxPause);
    }
  }

  /**
   * Sends the reclaim, `POST /v1/commitments/<id>/triggers/reclaim` with `{}`, to the first operator in `held` (the
   * operators that report Held), in the configured order from `w.reclaim.from`, that answers 2xx. True when one did.
   * The request is saved before it is sent. An operator stores only answers below 300 under the Idempotency-Key
   * (apps/operator/src/idempotency.ts), so a refusal is not replayed and the next operator gets the same key. A lost
   * answer keeps the key and returns false: the caller reads the state again first, and the next try starts at the
   * next operator. When the deal is still Held `retryMs` after an operator took the reclaim, that operator may relay
   * nothing: the next operator gets it, under a fresh key, since the first replays its 2xx for the old one.
   */
  async #reclaim(w: Watched, keep: () => void, id: Hex, sources: string[], held: string[], retryMs: number): Promise<boolean> {
    const at = (api: string) => Math.max(0, sources.indexOf(api));
    if (w.reclaim?.answeredBy) {
      if (Date.now() - (w.reclaim.answeredAt ?? 0) < retryMs) return false; // taken: give it time to land
      w.reclaim = { idempotencyKey: crypto.randomUUID(), from: at(w.reclaim.answeredBy) + 1 };
    }
    const r = (w.reclaim ??= { idempotencyKey: crypto.randomUUID(), from: 0 });
    keep();
    const order = sources.map((_, i) => sources[(r.from + i) % sources.length]!).filter((api) => held.includes(api));
    for (const api of order) {
      let res: Response;
      try {
        res = await fetch(`${api}/v1/commitments/${id}/triggers/reclaim`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': r.idempotencyKey }, body: '{}', signal: AbortSignal.timeout(60_000) });
      } catch {
        r.from = at(api) + 1;
        keep();
        return false;
      }
      if (res.ok) {
        r.answeredBy = api;
        r.answeredAt = Date.now();
        keep();
        return true;
      }
      // Too early on this operator's clock, the deal moved on, or the operator refuses: the next one.
    }
    return false;
  }

  /**
   * Watches the deal to its outcome (watch, with the same options: it reports, and reclaims after a missed deadline).
   * On a release it opens this key's envelope, decrypts the work and checks its SHA-256 against the delivery the
   * operators record. On a refund no work is released, and the hold or the price is back at the payment address. Returns the
   * work as text, with the receipt and one link per on-chain step. Text only: it stops on work that is not UTF-8.
   * Like watch, it goes on with one operator offline.
   *
   * On a mutual settlement (T-390) it returns the payouts. When the settlement released the key it opens the work: from
   * the posted delivery, as on a release, or, for late work no operator records as a delivery, from `options.delivery`,
   * the seller-signed delivery the seller handed over. That one opens only if the seller's signature recovers, the
   * released envelope is this key's own in it, and the ciphertext and the plaintext match its signed hashes. Without
   * the key released, or without the handed-over delivery for late work, it opens nothing and `settlement.note` says why.
   */
  async openDelivery(commitmentId: string, options: WatchOptions & { delivery?: J } = {}): Promise<Delivery> {
    const id = commitmentId.toLowerCase() as Hex;
    const paid = this.#saved.commitmentId === id ? this.#saved.paid : undefined;
    if (!paid) throw new Error(`this key funded no hold for ${id}: call agreeAndFund first`);
    const done = await this.watch(id, options);
    const { agent, pin } = await this.#connect();
    const sources = agent.sources();
    const path = `/v1/commitments/${id}/events?limit=200`;
    const events = (await this.#agreed(sources, path, (x) => x.items.map((e: J) => ({ seq: e.seq, type: e.type, hash: e.hash, tx: typeof e.payload?.tx === 'string' ? e.payload.tx : null, delivery: e.type === 'delivery.submitted' ? { uri: e.payload?.ciphertext?.uri, plaintextSha256: e.payload?.plaintextSha256 } : null })))) as J[];
    events.sort((a, b) => a.seq - b.seq);
    let work: string | null = null;
    let plaintextSha256: string | null = null;
    let note: string | null = null;
    let lateHash: string | null = null;
    const posted = events.some((e) => e.delivery);
    if (done.outcome === 'Settled' && !done.settlement?.keyReleased) note = 'the settlement released no key: there is no work to open';
    else if (done.outcome === 'Settled' && !posted) {
      if (options.delivery === undefined) note = 'the settlement released the key to late work no operator records as a delivery: pass the signed delivery the seller handed you (resume ... --delivery <file>) to open it';
      else {
        work = await this.#openLate(id, options.delivery);
        plaintextSha256 = await sha256(new TextEncoder().encode(work));
        // Compare it with the deliveryHash of the settlement you signed: no public read carries that one (PR 440 review, Low 1).
        lateHash = deliveryHashOf(options.delivery).toLowerCase();
      }
    }
    if (done.outcome === 'Released' || (done.outcome === 'Settled' && done.settlement?.keyReleased && posted)) {
      const recorded = events.find((e) => e.delivery)?.delivery;
      // The ciphertext comes from an operator's own store, at the address the operators record.
      if (typeof recorded?.uri !== 'string' || !sources.some((op) => new URL(op).origin === new URL(recorded.uri).origin)) throw new Error(`the operators record the delivery at ${shown(recorded?.uri)}, not on an operator`);
      // Agent.openDelivery reads the key from its first operator: put one that answers first.
      const up = (await this.#answers(sources, path)).map((a) => a.api);
      const opener = new Agent([...up, ...sources.filter((op) => !up.includes(op))], this.#saved.privateKey, agent.encryptionSecretKey, pin.domain, pin.chain);
      work = await opener.openDelivery(id); // opens the envelope, decrypts, checks both signed hashes
      plaintextSha256 = await sha256(new TextEncoder().encode(work));
      if (plaintextSha256 !== recorded.plaintextSha256) throw new Error('the work is not UTF-8 text, or is not the delivery the operators record: this file returns text only');
    }
    const seen = new Set<string>();
    const transactions = events.filter((e) => e.tx && !seen.has(e.tx) && seen.add(e.tx)).map((e) => ({ step: e.type as string, tx: e.tx as string, url: pin.chain?.explorer ? `${pin.chain.explorer}/tx/${e.tx}` : null }));
    return {
      outcome: done.outcome, work, plaintextSha256, transactions,
      ...(done.outcome === 'Settled' ? { settlement: { payouts: done.settlement?.payouts ?? [], keyReleased: done.settlement?.keyReleased === true, note, ...(lateHash ? { deliveryHash: lateHash } : {}) } } : {}),
      receipt: { commitmentId: id, outcome: done.outcome, paid: paid.total, funded: paid.receipt, events: events.map((e) => ({ seq: e.seq, type: e.type, hash: e.hash })), finalAt: done.finalAt },
    };
  }

  /**
   * Opens late work a mutual settlement released (T-390): `d` is the seller-signed delivery the seller handed over,
   * which no operator records. Throws, naming the check, unless the seller's signature recovers to the terms' seller,
   * the key every operator released to this key is this key's envelope in `d`, the ciphertext comes from an operator's
   * store and matches `d`'s signed hash, and the plaintext matches `d`'s signed plaintextSha256. The work is untrusted data.
   */
  async #openLate(id: Hex, d: J): Promise<string> {
    const { agent } = await this.#connect();
    const terms = this.#saved.checked!.terms;
    if (lowerHex(d?.commitmentId) !== id) throw new Error(`the delivery you passed is for ${shown(d?.commitmentId ?? null)}, not ${id}`);
    const signer = await recoverTypedDataAddress({ ...typedOf('Delivery', d, agent.domain), signature: d.signature }).catch(() => '');
    if (signer.toLowerCase() !== String(terms.seller).toLowerCase()) throw new Error("the delivery you passed is not signed by the deal's seller");
    const released = (await this.#agreed(agent.sources(), `/v1/commitments/${id}/key?recipient=${this.address}`, (x) => (Array.isArray(x?.items) ? x.items.map((k: J) => k.ciphertext) : []))) as string[];
    const mine = (Array.isArray(d.encryptedKeys) ? d.encryptedKeys : []).filter((k: J) => String(k?.recipient).toLowerCase() === this.address);
    if (mine.length !== 1 || !released.includes(mine[0].ciphertext)) throw new Error('the key the settlement released is not your envelope in the delivery you passed: it is not the delivery that settled');
    const uri = String(d.ciphertext?.uri);
    if (!agent.sources().some((op) => new URL(op).origin === new URL(uri).origin)) throw new Error(`the delivery's ciphertext is at ${shown(uri)}, not on an operator`);
    const res = await fetch(uri, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`the ciphertext at ${shown(uri)} answered ${res.status}`);
    const ct = new Uint8Array(await res.arrayBuffer());
    if ((await sha256(ct)) !== d.ciphertext.sha256) throw new Error("the ciphertext does not match the delivery's signed ciphertext.sha256");
    const key = openEnvelopeKey(mine, this.address, new Uint8Array(Buffer.from(this.#saved.encryptionSecretKey, 'base64url')));
    const aes = await crypto.subtle.importKey('raw', new Uint8Array(key), 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ct.slice(0, 12) }, aes, ct.slice(12)));
    if ((await sha256(plain)) !== d.plaintextSha256) throw new Error("the work does not match the delivery's signed plaintextSha256");
    return new TextDecoder('utf-8', { fatal: true }).decode(plain);
  }

  /**
   * The buyer's deal record (deal-record.ts) for the deal this key serves, read from every configured operator. The
   * signer's x25519 key opens the buyer's released envelope to check the work's hash; the key never reaches the record.
   * `operators`: read these instead of the configured ones.
   */
  async record(operators: string[] = this.#operators): Promise<DealRecord> {
    const id = this.#saved.commitmentId;
    if (!id) throw new Error('this key serves no deal yet: quote or checkOffer binds one');
    return dealRecord(id, { operators, party: 'buyer', encryptionSecretKey: this.#saved.encryptionSecretKey });
  }
}

/**
 * Every key file in `store` with a funded deal and no confirmed outcome in its watch file: what a restarted client
 * watches again. An outcome too few operators reported keeps the deal here.
 */
export async function openDeals(store: string, options: Options = {}): Promise<BuyerSigner[]> {
  const open: BuyerSigner[] = [];
  for (const name of readdirSync(store).filter((f) => /^0x[0-9a-f]{40}\.json$/.test(f)).sort()) {
    const saved = JSON.parse(readFileSync(join(store, name), 'utf8')) as Saved;
    if (saved.commitmentId && saved.paid && !readWatched(store, saved.address, saved.commitmentId).outcome) open.push(new BuyerSigner(store, saved, options));
  }
  return open;
}

/**
 * Fresh keys for one deal: a signing key and an x25519 key, saved as `<store>/<address>.json` with file mode 0600.
 * `store` is a directory on the buyer's machine. The file stays until you delete it. With `paymentAddress` set, that
 * address funds the deal and receives every refund, and this key holds nothing (ADR-0033). Without it, after a refund
 * the price is on this key, so keep the file while the key holds anything.
 */
export async function makeKeys(store: string, options: KeyOptions = {}): Promise<BuyerSigner> {
  const { paymentAddress, ...rest } = options;
  if (paymentAddress !== undefined && !isAddressText(paymentAddress)) throw new Error('paymentAddress must be an address: 0x and 40 hex characters, with a valid checksum if in mixed case');
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address.toLowerCase();
  const paying = paymentAddress?.toLowerCase();
  const saved: Saved = { version: 1, address, privateKey, encryptionSecretKey: Buffer.from(nacl.randomBytes(32)).toString('base64url'), createdAt: new Date().toISOString(), ...(paying && paying !== address ? { paymentAddress: paying } : {}) };
  save(store, saved);
  return new BuyerSigner(store, saved, rest);
}

/** Reopens the keys of one deal after a restart, by its commitment ID or by the buyer address makeKeys returned. */
export async function loadKeys(store: string, commitmentIdOrAddress: string, options: Options = {}): Promise<BuyerSigner> {
  const want = commitmentIdOrAddress.toLowerCase();
  for (const name of readdirSync(store).filter((f) => /^0x[0-9a-f]{40}\.json$/.test(f))) {
    const saved = JSON.parse(readFileSync(join(store, name), 'utf8')) as Saved;
    if (saved.commitmentId === want || saved.address === want) return new BuyerSigner(store, saved, options);
  }
  throw new Error(`no key in ${store} for ${want}`);
}
