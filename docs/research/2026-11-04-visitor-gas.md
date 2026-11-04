# A visitor's agent appeals on Sepolia without Sepolia ETH

Research pass for Rafa's "Yes, plan it" (2026-11-04), answering the proposal to plan how a new website visitor's agent, which holds test tUSDC from the faucet and no Sepolia ETH, appeals a decision on the Sepolia demo. The pass also lists every other step where a visitor or an outside adjudicator needs its own Sepolia ETH today. Rafa decides; this note recommends.

Every claim is labelled **measured** (run, or read in the code of the `t-223-appeal-gas` worktree at commit dd0a55a, on 2026-11-04), **documented** (stated in a doc, a task file or a source fetched today), **inferred** (arithmetic or a reading of the code that I did not run) or **guessed**. Nothing here sent a transaction or deployed anything; the gas figures come from a throwaway local anvil.

## Summary

**Recommendation: option (b), the relayed permit.** The appellant signs one more typed-data message, an EIP-2612 `Permit` under the token's own domain, which `POST /v1/prepare/appeal` returns as a second slot beside the `Appeal`. The operator relays `tUSDC.permit` and `HoldbackRules.fileAppeal` in one Multicall3 call, as it already relays the operator fee with the funding. No contract changes, no redeploy, and the same path works on Circle's USDC. Confidence: **high** on the direction; **medium** on the exact body shape, which the ADR settles.

What the pass found:

1. **One allowance is the whole obstacle.** `HoldbackRules.fileAppeal` relays anyone's signed appeal and never reads `msg.sender`; `HoldbackBonds.takeAppealBond` pulls the bond with `transferFrom`, so the appellant must have approved the vault first, and an `approve` is a transaction it pays for (measured, §2.2). Every other visitor step is relayed and free.
2. **Both tokens have `permit`.** tUSDC is Solady's ERC20 v0.1.1, which implements EIP-2612 `permit`, `nonces` and `DOMAIN_SEPARATOR` under the same domain the funding signature uses (measured). Circle's FiatToken has `permit` since v2 and a contract-wallet overload since v2.2 (documented, fetched today). The ABI the adapter ships already carries `permit` and `nonces` (measured).
3. **The cost is small and bounded.** A relayed `permit` costs 73,884 gas and `fileAppeal` 108,396 gas on anvil (measured), about 0.4 to 0.6 million gas together on Sepolia (inferred): a quarter to a third of a deal's 1,636,242 gas. One appeal per deal is the contract's rule, so the exposure is a factor on deals the operator already pays for, never a new drain.
4. **The gas drip is the wrong tool for this.** Sepolia ETH is scarce and traded, so a drip from a faucet with no CAPTCHA is farmable; it puts chain mechanics back in front of the agent; and nothing of it carries to mainnet.
5. **What still needs its own ETH after (b):** an outside adjudicator's `deposit` and `withdraw` (the contract bonds `msg.sender`), minting tUSDC yourself when the faucet's day budget is spent, and any direct call. The first is the contract change the backlog already holds, narrowed to the deposit, at T-212's redeploy; the last two are the escape hatch by definition.

