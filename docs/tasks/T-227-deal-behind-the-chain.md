# T-227: the operators' adjudicators act on a deal behind the chain (residual 13)

- **Lane:** settlement (with demo for the adjudicators' pass, and adjudicator if its settlement port changes)
- **Phase:** 11, security hardening
- **Depends on:** T-218 (PR 185, the chain sync; done). T-219 (PR 195, the in-flight row per relayer lane) edits the same relay code in `evm-settlement.ts` and `live.ts`, so start after it merges. Lands after T-220's deploy and before mainnet (D50).
- **Paths this task may touch** (inferred from T-218's code; the session confirms them when it restates the intent): `packages/settlement/evm/evm-settlement.ts` (`behind`, `lag`, the relay path), `sync.ts`, `live.ts` (the relay only), and their tests (`sync.test.ts`, `wall.test.ts`, `evm-settlement.test.ts`); `apps/demo-cloud/src/world.ts` (`workAt` and the adjudicator pass) and its tests (`world.test.ts`, `live.test.ts`); `apps/adjudicator/src/settlement-port.ts` and `service.ts`, only if the adjudicators read the stage through the port, and their tests; `docs/decisions/ADR-0028-demo-settles-on-sepolia.md` (a dated note in §11); `docs/neutrality.md` (residual 13); `docs/backlog.md` (its row); `docs/plan.md` (this row and the named test's line under the scenario index); this file
- **Human gate:** none in the repo. The operator deploy that takes the fix live is Rafa's, as every deploy is. No contract change is expected (inferred: the contract already settles these deals by their terms; only the operators' view and their adjudicators fall behind).
- **Status:** todo
- **Agent/session:** —

## Intent

Today a deal can fall behind the chain: the rules contract took a signed step that the operators' view cannot rebuild, so their book stops before it while `dealOf` moves on (T-218). The operators' own adjudicators read the book, not `dealOf`, so they do not act on that deal. It then ends by its timeouts: the default refund, or the first decision standing when an appeal goes unheard. The funds stay under the contract's terms, and the parties and other adjudicators can still submit to the contract directly.

This task makes the operators' adjudicators act on a deal behind the chain as on any other. They read the deal's stage from `dealOf`, and their decisions reach the chain by a relay path that records the receipt without stepping the core mirror.

It must land before mainnet. Rafa placed it here on 2026-11-05 (D50): "is this only a demo and not a mainnet problem? Or is this a mainnet security issue? If so, let's add to security hardening, since we're assuming honest actors at the moment." It is a mainnet issue (inferred): the gap is in the operator node's code, not in the Sepolia setup, so mainnet operators would run the same code. It does not block T-220's deploy, because the demo assumes honest parties (`docs/backlog.md`, Rafa, 2026-10-30).

## Context

- **Sources:** residual 13 in `docs/neutrality.md`; the backlog row "Sepolia: the operators' adjudicators act on a deal behind the chain" in `docs/backlog.md`; T-218's Decisions 2 and 3 and its Handoff ("For Rafa") in `docs/tasks/T-218-direct-calls-in-view.md`; ADR-0005 (direct submission); ADR-0028 §2 (the contract is the authority from funding on) and §11.
- **What the view follows today** (T-218): timeouts and deliveries from their logs, whatever sent them; signed steps from their calldata, at the top level, in a Multicall3 bundle, or written in a forwarder's calldata with their plain-key signatures checked.
- **What a deal behind the chain does today** (T-218 Decision 3): the state read serves `dealOf`'s stage and appeal state with a notice from `EvmSettlement.lag`. Relays for the deal answer `invalid_state`, except the posted delivery that joins. Envelopes still follow the chain, so the adjudicator whose turn `dealOf` shows already has its key. The adjudicators' schedule, `workAt` in `apps/demo-cloud/src/world.ts`, reads the book's state, so it finds no turn.

### The five cases

Three cases are attacks: whoever can cause one makes the operators' adjudicators silent on a deal, for the cost of gas. Two are gaps that honest agents with contract wallets or batched calls will hit.

| # | Case | Kind | Who can cause it |
| --- | --- | --- | --- |
| 1 | A signed step sent through a contract that transforms its calldata | Attack | Anyone holding a copy of the step: a stranger who copies it from the mempool, or a party to the deal. It costs only gas |
| 2 | A signed step from a contract signer (ERC-1271, a Safe or a smart account), sent through its wallet: this node checks plain-key signatures only | Gap for contract signers | An honest party whose agent signs with a contract wallet |
| 3 | Two signed steps for one deal in one transaction | Gap for real use | An honest party or wallet that batches its calls. A griefer gains nothing here that case 1 does not already give it (inferred) |
| 4 | A step core refuses although the contract took it (a divergence) | Attack, if a divergence exists | Whoever finds one. None is known: `pnpm snap --settlement=local` ran 28 fixtures with transcripts identical to SimChain's (measured in T-218's Evidence) |
| 5 | A signed step sent through a forwarder whose expiry lies past the year 9999, which this node cannot check the signature of | Attack | Anyone who forwards a copy of a step that carries such an expiry; the parties may sign any value the contract's uint64 holds (D31) (inferred) |

