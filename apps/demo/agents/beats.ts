// The demo beats the scripted agents drive (docs/demo.md, Beats). Each beat runs alone on a fresh world and
// returns what the transcript needs (T-013 narrates it): the commitment, the delivery's public facts, the
// outcome, Bench A's signed judgment record, what Atlas opened and which operator relayed each call. Bench A,
// B and C are T-009's adjudicator service on the world's SimChain with fake judges. Numbers come from SimChain.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Commitment, CommitmentStateView, DecisionOutcome, Delivery, EscrowStateKind, Hex32, Judgment, Payout } from '@holdback/core';
import type { FakeScript, JudgeRequest } from '@holdback/judgment';
import { loadTermsFile, type TermsTemplate } from '@holdback/testkit';
import { BenchDirectory, ServiceBench, type AdjudicatorSeam } from './bench.js';
import { AtlasAgent, type OpenedWork } from './buyer.js';
import { TidewaterAgent } from './seller.js';
import { CHECKS_ONLY_TERMS_FILE, DATA_DIR, TERMS_FILE, type DemoWorld } from './world.js';

export interface Players {
  atlas: AtlasAgent;
  tidewater: TidewaterAgent;
  benchA: AdjudicatorSeam;
  /** Fallback: takes over only if Bench A misses judgeBy. */
  benchB: AdjudicatorSeam;
  /** Appeal adjudicator. */
  benchC: AdjudicatorSeam;
}

export interface PlayerOptions {
  /** Replaces Bench A behind the seam. */
  benchA?: AdjudicatorSeam;
  /** Per-judge fake verdicts for the benches ('pass' by default). */
  judges?: FakeScript;
}

export function players(world: DemoWorld, options: PlayerOptions = {}): Players {
  const { cast } = world;
  const directory = new BenchDirectory(world);
  const bench = (keys: typeof cast.benchA) => new ServiceBench(keys, directory, options.judges ? { judges: options.judges } : {});
  return {
    atlas: new AtlasAgent(cast.atlas, world),
    tidewater: new TidewaterAgent(cast.tidewater, world),
    benchA: options.benchA ?? bench(cast.benchA),
    benchB: bench(cast.benchB),
    benchC: bench(cast.benchC),
  };
}

/** A generated deliverable from fixtures/data/dataset-cleaning (scripts/gen-demo-data.ts). */
export const deliverable = (name: string): Uint8Array => new Uint8Array(readFileSync(join(DATA_DIR, name)));

export interface HoldResult {
  commitment: Commitment;
  state: CommitmentStateView;
  /** Operator URL (or 'direct') for the offer and for Atlas's agree-and-fund call. */
  vias: { offer: string; hold: string };
  players: Players;
}

/**
 * Beat 1: Tidewater offers terms naming Bench A, B and C; Bench A finds the offer and accepts it with a seed
 * commitment, reserving bond; Atlas agrees and funds price plus fee in one call.
 */
export async function beatHold(world: DemoWorld, options: { terms?: TermsTemplate; players?: Players } = {}): Promise<HoldResult> {
  const p = options.players ?? players(world);
  const terms = options.terms ?? loadTermsFile(TERMS_FILE);
  const offered = await p.tidewater.offer(terms, { buyer: p.atlas.keys, primary: p.benchA, fallback: p.benchB.keys, appeal: p.benchC.keys });
  const accepted = await p.benchA.acceptOffers();
  if (!accepted.includes(offered.commitment.id)) throw new Error(`${p.benchA.name} did not accept ${offered.commitment.id}`);
  const held = await p.atlas.agreeAndFund(offered.commitment);
  return { commitment: offered.commitment, state: held.state, vias: { offer: offered.via, hold: held.via }, players: p };
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
}

const recipients = (p: Players) => ({ primary: p.benchA.keys, fallback: p.benchB.keys, appeal: p.benchC.keys });

/** Hold, encrypted delivery, Bench A's judgment, and Atlas opening the work when its key was released. */
async function judgedJob(world: DemoWorld, terms: TermsTemplate, file: string, options: PlayerOptions = {}): Promise<JobResult> {
  const hold = await beatHold(world, { terms, players: players(world, options) });
  const { commitment, players: p } = hold;
  const delivered = await p.tidewater.deliver(commitment, deliverable(file), recipients(p));
  const report = await p.benchA.judge(commitment.id);
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
 * Beat 10: after delivery Atlas finds a gap and both agents co-sign a 70/30 split with the key released.
 * Bench A never judges; its reservation is released and the fee returns to Atlas.
 */
export async function beatMutualSplit(world: DemoWorld, toSellerBps = 7000n): Promise<JobResult> {
  const hold = await beatHold(world);
  const { commitment, players: p } = hold;
  const delivered = await p.tidewater.deliver(commitment, deliverable('customers.clean.csv'), recipients(p));
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
