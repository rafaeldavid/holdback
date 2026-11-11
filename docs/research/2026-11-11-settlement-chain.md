# Research pass: the settlement chain for the mainnet test

- **Date:** 2026-11-11
- **For:** ADR-0034 and D61, which recommend a chain for the first test with real money and write the gate before it. Task T-351.
- **Scope:** Ethereum mainnet, Base, Arbitrum One, OP Mainnet and Monad in full; eight more EVM chains screened in or out. Non-EVM chains are out of scope.
- **Method:** published sources fetched on 2026-11-11 by seven `web-fetch` subagents, and read-only calls to public RPC endpoints. No transaction was sent, nothing was signed, nothing was deployed, and no account was created.
- **Labels:** **measured** (a command in this run produced it; the command or endpoint is named), **documented** (a published page says it; the page is cited, with its date or "undated"), **inferred** (reasoning from measured or documented facts), **unverified** (not checked, with the reason).
- **Hard rule 1 stands.** This note deploys nothing. Only Rafa changes the rule.
- **The decision already on record.** On 2026-11-11 Rafa decided the order: "Assume Ethereum Mainnet first, we will deploy on L2 after we figure out it works on the primary industry standard" (recorded in ADR-0032 and D59). This note gives the facts behind that order and behind the choice of the L2 that follows.

## 1. Summary

**No candidate chain fails on the drand verifier, on USDC or on fees. Speed and neutrality decide, and they pull in opposite directions.** Ethereum mainnet has nothing that blocks the test and no single party that can delay a deal; it cannot settle in seconds. Base settles in seconds and already has the audited escrow; one sequencer orders its transactions.

1. **The verifier works on every serious candidate** [measured]. The deployed beacon's code, run by read-only call with a state override, returns drand round 1000's value on Ethereum, Base, Base Sepolia, Arbitrum One, OP Mainnet, Unichain, Monad, Linea and Arc. It refuses on Polygon PoS and Avalanche C-Chain (section 5).
2. **Fees no longer separate Ethereum from the rest at today's prices.** One deal's three transactions cost about USD 0.21 on Ethereum and about USD 0.006 on Base on 2026-11-11 [measured gas and prices; section 4]. The earlier figure of about USD 18.70 a deal on Ethereum does not hold at today's base fee of 0.23 gwei. Ethereum's fee is the volatile one.
3. **Ethereum cannot settle in seconds, and no scheduled fork changes that.** A slot is 12 s [documented], so three money steps take 36 s or more of chain time; Sepolia measured 45 s for a direct deal. Base makes a block every 200 ms since 2026-11-05 [documented and measured], Arbitrum One every 250 ms, Monad every 300 ms.
4. **Base is the one chain where the audited escrow is already deployed** [measured]. The `AuthCaptureEscrow` at `0xf96815976523E00e65Be8f34cA5e64b4f41EB19c` on Base is version 1.1.0, and its verified source equals the vendored file byte for byte. The address in the vendored README, `0xBdEA…0cff`, is version 1.0.0, which has the older fee interface (section 7).
5. **Every fast chain but Monad has one sequencer.** On Base, Arbitrum One and OP Mainnet a single operator orders transactions. A user can force a transaction through Ethereum, within 12 hours on Base and OP Mainnet and 24 hours on Arbitrum One [documented]. Base halted twice in June 2026, for 116 and 20 minutes [documented]. Monad has no sequencer and finalizes in 600 ms, and too much about it is unverified today (section 9).

What must still be measured before the choice is final is in section 12.

## 2. Criteria

The screen removes a chain. The ranking criteria compare the chains that remain; ADR-0034 weighs them.

**Screen (all four must hold):**

| # | Criterion | Why |
| --- | --- | --- |
| S1 | An EVM chain with a live mainnet and a public testnet | ADR-0004: the contracts target the EVM with no chain-specific opcodes |
| S2 | The drand verifier's code returns a real round's value there | ADR-0018 and ADR-0031 keep the on-chain proof; a chain without the EIP-2537 precompiles at Ethereum's prices refuses every fallback and escalation decision |
| S3 | Circle issues native USDC there, with ERC-3009 | ADR-0031: one token per deployment, funded by ERC-3009 only; D42: USDC first |
| S4 | Nobody's permission is needed to read the chain or to get a transaction included: a validator set anyone can join, or a path through Ethereum that is live today | ADR-0001 and ADR-0004's fifth criterion |

**Ranking:**

| # | Criterion | Measured by |
| --- | --- | --- |
| R1 | Neutrality: who can delay or censor a settlement, and for how long | The block producer, the forced-inclusion delay, who can upgrade the chain, halts on record |
| R2 | Seconds: the time a deal's three money steps take | Block time, the confirmation an operator can act on, finality |
| R3 | The fee for one deal | Measured gas times the measured price |
| R4 | What Crow must deploy and what an audit already covers | Whether the audited escrow is deployed there and usable unchanged |
| R5 | Contract signers and account abstraction | ERC-1271, EIP-7702, the ERC-4337 EntryPoint |
| R6 | What an operator can rely on | Public RPC, indexing, client and fork differences between the testnet and the mainnet |

## 3. Which chains are in and which are out

