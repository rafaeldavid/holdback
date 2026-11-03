# T-042: The usage-telemetry lane: signal rules that open records without a model

- **Lane:** infra (reads the api lane's aggregates)
- **Phase:** 9
- **Depends on:** T-041 (the record writer and the shared intake folder); T-052 (the day-line export in `CROW_TELEMETRY_DIR`); T-055 for the optional `cost-signals.json`. T-031's aggregates merged in PR 118.
- **Paths this task may touch:** `scripts/ops/signals.mjs` (new), `scripts/ops/send-records.mjs` (new, only if the telemetry directory is on the laptop), `tests/agent-ops/signals.test.ts` (new), `agent-ops/ops.yaml` (`telemetry` thresholds only), `agent-ops/pipeline.md` (Usage telemetry section), `docs/tasks/T-042-telemetry-lane.md`
- **Human gate:** yes for two things only: turning on Cloudflare Web Analytics for escrow.stream, and any account a social reader needs. No for the rules and the API, onchain and cost sources.
- **Status:** todo
- **Agent/session:** —

## Intent

Let usage, not only opinions, open work: a rule over aggregates writes a `TriageRecord` with a `signal` name when a measure crosses its threshold.

- **Inputs:**
  - T-031's day lines, from the export T-052 writes to `CROW_TELEMETRY_DIR`. T-031 writes them to Workers Logs, which keeps them 3 days on Free and 7 on Paid, and nothing serves them (measured, `docs/operations.md`). T-052 builds the one reader for both the cost collector and this lane, so this task builds no second one.
  - `cost-signals.json` beside them (T-055): the names of the cost rules that fired, never a figure.
  - Public settlement events on Sepolia (T-213), through a public RPC.
  - Web Analytics stage counts, once Rafa enables them.
  - Social mention counts, once Rafa approves a reader.
- **Output:** records with `source` set to `api`, `onchain`, `web` or `social`, and a `signal` field. No record carries a figure, so only records cross to the build side. Where `CROW_TELEMETRY_DIR` sits relative to the build environment (laptop or VM) follows T-052's choice; this task records it.
- Non-goals:
  - collecting new telemetry (T-031 owns it);
  - reading billing data (`docs/costs.md` keeps it out of the agent-ops phase);
  - publishing any figure (Rafa decides, D39);
  - reading social post text (that goes through T-041's quarantine);
  - the feedback-request rules (T-043).

## Context

- `agent-ops/pipeline.md` "Usage telemetry": each source's owner, cadence, rule and retention. `agent-ops/ops.yaml` `telemetry`. PR 112, not merged yet.
- `docs/costs.md` (PR 141): what the agent-ops phase may read, in `CROW_TELEMETRY_DIR`, and what it may never read, the cost directory.
- D35, D39, D40, ADR-0024 §1: aggregates only, no deal content, no identities. Threat P11.
- `docs/tasks/T-031-telemetry-mvp.md`: the hour and day line formats.
- The gas baseline: 395,831 per happy-path deal on anvil (T-202, measured). Recalibrate it on Sepolia from the day lines before the rule runs.

## Acceptance criteria

- [ ] Decide and record where `signals.mjs` runs: beside `CROW_TELEMETRY_DIR`, which T-052 places. Also record how its records reach the build side on option B:
  - when the directory is on the VM, the `deploy` user writes them to `/srv/crow/intake/`;
  - when it is on Rafa's laptop, this task adds `scripts/ops/send-records.mjs`, which copies the records, and only the records, over `ssh` to `/srv/crow/intake/`. Rafa adds it to his own daily routine; T-055 does not do it.

  The records carry no figures, so either way the figures stay off the build side.
- [ ] Every rule in the pipeline's telemetry table is a named signal in `signals.mjs`, with its threshold read from `ops.yaml` (D31: parameters, not constants). Ratio thresholds are integers in basis points (hard rule: no floats).
- [ ] A cost rule named in `cost-signals.json` opens an `incident` record that carries the rule's name only.
- [ ] `pnpm vitest run tests/agent-ops/signals.test.ts` shows each rule firing on a fixture series that crosses its threshold, and staying silent on one that does not.
- [ ] An onchain event sequence that the state machine in `packages/core` forbids opens a P0 `security` record. Checked by a test with a forged sequence.
- [ ] A test shows that no record, and no tracked file in the repository, contains a figure from the input series.
- [ ] The script reads only `CROW_TELEMETRY_DIR` and public RPC data: it refuses to run if pointed at the cost directory, and it sends nothing to a model provider (no import of a provider client; checked by a test).

## Out of scope

- A dashboard, any public stats page, alert delivery to a phone (T-047 covers alarms; T-055 covers cost alerts).

## Evidence

## Decisions

## Handoff
