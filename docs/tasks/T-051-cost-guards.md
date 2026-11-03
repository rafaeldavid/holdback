# T-051: Cost guards on every account

- **Lane:** infra
- **Phase:** 9
- **Depends on:** nothing. It can start today, before the rest of Phase 9 and before the agent-ops phase.
- **Paths this task may touch:** `docs/costs.md` (the "Tier today" column, with no amount), `docs/tasks/T-051-cost-guards.md`; outside git, the register `register.md` in the directory Rafa names for it, which becomes `CROW_COSTS_DIR` in T-052
- **Human gate:** **yes.** Every step changes a billing setting in one of Rafa's accounts. Agents never open a billing page, create a credential or read one.
- **Status:** todo
- **Agent/session:** —

## Intent

Put a stop or an alarm on every account that can spend money for Crow, before any monitoring code exists. Where a provider can stop spending, set the stop. Where it can only warn, set the warning. Flat-price and keyless accounts get a renewal date instead. Then write down, privately, what each account is on and when it renews or expires.

- Inputs: the inventory in `docs/costs.md`.
- Outputs: a cap or an alert on each account that can spend, and the git-ignored account register.
- Non-goals: read-only credentials (T-052), any code, the agents' own accounts in T-039 (`crow-agents` workspace, `crow-deploy` token).

## Context

- `docs/costs.md`: the inventory, what each provider can cap or only alert on, and "A limit that stops spending also stops service".
- `docs/backlog.md`, Public demo: at an Anthropic or DeepSeek limit, today's code records the judges' seats as errors instead of falling back to scripted judges, and `pnpm demo --live` spends from the judges' key.
- `docs/operations.md`, Secrets: how model keys reach the Workers.

## Rafa's steps

Every step is **human**. Times and suggested amounts are guesses; pick your own. Do them in this order: the first steps cover metered spend that the public demo or a runaway agent can drive.

1. **Anthropic: the organization's monthly limit** (5 min).
   1. Open the Console at https://platform.claude.com (console.anthropic.com redirects there). Check that your account is an organization (Settings, Organization). The Admin API that T-052 reads is unavailable for individual accounts (documented).
   2. Open Settings, Billing, and set a monthly spend limit: at least the sum of your workspace limits (`crow-judges` from step 2, and `crow-agents` once T-039 creates it), plus room for development. For example $150 with the $100 judges' choice in step 2, or about $550 with the $450 one. It cannot exceed your usage tier's cap. At the limit, every key in the organization gets 429 until the first of the next month (documented).
2. **Anthropic: a capped workspace for the judges' key** (20 min). The Default workspace cannot hold a spend limit (documented).
   1. At https://platform.claude.com/settings/workspaces, find the workspace that holds the key in `HOLDBACK_ANTHROPIC_API_KEY`. If it is already its own workspace with a limit, skip to step 3.
   2. Choose Create workspace and name it `crow-judges`. Under Spend limits, set a monthly limit and add notifications at 50% and 80%. Choose the limit knowing what happens when it binds: the Claude seats error and rubric deals escalate or reject until the next month, because the code falls back to scripted judges only when its own 30-call daily budget runs out (measured in code; `docs/backlog.md`). Two choices:
      - **$100 (recommended for now, guessed).** Today's use is cents a day, so the 50% and 80% emails leave weeks to react. A month of heavy deliverables could still reach it.
      - **About $450.** Above the code's worst case on the demo CSV, about $15 a day (30 calls of up to about $0.50 each; inferred from T-028), so the daily call cap binds first on deliverables like it. A denser deliverable could cost more a call (`docs/costs.md`); T-054 measures the heaviest call.
   3. `pnpm demo --live` reads the same variable (`apps/demo/src/cli.ts`), so its runs, about $3 each, count against this limit until local runs get their own key (`docs/backlog.md`).
   4. At https://platform.claude.com/settings/keys, create a key in `crow-judges`. Put it in `.env` as `HOLDBACK_ANTHROPIC_API_KEY` and run `pnpm demo-cloud:secrets`, which pipes it to the Workers without printing it (`docs/operations.md`, Secrets).
   5. Check that the new key is in use before deleting the old one. The World Durable Object reads its secrets when it starts (`apps/demo-cloud/scripts/secrets.mjs`), so a deal right after step 4 may still run on the old key. Run `node apps/demo-cloud/scripts/deal.ts https://api.escrow.stream https://api2.escrow.stream --rubric`, check that no verdict it prints carries "[fake judge, no model ran]" (scripted seats keep the model IDs once the daily budget is spent), and check in the Console that the new key shows recent use. Then delete the old key.
