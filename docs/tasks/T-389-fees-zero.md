# T-389: the operators' fee is 0 for the first pilots, on the contract branch

- **Lane:** api
- **Phase:** 2
- **Depends on:** T-029 (the operator fee, ADR-0023, D33)
- **Paths this task may touch:** `apps/demo-cloud/wrangler.op1.jsonc` and `wrangler.op2.jsonc`, `apps/test-agents/wrangler.jsonc`; `apps/operator`, `apps/demo-cloud`, `packages/sdk` and `examples/` only where a zero fee needs a code change, with their tests; `apps/operator/src/sim-bin.ts` and a new `sim-text.ts` (the coordinator's addition, 2026-11-12); this task file
- **Human gate:** no (lands on `contracts-audit-ready`; the switch-over deploy that carries it is T-383's and Rafa's)
- **Status:** done
- **Agent/session:** T-389 session, change kind 4

## Intent

Rafa, 2026-11-12: "Product Fees (should be set to 0 now, we cover even gas for first wave of Pilots)."

In my own words: for the first wave of pilots, a buyer pays the price and the adjudication fee, and nothing else. The two demo operator nodes stop charging their relaying fee and its gas quote; Crow's relayer wallet keeps paying the gas. Inputs: the operators' configuration. Output: the operators publish their fee schedule at 0, and every path (prepare, funding, the outside-wallet path, the deal record, the receipts) works with a fee of exactly 0, without a needless signature for a transfer of 0.

Non-goals: the adjudication fee stays as it is (it pays the adjudicator and is part of the signed terms). The fee machinery, its fields and its tests stay: a fee is a parameter (D31), and an operator anyone else runs can still set one. Nothing is deployed here; the live service keeps its fee until the switch-over deploy of the lane.

## Context

- ADR-0023 (operator fee), D33 and its 2026-11-03 amendment (the gas quote), D31 (parametrize, don't restrict).
- `packages/core/src/fee.ts`: the fee is max(min, ceil(price × bps / 10000)), capped at max.
- `apps/demo-cloud/src/world.ts` `operatorFeeFromEnv`: on a chain world the minimum is `OPERATOR_FEE_MIN` + `OPERATOR_FEE_GAS`.

## Where the fee is set and stated (found 2026-11-12, on `origin/contracts-audit-ready` at e4e930c4)

**Set** [measured, by `git grep`]:

| Place | Values | What 0 does |
|---|---|---|
| `apps/demo-cloud/wrangler.op1.jsonc` vars | BPS "1", MIN "10000", GAS "4700000" | The live nodes' schedule. Both nodes read it: op2 serves op1's World Durable Object (its config says so). This is the one change. |
| `apps/demo-cloud/wrangler.op2.jsonc` | none (reads op1's) | Nothing to change. |
| `apps/test-agents/wrangler.jsonc` | none (the agents read `fees.operator` from discovery) | Nothing to change; the agents compute 0 from the published schedule. |
| `apps/operator/src/sim-world.ts` | none by default; a test passes `operatorFee` | Nothing to change. |
| `apps/demo-cloud/test/anvil.ts`, `examples/e2e-world.ts`, `apps/test-agents/src/test-world.ts`, `examples/try.test.ts`, `examples/buyer-signer*.test.ts`, `examples/audit-deal.ts` (its local world), `apps/demo-cloud/src/world.test.ts`, `lanes.test.ts`, `examples/e2e-scenarios-direct.test.ts` | 1 bp, 0.01 minimum, some with the 4.70 gas quote | Test worlds with their own values: they keep proving the machinery with a non-zero fee. Unchanged. |
| deploy script (`apps/demo-cloud/scripts/`) | none set; `deal.ts` only reads the schedule | Nothing to change. |

**Assumed or stated** [measured by reading the code; behaviour at 0 inferred from it, then measured by the new test]:

| Place | At a fee of 0 |
|---|---|
| `apps/operator/src/prepare.ts` (agree-and-fund) | No `operatorFee` body and no `operatorFee.signature` slot when the fee due is 0 (`due.amount !== '0'`). Two slots: the agreement and the funding. The check text drops the fee sentence. |
| `apps/operator/src/server.ts` `chargeFee` | Returns at once when the fee due is 0: no 402. |
| `examples/verify.ts` `verifyPrepared` | At `due === 0n` it rebuilds the body without `operatorFee` and two slots; a fee slot the operator added anyway is refused as unexpected. |
| `examples/agent.ts` `prepareAgreeAndFund` | Sends `operatorFeeNonce` because a schedule is published; prepare ignores it at 0. |
| `examples/buyer-signer.ts` `fundingFiles` (outside wallet), `examples/pay-from-wallet.ts`, `examples/buy-with-signer.ts` | Files are written per slot the payment address signs: only `<address>.funding.typed.json`; no `operator-fee` file and no `--fee` check line. `agreeAndFund` refuses an `operatorFee` signature for a deal that has no fee message. The approved total is price + adjudication fee. |
| `apps/demo-cloud/src/world.ts` `notesFor` | With bps 0 and min "0" the note reads "published at 0 … relay a funded agreement free for now"; with gas "0" the gas sentence is left out. |
| `examples/try.ts` | Prints "operator fee none" on funding, "the zero operator fee" on a refund. |
| `examples/deal-record.ts` | No `fee.operator` event: paid 0, due 0, the check passes. |
| `apps/test-agents/src/buyer.ts`, `seller.ts` | Total = price + adjudication fee + 0. |
| `examples/audit-deal.ts` (rehearsal) | Live mode reads the schedule: fees = adjudication fee only. Its local world keeps 1 bp. |
| `site/llms.txt`, `docs/` | State 1 bp, at least 4.71 tUSDC, and "three slots": false at 0. Owned by T-385 and T-383; the sentences are in Handoff. |

## Acceptance criteria

- [x] Both nodes' configured fee is 0: basis points, minimum and gas quote.
- [x] A fee of 0 needs no fee signature: the buyer signs the agreement and the funding only, also from an outside wallet.
- [x] A new end-to-end test on the local world (anvil) with the pilot's configuration, read from the operators' config: a deal Released and a deal Refunded; the buyer pays the price plus the adjudication fee and nothing else; the seller receives the price.
- [x] The non-zero fee tests pass with their own values.
- [x] `pnpm typecheck`, `pnpm lint`, the touched packages' tests with anvil, `pnpm snap`, `pnpm snap --settlement=local` pass.
- [x] One reviewer has read the change; its blocking findings are fixed.

## Out of scope

- The adjudication fee.
- `docs/`, `site/llms.txt`, `docs/cutover-phase-one.md`, `contracts/`.
- Any deploy.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- **Commands run and results** (2026-11-12, on the branch after merging `origin/contracts-audit-ready` at 690edfd, with the sim addition):
  - `pnpm typecheck`: exit 0. `pnpm lint`: exit 0. [measured]
  - `pnpm snap`: exit 0. `pnpm snap --settlement=local`: exit 0. [measured]
  - `npx vitest run apps/demo-cloud apps/operator apps/test-agents examples`, with anvil on PATH and `forge build` output: 76 files and 898 tests passed. 1 file (2 tests) skipped: `apps/demo-cloud/src/live-fork.test.ts`, which needs a Sepolia RPC. [measured]
  - New `apps/demo-cloud/src/pilot-fee.anvil.test.ts`: 3 of 3 passed in 22 s. [measured] It reads the fee variables from `wrangler.op1.jsonc`, checks that both nodes publish the schedule at 0, and funds two deals from a payment address apart from the signing key:
    - prepare asks for the agreement and the funding only (two slots, no `operatorFee` body);
    - the payment address gets exactly the price plus the adjudication fee;
    - on Released it ends at 0 and the seller gains 25 tUSDC; on Refunded it ends at 25 tUSDC and the seller gains nothing;
    - no `fee.operator` event.
  - New block in `examples/buyer-signer-addresses.test.ts` (SimChain, fee 0): the signer writes the funding file only, with no `--fee` check line. It refuses an operator-fee signature, and the deal record's operator-fee check passes at 0. 15 of 15 passed. [measured]
  - Non-zero fee tests unchanged and passing with their own values: `apps/operator/src/fee.test.ts`, `apps/demo-cloud/src/live.test.ts` (4.71 tUSDC on anvil), `world.test.ts`, `examples/buyer-signer*.test.ts`. [measured, in the run above]
  - The sim addition (`apps/operator/src/sim-text.ts`, asked for by the coordinator): `pnpm sim`'s start-up text is true of its profile. On phase one, one line says there are no bonds and no party appeals and the first decision is final; no bond or appeal figure is printed; on a default outcome the buyer gets the price and the adjudication fee back and nothing compensates the seller. The full profile keeps its bond and appeal economics. The third line is the operator fee the nodes publish ("none" in the sim by default). `sim-text.test.ts` pins both texts; `sim-world-phase-one.test.ts` pins that the one profile constant drives both the world and the text. 9 of 9 passed; `pnpm sim` itself printed the phase-one text. [measured]
- **Snapshot diffs:** none. [measured]
- **Metrics:** a buyer on a 25 tUSDC deal pays 30.71 tUSDC before (25 price + 1 adjudication fee + 4.71 operator fee; `live.test.ts` on anvil) and 26.00 tUSDC after (`pilot-fee.anvil.test.ts`). [measured]
- **Review:** one reviewer subagent with CLAUDE.md, ADR-0023, D33 and the threat model returned PASS. It had 3 non-blocking findings: Handoff and Evidence were empty (filled here), and a stale comment in `apps/test-agents/src/test-world.ts` (fixed). On the sim addition it found 3 non-blocking issues: the default-outcome refund wording, the profile written in two places, and the zero-fee wording. All 3 are fixed. [measured]

## Decisions

- **Publish the schedule at 0 rather than remove it.** Agents keep reading `fees.operator` and compute 0; the note says the nodes relay free for now; switching a fee back on is a config change. Removing the variables would publish no schedule, which reads as "no fee machinery" to an agent.
- **No code change for the zero case.** Every path already skips the fee slot at 0 (table above); the new test measures it.

## Handoff

**Done.** The lane's operators publish their fee at 0, and a zero fee needs no fee signature: the buyer signs the agreement and the funding only, also from an outside wallet. No code changed outside the config and the tests. The live service keeps its fee until the lane is deployed at the switch-over (T-383, Rafa's gate).

**For T-385 (`site/llms.txt`, `docs/`) and T-383 (`docs/cutover-phase-one.md`).** These sentences turn false at the deploy. Line numbers are on `origin/contracts-audit-ready` at e4e930c4.

- `site/llms.txt`:
  - line 31: "the adjudication fee and the operator fee do not" → "the adjudication fee does not".
  - line 100: "the buyer pays the operator's fee (1 bp of the price, at least 4.71 tUSDC …)" → "these nodes charge no operator fee for now and pay the gas themselves (`fees.operator` is published at 0)".
  - line 283: "The demo publishes `bps` 1 and `min` "4710000", so a 25 tUSDC deal pays 4710000 (4.71 tUSDC) …" → "The demo publishes `bps` 0 and `min` "0": the fee is 0, and prepare asks for no fee signature".
  - line 292: "Three slots …" → "Two slots while the fee is 0 (the agreement, the funding); an operator that charges a fee adds `operatorFee.signature`".
  - line 296: the `operatorFee.signature` bullet holds only when the fee is above 0.
  - line 302: "all three signatures", "the fee transfer and the funding in one Sepolia transaction", "30.71 tUSDC in all" and the 402 sentence → the signatures, the funding, 26 tUSDC in all, and a 402 only from an operator that charges a fee.
  - line 379: say "An operator fee, where one is charged, …; these nodes charge none for now".
  - line 543: drop "the operator fee".
  - line 550: replace the bullet with "No operator fee for the first pilots: these nodes charge nothing and pay the gas; `fees.operator` is published at 0, and an operator may set one".
- `docs/api.md:485`: "1 bp of the price, at least 4.71 tUSDC … a 25 tUSDC deal costs the buyer 30.71 tUSDC" → "published at 0 for the first pilot wave (bps 0, minimum 0, gas quote 0): a 25 tUSDC deal costs the buyer 26 tUSDC (price 25, adjudication fee 1), and the relayer pays the gas".
- `docs/operations.md:20`: "operator fee 1 bp, minimum 0.01 tUSD" → "operator fee 0 for the first pilots (bps 0, minimum 0, gas quote 0)".
- `docs/cutover-phase-one.md:311`: "The operators' gas quote (`OPERATOR_FEE_GAS`, 4.70 tUSDC) was measured on the old contracts …" → "The gas quote is 0 for the first pilots (T-389); record the gas anyway, to price the quote if a fee is switched on again". The smoke deal expects 26 tUSDC on a 25 tUSDC deal, no `fee.operator` event and no third signature.

The full wording is in the coordinator's shared notes (`t-389-fees-zero.md`).

**For the private pilot kit (T-387).**
- Price: on a 25 tUSDC deal the buyer pays 26.00 tUSDC, the 25.00 price plus the 1.00 adjudication fee.
- Released: the seller receives 25.00.
- Refunded: the buyer gets 25.00 back and is down the 1.00 adjudication fee.
- The wallet signs one message, the funding.

**Open for Rafa.**
- Is the adjudication fee (1 tUSDC per deal, paid to Crow's own demo adjudicator) also waived for the pilot wave? That would be a change to the demo adjudicators' registration, not to the operators.
- A buyer who wrote payment files under the old fee and funds after the deploy is told the operators "now prepare another operator-fee message" and to call `fundingFiles` again. That is safe, but the wording is imprecise. It is noted here and not changed, since it matters only for files written before the deploy.
