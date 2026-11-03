# T-052: The read-only cost collector

- **Lane:** infra
- **Phase:** 9
- **Depends on:** T-051 step 1 (the Anthropic organization check), for the Anthropic source only; T-213 (Sepolia settlement) live, with `SETTLEMENT` set to `sepolia`, for the Sepolia source only. The rest can be built before any credential exists.
- **Paths this task may touch:** `scripts/costs/collect.mjs` (new), `scripts/costs/money.mjs` (new), `scripts/costs/dir.mjs` (new), `scripts/costs/sources/*.mjs` (new, one per source), `tests/costs/collect.test.ts` (new), `tests/costs/fixtures/` (new, synthetic responses only), `config/costs.template.json` (new), `config/keys-costs.template` (new), `package.json` (a `costs:collect` script), `docs/costs.md`, `docs/tasks/T-052-cost-collector.md`
- **Human gate:** **yes** for the credentials and the dedicated clone: Rafa creates them. **No** for the build: tests use synthetic fixtures and no network.
- **Status:** todo
- **Agent/session:** —

## Intent

One command reads what every provider says Crow used and cost, with credentials that can read but not spend where the provider allows it, and writes a dated private file that the report (T-053) and the rules (T-054) read.

- Inputs: each source's usage or billing API, listed in `docs/costs.md` ("Inventory" and "Read-only credentials"); the local Claude Code transcripts; T-031's day lines; the Sepolia balances.
- Outputs: `<YYYY-MM-DD>.json` and a copy at `latest.json` in the cost directory (`CROW_COSTS_DIR`); the day-line export in `CROW_TELEMETRY_DIR`, which T-042 reads too.
- Non-goals: the report (T-053), rules and alerts (T-054), a schedule (T-055), any write to any provider.

## Context

- `docs/costs.md`: the inventory, the read-only credentials table, "Where credentials and figures live".
- Hard rules: secrets come from environment variables only, and agents never read `.env` or `.env.costs`; money is a decimal string, never a float.
- `docs/operations.md` (Telemetry): T-031's day lines and the GraphQL datasets.
- T-042 (the agent-ops phase, PR 131): reads T-031's aggregates "from a private export". This task builds that export once, so the logs have one reader.

## Rafa's steps

Every step is **human**. About 40 minutes (guessed).

1. **The dedicated clone** (5 min). Clone the repository somewhere no agent works and outside `~/Documents`, where macOS privacy controls may block a scheduled job (inferred): for example `git clone https://github.com/rafaeldavid/holdback /Users/<you>/crow-costs`. The collector, and later the daily routine (T-055), run only here, and only you run them.
2. **Cloudflare** (10 min). At https://dash.cloudflare.com/profile/api-tokens, choose Create Token, then Custom token. Name it `crow-costs-read`. Permissions: Account · Billing · Read, and Account · Account Analytics · Read. Account Resources: Include, your account only. TTL: 90 days. Copy it once.
3. **Anthropic** (5 min). As an organization admin, create an Admin key named `crow-costs-read` at https://platform.claude.com/settings/admin-keys. It has full organization access, because no read-only scope exists (documented). Skip this step if your account is not an organization (T-051, step 1); the collector then marks Anthropic as "entered by hand".
4. **GitHub** (5 min). At https://github.com/settings/personal-access-tokens/new, create a fine-grained token named `crow-costs-read` with no repository access and the user permission Plan: Read. Expiry: 90 days.
5. **DeepSeek** (2 min). At https://platform.deepseek.com/api_keys, create a key named `crow-costs-read`. It can spend like any key (inferred); the balance stays the cap.
6. **`.env.costs`, in the dedicated clone only** (5 min). Create it at the clone's root from `config/keys-costs.template`, and keep no other copy. It holds `CROW_COSTS_CLOUDFLARE_TOKEN`, `CROW_COSTS_ANTHROPIC_ADMIN_KEY`, `CROW_COSTS_GITHUB_TOKEN`, `CROW_COSTS_DEEPSEEK_KEY`, `CLOUDFLARE_ACCOUNT_ID`, and two directories as full paths, outside the clone (`--env-file` does not expand `~`, inferred): `CROW_COSTS_DIR` (for example `/Users/<you>/crow-data/costs`, where the T-051 register already is) and `CROW_TELEMETRY_DIR` (for example `/Users/<you>/crow-data/telemetry`). Add each token's expiry to the register.
7. **Run it once, in the clone** (2 min): `node --env-file=.env.costs scripts/costs/collect.mjs`. It prints only which sources it read and which it could not.

## Agent steps

