# T-008: Judgment pipeline v0: intake, checks, screen, prompt builder, verdict schema, aggregation

- **Lane:** judgment
- **Phase:** 1
- **Depends on:** T-004
- **Paths this task may touch:** `packages/judgment/`
- **Human gate:** yes (defenses)
- **Status:** review
- **Agent/session:** implementer, branch `t-008-judgment-v0`

## Intent

Build stages 0, 1, 2, 4 (prompting), 5 of `docs/judgment-and-defenses.md` with the defenses wired in from the start.

**Restated.** Turn a delivery into a judgment draft without ever trusting what the seller wrote. In order:

1. **Intake.** Unwrap the content key escrowed to this adjudicator, check the ciphertext hash, decrypt and verify the plaintext hash. Enforce the MIME allowlist and the 10 MB cap. Decode strict UTF-8, strip Unicode tag and zero-width characters, apply NFKC, and keep counts of what was removed.
2. **Deterministic checks.** Evaluate the commitment's checks in declared order, with built-in evaluators for exactly the eight schema check types. Nothing from the commitment or the deliverable is executed, and a pattern cannot cost more than linear time.
3. **Screen.** Look for injection signals: instruction phrases, decodable base64 and Morse runs, tag and zero-width characters.
4. **Prompts.** Build a prompt per judge in which deliverable bytes appear only inside a random-boundary, datamarked data section of the user message, never in the system prompt. The system prompt carries a canary.
5. **Verdicts.** Parse each judge's output strictly. Anything off-schema, off-rubric, URL-bearing or canary-echoing is an abstention.
6. **Aggregation.** Apply the documented rule exactly.

Model calls go through an injected provider. Tests use fakes, and the pipeline refuses unpinned model IDs and too few families before calling anyone.

**Non-goals.** Live providers, the registry loader, commit-reveal panel selection, the seed and the per-judge criteria shuffle (T-009, ADR-0018). Signing and publishing the record (T-009). The reader stage and the classifier screen (Phase 3). Sealed-check evaluation. The real x25519 key unwrap and the envelope format (T-014). No schema changes.

## Context

- `docs/judgment-and-defenses.md`; `spec/schemas/judge-verdict.schema.json`, `judgment.schema.json`; ADR-0006, ADR-0012.

## Acceptance criteria

- [x] Intake: decrypt with escrowed key, verify plaintext hash, MIME allowlist, 10 MB cap, NFKC + strip Unicode tag block and zero-width chars.
- [x] Declarative check registry (closed union) with CSV/JSON evaluators: columns exact, row count range, unique key, null rate max, regex match rate, ISO 8601 column, JSON Schema, reference row match.
- [x] Screen v0: heuristics (instruction phrases, decodable base64/Morse runs, tag chars) producing signals.
- [x] Prompt builder that only accepts deliverable content as `UntrustedData`; random-boundary delimiters + datamarking; canary token; test proving system prompt contains no deliverable bytes.
- [x] Verdict parsing against schema; failure → abstain.
- [x] Aggregation function with exhaustive table tests matching the pseudo-code.
- [x] ADR-0021: on the empty-rubric accept with a flagged screen, append the reason "screen flagged; see screen.signals" (decision unchanged); add the check `hidden_characters_max` (per-category counts of tag, bidi-control, variation-selector and other invisible characters, from raw bytes) once the schema carries it.
- [x] Integer rates and fraction thresholds (ADR-0022): `acceptSupermajority` and `rejectSupermajority` are fractions compared by cross-multiplication (no `EPS`); accept requires `pass > fail` and reject `fail > pass`, so ties escalate; policies with `2 × numerator ≤ denominator` are refused; the weighted score is an integer in hundredths; the record carries counts; checks cross-multiply (`nulls × 10000 ≤ maxBps × rows`). Tests: 2 of 3 accepts at {2,3}; a 2–2 split escalates; 3 of 5 escalates and 4 of 5 accepts at {4,5}; a property that accept and reject never both hold.

## Out of scope

- Live provider calls (T-009); reader extraction and classifier (Phase 3).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- **`pnpm verify` (measured, commit `afbadc3`, 2026-10-30T17:44Z, clean tree):**

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 164 ms |
  | lint | `pnpm lint` | pass | 1024 ms |
  | test | `pnpm test` | pass | 2453 ms |
  | spec | `pnpm validate:spec` | pass | 343 ms |
  | snap | `pnpm snap` | placeholder | 107 ms |
  | demo | `pnpm demo` | placeholder | 110 ms |

  `snap` and `demo` are T-005 and T-013 placeholders, not passes. Typecheck was incremental.
