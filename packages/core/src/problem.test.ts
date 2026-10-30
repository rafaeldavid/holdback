import { describe, expect, it } from 'vitest';
import { PROBLEM_TYPES } from './problem.js';

describe('problem types', () => {
  it('includes the operator API types from ADR-0017', () => {
    for (const t of ['rate_limited', 'not_found', 'invalid_cursor']) expect(PROBLEM_TYPES).toContain(t);
  });
});
