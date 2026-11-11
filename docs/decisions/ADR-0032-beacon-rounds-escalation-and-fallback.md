# ADR-0032: The beacon rounds for escalation and fallback

- **Status:** Proposed, 2026-11-11. Rafa may overrule any line. The line most likely to be his call is the number of slots the margin covers (section 4).
- **Date:** 2026-11-11
- **Raised by:** T-348, for package R8 of the contract refinement plan (kept privately, `docs/private-materials.md`). It answers finding X-1 of the drand verifier's review (`docs/reviews/2026-11-11-drand-verifier-review.md`, §10), item 1 of the private hardening task T-225 (the fallback's round), and finding F-2 of the state model (`docs/audit/state-model.md`, section 10).
- **Builds on:** ADR-0006 (defended judgment), ADR-0018 (the panel seed beacon), ADR-0031 (the phase-one scope); D26, D31, D32, D57.
- **Amends:** ADR-0018's round rules (its Decision, item 2) for the fallback and for the appeal adjudicator after an escalation, and its sentence "The appeal rounds hold: they publish strictly after the step that fixes them."
- **Changes (when built, by package R8):** `contracts/src/HoldbackRules.sol` and its tests; `packages/core/src/state.ts` (`beaconRoundFor`); the adjudicator service's own copy of the rule (`apps/adjudicator/src/randomness.ts`, `settlement-port.ts`); the live world's wake-up times (`apps/demo-cloud/src/world.ts`); the deploy scripts and the deployment records; the operator's prepare route (one advisory warning). **No signed type and no file in `spec/schemas/` changes.** This ADR itself changes no code.

Labels: **measured** (a command this task ran on 2026-11-11 produced it), **documented** (a published text says it; the source is named), **inferred** (reasoning from measured or documented facts), **unverified** (not checked; the reason is given). Line numbers are those of `b58bb69` on `main`.

## Summary

**One rule fixes both rounds.** The panel's seed comes from the first drand round after the last moment a choice can still be made, plus a margin in seconds that is fixed at deploy:

```
round = BEACON.roundAt(lastChoice + BEACON_MARGIN) + 1
```

| Panel | `lastChoice` | Today (`HoldbackRules.sol`) |
| --- | --- | --- |
| The appeal adjudicator's, after an escalation | `t1`, the block time of the escalation | `roundAt(t1) + 1` (`:265`) |
| The fallback adjudicator's | `judgeBy − 1`, the last second a primary's decision can carry | `roundAt(judgeBy)` (`:261`) |

**The margin is 29 s on Ethereum mainnet and on Sepolia.** The round is then published at least 30 s after `lastChoice`: two slots and a half. A block proposer can know the seed before it fixes the block only if it also holds the two slots after it.

| | Ethereum mainnet | Sepolia | Local chain and SimChain (sim beacon) |
| --- | --- | --- | --- |
| `BEACON_MARGIN` | 29 s | 29 s | 0 s |
| The escalation's round is published after the escalation's block time by | 31 s | 30 s | 1 s |
| The fallback's round is published after `judgeBy` by | 29 to 31 s | 29 to 31 s | 0 s |
| The smallest escalation window that can be decided | 37 s | 37 s | 2 s |
| The same today, before this change | 13 s | 13 s | 2 s |
| A fallback window that can always be decided | 43 s | 44 s | 1 s |

**Ethereum mainnet is the chain of the mainnet test.** Rafa decided it on 2026-11-11 in the coordinating session, relayed to this task: "Assume Ethereum Mainnet first, we will deploy on L2 after we figure out it works on the primary industry standard". The rule keeps its per-chain form, and an L2 gets its own column by the method of section 4 (gate line BR-7).

**A window below the smallest is not refused.** It is a stated limit. The operator's prepare route warns below it, and the contract keeps refusing only a window of 0 (D31).

**What stays possible.** A validator operator that proposes three slots in a row, and colludes with a party to the deal, can still learn the seed before the escalation is fixed. So can a threshold of drand's nodes, and the block producer of a chain with one sequencer. Section 6 says why the first two are accepted for phase one and why the third is a question for the choice of chain.

**The red team found no Critical or High issue** (section 12): 1 Medium, 6 Low and 6 Info. None breaks the rule's arithmetic. The Medium is a gap in this ADR's first draft, now closed in section 3.5: the adjudicator service computes the round with its own function.

## 1. Context

**Finding X-1 (Medium).** After an escalation, the appeal adjudicator's panel takes its seed from `roundAt(t1) + 1`, where `t1` is the escalation's block time (`HoldbackRules.sol:262-265`). drand publishes that round 1 s after a mainnet block's time and 3 s after a Sepolia block's. A block is often put together later than that. Whoever lands the escalation in such a block already knows the seed, and can land the escalation only when the seed suits [measured by the review: `test_issue_wrongRound_relayerLandsTheEscalationOnlyWhenTheAppealSeedSuitsIt`]. In phase one the escalation's decision is final (D57), so a shopped panel has no remedy on chain.

**The fallback's round (T-225 item 1, Medium).** The fallback's panel takes its seed from `roundAt(judgeBy)` (`:261`). drand publishes that round 0 to 2 s before `judgeBy`. In that time the primary adjudicator, or whoever relays its decision, can compute the fallback's panel and then choose between landing the primary's decision and staying silent. T-225 proposed the first round at or after `judgeBy`.

**Finding F-2 (Low).** An escalation's decision needs the round to be published and then a block before `t1 + appealDecideSec` (`:264`, `:286`). A window shorter than that wait can never be decided, and the deal defaults to a refund. A margin delays the round, so it raises that limit. The same record has to state both.

**Who chooses when an escalation lands.** Anyone may relay an adjudicator's signed decision (`:236`). The decision carries an expiry, `expiresAt` (`:243`), and the reference adjudicator sets it to the deadline of its own turn [measured: `apps/adjudicator/src/service.ts:646`]. So whoever holds a signed escalation can land it in any block until `judgeBy`.

## 2. Sources and measurements

Every number in this ADR comes from this table.

