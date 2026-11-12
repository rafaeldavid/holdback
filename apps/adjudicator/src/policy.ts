// The adjudicator policy the commitment binds (ADR-0006): panel parameters, the SHA-256 of the
// first-instance and appeal templates, the aggregation rule and screen versions. policyHash is the
// keccak256 of its RFC 8785 canonical JSON.
//
// ADR-0036: a build honours every version it keeps, not only its default. kept-policies.json records each version and
// registry a released build registered, with a retired or withdrawn mark when one leaves; @holdback/judgment's KEPT
// table holds the code. A bound policy is honoured when its hash matches and the build carries each of its four values:
// in the code, and not marked retired or withdrawn in the data file. A withdrawn value is declined, never replaced.
import { err, ok, policyHash, problem, type AdjudicatorPolicy, type Hex32, type Problem, type Result } from '@holdback/core';
import { implementationsFor, KEPT, keptLabels, type KeptTable, type PolicyImpl, type PolicyVersions } from '@holdback/judgment';
import KEPT_FILE from './kept-policies.json' with { type: 'json' };

/** Core's policyHash, typed to an adjudicator policy. */
export const policyHashOf: (policy: AdjudicatorPolicy) => Hex32 = policyHash;

/** kept: carried. retired: left the build by a decision that showed no open deal binds it. withdrawn: declined at once. */
export type KeptStatus = 'kept' | 'retired' | 'withdrawn';
type Mark = { status: KeptStatus; since?: string; decision?: string; reason?: string };

export interface KeptPolicies {
  default: PolicyVersions;
  screens: Array<{ version: string } & Mark>;
  templatePairs: Array<{ promptTemplateHash: Hex32; appealPromptTemplateHash: Hex32 } & Mark>;
  aggregations: Array<{ version: string } & Mark>;
  registries: Array<{ hash: Hex32; file?: string } & Mark>;
}

const HEX32 = /^0x[0-9a-f]{64}$/;
const STATUSES: readonly KeptStatus[] = ['kept', 'retired', 'withdrawn'];

/** Reads and checks the data file's shape; a retired or withdrawn mark needs its decision reference and reason. */
export function parseKeptPolicies(doc: unknown): KeptPolicies {
  const bad = (why: string): never => {
    throw new Error(`kept-policies: ${why}`);
  };
  if (typeof doc !== 'object' || doc === null) bad('not an object');
  const d = doc as Record<string, unknown>;
  const list = (k: string) => (Array.isArray(d[k]) ? (d[k] as Array<Record<string, unknown>>) : bad(`${k} is not a list`));
  const mark = (e: Record<string, unknown>, what: string): Mark => {
    const status = e['status'] as KeptStatus;
    if (!STATUSES.includes(status)) bad(`${what}: status must be kept, retired or withdrawn`);
    if (status !== 'kept' && (typeof e['decision'] !== 'string' || !e['decision'] || typeof e['reason'] !== 'string' || !e['reason'])) bad(`${what}: a ${status} mark needs its decision reference and reason`);
    return { status, ...(typeof e['since'] === 'string' ? { since: e['since'] } : {}), ...(typeof e['decision'] === 'string' ? { decision: e['decision'] } : {}), ...(typeof e['reason'] === 'string' ? { reason: e['reason'] } : {}) };
  };
  const label = (e: Record<string, unknown>, k: string, what: string) => (typeof e[k] === 'string' && e[k] ? (e[k] as string) : bad(`${what}: ${k} missing`));
  const hex = (e: Record<string, unknown>, k: string, what: string) => (typeof e[k] === 'string' && HEX32.test(e[k] as string) ? (e[k] as Hex32) : bad(`${what}: ${k} is not a 32-byte hex hash`));
  const def = d['default'] as Record<string, unknown> | undefined;
  if (!def) bad('no default');
  const out: KeptPolicies = {
    default: {
      screenVersion: label(def!, 'screenVersion', 'default'),
      promptTemplateHash: hex(def!, 'promptTemplateHash', 'default'),
      appealPromptTemplateHash: hex(def!, 'appealPromptTemplateHash', 'default'),
      aggregationVersion: label(def!, 'aggregationVersion', 'default'),
    },
    screens: list('screens').map((e, i) => ({ version: label(e, 'version', `screens[${i}]`), ...mark(e, `screens[${i}]`) })),
    templatePairs: list('templatePairs').map((e, i) => ({ promptTemplateHash: hex(e, 'promptTemplateHash', `templatePairs[${i}]`), appealPromptTemplateHash: hex(e, 'appealPromptTemplateHash', `templatePairs[${i}]`), ...mark(e, `templatePairs[${i}]`) })),
    aggregations: list('aggregations').map((e, i) => ({ version: label(e, 'version', `aggregations[${i}]`), ...mark(e, `aggregations[${i}]`) })),
    registries: list('registries').map((e, i) => ({ hash: hex(e, 'hash', `registries[${i}]`), ...(typeof e['file'] === 'string' ? { file: e['file'] } : {}), ...mark(e, `registries[${i}]`) })),
  };
  const dup = (xs: string[], what: string) => new Set(xs).size === xs.length || bad(`${what} listed twice`);
  dup(out.screens.map((s) => s.version), 'a screen version');
  dup(out.templatePairs.map((p) => `${p.promptTemplateHash}/${p.appealPromptTemplateHash}`), 'a template pair');
  dup(out.aggregations.map((a) => a.version), 'an aggregation version');
  dup(out.registries.map((r) => r.hash), 'a registry');
  return out;
}

/** This build's kept-policies data file. */
export const KEPT_POLICIES: KeptPolicies = parseKeptPolicies(KEPT_FILE);

const mark = <T extends Mark>(entries: readonly T[], match: (e: T) => boolean): Mark | null => entries.find(match) ?? null;

