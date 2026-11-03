// EvmSettlement: the Settlement interface over the Holdback contracts (HoldbackRules, HoldbackBonds, CPP) on a local
// anvil chain. Agents see amounts, states and receipts, never chain mechanics.
//
// What is on chain and what is not (T-202 Decisions, rule 1):
// - The contract has no Offered, AcceptedByAdjudicator or Agreed stage. Offer, adjudicator acceptance and Agree are
//   signatures the contract checks together at `agreeAndFund`. This adapter collects them, and runs the same
//   pre-funding checks SimChain runs (core `offer` and `step`, mandate scope, membership, daily spend, nonces), as
//   the relaying client would; their events carry `source: 'adapter'`.
// - From funding on, every submission is one contract call. The contract is the authority: a revert is the
//   refusal (mapped to SimChain's problem types by errors.ts), and a mined call is the state change.
// - A core-state mirror is stepped after each mined call so reads keep SimChain's shape (deadlines, finality); after
//   every call the mirror's state must equal the on-chain stage, or the adapter throws a divergence error.
import {
  canonicalKeccak,
  commitmentId as commitmentIdOf,
  holdbackDomain,
  mulBps,
  offer,
  problem,
  step,
  termsOf,
  toTimestamp,
  verifyMessage,
  verifyMutualSettlement,
  verifyTerms,
  type AdjudicatorAcceptance,
  type Agree,
  type Address,
  type AnyCommitmentTerms,
  type Club,
  type CommitmentStateView,
  type Delivery,
  type EncryptedKey,
  type EscrowEvent,
  type EscrowState,
  type EscrowStateKind,
  type Hex32,
  type Mandate,
  type Problem,
  type Scope,
  type SettlementEvent,
  type SettlementEventType,
  type SignableMessage,
  type Timestamp,
  type TokenAmount,
  type TransferAuthorization,
} from '@holdback/core';
import { decodeEventLog, decodeFunctionData, encodeFunctionData, encodePacked, getAddress, keccak256, toHex, type Abi, type Hex, type Log } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Genesis } from '../sim/simchain.js';
import type { DryRunSubmission, Settlement, Submission, SubmitOptions, SubmitResult, TimeoutKind } from '../src/interface.js';
import { Refusal, refuse, toJson } from '../src/util.js';
import {
  acceptanceView,
  agreeView,
  appealView,
  decisionView,
  deliveryView,
  earlyAcceptView,
  keyProof,
  mutualView,
  NO_DELIVERY,
  NO_KEY,
  operatorFeeNonce,
  paymentHash,
  paymentInfo,
  payerAgnosticHash,
  receiveDigest,
  termsView,
  transferDigest,
} from './encode.js';
import { problemFromRevert, revertData, revertName } from './errors.js';
import { assertSafeChain } from './guard.js';
import { ANVIL_DEPLOYER_KEY, EXPIRY_MARGIN, type EvmWorld } from './world.js';

/** Submit options on EVM: who pays gas. A private key; the relaying operator's, or the agent's own for 'direct'. */
export interface EvmSubmitOptions extends SubmitOptions {
  sender?: Hex;
}

/** One mined transaction, for gas per deal (D4) and the escape-hatch evidence (who sent it). */
export interface TxRecord {
  commitmentId: Hex32;
  call: string;
  hash: Hex;
  from: Address;
  via: string;
  gasUsed: bigint;
  at: Timestamp;
}

interface Book {
  state: EscrowState;
  club: Club;
  sellerSignature: Hex;
  acceptance?: AdjudicatorAcceptance;
  agree?: Agree;
  delivery?: Delivery;
  /** A seller-signed delivery held off chain, carried by the next decision or early accept (D4: two transactions). */
  carried?: Delivery;
  released: EncryptedKey[];
  appealClosedAt?: Timestamp;
  lastEventSeq: number;
  updatedAt: Timestamp;
}

const GENESIS_HASH: Hex32 = `0x${'00'.repeat(32)}`;
const UINT256_MAX = (2n ** 256n - 1n).toString();
const ALL_BPS = 10000n;
const TX_GAS = 3_000_000n;
const lc = (a: string) => a.toLowerCase();
const secs = (ts: Timestamp) => Math.floor(Date.parse(ts) / 1000);

/** On-chain Stage enum (HoldbackRules.Stage) as core kinds; None is any pre-funding kind. */
const STAGES = ['None', 'Held', 'Delivered', 'FallbackJudging', 'Escalated', 'Released', 'Refunded', 'Settled', 'Expired'] as const;
const APPEAL_STATES = ['none', 'open', 'upheld', 'overturned', 'expired', 'none'] as const;
const PRE_FUNDING: readonly EscrowStateKind[] = ['Offered', 'AcceptedByAdjudicator', 'Agreed'];

/** Contract event names as settlement event types, per call. Unlisted logs (CPP, bonds, token) map to nothing. */
const LOG_TYPES: Record<string, Record<string, SettlementEventType>> = {
  agreeAndFund: { JobFunded: 'hold.funded' },
  deliver: { JobSubmitted: 'delivery.submitted' },
  decide: { JobSubmitted: 'delivery.submitted', Decided: 'judgment.decided', PaymentReleased: 'settlement.released', Refunded: 'settlement.refunded', KeyReleased: 'key.released' },
  earlyAccept: { JobSubmitted: 'delivery.submitted', PaymentReleased: 'settlement.released', KeyReleased: 'key.released' },
  mutualSettle: { MutuallySettled: 'commitment.settled', KeyReleased: 'key.released' },
  fileAppeal: { AppealFiled: 'appeal.filed' },
  expireOffer: { JobExpired: 'offer.expired' },
  reclaim: { Refunded: 'settlement.reclaimed' },
  triggerFallback: { FallbackTriggered: 'fallback.triggered' },
  triggerDefault: { Defaulted: 'default.triggered', Refunded: 'settlement.refunded' },
  expireAppeal: { AppealClosed: 'appeal.expired' },
};
const KEY_PATHS = ['decision', 'early_accept', 'mutual settlement', 'appeal decision'];

export interface DecodedLog {
  address: Address;
  eventName: string;
  args: Record<string, unknown>;
}