| Chain | Result | The deciding fact |
| --- | --- | --- |
| Ethereum mainnet | **In** | The target since D4 (2026-11-01). Passes S1 to S4 |
| Base | **In** | Passes S1 to S4. S4 by forced inclusion through Ethereum, 12 hours at most [documented] |
| Arbitrum One | **In** | Passes S1 to S4. S4 by the delayed inbox, 24 hours at most [documented] |
| OP Mainnet | **In** | Passes S1 to S4. S4 by forced inclusion, 12 hours at most [documented] |
| Monad | **In** | Passes S1 to S3 [measured]. S4: validators join by stake, up to 200 active [documented]; the current count is unverified |
| Unichain | Out of the full comparison | Passes the screen [measured for S2], and is an OP Stack chain with one sequencer and no escrow deployment listed. It offers nothing Base lacks |
| Polygon PoS | **Out, S2** | The verifier's code reverts with `InvalidSignature` on two endpoints, although the G1 addition precompile answers [measured]. The cause was not found [unverified] |
| Avalanche C-Chain | **Out, S2** | A call to the G1 addition precompile at `0x0b` returns empty data, and the verifier's code reverts [measured] |
| ZKsync Era | **Out, S2 and S4** | Its precompile list has no `0x0b` to `0x11` [documented]. Stage 0; a user "can't force" a transaction [documented, ETHBEAT] |
| Linea | **Out, S4** | The verifier's code passes [measured], but forced transactions are "not live yet" and only a trusted sequencer submits batches [documented, ETHBEAT, update of 2026-07-17]. Stage 0 |
| Arc | **Out, S4** | The verifier's code passes [measured]. Validators are "selected, known institutions", a permissioned set, and a blocklist is enforced at runtime [documented] |
| MegaETH | **Out, S3** | Circle's address page does not list it, and its own stablecoin table lists no USDC [documented] |
| Tempo | **Out, S3 and S4** | No native USDC on Circle's page; "the active validator set is permissioned" [documented] |

Sources for this table are in sections 5, 6 and 9 and in the source list (section 13).

## 4. Block time, confirmation, finality and the fee

### 4.1 Time

