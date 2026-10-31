// The adjudicator policy the commitment binds (ADR-0006): panel parameters, the SHA-256 of the
// first-instance and appeal templates, the aggregation rule and screen versions. policyHash is the
// keccak256 of its RFC 8785 canonical JSON. A case whose bound policy this build cannot honor is refused.
import { canonicalKeccak, err, ok, problem, type AdjudicatorPolicy, type Hex32, type Problem, type Result } from '@holdback/core';
import { AGGREGATION_VERSION, APPEAL_PROMPT_TEMPLATE_HASH, PROMPT_TEMPLATE_HASH, SCREEN_VERSION } from '@holdback/judgment';

export const policyHashOf = (policy: AdjudicatorPolicy): Hex32 => canonicalKeccak(policy);

/** The defaults in docs/judgment-and-defenses.md (Panel policy), with this build's template hashes. */
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
    promptTemplateHash: PROMPT_TEMPLATE_HASH,
    appealPromptTemplateHash: APPEAL_PROMPT_TEMPLATE_HASH,
    aggregationVersion: AGGREGATION_VERSION,
    screenVersion: SCREEN_VERSION,
    providerPrivacy: 'standard',
    disclosureMin: 'public',
    ...over,
  };
}

/**
 * Checks that `policy` is the one the commitment bound and that this build implements it: its hash
 * equals the bound policyHash, and its template hashes and versions are this build's. Problem type
 * policy_mismatch; the detail names the fixture `error.policy-hash-mismatch`.
 */
export function checkPolicyBinding(policy: AdjudicatorPolicy, boundPolicyHash: Hex32): Result<true, Problem> {
  const bad = (d: string) => err(problem('policy_mismatch', `policy-hash-mismatch: ${d}`));
  const h = policyHashOf(policy);
  if (h !== boundPolicyHash) return bad(`policy hashes to ${h}; the commitment binds ${boundPolicyHash}`);
  if (policy.promptTemplateHash !== PROMPT_TEMPLATE_HASH) return bad('first-instance template hash differs from this build');
  if (policy.appealPromptTemplateHash !== APPEAL_PROMPT_TEMPLATE_HASH) return bad('appeal template hash differs from this build');
  if (policy.aggregationVersion !== AGGREGATION_VERSION) return bad(`aggregation ${policy.aggregationVersion} is not ${AGGREGATION_VERSION}`);
  if (policy.screenVersion !== SCREEN_VERSION) return bad(`screen ${policy.screenVersion} is not ${SCREEN_VERSION}`);
  return ok(true);
}
