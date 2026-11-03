# T-206: Contract review, then an optional Sepolia deployment (human gate)

- **Lane:** settlement (reviewer role; reviews, does not edit contract code)
- **Phase:** 2
- **Depends on:** T-202, T-203 and T-205 merged; T-204 merged, or its model-to-contract mapping listed as an open item.
- **Paths this task may touch:** `docs/reviews/2026-11-03-contract-review.md` (new), `docs/neutrality.md` ("How neutrality is tested", the contract review checklist only), `deployments/sepolia.json` (new, only after Rafa approves a deployment), `docs/tasks/T-206-contract-review.md`. Extended by the coordinating session (Decisions 1): the four fix PRs' paths in `contracts/` and `reports/differential-local.md`, and the follow-up records (`docs/tasks/T-210…T-212`, `docs/plan.md`, `docs/backlog.md`, `docs/decisions-today.md` D37).
- **Human gate:** **yes.** (1) Rafa reads the review before Phase 2 is called done. (2) Any Sepolia deployment needs Rafa's explicit approval written in this file first: test ETH and a test token only, a deployer key from an environment variable, never printed. No mainnet, at any point; a mainnet deployment is a separate gate after an external audit and legal advice (D4).
- **Status:** review (the cross-family pass and Rafa's read are open; no deployment)
- **Agent/session:** Claude Opus 5.5 session in worktree `t-206-contract-review-d83e9c`, with a Claude Fable 5.1 red-teamer subagent and reviewer subagents per PR (2026-11-03)

## Intent

Review the Phase 2 contracts against the neutrality checklist, the hold invariants and the ADRs they implement, with two independent reviewers from different model families, so one family's blind spots do not pass unseen. Findings become follow-up tasks for T-202's paths; this task changes no contract code. If Rafa approves, deploy the reviewed bytecode to Sepolia so Phase 5 and T-207's Prividium spike have a public test deployment.

**Restated.** Check `contracts/src/` at one commit, `baac930`, against three references: the no-admin hard rule, the hold's invariants (conservation, settle-once, expiry and reclaim, key with payment), and ADR-0003, ADR-0012, ADR-0016, ADR-0018 and ADR-0022. Answer each checklist item with a line or a test. Run static analysis and triage it, map the T-204 model onto the contract, and have an adversarial reviewer try to break each litmus test without seeing the first reviewer's notes. Every finding gets a severity, a label and a fix or a written acceptance. The coordinating session also asked for the high and medium findings to be fixed in focused PRs with regression tests (Decisions 1). No deployment, no keys, no RPC beyond local anvil.

## Context

- `docs/neutrality.md` (control-point table, contract review checklist); ADR-0001, ADR-0002, ADR-0003 (and its T-201 outcome), ADR-0012, ADR-0018, ADR-0022, ADR-0023.
- T-202 Decisions, T-203 Evidence (invariants and mutants), T-204 model and its mapping, T-205 differential report and gas.
- `.claude/agents/` reviewer role; `docs/team.md` Rules and checks.

## Acceptance criteria

- [x] The checklist in `docs/neutrality.md` is expanded into checkable items (no owner, pause, freeze, blacklist, upgrade proxy, `selfdestruct`, mutable `delegatecall`; every timeout callable by anyone; no function moves held funds without a signature, decision or expired timeout; settle-once; key release in the same transaction as capture; expiry margin per ADR-0003), and each item is answered with a file and line or a test name (review §3).
- [x] Static analysis run (Slither 0.11.6, Aderyn 0.6.8), with every high and medium finding either fixed in a follow-up task or accepted with a reason (review §4; counts below).
- [ ] Two reviews from two model families, each run without seeing the other's output, recorded in `docs/reviews/2026-11-03-contract-review.md` with the model IDs used; disagreements listed. **Two independent passes ran, but both are Anthropic models** (`claude-opus-5-5`, `claude-fable-5-1`); the cross-family pass is a human gate (Handoff).
- [x] Each finding is labelled measured, inferred or guessed, with a severity, and has a follow-up task ID (T-210, T-211, T-212, or its fix PR) or a written acceptance (L-3).
- [x] The model-to-contract correspondence from T-204 checked: every model action maps to a contract function; the gaps are findings (review §5).
- [ ] Rafa has read the review (recorded here with date). Only then, and only if he approves in writing in this file: a Sepolia deployment whose verified bytecode matches the reviewed commit, addresses in `deployments/sepolia.json`, and one happy-path deal run on Sepolia with its gas recorded (measured).

## Out of scope

- Fixing findings (T-202 follow-ups); an external paid audit; any mainnet action; paymasters (Phase 5). The coordinating session brought the high and medium fixes into scope (Decisions 1).

## Evidence

- **measured** Baseline `forge test` at `baac930`: 168 passing (147 on `main` after PR 113 removed redundant tests).
- **measured** Static analysis over `contracts/src/` at `baac930`:

  | Tool | High | Medium | Low | Info |
  | --- | --- | --- | --- | --- |
  | Slither 0.11.6 | 1 | 16 | 40 | 20 |
  | Aderyn 0.6.8 | 3 (11 instances) | — | 8 | — |

  Each high and medium result is triaged in review §4; none is a defect.
- **measured** The adversarial pass (Fable) wrote 24 proof-of-concept tests in its own worktree, and all passed against `baac930`: 16 attacks and 8 defenses. Each finding cites its tests.
- **measured** Fix PRs. Each one's regression tests fail on `main` and pass on the branch:

  | Finding | PR | Regression |
  | --- | --- | --- |
  | H-1 | #120 | `test/unit/AppealAttempt.t.sol`, 7 tests (a role-restricted mutant fails 3) |
  | M-1 | #122 | `test/unit/AfterCppReclaim.t.sol`, 7 tests (an always-skip mutant fails 2), and `invariant_timeoutsExactlyWhenDue` |
  | H-2 | #125 | `test/unit/AppealKey.t.sol`, 4 tests |
  | M-2 | #127 | `test/unit/LateCarriedDelivery.t.sol`, 5 tests |
- **measured** `pnpm verify` on the first fix branch (`t-206-appeal-attempt` at `baac930` plus the fix; `reports/verify-t-206-appeal-attempt.md`):

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 15241 ms |
  | lint | `pnpm lint` | pass | 4788 ms |
  | forge build | `forge build --root contracts` | pass | 1612 ms |
  | forge | `forge test --root contracts` | pass | 16451 ms |
  | test | `pnpm test` | pass | 47517 ms |
  | spec | `pnpm validate:spec` | pass | 556 ms |
  | snap | `pnpm snap` | pass | 17629 ms |
  | snap:local | `pnpm snap --settlement=local` | pass | 32087 ms |
  | demo | `pnpm demo` | pass | 4447 ms |

  No snapshot diffs. The M-1 branch at `b0d10de` showed the same 9 passes. On `main` from `d8eac25`, snap:local fails on `error.submission-limit` with or without any T-206 change (24 passed, 1 failed, 3 excluded), and the H-2 and M-2 branches show only that failure.
- **measured** `HoldbackRules` runtime, by `forge build --sizes` (EIP-170 limit 24,576):

  | Build | Bytes |
  | --- | --- |
  | `baac930` | 24,051 |
  | `main` + #120 | 24,046 |
  | #122 alone | 24,415 |
  | #125 alone | 24,094 |
  | #127 alone | 24,077 |

  The combined size is recorded after the merges.
- **inferred** No non-Anthropic model key is exposed by name in the environment (only `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL`; `.env*` not read), so no cross-family pass could run here.
- **guessed beyond the names** The ERC-8183 event names match the draft's list (review I-10).

## Decisions

1. **Fixes inside the review.** The task file says the review changes no contract code. The coordinating session asked instead for the high and medium findings to be fixed in focused PRs, each with a regression test (#120, #122, #125, #127). Halves in other lanes stop at the lane boundary and are follow-up tasks: core and SimChain in T-210, the reference adjudicator in T-211.
2. **Review file name:** `docs/reviews/2026-11-03-contract-review.md`, dated like the other reviews (the path line said `2026-11-contract-review.md`).
3. **M-2 amends D37 point 1 and T-202 difference 5.**
   - Before: a carried delivery after `deliverBy` raced the buyer's reclaim.
   - Now: `decide` refuses a carried delivery from `deliverBy` on, as `deliver` and SimChain do. An early accept may still carry a late delivery, because the buyer is waiving its own deadline.
   - Research pass: the Fable adversarial review, max effort. Recorded under D37 in `docs/decisions-today.md`; Rafa may overrule.
4. **H-2 reverts rather than dropping the key.** The decision's calldata carries the key either way, so dropping `KeyReleased` would hide a leak it cannot prevent. The refusal makes a mis-sealed appeal fail where everyone can see it. The appeal still closes by `expireAppeal`, so the first decision stands and the appellant's bond is returned.
5. **Severity disagreements** are recorded in review §6. Where the two passes disagreed, the higher severity was kept whenever an honest path reaches the failure: H-2 and M-2.
6. **`EXPIRY_MARGIN`.** Recommended at 1 day, but not decided: it is set when Sepolia is deployed, which is Rafa's gate (review §7).

## Handoff

**State.** The review is written. The four fix PRs are open, and each merges after its reviewer returns PASS and CI is green. The cross-family pass and Rafa's read are open, and nothing was deployed.

**For Rafa: the cross-family review (gate).** Run a reviewer from another model family, for example an OpenAI or Google model, with this brief, and without showing it the review document.

> Review the Solidity settlement contracts in `contracts/src/` of rafaeldavid/holdback at commit `baac930`, then the four fix PRs #120, #122, #125 and #127. Read `CLAUDE.md` (hard rules and litmus tests), `docs/neutrality.md`, and ADR-0003, ADR-0012, ADR-0016, ADR-0018 and ADR-0022. The contracts run Commerce Payments' `AuthCaptureEscrow` v1.1.0 (vendored, unmodified) as its operator, have no admin keys, and release a sealed content key with the payment. Try to break three properties: (1) no single party can stop a valid commitment from settling, or move held funds or bonds outside its terms; (2) the hold (conservation, settle-once, expiry, reclaim, key with payment); (3) panel seeds the decider cannot choose. For each finding give a severity, file:line, the attack sequence, a measured/inferred/guessed label and the smallest fix. Run `forge test` from `contracts/`. No deployment and no RPC.

Append its findings to the review as a new section, with a disagreement table against §2, and tick the acceptance item.

**Follow-ups.**
- **T-210** (core, SimChain): mirror H-1 and H-2.
- **T-211** (judgment): the reference adjudicator never seals the key for a refunded buyer.
- **T-212** (settlement): the low findings L-1, L-2, L-4, L-5 and L-6, and I-2.

**Notes for other lanes.**
- **Settlement and testkit.** `pnpm snap --settlement=local` fails on `main` since PR 113 promoted `error.submission-limit`: on the contract an attempt-2 delivery is `invalid_terms`, not `submission_limit_reached`. Map the contract's refusal, or exclude the fixture on the contract with a reason.
- **T-203.** Decision 4 described the handler's exemption for CPP-reclaimed holds. PR #122 removes it.
- **`formal/`.** The README's contract column can take review §5. The model has no CPP reclaim action.
- **`docs/neutrality.md`.** I-1 belongs in the Adjudicator row: on chain, the fallback needs a posted delivery.

**After the fix PRs merge.** Regenerate `reports/differential-local.md` (`pnpm snap --settlement=local`) and `contracts/.gas-snapshot` (`forge snapshot`) once, and record the combined `HoldbackRules` size in Evidence.
