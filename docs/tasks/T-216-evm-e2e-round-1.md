# T-216: Full EVM end-to-end test round 1 on Sepolia

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-217 (drand proofs for fallback and appeal), T-218 (direct calls in the operators' view), T-219 (the in-flight row per relayer lane), and T-220, which ships those three to the live demo; Rafa's answers to the scope questions below. The fixed contracts are already live (see Context).
- **Paths this task may touch:** `scripts/e2e/` (new: the round's driver, its tests and a README), `docs/reviews/` (one new file, the round's report), `docs/backlog.md` (rows for what the round finds; the Benched rows once it completes), `docs/plan.md` (this row), this file. No product code: a scenario that fails gets its fix in its own task, and the round re-runs it.
- **Human gate:** yes. Rafa confirms the scope (the questions below) before the first run, and funds the round's own addresses with Sepolia ETH (or turns on the faucet's test ETH, a backlog row that is his call). The runs use the public API as any agent may, and send test transactions on Sepolia from test keys; they deploy nothing.
- **Status:** todo
- **Agent/session:** —

## Intent

Rafa's milestone (2026-11-04): "full EVM test end-to-end round 1 complete". It is the event that brings back the benched work: PR 151, the contribution rails, and T-206's human gate, his read of the contract review (`docs/backlog.md`, Benched).

Restated: on the live Sepolia deployment of the fixed contracts (PRs 160 and 161), show that every settlement path an agent can reach ends where the signed terms say, with each money step checkable on Etherscan. The paths run through the public API, and by direct contract calls where the API has no route or the point is to go past the operators. Each scenario is one or more real deals. Its evidence is the transactions, the chain's state and the operators' view, side by side.

- **Inputs:** the public API at api.escrow.stream and api2.escrow.stream; the deployment in `contracts/deployments/sepolia.json`; `site/llms.txt` as the API track's only guide (as T-213's `site/walkthrough.mjs` did); test keys derived from one environment variable.
- **Outputs:** a driver that runs each scenario and prints its evidence; the report; backlog rows or tasks for what fails.
- **Non-goals:** mainnet; the judgment's accuracy (Phase 3's calibration); Phase 4 economics (default compensation from bonds, the appeal fee, a minimum appeal bond), whose absence on chain is recorded, not passed; attacks (the red-team fixtures cover them on anvil); load.

## Context

- The draft scope: `docs/log/2026-11-04.md`, Next steps item 2 (inferred; Rafa confirms it here).
- ADR-0028 (§11, the staged items), D41, D43 (the overturn payout), D44 and ADR-0029 (decisions name the delivery), ADR-0005 (direct submission), ADR-0018 (the beacon).
- T-213 (the first cutover and its live evidence), T-212 (the fixes; the redeploy steps in its Handoff), `docs/reviews/2026-11-03-contract-review.md`.
- **The 0.7 deployment.** The T-206 session redeployed the fixed contracts on Sepolia and cut the demo over on 2026-11-04, about 08:30 UTC, with Rafa's go-ahead. Its record is `contracts/deployments/sepolia.json` (PR 169; rules `0xF38287e5…`, from block 12061237), with the 0.6 record kept as `contracts/deployments/sepolia-2026-11-03-domain-0.6.json`. The gas it measured is in T-212's Handoff. Measured the same day: `/v1/status` serves schema 0.9 and domain "Holdback" 0.7, with `verifyingContract` `0xf38287e5c5c1f20c6d03be500edbf8a244f27cfa`.
- The local counterparts: the scenario fixtures on the contract on anvil (`pnpm snap --settlement=local`, `reports/differential-local.md`). This round is their live equivalent on Sepolia.

## How the round runs

- **Two tracks.**
  - **API track:** the demo's three adjudicators. Deals are offered, agreed, delivered and judged through the public API, with every message signed by the driver's own keys from `llms.txt` alone, so nothing here is beyond an outside agent.
  - **Direct track:** the driver calls HoldbackRules, HoldbackBonds and the token from its own keys, past the operators. Where a scenario needs a decision the demo's honest adjudicators would not make, it uses its own test adjudicator keys.
