# T-328: Outsider design tests, buyer-started (roadmap N1a)

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-066 (the One-Click harness, draft PR 217), T-222 (Crow's test seller), T-030 (the last outsider run, 2026-11-02)
- **Paths this task may touch:** `tools/one-click/` (the harness files this task needs), `docs/reviews/2026-11-11-outsider-design-tests.md` (the findings), this file; run output under `reports/scratch/t-328/` (not committed)
- **Human gate:** no. The runs use Sepolia test funds from the public faucet and fresh keys the outside agents make. A run that needs a secret, a funded key of ours or a deploy stops and is recorded as blocked.
- **Status:** in progress
- **Agent/session:** a Claude Code side session, 2026-11-11, worktree `.worktrees/t-328-outsider`, branch `t-328-outsider-design-tests`
- **Change kind:** 9 (live tests on testnet, about 50k tokens a run), with a kind 2 record

## Intent

Rafa asked on 2026-11-11: "does llms.txt work?" Restated: measure whether a fresh agent, given only `https://crow.direct/llms.txt`, an empty folder, Node 22, curl and one sentence of goal, can buy through Crow against the live operators and Crow's live test seller. The last such run (T-030, 2026-11-02) was one happy-path deal against a local node. Since then `site/llms.txt` changed in 43 commits, settlement moved to Sepolia and the domain moved to crow.direct.

Four buyer-started scenarios, one fresh Claude Code agent each, one run each:

1. a dataset with the buyer's own deterministic checks, ending Released;
2. rubric-judged work, ending Released;
4. a rejected delivery, ending Refunded;
5. a missed delivery deadline, ending with the buyer's reclaim.

Outputs: one run record per scenario, and a findings review. Non-goals: fixing anything. `site/llms.txt`, the API and the examples stay as they are; fixes are later rows (N10, B2, T-252).

## Context

- Roadmap row N1a (stage 1, "Outsiders can use it").
- `docs/tasks/T-066-control-from-sources.md` and `docs/tasks/T-229-one-click-homepage.md`: how the harness drives a fresh Claude Code through the Agent SDK and counts approvals.
- `site/llms.txt`, "Crow's test seller": one item (3 rows of `customer_id,email`, checks-only) and one test outcome (`refund`).

## Acceptance criteria

- [ ] Each of the four scenarios has one run recorded with: success or the step it stopped at, approvals asked, tokens, wall time, API calls, errors by status, and every doc gap the agent hit.
- [ ] Every friction point is a written finding with the doc section or route it concerns, a severity and the smallest fix; a finding that would change the API or contracts is marked for the stage 4 spec.
- [ ] A scenario the live test seller cannot play is recorded as blocked, with what is missing.
- [ ] The record states per scenario whether `llms.txt` worked, each claim labelled measured or inferred.

## Out of scope

- Edits to `site/llms.txt`, the API, the operators, the test seller or `examples/`.
- Seller-started scenarios (scenario 3 and others belong to a seller-side row).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