/** The settlement event types one call's logs produce, in log order. A party appeal's decision is appeal.decided. */
export function eventTypesFor(call: string, logs: readonly DecodedLog[]): Array<{ type: SettlementEventType; log: DecodedLog | null }> {
  const appealClosed = call === 'decide' && logs.some((l) => l.eventName === 'AppealClosed');
  const table = LOG_TYPES[call] ?? {};
  const out: Array<{ type: SettlementEventType; log: DecodedLog | null }> = [];
  for (const l of logs) {
    if (appealClosed) {
      if (l.eventName === 'AppealClosed') out.push({ type: 'appeal.decided', log: l });
      else if (l.eventName === 'KeyReleased') out.push({ type: 'key.released', log: l });
      continue;
    }
    const type = table[l.eventName];
    if (type) out.push({ type, log: l });
  }
  return out;
}

export class EvmSettlement implements Settlement {
  readonly kind = 'local' as const;
  readonly domain;
  readonly token: string;
  private readonly books = new Map<Hex32, Book>();
  private readonly nonces = new Set<string>();
  private readonly spent = new Map<string, bigint>();
  private readonly mandates = new Map<string, Mandate>();
  private readonly log_: SettlementEvent[] = [];
  /** Which events came from chain logs (the rest are the adapter's pre-funding records). */
  private readonly onChain = new Set<number>();
  private readonly txs: TxRecord[] = [];
  private readonly idempotency = new Map<string, { body: Hex32; result: Extract<SubmitResult, { ok: true }> }>();
  private readonly abi: Abi;
  private queue: Promise<unknown> = Promise.resolve();
  private clockMs: number;
  private domainSeparator: Hex32 | null = null;

  private constructor(
    readonly world: EvmWorld,
    readonly genesis: Genesis,
  ) {
    assertSafeChain(world.chainId);
    const start = Date.parse(genesis.start);
    if (!Number.isFinite(start) || start % 1000 !== 0) throw new RangeError(`genesis start ${genesis.start} must be a whole-second timestamp`);
    this.clockMs = start;
    this.domain = holdbackDomain(world.chainId, world.deployment.rules);
    this.token = lc(world.deployment.token);
    if (lc(genesis.token) !== this.token) throw new RangeError(`genesis token ${genesis.token} is not the deployed token ${this.token} (ADR-0025: token identifiers are addresses)`);
    if (genesis.chainId !== world.chainId) throw new RangeError(`genesis chain id ${genesis.chainId} is not ${world.chainId}`);
    for (const m of genesis.mandates) this.mandates.set(`${lc(m.agent)}|${m.clubId}`, m);
    const { abis } = world;
    this.abi = [...abis.rules, ...abis.bonds, ...abis.escrow, ...abis.collector, ...abis.token, ...abis.multicall] as Abi;
  }

  /**
   * A settlement on a fresh copy of the world (reverted to just after deployment): token balances minted, bonds
   * deposited into HoldbackBonds by each adjudicator, and every party's one-time allowance to HoldbackBonds for
   * appeal bonds. Setup is test-only (anvil impersonation) and never counts toward gas per deal.
   */
  static async create(world: EvmWorld, genesis: Genesis, gasFor: readonly Address[] = []): Promise<EvmSettlement> {
    await world.fresh(genesis.simSeed);
    const s = new EvmSettlement(world, genesis);
    for (const m of genesis.mandates) {
      if (!(await verifyMessage(s.domain, { ...m, type: 'Mandate' }, m.principal))) throw new Error(`the mandate for ${m.agent} is not signed by ${m.principal}`);
    }
    await s.setup(gasFor);
    return s;
  }

  private async setup(gasFor: readonly Address[]): Promise<void> {
    const { world } = this;
    const { token, bonds } = world.deployment;
    const parties = Object.keys(this.genesis.balances) as Address[];
    const adjudicators = Object.keys(this.genesis.bonds) as Address[];
    const everyone = [...new Set([...parties, ...adjudicators, ...gasFor].map(lc))] as Address[];
    for (const a of everyone) await world.rpc('anvil_setBalance', [a, toHex(10n ** 21n)]);
    const send = async (from: Address, to: Address, data: Hex) => {
      await world.rpc('anvil_impersonateAccount', [from]);
      await world.rpc('evm_setNextBlockTimestamp', [secs(this.genesis.start)]);
      const hash = await world.rpc<Hex>('eth_sendTransaction', [{ from, to, data, gas: toHex(TX_GAS) }]);
      const r = await world.publicClient.waitForTransactionReceipt({ hash });
      await world.rpc('anvil_stopImpersonatingAccount', [from]);
      if (r.status !== 'success') throw new Error(`setup transaction ${hash} reverted`);
    };
    const mint = (to: Address, amount: bigint) => send(to, token, encodeFunctionData({ abi: world.abis.token, functionName: 'mint', args: [to, amount] }));
    for (const [a, v] of Object.entries(this.genesis.balances)) if (BigInt(v) > 0n) await mint(a as Address, BigInt(v));
    for (const [a, b] of Object.entries(this.genesis.bonds)) {
      if (BigInt(b.senior) !== 0n) throw new RangeError('senior (backer) bond is Phase 4; HoldbackBonds takes the adjudicator’s own bond only');
      const amount = BigInt(b.junior);
      if (amount === 0n) continue;
      await mint(a as Address, amount);
      await send(a as Address, token, encodeFunctionData({ abi: world.abis.token, functionName: 'approve', args: [bonds, amount] }));
      await send(a as Address, bonds, encodeFunctionData({ abi: world.abis.bonds, functionName: 'deposit', args: [token, amount] }));
    }
    for (const a of parties) await send(a, token, encodeFunctionData({ abi: world.abis.token, functionName: 'approve', args: [bonds, 2n ** 256n - 1n] }));
  }

  // Clock and beacon

  now(): Timestamp {
    return toTimestamp(this.clockMs);
  }

  advance(seconds: number): void {
    if (!Number.isSafeInteger(seconds) || seconds < 0) throw new RangeError(`advance takes whole non-negative seconds, got ${seconds}`);
    this.clockMs += seconds * 1000;
  }

