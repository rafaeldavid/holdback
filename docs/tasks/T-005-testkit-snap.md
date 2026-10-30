# T-005: Testkit: snap runner, pragmas, prefixes, deterministic clock/RNG, recordings

- **Lane:** test
- **Phase:** 1
- **Depends on:** T-001
- **Paths this task may touch:** `packages/testkit/`, `fixtures/README.md`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Build the scenario expect-test runner described in `docs/testing.md` so every later task proves behavior with readable snapshots.

Restate this in your own words in this section before writing code.

## Context

- `docs/testing.md`; `fixtures/README.md`; `fixtures/scenarios/_example.*`.

## Acceptance criteria

- [ ] `pnpm snap`, `pnpm snap <name>`, `pnpm snap --update <name>`, `--settlement`, `--judges` flags.
- [ ] Pragma parser for the first-line comment; prefix semantics (`error.`, `attack.`, `neutrality.`, `todo.`).
- [ ] Deterministic clock and seeded RNG/ID generator injected into all packages via a context object.
- [ ] Recorded-judge provider format with model ID + prompt hash; mismatch fails loudly.
- [ ] Snapshot renderer producing the sections listed in `docs/testing.md`; stable ordering; no wall-clock values.
- [ ] The `_example` fixture runs against a stub settlement and produces its expect file.

## Out of scope

- Domain behavior beyond stubs.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
