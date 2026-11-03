# T-043: Feedback requests at deal milestones, for agents that opt in

- **Lane:** api
- **Phase:** 9
- **Depends on:** T-032 (`POST /v1/feedback`, merged in PR 121); T-033 merged, so this change takes the next schema version after v0.9; T-041 (free-text answers go to the quarantine); T-042 (the signal rules this task extends)
- **Paths this task may touch:** `docs/decisions/ADR-00nn-feedback-requests.md` (new, next free number), `docs/decisions-today.md` (architect, through `/record-decision` from T-036, or by hand if T-036 has not merged), `scripts/ops/signals.mjs` and `tests/agent-ops/signals.test.ts` (the two feedback rules only), `apps/demo-cloud/scripts/feedback.ts` (the answer fields in T-041's `export`), `spec/schemas/` (the `feedbackRequest` object and the version bump), `spec/examples/`, `spec/openapi/paths.json`, `spec/openapi.json` (generated), `apps/operator/src/`, `apps/demo-cloud/` (config only), `docs/api.md`, `site/llms.txt`, `tests/contract/`, `docs/tasks/T-043-milestone-feedback-requests.md`
- **Human gate:** no for the code. Yes for redeploying the public demo with it (a deploy).
- **Status:** todo
- **Agent/session:** —

## Intent

Ask agents a few fixed questions at the moments that matter (before they sign, after a stage completes, after settlement, on an error), but only when the agent's owner opted in, and without the operator storing any state about who opted in.

- Input: the header `Prefer: feedback-requests=on` (RFC 7240) on an agent's request.
- Output: a `feedbackRequest` object in the response body (an ID, the milestone, an expiry 24 hours later, three fixed questions: an ease rating from 1 to 5, whether the docs answered the question, an optional comment). Answers go through `POST /v1/feedback` with the request ID.
- Non-goals: any request to an agent that did not opt in; any deal content in the request; stored opt-in state.

## Context

- `agent-ops/pipeline.md` "Requested feedback" (timing, sampling, routing, the two rules that open a record).
- D39 and T-032: the agent is told it shares the answer with this operator; text that may hold deal details is sealed to the operator's key.
- `CLAUDE.md`: `spec/schemas/` is the contract, changed only through an ADR plus a version bump. D31: rates are parameters.

## Acceptance criteria

- [ ] The ADR, after a research pass, records the field, the header, the sampling rule and the milestones, and is decided in `docs/decisions-today.md`. The schema version is bumped and `pnpm validate:spec` passes.
- [ ] Without the header, no response ever carries `feedbackRequest` (contract test over every route).
- [ ] The operator decides whether to ask by hashing the signer key, the deal ID and the milestone and comparing the result with a rate in basis points from config (design rates: 1,000 for prepare and stage milestones, 10,000 for settlement and appeals, 2,500 per problem type). The same inputs always give the same answer, so the operator asks at most once per deal and milestone; shown by a property test.
- [ ] The request carries no deal content (a test compares its fields with the schema's closed list).
- [ ] An answer to an expired or unknown request ID is refused with a problem type, and an unanswered request has no effect.
- [ ] Answers reach the signal rules this way:
  - T-041's `export` gains each answer's request ID, milestone, ease rating and docs-answered flag;
  - `signals.mjs` computes the per-milestone aggregates from the export;
  - free text follows T-041's export and quarantine rules, never into an aggregate.
- [ ] `signals.mjs` gains the design's two feedback rules, with thresholds from `ops.yaml`: a milestone's average ease rating falls below 3 over a week, or more than 3,000 basis points of a milestone's answers say the docs did not answer the question. Each is shown firing and silent on fixture series.
- [ ] `docs/api.md` and `site/llms.txt` describe the opt-in in one paragraph; `node site/build.mjs && node site/check.mjs` passes.

## Out of scope

- Choosing the final rates (the shadow week in T-050 calibrates them), any incentive for answering.

## Evidence

## Decisions

## Handoff
