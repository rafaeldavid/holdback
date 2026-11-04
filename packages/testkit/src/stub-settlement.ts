// The fixture driver: turns scenario steps into the signed messages each actor would send and submits them
// to SimChain, which verifies every signature, runs @holdback/core's `step`, and owns the ledger, bond pools
// and the hash-chained event log (or to the contracts on a local anvil; see DriverBackend). Signing keys are
// derived from the fixture seed and actor name. A scenario's club and terms files are loaded when they exist
// (fixture-files.ts); otherwise the built-in rulebook and terms in stub-terms.ts apply. The registry
// (config/judges.yaml) and the policy come from judges-config.ts; judgment.ts draws the panel.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  beaconRoundFor,
  canonicalKeccak,
  commitmentId as commitmentIdOf,
  deliveryHash,
  holdbackDomain,
  panelSeed,
  policyHash,
  problem,
  rulebookHash,
  signMessage,
  signTerms,
  wholeSecond,
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
  type Timestamp,
  type TokenAmount,
  type UnsignedMessage,
} from '@holdback/core';
import { sha256 } from '@holdback/core/crypto';
import type { Submission, TimeoutKind } from '@holdback/settlement';
import { EvmSettlement, rebindToken, type EvmWorld } from '@holdback/settlement/evm';
import { account, b64url, SimChain, tusd, type Genesis } from '@holdback/settlement/sim';
import { keccak256, stringToBytes, type Hex } from 'viem';
import { privateKeyToAccount, sign as signDigest } from 'viem/accounts';
import type { SimContext } from './context.js';
import { loadClubFile, loadTermsFile, termsFromTemplate, type TermsTemplate } from './fixture-files.js';
import type { AdjudicatorPolicy } from '@holdback/core';
import type { LoadedRegistry } from '@holdback/judgment';
import { loadJudgeRegistry, runnerPolicy } from './judges-config.js';
import { runJudgment, type JudgmentView } from './judgment.js';
import type { Outage, StepProblem } from './prefix.js';
import type { JudgeProvider } from './recorded.js';
import type { Scenario, Step, Tamper } from './scenario.js';
import { ScenarioError } from './scenario.js';
import {
  SIM_CHAIN_ID,
  STUB_ACCEPTANCE,
  STUB_CLUB_ID,
  STUB_DELIVERABLE,
  STUB_FEE,
  STUB_PRICE,
  STUB_RULEBOOK,
  TOKEN,
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
  commitmentId?: Hex32;
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
  /** Commitments 2 and up, when a scenario drives more than one. */
  others: Array<{ n: number; id: Hex32; finalState: EscrowStateKind }>;
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
const APPEAL_HOLD = 'appeal-hold';

/** One commitment the scenario drives. */
interface Slot {
  terms: CommitmentTerms | null;
  id: Hex32 | null;
  seed: Hex32 | null;
  delivery: { message: Delivery; plaintext: Uint8Array; source: string; contentKey: Hex32 } | null;
  decision: Decision | null;
}
const GENESIS: Hex32 = `0x${'00'.repeat(32)}`;
/** What an early accept names before any delivery: no delivery, which settlement refuses (ADR-0029). */
const ZERO32: Hex32 = `0x${'00'.repeat(32)}`;

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
  /**
   * With more than one commitment: the escrow left in the commitments that reached a terminal state. Absent,
   * the escrow balance and finalState stand for the single commitment.
   */
  escrowOfSettled?: { settled: boolean; amount: bigint };
}

const SETTLED_STATES: readonly EscrowStateKind[] = ['Released', 'Refunded', 'Settled'];

/** The ledger invariants every snapshot reports. Pure, so tests can feed it deliberately broken ledgers. */
export function checkInvariants(v: LedgerView): Invariant[] {
  const values = Object.values(v.balances);
  const total = values.reduce((a, b) => a + b, 0n);
  // Settled once per commitment: events without a commitment ID count as one commitment.
  const perCommitment = new Map<string, number>();
  for (const e of v.events) if (e.type.startsWith('settlement.') || e.type === 'commitment.settled') perCommitment.set(e.commitmentId ?? '', (perCommitment.get(e.commitmentId ?? '') ?? 0) + 1);
  const settled = v.escrowOfSettled ? v.escrowOfSettled.settled : v.finalState !== null && SETTLED_STATES.includes(v.finalState);
  const leftInEscrow = v.escrowOfSettled ? v.escrowOfSettled.amount : (v.balances[ESCROW] ?? 0n);
  const released = v.events.find((e) => e.type === 'settlement.released');
  // Envelopes for adjudicators are released too (ADR-0020), so look for a key release in the paying step.
  const key = released && v.events.find((e) => e.type === 'key.released' && e.step === released.step);
  const chain = v.events.every((e, i) => e.seq === i && e.prevHash === (i === 0 ? GENESIS : v.events[i - 1]!.hash));
  return [
    { name: 'conservation', ok: total === v.faucetTotal },
    { name: 'no negative balances', ok: values.every((x) => x >= 0n) },
    { name: 'settled once', ok: [...perCommitment.values()].every((n) => n <= 1) },
    settled ? { name: 'escrow empty after settlement', ok: leftInEscrow === 0n } : { name: 'escrow empty after settlement', ok: true, note: 'n/a' },
    v.releasedByDecision
      ? { name: 'key released atomically with payment', ok: !!released && !!key && released.step === key.step && v.keyForBuyer }
      : { name: 'key released atomically with payment', ok: true, note: 'n/a' },
    { name: 'event hash chain links', ok: chain },
    { name: 'replay matches the settlement state', ok: v.replayOk },
  ];
}
const DAY = 86_400;
const MAX_SCOPE = tusd('1000000000000000');

