# T-051: Cost guards on every account

- **Lane:** infra
- **Phase:** 10
- **Depends on:** nothing. It can start today, before the rest of Phase 10 and before Phase 9.
- **Paths this task may touch:** `docs/costs.md` (the "Tier today" column, with no amount), `docs/tasks/T-051-cost-guards.md`; outside git, `reports/costs/register.md` (git-ignored)
- **Human gate:** **yes.** Every step changes a billing setting in one of Rafa's accounts. Agents never open a billing page, create a credential or read one.
- **Status:** todo
- **Agent/session:** —

## Intent

Put a stop or an alarm on every account that can spend money for Crow, before any monitoring code exists. Where a provider can stop spending, set the stop. Where it can only warn, set the warning. Then write down, privately, what each account is on and when it renews.

- Inputs: the inventory in `docs/costs.md`.
- Outputs: a cap or an alert on each account, and the git-ignored register `reports/costs/register.md`.
- Non-goals: read-only credentials (T-052), any code, the agents' own accounts in T-039 (`crow-agents` workspace, `crow-deploy` token).

## Rafa's steps

Every step is **human**. Times and suggested amounts are guesses; pick your own. Do them in this order: the first steps cover metered spend that the public demo or a runaway agent can drive.

1. **Anthropic: the organization's monthly limit** (5 min).
   1. Open the Console at https://platform.claude.com (console.anthropic.com redirects there). Check that your account is an organization (Settings, Organization). The Admin API that T-052 reads is unavailable for individual accounts (documented).
   2. Open Settings, Billing, and set a monthly spend limit, for example $100. It cannot exceed your usage tier's cap. At the limit, every API call answers 429 until the first of the next month (documented), so the live judges fall back to scripted, labeled verdicts (T-028).
2. **Anthropic: a capped workspace for the judges' key** (15 min). The Default workspace cannot hold a spend limit (documented).
   1. At https://platform.claude.com/settings/workspaces, check which workspace holds the key named in the Worker secret `HOLDBACK_ANTHROPIC_API_KEY`. If it already sits in its own workspace with a limit, skip to step 3.
   2. Choose Create workspace and name it `crow-judges`. Under Spend limits, set a monthly limit, for example $20, and add notifications at 50% and 80%.
   3. At https://platform.claude.com/settings/keys, create a key in `crow-judges`.
   4. Put it in `.env` as `HOLDBACK_ANTHROPIC_API_KEY` and run `pnpm demo-cloud:secrets`, which pipes it to the Workers without printing it (`docs/operations.md`, Secrets). Then delete the old key.
3. **Claude plan: the extra-usage limit** (5 min). At https://claude.ai/settings/usage, check your plan and whether extra usage is on. If it is, set its monthly spend limit (documented). If Claude Code ever runs on an API key instead, it gets its own workspace and limit (T-039, step 7).
4. **DeepSeek: a small prepaid balance** (5 min). DeepSeek offers no spend limit (documented: none found), so the balance is the cap. At https://platform.deepseek.com, read the balance and keep it small, for example $10. Make sure no automatic top-up is set. Top up by hand at https://platform.deepseek.com/top_up.
5. **Cloudflare: plan, budget alerts and usage notifications** (15 min).
   1. Confirm the plan under Workers & Pages, Plans. D41 records Workers Paid since 2026-11-02 as reported, not checked.
   2. Under Manage Account, Billing, Billable Usage, choose Create budget alert. Make two: $10 and $25. Cloudflare may already have created a $10 one by default. These email you once when usage-based spend crosses the amount, the day after; they never stop anything, and the $5 plan fee is not counted (documented).
   3. Under Notifications, Add, Billable Usage, add usage notifications for Durable Objects requests at 500,000 a month and rows written at 25,000,000 a month: half of what Workers Paid includes (documented amounts; the half is a guess).
   4. Under Domain Registration, Manage Domains, open `escrow.stream`. Check that auto-renew is on, note the expiry date and the renewal price, and check that the card on file is current.
6. **GitHub: budgets at zero that stop usage** (10 min).
   1. At https://github.com/settings/billing, open Budgets and alerts, then New budget.
   2. Create a product-level budget of $0 with "Stop usage when budget limit is reached" for each paid product you do not use: Actions, Packages, Codespaces, and Copilot if you do not pay for it (documented).
   3. Turn on "Receive alerts when my included usage reaches 90% and 100%".
   4. Public-repository Actions on standard runners are free and are not metered (documented), so a $0 budget should not stop CI (inferred). Check that the next CI run on any PR starts and passes.
7. **Sepolia: note the balances** (2 min). Nothing to cap: the lane balances are the cap, and below 0.02 Sepolia ETH a lane warns and pauses the faucet (ADR-0028). Open the funding lane named in the demo's discovery notes (`GET https://api.escrow.stream/`) on https://sepolia.etherscan.io and note its balance and date.
8. **Flat-price accounts** (5 min). Check the plan and renewal date of here.now (https://here.now) and 1Password. If here.now only serves the old redirect, the free plan is enough (inferred).
9. **The register** (10 min). Record, for each account: the plan or tier, the renewal date, the cap or alert you set and its value, and the date. Either tell an agent the values in chat, and it writes `reports/costs/register.md`, or write it yourself. The file is git-ignored; nothing in it reaches the repository.

About 1 hour 15 minutes in all (guessed).

## Agent steps

1. Write `reports/costs/register.md` from Rafa's values when he gives them in chat: one row per account in `docs/costs.md`, with the columns from step 9. Never commit it (`reports/` is git-ignored; check with `git check-ignore`).
2. Update `docs/costs.md`, "Tier today", with facts that carry no amount and that Rafa agrees to make public: for example "Workers Paid (confirmed 2026-11-…)". The plan of a personal account, a balance or a limit stays out.
3. Fill Evidence and Handoff, and flip Status to done once Rafa confirms every step.

## Acceptance criteria

- [ ] Steps 1 to 9 are each ticked in Handoff with a date, or marked skipped with a reason (human).
- [ ] `reports/costs/register.md` has one row per account in the inventory, and `git check-ignore reports/costs/register.md` prints its path (measured).
- [ ] The first CI run after step 6 started and passed (measured).
- [ ] No amount, balance, account ID or plan of a personal account appears in a tracked file (checked by reading the diff).

## Out of scope

- Read-only billing credentials and the collector (T-052), CPU limits per Worker (T-054: they need measured CPU time first), the agents' own accounts and keys (T-039).

## Evidence

## Decisions

- Suggested amounts are guesses, sized to today's use: the judges cost cents a day under the 30-call cap, and `pnpm demo --live` about $3 a run (T-028, measured tokens).
- Vendor facts are from the vendors' pages, read 2026-11-03; `docs/costs.md` labels each.

## Handoff
