# Audit scope

## Summary

Crow (protocol name Holdback) is escrow and verification for AI agents. It runs on Ethereum Sepolia (chain ID 11155111) with test tokens only. An audit covers the Solidity files in `contracts/src/` at the frozen commit, tagged `contracts-phase-one-1` and named by the `commit` field of [`contracts/deployments/sepolia.json`](../../contracts/deployments/sepolia.json), and how they drive Coinbase's Commerce Payments Protocol (CPP) escrow. Off-chain code holds no funds, but the components listed below shape the trust model.

Labels on this page:
- **measured:** read from the named file in this checkout, or produced by the named command;
- **documented:** stated in the repository doc this page cites;
- **inferred:** concluded from reading, not checked by a run;
- **guessed:** a judgement not checked.

Run for this page on 2026-11-12, on the lane `contracts-audit-ready` at `ba941e0`, and the file list again at `c629d06` after T-384: `git ls-tree --name-only HEAD contracts/src/` and `forge test --match-path 'test/unit/*'` (every unit test passed) [measured]. The deployment is confirmed by `deploy-sepolia.sh --check` (below), which reads the record and the chain; it passed at the cutover of 2026-11-13, from the cutover branch and from `main` [measured; the dated record is in [`operations.md`](../operations.md), the phase-one cutover]. So this page names no deployed address: each is a field of the record.

## The phase-one scope

**This page describes the phase-one contracts, the deployment an external audit reads.** [ADR-0031](../decisions/ADR-0031-phase-one-contract-scope.md) records what phase one cuts and why; Rafa decided the largest cut (D57) and its open points (D58). The contracts deployed on Sepolia today, at `64be1f1`, keep party appeals and bonds until the redeploy; they are not in phase one.

**What the phase-one contracts do.** One token per deployment. The buyer's payment address funds a hold with one ERC-3009 signature. The seller delivers. The primary adjudicator decides, or the fallback does when the primary is late; either may escalate to the appeal adjudicator. The buyer may accept early, both parties may settle between themselves, and anyone may trigger a timeout. The first decision is final.

**Cut on purpose** (each with what leaves, what stays and what a party loses in ADR-0031):

1. **Party appeals and bonds** (decided by Rafa, D57; not in phase one, SimChain keeps both). `HoldbackBonds.sol` left, with the appeal entry points and the appeal state. A wrong first decision has no remedy on chain; the loss is bounded by one deal's price and fee.
2. **Any token per deal.** A deployment serves one token, fixed at deploy as the immutable `TOKEN`; terms that name another token do not fund.
3. **Permit2 funding** (not in phase one). The hold funds by one ERC-3009 authorization through CPP's ERC-3009 collector.
4. **Payouts to third addresses** in a mutual settlement (decided by Rafa, D58). It pays the buyer's payment address and the seller's payout address only, and the event for a third-party payout left with the feature. It can return without another change to the signed terms (ADR-0033 §9).
5. **Terms that settlement does not process:** deadlines that are not strictly ordered `offerExpiresAt < fundBy < deliverBy < judgeBy < fallbackBy`; `maxSubmissions` other than 1; an escalation decision window (`appealDecideSec`) of 0; an appeal window (`appealWindowSec`) other than 0 (ADR-0033 §2b); an acceptance whose `bondReserved` is not 0. Funding also refuses, with `Unrepresentable()`, a deadline after 9999-12-31T23:59:59-23:59, an escalation window above 2^32 − 1 s, or a hold above 2^120 − 1 base units, as core does (T-380).
6. **The on-chain record of an unfunded offer's expiry** (decided by Rafa, D58; not in phase one): the entry point and the `Expired` stage left. The operators mark an unfunded offer expired by their own clock and send no transaction.

**Kept on purpose** (Rafa, 2026-11-11):

