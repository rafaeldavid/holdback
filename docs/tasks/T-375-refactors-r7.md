# T-375: making hidden state explicit (package R7)

- **Lane:** settlement (contracts), branch `contracts-audit-ready`
- **Phase:** 2
- **Depends on:** T-358 (holdback PR 387, the two money addresses and domain 0.8), T-341 (the side-by-side harness and the state oracle), T-356 (the parent-commit harness), T-336 (the delivery liveness counter)
- **Paths this task may touch:** `contracts/src/`; `contracts/test/`; `packages/settlement/evm/abis.json` where the ABI changes; one-line reads of the deal's word in `packages/`, `apps/` or `examples/` only if a change forces them; this task file. Never `formal/` (R4b), `docs/audit/` (AL-2), `spec/schemas/`, `site/`
- **Human gate:** no for the branch. The freeze, the merge to `main` and the redeploy are Rafa's
- **Status:** in progress
- **Agent/session:** implementer session, change kind 7 (smart contracts): `forge test`, one reviewer per pull request, a target of 300k tokens for the package

## Intent

In my own words: the phase-one rules contract relies on facts it never names, or names in two places (the refinement plan's hidden-state findings IS-1 to IS-14, section 3.1). This package makes the ones that remain after the scope cuts explicit, so an auditor reads each fact once and the next change cannot get one copy wrong. Each change moves code without changing what any transaction does, and each is proven by the gates that compare the parent commit with the change. Two test improvements go first, because a gate strengthened after the changes proves nothing about them.

The one planned change of interface is RF-4: the deal's stored word gains its closing reason and its decider, so a reader of `dealOf` learns how a deal closed without replaying its events. The side-by-side harness's allow list names exactly that difference.

Non-goals: no fix of a known finding (that is R8); no NatSpec or names pass (R9); no change to a signed type, an event or `spec/schemas/`; no deploy; nothing merged to `main`.

**Trimmed by Rafa on 2026-11-12** ("Yes, trim them", relayed by the coordinator): the package is the five pull requests below, in this order.

- **RF-6, one close routine for early accept, settlement and refund: set aside.** It touches the money-moving paths for tidiness alone.
- **RF-5, explicit predicates: moved to R9,** the comments and names package. The Handoff lists the values it would name.

## Plan, per pull request

Line numbers are those of `contracts/src/HoldbackRules.sol` at `a37a48d`, the lane after holdback PR 387 [measured].

### PR 1: two gates made stronger (tests only; triage items 43 and 46)

- **Hidden state it answers:** none directly. It strengthens the gates that prove RF-2 (IS-2) and every later change.
- **What:** (a) a liveness counter for decisions. The handler counts every decision that lands after a delivery. It counts as a violation every decision it relays that is authorised and timely and still refused: the right key, the right role, the delivery the handler carried or posted, an outcome the role may give, before the role's deadline, with the beacon round already public. A new invariant requires that count to stay 0. (b) Boundary values in the handler's offers: one offer in 16 sits on a bound the contract checks today. The hold is at the largest `uint120` or one above; the escrow's expiry at the largest `uint48` or one above; or every deadline is one second after the one before, with a one-second escalation window.
- **Why no behaviour changes:** no file under `contracts/src/` changes.
- **Proof that each gate bites:** plant a bug in `contracts/src/`, run the gate, see it fail, remove the bug. For (a), the fallback's deadline swapped for `judgeBy`, so every fallback decision is refused: the existing invariants pass on it, the new invariant fails. For (b), the hold's bound written `>=` instead of `>`: the side-by-side harness fails on it with the boundary offers.

### PR 2: the three money functions with no caller (triage items 33 and 50)

- **Hidden state it answers:** none of IS-1 to IS-14. It removes code an auditor would list as dead: the bond arithmetic SC-7 left without a caller.
- **What:** `Money.requirement`, `Money.payout` and `Money.split` leave `HoldbackTypes.sol`, with the fuzz tests that fuzz them. `Money.ALL_BPS` stays.
- **Why no behaviour changes:** no code in `contracts/src/` calls them, so the compiler does not emit them. The proof is the compiled runtime bytecode of `HoldbackRules`, equal before and after once the metadata hash at its end is set aside.
- **Gates:** the bytecode comparison; the side-by-side harness with an empty allow list.

### PR 3: RF-4, the closing reason and the decider in the stored word

- **Hidden state it answers:** IS-3, one field with several meanings: `Refunded` has four causes (a reject, a reclaim, a default, and an escalation's reject), and `t1` is the decision, escalation or fallback time. With SC-7's cuts, an escalation reject and a default share one word although the fee went to different parties (`docs/audit/state-model.md` section 9.2). IS-4's appeal half left with SC-7.
- **What:** the word gains two fields in the bits it leaves free: `reason` (open, decided, accepted early, settled, reclaimed, defaulted) and `decider` (none, primary, fallback, appeal), as the state model's section 9.2 specifies. Each is written in the same storage write that closes the deal, and never changed after.
- **What changes, on purpose:** `dealOf` returns two more fields, so its ABI and `abis.json` change. Nothing else: no event, no refusal, no balance.
- **Gates:** the side-by-side harness with one allow-list entry, on the Words field only, where the new word is the old word plus the two fields. The state oracle reads the two fields from the chain and checks them against the handler's record of how each deal closed. Every invariant; `forge test`; the size.

### PR 4: RF-2, `decide` reads the deal's word once and writes it once

- **Hidden state it answers:** IS-2. `decide` holds the deal in memory while `_acceptDelivery` writes the same word in storage, then writes the memory copy back, with the attempt copied across by hand.
- **What:** `decide` loads the word into one local copy at the start and stores it once, just before the money moves. `_acceptDelivery` stops writing the word: it checks the delivery, stores its hash and returns it, and each caller sets the attempt itself. A view, `_turn`, returns whose turn it is, the deadline and the beacon round. `_firstInstance` and `_escalationDecision` fold into one closing block.
- **Why no behaviour changes:** every check runs in the same order with the same inputs, so every refusal has the same reason. The stored word after the call is the same, the events come in the same order, and the one write still comes before the first call that moves tokens.
- **One difference inside a call, and nowhere else:** in `Held`, while the adjudicator's signature and the beacon are checked, a contract signer or beacon that reads `dealOf` saw `Held` with attempt 1, a word no row of the state model allows. It now sees `Held` with attempt 0. No transaction's result depends on it, unless an ERC-1271 answer reads the rules contract in the middle of a call.
- **Gates:** the side-by-side harness with an empty allow list; the state oracle and every invariant; `forge test`; the runtime size before and after.

### PR 5: RF-3, each deadline in one place

- **Hidden state it answers:** the owner's rule 2, no fact in two places (plan section 1). The escalation's decision deadline is written out in `decide` and again in `triggerDefault`, and the two must agree for the opposing pair to split time at one instant (state model section 6.2). The fallback's beacon round is written out in `decide` and again in `triggerFallback`'s event.
- **What:** one internal function each for the escalation's decision deadline (`t1 + appealDecideSec`), the escrow's expiry (`fallbackBy + appealDecideSec + EXPIRY_MARGIN`), the fallback's beacon round and the escalation's beacon round. The plan's appeal deadline and appeal decision deadline left with party appeals (SC-7), so they are not built.
- **Why no behaviour changes:** each function returns the expression it replaces, in the same 256-bit arithmetic.
- **Gates:** as PR 4.

## Evidence

(per pull request: the harness result, the test counts, the runtime bytes, the review)

## Review

## Decisions

## Handoff
