# T-220: Ship round 1's prerequisites to the live demo

- **Lane:** demo, infra
- **Phase:** 2
- **Depends on:** T-217, T-218, T-219 and T-221, merged first (this task edits `apps/demo-cloud/src/world.ts` and `worker.ts` after them). The record of the 0.7 redeploy is on main (PR 169).
- **Paths this task may touch:** `apps/demo-cloud/src/world.ts` (the chain world's rulebook names `drand-quicknet`; the demo adjudicators get T-217's drand source; the drand notice); `site/llms.txt` (the honest limits) and the site's build outputs; `docs/operations.md` (live versions, rollback targets); `README.md` (Status, only where it states these limits); `docs/backlog.md`; `docs/plan.md` (this row); this file
- **Human gate:** yes. The Worker and site deploys wait for Rafa's go-ahead; the PR itself is in-repo.
- **Status:** todo
- **Agent/session:** —

## Intent

The fixed contracts (PRs 160 and 161) are on Sepolia, and the public demo has run on them since 2026-11-04, about 08:30 UTC. The T-206 session redeployed them and cut the demo over, with Rafa's go-ahead ("Yes, redeploy now"). Its world is `holdback-public-demo-sepolia-2026-11-04`. Measured the same day: `/v1/status` serves schema 0.9 and EIP-712 domain "Holdback" 0.7, with `verifyingContract` `0xf38287e5c5c1f20c6d03be500edbf8a244f27cfa`.

T-217, T-218, T-219 and T-221 (adjudicator registration through the API) change the Workers' code, so they reach the live demo only with a deploy. T-217 also changes the demo club's rulebook. The world keeps its name: each stored deal carries the rulebook it was offered under (`Book.club`), and only a new offer is checked against the current rulebook (measured, `docs/research/2026-11-04-one-world.md`). So the rulebook changes in place, and the demo adjudicators keep their keys and bonds (Rafa, 2026-11-04: "Yes, keep the world"; D49).

Restated: one deploy brings all four live before round 1 (T-216). It keeps the Sepolia world and changes its rulebook in place to name drand, and the agent docs say what changed. No contract changes. Rafa chose one deploy over a deploy per task on 2026-11-04 (T-216, scope question 5).

## Context

- `docs/operations.md`: "Settlement: SimChain or Sepolia", the deploy order, rollback.
- T-213 (the first cutover: its order and measurements, and the one deploy refused at start-up).
- T-212 Handoff: the redeploy runbook the T-206 session followed, and its entry "Redeployed and cut over, 2026-11-04", with the gas measured on the 0.7 contracts.
- `docs/update-flow.md` (the manual flows from `workers` and `agentdocs`).

## Acceptance criteria

- [ ] Rafa's go-ahead, quoted with its date.
- [ ] **A fork run before the deploy.** On a Sepolia fork, the world built from this commit:
  - finds its three adjudicators bonded and sends nothing;
  - applies the rulebook change to a world opened before it: the old deal keeps its `rulebookHash` and moves on, and an offer bound to the old hash gets 422 `rulebook_unknown`;
  - runs `examples/try.ts` to Released;
  - decides, through the fallback with a drand proof, a deal whose primary stays silent;
  - shows a direct `deliver` in the view;
  - registers an outside adjudicator through the API and settles a deal in which it is the primary;
  - applies, when it reopens, a transaction it broadcast before being stopped.
- [ ] **The rulebook, in place.** The world name stays `holdback-public-demo-sepolia-2026-11-04`.
  - Its rulebook names `drand-quicknet` with quicknet's chain hash, and `GET /v1/clubs/demo-club` serves the new `rulebookHash`.
  - Each demo adjudicator reads rounds through T-217's drand source, and the "drand not yet" notice is gone.
  - Deals opened before the deploy keep their old `rulebookHash` and state: list them before, and read them after.
- [ ] **No deal left behind.** Open deals continue in the same world. The one effect is on an offer prepared before the deploy and posted after it: 422 `rulebook_unknown`, whose text says to read the club again. Check that every deal open at the deploy reads the same state afterwards.
- [ ] **The gas quote stays as it is.** The redeploy measured 1,636,242 gas for a three-transaction deal on the 0.7 contracts, about 4.9 % above the 0.6 figure (T-212 Handoff). The quote was deliberately left at 4.70 tUSDC (`OPERATOR_FEE_GAS` 4700000, a 4.71 tUSDC minimum), for T-215 to replace with live gas and prices. This deploy does not change it unless T-215 has landed.
- [ ] **Deploy both Workers together, then the site,** as the 0.7 cutover did (`pnpm demo-cloud:deploy`; `docs/operations.md`).
  - The world names live in the shared `worker.ts`, and the Durable Object always runs holdback-op1's code (op2's `WORLD` binding is op1's `World` class).
  - The code being replaced has no in-flight row, so deploy while no deal is mid-step.
  - Then run the smoke test (Released, three Etherscan links), then deploy the site.
  - The setup pass finds the bonds in place and sends nothing: `bonded` stays 3, and the funding lane's balance is unchanged (read it before and after).
- [ ] **Live checks.**
  - The homepage command runs end to end against both nodes.
  - `llms.txt` states what changed: fallback and appeal adjudicators decide with drand proofs, direct calls show in the view, and an agent can register its own adjudicator. It also keeps the honest limits that remain. The text comes from T-217's, T-218's, T-219's and T-221's Handoffs.
  - Its "State may reset" line becomes: "The operators' view is kept across deploys. It starts over only when the settlement contracts are redeployed; what happened on Sepolia stays there. Keep your own copy of the terms you signed."
  - `node site/build.mjs && node site/check.mjs` pass.
- [ ] **Rollback, written down:** the previous Worker versions and the previous site build. The world is the same under the old code. Deals offered under the drand rulebook keep their book, their fallback and appeal panels fall back to the default outcome under the old adjudicator code, and money is unaffected (inferred, `docs/research/2026-11-04-one-world.md`).
- [ ] **Docs:** `docs/operations.md` (live versions, rollback targets), and `README.md` where it states these limits.
- [ ] **Review.** The `reviewer` role with project context; CI green.

## Out of scope

- Contract changes. T-212's open items (1, 2, 4, 5, 6 and 8) block mainnet, not Sepolia; each is a later redeploy.
- Mainnet.
- Withdrawing the demo adjudicators' bonds from the earlier vaults, a chore once the old deals close.
- A new world name. D49 allows one only for a new rules contract or another chain.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

- D49: one long-lived world; this deploy changes the rulebook in place.

## Handoff
