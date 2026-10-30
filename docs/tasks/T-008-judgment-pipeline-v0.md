# T-008: Judgment pipeline v0: intake, checks, screen, prompt builder, verdict schema, aggregation

- **Lane:** judgment
- **Phase:** 1
- **Depends on:** T-004
- **Paths this task may touch:** `packages/judgment/`
- **Human gate:** yes (defenses)
- **Status:** todo
- **Agent/session:** —

## Intent

Build stages 0, 1, 2, 4 (prompting), 5 of `docs/judgment-and-defenses.md` with the defenses wired in from the start.

Restate this in your own words in this section before writing code.

## Context

- `docs/judgment-and-defenses.md`; `spec/schemas/judge-verdict.schema.json`, `judgment.schema.json`; ADR-0006, ADR-0012.

## Acceptance criteria

- [ ] Intake: decrypt with escrowed key, verify plaintext hash, MIME allowlist, 10 MB cap, NFKC + strip Unicode tag block and zero-width chars.
- [ ] Declarative check registry (closed union) with CSV/JSON evaluators: columns exact, row count range, unique key, null rate max, regex match rate, ISO 8601 column, JSON Schema, reference row match.
- [ ] Screen v0: heuristics (instruction phrases, decodable base64/Morse runs, tag chars) producing signals.
- [ ] Prompt builder that only accepts deliverable content as `UntrustedData`; random-boundary delimiters + datamarking; canary token; test proving system prompt contains no deliverable bytes.
- [ ] Verdict parsing against schema; failure → abstain.
- [ ] Aggregation function with exhaustive table tests matching the pseudo-code.
- [ ] ADR-0021: on the empty-rubric accept with a flagged screen, append the reason "screen flagged; see screen.signals" (decision unchanged); add the check `hidden_characters_max` (per-category counts of tag, bidi-control, variation-selector and other invisible characters, from raw bytes) once the schema carries it.

## Out of scope

- Live provider calls (T-009); reader extraction and classifier (Phase 3).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
