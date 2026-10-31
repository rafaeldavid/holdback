// Display names for narration. The parties, benches, backer and club come from T-012's shared cast
// (apps/demo/agents/cast.ts); only the infrastructure and the observer, which that file does not name, are here.
import { ATLAS, BENCH_A, BENCH_B, BENCH_C, BOND_BACKER, CLUB_NAME, TIDEWATER } from '@holdback/demo/agents/cast.js';
import type { CastKey } from './types.js';

export interface CastMember {
  /** The name narration uses. */
  name: string;
  /** The firm behind it, or the bench letter. */
  org?: string;
  /** The human principal who signed the agent's mandate. */
  principal?: string;
  role: string;
}

const bench = (b: typeof BENCH_A): CastMember => ({ name: b.name, org: `Bench ${b.label.slice(-1).toUpperCase()}`, role: `${b.role} adjudicator` });

export const CAST: Readonly<Record<CastKey, CastMember>> = {
  buyer: { name: ATLAS.agent, org: ATLAS.org, principal: ATLAS.principal.name, role: 'buyer agent' },
  seller: { name: TIDEWATER.agent, org: TIDEWATER.org, principal: TIDEWATER.principal.name, role: 'seller agent' },
  benchA: bench(BENCH_A),
  benchB: bench(BENCH_B),
  benchC: bench(BENCH_C),
  backer: { name: BOND_BACKER.name, role: 'bond backer' },
  // Not in agents/cast.ts: named for the viewer's introduction only.
  observer: { name: 'Ledgerwatch Audit', role: 'observer' },
  club: { name: CLUB_NAME, org: 'open rulebook v1', role: 'club operator' },
  op1: { name: 'op-1', role: 'operator node' },
  op2: { name: 'op-2', role: 'operator node' },
  chain: { name: 'SimChain', role: 'settlement layer (in-process, no admin keys)' },
  escrow: { name: 'Escrow', role: 'the hold on SimChain' },
};

export const nameOf = (key: CastKey): string => CAST[key].name;

/** "Ledger (Atlas Research)", "Clearfield Adjudication (Bench A)", "op-1". */
export function labelOf(key: CastKey): string {
  const m = CAST[key];
  return m.org ? `${m.name} (${m.org})` : m.name;
}
