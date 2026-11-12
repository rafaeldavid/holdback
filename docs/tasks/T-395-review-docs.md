# T-395: the whole-diff reviews' points in the audit docs

- **Lane:** docs, branch `contracts-audit-ready`
- **Phase:** 2
- **Depends on:** T-388 (the two whole-diff reviews, holdback PR 449, `ab362cb`), T-385 (the audit docs)
- **Paths this task may touch:** `docs/audit/`, `docs/decisions-today.md` if an entry is needed, and this file. Nothing under `contracts/`
- **Human gate:** no. The freeze and its placeholders are not part of it
- **Status:** done on the merge of this task's pull request
- **Agent/session:** the T-385 session, change kind 2, no review

## Intent

In my own words: the two reviews of the phase-one contracts left a short list for the docs (`docs/reviews/2026-11-12-phase-one-whole-diff-review.md`, section 10; the joint summary is section 6 of the second review). An outside auditor reads `docs/audit/`, so each point goes there as the reviews state it, checked against the reviews' text and the code:

1. The known issue "H-2 limit" is rated Medium, with the reviews' reason.
2. The register records that a delivery may carry two envelopes for the buyer, and the relayer then picks which one is released.
3. The scope's token assumption says the funding's safety rests on ERC-3009's payee rule.
4. The state model's section 9.1 says "an accept or a reject is final".
5. Known issue A-4 is corrected.
6. The register records its three unbuilt "enforce" checks for the outside audit, not built in phase one.

The freeze's placeholders stay as they are.

## Evidence

All on 2026-11-12, at the lane's tip `db47ba7`.

- **"H-2 limit"** (`known-issues.md`): rated medium, with the reviews' reason (finding M-1, found by both model families; closing it needs a new protocol step, D26).
- **Two envelopes** (`state-model.md`, register row 16): one sentence. Checked against `openOwnEnvelope` in `examples/verify.ts`, which refuses a second envelope for the buyer, and against `test_r11_second_twoBuyerEnvelopes_theRelayerChoosesWhichIsReleased` [measured: the test exists].
- **The token's payee rule** (`scope.md`, the token assumption): one clause (finding I-5).
- **Section 9.1:** "An accept or a reject by the primary or the fallback is final when written; an escalate hands the deal to the appeal adjudicator, whose accept or reject is final too."
- **A-4** (`known-issues.md`): the review's correction (section 6.1). No panel runs while the service waits for the round, so that restart loses nothing; the window that remains is a restart between the panel's answer and the decision's landing, because the result is kept in memory only.
- **The three unbuilt checks** (`state-model.md`, section 8.3): the dispute fields (rows 2 to 4), an escalation decision's appeal ground (row 8) and a primary's beacon fields (row 11). Each is marked "not built in phase one, recorded", with a paragraph under the table that names each test the reviews measured. This is the coordinator's default, put to Rafa. If Rafa chooses to build one, its row changes with the contract change.
- **Every test named is on the lane** [measured: `git grep` in `contracts/test/`].
- **Checks:** `vitest run tests` and `node site/build.mjs && node site/check.mjs` pass. CI runs the rest.

## Handoff

- **For the freeze itself, unchanged here:**
  - `docs/audit/scope.md`: `<FREEZE_COMMIT>`, `<RUNTIME_BYTES>`, the constructor's values with their addresses and code hashes, and `<filled at the redeploy>` for `HoldbackRules` and `DrandQuicknetBeacon`.
  - `docs/decisions/ADR-0018`: `<R10B_VERIFIER_GAS>`.
- **If Rafa chooses to build one of the three checks,** its register row and the paragraph under section 8.3 change with that contract change.
- **The review's item 4b** ("pay the seller the price, which may be 0") belongs to the next change to the contract descriptions, not to `docs/audit/`.