- signatures from contracts (ERC-1271) in every role, so a multisig can be a party or an adjudicator;
- the on-chain proof of the randomness beacon;
- a price of zero (D58). A deal with price 0 and a fee above 0 funds and settles through every outcome. A deal with price 0 and fee 0 cannot be funded, because the escrow refuses to hold nothing (`AuthCaptureEscrow.sol:179`). That is a stated phase-one limit: a deal must hold at least one base unit, as price or as fee. Core's phase-one profile refuses such terms at the offer (`ZERO_HOLD_PROBLEM` in `packages/core/src/state.ts`);
- the settlement for late work: in `Held`, a settlement both parties sign may name a delivery that was never posted and release its key in the same transaction as the payment (ADR-0031, SC-5b). It is the one path where a key leaves with no posted delivery. Core, ADR-0019 and the formal model allow it too (T-357).

**Added on purpose** (Rafa, 2026-11-11; D58; ADR-0033): **a payout address for the seller and a payment address for the buyer, each apart from the address that signs.** They are the escrow's receiver and payer (`_paymentInfo` in `HoldbackRules.sol`). The payment address funds the hold and receives every refund; the payout address receives every payment to the seller. Each may equal its signing address. The signed terms changed: schema v0.11, and EIP-712 domain version 0.8.

**Added with the beacon rounds** (ADR-0032; decision D66 in `docs/decisions-today.md` records how the margin reaches core, the EVM chain and the service): the fallback's panel round is the first published after `judgeBy − 1 + BEACON_MARGIN`, and an escalation's the first after the escalation's block time plus `BEACON_MARGIN`. The margin is 29 s on Ethereum mainnet and Sepolia, and 0 on a local chain.

**Assumptions that are new with phase one:**

