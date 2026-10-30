# Phase 0 adversarial review (interrogate)

Date: October 30, 2026. Requested by Rafa before accepting D1–D9. Method: pstack's `interrogate` skill. Three adversaries attacked the accepted recommendations and Rafa's thesis, each on a different model. A finding survived only if it came with a rerunnable proof (a source or doc line, or a script's output), and the coordinator reran every proof before keeping it.

| Adversary | Lens | Model |
| --- | --- | --- |
| Strategy | The thesis, value capture, vocabulary, prior-art scoring | Opus |
| Mechanism | Whether the decisions compose: capture timing, expiry, key release, postings, terminal states | Sonnet |
| Neutrality | Single-party control points, plus a simplicity pass over the Phase 1 demo | Fable |

## Intent under review

Rafa's thesis: escrow contracts are commodities, and the value is the party that oversees release. The decisions: D1–D9 as recommended in `docs/decisions-today.md`, with T-002's and T-003's findings.

## Verdict on the thesis

Holds with changes.

- The commodity half holds for the buyer's funds only. `AuthCaptureEscrow` is a thin ledger with no admin control, and five of its six operations are operator-only. Bonds, key release, timeouts and idempotency are custody code Holdback owns.
- The overseer half holds, but neutrality turns the overseer into a permissionless market of bonded adjudicators priced from measured error. Value goes to adjudicators who judge well, not to Holdback. The one place it could collect is the judge registry, which commitments did not bind.
- "Operator" meant two things: the Commerce Payments Protocol's capture authority (Holdback's rules contract) and Holdback's operator node (a relay with no authority).

## Findings and resolutions

Fifteen findings survived; they merge into eleven by root cause. "Measured" means the proof was rerun by the coordinator. Commands run from the repository root unless noted.

| # | Finding | Found by | Proof | Label | Resolution |
| --- | --- | --- | --- | --- | --- |
| 1 | An escalated case whose appeal adjudicator goes silent reaches `Final` with no outcome; funds wait for payer-only reclaim | Mechanism, Neutrality | `python3 -I docs/reviews/2026-10-30-phase0/state_machine.py` on the pre-fix `architecture.md` printed no edge from an escalation to `Defaulted` | Measured | ADR-0006, ADR-0007: undecided escalation goes to the default outcome, paid from the appeal adjudicator's bond. `Appealed → Defaulted` edge. Fixture `neutrality.appeal-adjudicator-offline-after-escalation` |
| 2 | `Rejected → Held` (resubmit) is unreachable in guaranteed mode: the refund has left escrow | Mechanism, Neutrality | Same script printed `Rejected -> Held`; `mechanism_sim.py` shows escrow capturable amount 0 after a guaranteed reject | Measured | Edge removed; `maxSubmissions = 1` in Phase 1; resubmission returns with `settle_after_window` |
| 3 | 20% coverage cannot pay an overturn of 100% of price; a self-dealing adjudicator nets 80% of its book | Mechanism, Neutrality | `mechanism_sim.py`: one open commitment, bond 200, wronged party short 800 | Measured on a model of the contract | ADR-0007: 100% coverage per guaranteed commitment open to appeal; encumbered bond never counted twice. Fixture `attack.adjudicator-self-dealing` |
| 4 | Atomic key release holds only in guaranteed mode; early acceptance has no key path; a released key cannot be checked on-chain | Mechanism, Neutrality | `AuthCaptureEscrow` has no key concept; `settle_after_window` captures after the decision that would publish the key | Inferred | ADR-0012: atomicity scoped to guaranteed mode; seller-supplied key on early acceptance; "missing or wrong key" appeal ground. Fixture `appeal-bad-key-release` |
| 5 | "Capture only after appeals close" contradicts guaranteed mode | Mechanism | `prior-art.md` Q4 finding 4 versus `architecture.md` settlement modes | Measured | ADR-0003: capture timing per mode; expiry ≥ `appealDecideBy` plus margin |
| 6 | Paying the adjudicator on the refund path reverts unless the buyer signs `maxFeeBps = 10000`; fee recipients undefined for fallback, appeal and early acceptance | Mechanism | `mechanism_sim.py` F4a: `FeeAmountOutOfRange`; grounded in the fee-range check in `AuthCaptureEscrow.sol` (lines 132, 484 at commit 6b0a5ef) | Measured on a model; T-201 confirms on the contract | ADR-0003 `PaymentInfo` parameters; fee-recipient rule in `architecture.md` postings |
| 7 | The rules contract, the only party that can capture or void, has no row in the neutrality table | Strategy | `grep -rn "rules contract" docs/neutrality.md docs/architecture.md docs/PRD.md` returned 0 lines | Measured | Row added to `neutrality.md`; glossary separates operator node from rules contract; ADR-0001 party list |
| 8 | Panels draw from Holdback's registry, which commitments did not bind | Strategy, Neutrality | `grep -c registry spec/schemas/commitment.schema.json` returned 0 | Measured | Schema v0.2 `adjudication.registryHash` (ADR-0006). Fixture `neutrality.maintainers-change-registry` |
| 9 | No doc says who captures value; the fee formula has no margin | Strategy | `grep -rniE "revenue\|business model\|margin" docs` outside research returned nothing | Measured | "Where value accrues" in the PRD; value-capture consequence in ADR-0007 |
| 10 | One adjudicator can copy or leak held work, contradicting "held work" in ADR-0001 | Neutrality | ADR-0001 line 12 versus ADR-0012 "Adjudicators see plaintext" | Measured | ADR-0001 defines held work as key release; residual 6 in `neutrality.md`; `todo.adjudicator-leaks-plaintext` |
| 11 | `capture` has no nonce, so the hold test passes only through the operator | Strategy | `AuthCaptureEscrow.sol` lines 267–296 at commit 6b0a5ef decrement `capturableAmount` with no nonce | Measured | `prior-art.md` row 1 regraded; ADR-0003 idempotency condition |

## Dropped or adjusted

- Mechanism: the race between a seller-paying outcome and payer reclaim found no defect, because the default voids to the buyer. The expiry ordering it relies on is now an ADR-0003 condition.
- Neutrality: "no doc enforces the affiliation ban" was half right. An error code and fixture exist, but affiliation is self-declared. Folded into finding 3.
- Strategy: none dropped.

## Simplicity pass

The Phase 1 demo (beats 1–7) needs only `guaranteed_on_decision`, no resubmission and no sealed checks. That scope is now in `docs/plan.md`.

## Rerunning the proofs

`docs/reviews/2026-10-30-phase0/` holds the two scripts the adversaries wrote, with their file paths made relative. Run them from the repository root with `python3 -I`. They parse the current `docs/architecture.md`, so after these fixes their output shows the new `Appealed → Defaulted` edge and no `Rejected → Held` edge. Their hard-coded verdict lines still describe the original problem. `mechanism_sim.py` models the 20% coverage rule and `AuthCaptureEscrow`'s fee check in Python; it is not the contract.