| | Ethereum | Base | Arbitrum One | OP Mainnet | Monad |
| --- | --- | --- | --- | --- | --- |
| Block time | 12 s slots [documented: ethereum.org, page updated 2026-10-07] | 200 ms since the Denim upgrade, 2026-11-05 18:00 UTC [documented: docs.base.org; measured: 12 consecutive blocks, five to a second] | 250 ms [documented: docs.arbitrum.io] | 2 s; 200 ms sub-blocks as a preconfirmation, rollout unverified [documented: docs.optimism.io] | 300 ms minimum; about 302 ms observed in September 2026 [documented: docs.monad.xyz] |
| The first confirmation an operator can act on | Inclusion in a block: 12 s at most after the transaction reaches a proposer, 6 s on average [inferred] | Inclusion in a 200 ms block from the one sequencer [documented] | The sequencer's feed, then a 250 ms block [documented] | A 2 s block, or a sub-block | Speculative at 300 ms; it "can only revert" if the leader equivocates [documented] |
| When the block's data is on Ethereum | n/a | About 2 minutes [documented] | "Every few minutes" [documented] | "A few minutes" [documented] | n/a |
| Finality | About 15 minutes: two epochs of 32 slots are 12.8 minutes [inferred from the slot and epoch; ethereum.org's roadmap says "fifteen minutes"] | About 20 minutes, when the batch is older than two Ethereum epochs [documented] | Unverified: the docs give no duration | About 15 to 30 minutes after the batch [documented] | 600 ms; a finalized block is "not revertible without a hard fork" [documented] |
| Reorgs on record | Not looked up | "Less than 0.00000002%" of transactions; none of a batched block [documented, undated] | Not looked up | Not looked up | Not looked up |

**What that makes of a deal's three money steps** (fund, deliver, decide), counting only the wait for the chain:

- **Ethereum:** three slots, 36 s at least when each step lands in the next slot. Measured on Sepolia, which has the same 12 s slot: 45 s for a direct test deal (2026-11-06) and 52 to 63 s from the one-command trial (2026-11-05) [measured by earlier tasks, recorded in ADR-0028 and its research note]. Carrying the delivery inside the decision makes two steps, 24 s at least. No shipped or scheduled fork shortens the slot: EIP-7782 (6 s slots) is a Draft and is not in the Glamsterdam list [documented: eips.ethereum.org].
- **Base:** three blocks of 200 ms. The chain's share is under 1 s; the operator's own round trips and the judgment decide the rest [inferred; not measured, see section 12].
- **Arbitrum One and Monad:** the same order as Base [inferred].
- **OP Mainnet:** three 2 s blocks, 6 s [inferred].

The judgment itself is not chain time. A panel of models answers in seconds to minutes on any chain.

### 4.2 The fee for one deal

**Method.** Gas comes from `forge test --root contracts --match-contract GasPerDeal --isolate -vv`, run on 2026-11-11 at commit `ac2d2b6`, where `contracts/src` equals `origin/main` [measured]. With `--isolate`, each call is its own transaction, with the 21,000 gas base cost, calldata and cold access included. The local EVM runs Prague's rules.

| Step | Gas [measured] |
| --- | --- |
| `agreeAndFund` | 233,994 gas |
| `deliver` on chain | 83,535 gas |
| `decide(accept)` after an on-chain delivery | 130,631 gas |
| **Three steps, as the demo runs them** | **448,160 gas** |
| `decide(accept)` that carries the delivery (two steps in all) | 163,783 gas; the deal is 397,777 gas |
| A fallback `decide` with the drand proof | 328,630 gas; the deal is 562,648 gas |

Fusaka's rules, which Ethereum mainnet and Base both run, price MODEXP higher than Prague's (EIP-7883). That touches only the drand proof: one `beaconValue` transaction is estimated at **219,232 gas** on Ethereum mainnet and on Base, the same figure on both, and 219,980 gas on Arbitrum One [measured: `eth_estimateGas` with a state override, 2026-11-11]. The verifier review derived about 58,438 gas more per proof under Fusaka than under Prague.

**Prices on 2026-11-11, about 20:59 UTC** [measured, read-only RPC]:

| | Price read | Three-step deal (448,160 gas) |
| --- | --- | --- |
| Ethereum | `eth_gasPrice` 0.2304 gwei at block 26,394,228; priority fee 11 wei | 0.000103 ETH, **about USD 0.21** |
| Base | Base fee 0.005 gwei, the configured minimum, plus a 0.001 gwei tip. Data fee: `getL1FeeUpperBound` gives 0.0000000212 ETH for 1,500 bytes | 0.0000027 ETH, **about USD 0.006**; the data fee adds under USD 0.001 |
| Arbitrum One | `eth_gasPrice` 0.02 gwei, the floor | 0.000009 ETH, about USD 0.02, plus a data fee not measured |
| OP Mainnet | `eth_gasPrice` 0.001 gwei | about USD 0.001, plus a data fee not measured |
| Monad | `eth_gasPrice` 102 gwei of MON; MON at USD 0.0168 | about USD 0.001. Monad charges the gas limit, not the gas used [documented] |

ETH was USD 2,079.59 and MON USD 0.0168 (Coinbase spot price API, 2026-11-11 20:59 UTC) [measured].

**Ethereum's fee is the volatile one.** `eth_feeHistory` over five windows of 1,024 blocks, about 3.4 hours each, between 2026-10-12 and 2026-11-11 [measured: publicnode and dRPC]:

| Window ending at block | Median | 90th percentile | Maximum |
| --- | --- | --- | --- |
| 26,178,228 (about 30 days ago) | 0.231 gwei | 0.376 gwei | 0.533 gwei |
| 26,286,228 (about 15 days ago) | 0.214 gwei | 0.448 gwei | 0.712 gwei |
| 26,358,228 (about 5 days ago) | 0.129 gwei | 0.326 gwei | 2.570 gwei |
| 26,387,028 (1 day ago) | 0.165 gwei | 0.327 gwei | 0.440 gwei |
| 26,394,228 (now) | 0.152 gwei | 0.204 gwei | 0.308 gwei |

At the highest base fee sampled, 2.57 gwei, the same deal costs about USD 2.40. At 30 gwei, a level Ethereum has seen in earlier years [from memory, unverified], it costs about USD 28. Five windows are a sample, not the month. On Base the base fee sat at the 0.005 gwei minimum in all four windows sampled, back to block 52,998,977 [measured].

**Glamsterdam will raise Ethereum's figure.** Sepolia has run the Glamsterdam fork since 2026-10-06, and there the same three transactions take about 1.26 to 1.64 million gas, about three times the Prague figure [measured by earlier tasks; D54 and ADR-0028 record it]. EIP-8037 raises the cost of creating state [documented]. Mainnet has no Glamsterdam date (section 10). At today's price that would be about USD 0.60 to USD 0.80 a deal [inferred].

## 5. The EIP-2537 precompiles and the drand verifier

**What the verifier needs.** `DrandQuicknetBeacon.sol` calls `MAP_FP_TO_G1` at `0x10`, `G1ADD` at `0x0b` and `PAIRING_CHECK` at `0x0f`, with a fixed cap of 250,000 gas on the pairing call, and MODEXP at `0x05` (the verifier review, sections 5 and 7).

**The check** [measured, 2026-11-11]. This run read the deployed beacon's runtime code from Sepolia (`0xBe80ad8B…Cc10`) and passed it as a state override to `eth_call` on each chain, calling `beaconValue(1000, signature)` with the signature drand's API returns for round 1000. Nothing was deployed. The expected value is `0xfe290bec…30e54fdd`, the value in `contracts/deployments/sepolia.json`.

| Chain | Endpoint | Result |
| --- | --- | --- |
| Ethereum mainnet | `ethereum-rpc.publicnode.com` | The expected value |
| Base | `mainnet.base.org` | The expected value. Round 1001 with round 1000's signature, and a point outside G1 (x = 4), each revert with `InvalidSignature` (`0x8baa579f`) |
| Base Sepolia | `sepolia.base.org` | The expected value |
| Arbitrum One | `arb1.arbitrum.io/rpc` | The expected value |
| OP Mainnet | `mainnet.optimism.io` | The expected value |
| Unichain | `mainnet.unichain.org` | The expected value |
| Monad | `rpc.monad.xyz` | The expected value |
| Linea | `rpc.linea.build` | The expected value |
| Arc | `rpc.mainnet.arc.io` | The expected value |
| Polygon PoS | `polygon-bor-rpc.publicnode.com`, `polygon.drpc.org` | Reverts with `InvalidSignature` on both. A direct call to `0x0b` returns the right sum, so the precompile exists; which step refuses was not found |
| Avalanche C-Chain | `api.avax.network` | Reverts with `InvalidSignature`. A direct call to `0x0b` returns empty data: no precompile |

**What the check does not show.** It ran on one public node per chain, so it says nothing about agreement between a chain's clients (the review's gate line G-1). Ethereum mainnet runs five execution clients; shares on ethereum.org (data of 2025-10-26) are Geth 41%, Nethermind 38%, Besu 16%, Erigon 3%, Reth 2% [documented]. Base runs one: since the Azul upgrade "only base-reth-node (EL) and base-consensus (CL) support Azul" and "op-geth and nethermind are no longer supported" [documented: docs.base.org]. One client cannot disagree with itself, and one bug in it has no second client to catch it.

**Published support.**

| Chain | When the precompiles arrived | Source |
| --- | --- | --- |
| Ethereum | Pectra, 2025-05-07. EIP-2537 is Final: `G1ADD` 375 gas, the pairing check 32,600 gas per pair plus 37,700 gas, `MAP_FP_TO_G1` 5,500 gas | eips.ethereum.org, EIP-7600 and EIP-2537 |
| Base | Isthmus, 2025-05-09: "Pectra (Execution Layer)" with EIP-2537 and EIP-7702. Azul, 2026-05-28, added EIP-7883's MODEXP prices "to match L1" | docs.base.org, upgrades |
| OP Mainnet | Isthmus, 2025-05-09. Karst, 2026-07-08, added EIP-7883 | docs.optimism.io |
| Arbitrum One | **ArbOS 51 "Dia", 2026-01-08.** ArbOS 40 enabled EIP-7702 and left EIP-2537 "not enabled" | docs.arbitrum.io |
| Monad | "Supports all Ethereum precompiles as of the Fusaka fork (`0x01` to `0x11`)" | docs.monad.xyz, undated |

