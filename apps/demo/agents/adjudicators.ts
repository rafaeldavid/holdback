// Choosing adjudicators before the offer (T-017). The buyer and seller name the primary, fallback and appeal
// adjudicators in the terms they both sign (CLAUDE.md, Objective 1); this file holds the rules each agent
// applies to the published registrations. Ledger (buyer) filters by the club rulebook and proposes a slate;
// Tide-7 (seller) checks the slate against its own policy and agrees or refuses. The messages between them are
// agent-to-agent: no protocol message, nothing on chain. Registrations are read as untrusted documents.
import { parseAdjudicator, type Address, type Hex32, type Rulebook, type SettlementMode, type TokenAmount } from '@holdback/core';
import { policyHashOf } from '@holdback/adjudicator';
import type { LoadedRegistry } from '@holdback/judgment';
import type { TermsTemplate } from '@holdback/testkit';
import { demoRegistry, type Listing } from './bench.js';
import { resolveJudges, ROLE_PLAY, type AdjudicatorRole, type BenchProfile } from './cast.js';
import { TUSD } from './units.js';

export interface Slate {
  primary: Address;
  fallback: Address;
  appeal: Address;
}

export const ROLES: readonly AdjudicatorRole[] = ['primary', 'fallback', 'appeal'];

/** One registration Ledger read, and why it was or was not eligible. */
export interface Considered {
  address: Address;
  /** The registration's `name` field: party text, untrusted. */
  name: string;
  eligible: boolean;
  reasons: string[];
}

/** Ledger to Tide-7: the slate, every registration considered, and the rules applied (in words). */
export interface AdjudicatorProposal {
  slate: Slate;
  considered: Considered[];
  rules: string[];
}

export interface SellerCheck {
  address: Address;
  name: string;
  role: AdjudicatorRole;
  /** The checks this bench passed, in words. */
  passed: string[];
}

/** Tide-7 to Ledger: agreement on the exact slate, or a refusal naming each bench it rejects and why. */
export type SellerReview =
  | { agreed: true; slate: Slate; checks: SellerCheck[] }
  | { agreed: false; refusals: { address: Address; name: string; role: AdjudicatorRole; reason: string }[] };

/** Tide-7's own adjudicator policy. */
export interface SellerAdjudicatorPolicy {
  /** Free bond each named adjudicator must hold, as a rate of the price. Default 10,000 (100%). */
  minFreeBondBps?: number;
  /** The registry Tide-7 trusts. Default: config/judges.yaml through the demo registry. */
  registry?: LoadedRegistry;
}

