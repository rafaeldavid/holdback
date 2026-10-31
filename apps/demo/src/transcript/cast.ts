// Display names for the demo cast (docs/demo.md §Cast, as named in the walkthrough). All names are invented.
// T-012 adds apps/demo/agents/cast.ts; once it merges, the names below should come from there.
import type { CastKey } from './types.js';

export interface CastMember {
  /** The name narration uses. */
  name: string;
  /** The firm behind it, when there is one. */
  org?: string;
  /** The human principal who signed the agent's mandate. */
  principal?: string;
  role: string;
}

export const CAST: Readonly<Record<CastKey, CastMember>> = {
  buyer: { name: 'Ledger', org: 'Atlas Research', principal: 'Priya Raman', role: 'buyer agent' },
  seller: { name: 'Tide-7', org: 'Tidewater Data', principal: 'Marcus Oyelaran', role: 'seller agent' },
  benchA: { name: 'Clearfield Adjudication', org: 'Bench A', role: 'primary adjudicator (bonded)' },
  benchB: { name: 'Northgate Review', org: 'Bench B', role: 'fallback adjudicator' },
  benchC: { name: 'Atrium Appeals', org: 'Bench C', role: 'appeal adjudicator' },
  backer: { name: 'Kite Capital', role: 'bond backer' },
  observer: { name: 'Ledgerwatch Audit', role: 'observer' },
  club: { name: 'Data Services Club', org: 'open rulebook v1', role: 'club operator' },
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