3. **Claude plan: the extra-usage limit** (5 min). At https://claude.ai/settings/usage, check your plan and whether extra usage is on. If it is, set its monthly spend limit (documented). If Claude Code ever runs on an API key instead, it gets its own workspace and limit (T-039, step 7).
4. **DeepSeek: a small prepaid balance** (5 min). DeepSeek offers no spend limit (documented: none found), so the balance is the cap; an empty balance errors the DeepSeek seats as a limit does the Claude seats (inferred). At https://platform.deepseek.com, read the balance and its currency, and keep it small, for example $10. Make sure no automatic top-up is set. Top up by hand at https://platform.deepseek.com/top_up. The agent-ops phase's review keys share this balance unless they live in a second account (T-039, step 7).
5. **Cloudflare: plan, budget alerts and usage notifications** (15 min).
   1. Confirm the plan under Workers & Pages, Plans. D41 records Workers Paid since 2026-11-02 as reported, not checked.
   2. Under Manage Account, Billing, Billable Usage, choose Create budget alert. Make two: $10 and $25. Cloudflare creates a $10 one by default on eligible accounts that have none (documented, Cloudflare changelog 2026-06-15). These email you once when usage-based spend crosses the amount, the day after; they never stop anything, and the $5 plan fee is not counted (documented).
   3. Under Notifications, Add, Billable Usage, add usage notifications for Durable Objects requests at 500,000 a month and rows written at 25,000,000 a month: half of what Workers Paid includes (documented amounts; the half is a guess).
   4. Under Domain Registration, Manage Domains, open `escrow.stream`. Check that auto-renew is on, note the expiry date and the renewal price, and check that the card on file is current.
6. **GitHub: budgets at zero that stop usage** (10 min). A budget covers your whole account, every repository in it.
   1. At https://github.com/settings/billing, open Budgets and alerts, then New budget.
   2. Create a product-level budget of $0 with "Stop usage when budget limit is reached" for each paid product you do not use in any repository: Actions, Packages, Codespaces, and Copilot if you do not pay for it (documented). Skip a product another repository of yours needs.
   3. Turn on "Receive alerts when my included usage reaches 90% and 100%".
   4. Public-repository Actions on standard runners are free and are not metered (documented), so a $0 budget should not stop CI (inferred). Check that the next CI run on any PR starts and passes.
7. **Sepolia: the balances and addresses** (5 min). The funding lane's balance is the cap on every lane: the Sepolia world tops a deal lane up from it when the lane drops below 0.01 Sepolia ETH, and a lane that cannot pay answers `relay_refused`. Note the public addresses and balances, with the date, of the funding lane (named in the demo's discovery, `GET https://api.escrow.stream/`), the deal lanes (printed by `node apps/demo-cloud/scripts/relayer.mjs` when it made them), and the deployer. Read balances at https://sepolia.etherscan.io.
8. **Flat-price accounts** (5 min). Check the plan and renewal date of here.now (https://here.now) and 1Password. If here.now only serves the old redirect, the free plan is enough (inferred).
9. **The register** (10 min). Record, for each account: the plan or tier, the renewal date, the cap or alert you set and its value, the expiry of any token or key, the public Sepolia addresses, and the date. Choose its directory: an absolute path outside every checkout where agents work, for example `reports/costs/` inside the dedicated clone (T-052, step 1, which you can do now). It becomes `CROW_COSTS_DIR`. Either tell an agent the values and the directory in chat, and it writes `register.md` there, or write it yourself. Nothing in it reaches the repository.

About 1 hour 30 minutes in all (guessed).

## Agent steps

1. Write the register from Rafa's values when he gives them in chat: `register.md` in the directory he names, never a worktree's `reports/` (it goes when the worktree does), one row per account in `docs/costs.md`, with the columns from step 9. If that directory is inside a git checkout, check that `git check-ignore` prints its path; never commit it.
2. Update `docs/costs.md`, "Tier today", with facts that carry no amount and that Rafa agrees to make public: for example "Workers Paid (confirmed 2026-11-…)". The plan of a personal account, a balance or a limit stays out.
3. Fill Evidence and Handoff, and flip Status to done once Rafa confirms every step.

## Acceptance criteria

- [ ] Steps 1 to 9 are each ticked in Handoff with a date, or marked skipped with a reason (human).
- [ ] The register has one row per account in the inventory, outside every worktree, and git-ignored if it sits in a checkout (measured).
- [ ] The rubric deal in step 2.5 showed no scripted verdict, and the Console showed the new key in use (measured).
- [ ] The first CI run after step 6 started and passed (measured).
- [ ] No amount, balance, account ID or plan of a personal account appears in a tracked file (checked by reading the diff).

## Out of scope

- Read-only billing credentials and the collector (T-052), CPU limits per Worker (T-054: they need measured CPU time first), the agents' own accounts and keys (T-039), the code fixes in `docs/backlog.md` (the 429 fallback, a separate key for `pnpm demo --live`).

## Evidence

## Decisions

- Suggested amounts are guesses, sized to today's use: the judges cost cents a day under the 30-call cap, and `pnpm demo --live` about $3 a run (T-028, measured tokens).
- Vendor facts are from the vendors' pages, read 2026-11-03; `docs/costs.md` labels each.

## Handoff