/** "25,000 tUSD", "0.5 tUSD": whole tUSD with thousands separators. Integer arithmetic only. */
export function tusdText(base: bigint): string {
  const whole = (base / TUSD).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = base % TUSD;
  return `${whole}${frac === 0n ? '' : `.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`} tUSD`;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
const base = (v: unknown): bigint => (isObj(v) && typeof v.amount === 'string' && /^\d+$/.test(v.amount) ? BigInt(v.amount) : 0n);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const nameOf = (l: Listing): string => (typeof l.document.name === 'string' ? l.document.name : l.address);

/** Free bond: junior plus senior minus reserved, as the listing's pool (from SimChain) states it. */
export function freeBond(l: Listing): bigint {
  const pool = isObj(l.document.pool) ? l.document.pool : {};
  return base(pool.junior) + base(pool.senior) - base(pool.reserved);
}

/** The bond an adjudicator must have free to take a commitment (docs/architecture.md, coverage invariant). */
export function requiredFreeBond(rulebook: Rulebook, price: bigint, mode: SettlementMode): bigint {
  // 100% while a guaranteed_on_decision commitment is open to appeal; otherwise the club's ratio, rounded up.
  const bps = mode === 'guaranteed_on_decision' ? 10_000n : BigInt(rulebook.windowCoverageRatioBps);
  return (price * bps + 9_999n) / 10_000n;
}

export interface RuleContext {
  rulebook: Rulebook;
  price: bigint;
  mode: SettlementMode;
}

/** The rules Ledger applies, in words, for the proposal message. */
export function rulesInWords(c: RuleContext): string[] {
  const m = c.rulebook.panelPolicyMin;
  return [
    `panels of at least ${m.panelSize} judges, appeal panels of at least ${m.appealPanelSize}, from at least ${m.minFamilies} model families (panelPolicyMin)`,
    `free bond of at least ${tusdText(requiredFreeBond(c.rulebook, c.price, c.mode))} (${c.mode === 'guaranteed_on_decision' ? '100% of the price for guaranteed_on_decision' : `windowCoverageRatioBps ${c.rulebook.windowCoverageRatioBps}`})`,
    'an active registration that validates against adjudicator.schema.json',
  ];
}

/**
 * Why the club rulebook excludes a listing; empty when it is eligible. Reads the registration's declared policy
 * and the pool SimChain holds. No name or address is special: the same rules apply to every listing.
 */
export function rulebookReasons(l: Listing, c: RuleContext): string[] {
  const out: string[] = [];
  const m = c.rulebook.panelPolicyMin;
  const policy = isObj(l.document.policy) ? l.document.policy : {};
  const panel = int(policy.panelSize);
  const appeal = int(policy.appealPanelSize);
  const families = int(policy.minFamilies);
  if (panel === undefined || panel < m.panelSize) out.push(`panel of ${panel === undefined ? 'unstated size' : plural(panel, 'judge')}; the rulebook requires at least ${m.panelSize} (panelPolicyMin.panelSize)`);
  if (families === undefined || families < m.minFamilies)
    out.push(`draws from ${families === undefined ? 'an unstated number of model families' : plural(families, 'model family', 'model families')}; the rulebook requires at least ${m.minFamilies} (panelPolicyMin.minFamilies)`);
  if (appeal === undefined || appeal < m.appealPanelSize)
    out.push(`appeal panel of ${appeal === undefined ? 'unstated size' : plural(appeal, 'judge')}; the rulebook requires at least ${m.appealPanelSize} (panelPolicyMin.appealPanelSize)`);
  const need = requiredFreeBond(c.rulebook, c.price, c.mode);
  const free = freeBond(l);
  if (free < need) out.push(`free bond ${tusdText(free)} is below the ${tusdText(need)} this commitment needs`);
  if (l.document.status !== 'active') out.push(`status ${String(l.document.status)}, not active`);
  const parsed = parseAdjudicator(l.document);
  if (!parsed.ok) out.push('the registration does not validate against adjudicator.schema.json v0.6');
  return out;
}

const feeOf = (l: Listing): bigint => base(isObj(l.document.fee) ? l.document.fee.min : undefined);

/**
 * Ledger's choice: for each role, the cheapest eligible listing that offers it (its profile's roles) and is not
 * already chosen; ties keep posting order. Throws when a role has no eligible listing.
 */
export function proposeSlate(listings: readonly Listing[], c: RuleContext): AdjudicatorProposal {
  const considered: Considered[] = listings.map((l) => {
    const reasons = rulebookReasons(l, c);
    return { address: l.address, name: nameOf(l), eligible: reasons.length === 0, reasons };
  });
  const chosen: Partial<Slate> = {};
  for (const role of ROLES) {
    const pick = listings
      .filter((l, i) => considered[i]!.eligible && (l.profile?.roles ?? []).includes(role) && !Object.values(chosen).includes(l.address))
      .sort((a, b) => (feeOf(a) < feeOf(b) ? -1 : feeOf(a) > feeOf(b) ? 1 : 0))[0];
    if (!pick) throw new Error(`no eligible adjudicator offers the ${role} role`);
    chosen[role] = pick.address;
  }
  return { slate: chosen as Slate, considered, rules: rulesInWords(c) };
}

/** A pinned model ID: dated, never an alias such as "latest". */
const PINNED = /-\d{8}$/;

/** Tide-7's review of each proposed bench against its own policy. */
export function reviewSlate(proposal: AdjudicatorProposal, listings: readonly Listing[], price: bigint, policy: Required<SellerAdjudicatorPolicy>): SellerReview {
  const checks: SellerCheck[] = [];
  const refusals: Extract<SellerReview, { agreed: false }>['refusals'] = [];
  const need = (price * BigInt(policy.minFreeBondBps) + 9_999n) / 10_000n;
  for (const role of ROLES) {
    const address = proposal.slate[role];
    const l = listings.find((x) => x.address.toLowerCase() === address.toLowerCase());
    const name = l ? nameOf(l) : address;
    const refuse = (reason: string) => void refusals.push({ address, name, role, reason });
    if (!l) {
      refuse('no published registration');
      continue;
    }
    const parsed = parseAdjudicator(l.document);
    if (!parsed.ok) {
      refuse('the registration does not validate against adjudicator.schema.json v0.6');
      continue;
    }
    const r = parsed.value;
    const passed = ['registration validates'];
    if (r.registry.hash !== policy.registry.hash) {
      refuse(`registry ${r.registry.hash.slice(0, 10)}… is not the registry Tide-7 trusts`);
      continue;
    }
    const unpinned = policy.registry.active.filter((j) => !PINNED.test(j.model) || /latest/i.test(j.model));
    if (unpinned.length) {
      refuse(`registry has unpinned models: ${unpinned.map((j) => j.model).join(', ')}`);
      continue;
    }
    passed.push(`registry ${r.registry.hash.slice(0, 10)}… with every active model pinned`);
    if (policyHashOf(r.policy) !== r.policyHash) {
      refuse('policyHash does not match its policy');
      continue;
    }
    passed.push('policyHash matches its policy');
    const free = freeBond(l);
    if (free < need) {
      refuse(`free bond ${tusdText(free)} is below the ${tusdText(need)} Tide-7 requires`);
      continue;
    }
    passed.push(`free bond ${tusdText(free)} covers ${tusdText(need)}`);
    checks.push({ address, name, role, passed });
  }
  return refusals.length ? { agreed: false, refusals } : { agreed: true, slate: { ...proposal.slate }, checks };
}

// ---- profiles for the viewer ------------------------------------------------------------------------------

/** A bench's profile with its judges resolved and its terms read from the registration, terms and SimChain. */
export interface ProfileView {
  address: Address;
  name: string;
  tagline: string;
  roles: readonly AdjudicatorRole[];
  selected: AdjudicatorRole | 'declined';
  declinedBecause?: string[];
  judges: { id: string; model: string; family: string; effort: string }[];
  harness: readonly string[];
  terms: {
    fee: TokenAmount;
    feeRateBps?: number;
    panelSize?: number;
    minFamilies?: number;
    threshold?: { numerator: number; denominator: number };
    appealPanelSize?: number;
    minFamiliesAppeal?: number;
    /** Decision deadline for the role this bench offers first, from the terms file's relative windows. */
    deadline: { sec: number; after: 'deliverBy' | 'judgeBy' | 'appeal' };
    appealWindowSec: number;
    /** Junior plus senior on SimChain. */
    bond: TokenAmount;
    freeBond: TokenAmount;
    registryHash?: Hex32;
  };
  history: { rolePlay: true; note: string; lines: readonly string[] };
}

/** Profiles of every listing posted with one, as they stood when the agents chose (a beat-1 result). */
export function adjudicatorProfiles(hold: { negotiation: { proposal: AdjudicatorProposal; review: SellerReview; listings: readonly Listing[] }; terms: TermsTemplate }): ProfileView[] {
  const { proposal, review, listings } = hold.negotiation;
  return profileViews(listings, proposal, review.agreed ? review.slate : undefined, hold.terms, demoRegistry());
}

export function profileViews(listings: readonly Listing[], proposal: AdjudicatorProposal, agreed: Slate | undefined, terms: TermsTemplate, registry: LoadedRegistry): ProfileView[] {
  const amount = (v: bigint): TokenAmount => ({ token: 'tUSD', amount: v.toString() }) as TokenAmount;
  return listings
    .filter((l): l is Listing & { profile: BenchProfile } => l.profile !== undefined)
    .map((l) => {
      const policy = isObj(l.document.policy) ? l.document.policy : {};
      const pool = isObj(l.document.pool) ? l.document.pool : {};
      const role = agreed ? ROLES.find((r) => agreed[r].toLowerCase() === l.address.toLowerCase()) : undefined;
      const considered = proposal.considered.find((c) => c.address === l.address);
      const first = l.profile.roles[0] ?? 'primary';
      const deadline =
        first === 'primary'
          ? ({ sec: terms.timing.judgeWithinSec, after: 'deliverBy' } as const)
          : first === 'fallback'
            ? ({ sec: terms.timing.fallbackWithinSec, after: 'judgeBy' } as const)
            : ({ sec: terms.timing.appealDecideSec, after: 'appeal' } as const);
      const threshold = isObj(policy.acceptSupermajority) ? policy.acceptSupermajority : undefined;
      const registryHash = isObj(l.document.registry) && typeof l.document.registry.hash === 'string' ? (l.document.registry.hash as Hex32) : undefined;
      const opt = <K extends string>(k: K, v: number | undefined) => (v === undefined ? {} : ({ [k]: v } as Record<K, number>));
      return {
        address: l.address,
        name: nameOf(l),
        tagline: l.profile.tagline,
        roles: l.profile.roles,
        selected: role ?? 'declined',
        ...(role === undefined && considered?.reasons.length ? { declinedBecause: considered.reasons } : {}),
        judges: resolveJudges(l.profile, registry),
        harness: l.profile.harness,
        terms: {
          fee: amount(feeOf(l)),
          ...opt('feeRateBps', l.profile.feeRateBps),
          ...opt('panelSize', int(policy.panelSize)),
          ...opt('minFamilies', int(policy.minFamilies)),
          ...(threshold && int(threshold.numerator) !== undefined && int(threshold.denominator) !== undefined
            ? { threshold: { numerator: int(threshold.numerator)!, denominator: int(threshold.denominator)! } }
            : {}),
          ...opt('appealPanelSize', int(policy.appealPanelSize)),
          ...opt('minFamiliesAppeal', int(policy.minFamiliesAppeal)),
          deadline,
          appealWindowSec: terms.timing.appealWindowSec,
          bond: amount(base(pool.junior) + base(pool.senior)),
          freeBond: amount(freeBond(l)),
          ...(registryHash ? { registryHash } : {}),
        },
        history: { rolePlay: true as const, note: ROLE_PLAY, lines: l.profile.history },
      };
    });
}
