# T-220: Redeploy the fixed contracts on Sepolia and cut the demo over to them

- **Lane:** settlement, demo, infra
- **Phase:** 2
- **Depends on:** T-212 items 3, 7 and 9 (PRs 160 and 161, merged). Stage B also waits for T-217, T-218 and T-219 to merge, in the order proposed in round 1's scope questions (question 5); it edits `apps/demo-cloud/src/world.ts` and `worker.ts` after them. T-033 is optional: its additive v0.9 items change no contract code, so they ride along with Stage B if merged by then.
- **Paths this task may touch:**
  - Stage A: `contracts/deployments/` (the new record in `sepolia.json`, the 0.6 record kept beside it under another name), `examples/deployments.ts` and its test, the pinned domain and deployment in `site/llms.txt`, and the site's build outputs.
  - Stage B: `apps/demo-cloud/src/worker.ts` (the new Sepolia world's name), `apps/demo-cloud/src/world.ts` (the chain world's rulebook names `drand-quicknet`; the drand notice), `apps/demo-cloud/wrangler.op1.jsonc` and `wrangler.op2.jsonc` (`OPERATOR_FEE_GAS`), `site/llms.txt` (the honest limits) and the site's build outputs, `docs/operations.md`, `README.md` (Status), `SECURITY.md` (Scope, only if it names addresses), `docs/api.md` (only if a served field changes).
  - Both: `docs/backlog.md`, `docs/plan.md` (this row), this file.
  - Not `contracts/script/deploy-sepolia.sh`: the T-206 session keeps the deploy script and the redeploy runbook (T-212 Handoff). A change it needs goes in this task's Handoff and to that session.
- **Human gate:** yes, twice. Stage A deploys contracts to a public testnet with the throwaway deployer key. Stage B deploys the Workers and the site. Each waits for Rafa's go-ahead; the PRs themselves are in-repo.
- **Status:** todo
- **Agent/session:** —

## Intent

The live demo settles on the 0.6 contracts (T-206, PR 150), which have neither the overturn payout from the first decider's bond (D43, PR 160) nor the binding of each decision to its delivery (D44, PR 161). Main signs under EIP-712 domain 0.7, so no Worker or site can be deployed from main until the 0.7 contracts are on Sepolia (`docs/operations.md`, Schema).

Restated:
- **Stage A:** deploy the fixed set as a new deployment, and record it.
- **Stage B:** move the demo to it with a fresh world whose rulebook names drand, so round 1 (T-216) runs on the reviewed code.

Deals already open on the 0.6 deployment finish there through their permissionless timeouts.

The steps are the redeploy runbook in `docs/tasks/T-212-contract-hardening.md` (Handoff, item 3, steps 1 to 7; step 7, each demo adjudicator's domain, is added by PR 166) and ADR-0029 §8. This task adds acceptance criteria, the order with T-217 to T-219, and the evidence.

## Context

- `docs/operations.md`: "Settlement: SimChain or Sepolia", the cutover order, rollback, "Sepolia contracts (T-206)", and the deployer key's custody.
- ADR-0028, ADR-0029 §8, T-213 (the first cutover: its order, measurements and the one deploy refused at start-up), T-215 (the gas share; it reads this task's gas figures).
- `docs/update-flow.md`: what a contracts change must also update (the manual flows from `contracts`).

## Acceptance criteria

**Stage A: the contracts**
- [ ] Rafa's go-ahead, quoted with its date.
- [ ] **The deploy.** `contracts/script/deploy-sepolia.sh` deploys `HoldbackRules`, which deploys its `HoldbackBonds`. It runs from a main commit with PRs 160 and 161, over the same CPP escrow, collectors, `EXPIRY_MARGIN` (86,400), `DrandQuicknetBeacon` and tUSDC. The deployer's Sepolia ETH balance is checked first; if it is short, ask Rafa.
- [ ] **The checks.**
  - `deploy-sepolia.sh --check` passes, read-only, and its derived record equals the committed one.
  - `eip712Domain()` reads "Holdback" 0.7.
  - `BEACON().codehash` equals the `DrandQuicknetBeacon` runtime.
  - The contracts have no owner, pause or admin selector (the no-admin checks).
- [ ] **The record.** `contracts/deployments/sepolia.json` names the new deployment, and the 0.6 record stays readable beside it. `examples/deployments.ts` and the pins in `site/llms.txt` name the new contracts. `pnpm test` (`examples/deployments.test.ts`) and `node site/build.mjs && node site/check.mjs` pass.
- [ ] **Gas, re-measured** on the new deployment with `eth_simulateV1` or `eth_estimateGas` (nothing sent beyond the deploy): funding with the fee, a delivery, a decision, an early accept, a fallback decision, and a party appeal decision that slashes. Recorded here for T-215. ADR-0029's new slot cost about 22,000 gas on anvil and may cost about 77,000 on Sepolia (inferred, T-212).

**Stage B: the cutover**
- [ ] Rafa's go-ahead for the Worker and site deploys, quoted with its date.
- [ ] **A fork run before any deploy.** On a Sepolia fork with the new contracts, the world built from this commit bonds its three adjudicators, and `examples/try.ts` reaches Released. With T-217 merged, a deal whose primary stays silent is decided by the fallback with a drand proof.
- [ ] **The new world.**
  - A new Sepolia world name.
  - Its rulebook names `drand-quicknet` with quicknet's chain hash (a rulebook change needs a fresh world anyway), and the "drand not yet" notice is gone.
  - `OPERATOR_FEE_GAS` comes from the re-measured gas.
- [ ] **Each demo adjudicator's EIP-712 domain** names the new rules contract (T-212 Handoff, step 7).
- [ ] **The deploy order** of `docs/operations.md`:
  1. op2 first, then the smoke test: Released, with three Etherscan links on the new rules address;
  2. the site;
  3. op1.

  The setup pass bonds the three demo adjudicators in the new vault. Measure the time it takes, the gas, and the ETH it spends from the funding lane; check the lane's balance first.
- [ ] **Live checks.** The homepage command runs end to end against both nodes. `llms.txt` states what changed: the 0.7 messages; fallback and appeal adjudicators decide with drand proofs; direct calls show in the view; the honest limits that remain (from T-217's, T-218's and T-219's Handoffs).
- [ ] **Rollback, written down:** the previous Worker versions, the old world's name, and the previous site build. Deals open on the 0.6 deployment finish there through their permissionless timeouts. Once the Workers switch, the old world's view is no longer served; state that.
- [ ] **Docs,** per `docs/update-flow.md`'s manual flows from `contracts`:
  - `docs/operations.md`: live versions and rollback targets; the Schema warning lifted;
  - `README.md` Status;
  - `SECURITY.md` Scope, if it names addresses;
  - `docs/api.md`, if a served field changed.

  The contract-stack page on claude.ai, outside the repository, is republished; record that in the Handoff.
- [ ] **Review.** Each PR reviewed by the `reviewer` role with project context; CI green.

## Out of scope

- Mainnet.
- T-212's open items (1, 2, 4, 5, 6 and 8): they block mainnet, not Sepolia; each is a later redeploy.
- Withdrawing the demo adjudicators' bonds from the 0.6 vault, a chore once the old deals close.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
