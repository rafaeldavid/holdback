# T-216: Full EVM end-to-end test round 1 on Sepolia

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-217 (drand proofs for fallback and appeal), T-218 (direct calls in the operators' view), T-219 (the in-flight row per relayer lane), T-221 (adjudicator registration through the API), and T-220, which ships those four to the live demo in one deploy. Rafa answered all six scope questions on 2026-11-04 (below). The fixed contracts are already live (see Context).
- **Paths this task may touch:** `examples/e2e-*.ts` (new: the round's keys, its driver, and their tests; the `examples` workspace already holds the agent-side code and viem), `docs/reviews/` (one new file, the round's report), `docs/backlog.md` (rows for what the round finds; the Benched rows once it completes), `docs/plan.md` (this row), this file. No product code: a scenario that fails gets its fix in its own task, and the round re-runs it.
- **Human gate:** yes. Rafa confirms the scope (done: the questions below, 2026-11-04) and funds the round's master address with Sepolia ETH (done: 2.5, Evidence); the driver tops up the other keys from it. The runs use the public API as any agent may, and send test transactions on Sepolia from test keys. They deploy nothing, except scenario 11's one holdback-op1 redeploy, which waits for Rafa's go-ahead at that moment.
- **Status:** in progress (the keys and the top-up landed; the driver, `examples/e2e-round.ts`, runs scenarios 1, 2, 3a, 3d and 10a now, and 6 once T-217 is live; it waits for Rafa's live run of 1 and 2; the rest wait for T-220's deploy)
- **Agent/session:** the T-216 planning session (the keys); the T-216 driver session (the driver)

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

## Handoff

- **The top-up is done:** all five keys hold 0.04 Sepolia ETH (Evidence). To top up again, Rafa runs it from the holdback checkout, with full paths so it works from any folder: `node --env-file=/Users/rafa/Documents/escrow/.env /Users/rafa/Documents/escrow/examples/e2e-keys.ts topup --dry-run`, then the same without `--dry-run`. The driver can call it before each scenario that needs a key's own gas. It sends nothing while every key holds at least 0.04 Sepolia ETH, and it refuses while a transfer is pending.
- **Live run of scenarios 1 and 2 (Rafa).** In the holdback checkout after the driver's PR merges and `git pull`, with full paths so it works from any folder. The commands print addresses and links, never the secret or a key.
  1. Scenarios 1 and 2 (about 5 minutes and 3 minutes, inferred from the 60 s windows and 12 s blocks):

     ```bash
     node --env-file=/Users/rafa/Documents/escrow/.env /Users/rafa/Documents/escrow/examples/e2e-round.ts run 1 2
     ```

  2. Optional, in the same session: the scenarios that need no prerequisite. 3a takes about 10 minutes: two deals, each waiting 4 minutes for `deliverBy`, and its direct reclaim uses the buyer's own Sepolia ETH.

     ```bash
     node --env-file=/Users/rafa/Documents/escrow/.env /Users/rafa/Documents/escrow/examples/e2e-round.ts run 3a 3d 10a
     ```

  3. About 20 minutes after the last run, the finality re-read of the folder the run printed:

     ```bash
     node --env-file=/Users/rafa/Documents/escrow/.env /Users/rafa/Documents/escrow/examples/e2e-round.ts finality /Users/rafa/Documents/escrow/reports/e2e-round-1/<run folder>
     ```

  Each run writes `reports/e2e-round-1/<UTC time>/summary.md` in the checkout and one JSON record per scenario: public data only. Paste the terminal output or `summary.md` to the T-216 session, which records the run as measured in the report (`docs/reviews/2026-11-04-evm-e2e-round-1.md`).
- **What each remaining scenario needs.** `node examples/e2e-round.ts list` prints the same.
  - **3b, the default outcome:** the round's own primary and fallback, registered through the API (T-221), accepting and never deciding. Build `examples/e2e-adjudicator.ts`: register per ADR-0030 (copy a demo adjudicator's served record, change the address, key and `policy.id`; bind the demo's registry hash), bond with `RoundChain.depositBond`, accept with a self-built `AdjudicatorAcceptance` (`seedCommitment` = keccak256 of a seed derived from its key and the commitment ID), and decide with a self-built `Decision`. `verify.ts` gains the types with T-221 (its slice 1 adds `TYPES` only, no encoders, so the module encodes timestamps and amounts itself, as core's `typedDataOf` does).
  - **3c, appeal expiry:** that module; the round's primary decides by script, its own appeal adjudicator stays silent, and the appellant approves its bond (`RoundChain.approveBonds`, as scenario 6 does).
  - **4, fallback with a drand proof:** the round's silent primary with demo fallback and appeal adjudicators (T-221's fallback trust rule); check the fallback decision's `beaconRound` in `decide`'s calldata equals the round at `judgeBy` (T-217's `roundAt`).
  - **5a, escalation then default:** a checks-only delivery that exhausts the check work budget on purpose. Not found yet; try candidates on a fork first.
  - **5b, escalation decided on appeal:** a rubric delivery that trips the screen without being an attack fixture (D27c); then T-217's five-seat appeal panel.
  - **6, appeal upheld:** built, and passing on SimChain offline; on any chain it waits for T-217's drand proofs. Its first live run checks the appeal decision's `beaconRound` and the `AppealBondPaid` log to the primary's bond.
  - **7, overturned both ways:** the adjudicator module deciding wrongly by script; check `BondSlashed` pays the appellant the price from the round's primary bond, the appellant's bond comes back, and no key reaches a refunded buyer.
  - **8, the escape hatch:** direct `agreeAndFund` (the acceptance from `adjudicator.accepted`'s payload, the buyer's `Agree` and ERC-3009 `ReceiveWithAuthorization` signatures, encoded as `HoldbackTypes`) and direct `deliver`, then the same signed delivery posted to an operator; a direct `triggerFallback` over the round's silent primary. `RoundChain.send` and `termsTuple` carry the calls; scenario 3a's direct reclaim already runs. Check each step shows on both operators as `submittedVia: 'direct'` with its transaction, within one sync pass (T-218).
  - **9, early accept:** the round's silent primary; `agent.earlyAccept` with the seller's signed delivery; then the primary's late decision is refused.
  - **10b, after delivery:** the round's silent primary, so the settlement lands before a decision; `releaseKey` true, and the key reaches the buyer.
  - **11, a restart mid-step:** the driver pauses after a relayed broadcast and before its receipt, and asks Rafa for the holdback-op1 redeploy at that moment; then the step's events and the buyer's key are served, and the lane telemetry shows no in-flight row left unapplied (T-219).
- **Outside this lane:**
  - `vitest.config.ts`'s cost table could list `examples/e2e-round.test.ts` (about 50 s on SimChain, measured locally) for CI's shard balance.
  - No CI job runs the driver's anvil test: the test shards have no anvil, and the contracts job's "anvil tests (must not skip)" step runs only `packages/settlement/evm` and the testkit runner (`.github/workflows/ci.yml`). Adding `examples/e2e-round.test.ts -t anvil` to that step puts the chain checks under CI. Rafa merges `.github/` changes.
  - `.gitleaksignore` gained one line, at the T-216 coordinating session's request: commit `90c69b9` held anvil's public dev key as a literal in the test, which gitleaks flags; the test now derives it from anvil's published mnemonic, and the earlier commit stays in the PR's history without a force push.
- **Before the round unbenches PR 151 and T-206's read:** a review by a model from another family of the checks in `examples/e2e-scenarios.ts` against the contracts, and of the wall-time against block-time races on Sepolia (the PR reviewer's recommendation). Rafa runs it.

- When round 1 completes: unbench PR 151 and T-206's read (`docs/backlog.md`, Benched; `docs/log/2026-11-04.md`, Next steps item 3), and tell Rafa.
