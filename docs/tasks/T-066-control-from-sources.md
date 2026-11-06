# T-066: Crow Control reads every section from its primary source, and shows five headline metrics

- **Lane:** infra, api
- **Phase:** 9
- **Depends on:** T-031, T-052, T-219 and T-222, all done. The live console needs no further work before this starts (Context).
- **Paths this task may touch:** holdback: `tools/one-click/` (new), `scripts/metrics/` (new), `config/model-prices.json` (new, in the shape T-053 planned), `config/ops-cost-prices.json` (new), `tests/metrics/` (new), `package.json` (scripts only), `apps/demo-cloud/src/world.ts`, `apps/demo-cloud/src/judges.ts`, `apps/demo-cloud/src/world.test.ts`, `apps/demo-cloud/scripts/deploy.mjs`, `site/build.mjs`, `docs/api.md` (the discovery fields), `docs/costs.md` (unit costs), `docs/operations.md` (the metrics jobs), `docs/tasks/T-066-control-from-sources.md`, `docs/plan.md` (this row). (In the founders' private repository `rafaeldavid/crow-private`: `control/console.mjs`, `control/console.html`, `control/build-public.mjs`, `control/worker-access.js`, `control/metrics.mjs` (new), `control/metrics/` (new), `control/test/`, `control/README.md`, and `.github/workflows/control-hourly.yml` for the optional Cloudflare job only.) Not `spec/`, `pnpm-workspace.yaml` or `pnpm-lock.yaml`.
- **Human gate:** yes, for actions outside the repositories only: where the harness runs and on what schedule, any new secret, the harness job's push to the private repository, and the deploys (crow-console; holdback-op1, holdback-op2 and crow-site for the discovery fields). "Gates for Rafa" lists each one.
- **Status:** paused (partly done; the rest deferred until after stable EVM operations, Rafa, 2026-11-06). Live: the metrics scripts (PR 215, merged as c85147d) and the console's new sections (crow-private PRs 2 and 3, deployed as crow-console `91ae8a90`). Deferred: the One-Click harness (PR 217, draft) and the discovery fields (PR 216, draft). Set it back to "in progress" when work resumes.
- **Agent/session:** builder 1 (scope A), a Claude Code workflow session, 2026-11-05, worktrees `.worktrees/t066-metrics`, `.worktrees/t066-one-click` and `.worktrees/t066-discovery`. Scope B: the coordinator session merged and deployed it on 2026-11-06. A landing session on 2026-11-06 reviewed PRs 216 and 217, moved them to draft and removed the three worktrees.

## Intent

Rafa, 2026-11-05:
- "we should make sure Crow Control pulls everything deterministically without having to rebuild and resynthesize via LLM processing as much as possible", and "pull these deterministically as much as possible".
- On the cost metric: "instead of tokens, let's measure in USD equivalent of Opus 5.5 in medium".
- On Crow's own cost: "we need to measure our ops cost on our side of processing, an estimate".

Restated: Crow Control (control.escrow.stream, the founders' console) should read each section straight from the system that owns the fact: GitHub, git, the operators' public API, Sepolia and the live config. A model-written file stands in for a fact today in several places: the daily log's "Waiting on Rafa" list, task Status lines, the deploy records in `docs/operations.md`, and the guessed low marks in `wallets.json`. Each of those gets a scripted primary source. Text that only a person or a model can write (next steps, strategy) stays, labelled as notes. The precedent is T-060's dependency status: a pure script, no model and no inference (`control/deps.mjs`).

The console also gets a **Headline metrics** section with five numbers:
1. **Approvals per honest deal ("One-Click Escrow").** The user approvals a fresh assistant needs from the homepage prompt to Released. Target 1, started by either side.
2. **Cost per deal, in USD at Opus 5.5 list prices, medium effort.** What the fresh assistant's tokens cost.
3. **Processing time that is not user delay:** the API, the adjudicator and the chain.
4. **Throughput limits:** how many deals can run at once, and how many an hour.
5. **Crow's own operating cost per deal, as an estimate:** gas, Cloudflare, judge inference and RPC, beside the operator fee the deal charged.

Inputs: the harness's Agent SDK result, the operators' public event log, Sepolia blocks and receipts, the live config, and pinned price tables. Outputs: four JSON files that holdback scripts write and the console reads, and the console's new and changed sections.

Non-goals: billed actuals and the monthly report (T-053); changing the operator fee (T-215); any change to the protocol, the API schemas or the contracts.

**Scope A, restated by builder 1.** Holdback gets the scripts that produce the numbers; the console that shows them is scope B. Every figure is a field some source publishes, or integer arithmetic on fields: no model reads a page or a log to produce a number. The scripts read public sources only and hold no secret, so they can run in the console's hourly build job. The harness that drives a fresh assistant measures metrics 1 to 3 on the assistant's side; where it runs is Rafa's gate, so this task builds it and runs it only in a probe that touches no Crow site. Crow's own cost (metric 5) is an estimate in micro-dollars from measured gas, pinned and dated prices, and Cloudflare counts from one harness run; anything without a source reads "unknown", never 0. Not in scope A: the console, any deploy, any schedule, any new secret, and any change to `spec/`.

## Context

**Today's evidence** (measured on 2026-11-05 before the One-Click change, by a harness that drives a fresh Claude Code through the Agent SDK: default permissions, no allowlist, an empty folder, and `canUseTool` counting each request). The harness was in session scratch; it now lives in `tools/one-click/`, and the two runs' result messages are in `tests/metrics/fixtures/one-click-once.json` and `one-click-always.json`, without the assistant's text.

| Field (source in the SDK result) | Run "once" | Run "always" |
| --- | --- | --- |
| Approvals (`canUseTool` calls; no chat reply was needed) | 4 | 4 |
| `num_turns` | 6 | 6 |
| Opus 5.5 `inputTokens` | 12 | 12 |
| Opus 5.5 `cacheCreationEphemeral1hInputTokens` (all cache writes were 1-hour writes) | 13,201 | 15,403 |
| Opus 5.5 `cacheReadInputTokens` | 125,536 | 131,507 |
| Opus 5.5 `outputTokens` (of which `thinkingTokens`) | 2,331 (387) | 2,238 (477) |
| Haiku 5.5, a side call the CLI made (`inputTokens`, `outputTokens`) | 1,194, 17 | 1,194, 17 |
| `total_cost_usd` (the SDK's own figure; `costBasis` "list") | 0.1775111 | 0.1944613 |
| `duration_api_ms` (model time) of `duration_ms` | 36,001 of 104,755 | 32,934 of 99,943 |
| The deal itself (try.mjs's own "Released in" line) | 63 s | not recorded in the summary |

The four approvals in run "once" (measured): fetch `llms.txt` with curl; download and scan `try.mjs`; list its imports; run the one command. Claude Code 2.1.318 ran under `@anthropic-ai/claude-agent-sdk` 0.3.318 (measured: the init message and the SDK's `package.json`).

**The default effort is not in these logs** (measured: neither the init message nor the result carries an `effort` field). The SDK's types say the init message carries `effort` only on Remote Control bridge frames (`sdk.d.ts`, the `effort` field of the system init message). Hook inputs carry `effort.level`, "after any silent downgrade for the selected model", and Bash sees it as `CLAUDE_EFFORT` (`sdk.d.ts`, `BaseHookInput.effort`). Scope A step 1 finds the default with a hook and records it (Evidence: medium).

**The effort option** (measured, `sdk.d.ts` in 0.3.318): `Options.effort?: EffortLevel`, where `EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'`. It "works with adaptive thinking", which is the default `thinking` for models that support it.

**Gas per deal** (measured by Rafa on the 0.7 contracts): fund 840,697 gas, deliver 173,131, decide 166,808, appeal expiry 80,792. That is 1,261,428 gas in all (computed). The operators relay every transaction, so Crow pays it.

**The operator fee** (measured, `apps/demo-cloud/wrangler.op1.jsonc`): `OPERATOR_FEE_BPS` "1", `OPERATOR_FEE_MIN` "10000" and `OPERATOR_FEE_GAS` "4700000" base units. A 25 tUSDC deal pays 4.71 tUSDC. The file's comment says the 4.70 tUSDC gas part is "about 1.56 million gas (a deal's three transactions, measured on Sepolia) at its 1 gwei median tip, at the demo's fixed, fictional rate of 3,000 tUSDC per test ETH". T-215 replaces that quote with live gas and prices.

**A worked example** (inferred, at the fee's own fictional rates of 1 gwei and 3,000 per ETH): 1,261,428 gas costs USD 3.78. One faucet mint for a new visitor adds 130,000 to 240,000 gas (measured: the `FAUCET_MINTS_PER_DAY` comment in `apps/demo-cloud/src/world.ts`), USD 0.39 to 0.72. So gas is about USD 4.17 to 4.50 per new visitor's deal against a 4.71 tUSDC fee. On Sepolia the real cost is USD 0.

**Throughput, from the design** (inferred): one funding lane plus `DEAL_LANES = 3` deal lanes (measured: `packages/settlement/evm/live.ts`). Each lane waits for a receipt before it sends again (T-219). Sepolia blocks come about every 12 s, and an honest deal takes 3 transactions. Crow's test seller publishes its limits (measured: `apps/test-agents/src/catalog.ts`, served in `agent.json` as `limits`): 10 deals in progress at once, 20 offers an hour and 100 a day in all, and 3 requests per IP address an hour and 10 a day. The live judges run at most 30 calls a day (`docs/costs.md`).

**How the console reads holdback today** (measured in the private repository's `control/`, 2026-11-05):
- `console.mjs` imports holdback's `scripts/design-map.mjs` (`collect()`), then parses each task file's `Lane`, `Paths this task may touch`, `Human gate` and `Status` lines. Only the text on the field's own line counts. A parenthetical, or a sentence that starts with "Not", declares no path.
- It dates each task status change from the first-parent git diffs of `docs/tasks/`, and each decision from the history of `docs/decisions-today.md`.
- It takes the newest `docs/log/` file's "## Waiting on Rafa" bullets, from `origin/main` when the checkout is behind.
- It reads the tier table in `agent-ops/gates.md`, the deploy records ("Live since" lines) in `docs/operations.md`, and the Areas and Flows tables in `docs/update-flow.md`.
- The hourly job (`.github/workflows/control-hourly.yml`, three jobs: source, build, push) runs holdback's code in a `build` job that holds no secret except `GH_READ`, a read-only token for public repositories.

**Related tasks.**
- T-053 (todo) builds the monthly cost report, with unit costs per demo deal from billed data in the private cost directory. This task builds the public, per-deal estimate from public sources and pinned list prices, refreshed every hour. They share two pieces, so neither duplicates the other:
  - one model price table, `config/model-prices.json`, in the shape T-053 specifies (micro-dollars per million tokens, integers, a source URL and a date for each price). This task creates it; T-053 reuses it;
  - one gas reader: `scripts/metrics/ops-cost.mjs` reads each deal's gas from the event log, and T-053's `units.mjs` imports it instead of reading receipts again. T-053's mainnet gas and ETH prices move from `budgets.json` to `config/ops-cost-prices.json`, so both reports price gas the same way.
- T-215 (todo) replaces the fixed gas quote with live gas and prices, and credits unused gas. This task measures the cost and shows it beside whatever fee the deal paid, read from the deal's `fee.operator` event, so it needs no change when T-215 lands. Its measured gas per step is the Evidence T-215 asks for ("Gas units per deal measured on each path").
- T-031 (done) publishes `demo.judges.tokensToday` in discovery, with no split by model. T-052 (done) collects billing data on Rafa's Mac.
- The live console: T-059 (in progress) moved it behind Access; T-060 (review) added the dependency status. Neither blocks this task.
- T-065 (todo) may move `docs/plan.md` rows and other shared docs. If it lands first, the console's readers follow its layout.

## Sections: today's source and the primary source

"Model-written" means an agent or a person writes the source by hand, so it can lag or drift from the facts. "Primary source" is the system that owns the fact, read by script.

| Section | Source today | Model-written? | Primary source, read by script | Change in this task |
| --- | --- | --- | --- | --- |
| Headline metrics | none | — | The four JSON files in "Data format" | New, at the top of the page |
| Strategy | `control/strategy.json`, refreshed daily by an agent (`control/STRATEGY-REVIEW.md`) | Yes: questions and review notes are agent-drafted; the founders write leaning and decision | None: direction is a judgment | Keep. Label it "Notes: drafted by an agent, decided by the founders", with `refreshedOn` |
| Status: the components | Build-time probes of the site, `llms.txt`, `/v1/status` on both nodes, the Sepolia RPC, the funding lane, early access, CI on main and discovery's `demo.judges` | No | The same | Keep |
| Status: Hourly refresh, Dependencies | The data's age; providers' status pages (`deps.mjs`, T-060) | No | The same | Keep |
| Live versions and undeployed changes (new rows) | None | — | The build commit each deployed Worker publishes (scope A, slice 3: discovery's `demo.build.commit` on both nodes, and the site's build commit). Then `git log <live commit>..origin/main` over the Worker's paths lists what is merged but not live. With a Cloudflare read token, the Workers versions API adds version IDs and deploy times (Gates, item 5). Before slice 3 deploys: the live `try.mjs` and `llms.txt` against `node site/build.mjs --out` at `origin/main` (sha256, no token), and `/v1/status`'s `schemaVersion` | New |
| Sepolia wallets, now "Relayer balances and runway" | `control/wallets.json` (addresses; low marks marked guessed), `/v1/adjudicators`, `eth_getBalance` | Partly: the address list and the guessed low marks | Balances: `eth_getBalance`. Addresses: discovery (funding lane, demo adjudicators) and, after slice 3, `demo.relayer.dealLanes`; until then `wallets.json`. Runway in deals: balance ÷ (Crow's gas per deal from `ops-cost.json` × the median `effectiveGasPrice` of recent deal transactions from `eth_getTransactionReceipt`) | Add runway in deals per lane and in all. "Low" becomes a runway below a number of deals set in `wallets.json` |
| Waiting on you | The newest log's "Waiting on Rafa" bullets; tier 3 open PRs; open decisions in `docs/decisions-today.md`; gated tasks in review; low wallets; keys (private) | Yes for the log bullets, the decision text and task Status | GitHub: open PRs that only Rafa merges (tier 3 paths in `agent-ops/gates.md`), with CI state. Deploys owed: merged changes under a deployed Worker's paths, after its live commit. Wallets by runway. Keys from the register (private). Open decisions stay, from `decisions-today.md`'s structured markers | Derived items first. The log's bullets move to a group named "Notes from the log", and a bullet that names a PR or task already listed merges into that item, as today |
| Next steps (new) | None in the console | Yes: the newest log's "Next steps (resume here)" | None: plans are a judgment | New, labelled "Notes from the log" |
| Alerts | Open PRs, checks and files from GitHub; task declared paths; git | Task paths are model-written | The same | Keep |
| Radar | The workspace, wrangler files and the deployment file | No | The same, plus the live commit per Worker | Add the live commit and "N merged changes not live" per Worker node |
| Update flow | `docs/update-flow.md` tables, and git | The tables are written by hand (structure, not status) | The same | Keep |
| Strips (the task board) and phase progress | Task Status lines, and PRs | Yes: Status | PR state per task ID (branch `t-<id>-…` or the ID in the title): none; building (only draft PRs open); review (a ready PR open); merged (a PR merged, none open); done (the merge that last changed the task file set Status to done, a git fact) | Derive the column and the phase counts from PRs. Flag drift: the file says in progress with no open PR for 48 h; the file says todo with a merged PR; the file says done with a PR still open |
| Stream, Vitals | GitHub PRs and runs, git history | The status words inside events are model-written; the events are git facts | The same; work in progress counts derived task states | Vitals' work-in-progress counts derived states |
| Build log: runs and pushes | `gh run list`, `git log --remotes` | No | The same | Keep |
| Build log: deploys | "Live since" lines in `docs/operations.md` | Yes | As in "Live versions" above | Replace. The operations lines stay, as notes |
| Costs, Keys (private) | The T-052 collector's `latest.json`; `keys.json` in the cost directory | Costs: no. Keys: dates entered by Rafa | The same | Keep |
| Daily push notice, link lists, footer gaps | The private part's age; `control/page.src.html`; the build | Link lists are written by hand | The same | Keep |
| `/map` and `/contracts` | holdback's `scripts/design-map.mjs` and `scripts/contract-stack.mjs` | The map shows task Status and the log's waiting list | Out of scope here | None |

## Headline metrics: definitions

Each number names the file and the field it comes from. Every figure carries a basis: measured, inferred or guessed. A source that cannot be read gives "unknown", never zero.

### 1. Approvals per honest deal ("One-Click Escrow")

- **Number:** `approvals.total` in the newest run file whose `outcome.state` is "Released", per scenario. The console also shows the median over the last 10 such runs.
- **What counts:** every `canUseTool` call except `AskUserQuestion` (`approvals.toolPermission`), plus every `AskUserQuestion` the harness answers and every chat reply it sends to keep the assistant going (`approvals.conversational`).
- **The run:** a fresh Claude Code in an empty folder, with default permissions, `settingSources: []`, no MCP servers and a filtered environment, given the live homepage's prompt (the `#prompt` span of `https://escrow.stream/`).
- **Target:** 1, started by either side.
  - Scenario `buyer`: the homepage prompt; the fresh assistant buys from Crow's test seller. Measured from the first run.
  - Scenario `seller`: the fresh assistant sells. It needs a counterparty that buys, the test buyer, which is in the backlog (T-222, second slice). Until then the console shows "Not measured yet: needs Crow's test buyer", never a number.
- **A run that does not reach Released** shows as a failed run with its last state, and stays out of the median.

### 2. Cost per deal, in USD at Opus 5.5 list prices, medium effort

- **The run:** the same harness run with `model: 'claude-opus-5-5'` and `effort: 'medium'` (the SDK's `Options.effort`). A `PreToolUse` and a `Stop` hook record `effort.level` from the hook input. The run file's `model.effortApplied` must read "medium", or the cost metric marks the run invalid.
- **Tokens recorded** from the SDK's `result` message, for every model in `modelUsage`: `inputTokens`, `cacheCreationEphemeral5mInputTokens`, `cacheCreationEphemeral1hInputTokens`, `cacheReadInputTokens`, `outputTokens` and `thinkingTokens`. The result's `usage` object is kept verbatim beside them.
- **Price:** every token, whichever model produced it, at Opus 5.5's published list price per million tokens. Input, 5-minute cache write, 1-hour cache write, cache read and output each have their own price. Thinking tokens are part of `outputTokens` (measured: 387 of 2,331), so they are priced once, as output.
- **The price table:** the `claude-opus-5-5` entry in `config/model-prices.json`, read from Anthropic's published pricing page (an authoritative source, not memory), with its URL and the date read.
- **Number:** `cost.atOpus55.usdMicros` (micro-dollars, an integer as a decimal string), shown in USD with 4 decimals.
- **Cross-check:** the SDK's own `total_cost_usd` and each model's `costUSD`, verbatim, in `cost.sdk`. The difference goes in `cost.deltaBps` (basis points, an integer). Some difference is expected, because the Haiku side call is repriced at Opus rates. `cost.atOpus55.byModel` prices each model's tokens alone, so Opus 5.5's own figure can be compared with the SDK's `costUSD` for that model.

### 3. Processing time that is not user delay

Two parts, shown side by side.

**The assistant's side** (from the run file):
- `time.modelMs`: the result's `duration_api_ms`;
- `time.toolMs`: the union of each tool call's span from `tool_use` to its `tool_result`, which includes the deal;
- `time.approvalWaitMs`: the time spent inside `canUseTool` and in chat replies. The harness answers at once, so this is about 0; with a person it is user delay;
- `time.wallMs`, and `time.otherMs` = wall − model − tool − approval wait.

**Crow's side** (from `deal-timing.json`): stage times per deal over recent deals, as median and 90th percentile (p90). An event that carries `payload.block` is timed by that block's timestamp (`eth_getBlockByNumber`). Any other event is timed by its own `at`.

| Stage | From event | To event | Who acts | Crow processing? |
| --- | --- | --- | --- | --- |
| accept | `commitment.offered` | `adjudicator.accepted` | the primary adjudicator | yes |
| agree | `adjudicator.accepted` | `commitment.agreed` | the buyer | no: party time |
| fund | `commitment.agreed` | `hold.funded` | the operator's relay and the chain | yes |
| deliver | `hold.funded` | `delivery.submitted` | the seller, then the relay and the chain | no: party time |
| decide | `delivery.submitted` | `judgment.decided` | the adjudicator, the relay and the chain | yes |
| settle | `judgment.decided` | `settlement.released` or `settlement.refunded` | the chain, usually the same transaction | yes |
| final | the settlement event | `appeal.expired` or `commitment.settled` | the appeal window, a term the parties chose | no: a term |

- **Number:** `totals.crowProcessingMs` (median and p90): accept + fund + decide + settle. Beside it: `totals.partyMs` and `totals.offeredToSettledMs`.
- **Also shown:** `indexLagMs`, an event's `at` minus its block's timestamp, which is how long the operators take to see a block.
- **"Recent"** means the last 7 days, capped at 500 deals. The gap line says when the cap cut the window.
- **Two limits** (inferred): block timestamps are whole seconds on 12 s slots, so chain stages come in steps of about 12 s. If `commitment.agreed` is read from the funding transaction's block, the fund stage reads 0 and its time shows in "agree". The builder checked this on the commitment from run "once" (`0xa93a4a1d24e0cf57c846d17cdaa65094f8df73d5707ed142c35c532916d88f93`): Evidence.

### 4. Throughput limits

From `throughput.json`. Capacity comes from the live config and the measured block time. Utilization comes from the deals observed per hour.

- **Relay capacity,** deals an hour = `dealLanes` × 3,600 s ÷ (`txPerHonestDeal` × `secondsPerTx`).
  - `dealLanes`: from discovery's `demo.relayer.dealLanes` after slice 3. Until then, `DEAL_LANES` in the checkout, labelled "from the code at <commit>, not confirmed live".
  - `txPerHonestDeal`: the median count of distinct Crow-sent transactions per Released deal (`deal-timing.json`).
  - `secondsPerTx`: the median fund stage (submit to block). If that is 0, the median gap between the last 100 Sepolia blocks.
  - With 3 lanes, 3 transactions and 12 s (inferred): 300 deals an hour. Measured on 2026-11-05: 4 transactions, so 225 (Evidence).
- **Deals in progress at the relay's capacity:** relay capacity × the median deal lifetime (offered to settled), by Little's law (deals in progress = arrival rate × time in the system).
- **Every other cap, each with its source:**
  - Crow's test seller: `open`, `perHour`, `perDay`, `perClientPerHour` and `perClientPerDay`, from `https://escrow.stream/agents/test-seller/agent.json`, field `limits`.
  - The faucet: discovery's `demo.faucet` (`perAddressEverySec`, `perClientPerWindow`), and its mints a day: `FAUCET_MINTS_PER_DAY` (600) until slice 3 publishes it.
  - The funding lane: one transaction per `secondsPerTx`, shared by faucet mints and lane top-ups.
  - Live judges: discovery's `demo.judges.liveCallsPerDay` ÷ the panel's seats (3): rubric deals a day with a live panel.
- **Binding limit:** the smallest cap for the deal type, named. For a test-seller deal today that is the seller's 10 in progress and 20 an hour (inferred).
- **Utilization:** observed deals an hour (`hold.funded` events per clock hour over 7 days, median and peak) ÷ the binding capacity, in basis points.

### 5. Crow's operating cost per deal (an estimate)

From `ops-cost.json`. This is what Crow pays to process one deal, by component, beside the operator fee the deal charged.

- **Gas.**
  - Per deal: the sum of `payload.gasUsed` over the deal's distinct transactions (`payload.tx`) whose `payload.sender` is a Crow account. Crow's accounts are the funding lane, the deal lanes and Crow's demo adjudicators (discovery). Each step is named by its event type: fund, deliver, decide, appeal expiry, and any other.
  - Plus, for a new visitor: one faucet mint. Its gas comes from the receipt of the tUSDC mint (a `Transfer` from the zero address to the buyer, found with `eth_getLogs` on the token in the deal's block range).
  - Plus Crow's adjudicators' one-time approve and deposit (372,709 gas each, measured), spread over the world's deals.
- **Gas, priced three ways** from the same gas units:
  - Sepolia: USD 0, since test ETH is free;
  - Ethereum mainnet: gas × gas price × ETH price;
  - Base: gas × Base's gas price × ETH price, plus Base's L1 data fee per transaction. If the script cannot read that fee, it reports "L1 data fee not included".
  - Gas prices and the ETH price are pinned, dated assumptions in `config/ops-cost-prices.json`.
- **Cloudflare.** Workers requests, Durable Object requests, CPU time and duration per deal. The counts come from `wrangler tail` during a harness deal (`one-click` run file, `cloudflare`), priced at Cloudflare's published prices pinned in `config/ops-cost-prices.json`.
  - Shown two ways: at list price per unit, and "USD 0 at the margin while inside the included usage of Workers Paid" (`docs/costs.md`).
  - With no run file that has counts: "unknown".
- **Judge inference,** for rubric deals only. Discovery's `demo.judges.tokensToday` divided by `liveCallsToday`, times the panel's seats, priced per model from `config/model-prices.json`.
  - Today the tokens have no split by model (measured: `apps/demo-cloud/src/world.ts`). So the figure is an upper bound at the most expensive live model's price, the method T-053 uses. Slice 3 adds `tokensToday.byModel`.
  - A checks-only deal, such as the test seller's, has no panel: USD 0.
- **RPC:** USD 0, because the endpoints are keyless public ones (`docs/costs.md`). The basis says so; it is not a measured count.
- **The fee beside the cost:** the deal's `fee.operator` event amount (4,710,000 base units, 4.71 tUSDC, today), at tUSDC = USD 1 (an assumption: tUSDC stands in for USDC). For each pricing, `feeCoversCost` is true or false, with the margin in micro-dollars.

## Data format

**Rules for every file:**
- Each file carries `schema` (for example `"crow.metrics.deal-timing/1"`), `generatedAt` (ISO 8601 UTC), `generator` (`{script, commit}`), `sources` (`[{id, url, readAt, ok, ms, error}]`, where `error` is a word from a fixed list) and `gaps` (plain sentences).
- Money and gas follow the hard rule: integers as decimal strings. USD amounts are micro-dollars (`usdMicros`), wei are wei, and gas is gas units. Rates are integers: basis points, or a numerator and a denominator. No float appears in a money or rate field.
- Times are integers in milliseconds (`…Ms`) or ISO strings (`…At`). Token counts are JSON integers.
- Each figure that is not plainly measured carries `basis`: `measured`, `inferred` or `guessed`.
- No local path, IP address, key, header value or model text goes in a file.
- Each schema is a JSON Schema (2020-12) in holdback `scripts/metrics/schemas/<name>.schema.json`. Tests check every fixture and live output against it. These schemas describe the console's inputs, not the API, so they stay out of `spec/`.

| File | Written by | Where it lands | Read by |
| --- | --- | --- | --- |
| `one-click/<runId>.json`, schema `crow.metrics.one-click/1` | `tools/one-click/run.mjs`, on the harness machine | committed to the private repository's `control/metrics/one-click/` by the harness job (Decisions, 1). The job keeps the last 30 | `control/metrics.mjs`; `ops-cost.mjs` (the Cloudflare counts) |
| `deal-timing.json`, `crow.metrics.deal-timing/1` | `scripts/metrics/deal-timing.mjs` | the hourly build's `out/` | the console; `throughput.mjs`; `ops-cost.mjs` |
| `throughput.json`, `crow.metrics.throughput/1` | `scripts/metrics/throughput.mjs` | the hourly build's `out/` | the console |
| `ops-cost.json`, `crow.metrics.ops-cost/1` | `scripts/metrics/ops-cost.mjs` | the hourly build's `out/` | the console |
| `config/model-prices.json` | by hand from the published page, checked by a test | holdback, tracked | the harness, `ops-cost.mjs`, T-053 |
| `config/ops-cost-prices.json` | `scripts/metrics/refresh-prices.mjs`, or by hand when no keyless source exists | holdback, tracked, changed by PR | `ops-cost.mjs`, T-053 |

The schemas in `scripts/metrics/schemas/` are the exact shapes; the sketches below are the plan they implement. Additions the builder made are listed in Decisions 8 to 19.

**`one-click/<runId>.json`**
```
{ schema, generatedAt, generator: {script, commit}, sources, gaps,
  runId: "2026-11-05T13-35-12Z-buyer", scenario: "buyer" | "seller",
  harness: { sdkVersion: "0.3.318", claudeCodeVersion: "2.1.318", maxReplies: 6, timeoutMs: 600000 },
  prompt: { text, source: "https://escrow.stream/ #prompt", matchesExpected },
  model: { requested: "claude-opus-5-5", init, effortRequested: "medium", effortApplied, effortSource: "hook" },
  outcome: { state: "Released" | "Refunded" | "stopped" | "timedOut", commitmentId, txs: ["0x…"], releasedAtMs },
  approvals: { total, toolPermission, conversational, byTool: {Bash: 4},
               requests: [{ atMs, tool, summary }] },          // summary: the command or URL, local paths replaced, capped at 300 characters
  tokens: { byModel: { "<model>": { input, cacheWrite5m, cacheWrite1h, cacheRead, output, thinking } },
            sdkUsage: { …the result's usage object, verbatim… }, numTurns },
  cost: { atOpus55: { usdMicros, byModel: { "<model>": usdMicros }, priceTable: { file: "config/model-prices.json", model: "claude-opus-5-5", source, readOn } },
          sdk: { totalCostUsd: "0.17751109999999998", byModel: { "<model>": "0.17738319999999996" } },   // String() of the SDK's numbers
          deltaBps },
  time: { wallMs, modelMs, toolMs, approvalWaitMs, otherMs, sdkDurationMs },
  cloudflare: null | { basis: "tail", window: {from, to}, otherDealsInWindow,
                       workers: { "holdback-op1": { requests, cpuMs, wallMs, durableObjectRequests, durableObjectWallMs }, … } },
  errors: [], timedOut }
```

**`deal-timing.json`**
```
{ schema, generatedAt, generator, sources, gaps,
  eventLog: { node, from, head, events, complete, fundedDeals } | null,   // null: no node served the log; every count below is then null
  window: { from, to, deals, cappedAt: 500, inProgress },
  stages: [{ id, from, to, actor, crow: true | false, deals, medianMs, p90Ms, clamped }],
  totals: { crowProcessingMs: {deals, medianMs, p90Ms}, partyMs: {…}, offeredToSettledMs: {…} },
  indexLagMs: { medianMs, p90Ms, events },
  outcomes: { Released, Refunded, other },
  deals: [{ commitmentId, outcome, template: "checks-only" | "rubric" | null, buyer,
            times: { offered, accepted, agreed, funded, delivered, decided, settled, final },
            stagesMs: { accept, … }, fee: { amount, token } | null,
            txs: [{ event, step, tx, block, blockTime, sender, crowSent, gasUsed }] }] }
```
`template` comes from the deal's terms when its disclosure level shows them (no rubric criteria: "checks-only"), and is null otherwise. `crowSent` is true when `sender` is one of Crow's accounts.

**`throughput.json`**
```
{ schema, generatedAt, generator, sources, gaps,
  config: { dealLanes: {value, source}, fundingLanes: {value: 1, source},
            txPerHonestDeal: {value, source}, secondsPerTx: {value, source},
            blockTimeMs: {medianMs, p90Ms, blocks: 100},
            testSeller: { open, perHour, perDay, perClientPerHour, perClientPerDay, source },
            faucet: { perAddressEverySec, perClientPerWindow, mintsPerDay, source },
            liveJudges: { callsPerDay, seatsPerPanel: 3, source } },
  capacity: { relayDealsPerHour, inProgressAtRelayCapacity, medianLifetimeMs,
              limits: [{ id, dealsPerHour | inProgress | dealsPerDay, appliesTo: "all" | "testSeller" | "newVisitor" | "rubric", perClient, basis }],
              binding: { id, appliesTo, assumes, dealsPerHour, perDay: { id, dealsPerDay }, basis } },
  observed: { dealsPerHour: { medianPerHour, peakPerHour, hours: 168 }, utilizationBps, utilizationOf } }
```

**`ops-cost.json`**
```
{ schema, generatedAt, generator, sources, gaps,
  prices: { file: "config/ops-cost-prices.json", asOf, usdMicrosPerEth, gasPriceWei: { ethereum, base }, baseL1FeeIncluded, modelPrices: { file, readOn } },
  perDeal: {
    deals,                                                   // Released deals in deal-timing.json's window
    gas: { bySteps: [{ step, deals, gasUsed: {median} }], dealTxs: {median}, faucetMintNewVisitor: {median, mints}, adjudicatorSetupPerDeal,
           dealGas: {median}, totalGas: {median}, usdMicros: { sepolia: "0", ethereum, base }, usdBasis },
    cloudflare: { basis: "tail" | "unknown", runId, requests, cpuMs, durableObjectRequests, durationGbS,
                  usdMicrosAtList, usdMicrosAtMargin: "0" | null, pricesReadOn },   // null when basis is "unknown"
    judges: { checksOnly: { usdMicros: "0" }, rubric: { basis: "upper bound" | "by model" | "unknown", usdMicros, calls } },
    rpc: { usdMicros: "0", basis: "keyless public endpoints (docs/costs.md)" },
    total: { checksOnly: { basis, excludes, sepolia, ethereum, base }, rubric: { … } },
    operatorFee: { amount: "4710000", token: "tUSDC", decimals: 6, usdMicrosAtPar: "4710000", deals, source },
    feeCoversCost: { checksOnly: { sepolia: {covers, marginUsdMicros}, ethereum: {…}, base: {…} }, rubric: {…} } },
  runway: { basis, lanes: [{ address, role, wei, deals }], totalDeals, effectiveGasPriceWei: {median, txs} } }
```

**`config/model-prices.json`** (the shape T-053 specifies): `{ unit: "micro-USD per million tokens", readOn, models: { "<model id>": { input, cacheWrite5m, cacheWrite1h, cacheRead, output, source, readOn } } }`. DeepSeek entries add the off-peak prices and the peak hours. Every price is an integer.

**`config/ops-cost-prices.json`**: `{ asOf, usdMicrosPerEth: {value, source, readAt, basis}, gas: { ethereum: {gasPriceWei, source, readAt, basis}, base: {gasPriceWei, l1Fee: {weiPerTx, txBytes, method, source, readAt, basis} | null, source, readAt, basis} }, cloudflare: { <unit>: {usdMicrosPerMillion, included, per, source, readOn, basis} }, tusdcToUsd: {numerator: 1, denominator: 1, basis: "assumption"} }`.

## Where each part runs

| Part | Runs on | Needs | Secret involved |
| --- | --- | --- | --- |
| `tools/one-click/run.mjs` | Rafa's Mac, or a CI job (Gates, item 1) | Claude Code's login on the Mac, or an Anthropic API key in CI; Node 22; for the Cloudflare counts, wrangler's login | The Claude login or the key, which the child process must not see (the harness passes a filtered environment, measured) |
| `scripts/metrics/deal-timing.mjs`, `throughput.mjs`, `ops-cost.mjs` | the hourly `build` job in the private repository, called by `build-public.mjs`; any laptop | Public HTTPS: both operators, the Sepolia RPCs (publicnode, Tenderly's gateway), the test seller's `agent.json`. A 5 s timeout and a 1 MiB cap per request, no redirect followed (T-060's rules) | None |
| `scripts/metrics/refresh-prices.mjs` | by hand, opening a PR; or a schedule (Gates, item 7) | Public keyless sources only; the script signs and sends nothing | None |
| `control/metrics.mjs` and the page | the hourly build, and the Worker at control.escrow.stream | The files above | None |
| Optional Cloudflare read (`control/cf-read.mjs`) | its own job in the hourly workflow, with only that token; holdback code never runs beside it (red-team finding M2) | A Cloudflare API token, Workers Scripts Read (Gates, item 5) | Yes |

## Scope A: holdback (builder 1)

Three PRs: slice 2 on `t-066-metrics-scripts`, slice 1 on `t-066-one-click` (stacked on slice 2, Decision 8), slice 3 on `t-066-discovery-fields`.

**Slice 1: the harness.**
1. Move the harness to `tools/one-click/`: `run.mjs`, `metrics.mjs` (pure: from the SDK result and the harness's bookkeeping to the run file), `package.json` with `@anthropic-ai/claude-agent-sdk` pinned exactly (`0.3.318`, no caret) and its own lockfile, and `README.md`. The folder stays outside the pnpm workspace, so `pnpm-lock.yaml` does not change and CI does not install the SDK.
2. Add the options: `--scenario buyer|seller`, `--effort <level>` (default `medium`, passed as `Options.effort`), `--model` (default `claude-opus-5-5`), `--out <dir>` (the run file), `--logs <dir>` (the raw JSON lines, kept outside git), and `--tail` (count Cloudflare events, below).
3. Record the applied effort with `PreToolUse` and `Stop` hooks (`input.effort.level`). Then run once with the effort unset, and record the SDK's default effort for Opus 5.5 in this task's Evidence.
4. `--tail`: start `npx wrangler@4 tail <worker> --format json` for holdback-op1, holdback-op2 and crow-test-agents for the run's duration. Count events per Worker in memory, and sum any `cpuTime` and `wallTime` the events carry. Write counts only, never a header, a URL path or an IP (D39). Record how many other deals moved in the window, from the event log, so a busy window shows.
5. `config/model-prices.json`: Opus 5.5, Haiku 5.5, and the live judges' models (`config/judges-live.yaml`), each read from the provider's published pricing page, with the URL and the date read. (Shipped in slice 2's PR, Decision 8.)
6. Tests in `tests/metrics/one-click.test.ts`, on fixtures cut from today's two result messages (`tests/metrics/fixtures/`, with no local path). They check:
   - 4 approvals each;
   - the token fields as in Context;
   - `cost.atOpus55.usdMicros` equals a hand-computed value from the pinned table;
   - the run file validates against its schema.

**Slice 2: the public metrics scripts.**
1. `scripts/metrics/lib.mjs`: fetch with T-060's rules, batched JSON-RPC, the event-log reader, and integer quantiles (nearest rank, as `apps/demo-cloud/src/telemetry.ts` does).
2. Read the event log once: `GET /v1/events?from=<head.eventSeq − N>` until it reaches `head.eventSeq` (from `/v1/status`), on node 1, falling back to node 2. Record which node answered. If the stream does not end on its own, stop it at the head. The builder confirmed it does not end on its own (Evidence).
3. `deal-timing.mjs`, `throughput.mjs`, `ops-cost.mjs` and `refresh-prices.mjs`, as defined above, with their schemas in `scripts/metrics/schemas/`. `check.mjs <name> <file>` checks a file against its schema with Ajv (2020-12, strict), as `pnpm validate:spec` does.
4. `config/ops-cost-prices.json`. `refresh-prices.mjs --dry-run` prints the new values and their sources. Sources, checked on 2026-11-05 (measured):
   - gas prices: `eth_feeHistory` on keyless public Ethereum and Base RPC endpoints (publicnode);
   - Base's L1 data fee: the OP Stack `GasPriceOracle` predeploy, `getL1FeeUpperBound(txBytes)`;
   - the ETH price: Chainlink's ETH/USD feed on Ethereum, `latestRoundData()` by `eth_call`, keyless.
   The Cloudflare prices have no keyless source; they are entered by hand with their date. The script only reads fee data; it imports no settlement code and signs nothing.
5. Root `package.json` scripts: `metrics:deal-timing`, `metrics:throughput`, `metrics:ops-cost`, `metrics:prices`.
6. Tests in `tests/metrics/*.test.ts`, on fixtures. Save one real deal's events and blocks first, the run "once" commitment, read live once. Each test checks:
   - stage medians and p90 equal hand-computed values;
   - the gas sum is 1,261,428 for a fixture with the four measured steps;
   - USD by integer arithmetic matches hand-computed values, and a test sum that floats would round wrongly comes out exact;
   - a missing source gives "unknown", not 0;
   - a capped window says so in `gaps`;
   - every output validates against its schema.
7. `docs/costs.md`: under Unit costs, name this estimate and its relation to T-053. `docs/operations.md`: where the metrics come from and the harness job.

**Slice 3: the operators publish what the scripts need** (a separate PR; live only after a deploy, Gates item 6).
1. Discovery on both nodes (`apps/demo-cloud/src/world.ts`):
   - `demo.build: { commit }`, from a `BUILD_COMMIT` variable that `apps/demo-cloud/scripts/deploy.mjs` sets with `--var`;
   - `demo.relayer: { fundingLane, dealLanes: [...] }`;
   - `demo.faucet.mintsPerDay`;
   - `demo.judges.tokensToday.byModel: { "<model>": { calls, input, output } }`, from `apps/demo-cloud/src/judges.ts`, counts only.
   Discovery's `demo` object has no schema in `spec/schemas/` (measured: no `judges` or `demo` key there). It does have one in `spec/openapi/paths.json`, closed with `additionalProperties: false`, so the new fields need an OpenAPI change (PR 216's review, finding 1, in Handoff). `docs/api.md` lists the new fields.
2. The site: `site/build.mjs` writes the build commit into a `version.json` beside `llms.txt`.
3. Tests in `apps/demo-cloud/src/world.test.ts` for the new fields.

**Scope A acceptance** (each a command):
- [x] `pnpm typecheck && pnpm lint && pnpm test` pass, with `tests/metrics/` included (measured on each of the three branches; Evidence).
- [x] `pnpm vitest run tests/metrics` passes with the checks listed in slices 1 and 2.
- [ ] `node tools/one-click/run.mjs --scenario buyer --effort medium --out reports/scratch/one-click` on the Mac writes a run file that passes `node scripts/metrics/check.mjs one-click reports/scratch/one-click/<runId>.json`, with `model.effortApplied` "medium" and `outcome.state` "Released" (measured; Gates item 1 first). Not run: it waits for Gates item 1 (Handoff).
- [x] `node scripts/metrics/deal-timing.mjs --out reports/scratch/deal-timing.json`, `throughput.mjs` and `ops-cost.mjs`, run against the live operators, each finish in under 30 s. Their files pass `scripts/metrics/check.mjs` (measured).
- [x] Pricing the run "once" Opus 5.5 tokens with `config/model-prices.json` gives a figure within 1% of the SDK's `costUSD` of 0.1773832, or Decisions explains the difference (measured: 177,383 µUSD against 177,383.2, a difference of 0.0001%).
- [ ] Slice 3: `pnpm vitest run apps/demo-cloud/src/world.test.ts` passes (measured: 37 of 37), and after the deploy both nodes' discovery documents show `demo.build.commit` equal to the deployed commit (measured with curl). The deploy waits for Gates item 6.

## Scope B: the private repository (builder 2)

Work in a worktree of `rafaeldavid/crow-private` (`/Users/rafa/Documents/escrow/.worktrees/cp-t066-…`). Start from the data format above with hand-made fixtures; swap in scope A's real outputs when they exist.

1. `control/metrics.mjs` (new; importable, as `deps.mjs` is):
   - read the run files in `control/metrics/one-click/` and the three build files;
   - check each against the fields above;
   - cap every string, take states and bases from fixed lists, and turn an unknown schema version into "unknown" with a gap line;
   - compute only medians over run files. Every other number comes from the files.
2. `build-public.mjs`: when the checkout has `scripts/metrics/`, run the three scripts before `console.mjs` (each with a 60 s timeout), and pass `--metrics-dir`. A script that fails leaves a gap line and never fails the build.
3. `console.mjs`:
   - add `metrics` to `public.json`, and `--metrics-from <dir>` for previews and tests;
   - add the derived sections from the Sections table: Waiting on you, derived first, with the log's bullets under "Notes from the log"; Next steps as notes; task states from PRs, with drift flags; live versions and undeployed changes; deploys in the build log; runway in deals;
   - read PRs with one `gh pr list --state all --limit 1000 --json number,title,headRefName,state,isDraft,mergedAt` call for the task states.
4. `console.html`: a **Headline metrics** section at the top, one card per metric. Each card shows the value with its unit, its basis, its source and read time, and a stale mark when the data is older than its cadence: 26 h for run files and 2 h for the build files. Throughput names the binding limit. The ops-cost card shows each component and the total for Sepolia, Ethereum and Base, beside the 4.71 tUSDC fee. Every value goes through `esc()`, every link through `href()`, and every class through `pick()` and `cls()`.
5. `worker-access.js`: the shape check for `public.json` accepts `metrics` and the new lists, still under 2 MiB.
6. Tests, with no network:
   - `control/test/metrics.test.mjs`: the reader on real outputs, and on hostile ones: 2 MiB strings, `{"toString": 1}`, negative and float money, `NaN` as a string, an unknown schema version, control and direction characters, and `javascript:` links;
   - `control/test/metrics-page.test.mjs`: the page's metrics block in a fresh V8 context on 40 shuffles of hostile data, as `deps-page.test.mjs` does;
   - `control/test/derive.test.mjs`: task states and drift from recorded `gh` JSON, deploy drift, and runway;
   - fixtures in `control/test/fixtures/metrics/`.
7. `control/README.md`: the new sources, the harness job and its gates.
8. If Rafa adds the Cloudflare token (Gates, item 5): `control/cf-read.mjs`, and a fourth workflow job that checks out `control/` only and holds only that token. The push job merges its `deploys.json` into `public.json`. This is a `.github/` change in the private repository, so Rafa merges it.

**Scope B acceptance:**
- [x] `node --test` on every file in `control/test/` passes, the new ones included (the runbook lists the command). Measured by the coordinator session before it merged crow-private PR 2, 2026-11-06: 125 of 125 tests pass.
- [ ] `node control/console.mjs --root <holdback> --private-slot --no-gh --metrics-from control/test/fixtures/metrics --out reports/scratch/console.html` renders the Headline metrics. A text dump goes in Evidence (measured).
- [ ] `node control/build-public.mjs --root <holdback> --out reports/scratch/cp-out` writes `public.json` with `metrics`, and the build takes at most 60 s longer than before (measured).
- [ ] `worker-access.test.mjs` shows the unchanged Content Security Policy and the new `public.json` accepted.
- [x] Deployed on Rafa's go-ahead; one hourly run checked (Gates, item 6). Deployed on 2026-11-06 as crow-console `91ae8a90`, and build run 42172692764 pushed its files at 06:11 UTC (Evidence).

## Gates for Rafa

**State on 2026-11-06:** item 6's crow-console deploy is done (crow-console `91ae8a90`, Evidence). Items 1 to 5, item 7 and item 6's slice 3 deploys are deferred until after stable EVM operations (Rafa, 2026-11-06).

1. **Where the harness runs.** Choose one:
   - On the Mac under your Claude Code login. The harness approves every tool request the fresh assistant makes, inside an empty folder but as your user. A separate macOS user, or T-039's VM, keeps it away from your files (recommended).
   - In CI with an Anthropic API key. This is a new secret in a capped workspace, in a job that holds no other secret. The assistant's Bash can read its own environment, so the key should be one you can afford to lose.
2. **A schedule for the harness:** once a day is enough. Each run costs about USD 0.18 to 0.20 at list price (measured at the default effort, which is medium: Evidence). It spends Sepolia gas from the funding lane, takes one faucet mint, and counts against the test seller's 3 requests per IP address an hour and 10 a day.
3. **The harness job's push** of run files to `crow-private` `main`, from a dedicated clone, never the main checkout. This is a job with write access to a repository.
4. **`wrangler tail` during harness runs** uses your Cloudflare login, for the per-deal Cloudflare counts. Without it, the Cloudflare part reads "unknown".
5. **Optional: a Cloudflare API token** with Workers Scripts Read (and Account Analytics Read, if wanted), as a `crow-private` Actions secret such as `CF_WORKERS_READ`, read in its own job. Without it, deploy drift comes from the build commits slice 3 publishes.
6. **Deploys:** holdback-op1, holdback-op2 and crow-site for slice 3; crow-console for the page and the Worker's shape check.
7. **Optional: a schedule for `refresh-prices.mjs`.** Without one, the prices are refreshed by hand in a PR, and the console shows their date.

## Acceptance criteria

- [ ] Scope A's and scope B's acceptance lists are checked.
- [ ] The console shows the five headline metrics from live data, each with its source, basis and read time. The buyer scenario shows its latest measured approvals with the run's date. The seller scenario reads "Not measured yet" until the test buyer exists. Rafa checks the live page, which needs his sign-in.
- [ ] Every row of the Sections table marked "Change" is done or listed in Handoff with its reason. No section reads a model-written file where the table names a primary source, except as labelled notes.
- [ ] Evidence holds:
  - [x] the SDK's default effort for Opus 5.5;
  - [ ] one medium-effort run's numbers next to today's baseline (the baseline ran at medium already: Evidence);
  - [x] the price tables' sources and dates;
  - [x] the ops-cost components for one Released deal, at Sepolia, Ethereum and Base prices, beside its fee.

## Out of scope

- The monthly report and billed actuals (T-053), alerts that reach Rafa (T-054, T-055), and any change to the operator fee (T-215).
- A test buyer, needed for the seller-started scenario (backlog).
- Moving the design map (`/map`) to derived task states.
- Any change to `spec/`, the contracts or the settlement layer.

## Evidence

Measured on 2026-11-05 unless a line says otherwise. Live reads were read-only.

**The SDK's default effort for Opus 5.5** (measured): `node tools/one-click/run.mjs --probe --effort unset` (Claude Code 2.1.318, Agent SDK 0.3.318, model `claude-opus-5-5`) printed one `Stop` hook with `effort.level` "medium". The same probe with `--effort high` printed "high", so the hook follows the option. The probe asks only "Reply with the single word: ok", denies every tool and touches no Crow site. So today's two baseline runs, which set no effort under the same versions, ran at medium (inferred).

**The baseline, priced** (measured, `tests/metrics/one-click.test.ts` on the two runs' result messages):

| | Run "once" | Run "always" |
| --- | --- | --- |
| Approvals | 4 (Bash 4, conversational 0) | 4 |
| Opus 5.5's own tokens at Opus 5.5 prices | 177,383 µUSD | 194,333 µUSD |
| The SDK's `costUSD` for Opus 5.5 | 0.17738319999999996 (177,383 µUSD) | 0.1943334 (inferred: total less Haiku's 0.0001279) |
| All tokens at Opus 5.5 prices (`cost.atOpus55.usdMicros`) | 182,499 µUSD | 199,449 µUSD |
| `deltaBps` against the SDK's total | 281 (the Haiku side call at Opus rates) | — |
| Time: wall, model, tool, other | 106,000, 36,001, 69,700 and 299 ms | — |

A medium-effort deal run with the new harness is not done: it waits for Gates item 1, and this session ran no harness against the live site.

**Price tables** (measured, read 2026-11-05):
- Anthropic, https://platform.claude.com/docs/en/about-claude/pricing, USD per million tokens (input, 5-minute write, 1-hour write, cache read, output): Opus 5.5 4, 5, 8, 0.20, 20; Sonnet 5.5 2, 2.50, 4, 0.10, 10; Sonnet 5 2, 2.50, 4, 0.20, 10; Haiku 5.5 0.10, 0.125, 0.20, 0.01, 0.50 for prompts up to 100,000 tokens. Pricing run "once" with these reproduces the SDK's Opus figure to 0.2 µUSD.
- DeepSeek, https://api-docs.deepseek.com/quick_start/pricing/, peak USD per million (cache hit, cache miss, output): `deepseek-flash` 0.006, 0.30, 1.20; `deepseek-v4-pro` 0.044, 1.32, 3.96; off-peak is half; peak hours 01:00 to 04:00 and 06:00 to 10:00 UTC on weekdays.
- Cloudflare Workers Paid, https://developers.cloudflare.com/workers/platform/pricing/: USD 0.30 per million requests over 10 million; USD 0.02 per million CPU ms over 30 million; Durable Objects USD 0.15 per million requests over 1 million and USD 12.50 per million GB-s over 400,000.
- `node scripts/metrics/refresh-prices.mjs`, 15:47 UTC: Chainlink ETH/USD 2,273.205 (updated 15:25:11 UTC); Ethereum gas 5,664,912,934 wei; Base gas 8,554,784 wei; Base L1 fee upper bound for a 2,400-byte transaction 1,089,173,992,688 wei. Function selectors from viem's `toFunctionSelector`.

**The event log** (measured): `curl -N --max-time 15 https://api.escrow.stream/v1/events?from=0` was still open after 15 s, with 240 events in 240 KB: the stream does not end on its own, so `lib.mjs` stops at the head `/v1/status` gave and starts a new page past a 1 MiB cap.

**Live runs of the scripts** (measured, about 15:47 UTC; each file passed `node scripts/metrics/check.mjs`): deal-timing 855 to 1,125 ms, throughput 1,498 to 1,741 ms, ops-cost 440 to 466 ms, against a 30 s limit.

**Crow's processing time** (measured, `deal-timing.json`, 24 deals in the 7-day window: 16 Released, 4 Refunded, 3 other, 1 in progress), median and p90:
- accept 2 s and 3 s; agree 7 s and 11 s; fund 0 s and 0 s; deliver 12 s and 24 s; decide 12 s and 24 s; settle 0 s and 0 s; final 72 s and 3,552 s;
- Crow's processing (accept + fund + decide + settle) 14 s and 26 s over 19 deals; party time 21 s and 33 s; offered to settled 34 s and 55 s;
- the fund stage read below 0 on 9 of 23 deals and counts as 0: `commitment.agreed` is recorded when the funding transaction lands, so the chain's wait shows in "agree". On run "once" (`0xa93a…8f93`) agreed's `at` equals the funding block's time, 13:36:12 UTC, so fund reads 0 and agree 6 s;
- `indexLagMs` reads 0 over 148 chain events: the operators stamp a chain event's `at` with its block's time (inferred), so this lag cannot be seen from the log.

**Throughput** (measured inputs, inferred capacity): 3 deal lanes (from the code), 4 Crow-sent transactions per Released deal (median), 12 s per transaction (the median block gap; the fund stage reads 0), so the relay holds 225 deals an hour and 3 in progress at that rate. The binding limit for a new visitor's test-seller deal is the seller's 20 an hour, and 100 a day. The busiest hour of the last 168 had 11 funded deals (5,500 basis points of 20); the median hour had 0.

**Crow's operating cost per deal** (gas measured from the event log; prices as above; totals inferred), over 16 Released deals:

| Component | Gas | Sepolia | Ethereum | Base |
| --- | --- | --- | --- | --- |
| Fund, median | 840,709 | | | |
| Deliver, median | 173,119 | | | |
| Decide, median | 166,808 | | | |
| Appeal expiry, median | 80,792 | | | |
| The deal, median of each deal's sum | 1,261,428 | | | |
| A new visitor's faucet mint, median of 8 | 140,171 | | | |
| The adjudicators' setup, 3 × 372,709 over 23 funded deals | 48,615 | | | |
| Gas in all | 1,450,214 | USD 0 | USD 18.675143 | USD 0.040582 |
| Judges, checks-only deal | | USD 0 | USD 0 | USD 0 |
| Judges, rubric deal (upper bound: 2,787 input and 561 output tokens over 3 calls today, at Opus 5.5) | | USD 0.022368 | USD 0.022368 | USD 0.022368 |
| Cloudflare | | unknown: no tail run yet | | |
| RPC | | USD 0 (keyless) | | |
| The operator fee, 4,710,000 base units at tUSDC = USD 1 | | USD 4.71 | USD 4.71 | USD 4.71 |
| Fee less checks-only cost | | USD 4.71 | USD −13.965143 | USD 4.669418 |

The median deal's gas equals Rafa's measured 1,261,428 exactly. Runway at the median effective gas price of 999,999,999 wei: the funding lane's 1.81 Sepolia ETH covers 1,291 deals with their mints; the deal lanes cover 10, 17 and 17; 1,333 in all.

**Commands run and results** (measured):
- `pnpm vitest run tests/metrics`: 51 tests pass on slice 2, 67 with slice 1.
- `pnpm vitest run apps/demo-cloud/src/world.test.ts` on slice 3: 37 of 37 pass, the 5 new ones included. `node site/check.mjs` passes; `node site/build.mjs --out` writes `version.json` (`commit` null on a tree with uncommitted changes, as designed).
- `pnpm verify` on each branch: typecheck, lint, forge build, forge, test, spec, snap, snap:local and demo pass, with no snapshot diff, on `t-066-discovery-fields` and `t-066-one-click`. On `t-066-metrics-scripts`, `forge build` failed while the fresh worktree cloned the contract submodules and passed on a rerun; every other step passed.
- CodeQL on PR 215 flagged a test's `startsWith('https://one.test')` as incomplete URL sanitization; the fake fetch now matches the host.
- gitleaks on PR 215 flagged 11 lines of the fixtures where `"token"` is tUSDC's public contract address; their fingerprints are in `.gitleaksignore`, a path outside this task's list, added because the check is required to merge.
- Tests were written beside the scripts rather than strictly before them; each checks a value computed by hand in its comment.

**PR 215's review fixes** (2026-11-05, about 19:35 UTC; Decisions 20 to 25):
- Main moved to 1a2cbd3 (PR 210) and `.gitleaksignore` conflicted. The branch merged `origin/main` and keeps both blocks (measured: no conflict markers left).
- Tests first: 20 new tests and 3 changed ones in `tests/metrics/`, written before the fixes. 17 failed and `schemas.test.ts` failed to load (measured). The two parser tests in the new `tests/metrics/refresh-prices.test.ts` passed, which confirms the review's probe (measured). The zero check (Decision 25, 3 more tests) came after the `perDeal.deals` fix it led to; that it fails on the old code is inferred, since the old code wrote `window.deals` 0 and `usdMicrosAtMargin` "0" with no source. After the fixes, `pnpm vitest run tests/metrics` passes 74 of 74 (measured).
- Live, both nodes up: deal-timing read events 0 to 338, 35 deals in the window and 33 funded deals in the log. ops-cost spread the setup as 3 × 372,709 gas over 33 deals, 33,883 gas a deal, and gave 1,435,494 gas in all. Cloudflare read `basis` "unknown" with `usdMicrosAtMargin` null. Each file passed `check.mjs` (measured).
- Both operators unreachable (`--op1 https://down-1.invalid --op2 https://down-2.invalid`): `deal-timing.json` read `eventLog` null, `window.deals` null and `outcomes` all null. `throughput.json` read `medianPerHour`, `peakPerHour` and `utilizationBps` null, with the gap line. `ops-cost.json` read `perDeal.deals` null and `adjudicatorSetupPerDeal` null, with `adjudicator setup` in `excludes`. Each file passed `check.mjs` (measured).
- `pnpm verify` on the fixes: typecheck, lint, forge build, forge, spec, snap, snap:local and demo pass. The test step failed with 11 timeouts of 30 s while the laptop's 5-minute load average was 61 on 8 CPUs, from other sessions. A rerun at a load of 69 timed out 10 tests in other packages, none in `tests/metrics/` (measured). An earlier `pnpm test` on the same code passed 2,816 tests with 6 skipped (measured). CI on 8a51676 passed all 12 checks, including the four test shards and gitleaks (measured), so the local failures were load timeouts (inferred).
- Not run: `refresh-prices.mjs` against the live mainnet RPCs. This session's rules allow testnet only, so the fake-RPC tests cover it: read methods only, `asOf` from the oldest value, and no change when every read fails.

**Landed and live, 2026-11-06.** The coordinator session measured the first four items; the landing session measured the last two with `gh`.
- **PR 215 merged** as c85147d at 05:59 UTC: the metrics scripts, the price tables and the schemas.
- **crow-private PR 2 merged** as e1e30bb at 06:09 UTC, on Rafa's go-ahead ("You can merge if ready"). Before the merge, the coordinator session reran its tests: 125 of 125 pass.
- **The console build** (run 42172692764, 06:11 UTC) pushed `public.json` (513 KB), `status.json` and `map.html`; each push answered HTTP 204. Its metrics line read:
  - approvals: none, since no run file exists yet;
  - cost per deal: none, for the same reason;
  - Crow's processing time: 15.0 s per deal, median;
  - throughput: 20 deals an hour;
  - Crow's operating cost: USD 18.38 per checks-only deal at Ethereum prices, without Cloudflare.
- **The console Worker** deployed on Rafa's go-ahead ("Yes, deploy it") as crow-console `91ae8a90-6fe0-4830-9020-33e06eef111e`, from crow-private e1e30bb. The rollback target is `c8fe44c5-6a6c-41f7-a370-cb073f335bd0`. Without a sign-in, `/` still answers 302 to Access, and so does an unauthenticated PUT to `/_push/public.json`.
- **crow-private PR 3 merged** as 7911cb3 on 2026-11-05 at 18:16 UTC: the Scheduled refresh row follows the 07:07 and 16:07 Berlin builds (D52).
- **PRs 216 and 217 merged main** (480ca77 and a5e9c00) and pass all 12 CI checks each, gitleaks and CodeQL included. On PR 217, `pnpm vitest run tests/metrics` passes 90 of 90 tests. PR 215 was squashed, so its files conflicted add/add on PR 217. PR 215's tree equals `t-066-metrics-scripts`' last commit (1cee67e), and PR 217 had changed no slice 2 file after it last merged that branch (0910265). So each conflict took main's side, and PR 217 now differs from main only in its 8 own files.

**Open bug, Medium, fixed outside this task:** the console's build job reads GitHub, Anthropic, npm and the Sepolia RPC as "unknown (HTTP 405)", while its source job reads them as up (measured by the coordinator session, 2026-11-06). Impact: the dependency status in the build's output shows those four as unknown. The coordinator session fixes it separately.

**Reviews of PRs 216 and 217, 2026-11-06.** One `reviewer` pass each, against this file and `docs/team.md`'s Rules and checks; no red team, since both are display and metrics changes. The findings are in Handoff, unfixed, because the PRs are deferred.
- PR 217 (the harness), at a5e9c00: 5 Medium and 6 Low findings, none High. The reviewer measured the integer pricing against the pinned table (177,383.2 µUSD for Opus 5.5's own tokens of run "once", 182,499 µUSD for all tokens), the schema check on both fixtures, and the SDK's isolation from CI.
- PR 216 (the discovery fields), at 480ca77: 1 High, 1 Medium and 5 Low findings. The disclosure check passed: each new field shows only what is already public on chain or in the repository, and no key, email, IP address or internal URL (measured with hostile `BUILD_COMMIT` values, and from the code paths).

## Decisions

Proposed by the architect on 2026-11-05. The builders confirm or change them here, and Rafa can overrule any of them.

1. **Harness results reach the console as files committed to the private repository** (`control/metrics/one-click/`). The hourly job's `source` step already hands `control/` to the build, so no new push name and no Worker transport change are needed, and every run keeps a history. The alternative is a `metrics` push name for the Mac's service token: a Worker change, and the build could not combine the Cloudflare counts with the hourly gas data.
2. **One model price table** for this task and T-053 (`config/model-prices.json`, in T-053's shape), so the two reports price tokens alike.
3. **Gas from the operators' public event log** (`payload.gasUsed`, `payload.sender`, `payload.tx`), which carries it per deal with no key since schema v0.9. Receipts are read only for `effectiveGasPrice` (runway) and faucet mints.
4. **Cloudflare per deal from `wrangler tail` during one harness deal:** a counted source tied to a single deal, needing only the login the Mac already has. T-053 keeps the billed monthly figure. The alternative, GraphQL analytics with a read token, gives hourly totals that need dividing by deals.
5. **Deploy drift from build commits that the nodes publish** (slice 3), with no token. A Cloudflare token adds version IDs in a job of its own.
6. **The metric scripts run in the hourly `build` job,** which holds no secret, as T-060's do.
7. **`tools/one-click/` stays outside the pnpm workspace,** so `pnpm-lock.yaml` (tier 2) does not change and CI never installs the SDK.

Builder 1, 2026-11-05 (confirmed 1 to 7; added these):

8. **Slice 2 carries the shared pieces, and slice 1 stacks on it.** `config/model-prices.json` and every schema, `one-click` included, ship in slice 2's PR: `ops-cost.mjs` needs the model prices, and the schemas folder is slice 2's. Slice 1's branch starts from slice 2's, so merge slice 2 first.
9. **The event reader stops at the head.** The stream does not end on its own (Evidence), so `readEvents` reads `/v1/status`'s head first and stops there; a page past the 1 MiB cap ends at its last whole event, and the next page starts after it. Node 2 answers when node 1 does not.
10. **A stage that reads below 0 counts as 0, and is counted.** Each stage carries `clamped`, and a gap line names it. Today that is the fund stage, whose time shows in "agree".
11. **Deal lanes come from `scripts/metrics/crow-accounts.json` until discovery publishes them.** It copies the three addresses from `docs/operations.md` and says so in every output's gaps; discovery's `demo.relayer` wins once slice 3 is deployed.
12. **The cost per deal is a new visitor's.** Its gas sums the medians of the deal's own gas, one faucet mint and the adjudicators' one-time setup spread over the funded deals (over the whole event log since Decision 21). Each total names what it leaves out (`excludes`), so a missing Cloudflare count never reads as USD 0.
13. **Cloudflare duration** counts only events the tail marks `executionModel: "durableObject"`, at 128 MB: micro-GB-s = wall ms × 125. Whether the tail carries CPU and wall time is still open (Handoff).
14. **Price sources:** Chainlink's ETH/USD feed by `eth_call` (keyless, on chain) for the ETH price; Base's L1 fee as the GasPriceOracle's upper bound for a 2,400-byte transaction, about the median calldata of a deal's transactions (1,028 to 2,788 bytes measured).
15. **The harness has a `--probe` mode** that denies every tool and touches no Crow site, to measure the default effort without Gates item 1's risk.
16. **Judge tokens by model count one call per usage report** (`tokensToday.byModel[model].calls`), while `liveCallsToday` counts budget takes; a call that fails reports no usage.
17. **The binding limit leaves out per-client caps** (they bind one client, not Crow) and counts a day's cap as an hour's ceiling; it also names the daily binding limit.
18. **Utilization uses the peak hour.** The median hour reads 0 on today's traffic, so a median-based figure would say nothing.
19. **A dirty tree publishes no commit.** `deploy.mjs` and `site/build.mjs` set the commit only when `git status` shows no tracked change, so a live commit always names exactly what runs.

Builder 1, 2026-11-05, after PR 215's review (eight findings, all fixed):

20. **No event log means null counts, not zeros.** `buildDealTiming` takes `events: null` when no node served the log. Then `window.deals`, `inProgress`, every stage's `deals` and `clamped`, the totals' `deals`, `indexLagMs.events` and `outcomes` read null. `throughput.json`'s observed deals and utilization read null when `deal-timing.json` is missing or has `eventLog: null`. `ops-cost.json`'s `perDeal.deals` reads null in the same case. The schemas allow null there (`CountOrNull`; `MsStats.deals` in `common.schema.json`).
21. **The adjudicators' setup is spread over every funded deal in the event log.** `eventLog.fundedDeals` counts them, of any age. The window's count is the floor, so a world older than 7 days no longer reads high. Discovery that lists no adjudicator gives a setup of 0. Discovery that cannot be read gives null, with `adjudicator setup` in each total's `excludes` and a gap line.
22. **An unknown Cloudflare cost has no margin.** `usdMicrosAtMargin` is "0" beside tail counts and null when `basis` is "unknown".
23. **ops-cost prices a run file only if it passes the one-click schema.** `newestTailRun` takes the schema check from `check.mjs`, loaded lazily so the rest of ops-cost still needs no package. Without Ajv, no run file is priced, and a gap line says so. Durable Object wall time is tracked as CPU time is: with Durable Object requests but no wall time, `durationGbS` reads null and a gap line names it.
24. **The price file is as fresh as its oldest value.** `refresh-prices.mjs` sets `asOf` to the oldest `readAt` of the four values it refreshes. When it reads none, it writes nothing and exits 1. It sends only `eth_chainId`, `eth_feeHistory` and `eth_call` (`READ_METHODS`), and refuses any other method before sending.
25. **A test checks the whole class of bug.** `tests/metrics/schemas.test.ts` ("a missing source never reads 0") builds each file with every source missing and lists every leaf that reads 0. Only two constants (checks-only judges, RPC) and four sample counts beside a null median may appear.

## Handoff

- **State (2026-11-06):** paused, partly done. Rafa moved all work that does not finish stable EVM operations to a later phase (2026-11-06).
  - **Live:** slice 2, the metrics scripts (PR 215, merged as c85147d); scope B, the console's new sections and headline metrics (crow-private PRs 2 and 3, merged as e1e30bb and 7911cb3), deployed as crow-console `91ae8a90` with rollback target `c8fe44c5` (Evidence).
  - **Deferred until after stable EVM operations:**
    - PR 217, the One-Click harness (`t-066-one-click`, draft). It merged main at a5e9c00 and passes CI. Fix its 11 review findings (below) before it leaves draft.
    - PR 216, the discovery fields (`t-066-discovery-fields`, draft). It merged main at 480ca77 and passes CI. Fix its 7 review findings (below), the High one first, before it leaves draft. After it merges, it reaches the live demo only with Rafa's operator deploy (holdback-op1, holdback-op2) and site deploy (crow-site), Gates item 6.
    - Where the harness runs (Gates item 1): on the Mac, or in CI with a capped Anthropic key. The harness's schedule, the push of its run files and `wrangler tail` (items 2 to 4) follow from that choice.
    - The optional Cloudflare read token (Gates item 5), and the optional price-refresh schedule (item 7).
  - **The daily cloud run is T-068** (`docs/tasks/T-068-daily-one-click-measurement.md`; Rafa, 2026-11-06: "Move daily one-click measurements to infrastructure management phase"). It takes Gates items 1 to 3 to the cloud: a holdback GitHub Actions workflow runs the harness once a day with a capped Anthropic key from a main-only environment, and uploads run files as artifacts in place of a push to crow-private. It starts only after PR 217 merges with the findings below fixed, finding 1 (`SSH_AUTH_SOCK`) and finding 9 (the CI sign-in) first.
  - **Waiting on Rafa now:** nothing. When the work resumes, Gates items 1 to 5 and 7 and the PR 216 deploys wait for him.
- **PR 217's review findings** (2026-11-06, at a5e9c00; unfixed). Medium:
  1. `tools/one-click/run.mjs:93` keeps `SSH_AUTH_SOCK` in the child's environment (`KEEP`). The auto-approved assistant could use Rafa's loaded SSH keys, for example to push to GitHub. Fix: drop it from `KEEP`.
  2. `run.mjs:105` and `:356`: a `wrangler tail` that never connects (no login, no network, a failed `npx` install) still writes `basis: "tail"` with 0 requests, and `ops-cost.mjs` then prices Cloudflare at USD 0 (the failure Decisions 22 and 25 guard against). Fix: track each tail process's exit; leave a failed Worker out with a gap line, or write `cloudflare: null` when none connected.
  3. `run.mjs:125-133` counts a Durable Object event in `requests` and `cpuMs` as well as in `durableObjectRequests`, so `ops-cost.mjs` prices it twice. Fix: count it only in the Durable Object fields, and confirm the tail's event shape on the first `--tail` run.
  4. `run.mjs:67`, `:153-158` and `:324`: `time.wallMs` starts before the homepage fetch and the 10 s tail wait, so with `--tail`, `time.otherMs` gains about 10,000 ms. Fix: start the clock when the prompt is sent.
  5. `run.mjs:205` and `tools/one-click/metrics.mjs:34-41`: `approvals.requests[].summary` keeps header values and IP addresses (measured: a `curl -H 'x-api-key: …' http://10.0.0.5/` reached the run file), and stores `JSON.stringify(input)`, the assistant's own text, for tools other than Bash, WebFetch and file tools. The data rules forbid all three. Fix: replace `-H` values and IP literals in `scrub`, show URLs as origin and path, and show other tools by name only.
  Low:
  6. `--probe` denies only tools that ask for permission (`run.mjs:217`, `:233-249`); Decision 15 says it denies every tool. Fix: pass `tools: []` in probe mode.
  7. `--model` is not checked against the schema's `MODEL_ID` pattern, and the run file is written before its schema check (`metrics.mjs:168`, `run.mjs:380-386`). Fix: check at startup; write to a temporary name and rename it after the check passes.
  8. `run.mjs:352`: with no commitment ID, `otherDealsInWindow` counts the run's own deal. Fix: write null.
  9. The CI option in `tools/one-click/README.md:16` cannot sign in: the environment filter drops `ANTHROPIC_API_KEY`. Fix: say "Mac login only", or add an opt-in flag that passes the key.
  10. Both fixtures (`tests/metrics/fixtures/one-click-once.json:161` and `one-click-always.json:161`) keep `credential_expires_at`, the expiry time of Rafa's Claude login. No test reads it. Fix: delete it.
  11. The README writes "T-039's VM" with no plain phrase, and omits the root `pnpm install` that `scripts/metrics/check.mjs` needs for Ajv.
- **PR 216's review findings** (2026-11-06, at 480ca77; unfixed). The disclosure check passed (Evidence).
  1. **High:** the published contract refuses the new fields. `spec/openapi/paths.json:729-761` sets `additionalProperties: false` on `Discovery.demo` and on `demo.faucet`. The reviewer checked the PR's discovery with `openApiValidators` from `scripts/openapi.mjs`: the SimChain world fails on `demo`, the chain world fails on `demo` and `demo/faucet`, and today's live discovery passes (measured). After a deploy, both nodes would serve a discovery document that their own `/v1/openapi.json` calls invalid. This file's claim that `demo` has no schema in `spec/` (slice 3, step 1) checked `spec/schemas/` only; `docs/api.md:455` and `world.ts:1231` repeat it. Fix: add `build`, `relayer` and `faucet.mintsPerDay` to `Discovery.demo` in `paths.json`, run `pnpm openapi` and bump `info.version`, as commit 320bd75 did for the faucet fields. Also add a `world.test.ts` test that checks both worlds' discovery against `Discovery`. `spec/` is outside this task's paths: the architect widens them and decides whether the change needs an ADR (`CLAUDE.md`, The contract), or a small `spec(openapi)` PR lands first.
  2. **Medium:** api2 shows holdback-op1's commit. The World Durable Object runs with holdback-op1's environment (`apps/demo-cloud/src/worker.ts:100-101`, `:110`), and the op2 Worker forwards no build value (`:178-188`), so if op2's deploy fails after op1's, api2 still shows the new commit (inferred from code). Fix: have each Worker pass its own `env.BUILD_COMMIT` in an internal header, as it does for the node and origin headers, or document that the field names holdback-op1's deploy.
  3. Low: the clean-tree check in `deploy.mjs:16-20` and `site/build.mjs:582-587` counts a failed `git status` as clean, misses untracked files the build reads (`embed.mjs` reads every `spec/schemas/*.schema.json`), and is copied in two files with no test. Fix: one pure function that checks both exit codes, with a unit test.
  4. Low: `docs/costs.md:145` and `docs/operations.md:196` still say judge tokens have no model split, and `JudgeBudget.on()` (`judges.ts:54-56`) returns a shallow copy that shares `byModel` with the live day. Fix: update both docs and deep-copy in `on()`.
  5. Low: `docs/api.md:455-464` uses the passive voice, omits that the commit is also null after a manual `wrangler deploy`, and does not say that `calls` counts usage reports (Decision 16): a 200 answer with no text counts as a call with 0 tokens.
  6. Low: the new block in `world.ts` landed between the operator-fee doc comment (`:1224-1228`) and its function. Fix: move the block above the comment.
  7. Low: no test checks that `byModel` resets at the UTC day; the reviewer checked it by hand and it does. Fix: add a day-rollover case to the `JudgeBudget` test.
- **To resume scope A** (after stable EVM operations):
  - Check out each draft PR's branch in a new worktree (`git -C <repo> worktree add .worktrees/<name> <branch>`), merge `origin/main`, fix the findings above test first, run `pnpm verify`, and mark the PR ready.
  - Rafa answers Gates item 1; then `npm ci --ignore-scripts --prefix tools/one-click` and `node tools/one-click/run.mjs --scenario buyer --effort medium --tail --out reports/scratch/one-click` give the medium-effort run and the first Cloudflare counts. Record them in Evidence, and copy the run file to the private repository's `control/metrics/one-click/` (Gates item 3).
  - After slice 3 is deployed (Gates item 6): `curl -s https://api.escrow.stream/ | jq .demo.build` on both nodes, then delete `scripts/metrics/crow-accounts.json`'s use once `demo.relayer` is live, and re-run the three scripts.
- **A check to propose for `docs/team.md` (Rules and checks), outside this task's paths:** "Every operator node's discovery matches the published contract." A test in `apps/demo-cloud/` that checks the SimChain world's and the chain world's discovery against `#/components/schemas/Discovery`. The row "Operator answers match the contract" covers only `apps/operator`'s sim world (`tests/contract/openapi.contract.test.ts:19`), so PR 216's closed-object failure passed CI.
- **T-229 (One-Click homepage, done):** it measured 1 approval per deal after its deploy with its own copy of the scratch harness, kept as evidence in `docs/research/2026-11-05-one-click/`. `tools/one-click/` is the maintained harness, with the run file the console reads; the first medium-effort run should reproduce T-229's 1 approval. The homepage prompt changed with T-229 (it now carries the one command), so the harness checks only that the live prompt starts with "Run a test deal with Crow" (`prompt.matchesExpected`) and records the prompt as served.
- **D52 (Rafa, 2026-11-05) replaced the hourly console build with two a day, at 07:07 and 16:07 Berlin time,** after this task was drafted. Read "the hourly build" in this file as "each scheduled build". For scope B: the stale mark for the build files should follow the longest gap between builds (15 h) rather than 2 h, and the three scripts read live data, so D52's "a run with nothing new ends in seconds" should skip them on such a run; each takes 0.4 to 1.7 s (measured).
- **For scope B:** the schemas in `scripts/metrics/schemas/` are the exact shapes; `reports/scratch/` outputs of a live run make realistic fixtures. Additions beyond the plan's sketch: `stages[].clamped`, `deals[].buyer`, `deals[].stagesMs`, `deals[].fee`, `txs[].step`, `eventLog` and `eventLog.fundedDeals`, `capacity.medianLifetimeMs`, `limits[].perClient`, `binding.assumes` and `binding.perDay`, `observed.utilizationOf`, `perDeal.gas.dealTxs` and `dealGas`, `total.*.excludes` (with `adjudicator setup`), `cost.atOpus55.byModel`, and the Durable Object counts in a run file's `cloudflare.workers`. Counts read null when their source is unknown (Decision 20), so the reader must show null as "unknown", never as 0.
- **For scope B, the run files:** ops-cost prices Cloudflare only from a run file that passes the one-click schema, and that check needs Ajv (Decision 23). The console's `build` job checks out holdback without `pnpm install` (measured: `.github/workflows/control-hourly.yml` in the private repository). There Cloudflare reads "unknown", and a gap line says Ajv could not be loaded. To price it, the job installs holdback's packages (`pnpm install --frozen-lockfile --ignore-scripts`) before the three scripts run.
- **Open questions:**
  - Rafa: where the harness runs (Gates, item 1), deferred until after stable EVM operations.
  - Builder 1, answered: the default effort (medium), whether `/v1/events` ends (no), keyless sources for the ETH price and Base's L1 fee (Chainlink and the GasPriceOracle).
  - Still open: whether `wrangler tail` events carry CPU time (needs the first `--tail` run).
- **A second check to propose for `docs/team.md` (Rules and checks), outside this task's paths:** "A source that cannot be read gives unknown (null), never 0", enforced by a test that builds each output with every source missing and lists every leaf that reads 0 or "0", against a short allowlist of constants. `tests/metrics/schemas.test.ts` ("a missing source never reads 0") is that test for the metrics files. PR 215's review found the failure five times: throughput's observed deals, deal-timing's counts, the Cloudflare margin, the Durable Object duration, and the setup share. The same test fits any script that reports figures from external sources.
- **A check to propose for `docs/team.md` (Rules and checks), outside this task's paths:** the Write tool turned backslash-u escapes for the line separator (code point 2028) and its neighbours in a regular expression into the invisible characters themselves, which broke a parse. ESLint's `no-irregular-whitespace` with `skipRegExps: false` and `skipStrings: false`, or a test that scans `scripts/` and `tools/` for C0, C1, zero-width, separator and direction characters, would catch it. Build such ranges from code points at run time, as `control/deps.mjs` and `tools/one-click/metrics.mjs` do.
