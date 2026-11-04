# Research pass: adjudicator registration through the API (T-221)

- **Date:** 2026-11-04
- **For:** T-221, after Rafa (2026-11-04): "API should facilitate overturned appeals", then "Yes, plan it" for adjudicator registration through the API over a labelled test adjudicator inside the demo (T-216 scope questions 2 and 3).
- **Scope:** how an agent registers its own adjudicator through the public API so that it can be named in terms and act as primary, fallback or appeal adjudicator on the Sepolia demo; what round 1 (T-216) needs, what waits for Phase 4 ("Adjudicator registry with bonds and the coverage-ratio gate"), and why.
- **Method:** read the repository at `8b53241` on branch `t-221-adjudicator-registration`, plus the coordinating session's uncommitted drafts of T-216 and T-220 in the same worktree (they already name T-221). File and line citations throughout. No network, nothing signed, nothing sent.
- **Labels:** every claim is **measured** (I read it in the code, a schema or a primary document), **inferred** (follows from measured facts) or **guessed** (experience only).

## The recommendation in one page

**Build option (a): registration through the API, as the planned route, in its smallest honest form.** `POST /v1/adjudicators` takes a self-signed EIP-712 `AdjudicatorRegistration` (a new message type; the EIP-712 domain stays 0.7, the schema moves to 0.10 additively, as ADR-0023's version rule and ADR-0024's precedent allow). The operator verifies the signature and the hashes, stores one registration per address, and serves it with its signature and with the bond read from `HoldbackBonds`. The bond itself is deposited on chain by the adjudicator's own key, as the demo's three adjudicators do today. Nothing else new is needed on the write side: acceptances, decisions, the envelope read and the timeout triggers already take any address that the terms name (measured, §3). Confidence: **high** on the direction and on its feasibility before round 1; **medium** on the exact message shape, which the ADR settles; **high** on deferring the gasless bond.

Three additions make the minimum safe and useful, and I recommend all three for round 1:

1. **The served registration carries its signature**, so a seller, a buyer or another operator verifies it against the adjudicator's address and never needs to trust the operator that served it (ADR-0024 §6's intent, measured as unbuilt today).
2. **The reference adjudicator's trust rule extends to the fallback role.** Today `trustedAdjudicators` is checked only when the service accepts as primary (`apps/adjudicator/src/service.ts:193-199`, measured). Once outsiders can be primaries, a demo adjudicator named as *fallback* decides a deal whose appeal adjudicator is the attacker's: its decision encumbers its own bond (`HoldbackRules.sol:327`) and the attacker's appeal adjudicator can slash it (`:378`). Registration opens that path; T-221 must close it (§6).
3. **The registration binds a registry the demo's adjudicators hold** when a demo adjudicator is to act as fallback or appeal for an outside primary: the service refuses any other (`service.ts:274-276`, `registry_mismatch`), and its policy must carry this build's template hashes (`policy.ts:43-46`). This is documentation and an `llms.txt` recipe, not a refusal: an adjudicator may bind any registry (D31); the demo's adjudicators simply decline to serve deals they cannot run (D29).

