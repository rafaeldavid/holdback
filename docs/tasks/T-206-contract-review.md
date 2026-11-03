# T-206: Contract review, then an optional Sepolia deployment (human gate)

- **Lane:** settlement (reviewer role; reviews, does not edit contract code)
- **Phase:** 2
- **Depends on:** T-202, T-203 and T-205 merged; T-204 merged, or its model-to-contract mapping listed as an open item.
- **Paths this task may touch:** `docs/reviews/2026-11-03-contract-review.md` (new), `docs/neutrality.md` ("How neutrality is tested", the contract review checklist only), `deployments/sepolia.json` (new, only after Rafa approves a deployment), `docs/tasks/T-206-contract-review.md`.
  - Extended by the coordinating session (Decisions 1):
    - the five fix PRs' paths in `contracts/`, with `reports/differential-local.md` and `contracts/.gas-snapshot` regenerated once here;
    - the follow-up records: `docs/tasks/T-210…T-212`, `docs/plan.md`, `docs/backlog.md`, D37 in `docs/decisions-today.md`, and the carried-delivery lines of `docs/tasks/T-202-escrow-rules-contract.md`;
    - the two control-point rows of `docs/neutrality.md` that name this checklist;
    - for the deployment, `contracts/script/deploy-sepolia.sh`, `contracts/deployments/sepolia.json` and a section of `docs/operations.md`.
- **Human gate:** **yes.** (1) Rafa reads the review before Phase 2 is called done. (2) Any Sepolia deployment needs Rafa's explicit approval written in this file first: test ETH and a test token only, a deployer key from an environment variable, never printed. No mainnet, at any point; a mainnet deployment is a separate gate after an external audit and legal advice (D4).
- **Status:** review. Open: the cross-family pass and Rafa's read. The Sepolia deploy is approved (Decisions 7) and recorded in its own PR.
- **Agent/session:** a Claude Opus 5.5 session in worktree `t-206-contract-review-d83e9c`, 2026-11-03, with:
  - a Claude Fable 5.1 red-teamer subagent;
  - a separate public-audit cross-check session;
  - reviewer subagents for each PR.

## Intent

Review the Phase 2 contracts against the neutrality checklist, the hold invariants and the ADRs they implement, with two independent reviewers from different model families, so one family's blind spots do not pass unseen. Findings become follow-up tasks for T-202's paths; this task changes no contract code. If Rafa approves, deploy the reviewed bytecode to Sepolia so Phase 5 and T-207's Prividium spike have a public test deployment.

**Restated.**
- Check `contracts/src/` at one commit, `baac930`, against three things: the no-admin hard rule; the hold's invariants (conservation, settle-once, expiry and reclaim, key with payment); and ADR-0003, ADR-0012, ADR-0016, ADR-0018 and ADR-0022.
- Answer each checklist item with a line or a test.
- Run static analysis and triage the results. Map the T-204 model onto the contract.
- Have an adversarial reviewer, briefed with the project context but not with the first reviewer's notes, try to break each litmus test.
- Give every finding a severity, a label, and a fix or a written acceptance.
- The coordinating session also asked for the high and medium findings to be fixed in focused PRs with regression tests (Decisions 1).
- No deployment until Rafa's approval and the gates in Decisions 7.

## Context

- `docs/neutrality.md` (control-point table, contract review checklist); ADR-0001, ADR-0002, ADR-0003 (and its T-201 outcome), ADR-0012, ADR-0018, ADR-0022, ADR-0023.
- T-202 Decisions, T-203 Evidence (invariants and mutants), T-204 model and its mapping, T-205 differential report and gas.
- `.claude/agents/` reviewer role; `docs/team.md` Rules and checks.

## Acceptance criteria

