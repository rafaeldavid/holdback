# T-008: Judgment pipeline v0: intake, checks, screen, prompt builder, verdict schema, aggregation

- **Lane:** judgment
- **Phase:** 1
- **Depends on:** T-004
- **Paths this task may touch:** `packages/judgment/`
- **Human gate:** yes (defenses)
- **Status:** done
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

### Round 2: red-team fixes, D17 and D18 (2026-10-31)

- **`pnpm verify` (measured, commit `56e994f`, clean tree):**

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 210 ms |
  | lint | `pnpm lint` | pass | 1469 ms |
  | test | `pnpm test` | pass | 12054 ms |
  | spec | `pnpm validate:spec` | pass | 291 ms |
  | snap | `pnpm snap` | pass | 634 ms |
  | demo | `pnpm demo` | placeholder | 106 ms |

  `snap` now runs the T-005 runner (1 scenario, `_example`, passes). `demo` is the T-013 placeholder, not a pass.
- **Test count (measured):** 1408 in the repo; 422 in `packages/judgment` across 11 files, including the 85 red-team cases.
- **Red-team suite (measured).**
  - Committed failing first in `0d92646`: 68 of 85 failed, the coordinator's count.
  - Now 85 of 85 pass.
  - Edits to the red-team file:
    - an unused import removed (it failed lint);
    - migrated to the v0.5 shapes with assertions unchanged: rates in basis points, thresholds as fractions; F1 `0.667` became `{2,3}` (the ADR-0022 mapping), and L-tie `0.5` became `{51,100}`, since a half is now refused.
  - No case is skipped or marked `todo`.
- **Mutation sweep (measured):** `node packages/judgment/scripts/mutants.mjs`, **81 mutants, 81 killed (80 in the full run; the `\u`-escape mutant was retargeted after the view split and killed in a filtered run)**.
  - The list grew from 41 to 81 mutants, re-targeted at the changed code. New mutants cover the new defenses:
    - confusables, the JSON and `\u` views, NFKC and mixed-script signals, formula prefixes, terms screening;
    - registry families, label normalization, duplicate models, non-ASCII IDs;
    - redaction, refanging, the canary split across fields;
    - forced escalation, raw-text checks, the check budget;
    - the tie guard, inclusive cross-multiplication, the strict-majority policy guard;
    - the null semantics and `hidden_characters_max`;
    - quoting of party terms, line-terminator datamarking, escalation on sampled data;
    - format binding at intake and in the pipeline.
  - The first run left 10 survivors, each closed with a new test:
    - confusables (masked by the mixed-script signal);
    - the JSON view and the `\u` view (each masked the other, so they were split by input kind);
    - family-label normalization and duplicate models (G1 tripped both guards at once);
    - the tie guard (equivalent under validated policies; now tested directly under a non-majority fraction);
    - non-scalar null (the mutant crashed and failed closed, which the old test read as a pass);
    - quoting of the description;
    - non-ASCII model IDs (masked by the version-stamp rule);
    - intake format binding (untested at intake).
- **Large inputs (measured, 9 MB adversarial shapes such as dots, letters, spaced letters, mixed-script words, base64, percent, Morse, JSON and `\u` escapes):**
  - Before: a 9 MB CSV of letters took the screen 124 s, because a joined-base64 pattern backtracked quadratically. Several shapes threw `RangeError` from V8's regex stack.
  - Now: every shape screens in at most about 3.5 s with no failed pass. Six shapes are pinned in `screen.test.ts` with a 20 s bound.
  - Two source rules prevent a repeat (see Handoff).
- **CI (measured):** on PR #21 at `1c7b724`, the `check` job (install, typecheck, lint, test, spec, snap) and `gitleaks` both pass.
- **Schema v0.5 (measured):** after merging `origin/d-schema-v0.5`, a pipeline draft plus placeholder identity, seed, `seedSource`, hash and signature parses with core's `parseJudgment`, the v0.5 aggregate included.
- **Neutrality, D17 (measured):** Persian with ZWNJ, U+2764 U+FE0F and the England flag tag sequence screen clean and are accepted by a cross-family panel. A non-required `hidden_characters_max` over its limit fails without rejecting. At its limit it passes; required and over it, it rejects with no panel.
- **Screen false positives on real data (guessed):** still uncalibrated. The new skeletons (rot13, reversed, leetspeak) were checked only against the fixtures and the clean tests in this package.

### Round 1 (2026-10-30)

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

### Round 2 (supersedes round 1 where they differ)