- **Test count (measured):** 819 in the repo; 259 in `packages/judgment` across 10 files:
  - safe-regex 47, aggregate 41, checks 41, verdict 28, pipeline 24, intake 21, screen 21, prompt 15, source scan 11, json-schema 10.
- **Tests failed first (measured).** Commit `82883bc` holds only tests. Run against it, all 10 judgment test files failed: 9 because their modules did not exist, and the source scan because it found 1 file instead of more than 5.
  - Two table cases in `aggregate.test.ts` were wrong: the failing verdicts' zero scores pulled the mean below the threshold. I fixed the test data, not the rule.
  - The deep-nesting robustness fix (`afbadc3`) was also test first: 1 failing test, `RangeError` (measured).
- **Mutation sweep (measured):** `node packages/judgment/scripts/mutants.mjs` breaks one defense at a time and runs the judgment tests. **41 mutants, 41 killed.** The first run left 3 survivors, each closed with a new test:
  - a fixed boundary in the system prompt;
  - `UntrustedData.toString` leaking content;
  - the plaintext cap off by one.

  | Defense | Mutants | Examples (tests failed) |
  | --- | --- | --- |
  | Injection screen | 11 | screen never flags (14); override phrases dropped (7); base64 decoder off (2); Morse decoder off (1); decoded runs not re-screened (2); tag text not screened (1); aggregation ignores flag (4) or injectionSuspected (4); canary not checked (3); no tag stripping (3); no NFKC (2) |
  | Two-family rule | 4 | `MIN_PASS_FAMILIES = 1` (2); family condition removed (2); families counted over all verdicts (1); pipeline accepts a one-family panel (1) |
  | Schema-invalid verdict → abstain | 6 | schema failure accepted (8); rubric ids unchecked (2); URLs allowed (3); policy rationale cap ignored (1); prose read as pass (3); abstentions counted valid (2) |
  | Deterministic check order | 5 | results reversed (2); panel runs after a required failure (2); screen outranks a required failure (3); optional failures reject (16); empty-rubric short circuit removed (6) |
  | Prompt placement | 7 | deliverable appended to the system prompt (2); no datamark (1); fixed boundary (1); plain strings accepted (1); boundary collision allowed (1); canary dropped (4); toString leak (1) |
  | Other | 8 | `latest` accepted (4); no retry (2); retry on any error (1); plaintext hash unchecked (1); size cap off by one (1); MIME allowlist off (1); search instead of full match (1); unknown schema keyword ignored (2) |
- **System prompt holds no deliverable bytes (measured):** `prompt.test.ts` builds a prompt over a CSV with an injection row. It checks:
  - no 16-character window of the data, and no data line, occurs in the system prompt;
  - the injection appears only between the real boundary markers;
  - every data line carries the datamark;
  - a forged end marker stays inside the section.

  A plain string or a look-alike object passed as data fails typecheck (`@ts-expect-error`) and throws at runtime.
- **Linear-time patterns (measured):** `(a+)+$`, `(a|a)*b`, `(a*)*b`, `(a|aa)+c` and `(\w+\s?)+$`, each on a 4001-character adversarial subject, finish under the 1 s test bound. A seeded property (500 runs) shows the engine agrees with `RegExp` on full match and search for 5 patterns. 21 table patterns agree with `RegExp`.
- **Aggregation matches the pseudo-code (measured):** 28 table cases cover every line of the rule and the threshold edges, plus 7 short-circuit cases. A seeded property over 2000 random inputs agrees with an independent, literal transcription of the pseudo-code in the test.
- **Judgment shape (measured):** a pipeline draft plus placeholder identity, seed, hash and signature parses with core's `parseJudgment` against `judgment.schema.json`.
- **Determinism (measured):** two runs on the same inputs give deep-equal drafts. The source scan finds no `Math.random`, `Date.now`, `new Date`, `eval`, `Function`, `fetch`, network, vm or child-process modules, `process.env` or `new RegExp` in judgment sources.
- **No network or keys (inferred from the source scan and the provider interface):** the only model access is the injected `JudgeProvider`, and tests use in-memory fakes.
- **Stack exhaustion (measured):** 200,000-deep JSON made `evaluateChecks` throw `RangeError` before the fix. After it, the affected checks fail closed.
- **Screen false-positive rate on real datasets (guessed):** low for CSV of names, emails, dates and hex IDs, because the clean fixtures and the hex and base64-binary test pass unflagged. Not measured on a corpus; calibration is Phase 3.

