# ADR-0022: Integer rates and fraction thresholds

- **Status:** Accepted, 2026-10-30 (D18)
- **Date:** 2026-10-30
- **Raised by:**
  - The schema v0.5 review (PR 23), which flagged float rates feeding money arithmetic.
  - The T-008 red team, whose finding 16 is that 0.667 makes a 3-judge panel need 3 of 3.
  - Two independent research passes (Fable, max effort): one on integer rates, one on threshold semantics.
- **Changes:** schema v0.5 (applied on PR 23), core money helpers, T-006 and T-008, `CLAUDE.md` and `docs/team.md`.

## Context

- **Rates are floats today.**
  - `Rate` is a JSON `number` from 0 to 1 in `spec/schemas/common.schema.json`. v0.5 has 18 fields that use it (measured).
  - The fields are:
    - policy `acceptSupermajority` and `rejectSupermajority`;
    - metrics `falseAcceptRate`, `falseRejectRate` and `escalationRate`;
    - pool `capitalChargeRate`, `capitalChargeToPoolRate` and `firstLossShare`;
    - rulebook `windowCoverageRatio`, `appealBondRate`, `sellerCompensationRate`, `buyerCompensationRate` and `firstLossShareMin`;
    - check `max` and `min` on `null_rate_max`, `regex_match_rate_min` and `reference_row_match_min`;
    - judgment `passShare` and `failShare`.
  - These are also floats: `Criterion.weight`, `sealedChecks.weight`, `sealedChecksMaxWeight`, `rubric.passThreshold` and `aggregate.weightedScore` (measured).