**If a chain lacked the precompiles, the alternatives and their cost:**

| Alternative | Cost | Source |
| --- | --- | --- |
| drand's `evmnet` chain, which signs on BN254, verified with the pairing precompile at `0x08` that every EVM chain has | About 158,250 gas of execution per round in one published benchmark, against 131,564 gas for BLS12-381 in the same benchmark. A new verifier contract, new constants (chain hash `04f1e906…c8c3`, period 3 s, genesis 1727521075), a change to core's round arithmetic, and a new audit of that contract. The benchmarked library is "experimental, unaudited" and its repository was archived on 2026-07-20. drand says of `evmnet` there is "no plan to wind it down as long as there is interest" | docs.drand.love blog, 2025-08-26; api.drand.sh; github.com/randa-mu/bls-solidity |
| No on-chain proof (the cut ADR-0031 names as SC-8 and Rafa did not take) | No gas. The decider's beacon value becomes its word: checkable off chain and attributable, not enforced | ADR-0031 section 9 |
| A pairing in plain EVM code | Not costed. It runs to millions of gas [from memory, unverified] | n/a |

No candidate needs an alternative today.

## 6. Native USDC, ERC-3009 and who can freeze it

**Addresses** [documented: developers.circle.com/stablecoins/usdc-contract-addresses, undated, fetched 2026-11-11]:

