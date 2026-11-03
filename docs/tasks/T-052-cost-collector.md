# T-052: The read-only cost collector

- **Lane:** infra
- **Phase:** 10
- **Depends on:** T-051 step 1 (the Anthropic organization check), for the Anthropic source only; T-213 (Sepolia settlement, PR 138) deployed, for the Sepolia source only. The rest can be built before any credential exists.
- **Paths this task may touch:** `scripts/costs/collect.mjs` (new), `scripts/costs/money.mjs` (new), `scripts/costs/dir.mjs` (new), `scripts/costs/sources/*.mjs` (new, one per source), `tests/costs/collect.test.ts` (new), `tests/costs/fixtures/` (new, synthetic responses only), `config/costs.template.yaml` (new), `config/keys-costs.template` (new), `package.json` (a `costs:collect` script), `docs/costs.md`, `docs/tasks/T-052-cost-collector.md`
- **Human gate:** **yes** for the credentials: Rafa creates them and puts them in `.env.costs`. **No** for the build: tests use synthetic fixtures and no network.
- **Status:** todo
- **Agent/session:** —

## Intent

One command reads what every provider says Crow used and cost, with credentials that can read but not spend where the provider allows it, and writes a dated private file that the report (T-053) and the rules (T-054) read.

- Inputs: each source's usage or billing API, listed in `docs/costs.md` ("Inventory" and "Read-only credentials"); the local Claude Code transcripts; T-031's day lines; the Sepolia balances.
- Output: `<YYYY-MM-DD>.json` and a copy at `latest-full.json` in the cost directory (`CROW_COSTS_DIR`), git-ignored or outside any repository; and the day-line export in `reports/telemetry/` of the main checkout, which T-042 reads too.
- Non-goals: the report (T-053), rules and alerts (T-054), a schedule (T-055), any write to any provider.

## Context

- `docs/costs.md`: the inventory, the read-only credentials table, "Where credentials and figures live".
- Hard rules: secrets come from environment variables only, and agents never read `.env` or `.env.costs`; money is a decimal string, never a float.
- `docs/operations.md` (Telemetry): T-031's day lines and the GraphQL datasets.
- T-042 (Phase 9, PR 131): reads T-031's aggregates "from a private export" into `reports/telemetry/`. This task builds that export once, so the logs have one reader.

## Rafa's steps

Every step is **human**. About 30 minutes (guessed).

