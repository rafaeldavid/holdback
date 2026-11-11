# ADR-0032: The beacon rounds for escalation and fallback

- **Status:** Proposed, 2026-11-11. Rafa may overrule any line. The line most likely to be his call is the number of slots the margin covers (section 4).
- **Date:** 2026-11-11
- **Raised by:** T-348, for package R8 of the contract refinement plan (kept privately, `docs/private-materials.md`). It answers finding X-1 of the drand verifier's review (`docs/reviews/2026-11-11-drand-verifier-review.md`, §10), item 1 of the private hardening task T-225 (the fallback's round), and finding F-2 of the state model (`docs/audit/state-model.md`, section 10).
- **Builds on:** ADR-0006 (defended judgment), ADR-0018 (the panel seed beacon), ADR-0031 (the phase-one scope); D26, D31, D32, D57.
- **Amends:** ADR-0018's round rules (its Decision, item 2) for the fallback and for the appeal adjudicator after an escalation, and its sentence "The appeal rounds hold: they publish strictly after the step that fixes them."
- **Changes (when built, by package R8):** `contracts/src/HoldbackRules.sol` and its tests; `packages/core/src/state.ts` (`beaconRoundFor`); the deploy scripts and the deployment records; the operator's prepare route (one advisory warning). **No signed type and no file in `spec/schemas/` changes.** This ADR itself changes no code.

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

**A window below the smallest is not refused.** It is a stated limit. The operator's prepare route warns below it, and the contract keeps refusing only a window of 0 (D31).

**What stays possible.** One party, or a set of colluding parties, that proposes three slots in a row can still learn the seed before the escalation is fixed. So can a threshold of drand's nodes, and the block producer of a chain with one sequencer. Section 6 says why the first two are accepted for phase one and why the third is a question for the choice of chain.

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
| The largest staking entities | Lido 21.84%, Binance 7.31% | documented: the Dune dashboard `hildobby/eth2-staking`, read 2026-11-11; the page shows no date, and its newest rows are dated 2026-11-09. Lido is an umbrella over many node operators |
| The share of mainnet slots with no block | unverified | The one source tried (beaconcha.in) refused the fetch |
| Escalation windows in the repository's terms | 300 s | measured: `appealDecideSec: 300` in all seven files under `fixtures/terms/` that set it |

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

seconds after `lastChoice`. So the delay is at least `BEACON_MARGIN + 1` and at most `BEACON_MARGIN + P` seconds [inferred from `roundAt`, `DrandQuicknetBeacon.sol:74-76`, and the publishing time of a round]. With a margin of 0 the function is today's escalation rule.

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
- `triggerFallback` emits the same round: `emit FallbackTriggered(id, _roundAfter(uint256(t.timing.judgeBy) - 1))` (`:550`). The event stays; its second value follows the rule.
- With a margin of 0 this is T-225's proposal, `roundAt(judgeBy − 1) + 1`, the first round at or after `judgeBy`. This ADR adds the margin, for the reason in section 4: without it a block built 1 to 3 s late, just before `judgeBy`, has the same view that X-1 gives.
- The round is published `BEACON_MARGIN` to `BEACON_MARGIN + 2` seconds after `judgeBy`: 29 to 31 s.
- `judgeBy − 1` cannot underflow: the deadlines are in strict order after the phase-one cut SC-5 (ADR-0031), so `judgeBy` is at least 3.

### 3.4 The constructor

- `HoldbackRules`'s constructor takes `uint64 beaconMargin` and stores it in `uint64 public immutable BEACON_MARGIN`. Nothing can change it afterwards, as for every other constructor argument (hard rule: no admin keys).
- The constructor refuses a margin of 0 on any chain but 31337, the local chain. `SimBeacon`'s constructor has the same guard for the same reason: a stand-in must not reach a shared chain. This is a deploy-time check on the deployer, not a limit on any value the parties set.
- The deploy script names the chain's margin, and its `--check` reads `BEACON_MARGIN()` back and compares it with the deployment record.

### 3.5 Core and the services