| Chain | Native USDC |
| --- | --- |
| Ethereum | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Arbitrum One | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| OP Mainnet | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` |
| Monad | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| Base Sepolia (Circle's test USDC) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Ethereum Sepolia (Circle's test USDC) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |

**ERC-3009.** FiatToken added `transferWithAuthorization` in version 2.0.0 (2020-07-30) and `receiveWithAuthorization` in 2.1.0 (2021-02-17). Version 2.2 (2023-11-09) added "ERC-1271 signature validation support to EIP-2612 and EIP-3009 functions", and its functions take the signature as `bytes` [documented: circlefin/stablecoin-evm, `CHANGELOG.md` and `FiatTokenV2_2.sol`]. On Base the token answers `version()` with "2" and exposes `RECEIVE_WITH_AUTHORIZATION_TYPEHASH` [measured]. That the Base token runs 2.2's `bytes` overload was not called [unverified; it is a test for the building task, as ADR-0031 section 3 already says]. The Commerce Payments ERC-3009 collector calls `receiveWithAuthorization` with the signature as bytes.

**Who can freeze it.** Token-issuer risk is out of scope as a finding (Rafa, 2026-11-03); these are the facts.

- Circle "will control the address of all roles" [documented: `doc/tokendesign.md`].
  - The **blacklister** "prevents all transfers to or from an address".
  - The **pauser** stops all transfers, minting and burning.
  - The **owner** reassigns the roles.
  - The proxy **admin** can switch the implementation.
- On chain, 2026-11-11 [measured]: the blacklister is `0x0a06…78f9` on Ethereum, `0x1f2e…e277` on Base, `0xac5b…1329` on Arbitrum One, `0x551e…4d7c` on OP Mainnet and `0x1786…d6cd` on Monad. On Base the pauser is `0xd357…07b4`, the owner `0x3abd…6df7`, and `paused()` is false.
- Circle's terms (last updated 2026-10-15) say it "reserves the right to 'block' certain USDC addresses" that "may be associated with illegal activity" or a breach of its terms [documented: circle.com/legal/usdc-terms]. The standalone access-denial policy returned HTTP 404 at three URLs [unverified].
- The same power exists on every candidate. It does not separate them.
- One consequence for the gate: a transfer to a blocked address reverts, so a capture that pays a blocked seller reverts with real money (the contract review's item I-7).

## 7. The audited escrow

**Where it is deployed** [documented: github.com/base/commerce-payments, README and tags, fetched 2026-11-11; measured where marked].

| | Version 1.1.0 | Version 1.0.0 |
| --- | --- | --- |
| `AuthCaptureEscrow` | `0xf96815976523E00e65Be8f34cA5e64b4f41EB19c` | `0xBdEA0D1bcC5966192B070Fdf62aB4EF5b4420cff` |
| `ERC3009PaymentCollector` | `0x8612dfdc421f80336cd14E8EF9cb1E765dB5ab88` | `0x0E3dF9510de65469C4518D7843919c0b8C7A7757` |
| Tag | 2026-07-23, commit `6b0a5ef`, "fixed-fee variant (feeAmount)" | 2025-05-02, commit `d33b5d5` |
| Chains | Base and Base Sepolia, "the same address" by CREATE2 | Base and Base Sepolia |

- **Code at those addresses** [measured: `eth_getCode`, 2026-11-11]. All four have code on Base and on Base Sepolia, with equal sizes on the two networks (the 1.1.0 escrow is 10,978 bytes). None has code on Ethereum mainnet, Arbitrum One or OP Mainnet; the 1.1.0 escrow has none on Monad.
- **The vendored copy is 1.1.0** [measured]. `contracts/lib/commerce-payments` is at `6b0a5ef`, which `git describe` names `v1.1.0`.
- **The vendored README is behind.** Its one address table lists `0xBdEA…0cff`, which upstream now labels version 1.0.0. The contract review's cross-check (PA-I2) recorded that 1.0.0 "has the old `feeBps` ABI". Crow's rules contract calls `capture(paymentInfo, amount, fee, feeReceiver)`, the 1.1.0 interface. **Pointing the rules contract at `0xBdEA…0cff` would be wrong.**
- **The deployed 1.1.0 escrow is the audited source** [measured: Sourcify, chain 8453, 2026-11-11].
  - Sourcify reports an exact match for runtime and creation code, verified 2026-09-03, deployed in transaction `0x9d3ce23c…dc84a` at block 50,832,956.
  - The verified `src/AuthCaptureEscrow.sol` and `src/TokenStore.sol` equal the vendored files byte for byte (`diff` prints nothing).
  - The verified `ERC3009PaymentCollector.sol`, `ERC6492SignatureHandler.sol` and `TokenCollector.sol` differ from the vendored files in the licence line and in comment lines only. Sourcify reports "match" for the collector, not "exact match".
  - The collector at `0x8612…ab88` answers `authCaptureEscrow()` with `0xf968…b19c` and `multicall3()` with `0xcA11…CA11`.
- **Compiler settings differ from Crow's Sepolia build.** Coinbase built with solc 0.8.28, `viaIR`, 100,000 optimizer runs and the Cancun EVM version [measured: Sourcify]. Crow's Sepolia copy used 200 runs and Prague (`contracts/deployments/sepolia.json`). Same source, different bytecode.
- **Audits** [documented: the README]. Five in March and April 2025 (three by Coinbase Protocol Security, two by Spearbit), and a sixth, "Spearbit audit 3, 07/22/2026", labelled "rounding and billing change, v1.1.0, #90". The vendored `audits/` folder holds the first five reports only.
- **No admin.** The project's security page says "the protocol is permissionless and immutable by design; anyone can act as an operator" [documented]. `docs/operations.md` says of the same source on Sepolia that it has no owner, pause or upgrade path [documented].

**Can Crow's rules contract operate the Base deployment unchanged?**

- **Yes for the contract** [inferred from the measurements above]. `HoldbackRules` takes the escrow and the collector as constructor arguments and holds no role the escrow must grant: in Commerce Payments the operator is a field of the payment, and the rules contract names itself. The Sepolia deployment already runs the same source against its own copy.
- **Not shown by a run.** No rules contract has pointed at Coinbase's deployment. A fork test against Base, and then a Base Sepolia deployment, would show it (section 12).

**What that saves.**

- **Deploys:** two contracts (the beacon and the rules contract) in place of four. Under ADR-0031 the Permit2 collector goes anyway.
- **Bytecode trust:** the escrow that holds the money is the one Coinbase deployed and verified, at an address other operators already use, not a build of Crow's. On any other chain Crow deploys its own copy. To claim the same bytecode there, Crow would have to build with Coinbase's profile and compare the code hash with Base's; whether Coinbase's CREATE2 deployer lets anyone reproduce the address on another chain is unverified.
- **Audit scope:** none of Crow's own. An audit of Crow's contracts covers the rules contract and the beacon on any chain, and treats the escrow as an audited dependency. The saving is in what the deploy must prove, not in what the auditor reads.

## 8. Contract signers and account abstraction

- **ERC-1271** is checked by Crow's own contract (`_requireSigned`), so it works on any EVM chain. USDC's own check of a contract's ERC-3009 signature needs FiatToken 2.2 (section 6).
- **EIP-7702** is live on all five: Ethereum since Pectra (2025-05-07), Base and OP Mainnet since Isthmus (2025-05-09), Arbitrum One since ArbOS 40 (date unverified), Monad "with the same workflow as Ethereum" [documented]. On Monad a delegated account cannot fall below 10 MON and cannot call CREATE [documented].
- **ERC-4337.** The EntryPoint contracts 0.7 (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`), 0.8 (`0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`) and 0.9 (`0x433709009B8330FDa32311DF1C2AFA402eD8D009`) have code, with equal sizes, on Ethereum, Base, Base Sepolia, Arbitrum One and OP Mainnet [measured]. EntryPoint 0.7 and Multicall3 have code on Monad [measured]. Version 0.8 added "native support for EIP-7702 authorizations" [documented: eth-infinitism releases].
- **Base's own account type.** "Base Transactions" (EIP-8430, type `0x79`) "activate with the Everest network upgrade", which has no date [documented]. Nothing Crow needs depends on it.
- **Multicall3,** which the ERC-3009 collector uses for a wallet that is not deployed yet, has code at `0xcA11…CA11` on all five [measured].
- **Crow's operators are the limit, not the chains.** The operators check plain-key signatures only and cannot follow a step sent through a contract wallet (residual 13 in `docs/neutrality.md`; T-227).

## 9. Reorg depth, and who can delay or censor a settlement

The neutrality test (ADR-0001): no single party can stop a valid commitment from settling according to its terms, or move held funds outside those terms.

