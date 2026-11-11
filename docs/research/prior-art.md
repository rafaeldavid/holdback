# Prior art: escrow and judgment for agent commitments (October 2026)

Task T-002. Compiled October 30, 2026. Supersedes the summary table in `escrow-options-2026-10.md` for scoring purposes; that file stays as the earlier snapshot.

## How to read this document

- **Labels.** Every claim carries one label.
  - **[measured]**: I read the primary source myself: contract source at a pinned commit, the specification, or the vendor's own documentation.
  - **[inferred]**: derived from measured facts, not stated anywhere.
  - **[guessed]**: judgment with weak evidence.
- **[vendor-only]** marks a claim whose only source is the vendor itself (press release, vendor blog, vendor-authored post). "Measured" on such a claim means only that the vendor says it.
- **Code links** are pinned to commit SHAs. Nothing was built or run; all code reading was static, from shallow clones under `/private/tmp` or the GitHub API.
- **Scoring** uses the three litmus tests from `CLAUDE.md` and `docs/neutrality.md`:
  - **N (neutrality):** no single party can stop a valid commitment from settling by its terms, or move held funds outside its terms.
  - **H (hold):** funds locked so neither party can take them alone, with expiry, idempotent operations and no double spend; custody not on a fiat rail.
  - **J (defended multi-model judgment):** deterministic checks first, then a pinned cross-family model panel selected by commit-reveal, defended against injection and drift, with bonded appeals.
  - Grades: **Pass**, **Partial**, **Fail**, **Unknown**.

## Gap verdict

No candidate found passes all three tests. [inferred, from the table below]

- **Custody (H) is a solved problem.** `AuthCaptureEscrow` (Commerce Payments Protocol) passes H and most of N at the custody layer, with six audits and no admin control. [measured; see Q5, Q6]
- **Judgment (J) is the gap.** Every escrow candidate delegates acceptance to one address: an operator, an evaluator, an arbiter, a dispute resolver, a buyer, or a company signer. None ships a cross-family model panel, commit-reveal panel selection or bonded appeals tied to an escrow. [measured per row]
- **Closest partial hits on J**, none of which is an escrow product meeting H and N:
  - GenLayer runs LLM-backed validators with commit-reveal voting and bonded appeals to larger committees, but it is a chain, not an agent escrow, and its docs do not guarantee model-family diversity. [measured, docs]
  - The ClawBank, Shodai and Kleros pilot (September 2026) uses randomly drawn AI jurors with sealed votes and appeals, but payout runs through a 2-of-3 Safe that includes a ClawBank signer. [measured, vendor-only]
  - x402r adds an arbiter over `AuthCaptureEscrow`; its reference arbiter is a single seed-locked model in a TEE. [measured]

## Candidate table

