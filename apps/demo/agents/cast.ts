// The demo's invented cast (docs/demo.md, Cast), shared by the agents, their tests and T-013's narration.
// Display names and labels only: the protocol sees addresses, and every name here is fictional. `label` is the
// key-derivation label in keys.ts, so renaming a display name never changes a key, address or hash.
import { TUSD } from './units.js';

export interface PartyCast {
  label: string;
  /** The agent's display name. */
  agent: string;
  org: string;
  role: 'buyer' | 'seller';
  principal: { label: string; name: string; title: string };
}

export interface BenchCast {
  label: string;
  name: string;
  role: 'primary' | 'fallback' | 'appeal';
}

export const ATLAS: PartyCast & { mandate: { category: string; maxPerJob: bigint; maxDaily: bigint } } = {
  label: 'atlas',
  agent: 'Ledger',
  org: 'Atlas Research',
  role: 'buyer',
  principal: { label: 'atlas-research', name: 'Priya Raman', title: 'Head of Data Ops' },
  // Enforced: Ledger's mandate in SimChain's genesis carries these limits.
  mandate: { category: 'data services', maxPerJob: 5_000n * TUSD, maxDaily: 20_000n * TUSD },
};

export const TIDEWATER: PartyCast = {
  label: 'tidewater',
  agent: 'Tide-7',
  org: 'Tidewater Data',
  role: 'seller',
  principal: { label: 'tidewater-data', name: 'Marcus Oyelaran', title: 'Founder' },
};

export const BENCH_A: BenchCast = { label: 'bench-a', name: 'Clearfield Adjudication', role: 'primary' };
export const BENCH_B: BenchCast = { label: 'bench-b', name: 'Northgate Review', role: 'fallback' };
export const BENCH_C: BenchCast = { label: 'bench-c', name: 'Atrium Appeals', role: 'appeal' };

/** Named for narration only: Phase 1 has no backer deposits, so every bench's senior pool is empty (ADR-0014). */
export const BOND_BACKER = { name: 'Kite Capital' } as const;

export const CLUB_NAME = 'Data Services Club';

/** "Ledger (Atlas Research)", "Clearfield Adjudication (Bench A)". */
export const display = {
  party: (p: PartyCast) => `${p.agent} (${p.org})`,
  bench: (b: BenchCast) => `${b.name} (Bench ${b.label.slice(-1).toUpperCase()})`,
};
