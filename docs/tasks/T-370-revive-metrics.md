# T-370: bring the One-Click harness (PR 217) and the discovery fields (PR 216) up to date, review and merge them

- **Lane:** infra
- **Phase:** 2
- **Depends on:** T-066 (its slices 1 and 3), T-328 (`tools/one-click/outsider.mjs`, which landed beside the harness)
- **Paths this task may touch:** the files PR 217 adds (`tools/one-click/run.mjs`, `metrics.mjs`, `README.md`, and the new `scripted.mjs`; `tests/metrics/one-click.test.ts` and its fixtures), the files PR 216 changes (`apps/demo-cloud/scripts/deploy.mjs`, `apps/demo-cloud/src/judges.ts`, `world.ts`, `world.test.ts`, `docs/api.md`, `site/build.mjs`), and this file. Anything else goes to Handoff and to the coordinator.
- **Human gate:** no for the merges. Yes for what follows them: a live harness run (it spends model tokens and approves tools as Rafa) and the operator and site deploys that make PR 216's fields live.
- **Status:** done once PR 216 merges (PR 217 merged as e1e8df2)
- **Agent/session:** T-370 implementer, a Claude Code side session of the coordinator, 2026-11-12. Change kind 4 (tooling). Worktrees `.worktrees/t-370-one-click` and `.worktrees/t-370-discovery`.

## Intent

Two T-066 slices sat in draft since 2026-11-06, when D53 moved everything outside stable EVM operations to a later phase. Rafa lifted that pause for these two on 2026-11-12 ("Merge the work if it's ready across the board").

- **PR 217, the One-Click harness.** `tools/one-click/run.mjs` drives a fresh Claude Code through the Agent SDK from the homepage prompt to a settled deal, and writes one run file (`crow.metrics.one-click/1`) with the approvals, tokens, cost at Opus 5.5 list prices, time split and outcome. Crow Control reads that file for headline metrics 1 to 3. It was paused with 11 review findings unfixed (T-066 Handoff): an SSH agent socket leaking to the assistant, approval summaries that kept header values, IP addresses and the assistant's own text, Cloudflare counts that read 0 when a tail never connected, and smaller ones.
- **PR 216, the discovery fields.** Discovery's `demo` object gains the build commit, the relayer lanes, the faucet's mints per day and the judges' tokens by pinned model, so the metrics scripts read them without a Cloudflare token. It was paused with 7 findings, one High: the published OpenAPI contract closes `Discovery.demo`, so the new fields would make both nodes serve a discovery document their own contract calls invalid.

**"Ready" today means:**
- PR 217: current with `main`; every review finding fixed; it points the assistant at today's site (`https://crow.direct/`, not the old host, whose redirect the capped fetch does not follow); the assistant gets no key, socket or tool an outside agent would not have; the run file holds no secret or personal data; and CI runs the harness end to end with no model key (a scripted dry run), so the runner and the run file's shape are proven on every push.
- PR 216: current with `main`, conflicts resolved by reading both sides; only fields `main` does not already provide; each field a read-only public fact; the OpenAPI contract accepts them; `docs/api.md` and the site check agree; tests pass.

Non-goals: a live harness run, a deploy, a change to `site/llms.txt` or `site/sell.txt` by hand, or to `outsider.mjs`.

## Context

