# Outsider usability test, 2026-10-31

Two agents with no project context tried to use Holdback from the repository alone, starting at `README.md`. They were barred from internal docs (tasks, decisions, reviews, backlog, `CLAUDE.md`, `.claude/`) and from the demo's source, and could not change product code.

| Tester | Model | Task |
| --- | --- | --- |
| Buyer | Sonnet | Buy a cleaned 9,500-row CSV for 2,000 tUSD from an untrusted seller; then try bad data |
| Seller | Opus | Sell an 800 tUSD legal translation to unknown buyers; then try disputes and offline judges |

Their programs ran in throwaway worktrees and were not kept.

## Results (measured by the testers)

| | Buyer | Seller |
| --- | --- | --- |
| Happy path settled | Yes, ~9.5 min after starting cold | Yes, ~8.5 min after starting cold |
| Time spent | Almost all reading source | Read ~1,500 lines of source |
| Bad data refunded | Yes: too few rows, and null emails; no key to the buyer | — |
| Buyer could read the work before paying | — | No, on every public route tried |
| Buyer could reclaim after delivery | — | No (`reclaim is not allowed in Delivered`) |
| Frivolous buyer appeal | — | Upheld the accept; buyer lost 65 (bond + fee) |
| Wrongful reject, seller appeals | — | Overturned; seller paid 800 from the primary's bond |
| Primary offline | — | Fallback took over and paid the seller |
| All adjudicators offline after delivery | — | Buyer refunded; seller got 10% from the bonds |
| Censoring operator | — | SDK failed over to the second node; deal completed |

Verdict, in the seller's words: it would trust the mechanism but would not use the product today.

## What blocks a newcomer (both testers, worst first)

1. **No way in.** README "Start" is the team's own workflow (decide D1/D2/D6, paste a kickoff prompt). No package has a README.
2. **The SDK example in `docs/api.md` doesn't match the SDK.** `signer`, `agreeAndFund`, `deliver(file)` and `held.id` don't exist.
3. **The SDK is low-level.** Every party message is built and signed by hand (five EIP-712 messages); the seller encrypts, uploads and wraps a key per recipient. The only working recipe was a unit test and the test-only `Deal` helper.
4. **Not consumable from outside.** Packages are private, resolve to `dist/`, and `pnpm build` is never mentioned.
5. **Nothing moves without an adjudicator, and running one isn't documented.** Testers assembled the service, adapter, store, policy and registry from source and faked part of the registration.
6. **Setup comes from test helpers:** keys from public strings, genesis balances, a hidden test rulebook that sets the economics (appeal bond, fee, 10% default compensation).
7. **The operator can't be started**, so the REST API can't be tried.
8. **Terms require too much:** three adjudicators, policy and registry hashes, a rubric even for checks-only deals.
9. **Errors that read wrong:** `seed_mismatch … waiting` means "retry shortly"; an appeal without funds gives no bond amount.
10. **Surprises not stated where they bite:** the fee is kept on a refund (buyer gets 2,000 of 2,050); a `key.released` event right after delivery is the adjudicator's key, not the buyer's; fake-judge records look like real model output; tUSD decimals are never stated; `apply_default` is missing from the trigger table.
11. **Docs are about building Holdback, not using it.**

## Protocol findings worth a decision (not usability)

| Finding | Status |
| --- | --- |
| After a wrongful reject is overturned, the buyer keeps its refund **and** gets the work; the seller is paid from the primary's bond | Consistent with guaranteed mode (the bond pays the wronged party), but surprising; document it, and consider whether the key should follow (backlog) |
| If every adjudicator vanishes after delivery, the seller gets 10% | A rulebook default; becomes a negotiated clause under D29 |
| The adjudicator sees the plaintext and could leak it | Known residual 6 (`todo.adjudicator-leaks-plaintext`) |
| Before payment the buyer's key is held by SimChain; on a public chain this needs the time-lock design | Known, ADR-0020, Phase 2 |
| Deterministic checks only fit datasets; a translation relies entirely on the rubric | New: text checks (backlog) |

## What follows

- **T-020, developer surface:** a high-level agent SDK, an `examples/` folder in the workspace, a runnable operator and test adjudicator, a real quickstart, and the doc fixes above.
- **T-021, agent simulation:** an MCP tool surface over the T-020 SDK and a runner that drives model agents of different sizes (and, with Rafa's keys, families) through the protocol.
- Protocol findings: backlog rows.
