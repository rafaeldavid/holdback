# Costs: what Crow spends on, and how it is watched

Building and running Crow draws on about a dozen paid or rate-limited services. This file lists each one: what drives its cost, how it bills, what can cap or alert on it, and where to read its usage without write access. It also sets out the monitoring that Phase 9 in `docs/plan.md` builds (T-051 to T-056).

Every account here is Rafa's. This file holds no figure from his bills, no account ID and no plan he has not published. Those, and every report, budget and threshold, live only in the cost directory, `CROW_COSTS_DIR`: an absolute path outside every checkout where agents work (T-052).

Labels: **measured** (run or read in this repository or by a read-only API call, 2026-11-03), **documented** (read on the vendor's own page, 2026-11-03), **inferred**, **guessed**. Prices change: recheck the vendor's page before relying on one.

## Inventory

### Running the demo

| Source | What drives the cost | Unit and price | Tier today | Cap or alert offered | Read-only usage source |
| --- | --- | --- | --- | --- | --- |
| Cloudflare Workers and Durable Objects: `holdback-op1`, `holdback-op2`, `crow-site`, `crow-early-access` | Requests to the four Workers. The World Durable Object's requests (each alarm counts as one), duration, rows read (each cold start lists the whole journal) and rows written (each `setAlarm` counts as one). Workers Logs lines | Workers Paid: $5 a month minimum. Included each month: 10M requests, 30M CPU ms, 1M Durable Object requests, 400,000 GB-s, 25 billion rows read, 50M rows written, 5 GB-month stored, 20M log lines; then billed per million (documented). Workers Free has daily limits that fail until 00:00 UTC: 100,000 Durable Object requests, 5M rows read, 100,000 rows written (documented) | Workers Paid, reportedly since the 2026-11-02 outage (D41; not checked from here) | No spend cap on Workers Paid (documented: none found). Budget alerts: one email when usage-based spend crosses a dollar amount; usage is processed daily, the plan fee is not counted, and nothing is paused (documented). Usage Based Billing notifications on one product metric (documented). A CPU limit per Worker invocation, set "to prevent accidental runaway bills" (documented); it does not cap Durable Object requests, duration or rows (inferred) | Billable Usage API: `GET https://api.cloudflare.com/client/v4/accounts/{account_id}/billable-usage?from=&to=`, a token with Billing Read, daily rows per product (documented). GraphQL Analytics API, a token with Account Analytics Read (documented); the datasets are named in `docs/operations.md`. T-031's day lines (`usage`, `deals`, `liveJudges`) |
| Cloudflare Workers KV: `EMAILS` (bound); `FEEDBACK` (not bound yet, created at Rafa's feedback setup, `docs/operations.md`) | Writes from sign-ups, and from feedback reports once bound (at most 300 a day) | Free: 1,000 writes a day. Paid: 1M writes a month included (documented) | As above | As above | Billable Usage API |
| Cloudflare D1, R2, Queues | Not used: no wrangler file binds them (measured) | — | — | A new product line in billable usage is an anomaly (T-054) | Billable Usage API |
| Cloudflare Registrar: `escrow.stream` | The yearly renewal | At cost, no markup; auto-renew is on by default (documented). The `.stream` price is not on Cloudflare's public pages; read it in the dashboard | Bought 2026-11-01 (`brand/domain.md`) | None; watch the renewal date and the card on file | Dashboard, Domain Registration |
| Anthropic API: the live judges | Tokens per judge call on Sonnet 5.5, Opus 5.5 and Sonnet 5 (`config/judges-live.yaml`). Input tokens follow deliverable size: a large CSV costs up to about 50 times a small diff (`docs/backlog.md`) | Per million tokens, by model. In code: at most 30 live calls a day and 8,192 output tokens a call (T-028, measured). 11 public-demo calls cost under $0.15; a call on the demo CSV (60k to 75k input tokens) costs up to about $0.50, so on that CSV the code's worst case is about $15 a day (T-028, inferred from measured tokens and cost). A deliverable that tokenizes more densely, up to the prompt's 100,000-character data cap (`packages/judgment/src/prompt.ts`), could cost more a call (inferred) | Unknown: which workspace holds the judges' key, and whether it has a limit. `pnpm demo --live` reads the same variable, so local runs spend from the same key (measured: `apps/demo/src/cli.ts`) | An organization monthly spend limit on the Console's Billing page, up to the usage tier's cap; workspace spend limits with alert thresholds, not on the Default workspace (documented). At either limit the API answers 429 until the next month (documented). The code does not fall back to scripted judges on a 429: the Claude seats are recorded as errors, so rubric deals escalate or reject until the reset; scripted judges take over only when the code's own daily call budget runs out (measured: `apps/adjudicator/src/providers/live.ts`, `apps/demo-cloud/src/judges.ts`; backlog) | Admin API: `GET /v1/organizations/cost_report` (USD cents as decimal strings, daily buckets only) and `GET /v1/organizations/usage_report/messages` (1-minute, hourly or daily buckets, grouped by workspace, key or model); data appears within about 5 minutes (documented). It needs an Admin key (`sk-ant-admin01-…`), which only an organization's admin can create and which carries full access: no read-only scope exists, and the Admin API is unavailable for individual accounts (documented) |
| DeepSeek API: the live judges, and later the agent-ops phase's cross-family reviews (T-045) | Tokens per call on `deepseek-flash` and `deepseek-v4-pro` | Per million tokens at peak: flash $0.30 input on a cache miss and $1.20 output; v4-pro $1.32 and $3.96. Off-peak is half; peak is 01:00 to 04:00 and 06:00 to 10:00 UTC on weekdays (documented) | Prepaid balance; amount unknown. Review keys share it unless they live in a second account (T-039, step 15) | No spend limit found: the prepaid balance is the cap (documented: none on the pricing pages). An empty balance errors the DeepSeek seats, as a 429 does the Claude seats (inferred) | `GET https://api.deepseek.com/user/balance`: `is_available`, and per currency (CNY or USD) the total, granted and topped-up balance (documented). It takes an API key, and any key on the account can also spend (inferred) |
| Sepolia gas: the relayer lanes, the deployer and the demo adjudicators | Each relayed transaction and faucet mint: about 0.0006 Sepolia ETH a `try.ts` deal at a 1 gwei tip (ADR-0028 research, inferred). The Sepolia world tops a deal lane up with 0.03 from the funding lane when it falls below 0.01 (measured: `apps/demo-cloud/src/world.ts`) and sends each demo adjudicator 0.01 at setup (ADR-0028 research §6). The deployer pays for contract deployments (T-206) | Sepolia ETH: free from faucets, but slow to get | 1.94 Sepolia ETH on the funding lane on 2026-11-03 (D41, measured by the coordinating session); the deployer's balance unknown | The funding lane's balance is the cap on every lane, through the top-ups. When a lane cannot pay, its writes answer `relay_refused` (`apps/demo-cloud/src/world.ts`) | `eth_getBalance` on a public RPC, no credential. Discovery names the funding lane (`docs/operations.md`); the deal lanes, the adjudicators and the deployer are public on chain but not in discovery, so their addresses go in the account register |
| Sepolia RPC | Reads and sends | Keyless public endpoints today (publicnode, tenderly; ADR-0028 research). Optional keyed free tiers: Alchemy 30M compute units a month; Infura 3M credits a day (documented) | Keyless | A free tier stops at its limit | The provider's dashboard |
| Etherscan API (optional, for source verification) | Calls | Free: 3 a second and 100,000 a day; from 2026-11-03, calls past the daily limit are blocked (documented) | Not signed up (inferred) | The free tier's hard limit | — |
| here.now | The old address's redirect, `npc.here.now/escrow` | Free $0, Hobby $4, Developer $20 a month (documented) | Unknown | Flat price | Account page |

### Building Crow

| Source | What drives the cost | Unit and price | Tier today | Cap or alert offered | Read-only usage source |
| --- | --- | --- | --- | --- | --- |
| Claude Code for the agent teams | Every session and subagent: tokens on the models it runs | On a Claude subscription, a flat monthly fee with 5-hour and weekly usage limits; Max costs $100 or $200 a month (guessed: third-party summaries, Anthropic's page not read). Extra usage beyond the plan has its own monthly spend limit (documented). With an API key instead, per token | Unknown: the plan, and whether extra usage is on | The plan's usage limits; the extra-usage spend limit at claude.ai, Settings, Usage; a workspace spend limit when an API key is used (documented) | No billing API covers subscription use: the Claude Code Analytics API covers only Console-key usage (documented). The local session transcripts under `~/.claude/projects/`, subagents included, record each response's model, input, output and cache tokens, session, working directory and git branch (measured), so a local script can price them at list price. Laptop sessions only: cloud or VM sessions leave no local transcript. OpenTelemetry's `claude_code.cost.usage` works on any plan (documented) |
| Anthropic API for development | `pnpm demo --live` (about $3 a run on the demo CSV, T-028), simulation batches (T-021), and later the agents' own `crow-agents` workspace (T-039) | Per million tokens | Unknown | As for the judges. Today `pnpm demo --live` spends from the judges' key (backlog); T-039 gives the agents their own capped workspace | Admin API, grouped by workspace or key, once development has its own key |
| GitHub | CI on every push and PR (9 jobs a run), and the GitHub Advanced Security features on this repository: CodeQL code scanning, secret scanning with push protection, Dependabot | Free for this repository: Actions on standard runners in public repositories, and code scanning, secret scanning and Dependabot alerts on public repositories (documented). Paid only if turned on: larger runners, Codespaces, Packages beyond the free amount, Copilot | Public repository; secret scanning, push protection and Dependabot security updates on; CodeQL default setup active (measured) | Budgets for a personal account, with "Stop usage when budget limit is reached" and alerts at 75, 90 and 100% (documented). A budget covers the whole account, every repository in it | `GET /users/{username}/settings/billing/usage`, with a fine-grained token holding the user permission Plan: read (documented, as quoted from GitHub's reference by search; the probe with the current `gh` token answered 503, measured) |
| 1Password | Seats | Individual $2.99 and Families $4.49 a month, billed annually; first-year promotional prices (documented) | Unknown | Flat price | Account page |
| exe.dev VM, if T-039 chooses option B | One VM | From $15 a month (T-039) | Not yet | Flat price | — |
| OpenAI, for the GPT fallback reviewer (T-040) | Review tokens | Per million tokens | Not yet | A project limit with "Enforce a hard limit" (T-039) | Not read |

### Planned

| Source | What drives the cost | Unit and price | Status | Cap or alert offered | Read-only usage source |
| --- | --- | --- | --- | --- | --- |
| Stripe (Phase 5 on-ramp) | Test mode now; live card and stablecoin fees later | Test mode: no fee listed (inferred). Live US cards about 2.9% + 30¢, stablecoin payments 1.5% (guessed: third-party summaries; Stripe's US page not read). The crypto on-ramp's fees are not on the page read | Test keys only, by the hard rule | — | Stripe dashboard and reporting API (not read) |
| Trademark on "Crow" | Search and filing | USPTO base fee $350 per class, plus $200 per class for a free-form description (inferred: several law-firm summaries agree; the USPTO page not read). Attorney fees separate (guessed: low thousands of dollars) | Not started (`docs/log/2026-11-03.md`) | — | — |
| External audit before mainnet | The contracts in scope: about 1,100 non-comment lines in `contracts/src` (measured, rough count), plus the drand verifier review (`docs/backlog.md`) | Vendor blogs range from about $5,000 for a token to $50,000 to $100,000 for a typical DeFi protocol (guessed) | Not started; mainnet is Rafa's gate | — | Quotes |
| Mainnet gas | Every funding, delivery and decision | `agreeAndFund` is about 245k gas: about $0.74 at 1 gwei and $3,000 an ETH (`docs/backlog.md`, inferred). The operator recovers it through its fee (D33, amended 2026-11-03) | Not started | — | Transaction receipts |
| A private inference provider for judges (D35) | Tokens | Not priced | Later | — | — |

## How costs are watched

Three layers, cheapest first.

1. **Caps and alerts at each provider (T-051).** Where a provider can stop spending, Rafa sets the stop: Anthropic's organization and workspace spend limits, GitHub budgets with "Stop usage", DeepSeek's prepaid balance, the Sepolia funding lane, the Claude plan's extra-usage limit. Where a provider can only warn, he sets the warning: Cloudflare's budget alerts and usage notifications. Flat-price and keyless accounts get a renewal date in the register instead. This needs no code.
2. **A daily read-only collector and a monthly report (T-052, T-053).** One script reads each provider's usage or billing API, the local Claude Code transcripts, T-031's day lines and the Sepolia balances, and writes `<date>.json` in the cost directory. A second script renders `<YYYY-MM>.md` beside it.
3. **Anomaly rules and a daily routine (T-054, T-055).** Rules over the collector's output catch what a monthly alert would catch too late. The routine runs collector, report and rules once a day on a machine Rafa controls, outside any agent session, and tells him when a rule fires or a run fails.

A limit that stops spending also stops service. At an Anthropic or DeepSeek limit, today's code records the judges' seats as errors rather than falling back to scripted judges, so rubric deals escalate or reject until the reset (backlog). Size each limit with that in mind (T-051, step 2).

### Where credentials and figures live

- Billing credentials stay in one file, `.env.costs`, at the root of a dedicated clone of the repository on a machine Rafa controls (T-052), loaded by the collector's launcher only after the approval check. No agent works in that clone or runs anything with that file: every step that needs it is Rafa's, and he passes on only results without a billing figure. A separate file keeps the Admin key away from the scripts that load `.env` (`pnpm demo`, `pnpm demo-cloud:secrets`, the feedback routine). `.gitignore` covers `.env.*`, and the permission deny list blocks reading it, but not a Bash command that loads it, so the file never sits in a checkout where agents work. Never in a build or deploy session, a Worker or GitHub Actions: the repository is public, so its workflow logs are public too.
- The dedicated clone only fast-forwards to `origin/main` after Rafa reads the diff. Every cost script that loads billing keys is a launcher: it imports only Node's built-in modules and the approval check, refuses to go on when `scripts/costs/`, its config or `.gitattributes` changed since the commit Rafa last approved (a git-ignored record beside `.env.costs`), and only then loads the keys and the rest of the code (T-052). Git runs with an allowlisted environment, so a hook cannot see a key. Agents may merge to `main` after CI and review, so this keeps agent-merged code from running with the Admin key unseen. The scripts run with `node`, never `pnpm`, so no `package.json` hook or package from the lockfile runs either.
- The Anthropic Admin key is the most sensitive key here. It has no read-only scope, so it can create and revoke keys and workspaces. If the Console organization can grant a narrower key later, switch to it.
- Reports, budgets, thresholds and the account register go in one cost directory: `CROW_COSTS_DIR`, a full path Rafa chooses outside the clone and outside every checkout, for example `/Users/<you>/crow-data/costs`. Agents never write there: they draft, and Rafa saves. No figure from it goes into a commit, a PR, an issue, the design map, the daily log or a PR footer.
- What the agent-ops phase may read goes in a separate directory, `CROW_TELEMETRY_DIR`, for example `/Users/<you>/crow-data/telemetry`: T-031's day lines and `cost-signals.json`, which holds rule names and no figure. Reading it never gives access to the clone or the cost directory.
- Money in the collector is an amount in cents as a decimal string, with its currency, parsed from the provider's text without ever becoming a float (hard rule). Ratios are basis points; token counts and wei are integers.

### Read-only credentials (T-052)

| Provider | Credential | Scope | Create it at |
| --- | --- | --- | --- |
| Cloudflare | API token `crow-costs-read` | Account · Billing · Read and Account · Account Analytics · Read, on this account only | https://dash.cloudflare.com/profile/api-tokens |
| Anthropic | Admin API key `crow-costs-read` | Full organization access: there is no read-only option (documented) | https://platform.claude.com/settings/admin-keys |
| GitHub | Fine-grained token `crow-costs-read` | User permission Plan: read; no repository access | https://github.com/settings/personal-access-tokens/new |
| DeepSeek | API key `crow-costs-read` | The same power as any key: nothing narrower exists (inferred) | https://platform.deepseek.com/api_keys |
| Sepolia | None | Public addresses on a public RPC | — |
| Claude Code | None | Local transcripts under `~/.claude/projects/` | — |

### Running the collector (T-052)

Only Rafa runs it, in the dedicated clone, with `.env.costs` at the clone's root (template: `config/keys-costs.template`). Run it with `node`, never `pnpm` (a `package.json` hook would run outside the approval check), and without `--env-file`: the launcher loads `.env.costs` itself, after the check.

```sh
node scripts/costs/approve.mjs                               # after reading the cost code; loads no keys
node scripts/costs/collect.mjs
```

It prints one status per source (`read`, `not configured` or `failed (<type> <status> <code>)`, where the status and the code appear only when they exist) and the path it wrote, never a figure. The Sepolia and Claude Code sources need no credential, so a first run shows balances and tokens before any token exists.

**Updating the clone.** Agents may merge to `main` without Rafa, and a check written in the repository cannot defend against a change to itself. So the clone moves forward only like this, with git, not with the repository's code:

```sh
git fetch origin
git diff --text --no-textconv --no-ext-diff "$(cat .costs-approved)" origin/main -- scripts/costs config/costs.template.json config/model-prices.json .gitattributes
git merge --ff-only origin/main                              # only after reading that diff
node scripts/costs/approve.mjs
```

The flags keep a committed `.gitattributes` or a configured diff tool from hiding a change. Every cost script that loads keys refuses to run while the cost code differs from the approved commit or holds a symlink (`scripts/costs/approved.mjs`), which catches a pull nobody reviewed; the launcher runs that check before any other cost module loads. T-055's daily routine compares before it fast-forwards, so it never runs unapproved code.

**What it writes.** In `CROW_COSTS_DIR`: `<YYYY-MM-DD>.json` and the same content in `latest.json`, which the founders' control page reads, plus `claude-code-<YYYY-MM-DD>.json` with tokens per day, session, branch and model for T-053. In `CROW_TELEMETRY_DIR`: `day-<YYYY-MM-DD>.json`, one per T-031 day line found in `inbox/`.

```json
{
  "date": "2026-11-03",
  "lines": [{ "source": "cloudflare-billing", "product": "Workers Standard", "unit": "Requests", "quantity": "3000",
              "amount": { "cents": "30", "currency": "USD" }, "basis": "billed", "periodFrom": "2026-11-01", "periodTo": "2026-11-02" }],
  "sources": [{ "source": "deepseek", "ok": false, "error": { "type": "http", "status": 401 } },
              { "source": "claude-code", "ok": true, "note": "laptop sessions only; …" }]
}
```

- `quantity` and `amount.cents` are decimal strings with no exponent. Quantities are integers except where a provider reports fractions (Cloudflare's GB-months, CPU-time quantiles); cents can be fractional (Anthropic reports "123.78912").
- `basis`: `billed` comes from a billing API; `balance` is a balance at the date; `estimated` is usage with no amount yet (tokens, requests), which T-053 prices.
- `amount.currency` is the provider's: DeepSeek balances can be in CNY.
- Sepolia lines are in `wei`, one per public address: the funding lane and the adjudicators from discovery, and the deal lanes and deployer listed in `budgets.json` (`sepolia.addresses`). A deal lane under the floor gets a second line, "(second read)", two minutes later.
- Source ids: `cloudflare-billing`, `cloudflare-analytics`, `anthropic`, `github`, `deepseek`, `sepolia`, `claude-code`, `telemetry`. An error type is one of `not_configured`, `network`, `timeout`, `http`, `parse`, `shape`, `graphql`, `chain`, `unexpected`.
- An error may carry a `code`, one short word and never a message or a body:
  - `http`: the `error.type` of the response body when it is a lowercase word of at most 40 letters and underscores, as Anthropic and DeepSeek send it. Example: `{ "type": "http", "status": 403, "code": "permission_error" }`.
  - `graphql` from `cloudflare-analytics`: the kind of Cloudflare's first error, from its documented messages: `permission`, `query`, `time-range`, `limits`, `rate-limit` or `unavailable`. If no message matches, the code is Cloudflare's own `extensions.code` when that is such a word, or otherwise `other`. Then comes `:` and the dataset, when the error names one (`workers`, `durableObjects` or `storage`). Example: `{ "type": "graphql", "status": null, "code": "query:storage" }`. `permission` means the token lacks Account Analytics Read; `query` means the query no longer matches Cloudflare's schema.

**T-031's day lines.** Cloudflare's telemetry query API accepts only a Workers Observability *Write* permission, so the collector does not call it. Rafa saves the Workers Logs he wants read (a dashboard export, or `npx wrangler@4 tail holdback-op1 --format json` output) into `CROW_TELEMETRY_DIR/inbox/`; the collector finds the day lines in any JSON or JSON-lines shape.

### The monthly report (T-053)

`<YYYY-MM>.md` in the cost directory holds:

- each provider's month-to-date spend, the forecast to month end, its budget and its share of any cap;
- fixed costs: plan fees, and the domain's renewal spread over twelve months;
- free-tier and included-usage headroom: Cloudflare's included amounts, Etherscan and RPC free tiers, faucet ETH;
- unit costs (below);
- the anomalies of the month and any provider the collector could not read.

Each figure says whether it was billed (from a billing API), estimated (tokens at list price) or entered by hand.

### Unit costs (T-053)

- **Per demo deal.** Gas from the deal's transaction receipts (`gasUsed` × `effectiveGasPrice`), shown in Sepolia ETH and at a stated mainnet gas price and ETH price, so the figure means something before mainnet. Plus the judges: T-031's `liveJudges` has the day's live calls and tokens but no model split (measured), so the cost per live panel of three is an upper bound, the day's tokens at the most expensive live model's prices, divided by the day's live calls and multiplied by three. Plus the month's usage-based Cloudflare cost divided by T-031's deals that reached `final`. The operator fee earned is shown beside it, so the report says whether the fee covers the gas (D33 as amended on 2026-11-03).
- **Per merged PR.** The tokens of every transcript message on the PR's branch, subagents included, priced at list price from a dated price table: the cost at API prices, for laptop sessions only. Beside it, the share of the plan fee: the month's plan fee divided by the month's merged PRs, which is what was actually paid on a subscription. CI is free for this public repository; its wall-clock time belongs to T-049.
- **Per task.** The PRs whose branch carries the task ID (`t-<id>-…`), summed.

### Anomaly rules (T-054)

Starting thresholds are guesses. Rafa sets his own in `budgets.json` in the cost directory.

| Rule | Source | Starting threshold (guessed) | What it catches |
| --- | --- | --- | --- |
| A runaway agent | Transcripts | One session above 3M tokens in an hour, or one branch above $50 at list price in a day | A loop burning plan limits or an API budget |
| A spend spike | Each provider's daily cost | A day above 3 times the trailing 7-day median, and above $2 | New usage, before a monthly alert |
| A cap near | Anthropic month to date against each workspace limit; the DeepSeek balance | 80% of a limit; a balance under $5 | The judges' seats about to error, which escalates rubric deals |
| A Durable Object quota near | T-031's `alert: "durable-object-quota"` lines on Workers Free; Billable Usage month to date against the included amounts on Workers Paid | 80% of a limit or an included amount | The 2026-11-02 outage, or its paid-plan equivalent: a bill |
| A relayer low on gas | `eth_getBalance` on the funding lane and each deal lane | The funding lane under 0.05 Sepolia ETH or under 7 days of runway at the trailing week's burn; a deal lane under 0.01 on two reads two minutes apart (top-ups run at most once a minute) | The funding lane running dry, which stops every lane's top-ups |
| Live judges at their cap | T-031's `liveJudges` | The daily cap reached three days running | Demand: raise the cap or the budget |
| Paid usage that should be zero | GitHub usage; a new Cloudflare product line; a new Anthropic workspace or key | Any amount above $0, any new line | Something turned on by mistake |
| A renewal or expiry due | The account register | A renewal, or a credential's expiry, within 30 days | The domain most of all, then the read-only tokens |

### What this feeds, and what it does not repeat

- **T-031 (product telemetry):** T-052 exports T-031's day lines once, to the private export T-042 names (`CROW_TELEMETRY_DIR`), and the collector reads that file. It adds nothing to the nodes.
- **T-042 (the agent-ops phase, the usage-telemetry lane):** it reads the same day-line export, and may read `cost-signals.json` beside it, which holds the date, each source's status and the names of the rules that fired, never a figure (T-055). It never reads the cost directory.
- **T-047 (the agent-ops phase, daily figures):** its spend figure comes from the pipeline's own token tallies, never from billing data. Its outputs, the daily log and the PR footer, are public, so no billing figure may reach them.
- **T-039 (the agent-ops phase, the isolated environment):** its steps 5, 15 and 17 set caps for the agents' own accounts, and its step 12 points to T-051 and T-054 for the live accounts. Billing credentials stay out of T-039's build and deploy sessions.
- **T-049 (the agent-ops phase, CI cost):** on this public repository, CI costs time, not money.

Uptime and self-healing for the hosted demo stay in `docs/backlog.md` ("Reliable production maintenance").
