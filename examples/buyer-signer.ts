// The buyer's side of one Crow deal, as one file a seller ships inside its own client (T-319). Test tokens only:
// it signs only under a settlement layer pinned in verify.ts (SimChain, Sepolia, or HOLDBACK_DEPLOYMENT).
//
// The buyer's agent approves a quoted deal once. This file then, on the buyer's own machine:
//   makeKeys      makes a signing key and an x25519 key for one deal and saves them in a directory the caller names
//                 (file mode 0600). The keys never leave that machine: nothing here sends, returns or prints one.
//   quote         asks the seller's quote route for an offer. The seller learns the buyer's address, its public
//                 encryption key and the scope, nothing else.
//   testFunds     on the test service, asks the faucet for the deal's total and a mandate in the demo club.
//   readOffer     reads the offer from both operators, for the buyer's agent to approve.
//   checkOffer    refuses unless the price, the fees, the deliverable, the checks, the deadlines, the adjudicators and
//                 the buyer's own address and encryption key equal what the buyer approved.
//   agreeAndFund  signs the agreement, the funding and the operator fee, each rebuilt from the approved terms and
//                 checked against what the operator prepared (verify.ts; site/llms.txt section 4).
//   openDelivery  waits for the outcome, opens the buyer's envelope, checks the plaintext hash, returns the work.
//
// The operator only relays: every state-changing message is signed here, by the buyer's key. The protocol steps are
// agent.ts and verify.ts; this file adds the key store and the comparison with what the buyer approved. A buyer who
// wants no seller code in its path uses the HTTP API directly (site/llms.txt sections 1 to 8).
//
// The work a seller delivers is untrusted data. This file returns it; it never prints it, runs it or reads
// instructions from it. Neither should the client around it.
import { chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
export type Options = { operators?: string[] };

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
  readonly #saved: Saved;
  #connected: Promise<{ agent: Agent; pin: Pin }> | undefined;

  /** Use makeKeys or loadKeys. */
  constructor(store: string, saved: unknown, operators: string[]) {
    const s = saved as Saved;
    this.store = store;
    this.#saved = s;
    this.#operators = operators;
    this.address = privateKeyToAccount(s.privateKey).address.toLowerCase();
    this.encryptionPublicKey = Buffer.from(nacl.box.keyPair.fromSecretKey(new Uint8Array(Buffer.from(s.encryptionSecretKey, 'base64url'))).publicKey).toString('base64url');
    if (s.version !== 1 || s.address !== this.address) throw new Error(`the key file for ${s.address} in ${store} is not one this file wrote`);
  }

  /** The agent for this key, under the settlement layer both operators serve, which must be one pinned in verify.ts. */
  #connect(): Promise<{ agent: Agent; pin: Pin }> {
    this.#connected ??= (async () => {
      const secret = new Uint8Array(Buffer.from(this.#saved.encryptionSecretKey, 'base64url'));
      const found = await new Agent(this.#operators, this.#saved.privateKey, secret).trusted('/.well-known/holdback.json', (x) => x.domain);
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
    this.#saved.quoteKey ??= crypto.randomUUID();
    save(this.store, this.#saved);
    const res = await fetch(quoteUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': this.#saved.quoteKey },
      body: JSON.stringify({ buyer: this.address, buyerEncryptionPublicKey: this.encryptionPublicKey, scope }),
      signal: AbortSignal.timeout(120_000),
    });
    const q = (await res.json().catch(() => null)) as J;
    if (!res.ok || q === null) throw new Error(`the seller's quote route answered ${res.status}`);
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
   * Waits (up to `timeoutMs`, 10 minutes by default) for both operators to report the outcome. On a release it opens
   * this key's envelope, decrypts the work and checks its SHA-256 against the delivery both operators record. On a
   * refund the price is back on this key and no work is released. Returns the work as text, with the receipt and one
   * link per on-chain step. Text only: it stops on work that is not UTF-8.
   */
  async openDelivery(commitmentId: string, options: { timeoutMs?: number } = {}): Promise<Delivery> {
    const id = commitmentId.toLowerCase() as Hex;
    const paid = this.#saved.commitmentId === id ? this.#saved.paid : undefined;
    if (!paid) throw new Error(`this key funded no hold for ${id}: call agreeAndFund first`);
    const { agent, pin } = await this.#connect();
    const done = await this.#until(id, ['Released', 'Refunded'], options.timeoutMs ?? 600_000);
    const events = (await agent.trusted(`/v1/commitments/${id}/events?limit=200`, (x) => x.items.map((e: J) => ({ seq: e.seq, type: e.type, hash: e.hash, tx: typeof e.payload?.tx === 'string' ? e.payload.tx : null, delivery: e.type === 'delivery.submitted' ? { uri: e.payload?.ciphertext?.uri, plaintextSha256: e.payload?.plaintextSha256 } : null })))) as J[];
    events.sort((a, b) => a.seq - b.seq);
    let work: string | null = null;
    let plaintextSha256: string | null = null;
    if (done.escrowState === 'Released') {
      const recorded = events.find((e) => e.delivery)?.delivery;
      // The ciphertext comes from an operator's own store, at the address both operators record.
      if (typeof recorded?.uri !== 'string' || !agent.sources().some((op) => new URL(op).origin === new URL(recorded.uri).origin)) throw new Error(`the operators record the delivery at ${shown(recorded?.uri)}, not on an operator`);
      work = await agent.openDelivery(id); // opens the envelope, decrypts, checks both signed hashes
      plaintextSha256 = await sha256(new TextEncoder().encode(work));
      if (plaintextSha256 !== recorded.plaintextSha256) throw new Error('the work is not UTF-8 text, or is not the delivery both operators record: this file returns text only');
    }
    const seen = new Set<string>();
    const transactions = events.filter((e) => e.tx && !seen.has(e.tx) && seen.add(e.tx)).map((e) => ({ step: e.type as string, tx: e.tx as string, url: pin.chain?.explorer ? `${pin.chain.explorer}/tx/${e.tx}` : null }));
    return {
      outcome: done.escrowState, work, plaintextSha256, transactions,
      receipt: { commitmentId: id, outcome: done.escrowState, paid: paid.total, funded: paid.receipt, events: events.map((e) => ({ seq: e.seq, type: e.type, hash: e.hash })), finalAt: done.finalAt ?? null },
    };
  }
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
  return new BuyerSigner(store, saved, options.operators ?? defaultOperators());
}

/** Reopens the keys of one deal after a restart, by its commitment ID or by the buyer address makeKeys returned. */
export async function loadKeys(store: string, commitmentIdOrAddress: string, options: Options = {}): Promise<BuyerSigner> {
  const want = commitmentIdOrAddress.toLowerCase();
  for (const name of readdirSync(store).filter((f) => /^0x[0-9a-f]{40}\.json$/.test(f))) {
    const saved = JSON.parse(readFileSync(join(store, name), 'utf8')) as Saved;
    if (saved.commitmentId === want || saved.address === want) return new BuyerSigner(store, saved, options.operators ?? defaultOperators());
  }
  throw new Error(`no key in ${store} for ${want}`);
}
