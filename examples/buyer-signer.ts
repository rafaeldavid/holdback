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
//   readOffer     reads the offer from both operators, for the buyer's agent to approve.
//   checkOffer    refuses unless the price, the fees, the deliverable, the checks, the deadlines, the adjudicators and
//                 the buyer's own address and encryption key equal what the buyer approved.
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
import { commitmentIdOf, jcs, knownPins, operatorFeeOf, Refusal, typedOf, type Pin } from './verify.ts';

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
  adjudicators: { primary: string; fallback: string; appeal: string };
};
/**
 * What the buyer approved. `seller`, `rubric`, `fees.total` and `commitmentId` are optional: without `rubric` the
 * offer must have none, and without `seller` any seller whose signature recovers passes.
 */
export type Approved = Pick<Offer, 'price' | 'deliverable' | 'checks' | 'deadlines' | 'adjudicators'> & {
  fees: { adjudication: Money; operator: Money; total?: Money };
  seller?: string;
  rubric?: J;
  commitmentId?: Hex;
};
/** What agreeAndFund took from the buyer: the hold (price plus adjudication fee) and the operator fee. */
export type Paid = { total: Money; hold: Money; operatorFee: Money; receipt: J | null };
export type Delivery = {
  outcome: 'Released' | 'Refunded';
  /** The work as text when the deal released; null on a refund, where no key is released. Untrusted data. */
  work: string | null;
  plaintextSha256: string | null;
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
};
/**
 * What watch tells the buyer's agent.
 * - `deliverBy-passed`: the delivery deadline in the agreed terms passed, on the slowest clock of the operators that
 *   answer, with the deal still Held. The signer sends the reclaim.
 * - `released`, `refunded`: the quorum of operators (`confirmations`) reports the outcome. `reclaimed`: settlement
 *   refunded the hold (price and adjudication fee) on the reclaim; without it the adjudicator decided the refund.
 *   `finalAt` is when no appeal can follow.
 * - `unconfirmed`: some operators report `state`, but fewer than the quorum agree. The deal stays open, the signer
 *   keeps reading, and the reclaim stays armed. `agreeing` of the `answered` operators report it; `required` must.
 */
export type Report =
  | { kind: 'deliverBy-passed'; commitmentId: Hex; deliverBy: string; settlementTime: string }
  | { kind: 'released'; commitmentId: Hex; finalAt: string | null }
  | { kind: 'refunded'; commitmentId: Hex; reclaimed: boolean; finalAt: string | null }
  | { kind: 'unconfirmed'; commitmentId: Hex; state: 'Released' | 'Refunded'; agreeing: number; answered: number; required: number };
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
export type Outcome = { commitmentId: Hex; outcome: 'Released' | 'Refunded'; reclaimed: boolean; finalAt: string | null };