- `beaconRoundFor` in `packages/core/src/state.ts:307-314` changes with the contract, in the same pull request:
  - fallback: `roundAt(clock, judgeBy − 1 s + margin) + 1`;
  - escalated: `roundAt(clock, escalation.at + margin) + 1`.
  Core counts in whole seconds, as `roundAt` already does at `:299`.
- **The margin has one source: the contract's immutable.** The EVM settlement adapter reads `BEACON_MARGIN()` once and hands it to core with the beacon source. SimChain uses 0. The margin is not a field of the terms or of the rulebook, so no signed type and no schema file changes, and no fact lives in two places.
- The adjudicator service already asks only for the round `beaconRoundFor` names, and never for a round that is not yet published (ADR-0018, "As built"). It needs no other change [inferred from that text; the service's code was not read beyond line 646].
- SimChain and the local world keep a margin of 0, so no simulated round moves: on the sim beacon `roundAt(t) = t`, the escalation's round stays `t1 + 1` and the fallback's stays `judgeBy` [inferred from the arithmetic; nothing ran]. `pnpm snap` and `pnpm snap --settlement=local` should show no difference; package R8 measures it.

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
- **Core against the contract.** `beaconRoundFor` and `_roundAfter` give the same round for the same inputs, over the same range, for both panels and for margins of 0 and 29 s.
- **The constructor.** A margin of 0 reverts on a chain ID other than 31337.

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
- A later slot that is empty counts as the attacker's. The attacker cannot know that in advance.
- "Proposes" includes several proposers that collude.
- A block builder that is not the proposer fixes the block's contents when the proposer signs, at most 4 s into the slot. Past that it needs the proposer [inferred from the relay cutoffs of section 2].
- **Why half a slot and not 4 s.** Half a slot is the latest deadline inside a slot under either fork's rules: votes are due at a third of a slot on mainnet, and the execution payload at half a slot under Gloas. The margin then holds on both without a second number. It costs nothing: the smallest decidable window is the same for any delay from 24 to 35 s (section 5).

**Why `n = 2`.** Each slot of margin costs 12 s on the escalated path and on the fallback path, and makes the residual rarer by the attacker's share of the stake. When an escalation goes to the public mempool as soon as it is signed, the attacker gets one chance: it must hold the slot the escalation lands in and the `n` slots after it.

| `n` | Margin | The round is published after the block's time by (mainnet, Sepolia) | Smallest escalation window | Slots the attacker must hold in a row | Chance per escalation, at 7.31% of the stake | At 21.84% |
| --- | --- | --- | --- | --- | --- | --- |
| 0 (today) | 0 s | 1 s, 3 s | 13 s | 1, or the builder of that block | not a matter of stake: whoever builds the block | the same |
| 1 | 17 s | 19 s, 18 s | 25 s | 2 | 0.53% | 4.77% |
| **2 (chosen)** | **29 s** | **31 s, 30 s** | **37 s** | **3** | **0.039%** | **1.04%** |
| 3 | 41 s | 43 s, 42 s | 49 s | 4 | 0.0029% | 0.23% |

- The chances are the share raised to the number of slots [inferred: it assumes each slot's proposer is drawn independently in proportion to stake]. The two shares are the largest single custodian and the largest umbrella in section 2's source. An umbrella of many operators is an upper bound, since all of them would have to collude.
- `n = 1` leaves a single custodian a 1-in-190 chance on every escalation it cares about. `n = 2` makes it 1 in 2,560. `n = 3` buys another factor of 14 for 12 s more.
- An escalated case then waits for a panel of models, which takes tens of seconds by itself. 29 s is of the same size; it is not the "settle in seconds" path, which is a primary's accept.
- The choice is a judgment, and it is Rafa's to overrule. A smaller `n` is a one-word change before the deploy; nothing else in this ADR moves except the numbers of this table.

**Why fixed at deploy, and not a term of the deal.**

- The margin answers the chain's block production, which the parties cannot manage. D31 is about values they can.
- A margin of 0 in the terms would let one party's relayer shop the panel against the other. The design principle of user choice stops at options that let one party break a litmus test against the other (ADR-0015).
- A term would change a signed type, with a schema version and new hash vectors, for a number no deal has a reason to lower.
- A later phase may let the terms raise the margin above the chain's floor. Nothing here blocks that.

**Other chains.** This ADR decides nothing about where Crow settles. A chain gets its margin by the same method before the rules contract is deployed there: its block time and how timestamps are set, from its specification and from measured headers; the latest moment a block's contents can be fixed, in its consensus rules; and who can produce consecutive blocks. On a chain where one sequencer builds every block, no margin shorter than the sequencer's own freedom to delay or reorder keeps the seed from the sequencer (section 6, residual 3).

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

**The fallback's window has the same kind of floor.** The fallback's round is published 29 to 31 s after `judgeBy`. A decision then needs a block before `fallbackBy`. Where `judgeBy` falls inside a slot is the parties' choice, so the floor depends on it: a fallback window (`fallbackBy − judgeBy`) of 44 s or more always has such a block (31 + 12 + 1), and a shorter one may not [inferred]. Today 12 s is always enough. The handling is the same: the strict order `judgeBy < fallbackBy` is the only refusal, and the prepare route warns below 44 s.

**Not adopted: adding the margin to the deadline.** The deadline could become `t1 + BEACON_MARGIN + appealDecideSec`, so that the margin costs the parties no part of the window they signed. It would move the hold's expiry (`:169`), the default's timing (`:563`), core's `appealDecideBy` and the formal model, for a limit that a warning already covers. The window keeps one meaning: seconds from the escalation's block.

## 6. What stays possible, and whether it is accepted

**Nobody who only chooses when to act gains anything.** A relayer that holds a signed escalation still picks the block, and so the round. Every round it can pick is at least 30 s in the future, and a drand round's value does not exist until a threshold of the network signs it. The gate contract of the review's test has nothing to check.

**After the round is public, no single party has a move left that depends on it.** In `Escalated`, the appeal adjudicator decides, both parties together may settle, and anyone may trigger the default once the window has passed [inferred from the entry points; the plan's item IS-8 says an early accept is not allowed in this stage].

The residuals:

1. **A party that proposes the escalation's slot and the two after it** (or fewer, when a following slot is empty) can withhold its blocks, read the round, and then include the escalation or leave it out. The same holds for the last slot before `judgeBy` and the fallback's round.
   - **What it costs the attacker.** No protocol penalty [inferred from the fork-choice text]. The withheld blocks arrive late for every node, which the network records.
   - **How often.** Once per escalation at the chances of section 4's table, when the escalation goes to the public mempool at once. More often when the relayer waits for the attacker's run of slots: three slots in a row come up about 2.8 times a day at 7.31% of the stake and about 75 times a day at 21.84% [inferred: 7,200 slots a day times the share cubed]. Each run is one draw of a panel, and the attacker needs a panel that suits.
   - **Accepted for phase one.** The attack needs a validator operator at the scale of a large custodian to collude with a party to one deal and to withhold blocks in public view. The loss is bounded by that deal's price and fee. The signed escalation, the block times and the late blocks are an attributable record (D26). A dishonest primary gains no power from it: it could decide the case itself.
   - **Not accepted without a look on mainnet:** gate line BR-6 measures the shares before a mainnet deploy, and `n` is Rafa's to raise.
2. **A threshold of drand's nodes** can compute any round early. This is the review's gate line G-7 and assumption TA-9 of the threat model. No margin changes it. Accepted, as already recorded.
3. **The single block producer of a chain with one sequencer** holds every slot in a row. The margin keeps the seed from everyone else and not from the sequencer. This ADR neither accepts nor refuses it: it goes to the choice of chain (gate line BR-7).
4. **The relayer's window is as long as the escalation's expiry.** With the margin, a longer window gives a lone relayer nothing. Combined with residual 1 it gives more draws. A short expiry on a signed escalation, and an adjudicator that sends its own escalation to the chain at once, cut the draws to about one. Both are the adjudicator's practice and need no contract change (D32). Follow-up for the adjudicator lane: the reference adjudicator signs an escalation with an expiry of a few slots, not its whole turn (`service.ts:646`).
5. **The appeal adjudicator can let the window pass after it sees its panel,** and the deal then defaults to a refund. It could as well sign a reject. This is the trust the parties place in the adjudicator they chose (threat model, TA-13); the margin does not change it.
6. **A reorganisation after the fact.** A party that can remove a block three slots deep, after the round is public, can undo an escalation. That takes far more stake than withholding its own blocks [inferred]. Covered by residual 1's acceptance.

## 7. Alternatives considered

Each row says what an attacker can still do. "Timing" is a party that only chooses when its transaction is sent. "Builder" is a party that fixes a block's contents.

| # | Alternative | Timing attacker | Builder | Verdict |
| --- | --- | --- | --- | --- |
| A | **A margin after the block, fixed at deploy** (chosen) | Nothing: every round it can pick is unpublished | Needs `n + 1` slots in a row (section 4) | Chosen. One immutable, one function, no new state, no signed type |
| B | **The signer names the round.** The primary's signed escalation carries a future round; the contract takes the escalation only while that round is at least a margin away, and stores it | Nothing, and it cannot even pick the round | The same as A for the same margin, with one try per signed message | Not adopted. It needs 64 more bits in a deal's one storage word and a new meaning for a signed field that is unenforced today. It adds a failure of its own: an escalation that misses its round cannot land until the primary signs again. A short expiry gives the same one try with no contract change (section 6, residual 4) |
| C | **A commit by the escalating party, then a reveal.** One transaction commits to the escalation; a second, at least a margin later, reveals it | Nothing | The same as A: the round must still be fixed by the commit's block plus a margin | Not adopted. An escalation holds no secret to hide, so the commit adds nothing to A. It costs a second transaction, more state, and a commit that is never revealed |
| D | **The round of a later block's time.** The seed comes from the first round after the time of the block `k` blocks later | Nothing | A proposer that skips its own slot moves that block's time by 12 s, and so the round by 4: one bit of choice per slot it holds, at the price of a block | Not adopted, and weaker than A. In A nothing after the escalation's block can move the round. The contract also cannot read a later block's time without a second transaction, whose sender then picks the block: X-1 again |
| E | **Keep today's rule and refuse contract callers** | Sends the same test through a builder's bundle, which drops the transaction when the seed does not suit | Unchanged | Not adopted. It stops nothing, and it breaks callers that are contracts, which Rafa kept (ADR-0031, SC-4) |
| F | **A margin as long as finality** (two epochs, 768 s) | Nothing | Needs to revert a finalized chain | Not adopted. It makes every escalation and every fallback wait about 13 minutes. Section 4's table is the same trade at a smaller size |
| G | **The fallback without a margin** (T-225's rule as written) | Nothing | A block built 1 to 3 s late, just before `judgeBy`, sees the fallback's round: any proposer | Not adopted. It leaves the fallback where X-1 leaves the escalation today. One rule for both costs 29 to 31 s at the start of the fallback's turn |
| H | **Another source,** the chain's own randomness (`prevrandao`) at a later block | Nothing | Each proposer of the last slots holds one bit by skipping its block | Out of scope: Rafa kept the drand proof on chain for phase one (D57), and ADR-0018 keeps `prevrandao` as a club's option on L1 only |

## 8. What a testnet cannot show

1. **How late mainnet blocks are built.** Sepolia's validators are a small permissioned set with no market for block space. Mainnet proposers sell their blocks through relays and gain by waiting. Sepolia shows the arithmetic, never the incentive.
2. **Who holds slots in a row.** The chances of section 4 depend on mainnet's stake shares, which Sepolia does not have.
3. **Mainnet's fork rules.** Sepolia has run Gloas since 2026-10-06; mainnet has no date. The deadlines inside a slot differ (votes at 3 s against 4 s; a payload deadline at 6 s that mainnet does not have yet). A test on Sepolia is a test of Sepolia's rules.
4. **Mainnet's phase against drand.** Sepolia's block times are 0 mod 3 from drand's genesis and mainnet's are 2 mod 3. The round is published 30 s after a Sepolia block and 31 s after a mainnet one. The forge tests use a mainnet-phase clock; a live Sepolia run cannot.
5. **The late-block rule in practice.** Which mainnet proposers orphan a late block, and how often, decides the cost of the 4 to 12 s row of section 4. The margin does not rely on it.
6. **A withheld run of blocks.** Nobody can stage three withheld slots on a public testnet without holding them. The forge tests show what the contract accepts at a given block time; they do not show block production.
7. **The share of empty slots,** which lets an attacker with fewer slots succeed. Unverified here (section 2).

## 9. Lines for the mainnet gate

These refine the review's line G-9 ("settle finding X-1 before any path that uses `roundAt(t) + 1` runs on mainnet"). Each is a check to pass before a mainnet deployment of the rules contract.

| # | Line | Why |
| --- | --- | --- |
| BR-1 | The deployed rules contract's `BEACON_MARGIN()` reads 29, and the deploy script's `--check` compares it with the deployment record | The margin is an immutable. A wrong value cannot be corrected, and a value of 0 is today's finding |
| BR-2 | On the day of the deploy, re-derive the margin from the fork mainnet runs: the slot time, the deadlines inside a slot, and the rule for a late block, from the consensus specifications at that fork | Mainnet will adopt Gloas at a date not yet set. If a deadline inside a slot moves past half a slot, or slots get longer, 29 s is too short |
| BR-3 | Measure the phase on at least 100 recent mainnet headers: every block time is 2 mod 3 from 1,692,803,367, and consecutive times differ by a multiple of 12 s | Section 5's number rests on it. Three headers were measured here |
| BR-4 | The rewritten `test_attack_wrongRound_…` tests, the fallback test, the delay property and the core cross-check of section 3.6 pass on the frozen commit, with a margin of 29 s | They are the proof that X-1 and the fallback's gap are closed in the contract that ships |
| BR-5 | The prepare route's warning, the state model and the agent docs state 37 s for the escalation window and 44 s for the fallback window on mainnet | A party must be able to learn the limit before it signs (D32) |
| BR-6 | Measure the stake share of the largest entities and how often one proposes three slots in a row, over a recent month of mainnet slots. Rafa accepts the result or raises `n` | Section 6, residual 1. The shares here come from one dashboard on one day |
| BR-7 | For any chain other than Ethereum mainnet: derive the margin by section 4's method, and record who can produce blocks in a row there. A single sequencer is named in `docs/neutrality.md` as able to choose an escalation's panel, or the chain is not used | Section 6, residual 3 |
| BR-8 | The reference adjudicator signs an escalation with a short expiry and sends it to the chain itself, at once | Section 6, residual 4. It bounds the relayer's draws to about one |
| BR-9 | The threat model's assumption TA-2 and ADR-0018's "Known gap" paragraph describe this rule and its residuals | TA-2 says today that the planned fix leaves a margin of one block. The audit-docs lane owns that file |

## 10. Consequences

- **Package R8** builds sections 3.1 to 3.6 in one pull request for the contract and core together, with the side-by-side run's list of allowed differences: the round of every fallback and escalation decision on a drand deployment, and the second value of `FallbackTriggered`.
- **A redeploy** carries the change, with the rest of the phase-one contracts. It is Rafa's.
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

To be filled in before this ADR merges.

## 13. Not verified

- Gloas's fork-choice rules for a late or withheld execution payload: the text was not read. The half slot of section 4 covers the payload deadline in the Sepolia config; BR-2 re-derives it.
- The share of mainnet slots with no block, and any measured distribution of how late mainnet blocks are published: no readable source. The margin does not depend on either.
- That `pnpm snap` shows no difference with a margin of 0: inferred from the arithmetic; nothing ran.
- The adjudicator service beyond `service.ts:646`, and the EVM adapter: not read. Section 3.5 states what they must do, not how.
- The staking shares come from one dashboard with no date on the page.
- drand's `common/time.go` was not fetched again today; the review's citation and two measured rounds stand in for it.