| | Ethereum | Base | Arbitrum One | OP Mainnet | Monad |
| --- | --- | --- | --- | --- | --- |
| Who orders transactions | The slot's proposer, drawn from a validator set anyone can join; "an overwhelming majority" outsource block building [documented: EIP-7732] | "A single active sequencer" run by Coinbase [documented] | "A centralized sequencer" [documented: ETHBEAT]; the operator is not named in the pages read | One sequencer, changeable by the Optimism Foundation's operations multisig [documented: ETHBEAT] | The slot's leader, by stake; up to 200 active validators [documented] |
| The path around a censor | The next proposer. Inclusion lists (EIP-7805) are a Draft, placed after Glamsterdam [documented] | A deposit to `OptimismPortal` on Ethereum (`0x49048044D57e1C92A77f79988d21Fa8fAF74E97e`), included within the sequencing window of 3,600 Ethereum blocks, "about 12 hours"; "typically within 3 minutes" when the sequencer cooperates [documented] | The delayed inbox: 24 hours at most, less under the delay buffer [documented] | A deposit to `OptimismPortal`: 12 hours at most [documented] | The next leader |
| Stage (ETHBEAT, formerly L2BEAT) | n/a | Stage 1 | Stage 1 | Stage 1 | n/a |
| Who can upgrade the chain's contracts | n/a; a fork needs the clients and the validators | A 2-of-2 of Coinbase's 3-of-6 and a Security Council's 8-of-11. "There is no delay on upgrades." Exit window: "None" [documented: ETHBEAT, docs.base.org] | The Security Council with no delay; other upgrades after "17d 8h" [documented: ETHBEAT; the page gives two figures for the exit window] | Security Council plus Foundation, "no delay". Exit window: "None" [documented: ETHBEAT] | A hard fork by the validators |
| Halts in 2026 | Not looked up | 2026-06-25, about 116 minutes, and 2026-06-26, 20 minutes: a block-building bug sealed a block the validators rejected [documented: base.org post-mortem, 2026-06-27] | Not looked up | Not looked up | Unverified: `status.monad.xyz` did not resolve |
| Node software | Five execution clients | One (base-reth-node) | Not looked up | Not looked up | Unverified; in-protocol slashing "is not currently implemented" [documented] |

**What a sequencer can and cannot do to a Crow deal** [inferred from the contract and the documented rules]:

- **It cannot move the held funds.** Every step needs a party's or an adjudicator's signature, and the contract checks it.
- **It cannot stop a step for good.** Crow's entry points never read `msg.sender`, so any account can carry any signed step. A deposit from Ethereum arrives as an ordinary call, so it can carry one too. This is not rehearsed (section 12).
- **It can delay a step by up to 12 hours** on Base and OP Mainnet, 24 hours on Arbitrum One. A delay changes an outcome when it outlasts a deadline: a seller's delivery held past `deliverBy` lets the buyer reclaim; a decision held past `judgeBy` hands the case to the fallback.
- **So a deal is neutral on a one-sequencer chain only if each of its windows is longer than the forced-inclusion delay plus the time to send the forced transaction.** `docs/neutrality.md` already says so (residual 2: "size deadlines to leave time for it"). The windows bound the worst case; they do not slow the common one. A deal with a 24-hour delivery window still settles in seconds when both sides act.
- **Ethereum has no such actor.** A proposer or a builder can leave a transaction out of its own block; the next proposer can include it.

**The chain's operators as a new control point.** On Base, the upgrade multisig can change the chain's contracts on Ethereum with no delay. Native USDC is issued on Base itself, so the bridge's contracts do not hold it. What the upgrade keys and the node software's maintainers could do to balances on the chain itself was not analysed here [unverified].

**Block time against real time: the beacon's margin is per chain** [measured where marked, otherwise inferred].

- **Ethereum.** A block carries its slot's timestamp. Mainnet's timestamps sit 1 s before a drand round and Sepolia's 3 s before one (the verifier review, gate line G-9). A missed slot does not shift later timestamps.
- **Base.** `block.timestamp` stays in whole seconds, and five blocks share each second [measured: blocks 56,201,869 to 56,201,880, with a `timestampMs` field]. The latest block's timestamp equalled this machine's clock to the second [measured]. Since Denim, a block's time follows "from the Denim activation schedule and absolute L2 block number", and "wall-clock time controls when the sequencer starts a build, not the timestamp assigned to that block" [documented].
- **After a halt, Base's timestamps lag real time.** Blocks 47,806,604 to 47,806,609 carry timestamps from 15:49:15 to 15:49:25 UTC on 2026-06-25, two seconds apart, with one transaction each [measured]. The post-mortem puts the halt from 15:47 UTC to 17:51 UTC. So the chain produced those blocks after 17:51 UTC with timestamps about two hours old [inferred]. How long the catch-up took, and whether Denim changed the rule, is unverified.
- **Why it matters.** The round that seeds an escalation's panel is fixed from the block's time (ADR-0018; finding X-1 of the verifier review). drand runs on real time. While a chain's timestamps lag by more than the margin, the round is already public when the block is built, and any sender can read it before it lands the escalation. A fixed margin of seconds does not cover a lag of hours.
- **Arbitrum One** lets its sequencer set a timestamp from 24 hours behind to 1 hour ahead of real time [documented]. **OP Mainnet** bounds the timestamp against the Ethereum origin block with a drift of 1,800 s [documented].
- **ADR-0032 already names this.** Its rule adds a margin fixed at deploy, 29 s on Ethereum. Its residual 3 says the margin keeps the seed "from everyone else and not from the sequencer", and that every sender knows the round while a chain's block times lag. Its gate line BR-7 asks for the margin and the lag of any chain other than Ethereum before a deploy there. The measurement above is the first input to BR-7 for Base.
- **How far it reaches in phase one.** ADR-0031 cuts party appeals: only an adjudicator escalates, and an adjudicator that wants an outcome can already decide it. The lag gives it a choice of appeal panel it would not otherwise have. That is a stated residual for a capped test, not a blocker [inferred].

## 10. Where a testnet differs from its mainnet

