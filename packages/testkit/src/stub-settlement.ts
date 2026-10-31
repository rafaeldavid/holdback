// The fixture driver: turns scenario steps into the signed messages each actor would send and submits them
// to SimChain (T-006), which verifies every signature, runs @holdback/core's `step`, and owns the ledger,
// bond pools and the hash-chained event log. Signing keys are derived from the fixture seed and actor name.
// The class keeps its T-005 name. A scenario's club and terms files are loaded when they exist
// (fixture-files.ts); otherwise the built-in stub rulebook and terms stand in. The policy and registry hashes
// and the judgment panel are still the stub's until T-009.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  beaconRoundFor,
  canonicalKeccak,
  commitmentId as commitmentIdOf,
  holdbackDomain,
  panelSeed,
  problem,
  rulebookHash,
  signMessage,
  signTerms,
  type Address,
  type Club,
  type CommitmentTerms,
  type Decision,
  type Delivery,
  type EscrowState,
  type EscrowStateKind,
  type Hex32,
  type Mandate,
  type Problem,
  type Scope,
  type SettlementEventType,
  type Sha256,
  type Timestamp,
  type UnsignedMessage,
} from '@holdback/core';
import type { Submission, TimeoutKind } from '@holdback/settlement';
import { account, SimChain, type Genesis } from '@holdback/settlement/sim';
import { keccak256, stringToBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { SimContext } from './context.js';
import { loadClubFile, loadTermsFile, termsFromTemplate, type TermsTemplate } from './fixture-files.js';
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
  /** Whether the scenario's club and terms files were loaded (true) or the built-in stubs stood in. */
  loaded: { club: boolean; terms: boolean };
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
  // Envelopes for adjudicators are released too (ADR-0020), so look for a key release in the paying step.
  const key = released && v.events.find((e) => e.type === 'key.released' && e.step === released.step);
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

const TIMEOUTS: Record<'trigger_fallback' | 'trigger_default' | 'apply_default_outcome' | 'expire', TimeoutKind> = {
  trigger_fallback: 'fallback',
  trigger_default: 'default',
  apply_default_outcome: 'apply_default',
  expire: 'expire_offer',
};

const wholeSecond = (ts: Timestamp): Timestamp => new Date(Math.floor(Date.parse(ts) / 1000) * 1000).toISOString().replace('.000Z', 'Z');

export class StubSettlement {
  private readonly domain = holdbackDomain(SIM_CHAIN_ID);
  private readonly keys = new Map<string, Hex>();
  private readonly actors: Actor[] = [];
  private readonly faucetTotal: bigint;
  private readonly rows: TimelineRow[] = [];
  private readonly balanceRows: StubRun['balanceRows'] = [];
  private readonly judgments: JudgmentView[] = [];
  /** The step that emitted each event, by sequence number. */
  private readonly eventSteps: number[] = [];
  private readonly receipts: Receipt[] = [];
  private readonly problems: StepProblem[] = [];
  private readonly outages: Outage[] = [];
  private readonly offline = new Set<string>();
  private readonly refusingOperators = new Set<string>();
  private readonly states: EscrowStateKind[] = [];

  private club: Club | null = null;
  private loadedClub = false;
  private template: TermsTemplate | null = null;
  private chain: SimChain | null = null;
  private genesis: Genesis | null = null;
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
    let total = 0n;
    for (const amount of Object.values(scenario.faucet)) total += BigInt(amount);
    this.faucetTotal = total;
  }

  /** Genesis: faucet amounts become party balances, or junior bond for adjudicators; mandates for the parties. */
  private async start(): Promise<SimChain> {
    const { scenario, ctx } = this;
    const at = wholeSecond(ctx.clock.now());
    const isAdjudicator = (name: string) => ['primary', 'fallback', 'appeal'].includes(this.actor(name).role);
    const balances: Record<Address, string> = {};
    const bonds: Record<Address, { junior: string; senior: string }> = {};
    for (const [who, amount] of Object.entries(scenario.faucet)) {
      const a = this.address(who);
      if (isAdjudicator(who)) bonds[a] = { junior: amount, senior: '0' };
      else balances[a] = amount;
    }
    const operator = privateKeyToAccount(testKey(ctx.seed, 'club-operator')).address;
    const club: Club = this.club ?? { id: STUB_CLUB_ID, name: 'Stub club', operator, rulebook: STUB_RULEBOOK, rulebookHash: rulebookHash(STUB_RULEBOOK) };
    this.club = club;
    const mandates: Mandate[] = [];
    for (const name of [scenario.parties.buyer, scenario.parties.seller]) {
      const principalKey = testKey(ctx.seed, `${name}/principal`);
      const body = {
        principal: privateKeyToAccount(principalKey).address,
        agent: this.address(name),
        clubId: club.id,
        scope: { roles: ['buyer', 'seller'], maxPerCommitment: MAX_SCOPE, maxDaily: MAX_SCOPE, expiresAt: plus(at, 365 * DAY) } as Scope,
        nonce: keccak256(stringToBytes(`mandate/${name}`)),
        issuedAt: at,
      };
      const signature = await signMessage(principalKey, this.domain, { ...body, type: 'Mandate' });
      mandates.push({ ...body, signature });
    }
    this.genesis = {
      start: at,
      // The sim beacon seed is public and derived from the fixture seed (ADR-0018).
      simSeed: keccak256(stringToBytes(`holdback/sim-beacon/v0/${ctx.seed}`)),
      chainId: SIM_CHAIN_ID,
      token: TOKEN,
      clubs: [club],
      mandates,
      members: [],
      balances,
      bonds,
    };
    return new SimChain(this.genesis);
  }

  async run(): Promise<StubRun> {
    const { scenario, root } = this;
    if (scenario.pragmas.mode !== 'guaranteed_on_decision') {
      throw new ScenarioError(`@mode ${scenario.pragmas.mode}: Phase 1 supports guaranteed_on_decision only (ADR-0007)`);
    }
    // A named file that exists is loaded and validated, never ignored; a named file that is absent falls back
    // to the built-in stub, and the snapshot says which.
    if (scenario.club !== undefined && existsSync(join(root, scenario.club))) {
      this.club = loadClubFile(join(root, scenario.club));
      this.loadedClub = true;
    }
    if (scenario.terms !== undefined && existsSync(join(root, scenario.terms))) this.template = loadTermsFile(join(root, scenario.terms));
    this.chain = await this.start();
    this.balanceRows.push({ after: 'faucet', balances: this.snapshotBalances() });
    for (const s of scenario.steps) {
      this.stepNo++;
      this.signerOverride = 'signer' in s ? s.signer : undefined;
      await this.runStep(s);
    }
    return this.result();
  }

  // ---- helpers -------------------------------------------------------------------------------

  private get sim(): SimChain {
    if (!this.chain) throw new Error('SimChain not started');
    return this.chain;
  }

  private get state(): EscrowState | null {
    return this.id ? this.sim.escrowState(this.id) : null;
  }

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

  /** Balances by actor name: own balance plus bond (junior and senior) for adjudicators, and the escrow. */
  private snapshotBalances(): Record<string, bigint> {
    const ledger = this.sim.ledger();
    const out: Record<string, bigint> = {};
    for (const a of this.actors) {
      out[a.name] = (ledger[account.party(a.address)] ?? 0n) + (ledger[account.junior(a.address)] ?? 0n) + (ledger[account.senior(a.address)] ?? 0n);
    }
    out[ESCROW] = this.id ? (ledger[account.escrow(this.id)] ?? 0n) : 0n;
    return out;
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

  /** Submits to SimChain at the scenario clock's time, or records the refusal. Returns true when it applied. */
  private async submit(actor: string, call: string, via: string, submission: Submission): Promise<boolean> {
    this.sim.advanceTo(this.ctx.clock.now());
    const r = await this.sim.submit(submission, { via });
    if (!r.ok) {
      this.refuse(actor, call, via, r.problem);
      return false;
    }
    this.eventSteps.push(...r.events.map(() => this.stepNo));
    if (this.states.at(-1) !== r.state.escrowState) this.states.push(r.state.escrowState);
    return true;
  }

  private needCommitment(actor: string, call: string, via: string): { terms: CommitmentTerms; id: Hex32; state: EscrowState } | null {
    const state = this.state;
    if (!state || !this.terms || !this.id) {
      this.refuse(actor, call, via, problem('invalid_state', `${call} needs a commitment; none was offered`));
      return null;
    }
    return { terms: this.terms, id: this.id, state };
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
    const terms: CommitmentTerms = this.template
      ? termsFromTemplate(this.template, {
          club: this.club!,
          buyer: this.address(this.scenario.parties.buyer),
          seller: this.address(seller),
          adjudicator: this.address(adjudicators.primary),
          fallbackAdjudicator: this.address(adjudicators.fallback),
          appealAdjudicator: this.address(adjudicators.appeal),
          registryHash: STUB_REGISTRY_HASH,
          policyHash: STUB_POLICY_HASH,
          buyerEncryptionPublicKey: b64url(this.ctx.rng.hex32()),
          nonce: this.ctx.rng.hex32(),
          createdAt: wholeSecond(now),
        })
      : this.stubTerms(seller, now);
    const signature = await signTerms(this.keyFor(seller), this.domain, terms);
    const id = commitmentIdOf(terms);
    if (await this.submit(seller, 'offer', via, { kind: 'offer', commitment: { ...terms, id, signatures: { seller: signature } } })) {
      this.terms = terms;
      this.id = id;
      // The first state is recorded after the ID is known.
      if (this.states.at(-1) !== 'Offered') this.states.push('Offered');
      this.receipt(via, 'offer');
      this.row(seller, 'offer', via, 'ok');
    }
  }

  private stubTerms(seller: string, now: Timestamp): CommitmentTerms {
    const { adjudicators } = this.scenario;
    return {
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
    if (await this.submit(name, call, via, { kind: 'adjudicator_accept', message })) {
      this.seed = seed;
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
    if (!(await this.submit(buyer, 'agree', via, { kind: 'agree', message: agree }))) return;
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
    if (!(await this.submit(buyer, 'fund', via, { kind: 'fund', message: funding }))) return;
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
    const message: Delivery = { ...body, signature: signed.signature };
    if (!(await this.submit(seller, 'deliver', via, { kind: 'deliver', delivery: message }))) return;
    this.delivery = { message, plaintext, source, contentKey };
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
    // ADR-0018: the primary reveals its committed seed; the fallback and appeal adjudicators take the
    // SimChain beacon seed for the round the state fixes. Before that round is published they have none.
    this.sim.advanceTo(this.ctx.clock.now());
    const round = role === 'primary' ? null : beaconRoundFor(c.state, role);
    const beaconValue = round === null ? null : this.sim.beacon(round);
    const seed = role === 'primary' ? this.seed : beaconValue ? panelSeed(c.id, role, d.message.attempt, beaconValue) : this.ctx.rng.hex32();
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
    const envelope = (recipient: Address) => ({ scheme: 'x25519-xsalsa20poly1305' as const, ciphertext: b64url(canonicalKeccak({ contentKey: d.contentKey, recipient })) });
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
      ...(outcome === 'accept' ? { keyForBuyer: envelope(c.terms.buyer) } : {}),
      // ADR-0020: an escalation carries the appeal adjudicator's content key.
      ...(outcome === 'escalate' ? { encryptedKeys: [{ recipient: c.terms.adjudication.appealAdjudicator, ...envelope(c.terms.adjudication.appealAdjudicator) }] } : {}),
    } as const;
    const decision = (await this.sign(name, unsigned as UnsignedMessage & { type: 'Decision' })) as Decision;
    if (!(await this.submit(name, `${call}: ${outcome}`, 'direct', { kind: 'decide', message: decision }))) return;
    this.decision = decision;
    const next = this.state!;
    this.row(name, `${call}: ${outcome}`, 'direct', 'ok');
    if (next.kind === 'Released' || next.kind === 'Refunded') this.balanceRows.push({ after: `decide: ${outcome}`, balances: this.snapshotBalances() });
  }

  /** Permissionless timeouts. Each records an outage for the actor it acts in place of. */
  private async timeout(kind: 'trigger_fallback' | 'trigger_default' | 'apply_default_outcome' | 'expire', via: string): Promise<void> {
    const c = this.needCommitment('anyone', kind, via);
    if (!c) return;
    const { parties, adjudicators } = this.scenario;
    const before = c.state;
    if (!(await this.submit('anyone', kind, via, { kind: 'trigger', commitmentId: c.id, timeout: TIMEOUTS[kind] }))) return;
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

  private async reclaim(buyer: string, via: string): Promise<void> {
    const c = this.needCommitment(buyer, 'reclaim', via);
    if (!c) return;
    if (!(await this.submit(buyer, 'reclaim', via, { kind: 'trigger', commitmentId: c.id, timeout: 'reclaim' }))) return;
    this.outages.push({ step: this.stepNo, actor: this.scenario.parties.seller, kind: 'timeout' });
    this.receipt(via, 'reclaim');
    this.row(buyer, 'reclaim', via, 'ok');
    this.balanceRows.push({ after: 'reclaim', balances: this.snapshotBalances() });
  }

  private async verifyKeyRelease(buyer: string, via: string): Promise<void> {
    const call = 'fetch key + verify plaintext hash';
    const c = this.needCommitment(buyer, call, via);
    if (!c) return;
    const released = await this.sim.keysFor(c.id, c.terms.buyer);
    if (c.state.kind !== 'Released' || released.length === 0 || !this.delivery) {
      return this.refuse(buyer, call, via, problem('invalid_state', `no key was released to the buyer in ${c.state.kind}`));
    }
    const expected = b64url(canonicalKeccak({ contentKey: this.delivery.contentKey, recipient: c.terms.buyer }));
    const matches = released.some((k) => k.ciphertext === expected) && sha256(this.delivery.plaintext) === this.delivery.message.plaintextSha256;
    this.receipt(via, 'fetch_key');
    if (!matches) return this.refuse(buyer, call, via, problem('invalid_state', 'released key does not open the delivered plaintext'));
    this.row(buyer, call, via, 'hash matches');
  }

  // ---- results -------------------------------------------------------------------------------

  private events(): Array<LedgerEvent & { prevHash: Hex32 }> {
    return this.sim.log().map((e) => ({ seq: e.seq, step: this.eventSteps[e.seq] ?? 0, type: e.type as SettlementEventType, hash: e.hash, prevHash: e.prevHash }));
  }

  /** Replays SimChain's journal from genesis; the replay must reproduce the same state digest. */
  private async replay(): Promise<{ ok: boolean; events: number }> {
    const journal = this.sim.journal();
    const submits = journal.filter((e) => e.op === 'submit').length;
    try {
      const again = await SimChain.replay(this.genesis!, journal);
      return { ok: again.digest() === this.sim.digest() && SimChain.verifyLog(this.sim.log()), events: submits };
    } catch {
      return { ok: false, events: submits };
    }
  }

  private invariants(replay: { ok: boolean }): Invariant[] {
    const st = this.state;
    return checkInvariants({
      balances: this.snapshotBalances(),
      faucetTotal: this.faucetTotal,
      events: this.events(),
      finalState: st?.kind ?? null,
      releasedByDecision: st?.kind === 'Released' && st.via.kind !== 'early_accept',
      keyForBuyer: !!this.decision?.keyForBuyer,
      replayOk: replay.ok,
    });
  }

  private async result(): Promise<StubRun> {
    const replay = await this.replay();
    const { parties, adjudicators, operators } = this.scenario;
    const ordered = [parties.buyer, ESCROW, parties.seller, adjudicators.primary, adjudicators.fallback, adjudicators.appeal, ...operators];
    const touched = (name: string) => this.balanceRows.some((r) => (r.balances[name] ?? 0n) !== 0n) || name === ESCROW;
    const state = this.state;
    return {
      actors: this.actors,
      accounts: ordered.filter(touched),
      commitment: this.terms && this.id ? { id: this.id, terms: this.terms } : null,
      rulebookHash: this.club?.rulebookHash ?? rulebookHash(STUB_RULEBOOK),
      loaded: { club: this.loadedClub, terms: this.template !== null },
      rows: this.rows,
      balanceRows: this.balanceRows,
      judgments: this.judgments,
      events: this.events().map((e) => ({ seq: e.seq, step: e.step, type: e.type, hash: e.hash })),
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
