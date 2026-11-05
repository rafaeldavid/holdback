# T-062: Usage simulation, the model tier and the market-feedback loop

- **Lane:** test and infra (with api for `signals.mjs`'s catalogue rules)
- **Phase:** 10
- **Depends on:** T-061 (the catalogue, worlds and scripted tier); T-039 (the VM, its users, runners and launcher); T-041 (the quarantine and the architect's triage command); T-042 (`signals.mjs`); T-043 (requested feedback, for the ease-rating rule); T-045 (the second-family client and keys, for customers from other families); T-047 (the budget stop); T-048 (dispatch and briefs)
- **Paths this task may touch:** `tools/sim/stage.mjs` (new: the stager), `tools/sim/runner.ts` (new: the `tool-loop` framework), `tools/sim/weights.mjs` (new), `tools/sim/entry.mjs` (new), `tools/sim/briefs/` (the vanilla-visitor prompt), `tools/sim/catalogue.json` (weights and origins), `agent-ops/schemas/sim-record.schema.json` (new), `agent-ops/schemas/triage-record.schema.json` (the `catalogue` route and the `sim` and `founder` sources; coordinated with T-041), `agent-ops/commands/triage.md` (the `catalogue` route; after T-041), `agent-ops/commands/stage-pr.md` (new, inert), `agent-ops/ops.yaml` (the `simulation` budgets and noise band, only to match what this task measures), `agent-ops/pipeline.md`, `agent-ops/gates.md`, `agent-ops/teams.md` and `agent-ops/README.md` (only to correct the design text of 2026-11-05 to what this task builds), `scripts/ops/signals.mjs` and `tests/agent-ops/signals.test.ts` (the catalogue rules only; after T-042), `scripts/ops/brief.mjs` and its test (the SimRecord's fields in the reviewer's brief only; after T-048), `scripts/ops/figures.mjs` (the simulation figures; after T-047), `scripts/dev-env/vm-users.sh` and `scripts/dev-env/deploy.sh` (the `stager` user, its runner and egress rule, and `deploy stage <tag> <sha>`; after T-039), `tests/dev-env.test.ts` (the stager's users, modes and rule; after T-039), `apps/demo-cloud/wrangler.staging-op1.jsonc` and `wrangler.staging-op2.jsonc` (new), `apps/test-agents/wrangler.staging.jsonc` (new), `docs/operations.md` (the staging world), `tests/agent-ops/stager.test.ts` (new), `docs/tasks/T-062-usage-simulation-model-tier.md`
- **Human gate:** **yes** for four things: the staging Workers, hostnames, relayer key, funding lane (about 0.3 Sepolia ETH, guessed) and `WORLD_SECRET`; the keys from other families for simulated customers (T-039 step 15); the standing nightly staging deploy; and whether the reviewer's PASS precondition binds (README Activation step 7b). No for the code and the scripted runs. A PR that touches `agent-ops/` is tier 3, so Rafa merges it.
- **Status:** todo
- **Agent/session:** —

## Intent

Rafa, 2026-11-05: "we should amend to include agent / customer usage simulation, with set of diverse needs informed by continous market feedback in staging environment pre-merge".

Restated: model-driven customers of several profiles, frameworks and families play a weighted sample of the catalogue against a world built from the pull request, in a sandbox on the agents' VM. The run's record decides whether the reviewer may approve a tier 2 pull request. What real agents and people say and do feeds the catalogue back, so the mix of simulated customers follows real usage.

- **Inputs:** the catalogue and briefs on `main`; the pull request's build; the baseline store; TriageRecords of kind `friction`, `feedback` and `feature`; T-042's telemetry export.
- **Outputs:** a `SimRecord` per head commit; a nightly baseline; `friction` records to intake; the `catalogue` route and the architect's entries; weights; the Sepolia staging world and the pre-deploy staging run.
- **Non-goals:** judge quality (Phase 3's calibration); fixing what the simulation finds; any deploy, which waits for Rafa.

## Context

- The design: `docs/research/2026-11-05-simulation-and-watch.md`, sections 3.1, 3.2, 3.4, 3.5 (model tier), 3.6, 3.9 and threats P16 to P19; `agent-ops/pipeline.md`, Usage simulation and stage 5a; `agent-ops/README.md`, Activation steps 5b, 6b, 7b and 9b.
- `tools/sim/README.md`: parties as Claude Code subagents, `sim:check`, and the known gap that any party could read `world.json` and the audit endpoint.
- `apps/adjudicator/src/providers/live.ts`: the OpenAI-compatible client that the `tool-loop` runner reuses. `examples/sign.ts`: the signing tool.
- T-039: one Unix user per role, runners without keys, the `crow-claude` group, the root-owned launcher and deploy wrapper. T-048: the tick passes no prompt, and the launcher builds briefs from `main`.
- `docs/log/2026-11-04.md`: T-213's vanilla trial measured three would-be approvals against a target of two.
- D49: one long-lived demo world, and a new world only for a new rules contract. The staging world is another Durable Object name on other Workers.

## Acceptance criteria

- [ ] `tools/sim/stage.mjs <pr> <head-sha>`, the stager, runs as the `stager` user. It starts the pull request's world as its runner user through `stage.ts`, renders each party's brief from the catalogue and briefs on `main`, and spawns each party: `claude -p` with the party's model for `claude-code`, `runner.ts` for `tool-loop`, the scripted framework, or the vanilla-visitor prompt. It waits for the reports, runs `sim:check`, compares with the baseline through `gate.mjs`, and writes `/srv/crow/sim/pr/<pr>/<head-sha>.json` matching `sim-record.schema.json`. `pnpm vitest run tests/agent-ops/stager.test.ts` runs it with scripted stand-ins for the model parties and checks the record. A pull request that changes `tools/sim/catalogue.json` gets two runs: `main`'s catalogue (the gate) and its own (advisory, and labelled so).
- [ ] `tools/sim/runner.ts` drives an OpenAI-compatible model with exactly two tools: `http`, to the world's operators only (any other host is refused), and `sign`, through `examples/sign.ts` with the party's own key. It writes the same party report as a Claude Code party. Tested with a stubbed provider: a tool call to another host is refused, and a deal completes.
- [ ] Pass rules, each tested on fixture records: an invariant violation blocks and opens a P0 record; completed pairings below the baseline median minus `simulation.model.noise_band_pairings` block after one rerun with a new seed; flaky pairings are left out under T-061's rules; new friction fingerprints open `friction` records with `source: sim`; a token spend more than `simulation.model.tokens_bps` above the baseline opens a `friction` record; a run past its budget or time is `incomplete`, reruns once, then marks the pull request `needs-human`.
- [ ] The baseline: the stager runs the 6-pairing sample on `main`'s head nightly and the full catalogue weekly, writing `/srv/crow/sim/baseline/<main-sha>.json`. `gate.mjs` compares against the median of the last five nightly records. Only the `stager` user can write the folder (`vm-users.sh`, checked by `tests/dev-env.test.ts` on its fixture root).
- [ ] The reviewer's precondition: `scripts/ops/brief.mjs` (T-048) puts the SimRecord's fields, never a party's text, in the reviewer's brief, with the rule that the reviewer approves a tier 2 pull request only when the record for the head SHA reads PASS. Shown by a brief test. Handoff names the line T-050 adds to `/review-pr`.
- [ ] Sandbox rules in `vm-users.sh`: a `stager` user and a `runner-stager` user; each party runs in its own folder; `world.json` and the audit endpoint belong to the runner user, mode 700; an owner-matched egress rule allows the `stager` user loopback and the model API hosts only. `tests/dev-env.test.ts` checks the users, modes and rule text on the fixture root. The smoke test (T-039 step 7) gains a probe that a process running as `stager` cannot open a connection to `escrow.stream`.
- [ ] The `catalogue` route: `triage-record.schema.json` gains `route: catalogue` and the sources `sim` and `founder`. `agent-ops/commands/triage.md` tells the architect to write or edit an entry from the record's fields only, set `origin`, and open a tier 1 pull request. `tools/sim/entry.mjs` asks a founder for shape fields only (kind of work, size band, checks or rubric, disclosure, dispute behaviour, framework) and writes an entry with `origin.source: founder`. It refuses a URL, a handle or more than 300 characters in any field (tested).
- [ ] Catalogue rules in `signals.mjs`, with thresholds in basis points from `ops.yaml`, each shown firing and silent on fixture series: a problem type's share doubling raises the weight of the matching profile; the checks-only against rubric share, the private share and the size-band distribution move the variants' weights; a deliverable format with no job opens a `feature` record routed to `catalogue`; a milestone's ease rating below 3 over a week (T-043's rule) raises the weight of pairings that cross it.
- [ ] `tools/sim/weights.mjs` reads `CROW_TELEMETRY_DIR` and the records behind each entry. It prints proposed `weightBps` rounded to multiples of 500, with the must-run set fixed and a floor of 500 for entries that no record has motivated in 90 days, and it prints no figure from the input. A test checks that the output holds no number from the input series.
- [ ] The Sepolia staging world: `wrangler.staging-op1.jsonc`, `wrangler.staging-op2.jsonc` and `apps/test-agents/wrangler.staging.jsonc` name `holdback-staging-op1`, `holdback-staging-op2` and `crow-test-agents-staging`; the hostnames `staging-api.escrow.stream`, `staging-api2.escrow.stream` and `staging.escrow.stream`; `SETTLEMENT=sepolia`; the world name `holdback-staging-sepolia-<date>`; and their own secrets (`SEPOLIA_RELAYER_KEY`, `WORLD_SECRET`, `TEST_AGENTS_SEED`). A test checks that no staging file names the demo's world name or Workers. `scripts/dev-env/deploy.sh` gains `stage <tag> <sha>`, which deploys the tag to the staging Workers only, runs the crawler's probes (T-063) and the three must-run scripted pairings against the staging origins, and writes `/srv/crow/sim/staging/<tag>.json`. `deploy <tag> <sha>` refuses without a PASS record for the same tag and SHA (tested on the fixture root).
- [ ] `figures.mjs` adds the simulation pass rate, the median cost per run, flaky pairings and incomplete runs to the daily pipeline figures, from the records only.
- [ ] `agent-ops/` matches what the task built: stage 5a and stage 6's precondition, the stager role, the staging world, the budgets, Activation steps 5b, 6b, 7b and 9b, and threats P16 to P19. `pnpm verify` passes.
- [ ] Measured in Evidence after Rafa's gates: one stager run on a tier 2 pull request with Claude-family customers (tokens, cost and wall time per party); five nightly baseline runs and their spread; one staging deploy from a tag, with its record.

## Out of scope

- Judge quality, and live-judge staging runs beyond a budgeted pre-deploy option.
- Choosing the final noise band and budgets: the shadow period in T-050 calibrates them.
- External agent frameworks such as LangChain or MCP clients: a backlog row.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics: tokens and cost per party by model; wall time per run; the baseline's spread over five nights.

## Decisions

Choices made inside this task. Escalate anything that changes architecture, a contract or a defense to an ADR. Record here: why no catalogue entry needs Rafa's approval line (the design note's section 3.4), unless Rafa decides otherwise; whether weights may be public (D39, Rafa); and the egress rule's mechanism.

## Handoff

What is done, what is not, how to resume, and the open questions that remain. Open questions for Rafa from the design note: the Sepolia staging world (1), catalogue weights in public (3), approval of catalogue entries from untrusted sources (5), customers from other families (9), and whether the model tier blocks (10).