function marksOf(v: PolicyVersions, kept: KeptPolicies): Array<[string, Mark | null]> {
  return [
    [`screen ${v.screenVersion}`, mark(kept.screens, (s) => s.version === v.screenVersion)],
    [`the template pair ${v.promptTemplateHash.slice(0, 10)}... / ${v.appealPromptTemplateHash.slice(0, 10)}...`, mark(kept.templatePairs, (p) => p.promptTemplateHash === v.promptTemplateHash && p.appealPromptTemplateHash === v.appealPromptTemplateHash)],
    [`aggregation ${v.aggregationVersion}`, mark(kept.aggregations, (a) => a.version === v.aggregationVersion)],
  ];
}

/** A withdrawal of one of the four values (ADR-0036 section 2): declined at once, never replaced; null when none is. */
export function withdrawnProblem(v: PolicyVersions, kept: KeptPolicies = KEPT_POLICIES): Problem | null {
  for (const [what, m] of marksOf(v, kept)) {
    if (m?.status === 'withdrawn') return problem('policy_mismatch', `this build withdrew ${what} (${m.decision}: ${m.reason}); it declines every open deal bound to it and judges none under another version`);
  }
  return null;
}

/** Why this build cannot run one of the four values: withdrawn, or not carried (absent, retired or not in the code). */
export function versionsProblem(v: PolicyVersions, kept: KeptPolicies = KEPT_POLICIES, code: KeptTable = KEPT): Result<PolicyImpl, Problem> {
  const withdrawn = withdrawnProblem(v, kept);
  if (withdrawn) return err(withdrawn);
  for (const [what, m] of marksOf(v, kept)) {
    if (!m || m.status === 'retired') return err(problem('policy_mismatch', `this build does not carry ${what}${m ? ` (retired, ${m.decision})` : ''}`));
  }
  const impl = implementationsFor(v, code);
  return impl.ok ? ok(impl.value) : err(problem('policy_mismatch', impl.error));
}

/** Why this build cannot judge under the registry `hash`, from the data file's marks; null when it is not marked out. */
export function registryMarkProblem(hash: Hex32, kept: KeptPolicies = KEPT_POLICIES): Problem | null {
  const m = kept.registries.find((r) => r.hash === hash);
  if (m?.status === 'withdrawn') return problem('registry_mismatch', `this build withdrew registry ${hash} (${m.decision}: ${m.reason}); it declines every open deal bound to it and judges none under another registry`);
  if (m?.status === 'retired') return problem('registry_mismatch', `this build does not carry registry ${hash} (retired, ${m.decision})`);
  return null;
}

/**
 * The static check (ADR-0036 section 4): the data file and the code agree. Every value the file keeps is in the code,
 * every value in the code is in the file, and the default is kept. Returns the disagreements; empty means consistent.
 */
export function keptConsistency(kept: KeptPolicies = KEPT_POLICIES, code: KeptTable = KEPT): string[] {
  const labels = keptLabels(code);
  const out: string[] = [];
  const pairKey = (p: { promptTemplateHash: Hex32; appealPromptTemplateHash: Hex32 }) => `${p.promptTemplateHash}/${p.appealPromptTemplateHash}`;
  const check = (what: string, inFile: Array<{ key: string; status: KeptStatus }>, inCode: string[]) => {
    for (const e of inFile) if (e.status !== 'retired' && !inCode.includes(e.key)) out.push(`${what} ${e.key} is ${e.status} in kept-policies.json but not in the code`);
    for (const k of inCode) if (!inFile.some((e) => e.key === k)) out.push(`${what} ${k} is in the code but not in kept-policies.json`);
  };
  check('screen', kept.screens.map((s) => ({ key: s.version, status: s.status })), labels.screens);
  check('template pair', kept.templatePairs.map((p) => ({ key: pairKey(p), status: p.status })), labels.templatePairs.map(pairKey));
  check('aggregation', kept.aggregations.map((a) => ({ key: a.version, status: a.status })), labels.aggregations);
  const d = versionsProblem(kept.default, kept, code);
  if (!d.ok) out.push(`the default cannot be judged under: ${d.error.detail}`);
  return out;
}

/** The defaults in docs/judgment-and-defenses.md (Panel policy), with this build's default versions (kept-policies.json). */
export function defaultPolicy(id: string, over: Partial<AdjudicatorPolicy> = {}): AdjudicatorPolicy {
  return {
    id,
    panelSize: 3,
    appealPanelSize: 5,
    minFamilies: 2,
    minFamiliesAppeal: 3,
    minValid: 2,
    minValidAppeal: 4,
    acceptSupermajority: { numerator: 2, denominator: 3 },
    rejectSupermajority: { numerator: 2, denominator: 3 },
    judgeTimeoutSec: 60,
    rationaleMaxChars: 600,
    ...KEPT_POLICIES.default,
    providerPrivacy: 'standard',
    disclosureMin: 'public',
    ...over,
  };
}

/**
 * Checks that `policy` is the one the commitment bound and that this build carries it: its hash equals the bound
 * policyHash (the detail names the fixture `error.policy-hash-mismatch`), and this build carries each of its four
 * values (ADR-0036: "this build does not carry screen-0", or a withdrawal). Problem type policy_mismatch.
 */
export function checkPolicyBinding(policy: AdjudicatorPolicy, boundPolicyHash: Hex32, kept: KeptPolicies = KEPT_POLICIES): Result<PolicyImpl, Problem> {
  const h = policyHashOf(policy);
  if (h !== boundPolicyHash) return err(problem('policy_mismatch', `policy-hash-mismatch: policy hashes to ${h}; the commitment binds ${boundPolicyHash}`));
  return versionsProblem(policy, kept);
}
