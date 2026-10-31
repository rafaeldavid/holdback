// The demo beats the scripted agents drive (docs/demo.md, Beats). Each beat runs alone on a fresh world and
// returns what the transcript needs (T-013 narrates it): the commitment, the delivery's public facts, the
// outcome, Bench A's signed judgment record, what Atlas opened and which operator relayed each call. Bench A,
// B and C are T-009's adjudicator service on the world's SimChain with fake judges. Numbers come from SimChain.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Commitment, CommitmentStateView, DecisionOutcome, Delivery, EscrowStateKind, Hex32, Judgment, Payout } from '@holdback/core';
import { honestVerdict, type FakeScript, type JudgeRequest, type JudgeResponse } from '@holdback/judgment';
import { loadTermsFile, type TermsTemplate } from '@holdback/testkit';
import type { AdjudicatorProposal, SellerAdjudicatorPolicy, SellerReview, Slate } from './adjudicators.js';
import { BenchDirectory, demoRegistry, publishSwiftline, ServiceBench, type AdjudicatorSeam, type JudgeReport, type Listing } from './bench.js';
import { display, TIDEWATER } from './cast.js';
import { AtlasAgent, type OpenedWork } from './buyer.js';
import { TidewaterAgent } from './seller.js';
import { CHECKS_ONLY_TERMS_FILE, DATA_DIR, refusalDetail, TERMS_FILE, type DemoWorld, type DemoWorldOptions } from './world.js';

export interface Players {
  atlas: AtlasAgent;
  tidewater: TidewaterAgent;
  benchA: AdjudicatorSeam;
  /** Fallback: takes over only if Bench A misses judgeBy. */
  benchB: AdjudicatorSeam;
  /** Appeal adjudicator. */
  benchC: AdjudicatorSeam;
  /** Where every adjudicator posts its registration and profile, Swiftline Verdicts included. */
  directory: BenchDirectory;
}

export interface PlayerOptions {
  /** Replaces Bench A behind the seam. */
  benchA?: AdjudicatorSeam;
  /** Per-judge fake verdicts for the benches ('pass' by default). */
  judges?: FakeScript;
  /** Per-bench scripts, overriding `judges` for that bench only (beat 6a scripts Atrium's appeal panel). */
  benchJudges?: Partial<Record<'benchA' | 'benchB' | 'benchC', FakeScript>>;
  /** Tide-7's own adjudicator policy (T-017). */
  seller?: SellerAdjudicatorPolicy;
}

export function players(world: DemoWorld, options: PlayerOptions = {}): Players {
  const { cast } = world;
  const directory = new BenchDirectory(world);
  const bench = (keys: typeof cast.benchA, which: 'benchA' | 'benchB' | 'benchC') => {
    const judges = options.benchJudges?.[which] ?? options.judges;
    return new ServiceBench(keys, directory, judges ? { judges } : {});
  };
  // Clearfield's registration is posted even when a test replaces the seam: the listing is public data, and the
  // agents choose from listings before any seam acts.
  const serviceA = bench(cast.benchA, 'benchA');
  const benchA = options.benchA ?? serviceA;
  const benchB = bench(cast.benchB, 'benchB');
  const benchC = bench(cast.benchC, 'benchC');
  publishSwiftline(directory, cast.swiftline);
  return {
    atlas: new AtlasAgent(cast.atlas, world),
    tidewater: new TidewaterAgent(cast.tidewater, world, options.seller),
    benchA,
    benchB,
    benchC,
    directory,
  };
}

/** The adjudicator negotiation before an offer: Ledger's proposal and Tide-7's review of it. */
export interface Negotiation {
  proposal: AdjudicatorProposal;
  review: SellerReview;
  /** The listings as Ledger read them, before any bond was reserved for this job. */
  listings: Listing[];
}

export type NegotiationStep = 'proposed' | 'reviewed';

/**
 * Beat 1, before the offer (T-017): Ledger reads the posted registrations, filters by the club rulebook and
 * proposes a slate; Tide-7 checks it against its own policy and agrees or refuses. Agent-to-agent messages:
 * nothing is signed or submitted. `observe` is called after each step (the transcript times them).
 */
export function chooseAdjudicators(world: DemoWorld, p: Players, terms: TermsTemplate, observe?: (step: NegotiationStep) => void): Negotiation {
  const listings = p.directory.listings();
  const proposal = p.atlas.proposeAdjudicators(listings, terms);
  observe?.('proposed');
  // Tide-7 reads the same public listings itself; it does not take the buyer's word for them.
  const review = p.tidewater.reviewAdjudicators(proposal, p.directory.listings(), terms);
  observe?.('reviewed');
  return { proposal, review, listings };
}

