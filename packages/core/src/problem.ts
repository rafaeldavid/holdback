// Problem types from docs/api.md (RFC 9457 `type` values).
export const PROBLEM_TYPES = [
  'invalid_signature',
  'scope_exceeded',
  'mandate_expired',
  'nonce_reused',
  'rulebook_unknown',
  'invalid_terms',
  'deadline_passed',
  'insufficient_funds',
  'invalid_state',
  'submission_limit_reached',
  'adjudicator_unavailable',
  'coverage_exceeded',
  'adjudicator_affiliated',
  'mime_not_allowed',
  'payload_too_large',
  'acceptance_missing',
  'acceptance_mismatch',
  'seed_mismatch',
  'policy_mismatch',
  'registry_mismatch',
  'not_your_turn',
  'member_not_admitted',
  'idempotency_conflict',
  // ADR-0017: operator API
  'rate_limited',
  'not_found',
  'invalid_cursor',
  // Reserved for Phase 2 reads of private records (ADR-0020)
  'unauthorized',
] as const;

export type ProblemType = (typeof PROBLEM_TYPES)[number];

export interface Problem {
  type: ProblemType;
  detail: string;
}

export const problem = (type: ProblemType, detail: string): Problem => ({ type, detail });
