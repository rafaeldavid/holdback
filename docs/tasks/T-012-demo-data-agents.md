# T-012: Demo data and scripted buyer/seller agents

- **Lane:** demo
- **Phase:** 1
- **Depends on:** T-007, T-009 (the data generator can start after T-004)
- **Paths this task may touch:** `apps/demo/agents/`, `fixtures/data/`, `fixtures/clubs/`, `fixtures/terms/`, `scripts/gen-demo-data.ts`
- **Human gate:** no
- **Status:** in progress (data generator in review; agents, club and terms wait on T-006, T-007, T-009)
- **Agent/session:** implementer, worktree `.worktrees/holdback-T-012`, branch `t-012-demo-data` (data generator part)

## Intent

Produce the dataset-cleaning job materials and scripted agents that drive each beat through the SDK.

Restated (data generator part, started after T-004 as the task allows):

- Give the demo a real, reproducible dataset for the Atlas Research / Tidewater Data job: the buyer's dirty customer CSV, an honest cleaned CSV that passes the job's deterministic checks, and cleaned CSVs with one flaw each for the error beats (dropped rows, duplicate keys, bad dates, a missing column, blank-looking cells, and Unicode tag characters for the ADR-0021 beat).
- Everything comes from a seed through `scripts/gen-demo-data.ts`: same seed, same bytes, no network, no wall clock. The clean file is about 0.5 MB, the size the demo's $2,000 job implies.
- Tests prove determinism and prove which declarative checks each file passes or fails, evaluated by `@holdback/judgment`'s check registry.
- Non-goals now: no files in `fixtures/clubs/` or `fixtures/terms/` (the T-005 stub refuses a scenario whose named club or terms file exists, until T-006 loads them; drafted below), no `apps/demo/agents/` (needs T-007 and T-009), no adversarial injection deliverables or panel-borderline file (honest parties first; in `docs/backlog.md`).

## Context

- `docs/demo.md` §Cast, §Beats.

## Acceptance criteria

- [ ] Seeded generator for a dirty customers CSV (duplicates, mixed date formats, invalid emails, nulls) and deliverables: good, row-drop (8%), panel-borderline, injection-plain, injection-base64, injection-unicode-tags.
- [ ] Terms file for the $2,000 job with deterministic checks and three rubric criteria with anchors.
- [ ] Scripted buyer and seller agents using only the SDK; each beat callable alone.
- [ ] Club rulebook v1 (`fixtures/clubs/`, guaranteed mode only, `maxSubmissions` 1) and adjudicator registrations for Bench A/B/C with registry and policy hashes from T-009.

## Out of scope

- LLM-driven agents (Phase 6).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

### Data generator (2026-10-31)

- **Test first (measured):** `tests/gen-demo-data.test.ts` committed alone in `8c548ec`; it failed with `Cannot find module '../scripts/gen-demo-data.ts'`. After the generator: 14 of 14 pass.
- **Determinism (measured):** two `generate(2000)` runs give identical bytes for all 9 files; seed 2001 gives a different clean file. `node scripts/gen-demo-data.ts --check` prints `9 files match the generator (seed 2000)`.
- **Generated files, seed 2000 (measured, `fixtures/data/dataset-cleaning/manifest.json`):**

  | File | Bytes | Rows | Fails (required checks) |
  | --- | --- | --- | --- |
  | `customers.raw.csv` | 705,630 | 10,020 | uniq, dates, emails (optional) and others; it is input, not a deliverable |
  | `customers.clean.csv` | 511,912 | 9,500 | none, including `hidden` (tag 0, bidi 0, total 0) |
  | `customers.clean.row-drop.csv` | 471,196 | 8,740 | rows |
  | `customers.clean.dup-keys.csv` | 511,912 | 9,500 | uniq |
  | `customers.clean.bad-dates.csv` | 511,912 | 9,500 | dates |
  | `customers.clean.missing-column.csv` | 464,191 | 9,500 | cols |
  | `customers.clean.blank-cells.csv` | 505,677 | 9,500 | email_nulls (plus optional emails) |
  | `customers.clean.hidden-tags.csv` | 512,356 | 9,500 | none of the demo checks; fails `hidden` |

  Clean file: 95 empty emails (100 bps), 114 invalid emails kept and flagged `email_valid=false` (pattern match 97.8%), 38 empty names (40 bps). Raw: 9,500 customers plus 520 stale or repeated copies (measured by construction; counts are exact, not probabilistic).