| # | Candidate | What it is | N | H | J | Key evidence | Sources |
|---|---|---|---|---|---|---|---|
| 1 | Commerce Payments Protocol (`AuthCaptureEscrow`, Coinbase/Shopify) | Singleton escrow contract, authorize/capture/charge/void/reclaim/refund, permissionless operators | Partial | Pass (amount-bounded; `capture` takes no nonce, so idempotency must come from the operator) | Fail | No owner, pause or proxy [measured]. The operator alone decides capture vs void and can void at any time [measured]. Payer-only reclaim after `authorizationExpiry` is the liveness backstop [measured]. No acceptance layer [measured] | [S1], [S2], [S3] |
| 2 | ERC-8183 (draft) and Virtuals ACP | Job escrow with a single evaluator; ACP is the Virtuals production deployment | Partial | Partial | Fail | Spec: "No dispute resolution or arbitration"; evaluator "trusted" once submitted; anyone may refund after expiry [measured]. Reference implementation is UUPS-upgradeable under `DEFAULT_ADMIN_ROLE` [measured, per spec page]. Virtuals `ACPSimple` is an initializer-based upgradeable contract with `ADMIN_ROLE` fee setters; its expiry refund applies only before the evaluation phase [measured, repo source; deployed bytecode not checked] | [S4], [S5] |
| 3a | x402 (core) | HTTP 402 payment scheme; pay-then-serve | Fail | Fail | Fail | No hold: payment settles on request [measured in earlier notes on x402, kept privately: `docs/private-materials.md`] | [S6] |
| 3b | x402r (BackTrackCo) | Refund and arbiter layer on x402, built as a `PaymentOperator` contract over the canonical Base `AuthCaptureEscrow` v1.0.0 | Partial | Pass | Fail | Contract operator with pluggable condition/hook slots per action [measured]. README: "CONTRACTS UNAUDITED" [measured]. `ProtocolFeeConfig` has an owner with a 7-day timelock over the fee calculator and recipient [measured]. Reference arbiter: one EigenAI model, fixed seed, in a TEE [measured, vendor README]. BUSL-1.1 licence [measured] | [S7], [S8] |
| 3c | Boson x402B | "Non-custodial" escrow extension to x402; buyer confirms; escalation to third-party resolvers | Unknown | Partial | Fail | Custody, buyer confirmation and "optional escalation to independent third-party resolvers" described only by press and vendor [vendor-only]. Resolver identity, timeouts and admin controls not documented in sources read. Launch date conflicts (April 23 vs May 7 vs June 8, 2026) | [S9] |
| 4 | Kustodia | Escrow for LatAm and agents, MCP tools, Arbitrum and Injective | Fail | Partial | Fail | Paid press release only: contracts "UUPS-upgradeable", upgrade-key holder not named; release "when both sides confirm"; no dispute mechanism; no audit mentioned [vendor-only]. An upgradeable contract with an unnamed upgrader fails N by the ADR-0001 checklist [inferred] | [S10] |
| 5 | Escrow.com API | Licensed escrow company with an API | Fail | Fail | Fail | Company holds funds; buyer acceptance by API or inspection-period lapse; disputes to human case managers [measured, earlier sweep] | [S11] |
| 6 | Trustless Work | Role-based USDC escrow on Stellar (Soroban), API and SDK | Fail | Partial | Fail | Dispute resolver may distribute the balance to any addresses it lists, subject only to the sum matching the balance [measured]. No expiry, deadline or permissionless timeout in the escrow contract [measured: no such field or function]. A silent approver or resolver can stall funds indefinitely [inferred] | [S12], [S13] |
| 7 | Stripe holds and Connect | Card authorization holds; platform balances with manual payouts | Fail | Fail | Fail | Stripe "doesn't provide escrow services"; funds sit with the platform or card issuer; card holds about 7 days [measured, earlier sweep]. Usable only as an on-ramp under ADR-0002 [inferred] | [S14], [S15] |
| 8 | Kleros (court plus arbitrable escrow) | Staked-juror arbitration (ERC-792), appeals to larger panels | Partial | Partial | Partial | Ruling decides fund movement in arbitrable escrows [measured, docs]. `KlerosLiquid` has a `governor` that can change the token, RNG and execute arbitrary proposals [measured]; the governor is DAO-controlled in production [guessed, not verified on-chain]. Jurors are humans, not pinned models, in the classic courts [measured, docs] | [S16], [S17] |
| 9 | UMA Optimistic Oracle (v3) | Bonded assertions with a challenge window; disputes go to a token-holder vote (DVM) | Partial | Fail | Fail | An oracle, not an escrow; integrators hold funds [inferred]. Default liveness two hours; disputer posts a matching bond; DVM vote takes days [measured, docs]. Final arbiter is a token-holder vote, not a model panel | [S18] |
| 10 | Circle Refund Protocol | Escrow where an arbiter can refund only to a payer-specified address; recipient withdraws after lockup | Partial | Partial | Fail | Arbiter "does *not* have the ability to send funds to an address of their choosing" [measured, Circle blog]. Arbiter sets the lockup. Circle states it "has not been audited" and is educational [measured]. Admin and upgrade not addressed | [S19] |
| 11 | ClawBank × Shodai × Kleros "Agentic Commerce Court" pilot (Sept 2026) | Per-agreement 2-of-3 Safe on Base; AI jurors drawn from a staked Kleros pool; appeals to larger panels | Fail | Partial | Partial | ClawBank signer sits in the enforcement path: "the arbiter decides and ClawBank executes" [vendor-only]. Jurors are "a diverse pool of AI Agents", models unnamed; sealed votes; appeals [vendor-only]. No deterministic-check stage, pinning or cross-family requirement stated | [S20] |
| 12 | GenLayer | L1/L2 where "intelligent contracts" call LLMs; validators vote by commit-reveal under an "Equivalence Principle"; bonded appeals to larger committees | Unknown | Unknown | Partial | Leader plus stake-weighted committee, encrypted vote commits then reveal, appeals by "posting the required bond" [measured, docs]. Docs do not require different model families per validator [measured, absence]. No agent-escrow product or admin-key analysis found [inferred] | [S21] |
| 13 | Nava (April 2026, $8.3M seed) | Agent escrow released when a "verification framework" confirms intent; Arbitrum L3 | Unknown | Unknown | Unknown | One secondary blog post; no docs, contracts or verification design found [vendor-only, secondary] | [S22] |

