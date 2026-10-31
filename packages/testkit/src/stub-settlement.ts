// The stub settlement: an in-memory ledger that drives @holdback/core's real state machine.
// Every agent message is EIP-712 signed with a key derived from the fixture seed and verified with
// core's verifier before `offer`/`step` sees it, as the real settlement will do. Money moves only on
// accepted transitions. SimChain (T-006) replaces this; the snapshot format stays.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  beaconRoundFor,
  canonicalJson,
  canonicalKeccak,
  commitmentId as commitmentIdOf,
  holdbackDomain,
  offer,
  panelSeed,
  problem,
  rulebookHash,
  signMessage,
  signTerms,
  step,
  verifyMessage,
  verifyTerms,
  type Address,
  type CommitmentTerms,
  type Decision,
  type Delivery,
  type EscrowEvent,
  type EscrowState,
  type EscrowStateKind,
  type Hex32,
  type OfferInput,
  type Problem,
  type Result,
  type Scope,
  type SettlementEventType,
  type Sha256,
  type SignableMessage,
  type Timestamp,
  type UnsignedMessage,
} from '@holdback/core';
import { encodePacked, keccak256, stringToBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { SimContext } from './context.js';
import { stubJudgment, type JudgmentView } from './judgment-stub.js';
import type { Outage, StepProblem } from './prefix.js';
import type { JudgeProvider } from './recorded.js';
import type { Scenario, Step } from './scenario.js';
import { ScenarioError } from './scenario.js';
import {
  SIM_CHAIN_ID,
  STUB_ACCEPTANCE,
  STUB_CLUB_ID,
  STUB_DELIVERABLE,
  STUB_FEE,
  STUB_POLICY_HASH,
  STUB_PRICE,
  STUB_REGISTRY_HASH,
  STUB_RULEBOOK,
  TOKEN,
  tusd,
} from './stub-terms.js';

export type ActorRole = 'buyer' | 'seller' | 'primary' | 'fallback' | 'appeal' | 'operator';

export interface Actor {
  name: string;
  role: ActorRole;
  address: Address;
}

export interface TimelineRow {
  t: number;
  step: number;
  actor: string;
  call: string;
  via: string;
  result: string;
  state: string;
  detail?: string;
}

export interface LedgerEvent {
  seq: number;
  step: number;
  type: SettlementEventType;
  hash: Hex32;
}

export interface Receipt {
  id: string;
  operator: string;
  call: string;
}

export interface Invariant {
  name: string;
  ok: boolean;
  note?: string;
}

export interface StubRun {
  actors: Actor[];
  /** Account names in display order. */
  accounts: string[];
  commitment: { id: Hex32; terms: CommitmentTerms } | null;
  rulebookHash: Hex32;
  rows: TimelineRow[];
  balanceRows: Array<{ after: string; balances: Record<string, bigint> }>;
  judgments: JudgmentView[];
  events: LedgerEvent[];
  receipts: Receipt[];
  replay: { ok: boolean; events: number };
  invariants: Invariant[];
  states: EscrowStateKind[];
  finalState: EscrowStateKind | null;
  problems: StepProblem[];
  outages: Outage[];
  autoAccepted: boolean;
  balances: Record<string, bigint>;
}

const ESCROW = 'escrow';
const GENESIS: Hex32 = `0x${'00'.repeat(32)}`;

/** What the invariant checks read: the ledger after a run, independent of how it was produced. */
export interface LedgerView {
  balances: Record<string, bigint>;
  faucetTotal: bigint;
  events: Array<LedgerEvent & { prevHash: Hex32 }>;
  finalState: EscrowStateKind | null;
  /** Released by an adjudicator's decision (first instance or escalation), not by an early accept. */
  releasedByDecision: boolean;
  /** The releasing decision carried the buyer's sealed key. */
  keyForBuyer: boolean;
  replayOk: boolean;
}

/** The ledger invariants every snapshot reports. Pure, so tests can feed it deliberately broken ledgers. */
export function checkInvariants(v: LedgerView): Invariant[] {
  const values = Object.values(v.balances);
  const total = values.reduce((a, b) => a + b, 0n);
  const settlements = v.events.filter((e) => e.type.startsWith('settlement.'));
  const settled = v.finalState === 'Released' || v.finalState === 'Refunded';
  const released = v.events.find((e) => e.type === 'settlement.released');
  const key = v.events.find((e) => e.type === 'key.released');
  const chain = v.events.every((e, i) => e.seq === i && e.prevHash === (i === 0 ? GENESIS : v.events[i - 1]!.hash));
  return [
    { name: 'conservation', ok: total === v.faucetTotal },
    { name: 'no negative balances', ok: values.every((x) => x >= 0n) },
    { name: 'settled once', ok: settlements.length <= 1 },
    settled ? { name: 'escrow empty after settlement', ok: (v.balances[ESCROW] ?? 0n) === 0n } : { name: 'escrow empty after settlement', ok: true, note: 'n/a' },
    v.releasedByDecision
      ? { name: 'key released atomically with payment', ok: !!released && !!key && released.step === key.step && v.keyForBuyer }
      : { name: 'key released atomically with payment', ok: true, note: 'n/a' },
    { name: 'event hash chain links', ok: chain },
    { name: 'replay matches the settlement state', ok: v.replayOk },
  ];
}
const DAY = 86_400;
const MAX_SCOPE = tusd('1000000000000000');

const sha256 = (bytes: Uint8Array | string): Sha256 => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const b64url = (hex: Hex32 | string): string => Buffer.from(hex.replace(/^0x/, ''), 'hex').toString('base64url');
const plus = (ts: Timestamp, seconds: number): Timestamp => new Date(Date.parse(ts) + seconds * 1000).toISOString();

type Signed<T extends UnsignedMessage> = T & { signature: Hex };

/** Test keys derived from the public fixture seed and the actor name. They guard no value. */
function testKey(seed: number, name: string): Hex {
  return keccak256(stringToBytes(`holdback/testkit/v0/${seed}/${name}`));
}

export class StubSettlement {
  private readonly domain = holdbackDomain(SIM_CHAIN_ID);
  private readonly keys = new Map<string, Hex>();
  private readonly actors: Actor[] = [];
  private readonly balances = new Map<string, bigint>();
  private readonly faucetTotal: bigint;
  private readonly rows: TimelineRow[] = [];
  private readonly balanceRows: StubRun['balanceRows'] = [];
  private readonly judgments: JudgmentView[] = [];
  private readonly events: Array<LedgerEvent & { prevHash: Hex32 }> = [];
  private readonly receipts: Receipt[] = [];
  private readonly problems: StepProblem[] = [];
  private readonly outages: Outage[] = [];
  private readonly offline = new Set<string>();
  private readonly refusingOperators = new Set<string>();
  private readonly states: EscrowStateKind[] = [];
  private readonly applied: EscrowEvent[] = [];

  private state: EscrowState | null = null;
  private offerInput: OfferInput | null = null;
  private terms: CommitmentTerms | null = null;
  private id: Hex32 | null = null;
  private seed: Hex32 | null = null;
  private delivery: { message: Delivery; plaintext: Uint8Array; source: string; contentKey: Hex32 } | null = null;
  private decision: Decision | null = null;
  private stepNo = 0;
  private signerOverride: string | undefined;

  constructor(
    private readonly ctx: SimContext,
    private readonly scenario: Scenario,
    private readonly judges: JudgeProvider,
    private readonly root: string,
  ) {
    const { parties, adjudicators, operators } = scenario;
    const add = (name: string, role: ActorRole) => {
      const key = testKey(ctx.seed, name);
      this.keys.set(name, key);
      this.actors.push({ name, role, address: privateKeyToAccount(key).address });
    };
    add(parties.buyer, 'buyer');
    add(parties.seller, 'seller');
    add(adjudicators.primary, 'primary');
    add(adjudicators.fallback, 'fallback');
    add(adjudicators.appeal, 'appeal');
    for (const op of operators) add(op, 'operator');

    for (const a of this.actors) this.balances.set(a.name, 0n);
    this.balances.set(ESCROW, 0n);
    let total = 0n;
    for (const [who, amount] of Object.entries(scenario.faucet)) {
      this.balances.set(who, BigInt(amount));
      total += BigInt(amount);
    }
    this.faucetTotal = total;
    this.balanceRows.push({ after: 'faucet', balances: this.snapshotBalances() });
  }

  async run(): Promise<StubRun> {
    const { scenario, root } = this;
    if (scenario.pragmas.mode !== 'guaranteed_on_decision') {
      throw new ScenarioError(`@mode ${scenario.pragmas.mode}: Phase 1 supports guaranteed_on_decision only (ADR-0007)`);
    }
    for (const ref of [scenario.club, scenario.terms]) {
      if (ref !== undefined && existsSync(join(root, ref))) {
        throw new ScenarioError(`${ref} exists, but the stub settlement uses built-in stub terms and will not ignore a real file; run this fixture on the T-006 settlement`);
      }
    }
    for (const s of scenario.steps) {
      this.stepNo++;
      this.signerOverride = 'signer' in s ? s.signer : undefined;
      await this.runStep(s);
    }
    return this.result();
  }

  // ---- helpers -------------------------------------------------------------------------------

  private actor(name: string): Actor {
    const a = this.actors.find((x) => x.name === name);
    if (!a) throw new ScenarioError(`steps[${this.stepNo}]: "${name}" is not a party, adjudicator or operator of this scenario`);
    return a;
  }

  private address(name: string): Address {
    return this.actor(name).address;
  }

  /** The key that signs for `name` in the current step: its own, unless the step names an impersonating signer. */
  private keyFor(name: string): Hex {
    const signer = this.signerOverride ?? name;
    this.actor(signer);
    return this.keys.get(signer)!;
  }

  private async sign<T extends UnsignedMessage>(signer: string, message: T): Promise<Signed<T>> {
    const signature = await signMessage(this.keyFor(signer), this.domain, message);
    return { ...message, signature } as Signed<T>;
  }

  private snapshotBalances(): Record<string, bigint> {
    return Object.fromEntries(this.balances);
  }

  private move(from: string, to: string, amount: bigint): void {
    this.balances.set(from, (this.balances.get(from) ?? 0n) - amount);
    this.balances.set(to, (this.balances.get(to) ?? 0n) + amount);
  }

  private emit(type: SettlementEventType, actor: string, via: string, payload: Record<string, unknown>): void {
    const prevHash = this.events.at(-1)?.hash ?? GENESIS;
    const seq = this.events.length;
    const hash = canonicalKeccak({ seq, type, commitmentId: this.id, at: this.ctx.clock.now(), actor, submittedVia: via, payload, prevHash });
    this.events.push({ seq, step: this.stepNo, type, hash, prevHash });
  }

  private kind(): string {
    return this.state?.kind ?? '—';
  }

  private row(actor: string, call: string, via: string, result: string, detail?: string): void {
    const r: TimelineRow = { t: this.ctx.clock.elapsedMs(), step: this.stepNo, actor, call, via, result, state: this.kind() };
    if (detail !== undefined) r.detail = detail;
    this.rows.push(r);
    // Every call takes one simulated second, so messages stay on whole-second timestamps.
    this.ctx.clock.advanceSeconds(1);
  }

  private refuse(actor: string, call: string, via: string, p: Problem): void {
    this.problems.push({ step: this.stepNo, call, actor, type: p.type });
    this.row(actor, call, via, p.type, p.detail);
  }

  private receipt(via: string, call: string): void {
    if (via !== 'direct') this.receipts.push({ id: this.ctx.ids.next('rcpt'), operator: via, call });
  }

  /** Applies a core transition, or records the refusal. Returns true when the state changed. */
  private transition(actor: string, call: string, via: string, r: Result<EscrowState, Problem>, event?: EscrowEvent): boolean {
    if (!r.ok) {
      this.refuse(actor, call, via, r.error);
      return false;
    }
    this.state = r.value;
    if (event) this.applied.push(event);
    if (this.states.at(-1) !== r.value.kind) this.states.push(r.value.kind);
    return true;
  }

  private needCommitment(actor: string, call: string, via: string): { terms: CommitmentTerms; id: Hex32; state: EscrowState } | null {
    if (!this.state || !this.terms || !this.id) {
      this.refuse(actor, call, via, problem('invalid_state', `${call} needs a commitment; none was offered`));
      return null;
    }
    return { terms: this.terms, id: this.id, state: this.state };
  }

  private async verified(actor: string, call: string, via: string, message: SignableMessage, signer: Address): Promise<boolean> {
    if (await verifyMessage(this.domain, message, signer)) return true;
    this.refuse(actor, call, via, problem('invalid_signature', `${message.type} signature does not recover to ${signer}`));
    return false;
  }

  private scope(role: 'buyer' | 'seller'): Scope {
    return { roles: [role], maxPerCommitment: MAX_SCOPE, maxDaily: MAX_SCOPE, expiresAt: plus(this.ctx.clock.now(), 30 * DAY) };
  }

  // ---- steps ---------------------------------------------------------------------------------

  /** Who acts in a step, and through which operator, for the outage gate. */
  private actingParty(s: Step): { actor: string; via: string } | null {
    const { parties } = this.scenario;
    switch (s.kind) {
      case 'offer':
      case 'deliver':
        return { actor: parties.seller, via: s.via };
      case 'agree_and_fund':
      case 'reclaim':
      case 'verify_key_release':
        return { actor: parties.buyer, via: s.via };
      case 'adjudicator_accept':
        return { actor: this.scenario.adjudicators.primary, via: s.via };
      case 'judge':
        return { actor: s.adjudicator, via: 'direct' };
      case 'settle':
        return { actor: s.trigger === 'anyone' ? 'anyone' : parties[s.trigger], via: s.via };
      case 'trigger_fallback':
      case 'trigger_default':
      case 'apply_default_outcome':
      case 'expire':
        return { actor: 'anyone', via: s.via };
      default:
        return null;
    }
  }

  /** True when an offline actor or a refusing operator stops the step before any call is made. */
  private blocked(s: Step): boolean {
    const party = this.actingParty(s);
    if (!party) return false;
    const call = s.kind === 'judge' ? 'decide' : s.kind;
    if (this.offline.has(party.actor)) {
      this.outages.push({ step: this.stepNo, actor: party.actor, kind: 'offline' });
      this.row(party.actor, call, party.via, 'offline (no call)');
      return true;
    }
    if (this.refusingOperators.has(party.via)) {
      this.outages.push({ step: this.stepNo, actor: party.via, kind: 'operator_refused' });
      this.row(party.actor, call, party.via, `refused by ${party.via}`);
      return true;
    }
    return false;
  }

  private async runStep(s: Step): Promise<void> {
    const { parties } = this.scenario;
    if (this.blocked(s)) return;
    switch (s.kind) {
      case 'offer':
        return this.offer(parties.seller, s.via);
      case 'adjudicator_accept':
        return this.adjudicatorAccept(s.via, false);
      case 'agree_and_fund':
        return this.agreeAndFund(parties.buyer, s.via);
      case 'deliver':
        return this.deliver(parties.seller, s.via, s.file, s.stubBytes === true);
      case 'advance_clock':
        this.ctx.clock.advanceSeconds(s.seconds);
        return;
      case 'judge':
        return this.judge(s.adjudicator);
      case 'settle':
        return this.settle(s.trigger === 'anyone' ? 'anyone' : parties[s.trigger], s.via);
      case 'reclaim':
        return this.reclaim(parties.buyer, s.via);
      case 'verify_key_release':
        return this.verifyKeyRelease(parties.buyer, s.via);
      case 'offline':
        this.offline.add(s.actor);
        return this.row(s.actor, 'goes offline', 'direct', 'ok');
      case 'operator_refuses':
        this.refusingOperators.add(s.operator);
        return this.row(s.operator, 'starts refusing to relay', 'direct', 'ok');
      case 'trigger_fallback':
      case 'trigger_default':
      case 'apply_default_outcome':
      case 'expire':
        return this.timeout(s.kind, s.via);
    }
  }

  private async offer(seller: string, via: string): Promise<void> {
    if (this.state) return this.refuse(seller, 'offer', via, problem('invalid_state', 'this scenario already has a commitment'));
    const now = this.ctx.clock.now();
    const { adjudicators } = this.scenario;
    const terms: CommitmentTerms = {
      schemaVersion: '0.6',
      clubId: STUB_CLUB_ID,
      rulebookHash: rulebookHash(STUB_RULEBOOK),
      buyer: this.address(this.scenario.parties.buyer),
      seller: this.address(seller),
      deliverable: STUB_DELIVERABLE,
      acceptance: STUB_ACCEPTANCE,
      price: STUB_PRICE,
      adjudication: {
        adjudicator: this.address(adjudicators.primary),
        fallbackAdjudicator: this.address(adjudicators.fallback),
        appealAdjudicator: this.address(adjudicators.appeal),
        policyId: `${adjudicators.primary}/stub-p1`,
        fee: STUB_FEE,
        registryHash: STUB_REGISTRY_HASH,
        policyHash: STUB_POLICY_HASH,
      },
      timing: {
        offerExpiresAt: plus(now, 900),
        fundBy: plus(now, 1800),
        deliverBy: plus(now, 3600),
        judgeBy: plus(now, 3600 + 600),
        fallbackBy: plus(now, 3600 + 1200),
        appealWindowSec: 300,
        appealDecideSec: 300,
        maxSubmissions: 1,
      },
      settlement: { mode: 'guaranteed_on_decision', token: TOKEN },
      remedy: { onReject: 'full_refund' },
      disclosure: { level: 'public' },
      buyerEncryptionPublicKey: b64url(this.ctx.rng.hex32()),
      nonce: this.ctx.rng.hex32(),
      createdAt: now,
    };
    const signature = await signTerms(this.keyFor(seller), this.domain, terms);
    if (!(await verifyTerms(this.domain, terms, signature, terms.seller))) {
      return this.refuse(seller, 'offer', via, problem('invalid_signature', 'seller signature over the terms does not verify'));
    }
    const input: OfferInput = {
      commitment: { ...terms, id: commitmentIdOf(terms), signatures: { seller: signature } },
      at: now,
      sellerScope: this.scope('seller'),
      rulebook: STUB_RULEBOOK,
      nonceUsed: false,
    };
    const r = offer(input);
    if (this.transition(seller, 'offer', via, r)) {
      this.offerInput = input;
      this.terms = terms;
      this.id = input.commitment.id;
      this.emit('commitment.offered', seller, via, { commitmentId: this.id });
      this.receipt(via, 'offer');
      this.row(seller, 'offer', via, 'ok');
    }
  }

  private async adjudicatorAccept(via: string, implied: boolean): Promise<void> {
    const name = this.scenario.adjudicators.primary;
    const call = implied ? 'accept (implied by agree_and_fund)' : 'accept';
    if (implied && this.offline.has(name)) {
      this.outages.push({ step: this.stepNo, actor: name, kind: 'offline' });
      return this.row(name, call, via, 'offline (no call)');
    }
    const c = this.needCommitment(name, call, via);
    if (!c) return;
    const seed = this.ctx.rng.hex32();
    const at = this.ctx.clock.now();
    const message = await this.sign(name, {
      type: 'AdjudicatorAcceptance',
      commitmentId: c.id,
      adjudicator: this.address(name),
      seedCommitment: keccak256(seed),
      policyHash: c.terms.adjudication.policyHash,
      registryHash: c.terms.adjudication.registryHash,
      fee: c.terms.adjudication.fee,
      bondReserved: c.terms.price,
      nonce: this.ctx.rng.hex32(),
      expiresAt: c.terms.timing.offerExpiresAt,
    } as const);
    if (!(await this.verified(name, call, via, message, this.address(name)))) return;
    const event: EscrowEvent = { type: 'adjudicator_accept', at, message, unencumberedBond: tusd(this.balances.get(name)!) };
    if (this.transition(name, call, via, step(c.state, event), event)) {
      this.seed = seed;
      this.emit('adjudicator.accepted', name, via, { seedCommitment: message.seedCommitment });
      this.receipt(via, 'accept');
      this.row(name, call, via, 'ok');
    }
  }

  private async agreeAndFund(buyer: string, via: string): Promise<void> {
    if (this.state?.kind === 'Offered') {
      const override = this.signerOverride;
      this.signerOverride = undefined;
      await this.adjudicatorAccept(via, true);
      this.signerOverride = override;
    }
    const c = this.needCommitment(buyer, 'agree', via);
    if (!c) return;
    const buyerAddress = this.address(buyer);

    const agree = await this.sign(buyer, { type: 'Agree', commitmentId: c.id, buyer: buyerAddress, nonce: this.ctx.rng.hex32(), expiresAt: c.terms.timing.offerExpiresAt } as const);
    if (!(await this.verified(buyer, 'agree', via, agree, buyerAddress))) return;
    const agreeEvent: EscrowEvent = { type: 'agree', at: this.ctx.clock.now(), message: agree, buyerScope: this.scope('buyer'), spentToday: tusd(0n), memberAdmitted: true };
    if (!this.transition(buyer, 'agree', via, step(c.state, agreeEvent), agreeEvent)) return;
    this.emit('commitment.agreed', buyer, via, {});
    this.receipt(via, 'agree');
    this.row(buyer, 'agree', via, 'ok');

    const total = BigInt(c.terms.price.amount) + BigInt(c.terms.adjudication.fee.amount);
    const funding = await this.sign(buyer, {
      type: 'FundingAuthorization',
      scheme: 'erc3009',
      commitmentId: c.id,
      from: buyerAddress,
      value: total.toString(),
      token: TOKEN,
      validAfter: c.terms.createdAt,
      validBefore: c.terms.timing.fundBy,
      nonce: this.ctx.rng.hex32(),
      expiresAt: c.terms.timing.fundBy,
    } as const);
    if (!(await this.verified(buyer, 'fund', via, funding, buyerAddress))) return;
    const fundEvent: EscrowEvent = {
      type: 'fund',
      at: this.ctx.clock.now(),
      message: funding,
      buyerScope: this.scope('buyer'),
      balance: tusd(this.balances.get(buyer)!),
      gasBuffer: tusd(0n),
    };
    if (!this.transition(buyer, 'fund', via, step(this.state!, fundEvent), fundEvent)) return;
    this.move(buyer, ESCROW, total);
    this.emit('hold.funded', buyer, via, { amount: total.toString() });
    this.receipt(via, 'fund');
    this.row(buyer, 'fund', via, 'ok');
    this.balanceRows.push({ after: 'fund', balances: this.snapshotBalances() });
  }

  private async deliver(seller: string, via: string, file: string, stubBytes: boolean): Promise<void> {
    const c = this.needCommitment(seller, 'deliver', via);
    if (!c) return;
    const path = join(this.root, 'fixtures', file);
    const present = existsSync(path);
    if (!present && !stubBytes) {
      throw new ScenarioError(`steps[${this.stepNo}].deliver: fixtures/${file} does not exist; add the file, or set stub_bytes: true to deliver placeholder bytes on purpose`);
    }
    if (present && stubBytes) {
      throw new ScenarioError(`steps[${this.stepNo}].deliver: fixtures/${file} exists, so stub_bytes: true would ignore it; remove stub_bytes`);
    }
    // Reads bytes only; deliverables are data, never code.
    const plaintext = present ? new Uint8Array(readFileSync(path)) : new TextEncoder().encode(`stub deliverable for ${file}\n`);
    const source = present ? `fixtures/${file}` : `stub bytes by stub_bytes: true; fixtures/${file} absent`;
    const plaintextSha256 = sha256(plaintext);
    const contentKey = canonicalKeccak({ contentKey: plaintextSha256, commitmentId: c.id });
    const { adjudication } = c.terms;
    const recipients = [adjudication.adjudicator, adjudication.fallbackAdjudicator, adjudication.appealAdjudicator, c.terms.buyer];
    const body: Omit<Delivery, 'signature'> = {
      commitmentId: c.id,
      attempt: 1,
      ciphertext: { uri: `sim://blobs/${this.ctx.ids.next('blob')}`, sha256: sha256(`ciphertext:${plaintextSha256}`), bytes: plaintext.length + 16, cipher: 'aes-256-gcm' },
      plaintextSha256,
      plaintextMime: c.terms.deliverable.format,
      encryptedKeys: recipients.map((recipient) => ({ recipient, scheme: 'x25519-xsalsa20poly1305', ciphertext: b64url(canonicalKeccak({ contentKey, recipient })) })),
      submittedAt: this.ctx.clock.now(),
    };
    const signed = await this.sign(seller, { ...body, type: 'Delivery' as const });
    if (!(await this.verified(seller, 'deliver', via, signed, this.address(seller)))) return;
    const message: Delivery = { ...body, signature: signed.signature };
    const event: EscrowEvent = { type: 'deliver', at: this.ctx.clock.now(), delivery: message };
    if (!this.transition(seller, 'deliver', via, step(c.state, event), event)) return;
    this.delivery = { message, plaintext, source, contentKey };
    this.emit('delivery.submitted', seller, via, { attempt: 1, plaintextSha256 });
    this.receipt(via, 'deliver');
    this.row(seller, 'deliver (attempt 1)', via, 'ok');
  }

  private async judge(name: string): Promise<void> {
    const call = 'decide';
    const c = this.needCommitment(name, call, 'direct');
    if (!c) return;
    const actor = this.actor(name);
    const role = actor.role === 'fallback' ? 'fallback' : actor.role === 'appeal' ? 'appeal' : 'primary';
    if (!this.delivery || !this.seed) {
      return this.refuse(name, call, 'direct', problem('invalid_state', `nothing to judge in ${c.state.kind}`));
    }
    const d = this.delivery;
    // ADR-0018: the primary reveals its committed seed; the fallback and appeal adjudicators take the beacon
    // seed for the round the state fixes. The sim beacon is keccak256(simSeed || round), as on SimChain.
    const round = role === 'primary' ? null : beaconRoundFor(c.state, role);
    const beacon = round === null ? null : { round, value: keccak256(encodePacked(['bytes32', 'uint64'], [keccak256(stringToBytes(`holdback/sim-beacon/v0/${this.ctx.seed}`)), BigInt(round)])) };
    const seed = role === 'primary' ? this.seed : beacon ? panelSeed(c.id, role, d.message.attempt, beacon.value) : this.ctx.rng.hex32();
    const view = stubJudgment(
      {
        scenario: this.scenario.name,
        adjudicator: name,
        role,
        terms: c.terms,
        commitmentId: c.id,
        attempt: d.message.attempt,
        plaintextSha256: d.message.plaintextSha256,
        plaintextVerified: sha256(d.plaintext) === d.message.plaintextSha256,
        mime: d.message.plaintextMime,
        bytes: d.plaintext.length,
        source: d.source,
        seed,
        seedCommitment: role === 'primary' ? keccak256(this.seed) : null,
      },
      this.judges,
    );
    this.judgments.push(view);
    const outcome = view.aggregate.decision;
    const unsigned = {
      type: 'Decision',
      commitmentId: c.id,
      attempt: d.message.attempt,
      adjudicator: actor.address,
      role,
      outcome,
      seed,
      policyHash: c.terms.adjudication.policyHash,
      registryHash: c.terms.adjudication.registryHash,
      judgmentRecordHash: canonicalKeccak(view),
      nonce: this.ctx.rng.hex32(),
      expiresAt: role === 'fallback' ? c.terms.timing.fallbackBy : c.terms.timing.judgeBy,
      ...(outcome === 'accept' ? { keyForBuyer: { scheme: 'x25519-xsalsa20poly1305', ciphertext: b64url(canonicalKeccak({ contentKey: d.contentKey, recipient: c.terms.buyer })) } } : {}),
    } as const;
    const decision = await this.sign(name, unsigned as UnsignedMessage & { type: 'Decision' });
    if (!(await this.verified(name, `${call}: ${outcome}`, 'direct', decision, actor.address))) return;
    const event: EscrowEvent = { type: 'decide', at: this.ctx.clock.now(), message: decision as Decision, beacon };
    if (!this.transition(name, `${call}: ${outcome}`, 'direct', step(c.state, event), event)) return;
    this.decision = decision as Decision;
    this.emit('judgment.decided', name, 'direct', { outcome, judgmentRecordHash: decision.judgmentRecordHash });

    const price = BigInt(c.terms.price.amount);
    const fee = BigInt(c.terms.adjudication.fee.amount);
    const next = this.state!;
    if (next.kind === 'Released') {
      this.move(ESCROW, this.scenario.parties.seller, price);
      this.move(ESCROW, name, fee);
      this.emit('settlement.released', name, 'direct', { amount: price.toString() });
      this.emit('key.released', name, 'direct', {});
    } else if (next.kind === 'Refunded') {
      this.move(ESCROW, this.scenario.parties.buyer, price);
      this.move(ESCROW, name, fee);
      this.emit('settlement.refunded', name, 'direct', { amount: price.toString() });
    }
    this.row(name, `${call}: ${outcome}`, 'direct', 'ok');
    if (next.kind === 'Released' || next.kind === 'Refunded') this.balanceRows.push({ after: `decide: ${outcome}`, balances: this.snapshotBalances() });
  }

  /** Permissionless timeouts. Each records an outage for the actor it acts in place of. */
  private timeout(kind: 'trigger_fallback' | 'trigger_default' | 'apply_default_outcome' | 'expire', via: string): void {
    const c = this.needCommitment('anyone', kind, via);
    if (!c) return;
    const { parties, adjudicators } = this.scenario;
    const before = c.state;
    const event = { type: kind, at: this.ctx.clock.now() } as EscrowEvent;
    if (!this.transition('anyone', kind, via, step(before, event), event)) return;
    const bypassed =
      kind === 'trigger_fallback'
        ? adjudicators.primary
        : kind === 'trigger_default'
          ? before.kind === 'Escalated'
            ? adjudicators.appeal
            : adjudicators.fallback
          : kind === 'expire'
            ? before.kind === 'Offered'
              ? adjudicators.primary
              : parties.buyer
            : null;
    if (bypassed) this.outages.push({ step: this.stepNo, actor: bypassed, kind: 'timeout' });
    const types = { trigger_fallback: 'fallback.triggered', trigger_default: 'default.triggered', apply_default_outcome: 'settlement.refunded', expire: 'offer.expired' } as const;
    if (kind === 'apply_default_outcome') {
      // The default outcome refunds the buyer in full. Seller compensation from the adjudicators' bonds is a T-006 posting.
      this.move(ESCROW, parties.buyer, this.balances.get(ESCROW)!);
    }
    this.emit(types[kind], 'anyone', via, {});
    this.receipt(via, kind);
    this.row('anyone', kind, via, 'ok');
    if (kind === 'apply_default_outcome') this.balanceRows.push({ after: 'apply_default_outcome', balances: this.snapshotBalances() });
  }

  private settle(who: string, via: string): void {
    const c = this.needCommitment(who, 'settle', via);
    if (!c) return;
    if (c.state.kind === 'Released' || c.state.kind === 'Refunded') {
      this.receipt(via, 'settle');
      return this.row(who, 'settle', via, 'ok (no-op: guaranteed_on_decision settled at the decision)');
    }
    this.refuse(who, 'settle', via, problem('invalid_state', `nothing to settle in ${c.state.kind}`));
  }

  private reclaim(buyer: string, via: string): void {
    const c = this.needCommitment(buyer, 'reclaim', via);
    if (!c) return;
    const event: EscrowEvent = { type: 'reclaim', at: this.ctx.clock.now() };
    if (!this.transition(buyer, 'reclaim', via, step(c.state, event), event)) return;
    const held = this.balances.get(ESCROW)!;
    this.move(ESCROW, buyer, held);
    this.outages.push({ step: this.stepNo, actor: this.scenario.parties.seller, kind: 'timeout' });
    this.emit('settlement.reclaimed', buyer, via, { amount: held.toString() });
    this.receipt(via, 'reclaim');
    this.row(buyer, 'reclaim', via, 'ok');
    this.balanceRows.push({ after: 'reclaim', balances: this.snapshotBalances() });
  }

  private verifyKeyRelease(buyer: string, via: string): void {
    const call = 'fetch key + verify plaintext hash';
    const c = this.needCommitment(buyer, call, via);
    if (!c) return;
    const key = this.decision?.keyForBuyer;
    if (c.state.kind !== 'Released' || !key || !this.delivery) {
      return this.refuse(buyer, call, via, problem('invalid_state', `no key was released to the buyer in ${c.state.kind}`));
    }
    const expected = b64url(canonicalKeccak({ contentKey: this.delivery.contentKey, recipient: c.terms.buyer }));
    const matches = key.ciphertext === expected && sha256(this.delivery.plaintext) === this.delivery.message.plaintextSha256;
    this.receipt(via, 'fetch_key');
    if (!matches) return this.refuse(buyer, call, via, problem('invalid_state', 'released key does not open the delivered plaintext'));
    this.row(buyer, call, via, 'hash matches');
  }

  // ---- results -------------------------------------------------------------------------------

  private replay(): { ok: boolean; events: number } {
    if (!this.offerInput || !this.state) return { ok: this.state === null, events: 0 };
    const start = offer(this.offerInput);
    if (!start.ok) return { ok: false, events: 0 };
    let s: EscrowState = start.value;
    for (const e of this.applied) {
      const r = step(s, e);
      if (!r.ok) return { ok: false, events: this.applied.length };
      s = r.value;
    }
    return { ok: canonicalJson(s) === canonicalJson(this.state), events: this.applied.length };
  }

  private invariants(replay: { ok: boolean }): Invariant[] {
    const st = this.state;
    return checkInvariants({
      balances: this.snapshotBalances(),
      faucetTotal: this.faucetTotal,
      events: this.events,
      finalState: st?.kind ?? null,
      releasedByDecision: st?.kind === 'Released' && st.via.kind !== 'early_accept',
      keyForBuyer: !!this.decision?.keyForBuyer,
      replayOk: replay.ok,
    });
  }

  private result(): StubRun {
    const replay = this.replay();
    const { parties, adjudicators, operators } = this.scenario;
    const ordered = [parties.buyer, ESCROW, parties.seller, adjudicators.primary, adjudicators.fallback, adjudicators.appeal, ...operators];
    const touched = (name: string) => this.balanceRows.some((r) => (r.balances[name] ?? 0n) !== 0n) || name === ESCROW;
    const state = this.state;
    return {
      actors: this.actors,
      accounts: ordered.filter(touched),
      commitment: this.terms && this.id ? { id: this.id, terms: this.terms } : null,
      rulebookHash: rulebookHash(STUB_RULEBOOK),
      rows: this.rows,
      balanceRows: this.balanceRows,
      judgments: this.judgments,
      events: this.events.map((e) => ({ seq: e.seq, step: e.step, type: e.type, hash: e.hash })),
      receipts: this.receipts,
      replay,
      invariants: this.invariants(replay),
      states: this.states,
      finalState: state?.kind ?? null,
      problems: this.problems,
      outages: this.outages,
      autoAccepted: state?.kind === 'Released' && state.via.kind === 'first_instance' && state.via.decision.outcome === 'accept',
      balances: this.snapshotBalances(),
    };
  }
}