/** The seam for an address in the slate. Only the benches that run a service can be named. */
function seamAt(p: Players, address: string): AdjudicatorSeam {
  const seam = [p.benchA, p.benchB, p.benchC].find((b) => b.keys.address.toLowerCase() === address.toLowerCase());
  if (!seam) throw new Error(`no adjudicator service runs at ${address}`);
  return seam;
}

/** Primary, fallback and appeal as the agreed slate names them. */
const slatePlayers = (p: Players, slate: Slate) => ({ primary: seamAt(p, slate.primary), fallback: seamAt(p, slate.fallback), appeal: seamAt(p, slate.appeal) });

/** A generated deliverable from fixtures/data/dataset-cleaning (scripts/gen-demo-data.ts). */
export const deliverable = (name: string): Uint8Array => new Uint8Array(readFileSync(join(DATA_DIR, name)));

export interface HoldResult {
  commitment: Commitment;
  state: CommitmentStateView;
  /** Operator URL (or 'direct') for the offer and for Atlas's agree-and-fund call. */
  vias: { offer: string; hold: string };
  players: Players;
  /** How the two agents chose the adjudicators the offer names. */
  negotiation: Negotiation;
  /** The terms template the offer was built from. */
  terms: TermsTemplate;
  /** The agreed slate as seams: the primary accepts and decides. */
  slate: { primary: AdjudicatorSeam; fallback: AdjudicatorSeam; appeal: AdjudicatorSeam };
}

/**
 * Beat 1: Ledger and Tide-7 agree on the adjudicators; Tide-7 offers terms naming exactly that slate; the
 * primary finds the offer and accepts it with a seed commitment, reserving bond; Ledger agrees and funds price
 * plus fee in one call.
 */
export async function beatHold(world: DemoWorld, options: { terms?: TermsTemplate; players?: Players; observe?: (step: NegotiationStep) => void } = {}): Promise<HoldResult> {
  const p = options.players ?? players(world);
  const template = options.terms ?? loadTermsFile(TERMS_FILE);
  const negotiation = chooseAdjudicators(world, p, template, options.observe);
  const { review } = negotiation;
  if (!review.agreed) {
    throw new Error(`${display.party(TIDEWATER)} refused the proposed adjudicators: ${review.refusals.map((r) => `${r.name} (${r.role}): ${r.reason}`).join('; ')}`);
  }
  const slate = slatePlayers(p, review.slate);
  // The terms name the agreed primary's policy; its policy and registry hashes bind at agreement.
  const terms: TermsTemplate = { ...template, adjudication: { ...template.adjudication, policyId: slate.primary.policy.id } };
  const offered = await p.tidewater.offer(terms, { buyer: p.atlas.keys, primary: slate.primary, fallback: slate.fallback.keys, appeal: slate.appeal.keys });
  const accepted = await slate.primary.acceptOffers();
  if (!accepted.includes(offered.commitment.id)) throw new Error(`${slate.primary.name} did not accept ${offered.commitment.id}`);
  const held = await p.atlas.agreeAndFund(offered.commitment);
  return { commitment: offered.commitment, state: held.state, vias: { offer: offered.via, hold: held.via }, players: p, negotiation, terms, slate };
}

export interface JobResult {
  commitmentId: Hex32;
  commitment: Commitment;
  delivery: Delivery;
  finalState: EscrowStateKind;
  /** The primary's outcome; absent when the parties settled without a decision. */
  decision?: DecisionOutcome;
  /** Bench A's signed judgment record: intake, deterministic checks, screen, panel and aggregate. */
  record?: Judgment;
  /** The judge requests behind the decision (each carries the seeded sample in its prompt). */
  requests: JudgeRequest[];
  /** Present when a key reached Atlas. */
  opened?: OpenedWork;
  payouts?: Payout[];
  /** Who relayed each call: offer, hold, deliver, then decide ('direct': the bench submits itself) or settle. */
  vias: string[];
  /** Every decision in order, with the deciding bench's record (beats 6a and 7: escalation, appeal, fallback). */
  reports?: JudgeReport[];
  /** Beat 7: the failures injected and what the agents' SDKs did about them, measured. */
  neutrality?: NeutralityFacts;
}

/** What beat 7 measured: refusals from the operator logs, the relay of each call, the simulated wait. */
export interface NeutralityFacts {
  /** The operator that refused, and how many write calls it answered with 403. */
  refused: { operator: string; refusals: number; status: number; detail: string; calls: string[] };
  /** The operator taken offline before the delivery. */
  offline: string;
  /** The silent primary, and the SimChain seconds between the delivery and judgeBy. */
  silentPrimary: { name: string; secondsToJudgeBy: number };
  /** Who triggered the fallback, and how the trigger was relayed. */
  fallbackTrigger: { by: 'atlas'; via: string };
}