| Fact | Value | Label and source |
| --- | --- | --- |
| drand quicknet genesis time | 1,692,803,367 s | measured: `https://api.drand.sh/52db9ba7…0c84e971/info` and the same path on `drand.cloudflare.com` returned `"genesis_time":1692803367` |
| drand quicknet period | 3 s | measured: the same two answers, `"period":3` |
| Round `r` is published at | genesis + (`r` − 1) × 3 s | documented: `drand/drand`, `common/time.go`, as the verifier's review cites it; measured for rounds 32,398,879 and 32,398,889 below |
| Slot time, mainnet and Sepolia | 12 s | documented: `SLOT_DURATION_MS: 12000` in `eth-clients/mainnet` and `eth-clients/sepolia`, `metadata/config.yaml`, and in `ethereum/consensus-specs`, `configs/mainnet.yaml` |
| A block's timestamp is its slot's start | genesis time + slot × 12 s | documented: `specs/bellatrix/beacon-chain.md`, `assert payload.timestamp == compute_time_at_slot(state.genesis_time, state.slot)`. Under Sepolia's newer fork that function is removed and the new check was not read; the two Sepolia headers below show the same spacing [measured] |
| Mainnet beacon genesis time | 1,606,824,023 s | documented: `eth-clients/mainnet` README, "genesis_time: 1606824023" |
| Sepolia beacon genesis time | 1,655,733,600 s | documented: `eth-clients/sepolia` README, "Genesis Time: 1655733600" |
| Mainnet block times, counted from drand's genesis | 2 mod 3 | inferred: (1,606,824,023 − 1,692,803,367) mod 3 = 2, and 12 is a multiple of 3. Measured on three headers through `ethereum-rpc.publicnode.com`: blocks 21,000,000 (1,729,345,547 s), 21,000,001 (1,729,345,559 s) and 26,394,054 (1,794,428,651 s) |
| Sepolia block times, counted from drand's genesis | 0 mod 3 | inferred the same way from 1,655,733,600. Measured on three headers through `ethereum-sepolia-rpc.publicnode.com`: blocks 12,061,112 (1,793,779,512 s), 12,061,113 (1,793,779,524 s) and 12,114,075 (1,794,428,652 s) |
| A proposer is expected to publish | at the start of its slot | documented: `specs/phase0/validator.md`, "expected to propose a SignedBeaconBlock at the beginning of any slot" |
| Attesters vote, mainnet's rules | when the block arrives, or 33.33% into the slot (4 s), whichever is first | documented: `specs/phase0/validator.md`; `ATTESTATION_DUE_BPS: 3333` |
| A late block may be orphaned by the next proposer | only one slot back, only if the late block has under 20% of a committee's weight and its parent has over 160% | documented: `specs/phase0/fork-choice.md`, `get_proposer_head`: `single_slot_reorg`, `head_weak`, `parent_strong`; `REORG_HEAD_WEIGHT_THRESHOLD 20`, `REORG_PARENT_WEIGHT_THRESHOLD 160`. The spec calls these helpers optional. Lighthouse runs them by default [documented: Lighthouse book, "Late block re-orgs"] |
| Sepolia runs a later fork than mainnet | Gloas (Glamsterdam) since 2026-10-06 on Sepolia; mainnet has no date | documented: `eth-clients/sepolia` README and config (`GLOAS_FORK_EPOCH: 353024`); EIP-7773's activation table leaves mainnet blank |
| Deadlines inside a slot under Gloas | votes due at 25% (3 s), the execution payload due at 50% (6 s), the payload committee's votes at 75% (9 s) | documented: `ATTESTATION_DUE_BPS_GLOAS: 2500`, `PAYLOAD_DUE_BPS: 5000`, `PAYLOAD_ATTESTATION_DUE_BPS: 7500` in the Sepolia config. How Gloas's fork choice treats a late payload is unverified: its fork-choice text was not read |
| Relays stop answering a proposer | header by 3 s, payload by 4 s into the slot | documented: ethresear.ch, "Timing Games: Implications and Possible Mitigations" (2023): "`getHeader` must be called by `t=3`" |
| The largest staking entities | Lido 21.84%, Binance 7.31%, ether.fi 3.97%, Kraken 3.71%, Coinbase 3.06% | documented: the Dune dashboard `hildobby/eth2-staking`, read 2026-11-11; the page shows no date, and its newest rows are dated 2026-11-09. Lido is an umbrella over many node operators |
| The share of mainnet slots with no block | unverified | The one source tried (beaconcha.in) refused the fetch |
| The proposer schedule is public ahead of time | up to two epochs, 6.4 to 12.8 minutes | documented: EIP-7917 (Final), "`proposer_lookahead` for the next `MIN_SEED_LOOKAHEAD + 1` epochs", fetched by the red team. That mainnet runs it today is unverified |
| Escalation windows in the repository's terms | 300 s | measured: `appealDecideSec: 300` in all seven files under `fixtures/terms/` that set it |
| Fallback windows in the repository's terms | 120 s | measured: `fallbackWithinSec: 120` in the same seven files |

Two round signatures, for package R8's tests [measured: both relays returned the same bytes on 2026-11-11]:

| Round | Published at | Signature |
| --- | --- | --- |
| 32,398,889 | 1,790,000,031 s | `aadc47543192e0e9a42d523c61497580755ffa8b27904517dfe9fe8598405ae9b31d5193ece7c71e38cada7d76581584` |
| 32,456,489 | 1,790,172,831 s | `80e0f0939fbf00616f0b7c6c72f49ac3830e71a9de74caf893d8e2ab87e09cf4c4c25e22ade438341af31e5b8e8ef19a` |

## 3. Decision: the rule

### 3.1 One function

The contract keeps one immutable, `BEACON_MARGIN`, in seconds, set in the constructor. One internal function gives the round for both panels:

```solidity
/// The first beacon round published strictly after `lastChoice + BEACON_MARGIN`.
function _roundAfter(uint256 lastChoice) internal view returns (uint256) {
    return uint256(BEACON.roundAt(lastChoice + BEACON_MARGIN)) + 1;
}
```

`lastChoice` is the last block time at which a party can still make the choice that the panel's seed would inform.

**When the round is published.** Write `g` for the beacon's genesis and `P` for its period. For `lastChoice + BEACON_MARGIN ≥ g`, the round is published

```
delay = BEACON_MARGIN + P − ((lastChoice + BEACON_MARGIN − g) mod P)
```

seconds after `lastChoice`. So the delay is at least `BEACON_MARGIN + 1` and at most `BEACON_MARGIN + P` seconds [inferred from `roundAt`, `DrandQuicknetBeacon.sol:74-76`, and the publishing time of a round; the red team measured it over 600 consecutive seconds]. With a margin of 0 the function is today's escalation rule. For the fallback, a margin of 0 is T-225's proposal and not today's rule: on the drand clock the two differ for 2 of every 3 values of `judgeBy`.

### 3.2 The escalation's round

```solidity
} else if (s == Stage.Escalated) {
    role = H.ROLE_APPEAL;
    deadline = uint256(d.t1) + t.timing.appealDecideSec;   // unchanged
    round = _roundAfter(d.t1);                              // was BEACON.roundAt(d.t1) + 1
}
```