- **Blank-cells (measured):** the variant has exactly as many literally empty email cells as the clean file; only `null_rate_max`'s blank-looking rule catches it.
- **Hidden tags (measured):** removing U+E0000..U+E007F from the variant gives the clean file byte for byte; the decoded payload is an instruction to the buyer's agent.
- **Raw covers clean (measured):** the distinct raw customer IDs equal the clean IDs.
- **Size on disk (measured):** `fixtures/data` is 4.0 MB.
- **`pnpm verify` (measured):** see the table below.

## Decisions

- **Paths outside the task's list.** Tests live in `tests/gen-demo-data.test.ts` because Vitest only collects `tests/`, `packages/*/src` and `apps/*/src`. Deferrals went to `docs/backlog.md` as briefed. Two rows in `docs/team.md` Rules and checks (drift check; no wall-clock assertions, proposed).
- **Files live in `fixtures/data/dataset-cleaning/`, not `fixtures/data/customers.cleaned.good.csv`.** `_example` names that path with `stub_bytes: true`, and the stub refuses a scenario whose stub-bytes file exists. Switching `_example` to the real file changes its input hash and so its recordings, which is the T-010 lane (Handoff).
- **Committed with `git add -f`.** The root `.gitignore` rule `data/` also matches `fixtures/data/`. The fixtures README says deliverables are generated and committed, and snap reads them from disk, so a fresh clone needs them without a generation step. The rule should be anchored as `/data/` (backlog; scaffold lane).
- **Checks reuse `@holdback/judgment`**, imported by relative path from `packages/judgment/src` because the root package does not depend on workspace packages. The checks themselves are declarative v0.5 objects in the test, validated against `commitment.schema.json#/$defs/DeterministicCheck`.
- **RNG is the testkit's splitmix64** (`packages/testkit/src/context.ts`), imported by path; it has only a type import, so Node 22 type stripping runs it directly.
- **Exact counts, not rates**, for every defect, so each file sits at a fixed distance from each threshold for any seed.
- **Invalid emails are kept and flagged**, not blanked, to match the `no_fabrication` criterion ("missing emails flagged, not filled").
- **Thresholds added to the terms:** `null_rate_max` on `customer_id` (0 bps), `name` (100 bps) and `email` (200 bps). The spec example has none; without one, the blank-cells beat has nothing to fail.

## Handoff

**Done (data generator):** `scripts/gen-demo-data.ts`, `fixtures/data/dataset-cleaning/` (8 CSVs and a manifest, seed 2000), `tests/gen-demo-data.test.ts`. Regenerate with `node scripts/gen-demo-data.ts`; check drift with `--check`.

**Not done:** scripted agents (`apps/demo/agents/`, after T-007 and T-009); club, terms and adjudicator files (after T-006 loads them; drafts below); injection-plain, injection-base64 and panel-borderline deliverables; a change-log notes file for the `notes` criterion. All are in `docs/backlog.md` under "Demo data and agents".

**For other lanes:**

- T-010 (scenarios): point `_example`'s `deliver` at `data/dataset-cleaning/customers.clean.csv`, drop `stub_bytes`, and re-record (`pnpm snap --judges fake --record --update _example`) once the club and terms files land.
- T-008 lane: `packages/judgment/src/redteam.test.ts` K2 asserts on `performance.now()`. It failed 3 of 3 full `pnpm test` runs here, with or without the new test, and passed alone (measured). Proposed check in `docs/team.md`.
- Scaffold: anchor `.gitignore`'s `data/` as `/data/`.

**Draft `fixtures/clubs/data-services-v1.yaml`** (from `spec/examples/club.example.json`, schema v0.5; `rulebookHash` is computed by the loader, not written here):

