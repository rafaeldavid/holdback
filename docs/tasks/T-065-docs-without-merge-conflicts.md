# T-065: Docs without merge conflicts

- **Lane:** infra, docs
- **Phase:** 9
- **Depends on:** nothing; it can start any time. Land the move itself when few PRs are open (Context, "The move itself").
- **Paths this task may touch:**
  - `docs/tasks/T-065-docs-without-merge-conflicts.md`, and `docs/research/<date>-docs-merge-conflicts.md` (new);
  - the shared docs and any folders they move into: `docs/plan.md`, `docs/backlog.md`, `docs/decisions-today.md`, `docs/operations.md`, `docs/team.md`, `docs/update-flow.md`;
  - their readers: `scripts/design-map.mjs`, `tools/design-map/`, `tests/design-map.test.ts`, and a new check script under `scripts/` if the layout needs one;
  - `.gitattributes` (new, for option 3);
  - tier 3, merged by Rafa: `.github/workflows/` (for option 2), `.claude/agents/`, `.claude/commands/` and `CLAUDE.md` (where an agent writes what);
  - in the founders' private repository: `control/console.mjs` and its tests, if the layout moves what the console reads.
- **Human gate:** yes, for three things only. Rafa merges any change to `.github/`, `.claude/` or `CLAUDE.md`, which are tier 3 control files (`agent-ops/gates.md`). A console change goes live with a crow-console deploy on his go-ahead. He can overrule the decision in `docs/decisions-today.md`. The research and the docs move need no gate.
- **Status:** todo
- **Agent/session:** —

## Intent

Rafa, 2026-11-05: "It seems there's a common pattern where conflicts emerge in .md files,,, it feels like you need a diff architecture to the docs, or treat them as a sperate update so they update after each PR / commit or whatnot. Add this to ticket to, as this is part of development speed up Infrastructure management and development"

Rafa, 2026-11-07, adopting the Change Lifecycles page's moves ("Yes, adopt them"): generate plan status and the log from task fields and merged PRs, so each change edits only its own task file. That picks options 1 and 2 below. Until this task lands, the coordinator updates `docs/plan.md` and the day's log once a day, in one docs commit (`docs/team.md`, Change recipes).

Restated: agents working in parallel keep editing the same few Markdown files, mostly the plan, the backlog and the decisions list. When two PRs touch the same or neighbouring lines, the second one conflicts. Each conflict costs a local merge, another CI run of about 9 min, and sometimes a landing that waits for a person. The shared docs need a layout where two PRs rarely edit the same lines, or the shared indexes need to change after a merge instead of inside each PR. This task speeds up development.

## Context

**How often the shared docs change** (measured at `origin/main` eeeb5f0, 2026-11-05 10:46 UTC). Since 2026-11-01, 205 changes landed on main (`git log --first-parent --since=2026-11-01 origin/main`). The share of them that touched each file:

| File | Landed changes (first parent) | All commits, branch commits included |
| --- | --- | --- |
| `docs/plan.md` | 68 of 205 (33%) | 112 |
| `docs/backlog.md` | 59 of 205 (29%) | 101 |
| `docs/decisions-today.md` | 35 of 205 (17%) | 50 |
| `docs/operations.md` | 22 of 205 (11%) | 44 |
| `docs/team.md` | 10 of 205 (5%) | 13 |

The command for each row: `git log [--first-parent] --oneline --since=2026-11-01 origin/main -- <file> | wc -l`. The request's own counts (56, 37, 29 and 20) did not reproduce with either method. Long tasks' own files took 11 to 20 commits each (T-206 20, T-212 15, T-039 14, T-213 11, T-052 11; all commits, measured).

