# T-234: the demo deploy checks itself and rolls back on its own

- **Lane:** infra
- **Phase:** 2, settlement on EVM (in focus under D53: stable EVM operations)
- **Depends on:** T-231's deploy record (PR 234), whose hand checklist this replaces. Rafa approved it on 2026-11-06: "Yes, do both". On 2026-11-07 he asked to cut it to the core: "simplify and stop getting into testing loops".
- **Paths this task may touch:** `apps/demo-cloud/scripts/deploy.mjs`, `docs/operations.md` (the Deploy runbook), this file
- **Human gate:** yes for any real run. A deploy, a rollback and a smoke deal reach outside the repository and wait for Rafa.
- **Status:** done ([PR 243](https://github.com/rafaeldavid/holdback/pull/243), merged 2026-11-07 at 06:15 UTC; its first real run is the next operator deploy)
- **Agent/session:** T-234 implementer session, 2026-11-06 and 2026-11-07, worktree `.worktrees/t234-deploy-check`, branch `t-234-deploy-check`

## Intent

T-231's deploy took about 35 min, because an agent ran a hand checklist after `pnpm demo-cloud:deploy`. Now the script does the checks itself:
1. build;
2. read each Worker's live version, which is its rollback target;
3. deploy holdback-op1, then holdback-op2, and stop with exit 1 when an upload is refused;
4. wait until `/v1/status` answers 200 on both nodes;
5. run one `examples/try.ts` deal against both operators, which must end Released within 180 s;
6. when a step after an upload fails, roll back each Worker that changed, and exit 1;
7. print one Markdown record line: the date, the commit, the versions, the rollback targets, the smoke deal's ID and time, and pass or fail.

**Non-goals.** A start-up budget, deal-by-deal comparisons, a site deploy, a dry run, JSON evidence and unit tests. Rafa dropped them on 2026-11-07. Also out: log watching and checks for one feature, which belong in round 1's driver (`examples/e2e-round.ts`).

## Acceptance criteria

- [x] `pnpm demo-cloud:deploy` runs the seven steps above.
- [x] `docs/operations.md` says: run the script, paste its line, and here are the rollback commands.
- [ ] The first real run passes. It is not run here; it waits for Rafa.

## Evidence

- `node --check apps/demo-cloud/scripts/deploy.mjs` and `pnpm lint` pass (measured).
- `node apps/demo-cloud/scripts/deploy.mjs --dry-run` exits 2 with "Refused: pnpm demo-cloud:deploy takes no arguments", before any step (measured). An old habit of passing a flag therefore never deploys.
- Read-only checks of the parts the script uses, from the first cut of this task on 2026-11-06 (measured):
  - `npx wrangler@4 deployments status --name holdback-op1 --json` returns `{versions: [{version_id, percentage: 100}]}`. The script reads the rollback target from it: holdback-op1 `066f1b18-24c6-4f0f-ad45-de2c27a6823f` that day.
  - wrangler 4.85.0 prints `Current Version ID: <uuid>` after a deploy (read from its source, `wrangler-dist/cli.js`).
  - `examples/try.ts` ends with `done      commitment <id> Released` (T-231's smoke output).
- Not run: the deploy, the wait, the smoke deal and the rollback. They wait for Rafa.
- `pnpm verify` on this change over main at `bcc9a2c`, 2026-11-07 06:06 UTC: PASS, no snapshot diff (measured):

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 4071 ms |
  | lint | `pnpm lint` | pass | 4619 ms |
  | forge build | `forge build --root contracts` | pass | 888 ms |
  | forge | `forge test --root contracts` | pass | 20625 ms |
  | test | `pnpm test` | pass | 429572 ms |
  | spec | `pnpm validate:spec` | pass | 650 ms |
  | snap | `pnpm snap` | pass | 9534 ms |
  | snap:local | `pnpm snap --settlement=local` | pass | 15523 ms |
  | demo | `pnpm demo` | pass | 4259 ms |

## Decisions

- 2026-11-07: **the script refuses any argument.** The first cut had `--dry-run`. A flag the trimmed script ignored would deploy for real.
- 2026-11-07: **the rollback reads each Worker's live version first,** and rolls back only one that changed. So a refused holdback-op1 upload rolls back nothing, and a refused holdback-op2 upload rolls back holdback-op1.

## Handoff

- **State:** review. Not run for real.
- **The first real run:** `pnpm demo-cloud:deploy` from main, on Rafa's go-ahead. Paste its line into `docs/operations.md`.
- **One limit:** `/v1/status` names no build, so the old version can answer the 200 for up to about 75 s after the upload (T-231 measured the switch from `wrangler tail`; inferred here). The smoke deal, about a minute long, then runs mostly on the new code. If that proves too weak, a build marker in discovery (draft PR 216) would let the wait check the version.
