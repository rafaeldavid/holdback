# Audit scope

## Summary

Crow (protocol name Holdback) is escrow and arbitration for AI agents. It runs on Ethereum Sepolia (chain ID 11155111) with test tokens only. An audit covers the six Solidity files in `contracts/src/` (1,463 lines) as deployed from commit `64be1f1`, and how they drive Coinbase's Commerce Payments Protocol (CPP) escrow. Off-chain code holds no funds, but five components shape the trust model and are listed below.

Labels on this page:
- **measured:** read from the named file in this checkout, or produced by the named command;
- **documented:** stated in the repository doc this page cites;
- **inferred:** concluded from reading, not checked by a run;
- **guessed:** a judgement not checked.

Not run while writing this page: `forge test` and `deploy-sepolia.sh --check`. Each claim that depends on one says so. Two `git` commands ran on 2026-11-11, on main at `016c28e`, and are cited where used.

## The phase-one scope

**The rest of this page describes the contracts deployed today, at `64be1f1`. The next deployment, phase one, is smaller on purpose.** [ADR-0031](../decisions/ADR-0031-phase-one-contract-scope.md) (Proposed, 2026-11-11) records what it cuts and why; Rafa decided the largest cut the same day (D57) and answered its open points after it merged (D58). Phase one is the deployment an external audit reads. Until the contracts are frozen, this section states the intended scope; the tables below change at the freeze, with the new line counts and addresses.

**What the phase-one contracts do.** One token per deployment. The buyer funds a hold with one ERC-3009 signature. The seller delivers. The primary adjudicator decides, or the fallback does when the primary is late; either may escalate to the appeal adjudicator. The buyer may accept early, both parties may settle between themselves, and anyone may trigger a timeout. The first decision is final.

| In scope for phase one | Purpose |
| --- | --- |
| `HoldbackRules.sol` | The rules contract. Eight state-changing entry points: `agreeAndFund`, `deliver`, `decide`, `earlyAccept`, `mutualSettle`, `reclaim`, `triggerFallback`, `triggerDefault` |
| `HoldbackTypes.sol` | The settlement view, the EIP-712 struct hashes and the rate math |
| `IHoldbackBeacon.sol`, `DrandQuicknetBeacon.sol`, `SimBeacon.sol` | The beacon that fixes the panel seed of a fallback's decision and of an escalation's. The on-chain proof of a drand round stays for now (Rafa, 2026-11-11; ADR-0031, SC-8), and the question comes back with the choice of chain |
| Relied on, not in scope | Commerce Payments' `AuthCaptureEscrow` and `ERC3009PaymentCollector`, Multicall3, Solady |

**Cut on purpose** (each with what leaves, what stays and what a party loses in ADR-0031):

1. **Party appeals and bonds** (decided by Rafa, D57). `HoldbackBonds.sol` leaves, with `fileAppeal`, `expireAppeal` and the appeal state. A wrong first decision has no remedy on chain; the loss is bounded by one deal's price and fee.
2. **Any token per deal.** A deployment serves one token, fixed at deploy.
3. **Permit2 funding.** ERC-3009 only.
4. **Payouts to third addresses** in a mutual settlement (decided by Rafa, D58). It pays the buyer and the seller only, and the `Paid` event leaves with the feature. The feature is planned to return after the freeze, through a receivable address in the terms that both parties can change.
5. **Terms that settlement does not process:** deadlines that are not strictly ordered `offerExpiresAt < fundBy < deliverBy < judgeBy < fallbackBy`; `maxSubmissions` other than 1; an escalation decision window (`appealDecideSec`) of 0.
6. **The on-chain record of an unfunded offer's expiry** (decided by Rafa, D58): `expireOffer` and the `Expired` stage. The operators mark an unfunded offer expired by their own clock and send no transaction.

**Kept on purpose** (Rafa, 2026-11-11):

