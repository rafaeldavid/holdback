# T-351: The settlement chain for the mainnet test, and its gate

- **Lane:** research
- **Phase:** 2
- **Depends on:** ADR-0004 and D4 (the target chain), ADR-0018 (the beacon), ADR-0031 (the phase-one contract scope), ADR-0032 (the beacon rounds), the drand verifier review of 2026-11-11 (`docs/reviews/2026-11-11-drand-verifier-review.md`, section 8)
- **Paths this task may touch:** `docs/research/2026-11-11-settlement-chain.md` (new), one new ADR under `docs/decisions/`, new lines at the end of `docs/decisions-today.md`, this file
- **Human gate:** no for the research and the record. Yes for everything they describe: Rafa decides the chain, and only Rafa changes hard rule 1. This task deploys nothing and sends no transaction.
- **Status:** done (PR 359, merged 2026-11-11 at `69d9b4d`)
- **Agent/session:** a Claude Fable 5.2 session, started by the coordinating session on 2026-11-11
- **Change kind:** 10, research and decisions (`docs/team.md`, Change recipes). Docs only. Target: 200k tokens.

## Intent

Crow settles on Sepolia with a test token, and a deal takes about a minute there. The next step after an audit is a test on a mainnet with a small, capped amount. Two things were open when this task started: which chain that test runs on, and what must be true before anything is deployed there.

**The task changed shape on 2026-11-11, while it ran.** Rafa decided the first question: "Assume Ethereum Mainnet first, we will deploy on L2 after we figure out it works on the primary industry standard." He also said of the cap, the capped test's conditions and the rule change: "We can deal with this later, as we need to first finalize all the testnet work and align the entire product components to the new contract set." So the task produces:

1. **A research note** with two halves: what the test requires and costs on Ethereum mainnet, and which L2 follows once mainnet works. For each chain it gives the block time, the confirmation an operator can act on, finality, the fee for one deal, whether the drand verifier's precompiles are live, native USDC with ERC-3009, whether the audited `AuthCaptureEscrow` is there, support for contract signers, who can delay or censor a settlement, and the public RPC. Every fact carries its source and its date.
2. **A decision record (Proposed)** that records Rafa's order, says what Ethereum mainnet requires and costs, writes the mainnet gate as a checklist, and recommends an L2 and a runner-up for the later step. The cap, the conditions a capped test needs and the change to hard rule 1 are open points for later, each with a recommendation.

**Non-goals:** a deploy to any chain; a transaction on any chain; a change to code, to a deployment record or to hard rule 1; a measured deal on a new testnet (it needs a deploy, which waits for Rafa); any question put to Rafa now.

## Context

- `docs/decisions/ADR-0004-chain-agnostic-evm.md` and D4 in `docs/decisions-today.md`: Ethereum mainnet is the target since 2026-11-01, "revisit on evidence".
- `docs/decisions/ADR-0028-demo-settles-on-sepolia.md`: how the demo settles today, and what a write waits for.
- `docs/decisions/ADR-0031-phase-one-contract-scope.md`: one token per deployment, ERC-3009 funding only, contract signers stay, the on-chain beacon proof stays "for now" and comes back with the choice of chain.
- `docs/decisions/ADR-0032-beacon-rounds-escalation-and-fallback.md`: the margin of 29 s, Rafa's order of the chains, and gate lines BR-1 to BR-10.
- `docs/decisions/ADR-0018-panel-seed-beacon.md` and the verifier review's gate lines G-1 to G-10.
- `contracts/lib/commerce-payments/README.md`: the escrow's deployments and audits.
- `docs/operations.md`: what a deploy needs, and the gates.

## Acceptance criteria

- [x] The research note exists, and every number in it has a source and a date. A fact that could not be verified is marked unverified.
- [x] The note says why each chain is in or out, by criteria stated before the comparison.
- [x] The note says where a testnet differs from its mainnet in client or fork.
- [x] The ADR records Ethereum mainnet as the chain of the test, in Rafa's words, and says what that requires and costs. **Amended from "recommends one chain and a runner-up":** Rafa decided the chain while the task ran. The recommendation and runner-up, from criteria he could weigh differently, are now for the L2 step (ADR-0034 section 9, with a weighting table in 9.3).
- [x] The ADR says what the choice changes in the contracts and the operators, for Ethereum mainnet and for a move to Base.
- [x] The ADR's gate is a checklist: each condition, who checks it, how, and a recommendation on whether a capped test needs it.
- [x] The ADR says that hard rule 1 stands until Rafa changes it, and what exactly he would change.
- [x] One `reviewer` checked ten of the note's facts against their sources, and one `red-teamer` attacked the record. The ADR answers each finding (its section 13).
- [x] New lines only in `docs/decisions-today.md` (D61), pointing at the ADR.
- [x] The note lists what must be measured before each step (its section 12).

## Out of scope

- Non-EVM chains.
- The design of the payout and payment addresses, and the beacon's round margins on Ethereum: each has its own decision record.
- Token-issuer risk as a finding. The note states who can freeze USDC on each chain and stops there.
- Legal advice, the audit itself, key custody and real bonds: the gate names them as conditions and designs none.

## Evidence

All on 2026-11-11. No transaction was sent and nothing was deployed.

