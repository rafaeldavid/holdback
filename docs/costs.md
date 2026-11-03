# Costs: what Crow spends on, and how it is watched

Building and running Crow draws on about a dozen paid or rate-limited services. This file lists each one: what drives its cost, how it bills, what can cap or alert on it, and where to read its usage without write access. It also sets out the monitoring that Phase 10 in `docs/plan.md` builds (T-051 to T-056).

Every account here is Rafa's. This file holds no figure from his bills, no account ID and no plan he has not published. Those, and every report, budget and threshold, live only in the git-ignored `reports/costs/`.

Labels: **measured** (run or read in this repository or by a read-only API call, 2026-11-03), **documented** (read on the vendor's own page, 2026-11-03), **inferred**, **guessed**. Prices change: recheck the vendor's page before relying on one.

## Inventory

### Running the demo

| Source | What drives the cost | Unit and price | Tier today | Cap or alert offered | Read-only usage source |
| --- | --- | --- | --- | --- | --- |
| Cloudflare Workers and Durable Objects: `holdback-op1`, `holdback-op2`, `crow-site`, `crow-early-access` | Requests to the four Workers. The World Durable Object's requests (each alarm counts as one), duration, rows read (each cold start lists the whole journal) and rows written (each `setAlarm` counts as one). Workers Logs lines | Workers Paid: $5 a month minimum. Included each month: 10M requests, 30M CPU ms, 1M Durable Object requests, 400,000 GB-s, 25 billion rows read, 50M rows written, 5 GB-month stored, 20M log lines; then billed per million (documented). Workers Free has daily limits that fail until 00:00 UTC: 100,000 Durable Object requests, 5M rows read, 100,000 rows written (documented) | Workers Paid, reportedly since the 2026-11-02 outage (D41; not checked from here) | No spend cap on Workers Paid (documented: none found). Budget alerts: one email when usage-based spend crosses a dollar amount; usage is processed daily, the plan fee is not counted, and nothing is paused (documented). Usage Based Billing notifications on one product metric (documented). A CPU limit per Worker invocation, set "to prevent accidental runaway bills" (documented) | Billable Usage API: `GET https://api.cloudflare.com/client/v4/accounts/{account_id}/billable-usage?from=&to=`, a token with Billing Read, daily rows per product (documented). GraphQL Analytics API, a token with Account Analytics Read (documented); the datasets are named in `docs/operations.md`. T-031's day lines (`usage`, `deals`, `liveJudges`) |
| Cloudflare Workers KV: `EMAILS`, `FEEDBACK` | Writes from sign-ups and feedback reports, at most 300 a day from feedback (`docs/operations.md`) | Free: 1,000 writes a day. Paid: 1M writes a month included (documented) | As above | As above | Billable Usage API |
| Cloudflare D1, R2, Queues | Not used: no wrangler file binds them (measured) | — | — | A new product line in billable usage is an anomaly (T-054) | Billable Usage API |
| Cloudflare Registrar: `escrow.stream` | The yearly renewal | At cost, no markup; auto-renew is on by default (documented). The `.stream` price is not on Cloudflare's public pages; read it in the dashboard | Bought 2026-11-01 (`brand/domain.md`) | None; watch the renewal date and the card on file | Dashboard, Domain Registration |
| Anthropic API: the live judges | Tokens per judge call on Sonnet 5.5, Opus 5.5 and Sonnet 5 (`config/judges-live.yaml`). Input tokens follow deliverable size: a large CSV costs up to about 50 times a small diff (`docs/backlog.md`) | Per million tokens, by model. In code: at most 30 live calls a day and 8,192 output tokens a call (T-028, measured). 11 public-demo calls cost under $0.15 (T-028, inferred from measured tokens and list prices) | Unknown: which workspace holds the judges' key, and whether it has a limit | An organization monthly spend limit on the Console's Billing page, up to the usage tier's cap; at the limit the API answers 429 until the next month (documented). Workspace spend limits with alert thresholds; the Default workspace cannot hold one (documented) | Admin API: `GET /v1/organizations/cost_report` (USD cents as decimal strings, daily buckets only) and `GET /v1/organizations/usage_report/messages` (1-minute, hourly or daily buckets, grouped by workspace, key or model); data appears within about 5 minutes (documented). It needs an Admin key (`sk-ant-admin01-…`), which only an organization's admin can create and which carries full access: no read-only scope exists, and the Admin API is unavailable for individual accounts (documented) |
| DeepSeek API: the live judges | Tokens per call on `deepseek-flash` and `deepseek-v4-pro` | Per million tokens at peak: flash $0.30 input on a cache miss and $1.20 output; v4-pro $1.32 and $3.96. Off-peak is half; peak is 01:00 to 04:00 and 06:00 to 10:00 UTC on weekdays (documented) | Prepaid balance; amount unknown | No spend limit found: the prepaid balance is the cap (documented: none on the pricing pages) | `GET https://api.deepseek.com/user/balance`: `is_available` and the total, granted and topped-up balance (documented). It takes an API key, and any key on the account can also spend (inferred) |
| Sepolia gas: the relayer | Each relayed transaction and faucet mint: about 0.0006 Sepolia ETH a `try.ts` deal at a 1 gwei tip (ADR-0028 research, inferred) | Sepolia ETH: free from faucets, but slow to get | 1.94 Sepolia ETH on the funding lane on 2026-11-03 (D41, measured by the coordinating session) | The lane balances are the cap. Below 0.02 ETH on a lane the world warns, the faucet pauses and writes answer 503 (ADR-0028, PR 138) | `eth_getBalance` on a public RPC; no credential, since the addresses are public |
| Sepolia RPC | Reads and sends | Keyless public endpoints today (publicnode, tenderly; ADR-0028 research). Optional keyed free tiers: Alchemy 30M compute units a month; Infura 3M credits a day (documented) | Keyless | A free tier stops at its limit | The provider's dashboard |
| Etherscan API (optional, for source verification) | Calls | Free: 3 a second and 100,000 a day; from 2026-11-03, calls past the daily limit are blocked (documented) | Not signed up (inferred) | The free tier's hard limit | — |
| here.now | The old address's redirect, `npc.here.now/escrow` | Free $0, Hobby $4, Developer $20 a month (documented) | Unknown | Flat price | Account page |

### Building Crow

| Source | What drives the cost | Unit and price | Tier today | Cap or alert offered | Read-only usage source |
| --- | --- | --- | --- | --- | --- |
| Claude Code for the agent teams | Every session and subagent: tokens on the models it runs | On a Claude subscription, a flat monthly fee with 5-hour and weekly usage limits; Max costs $100 or $200 a month (guessed: third-party summaries, Anthropic's page not read). Extra usage beyond the plan has its own monthly spend limit (documented). With an API key instead, per token | Unknown: the plan, and whether extra usage is on | The plan's usage limits; the extra-usage spend limit at claude.ai, Settings, Usage; a workspace spend limit when an API key is used (documented) | No billing API covers subscription use: the Claude Code Analytics API covers only Console-key usage (documented). The local session transcripts under `~/.claude/projects/` record each response's model, input, output and cache tokens, session and git branch (measured), so a local script can price them at list price. OpenTelemetry's `claude_code.cost.usage` works on any plan (documented) |
| Anthropic API for development | `pnpm demo --live` (about $3 a run on the demo CSV, T-028), simulation batches (T-021), and later the agents' own `crow-agents` workspace (T-039) | Per million tokens | Unknown | As for the judges; T-039 gives the agents their own capped workspace | Admin API, grouped by workspace or key |
| GitHub | CI on every push and PR (9 jobs a run), CodeQL, Dependabot, secret scanning | Free for this repository: Actions on standard runners in public repositories, and code scanning, secret scanning and Dependabot alerts on public repositories (documented). Paid only if turned on: larger runners, Codespaces, Packages beyond the free amount, Copilot | Public repository; secret scanning, push protection and Dependabot security updates on; CodeQL default setup active (measured) | Budgets for a personal account, with "Stop usage when budget limit is reached" and alerts at 75, 90 and 100% (documented) | `GET /users/{username}/settings/billing/usage`, with a fine-grained token holding the user permission Plan: read (documented, as quoted from GitHub's reference by search; the probe with the current `gh` token answered 503, measured) |
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

1. **Caps and alerts at each provider (T-051).** Where a provider can stop spending, Rafa sets the stop: Anthropic's organization and workspace spend limits, GitHub budgets with "Stop usage", DeepSeek's prepaid balance, the Sepolia lane balances, the Claude plan's extra-usage limit. Where a provider can only warn, he sets the warning: Cloudflare's budget alerts and usage notifications. This needs no code.
2. **A daily read-only collector and a monthly report (T-052, T-053).** One script reads each provider's usage or billing API, the local Claude Code transcripts, T-031's day lines and the Sepolia balances, and writes `reports/costs/<date>.json`. A second script renders `reports/costs/<YYYY-MM>.md`.
3. **Anomaly rules and a daily routine (T-054, T-055).** Rules over the collector's output catch what a monthly alert would catch too late. The routine runs collector, report and rules once a day on Rafa's machine, and tells him only when a rule fires.

### Where credentials and figures live

- Billing credentials stay on Rafa's laptop, in `.env` loaded with Node's `--env-file`, or in T-039's deploy environment. Never in a build session, a Worker or GitHub Actions: the repository is public, so its workflow logs are public too.
- The Anthropic Admin key is the most sensitive key here. It has no read-only scope, so it can create and revoke keys and workspaces. If the Console organization can grant a narrower key later, switch to it.
- Reports, budgets, thresholds and the account register go in git-ignored `reports/costs/`. No figure from them goes into a commit, a PR, an issue or the design map.
- Money in the collector is US dollars in cents as a decimal string, parsed from the provider's text without ever becoming a float (hard rule). Ratios are basis points; token counts and wei are integers.

### Read-only credentials (T-052)

| Provider | Credential | Scope | Create it at |
| --- | --- | --- | --- |
| Cloudflare | API token `crow-costs-read` | Account · Billing · Read and Account · Account Analytics · Read, on this account only | https://dash.cloudflare.com/profile/api-tokens |
| Anthropic | Admin API key `crow-costs-read` | Full organization access: there is no read-only option (documented) | https://platform.claude.com/settings/admin-keys |
| GitHub | Fine-grained token `crow-costs-read` | User permission Plan: read; no repository access | https://github.com/settings/personal-access-tokens/new |
| DeepSeek | API key `crow-costs-read` | The same power as any key: nothing narrower exists (inferred) | https://platform.deepseek.com/api_keys |
| Sepolia | None | Public addresses on a public RPC | — |
| Claude Code | None | Local transcripts under `~/.claude/projects/` | — |

### The monthly report (T-053)

`reports/costs/<YYYY-MM>.md` holds:

- each provider's month-to-date spend, the forecast to month end, its budget and its share of any cap;
- fixed costs: plan fees, and the domain's renewal spread over twelve months;
- free-tier and included-usage headroom: Cloudflare's included amounts, Etherscan and RPC free tiers, faucet ETH;
- unit costs (below);
- the anomalies of the month and any provider the collector could not read.

Each figure says whether it was billed (from a billing API), estimated (tokens at list price) or entered by hand.

### Unit costs (T-053)

- **Per demo deal.** Gas from the deal's transaction receipts (`gasUsed` × `effectiveGasPrice`), shown in Sepolia ETH and at a stated mainnet gas price and ETH price, so the figure means something before mainnet. Plus judge tokens at list price from T-031's `liveJudges`, divided over the deals judged live. Plus the month's usage-based Cloudflare cost divided by T-031's deals that reached `final`. The operator fee earned is shown beside it, so the report says whether the fee covers the gas (D33 as amended on 2026-11-03).
- **Per merged PR.** The tokens of every transcript message on the PR's branch, priced at list price from a dated price table: the cost at API prices. Beside it, the share of the plan fee: the month's plan fee divided by the month's merged PRs, which is what was actually paid on a subscription. CI is free for this public repository; its wall-clock time belongs to T-049.
- **Per task.** The PRs whose branch carries the task ID (`t-<id>-…`), summed.

### Anomaly rules (T-054)

Starting thresholds are guesses. Rafa sets his own in `reports/costs/budgets.yaml`.

| Rule | Source | Starting threshold (guessed) | What it catches |
| --- | --- | --- | --- |
| A runaway agent | Transcripts | One session above 3M tokens in an hour, or one branch above $50 at list price in a day | A loop burning plan limits or an API budget |
| A spend spike | Each provider's daily cost | A day above 3 times the trailing 7-day median, and above $2 | New usage, before a monthly alert |
| A cap near | Anthropic month to date against each workspace limit; the DeepSeek balance | 80% of a limit; a balance under $5 | The live judges about to fall back to scripted |
| A Durable Object quota near | T-031's `alert: "durable-object-quota"` lines on Workers Free; Billable Usage month to date against the included amounts on Workers Paid | 80% of a limit or an included amount | The 2026-11-02 outage, or its paid-plan equivalent: a bill |
| A relayer low on gas | `eth_getBalance` on each lane and the funding lane | Under 0.05 Sepolia ETH, or under 7 days of runway at the trailing week's burn | ADR-0028's 0.02 ETH stop, a week ahead |
| Live judges at their cap | T-031's `liveJudges` | The daily cap reached three days running | Demand: raise the cap or the budget |
| Paid usage that should be zero | GitHub usage; a new Cloudflare product line; a new Anthropic workspace or key | Any amount above $0, any new line | Something turned on by mistake |
| A renewal due | The account register | A renewal within 30 days | The domain, most of all |

### What this feeds, and what it does not repeat

- **T-031 (product telemetry):** the collector reads its day lines and adds nothing to the nodes.
- **T-042 (Phase 9, the usage-telemetry lane):** it can read `reports/costs/latest.json` as one more source; a spend rule crossing its threshold is a signal, with no figure in the record.
- **T-047 (Phase 9, daily figures):** its spend figure reads the same file, so the pipeline needs no billing key of its own.
- **T-039 (Phase 9, the isolated environment):** its steps 6, 7 and 11 set caps for the agents' own accounts. T-051 covers every account today; if T-051 runs first, T-039's step 6 is already done.
- **T-049 (Phase 9, CI cost):** on this public repository, CI costs time, not money.

Uptime and self-healing for the hosted demo stay in `docs/backlog.md` ("Reliable production maintenance").