- signatures from contracts (ERC-1271) in every role, so a multisig can be a party or an adjudicator;
- the on-chain proof of the randomness beacon;
- a price of zero (D58). A deal with price 0 and a fee above 0 funds and settles through every outcome. A deal with price 0 and fee 0 cannot be funded, because the escrow refuses to hold nothing (`AuthCaptureEscrow.sol:179`); whether to state that as a phase-one limit is open with Rafa (ADR-0031, "What waits on Rafa");
- the settlement for late work: in `Held`, a settlement both parties sign may name a delivery that was never posted and release its key in the same transaction as the payment (ADR-0031, SC-5b). It is the one path where a key leaves with no posted delivery. Core refuses it today and changes to allow it.

**Assumptions that are new with phase one:**

- **The deployment's token** is a plain ERC-20 with ERC-3009: no fee on transfer, no rebasing, no transfer hook. The contract cannot check this. Whoever deploys names the token and has no authority afterwards; the parties accept it by signing under that deployment's EIP-712 domain.
- **The deployer's one-time choices are the trust anchor:** the token, the escrow, the collector, the beacon and the expiry margin. At the freeze this page lists every immutable with its address and code hash.
- **The first decision by the primary or the fallback adjudicator is final,** and so is the appeal adjudicator's decision after an escalation. No adjudicator posts a bond. A party must trust all three adjudicators it names, because the other party can steer which one decides. The parties' protection is their choice of the three adjudicators, the fallback, the default outcome, and the signed record (ADR-0031, "Litmus tests").
- **Two signed fields mean less than they say.** The acceptance's `bondReserved` must be 0. The terms' `appealWindowSec` is signed and not read.
- **No signed type and no file in `spec/schemas/` changes.** The types describe the full protocol, which SimChain runs; a phase-one deployment accepts a subset.

Unchanged: no owner, pause, freeze, blacklist or upgrade proxy, and no real money.

## In scope

Line counts are a count of lines in this checkout [measured]. `contracts/src`, `foundry.toml`, `remappings.txt` and `script/TestUSDC.sol` equal `64be1f1`: `git diff --quiet 64be1f1 HEAD` over those four paths exits 0 [measured]; `--check` (below) also compares `lib`. Addresses are from [`contracts/deployments/sepolia.json`](../../contracts/deployments/sepolia.json) [measured].

| Contract | Purpose | Lines | Sepolia address |
| --- | --- | --- | --- |
| [`HoldbackRules.sol`](../../contracts/src/HoldbackRules.sol) | The rules contract. It is the operator of CPP's `AuthCaptureEscrow`. It moves a buyer's held funds only on an adjudicator's signed decision, the buyer's signed early accept, a settlement both parties signed, or a timeout anyone may trigger | 669 | `0xF38287e5C5C1F20c6D03be500EDBF8A244f27cFA` |
| [`HoldbackBonds.sol`](../../contracts/src/HoldbackBonds.sol) | The bond vault. Adjudicators deposit bonds; only the rules contract encumbers, releases or pays from them; it also holds appeal bonds | 118 | `0x83F3a2615A2BE9a7DadcA924ed9952ec85749aD1` (created by the `HoldbackRules` constructor) |
| [`HoldbackTypes.sol`](../../contracts/src/HoldbackTypes.sol) | A library: the settlement view, the EIP-712 struct hashes that `packages/core` signs, and the `Money` rate math | 450 | none recorded; compiled into the rules contract [inferred] |
| [`IHoldbackBeacon.sol`](../../contracts/src/IHoldbackBeacon.sol) | The interface of the randomness beacon that fixes fallback and appeal panel seeds | 15 | none (interface) |
| [`DrandQuicknetBeacon.sol`](../../contracts/src/DrandQuicknetBeacon.sol) | Verifies a drand quicknet round on chain (BLS12-381, EIP-2537 precompiles) | 175 | `0xBe80ad8Ba4E49bc985ef43caD71740351EE4Cc10` |
| [`SimBeacon.sol`](../../contracts/src/SimBeacon.sol) | A deterministic beacon for local chains; its constructor refuses any chain ID except 31337 | 36 | not deployed on Sepolia |

The rules contract signs under the EIP-712 domain `{name: "Holdback", version: "0.7", chainId: 11155111, verifyingContract: <rules>}` [documented: `docs/architecture.md`, "Identity and signing"; T-212 Handoff measured `eip712Domain()` on 2026-11-04].

The state machine and the settlement interface are in [`docs/architecture.md`](../architecture.md) ("Commitment state machine", "Settlement interface"). A TLA+ model of the state machine is in [`formal/`](../../formal/README.md).

