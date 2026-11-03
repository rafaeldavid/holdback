# T-053: The monthly cost report and unit costs

- **Lane:** infra
- **Phase:** 10
- **Depends on:** T-052 (the collector's output); T-213 (Sepolia settlement, PR 138) deployed, for the gas per deal only
- **Paths this task may touch:** `scripts/costs/report.mjs` (new), `scripts/costs/units.mjs` (new), `config/model-prices.json` (new), `tests/costs/report.test.ts` (new), `tests/costs/fixtures/` (synthetic only), `package.json` (a `costs:report` script), `docs/costs.md` (the report and unit-cost sections), `docs/tasks/T-053-cost-report-unit-costs.md`
- **Human gate:** no. Rafa sets his budgets in `budgets.json` in the cost directory, outside git, which needs no approval.
- **Status:** todo
- **Agent/session:** —

## Intent

Turn the collector's daily files into one page a month that answers three questions: what did Crow cost, per provider and in all; what does one demo deal and one merged PR cost; and is anything about to hit a cap or a free-tier limit.

- Inputs: the collector's daily files (T-052), `budgets.json` and the register (T-051) in the cost directory, merged PRs from GitHub's REST API (`GET /repos/rafaeldavid/holdback/pulls?state=closed`, keeping those with `merged_at`; no token, since the repository is public), the Sepolia receipts of the month's deals, and a dated table of list prices.
- Output: `<YYYY-MM>.md` in the cost directory, rewritten each day for the current month, and final after the month ends.
- Non-goals: alerts (T-054), anything tracked in git, any chart or dashboard.

## Context

- `docs/costs.md`, "The monthly report" and "Unit costs": the sections and the definitions this task implements.
- T-031's day lines: `deals` (the funnel, including `final`) and `liveJudges` (calls and tokens, with no model split: `apps/demo-cloud/src/judges.ts`, measured).
- D33 as amended on 2026-11-03 (PR 138): the operator recovers gas through its fee; the report shows whether it does.

## Rafa's steps

1. Read the first real report (agent step 4) and set your budgets and the mainnet gas and ETH prices to show in `budgets.json` (human, 15 min, guessed).

## Agent steps

1. **`config/model-prices.json`** (tracked: public list prices only; JSON, since `scripts/costs/` imports only `node:` modules, T-052). One entry per model the judges and the agents use: input, output, cache writes by lifetime and cache reads in micro-dollars per million tokens (integers); any multiplier for fast mode (`speed`) or a service tier; server tool use per request; DeepSeek's peak and off-peak hours; the source URL and the date read. The report flags any price older than 90 days and any usage field it has no price for.
2. **`report.mjs`** renders the sections in `docs/costs.md`: each provider's month to date, forecast and budget; fixed costs; free-tier and included-usage headroom; unit costs; anomalies and unreadable sources. Each figure carries its basis: billed, estimated or entered by hand. Amounts in another currency (a DeepSeek balance in CNY) stay in that currency.
3. **`units.mjs`**:
   - **Per demo deal:** gas from each deal's receipts (`gasUsed` × `effectiveGasPrice`), in Sepolia ETH and at the mainnet gas price and ETH price in `budgets.json`. Judges: an upper bound per live panel of three, the day's `liveJudges` tokens at the most expensive live model's prices, divided by the day's live calls, times three. Cloudflare: the month's usage-based cost over T-031's `final` deals. The operator fee earned beside it.
   - **Per merged PR:** the transcript tokens on the PR's branch, subagents included (T-052's `claude-code` source), at list price, labeled "laptop sessions only"; and the plan fee's share (the month's plan fee over the month's merged PRs). A branch with transcripts but no merged PR counts as unmerged work, shown as one total.
   - **Per task:** merged PRs grouped by the task ID in the branch name (`t-<id>-…`, case-insensitive); other branches group as "no task".
4. **The first real report.** Run it on Rafa's machine after a week of daily files, and tell Rafa it is there.

## Acceptance criteria

- [ ] `pnpm vitest run tests/costs/report.test.ts` passes: a synthetic month of collector files renders the expected report; the unit costs match hand-computed values on the fixture; all arithmetic is integer or bigint (a test checks a sum that floats would get wrong).
- [ ] A deal whose receipts are missing, or a PR whose branch has no transcripts, is listed as unknown, not as zero.
- [ ] A month in which a source failed on some days says which days, and does not forecast from a partial series without saying so.
- [ ] `config/model-prices.json` cites a URL and a date for every price, and the report shows the date of each price it used and names any usage field it could not price.
- [ ] The first real report exists on Rafa's machine; Evidence says so and lists its section headings, with no figure (measured).

## Out of scope

- Rules and alerts (T-054), the schedule (T-055), the planned-cost budget (T-056), a per-model split of the judges' tokens (a change to T-031's `liveJudges`, for the api lane).

## Evidence

## Decisions

## Handoff
