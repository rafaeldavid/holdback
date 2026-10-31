# T-006: SimChain: escrow rules, permissionless triggers, two-sided key release, bonds

- **Lane:** settlement
- **Phase:** 1
- **Depends on:** T-004, T-014
- **Paths this task may touch:** `packages/settlement/sim/`, `packages/settlement/src/interface.ts`
- **Human gate:** no
- **Status:** in progress
- **Agent/session:** implementer (Claude Opus 5.5), branch `t-006-simchain`

## Intent

Implement the `Settlement` interface in-process with the exact rules the contract will enforce, so the demo and fixtures run deterministically.

Restated (implementer, 2026-10-31):

SimChain is the in-process stand-in for the Phase 2 rules contract. It owns the facts core's pure `step` cannot know (balances, bond pools and their `reserved` counter, nonces, registered agents and clubs, the sim clock and the sim beacon), checks every submitted message's signature against those facts, runs `step`, and applies the resulting postings and events atomically or not at all. Anyone may submit a signed message or a permissionless trigger; SimChain never authors a party's message. Behind the `Settlement` interface it must give the demo a deterministic, replayable ledger: the happy path, early acceptance, fallback and default when an adjudicator is silent, escalation, a party appeal with its held fee, and a mutual settlement, each conserving value and settling once. `validate` is the same path without the commit.

Priority (Rafa's scope rule): honest parties until the basic demo works. The criteria the demo path needs are built; hardening that only matters against adversarial parties or later phases is recorded in `docs/backlog.md` with source T-006.

Non-goals: the EVM contract (Phase 2); `settle_after_window` and `optimistic` modes and `Dispute` handling (Phase 4); fees that follow an overturn (backlog, D21); kill fees on mutual settlement (Phase 1 share is 0); backer deposit and withdrawal messages (Phase 4; senior is exercised only by a synthetic deposit in tests); read authentication and private bodies (Phase 2; Phase 1 is `public` only); the operator API, receipts and HTTP idempotency headers (T-007), although SimChain keeps its own idempotency records so `validate` can be shown to leave them alone.

## Context

- `docs/architecture.md` §Hold and settlement postings, §Settlement interface, §Two-sided hold; ADR-0002, ADR-0007, ADR-0012, ADR-0014 §2a (bond pools), ADR-0017 (dry run), ADR-0018 (panel seed), ADR-0019 (mutual settlement); `docs/neutrality.md`.

## Acceptance criteria

- [ ] All postings in the table implemented; settle-once guard; permissionless triggers (expire-offer, reclaim, fallback, default, appeal-expiry, settle).
- [ ] Signature, scope, mandate, nonce, deadline checks on every submitted message (reuse T-004); member admission checked under club rulebooks.
- [ ] Adjudicator acceptance gates funding: policy and registry hashes match, bond reserved (100% of price in guaranteed mode); an adjudicator that never accepts leaves nothing held.
- [ ] Decisions are refused unless the seed is valid for the decider's role (primary: preimage of `seedCommitment`; fallback and appeal: the beacon seed for the round fixed by `judgeBy`, the escalation or the appeal filing, ADR-0018), the policy and registry hashes match, and the signer is the adjudicator whose turn it is.
- [ ] SimChain beacon: `value(round) = keccak256(simSeed ‖ round)`, one round per simulated second, available only once the clock reaches it; supplied to core's `step` as a fact. An unprovable round refuses the decision; there is no substitute source.
- [ ] Key release: decision accept carries key-for-buyer; stored and emitted atomically with release.
- [ ] Bond pools per ADR-0014 §2a: `bond:{a}:junior` and `bond:{a}:senior` with one `reserved` counter; coverage gate `junior + senior - reserved >= price`; losses from junior first, then senior pro rata; appeal-upheld credit to junior; senior empty in Phase 1 with no deposit API, exercised by a synthetic deposit in property tests.
- [ ] Bonds and coverage-ratio gate (100% per guaranteed commitment open to appeal; encumbered bond never counted twice); overturn payouts in guaranteed mode; default-outcome compensation, including the default after an escalation times out (appeal adjudicator's bond).
- [ ] Fee routing per the postings table: the fee goes to the adjudicator whose decision settles; early acceptance returns the fee to the buyer; appeal fee held at filing, paid to the appeal adjudicator on its decision, returned to the appellant on expiry (D21).
- [ ] Early acceptance releases the seller-supplied key for the buyer with the payment.
- [ ] Model `authorizationExpiry` so SimChain and the Phase 2 contract agree (differential tests).
- [ ] fast-check properties: conservation, non-negative balances, settle-once, idempotent resubmission, random interleavings of triggers.
- [ ] Hash-chained event log with replay.
- [ ] `Settlement.validate(...)` runs the same guards as submission against the settlement layer's own facts and changes nothing (ADR-0017 §7). Party messages may be unsigned and report the skipped signature check; adjudicator messages and triggers must be signed. Property test `error.dry-run-has-no-effects`: state, nonces, idempotency records, reserved bond and events are unchanged.
- [ ] Mutual settlement (ADR-0019): `mutual_settle` event with both signatures over the same struct; guards (funded and undecided state, signers equal buyer and seller, `deliveryHash` matches or is null in Held, `releaseKey` only with a delivery, rulebook allows); D23 guards via core's `mutualSettlementProblem` (payouts sum to the price exactly, every payout in the price token, `payoutsTo` honored); one posting per payout, fee to the buyer, key only to the buyer; postings per the table; reservations released; settle-once race with a decision, first applied wins (property test).
- [ ] `pnpm load`: 1,000 holds, report p50/p95 (measured); 100 concurrent holds on one balance, zero overdrafts.
- [ ] Integer rates (ADR-0022): every rate applied to money uses core's `mulBps` or `splitBps` with the rounding rules (requirements ceil; splits floor with the named remainder claimant; bond payouts floor, dust kept); a property test checks conservation across every posting.
- [ ] Privacy (ADR-0020): SimChain holds the fallback and appeal key envelopes and releases each only on takeover; `escalate` decisions must carry the appeal adjudicator's envelope and `Dispute` must carry envelopes for all three adjudicators; every event carries `termsHash` and `recordHash`, with bodies only at disclosure levels that publish them (Phase 1: `public` only).

- [ ] Finality (D20): compute `settledAt` and `finalAt` for the read model from `step` output and the sim clock; `finalAt` is set once `appealBy` passes with no appeal, without waiting for a trigger.
## Out of scope

- EVM contracts (Phase 2).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
