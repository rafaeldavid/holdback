# T-012: Demo data and scripted buyer/seller agents

- **Lane:** demo
- **Phase:** 1
- **Depends on:** T-007, T-009 (the data generator can start after T-004)
- **Paths this task may touch:** `apps/demo/agents/`, `fixtures/data/`, `fixtures/clubs/`, `fixtures/terms/`, `scripts/gen-demo-data.ts`
- **Human gate:** no
- **Status:** review (agents, club and terms; Bench registrations and the panel wait on T-009)
- **Agent/session:** implementer; branch `t-012-demo-data` (data generator part, merged), branch `t-012-demo-agents` (club, terms, agents)

## Intent

Produce the dataset-cleaning job materials and scripted agents that drive each beat through the SDK.

Restated (data generator part, started after T-004 as the task allows):

- Give the demo a real, reproducible dataset for the Atlas Research / Tidewater Data job: the buyer's dirty customer CSV, an honest cleaned CSV that passes the job's deterministic checks, and cleaned CSVs with one flaw each for the error beats (dropped rows, duplicate keys, bad dates, a missing column, blank-looking cells, and Unicode tag characters for the ADR-0021 beat).
- Everything comes from a seed through `scripts/gen-demo-data.ts`: same seed, same bytes, no network, no wall clock. The clean file is about 0.5 MB, the size the demo's $2,000 job implies.
- Tests prove determinism and prove which declarative checks each file passes or fails, evaluated by `@holdback/judgment`'s check registry.
- Non-goals now: no files in `fixtures/clubs/` or `fixtures/terms/` (the T-005 stub refuses a scenario whose named club or terms file exists, until T-006 loads them; drafted below), no `apps/demo/agents/` (needs T-007 and T-009), no adversarial injection deliverables or panel-borderline file (honest parties first; in `docs/backlog.md`).

Restated (agents part, after T-006 and T-007 merged; T-009 still in PR 37):

- Land the drafted club and terms as files SimChain's genesis and the fixture driver load: `fixtures/clubs/data-services-v1.yaml`, `fixtures/terms/clean-customers-2000.yaml`, and a checks-only twin with an empty rubric for the ADR-0021 beat. `_example` must keep passing once these files exist, which means the testkit driver loads them instead of refusing.
- Scripted agents in `apps/demo/agents/`: Tidewater (seller) offers, encrypts and delivers the generated CSV with core crypto; Atlas (buyer) holds in one SDK call, waits for the outcome, opens the work and checks the plaintext hash; both co-sign a 70/30 split for beat 10. Calls go through the SDK to an operator over SimChain. Keys, clock and randomness come from the testkit context.
- The adjudicator is reached only through a narrow seam (`AdjudicatorSeam`), with a stand-in until T-009's service merges.
- Non-goals: the defended panel (T-009), beats 6 (injection half), 7, 8 and 9, adversarial agents, narration and the viewer (T-013), Bench registration files.

## Context

- `docs/demo.md` §Cast, §Beats.

## Acceptance criteria