- **Keys and the chain.**
  - Party and test-adjudicator keys derive from one Sepolia-only secret, read from the process environment (`E2E_SEPOLIA_SEED`), never from a `.env*` file.
  - The driver prints addresses only, never a key.
  - It refuses any chain but 11155111 through `assertSafeChain` (`packages/settlement/evm/guard.ts`), with a unit test of that refusal: the check `docs/team.md` pairs with the no-real-money rule.
  - The driver's own tests run offline. Test tokens come from the faucet or tUSDC's open mint.
- **Short windows.** The rulebook minimum (`MIN_WINDOW_SEC`, 60 s on the demo today) for the judge, fallback, appeal and appeal-decision windows, and a short delivery window where a timeout is the point. A scenario then takes minutes.
- **A silent adjudicator** (scenarios 3, 4, 9 and 10). The API has no adjudicator control. A delivery cannot simply leave an adjudicator out: core refuses a delivery without an envelope for each adjudicator and the buyer (`packages/core/src/state.ts`, `deliver`, "no content key for …").
  - **Proposed:** the seller's delivery carries an envelope addressed to that adjudicator that it cannot unwrap. The adjudicator then refuses without a record, and the fallback takes over at `judgeBy`, or the default applies (`apps/adjudicator/src/service.ts`, `mapIntakeError`, `key_unwrap_failed`).
  - **It must fail at the unwrap.** A key that unwraps but does not decrypt the work is `decrypt_failed`, which rejects.
  - From the chain's side this is the same as an offline adjudicator: no decision by its deadline. Inferred from the code; try it on a Sepolia fork first. Rafa confirms the method (question 3).
- **Templates.** Checks-only where the point is settlement, not the panel, so outcomes are deterministic and the live judges' daily budget is spared. One rubric deal runs the live panel (scenario 1).
- **Evidence per scenario.**
  - The commitment ID.
  - Each transaction as an Etherscan link, with its gas.
  - `dealOf`'s stage and CPP's payment state at the end.
  - The tUSDC and bond balances of the buyer, the seller and each bonded adjudicator, before and after.
  - The state and the event count from both origins, and whether they agree.
  - Whether the buyer could open the work.

  Label each claim measured, inferred or guessed.
- **Finality.** About 20 minutes after the last run, re-read every transaction's block hash. A change is a reorg; it fires the backlog's reorg row.
- **Pass rule.** Round 1 is complete when every in-scope scenario has passed against one deployment (one rules address) and one set of Worker versions. A fix in between means re-running every scenario it can touch.
- **No re-rolls.** A live panel's verdict is never re-rolled. If scenario 1's panel rejects honest work, that is a finding to record; no new deal is opened to get a pass (the pinned-models hard rule, in spirit).

## Acceptance criteria

The fixed contracts are live (Context), so they block no scenario. "Blocked today by" names everything else that does, as of 2026-11-04. A prerequisite task counts only once T-220 has deployed it.

- [ ] **1. Happy-path release (API).** A rubric deal (default template, live panel) ends Released:
  - the seller is paid the price, and the operator fee is paid once;
  - the buyer opens the work with the key released on chain;
  - CPP holds nothing for the deal.

  On chain only `expireAppeal` frees the primary's bond after the appeal window, and the demo leaves that trigger to the parties (backlog, "Timeout triggers other than the fallback takeover"). So the driver sends `appeal-expiry` after `appealBy` and records that the bond is then free. The homepage command (`try.mjs`) also passes against both nodes. *Blocked today by:* nothing but the scope (question 1). The same flow passed on the 0.6 deployment (T-213 Evidence, measured). On 0.7, the redeploy's smoke deal reached Released in 42 s (T-212 Handoff, measured by the T-206 session).