Two side findings: the contract accepts a zero appeal bond, so an agent that writes `bond: 0` into its own `Appeal` can already appeal through the API with no allowance and no ETH (§2.7, D43's known residual); and prepare's check text promises a 25 tUSDC appeal fee that the chain never collects (Low, §2.7).

## 1. The question

`site/llms.txt` (line 415) says: "On Sepolia, an appeal needs your own test ETH. The bond moves from you through HoldbackBonds, so the appellant first approves tUSDC to HoldbackBonds from its own address, a transaction it pays for." The honest limits repeat it (lines 497 and 499). A visitor's agent that followed the pinned command has tUSDC and a mandate from the faucet and no Sepolia ETH, so it cannot appeal. Rafa asked for a plan.

The options weighed: (a) a gas drip from the funding lane; (b) a relayed EIP-2612 permit; (c) gasless bonds in `HoldbackBonds` through ERC-3009 `receiveWithAuthorization`; (d) EIP-7702 or a paymaster; and (e), found while measuring, a zero appeal bond on the demo.

## 2. What I measured

### 2.1 Every step and who pays its gas today

| Step | Who sends the transaction today | Needs the visitor's own ETH? | Label |
| --- | --- | --- | --- |
| Faucet grant (mint 1,000 tUSDC and a mandate) | the funding lane, `LiveChain.mint` | No | measured, `apps/demo-cloud/src/world.ts:763-771`, `packages/settlement/evm/live.ts:246-251` |
| Offer, adjudicator acceptance, agreement | nobody: off chain until funding | No | documented, ADR-0028 §2 |
| Agree and fund, with the operator fee | the deal lane (commitment ID modulo 3) | No | measured, `evm-settlement.ts:879-930`, `live.ts:126-129` |
| Delivery, decision, early accept, mutual settlement | the deal lane | No | measured, `evm-settlement.ts:1031-1055`: `from` is `options.sender` or `senderFor(id)`; the operator passes no sender (`apps/operator/src/server.ts:756`) |
| Timeout triggers (`expire-offer`, `reclaim`, `fallback`, `default`, `appeal-expiry`) | the deal lane, from `POST /v1/commitments/{id}/triggers/{kind}` | No | measured, `evm-settlement.ts:969-1008`; `spec/openapi/paths.json` `triggerTimeout` |
| **Appeal: the bond allowance** | **the appellant**, `tUSDC.approve(HoldbackBonds, bond)` | **Yes** | measured, `HoldbackBonds.sol:96-102`; `llms.txt:415` |
| Appeal: `fileAppeal` itself | the deal lane | No | measured, `evm-settlement.ts:792-799` |
| Outside adjudicator: bond deposit and withdrawal | the adjudicator, `approve` then `deposit`; `withdraw` | **Yes** | measured, `HoldbackBonds.sol:55-68` (`msg.sender`); the demo's three get 0.005 ETH from the funding lane for it, `world.ts:147-148`, `live.ts:401-417` |
| Minting tUSDC yourself once the faucet's 600 mints a day are spent | the visitor | **Yes** | measured, `world.ts:838` says so in the 429 |
| The escape hatch: any direct call to the contracts | the visitor | **Yes**, by definition | documented, `docs/neutrality.md:25`; ADR-0028 §3 |

Today an appeal relayed for an address with no allowance fails at the simulation step with `insufficient_funds` (`InsufficientAllowance`, `packages/settlement/evm/errors.ts:25`) and nothing is sent (inferred from `send`'s order: simulate, then send).

### 2.2 The appeal path in the contracts

- `HoldbackRules.fileAppeal(Terms, Appeal)` (`contracts/src/HoldbackRules.sol:503-518`) checks: stage `Released` or `Refunded`; appeal state `None`; `block.timestamp < t1 + appealWindowSec`; the appellant is the party the decision went against (T-206 L-7); and the appellant's signature over `appealHash(id, appellant, tokenHash, a)`, which covers `bond` (`HoldbackTypes.sol:389-397`). Then it sets the appeal open and calls `BONDS.takeAppealBond(id, appellant, t.token, a.bond)`. It checks no minimum bond and collects no appeal fee (the adapter says so, `evm-settlement.ts:795`; D43). **Measured.**
- `HoldbackRules` reads `msg.sender` nowhere (`grep -c msg.sender`: 0), so anyone may relay the appeal. **Measured.**
- `HoldbackBonds.takeAppealBond` (`HoldbackBonds.sol:96-102`) is `onlyRules`, refuses a second appeal bond for the commitment, records `{appellant, amount}` and pulls with `token.safeTransferFrom(appellant, address(this), amount)`. That `transferFrom` is what needs the allowance. `payAppealBond` later pays it into the decider's bond or back to the appellant. **Measured.**
- `HoldbackBonds.deposit` credits `msg.sender` and `withdraw` pays `msg.sender` (`:55-68`); a deposit for someone else is Phase 4 (the comment on `:54`). So an outside adjudicator's bond cannot be relayed today. **Measured.**
- `TestUSDC.receiveWithAuthorization` requires `to == msg.sender` (`contracts/script/TestUSDC.sol:69`), as USDC's does. Only the vault itself could redeem an ERC-3009 authorization paid to the vault, and the vault has no such function: option (c) is a contract change. A `transferWithAuthorization` to the vault would move tokens that nothing credits. **Measured.**
- `HoldbackBonds` is created in `HoldbackRules`' constructor (`BONDS`, `packages/settlement/evm/world.ts:264-270` reads it after deploying the rules), so a new vault is a new rules address, a new `verifyingContract` and a fresh world. **Measured.**

### 2.3 The tokens: `permit` on tUSDC and on USDC

- tUSDC is `TestUSDC is ERC20` from Solady (`contracts/script/TestUSDC.sol:4,13`); the remapping `solady/=lib/commerce-payments/lib/solady/src/` points at the submodule pinned to `5ea5d9f`, Solady v0.1.1 (`git submodule status`). **Measured.**
- Solady's ERC20 implements EIP-2612: `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)` (`ERC20.sol:389`), `nonces(address)` (`:375`, sequential) and `DOMAIN_SEPARATOR()` (`:472`), typehash `Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)` (`:116-118`). The domain uses `keccak256(bytes(name()))` when `_constantNameHash()` is zero, which `TestUSDC` does not override, and the default version hash `keccak256("1")` (`:355-360, 408-411`). So a `Permit` is signed under the very domain the funding and fee authorizations already use: "Crow Test USDC", "1", chain 11155111, the token address, separator `0x6a0916d6…` as `contracts/deployments/sepolia.json` records. `TestUSDC` turns Permit2's infinite allowance off, as USDC has it (`TestUSDC.sol:97-100`). **Measured.**
- The adapter's token ABI (`packages/settlement/evm/abis.json`) already lists `permit` and `nonces`, and the multicall ABI `aggregate3`. **Measured.**
- `permit` on anvil, Prague, Solady's code (measured with a throwaway script against the forge artifact): relayed by another account into cold allowance and nonce slots **73,884 gas**; a second permit by the same owner (warm nonce, allowance overwritten) 39,684 gas; the owner's own `approve` into a cold slot 45,802 gas; the spender's `transferFrom` afterwards, estimated, 56,582 gas; the permit calldata is 228 bytes; a replay of the first permit reverts `InvalidPermit()`.
- Circle's USDC (fetched 2026-11-04 from the `master` branch of `circlefin/stablecoin-evm`, **documented**): `FiatTokenV2` (`pragma solidity 0.6.12`, `is FiatTokenV1_1, EIP3009, EIP2612`) has `permit(owner, spender, value, deadline, v, r, s)` under `whenNotPaused`; `EIP2612.sol` keeps `mapping(address => uint256) private _permitNonces`, checks `deadline == type(uint256).max || deadline >= now`, hashes the same typehash `0x6e71edae…`, and verifies with `SignatureChecker.isValidSignatureNow`, so a contract wallet's EIP-1271 signature passes; `FiatTokenV2_2` adds `permit(owner, spender, value, deadline, bytes signature)` and signs under domain version "2". The on-chain implementation version of mainnet USDC was not re-checked here (D42 measured Sepolia's as an upgradeable proxy). Solady's `permit` is `ecrecover` only, so a smart-account appellant cannot permit tUSDC; on USDC v2.2 it can.

### 2.4 Gas

Anvil, Prague, the adapter's own paths (`pnpm --filter ./packages/settlement build`, then `node packages/settlement/dist/evm/gas.js`, run today after a rebuild; the shipped `dist` was stale and signed under the old domain). **Measured.**

| Path | Transactions and gas |
| --- | --- |
| Party appeal, reject, seller appeals, upheld | `agreeAndFund` 233,970 + `decide` 163,944 + **`fileAppeal` 108,478** + `decide` 106,055 = 612,447 |
| Party appeal, accept, buyer appeals, overturned | `agreeAndFund` 233,970 + `decide` 164,347 + **`fileAppeal` 108,396** + `decide` 125,180 = 631,893 |
| Happy path, decision carries the delivery | 233,994 + 164,347 = 398,341 |
| Operator fee bundled with the funding | `agreeAndFund` (Multicall3 bundle) 300,324 + `decide` 164,371 |

Forge, isolated calls (`forge test --isolate --gas-report --match-test "[Aa]ppeal"`, 23 tests passed): `fileAppeal` median 108,348 gas over 15 calls (min 53,800 when it reverts early); `expireAppeal` 47,570 to 74,134 gas. **Measured.**

Sepolia, the 0.7 deployment (T-212 Handoff, **documented**, measured there from receipts on 2026-11-04): funding with the fee 938,593; delivery 173,119; decision 524,530; total 1,636,242 gas per deal; a bond deposit 244,975; the approve and deposit pair 372,709; a faucet mint 130,000 to 240,000. Sepolia's figures run 2.1 to 3.2 times anvil's (938,593 / 300,324 = 3.1; 524,530 / 164,347 = 3.2; 173,119 / 83,559 = 2.1; arithmetic on the two tables).

So on Sepolia (**inferred** from those ratios): the permit and `fileAppeal` bundle about 0.4 to 0.6 million gas; the appeal decision about 0.25 to 0.4 million; `expireAppeal` about 0.1 to 0.2 million. An appealed deal costs the operator about 0.75 to 1.2 million gas more than the 1.64 million it pays anyway: 0.0008 to 0.0012 Sepolia ETH at the 1 gwei median tip, 0.015 to 0.024 at the 20 gwei cap the node refuses to pass (arithmetic).

The contracts' sizes (`forge build --sizes`, today, **measured**): `HoldbackRules` 24,313 bytes of runtime, **263 bytes under EIP-170**; `HoldbackBonds` 2,676 bytes, 21,900 under; `TestUSDC` 3,538 bytes. No contract file changed since the deploy commit `64be1f1` (`git log 64be1f1..HEAD -- contracts/src` is empty).

### 2.5 The relayer, the faucet and the budget

All **measured** in `packages/settlement/evm/live.ts` and `apps/demo-cloud/src/world.ts` unless labelled.

- Lanes: one secret is the funding lane and derives three deal lanes (`DEAL_LANES = 3`, `laneKey`); a commitment keeps lane `id mod 3`; each lane sends one transaction at a time. `GAS_CAP` 3,000,000 after the 25 % pad (`live.ts:114, 310`). Fees: twice the base fee plus the median tip of 20 blocks, clamped to 0.1 to 2 gwei, refused above `maxFeeGwei` (default 20) with `RelayRefused` (`:370-383`), which the adapter turns into `relay_refused` with "submit the same signed message through another operator or directly" (`evm-settlement.ts:1053`).
- The funding lane tops up any deal lane under 0.01 ETH to 0.03 ETH (`world.ts:150-151`), gives each demo adjudicator 0.005 ETH for its own approve and deposit (`:147-148`), and mints for the faucet.
- Faucet: 1,000 tUSDC per address per 3,600 s, 10 addresses per client (IP) per hour, 600 mints a day (`world.ts:368-370, 153`); a mint goes six to a Multicall3 call (`live.ts:119`).
- Funding: Rafa put 1.94 Sepolia ETH on the funding lane on 2026-11-03 (ADR-0028, **documented**); round 1's master address holds 2.5 (T-216, **documented**). The test seller at its day cap adds about 0.19 ETH a day at 1 gwei (D47, **documented**).
- The demo club's rulebook is `SIM_RULEBOOK` with the minimum windows overridden (`world.ts:322`): `appealBondRateBps` 500, `appealFee` 25 tUSDC (`packages/settlement/sim/actors.ts:66, 73`). A 25 tUSDC deal's appeal bond is 1.25 tUSDC, which the faucet's grant covers 800 times over.

### 2.6 The API and the agent side today

- `POST /v1/prepare/appeal` (`apps/operator/src/prepare.ts:502-529`) returns one slot, `signature`, the `Appeal` under the Holdback domain, with `bond` fixed at the rulebook rate and a check line that names the bond and the fee. **Measured.**
- `prepare/agree-and-fund` (`:355-437`) is the precedent for a token-domain slot: when the operator serves a chain, `ctx.erc3009` (`Erc3009Signing`, `:100-103`) supplies the `ReceiveWithAuthorization` and `TransferWithAuthorization` typed data, the slots carry `typedData` and `digest` instead of a Holdback message, and the check text names the token's domain. It is wired at `apps/demo-cloud/src/world.ts:450` and `apps/operator/src/server.ts:919`. **Measured.**
- `appeal.schema.json` is closed (`additionalProperties: false`) and the OpenAPI `submitAppeal` body is `Appeal` itself (`spec/openapi/paths.json:460-469`); the schema is v0.9. A new body member is a schema change: an ADR and a version bump (hard rule). T-221 plans the additive 0.10. **Measured.**
- `examples/verify.ts` pins the token domain and the two ERC-3009 types from the deployment (`:25, 43, 65, 87`) and verifies the funding and fee slots against its own intent (`:260-274`); `site/llms.txt` lists those types (`:465-466`) and the pinned deployment (`:87`), which names `tokenDomain`, `escrow`, `collector`, `rules` and `expiryMarginSec` and **not `bonds`**; `site/check.mjs` matches the types against `verify.ts`. **Measured.**
- `errors.ts` maps Solady's `InsufficientAllowance` to `insufficient_funds` and knows no `InvalidPermit` or `PermitExpired`; FiatToken's string reverts "EIP2612: invalid signature" and "permit is expired" already match `BY_MESSAGE`. **Measured.**
- The adapter's fee bundle (`evm-settlement.ts:901-928`) is the template: `aggregate3` on the canonical Multicall3 (`0xcA11bde0…`, code hash pinned in the deployment file) with two calls, both `allowFailure: false`, and a pre-check for a front-run fee transfer (`nonceUsed`, `feePaidEarlier`). **Measured.**
- On Sepolia no fallback or appeal adjudicator can prove its drand seed until T-217 ships through T-220, so a filed appeal waits for `expireAppeal`, which returns the bond and leaves the first decision standing (`HoldbackRules.sol:573-592`; ADR-0028 §11). **Documented.** Round 1's scenarios 6 and 7 (appeal upheld, appeal overturned) are blocked today by, among other things, "the appellant's own gas for the bond approval" (T-216, **documented**).

### 2.7 Two things I did not expect

- **A zero-bond appeal needs no allowance.** The contract checks no minimum bond (D43), the adapter mirrors `requiredBond: p.bond` (`evm-settlement.ts:797`), the operator's relay path reads `appealBondRateBps` nowhere (grep: `sim-world.ts:316` only, which serves the club), and Solady's `transferFrom` of 0 against an allowance of 0 passes (`gt(amount, allowance_)` is false; `ERC20.sol:313-316` is the branch `TestUSDC` runs, since it turns Permit2's allowance off). So an agent that builds its own `Appeal` with `bond: {amount: "0"}` appeals through the API today with no ETH. **Measured in the code, not run.** It is D43's recorded residual ("free appeals now have a price at stake"), and a minimum appeal bond in the signed terms is T-212's before-mainnet item. The gas obstacle this note solves exists only for the rulebook's bond, which is the one the demo should post.
- **Low · prepare's check text promises a fee the chain never takes.** `prepare/appeal` says "you post a bond of 1.25 tUSDC … and a fee of 25 tUSDC, 26.25 tUSDC in all, from your balance" (`prepare.ts:525`), while on a chain the adapter files with `requiredFee: zero, feePaid: zero` (`evm-settlement.ts:796-797`) and the contract collects nothing. Impact: a careful agent that compares the text with the chain refuses to sign, or signs expecting a charge that never comes. T-224 fixes the text on chain worlds. **Measured.**

## 3. The options compared

| | (a) Gas drip | (b) Relayed permit (recommended) | (c) ERC-3009 into `HoldbackBonds` | (d) EIP-7702 or an ERC-4337 paymaster | (e) Zero appeal bond on the demo |
| --- | --- | --- | --- | --- | --- |
| What the agent does | asks the faucet for ETH, then builds, signs and sends its own `approve` transaction | signs a `Permit` typed message beside the `Appeal`; posts both to the API | signs an ERC-3009 authorization beside the `Appeal` | sets code on its key (7702) or runs a smart account (4337), signs a batch intent | nothing new |
| Contract change | none | **none** | yes: new `HoldbackBonds`, so a new `HoldbackRules`, domain, world, demo bonds; `fileAppeal`'s ABI likely grows against 263 bytes of headroom | none in Holdback; a delegate contract or an account, entry point, bundler and paymaster | none; a rulebook change applies only to a fresh world |
| Operator relays, never authors | yes, but the agent now sends | **yes**: both messages are the appellant's | yes | yes, with a third party's contract in the write path | yes |
| If the operator refuses | the agent has ETH and sends itself | the appellant sends `permit` + `fileAppeal` itself or through another operator; the permit alone can only set the vault's allowance | the same, with the authorization | the sponsor is the operator; the agent falls back to its own gas | as today |
| Bounded loss (D26) | the drip itself is given away | the permit is exactly the bond, expires at `appealBy`, spendable only by the vault on the appellant's own appeal | the authorization is the bond, with a window and a nonce | depends on the delegate's code | the appellant risks nothing; the decider's bond is locked for `appealDecideSec` by a free appeal (L-3) |
| Gas, who pays | the drip (21,000) plus the agent's `approve` (45,802 anvil); the operator gives away the rest of the drip | the deal lane: 73,884 + 108,396 anvil, 0.4 to 0.6 M Sepolia (inferred); recovered in the fee quote (D33) | the deal lane, about the same | the sponsor pays; 4337 adds entry-point overhead | nothing extra |
| Abuse and budget | Sepolia ETH is scarce and traded, so a no-CAPTCHA drip is farmable by IP rotation: 600 × 0.001 ETH = 0.6 ETH a day, the funding lane in about three days (arithmetic); a separate cap of 50 a day bounds it at 0.05 | one appeal per deal (`AppealBondExists`, `WrongAppealState`), so at most about +75 % on a deal the operator already pays (inferred) | as (b) | new attack surface in the delegate or account code | free appeals lock bonds and, on an overturn, win the price with nothing at stake |
| Mainnet | no: nobody gives away real ETH | **yes**: USDC has `permit` since FiatToken v2, EIP-1271 since v2.2 | yes: USDC has ERC-3009 | yes, with wallet standards agents must adopt | no: D43 says a minimum appeal bond blocks mainnet |
| Simple API, hard protocol | chain mechanics return to the agent | one more typed-data slot of a kind the agent already signs | one more slot, and a redeploy | machinery | simplest, and dishonest |
| Work | small: faucet option, cap, docs | medium: ADR, additive schema bump, adapter bundle, prepare slot, `verify.ts`, `llms.txt`, tests | large: contract, tests, deploy, re-pin, fresh world | large | tiny |
| Verdict | not now; keep the backlog row for the escape hatch | **build** | narrow to `depositWithAuthorization` at T-212's redeploy | no | no |

## 4. Each option against the tests

### (a) A gas drip

The faucet or the funding lane sends an admitted agent a little Sepolia ETH, as the world gives each demo adjudicator 0.005 ETH (`world.ts:147`).

- **Litmus tests and hard rules.** It passes them: a gift of test ETH touches no hold, no judgment and no signature. The relayer keeps relaying; the agent sends its own `approve`.
- **D26, D31, D32.** Neutral on all three. It does make the agent responsible for a chain transaction, which `CLAUDE.md` says agents should not see ("any blockchain stays behind the API"), and `try.mjs` and the test seller never send one today (D47).
- **Abuse and budget.** This is the real objection. tUSDC is worthless and open-mint, so nobody farms it; Sepolia ETH is rationed behind CAPTCHAs and sold, so a drip from a faucet whose only limits are per address per hour and 10 per IP per hour is worth farming by rotating addresses and IPs. At 0.001 ETH a grant and the faucet's 600 mints a day, the worst day costs 0.6 ETH, about three days of the funding lane's 1.94 ETH (arithmetic). A separate cap, 50 a day as the Sepolia research proposed (`docs/backlog.md`, "the faucet's optional test ETH"), bounds it at 0.05 ETH a day and also bounds the demo: the 51st appellant of the day waits.
- **Who pays.** The operator, with no fee to recover it (the drip is outside any deal). Unused dust stays in visitors' keys.
- **Work.** `apps/demo-cloud/src/world.ts` (the faucet's `{"gas": true}` option, a day cap, the discovery note), `live.ts` (a send of value), `llms.txt`, the agent's own transaction code in `examples/`.
- **Mainnet.** None. A real operator does not give ETH away; the agent would need ETH anyway.
- **Where it still fits.** It is the only option that also covers the escape hatch and an outside adjudicator's `deposit` without a contract change. Round 1 covers both from its master address (T-216 question 4), so the demo does not need it yet. Keep the backlog row, Rafa's call.

### (b) A relayed permit

The appellant signs an EIP-2612 `Permit {owner: appellant, spender: HoldbackBonds, value: bond, nonce: nonces(appellant), deadline: appealBy}` under the token's domain. The operator relays `tUSDC.permit(owner, spender, value, deadline, v, r, s)` and `HoldbackRules.fileAppeal(terms, appeal)` in one Multicall3 `aggregate3` call, both `allowFailure: false`. `permit` ignores `msg.sender` and recovers the owner from the signature; `fileAppeal` reads no `msg.sender`; `takeAppealBond` sees `msg.sender == RULES` because the rules contract calls it. **Measured in the code; the bundle itself was not run** (the fee bundle, which has the same shape, runs on anvil in the adapter's tests and on Sepolia every deal).

- **Neutrality (ADR-0001).** Passes. The operator relays two signed messages and authors neither. When it refuses, the appellant sends the same `permit` and `fileAppeal` itself (its own ETH, the escape hatch) or hands both to another operator; nothing in them names the operator. What an operator holding the signed permit can do: set an allowance from the appellant to the vault. What the vault does with an allowance: pull it in `takeAppealBond`, which only `RULES` calls, only inside `fileAppeal`, only after checking the appellant's own signature over the bond and the commitment. So the operator cannot move the bond anywhere, cannot change its amount, and cannot use the permit after `appealBy`. Delaying the relay past `appealBy` is today's `relay_refused` case (D27), with the same remedies. Fixture: `neutrality.operator-refuses-appeal-relay` (anvil): the node refuses, the appellant sends both calls directly, the appeal opens, the bond moves once.
- **The hold (ADR-0002).** Untouched. The appeal bond is the appellant's own balance moving into the vault, as today; the escrow in CPP never changes.
- **Defended judgment (ADR-0006).** Strengthened in one respect: the rulebook's appeal bond becomes postable by any agent, so the deterrent behind "appeals are backed by bonds" no longer depends on holding ETH.
- **Hard rules.** No real money (Sepolia, tUSDC). No admin keys (no contract change). Secrets: none new. Money as base-unit strings: `value` is one. Signed messages: two signatures by the appellant; the operator strips `bondPermit` before it verifies the `Appeal` signature, which covers the `Appeal` struct only. Idempotency: as today; the body now carries the permit's nonce, so a changed nonce under the same key is a 409. Deliverables, code execution, pinned models: not touched. The contract: `spec/schemas/` changes through an ADR and an additive version bump.
- **D26.** The appellant risks the bond and nothing else: the permit's `value` is the bond, its `deadline` is `appealBy`, and the only spender is the vault. A permit relayed alone (the front-run below) leaves a standing allowance of exactly the bond to the vault, which is inert.
- **D31.** Prepare proposes the exact value, nonce and deadline; the agent may sign a larger value or a later deadline if it wants (the contract accepts any bond at or above zero). The API refuses only a permit settlement cannot use: another spender, another token, another owner, or a value below the appeal's bond (self-contradictory with the signed `Appeal`).
- **D32.** The appellant checks the slot before signing, as `verify.ts` checks the funding and fee slots today: `spender` equals the pinned `bonds` address, `value` equals the bond it computed, `deadline` is `appealBy`, `owner` is itself. The protocol adds nothing for an agent that skips the check; the loss is still bounded by the bond.
- **The front-run.** Anyone who sees the bundle in the mempool can relay the permit alone. The allowance is then set and the bundle would revert on the used nonce. Rule: before bundling, the adapter reads `allowance(appellant, bonds)`; when it already covers the bond, it sends `fileAppeal` alone and ignores the permit. The same read serves an appellant that approved with its own ETH, which keeps that path open. No payment proof is needed, unlike the fee's `feePaidEarlier`: an allowance is a state the chain reports directly. Fixture: `attack.appeal-permit-front-run` (anvil): a stranger relays the permit first; the node then files alone; the bond moves once.
- **The nonce.** EIP-2612 nonces are sequential, so prepare reads `nonces(appellant)` and fixes it in the body. If the appellant signs another permit on the same token in between, the relayed permit reverts `InvalidPermit`, the API answers `invalid_signature`, and the agent prepares again. Rare for a demo agent; stated in the check text.
- **Who pays the gas.** The deal lane, as for every relayed call. ADR-0023 §5 keeps appeals free of the operator fee, and D33's amendment says a deal that needs more transactions "costs the operator the difference". On the demo that difference is test ETH: about 0.4 to 0.6 million gas for the bundle, plus the appeal decision and `expireAppeal` later (§2.4). Keep that for now. Before mainnet, T-215's live quote can carry an appeal part as an operator parameter, or an operator can charge a per-appeal `TransferWithAuthorization` as a third call in the same Multicall3 bundle; either is an ADR-0023 amendment, not a protocol step, and neither is needed for the demo.
- **Mainnet.** USDC's `permit(owner, spender, value, deadline, v, r, s)` exists since FiatToken v2 and the `bytes signature` overload since v2.2 (§2.3). The adapter uses the `(v, r, s)` form on both tokens and may use the `bytes` form on USDC for a contract-wallet appellant. The token issuer's pause and blacklist are out of scope (the assets module).
- **Work, by file** (contracts untouched):
  - `docs/decisions/ADR-0031-appeal-bond-by-permit.md` (new): the slot, the body member, the bundle, the allowance pre-check, the front-run rule, the version bump, the litmus tests.
  - `spec/schemas/`: an `AllowancePermit` definition (`token`, `owner`, `spender`, `value`, `nonce`, `deadline`, `signature`) in `messages.schema.json` or `common.schema.json`; an `AppealRequest` that wraps `Appeal` with optional `bondPermit`, as `AgreeRequest` wraps `Agree` with `fund` and `operatorFee`; `spec/openapi/paths.json` (`submitAppeal` body, `prepareAppeal` description), `spec/openapi.json` regenerated, `spec/examples/`, every `$id` to the new version.
  - `packages/core/src/types.ts` and `parse.ts` (the request parser). Nothing in `eip712.ts`: `Permit` is the token's type, not Holdback's.
  - `packages/settlement/src/interface.ts` (`Submission.appeal` gains `bondPermit?`); `packages/settlement/sim/simchain.ts` ignores it (the sim ledger moves the bond without an allowance).
  - `packages/settlement/evm/evm-settlement.ts`: an `appealBondPermitTypedData(appellant, bond, appealBy)` builder that reads `nonces` (the typed-data helper beside `fundingTypedData`, `:556-569`); in `process` case `'appeal'`, the allowance read, the bundle through `send` to Multicall3 (as `fund` does, `:917-928`), the checks on spender, owner, token and value; `errors.ts`: `InvalidPermit` to `invalid_signature`, `PermitExpired` to `deadline_passed`; anvil tests: the bundle, an allowance already in place, the front-run, a wrong spender, an expired permit, a replay, and the parsed `appeal.filed` event with its `tx`.
  - `apps/operator/src/prepare.ts` (`appeal`: the second slot when the operator serves a chain and the allowance is short; the check text, which also stops promising the fee on chain worlds), `server.ts` (the request body; `bondPermit` stripped before the `Appeal` signature check; `submissionsOf`), `sim-world.test.ts` and `operator.test.ts`.
  - `apps/demo-cloud/src/world.ts:450` (wire the builder beside `funding` and `operatorFee`), `world.test.ts`.
  - `examples/verify.ts` (a `Permit` type under `tokenDomain`; the slot check against the pinned `bonds` address, the bond, `appealBy` and the signer), `examples/sign.ts` (the `appeal` intent), `examples/agent.ts` (an `appeal` operation, so round 1's driver and a later `try.mjs --outcome appeal` can use it), `examples/deployments.ts` and its test if `bonds` is not pinned there yet.
  - `site/llms.txt`: the appeal section (line 414 to 415), the honest limits (497, 499), the pinned deployment gains `bonds`, the EIP-712 type list gains `Permit`; `site/check.mjs`.
  - `docs/api.md` (the `appeal` prepare row and the verification checklist), `docs/neutrality.md` (operator row: may relay a token permit; cannot use one), `docs/decisions/ADR-0023-operator-fee.md` (one line: appeal gas stays inside the quote until T-215), `docs/backlog.md` (narrow the "Gasless bonds" row to the deposit and withdrawal; keep "the faucet's optional test ETH" for the escape hatch; a T-215 row for an appeal part of the quote), `docs/plan.md` (the T-224 row), `docs/tasks/T-216-*.md` (scenarios 6 and 7 no longer need the appellant's ETH), `docs/tasks/T-221-*.md` (the deposit stays own-ETH until the redeploy), `docs/decisions-today.md` (D48).
  - Fixtures: the two named anvil tests above. The SimChain scenario fixtures should show no snapshot diff.

### (c) Gasless bonds in `HoldbackBonds` through ERC-3009

A `depositWithAuthorization(from, token, value, validAfter, validBefore, nonce, signature)` on the vault calls the token's `receiveWithAuthorization(from, address(this), …)` and credits `bondOf[from]`; `withdraw` by signature needs an EIP-712 domain on the vault; and for appeals either `fileAppeal` carries the appellant's authorization (seven more arguments through `HoldbackRules`, whose runtime has 263 bytes left; the growth is unmeasured and likely larger, **guessed**) or the vault keeps a per-commitment "appeal credit" with its own refund path when no appeal follows (more state and a new step, which D26 counsels against).

- **Litmus tests and hard rules.** Passes; the vault stays without admin keys. The redeploy is the cost: a new `HoldbackRules`, a new `verifyingContract` and domain, a fresh world, three new demo bonds, re-pinned `llms.txt`, `try.mjs` and `examples/deployments.ts`, and a round that tests a deployment nobody has run (the T-221 research said the same, §4 there).
- **What it buys that (b) does not.** The adjudicator's bond: `deposit` bonds `msg.sender`, and no permit can change that. An outside adjudicator registering through T-221 needs its own ETH for `approve` and `deposit` (372,709 gas measured on Sepolia, about 0.0004 ETH at 1 gwei) until this lands. Rafa already placed it at the redeploy ("gasless bond build later", D46).
- **Recommendation.** Keep it for the deposit and the withdrawal, in `HoldbackBonds` only, where 21,900 bytes are free; drop the appeal half, which (b) covers with no contract bytes and no redeploy. Design it in the ADR that accompanies T-212's remaining items.
- **Mainnet.** USDC has ERC-3009 (D42 measured both entry points on Sepolia's USDC).

### (d) EIP-7702, ERC-4337 and Permit2

- **EIP-7702** is Final (fetched today, **documented**): an EOA signs an authorization tuple that sets code on its account, and any sender may pay the gas for the transaction that carries it. The agent would delegate its key to a batch-executor contract it must trust and audit, sign a batch intent for `approve` and `fileAppeal` in that contract's own format, and the operator would send a type-4 transaction. That is three new trust decisions and a wallet standard in the agent's path, to achieve what one `Permit` signature achieves.
- **ERC-4337** needs a smart account, a bundler and a paymaster in front of the entry point: a third party and an account in the write path, which ADR-0028 rejected for hosted relayers, and `docs/plan.md:126` keeps in Phase 5 ("gas sponsorship or paymaster for agents"); D4's note says the same.
- **Permit2** does not remove the ETH: a token that does not grant Permit2 an allowance (USDC does not, and `TestUSDC` mirrors that) needs the owner's one-time `approve(Permit2)`, a transaction.
- **Verdict.** All three fail "simple API, hard protocol" for this problem. They stay in Phase 5 for agents that already run smart accounts.

### (e) A zero appeal bond on the demo

Set the demo rulebook's `appealBondRateBps` to 0 and no allowance is needed (§2.7). It is the cheapest change and the least honest: it removes the deterrent against free appeals, it needs a fresh world (a rulebook change applies to new worlds only, `docs/backlog.md`), T-216's scenario 6 expects the appellant's bond to move into the first adjudicator's bond, and D43 records that a minimum appeal bond blocks mainnet. Not recommended. The related finding stands on its own: the protocol lets an agent sign `bond: 0` today, and the fix is the minimum appeal bond in the signed terms (T-212, before mainnet).

## 5. Recommendation

**Build (b) as T-224, now, with no contract change.**

1. It removes the only own-ETH step in a visitor's deal, the appeal bond allowance, with one more typed-data signature of the kind the agent already produces for the funding and the fee, under the same token domain, prepared and checked the same way. The operator keeps relaying and never authors; refusal leaves both signed messages valid elsewhere.
2. It costs the operator about a quarter to a third of a deal's gas per appeal, bounded to one appeal per deal, and nothing new to defend: the permit can only set the vault's allowance, and a front-run is handled by one allowance read.
3. It carries to mainnet unchanged: Circle's USDC has had `permit` since FiatToken v2.
4. It unblocks round 1's scenarios 6 and 7 for the appellant's side and makes the `llms.txt` limit "appeals need your own ETH" false, which is the point of the question.

**Do not build (a) now.** Keep the backlog row for the escape hatch, Rafa's call when there is ETH to spare, with a cap of its own.

**Narrow (c)** to the adjudicator's `depositWithAuthorization` and a signed `withdraw`, for T-212's mainnet redeploy, as D46 already decided. Until then an outside adjudicator bonds from its own key, and `llms.txt` says so.

**State what stays own-ETH** in the honest limits: an outside adjudicator's deposit and withdrawal until the redeploy; minting tUSDC yourself once the faucet's day budget is spent; and any direct call to the contracts.

Confidence: high on (b) over the rest; medium on the body shape (`bondPermit` beside the `Appeal` versus a slot inside a wrapped request), which the ADR settles with the schema.

## 6. Draft decision entry: D48

> ## D48. Appeal bonds move by a relayed token permit; agents never need Sepolia ETH to appeal
>
> **Proposed 2026-11-04, after a Fable max-effort research pass (`docs/research/2026-11-04-visitor-gas.md`); Rafa asked for the plan ("Yes, plan it").** Decided under "autonomy inside the repo" when T-224 starts; Rafa may overrule any line. Today `llms.txt` says an appeal on Sepolia needs the appellant's own test ETH, because `HoldbackBonds.takeAppealBond` pulls the bond with `transferFrom` and the appellant's `approve` is a transaction it pays for. Every other step a visitor takes is relayed and free.
>
> - **The permit.** `POST /v1/prepare/appeal` returns, on a chain, a second slot `bondPermit.signature`: an EIP-2612 `Permit {owner: the appellant, spender: HoldbackBonds, value: the appeal bond, nonce: the token's nonce for the appellant, deadline: appealBy}` under the token's own EIP-712 domain, the domain the funding and the operator fee already use. The appellant signs it beside the `Appeal` and sends both in one body. tUSDC (Solady's ERC20) and Circle's USDC (FiatToken v2 and later) both implement `permit`, so the path is the same on mainnet.
> - **The relay.** The operator relays `permit` and `fileAppeal` in one Multicall3 call, as it relays the operator fee with the funding (ADR-0023's EVM amendment). Before bundling it reads the appellant's allowance to the vault; when the allowance already covers the bond (the appellant approved itself, or someone relayed the permit alone) it files the appeal alone. A permit by itself can only set an allowance to the vault, which only `fileAppeal` can spend, only on the appellant's own signed appeal, so the operator relays and never authors, and a refused relay leaves both signed messages valid for another operator or a direct call.
> - **Gas and the fee.** The deal lane pays, about 0.4 to 0.6 million gas per appeal on Sepolia (inferred from anvil's 73,884 for the permit and 108,396 for `fileAppeal`), a quarter to a third of a deal's 1,636,242. Appeals stay free of the operator fee (ADR-0023 §5); the fixed per-deal quote absorbs the difference on the demo (D33 as amended), and T-215's live quote may carry an appeal part as an operator parameter before mainnet.
> - **No contract change.** `HoldbackRules` keeps its 263 bytes of EIP-170 headroom. The gasless adjudicator bond (`depositWithAuthorization` and a signed `withdraw`, `HoldbackBonds` only) stays with T-212's mainnet redeploy, as D46 decided; the appeal half of that backlog row is closed by this entry. Until the redeploy an outside adjudicator bonds from its own key.
> - **Not chosen: a gas drip.** Sepolia ETH is scarce and traded, so a drip from a faucet without a CAPTCHA is farmable (about 0.6 ETH a day at the faucet's 600 grants, the funding lane in three days), it puts a chain transaction back in front of the agent, and nothing of it carries to mainnet. The backlog row for the escape hatch stays, capped, Rafa's call.
> - **Schema.** Additive: an `AllowancePermit` definition and an `AppealRequest` with optional `bondPermit`, in the next version bump (0.10 with T-221, or its own). The EIP-712 domain stays 0.7: `Permit` is the token's type, not Holdback's.
> - **Residual, recorded.** The contract accepts a zero appeal bond, so an agent that writes `bond: 0` into its own `Appeal` already appeals with no allowance; the deterrent exists only for the rulebook's bond, which this entry makes postable by anyone. The fix is the minimum appeal bond in the signed terms (T-212, before mainnet, D43).
>
> | Option | Effect |
> | --- | --- |
> | A gas drip from the funding lane | Demo-only; farmable; the agent sends its own transaction; nothing carries to mainnet |
> | A relayed EIP-2612 permit (chosen) | One more typed-data slot; no contract change; the same on USDC; about a third of a deal's gas per appeal |
> | ERC-3009 authorization into `HoldbackBonds` | Right for the adjudicator's bond, at T-212's redeploy; for appeals it costs a redeploy and `HoldbackRules` bytes for nothing (b) does not give |
> | EIP-7702 or an ERC-4337 paymaster | Wallet machinery in the agent's path and a third party in the write path; Phase 5 |
> | A zero appeal bond on the demo | Free appeals; a fresh world; dishonest about the protocol, which blocks mainnet without a minimum bond |

## 7. Draft task outline: T-224

The task number is T-224: T-223 is another session's task, the faucet's mandate renewal (coordinator, 2026-11-04). The worktree this note was written in keeps its earlier name, `t-223-appeal-gas`; the implementer opens its own `t-224-*` worktree.

> # T-224: Appeal bonds by a relayed permit
>
> - **Lane:** settlement (the EVM adapter), api (prepare and the route), core (the request type and parser), spec, demo (the wiring), docs
> - **Phase:** 2
> - **Depends on:** nothing in the contracts. The schema bump rides T-221's 0.10 or follows it as 0.11 (merge order decides). A decided appeal on Sepolia also needs T-217's drand proofs, shipped through T-220; the filing works before that, and `appeal-expiry` returns the bond. Round 1 (T-216) scenarios 6 and 7 consume it.
> - **Paths this task may touch:** `docs/decisions/ADR-0031-appeal-bond-by-permit.md` (new); `spec/schemas/` (`messages.schema.json` or `common.schema.json`, a new `AppealRequest`), `spec/examples/`, `spec/openapi/paths.json`, `spec/openapi.json`; `packages/core/src/types.ts`, `parse.ts` and tests; `packages/settlement/src/interface.ts`, `packages/settlement/sim/simchain.ts`, `packages/settlement/evm/evm-settlement.ts`, `errors.ts`, `encode.ts`, `abis.json` (no change expected: `permit` and `nonces` are there), tests; `apps/operator/src/prepare.ts`, `server.ts` and tests; `apps/demo-cloud/src/world.ts` and `world.test.ts`; `examples/verify.ts`, `sign.ts`, `agent.ts`, `deployments.ts` and tests; `site/llms.txt`, `site/check.mjs`; `docs/api.md`, `docs/neutrality.md`, `docs/decisions/ADR-0023-operator-fee.md` (one line), `docs/backlog.md`, `docs/plan.md`, `docs/tasks/T-216-*.md`, `docs/tasks/T-221-*.md`, `docs/decisions-today.md` (D48), this file. **Not** `contracts/`.
> - **Human gate:** no for the PR. The live deploy that carries it is T-220's (Rafa's go-ahead), or a later deploy.
> - **Status:** todo
>
> ## Intent
>
> Rafa, 2026-11-04: "Yes, plan it", for a visitor's agent with test tUSDC and no Sepolia ETH to appeal on the Sepolia demo. Restated: make the appeal bond's allowance a signature the operator relays, so an agent appeals through the API with no transaction of its own, the way it funds. Design: `docs/research/2026-11-04-visitor-gas.md`, option (b); the decision is D48.
>
> ## Context
>
> D43 (only the losing party appeals; the overturn pays from the decider's bond), D33 as amended (gas is part of the operator fee), ADR-0023's EVM amendment (the Multicall3 fee bundle and its front-run rule), ADR-0025 (token-domain signatures carried in API bodies), ADR-0028 §3 (relayer lanes relay and never author), T-212 (263 bytes of `HoldbackRules` headroom; the mainnet redeploy), T-216 scenarios 6 and 7, T-221 (the adjudicator's own bond stays own-ETH until the redeploy).
>
> ## Acceptance criteria
>
> - [ ] **ADR-0031, Proposed:** the slot, the body member, the bundle, the allowance pre-check, the front-run rule, the nonce rule, the version bump, who pays, the litmus tests, the mainnet path (USDC `permit`, the `bytes` overload for contract wallets).
> - [ ] **Schema, additive:** `AllowancePermit` and `AppealRequest` (an `Appeal` plus optional `bondPermit`); `submitAppeal` takes `AppealRequest`; an example; `pnpm validate:spec` green; every `$id` and the version header moved; the EIP-712 domain stays 0.7.
> - [ ] **Prepare.** On a chain world, `POST /v1/prepare/appeal` returns `bondPermit.signature` with `Permit` typed data under the token's domain (`owner` the appellant, `spender` the deployment's `bonds`, `value` the bond, `nonce` read from the token, `deadline` `appealBy`) when the appellant's allowance is below the bond, and one slot as today when it is not or on SimChain. The check text names the spender, the value, the deadline and the domain, and stops promising the appeal fee on chain worlds (the chain collects none). `defaults` carries the nonce and deadline.
> - [ ] **Relay.** The operator strips `bondPermit` before verifying the `Appeal` signature and passes it to the settlement submission. The EVM adapter: reads `allowance(appellant, bonds)`; files alone when it covers the bond; otherwise refuses a permit whose `spender`, `owner` or `token` is wrong or whose `value` is below the bond (`invalid_terms`), then relays `permit` + `fileAppeal` through Multicall3 on the deal's lane; maps `InvalidPermit` to `invalid_signature` and `PermitExpired` to `deadline_passed`; `appeal.filed` carries the transaction as today. SimChain ignores `bondPermit`.
> - [ ] **Anvil tests** (the adapter's harness, no impersonated allowance for the appellant): the bundle files and the bond moves once; an appellant that approved itself files without a permit; a stranger relays the permit first and the node files alone (`attack.appeal-permit-front-run`); a wrong spender, an expired permit and a replay are refused with nothing sent; the node refuses to relay and the appellant files directly with both calls (`neutrality.operator-refuses-appeal-relay`). Gas per transaction recorded in Evidence.
> - [ ] **Agent side.** `examples/verify.ts` verifies the new slot against its own intent (the pinned `bonds` address, the bond it computed, `appealBy`, itself as signer) and refuses anything else; `examples/sign.ts` and `examples/agent.ts` can file an appeal; `examples/deployments.ts` pins `bonds` if it does not.
> - [ ] **Docs and site.** `llms.txt`: the appeal section, the honest limits (what still needs your own ETH: an outside adjudicator's deposit and withdrawal until the redeploy, minting tUSDC yourself past the faucet's day budget, direct calls), the pinned deployment gains `bonds`, the type list gains `Permit`; `site/check.mjs` passes. `docs/api.md`, `docs/neutrality.md` (operator row), ADR-0023 (one line), `docs/backlog.md` (narrow the "Gasless bonds" row to the deposit; a T-215 row for an appeal part of the quote), `docs/plan.md`, T-216 and T-221 updated.
> - [ ] **Review.** `reviewer` and `red-teamer` with project context: this adds a token-level signature to a write route and a bundle the relayer sends. `pnpm verify` green; `pnpm snap` with no snapshot diff.
>
> ## Out of scope
>
> - Any contract change: the gasless adjudicator bond (`depositWithAuthorization`, a signed `withdraw`) is T-212's redeploy (backlog).
> - A gas drip from the faucet (backlog, Rafa's call).
> - An operator fee or gas part for appeals (T-215, before mainnet).
> - A minimum appeal bond in the signed terms (T-212, before mainnet, D43).
> - `try.mjs --outcome appeal` (a later slice once round 1 has run the path).
>
> ## Evidence
>
> Fill in before review; label each item measured, inferred or guessed.
>
> ## Handoff
>
> For T-220's `llms.txt` text, under "Appeal": "On Sepolia, prepare returns a second slot, `bondPermit.signature`: an EIP-2612 `Permit` under the token's domain that lets HoldbackBonds take exactly your bond until `appealBy`. Check `spender` against your pinned `bonds` address and `value` against the bond you computed, then sign both slots. The operator relays the permit and the appeal in one transaction and pays the gas. You never need Sepolia ETH to appeal; you do to bond your own adjudicator, to mint tUSDC yourself when the faucet's day budget is spent, and to call the contracts directly."

## 8. Open questions for Rafa

1. **One version bump or two?** Ride T-221's additive 0.10 (one re-pin for agents) or ship 0.11 on its own if T-221 slips. Recommendation: ride 0.10 if both land within the same deploy, else 0.11.
2. **Appeals stay free on the demo?** The fixed quote (4.70 tUSDC of test tokens) absorbs an appeal's gas at a loss, as D33's amendment foresaw. Recommendation: yes for the demo; price it in T-215's live quote before mainnet.
3. **The gas drip for the escape hatch and outside adjudicators:** still "when there is ETH to spare", with a cap of 50 a day? Round 1's master address covers the round, so nothing waits on it. Recommendation: leave the backlog row as it is.
4. **The zero-bond appeal (§2.7):** record it in D48 as a residual and leave the fix (a minimum appeal bond in the signed terms) with T-212 before mainnet, or pull it forward? Recommendation: record and leave; on the demo the tokens are worthless and the appeal adjudicators are Crow's.
5. **Should the pinned deployment in `llms.txt` name `bonds` now**, in the next site deploy, so agents can verify the permit's spender the day the slot ships? Recommendation: yes, with T-220.

## Appendix: commands and sources

- `forge build --sizes` in `contracts/` of the main checkout (the worktree's submodule is not initialised): `HoldbackRules` 24,313 bytes, margin 263; `HoldbackBonds` 2,676, margin 21,900; `TestUSDC` 3,538.
- `forge test --isolate --gas-report --match-test "[Aa]ppeal"`: 23 tests passed; `fileAppeal` median 108,348 gas; `expireAppeal` 47,570 to 74,134.
- `pnpm --filter ./packages/settlement build && node packages/settlement/dist/evm/gas.js`: the table in §2.4.
- A scratch script (viem over a throwaway anvil, Prague, chain 31337; the `TestUSDC` forge artifact): `permit` relayed 73,884 gas, `approve` 45,802, second `permit` 39,684, `transferFrom` estimate 56,582, replay reverts `InvalidPermit`. The script lives outside the repository and sent nothing anywhere else.
- Fetched today: `circlefin/stablecoin-evm` `master`, `contracts/v2/FiatTokenV2.sol`, `FiatTokenV2_2.sol`, `EIP2612.sol`; `eips.ethereum.org/EIPS/eip-7702`.
- Read: `contracts/src/HoldbackBonds.sol`, `HoldbackRules.sol`, `HoldbackTypes.sol`, `contracts/script/TestUSDC.sol`, Solady `ERC20.sol` v0.1.1; `packages/settlement/evm/evm-settlement.ts`, `live.ts`, `world.ts`, `gas.ts`, `errors.ts`, `abis.json`; `apps/operator/src/prepare.ts`, `server.ts`; `apps/demo-cloud/src/world.ts`; `packages/settlement/sim/actors.ts`; `spec/schemas/appeal.schema.json`, `spec/openapi/paths.json`; `examples/verify.ts`; `site/llms.txt`; ADR-0023, ADR-0025, ADR-0028; D41 to D47; T-212, T-215, T-216, T-220, T-221; `docs/backlog.md`; `docs/research/2026-11-04-adjudicator-registration.md` §4; `docs/research/2026-11-04-test-counterparties.md` §6.
- Git: no file under `contracts/src` changed between the deploy commit `64be1f1` and `dd0a55a`; the worktree is clean apart from this file.
