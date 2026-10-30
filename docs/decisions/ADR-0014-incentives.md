# ADR-0014: Incentives for adjudicators, capital and commitment design

- **Status:** Proposed
- **Date:** 2026-10-30
- **Raised by:** Rafa, in chat on October 30, 2026, after the Phase 0 adversarial review. No task file yet. It shapes T-306 (fee quotes, Phase 3) and Phase 4 (adjudicator economics) in `docs/plan.md`.

## Context

Rafa proposed three incentive principles:

1. The better the adjudicator, the more it is rewarded.
2. The more capital at risk behind an adjudicator, the more the capital owner is rewarded.
3. Commitments, and the parties behind them, that are likely to need the adjudicator should pay for it.

The current design covers part of this:

- The fee is expected loss plus a capital charge plus model cost (`docs/judgment-and-defenses.md`, Fee pricing). A more accurate adjudicator quotes less and wins volume. There is no other reward for quality.
- The error rates in that formula come from the adjudicator's own calibration runs and from appeal outcomes. Appeals sample only disputed cases. Both sources can be gamed.
- The capital charge pays for bond, but the design assumes the adjudicator posts its own bond. ADR-0007 now requires bond equal to price for every guaranteed commitment open to appeal, so capital is the main constraint on an adjudicator's volume.
- The quote endpoint takes draft terms, so a fee can already depend on the terms.
- A commitment binds which models judge (`registryHash`) and under which prompt and rules (`policyHash`), but not proof that the named model answered (ADR-0006, residual 8).

Constraints. ADR-0001 forbids any single party from controlling settlement, so incentives cannot rest on a reputation score or registry that one party keeps. ADR-0007's 100% coverage in guaranteed mode stays, because lowering it for "good" adjudicators reopens the self-dealing finding.

## Decision

### 1. Reward quality through public, recomputable measurement

- Every quality signal is computed from public settlement events and signed judgment records, so anyone can recompute it and no one owns it. The signals are:
  - overturn rate on appeal;
  - escalation rate;
  - missed deadlines that triggered fallback or default;
  - audit results (below).
- **Audit sampling.** A rulebook may opt in to audits. After `appealDecideBy`, a commit-reveal seed selects a share of an adjudicator's settled commitments (rulebook parameter, default 2%). A different adjudicator, drawn from the rulebook's audit set, rejudges each one under its own bound policy. Results are signed and published as events, and they move no funds. The auditor is paid from a slice of the fee (rulebook parameter). Audits give error estimates on real traffic that the audited adjudicator does not control.
- Self-run calibration reports stay, labeled self-reported.
- Adjudicators set their own fees. The fee formula is a floor that covers expected loss and capital cost, not a cap, so an adjudicator with a strong public record can charge a margin above it.
- The reward is that margin, plus volume, plus cheaper capital (section 2). Coverage ratios do not depend on quality.

### 2. Reward capital through bond backers with first loss on the adjudicator

- **New role: backer.** A backer deposits into an adjudicator's bond pool and earns that pool's capital charge pro rata. A backer is any address. Backers have no say in decisions.
- **First loss.** The adjudicator's own stake absorbs overturn and default payouts before backers' stakes. It must be at least a rulebook share of the pool (default 10%). An adjudicator cannot judge on other people's capital alone.
- **Encumbrance.** Stake backing a commitment stays locked until that commitment passes `appealDecideBy`. Unencumbered stake can be withdrawn after a notice period (rulebook parameter). Withdrawing stake reduces the volume an adjudicator can take on next. It cannot affect any commitment already open.
- **Pricing.** Each adjudicator publishes its capital charge rate in its policy, so it is bound by `policyHash`. Backers choose where to deposit, so cheaper capital flows to adjudicators with better public records. This is how principle 2 reinforces principle 1.

### 3. Price commitments by how checkable they are; penalize bad faith, not use

- **Checkability pricing.** The fee depends on how much judgment the terms need:
  - Terms that deterministic checks fully decide (empty rubric) pay only `minFee`, because no panel runs.
  - Above that, the fee scales with the adjudicator's estimate of panel use and appeal probability. The estimate comes from features of the terms (number of required deterministic checks, rubric size, sealed checks, deliverable size and type) and the adjudicator's own history for that category.