- [ ] Seeded generator for a dirty customers CSV (duplicates, mixed date formats, invalid emails, nulls) and deliverables: good, row-drop (8%), panel-borderline, injection-plain, injection-base64, injection-unicode-tags. (Done except panel-borderline, injection-plain and injection-base64: backlog.)
- [x] Terms file for the $2,000 job with deterministic checks and three rubric criteria with anchors.
- [x] Scripted buyer and seller agents using only the SDK; each beat callable alone. (Beats 1, 2-4, 5, 6's ADR-0021 half and 10; the rest are in the backlog.)
- [ ] Club rulebook v1 (`fixtures/clubs/`, guaranteed mode only, `maxSubmissions` 1) and adjudicator registrations for Bench A/B/C with registry and policy hashes from T-009. (Club done; registrations wait on T-009.)

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
- **`pnpm verify` (measured, commit `91b523e`, clean tree):**

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 190 ms |
  | lint | `pnpm lint` | pass | 1615 ms |
  | test | `pnpm test` | fail | 16054 ms |
  | spec | `pnpm validate:spec` | pass | 338 ms |
  | snap | `pnpm snap` | pass | 684 ms |
  | demo | `pnpm demo` | placeholder | 118 ms |

  The one failing test is `packages/judgment/src/redteam.test.ts` K2, a wall-clock limit (`ms * scale < 60000`) from T-008. It failed 3 of 3 full runs with `tests/gen-demo-data.test.ts` excluded and passed when run alone (measured), so it is not caused by this branch; the machine was loaded by parallel agents (inferred). Every other test passes, 1,443 of 1,444 (measured).

### Club, terms and agents (2026-10-31, branch `t-012-demo-agents`)

- **Test first (measured):** `packages/testkit/src/fixture-files.test.ts` failed with a missing module before the loader existed; `apps/demo/agents/agents.test.ts` was committed alone in `3fda8d0` and failed with `Cannot find module './beats.js'`. After the code: 6 of 6 and 9 of 9 pass.
- **Club file (measured):** loads through `parseClub`; its rulebook equals `spec/examples/club.example.json`'s, and the computed `rulebookHash` is `0x140edd09…0d971e`. The example's own `rulebookHash` field (`0xb70959b8…a556`) does not match its rulebook (stale; it predates `payoutsTo`). Proposed check in `docs/team.md`.
- **Terms files (measured):** both build terms that `parseCommitment` accepts and that core `offer` accepts under the club rulebook. The checks-only file has an empty rubric (`criteria: []`, `passThreshold: 0`), which the v0.6 schema allows. Money as a YAML number, a fractional window, an unknown key, a written `rulebookHash` and a custom tag are each refused.
- **`_example` (measured):** the driver now loads the club and terms files. The fake recordings were re-recorded (`--judges fake --record --update`) because the real rubric and input change `rubricHash` and `inputHash`; the reviewed snapshot diff changes only the club and terms rows, the check list (now nine), the panel hashes and the chain head. Timeline, balances and terminal state are unchanged.
- **Beats (measured, seed 7, `agents.test.ts`):**

  | Beat | Final state | Atlas | Tidewater | Bench A balance | Notes |
  | --- | --- | --- | --- | --- | --- |
  | 1 hold | Held | 7,950 | 0 | 0 | one SDK call through op-1; Bench A reserves 2,000 of bond |
  | 2-4 clean CSV | Released | 7,950 | 2,000 | 50 | every check passes; Atlas's raw plaintext hashes to `sha256:1939b96f…87e5`; text equals the file; bond stays reserved until `appeal_expiry` after 300 s, then `finalAt` is set and the reservation is 0 |
  | 5 row-drop | Refunded | 9,950 | 0 | 50 | only `rows` fails; no key released to Atlas |
  | 6 (ADR-0021) hidden tags, checks-only terms | Released | 7,950 | 2,000 | 50 | raw hash is the hidden-tags file's; the screen is flagged with `unicode_tags`; the text Atlas's agent reads equals the clean file |
  | 10 70/30 split | Settled | 8,600 | 1,400 | 0 | Bench A never judges; reservation released; fee back to Atlas; Atlas opens the work |

  Amounts in tUSD. Atlas starts with 10,000; each bench has a 25,000 bond.
- **Determinism (measured):** two worlds with seed 7 give the same commitment ID, the same delivery (ciphertext, envelopes, signature) and the same SimChain digest; seed 8 gives another commitment. The context clock and SimChain's clock stay equal across `advance`.
- **Ciphertext is not plaintext (measured):** the stored ciphertext does not contain the first 64 bytes of the CSV; the delivery names Bench A, B, C and Atlas as envelope recipients, in that order.
- **Seam (measured):** a wrapper around `StandInBench` passed to `players()` is the only adjudicator the beat calls.
- **`pnpm verify` (measured, commit `9fbba8a`, clean tree):**

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 193 ms |
  | lint | `pnpm lint` | pass | 1762 ms |
  | test | `pnpm test` | pass | 16520 ms |
  | spec | `pnpm validate:spec` | pass | 268 ms |
  | snap | `pnpm snap` | pass | 648 ms |
  | demo | `pnpm demo` | placeholder | 107 ms |

  47 test files, 1,681 tests, all passing. `redteam.test.ts` K2 passed this run.
- **Speed (measured):** the 9 agent tests take about 2.8 s together, including starting two HTTP operators per world on 127.0.0.1.

## Decisions

- **Testkit lane touched (agents part).** The driver refused any scenario whose club or terms file existed, so landing the files would have failed `_example`. As briefed, the driver now loads them (`packages/testkit/src/fixture-files.ts`, small edits in `stub-settlement.ts`, `render.ts`, `runner.ts`) and the snapshot says "(loaded)". A named file that is absent still falls back to the stub; an invalid file fails the fixture. Policy and registry hashes stay the stub's until T-009.
- **The loader lives in `packages/testkit`,** which already parses fixture YAML, so the driver and the agents share it. SimChain itself takes `Club` objects in genesis and needed no change.
- **Terms files are templates:** relative windows (`deliverWithinSec` from `createdAt`, `judgeWithinSec` from `deliverBy`, `fallbackWithinSec` from `judgeBy`), plus `schemaVersion` and `clubId`; no parties, keys, nonces, `policyHash` or `registryHash`. Every load is validated as a full commitment.
- **`payoutsTo: any`** in the club, as D23 states for the demo club.
- **No `Fraction` in these files:** v0.6 uses `Fraction` only in adjudicator registrations, which wait on T-009.
- **Adjudicator through a seam, with a stand-in.** `AdjudicatorSeam` (`accept`, `judge`) is what the beats call. `StandInBench` does commit-reveal of a seed, opens its envelope, runs the terms' declarative checks with `@holdback/judgment`, rejects on any failed required check, and otherwise accepts with the key sealed to the buyer. With a non-empty rubric it accepts without a panel and its report says `not run (stand-in for T-009)`. It is not the defended pipeline and is not used by `pnpm snap`.
- **One-shot hold:** the seller's signed terms go to the bench and the buyer off-chain; the buyer's SDK call carries offer, acceptance, agreement and funding together.
- **Reads:** events through the SDK; released keys through the operator's `GET /v1/commitments/{id}/key` with `fetch`, because the SDK has no key read yet (backlog), falling back to SimChain.
- **Ciphertext store:** `MemoryCiphertextStore` from `@holdback/core/store`, addressed as `mem://ciphertext/sha256:…`, as T-009's test world does.
- **Wiring outside the listed paths:** `apps/demo/package.json` (workspace dependencies), root `tsconfig.json` (reference to `apps/demo/agents`, its own project, so `apps/demo/src` stays T-013's), `vitest.config.ts` (include `apps/demo/agents/**/*.test.ts`), `fixtures/README.md`, `docs/backlog.md`, `docs/team.md`.

### Data generator part

- **Paths outside the task's list.** Tests live in `tests/gen-demo-data.test.ts` because Vitest only collects `tests/`, `packages/*/src` and `apps/*/src`. Deferrals went to `docs/backlog.md` as briefed. Two rows in `docs/team.md` Rules and checks (drift check; no wall-clock assertions, proposed).
- **Files live in `fixtures/data/dataset-cleaning/`, not `fixtures/data/customers.cleaned.good.csv`.** `_example` names that path with `stub_bytes: true`, and the stub refuses a scenario whose stub-bytes file exists. Switching `_example` to the real file changes its input hash and so its recordings, which is the T-010 lane (Handoff).
- **Committed with `git add -f`.** The root `.gitignore` rule `data/` also matches `fixtures/data/`. The fixtures README says deliverables are generated and committed, and snap reads them from disk, so a fresh clone needs them without a generation step. The rule should be anchored as `/data/` (backlog; scaffold lane).
- **Checks reuse `@holdback/judgment`**, imported by relative path from `packages/judgment/src` because the root package does not depend on workspace packages. The checks themselves are declarative v0.5 objects in the test, validated against `commitment.schema.json#/$defs/DeterministicCheck`.
- **RNG is the testkit's splitmix64** (`packages/testkit/src/context.ts`), imported by path; it has only a type import, so Node 22 type stripping runs it directly.
- **Exact counts, not rates**, for every defect, so each file sits at a fixed distance from each threshold for any seed.
- **Invalid emails are kept and flagged**, not blanked, to match the `no_fabrication` criterion ("missing emails flagged, not filled").
- **Thresholds added to the terms:** `null_rate_max` on `customer_id` (0 bps), `name` (100 bps) and `email` (200 bps). The spec example has none; without one, the blank-cells beat has nothing to fail.

## Handoff

**Done (club, terms, agents; branch `t-012-demo-agents`):** `fixtures/clubs/data-services-v1.yaml`; `fixtures/terms/clean-customers-2000.yaml` and `clean-customers-2000-checks-only.yaml`; the testkit loader and driver wiring; `apps/demo/agents/` (`world.ts`, `keys.ts`, `seller.ts`, `buyer.ts`, `bench.ts`, `beats.ts`, `agents.test.ts`). Run one beat with `createDemoWorld({ seed })` and `beatHappyPath`, `beatBadWork`, `beatHiddenTags`, `beatMutualSplit` or `beatHold`; close the world afterwards (it runs two operators).

**Not done (backlog, source T-012):** Bench A/B/C registrations; T-009's adjudicator behind `AdjudicatorSeam`; beats 6 (injection half), 7, 8 and 9; injection and panel-borderline deliverables; an SDK key read; adversarial agents.

**For other lanes:**

- T-013 (demo CLI): import the beats from `apps/demo/agents/beats.ts`. Each returns the commitment, delivery facts, outcome, checks, what Atlas opened and the relaying operator per call. `pnpm demo` is still a placeholder.
- T-009: implement `AdjudicatorSeam` (`apps/demo/agents/bench.ts`) over the adjudicator service and pass it to `players(world, bench)`. The terms take `policyHash` and `registryHash` from the seam.
- T-010: `_example` still delivers stub bytes; point it at `data/dataset-cleaning/customers.clean.csv` and re-record.
- Spec lane: `spec/examples/club.example.json`'s `rulebookHash` does not match its rulebook (computed `0x140edd090559cb7dd3950b3a8b755b9cca7b81a37d11359738e1b9df7d0d971e`). Fixing it is a spec example change.

**Done (data generator):** `scripts/gen-demo-data.ts`, `fixtures/data/dataset-cleaning/` (8 CSVs and a manifest, seed 2000), `tests/gen-demo-data.test.ts`. Regenerate with `node scripts/gen-demo-data.ts`; check drift with `--check`.

**Not done:** scripted agents (`apps/demo/agents/`, after T-007 and T-009); club, terms and adjudicator files (after T-006 loads them; drafts below); injection-plain, injection-base64 and panel-borderline deliverables; a change-log notes file for the `notes` criterion. All are in `docs/backlog.md` under "Demo data and agents".

**For other lanes:**

- T-010 (scenarios): point `_example`'s `deliver` at `data/dataset-cleaning/customers.clean.csv`, drop `stub_bytes`, and re-record (`pnpm snap --judges fake --record --update _example`) once the club and terms files land.
- T-008 lane: `packages/judgment/src/redteam.test.ts` K2 asserts on `performance.now()`. It failed 3 of 3 full `pnpm test` runs here, with or without the new test, and passed alone (measured). Proposed check in `docs/team.md`.
- Scaffold: anchor `.gitignore`'s `data/` as `/data/`.

The two drafts below landed as files on `t-012-demo-agents` (schema v0.6, with `payoutsTo: any`, `schemaVersion` and `clubId` added); the files are now the source of truth, and the v0.6 rubric does allow zero criteria.

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