## Decisions

- **Dependencies.** `@holdback/core` (workspace) and `fast-check` (dev; already in the lockfile through core). No new third-party packages. TypeScript stays `~6.0.3`.
- **`UntrustedData`** is a class with a private field, not a structural brand, so it cannot be forged by an object literal. `toString`, `toJSON` and `Symbol.toPrimitive` return `[UntrustedData]`. Reading content takes an explicit `reveal()`.
- **Regex engine.** Commitment patterns never reach `RegExp`. A Thompson NFA over a closed subset guarantees linear time instead of bounding a backtracking engine.
  - Refused: backreferences, lookarounds, named groups, `\b`, `\p{}`, `\u` and `\x`, repeats over 1000, more than 10,000 NFA states, and patterns over 200 characters.
  - `^` is allowed only first and `$` only last.
  - Subjects over 10,000 code points never match.
  - `regex_match_rate_min` uses full-match semantics; empty cells count as non-matching.
- **`json_schema` is interpreted, not compiled.** Ajv generates JavaScript from a schema, and this schema is commitment input. The interpreter covers an allowlisted keyword subset: type, properties, required, additionalProperties, items, min/maxItems, uniqueItems, the numeric bounds, min/maxLength, pattern (safe engine, search semantics), enum, const, anyOf, allOf, oneOf, not, and annotations.
  - Refused: `$ref`, `$id`, `format`, `patternProperties`, `if` and anything else unknown.
  - Limits: depth 32, 2000 subschemas.
- **Invalid or unevaluable checks fail closed** (`passed: false`, detail `check invalid: …`), which matches the pseudo-code: a required one rejects. `validateCheck` is exported so operators can refuse such checks at offer time.
- **Check semantics.**
  - Tables: CSV is strict RFC 4180. JSON is an array of flat objects with identical key sets. Empty CSV cells and JSON `null` or `""` are null.
  - `iso8601_date_column` accepts `YYYY-MM-DD` and RFC 3339 date-times with calendar validation, and skips nulls.
  - `reference_row_match_min` is the share of reference rows whose key exists in the deliverable with every reference column equal.
  - Zero rows gives a match rate of 1 and a null rate of 0, leaving emptiness to `row_count_range`.
- **Screen v0 flags on any signal**, zero-width characters included (a leading BOM is dropped by UTF-8 decoding and not counted). Signal details never quote the deliverable, because the record is published before the buyer pays. `SCREEN_VERSION = 'screen-0'`.
- **Prompt.**
  - The system prompt holds the fixed template, the agreed description and criteria, the boundary and datamark, and `CANARY-<hex>`.
  - The user message holds a fixed preamble and the data section only.
  - The datamark is a `^xxxxxxxx^` line prefix, a line-level variant of Hines et al.'s datamarking that leaves cell content unaltered.
  - `promptTemplateHash` is the SHA-256 of `PROMPT_TEMPLATE`. `inputHash` is the SHA-256 of the RFC 8785 JSON of `{system, user}`.
  - Data beyond 100,000 characters is truncated at a line boundary, with a note. Sampling is T-009's.
- **Verdict parsing** applies, in order: a 64 KB output cap; canary anywhere in the raw output; strict `JSON.parse` with no fence stripping; core's `parseJudgeVerdict`; the policy rationale cap; the rubric id set exactly (no missing, extra or duplicate ids); and a URL filter over rationale, evidence and injectionEvidence. A model's own `overall: "abstain"` is kept as a verdict with status `abstain`. Any failure is an abstention with no verdict.
- **Aggregation interpretations of the pseudo-code:**
  - an empty valid set escalates even if `minValid` is 0;
  - an empty rubric satisfies the score condition vacuously;
  - shares are compared to the policy Rate literally, with a 1e-9 tolerance for float rounding only;
  - injectionSuspected counts from every parsed verdict, abstaining ones included;
  - the two-family accept condition is fixed at 2 (`MIN_PASS_FAMILIES`), as written;
  - with all checks passed and an empty rubric, the delivery is accepted even if the screen flagged it, because no model reads it.
