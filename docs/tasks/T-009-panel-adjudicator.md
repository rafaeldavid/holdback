# T-009: Providers, pinned registry, commit-reveal panel, adjudicator service

- **Lane:** judgment
- **Phase:** 1
- **Depends on:** T-008, T-006
- **Paths this task may touch:** `packages/judgment/providers/`, `apps/adjudicator/`, `config/judges.yaml`
- **Human gate:** yes (defenses)
- **Status:** done
- **Agent/session:** implementer, branch `t-009-panel-adjudicator`

## Intent

Turn the pipeline into a running adjudicator that selects a verifiable panel, calls pinned judges, signs decisions, and supports fallback and appeal.

Restated (implementer): build the part of the adjudicator that turns T-008's pipeline into a decision someone can check. Given a delivered commitment, the service opens the work with the key its role is entitled to, draws the panel from the registry the commitment binds using the seed for its role (the primary's committed seed, or a beacon seed for the fallback and appeal adjudicators), calls pinned judges through recorded, fake or live providers, publishes a signed judgment record and signs a Decision the settlement layer can verify. Anyone holding the seed, the registry and the plaintext can recompute who judged and what each judge saw.

Priority 1 (Rafa, through the coordinator): the demo's ~0.5 MB customer CSV must be judged and accepted, not escalated, so a large CSV is judged from a seeded, recomputable sample; escalation stays for inputs that cannot be sampled.

Non-goals: calibration and fees from metrics (Phase 3); live model calls in tests, CI or the recorded demo; handling dishonest parties beyond what the demo needs (honest parties until the demo works; deferrals go to `docs/backlog.md`); schema changes; the settlement layer itself (T-006).

## Context

- `docs/judgment-and-defenses.md` §Panel policy, §Model registry; ADR-0006, ADR-0007.

## Acceptance criteria

