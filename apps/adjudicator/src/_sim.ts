// Test harness: a small in-memory settlement on core's `step` behind the AdjudicatorSettlement port, for
// unit tests that need to skip agreement and funding, inject failures (submission, record store) or open
// an appeal directly. Core checks the seeds (ADR-0018) from the beacon fact this harness supplies; the
// harness holds fallback and appeal envelopes until takeover (ADR-0020) and verifies every signature.
// The end-to-end path runs on the real SimChain through simchain-adapter.ts. Test-only; not exported.
import {
  beaconRoundFor,
  type BeaconFact,
  commitmentId,
  holdbackDomain,
  parseJudgment,
  problem,
  signMessage,
  step,
  termsOf,
  verifyMessage,
  err,
  type AdjudicatorAcceptance,
  type AdjudicatorPolicy,
  type AdjudicatorRegistration,
  type Address,
  type Commitment,
  type Decision,
  type Delivery,
  type EncryptedKey,
  type EscrowState,
  type FundingAuthorization,
  type Hex32,
  type Judgment,
  type Problem,
  type Result,
  type Timestamp,
  type Timing,
  type TokenAmount,
} from '@holdback/core';
import { encodePublicKey, encryptionKeyPairFromSecretKey, seal, sha256, wrapKeyForRecipients, type ContentKey, type EncryptionKeyPair } from '@holdback/core/crypto';
import { tusd } from '@holdback/settlement/sim';
import { readFileSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';
import { quicknetValue } from './drand.js';
import type { AdjudicatorSettlement, DecisionTask, OfferTask } from './settlement-port.js';
import { simBeacon, simRoundAt, type RandomnessSource } from './randomness.js';

export const DOMAIN = holdbackDomain(31337);
export const SIM_SEED: Hex32 = `0x${'5e'.repeat(32)}`;
export const T0 = '2026-11-01T09:00:00Z';

export { tusd };

// ---------------------------------------------------------------- a fake drand relay network (T-217)

/** When fixtures/beacon/drand-relays.json was recorded: the relays' clock for its published and future rounds. */
export const RELAYS_AT: Timestamp = '2026-11-04T14:19:09Z';

interface RecordedRound {
  round: number;
  signature: string;
  randomness: string;
}
const fixture = (file: string): unknown => JSON.parse(readFileSync(new URL(`../../../fixtures/beacon/${file}`, import.meta.url), 'utf8'));
const relaysFile = fixture('drand-relays.json') as {
  chainHash: string;
  published: { answers: Record<string, { body: string }> };
  roundZero: { answers: Record<string, { body: string }> };
  serviceRounds: { rounds: RecordedRound[] };
  otherChains: Record<string, { body: string }>;
};
/** Every recorded quicknet round: T-209's seven, the published round, the latest round and the tests' rounds. */
const QUICKNET_ROUNDS = new Map<number, RecordedRound>(
  [
    ...(fixture('drand-quicknet.json') as { rounds: RecordedRound[] }).rounds,
    JSON.parse(relaysFile.published.answers['https://api2.drand.sh']!.body) as RecordedRound,
    JSON.parse(relaysFile.roundZero.answers['https://api2.drand.sh']!.body) as RecordedRound,
    ...relaysFile.serviceRounds.rounds,
  ].map((r) => [r.round, r]),
);
const LATEST = JSON.parse(relaysFile.roundZero.answers['https://api2.drand.sh']!.body) as RecordedRound;
const OTHER_CHAIN = JSON.parse(relaysFile.otherChains['quicknet-t']!.body) as RecordedRound;

/**
 * How one relay answers: as the real relays did for a recorded round ('answer'), or 'not-yet' (425; Cloudflare 404),
 * 'refuse' (500), 'stall' (until the caller aborts), 'throw' (no connection), 'bad-json', or a lie: 'tamper' (a flipped
 * signature bit), 'other-round' (the latest round, as /public/0 answers), 'other-chain' (quicknet-t's round under the
 * asked number), 'wrong-randomness' (the right signature beside a randomness field that is not its hash).
 */
export type RelayMode = 'answer' | 'not-yet' | 'refuse' | 'stall' | 'throw' | 'bad-json' | 'tamper' | 'other-round' | 'other-chain' | 'wrong-randomness';

/**
 * A fake drand relay network on recorded answers (fixtures/beacon/drand-relays.json): `fetch` serves
 * `{relay}/{chain hash}/public/{round}`, an unrecorded round answers "not yet", and `modes` sets each relay's behaviour
 * by origin (default 'answer'; change it between passes). `requests` lists every URL asked.
 */
export function fakeRelays(modes: Partial<Record<string, RelayMode>> = {}) {
  const requests: string[] = [];
  const statusFor = (origin: string): number => (origin === 'https://drand.cloudflare.com' ? 404 : 425);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    requests.push(url.href);
    const mode = modes[url.origin] ?? 'answer';
    const m = /^\/([0-9a-f]{64})\/public\/(\d+)$/.exec(url.pathname);
    const rec = m && m[1] === relaysFile.chainHash ? QUICKNET_ROUNDS.get(Number(m[2])) : undefined;
    if (mode === 'throw') throw new TypeError('fetch failed');
    if (mode === 'stall') {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(signal.reason);
        signal?.addEventListener('abort', () => reject(signal.reason));
      });
    }
    if (mode === 'refuse') return new Response('internal error', { status: 500 });
    if (mode === 'bad-json') return new Response('<html>busy</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    if (mode === 'not-yet' || !rec) return new Response(statusFor(url.origin) === 404 ? '' : 'Requested future beacon\n', { status: statusFor(url.origin) });
    if (mode === 'tamper') return json({ round: rec.round, randomness: rec.randomness, signature: rec.signature.slice(0, 40) + (rec.signature[40] === '0' ? '1' : '0') + rec.signature.slice(41) });
    if (mode === 'other-round') return json(LATEST.round === rec.round ? QUICKNET_ROUNDS.get(1000) : LATEST);
    if (mode === 'other-chain') return json({ round: rec.round, randomness: OTHER_CHAIN.randomness, signature: OTHER_CHAIN.signature });
    if (mode === 'wrong-randomness') return json({ round: rec.round, randomness: 'ff'.repeat(32), signature: rec.signature });
    return json({ round: rec.round, randomness: rec.randomness, signature: rec.signature });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests, modes, statusFor };
}