- **Pipeline guards.** Before any judge is called, the pipeline refuses:
  - a model ID that is empty or contains `latest` (case-insensitive);
  - duplicate judge IDs;
  - fewer distinct families than `policy.minFamilies`;
  - a per-judge criteria list that is not a permutation of the rubric.

  These use problem type `invalid_terms`, since there is no dedicated type. Requests carry only judgeId, provider, model, system, user, `temperature: 0` and `maxOutputTokens`. Retry happens once, on transport errors and thrown exceptions only. Timeouts are recorded and not retried, and the provider enforces the timeout.
- **Canary echo** makes that judge abstain, adds a `canary_echo` screen signal and flags the screen, so the case escalates.
- **Intake errors** are a typed `IntakeError` with eight codes rather than core `Problem`s. Only `mime_not_allowed` and `payload_too_large` have Problem counterparts.
- **Provisional AES-256-GCM layout** `iv(12) || ciphertext || tag(16)` through Web Crypto. Key unwrap is an injected `KeyUnwrapper`.

## Handoff

For Rafa (human gate, defenses): this PR adds defense code and needs approval before merge. Points to decide:

1. **Supermajority threshold vs. the example policy (contract gap).** `spec/examples/adjudicator.example.json` uses `acceptSupermajority: 0.667`. Compared literally, 2 of 3 (0.6667) is not a supermajority, so a 3-judge panel needs 3 of 3 to accept, contradicting "≥ 2/3" in the docs. A test pins this. Options:
   - change the example to `0.66` or `0.6666`;
   - express supermajority as a fraction in the schema (schema change, ADR);
   - define rounding.

   I did not add a rounding rule.
2. **Invalid checks.** A check the engine refuses (for example a backreference pattern) fails closed, and a required one rejects the seller. This matches the pseudo-code, but it punishes the seller for terms both parties signed. Operators (T-007) should call `validateCheck` at offer time. Alternatively an ADR could make invalid checks escalate.
3. **`inputHash` is not recomputable by the buyer yet.** The rendered prompt includes the per-judge boundary and canary, and the judgment record has no field for them. Options for T-009 and ADR-0018:
   - derive them from the revealed seed, for example HMAC(seed, judgeId ‖ attempt), unpredictable until reveal;
   - add them to the record (schema change).

   This PR takes nonces as input and does not derive them.
4. **Party-authored text in the system prompt.** The spec description and criteria are written by the offering party (the seller) and agreed by the buyer. They sit in the instruction position by design, and the screen does not scan them. Consider screening terms at offer time.
5. **Residuals.**
   - The canary check is exact-match, so a transformed echo (spaced or encoded) is not caught.
   - The URL filter may abstain on evidence such as `customers.csv/row`.
   - Judges see the first 100,000 characters only.
   - Sealed checks are not evaluated or weighted.
   - Screen thresholds (any zero-width character flags) are uncalibrated.

For T-009:

- Implement `JudgeProvider` (enforce `judgeTimeoutSec`, measure `latencyMs`), seat selection, a per-judge `criteriaFor` shuffle and `nonces`, the appeal template and appeal thresholds (`minValidAppeal`; the pipeline takes first-instance thresholds today), and policy binding: check `PROMPT_TEMPLATE_HASH` against `policy.promptTemplateHash`.
- Map `IntakeError` to an outcome. A plaintext hash mismatch or a missing key is seller fault, but no rule says reject versus escalate.
- `SCREEN_VERSION` is `screen-0` and `AGGREGATION_VERSION` is `agg-1`. The example policy says `screen-1`.

For T-014: replace `openAes256Gcm` and the fake unwrapper with the real envelope format and the x25519 unwrap. Intake takes both by injection.

Out of lane, not touched:

- **Proposed row for `docs/team.md` Rules and checks:** "Judgment defenses are tested", enforced by `node packages/judgment/scripts/mutants.mjs`. Each mutant breaks one defense and must be killed (41/41 today). Run it on PRs that touch `packages/judgment`. The failure mode it caught: tests that assert behavior through one path while the defense can be bypassed on another, as with the three first-run survivors.
- The "Deliverables untrusted" and "No code execution" rows can point at `prompt.test.ts`, `source.test.ts` and the sweep.
- Recommend a `red-teamer` pass on this branch before review, per `prompts/phase-1-demo.md`. I did not run one.
- gitleaks is not installed locally, so CI will be its first run on this branch. I added no ignore entries.
