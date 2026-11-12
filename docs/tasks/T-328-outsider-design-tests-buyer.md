# T-328: Outsider design tests, buyer-started (roadmap N1a)

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-066 (the One-Click harness, draft PR 217), T-222 (Crow's test seller), T-030 (the last outsider run, 2026-11-02)
- **Paths this task may touch:** `tools/one-click/` (the harness files this task needs), `docs/reviews/2026-11-11-outsider-design-tests.md` (the findings), this file; run output under `reports/scratch/t-328/` (not committed)
- **Human gate:** no. The runs use Sepolia test funds from the public faucet and fresh keys the outside agents make. A run that needs a secret, a funded key of ours or a deploy stops and is recorded as blocked.
- **Status:** done (PR merged on 2026-11-11)
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

- [x] Each of the four scenarios has one run recorded with: success or the step it stopped at, approvals asked, tokens, wall time, API calls, errors by status, and every doc gap the agent hit.
- [x] Every friction point is a written finding with the doc section or route it concerns, a severity and the smallest fix; a finding that would change the API or contracts is marked for the stage 4 spec.
- [x] A scenario the live test seller cannot play is recorded as blocked, with what is missing.
- [x] The record states per scenario whether `llms.txt` worked, each claim labelled measured or inferred.

## Out of scope

- Edits to `site/llms.txt`, the API, the operators, the test seller or `examples/`.
- Seller-started scenarios (scenario 3 and others belong to a seller-side row).

## Evidence

The full record and the findings are in `docs/reviews/2026-11-11-outsider-design-tests.md`.

- **Result** [measured, 2026-11-11, 14:38 to 15:05 UTC]: 4 of 4 fresh agents reached their end state from `llms.txt` alone. Scenarios 1 (Released) and 4 (Refunded) ran against Crow's live test seller. Scenarios 2 and 5 are blocked against it (no rubric item, no way to miss a deadline); in both the agent played both sides and reached Released and a buyer's reclaim.
- **Per run** [measured]: approvals 20, 15, 15 and 10; tokens 1,683,506, 1,311,812, 1,000,066 and 783,893; wall time 6.0, 5.8, 4.8 and 6.6 min, for scenarios 1, 2, 4 and 5.
- **Agent** [measured]: Claude Code 2.1.318, Agent SDK 0.3.318, `claude-opus-5-5` at effort `medium`, in Claude Code's OS sandbox (`--sandbox`).
- **Commands**: `npm ci --ignore-scripts --prefix tools/one-click`, then `node tools/one-click/outsider.mjs --scenario <1|2|4|5> --sandbox --out reports/scratch/t-328`, one at a time. Run files are in `reports/scratch/t-328/` (not committed).
- **Local checks** (kind 9: one run, then read its log): each run's `record.json` and `digest.jsonl` read; `node --check tools/one-click/outsider.mjs` passes.

## Decisions

- **The sandbox.** The auto-mode classifier refused to start the outside agent with every tool request approved and no sandbox, which is T-066's gate 1. The runs used Claude Code's OS sandbox instead (writes only in the agent's folders, no reads of this user's folders, network only to Crow, npm and Sepolia hosts), with Bash still asking each time. The effects on the counts are in the review's "Harness effects".
- **One run each, scenario 1 not rerun.** Scenario 1 ran before the harness fixes (npm cache, Node proxy, the fetch probe). It is recorded as it ran, with its Node calls marked "not counted", so it does not use a third test-seller request this hour.
- **A standalone harness file.** `outsider.mjs` carries its own record format instead of PR 217's `metrics.mjs` and schema, so this branch takes only PR 217's `package.json` and `package-lock.json`.

## Handoff

Done: the four runs and the findings (F1 to F9). Not done here: the fixes, which are later rows. F1, F2, F3 and F9 are test-seller changes; F4, F5, F6 and F8 are `llms.txt` edits (N10); F7 is T-325's buyer signer. No finding needs an API or contract change.

To run again: the commands under Evidence. Allow file tools under the sandbox's `TMPDIR` first, and add GitHub to the allowlist if the agent may read the repository.
