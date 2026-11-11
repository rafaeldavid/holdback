# ADR-0034: The settlement chain for the mainnet test, and the gate before it

- **Status:** Proposed, 2026-11-11. The order of the chains is Rafa's decision of the same day (section 2). The rest is a recommendation, and Rafa may overrule any line. **Nothing here deploys anything, and hard rule 1 stands until Rafa changes it** (section 5).
- **Date:** 2026-11-11
- **Raised by:** T-351. D4 says of the target chain "revisit on evidence", and ADR-0031 says the on-chain beacon proof "comes back with the choice of chain".
- **Research:** `docs/research/2026-11-11-settlement-chain.md` (the note). Every number below comes from it, with its source and date there.
- **Builds on:** ADR-0001 (neutrality), ADR-0002 (the hold), ADR-0003 (the escrow base), ADR-0004 (chain-agnostic EVM, target Ethereum mainnet), ADR-0018 (the beacon), ADR-0028 (the demo on Sepolia), ADR-0031 (the phase-one contract scope), ADR-0032 (the beacon rounds and their margin); D4, D31, D41, D42, D57, D58, D59.
- **Amends:** nothing. It confirms ADR-0004's target and adds the gate that ADR-0004 and `docs/operations.md` name without listing.
- **Changes (when built, by later tasks, each behind the gate):** a deploy script for the chosen chain, the chain-ID guard, a deployment record, the operators' chain configuration. **No signed type and no file in `spec/schemas/` changes.** This ADR itself changes no code and no deployment record.

