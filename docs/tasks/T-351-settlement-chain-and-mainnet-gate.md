# T-351: The settlement chain for the mainnet test, and its gate

- **Lane:** research
- **Phase:** 2
- **Depends on:** ADR-0004 and D4 (the target chain), ADR-0018 (the beacon), ADR-0031 (the phase-one contract scope), the drand verifier review of 2026-11-11 (`docs/reviews/2026-11-11-drand-verifier-review.md`, section 8)
- **Paths this task may touch:** `docs/research/2026-11-11-settlement-chain.md` (new), one new ADR under `docs/decisions/`, new lines at the end of `docs/decisions-today.md`, this file
- **Human gate:** no for the research and the record. Yes for everything they describe: Rafa decides the chain, and only Rafa changes hard rule 1. This task deploys nothing and sends no transaction.
- **Status:** in progress
- **Agent/session:** a Claude Fable 5.2 session, started by the coordinating session on 2026-11-11
- **Change kind:** 10, research and decisions (`docs/team.md`, Change recipes). Docs only. Target: 200k tokens.

## Intent

Crow settles on Sepolia with a test token, and a deal takes about a minute there. The next step after an audit is a test on a mainnet with a small, capped amount. Two things are undecided: which chain that test runs on, and what must be true before anything is deployed there.

This task answers both as a recommendation for Rafa:

1. **A research note** that compares Ethereum mainnet, Base and the other EVM chains that pass a stated screen. For each it gives the block time, the time to a confirmation an operator can act on, the time to finality, the fee for one deal, whether the chain has the EIP-2537 precompiles the drand verifier needs, native USDC with ERC-3009, whether the audited `AuthCaptureEscrow` is already deployed there, support for contract signers, who can delay or censor a settlement, and the public RPC an operator can rely on. Every fact carries its source and its date.
2. **A decision record (Proposed)** that recommends one chain and names the runner-up, says what the choice changes in the contracts and the operators, and writes the mainnet gate as a checklist: each condition, who checks it and how.

**Non-goals:** a deploy to any chain; a transaction on any chain; a change to code, to a deployment record or to hard rule 1; a measured deal on a new testnet (it needs a deploy, which waits for Rafa).

## Context

- `docs/decisions/ADR-0004-chain-agnostic-evm.md` and D4 in `docs/decisions-today.md`: Ethereum mainnet is the target since 2026-11-01, "revisit on evidence".
- `docs/decisions/ADR-0028-demo-settles-on-sepolia.md`: how the demo settles today, and what a write waits for.
- `docs/decisions/ADR-0031-phase-one-contract-scope.md`: one token per deployment, ERC-3009 funding only, contract signers stay, the on-chain beacon proof stays "for now" and comes back with the choice of chain.
- `docs/decisions/ADR-0018-panel-seed-beacon.md` and the verifier review's gate lines G-1 to G-10.
- `contracts/lib/commerce-payments/README.md`: the escrow's deployments and audits.
- `docs/operations.md`: what a deploy needs, and the gates.

## Acceptance criteria

- [ ] The research note exists, and every number in it has a source and a date. A fact that could not be verified is marked unverified.
- [ ] The note says why each chain is in or out, by criteria stated before the comparison.
- [ ] The note says where a testnet differs from its mainnet in client or fork.
- [ ] The ADR recommends one chain and a runner-up from stated criteria that Rafa could weigh differently, and says what the choice changes in the contracts and the operators.
- [ ] The ADR's gate is a checklist: each condition, who checks it, how, and whether a capped test needs it.
- [ ] The ADR says that hard rule 1 stands until Rafa changes it, and what exactly he would change.
- [ ] One `reviewer` checks ten of the note's facts against their sources, and one `red-teamer` attacks the recommendation. The ADR answers each finding.
- [ ] New lines only in `docs/decisions-today.md`, pointing at the ADR.
- [ ] The report lists what must be measured on a testnet before the choice is final.

## Out of scope

- Non-EVM chains.
- The design of the payout and payment addresses, and the beacon's round margins on Ethereum: each has its own decision record.
- Token-issuer risk as a finding. The note states who can freeze USDC on each chain and stops there.
- Legal advice, the audit itself, key custody and real bonds: the gate names them as conditions and designs none.

## Evidence

Not filled in yet.

## Decisions

None yet.

## Handoff

In progress. The worktree is `.worktrees/t-351-chain-and-gate`, the branch `t-351-settlement-chain-and-mainnet-gate`.
