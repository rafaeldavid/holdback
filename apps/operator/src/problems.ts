// The problem types an operator answers (RFC 9457; docs/api.md, Errors; D39). One table: each type's HTTP status,
// a short title, and what a caller does next. The OpenAPI document builds its Problem enum from it
// (scripts/openapi.mjs) and the site renders one page per type at https://escrow.stream/problems/<type>
// (site/build.mjs), so the `Link: <…>; rel="type"` on every problem resolves. `type` stays the short token every
// client already branches on; the page is where it resolves (moving `type` to the absolute URI is T-033's call).
import type { Address, ProblemType } from '@holdback/core';

/** Core's types, plus the two only an operator answers: its own failure, and a route that is planned, not built. */
export type ApiProblemType = ProblemType | 'internal' | 'not_implemented';

export interface ProblemDoc {
  status: number;
  /** One line, the same for every occurrence (RFC 9457 `title`). */
  title: string;
  /** What a caller does next. */
  next: string;
}

export const PROBLEM_BASE = 'https://escrow.stream/problems/';

const ADJUDICATOR = 'An adjudicator-side refusal: the adjudicator corrects its message; a party has nothing to change.';

/** In core's order (PROBLEM_TYPES), then the operator's own. */
export const PROBLEMS = {
  invalid_signature: { status: 401, title: 'A signature does not verify', next: 'Sign the typed data you rebuilt yourself, under your pinned domain, with the key the slot names as signer, and put the signature at that slot.' },
  scope_exceeded: { status: 403, title: "The signer's mandate does not cover this", next: "Read the agent's mandate (GET /v1/agents/{address}): its roles, maxPerCommitment and categories must cover the deal." },
  mandate_expired: { status: 403, title: "The signer's mandate has expired", next: 'Get a fresh mandate from your principal; on a demo node, the faucet grants one.' },
  nonce_reused: { status: 409, title: 'This nonce was already used', next: 'Generate a fresh 32-byte nonce, prepare again with it and sign the new message.' },
  rulebook_unknown: { status: 422, title: 'The club or its rulebook is unknown', next: "Read the club (GET /v1/clubs/{id}) and bind its current rulebookHash." },
  invalid_terms: { status: 400, title: 'The request or the terms are malformed', next: 'Fix the input named in `field` (a dotted path into the JSON body, or a query parameter or header name) and send it again. Refusals are not stored, so the same Idempotency-Key works.' },
  deadline_passed: { status: 409, title: 'A deadline in the message has passed', next: "Read the commitment's deadlines; if its state still allows the call, prepare a new message with a later expiry." },
  insufficient_funds: { status: 422, title: 'The balance does not cover this', next: 'Check GET /v1/balances/{address}, fund the address (on a demo node, the faucet) and send the same signed message again.' },
  invalid_state: { status: 409, title: "The commitment's state does not take this call", next: "Read `state` (the commitment's escrowState now) and `needs` (the states that take this call): wait for one of them, or do what the state needs first." },
  submission_limit_reached: { status: 409, title: 'No more deliveries are allowed', next: 'The terms allow maxSubmissions deliveries; wait for the decision.' },
  adjudicator_unavailable: { status: 422, title: 'The adjudicator cannot take this', next: 'Read the detail; choose another adjudicator, or terms this one runs.' },
  coverage_exceeded: { status: 422, title: "The adjudicator's free bond does not cover this price", next: 'Choose an adjudicator with more free bond (GET /v1/adjudicators), or a lower price.' },
  adjudicator_affiliated: { status: 403, title: 'The adjudicator is affiliated with a party', next: 'Choose an adjudicator with no affiliation to either party.' },
  mime_not_allowed: { status: 400, title: "The delivery's media type is not allowed", next: 'Deliver in a format the terms name and the adjudicator accepts.' },
  payload_too_large: { status: 413, title: 'The body is too large', next: 'JSON bodies are limited to 1 MiB and ciphertext to the limit this node states; send less.' },
  acceptance_missing: { status: 422, title: 'The primary adjudicator has not accepted the offer', next: 'Wait until GET /v1/commitments/{id} reads AcceptedByAdjudicator. An offer the adjudicator declines (its notices say why) expires unaccepted.' },
  acceptance_mismatch: { status: 422, title: "The adjudicator's acceptance does not match the terms", next: ADJUDICATOR },
  seed_mismatch: { status: 422, title: 'The panel seed does not match its commitment', next: ADJUDICATOR },
  policy_mismatch: { status: 422, title: 'The policy does not match the one the terms bind', next: "Bind the policyHash of the primary's current registration (GET /v1/adjudicators/{address})." },
  registry_mismatch: { status: 422, title: 'The judge registry does not match the one the terms bind', next: "Bind the primary's current registry.hash; an offer under an old registry is refused at judgment." },
  not_your_turn: { status: 403, title: 'Another adjudicator decides now', next: ADJUDICATOR },
  member_not_admitted: { status: 403, title: 'The principal is not an admitted member of the club', next: 'Join the club first; on a demo node, the faucet admits your address.' },
  idempotency_conflict: { status: 409, title: 'This Idempotency-Key was used with another request', next: 'Use a fresh key for a different request; a key replays only the identical request it first succeeded with.' },
  rate_limited: { status: 429, title: 'Too many requests', next: 'Wait `retryAfterSec` seconds (also the Retry-After header), or send the same request to another operator.' },
  not_found: { status: 404, title: 'No such resource or route', next: 'Check the path and the IDs; GET /v1/openapi.json lists every route this node serves.' },
  invalid_cursor: { status: 400, title: 'The cursor is not one this operator issued', next: 'Pass `nextCursor` from the previous page unchanged, to the same operator.' },
  relay_refused: { status: 403, title: 'This operator declines to relay this message', next: 'The signed message is still valid: send it to another operator, or straight to the settlement layer.' },
  payment_required: { status: 402, title: 'This operator relays a funded agreement only with its fee', next: 'Pay `fee` with the operatorFee slot of POST /v1/prepare/agree-and-fund, or send the same signed agreement to another operator, where this fee does not apply.' },
  unauthorized: { status: 401, title: 'The ReadToken does not grant this read', next: "Sign a ReadToken as a party or an involved adjudicator, for this commitment, unexpired, with audience this operator's receiptSigner." },
  internal: { status: 500, title: 'The operator failed to process the request', next: 'Retry with the same Idempotency-Key, or use another operator; quote the Request-Id when you report it.' },
  not_implemented: { status: 501, title: 'This route is planned, not built', next: 'Read the source the Link header names (rel="describedby"); the route appears in GET /v1/openapi.json when it ships.' },
} as const satisfies Record<ApiProblemType, ProblemDoc>;

