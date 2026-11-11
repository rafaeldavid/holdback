# T-340: The contract state model, the signed-field register and the threat model

- **Lane:** research
- **Phase:** 2
- **Depends on:** none. T-341 (the state oracle in the contract tests) builds on the state table this task writes.
- **Paths this task may touch:** `docs/audit/state-model.md`, `docs/audit/threat-model.md` (both new), this task file
- **Human gate:** no
- **Status:** done
- **Agent/session:** t-340-contract-state-model (Fable 5.2), change kind 10 (research and decisions) with docs: no code change, no local checks, a target of 200k tokens

## Intent

The contracts hold money, and today nobody has written down every state a deal can be in. The rules contract stores one word per deal, the bond vault stores totals, and the Commerce Payments escrow stores its own copy of "is the money held". Correctness rests on facts that live in two places or in none.

This task writes that specification, from the source, without changing it:

1. `docs/audit/state-model.md`:
   - every legal combination of a deal's stored fields, the entry point that creates it and the entry points that leave it, each cited to a line of `contracts/src` at a named commit;
   - every combination the storage can represent and no entry point should reach, with the reason it is unreachable, or a finding when it is reachable;
   - what the bond vault and the escrow hold in each state, as amounts in the deal's signed terms;
   - every deadline as a named expression over the signed terms and block time;
   - the effective outcome of a deal as one function of its state;
   - a register of every field a party signs, with the line that enforces it or the statement that none does, and a verdict for each unenforced field: enforce, remove from the signed terms, or state as an assumption.
2. `docs/audit/threat-model.md`: the actors, what each can and cannot do, the assets, and the assumptions the contracts rest on.

The model covers the whole machine as deployed. It marks each part that a phase-one scope cut removes, so each answer to a cut is a marked branch. It decides no cut.

Non-goals: no change to `contracts/`, `formal/`, `docs/audit/scope.md` or `docs/audit/known-issues.md`; no fix for any finding; no new test.

## Context

- The contracts: `contracts/src/HoldbackRules.sol`, `HoldbackBonds.sol`, `HoldbackTypes.sol`, `IHoldbackBeacon.sol`, `DrandQuicknetBeacon.sol`, `SimBeacon.sol`.
- The escrow the rules contract operates: `contracts/lib/commerce-payments/src/AuthCaptureEscrow.sol` (third-party, pinned at `6b0a5ef`).
- The settlement ADRs: ADR-0003, ADR-0007, ADR-0012, ADR-0016, ADR-0018, ADR-0019, ADR-0025, ADR-0029.
- `docs/audit/scope.md`, `docs/audit/known-issues.md`, `docs/neutrality.md`.
- The formal model: `formal/Holdback.tla`, `formal/README.md`.
- The state machine the contract mirrors: `packages/core/src/state.ts`, `packages/core/src/timing.ts`.
- The contract refinement plan, which the maintainers keep privately (`docs/private-materials.md`). It names the scope cuts SC-1 to SC-8 and the implicit-state items IS-1 to IS-14 that the two documents refer to.

## Acceptance criteria

- [x] Every row of the state table cites the line of `contracts/src` that writes it, at a named commit.
- [x] Each combination the storage can represent but no entry point should reach is listed as illegal, with why it is unreachable, or that it is reachable (a finding).
- [x] A reader can write the invariant "the deal's word is always one of these rows" from the table alone.
- [x] The holdings table gives, for each row, what the vault and the escrow hold, in terms of the deal's fields.
- [x] Every deadline is a named expression; every opposing pair of entry points is shown to agree on its boundary.
- [x] The register covers every field of every signed type, and gives a verdict for each signed field the contract does not enforce.
- [x] The threat model states the escrow's second copy of the hold, the block proposer's choice of beacon round, the vault's push payments and the lack of an address-distinctness check as explicit assumptions.
- [x] The two documents agree with `formal/`, or list where they differ.
- [x] One red-team subagent, given the contracts and not this task's reasoning, tried to find a reachable state the table calls illegal, or a legal one it omits.

## Out of scope

- Any change to the contracts, the formal model, the tests, `scope.md` or `known-issues.md`.
- Any decision on a scope cut.
- The state oracle in the tests (T-341) and the formal model's update (a later task).

## Evidence

