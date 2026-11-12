# T-374: the lane takes main, then AL-1, the code alignment

- **Status:** in progress
- **Kind:** 4 (API and operator code), with one reviewer, on `contracts-audit-ready` (the plan's 7c.2 sets that rule for AL-1)
- **Branch:** `t-374-lane-sync` (part 1), then `t-374-al1-*` (part 2); pull requests into `contracts-audit-ready`, never `main`
- **Budget:** 300,000 tokens, a target and not a stop
- **Source:** the contract refinement plan, sections 7b, 7c.2, 7c.3 and 7d (kept privately, `docs/private-materials.md`)

## Intent

The lane holds the phase-one contracts, and `main` holds the contracts deployed on Sepolia. On 2026-11-12 `main` gained a day of work the lane lacks: the seller's page, the seller adapter's link to a seller's own API, the buyer's approval stop, `pnpm send-timeout`, the screen change with re-seated recordings, the One-Click harness, docs and CI. Two later lane sessions (R6c-2, the operator side, and R6c-3, the client side) edit those same files, so the lane must take `main` first.

**Part 1** merges `origin/main` into the lane in one pull request. Where a file depends on the contracts' shape (the contracts, core, the adapter, the schemas, the fixtures' terms), the lane's side wins. Where only `main` changed a tool or a doc, `main`'s side wins. Where both changed a file, the merge keeps both changes, and this file says how. The recordings are re-seated again on the merged code, because both sides re-seated them for different reasons. `examples/send-timeout.ts` is ported to the phase-one contracts: three timeouts (`reclaim`, `triggerFallback`, `triggerDefault`), no `Expired` stage, no bond vault, the two address fields in the terms file, and a reclaim that refunds the buyer's payment address. Everything `main` added compiles and passes against the lane, or is marked SimChain only where that is true.

**Part 2** is AL-1: the alignment test's known list (`tests/cut-feature-alignment.known.json`) goes to zero for the code AL-1 owns. That is the Sepolia round's scenarios (the appeal scenarios move to SimChain only), the fork suites (one rewritten from a party appeal to an escalation), the testkit's leftovers, `tools/`, `apps/demo`, the two test rulebooks that still allow any payee, `predeploy-fork.test.ts`, the escalation gas check and the follow-ups the plan's 7d gives AL-1. `packages/sdk/` is R6c-2's, and `examples/agent.ts` and `examples/verify.ts` are R6c-3's; this task lists what it would change there.

## Acceptance criteria

1. The lane holds `main`'s commits and every check passes: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm validate:spec`, `pnpm snap`, `pnpm snap --settlement=local`, `forge test`, the anvil suites and the site check.
2. `pnpm send-timeout` ends a deal on a local chain with the lane's contracts and no operator, from a third key, for each of the three timeouts; a Delivered deal takes two runs.
3. The known list holds no file AL-1 owns; every remaining file is named with its owner.
4. The Sepolia round's scenario list passes on anvil against the lane's contracts.

## Evidence

### Part 1: the lane takes main (pull request `t-374-lane-sync`)

The merge brings `origin/main` at `ec498d9` into the lane at `a37a48d` (after PR 387). Main was 155 commits ahead of the lane and the lane 123 ahead of main [measured, `git rev-list --count`].

**Conflicts: 145 paths, and how each was settled** [measured, `git merge`]:

| Paths | Settled | Why |
| --- | --- | --- |
| 139 under `fixtures/recordings/` and `fixtures/scenarios/*.expect.md` | The lane's side, then re-seated on the merged code | T-367's Handoff gives this order. Both sides re-seated the same recordings for different reasons (domain 0.8 on the lane, screen-1 on main) |
| `apps/adjudicator/src/service.ts` | Both | Main's timed store reads (`#port`, `#list`, T-372) with the lane's phase-one guards (no appeal expiries, no bond cover). `#port` now reads `phaseOne` through to the settlement port |
| `apps/demo-cloud/src/world.test.ts` | Both | Main's new imports, without `BondReads`, which the lane removed with the bond vault |
| `examples/buy-with-signer.ts`, `examples/buyer-signer.ts`, `examples/buyer-signer.test.ts`, `docs/tasks/T-332-buyer-signer-signed-fields.md` | Main's side | The lane's copies predate T-332. The lane's earlier sync merge `c75b1ba` (T-346) kept them by mistake, and no lane commit changed them after it [measured, by comparing blobs across `9466ee5`, `65e734d` and `c75b1ba`; the reviewer measured the same]. Main's versions also carry T-368's approval stop |