  advanceTo(ts: Timestamp): void {
    const target = Math.ceil(Date.parse(ts) / 1000) * 1000;
    if (target > this.clockMs) this.clockMs = target;
  }

  /** The sim beacon (same values as SimChain's); the rules contract asks the deployed SimBeacon for the same value. */
  beacon(round: number): Hex32 | null {
    if (!Number.isSafeInteger(round) || round < 0 || round > Math.floor(this.clockMs / 1000)) return null;
    return keccak256(encodePacked(['bytes32', 'uint64'], [this.genesis.simSeed, BigInt(round)]));
  }

  // Reads

  escrowState(id: Hex32): EscrowState | null {
    return this.books.get(id)?.state ?? null;
  }

  log(): SettlementEvent[] {
    return [...this.log_];
  }

  /** Every mined transaction of this settlement (setup excluded). */
  transactions(): TxRecord[] {
    return [...this.txs];
  }

  async stage(id: Hex32): Promise<{ stage: (typeof STAGES)[number]; appeal: number }> {
    const d = (await this.world.publicClient.readContract({ address: this.world.deployment.rules, abi: this.world.abis.rules, functionName: 'dealOf', args: [id] })) as { stage: number; appeal: number };
    return { stage: STAGES[d.stage]!, appeal: d.appeal };
  }

  private async read<T>(address: Address, abi: Abi, functionName: string, args: unknown[]): Promise<T> {
    return (await this.world.publicClient.readContract({ address, abi, functionName, args })) as T;
  }

  async tokenBalance(a: Address): Promise<bigint> {
    return this.read<bigint>(this.world.deployment.token, this.world.abis.token, 'balanceOf', [getAddress(a)]);
  }

  async bondOf(a: Address): Promise<bigint> {
    const { bonds, token } = this.world.deployment;
    return this.read<bigint>(bonds, this.world.abis.bonds, 'bondOf', [getAddress(a), token]);
  }

  async freeBond(a: Address): Promise<bigint> {
    const { bonds, token } = this.world.deployment;
    return this.read<bigint>(bonds, this.world.abis.bonds, 'freeOf', [getAddress(a), token]);
  }

  /** Token balance plus own bond, per address; what CPP holds for this operator; appeal bonds held. */
  async holdings(addresses: readonly Address[], ids: readonly Hex32[]): Promise<{ parties: Record<string, bigint>; escrow: bigint; appealHold: bigint }> {
    const { escrow, rules, bonds } = this.world.deployment;
    const parties: Record<string, bigint> = {};
    for (const a of addresses) parties[lc(a)] = (await this.tokenBalance(a)) + (await this.bondOf(a));
    const store = await this.read<Address>(escrow, this.world.abis.escrow, 'getTokenStore', [rules]);
    let appealHold = 0n;
    for (const id of ids) {
      const b = await this.read<readonly [Address, bigint]>(bonds, this.world.abis.bonds, 'appealBondOf', [id]);
      appealHold += BigInt(b[1]);
    }
    return { parties, escrow: await this.tokenBalance(store), appealHold };
  }

  /** What CPP still holds for one commitment (capturable amount); 0 for an unknown or never-funded one. */
  async heldFor(id: Hex32): Promise<bigint> {
    const book = this.books.get(id);
    if (!book) return 0n;
    const pi = paymentInfo(termsView(book.state.terms), this.world.deployment.rules, id, EXPIRY_MARGIN);
    const hash = paymentHash(pi, this.world.chainId, this.world.deployment.escrow);
    const s = await this.read<readonly [boolean, bigint, bigint]>(this.world.deployment.escrow, this.world.abis.escrow, 'paymentState', [hash]);
    return BigInt(s[1]);
  }

  async state(id: Hex32): Promise<CommitmentStateView | null> {
    const b = this.books.get(id);
    return b ? this.view(id, b) : null;
  }

  async *events(fromSeq = 0): AsyncIterable<SettlementEvent> {
    for (const e of this.log_.slice(fromSeq)) yield e;
  }

  async balances(addresses: readonly Address[]): Promise<Record<Address, TokenAmount>> {
    const out: Record<Address, TokenAmount> = {};
    for (const a of addresses) out[a] = { token: this.token, amount: (await this.tokenBalance(a)).toString() as TokenAmount['amount'] };
    return out;
  }

  async keysFor(id: Hex32, recipient: Address): Promise<EncryptedKey[]> {
    return (this.books.get(id)?.released ?? []).filter((k) => lc(k.recipient) === lc(recipient));
  }

  // Funding digests (ADR-0025)

  private async separator(): Promise<Hex32> {
    this.domainSeparator ??= await this.read<Hex32>(this.world.deployment.token, this.world.abis.token, 'DOMAIN_SEPARATOR', []);
    return this.domainSeparator;
  }

  /**
   * What the buyer signs to fund on EVM (ADR-0025, Proposed): ERC-3009 ReceiveWithAuthorization to CPP's collector
   * for price + fee, valid from the epoch until fundBy, with the payer-agnostic PaymentInfo hash as nonce. The
   * FundingAuthorization carries this signature (scheme erc3009) with these values in its fields.
   */
  async fundingAuthorization(terms: AnyCommitmentTerms): Promise<{ digest: Hex32; nonce: Hex32; value: bigint; validAfter: Timestamp; validBefore: Timestamp }> {
    const t = termsView(terms);
    const id = commitmentIdOf(terms);
    const pi = paymentInfo(t, this.world.deployment.rules, id, EXPIRY_MARGIN);
    const nonce = payerAgnosticHash(pi, this.world.chainId, this.world.deployment.escrow);
    const auth = { from: t.buyer, to: this.world.deployment.erc3009Collector, value: pi.maxAmount, validAfter: 0n, validBefore: BigInt(pi.preApprovalExpiry), nonce };
    return { digest: receiveDigest(await this.separator(), auth), nonce, value: pi.maxAmount, validAfter: '1970-01-01T00:00:00Z', validBefore: terms.timing.fundBy };
  }