- **The source read is the deployed source** [measured]: `git diff --quiet 64be1f1 26d4670 -- contracts/src` exits 0. The escrow is pinned at `6b0a5ef` (`git ls-tree 26d4670 contracts/lib/commerce-payments`).
- **The rules contract never reads the caller** [measured]: `grep -c "msg.sender" contracts/src/HoldbackRules.sol` prints 0.
- **The state table** [measured against each cited line; reachability inferred]: 37 legal combinations of the word and `deliveryHashOf` (L01 to L37), 16 illegal classes (I01 to I16), none reachable. One reachable state is not in the word: a funded deal whose escrow the buyer emptied after the escrow's expiry (`state-model.md` 5.2).
- **The phase-one machine** [inferred from the table and the maintainer's decisions of 2026-11-11]: 17 states (P01 to P17), with a closing reason.
- **The register** [measured at the cited lines]: every field of the 7 signed messages, and a verdict for 18 signed fields the contract does not enforce.
- **The red-team check** [measured by one `red-teamer` subagent, 157,953 tokens, 24 tool calls; it ran no test]: verdict ERRORS, meaning the table is sound and seven details were wrong. It found no reachable word the predicate rejects and no state outside L01 to L37, and it checked every `R:`, `B:` and `E:` citation in sections 1 to 6 with none off by a line. All seven corrections are in commit `d62a69a`:
  1. section 6.2 said no path pays the seller after the escrow's expiry; an overturned reject still pays it from the bond;
  2. section 3 said every exit but one moves tokens; two more move none;
  3. section 3 gave the escalation and party-appeal decisions two guards that only first-instance decisions have;
  4. a short `appealDecideSec` above zero also makes an escalation undecidable (finding F-2, raised from Info to Low);
  5. nothing bounds `appealWindowSec`, so an appeal's exit can never come due;
  6. two aggregate invariants hold only between transactions;
  7. a reject with no fee still settles after the escrow's expiry.
- **Not run:** no `forge test`, no model check, no `pnpm` command. Change kind 10 has no local checks; CI is the gate.
- **Tokens for this session:** not measured here.

## Decisions

1. **The page keeps the deployed machine and adds the phase-one machine beside it.** The brief asked for the full machine with the appeal part marked; the plan's newest version (private commit `17bdeb1`) records scope cut SC-7 as accepted and asks for the phase-one machine. Sections 2 to 7 describe today's contracts, where every citation can be checked; section 9 specifies phase one and maps each row to a deployed row. A test oracle needs the first today and the second after the cut.
2. **A row is one combination of the stored fields.** Rows that differ only in Released or Refunded share a table line and keep separate numbers, so the count matches the invariant.
3. **The register's rule for a verdict:** where the schema or core refuses a value, the contract should refuse it too, because a step the contract takes and core refuses leaves the operators' view behind the chain.
4. **The closing reason is specified by its rules, not its encoding** (`state-model.md` 9.2): a reason of six values and a decider of four. The refactor that adds it chooses the bits.
5. **CI is read from the app's pull-request status,** not from a background `gh pr checks --watch`, because this session's rules forbid polling CI with `gh`.
6. **The other session's threat-model draft** (`reports/scratch/t-338-threat-model-draft.md`) supplied the attack-class table's shape. Each row was checked against the source before it went in, and only test files that exist at `26d4670` are named. Its open-issue section on free appeals was left out, because phase one cuts appeals.

## Handoff

**Done:** `docs/audit/state-model.md` and `docs/audit/threat-model.md`, in PR #330.

**For T-341 (the state oracle):** port `legal(d, dh)` from `state-model.md` section 2 for today's contracts. Allow two things the word does not show: rows L03 to L06 may hold 0 in the escrow from the escrow's expiry, and L32 has `refundableAmount` of 0 or the fee. The aggregate invariants of 5.3 hold between transactions only. After the SC-7 cut lands, port `legalPhaseOne` from section 9.3.

**For the scope record (T-342), five open points:**
1. Finding F-1: whether the contract refuses a settlement in Held that names a delivery or releases a key (the plan's SC-5b), or core, ADR-0019 and the formal model change.
2. Finding F-2: whether the contract refuses more than `appealDecideSec = 0`. A window of 1 to about 15 seconds is schema-valid and still undecidable on Sepolia.
3. Register row 12: whether the acceptance's `bondReserved` stays checked, joins the register, or leaves the signed type.
4. Register row 18: phase one ignores `appealWindowSec` while the schema requires it; the record must say so.
5. The funding deadline: the contract refuses funding from `offerExpiresAt`; core funds an agreed deal until `fundBy` (`state-model.md` section 10).

**For the formal model's update:** `state-model.md` section 10 lists 12 differences between `formal/Holdback.tla` and the contract.

**Wrong or stale in files this task may not edit** (reported, not fixed):
- `docs/architecture.md`, the transition table: early accept needs Delivered; the contract also takes it in Held with the delivery (`HoldbackRules.sol:398-401`).
- `docs/neutrality.md`, the adjudicator rows: bonds compensate the seller on a default; the contract pays none. `known-issues.md` section 8 already records it.
- `formal/README.md`: the contract column reads TBD (known issue G-3).
- `contracts/src/HoldbackRules.sol:52`: the comment calls `t1` "decidedAt, escalatedAt or fallbackSince"; after an escalation decision it is still the escalation's time.
- `docs/audit/known-issues.md` and `docs/audit/scope.md`: no error found against the source. Both describe appeals and bonds, which phase one cuts; the package that lands SC-7 moves those rows.
- `contracts/test/invariant/RulesInvariants.t.sol`, `invariant_escrowMatchesState`: by its name it asserts the hold while funded; the buyer's own reclaim after the escrow's expiry breaks that reading. The body was not read.

**Not done:** nothing ran. The collectors, `TokenStore.sol` and Solady's signature library were not read in full; the red team did not check sections 7 to 11 of the state model.

**To resume:** both pages cite `contracts/src` at `26d4670`. The contract clean-up (T-334) moves lines; a later edit should re-cite at the frozen commit.