export interface Party {
  key: `0x${string}`;
  address: Address;
  enc: EncryptionKeyPair;
}
/** Every party's signing key by address, so the harness can sign a delivery as its seller. */
const KEYS = new Map<string, `0x${string}`>();
export function party(n: number): Party {
  const key = `0x${n.toString(16).padStart(2, '0').repeat(32)}` as `0x${string}`;
  const address = privateKeyToAccount(key).address.toLowerCase() as Address;
  KEYS.set(address, key);
  return { key, address, enc: encryptionKeyPairFromSecretKey(new Uint8Array(32).fill(n + 100)) };
}

const EXAMPLE = JSON.parse(readFileSync(new URL('../../../spec/examples/commitment.example.json', import.meta.url), 'utf8')) as Commitment;

export interface CommitmentOver {
  primary: Address;
  fallback: Address;
  appeal: Address;
  policyHash: Hex32;
  registryHash: Hex32;
  buyer: Party;
  seller: Party;
  /** Overrides of the default windows (a sham deal's, T-211). */
  timing?: Partial<Timing>;
  fee?: TokenAmount;
  /** Replaces the example's acceptance (a deal with a reference check, T-327). */
  acceptance?: Commitment['acceptance'];
}
export function makeCommitment(o: CommitmentOver): Commitment {
  const rest: Omit<Commitment, 'id' | 'signatures' | 'adjudicatorAcceptance'> & Partial<Commitment> = { ...EXAMPLE };
  delete rest.id;
  delete rest.signatures;
  delete rest.adjudicatorAcceptance;
  const terms = {
    ...rest,
    buyer: o.buyer.address,
    seller: o.seller.address,
    adjudication: { ...rest.adjudication, adjudicator: o.primary, fallbackAdjudicator: o.fallback, appealAdjudicator: o.appeal, policyHash: o.policyHash, registryHash: o.registryHash, ...(o.fee ? { fee: o.fee } : {}) },
    timing: {
      offerExpiresAt: '2026-11-01T09:30:00Z',
      fundBy: '2026-11-01T09:45:00Z',
      deliverBy: '2026-11-01T10:00:00Z',
      judgeBy: '2026-11-01T10:02:00Z',
      fallbackBy: '2026-11-01T10:04:00Z',
      appealWindowSec: 300,
      appealDecideSec: 300,
      maxSubmissions: 1 as const,
      ...o.timing,
    },
    buyerEncryptionPublicKey: encodePublicKey(o.buyer.enc.publicKey),
    createdAt: T0,
    ...(o.acceptance ? { acceptance: o.acceptance } : {}),
  };
  const id = commitmentId(termsOf({ ...terms, id: `0x${'00'.repeat(32)}`, signatures: { seller: '0x' } } as Commitment));
  return { ...terms, id, signatures: { seller: `0x${'aa'.repeat(65)}` } } as Commitment;
}