- `t1` is the block time of the escalation, written at `:320`. It does not matter whether the primary or the fallback escalated.
- The deadline does not move. The window still counts from the escalation's block, and the margin uses part of it (section 5).
- On mainnet the round is published 31 s after `t1`; on Sepolia, 30 s after [inferred from section 2's two residues and the formula].
- If party appeals return in a later phase (ADR-0031 cut them, `:266-269`), the same function takes `t2`, the block time of the filing. That decision belongs to the task that brings them back.

### 3.3 The fallback's round

```solidity
} else if (s == Stage.FallbackJudging) {
    role = H.ROLE_FALLBACK;
    deadline = t.timing.fallbackBy;                         // unchanged
    round = _roundAfter(uint256(t.timing.judgeBy) - 1);     // was BEACON.roundAt(t.timing.judgeBy)
}
```

- The primary's decision must land in a block whose time is below `judgeBy` (`:257`, `:286`). So `judgeBy − 1` is the last second at which anyone can still choose between the primary's decision and the fallback.
- `triggerFallback` emits the same round: `emit FallbackTriggered(id, uint64(_roundAfter(uint256(t.timing.judgeBy) - 1)))` (`:550`; the event's field is a `uint64`, `:115`). The event stays; its second value follows the rule.
- With a margin of 0 this is T-225's proposal, `roundAt(judgeBy − 1) + 1`, the first round at or after `judgeBy`. This ADR adds the margin, for the reason in section 4: without it a block built 1 to 3 s late, just before `judgeBy`, has the same view that X-1 gives.
- The round is published `BEACON_MARGIN` to `BEACON_MARGIN + 2` seconds after `judgeBy`: 29 to 31 s.
- `judgeBy − 1` cannot underflow once the deadlines are in strict order (the phase-one cut SC-5 of ADR-0031): `judgeBy` is then at least 3. The contract on `main` does not check the order yet (`:193-219`), so this change lands after SC-5 or with it (section 10).

### 3.4 The constructor

- `HoldbackRules`'s constructor takes `uint64 beaconMargin` and stores it in `uint64 public immutable BEACON_MARGIN`. Nothing can change it afterwards, as for every other constructor argument (hard rule: no admin keys).
- The constructor refuses a margin of 0 on any chain but 31337, the local chain. `SimBeacon`'s constructor has the same guard for the same reason: a stand-in must not reach a shared chain. This is a deploy-time check on the deployer, not a limit on any value the parties set.
- The deploy script takes the margin from a table in the script, one row per chain ID, and refuses any other value. Its `--check` reads `BEACON_MARGIN()` back and compares it with that table. A margin in the wrong unit, or one swapped with the neighbouring `expiryMargin` argument, would otherwise pass: 29,000 delays every round by 8 hours [measured by the red team's script].
- The margin is not in the signed terms. Only the contract's address in the signing domain binds a deal to it. The agent docs tell an agent to read `BEACON_MARGIN()` of the contract it signs under: its own check (D32).

### 3.5 Core and the services

- `beaconRoundFor` in `packages/core/src/state.ts:307-314` changes with the contract, in the same pull request:
  - fallback: `roundAt(clock, judgeBy − 1 s + margin) + 1`;
  - escalated: `roundAt(clock, escalation.at + margin) + 1`.
  Core counts in whole seconds, as `roundAt` already does at `:299`.
- **The adjudicator service has its own copy of the rule, and it changes too** (red team, RT-1). `roundFor` in `apps/adjudicator/src/randomness.ts:36-41` returns `roundAt(fixedAt)` for the fallback and `roundAt(fixedAt) + 1` for the appeal role, and `service.ts:525` calls it [measured: read]. It takes no margin, and the task it works from carries only `roundFixedAt` (`settlement-port.ts:42`).
  - **One function, used by both.** Core exports `roundAfter(clock, lastChoice, margin)`. `beaconRoundFor` and the service's `roundFor` both call it, so the rule exists once off chain.
  - **How the margin reaches the service.** The adjudicator's settlement port reads `BEACON_MARGIN()` from the rules contract and carries it with the task.
  - **Why this matters.** A repair that leaves the margin out of the service passes every local test, because the local world runs a margin of 0. On a drand deployment every fallback and escalation decision would then revert with `BadSeed`, and each such deal would default to a refund.
- **The margin has one source: the contract's immutable.** The EVM settlement adapter and the adjudicator's settlement port read `BEACON_MARGIN()`; nothing else states it. SimChain uses 0. The margin is not a field of the terms or of the rulebook, so no signed type and no schema file changes.
- **The live world wakes an adjudicator when its round is public** (red team, RT-4). Today it sets one alarm for a fallback takeover, at `judgeBy`, and then retries 2, 6, 14, 30 and 62 s after the trigger lands (`apps/demo-cloud/src/world.ts:185-186`, `:494`). With the round public 29 to 31 s after `judgeBy`, the pass at 30 s can miss it and the next runs at 62 s, which leaves under half of the fixtures' 120 s fallback window [inferred by the red team; nothing ran]. Package R8 sets the alarm to the round's publishing time plus 1 to 2 s, for the fallback and for an escalation, and corrects the sentence that states the old rule to users (`world.ts:1428`).
- SimChain and the local world keep a margin of 0, so no simulated round moves: on the sim beacon `roundAt(t) = t`, the escalation's round stays `t1 + 1` and the fallback's stays `judgeBy` [measured by the red team's script for 5,000 times each; `pnpm snap` did not run]. `pnpm snap` and `pnpm snap --settlement=local` should show no difference; package R8 measures it.

### 3.6 The tests that must fail before and pass after

The three tests named `test_issue_wrongRound_…` pass today because they assert the weakness (`contracts/test/crosscheck/DrandRedTeam.t.sol:642-711`). Package R8 rewrites each as a `test_attack_wrongRound_…` test that asserts the refusal. Each rewritten test fails on today's contract and passes on the fixed one. The drand tests deploy the rules contract with a margin of 29 s. Their clock is 1,790,000,000 s, which is 2 mod 3 from drand's genesis, the same as a mainnet block.

| Today's test | After the change it asserts |
| --- | --- |
| `…appealRoundIsProvenAtTheTimestampThatFixesIt` | The escalation lands at 1,790,000,000 s. (a) A decision that names round 32,398,879 with its real signature, in a block with the same time, reverts with `BadSeed`. Today it settles. (b) The round the contract demands is 32,398,889, published at 1,790,000,031 s, 31 s after the escalation. (c) At 1,790,000,031 s or later, a decision that names round 32,398,889 with the signature of section 2 settles. Today that decision reverts with `BadSeed` |
| `…relayerLandsTheEscalationOnlyWhenTheAppealSeedSuitsIt` | The gate contract asks the beacon for the round the rules contract will demand, `roundAt(block.timestamp + 29) + 1`. With any signature drand has published by the block's time, and with round 32,398,879's, which drand published 1 s later, the call reverts with `InvalidSignature`, and the escalation does not land through the gate. A gate that still checks round 32,398,879 lands the escalation, and the seed it checked is not the deal's: the decision for that round reverts with `BadSeed` |
| `…appellantFilesOnlyWhenTheAppealSeedSuitsIt` | Nothing: package R6 deletes it with `fileAppeal` (ADR-0031, SC-7; the review's recommendation 7) |

New tests, same package:

- **The fallback.** With `judgeBy` = 1,790,172,800 s (the Base terms): a fallback decision that names round 32,456,478, today's round, reverts with `BadSeed`. One that names round 32,456,489 with the signature of section 2 settles at 1,790,172,831 s or later. `FallbackTriggered` carries 32,456,489.
- **The delay, as a property.** For every `lastChoice` in a range of 300 consecutive seconds, the demanded round is published between `BEACON_MARGIN + 1` and `BEACON_MARGIN + 3` seconds after it.
- **Core and the service against the contract.** `beaconRoundFor`, the service's `roundFor` and `_roundAfter` give the same round for the same inputs, over the same range, for both panels and for margins of 0 and 29 s on the drand clock. This is the test that catches a service left without the margin.
- **The adapter and the port** read `BEACON_MARGIN()` and pass it on.
- **A fallback that escalates:** the round follows the block time of the fallback's escalation.
- **The constructor.** A margin of 0 reverts on a chain ID other than 31337.
- **The order of deadlines.** Terms with `judgeBy = 0` are refused at funding (SC-5), so `judgeBy − 1` is never reached with 0.
- **One boundary test, named `test_boundary_…`.** A gate that is handed round 32,398,889's real signature at block time 1,790,000,000 s succeeds, because the beacon checks a signature and not a clock. It records that no forge test can show a round is unpublished: that rests on drand, not on the contract.

Two notes for the implementer [red team, RT-11]. In the rewritten gate test, the `InvalidSignature` assertions exercise the beacon alone and pass on today's contract; the `BadSeed` assertion is the one that fails before the change. And the fixtures need the two new rounds: `contracts/test/unit/DrandDecide.t.sol:17-21`, `DrandRedTeam.t.sol:87-90` and `fixtures/beacon/drand-quicknet.json`.

## 4. Decision: the margin per chain

**The rule for a chain with fixed slots of `B` seconds:**

```
BEACON_MARGIN = n × B + B/2 − 1      with n = 2
```

So the round is published at least `n` and a half slots after `lastChoice`. For 12 s slots that is 29 s, on Ethereum mainnet and on Sepolia.

**Why slots count.** A block's time is its slot's start, whenever the block is in fact put together (section 2). To know a round published `delay` seconds after that time, a proposer must fix its block's contents that late and still have the block accepted. The consensus rules bound how late that can be [inferred from the fork-choice text of section 2]:

| The round is published after the block's time by | Who can fix the block's contents that late |
| --- | --- |
| up to 4 s (today: 1 s on mainnet, 3 s on Sepolia) | Any proposer. Relays answer a proposer until 3 s into the slot, and votes are due at 4 s |
| 4 to 16 s | Any proposer, at the risk of its block: the block gets no votes in its slot, and a next proposer that runs the late-block rule orphans it. Past 12 s the next proposer must also build late |
| 16 to 28 s | A party that also proposes the next slot. It withholds both blocks and publishes them together. The proposer after them builds on them: the late-block rule looks one slot back only, and needs a strong parent, which a withheld parent is not. Past 24 s that proposer must also build late |
| 28 to 40 s | A party that proposes three slots in a row |
| `n × B + 4` s or more | A party that proposes `n + 1` slots in a row |

- In short, a party that holds `k` slots in a row can fix the first block's contents up to about `k × B + 4` seconds after that block's time. The last 4 s depend on the next proposer building late.
- A later slot that is empty counts as the attacker's. The attacker can often know it in advance: the proposer schedule is public up to two epochs ahead (section 2), and a validator that has stopped voting will very likely miss its slot. A neighbour can also be paid to build late on the withheld blocks [red team, RT-3; inferred].
- "Proposes" includes several proposers that collude.
- A block builder that is not the proposer fixes the block's contents when the proposer signs, at most 4 s into the slot, under mainnet's rules today. Past that it needs the proposer [inferred from the relay cutoffs of section 2]. Under Gloas a builder may be able to withhold its payload until about the next slot's start, 12 s [red team, RT-9, from `should_extend_payload` in the Gloas fork-choice text; unverified here]. Both are far below 30 s.
- **The bound that matters, and why the margin adds half a slot.** With `k` withheld slots, the limit is the moment the next honest proposer chooses its parent: `k × B` plus 3 to 4 s. For two slots that is 27 to 28 s. A margin of 29 s puts the round at 30 s or later, 2 to 3 s past it. This ADR writes the margin as `n` slots and a half so that the slack is stated and a fork that moves a deadline inside a slot by a second or two does not eat it; gate line BR-2 re-derives it. For the escalation the half slot is free: the smallest decidable window is 37 s for any delay from 24 to 35 s (section 5). For the fallback each second of margin moves the floor by a second.

**Why `n = 2`.** Each slot of margin costs 12 s on the escalated path and on the fallback path, and makes a run of slots rarer by the attacker's share of the stake.

| `n` | Margin | The round is published after the block's time by (mainnet, Sepolia) | Smallest escalation window | Slots the attacker must hold in a row | Such runs per day at 3%, 7.31% and 21.84% of the stake | Chance that one untimed escalation meets a run, at 7.31% and 21.84% |
| --- | --- | --- | --- | --- | --- | --- |
| 0 (today) | 0 s | 1 s, 3 s | 13 s | 1, or the builder of that block | every block | not a matter of stake: whoever builds the block |
| 1 | 17 s | 19 s, 18 s | 25 s | 2 | 6.5, 38, 343 | 0.53%, 4.77% |
| **2 (chosen)** | **29 s** | **31 s, 30 s** | **37 s** | **3** | **0.19, 2.8, 75** | **0.039%, 1.04%** |
| 3 | 41 s | 43 s, 42 s | 49 s | 4 | 0.006, 0.21, 16 | 0.0029%, 0.23% |

- Runs per day are 7,200 slots times the share raised to the number of slots [measured: the script; it assumes each slot's proposer is drawn independently in proportion to stake]. 7.31% is the largest single custodian and 21.84% the largest umbrella in section 2's source; an umbrella of many operators is an upper bound, since all of them would have to collude. Five entities there hold 3% or more.
- **The two columns answer two attackers.** The last column is for an escalation whose time the attacker does not influence: one chance, at the share raised to the number of slots. The runs per day are for an attacker that can choose when the escalation exists, for example a seller that times its delivery (section 6, residual 1). For that attacker the question is whether a run falls inside the deal, and a deal of a day or more meets one at `n = 2` for any operator with about 3% of the stake.
- `n = 1` gives a 3% operator six runs a day. `n = 2` gives it one in five days and a 7% custodian three a day. `n = 3` gives the custodian one in five days, for 12 s more on each escalated or fallback case.
- An escalated case then waits for a panel of models, which takes tens of seconds by itself. 29 s is of the same size; it is not the "settle in seconds" path, which is a primary's accept.
- **Chosen: `n = 2`,** on the judgment that phase one's deals are small against what the attack needs: a validator operator of that size that colludes with one deal's party and withholds three blocks in public view, with three blocks' rewards at risk if it publishes them late (section 6). The choice is Rafa's to overrule. Another `n` changes one number before the deploy and the figures of this table; nothing else in this ADR moves. Gate line BR-6 measures the runs on mainnet before a deploy there.

**Why fixed at deploy, and not a term of the deal.**

- The margin answers the chain's block production, which the parties cannot manage. D31 is about values they can.
- A margin of 0 in the terms would let one party's relayer shop the panel against the other. The design principle of user choice stops at options that let one party break a litmus test against the other (ADR-0015).
- A term would change a signed type, with a schema version and new hash vectors, for a number no deal has a reason to lower.
- A later phase may let the terms raise the margin above the chain's floor. Nothing here blocks that.

**Other chains.** The mainnet test runs on Ethereum mainnet (Rafa, 2026-11-11; see the Summary), and an L2 follows later. A chain gets its margin by the same method before the rules contract is deployed there: its block time and how timestamps are set, from its specification and from measured headers; how far a block's time can lag real time, and for how long; the latest moment a block's contents can be fixed, in its consensus rules; and who can produce consecutive blocks. On a chain where one sequencer builds every block, no margin shorter than the sequencer's own freedom to delay or reorder keeps the seed from the sequencer (section 6, residual 3).

**A fork that changes slot timing.** The margin is in seconds, so shorter slots make it cover more slots, which is the safe direction. Longer slots, or a later deadline inside a slot, would need a new deployment, since nothing can change the immutable.

## 5. Decision: the smallest decidable escalation window

**The formula.** An escalation's decision must land in a block whose time is below `t1 + appealDecideSec` (`:264`, `:286`), and the block must be built after the round is public. On a chain with slots of `B` seconds, with honest block production, no empty slot and no time for the panel:

```
delay     = BEACON_MARGIN + P − ((t1 + BEACON_MARGIN − g) mod P)
smallest  = B × (floor(delay / B) + 1) + 1
```

`delay` is section 3.1's: how long after `t1` the round is published. The first block built after that has the time `t1 + B × (floor(delay / B) + 1)`, and the window must be longer than that by 1 s, because the contract refuses a decision at the deadline itself.

| Chain | `B` | `P` | Margin | `delay` | Smallest window |
| --- | --- | --- | --- | --- | --- |
| Ethereum mainnet | 12 s | 3 s | 29 s | 31 s | **37 s** |
| Sepolia | 12 s | 3 s | 29 s | 30 s | **37 s** |
| Either, today | 12 s | 3 s | 0 s | 1 s, 3 s | 13 s |

The three rows are inferred from the formula and section 2; nothing ran. The 13 s agrees with the state model's section 6.3. The refinement plan's "about 15 s" for Sepolia was an estimate of the same 13 s.

The local chain and SimChain keep today's 2 s. The sim beacon releases round `t1 + 1` to a block whose time is `t1 + 1` (`SimBeacon.sol:33`), so the formula's "built after the round is public" does not apply there [documented: the state model's section 6.3].

**What the number is and is not.**

- It is the chain's floor. Below it, no block with a time inside the window is built after the round is public, and every escalation under those terms defaults to a refund.
- It is not enough by itself. With a window of exactly 37 s, the adjudicator has 5 to 6 s between the round and the one block that can carry its decision. A panel of models needs longer, and each empty slot costs 12 s more. The repository's terms use 300 s.
- A decision can land in less if a builder puts the block together late. No adjudicator can rely on that.

**How a shorter window is handled: a stated limit and an advisory warning, never a refusal.**

- The contract refuses a window of 0 and nothing else (ADR-0031, SC-5; the schema's minimum is 1). This ADR adds no refusal, in the contract, in core or in the operator (D31).
- The operator's prepare route warns when `appealDecideSec` is below the smallest window of the chain it settles on. The warning says that an escalation under these terms cannot be decided there and would default to a refund. It computes the number from `BEACON_MARGIN()`, the chain's block time and the beacon's period, so it follows the deployment.
- The state model (section 6.3 and finding F-2) and the agent docs (`site/llms.txt`) state the number per deployed chain. Their owners update them when package R8 lands.
- An adjudicator that will not run a short window declines the commitment before it signs its acceptance. That is its own check (D32).

**The fallback's window has the same kind of floor.** The fallback's round is published 29 to 31 s after `judgeBy`. A decision then needs a block before `fallbackBy`. Where `judgeBy` falls inside a slot is the parties' choice, so the floor depends on it. A fallback window (`fallbackBy − judgeBy`) of 43 s on mainnet, or 44 s on Sepolia, always has such a block, and a shorter one may not [measured by the red team's script over every `judgeBy` in 720 s; the 1 s between the chains is the phase of section 2]. Today 13 s is always enough. The handling is the same: the strict order `judgeBy < fallbackBy` is the only refusal, and the prepare route warns below the chain's number. The repository's terms use 120 s; section 3.5 says what the live world changes so that the reference fallback fits it.

**Not adopted: adding the margin to the deadline.** The deadline could become `t1 + BEACON_MARGIN + appealDecideSec`, so that the margin costs the parties no part of the window they signed. It would move the hold's expiry (`:169`), the default's timing (`:563`), core's `appealDecideBy` and the formal model, for a limit that a warning already covers. The window keeps one meaning: seconds from the escalation's block.

## 6. What stays possible, and whether it is accepted

**Nobody who only chooses when to act gains anything.** A relayer that holds a signed escalation still picks the block, and so the round. Every round it can pick is at least 30 s in the future, and a drand round's value does not exist until a threshold of the network signs it. The gate contract of the review's test has nothing to check.

**After the round is public, no single party has a move left that harms another.** In `Escalated`, the appeal adjudicator decides, both parties together may settle, and anyone may trigger the default once the window has passed [inferred from the entry points; the plan's item IS-8 says an early accept is not allowed in this stage]. On the fallback path one move is left: while nobody has called `triggerFallback`, the deal stays in `Delivered`, and the buyer may read the fallback's panel and accept early, which pays the seller in full and returns the fee to the buyer. Anyone closes that by triggering at `judgeBy`, 29 s before the round. Today the round is public before `judgeBy`, so the rule narrows this [red team, RT-8; inferred].

The residuals:

1. **A validator operator that proposes three slots in a row, in collusion with a party to the deal.** It withholds its three blocks, reads the round 31 s (mainnet) or 30 s (Sepolia) after the first block's time, and then includes the escalation in the first block or leaves it out. Two neighbours that are offline or paid stand in for slots it does not hold.
   - **Aimed at an escalation** [red team, RT-2]. The run is public up to 12.8 minutes ahead. A seller that can make the primary escalate, for example with a planted screen flag (ADR-0031's red-team finding H-2), times its delivery so that the honest primary's escalation reaches the mempool during the run. The operator includes it if the panel suits. If not, the next honest proposer lands it with a round nobody knows. So the attacker gets one known draw and then one blind draw: if half the panels suit, its chance of a panel that suits rises from 50% to 75%.
   - **Aimed at the fallback** [found while answering RT-12]. The seller offers the terms, so it sets `judgeBy`. In a deal shorter than the schedule's lookahead it can set `judgeBy` inside a run, deliver late, and leave the primary's decision in the mempool as the run starts. The operator lands the primary's decision if it suits, and drops it if the fallback's panel suits better. A deal whose `judgeBy` is more than 12.8 minutes after signing cannot be aimed this way.
   - **What it costs the attacker.** No protocol penalty [inferred from the fork-choice text]. It has 5 s (mainnet) or 6 s (Sepolia) to fetch the round and publish three blocks before the next proposer builds; late, it loses all three. The three late blocks are in public view.
   - **How often.** Section 4's table: about 2.8 runs a day at 7.31% of the stake, 0.19 at 3%. A delivery window of a day or more meets one.
   - **Accepted for phase one.** The attack needs a validator operator with a few percent of the stake to collude with one deal's party and to withhold three blocks in public view. The gain is a better chance at one deal's price, and the loss to the other party is bounded by that price and fee. The signed escalation, the block times and the late blocks are an attributable record (D26). A dishonest primary gains no power from it: it could decide the case itself.
   - **What the parties and adjudicators can do themselves (D32).** An adjudicator declines terms whose judging time (`judgeBy − deliverBy`) is too short for it to decide well before `judgeBy`. A primary that sends its escalation after a private random delay makes the run harder to hit, by about the ratio of 45 s to the delay's range [inferred]. Neither is decided here; both are the adjudicator lane's.
   - **Not accepted without a look on mainnet:** gate line BR-6 measures the runs before a mainnet deploy, and `n` is Rafa's to raise.
2. **A threshold of drand's nodes** can compute any round early: quicknet's signature covers the round number only. This is the review's gate line G-7 and assumption TA-9 of the threat model. No margin changes it. Accepted, as already recorded.
3. **The single block producer of a chain with one sequencer** holds every slot in a row. The margin keeps the seed from everyone else and not from the sequencer. On a chain whose block times can run behind real time, for example while a sequencer catches up after an outage, every sender knows the round during the lag [red team, RT-13; inferred, no specification read]. Ethereum is not such a chain: a block's time is its slot's start (section 2). This ADR neither accepts nor refuses either case: both go to the choice of an L2 (gate line BR-7).
4. **The relayer's window is as long as the escalation's expiry.** With the margin, a longer window gives a lone relayer nothing. Combined with residual 1 it gives a colluding relayer more runs to wait for. A short expiry on a signed escalation, and an adjudicator that sends its own escalation to the chain at once, cut a relayer's draws to about one. Neither bounds a party that chooses when the escalation exists (residual 1). Both are the adjudicator's practice and need no contract change (D32). Follow-up for the adjudicator lane: the reference adjudicator signs an escalation with an expiry of a few slots, not its whole turn (`service.ts:646`).
5. **The appeal adjudicator can let the window pass after it sees its panel,** and the deal then defaults to a refund. It could as well sign a reject. This is the trust the parties place in the adjudicator they chose (threat model, TA-13); the margin does not change it.
6. **A reorganisation after the fact.** A party that can remove a block three slots deep, after the round is public, can undo an escalation. That takes far more stake than withholding its own blocks [inferred]. Covered by residual 1's acceptance.

## 7. Alternatives considered

Each row says what an attacker can still do. "Timing" is a party that only chooses when its transaction is sent. "Builder" is a party that fixes a block's contents.

| # | Alternative | Timing attacker | Builder | Verdict |
| --- | --- | --- | --- | --- |
| A | **A margin after the block, fixed at deploy** (chosen) | Nothing: every round it can pick is unpublished | Needs `n + 1` slots in a row (section 4) | Chosen. One immutable, one function, no new state, no signed type |
| B | **The signer names the round.** The primary's signed escalation carries a future round; the contract takes the escalation only while that round is at least a margin away, and stores it | Nothing, and it cannot even pick the round | The same as A for the same margin, with one try per signed message | Not adopted. It gives a signed field that is unenforced today a new meaning, and it stores the round in the deal's word (the 48 bits the cut of party appeals frees would hold it [red team, RT-12]). It adds a failure of its own: an escalation that misses its round cannot land until the primary signs again. A short expiry gives the same one try with no contract change (section 6, residual 4) |
| C | **A commit by the escalating party, then a reveal.** One transaction commits to the escalation; a second, at least a margin later, reveals it | Nothing | The same as A: the round must still be fixed by the commit's block plus a margin | Not adopted. An escalation holds no secret to hide, so the commit adds nothing to A. It costs a second transaction, more state, and a commit that is never revealed |
| D | **The round of a later block's time.** The seed comes from the first round after the time of the block `k` blocks later | Nothing | A proposer that skips its own slot moves that block's time by 12 s, and so the round by 4: one bit of choice per slot it holds, at the price of a block | Not adopted, and weaker than A. In A nothing after the escalation's block can move the round. The contract also cannot read a later block's time without a second transaction, whose sender then picks the block: X-1 again |
| E | **Keep today's rule and refuse contract callers** | Sends the same test through a builder's bundle, which drops the transaction when the seed does not suit | Unchanged | Not adopted. It stops nothing, and it breaks callers that are contracts, which Rafa kept (ADR-0031, SC-4) |
| F | **A margin as long as finality** (two epochs, 768 s) | Nothing | Needs to revert a finalized chain | Not adopted. It makes every escalation and every fallback wait about 13 minutes. Section 4's table is the same trade at a smaller size |
| G | **The fallback without a margin** (T-225's rule as written) | Nothing | A block built 1 to 3 s late, just before `judgeBy`, sees the fallback's round: any proposer | Not adopted. It leaves the fallback where X-1 leaves the escalation today. One rule for both costs 29 to 31 s at the start of the fallback's turn |
| I | **A round fixed by a signed deadline for the escalation too:** `judgeBy − 1` when the primary escalates, `fallbackBy − 1` when the fallback does [red team, RT-12] | Nothing, and nobody picks the round | A run of three slots at the deadline, which can be aimed only in a deal shorter than the schedule's lookahead | Not adopted. Every escalation would wait for its deadline before a panel could be drawn, and the decision window would have to count from the deadline: a new meaning for a signed term, the hold's expiry and the formal model. It removes the timed escalation of residual 1 and keeps the timed `judgeBy`. Worth a second look if gate line BR-6 shows runs are common |
| H | **Another source,** the chain's own randomness (`prevrandao`) at a later block | Nothing | Each proposer of the last slots holds one bit by skipping its block | Out of scope: Rafa kept the drand proof on chain for phase one (D57), and ADR-0018 keeps `prevrandao` as a club's option on L1 only |

## 8. What a testnet cannot show

1. **How late mainnet blocks are built.** Sepolia's validators are a small permissioned set with no market for block space. Mainnet proposers sell their blocks through relays and gain by waiting. Sepolia shows the arithmetic, never the incentive.
2. **Who holds slots in a row.** The runs of section 4 depend on mainnet's stake shares, which Sepolia does not have. Sepolia's validator set is small, so a run of three slots by one operator is likely routine there [guessed by the red team]; no real money is at stake on it.
3. **Mainnet's fork rules.** Sepolia has run Gloas since 2026-10-06; mainnet has no date. The deadlines inside a slot differ (votes at 3 s against 4 s; a payload deadline at 6 s that mainnet does not have yet). A test on Sepolia is a test of Sepolia's rules.
4. **Mainnet's phase against drand.** Sepolia's block times are 0 mod 3 from drand's genesis and mainnet's are 2 mod 3. The round is published 30 s after a Sepolia block and 31 s after a mainnet one. The forge tests use a mainnet-phase clock; a live Sepolia run cannot.
5. **The late-block rule in practice.** Which mainnet proposers orphan a late block, and how often, decides the cost of the 4 to 12 s row of section 4. The margin does not rely on it.
6. **A withheld run of blocks.** Nobody can stage three withheld slots on a public testnet without holding them. The forge tests show what the contract accepts at a given block time; they do not show block production.
7. **The share of empty slots,** which lets an attacker with fewer slots succeed. Unverified here (section 2).

## 9. Lines for the mainnet gate

These refine the review's line G-9 ("settle finding X-1 before any path that uses `roundAt(t) + 1` runs on mainnet"). Each is a check to pass before a mainnet deployment of the rules contract.

| # | Line | Why |
| --- | --- | --- |
| BR-1 | The deployed rules contract's `BEACON_MARGIN()` reads 29, on Sepolia and on mainnet, and the deploy script takes the value from its per-chain table and checks it after the deploy | The margin is an immutable. A wrong value cannot be corrected: 0 is today's finding, 1 to 23 s reopens it for one or two slots, and a value in the wrong unit stops every fallback and escalation |
| BR-2 | On the day of the deploy, re-derive the margin from the fork mainnet runs: the slot time, the deadlines inside a slot, and the rule for a late block, from the consensus specifications at that fork | Mainnet will adopt Gloas at a date not yet set. If a deadline inside a slot moves past half a slot, or slots get longer, 29 s is too short |
| BR-3 | Measure the phase on at least 100 recent mainnet headers: every block time is 2 mod 3 from 1,692,803,367, and consecutive times differ by a multiple of 12 s | Section 5's number rests on it. Three headers were measured here |
| BR-4 | The rewritten `test_attack_wrongRound_…` tests, the fallback test, the delay property and the core cross-check of section 3.6 pass on the frozen commit, with a margin of 29 s | They are the proof that X-1 and the fallback's gap are closed in the contract that ships |
| BR-5 | The prepare route's warning, the state model and the agent docs state 37 s for the escalation window and 43 s for the fallback window on mainnet (44 s on Sepolia) | A party must be able to learn the limit before it signs (D32) |
| BR-6 | Over a recent month of mainnet slots, measure for each operator how many runs of three slots a day it proposes, counting empty slots beside its own. Rafa accepts the result or raises `n` | Section 6, residual 1. That rate, set against how long a deal runs, is what is accepted. The shares here come from one dashboard on one day |
| BR-7 | For any chain other than Ethereum mainnet: derive the margin by section 4's method, and record who can produce blocks in a row there and how far a block's time can lag real time. A single sequencer is named in `docs/neutrality.md` as able to choose an escalation's panel, or the chain is not used | Section 6, residual 3 |
| BR-8 | The reference adjudicator signs an escalation with a short expiry and sends it to the chain itself, at once | Section 6, residual 4. It bounds a relayer's draws to about one. It does not bound a party that times the escalation |
| BR-9 | The threat model's assumption TA-2 and ADR-0018's "Known gap" paragraph describe this rule and its residuals | TA-2 says today that the planned fix leaves a margin of one block. The audit-docs lane owns that file |
| BR-10 | On the Sepolia deployment that carries this rule, one fallback decision and one escalation decision settle through the reference adjudicator before the deployment is announced. It needs transactions, so it waits for Rafa | No local run can show a service or an adapter that lacks the margin, because the local world's margin is 0 (red team, RT-1) |

## 10. Consequences

- **Package R8** builds sections 3.1 to 3.6 in one pull request for the contract, core and the adjudicator service together, with the side-by-side run's list of allowed differences: the round of every fallback and escalation decision on a drand deployment, and the second value of `FallbackTriggered`.
- **R8 lands after two other changes, or with them** [red team, RT-7].
  - **The strict order of deadlines (SC-5).** Without it, terms with `judgeBy = 0` make `triggerFallback` revert on `judgeBy − 1`, and the deal waits in `Delivered` for the hold's expiry and the buyer's own reclaim. Terms with a `judgeBy` already past give a fallback round that is public at signing (known issue L-8).
  - **The cut of party appeals (R6).** Until it lands, `HoldbackRules.sol:266-269` and `state.ts:312` keep `roundAt(t2) + 1`, and X-1 stays open for a party's appeal. If R8 finds that branch still there, it takes `_roundAfter(d.t2)`.
  - The coordinator confirms the order of the packages; the plan has both before R8.
- **A redeploy** carries the change, with the rest of the phase-one contracts. It is Rafa's.
- **Deals open on the old deployment at the cutover** [red team, RT-5]. The old contract demands `roundAt(judgeBy)` for the fallback and has no `BEACON_MARGIN()`. Once core and the service carry the new rule, a deal still open there would be decided off chain for a round the old contract refuses, and would default to a refund. So the adapter keeps the old rule for the old address, or the operators let the old deployment's deals finish before core changes. The task that plans the redeploy picks one.
- **The fallback starts later.** On a drand deployment the fallback adjudicator cannot derive its panel until 29 to 31 s after `judgeBy`. Today it can at `judgeBy`.
- **An escalation's decision lands at least 36 s after the escalation,** against 12 s today.
- **Docs that other lanes update when R8 lands:** `docs/audit/state-model.md` (section 5.3's named rounds, section 6.3, finding F-2), `docs/audit/threat-model.md` (TA-2, the block proposer's row), `docs/audit/known-issues.md` (X-1, T-225 M1, I-5), ADR-0018 (a pointer to this ADR), `site/llms.txt` and `docs/api.md` (the smallest windows). This task edits none of them.
- **T-225 item 1** is settled by section 3.3, with a margin T-225 did not have. Its advice to choose a `judgeBy` on a round boundary is no longer needed once R8 lands.
- **SimChain and the local world do not change.**

## 11. Litmus tests

- **Neutrality.** Passes, and narrows one actor. The block proposer's power over a panel's seed drops from any proposer to one that holds three slots in a row. No new actor can stop a deal: the margin is an immutable, the beacon's rounds stay public and permanent, and a round that cannot be proven still leads to the default (ADR-0018 §5). A window too short to decide leads to the default outcome the parties signed, as it does today.
- **The hold.** Unchanged. No deadline moves, so the hold's expiry does not move (`:169`).
- **Defended judgment.** Strengthened. "Selected by commit-reveal" means that nobody who chooses can know the panel first; the rule restores that for the escalation and the fallback against everyone but the residuals of section 6. No panel is re-rolled: the round is still fixed by settlement state and never by a caller.

## 12. The red-team pass

One `red-teamer` subagent attacked the rule on 2026-11-11. It had `CLAUDE.md`, the contract, core, the adjudicator service, the review and its tests, ADR-0018, ADR-0031 and the audit docs. It read this ADR's rule first (the Summary and sections 2, 3 and 5) and wrote its attack list before it read the reasoning of sections 4 and 6 to 9. It ran no forge or pnpm command and sent no transaction; it checked the arithmetic with its own script and fetched public texts read-only.

**Verdict: the claim holds against every party that only chooses when to act. No Critical or High finding; 1 Medium, 6 Low, 6 Info.** None breaks the rule's arithmetic.

**Who can still learn the seed before committing, and at what cost** (the red team's table, with this ADR's answer in the last column):

| Who | How | Cost | Where this ADR answers |
| --- | --- | --- | --- |
| A validator operator, or colluding operators, with three slots in a row | Withhold three blocks, read the round, then publish | No protocol penalty; 5 to 6 s to publish or lose all three; three late blocks in public view; about 2.8 runs a day at 7.31% of the stake, 0.19 at 3% | Section 6, residual 1; BR-6 |
| The same with one or two slots, when the neighbours are offline, slow or paid | The same | An offline proposer is visible in advance | Section 4; BR-6 counts empty slots |
| A threshold of drand's nodes | Sign any future round now | Collusion of the threshold | Section 6, residual 2 |
| The sequencer of a one-sequencer chain, and every sender while a chain's block times lag real time | Build blocks stamped in the past; read a round that is already public | Free | Section 6, residual 3; BR-7 |
| Each Sepolia validator operator | Runs of three slots are routine in a small set | Free; no real money | Section 8, item 2 |

Nobody else: not the buyer, the seller, an adjudicator, a relayer, an operator node, or a block builder on mainnet [inferred by the red team].

**The findings and the answers:**

| # | Severity | Finding | Answer |
| --- | --- | --- | --- |
| RT-1 | Medium | The adjudicator service computes the round with its own function (`apps/adjudicator/src/randomness.ts:36-41`), and this ADR's first draft said the service needed no change. A repair without the margin passes every local test, because the local margin is 0; on a drand deployment every fallback and escalation would then default | Accepted and fixed in the text. Section 3.5 names the files, one shared core function and how the margin reaches the service. Section 3.6 adds the test of the service against the contract at 29 s. Gate line BR-10 adds a live fallback and a live escalation on Sepolia |
| RT-2 | Low | The "chance per escalation" holds only when the attacker does not pick the escalation's time. A seller that times its delivery aims the primary's escalation at a colluding operator's run, which is public up to 12.8 minutes ahead. A short expiry does not bound it | Accepted. Section 4's table now gives runs per day beside the chance for an untimed escalation, and says which attacker each answers. Section 6, residual 1, names the timed escalation, its gain (one known draw, then one blind) and its cost. BR-6 measures runs per day. The rule does not change; `n` stays Rafa's call |
| RT-3 | Low | "The attacker cannot know that in advance" was wrong for empty slots: the schedule is public and an offline validator is visible | Accepted. Section 4 says so, and residual 1 no longer limits the attacker to a large custodian |
| RT-4 | Low | The live world wakes the fallback once at `judgeBy` and then retries 2, 6, 14, 30 and 62 s after the trigger. With the round public 29 to 31 s after `judgeBy`, the fallback can start about 63 s into a 120 s window | Accepted. Section 3.5 sets the alarm to the round's publishing time, and the change list names `apps/demo-cloud/src/world.ts`. Section 2 now records the 120 s fallback window |
| RT-5 | Low | With a margin of 0 the fallback's rule is not today's. A deal open on the old deployment at the cutover would be decided for a round the old contract refuses | Accepted. Section 3.1 states the difference; section 10 gives the two ways to handle open deals |
| RT-6 | Low | The constructor accepts a wrong margin: a value in milliseconds, one swapped with `expiryMargin`, or 1 to 23 s | Accepted. Section 3.4: the deploy script takes the margin from a per-chain table and refuses any other value, and agents read `BEACON_MARGIN()` themselves. BR-1 covers Sepolia too. The constructor itself gains no upper bound: a contract cannot know its chain's slot time |
| RT-7 | Low | Package R8 depends on the strict order of deadlines and on the cut of party appeals, and the draft stated neither as a condition | Accepted. Section 10 states both, and section 3.6 adds the `judgeBy = 0` test |
| RT-8 | Info | Section 6 argued "no move left" for the escalation only. On the fallback path the buyer can accept early after reading the panel, while nobody has triggered the fallback | Accepted. Section 6 says so. The gain is the fee, and the rule narrows it |
| RT-9 | Info | The reason given for half a slot did not hold: under Gloas a deadline sits at 75% of a slot, and a builder may withhold its payload for about 12 s. The margin still holds, with 2 to 3 s to spare | Accepted. Section 4 states the bound as the next proposer's choice of parent and calls the half slot slack. The Gloas claim stays unverified here; BR-2 re-derives it |
| RT-10 | Info | Three loose numbers: the fallback floor is 43 s on mainnet and 44 s on Sepolia; today's is 13 s; "it costs nothing" is true for the escalation only | Accepted. Section 5, the Summary and BR-5 carry the corrected numbers |
| RT-11 | Info | The rewritten gate test's `InvalidSignature` assertions pass today; four test cases were missing; the `emit` needs a cast; fixtures and one user-facing sentence state the old rule | Accepted. Sections 3.3, 3.5 and 3.6 |
| RT-12 | Info | Alternative B was dismissed partly for a wrong reason (the storage word has room after the cut of party appeals), and a round fixed by a signed deadline was not listed | Accepted. Section 7, rows B and I. Answering it surfaced the timed `judgeBy` of residual 1 |
| RT-13 | Info | Residual 3 missed chains whose block times lag real time | Accepted. Section 6, residual 3; BR-7 |

**Attacks that failed** [the red team's list]: a gate contract on the fixed rule; a block builder on mainnet; a builder under Gloas; two slots in a row (24 s, or 28 s with a late next proposer, against 30 or 31 s); one slot plus the attacker's own votes; a reorganisation after the round; the primary near `judgeBy`; a relayer choosing among rounds; drand nodes with fast clocks; grinding the commitment ID at signing, once the order of deadlines is on chain; overflow, wrap and pre-genesis edges; the 40-bit `t1`; core in milliseconds against the contract in seconds; moving funds or the key outside the terms.

**Arithmetic the red team confirmed with its own script** [measured by it]: the two phases on all six headers; the delay of 30 to 32 s over 600 consecutive seconds; 31 s and 30 s per chain; the smallest windows of 13, 25, 37 and 49 s by brute force over an hour of slots; the four rounds and two signatures of sections 2 and 3.6; no simulated round moving at a margin of 0; the stake figures; no wrap of `roundAt` for any 64-bit input.

**What the red team could not check:** any test run; the private plan's package order and cutover; the staking shares and the share of empty slots; whether mainnet runs EIP-7917 today; the Gloas validator guide; how fast the reference primary escalates on a screen flag; any L2's timestamp rules.

## 13. Not verified

- Gloas's fork-choice rules for a late or withheld execution payload: the text was not read. The half slot of section 4 covers the payload deadline in the Sepolia config; BR-2 re-derives it.
- The share of mainnet slots with no block, and any measured distribution of how late mainnet blocks are published: no readable source. The margin does not depend on either.
- That `pnpm snap` shows no difference with a margin of 0: inferred from the arithmetic; nothing ran.
- The EVM adapter: not read. Section 3.5 states what it must do, not how. The adjudicator service was read at `randomness.ts:28-41`, `service.ts:516-528` and `:646` only.
- The timed `judgeBy` of section 6, residual 1: this task's own reasoning, not checked by the red team.
- No test ran in this task or in its red team. Section 3.6 describes tests; package R8 runs them.
- The staking shares come from one dashboard with no date on the page.
- drand's `common/time.go` was not fetched again today; the review's citation and two measured rounds stand in for it.
