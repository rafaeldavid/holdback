# T-388: the two whole-diff reviews before the freeze (package R11)

- **Lane:** settlement (contracts), branch `contracts-audit-ready`
- **Phase:** 2
- **Depends on:** T-384 (package R9: pull request 1 fixes the code under review, pull request 2 its descriptions), T-380 (package R8), T-352 (package R10), T-385 (the docs pass)
- **Paths this task may touch:** `docs/reviews/` (two new reports), `contracts/test/crosscheck/R11Review.t.sol` (the tests behind review 1), this task file. A Critical or High finding in the contracts gets its own pull request, which may touch `contracts/src/*` and its tests. `examples/` belongs to T-390
- **Human gate:** yes for one call: the second review sends the public repository's source and docs to the DeepSeek API, which Rafa named on 2026-11-11 and runs himself. No deploy, no live run
- **Status:** in progress
- **Agent/session:** the T-388 session, change kind 10 (a review); a fix would be kind 7 (smart contracts)

## Intent

Read the phase-one contracts twice before they are frozen, tagged and deployed on Sepolia, so that the outside audit starts from fewer open findings. The bar is best effort: every finding these reviews make first saves a round of fix, redeploy and re-audit.

- **Review 1** is this session's, at full depth: every line of `contracts/src` at the commit, the vendored escrow's functions the contracts call, and in full the three dependencies no earlier review read (the payment collectors, `TokenStore.sol`, Solady's signature library). It works from questions for each external function: who can call it, in which stage, with which signatures; what it moves and to whom; what stops a second call; what happens at each deadline's exact second; what ordering, delaying or replaying gains; whether money can reach an address the terms did not name; whether the key can leave without the payment; whether any path leaves funds nobody can move.
- **Review 2** is by another model family, DeepSeek, through its API. It gets the same source, docs and questions, in pieces small enough that each answer completes, and none of review 1's conclusions. This session checks each of its claims against the code and says which hold.
- **Named scope beyond the diff:** sections 7 to 11 of `docs/audit/state-model.md`; the buyer signer's two paths (`examples/buyer-signer.ts`: where its expectations come from, and its resume path); and the question that one operator runs both nodes of the public demo and alone sets every expectation the buyer leaves out. After T-384's second pull request: the descriptions, read against the code.
- **Outputs:** two dated reports under `docs/reviews/` with a joint summary, and the tests behind review 1.
- **Non-goals:** no fix below High, no refactor, no change to events, no deploy. A finding that is not Critical, High or a regression is recorded and not fixed.

## Context

- The scope of phase one: [ADR-0031](../decisions/ADR-0031-phase-one-contract-scope.md). The beacon rounds and their margin: [ADR-0032](../decisions/ADR-0032-beacon-rounds-escalation-and-fallback.md). The two money addresses: [ADR-0033](../decisions/ADR-0033-payout-and-payment-addresses.md).
- [`docs/audit/state-model.md`](../audit/state-model.md), [`threat-model.md`](../audit/threat-model.md), [`invariants.md`](../audit/invariants.md), [`known-issues.md`](../audit/known-issues.md), [`scope.md`](../audit/scope.md), and [`formal/README.md`](../../formal/README.md).
- The earlier second-family read and its two method lessons: [`docs/reviews/2026-11-11-drand-verifier-second-read.md`](../reviews/2026-11-11-drand-verifier-second-read.md). That model missed the round finding, and three of its four answers stopped at the client's 8,192-token output limit.
- The deployed contracts are commit `64be1f1`; the diff under review is `git diff 64be1f1 <commit> -- contracts/src`.

## Acceptance criteria

- [x] Review 1's report is under `docs/reviews/`, with the commit, what was read with line counts, findings by severity with file, line, scenario and test, what was checked and found sound by function, and where it did not look.
- [x] Review 2's report is under `docs/reviews/`, with the same parts, the model, the calls and their token counts, every question that got no complete answer, and for each claim whether it holds.
- [x] A joint summary says what must be fixed before the freeze, what goes to known issues, and what is for the outside auditor's attention.
- [x] Every Critical or High finding in the contracts is fixed in its own pull request with a test that failed first, or handed to Rafa with a reason. (There is none in the contracts. The one High is in the buyer's tool and went to T-390.)
- [ ] Both reports are merged on the lane in one docs pull request.

## Out of scope

- Token-issuer risk: a token that freezes, pauses or blacklists is not a finding.
- The arithmetic inside `DrandQuicknetBeacon.sol`, which had its own review and second read (T-343, T-353). Review 1 reads the file for what the rules contract relies on.
- Fixes to `examples/`: T-390 owns them.

## Evidence

- **The commit.** The code was final at `c629d06c` (the merge of T-384's first pull request, 433), named by the coordinator on 2026-11-12 at 18:22 UTC. Both reviews read it there. The commit named for the freeze is `0180a39f` (pull request 445), after the descriptions (441, `d3cd4605`) and one added sentence. With `//` comments and white space removed, each of the five files of `contracts/src` at `0180a39f` equals its copy at `c629d06c` [measured: a script over `git show` of both commits].
- **Review 1.** [`docs/reviews/2026-11-12-phase-one-whole-diff-review.md`](../reviews/2026-11-12-phase-one-whole-diff-review.md). Read in full: 1,329 lines of `contracts/src`, 828 lines of the vendored escrow, token store and collectors at `6b0a5ef`, and 735 lines of Solady's signature checker and EIP712 at `5ea5d9f` [measured: `wc -l`]. Findings in the contracts: 0 Critical, 0 High, 1 Medium, 1 Low, 5 Info. In the buyer's tool: 1 High, 2 Medium, 10 Low.
- **The tests behind it.** `contracts/test/crosscheck/R11Review.t.sol`, ten tests. `forge test --match-contract R11ReviewTest`: 10 passed [measured]. The whole suite with them, on this branch at the lane's tip `55a3dce4`: 482 tests passed, 0 failed, 0 skipped, in 65 suites, 2026-11-12 19:23 to 19:35 UTC, forge 1.0.0 [measured: `forge test` in `contracts/`]. That tip's `contracts/src` differs from `0180a39f` by three comment lines.
- **Review 2.** [`docs/reviews/2026-11-12-phase-one-second-family-review.md`](../reviews/2026-11-12-phase-one-second-family-review.md). Model `deepseek-v4-pro`, run by Rafa from his shell: `node --env-file=… reports/scratch/t-388/run.mjs run c629d06c…`, twice. First run, 18:28 to about 18:44 UTC: 23 calls, 19 answers complete, 4 stopped at the 32,768-token output limit. Second run, 19:04 to about 19:13 UTC: the 4 split into 11 questions at a 65,536-token limit, all 11 complete. Third run, 19:42 to 19:48 UTC: question 24, the descriptions, at `0180a39f`, complete. All three: 35 calls, 1,302,151 input and 848,591 output tokens [measured from the runs' logs]; about USD 1.95 at off-peak list prices [inferred from `config/model-prices.json`].
- **Its claims.** 342 numbered claims in 31 answers; 52 marked as defects (4 High, 16 Medium, 20 Low, 12 Info). Checked against the code: 38 hold as stated, 8 hold at a lower severity, 6 do not hold [measured by reading each; two settled by tests]. No claim is a Critical or High finding in the contracts.
- **The four statements the docs pass could not verify:** three confirmed, one corrected (known issue A-4). Review 1, section 6.1. The fallback window's floor, 43 s on Ethereum mainnet and 44 s on Sepolia, comes from a script over every `judgeBy` in 720 s [measured].
- **Not run:** the anvil suites, the formal model, the mutation run (T-352's), any deal on a chain.

## Decisions

- **The second review runs from Rafa's shell, not from a session** (the coordinator, 2026-11-12): the key stays in his environment. The runner is `reports/scratch/t-388/run.mjs` in the main checkout; it reads every file with `git show` at the commit it is given.
- **The runner calls the provider itself, not through the repository's live client.** That client caps output at 8,192 tokens and turns the model's reasoning off, and no cap in product code is raised for a review.

## Handoff

**Done.** Both reviews, their joint summary (review 2, section 6), and ten tests. No Critical or High finding in `contracts/src`; nothing in it was changed.

**Open when this task closed:**

- TBD-HANDOFF-T390
- **For the freeze's docs step** (review 1, section 10): rate known issue "H-2 limit" Medium; one line in the signed-field register for two envelopes addressed to the buyer; one clause in `scope.md` that the token keeps ERC-3009's payee rule; the wording "an accept or a reject is final" in the state model's section 9.1; known issue A-4 as review 1's section 6.1 states it; the `<FREEZE_COMMIT>` placeholders.
- **For Rafa:** whether the three dispute fields get a refusal in `agreeAndFund` (finding L-1). The reviews recommend leaving it for phase one.
- **For the client lane:** the Medium and Low findings in the buyer's tool (review 1, section 7.3), and the three steps that make its defaults safe when one operator runs both nodes (section 7.4).
- **A later roadmap row:** an advisory notice at the operator's prepare route for a `createdAt` far from settlement time.

**How to rerun the second review.** The runner is outside the repository, at `reports/scratch/t-388/run.mjs` in the maintainer's checkout, with the prompts, the raw answers and the log beside it. `node run.mjs list <commit>` prints what it would send and sends nothing. It reads the key and the base URL from the environment by the names the live client uses, and prints neither.

**What a later reader should know about the method.** The model spends about 26,000 output tokens a question, nearly all on reasoning, so a limit under 65,536 tokens cuts answers off with nothing written. Narrow questions with a marker line at the end made every cut visible.