**Found in the same check, not restored here:** `c75b1ba` also dropped T-345's zero-price work: `contracts/test/unit/ZeroPrice.t.sol` (R7's; T-358 already named it) and the zero-price sections of `docs/audit/state-model.md` §12 and `docs/audit/threat-model.md` §7 (AL-2's). Both describe the contracts on main, so each owner restores them in the lane's shape.

**Main's files that did not fit the lane, and what changed:**

- `examples/send-timeout.ts` and its test: ported (below).
- `contracts/test/unit/MutationGaps.t.sol` (T-352) does not compile against the phase-one contracts: it funds by Permit2 (`_permit2`, `Funding.method`) [measured, `forge build`]. It stays on main; porting its mutant kills is R7's or R10's. `docs/audit/test-quality.md` still names it.
- `contracts/test/unit/AgreeAndFundExpiry.t.sol` (T-352) passes on the lane: 4 of 4 [measured, `forge test --match-path test/unit/AgreeAndFundExpiry.t.sol`].
- `fixtures/terms/audit-export.json` (T-355): schema `0.8` and an appeal window of 0, as T-358 moved the YAML terms.
- `site/llms.txt`: the EIP-712 types block and the domain pin's version regenerated from `examples/verify.ts`, and one `schemaVersion` line moved to `0.8`. The lane's copy failed the site check before this merge [inferred: the lane's `llms.txt` pinned 0.7 without the two address fields, and the lane's `verify.ts` pins 0.8 with them].

**The recordings' re-seat** [measured]: `pnpm exec tsc -b packages/testkit && node scripts/reseat-recordings.mjs`, then `node packages/testkit/dist/cli.js --update <fixture>` for each of 43 fixtures, then `pnpm snap`: 43 passed. 42 verdicts changed seat. Every fixture's final state, aggregate and screen result equals main's. `todo.provider-outage` took a fake pass on its new `gpt-a` seat; it takes main's authored abstain again, and escalates with both GPT seats abstaining.

**`send-timeout` on the lane** (the plan's 7c.3): three timeouts (`reclaim`, `triggerFallback`, `triggerDefault`); `None`, `Released`, `Refunded` and `Settled` have nothing to send; no bond vault; the domain check (0.8) refuses the contracts on main; the two address fields enter the commitment ID and the `Terms` tuple; a refund goes to the payment address. The reviewer compared the ID and every tuple field with `verify.commitmentIdOf` and `e2e-chain.termsTuple` and found them equal [measured by the reviewer].

**The alignment test's known list:** 117 files before the merge, 118 after [measured, `tests/cut-feature-alignment.known.json`]. The one new file is `docs/audit/test-quality.md` (T-352; owner R12 or AL-2).

**Checks** [measured, in the worktree]:

| Check | Result |
| --- | --- |
| `pnpm typecheck`, `pnpm lint`, `pnpm validate:spec` | pass; 35 of 35 examples valid |
| `pnpm test` | 3,402 passed, 7 failed under load (R7's forge running); the 7 pass alone: `audit-deal.test.ts` 26 of 26, and the four timing files 163 of 163 |
| `pnpm snap` | 43 passed |
| `node site/build.mjs && node site/check.mjs` | pass |
| `forge build` | pass, after `MutationGaps.t.sol` left |
| CI's anvil legs, run locally | settlement: 222 of 222; world: 41 of 41, `send-timeout.test.ts` 24 of 24 with its anvil suite |
| `pnpm snap --settlement=local` | 36 passed, 7 excluded (SimChain only) |

**One anvil finding for AL-1's escalation gas check:** on the phase-one contracts the primary's escalation is a call whose execution gas is below its EIP-7623 calldata floor. anvil 1.0.0 cannot estimate such a call and answers "gas floor exceeds the gas limit" [measured: the adapter's `escalate` failed in `EvmSettlement.send` → `LiveChain.pinned`]. On main the same test passed without a shim. The send-timeout test now opens its deals through the shim `packages/settlement/evm/timeouts.test.ts` uses (T-217 Decision 11). Sepolia's nodes estimate such calls [documented there; not measured here].

**Review:** one reviewer pass on the conflict resolutions and the port: PASS, no Critical or High. Fixed from it: a sender key of the right shape but out of the curve's range could have reached the output through viem's error; `senderKey` now refuses it without the value (Low). Left: see Handoff.

## Handoff

(filled in at the end)