const plus = (ts: Timestamp, seconds: number): Timestamp => new Date(Date.parse(ts) + seconds * 1000).toISOString();

type Signed<T extends UnsignedMessage> = T & { signature: Hex };

/** Test keys derived from the public fixture seed and the actor name. They guard no value. */
function testKey(seed: number, name: string): Hex {
  return keccak256(stringToBytes(`holdback/testkit/v0/${seed}/${name}`));
}

type TimeoutStep = 'trigger_fallback' | 'trigger_default' | 'apply_default_outcome' | 'expire' | 'expire_appeal';

const TIMEOUTS: Record<TimeoutStep, TimeoutKind> = {
  trigger_fallback: 'fallback',
  trigger_default: 'default',
  apply_default_outcome: 'apply_default',
  expire: 'expire_offer',
  expire_appeal: 'appeal_expiry',
};

/** Which settlement layer the fixture drives: SimChain in process, or the Holdback contracts on a local anvil. */
export type DriverBackend = { kind: 'sim' } | { kind: 'local'; world: EvmWorld; judgments?: ReadonlyMap<string, JudgmentView> };

export class StubSettlement {
  private readonly domain;
  /** The token identifier on this backend: tUSD on SimChain, the deployed ERC-20's address on EVM. */
  private readonly token: string;
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
  private chain: SimChain | EvmSettlement | null = null;
  private genesis: Genesis | null = null;
  /** Commitments by number (a step's `commitment:`, default 1). Steps act on the current one. */
  private readonly slots = new Map<number, Slot>();
  private current = 1;
  /** One judgment per commitment|role|attempt: a panel is never re-rolled. */
  private readonly judged = new Map<string, JudgmentView>();
  /** The same judgments keyed by commitment number, role and attempt, which do not depend on the backend. */
  private readonly judgedBySlot = new Map<string, JudgmentView>();
  private registryCache: LoadedRegistry | null = null;
  private stepNo = 0;
  private signerOverride: string | undefined;
  /** The current step's deliberate message faults (scenario `tamper:`). */
  private tampers = new Set<Tamper>();
  /** The faults the current step actually put into a signed message. */
  private applied = new Set<Tamper>();
  /** Each signer's last nonce, per scope: offers' terms nonces, and every other signed message's. */
  private readonly lastNonce = new Map<string, Hex32>();

