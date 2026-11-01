import { describe, expect, it } from 'vitest';
import { PROBLEM_TYPES } from './problem.js';

describe('problem types', () => {
  it('includes the operator API types from ADR-0017 and the reserved ADR-0020 type', () => {
    for (const t of ['rate_limited', 'not_found', 'invalid_cursor', 'unauthorized']) expect(PROBLEM_TYPES).toContain(t);
  });

  it('includes payment_required, an operator asking for its published fee (ADR-0023, D33)', () => {
    expect(PROBLEM_TYPES).toContain('payment_required');
  });

  it('includes relay_refused, an operator declining to relay (D27, red-team review of PR 52)', () => {
    expect(PROBLEM_TYPES).toContain('relay_refused');
  });
});
