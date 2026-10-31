# T-016: Testkit runner features that unblock the open T-010 rows

- **Lane:** test
- **Phase:** 1
- **Depends on:** T-005, T-008, T-009, T-010 (PR47)
- **Paths this task may touch:** `packages/testkit/`, `docs/team.md` (Rules and checks row for authored recordings), regenerated `fixtures/scenarios/*.expect.md` and `fixtures/recordings/` only where a runner change alters existing output
- **Human gate:** no
- **Status:** review
- **Agent/session:** implementer, branch `t-016-testkit-runner`

## Intent

T-010 wrote 18 passing fixtures but about 45 Phase 1 scenario rows cannot be expressed by the snap runner yet. Give the runner the features those rows need, so T-010 can finish them without touching the runner itself.

Restated: the snap runner should judge with the real library (intake, deterministic checks, screen, a seeded panel from `config/judges.yaml` sized by role) instead of the T-005 stub, replaying only the model answers from recordings; recordings must be keyed by role so two panels in one scenario can disagree; fixture authors need a way to keep hand-written verdicts safe from a fake re-record; and the step vocabulary needs the remaining protocol moves the scenario index uses. Each feature gets a unit test and, where a T-010 todo exists, one promoted fixture as proof.

Non-goals: writing T-010's remaining fixtures; optimistic mode (D19); live recordings; any change to `@holdback/core`, `@holdback/settlement`, `@holdback/judgment` or `spec/` (a feature that needs one stops and goes to Handoff).

Scope change (coordinator, after the build review in PR49): ship (1) the judgment pipeline, (2) role-keyed recordings, (3) the authored guard and its Rules and checks row, (4) `mutual_settle`; keep other features already finished and green; stop unfinished ones and list them as T-016b. The rendering extras were not started and are in Handoff.

## Context

- T-010's Handoff (`docs/tasks/T-010-scenario-fixtures.md`) lists the gaps and the rows each blocks.
- `docs/plan.md` §Scenario index; `docs/testing.md`; ADR-0016, ADR-0018, ADR-0019, ADR-0020, ADR-0021; decisions D19–D23.
- `packages/judgment` (T-008, T-009) and `config/judges.yaml`.

## Acceptance criteria

Each feature lands with a unit test in `packages/testkit` and, where possible, one T-010 fixture moved from `todo.`/open to passing as proof.

- [x] Judgment pipeline in the runner: deterministic checks, screen and panels drawn from `config/judges.yaml`, with role-specific sizes (appeal panel of five over three families). Snapshots show registry model IDs. Proof: `bad-work-row-drop` refunds.
- [x] Recordings keyed by role (`<scenario>/<role>/<judgeId>.json`), with a migration for the existing recordings. Proof: `panel-disagreement-escalates`.
- [ ] Steps: `appeal` (party, bond and held fee), `early_accept`, `mutual_settle` (`Settled` terminal state, D23 payouts), `dispute`, `revoke_member`, `revoke_mandate`, deliver `attempt`, and a second commitment per scenario. Done except `dispute`, `revoke_member`, `revoke_mandate` (need settlement submissions; Handoff). Proof: `error.concurrent-overdraft`.
- [x] Message overrides for refusal fixtures: reused nonce, wrong seed or preimage, wrong policy or acceptance hash (`tamper:`; unit tests, no todo fixture to promote).
- [x] `offline: { actor: <operator> }` stops that operator from relaying; the no-prefix rules accept the seller's reclaim timeout. Proof: `neutrality.operator-offline`.
- [ ] Snapshot rendering: `settledAt` and `finalAt` (D20), "seed source: beacon round N" (ADR-0018), content-key envelope recipients (ADR-0020), hours in the clock column past 60 minutes. Only "seed source" is done (with the pipeline); the rest moved to T-016b.
- [x] `capturedFrom: authored` recordings that `--judges fake --record` refuses to overwrite (like `live`), plus the Rules and checks row in `docs/team.md`.
- [x] Existing snapshot diffs explained line by line in the PR.

## Out of scope