/** Roughly the demo's cleaned customer CSV: 9,500 rows, about 0.5 MB, passes the example's checks. */
export const demoCsv = (rows = 9500): string =>
  ['customer_id,name,email,signup_date,email_valid', ...Array.from({ length: rows }, (_, k) => `${100000 + k},Customer ${k} Example,customer${k}@example.com,2024-0${1 + (k % 9)}-1${k % 10},true`)].join('\n');

interface Case {
  commitment: Commitment;
  state: EscrowState;
  delivery?: Delivery;
  ciphertextUri?: string;
  held: Map<string, EncryptedKey>;
  appealOpen?: { at: Timestamp; firstOutcome: 'accept' | 'reject'; ground?: DecisionTask['appealGround'] };
}

export class TestSettlement implements AdjudicatorSettlement {
  clock = Date.parse(T0);
  readonly cases = new Map<Hex32, Case>();
  readonly blobs = new Map<string, Uint8Array>();
  readonly records = new Map<string, Judgment>();
  readonly registrations = new Map<string, AdjudicatorRegistration>();
  /** Every policy a registration ever carried, by hash, as an operator's store keeps them (T-221 review). */
  readonly policies = new Map<string, AdjudicatorPolicy>();
  readonly submitted: Array<AdjudicatorAcceptance | Decision> = [];
  /** Refuse the next N decision submissions (a transient failure). */
  failNextDecisions = 0;
  /** Throw on the next N record publications (a transient store failure). */
  failNextPublishes = 0;
  /** Throw on the next N appeal expiries (an unreachable settlement layer). */
  failNextExpiries = 0;
  /** Free bond per adjudicator (lowercase address), as the contract's `freeOf` reads it. Unset: ample. */
  readonly bonds = new Map<string, bigint>();
  readonly sim: RandomnessSource = simBeacon(SIM_SEED, () => this.now());
  /** The drand-quicknet source the port hands out for a commitment whose rulebook names it (T-217); null: none. */
  drand: RandomnessSource | null = null;

  /** Stores bytes as `POST /v1/ciphertext` does, under their SHA-256 (a reference file, T-327). */
  store(bytes: Uint8Array): { uri: string; sha256: `sha256:${string}` } {
    const id = sha256(bytes);
    const uri = `mem://ciphertext/${id}`;
    this.blobs.set(uri, bytes);
    return { uri, sha256: id };
  }

  now = (): Timestamp => new Date(this.clock).toISOString();
  at(ts: Timestamp) {
    this.clock = Date.parse(ts);
  }

  /** `beaconSource`: the randomness source of the commitment's club rulebook, which core keeps from the offer. */
  offer(c: Commitment, beaconSource: EscrowState['beaconSource'] = 'sim') {
    this.cases.set(c.id, { commitment: c, state: { kind: 'Offered', id: c.id, terms: termsOf(c), beaconSource, sellerSignature: c.signatures.seller }, held: new Map() });
  }

