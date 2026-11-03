# T-052: The read-only cost collector

- **Lane:** infra
- **Phase:** 10
- **Depends on:** T-051 step 1 (the Anthropic organization check) for the Anthropic adapter only; the rest can be built before any credential exists
- **Paths this task may touch:** `scripts/costs/collect.mjs` (new), `scripts/costs/money.mjs` (new), `scripts/costs/sources/*.mjs` (new, one per source), `tests/costs/collect.test.ts` (new), `tests/costs/fixtures/` (new, synthetic responses only), `config/costs.template.yaml` (new), `config/keys.template` (variable names only), `package.json` (a `costs:collect` script), `docs/costs.md`, `docs/tasks/T-052-cost-collector.md`
- **Human gate:** **yes** for the credentials: Rafa creates them and puts them in `.env`. **No** for the build: tests use synthetic fixtures and no network.
- **Status:** todo
- **Agent/session:** —

## Intent

One command reads what every provider says Crow used and cost, with credentials that can read but not spend where the provider allows it, and writes a dated private file that the report (T-053) and the rules (T-054) read.

- Inputs: each source's usage or billing API, listed in `docs/costs.md` ("Inventory" and "Read-only credentials"); the local Claude Code transcripts; T-031's day lines; the Sepolia lane balances.
- Output: `reports/costs/<YYYY-MM-DD>.json` and a copy at `reports/costs/latest.json`, both git-ignored.
- Non-goals: the report (T-053), rules and alerts (T-054), a schedule (T-055), any write to any provider.

## Context

- `docs/costs.md`: the inventory, the read-only credentials table, where credentials and figures live.
- Hard rules: secrets come from environment variables only, and agents never read `.env`; money is a decimal string, never a float.
- `docs/operations.md` (Telemetry): T-031's day lines and the GraphQL datasets.

## Rafa's steps

Every step is **human**. About 30 minutes (guessed).

1. **Cloudflare** (10 min). At https://dash.cloudflare.com/profile/api-tokens, choose Create Token, then Custom token. Name it `crow-costs-read`. Permissions: Account · Billing · Read, and Account · Account Analytics · Read. Account Resources: Include, your account only. TTL: 90 days. Copy it once.
2. **Anthropic** (5 min). As an organization admin, create an Admin key named `crow-costs-read` at https://platform.claude.com/settings/admin-keys. It has full organization access, because no read-only scope exists (documented), so it stays on your laptop only. Skip this step if your account is not an organization (T-051, step 1); the collector then marks Anthropic as "entered by hand".
3. **GitHub** (5 min). At https://github.com/settings/personal-access-tokens/new, create a fine-grained token named `crow-costs-read` with no repository access and the user permission Plan: Read. Expiry: 90 days.
4. **DeepSeek** (2 min). At https://platform.deepseek.com/api_keys, create a key named `crow-costs-read`. It can spend like any key (inferred); the balance stays the cap.
5. **Put them in `.env`** (5 min), with the names from `config/keys.template`: `CROW_COSTS_CLOUDFLARE_TOKEN`, `CROW_COSTS_ANTHROPIC_ADMIN_KEY`, `CROW_COSTS_GITHUB_TOKEN`, `CROW_COSTS_DEEPSEEK_KEY`. `CLOUDFLARE_ACCOUNT_ID` is already there.
6. **Run it once** (2 min): `node --env-file=.env scripts/costs/collect.mjs`. It prints only which sources it read and which it could not.

## Agent steps

1. **Money** (`money.mjs`). Parse a provider's amount from its JSON text into USD cents as a decimal string, never through a float: Anthropic already reports cents as decimal strings; Cloudflare and GitHub report dollar amounts, so read the raw number token from the response text. Token counts and wei are bigint. Prices are integers in micro-dollars per million tokens, and totals round to whole cents only when shown.
2. **One source module each**, all read-only, each returning lines of `{source, product, unit, quantity, costCents | null, basis: "billed" | "estimated" | "balance", periodFrom, periodTo}`:
   - `cloudflare-billing`: `GET /client/v4/accounts/{id}/billable-usage?from=&to=`, the month to date.
   - `cloudflare-analytics`: GraphQL, per Worker requests and CPU time, and the Durable Object datasets in `docs/operations.md`.
   - `anthropic`: `GET /v1/organizations/cost_report` grouped by workspace and description, and `GET /v1/organizations/usage_report/messages` grouped by workspace, key and model, day buckets.
   - `github`: `GET /users/{username}/settings/billing/usage` for the month. Confirm the path, parameters and token permission against GitHub's reference before coding (a probe on 2026-11-03 answered 503, measured).
   - `deepseek`: `GET /user/balance`.
   - `sepolia`: `eth_getBalance` for each relayer lane and the funding lane on a public RPC; the addresses come from the demo's discovery document, so none is hard-coded.
   - `claude-code`: the local transcripts under `~/.claude/projects/`: per day, session, git branch and model, the sum of input, output, cache-write and cache-read tokens from each response's `usage`. Read only those fields, never message content. Count each response once: a transcript repeats a message across entries that share its `requestId` (inferred; check before trusting the sums).
   - `telemetry`: T-031's `telemetry: "day"` lines. Decide and record how to read them without a new secret in a build session: the Workers Observability query API with the Cloudflare token (to check: endpoint and permission), or a Workers Logs export Rafa saves.
3. **`collect.mjs`** runs every source whose credential is set, with a timeout each. A failing source writes `{source, ok: false, error}` with the error's type and status, never the response body or a header, and the others still run. It writes only under `reports/costs/` and refuses to run if `reports/costs/` is not git-ignored (`git check-ignore`).
4. **`config/costs.template.yaml`**: the accounts list (no values), the budget and threshold keys T-053 and T-054 read, with empty values. Rafa's copy is `reports/costs/budgets.yaml`.
5. **`config/keys.template`**: the four variable names with one comment line each, pointing to `docs/costs.md`.

## Acceptance criteria

- [ ] `pnpm vitest run tests/costs/collect.test.ts` passes with no network: each source parses a synthetic fixture into the expected lines; a failing source leaves the others' lines intact; money never passes through a JavaScript number (a test feeds `0.1` and `1e-7` style amounts and checks the exact cents strings).
- [ ] A test shows no credential value and no response body reaches stdout, stderr or the output file, using a fake token string.
- [ ] A test shows the collector writes nothing outside `reports/costs/`, and refuses when that directory is not git-ignored.
- [ ] The transcript source reads only `usage`, `model`, `sessionId`, `gitBranch`, `timestamp` and `requestId` (a test with a transcript whose message content holds a secret-looking string, which never appears in the output).
- [ ] No fixture holds a real figure: fixtures are synthetic, and the PR says so.
- [ ] Rafa ran it once with his credentials; Evidence records which sources read and which failed, without any amount (measured).

## Out of scope

- The report and unit costs (T-053), rules and CPU limits (T-054), scheduling and alerts (T-055), the OpenAI and exe.dev accounts until they exist.

## Evidence

## Decisions

## Handoff
