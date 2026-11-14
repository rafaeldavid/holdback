# T-415: Decision record: where a mandate's limits are enforced, and revocation

- **Lane:** research
- **Phase:** 2
- **Depends on:** none. It reads ADR-0001, ADR-0002, ADR-0015, ADR-0017, ADR-0024, ADR-0031 and ADR-0033.
- **Paths this task may touch:** one new file under `docs/decisions/`, one entry in `docs/decisions-today.md`, this file
- **Human gate:** no. Nothing leaves the repository; Rafa may overrule the decision.
- **Status:** done (pull request 508, merged 2026-11-14: the decision record ADR-0038; Rafa answered its questions the same day, D69; the build is later tasks)
- **Agent/session:** the T-415 session, started 2026-11-14 by the coordinator of that day's wave
- **Roadmap row:** N117, N115
- **Kind:** 10, research and decisions (`docs/team.md`, Change recipes)

## Intent

A company signs a mandate for its agent: roles, a cap per deal, a daily cap, categories and an expiry. Enterprise buyers will ask what stops an agent that goes past it, and how to cut an agent off at once. This task answers both in a decision record, with no code:

- say for each of the five scope fields, with file and line, who enforces it today: the contracts, the operators, the counterparty, the adjudicator, or nobody;
- decide where each limit is enforced and what Crow tells a company about it;
- decide the `categories` field: checked, or removed;
- decide the daily cap across operators: one count, or one per operator and said so;
- decide revocation before expiry: where a signed revocation lives, who honours it, what happens to deals already agreed or funded, and how a neutrality fixture shows an operator that hides it;
- say what a richer mandate (roadmap row N116) needs this decision to leave room for.

Inputs: the code on `origin/main`, the ADRs above, and the standards other agent-payment systems use for the same ideas. Outputs: one ADR, marked Proposed, and one entry in `docs/decisions-today.md`, adopted and open to Rafa's overrule. Non-goals: any change to code, schemas, contracts, guides or fixtures; the design of N116.

## Context

- `CLAUDE.md`: the three litmus tests; user choice (ADR-0015); parametrize, don't restrict (D31); the law is the backstop (D26); parties carry responsibility (D32); rails, not a record-keeper (D35).
- Rafa, 2026-11-12: spending limits are a company's to set in its own wallet and tooling; "a funded wallet is a funded wallet".
- `packages/core/src/state.ts` (`scopeAllows`, `agree`, `fund`), `packages/core/src/private.ts` (`verifyDelegation`), `packages/settlement/evm/evm-settlement.ts` (`scopeFor`, `agree`, the join of a deal funded on chain), `contracts/src/HoldbackRules.sol` (`agreeAndFund`, `_requireSigned`).
- `spec/schemas/common.schema.json` (`Scope`), `spec/schemas/mandate.schema.json`, `spec/schemas/messages.schema.json` (`AgentRevocation`, `Delegation`).
- The contracts are frozen for the pilot at the tag `contracts-phase-one-1`.

## Acceptance criteria

- [x] The ADR states, for each of the five scope fields, where it is enforced today, with file and line, each labelled measured or inferred.
- [x] The ADR gives one recommendation for each of the five questions, with the options weighed against the three litmus tests.
- [x] Each recommendation names the fixtures and the schema changes it needs, with the version bump named and not made.
- [x] The ADR gives the build order and what must not be built before the pilot.
- [x] The ADR compares the decision with current agent-payment and authorization standards, each with a version or date and a link.
- [x] `docs/decisions-today.md` has one new entry, adopted and open to Rafa's overrule.
- [x] One reviewer pass; findings fixed or answered.
- [x] No file outside this task's paths changes.

## Out of scope

- Any code, schema, contract, guide or fixture change. Each is a follow-up named in the ADR.
- The full design of the richer mandate (N116).
- The `site/` guides: another lane owns them in this wave.

## Evidence

Nothing was run except the checks below. Kind 10 has no required local checks (`docs/team.md`).

- **The record** [measured]: `docs/decisions/ADR-0038-mandate-limits-and-revocation.md`, Proposed, and entry D69 in `docs/decisions-today.md`, adopted and open to Rafa's overrule.
- **Each acceptance criterion:**
  - The five scope fields, with file and line and a label: the table "What enforces each field today" and the eleven facts under it. The reviewer opened the cited lines at `b9e33a9b` and confirmed them; three line numbers it found off by one are corrected [measured by the reviewer].
  - One recommendation per question, with options against the litmus tests: sections 1 to 5, each with an option table.
  - Fixtures and schema changes per recommendation, with the bump named and not made: the "Fixtures" and "Schema" lines of each section.
  - The build order and what must not be built before the pilot: "The build, in order".
  - Outside standards with a version or date and a link: "How others carry the same ideas", thirteen rows. A research pass opened each source on 2026-11-14 [checked by that pass; the reviewer fetched the links and matched the six EIP statuses, and did not verify the AP2 and x402 dates or the wallet services' policy claims].
  - One reviewer pass: ISSUES, 4 High, 6 Medium, 8 Low, no Critical. All 18 are fixed in the text or answered in the record's last section. Its re-check of the fixes confirmed 17 fixed and one partly, and raised 2 Medium and 6 Low points, which are fixed as well.
  - No file outside the task's paths: `git diff origin/main --stat` shows three files [measured].
- **Commands run** [measured]:
  - `node scripts/id-check.mjs --branch t-415-mandate-limits-adr`: pass.
  - `pnpm vitest run tests/design-map.test.ts tests/cut-feature-alignment.test.ts`: 2 files, 34 tests pass.
- **The research pass** found the draft in the worktree while it read, so it is a second reading, not a blind one. It confirmed the five answers and added seven findings, listed in the record's last section.

## Decisions

- **The amendment to ADR-0024 section 7 was withdrawn after review.** The first draft made the adjudicator's check of a `Delegation` optional. A hard rule in `CLAUDE.md` names that check, and its wording is Rafa's. The record now states the gap and asks him.
- **`maxDaily` stays for now.** The research pass would remove it with `categories`. The record keeps it as a statement and asks Rafa.
- **The status line on D69** follows T-413's new check (`tests/decisions-status.test.ts`, on its branch): `**Status:** adopted, 2026-11-14.`

## Handoff

**Done:** the record and the D69 entry. **Not done:** everything the record describes; nothing is built.

**Follow-ups, none started.** Each needs its own task file.

1. Text: the guide's table of what stops an agent, the corrected `scope_exceeded` problem, and the standing texts the record lists. It touches `site/ref/limits.txt` (T-416's file in this wave), `apps/operator/src/problems.ts` (T-409's lane), `docs/neutrality.md`, `docs/architecture.md`, `docs/api.md`, `docs/judgment-and-defenses.md` and `docs/audit/known-issues.md`.
2. The wallet path: an additive schema version so a contract wallet's signature funds through an operator.
3. The mandate checks move to the operator layer, with the testkit's book per operator. It waits for Rafa's word.
4. The route for a company's own mandate, then revocation, then the reference clients' check.
5. The design record for the richer mandate.
6. ADR-0024 needs a back-pointer to this record at section 7; that file is outside this task's paths.

**Waiting on Rafa:** the seven questions under "Not decided here" in the record. The first decides whether the mandate route and revocation are built at all.

**To resume:** read the record's summary and "The build, in order". The two research notes stayed outside the repository; the record's last two sections carry their findings and sources.
