# T-437: every task file names its roadmap row, and the ID check enforces it

- **Lane:** infra (the ID check; the console reads it in crow-private)
- **Depends on:** T-405 (the ID check and Work across repos)
- **Paths this task may touch:** `scripts/id-check.mjs`, `tests/id-check.test.ts`, `docs/team.md` (one rule under Change recipes), `docs/tasks/_template.md` (one line), and one header line in each task file from T-402 on (the backfill). Not `.github/`: the pull request template's change is a separate draft pull request, Rafa's word.
- **Human gate:** no for this pull request. Making `id-check` a required check on `main` is a repository setting, Rafa's.
- **Status:** review (2026-11-14)
- **Agent/session:** the coordinator's side session for Work across repos (crow-private T-437), worktree `.worktrees/holdback-T-435`, branch `t-437-task-names-row`
- **Roadmap row:** N108, T-065

## Intent

Crow Control ties work to a roadmap row only when someone edits the row's `publicId` or `alsoIds` by hand, and on 2026-11-14 nobody did for the day's tasks, so 25 merged tickets were tied to no row. Restated: make the chain checkable by script. A pull request names its task (the ID check already enforces it). The task file names its roadmap row, or says `none`, in one header line. Crow Control's build reads that line and ties the row to the work. This task adds the second link to `scripts/id-check.mjs`, with a message that says what to add and where. It backfills the line in every task file from T-402 on and writes the rule once in `docs/team.md`. The console side is crow-private T-437.

The line: `- **Roadmap row:** N70`, several IDs separated by commas (`N109, N119`), a bracketed note allowed after an ID, or `none` (a reason may follow). This repository cannot see the private roadmap, so the check reads the line's shape only.

Non-goals: checking that a row ID exists (the console does, as a build note); the workflow file or the pull request template (tier 3); a required status check (a repository setting).

## Acceptance criteria

- [x] `scripts/id-check.mjs` fails a pull request whose named task's file, from T-402 on, lacks a well-formed `Roadmap row:` line in its header, and says what to add and where. It passes one row, several, or `none`. The first link is unchanged.
- [x] Files below T-402 (filed before 2026-11-13) are exempt by a rule in the script, stated in its header comment.
- [x] Every task file from T-402 on carries the line; a test keeps it so.
- [x] `docs/team.md` states the rule once, under Change recipes; `_template.md` carries the line.
- [x] The first message reads the same in both repositories' checks.

## Evidence

- **Tests** [measured, 2026-11-14]: `npx vitest run tests/id-check.test.ts`: 39 of 39 pass. That is 8 for the rule and 31 for the backfill, one per task file from T-402 on. Before the backfill, the 31 failed and the 8 passed.
- **The backfill** [measured]: 31 files. Rows come from the roadmap's `publicId` and `alsoIds`, its Starts text, and the files' own "roadmap row" mentions. Where none of those named a row, the row is matched by label [inferred], or the file says `none`:
  - **From the roadmap:** T-402, T-424 and T-428 N103; T-409 N80, N92; T-412 B1; T-413 N108; T-415 N117, N115; T-416 N30; T-420 N70; T-421 N109, N119; T-422 N19; T-423 N117; T-431 N128; T-432 N127; T-433 (the mandate tool) N131.
  - **By label** [inferred]: T-406, T-407, T-408, T-417, T-433 (redirect), T-434, T-435 and T-436 to N37 (the seller adapter; the last five are its hosted Worker); T-426 and T-427 (buyer path headroom) to T-252 (the agent guides); T-427 (demo refresh) to N102.
  - **`none`:** T-410, T-411, T-418, T-425, T-430.
- **The workflow** [measured]: `.github/workflows/id-check.yml` runs `node scripts/id-check.mjs` and is unchanged.

## Handoff

- **Open branches** must add the line to their task files before their next push, or the check fails them: holdback pull requests 553 (T-434) and 555 (T-434, the signer's buying half, whose task file is on its own branch).
- **The pull request template** gets a "Task:" and a "Roadmap row:" line in a separate draft pull request, Rafa's word.
- **The required check:** `id-check` is not required on `main`; adding it to the ruleset is Rafa's setting.
