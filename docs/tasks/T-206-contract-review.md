# T-206: Contract review, then an optional Sepolia deployment (human gate)

- **Lane:** settlement (reviewer role; reviews, does not edit contract code)
- **Phase:** 2
- **Depends on:** T-202, T-203 and T-205 merged; T-204 merged, or its model-to-contract mapping listed as an open item.
- **Paths this task may touch:** `docs/reviews/2026-11-03-contract-review.md` (new), `docs/neutrality.md` ("How neutrality is tested", the contract review checklist only), `contracts/deployments/sepolia.json` (new, only after Rafa approves a deployment; under `contracts/` because the operators load it from there), `docs/tasks/T-206-contract-review.md`.
  - Extended by the coordinating session (Decisions 1):
    - the five fix PRs' paths in `contracts/`, with `reports/differential-local.md` and `contracts/.gas-snapshot` regenerated once here (the differential report now matches `main`'s, which PR #138 regenerated on the fixed contracts);
    - the follow-up records: `docs/tasks/T-210…T-212`, `docs/plan.md`, `docs/backlog.md`, and D37 in `docs/decisions-today.md`;
    - in `docs/tasks/T-202-escrow-rules-contract.md`, the lines on carried deliveries and bond reservations (the bonds row, Decision 1, Decision 4, differences 5 and 8) and the new difference 16;
    - the amendment section of `docs/decisions/ADR-0016-phase1-contract.md`;
    - the two control-point rows of `docs/neutrality.md` that name this checklist;
    - for the deployment, `contracts/script/deploy-sepolia.sh` and a section of `docs/operations.md`.
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
- [ ] Rafa has read the review (recorded here with date). Only then, and only if he approves in writing in this file: a Sepolia deployment whose verified bytecode matches the reviewed commit, addresses in `contracts/deployments/sepolia.json`, and one happy-path deal run on Sepolia with its gas recorded (measured). The approval came first, by Rafa's choice (Decisions 7). The deployment is recorded in its own PR; the happy-path deal belongs to the Sepolia demo session.

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
  | H-2 | #125 | `test/unit/AppealKey.t.sol` (7 tests). `invariant_keyOnlyWithPayment`, with the targeted `decideAppeal` action, fails on `main` for some seeds (for example `--fuzz-seed 2`). | 6 |
  | M-2 | #127 | `test/unit/LateCarriedDelivery.t.sol` (7 tests); `invariant_timeoutsExactlyWhenDue` fails on `main` with "a delivery landed at or after deliverBy". | 4 |
  | M-3 | #135 | `test/unit/BondConsent.t.sol` (6 tests). Deleting the fallback's reservation fails two invariants (with the `decideFallback` action). | 4 |

- **measured** `pnpm verify` on each fix branch: every step passes, including all forge tests and invariants, and there are no snapshot diffs. The exception is `pnpm snap --settlement=local`, which failed on `main` from PR 113 until PR #139 on `error.submission-limit`, whether or not a T-206 change was applied (24 passed, 1 failed, 3 excluded). PR #139 fixed it in the settlement adapter. On this branch merged with `main` at `3877f57`, it passes 25 of 25, with 25 transcripts identical to SimChain and 3 excluded. The report it writes is byte-identical to `main`'s. First fix branch, at `baac930`:

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
  | #120's branch on `main` (`7425c19`) | 24,046 |
  | #125's branch (`7cca926`, with #120 and #122) | 24,517 |
  | #127's branch (`9b3d7f2`, with #120 and #122) | 24,429 |
  | #135's first commit `f685f09` (on `53b924d`, before #125 and #127) | 23,880 |
  | `main` at `7c48650` (#120, #122, #125, #127) | 24,536 (40 under) |
  | `main` at `cc834fc`, with all five fixes | 23,986 (590 under) |

  `HoldbackBonds` is 2,395 bytes and `DrandQuicknetBeacon` 3,269.
- **measured by the cross-check (PR #137)** No high or medium issue against our use of CPP, Permit2, Solady or USDC, and none in the drand verifier. It found two mediums:
  - M-3, in the contract, fixed in #135;
  - PA-M2, the front-runnable operator-fee bundle. That one is outside `contracts/src` (`packages/settlement/evm/evm-settlement.ts`), and its mitigation is in PR #138.

  It also found the lows L-7 and L-8 and two beacon lows (review I-12, I-13).
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
     - a fresh throwaway deployer key, never printed. The coordinating session asked for an encrypted Foundry keystore with its password in a 0600 file, both in a git-ignored path and never in `.env*`. That departs from this task's human-gate line ("a deployer key from an environment variable") and from `CLAUDE.md`'s environment-variable rule for secrets, and is recorded here as an exception.
       - The keystore and its password file are in Foundry's default keystore directory, `~/.foundry/keystores/`, outside the repository and every checkout. They were moved there from the main checkout's ignored `reports/` after review, because agents and `pnpm verify` read that directory.
       - The key has no authority on chain: the contracts have no admin keys, so it pays gas and nothing else.
     - `forge create --broadcast` per contract (no `forge script`, no `cast send`);
     - the core set, with the token chosen by the Sepolia demo session (Rafa: "For the first wave of the service, lets assume USDC only"). That session's TestUSDC is deployed with the core set if its PR (#138) is on `main` when the deploy runs; otherwise that session deploys it.
   - **Second-hand.** The approval reached this session through the coordinating session; nothing in the repo is from Rafa directly. Rafa confirms it on the deploy PR.
   - **Added by Rafa:** a cross-check of the custom contracts against public audit work ("You should find public audits of escrow related contracts such that any custom smart-contract we are deploying has been reviewed against public audit work"). It reported two mediums and nothing high. M-3 is in the contract and fixed (#135). PA-M2 is in the EVM adapter, outside `contracts/src`; its mitigation is in PR #138 (open). It found no high or medium issue in our use of the audited dependencies, or in the beacon.
   - **PA-M2 does not gate the contract deploy.** It lives in the relayer, not in any deployed contract. The Sepolia demo stays behind its flag until #138, which carries the mitigation, merges.
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
- **Settlement and testkit.** Done in PR #139: the adapter now maps the contract's refusal of an attempt-2 delivery to `submission_limit_reached`, so `error.submission-limit` passes on the contract. CI still does not run `pnpm snap --settlement=local` (backlog, T-034).
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
- **Docs and the agent guide.**
  - I-1 (on chain, the fallback needs a posted delivery) belongs in `docs/neutrality.md`'s Adjudicator row.
  - That row and the Appeal adjudicator row say a silent adjudicator's bond compensates the seller on default. They should add "Phase 4; needs a consent step (backlog: Consent for default compensation)", since after M-3 a silent adjudicator holds no reservation.
  - I-4 (EIP-7702 accounts) belongs in the agent docs.

**After the fix PRs merge.**
- Regenerate `reports/differential-local.md` (`pnpm snap --settlement=local`) and `contracts/.gas-snapshot` (`forge snapshot`) once, in this PR. Done; after the merges of #139 and #138 the differential report equals `main`'s.
- Record the final `HoldbackRules` size in Evidence.