- [x] Providers: Anthropic, OpenAI-compatible, recorded, fake. Each verdict records provider, family, pinned model ID, prompt template hash, input hash, rubric hash, latency. (Live providers exist and refuse without keys; not exercised.)
- [x] Registry loader rejects aliases and non-active entries; `error.unpinned-model-refused` path. (The detail carries `unpinned-model-refused`; the scenario fixture itself is T-010's.)
- [x] Commit-reveal: commitment posted at agreement; seeded shuffle with family constraints over the registry named by `registryHash`; anyone can recompute (test); a registry that does not hash to `registryHash` is refused.
- [x] Panel seed fixed per (commitment, attempt); no re-roll (test).
- [x] The shuffle takes the seed for the decider's role (ADR-0018): the primary's revealed seed, or `keccak256(commitmentId ‖ role ‖ attempt ‖ beaconValue(round))` for the fallback and appeal adjudicators. The adjudicator service reads rounds through a `RandomnessSource` interface (`sim` now, `drand` later).
- [x] Adjudicator service: watches assignments, runs pipeline, signs Decision with judgment record hash, publishes record; acts as fallback or appeal adjudicator when assigned; appeal panel policy. (Against a port, with an adapter to T-006's SimChain; primary and fallback paths run end to end on SimChain.)
- [x] Policy binding: `policyHash` computed as keccak256 of the RFC 8785 canonical JSON of the adjudicator's policy; a judgment whose template hash or `policyHash` does not match the commitment is refused (`error.policy-hash-mismatch`). (Problem type `policy_mismatch`, detail prefixed `policy-hash-mismatch`.)
- [x] The adjudicator service signs `AdjudicatorAcceptance` (seed commitment, policy and registry hashes, fee, reserved bond) and publishes its registry hash and URI and its policy hash in its registration.
- [x] Fee quote stub returning policy minimum.
- [x] Appeal ground "missing or wrong key": the appeal decision may carry the key to the buyer.
- [x] Privacy (ADR-0020): fallback and appeal adjudicators unwrap the content and record keys only from envelopes released on takeover, never from the delivery. (Content key only: the record key is a Phase 2 private-record feature; backlog.)
- [x] Added by Rafa through the coordinator, priority 1: seeded, recomputable sampling so the demo's ~0.5 MB CSV is judged and accepted; unsampleable inputs still escalate.

## Out of scope

- Calibration harness, fee from metrics (Phase 3).

## Evidence

Labels: measured (M), inferred (I), guessed (G).

**Verify.** `pnpm verify` on a clean tree at `151bf96`, after the merge of main with T-006 and T-007 (`9dc461d`): typecheck, lint, test, spec and snap pass; demo is a placeholder (T-013). Report `reports/verify-t-009-panel-adjudicator.md` (M). Full suite: 1,763 tests in 53 files pass (M). ESLint also lints untracked scripts under `reports/`, so scratch `.mjs` files there fail verify (M).

**Demo deliverable (priority 1).**
- T-012's `fixtures/data/dataset-cleaning/customers.clean.csv` (511,912 bytes, 9,500 rows) runs through the service with the example commitment's checks: every required check passes, each judge sees a seeded sample under 130,000 characters, the decision is `accept` and the commitment is `Released` (M, `apps/adjudicator/src/service.test.ts`).
- With seeded sampling disabled (mutant), 8 adjudicator tests fail, the demo-file test among them (M).
- A synthetic 9,500-row CSV: the sample keeps the header, first 20 and last 20 rows, about 1,800 rows in all, every tenth of the file represented, rows in file order, within 100,000 characters; same seed gives the same prompt and inputHash; another seed draws different rows (M, `packages/judgment/src/sample.test.ts`).
- Bad rows every tenth row in the middle of the file: judges see more than 50 of them (M).
- Unsampleable inputs keep the even-stride sample and escalate: no seed, JSON, rows too wide to show 100 rows, an unterminated quote (M).

**Panel.**
- Over 300 seeds, every 3-seat panel has 3 distinct entries and at least 2 families and never seats a retired or candidate entry; over 100 seeds every 5-seat panel has 3 families (M).
- Over 600 seeds, each of 6 active entries is seated between 150 and 450 times (M).
- A third party recomputes the seats from the revealed seed, and the buyer recomputes every member's `inputHash` from the plaintext, seed and commitment (M).
- A failed submission is retried with the identical decision; the judges are called 3 times in total (M).

**Roles and keys.**
- Fallback: nothing before judgeBy; at judgeBy it triggers the fallback, decides with `beacon.round` = the round at judgeBy and `seed = panelSeed(...)`, and the case settles through core's `step` (M).
- A fallback with no released envelope refuses even though the delivery still lists one for it; no judge is called (M).
- An unpublished beacon round makes it wait (M).
- Escalation carries the appeal adjudicator's envelope; the appeal panel has 5 seats, 3 families and the appeal template hash; its round is the escalation's second plus one (M).
- "Missing or wrong key" appeal: accept with the key wrapped to the buyer, no judge called (M).
- Encodings match T-006 on main: `panelSeed` is core's own; `simBeacon` equals `SimChain.beacon` for three published rounds and both return null for the next round; `roundFor` equals core's `beaconRoundFor` for the fallback and an escalation (M, `randomness.test.ts`).

**On T-006's real SimChain** (`apps/adjudicator/src/simchain-adapter.test.ts`, through `SettlementAdapter`):
- The full path uses T-012's `customers.clean.csv` and the example commitment's checks. The seller signs the offer, the service finds it in the event log and accepts, and the buyer agrees and funds. The seller then seals the CSV to three adjudicators and the buyer; only the primary's envelope is released at delivery. The primary judges a seeded sample (3 judge calls, each prompt under 130,000 characters) and accepts. The state is `Released`, the seller's balance rises by exactly the price, and the published record that the decision binds says `accept`. The buyer unwraps the envelope from `keysFor` and recovers the CSV byte for byte. A second run makes no judge call (M).
- The fallback path, with a silent primary: before judgeBy the fallback has nothing to do. At judgeBy it triggers the takeover and receives one released envelope. Its decision carries the beacon round at judgeBy, SimChain accepts the seed through core, and the case settles as above. The primary then finds nothing to decide (M).
- Five adapter mutants are killed: primary given no envelope, fallback given no released key, no fallback task after takeover, offers not read from the log, acceptance submitted as a decision (M).
- After the T-006 merge, the 6 failing `_sim.ts` tests came from core's new rule: a fallback or appeal decision without a beacon fact is refused. The harness now supplies the fact from `beaconRoundFor`, as SimChain does, and all 48 adjudicator tests pass (M). The test file was written after the adapter, not before (M).

**Test first.**
- `sample.test.ts`, `panel.test.ts`, `providers.test.ts`, the appeal-template tests and `service.test.ts` were committed before their implementations (commit order in the PR) (M).
- The first four were run red before implementing: each failed to load its missing module (M). `service.test.ts` was not run red before `service.ts` existed (M). Two of its expectations were wrong at first (the intake error code, and the order of the key and beacon checks) and were corrected (M).

**Mutation checks** (`node packages/judgment/scripts/mutants.mjs <group>`, `node apps/adjudicator/scripts/mutants.mjs`), each run against the targeted test files:
- Seeded sampling: 13 mutants. 11 were killed on the first run; "no head rows" and "skip rows that do not fit" survived, the tests were strengthened, and both are now killed (M).
- Seat selection: 7 of 7 killed. Registry: 5 of 5 killed (M).
- Adjudicator service: 18 mutants. 16 were killed on the first run; "primary seed not bound to the commitment" and "registry hash not checked" survived and gained tests, and both are now killed (M).
- After the SimChain adapter (`bc8394f`), the adjudicator sweep is 34 of 34 killed, the five adapter mutants among them (M). The judgment package did not change in the T-006 merge, so its sweep was not re-run (M).
- After the review fixes, both full sweeps were run at `ff27fca` with no filter: adjudicator 29 of 29 killed, judgment (T-008 defenses plus T-009) 107 of 107 killed, none not applied (M). New adjudicator mutants cover the review items: appeal `minFamilies` and `minValid`, the `firstOutcome === 'accept'` condition, the store-mismatch retry, the released-key recipient check, the appeal-template hash check, the role in the decision nonce, the judged-record cache, the appeal registration preflight, the publication-failure catch, the buyer key preflight and the unopenable-key refusal (M).
- Two stopped sweeps had left mutants in WIP checkpoints (fixed in `0936df7` and `ae7d21f`). After the sweeps, every mutant's original text is present in the tree (M, checked by script). The scripts now journal the original file to `reports/mutant-inflight.json` and restore it on the next start (M: written; I: restore path not exercised by a real kill).

**Review fixes (no re-roll, keys, sampling).**
- A missing appeal-adjudicator registration and an invalid buyer key refuse with zero judge calls and no record; after the registration returns, the retry judges once (3 calls) (M).
- A failed record publication: 3 judge calls, no record; the retry publishes the same record, makes no new judge call and the decision binds that record's hash (M).
- A key the primary cannot unwrap: refused with `key_unwrap_failed`, no record and no decision; the fallback takes over at judgeBy and the case is `Released` (M).
- A CSV with one record costing more than maxChars / 100 is unsampleable; the cap is inclusive at exactly maxChars / 100 (M, `sample.test.ts`).

**Flake.** `redteam.test.ts` K2 (a wall-clock bound) failed twice under parallel load during this work and passed alone and in `pnpm verify` (M). It predates T-009 (I).

## Decisions

1. **Seeded sampling is for CSV only.** Header, first 20 and last 20 records, then records drawn uniformly without replacement (`keccak256(seed ‖ "sample-1" ‖ uint64 i) mod range`, partial Fisher-Yates) until the first drawn record that does not fit. Stopping at the first misfit avoids biasing toward short rows. Records split at line breaks outside quotes. Sampled CSV no longer escalates. JSON, text and markdown over the budget, CSV with an unterminated quote, and CSV with any record costing more than budget / `MIN_SAMPLED_ROWS` (100) characters keep the T-008 stride sample and escalate. The per-record cap means no record is too long to be drawn, so a sample always shows at least 99 data rows (or all of them), and a seller cannot hide content in one huge quoted field the sample would skip.
2. **One sample per judge,** from `keccak256(keccak256(seed ‖ commitmentId) ‖ "panel-1:sample:" ‖ judgeId)`, so the panel covers more of the file. The prompt note says it is a seeded sample and that the checks ran on the whole file.
3. **Nonces and criteria order are derived from the seed per judge,** not drawn from Web Crypto. The seller does not know the seed when it delivers, and afterwards anyone can recompute each `inputHash`. This closes the T-008 backlog item "inputHash recomputable by the buyer".
4. **Seat selection** walks a seeded shuffle of the active entries in id order. It seats an entry unless doing so would leave too few seats to reach the family minimum. The appeal minimum is `minFamiliesAppeal` where the registry has that many families, else `minFamilies`.
5. **Registry document:** `{version, judges[]}`. The hash is `canonicalKeccak` of the parsed document. Metrics are integer basis points (ADR-0022), and unknown keys are refused. Aliases are refused on every entry, retired ones too. YAML is parsed with merge keys off and unique keys on.
6. **Network and clock code live in the app.** The judgment package's source rules ban `fetch` and nondeterminism, so the live providers and the timeout and latency wrapper are in `apps/adjudicator/src/providers/`. Fake and recorded providers and the registry loader are in `packages/judgment/src/providers/`; the task listed `packages/judgment/providers/`, which is outside `src` and would not compile.
7. **Appeal thresholds** use the bound policy's fractions with `minValidAppeal` and `appealPanelSize`, because the schema has no appeal fractions. With 5 seats, 2/3 already needs 4 passes when all 5 are valid. The 4/5 in the docs table needs a schema field (backlog).
8. **Inconclusive appeal panel.** After a party appeal, the first decision stands (decided again with the same outcome). After an escalation, the record is published and no Decision is signed, so the default outcome applies at appealDecideBy, because core refuses `escalate` from the appeal role.
9. **Intake failures.** A plaintext that does not match its hash, a bad MIME, the wrong format or non-UTF-8 text is rejected without a panel. A key this adjudicator cannot open (`no_key_for_recipient`, `key_unwrap_failed`) is refused before anything is published: no record, no Decision. The fallback takes over at judgeBy with its own released envelope, or the default applies. (Earlier this escalated after publishing a record, which spent the escalation on a fault the seller may have caused.) A ciphertext that does not match the delivery hash is retried and never decided, because the store, not the seller, may be at fault.
10. **Record hash and signature.** `recordHash` is `canonicalKeccak` of the record without `recordHash`, `signature` and `recordUri`. `signature` is EIP-191 over the hash, because a judgment is not an EIP-712 type. The Decision binds the hash.
11. **The primary seed** is `keccak256(seedSecret ‖ "holdback.primary-seed.v1" ‖ commitmentId)`, with `seedSecret` from the environment. It survives restarts without a seed store. Decision and acceptance nonces are derived from the commitment, so a resubmission is identical.
12. **A "missing or wrong key" appeal** after an accept skips the panel: the ground is the key, not the work.
13. **Fallback and appeal adjudicators judge under the bound policy.** They use the primary's published policy object, checked against the bound hash and this build's template hashes and versions. They refuse when they cannot obtain it.
14. **Never re-roll after a post-panel failure.** Every check that can refuse a task (bound policy and registry, the buyer's key, the appeal adjudicator's registration and key, the released envelope, the beacon round) runs before any judge is called. The judged record is cached per (commitment, role, attempt) the moment the panel returns, so a retry after a failed record publication or submission only publishes, wraps and signs again (RFC 6979 signatures make the Decision identical). The cache is in memory (backlog: persistence).

## Handoff

**For Rafa.** Defense code (sampling changes what judges see). Under the 2026-10-31 autonomy rule this is pre-approved inside the repo; flagging it for overrule. Points to check: decisions 1, 2, 7, 8 and 13, recorded in `docs/decisions-today.md` under "T-009 judgment choices"; decisions 9 and 14 changed after review.

**T-006 seam (closed after T-006 merged).**
- `apps/adjudicator/src/settlement-port.ts` (`AdjudicatorSettlement`) is the contract the service codes against. `apps/adjudicator/src/simchain-adapter.ts` (`SettlementAdapter`) implements it on T-006's `Settlement` plus four SimChain reads the interface lacks (`now`, `beacon`, `escrowState`, `pool`; the `SettlementReads` type names them). A Phase 2 chain needs the same four reads.
  - Offers and tasks come from the event log (`commitment.offered` gives the signed terms) and `escrowState`. Envelopes come only from `keysFor(id, me)` (ADR-0020). The primary gets its released envelope in the delivery, and the fallback and appeal adjudicators get the last released one as `releasedKey`.
  - Submissions are `adjudicator_accept` and `decide`, with idempotency key `type:commitmentId:nonce`; `triggerFallback` is `trigger(id, 'fallback')`.
  - A party appeal on a settled case rebuilds the delivery from the `delivery.submitted` event and `deliverable.format`, because `Released` and `Refunded` states drop the delivery and the event omits the MIME type. Untested end to end: SimChain could add `plaintextMime` to that event.
- `panelSeed` is core's (re-exported from `randomness.ts`). `roundFor` stays: the service sees times, not states, and a test pins it to core's `beaconRoundFor`. `simBeacon` is pinned to `SimChain.beacon`.
- `apps/adjudicator/src/_sim.ts` stays as a unit-test harness on core's `step`. It skips agreement and funding, injects submission and store failures, and opens appeals directly. Core now checks the seeds from the beacon fact the harness supplies.
- The ciphertext store, record publication and the adjudicator registry are not in T-006's interface; the adapter takes them as options. T-007 or T-014 should own them.

**For T-010 (fixtures):** `error.unpinned-model-refused`, `error.policy-hash-mismatch` and `error.seed-mismatch` (fallback and appeal) can now be driven through the service. The demo-CSV accept path is ready for `happy-path`.

**For T-013 (demo):**
- Construct `Adjudicator` with `fakeProvider()` or `recordedProvider(recordings)`. `recorder()` captures recordings from the fake.
- `config/judges.yaml` holds placeholder pinned IDs (`placeholder-*-20260601`).
- Live mode composes `liveProvider` per provider with `routeByProvider` and `withTimeout(policy.judgeTimeoutSec * 1000)`.

**Outside my lane, not edited:**
- `docs/judgment-and-defenses.md` should describe seeded sampling (stage 3/4) and the per-judge seed derivations.
- `docs/team.md` Rules and checks could gain a row: "Seat selection, sampling and the adjudicator service are mutation-tested": `node packages/judgment/scripts/mutants.mjs "seeded sampling"` (and `"seat selection"`, `"registry"`) plus `node apps/adjudicator/scripts/mutants.mjs`, all killed today.
- The K2 flake: a wall-clock bound under parallel load. Proposed check: move K2's timing to a work-count assertion.

**Not done or not verified:**
- No `red-teamer` pass on sampling.
- On the real SimChain, only the primary-accept and fallback-takeover paths run end to end. Escalation, appeal and reject run only on the `_sim.ts` harness.
- The live providers have never made a call.
- Commits were not verified one by one; only the head was.