- [x] The checklist in `docs/neutrality.md` is expanded into checkable items, and each item is answered with a file and line or a test name (review §3). The items: no owner, pause, freeze, blacklist, upgrade proxy, `selfdestruct` or mutable `delegatecall`; every timeout callable by anyone; no function moves held funds without a signature, decision or expired timeout; settle-once; key release in the same transaction as capture; expiry margin per ADR-0003.
- [x] Static analysis run with Slither 0.11.6 and Aderyn 0.6.8. Every high and medium finding is accepted with a reason, since none is a defect (review §4; counts below).
- [ ] Two reviews from two model families, each run without seeing the other's output, recorded in `docs/reviews/2026-11-03-contract-review.md` with the model IDs used; disagreements listed. Not met: the independent passes ran, but all are Anthropic models (`claude-opus-5-5`, `claude-fable-5-1`). The cross-family pass is a human gate (Handoff).
- [x] Each high, medium and low finding is labelled measured, inferred or guessed, with a severity, and has a fix PR, a follow-up task (T-210, T-211, T-212) or a written acceptance (L-3). Each informational item has a label and a disposition.
- [x] The model-to-contract correspondence from T-204 checked. Every model action maps to a contract function, and the gaps are findings (review §5).
- [ ] Rafa has read the review (recorded here with date). Only then, and only if he approves in writing in this file: a Sepolia deployment whose verified bytecode matches the reviewed commit, addresses in `deployments/sepolia.json`, and one happy-path deal run on Sepolia with its gas recorded (measured). The approval came first, by Rafa's choice (Decisions 7). The deployment is recorded in its own PR; the happy-path deal belongs to the Sepolia demo session.

## Out of scope

- Fixing findings (T-202 follow-ups); an external paid audit; any mainnet action; paymasters (Phase 5). The coordinating session brought the high and medium fixes into scope (Decisions 1).

## Evidence

- **measured** Baseline `forge test`: 168 tests pass at `baac930`, and 143 on `main` after PR 113 removed redundant tests.
- **measured** Static analysis over `contracts/src/` at `baac930`. Each high and medium result is triaged in review §4.

  | Tool | High | Medium | Low | Info |
  | --- | --- | --- | --- | --- |
  | Slither 0.11.6 | 1 | 16 | 40 | 20 |
  | Aderyn 0.6.8 | 3 (11 instances) | — | 8 | — |

- **measured (local, not in the repo)** The adversarial pass wrote 24 proof-of-concept tests (17 attacks, 7 defenses) in its own worktree. All 24 pass against `baac930`, which for an attack test means the attack works. Copies are in the coordinating session's notes folder.
- **measured** Fix PRs. Each one's regression tests fail on `main` and pass on the branch.

  | Finding | PR | Regression | Failing on `main` |
  | --- | --- | --- | --- |
  | H-1 | #120 | `test/unit/AppealAttempt.t.sol` (7 tests). Limiting the check to the appeal role fails 3 more. | 2 |
  | M-1 | #122 | `test/unit/AfterCppReclaim.t.sol` (7 tests). An always-skip mutant fails 2; `invariant_timeoutsExactlyWhenDue` fails on `main`. | 5 |
  | H-2 | #125 | `test/unit/AppealKey.t.sol` (7 tests); `invariant_keyOnlyWithPayment` fails on `main` with the targeted `decideAppeal` action. | 6 |
  | M-2 | #127 | `test/unit/LateCarriedDelivery.t.sol` (7 tests); `invariant_timeoutsExactlyWhenDue` fails on `main` with "a delivery landed at or after deliverBy". | 4 |
  | M-3 | #135 | `test/unit/BondConsent.t.sol` (6 tests). Deleting the fallback's reservation fails two invariants (with the `decideFallback` action). | 4 |

- **measured** `pnpm verify` on each fix branch: every step passes, including all forge tests and invariants, and there are no snapshot diffs. The exception is `pnpm snap --settlement=local`, which on `main` since PR 113 fails on `error.submission-limit` whether or not a T-206 change is applied (24 passed, 1 failed, 3 excluded). That failure is handed off below. First fix branch, at `baac930`:

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

