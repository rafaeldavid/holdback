// The demo beats the scripted agents drive (docs/demo.md, Beats). Each beat runs alone on a fresh world and
// returns what the transcript needs (T-013 narrates it): the commitment, the delivery's public facts, the
// outcome, the checks, what Atlas opened and which operator relayed each call. Numbers come from SimChain.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdjudicatorAcceptance, Commitment, CommitmentStateView, DecisionOutcome, Delivery, EscrowStateKind, Hex32, Payout } from '@holdback/core';
import type { CheckOutcome } from '@holdback/judgment';
import { loadTermsFile, type TermsTemplate } from '@holdback/testkit';
import { StandInBench, type AdjudicatorSeam, type JudgeReport } from './bench.js';
import { AtlasAgent, type OpenedWork } from './buyer.js';
import { TidewaterAgent, type Named } from './seller.js';
import { CHECKS_ONLY_TERMS_FILE, DATA_DIR, TERMS_FILE, type DemoWorld } from './world.js';

export interface Players {
  atlas: AtlasAgent;
  tidewater: TidewaterAgent;
  /** Primary; behind the T-009 seam. */
  benchA: AdjudicatorSeam;
  /** Fallback and appeal adjudicators: named in the terms and sealed to, but not called in these beats. */
  benchB: Named;
  benchC: Named;
}

export function players(world: DemoWorld, benchA: AdjudicatorSeam = new StandInBench(world.cast.benchA, world)): Players {
  const { cast } = world;
  return {
    atlas: new AtlasAgent(cast.atlas, world),
    tidewater: new TidewaterAgent(cast.tidewater, world),
    benchA,
    benchB: cast.benchB,
    benchC: cast.benchC,
  };
}

/** A generated deliverable from fixtures/data/dataset-cleaning (scripts/gen-demo-data.ts). */
export const deliverable = (name: string): Uint8Array => new Uint8Array(readFileSync(join(DATA_DIR, name)));

export interface HoldResult {
  commitment: Commitment;
  acceptance: AdjudicatorAcceptance;
  state: CommitmentStateView;
  via: string;
  players: Players;
}

/** Beat 1: Tidewater offers terms naming Bench A, B and C; Bench A accepts; Atlas holds price plus fee in one call. */
export async function beatHold(world: DemoWorld, options: { terms?: TermsTemplate; players?: Players } = {}): Promise<HoldResult> {
  const p = options.players ?? players(world);
  const terms = options.terms ?? loadTermsFile(TERMS_FILE);
  const commitment = await p.tidewater.offer(terms, { buyer: p.atlas.keys, primary: p.benchA, fallback: p.benchB, appeal: p.benchC });
  const acceptance = await p.benchA.accept(commitment);
  const held = await p.atlas.hold(commitment, acceptance);
  return { commitment, acceptance, state: held.state, via: held.via, players: p };
}

export interface JobResult {
  commitmentId: Hex32;
  commitment: Commitment;
  delivery: Delivery;
  finalState: EscrowStateKind;
  /** The primary's outcome; absent when the parties settled without a decision. */
  decision?: DecisionOutcome;
  checks: CheckOutcome[];
  panel?: JudgeReport['panel'];
  /** Present when a key reached Atlas. */
  opened?: OpenedWork;
  payouts?: Payout[];
  /** Operator URL (or 'direct') for each call: hold, deliver, then decide or settle. */
  vias: string[];
}

/** Hold, encrypted delivery, the primary's judgment, and Atlas opening the work when its key was released. */
async function judgedJob(world: DemoWorld, terms: TermsTemplate, file: string): Promise<JobResult> {
  const hold = await beatHold(world, { terms });
  const { commitment, players: p } = hold;
  const delivered = await p.tidewater.deliver(commitment, deliverable(file), { primary: p.benchA.keys, fallback: p.benchB, appeal: p.benchC });
  const report = await p.benchA.judge(commitment.id);
  const state = await p.atlas.waitForOutcome(commitment.id);
  const opened = state.escrowState === 'Released' ? await p.atlas.openWork(commitment.id) : undefined;
  return {
    commitmentId: commitment.id,
    commitment,
    delivery: delivered.delivery,
    finalState: state.escrowState,
    decision: report.outcome,
    checks: report.checks,
    panel: report.panel,
    ...(opened ? { opened } : {}),
    vias: [hold.via, delivered.via, report.via],
  };
}

/** Beats 1-4: the honest cleaned CSV is accepted, $2,000 goes to Tidewater and the key to Atlas in one step. */
export const beatHappyPath = (world: DemoWorld): Promise<JobResult> => judgedJob(world, loadTermsFile(TERMS_FILE), 'customers.clean.csv');

/** Beat 5: the file drops 8% of rows, the rows check fails, Atlas is refunded and Tidewater keeps the work. */
export const beatBadWork = (world: DemoWorld): Promise<JobResult> => judgedJob(world, loadTermsFile(TERMS_FILE), 'customers.clean.row-drop.csv');

/**
 * Beat 6, ADR-0021 half: under the checks-only terms (empty rubric) the file with hidden tag characters is
 * accepted; Atlas's SDK strips the payload before its agent reads the file and reports it from the screen.
 */
export const beatHiddenTags = (world: DemoWorld): Promise<JobResult> => judgedJob(world, loadTermsFile(CHECKS_ONLY_TERMS_FILE), 'customers.clean.hidden-tags.csv');

/**
 * Beat 10: after delivery Atlas finds a gap and both agents co-sign a 70/30 split with the key released.
 * Bench A never judges; its reservation is released and the fee returns to Atlas.
 */
export async function beatMutualSplit(world: DemoWorld, toSellerBps = 7000n): Promise<JobResult> {
  const hold = await beatHold(world);
  const { commitment, players: p } = hold;
  const delivered = await p.tidewater.deliver(commitment, deliverable('customers.clean.csv'), { primary: p.benchA.keys, fallback: p.benchB, appeal: p.benchC });
  const proposal = await p.atlas.proposeSplit(commitment, toSellerBps);
  const sellerSignature = await p.tidewater.cosign(proposal.body, { toSeller: proposal.toSeller });
  const settled = await p.atlas.settle(proposal.body, proposal.buyerSignature, sellerSignature);
  const state = await p.atlas.waitForOutcome(commitment.id);
  return {
    commitmentId: commitment.id,
    commitment,
    delivery: delivered.delivery,
    finalState: state.escrowState,
    checks: [],
    opened: await p.atlas.openWork(commitment.id),
    payouts: state.settled?.payouts ?? proposal.body.payouts,
    vias: [hold.via, delivered.via, settled.via],
  };
}