/** The content key is sealed to the agreed primary, fallback and appeal adjudicators (then the buyer). */
const recipients = (hold: HoldResult) => ({ primary: hold.slate.primary.keys, fallback: hold.slate.fallback.keys, appeal: hold.slate.appeal.keys });

/** Hold, encrypted delivery, the primary's judgment, and Atlas opening the work when its key was released. */
async function judgedJob(world: DemoWorld, terms: TermsTemplate, file: string, options: PlayerOptions = {}): Promise<JobResult> {
  const hold = await beatHold(world, { terms, players: players(world, options) });
  const { commitment, players: p } = hold;
  const delivered = await p.tidewater.deliver(commitment, deliverable(file), recipients(hold));
  const report = await hold.slate.primary.judge(commitment.id);
  const state = await p.atlas.waitForOutcome(commitment.id);
  const opened = state.escrowState === 'Released' ? await p.atlas.openWork(commitment.id) : undefined;
  return {
    commitmentId: commitment.id,
    commitment,
    delivery: delivered.delivery,
    finalState: state.escrowState,
    decision: report.outcome,
    record: report.record,
    requests: report.requests,
    ...(opened ? { opened } : {}),
    vias: [hold.vias.offer, hold.vias.hold, delivered.via, report.via],
  };
}

/** Beats 1-4: the honest cleaned CSV passes the checks, a three-judge panel accepts, $2,000 and the key move together. */
export const beatHappyPath = (world: DemoWorld, options: PlayerOptions = {}): Promise<JobResult> =>
  judgedJob(world, loadTermsFile(TERMS_FILE), 'customers.clean.csv', options);

/** Beat 5: the file drops 8% of rows, the required rows check fails, Atlas is refunded and Tidewater keeps the work. */
export const beatBadWork = (world: DemoWorld, options: PlayerOptions = {}): Promise<JobResult> =>
  judgedJob(world, loadTermsFile(TERMS_FILE), 'customers.clean.row-drop.csv', options);

/**
 * Beat 6, ADR-0021 half: under the checks-only terms (empty rubric) the file with hidden tag characters is
 * judged; Bench A's record carries the screen report, and Atlas's SDK strips the payload before its agent
 * reads the file.
 */
export const beatHiddenTags = (world: DemoWorld, options: PlayerOptions = {}): Promise<JobResult> =>
  judgedJob(world, loadTermsFile(CHECKS_ONLY_TERMS_FILE), 'customers.clean.hidden-tags.csv', options);

/**
 * Atrium's scripted appeal verdicts for beat 6a: every judge fails each criterion and reports suspected
 * injection. Scripted, not a model's answer; the transcript says so. Schema-valid like any verdict.
 */
export const SCRIPTED_INJECTION_REJECT = (req: JudgeRequest): JudgeResponse => {
  const v = JSON.parse((honestVerdict(req, 'fail', 0) as { text: string }).text) as Record<string, unknown>;
  return { kind: 'ok', latencyMs: 1, text: JSON.stringify({ ...v, injectionSuspected: true, rationale: 'scripted verdict (no model): an encoded instruction addresses the judges; the work is judged as delivered and fails' }) };
};

/** Every judge in the registry, scripted with `f`. */
const allJudges = (f: FakeScript[string]): FakeScript => Object.fromEntries(demoRegistry().active.map((j) => [j.id, f]));

/**
 * Beat 6a (D25, ADR-0021 amendment): the delivery carries a base64 instruction to the judges. Clearfield's
 * screen flags it and its panel cannot accept, so it escalates with the content key sealed to Atrium; Atrium's
 * five judges (scripted to reject) decide by supermajority with the flag in the record, and Ledger is refunded.
 */
export async function beatInjection(world: DemoWorld, options: PlayerOptions = {}): Promise<JobResult> {
  const p = players(world, { ...options, benchJudges: { benchC: allJudges(SCRIPTED_INJECTION_REJECT), ...options.benchJudges } });
  const hold = await beatHold(world, { terms: loadTermsFile(TERMS_FILE), players: p });
  const { commitment } = hold;
  const delivered = await p.tidewater.deliver(commitment, deliverable('customers.clean.injection-base64.csv'), recipients(hold));
  const first = await hold.slate.primary.judge(commitment.id);
  if (first.outcome !== 'escalate') throw new Error(`beat 6a: ${hold.slate.primary.name} decided ${first.outcome}, expected escalate`);
  // The appeal panel's beacon round is the one after the escalation; SimChain publishes it a few seconds on.
  world.advance(BEACON_WAIT_SEC);
  const appeal = await hold.slate.appeal.judge(commitment.id);
  const state = await p.atlas.waitForOutcome(commitment.id);
  return {
    commitmentId: commitment.id,
    commitment,
    delivery: delivered.delivery,
    finalState: state.escrowState,
    decision: first.outcome,
    record: first.record,
    requests: [...first.requests, ...appeal.requests],
    vias: [hold.vias.offer, hold.vias.hold, delivered.via, first.via, appeal.via],
    reports: [first, appeal],
  };
}