- **Checks read the text as delivered.**
  - Intake now returns `raw` (decoded, unnormalized) next to `data` (normalized).
  - Deterministic checks and `hidden_characters_max` use `raw`; the screen and the prompts use `data`.
- **`null_rate_max` counts as null:**
  - a cell that is empty after trimming whitespace, format characters and blank-looking letters (Hangul fillers, the braille blank);
  - the built-in tokens `null`, `nil`, `n/a`, `nan`, `undefined`, `-`, `--` and `?`, case-insensitive (not `none` or `na`, which are real values, for example Namibia);
  - JSON objects, arrays and booleans.
- **`csv_columns_exact`** fails on anything but a CSV deliverable.
- **Hidden characters, classified (ADR-0021):** tag, bidi, variation selector, `otherIgnorable` (total = their sum).
  - Normalization strips them all, but these are "explained" and not counted as suspicious:
    - emoji tag sequences;
    - VS15 and VS16 after an emoji or keycap base;
    - ZWJ between emoji;
    - ZWNJ or ZWJ between letters of a script other than Latin, Cyrillic or Greek.
  - `hidden_characters_max` counts everything, explained or not, on the raw text. It uses `type`, like every check, though the brief wrote `kind`.
- **Screen.** Phrase patterns run over six views of each text:
  - the lowercase text;
  - a skeleton (NFD, combining marks dropped, UTS #39 Cyrillic and Greek confusables subset, camelCase and separators split);
  - rejoined spaced letters;
  - leetspeak inside mixed letter-and-digit tokens;
  - rot13;
  - the reversed text.

  Beyond phrases, the screen:
  - decodes base64 without the space rule, joined chunks, hex, percent-encoding and Morse in its variants, re-screening decoded text two levels deep;
  - screens a JSON document through its parsed strings, and other text through decoded `\u` escapes;
  - adds signals for NFKC changes (space variants excluded), mixed-script words and CSV formula prefixes;
  - adds new phrase families (addressing a judge, judge notes, verdict claims).

  Engineering rules:
  - Every run pattern is a bounded character class (at most 4096 characters per match), never a quantified group or an open-ended `{n,}`.
  - Failed decodes do not count against the signal cap.
  - A pass that throws becomes an `encoded_run` signal instead of a crash.
- **New signals reuse existing kinds,** because the schema enum is fixed:
  - NFKC changes, mixed-script words and failed passes use `encoded_run`;
  - formula prefixes and phrases in party terms use `instruction_phrase`.
- **Party terms.** Description, criteria and anchors are:
  - normalized, and placed as JSON values inside a `<<<BEGIN AGREED TERMS boundary>>>` block, never as bare system text;
  - screened (hidden characters, hidden text, mixed-script words), with the signals merged into the screen;
  - refusable at offer time through `validateTerms(acceptance, description)`.
- **Induced abstention.** Any filter abstention (output too long, canary, not JSON, schema, criteria mismatch, URL in the rationale or injectionEvidence) escalates the case. A URL in criterion evidence is redacted to `[link removed]`. URL detection refangs `[.]`, `(.)`, spaced dots, ideographic and fullwidth dots, `hxxp` and `[:]`, and covers `mailto:`, `data:`, `javascript:` and IPv4 addresses.
- **Canary.** Detected case-insensitively, ignoring separators, in the raw output and across the concatenated free-text values, and inside base64 tokens.
- **Sampling.**
  - Data over 100,000 characters is sampled: the header plus lines at an even stride across the whole file.
  - The prompt is marked `truncated`, and the case escalates. The even stride is predictable, so the escalation is the defense until T-009 adds seeded sampling.
  - Every Unicode line terminator starts a datamarked line.
- **Format binding.** `intake({ format })` refuses `mime_mismatch`, and `runPipeline` refuses a `deliverable.format` mismatch. Both inputs are optional so the red-team helpers compile; T-009 must pass them.
- **Panel guards.**
  - Families come from an injected registry (`ReadonlyMap<modelId, { family }>`), never from the seat label. Without a registry, labels are trimmed and lowercased.
  - Duplicate model IDs are refused.
  - Model IDs must be ASCII and free of alias words (`latest`, `preview`, `current`, `default`, `stable`, `newest`, `beta`, `experimental`).
  - With a registry, an ID must be in it. Without one, it must end in a date or revision stamp, as in `-20260601`, `-2026-05-01`, `-001` or `-2411`.
- **Check budget.** 50,000,000 regex state visits and schema node visits per delivery, shared by all checks, with `MAX_STATES` lowered from 10,000 to 5,000. A check that exhausts it is inconclusive: recorded as not passed, and the case escalates without a panel. A definite required failure still rejects.
- **Integer rules (D18, ADR-0022).**
  - Thresholds are fractions (denominator 1 to 100), compared inclusively by cross-multiplication, with no `EPS`.
  - A policy must have `2 × numerator > denominator`.
  - Accept also needs `pass > fail`, and reject needs `fail > pass`.
  - Weights are integers 1 to 10000. `passThreshold` and `weightedScore` are integer hundredths, and the score is floored.
  - The record carries `passCount`, `failCount` and `validCount`.
  - Checks compare `count × 10000` against `bps × rows`.
  - `AGGREGATION_VERSION` is now `agg-2`.
- **D17.** An empty-rubric accept with a flagged screen keeps `accept` and appends "screen flagged; see screen.signals".
- **Types.** `terms.ts` aliases core's v0.5 types (merged from `origin/d-schema-v0.5`).
- **Source hygiene.** Judgment sources must be ASCII, with characters written as `\u` escapes, and contain no `{n,}` regex loop. Both rules are enforced by `source.test.ts`.

### Round 1

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

For Rafa (human gate, defenses): this round is defense code and waits for approval. PR #21 now contains a merge of `origin/d-schema-v0.5`, so **PR 23 must merge first** (or together).

**Open decisions:**

1. **Sampled data always escalates (red-team item 7, as instructed).** Every deliverable over 100,000 characters escalates until T-009 adds seeded sampling. That includes the demo's roughly 9,500-row customer CSV, which is about 0.5 MB (inferred). **This will make the demo's happy path escalate** unless T-009 lands sampling first, or the demo raises `maxDataChars`.
2. **The screen escalates on any signal when the panel runs,** NFKC changes and mixed-script words included. ADR-0021 deferred finer escalation to Phase 3. Fullwidth or ligature characters in real data now escalate.
3. **Invalid checks** still fail closed, and a required one rejects (round 1, item 2).
4. **`inputHash` cannot be recomputed** without the per-judge nonces (round 1, item 3). Still open for T-009 and ADR-0018.
5. **The null-token list is built in.** A per-check list needs a schema field.
6. **Screen signal kinds.** NFKC changes, mixed-script words, CSV formula prefixes and failed passes have no dedicated kind in the enum. They reuse `encoded_run` and `instruction_phrase`. Dedicated kinds would be a schema change.

**For T-009:**

- Pass `registry` (from the registry bound by `registryHash`), `deliverable.format` and intake `format`.
- Replace the even-stride sample with seeded sampling, or keep the escalation.
- Implement `JudgeProvider` with the judge timeout.
- Run the check stage in a worker with a deadline. Item 10's worker is not built here; the step budget bounds the work instead.
- Inject core's T-014 `open` in place of `openAes256Gcm`. It now exists in core with plaintext-hash verification.
- Derive the per-judge nonces from the seed and supply `criteriaFor`.

**Backlog (post-demo).** Nothing from red-team items 1 to 15 is skipped: all 85 cases pass, and none is marked `todo`. Partial or follow-up items:

- Item 6: the confusables table is a Cyrillic and Greek subset of UTS #39, not the full data file (C "Cyrillic homoglyphs" passes).
- Item 10: the worker with a deadline is recorded for T-009 (K1 and K2 pass on the budget alone).
- Items 6 and 15: thresholds are uncalibrated (C "paraphrase" and H2 "JUDGE NOTE" pass through fixed phrase families, which a paraphrase outside them will evade).

**Proposed rows for `docs/team.md` Rules and checks** (outside my lane; not edited):

- "Judgment defenses are tested": `node packages/judgment/scripts/mutants.mjs`, 81 mutants, 81 killed (80 in the full run; the `\u`-escape mutant was retargeted after the view split and killed in a filtered run) today.
- "Judgment sources are ASCII and have no open-ended regex loops": `source.test.ts`. The failure mode it catches: my editing tool silently turned `\uXXXX` escapes into literal invisible characters in three source files; I caught it with a byte scan. Separately, `{n,}` patterns overflowed V8's regex stack on 9 MB inputs.

Not done or not verified:

- No `red-teamer` re-run on this round.
- Commits `c1fc896` to `1ebd7d7` were not verified one by one; only the branch head was.

Outside my lane, not touched:

- core types and parsers (they come from the PR 23 merge);
- `docs/team.md`;
- `docs/judgment-and-defenses.md`, whose pseudo-code should gain the D17 reason, the forced-escalation line and the integer rules.
