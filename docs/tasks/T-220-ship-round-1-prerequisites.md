# T-220: Ship round 1's prerequisites to the live demo

- **Lane:** demo, infra
- **Phase:** 2
- **Depends on:** T-217, T-218 and T-219, merged first (this task edits `apps/demo-cloud/src/world.ts` and `worker.ts` after them). The record of the 0.7 redeploy is on main (PR 169).
- **Paths this task may touch:** `apps/demo-cloud/src/worker.ts` (a new Sepolia world name); `apps/demo-cloud/src/world.ts` (the chain world's rulebook names `drand-quicknet`; the drand notice); `site/llms.txt` (the honest limits) and the site's build outputs; `docs/operations.md` (live versions, rollback targets); `README.md` (Status, only where it states these limits); `docs/backlog.md`; `docs/plan.md` (this row); this file
- **Human gate:** yes. The Worker and site deploys wait for Rafa's go-ahead; the PR itself is in-repo.
- **Status:** todo
- **Agent/session:** —

## Intent

The fixed contracts (PRs 160 and 161) are on Sepolia, and the public demo has run on them since 2026-11-04, about 08:30 UTC. The T-206 session redeployed them and cut the demo over, with Rafa's go-ahead ("Yes, redeploy now"). Its world is `holdback-public-demo-sepolia-2026-11-04`. Measured the same day: `/v1/status` serves schema 0.9 and EIP-712 domain "Holdback" 0.7, with `verifyingContract` `0xf38287e5c5c1f20c6d03be500edbf8a244f27cfa`.

T-217, T-218 and T-219 change the Workers' code, so they reach the live demo only with a deploy. T-217 also changes the demo club's rulebook, which needs a fresh world: a world fixes its club when it is created (`docs/backlog.md`, "A configuration change applies only to a fresh world").

Restated: one deploy brings all three live before round 1 (T-216). It starts a fresh Sepolia world whose rulebook names drand, and the agent docs say what changed. No contract changes.

## Context

- `docs/operations.md`: "Settlement: SimChain or Sepolia", the deploy order, rollback.
- T-213 (the first cutover: its order and measurements, and the one deploy refused at start-up).
- T-212 Handoff: the redeploy runbook the T-206 session followed, and its entry "Redeployed and cut over, 2026-11-04", with the gas measured on the 0.7 contracts.
- `docs/update-flow.md` (the manual flows from `workers` and `agentdocs`).

## Acceptance criteria

- [ ] Rafa's go-ahead, quoted with its date.
- [ ] **A fork run before the deploy.** On a Sepolia fork, the world built from this commit:
  - bonds its three adjudicators;
  - runs `examples/try.ts` to Released;
  - decides, through the fallback with a drand proof, a deal whose primary stays silent;
  - shows a direct `deliver` in the view;
  - applies, when it reopens, a transaction it broadcast before being stopped.
- [ ] **The new world.** A new Sepolia world name. Its rulebook names `drand-quicknet` with quicknet's chain hash, and the "drand not yet" notice is gone.
- [ ] **The gas quote stays as it is.** The redeploy measured 1,636,242 gas for a three-transaction deal on the 0.7 contracts, about 4.9 % above the 0.6 figure (T-212 Handoff). The quote was deliberately left at 4.70 tUSDC (`OPERATOR_FEE_GAS` 4700000, a 4.71 tUSDC minimum), for T-215 to replace with live gas and prices. This deploy does not change it unless T-215 has landed.
- [ ] **The deploy order** of `docs/operations.md`:
  1. op2, then a smoke test (Released, three Etherscan links);
  2. the site;
  3. op1.

  The code being replaced has no in-flight row, so deploy op1 while no deal is mid-step. The setup pass bonds the three demo adjudicators in the new world. Measure the time it takes, the gas, and the ETH it spends from the funding lane; check the lane's balance first.
- [ ] **Live checks.**
  - The homepage command runs end to end against both nodes.
  - `llms.txt` states what changed: fallback and appeal adjudicators decide with drand proofs, and direct calls show in the view. It also keeps the honest limits that remain. The text comes from T-217's, T-218's and T-219's Handoffs.
  - `node site/build.mjs && node site/check.mjs` pass.
- [ ] **Rollback, written down:** the previous Worker versions, the previous world's name and the previous site build. Deals open in the previous world still finish on chain through their permissionless timeouts, but that world's view is no longer served once the Workers switch; state that.
- [ ] **Docs:** `docs/operations.md` (live versions, rollback targets), and `README.md` where it states these limits.
- [ ] **Review.** The `reviewer` role with project context; CI green.

## Out of scope

- Contract changes. T-212's open items (1, 2, 4, 5, 6 and 8) block mainnet, not Sepolia; each is a later redeploy.
- Mainnet.
- Withdrawing the demo adjudicators' bonds from the earlier vaults, a chore once the old deals close.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
