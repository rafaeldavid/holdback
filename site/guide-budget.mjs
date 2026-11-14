// The agent guides' first-deal paths against their budget, as a file (T-413). site/check.mjs measures each role's
// path (the front door plus its page, site/guides.mjs measurePaths) and, at a publish build, writes this body to
// reports/site-out/guide-budget.json, so the deployed site serves it at https://crow.direct/guide-budget.json and
// Crow Control reads it with one GET. Its shape is pinned by guide-budget.schema.json beside this file:
//
//   { "schema": "crow.guide-budget/1", "generatedAt": "<ISO 8601 UTC>", "commit": "<40 hex>" | null,
//     "budget": { "tokens": 5000, "model": "claude-opus-5-5" },
//     "paths": [ { "role": "buyer" | "seller", "files": ["llms.txt", "buy.txt"], "bytes": 0, "tokens": 0,
//                  "estimate": 0, "counted": 0 | null, "method": "estimate" | "count_tokens", "budgetBps": 0 } ] }
//
// `tokens` is what the budget holds: the provider's count (`counted`, Anthropic's count_tokens for the pinned model)
// when the build had a key, else `estimate`, bytes divided by four, rounded up. `budgetBps` is tokens over the
// budget in basis points, rounded down (9,800 is 98%). Integers only.
import { FIRST_DEAL_BUDGET } from './guides.mjs';

export const GUIDE_BUDGET_SCHEMA = 'crow.guide-budget/1';
export const GUIDE_BUDGET_FILE = 'guide-budget.json';

/**
 * The file's body from measurePaths()'s rows. Pure.
 * @param {{ role: string, files: string[], bytes: number, estimate: number, counted: number | null, tokens: number }[]} measured
 * @param {{ generatedAt: Date, commit: string | null, budget?: { tokens: number, model: string } }} at
 */
export function guideBudget(measured, { generatedAt, commit, budget = FIRST_DEAL_BUDGET }) {
  return {
    schema: GUIDE_BUDGET_SCHEMA,
    generatedAt: generatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    commit: typeof commit === 'string' && /^[0-9a-f]{40}$/.test(commit) ? commit : null,
    budget: { tokens: budget.tokens, model: budget.model },
    paths: measured.map((m) => ({
      role: m.role,
      files: [...m.files],
      bytes: m.bytes,
      tokens: m.tokens,
      estimate: m.estimate,
      counted: m.counted,
      method: m.counted === null ? 'estimate' : 'count_tokens',
      budgetBps: Math.floor((m.tokens * 10_000) / budget.tokens),
    })),
  };
}