**Gasless bond: later.** A relayed, signature-authorized deposit (tUSDC's ERC-3009 `receiveWithAuthorization` into `HoldbackBonds`) is the right shape and would also fix the appellant's own-ETH requirement, but it is a contract change, `HoldbackBonds` is deployed by `HoldbackRules`' constructor, so it means a new rules address, a new EIP-712 domain, a fresh world and a round that tests a deployment nobody has run yet. Bundle it with T-212's mainnet-blocking redeploy. Round 1 funds the round's keys from the master address Rafa already agreed to (T-216 question 4).

| # | Question | Answer in one line |
| --- | --- | --- |
| 1 | What a registration is | The published record of `adjudicator.schema.json` minus the chain-held balances, self-signed over its hashes by the adjudicator's address; operator-held and served by every operator it is posted to; the bond is read from `HoldbackBonds` at read time; update and revoke are a new registration with a later `issuedAt` |
| 2 | What an operator may refuse | A body that fails the schema, a signature that does not recover to `address`, hashes that do not recompute, an `issuedAt` not later than the one it serves, an expired message, a body over the size limit. Never a fee, a policy value, a registry or a bond level |
| 3 | How it acts | Everything after registration already works through the public routes for any named address, except that the agent builds `AdjudicatorAcceptance` and `Decision` typed data itself (no prepare helper), and fallback and appeal decisions wait for T-217 |
| 4 | The bond | Own `approve` and `deposit` from its own key (372,709 gas measured for the demo's); gasless deposit and appeal bond are one contract change for the mainnet redeploy, not round 1 |
| 5 | Defended judgment | The API verifies signatures, hashes, deadlines and bond; it cannot verify how an outside adjudicator judges. Parties rely on the bound policy and registry hashes, the price-sized bond, the appeal adjudicator they chose, the reference adjudicator's trust rule, and later club rulebooks. `llms.txt` must say exactly that |
| 6 | Abuse | Sybil and spam are bounded by the write throttle, one row per address and expiry; the D44 attack has a second path through the fallback role that T-221 closes; replay of an older registration is refused by `issuedAt`; a false registration from an operator fails the reader's signature check |
| 7 | Schema | A new signed message, so an ADR and a schema bump (0.9 to 0.10, additive); the domain stays 0.7 |
| 8 | Options | (a) chosen; (b) would have saved about a day and tested nothing real; (c) an on-chain registry now adds a deploy and gas for no round-1 gain; (d) is (a) plus the three additions above |

## The premises, verified

| Fact | Verdict | Evidence |
| --- | --- | --- |
| `POST /v1/adjudicators` answers 501 | **Measured, true** | `spec/openapi/paths.json:36` lists it under `x-holdback-planned` ("Adjudicator registration plus bond deposit."); `apps/operator/src/server.ts:623-629` answers any planned route 501 with a `Link` to its source |
| The acceptance and decision routes exist and take any signer the terms name | **Measured, true** | `server.ts:258,268` (`checkShape` verifies the message against `m.adjudicator`); core refuses an acceptance from anyone but the named primary and checks `bondReserved` and the unencumbered bond against the price (`packages/core/src/state.ts:203-224`); `decisionBindings` checks the decider by role (`:346-355`); on chain `agreeAndFund` and `decide` recover the signer from the terms' addresses (`contracts/src/HoldbackRules.sol:207,298-301`) |
| Registrations are an in-memory map of the demo's three, built from the test adjudicators at world open | **Measured, true** | `apps/demo-cloud/src/world.ts:360-367,466-501`; the local sim world does the same (`apps/operator/src/sim-world.ts:192-268`); `GET /v1/adjudicators` lists `adjKeys` only (`world.ts:380-384`; `server.ts:1008-1021`) |
| `prepare/offer` and `/recipients` need a registration for all three roles | **Measured, true** | `apps/operator/src/prepare.ts:303-304` (404 `not_found` otherwise), fills `policyId`, `policyHash`, `registryHash` and `fee` from the primary's (`:325-333`); `server.ts:1066-1080` |
| `HoldbackBonds` bonds `msg.sender`; the appeal bond is pulled by `transferFrom` | **Measured, true** | `contracts/src/HoldbackBonds.sol:54-68,95-102` |
| The primary's bond is encumbered at funding; the fallback's at its own decision; the appeal adjudicator's never | **Measured, true** | `HoldbackRules.sol:215` (`agreeAndFund`), `:327` (`_firstInstance`, fallback), `_appealDecision` `:365-380` encumbers nothing and slashes the first decider; the contract review records the appeal adjudicator as unbonded (L-5, `docs/reviews/2026-11-03-contract-review.md:206-214`) |
| The EVM adapter reads an acceptor's free bond live from chain | **Measured, true** | `packages/settlement/evm/evm-settlement.ts:716-733` (`freeBond`, `coverage_exceeded`); `GET /v1/adjudicators/{address}` instead serves `pool()`, a cache refreshed for the demo's addresses only (`:429-441`, `world.ts:641,647,655`) |
| The adapter releases each adjudicator's envelope at its turn, and `/key` serves it | **Measured, true** | `evm-settlement.ts:1099-1127` (delivery, takeover, filing, escalation), `keysFor` reads `book.released` (`:490-492`); `server.ts:1057-1061` |
| The reference adjudicator checks `trustedAdjudicators` only when it accepts as primary | **Measured, true** | `service.ts:184-199`; `tasks()` and `decideTask` have no such check (`simchain-adapter.ts:117-144`, `service.ts:239-318`). T-211 adds window, fee and free-bond checks for fallback and appeal tasks, not a trust check (`docs/tasks/T-211-appeal-key-adjudicator.md:19-26`) |
| A demo adjudicator acting as fallback or appeal needs the deal's registry hash to be its own and the primary's policy to carry this build's template hashes | **Measured, true** | `service.ts:222-231` (`#boundPolicy` fetches the primary's policy from its registration), `:274-276` (`registry_mismatch`), `apps/adjudicator/src/policy.ts:39-48` |
| `KeyRegistration` exists as a type and nothing signs, parses for a route or serves it | **Measured, true** | `spec/schemas/messages.schema.json:921-957`, `packages/core/src/eip712.ts:231`, `spec/examples/messages.key-registration.example.json`; `POST /v1/adjudicators/{address}/keys` is planned (`paths.json:37`) |
| Adding a new EIP-712 primary type leaves the domain version alone | **Measured, true (precedent)** | ADR-0023 "Versions" (the rule); ADR-0024 added `ReadToken`, `Delegation` and `KeyRegistration` at domain 0.6 |
| The demo's adjudicators bond themselves from their own keys, with ETH sent by the funding lane | **Measured, true** | `packages/settlement/evm/live.ts:401-417` (`ensureBond`: top up ETH, mint, `approve`, `deposit`); 372,709 gas for approve plus deposit (`world.ts:147`, measured on Sepolia by T-213) |
| The full seller-signed `Delivery` is not served by any read | **Measured, true** | `docs/api.md:251`; `delivery.submitted` carries `attempt`, `deliveryHash`, `plaintextSha256` and the `ciphertext` pointer (`evm-settlement.ts:1134-1137`) |
| The club rulebook has no field naming which adjudicators may be named | **Measured, true** | `spec/schemas/club.schema.json` (no such property); a club narrowing adjudicators is a later rulebook field |
| The T-216 draft already relies on T-221 | **Measured (uncommitted draft)** | `docs/tasks/T-216-evm-e2e-round-1.md` in this worktree: scenarios 3b, 3c, 4, 7, 9 and 10; `examples/e2e-keys.ts:16-17` derives `adjudicator-1` to `adjudicator-3` |

## 1. What a registration is when settlement is on chain

**What it holds.** The fields `adjudicator.schema.json` already publishes, split by who is authoritative for each (measured, the schema's `required` list):

| Field | Who decides it | In the signed struct |
| --- | --- | --- |
| `address` | the adjudicator (its signing key) | yes, as `adjudicator` |
| `encryptionPublicKey`, plus a `keyId` | the adjudicator | yes (the KeyRegistration fields, ADR-0024 §6) |
| `policy` (16 fields) and `policyHash` | the adjudicator | `policyHash` only; the body must hash to it |
| `registry {hash, uri}` | the adjudicator | `registryHash`; the URI travels in the body under the body hash |
| `fee.min` | the adjudicator | yes (`TokenAmount`) |
| `pool.terms` and `poolTermsHash` | the adjudicator | `poolTermsHash` only |
| `name`, `affiliations`, `metrics`, `status` | the adjudicator, self-reported and untrusted (`x-holdback-untrusted`) | under the body hash |
| `pool.junior`, `pool.senior`, `pool.reserved` | **the chain** (`bondOf`, `freeOf`) | **no**: the operator fills them at read time |

So the record an agent posts is the published record without the three balances, plus `keyId`, `issuedAt`, `nonce`, `expiresAt` and `signature`. The struct binds the clear fields a verifier needs without the body (address, key, hashes, fee) and a `bodyHash` over the RFC 8785 JSON of everything else, the same pattern as the commitment's `deliverableHash` and `acceptanceHash` (ADR-0024 §2). Proposed, for the ADR to settle:

```
AdjudicatorRegistration {
  address adjudicator; string encryptionPublicKey; string keyId;
  bytes32 policyHash; bytes32 registryHash; TokenAmount fee; bytes32 poolTermsHash;
  bytes32 bodyHash; uint256 issuedAt; bytes32 nonce; uint256 expiresAt
}
```

**Who signs it.** The adjudicator's own address, under the Holdback EIP-712 domain of the chain it serves (chain 11155111 and the rules contract on the demo). Self-signed is enough: the only claim is "this key, policy, registry and fee are mine", and the address is what every later signature (acceptance, decision) is checked against. Nothing attests the adjudicator's quality; that is the bond, the record and the appeal (§5).

**Where it lives.** Operator-held and served by every operator it is posted to (an adjudicator posts to each operator it wants to be found at; nothing gossips between operators today, and on the demo both nodes are one process). Not on chain in round 1: anchoring addresses only an operator that withholds or serves a stale registration, and two-operator reads plus the self-signature already reduce that to a liveness nuisance. Anchoring stays Phase 4 (an ERC-6538-style registry or Holdback's own, both ownerless; `docs/backlog.md` rows "Adjudicator `KeyRegistration` served by two operators and anchored on chain" and "Adjudicator keys and policies from a source no operator controls"). An adjudicator may also self-publish its registration at its own domain (`/.well-known/holdback.json`, backlog), which the operator's copy can be compared against; nothing in round 1 needs it.

**How each reader verifies it.**

- *The operator, at POST:* the body validates against the schema (`parseAdjudicator` already exists with the fraction rule, `packages/core/src/parse.ts:195-204`); the signature recovers to `address` under the node's domain (`verifyMessage`, as every write does); `policyHash` equals keccak256 of the RFC 8785 JSON of `policy`; `poolTermsHash` of `pool.terms`; `bodyHash` of the rest; `encryptionPublicKey` decodes to 32 bytes (`decodePublicKey`); `issuedAt` is later than the registration it already serves for that address; `expiresAt` is in the future.
- *A counterparty choosing an adjudicator:* reads `GET /v1/adjudicators/{address}` from two operators, recovers the signature itself, recomputes `policyHash` (as `llms.txt` §3 already instructs) and reads the bond from `HoldbackBonds.bondOf` and `freeOf` on Etherscan or an RPC; `pool` in the answer is the operator's convenience copy of the same reads.
- *The seller sealing envelopes:* takes `encryptionPublicKey` from the registration as two operators serve it, or from the adjudicator itself, and uses `/recipients` only as a cross-check (`llms.txt:280`, `prepare.ts:471`, unchanged).
- *The reference adjudicator service:* reads the primary's policy through its `registration()` port when it is fallback or appeal (`service.ts:226`), which the store now feeds.

**How the bond is read.** Live from chain, per request, through the adapter's existing `bondOf` and `freeBond` reads (`evm-settlement.ts:419-427`; `read` caches per block, `:398`), not from the `pools` cache the setup pass refreshes for the demo's three. The `Registry.registration()` closure in `world.ts:361-367` is the one place to change; no edit to `evm-settlement.ts`, which T-218 owns.

**Updating and revoking.** A new registration for the same address with a later `issuedAt` replaces the served one; an older one is refused (409 `invalid_state`, with the served `issuedAt` in the problem). Rotating the encryption key is a new registration with a new `keyId`; the adjudicator keeps old secrets until its open deals are final (ADR-0024 §6, unchanged). Revoking is a registration with `status: "suspended"`, served as such; naming a suspended adjudicator is the parties' choice and the operator adds a notice, not a refusal. After `expiresAt` the operator serves the registration flagged as expired for a retention period, then drops it (an operator service limit, §6).

## 2. What an operator may refuse

By the neutrality test, an operator relays and indexes; it has no authority over who may be an adjudicator. By D31, it refuses only what is malformed, unrepresentable or self-contradictory. Applied to registration:

| Refuse (400 or 409) | Never refuse |
| --- | --- |
| A body that fails `adjudicator.schema.json` (the schema's minimums encode litmus test 3's mandatory rules: `panelSize` at least 3, `minFamilies` at least 2, supermajorities above one half) | A fee level, however high or low |
| A signature that does not recover to `address`, or one under another domain | A policy the operator would not run itself (`judgeTimeoutSec` of 1, `providerPrivacy: local`, a `disclosureMin` of `judgment`) |
| `policyHash`, `poolTermsHash` or `bodyHash` that do not recompute | A registry hash the operator has never seen, or a `registry.uri` it cannot fetch |
| An `issuedAt` not later than the served one (replay or reorder) | An address with no bond, or a bond below any amount: fallback and appeal adjudicators need none on chain (measured, §1), and a primary without one simply fails `coverage_exceeded` at acceptance |
| An expired message, a body over `MAX_BODY_BYTES` (1 MiB, `server.ts:62`), a missing `Idempotency-Key` | A `name`, `affiliations` or `metrics` it doubts: they are untrusted text |

A refusal to *store* a registration does not stop any valid commitment from settling: the seller can build its terms client-side (the ADR-0024 recipe) and `POST /v1/commitments`, whose write path checks no registration (measured: `server.ts:653-683`, `evm-settlement.ts:700-714`); the seller can take the adjudicator's key from the adjudicator; the adjudicator can accept and decide through the existing routes or directly on chain. Serving registrations is a service, like indexing, so the reference operator should serve every well-formed one. A storage retention limit is the one service limit I recommend (§6), stated in `llms.txt`, never applied to a bonded registration while it is bonded.

## 3. How a self-registered adjudicator acts through the API

Checked against the code paths; "today" means at `8b53241`, before T-217 to T-221.

| Step | Route and check | Works for an outside adjudicator today? | T-221 |
| --- | --- | --- | --- |
| Publish a registration | `POST /v1/adjudicators` | No: 501 (`server.ts:623-629`) | **Build it** |
| Be found | `GET /v1/adjudicators`, `/{address}` serve the demo's three only (`world.ts:380-384`) | No | **Serve the store** |
| Be nameable with prepare | `prepare/offer` needs all three registrations and fills the terms from the primary's (`prepare.ts:303-333`) | No (404) | **From the store** |
| Get envelopes sealed to it | `/recipients` needs its registration (`server.ts:1066-1080`); the seller seals to its key | No (404) | **From the store** |
| Learn of an offer naming it | `GET /v1/commitments?party=<me>&role=adjudicator&escrowState=Offered` (`server.ts:1082-1101`; the index covers all three roles, `:477`), or `GET /v1/events` | **Yes** | Nothing |
| Read the terms it must judge | `GET /v1/commitments/{id}/terms` (public; a ReadToken at `private`) | **Yes** | Nothing |
| Accept as primary | `POST /v1/commitments/{id}/acceptance` with a self-built `AdjudicatorAcceptance` (`seedCommitment` = keccak256 of a seed it keeps; `bondReserved` at least the price; `policyHash`, `registryHash` and `fee` equal to the terms'); the adapter reads its free bond on chain (`evm-settlement.ts:716-733`) | **Yes, if bonded.** There is no `prepare/acceptance` (measured: `PREPARE_KINDS`, `prepare.ts:47`); the typed data is `messageTypes.AdjudicatorAcceptance` (`eip712.ts:129-138`), signed under the pinned domain | A worked example in `llms.txt` (T-220 text) |
| See the deal funded | the buyer's `agreeAndFund` carries its acceptance (`HoldbackRules.sol:207`) and encumbers the price from its bond (`:215`); `adjudicator.accepted` carries the acceptance in full (`evm-settlement.ts:732`) | **Yes** | Nothing |
| Get its envelope | `GET /v1/commitments/{id}/key?recipient=<me>`: released at delivery (primary), takeover (fallback), filing or escalation (appeal) (`evm-settlement.ts:1099-1127`) | **Yes** | Nothing |
| Read the work | the `ciphertext` pointer, `plaintextSha256` and `deliveryHash` from `delivery.submitted` and the state read; `GET /v1/ciphertext/…`; the format from the public terms | **Yes.** The seller-signed `Delivery` itself is not served (`api.md:251`); the chain verified it (`HoldbackRules.sol:626`) and `deliveryHashOf(id)` holds its hash, so a decision can name it without re-verifying | Nothing for round 1; a `delivery` read for involved adjudicators later (what waits) |
| Decide as primary | `POST /v1/commitments/{id}/decisions`: `seed` the preimage of its `seedCommitment`, `deliveryHash` the posted one, `policyHash` and `registryHash` the terms', `judgmentRecordHash` any 32 bytes it commits to, `keyForBuyer` on an accept (the content key it unwrapped, re-sealed to `buyerEncryptionPublicKey`) | **Yes** (`state.ts:357-391`; `HoldbackRules.sol:238-307`) | A worked example |
| Decide as fallback or appeal | the same route with `beacon {source, round, value, signature}`: round `roundAt(judgeBy)` for the fallback (also in `FallbackTriggered`), `roundAt(at) + 1` for an appeal where `at` is `appeal.filed`'s time (the block's), the same after an escalation | **Not until T-217**: the parse rule admits `sim` only (`parse.ts:166`), so no fallback or appeal decides on Sepolia today | Nothing: T-217 |
| Publish its judgment record | none: `GET /judgment` serves in-process records only (`world.ts:484-488`); the `Decision` carries `judgmentRecordHash` | No route | Not for round 1 (D35: disclosure is the adjudicator's choice; a route is "what waits") |
| Free its bond after the window | `POST /v1/commitments/{id}/triggers/appeal-expiry` after `appealBy`; anyone may call, the operator relays and pays the gas | **Yes** | Nothing |
| Withdraw | `HoldbackBonds.withdraw(token, amount)` from its own key, free part only (`HoldbackBonds.sol:61-68`) | **Yes** (its own ETH) | Nothing |
| Rotate its key, suspend, update its fee | none | No | **A new registration** |

**What this means for round 1.** The round's adjudicators (`adjudicator-1` to `-3`) are scripted: they sign acceptances and decisions from the driver, with no judgment pipeline. Every step they need after registration exists. The round's "silent" adjudicator is simply one that registers, accepts and never posts a decision; from the chain's side that is an offline adjudicator (T-216 scenarios 3b, 3c, 4, 9, 10). The wrong first decision for scenario 7 is a scripted `Decision` with the opposite outcome, which the demo's appeal adjudicator then judges against the terms and overturns.

**Two constraints the T-216 draft should state.** When a demo adjudicator is the fallback or appeal adjudicator of a deal whose primary is the round's own: (i) the primary's registration must bind the registry hash the demo's adjudicators hold (`demo.judges.registry` in discovery, `world.ts:413`) and a policy with this build's template hashes and versions, with its own `id` (copy a demo adjudicator's `policy`, change `id`), or the demo adjudicator refuses at `#preflight` (`registry_mismatch`, `policy_mismatch`); (ii) use `checks-only` deals so the appeal re-runs checks and spends no live-judge budget (`api.md:244`). Scenario 4 (demo fallback) also needs the appeal adjudicator to be a demo one, or the fallback declines under the extended trust rule (§6).

## 4. The bond on Sepolia

**What it costs today (measured).** `HoldbackBonds.deposit` credits `msg.sender` and pulls the tokens with `transferFrom`, so an adjudicator sends an `approve` and a `deposit` from its own key: 372,709 gas for the pair (`world.ts:147`), about 0.00037 Sepolia ETH at the 1 gwei median tip (inferred from the research pass's measurements of 2026-11-03). The demo's funding lane sends each demo adjudicator 0.005 ETH for it (`DEFAULT_ADJUDICATOR_GAS`). The bond itself is test tUSDC: the faucet grants 1,000 per address per hour, and the token is open-mint (`contracts/script/TestUSDC.sol:38`), so a round-1 bond of a few hundred tUSDC (the price of each concurrently open deal, ADR-0007's 100 % rule) is free. An appellant's `approve` of the appeal bond is one more small transaction (about 46,000 gas, guessed).

**The obstacle is having any Sepolia ETH at all**, not the amount: faucets sit behind CAPTCHAs and per-day limits, which are Rafa's to drive, never an agent's (the hard rules; ADR-0028 consequences). Three ways out:

| Option | What it is | Cost and risk | When |
| --- | --- | --- | --- |
| A. Own key pays | `approve` + `deposit` from the adjudicator; the appellant approves before `fileAppeal` | No change. Needs test ETH on the key: round 1 tops up from the master address (T-216 question 4, Rafa agreed) | **Round 1** |
| B. Faucet test ETH | `POST /v1/faucet {"gas": true}`, capped per day (`docs/backlog.md`, "Sepolia: the faucet's optional test ETH") | No contract change; Rafa's ETH; demo-only | Rafa's call, any time |
| C. Signed deposit relayed by the operator | `HoldbackBonds.depositWithAuthorization(from, value, validAfter, validBefore, nonce, sig)` calls the token's ERC-3009 `receiveWithAuthorization(from, address(this), …)` (tUSDC has it, `TestUSDC.sol:60`; Circle's USDC too, D42) and credits `bondOf[from]`. The same for `fileAppeal`: the `Appeal` message unchanged, plus the appellant's authorization in the call, so `takeAppealBond` pulls by signature instead of allowance. `withdraw` by signature needs an EIP-712 domain on the vault | A contract change. `BONDS` is created in `HoldbackRules`' constructor (`HoldbackRules.sol:146`), so a new vault is a new rules address: a new `verifyingContract`, a fresh world, three new demo bonds, re-pinned `llms.txt` and `try.mjs`, and a round that tests a deployment nobody has exercised. ADR plus ABI, adapter (`encode.ts`, `gas.ts`), prepare and `llms.txt` changes | **With T-212's mainnet redeploy** |

**Recommendation.** A for round 1, B if Rafa wants outside agents to try their own adjudicator on the demo without asking him for ETH, C designed in the ADR that accompanies T-212's remaining items (1, 2, 4, 5, 6, 8), so there is one redeploy and one re-run of the affected scenarios. C is worth doing: D33's principle that agents never need ETH ("gas is part of the cost of using the API") should extend to adjudicators and appellants, and the operator's gas for a deposit is recoverable from the first deal's fee or priced into a registration fee. Round 1's purpose is to test what is deployed; changing the vault first defeats it.

## 5. Defended judgment when anyone can be an adjudicator

The operator cannot enforce how an outside adjudicator judges, and neither can the contract: "Panel composition depends on the registry's contents, so the settlement layer does not check it. A wrong panel is an appeal ground" (ADR-0016, measured). What the protocol checks is already the whole of what it promises; registration changes who may be named, not what is checked.

**What the API and the chain promise** (every item measured in the code): the primary signed the terms' `policyHash` and `registryHash` in its acceptance (`HoldbackRules.sol:207`, `HoldbackTypes.sol:296-312`) and its decision is signed over the same hashes (`decisionHash`, `:361-387`); the decider is the address the terms name for its role (`HoldbackRules.sol:298-301`); its seed is the committed preimage or the beacon's (`:287-297`); its decision names the posted delivery (`:276`); the primary's bond covers the price from funding until the appeal closes, the fallback's from its decision (`:215,327`); an overturn pays the price from that bond (`:378`); every deadline is enforced and every timeout is anyone's to call; the fee goes to whoever decided.

**What they do not promise:** that a panel ran, that it ran the registry's pinned models, that two families sat, that the screen ran, or that the record behind `judgmentRecordHash` exists. For Crow's own adjudicators the record is served and the policy is Crow's code; for an outside adjudicator these are its published promises.

**What the parties rely on instead**, in the order it binds:

1. **The adjudicator they chose.** Property 1 of the protocol: nobody is assigned one. Naming an unknown adjudicator is the buyer's and seller's risk (D32), and the API tells them what to read first (`llms.txt` §3: recompute `policyHash`, read two operators; add: recover the registration's signature, read the bond on chain, read its public record).
2. **The hashes in the terms.** `policyHash` and `registryHash` fix what the adjudicator promised to run; a decision under other hashes is refused on chain. Deviation is detectable by anyone who later sees the record, and is the appeal ground `policy-or-panel-violation` (`messages.schema.json:424-431`).
3. **The bond.** A primary cannot be funded without free bond equal to the price, and loses it on an overturn. A fallback reserves the price when it decides. An appeal adjudicator is not bonded on chain (L-5, Phase 4): its decision is final and backed by nothing but the parties' choice of it; `llms.txt` must say so.
4. **The appeal.** The losing party appeals to the appeal adjudicator the terms name, which checks the work against the terms (D28) and, on an overturn, moves the price out of the first decider's bond.
5. **The reference adjudicator's own rules (D29, D44).** Crow's adjudicators decline terms whose fallback or appeal adjudicator they do not trust, so no outsider can be placed where it could drain Crow's bond (§6 closes the fallback path). As appeal adjudicators they serve any deal: they risk no bond there, only judge budget.
6. **Club rulebooks (later).** A club may list the adjudicators its members may name; the rulebook has no such field today (measured, `club.schema.json`), so this is a backlog row, not a round-1 item.

**What `llms.txt` should say** (for T-220's text, from T-221's Handoff; wording in the house style):

> **Run your own adjudicator.** Any address can be an adjudicator. Register it with `POST /v1/adjudicators`: your encryption public key, your policy (the panel you promise to run; `policyHash` is the keccak256 of its canonical JSON), the registry hash of the pinned models you draw from, your minimum fee and your pool terms, signed by the adjudicator's key as `AdjudicatorRegistration`. Then deposit your bond in `HoldbackBonds` from the same key (`approve`, then `deposit(token, amount)`; this needs your own Sepolia ETH); a primary adjudicator is funded only while its free bond covers the price. Operators serve your registration with its signature and your bond as the chain holds it. From then on you are named in terms like any adjudicator: watch `GET /v1/commitments?party=<you>&role=adjudicator`, post your `AdjudicatorAcceptance`, read your envelope at `/key` when the delivery lands, post your `Decision`. The operators check your signatures, hashes, deadlines and bond. They do not check how you judge: your policy and registry are promises the parties bind by hash, the appeal adjudicator they chose checks your decision against the terms, and an overturn pays the price from your bond. The demo's three adjudicators judge for any primary as fallback or appeal adjudicator if your registration binds their registry (`demo.judges.registry`) and a policy with their template hashes; as primary they decline terms naming any other fallback or appeal adjudicator, because an overturn would pay from their bond.

And under the honest limits: "An appeal adjudicator's decision is final and its bond is not yet at stake on chain; choose it as carefully as you choose the primary."

## 6. Abuse and attacks

| Attack | Path | Bound today | T-221 |
| --- | --- | --- | --- |
| **Sybil registrations and spam** | Thousands of signed registrations from fresh keys | Registration is a write: the per-client budget (120 writes a minute on the demo, `world.ts:454`) and the signer bucket after a success (`server.ts:674-682`). Nothing a registration says moves money or encumbers anyone: a primary with no bond cannot be funded | One row per address (a replacement, not an append), body under `MAX_BODY_BYTES`, dropped at `expiresAt` after a retention period. Storage grows by about 3 KB per distinct registering address (inferred from the example's size); at the throttle that is under 0.5 GB a day from one client, on Workers Paid storage at $0.20 per GB-month (research 2026-11-03). Count registrations in T-031's telemetry |
| **The D44 attack through the primary** | Name Crow's adjudicator as primary and the attacker's as appeal adjudicator; take the honest accept; appeal and overturn through the attacker's | **Closed**: the service declines the offer (`service.ts:193-199`), measured, with a test in `service.test.ts` | Unchanged; keep the test |
| **The D44 attack through the fallback** | Name the attacker's primary (silent) and appeal adjudicator, Crow's as fallback. Crow decides at takeover, encumbering its own bond (`HoldbackRules.sol:327`); the attacker's party appeals; its appeal adjudicator overturns and `slash` pays the price from Crow's bond (`:368,378`) | **Open once outsiders can be primaries.** `tasks()` and `#preflight` check no trust (measured). Unreachable today only because registration is 501 | **Close it:** the service takes a fallback task only when the deal's appeal adjudicator is in its trusted set; otherwise it declines and the deal defaults at `fallbackBy` (the buyer refunded, no compensation on chain today). A named test. Order after T-211, which edits the same file |
| **The D44 attack through the appeal role** | Crow as appeal adjudicator for an attacker's deal | Nothing to drain: the appeal adjudicator's bond is never encumbered or slashed (L-5). Cost to Crow: plaintext exposure (residual 6) and judge budget, five live calls per rubric appeal, capped per day (`LIVE_JUDGE_CALLS_PER_DAY`); an attacker can exhaust the live budget so other deals get scripted judges, labelled as such | Accept for the demo; note the budget exposure. A later adjudicator policy on which deals it serves as fallback or appeal (backlog row "roles offered") |
| **Registering another party's encryption key** | Publish Crow's public key under the attacker's address | Harmless to others: the registrant cannot open envelopes sealed to a key it does not hold, so it cannot judge, and only parties who named it suffer (their choice, D32). No possession proof needed | Nothing |
| **Registration front-running or replay** | Nobody can forge one: the signature is the address's own. An old valid registration can be replayed at an operator to roll back a key rotation or a fee change | Two-operator reads catch a disagreement; nothing orders registrations today | `issuedAt` in the signed struct; an operator serves the latest and refuses older ones (409). An attacker holding an old registration can only re-post what the adjudicator once signed, and not past the one it serves |
| **An operator serves a wrong registration** | A false key makes the seller seal to the operator (`attack.operator-serves-false-adjudicator-key`, ADR-0024's fixture list) | Two operators must agree (`llms.txt:280`); on the demo both are one process (stated) | The served signature lets any reader verify the registration without trusting the operator; the fixture becomes buildable |
| **A bonded primary accepts many offers against one bond** | Two acceptances pass the live read, the second funding fails `coverage_exceeded` (backlog row, T-202 rule 2) | Known; the second buyer's funding is refused, nothing is lost | Unchanged |
| **Storage growth in the Durable Object** | Registrations as rows, listed on open | One `put` per registration; a cold start lists every `ar:` row (rows read equal the count) | Load lazily on the first registration read, or at open with the retention bound above; measure with T-031's counters |

## 7. Schema and versioning

**It needs a new signed message type, so an ADR and a version bump.** `KeyRegistration` (ADR-0024 §6) covers the encryption key alone; a party choosing an adjudicator also binds its policy, registry and fee, and the record's `pool`, `status` and `affiliations` need an author. Two shapes were considered:

| Shape | Effect |
| --- | --- |
| Reuse `KeyRegistration` for the key and post the rest unsigned | The operator becomes the author of policy, registry and fee: exactly the false-registration risk ADR-0024 names. Rejected |
| Widen `KeyRegistration`'s struct | Nothing signs it yet (measured), so no live signature breaks, but it is a published type in schema 0.9 and the name would mislead. Rejected |
| **A new `AdjudicatorRegistration` message** (recommended) | Additive: the domain stays 0.7 (ADR-0023's rule; ADR-0024's precedent). `KeyRegistration` stays in the schema for a lighter rotation later, or is retired by the ADR. The internal TypeScript type now called `AdjudicatorRegistration` (the published record, `packages/core/src/types.ts:554-567`) is renamed, an implementation detail |

**Versions.** Schema 0.9 to 0.10, additive: one new message type, the `registration` envelope (`keyId`, `issuedAt`, `nonce`, `expiresAt`, `signature`) on the served record, optional so SimChain genesis records still validate, one route moved from `x-holdback-planned` to `paths`, and the planned row's wording ("plus bond deposit" becomes "the bond is deposited on chain by the adjudicator"). EIP-712 domain 0.7 and `commitment.schemaVersion` "0.7" unchanged. If the ADR chooses instead to sign the whole nested policy as typed data, that is still additive.

**Files a build touches, by lane:**

| Lane | Files |
| --- | --- |
| core (`spec/` through the ADR) | `spec/schemas/messages.schema.json` (the type), `spec/schemas/adjudicator.schema.json` (the served envelope), `spec/examples/messages.adjudicator-registration.example.json` and the adjudicator example, `spec/openapi/paths.json` (the route; the planned row), `spec/openapi.json` (generated, `pnpm openapi`); `packages/core/src/eip712.ts` (the type), `parse.ts` (rules), `types.ts`, `problem.ts` only if a new problem type is needed (none expected: `invalid_terms`, `invalid_signature`, `invalid_state`, `not_found` suffice), and their tests; `tests/spec.test.ts` picks the example up |
| operator | `apps/operator/src/server.ts` (the write route, the list and read), `registry.ts` (`register`, and `registration()` reading the store), `prepare.ts` (nothing, if the context's `registration()` is the store), a new `registrations.ts` (validation, ordering, storage port) with tests; `sim-world.ts` (the local store, so `pnpm sim` registers too) |
| demo | `apps/demo-cloud/src/world.ts` (the store over `WorldStorage`, `ar:` rows; the demo's three register through the same path so every served registration is signed; `pool` for registered addresses from `bondOf` and `freeBond`), `world.test.ts`, `live.test.ts`; `telemetry.ts` (a count) |
| judgment | `apps/adjudicator/src/service.ts` and `service.test.ts` (the fallback trust rule), after T-211 and T-217 merge, since both edit the file |
| docs | `docs/decisions/ADR-0030-adjudicator-registration.md` (the next free number), `docs/api.md` (the route row, the verification steps), `docs/neutrality.md` (the operator row: serving registrations is a service), `docs/backlog.md` (rows 145, 190, 306 and 332 narrowed or closed), `docs/plan.md`, `site/llms.txt` through T-220's deploy (text in the Handoff), the task file |

Not touched: `contracts/`, `packages/settlement/evm/evm-settlement.ts` (T-218's), `packages/settlement/sim/` (a SimChain run-time deposit is "what waits").

## 8. The options

| Option | What it is | Neutrality (1) | The hold (2) | Defended judgment (3) | The demo | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **(a) Registration through the API** | The planned route, self-signed, operator-stored, bond read from chain; everything after it already works | Passes: property 1 becomes true in the live demo (today only Crow's three can be named); the operator gains no authority, it stores and serves a signed document anyone can verify | Unchanged: the bond rules are the contract's | Unchanged on chain; the parties' reliance is stated plainly (§5); the fallback trust rule closes the new D44 path | Round 1 runs every scenario through the public API with real outside adjudicators, which is what an AI lab would try. About two to three days of work plus the ADR (guessed) | **Recommended** |
| (b) A labelled test adjudicator inside the demo | A demo-only control: an adjudicator that accepts and decides as told (wrong, silent) | Adds a control surface the API doc says does not exist ("no adjudicator control", `api.md:444`); it must never ship past the demo | Unchanged | Unchanged | Saves the ADR, the schema bump, the route and the store, about a day (guessed). Tests nothing an outside agent can do; the overturn scenario would still not run "through the API as any agent may". Rejected by Rafa for round 1 | Rejected |
| (c) An on-chain registry now | An ownerless contract mapping `msg.sender` to `(registrationHash, encryptionKey, uri)`, or ERC-6538's `registerKeysOnBehalf` under a Holdback scheme (relayable by signature, if it is deployed on Sepolia; not verified here) | Best long term: no operator can withhold or stale a registration | Unchanged | Unchanged | A deploy (Rafa-gated), gas per registration, the operator still indexes and serves the body; nothing round 1 needs | Phase 4 |
| **(d) (a) plus three additions** | The served signature, the fallback trust rule, the registry-binding recipe for demo fallback and appeal roles | As (a), with the one new attack path closed and the false-key fixture buildable | Unchanged | As (a), and the demo's adjudicators can serve outside primaries as fallback and appeal without being drained | A few hours more than (a) (guessed) | **Recommended, as the shape of (a)** |

## Proposed scope for round 1: T-221

**Lane:** operator (with core for the spec and type, demo for the store, judgment for one rule). **Depends on:** nothing to start the ADR and the operator work; the `service.ts` change after T-211 and T-217 merge; `world.ts` edits coordinated with T-218 and T-219. **Human gate:** no (in-repo; the live deploy is T-220's).

**Acceptance criteria, proposed:**

- [ ] **ADR-0030, Proposed.** The `AdjudicatorRegistration` message (fields, the body hash rule, `issuedAt` ordering), the route, what an operator verifies and never refuses (§2), where registrations live (operator-held, served with the signature; on chain later), how the bond is read, update, rotation and revocation, retention, and the litmus tests. Schema 0.10 additive; domain 0.7 unchanged; the planned row's wording.
- [ ] **Schema and core.** The type in `messages.schema.json` with an example; the served envelope on `adjudicator.schema.json`; `eip712.ts`, `parse.ts`, `types.ts`; `pnpm validate:spec` and the EIP-712 vector tests green; the route in `spec/openapi/paths.json` and the regenerated document.
- [ ] **The route.** `POST /v1/adjudicators` with an `Idempotency-Key`: validates, verifies the signature under the node's domain, recomputes `policyHash`, `poolTermsHash` and the body hash, refuses an `issuedAt` not later than the served one (409), stores one registration per address, and answers the served record. Counted as a write under the throttle. Tests for each refusal and for the replay, and a named test that a well-formed registration with a fee of `0`, a bond of `0` and an unknown registry hash is accepted (D31).
- [ ] **Reads.** `GET /v1/adjudicators` lists registered adjudicators with the demo's three, oldest first, each with its signature and `pool` from `bondOf` and `freeOf` read live (per-block cache); `GET /v1/adjudicators/{address}` the same for one. `prepare/offer`, `/recipients` and the adjudicator service's `registration()` port read the store. The demo's three adjudicators register through the same path at world open, so every served registration is signed.
- [ ] **The store.** Durable Object rows `ar:<address>`, loaded at open or on first read; dropped at `expiresAt` plus the retention period (a Worker variable, documented as a service limit); counted in telemetry. The local sim world keeps an in-memory store so `pnpm sim` and the operator tests exercise the route.
- [ ] **The fallback trust rule.** The reference adjudicator takes a fallback task only when the deal's appeal adjudicator is in its trusted set, otherwise declines with `invalid_terms` and a reason in `notices`; as appeal adjudicator it serves any deal. A named test (`attack.untrusted-appeal-adjudicator-via-fallback`): the demo fallback declines, the deal defaults, no bond moves. Listed under the plan's scenario index.
- [ ] **End to end on anvil** (the EVM adapter's test harness, sim beacon): an outside adjudicator registers through the operator, bonds itself from its own key, is named primary with demo fallback and appeal adjudicators, accepts with a self-built acceptance, the deal funds, delivers, the outside adjudicator decides by script, Released; a second deal where it decides wrongly and the demo appeal adjudicator overturns, `bond.slashed` paying the wronged party from the outside bond. The same registration binding another registry hash is refused by the demo appeal adjudicator with `registry_mismatch` (so the recipe in `llms.txt` is tested).
- [ ] **Fork smoke** (opt-in, as T-213's): register and bond an outside adjudicator on a Sepolia fork of the 0.7 deployment, accept and decide one deal as primary. T-220's fork run then covers the live demo.
- [ ] **Docs.** `docs/api.md` (the route row moves from planned; the reader's verification steps: recover the signature, recompute the hashes, read the bond on chain); `docs/neutrality.md` (the operator row gains "store and serve adjudicator registrations" under Can, "author or alter one" under Cannot); the four backlog rows narrowed or closed; the `llms.txt` text of §5 in the Handoff for T-220; the T-216 constraints of §3 noted in that task.
- [ ] **Review.** `reviewer` and `red-teamer`, each with project context (this changes who may be named and a defense in the reference adjudicator). `pnpm verify` green; `pnpm snap` with no snapshot diff.

**Paths this task may touch:** `spec/schemas/messages.schema.json`, `spec/schemas/adjudicator.schema.json`, `spec/examples/`, `spec/openapi/paths.json`, `spec/openapi.json`; `packages/core/src/eip712.ts`, `parse.ts`, `types.ts` and their tests; `apps/operator/src/server.ts`, `registry.ts`, `registrations.ts` (new), `sim-world.ts` and their tests; `apps/demo-cloud/src/world.ts`, `world.test.ts`, `live.test.ts`, `telemetry.ts`; `apps/adjudicator/src/service.ts`, `service.test.ts` (the fallback trust rule only); `packages/settlement/evm/evm-settlement.test.ts` or a new test file for the anvil end-to-end (no edits to `evm-settlement.ts`); `docs/decisions/ADR-0030-adjudicator-registration.md`, `docs/api.md`, `docs/neutrality.md`, `docs/backlog.md`, `docs/plan.md`, this task file.

**What waits for Phase 4, or for the mainnet redeploy:**

- An on-chain registry or anchor (ERC-6538 or Holdback's own, ownerless), and the coverage-ratio gate on chain.
- Gasless bond deposit and withdrawal, and the appellant's bond by ERC-3009 authorization (§4, option C), with T-212's items and in one redeploy.
- The appeal adjudicator's coverage (L-5) and a minimum appeal bond in the signed terms (D43).
- Backers (`senior`) and `BackerDeposit` messages (ADR-0014); the `/quote` route; the `/keys` rotation route if kept.
- Registration fields agents choose on but the record cannot carry: roles offered, a fee rate beside `fee.min`, an effort setting in the policy (backlog row from T-017).
- Fetching another adjudicator's registry by URI, so a fallback or appeal adjudicator need not hold the bound registry itself (backlog, T-009).
- A read of the posted seller-signed `Delivery` for involved adjudicators (ReadToken at private levels), and an API-backed `AdjudicatorSettlement` port, so any agent can run Crow's reference adjudicator against any operator rather than a scripted one. Today the port reads an in-process settlement (`simchain-adapter.ts`).
- A route to publish a judgment record for a decision (`POST /v1/commitments/{id}/judgment`, checked against the `Decision`'s `judgmentRecordHash` and the adjudicator's signature); D35 makes it optional.
- A rulebook field for the adjudicators a club's members may name.
- A SimChain run-time bond deposit, so registered adjudicators can be primaries in sim worlds and fixtures.
- Self-publication at the adjudicator's domain (`/.well-known/holdback.json`, backlog) and the operator's comparison with it.

## Open questions for Rafa

1. **One message or two.** A new `AdjudicatorRegistration` that carries the key, subsuming `KeyRegistration` for now (recommended), or keep `KeyRegistration` as a separate, lighter rotation message and build both routes?
2. **The demo's own adjudicators register the same way** (recommended: one code path, every served registration signed), or stay as built-in records?
3. **Retention.** Registrations are served until `expiresAt` plus a retention period, then dropped, as an operator service limit stated in `llms.txt` (recommended), or kept forever?
4. **Which deals Crow's adjudicators serve.** As fallback only when the appeal adjudicator is a trusted one (recommended, the closed path); as appeal adjudicator for any deal, at the cost of judge budget an outsider can spend (recommended for the demo, budget-capped); or only for primaries Crow trusts, which would make outside primaries unusable with Crow's appeal adjudicator and block T-216 scenario 7 as drafted?
5. **The gasless bond.** Later, with T-212's mainnet redeploy (recommended), or now, accepting a new deployment before round 1?
6. **The faucet's test ETH** (`{"gas": true}`): on for round 1 so outside agents can bond and appeal without asking you, or off, with the master address funding the round's keys (as agreed)?
7. **Listing unbonded registrations.** `GET /v1/adjudicators` lists every registration with its `pool` (zero for the unbonded; recommended, agents filter), or only bonded ones?
8. **Serving the posted delivery to involved adjudicators**: not for round 1 (recommended), or now, so the reference adjudicator can be run over the API by the round itself instead of scripted decisions?

## Sources

- Repository at `8b53241`: `CLAUDE.md`; `docs/api.md`; `docs/neutrality.md`; `docs/architecture.md` (Glossary); `docs/team.md`; `docs/backlog.md`; `docs/plan.md`; `docs/decisions-today.md` (D19, D29, D31, D32, D33, D35, D36, D41, D43, D44); ADR-0005, ADR-0007, ADR-0014, ADR-0016, ADR-0018, ADR-0020, ADR-0023, ADR-0024, ADR-0028, ADR-0029; `docs/reviews/2026-11-03-contract-review.md` (L-5, M-3, I-8); `docs/research/2026-11-03-sepolia-demo-settlement.md`; the task files T-211, T-212, T-216 to T-220 (T-216 and T-220 as the uncommitted drafts in this worktree).
- Code: `apps/operator/src/{server,prepare,registry,policy,sim-world}.ts`; `apps/demo-cloud/src/{world,storage,judges}.ts`; `apps/adjudicator/src/{service,policy,settlement-port,simchain-adapter,test-adjudicator}.ts`; `packages/settlement/evm/{evm-settlement,live}.ts`; `packages/core/src/{state,eip712,parse,types,problem}.ts`; `contracts/src/{HoldbackRules,HoldbackBonds,HoldbackTypes,DrandQuicknetBeacon}.sol`; `contracts/script/TestUSDC.sol`; `spec/schemas/{adjudicator,messages,club,commitment-state,event}.schema.json`; `spec/openapi/paths.json`; `spec/examples/`; `site/llms.txt`; `examples/e2e-keys.ts` (uncommitted draft).
- No external source was read for this pass; the ERC-6538 and Sepolia facts cited are from ADR-0024's research pass of 2026-11-01 and the Sepolia pass of 2026-11-03, as recorded in the repository.