- **measured** `HoldbackRules` runtime with `forge build --sizes` (EIP-170 limit 24,576 bytes):

  | Build | Bytes |
  | --- | --- |
  | `baac930` | 24,051 |
  | `main` + #120 | 24,046 |
  | `main` + #120 + #122 + #125 | 24,517 |
  | `main` + #127 | 24,429 |
  | `main` + #135 | 23,880 |
  | `main` at `cc834fc`, with all five fixes | 23,986 (590 under) |

  `HoldbackBonds` is 2,395 bytes and `DrandQuicknetBeacon` 3,269.
- **measured** The public-audit cross-check found no high or medium issue against our use of CPP, Permit2, Solady or USDC, and none in the drand verifier. It found M-3 and two beacon lows (review I-12, I-13).
- **measured** Sepolia facts, read-only RPC:
  - chain ID 11155111;
  - base fee 17 wei, priority fee 2 wei;
  - Permit2 and Multicall3 deployed, with code hashes pinned in the deploy script;
  - EIP-2537 live: `MAP_FP_TO_G1` returns a G1 point;
  - deployer `0x1A4435488eaF1A37d2327d44Fe67e97d83203B64` funded with 0.1075 ETH.
- **inferred** No non-Anthropic model key is exposed by name in the environment: only `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL`. `.env*` files were not read.

## Decisions

1. **Fixes inside the review.** The task file says the review changes no contract code. The coordinating session asked for each high and medium finding to be fixed in a focused PR with regression tests instead: #120, #122, #125, #127 and #135. The parts in other lanes stop at the lane boundary and are follow-up tasks: core and SimChain in T-210, the reference adjudicator in T-211.
2. **Review file name.** `docs/reviews/2026-11-03-contract-review.md`, dated like the other reviews; the paths line had said `2026-11-contract-review.md`.
3. **M-2 amends D37 point 1 and T-202 difference 5.** A delivery lands only before `deliverBy`, whichever call carries it, as core, the EVM adapter and the formal model already require. A buyer who wants late work settles for it with the seller. The research pass was the Fable adversarial review at max effort, and both review passes agree. Recorded under D37; Rafa may overrule.
4. **H-2 reverts rather than dropping the key.** The decision's calldata carries the key either way, so dropping `KeyReleased` would hide a leak the contract cannot prevent. A refused appeal stays open: the same verdict re-signed without the key settles it, and `expireAppeal` closes it otherwise.
5. **Severity disagreements** are in review §6. Where the passes disagreed, the higher severity was kept whenever an honest path reaches the failure (H-2, M-2) or the cost to the attacker is near zero on the deployment that matters (M-3 on Sepolia).
6. **Low findings block mainnet, not the Sepolia testnet.** Testnet money is worthless. T-212 runs before any mainnet deployment.
7. **Sepolia approval.** Rafa, relayed by the coordinating session on 2026-11-03: "You can deploy on Sepolia, just give me the address you need faucet funds to if you can't get them yourself."
   - **Gates set with it:**
     - the high and medium fixes merged, with `forge test` green on `main`;
     - Sepolia only, with the deploy refusing any other chain ID;
     - a fresh throwaway deployer key in an encrypted keystore, never printed;
     - `forge create --broadcast` per contract (no `forge script`, no `cast send`);
     - the core set without a token: Rafa said "For the first wave of the service, lets assume USDC only".
   - **Added by Rafa:** a cross-check of the custom contracts against public audit work ("You should find public audits of escrow related contracts such that any custom smart-contract we are deploying has been reviewed against public audit work"). It reported with no high or medium finding beyond M-3, which is fixed.
   - **`EXPIRY_MARGIN`** is 1 day (review §7).
8. **Adversarial reviews carry the project context** (Rafa: "For adversarial reviews, you should use the project context, not use completely anon agents without context"). The Fable pass was briefed with `CLAUDE.md`, the ADRs, T-202's difference list and the reference state machine. Every per-PR reviewer read the project docs. Independence meant withholding the first pass's findings, not the context.
9. **USDC issuer freezes are out of scope.** Rafa: "this is not an issue, buyer and seller agree to use USDC in the terms of their own contract … park it for later in a roadmap module about assets". Review I-7 records this.