  /** What the buyer signs for the operator fee: ERC-3009 TransferWithAuthorization, nonce bound to the commitment. */
  async operatorFeeAuthorization(commitmentId: Hex32, from: Address, to: Address, value: bigint, validAfter: Timestamp, validBefore: Timestamp): Promise<{ digest: Hex32; nonce: Hex32 }> {
    const nonce = operatorFeeNonce(commitmentId);
    const digest = transferDigest(await this.separator(), { from: getAddress(from), to: getAddress(to), value, validAfter: BigInt(secs(validAfter)), validBefore: BigInt(secs(validBefore)), nonce });
    return { digest, nonce };
  }

  // Submission

  submit(submission: Submission, options: EvmSubmitOptions = {}): Promise<SubmitResult> {
    return this.enqueue(() => this.process(submission, options, false));
  }

  validate(submission: DryRunSubmission): Promise<SubmitResult> {
    return this.enqueue(() => this.process(submission as Submission, {}, true));
  }

  trigger(commitmentId: Hex32, timeout: TimeoutKind, options: EvmSubmitOptions = {}): Promise<SubmitResult> {
    return this.submit({ kind: 'trigger', commitmentId, timeout }, options);
  }

  private enqueue(f: () => Promise<SubmitResult>): Promise<SubmitResult> {
    const next = this.queue.then(f, f);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async process(s: Submission, options: EvmSubmitOptions, dryRun: boolean): Promise<SubmitResult> {
    const key = dryRun ? undefined : options.idempotencyKey;
    const body = canonicalKeccak(toJson(s));
    if (key !== undefined) {
      const seen = this.idempotency.get(key);
      if (seen) return seen.body === body ? { ...structuredClone(seen.result), replayed: true } : { ok: false, problem: problem('idempotency_conflict', `idempotency key ${key} was used with another body`) };
    }
    const before = this.log_.length;
    let id: Hex32;
    try {
      id = await this.apply(s, options, dryRun);
    } catch (e) {
      if (e instanceof Refusal) return { ok: false, problem: e.problem };
      throw e;
    }
    const book = this.books.get(id)!;
    const events = this.log_.slice(before);
    if (events.length) {
      book.lastEventSeq = events.at(-1)!.seq;
      book.updatedAt = this.now();
    }
    const state = await this.view(id, book);
    const signatureCheck = s.kind === 'trigger' ? 'none' : 'verified';
    const result: Extract<SubmitResult, { ok: true }> = { ok: true, commitmentId: id, state, events, replayed: false, dryRun, signatureCheck };
    if (key !== undefined) this.idempotency.set(key, { body, result: structuredClone(result) });
    return result;
  }

  private emit(type: SettlementEventType, id: Hex32, actor: Address | 'anyone', via: string, payload: Record<string, unknown>, onChain: boolean): void {
    const prev = this.log_.at(-1);
    const body = { seq: (prev?.seq ?? -1) + 1, type, commitmentId: id, at: this.now(), actor, submittedVia: via, payload: toJson(payload) as Record<string, unknown>, prevHash: prev?.hash ?? GENESIS_HASH };
    const event = { ...body, hash: canonicalKeccak(body) } as SettlementEvent;
    this.log_.push(event);
    if (onChain) this.onChain.add(event.seq);
  }

  private bookOf(id: Hex32): Book {
    return this.books.get(id) ?? refuse('not_found', `no commitment ${id}`);
  }

  private async check(m: SignableMessage, signer: Address, what: string): Promise<void> {
    if (!(await verifyMessage(this.domain, m, signer))) refuse('invalid_signature', `${what} signature does not recover to ${signer}`);
  }

  private stepped(state: EscrowState, e: EscrowEvent): EscrowState {
    const r = step(state, e);
    return r.ok ? r.value : refuse(r.error.type, r.error.detail);
  }

  private amount(v: bigint): TokenAmount {
    return { token: this.token, amount: v.toString() as TokenAmount['amount'] };
  }

  private scopeFor(agent: Address, clubId: string, terms: AnyCommitmentTerms, club: Club | undefined): Scope {
    const m = this.mandates.get(`${lc(agent)}|${clubId}`);
    if (m) return m.scope;
    if (terms.disclosure.level !== 'public' && club?.rulebook.identityModes.includes('pseudonymous')) {
      return { roles: ['buyer', 'seller'], maxPerCommitment: terms.price, maxDaily: { token: terms.price.token, amount: UINT256_MAX } as TokenAmount, expiresAt: '9999-12-31T23:59:59Z' };
    }
    return refuse('scope_exceeded', `${agent} has no mandate in club ${clubId}`);
  }

  private admitted(club: Club, agent: Address, terms: AnyCommitmentTerms): boolean {
    if (club.rulebook.open) return true;
    if (!this.mandates.has(`${lc(agent)}|${club.id}`) && terms.disclosure.level !== 'public' && club.rulebook.identityModes.includes('pseudonymous')) return true;
    const principal = this.mandates.get(`${lc(agent)}|${club.id}`)?.principal;
    return this.genesis.members.some((m) => m.clubId === club.id && (lc(m.member) === lc(agent) || (principal !== undefined && lc(m.member) === lc(principal))));
  }

  private useNonce(key: string, dryRun: boolean): void {
    if (this.nonces.has(key)) refuse('nonce_reused', `nonce ${key} was used before`);
    if (!dryRun) this.nonces.add(key);
  }

  private async apply(s: Submission, options: EvmSubmitOptions, dryRun: boolean): Promise<Hex32> {
    const at = this.now();
    const via = options.via ?? 'direct';
    switch (s.kind) {
      // Pre-funding: signatures collected by the adapter, checked on chain at agreeAndFund
      case 'offer': {
        const c = s.commitment;
        const t = termsOf(c);
        if (!(await verifyTerms(this.domain, t, c.signatures.seller, t.seller))) refuse('invalid_signature', 'the seller did not sign these terms');
        if (this.books.has(c.id)) refuse('invalid_state', `commitment ${c.id} was already offered`);
        const club = this.genesis.clubs.find((k) => k.id === t.clubId && k.rulebookHash === t.rulebookHash);
        const sellerScope = this.scopeFor(t.seller, t.clubId, t, club);
        const nonce = `${lc(t.seller)}:terms:${t.nonce}`;
        const r = offer({ commitment: c, at, sellerScope, rulebook: club?.rulebook ?? null, nonceUsed: this.nonces.has(nonce) });
        if (!r.ok) return refuse(r.error.type, r.error.detail);
        // The contract can represent these terms only if the token is an address (ADR-0025).
        termsView(t);
        if (dryRun) return c.id;
        this.nonces.add(nonce);
        this.books.set(c.id, { state: r.value, club: club!, sellerSignature: c.signatures.seller as Hex, released: [], lastEventSeq: 0, updatedAt: at });
        this.emit('commitment.offered', c.id, t.seller, via, { source: 'adapter', termsHash: c.id, sellerSignature: c.signatures.seller }, false);
        return c.id;
      }
      case 'adjudicator_accept': {
        const m = s.message;
        await this.check(m, m.adjudicator, 'AdjudicatorAcceptance');
        const book = this.bookOf(m.commitmentId);
        this.useNonce(`${lc(m.adjudicator)}:${m.nonce}`, true);
        // A read, not a reservation: on chain the bond is encumbered at agreeAndFund (T-202 rule 2).
        const free = await this.freeBond(m.adjudicator);
        const next = this.stepped(book.state, { type: 'adjudicator_accept', at, message: m, unencumberedBond: this.amount(free) });
        const required = mulBps(next.terms.price, ALL_BPS, 'ceil');
        if (!required.ok) return refuse('invalid_terms', required.error.kind);
        if (free < BigInt(required.value.amount)) refuse('coverage_exceeded', `free bond ${free} is below ${required.value.amount}`);
        if (dryRun) return m.commitmentId;
        this.useNonce(`${lc(m.adjudicator)}:${m.nonce}`, false);
        book.state = next;
        book.acceptance = m;
        this.emit('adjudicator.accepted', m.commitmentId, m.adjudicator, via, { source: 'adapter', seedCommitment: m.seedCommitment, freeBond: this.amount(free) }, false);
        return m.commitmentId;
      }
      case 'agree':
        await this.check(s.message, s.message.buyer, 'Agree');
        return this.agree(s.message, via, dryRun).id;
      case 'fund':
        // On EVM the signature is the ERC-3009 one (ADR-0025); the token checks it inside agreeAndFund.
        if (dryRun) return s.message.commitmentId;
        return this.fund(s.message, null, options, at);
      case 'agree_and_fund': {
        if (s.agree.commitmentId !== s.funding.commitmentId) refuse('invalid_terms', 'agreement and funding name different commitments');
        if (s.operatorFee && s.operatorFee.commitmentId !== s.agree.commitmentId) refuse('invalid_terms', 'the operator fee names another commitment');
        await this.check(s.agree, s.agree.buyer, 'Agree');
        const { undo } = this.agree(s.agree, via, dryRun);
        if (dryRun) return s.agree.commitmentId;
        try {
          return await this.fund(s.funding, s.operatorFee ?? null, options, at);
        } catch (e) {
          undo();
          throw e;
        }
      }
      // On chain
      case 'deliver': {
        const d = s.delivery;
        const book = this.bookOf(d.commitmentId);
        const t = termsView(book.state.terms);
        try {
          await this.call(d.commitmentId, 'deliver', [t, deliveryView(d), d.signature], [{ type: 'deliver', at, delivery: d }], options, dryRun, book.state.terms.seller);
        } catch (e) {
          // In `deliver`, InvalidMessage comes only from the attempt check, after the stage and deadline checks, as in
          // core; the contract has no bytes left for its own error, so the name core gives it is restored here.
          if (e instanceof Refusal && d.attempt !== 1 && e.revert === 'InvalidMessage') {
            refuse('submission_limit_reached', `attempt ${d.attempt} exceeds maxSubmissions ${book.state.terms.timing.maxSubmissions} (${e.problem.detail})`);
          }
          throw e;
        }
        if (!dryRun) book.delivery = d;
        return d.commitmentId;
      }
      case 'early_accept': {
        const m = s.message;
        const book = this.bookOf(m.commitmentId);
        const carry = this.carrying(book);
        const d = carry ?? book.delivery ?? refuse('invalid_state', 'no delivery was relayed through this adapter; the early accept carries it on chain');
        const proof = keyProof(d, book.state.terms.buyer) ?? NO_KEY;
        const mirror: EscrowEvent[] = [...(carry ? [{ type: 'deliver' as const, at, delivery: carry }] : []), { type: 'early_accept', at, message: m }];
        await this.call(m.commitmentId, 'earlyAccept', [termsView(book.state.terms), earlyAcceptView(m), deliveryView(d), d.signature, proof], mirror, options, dryRun, m.buyer);
        if (carry && !dryRun) this.landCarried(book, carry);
        return m.commitmentId;
      }
      case 'decide': {
        const m = s.message;
        const book = this.bookOf(m.commitmentId);
        const carry = this.carrying(book);
        const d = carry ?? book.delivery;
        const beacon = m.role === 'primary' || !m.beacon ? null : { round: m.beacon.round, value: m.beacon.value };
        const mirror: EscrowEvent[] = [...(carry ? [{ type: 'deliver' as const, at, delivery: carry }] : []), { type: 'decide', at, message: m, beacon }];
        await this.call(m.commitmentId, 'decide', [termsView(book.state.terms), decisionView(m), d ? deliveryView(d) : NO_DELIVERY, d?.signature ?? '0x'], mirror, options, dryRun, m.adjudicator);
        if (carry && !dryRun) this.landCarried(book, carry);
        return m.commitmentId;
      }
      case 'appeal': {
        const p = s.appeal;
        const book = this.bookOf(p.commitmentId);
        // The contract does not check the bond against the rulebook rate or collect the appeal fee (T-202 rule 9).
        const zero = this.amount(0n);
        await this.call(p.commitmentId, 'fileAppeal', [termsView(book.state.terms), appealView(p)], [{ type: 'file_appeal', at, appeal: p, requiredBond: p.bond, requiredFee: zero, feePaid: zero }], options, dryRun, p.appellantAddress);
        return p.commitmentId;
      }
      case 'mutual_settle': {
        const m = s.message;
        const book = this.bookOf(m.commitmentId);
        const t = book.state.terms;
        if (!(await verifyMutualSettlement(this.domain, m, t.buyer, t.seller))) refuse('invalid_signature', 'the settlement is not signed by both the buyer and the seller');
        const d = book.delivery;
        const proof = m.releaseKey && d ? (keyProof(d, t.buyer) ?? NO_KEY) : NO_KEY;
        await this.call(m.commitmentId, 'mutualSettle', [termsView(t), mutualView(m), m.releaseKey && d ? deliveryView(d) : NO_DELIVERY, proof], [{ type: 'mutual_settle', at, message: m, rule: { allowed: true, payoutsTo: 'any' } }], options, dryRun, 'anyone');
        return m.commitmentId;
      }
      case 'trigger':
        return this.timeout(s.commitmentId, s.timeout, options, dryRun, at);
    }
  }

  /**
   * D4's two-transaction happy path: the relayer keeps the seller-signed delivery off chain and the next decision or
   * early accept carries it (T-202 decision 1). Nothing is sent; a reclaim stays possible until it lands. A seller who
   * wants to stop a reclaim submits `deliver` instead.
   */
  async carryDelivery(d: Delivery): Promise<Problem | null> {
    const book = this.books.get(d.commitmentId);
    if (!book) return problem('not_found', `no commitment ${d.commitmentId}`);
    if (book.state.kind !== 'Held') return problem('invalid_state', `a carried delivery needs a held commitment; it is ${book.state.kind}`);
    // The decision or early accept that carries it would revert InvalidMessage; core names this refusal.
    if (d.attempt !== 1) return problem('submission_limit_reached', `attempt ${d.attempt} exceeds maxSubmissions ${book.state.terms.timing.maxSubmissions}`);
    if (!(await verifyMessage(this.domain, { ...d, type: 'Delivery' }, book.state.terms.seller))) return problem('invalid_signature', 'the delivery is not signed by the seller');
    book.carried = d;
    return null;
  }

  private carrying(book: Book): Delivery | undefined {
    return book.state.kind === 'Held' ? book.carried : undefined;
  }

  private landCarried(book: Book, d: Delivery): void {
    book.delivery = d;
    delete book.carried;
  }

  private agree(m: Agree, via: string, dryRun: boolean): { id: Hex32; undo: () => void } {
    const book = this.bookOf(m.commitmentId);
    const { terms } = book.state;
    this.useNonce(`${lc(m.buyer)}:${m.nonce}`, true);
    const buyerScope = this.scopeFor(terms.buyer, terms.clubId, terms, book.club);
    const day = `${lc(terms.buyer)}|${this.now().slice(0, 10)}`;
    const spent = this.spent.get(day) ?? 0n;
    const next = this.stepped(book.state, { type: 'agree', at: this.now(), message: m, buyerScope, spentToday: this.amount(spent), memberAdmitted: this.admitted(book.club, terms.buyer, terms) });
    if (dryRun) return { id: m.commitmentId, undo: () => undefined };
    const prev = book.state;
    const seq = this.log_.length;
    this.useNonce(`${lc(m.buyer)}:${m.nonce}`, false);
    book.state = next;
    book.agree = m;
    this.spent.set(day, spent + BigInt(terms.price.amount));
    this.emit('commitment.agreed', m.commitmentId, m.buyer, via, { source: 'adapter', termsHash: m.commitmentId }, false);
    return {
      id: m.commitmentId,
      undo: () => {
        book.state = prev;
        delete book.agree;
        this.nonces.delete(`${lc(m.buyer)}:${m.nonce}`);
        this.spent.set(day, spent);
        this.log_.splice(seq);
      },
    };
  }

  /** Transaction 1 (D4): agreeAndFund, or the operator-fee bundle (ADR-0023): fee transfer + agreeAndFund, atomic. */
  private async fund(m: Extract<Submission, { kind: 'fund' }>['message'], fee: TransferAuthorization | null, options: EvmSubmitOptions, at: Timestamp): Promise<Hex32> {
    const book = this.bookOf(m.commitmentId);
    if (book.state.kind !== 'Agreed' || !book.acceptance || !book.agree) return refuse(book.state.kind === 'Offered' ? 'acceptance_missing' : 'invalid_state', `funding needs an agreed commitment; it is ${book.state.kind}`);
    const terms = book.state.terms;
    const t = termsView(terms);
    const expected = await this.fundingAuthorization(terms);
    if (lc(m.token) !== this.token || BigInt(m.value) !== expected.value || m.nonce !== expected.nonce || m.scheme !== 'erc3009') {
      refuse('invalid_terms', 'on EVM the funding is an ERC-3009 authorization of price + fee to the CPP collector, nonce = the payer-agnostic PaymentInfo hash (ADR-0025)');
    }
    const buyerScope = this.scopeFor(terms.buyer, terms.clubId, terms, book.club);
    const balance = await this.tokenBalance(terms.buyer);
    const args = [t, book.sellerSignature, acceptanceView(book.acceptance), agreeView(book.agree), { method: 0, signature: m.signature }];
    const mirror: EscrowEvent[] = [{ type: 'fund', at, message: m, buyerScope, balance: this.amount(balance), gasBuffer: this.amount(0n) }];
    if (!fee) {
      await this.call(m.commitmentId, 'agreeAndFund', args, mirror, options, false, m.from);
      return m.commitmentId;
    }
    if (lc(fee.from) !== lc(terms.buyer)) refuse('invalid_terms', `the operator fee must come from the buyer ${terms.buyer}`);
    if (lc(fee.token) !== this.token) refuse('invalid_terms', `the operator fee is in ${fee.token}, not the price token`);
    if (lc(fee.to) === lc(fee.from)) refuse('invalid_terms', 'the operator fee pays its own payer');
    if (fee.nonce !== operatorFeeNonce(m.commitmentId)) refuse('invalid_terms', 'the operator fee nonce must be keccak256(abi.encode(commitmentId, "operator_fee"))');
    const { token, rules, multicall } = this.world.deployment;
    const feeCall = encodeFunctionData({
      abi: this.world.abis.token,
      functionName: 'transferWithAuthorization',
      args: [getAddress(fee.from), getAddress(fee.to), BigInt(fee.value), BigInt(secs(fee.validAfter)), BigInt(secs(fee.validBefore)), fee.nonce, fee.signature],
    });
    const fundCall = encodeFunctionData({ abi: this.world.abis.rules, functionName: 'agreeAndFund', args });
    const bundle = encodeFunctionData({
      abi: this.world.abis.multicall,
      functionName: 'aggregate3',
      args: [
        [
          { target: token, allowFailure: false, callData: feeCall },
          { target: rules, allowFailure: false, callData: fundCall },
        ],
      ],
    });
    await this.send(m.commitmentId, 'agreeAndFund', multicall, bundle, mirror, options, false, m.from, { operatorFee: { from: lc(fee.from), to: lc(fee.to), amount: this.amount(BigInt(fee.value)) } });
    return m.commitmentId;
  }

  private async timeout(id: Hex32, timeout: TimeoutKind, options: EvmSubmitOptions, dryRun: boolean, at: Timestamp): Promise<Hex32> {
    const book = this.bookOf(id);
    const t = termsView(book.state.terms);
    switch (timeout) {
      case 'expire_offer':
        await this.call(id, 'expireOffer', [t], [{ type: 'expire', at }], options, dryRun, 'anyone');
        return id;
      case 'reclaim':
        await this.call(id, 'reclaim', [t], [{ type: 'reclaim', at }], options, dryRun, 'anyone');
        return id;
      case 'fallback':
        await this.call(id, 'triggerFallback', [t], [{ type: 'trigger_fallback', at }], options, dryRun, 'anyone');
        return id;
      case 'default':
        // One call on chain: default and apply-default, price + fee back to the buyer.
        await this.call(id, 'triggerDefault', [t], [{ type: 'trigger_default', at }, { type: 'apply_default_outcome', at }], options, dryRun, 'anyone');
        return id;
      case 'apply_default': {
        const s = book.state;
        // Already applied by triggerDefault in the same transaction; nothing to send.
        if (s.kind === 'Refunded' && s.via.kind === 'default_outcome') return id;
        return refuse('invalid_state', 'no default to apply');
      }
      case 'appeal_expiry': {
        // D20: finality is the deadline that closed the window, not the moment someone triggered the expiry.
        const s = book.state;
        let closedAt: Timestamp = at;
        if ((s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance') {
          const a = s.via.appeal;
          if (a.kind === 'none') closedAt = a.appealBy;
          if (a.kind === 'open') closedAt = a.appealDecideBy;
        }
        await this.call(id, 'expireAppeal', [t], [{ type: 'expire_appeal', at }], options, dryRun, 'anyone');
        if (!dryRun) book.appealClosedAt = closedAt;
        return id;
      }
      case 'settle':
        return refuse('invalid_state', 'settle applies to settle_after_window (Phase 4); guaranteed_on_decision settles at the decision');
    }
  }

  private async call(id: Hex32, fn: string, args: unknown[], mirror: EscrowEvent[], options: EvmSubmitOptions, dryRun: boolean, actor: Address | 'anyone'): Promise<void> {
    const data = encodeFunctionData({ abi: this.world.abis.rules, functionName: fn, args });
    await this.send(id, fn, this.world.deployment.rules, data, mirror, options, dryRun, actor);
  }

  /**
   * Simulates the call at the scenario clock's second; a revert is the refusal and nothing is sent. Otherwise mines
   * it at that second, maps its logs to settlement events, steps the core mirror and checks it against the stage.
   */
  private async send(id: Hex32, fn: string, to: Address, data: Hex, mirror: EscrowEvent[], options: EvmSubmitOptions, dryRun: boolean, actor: Address | 'anyone', extra: Record<string, unknown> = {}): Promise<void> {
    const book = this.bookOf(id);
    const key = options.sender ?? ANVIL_DEPLOYER_KEY;
    const from = privateKeyToAccount(key).address;
    const time = secs(this.now());
    // The pending block is mined at the scenario clock's second; the simulation runs against it.
    await this.world.rpc('evm_setNextBlockTimestamp', [time]);
    try {
      await this.world.rpc('eth_call', [{ from, to, data, gas: toHex(TX_GAS) }, 'pending']);
    } catch (e) {
      const raw = revertData(e);
      if (raw === undefined && !/revert/i.test(String((e as Error).message))) throw e;
      throw new Refusal(problemFromRevert(this.abi, raw), revertName(this.abi, raw));
    }
    // The mirror must accept what the contract accepted; run it before sending so a divergence changes nothing.
    let next = book.state;
    for (const e of mirror) {
      const r = step(next, e);
      if (!r.ok) throw new Error(`EVM/core divergence: the contract accepts ${fn} but core refuses ${e.type} in ${next.kind}: ${r.error.type}: ${r.error.detail}`);
      next = r.value;
    }
    if (dryRun) return;
    await this.world.rpc('evm_setNextBlockTimestamp', [time]);
    const wallet = this.world.wallet(key);
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: wallet.chain, to, data, gas: TX_GAS });
    const receipt = await this.world.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`${fn} reverted on chain after a passing simulation: ${hash}`);
    const logs = this.decode(receipt.logs);
    book.state = next;
    const onChain = await this.stage(id);
    const expect = PRE_FUNDING.includes(next.kind) ? 'None' : next.kind;
    if (onChain.stage !== expect) throw new Error(`EVM/core divergence after ${fn}: the contract is ${onChain.stage}, core is ${next.kind}`);
    this.txs.push({ commitmentId: id, call: fn, hash, from, via: options.via ?? 'direct', gasUsed: receipt.gasUsed, at: this.now() });
    const via = options.via ?? 'direct';
    const tx = { tx: hash, from: lc(from), gasUsed: receipt.gasUsed };
    if (extra['operatorFee']) this.emit('fee.operator', id, actor, via, { ...tx, ...(extra['operatorFee'] as object) }, true);
    for (const { type, log } of eventTypesFor(fn, logs)) {
      if (type === 'key.released' && log) {
        const a = log.args as { recipient: Address; path: number; scheme: string; ciphertext: string };
        const envelope = { recipient: getAddress(a.recipient), scheme: a.scheme, ciphertext: a.ciphertext } as EncryptedKey;
        book.released.push(envelope);
        this.emit(type, id, actor, via, { ...tx, recipient: envelope.recipient, envelope, path: KEY_PATHS[a.path] ?? String(a.path) }, true);
      } else {
        this.emit(type, id, actor, via, { ...tx, event: log?.eventName, args: log?.args ?? {} }, true);
      }
    }
    if (fn === 'decide' && logs.some((l) => l.eventName === 'AppealClosed')) book.appealClosedAt = this.now();
  }

  private decode(logs: readonly Log[]): DecodedLog[] {
    const out: DecodedLog[] = [];
    for (const l of logs) {
      try {
        const d = decodeEventLog({ abi: this.abi, data: l.data, topics: l.topics });
        out.push({ address: l.address, eventName: d.eventName ?? '', args: (d.args ?? {}) as Record<string, unknown> });
      } catch {
        // A log from a contract whose ABI is not loaded (none expected); it maps to no settlement event.
      }
    }
    return out;
  }

  /**
   * Rebuilds the on-chain events from the chain alone: every rules-contract transaction since deployment, its call
   * read from calldata, its logs mapped as at submission. Must equal the on-chain events in this adapter's log.
   */
  async replayCheck(): Promise<{ ok: boolean; events: number; detail?: string }> {
    const { rules, multicall, fromBlock } = this.world.deployment;
    const latest = await this.world.publicClient.getBlockNumber();
    const rebuilt: SettlementEventType[] = [];
    let txCount = 0;
    for (let n = fromBlock; n <= latest; n++) {
      const block = await this.world.publicClient.getBlock({ blockNumber: n, includeTransactions: true });
      for (const tx of block.transactions) {
        if (typeof tx === 'string' || !tx.to) continue;
        let fn: string | null = null;
        if (lc(tx.to) === lc(rules)) fn = decodeFunctionData({ abi: this.world.abis.rules, data: tx.input }).functionName;
        else if (lc(tx.to) === lc(multicall)) fn = 'agreeAndFund';
        if (!fn) continue;
        const receipt = await this.world.publicClient.getTransactionReceipt({ hash: tx.hash });
        if (receipt.status !== 'success') continue;
        txCount++;
        if (lc(tx.to) === lc(multicall)) rebuilt.push('fee.operator');
        rebuilt.push(...eventTypesFor(fn, this.decode(receipt.logs)).map((e) => e.type));
      }
    }
    const recorded = this.log_.filter((e) => this.onChain.has(e.seq)).map((e) => e.type);
    const ok = txCount === this.txs.length && rebuilt.length === recorded.length && rebuilt.every((t, i) => t === recorded[i]);
    return ok ? { ok, events: rebuilt.length } : { ok, events: rebuilt.length, detail: `chain: ${rebuilt.join(',')} / adapter: ${recorded.join(',')}` };
  }

  // Read model (as SimChain's view)

  private async view(id: Hex32, rec: Book): Promise<CommitmentStateView> {
    const s = rec.state;
    const t = s.terms.timing;
    const deadlines: Record<string, Timestamp> = { offerExpiresAt: t.offerExpiresAt, fundBy: t.fundBy, deliverBy: t.deliverBy, judgeBy: t.judgeBy, fallbackBy: t.fallbackBy };
    let appealState: CommitmentStateView['appealState'] = 'none';
    if ((s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance') {
      const chain = PRE_FUNDING.includes(s.kind) ? null : await this.stage(id);
      appealState = chain ? (APPEAL_STATES[chain.appeal] ?? 'none') : s.via.appeal.kind;
      const a = s.via.appeal;
      if (a.kind === 'none') {
        deadlines['appealBy'] = a.appealBy;
        deadlines['appealDecideBy'] = a.appealDecideBy;
      }
      if (a.kind === 'open') deadlines['appealDecideBy'] = a.appealDecideBy;
    }
    if (s.kind === 'Escalated') deadlines['appealDecideBy'] = s.escalation.appealDecideBy;
    const hold = 'hold' in s ? { hold: { amount: s.hold.amount, railRef: `evm:${this.world.chainId}:${lc(this.world.deployment.rules)}:${id}` } } : {};
    const attempt = 'delivery' in s ? s.delivery.attempt : s.kind === 'Released' || s.kind === 'Refunded' || s.kind === 'Settled' ? 1 : 0;
    const amount = async (a: Address): Promise<TokenAmount> => ({ token: this.token, amount: (await this.tokenBalance(a)).toString() as TokenAmount['amount'] });
    const view: CommitmentStateView = {
      commitmentId: id,
      escrowState: s.kind,
      appealState,
      attempt: s.kind === 'Released' || s.kind === 'Refunded' ? (s.via.kind === 'reclaim' ? 0 : 1) : attempt,
      ...hold,
      deadlines,
      balances: { [s.terms.buyer]: await amount(s.terms.buyer), [s.terms.seller]: await amount(s.terms.seller) },
      settledAt: s.kind === 'Released' || s.kind === 'Refunded' || s.kind === 'Settled' ? s.settledAt : null,
      finalAt: this.finalAt(rec),
      lastEventSeq: rec.lastEventSeq,
      updatedAt: rec.updatedAt,
    };
    if (s.kind === 'Settled') view.settled = { payouts: s.payouts, keyReleased: s.keyReleased };
    return view;
  }

  private finalAt(rec: Book): Timestamp | null {
    const s = rec.state;
    const passed = (ts: Timestamp) => this.clockMs >= Date.parse(ts);
    switch (s.kind) {
      case 'Expired':
        return s.expiredAt;
      case 'Settled':
        return s.settledAt;
      case 'Released':
      case 'Refunded': {
        if (s.via.kind !== 'first_instance') return s.settledAt;
        const a = s.via.appeal;
        if (a.kind === 'none') return passed(a.appealBy) ? a.appealBy : null;
        if (a.kind === 'open') return passed(a.appealDecideBy) ? a.appealDecideBy : null;
        return rec.appealClosedAt ?? null;
      }
      default:
        return null;
    }
  }
}