/** Seconds SimChain advances so a beacon round fixed at the current time is published. */
const BEACON_WAIT_SEC = 5;

/**
 * Beat 7 (neutrality, D25): op-1 refuses to relay anything for Tide-7's commitment, through its own relay
 * policy; the SDKs fail over to op-2. Then op-2 goes offline, and Tide-7's delivery goes straight to SimChain.
 * Clearfield stays silent past judgeBy; Ledger triggers the fallback (anyone may); Northgate decides with the
 * beacon seed and the key released to it only now. The club operator signs nothing in this flow.
 */
/** A write call by its operator path, in the narration's words. */
function callName(path: string): string {
  if (path === '/v1/commitments') return 'the offer';
  const tail = path.split('/').slice(4).join('/');
  return ({ agree: 'the agree-and-fund call', deliveries: 'the delivery', 'triggers/fallback': 'the fallback trigger' } as Record<string, string>)[tail] ?? tail;
}

/** The world beat 7 runs on: op-1's relay policy refuses Tide-7's commitments. */
export const NEUTRALITY_WORLD: DemoWorldOptions = { refusals: { 'op-1': ['tidewater'] } };

export async function beatNeutrality(world: DemoWorld, options: PlayerOptions = {}): Promise<JobResult> {
  const refusing = 'op-1';
  const p = players(world, options);
  const hold = await beatHold(world, { players: p });
  const { commitment } = hold;
  await world.stopOperator('op-2');
  const delivered = await p.tidewater.deliver(commitment, deliverable('customers.clean.csv'), recipients(hold));
  // Clearfield is offline: nothing calls it. SimChain time moves to judgeBy.
  const secondsToJudgeBy = Math.ceil((Date.parse(commitment.timing.judgeBy) - Date.parse(world.now())) / 1000);
  world.advance(secondsToJudgeBy);
  const trigger = await p.atlas.triggerFallback(commitment.id);
  world.advance(BEACON_WAIT_SEC);
  const decided = await hold.slate.fallback.judge(commitment.id);
  const state = await p.atlas.waitForOutcome(commitment.id);
  const opened = state.escrowState === 'Released' ? await p.atlas.openWork(commitment.id) : undefined;
  const refusals = world.operatorLog(refusing).filter((e) => e.method === 'POST' && e.status === 403);
  if (refusals.length === 0) throw new Error(`beat 7 needs a world where ${refusing} refuses Tide-7 (NEUTRALITY_WORLD); it refused nothing`);
  return {
    commitmentId: commitment.id,
    commitment,
    delivery: delivered.delivery,
    finalState: state.escrowState,
    decision: decided.outcome,
    record: decided.record,
    requests: decided.requests,
    ...(opened ? { opened } : {}),
    vias: [hold.vias.offer, hold.vias.hold, delivered.via, trigger.via, decided.via],
    reports: [decided],
    neutrality: {
      refused: { operator: refusing, refusals: refusals.length, status: 403, detail: refusalDetail(refusing), calls: refusals.map((e) => callName(e.path)) },
      offline: 'op-2',
      silentPrimary: { name: hold.slate.primary.name, secondsToJudgeBy },
      fallbackTrigger: { by: 'atlas', via: trigger.via },
    },
  };
}

/**
 * Beat 10: after delivery Atlas finds a gap and both agents co-sign a 70/30 split with the key released.
 * Bench A never judges; its reservation is released and the fee returns to Atlas.
 */
export async function beatMutualSplit(world: DemoWorld, toSellerBps = 7000n): Promise<JobResult> {
  const hold = await beatHold(world);
  const { commitment, players: p } = hold;
  const delivered = await p.tidewater.deliver(commitment, deliverable('customers.clean.csv'), recipients(hold));
  const proposal = await p.atlas.proposeSplit(commitment, toSellerBps);
  const sellerSignature = await p.tidewater.cosign(proposal.body, { toSeller: proposal.toSeller });
  const settled = await p.atlas.settle(proposal.body, proposal.buyerSignature, sellerSignature);
  const state = await p.atlas.waitForOutcome(commitment.id);
  return {
    commitmentId: commitment.id,
    commitment,
    delivery: delivered.delivery,
    finalState: state.escrowState,
    requests: [],
    opened: await p.atlas.openWork(commitment.id),
    payouts: state.settled?.payouts ?? proposal.body.payouts,
    vias: [hold.vias.offer, hold.vias.hold, delivered.via, settled.via],
  };
}
