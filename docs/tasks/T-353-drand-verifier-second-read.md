# T-353: The drand verifier, a second read by another model family

- **Lane:** research
- **Phase:** 2
- **Depends on:** T-343 (the first review, `docs/reviews/2026-11-11-drand-verifier-review.md`)
- **Paths this task may touch:** `docs/reviews/2026-11-11-drand-verifier-second-read.md`, a new test file under `contracts/test/` if a claim needs one, this task file, scratch in `reports/scratch/t-353/`
- **Human gate:** yes. The one outside call is to the DeepSeek API, which Rafa named on 2026-11-11 ("Second-model family review should be from the API key for Deepseek"); the key must be in the environment of the run
- **Status:** review
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

- [x] The prompts and raw answers are kept in `reports/scratch/t-353/`.
- [x] Every claim is confirmed, refuted or unverified with the reason.
- [x] A confirmed new defect goes to the coordinator at once, with its severity and a reproducing test. None was found.
- [x] The report compares the two reads and says whether the first review's verdict stands and whether the verifier needs a change.
- [x] The report records the model ID, the date, and the tokens and cost of the model calls.

## Out of scope

- Fixing anything the read finds.
- Sending anything but public-repo content to the model.

## Evidence

- Commands run and results:
  - `node --env-file=… reports/scratch/t-353/run.mjs run`, run by Rafa on 2026-11-11 from 20:51 to 20:54 UTC. All 4 calls answered; 3 of them stopped at the 8,192-token cap [measured].
  - `python3 -I reports/scratch/t-353/check_constants.py`: 21 checks, all PASS. Every constant matches byte for byte, the key's y and −G2's y included [measured].
  - `forge test --root contracts --match-contract DrandSecondReadTest`: 4 tests pass. G1ADD costs 375 gas, MAP_FP_TO_G1 5,500 and two pairs 102,900; the square-root MODEXP 8,064 and a 1-byte exponent 200; one verification 141,449 gas [measured].
  - `forge test --root contracts --match-test test_issue_wrongRound`: 3 tests pass, so X-1 reproduces [measured].
  - `pnpm exec vitest run apps/adjudicator/src/drand-contract.redteam.test.ts apps/adjudicator/src/drand.test.ts`: 44 tests pass [measured].
  - `forge fmt --check` on the new test: clean [measured].
- Snapshot diffs: none.
- Metrics:
  - The model's tokens: 68,989 input and 29,957 output. Cost: about USD 0.10 off peak, at most USD 0.21 at peak prices [inferred from the counts and `config/model-prices.json`].
  - Claims: 49 rows, 39 confirmed, 8 refuted, 2 unverified (no answer) [measured: the report's §4].

## Decisions

- Model: `deepseek-v4-pro@2026-11-01`, the stronger of the two DeepSeek entries in the live registry. DeepSeek publishes no dated snapshots, so the ID is a provider alias checked on 2026-11-01 (the registry's recorded limit).
- The repo's client turns DeepSeek's thinking off (`extraFor` in `live.ts`). The run keeps that, so it uses the client unchanged.
- The packet leaves out `DrandVerifierReview.t.sol` and `DrandRedTeam.t.sol`: T-343 wrote them, and they carry its conclusions.

## Handoff

- Done: the read, the checks and the report, `docs/reviews/2026-11-11-drand-verifier-second-read.md`. The verifier needs no change, and the first review's verdict stands.
- New and real: no defect. One Info correction to the first review's gas figures, §7 and R-5. The square-root MODEXP costs 8,064 gas under EIP-2565, not 8,170, because clients count the leading 32 bytes of the exponent. So the Fusaka increase is about 57,904 gas, not 58,438 [measured on forge's EVM; mainnet clients unverified]. Whoever corrects ADR-0018's gas figure (the first review's §11, item 5) can take this with it.
- Not done: the model gave no answer to question 6, the execution-client question or the `beaconRoundFor` comparison, because its output looped at the cap. The first review's gate lines G-1 and G-2 still cover the clients and mainnet's fork rules.
- How to rerun: the runner is `reports/scratch/t-353/run.mjs`, local only. A stronger rerun would need the client to allow DeepSeek's thinking or a higher output cap, which means changing `live.ts`, outside this task.