type Saved = {
  version: 1;
  address: string;
  privateKey: Hex;
  encryptionSecretKey: string;
  createdAt: string;
  /** The Idempotency-Key of the quote request, so a retry after a crash replays the seller's answer. */
  quoteKey?: string;
  commitmentId?: Hex;
  quote?: Quote;
  /** The terms checkOffer passed, and the offer the buyer approved. */
  checked?: { terms: J; offer: Offer };
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
/** A value from the offer in an error message: canonical JSON, at most 200 characters. */
const shown = (v: J) => jcs(lowerHex(v)).slice(0, 200);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = async (b: Uint8Array) => `sha256:${Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(b))).toString('hex')}`;
const defaultOperators = () => (process.env['HOLDBACK_OPERATORS'] || 'https://api.crow.direct,https://api2.crow.direct').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);

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
  readonly #saved: Saved;
  #connected: Promise<{ agent: Agent; pin: Pin }> | undefined;

  /** Use makeKeys, loadKeys or openDeals. */
  constructor(store: string, saved: unknown, options: Options = {}) {
    const s = saved as Saved;
    this.store = store;
    this.#saved = s;
    this.#operators = options.operators ?? defaultOperators();
    this.#quoteCredentialEnv = options.quoteCredentialEnv;
    this.address = privateKeyToAccount(s.privateKey).address.toLowerCase();
    this.encryptionPublicKey = Buffer.from(nacl.box.keyPair.fromSecretKey(new Uint8Array(Buffer.from(s.encryptionSecretKey, 'base64url'))).publicKey).toString('base64url');
    if (s.version !== 1 || s.address !== this.address) throw new Error(`the key file for ${s.address} in ${store} is not one this file wrote`);
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
   * scope}`, answered by `{commitmentId, price, fees, expiresAt}`. The answer is the seller's claim; readOffer and
   * checkOffer read the offer itself from the operators.
   */
  async quote(quoteUrl: string, scope: unknown): Promise<Quote> {
    if (this.#saved.commitmentId) throw new Error(`this key already serves ${this.#saved.commitmentId}: one key, one deal. Call makeKeys for another deal`);
    const name = this.#quoteCredentialEnv;
    const credential = name === undefined ? undefined : process.env[name];
    // The variable's name in the error, never its value.
    if (name !== undefined && !credential) throw new Error(`quoteCredentialEnv names ${name}, which is not set: set it to the seller's quote credential`);
    this.#saved.quoteKey ??= crypto.randomUUID();
    save(this.store, this.#saved);
    const res = await fetch(quoteUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': this.#saved.quoteKey, ...(credential ? { authorization: `Bearer ${credential}` } : {}) },
      body: JSON.stringify({ buyer: this.address, buyerEncryptionPublicKey: this.encryptionPublicKey, scope }),
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
   * Test service only: asks the faucet for `amount` base units of the test token (the deal's total) and a mandate
   * in the demo club, which a fresh key needs before it can agree. The faucet serves an address once an hour.
   */
  async testFunds(amount: string): Promise<Money> {
    if (!DEC.test(amount) || amount === '0') throw new Error('amount is base units as a decimal string, above 0');
    const { agent } = await this.#connect();
    const grant = await agent.call('POST', '/v1/faucet', { address: this.address, amount });
    return { token: grant.granted.token, amount: grant.granted.amount };
  }

  /** The terms of `id` as both operators serve them, with the ID recomputed and the seller's signature recovered. */
  async #served(id: Hex): Promise<{ terms: J; offer: Offer }> {
    const { agent } = await this.#connect();
    const { id: servedId, signatures, ...terms } = await agent.trusted(`/v1/commitments/${id}/terms`);
    if (commitmentIdOf(terms) !== id || String(servedId).toLowerCase() !== id) refuse(`the commitment ID does not match the terms the operators serve (recomputed ${commitmentIdOf(terms)})`);
    const signer = await recoverTypedDataAddress({ ...typedOf('CommitmentTerms', terms, agent.domain), signature: signatures?.seller }).catch(() => '');
    if (signer.toLowerCase() !== String(terms.seller).toLowerCase()) refuse("the seller's signature does not recover to the seller in the terms");
    const price: Money = terms.price, adjudication: Money = terms.adjudication.fee;
    if (!isMoney(price) || !isMoney(adjudication) || adjudication.token !== price.token) refuse('the price and the adjudication fee are not amounts of one token');
    // The operator fee: computed here from the schedule both operators publish, never read from the seller.
    const schedule = await agent.operatorFeeSchedule();
    const operator = schedule ? operatorFeeOf(price, schedule) : 0n;
    const a = terms.adjudication;
    const offer: Offer = {
      commitmentId: id, seller: String(terms.seller).toLowerCase(), price,
      fees: { adjudication, operator: { token: price.token, amount: operator.toString() }, total: { token: price.token, amount: (BigInt(price.amount) + BigInt(adjudication.amount) + operator).toString() } },
      deliverable: terms.deliverable, checks: terms.acceptance.deterministicChecks, rubric: terms.acceptance.rubric, deadlines: terms.timing,
      adjudicators: { primary: a.adjudicator, fallback: a.fallbackAdjudicator, appeal: a.appealAdjudicator },
    };
    return { terms, offer };
  }

  /** The offer as both operators serve it, for the buyer's agent to approve. Signs nothing. */
  async readOffer(commitmentId: string): Promise<Offer> {
    return (await this.#served(commitmentId.toLowerCase() as Hex)).offer;
  }

  /**
   * Reads the offer from both operators and refuses (throws Refusal, naming the field) unless it equals what the buyer
   * approved: the price, each fee, the deliverable, the checks, the rubric, the deadlines, the adjudicators, and this
   * key's own address and encryption key as the buyer. Waits up to `timeoutMs` for the primary adjudicator to take
   * the deal. Once it passes, agreeAndFund signs exactly these terms.
   */
  async checkOffer(commitmentId: string, approved: Approved, options: { timeoutMs?: number } = {}): Promise<Offer> {
    const id = commitmentId.toLowerCase() as Hex;
    if (!ID.test(id)) throw new Error('commitmentId is 0x and 64 hex characters');
    this.#bind(id);
    const { terms, offer } = await this.#served(id);
    const want: Array<[string, J, J]> = [
      ['buyer', terms.buyer, this.address],
      ['buyerEncryptionPublicKey', terms.buyerEncryptionPublicKey, this.encryptionPublicKey],
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
    ];
    for (const [field, got, expected] of want) if (!same(got, expected)) refuse(`${field} is ${shown(got)}, not the approved ${shown(expected)}`);
    await this.#until(id, ['AcceptedByAdjudicator'], options.timeoutMs ?? 60_000);
    this.#saved.checked = { terms, offer };
    save(this.store, this.#saved);
    return offer;
  }

  /**
   * Signs the agreement, the funding authorisation and the operator fee authorisation for the terms checkOffer
   * passed, and returns what the buyer paid. Each prepared message is rebuilt from those terms and compared before it
   * is signed, and the three together cannot take more than the approved total (verify.ts).
   */
  async agreeAndFund(commitmentId: string): Promise<Paid> {
    const id = commitmentId.toLowerCase() as Hex;
    const checked = this.#saved.commitmentId === id ? this.#saved.checked : undefined;
    if (!checked) return refuse(`checkOffer has not passed for ${id} with this key`);
    if (this.#saved.paid) return this.#saved.paid;
    const { agent } = await this.#connect();
    const { price, fees } = checked.offer;
    const hold = BigInt(price.amount) + BigInt(fees.adjudication.amount);
    const paid: Paid = { total: fees.total, hold: { token: price.token, amount: hold.toString() }, operatorFee: fees.operator, receipt: null };
    const state = (await agent.trusted(`/v1/commitments/${id}`, (x) => x.escrowState)) as string;
    if (state === 'AcceptedByAdjudicator') {
      const schedule = await agent.operatorFeeSchedule();
      const fee = schedule ? operatorFeeOf(price, schedule) : 0n;
      if (fee.toString() !== fees.operator.amount) refuse(`the operator fee is now ${fee} base units, not the approved ${fees.operator.amount}`);
      const held = await agent.agreeAndFund(checked.terms, BigInt(fees.total.amount));
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
      await report(o.outcome === 'Released' ? { kind: 'released', commitmentId: id, finalAt: o.finalAt } : { kind: 'refunded', commitmentId: id, reclaimed: o.reclaimed, finalAt: o.finalAt });
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
      for (const state of ['Released', 'Refunded'] as const) {
        const agreeing = views.filter((v) => stateOf(v) === state);
        if (agreeing.length === 0) continue;
        if (agreeing.length >= required && agreeing.length === views.length) {
          const events = await this.#answers(agreeing.map((v) => v.api), `/v1/commitments/${id}/events?limit=200`);
          const reclaimed = events.length > 0 && events.every((a) => Array.isArray(a.body?.items) && a.body.items.some((e: J) => e.type === 'settlement.reclaimed'));
          w.outcome = { commitmentId: id, outcome: state, reclaimed, finalAt: agreeing[0]!.body.finalAt ?? null };
          keep();
          return final(w.outcome);
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
   * operators record. On a refund no work is released, and the hold or the price is back on this key. Returns the
   * work as text, with the receipt and one link per on-chain step. Text only: it stops on work that is not UTF-8.
   * Like watch, it goes on with one operator offline.
   */
  async openDelivery(commitmentId: string, options: WatchOptions = {}): Promise<Delivery> {
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
    if (done.outcome === 'Released') {
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
      receipt: { commitmentId: id, outcome: done.outcome, paid: paid.total, funded: paid.receipt, events: events.map((e) => ({ seq: e.seq, type: e.type, hash: e.hash })), finalAt: done.finalAt },
    };
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
 * `store` is a directory on the buyer's machine. The file stays until you delete it: after a refund the price is on
 * this key, so keep the file while the key holds anything.
 */
export async function makeKeys(store: string, options: Options = {}): Promise<BuyerSigner> {
  const privateKey = generatePrivateKey();
  const saved: Saved = { version: 1, address: privateKeyToAccount(privateKey).address.toLowerCase(), privateKey, encryptionSecretKey: Buffer.from(nacl.randomBytes(32)).toString('base64url'), createdAt: new Date().toISOString() };
  save(store, saved);
  return new BuyerSigner(store, saved, options);
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
