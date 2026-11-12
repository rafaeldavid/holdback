# ADR-0034: The mainnet test on Ethereum mainnet: what it requires and costs, the gate before it, and the L2 that follows

- **Status:** Proposed, 2026-11-11. **It does not decide which chain comes first: Rafa decided that** (section 2). It records what his decision requires and costs, writes the gate, and recommends an L2 for the later step. Rafa may overrule any line. **Nothing here deploys anything, and hard rule 1 stands until Rafa changes it** (section 6). Merging this file records a proposal. Only Rafa's own commit or pull-request approval accepts it or settles one of its open points (section 8).
- **Date:** 2026-11-11
- **Raised by:** T-351. D4 says of the target chain "revisit on evidence", and ADR-0031 says the on-chain beacon proof "comes back with the choice of chain".
- **Research:** `docs/research/2026-11-11-settlement-chain.md` (the note). The chains' facts and prices below come from it; it holds each source and date in full. Figures from this repository's own files (ADR-0032's 29 s, 37 s and 43 s; the review's gas figures; the guards' chain IDs) are cited where they appear.
- **Builds on:** ADR-0001 (neutrality), ADR-0002 (the hold), ADR-0003 (the escrow base), ADR-0004 (chain-agnostic EVM, target Ethereum mainnet), ADR-0018 (the beacon), ADR-0028 (the demo on Sepolia), ADR-0031 (the phase-one contract scope), ADR-0032 (the beacon rounds and their margin); D4, D31, D41, D42, D57, D58, D59.
- **Amends:** nothing. It confirms ADR-0004's target and lists the gate that ADR-0004 and `docs/operations.md` name without listing.
- **Changes (when built, by later tasks, each behind the gate):** a deploy script for Ethereum mainnet, the chain-ID guard, a deployment record, the operators' chain configuration. **No signed type and no file in `spec/schemas/` changes.** This ADR itself changes no code and no deployment record.

Labels: **measured** (a command or a read-only call in T-351's run on 2026-11-11 produced it), **documented** (a published page or a file in this repository says it; fetched 2026-11-11), **inferred** (reasoning from those), **unverified** (not checked; the reason is in the note).

## Summary

**The mainnet test runs on Ethereum mainnet.** Rafa, 2026-11-11: "Assume Ethereum Mainnet first, we will deploy on L2 after we figure out it works on the primary industry standard."

**Nothing on Ethereum mainnet blocks the test** (section 3):

- **The drand verifier works there today.** The EIP-2537 precompiles are live since the Pectra fork of 2025-05-07, and the deployed beacon's code returns a real round's value on mainnet under the Fusaka fork it runs now [measured].
- **One deal's three transactions cost about USD 0.21** at the base fee of 2026-11-11, 0.23 gwei [measured]. The earlier estimate was about USD 18.68 (`docs/plan.md`, at 2026-11-05's prices); section 3.2 says why the two differ.
- **Native USDC has ERC-3009,** and contract signers work.
- **No single party can delay a deal.** Any block proposer can include a step.

**What it costs:**

- **A deal takes about 45 s, not seconds.** Three money steps need three 12 s slots, and no shipped or scheduled fork shortens the slot. Settlement in seconds waits for the L2 step.
- **The escrow is not on Ethereum mainnet yet** [measured at the two published addresses]. One transaction from any account would put Coinbase's exact code there, at the same address as on Base [measured by a read-only replay]. Crow does not need a build of its own.
- **Sepolia is not mainnet.** Sepolia has run the next fork since 2026-10-06; mainnet has no date for it. Gas and slot timing measured on Sepolia do not carry.
- **A public mempool.** A pending accept shows the buyer its key before the payment lands, and a stranger can wrap a copied step so that the operators lose sight of the deal (section 3.6). The gate has a line for each.

**The gate** (section 7) has 39 conditions in six groups, each with who checks it and how. Five came from the red team.

**The L2 that follows: Base is recommended, Arbitrum One is the runner-up** (section 9). Base makes a block every 200 ms and has the audited escrow deployed and in use. That choice stays Rafa's, for later.

**Open points for later** (section 8): the cap, which conditions a capped test needs, the change to hard rule 1, and the L2. Each has a recommendation. None waits on Rafa now: on 2026-11-11 he said "We can deal with this later, as we need to first finalize all the testnet work and align the entire product components to the new contract set."

## 1. Context

- **Where Crow settles today.** On Ethereum Sepolia, with an open-mint test token, in about a minute a deal (ADR-0028). Hard rule 1 forbids real money and any mainnet chain ID.
- **What is planned.** An external audit of the phase-one contracts (ADR-0031), then the fixes, then one test with a small, capped amount of real money on a mainnet.
- **What D4 left open.** D4 chose Ethereum mainnet on 2026-11-01 "for neutrality and reliability" and said: "If measured gas makes typical deals uneconomic, bring this back with numbers." On 2026-11-06 Rafa named settlement in seconds as the objective, "including finding an EVM blockchain that supports it".
- **What the contracts need from a chain** (ADR-0031):
  - the EIP-2537 precompiles, for the drand verifier;
  - native USDC with ERC-3009;
  - an `AuthCaptureEscrow` and its ERC-3009 collector;
  - Multicall3.

## 2. The decision on record

Rafa, 2026-11-11, in the coordinating session: **"Assume Ethereum Mainnet first, we will deploy on L2 after we figure out it works on the primary industry standard."** ADR-0032 and D59 already record it.

So the order is set: Ethereum mainnet (chain ID 1) for the mainnet test, an L2 afterwards. This ADR:

- records what that requires and what it costs (sections 3 to 5);
- writes the gate for Ethereum mainnet (section 7);
- recommends which L2 follows, as a later decision of Rafa's (section 9);
- brings D4's question back with numbers: the gas that D4 feared does not make a deal uneconomic at today's price (section 3.2).

## 3. What Ethereum mainnet requires and costs

### 3.1 A deal's time

| | Fact | Source, date |
| --- | --- | --- |
| Block time | 12 s slots, 32 to an epoch | Documented: ethereum.org, proof-of-stake page, updated 2026-10-07 |
| When an operator can act | At inclusion in a block, one confirmation, as on Sepolia | ADR-0028 item 4 |
| Finality | About 15 minutes: two epochs are 12.8 minutes | Inferred from the slot and epoch; ethereum.org's roadmap says "fifteen minutes" (site updated 2026-11-10) |
| The three money steps (fund, deliver, decide) | 36 s at least: one slot each. **45 s measured** on Sepolia for a direct deal, and 52 to 63 s from the one-command trial | Measured by earlier tasks on 2026-11-06 and 2026-11-05 (ADR-0028 and its research note); Sepolia has the same 12 s slot |
| With the delivery carried inside the decision (two steps) | 24 s at least | Inferred |
| A fork that shortens the slot | None shipped or scheduled. EIP-7782 (6 s slots) is a Draft and is not in the next fork's list | Documented: eips.ethereum.org, EIP-7782 and EIP-7773 |

**How far that is from settling in seconds.** About 45 s against a goal of a few seconds: ten times too slow, and the chain's slot is the whole of the gap. Nothing Crow builds on Ethereum mainnet closes it. **The goal of settling in seconds now waits for the L2 step** (section 9).

### 3.2 The fee for one deal, and the smallest deal that makes sense

**Method.** Gas is measured on the local EVM with `forge test --root contracts --match-contract GasPerDeal --isolate -vv` (2026-11-11, commit `ac2d2b6`, Prague's rules; each call is its own transaction with its base cost). The price is `eth_gasPrice` on mainnet at block 26,394,228 (2026-11-11, 20:59 UTC): 0.2304 gwei, with a priority fee of 11 wei. ETH was USD 2,079.59 (Coinbase spot price API, the same minute). All measured.

| Deal | Gas | At 0.23 gwei (2026-11-11) | At 2.57 gwei (the highest base fee in five sampled windows of the last 30 days) | At 20 gwei (the ceiling above which the demo's relayers refuse, ADR-0028 item 3) |
| --- | --- | --- | --- | --- |
| Three steps: `agreeAndFund` 233,994 gas, `deliver` 83,535 gas, `decide` 130,631 gas | 448,160 gas | **about USD 0.21** | about USD 2.40 | about USD 18.64 |
| Two steps: the decision carries the delivery | 397,777 gas | about USD 0.19 | about USD 2.13 | about USD 16.54 |
| A deal the fallback decides, with the drand proof: four transactions (`agreeAndFund`, `deliver`, `triggerFallback`, `decide`) | 698,528 gas under Prague's rules; about 58,000 gas more under mainnet's [inferred from the verifier review] | about USD 0.36 | about USD 4.05 | about USD 31.48 |

**Against the earlier estimate.** `docs/plan.md` records about USD 18.68 a deal on Ethereum mainnet "at 2026-11-05's prices". Both of its inputs differ from today's. Its gas was Sepolia's, 1,261,428 gas for a median deal, 2.8 times the gas under mainnet's rules. Its gas price works out near 7 gwei [inferred by arithmetic]. This run did not see that price: the highest base fee in its samples is 2.57 gwei. The samples cover 17 of the month's 720 hours, so they do not show that 7 gwei did not occur. Today's USD 0.21 itself errs high: its block's base fee sat above the 90th percentile of its window, and at the window's median, 0.152 gwei, the deal costs about USD 0.14.

**The fee moves.** Over five windows of 1,024 blocks between 2026-10-12 and 2026-11-11 the median base fee ran from 0.13 to 0.23 gwei and the maximum reached 2.57 gwei [measured: `eth_feeHistory`]. Five windows are a sample, not the month. The next fork raises the gas of a deal about threefold: Sepolia, which runs it, takes about 1.26 to 1.64 million gas for the same three transactions [measured by earlier tasks]. At today's price that is about USD 0.60 to USD 0.80 a deal [inferred].

**The smallest deal that makes sense.** The gas is part of the operator fee the buyer pays (ADR-0023). Taking 1% of the price as a fee a buyer would accept for gas:

| Gas price | A deal's gas | The smallest deal at 1% |
| --- | --- | --- |
| Today, 0.23 gwei | USD 0.21 | about USD 20 |
| After the next fork, at today's price | USD 0.60 to USD 0.80 | about USD 60 to USD 80 |
| The sampled peak, 2.57 gwei | USD 2.40 | about USD 240 |
| The relayers' ceiling, 20 gwei | USD 18.64 | about USD 1,860 |

A deal under about USD 5 pays more than 4% of its price in gas today. That is a stated limit of the chain, not a refusal: under D31 the parties choose the amount.

### 3.3 The EIP-2537 precompiles, on mainnet itself

| | Fact | Source, date |
| --- | --- | --- |
| Live since | The Pectra fork, mainnet epoch 364,032, **2025-05-07**. EIP-2537 is Final | Documented: eips.ethereum.org, EIP-7600 and EIP-2537 |
| The fork mainnet runs today | **Fusaka**, since 2025-12-03 21:49:11 UTC. It repriced MODEXP (EIP-7883), which the verifier calls five times | Documented: EIP-7607, EIP-7883 |
| Does the verifier work on mainnet | **Yes.** The deployed beacon's runtime code, passed as a state override to `eth_call` on a mainnet node, returns round 1000's value `0xfe290bec…30e54fdd` | Measured, 2026-11-11, `ethereum-rpc.publicnode.com`. Nothing was deployed |
| Its gas on mainnet | **219,232 gas** for one `beaconValue` transaction | Measured: `eth_estimateGas` with the same override |
| Its gas on Sepolia | 213,185 gas | The verifier review, section 7, 2026-11-11 |
| Why they differ | Sepolia has run the Glamsterdam fork since 2026-10-06. Mainnet has no date: the Hoodi testnet's fork was postponed on 2026-10-22, and on 2026-11-06 the developers decided "to delay the hardfork process" | Documented: EIP-7773's activation table; blog.ethereum.org |
| The pairing's fixed cap | Two pairs cost 102,900 gas against the contract's cap of 250,000 gas. No EIP scheduled for the next fork was found to reprice `0x0b`, `0x0f` or `0x10`; the last part of EIP-8037 was read as a summary only | The verifier review, section 7 |

**What this run did not show:** agreement between mainnet's five execution clients. It called one node. That is the review's gate line G-1, and MG-16 below.

### 3.4 The escrow

- **No audited deployment was found on Ethereum mainnet.** Commerce Payments' README lists deployments on Base and Base Sepolia only [documented: github.com/base/commerce-payments, 2026-11-11]. Its two escrow addresses, `0xf968…b19c` (version 1.1.0) and `0xBdEA…0cff` (version 1.0.0), have no code on Ethereum mainnet [measured: `eth_getCode`]. A deployment at some other address was not searched for [unverified].
- **Coinbase's exact code can sit at the same address on Ethereum mainnet** [measured by the red team and again by T-351, read-only, 2026-11-11].
  - Coinbase created the escrow on Base through the deterministic deployer at `0x4e59b44847b379578588920ca78fbf26c0b4956c`, with a salt of zero (transaction `0x9d3ce23c…dc84a`).
  - That deployer has code on Ethereum mainnet. An `eth_call` to it there with the same input returns `0xf96815976523e00e65be8f34ca5e64b4f41eb19c`, the Base address. `eth_estimateGas` for it reads 2,632,491 gas, about USD 1.26 at 0.23 gwei.
  - The collector was created the same way, with the escrow and Multicall3 as its arguments; both addresses are the same on mainnet [measured by the red team].
  - So one transaction for each contract, from any account, puts byte-identical code at `0xf968…b19c` and `0x8612…ab88` [the runtime match is inferred: the escrow's one immutable is the address of its own first CREATE].
- **Recommended: replay Coinbase's two creation transactions and deploy no build of Crow's.** The escrow that holds the money on Ethereum is then the code that Coinbase verified and other operators use on Base. The build Crow used on Sepolia (200 optimizer runs, the Prague EVM version) has no audit and no production use behind its bytecode, and is not needed. If someone else sends the two transactions first, the result is the same code at the same address; the deploy accepts it.
- **Audits of that source** [documented: the README]: five in March and April 2025, three by Coinbase Protocol Security and two by Spearbit, and a sixth, "Spearbit audit 3, 07/22/2026", for the rounding and billing change of version 1.1.0. The vendored `audits/` folder holds the first five reports; nobody here has read the sixth (MG-13).
- **What it means for the audit's scope.** The auditor reads Crow's rules contract and beacon and treats the escrow as an audited dependency. The deploy proves that by one check: the code at both addresses equals the code on Base, byte for byte.

### 3.5 USDC with ERC-3009, and contract signers

| | Fact | Source, date |
| --- | --- | --- |
| Native USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`; `version()` answers "2" | Documented: Circle's address page; measured on mainnet |
| ERC-3009 | `transferWithAuthorization` since FiatToken 2.0.0 (2020-07-30), `receiveWithAuthorization` since 2.1.0 (2021-02-17) | Documented: circlefin/stablecoin-evm, `CHANGELOG.md` |
| A contract wallet's signature | FiatToken 2.2 (2023-11-09) added "ERC-1271 signature validation support to EIP-2612 and EIP-3009 functions" and takes the signature as `bytes`. The overload exists on mainnet's token: a call to it reverts with "FiatTokenV2: caller must be the payee", where an unknown selector reverts empty. A contract wallet's signature through it is still untested | Documented; measured by the red team, 2026-11-11 |
| Who can freeze it | Circle holds every role: the blacklister "prevents all transfers to or from an address", the pauser stops all transfers, the proxy admin can switch the implementation. Mainnet's blacklister is `0x0a06…78f9` | Documented: `doc/tokendesign.md`; measured. Issuer risk is out of scope as a finding |
| How it differs from the demo's token | The demo's token has no owner, no blocklist, no pause and no proxy, and anyone mints it. Real USDC has all four and its own EIP-712 domain: name "USD Coin", version "2" [measured by the red team]. The Sepolia deploy script expects version "1". A capture that pays a blocked address reverts | ADR-0028 item 6; `deploy-sepolia.sh`; MG-12 and MG-14 |
| ERC-1271 for the deal's own messages | Checked by Crow's rules contract, for every role. It needs nothing from the chain | ADR-0031 section 5 |
| EIP-7702 | Live since Pectra, 2025-05-07 | Documented: EIP-7600 |
| ERC-4337 | EntryPoint 0.7, 0.8 and 0.9 have code on mainnet. So does Multicall3, which the collector uses for a wallet not deployed yet | Measured: `eth_getCode` |
| The limit that is Crow's | The operators check plain-key signatures only and cannot follow a step sent through a contract wallet | Residual 13 in `docs/neutrality.md`; T-227; MG-27 |

### 3.6 Who can delay or censor a settlement

Against the neutrality test (ADR-0001): no single party can stop a valid commitment from settling according to its terms, or move held funds outside those terms.

- **Who orders transactions.** Each slot's proposer, drawn from a validator set anyone can join. "An overwhelming majority" of proposers outsource block building [documented: EIP-7732].
- **What a censor can do.** A proposer or builder can leave a step out of its own block. The next proposer can include it. The delay is counted in 12 s slots, not in hours. Inclusion lists, which would force a builder's hand, are a Draft (EIP-7805) placed after the next fork [documented].
- **What nobody on the chain can do.** Move the held funds, or stop a step for good: every step carries a party's or an adjudicator's signature, and the contract gives the sender no role.
- **No sequencer and no upgrade key.** A fork needs the client teams and the validators. Mainnet runs five execution clients; shares on ethereum.org are Geth 41%, Nethermind 38%, Besu 16%, Erigon 3% and Reth 2% (data of 2025-10-26) [documented].
- **Block time against real time.** A block carries its slot's time, and a missed slot does not shift later ones. So the beacon's margin is a fixed number, 29 s (ADR-0032).
- **What stays possible.** A validator operator that proposes three slots in a row, in collusion with a party, can learn an escalation's panel seed first (ADR-0032 section 6, accepted there for phase one; gate line BR-6).
- **The public mempool.** A signed step is public before it lands, and anyone can copy and relay it. That is the design: the contract checks signatures and ignores the sender. Three cases carry a cost:
  - **A pending accept shows the buyer its key before the payment lands.** Every accept carries the buyer's sealed key in its calldata (`HoldbackRules.sol:350`), and an accept that lands after its deadline reverts. A late panel, a missed slot, or a fee above the relayers' ceiling is enough; no attacker is needed. The buyer then holds the key, and a reclaim or a default returns its money. The loss is one deal's work. The key-with-payment rule holds for mined calls only [inferred by the red team from the source; not run]. Gate line MG-35.
  - **A stranger can wrap a copied step** in a contract that transforms its calldata. The operators' view then falls behind the chain, their adjudicators stop acting on that deal, and it ends by its timeouts (residual 13 in `docs/neutrality.md`; `docs/operations.md`, the residual's decision of 2026-11-05). It costs the stranger one transaction. Plain keys for the parties do not prevent it. Gate line MG-27.
  - **A watcher can copy the funding leg** ahead of the operator's fee transfer (ADR-0028 item 11; known and bounded).
  - A pending decision is also public to the other party before it lands. A party that has signed a settlement offer should let it expire before the decision is due; that is its own check (D32).

**Verdict: Ethereum mainnet passes the neutrality test when each of a deal's windows outlasts the slots one party can hold.** The delay any one party can cause is counted in 12 s slots, not in hours, and no party can cause it for every block. At ADR-0032's floor of 37 s the adjudicator has 5 to 6 s between the round and the one block that can carry its decision, so one proposer then chooses between a decision and a default; a deal that wants more room sets longer windows (MG-8). That is the property D4 chose the chain for.

## 4. What it changes in the contracts

No source line depends on the chain. The contracts target the EVM with no chain-specific opcode (ADR-0004) and use no `block.number`, and the rules contract never reads `msg.sender` [measured: `grep` of `contracts/src`]. What changes is what the deploy passes in and what it must prove.

| | On Ethereum mainnet |
| --- | --- |
| The escrow and its ERC-3009 collector | Coinbase's two creation transactions replayed, giving the same code at the same addresses as on Base (section 3.4). No build of Crow's |
| The token (one per deployment, ADR-0031) | USDC `0xA0b8…eB48`. The open-mint test token must not deploy there |
| The beacon | The same source, deployed by a creation transaction (the review's G-10). **The on-chain proof stays:** ADR-0031 left it to the choice of chain, and the chain has the precompiles |
| The beacon's margin (ADR-0032) | 29 s, re-derived on the deploy day for the fork mainnet then runs (BR-2) |
| The expiry margin | 86,400 s was chosen for Sepolia and has no lower bound. Mainnet needs a value with a written reason |
| The EIP-712 domain | Chain ID 1 and the new rules contract. No signature crosses from Sepolia |
| What the deploy must prove | That the escrow's and the collector's code equal Base's, that the rules contract and the beacon carry the audited build's creation code, that the token is Circle's, and that the beacon answers and refuses as on Sepolia |

## 5. What it changes for the operators

- **The guard.** `LIVE_CHAIN_IDS` in `packages/settlement/evm/live.ts` allows Sepolia and anvil only. `packages/core/src/chains.ts` lists 21 mainnet chain IDs that three guards refuse. `contracts/script/deploy-sepolia.sh` refuses any chain but Sepolia [measured]. The test needs one reviewed switch that admits chain ID 1 and keeps refusing every other mainnet (MG-2).
- **Fees.** The relayers keep a fee ceiling and answer `relay_refused` above it (ADR-0028 item 3). The operator's fee quote must follow the day's base fee; the demo's is a fixed figure (MG-7).
- **Timing.** Nothing changes: 12 s slots, a write answers at inclusion, finality after about 15 minutes.
- **Real ETH in the relayer lanes,** and keys that do not come from one secret (MG-24, MG-26).
- **The token.** No faucet and no mint. A party needs a mandate by a path that is not the faucet (MG-23).
- **RPC.** A keyed provider with a second behind it (MG-31). In T-351's run one public endpoint refused fee history older than about a day and another refused batches of more than 3 requests.

## 6. Hard rule 1: it stands, and what Rafa would change

**The rule today** (`CLAUDE.md`, Hard rules): "**No real money.** Run only on the in-process SimChain, a local chain or a testnet. Refuse to start with a Stripe key that is not `sk_test_…` or with a mainnet chain ID."

**It stands.** This ADR does not change it, weaken it or schedule its change. A gate with every line passed is evidence for Rafa, not permission.

**What that means for a development session** (a Claude session, a subagent, or any automated job in this repository), whatever state the gate is in:

- It does not create, read or load a key meant for a mainnet.
- It does not deploy a contract to a mainnet, deploy a service configured for a mainnet, or send any transaction to a mainnet.
- It does not edit the rule, its row in `docs/team.md`, or the guards ahead of Rafa's own edit.
- **It may,** today and before any change: make read-only calls to a mainnet node, as T-351 did; and run a local fork of a mainnet with throwaway keys that hold nothing on any real chain. A signature made on a fork of chain ID 1 is valid on chain ID 1, so no key that is funded, or that will ever deploy or sign on mainnet, may be used on a fork.

The services that run the test (the operators' relayers and the adjudicators) will send mainnet transactions once Rafa starts them with keys he created. They are not development sessions, and gate line MG-39 keeps the two apart.

**What exactly Rafa would be changing, when he decides to:**

1. **The sentence in `CLAUDE.md`.** It is a control file that only Rafa edits.
2. **Its row in `docs/team.md`** (Rules and checks), which pairs the rule with its check: "Startup guard rejecting non-`sk_test_` Stripe keys and mainnet chain IDs".
3. **The guards in code** (MG-2), by a reviewed pull request that follows his edit and never precedes it.
4. **The gate in `docs/operations.md`:** "A mainnet deploy also needs an audit and his written approval." The approval is per deploy.
5. **The money itself.** Real ETH for gas and real USDC for the deal come from keys Rafa holds. No development session holds or moves them.

**"In writing"** in the gate means a commit or a pull-request approval from Rafa's own account that names what it approves: the commit, the chain ID and the deployer's address. A decision relayed by a session is recorded as relayed, as this ADR records the order of the chains, and is not such an approval.

The wording he might use is an open point for later (section 8).

## 7. The mainnet gate

Each line is a condition that must hold before any deploy to Ethereum mainnet, with who checks it and how. **Inputs:** the thirteen conditions of the pilot plan (kept privately, `docs/private-materials.md`; "plan 1" to "plan 13" below), the drand verifier review's lines G-1 to G-10, and ADR-0032's lines BR-1 to BR-10. Every G line and every BR line appears in the "From" column of a row: G-1 to G-10 in MG-6, MG-16 to MG-21, MG-29 and MG-33; BR-1 to BR-10 in MG-6, MG-8, MG-20 and MG-34. Their reasoning stays in the review and in ADR-0032. The last column is this ADR's recommendation for a capped test: **yes**, **reduced** (a smaller form is enough, named in the line), **Rafa's call**, or **n/a**. Which conditions the capped test needs is his to decide later (section 8).

Roles: **Rafa**; **the builder** (the session that builds the change); **a reviewer** and **a red team** (the `reviewer` and `red-teamer` subagents, with the project's context and without the builder's conclusions); **the auditor** (the external audit firm); **the deployer** (the session that prepares the deploy script and its rehearsal, for Rafa to run).

### A. The rule and the switch

| # | Condition | Who checks, and how | From | Capped test |
| --- | --- | --- | --- | --- |
| MG-1 | Rafa has changed hard rule 1 in his own words. The new text names the chain ID, the token, the cap and what ends the exception | Rafa: his commit to `CLAUDE.md`, and the matching row in `docs/team.md` | plan 1 | yes |
| MG-2 | One reviewed switch admits chain ID 1 and nothing else. Every other mainnet chain ID still refuses to start, in the EVM adapter, SimChain, the operator and the deploy script | The builder writes it after MG-1. A reviewer and a red team read the diff. Test: each of the other 20 listed mainnet chain IDs is refused, and an unlisted chain ID is refused by the allowlist | plan 2 | yes |
| MG-3 | The cap holds at every point Crow controls, since the contract has none. (a) The reference operators refuse to relay a funding above the cap per deal or past the cap in total. (b) The reference adjudicators sign no acceptance above the cap per deal, past the total, or with a deadline after the test's end; without their acceptance no deal can be funded, by any sender. (c) The total is read from the contract's state, not from one node's book. (d) The test's wallets hold no more than the total cap. The docs say that the contract itself is permissionless and has no cap | The builder. A reviewer checks the tests: a funding one base unit above the cap gets `relay_refused`; an offer one base unit above it gets no acceptance; two nodes together relay no more than the total. Rafa checks the wallets' balances. It is the reference services' policy, not a protocol rule (D31) | new; red team H-3 | yes |
| MG-4 | Rafa has approved this deploy in writing (section 6 says what that means) | Rafa, per deploy (`docs/operations.md`, Gates) | operations | yes |

### B. The chain

| # | Condition | Who checks, and how | From | Capped test |
| --- | --- | --- | --- | --- |
| MG-5 | The chain is confirmed: this ADR is Accepted, or Rafa has named another chain | Rafa | plan 3 | yes |
| MG-6 | The fork mainnet runs on the deploy day is the fork every gas and timing figure was measured under. No fork is scheduled inside the test's window | The deployer reads EIP-7773's activation table and the Ethereum Foundation's blog on the day, and `eth_config` on a mainnet node. If the fork moved: redo MG-17 and BR-2 | G-2, G-3, BR-2 | yes |
| MG-7 | The operator's fee quote follows the day's base fee, and the relayers refuse above a stated ceiling | The builder. Test: a base fee above the ceiling gets `relay_refused`, and the signed message stays valid elsewhere | ADR-0028 item 3 | reduced: a ceiling and a manual quote |
| MG-8 | The test deal's windows leave room above the chain's floors of 37 s for an escalation and 43 s for a fallback (ADR-0032): each is long enough for the reference adjudicator to decide with a stated number of slots to spare | The session that writes the test's terms states the margin. The operator's prepare route shows no warning | BR-5; red team M-1 | yes |

### C. The contracts

| # | Condition | Who checks, and how | From | Capped test |
| --- | --- | --- | --- | --- |
| MG-9 | The audit is closed: no open Critical or High finding, every Medium fixed or accepted by Rafa in writing, and the auditor's review of the fixes is done | Rafa, against the auditor's final report | plan 4 | yes |
| MG-10 | The deployed commit is the commit the auditor's fix review names. `contracts/src`, `lib` and the build config equal it | The deploy script refuses a build input that differs from the commit. A reviewer compares the record's commit with the report's | plan 5 | yes |
| MG-11 | The phase-one scope is in that commit: no party appeals and no bonds, so the two findings that block mainnet (L-3 and L-5 in `docs/audit/known-issues.md`) have no code left; one token; ERC-3009 funding only; the payout and payment addresses | A reviewer, against ADR-0031 and the addresses' own ADR | plan 5 | yes |
| MG-12 | The token is native USDC. The rules contract's token equals `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`, a constant in the script that a reviewer checked against Circle's page. The deploy script cannot deploy the open-mint test token on a mainnet chain ID, and expects the token's own EIP-712 domain ("USD Coin", version "2") | The deploy script compares the address with the constant; a symbol or a domain alone proves nothing, since any token can report them. The record holds the proxy's implementation address on the fork-test day and on the deploy day. A red team tries to make the script deploy `TestUSDC` | plan 6; red team L-2 | yes |
| MG-13 | The escrow is proven. The code at `0xf968…b19c` and at `0x8612…ab88` on Ethereum mainnet equals the code at those addresses on Base, byte for byte, whoever created it. The collector names that escrow and Multicall3. The sixth audit report, for version 1.1.0, has been read and is vendored with the other five | The deploy script and its `--check`: two `eth_getCode` reads on each chain. A reviewer reads the report | ADR-0003; red team H-4, L-5 | yes |
| MG-14 | What a blocked address does is stated and tested. A capture to a payee the issuer has blocked reverts. The docs say how such a deal ends | The builder: a mainnet-fork test with a blocked payee and a blocked payer. Issuer risk stays out of scope as a finding | review I-7 | reduced: the statement |
| MG-15 | The expiry margin has a value chosen for mainnet, with a written reason and a lower bound | The builder proposes; a reviewer checks the reason against the escrow's reclaim rule | review I-6 | yes |
| MG-16 | The beacon's vectors give the same result and the same gas on every execution client with mainnet stake: Geth, Nethermind, Besu, Erigon and Reth. The vectors: seven real rounds, the refusals, and nine points outside G1 | The builder. The same result: by read-only calls with a state override to a node of each client. The same gas: by a state test run through each client's own EVM binary, since a public node does not show it. T-351 did the first for one valid proof on one node | G-1; red team L-6 | yes; it is read-only |
| MG-17 | `beaconValue` and a `decide` with the proof are re-measured under the fork mainnet runs, on a mainnet fork | The builder. T-351's first figure: 219,232 gas for one `beaconValue` transaction | G-2 | yes |
| MG-18 | No fork active or scheduled on mainnet prices two pairs of the pairing check above 250,000 gas, or changes the price of MODEXP at `0x05` or of the precompiles at `0x0b`, `0x0f` and `0x10` without a re-measure | The deployer, on the day, from the fork's EIP list | G-3, G-8; red team L-6 | yes |
| MG-19 | Each refusal has been mined once on a public testnet: status 0 and the gas predicted for that testnet's fork. On Sepolia that is the next fork's gas, not mainnet's; MG-17 covers mainnet's | The builder prepares; Rafa approves the transactions | G-4; red team L-6 | yes |
| MG-20 | The round rule of ADR-0032 is in the commit and its checks pass: the tests (BR-4); the margin read back from the deployed contract (BR-1); the phase on 100 mainnet headers (BR-3); the runs of three slots measured, and accepted by Rafa (BR-6); the adjudicator's escalation rule (BR-8); the docs (BR-5, BR-9); one fallback and one escalation settled on Sepolia (BR-10) | Each as ADR-0032 section 9 says | G-9, BR-1 to BR-10 | yes; BR-6 is Rafa's call |
| MG-21 | The deploy is deterministic and its source is verified. The script refuses every chain ID but 1, is rehearsed on a mainnet fork, deploys the beacon by a creation transaction, and its `--check` passes after the deploy. Etherscan and Sourcify show the source. The record is committed | The deployer; a reviewer runs `--check` from a clean checkout | plan 13, G-5, G-10 | yes |
| MG-22 | The deployer key holds gas only and has no power after the deploy. It is a hardware key, or a keystore whose use on mainnet Rafa has approved: the keystore exception was written for testnets | Rafa | T-206 | yes |
| MG-37 | Every outcome settles on a local fork of mainnet against real USDC's code: release, refund, reclaim, early accept, mutual settlement, a fallback decision and an escalation, each funded once by a plain key and once by a contract wallet. The fork uses throwaway keys that hold nothing on a real chain (section 6) | The builder; the `verifier` reruns it | the note, section 12 item 3; red team M-6 | yes |

### D. The operators

| # | Condition | Who checks, and how | From | Capped test |
| --- | --- | --- | --- | --- |
| MG-23 | A party gets a mandate without the faucet | The builder; a reviewer | plan 7 | reduced: a documented, manual issuance to the test's named parties |
| MG-24 | The relayers' and the adjudicators' keys do not come from one secret in one place. Rafa has decided who holds each | Rafa decides. A reviewer checks that no relayer key can sign a decision and no adjudicator key holds funds | plan 8 | reduced: separate secrets, and the decision written down |
| MG-25 | Who plays each role is recorded and published with the test: buyer, seller, operators, and each of the three adjudicators | Rafa | plan 10 | Rafa's call. The record is needed either way |
| MG-26 | The relayer lanes hold real ETH for gas, with a floor that alerts and a ceiling on what one lane holds | Rafa funds. The builder sets the alerts | ADR-0028 item 3 | yes |
| MG-27 | A deal's adjudicators keep acting when a stranger wraps a copied step, or a party sends one through a contract wallet. Either the operators' view follows such a step (T-227), or the adjudicators read the deal's state from the chain and not from the operators' book | The builder; a red team wraps a copied step on the testnet | residual 13; red team H-2 | yes. Plain keys for the parties do not prevent it |
| MG-28 | Every `neutrality.*` fixture named in `docs/neutrality.md` is listed with its state: passes on the EVM adapter, or does not apply to phase one with the reason (for example `neutrality.appeal-adjudicator-offline`, a party appeal that ADR-0031 cuts, and `neutrality.onramp-refuses`, which needs a funding service that is not built). None is left planned. Two are added for what a public chain adds: a stranger wraps a copied step, and a step is left out of the blocks before its deadline. One deal on the testnet completes with every operator stopped | A red team designs them; the `verifier` runs them | plan 11; red team M-8 | yes |
| MG-29 | The service checks a proof locally before it signs or relays a decision | A reviewer: the test exists and passes | G-6 | yes |
| MG-30 | Alerts and a runbook exist: a lane low on gas, a deal near a deadline with no step, an RPC or a drand relay that fails. The runbook says who is on call, that stopping the relayers is the only switch, and how a party settles without them | The builder; Rafa names who is on call | plan 13 | reduced: the three alerts, with Rafa on call |
| MG-31 | The operators read the chain through a keyed provider with a second one behind it | The builder | ADR-0028 item 10 | yes |
| MG-35 | An accept does not show the buyer's key and then fail. The reference adjudicator sends an accept only while a stated number of slots remain before its deadline, never as the first carrier of a delivery close to `deliverBy`. The relayer raises the fee of an accept it has already broadcast, past its ceiling if it must. The docs state the residual: a pending or reverted accept shows the key | The builder; a red team holds an accept back on a local chain until its deadline | red team H-1 | yes |
| MG-36 | No verdict moves real money unless a live panel gave it. On the mainnet deployment an adjudicator without a live panel of pinned models from two families escalates or stays silent; it never decides from a scripted judge. The `attack.*` fixtures pass on the EVM adapter with the build that runs the test | The builder: a test with the model keys removed and with the daily call cap reached. A reviewer checks the fixture run | litmus test 3; red team H-6 | yes |
| MG-39 | Development sessions and the test's services are kept apart. Rafa creates the mainnet keys and uploads the mainnet secrets in a shell no session shares. The services for mainnet are a separate deploy target that the routine deploy command cannot reach | Rafa. A reviewer checks that the routine deploy has no path to the mainnet target | section 6; red team H-5 | yes |

### E. Outside the code

| # | Condition | Who checks, and how | From | Capped test |
| --- | --- | --- | --- | --- |
| MG-32 | Legal advice on a real-money test is on record, or Rafa has decided in writing to run a capped test without it | Rafa | plan 12 | Rafa's call |
| MG-33 | The site and the agent docs say what the mainnet deployment is: a test, its cap, the audit's state, who runs the adjudicators, that the issuer can block an address, and the trust placed in drand (a threshold of its nodes can predict a round; its network can stop; its key is a constant) | A reviewer checks the text. Publishing it is Rafa's | G-7 | yes |
| MG-38 | The test has a written end, and a runbook for a defect found during it. At the end the relayers and the adjudicators take no new deal, every open deal reaches an end state, the test's wallets are emptied, a pull request removes the chain ID from the switch, and the site marks the deployment as ended. The contract stays on chain for good and has no owner: the docs say that it is not maintained after the test, and that a later fork may stop its beacon | The builder writes it; Rafa runs it | red team M-7 | yes |
| n/a | Bonds in real money | Phase one has no bonds (ADR-0031, SC-7). The condition returns with them | plan 9 | n/a |

### F. For the L2 step, later

| # | Condition | Who checks, and how | From | Capped test |
| --- | --- | --- | --- | --- |
| MG-34 | Before a deploy to any chain other than Ethereum mainnet, that chain's own facts are recorded. Its sequencer is a named control point in `docs/neutrality.md`, with fixtures: the sequencer refuses a step, and the chain's clock runs ahead of and behind real time. The forced-inclusion path is rehearsed on its testnet. The beacon's margin is derived, with how far a block's time can lag or lead. The operators and the adjudicators take time from the chain, not from their own clock. Its testnet runs its mainnet's fork on the day. Lines MG-6, MG-13, MG-16 to MG-18, MG-21 and MG-37 are redone for that chain | As section 9 and ADR-0032's BR-7 say | BR-7; red team M-2, M-3 | n/a for the Ethereum test |

**After the deploy and before the capped deal:** `--check` passes from a clean checkout; the beacon answers round 1000 and refuses a point outside G1 and another round's signature (G-5); `BEACON_MARGIN()` reads the recorded value (BR-1); and one deal of the smallest amount the parties choose runs through its steps first. One deal covers one outcome; MG-37 is what covers them all.

**How the lines are counted.** 39 numbered conditions: 4 in group A, 4 in B, 15 in C, 12 in D, 3 in E and 1 in F. MG-35 to MG-39 were added after the red-team pass and sit in the group they belong to, out of number order. Some lines hold several checks (MG-3, MG-20, MG-21, MG-34), so the count is of rows, not of checks.

## 8. Open points for later

None of these waits on Rafa now. On 2026-11-11, told of the cap, the conditions and the rule change, he said: **"We can deal with this later, as we need to first finalize all the testnet work and align the entire product components to the new contract set."** Each point carries this ADR's recommendation, so the later decision starts from a draft.

| # | Open point | Recommendation | Why |
| --- | --- | --- | --- |
| O-1 | **The cap** | 100.00 USDC a deal and 500.00 USDC outstanding in total, on one deployment, between parties Rafa names, ending after a set number of deals or on a date. Each relayer lane holds 0.05 ETH at most | At 100.00 USDC the gas is 0.2% of the price today and 2.4% at the month's sampled peak (section 3.2). A total loss is USD 500 plus gas, and only while MG-3 holds in all four parts: the contract has no cap, so the bound is the relayers' and the adjudicators' refusal and the balance of the test's wallets. It does not bound a stranger: the contract has no owner, so anyone may use the deployment with their own money and their own adjudicators once it exists (MG-33) |
| O-2 | **Which conditions a capped test needs** | 31 in full: MG-1 to MG-6, MG-8 to MG-13, MG-15 to MG-22, MG-26 to MG-29, MG-31, MG-33, MG-35 to MG-39. 5 reduced: MG-7, MG-14, MG-23, MG-24, MG-30. 2 Rafa's call: MG-25, MG-32. MG-34 and bonds do not apply | Without the 31 the deal cannot run, or a failure could cost more than the cap, or nobody could tell what was deployed. The reduced forms are owed in full before any use beyond the test. The pilot plan held six of its thirteen conditions needed for any mainnet deal; this list agrees and adds what keeps a small loss small |
| O-3 | **The change to hard rule 1** | Keep the rule and add one exception sentence that names chain ID 1, the USDC address, the cap, and what ends it. Change in this order: `CLAUDE.md`, the row in `docs/team.md`, then the code guard by a reviewed pull request | A narrow exception leaves every other mainnet, token and amount forbidden, and the guard's test can assert exactly that (MG-2) |
| O-4 | **How independent the roles are** (MG-25) | For a capped test, publish who plays each role and require nothing more | The test shows the money path. Independence matters once a stranger's money is at stake |
| O-5 | **Legal advice** (MG-32) | Take advice before real money moves between two different legal persons | A test in which one person funds both sides moves nobody else's money |
| O-6 | **The L2 that follows** | Base; Arbitrum One as the runner-up (section 9) | Section 9 |
| O-7 | **A Base Sepolia deployment, to measure the L2 step** | After the testnet work is aligned to the new contract set, and beside the audit if there is room. It is a testnet deploy: hard rule 1 allows it and Rafa's go-ahead gates it | Three facts about Base are inferred and only a deployment measures them (section 10) |
| O-8 | **Whether the beacon's margin covers two slots** (ADR-0032 section 4: 29 s, with one slot and three slots as its alternatives) | Open, and Rafa's. This ADR takes ADR-0032's 29 s as the value the gate checks (MG-8, MG-20) and adds no view of its own. BR-6's measurement on mainnet is the evidence for it | The margin is an immutable of the deployed contract, so it must be settled before the commit is frozen for the audit |

## 9. The L2 step: Base is recommended, Arbitrum One is the runner-up

The comparison is the note's second half (its sections 3 to 11). This is its conclusion, for the step after the mainnet test works. It stays Rafa's to decide.

### 9.1 The L2s that pass the screen

| | Base | Arbitrum One | OP Mainnet |
| --- | --- | --- | --- |
| Block time | 200 ms since 2026-11-05 [documented and measured] | 250 ms [documented] | 2 s [documented] |
| Three money steps, chain time | Under 1 s [inferred] | Under 1 s [inferred] | 6 s [inferred] |
| Fee for one deal, 2026-11-11 | About USD 0.006, data fee included [measured] | About USD 0.02 plus a data fee [measured price] | About USD 0.001 plus a data fee [measured price] |
| The drand verifier's code | Passes; the precompiles since 2025-05-09 [measured, documented] | Passes; the precompiles since 2026-01-08 [measured, documented] | Passes; since 2025-05-09 [measured, documented] |
| The audited escrow | **Deployed:** version 1.1.0 at `0xf96815976523E00e65Be8f34cA5e64b4f41EB19c`, verified source equal to the vendored file [measured] | None at the published addresses [measured]; the same code can be created there with one transaction [measured by the red team for Arbitrum One] | None at the published addresses [measured]; the deployer it needs has code there [measured by the red team] |
| Native USDC | `0x8335…2913` | `0xaf88…5831` | `0x0b2C…Ff85` |
| Forced inclusion through Ethereum: how long the result can stay unknown | 12 hours at most | 24 hours at most | 12 hours at most |
| Stage (ETHBEAT, formerly L2BEAT) | Stage 1; upgrades with no delay | Stage 1; a delay of about 17 days on upgrades that are not emergencies | Stage 1; upgrades with no delay |
| Block time against real time | Fixed by block number; ran about two hours behind after the halt of 2026-06-25 [measured, inferred] | The sequencer may set it up to 24 hours behind [documented] | Bound to the Ethereum origin block, with a drift of 1,800 s [documented] |
| Testnet equals mainnet today | Yes [documented] | Testnet runs ahead at times | Testnet runs ahead at times |

### 9.2 The recommendation

**Base,** for three facts:

1. **Seconds, as far as the sequencer's word goes.** Base makes five blocks a second, so a deal's three steps are included in under 1 s of chain time [inferred; unmeasured, O-7]. That inclusion is one sequencer's statement until the batch reaches Ethereum, which Base's docs put at about 2 minutes, with a configured maximum of 6 hours (1,800 Ethereum blocks) [documented]. "Settled in seconds" there means included by the sequencer; "settled on Ethereum" takes minutes. A key released in such a block is public even if the block never reaches Ethereum.
2. **The audited escrow is deployed and in use,** at an address other operators use, and its verified source equals the file Crow builds against. The rules contract can operate it as it stands [inferred; not run]. This lead is narrower than it looks: the same code can be put at the same address on any candidate with one transaction each for the escrow and the collector (section 3.4). What Base has that the others lack is the deployment's history, not its code.
3. **The lowest measured fee with its data fee included, and a testnet that runs the mainnet's rules today.**

**What Base costs,** stated before it is used:

- **One sequencer, run by Coinbase.** It cannot move funds or stop a step for good. It can leave a step out, and a party then sends the step through Ethereum.
- **Two clocks decide what that delay costs** [inferred by the red team from Base's derivation specification; not rehearsed].
  - A forced step runs in a block whose time lies between its Ethereum block's time and 1,800 s after it. So it meets a deadline if it reaches Ethereum about half an hour before that deadline.
  - The 12 hours is how long the step's result can stay unknown, in real time.
  - The specification also lets the sequencer stamp blocks up to 1,800 s ahead of the Ethereum block they follow. Deadlines then pass early, and a fallback window under 30 minutes can end before drand publishes its round, which forces a default. Whether the Denim upgrade's fixed timestamps removed that freedom is unverified.
  - So a deal that wants protection from the sequencer sets each window well above 30 minutes, and its parties accept up to 12 hours of not knowing. The windows bound the worst case and do not slow a deal whose parties act.
- **Two halts in June 2026,** of about 116 and 20 minutes [documented]. After the first, block times ran about two hours behind real time. During such a lag every signed expiry and the funding authorization stay valid that much longer in real time, and a service that runs on its own clock fires its timeouts early [inferred]. The services must take time from the chain (MG-34).
- **Upgrades with no delay,** by a 2-of-2 of Coinbase's multisig and a Security Council, and **one node client** [documented]. Base shipped four upgrades between 2026-05-28 and 2026-11-05.
- **The beacon's margin does not bind the sequencer,** and binds nobody while block times lag real time (ADR-0032, residual 3).
- **The buyer's last-resort reclaim on the escrow checks the caller.** A buyer that is a contract cannot force it from Ethereum directly, because a contract's address is changed on the way through the bridge [documented; found by the red team]. The forced-inclusion runbook must say so.

**The runner-up is Arbitrum One.** It is as fast, passes the verifier, and its upgrades leave a window to exit. It has no escrow deployment yet, a 24-hour forced-inclusion delay, and a sequencer that sets block times within wide bounds.

**Not an L2, and not evaluated in full: Monad.** It is the only chain examined with both no sequencer and finality in under a second (600 ms) [documented]. The verifier's code passes there [measured], and the escrow's creation transaction would produce the same address there [measured by the red team]. Rafa's order names an L2, and that word sets Monad aside here, not a finding against it. Its active validator count, its number of node clients and its incident record were not established; the note did not look those up for Arbitrum One or OP Mainnet either. Its docs say slashing "is not currently implemented". If seconds without a sequencer becomes the heaviest criterion, Monad is the chain to evaluate first.

### 9.3 How a different weighting changes the answer

The recommendation follows from the note's ranking criteria (its section 2). Rafa could weigh them differently:

| If the heaviest criterion is | The L2 step goes to | Why |
| --- | --- | --- |
| Seconds, on a deployment of the escrow that others already use | **Base** (the recommendation) | 200 ms blocks and the audited escrow in place |
| A window to leave before a chain upgrade takes effect | **Arbitrum One** | About 17 days on upgrades that are not emergencies; Base and OP Mainnet have none |
| The shortest forced-inclusion delay | **Base or OP Mainnet** | 12 hours against Arbitrum One's 24 |
| No single sequencer at all | **Monad, after a full evaluation;** it is not an L2 | Section 9.2 |
| The fewest changes to the operators | **OP Mainnet** | 2 s blocks sit closest to what the relayers and the log sync do today; it gives up seconds (6 s a deal) |

### 9.4 What would have to change to move to Base

**In the contracts:** no source line. At deploy:

- **The escrow is the existing deployment:** escrow `0xf968…b19c`, collector `0x8612…ab88`. The deploy checks their code hashes and deploys neither. **The address in the vendored README, `0xBdEA…0cff`, is version 1.0.0, with the older fee interface, and must not be used.** `contracts/README.md` should say so, and should also name the vendored project's own agent-instructions file, which lists the same old address as current [found by the red team].
- **The token** is Base's USDC, and the EIP-712 domain names chain ID 8453. No signature crosses between chains.
- **The beacon's margin** is derived for Base (ADR-0032, BR-7). A fixed margin of seconds does not cover a lag of hours after a halt; that is a stated residual.
- **The expiry margin** is chosen for Base.

**For the operators:**

- **The log sync.** Chunks of 50,000 blocks cover about 7 days of Ethereum and about 2.8 hours of Base, which makes 432,000 blocks a day.
- **The confirmation.** A write that answers at inclusion answers on a 200 ms block from one sequencer. The state read should say which stage a step has reached: included, on Ethereum (about 2 minutes as a rule, 6 hours at most), final (about 20 minutes after that).
- **Time from the chain.** The operators' and the adjudicators' alarms and timeouts read the chain's clock, which can lag or lead real time.
- **A forced-inclusion runbook,** an alert on a stopped sequencer, and the sequencer as a named control point in `docs/neutrality.md` with its fixtures.
- **An advisory warning** when a window is too short for a forced step (D31: a warning, never a refusal).
- **RPC.** Base's public endpoint is "not suitable for production apps" and lost its `debug` and `trace` namespaces on 2026-10-08.

## 10. What must be measured before each step

The note's section 12 lists fourteen measurements and says which need a transaction. The ones the two steps turn on:

1. **For the mainnet test:** gas for each step under the fork mainnet runs on the day, on a mainnet fork (MG-17). If the next fork lands first, a deal's gas roughly triples and section 3.2 is redone.
2. **For the mainnet test:** the verifier's vectors on each of mainnet's five clients (MG-16), and funding against real USDC's interface on a mainnet fork (MG-12, MG-14). All read-only.
3. **For the L2 step:** a timed deal on Base Sepolia through Coinbase's escrow. It turns "under 1 s of chain time" and "the rules contract can operate it" from inferred to measured. It needs a testnet deploy (O-7).
4. **For the L2 step:** one signed step forced through Ethereum with the relayers stopped, and how far Base's block times lag real time after a halt (BR-7).

## 11. Litmus tests

1. **Neutrality (ADR-0001).** Ethereum mainnet adds no chain actor: block proposers were already the chain's only gate, and any of them can include a step. Two things do change with real money. The token's issuer becomes a live actor for the first time: the demo's token has no freeze, and one token per deployment (ADR-0031) removes the choice of another. And a public mempool lets a stranger leave the operators behind a deal (MG-27). The gate lists every fixture by name (MG-28). For the L2 step, the sequencer becomes a named actor before the chain is used (MG-34).
2. **The hold (ADR-0002).** The money sits in the audited escrow's code, which has no owner; MG-13 proves which code holds it, and MG-3 bounds the amount. One residual is new on a public chain: a pending accept shows the buyer its key before the payment lands, so a buyer can end up with the key and its money (section 3.6). MG-35 narrows it and the docs state it.
3. **Defended judgment (ADR-0006).** The on-chain proof stays and ADR-0032's margin applies. The gate adds what the rule needs once money is real: no verdict from a scripted judge (MG-36). On an L2 the margin protects against every sender but the sequencer, and against nobody during a lag after a halt; section 9 states it.

## 12. Alternatives considered

| Option | Why not |
| --- | --- |
| Crow's own build of the escrow on Ethereum mainnet, as on Sepolia | Coinbase's exact code can be put at the same address by replaying two creation transactions (section 3.4). A build of Crow's would be bytecode that no audit and no production use covers |
| An L2 for the mainnet test | Rafa set the order (section 2). An L2 would also put a sequencer residual, a new beacon margin, a new sync cadence and a forced-inclusion rehearsal in front of the first real-money deal |
| Wait for a shorter slot on Ethereum | No fork with one is scheduled (section 3.1) |
| Cut the on-chain beacon proof now that the chain is chosen | Ethereum mainnet has the precompiles and the verifier works there. The cut would remove the one on-chain defence of a fallback's panel (ADR-0031 section 9) and save about USD 0.10 a fallback decision |
| Write the gate after the audit | A gate written then is written under pressure to ship. `docs/operations.md` names the gate today and lists none of it |
| Name no L2 until the mainnet test is done | The beacon's margin, the escrow's address and the operators' sync all depend on the L2, and the measurements for it need only a testnet. Naming a lead lets that work start when Rafa says so |

## 13. The reviewer's check and the red-team pass

Both ran on 2026-11-11 as subagents with the project's context. Each re-measured for itself; neither changed a file. The record was reshaped around Rafa's order while they ran, and both re-read it at its later state.

### 13.1 The reviewer: ten facts against their sources

**Nine confirmed, one wrong.** The reviewer chose the facts.

| # | Fact | Verdict |
| --- | --- | --- |
| 1 | 448,160 gas for three steps and 397,777 gas for two | Confirmed by its own `forge` run |
| 2 | A fallback deal "is 562,648 gas" | **Wrong.** The test sends four transactions; the deal is 698,528 gas. Corrected in section 3.2 and in the note |
| 3 | 0.2304 gwei at block 26,394,228, and about USD 0.21 a deal | Confirmed |
| 4 | The fee windows and the 2.57 gwei peak | Confirmed on two endpoints |
| 5 | The verifier's answer on five chains, its refusal on two, and 219,232 gas on Ethereum and Base | Confirmed by its own calls |
| 6 | The 1.1.0 escrow on Base is the audited source | Confirmed: Sourcify's exact match and empty diffs |
| 7 | Upstream's README: two versions, six audits; the vendored README lists the older address | Confirmed |
| 8 | Base's 200 ms blocks since 2026-11-05, and its fee | Confirmed |
| 9 | Base's halts and the lagging block times | Confirmed; the post-mortem gives 116 minutes and times 124 minutes apart, now stated |
| 10 | Base's sequencer, its forced-inclusion delay and its stage | Confirmed |

It also found eleven smaller errors. Each is fixed:

- the earlier fee estimate now carries its source and date, and both inputs that differ (section 3.2);
- two labels and one quote are corrected;
- mainnet USDC's `version()` is in the note;
- "the rules contract's entry points" replaces "Crow's entry points", since the bond vault reads the sender;
- the Sepolia gas limit carries its block;
- section 9.3 restores a weighting table;
- the note says that USD 0.21 errs high.

The reviewer recommends a second read by a model of another family, because the gate governs settlement with real money. It is not done; it is listed in the task's Handoff.

### 13.2 The red team: what would make the record wrong

**0 Critical, 6 High, 9 Medium, 8 Low, 2 Info.** Its summary: the gate as first written could pass in full while a deal still lost the buyer's key, exceeded the cap, was decided by a scripted judge, or was pushed to a default by a stranger.

| # | Severity | Finding | Answer |
| --- | --- | --- | --- |
| H-1 | High | A pending accept shows the buyer its key before the payment lands; an accept that misses its deadline leaves the buyer with the key and the money | Accepted. Section 3.6 states it, MG-35 narrows it, section 11 names it as a residual of the hold |
| H-2 | High | A stranger can wrap a copied step and leave the operators behind the deal, and the reduced form of MG-27 allowed it | Accepted. MG-27 is needed in full for a capped test |
| H-3 | High | The cap held only in the relayers; a larger deal funded directly would pass every line | Accepted. MG-3 now has four parts: the relayers, the adjudicators' acceptance, a total read from the chain, and the wallets' balances. O-1 says the bound depends on them |
| H-4 | High | Crow does not need its own escrow copy on Ethereum: Coinbase's creation transaction, replayed through the deterministic deployer, gives the same code at the same address | Accepted, and re-measured by T-351 (section 3.4). Section 3.4, MG-13 and the alternatives are rewritten around the replay. Base's lead on the escrow is its history, not its code (section 9.2) |
| H-5 | High | Section 6 promised that no agent deploys or holds the money, and three lines left a path | Accepted. Section 6 defines what a development session may not do; the deployer prepares and Rafa runs; MG-39 keeps the mainnet keys and deploy target apart |
| H-6 | High | No gate line covered the judgment; the demo falls back to scripted judges past a daily cap | Accepted. MG-36 |
| M-1 | Medium | "No condition on the deal's windows" overstated Ethereum's neutrality | Accepted. The verdict in section 3.6 is reworded, and MG-8 asks for room above the floors |
| M-2 | Medium | On Base the 12-hour rule used the wrong clock, and the sequencer can run the clock ahead | Accepted. Section 9.2 states both clocks; MG-34 adds the fixtures |
| M-3 | Medium | A lag after a halt changes deadlines, not only the beacon | Accepted. Section 9.2 and MG-34 |
| M-4 | Medium | "Seconds" on Base compared unlike confirmations | Accepted. Section 9.2 says which confirmation is meant and that the figure is unmeasured |
| M-5 | Medium | Monad was set aside on lookups nobody made | Accepted. Section 9.2 says it was not evaluated in full and is set aside by the word L2 in Rafa's order |
| M-6 | Medium | The gate's order blocked a rehearsal on a mainnet fork, and no line ran every outcome against real USDC | Accepted. Section 6 says what a session may do before the rule changes; MG-37 |
| M-7 | Medium | The gate did not say how the test ends | Accepted. MG-38 |
| M-8 | Medium | MG-28 could not pass as written: two planned fixtures no longer apply | Accepted. MG-28 lists every fixture with its state and adds two |
| M-9 | Medium | Who accepts the ADR, and what "in writing" means, were not fixed | Accepted. The Status line and section 6 |
| L-1 | Low | The fee table had no row at the relayers' ceiling | Accepted. Section 3.2 adds 20 gwei: about USD 18.64 a deal |
| L-2 | Low | A symbol and a domain do not prove the token's address | Accepted. MG-12 |
| L-3 | Low | The `bytes` overload exists on Ethereum and Base | Accepted, as its measurement. Section 3.5 |
| L-4 | Low | The buyer's last-resort reclaim checks the caller, so a contract buyer cannot force it through a bridge | Accepted. Section 9.2 |
| L-5 | Low | "Audited" for version 1.1.0 rests on a README line; a vendored instructions file lists the old address | Accepted. MG-13 asks for the sixth report; section 9.4 names the file |
| L-6 | Low | Three lines tested less than they said | Accepted. MG-16, MG-18 and MG-19 |
| L-7 | Low | The list of mainnet chain IDs lacks Monad (143) and others the note screened | Not this change. Listed in the task's Handoff for triage; the operator's allowlist still refuses them |
| L-8 | Low | A pending decision gives a party a free option on a settlement offer the other side signed | Accepted as the parties' own check (D32). One sentence in section 3.6; the agent docs are a follow-up |
| I-1 | Info | "Adds no actor" ignored that real USDC makes the issuer live | Accepted. Section 11 |
| I-2 | Info | The decision entry said the reviews were done while this section was empty; "34 conditions" counted rows | Fixed by this section. Section 7 now says how the 39 lines are counted |

**Attacks that failed** [the red team's list]:

- another operator on a shared escrow cannot touch Crow's holds: every operator call checks the sender, the payment's hash covers the operator, and the token store is per operator;
- the Base collector takes Crow's funding path;
- a copied `agreeAndFund`, `deliver` or `decide` gains nothing by itself;
- no deploy address can be squatted without the deployer's key;
- no contract in `contracts/src` or in the escrow reads `tx.origin`, `block.number` or a gas amount beyond the pairing's cap;
- the record's cross-references and its tally were right.

**What the red team could not check:** the control files it was told not to open, the private pilot plan, the audit reports, whether Base's mempool is private, and any test run. The exploit paths of H-1, H-3 and M-2 are inferred from the source and the published specifications.

## 14. Not verified

- **Any deal on Ethereum mainnet.** The times are Sepolia's and the gas is the local EVM's, under Prague's rules.
- **Ethereum's fee beyond five sampled windows of 3.4 hours** in the 30 days before 2026-11-11.
- **Agreement between mainnet's execution clients on the verifier's vectors** (MG-16).
- **That no audited escrow deployment exists on Ethereum mainnet at some other address.**
- **That the replayed creation transactions leave runtime code equal to Base's.** The address is measured; the code is inferred, and MG-13 checks it.
- **That mainnet's USDC accepts a contract wallet's ERC-3009 signature.** The `bytes` overload exists; no contract wallet has signed through it.
- **The three paths the red team inferred and did not run:** the pending accept that shows the key, the direct funding above the cap, and Base's two clocks.
- **A second read by a model of another family,** which the reviewer recommends for the gate.
- **Every time and fee for the L2s** beyond block time, price and the verifier's answer: documented or inferred, not run.
- **That the rules contract operates Coinbase's escrow on Base,** and that a deposit from Ethereum carries one of Crow's signed steps. Both are inferred from the source.
- **Monad's validator count, client count and incident record.**
- **The pilot plan's thirteen conditions** were read from the private plan and are restated here in engineering terms; this ADR does not reproduce its reasoning.