- [ ] **2. Refund on reject (API).** A checks-only deal whose delivery fails a required check (the `bad-work-row-drop` shape) ends Refunded. The buyer gets the price back (the operator fee is never refunded, ADR-0023); no key reaches the buyer; the decision names the posted delivery (D44). *Blocked today by:* nothing but the scope.
- [ ] **3. Timeouts and the default outcome.**
  - **3a, reclaim (API and direct).** Nothing is delivered by `deliverBy`. The `reclaim` trigger, once through the API and once sent directly from the buyer's key, refunds the price, closes the deal and frees the bonds.
  - **3b, default (API).** Primary and fallback both stay silent. At `judgeBy` the world's takeover sends `fallback` (`triggerFallback` on chain). After `fallbackBy`, the `default` trigger ends the deal Defaulted, then refunded. On chain `triggerDefault` does both steps in one transaction; `apply-default` then has nothing to send. Record what the contract pays the seller: compensation from bonds is Phase 4 on the contract (`LOCAL_EXCLUSIONS`), so the expected payout is zero.
  - **3c, appeal expiry (API).** An appeal is filed and the appeal adjudicator stays silent. After the appeal deadline, `appeal-expiry` leaves the first decision standing and frees the bonds.
  - **3d, offer expiry (API).** An offer nobody agrees to. After `offerExpiresAt`, the `expire-offer` trigger records the deal Expired on chain (`expireOffer`, `JobExpired`).

  *Blocked today by:* the silent-adjudicator method (question 3); for 3a's direct reclaim and for 3c, the parties' own Sepolia ETH (question 4). Until T-217 is live, a silent primary alone already ends in the default outcome; after it, the fallback must be silenced too.
