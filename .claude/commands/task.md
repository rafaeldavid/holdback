---
description: Pick up a task file and run it through the full loop (intent → worktree → test-first → verify → handoff → PR)
argument-hint: T-xxx
---

Pick up task $ARGUMENTS from `docs/tasks/`.

1. Read the task file, `CLAUDE.md` and every linked spec and ADR.
2. Check that the task's dependencies are done. If they are not, stop and report.
3. Write the Intent section in your own words, including non-goals. If anything ambiguous would change the outcome, ask now.
4. Create the worktree and branch: `git worktree add ../holdback-$ARGUMENTS -b t-<id>-<slug>`.
5. Use the `implementer` subagent's procedure: write tests or fixtures first, then the implementation, staying within the listed paths.
6. Run `/verify`. Fill in Evidence (measured, inferred or guessed), Decisions and Handoff.
7. Ask the `reviewer` subagent for a review, and address any ISSUES.
8. Open a PR with the template (Conventional Commits title). Set the task status to review. If the task has a human gate, say so in the PR's Blast Radius section.
