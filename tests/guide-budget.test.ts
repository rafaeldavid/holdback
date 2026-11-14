// T-413: the guides' first-deal paths against their budget, as the file a publish build writes
// (reports/site-out/guide-budget.json, served at https://crow.direct/guide-budget.json). Its shape is pinned here.
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM module without type declarations
import { guideBudget } from '../site/guide-budget.mjs';
// @ts-expect-error -- plain ESM module without type declarations
import { FIRST_DEAL_BUDGET, guideSource, measurePaths } from '../site/guides.mjs';

const schema = JSON.parse(readFileSync(new URL('../site/guide-budget.schema.json', import.meta.url), 'utf8'));
const valid = new (Ajv2020 as unknown as typeof Ajv2020.default)({ strict: true }).compile(schema);
const AT = new Date('2026-11-14T10:00:00.456Z');
const COMMIT = '016c28e0123456789abcdef0123456789abcdef0';
const guides = new Map(['llms.txt', 'buy.txt', 'sell.txt'].map((p) => [p, guideSource(p)]));

describe('guide-budget.json', () => {
  it("holds the buyer's and the seller's path, measured as site/check.mjs measures them, in the pinned shape", async () => {
    const measured = await measurePaths(guides, { key: '' });
    const body = guideBudget(measured, { generatedAt: AT, commit: COMMIT });
    expect(valid(body), JSON.stringify(valid.errors)).toBe(true);
    expect(body).toMatchObject({ schema: 'crow.guide-budget/1', generatedAt: '2026-11-14T10:00:00Z', commit: COMMIT, budget: { tokens: FIRST_DEAL_BUDGET.tokens, model: FIRST_DEAL_BUDGET.model } });
    expect(body.paths.map((p: { role: string; files: string[] }) => [p.role, p.files])).toEqual([['buyer', ['llms.txt', 'buy.txt']], ['seller', ['llms.txt', 'sell.txt']]]);
    for (const p of body.paths) {
      expect(p).toMatchObject({ method: 'estimate', counted: null });
      expect(p.tokens).toBe(p.estimate);
      expect(p.budgetBps).toBe(Math.floor((p.tokens * 10_000) / FIRST_DEAL_BUDGET.tokens));
    }
  });

  it("states a provider's count as count_tokens, and the share in whole basis points rounded down", () => {
    const body = guideBudget([{ role: 'buyer', files: ['llms.txt', 'buy.txt'], bytes: 19_604, estimate: 4901, counted: 4899, tokens: 4899 }], { generatedAt: AT, commit: 'dirty' });
    expect(valid(body)).toBe(true);
    expect(body.commit).toBeNull();
    expect(body.paths[0]).toMatchObject({ method: 'count_tokens', counted: 4899, tokens: 4899, budgetBps: 9798 });
  });
});