  randomness(c: Commitment): RandomnessSource | null {
    const source = this.cases.get(c.id)?.state.beaconSource;
    return source === 'sim' ? this.sim : source === 'drand-quicknet' ? this.drand : null;
  }
  private get(id: Hex32) {
    const c = this.cases.get(id);
    if (!c) throw new Error(`no case ${id}`);
    return c;
  }
  private apply(c: Case, e: Parameters<typeof step>[1]): Result<unknown, Problem> {
    const r = step(c.state, e);
    if (r.ok) c.state = r.value;
    return r;
  }

  /** Agreement and funding are not under test: jump to Held after the acceptance. */
  fund(id: Hex32) {
    const c = this.get(id);
    if (c.state.kind !== 'AcceptedByAdjudicator') throw new Error(`fund in ${c.state.kind}`);
    const amount = tusd(BigInt(c.state.terms.price.amount) + BigInt(c.state.terms.adjudication.fee.amount));
    c.state = { kind: 'Held', id, terms: c.state.terms, beaconSource: c.state.beaconSource, acceptance: c.state.acceptance, hold: { amount, funding: {} as FundingAuthorization, heldAt: this.now() } };
  }

  /**
   * The seller seals the work to the three adjudicators and the buyer, and signs the delivery after `mutate`, as the
   * seller of the commitment. `signer` signs it instead (another key: a delivery the seller never signed).
   */
  async deliver(id: Hex32, plaintext: string, recipients: Array<{ recipient: Address; publicKey: Uint8Array }>, mutate?: (d: Delivery) => Delivery, signer?: `0x${string}`): Promise<ContentKey> {
    const c = this.get(id);
    const bytes = new TextEncoder().encode(plaintext);
    const sealed = await seal(bytes);
    const uri = `mem://ciphertext/${sealed.ciphertextSha256}`;
    this.blobs.set(uri, sealed.ciphertext);
    let delivery: Delivery = {
      commitmentId: id,
      attempt: 1,
      ciphertext: { uri, sha256: sealed.ciphertextSha256, bytes: sealed.ciphertext.length, cipher: 'aes-256-gcm' },
      plaintextSha256: sealed.plaintextSha256,
      plaintextMime: 'text/csv',
      encryptedKeys: wrapKeyForRecipients(sealed.key, recipients),
      submittedAt: this.now(),
      signature: `0x${'bb'.repeat(65)}`,
    };
    if (mutate) delivery = mutate(delivery);
    const key = signer ?? KEYS.get(c.commitment.seller.toLowerCase());
    if (key) {
      const { signature: _s, ...unsigned } = delivery; // eslint-disable-line @typescript-eslint/no-unused-vars
      delivery = { ...unsigned, signature: await signMessage(key, DOMAIN, { ...unsigned, type: 'Delivery' }) };
    }
    const r = this.apply(c, { type: 'deliver', at: this.now(), delivery });
    if (!r.ok) throw new Error(r.error.detail);
    c.delivery = delivery;
    const { fallbackAdjudicator, appealAdjudicator } = c.commitment.adjudication;
    for (const who of [fallbackAdjudicator, appealAdjudicator]) {
      const env = delivery.encryptedKeys.find((k) => k.recipient.toLowerCase() === who.toLowerCase());
      if (env) c.held.set(who.toLowerCase(), env);
    }
    return sealed.key;
  }

  /**
   * The seller-signed delivery as posted, which a task carries so the adjudicator can check the signature and name
   * its hash (ADR-0029). The fallback and appeal adjudicators still open only the envelope released to them.
   */
  private signedDelivery(c: Case): Delivery {
    return c.delivery!;
  }

