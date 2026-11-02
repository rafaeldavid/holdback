// T-030 (D39, review F4): one table of problem types, each with its status, a title and what a caller does next.
import { readFileSync } from 'node:fs';
import { parseAnyCommitment, parseMessage, PROBLEM_TYPES } from '@holdback/core';
import { TIMEOUT_KINDS } from '@holdback/settlement';
import { describe, expect, it } from 'vitest';
import { API_PROBLEM_TYPES, fieldOf, PROBLEM_BASE, PROBLEMS, problemBody, problemHeaders, statusOf } from './problems.js';
import { NEEDS, TRIGGER_NEEDS } from './server.js';

describe('typed members from core refusals', () => {
  it("fieldOf reads core's refusal text: a pinned format, so a change to it fails here first (PR 85 review)", () => {
    const example = JSON.parse(readFileSync(new URL('../../../spec/examples/commitment.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    const badAmount = parseAnyCommitment({ ...example, price: { token: 'tUSD', amount: '25.5' } });
    expect(badAmount.ok).toBe(false);
    if (!badAmount.ok) expect(fieldOf(badAmount.error.detail)).toBe('price.amount');
    const { nonce: _n, ...noNonce } = example; // eslint-disable-line @typescript-eslint/no-unused-vars
    const missing = parseAnyCommitment(noNonce);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(fieldOf(missing.error.detail)).toBe('nonce');
    const fund = parseMessage({ type: 'FundingAuthorization' });
    expect(fund.ok).toBe(false);
    if (!fund.ok) expect(fieldOf(fund.error.detail, 'fund')).toMatch(/^fund\./);
    expect(fieldOf('no pointer here')).toBeUndefined();
  });

  it("names in `needs` only states the read model has, and one entry per trigger kind", () => {
    const states = (JSON.parse(readFileSync(new URL('../../../spec/schemas/commitment-state.schema.json', import.meta.url), 'utf8')) as { properties: { escrowState: { enum: string[] } } }).properties.escrowState.enum;
    for (const s of [...Object.values(NEEDS), ...Object.values(TRIGGER_NEEDS)].flat()) expect(states, s).toContain(s);
    expect(Object.keys(TRIGGER_NEEDS).sort()).toEqual([...TIMEOUT_KINDS].sort());
  });
});

describe('problem types', () => {
  it("covers every core type plus the operator's own internal (500) and not_implemented (501)", () => {
    expect(API_PROBLEM_TYPES).toEqual([...PROBLEM_TYPES, 'internal', 'not_implemented']);
    expect([statusOf('internal'), statusOf('not_implemented')]).toEqual([500, 501]);
  });

  it('keeps the statuses the operator answered before', () => {
    const before: Record<string, number> = {
      invalid_terms: 400, invalid_cursor: 400, mime_not_allowed: 400, invalid_signature: 401, unauthorized: 401, payment_required: 402,
      scope_exceeded: 403, mandate_expired: 403, member_not_admitted: 403, relay_refused: 403, adjudicator_affiliated: 403, not_your_turn: 403,
      not_found: 404, invalid_state: 409, nonce_reused: 409, idempotency_conflict: 409, deadline_passed: 409, submission_limit_reached: 409,
      payload_too_large: 413, rate_limited: 429,
    };
    for (const t of PROBLEM_TYPES) expect(statusOf(t), t).toBe(before[t] ?? 422);
  });

  it('gives each type a short title and a next step', () => {
    for (const t of API_PROBLEM_TYPES) {
      expect(PROBLEMS[t].title.length, t).toBeGreaterThan(10);
      expect(PROBLEMS[t].title.length, t).toBeLessThanOrEqual(80);
      expect(PROBLEMS[t].next.length, t).toBeGreaterThan(20);
    }
  });

  it('builds an RFC 9457 body with typed members, and links the type page', () => {
    const p = { type: 'invalid_state' as const, detail: 'commitment 0x1 is Held', state: 'Held', needs: ['Delivered'] };
    expect(problemBody(p, '6f1c2a8e-1b9d-4c3e-9f70-2d8a7b4e5c11')).toEqual({
      type: 'invalid_state',
      title: PROBLEMS.invalid_state.title,
      status: 409,
      detail: 'commitment 0x1 is Held',
      instance: 'urn:holdback:request:6f1c2a8e-1b9d-4c3e-9f70-2d8a7b4e5c11',
      state: 'Held',
      needs: ['Delivered'],
    });
    expect(problemHeaders(p)).toEqual({ 'content-type': 'application/problem+json', link: `<${PROBLEM_BASE}invalid_state>; rel="type"` });
    expect(problemHeaders({ type: 'rate_limited', detail: 'x', retryAfterSec: 7 })['retry-after']).toBe('7');
  });
});