1. **Node built-ins only.** Every file under `scripts/costs/` imports only `node:` modules, so no package from the lockfile runs with the billing keys and the clone needs no `pnpm install`. Config files are JSON for the same reason.
2. **Money** (`money.mjs`). Parse a provider's amount from its JSON text into cents as a decimal string, with its currency, never through a float: Anthropic already reports cents as decimal strings; Cloudflare and GitHub report dollar amounts, so read the raw number token from the response text; DeepSeek reports a balance in CNY or USD, kept in its own currency. Token counts and wei are bigint. Prices are integers in micro-dollars per million tokens, and totals round to whole cents only when shown.
3. **The directories** (`dir.mjs`). `CROW_COSTS_DIR` and `CROW_TELEMETRY_DIR` are required and must be absolute; there is no default. Each one must lie outside the clone the script runs from. If one is inside another git work tree, it must be git-ignored there (`git check-ignore`) and must not be inside a linked worktree (its `git rev-parse --git-common-dir` differs from `--git-dir`), since a worktree's `reports/` goes with the worktree.
4. **One source module each**, all read-only, each returning lines of `{source, product, unit, quantity, amount: {cents, currency} | null, basis: "billed" | "estimated" | "balance", periodFrom, periodTo}`:
   - `cloudflare-billing`: `GET /client/v4/accounts/{id}/billable-usage?from=&to=`, the month to date.
   - `cloudflare-analytics`: GraphQL, per Worker requests and CPU time, and the Durable Object datasets in `docs/operations.md`.
   - `anthropic`: `GET /v1/organizations/cost_report` grouped by workspace and description, and `GET /v1/organizations/usage_report/messages` grouped by workspace, key and model, day buckets.
   - `github`: `GET /users/{username}/settings/billing/usage` for the month. Confirm the path, parameters and token permission against GitHub's reference before coding (a probe on 2026-11-03 answered 503, measured).
   - `deepseek`: `GET /user/balance`.
   - `sepolia`: `eth_getBalance` on a public RPC for the funding lane, which discovery names, and for the deal lanes, the demo adjudicators and the deployer, whose public addresses come from the register. No address is hard-coded. A deal lane that reads under 0.01 Sepolia ETH is read again two minutes later, and both reads are recorded, because the world tops lanes up at most once a minute (T-054's relayer rule needs both).
   - `claude-code`: the local transcripts under `~/.claude/projects/`, including each session's `subagents/` folder, kept only when the entry's `cwd` is a checkout of this repository or one of its worktrees. Per day, session, git branch and model: input and output tokens, cache writes split by lifetime, cache reads, `speed`, `service_tier` and server tool use counts, from each response's `usage`. Read only those fields, never message content. Count each response once: entries that share a `requestId` repeat one response's usage (inferred; check before trusting the sums). Label the source "laptop sessions only".
   - `telemetry`: T-031's `telemetry: "day"` lines, written as they are to `CROW_TELEMETRY_DIR`, the export T-042 reads. Decide and record how to read them without a new secret: the Workers Observability query API with the Cloudflare token (to check: endpoint and permission), or a Workers Logs export Rafa saves.
5. **`collect.mjs`** runs every source whose credential is set, with a timeout each. A failing source writes `{source, ok: false, error}` with the error's type and status, never the response body or a header, and the others still run. It writes only in the two directories.
6. **`config/costs.template.json`**: the accounts list (no values), the budget and threshold keys T-053 and T-054 read, with empty values. Rafa's copy is `budgets.json` in the cost directory.
7. **`config/keys-costs.template`**: the variable names, one comment line each, pointing to `docs/costs.md`, and the instruction to create `.env.costs` only in the dedicated clone.

## Acceptance criteria

- [ ] `pnpm vitest run tests/costs/collect.test.ts` passes with no network: each source parses a synthetic fixture into the expected lines; a failing source leaves the others' lines intact; money never passes through a JavaScript number (a test feeds amounts such as `0.1` and `1e-7` and checks the exact cents strings).
- [ ] A test shows every import under `scripts/costs/` is a `node:` module.
- [ ] A test shows no credential value and no response body reaches stdout, stderr or an output file, using a fake token string.
- [ ] A test shows the collector writes nothing outside the two directories, and refuses a missing or relative directory, one inside the clone, a non-ignored one inside another checkout, or one inside a linked worktree.
- [ ] A test shows a deal lane under 0.01 is read a second time and both reads are recorded (a fake clock and RPC).
- [ ] The transcript source reads only `usage`, `model`, `sessionId`, `gitBranch`, `cwd`, `timestamp` and `requestId`, includes `subagents/`, and drops other repositories (a test with a transcript whose message content holds a secret-looking string, which never appears in the output, and one from another `cwd`, which is dropped).
- [ ] No fixture holds a real figure: fixtures are synthetic, and the PR says so.
- [ ] Rafa ran it once in the dedicated clone; Evidence records which sources read and which failed, without any amount (measured).

## Out of scope

- The report and unit costs (T-053), rules and CPU limits (T-054), scheduling and alerts (T-055), the OpenAI and exe.dev accounts until they exist, an OpenTelemetry source for cloud or VM sessions (later, once T-039 moves sessions off the laptop).

## Evidence

## Decisions

- One reader of T-031's day lines: this task exports them for both the cost collector and T-042, so the agent-ops phase does not build a second reader (review of this phase's PR, 2026-11-03).
- Billing figures and what the agent-ops phase may read live in separate directories, so pointing T-042 at its directory never exposes a figure.

## Handoff