```yaml
id: data-services-v1
name: Data Services Club
operator: "0xc189bbabd7b55343a731ed82c5f80b5e5e354e88"
rulebook:
  version: "1.0"
  open: true
  minWindowsSec: { judge: 120, fallback: 120, appealWindow: 300, appealDecide: 300 }
  windowCoverageRatioBps: 2000
  appealBondRateBps: 500
  sealedChecksMaxWeightBps: 3000
  maxSubmissions: 1
  defaultOutcome:
    judged: { refundBuyer: true, sellerCompensationRateBps: 10000 }
  allowedSettlementModes: [guaranteed_on_decision]
  allowedTokens: [tUSD]
  panelPolicyMin: { panelSize: 3, appealPanelSize: 5, minFamilies: 2 }
  appealFee: { token: tUSD, amount: "25000000" }
  firstLossShareMinBps: 1000
  bondNoticePeriodMinSec: 691200
  randomness: { source: sim }
  minInspectionWindowSec: 86400
  disputeBond: { token: tUSD, amount: "25000000" }
  mutualSettlement: { allowed: true, adjudicatorFeeShareAfterDeliveryBps: 0 }
  disclosureMin: public
  identityModes: [long-term]
```

**Draft `fixtures/terms/clean-customers-2000.yaml`** (commitment fields without parties, addresses or absolute times; `deliverWithinSec`-style relative windows are a proposal for the T-006 loader; `policyHash` and `registryHash` come from T-009):

```yaml
deliverable:
  kind: dataset
  description: "Clean customers.csv: deduplicate on customer_id keeping the most recent record, normalize signup_date to ISO 8601, validate email format, flag (do not fill) missing or invalid emails."
  format: text/csv
  inputs:
    - uri: file:///fixtures/data/dataset-cleaning/customers.raw.csv
      sha256: "sha256:67051d4c1ab2bc2f85dcfe39f63221615b9d41c5a029ddb6f719a3616bdb14d9"
acceptance:
  deterministicChecks:
    - { id: cols, type: csv_columns_exact, required: true, columns: [customer_id, name, email, signup_date, email_valid] }
    - { id: rows, type: row_count_range, required: true, min: 9400, max: 9600 }
    - { id: uniq, type: unique_key, required: true, columns: [customer_id] }
    - { id: dates, type: iso8601_date_column, required: true, column: signup_date }
    - { id: id_nulls, type: null_rate_max, required: true, column: customer_id, maxBps: 0 }
    - { id: name_nulls, type: null_rate_max, required: true, column: name, maxBps: 100 }
    - { id: email_nulls, type: null_rate_max, required: true, column: email, maxBps: 200 }
    - { id: emails, type: regex_match_rate_min, required: false, column: email, pattern: '^[^@\s]+@[^@\s]+\.[^@\s]+$', minBps: 9700 }
    - { id: hidden, type: hidden_characters_max, required: true, max: { tag: 0, bidi: 0, total: 0 } }
  rubric:
    passThreshold: 300
    criteria:
      - id: dedupe_quality
        description: Duplicates resolved by keeping the most recent complete record per customer_id.
        weight: 40
        anchors: { "0": No consistent rule, "2": Rule applied with some errors, "4": Rule applied consistently; sampled rows correct }
      - id: no_fabrication
        description: No values invented; missing emails flagged, not filled.
        weight: 40
        anchors: { "0": Fabricated values present, "2": Minor fills without flags, "4": No fabrication }
      - id: notes
        description: Change log explains rules applied.
        weight: 20
        anchors: { "0": Missing, "2": Partial, "4": Complete and accurate }
price: { token: tUSD, amount: "2000000000" }
adjudication:
  policyId: bench-a/p1
  fee: { token: tUSD, amount: "50000000" }
  # policyHash, registryHash: from T-009's registry
timing:
  offerExpiresInSec: 900
  fundWithinSec: 1800
  deliverWithinSec: 172800
  judgeWithinSec: 120
  fallbackWithinSec: 120
  appealWindowSec: 300
  appealDecideSec: 300
  maxSubmissions: 1
settlement: { mode: guaranteed_on_decision, token: tUSD }
remedy: { onReject: full_refund }
disclosure: { level: public }
```

The ADR-0021 beat needs a second terms file: the same checks without `hidden` and an empty rubric, so `customers.clean.hidden-tags.csv` is accepted without a panel. Whether the v0.5 rubric allows zero criteria is for the beat's author to confirm.

**Bench A/B/C registrations:** not drafted; they need T-009's registry and policy hashes.