1. **Cloudflare** (10 min). At https://dash.cloudflare.com/profile/api-tokens, choose Create Token, then Custom token. Name it `crow-costs-read`. Permissions: Account · Billing · Read, and Account · Account Analytics · Read. Account Resources: Include, your account only. TTL: 90 days. Copy it once.
2. **Anthropic** (5 min). As an organization admin, create an Admin key named `crow-costs-read` at https://platform.claude.com/settings/admin-keys. It has full organization access, because no read-only scope exists (documented), so it stays in `.env.costs` only. Skip this step if your account is not an organization (T-051, step 1); the collector then marks Anthropic as "entered by hand".
3. **GitHub** (5 min). At https://github.com/settings/personal-access-tokens/new, create a fine-grained token named `crow-costs-read` with no repository access and the user permission Plan: Read. Expiry: 90 days.
4. **DeepSeek** (2 min). At https://platform.deepseek.com/api_keys, create a key named `crow-costs-read`. It can spend like any key (inferred); the balance stays the cap.
5. **Put them in `.env.costs`** (5 min), a file of its own at the root of the checkout that runs the collector, so the scripts that load `.env` never see the Admin key. Use the names in `config/keys-costs.template`: `CROW_COSTS_CLOUDFLARE_TOKEN`, `CROW_COSTS_ANTHROPIC_ADMIN_KEY`, `CROW_COSTS_GITHUB_TOKEN`, `CROW_COSTS_DEEPSEEK_KEY`, plus `CLOUDFLARE_ACCOUNT_ID` and `CROW_COSTS_DIR` (an absolute path; the main checkout's `reports/costs/` by default). Add each token's expiry to the register.
6. **Run it once** (2 min): `node --env-file=.env.costs scripts/costs/collect.mjs`. It prints only which sources it read and which it could not.

## Agent steps

1. **Money** (`money.mjs`). Parse a provider's amount from its JSON text into cents as a decimal string, with its currency, never through a float: Anthropic already reports cents as decimal strings; Cloudflare and GitHub report dollar amounts, so read the raw number token from the response text; DeepSeek reports a balance in CNY or USD, kept in its own currency. Token counts and wei are bigint. Prices are integers in micro-dollars per million tokens, and totals round to whole cents only when shown.
2. **The cost directory** (`dir.mjs`). Read `CROW_COSTS_DIR`, which must be absolute. If it is inside a git work tree, it must be git-ignored there (`git check-ignore`). Refuse a directory inside a linked worktree (its `git rev-parse --git-common-dir` differs from `--git-dir`), since a worktree's `reports/` goes with the worktree. Without the variable, use the main checkout's `reports/costs/`.
3. **One source module each**, all read-only, each returning lines of `{source, product, unit, quantity, amount: {cents, currency} | null, basis: "billed" | "estimated" | "balance", periodFrom, periodTo}`:
   - `cloudflare-billing`: `GET /client/v4/accounts/{id}/billable-usage?from=&to=`, the month to date.
   - `cloudflare-analytics`: GraphQL, per Worker requests and CPU time, and the Durable Object datasets in `docs/operations.md`.
   - `anthropic`: `GET /v1/organizations/cost_report` grouped by workspace and description, and `GET /v1/organizations/usage_report/messages` grouped by workspace, key and model, day buckets.
   - `github`: `GET /users/{username}/settings/billing/usage` for the month. Confirm the path, parameters and token permission against GitHub's reference before coding (a probe on 2026-11-03 answered 503, measured).
   - `deepseek`: `GET /user/balance`.
   - `sepolia`: `eth_getBalance` on a public RPC for the funding lane, which discovery names, and for the deal lanes, the demo adjudicators and the deployer, whose public addresses come from the register. No address is hard-coded.
   - `claude-code`: the local transcripts under `~/.claude/projects/`, including each session's `subagents/` folder, kept only when the entry's `cwd` is this repository's main checkout or one of its worktrees. Per day, session, git branch and model: input and output tokens, cache writes split by lifetime, cache reads, `speed`, `service_tier` and server tool use counts, from each response's `usage`. Read only those fields, never message content. Count each response once: entries that share a `requestId` repeat one response's usage (inferred; check before trusting the sums). Label the source "laptop sessions only".
   - `telemetry`: T-031's `telemetry: "day"` lines, written as they are to `reports/telemetry/` in the main checkout, the export T-042 reads. Decide and record how to read them without a new secret: the Workers Observability query API with the Cloudflare token (to check: endpoint and permission), or a Workers Logs export Rafa saves.
4. **`collect.mjs`** runs every source whose credential is set, with a timeout each. A failing source writes `{source, ok: false, error}` with the error's type and status, never the response body or a header, and the others still run. It writes only in the cost directory and the telemetry export.
5. **`config/costs.template.yaml`**: the accounts list (no values), the budget and threshold keys T-053 and T-054 read, with empty values. Rafa's copy is `budgets.yaml` in the cost directory.
6. **`config/keys-costs.template`**: the variable names, one comment line each, pointing to `docs/costs.md`, and the line `cp config/keys-costs.template .env.costs`.

## Acceptance criteria

- [ ] `pnpm vitest run tests/costs/collect.test.ts` passes with no network: each source parses a synthetic fixture into the expected lines; a failing source leaves the others' lines intact; money never passes through a JavaScript number (a test feeds amounts such as `0.1` and `1e-7` and checks the exact cents strings).
- [ ] A test shows no credential value and no response body reaches stdout, stderr or an output file, using a fake token string.
- [ ] A test shows the collector writes nothing outside the cost directory and the telemetry export, refuses a relative or non-ignored `CROW_COSTS_DIR`, and refuses one inside a linked worktree.
- [ ] The transcript source reads only `usage`, `model`, `sessionId`, `gitBranch`, `cwd`, `timestamp` and `requestId`, includes `subagents/`, and drops other repositories (a test with a transcript whose message content holds a secret-looking string, which never appears in the output, and one from another `cwd`, which is dropped).
- [ ] No fixture holds a real figure: fixtures are synthetic, and the PR says so.
- [ ] Rafa ran it once with his credentials; Evidence records which sources read and which failed, without any amount (measured).

## Out of scope

- The report and unit costs (T-053), rules and CPU limits (T-054), scheduling and alerts (T-055), the OpenAI and exe.dev accounts until they exist, an OpenTelemetry source for cloud or VM sessions (later, once T-039 moves sessions off the laptop).

## Evidence

## Decisions

- One reader of T-031's day lines: this task exports them for both the cost collector and T-042, so Phase 9 does not build a second reader (review of PR for Phase 10, 2026-11-03).

## Handoff
