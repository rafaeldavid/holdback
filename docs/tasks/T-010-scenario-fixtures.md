# T-010: Scenario fixtures for demo beats 1–7 plus error and neutrality sets

- **Lane:** test
- **Phase:** 1
- **Depends on:** T-005, T-007, T-009, T-012
- **Paths this task may touch:** `fixtures/scenarios/`, `fixtures/recordings/` (`fixtures/clubs/` and `fixtures/terms/` belong to T-012)
- **Human gate:** no
- **Status:** in progress (first slice merged in PR 47; open rows wait on T-016)
- **Agent/session:** implementer, branch `t-010-scenario-fixtures`

## Intent

Write the Phase 1 fixtures from `docs/plan.md` Scenario index and capture live recordings once so CI replays real verdicts.

Restated: turn the Phase 1 scenario index, demo beats 1–7 first, into `.scenario.yaml` + reviewed `.expect.md` pairs that `pnpm snap` runs on SimChain, so every beat the demo narrates is a passing, deterministic test and each `neutrality.` row shows the named actor failing while the commitment still ends in the terms-compliant state and balances from `docs/neutrality.md`. Order: happy path and beats 1–7, then `neutrality.`, `error.`, `attack.`.

Non-goals and limits for this slice:
- No runner changes (`packages/testkit` is another lane). A row the runner cannot express is written as `todo.<name>` recording today's behavior, or listed in Handoff with the missing runner feature.
- No live recordings: no model keys exist. Verdicts are stub recordings (`capturedFrom: fake`); where a row needs a reject, split, abstain or injection flag, the verdict is authored by hand and says so in its rationale.
- Honest parties (docs/backlog.md); edge cases needing new protocol features go to Handoff, not code.
- No Phase 3+ fixtures, no edits to `fixtures/clubs/`, `fixtures/terms/` or `fixtures/data/` (T-012).

## Context

- `docs/plan.md` §Scenario index; `docs/demo.md` §Beats; `docs/testing.md`; `docs/neutrality.md`.

## Acceptance criteria

- [ ] Every Phase 1 row in the scenario index exists and passes, including the rows added by the Phase 0 review (`neutrality.appeal-adjudicator-offline-after-escalation`, `neutrality.maintainers-change-registry`, `attack.adjudicator-self-dealing`, `appeal-bad-key-release`, `todo.adjudicator-leaks-plaintext`) and by ADR-0016 (`neutrality.adjudicator-never-accepts`, `neutrality.adjudicator-silent-before-judging`, `error.acceptance-mismatch`, `error.seed-mismatch`, `error.member-not-admitted`, `early-accept-releases-key`) and by ADR-0017 and ADR-0018 (`neutrality.operator-rate-limits`, `attack.fallback-panel-shopping`, `attack.appeal-panel-shopping-after-escalation`, `attack.timing-grind`; `error.seed-mismatch` covers a wrong primary preimage, a fallback-chosen seed and an appeal-chosen seed; `neutrality.adjudicator-silent-before-judging` shows the beacon round) and by ADR-0019 (`mutual-split-releases-key`, `mutual-refund-before-delivery`, `mutual-cancel-keeps-work`, `neutrality.mutual-settlement-adjudicator-offline`, `error.settlement-single-signature`, `error.settlement-exceeds-price`, `error.settlement-after-decision`, `error.settlement-key-without-delivery`, `error.settlement-stale-delivery`, `error.settlement-disallowed-by-rulebook`, `attack.settlement-race-with-decision`) and by D23 (`mutual-exit-to-third-party`: the whole hold to a third address while the adjudicator stands by; `error.settlement-payouts-sum-mismatch`; `error.settlement-payouts-disallowed-by-rulebook`: a non-party payout under `payoutsTo: parties`).
- [ ] Recordings captured with `--record` from at least two model families; model IDs visible in snapshots.
- [ ] Each `neutrality.` fixture asserts the terminal state and balances named in `docs/neutrality.md`.
- [ ] Snapshots reviewed for readability by a human (Rafa or reviewer agent) — record reviewer.
- [ ] Privacy fixtures (ADR-0020): `neutrality.fallback-key-on-takeover` (Bench B cannot read before `judgeBy`, can after), `error.escalate-without-appeal-key`, `error.dispute-without-keys`, `error.disclosure-level-not-public-in-phase-1`.
- [ ] Screen fixtures (ADR-0021): `attack.injection-tags-empty-rubric` (accepted, screen flagged, SDK shows stripped text), `attack.injection-tags-required-check` (rejected by the required check, no panel), `neutrality.seller-multilingual-text` (Persian with ZWNJ, ❤️ and 🏴󠁧󠁢󠁥󠁮󠁧󠁿 settle without a false reject).
- [ ] Phase 4 set, pinned now (D19): `error.dispute-by-seller` (a seller-signed `Dispute` is refused with `invalid_signature`); `neutrality.optimistic-buyer-silent` (release at `disputeBy` by anyone).

