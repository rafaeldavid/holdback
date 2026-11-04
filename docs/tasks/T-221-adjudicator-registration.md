# T-221: Adjudicator registration through the API

- **Lane:** api (with core for the message and its schema, demo for the store, judgment for one rule)
- **Phase:** 2
- **Depends on:** T-211 and T-217 for `parse.ts` and `service.ts`, and T-218 and T-219 for `world.ts`: those edits wait for them to merge. The ADR, the schema, `eip712.ts`, `types.ts` and the operator work can start now.
  - `packages/core/src/parse.ts` and `apps/adjudicator/src/service.ts`: after T-217 merges, which changes both; T-211 (PR 175, open) changes `service.ts` before it.
  - `apps/demo-cloud/src/world.ts`: after T-219 merges, which follows T-218 there; the deploy that ships round 1's prerequisites edits it after this task.
- **Paths this task may touch** (the operator's prepare too, for the defaults and the warning):
  - `apps/operator/src/prepare.ts` and its tests;
  - `examples/verify.ts` (its `TYPES` only: `AdjudicatorAcceptance`, `Decision` and `AdjudicatorRegistration`, so `llms.txt` can publish them and `site/check.mjs` still matches them) and `examples/verify.test.ts`;
  - spec: `spec/schemas/messages.schema.json`, `spec/schemas/adjudicator.schema.json`, `spec/examples/`, `spec/openapi/paths.json`, `spec/openapi.json`;
  - core: `packages/core/src/eip712.ts`, `types.ts` and `parse.ts`, and their tests;
  - operator: `apps/operator/src/server.ts`, `registry.ts`, `registrations.ts` (new), `sim-world.ts`, and their tests;
  - demo: `apps/demo-cloud/src/world.ts`, `telemetry.ts`, `world.test.ts`, `live.test.ts`;
  - judgment: `apps/adjudicator/src/service.ts` and `service.test.ts` (the fallback trust rule only);
  - settlement: one new test file under `packages/settlement/evm/` for the anvil end to end, with no edits to `evm-settlement.ts` (T-218's);
  - docs: `docs/decisions/ADR-0030-adjudicator-registration.md` (new), `docs/api.md`, `docs/neutrality.md`, `docs/backlog.md`, `docs/plan.md` (this row, and the named test's row in the scenario index), this file.
- **Human gate:** no. The live deploy is T-220's.
- **Status:** in progress (slice 1 in review)
- **Agent/session:** Claude Code session on branch `t-221-registration-slice-1` (slice 1); slice 2 to come. The planning branch `t-221-adjudicator-registration` (PR 176) is a different branch.

## Intent

Rafa, 2026-11-04: "API should facilitate overturned appeals", then "Yes, plan it" for adjudicator registration through the API, over a labelled test adjudicator inside the demo (D46). An overturn needs a wrong first decision, and the demo's three adjudicators are Crow's own and honest. No agent can bring its own adjudicator today: `POST /v1/adjudicators` answers 501.

Restated: let any agent register its own adjudicator through the public API, so that buyers and sellers can name it as primary, fallback or appeal adjudicator. That is the protocol's first property: any two agents choose their own adjudicator.

- **Registration.** A self-signed EIP-712 `AdjudicatorRegistration`. The operator verifies it, stores one per address, and serves it with its signature and with the bond read live from `HoldbackBonds`.
- **The bond.** The adjudicator deposits it on chain from its own key, as the demo's three do today. A registration without a bond is shown plainly, and Crow warns anyone who names one. A selection whose terms would pay from a bond the adjudicator does not have is refused: by the operators now, and by the protocol with the next contract change.
- **Crow's three adjudicators stay the defaults.** Naming others is advanced use of the protocol, outside Crow's recommendation.
- **Everything after registration already works** for any address the terms name: the acceptance and decision routes, the envelope read and the timeout triggers (research §3, measured). There are two exceptions:
  - no prepare helper builds an acceptance or a decision, so the adjudicator signs the typed data itself (`llms.txt` gets a worked example);
  - fallback and appeal decisions wait for T-217's drand proofs.

Round 1 (T-216) then uses the round's own registered adjudicators for:
- the wrong first decision that a demo appeal adjudicator overturns, through the API (scenario 7);
- the silent adjudicator that accepts and never decides (scenarios 3, 4, 8, 9 and 10).

The design is in `docs/research/2026-11-04-adjudicator-registration.md`, a Fable max-effort research pass. Its recommendation: option (a) in its smallest honest form, with three additions.
1. The served registration carries its signature.
2. The reference adjudicator's trust rule extends to the fallback role.
3. A documented recipe binds the demo's registry when a demo adjudicator is to serve an outside primary.

Its confidence is high on the direction, medium on the message shape (the ADR settles it), and high on deferring the gasless bond.

**Slice 1, restated by its session (2026-11-04).** Make `POST /v1/adjudicators` real on any operator that has a registration store: verify a self-signed record, keep one per address, serve it with its signature, its live bond and what the node observed, default the roles an offer leaves out to the node's own adjudicators, warn about unbonded ones, and refuse to prepare or relay terms whose fallback cannot pay the overturn clause. Non-goals for slice 1: the demo's Durable Object store and live Sepolia bond reads (`world.ts`, after T-219), the reference adjudicator's fallback trust rule (`service.ts`, after T-217), a `parse.ts` parser for the posted record (after T-217), the anvil end to end and the fork smoke, the deploy (T-220), and anything in `evm-settlement.ts` (T-218's).

## Context

- The research pass above, §1 to §8; ADR-0005, ADR-0007, ADR-0014, ADR-0020, ADR-0023 (the version rule), ADR-0024 §6 (`KeyRegistration`), ADR-0028, ADR-0029.
- D29 (adjudicators may decline clauses), D31 (parametrize, don't restrict), D43 (the overturn payout), D44 (`trustedAdjudicators`).
- `docs/reviews/2026-11-03-contract-review.md` L-5: the appeal adjudicator is never bonded on chain, so a self-registered appeal adjudicator risks nothing when it decides. `llms.txt` must say so plainly: the text goes in this task's Handoff, and T-220 publishes it.

## Acceptance criteria

- [ ] **ADR-0030, Proposed.** It covers:
  - the `AdjudicatorRegistration` message: its fields, the body-hash rule, and `issuedAt` ordering;
  - the route, and what an operator verifies and never refuses (research §2);
  - where registrations live: held by operators and served with the signature (on chain later);
  - how the bond is read;
  - update, rotation and revocation, and retention;
  - the litmus tests.

  Schema 0.10, additive; EIP-712 domain 0.7 unchanged (ADR-0023's rule). The planned route's wording drops "plus bond deposit".
- [ ] **Schema and core.**
  - The type, with an example, in `messages.schema.json`, and the served envelope on `adjudicator.schema.json`.
  - `eip712.ts`, `parse.ts` and `types.ts`.
  - The route in `spec/openapi/paths.json`, and the regenerated document.
  - `pnpm validate:spec` and the EIP-712 vector tests green.
- [ ] **The route.** `POST /v1/adjudicators`, with an `Idempotency-Key`. It validates the body, verifies the signature under the node's domain, recomputes `policyHash`, `poolTermsHash` and the body hash, and stores one registration per address. It answers the served record.
  - It refuses only what is malformed, unsigned or out of order: hashes that do not recompute; an `issuedAt` not later than the one it serves (409); an expired message; a body over the size limit.
  - It is counted as a write under the throttle.
  - Tests cover each refusal and the replay. A named test shows that a well-formed registration with a fee of `0`, a bond of `0` and an unknown registry hash is accepted (D31).
- [ ] **Reads.**
  - `GET /v1/adjudicators` lists the registered adjudicators with the demo's three, oldest first, each with its signature and its `pool`, read live from `bondOf` and `freeOf` (cached per block). `GET /v1/adjudicators/{address}` serves the same for one.
  - `prepare/offer`, `/recipients` and the adjudicator service's `registration()` port read the store.
  - The demo's three register through the same path when the world opens, so every served registration is signed.
- [ ] **The store.** Durable Object rows `ar:<address>`, loaded when the world opens or on first read.
  - **A registration is never removed** (Rafa, 2026-11-04: "don't remove but be transparent alongside other metrics"). Each served registration shows when it was last used: `lastUsedAt`, the last acceptance or decision this operator relayed or saw from that adjudicator, beside the other public metrics `GET /v1/adjudicators` serves (bond pool, fee). An expired registration stays listed, marked as expired.
  - The rows are counted in telemetry, so storage growth is visible. Keeping every registration has a cost: the research bounded storage by dropping registrations at expiry (§6), so growth is now bounded only by the write throttle and one row per address. State that limit in `llms.txt`, and add a backlog row for when the count matters.
  - The local sim world keeps an in-memory store, so `pnpm sim` and the operator tests exercise the route.
- [ ] **Bonds, shown plainly.** A registration without a bond is listed like any other, with `pool` at zero and a plain "no bond" label in the API and in `llms.txt` (Rafa: "just be clear that they don't").
- [ ] **Crow's adjudicators are the default** (Rafa: "crow's adjudicators are default and custom selection is advanced usage of protocol (outside of recommendation by crow etc.)").
  - This plan's reading of his answer, which is new behaviour: today `prepare/offer` requires all three adjudicators. It will fill in Crow's three when an agent names none, and discovery will mark them as Crow's defaults.
  - `llms.txt` presents naming other adjudicators as advanced use of the protocol, which Crow neither recommends nor vouches for.
- [ ] **A warning for an adjudicator without a bond.** `prepare/offer`, and the offer it relays, carry an advisory notice when a named adjudicator has no bond, or less free bond than the price. Advisory only, like the other sanity checks (D31): the parties may still choose it.
- [ ] **Operators refuse a selection the terms cannot pay; the protocol half comes later** (Rafa: "reject adjudicator selection at protocol level if contract specifies bond payout but adjudicator has no bond").
  - **The rule.** When the signed terms make an adjudicator's bond pay (in guaranteed mode, an overturned decision pays the price from the decider's bond, D43), naming an adjudicator that has no bond to pay it is refused.
  - **The primary: already enforced** [inferred from the research, §premises]. Core refuses its acceptance without unencumbered bond for the price (`packages/core/src/state.ts`), and `agreeAndFund` encumbers it on chain.
  - **The fallback: new.** Today its bond is reserved only when it decides (M-3), so a bondless fallback cannot decide and the deal defaults, but nothing refuses it at selection.
  - **The appeal adjudicator:** no clause pays from its bond on chain today (L-5), so the rule does not reach it until T-212 item 5 decides its coverage.
  - **What it buys, and what it cannot do.** Unpaid payouts are already impossible: funding reverts for an unbonded primary (`HoldbackBonds.sol:76`), and an unbonded fallback cannot decide (`HoldbackRules.sol:327`). So the new check changes "the deal goes to the default outcome" into "refused before funding". It is a read with no lock, so it cannot promise the fallback still has its bond at takeover.
  - **An exception to D31 and D32,** recorded as Rafa's rule: a bondless fallback is neither malformed nor something settlement cannot process.
  - **Neutrality.** Once it is on chain, funding depends on a free bond the named fallback controls: the fallback can withdraw, though it signed nothing. The design needs a `neutrality.*` fixture for that case: nothing is locked, the funding is refused, and the parties can offer again with another fallback.
  - **Not built here: the protocol-level half.** It lands in core and the contract in one change, with the next contract redeploy (T-212 item 5, the gasless bond; the backlog row "The protocol refuses a selection the terms cannot pay"). Its design goes in an ADR after its own research pass (Fable, max effort): what "has a bond" means (free bond at least what the clause pays), and that the check is at selection, a read with no lock, because locking a named fallback's bond without its consent is M-3's attack.
  - **Core cannot go first.** The EVM adapter steps core alongside the chain, and it throws when core refuses a step the contract accepted (`packages/settlement/evm/evm-settlement.ts`, "EVM/core divergence"). So a core-only refusal would break the view of a deal funded directly with an unbonded fallback, once T-218 syncs direct calls.
  - **What T-221 builds now: the operator's relay path only.** `prepare/offer`, and the offer and agreement relays in `server.ts`, refuse such terms with `invalid_terms`, saying why. The direct path stays open, as for any operator refusal. Tests cover the refusal and the open direct path.
- [ ] **The fallback trust rule.** Today `trustedAdjudicators` is checked only when the reference adjudicator accepts as primary. Once outsiders can be primaries, a demo adjudicator named as fallback would decide, encumbering its own bond, under an outsider's appeal adjudicator, who could then slash that bond. D44's attack has a second path.
  - The reference adjudicator takes a fallback task only when the deal's appeal adjudicator is in its trusted set. Otherwise it declines with `invalid_terms` and a reason in `notices`.
  - As appeal adjudicator it serves any deal.
  - A named test, `attack.untrusted-appeal-adjudicator-via-fallback`: the demo fallback declines, the deal defaults, and no bond moves. It is listed under the plan's scenario index.
- [ ] **End to end on anvil** (the EVM adapter's harness, sim beacon).
  - An outside adjudicator registers through the operator, bonds itself from its own key, and is named primary, with demo fallback and appeal adjudicators. It accepts with an acceptance it builds itself. The deal funds and delivers, the outside adjudicator decides by script, and the deal is Released.
  - In a second deal the outside adjudicator decides wrongly, and the demo appeal adjudicator overturns. `bond.slashed` pays the wronged party from the outside bond.
  - The same registration binding another registry hash is refused by the demo appeal adjudicator with `registry_mismatch`. That tests the `llms.txt` recipe.
- [ ] **Fork smoke** (opt-in, like T-213's): on a Sepolia fork of the 0.7 deployment, an outside adjudicator registers and bonds, then accepts and decides one deal as primary. T-220's fork run then covers the live demo.
- [ ] **Docs.**
  - `docs/api.md`: the route row moves out of planned, with the reader's checks: recover the signature, recompute the hashes, read the bond on chain.
  - `docs/neutrality.md`, the operator row: "store and serve adjudicator registrations" under Can, "author or alter one" under Cannot.
  - The backlog rows the research names, narrowed or closed.
  - The `llms.txt` text from research §5 ("Run your own adjudicator", with the L-5 limit stated), in the Handoff for T-220.
- [ ] **Review.** `reviewer` and `red-teamer`, each with project context: this changes who may be named, and a defense in the reference adjudicator. Also a reviewer from another model family (DeepSeek, as in the contract review's §8), on the message, the fallback trust rule (does it close D44's second path without opening a third?) and the relay-path bond refusal. Rafa runs it, since its key is outside agent sessions. `pnpm verify` green, and `pnpm snap` with no snapshot diff.

## Rafa's answers (2026-11-04)

1. **One message:** `AdjudicatorRegistration` carries the key and subsumes `KeyRegistration`, as recommended.
2. **The demo's own adjudicators register the same way,** as recommended.
3. **Retention:** never removed; "show status of last used for each registration (don't remove but be transparent alongside other metrics)". See The store.
4. **Which deals Crow's adjudicators serve:** "crow's adjudicators are default and custom selection is advanced usage of protocol (outside of recommendation by crow etc.)". So Crow's three are the defaults. This plan's reading, which goes beyond his words: the trust rules stay as the research recommended. Crow's adjudicators serve as fallback only under a trusted appeal adjudicator, and as appeal adjudicator for any deal, within the daily judge budget.
5. **The gasless bond:** "build later", with T-212's mainnet redeploy.
6. **Unbonded registrations:** "show registrations that don't have a bond just be clear that they don't". He added the warning and the protocol-level refusal above.
7. **The posted delivery for involved adjudicators:** punted to the backlog (Rafa: "let's punt on the read thing, since I don't understand it and pick it up later from the backlog"). The row is under API in `docs/backlog.md`. Round 1 does not need it: its adjudicators decide by script.

## Out of scope (Phase 4, or the mainnet redeploy)

- The protocol-level bond rule in core and the contract: one change, with the next contract redeploy (backlog).
- An on-chain registry or anchor, and the coverage-ratio gate on chain.
- A gasless bond deposit and withdrawal, and the appellant's bond by ERC-3009 authorization: one contract change, with T-212's items, in one redeploy.
- The appeal adjudicator's coverage (L-5), and a minimum appeal bond in the signed terms (D43).
- Backers and their deposit messages (ADR-0014), the `/quote` route, and a separate `/keys` rotation route.
- Fetching another adjudicator's registry by its URI.
- A route to publish a judgment record (optional under D35).
- A rulebook field for the adjudicators a club's members may name.
- A run-time bond deposit on SimChain.
- Self-publication at the adjudicator's own domain.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

**Slice 1, `pnpm verify` on 2026-11-04 at 15:55 UTC** (`reports/verify-t-221-registration-slice-1.md`, base `3a2ffc0` with the slice's changes uncommitted), measured:

| Step | Command | Status | Time |
| --- | --- | --- | --- |
| typecheck | `pnpm typecheck` | pass | 243 ms |
| lint | `pnpm lint` | pass | 4273 ms |
| forge build | `forge build --root contracts` | pass | 780 ms |
| forge | `forge test --root contracts` | pass | 20850 ms |
| test | `pnpm test` | pass | 90847 ms |
| spec | `pnpm validate:spec` | pass | 1226 ms |
| snap | `pnpm snap` | pass | 16842 ms |
| snap:local | `pnpm snap --settlement=local` | pass | 53781 ms |
| demo | `pnpm demo` | pass | 10043 ms |

- No snapshot diffs against HEAD, and no placeholder steps [measured]. The first run of the same day failed `forge build` after 99,538 ms while it cloned `contracts/lib/commerce-payments`' nested submodules into this fresh worktree; `forge build --root contracts` alone then passed, and so did the rerun above [measured]. The branch changes no contract.
- `pnpm test`: 2,424 passed, 38 skipped, 0 failed, in 106 files [measured]. One earlier full run timed out `packages/judgment/src/screen.test.ts` ("letters (9 MB)", 27,250 ms) under load; it passed alone and in this run [measured]. It is unrelated to this change [inferred].
- Test first: `packages/core/src/eip712.registration.test.ts` and the binding test's new fixture failed before the core code existed (20 failed, measured); the hand-written EIP-712 implementation in `eip712.binding.test.ts` agrees with viem on the new digest, which is pinned as `0xab599c0b…3e98a38` [measured]. `apps/operator/src/registrations.test.ts` was written before `registrations.ts`, but could not compile until it existed, so its first measured run is the passing one: 23 of 23 [measured].
- The D31 named test, "accepts a well-formed registration with a fee of 0, a bond of 0 and an unknown registry hash", passes, and a reader recovers the served signature on the second node [measured].
- `neutrality.operator-refuses-unbonded-fallback`: the relay refuses the offer and the agreement with 400 `invalid_terms`, and the settlement layer takes both directly, ending `Held` [measured].
- `pnpm validate:spec`: 34 of 34 examples valid; `spec/openapi.json` strict and fresh, 43 operations [measured]. `node site/check.mjs` passes, with `site/try.mjs` rebuilt [measured].

## Decisions

Slice 1, adopted under "autonomy inside the repo" and recorded in ADR-0030 (Proposed); Rafa may overrule any line.

- **The message is flat, and the record carries an envelope.** `AdjudicatorRegistration` in `messages.schema.json` is the signed struct; the served record carries `registration {keyId, bodyHash, issuedAt, nonce, expiresAt, signature}`, so a reader rebuilds the message from the record alone (`registrationMessageOf` in core). `bodyHash` covers the record without `registration`, with `pool` holding only `terms`, so any field a later version adds is signed too.
- **The TypeScript record keeps its name.** `AdjudicatorRegistration` stays the record's type, because `apps/adjudicator` and `apps/demo-cloud` use it and other tasks are changing those files; the message type is `AdjudicatorRegistrationMessage`. A rename can follow once those lanes are free.
- **`KeyRegistration` is deprecated, not removed,** so schema 0.10 stays additive; its planned `/keys` route is withdrawn (rotation is a new registration).
- **The posted record is checked with existing parsers.** `parse.ts` waits for T-217, so `registrations.ts` validates the posted record as the served one with zero balances (`parseAdjudicator`) and the rebuilt message with `parseMessage`. Slice 2 may add a dedicated parser.
- **The same registration posted again answers 200,** unchanged: same signature means same record. Only a different registration with an older or equal `issuedAt` is 409. This keeps re-registration at world open idempotent across restarts.
- **Per-role defaults.** `prepare/offer` fills each role the agent leaves out, not only when it names none, and states the filled roles in `defaults` and `check`.
- **The bond refusal and the warning read the bond only when the node can.** A node with a live `pool` reader (SimChain today; Sepolia in slice 2) or the address in its own list checks; otherwise it neither refuses nor warns. So the live demo's behaviour does not change until slice 2 wires the Sepolia reads.
- **Listing order.** Bonded adjudicators that never registered (genesis) come first, then registrations by first storage; the page runs oldest first through the newest-first paginator with a fixed top sequence.
- **`observed` lives in the OpenAPI listing, not in `adjudicator.schema.json`.** It is the node's view, unsigned, beside `bond`; the schema keeps the adjudicator's own record and its envelope.

## Handoff

**Slice 1 (this branch):** the ADR, schema 0.10, core's type and helpers, `examples/verify.ts` `TYPES`, the operator route, reads, defaults, warning and fallback refusal, the sim world, and the docs rows. Outside the listed paths, the bump and the new route also needed: `tests/spec.test.ts` (the version and the example), `tests/contract/openapi.contract.test.ts` (one registration in the HTTP contract flow, which requires every documented operation), `spec/README.md` (the changelog), `apps/operator/src/agent-ready.test.ts`, `fee.test.ts` and `operator.test.ts` (the planned count and the version), `apps/operator/src/index.ts` (the export), and `site/try.mjs`, rebuilt by `node site/build.mjs` because it bundles `examples/verify.ts`. `site/llms.txt` is unchanged. The live demo is unchanged until T-220 deploys: it has no registration store yet, so its `POST /v1/adjudicators` would answer 404 after a deploy of slice 1 alone.

**To resume (slice 2), in this order:**

1. **After T-217 merges** (`packages/core/src/parse.ts`, `apps/adjudicator/src/service.ts`):
   - Optional: a `parseAdjudicatorRegistration` in `parse.ts` for the posted form, replacing the zero-balance trick in `apps/operator/src/registrations.ts` (`checkRegistration`).
   - The fallback trust rule in `service.ts`: take a fallback task only when the deal's appeal adjudicator is in `trustedAdjudicators`; otherwise decline with `invalid_terms` and a reason in `notices`. As appeal adjudicator it serves any deal. The named test `attack.untrusted-appeal-adjudicator-via-fallback` in `service.test.ts` (the demo fallback declines, the deal defaults, no bond moves), and its row in the plan's scenario index.
2. **After T-219 merges** (`apps/demo-cloud/src/world.ts`):
   - A `RegistrationStore` over `WorldStorage`, rows `ar:<address>` (`StoredRegistration` as JSON), loaded at open or on first read; pass it as `registry.registrations`.
   - `registry.pool`: live `bondOf` and `freeBond` reads through the EVM adapter's existing reads (cached per block), for any address, not the `pools` cache of the demo's three. No edit to `evm-settlement.ts`.
   - `registry.defaultAdjudicators`: the three demo adjudicators by role.
   - The demo's three register at world open through `register()` with `signRegistration()` from their own keys, as `apps/operator/src/sim-world.ts` does; drop the in-memory `registrations` map and the `registration` closure; the adjudicator service's `registration()` port reads the store with the live pool.
   - `telemetry.ts`: count the `ar:` rows.
   - `world.test.ts`, `live.test.ts`: the store, the reload, and the live bond read.
3. **The anvil end to end** (a new test file under `packages/settlement/evm/`): an outside adjudicator registers through the operator, bonds from its own key, is named primary with demo fallback and appeal, accepts with its own acceptance, decides by script, Released; a second deal it decides wrongly and the demo appeal adjudicator overturns, with `bond.slashed` from the outside bond; the same registration under another registry hash refused by the demo appeal adjudicator with `registry_mismatch`.
4. **The fork smoke** (opt-in, as T-213's).
5. **Reviews:** `reviewer` and `red-teamer` on slice 2; the cross-family review (DeepSeek, run by Rafa) on the message, the fallback trust rule and the relay-path bond refusal.
6. Set Status to done and tick the plan row once slice 2 merges.

**For T-220 (the deploy), `site/llms.txt` text**, from research §5, in the house style:

> **Run your own adjudicator (advanced).** Crow's three adjudicators are the defaults: discovery names them as `defaultAdjudicators`, and `prepare/offer` fills any role you leave out with them. Naming another adjudicator is advanced use of the protocol, which Crow neither recommends nor vouches for. Any address can be an adjudicator. Register it with `POST /v1/adjudicators`: your record as `GET /v1/adjudicators/{address}` serves it, with `pool` holding only `terms`, plus a `registration` envelope your adjudicator key signs as `AdjudicatorRegistration` (types below). `bodyHash` is keccak256 of the RFC 8785 JSON of the record without `registration`. Then deposit your bond in `HoldbackBonds` from the same key (`approve`, then `deposit(token, amount)`; this needs your own Sepolia ETH). A primary is funded only while its free bond covers the price, and an operator refuses to relay terms whose fallback has less free bond than the price. A registration without a bond is listed with `observed.bond: "none"`. Registrations are never removed: a later `issuedAt` replaces yours, and storage grows by one row per address, bounded by the write limit. From then on, watch `GET /v1/commitments?party=<you>&role=adjudicator`, post your `AdjudicatorAcceptance`, read your envelope at `/key` when the delivery lands, and post your `Decision`; you build both typed messages yourself (types below). The operators check your signatures, hashes, deadlines and bond. They do not check how you judge: your policy and registry are promises the parties bind by hash, the appeal adjudicator they chose checks your decision against the terms, and an overturn pays the price from your bond. Crow's adjudicators judge for any primary as fallback or appeal adjudicator if your registration binds their registry (`demo.judges.registry`) and a policy with their template hashes; as primary they decline terms naming any other fallback or appeal adjudicator, and as fallback any other appeal adjudicator, because an overturn would pay from their bond.

Under the honest limits: "An appeal adjudicator's decision is final, and its bond is not yet at stake on chain; choose it as carefully as you choose the primary." Publish the `AdjudicatorAcceptance`, `Decision` (with `SealedKey`, `Beacon`, `EncryptedKey`, `KeyUnlock`) and `AdjudicatorRegistration` types from `examples/verify.ts` in the EIP-712 types block, and update "The nodes run schema 0.9" in `docs/api.md` (demo section) to 0.10 with the deploy.

**For T-216:** an outside primary used with a demo fallback or appeal adjudicator must bind the demo's registry hash (`demo.judges.registry`) and a policy with this build's template hashes under its own `id` (copy a demo adjudicator's `policy`), or the demo adjudicator refuses with `registry_mismatch` or `policy_mismatch`; and scenario 4 (demo fallback) needs a demo appeal adjudicator under slice 2's trust rule. On SimChain an outside adjudicator cannot bond at run time, so it can be appeal adjudicator but not a relayed fallback.
