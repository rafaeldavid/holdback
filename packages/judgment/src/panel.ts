// Panel selection (ADR-0006, ADR-0016 section 4, ADR-0018). Everything here is a pure function of the panel
// seed, the commitment ID and the bound registry, so anyone can recompute who judged, in which
// criteria order, under which boundary and canary, and from which sample:
//   - seats: a seeded Fisher-Yates shuffle of the registry's active entries (id order), keyed by
//     keccak256(seed || commitmentId), taken in shuffled order subject to the family minimum;
//   - per judge: criteria order, nonces and the sampling seed, each under its own label.
// The seed is the primary's revealed commit-reveal seed, or the beacon-derived seed for the fallback
// and appeal adjudicators. Nothing here takes a verdict, so there is no way to re-roll a panel.
import { concat, keccak256, stringToBytes, toBytes } from 'viem';
import { err, ok, type Hex32, type Result } from '@holdback/core';
import type { JudgeRegistry, PanelSeat } from './pipeline.js';
import type { Nonces } from './prompt.js';
import type { LoadedRegistry } from './providers/registry.js';
import { seededIndex } from './sample.js';
import type { JudgmentCriterion } from './terms.js';

export const PANEL_VERSION = 'panel-1';

/** keccak256(seed || commitmentId): the key every derivation for this case starts from. */
export const panelKey = (seed: Hex32, commitmentId: Hex32): Hex32 => keccak256(concat([toBytes(seed), toBytes(commitmentId)]));
const derive = (seed: Hex32, commitmentId: Hex32, label: string): Hex32 => keccak256(concat([toBytes(panelKey(seed, commitmentId)), stringToBytes(label)]));

function shuffle<T>(items: readonly T[], key: Hex32, label: string): T[] {
  const out = [...items];
  for (let i = 0; i < out.length - 1; i++) {
    const j = i + seededIndex(key, label, i, out.length - i);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface SelectInput {
  registry: LoadedRegistry;
  seed: Hex32;
  commitmentId: Hex32;
  size: number;
  minFamilies: number;
}

/**
 * Walks the shuffled active entries and seats each one unless seating it would leave too few seats to
 * reach the family minimum. Refuses when the registry cannot fill the panel.
 */
export function selectPanel(input: SelectInput): Result<PanelSeat[], string> {
  const { registry, size, minFamilies } = input;
  if (!Number.isSafeInteger(size) || size < 1) return err('panel size must be a positive integer');
  const order = shuffle(registry.active, panelKey(input.seed, input.commitmentId), `${PANEL_VERSION}:seats`);
  const seats: PanelSeat[] = [];
  const families = new Set<string>();
  for (const e of order) {
    if (seats.length === size) break;
    const distinctAfter = families.size + (families.has(e.family) ? 0 : 1);
    const seatsLeftAfter = size - seats.length - 1;
    if (distinctAfter + seatsLeftAfter < minFamilies) continue;
    seats.push({ judgeId: e.id, provider: e.provider, family: e.family, model: e.model });
    families.add(e.family);
  }
  if (seats.length < size) return err(`the registry has ${registry.active.length} active judges; the panel needs ${size} meeting ${minFamilies} families`);
  if (families.size < minFamilies) return err(`the registry cannot seat ${minFamilies} model families`);
  return ok(seats);
}

export const criteriaOrder = (seed: Hex32, commitmentId: Hex32, judgeId: string, criteria: readonly JudgmentCriterion[]): JudgmentCriterion[] =>
  shuffle(criteria, panelKey(seed, commitmentId), `${PANEL_VERSION}:criteria:${judgeId}`);

/**
 * Boundary and canary per judge. Unpredictable to the seller when it delivers (the seed is secret or
 * not yet published), and recomputable afterwards, so the buyer can recompute each inputHash.
 */
export function judgeNonces(seed: Hex32, commitmentId: Hex32, judgeId: string): Nonces {
  return {
    boundary: derive(seed, commitmentId, `${PANEL_VERSION}:boundary:${judgeId}`).slice(2, 34),
    canary: derive(seed, commitmentId, `${PANEL_VERSION}:canary:${judgeId}`).slice(2, 34),
  };
}

export const sampleSeedFor = (seed: Hex32, commitmentId: Hex32, judgeId: string): Hex32 => derive(seed, commitmentId, `${PANEL_VERSION}:sample:${judgeId}`);

export interface PanelPlan {
  seats: PanelSeat[];
  registry: JudgeRegistry;
  nonces: (seat: PanelSeat, index: number) => Nonces;
  criteriaFor: (seat: PanelSeat, index: number) => JudgmentCriterion[];
  sampleSeed: (seat: PanelSeat, index: number) => Hex32;
}

/** Everything runPipeline needs from the seed: seats, registry, nonces, criteria order, sample seeds. */
export function panelPlan(input: SelectInput & { criteria: readonly JudgmentCriterion[] }): Result<PanelPlan, string> {
  const seats = selectPanel(input);
  if (!seats.ok) return seats;
  const { seed, commitmentId, criteria } = input;
  return ok({
    seats: seats.value,
    registry: input.registry.judges,
    nonces: (s) => judgeNonces(seed, commitmentId, s.judgeId),
    criteriaFor: (s) => criteriaOrder(seed, commitmentId, s.judgeId, criteria),
    sampleSeed: (s) => sampleSeedFor(seed, commitmentId, s.judgeId),
  });
}
