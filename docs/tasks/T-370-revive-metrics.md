# T-370: bring the One-Click harness (PR 217) and the discovery fields (PR 216) up to date, review and merge them

- **Lane:** infra
- **Phase:** 2
- **Depends on:** T-066 (its slices 1 and 3), T-328 (`tools/one-click/outsider.mjs`, which landed beside the harness)
- **Paths this task may touch:** the files PR 217 adds (`tools/one-click/run.mjs`, `metrics.mjs`, `README.md`, and the new `scripted.mjs`; `tests/metrics/one-click.test.ts` and its fixtures), the files PR 216 changes (`apps/demo-cloud/scripts/deploy.mjs`, `apps/demo-cloud/src/judges.ts`, `world.ts`, `world.test.ts`, `docs/api.md`, `site/build.mjs`), and this file. Anything else goes to Handoff and to the coordinator.
- **Human gate:** no for the merges. Yes for what follows them: a live harness run (it spends model tokens and approves tools as Rafa) and the operator and site deploys that make PR 216's fields live.
- **Status:** in progress
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
- [ ] PR 217: CI passes; merged.
- [ ] PR 216: conflicts resolved, the OpenAPI contract widened with a version bump, review, CI, merged.

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

## Decisions

1. **The scripted dry run replaces the SDK, not the runner.** `scripted.mjs` returns a `query()` that plays a script through the same `canUseTool`, hooks and message loop `run.mjs` uses with the SDK, so CI exercises the harness's own bookkeeping, not a copy of it. The SDK is imported only when there is no `--dry-run`, so CI still never installs it.
2. **Mac login only, for now** (finding 9). The environment filter keeps dropping `ANTHROPIC_API_KEY`; a CI run with a capped key is T-068's change, made on purpose there, not a flag added here.
3. **The denied paths follow `outsider.mjs`.** The same patterns (the user's documents, library, keys, `.env` files, the keychain) are denied rather than approved, so both harnesses give the assistant the same reach. They live in `metrics.mjs` (`deniedRequest`) so a test covers them; `outsider.mjs` keeps its own copy (T-328's file, outside this task's paths).
5. **The sandbox is the default, not an option** (review High 1). The review measured that a filtered environment and a deny list leave HOME's logins in reach of an auto-approved assistant. `outsider.mjs` had measured the sandbox working in its run s1, so the harness uses the same settings by default; `--unsandboxed` stays for a separate user or a throwaway virtual machine.
6. **Quoted strings leave the run file** (review Medium 2). A summary keeps the command's words and URLs, which say what the assistant did; quoted text is where a header, a body or the assistant's own words hide.
4. **A tail counts only once it connected** (finding 2). It counts as connected when wrangler prints its connect line or the first event arrives, and as failed when its process exits before the run ends. The connect line's wording is guessed from wrangler's usual output; the first `--tail` run confirms it.

## Handoff

- **Done:** PR 217 is current and its findings are fixed (Evidence). Review, CI and the merge follow.
- **Next:** PR 216.
