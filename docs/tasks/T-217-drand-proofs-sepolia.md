# T-217: drand quicknet proofs for fallback and appeal decisions on Sepolia

- **Lane:** judgment (with core, for the round arithmetic and the parse rule)
- **Phase:** 2
- **Depends on:** T-209 (the drand verifier in `HoldbackRules`); T-210 merged first (this task edits `packages/core/src/state.ts`, which T-210 changes, though not `beaconRoundFor` itself; PR 173); T-211 merged first (this task edits the beacon lines of `apps/adjudicator/src/service.ts`, which T-211 changes)
- **Paths this task may touch:** `apps/adjudicator/src/drand.ts` (new) and its test; `apps/adjudicator/src/randomness.ts`, `simchain-adapter.ts`, `settlement-port.ts` (the `randomness` port), `test-adjudicator.ts` (how the demo's adjudicators get their source), `_sim.ts` (only if the sim settlement needs the per-source round), `index.ts` (the export), and their tests; `apps/adjudicator/src/service.ts` and `service.test.ts` (only the beacon round and value in `#preflight`); `apps/adjudicator/scripts/mutants.mjs` (mutants for the new source); `apps/adjudicator/package.json` and `pnpm-lock.yaml` (a pinned BLS library, if none is a dependency yet); `packages/core/src/beacon.ts`, `parse.ts` and `state.ts` (only `beaconRoundFor`, its round helper, and keeping the commitment's randomness source in the state), and their tests; `fixtures/beacon/` (more recorded rounds and relay answers); one new test file under `packages/settlement/evm/` (the fork test, below; no edits to existing files there, which T-218 owns); `docs/decisions/ADR-0018-panel-seed-beacon.md` (a dated note); `docs/backlog.md` (its two drand rows); `docs/plan.md` (this row, and the `neutrality.beacon-relay-refuses` row of the scenario index); this file
- **Human gate:** no. Switching the live demo's rulebook to drand is T-220's deploy.
- **Status:** todo
- **Agent/session:** —

## Intent

On Sepolia no fallback or appeal adjudicator can decide today. The rules contract verifies a drand quicknet proof for their panel seeds (T-209), but the adjudicator service reads only the SimChain beacon, core counts rounds on SimChain's clock, and the parse rule admits only `sim`. So a silent primary ends in the default outcome, and no appeal decides on Sepolia (ADR-0028 §11, D43).

Restated: give the adjudicator service a `drand-quicknet` randomness source that fetches the round settlement fixes, checks it locally, and never signs with anything else. Make core count rounds on the clock of the source the commitment's rulebook names, and admit `drand-quicknet` wherever the settlement is a chain that verifies it. SimChain and every existing fixture stay on `sim`, unchanged.

The design is in the research pass, `docs/research/2026-11-03-sepolia-demo-settlement.md` §7: relays, their order, the endpoint, the local check, what "not yet" looks like, and the rule that nothing substitutes.

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

- The Sepolia world's rulebook and the new world it needs: a rulebook change makes a fresh world, so it goes with T-220's deploy.
- Mixing the beacon into the primary's seed (ADR-0018, not adopted).
- Time-locked envelopes with tlock (Phase 8).
- The anvil harness (`packages/settlement/evm/world.ts`), which keeps its sim beacon.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
