# T-349: the EVM path has no party appeals and no bonds (cut SC-7, package R6 part 2)

- **Lane:** settlement (off-chain mirrors)
- **Phase:** 2
- **Depends on:** T-346 (the contract cut and core's mirror, branch `t-346-cut-appeals-and-bonds`); ADR-0031 section 8; D57
- **Paths this task may touch:** `packages/settlement/evm/` (with `abis.json`); `apps/operator/`; `apps/adjudicator/` (the appeal role and the acceptance's `bondReserved` only); `apps/demo-cloud/`; `apps/test-agents/`; `examples/e2e-*`; the demo's scenario files; SimChain-only list entries in `packages/testkit/src/runner.ts` that T-346 did not make; this task file. Never `contracts/`, `packages/core/src/` beyond what T-346 hands over, `site/`, `docs/api.md` or other docs, `spec/schemas/`
- **Human gate:** no for the branch. The freeze, the merge to `main` and every deploy are Rafa's
- **Status:** in progress
- **Agent/session:** implementer session, change kind 5 (settlement and judgment code): the packages' tests with anvil, one reviewer before it lands, a target of 250k tokens

## Intent

In my own words: after T-346 the phase-one contracts have no `fileAppeal`, no `expireAppeal`, no bond vault, and they refuse an acceptance whose `bondReserved` is not 0. Every off-chain piece that drives or reads those contracts must agree, or the operators would relay calls the chain cannot take and agents would get reverts they cannot read.

- **The EVM adapter** stops deploying, reading and calling the vault, has no appeal entry point, and no longer reads the removed events or `dealOf`'s removed fields. An appeal sent to it is refused before any transaction, with a problem that names phase one. A first decision is final at once (ADR-0031 §8 point 7): `appealState` reads `none` and `finalAt` is the decision's time.
- **The operator** keeps its appeal routes for SimChain and refuses them on EVM with the same named reason. Its rule that refuses terms whose fallback's free bond cannot cover the price leaves the EVM path (ADR-0031 §8 point 6); `observed.bond` reads `none` there.
- **The reference adjudicator** signs `bondReserved` 0 on EVM, expires no appeals there, and checks no bond cover for a fallback turn. The appeal adjudicator still decides escalations.
- **The demo world, the test agents, the e2e scenarios and the demo's appeal beat** deploy no vault, post no bond, and run no party appeal on EVM.

Inputs: T-346's branch with the cut; ADR-0031 sections 8 and 10; the contract refinement plan's package R6 (crow-private).

Outputs: the off-chain code above; a test that an appeal to an EVM world is refused with a named reason; a local-chain run of release, refund, reclaim, default, early accept, mutual settlement and an escalation with `bondReserved` 0; the SimChain appeal fixtures still passing, on the SimChain-only list.

Non-goals: no change to SimChain, which keeps appeals and bonds as the full protocol's reference; no contract, schema or signed-type change; no docs edit (the sentences go into the Handoff for a later docs package); no deploy.

## Context

- ADR-0031 §8 (SC-7 and its settled points), §10 (events); D57.
- The contract refinement plan (crow-private `roadmap/plans/2026-11-11-contract-refinement.md`), section 2 (SC-7) and package R6.
- T-346's task file and Handoff on `t-346-cut-appeals-and-bonds`.

## Acceptance criteria

- [ ] The task file is the branch's first commit.
- [ ] No code on the EVM path calls the vault, `fileAppeal` or `expireAppeal`, or reads `AppealFiled`, `AppealClosed` or a vault event; `abis.json` matches the cut contracts (`abis.test.ts` passes).
- [ ] An appeal sent to an EVM world is refused before any transaction, with a problem that names phase one; a test shows it.
- [ ] On the local chain, a deal with `bondReserved` 0 runs release, refund, reclaim, default, early accept, mutual settlement and an escalation.
- [ ] The operator's unbonded-fallback refusal is off on EVM and kept on SimChain, each with a test.
- [ ] The reference adjudicator signs `bondReserved` 0 on EVM and the price on SimChain.
- [ ] The SimChain appeal fixtures still pass and are on the SimChain-only list; no neutrality fixture that applies to phase one is lost.
- [ ] Every CI job passes on T-346's branch with this change merged in, both anvil jobs included.

## Out of scope

- `contracts/`, `packages/core/src/` (T-346).
- `site/llms.txt`, `docs/api.md`, `docs/neutrality.md`, `docs/architecture.md`: the sentences are listed in the Handoff.
- Any deploy, any live Sepolia transaction.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

## Handoff

What is done, what is not, how to resume, and the open questions that remain.
