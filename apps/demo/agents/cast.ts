// The demo's invented cast (docs/demo.md, Cast), shared by the agents, their tests and the narration.
// Display names and labels only: the protocol sees addresses, and every name here is fictional. `label` is the
// key-derivation label in keys.ts, so renaming a display name never changes a key, address or hash.
import type { AdjudicatorRole } from '@holdback/core';
import { TUSD } from './units.js';

export interface PartyCast {
  label: string;
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

/**
 * A fourth listing in the registry: published, bonded on SimChain, and declined at beat 1 because its declared
 * panel (one judge, one model family) fails the club rulebook. Never named in a commitment.
 */
export const SWIFTLINE = { label: 'swiftline', name: 'Swiftline Verdicts' } as const;

/**
 * What a bench publishes beside its registration: display data the v0.6 registration cannot carry
 * (backlog). Judges are registry judge IDs from config/judges.yaml, resolved to pinned model IDs by
 * `resolveJudges`; nothing here invents a model ID. `effort` is the reasoning setting the bench declares per
 * judge; the demo runs scripted (fake) judges, so no effort is applied. `history` is invented.
 */
export interface BenchProfile {
  tagline: string;
  /** Roles the bench offers. Ledger proposes a bench only for a role it offers. */
  roles: readonly AdjudicatorRole[];
  judges: readonly { judge: string; effort: string }[];
  harness: readonly string[];
  /** A fee stated as a rate of the price, when the bench prices that way (the registration holds only a minimum amount). */
  feeRateBps?: number;
  /** Invented for the demo: role-play, not a record. */
  history: readonly string[];
}

/** How the transcript labels invented history. */
export const ROLE_PLAY = 'Role-play: invented for this demo, not a real firm or record.';

/** The harness the adjudicator service runs for every bench (docs/judgment-and-defenses.md). */
const SERVICE_HARNESS = [
  'Sealed sandbox: judges get no tools, no network access and no secrets.',
  'Deterministic checks run first; a failed required check decides without a panel.',
  'Screen for hidden characters (Unicode tags, bidi controls) and injection before any judge reads the work.',
  'The deliverable is spotlighted as data, never placed in a system or instruction position.',
  'Each judge reads its own seeded sample of the deliverable.',
  'Verdicts must match judge-verdict.schema.json, or the judge abstains.',
  "Primary panels are seated by commit-reveal; fallback and appeal panels by a seed from the settlement layer's beacon.",
] as const;

const effortFor = (claude: string, gpt: string, qwen: string) => [
  { judge: 'claude-a', effort: claude },
  { judge: 'claude-b', effort: claude },
  { judge: 'gpt-a', effort: gpt },
  { judge: 'gpt-b', effort: gpt },
  { judge: 'qwen-a', effort: qwen },
];

export const PROFILES: Readonly<Record<string, BenchProfile>> = {
  [BENCH_A.label]: {
    tagline: 'Document-examiner rigor for data deliverables.',
    roles: ['primary'],
    judges: effortFor('extended thinking, 16,000-token budget', 'reasoning effort high', 'thinking mode on, 8,192-token budget'),
    harness: SERVICE_HARNESS,
    history: ['Founded in 2025 by former letter-of-credit examiners.', '48,210 cases decided; 2 missed deadlines.'],
  },
  [BENCH_B.label]: {
    tagline: 'When the primary misses its deadline, we decide.',
    roles: ['fallback'],
    judges: effortFor('extended thinking, 4,000-token budget', 'reasoning effort medium', 'thinking mode on, 4,096-token budget'),
    harness: SERVICE_HARNESS,
    history: ['Built by a former insurance claims-adjusting team; a fallback specialist.', '9,870 takeovers; median 41 s from takeover to decision.'],
  },
  [BENCH_C.label]: {
    tagline: 'A second look by five judges from three families.',
    roles: ['appeal'],
    judges: effortFor('extended thinking, 32,000-token budget', 'reasoning effort high', 'thinking mode on, 16,384-token budget'),
    harness: SERVICE_HARNESS,
    history: ['Chaired by Lena Hoffmann, a former commercial arbitrator; hears appeals only.', '1,204 appeals heard; 71% of first decisions upheld.'],
  },
  [SWIFTLINE.label]: {
    tagline: 'One model, one verdict, the lowest fee.',
    roles: ['primary'],
    judges: [{ judge: 'gpt-a', effort: 'reasoning effort minimal' }],
    harness: ['One judge reads the whole deliverable in a single call.', 'Verdicts must match judge-verdict.schema.json, or the case is returned undecided.'],
    feeRateBps: 100,
    history: ['Launched in 2026 as a low-cost verdict service.', 'Median verdict in 0.8 s.'],
  },
};

/** The profile's judges as pinned registry entries. Throws on a judge the registry does not hold as active. */
export function resolveJudges(
  profile: BenchProfile,
  registry: { active: readonly { id: string; model: string; family: string }[] },
): { id: string; model: string; family: string; effort: string }[] {
  return profile.judges.map(({ judge, effort }) => {
    const e = registry.active.find((x) => x.id === judge);
    if (!e) throw new Error(`profile names judge ${judge}, which the registry does not hold as active`);
    return { id: e.id, model: e.model, family: e.family, effort };
  });
}

/** Named for narration only: Phase 1 has no backer deposits, so every bench's senior pool is empty (ADR-0014). */
export const BOND_BACKER = { name: 'Kite Capital' } as const;

export const CLUB_NAME = 'Data Services Club';

/** "Ledger (Atlas Research)", "Clearfield Adjudication (Bench A)". */
export const display = {
  party: (p: PartyCast) => `${p.agent} (${p.org})`,
  bench: (b: BenchCast) => `${b.name} (Bench ${b.label.slice(-1).toUpperCase()})`,
};