| Pair | The difference | Source |
| --- | --- | --- |
| Ethereum Sepolia and mainnet | **Sepolia runs Glamsterdam since 2026-10-06; mainnet runs Fusaka (since 2025-12-03).** The Hoodi testnet's fork was postponed (2026-10-22) and "a new activation date has not been set"; on 2026-11-06 the developers decided "to delay the hardfork process". Mainnet has no date | eips.ethereum.org EIP-7773 and EIP-7607; blog.ethereum.org |
| | Gas: a deal's three transactions take 448,160 gas under Prague's rules and about 1.26 to 1.64 million gas on Sepolia. A Sepolia gas figure is not a mainnet figure | Section 4.2; the verifier review, G-2 |
| | Gas limit: 200,000,000 gas a block on Sepolia, 60,000,000 gas on mainnet | Measured, latest block of each |
| | Block time against drand: 3 s before a round on Sepolia, 1 s on mainnet | The verifier review, G-9 |
| | Clients: the review checked two Sepolia nodes; mainnet's five clients are unchecked | The verifier review, G-1 |
| Base Sepolia and Base | **The same rules today.** Denim reached Base Sepolia on 2026-10-21 and Base on 2026-11-05: "200ms native blocks are live on both networks". The testnet ran 15 days ahead | docs.base.org |
| | Gas limit: 120,000,000 gas a block on Base Sepolia, 40,000,000 gas on Base. The minimum base fee is 0.005 gwei on both | Measured; docs.base.org |
| | The escrow and its collector sit at the same addresses on both | Measured |
| | USDC on Base Sepolia is Circle's test token, with Circle's roles and a faucet a person drives. It is not Crow's open-mint test token | Circle's address page; ADR-0028 item 6 |
| | Base ships upgrades often: Azul (2026-05-28), Beryl (2026-06-25), Cobalt (2026-09-30), Denim (2026-11-05), each one to five weeks after Base Sepolia | docs.base.org |
| Arbitrum Sepolia and One | The testnet ran about seven weeks ahead on ArbOS 61 (2026-06-29 against a scheduled 2026-08-20) | docs.arbitrum.io |
| OP Sepolia and Mainnet | About three weeks ahead on Karst (2026-06-17 against 2026-07-08) | docs.optimism.io |
| Monad testnet and mainnet | Three weeks ahead on the `MONAD_TEN` upgrade (2026-08-12 against 2026-09-02) | docs.monad.xyz |

**The pattern:** every testnet runs ahead of its mainnet at times. A measurement taken on a testnet holds for the mainnet only if both run the same fork on the day. On 2026-11-11 that is true for Base and false for Ethereum.

## 11. Public RPC and indexing

| | Public endpoint | What its operator says | Explorers |
| --- | --- | --- | --- |
| Ethereum | No official one. This run used `ethereum-rpc.publicnode.com` and `eth.drpc.org`; the demo uses publicnode and Tenderly on Sepolia (ADR-0028 item 10) | publicnode refused `eth_feeHistory` for windows older than about a day; dRPC's free plan refuses batches of more than 3 requests [measured] | Etherscan, Sourcify |
| Base | `https://mainnet.base.org`, chain ID 8453; `https://sepolia.base.org`, chain ID 84532 | "Free, rate limited, and best effort. They are not suitable for production apps." On 2026-10-08 the endpoint dropped the `debug`, `trace` and `txpool` namespaces and lowered the read rate limit; no number is published [documented: docs.base.org, status.base.org] | Basescan, Sourcify |
| Arbitrum One | `https://arb1.arbitrum.io/rpc`, chain ID 42161 | "No uptime, latency, or rate-limit guarantees"; no WebSocket [documented] | Arbiscan |
| OP Mainnet | `https://mainnet.optimism.io`, chain ID 10 (used in this run; the docs pages read did not list it) | Unverified | Not looked up |
| Monad | `https://rpc.monad.xyz`, chain ID 143, and three more | 20 requests a second, 100 a batch; "do not use for production workloads" [documented] | MonadVision, Monadscan |

What an operator can rely on [inferred]:

- **On every chain an operator needs a keyed provider, with a public endpoint as the fallback.** ADR-0028 already builds that shape for Sepolia.
- **The log sync changes on a fast chain.** The operators read the rules contract's logs in chunks of at most 50,000 blocks (ADR-0028 item 11). That is about 7 days of Ethereum and about 2.8 hours of Base, which makes 432,000 blocks a day. The cursor arithmetic holds; the chunk size and the provider's `eth_getLogs` limits need a new look.
- **`block.number` is no clock on Base.** Since Denim it "advances 10x faster in wall-clock time" [documented]. Crow's contracts use timestamps only [measured: `grep` of `contracts/src`], so nothing breaks.
- **"A write answers at inclusion"** (ADR-0028 item 4) means a 200 ms block from the one sequencer on Base. Base's own stages are that block, the batch on Ethereum after about 2 minutes, and Ethereum finality after about 20 minutes.

## 12. What must be measured before the choice is final

None of these was done here. A line marked "transaction" needs a deploy or a transaction on a public testnet and waits for Rafa's go-ahead. A line marked "read-only" does not.

**For Ethereum mainnet, the chain of the test:**