  constructor(
    private readonly ctx: SimContext,
    private readonly scenario: Scenario,
    private readonly judges: JudgeProvider,
    private readonly root: string,
    private readonly backend: DriverBackend = { kind: 'sim' },
  ) {
    if (backend.kind === 'local') {
      this.domain = holdbackDomain(backend.world.chainId, backend.world.deployment.rules);
      this.token = backend.world.deployment.token.toLowerCase();
    } else {
      this.domain = holdbackDomain(SIM_CHAIN_ID);
      this.token = TOKEN;
    }
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
  private async start(): Promise<SimChain | EvmSettlement> {
    const { scenario, ctx } = this;
    const at = wholeSecond(Date.parse(ctx.clock.now()));
    const isAdjudicator = (name: string) => ['primary', 'fallback', 'appeal'].includes(this.actor(name).role);
    const balances: Record<Address, string> = {};
    const bonds: Record<Address, { junior: string; senior: string }> = {};
    for (const [who, amount] of Object.entries(scenario.faucet)) {
      const a = this.address(who);
      if (isAdjudicator(who)) bonds[a] = { junior: amount, senior: '0' };
      else balances[a] = amount;
    }
    const operator = privateKeyToAccount(testKey(ctx.seed, 'club-operator')).address;
    const base: Club = this.club ?? { id: STUB_CLUB_ID, name: 'Stub club', operator, rulebook: STUB_RULEBOOK, rulebookHash: rulebookHash(STUB_RULEBOOK) };
    const rulebook = rebindToken(base.rulebook, TOKEN, this.token);
    const club: Club = this.token === TOKEN ? base : { ...base, rulebook, rulebookHash: rulebookHash(rulebook) };
    this.club = club;
    const mandates: Mandate[] = [];
    for (const name of [scenario.parties.buyer, scenario.parties.seller]) {
      const principalKey = testKey(ctx.seed, `${name}/principal`);
      const body = {
        principal: privateKeyToAccount(principalKey).address,
        agent: this.address(name),
        clubId: club.id,
        scope: { roles: ['buyer', 'seller'], maxPerCommitment: this.money(MAX_SCOPE.amount), maxDaily: this.money(MAX_SCOPE.amount), expiresAt: plus(at, 365 * DAY) } as Scope,
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
      token: this.token,
      clubs: [club],
      mandates,
      members: [],
      balances,
      bonds,
    };
    if (this.backend.kind === 'local') return EvmSettlement.create(this.backend.world, this.genesis, this.actors.map((a) => a.address));
    return new SimChain(this.genesis);
  }

  /** An amount in this backend's token. */
  private money(amount: string | bigint): TokenAmount {
    return { ...tusd(amount), token: this.token };
  }

  private get evm(): EvmSettlement | null {
    return this.chain instanceof EvmSettlement ? this.chain : null;
  }

  /**
   * Who pays gas on EVM (the escape hatch, ADR-0005): the relaying operator's key, or for a direct call the acting
   * agent's own key; a permissionless trigger with no named agent comes from an unrelated account.
   */
  private sender(actor: string, via: string): Hex | undefined {
    if (this.backend.kind !== 'local') return undefined;
    if (via !== 'direct') return this.keys.get(via);
    return this.keys.get(actor) ?? this.keys.get(actor.split(' + ')[0]!) ?? testKey(this.ctx.seed, 'anyone');
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
    if (scenario.terms !== undefined && existsSync(join(root, scenario.terms))) this.template = rebindToken(loadTermsFile(join(root, scenario.terms)), TOKEN, this.token);
    this.chain = await this.start();
    this.balanceRows.push({ after: 'faucet', balances: await this.snapshotBalances() });
    for (const s of scenario.steps) {
      this.stepNo++;
      this.signerOverride = 'signer' in s ? s.signer : undefined;
      this.current = s.commitment ?? 1;
      this.tampers = new Set(s.tamper ?? []);
      this.applied = new Set();
      await this.runStep(s);
      // A fault the step never put into a signed message would let an error. fixture pass for the wrong reason.
      const unapplied = [...this.tampers].filter((t) => !this.applied.has(t));
      if (unapplied.length) {
        throw new ScenarioError(
          `steps[${this.stepNo}].${s.kind}: tamper ${unapplied.join(', ')} was never applied (the step signed no such message${unapplied.includes('reuse_nonce') ? ', or the signer had no earlier nonce to reuse' : ''})`,
        );
      }
    }
    this.current = 1;
    return this.result();
  }

  // Helpers

  private get slot(): Slot {
    let s = this.slots.get(this.current);
    if (!s) {
      s = { terms: null, id: null, seed: null, delivery: null, decision: null };
      this.slots.set(this.current, s);
    }
    return s;
  }
  private get terms(): CommitmentTerms | null {
    return this.slot.terms;
  }
  private set terms(v: CommitmentTerms | null) {
    this.slot.terms = v;
  }
  private get id(): Hex32 | null {
    return this.slot.id;
  }
  private set id(v: Hex32 | null) {
    this.slot.id = v;
  }
  private get seed(): Hex32 | null {
    return this.slot.seed;
  }
  private set seed(v: Hex32 | null) {
    this.slot.seed = v;
  }
  private get delivery(): Slot['delivery'] {
    return this.slot.delivery;
  }
  private set delivery(v: Slot['delivery']) {
    this.slot.delivery = v;
  }
  private get decision(): Decision | null {
    return this.slot.decision;
  }
  private set decision(v: Decision | null) {
    this.slot.decision = v;
  }

  /** Commitment IDs in commitment-number order. */
  private ids(): Hex32[] {
    return [...this.slots.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, s]) => s.id)
      .filter((x): x is Hex32 => x !== null);
  }

  private get sim(): SimChain | EvmSettlement {
    if (!this.chain) throw new Error('settlement not started');
    return this.chain;
  }

  /** config/judges.yaml, loaded on first use. */
  private get registry(): LoadedRegistry {
    this.registryCache ??= loadJudgeRegistry(this.root);
    return this.registryCache;
  }