- **Commands run and results** [measured]:
  - `forge test --root contracts --match-contract GasPerDeal --isolate -vv` at `ac2d2b6`: 9 tests pass; `agreeAndFund` 233,994 gas, `deliver` 83,535 gas, `decide` 130,631 gas; three steps 448,160 gas. The reviewer's own run gave the same.
  - The Sepolia beacon's runtime code, passed as a state override to `eth_call` with drand round 1000's signature, returns `0xfe290bec…30e54fdd` on Ethereum mainnet, Base, Base Sepolia, Arbitrum One, OP Mainnet, Unichain, Monad, Linea and Arc. It reverts with `InvalidSignature` on Polygon PoS (two endpoints) and Avalanche C-Chain. `eth_estimateGas` for the same call: 219,232 gas on Ethereum mainnet and on Base.
  - `eth_getCode` at the escrow's two published addresses: code on Base and Base Sepolia, none on Ethereum mainnet, Arbitrum One, OP Mainnet or Monad. Sourcify reports an exact match for `0xf968…b19c` on Base, and `diff` of its verified `AuthCaptureEscrow.sol` and `TokenStore.sol` against the vendored files prints nothing.
  - An `eth_call` on Ethereum mainnet to the deterministic deployer, with the input of Coinbase's creation transaction on Base, returns the same escrow address; `eth_estimateGas` reads 2,632,491 gas. The red team found this first.
  - `eth_gasPrice` on Ethereum at block 26,394,228: 0.2304 gwei. `eth_feeHistory` over five windows of 1,024 blocks: medians 0.129 to 0.231 gwei, maximum 2.570 gwei. Base's base fee: 0.005 gwei in four windows. ETH at USD 2,079.59 (Coinbase spot).
  - Base blocks 56,201,869 to 56,201,880: five blocks share each second. Base blocks 47,806,604 to 47,806,609: timestamps of 15:49:15 to 15:49:25 UTC on 2026-06-25, inside the halt the post-mortem reports.
- **Published sources** [documented]: seven `web-fetch` subagents read the pages listed in the note's section 13. Where one read a page as a summary, the note says so.
- **The reviewer** [measured by it]: nine of its ten facts confirmed; one wrong, the fallback deal's gas (698,528 gas, not 562,648), corrected. Eleven smaller errors, all fixed. ADR-0034 section 13.1.
- **The red team:** 0 Critical, 6 High, 9 Medium, 8 Low, 2 Info. Each is answered in ADR-0034 section 13.2; five became gate lines MG-35 to MG-39. Its exploit paths for the pending accept, the direct funding above the cap and Base's two clocks are inferred from the source and the specifications, not run.
- **Snapshot diffs:** none. Docs only.
- **Metrics:** about 2.0 million subagent tokens across nine subagents (seven lookups, the reviewer, the red team) [measured from their reports], against a target of 200k tokens for the change. The lookups of thirteen chains and the two reviews account for the overrun.

## Decisions

1. **The record follows Rafa's order and does not rank Ethereum against an L2.** It ranks the L2s for the later step.
2. **ADR-0034 and D61,** leaving ADR-0033 and D60 to T-350, which was writing at the same time.
3. **The escrow on Ethereum mainnet is a replay of Coinbase's two creation transactions,** not a build of Crow's. The red team's finding, re-measured here, replaced the first draft's "Crow deploys its own copy".
4. **The L2 recommendation is Base, with Arbitrum One as the runner-up.** Monad is named as not evaluated in full, set aside by the word L2 in Rafa's order.
5. **The cap, the capped test's conditions, the rule change and the Base Sepolia deployment are open points** with recommendations (ADR-0034 section 8). Nothing was asked of Rafa.

## Handoff

**Done:** the note, ADR-0034 (Proposed) and D61, reviewed and red-teamed. PR 359 merged on 2026-11-11 after CI passed (`check`, `gitleaks`, CodeQL; the code jobs skip a docs-only change) [measured: `gh pr checks 359`].

**Not done, and owed by later work:**

- **A second read of the gate by a model of another family.** The reviewer recommends it because the gate governs settlement with real money. This session has no such model.
- **Every measurement in the note's section 12.** The read-only ones (the verifier's full vector set on each mainnet client; a fork test of every outcome against real USDC; a fork test of the rules contract against Coinbase's escrow on Base) need no go-ahead. The others need a testnet deploy or transaction, which is Rafa's.
- **The open points O-1 to O-8** in ADR-0034 section 8. They wait until the testnet work is aligned to the new contract set, by Rafa's word.

**Follow-ups outside this task's paths** (for triage; none is started):

- `contracts/README.md` should say that `0xBdEA…0cff`, the only escrow address in the vendored README and in the vendored project's own instructions file, is version 1.0.0 with the older fee interface, and that 1.1.0 is at `0xf968…b19c`.
- `packages/core/src/chains.ts` lists 21 mainnet chain IDs and lacks Monad (143) and others the note screened (red team L-7). The operator's allowlist still refuses them.
- ADR-0018's gas figure for a proof is out of date: 219,232 gas for a `beaconValue` transaction on mainnet's fork today.
- The agent docs could tell a party to let a signed settlement offer expire before a decision is due (red team L-8).
- `docs/neutrality.md` gets the sequencer as a control point only when an L2 is chosen (MG-34).

**How to resume:** read ADR-0034's section 8 for the open points and section 13 for what the reviews found. The worktree is `.worktrees/t-351-chain-and-gate`, the branch `t-351-settlement-chain-and-mainnet-gate`.
