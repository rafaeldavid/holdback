# T-217: drand quicknet proofs for fallback and appeal decisions on Sepolia

- **Lane:** judgment (with core, for the round arithmetic and the parse rule)
- **Phase:** 2
- **Depends on:** T-209 (the drand verifier in `HoldbackRules`); T-210 merged first (this task edits `packages/core/src/state.ts`, which T-210 changes, though not `beaconRoundFor` itself; PR 173); T-211 merged first (this task edits the beacon lines of `apps/adjudicator/src/service.ts`, which T-211 changes)
- **Paths this task may touch:** `apps/adjudicator/src/drand.ts` (new) and its test; `apps/adjudicator/src/randomness.ts`, `simchain-adapter.ts`, `settlement-port.ts` (the `randomness` port), `test-adjudicator.ts` (how the demo's adjudicators get their source), `_sim.ts` (only if the sim settlement needs the per-source round), `index.ts` (the export), and their tests; `apps/adjudicator/src/service.ts` and `service.test.ts` (only the beacon round and value in `#preflight`); `apps/adjudicator/scripts/mutants.mjs` (mutants for the new source); `apps/adjudicator/package.json` and `pnpm-lock.yaml` (a pinned BLS library, if none is a dependency yet); `packages/core/src/beacon.ts`, `parse.ts` and `state.ts` (only `beaconRoundFor`, its round helper, and keeping the commitment's randomness source in the state), and their tests; `fixtures/beacon/` (more recorded rounds and relay answers); one new test file under `packages/settlement/evm/` (the fork test, below; no edits to existing files there, which T-218 owns); `docs/decisions/ADR-0018-panel-seed-beacon.md` (a dated note); `docs/backlog.md` (its two drand rows); `docs/plan.md` (this row, and the `neutrality.beacon-relay-refuses` row of the scenario index); this file
- **Human gate:** no. Switching the live demo's rulebook to drand is T-220's deploy.
- **Status:** done (PR 186)
- **Agent/session:** Claude Code session on branch `t-217-drand-proofs` (2026-11-04)

## Intent

On Sepolia no fallback or appeal adjudicator can decide today. The rules contract verifies a drand quicknet proof for their panel seeds (T-209), but the adjudicator service reads only the SimChain beacon, core counts rounds on SimChain's clock, and the parse rule admits only `sim`. So a silent primary ends in the default outcome, and no appeal decides on Sepolia (ADR-0028 §11, D43).

Restated: give the adjudicator service a `drand-quicknet` randomness source that fetches the round settlement fixes, checks it locally, and never signs with anything else. Make core count rounds on the clock of the source the commitment's rulebook names, and admit `drand-quicknet` wherever the settlement is a chain that verifies it. SimChain and every existing fixture stay on `sim`, unchanged.

The design is in the research pass, `docs/research/2026-11-03-sepolia-demo-settlement.md` §7: relays, their order, the endpoint, the local check, what "not yet" looks like, and the rule that nothing substitutes.

**In the implementer's words (2026-11-04).** A fallback or appeal panel's seed comes from one beacon round that settlement state fixes. On Sepolia that round is a drand quicknet round, proven by a 48-byte BLS signature that the rules contract checks. This task makes the off-chain side agree with the contract:
1. **Core counts the right clock.** The offer keeps the rulebook's `randomness.source` in the escrow state, and `beaconRoundFor` reads the round on that source's clock: quicknet (genesis 1692803367, 3 s) or the sim beacon (round = unix second). Every existing state, fixture and snapshot stays on `sim` and does not change. A state saved before this change has no source and reads as `sim`.
2. **The adjudicator fetches and proves the round.** A new `drand-quicknet` source asks the relays in order for that exact round, never for `latest` (round 0 answers `latest`, measured), and checks each answer against the quicknet public key before it returns it. The value is sha256 of the signature, never the relay's `randomness`. The service checks the proof again before it signs, and puts the round, value and signature in the Decision.
3. **Nothing substitutes.** No relay answers, or none proves the round: the service does not decide this pass and tries again at the next, until the deadline; then the default path applies. It never falls back to the sim beacon, another round or a supplied value.
4. **The parse rule admits `drand-quicknet`.** A rulebook may name it (with quicknet's chain hash if it gives one), and a Decision may carry it with a well-formed proof. SimChain cannot produce sha256(signature) values, so it never accepts a drand-labelled decision.

Non-goals: the Sepolia world's rulebook switch (T-220, without a fresh world if D49's research finds a way), the anvil harness's sim beacon, mixing the beacon into the primary's seed, tlock envelopes, schema changes (none are needed: the Decision's `beacon` already has `signature`), and any edit to `packages/settlement/` or `apps/demo-cloud/` (T-218's lanes).