- `docs/tasks/T-066-control-from-sources.md`: Data format (the run file), Scope A slices 1 and 3, Handoff (both PRs' review findings).
- `scripts/metrics/schemas/one-click.schema.json` and `scripts/metrics/check.mjs`: the run file's shape, which `ops-cost.mjs` and the console check before reading.
- `docs/team.md`, Change recipes, kind 4; `docs/writing.md`, Numbers that drift.

## Acceptance criteria

- [x] PR 217 merges `origin/main` with no rewrite of its history.
- [x] PR 217's 11 findings are fixed, each with a test where it is testable.
- [x] `node tools/one-click/run.mjs --dry-run tests/metrics/fixtures/one-click-script.json` writes a run file that passes the one-click schema, with no SDK installed and no network; `tests/metrics/one-click.test.ts` runs it.
- [x] `pnpm typecheck`, `pnpm lint` and `pnpm test` pass on PR 217's branch.
- [x] One review of PR 217; its High and Medium findings fixed.
- [x] PR 217: CI passes; merged as e1e8df2 (2026-11-12).
- [x] PR 216: conflicts resolved, the OpenAPI contract widened with a version bump, one review.
- [ ] PR 216: CI passes; merged.

## Out of scope

- The live harness run, and where it runs (T-066 Gates item 1, Rafa's).
- A CI job that runs the harness with a capped key (T-068, planned privately).
- The operator and site deploys that make PR 216 live (T-066 Gates item 6, Rafa's).

## Evidence

- **PR 217, fixes** (measured on `t-066-one-click` after merging `origin/main` at 697218c):
  - `node tools/one-click/run.mjs --dry-run tests/metrics/fixtures/one-click-script.json --out <scratch>`: "Released: 5 approvals, effort medium, USD 182499 micro at Opus 5.5", run file valid. The file's summaries read `curl -sS -H <value> "https://api.crow.direct/v1/discovery" http://<ip>/x` for a request that carried an `Authorization` header, a query token and an IP address; the denied `Read` of a key file shows only in `errors`.
  - `pnpm vitest run tests/metrics/one-click.test.ts`: 29 of 29 pass.
  - `pnpm typecheck` and `pnpm lint`: pass. `pnpm test`: 156 files pass, 12 skipped.
- **PR 217, review** (one `reviewer` pass at d977f8a, briefed with CLAUDE.md and T-066, not this file's conclusions): ISSUES, 1 High, 4 Medium, 3 Low. It confirmed earlier findings 2, 3, 4, 6, 8, 9, 10 and 11 fixed, and 1, 5 and 7 partly fixed (measured with its own hostile-input probe).
  - High 1: the assistant could still reach the user's logins (`gh auth token`, `cat ~/.netrc`, `npx wrangler whoami`, `git push`, files under HOME by a relative path), because HOME and the auto-approval stay. Fixed: Claude Code's OS sandbox is on by default (ported from `outsider.mjs --sandbox`, with login dotfiles and `Library/Preferences` added to the read denials and the old host dropped from the network allowlist), the assistant gets its own TMPDIR and npm cache, and the denial list covers each command the review named. `--unsandboxed` opts out.
  - Medium 2: `scrub` let credentials through in hostile forms (a joined `-H'…'`, httpie headers, `-d` bodies, `KEY=VALUE`, `--private-key 0x…`, emails, upper-case or `~/` paths, bare IPv6, `ssh://user:pw@`, `--proxy-user`, `--password=`, `-E cert:`). Fixed: quoted strings, credential, header and body option values, `KEY=VALUE`, `name:value`, 32-byte hex, emails, paths in any case and IPv6 are replaced; a test runs each of the review's cases.
  - Medium 3: `--model 'claude-opus-5-5[1m]'` passed the start check and wrote only an invalid file. Fixed: the start check uses the schema's `model.requested` pattern.
  - Medium 4: a homepage without the deal prompt still drove an assistant. Fixed: the harness stops.
  - Medium 5: a tail that connected after the prompt counted as complete. Fixed: each tail records its connect time, and one that connected after the prompt is left out with a gap line.
  - Lows: a dry run now writes to `reports/scratch/one-click-dry` unless `--out` names a folder (6). Left for Handoff: a background `try.mjs` may end in a timeout (7), and a dry run's time split reads a negative `otherMs` because the script's model time exceeds its wall time (8).
  - After the fixes (measured): `pnpm vitest run tests/metrics`: 107 of 107 pass; `pnpm typecheck` and `pnpm lint` pass.
- **PR 216, current** (measured on `t-066-discovery-fields`): `origin/main` merged at 3de5c45 and again at 61810e8. The conflicts in `deploy.mjs`, `world.ts`, `world.test.ts` and `site/build.mjs` were resolved by reading both sides (Decisions 8 and 9). One read of live discovery (`curl -s https://api.crow.direct/`, 2026-11-12) showed none of the four fields, so all four stay.
  - `pnpm vitest run apps/demo-cloud tests/contract`: 103 passed, 9 skipped. `world.test.ts` adds a test that checks both worlds' discovery against the Discovery schema, and a UTC day-rollover test for `byModel`.
  - `pnpm -s validate:spec`: 35 of 35 examples valid; `spec/openapi.json` fresh. `pnpm typecheck` and `pnpm lint` pass. `node site/build.mjs && node site/check.mjs` passes and leaves no diff.
- **PR 216, review** (one `reviewer` pass at 3de5c45): ISSUES, 1 Medium and 4 Low, none blocking. It measured the disclosure check (every new field is a public address, count or 40-hex commit), the contract test, wrangler's `--var` merging with the config's vars, and a merge that keeps main's rewrites. Fixed after it: the PR body and this file (Medium 1), the hand-written `info.version` in `docs/api.md` (Low 2, now a pointer to `spec/openapi/paths.json`), a `commitOf` unit test in `tests/site-deploy.test.ts` (Low 3), and a fresh merge of main (Low 4). Low 5 (a one-Worker cutover shows op1's commit on both nodes) stays documented (Decision 8).

## Decisions

1. **The scripted dry run replaces the SDK, not the runner.** `scripted.mjs` returns a `query()` that plays a script through the same `canUseTool`, hooks and message loop `run.mjs` uses with the SDK, so CI exercises the harness's own bookkeeping, not a copy of it. The SDK is imported only when there is no `--dry-run`, so CI still never installs it.
2. **Mac login only, for now** (finding 9). The environment filter keeps dropping `ANTHROPIC_API_KEY`; a CI run with a capped key is T-068's change, made on purpose there, not a flag added here.
3. **The denied paths follow `outsider.mjs`.** The same patterns (the user's documents, library, keys, `.env` files, the keychain) are denied rather than approved, so both harnesses give the assistant the same reach. They live in `metrics.mjs` (`deniedRequest`) so a test covers them; `outsider.mjs` keeps its own copy (T-328's file, outside this task's paths).
4. **A tail counts only once it connected** (finding 2). It counts as connected when wrangler prints its connect line or the first event arrives, and as failed when its process exits before the run ends. The connect line's wording is guessed from wrangler's usual output; the first `--tail` run confirms it.
5. **The sandbox is the default, not an option** (review High 1). The review measured that a filtered environment and a deny list leave HOME's logins in reach of an auto-approved assistant. `outsider.mjs` had measured the sandbox working in its run s1, so the harness uses the same settings by default; `--unsandboxed` stays for a separate user or a throwaway virtual machine.
6. **Quoted strings leave the run file** (review Medium 2). A summary keeps the command's words and URLs, which say what the assistant did; quoted text is where a header, a body or the assistant's own words hide.
7. **PR 216 widens `spec/openapi/paths.json`, not `spec/schemas/`.** The 2026-11-06 review's High finding showed the closed `Discovery.demo` would refuse the new fields. The three properties and `info.version` 0.2 to 0.3 follow commit 320bd75's precedent for the faucet fields; `spec/schemas/`, the contract the ADR rule covers, is untouched. This is outside the paths the brief listed, and the coordinator is told.
8. **`demo.build.commit` names holdback-op1's deploy.** The World Durable Object runs in holdback-op1, so both nodes show its commit (finding 2). The deploy script rolls both Workers back when a step fails, so the two run the same commit after a normal deploy; a one-Worker cutover is the case the field cannot show, and its description says so.
9. **The deploy takes the commit from main's pre-flight.** `pnpm demo-cloud:deploy` already refuses a changed tree (`scripts/deploy-lib.mjs`), so the PR's own clean-tree check in `deploy.mjs` was dropped and only `--var BUILD_COMMIT:<commit>` was added.

## Handoff

- **Done:** PR 217 merged as e1e8df2 (rafaeldavid/holdback#217). PR 216 is current with main, its seven earlier findings are fixed, and its review found nothing blocking; CI and the merge follow (Evidence).
- **The live harness run (Rafa's; not run).** It signs in with this Mac's Claude Code login. No environment variable holds a key, and `ANTHROPIC_API_KEY` is dropped from the assistant's environment on purpose (Decision 2).
  ```
  pnpm install
  npm ci --ignore-scripts --prefix tools/one-click
  node tools/one-click/run.mjs --scenario buyer --effort medium --out reports/scratch/one-click
  node scripts/metrics/check.mjs one-click reports/scratch/one-click/<runId>.json
  ```
  Add `--tail` for the Cloudflare counts (wrangler's login). The run file lands in `reports/scratch/one-click/<runId>.json`; copy it to the private repository's `control/metrics/one-click/` for the console (T-066, Gates item 3). Cost, from the two runs of 2026-11-05 at medium effort (measured then, `tests/metrics/one-click.test.ts`): about 141,000 Opus 5.5 tokens and 1,200 Haiku tokens, USD 0.18 to 0.20 at list price (182,499 and 199,449 micro-USD at Opus 5.5 rates). The code caps a run at 600 s (`--timeout-ms`) and 6 chat replies (`--max-replies`), with no token cap. The run also spends Sepolia test gas and one faucet mint. The first run should confirm three guesses: the sandbox lets `try.mjs` reach Sepolia and the operators (inferred from `outsider.mjs`'s run s1), wrangler's connect line matches `CONNECTED` in `run.mjs` (guessed), and the run reproduces T-229's 1 approval.
- **PR 216's deploy (Rafa's).** The fields are live only after both deploys:
  ```
  pnpm demo-cloud:deploy
  pnpm site:deploy
  ```
  Smoke check: `curl -s https://api.crow.direct/ | jq '.demo | {build, relayer, mintsPerDay: .faucet.mintsPerDay, byModel: .judges.tokensToday.byModel}'`, and the same on `https://api2.crow.direct/`. Both should show `build.commit` equal to the deployed commit (40 hex characters, the same on both nodes), `relayer` with one funding lane and three deal lanes, `mintsPerDay` 600, and `byModel` an object (empty until a live judge call today). `curl -s https://crow.direct/version.json` should show the site's commit. Then `scripts/metrics/crow-accounts.json` can give way to `demo.relayer` (T-066 Handoff).
- **Left open (Low, not blocking):**
  - PR 217 review, Low 7: when `try.mjs` runs in the background, the loop may wait for a message the SDK never sends and end at the timeout (inferred).
  - PR 217 review, Low 8: a dry run's `otherMs` reads negative, because the script's `duration_api_ms` exceeds the dry run's wall time (measured). No test checks the dry run's time split.
  - `outsider.mjs` keeps its own, narrower deny list; porting `deniedRequest` and the login dotfiles to it is T-328's file.
- **For the coordinator:** `docs/tasks/T-066-control-from-sources.md` still calls both PRs deferred and their findings unfixed; this task edits only its own file. The `.gitleaksignore` fingerprint for commit d977f8a and the `spec/openapi/` change sit outside the brief's paths (Decision 7).
