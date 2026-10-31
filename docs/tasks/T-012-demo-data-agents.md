# T-012: Demo data and scripted buyer/seller agents

- **Lane:** demo
- **Phase:** 1
- **Depends on:** T-007, T-009 (the data generator can start after T-004)
- **Paths this task may touch:** `apps/demo/agents/`, `fixtures/data/`, `fixtures/clubs/`, `fixtures/terms/`, `scripts/gen-demo-data.ts`
- **Human gate:** no
- **Status:** done
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
- The adjudicator is reached only through a narrow seam (`AdjudicatorSeam`); since T-009 merged, it is T-009's service with fake judges.
- Non-goals: live judges, beats 6 (injection half), 7, 8 and 9, adversarial agents, narration and the viewer (T-013).

## Context

- `docs/demo.md` §Cast, §Beats.

## Acceptance criteria

- [ ] Seeded generator for a dirty customers CSV (duplicates, mixed date formats, invalid emails, nulls) and deliverables: good, row-drop (8%), panel-borderline, injection-plain, injection-base64, injection-unicode-tags. (Done except panel-borderline, injection-plain and injection-base64: backlog.)
- [x] Terms file for the $2,000 job with deterministic checks and three rubric criteria with anchors.
- [x] Scripted buyer and seller agents using only the SDK; each beat callable alone. (Beats 1, 2-4, 5, 6's ADR-0021 half and 10; the rest are in the backlog.)
- [x] Club rulebook v1 (`fixtures/clubs/`, guaranteed mode only, `maxSubmissions` 1) and adjudicator registrations for Bench A/B/C with registry and policy hashes from T-009. (Registrations are built in code per seed, from T-009's `defaultPolicy` and `config/judges.yaml`, and validated against the schema; keys depend on the seed, so they are not static files.)

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
- **Club file (measured):** loads through `parseClub`; its rulebook equals `spec/examples/club.example.json`'s, and the computed `rulebookHash` is `0x140edd09…0d971e`. The example's own `rulebookHash` was stale (`0xb70959b8…a556`, predating `payoutsTo`); fixed in `cdb269a`, and `tests/spec.test.ts` now recomputes it (it failed before the fix, measured). The commitment and adjudicator examples have other stale derived hashes (measured: commitment `rulebookHash`, `id`; adjudicator `policyHash`, `poolTermsHash`); changing the commitment example breaks core's two pinned EIP-712 vectors (measured), so they are backlog.
- **Terms files (measured):** both build terms that `parseCommitment` accepts and that core `offer` accepts under the club rulebook. The checks-only file has an empty rubric (`criteria: []`, `passThreshold: 0`), which the v0.6 schema allows. Money as a YAML number, a fractional window, an unknown key, a written `rulebookHash` and a custom tag are each refused.
- **`_example` (measured):** the driver now loads the club and terms files. The fake recordings were re-recorded (`--judges fake --record --update`) because the real rubric and input change `rubricHash` and `inputHash`; the reviewed snapshot diff changes only the club and terms rows, the check list (now nine), the panel hashes and the chain head. Timeline, balances and terminal state are unchanged.
- **Beats with T-009's adjudicator service (measured, seed 7, `agents.test.ts`, after merging main at `2e0e5ae`):** Clearfield (Bench A), Northgate (B) and Atrium (C) are `Adjudicator` instances on the world's SimChain through `SettlementAdapter`, with fake judges over `config/judges.yaml`. No stand-in remains.

  | Beat | Final state | Ledger (Atlas) | Tide-7 (Tidewater) | Clearfield balance | What the record shows |
  | --- | --- | --- | --- | --- | --- |
  | 1 hold | Held | 7,950 | 0 | 0 | offer and agree-and-fund through op-1; Clearfield accepted from the event log and reserved 2,000 of bond |
  | 2-4 clean CSV | Released | 7,950 | 2,000 | 50 | all nine checks pass; screen clean; panel ran, commit-reveal seed: qwen-a, claude-a, claude-b (2 families, `placeholder-*-20260601` models), 3 of 3 pass, weighted score 400; each judge got a seeded sample (prompt about 121 KB, `drawn at random`), not the 512 KB file; Ledger's plaintext hash matches; bond released by `appeal_expiry` after 300 s, `finalAt` set |
  | 5 row-drop | Refunded | 9,950 | 0 | 50 | `rows` fails (8,740 rows; expected 9,400 to 9,600); panel did not run; no judge calls; no key to Ledger |
  | 6 (ADR-0021) hidden tags, checks-only terms | Released | 7,950 | 2,000 | 50 | screen flagged: `unicode_tags`, 111 tag characters removed; empty rubric, so no panel; accepted with "screen flagged" in the reasons; Ledger reads the clean file |
  | 10 70/30 split | Settled | 8,600 | 1,400 | 0 | Clearfield never judges; reservation released; fee back to Ledger |

  Amounts in tUSD. Ledger starts with 10,000; each bench has a 25,000 bond.
- **Registrations (measured):** all three parse against `adjudicator.schema.json` (names Clearfield Adjudication, Northgate Review, Atrium Appeals; registry hash of `config/judges.yaml`; pool from SimChain).
- **Determinism (measured):** two seed-7 worlds give the same commitment, delivery, judgment `recordHash` and settlement log except one field: the envelope Clearfield seals to Ledger in its decision, because T-009's service draws that ephemeral key from system randomness (backlog). Seed 8 gives another commitment. Context and SimChain clocks stay equal.
- **Ciphertext is not plaintext (measured):** the stored ciphertext does not contain the first 64 bytes of the CSV; envelopes go to Clearfield, Northgate, Atrium and Ledger, in that order.
- **Seam (measured):** a wrapper around the service bench passed as `benchA` is the only primary the beat calls.
- **`pnpm verify` (measured, commit `53a0d85`, clean tree):**

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 1119 ms |
  | lint | `pnpm lint` | pass | 2035 ms |
  | test | `pnpm test` | pass | 15686 ms |
  | spec | `pnpm validate:spec` | pass | 295 ms |
  | snap | `pnpm snap` | pass | 636 ms |
  | demo | `pnpm demo` | placeholder | 97 ms |

  55 test files, 1,784 tests, all passing; no snapshot diffs against HEAD.

## Decisions

- **Testkit lane touched (agents part).** The driver refused any scenario whose club or terms file existed, so landing the files would have failed `_example`. As briefed, the driver now loads them (`packages/testkit/src/fixture-files.ts`, small edits in `stub-settlement.ts`, `render.ts`, `runner.ts`) and the snapshot says "(loaded)". A named file that is absent still falls back to the stub; an invalid file fails the fixture. Policy and registry hashes stay the stub's until T-009.
- **The loader lives in `packages/testkit`,** which already parses fixture YAML, so the driver and the agents share it. SimChain itself takes `Club` objects in genesis and needed no change.
- **Terms files are templates:** relative windows (`deliverWithinSec` from `createdAt`, `judgeWithinSec` from `deliverBy`, `fallbackWithinSec` from `judgeBy`), plus `schemaVersion` and `clubId`; no parties, keys, nonces, `policyHash` or `registryHash`. Every load is validated as a full commitment.
- **`payoutsTo: any`** in the club, as D23 states for the demo club.
- **No `Fraction` in the club or terms files:** v0.6 uses it only in adjudicator registrations, which the benches build from `defaultPolicy` (2/3 supermajorities) and validate with `parseAdjudicator`.
- **Adjudicator: T-009's service behind `AdjudicatorSeam`** (`acceptOffers`, `judge`). `ServiceBench` wraps `Adjudicator` with `SettlementAdapter` over the world's SimChain, the world's ciphertext store, an in-memory record store and the registrations; judges are `fakeProvider` (honest passing verdicts, no models, no keys). The earlier checks-only stand-in was removed; no beat needs it. `apps/adjudicator/src/index.ts` now exports `SettlementAdapter`.
- **Recorded judges not used yet:** fake judges are deterministic and need no capture; recorded verdicts for the beats are a backlog item for when live capture is allowed.
- **No one-shot hold:** the service accepts only offers it finds on the settlement layer and submits its own acceptance, so the flow is offer (Tide-7 through op-1), acceptance (Clearfield, direct), then agree-and-fund in one call (Ledger through op-1). That one call still moves the $2,050.
- **Cast (`apps/demo/agents/cast.ts`):** display names only; key labels are unchanged, so no address or hash moved. Ledger's mandate now carries the published limits (5,000 tUSD per job, 20,000 per day). Kite Capital is named for narration; Phase 1 has no backer deposits.
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

**Done (club, terms, agents; branch `t-012-demo-agents`):** `fixtures/clubs/data-services-v1.yaml`; `fixtures/terms/clean-customers-2000.yaml` and `clean-customers-2000-checks-only.yaml`; the testkit loader and driver wiring; `apps/demo/agents/` (`cast.ts`, `world.ts`, `keys.ts`, `seller.ts`, `buyer.ts`, `bench.ts`, `beats.ts`, `agents.test.ts`), with T-009's adjudicator service for every beat; the club example's `rulebookHash` fix and its check. Run one beat with `createDemoWorld({ seed })` and `beatHappyPath`, `beatBadWork`, `beatHiddenTags`, `beatMutualSplit` or `beatHold`; close the world afterwards (it runs two operators).

**Not done (backlog, source T-012):** beats 6 (injection half), 7, 8 and 9; injection and panel-borderline deliverables; recorded verdicts for the beats; an SDK key read; an injectable random source in T-009's service; the remaining stale example hashes; adversarial agents.

**For other lanes:**

- T-013 (demo CLI): import the beats from `apps/demo/agents/beats.ts` and the names from `cast.ts` (`display.party`, `display.bench`). Each beat returns the commitment, delivery facts, outcome, Clearfield's signed judgment record (checks, screen, panel with models and seed, aggregate), the judge requests, what Ledger opened and the relaying operator per call. `pnpm demo` is still a placeholder.
- T-009: `AdjudicatorConfig` could take a random source for the buyer's key envelope so seeded transcripts replay exactly.
- T-010: `_example` still delivers stub bytes; point it at `data/dataset-cleaning/customers.clean.csv` and re-record.
- Spec lane: the commitment and adjudicator examples still carry stale derived hashes; core's EIP-712 vectors move with the commitment example.

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