### The impact, by the step left behind (inferred from T-218 Decision 3)

- **The funding.** The operators' primary never decides and their fallback never takes over, so a delivered deal ends in the default refund at `fallbackBy`, and an undelivered one in the buyer's reclaim.
- **A decision.** The decision stands on chain, but the operators refuse to relay an appeal for the deal, and their appeal adjudicator does not act on one filed directly. The first decision stands at `appealDecideBy`. A party that won the first decision can use case 1 to shut out the appeal.
- **The bound.** No funds move outside the contract's terms, and nobody gains the deal's money (D26: bounded loss).
- **The demo's visitors.** The operators refuse every relay for a deal behind the chain, the timeouts included (`send` in `evm-settlement.ts`). A visitor's agent without Sepolia ETH then cannot submit at all, so its deal's funds wait until someone with Sepolia ETH sends the timeout. Moved to T-228 on 2026-11-05 (`docs/tasks/T-228-relay-timeouts-behind-the-chain.md`): the operators relay a due timeout for a deal behind, so criterion 2 here keeps only the signed steps.

## Acceptance criteria

1. [ ] **The adjudicators read `dealOf`'s stage for a deal behind the chain.** The adjudicator pass takes the stage and appeal state from `book.behind`, read again each pass, and the deadlines from the signed terms. The primary decides a delivery before `judgeBy`. The fallback takes over at `judgeBy` and decides before `fallbackBy`. The appeal adjudicator decides an escalation or an open appeal before `appealDecideBy`. An adjudicator that lacks what it needs to decide (a direct delivery never posted, T-218) stays silent, as today, and the state read's notice says why.
2. [ ] **A relay path that records the receipt without the mirror.** For a deal behind the chain, the operator relays each signed step the contract would take: the adjudicators' decisions and takeovers, the parties' appeals, early accepts and mutual settlements (the timeouts anyone may trigger moved to T-228). The contract is the only check (ADR-0028 §2). The node records the receipt's transaction and logs as events, reads `dealOf` again, and invents no rebuilt message. The operator still relays and never authors. If the events need a new type, it goes through an ADR and a schema version bump (`spec/schemas/` is the API contract).
3. [ ] **Each case, on anvil.** A test per case, each step sent from a stranger's or a party's own key, after which the operators' adjudicators act and the deal ends by their decision, not by its timeouts:
   - case 1 at the funding, at a decision (an appeal is then heard) and at an appeal filing;
   - case 2 through a minimal ERC-1271 wallet or a Safe;
   - case 3 with two signed steps in one transaction;
   - case 4 with a divergence forced by a test stub, since none is known;
   - case 5 through a forwarder, with an expiry past 9999.
4. [ ] **The gaps for contract signers.** For cases 2 and 3, decide and record whether the view follows them or keeps them behind with the adjudicators acting. Following means an ERC-1271 step checked with `isValidSignature` at the receipt's block, and two steps applied in call order, each matched to its logs. It serves honest agents with smart-account wallets better, and it touches core's plain-key signature check.
5. [ ] **The view stays honest.** A deal behind the chain still serves `dealOf`'s stage with its notice. Its events carry only what the receipt shows. The event hash chain stays append-only, and a transaction is applied once, before and after a restart.
6. [ ] **A named test,** `attack.copied-step-through-transformer`: a stranger copies a pending signed step from the mempool and sends it through a contract that transforms its calldata; the operators' adjudicators still decide, and the deal settles by that decision. It is listed with the other named tests under the plan's scenario index.
7. [ ] **Docs.** Residual 13 in `docs/neutrality.md` closes, or narrows to what remains. The backlog row closes. ADR-0028 §11 gets a dated "as built" note.
8. [ ] **Review.** `reviewer` and `red-teamer` passes, each with project context (`CLAUDE.md`, ADR-0005, ADR-0028, `docs/neutrality.md`, T-218's Decisions). The change touches relays and adjudication, so the red team is required. `pnpm verify` green, including `pnpm snap --settlement=local`.

## Out of scope

- A contract change or redeploy: the contract already settles these deals by their terms (inferred).
- Contract signers as parties through the API (`prepare/*` and core's mandate checks for ERC-1271), beyond what the view needs for case 2.
- The storage-write order in `drain` (backlog row, T-218 red-team finding 6).
- The reorg rollback (backlog row "Sepolia: reorg check").
- CPP's own logs.

## Evidence

## Decisions

- 2026-11-05, Rafa (D50): Phase 11, after T-220's deploy and before mainnet.
- 2026-11-05, Rafa: the timeout relay for a deal behind the chain moved to T-228, so a visitor with no Sepolia ETH can close such a deal before the rest of this task lands.

## Handoff
