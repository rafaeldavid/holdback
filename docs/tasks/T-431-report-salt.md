# T-431: a salt in the audit report

- **Lane:** demo (the seller adapter and its audit template)
- **Phase:** 2
- **Depends on:** T-416 (the privacy baseline, PR 503), T-408 (the one-shot start)
- **Paths this task may touch:** `examples/seller-adapter.ts`, `examples/seller-adapter.template.json`, `examples/seller-adapter.test.ts`, `examples/audit-deal.ts`, `examples/audit-deal.test.ts`, `fixtures/terms/audit-report*.yaml`, `fixtures/scenarios/audit-report-*.expect.md`, `fixtures/scenarios/two-addresses-released.expect.md`, `fixtures/recordings/audit-report-rubric-accepted/`, `spec/examples/commitment.audit-report.example.json`, `site/ref/seller-adapter.txt`, `site/ref/checks.txt`, `site/ref/limits.txt`, this file
- **Human gate:** no
- **Status:** done
- **Agent/session:** T-399 session (roadmap row N128, Rafa 2026-11-14: "Yes build both")
- **Roadmap row:** N128

## Intent

A delivery's SHA-256 (`plaintextSha256`) is public at every disclosure level, and the delivery's calldata carries its keccak256. Anyone who can guess a report can confirm the guess. The privacy baseline rebuilt 5 of 6 rehearsal reports exactly from the public sample report and each deal's public scope (measured, `docs/privacy-baseline.md`, finding 3). Equal reports also show as equal.

The baseline's smallest change: the public audit template's `report` check allows an optional top-level `salt` of 32 random bytes; the seller adapter fills it; the buyer's tools accept it. Non-goals: a spec change that hashes a salt carried in the content envelope (kind 6, later), any change to the operators, the contracts or the buyer's signer.

## Acceptance criteria

- [x] The shipped template (`examples/seller-adapter.template.json`) and its YAML copies allow `salt`, a string `0x` plus 64 lower-case hex digits, and the description says a report may add one.
- [x] With the shipped template the adapter adds `"salt": "0x…"` first in each JSON report, after the mapping and before the checks run; every other byte stays as it was.
- [x] The adapter draws one salt a deal when it makes the offer and keeps it in the journal (`Deal.salt`), so a retried delivery sends the same bytes, and a deal offered without one is delivered without one.
- [x] With a template of the seller's own (from a file or in code) the salt is off unless `reportSalt: true`; `reportSalt: false` turns it off with the shipped template; any other value is refused at load. The start refuses `reportSalt: true` with a deliverable that is not `application/json`.
- [x] A report that is not a JSON object in UTF-8, or already has a top-level `salt`, is refused like any other result the adapter cannot deliver (`not_salted`), and the seller is told.
- [x] Done when (N128): two deliveries of the same report have different public fingerprints, and the SHA-256 of the exactly rebuilt report matches neither.
- [x] The buyer's tools accept a salted report with no change: the buyer's signer checks the opened bytes against the signed `plaintextSha256`, and the checks allow the field.

## Out of scope

- The salt inside the content envelope, hashed with the plaintext (a spec change, kind 6).
- The kit's terms for design partner A: their `report` check sets no `additionalProperties: false` at the top, so a salt passes there too; turning it on in the kit's config is the kit's own change (crow-private).
- A fresh seller key per deal (N127, T-432).

## Evidence

- Commands run and results (measured, 2026-11-14, worktree `.worktrees/t-431-report-salt` from `main` e48e694):
  - `pnpm typecheck`: pass. `pnpm lint`: pass. `pnpm validate:spec`: 35/35 examples valid.
  - `npx vitest run examples/seller-adapter.test.ts -t "report salt"`: 5 passed:
    - the byte-exact insert (pretty, compact and empty objects; a 20-digit integer and `1.0` kept as written);
    - the refusals (not an object, not JSON, not UTF-8, salt already there);
    - two deals of the same report: the reports equal once the salt is taken out, the two SHA-256 values differ, and the rebuilt report's SHA-256 matches neither;
    - the configuration rules;
    - the start refused for a `text/markdown` deliverable.
  - `npx vitest run examples/seller-adapter.test.ts examples/audit-deal.test.ts`: 73 passed. Six existing tests now expect the salt first in the delivered report and the rest unchanged; the first one also checks the salt equals the journal's.
  - `pnpm snap`: 48 passed, 0 failed, after `--update` of five snapshots. Only each snapshot's commitment ID changed, since the terms changed. In `audit-report-rubric-accepted` the new commitment ID draws another panel (qwen-a, gpt-a, gpt-b instead of gpt-b, gpt-a, claude-b). Its scripted verdicts were re-recorded with `pnpm snap --judges fake --record --update`: all pass, scores 4/4/4/4/4 as before. The unused `claude-b.json` recording is removed.
  - `node site/build.mjs && node site/check.mjs`: PASS; buyer's first-deal path 4,547 of 5,000 tokens, seller's 4,160 of 5,000 (estimates).
  - `pnpm test`: the first full run failed the two new deal tests (the offer did not reach AcceptedByAdjudicator in 20 s) when they ran after the rest of the file on its shared world; alone they passed. They now run on a world of their own, like the other funding blocks (cause inferred: the shared world had run many deals by then). The file then passed 50 of 50, and the full run 3,999 passed, 0 failed, 234 skipped (217 files).
- Review (one reviewer, kind 4): ISSUES, one Medium and three Low, all fixed in the third commit:
  - Medium: the salt followed today's configuration, not the deal's terms;
  - Low: a leading BOM was refused;
  - Low: a configuration built in code with its own template inherited the salt;
  - Low: the guide did not say a hand-delivered report has no salt.
  After the fixes: `examples/seller-adapter.test.ts` 51 of 51 in three runs in a row; `pnpm test` 4,000 passed, 0 failed, 234 skipped; typecheck, lint and the site check pass (measured).
- Snapshot diffs: commitment IDs only, plus the rubric scenario's panel as above.

## Decisions

- **Put first, by text.** The adapter inserts the field after the opening `{` instead of parsing and re-serialising, so a report's numbers (a 20-digit integer, `1.0`), key order and spacing reach the buyer as the seller's API wrote them.
- **One salt a deal, drawn with the offer.** It is in the journal from the offer on, so a restart or a redelivery after a refusal sends the same salt. A deal follows the terms it was offered under: one offered without a salt, under another template or before this change, is delivered without one even when the configuration turns the salt on later (review finding 1).
- **On with the shipped template, off with a seller's own.** A seller's own template may refuse unknown fields (`additionalProperties: false`), and a salt it never allowed would refuse every report. Left out, `reportSalt` is on only when the template is the shipped file, so a configuration built in code with the shipped one spread under it gets no salt with its own template (review finding 3). `pnpm audit-deal --terms <file>` follows it too.
- **A byte-order mark stays.** A report that starts with U+FEFF is salted after its `{`; the adjudicator's intake drops the mark, as before (review finding 2).
- **The salt stays out of the events file and the log.** The log says only that it was added and the sizes before and after.

## Handoff

Done: the template, the adapter option, the tests, the guide lines (`ref/seller-adapter.txt`, `ref/checks.txt`, `ref/limits.txt`). Not done: a site deploy (Rafa's), so crow.direct serves the guides from before this change. The live test seller (T-420) runs its own template and is unchanged. The kit for design partner A can set `reportSalt: true` (its export's top level allows extra fields); that is a crow-private change.
