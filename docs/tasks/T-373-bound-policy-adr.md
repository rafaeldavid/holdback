# T-373: A decision record for judging under the bound policy

- **Lane:** research (change kind 10, research and decisions)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Depends on:** T-367 (PR 386: the finding, in its Handoff)
- **Paths this task may touch:** `docs/decisions/ADR-0036-judging-under-the-bound-policy.md`, `docs/decisions-today.md` (one entry), this file
- **Human gate:** no. The record is Proposed until Rafa accepts it
- **Status:** review
- **Agent/session:** the T-373 author session, started by the coordinator on 2026-11-12

## Intent

A deal's signed terms pin its judgment policy by hash. T-367 found that the reference adjudicator refuses a deal whose bound policy names a screen version other than the running build's, so an operator deploy can leave an open deal without a judge.

This task confirms or refutes that finding, then writes the decision record that says how a deal is judged under its bound policy across builds and deploys. The record answers seven questions, each with its options, their cost and one recommendation: what a build keeps, a version withdrawn for a security reason, who carries which version, the deploy guard, a deal the build cannot judge, the fixture and tests, and the cost.

- **Inputs:** `CLAUDE.md`, `docs/team.md`, `docs/writing.md`, `docs/judgment-and-defenses.md`, `docs/neutrality.md`, ADR-0006 and the later records on policy, registry and screen, PR 386, `apps/adjudicator/src/`, `packages/judgment/src/`.
- **Outputs:** ADR-0036 (Proposed), D65, this file.
- **Non-goals:** any product code, test or fixture in the repository; a deploy; a live model call.

## Acceptance criteria

- [x] The finding is confirmed or refuted for the primary, the fallback and the appeal adjudicator, with file and line.
- [x] The record answers the seven questions, each with options, cost and one recommendation in one sentence.
- [x] Every claim about today's behaviour cites a file and line and carries a label.
- [x] The record ends with the build's task in one paragraph.
- [x] One entry in `docs/decisions-today.md`.
- [ ] One pull request into `main`, merged after CI passes.

## Out of scope

- The build itself (the judgment lane, after T-372 merges).
- The three points the record lists under "Not decided here".

## Evidence

- **The finding holds** [measured, 2026-11-12, commit `e1e8df2`]. A scratch test in the worktree, `apps/adjudicator/src/zz-t373-scratch.test.ts`, run with `pnpm exec vitest run` and then moved out of the repository: 2 tests, both passed.
  - It models the earlier build as a policy with `screenVersion: 'screen-prev'`, accepted by an adjudicator configured with it. Acceptance compares hashes only (`apps/adjudicator/src/service.ts:285`). Three adjudicators on the build's default policy then replace it and register again.
  - **Primary:** `refused: policy_mismatch`, detail "policy-hash-mismatch: screen screen-prev is not screen-0", state Delivered, no judge called.
  - **Fallback:** no takeover triggered and `policy_mismatch`; after a manual trigger, `policy_mismatch` again, state FallbackJudging.
  - **Appeal adjudicator after an escalation** (the escalate decision signed by hand, since this build cannot judge under `screen-prev`): `policy_mismatch`, state Escalated.
  - **The deal:** `trigger_default` then `apply_default_outcome` give Refunded with `via: default_outcome`. No record, no decision.
  - The file is in the sessions' shared notes folder as `t-373-scratch-test.ts.txt`. To run it again, copy it to `apps/adjudicator/src/` with a `.test.ts` name, after `pnpm exec tsc -b apps/adjudicator`.
- **The contract is not touched** [measured by reading]: `contracts/src/HoldbackTypes.sol:296-311` and `:361-384` rebuild the acceptance's and the decision's digest from the terms' `policyHash` and `registryHash`; the same on `origin/contracts-audit-ready` at `6230b46`.
- **Nothing else was run.** Change kind 10 has no local checks.
- **Red team:** one `red-teamer` pass on the first draft (`fc0ed8d`): no Critical, 2 High, 6 Medium, 6 Low, all fixed or stated in the record's section "Red team". It opened the cited lines and confirmed them; four attacks failed. It used about 200,000 tokens [measured, the subagent's usage line].

## Decisions

- **The registry joins the record.** The task named the screen, the templates and the aggregation version. The adjudicator refuses a deal bound to another registry by the same path (`service.ts:393-396`), and `docs/neutrality.md` already plans `neutrality.maintainers-change-registry`, so one rule covers both.
- **The record sets which code each policy field covers,** since PR 386 changes the sampler under `screen-1` and no field names the sampler. A fifth field is left open.
- **A red-team pass, though kind 10 asks for no review.** The record decides whether a deploy can stop a deal from being judged (Rafa's rule: red-team settlement and judgment).
- **ADR-0036 and D65,** because PR 386, open at the time, holds ADR-0035 and D64.

## Handoff

**Done:** the finding confirmed; ADR-0036 written, Proposed; D65 recorded.

**Not done:** the build. Its task is the record's section "The build's task", one paragraph for the coordinator's brief. It goes to the judgment lane after T-372 merges.

**Length.** The record runs to about 4,300 words with its tables and paths. Its summary says how to read it in ten minutes: the summary, the finding's table and the seven bold recommendations.

**For the coordinator:**
- **PR 386 merged first** (`8d20405`), so this branch merged `main` and kept both entries, D64 then D65. `screen-0` now lives only in git: `git show 00be274:packages/judgment/src/screen.ts`.
- **Until the build lands,** a deploy that changes a version or a registry goes out only when no open deal binds the outgoing policy (T-367's Handoff gives the reads). The next operator deploy is the first: `main` now registers `screen-1`.
- **Docs the build updates,** since this task edits no other shared doc: `docs/judgment-and-defenses.md` (the policy-binding paragraph), `docs/neutrality.md` (the maintainers' row, its fixture, and a residual: three adjudicators on one build are one point of failure for judgment), `docs/operations.md` (the two-deploy rule), `docs/team.md` (a Rules and checks row).

**For the triage file** (lower priority, found in passing, not verified by a run):
- **Judging twice after a restart.** The adjudicator keeps its judged records in memory (`apps/adjudicator/src/service.ts:153`). A restart or deploy between a panel's return and the decision's submission would call the judges again for the same commitment, role and attempt [inferred].
- **No public read of a policy by its hash.** A party cannot read the policy its open deal binds once the primary has registered another [inferred: `docs/api.md` names no such route].
- **One policy ID for two policies.** The demo adjudicators' policy ID stays `<label>/p1` when a version changes (`apps/adjudicator/src/test-adjudicator.ts:147`), so the terms' `policyId` no longer tells two policies apart; `policyHash` does [measured by reading].
