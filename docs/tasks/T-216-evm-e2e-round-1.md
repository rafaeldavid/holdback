# T-216: Full EVM end-to-end test round 1 on Sepolia

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-217 (drand proofs for fallback and appeal), T-218 (direct calls in the operators' view), T-219 (the in-flight row per relayer lane), T-221 (adjudicator registration through the API), and T-220, which ships those four to the live demo in one deploy. Rafa answered all six scope questions on 2026-11-04 (below). The fixed contracts are already live (see Context).
- **Paths this task may touch:** `examples/e2e-*.ts` (new: the round's keys, its driver, and their tests; the `examples` workspace already holds the agent-side code and viem), `docs/reviews/` (one new file, the round's report), `docs/backlog.md` (rows for what the round finds; the Benched rows once it completes), `docs/plan.md` (this row), this file. No product code: a scenario that fails gets its fix in its own task, and the round re-runs it.
- **Human gate:** yes. Rafa confirms the scope (done: the questions below, 2026-11-04) and funds the round's master address with Sepolia ETH (done: 2.5, Evidence); the driver tops up the other keys from it. The runs use the public API as any agent may, and send test transactions on Sepolia from test keys. They deploy nothing, except scenario 11's one holdback-op1 redeploy, which waits for Rafa's go-ahead at that moment.
- **Status:** review (PR 220 fixes the three driver defects of the two 2026-11-05 evening runs; 1, 2, 3a, 3c, 3d, 4 and 5a have passed live; the round completes with Rafa's live run of 3b, 4, 5a, 5b, 6, 7, 8, 9, 10a, 10b and 11, with 4 and 5a again under the new money checks, then the report, Handoff)
- **Agent/session:** the T-216 planning session (the keys); the T-216 driver session (the driver); the T-216 remaining-scenarios session (the round's own adjudicator and the group files, worktree `.worktrees/t-216-rest`); four group sessions (silent, scripted, escalation, direct), one branch each; the integrating session (the merge, the 3d and 10a fix, this file); the live-fixes session (2026-11-06, worktree `.worktrees/t-216-fixes`)

## Intent

Rafa's milestone (2026-11-04): "full EVM test end-to-end round 1 complete". It is the event that brings back the benched work: PR 151, the contribution rails, and T-206's human gate, his read of the contract review (`docs/backlog.md`, Benched).

Restated: on the live Sepolia deployment of the fixed contracts (PRs 160 and 161), show that every settlement path an agent can reach ends where the signed terms say, with each money step checkable on Etherscan. The paths run through the public API, and by direct contract calls where the API has no route or the point is to go past the operators. Each scenario is one or more real deals. Its evidence is the transactions, the chain's state and the operators' view, side by side.

- **Inputs:** the public API at api.escrow.stream and api2.escrow.stream; the deployment in `contracts/deployments/sepolia.json`; `site/llms.txt` as the API track's only guide (as T-213's `site/walkthrough.mjs` did); test keys derived from one environment variable.
- **Outputs:** a driver that runs each scenario and prints its evidence; the report; backlog rows or tasks for what fails.
- **Non-goals:** mainnet; the judgment's accuracy (Phase 3's calibration); Phase 4 economics (default compensation from bonds, the appeal fee, a minimum appeal bond), whose absence on chain is recorded, not passed; attacks (the red-team fixtures cover them on anvil); load.

**The remaining scenarios' foundation, restated by its session (2026-11-05).** Rafa, on the ten scenarios the driver cannot build yet: "Yes, build them". This slice builds what their four groups share, so four sessions can then build the groups in parallel without editing the same file:
- **The round's own adjudicator** (`examples/e2e-adjudicator.ts`), the one the needs lines name: an adjudicator any agent could run, from `agent.ts` and `verify.ts` alone. It registers through the operators' API, deposits its bond in HoldbackBonds from its own key only when a scenario asks for one, and reuses a registration or a bond already in place. It runs in the driver's process during a scenario, silent (it accepts and never decides) or scripted (it accepts, then decides the outcome the scenario gives it, a wrong one included, once the deal is delivered).
- **One file per scenario group,** each exporting its scenarios, registered once: silent (3b, 4, 9, 10b), scripted (3c, 7), escalation (5a, 5b) and direct (8, 11), each with its own test file. The waiting definitions move unchanged, and `list` and `run` behave as before.

Non-goals of this slice: building any of the ten scenarios; a scripted fallback or appeal decision (those need a drand proof) or a scripted escalation (no needs line asks for one); a live run; product code.

**The integration, restated by its session (2026-11-05).** The four groups built the ten scenarios on their own branches. This slice merges them into PR 210 with main, fixes once what three of them worked around alone (a serving adjudicator's `stop`), fixes the driver's stale chain reads behind 3d's and 10a's failed checks in the 2026-11-05 live run, and hands Rafa one command that runs all sixteen scenarios live. Non-goals: product code (a product defect would be recorded, not fixed); a live run or any Sepolia transaction; anything beyond what each scenario's needs line asked for.

**The live-run fixes, restated by their session (2026-11-06).** Rafa's two full live runs on the evening of 2026-11-05 stopped or failed in three places, and each is the driver's fault, not the product's. This slice first confirms that from the records and the chain, then fixes the driver so a rerun can pass:
- **3b's bond deposit** must see the approval the same key sent seconds before it.
- **The money checks** must count the deal's own transfers only, never another deal of the same buyer or seller, so two deals in one window cannot spoil each other's checks.
- **The gate after a scenario** must not stop the run on a stale read. A deal a scenario left holding money is closed by its timeouts through the API, within a bounded wait; the gate refuses only when that deal cannot settle in time.
- **One run of the round's keys at a time:** the driver refuses to start while another run holds the round's lock or has a send pending from the round's keys, and stops the rest when another run's deal appears.

Non-goals: product code; a live run or any Sepolia transaction (reading public chain data to confirm a cause is allowed); changing the scenarios' checks beyond where they read money; reordering the scenarios.

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
  - It refuses any chain but 11155111 through `assertSepolia` (`examples/e2e-keys.ts`), before any other call, with tests of that refusal and of its order. It is stricter than `assertSafeChain` (`packages/settlement/evm/guard.ts`), the check `docs/team.md` pairs with the no-real-money rule, which refuses only the mainnet list.
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
- [ ] **11. A restart between broadcast and receipt.** Forced once, live (question 6). During one round-1 deal, the driver pauses after a relayed broadcast and before its receipt, and holdback-op1 is redeployed with the same code, on Rafa's go-ahead at that moment. A redeploy restarts the Durable Object (inferred). On the next pass, that step's events and the buyer's key are served, and the lane telemetry shows no in-flight row left unapplied. T-219's own test covers the same case offline. Across the rest of the round, restarts (an eviction, say) are recorded, not forced. *Blocked today by:* T-219, live through T-220.
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
5. ~~Shipping the prerequisites (T-220): one deploy, or a deploy as each one merges?~~ **Answered (Rafa, 2026-11-04, "Yes, use them", on the coordinator's recommendation):** one deploy once T-217, T-218, T-219 and T-221 have merged, with a fresh world for the drand rulebook. T-217's rulebook needs a fresh world anyway, so a deploy per task would add deploys and save no work.
6. ~~The restart case (11): T-219's test only, or one live holdback-op1 deploy during a round-1 deal?~~ **Answered (Rafa, 2026-11-04, "Yes, use them", on the coordinator's recommendation):** both. T-219's test covers it offline, and one live holdback-op1 redeploy during a round-1 deal shows it on Sepolia, since live evidence is the round's point and a restart on testnet costs little. That redeploy still waits for Rafa's go-ahead when the driver reaches it.

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
- **The top-up (2026-11-04, Rafa: "The round-1 master tops these up" for buyer, seller and adjudicators).**
  - Before it: buyer, seller and the three adjudicators each held 0 Sepolia ETH [measured: `eth_getBalance` through publicnode].
  - `examples/e2e-keys.ts topup [--dry-run]` brings each of the five keys up to 0.04 Sepolia ETH from the master. It sends one transfer at a time, prints each link as soon as it is sent, and waits for each receipt.
  - It refuses, sending nothing:
    - any chain but Sepolia, checked before any other call;
    - while a transfer from the master is still pending (its `pending` and `latest` nonces differ), so a rerun does not resend a transfer the RPC sees as pending. A load-balanced RPC could miss one; the loss is then at most 0.04 Sepolia ETH a key [inferred];
    - fees above 20 gwei, the operators' funding-lane cap;
    - when the master cannot cover every transfer plus a 0.01 Sepolia ETH reserve for its own gas.
  - It prints addresses, amounts in Sepolia ETH and Etherscan links. It never prints a key or the RPC URL, which may carry a provider key (`SEPOLIA_RPC_URL`; without it, the public publicnode endpoint). On a failure it says how many transfers were mined.
  - **Review (the `reviewer` role, PR 183): ISSUES, all five fixed.**
    - a keyed RPC URL could reach stderr through viem's error text;
    - a rerun while a transfer was pending would send it again;
    - no fee cap;
    - no test that the chain check comes first;
    - numbers without units.
  - **The live top-up (2026-11-04, Rafa ran the first version):** five transfers of 0.04 Sepolia ETH, all mined [measured: `eth_getBalance` and the master's nonce, 5 at `latest` and `pending`]. The master holds about 2.30 Sepolia ETH after them.
    - buyer: https://sepolia.etherscan.io/tx/0x96be5b69da9a26966640241aa7346338bbc12114b8c603d05cb4a57ec71ce069
    - seller: https://sepolia.etherscan.io/tx/0xe0395e9caf2990c2cdaab5981adb9ccc4b93bcae52e13202bb08c8239567ce4d
    - adjudicator-1: https://sepolia.etherscan.io/tx/0x4428af4a509541cda11367ca36487626d0b6d618af64593b1a0c0dcdb5f3504e
    - adjudicator-2: https://sepolia.etherscan.io/tx/0xebd8fbc5bd5fa60a61e04fe0a9bb0f8eba454634376ede841b8aa2a6e5ae3e8b
    - adjudicator-3: https://sepolia.etherscan.io/tx/0x501a71fa75d463be58d6715aa85a61684c42db7cdc230f7abfd883a176cbc8c5
  - `examples/e2e-keys.test.ts`: 15 passed [measured]. The new tests cover:
    - the plan: empty keys, the shortfall only, nothing to a key at or above the target, and the refusal when the master is short;
    - the Sepolia-only guard and the CLI's refusals before any network call;
    - error text with no URL but an Etherscan link;
    - three runs against a local JSON-RPC stand-in. On chain 1 it stops after `eth_chainId` alone. With a pending transfer it refuses before reading any balance or sending. When every call answers 429, neither the stand-in's address nor the planted key in its path is printed.
    `eslint` is clean on both files [measured].
  - A live dry run of the fixed version with a throwaway seed reached Sepolia, passed the chain, pending and fee checks, and refused: "the master holds 0 Sepolia ETH; the top-ups need 0.2 Sepolia ETH plus 0.01 Sepolia ETH for gas" [measured].
  - `pnpm verify` on branch `t-216-topup` after the review fixes: PASS, no snapshot diffs against HEAD [measured]. The first run on this branch failed `forge build` while the fresh worktree cloned the contract submodules; every run since passes:

    | Step | Status | Time |
    | --- | --- | --- |
    | typecheck | pass | 3,314 ms |
    | lint | pass | 8,633 ms |
    | forge build | pass | 949 ms |
    | forge | pass | 34,723 ms |
    | test | pass | 77,053 ms |
    | spec | pass | 653 ms |
    | snap | pass | 10,522 ms |
    | snap:local | pass | 17,555 ms |
    | demo | pass | 4,395 ms |

- **The driver (2026-11-04).** `examples/e2e-round.ts` (`list`, `run`, `finality`) with `e2e-run.ts` (the round's agents, checks and deal steps), `e2e-scenarios.ts` (the scenarios) and `e2e-chain.ts` (the chain reads and direct calls). It refuses every chain but Sepolia and anvil, and any RPC whose chain is not the pinned deployment's (`assertRoundChain`, with its unit test of the refusal).
  - `examples/e2e-chain.test.ts`: 6 passed: the chain guard refuses a mainnet, another chain and a mismatched RPC; CPP's payment key with the payer zeroed equals the buyer's funding nonce; the terms tuple; the per-role encryption keys [measured].
  - `examples/e2e-round.test.ts`, the driver as a separate process over HTTP against the demo's own world (apps/demo-cloud) on two origins [measured, 2026-11-04]:
    - **SimChain:** scenarios 2, 3a, 3d, 6 and 10a pass; 3b is recorded as waiting for T-221; scenario 1 passes every check but "a live panel judged" (the test world has no model keys, so its judges are scripted), and both homepage runs pass, relayed by each node. 49 s.
    - **anvil** (the contracts from `contracts/out`, a block a second; skipped without anvil, as CI's test shards are): scenarios 2, 3a (through the API and directly from the buyer's key), 3d and 10a pass with every transaction read back from the chain, including CPP's payment key against the funding's `PaymentAuthorized` log and each payout's `Transfer` log; 6 waits for T-217, because the demo world's fallback and appeal adjudicators decide on a chain only with drand proofs (`apps/demo-cloud/src/world.ts`). The finality re-read finds every block unchanged. Run on commit `fb7019a`, after the review's fixes, in 98 s.
    - **Stand-ins pinned to Sepolia:** with an RPC that answers chain 1, the driver exits 3 "refused", having asked the RPC only `eth_chainId` and posted nothing; with a failing RPC whose URL carries a planted key, the key appears in no output or file.
    - Neither the seed nor any key derived from it, signing or x25519, appears in the output or the records.
  - **The PR's review** (the `reviewer` role, ISSUES): the gitleaks failure on anvil's public dev key, the keyed RPC URL in printed errors, the `TooEarly` race of the direct reclaim on Sepolia, a stopped scenario spoiling the next one's balances, the CPP check's blind spot, scenario 10's partial pass, the homepage child's environment, the finality read of a rate limit as a reorg, and the exact appeal-bond deltas. All fixed in PR 189; Decisions 10 to 13 record the choices.
  - **Gas on anvil, per path** [measured, prague hardfork, from the runs' receipts]: funding with the operator fee 283,271 to 300,407; `deliver` 83,451 to 83,475; `decide` 136,271 (release) and 133,432 (refund); `expireAppeal` 54,773 (through the world) and 59,561 (direct); `reclaim` direct 92,427; `expireOffer` 65,513; `mutualSettle` 139,520; the appellant's `approve` 45,802.
  - **Found on anvil** (backlog row, Demo section): `appeal-expiry` through the API sometimes answers 500, because anvil 1.0.0's `eth_estimateGas` refuses `expireAppeal` ("gas floor exceeds the gas limit") [measured]. The driver records "appeal-expiry relayed through the API" as a check and then closes the window directly from the buyer's key. Scenario 1's live run shows whether Sepolia does the same.
  - **Changed since the task was written:** since T-211 the demo's adjudicators expire their own decisions' appeals, so `appeal-expiry` may find the window already closed. The driver says who closed it.
  - `tsc -b examples` and `eslint examples/e2e-*.ts` are clean [measured].
  - `pnpm exec vitest run examples`: 66 passed in 9 files, 150 s, the anvil test included [measured].
  - `pnpm verify` on branch `t-216-driver` at `4bfc8dd`, 2026-11-04: **FAIL (test)**, no snapshot diffs against HEAD [measured]. The test step's only error is vitest's: "Failed to start forks worker" for `apps/adjudicator/src/providers/providers.test.ts`, "Timeout waiting for worker to respond", while the machine's load average stood at 158 with other sessions' suites running. No test assertion failed in the step's output. The snap steps ran about 100 times slower than on PR 183's run, from the same load. CI's sharded test jobs on the PR are the record for the full suite:

    | Step | Status | Time |
    | --- | --- | --- |
    | typecheck | pass | 1,579 ms |
    | lint | pass | 7,034 ms |
    | forge build | pass | 406 ms |
    | forge | pass | 20,799 ms |
    | test | fail (worker start timeout) | 3,740,046 ms |
    | spec | pass | 679 ms |
    | snap | pass | 1,035,684 ms |
    | snap:local | pass | 1,978,696 ms |
    | demo | pass | 4,106 ms |

  - `pnpm verify` again with the review's fixes (on `90c69b9` plus the uncommitted fixes, 2026-11-04 20:00 UTC, load average about 36): **PASS**, all 9 steps, no snapshot diffs against HEAD [measured]:

    | Step | Status | Time |
    | --- | --- | --- |
    | typecheck | pass | 1,765 ms |
    | lint | pass | 4,246 ms |
    | forge build | pass | 475 ms |
    | forge | pass | 16,420 ms |
    | test | pass | 175,371 ms |
    | spec | pass | 648 ms |
    | snap | pass | 9,450 ms |
    | snap:local | pass | 14,854 ms |
    | demo | pass | 4,135 ms |

  - After the re-review's last fixes (`untilAppeal`'s retries, the open-deal check after every scenario, the revert name in errors): the driver's tests, 12 of 12, anvil included, 150 s; `pnpm verify` **PASS**, 9 of 9 steps (test 154,229 ms), no snapshot diffs against HEAD [measured, 2026-11-04].
- **First live run of scenarios 1 and 2 (Rafa, 2026-11-04, 20:49 to 20:55 UTC).** Driver at `eca41f3` (PR 189 merged), from a clean worktree of main, against api.escrow.stream and api2.escrow.stream (schema 0.9, domain 0.7) and HoldbackRules `0xF38287e5…7cFA`. Record: `/Users/rafa/Documents/escrow/.worktrees/round1-run/reports/e2e-round-1/2026-11-04T204924Z/` [measured: his terminal and that folder].
  - **Scenario 2, refund on reject: PASS, 13 of 13 checks.** Commitment `0x3bb2f28b5511747f32a1e28af52e70a84c8f241fbd5fe742f60f7aa957832344`, relayed by api2. Checks `rows` FAIL, decision reject, Refunded. No key reached the buyer, on either operator or on chain. The buyer got the price back (Transfer of 25 tUSDC) and is down 5.71 tUSDC (the 1 tUSDC adjudication fee and the 4.71 tUSDC operator fee, paid once). The seller got nothing. The decision names the posted delivery (`decide`'s `deliveryHash` = `deliveryHashOf` = both operators' `delivery.submitted`, `0x6e6b91…0f8f`). `appeal-expiry` through the API freed the primary's 25 tUSDC bond. Both operators agree (10 events).
  - **Scenario 1, happy-path release: 14 of 16 checks; every settlement check held.** Commitment `0x970605a0a7a5fc51f111009fde5b6a92f079c7eff93b1dcef88b400f850a9e69`, relayed by api. A live panel judged: claude-sonnet-5@2026-06-29, claude-sonnet-5-5@2026-09-28 and deepseek-flash@2026-11-01, all pass, decision accept. The seller was paid 25 tUSDC; the buyer paid 30.71 tUSDC; the operator fee was paid once; the key reached the buyer on chain, and the buyer decrypted and checked the work. CPP holds nothing to capture. `appeal-expiry` through the API freed the primary's bond. Both operators agree (11 events). The two failed checks are the homepage's:
    - "The published try.mjs is the repository bundle" failed: escrow.stream serves `26ccaa80409e…`, main's `site/try.mjs` is `cc310963bb08…`. This is intended before T-220: the site stays matched to the live operators (schema 0.9), since main's bundle (rebuilt by PR 184 for schema 0.10) would advertise routes that answer 501 live. A stranger's homepage command checks the published bundle against the published `llms.txt`, so the command is not broken. The driver now counts this check only with `--t220` (Decision 14).
    - "The homepage command passes relayed by api.escrow.stream" failed with exit 1. Its deal, `0xf0453986b888caa632f81606bcc44b28c24f0503b25c990851ae736091405e5b` (with Crow's test seller), got its faucet grant and ended Released, but neither operator logged its delivery (finding below), so `try.mjs` found no ciphertext to open (inferred: the driver kept only `try.mjs`'s last line; it now keeps the stop line and the whole output). The faucet sentence in that last line is the footer `try.mjs` prints on every stop, not the cause: the deal was funded. The run relayed by api2 passed (`0xcbc63a85…a380`, Released).
  - **Transactions and gas on Sepolia** [measured, from the receipts]:

    | Step | Scenario 1 | Scenario 2 |
    | --- | --- | --- |
    | agree and fund, with the operator fee | [840,733](https://sepolia.etherscan.io/tx/0x16989859f2d03546961034047472e817f9e1cff878a9ce4f2410a8292e28b84e) | [742,789](https://sepolia.etherscan.io/tx/0xd8ab078d5f19bd04134458e63699058e97a9fe4c00e49f872056db98ec408111) |
    | deliver | [173,131](https://sepolia.etherscan.io/tx/0xb8f826649d06e2f3e3de050d7c6e9923605c0991feb1cb4c5bc49a588323fa65) | [173,131](https://sepolia.etherscan.io/tx/0x31441e34a830acd2061eb478437d52540447be2128aa92fe3ac425703f4702e3) |
    | decide (release; refund) | [166,808](https://sepolia.etherscan.io/tx/0x2f4cb00a176ffaf8a33e37dd0bc13ba6fd11bef4f098e6224760b35c0798e08b) | [158,988](https://sepolia.etherscan.io/tx/0x4c17aa160ce6e8681405801a41115d54a72704fd3f4cb78a00fa1f0ffc594226) |
    | expireAppeal | [80,792](https://sepolia.etherscan.io/tx/0x087657ecd3a2af466516b8e44ea684d7ce016f919a7d93e5046526663d6c88dc) | [80,792](https://sepolia.etherscan.io/tx/0x31d5d2c0d13ff352bc6794e1b270a08dd6f9671d72db631001e1ee85d016340e) |
    | total | 1,261,464 | 1,155,700 |

    T-212's smoke deal on this deployment measured fund 938,593, deliver 173,119 and decide 524,530 (its Handoff). The same calls on anvil cost far less (funding 283,271, deliver about 83,500, decide about 136,000); the gap is not explained yet.
  - **Found on Sepolia** (backlog row, Settlement layer): a relayed `deliver` landed on chain without either operator logging it. In deal `0xf0453986…`, the operators' relayer lane `0x5e7f1a8c…3243` sent `deliver` in [`0x64c5c757…caf1`](https://sepolia.etherscan.io/tx/0x64c5c757d4af4fd9b40850435eefffacdabe184835bad79b36282f7addd0caf1) (block 12,064,917), between its own `agreeAndFund` (block 12,064,916) and `decide` (block 12,064,918). Neither operator's log has the deal's `delivery.submitted` or the key release to the primary, yet the primary decided [measured: both operators' events and the chain logs, read with `RoundChain`]. Likely cause [inferred from `packages/settlement/evm/evm-settlement.ts`, `send`]: after the receipt, the adapter sets the book's state, then reads `dealOf` at the latest block through one of several RPCs (`worker.ts`, keyed and public). A node one block behind answers the old stage, the divergence check throws, and the step's events are never emitted, while the book already holds the delivery the primary then judges.
  - **Fixed on main, 2026-11-04** (T-226, [PR 200](https://github.com/rafaeldavid/holdback/pull/200)): after a relayed call's receipt, the adapter checks `dealOf` and `deliveryHashOf` at the receipt's block and tries a lagging read again; `LiveChain` asks again for a block's time that a node does not serve yet. The deployed operators (`dd0a55a`) set the book's state before a latest-block read, as inferred above [measured: the code at `dd0a55a`]. On anvil, a node that lags the receipt by a block makes main's code throw the divergence this cause predicts; with the fix the delivery's events are served [measured, T-226 Evidence]. The fix is live only after T-220's deploy.
  - **Not reproduced on Sepolia:** the anvil-only 500 on `appeal-expiry` (both deals' expiries went through the API). The demo primary did not close either window itself before the round did.
  - **Finality: no reorg.** At 21:30 UTC, 172 blocks (about 34 minutes) after the run's last transaction, `finality` on the folder above re-read all 8 transactions at head block 12,065,104: 8 in the same block, 0 changed, 0 unreadable [measured: the T-216 coordinating session ran it, needing no secret, and `finality.json` in the folder records it].
  - Scenario 1 does not pass under the pass rule yet, and this run predates T-220's deploy; both scenarios run again on T-220's Worker versions.

- **The remaining scenarios' foundation (2026-11-05, branch `t-216-remaining-scenarios`).** Offline only: no live run and no Sepolia transaction.
  - **`list` is unchanged:** after the split it prints the same 27 lines as before it, in the same order [measured: both outputs, line by line].
  - **The driver's own tests after the split,** before any other change: `examples/e2e-round.test.ts` 6 of 6, its anvil block included, in 148.8 s [measured]. So `run` behaves as before on SimChain (1, 2, 3a, 3b waiting for T-216, 3d, 6, 10a) and on anvil.
  - **The round's own adjudicator,** `examples/e2e-adjudicator.test.ts`, 5 of 5 [measured]:
    - its acceptance, four decisions (reject, accept with a key, appeal with a beacon and a ground, escalate with a key) and its registration hash to the same EIP-712 digests as core's `messageDigest`;
    - on SimChain: the first `ready` posts one registration, which binds the demo's registry, fee and policy under `t-216/adjudicator-1`, with a signature; a later run (a new `Round`) posts nothing and says "reused"; `bond` refuses on SimChain;
    - on SimChain, deals priced at 0: scripted reject on passing work ends Refunded; scripted accept on work missing a row ends Released and the buyer opens it with the key the adjudicator sealed; silent accepts and the deal is still Delivered on both operators 10 s later; no pass recorded an error, and no key appears in the run's lines;
    - on anvil (25 tUSDC deals): `ready` with a 75 tUSDC bond mints, approves and deposits from the adjudicator's own key, and its free bond reads 75 tUSDC; a later run sends no transaction (the key's nonce is unchanged) and writes no note; the scripted reject ends `dealOf` Refunded and the scripted accept Released, each `Decided` log naming the adjudicator; the accept's `KeyReleased` names the buyer, who opens the work; the silent deal reads Delivered on chain 10 s after delivery.
    - Times: the digest and SimChain tests 27.4 s; the anvil tests 65.7 s [measured].
  - **Not test-first:** the module came before its tests, and every test passed on its first run. To show the digest test can fail, encoding the acceptance's `bondReserved` from its fee made it fail with a digest mismatch; it passes again with the encoder restored [measured].
  - **After the harness moved to `e2e-world.ts`:** `e2e-round.test.ts` and `e2e-adjudicator.test.ts` together, 11 of 11 in 161.9 s, both anvil blocks included [measured]. The four group test files: 4 skipped, 10 todo [measured].
  - `tsc -b examples` and `eslint examples` are clean [measured].
  - `pnpm verify` on `7a516d5` with only this file and `docs/plan.md` uncommitted, 2026-11-05 15:09 UTC: **PASS**, no snapshot diffs against HEAD; `pnpm test` 2,711 passed, 6 skipped and 10 todo, in 121 files plus 6 skipped (`reports/verify-t-216-remaining-scenarios.md`) [measured]:

    | Step | Status | Time |
    | --- | --- | --- |
    | typecheck | pass | 7,954 ms |
    | lint | pass | 12,288 ms |
    | forge build | pass | 3,190 ms |
    | forge | pass | 53,991 ms |
    | test | pass | 279,709 ms |
    | spec | pass | 944 ms |
    | snap | pass | 11,040 ms |
    | snap:local | pass | 20,010 ms |
    | demo | pass | 5,492 ms |

  - The first `forge build` in this fresh worktree took about 206 s of compiling after cloning the contract submodules, and passed [measured].
  - Not run: a `reviewer` pass on this PR, and any live use of the adjudicator on Sepolia (the group sessions and Rafa's runs).

- **The live run of 2026-11-05 (Rafa, 13:25 to 13:44 UTC),** after T-220's deploy, driver at `c98c0b7`, against both operators (schema 0.10, domain 0.7) and HoldbackRules `0xF38287e5…7cFA`. Record: `/Users/rafa/Documents/escrow/.worktrees/round1-run/reports/e2e-round-1/2026-11-05T132524Z/` [measured: its `summary.md` and `finality.json`].
  - **Passed:** 1 (16 of 16, with both homepage runs and the published bundle), 2 (13 of 13), 3a (12 of 12) and 6 (16 of 16, the appeal decisions with drand quicknet proofs).
  - **Failed one check each:** 3d, 2 of 3 ("dealOf reads Expired" read None); 10a, 7 of 8 ("CPP holds nothing" read 26 tUSDC capturable).
  - The other ten recorded "waits (T-216)". The finality re-read at 13:45 UTC found 27 of 27 transactions in the same block.
- **The 3d and 10a diagnosis** (`/Users/rafa/Documents/escrow/reports/scratch/round1-3d-10a.md`, by the coordinating session) [measured by that session]: both are driver defects, with no product defect and no funds at risk. The driver read through publicnode, whose nodes can be a block behind each other, within 2 to 3 s of the deal's last transaction.
  - 3d: `dealOf(0x15011b…5185)` reads None at block 12,069,838 and Expired at 12,069,839, the expiry block. `expireOffer` writes `Stage.Expired` (`HoldbackRules.sol:528`).
  - 10a: CPP's payment state reads capturable 26 tUSDC at block 12,069,855, the funding block, and capturable 0 and refundable 15 tUSDC at 12,069,856, the settlement block. The demo primary's after free bond in the record, 24,977.5 tUSDC, is also block 12,069,855's; at 12,069,856 it is 25,002.5 tUSDC.
- **The remaining scenarios, built and integrated (2026-11-05, PR 210).** Offline only: no live run, and no Sepolia transaction.
  - Four group sessions built the ten waiting scenarios in parallel on branches `t-216-silent`, `t-216-scripted`, `t-216-escalation` and `t-216-direct`, each from `8a51b9d`. They merged into `t-216-remaining-scenarios` with no conflict, and main merged in at `8ee3ab1` with no conflict [measured].
  - **`list`** prints all 16 scenarios, none "not built in the driver yet" and no "needs" line [measured].
  - **Silent group (3b, 4, 9, 10b)** [measured by the group session]:
    - SimChain, about 110 s: 3b, 4 and 9 pass; 10b stops before any deal (Decision 23).
    - anvil, about 135 s: 3b 17 of 18, the only failure the anvil-only `fallback` relay refusal, after which the driver sends `triggerFallback` directly; 4 waits for T-217; 9 18 of 18; 10b 15 of 15; the finality re-read finds 0 changes.
    - On anvil the primary's late decision after an early accept reverts `WrongStage(5)`; on SimChain it is refused with "invalid_state: nothing to appeal after early_accept".
    - Gas on anvil: `triggerFallback` sent directly 52,285; `triggerDefault` 131,093 (Defaulted and Refunded in one transaction); `earlyAccept` 141,464; `mutualSettle` 158,825; a bond deposit's mint 50,963, approve 45,814 and deposit 56,667.
  - **Scripted group (3c, 7)** [measured by the group session]:
    - SimChain: 3c 8 of 8, 7 13 of 13.
    - anvil, with the sim beacon reseeded: 3c 17 of 17. `appeal-expiry` went through the API, the 1.25 tUSDC appeal bond came back to the seller, and `BondReleased` freed 25 tUSDC. 7 waits for T-217 on the anvil world, whose rulebook names the sim beacon.
    - 7's deals run in-process past the T-217 gate on anvil: every check held. `BondSlashed` paid 25 tUSDC from the primary to the buyer, then to the seller; the 1.25 tUSDC appeal bond came back each time; the primary's bond fell by 25 tUSDC per deal; the appeal decisions' beacon rounds matched the filing block plus 1.
    - Each bond top-up costs about 137,000 to 153,000 gas for mint, approve and deposit.
  - **Escalation group (5a, 5b)** [measured by the group session]:
    - SimChain: 5a 13 of 13; 5b 12 of 12 (the primary escalated on the screen flag, 5 seats from 3 families accepted, Released, the buyer opened the work, a later appeal refused with `invalid_state`).
    - anvil: 5a 21 of 21. Gas: fund 317,471; deliver 83,475; decide (escalate) 84,561; `triggerDefault` 125,352. 5b waits for T-217: on the anvil harness the appeal decision reverts `BadSeed`, since the harness's SimBeacon seed is not the world's (a harness limit, not a product defect [inferred]).
    - The deal showed Escalated 4 s after delivery on SimChain and 5 s on anvil, wall-clock with 1 s polling.
  - **Direct group (8, 11)** [measured by the group session, on anvil]:
    - 8, deal 1: every check held. `agreeAndFund` 248,606 gas and `deliver` 80,987 gas, each shown as direct on both operators within 0 s; the buyer paid 26 tUSDC with no operator fee; the seller received 25 tUSDC.
    - 8, deal 3: `triggerFallback` sent directly, 52,285 gas, shown as direct within 0 s; both operators served the fallback its envelope; the deal ended Refunded by its default, and 8 waits for T-217.
    - 11 without a restart: 10 of 12, only the two restart checks failing, as they should. 11 with the world reopened from its storage at the lane row write: 12 of 12.
  - **Test first** [measured by the groups]: the silent and scripted groups committed their tests first, and each failed before the build; the escalation group's list test failed before the build; the direct group wrote its code first, and its new tests fail on `8a51b9d` (2 failed: the list test and the SimChain test).
  - **Integration fixes** [measured]:
    - `stop` holds the process (Decision 29).
    - The pinned evidence reads (Decision 30). Test first: the new stand-in RPC tests in `examples/e2e-chain.test.ts` failed before the fix, 2 of 9, the unpinned read reporting None for an expired deal; after it, 9 of 9 pass. They show a read at the latest block when none is given, a read at the deal's last block that a lagging node misses twice and then answers, with no read at the latest block, and a read that throws after its tries.
  - **The round's driver tests after integration,** the 7 driver test files (`e2e-round`, `e2e-adjudicator`, `e2e-chain` and the four groups'): 36 of 36 passed in 432.8 s, every anvil block included [measured].
  - `tsc -b examples` and `eslint` on the changed files are clean [measured].
  - `pnpm verify` on `5c66937`, with only this file and `docs/plan.md` uncommitted, 2026-11-05 17:31 UTC: **PASS**, no snapshot diffs against HEAD; `pnpm test` 2,734 passed and 6 skipped, in 125 files plus 2 skipped; forge 241 of 241; snap 31 of 31; snap on the contract 28 passed, 3 excluded until Phase 4 (`reports/verify-t-216-remaining-scenarios.md`) [measured]:

    | Step | Status | Time |
    | --- | --- | --- |
    | typecheck | pass | 2,392 ms |
    | lint | pass | 4,935 ms |
    | forge build | pass | 1,115 ms |
    | forge | pass | 21,646 ms |
    | test | pass | 431,115 ms |
    | spec | pass | 633 ms |
    | snap | pass | 9,929 ms |
    | snap:local | pass | 15,367 ms |
    | demo | pass | 4,176 ms |

  - Not run: a `reviewer` pass on PR 210, and any live run (Rafa's, Handoff).
- **PR 210's review findings, fixed (2026-11-05).** One high, one medium and three low findings; all five are fixed in the PR. Offline only: no live run and no Sepolia transaction.
  - **High: CI could not pass.** Gitleaks flagged a made-up address keyed `token` in `examples/e2e-adjudicator.test.ts` line 50 (commit `7a516d5`, rule `generic-api-key`; CI run 42052422672), and the PR conflicted with main in `docs/plan.md`. `.gitleaksignore` now names that one finding, as PR 189 did for anvil's dev key (Handoff, Outside this lane); main merged in at `e4aa6fb`, keeping main's rows and this PR's T-216 row [measured: the merge and the file]. Whether CI's `check` and `gitleaks` pass shows on the PR after the push.
  - **Medium: the before reads after the round's own mint** (Decision 31). Test first: five new stand-in RPC tests in `examples/e2e-chain.test.ts` failed before the fix, 5 of 14 [measured]. The stand-in's latest block is one behind the round's mint. Before the fix, `refreshBefore` read the buyer's 1 tUSDC from before the mint instead of 12 tUSDC after it; a receipt read that a node missed threw at once; `fresh()` did not exist; and `send` reached `eth_getTransactionCount` at 30 gwei. After the fix: 14 of 14 [measured].
  - **Low: the adjudicator acted on a stranger's deal** (Decision 20). Test first: a deal between another seed's buyer and seller naming the round's adjudicator-3 as primary was `AcceptedByAdjudicator` on both operators within 10 s before the fix; after it, the deal stays Offered and the adjudicator acts on nothing. `examples/e2e-adjudicator.test.ts`: 6 of 6, the anvil block included [measured].
  - **Low: scenario 11's pause could be skipped by a buffered Enter** (Decision 33). Test first: two unit tests of `typed` on a stream standing in for stdin failed before the change and pass after it; an earlier empty line and a `yes` do not end the wait, ` Deployed ` does, and a closed input stops it with an error [measured]. The two anvil runs of 11 now answer with an Enter, then `deployed`: the driver prints that it ignored the Enter.
  - **Low: no fee cap on direct sends** (Decision 32). The stand-in test at a 30 gwei base fee: `send` refuses with "refusing to send approve: the network asks … gwei per gas, above the 20 gwei cap" and never asks for a nonce or sends a raw transaction [measured: the test's assertions]. The fee it names is about 37 gwei [inferred: viem's estimate is 1.2 times the 30 gwei base fee plus the 1 gwei tip].
  - **The direct and scripted groups on anvil, after the fixes:** `examples/e2e-scenarios-direct.test.ts` and `examples/e2e-scenarios-scripted.test.ts`, 12 of 12 in 428.5 s: 8, both runs of 11 (no restart: only the two restart checks fail, as they should; with the restart: 12 of 12), 3c and 7, with every direct send under the fee cap [measured].
  - `tsc -b examples` and `eslint` on the changed files are clean [measured].
  - `pnpm verify` on `23f2e30`, with only this file and `docs/plan.md` uncommitted, 2026-11-05 18:25 UTC: **PASS**, no snapshot diffs against HEAD; `pnpm test` 2,742 passed and 6 skipped, in 125 files plus 2 skipped; forge 241 of 241; snap 31 of 31; snap on the contract 28 passed, 3 excluded until Phase 4 (`reports/verify-t-216-remaining-scenarios.md`) [measured]:

    | Step | Status | Time |
    | --- | --- | --- |
    | typecheck | pass | 1,228 ms |
    | lint | pass | 5,300 ms |
    | forge build | pass | 1,358 ms |
    | forge | pass | 19,347 ms |
    | test | pass | 433,509 ms |
    | spec | pass | 597 ms |
    | snap | pass | 9,371 ms |
    | snap:local | pass | 14,444 ms |
    | demo | pass | 3,969 ms |

- **The two live runs of 2026-11-05 evening (Rafa), driver at `1a2cbd3` (PR 210 merged), on the Worker versions of T-228's deploy** (holdback-op1 `ba7a2ad9`, holdback-op2 `7826e3ce`, live since 15:29 UTC). The two runs overlapped on the same round keys from 19:37 to 19:40 UTC. Records: `/Users/rafa/Documents/escrow/.worktrees/round1-run/reports/e2e-round-1/2026-11-05T190711Z/` (run A) and `…/2026-11-05T193705Z/` (run B) [measured: their records and `summary.md`].

  | Scenario | Run A, 19:07 to 19:40 UTC | Run B, 19:37 to 20:09 UTC |
  | --- | --- | --- |
  | 1 | pass, 16 of 16 | fail, 15 of 16: the buyer -61.42 tUSDC (overlap) |
  | 2 | pass, 13 of 13 | pass, 13 of 13 |
  | 3a | pass, 12 of 12 | pass, 12 of 12 |
  | 3b | error at start: the bond deposit reverted 0x7939f424 | error at start: the same revert |
  | 3c | pass, 17 of 17 | pass, 17 of 17 |
  | 3d | pass, 3 of 3 | pass, 3 of 3 |
  | 4 | fail, 17 of 18: the buyer -61.42 tUSDC (overlap) | pass, 19 of 19 |
  | 5a | fail, 20 of 21: the seller 25 tUSDC (overlap) | pass, 21 of 21 |
  | 5b to 11 | not run: the gate read 5a's deal as Escalated | not run: the same |

  - The finality re-read of run A at 19:53 UTC found 28 of 28 transactions in the same block, at head 12,071,675 [measured: `finality.json`]. Run B has no re-read yet.
- **The diagnosis (2026-11-06): three driver defects, no product defect, no funds at risk.** Read from the records and from public Sepolia data (receipts, block times, `dealOf` at given blocks), with no key and no transaction.
  - **3b's bond deposit reverted `TransferFromFailed()` (0x7939f424) because it was simulated on a node that had not seen the approval sent seconds before.**
    - Run A: adjudicator-1 `0xc1f7c0…f2bc` minted 25 tUSDC (nonce 0, block 12,071,529, 19:23:36 UTC), then approved HoldbackBonds for 25 tUSDC (nonce 1, block 12,071,531, 19:24:00 UTC, 127,734 gas). 3b stopped at 19:24:03.6 UTC. No deposit was sent: the key's nonce 2 is 3c's approval, in block 12,071,532 [measured].
    - Run B, with run A ended 13 minutes before: adjudicator-2 `0x147ba5…177b` minted (nonce 0, block 12,071,675, 19:53:12 UTC) and approved (nonce 1, block 12,071,676, 19:53:24 UTC); 3b stopped at 19:53:26.4 UTC; the key's next nonce is still 2 [measured]. So the overlap did not cause it.
    - The approval was mined for the full amount in both runs, so a missing or short approval is ruled out [measured]. `RoundChain.send` simulated `deposit` at the latest block 2 to 4 s after the approval's block, on a node of the load-balanced RPC that did not have it: no allowance, and the token refused `transferFrom` [inferred from the code and those times]. Run A's 3c deposit passed because the allowance and the balance it needed were 3b's, a block older [measured: block 12,071,533].
  - **4's buyer at -61.42 tUSDC and 5a's seller at 25 tUSDC counted the other run's deal.** The checks compared wallet balances before and after the deal, and the round's buyer and seller play every deal.
    - Run A's 4 read its buyer at 808.81 tUSDC before block 12,071,562 and 747.39 tUSDC at 12,071,599. Run B's scenario 1 funded 30.71 tUSDC from the same buyer in block 12,071,597, inside that window: -61.42 is twice -30.71 [measured].
    - Run A's 5a window ran from 12,071,599 to 12,071,610. Run B's 1 paid the seller 25 tUSDC in block 12,071,600 [measured].
    - Run B's 1 window (to 12,071,606) took in run A's 5a funding of 30.71 tUSDC in block 12,071,601 [measured].
    - Each deal's own transfer logs give the expected amounts: -30.71 tUSDC for 4's buyer, 0 for 5a's seller [measured: the records' logs, now `examples/e2e-run.test.ts`'s fixtures]. Without an overlap, run B's 4 and 5a passed [measured].
  - **The gate after 5a stopped eleven scenarios on a stale read; 5a had closed its deal.**
    - Run A's 5a deal `0x3a279b…dfb2` reads Escalated in `dealOf` at block 12,071,609 and Refunded from 12,071,610 (19:40:00 UTC), the block of its default [measured]. 5a's own checks read Refunded at that block and on both operators. The gate's latest-block read by 19:40:15 UTC answered Escalated.
    - Run B's 5a deal `0xab5fdc…70d8` reads Escalated at 12,071,748 and Refunded from 12,071,749 (20:09:00 UTC); the gate at 20:09:12 UTC read Escalated again [measured].
    - `openDeals` read the latest block, and a node behind the default's block answered the state before it [inferred]. The Handoff of 2026-11-05 named this risk as "inferred; not seen"; it is now seen twice.
  - Both 5a deals ended Refunded on chain. adjudicator-2's 25 tUSDC stays in its own wallet, with its allowance to HoldbackBonds [measured].
- **The fixes (2026-11-06, branch `t-216-live-fixes`).** Offline only: no live run and no Sepolia transaction.
  - **Test first** (commit `e784c09`): before the fix, 5 of the new tests in `examples/e2e-chain.test.ts`, 12 of 13 in the new `examples/e2e-run.test.ts` and the new lock test in `examples/e2e-round.test.ts` failed [measured]:
    - a bond deposit right after its approval, against a stand-in RPC whose latest block trails the round's own sends by one, reverted with "The contract function "deposit" reverted with the following signature: 0x7939f424", the live error;
    - `openDeals` returned 5a's refunded deal as Escalated;
    - `delta` returned -61.42 tUSDC for 4's buyer and 25 tUSDC for 5a's seller, from fixtures built from run A's records;
    - the gate after a scenario, the other-run check, the idle-keys check and the round's lock did not exist.
  - **After the fix:** `examples/e2e-chain.test.ts` and `examples/e2e-run.test.ts`, 32 of 32 in 22.7 s [measured]. They show:
    - the deposit simulated and estimated at the approval's block, never `latest`, and sent with nonce 1 while the lagging node still counts nonce 0 as pending;
    - a pinned simulation that finds no header tried again, and a revert refused at once with nothing sent;
    - `openDeals` reading 5a's deal at its last block: not open;
    - the money of 4 and 5a from the deal's own logs: -30.71 tUSDC and 0, and bonds from HoldbackBonds' events (deposit, encumbrance, slash, an appeal bond paid into the bond);
    - on SimChain, a deal a stopped scenario left Held closed by `reclaim` through the API at deliverBy, and a deal whose delivery is due in an hour refused at once with nothing sent;
    - another run's deal found among the round buyer's deals, this run's own and older ones left out;
    - the lock refusing a second run while its holder runs, and taken over when its holder has ended;
    - the start refused while a round key has a send pending through the whole wait.
  - `examples/e2e-round.test.ts` without anvil, 5 of 5 run, 54.9 s [measured]: the lock refusal with exit 3 before any network call, its release when the run stops, and the SimChain run of 1, 2, 3a, 3d, 6 and 10a through the new gates.
  - **The start's refinement** (commit `0f31c20`): it refuses while a held deal of the round's buyer changed in the last 2 minutes, and the gate sends each trigger once per deal. `examples/e2e-run.test.ts`, 15 of 15 in 22.9 s, with the refusal, its 2-minute bound and the operators' list of held deals [measured].
  - **Every driver test file, anvil included** (`e2e-round`, `e2e-adjudicator`, `e2e-chain`, `e2e-run`, `e2e-keys` and the four groups'): 78 of 78 in 431.8 s, none skipped [measured, commit `1946904`]. So every direct send on anvil (3a's reclaim, 3b's `triggerFallback`, 3c's and 7's approvals, the bond deposits, 8's funding and delivery) went through the pinned simulation and estimate, and every money check through the deal's own logs.
  - `tsc -b examples` and `eslint` on the changed files are clean [measured].
  - **Before the rerun** (2026-11-06, read-only GETs): neither operator lists a deal of the round's buyer that holds money, of the 26 they list for it, so the start gate has nothing to close [measured].
- **PR 220's review** (the `reviewer` role, 2026-11-06): ISSUES, no High. It agreed with the three diagnoses from the records and the code. Two Medium and six Low findings, all addressed in the PR [measured: the review's report]:
  - **Medium, fixed:** the Handoff said `round1-run` already held the fixes. It now gives the commands to move it, and the session moves it after the merge.
  - **Medium, fixed:** neither merge gate was clean. CI's gitleaks job failed before scanning, on a GitHub API error, and `pnpm verify` failed its test step because this session edited `e2e-run.ts` during it, so the run read old and new code. Both run again on the final commit (below).
  - **Low, fixed:** the lock covered one checkout. It now sits in the clone's shared reports folder (Decision 37).
  - **Low, fixed:** a check that expects nothing to move could pass if a transaction was missing from the record. The chain's own logs now complete it (Decision 35).
  - **Low, fixed:** the gate could refuse on one stale read, and retried a refused trigger for 15 minutes. It refuses on two passes in a row, and after three identical refusals (Decision 36). Decision 36 no longer claims that 15 minutes covers a deal stopped before delivery.
  - **Low, fixed:** a stop during the gate's wait lost the scenario's record. The driver writes it before the wait.
  - **Low, fixed:** the `docs/team.md` row read as an enforced check. It is now "Partial", and `deliveryHashOf` reads at the deal's last block too.
  - **Info:** the docs' inconsistencies and long sentences are fixed. No test drives the start gate or the gate after a scenario through the driver with an open deal; their parts are tested on their own [inferred: the gap stays].
  - **After the fixes:** `examples/e2e-chain.test.ts` and `examples/e2e-run.test.ts`, 39 of 39 in 24.2 s. The new tests cover the chain's list of a deal's transactions (a node missing a known one is asked again), `deliveryHashOf` at the deal's last block, the refusal after three identical refusals, and one lock folder for a clone's main checkout and its worktrees [measured].

## Decisions

Made by the driver session on 2026-11-04, inside the task's paths.

1. **The driver signs with the published agent code.** It uses `examples/agent.ts` and `verify.ts`, the code behind `try.mjs`, which `llms.txt` points to. So every message an operator prepares is rebuilt from the round's own intent and checked before a round key signs it, and nothing in the round is beyond an outside agent.
2. **One buyer and one seller for every deal.** The round's `buyer` and `seller` keys play every deal, one scenario at a time, so each deal's balance changes are its own. The x25519 keys derive from the same seed (`roundEncryptionKey`). Before funding, the faucet admits and grants once an hour per address; past that, the key mints its own tUSDC (open mint) and pays the gas from its own Sepolia ETH.
3. **Scenario 2 relays through the second operator,** so the round's own deals run through both nodes. Scenario 1 also runs the homepage command once relayed by each node.
4. **Evidence comes from the chain's own records.** The operator fee paid once, the bond freed, the key released and the decision naming the posted delivery are checked from the transactions' decoded logs and calldata (`Transfer`, `BondReleased`, `KeyReleased`, `decide`'s `deliveryHash` against `deliveryHashOf`), not from balance deltas of shared addresses. The demo adjudicators and the fee address serve other deals at the same time.
5. **`appeal-expiry` closes scenarios 1 and 2.** On Sepolia only `expireAppeal` frees the primary's bond. The driver sends it through the API after `appealBy`, unless the primary has already closed the window (T-211). If the API refuses, the run records the failed check and sends `expireAppeal` directly from the buyer's key (the escape hatch, ADR-0005), so the bond is still freed.
6. **A scripted panel fails scenario 1's "a live panel judged" check.** The scenario asks for a live panel; when the demo's live budget is spent or its keys are missing, the run says so instead of passing.
7. **No re-roll guard.** Once a run records scenario 1's live panel rejecting honest work on this deployment, the driver refuses to run scenario 1 again unless told which fix it follows (`--rerun-after "<the fix>"`), and the record keeps that reason.
8. **Prerequisites are detected where an API read shows them.** T-217: the club's rulebook names `drand-quicknet` on a chain (the demo world's fallback and appeal adjudicators decide on a chain only with it; SimChain needs none). T-221: the demo primary's served registration carries a signature, which its second slice adds when the world's registration store goes live; schema 0.10 alone came with its first slice (PR 184). T-218 and T-219 show in no read, so `--t220` says T-220 has deployed them. A scenario whose prerequisite is missing, or that the driver does not build yet, is recorded as waiting, not failed.
9. **Scenarios 3a, 3d and 10a need no prerequisite.** The task listed them under scenario 3's and 10's blocked lines, but their only need was the round's own Sepolia ETH, which the top-up provides. They run now. Scenario 10 is split in two: 10a settles before delivery and runs now; 10b settles after delivery and waits for T-221. So a pass of 10a never reads as all of 10 (the pass rule).
10. **The chain guard allows anvil, and refuses after discovery.** `assertRoundChain` accepts Sepolia, and anvil for the driver's own tests, and refuses a mainnet, any other chain, and an RPC whose chain is not the pinned deployment's, with a `Refusal` (exit 3). It runs after the two discovery reads, which pick the pinned deployment, and before any write, signature or transaction; a process-level test shows the RPC is asked only `eth_chainId` and nothing is posted. The task's line (How the round runs) names `assertSepolia` (Sepolia only, before any other call), and `assertSafeChain` (the mainnet list) as the looser check. This check sits between them: stricter than the mainnet list, looser than `assertSepolia` because it also accepts anvil, which the driver's offline tests need, and it runs after the two discovery reads rather than before every call.
11. **Errors pass through `printable()`** (PR 183's), so a keyed RPC URL in `SEPOLIA_RPC_URL` never reaches the terminal, a record or `summary.md`; the driver's `reason()` adds the contract's revert name (`TooEarly`, `WrongStage`) when viem decoded one. A test plants a key in the URL of a failing RPC.
12. **A scenario that leaves money held stops the run,** whether it stopped or only failed a check (an escalation, say). Every deal has the same buyer and seller, so such a deal would settle inside the next scenario's balance window; the remaining scenarios are recorded as not run, naming the open deal. Read-only calls retry with backoff, and direct timeout triggers retry while the latest block is still before the deadline (`TooEarly`).
13. **An upheld appellant loses its bond plus the rulebook's appeal fee where the settlement layer charges one.** SimChain charges the fee (25 tUSD in the demo rulebook, measured); the contract does not (Phase 4), which the record notes instead of passing.
14. **The published-bundle check counts only after T-220.** Before T-220's deploy the site deliberately serves the bundle that matches the live operators, not main's, so without `--t220` the driver records the comparison as a note (the T-216 coordinating session, 2026-11-04). The homepage command still runs relayed by each operator, as the task asks ("passes against both nodes"); each run takes one or two faucet grants of the ten per client an hour.

Made by the remaining-scenarios session on 2026-11-05, inside the task's paths.

15. **One file per scenario group, and the shared helpers in a kit.** The ten waiting scenarios moved, unchanged, into `e2e-scenarios-silent.ts`, `-scripted.ts`, `-escalation.ts` and `-direct.ts`. The helpers more than one scenario uses (`requires`, `waiting`, the appeal steps, the settlement checks, the deals' terms and work) moved to `e2e-scenario-kit.ts`. Every scenario file imports from the kit and never from `e2e-scenarios.ts`, so the registry there imports the four groups without an import cycle: with a cycle, a group file that used a kit constant at load time would fail before the driver started.
16. **The registry sorts by scenario number and refuses an ID listed twice.** `SCENARIOS` is the built scenarios plus the four groups, sorted by number then letter, so `list` prints the same order as before, and two group files that both define a scenario stop the driver at load with a message naming it.
17. **The round's adjudicator copies the demo primary's served record.** It registers the demo's `policy` under its own `id` (`t-216/<role>`), the demo's `registry` and `fee`, and the demo's pool terms, with its own address, encryption key and name. So the demo's fallback and appeal adjudicators judge for it (T-221's recipe), and a demo appeal adjudicator can overturn its wrong decisions (scenario 7).
18. **A registration in place is reused; otherwise it registers again.** It is reused when both operators serve the same body, its hashes recompute, its signature recovers to the key, and more than 7 days remain of its 30. Otherwise the adjudicator signs a new one with a later `issuedAt`, for example after a deploy changes the demo's policy.
19. **A bond in place is reused; otherwise it deposits the shortfall.** `bond` asks for a free bond: when the free bond in HoldbackBonds already covers it, nothing is sent. Otherwise the key mints the missing test tokens, approves and deposits the shortfall from its own Sepolia ETH, then waits until both operators serve the bond, since a relay refuses terms whose fallback shows less free bond than the price (T-221, through a cache of about 12 s). On SimChain it refuses: no outsider can bond there at run time.
20. **It serves in the driver's process and acts only on the round's deals.** `serve` reads the deals that name it every 3 s and acts only on those between the round's buyer and seller that name it primary and were offered after it started serving (with 15 s of margin for the two operators' clocks). So a deal left from an earlier run is never decided by a later one, and a stranger's deal is left alone: its address is public through its registration, and without the buyer and seller check a stranger's deal could take the free bond the scenario's own deal needs, or, in 7, be appealed to slash it (PR 210 review). As fallback or appeal adjudicator it is always silent: those turns need a drand proof (T-217). The script is `silent`, `{ decide: 'accept' }` or `{ decide: 'reject' }`; no needs line asks for a scripted escalation. Its timers never hold the process open, so a scenario that forgets `stop` still lets the driver exit.
21. **A scripted decision is signed like a real one.** It reveals a seed derived from its key and the commitment ID (whose hash it committed at acceptance), names the delivery both operators serve, and carries the hash of a note that says no judge ran as its `judgmentRecordHash`; no record is published. An accept seals the content key from its own envelope to the buyer, since the contract refuses an accept without one (`HoldbackRules._settleDecision`); a reject carries none.
22. **The round's tests share one harness,** `examples/e2e-world.ts`: the demo's world served on two origins, on SimChain or on anvil, the driver as a separate process, and the no-secrets check. It moved out of `e2e-round.test.ts` unchanged, so the groups' tests can use it too. The adjudicator's SimChain tests price their deals at 0, which needs no bond, so CI's test shards, which have no anvil, still run its silent and scripted paths end to end.

Made by the four group sessions and the integrating session on 2026-11-05, inside the task's paths.

23. **On SimChain the round's adjudicator's deals are priced at 0.** No outsider can bond there at run time, so the flow runs and the money checks hold at 0; the money is checked on a chain. 10b cannot run on SimChain: a `MutualSettlement` needs 1 to 8 positive payouts that sum to the price (`spec/schemas/common.schema.json`, Payouts), and a price of 0 has none. It runs on anvil and Sepolia.
24. **The timeout windows (silent group).** Offer 2 windows, fund 3, deliver 4, with floors of 20 s, 30 s and 40 s, so the round's primary has time to accept before the funding; scenario 4's fallback window is at least 180 s. The parties choose them (D31).
25. **3c's appeal windows (scripted group):** `appealWindowSec` is the larger of 2 windows and 30 s; `appealDecideSec` is 1 window. 3c waits past `appealDecideBy` on purpose, so it polls with its own `untilAppealIs`, which has no deadline guard; the kit's `untilAppeal` keeps its guard for its other callers.
26. **5a exhausts the check budget with a regex; 5b trips the screen with soft hyphens (escalation group).**
    - 5a: a `regex_match_rate_min` check with the pattern `(.*){1000}(.*){1000}` over 3 cells of 10,000 characters needs about 60,000,000 work units, and a delivery gets 50,000,000 (`CHECK_BUDGET`). The check is inconclusive and the primary escalates with no panel.
    - 5b: scenario 1's French with 4 soft hyphens (U+00AD), as a word processor writes them. No attack fixture or red-team test uses U+00AD.
    - If no appeal decision shows on both operators within 30 s after `appealDecideBy`, 5b records the failed check and closes the deal by its default, so no money stays held (Decision 12).
27. **Scenario 8 builds only its needs line (direct group).**
    - It does not repeat the direct reclaim: 3a's second deal sends it, and 8 notes this.
    - Deal 3 gates the fallback's decision on T-217, not the takeover.
    - The direct funding builds its own typed data: the prepare route adds a fee slot when the operator charges a fee, and the agent's verifier refuses a fee slot it did not intend.
    - "One sync pass" is 60 s from the receipt.
28. **Scenario 11 finds the moment and the restart itself (direct group).** It detects the broadcast from the deal lane's nonce while holdback-op1 has not answered, and the restart with an Idempotency-Key probe: op1 keeps a key in memory until it restarts, so other bytes under the same key get 409 before the restart and 200 after. It prints full-path build and deploy commands and deploys nothing itself.
29. **A serving adjudicator's `stop` holds the process (integration).** The serving loop's naps never hold the process open. So when `stop` was the driver's last pending work, Node exited with it unsettled and the scenario's record unwritten; three groups found this and each held a timer locally. `stop` now holds one itself while the loop winds down, and the three local copies are gone. Each group's driver test runs the driver as a child process, so a regression shows as a missing record.
30. **The evidence reads pin to the deal's last block (integration, from the 3d and 10a diagnosis).** `finish` reads `dealOf`, CPP's payment state and the after balances at the block of the deal's last transaction. A pinned read that fails is tried 8 times, 2 s apart, then throws: it never falls back to the latest block, so a lagging node shows as an error, not a wrong state. The after balances at that block also keep a demo adjudicator's later deals out of this deal's deltas. `openDeals` still reads the latest block, since the diagnosis did not assign it (Handoff).
31. **A deal's starting balances are read no earlier than the round's own last transaction (PR 210 review).** `RoundChain` keeps the newest block it has read a receipt from: its own mints, approvals and deposits, and the deals' transactions. `fresh()` is the larger of that block and the latest block the RPC reports. `offer`'s before read, `refreshBefore` and `ensureFunds`' balance read (`holdingsNow`), and `bond`'s free-bond read pin to it. A node one block behind a mint would otherwise answer the balance from before the mint while the closing read includes it, and checks such as "the buyer pays the price…" would fail by the minted amount. A read of a receipt that a node does not have yet is tried again, 8 times 2 s apart (`pinnedRetry`), so `RoundChain.transaction()` right after `waitForTransactionReceipt` no longer throws after a mined transaction, which in 8's `directFund` would leave a deal Held and stop the run (Decision 12). A receipt read never raises the floor past a block the chain has made, since it comes from a mined transaction [inferred].
32. **Direct sends refuse above 20 gwei (PR 210 review).** `RoundChain.send` estimates fees after the simulation and, above `MAX_FEE_PER_GAS` (20 gwei, the cap `e2e-keys.ts topup` and the operators' funding lane use), refuses before it signs, with a `Refusal` that names the fee. Below it, the estimate goes on the transaction as its `maxFeePerGas`, so a spike between the check and the send cannot raise the price. The fees go on the send, not the simulation, since a node checks an `eth_call`'s fee fields against the key's balance. A refusal stops the scenario like any error; a deal it leaves Held stops the run (Decision 12), and the money stays in the hold until its deadlines, never drained from the key.
33. **Scenario 11's pause ends on the typed word `deployed` (PR 210 review).** Nothing reads stdin before scenario 11, so an Enter typed earlier in the 1.5 to 2 hour run stays buffered and would end the pause at once. `typed('deployed')` ignores every other line, says so, and still stops with an error when stdin closes.

Made by the live-fixes session on 2026-11-06, inside the task's paths.

34. **A direct send reads the state after the round's own last transaction (3b).** `RoundChain.send` simulates the call and estimates its gas at `fresh()`, the larger of the latest block and the newest block the round has a receipt from. A node with no header for that block is tried again, 8 times 2 s apart; a revert is refused at once. The gas limit is the estimate plus a fifth, since the call runs a block or more later. The nonce is the larger of the pending count and the one after this key's last send in the process, so a node behind the approval cannot hand the deposit the approval's nonce. The fee cap (Decision 32) still comes before any nonce read or signature.
35. **On a chain, the money checks read the deal's own transactions (4 and 5a).** `delta` sums the test token's `Transfer` logs to and from the address among the deal's transactions, and HoldbackBonds' events for its bond and free bond (`flowOf`). The balances before and after stay in the record as evidence, and `summary.md` shows the address's change beside the deal's own only when they differ. The relayer bundles only a deal's own operator fee with its funding, so a deal's transactions carry no other deal's transfers [inferred from `evm-settlement.ts`, `agreeAndFund`]. On SimChain, which has no logs, `delta` still compares the balances.
    - **The deal's transactions come from the chain too** (PR 220 review). `finish` asks the chain for every HoldbackRules log that names the deal, from the block of its starting balances to the latest (`dealTransactions`). A transaction that neither the operators' events nor the round's sends name joins the record as "on chain only", with a note. So a check that expects nothing to move cannot pass for lack of a transaction. A node whose logs lack a transaction the round already knows is behind, and the driver asks again.
36. **The gate after a scenario closes what the scenario left open, within 15 minutes (5a).**
    - `openDeals` reads each deal at its last transaction's block or later.
    - A deal that still holds money gets its next timeout through the API once it is due (`POST /v1/commitments/<id>/triggers/<kind>`): `reclaim` at deliverBy, `fallback` at judgeBy, `default` at fallbackBy or appealDecideBy, `apply-default` on SimChain. Anyone may send one, and the operators relay it even for a deal behind the chain (T-228). The gate sends each trigger once per deal.
    - The gate refuses a deal its timeouts cannot close within the wait, on the second pass in a row that finds it so, since one read can show a state from before the deal's last step. It also refuses when the API gives the same refusal of a due trigger three times in a row. The driver then records the remaining scenarios as not run, with the reason.
    - 15 minutes covers a deal stopped after its delivery [inferred from the windows of Decisions 24 to 26: 4's fallback window of 180 s or more]. It does not cover a deal stopped between funding and delivery under the default delivery window of 24 hours (`apps/operator/src/terms.ts`): the gate refuses it and names the time it can close, as the driver did before this change (PR 220 review).
    - The driver writes the scenario's record and `summary.md` before the gate's wait, and again after it with the gate's steps. A stop during the wait keeps the record, and its end time stays the scenario's own.
37. **One run of the round's keys at a time.** Two runs share the buyer, the seller and the round's adjudicators, so each counts the other's deals, and a serving adjudicator of one acts on the other's deals.
    - **A lock file per master** (`run-<master>.lock`), taken before any network call and given back when the run ends. It sits in the reports folder of the clone's main checkout (`/Users/rafa/Documents/escrow/reports/e2e-round-1/` here), which every worktree finds through git's common directory (`sharedReports`), so a run from `.worktrees/round1-run` and one from the main checkout meet one lock (PR 220 review). A second run refuses with exit 3 and names the process, its start and its folder. A new run takes over a lock whose process has ended, and says so. A separate clone has its own lock.
    - **Pending sends:** before the first scenario, the start waits up to 60 s while a round key has a transaction pending, then refuses. This catches a run from a separate clone only while it sends from the round's own keys; most of a run's steps go through the operators.
    - **The start gate** closes an earlier run's deal of the round's buyer that still holds money, as the gate after a scenario does, or refuses to start. It refuses at once while such a deal changed in the last 2 minutes (`refuseActive`): another run may still be driving it, and the start must not send its timeouts.
    - **After each scenario,** a deal of the round's buyer offered since this run started, which this run did not offer, stops the remaining scenarios with a message naming it. The buyer's address is public, so a stranger's offer to it would stop the round too; the message names the deal, so Rafa can tell.
    - **What stays open** [inferred]: a run from a separate clone, in a stretch where it sends nothing from the round's keys and its deal has not changed for 2 minutes (run B's 4 sat 5.4 minutes between delivery and takeover), passes these checks; the start gate could then send that deal's timeout. Both runs then stop at their next gate, and no funds are at risk.
38. **The run order stays by scenario number.** With the gate and the per-deal money checks, a long scenario no longer blocks or spoils the ones after it, so putting the long ones last would only bring the short ones' results sooner. Scenario 11 stays last, as its pause needs Rafa at the terminal. `run` already runs the IDs in the order given, for a rerun in another order.

## Handoff

- **Next: Rafa's live run of the scenarios still to pass,** from the `round1-run` worktree. The live-fixes session moves it to main after PR 220 merges. One terminal only: a second run of the round's keys from any worktree of this clone refuses to start (Decision 37). The commands print addresses and links, never the secret or a key.
  1. Check the worktree's commit: `git -C /Users/rafa/Documents/escrow/.worktrees/round1-run log -1 --oneline` shows PR 220's merge commit or a later one. If it shows `1a2cbd3`, move it first: `git -C /Users/rafa/Documents/escrow/.worktrees/round1-run fetch origin`, then `git -C /Users/rafa/Documents/escrow/.worktrees/round1-run checkout --detach origin/main`, then `pnpm -C /Users/rafa/Documents/escrow/.worktrees/round1-run install --frozen-lockfile`.
  2. **No top-up is needed.** Every round key still holds about 0.04 Sepolia ETH: each spent less than 0.00000002 Sepolia ETH across the earlier runs, as Sepolia's gas price was 27 wei per gas on 3c's deposit [measured, 2026-11-06, `eth_getBalance` and the receipt through publicnode]. The run needs well under 2,000,000 gas a key, which 0.04 Sepolia ETH covers even at the 20 gwei cap [inferred from the anvil gas].
  3. The run, in a terminal: scenario 11 waits there for you to type `deployed`.

     ```bash
     node --env-file=/Users/rafa/Documents/escrow/.env /Users/rafa/Documents/escrow/.worktrees/round1-run/examples/e2e-round.ts run 3b 4 5a 5b 6 7 8 9 10a 10b 11 --t220
     ```

     - Why these eleven: 3b and 5b to 11 have not run on T-228's Worker versions (6 passed at 13:25 UTC, before that deploy); 4 and 5a passed in run B, and run again here to show the per-deal money checks live.
     - 1, 2, 3a, 3c and 3d passed on the same Worker versions in run A, and every one but 1 in run B too. Adding them to the command (or `run all --t220`) shows every scenario under one driver, at about 25 minutes more [measured: run A took 16 minutes for them].
     - It runs the scenarios in the order given. After each one, the gate closes a deal the scenario left holding money, within 15 minutes, and stops the run only when a deal cannot settle in that time (Decision 36). A direct send while Sepolia's fees are above 20 gwei is refused and stops that scenario (Decision 32); run the scenarios left by ID once fees fall.
     - It takes about 1.5 hours [guessed: the waits of 3b, 4, 5b, 7 and 8 are minutes each; 4 and 5a took 10 minutes together in run B].
  4. **What scenario 11 asks of Rafa.**
     - At its start it prints `pnpm -C /Users/rafa/Documents/escrow/apps/demo-cloud build`. Run that in another terminal, so the redeploy at the pause is quick.
     - It relays a delivery through holdback-op1, then pauses once the deal's relayer lane has broadcast it and op1 has not answered. It prints the lane, the nonce and `npx -y wrangler@4 deploy -c /Users/rafa/Documents/escrow/apps/demo-cloud/wrangler.op1.jsonc`. Running that deploy is the scenario's one human gate (scope question 6). Then type `deployed` and press Enter. Any other line is ignored, so an Enter typed earlier in the run cannot end the pause (Decision 33).
     - The driver then looks for op1's restart for up to 90 s, retries the delivery with the same Idempotency-Key, and checks the delivery's events and the buyer's key on both operators.
     - Deploy the code holdback-op1 runs: T-228's `236786a` (`docs/operations.md`). Main since then changed no worker code [inferred from the diffs: site, docs, CI and examples only].
     - The time between the broadcast and op1's answer is about 12 to 25 s on Sepolia, and op1's Durable Object took up to 44 s to restart after T-220's deploy [inferred by the direct group]. If the deploy lands after the receipt, the check "the restart cut the relayed delivery" fails honestly; then rerun 11 alone, the same command with `run 11 --t220`.
     - It uploads at most 2 blobs of 32 bytes to the live ciphertext store per run.
  5. About 20 minutes after the run's last transaction, the finality re-read (public chain data, no secret), for this run's folder and for run B's, which has none yet:

     ```bash
     node /Users/rafa/Documents/escrow/.worktrees/round1-run/examples/e2e-round.ts finality /Users/rafa/Documents/escrow/.worktrees/round1-run/reports/e2e-round-1/<run folder>
     node /Users/rafa/Documents/escrow/.worktrees/round1-run/examples/e2e-round.ts finality /Users/rafa/Documents/escrow/.worktrees/round1-run/reports/e2e-round-1/2026-11-05T193705Z
     ```

  6. Paste `summary.md` or the terminal output to the T-216 session, which writes the report (`docs/reviews/2026-11-04-evm-e2e-round-1.md`).
- **What to watch in the rerun** [inferred].
  - 3b's two bond deposits: adjudicator-2 already holds the 25 tUSDC it minted and its allowance, so it approves and deposits only. A revert now names the contract's error at the round's last block; a stale node cannot cause it.
  - The money lines in `summary.md` now read "this deal moved …". A second "the address changed by …" means another deal of the same party settled in the window: the check still holds.
  - The lines "after the scenario: …" in a record say what the gate did: how long it waited, and any timeout it sent.

  From the group sessions, still open:
  - The drand paths run on a chain for the first time on Sepolia: 4's fallback decision, 5b's and 7's appeal decisions, and 8's third deal. The anvil world names the sim beacon, so those beacon-round and fee checks were written from the contract's code (`HoldbackRules.sol` 287 to 333 and 543 to 551) and the ABI's event names. A wrong field shows as a FAIL, not a false pass.
  - 8, deal 3: the demo fallback sends its own takeover once `judgeBy` passes. If its transaction lands first, the check "triggerFallback is sent directly from the buyer's key" fails and names that transaction.
  - 3b: on anvil, the `fallback` trigger through the API is refused by anvil's `eth_estimateGas` (the backlog row of the driver PR), and the driver then sends `triggerFallback` directly. Sepolia shows whether the API relays it.
- **Product defects found: none.** The four groups, the 3d and 10a diagnosis and the 2026-11-06 diagnosis of the evening runs found driver defects only; PR 210 fixes the first ones (Decisions 29 and 30), and branch `t-216-live-fixes` the last three (Decisions 34 to 37). For Rafa, outside this task's paths:
  - Optional, from the diagnosis: one `paymentState` assert after a mutual settlement in `contracts/test/Settle.t.sol`. The contract is right [measured on Sepolia by the diagnosis: after 10a's settlement CPP reads capturable 0 and refundable 15 tUSDC, a ceiling on what the operator may refund from its own tokens, and HoldbackRules never calls `refund`].
  - `vitest.config.ts`'s cost table could list the new driver test files: on SimChain the silent file takes about 110 s and the scripted file about 60 s [measured by the groups].
  - A row for `docs/team.md` (Rules and checks), since three groups hit the same `stop` defect: "Code that runs in the driver process is tested in the driver process." The check: a helper with unref'd timers gets a test that runs it through `driver()` in a child process, not only inside vitest.
  - The second row, on the stale read after a transaction, is in `docs/team.md` (Rules and checks) since 2026-11-06, added by the live-fixes session as the team process asks once a failure repeats: it came back five times (T-226's lost delivery, 3d and 10a's evidence, PR 210's before reads, then 3b's deposit and the gate after 5a). `docs/team.md` is outside this task's listed paths; Rafa can overrule the row.
  - Inside this lane, not built (no needs line asks for it): `anvilWorld` in `examples/e2e-world.ts` could take the scripted group's reseed (`anvil.fresh(canonicalKeccak({ sim: 'holdback/demo-cloud/v1', start }))`), so the demo fallback and appeal adjudicators decide on anvil and 4, 5b, 6 and 7 run their appeal paths offline.
- **What each scenario built on 2026-11-05 does** (`node /Users/rafa/Documents/escrow/examples/e2e-round.ts list` prints what each waits for):
  - **3b:** the round's silent primary (adjudicator-1) and silent fallback (adjudicator-2, bonded for the price). At `judgeBy` the driver sends `fallback` through the API, or `triggerFallback` from the buyer's key when the API refuses. After `fallbackBy`, `default` ends the deal Defaulted and refunded; on chain `triggerDefault` does both. The seller gets 0 (Phase 4).
  - **3c:** adjudicator-1 rejects by script, the seller appeals, and adjudicator-2, the appeal adjudicator, stays silent. After `appealDecideBy`, `appeal-expiry` leaves the refund standing, returns the seller's appeal bond and frees the primary's bond.
  - **4:** the silent primary with the demo fallback and appeal adjudicators. At `judgeBy` the takeover; the fallback decides with a drand quicknet proof whose round is the round at `judgeBy`.
  - **5a:** a delivery that exhausts the check work budget. The primary escalates with no panel; the appeal adjudicator escalates again and signs nothing; after `appealDecideBy`, `default` and `apply-default` refund the buyer.
  - **5b:** a rubric delivery with soft hyphens trips the screen and the primary escalates. The demo appeal adjudicator's five-seat panel decides with a drand proof, final at once; a later appeal is refused with `invalid_state`.
  - **7:** adjudicator-1 accepts failing work in one deal and rejects passing work in another. The losing party appeals each, and the demo appeal adjudicator overturns: `BondSlashed` pays the appellant the price from the primary's bond, the appeal bond comes back, and no key reaches the refunded buyer.
  - **8:** a deal offered through the API, then funded with `agreeAndFund` and delivered with `deliver` from the parties' own keys; then a deal whose buyer sends `triggerFallback` directly over the silent primary. Each direct step must show on both operators as `submittedVia: 'direct'` with its transaction within 60 s.
  - **9:** the silent primary; the buyer accepts the delivery early; Released with the key; the primary's late decision is refused.
  - **10b:** the silent primary; after delivery both parties sign a `MutualSettlement`, 60 % to the seller with `releaseKey` true; the key reaches the buyer and the bonds are freed.
  - **11:** a restart of holdback-op1 between a relayed broadcast and its receipt (step 4 above).
- **The remaining scenarios (2026-11-05): the foundation and the four groups are built and merged** on branch `t-216-remaining-scenarios` ([PR 210](https://github.com/rafaeldavid/holdback/pull/210) to main). Each group owned two files and touched no other, except the silent group's change to `e2e-round.test.ts` (3b left its "waits" expectation):

  | Group | Scenarios | Scenarios file | Tests file |
  | --- | --- | --- | --- |
  | silent | 3b, 4, 9, 10b | `examples/e2e-scenarios-silent.ts` (`SILENT`) | `examples/e2e-scenarios-silent.test.ts` |
  | scripted | 3c, 7 | `examples/e2e-scenarios-scripted.ts` (`SCRIPTED`) | `examples/e2e-scenarios-scripted.test.ts` |
  | escalation | 5a, 5b | `examples/e2e-scenarios-escalation.ts` (`ESCALATION`) | `examples/e2e-scenarios-escalation.test.ts` |
  | direct | 8, 11 | `examples/e2e-scenarios-direct.ts` (`DIRECT`) | `examples/e2e-scenarios-direct.test.ts` |

  - Replace a `waiting(...)` entry with the built scenario under the same ID; `e2e-scenarios.ts` already registers each list, in scenario order. Import helpers from `e2e-scenario-kit.ts` (the terms and work, `requires`, `expireAppeal`, `appeal`, `appealBond`, `untilAppeal`, `settledChecks`, `cppCheck`, `paidCheck`, `bondFreedCheck`) and the deal steps from `e2e-run.ts`; never import `e2e-scenarios.ts`. A helper that two groups need goes into the kit in its own small commit, to keep merges easy.
  - Test through `examples/e2e-world.ts`: `simWorld()` and `anvilWorld()` (skips without anvil and `forge build` output), `driver(args, env)`, `results(out)` and `expectNoSecrets`, as `e2e-round.test.ts` uses them. Each group's test file holds an `it.todo` per scenario now.
- **The round's own adjudicator, for the group builders** (`examples/e2e-adjudicator.ts`; Decisions 17 to 21):

  ```ts
  import { RoundAdjudicator } from './e2e-adjudicator.ts';
  // Registered through the API, reused when in place; `bond` (base units) is the free bond it must hold, deposited
  // from its own key only when short. Omit `bond` for an appeal adjudicator: nothing pays from it on chain (L-5).
  const primary = await RoundAdjudicator.ready(r, 'adjudicator-1', { bond: BigInt(PRICE) });
  const serving = await primary.serve(r, 'silent'); // or { decide: 'accept' }, { decide: 'reject' }, or (deal) => script
  try {
    const deal = await openDeal(r, { ...spec, adjudicators: { primary: primary.address, fallback, appeal } }, [buyer, seller, primary.address]);
    // silent: it accepted, and never decides. scripted: it decides as told once the deal is Delivered.
  } finally {
    await serving.stop();
  }
  serving.acted; // [{ id, did: 'accepted' }, { id, did: 'decided', outcome }]
  serving.errors; // each failed step, retried on its next pass
  ```

  - **Silent** accepts every deal between the round's buyer and seller that names it primary and was offered after `serve` started, then never decides (Decision 20). **Scripted** accepts, then decides the given outcome as primary as soon as the deal is Delivered, whatever the work: a wrong accept seals the key to the buyer; a wrong reject does not. As fallback or appeal adjudicator it is always silent (those turns need a drand proof), so it needs no `serve` there; it only needs to be registered.
  - The lower-level steps are public too: `accept(r, id, terms)`, `decide(r, id, terms, outcome)`, `terms(id)`, `register(r)`, `bond(r, amount)`.
  - **Bonds.** A primary's bond stays encumbered by the price from funding until its appeal window closes; this adjudicator does not expire its own appeals, so close them (`expireAppeal`) or bond enough for the deals a scenario keeps open. An overturn slashes the price from the primary's bond (scenario 7); the next `ready` deposits the shortfall. A fallback needs free bond of at least the price before the offer, or the relay refuses the terms (T-221). Each adjudicator key holds 0.04 Sepolia ETH from the top-up: a mint, an approval and a deposit cost about 0.0004 Sepolia ETH at 1 gwei [inferred from the 372,709-gas estimate in `e2e-keys.ts`].
  - **On SimChain** no outsider can bond at run time, so `bond` refuses: a scenario that names the round's adjudicator as a bonded primary or fallback runs on anvil and Sepolia only, or prices its SimChain deal at 0, which needs no bond (the adjudicator's own SimChain tests do this).
  - It prints addresses, links and gas, never a key; its bond transactions go into the run's notes.
- **The top-up is done:** all five keys hold 0.04 Sepolia ETH (Evidence). To top up again, Rafa runs it from the holdback checkout, with full paths so it works from any folder: `node --env-file=/Users/rafa/Documents/escrow/.env /Users/rafa/Documents/escrow/examples/e2e-keys.ts topup --dry-run`, then the same without `--dry-run`. The driver can call it before each scenario that needs a key's own gas. It sends nothing while every key holds at least 0.04 Sepolia ETH, and it refuses while a transfer is pending.
- **Live run of scenarios 1 and 2 (Rafa; done on 2026-11-04 and 2026-11-05, kept for its finality step).** In the holdback checkout after the driver's PR merges and `git pull`, with full paths so it works from any folder. The commands print addresses and links, never the secret or a key.
  1. Scenarios 1 and 2 (about 5 minutes and 3 minutes, inferred from the 60 s windows and 12 s blocks):

     ```bash
     node --env-file=/Users/rafa/Documents/escrow/.env /Users/rafa/Documents/escrow/examples/e2e-round.ts run 1 2
     ```

  2. Optional, in the same session: the scenarios that need no prerequisite. 3a takes about 10 minutes: two deals, each waiting 4 minutes for `deliverBy`, and its direct reclaim uses the buyer's own Sepolia ETH.

     ```bash
     node --env-file=/Users/rafa/Documents/escrow/.env /Users/rafa/Documents/escrow/examples/e2e-round.ts run 3a 3d 10a
     ```

  3. About 20 minutes after the last run, the finality re-read of the folder the run printed. It reads only public chain data and needs no secret, so any session can run it:

     ```bash
     node /Users/rafa/Documents/escrow/examples/e2e-round.ts finality /Users/rafa/Documents/escrow/reports/e2e-round-1/<run folder>
     ```

  Each run writes `reports/e2e-round-1/<UTC time>/summary.md` in the checkout and one JSON record per scenario: public data only. Paste the terminal output or `summary.md` to the T-216 session, which records the run as measured in the report (`docs/reviews/2026-11-04-evm-e2e-round-1.md`).
- **Outside this lane:**
  - `vitest.config.ts`'s cost table could list `examples/e2e-round.test.ts` (about 50 s on SimChain, measured locally) for CI's shard balance.
  - No CI job runs the driver's anvil test: the test shards have no anvil, and the contracts job's "anvil tests (must not skip)" step runs only `packages/settlement/evm` and the testkit runner (`.github/workflows/ci.yml`). Adding `examples/e2e-round.test.ts -t anvil` to that step puts the chain checks under CI. Rafa merges `.github/` changes.
  - `.gitleaksignore` gained one line, at the T-216 coordinating session's request: commit `90c69b9` held anvil's public dev key as a literal in the test, which gitleaks flags; the test now derives it from anvil's published mnemonic, and the earlier commit stays in the PR's history without a force push.
  - `.gitleaksignore` gained a second line in PR 210, from its review: commit `7a516d5` holds a made-up address keyed `token` in `examples/e2e-adjudicator.test.ts` line 50, which gitleaks flags as `generic-api-key` (CI run 42052422672 failed on it). It names no contract and guards nothing; the commit stays in the PR's history without a force push.
- **Before the round unbenches PR 151 and T-206's read:** a review by a model from another family of the checks in `examples/e2e-scenarios.ts` against the contracts, and of the wall-time against block-time races on Sepolia (the PR reviewer's recommendation). Rafa runs it.

- When round 1 completes: unbench PR 151 and T-206's read (`docs/backlog.md`, Benched; `docs/log/2026-11-04.md`, Next steps item 3), and tell Rafa.