Labels: **measured** (a command or a read-only call in T-351's run produced it), **documented** (a published page or a file in this repository says it), **inferred** (reasoning from those), **unverified** (not checked; the reason is in the note).

## Summary

**The mainnet test runs on Ethereum mainnet. Base is the runner-up, and the L2 that follows.** Rafa set the order on 2026-11-11: "Assume Ethereum Mainnet first, we will deploy on L2 after we figure out it works on the primary industry standard." The research finds nothing that blocks Ethereum and agrees with the order for a first test with real money.

**The three facts that decide for Ethereum mainnet:**

1. **No single party can delay a deal there.** Any proposer can include a step, and a block's time cannot fall behind real time. Every faster candidate but one has a single sequencer that can hold a step for 12 to 24 hours [documented].
2. **The fee no longer argues against it.** One deal's three transactions cost about USD 0.21 on 2026-11-11, at a base fee of 0.23 gwei [measured]. The estimate that made D4 doubtful was about USD 18.70.
3. **Everything built, measured and about to be audited runs on Ethereum's rules.** The Sepolia deployment, the operators' relayers and log sync, and the beacon's 29 s margin (ADR-0032) are all sized for 12 s slots. The drand verifier's code returns a real round's value on mainnet [measured].

**What Ethereum costs:** a deal takes 36 s or more of chain time, so the test does not show settlement in seconds. Crow deploys its own copy of the escrow. Mainnet has no date for its next fork, which changes gas and the timing inside a slot.

**The three facts that make Base the runner-up:**

1. **Seconds.** Base makes a block every 200 ms since 2026-11-05 [measured], so three money steps take under 1 s of chain time [inferred].
2. **The audited escrow is already there.** `AuthCaptureEscrow` version 1.1.0 sits at `0xf96815976523E00e65Be8f34cA5e64b4f41EB19c` on Base and Base Sepolia, and its verified source equals the vendored file byte for byte [measured]. The rules contract can operate it as it stands [inferred; not run].
3. **The fee is about USD 0.006 a deal and steady** [measured].

**What Base costs:** one sequencer, run by Coinbase, which can delay a step by up to 12 hours; two halts in June 2026; chain upgrades with no delay; one node client; and block times that ran two hours behind real time after a halt [documented and measured].

**The gate** (section 6) has 34 conditions in six groups. Section 7 says which a capped test needs. **What must be measured first** is in section 8.

## 1. Context

- **Where Crow settles today.** On Ethereum Sepolia, with an open-mint test token, in about a minute a deal (ADR-0028). Hard rule 1 forbids real money and any mainnet chain ID.
- **What is planned.** An external audit of the phase-one contracts (ADR-0031), then the findings' fixes, then one test with a small, capped amount of real money on a mainnet.
- **What D4 left open.** D4 chose Ethereum mainnet on 2026-11-01 "for neutrality and reliability" and said: "If measured gas makes typical deals uneconomic, bring this back with numbers." A second reason came on 2026-11-06, when Rafa named settlement in seconds as the objective, "including finding an EVM blockchain that supports it".
- **What the contracts need from a chain** (ADR-0031):
  - the EIP-2537 precompiles, for the drand verifier;
  - native USDC with ERC-3009;
  - an `AuthCaptureEscrow` and its ERC-3009 collector, deployed by Crow or already there;
  - Multicall3.
  Contract signers (ERC-1271) are checked by Crow's own contract and need nothing from the chain.

## 2. Decision: the chain

### 2.1 The decision on record

Rafa, 2026-11-11, in the coordinating session: **"Assume Ethereum Mainnet first, we will deploy on L2 after we figure out it works on the primary industry standard."** ADR-0032 and D59 record it. This ADR does not reopen it. It checks it against the research, names the L2, and says what would change the answer.

### 2.2 The candidates against the criteria

The note's screen (its section 2) leaves five chains. Thirteen were looked at; section 3 of the note says why each is in or out.

| Criterion | Ethereum | Base | Arbitrum One | OP Mainnet | Monad |
| --- | --- | --- | --- | --- | --- |
| R1 Neutrality: who can delay a step, and how long | No single party | One sequencer; 12 h at most through Ethereum | One sequencer; 24 h at most | One sequencer; 12 h at most | No single party [documented]; validator count unverified |
| R2 Seconds: three money steps | 36 s or more; 45 s measured on Sepolia | Under 1 s of chain time [inferred] | Under 1 s [inferred] | 6 s [inferred] | Under 1 s, final in 600 ms [documented] |
| R3 Fee for one deal, 2026-11-11 | About USD 0.21; USD 2.40 at the month's sampled peak | About USD 0.006 | About USD 0.02 plus a data fee | About USD 0.001 plus a data fee | About USD 0.001 |
| R4 The audited escrow | Crow deploys its own copy | **Deployed, version 1.1.0, source-identical** | Crow deploys | Crow deploys | Crow deploys |
| The drand verifier's code | Passes [measured] | Passes [measured] | Passes [measured]; the precompiles arrived 2026-01-08 | Passes [measured] | Passes [measured] |
| Native USDC with ERC-3009 | Yes | Yes | Yes | Yes | Yes |
| R5 ERC-1271, EIP-7702, ERC-4337 EntryPoint | All present | All present | All present | All present | EIP-7702 with limits; EntryPoint 0.7 present |
| R6 Testnet equals mainnet today | **No:** Sepolia runs the next fork | Yes | Testnet runs ahead at times | Testnet runs ahead at times | Testnet runs ahead at times |
| Node clients | Five | One | Not looked up | Not looked up | Unverified |

### 2.3 The recommendation: Ethereum mainnet for the test

**Chain ID 1, with native USDC at `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`.** The reasons, in the order they weigh for a first test with real money:

1. **The test should carry the fewest residuals that belong to the chain and not to Crow.** A first real-money deal tests Crow's contracts, operators and gate. On Ethereum a failure points at Crow. On an L2 it may point at a sequencer, at an upgrade that landed that week, or at a lag after a halt.
2. **Neutrality holds without a condition.** On a one-sequencer chain a deal is neutral only when each of its windows outlasts the forced-inclusion delay (the note, section 9). On Ethereum it is neutral at any window the beacon rule allows: 37 s for an escalation and 43 s for a fallback (ADR-0032).
3. **The cost reason for leaving is gone, for now.** USD 0.21 a deal is a small share of any deal the test would run. It is not stable: section 4 keeps a fee ceiling in the relayers.
4. **The least new work stands between the audit and the test.** The deploy script, the log sync, the relayer lanes and the beacon margin exist for 12 s slots. An L2 needs its own margin (ADR-0032's gate line BR-7), its own sync cadence and a rehearsal of forced inclusion.

**What this choice gives up, plainly:**

- **Seconds.** A deal on Ethereum takes about 45 s with three steps and at least 24 s with two. No shipped or scheduled fork shortens the 12 s slot [documented]. The objective Rafa set on 2026-11-06 is not met by this test. The L2 that follows meets it.
- **Coinbase's deployment of the escrow.** Ethereum mainnet has none [measured]. Crow deploys the audited source itself, and the deploy must prove what it deployed (gate line MG-13).
- **A testnet that matches.** Sepolia has run the Glamsterdam fork since 2026-10-06 and mainnet has no date for it. Gas and slot timing measured on Sepolia do not carry to mainnet (gate lines MG-6 and MG-17).

### 2.4 The runner-up, and the L2 that follows: Base

**Chain ID 8453, with native USDC at `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.** Among the one-sequencer chains Base ranks first: it alone has the audited escrow deployed, its fee is the lowest measured with a data fee included, and its testnet runs the same rules as its mainnet today.

Base is not used until its own conditions hold (gate line MG-34):

- **The sequencer is named as a control point** in `docs/neutrality.md`, with a `neutrality.*` fixture that completes a deal through Ethereum while the sequencer refuses.
- **The deal's windows outlast 12 hours** when the parties want that protection. Under D31 the operator warns below it and refuses nothing.
- **The beacon's margin on Base is derived and recorded** (ADR-0032, BR-7), with the stated residual that the sequencer, and every sender during a lag, can know an escalation's round.
- **The measurements of section 8 are done on Base Sepolia.** They need a testnet deploy, which hard rule 1 allows and Rafa's go-ahead gates. They can run beside the audit.

### 2.5 How a different weighting changes the answer

| If Rafa weighs | The answer becomes | Why |
| --- | --- | --- |
| Neutrality first, as D4 did, and the least new work before a first real-money deal | **Ethereum mainnet** (this ADR) | Section 2.3 |
| Seconds first: the first real-money deal must itself settle in seconds | **Base** | 200 ms blocks and the escrow in place. The cost is the sequencer residual and the work of section 2.4 before the test, not after it |
| Seconds and no single sequencer, both | **Monad, after its open facts are checked** | It is the only candidate with both: no sequencer and finality in 600 ms. Unverified today: its active validator count, its number of node clients, its incident record; its docs say slashing "is not currently implemented". Crow would deploy its own escrow there and its operators would hold a second gas token |
| The fee at its worst case | **Base** | Ethereum's base fee has no ceiling; the next fork raises the gas of a deal about threefold [measured on Sepolia] |

### 2.6 Not chosen

- **Arbitrum One.** It passes the screen. Against Base it has a longer forced-inclusion delay (24 h), no escrow deployment, and a sequencer that may set a block's time up to 24 hours behind real time [documented]. Its upgrades have an exit window, which Base's lack; that did not outweigh the rest.
- **OP Mainnet.** The same shape as Base with 2 s blocks and no escrow deployment.
- **Polygon PoS and Avalanche C-Chain.** The verifier's code refuses a real round on both [measured]. Either would need the BN254 beacon or no on-chain proof (the note, section 5).
- **ZKsync Era, Linea, Arc, MegaETH, Tempo, Unichain.** Each fails the screen or adds nothing over Base (the note, section 3).

## 3. What the choice changes in the contracts

No source line depends on the chain. The contracts target the EVM with no chain-specific opcode (ADR-0004), use no `block.number` [measured], and never read `msg.sender`. What changes is what the deploy passes in and what it must prove.

| | Ethereum mainnet (the test) | Base (the L2 that follows) |
| --- | --- | --- |
| The escrow and its ERC-3009 collector | **Crow deploys both** from the vendored commit `6b0a5ef` (version 1.1.0), as on Sepolia | **The existing deployment:** escrow `0xf968…b19c`, collector `0x8612…ab88`. The deploy checks their code against recorded hashes and deploys neither |
| **Not** the address in the vendored README | n/a | `0xBdEA…0cff` is version 1.0.0, with the older fee interface. The rules contract must not point at it. The vendored README needs a note; that file is a dependency's, so the note goes in `contracts/README.md` |
| The token (one per deployment, ADR-0031) | USDC `0xA0b8…eB48` | USDC `0x8335…2913` |
| The beacon | Deployed by a creation transaction (the review's G-10). Same source | The same. Its code already answers on Base by read-only call [measured] |
| The beacon's margin (ADR-0032) | 29 s, re-derived on the day for the fork mainnet runs (BR-2) | Not derived yet (BR-7). A fixed margin does not cover a lag after a halt |
| The expiry margin | 86,400 s was chosen for Sepolia and has no lower bound. Mainnet needs a value with a written reason | The same question |
| The pairing's gas cap (250,000 gas) | Two pairs cost 102,900 gas. Holds unless a fork reprices them (G-3) | The same prices today: the verifier's transaction is estimated at 219,232 gas on both chains [measured] |
| The EIP-712 domain | Chain ID 1 and the new rules contract. Signatures do not cross from Sepolia | Chain ID 8453 and its own rules contract. Signatures do not cross between chains |
| What the audit reads | The rules contract and the beacon. The escrow is an audited dependency on either chain; the choice does not change the auditor's scope (the note, section 7) | The same |
| What the deploy must prove | That four contracts carry the audited build's creation code | That two do, and that the escrow at the recorded address is Coinbase's verified one |

**The beacon stays.** ADR-0031 asked that the on-chain proof be revisited with the choice of chain. Every serious candidate has the precompiles, so the choice gives no reason to cut it.

## 4. What the choice changes for the operators

**On Ethereum mainnet:**

- **The guard.** `LIVE_CHAIN_IDS` in `packages/settlement/evm/live.ts` allows Sepolia and anvil only, `packages/core/src/chains.ts` lists 21 mainnet chain IDs that three guards refuse, and `contracts/script/deploy-sepolia.sh` refuses any chain but Sepolia [measured]. The test needs one reviewed switch that admits chain ID 1 and keeps refusing every other mainnet (MG-2).
- **Fees.** The relayers keep a fee ceiling and answer `relay_refused` above it (ADR-0028 item 3). The operator's fee quote must follow the day's base fee, not a fixed figure (MG-7).
- **Timing.** Nothing changes: 12 s slots, a write answers at inclusion, finality after about 15 minutes.
- **Real ETH in the relayer lanes,** and keys that are not derived from one secret (MG-23, MG-26).
- **The token.** No faucet and no mint. Admission needs a path that is not the faucet (MG-22).

**On Base, later:**

- **The log sync.** Chunks of 50,000 blocks cover about 7 days of Ethereum and about 2.8 hours of Base. The chunk size and the provider's limits need a new look.
- **The confirmation.** A write that answers at inclusion answers on a 200 ms block from one sequencer. The state read should say which stage a step has reached: included, on Ethereum (about 2 minutes), final (about 20 minutes).
- **A forced-inclusion runbook,** and an alert on a sequencer that has stopped.
- **An advisory warning** when a window is shorter than the forced-inclusion delay (D31: a warning, never a refusal).
- **RPC.** Base's public endpoint is "not suitable for production apps" and lost its `debug` and `trace` namespaces on 2026-10-08. A keyed provider comes first, as on Sepolia.

## 5. Hard rule 1: it stands, and what Rafa would change

**The rule today** (`CLAUDE.md`, Hard rules): "**No real money.** Run only on the in-process SimChain, a local chain or a testnet. Refuse to start with a Stripe key that is not `sk_test_…` or with a mainnet chain ID."

**It stands.** This ADR does not change it, weaken it or schedule its change. No agent may deploy to a mainnet, send a mainnet transaction, or edit the rule, whatever state the gate is in. A gate with every line passed is evidence for Rafa, not permission.

**What exactly Rafa would be changing, when he decides to:**

1. **The sentence in `CLAUDE.md`.** It is a control file that only Rafa edits. A change that fits this ADR names one chain ID, one token, a cap per deal and in total, and the condition that ends the exception. Everything else stays forbidden.
2. **Its row in `docs/team.md`** (Rules and checks), which pairs the rule with its check: "Startup guard rejecting non-`sk_test_` Stripe keys and mainnet chain IDs".
3. **The guards in code** (MG-2), by a reviewed pull request that follows his edit and never precedes it.
4. **The gate in `docs/operations.md`:** "A mainnet deploy also needs an audit and his written approval." The approval is per deploy.
5. **The money itself.** Real ETH for gas and real USDC for the deal come from keys Rafa holds. No agent holds or moves them.

## 6. The mainnet gate

Each line is a condition that must hold before any mainnet deploy, with who checks it and how. **Inputs:** the thirteen conditions of the pilot plan (kept privately, `docs/private-materials.md`; "plan 1" to "plan 13" below), the drand verifier review's lines G-1 to G-10, and ADR-0032's lines BR-1 to BR-10. The last column says what a capped test needs: **yes**, **reduced** (a smaller form is enough, named in the line), **Rafa's call**, or **n/a**.

Roles: **Rafa**; **the builder** (the session that builds the change); **a reviewer** and **a red team** (the `reviewer` and `red-teamer` subagents, with the project's context and without the builder's conclusions); **the auditor** (the external audit firm); **the deployer** (the session that prepares the deploy for Rafa to run or approve).

### A. The rule and the switch

| # | Condition | Who checks, and how | From | Capped test |
| --- | --- | --- | --- | --- |
| MG-1 | Rafa has changed hard rule 1 in his own words. The new text names the chain ID, the token, the cap and what ends the exception | Rafa: his commit to `CLAUDE.md`, and the matching row in `docs/team.md` | plan 1 | yes |
| MG-2 | One reviewed switch admits the chosen chain ID and nothing else. Every other mainnet chain ID still refuses to start, in the EVM adapter, SimChain, the operator and the deploy script | The builder writes it after MG-1. A reviewer and a red team read the diff. Test: each of the other 20 listed mainnet chain IDs is refused, and an unlisted chain ID is refused by the allowlist | plan 2 | yes |
| MG-3 | The cap holds where Crow controls it. The reference operators refuse to relay a funding above the cap per deal, or past the cap in total, on the mainnet deployment. The docs say that the contract itself is permissionless and has no cap | The builder. A reviewer checks the test: a funding one base unit above the cap gets `relay_refused`. It is an operator's relay policy, not a protocol rule (D31) | new | yes |
| MG-4 | Rafa has approved this deploy in writing | Rafa, per deploy (`docs/operations.md`, Gates) | operations | yes |

### B. The chain

| # | Condition | Who checks, and how | From | Capped test |
| --- | --- | --- | --- | --- |
| MG-5 | The chain is decided: this ADR is Accepted, or Rafa has named another chain | Rafa | plan 3 | yes |
| MG-6 | The fork mainnet runs on the deploy day is the fork every gas and timing figure was measured under. No fork is scheduled inside the test's window | The deployer reads EIP-7773's activation table and the Ethereum Foundation's blog on the day, and `eth_config` on a mainnet node. If the fork moved: redo MG-17 and BR-2 | G-2, G-3, BR-2 | yes |
| MG-7 | The operator's fee quote follows the day's base fee, and the relayers refuse above a stated ceiling | The builder. Test: a base fee above the ceiling gets `relay_refused`, and the signed message stays valid elsewhere | ADR-0028 item 3 | reduced: a ceiling and a manual quote |
| MG-8 | The test deal's windows are at or above the chain's floors: 37 s for an escalation and 43 s for a fallback on Ethereum (ADR-0032). On a one-sequencer chain, above the forced-inclusion delay | The session that writes the test's terms. The operator's prepare route shows no warning | BR-5 | yes |

### C. The contracts

| # | Condition | Who checks, and how | From | Capped test |
| --- | --- | --- | --- | --- |
| MG-9 | The audit is closed: no open Critical or High finding, every Medium fixed or accepted by Rafa in writing, and the auditor's review of the fixes is done | Rafa, against the auditor's final report | plan 4 | yes |
| MG-10 | The deployed commit is the commit the auditor's fix review names. `contracts/src`, `lib` and the build config equal it | The deploy script refuses a build input that differs from the commit. A reviewer compares the record's commit with the report's | plan 5 | yes |
| MG-11 | The phase-one scope is in that commit: no party appeals and no bonds, so the two findings that block mainnet (L-3 and L-5 in `docs/audit/known-issues.md`) have no code left; one token; ERC-3009 funding only; the payout and payment addresses | A reviewer, against ADR-0031 and ADR-0033 | plan 5 | yes |
| MG-12 | The token is native USDC. The rules contract's token equals the address Circle publishes for the chain. The deploy script cannot deploy the open-mint test token on a mainnet chain ID | The deploy script reads the token's symbol, decimals and EIP-712 domain on chain. A red team tries to make the script deploy `TestUSDC` | plan 6 | yes |
| MG-13 | The escrow is proven. On Ethereum: Crow's deploy of `AuthCaptureEscrow` and the ERC-3009 collector carries the audited build's creation code, and the record holds the code hashes. On Base: the escrow at `0xf968…b19c` and the collector at `0x8612…ab88` match the recorded code hashes, and the collector names that escrow | The deploy script, and its `--check` afterwards | ADR-0003 | yes |
| MG-14 | What a blocked address does is stated and tested. A capture to a payee the issuer has blocked reverts. The docs say how such a deal ends | The builder: a fork test with a blocked payee and a blocked payer. Issuer risk stays out of scope as a finding | review I-7 | reduced: the statement |
| MG-15 | The expiry margin has a value chosen for the chain, with a written reason and a lower bound | The builder proposes; a reviewer checks the reason against the escrow's reclaim rule | review I-6 | yes |
| MG-16 | The beacon's vectors give the same result and the same gas on every execution client with mainnet stake: Geth, Nethermind, Besu, Erigon and Reth. The vectors: seven real rounds, the refusals, and nine points outside G1 | The builder, by read-only calls with a state override to a node of each client. T-351 did this for one valid proof on one node | G-1 | yes; it is read-only |
| MG-17 | `beaconValue` and a `decide` with the proof are re-measured under the fork mainnet runs, on a mainnet fork | The builder. T-351's first figure: 219,232 gas for one `beaconValue` transaction | G-2 | yes |
| MG-18 | No fork active or scheduled on the chain prices two pairs of the pairing check above 250,000 gas, and the precompiles sit at `0x0b`, `0x0f` and `0x10` at Ethereum's prices | The deployer, on the day, from the fork's EIP list | G-3, G-8 | yes |
| MG-19 | Each refusal has been mined once on a public testnet: status 0 and the predicted gas | The builder prepares; Rafa approves the transactions | G-4 | yes |
| MG-20 | The round rule of ADR-0032 is in the commit and its checks pass: the tests (BR-4); the margin read back from the deployed contract (BR-1); the phase on 100 mainnet headers (BR-3); the runs of three slots measured, and accepted by Rafa (BR-6); the adjudicator's escalation rule (BR-8); the docs (BR-5, BR-9); one fallback and one escalation settled on Sepolia (BR-10) | Each as ADR-0032 section 9 says | G-9, BR-1 to BR-10 | yes; BR-6 is Rafa's call |
| MG-21 | The deploy is deterministic and its source is verified. The script refuses every chain ID but the chosen one, is rehearsed on a fork of that chain, deploys the beacon by a creation transaction, and its `--check` passes after the deploy. Etherscan and Sourcify show the source. The record is committed | The deployer; a reviewer runs `--check` from a clean checkout | plan 13, G-5, G-10 | yes |
| MG-22 | The deployer key holds gas only and has no power after the deploy. It is a hardware key, or a keystore whose use on mainnet Rafa has approved: the keystore exception was written for testnets | Rafa | T-206 | yes |

### D. The operators

| # | Condition | Who checks, and how | From | Capped test |
| --- | --- | --- | --- | --- |
| MG-23 | A party gets a mandate without the faucet | The builder; a reviewer | plan 7 | reduced: a documented, manual issuance to the test's named parties |
| MG-24 | The relayers' and the adjudicators' keys do not come from one secret in one place. Rafa has decided who holds each | Rafa decides. A reviewer checks that no relayer key can sign a decision and no adjudicator key holds funds | plan 8 | reduced: separate secrets, and the decision written down |
| MG-25 | Who plays each role is recorded and published with the test: buyer, seller, operators, and each of the three adjudicators | Rafa | plan 10 | Rafa's call. The record is needed either way |
| MG-26 | The relayer lanes hold real ETH for gas, with a floor that alerts and a ceiling on what one lane holds | Rafa funds. The builder sets the alerts | ADR-0028 item 3 | yes |
| MG-27 | The operators' view follows a step sent straight to the contract and a step from a contract wallet (T-227). Or the test's parties use plain keys, and the docs say what a direct step does to the operators' view | The builder; a reviewer | residual 13 | reduced: the second form |
| MG-28 | The `neutrality.*` fixtures that `docs/neutrality.md` marks as planned are built and pass on the EVM adapter. One deal on the testnet completes with every operator stopped | A red team designs them; the `verifier` runs them | plan 11 | yes |
| MG-29 | The service checks a proof locally before it signs or relays a decision | A reviewer: the test exists and passes | G-6 | yes |
| MG-30 | Alerts and a runbook exist: a lane low on gas, a deal near a deadline with no step, an RPC or a drand relay that fails. The runbook says who is on call, that stopping the relayers is the only switch, and how a party settles without them | The builder; Rafa names who is on call | plan 13 | reduced: the three alerts, with Rafa on call |
| MG-31 | The operators read the chain through a keyed provider with a second one behind it | The builder | ADR-0028 item 10 | yes |

### E. Outside the code

| # | Condition | Who checks, and how | From | Capped test |
| --- | --- | --- | --- | --- |
| MG-32 | Legal advice on a real-money test is on record, or Rafa has decided in writing to run a capped test without it | Rafa | plan 12 | Rafa's call |
| MG-33 | The site and the agent docs say what the mainnet deployment is: a test, its cap, the audit's state, who runs the adjudicators, that the issuer can block an address, and the trust placed in drand (a threshold of its nodes can predict a round; its network can stop; its key is a constant) | A reviewer checks the text. Publishing it is Rafa's | G-7 | yes |
| n/a | Bonds in real money | Phase one has no bonds (ADR-0031, SC-7). The condition returns with them | plan 9 | n/a |

### F. For any chain other than Ethereum mainnet

| # | Condition | Who checks, and how | From | Capped test |
| --- | --- | --- | --- | --- |
| MG-34 | The chain's own facts are recorded before a deploy there. The sequencer is a named control point in `docs/neutrality.md`, with a fixture. The forced-inclusion path is rehearsed on the testnet. The beacon's margin is derived, with how far a block's time can lag. The testnet runs the mainnet's fork on the day. Lines MG-6, MG-13, MG-16 to MG-18 and MG-21 are redone for that chain | As section 2.4 and ADR-0032's BR-7 say | BR-7 | n/a for the Ethereum test |

**After the deploy and before the capped deal:** `--check` passes from a clean checkout; the beacon answers round 1000 and refuses a point outside G1 and another round's signature (G-5); `BEACON_MARGIN()` reads the recorded value (BR-1); and one deal of the smallest amount the parties choose runs through every step first.

## 7. What a capped test needs

**A capped test is** one deployment on one chain, one token, a ceiling per deal and in total that Rafa sets, parties he names, and an end. The cap bounds what Crow and Rafa can lose. It does not bound a stranger: the contract is permissionless and has no owner, so anyone may use the deployment with their own money once it exists. MG-3 and MG-33 are how the test says so.

**Recommended:**

- **Needed in full (25):** MG-1 to MG-6, MG-8 to MG-13, MG-15 to MG-22, MG-26, MG-28, MG-29, MG-31 and MG-33. Without them the deal cannot run, or a failure could cost more than the cap, or nobody could tell what was deployed.
- **Needed in a reduced form (6):** MG-7, MG-14, MG-23, MG-24, MG-27 and MG-30. The reduced form is in each line. The full form is owed before any use beyond the test.
- **Rafa's call (2):** MG-25, how independent the roles are, and MG-32, legal advice. Each has a record to make either way.
- **Not applicable (2):** bonds, and MG-34 while the test runs on Ethereum.

The pilot plan held that six of its thirteen conditions are needed for any mainnet deal to run at all. This list agrees and adds what makes a small loss stay small: the cap in the relayers, the proven escrow, the fork check on the day, and the beacon's lines.

## 8. Before the choice is final

The note's section 12 lists fourteen measurements. Three decide whether this ADR's two picks stand:

1. **For Ethereum:** gas for each step under the fork mainnet runs on the day (MG-17). If the next fork lands first, a deal's gas roughly triples, and the fee comparison is redone.
2. **For Base:** a timed deal on Base Sepolia through Coinbase's escrow. It turns "under 1 s of chain time" and "the rules contract can operate it" from inferred to measured. It needs a testnet deploy, so it waits for Rafa.
3. **For Base:** how far a block's time lags real time after a halt, and for how long (BR-7).

## 9. Litmus tests

1. **Neutrality (ADR-0001).** On Ethereum mainnet the choice adds no actor: block proposers were already the chain's only gate, and any of them can include a step. The gate keeps the planned fixtures as a condition (MG-28). On Base the sequencer becomes a named actor that can delay a step by up to 12 hours and cannot move funds or stop a step for good; it enters `docs/neutrality.md` with a fixture before Base is used (MG-34).
2. **The hold (ADR-0002).** Unchanged. On Ethereum the money sits in Crow's deploy of the audited escrow; on Base in Coinbase's deploy of the same source. Neither has an owner. The cap bounds the amount, and MG-13 proves which code holds it.
3. **Defended judgment (ADR-0006).** Unchanged on Ethereum: the on-chain proof stays and ADR-0032's margin applies. On an L2 the margin protects against every sender but the sequencer, and against nobody during a lag after a halt; that is stated, not hidden (section 2.4).

## 10. Alternatives considered

| Option | Why not |
| --- | --- |
| Base for the test, Ethereum later | It shows seconds in the first real-money deal. It puts the sequencer residual, a new margin, a new sync cadence and a forced-inclusion rehearsal before the test, and it reverses the order Rafa set. Section 2.5 says when it becomes the answer |
| Both chains at once | Two deployments, two gates and two audits of what was deployed, for one test |
| Monad for the test | The only candidate with no sequencer and sub-second finality. Too much is unverified today (section 2.5) |
| Decide the chain after the audit | The beacon's margin, the deploy script and the guard all depend on the chain, and each is in the audited commit or beside it |
| Cut the on-chain beacon proof to widen the choice of chain | Every serious candidate has the precompiles. The cut would buy only Polygon PoS and Avalanche C-Chain |
| Write the gate later | A gate written after the audit is written under pressure to ship. `docs/operations.md` names the gate today and lists none of it |

## 11. The reviewer's check and the red-team pass

Filled in before this ADR merges: one `reviewer` checks ten of the note's facts against their sources, and one `red-teamer` attacks the recommendation.

## 12. Not verified

- **Any deal on any chain but the local EVM and Sepolia.** Every time and fee for Base, Arbitrum One, OP Mainnet and Monad is documented or inferred from measured block times and prices.
- **That the rules contract operates Coinbase's escrow.** Inferred from the source and the wiring; no run.
- **The forced-inclusion path with Crow's steps.** Inferred from the contracts never reading `msg.sender`; not rehearsed. The deposit function's name was not checked against the contract's source.
- **What Base's upgrade keys and node maintainers could do to balances on Base.**
- **Monad's validator count, client count and incident record.**
- **Ethereum's fee beyond five sampled windows of 3.4 hours** in the 30 days before 2026-11-11.
- **The pilot plan's thirteen conditions** were read from the private plan and are restated here in engineering terms; this ADR does not reproduce its reasoning.