  /** The adjudicator policy the commitment binds, by its policyId. */
  private policyFor(terms: CommitmentTerms): AdjudicatorPolicy {
    return runnerPolicy(terms.adjudication.policyId);
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
  private async snapshotBalances(): Promise<Record<string, bigint>> {
    const evm = this.evm;
    if (evm) {
      const h = await evm.holdings(this.actors.map((a) => a.address), this.ids());
      const out: Record<string, bigint> = {};
      for (const a of this.actors) out[a.name] = h.parties[a.address.toLowerCase()] ?? 0n;
      out[ESCROW] = h.escrow;
      out[APPEAL_HOLD] = h.appealHold;
      return out;
    }
    const ledger = (this.sim as SimChain).ledger();
    const out: Record<string, bigint> = {};
    for (const a of this.actors) {
      out[a.name] = (ledger[account.party(a.address)] ?? 0n) + (ledger[account.junior(a.address)] ?? 0n) + (ledger[account.senior(a.address)] ?? 0n);
    }
    out[ESCROW] = this.ids().reduce((a, id) => a + (ledger[account.escrow(id)] ?? 0n), 0n);
    // An appeal's bond and fee are held apart from the escrow until the appeal is decided or expires (D21).
    out[APPEAL_HOLD] = this.ids().reduce((a, id) => a + (ledger[account.appealBond(id)] ?? 0n) + (ledger[account.appealFee(id)] ?? 0n), 0n);
    return out;
  }

  private kind(): string {
    return this.state?.kind ?? '—';
  }

  private row(actor: string, call: string, via: string, result: string, detail?: string): void {
    const r: TimelineRow = { t: this.ctx.clock.elapsedMs(), step: this.stepNo, actor, call: this.label(call), via, result, state: this.kind() };
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
    const sender = this.sender(actor, via);
    const r = await this.sim.submit(submission, sender ? { via, sender } : { via });
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

  // Steps

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
      case 'early_accept':
      case 'mutual_settle':
        return { actor: parties.buyer, via: s.via };
      case 'appeal':
        return { actor: parties[s.by], via: s.via };
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
      case 'expire_appeal':
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
    // An operator that went offline relays nothing; the caller can retry through another operator or directly.
    if (party.via !== 'direct' && this.offline.has(party.via)) {
      this.outages.push({ step: this.stepNo, actor: party.via, kind: 'offline' });
      this.row(party.actor, call, party.via, `${party.via} is offline (not relayed)`);
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
        return this.deliver(parties.seller, s.via, s.file, s.stubBytes === true, s.attempt ?? 1, s.buyerEnvelope === 'wrong_key');
      case 'early_accept':
        return this.earlyAccept(parties.buyer, s.via, s.opened);
      case 'appeal':
        return this.appeal(s.by, s.grounds, s.bond, s.via);
      case 'mutual_settle':
        return this.mutualSettle(s.payouts, s.releaseKey, s.via);
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
      case 'expire_appeal':
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
          registryHash: this.registry.hash,
          policyHash: policyHash(runnerPolicy(this.template.adjudication.policyId)),
          buyerEncryptionPublicKey: b64url(this.ctx.rng.hex32()),
          nonce: this.nonceFor(seller, 'terms'),
          createdAt: wholeSecond(Date.parse(now)),
        })
      : rebindToken(this.stubTerms(seller, now), TOKEN, this.token);
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
      schemaVersion: '0.7',
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
        policyId: `${adjudicators.primary}/p1`,
        fee: STUB_FEE,
        registryHash: this.registry.hash,
        policyHash: policyHash(runnerPolicy(`${adjudicators.primary}/p1`)),
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
      nonce: this.nonceFor(seller, 'terms'),
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
      commitmentId: this.tamperable('wrong_commitment_id', c.id),
      adjudicator: this.address(name),
      seedCommitment: this.tamperable('wrong_seed_commitment', keccak256(seed)),
      policyHash: this.tamperable('wrong_policy_hash', c.terms.adjudication.policyHash),
      registryHash: this.tamperable('wrong_registry_hash', c.terms.adjudication.registryHash),
      fee: c.terms.adjudication.fee,
      bondReserved: c.terms.price,
      nonce: this.nonceFor(name, 'msg'),
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
      // The implied acceptance is the adjudicator's own, honest message: no impersonation, no tampering.
      const override = this.signerOverride;
      const tampers = this.tampers;
      this.signerOverride = undefined;
      this.tampers = new Set();
      await this.adjudicatorAccept(via, true);
      this.signerOverride = override;
      this.tampers = tampers;
    }
    const c = this.needCommitment(buyer, 'agree', via);
    if (!c) return;
    const buyerAddress = this.address(buyer);

    const agree = await this.sign(buyer, { type: 'Agree', commitmentId: c.id, buyer: buyerAddress, nonce: this.nonceFor(buyer, 'msg'), expiresAt: c.terms.timing.offerExpiresAt } as const);
    if (!(await this.submit(buyer, 'agree', via, { kind: 'agree', message: agree }))) return;
    this.receipt(via, 'agree');
    this.row(buyer, 'agree', via, 'ok');

