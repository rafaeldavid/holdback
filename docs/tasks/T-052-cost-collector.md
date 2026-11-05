# T-052: The read-only cost collector

- **Lane:** infra
- **Phase:** 9
- **Depends on:** T-051 step 1 (the Anthropic organization check), for the Anthropic source only; T-213 (Sepolia settlement) live, with `SETTLEMENT` set to `sepolia`, for the Sepolia source only. The rest can be built before any credential exists.
- **Paths this task may touch:** `scripts/costs/collect.mjs` (new, the launcher), `scripts/costs/run.mjs` (new), `scripts/costs/money.mjs` (new), `scripts/costs/dir.mjs` (new), `scripts/costs/approved.mjs` (new), `scripts/costs/approve.mjs` (new), `.gitignore` (the line `/.costs-approved`), `scripts/costs/sources/*.mjs` (new, one per source), `tests/costs/collect.test.ts` (new), `tests/costs/fixtures/` (new, synthetic responses only), `config/costs.template.json` (new), `config/keys-costs.template` (new), `docs/costs.md`, `docs/tasks/T-052-cost-collector.md`, and the command lines of T-053, T-054 and T-055 (the launcher pattern; review, 2026-11-03). No `package.json` script: run through pnpm, a `package.json` hook would run outside the approval check (review, 2026-11-03).
- **Human gate:** **yes** for the credentials and the dedicated clone: Rafa creates them. **No** for the build: tests use synthetic fixtures and no network.
- **Status:** done (Rafa's runs on 2026-11-04 are recorded in Evidence: all eight sources read after two credential fixes)
- **Agent/session:** infra cost-monitoring session, branches `t-052-cost-collector` and `t-052-first-run`

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
6. **`.env.costs`, in the dedicated clone only** (5 min). Create it at the clone's root from `config/keys-costs.template`, and keep no other copy. It holds `CROW_COSTS_CLOUDFLARE_TOKEN`, `CROW_COSTS_ANTHROPIC_ADMIN_KEY`, `CROW_COSTS_GITHUB_TOKEN`, `CROW_COSTS_DEEPSEEK_KEY`, `CLOUDFLARE_ACCOUNT_ID`, and two directories as full paths, outside the clone and outside every git checkout (Node does not expand `~`): `CROW_COSTS_DIR` (for example `/Users/<you>/crow-data/costs`, where the T-051 register already is) and `CROW_TELEMETRY_DIR` (for example `/Users/<you>/crow-data/telemetry`). Add each token's expiry to the register.
7. **Approve, then run it once, in the clone** (10 min). Agents may merge to `main` without you, so read `scripts/costs/`, `config/costs.template.json`, `config/model-prices.json` and `.gitattributes` at the clone's commit (later, only what changed since your last approval; `docs/costs.md`, "Running the collector", gives the git command). Run `node scripts/costs/approve.mjs`, which loads no keys and records that commit in `.costs-approved` beside `.env.costs`. Then run `node scripts/costs/collect.mjs`: with `node`, never `pnpm`, and without `--env-file`, because the launcher loads `.env.costs` itself, after the approval check. It prints only which sources it read and which it could not.

## Agent steps

1. **Node built-ins only.** Every file under `scripts/costs/` imports only `node:` modules, so no package from the lockfile runs with the billing keys and the clone needs no `pnpm install`. Config files are JSON for the same reason.
2. **Money** (`money.mjs`). Parse a provider's amount from its JSON text into cents as a decimal string, with its currency, never through a float: Anthropic already reports cents as decimal strings; Cloudflare and GitHub report dollar amounts, so read the raw number token from the response text; DeepSeek reports a balance in CNY or USD, kept in its own currency. Token counts and wei are bigint. Prices are integers in micro-dollars per million tokens, and totals round to whole cents only when shown.
3. **The directories** (`dir.mjs`). `CROW_COSTS_DIR` and `CROW_TELEMETRY_DIR` are required and must be absolute; there is no default. Each one must lie outside the clone, outside every git checkout (a linked worktree, whose files go with it, included) and outside every git directory, since an agent working in a checkout could read the figures (review, 2026-11-03).
4. **The approval check** (`approved.mjs`, `approve.mjs`). Every entry point that loads billing keys (the collector here; the report, the CPU report and the daily routine later) first checks that `scripts/costs/`, `config/costs.template.json`, `.gitattributes` and, once T-053 adds it, `config/model-prices.json` are unchanged since the commit recorded in `.costs-approved` at the clone's root, with no symlink among them, and otherwise refuses, naming the files. An entry point is a launcher that imports only `node:` modules and `approved.mjs`, runs the check, then loads `.env.costs` (`process.loadEnvFile`) and imports the rest, so no changed module runs, not even its top level, and never with a key loaded. `approve.mjs` records the clone's current commit and loads no keys. Both start `git` with an allowlisted environment. `.costs-approved` is git-ignored (`/.costs-approved` in `.gitignore`), and the check refuses if the file is tracked, so a commit cannot supply its own approval.
5. **One source module each**, all read-only, each returning lines of `{source, product, unit, quantity, amount: {cents, currency} | null, basis: "billed" | "estimated" | "balance", periodFrom, periodTo}`:
   - `cloudflare-billing`: `GET /client/v4/accounts/{id}/billable-usage` with no range, which returns the current billing period (Decisions).
   - `cloudflare-analytics`: GraphQL, per Worker requests and CPU time, and the Durable Object datasets in `docs/operations.md`.
   - `anthropic`: `GET /v1/organizations/cost_report` grouped by workspace and description, and `GET /v1/organizations/usage_report/messages` grouped by workspace, key and model, day buckets.
   - `github`: `GET /users/{username}/settings/billing/usage` for the month. Confirm the path, parameters and token permission against GitHub's reference before coding (a probe on 2026-11-03 answered 503, measured).
   - `deepseek`: `GET /user/balance`.
   - `sepolia`: `eth_getBalance` on a public RPC for the funding lane, which discovery names, and the demo adjudicators, which discovery lists, and for the deal lanes and the deployer, whose public addresses come from `sepolia.addresses` in `budgets.json`. No address is hard-coded; if discovery stops naming the funding lane, the source says so in its note. A deal lane that reads under 0.01 Sepolia ETH is read again two minutes later, and both reads are recorded, because the world tops lanes up at most once a minute (T-054's relayer rule needs both).
   - `claude-code`: the local transcripts under `~/.claude/projects/`, including each session's `subagents/` folder, kept when the entry's own `cwd` or its transcript's first `cwd` is in a checkout of this repository (a removed folder judged by its nearest existing parent). Per day, session, git branch and model: input and output tokens, cache writes split by lifetime, cache reads, `speed`, `service_tier` and server tool use counts, from each response's `usage`. Read only those fields, never message content. Count each response once, at the highest value of each field: entries that share a `requestId` repeat its usage, and an early repeat can carry fewer output tokens (measured). Label the source "laptop sessions only", and count unreadable transcripts in its note.
   - `telemetry`: T-031's `telemetry: "day"` lines, written to `CROW_TELEMETRY_DIR` with only the day line's own fields, the export T-042 reads. Decide and record how to read them without a new secret: the Workers Observability query API with the Cloudflare token (to check: endpoint and permission), or a Workers Logs export Rafa saves.
6. **`collect.mjs`**, the launcher, then **`run.mjs`**, which runs every source whose credential is set, with a timeout each. A failing source writes `{source, ok: false, error}` with the error's type, status and at most a code from a fixed list (added after the first run), never the response body or a header, and the others still run. It writes only in the two directories.
7. **`config/costs.template.json`**: the accounts list (no values), the budget and threshold keys T-053 and T-054 read, with empty values. Rafa's copy is `budgets.json` in the cost directory.
8. **`config/keys-costs.template`**: the variable names, one comment line each, pointing to `docs/costs.md`, and the instruction to create `.env.costs` only in the dedicated clone.

## Acceptance criteria

- [x] `pnpm vitest run tests/costs/collect.test.ts` passes with no network: each source parses a synthetic fixture into the expected lines; a failing source leaves the others' lines intact; money never passes through a JavaScript number (a test feeds amounts such as `0.1` and `1e-7` and checks the exact cents strings).
- [x] A test shows every import under `scripts/costs/` is a `node:` module or another file there, with no dynamic, indirect or linked loading.
- [x] A test shows no credential value and no response body reaches stdout, stderr or an output file, using fake token strings, on every error path (http, parse, shape, network, timeout).
- [x] A test shows the collector writes nothing outside the two directories, and refuses a missing or relative directory, one inside the clone, one inside any git checkout or git directory, and one inside a linked worktree.
- [x] A test shows a deal lane under 0.01 is read a second time and both reads are recorded (a fake clock and RPC).
- [x] A test shows the collector refuses before any request when a covered file changed since the approved commit, when an untracked file, a `.gitattributes` or a symlink appears, when `.costs-approved` is missing, and when it is tracked; a test runs the launcher and shows a changed module never runs and the keys load only after the check; and `git check-ignore .costs-approved` prints the path (measured).
- [x] The transcript source reads only `usage`, `model`, `sessionId`, `gitBranch`, `cwd`, `timestamp` and `requestId`, includes `subagents/`, and drops other repositories (a test with a transcript whose message content holds a secret-looking string, which never appears in the output, and one from another `cwd`, which is dropped).
- [x] No fixture holds a real figure: fixtures are synthetic, and the PR says so.
- [x] Rafa ran it once in the dedicated clone; Evidence records which sources read and which failed, without any amount (measured).

## Out of scope

- The report and unit costs (T-053), rules and CPU limits (T-054), scheduling and alerts (T-055), the OpenAI and exe.dev accounts until they exist, an OpenTelemetry source for cloud or VM sessions (later, once T-039 moves sessions off the laptop).

## Evidence

- **Tests (measured, 2026-11-03):** `pnpm vitest run tests/costs/collect.test.ts`, 22 of 22 pass, no network. They cover:
  - each source on a synthetic fixture: Cloudflare billing amounts of 0.1 + 0.2 sum to exactly "30" cents, and 1e-7 dollars becomes "0.00001" cents;
  - Anthropic's pagination and grouping by key;
  - a failing source next to working ones, and a source with no credential;
  - a second read of a low deal lane, with a fake clock, and a note when discovery stops naming the funding lane;
  - transcripts: each response counted once at its highest values, subagents kept, a session followed into a subfolder, a session that starts elsewhere counted only for its entries here, other repositories dropped, message content never read, an unreadable file counted;
  - day lines found in nested and JSON-encoded logs, with only their own fields copied;
  - refusal before any request without an approval, after a change, with an untracked file, a `.gitattributes`, a symlink, or a tracked record;
  - the real launcher run in a temporary clone: a changed module never runs, not even its top level, and `.env.costs` loads only after the check;
  - no credential value or response body in the output or the terminal on the http, parse, shape, network and timeout paths;
  - nothing written outside the two directories (the clone and the telemetry directory are compared before and after);
  - every refused directory case;
  - money refusing numbers, malformed strings and huge exponents;
  - only `.mjs` files that import `node:` modules or each other, with no dynamic or indirect loading.
- **Lint (measured):** `eslint scripts/costs tests/costs` is clean.
- **`pnpm verify` (measured, 2026-11-03, `reports/verify-t-052-cost-collector.md`; tree equal to this branch's third commit except this Evidence text): PASS, no snapshot diffs against HEAD; `pnpm test` ran 2,245 tests in 102 files, all passing (3 skipped).**

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 233 ms |
  | lint | `pnpm lint` | pass | 3208 ms |
  | forge build | `forge build --root contracts` | pass | 829 ms |
  | forge | `forge test --root contracts` | pass | 16369 ms |
  | test | `pnpm test` | pass | 53875 ms |
  | spec | `pnpm validate:spec` | pass | 506 ms |
  | snap | `pnpm snap` | pass | 8169 ms |
  | snap:local | `pnpm snap --settlement=local` | pass | 14970 ms |
  | demo | `pnpm demo` | pass | 3984 ms |

  The first run on this branch failed only `forge build`: its output was the first-time clone of `contracts/lib` submodules into this worktree, and a standalone `forge build` then passed.
- **Smoke run of the keyless sources against real data (measured, 2026-11-03; statuses and counts only, no figure printed or kept):**
  - `sepolia` read 4 balances (the funding lane and three adjudicators, from live discovery and the public RPC) in 0.4 s.
  - `claude-code` read this month's laptop transcripts in 4 s: 21 lines across 5 models, and 174 rows by day, session, branch and model.
  - `node scripts/costs/collect.mjs` in this worktree, which has no approval record, refuses with exit 1.
- **Credentialed sources:** written against the vendors' documented response shapes (read 2026-11-03), and tested only on fixtures shaped like them. Rafa's first run was the first real call.
- **Rafa's runs (measured by Rafa, 2026-11-04, in the dedicated clone at `7a6e42c`, whose cost code equals `main`'s; statuses only, no figure).** `approve.mjs` approved `7a6e42c` for `scripts/costs`, `config/costs.template.json`, `config/model-prices.json` and `.gitattributes`. The code did not change between runs:
  1. **First run, 6 of 8.** Read: `cloudflare-billing`, `github`, `deepseek`, `sepolia`, `claude-code`, `telemetry`. Failed: `cloudflare-analytics: failed (graphql)` and `anthropic: failed (http 403)`. It wrote `latest.json` in `CROW_COSTS_DIR`.
  2. **After adding Account · Account Analytics · Read to the Cloudflare token: the same two failures.** The edit had probably not taken effect yet (inferred).
  3. **After replacing the Anthropic key, which got the 403, with an Admin key: 8 of 8 read.** No re-approval was needed.

  So both failures were credentials, not code: the same approved code read all eight (measured). Which credential caused which failure is inferred from the fixes, since no error code was captured: Cloudflare's GraphQL errors came while the token lacked Account Analytics Read, and Anthropic's 403 came from a key that was not an Admin key.
- **Error codes, added after the runs (measured, 2026-11-04):** `pnpm vitest run tests/costs/collect.test.ts`, 24 of 24 pass; `eslint scripts/costs tests/costs` is clean. The tests show:
  - Five GraphQL error responses shaped like Cloudflare's documented ones each give only a listed word: `permission`, `query:storage`, `time-range:durableObjects`, `rate-limit` (from the `budget` code) and `other:workers`. None gives the message, the account tag or the body.
  - The same body on a 403 gives `http 403 permission`.
  - Each of 16 more of Cloudflare's documented messages maps to its kind. So do two standard GraphQL validation messages and two of Cloudflare's REST authentication messages.
  - Malformed error lists stay within the listed words.
  - An HTTP 403 shaped like Anthropic's gives `permission_error`. A body type that is not listed gives no code: a key, an e-mail-like word, `constructor`.
  - The end-to-end run prints `deepseek: failed (http 401 authentication_error)` and leaks nothing.
  - Neither path has run against a real error yet.
- **`pnpm verify` on branch `t-052-first-run` (measured, 2026-11-04, `reports/verify-t-052-first-run.md`):** PASS, with no snapshot diffs against HEAD. `pnpm test` ran 2,262 tests in 103 files, all passing (3 skipped).

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 249 ms |
  | lint | `pnpm lint` | pass | 3685 ms |
  | forge build | `forge build --root contracts` | pass | 769 ms |
  | forge | `forge test --root contracts` | pass | 15773 ms |
  | test | `pnpm test` | pass | 35091 ms |
  | spec | `pnpm validate:spec` | pass | 550 ms |
  | snap | `pnpm snap` | pass | 8490 ms |
  | snap:local | `pnpm snap --settlement=local` | pass | 14033 ms |
  | demo | `pnpm demo` | pass | 4146 ms |

## Decisions

- One reader of T-031's day lines: this task exports them for both the cost collector and T-042, so the agent-ops phase does not build a second reader (review of this phase's PR, 2026-11-03).
- Billing figures and what the agent-ops phase may read live in separate directories, so pointing T-042 at its directory never exposes a figure.
- **Day lines come from saved exports, not an API.** Cloudflare's telemetry query endpoint accepts only a Workers Observability Write permission (API reference, read 2026-11-03), and a write token is not read-only. So the `telemetry` source reads Workers Logs that Rafa saves into `CROW_TELEMETRY_DIR/inbox/`, in any JSON or JSON-lines shape. If Cloudflare adds a read permission, switch to the API.
- **Addresses come from `budgets.json`, not the register.** The register is prose Rafa writes. The deal lanes and the deployer go in `sepolia.addresses` in `budgets.json` (template: `config/costs.template.json`). The funding lane (from discovery's notes) and the adjudicators (`demo.adjudicators`) need no configuration.
- **Quantities and cents can be fractional.** Cloudflare bills GB-months and reports CPU-time quantiles as fractions, so `quantity` is a decimal string, an integer for every other source; Anthropic reports cents with fractions ("123.78912"). Money stays exact: Node 22's JSON reviver gives each number's source text (`parseJsonExact`), arithmetic runs on bigint, and a JavaScript number, a malformed string or an exponent beyond ±100 is refused. A source's status may carry a `note`. The control page's reader accepts all three (coordinating session, 2026-11-03).
- **A launcher, not `--env-file`** (review, 2026-11-03). `--env-file` loads the keys before any code, and static imports run every module's top level before a check. So `collect.mjs` imports only `node:` modules and `approved.mjs`, runs the check, then calls `process.loadEnvFile('.env.costs')` and imports `run.mjs`. The same pattern is written into T-053, T-054 and T-055. There is no `pnpm` script: a `package.json` hook would run before the launcher.
- **Directories outside every checkout** (review, 2026-11-03). A git-ignored folder in a checkout where agents work is still readable by them, so `dir.mjs` refuses any path inside a git work tree or git directory, not only one that is not ignored.
- **The approval covers `.gitattributes` and refuses symlinks**, because the first can hide a change from `git diff` and the second can point at a file the approval does not cover.
- **`cloudflare-billing` sends no date range.** The API returns the current billing period when none is given (API reference, read 2026-11-03), and a range must include the billing anchor day, which the collector does not know.
- **`anthropic`** groups tokens by workspace, model and key (T-054 needs keys), and sends no `ending_at`, which is optional.
- **An entry counts when its own working directory or its transcript's first one is in this repository**, and a removed folder is judged by its nearest existing parent. The review measured November: the per-entry test alone kept 12,999 requests, the first-directory test alone 11,337, and either test 13,017. A repeated response counts at its highest value of each field.
- **Day lines are copied field by field**, only T-031's own top-level fields, so a log record that wraps one with request headers leaks nothing into `CROW_TELEMETRY_DIR`.
- **Usage lines carry no amount yet.** Tokens and requests have `basis: "estimated"` and `amount: null` until T-053's price table prices them.
- **Anthropic** uses the legacy `cost_report` and `usage_report/messages` endpoints, which Anthropic still supports; the newer analytics endpoints were not read.
- **An error carries one short word, `code`** (first run, 2026-11-04). After the first run, `graphql` alone could not tell a token without Account Analytics Read from a query Cloudflare's schema rejects, and `http 403` could not tell a permission error from other refusals. A failed source's `error` now has an optional `code` (`docs/costs.md`):
  - for Cloudflare's GraphQL errors, on any status: the first error's kind, taken from the messages on Cloudflare's errors page, plus the dataset its path names;
  - for `http`: the body's `error.type`.

  Every code is a word from a fixed list in the code: Anthropic's documented error types, and the GraphQL kinds and datasets. A provider's word that is not listed is dropped (review, 2026-11-04: a pattern such as "any short lowercase word" let an e-mail-like word through). The message and the body never reach the output, since they can name the account or echo a request.
- **The query stays as it was.** Its `string` variables follow Cloudflare's Workers tutorial, and the third run read with them (measured).
- **The approval check has a limit.** Code in the repository cannot check a change to itself (the launcher or `approved.mjs`), so the defense is the update procedure in `docs/costs.md` ("Running the collector"): fetch, read the diff with git, fast-forward, approve. T-055's routine compares before it fast-forwards. A reviewer from another model family is recommended for this design (review, 2026-11-03) and has not been run.

## Handoff

**Built** (branch `t-052-cost-collector`):
- `scripts/costs/collect.mjs` (the launcher), `run.mjs`, `approve.mjs`, `approved.mjs`, `dir.mjs`, `money.mjs`;
- eight sources and an HTTP helper in `scripts/costs/sources/`;
- `config/costs.template.json` and `config/keys-costs.template`;
- `/.costs-approved` in `.gitignore`;
- the tests and fixtures;
- "Running the collector" in `docs/costs.md`, and the launcher pattern in T-053, T-054 and T-055's commands.

**For another lane:** `docs/team.md`'s Rules and checks table should gain two rows: "cost scripts import only `node:` modules" (checked by `tests/costs/collect.test.ts`) and "cost scripts run only approved code" (checked by `approved.mjs` and its tests). `docs/team.md` is outside this task's paths.

**Rafa's steps, in order** (each human; details above):
1. Clone the repository somewhere no agent works and outside `~/Documents`: `git clone https://github.com/rafaeldavid/holdback /Users/<you>/crow-costs`.
2. Create the read-only tokens. All are optional: a source without one reports "not configured".
   - Cloudflare `crow-costs-read`: Billing Read and Account Analytics Read.
   - Anthropic Admin key `crow-costs-read`: organization accounts only.
   - GitHub fine-grained `crow-costs-read`: Plan read, no repositories.
   - DeepSeek `crow-costs-read`.
3. In the clone, `cp config/keys-costs.template .env.costs`, fill in the tokens, `CLOUDFLARE_ACCOUNT_ID`, and two full paths outside every git checkout: `CROW_COSTS_DIR` and `CROW_TELEMETRY_DIR`. Keep no other copy.
4. Optional: copy `config/costs.template.json` to `CROW_COSTS_DIR/budgets.json` and add the deal lanes' and deployer's public addresses.
5. Read `scripts/costs/`, the config and `.gitattributes`, then run `node scripts/costs/approve.mjs` (it loads no keys).
6. Run `node scripts/costs/collect.mjs`: with `node`, never `pnpm`, and without `--env-file`. Tell the agent which sources read and which failed, with no figure. Then the agent records it in Evidence and flips Status to done.

**If a source fails again** (Rafa, human): update the clone as `docs/costs.md` describes ("Updating the clone"), so the status line names the error, for example `failed (http 403 permission_error)` or `failed (graphql permission)`. Report that line; it holds no figure. From the first run:
- An Anthropic 403 most likely means the key is not an Admin key (`sk-ant-admin01-…`, created at `platform.claude.com/settings/admin-keys`; inferred from the third run).
- A Cloudflare failure while billing still reads: the code says which kind it is. `permission` points to the token's Account Analytics Read, or to an edit that has not taken effect yet.

**Open:** T-053 prices the token lines; T-054 adds `--cpu-report`; T-055 schedules the run and sends alerts.