## Handoff

**State.**
- The review is written.
- All five fix PRs are merged (#120, #122, #125, #127, #135), each after its reviewer returned PASS and CI was green.
- The cross-family pass and Rafa's read are open.
- The Sepolia deploy follows the merges, in its own PR (Decisions 7).

**For Rafa: the cross-family review (gate).** Run a reviewer from another model family, for example an OpenAI or Google model, with the brief below and without the review document:

> Review the Solidity settlement contracts in `contracts/src/` of rafaeldavid/holdback at commit `baac930`, then the five fix PRs #120, #122, #125, #127 and #135. Read `CLAUDE.md` (hard rules and litmus tests), `docs/neutrality.md`, `docs/judgment-and-defenses.md`, and ADR-0003, ADR-0012, ADR-0016, ADR-0018 and ADR-0022. The contracts drive Commerce Payments' `AuthCaptureEscrow` v1.1.0 (vendored, unmodified) as its operator, have no admin keys, and release a sealed content key with the payment. Try to break three properties: (1) no single party can stop a valid commitment from settling, or move or lock held funds or bonds outside its terms; (2) the hold (conservation, settle-once, expiry, reclaim, key with payment); (3) panel seeds the decider cannot choose. For each finding give a severity, file:line, the attack sequence, a measured, inferred or guessed label, and the smallest fix. Run `forge test` from `contracts/`. No deployment and no RPC.

Append its findings to the review as a new section, with a disagreement table against §2, and tick the acceptance item.

**Follow-up tasks.**
- **T-210** (core, SimChain): mirror H-1 and H-2.
- **T-211** (judgment): the reference adjudicator never seals the key for a refunded buyer. This is a prerequisite for appeals on the Sepolia demo.
- **T-212** (settlement): the low findings, before mainnet.

**Notes for other lanes.**
- **Settlement and testkit.** `pnpm snap --settlement=local` fails on `main` since PR 113 promoted `error.submission-limit`. On the contract, an attempt-2 delivery is refused as `invalid_terms`, not `submission_limit_reached`. Map the contract's refusal, or exclude the fixture on the contract with a reason.
- **Sepolia demo.**
  - The cross-check found that the operator-fee bundle can be front-run (`packages/settlement/evm/evm-settlement.ts`). ADR-0023 already lists this residual and names its mitigation, relaying `agreeAndFund` alone, but the code lacked it. The demo session reports it fixed on its branch.
  - Until T-211 lands, the reference adjudicator's overturn-to-accept appeals revert on chain (H-2).
- **T-203.** The fix PRs edited T-203's harness (`contracts/test/handlers/RulesHandler.sol`, `contracts/test/invariant/RulesInvariants.t.sol`, `contracts/test/fuzz/NoAdmin.fuzz.t.sol`):
  - #122 removed the exemption for CPP-reclaimed holds that T-203 Decisions 4 described.
  - #125 added `invariant_keyOnlyWithPayment` and the `decideAppeal` action.
  - #127 added the late-delivery check.
  - #135 added the `decideFallback` action and removed `tryEncumber` from the allowlist.
  - Successful appeal decisions remain rare in a campaign (a T-203 follow-up). The unit tests catch each regression.
- **`formal/`.** The README's contract column can take review §5. The model has no CPP reclaim action and no bond coverage.
- **Docs and the agent guide.** I-1 (on chain, the fallback needs a posted delivery) belongs in `docs/neutrality.md`'s Adjudicator row. I-4 (EIP-7702 accounts) belongs in the agent docs.

**After the fix PRs merge.**
- Regenerate `reports/differential-local.md` (`pnpm snap --settlement=local`) and `contracts/.gas-snapshot` (`forge snapshot`) once, in this PR.
- Record the final `HoldbackRules` size in Evidence.