## The deployed commit and how to confirm it

- **Commit:** `64be1f176ab45cca94a2cd398981c2a6664bc98a` (`64be1f1`), the `commit` field of `sepolia.json` [measured]. Compiler: solc 0.8.28, via IR, optimizer on with 200 runs, EVM version prague [measured, same file].
- **Deployed:** 2026-11-04, first block 12,061,237 [documented: T-212 Handoff; `fromBlock` measured].
- **Confirm:** run [`contracts/script/deploy-sepolia.sh`](../../contracts/script/deploy-sepolia.sh) `--check <rpc-url>` from a checkout whose build inputs equal `64be1f1`. It deploys nothing and only reads. It fails unless all of these hold [measured: read from the script]:
  1. the RPC serves chain ID 11155111;
  2. `src`, `lib`, `foundry.toml`, `remappings.txt` and `script/TestUSDC.sol` equal the recorded commit, with no uncommitted change;
  3. Permit2 and Multicall3 have the expected code hashes;
  4. each creation transaction succeeded, came from the recorded deployer, created the recorded address, and its input equals this build's creation bytecode plus the encoded constructor arguments;
  5. the wiring getters match: the rules contract's escrow, collectors, beacon and expiry margin (86,400 s); the vault's `RULES`; the vault's address as the rules contract's first CREATE; both collectors' escrow, Permit2 and Multicall3;
  6. the beacon's code hash equals the compiled `DrandQuicknetBeacon`; it verifies drand round 1000, and refuses a signature outside G1 and another round's signature;
  7. the token's name, symbol, decimals and EIP-712 domain separator match;
  8. the record it derives equals `sepolia.json`.
- **Last recorded pass:** `--check` passed against Sepolia on 2026-11-04 [documented: `docs/operations.md`, "Sepolia contracts"].
- **Etherscan:** the contracts are not verified there [documented: same section].

## Third-party code: out of scope, relied on

| Code | Where | Pinned at | Use |
| --- | --- | --- | --- |
| Commerce Payments Protocol: `AuthCaptureEscrow` v1.1.0, `ERC3009PaymentCollector`, `Permit2PaymentCollector` | git submodule `contracts/lib/commerce-payments` (`https://github.com/base/commerce-payments`, from `.gitmodules` [measured]) | `6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9` [measured: `git ls-tree HEAD contracts/lib/commerce-payments`; the same commit is in `docs/tasks/T-201-cpp-spike.md` and both reviews] | Holds the buyer's funds. Crow deployed its own unmodified copies: escrow `0x2d9ad608DE707aC470111B73c693020D9c9342cC`, ERC-3009 collector `0xA7c26BA572DCe83AB4466379fC8AEE84345888E7`, Permit2 collector `0x8d68172322D04c9aE1C42Da4DC859699E06E6C48`, token store implementation `0x93362F3D46981c13A0f7fFeF44Aad335cd228c34` [measured] |
| Solady (`EIP712`, `SignatureCheckerLib`, `SafeTransferLib`, `LibString`, `FixedPointMathLib`) | `lib/commerce-payments/lib/solady` | 0.1.1, `5ea5d9f` [documented: public-audit cross-check §2.1] | Imported by the three Holdback contracts [measured: their import lines] |
| Permit2 | `lib/commerce-payments/lib/permit2`; canonical deployment `0x000000000022D473030F116dDEE9F6B43aC78BA3` | source at `cc56ad0` [documented: cross-check §2.1]; deployed code hash checked by `--check` | One of two funding methods |
| OpenZeppelin Contracts | `lib/commerce-payments/lib/spend-permissions/lib/openzeppelin-contracts` | not recorded in the files read | Used by CPP [inferred] |
| forge-std | `lib/commerce-payments/lib/forge-std` | not recorded in the files read | Tests only |
| Multicall3 | canonical deployment `0xcA11bde05977b3631167028862bE2a173976CA11` | code hash checked by `--check` | The collectors and the operators' bundles. Unaudited per its README [documented: cross-check §2.1] |
| drand quicknet | external network | chain hash and public key are constants in `DrandQuicknetBeacon.sol` | Panel seeds for fallback and appeal decisions |