    const total = BigInt(c.terms.price.amount) + BigInt(c.terms.adjudication.fee.amount);
    const evm = this.evm;
    let funding;
    if (evm) {
      // ADR-0025 (Proposed): on EVM the buyer signs ERC-3009 ReceiveWithAuthorization to CPP's collector; the
      // FundingAuthorization carries that signature and its values (nonce: the payer-agnostic PaymentInfo hash).
      const f = await evm.fundingAuthorization(c.terms);
      funding = {
        type: 'FundingAuthorization',
        scheme: 'erc3009',
        commitmentId: c.id,
        from: buyerAddress,
        value: f.value.toString(),
        token: this.token,
        validAfter: f.validAfter,
        validBefore: f.validBefore,
        nonce: f.nonce,
        expiresAt: c.terms.timing.fundBy,
        signature: await signDigest({ hash: f.digest, privateKey: this.keyFor(buyer), to: 'hex' }),
      } as const;
    } else {
      funding = await this.sign(buyer, {
        type: 'FundingAuthorization',
        scheme: 'erc3009',
        commitmentId: c.id,
        from: buyerAddress,
        value: total.toString(),
        token: TOKEN,
        validAfter: c.terms.createdAt,
        validBefore: c.terms.timing.fundBy,
        nonce: this.nonceFor(buyer, 'msg'),
        expiresAt: c.terms.timing.fundBy,
      } as const);
    }
    if (!(await this.submit(buyer, 'fund', via, { kind: 'fund', message: funding }))) return;
    this.receipt(via, 'fund');
    this.row(buyer, 'fund', via, 'ok');
    this.balanceRows.push({ after: 'fund', balances: await this.snapshotBalances() });
  }

  private async deliver(seller: string, via: string, file: string, stubBytes: boolean, attempt: number, buyerWrongKey = false): Promise<void> {
    const c = this.needCommitment(seller, 'deliver', via);
    if (!c) return;
    const built = await this.signedDelivery(seller, c, file, stubBytes, attempt, buyerWrongKey);
    const call = `deliver (attempt ${attempt})${buyerWrongKey ? ", buyer's envelope sealed to another key" : ''}`;
    if (!(await this.submit(seller, call, via, { kind: 'deliver', delivery: built.message }))) return;
    this.delivery = built;
    this.receipt(via, 'deliver');
    this.row(seller, call, via, 'ok');
  }

  /** A seller-signed delivery of a fixture file, built and signed but not submitted. */
  private async signedDelivery(seller: string, c: { terms: CommitmentTerms; id: Hex32 }, file: string, stubBytes: boolean, attempt: number, buyerWrongKey = false) {
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
      attempt,
      ciphertext: { uri: `sim://blobs/${this.ctx.ids.next('blob')}`, sha256: sha256(Buffer.from(`ciphertext:${plaintextSha256}`)), bytes: plaintext.length + 16, cipher: 'aes-256-gcm' },
      plaintextSha256,
      plaintextMime: c.terms.deliverable.format,
      // A wrong-key buyer envelope names the buyer but seals to another key: it can never open to the content key.
      encryptedKeys: recipients.map((recipient) => ({ recipient, scheme: 'x25519-xsalsa20poly1305', ciphertext: b64url(canonicalKeccak(buyerWrongKey && recipient === c.terms.buyer ? { contentKey, recipient, sealedTo: 'a key the buyer does not hold' } : { contentKey, recipient })) })),
      submittedAt: this.ctx.clock.now(),
    };
    const signed = await this.sign(seller, { ...body, type: 'Delivery' as const });
    const message: Delivery = { ...body, signature: signed.signature };
    return { message, plaintext, source, contentKey };
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
    // Like the adjudicator service, refuse before any judge is called: a role with no turn has no round, and
    // an unpublished round has no seed (no substitute source, ADR-0018).
    if (role !== 'primary' && round === null) return this.refuse(name, call, 'direct', problem('not_your_turn', `the ${role} adjudicator has no turn in ${c.state.kind}`));
    if (role !== 'primary' && !beaconValue) return this.refuse(name, call, 'direct', problem('seed_mismatch', `beacon round ${round} is not published yet; no panel is drawn without it`));
    const seed = role === 'primary' ? this.seed : panelSeed(c.id, role, d.message.attempt, beaconValue!);
    const key = `${c.id}|${role}|${d.message.attempt}`;
    const slotKey = `${this.current}|${role}|${d.message.attempt}`;
    let view = this.judged.get(key);
    // EVM differential: judgment is off chain and settlement-independent, so the SimChain run's judgment for the same
    // commitment, role and attempt is reused (the judge input hashes the commitment ID, which differs by token).
    const reused = !view && this.backend.kind === 'local' ? this.backend.judgments?.get(slotKey) : undefined;
    if (reused) {
      view = reused;
      this.judged.set(key, view);
      this.judgedBySlot.set(slotKey, view);
      this.judgments.push(view);
    }
    if (!view) {
      const st = c.state;
      const firstOutcome =
        role === 'appeal' && (st.kind === 'Released' || st.kind === 'Refunded') && st.via.kind === 'first_instance' ? (st.kind === 'Released' ? 'accept' : 'reject') : undefined;
      const judged = await runJudgment(
        {
          scenario: this.scenario.name,
          adjudicator: name,
          adjudicatorAddress: actor.address,
          role,
          terms: c.terms,
          commitmentId: c.id,
          delivery: d.message,
          plaintext: d.plaintext,
          source: d.source,
          seed,
          seedCommitment: role === 'primary' ? keccak256(this.seed) : null,
          beaconRound: round,
          registry: this.registry,
          policy: this.policyFor(c.terms),
          ...(firstOutcome ? { firstOutcome } : {}),
        },
        this.judges,
      );
      if (!judged.ok) return this.refuse(name, call, 'direct', judged.error);
      view = judged.value;
      this.judged.set(key, view);
      this.judgedBySlot.set(slotKey, view);
      this.judgments.push(view);
    }
    const outcome = view.outcome;
    if (outcome === null) {
      return this.row(name, `${call}: none`, 'direct', 'no decision: the appeal panel was inconclusive, so the default outcome applies');
    }
    const envelope = (recipient: Address) => ({ scheme: 'x25519-xsalsa20poly1305' as const, ciphertext: b64url(canonicalKeccak({ contentKey: d.contentKey, recipient })) });
    const unsigned = {
      type: 'Decision',
      commitmentId: c.id,
      attempt: d.message.attempt,
      deliveryHash: deliveryHash(d.message),
      adjudicator: actor.address,
      role,
      outcome,
      seed: this.tamperable('wrong_seed', seed),
      policyHash: this.tamperable('wrong_policy_hash', c.terms.adjudication.policyHash),
      registryHash: this.tamperable('wrong_registry_hash', c.terms.adjudication.registryHash),
      judgmentRecordHash: canonicalKeccak(view),
      nonce: this.nonceFor(name, 'msg'),
      expiresAt: this.decisionDeadline(c.state, role),
      ...(round !== null && beaconValue ? { beacon: { source: 'sim' as const, round, value: beaconValue } } : {}),
      ...(outcome === 'accept' ? { keyForBuyer: envelope(c.terms.buyer) } : {}),
      // ADR-0020: an escalation carries the appeal adjudicator's content key.
      ...(outcome === 'escalate' ? { encryptedKeys: [{ recipient: c.terms.adjudication.appealAdjudicator, ...envelope(c.terms.adjudication.appealAdjudicator) }] } : {}),
    } as const;
    const decision = (await this.sign(name, unsigned as UnsignedMessage & { type: 'Decision' })) as Decision;
    if (!(await this.submit(name, `${call}: ${outcome}`, 'direct', { kind: 'decide', message: decision }))) return;
    this.decision = decision;
    const next = this.state!;
    this.row(name, `${call}: ${outcome}`, 'direct', 'ok');
    if (next.kind === 'Released' || next.kind === 'Refunded') this.balanceRows.push({ after: `decide: ${outcome}`, balances: await this.snapshotBalances() });
  }

  /** The deadline a role's decision answers to: judgeBy, fallbackBy, or the appeal's appealDecideBy. */
  private decisionDeadline(s: EscrowState, role: 'primary' | 'fallback' | 'appeal'): Timestamp {
    if (role === 'primary') return s.terms.timing.judgeBy;
    if (role === 'fallback') return s.terms.timing.fallbackBy;
    if (s.kind === 'Escalated') return s.escalation.appealDecideBy;
    if ((s.kind === 'Released' || s.kind === 'Refunded') && s.via.kind === 'first_instance' && s.via.appeal.kind !== 'expired' && 'appealDecideBy' in s.via.appeal) return s.via.appeal.appealDecideBy;
    return s.terms.timing.judgeBy;
  }

  /** Permissionless timeouts. Each records an outage for the actor it acts in place of. */
  private async timeout(kind: TimeoutStep, via: string): Promise<void> {
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
    if (kind === 'apply_default_outcome' || kind === 'expire_appeal') this.balanceRows.push({ after: this.label(kind), balances: await this.snapshotBalances() });
  }

  private settle(who: string, via: string): void {
    const c = this.needCommitment(who, 'settle', via);
    if (!c) return;
    if (c.state.kind === 'Released' || c.state.kind === 'Refunded' || c.state.kind === 'Settled') {
      this.receipt(via, 'settle');
      return this.row(who, 'settle', via, 'ok (no-op: guaranteed_on_decision settled at the decision)');
    }
    this.refuse(who, 'settle', via, problem('invalid_state', `nothing to settle in ${c.state.kind}`));
  }

  private async reclaim(buyer: string, via: string): Promise<void> {
    const c = this.needCommitment(buyer, 'reclaim', via);
    if (!c) return;
    if (!(await this.submit(buyer, 'reclaim', via, { kind: 'trigger', commitmentId: c.id, timeout: 'reclaim' }))) return;
    this.outages.push({ step: this.stepNo, actor: this.scenario.parties.seller, kind: 'timeout', reclaim: true });
    this.receipt(via, 'reclaim');
    this.row(buyer, 'reclaim', via, 'ok');
    this.balanceRows.push({ after: 'reclaim', balances: await this.snapshotBalances() });
  }

  /**
   * The buyer accepts the delivery before any decision: price to the seller, fee back, key to the buyer. It names the
   * posted delivery (ADR-0029), or with `opened` a second delivery of that file the seller signed and handed it.
   */
  private async earlyAccept(buyer: string, via: string, opened?: string): Promise<void> {
    const c = this.needCommitment(buyer, 'early_accept', via);
    if (!c) return;
    const attempt = this.delivery?.message.attempt ?? 1;
    let named = this.delivery ? deliveryHash(this.delivery.message) : ZERO32;
    if (opened !== undefined) {
      // The seller's own, honest signature on its second body: no impersonation in this step's seller signature.
      const override = this.signerOverride;
      this.signerOverride = undefined;
      named = deliveryHash((await this.signedDelivery(this.scenario.parties.seller, c, opened, false, attempt)).message);
      this.signerOverride = override;
    }
    const call = opened === undefined ? 'early_accept' : `early_accept (names a second signed delivery, fixtures/${opened}, not the posted one)`;
    const message = await this.sign(buyer, {
      type: 'EarlyAccept',
      commitmentId: c.id,
      buyer: this.address(buyer),
      attempt,
      deliveryHash: named,
      nonce: this.nonceFor(buyer, 'msg'),
      expiresAt: c.terms.timing.judgeBy,
    } as const);
    if (!(await this.submit(buyer, call, via, { kind: 'early_accept', message }))) return;
    this.receipt(via, 'early_accept');
    this.row(buyer, call, via, 'ok');
    this.balanceRows.push({ after: this.label('early_accept'), balances: await this.snapshotBalances() });
  }

  /** A party appeals a first-instance decision with the rulebook's bond (or the step's) and the appeal fee. */
  private async appeal(by: 'buyer' | 'seller', grounds: string, bondOverride: string | undefined, via: string): Promise<void> {
    const who = this.scenario.parties[by];
    const call = `appeal (${by})`;
    const c = this.needCommitment(who, call, via);
    if (!c) return;
    const rate = BigInt(this.club!.rulebook.appealBondRateBps);
    // ADR-0022 rule 1: a requirement rounds up.
    const required = (BigInt(c.terms.price.amount) * rate + 9_999n) / 10_000n;
    const body = {
      commitmentId: c.id,
      appellant: by,
      appellantAddress: this.address(who),
      grounds,
      bond: this.money(bondOverride ?? required.toString()),
      filedAt: wholeSecond(Date.parse(this.ctx.clock.now())),
    };
    const signed = await this.sign(who, { ...body, type: 'Appeal' as const });
    if (!(await this.submit(who, call, via, { kind: 'appeal', appeal: { ...body, signature: signed.signature } }))) return;
    this.receipt(via, 'appeal');
    this.row(who, call, via, 'ok', undefined);
    this.balanceRows.push({ after: this.label('appeal'), balances: await this.snapshotBalances() });
  }

  /** ADR-0019, D23: both parties sign one settlement; the payouts split the price, the fee returns to the buyer. */
  private async mutualSettle(payouts: Record<string, string>, releaseKey: boolean, via: string): Promise<void> {
    const { buyer, seller } = this.scenario.parties;
    const call = 'mutual_settle';
    const c = this.needCommitment(buyer, call, via);
    if (!c) return;
    if (this.offline.has(seller)) {
      this.outages.push({ step: this.stepNo, actor: seller, kind: 'offline' });
      return this.row(seller, call, via, 'offline (no call)');
    }
    const delivered = 'delivery' in c.state ? c.state.delivery : null;
    const unsigned = {
      type: 'MutualSettlement' as const,
      commitmentId: c.id,
      deliveryHash: delivered ? deliveryHash(delivered) : null,
      payouts: Object.entries(payouts).map(([name, amount]) => ({ to: this.address(name), amount: this.money(amount) })),
      releaseKey,
      nonce: this.ctx.rng.hex32(),
      expiresAt: plus(wholeSecond(Date.parse(this.ctx.clock.now())), DAY),
    };
    const buyerSignature = await signMessage(this.keyFor(buyer), this.domain, unsigned);
    const sellerSignature = await signMessage(this.keyFor(seller), this.domain, unsigned);
    if (!(await this.submit(`${buyer} + ${seller}`, call, via, { kind: 'mutual_settle', message: { ...unsigned, buyerSignature, sellerSignature } }))) return;
    this.receipt(via, call);
    this.row(`${buyer} + ${seller}`, call, via, 'ok');
    this.balanceRows.push({ after: this.label(call), balances: await this.snapshotBalances() });
  }

  /**
   * A fresh nonce for `signer`, or with `tamper: reuse_nonce` its previous one in the same scope (once per
   * step: the step's first signed message reuses, the rest are fresh).
   */
  private nonceFor(signer: string, scope: 'terms' | 'msg'): Hex32 {
    const key = `${signer}|${scope}`;
    const prev = this.lastNonce.get(key);
    let n: Hex32;
    if (prev && this.tampers.has('reuse_nonce') && !this.applied.has('reuse_nonce')) {
      n = prev;
      this.applied.add('reuse_nonce');
    } else n = this.ctx.rng.hex32();
    this.lastNonce.set(key, n);
    return n;
  }

  /** The honest value, or a random one when the step tampers with it. */
  private tamperable(t: Tamper, honest: Hex32): Hex32 {
    if (!this.tampers.has(t)) return honest;
    this.applied.add(t);
    return this.ctx.rng.hex32();
  }

  /** "call" for commitment 1, "call #n" for the others. */
  private label(call: string): string {
    return this.current === 1 ? call : `${call} #${this.current}`;
  }

  private async verifyKeyRelease(buyer: string, via: string): Promise<void> {
    const call = 'fetch key + verify plaintext hash';
    const c = this.needCommitment(buyer, call, via);
    if (!c) return;
    const released = await this.sim.keysFor(c.id, c.terms.buyer);
    const keyed = c.state.kind === 'Released' || (c.state.kind === 'Settled' && c.state.keyReleased);
    if (!keyed || released.length === 0 || !this.delivery) {
      return this.refuse(buyer, call, via, problem('invalid_state', `no key was released to the buyer in ${c.state.kind}`));
    }
    const expected = b64url(canonicalKeccak({ contentKey: this.delivery.contentKey, recipient: c.terms.buyer }));
    const matches = released.some((k) => k.ciphertext === expected) && sha256(this.delivery.plaintext) === this.delivery.message.plaintextSha256;
    this.receipt(via, 'fetch_key');
    if (!matches) return this.refuse(buyer, call, via, problem('invalid_state', 'released key does not open the delivered plaintext'));
    this.row(buyer, call, via, 'hash matches');
  }

  // Results

  private events(): Array<LedgerEvent & { prevHash: Hex32 }> {
    return this.sim.log().map((e) => ({
      seq: e.seq,
      step: this.eventSteps[e.seq] ?? 0,
      type: e.type as SettlementEventType,
      hash: e.hash,
      prevHash: e.prevHash,
      ...(e.commitmentId ? { commitmentId: e.commitmentId } : {}),
    }));
  }

  /**
   * SimChain: replays the journal from genesis; the replay must reproduce the same state digest. EVM: rebuilds the
   * on-chain events from the chain's own blocks and logs; they must equal the adapter's, and the log must link.
   */
  private async replay(): Promise<{ ok: boolean; events: number }> {
    const evm = this.evm;
    if (evm) {
      const r = await evm.replayCheck();
      return { ok: r.ok && SimChain.verifyLog(evm.log()), events: evm.transactions().length };
    }
    const sim = this.sim as SimChain;
    const journal = sim.journal();
    const submits = journal.filter((e) => e.op === 'submit').length;
    try {
      const again = await SimChain.replay(this.genesis!, journal);
      return { ok: again.digest() === sim.digest() && SimChain.verifyLog(sim.log()), events: submits };
    } catch {
      return { ok: false, events: submits };
    }
  }

  private async invariants(replay: { ok: boolean }): Promise<Invariant[]> {
    this.current = 1;
    const st = this.state;
    const many = this.ids().length > 1;
    const settledIds = this.ids().filter((id) => SETTLED_STATES.includes(this.sim.escrowState(id)!.kind));
    const evm = this.evm;
    let leftInSettled = 0n;
    for (const id of settledIds) leftInSettled += evm ? await evm.heldFor(id) : ((this.sim as SimChain).ledger()[account.escrow(id)] ?? 0n);
    return checkInvariants({
      ...(many ? { escrowOfSettled: { settled: settledIds.length > 0, amount: leftInSettled } } : {}),
      balances: await this.snapshotBalances(),
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
    const ordered = [parties.buyer, ESCROW, APPEAL_HOLD, parties.seller, adjudicators.primary, adjudicators.fallback, adjudicators.appeal, ...operators];
    const touched = (name: string) => this.balanceRows.some((r) => (r.balances[name] ?? 0n) !== 0n) || name === ESCROW;
    const state = this.state;
    return {
      actors: this.actors,
      accounts: ordered.filter(touched),
      commitment: this.terms && this.id ? { id: this.id, terms: this.terms } : null,
      others: [...this.slots.entries()]
        .filter(([n, s]) => n !== 1 && s.id !== null)
        .sort(([a], [b]) => a - b)
        .map(([n, s]) => ({ n, id: s.id!, finalState: this.sim.escrowState(s.id!)!.kind })),
      rulebookHash: this.club?.rulebookHash ?? rulebookHash(STUB_RULEBOOK),
      loaded: { club: this.loadedClub, terms: this.template !== null },
      rows: this.rows,
      balanceRows: this.balanceRows,
      judgments: this.judgments,
      events: this.events().map((e) => ({ seq: e.seq, step: e.step, type: e.type, hash: e.hash })),
      receipts: this.receipts,
      replay,
      invariants: await this.invariants(replay),
      states: this.states,
      finalState: state?.kind ?? null,
      problems: this.problems,
      outages: this.outages,
      autoAccepted: state?.kind === 'Released' && state.via.kind === 'first_instance' && state.via.decision.outcome === 'accept',
      balances: await this.snapshotBalances(),
    };
  }

  /** Judgments by `commitmentNumber|role|attempt`, for a local run to reuse (see judge). */
  judgmentsBySlot(): ReadonlyMap<string, JudgmentView> {
    return new Map(this.judgedBySlot);
  }

  /** EVM only: the transactions this run mined, for gas per deal (D4). Empty on SimChain. */
  transactions(): Array<{ call: string; gasUsed: bigint; from: string; sentBy: string; via: string }> {
    const anyone = privateKeyToAccount(testKey(this.ctx.seed, 'anyone')).address.toLowerCase();
    const nameOf = (a: string) => this.actors.find((x) => x.address.toLowerCase() === a.toLowerCase())?.name ?? (a.toLowerCase() === anyone ? 'an unrelated account' : a);
    return this.evm?.transactions().map((t) => ({ call: t.call, gasUsed: t.gasUsed, from: t.from, sentBy: nameOf(t.from), via: t.via })) ?? [];
  }
}