- **Floats enter signed hashes.** No rate sits in EIP-712 typed data. Rates enter signatures through RFC 8785 canonical JSON, in `rulebookHash`, `policyHash`, `poolTermsHash` and `acceptanceHash` (measured, `packages/core/src/eip712.ts`, `canonical.ts`).
  - RFC 8785 requires ECMAScript number formatting (https://www.rfc-editor.org/rfc/rfc8785).
  - Python's `json.dumps` prints `1.0` and `1e-07` where ECMAScript prints `1` and `1e-7` (measured).
  - The club example has `sellerCompensationRate: 1.0`, so a naive Python operator computes a different `rulebookHash` (inferred).
  - Integers below 2^53 print the same in every language, and `parse.ts` already refuses unsafe integers (measured).
- **Floats break a threshold today.** 0.667 × 3 = 2.0010000000000003, so 2 of 3 passes escalates instead of accepting. The docs say "≥ 2/3" (measured, T-008 `aggregate.ts` and its pinned test). At 0.5, the accept test runs first, so a 2–2 split accepts (measured).
- **The chain has no floats.** "Fixed point numbers are not fully supported by Solidity yet", and division rounds toward zero (https://docs.soliditylang.org/en/latest/types.html). Bonds move on chain in Phase 2 (T-202), so every rate must be exact there (inferred).
- **The money lint already bans floats** under `packages/core/src/money` (measured, `eslint.config.js`, `money/lint.test.ts`). Today `state.ts` pushes "price × appealBondRate" to the caller, to keep floats out of money code (measured).
- **The spec mixes conventions.** v0.5 already adds `adjudicatorFeeShareAfterDeliveryBps` as an integer from 0 to 10000 (measured).
- **Now is the cheap moment.** v0.5 already changes every hash. Changing rates later needs another version bump (inferred).

**Prior art:**
- **Uniswap v3** stores fees as a `uint24` "in hundredths of a bip" (https://github.com/Uniswap/v3-core/blob/main/contracts/interfaces/pool/IUniswapV3PoolImmutables.sol).
- **Aave** uses `PERCENTAGE_FACTOR = 1e4`, with WAD and RAY only for interest math (https://github.com/aave/aave-v3-core/blob/master/contracts/protocol/libraries/math/PercentageMath.sol).
- **Compound** uses a 1e18 mantissa (https://github.com/compound-finance/compound-protocol/blob/master/contracts/ExponentialNoError.sol).
- **ERC-2981** returns an absolute amount, so there is no dispute over what is owed (https://eips.ethereum.org/EIPS/eip-2981). OpenZeppelin's fee denominator is 10000 basis points (https://docs.openzeppelin.com/contracts/5.x/api/token/common).
- **Commerce Payments Protocol** uses `minFeeBps` and `maxFeeBps` (ADR-0003, `docs/research/prior-art.md`).
- **Stripe** takes `application_fee_percent` as a decimal with at most two places, and `application_fee_amount` as an integer in the smallest unit (https://docs.stripe.com/api/payment_intents/create).
- **FIX and ISO 20022** use decimal percentages (https://orchimate.org/fixtrading/fix-latest/datatypes; ISO 20022 guessed). Neither format hashes its numbers.

## Decision

### Types

- **`Bps`:** an integer from 0 to 10000. Every money rate and statistical rate uses it, and each field name ends in `Bps` so that an agent never reads 500 as 500%. The renamed fields are:
  - `appealBondRateBps`, `windowCoverageRatioBps`, `sellerCompensationRateBps`, `buyerCompensationRateBps` and `firstLossShareMinBps`;
  - `capitalChargeRateBps`, `capitalChargeToPoolRateBps` and `firstLossShareBps`;
  - `falseAcceptRateBps`, `falseRejectRateBps` and `escalationRateBps`;
  - on checks, `maxBps` and `minBps`.

  `adjudicatorFeeShareAfterDeliveryBps` already follows this form.
- **`Fraction`:** `{ numerator, denominator }`, with `numerator` an integer of 0 or more and `denominator` an integer from 1 to 100. The parser enforces `numerator ≤ denominator`. `acceptSupermajority` and `rejectSupermajority` use it, written for example as `{ "numerator": 2, "denominator": 3 }`. Basis points alone cannot express 2/3: 2 × 10000 ≥ 6667 × 3 is false.
- **Weights and scores:**
  - `Criterion.weight` is an integer from 1 to 10000, relative to the other criteria.
  - `sealedChecks.weight` and `sealedChecksMaxWeight` are `Bps`, capped at 3000.
  - `rubric.passThreshold` and `aggregate.weightedScore` are integers in hundredths, from 0 to 400.
- **Judgment record:** `passCount`, `failCount` and `validCount` replace `passShare` and `failShare`.

### Threshold semantics

- **Inclusive cross-multiplication.** Accept when `passCount × denominator ≥ numerator × validCount`. The same form applies to reject. This matches the docs' "≥ 2/3" and Ethereum's `balance * 3 >= total * 2` (https://eth2book.info/capella/part3/transition/epoch/).
- **A floor above one half.** A policy must satisfy `2 × numerator > denominator`. Then the pass share and the fail share cannot both qualify, so the order of the branches does not matter.
- **Ties escalate.** Accepting also requires `passCount > failCount`, and rejecting requires `failCount > passCount`. Anything else escalates, as Kleros returns "refuse to arbitrate" on a tie.

### Rounding (conservation by construction)

1. **Requirements round up.** The coverage gate, the appeal bond and the first-loss gate use `ceil(amount × bps / 10000)`. The payer covers the extra unit, so no gate is ever under-covered.
2. **Splits of one pot round the rate side down, and the remainder goes to a named party.**

   | Split | Rate side (rounded down) | Remainder goes to |
   | --- | --- | --- |
   | Fee share | adjudicator | buyer |
   | Capital charge | pool | adjudicator |
   | Pro rata to backers | each backer | junior tranche |

   Only one side is ever rounded.
3. **Payouts from a bond round down.** `price × compensationBps / 10000` is floored, and the bond keeps the dust.
4. **Thresholds cross-multiply and never divide.** For example:
   - `nulls × 10000 ≤ maxBps × rows`;
   - `passCount × denominator ≥ numerator × validCount`;
   - `Σ(weight × score) × 100 ≥ passThreshold × Σweight`.
5. **Solidity mirrors rules 1 to 3** with `mulDiv` and explicit rounding direction (inferred).

### Code

- **Core money helpers:** `mulBps(amount, bps, 'floor' | 'ceil')` and `splitBps(pot, bps)`, which returns the share and the remainder. A property test checks that the share plus the remainder always equals the pot.
- **The no-fraction lint widens** from `packages/core/src/money` to all of `packages/core/src` and `packages/judgment/src/aggregate.ts`.
- **Typed data is unchanged.** No rate is in the EIP-712 structs, and v0.5 already regenerates every pin.

## Alternatives considered

- **A. Basis points everywhere, thresholds included.** Exact, stable in hashes and native to Solidity, but it cannot express 2/3. 6666 bps works as a stand-in only for panels under 5000 judges (inferred), and it misstates the rule.
- **B. Higher-precision integers (ppm or 1e18 WAD).**
  - Holdback's rates run from 2% to 100%, so ppm adds nothing.
  - WAD breaks the 2^53 rule: 0.05 at 1e18 is 5e16, above 2^53.
- **C. Basis points for rates, fractions for thresholds (chosen).** It keeps all of A, and the rule reads as the docs write it ("≥ 2/3", "≥ 4/5").
- **D. Keep floats and define rounding.** Floats stay inside signed hashes, so the cross-language hash problem remains. A float-to-integer step is still needed before Solidity, and the money lint still blocks floats.

## Consequences

- **Schema v0.5 (PR 23):**
  - `common.Bps` and `common.Fraction` replace `Rate`;
  - every field listed above is renamed;
  - examples move:

    | Before | After |
    | --- | --- |
    | 0.667 | {2, 3} |
    | 0.05 | 500 |
    | 0.2 | 2000 |
    | 1.0 | 10000 |
    | 0.1 | 1000 |
    | 0.02 | 200 |
    | 0.97 | 9700 |
    | weights 0.4 / 0.4 / 0.2 | 40 / 40 / 20 |
    | 3.0 | 300 |

  - the spec tests refuse 0.5 and 10001 for every `Bps` field, and refuse fractions at or below one half for thresholds;
  - the changelog records the change.
- **Core:** `types.ts` adds `Bps` and `Fraction`. `parse.ts` adds the fraction guard. `money/index.ts` gains `mulBps` and `splitBps`, with the conservation property test. The `state.ts` comment points to them.
- **T-006:** every rate multiplied by money uses `mulBps` or `splitBps` under rounding rules 1 to 3. A property test checks conservation across every posting.
- **T-008:**
  - `EPS` is dropped;
  - thresholds are fractions compared by cross-multiplication;
  - the weighted score is an integer;
  - the judgment record carries counts;
  - the tie guard is added;
  - checks cross-multiply;
  - test helpers move from 0.66 to {2, 3}.
- **Testkit and fixtures:** stub values change, and the hash lines in `_example` regenerate after review.
- **Fixtures:**
  - `error.policy-threshold-too-low`: a policy at or below one half is refused;
  - an aggregation property that accept and reject never both hold;
  - "a 2–2 split escalates";
  - "a 4/5 appeal: 3 of 5 escalates, 4 accepts".
- **Docs:**
  - the `CLAUDE.md` money rule gains "Rates are integers: basis points or a numerator/denominator pair. No float in any hashed body";
  - `docs/team.md` gains its check row;
  - the `docs/architecture.md` invariants note the rounding and the remainder claimants;
  - `docs/judgment-and-defenses.md` names the fraction fields and the tie rule;
  - the ADR-0014 defaults are written in bps.

## Residual

- **A club can still write `{667, 1000}`.** That recreates the 0.667 problem. The denominator cap of 100 and the documented examples limit it (inferred).
- **Basis-point resolution (0.01%)** is enough for quality metrics at sample sizes up to about 10^4 (inferred).

## Litmus tests

- **Neutrality:** passes, and is strengthened. Every operator computes the same hash for the same rulebook and policy, in any language, so no node can disagree about what was signed.
- **The hold:** passes, and is strengthened. The rounding rules make conservation hold by construction, and no gate is ever under-covered.
- **Defended judgment:** passes, and is strengthened. A 2-of-3 panel accepts as documented, a tie escalates instead of accepting, and accept and reject can never both hold.