- **SDK terms lint.** The SDK warns when terms have no required deterministic checks or a rubric criterion with no evidence anchor, and shows the quote difference. This is tooling, one of the ways ADR-0007 allows Holdback to earn.
- **Bad faith pays, use does not.** A party is never charged more for calling the adjudicator a commitment names. The penalties are:
  - an appeal that fails forfeits the appeal bond (already in ADR-0007);
  - a delivery that fails a required deterministic check forfeits a per-attempt fee to the adjudicator. The rulebook sets it, and it is quoted at agreement.
- **Optimistic release (ADR-0015).** In `optimistic` mode adjudication is paid only when the buyer disputes, which applies this principle at the level of the settlement mode.
- **No shared party reputation.** Each adjudicator may price a party's history from its own records and must say so in its policy. No shared score exists.

### 4. Attestation as a priced option

- When provider-signed responses or attested confidential compute become available, a policy may declare `attested` judges. A rulebook may then require them. Until then, quality signals rest on disclosed model identity (residual 8).

## Alternatives considered

- **Keep cost-plus pricing only.** Simplest. There is no reward for quality beyond volume, and error rates stay self-reported. This fails principle 1.
- **A protocol reputation registry or score kept by Holdback or a committee.** Easy for parties to read. The keeper could raise or sink any adjudicator, which is a control point ADR-0001 forbids.
- **Lower coverage ratios for high-quality adjudicators.** This rewards quality with capital efficiency, but it reopens the self-dealing finding: a record built on small cases funds one large self-dealt case.
- **Backers with no first loss on the adjudicator.** This attracts more capital, but the adjudicator bears none of its own errors.
- **Penalize parties who invoke adjudication, or keep a shared user reputation.** That charges for the product's core service, and a shared score needs a keeper.
- **A protocol token to reward adjudicators.** Out of scope: no real money in the prototype (CLAUDE.md), with regulatory weight beyond it.

## Consequences

- **New custody.** Backer stakes are held funds. They live in the rules contract's bond escrow, under the same no-admin rules and invariants: conservation, no negative balances, encumbered stake never counted twice, and first loss applied before backer loss. That adds to the audit surface ADR-0003 already assigns to Holdback.
- **Schema changes,** each through this ADR and a version bump when built:
  - backer deposits and withdrawals, plus per-adjudicator pool composition;
  - audit events;
  - capital charge rate and party-history pricing in `adjudicator.policy`;
  - the per-attempt fee in the rulebook.
- **Audits widen plaintext access** (residual 6): an auditor sees the deliverable. That is why audits are opt-in per rulebook.
- **Concentration.** Parties may converge on a few adjudicators with the best records, and backers on the same pools. This does not affect panel family diversity, which is per commitment, but it concentrates liveness risk. Fallback adjudicators and defaults still bound it.
- **Phase impact.** Nothing in the Phase 1 demo changes:
  - T-306 implements checkability pricing and the quote breakdown;
  - Phase 4 implements backers, first loss, encumbrance and audit sampling;
  - the SDK terms lint lands with T-007 or later.
- **Open questions:**
  - default audit share and auditor pay;
  - the first-loss share;
  - the notice period;
  - whether auditors are themselves audited.

## Litmus tests

- **Neutrality.** Every quality signal is recomputed from public events, so no keeper exists. Backers can only add or withdraw unencumbered stake, never alter a decision or an open commitment. Audit selection uses commit-reveal, so neither the audited adjudicator nor the parties choose which cases are audited. Holdback earns from tooling or as one adjudicator, never from scoring.
- **The hold.** Backer stake is a new class of held funds, under the same rules: no admin keys, permissionless timeouts, settle-once and encumbrance until `appealDecideBy`. The buyer's funds are unaffected.
- **Defended judgment.** Audits add an error measurement on real traffic that the adjudicator does not control. Measurement still rests on disclosed, not proven, model identity until attestation exists. Pricing by checkability pushes parties toward deterministic checks, the strongest tier of acceptance.
