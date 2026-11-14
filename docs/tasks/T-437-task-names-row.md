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

- **Tests** [measured, 2026-11-14]: `npx vitest run tests/id-check.test.ts`: 42 of 42 pass. That is 9 for the rule and 33 for the backfill: one test that files exist, and one per task file from T-402 on (this file included). Before the backfill, the 31 older files' tests failed and the rule's passed.
- **The rule's cases** [measured, the tests]: one row, several, or `none` pass. These fail with what to add and where: a missing line, a malformed one, a line below `## Intent`, and two lines in one header ("keep one": a merge can leave both). When two files share a number, each is checked. Closed HTML comments in the body are ignored, and an unclosed `<!--`, often code in backticks, stays as text. A PR that names no task fails with the message both repositories share.
- **The backfill** [measured]: 31 files, each line after the file's Agent/session line, where today's open branches put it. Rows come from the roadmap's `publicId` and `alsoIds`, its Starts text, and the files' own "roadmap row" mentions. Where none of those named a row, the row is matched by label [inferred], or the file says `none`:
  - **From the roadmap or the file:** T-402, T-424 and T-428 N103; T-409 N80, N92; T-412 B1; T-413 N108; T-415 N117, N115; T-416 N30; T-420 N70; T-421 N109, N119; T-422 N19; T-423 N117; T-431 N128; T-432 N127; T-433 (the mandate tool) N131, from its own Lane line.
  - **N134, the hosted seller adapter** (a row the coordinator added on 2026-11-14): T-433 (redirect), T-434 (core split) and T-435 (the Worker) [measured: their open branches name it]; T-407 and T-436 [inferred from their titles].
  - **By label** [inferred]: T-406, T-408 and T-417 to N37 (the seller adapter); T-426 and T-427 (buyer path headroom) to T-252 (the agent guides); T-427 (demo refresh) to N102.
  - **`none`:** T-410, T-411, T-418, T-425, T-430.
- **The open branches, merged onto this one** [measured, `git merge-tree`, 2026-11-14]:
  - PRs 555 (T-434, the signer's buying half) and 558 (T-435, Crow's buying agent) merge cleanly. Each adds a task file with no `Roadmap row:` line, so the check fails them until they add one; both files say "roadmap row N131" in their Lane line.
  - PRs 553, 556 and 557 (the hosted seller adapter) conflict on one header line in T-434's, T-435's and T-436's files. Their branches edit the Status and Agent/session lines beside the inserted `- **Roadmap row:** N134`. The resolution: keep the branch's Status and Agent/session lines and one `- **Roadmap row:** N134`.
- **The workflow** [measured]: `.github/workflows/id-check.yml` runs `node scripts/id-check.mjs` and is unchanged.
- **Review** (one `reviewer` pass): ISSUES. Fixed:
  - The backfill named N37 where the open branches name N134 (Medium). The line now sits where they put it, and the check fails a header with two lines.
  - This Handoff named the wrong pull requests (Medium).
  - Stale Evidence; an unclosed `<!--` dropped the rest of the body; the backfill test repeated a regular expression instead of importing `ROW_LINE` (all Low).

## Handoff

- **Before the next push,** the sessions behind PRs 555 and 558 add `- **Roadmap row:** N131` to their task files, and the sessions behind PRs 553, 556 and 557 resolve the one-line conflict above.
- **The pull request template** gets a "Task:" and a "Roadmap row:" line in a separate draft pull request, Rafa's word.
- **The required check:** `main`'s ruleset requires `check` and `gitleaks`, not `id-check`. Adding `id-check` to its required status checks is Rafa's setting.
