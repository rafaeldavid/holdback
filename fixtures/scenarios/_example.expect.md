# _example

> Written by hand to show the format. The T-005 runner replaces this file with generated output.

## Input

| Field | Value |
| --- | --- |
| Pragmas | settlement=sim · judges=recorded · mode=guaranteed_on_decision · seed=7 |
| Club | data-services-v1 · rulebook 0x5c1f…a9 |
| Buyer | atlas-buyer 0x3b0e…71 |
| Seller | tidewater-seller 0x8d24…c0 |
| Terms | 0x1e7a…44 · price 2,000.000000 tUSD · fee 50.000000 tUSD |
| Adjudicators | primary bench-a · fallback bench-b · appeal bench-c |

## Timeline

| t (sim) | Actor | Call | Via | Result | State |
| --- | --- | --- | --- | --- | --- |
| 00:00.000 | tidewater-seller | offer | op-1 | ok | Offered |
| 00:00.010 | atlas-buyer | agree_and_fund | op-1 | ok | Held |
| 00:00.020 | tidewater-seller | deliver (attempt 1) | op-1 | ok | Delivered |
| 00:05.020 | bench-a | open judgment | direct | ok | Judging |
| 00:05.030 | bench-a | decide: accept | direct | ok | Accepted → Released |
| 00:05.030 | anyone | settle | op-1 | ok (no-op: mode guaranteed) | Released |
| 00:05.040 | atlas-buyer | fetch key + verify plaintext hash | op-1 | hash matches | Released |

## Balances (tUSD)

| After | atlas-buyer | escrow | tidewater-seller | bench-a (bond + fees) |
| --- | --- | --- | --- | --- |
| faucet | 10,000.000000 | 0 | 0 | 25,000.000000 |
| agree_and_fund | 7,950.000000 | 2,050.000000 | 0 | 25,000.000000 |
| decide: accept | 7,950.000000 | 0 | 2,000.000000 | 25,050.000000 |

## Judgment

- **Intake:** plaintext hash verified, text/csv, 598,112 bytes, normalized.
- **Deterministic checks:** cols ✓ · rows ✓ (9,512) · uniq ✓ · dates ✓ · emails ✓ (optional; 0.968).
- **Screen:** not flagged.
- **Panel:** commitment 0x9a4c…02 · seed 0x77e1…bd (recomputed: match)
  - claude-a · anthropic/claude · recorded:<pinned-model-id-1> · pass · scores 4/4/3
  - claude-b · anthropic/claude · recorded:<pinned-model-id-2> · pass · scores 4/4/3
  - fam2-a · openai-compatible/family-2 · recorded:<pinned-model-id-3> · pass · scores 4/4/4
- **Aggregate:** accept. Reasons: all required checks passed; 3/3 pass across 2 families; weighted score 3.8 ≥ 3.0.

## Receipts and log

- Events 0–12. Chain head 0xa3d9…5e. Replay matches the settlement state.
- Receipts signed by op-1: 4.

## Invariants

- Conservation ✓ · no negative balances ✓ · settled once ✓ · key released atomically with payment ✓