1. **Gas per step under the fork mainnet runs on the day,** on a mainnet fork (read-only): the three money steps, a fallback decision with the proof, and each refusal. Sepolia's figures do not carry (section 10).
2. **The verifier's full vector set through each of mainnet's five execution clients** (read-only; the review's gate line G-1). This run checked one valid proof on one node.
3. **Funding with real USDC's interface on a mainnet fork** (read-only), by a plain key and by a contract wallet: the demo's token is Crow's own, and Circle's token has roles and a proxy the test token lacks.
4. **The escrow Crow deploys.** Build the vendored source with the settings the audit read, record the code hash, and compare the creation code after the deploy (transaction). Whether a build with Coinbase's settings reproduces Base's code hash is a read-only check.
5. **The refusals mined once on Sepolia** (transaction; the review's gate line G-4): status 0 and the predicted gas.
6. **One fallback decision and one escalation decision on the Sepolia deployment that carries ADR-0032's rule** (transaction; its gate line BR-10), and the two header measurements it asks for (read-only; BR-3 and BR-6).
7. **A deal's time on mainnet's rules.** Sepolia's 45 s is the closest figure there is; mainnet proposers build later in the slot than Sepolia's (ADR-0032 section 8). It is first measured by the test itself.

**For Base, the L2 that follows:**

8. **A timed deal on Base Sepolia** (transaction) with the audited commit: the three money steps, from the operator's request to the receipt, and the whole deal.
9. **The rules contract operating Coinbase's escrow** at `0xf968…b19c`, through every outcome: release, refund, reclaim, mutual settlement, a fallback decision with a drand proof. First as a fork test (read-only), then on Base Sepolia (transaction).
10. **Funding with Circle's test USDC on Base Sepolia** (transaction), by a plain key and by a contract wallet.
11. **A forced step** (transaction): one signed step of a Base Sepolia deal sent through `OptimismPortal` on Ethereum Sepolia with the operators' relayers stopped, and its cost in gas on both layers.
12. **Gas per step on Base Sepolia** against the 448,160 gas measured locally, and the data fee from real calldata sizes (transaction).
13. **The round margin on Base** (read-only; ADR-0032's gate line BR-7): how late after its timestamp a block can still take a transaction in normal operation, over a day of blocks, and how long the lag lasts after a halt.
14. **The verifier's full vector set on Base** (read-only): the seven rounds, the refusals, the red team's nine points outside G1.

Facts this note could not verify, each named where it appears: the validator count, client count and incident record of Monad; ArbOS 61's activation on Arbitrum One; Circle's standalone access-denial policy; the function name of the forced deposit against the contract's source; what Base's upgrade keys could do to balances on Base; the cause of Polygon's refusal; the reorg record of four of the five chains.

## 13. Sources

All fetched or called on 2026-11-11. Pages are undated unless a date is given.

- **Ethereum:** eips.ethereum.org (EIP-2537, 7600, 7607, 7702, 7732, 7773, 7782, 7805, 7825, 7883, 7935, 8037, 8038); ethereum.org roadmap (site updated 2026-11-10), proof-of-stake page (updated 2026-10-07), client diversity page (updated 2026-02-23); blog.ethereum.org posts of 2026-09-17, 2026-10-22 and 2026-11-06.
- **Base:** docs.base.org (upgrades overview; Isthmus, Azul, Cobalt and Denim pages; transaction finality; network fees; throughput and limits; precompiles; reliability and liveness; derivation; deposits; base contracts; connect to Base; security council); base.org/blog/postmortem-june-25th-block-production-outage (2026-06-27); status.base.org/incidents/jrs0dpj60tqz (2026-10-08); theblock.co on Denim (2026-11-05).
- **Stages and permissions:** ethbeat.org/scaling/projects/base, /arbitrum, /op-mainnet, /unichain, /zksync-era, /linea. `l2beat.com` redirects there, and the home page reads "ETHBEAT (formerly L2BEAT)".
- **Arbitrum:** docs.arbitrum.io (ArbOS 40, 51 and 61 release pages; sequencer; chain info; block numbers and time; gas and fees).
- **OP Stack:** docs.optimism.io (network upgrades; Isthmus, Jovian and Karst; forced transaction; transaction finality; fee parameters); specs.optimism.io derivation.
- **Monad:** docs.monad.xyz (network information; MonadBFT; staking; precompiles; differences; EIP-7702; gas pricing; releases).
- **Others:** docs.arc.io; docs.zksync.io; docs.linea.build; docs.megaeth.com; tempo.xyz/developers; build.avax.network; docs.polygon.technology; developers.uniswap.org (Unichain).
- **USDC:** developers.circle.com/stablecoins/usdc-contract-addresses; github.com/circlefin/stablecoin-evm (`CHANGELOG.md`, `doc/tokendesign.md`, `FiatTokenV2_2.sol`); circle.com/legal/usdc-terms (updated 2026-10-15).
- **The escrow:** github.com/base/commerce-payments (README, tags, `docs/Security.md`); sourcify.dev, chain 8453, both addresses.
- **ERC-4337:** github.com/eth-infinitism/account-abstraction, releases and tags.
- **drand:** api.drand.sh (`/chains`, the three `/info` endpoints, quicknet round 1000); docs.drand.love blog of 2025-08-26; drand.love/loe.
- **Prices:** api.coinbase.com/v2/prices/ETH-USD/spot and MON-USD/spot.
- **RPC endpoints called, read-only:** `ethereum-rpc.publicnode.com`, `eth.drpc.org`, `ethereum-sepolia-rpc.publicnode.com`, `mainnet.base.org`, `sepolia.base.org`, `arb1.arbitrum.io/rpc`, `mainnet.optimism.io`, `mainnet.unichain.org`, `rpc.monad.xyz`, `rpc.linea.build`, `rpc.mainnet.arc.io`, `polygon-bor-rpc.publicnode.com`, `polygon.drpc.org`, `api.avax.network/ext/bc/C/rpc`.
- **In this repository:** ADR-0004, ADR-0018, ADR-0028, ADR-0031; D4, D41, D42, D54; `docs/reviews/2026-11-11-drand-verifier-review.md`; `docs/reviews/2026-11-03-public-audit-crosscheck.md`; `docs/neutrality.md`; `contracts/deployments/sepolia.json`; `contracts/lib/commerce-payments` at `6b0a5ef`.

## Where this pass did not look

- **Not run:** any deal on any chain but the local EVM. Every figure for Base, Arbitrum One, OP Mainnet and Monad beyond block time, price and the verifier's answer is documented or inferred.
- **One node per chain.** The read-only calls say what one public endpoint answered at one moment.
- **Subagent summaries.** The published facts came through `web-fetch` subagents. Where a subagent read a page as a summary and not verbatim, it said so, and this note marks the fact unverified or cites the page with that caveat. A `reviewer` checks ten facts against their sources before this merges.
- **Not read:** the audit reports' PDFs; Circle's contract source beyond the files named; the node software of any chain; the Base, Arbitrum and OP contracts on Ethereum.