One path change, recorded in Decisions: the Sepolia fork test lives in `apps/adjudicator/src/`, not `packages/settlement/evm/`. It runs the adjudicator service, and `@holdback/settlement` cannot import `@holdback/adjudicator` (that package already depends on it, and `tsc -b` typechecks test files).

## Context

- ADR-0018 (the beacon, §4 and §5; no substitute source), ADR-0028 §11, residual 10 in `docs/neutrality.md` (the beacon unavailable for a whole window).
- T-209 (the verifier, its Handoff and decisions; decision 9 keeps SimChain on `sim`), `contracts/src/DrandQuicknetBeacon.sol` (the constants and `roundAt`), `fixtures/beacon/drand-quicknet.json` (seven real rounds).
- `packages/core/src/beacon.ts` (`DRAND_QUICKNET`, `SIM_BEACON`, `beaconRoundAt`), `packages/core/src/state.ts` (`beaconRoundFor`, `beaconSeed`), `packages/core/src/parse.ts:160,172`, `apps/adjudicator/src/randomness.ts`, `apps/adjudicator/src/service.ts` (`#preflight`).
- `docs/backlog.md`: "The parse rule still admits only `sim` beacons on a Decision" and "Sepolia: drand proofs for fallback and appeal decisions".

## Acceptance criteria

- [ ] **The source.** A `drand-quicknet` `RandomnessSource` (`apps/adjudicator/src/drand.ts`):
  - it computes the round and never asks a relay for `latest`;
  - it tries the relays in a configured order (default from the research: api2.drand.sh, drand.cloudflare.com, api.drand.sh, api3.drand.sh), with a 2 s timeout each;
  - it reads HTTP 425 and 404 as "not published yet";
  - it checks the chain hash.

  Its tests use recorded relay answers (`pnpm test` has no network).
