# Public-audit cross-check of the custom contracts (2026-11-03)

Before the Sepolia deployment, Rafa asked that every custom contract be checked against published audit work on comparable contracts: "find public audits of escrow related contracts such that any custom smart-contract we are deploying has been reviewed against public audit work".

This review does three things:
- it collects those audits (section 2);
- it turns their findings into vulnerability classes and checks each class against our code (section 3);
- it ranks what is new (section 4).

It complements the T-206 contract review (`docs/reviews/2026-11-03-contract-review.md`, in PR #128, not yet merged) and cites that review's findings by ID (H-1 to L-6, I-1 to I-11) instead of repeating them.

**Scope.**
- The code under review is `contracts/src/` at `main` `43479c7`, the merge base when the review was written:
  - `HoldbackRules`;
  - `HoldbackBonds`;
  - `HoldbackTypes`, with `Money`;
  - `DrandQuicknetBeacon`.

  `SimBeacon` runs on anvil only.
- How `HoldbackRules` drives Commerce Payments' (CPP) `AuthCaptureEscrow` v1.1.0, vendored at `6b0a5ef3`, with its ERC-3009 and Permit2 collectors and Multicall3.
- T-206's fix PRs were read: #122 was already in `43479c7`; #120, #125 and #127 merged to `main` while this review ran. The cross-check tests pass on the merged code (section 9).
- First wave: USDC only (D42, recorded in PR #138, not yet merged).
- Judge-side classes (prompt injection, Unicode smuggling) do not apply: the contracts handle hashes and signatures, never content.

**Method.**
- Five research passes read the primary sources: audit firms' report repositories, project audit folders and contest reports. Each pass fetched every URL it cites, and anything it could not open is marked unverified.
- Each class was then checked against the code with file:line evidence.
- 26 new Foundry tests in `contracts/test/crosscheck/` (18 of them from the red-team pass), and 3 more handed to T-206's fix PR (section 9).
- Two independent passes reviewed this document: the reviewer role, and a red-teamer on Claude Fable 5.1. Their findings are folded in.
- Read-only RPC checks against Ethereum Sepolia and mainnet. No deployment, key or transaction was used.

**Labels.** **Measured**: a test, a tool run, or text read in the source. **Inferred**: from reading code. **Guessed**: plausible, not checked. Line numbers refer to `43479c7`; `ACE` is `contracts/lib/commerce-payments/src/AuthCaptureEscrow.sol`.

## 1. Verdict

- **Dependencies.** None of the published audits of CPP v1.1.0, Permit2, Solady or USDC shows a problem with how Crow uses them [measured from the reports, inferred for our usage].
  - The one substantive CPP code change after the 2025 audits, PR #90 (absolute `feeAmount`), has its own Cantina audit of exactly `6b0a5ef3`. That report reached CPP's repository after our pin, so it is not in our vendored copy. PR 71's contract renames are the only other change no audit covered.
- **Two new medium findings. Neither moves held funds or bonds.**
  - **PA-M1.** A sham deal can lock a fallback's or appeal adjudicator's bond without its signature, contrary to ADR-0016 §1. Fixed by T-206 as M-3 in PR #135, merged before the deployment.
  - **PA-M2.** The operator-fee bundle can be front-run so that a deal never funds through that node, while the buyer's operator fee is still paid. ADR-0023 expected this residual, but its stated mitigation was not built. The Sepolia demo lane builds it in PR #138.
- **No new high finding.**
- **Two new contract lows, found by the red-team pass:**
  - **PA-L3.** The party a decision favoured can take the deal's single appeal slot for free.
  - **PA-L4.** A `judgeBy` set before funding makes the fallback seed grindable.
- **The drand verifier passes every BLS pitfall the audits name.** No audit of a Solidity drand verifier was found, so there is no earlier review of one to lean on. Two low gas findings, PA-L1 and PA-L2 (section 7).
- **Out of scope.** The token issuer's blacklist and pause (section 5).
- **Deploy checks are measured** (section 6.3): Sepolia's USDC, Permit2, Multicall3 and EIP-2537 precompiles match what the code expects. EIP-1153 is inferred.
- **0xSplits.** Adopt nothing in the settlement path (section 8). Nothing in Splits removes code from `HoldbackRules`. Its ideas fit only at the edges: an operator, adjudicator or seller may receive into a split with no protocol change. Any adoption would need an ADR and would come after the Sepolia deployment.

## 2. Audits consulted

"Verified" means the research pass opened the URL in this session. Dates are review windows where the report gives them, else the cover date.

### 2.1 What we deploy or call

| Project and scope | Auditor | Date | Link | Relevance |
| --- | --- | --- | --- | --- |
| CPP `PaymentEscrow` at `b35b022` (early AuthCaptureEscrow) | Coinbase Protocol Security | 18–20 Mar 2025 | [ProtoSec 1](https://github.com/base/commerce-payments/blob/main/audits/CommercePaymentsAudit1ProtoSec.pdf) | Our escrow's ancestor. M-01 fee dodging by tiny captures |
| CPP escrow plus ERC-3009, Permit2, PreApproval and SpendPermission collectors, `41acc69` to `8a2c6e9` | Coinbase Protocol Security | 26–31 Mar 2025 | [ProtoSec 2](https://github.com/base/commerce-payments/blob/main/audits/CommercePaymentsAudit2ProtoSec.pdf) | Our collectors |
| CPP `commerce-v1` at `f44d4073` | Cantina (Spearbit): Noah Marconi, Tnch, rscodes | 2–5 Apr 2025 | [Cantina 1](https://github.com/base/commerce-payments/blob/main/audits/Cantina-Report-04-01-2025.pdf) | Critical 3.1.1: a re-entrant collector drains the escrow (fixed). Push-payment DoS; ERC-6492 arbitrary call; operator trust |
| CPP with TokenStore and the guard, `dc809ed` to `1801352` | Coinbase Protocol Security | 15–18 Apr 2025 | [ProtoSec 3](https://github.com/base/commerce-payments/blob/main/audits/CommercePaymentsAudit3CoinbaseProtoSec.pdf) | L-01: silent `_sendTokens` failure (fixed). Remark on old Permit2 versions |
| CPP `payment-escrow` at `ef53dac6` | Cantina: Chris Smith, Cccz, Jonatas Martins | 23–26 Apr 2025 | [Cantina 2](https://github.com/base/commerce-payments/blob/main/audits/Cantina-Report-04-22-2025.pdf) | 3.3.5: "operators are highly trusted", which is exactly our configuration. 3.3.2: ERC-1271 replay through Permit2 |
| CPP `AuthCaptureEscrow` v1.1.0, PR #90, at `6b0a5ef3` (our pin) | Cantina: Sujith Somraaj, Cryptara | 20–21 Jul 2026 | [Cantina PR 90](https://github.com/base/commerce-payments/blob/main/audits/report-cli-cantina-eb1cc8bc-577c-422d-ad76-db7495f29a5a-2026-07-22-coinbase-commerce-payments-pr-90.pdf); [portfolio](https://cantina.xyz/portfolio/974da7c5-1c0d-4483-8ab2-42e5ca08dfc2) | Audits the exact escrow code we pin. 3 informational findings, fixed in docs. Not vendored (PA-I8) |
| A CPP fork for DCS Protocol (upgradeable, pre-#90) | BlockSec | 2 Apr 2026 | [BlockSec](https://github.com/blocksecteam/audit-reports/blob/main/solidity/blocksec_dcs_protocol_commerce_payments_signed_20260402.pdf) | Supporting only: nonce and salt binding |
| Uniswap Permit2, V1 to V4 (`9681052`) | ChainSecurity | 18 Nov 2022 | [Permit2 audits](https://github.com/Uniswap/permit2/tree/main/audits) | 6.1: uint160 cast (fixed). Note 7.2: malleability is harmless because Permit2 uses nonces |
| Uniswap Permit2 | ABDK | 16 Nov 2022 | same folder | CVF-26 cast (Critical, fixed). CVF-35: spender bound to `msg.sender` |
| Solady at `e158762` (SafeTransferLib, SignatureCheckerLib, EIP712) | Ackee Blockchain | 30 May 2023 | [Solady audits](https://github.com/Vectorized/solady/tree/main/audits) | W2: the domain is fixed to `address(this)`. W4: Yul evaluation order (fixed in 0.1.1) |
| Solady at `89101d53` | Cantina | 7–25 Aug 2023 | same folder | 4.2.3: ECDSA empty-signature issue (fixed; we do not import `ECDSA`) |
| Solady at `4c895b96`, whole library, for Coinbase | Spearbit via Cantina | Dec 2024 – Jan 2025 | same folder | Critical 5.1.1: an ERC-6492 call runs in the verifier's context (we do not use Solady's 6492). 5.6.11: EIP-7702 signers |
| USDC FiatToken v2.2 | Halborn, per Circle | blog, 9 Nov 2023 | [Circle blog](https://www.circle.com/blog/announcing-usdc-v2-2) | **Report not located (unverified).** Token behaviour was read in [stablecoin-evm](https://github.com/circlefin/stablecoin-evm) instead |
| Multicall3 | none: unaudited per its README | n/a | [mds1/multicall3](https://github.com/mds1/multicall3) | The README also says the deployer key is compromised (PA-I2) |

Solady is vendored at 0.1.1 (`5ea5d9f`), and every audited commit above is its ancestor. Its 130 later commits are not covered by any audit [measured].

Permit2 source is at `cc56ad0`, a descendant of the last audited commit [measured]:
- `SignatureVerification.sol` and `PermitHash.sol` are unchanged since;
- `SignatureTransfer.sol` and `EIP712.sol` changed in imports and interfaces only.

### 2.2 Escrow, arbitration and bonds

| Project and scope | Auditor | Date | Link | Relevance |
| --- | --- | --- | --- | --- |
| Kleros v2: KlerosCore, sortition, dispute kits | Certora | 12 Nov – 19 Dec 2025 | [Certora report](https://www.certora.com/reports/kleros-v2) | H-01, M-02: stake counters drift. M-01: a reverting callback blocks rulings. M-04: parameters change mid-dispute. M-08: free-riding on appeals |
| UMA Optimistic Asserter (Optimistic Oracle v3) | OpenZeppelin | 5–9 Dec 2022 | [OZ](https://www.openzeppelin.com/news/uma-optimistic-asserter-audit) | M1: a burn rate applied after the fact. L5: assertions with no bond |
| UMA Insured Bridge and SkinnyOptimisticOracle | OpenZeppelin | published 1 Dec 2021 | [OZ](https://www.openzeppelin.com/news/uma-audit-l2-bridges) | H01: a pooled reserve spent twice. M05: a possible zero bond |
| UMA DVM 2.0 | OpenZeppelin | 18–29 Jul 2022 | [OZ](https://www.openzeppelin.com/news/uma-dvm-2-0-audit) | Slashing and reward accounting, retroactive parameters |
| UMA Phase 1 (DVM voting) | OpenZeppelin | published 28 Apr 2020 | [OZ](https://www.openzeppelin.com/news/uma-audit-phase-1) | H01: a commit not bound to the voter. H03: execution after an external call |
| UMA Early Resolver and Dispute Router | OpenZeppelin | 19–28 Jan 2026 | [OZ](https://www.openzeppelin.com/news/uma-and-across-incremental-audit) | #4: the first proposer fixes the settings. #6: a signature with no domain or expiry |
| Reality.eth 3.0, `064855bf` | G0 Group | Aug 2021 | [audit_v3](https://github.com/RealityETH/reality-eth-monorepo/blob/main/packages/docs/audit_v3.rst) | #1, #2: bonds paid to `address(0)`; a finalized question with no answer |
| Reality.eth v2, ERC-20 version | Roland Kofler | Jun 2019 | [audit_v2_ERC20](https://github.com/RealityETH/reality-eth-monorepo/blob/main/packages/docs/audit_v2_ERC20.rst) | Non-compliant tokens; re-entrancy notes |
| Aragon Court, `0205c2fc` | Georgios Konstantopoulos | 1–15 Nov 2019 | [report](https://github.com/gakonst/publications/blob/master/aragon_court_audit.pdf) | 2: blockhash randomness gets stuck after 256 blocks. 3: a miner-juror can bias the draw |
| Trustless Work (Soroban escrow with a dispute resolver) | Runtime Verification | Aug–Sep 2025 | [RV report](https://runtimeverification.com/public-report/trustless-work) | A01: the caller picks the fee address. A05: roles changed before funding. B06: the resolver should consent |
| CodeHawks "Escrow" (buyer, seller, arbiter, USDC) | Cyfrin CodeHawks contest | 24 Jul – 5 Aug 2023 | [contest](https://codehawks.cyfrin.io/c/2023-07-escrow) | A blacklisted arbiter or buyer blocks payout; a zero arbiter; fee-on-transfer tokens. Only some submissions were read |
| Optimism fault proofs | Sherlock contest | Mar–Apr 2024 | [issue 208](https://github.com/sherlock-audit/2024-02-optimism-2024-judging/issues/208) | A chess-clock race: a last-second move resolved one second later |
| ERC-8183 (Agentic Commerce) | **no audit found** | n/a | [EIP-8183](https://eips.ethereum.org/EIPS/eip-8183); [thread](https://ethereum-magicians.org/t/erc-8183-agentic-commerce/27902) | Forum posts 61–63 and 384: `claimRefund` races the evaluator. Post 103: the evaluator is the client |
| Circle Refund Protocol (USDC escrow with an arbiter) | **unaudited, per its README** | n/a | [circlefin/refund-protocol](https://github.com/circlefin/refund-protocol) | Its own notice: an arbiter can drain other users' payments |

No public audit was found for Kleros Escrow (MultipleArbitrableTransaction), Kleros v1, Smart Invoice, LexLocker, or any ERC-8183 implementation. That records a search, not proof that none exists.

### 2.3 Streaming and payment escrow

| Project and scope | Auditor | Date | Link | Relevance |
| --- | --- | --- | --- | --- |
| Sablier Lockup v1.0, `8bd57e` | Cantina: Zach Obront, RustyRabbit, Taek Lee | 20–29 Mar 2023 | [Sablier audits](https://github.com/sablier-labs/audits) (`lockup/v1.0/20230608_cantina.pdf`) | **High** 3.2.1: a recipient blocks the sender's cancel by routing the payout to an address that reverts. 3.1.1: unchecked math |
| Sablier v2 core and periphery | Cantina: Zach Obront, RustyRabbit | Jul 2023 | [report](https://cdn.cantina.xyz/reports/cantina_sablier_jul2023.pdf) | High 3.2.3: a Permit2 signature that does not name its target is front-run |
| Sablier Lockup v1.2 | CodeHawks contest | May 2024 | same index (`lockup/v1.2/20240615_codehawk.md`) | M-03: a caller starves hooks with gas. L-06: a paused token blocks cancel |
| Sablier Flow v1.0, `fbf6ff59` | Cantina: Zach Obront, RustyRabbit | Oct 2024 | same index (`flow/v1.0/20241020_cantina.pdf`) | High 3.1.1: an overflow bricks a stream. 3.3.5: rounding on each withdraw |
| Sablier Lockup 2.0, `b3ea1222` | Cantina: Eric Wang, RustyRabbit | Jan 2025 | same index (`lockup/v2.0/20250112_cantina.pdf`) | 3.1.1: `>=` where `>` was meant. 3.1.2: a uint40 overflow |
| Superfluid core v1.0 | PeckShield | 9 Feb 2021 | [Superfluid audits](https://github.com/superfluid-org/protocol-monorepo/tree/dev/packages/ethereum-contracts/audits) | PVE-001 unchecked returns; PVE-003 rebasing tokens |
| Superfluid GDA | Trail of Bits | 15 Dec 2023 | same folder | TOB-6: an off-by-one in a 63/64 gas check |
| Superfluid yield backends | Sherlock collaborative audit | 27 Jan 2026 | same folder | M-2: 1-wei rounding drains; M-3: a donation DoS |
| LlamaPay v1.0 | PeckShield | 21 Jun 2022 | [LlamaPay audits](https://github.com/LlamaPay/llamapay/tree/master/audits) | Two low findings only |
| Coinbase Spend Permissions | Cantina (managed and competition) | Oct 2024 – Jan 2025 | [spend-permissions audits](https://github.com/coinbase/spend-permissions/tree/main/audits) | Critical 3.1.1: an ERC-6492 path drains wallets. Low 3.1.6: a codeless token "succeeds" |
| Maple Syrup router (`depositWithPermit`) | Three Sigma | May 2024 | [report](https://cdn.sanity.io/files/qoqld077/staging/2dff5ae27cad42567b64682d00b79c9a53b62356.pdf) | A front-run permit blocks the deposit |
| Hedgey lockup plans | Resonance Security | 20 Jun 2024 | [report](https://raw.githubusercontent.com/hedgey-finance/Locked_VestingTokenPlans/master/audits/Audit_Report_HDGY-LKP_FINAL_20.pdf) | A signature that does not cover the full set; self-combination deletes funds |
| Request Network ERC-20 contracts | Hacken (per a search result) | Apr 2022 | [hacken.io](https://hacken.io/audits/request-network) | **Unverified** (HTTP 403). No audit found for its escrow or its CPP wrapper |

### 2.4 BLS12-381 verifiers and EIP-2537

**No published audit covers a Solidity verifier of drand on EIP-2537.**
- The two public EVM verifiers both say they are unaudited: [randa-mu/bls-solidity](https://github.com/randa-mu/bls-solidity) and drand's own [August 2025 proof of concept](https://docs.drand.love/blog/2025/08/26/verifying-bls12-on-ethereum).
- So `DrandQuicknetBeacon` is checked against audits of the layers beneath it and against the EIP-2537 test suite.

| Project and scope | Auditor | Date | Link | Relevance |
| --- | --- | --- | --- | --- |
| `blst` at `414ac6b` (BLS12-381, hash-to-curve) | NCC Group, for the Ethereum Foundation | 20 Jan 2021 | [mirror](https://pentestreports.com/files/reports/nccgroup/NCC_Group_EthereumFoundation_ETHF002_Report_2021-01-20_v1.0.pdf) (NCC's own page redirected; unverified) | ETHF002-004: wrong-length input accepted. -007, -013, -019: missing public-key and subgroup validation |
| `gnark-crypto` at `450e020` | Kudelski Security | 20 Oct 2022 | [report](https://github.com/consensys/gnark/blob/master/audits/2022-10%20-%20Kudelski%20-%20gnark-crypto.pdf) | KS-SBCF-O-01: the pairing assumes its inputs were subgroup-checked |
| Anza `solana-bls-signatures` and `bls12-381-syscall` (EIP-2537 semantics) | Least Authority | 22 May 2026 | [report](https://leastauthority.com/anza-technologies-bls-signature-crate-updated-final-audit-report/) | G1 add does no subgroup check (rename suggested). Test against `ethereum/bls12-381-tests` |
| randa-mu `bls-solidity` (BN254 scheme only) | zkSecurity | 19 Sep 2025 | [report](https://reports.zksecurity.xyz/reports/randa-mu-onlyswaps.md) | Not the BLS12-381 path; nothing on subgroup or encoding |
| EIP-2537 consensus bug (pairing with an infinity input; geth and Nethermind differed) | EF security, from the Pectra audit competition | 28 Feb 2025 | [thread](https://ethereum-magicians.org/t/bls12-381-pairing-consensus-issue/23019) | The spec was ambiguous; client behaviour on edge inputs differs |
| EIP-2537 precompile tests | Ethereum execution-spec-tests | 2025 | [EEST eip2537](https://github.com/ethereum/execution-spec-tests/tree/main/tests/prague/eip2537_bls_12_381_precompiles) | `p1_not_in_subgroup`, field elements above p, and MAP inputs at or above p |
| drand daemon v1.0 | Sigma Prime | 2020 | [announcement](https://docs.drand.love/blog/2020/08/10/drand-launches-v1.0) (report link not opened: unverified) | The beacon network, not on-chain verification |

Further unverified sources are in the research notes:
- Zellic on Radix's missing subgroup check (HTTP 403);
- the Cantina Pectra competition pages (404);
- the Telepathy, Linea and zkSync verifier audits, which cover BN254 or SNARKs.

### 2.5 0xSplits (Rafa's request: "they probably have some basic mechanics we can leverage")

| Project and scope | Auditor | Date | Link | Relevance |
| --- | --- | --- | --- | --- |
| SplitMain v1 (`splits-contracts`) at `eb909d91` | Macro (0xMacro) | 24 Jan – 7 Feb 2022 | [0xSplits_A-1.pdf](https://github.com/0xSplits/splits-contracts/blob/main/audit/0xSplits_A-1.pdf) | M-01: fee-on-transfer tokens credited at nominal |
| Splits v2 (SplitsWarehouse ERC-6909, SplitWalletV2, Push/PullSplit, factory) at `9dde20f6`, final `740abb43` (tag `splits-v2.0`) | Zach Obront | Feb 2024 (the header prints 2023; the commit dates are 2024) | [splits-v2.md](https://github.com/0xSplits/splits-contracts-monorepo/blob/main/audits/splits-v2.md) | H-01: an incentive drain through permissionless withdraw and deposit. H-02: ownership spoofed through `execCalls`. M-01: too many recipients lock funds. M-02: pro-rata rounding favours the majority. L-01: allocation overflow |
| Swapper, Pass-Through Wallet, UniV3 Oracle, Diversifier, Utils | Sherlock contest (lead: obront) | 19–24 Apr 2023 | [Splits_Audit_Report.pdf](https://github.com/0xSplits/splits-pass-through-wallet/blob/main/audits/Splits_Audit_Report.pdf); [judging](https://github.com/sherlock-audit/2023-04-splits-judging) | Swapper callback validation (M-1); oracle rounding (M-2, M-3). Owned modules |
| Chainlink oracle and L2 deployments | Zach Obront | 27–29 Nov 2023 | [report](https://github.com/0xSplits/splits-oracle/blob/main/audits/Splits_Chainlink_Oracle_Audit_Report.md) | Oracle pricing only |
| Smart Vaults (ERC-4337 accounts) | Riley Holterhus; MiloTruck | Aug 2024; Oct 2025 | [first](https://github.com/0xSplits/splits-contracts-monorepo/blob/main/audits/smartVaults-first.pdf), [second](https://github.com/0xSplits/splits-contracts-monorepo/blob/main/audits/smartVaults-second.pdf) | Low and informational findings only; not splits custody |
| Waterfall, Vesting, Liquid Splits, Recoup | **no audit found** | n/a | repositories under [github.com/0xSplits](https://github.com/0xSplits) | No audit folder or mention |
| Splits v2.1 (Dec 2024) and v2.2 (Jul 2025), the docs' default addresses | **no audit published for these changes** | n/a | monorepo PRs #55 and #65 | Small changes to the factory, PullSplit and the wallet |

[measured: each report read in full except where its row says otherwise; the v2.1 and v2.2 changes were read from their PR diffs.] The licence is GPL-3.0-or-later. Splits' bug bounty excludes Sepolia deployments.

## 3. Class-by-class results

Results:
- **pass**: the class does not apply, with evidence.
- **fail**: a finding in section 4.
- **fixed**: a T-206 finding whose fix PR has merged to `main` (#122 before `43479c7`; #120, #125 and #127 after).
- **open**: a T-206 finding still to fix.
- **info**: an informational item in section 4.4.
- **n/a**: not applicable to USDC or to our configuration.

### 3.1 Signatures and replay

| # | Class | Seen in | Result | Evidence |
| --- | --- | --- | --- | --- |
| S1 | Cross-chain replay; domain cached at deploy | Ackee Solady W2; general | pass | Solady rebuilds the separator when `chainid` or `address(this)` changes (`solady/src/utils/EIP712.sol:199-206`). `test_defense_signaturesFromAnotherChainId_refused` [measured] |
| S2 | Replay across deployments, deals and roles | UMA Early Resolver #6; UMA Phase 1 H01 | pass | T-206 S1, S4 [measured there] |
| S3 | ECDSA malleability (high-s, 64-byte twins) | Permit2 ChainSecurity note 7.2 | pass | Solady does not reject high-s (`SignatureCheckerLib.sol:23`). No signature is used as an identifier, and the stage machine refuses replays (T-206 S7, `invariant_settleOnce`) [measured, inferred] |
| S4 | Zero signer, failed `ecrecover` | Solady audits | pass | `SignatureCheckerLib.sol:85, 104-105`; T-206 S6 [measured] |
| S5 | ERC-1271 replay across one owner's accounts (the class ERC-7739 fixes) | CPP Cantina 2 3.3.2 | pass | Every Crow struct binds the signer: the commitment ID hashes the buyer, the seller and the adjudicators (`HoldbackTypes.sol:266-289`). Agree, EarlyAccept, Decision and Appeal carry the signer's address. `salt = id` binds the buyer into CPP's payer-agnostic nonce (`HoldbackRules.sol:182`). With two wallets sharing one owner key, `Erc1271Replay.t.sol` refuses wallet A's Permit2 signature, ERC-3009 signature and Agree for wallet B [measured] |
| S6 | EIP-7702 delegated EOAs and ERC-1271 accounts | Spearbit Solady 5.6.11 | info | On chain, T-206 I-4. Off chain, the API recovers with ECDSA only, so it disagrees with the chain (PA-I3) |
| S7 | ERC-6492 prepare runs arbitrary calls | Spearbit Solady 5.1.1 (Critical); CPP Cantina 1 3.3.6; Spend Permissions 3.1.1 (Critical) | pass | The prepare call goes through `Multicall3.tryAggregate` (`ERC6492SignatureHandler.sol:55-58`), not from the collector. It runs inside CPP's guard after `agreeAndFund` and CPP have written state (`HoldbackRules.sol:208-215`; `ACE:250-252`). With the canonical Multicall3 runtime etched, `Erc6492Prepare.t.sol` measures that [measured]:<br>• every money path the prepare call tries reverts with `Reentrancy()`, and funding completes;<br>• funding a second deal from inside rolls back whole.<br>Transitions that move no money can run inside the funding transaction (PA-I4) |
| S8 | A decider-controlled field changes the seed | UMA Phase 1 H01 (commit not bound) | fixed | T-206 H-1, PR #120 |
| S9 | Commit-reveal truncated | — | open | T-206 L-4 |

### 3.2 Funding (ERC-3009, Permit2, relayers)

| # | Class | Seen in | Result | Evidence |
| --- | --- | --- | --- | --- |
| F1 | `transferWithAuthorization` front-run, on the hold | EIP-3009 security considerations; Maple 3S-Sy-L02 | pass | The collector calls `receiveWithAuthorization` (`ERC3009PaymentCollector.sol:42`), whose payee must be the caller. Its nonce is the payer-agnostic PaymentInfo hash (`:48`), and only `HoldbackRules` can call `authorize`. A copied transaction funds the identical deal, and the original reverts with `WrongStage` (`HoldbackRules.sol:199`) [measured code, inferred effect] |
| F2 | The same, on the operator-fee bundle | same | **fail** | PA-M2 [measured on local mocks] |
| F3 | Permit2 scope and nonce; old Permit2 versions | ABDK CVF-35; CPP ProtoSec 3 remark | pass | The spender is `msg.sender` (`permit2/src/libraries/PermitHash.sol:62`), and the nonce comes from the payment hash (`Permit2PaymentCollector.sol:46`). Sepolia's Permit2 is mainnet's (section 6.3) [measured] |
| F4 | A relayer swaps fields nobody signed | Maple 3S-Sy-L01; Trustless Work A05; ERC-8183 PR 7 | pass | Every term is in the commitment ID. The unsigned `f.method` is refused (T-206 S8) [measured there]. The other unsigned field is the ERC-6492 envelope around the funding signature: any relayer can add a prepare call, which gains no money path (S7) but can move the deal's stage (PA-I4) [measured] |
| F5 | Counterfactual (undeployed) smart-wallet buyer | — | info | PA-I5 |

### 3.3 State machine and deadlines

| # | Class | Seen in | Result | Evidence |
| --- | --- | --- | --- | --- |
| M1 | Double settlement, double payout | Trustless Work A09; UMA DVM 2.0; Reality.eth v3 #3 | pass | T-206 H3, `invariant_settleOnce` [measured] |
| M2 | `>=` against `>` at a boundary | Sablier Lockup 2.0 3.1.1; CPP Cantina 2 3.3.1 | pass | T-206 T2. CPP: capture needs `now < authorizationExpiry` (`ACE:277`) and reclaim `now >= authorizationExpiry` (`ACE:325`), so the two are complementary [measured] |
| M3 | A last-second action beats a timeout | Optimism issue 208; ERC-8183 posts 61–63 | fixed | T-206 M-2, PR #127 |
| M4 | Expiry before the last capture | — | open | T-206 L-6 |
| M5 | Terms or parameters change after signing | Kleros v2 M-04; UMA Asserter M1; Trustless Work A04/A05 | pass | Every field is in the commitment ID; no setter, owner or proxy (T-206 A1–A3) [measured] |
| M6 | A state with no timed exit | Aragon Court 2; CodeHawks Escrow zero arbiter; Trustless Work B06 | pass | T-206 T1, T4 [measured] |
| M7 | Stuck after an outside actor acts (the buyer's CPP reclaim) | — | fixed | T-206 M-1, PR #122 |
| M8 | Fair exchange: the key released without payment | — (Crow-specific; the formal model's `KeyOnlyWithPayment`) | fixed | T-206 H-2, PR #125 |
| M9 | The record names a different delivery than the one accepted | — | open | T-206 L-1 |
| M10 | A parameter that is already in the past when the terms are written | UMA DVM 2.0 (retroactive parameters); UMA Early Resolver #4 | **fail** | PA-L4 [measured] |

### 3.4 Reentrancy

| # | Class | Seen in | Result | Evidence |
| --- | --- | --- | --- | --- |
| R1 | Re-entrant collector or token around capture, void and refund | CPP Cantina 1 3.1.1 (Critical) | pass | Every CPP mutator is `nonReentrant` (`ACE:207, 241, 269, 304, 323, 356`). Our collectors are immutables (`HoldbackRules.sol:73-74`). State is written before every call (T-206 H4) [measured] |
| R2 | Hook tokens (ERC-777) | Sablier Lockup 1.0 3.3.3; Reality.eth v3 note | n/a | USDC has no hooks. Re-entering the vault during `deposit` nets to zero [inferred] |
| R3 | Re-entry through the ERC-6492 prepare call | CPP Cantina 1 3.3.6 | pass | S7 [measured] |

### 3.5 Tokens

| # | Class | Seen in | Result | Evidence |
| --- | --- | --- | --- | --- |
| T1 | Fee-on-transfer, rebasing | CPP ProtoSec 1 I-02; CodeHawks Escrow; Superfluid PVE-003 | pass in CPP; open in the vault | CPP checks the exact balance change (`ACE:424`). The vault credits nominal amounts (T-206 L-2). n/a for USDC |
| T2 | A token with no code ("phantom" deposits) | CPP Cantina 1 3.3.9; ProtoSec 3 I-02; Spend Permissions 3.1.6 | pass | Solady 0.1.1 reverts when the token has no code and returns no data (`SafeTransferLib.sol:212-216`); `test_defense_depositInATokenWithNoCode_reverts` [measured]. Two research passes repeated the older advisory against Solady; the vendored version has the check |
| T3 | Missing return value, unchecked transfer | Superfluid PVE-001; Reality.eth v2 #1; Kleros v2 M-03 | pass | Solady `SafeTransferLib` in the vault, OpenZeppelin `SafeERC20` in CPP's TokenStore. CPP bubbles a failed send up (ProtoSec 3 L-01, fixed) [measured] |
| T4 | A narrowing cast on the amount (Permit2 uint160) | ChainSecurity 6.1; ABDK CVF-26 | n/a | CPP caps amounts at uint120 before use (`ACE:180`) [measured] |
| T5 | Issuer blacklist and pause | many | out of scope | Section 5 |

### 3.6 Arithmetic

| # | Class | Seen in | Result | Evidence |
| --- | --- | --- | --- | --- |
| A1 | Rounding direction | ADR-0022; Sablier Flow 3.3.5 | pass | T-206 H10 |
| A2 | A per-call minimum fee rounds to zero | CPP ProtoSec 1 M-01; Cantina PR 90 3.1.2; Sablier Flow contest L-02 | n/a | `minFeeBps = 0` (`HoldbackRules.sol:179`) |
| A3 | PR 90's fee bounds with `maxFeeBps = 10000` | Cantina PR 90 | pass | `maxFee = amount` exactly (`ACE:518`), so fee-only captures are valid and never touch the seller (`ACE:471`). `amount * maxFeeBps` cannot overflow, because `amount` is at most 2^120 (`ACE:180`). `fuzz/Postings.fuzz.t.sol` [measured] |
| A4 | Narrowing casts, overflow | Sablier Flow 3.1.1; Lockup 2.0 3.1.2 | pass | `Unrepresentable` (`HoldbackRules.sol:167-169`); uint96 appeal bond (`HoldbackBonds.sol:96`); uint40 timestamps [measured] |
| A5 | Unbounded loops | UMA Phase 1 L11 | pass | `_payOut` and `mutualHash` loop only over payouts both parties signed [measured] |

### 3.7 Bonds and dispute economics

| # | Class | Seen in | Result | Evidence |
| --- | --- | --- | --- | --- |
| B1 | Bond accounting drift, double release | Kleros v2 H-01, M-02; UMA bridge H01 | pass | `invariant_encumberedNotDoubleCounted`, `invariant_bondsNeverNegative` (T-206 H2) [measured] |
| B2 | Locking a third party's collateral without its consent | Trustless Work B06 (the resolver should consent); ADR-0016's own context | fixed | PA-M1 [measured at `43479c7`]; T-206 M-3, PR #135 (merged) |
| B3 | Zero or missing bond | UMA bridge M05; UMA Asserter L5; Kleros v2 M-08 | open | T-206 L-3 |
| B4 | An uncovered decider still decides | — | fixed for the fallback; open for the appeal adjudicator | T-206 L-5. PR #135 makes the fallback reserve its bond to decide; the appeal adjudicator's part is T-212 item 5 |
| B5 | Role capture (evaluator is the client, buyer-chosen arbiter) | ERC-8183 posts 103 and 384; CodeHawks Escrow | n/a by design | The parties choose and sign the adjudicators (D31, D32), and every stage has a timed exit |
| B6 | The caller chooses the fee address | Trustless Work A01 | pass | T-206 H11 |
| B7 | The winning party takes the single appeal slot | Kleros v2 M-08 (appeal funding per side); UMA (only the disputer bonds) | **fail** | PA-L3 [measured] |

### 3.8 Randomness, admin and operators

| # | Class | Seen in | Result | Evidence |
| --- | --- | --- | --- | --- |
| X1 | Re-rollable or miner-biased randomness | Aragon Court 2, 3; Kleros v2 H-02 | pass | Rounds are fixed by state and proven by BLS (T-206 T5). Timing caveat: T-206 I-5. BLS specifics in section 7 |
| X2 | Admin keys, pause, upgrade, governor powers | Aragon Court 1; UMA DVM 2.0 #5, #7; UMA bridge M06 | pass | T-206 A1–A7 |
| X3 | CPP operators are fully trusted (100% fee to any address) | CPP Cantina 2 3.3.5; Cantina 1 3.3.3 | pass, through our code only | PA-I1 |
| X4 | Event and ABI drift for indexers | Cantina PR 90 3.1.3; ProtoSec 3 I-09 | info | PA-I6 |

### 3.9 Distribution (from the 0xSplits audits)

| # | Class | Seen in | Result | Evidence |
| --- | --- | --- | --- | --- |
| P1 | Pro-rata rounding lets the majority take minority shares | Splits v2 M-02 | n/a | No pro-rata division: payouts are exact integer amounts that must sum to the price (`HoldbackRules.sol:447, 458`). The only rate split, `Money.split(fee, 0)`, rounds as ADR-0022 names [measured] |
| P2 | Too many recipients exceed the block gas limit and lock funds | Splits v2 M-01 | pass | Payouts are bounded by what both parties signed, so an oversized list only makes its own settlement unprocessable; the decision and timeout paths still close the deal (A5) [inferred] |
| P3 | One reverting push reverts a whole distribution | PushSplit design; Splits v1 pull ledger | pass | A mutual payout to an address that reverts blocks only that co-signed settlement (T-206 I-9). Decisions and timeouts pay only the buyer, the seller and the decider, who are fixed in the terms [inferred]. The token-issuer case is out of scope (section 5) |
| P4 | A controller or owner changes a split; ownership spoofed through `execCalls` | Splits v2 H-02 | pass | No owner and no mutable configuration (T-206 A1–A3) |
| P5 | Keeper incentives drained through permissionless withdraw and deposit | Splits v2 H-01, L-02 | n/a | No keeper incentive, and no deposit on behalf of someone else (`HoldbackBonds.deposit` credits `msg.sender`) [measured] |
| P6 | Fee-on-transfer tokens credited at nominal | Splits v1 M-01 | open in the vault | T1; T-206 L-2. n/a for USDC |
| P7 | Re-entrancy on distribute | — (no finding; Splits has no guard and burns before transfer) | pass | R1 |
| P8 | Allocation overflow | Splits v2 L-01 | pass | Checked arithmetic, and the total must equal the price (`HoldbackRules.sol:448, 458`) [measured] |

## 4. Findings

| ID | Severity | Finding | Litmus test | Label | Status |
| --- | --- | --- | --- | --- | --- |
| PA-M1 | medium | A sham deal locks a fallback's or appeal adjudicator's bond without its signature | neutrality (ADR-0016 §1) | measured | fixed: T-206 M-3, PR #135 (merged) |
| PA-M2 | medium | Front-running the operator-fee bundle stops funding through that node | neutrality (liveness) | measured on local mocks; inferred for Sepolia USDC | ADR-0023 residual; the adapter fix is in PR #138 (open) |
| PA-L1 | low | The beacon's pairing gas cap is fixed forever | judgment (fallback seeds) | inferred | Only for chains other than Ethereum; section 7 |
| PA-L2 | low | Fusaka raised the beacon's gas cost; ADR-0018's figures are stale | none (cost) | measured in the research pass | Update after the Sepolia smoke test; section 7 |
| PA-L3 | low now; medium once Phase 4 pays from bonds | The winning party takes the single appeal slot for free | judgment (appeals) | measured | T-206 L-7 (PR #128), T-212 item 7; section 4.3 |
| PA-L4 | low | A `judgeBy` before funding makes the fallback seed known and grindable | judgment (commit-reveal) | measured | T-206 L-8 (PR #128), T-212 item 8; section 4.3 |
| PA-I1 to PA-I10 | info | Sections 4.4 and 7 | | | |

**Severity disagreement.** The red-team pass rates PA-M2 low: the fee goes where the buyer signed it, and the commitment still settles by direct submission. The reviewer and this review keep it medium, because the demo's main funding path breaks for anyone a griefer targets until the fix lands.

### 4.1 PA-M1. A sham deal locks a fallback's or appeal adjudicator's bond

- **Seen in:** audits of escrow and staking contracts in which one party's action locks another party's collateral. Trustless Work B06 asks that a dispute resolver consent before funding. ADR-0016 names this attack itself: "lock a victim adjudicator's bond with sham commitments".
- **What ADR-0016 says:**
  - §1: "Sham commitments cannot lock a bond the adjudicator never reserved."
  - The fallback and appeal adjudicators' bond "is reserved only when they take a case".
- **What the code does:**
  - `triggerFallback`, which anyone may call at `judgeBy`, reserves the fallback's bond (`HoldbackRules.sol:529`).
  - The primary's escalation reserves the appeal adjudicator's bond (`:304`).
  - Neither adjudicator signs anything. Only the primary signs an acceptance (`:204`).
- **Attack:**
  1. One actor holds the buyer, seller and primary keys and names a bonded victim as fallback or appeal adjudicator.
  2. The price equals the victim's free bond. `fallbackBy` or `appealDecideSec` is set a century away, which D31 allows.
  3. The primary stays silent and anyone triggers the fallback, or the primary escalates.
- **Effect:**
  - The victim's free bond drops to 0. It cannot withdraw, and `agreeAndFund` naming it as primary reverts with `InsufficientFreeBond`.
  - The cost is the attacker's own capital: through the fallback, 2 × price (the hold plus its primary bond); through an escalation, only the hold, because the escalation releases the primary's bond (`HoldbackRules.sol:303`). That is nearly free on Sepolia with faucet USDC, so the demo's adjudicators can be taken offline.
  - The attacker can release everything with a mutual settlement whenever it likes.
  - The victim escapes only by signing decisions on a deal it never accepted. As fallback it can escalate, which moves the lock to the appeal adjudicator.
  - No funds move or are lost.
- **Proof** [measured], in `contracts/test/crosscheck/BondGriefing.t.sol` at `ac7e5a1`:
  - `test_attack_shamDeal_triggerFallbackLocksTheNamedFallbacksBond`;
  - `test_attack_shamEscalation_locksTheNamedAppealAdjudicatorsBond`;
  - `test_defense_fallbackEscapesByEscalating_lockMovesToTheAppealAdjudicator`.

  PR #135 carries them as regression tests in `contracts/test/unit/BondConsent.t.sol`, flipped and renamed (`test_shamDeal_triggerFallbackReservesNothing`, `test_shamEscalation_reservesNothingForTheAppealAdjudicator`).
- **Fix** (T-206 M-3, PR #135):
  - `triggerFallback` reserves nothing.
  - The fallback's own accept or reject reserves its bond with `encumber`, so an uncovered fallback cannot decide and the deal defaults at `fallbackBy`, as ADR-0016 says. This also closes T-206 L-5 for the fallback.
  - An escalation no longer reserves the appeal adjudicator's bond. Its decision is final and settles in the same transaction, so a reservation protects no one until Phase 4.
- **Red-team check of PR #135** [inferred from its diff]: the fix holds. A fallback that withdrew its bond cannot decide, because its `encumber` reverts, and no flag path around an escalation strands or double-counts a bond. Residuals to record:
  - The appeal adjudicator still decides uncovered after an escalation, while ADR-0016 §1 says the case should default. A `freeOf >= price` check in that decision closes it; otherwise amend the ADR.
  - An uncovered fallback may still escalate (PR #135 tests this deliberately). Same sentence of ADR-0016.
  - Consent now happens at the decision. So the reference fallback service must read `appealWindowSec` and `appealDecideSec` before signing, because deciding locks its own bond for those windows.
  - Phase 4 needs an appeal-side reservation again once bonds pay out.

### 4.2 PA-M2. The operator-fee bundle can be front-run

- **Seen in:**
  - EIP-3009's security considerations: a contract that calls `transferWithAuthorization` can be front-run with the same authorization, and `receiveWithAuthorization` is the remedy.
  - Maple 3S-Sy-L02 and Sablier's Permit2 finding, the same class for permits.
- **Where:**
  - `packages/settlement/evm/evm-settlement.ts:659-676` sends Multicall3 `aggregate3` with two calls, both `allowFailure: false`: USDC `transferWithAuthorization` (buyer to operator) and `agreeAndFund`.
  - The fee nonce is fixed per commitment, `keccak256(abi.encode(id, "operator_fee"))` (`encode.ts:250`).
- **Attack:** a mempool watcher submits the fee leg alone.
  - The fee is paid exactly as the buyer signed it.
  - The bundle reverts on the spent nonce, and so does every retry, because the nonce cannot change for this commitment.
  - The node then answers 402 to an agree without the fee, so the buyer has paid the fee and received no relay.
  - Another node that charges a fee fails the same way, because the fee nonce is the same on every node (`evm-settlement.ts:658`) [inferred]. The buyer can fund only through a node that relays without a fee, or by direct submission (ADR-0005), which still works.
  - The griefer gains nothing and pays only gas.
- **Already known:** ADR-0023's EVM amendment lists this residual and says "the operator relays `agreeAndFund` alone". On `43479c7` nothing implements that.
- **Proof** (`contracts/test/crosscheck/OperatorFeeFrontRun.t.sol`):
  - `test_naiveBundle_feeLegFrontRun_revertsEveryRetry_fundingAloneWorks`, with control `test_bundle_fundsAndPaysTheFee`, pins the on-chain property: once the fee nonce is spent, the bundle reverts on every retry, and funding alone still works.
  - Measured with `LocalUSDC` and `LocalMulticall3`; inferred for Sepolia USDC, whose `transferWithAuthorization` has the same open caller.
  - These tests keep passing after the fix, because the fix is in the adapter.
- **Fix,** in the Sepolia demo lane, PR #138.
  - **What it does:** the adapter simulates the fee `transferWithAuthorization`, and on a `nonce_reused` revert relays `agreeAndFund` alone and records the fee as paid. It reads neither state nor events. Its test, "operator fee relayed alone ahead of the bundle: the hold still funds, and the fee is paid once", is in `evm-settlement.test.ts`.
  - **The gap:** FiatToken reverts the same way, and sets the same `authorizationState`, for an authorization the buyer cancelled. A detection by revert or state alone therefore lets a buyer who cancels first get the relay free.
    - Confirm payment by the `AuthorizationUsed` event for (buyer, fee nonce), or by the fee recipient's balance change.
    - Low: the node loses its fee, and the buyer could have submitted directly for free.
    - Flagged to the demo lane [inferred for FiatToken].
  - **Local mocks:** `LocalUSDC.authorizationState` reads only the `receiveWithAuthorization` map, so after a front-run it reports the fee nonce as unspent. `test_attack_feeNonceSpent_butLocalUsdcAuthorizationStateSaysUnspent` pins this [measured]. PR #138's new `TestUSDC` shares one nonce map, so the used case is testable there. Neither mock has `cancelAuthorization`, so the cancel race has no regression test yet.
  - Sending the fee leg as its own transaction first would re-create the non-atomic design ADR-0023 rejected.
  - A `receiveWithAuthorization` fee works only if the relaying account is itself the fee recipient (a smart-account batch).

### 4.3 Low findings from the red-team pass

**PA-L3. The winning party takes the single appeal slot** (low now; medium once Phase 4 pays from bonds).
- **Seen in:** Kleros v2 M-08 (appeal funding per side) and UMA, where only the disputer bonds. Here the slot is shared and first-come.
- **Where:** `fileAppeal` (`HoldbackRules.sol:484-497`). Either party may appeal any first-instance outcome (`:490-491`). One appeal per commitment: `:488` refuses once `Open`. A zero bond needs no allowance (T-206 L-3).
- **Attack:**
  1. The primary accepts.
  2. In the same block, the seller files a zero-bond appeal against its own win.
  3. The buyer's bonded appeal reverts with `WrongAppealState(Open)`.
  4. The appeal expires undecided, and the accept stands.

  After a reject, the refunded buyer can do the same to the seller.
- **Effect:**
  - Today an appeal moves only the appellant's own bond (T-206 I-8), so the loser loses its record and its right of appeal. The free appeal also extends the decider's bond lock by `appealDecideSec`.
  - Once Phase 4 pays overturns from the decider's bond, this lets the winner foreclose the loser's remedy for free, and B5's "n/a by design" stops holding.
- **Proof** (`contracts/test/crosscheck/AppealSlot.t.sol`) [measured]:
  - `test_attack_winnerFilesAZeroBondAppeal_loserCannotAppeal`;
  - `test_attack_afterReject_refundedBuyerBlocksTheSellersAppeal`;
  - `test_attack_zeroBondAppealExtendsTheDecidersLock`.
- **Fix:** admit an appeal only from the party the decision went against, or give each party its own slot. Close L-3 (a bond above zero, or the rulebook rate) with Phase 4.

**PA-L4. A `judgeBy` before funding makes the fallback seed known and grindable** (low; direct submission only).
- **Seen in:** retroactive-parameter findings in UMA DVM 2.0 and the UMA Early Resolver (#4: the first proposer fixes the settings). X1 checked that rounds are fixed by state, not that the state value could already be in the past.
- **Where:**
  - The fallback's round is `BEACON.roundAt(t.timing.judgeBy)` (`HoldbackRules.sol:255-258`).
  - `agreeAndFund` checks only `offerExpiresAt` and `fundBy` against the clock (`:200`).
- **Attack:**
  1. Whoever writes the terms sets `judgeBy` in the past, which D31 admits.
  2. The beacon value for that round is already public, so `panelSeed(id, fallback, 1, value)` is a pure function of the terms.
  3. The author grinds `nonce` until the panel suits it; a 1-in-256 property took a few hundred tries in the proof.
  4. The primary can never decide, and the fallback can be triggered in the funding block.
- **Mitigation already in place:** the reference parser requires `fundBy < judgeBy` (`packages/core/src/timing.ts:24-35`). So this shape reaches the chain only by direct submission with the buyer's own signature (D32).
- **Proof** (`contracts/test/crosscheck/KnownSeedFallback.t.sol`) [measured]:
  - `test_attack_judgeByInThePast_fallbackSeedIsKnownBeforeFunding`;
  - `test_attack_judgeByInThePast_termsAuthorGrindsTheFallbackSeed`;
  - control `test_defense_judgeByInTheFuture_seedUnknownAtSigning`.
- **Fix:**
  - Refuse funding when `block.timestamp >= t.timing.judgeBy`. One line, and defensible under D31 as self-contradictory: an adjudicator would have accepted a case it can never judge. It also closes the D31 shape behind T-206 L-6 for the primary.
  - Otherwise, record it as an ADR-0018 residual and a buyer-side check.

### 4.4 Informational

- **PA-I1. Only our code protects the buyer.**
  - Under `maxFeeBps = 10000` and `feeReceiver = 0`, CPP lets the operator capture the whole hold to any address before `authorizationExpiry` (Cantina 2 3.3.5).
  - One TokenStore holds every deal of a rules contract.
  - So a bug in `HoldbackRules` is a bug for every open deal at once. ADR-0003 chose this deliberately; the mainnet external audit should be scoped with it in mind [inferred].
- **PA-I2. Deployment.**
  - CPP v1.1.0 is deployed only on Base and Base Sepolia, and v1.0.0 has the old `feeBps` ABI. So Ethereum Sepolia needs its own escrow and collectors [measured from the CPP README].
  - Our foundry profile (`via_ir`, `prague`, 200 runs) compiles CPP differently from CPP's deploy profile (`cancun`, 100,000 runs). The source is the audited source, but its bytecode will not match Coinbase's deployments; record the settings in `deployments/sepolia.json` [measured from both `foundry.toml` files].
  - Multicall3 is unaudited and its deployer key is compromised (only the Ancient8 deployment is known bad), so assert its code hash at deploy (section 6.3).
- **PA-I3. The API and the chain disagree on smart-account signers.**
  - The API recovers every signature with ECDSA (`packages/core/src/eip712.ts:523-531`).
  - The chain sends any address with code, EIP-7702-delegated EOAs included, to ERC-1271 only (`SignatureCheckerLib.sol:90`).
  - So the API accepts a delegated EOA's ECDSA signature that the chain then refuses, and refuses a smart account the chain would accept [measured code, inferred effect]. Complements T-206 I-4.
- **PA-I4. The ERC-6492 prepare call can move a deal's stage inside its funding transaction** [measured].
  - The envelope is an unsigned field, so any relayer can add one.
  - The prepare call sees the deal `Held`, the primary's bond encumbered and CPP's state written, but the token store still empty.
  - It cannot reach money (S7). It can run `deliver`, `triggerFallback` or an escalation, given the needed signatures, so the deal lands in `Delivered` or `Escalated` in the same transaction. `JobSubmitted` is then logged before the buyer's tokens move.
  - The EVM adapter mirrors one event per call, so it should reconcile from `dealOf(id)` after a funding receipt rather than assume `Held`.
  - Locally, the collectors use `LocalMulticall3`, which has no `tryAggregate` (`contracts/script/LocalMulticall3.sol`; `packages/settlement/evm/world.ts:198-200`). So a wrapped signature reverts on anvil; `test_defense_withoutMulticall3Code_onlyWrappedSignaturesRevert` shows the same with no code.
  - Proofs: `contracts/test/crosscheck/Erc6492Prepare.t.sol`, which etches the canonical Multicall3 runtime.
- **PA-I5. An undeployed smart-wallet buyer cannot fund.** `agreeAndFund` checks the buyer's Agree with Solady (no ERC-6492) at `HoldbackRules.sol:205`, before the collector could deploy the wallet. Buyers deploy first; the agent docs should say so [inferred].
- **PA-I6. Indexers.** The commitment ID is domain-free (ADR-0016), so a watcher keys on chain ID, rules address and ID, not on `jobId` alone. CPP v1.1.0 changed `PaymentCaptured`'s topic0 (Cantina PR 90 3.1.3) [measured].
- **PA-I7. Relayers.** Never route `HoldbackBonds.deposit`, `withdraw` or an approval through Multicall3. The vault would credit Multicall3, and anyone could then withdraw that credit [inferred].
- **PA-I10. The fee bundle splits the other way too** [measured]. A watcher can submit the `agreeAndFund` leg alone. The deal funds, the node's bundle reverts with `WrongStage`, and the fee is unpaid. The node can still send the fee leg until `fundBy`, unless the buyer cancels it first. So the node should watch `JobFunded` for its own commitment IDs. ADR-0023's "atomic" holds only when the bundle lands. Proof: `test_attack_copyTheFundLegAlone_dealFundsWithoutTheFee_nodeCollectsLater` (`BundleAtomicity.t.sol`).
- **PA-I8. Vendor the PR 90 audit.** Moving the CPP pin to `ff84ce2` (PR #93) or later picks up the Cantina PR 90 report and the corrected `docs/Fees.md` (`9436713`). `src/` is byte-identical [measured].

## 5. Out of scope (Rafa, 2026-11-03)

**The token issuer's freeze, blacklist and pause.** This is a recurring class in the audits above:
- CPP Cantina 1 3.2.1 and Cantina 2 3.1.1, CPP `docs/Security.md` ("Denial of service due to denylists");
- Sablier Lockup 1.0 3.2.1 and the Lockup v1.2 contest L-06;
- the CodeHawks Escrow submissions.

It is not a finding here:
- The parties choose the token in their signed terms, and the agreed terms bind (D28, D32).
- Rafa parked it for a roadmap module about assets.
- `docs/neutrality.md` already lists it as residual 1.

No tests were kept for it.

## 6. CPP v1.1.0 against its audits

### 6.1 Coverage

- **Five vendored reports** (March–April 2025 reviews, covers dated May–June 2025): 1 critical (fixed), 2 medium (fixed), 8 low and the rest informational [measured].
- **One unvendored report.** The pinned commit `6b0a5ef3` has its own Cantina review (20–21 July 2026, `AuthCaptureEscrow.sol` only).
- **What is unaudited.** Apart from PR 90, the only change between the 2025 audits and v1.0.0 that no audit covered is the contract renames in PR 71.
- **Collectors and TokenStore** are unchanged since the 2025 audits.
- **No incidents.** No GitHub security advisory, open issue or public incident report was found for CPP [measured; an absence of reports, not a proof].

### 6.2 PR 90 under our usage

- **Fee-only capture** (`feeAmount == amount`, our reject path, an early accept's price leg uses fee 0): valid, and the receiver leg is skipped (`ACE:471`).
- **Several partial captures** (`_payOut`): each is checked against its own amount (`ACE:517-521`). A nonzero fee to `address(0)` reverts with `ZeroFeeReceiver` (`ACE:524`), and we pass `address(0)` only with fee 0.
- **No rounding and no overflow** (A2, A3).
- **ABI:** v1.1.0's `capture` selector differs from v1.0.0's, so `HoldbackRules` works only against a v1.1.0 escrow, and buyer signatures do not replay between escrow instances (`ACE:385` hashes the escrow address) [measured, inferred].

### 6.3 Sepolia deploy checks (measured 2026-11-03, read-only RPC)

| Dependency | Address | Result |
| --- | --- | --- |
| USDC | proxy `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, implementation `0xDa317C1d3E835dD5F1BE459006471aCAA1289068` | The implementation's code contains `0x88b7ab63`, the bytes-signature `receiveWithAuthorization` that CPP's ERC-3009 collector calls. Etherscan names it FiatTokenV2_2 |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | 9,152 bytes, identical to mainnet's except 2 immutables: the cached chain ID (`0xaa36a7` vs `1`) and the domain separator |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | Runtime code hash `0xd5c15df6…0891`, equal to mainnet's |
| EIP-2537 precompiles (the beacon) | `0x0b`, `0x0f`, `0x10` | Live: MAP_FP_TO_G1 answered, and a round-1000 proof verified by `eth_call` with a state override, against a public Sepolia node (section 7) [measured] |
| EIP-1153 (CPP's transient guard) | n/a | Sepolia activated Dencun [inferred from public fork history; not checked] |

## 7. DrandQuicknetBeacon against BLS work

**Bottom line.** The beacon passes every pitfall the audits and the EIP-2537 test suite name. No earlier review of a Solidity drand quicknet verifier was found, so ADR-0018's pre-mainnet review stays open. Two gas findings are low.

The research pass measured its checks in three ways:
- on the compiled bytecode, on a Prague anvil, a Cancun anvil and a public Sepolia node, with read-only calls and state overrides;
- against noble-curves, with 6,000 decoder cases and no disagreement;
- by reading the code.

Those runs are "measured in the research pass": their scripts are in the session scratchpad and are not committed. In the table below, D1, D2, D3 and D4 cite committed tests. D5's 200 noble messages, D6's check against noble, D8's Cancun anvil run, D10's G2 check, PA-L2's gas figures and PA-I9's two-client check are research-pass measurements.

| # | Pitfall (source) | Result | Evidence |
| --- | --- | --- | --- |
| D1 | Two encodings of one signature, giving two seeds (randomness is `sha256` of the bytes) | pass | The flags must be compressed and not infinity (`DrandQuicknetBeacon.sol:123`), and x must be below p (`:124-126`). y is derived, so the only freedom is the sign bit, which gives P or -P, and -P fails the pairing. On every fixture round (7), exactly one of the eight flag encodings verifies: `test_defense_everyFixtureRound_exactlyOneOfEightFlagEncodingsVerifies` and, for round 1000, `test_defense_onlyThePublishedFlagsVerify`, beside the existing `test_refuses_theNegatedSignature` [measured] |
| D2 | A point outside G1 (NCC ETHF002-007/-019; Kudelski O-01; EEST `p1_not_in_subgroup`) | pass, by the precompile | The pairing refuses it (`:84-85`), as the existing `test_refuses_aCurvePointOutsideG1` (x = 4) shows. New tests, each of which asserts the refusal cost more than the 250k pairing cap, so the pairing, not decompression, refused it [measured]:<br>• `test_defense_validSignaturePlusAnOrder3Point_refusedByThePairing` (round 1000's signature plus the order-3 point (0, 2): on the curve, outside G1);<br>• `test_defense_order3Points_refusedByThePairing`.<br>This depends on clients implementing EIP-2537's subgroup check, which EEST tests (PA-I9) |
| D3 | Infinity as a signature | pass | The infinity flag is refused at `:123`; existing `test_refuses_malformedEncodings` [measured] |
| D4 | Non-canonical x (x ≥ p) | pass | `:126`. `test_defense_xAboveP_refusedBeforeAnyPrecompile` (x = p + 1 and 2^381 − 1, each refused for under 100k gas) plus the existing x = p test [measured] |
| D5 | DST and `expand_message_xmd` (RFC 9380 §5.3.1); drand's 2023 DST change | pass | `:23-25, :102-111`. Matches noble on 200 messages, and the repo's `test_hashToG1_matchesTheReferenceImplementation` passes [measured] |
| D6 | Cofactor clearing: the sum of two MAP outputs | pass | MAP_FP_TO_G1 clears the cofactor; clearing is linear, so `G1ADD` of the two outputs equals RFC 9380's order (`:93-96`) [measured against noble] |
| D7 | MAP input at or above p | pass | `_reduce` returns a value below p (`:114-116`) [measured] |
| D8 | Precompile missing on the chain (an empty call "succeeds") | pass | Every output length is checked (`:85, :158`). A valid proof reverts on a Cancun anvil [measured] |
| D9 | A failing precompile burns all forwarded gas | pass, with PA-L1 | The pairing is capped at 250,000 gas (`:65, :84`). A `sig + T` proof costs about 305k gas in total, whatever the transaction's limit [measured]. MAP, G1ADD and MODEXP cannot fail on any input the contract builds, because their inputs are reduced or fixed-size [inferred] |
| D10 | Rogue-key attack; key in G2 | n/a, pass | One fixed group key. The constant is in G2 and compresses to drand's published key [measured] |
| D11 | Round arithmetic, genesis and period | pass | `GENESIS` and `PERIOD` equal drand's `info`, and `roundAt` matches a live round. `roundAt` wraps only above 5.5e19, which the rules contract cannot pass, since its timing fields are uint64 and `t1`/`t2` are uint40 [measured] |

**PA-L1. The pairing gas cap is fixed forever** (low) [inferred].
- EIP-2537 prices two pairs at 102,900 gas, well under the 250,000 cap.
- A chain that reprices the pairing above the cap makes every valid proof fail permanently, because the contract has no setter. Fallback and appeal decisions would then fall to the default path.
  - Polygon's draft PIP-88 would price two pairs at 298,410.
- Ethereum Sepolia is not affected.
- Fix: before deploying on another chain, size the cap from that chain's schedule. Or derive it in the constructor (one immutable), which keeps the no-setter rule.

**PA-L2. Fusaka raised the beacon's gas cost** (low) [measured in the research pass].
- `eth_estimateGas` for `beaconValue(1000, sig)` is 213,185 on Sepolia, against 159,378 on a Prague EVM.
- The likely cause is EIP-7883's MODEXP repricing [inferred]: there are five MODEXP calls, including a 48-byte-exponent square root.
- ADR-0018's gas figures for a fallback `decide` are therefore low for Sepolia. Update them after the deployment's smoke test.

**PA-I9. A second encoding relies on clients' subgroup check** [measured on two clients].
- `sig + T` is refused on a Prague anvil and on one public Sepolia node.
- A client that skipped EIP-2537's check would accept `sig + T` and so give a second seed.
- A post-deploy smoke test (valid round, `sig + T`, wrong round: value, revert, revert) pins it per deployment.

**Tests left for later** [described in the research notes]:
- the carry and subtract branches of `_decompress` (concrete vectors, needing a harness that exposes it);
- a CI run with `evm_version = "cancun"`;
- gas bounds on an Osaka EVM;
- the Sepolia smoke test above.

## 8. Can 0xSplits simplify our payouts?

Rafa asked whether Splits' mechanics could replace custom code. This section answers per function.

Any adoption is a contract change that needs an ADR, and it comes after the Sepolia deployment.

**Constraints** applied to each option:
- **No admin keys.** Only immutable splits (owner or controller zero) qualify.
- **Neutrality.** No single party can block settlement.
- **Push against pull,** judged on liveness, gas and simplicity. Issuer blacklisting is excluded as an argument (section 5).
- **Gas.**
- **Dependency risk.** Splits is GPL-3.0-or-later. Calling its deployed contracts is fine; copying its code into this MIT repository is not. Only v2.0 is audited, the v2.1 and v2.2 changes are not, and Splits' bounty excludes Sepolia.
- **CPP's shape.** One receiver per payment, fixed when the buyer signs at funding, plus one fee receiver chosen per capture.
- **EIP-170.** `HoldbackRules` has little headroom: 161 bytes under the limit at `43479c7` [measured, `forge build --sizes`], varying with each fix (T-206 I-3).

### 8.1 How Splits works

The parts that matter here [measured from the sources and docs]:
- **Configuration.**
  - A split stores only the hash of its recipients and allocations, and every `distribute` re-passes the arrays.
  - An immutable split's address is a function of its full recipient list, so it cannot exist before the payouts are known.
- **Payment styles.**
  - Push splits transfer to every recipient in one call, and one reverting transfer reverts all of them.
  - Pull splits credit an ERC-6909 ledger (`SplitsWarehouse`) that each recipient withdraws from later.
- **Rounding.** Shares are pro-rata with floor rounding, and dust stays in the wallet.

On Ethereum Sepolia:
- v1 `SplitMain` is at `0x54E4a6014D36c381fC43b7E24A1492F556139a6F` (not the mainnet address).
- The v2 `SplitsWarehouse` is at `0x8fb66F38cF86A3d5e8768f8F1754A24A6c661Fb8`, the same as on mainnet.

Both have code there [measured by RPC].

### 8.2 Recommendation per function

| Function | Options weighed | Decision | Why | What it would remove or add |
| --- | --- | --- | --- | --- |
| **Mutual-settlement payouts** (`mutualSettle` and `_payOut`, `HoldbackRules.sol:408-478`) | (a) A per-deal immutable split as CPP's `receiver`. (b) A split owned by the rules contract and updated at settlement. (c) Copy the pattern | **Keep ours** | (a) cannot work: the receiver is fixed in the buyer's funding signature, while the split's address depends on payouts negotiated later. (b) adds a split per deal for a rare path, plus an `execCalls` and pause surface on the receiver, and a push split's all-or-nothing transfers. (c) has nothing to copy: CPP's all-fee capture is already a one-call exact split, and exact amounts that sum to the price avoid the pro-rata rounding class (P1) | (b) would remove about 18 lines (`:445-462`) and add a factory call in `agreeAndFund`, an update and a distribute: more bytes, and about 100k or more gas per deal [guessed]. A `Payout.to` may already be a Splits wallet, with no change |
| **Adjudication fee to the decider** (`_settleDecision`, `:332-347`) | A split of seller and adjudicator as the receiver | **Keep ours** | CPP's capture already pays the seller and the fee receiver in one call, and the decider (primary, fallback or appeal) is not known at funding | Would remove two lines and add a split, a call and a transfer. An adjudicator may route its own fees into a split it owns (for example, to share them with Phase 4 backers) with no protocol code; its bond then deposits through that wallet's `execCalls` |
| **Operator fee** (the relayer's Multicall3 bundle, ADR-0023) | `fees.operator.to` as a Splits wallet | **Adopt at the edge** (no Holdback code) | An operator that shares relay revenue can publish a split address as `to`, and the bundle is unchanged. Record that in ADR-0023 or `docs/operations.md`. This does not touch PA-M2 | none |
| **Appeal-bond refund** (`HoldbackBonds.payAppealBond`, `:105-116`) | (a) Credit the appellant in Splits' ERC-6909 warehouse (pull). (b) A pull ledger inside our vault | **Keep ours now; adapt the pattern (b) later if needed** | For USDC, a refund push fails only on issuer action, which is out of scope, so pull buys no liveness today. If the assets module admits tokens with transfer hooks, use (b), not the warehouse. (b) is a separate `claimable[appellant][token]` with a `claim()`: about 10 lines in `HoldbackBonds`, no `HoldbackRules` bytes, no dependency. Crediting `bondOf` instead would be shorter but would mix party refunds into the adjudicator-bond ledger and its events | (a) adds an approval, a deposit, an immutable and a third custodian (with Splits v2 H-01's incentive class around it), and a second transaction for the appellant |
| **Adjudicator bonds** (`deposit`, `withdraw`, `encumber`, `release`) | The warehouse as the bond vault | **Keep ours** | The warehouse has no "encumbered" state and keys balances by depositor, so it cannot express free against reserved bond. Our vault is already pull-on-withdraw and keyless | Adds calls, removes nothing. For Phase 4 backers (ADR-0014), ERC-6909 share accounting is worth listing as an option: the standard, not Splits' contracts |

**Summary.** Nothing in Splits removes bytes from `HoldbackRules`; every adoption inside the settlement path adds a contract, a call or a custodian. Where Splits' ideas fit, they fit at the edges with no protocol change:
- an operator, adjudicator or seller may receive into a split;
- a pull credit for appellants, if ever needed, is cheaper inside our own vault.

**Recommendation:** adopt nothing. If Rafa wants it, record the edge uses in ADR-0023 and in the Phase 4 backers ADR [inferred from the measured mechanics].

## 9. Tests and how to reproduce

New in `contracts/test/crosscheck/`; `test_attack_*` passes while the weakness exists, and `test_defense_*` passes while the defense holds:

| File | Tests | Class |
| --- | --- | --- |
| `OperatorFeeFrontRun.t.sol` | `test_naiveBundle_feeLegFrontRun_revertsEveryRetry_fundingAloneWorks`, `test_bundle_fundsAndPaysTheFee`. These pin the on-chain property the adapter works around; the adapter's own regression test is in PR #138 | F2, PA-M2 |
| `TokenAndDomain.t.sol` | `test_defense_depositInATokenWithNoCode_reverts`, `test_defense_signaturesFromAnotherChainId_refused` | T2, S1 |
| `DrandEncodings.t.sol` | `test_defense_validSignaturePlusAnOrder3Point_refusedByThePairing`, `test_defense_order3Points_refusedByThePairing`, `test_defense_xAboveP_refusedBeforeAnyPrecompile`, `test_defense_onlyThePublishedFlagsVerify` | D1, D2, D4 |
| `DrandAllRounds.t.sol` (red-team) | `test_defense_everyFixtureRound_exactlyOneOfEightFlagEncodingsVerifies` | D1 |
| `Erc6492Prepare.t.sol` (red-team) | 6 tests: no money path from the prepare call; a second funding inside rolls back; stage moves inside funding | S7, R3, F4, PA-I4 |
| `Erc1271Replay.t.sol` (red-team) | 3 tests: funding signatures and Agree do not replay across one owner's wallets | S5 |
| `AppealSlot.t.sol` (red-team) | 3 tests | B7, PA-L3 |
| `KnownSeedFallback.t.sol` (red-team) | 3 tests | M10, PA-L4 |
| `BundleAtomicity.t.sol` (red-team) | 2 tests: the fund leg copied alone; `LocalUSDC`'s nonce maps | PA-I10, PA-M2 |
| `BondGriefing.t.sol` (at `ac7e5a1`; carried, flipped, by PR #135 as `BondConsent.t.sol`) | the three PA-M1 tests | B2, PA-M1 |

```
cd contracts
forge test --match-path 'test/crosscheck/*'   # 26 passed
forge test                                    # 204 passed, with main merged at eac8287
```

Measured on this branch after merging `main` (which includes T-206's #120, #122, #125, #127 and #135): the full suite passes.

## 10. Not covered

- **Unverified sources:**
  - the Halborn USDC v2.2 report and any other FiatToken audit;
  - Request Network's Hacken report (HTTP 403);
  - a Nethermind Kleros page and a Raid Guild page.
- **Read only in part:**
  - UMA DVM 2.0 (the last few notes);
  - the CodeHawks Escrow results (5 submissions of about 500);
  - the Optimism contest results;
  - some Sablier and Spend Permissions reports (titles only).
- **The research notes** behind each table are not committed: `reports/scratch/audit-*.md`, git-ignored.
- **The cross-family review** stays T-206's open gate.
