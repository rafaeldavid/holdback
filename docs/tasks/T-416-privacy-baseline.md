# T-416: The privacy baseline before design partners

- **Lane:** privacy (roadmap row N30, "Privacy baseline before design partners")
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 2 (process docs and records), with one line of kind 1 (`site/ref/limits.txt`) where a stated limit is wrong
- **Depends on:** the live rehearsal of 2026-11-13 (T-399), whose deals are the sample
- **Paths this task may touch:** this file; one new file, `docs/privacy-baseline.md`; `site/ref/limits.txt`, only a line that the measurements show is wrong; scratch under `reports/scratch/t-416/` (not committed)
- **Human gate:** no. Plain GETs of the live operators and a public Sepolia RPC only; no deal is created and nothing on the live service changes.
- **Status:** review
- **Agent/session:** the T-416 session, 2026-11-14, branch `t-416-privacy-baseline`

## Intent

Design partners are about to run their first real deals on Crow, each delivered as an encrypted report. Before they start, each needs to know what a stranger with no key and no credential learns from one deal. This task measures that on deals that already exist, the rehearsal's, through the chain and through the two operators' public reads, for each disclosure level the live service offers. It writes the answer as one document: what each observer learns, the choices a party has today to disclose less, the leaks no choice closes with the smallest fix for each, and five plain lines for the partner. Where `site/ref/limits.txt` promises more than the measurements show, the task corrects that line and nothing else in the guides.

Non-goals: no fix to the operators, the adjudicators, the contracts or the templates (each leak names its lane); no new deal; no edit to `CLAUDE.md`.

## Acceptance criteria

- [x] Every row of the baseline is checked against a real rehearsal deal, or marked inferred where no deal exists to read.
- [x] One table per disclosure level the live service offers, with a column per observer, each cell labelled measured or inferred.
- [x] The choices a party has today to disclose less, and what each costs.
- [x] The leaks no choice closes today, most serious first, each with the smallest change that closes it and its lane.
- [x] Five plain lines for a design partner before its first deal.
- [x] `site/ref/limits.txt` compared with the measurements; a wrong line corrected and named here.
- [x] One reviewer pass and one red-team pass, with their findings fixed or recorded.

## Evidence

All measured on 2026-11-14 between 08:30 and 09:10 UTC, unless labelled otherwise.

- **Sources:** `https://api.crow.direct` and `https://api2.crow.direct` (schema 0.11), every public GET route of `GET /v1/openapi.json` for eight rehearsal deals (`docs/tasks/T-399-pilot-rehearsal-live.md`), and the public Sepolia RPC `https://ethereum-sepolia-rpc.publicnode.com` for case 8's three transactions and the token's Transfer logs. Both operators served byte-identical answers for all eight deals (measured, sizes per route compared).
- **The live service holds 29 deals, all at `disclosure.level: "public"`** (measured, `GET /v1/commitments?limit=200` and each deal's `/terms`). No `private` or `judgment` deal exists to read, so those columns are inferred from `apps/operator/src/server.ts` and `packages/core/src/private.ts` at `origin/main` `b9e33a9`.
- **The headline measurements** are in `docs/privacy-baseline.md`, each with its route or transaction.
- **Reviewer pass, 2026-11-14 (the `reviewer` agent): ISSUES, nothing blocking.** Two Medium: the state read serves the payment and payout addresses with balances at every level, which the `judgment` and `private` cells denied; and the chain alone carries keccak256 of `plaintextSha256` in the delivery's calldata (`contracts/src/HoldbackTypes.sol`, `Delivery`), which this session then measured on case 8's delivery. Six Low and four Info on sourcing and wording: the published acceptance, the ADR-0024 §2 claim, the pull request named for leak 3, the provider names, `plaintextMime`, `limits.txt`'s model providers and failed-check reasons, and this Evidence. All fixed.
- **Red-team pass, 2026-11-14 (the `red-teamer` agent), plain GETs and read-only RPC only.** Two Medium: a checks-only report is exposed when the same report is judged with a rubric in another deal (measured, cases 1 to 3 share one hash, case 3's notes quote it); and a fresh key does not hide a company's deals in a club of its own, since the mandate's principal relinks them (inferred; measured that `GET /v1/agents/<address>` serves it). Low: mandates show issue time and caps; the faucet's consecutive mints pair buyer and seller keys on chain; a deal's state read shows current balances. Info: provider names, more equal reports, the buyer's sealed envelope in the decision's calldata. All folded into the baseline.

## Decisions

- The baseline is a dated record (`docs/writing.md`, "Numbers that drift"), so it keeps its addresses, sizes and times.
- The `limits.txt` line "The work itself is always private" was wrong in two ways the measurements show, and was corrected (see the Handoff).

## Handoff

See `docs/privacy-baseline.md`, "Leaks no choice closes today", for the follow-ups and their lanes. Not done here: a line for the new doc in `CLAUDE.md`'s Map, which is Rafa's to edit.