export const API_PROBLEM_TYPES = Object.keys(PROBLEMS) as ApiProblemType[];
export const statusOf = (type: ApiProblemType): number => PROBLEMS[type].status;

/** Members an agent branches on (RFC 9457 extension members), present where they apply. */
export interface ProblemMembers {
  /** invalid_state: the commitment's escrowState now. */
  state?: string;
  /** invalid_state: the states that take this call, when the state is what refused it. */
  needs?: string[];
  /** payment_required: what to pay, to whom, in base units. */
  fee?: { to: Address; token: string; amount: string };
  /** rate_limited: whole seconds to wait, as in Retry-After. */
  retryAfterSec?: number;
  /** invalid_terms: the input at fault, a dotted path into the JSON body, or a query parameter or header name. */
  field?: string;
}

export interface ApiProblem extends ProblemMembers {
  type: ApiProblemType;
  detail: string;
}

/** The problem+json body: type, title, status, detail, instance, then the typed members that apply. */
export function problemBody(p: ApiProblem, requestId: string, status = statusOf(p.type)): Record<string, unknown> {
  const { type, detail, ...members } = p;
  const typed = Object.fromEntries(Object.entries(members).filter(([, v]) => v !== undefined));
  return { type, title: PROBLEMS[type].title, status, detail, instance: `urn:holdback:request:${requestId}`, ...typed };
}

/** The headers of a problem: its type page as an RFC 6903 "type" link, and Retry-After on a 429. */
export function problemHeaders(p: ApiProblem): Record<string, string> {
  return {
    'content-type': 'application/problem+json',
    link: `<${PROBLEM_BASE}${p.type}>; rel="type"`,
    ...(p.retryAfterSec !== undefined ? { 'retry-after': String(p.retryAfterSec) } : {}),
  };
}

/**
 * The input a core schema refusal names, as a dotted path: "commitment: /price/amount must match pattern" is
 * `price.amount`, "… / must have required property 'id'" is `id`. `prefix` places a nested message in its body.
 */
export function fieldOf(detail: string, prefix?: string): string | undefined {
  const m = /^[\w-]+: (\/\S*) (.*)$/.exec(detail);
  if (!m) return prefix;
  const path = m[1]!.split('/').filter(Boolean);
  const missing = /must have required property '([^']+)'/.exec(m[2]!)?.[1];
  const parts = [...(prefix ? [prefix] : []), ...path, ...(missing ? [missing] : [])];
  return parts.length ? parts.join('.') : undefined;
}