**Recent conflicts** (measured: each merge commit's two parents replayed with `git merge-tree --write-tree --name-only`, git 2.46.0):
- **PR 192** (D49, one long-lived demo world): merging `origin/main` in (707f2e4, 2026-11-04 20:41 UTC) conflicted in `docs/plan.md` and `docs/decisions-today.md`. An earlier merge of the T-224 branch (be064df) conflicted in `docs/plan.md`.
- **PR 202** (T-221 slice 2): merging `origin/main` in after T-219 landed as PR 195 (69e0dc3, 2026-11-05 10:32 UTC) conflicted in `docs/plan.md`, `docs/tasks/T-219-lane-in-flight-row.md` and `apps/demo-cloud/src/world.ts`.
- **PR 204** (T-220, open): merging `origin/main` in (4a7b954, 2026-11-05 10:49 UTC) conflicted in 9 files: `docs/backlog.md`, `docs/plan.md`, `docs/operations.md`, `docs/team.md`, the T-219 and T-221 task files, and 3 files in `apps/demo-cloud/`. In `docs/backlog.md`, PR 205 (7f7bf1b) changed the row "Sepolia: the operators' adjudicators act on a deal behind the chain". That row sits right after the one PR 204 inserts ("Until T-225's M1 fix …").
- **PR 195** (T-219): one merge of `origin/main` (113976a) conflicted in 10 files, among them `docs/plan.md`, `docs/backlog.md`, `docs/neutrality.md` and ADR-0028.

The code conflicts in PR 202 and PR 204 come from stacked branches (inferred). Both branches carried T-219's commits, and PR 204 also T-221's. Those tasks then landed on main as squash commits, so git merged two histories of the same edits.

**What one conflict costs.** Nine `ci` runs on pull requests between 2026-11-04 22:07 and 2026-11-05 10:46 UTC took 7.6 to 10.4 min each, median 9.3 min (measured, `gh run list`, creation to last update). A docs-only PR pays the same: PR 205 took 7.6 min and PR 201 9.6 min. A conflict found after CI passed means one more run (inferred).

**Who reads the shared docs today** (measured, from the code):
- `scripts/design-map.mjs` reads `docs/plan.md`, `docs/decisions-today.md`, every ADR's Status line, every task file's fields, `docs/api.md`, `docs/reviews/` and the newest `docs/log/` file. `tests/design-map.test.ts` checks the extraction.
- The founder console (`control/console.mjs` in the private repository) reads each task file's Lane, Paths, Human gate and Status. It dates each decision from `docs/decisions-today.md`'s first-parent git history and reads the newest `docs/log/` file.
- `docs/update-flow.md` lists the roadmap, decisions and log areas and their flows; the console parses its two tables.

**The options to research and choose between.** The task picks one or a combination, with reasons. Each line below is a starting point, not a finding.
1. **One file per item, with generated indexes.** Backlog rows, decisions and deploy records become small files, and `docs/plan.md`'s rows come from task files' front matter. Two PRs then touch different files. Tradeoffs: a large move, and every reader above changes. A committed index regenerated inside each PR still conflicts, so the index is either generated at read time or updated after the merge (option 2). Anchors such as `decisions-today.md#d49` break unless the index keeps them.
2. **A post-merge docs step.** Code PRs edit only their own task file and new files. A job or the coordinator then updates the shared indexes after each merge. Tradeoffs: the indexes lag main by one cycle. The main ruleset requires a PR for every change to main, so the step opens a PR and waits for CI, or batches several merges into one. A GitHub Actions job is a `.github/` change, so Rafa merges it.
3. **Append-only sections with git's built-in `union` merge driver** (`.gitattributes`), as a stopgap. Tradeoffs: it resolves two added lines but keeps both versions of an edited line, with no conflict marker, so an edited table row appears twice. Agents merge `origin/main` locally, where it applies. Whether GitHub's own merge honours it is unconfirmed; the research checks with a test PR.
4. **Docs edits in a separate follow-up PR** after the code PR merges. Tradeoffs: two CI runs per change, docs that lag, and a follow-up that can be forgotten. Follow-up PRs still collide with each other unless one writer makes them.

**The move itself** conflicts with every open branch that edits a moved file (inferred). Land it when the open PR list is short, and tell each open branch how to carry its rows over.

## Acceptance criteria

- [ ] **Research and decision.** A research note, `docs/research/<date>-docs-merge-conflicts.md`, measures the baseline, compares the options above and any others found, and recommends one. The decision is recorded as the next D number in `docs/decisions-today.md`, where Rafa can overrule it (his standing rule: every decision gets a research pass first).
- [ ] **The layout in place, nothing lost.** The chosen layout is on main. Every row, decision and record from before the move is present after it, checked by a script that compares them (measured). A file that moves whole keeps its history under `git log --follow`.
- [ ] **Readers and links work.** `pnpm map` and `tests/design-map.test.ts` pass. The console's readers still find each task's fields, each decision's first-seen date and the newest log; their tests pass in the private repository. `node site/build.mjs && node site/check.mjs` passes. A link check over `docs/`, `README.md`, `CLAUDE.md` and `site/` finds no link to moved content that fails to resolve (measured).
- [ ] **Where an agent writes what.** `docs/team.md`, `docs/update-flow.md` and the agent briefs in `.claude/agents/` and `.claude/commands/` say which files a PR edits (its task file and new files) and which shared indexes it leaves to the post-merge step, if one exists.
- [ ] **Before and after, measured.** Conflicts in shared docs per merged PR, over the 7 days before the change and the 7 days after, counted by replaying each PR branch's merge commits with `git merge-tree`. This file's Evidence holds both numbers and the command.

## Out of scope

- Changing the content of any doc. The task moves and splits text; it does not rewrite it.
- The agent-ops pipeline itself (Phase 10).
- Code conflicts from stacked branches over squash merges (PR 202, PR 204). The research notes them if the same fix applies.

## Evidence

## Decisions

## Handoff