`.gitmodules` records no commit. To confirm the submodule pin, run `git ls-tree HEAD contracts/lib/commerce-payments`, then `git -C contracts/lib/commerce-payments submodule status` for the nested libraries. The first ran for this page; the second did not.

The public-audit cross-check lists the published audits of CPP, Permit2 and Solady ([`docs/reviews/2026-11-03-public-audit-crosscheck.md`](../reviews/2026-11-03-public-audit-crosscheck.md) §2).

## Off-chain components that hold no funds

| Component | May | May not |
| --- | --- | --- |
| `packages/settlement/evm` (the EVM adapter) | Encode signed messages as contract calls, send them from the operator's relayer keys, send a timeout once it is due, and mirror chain state for the API | Change a signed field: the rules contract checks every signature and gives the sender no role, so a changed call reverts [documented: `docs/neutrality.md`, operator row] |
| `apps/operator` (the HTTP API) | Relay, index, refuse service, rate-limit, and ask for its published fee before relaying a funded agreement | Author or alter an agent's message, move funds, or change a deadline. An agent can submit the same signed message to the contract directly |
| `apps/adjudicator` (the reference adjudicator) | Hold an adjudicator's signing key, decrypt a delivery it judges, run the panel, sign a decision, and post a bond | Decide outside its role and window, choose the seed of a fallback or appeal panel, or move funds except through a decision the contract checks. It can leak the work it reads (residual 6) |
| `packages/judgment` (the judgment pipeline) | Compute the outcome an adjudicator signs: deterministic checks, the screen, the panel and the aggregation rule | Sign or submit anything; it holds no key [inferred from the stage table in `docs/judgment-and-defenses.md`]. A fault here changes what an adjudicator signs; the appeal and the bond bound it |
| `packages/core` (EIP-712 encoding, `src/eip712.ts`) | Define the typed data every party signs and the state machine in `src/state.ts` | Diverge from the contract's hashes without detection: `contracts/test/unit/Vectors.t.sol` pins them byte for byte against `packages/core/src/eip712.vectors.test.ts` [documented: T-212 Evidence] |

## Out of scope

- The hosting of the demo Workers: Cloudflare Workers, the Durable Object, the wrangler files and the deploy script (`apps/demo-cloud`).
- The site (`site/`, `apps/site`) and the early-access sign-up Worker.
- SimChain (`packages/settlement/sim`): an in-process simulation that holds no funds. Differential tests compare it with the contracts (`pnpm snap --settlement=local`).
- The test tokens and local helpers in `contracts/script/`: `TestUSDC.sol`, `LocalUSDC.sol`, `LocalMulticall3.sol`.
- The founders' console (Crow Control). It lives in a private repository, outside this one [documented: `docs/operations.md`].
- The third-party code above, and the controls a token issuer holds over its own token ([`SECURITY.md`](../../SECURITY.md); residual 1).

`SECURITY.md` accepts vulnerability reports on more than this page covers: the operator API, the judgment pipeline, the site and the test seller. This page is the scope of a contract audit.

## Trust assumptions and privileged roles

- **No admin keys.** The contracts have no owner, pause, freeze, blacklist or upgrade proxy. [`contracts/test/fuzz/NoAdmin.fuzz.t.sol`](../../contracts/test/fuzz/NoAdmin.fuzz.t.sol) holds them to it: an ABI allowlist per contract, a forbidden-selector check, an ether and unknown-selector refusal, and an opcode walk for `SELFDESTRUCT` and `DELEGATECALL`. `invariant_noAdminPath` in `contracts/test/invariant/RulesInvariants.t.sol` checks that no code hash changes [measured: the test names; not run here].
- **One privileged caller.** Only `RULES`, the rules contract's immutable address, may encumber, release or pay from the vault. It is a code address, not a key.
- **The deployer** `0x1A4435488eaF1A37d2327d44Fe67e97d83203B64` is a throwaway key with no authority on chain; it paid gas [documented: `deploy-sepolia.sh` header].
- **The operators' relayer keys** have no role in any contract [documented: `docs/neutrality.md`].
- **CPP trusts its operator.** The rules contract is that operator, so its correctness decides every capture and void [documented: cross-check §2.1, Cantina 3.3.5].
- **The beacon** is immutable in the rules contract. Biasing a round needs a colluding threshold of drand nodes [documented: `docs/neutrality.md`, beacon row].
- **The parties choose** the token and the three adjudicators in the signed terms. The appeal adjudicator's decision is final (residual 7) and it posts no bond on chain today (review L-5).
- **tUSDC is an open-mint test token by design.** Anyone can call `mint` on `0x5029787d7E141F2D51788035cc23903652d196B6`; it guards no value [measured: `contracts/script/TestUSDC.sol`].