- [ ] Finality and appeal fee (D20, D21): snapshots of `happy-path`, `appeal-overturn-bond-pays-seller` and `neutrality.buyer-silent` show `settledAt` and `finalAt` (`finalAt` equals `appealBy` with no trigger in the last). `neutrality.appeal-adjudicator-offline` asserts the appellant's balance returns to its pre-appeal value; the uphold and overturn fixtures assert the appeal adjudicator is paid at the decision, not at filing.
- [ ] Principal recourse (D22): `todo.principal-no-recourse` records residual 12.
## Out of scope

- Phase 3+ fixtures.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- **measured:** `pnpm verify` PASS on a clean tree at `a84ab41` (typecheck, lint, test, spec, snap pass; demo is still a placeholder). Report in `reports/verify-t-010-scenario-fixtures.md` (gitignored). `pnpm snap`: 25 passed, 0 failed (24 new fixtures plus `_example`); 16 pass under their prefix; 8 are `todo.` (2 are the plan's own `todo.` rows, `todo.adjudicator-leaks-plaintext` and `todo.principal-no-recourse`).
- **measured:** every fixture names `fixtures/clubs/data-services-v1.yaml` and `fixtures/terms/clean-customers-2000.yaml`, and the snapshots show both as "(loaded)", rulebook `0x140e…971e` (the T-012 files merged in PR45).
- **measured:** each passing `neutrality.` fixture asserts terminal state and balances: operator-refuses, adjudicator-offline, adjudicator-silent-before-judging (Released, $2,000 to Tidewater, fee to whoever decided), adjudicator-never-accepts (Expired, nothing moved), adjudicator-and-fallback-offline (Refunded $2,050, Bench A and B bonds pay $1,000 each to Tidewater), appeal-adjudicator-offline-after-escalation (Refunded $2,050, Bench C's bond pays Tidewater $2,000), buyer-silent (Released), seller-withholds-delivery (Refunded $2,050).
- **measured:** a recording bound to the stub terms failed with `RecordingMismatchError` naming `inputHash` and `rubricHash` once the real terms loaded; the runner never replayed a stale verdict.
- **measured:** `attack.adjudicator-self-dealing` and `error.coverage-exceeded` are refused at acceptance with `coverage_exceeded` ("unencumbered bond … is below the price").
- **inferred:** the injection, reject, split and abstain outcomes are driven by authored verdicts, not by the screen or by models; they show the aggregation and settlement paths, not judge quality.
- **not done (blocked on Rafa's keys):** recordings from at least two live model families. Snapshots show the testkit's stub seats (`stub-claude-pinned-1`, `stub-claude-pinned-2`, `stub-family2-pinned-1`), not the registry's pinned IDs (`config/judges.yaml`: `placeholder-claude-a-20260601`, `placeholder-claude-b-20260601`, `placeholder-gpt-a-20260601`, `placeholder-gpt-b-20260601`, `placeholder-qwen-a-20260601`), because the testkit does not draw from the registry yet.
- **not done:** human readability review of the snapshots (Rafa or reviewer agent). I reviewed each `.expect.md` before committing; that is not the independent review the criterion asks for.

### Rows

| Row | State | Fixture |
| --- | --- | --- |
| `happy-path` (beats 1–4) | pass | `happy-path` |
| `bad-work-panel-reject` | pass | `bad-work-panel-reject` |
| `attack.injection-plain` | pass (ends Escalated) | `attack.injection-plain` |
| `attack.injection-encoded-base64` (beat 6) | pass (ends Escalated; Bench C step missing) | `attack.injection-encoded-base64` |
| `attack.injection-encoded-unicode-tags` | pass (ends Escalated) | `attack.injection-encoded-unicode-tags` |
| `neutrality.operator-refuses` (beat 7) | pass | `neutrality.operator-refuses` |
| `neutrality.adjudicator-offline` (beat 7) | pass | `neutrality.adjudicator-offline` |
| `neutrality.adjudicator-and-fallback-offline` | pass | `neutrality.adjudicator-and-fallback-offline` |
| `neutrality.appeal-adjudicator-offline-after-escalation` | pass | same name |
| `neutrality.adjudicator-never-accepts` | pass | same name |
| `neutrality.adjudicator-silent-before-judging` | pass (beacon round not rendered) | same name |
| `neutrality.buyer-silent` | pass (no `settledAt`/`finalAt` in snapshot) | same name |
| `reclaim-no-delivery` | pass under another name | `neutrality.seller-withholds-delivery` |
| `attack.adjudicator-self-dealing` | pass (single-commitment form) | same name |
| `error.invalid-signature` | pass | same name |
| `error.coverage-exceeded` | pass | same name |
| `todo.adjudicator-leaks-plaintext` (residual 6) | todo | same name |
| `todo.principal-no-recourse` (residual 12) | todo | same name |
| `bad-work-row-drop` (beat 5) | todo: checks not evaluated, so it releases | `todo.bad-work-row-drop` |
| `panel-disagreement-escalates` | todo: appeal replays the primary's split | `todo.panel-disagreement-escalates` |
| `neutrality.operator-offline` | todo: offline operator still relays | `todo.operator-offline` |
| `neutrality.provider-outage` | todo: a provider is not an actor | `todo.provider-outage` |
| `error.submission-limit` | todo: a second delivery is refused as invalid_state (which already enforces maxSubmissions = 1); submission_limit_reached needs attempt 2 from Held | `todo.submission-limit` |
| `error.concurrent-overdraft` | todo: one commitment per scenario | `todo.concurrent-overdraft` |
| `neutrality.club-revokes-mid-flight` (beat 7) | open: no revoke step | — |
| `neutrality.appeal-adjudicator-offline`, `appeal-overturn-bond-pays-seller`, `appeal-overturn-bond-pays-buyer`, `appeal-bad-key-release` | open: no party-appeal step, no role-specific recordings | — |
| `early-accept-releases-key` | open: no early-accept step | — |
| `neutrality.maintainers-change-registry`, `error.unpinned-model-refused`, `error.policy-hash-mismatch` | open: stub registry and policy hashes | — |
| `error.scope-exceeded`, `error.revoked-agent`, `error.member-not-admitted` | open: fixed mandate scope, no revoke or admission steps | — |
| `error.replay`, `error.acceptance-mismatch`, `error.seed-mismatch` (3 cases), `attack.fallback-panel-shopping`, `attack.appeal-panel-shopping-after-escalation`, `attack.timing-grind` | open: the driver always signs fresh nonces and correct seeds and acceptances; no message overrides | — |
| `error.idempotency-conflict`, `neutrality.operator-rate-limits` | open: the testkit submits to SimChain, not through the operator API | — |
| `error.adjudicator-affiliated`, `error.mime-not-allowed` | open: no affiliation data; mime comes from terms | — |
| `mutual-split-releases-key`, `mutual-refund-before-delivery`, `mutual-cancel-keeps-work`, `mutual-exit-to-third-party`, `neutrality.mutual-settlement-adjudicator-offline`, `attack.settlement-race-with-decision`, `error.settlement-single-signature`, `-exceeds-price`, `-after-decision`, `-key-without-delivery`, `-stale-delivery`, `-disallowed-by-rulebook`, `-payouts-sum-mismatch`, `-payouts-disallowed-by-rulebook` | open: no mutual-settle step; `Settled` is not a runner terminal state | — |
| `neutrality.fallback-key-on-takeover`, `error.escalate-without-appeal-key`, `error.dispute-without-keys`, `error.disclosure-level-not-public-in-phase-1` | open: the driver wraps keys for all adjudicators at delivery; no per-envelope view | — |
| `attack.injection-tags-empty-rubric`, `attack.injection-tags-required-check`, `neutrality.seller-multilingual-text` | open: screen and checks not run by the testkit | — |
| `error.dispute-by-seller`, `neutrality.optimistic-buyer-silent` (D19) | open: no dispute step; `@mode` other than guaranteed refused | — |
| `todo.milestone-delivery` | open: not written in this slice | — |

## Decisions

- **Authored verdicts as `capturedFrom: fake` recordings.** Reject, split, abstain and injection rows need verdicts the fake judge cannot produce. I captured stub recordings, then edited the verdict only; each rationale starts "authored fixture verdict for <scenario> (T-010), not a model output". The six bound hashes are the runner's own, so a terms or input change still fails loudly. Live capture replaces them later.
- **Club and terms from T-012.** After PR45 merged, every fixture names the real club and terms files, and clock advances were re-timed to its windows (deliver 48 h, judge +120 s, fallback +120 s).
- **`reclaim-no-delivery` is `neutrality.seller-withholds-delivery`.** The no-prefix rules reject any outage, and the runner records a reclaim as the seller's timeout. The neutrality prefix fits (`docs/neutrality.md` names the seller and reclaim) and asserts the balances.
- **Gaps as `todo.` only where the run shows something.** Rows whose missing step would leave an empty or misleading run are listed as open instead of written as `todo.` fixtures.
- **Placeholder deliverables.** Injection and fabricated-value files are not in `fixtures/data/` (T-012 backlog), so those fixtures use `stub_bytes: true` with the intended file name; the snapshot says so.

## Handoff

**Runner features that unblock the open rows** (testkit lane; I did not edit `packages/testkit`):
1. Run `@holdback/judgment` in the testkit: deterministic checks, screen, and panels drawn from `config/judges.yaml` with role-specific sizes (appeal: five judges, three families). Unblocks `bad-work-row-drop`, the injection-tags and multilingual rows, `error.unpinned-model-refused`, real pinned IDs in snapshots, and Bench C's reject in beat 6.
2. Key recordings by role (`<scenario>/<role>/<judgeId>.json`), so a primary and an appeal panel in one scenario can disagree. Unblocks `panel-disagreement-escalates` and the appeal rows.
3. New steps: `appeal` (party, with bond and fee), `early_accept`, `mutual_settle` (and `Settled` as a terminal state), `dispute`, `revoke_member`, `revoke_mandate`, deliver `attempt`, and a second commitment per scenario. Core already refuses any delivery after Delivered with `invalid_state` (`packages/core/src/state.ts`), so Phase 1's `maxSubmissions = 1` holds today; promoting `error.submission-limit` means sending attempt 2 as the first delivery from Held, which needs the `attempt` field.
4. Message overrides for refusal fixtures: reuse a nonce, wrong seed or seed preimage, wrong policy or acceptance hash.
5. Route `offline: { actor: <operator> }` like `operator_refuses`, and let the no-prefix rules accept the seller's reclaim timeout.
6. Snapshot rendering: `settledAt` and `finalAt` (D20), "seed source: beacon round N" (ADR-0018), the recipients of each content-key envelope (ADR-0020), and hours in the clock column past 60 minutes (`2882:08.000` today).
7. Phase 4 (D19): optimistic mode so `neutrality.optimistic-buyer-silent` can run.
8. With the check wiring (T-016), switch `bad-work-panel-reject`, `attack.injection-plain` and `attack.injection-encoded-base64` from `stub_bytes` placeholders (about 80 bytes) to real T-012 data files; otherwise the rows and cols checks refund them before the panel runs and the fixtures stop testing the panel.

Items 1, 2 and 6, and the rendering backlog from the PR47 review (clock hours, seller column, seed label, abstain display, receipt range, an "authored" label, a `fails:` list), belong to T-016.

`todo.` expect blocks are marked in the YAML as today's measured outcome or as the outcome desired once promoted; `todo.panel-disagreement-escalates` has none because Bench C's outcome depends on recordings that do not exist yet.

**Proposed check (repeated failure mode):** `--judges fake --record` silently overwrote my authored verdicts when I re-recorded after the terms change, and I had to re-apply them. Proposal: a `capturedFrom: authored` value that the fake recorder refuses to overwrite, like `live`. That is a testkit and `docs/team.md` change outside this task's paths, so it is not made here; the next testkit task should add it and the Rules and checks row.

**Still owed on this task:** live recordings from two families once Rafa provides keys (`pnpm snap --judges live --record`, after the testkit supports it); an independent readability review of the snapshots; the open rows above as runner features land.