- [ ] **A local check before signing.** The service verifies the round's signature against the quicknet public key (BLS on G1, RFC 9380 hash to curve, the DST in `DrandQuicknetBeacon.sol`). It recomputes `value` as sha256 of the signature and never takes the relay's `randomness`. Refused, with no decision signed: a tampered signature, a value that does not match, another round's answer, another chain's. Tested on the fixture's real rounds and on mutated copies. (A bad proof on chain burns up to 250,000 gas in the pairing check, research §7.)
- [ ] **No substitute.** When no relay answers, or none verifies, the service does not decide. It tries again at its next pass until the deadline, and the default path then applies (ADR-0018 §5, residual 10). Nothing stands in: not `prevrandao`, not another round's value, not a value an operator supplies. The plan's planned `neutrality.beacon-relay-refuses` becomes a named test, and its row in the plan's scenario index says so: one relay refuses or lies and the next is used; all refuse and no decision is signed.
- [ ] **Rounds per source.** Core's `beaconRoundFor` and the adjudicator's `roundFor` use the clock of the source the commitment's club rulebook names (`DRAND_QUICKNET` or `SIM_BEACON`). Suggested: keep that source in the state from the offer, so callers' signatures do not change. A test pins core's rounds for a `judgeBy` and for an escalation or filing time against `DrandQuicknetBeacon.roundAt`'s formula, at the boundaries (a time exactly on a round; a second before genesis). `pnpm snap` and `pnpm snap --settlement=local` pass with no snapshot diff.
- [ ] **The parse rule** (`packages/core/src/parse.ts`) admits `drand-quicknet` for a rulebook and a Decision's beacon when the settlement is a chain whose rules contract verifies it; SimChain keeps `sim` only (T-209 decision 9). A Decision carries `beacon {source, round, value, signature}`, which the schema already has. If a schema change turns out to be needed, stop: it needs an ADR and a version bump.
- [ ] **The source carries the proof.** `RandomnessSource.value` returns only a value today (`randomness.ts`), but a drand beacon needs its signature too. The schema requires `signature` for any source but `sim` (`messages.schema.json`, the Decision's `beacon`), and `encode.ts` passes it to `decide`. The port returns the round's value and signature, and the service puts both in the Decision.
- [ ] **The adapter and the demo's adjudicators.**
  - Today the adjudicator's settlement adapter fixes its source to `sim` and reads the settlement's sim beacon (`simchain-adapter.ts`), and the demo's adjudicators are built through `testAdjudicator` (`test-adjudicator.ts`), whose adapter is that one.
  - The adapter reads rounds from the drand source when the commitment's rulebook names `drand-quicknet`, and from the sim beacon otherwise. `testAdjudicator` takes the source as an option.
  - Passing it in the Sepolia world (`apps/demo-cloud/src/world.ts`) is T-220's, after T-218 and T-219: write the one-line change in the Handoff.
- [ ] **On a Sepolia fork,** in a new opt-in test file like T-213's fork test (it needs `SEPOLIA_FORK_RPC` and the network): on a fork of the 0.7 deployment (live since 2026-11-04, over the same `DrandQuicknetBeacon`), `decide` accepts a fallback decision and a party-appeal decision that the service builds from live quicknet rounds. A decision built from a bad proof is refused by the service before any transaction.
- [ ] **Inside a Worker:** one relay request per decision, so one external subrequest, within the Durable Object pass's limits (research §8) [measured in the fork test, or inferred from the code path and labelled so].
- [ ] **Docs.**
  - ADR-0018 gets a dated "as built" note: the source, the relay order, the local check.
  - The two drand rows in `docs/backlog.md` are closed or narrowed.
  - The text `site/llms.txt` needs once this is live (fallback and appeal now decide on Sepolia) goes in the Handoff, for T-220.
- [ ] **Review.** `reviewer` and `red-teamer`, each with project context (this changes a judgment defense: the seed of fallback and appeal panels). `pnpm verify` green.

## Out of scope

- The Sepolia world's rulebook switch, which goes with T-220's deploy. Rafa, 2026-11-04: keep today's world; T-220 switches the rulebook without a fresh world if D49's research finds a way.
- Mixing the beacon into the primary's seed (ADR-0018, not adopted).
- Time-locked envelopes with tlock (Phase 8).
- The anvil harness (`packages/settlement/evm/world.ts`), which keeps its sim beacon.

## Evidence

Branch `t-217-drand-proofs`, 2026-11-04. Each claim is labelled measured, inferred or guessed.

**Tests (no network).**
- Core: 18 files, 928 tests pass (`pnpm vitest run packages/core`). [measured] New: the quicknet constants pinned to `DrandQuicknetBeacon.sol`'s source; `beaconSource` kept through 19 paths, from the offer to every terminal state; the drand rounds at judgeBy, after an escalation and after a filing, against the contract's `roundAt` at the epoch, a second before genesis, genesis, and exactly on and a second before a round; a fallback seeded from the quicknet round settles and one seeded from the sim round is refused; the parse rule's admissions and refusals.
- Adjudicator: 7 files, 196 tests pass (`pnpm vitest run apps/adjudicator`). [measured] New:
  - `drand.test.ts`: the local check on T-209's seven real rounds, on 16 mutated copies (flipped bits and flags, another round, another chain, infinity, x = p, bad lengths, case and rounds) and on a real signature re-encoded with x + p; the source on recorded relay answers (`fixtures/beacon/drand-relays.json`, fetched 2026-11-04 from the four relays).
  - `service.test.ts`: the fallback, a party appeal and an escalation on quicknet rounds; the escalation's appeal waits from 10:00:32Z to 10:00:33Z, when its round is published, asking no relay early; four lying sources, each refused with no decision and no judge called; a drand commitment with no drand source is never decided.
  - `simchain-adapter.test.ts`: SimChain refuses the drand-proven decision ("the signed beacon differs from the settlement layer beacon") and the deal defaults.
- `neutrality.beacon-relay-refuses` is a named test in `drand.test.ts` (seven ways the first relay fails; all four refuse; all four lie) and `service.test.ts` (one refuses and the next lies: the third relay's proof settles; all fail: no decision, no judge, `FallbackJudging`, and the next pass decides once a relay answers). [measured]
- Typecheck `pnpm tsc -b` clean; ESLint clean on every changed file. [measured]

**On a Sepolia fork** (`apps/adjudicator/src/drand-fork.test.ts`, `SEPOLIA_FORK_RPC=https://ethereum-sepolia-rpc.publicnode.com`, anvil 1.0.0, Prague; 1 test passes in 119 s, run 7). [measured]
- The deployed 0.7 `HoldbackRules` (`0xF382…7cFA`) over the deployed `DrandQuicknetBeacon` (`0xBe80…Cc10`) accepted a fallback `decide` seeded from live quicknet round 33668067 and a party-appeal `decide` from round 33668070, the first round after the filing.
- One relay request per decision: `api2.drand.sh/…/public/33668067` and `…/33668070`, nothing else. [measured in Node; one external subrequest per decision inside a Worker is inferred from the same code path]
- A service whose source returns a tampered proof refused it (`seed_mismatch`), and no transaction was mined in the blocks from before it ran until two blocks after it refused.
- Gas on the fork, Prague pricing: `agreeAndFund` 251,142; `deliver` 83,523; `triggerFallback` 52,468; the fallback's `decide` 346,683; `fileAppeal` 102,878; the appeal's `decide` 238,576. Sepolia charges new state more (about 3.5 times, T-213), so these are lower bounds there. [measured on the fork; the Sepolia factor is T-213's]

**Cost of the local check:** about 18 ms of CPU per round (each `drand.test.ts` round test checks twice in 35 to 46 ms, Node 22 on this Mac). The service checks a drand proof twice per decision (the source, then before signing), about 36 ms. [measured]

**Mutation sweep** (`node apps/adjudicator/scripts/mutants.mjs drand`): 17 mutants, 17 killed. The `seed for the role` group (one row's search text updated for `got.value`) killed all 3, and the first 6 rows of the full sweep killed all 6. The full 84-mutant sweep takes about 105 minutes (75 s a mutant, measured on 8), so this task ran the groups it touches. [measured]

| Mutant (drand group) | Result |
| --- | --- |
| rounds counted on the sim clock whatever the source | killed (11 tests failed) |
| the service rounds on the sim clock for a drand commitment | killed (10) |
| the service signs a proof it did not check | killed (4) |
| the Decision drops the proof | killed (5) |
| the BLS pairing not checked | killed (8) |
| a non-canonical x (x ≥ p) accepted | killed (1) |
| the value taken from the relay, not sha256 of the signature | killed (1) |
| the answer's round not checked | killed (1) |
| round 0 asked, which answers the latest round | killed (1) |
| a round the clock has not reached is asked | killed (2) |
| no next relay after a refusal | killed (12) |
| a proven round asked again | killed (1) |
| no timeout per relay | killed (3) |
| another drand chain hash accepted | killed (1) |
| a missing drand source falls back to the sim beacon | killed (2) |
| the adapter reads the sim beacon for every commitment | killed (3) |
| testAdjudicator drops its drand source | killed (1) |

**`pnpm verify`** (`reports/verify-t-217-drand-proofs.md`, 2026-11-04, before the commit): PASS, no snapshot diff against HEAD, so `pnpm snap` and `pnpm snap --settlement=local` are unchanged. [measured]

| Step | Command | Status | Time |
| --- | --- | --- | --- |
| typecheck | `pnpm typecheck` | pass | 1587 ms |
| lint | `pnpm lint` | pass | 3910 ms |
| forge build | `forge build --root contracts` | pass | 389 ms |
| forge | `forge test --root contracts` | pass | 15539 ms |
| test | `pnpm test` | pass | 73458 ms |
| spec | `pnpm validate:spec` | pass | 611 ms |
| snap | `pnpm snap` | pass | 10935 ms |
| snap:local | `pnpm snap --settlement=local` | pass | 17273 ms |
| demo | `pnpm demo` | pass | 4172 ms |

**Review round 1 (PR 186, 2026-11-04).** [measured unless labelled]
- `reviewer`: ISSUES, nothing High or Critical (`reports/scratch/t217/review.md`). Medium: the curve library loaded at import in every importer of `@holdback/adjudicator`, the operators' Worker included, about 48 ms of CPU. Lows: the SimChain wording, the `llms.txt` text for party appeals, the fork test's request count logged and not asserted, the chain hash checked by `parseClub` only, a takeover triggered with no drand source. Infos: a parse comment that overclaimed, two log lines, redundant checks, stale doc lines.
- `red-teamer`: no Critical or High (`reports/scratch/t217/redteam.md`). Its differential test ran 147 signatures and 50 hash-to-G1 rounds through the local check and the deployed verifier's bytecode on anvil: no disagreement. Medium M1, the fallback's quicknet round is public up to 2 s before the primary's deadline; M2, a relay outage multiplied waits and requests across a pass; M3, an answer of any size was read whole (a 32 MB one, measured). Lows: L1 SimChain, L2 the chain hash, L3 a malformed relay URL.
- Rafa, 2026-11-04, mid-review: "Try to simplify the approach here, we don't need to boil the ocean instead we need something functional then add security issues to the security hardening phase." So this PR fixes what the functional path needs and moves every security finding to Phase 11 as T-223.
- Fixed in this PR: the curve library loads on first use (the reviewer's Medium, a deploy risk for the operators' Worker); the docs, the parse comment, two log lines and the `llms.txt` text are corrected; the fork test asserts that every relay request asks for the fixed round, and names anvil's error and the last pass's refusals when it fails.
- Moved to T-223 (Phase 11): red team M1 (the fallback's quicknet round is public before the primary's deadline; core and the contract change together, with a redeploy), M2 (an outage's cost to a pass), M3 (answer size), L1 (SimChain with a drand club), L2 (the chain hash in the offer), L3 (relay URLs), I1 (the rulebook's source against the deployed beacon), and the review's takeover without a source and cross-family review. A first hardening pass was written and then reverted to keep this change small; its tests, the red team's tests and both reports wait in the session notes (`t223-drand-hardening/`).
- Kept from the red team: `apps/adjudicator/src/drand-contract.redteam.test.ts`, the differential against the deployed verifier's bytecode (it passes; skipped without anvil and `forge build` output).
- After the changes: `pnpm vitest run packages/core apps/adjudicator` gives 26 files passed and 1 skipped, 1,127 tests passed and 1 skipped (the fork test); `pnpm tsc -b` and ESLint clean.
- After merging main (`21fa113`, with T-221's registration slice): `pnpm verify` PASS on all nine steps, including `snap:local`, with no snapshot diff against HEAD; core and adjudicator tests 1,148 passed, 1 skipped.
- Fork test after the fixes, over Tenderly's public gateway (`SEPOLIA_FORK_RPC=https://sepolia.gateway.tenderly.co`): passes in 133 s; fallback `decide` from round 33672321 (346,570 gas) and appeal `decide` from round 33672323 (238,441 gas), one relay request each. Two earlier attempts over publicnode failed in setup: its load balancer answered "block not found" for its own head and anvil exited (measured by hand); the test now prints anvil's error. One attempt over Tenderly timed out before the fallback decided, cause not recorded; the test now prints the last pass's refusals.

## Decisions

1. **Core keeps the rulebook's source in the escrow state.** `Base.beaconSource` is required in the type, so every state constructor carries it (the compiler found each), and a test runs 19 paths from a drand offer and checks it survives. At run time a state saved before T-217 (the EVM settlement's stored books) has none, and `beaconClockOf(undefined)` reads it as `sim`, which every earlier rulebook named. Callers of `beaconRoundFor` keep their signature, as the task suggested.
2. **The offer refuses a rulebook whose source has no clock** (`prevrandao`). Its rounds could never be counted or proven, so its fallback and appeal could never decide (ADR-0018 §5). This is a malformed-for-settlement refusal, not a restriction on a negotiable value (D31). The chain hash is checked by the parse rule only; checking it in the offer too is T-223.
3. **Core does not compare the Decision's `beacon.source` label with the state.** The rules contract hashes the label into the signature but does not check it; a core-only check would make the EVM mirror refuse a direct call the contract accepted (T-218's divergence check). The round and value bind the seed, and both are checked.
4. **The parse rule is context-free.** Operators parse messages without knowing the settlement, so parse admits `drand-quicknet` and refuses what no settlement could accept: another verifier (`prevrandao`), another chain hash, a signature that is not 48 bytes, a value that is not its sha256, round 0. SimChain refuses every drand-proven decision: its beacon fact is a sim value, which no sha256(signature) matches (tested). It is not "sim only" outright: a decision labelled `sim` and seeded from that sim value at the quicknet-numbered round settles there (review round 1, measured). No world loads a drand club into SimChain; the one-line fix in SimChain's beacon fact and refusing the club at genesis are T-223.
5. **The port hands out a source per commitment.** `AdjudicatorSettlement.randomness(commitment)` returns the source the rulebook names, or null; never another in its place. A source carries its `clock`, and `value(round)` returns `{ value, signature? }`, so the Decision carries the proof (`encode.ts` already passes it to `decide`).
6. **The service checks the proof again before signing,** whatever its source returned. A custom or faulty source cannot make it sign a proof that burns gas on chain. The cost is one more check, about 18 ms of CPU.
7. **Relay order and "not yet".** A 425 or 404 makes the source ask the next relay, since a lagging relay may say "not yet" for a published round. A round after its clock's latest is never asked for, so waiting for the appeal round costs no subrequest; a due round normally costs one. Proven rounds are kept (up to 256 per source), so retries ask no relay again.
8. **Canonical encodings only.** noble 1.9.1 reduces a compressed x modulo p; the contract refuses x ≥ p. The local check refuses it first, and a test re-encodes a real signature with x + p to prove it.
9. **`@noble/curves` pinned at 1.9.1,** the version already in the lockfile through viem, so nothing new is downloaded. T-209 checked its vectors with the same version.
10. **The fork test lives in `apps/adjudicator/src/`,** not `packages/settlement/evm/`: it runs the adjudicator service, and `@holdback/settlement` cannot import `@holdback/adjudicator` (a dependency cycle; `tsc -b` typechecks test files). It touches no T-218 file.
11. **The fork test shims one anvil bug.** anvil 1.0.0 cannot estimate a call whose calldata floor (EIP-7623) exceeds its execution gas; it answers "gas floor exceeds the gas limit", even for a plain 1,500-byte call (measured). `triggerFallback` is such a call. The test's JSON-RPC shim answers only that error, from `eth_call`: a revert stays a revert. Sepolia's own nodes estimate these calls.
12. **`testAdjudicator` exposes its `settlement`,** so a test can see which source it hands a commitment, and takes `drand` as an option.
13. **No schema change.** The Decision's `beacon` already has `signature`, and the rulebook already has `randomness.chainHash`.
14. **Functional first; security findings to Phase 11** (Rafa, 2026-11-04). The review's and red team's Medium and Low findings go to T-223 with their tests, so this change stays the functional path that T-216 and T-220 need. M1 could not land here anyway: core and `HoldbackRules` must change together, with a redeploy, or the EVM mirror would refuse what the contract accepts.
15. **The curve library loads on first use** (review round 1, Medium). `quicknetValue` is async and imports `@noble/curves/bls12-381` on its first call, so a Worker that imports `@holdback/adjudicator` and never checks a proof pays nothing at startup; the 48 ms land on the first check. A bundler keeps the module in the bundle and evaluates it lazily (inferred: esbuild's handling of a dynamic import with a literal specifier; T-220's deploy confirms it).

## Handoff

**State:** done: merged in PR 186 after CI and review. T-220 deploys; T-223 hardens.

**For T-220, the Sepolia world (`apps/demo-cloud/src/world.ts`, after T-218 and T-219):**
- The one-line change: pass the drand source to each demo adjudicator in the live world, `testAdjudicator({ …, ...(o.live ? { drand: drandQuicknet() } : {}) })`, with `drandQuicknet` from `@holdback/adjudicator`. In a Worker it uses the global `fetch`, one external subrequest per decision.
- The rulebook switch: `randomness: { source: 'drand-quicknet', chainHash: DRAND_QUICKNET_CHAIN_HASH }` from `@holdback/core`, for the live world only; SimChain worlds keep `sim`. It changes the rulebook hash. T-220 switches it without a fresh world if D49's research finds a way, for example several rulebook versions in one world (Rafa, 2026-11-04: "Yes, keep the world"). Do not change `WORLD_NAME` for it. A commitment already offered keeps the source its own rulebook named, since core reads it from the escrow state.
- `appealDecideSec` must leave at least 3 s for the first quicknet round after an escalation or filing; the demo's 60 s windows do.
- Until the M1 fix (T-223), have `prepare/offer` suggest a `judgeBy` on a quicknet round boundary, `(judgeBy − 1692803367) mod 3 = 0`, as an advisory default (D31), so the primary never sees the fallback's seed before its deadline.
- Measure `holdback-op1`'s startup CPU on the deploy: the curve library now loads on first use, so it should not move (inferred).
- Run the fork test before the deploy: `SEPOLIA_FORK_RPC=https://sepolia.gateway.tenderly.co pnpm vitest run apps/adjudicator/src/drand-fork.test.ts --silent=false` (about 2 minutes; publicnode's load balancer sometimes makes anvil exit at fork time).

**For T-220, `site/llms.txt` once it is live.** It replaces two lines; find them by their text, since line numbers move (on main of 2026-11-04 they were about lines 415 and 499):
- In "On Sepolia, an appeal needs your own test ETH", in place of the sentence that starts "Fallback and appeal adjudicators cannot prove their drand seed": "The appeal adjudicator decides once the first drand quicknet round after your appeal is published, within 3 s."
- In place of "Fallback and appeal wait for drand proofs": "**Fallback and appeal decide on Sepolia.** Their panels are seeded from a drand quicknet round that settlement fixes: the round at `judgeBy` for the fallback, the first round after the escalation or the appeal for the appeal adjudicator. The decision carries the round's BLS signature, and the rules contract verifies it. If no drand relay answers before a deadline, nothing stands in: a deal the fallback cannot decide takes its default outcome, an appeal after an escalation that is not decided does too, and a party appeal that is not decided expires and the first decision stands. Appeals and direct calls need your own Sepolia ETH."

**Follow-ups:**
- T-223 (Phase 11, `docs/tasks/T-223-drand-hardening.md`): every security finding of the review and red team, with their tests.
- `packages/settlement/evm` (T-218's lane, a backlog row): a simulate error that is not a revert (anvil's gas-floor estimate) throws out of `EvmSettlement.submit`, and so out of the adjudicator's whole pass. On Sepolia's nodes the estimate works, so this is inferred to matter only on anvil.
- `docs/neutrality.md` still lists `neutrality.beacon-relay-refuses` as planned (review): update it with T-220's docs pass.
