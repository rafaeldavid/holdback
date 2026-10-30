import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM helper without type declarations
import { loadSpec, validateExamples } from '../scripts/spec.mjs';

describe('spec/', () => {
  it('validates every example against the schema of the same name', () => {
    const results = validateExamples();
    expect(results.length).toBeGreaterThanOrEqual(11);
    expect(results.filter((r: { ok: boolean }) => !r.ok)).toEqual([]);
  });

  it('rejects a fractional token amount', () => {
    const { ajv } = loadSpec();
    const validate = ajv.getSchema('https://holdback.dev/schemas/v0.1/common.schema.json#/$defs/TokenAmount');
    expect(validate).toBeDefined();
    expect(validate({ token: 'tUSD', amount: '2050000000' })).toBe(true);
    expect(validate({ token: 'tUSD', amount: '2050.5' })).toBe(false);
  });
});
