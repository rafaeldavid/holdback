# T-042: The usage-telemetry lane: signal rules that open records without a model

- **Lane:** infra (reads the api lane's aggregates)
- **Phase:** 9
- **Depends on:** T-041 (the record writer); T-031's API aggregates merged in PR 118
- **Paths this task may touch:** `scripts/ops/signals.mjs` (new), `tests/agent-ops/signals.test.ts` (new), `agent-ops/ops.yaml` (`telemetry` thresholds only), `agent-ops/pipeline.md` (Usage telemetry section), `docs/operations.md` (where the private figures live), `docs/tasks/T-042-telemetry-lane.md`
- **Human gate:** yes for two sources only: turning on Cloudflare Web Analytics for escrow.stream (an account setting) and any account a social reader needs. No for the rules and the API and onchain sources.
- **Status:** todo
- **Agent/session:** —

## Intent

Let usage, not only opinions, open work: a rule over aggregates writes a `TriageRecord` with a `signal` name when a measure crosses its threshold.

- Inputs: T-031's aggregate metrics and request-log counts, read from a private export; public settlement events from the chain (a local chain until Sepolia); Web Analytics stage counts once Rafa enables them; social mention counts once Rafa approves a reader.
- Output: records with `source` `api`, `onchain`, `web` or `social` and a `signal` field, and no figures. Figures stay in `reports/telemetry/` (git-ignored) or the operator's store (D39).
- Non-goals: collecting new telemetry (T-031 owns that), publishing any figure (Rafa decides, D39), reading social post text (that goes through T-041's quarantine).

## Context

- `agent-ops/pipeline.md` "Usage telemetry" table: each source's owner, cadence, rule and retention. `agent-ops/ops.yaml` `telemetry`.
- D35, D39, D40, ADR-0024 §1: aggregates only, no deal content, no identities. Threat P11.
- The gas baseline: 395,831 per happy-path deal (T-202, measured).

## Acceptance criteria

- [ ] Every rule in the pipeline's telemetry table is a named signal in `signals.mjs` with its threshold read from `ops.yaml` (D31: parameters, not constants). Thresholds that are ratios are integers in basis points (hard rule: no floats).
- [ ] `pnpm vitest run tests/agent-ops/signals.test.ts` shows each rule firing on a fixture series that crosses its threshold and staying silent on one that does not.
- [ ] An onchain event sequence that the state machine in `packages/core` forbids opens a P0 `security` record, checked by a test with a forged sequence.
- [ ] A test shows that no record and no file under the repository's tracked paths contains a figure from the input series.
- [ ] The script sends nothing to any model provider (no import of a provider client; checked by a test).
- [ ] `docs/operations.md` says where each source's figures live and how long they are kept.

## Out of scope

- A dashboard, any public stats page, alert delivery to a phone (T-047 covers alarms).

## Evidence

## Decisions

## Handoff