- Writing the remaining T-010 fixtures (T-010 finishes them once this lands).
- Optimistic mode (D19, Phase 4).
- Live recordings (need Rafa's keys).

## Evidence

- **measured:** `pnpm verify` on a clean tree after merging origin/main (df6486d): typecheck, lint, test (1862 tests), spec, snap (25 passed, 0 failed), demo all pass; report `reports/verify-t-016-testkit-runner.md`.
- **measured:** `packages/testkit` unit tests: 133 pass, including `judgment.test.ts` (10: row-drop rejects with zero judge calls; three registry seats over at least two families with registry model IDs; same seed same panel, other seeds other panels; appeal panel of five over three families under the appeal template; reject on 2 of 3 fails; escalate on a split and on suspected injection; appeal "no decision" after escalation vs the first outcome after a party appeal; plaintext hash mismatch rejects without a panel; a registry that cannot seat two families is a refusal; a recording error escapes the pipeline instead of becoming a judge error).
- **measured:** proofs promoted from `todo.`: `bad-work-row-drop` (rows ✗ 8740, panel not run, Refunded), `panel-disagreement-escalates` (primary 3 judges split, appeal 5 judges over 3 families accept; gpt-b, claude-a, claude-b sit on both panels with different verdicts), `error.concurrent-overdraft` (second fund refused insufficient_funds), `neutrality.operator-offline` (op-1 not relayed, op-2 and direct carry on, Released).
- **measured:** `pnpm snap --migrate-recordings` moved 38 v0 recordings; the two fallback-judged fixtures then failed loudly with RecordingMissingError (as designed) and were re-captured under `fallback/`.
- **measured:** existing snapshots changed for the reasons in the PR (Settlement/Judgment rows, commitment IDs and chain heads from the new registry and policy hashes, judgment sections with real checks, screen, registry judges and seed source). No balance or terminal state changed except the three stub_bytes attack fixtures and `neutrality.appeal-adjudicator-offline-after-escalation` (re-authored to keep its escalation).
- **inferred:** no live model call or network access: recorded and fake providers only; the pipeline's provider is an in-process adapter.
- **guessed:** the remaining T-010 rows listed in its Handoff items 1, 2, 4 and 5 can now be written without runner changes; not tried row by row.

## Decisions

- **Testkit depends on `@holdback/judgment`, not on `apps/adjudicator`.** The runner mirrors the service's panel sizing, appeal mapping and intake-fault mapping in `judgment.ts` and its default policy in `judges-config.ts` rather than importing an app into a package. Cost: two copies of `defaultPolicy`; a drift would show as a policyHash change in every snapshot.
- **Intake runs on the delivered bytes** with an identity opener (the runner's envelopes are not real encryption), so the library still checks MIME, size, plaintext hash and UTF-8.
- **No panel without a seed.** A fallback or appeal judge step with no turn is refused `not_your_turn`, and one before its beacon round is published `seed_mismatch`, before any judge is called (the service does the same). The stub used a substitute random seed.
- **One judgment per (commitment, role, attempt)** is cached in the runner: a panel is never re-rolled.
- **Recording format v1** stores the role; v0 files are refused with a pointer to `--migrate-recordings`, which files appeal-template recordings under `appeal/` and everything else under `primary/` (fallback recordings then fail loudly and are re-captured, rather than guessed).
- **Fake capture replays a matching live or authored recording** instead of refusing outright, and refuses only when the existing one is stale, printing the changed bindings. Refusing even matching ones would make any scenario with one authored verdict impossible to re-record.
- **stub_bytes attack fixtures now reject on the checks.** The real injection files do not exist yet; their expect blocks were updated to Refunded rather than faking an injection on clean data.
- **`tamper: wrong_commitment_id` yields `not_found`**, not `acceptance_mismatch`: SimChain looks the commitment up before core compares it.
- **`appeal-hold` balance column** shows the appeal bond and fee held apart from escrow (D21), so conservation holds while an appeal is open.

## Handoff

Done: the judgment pipeline, role-keyed recordings with a migration, the authored guard and its Rules and checks row, `mutual_settle` (Settled terminal, D23 payouts), plus these finished and green before the scope change: `appeal`, `early_accept`, `expire_appeal`, deliver `attempt`, `commitment: n`, `tamper:` overrides, offline operator routing and reclaim in normal fixtures.

**T-016b (stopped by the scope change, not started):**
1. Rendering extras: `settledAt` and `finalAt` (D20, from `SimChain.state(id)`), content-key envelope recipients and releases (ADR-0020, from `key.released` payloads), hours in the clock column past 60 minutes.
2. From the PR47 review: clock advances as their own timeline rows (no skipped step numbers); always render buyer and seller balance columns; "rcpt-0001" instead of "rcpt-0001–rcpt-0001" for one receipt; `fails:` taking a list of actors (`neutrality.adjudicator-and-fallback-offline` names only Bench B today); no rendered row for the implied acceptance in `agree_and_fund`; an offer that expires because the adjudicator never accepted rendered as that, not "timed out". Already done here: "seed source: beacon round N" on fallback and appeal panels, "abstain" with no scores, "(authored)" on judge lines.

**Needs another lane (stopped):** `dispute` (optimistic mode, D19, Phase 4), `revoke_member` and `revoke_mandate` (SimChain fixes members and mandates at genesis; needs settlement submissions). The parser refuses all three with the reason.

**For T-010:**
- Real data files are owed for `attack.injection-plain`, `attack.injection-encoded-base64` and `bad-work-panel-reject` (placeholder bytes now fail `cols`/`rows` and refund before any panel; their authored verdicts are gone). With real files, re-author verdicts as `capturedFrom: authored`.
- `todo.submission-limit` can use `deliver: { attempt: 2 }`; from Delivered any second delivery is `invalid_state`, so the row as written needs `attempt: 2` on the only delivery from Held.
- Descriptions in `todo.provider-outage` and `todo.panel-*`-style fixtures still mention "capturedFrom fake" and "Claude judges"; the panels are now drawn from the registry (gpt, qwen).
- `docs/testing.md` (Recorded judges) and `fixtures/README.md` still describe `<scenario>/<judgeId>.json` and `capturedFrom live|fake`; they are outside this task's paths.

**For an ADR follow-up (coordinator):** when both first-instance adjudicators default, SimChain splits the seller's compensation 50/50 between their bonds (`splitBps(comp, HALF_BPS)`: the fallback pays half rounded down, the primary the rest; `packages/settlement/sim/simchain.ts`, `apply_default_outcome`). ADR-0007 is silent on the split; `neutrality.adjudicator-and-fallback-offline` pins today's behavior.

**Paths outside the list touched:** `pnpm-lock.yaml` (the new `@holdback/judgment` workspace dependency), `fixtures/scenarios/*.scenario.yaml` for the four proofs, `_example` (real CSV instead of stub bytes) and expect blocks or descriptions of fixtures whose outcome the real checks changed.

Resume: `pnpm snap` is green; start T-016b from `packages/testkit/src/render.ts` and `stub-settlement.ts` (`result()` for finality and key releases).