Notes on the table:
- Rows 3a–3c score x402 and its two escrow extensions separately because they differ on every test. [inferred]
- Row 2's spec/reference discrepancies (who may `setBudget`, `submit` from Open) are listed on the EIP page; they do not change the scores. [measured]
- In the Virtuals `ACPSimple` source, `_claimBudget` sets `amountClaimed = budget` before computing `claimableAmount = budget - amountClaimed`, which reads as always zero ([S5] L209-213). I did not check whether this file matches the deployed bytecode. [measured source; deployed behaviour unverified]

## ADR-0003 spike questions

All `AuthCaptureEscrow` links point to tag `v1.1.0` (commit `6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9`). The `src/` tree is identical at `main` HEAD `b748fdd7` (three docs/README/audit commits ahead, no source changes). [measured: GitHub compare API]

Shorthand: `ACE` = `https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/AuthCaptureEscrow.sol`.

### Q1. Can the operator be a contract, and are any operator functions restricted to EOAs?

**Yes, the operator can be a contract. No function is restricted to EOAs.**

- Every operator function uses `onlySender(paymentInfo.operator)`, a plain `msg.sender` equality check ([ACE#L170-L173](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/AuthCaptureEscrow.sol#L170-L173)). It applies to `charge` (L207), `authorize` (L241), `capture` (L270), `void` (L304) and `refund` (L356). [measured]
- No `tx.origin`, `extcodesize` or code-length check on callers exists in `src/`. [measured: grep]
- The project's security doc names "smart contracts that implement custom business logic" as valid operators ([Security.md](https://github.com/base/commerce-payments/blob/b748fdd7a830a655a19a530edcf2a94b9dc7d25f/docs/Security.md)). [measured]
- **Existence proof.** x402r deploys a `PaymentOperator` contract that calls `ESCROW.authorize/charge/capture/void/refund`, gated by per-action condition contracts ([PaymentOperator.sol#L313-L335](https://github.com/BackTrackCo/x402r-contracts/blob/8345776e99d68555634589bfa2a141149410d8a1/src/operator/payment/PaymentOperator.sol#L313-L335)). It targets the canonical Base `AuthCaptureEscrow` v1.0.0 at `0xBdEA…0cff` ([DeployX402r.s.sol#L28-L80](https://github.com/BackTrackCo/x402r-contracts/blob/8345776e99d68555634589bfa2a141149410d8a1/script/DeployX402r.s.sol#L28-L80)). [measured]
- **Consequences for the Holdback rules contract:**
  - The payer's ERC-3009 signature binds the operator address. The collector uses a payer-agnostic hash of the full `PaymentInfo`, operator included, as the ERC-3009 nonce ([ERC3009PaymentCollector.sol#L42-L50](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/collectors/ERC3009PaymentCollector.sol#L42-L50)). The buyer's signature therefore commits to the rules contract. [measured]
  - `authorize` is operator-only, so the buyer cannot fund directly against the escrow. The rules contract must expose a permissionless `authorize` wrapper that accepts the buyer's signed payload, or the escape hatch in `docs/neutrality.md` fails. [inferred]
  - Funds sit in a per-operator `TokenStore` clone keyed by operator address ([ACE#L393-L399](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/AuthCaptureEscrow.sol#L393-L399), [TokenStore.sol#L33-L37](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/TokenStore.sol#L33-L37)). A single rules contract pools all Holdback holds in one store; per-payment accounting is still enforced by `paymentState`. [measured]

### Q2. How do operator fees and fee recipients work?

- `PaymentInfo` carries `minFeeBps`, `maxFeeBps` and `feeReceiver`, all signed by the payer ([ACE#L44-L49](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/AuthCaptureEscrow.sol#L44-L49)). [measured]
- In v1.1.0 the operator passes an **absolute** `feeAmount` at `capture` or `charge`. `_validateFee` requires `amount*minFeeBps/10000 ≤ feeAmount ≤ amount*maxFeeBps/10000` ([ACE#L511-L530](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/AuthCaptureEscrow.sol#L511-L530)). [measured]
- If `PaymentInfo.feeReceiver` is non-zero, the fee must go there. If it is zero, the operator picks any receiver at each capture. [measured, same lines]
- **Version break.** v1.0.0 takes `uint16 feeBps` in `capture` instead of an absolute amount ([v1.0.0 capture](https://github.com/base/commerce-payments/blob/d33b5d5f74fff55f1c0857b1cb6fb4995949330b/src/AuthCaptureEscrow.sol#L256)). The two versions are separate deployments with different addresses (README L19-43), and x402r targets v1.0.0. Holdback must pin one. [measured]
- Fees are deducted only on capture or charge. `void`, `reclaim` and `refund` carry no fee. [measured: those functions have no fee parameters]
- The project's own risk note says a compromised operator can take up to `maxFeeBps` to an address of its choosing when `feeReceiver` is zero ([Security.md](https://github.com/base/commerce-payments/blob/b748fdd7a830a655a19a530edcf2a94b9dc7d25f/docs/Security.md), "Operator compromise"). [measured]

### Q3. Can capture split payment between seller and adjudicator?

**Two-way per call, yes. N-way, only by composition.**

- Each `capture` sends `feeAmount` to one `feeReceiver` and `amount - feeAmount` to `receiver` ([ACE#L464-L472](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/AuthCaptureEscrow.sol#L464-L472)). Seller as `receiver` and adjudicator as `feeReceiver` works directly, bounded by the signed bps range. [measured]
- `capture` may be called several times up to the authorized amount ([ACE#L258-L296](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/AuthCaptureEscrow.sol#L258-L296)). With `feeReceiver = 0`, each partial capture can route its fee to a different address (adjudicator, fallback adjudicator, operator). [measured, inferred for the routing pattern]
- A partial outcome (for example 70% to seller, 30% back to buyer) is `capture(70%)` then `void()`, because `void` returns the remaining capturable balance ([ACE#L304-L316](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/AuthCaptureEscrow.sol#L304-L316)). [inferred]
- Alternatively, set `feeReceiver` to the rules contract and split there, as x402r does with `distributeFees` ([PaymentOperator.sol#L412-L438](https://github.com/BackTrackCo/x402r-contracts/blob/8345776e99d68555634589bfa2a141149410d8a1/src/operator/payment/PaymentOperator.sol#L412-L438)). This puts funds briefly in the rules contract, which then must itself have no admin path. [measured, inferred]
- **Not covered:** adjudicator bonds and appeal bonds are separate money and need their own contract. `AuthCaptureEscrow` holds only the payer's funds. [inferred]

### Q4. How do reclaim timing and the expiry fields interact with our deadlines?

The three expiries must satisfy `preApprovalExpiry ≤ authorizationExpiry ≤ refundExpiry` ([ACE#L493-L496](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/AuthCaptureEscrow.sol#L493-L496)). [measured]

| Field | Contract effect | Holdback mapping |
|---|---|---|
| `preApprovalExpiry` | `authorize` reverts at or after it (L491) | Funding deadline [inferred] |
| `authorizationExpiry` | `capture` reverts at or after it (L277-279); `reclaim` by payer allowed only at or after it (L325-327) | Must exceed delivery deadline + judgment + appeal + fallback + default-trigger window [inferred] |
| `refundExpiry` | `refund` (post-capture) reverts at or after it (L358-360) | Barely used if Holdback never captures before appeals close [inferred] |

Constraints this creates [inferred unless marked]:
1. **No capture after `authorizationExpiry`.** A seller-favourable default outcome (D5) must be triggered before `authorizationExpiry`. After it, only the payer's `reclaim` remains, so a buyer can outwait an untriggered seller-favourable default. The rules contract needs a permissionless default trigger and a margin before `authorizationExpiry`, sized for L2 sequencer delay (residual control point 2).
2. **`void` has no deadline.** The operator may void at any time ([Void.md](https://github.com/base/commerce-payments/blob/b748fdd7a830a655a19a530edcf2a94b9dc7d25f/docs/operations/Void.md): "at any time, even if a payment's authorization has not expired"). [measured] A permissionless refund timeout in the rules contract can therefore fire at the delivery deadline, as `docs/neutrality.md` requires ("anyone can reclaim once the delivery deadline passes").
3. **`reclaim` is payer-only** (`onlySender(paymentInfo.payer)`, [ACE#L323](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/AuthCaptureEscrow.sol#L323)). [measured] It is a backstop if the rules contract is broken, not the permissionless timeout itself.
4. **Post-capture `refund` is not escrow-backed.** It pulls fresh liquidity through a refund collector, for example from the operator's allowance ([ACE#L371-L373](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/AuthCaptureEscrow.sol#L371-L373), [OperatorRefundCollector.sol](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/collectors/OperatorRefundCollector.sol)). [measured] An appeal that overturns a release after capture cannot claw back the held funds. Holdback should capture only after the appeal window closes.
5. **Deadlines are fixed at signature.** Expiries are part of the signed, hashed `PaymentInfo` ([ACE#L383-L386](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/AuthCaptureEscrow.sol#L383-L386)). Rulebook deadlines must be computed before the buyer signs and cannot be extended for an appeal. Worst-case appeal length must be budgeted up front.

### Q5. Which networks have deployments, and which audits exist?

- **Official deployments:** Base Mainnet and Base Sepolia only, same CREATE2 addresses on both. v1.1.0 `AuthCaptureEscrow` is `0xf96815976523E00e65Be8f34cA5e64b4f41EB19c`; v1.0.0 is `0xBdEA0D1bcC5966192B070Fdf62aB4EF5b4420cff` ([README L19-43](https://github.com/base/commerce-payments/blob/b748fdd7a830a655a19a530edcf2a94b9dc7d25f/README.md#L19-L43)). [measured, README]
- x402r's deploy script independently states the canonical escrow exists on "Base mainnet + Base Sepolia only" ([DeployX402r.s.sol#L50-L53](https://github.com/BackTrackCo/x402r-contracts/blob/8345776e99d68555634589bfa2a141149410d8a1/script/DeployX402r.s.sol#L50-L53)). [measured]
- I did not check on-chain bytecode or verification status at either address. [not verified]
- **Audits** (PDFs in `audits/`, listed in README L77-88). [measured, list only; reports not read]
  - Coinbase Protocol Security: March 19, March 26 and April 15, 2025.
  - Spearbit/Cantina: April 1 and April 22, 2025.
  - Spearbit/Cantina on PR #90 (v1.1.0 rounding and billing change): July 22, 2026.
- **Licence:** MIT ([LICENSE.md](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/LICENSE.md)). [measured]

### Q6. Does any part of the contract carry admin or upgrade control?

**No.** [measured]

- `AuthCaptureEscrow` has no owner, roles, pause, blacklist or `selfdestruct`. Its only constructor action deploys the immutable `TokenStore` implementation ([ACE#L185-L187](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/AuthCaptureEscrow.sol#L185-L187)).
- A grep of `src/` for `owner`, `Ownable`, `admin`, `pause`, `upgrade`, `proxy` and `tx.origin` matches only a Permit2 struct field named `owner` (the payer).
- `TokenStore` is called only by the escrow ([TokenStore.sol#L33-L37](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/TokenStore.sol#L33-L37)). Its clones are Solady `LibClone` minimal proxies pointing at an immutable implementation, so they are not upgradeable proxies ([ACE#L440-L447](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/AuthCaptureEscrow.sol#L440-L447)).
- Token collectors accept calls only from the escrow ([TokenCollector.sol#L43](https://github.com/base/commerce-payments/blob/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9/src/collectors/TokenCollector.sol#L43)).
- The docs call the protocol "permissionless and immutable by design" ([Security.md](https://github.com/base/commerce-payments/blob/b748fdd7a830a655a19a530edcf2a94b9dc7d25f/docs/Security.md)).

Residual control outside the contract [measured, Security.md "Denial of service due to denylists"]: a USDC denylist on `receiver` or `feeReceiver` blocks capture. This matches residual control point 1 in `docs/neutrality.md`; a test token avoids it in the prototype.

## D3 recommendation

**Adopt `AuthCaptureEscrow` v1.1.0 for custody, with a Holdback rules contract as its operator, as ADR-0003 proposes. Confidence: medium-high.** [inferred]

Reasons:
- It passes H and has no admin surface (Q6). [measured]
- Contract operators work, and a third party already ships one in production code (Q1). [measured]
- Partial outcomes and a two-way fee split need no changes (Q3). [measured, inferred]
- It has six audits; writing custody ourselves would have none (Q5). [measured, inferred]
- The ERC-8183 fallback would mean writing and auditing custody from scratch. Its reference code also carries a UUPS admin that Holdback would have to strip. [measured, inferred]

Conditions the rules contract must meet [inferred]:
- **No admin.** No owner, pause or proxy. Otherwise the neutrality argument moves from the escrow to the operator.
- **Permissionless paths:** an `authorize` wrapper (escape hatch), a refund timeout (`void` at the delivery deadline), and a default-outcome trigger with margin before `authorizationExpiry`.
- **Capture only after appeals close,** because post-capture refunds are not escrow-backed (Q4.4).
- **Separate bond escrow** for adjudicator and appeal bonds (Q3).
- **One pinned version:** v1.1.0, absolute fees. Do not mix with x402r's v1.0.0 deployment.

What lowers confidence below high:
- Nothing was compiled, run or forked. [measured: no execution]
- The audits were not read.
- Deployed bytecode was not compared with the tagged source.

### What T-201 must still verify hands-on

1. On a Base Sepolia fork, a minimal no-admin rules contract as `operator` completes authorize → capture, authorize → void, partial capture + void, and payer `reclaim` after expiry with `forge test`.
2. The ERC-3009 path with a test token that implements `receiveWithAuthorization` on a local chain. Also check whether the Permit2 or PreApproval collectors suit agent smart wallets (ERC-6492 counterfactual signatures).
3. A permissionless `authorize` wrapper and timeouts callable by an unrelated address. Map these to `neutrality.operator-offline` and `neutrality.buyer-silent`.
4. Multiple partial captures with `feeReceiver = 0` routing fees to different adjudicators, and rounding at `minFeeBps == maxFeeBps`.
5. Deadline arithmetic: a seller-favourable default triggered just before `authorizationExpiry`, and the buyer `reclaim` race just after it.
6. Bytecode at `0xf968…B19c` on Base Sepolia matches tag `v1.1.0`; `CREATE2` reproducibility for a local deployment.
7. Gas per lifecycle on Base Sepolia, which feeds D4.
8. Read the July 22, 2026 Cantina report and the 2025 reports for open findings that touch operator contracts.
9. Event mapping from `PaymentAuthorized/Captured/Voided/Reclaimed` to ERC-8183-compatible events emitted by the rules contract.

## Sources

- [S1] base/commerce-payments, tag v1.1.0, commit `6b0a5ef3`: `src/AuthCaptureEscrow.sol`, `src/TokenStore.sol`, `src/collectors/*`. https://github.com/base/commerce-payments/tree/6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9
- [S2] base/commerce-payments `docs/Security.md`, `docs/Fees.md`, `docs/operations/Void.md`, `README.md` at `b748fdd7`. https://github.com/base/commerce-payments/tree/b748fdd7a830a655a19a530edcf2a94b9dc7d25f/docs
- [S3] Shopify Engineering, "Commerce Payments Protocol," June 2025. https://shopify.engineering/commerce-payments-protocol
- [S4] ERC-8183: Agentic Commerce, Draft, created February 25, 2026. https://eips.ethereum.org/EIPS/eip-8183
- [S5] Virtual-Protocol/protocol-contracts `contracts/acp/ACPSimple.sol` at `370bce58` (L16-20 upgradeable base; L110-111 roles; L204-262 `claimBudget`). https://github.com/Virtual-Protocol/protocol-contracts/blob/370bce5834b31f42c86313640c3af4554956758f/contracts/acp/ACPSimple.sol
- [S6] The earlier research notes on x402 (kept privately, `docs/private-materials.md`) and the x402 repository. https://github.com/coinbase/x402
- [S7] BackTrackCo/x402r-contracts at `8345776e`: README (unaudited warning), `src/operator/payment/PaymentOperator.sol`, `src/plugins/fees/ProtocolFeeConfig.sol` (L45 `TIMELOCK_DELAY`, L90-128 owner functions), `script/DeployX402r.s.sol`. https://github.com/BackTrackCo/x402r-contracts/tree/8345776e99d68555634589bfa2a141149410d8a1
- [S8] BackTrackCo/x402r-arbiter-eigencloud README. https://github.com/BackTrackCo/x402r-arbiter-eigencloud
- [S9] Our Crypto Talk, "Boson Protocol launches x402B escrow for agent commerce," May 7, 2026. https://ourcryptotalk.com/news/boson-protocol-launches-x402b-escrow-agent-commerce [vendor-sourced]
- [S10] Cointelegraph (paid press release), Kustodia, June 4, 2026. https://cointelegraph.com/press-releases/kustodia-launches-the-missing-escrow-layer-for-ai-agents-and-x402-payments [vendor-only]
- [S11] Escrow.com API Guide, "Accepting items in a transaction." https://www.escrow.com/api/docs/accept-transaction-items
- [S12] Trustless-Work/trustlesswork-smart-contract-stellar at `f0b706ea`: `contracts/escrow/src/contract.rs` (L183-197 `resolve_dispute`), `contracts/escrow/src/core/validators/dispute.rs` (L43-72). https://github.com/Trustless-Work/trustlesswork-smart-contract-stellar/tree/f0b706eaf6e98aa83bf4f95df42857b5d4c8e847
- [S13] Trustless Work docs, "Roles in Trustless Work." https://docs.trustlesswork.com/trustless-work/technology-overview/roles-in-trustless-work
- [S14] Stripe Docs, "Using manual payouts." https://docs.stripe.com/connect/manual-payouts
- [S15] Stripe Docs, "Place a hold on a payment method." https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
- [S16] kleros/kleros `contracts/kleros/KlerosLiquid.sol` at `75565920` (L196 `onlyByGovernor`; L257-278 governor functions). https://github.com/kleros/kleros/blob/755659207c14051af9f30b7e20e98c0b9b2dd844/contracts/kleros/KlerosLiquid.sol#L196-L278
- [S17] ERC-792 arbitration standard docs. https://erc-792.readthedocs.io/en/latest/implementing-an-arbitrable.html
- [S18] UMA docs, "How does UMA's Oracle work?" and "Setting custom bond and liveness parameters." https://docs.uma.xyz/protocol-overview/how-does-umas-oracle-work ; https://docs.uma.xyz/developers/setting-custom-bond-and-liveness-parameters
- [S19] Circle Research, "Refund Protocol: non-custodial dispute resolution for stablecoin payments," April 17, 2025 (updated May 4, 2026). https://www.circle.com/blog/refund-protocol-non-custodial-dispute-resolution-for-stablecoin-payments
- [S20] ClawBank, "AI Agents Have a Court Now," September 11, 2026, mirrored on YouMind. https://youmind.com/landing/x-viral-articles/ai-agent-court-legal-dispute [vendor-only]
- [S21] GenLayer docs, "Optimistic Democracy." https://docs.genlayer.com/understand-genlayer-protocol/core-concepts/optimistic-democracy
- [S22] AgentMarketCap, "Nava's $8.3M Bet," April 15, 2026. https://agentmarketcap.ai/blog/2026/04/15/nava-agent-escrow-layer-autonomous-financial-transactions [secondary]
