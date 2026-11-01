# T-021: Agent simulation: model agents use the HTTP API

- **Lane:** test + api
- **Phase:** 1 (exploration tooling)
- **Depends on:** T-020
- **Paths this task may touch:** `tools/sim/` (new), `docs/testing.md`, root `package.json` scripts, `fixtures/scenarios/` (one promoted finding)
- **Human gate:** no (no keys; Claude-family models only until Rafa provides other families' keys)
- **Status:** review
- **Agent/session:** implementer subagent, 2026-10-31, branch `t-021-agent-sim`
- **Re-scoped:** 2026-10-31 by D30 (API first: no MCP server) and because there are no model API keys in the repo. Model agents are Claude Code subagents of different sizes (Haiku, Sonnet, Opus, Fable) that the coordinator spawns; they call the local operator's HTTP API with curl and sign with `examples/verify.ts` and `examples/sign.ts`.

## Intent

Let model-driven agents of different sizes (and later different families) play buyers and sellers against a local world, so we find usability gaps, odd negotiations and adversarial behaviour that scripted agents never produce. Findings become deterministic fixtures; the sim itself is exploration, not CI.

**Restated (implementer).** Give the coordinator a cheap, repeatable way to put model agents in front of the real HTTP API as buyers and sellers, each knowing only what an outsider knows plus a job and a behaviour profile, and to judge each run by the settlement record rather than by what the agents say. Each run must be isolated (its own world, ports, accounts and files) so many runs can go in parallel. The check must compute its invariants itself (conservation per token, nothing moved outside signed terms, every commitment final or explainably open, both parties reading the same record) and must be shown to catch a bad record. Non-goals: an MCP server, non-Claude models, model-run judges (the sim keeps its fake judges; parties are never judges), CI gating on runs, running the first model batch (the coordinator does it; subagents cannot spawn subagents).

## Context

- `docs/reviews/2026-10-31-outsider-usability.md`; T-020's API, `pnpm sim` world, quickstart and examples; Rafa, 2026-10-31: "you should be able to simulate protocol and API usage easily by spinning up agents who use different models".

## Acceptance criteria

- [x] `tools/sim/catalogue.json`: jobs (dataset, translation, code fix, research brief) with terms a party can propose, and behaviour profiles (honest, sloppy, impatient, adversarial) each with a short, concrete brief.
- [x] `tools/sim/briefs/`: a brief template per role that tells a model agent only what an outsider would know (start from `docs/quickstart.md`, the sim's endpoints, its own account), its job and profile, and how to report: actions taken, outcome, friction.
- [x] `pnpm sim:world <run-id>`: starts an isolated world on free ports for one run (so parallel runs never share state) and writes its endpoints and fresh accounts to `tools/sim/runs/<run-id>/world.json`.
- [x] `pnpm sim:check <run-id>`: after a run, reads the world's settlement log and balances and checks invariants: funds conserved, nothing moved outside the signed terms, every commitment terminal or explainably open, both parties' records match (D26). Writes `check.json` and exits non-zero on a violation.
- [x] `tools/sim/README.md`: how the coordinator runs a batch (spawn one subagent per party with a model and profile, then `sim:check`), and how to promote a finding to a fixture.
- [x] Simulated parties never act as judges; judges stay the sim's pinned fake judges.
- [x] Prove it with one small batch run by the implementer itself is not possible (subagents can't spawn subagents): instead, run `sim:world` and `sim:check` around a scripted pair of parties from `examples/` and around a deliberately bad run (a mutated ledger) to show `sim:check` catches it. The coordinator runs the first model batch.

## Out of scope

- Non-Claude model families (needs Rafa's keys); an MCP server (D30); CI gating on sim runs.

## Evidence

- **measured** `pnpm verify` on a clean tree at `ad284c4` (before this task-file commit): typecheck, lint, test (74 files, 2021 tests), spec, snap, demo all pass; report `reports/verify-t-021-agent-sim.md`.
- **measured** Test first: at `f0ca60c` both new test files failed (modules missing); after the implementation `pnpm vitest run tools/sim` passes 16 tests. One new test caught a real catalogue error (`text/x-diff` is not an allowed deliverable format; changed to `text/plain`).
- **measured** CLI proof around a scripted pair: `pnpm sim:world t021-proof` started on free ports (operators 62191/62192, sim 62193, audit 62194); `examples/run.ts buy-dataset` and `sell-translation` against it both reached `Released`; `pnpm sim:check t021-proof` exited 0 with all five invariants ok, both commitments `open` ("a party may appeal until …"); after `POST /advance` both were `final`; tUSD minted 155000000000 = ledger 155000000000.
- **measured** CLI proof of a deliberately bad run: a copy of that run's `audit.json` with 1 tUSD moved from the buyer to the seller off the record, checked with `pnpm sim:check t021-proof --audit <copy>`, exited 1 with `conservation` failing on exactly those two accounts ("the ledger holds 9973000000, replayed from the log 9974000000"); the other four invariants stayed ok.
- **measured** `check.test.ts`: one SimChain deal per money path (release, refund, early accept, settlement, appeal overturned, appeal upheld, reclaim, default outcome, open offer) passes every invariant; seven tampered variants each fail the expected invariant: ledger units moved (conservation), units minted (conservation), a forged posting to an outsider with a recomputed hash chain, matching ledger and matching operator balances (within-terms only), a forged release with no signed decision (within-terms and conservation), an edited event (log-integrity), an operator hiding an event (records-match only), state not matching held money (terminal-or-explained). A party report that disagrees with the record is a finding, not a violation.
- **measured** `world.test.ts`: two worlds started in parallel get 8 distinct URLs and different party addresses; a scripted pair in one leaves the other's log empty; `sim:check` over HTTP (judgment records required) passes it and fails a mutated ledger; every catalogue job prepares as an offer on a live world; a rendered brief has the party's own key and the counterparty's address but not the counterparty's keys, the audit URL, another party, `FAIL-ME` or `sim:check`; mail delivers once, in order.
- **inferred** The briefs are usable by Haiku-to-Fable subagents: the steps they need are the quickstart's, which outsider testers completed in ~9 minutes. Not measured: no model batch was run (subagents cannot spawn subagents); the coordinator runs the first batch.
- **guessed** The sim's fake judges pass any rubric-judged work without `FAIL-ME`, so adversarial seller tactics on translation and code-fix jobs will mostly "succeed" at the panel; the README says to read panel outcomes in that light.

## Decisions

- **`tools/sim` is a workspace package** (`@holdback/sim-tools`), run with Node type stripping like `examples/`. That needed one line each in `pnpm-workspace.yaml`, root `tsconfig.json` (reference) and `vitest.config.ts` (include), plus the lockfile entry: root config outside the task's listed paths, recorded here. No other lane's files changed (none of T-015's).
- **The check reads a coordinator-only audit endpoint** that `sim:world` serves (genesis, the chain's ledger, the journal of accepted signed submissions, the event log), and every operator over the public API. It reimplements the hash-chain check, signature checks and posting rules itself rather than calling `SimChain.verifyLog` or `SimChain.replay`, so it does not trust the code it checks.
- **Events that do not list their postings** (`bond.slashed`, `commitment.settled`) are re-derived from the event, the terms and the rulebook; the ledger comparison then catches any difference. Bond payouts are capped (overturn ≤ price; default ≤ rulebook compensation).
- **"Both parties' records match"** is computed from what any party can read: every operator's events (by hash), state, judgment record (hash matches the last signed decision) and balances must equal the log and the replay. Party reports are untrusted and produce findings only.
- **Isolation:** one process per run, all ports 0, accounts labelled `sim-run/<run-id>/<party>` (distinct keys per run, so a signature from one run is useless in another), a run directory per run, and a refusal to reuse a run id. One pair per world, because `/advance` moves the whole world's clock.
- **Agent-to-agent channel** is a file mailbox (`bin/mail.ts`), unauthenticated like any off-protocol channel, so spoofed mail is part of the adversarial surface.
- **`sim:check --audit <file>`** checks a saved audit against the live operators, so a tampered record can be shown failing from the CLI, not only in tests.

## Handoff

- **Next (coordinator):** run the first model batch by `tools/sim/README.md`, "Run a batch": pick pairings from `catalogue.json`, `pnpm sim:world <run>` per pair in the background, `pnpm sim:brief` per party, spawn one subagent per party in one message with the brief as its prompt and its model, then `pnpm sim:check <run>` and `pnpm sim:stop <run>`.
- **Not done:** no finding promoted to `fixtures/scenarios/` yet, because no model batch has run; the README's "Promote a finding" says how. No `vitest.config.ts` cost entry for the new test files (they take about 2 s locally; T-022's table is measured from CI).
- **Known limits:** the sim service has no access control, so a party that ignores its brief could call `/adjudicators` or `/accounts` undetected; `sim:check` needs the live world. Rubric-judged jobs meet fake judges.