  fileAppeal(id: Hex32, ground?: DecisionTask['appealGround']) {
    const c = this.get(id);
    if ((c.state.kind !== 'Released' && c.state.kind !== 'Refunded') || c.state.via.kind !== 'first_instance') throw new Error('nothing to appeal');
    c.appealOpen = { at: this.now(), firstOutcome: c.state.kind === 'Released' ? 'accept' : 'reject', ...(ground ? { ground } : {}) };
    c.state = { ...c.state, via: { ...c.state.via, appeal: { kind: 'open', appeal: {} as never, appealDecideBy: new Date(this.clock + 600_000).toISOString(), openedAt: this.now() } } };
  }

  async offers(adj: Hex32): Promise<OfferTask[]> {
    return [...this.cases.values()]
      .filter((c) => c.state.kind === 'Offered' && c.commitment.adjudication.adjudicator.toLowerCase() === adj.toLowerCase())
      .map((c) => ({ commitment: c.commitment, unencumberedBond: tusd('100000000000') }));
  }

  async tasks(adj: Hex32): Promise<DecisionTask[]> {
    const out: DecisionTask[] = [];
    const me = adj.toLowerCase();
    for (const c of this.cases.values()) {
      const { adjudicator, fallbackAdjudicator, appealAdjudicator } = c.commitment.adjudication;
      const s = c.state;
      const base = { commitment: c.commitment, attempt: 1 };
      if (s.kind === 'Delivered' && adjudicator.toLowerCase() === me) out.push({ ...base, role: 'primary', delivery: s.delivery, deadline: s.terms.timing.judgeBy });
      if (s.kind === 'FallbackJudging' && fallbackAdjudicator.toLowerCase() === me) {
        const env = c.held.get(me);
        out.push({ ...base, role: 'fallback', delivery: this.signedDelivery(c), ...(env ? { releasedKey: env } : {}), roundFixedAt: s.terms.timing.judgeBy, deadline: s.terms.timing.fallbackBy });
      }
      if (s.kind === 'Escalated' && appealAdjudicator.toLowerCase() === me) {
        const decision = [...this.submitted].reverse().find((m): m is Decision => m.type === 'Decision' && m.commitmentId === c.commitment.id && m.outcome === 'escalate');
        const env = decision?.encryptedKeys?.find((k) => k.recipient.toLowerCase() === me);
        out.push({ ...base, role: 'appeal', delivery: this.signedDelivery(c), ...(env ? { releasedKey: env } : {}), roundFixedAt: s.escalation.at, ...(decision ? { firstDecider: decision.adjudicator } : {}), deadline: s.escalation.appealDecideBy });
      }
      if (c.appealOpen && (s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance' && s.via.appeal.kind === 'open' && appealAdjudicator.toLowerCase() === me) {
        const env = c.held.get(me);
        out.push({
          ...base,
          role: 'appeal',
          delivery: this.signedDelivery(c),
          ...(env ? { releasedKey: env } : {}),
          roundFixedAt: c.appealOpen.at,
          firstOutcome: c.appealOpen.firstOutcome,
          firstDecider: s.via.decision.adjudicator,
          ...(c.appealOpen.ground ? { appealGround: c.appealOpen.ground } : {}),
          deadline: s.via.appeal.appealDecideBy,
        });
      }
    }
    return out;
  }

  async takeoversDue(adj: Hex32): Promise<Commitment[]> {
    return [...this.cases.values()]
      .filter((c) => c.state.kind === 'Delivered' && c.commitment.adjudication.fallbackAdjudicator.toLowerCase() === adj.toLowerCase() && this.clock >= Date.parse(c.commitment.timing.judgeBy) && this.clock < Date.parse(c.commitment.timing.fallbackBy))
      .map((c) => c.commitment);
  }

  async triggerFallback(id: Hex32) {
    return this.apply(this.get(id), { type: 'trigger_fallback', at: this.now() });
  }

  /** Like the contract, the harness reserves nothing for a fallback or appeal adjudicator before it decides. */
  async bondCover(adj: Hex32) {
    return this.bonds.get(adj.toLowerCase()) ?? 100_000_000_000n;
  }

  async appealExpiriesDue(adj: Hex32): Promise<Hex32[]> {
    return [...this.cases.values()]
      .filter(({ state: s }) => {
        if ((s.kind !== 'Released' && s.kind !== 'Refunded') || s.via.kind !== 'first_instance' || s.via.decision.adjudicator.toLowerCase() !== adj.toLowerCase()) return false;
        const a = s.via.appeal;
        return (a.kind === 'none' && this.clock >= Date.parse(a.appealBy)) || (a.kind === 'open' && this.clock >= Date.parse(a.appealDecideBy));
      })
      .map((c) => c.commitment.id);
  }

  async expireAppeal(id: Hex32) {
    if (this.failNextExpiries > 0) {
      this.failNextExpiries--;
      throw new Error('settlement unreachable');
    }
    const c = this.get(id);
    const r = this.apply(c, { type: 'expire_appeal', at: this.now() });
    if (r.ok) delete c.appealOpen;
    return r;
  }

  async ciphertext(uri: string) {
    const b = this.blobs.get(uri);
    if (!b) throw new Error(`no blob ${uri}`);
    return b;
  }

  async publishRecord(record: Judgment) {
    if (this.failNextPublishes > 0) {
      this.failNextPublishes--;
      throw new Error('record store unavailable');
    }
    const parsed = parseJudgment(record);
    if (!parsed.ok) throw new Error(`record does not parse: ${parsed.error.detail}`);
    const uri = `mem://records/${record.recordHash}`;
    this.records.set(uri, record);
    return uri;
  }

  async registration(address: Hex32) {
    return this.registrations.get(address.toLowerCase()) ?? null;
  }

  /** Stores a registration as the one for its address, and keeps its policy by hash for good. */
  register(r: AdjudicatorRegistration): void {
    this.registrations.set(r.address.toLowerCase(), r);
    this.policies.set(r.policyHash, r.policy);
  }

  async policy(hash: Hex32): Promise<AdjudicatorPolicy | null> {
    return this.policies.get(hash) ?? null;
  }

  /**
   * The beacon fact core's step checks for fallback and appeal decisions (ADR-0018): the sim beacon's value, as SimChain
   * supplies it; for drand-quicknet, the value of the decision's own proof when it proves the fixed round, as the rules
   * contract's DrandQuicknetBeacon does (T-209).
   */
  private async beaconFact(c: Case, m: Decision): Promise<BeaconFact | null | undefined> {
    if (m.role === 'primary') return undefined;
    const round = beaconRoundFor(c.state, m.role);
    if (round === null) return null;
    if (c.state.beaconSource === 'drand-quicknet') {
      const value = m.beacon?.signature && m.beacon.round === round ? await quicknetValue(round, m.beacon.signature) : null;
      return value ? { round, value } : null;
    }
    const got = await this.sim.value(round);
    return got ? { round, value: got.value } : null;
  }

  async submit(m: AdjudicatorAcceptance | Decision): Promise<Result<unknown, Problem>> {
    if (!(await verifyMessage(DOMAIN, m, m.adjudicator))) return err(problem('invalid_signature', 'bad signature'));
    const c = this.get(m.commitmentId);
    if (m.type === 'AdjudicatorAcceptance') {
      const r = this.apply(c, { type: 'adjudicator_accept', at: this.now(), message: m, unencumberedBond: tusd('100000000000') });
      if (r.ok) this.submitted.push(m);
      return r;
    }
    if (this.failNextDecisions > 0) {
      this.failNextDecisions--;
      return err(problem('adjudicator_unavailable', 'transient failure'));
    }
    const beacon = await this.beaconFact(c, m);
    const r = this.apply(c, { type: 'decide', at: this.now(), message: m, ...(beacon !== undefined ? { beacon } : {}) });
    if (r.ok) {
      this.submitted.push(m);
      if (m.role === 'appeal') delete c.appealOpen;
    }
    return r;
  }

  decisions(id: Hex32): Decision[] {
    return this.submitted.filter((m): m is Decision => m.type === 'Decision' && m.commitmentId === id);
  }
  state(id: Hex32) {
    return this.get(id).state;
  }
}

export { simRoundAt };
