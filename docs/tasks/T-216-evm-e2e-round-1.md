# T-216: Full EVM end-to-end test round 1 on Sepolia

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-217 (drand proofs for fallback and appeal), T-218 (direct calls in the operators' view), T-219 (the in-flight row per relayer lane), T-221 (adjudicator registration through the API), and T-220, which ships those four to the live demo; Rafa's answers to the open scope questions below. The fixed contracts are already live (see Context).
- **Paths this task may touch:** `examples/e2e-*.ts` (new: the round's keys, its driver, and their tests; the `examples` workspace already holds the agent-side code and viem), `docs/reviews/` (one new file, the round's report), `docs/backlog.md` (rows for what the round finds; the Benched rows once it completes), `docs/plan.md` (this row), this file. No product code: a scenario that fails gets its fix in its own task, and the round re-runs it.
- **Human gate:** yes. Rafa confirms the scope (the questions below) before the first run, and funds the round's master address with Sepolia ETH (done: 2.5, Evidence); the driver tops up the other keys from it. The runs use the public API as any agent may, and send test transactions on Sepolia from test keys; they deploy nothing.
- **Status:** in progress (first slice: the round's keys, `examples/e2e-keys.ts`, so Rafa can fund the master today; the driver waits for the prerequisites)
- **Agent/session:** the T-216 planning session (the keys)

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
  - **API track:** the demo's three adjudicators, and the round's own adjudicators, registered through the API (T-221). Deals are offered, agreed, delivered and judged through the public API, with every message signed by the driver's own keys from `llms.txt` alone, so nothing here is beyond an outside agent. Where a scenario needs a decision the demo's honest adjudicators would not make (a wrong first decision to overturn, or no decision at all), the round's own adjudicator makes it, as any agent's adjudicator could (Rafa, 2026-11-04: "API should facilitate overturned appeals").
  - **Direct track:** the driver calls HoldbackRules, HoldbackBonds and the token from its own keys, past the operators.
- **Keys and the chain.**
  - Every key derives from one Sepolia-only secret, read from the process environment (`E2E_SEPOLIA_SEED`). An agent never reads a `.env*` file: it runs the round's commands with `node --env-file-if-exists`, and the commands print addresses only.
  - **Making the secret** (`examples/e2e-keys.ts init <file>`). The command generates the secret in memory and appends it to the file Rafa names, his `.env` (it creates a missing file readable by its owner only). It never prints the secret, and it refuses when the file already holds one, so a funded master is never replaced. Rafa runs it.
  - **One master address.** The `master` key is the only address Rafa funds with Sepolia ETH (question 4). `examples/e2e-keys.ts address` prints it with the role addresses. Each role's key is keccak256(secret ‖ "holdback/e2e/<role>"), as the relayer derives its deal lanes. Before a step that needs a key's own gas, the driver tops that key up from the master and records the transfer. The leftover stays in the master. The pattern is the operators' own funding lane, which tops up the deal lanes and the demo adjudicators (ADR-0028 §3, §7).
  - **Which keys need gas:**
    - the buyer and the seller, for the token approval before an appeal bond, and for the direct calls of scenarios 3a and 8;
    - the round's own adjudicators, for their bond's approval and deposit (HoldbackBonds bonds the sender).

    Everything relayed through the API costs the agents no ETH: the operators' relayer pays it and recovers it in the operator fee.
  - The driver prints addresses only, never a key.
  - It refuses any chain but 11155111 through `assertSafeChain` (`packages/settlement/evm/guard.ts`), with a unit test of that refusal: the check `docs/team.md` pairs with the no-real-money rule.
  - The driver's own tests run offline. Test tokens come from the faucet or tUSDC's open mint.
- **Short windows.** The rulebook minimum (`MIN_WINDOW_SEC`, 60 s on the demo today) for the judge, fallback, appeal and appeal-decision windows, and a short delivery window where a timeout is the point. A scenario then takes minutes.
- **A silent adjudicator** (scenarios 3, 4, 8, 9 and 10). Several scenarios test what happens when an adjudicator does not decide by its deadline: the fallback takes over, or the default outcome applies. The demo's own adjudicators always decide within seconds and have no off switch. So the silent adjudicator is the round's own, registered through the API (T-221): it accepts the deal and then never decides, which is a real offline adjudicator. Which roles it may fill (research `docs/research/2026-11-04-adjudicator-registration.md` §3, §6):
  - A demo adjudicator as primary declines terms whose fallback or appeal adjudicator it does not trust (D44, `trustedAdjudicators`). So the round's own adjudicator is the primary, or fills every role, wherever it appears.
  - A demo adjudicator as fallback serves only under a trusted appeal adjudicator (T-221's rule). So when a demo adjudicator is the fallback, the appeal adjudicator is a demo one too (scenarios 4 and 8).
  - A demo adjudicator as fallback or appeal adjudicator for the round's primary refuses `registry_mismatch` or `policy_mismatch` unless the round's registration binds the demo's registry hash and a policy with this build's template hashes. The `llms.txt` recipe from T-221 says how. If T-221 slips, the stopgap is an envelope that adjudicator cannot unwrap (`apps/adjudicator/src/service.ts`, `mapIntakeError`, `key_unwrap_failed`; a key that unwraps but does not decrypt is `decrypt_failed`, which rejects). Core refuses a delivery that leaves an envelope out (`packages/core/src/state.ts`, `deliver`).
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

  On chain only `expireAppeal` frees the primary's bond after the appeal window, and the demo leaves that trigger to the parties (backlog, "Timeout triggers other than the fallback takeover"). So the driver sends `appeal-expiry` after `appealBy` and records that the bond is then free. The homepage command (`try.mjs`) also passes against both nodes. *Blocked today by:* nothing. It counts once run on the Worker versions of T-220's deploy (the pass rule). The same flow passed on the 0.6 deployment (T-213 Evidence, measured). On 0.7, the redeploy's smoke deal reached Released in 42 s (T-212 Handoff, measured by the T-206 session).
- [ ] **2. Refund on reject (API).** A checks-only deal whose delivery fails a required check (the `bad-work-row-drop` shape) ends Refunded. The buyer gets the price back (the operator fee is never refunded, ADR-0023); no key reaches the buyer; the decision names the posted delivery (D44). *Blocked today by:* nothing, under the same pass rule.
- [ ] **3. Timeouts and the default outcome.**
  - **3a, reclaim (API and direct).** Nothing is delivered by `deliverBy`. The `reclaim` trigger, once through the API and once sent directly from the buyer's key, refunds the price, closes the deal and frees the bonds.
  - **3b, default (API).** Primary and fallback both stay silent. At `judgeBy` the world's takeover sends `fallback` (`triggerFallback` on chain). After `fallbackBy`, the `default` trigger ends the deal Defaulted, then refunded. On chain `triggerDefault` does both steps in one transaction; `apply-default` then has nothing to send. Record what the contract pays the seller: compensation from bonds is Phase 4 on the contract (`LOCAL_EXCLUSIONS`), so the expected payout is zero.
  - **3c, appeal expiry (API).** The round's own primary decides; an appeal is filed, and the round's own appeal adjudicator stays silent. After the appeal deadline, `appeal-expiry` leaves the first decision standing and frees the bonds.
  - **3d, offer expiry (API).** An offer nobody agrees to. After `offerExpiresAt`, the `expire-offer` trigger records the deal Expired on chain (`expireOffer`, `JobExpired`).

  *Blocked today by:* T-221, live through T-220, for the silent adjudicators of 3b and 3c (the round's own primary and fallback in 3b; its own appeal adjudicator in 3c); the master address's Sepolia ETH, for 3a's direct reclaim and 3c's appeal (question 4).
- [ ] **4. Fallback when the primary is silent (API).** The primary is the round's own adjudicator and never decides. The fallback is a demo adjudicator, inside its policy (T-211), and so is the appeal adjudicator (T-221's fallback rule). At `judgeBy` the world's takeover sends `fallback`, and the fallback adjudicator decides with a drand quicknet proof that HoldbackRules verifies: the decision's `beacon.source` is `drand-quicknet` and its round is the round at `judgeBy`. The deal settles according to the work. *Blocked today by:* T-217, live through T-220 (no adjudicator can prove its seed on Sepolia, so the default outcome applies, ADR-0028 §11); T-221, live through T-220.
- [ ] **5. Escalation (API).** Escalated is its own path: the appeal adjudicator decides alone, with the escalation envelope the primary seals for it, and its decision is final at once (`docs/api.md`, Escalation).
  - **5a, escalation, then default.** A checks-only deal whose check runs out of its work budget: the primary escalates with no panel (`packages/judgment/src/aggregate.ts`). Every role runs the same check budget, so the appeal adjudicator escalates again, and after an escalation it signs nothing (`signedOutcome`). After `appealDecideSec`, the `default` trigger from Escalated refunds the buyer.
  - **5b, the appeal adjudicator decides.** A rubric deal whose delivery trips the screen: the primary escalates (D27c). The appeal adjudicator's five-seat panel must accept or reject (D27a/b), with a drand proof from the first round after the escalation. A later appeal is refused (`invalid_state`). This costs live-judge calls, about 3 for the primary and 5 for the appeal (inferred).

  Both are inferred from the code; try them on a fork first. How to make a check exhaust its budget on purpose (5a), and which delivery trips the screen without being an attack fixture (5b), are for the driver to find. *Blocked today by:* T-217, live through T-220 (5b; 5a's default needs no proof).
- [ ] **6. Appeal upheld (API).** The losing party appeals (D43, L-7): the seller after a correct reject (scenario 2's shape), and the buyer after a correct accept. The demo's appeal adjudicator decides with a drand proof from the first round after the filing, and upholds. The first outcome stands and no bond pays out. The appellant's bond goes to the first adjudicator's bond (ADR-0014 §2a; `HoldbackRules._appealDecision`). The favoured party's appeal is refused (`invalid_terms`). *Blocked today by:* T-217, live through T-220, and the appellant's own gas for the bond approval (`llms.txt`: appeals need your own Sepolia ETH), from the master address (question 4).
- [ ] **7. Appeal overturned, both ways, paid from the first decider's bond (D43; API).** Through the API, as Rafa asked. The primary is the round's own adjudicator, registered and bonded through T-221, and it decides wrongly by script. The deals are checks-only, so the demo appeal adjudicator's decision is deterministic and spends no live-judge budget. The losing party appeals through the API, and a demo adjudicator, as the appeal adjudicator, judges the work against the terms and overturns:
  - **An overturned accept.** The round's primary accepts work that fails a required check. The buyer appeals and wins: it is paid the price from the primary's bond (`BondSlashed`), and the seller keeps the price it was paid.
  - **An overturned reject.** The round's primary rejects work that passes. The seller appeals and wins: it is paid the price from the primary's bond, and no key reaches the refunded buyer. The demo appeal adjudicator seals no key for a refunded buyer (T-211), and the contract would refuse one anyway (H-2).

  In both, the appellant's bond goes back to it, and the appeal adjudicator's seed is a drand proof from the first round after the filing. *Blocked today by:* T-221 and T-217, live through T-220; the master address's Sepolia ETH for the round's adjudicator bond and the appellant's approval (question 4). The overturn payout itself is live: the 0.6 contracts had none, and the 0.7 ones do.
- [ ] **8. The escape hatch (direct calls on API deals).**
  - **A deal that goes direct after the offer.** It is offered and accepted through the API. The buyer then funds with `agreeAndFund` from its own key, using the primary's acceptance the operators serve, and pays no operator fee. The seller delivers with `deliver` from its own key, and posts the same signed delivery to an operator so the adjudicators get their envelopes. The demo primary decides.
  - **A deal that ends by a direct `reclaim`.**
  - **A deal whose fallback takeover is sent directly** (`triggerFallback` from the driver's key, the primary the round's own silent adjudicator). The fallback still gets its key and decides.

  All settle on chain, and within one sync pass both origins show each direct step as an event with `submittedVia: 'direct'` and its transaction. *Blocked today by:* T-218, live through T-220 (the operators' view does not follow direct calls: the money settles, the view lags); T-217 and T-221 for the third deal; the master address's Sepolia ETH.
- [ ] **9. Early accept (API).** The buyer accepts before the primary decides. The deal ends Released, the key is released, the early accept names the posted delivery (D44), and a later decision by the primary, if any, is refused. A demo primary decides within seconds of a delivery, so the primary here is the round's own silent adjudicator, which leaves room for the accept. An early accept that carries the delivery in one transaction has no API route (`carryDelivery` has no caller in `apps/`), so it belongs to the direct track only. *Blocked today by:* T-221, live through T-220.
- [ ] **10. Mutual settlement (API; in round 1, Rafa, 2026-11-04).** After delivery, both parties sign a `MutualSettlement` with a split (for example 60 % to the seller) and `releaseKey`. The payouts sum to the price, the key goes as signed, and the bonds are freed. It must land before the primary decides, so the primary is the round's own silent adjudicator, as in scenario 9. A second deal settles mutually before delivery, with no primary in the way. *Blocked today by:* T-221, live through T-220, for the deal after delivery; nothing for the one before.
- [ ] **11. A restart between broadcast and receipt.** Recorded, not forced. Across the round, the lane telemetry shows no in-flight row left unapplied. If the world restarted mid-step (a deploy, an eviction), that step's events and the buyer's key were served on the next pass. The forced case is T-219's own test, unless Rafa approves a live deploy during a deal (question 6). *Blocked today by:* T-219, live through T-220.
- [ ] **The report,** a new file in `docs/reviews/` named for the round's date:
  - one row per scenario: pass or fail, commitment IDs, Etherscan links, balances, gas;
  - the gas per path compared with `reports/differential-local.md` and T-215's quote;
  - the finality re-read;
  - each failure with its new backlog row or task.
- [ ] The PR that adds the driver and the report: reviewed by the `reviewer` role with project context; CI green.

## Scope questions for Rafa

1. ~~Confirm the scenario list; is the mutual settlement in round 1?~~ **Answered (Rafa, 2026-11-04):** "mutual settlement is important in the basic build". It is scenario 10.
2. ~~The overturned appeals: direct contract calls, or the API?~~ **Answered (Rafa, 2026-11-04):** "API should facilitate overturned appeals". Then "Yes, plan it" for adjudicator registration through the API over a labelled test adjudicator inside the demo: T-221.
3. ~~A silent adjudicator: an envelope it cannot unwrap, or a test adjudicator in the demo?~~ **Answered by 2:** the round's own adjudicator, registered through T-221, accepts and then never decides.
4. ~~Sepolia ETH for the round's own keys?~~ **Answered (Rafa, 2026-11-04):** "I'll get through faucet,,, feels like we need a master address that funds all the rest".
   - The round has one master address, the `master` key (How the round runs). `examples/e2e-keys.ts address` prints it, and the driver funds every other key from it.
   - The round needs about 0.2 Sepolia ETH (guessed): roughly 8 million gas for the steps that need its own gas, 0.008 ETH at today's 1 gwei, with room for spikes up to 20 gwei (the relayer's fee cap, used as a yardstick).
   - The master holds 2.5 (Evidence).
5. Shipping the prerequisites (T-220). Proposed: one deploy once T-217, T-218, T-219 and T-221 have merged, with a fresh world for the drand rulebook. The alternative is a deploy as each one merges: the others need no new world, but T-217's rulebook does.
6. The restart case (11): T-219's test only (proposed), or one live holdback-op1 deploy during a round-1 deal?

## Out of scope

- A CPP reclaim after `authorizationExpiry`, a day past the last deadline (`EXPIRY_MARGIN`); covered on anvil (M-1).
- The reorg rollback (backlog row), mainnet, Phase 4 economics, the judgment's accuracy, attacks.
- T-212's open items (1, 2, 4, 5, 6 and 8). They block mainnet, not Sepolia. Each later contract change is a new deployment, and a later round re-runs the scenarios it touches.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- **The keys (first slice, 2026-11-04).**
  - `examples/e2e-keys.test.ts`: 6 passed [measured]. The tests never touch `.env`. They show:
    - one distinct key per role, derived the same every time, and a malformed secret refused;
    - `init` on a temporary file: it writes one secret, creates the file readable by its owner only (0600), prints the master derived from what it wrote, and refuses a second run without writing again;
    - on an existing file: it keeps the file's lines, adds one secret line, and warns when others can read the file;
    - it refuses a file that already sets the secret in another form (`export`, leading spaces, spaces around `=`);
    - `address` prints every role's address from the environment, and refuses without the secret;
    - neither `init` nor `address` prints the secret or any key derived from it, on stdout or stderr.
  - `pnpm exec vitest run examples`: 46 passed. `eslint` and `tsc -b examples` are clean. `node site/check.mjs` passes [measured].
  - **The secret exists (2026-11-04).** Rafa ran `init` on his `.env`, and the round's master is `0x6D4cEa33dAf09Ba803238d46392162d41BDB029f` (https://sepolia.etherscan.io/address/0x6D4cEa33dAf09Ba803238d46392162d41BDB029f). Rafa funds it from faucets (the estimate was about 0.2 Sepolia ETH); the other five addresses are topped up from it [measured: his terminal's output].
  - **The master is funded:** 2.5 Sepolia ETH at block 12,061,679 on 2026-11-04 [measured: `eth_getBalance` through publicnode]. That is well above the 0.2 the round needs [guessed], so the round can run more than once without another top-up.

## Decisions

## Handoff

- When round 1 completes: unbench PR 151 and T-206's read (`docs/backlog.md`, Benched; `docs/log/2026-11-04.md`, Next steps item 3), and tell Rafa.
