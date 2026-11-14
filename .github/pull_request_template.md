<!--
Title: Conventional Commits, `type(scope): subject`, imperative, no trailing period. Example: `feat(settlement): add permissionless reclaim`.
Body: a one-minute briefing for a reviewer who has the diff. Short sentences. Drop a section with nothing to say, except Scope.
-->

Task: T-
<!-- The task this pull request works on: its T-number, whose file is in docs/tasks/. Add "Closes T-nnn" on a line of its own when it finishes the task. Work with no task writes "no ticket" here, with one sentence on why (the ID check ignores this comment). -->

Roadmap row:
<!-- The row the task file's "- **Roadmap row:**" line names, several separated by commas, or "none". The ID check reads the task file, so write the same IDs here. -->

## Why
<!-- The problem and the approach in 1 to 3 sentences. Name the task ID (T-xxx). -->

## What changed
<!-- 1 to 3 bullets. Name a symbol or path only when it carries the change. -->
-

## Scope
<!-- Always. What this covers and what it leaves out (follow-ups, known gaps, placeholder steps). -->
-

## Tradeoffs
<!-- Only alternatives a reviewer would ask about. -->

## Blast Radius
<!-- 1 or 2 sentences on who or what this touches and why that is safe or risky. Say if it touches a human gate (ADR, schema, contract, defense, keys, deploy) or one of the three litmus tests. -->

## Verification
<!-- 1 to 3 bullets, each a real run and its outcome, labeled measured, inferred or guessed. Start from `pnpm verify` (reports/verify-<branch>.md). Explain each snapshot diff in one line. -->
-