## Prior reviews

Every review below was run by AI model sessions. T-206 names an external audit as a step before mainnet [documented: `docs/tasks/T-206-contract-review.md`, Status]. No external audit is recorded in `docs/reviews/` [inferred].

| Review | Commit it read | File |
| --- | --- | --- |
| T-206 contract review: a checklist pass and an adversarial pass | `baac930` | [`2026-11-03-contract-review.md`](../reviews/2026-11-03-contract-review.md) |
| Public-audit cross-check | `43479c7` | [`2026-11-03-public-audit-crosscheck.md`](../reviews/2026-11-03-public-audit-crosscheck.md) |
| Cross-family pass (DeepSeek), five narrow parts | `2342756`, the commit of the first Sepolia deployment (EIP-712 domain 0.6) | [`2026-11-03-contract-review-deepseek.md`](../reviews/2026-11-03-contract-review-deepseek.md) |
| DeepSeek follow-ups on PR #160 and PR #161 | each PR's diff | contract review §8 |

**What changed between `baac930` and `64be1f1`** [documented: the review's findings table and [T-212](../tasks/T-212-contract-hardening.md)]:
- Landed, each with regression tests: the appeal seed fix (H-1, PR #120); no key to a refunded buyer (H-2, PR #125); bonds released after the buyer's CPP reclaim (M-1, PR #122); `deliverBy` binds every delivery path (M-2, PR #127); no bond locked without its adjudicator's decision (M-3, PR #135); only the losing party may appeal, and an overturn pays the price from the first decider's bond (L-7 and I-8, T-212 items 7 and 9, PR #160 at `1653745`); decisions and early accepts name the delivery hash, with domain 0.7 (L-1, T-212 item 3, PR #161 at `64be1f1`).
- Did not land: T-212 items 1 (L-2), 2 (L-4), 4 (L-6), 5 (L-5, the appeal adjudicator's cover), 6 (I-2) and 8 (L-8), and a minimum appeal bond (L-3). They wait for the contract redeploy before mainnet. See [`known-issues.md`](known-issues.md).
- This list comes from the docs. `git diff baac930 64be1f1 -- contracts/src` gives the full change; it did not run for this page.

`HoldbackRules` runtime is 24,313 bytes, 263 bytes under the EIP-170 limit [documented: T-212 Evidence, measured with `forge build --sizes` at PR #161].

## Where to start reading

The audit pages, in reading order:
1. this page: what is in scope, the deployed commit and the trust assumptions;
2. [`threat-model.md`](threat-model.md) (added by T-340): the actors, assets, trust boundaries and attack classes;
3. [`invariants.md`](invariants.md): the properties the code is checked against, keyed to the ten `invariant_*` tests, the state machine and the formal model;
4. [`known-issues.md`](known-issues.md): what is open, accepted or fixed, and how the sources' disagreements were settled;
5. [`events.md`](events.md): every event the contracts emit, who reads it and what it reveals.

Then the sources behind them:
1. [`docs/neutrality.md`](../neutrality.md): the property the contracts must keep, and who can do what.
2. [`docs/architecture.md`](../architecture.md): the state machine and the settlement interface.
3. [`contracts/src/HoldbackRules.sol`](../../contracts/src/HoldbackRules.sol): the entry points, then `HoldbackTypes.sol` and `HoldbackBonds.sol`.
4. [`docs/reviews/2026-11-03-contract-review.md`](../reviews/2026-11-03-contract-review.md): the findings and the checklist in §3.
5. [`docs/audit/known-issues.md`](known-issues.md): what is open today. Build and test steps are in [`contracts/README.md`](../../contracts/README.md).