- **The deployment's token** is a plain ERC-20 with ERC-3009: no fee on transfer, no rebasing, no transfer hook, and ERC-3009's rule that only the payee may use a receive authorization. The funding's safety against a front-run rests on that rule: with a token that broke it, anyone holding the buyer's signature could move the hold into the collector (the whole-diff review's finding I-5). The contract cannot check any of this. Whoever deploys names the token and has no authority afterwards; the parties accept it by signing under that deployment's EIP-712 domain.
- **The deployer's one-time choices are the trust anchor:** the constructor's six arguments, stored as `ESCROW`, `ERC3009_COLLECTOR`, `EXPIRY_MARGIN`, `BEACON`, `TOKEN` and `BEACON_MARGIN`. The constructor refuses a zero address for the escrow, the collector, the beacon or the token (`ZeroAddress`), and a beacon margin of 0 on any chain but the local one (`NoBeaconMargin`) [measured: the constructor; `contracts/test/unit/ConstructorChecks.t.sol`, `BeaconMargin.t.sol`]. At the freeze this page lists each value with its address and code hash (below).
- **The first decision by the primary or the fallback adjudicator is final,** and so is the appeal adjudicator's decision after an escalation. No adjudicator posts a bond. A party must trust all three adjudicators it names, because the other party can steer which one decides. The parties' protection is their choice of the three adjudicators, the fallback, the default outcome, and the signed record (ADR-0031, "Litmus tests").
- **Two signed fields hold one value on a phase-one deployment.** The acceptance's `bondReserved` must be 0, and the terms' `appealWindowSec` must be 0 (`agreeAndFund`).
- **No cut changes a signed type.** ADR-0033 changes one: the terms gain the two money addresses, the schema moves to v0.11, which also lets `appealWindowSec` be 0, and the EIP-712 domain moves to 0.8. The types still describe the full protocol, which SimChain runs; a phase-one deployment accepts a subset.

Unchanged: no owner, pause, freeze, blacklist or upgrade proxy, and no real money.

## In scope

The files of `contracts/src/` at the frozen commit [measured: `git ls-tree --name-only HEAD contracts/src/`]. Each deployed contract's address is its field in `contracts/deployments/sepolia.json`.

| Contract | Purpose | Field in `sepolia.json` |
| --- | --- | --- |
| [`HoldbackRules.sol`](../../contracts/src/HoldbackRules.sol) | The rules contract. It is the operator of CPP's `AuthCaptureEscrow`. It moves a buyer's held funds only on an adjudicator's signed decision, the buyer's signed early accept, a settlement both parties signed, or a timeout anyone may trigger. Its state-changing entry points: `agreeAndFund`, `deliver`, `decide`, `earlyAccept`, `mutualSettle`, `reclaim`, `triggerFallback`, `triggerDefault` | `rules` |
| [`HoldbackTypes.sol`](../../contracts/src/HoldbackTypes.sol) | A library: the settlement view and the EIP-712 struct hashes that `packages/core` signs. `Money` keeps only the basis-point scale: phase one has no rate arithmetic on chain | none; compiled into the rules contract [inferred] |
| [`IHoldbackRules.sol`](../../contracts/src/IHoldbackRules.sol) | The rules contract's interface, and the place for its descriptions: it declares the enums `Stage`, `Reason` and `Decider`, the struct `Deal`, and every event, error, external function and getter of `HoldbackRules`, and holds no logic. `HoldbackRules` implements it. The calldata structs stay in `HoldbackTypes`. The layout moved no byte of the runtime code (T-384, holdback PR 433) | none (interface) |
| [`IHoldbackBeacon.sol`](../../contracts/src/IHoldbackBeacon.sol) | The interface of the randomness beacon that fixes the fallback's and the escalation's panel seeds | none (interface) |
| [`DrandQuicknetBeacon.sol`](../../contracts/src/DrandQuicknetBeacon.sol) | Verifies a drand quicknet round on chain (BLS12-381, EIP-2537 precompiles). The on-chain proof stays for now (Rafa, 2026-11-11; ADR-0031, SC-8), and the question comes back with the choice of chain | `beacon` |

Relied on, not in scope: Commerce Payments' `AuthCaptureEscrow` and `ERC3009PaymentCollector`, Multicall3, Solady (below).

**The freeze record** is the record itself, so this page copies none of its values:

| Item | Where to read it |
| --- | --- |
| Frozen commit | the tag `contracts-phase-one-1`; the record's `commit` |
| `HoldbackRules` runtime size | the length of `deployedBytecode` in `contracts/out/HoldbackRules.sol/HoldbackRules.json`, against the EIP-170 limit of 24,576 bytes |
| The runtime hashes | SHA-256 of the code on chain with the immutables zeroed and the metadata tail cut ([`test-quality.md`](test-quality.md), "Runtime code"); the `onchain_hash` lines of [`cutover-phase-one.md`](../cutover-phase-one.md), step 3.2, compute them from the record |
| `ESCROW`, `ERC3009_COLLECTOR`, `BEACON`, `TOKEN` | the record's `escrow`, `erc3009Collector`, `beacon` and `token.address`; each creation transaction is under `contracts` |
| `EXPIRY_MARGIN`, `BEACON_MARGIN` | the record's `expiryMarginSec` and `beaconMarginSec` |
| Compiler settings | the record's `compiler`, from `contracts/foundry.toml` |
| Source verification | Sourcify, by each address in the record |

`deploy-sepolia.sh --check` reads every getter on chain against these fields (check 5 below).

The rules contract signs under the EIP-712 domain `{name: "Holdback", version: "0.8", chainId: <the deployment's chain>, verifyingContract: <rules>}` (`_domainNameAndVersion` in `HoldbackRules.sol`). A second token needs a second deployment, and so a second domain.

The state machine and the settlement interface are in [`docs/architecture.md`](../architecture.md) ("Commitment state machine", "Settlement interface"). A TLA+ model of the state machine, in a full and a phase-one profile, is in [`formal/`](../../formal/README.md).

## The frozen commit and how to confirm it

- **Commit:** the `commit` field of `sepolia.json`, which the tag `contracts-phase-one-1` names too. The compiler settings are in the same record, under `compiler` [measured: the record's fields; `contracts/foundry.toml` sets them].
- **Confirm:** run [`contracts/script/deploy-sepolia.sh`](../../contracts/script/deploy-sepolia.sh) `--check <rpc-url>` from a checkout whose build inputs equal the frozen commit. It deploys nothing and only reads. It fails unless all of these hold [measured: read from the script at the lane's tip]:
  1. the RPC serves chain ID 11155111;
  2. `src`, `lib`, `foundry.toml`, `remappings.txt` and `script/TestUSDC.sol` equal the recorded commit, with no uncommitted change;
  3. Multicall3 has the expected code hash;
  4. each creation transaction succeeded, came from the recorded deployer, created the recorded address, and its input equals this build's creation bytecode plus the encoded constructor arguments, the rules contract's six included;
  5. the wiring getters match: the rules contract's `ESCROW`, `ERC3009_COLLECTOR`, `BEACON`, `EXPIRY_MARGIN`, `TOKEN` and `BEACON_MARGIN`; the token holds code and is the token Crow's operators accept on the chain (`packages/settlement/evm/accepted-tokens.json`); the collector's escrow and Multicall3;
  6. the beacon's code hash equals the compiled `DrandQuicknetBeacon`; it verifies drand round 1000, and refuses a signature outside G1 and another round's signature;
  7. the token's name, symbol, decimals and EIP-712 domain separator match;
  8. the record it derives equals `sepolia.json`.
- **`--verify`** runs `--check`, then publishes each contract's source on Sourcify, and on Etherscan when a key is in the environment (T-383).
- **Earlier deployments** are not in phase one. Their records are kept beside `sepolia.json` under dated names (`contracts/deployments/sepolia-<date>-domain-<version>.json`).

## Third-party code: out of scope, relied on

| Code | Where | Pinned at | Use |
| --- | --- | --- | --- |
| Commerce Payments Protocol: `AuthCaptureEscrow` v1.1.0 and `ERC3009PaymentCollector` (with its ERC-6492 handler) | git submodule `contracts/lib/commerce-payments` (`https://github.com/base/commerce-payments`, from `.gitmodules` [measured]) | `6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9` [measured: `git ls-tree HEAD contracts/lib/commerce-payments`; the same commit is in `docs/tasks/T-201-cpp-spike.md` and both reviews] | Holds the buyer's funds. The deployment's copies: `escrow` and `erc3009Collector` in `sepolia.json` |
| Solady (`EIP712`, `SignatureCheckerLib`, `LibString`) | `lib/commerce-payments/lib/solady` | 0.1.1, `5ea5d9f` [documented: public-audit cross-check §2.1] | Imported by `HoldbackRules.sol` and `HoldbackTypes.sol` [measured: their import lines] |
| Permit2 | `lib/commerce-payments/lib/permit2` | source at `cc56ad0` [documented: cross-check §2.1] | Not in phase one: the phase-one contracts fund by ERC-3009 only. `forge test` still imports it for test helpers (`contracts/test/unit/Base.sol`) |
| OpenZeppelin Contracts | `lib/commerce-payments/lib/spend-permissions/lib/openzeppelin-contracts` | not recorded in the files read | Used by CPP [inferred] |
| forge-std | `lib/commerce-payments/lib/forge-std` | not recorded in the files read | Tests only |
| Multicall3 | canonical deployment `0xcA11bde05977b3631167028862bE2a173976CA11` | code hash checked by `--check` | The ERC-3009 collector's ERC-6492 path and the operators' bundles. Unaudited per its README [documented: cross-check §2.1] |
| drand quicknet | external network | chain hash and public key are constants in `DrandQuicknetBeacon.sol` | Panel seeds for fallback and escalation decisions |

`.gitmodules` records no commit. To confirm the submodule pin, run `git ls-tree HEAD contracts/lib/commerce-payments`, then `git -C contracts/lib/commerce-payments submodule status` for the nested libraries.

The public-audit cross-check lists the published audits of CPP and Solady, and of Permit2, which is not in phase one ([`docs/reviews/2026-11-03-public-audit-crosscheck.md`](../reviews/2026-11-03-public-audit-crosscheck.md) §2).

## Off-chain components that hold no funds

| Component | May | May not |
| --- | --- | --- |
| `packages/settlement/evm` (the EVM adapter) | Encode signed messages as contract calls, send them from the operator's relayer keys, send a timeout once it is due, and mirror chain state for the API | Change a signed field: the rules contract checks every signature and gives the sender no role, so a changed call reverts [documented: `docs/neutrality.md`, operator row] |
| `apps/operator` (the HTTP API) | Relay, index, refuse service, rate-limit, ask for its published fee before relaying a funded agreement, and warn about terms it would not choose (a short escalation or fallback window, an odd money address) | Author or alter an agent's message, move funds, or change a deadline. An agent can submit the same signed message to the contract directly |
| `apps/adjudicator` (the reference adjudicator) | Hold an adjudicator's signing key, decrypt a delivery it judges, run the panel, and sign a decision | Decide outside its role and window, choose the seed of a fallback or escalation panel, or move funds except through a decision the contract checks. It can leak the work it reads (residual 6) |
| `packages/judgment` (the judgment pipeline) | Compute the outcome an adjudicator signs: deterministic checks, the screen, the panel and the aggregation rule | Sign or submit anything; it holds no key [inferred from the stage table in `docs/judgment-and-defenses.md`]. A fault here changes what an adjudicator signs. The parties' choice of adjudicators and the signed record bound it |
| `packages/core` (EIP-712 encoding, `src/eip712.ts`) | Define the typed data every party signs and the state machine in `src/state.ts` | Diverge from the contract's hashes without detection: `contracts/test/unit/Vectors.t.sol` pins them byte for byte against `packages/core/src/eip712.vectors.test.ts` (domain 0.8, schema v0.11) [documented: T-212 Evidence] |

## Out of scope

- The hosting of the demo Workers: Cloudflare Workers, the Durable Object, the wrangler files and the deploy script (`apps/demo-cloud`).
- The site (`site/`, `apps/site`) and the early-access sign-up Worker.
- SimChain (`packages/settlement/sim`): an in-process simulation that holds no funds. It keeps the full protocol, party appeals and bonds included, which are not in phase one. Differential tests compare it with the contracts (`pnpm snap --settlement=local`).
- The test tokens and local helpers in `contracts/script/`: `TestUSDC.sol`, `LocalUSDC.sol`, `LocalMulticall3.sol`, and `SimBeacon.sol`, the local-chain beacon, whose constructor refuses any chain but 31337.
- The founders' console (Crow Control). It lives in a private repository, outside this one [documented: `docs/operations.md`].
- The third-party code above, and the controls a token issuer holds over its own token ([`SECURITY.md`](../../SECURITY.md); residual 1).

`SECURITY.md` accepts vulnerability reports on more than this page covers: the operator API, the judgment pipeline, the site and the test seller. This page is the scope of a contract audit.

## Trust assumptions and privileged roles

- **No admin keys.** The contracts have no owner, pause, freeze, blacklist or upgrade proxy. [`contracts/test/fuzz/NoAdmin.fuzz.t.sol`](../../contracts/test/fuzz/NoAdmin.fuzz.t.sol) holds them to it: an ABI allowlist per contract, a forbidden-selector check, an ether and unknown-selector refusal, and an opcode walk for `SELFDESTRUCT` and `DELEGATECALL`. `invariant_noAdminPath` in `contracts/test/invariant/RulesInvariants.t.sol` checks that no code hash changes [measured: the test names; not run here].
- **No privileged caller.** The rules contract is the escrow's operator for its deals (`_paymentInfo` sets `operator` to the rules contract); it is a code address, not a key.
- **The deployer**, the record's `deployer`, is a throwaway key with no authority on chain; it pays gas [documented: `deploy-sepolia.sh` header].
- **The operators' relayer keys** have no role in any contract [documented: `docs/neutrality.md`].
- **CPP trusts its operator.** The rules contract is that operator, so its correctness decides every capture and void [documented: cross-check §2.1, Cantina 3.3.5].
- **The beacon** is immutable in the rules contract. Biasing a round needs a colluding threshold of drand nodes [documented: `docs/neutrality.md`, beacon row].
- **The parties choose** the three adjudicators in the signed terms, and the deployer fixes the token. Every decision is final when written, and no adjudicator posts a bond on chain (ADR-0031 §8).
- **tUSDC is an open-mint test token by design.** Anyone can call `mint` on the deployment's token, the record's `token.address`; it guards no value [measured: `contracts/script/TestUSDC.sol`].

## Prior reviews

Every review below was run by AI model sessions. T-206 names an external audit as a step before mainnet [documented: `docs/tasks/T-206-contract-review.md`, Status]. No external audit is recorded in `docs/reviews/` [inferred].

| Review | Commit it read | File |
| --- | --- | --- |
| T-206 contract review: a checklist pass and an adversarial pass | `baac930` | [`2026-11-03-contract-review.md`](../reviews/2026-11-03-contract-review.md) |
| Public-audit cross-check | `43479c7` | [`2026-11-03-public-audit-crosscheck.md`](../reviews/2026-11-03-public-audit-crosscheck.md) |
| Cross-family pass (DeepSeek), five narrow parts | `2342756`, the commit of the first Sepolia deployment (EIP-712 domain 0.6) | [`2026-11-03-contract-review-deepseek.md`](../reviews/2026-11-03-contract-review-deepseek.md) |
| DeepSeek follow-ups on PR #160 and PR #161 | each PR's diff | contract review §8 |
| The drand verifier review (T-343), with finding X-1 on the rules contract's rounds | `ed6ec36` on `main` | [`2026-11-11-drand-verifier-review.md`](../reviews/2026-11-11-drand-verifier-review.md) |
| The drand verifier's second-family read (T-353) | `5a90dc5` | [`2026-11-11-drand-verifier-second-read.md`](../reviews/2026-11-11-drand-verifier-second-read.md) |
| Static analysis (T-339): Slither and Aderyn | `1430f77` | [`2026-11-11-static-analysis.md`](../reviews/2026-11-11-static-analysis.md) |

These reviews read the deployed contracts or `main`, not the phase-one contracts. Each records the commit it read.

**What changed between `baac930` and `64be1f1`** [documented: the review's findings table and [T-212](../tasks/T-212-contract-hardening.md)]:
- Landed, each with regression tests: the appeal seed fix (H-1, PR #120); no key to a refunded buyer (H-2, PR #125); bonds released after the buyer's CPP reclaim (M-1, PR #122); `deliverBy` binds every delivery path (M-2, PR #127); no bond locked without its adjudicator's decision (M-3, PR #135); only the losing party may appeal, and an overturn pays the price from the first decider's bond (L-7 and I-8, T-212 items 7 and 9, PR #160 at `1653745`); decisions and early accepts name the delivery hash, with domain 0.7 (L-1, T-212 item 3, PR #161 at `64be1f1`).
- Did not land: T-212 items 1 (L-2), 2 (L-4), 4 (L-6), 5 (L-5, the appeal adjudicator's cover), 6 (I-2) and 8 (L-8), and a minimum appeal bond (L-3). They wait for the contract redeploy before mainnet. On the lane, L-4, L-6, L-8 and I-2 are fixed; L-2, L-3 and L-5 are not in phase one ([`known-issues.md`](known-issues.md)).
- This list comes from the docs. `git diff baac930 64be1f1 -- contracts/src` gives the full change; it did not run for this page.

## Where to start reading

The audit pages, in reading order:
1. this page: what is in scope, the frozen commit and the trust assumptions;
2. [`threat-model.md`](threat-model.md) (added by T-340): the actors, assets, trust boundaries and attack classes;
3. [`invariants.md`](invariants.md): the properties the code is checked against, keyed to the `invariant_*` tests, the state machine and the formal model;
4. [`state-model.md`](state-model.md): every state a deal can be in on chain, and the signed-field register;
5. [`known-issues.md`](known-issues.md): what is open, accepted or fixed, and how the sources' disagreements were settled;
6. [`events.md`](events.md): every event the contracts emit, who reads it and what it reveals.

Then the sources behind them:
1. [`docs/neutrality.md`](../neutrality.md): the property the contracts must keep, and who can do what.
2. [`docs/architecture.md`](../architecture.md): the state machine and the settlement interface.
3. [`contracts/src/HoldbackRules.sol`](../../contracts/src/HoldbackRules.sol): the entry points, then `HoldbackTypes.sol` and `DrandQuicknetBeacon.sol`.
4. [`docs/reviews/2026-11-03-contract-review.md`](../reviews/2026-11-03-contract-review.md): the findings and the checklist in §3.
5. [`docs/audit/known-issues.md`](known-issues.md): what is open today. Build and test steps are in [`contracts/README.md`](../../contracts/README.md).
