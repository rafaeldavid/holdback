# T-061: Usage simulation, the scripted tier: catalogue v2, per-PR worlds and the `simulate` check

- **Lane:** test (with infra for the inert workflow file)
- **Phase:** 10
- **Depends on:** T-034 merged (`scripts/ci/affected.mjs`, the path table); T-040 (`ops.yaml`'s loader); T-044 (`tiers.mjs`, `guardrails.mjs`). Reuses T-021 and T-023 (`tools/sim/`) and T-216's driver (`examples/e2e-run.ts`), all merged. The harness and `tools/sim/scripted.test.ts` depend on nothing unmerged; only the workflow, the tier rules and the required status need T-034, T-040, T-044 and T-050.
- **Paths this task may touch:** `tools/sim/catalogue.json`, `tools/sim/catalogue.schema.json` (new), `tools/sim/scripted.ts` (new), `tools/sim/stage.ts` (new), `tools/sim/sample.mjs` (new), `tools/sim/gate.mjs` (new), `tools/sim/scripted.test.ts` (new), `tools/sim/bin/scripted.ts` (new), `tools/sim/README.md`, `tools/sim/briefs/` (profile texts), `agent-ops/workflows/simulate.yml` (new, inert until T-050), `agent-ops/ops.yaml` (the `simulation` block and `tiers.2.paths`, only to match what this task builds; after T-040), `agent-ops/pipeline.md` and `agent-ops/gates.md` (only to correct the design text of 2026-11-05 to what this task builds), `scripts/ci/guardrails.mjs` (the `expect` rule; after T-044), `tests/agent-ops/simulate.test.ts` (new), root `package.json` (a `sim:scripted` script), `vitest.config.ts` (the cost table only), `docs/testing.md` (the Agent simulation row), `docs/tasks/T-061-usage-simulation-scripted-tier.md`
- **Human gate:** no. Making `simulate` a required status is T-050's step 2. A PR that touches `agent-ops/` is tier 3, so Rafa merges it.
- **Status:** todo
- **Agent/session:** —

## Intent

Rafa, 2026-11-05: "we should amend to include agent / customer usage simulation, with set of diverse needs informed by continous market feedback in staging environment pre-merge".

Restated: before a change merges, simulated customers play deals through the public HTTP API against a world built from the pull request, and each pairing must end where its expectation says. This task builds the deterministic half: the catalogue of customers, the per-PR worlds, the scripted parties and the CI check. T-062 adds model-driven customers and the market-feedback loop.

- **Inputs:** `tools/sim/catalogue.json` (version 1: 4 jobs, 4 profiles and 6 pairings, measured); the pull request's build; the path table from `affected.mjs`.
- **Outputs:** catalogue version 2 with its schema; `stage.ts`, which starts a per-PR world on SimChain, anvil or workerd; `scripted.ts`, which plays every pairing with `examples/agent.ts`, following each profile as a fixed script; `gate.mjs`, which compares results with expectations and with `main`'s timing baseline; and an inert `simulate.yml`.
- **Non-goals:** model-driven parties, other model families, the baseline store, the Sepolia staging world, the `catalogue` route and weights (all T-062); fixing what the simulation finds.

## Context

- The design: `docs/research/2026-11-05-simulation-and-watch.md`, sections 3.1 to 3.3, 3.5 (scripted tier), 3.7 and 3.8; `agent-ops/pipeline.md`, Usage simulation; `agent-ops/gates.md`, the `simulate` check and threat P17.
- `tools/sim/README.md` and `catalogue.json` (T-021); `world.ts` (`startSimWorld`, `publishSecrets: false`); `check.ts` (the five invariants of `sim:check`).
- `examples/e2e-round.test.ts` runs the round-1 driver as a separate process over HTTP against the demo's own world on two origins: 49 s on SimChain and 98 s on anvil (measured, T-216 Evidence). `pnpm demo-cloud:e2e` runs both Workers in `wrangler dev` and plays a deal in 8.4 s (measured, T-032 Evidence).
- `apps/test-agents/src/seller.ts`: the test seller runs in process in its tests against `apps/demo-cloud`'s world. The per-PR worlds start it the same way.
- `agent-ops/gates.md`: a required check must always report (velocity review §2.2); the trusted-checkout job pattern of T-044.
- `docs/testing.md`: filename prefixes and expectations; the Known flakes rules (T-049).

## Acceptance criteria

- [ ] `tools/sim/catalogue.json` is version 2, and `pnpm vitest run tools/sim/scripted.test.ts` checks it against `tools/sim/catalogue.schema.json` under Ajv 2020-12 strict. Every free-text field follows the TriageRecord's `shortText` rule: at most 300 characters, and no URL, handle or markup. `weightBps` values are integers that sum to 10,000. Every pairing names a job, a buyer, a seller or `test-seller`, an `expect`, its `tiers` and an `origin`. The test shows that a fixture entry with a URL, one with a decimal weight and one with no origin each fail.
- [ ] The catalogue holds the jobs, variants, profiles, frameworks and pairings of the design note's section 3.3: the six new jobs (`customers-3`, `demo-clean-2000`, `markdown-report`, `large-dataset`, `tiny-dataset`, `over-scope`); the variants `size`, `disclosure`, `windows` and `template`; the nine new profiles; the four frameworks; and the six must-run pairings. Every job's terms prepare as an offer on a live SimChain world, shown by the existing `world.test.ts` check extended to every variant.
- [ ] `node tools/sim/bin/scripted.ts --world sim [--pairings <ids> | --sample <n> --seed <hex>]` starts a per-PR world through `stage.ts`: the demo's World in Node, two origins, scripted judges and the test seller in process. It plays each pairing with scripted parties, runs `sim:check`, writes `reports/sim/<run>/summary.md` and one JSON record per pairing with public data only, and exits 0 only when every pairing met its `expect`. `--world anvil` runs the same against `contracts/out` with one block a second, and `--world workerd` runs both Workers under `wrangler dev --local`. Each world refuses any chain but SimChain, anvil and Sepolia through `assertRoundChain` before any write (tested).
- [ ] Each profile has a scripted interpretation in `scripted.ts`: honest (the straight path); sloppy (one named mistake and its recovery); impatient (short windows and timeout triggers); adversarial (each tactic as a fixed step with its expected refusal); confused (each misreading and the problem type it must meet); minimal; negotiator; privacy-first (the private recipe with a per-deal key and a `Delegation`); disputant (an appeal upheld each way); silent (reclaim and default); multi-deal; stale-docs; settler. `pnpm vitest run tools/sim/scripted.test.ts` plays the five scripted must-run pairings on SimChain (`vanilla-visitor` runs in the model tier only) and one pairing per profile, and passes. A pairing whose expectation is edited to the wrong terminal state fails (tested).
- [ ] `tools/sim/sample.mjs` draws `n` pairings by `weightBps` with a seed, always includes the must-run set, and draws the same set for the same seed (a property test).
- [ ] `tools/sim/gate.mjs <run folder> [--baseline <file>]` exits non-zero on any unmet expectation. It prints an advisory line when the median deal time or the p95 request latency exceeds the baseline by more than `simulation.scripted.timing_bps` in `ops.yaml`. With no baseline it prints "no baseline" and judges expectations only. Tested on fixture runs.
- [ ] Flakes: a pairing marked `flaky` in the catalogue, with `since`, `expires` and `task`, reruns once. An expired mark counts as not flaky. A flaky pairing that fails more than twice in a day is reported for a lane pause, the rule from T-049. `pnpm vitest run tests/agent-ops/simulate.test.ts` covers each case.
- [ ] `agent-ops/workflows/simulate.yml` (inert) runs `scripted.ts` from a checkout of `main` for the harness against the pull request's build. It chooses the worlds from `affected.mjs`'s path table (`simulation.customer_paths` in `ops.yaml`): SimChain for every customer path, anvil for tier 2 runtime paths, and workerd for Workers code and the site. It passes at once for pull requests that touch no customer path, and it always reports. A test reads the file and checks the single `ref: main` checkout for the harness, no cache, and the always-report job, as T-044's `ci.yml` test does.
- [ ] `scripts/ci/guardrails.mjs` raises a pull request that changes a pairing's `expect` to tier 2 (one fixture diff). `ops.yaml` lists `tools/sim/check.ts`, `scripted.ts`, `stage.ts`, `stage.mjs`, `gate.mjs` and `sample.mjs` under tier 2 (done in the design, 2026-11-05), and `tiers.mjs` maps them so (one test case).
- [ ] `tests/agent-ops-inactive.test.ts` (T-040) still passes: nothing under `.github/` or `.claude/` reads the new workflow before T-050.
- [ ] `tools/sim/README.md` and `docs/testing.md` describe the scripted tier, its worlds, the pass rules and the flake rules. `pnpm verify` passes, and the measured time of `tools/sim/scripted.test.ts` is in `vitest.config.ts`'s cost table.

## Out of scope

- Model-driven parties, the `tool-loop` runner and other model families (T-062).
- The baseline store, the SimRecord and the reviewer's precondition (T-062).
- The Sepolia staging world and the deploy wrapper's `stage` command (T-062, Rafa's gate).
- Making `simulate` a required status (T-050).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics: the scripted tier's wall time per world (SimChain, anvil, workerd) for the must-run set and for 12 pairings.

## Decisions

Choices made inside this task. Escalate anything that changes architecture, a contract or a defense to an ADR. No ADR is expected: the task adds test tooling and an inert workflow.

## Handoff

What is done, what is not, how to resume, and the open questions that remain. Record here the measured run times that T-062's budgets and T-050's shadow period start from.