- [ ] **4. Fallback when the primary is silent (API).** The primary never decides. At `judgeBy` the world's takeover sends `fallback`, and the fallback adjudicator decides with a drand quicknet proof that HoldbackRules verifies: the decision's `beacon.source` is `drand-quicknet` and its round is the round at `judgeBy`. The deal settles according to the work. *Blocked today by:* T-217, live through T-220 (no adjudicator can prove its seed on Sepolia, so the default outcome applies, ADR-0028 §11); the silent-adjudicator method.
- [ ] **5. Escalation (API).** A checks-only deal whose check runs out of its work budget: the primary escalates with no panel (`packages/judgment/src/aggregate.ts`; `docs/api.md`, Escalation).
  - The appeal adjudicator gets the escalation envelope and decides with a drand proof from the first round after the escalation. That decision is final at once: a later appeal is refused.
  - A second deal leaves the appeal adjudicator silent (the method of question 3). After `appealDecideSec`, `default` from Escalated refunds the buyer.

  How to make a check exhaust its budget on purpose is open (inferred: an input larger than the check's budget; try it on a fork first). *Blocked today by:* T-217, live through T-220; that method.
- [ ] **6. Appeal upheld (API).** The losing party appeals (D43, L-7): the seller after a correct reject (scenario 2's shape), and the buyer after a correct accept. The demo's appeal adjudicator decides with a drand proof from the first round after the filing, and upholds. The first outcome stands and no bond pays out. The appellant's bond goes to the first adjudicator's bond (ADR-0014 §2a; `HoldbackRules._appealDecision`). The favoured party's appeal is refused (`invalid_terms`). *Blocked today by:* T-217, live through T-220, and the appellant's own Sepolia ETH for the bond allowance (`llms.txt`: appeals need your own Sepolia ETH; question 4).
- [ ] **7. Appeal overturned, both ways, paid from the first decider's bond (D43; direct track).** The driver's own primary and appeal adjudicators, each bonded from its own key in the new HoldbackBonds, decide by script:
  - **An overturned accept.** The buyer appeals and wins: it is paid the price from the primary's bond (`BondSlashed`), and the seller keeps the price it was paid.
  - **An overturned reject.** The seller appeals and wins: it is paid the price from the primary's bond, and no key reaches the refunded buyer. An overturn that carries the key reverts `InvalidMessage` (H-2), and the same verdict without it settles.

  In both, the appellant's bond goes back to it. The appeal adjudicator's seed comes from a real quicknet round the driver fetches and checks. *Blocked today by:* Sepolia ETH for the test keys (question 4) and the scope (question 2). The overturn payout is live: the 0.6 contracts had none, and the 0.7 ones do. It cannot run through the API: the demo's adjudicators are honest, so no first decision is wrong on purpose, and adjudicator registration answers 501 (question 2).
- [ ] **8. The escape hatch (direct calls on API deals).**
  - **A deal that goes direct after the offer.** It is offered and accepted through the API. The buyer then funds with `agreeAndFund` from its own key, using the primary's acceptance the operators serve, and pays no operator fee. The seller delivers with `deliver` from its own key, and posts the same signed delivery to an operator so the adjudicators get their envelopes. The demo primary decides.
  - **A deal that ends by a direct `reclaim`.**
  - **A deal whose fallback takeover is sent directly** (`triggerFallback` from the driver's key, the primary silenced). The fallback still gets its key and decides.

  All settle on chain, and within one sync pass both origins show each direct step as an event with `submittedVia: 'direct'` and its transaction. *Blocked today by:* T-218, live through T-220 (the operators' view does not follow direct calls: the money settles, the view lags); T-217 for the third deal; the parties' Sepolia ETH.
- [ ] **9. Early accept (API).** The buyer accepts before the primary decides. The deal ends Released, the key is released, the early accept names the posted delivery (D44), and a later decision by the primary, if any, is refused. The demo primary decides within seconds of a delivery, so the primary is silenced (the method of question 3) to leave room for the accept. An early accept that carries the delivery in one transaction has no API route (`carryDelivery` has no caller in `apps/`), so it belongs to the direct track only. *Blocked today by:* the silent-adjudicator method.
- [ ] **10. Mutual settlement (API; only if Rafa keeps it in scope, question 1).** After delivery, both parties sign a `MutualSettlement` with a split (for example 60 % to the seller) and `releaseKey`. The payouts sum to the price, the key goes as signed, and the bonds are freed. It must land before the primary decides, as in scenario 9. *Blocked today by:* the scope, and the same method.
- [ ] **11. A restart between broadcast and receipt.** Recorded, not forced. Across the round, the lane telemetry shows no in-flight row left unapplied. If the world restarted mid-step (a deploy, an eviction), that step's events and the buyer's key were served on the next pass. The forced case is T-219's own test, unless Rafa approves a live deploy during a deal (question 6). *Blocked today by:* T-219, live through T-220.
- [ ] **The report,** a new file in `docs/reviews/` named for the round's date:
  - one row per scenario: pass or fail, commitment IDs, Etherscan links, balances, gas;
  - the gas per path compared with `reports/differential-local.md` and T-215's quote;
  - the finality re-read;
  - each failure with its new backlog row or task.
- [ ] The PR that adds the driver and the report: reviewed by the `reviewer` role with project context; CI green.

## Scope questions for Rafa

1. Confirm the scenario list, inferred from the log's draft and widened by review (escalation, offer expiry, a direct fallback takeover). Is the mutual settlement (10) in round 1?
2. The overturned appeals (7): are direct contract calls with the round's own adjudicator keys, with scripted decisions and no judgment pipeline, enough for round 1? The API path would need a controllable test adjudicator on the demo: a new task, since adjudicator registration answers 501 today.
3. A silent adjudicator (3, 4, 5, 9, 10): a delivery whose envelope for that adjudicator cannot be unwrapped (no demo change; proposed), or a labelled test adjudicator in the demo that accepts offers and never decides (a new task)?
4. Sepolia ETH for the round's own keys: about 0.2 in all (guessed). Direct funding takes about 940,000 gas and each decision about 520,000, so the round needs roughly 8 million gas: 0.008 ETH at today's 1 gwei, with room for spikes up to 20 gwei (the relayer's fee cap, used here as a yardstick). Will you send it to the addresses the driver prints, or turn on the faucet's test ETH?
5. Shipping the prerequisites (T-220). Proposed: one deploy once T-217, T-218 and T-219 have merged, with a fresh world for the drand rulebook. The alternative is a deploy as each one merges: T-218 and T-219 need no new world, but T-217's rulebook does.
6. The restart case (11): T-219's test only (proposed), or one live holdback-op1 deploy during a round-1 deal?

## Out of scope

- A CPP reclaim after `authorizationExpiry`, a day past the last deadline (`EXPIRY_MARGIN`); covered on anvil (M-1).
- The reorg rollback (backlog row), mainnet, Phase 4 economics, the judgment's accuracy, attacks.
- T-212's open items (1, 2, 4, 5, 6 and 8). They block mainnet, not Sepolia. Each later contract change is a new deployment, and a later round re-runs the scenarios it touches.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff

- When round 1 completes: unbench PR 151 and T-206's read (`docs/backlog.md`, Benched; `docs/log/2026-11-04.md`, Next steps item 3), and tell Rafa.
