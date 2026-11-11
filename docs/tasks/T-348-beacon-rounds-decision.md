# T-348: the decision record for the beacon rounds (escalation and fallback)

- **Lane:** research (change kind 10, research and decisions)
- **Phase:** 2
- **Depends on:** T-343 (the drand verifier's review, finding X-1), T-342 (ADR-0031, the phase-one scope), T-340 (the state model, finding F-2)
- **Paths this task may touch:** one new ADR under `docs/decisions/`; new lines in `docs/decisions-today.md`; this file
- **Human gate:** no
- **Status:** done
- **Agent/session:** a Claude Fable 5.2 session started by the coordinator, 2026-11-11

## Intent

The contract refinement plan (kept privately, `docs/private-materials.md`) fixes finding X-1 in its package R8 and asks for a decision record first. X-1 is the Medium finding of the drand verifier's review (`docs/reviews/2026-11-11-drand-verifier-review.md`, §10): the panel for an escalation takes its seed from the first drand round after the escalation's block time, and drand publishes that round 1 s after a mainnet block's timestamp. Whoever lands the escalation in a block built that late can know the panel's seed first.

This task writes that record. It decides three things together, because each moves the others:

1. which drand round seeds the panel for an escalation;
2. which round seeds the fallback adjudicator's panel (item 1 of the private hardening task T-225);
3. the smallest escalation window that can be decided, and how a shorter window is handled under D31 (the protocol does not restrict values the parties can set).

The output is one ADR with status Proposed and one D-number entry that points at it. The task changes no code, no schema and no audit doc. It does not choose the chain Crow settles on: where the rule depends on the chain, the ADR gives it per chain.

## Context

- `docs/reviews/2026-11-11-drand-verifier-review.md`: finding X-1 and the mainnet-gate lines G-1 to G-10.
- `contracts/src/HoldbackRules.sol:250-300` at `b58bb69`: the round selection in `decide`.
- `contracts/test/crosscheck/DrandRedTeam.t.sol:642-711`: the three tests named `test_issue_wrongRound_…`.
- ADR-0018 (the panel seed beacon), ADR-0006 (defended judgment), ADR-0031 (the phase-one scope).
- `docs/audit/state-model.md` (finding F-2, section 6.3) and `docs/audit/threat-model.md` (assumption TA-2).
- `docs/tasks/T-217-drand-proofs-sepolia.md`.

## Acceptance criteria

- [x] The ADR names the rule the contract enforces in package R8, exactly enough that an implementer can write it, and says how each of the three `test_issue_wrongRound_…` tests changes so that it fails before the fix and passes after.
- [x] It compares the chosen rule with at least two alternatives, and states for each what an attacker who controls transaction timing, or a block builder, can still do.
- [x] It settles the fallback's round.
- [x] It states the smallest decidable escalation window as a formula over the margin, the block time and the beacon's period, with the number for Sepolia and for Ethereum mainnet, and adds no refusal.
- [x] Every number names its source: drand's published chain info, the consensus specifications, or measured block headers. A claim whose source could not be read is marked unverified.
- [x] It says what stays possible for a block builder and why that is accepted or not, lists what a testnet cannot show, and gives the lines the mainnet gate needs.
- [x] One `red-teamer` pass attacks the chosen rule without this task's reasoning; the ADR answers each finding.
- [x] `docs/decisions-today.md` gains one entry with the next D-number.

## Out of scope

- Any change to `contracts/`, `formal/`, `docs/audit/`, `spec/` or `packages/`.
- The choice of chain.
- The other items of T-225 (relay outages, answer size, SimChain with a drand club).

## Evidence

- **The output:** `docs/decisions/ADR-0032-beacon-rounds-escalation-and-fallback.md` (Proposed) and D59 in `docs/decisions-today.md`. Pull request 345 merged into `main` on 2026-11-11 at 21:07 UTC as `e1d12ae` [measured: `gh pr view 345`].
- **CI on pull request 345:** `check`, `gitleaks`, `changes`, CodeQL and both code-analysis jobs passed; the five test jobs were skipped, as CI does for a change that touches docs only [measured: `gh pr checks 345`]. GitHub Actions was down for about 30 minutes before the run started.
- **drand quicknet's genesis (1,692,803,367 s) and period (3 s)** [measured: `curl` of `/info` on `api.drand.sh` and `drand.cloudflare.com`, 2026-11-11; both returned the same JSON].
- **Block times against drand's genesis: 2 mod 3 on mainnet, 0 mod 3 on Sepolia** [measured: `eth_getBlockByNumber` on three headers of each chain through `ethereum-rpc.publicnode.com` and `ethereum-sepolia-rpc.publicnode.com`; inferred for every slot from the two genesis times].
- **Slot time, block timestamps, voting deadlines, the late-block rule, the forks** [documented: `ethereum/consensus-specs` (`configs/mainnet.yaml`, `specs/bellatrix/beacon-chain.md`, `specs/phase0/validator.md`, `specs/phase0/fork-choice.md`), `eth-clients/mainnet` and `eth-clients/sepolia`, EIP-7773 and EIP-7732; read by three `web-fetch` subagents, quotes in the ADR's section 2].
- **Every round, delay, window and stake figure in the ADR** [measured: one `python3` script in this session; the red team recomputed them with its own script and by brute force over an hour of slots].
- **Two round signatures for package R8's tests** [measured: both relays returned the same bytes for rounds 32,398,889 and 32,456,489].
- **The red-team pass** [one `red-teamer` subagent, 2026-11-11]: no Critical or High; 1 Medium, 6 Low, 6 Info. Each is answered in the ADR's section 12. Its attack list is at `reports/scratch/t348-redteam/attack-list.md` in the main checkout (not in the repository).
- **Not run:** no test, no `pnpm` or `forge` command. The change is docs only; CI is the gate.
- **Tokens:** 490k for the four subagents [measured: their usage lines; the red team used 270k of it], and about 400k for this session itself [guessed], against a target of 200k.

## Decisions

- **One rule for both panels, `roundAt(lastChoice + BEACON_MARGIN) + 1`,** in place of the review's `roundAt(t) + k` and T-225's `roundAt(judgeBy − 1) + 1`. A margin in seconds matches the unit of the threat, and a margin of 0 keeps every simulated round.
- **The fallback gets the margin too.** T-225 proposed none. Without it a block built 1 to 3 s late, just before `judgeBy`, sees the fallback's round.
- **29 s, two and a half slots, on mainnet and Sepolia.** The number of slots is Rafa's call; the ADR's section 4 gives one and three beside it.
- **The margin is an immutable of the rules contract,** not a term of the deal and not a rulebook field: no signed type and no schema file changes.
- **Ethereum mainnet is named as the chain of the mainnet test,** on Rafa's words of 2026-11-11 as the coordinating session relayed them. The task itself chose no chain.

## Handoff

- **Done:** the ADR, D59, the red-team pass and its answers, merged in pull request 345. Nothing is left in this task.
- **For package R8** (the contract lane): the ADR's sections 3.1 to 3.6 are the specification, and section 10 gives its two conditions (after SC-5 and after the cut of party appeals, or with them). The adjudicator service's `roundFor` changes with the contract and core.
- **For the coordinator:**
  - Add gate lines BR-1 to BR-10 (the ADR's section 9) to the plan's mainnet gate, beside the review's G-1 to G-10. BR-10 needs transactions on Sepolia and waits for Rafa.
  - Confirm the package order of section 10, and who plans the cutover of deals open on the old deployment.
  - Follow-ups outside this task's paths: the reference adjudicator's short expiry on an escalation (BR-8); the audit docs (`state-model.md` section 6.3 and F-2, `threat-model.md` TA-2, `known-issues.md`); ADR-0018's pointer; `site/llms.txt`. Each lands when R8 lands.
- **Waits on Rafa:** whether two slots of margin stand (ADR-0032, section 4); the redeploy; BR-6's measurement before a mainnet deploy.
- **Open questions:** Gloas's rules for a late payload were not read (BR-2 re-derives the margin on the deploy day); the share of empty mainnet slots has no source here.
