# T-353: The drand verifier, a second read by another model family

- **Lane:** research
- **Phase:** 2
- **Depends on:** T-343 (the first review, `docs/reviews/2026-11-11-drand-verifier-review.md`)
- **Paths this task may touch:** `docs/reviews/2026-11-11-drand-verifier-second-read.md`, a new test file under `contracts/test/` if a claim needs one, this task file, scratch in `reports/scratch/t-353/`
- **Human gate:** yes. The one outside call is to the DeepSeek API, which Rafa named on 2026-11-11 ("Second-model family review should be from the API key for Deepseek"); the key must be in the environment of the run
- **Status:** in progress
- **Agent/session:** T-353 sub-session, change kind 10 (research), 2026-11-11

## Intent

Restated: T-343 read `contracts/src/DrandQuicknetBeacon.sol` and found no defect in the verifier, but one read by one model family is not enough for code that seeds the fallback and appeal panels. This task gets a second read from a pinned DeepSeek model, through the repo's own live client (`apps/adjudicator/src/providers/live.ts`, model `deepseek-v4-pro@2026-11-01` from `config/judges-live.yaml`). The model gets the inputs and the six questions, never the first review's conclusions.

Inputs: the verifier, lines 250 to 300 of `HoldbackRules.sol`, the fixture, the five drand test files T-343 started from, the six questions, links to the published sources, and the off-chain twin (`apps/adjudicator/src/drand.ts`, `beaconRoundFor` in `packages/core/src/state.ts`) for T-225 item 7.

Output: one report. Each claim the model makes is checked against the source or with a test and marked confirmed, refuted or unverified. Only then is the first review opened and compared.

Non-goals: any change to `contracts/src/` or to an existing test; a fix for any finding (a defect goes to the coordinator with a severity and a reproducing test).

## Context

- Section 11 of `docs/reviews/2026-11-11-drand-verifier-review.md`: what the second reader gets and what to ask.
- `docs/tasks/T-343-drand-verifier-review.md`, Intent: the six questions.
- `docs/reviews/2026-11-03-public-audit-crosscheck.md`: the earlier cross-check.
- `config/judges-live.yaml`, `config/model-prices.json`, `apps/adjudicator/src/providers/live.ts`.

## Acceptance criteria

- [ ] The prompts and raw answers are kept in `reports/scratch/t-353/`.
- [ ] Every claim is confirmed, refuted or unverified with the reason.
- [ ] A confirmed new defect goes to the coordinator at once, with its severity and a reproducing test.
- [ ] The report compares the two reads and says whether the first review's verdict stands and whether the verifier needs a change.
- [ ] The report records the model ID, the date, and the tokens and cost of the model calls.

## Out of scope

- Fixing anything the read finds.
- Sending anything but public-repo content to the model.

## Evidence

- Commands run and results:
- Snapshot diffs: none.
- Metrics:

## Decisions

- Model: `deepseek-v4-pro@2026-11-01`, the stronger of the two DeepSeek entries in the live registry. DeepSeek publishes no dated snapshots, so the ID is a provider alias checked on 2026-11-01 (the registry's recorded limit).
- The repo's client turns DeepSeek's thinking off (`extraFor` in `live.ts`). The run keeps that, so it uses the client unchanged.
- The packet leaves out `DrandVerifierReview.t.sol` and `DrandRedTeam.t.sol`: T-343 wrote them, and they carry its conclusions.

## Handoff

- Done: the packet and the runner, `reports/scratch/t-353/run.mjs` (`build` writes the prompts; `run` sends them).
- Waiting on Rafa: `HOLDBACK_OPENAI_COMPATIBLE_API_KEY` and `HOLDBACK_OPENAI_COMPATIBLE_BASE_URL` are unset in this session's environment, so the model has not been called.
