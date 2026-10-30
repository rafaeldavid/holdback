# T-005: Testkit: snap runner, pragmas, prefixes, deterministic clock/RNG, recordings

- **Lane:** test
- **Phase:** 1
- **Depends on:** T-001
- **Paths this task may touch:** `packages/testkit/`, `fixtures/README.md`
- **Human gate:** no
- **Status:** review
- **Agent/session:** implementer (Claude Opus 5.5), worktree .worktrees/holdback-T-005, branch t-005-testkit

## Intent

Build the scenario expect-test runner described in `docs/testing.md` so every later task proves behavior with readable snapshots.

**Restated.** Give the project one command, `pnpm snap`, that turns a declarative scenario fixture into a deterministic, human-readable transcript and compares it with a reviewed `.expect.md` file. Later tasks (settlement, judgment, operator, demo) prove behavior by adding fixtures, so the runner has to be trustworthy before it has much to run.

- **Inputs:** `fixtures/scenarios/<name>.scenario.yaml` (first-line pragmas plus YAML), `fixtures/recordings/<scenario>/<judgeId>.json`, CLI flags.
- **Outputs:** one `pass`/`fail` line per fixture plus a summary and a nonzero exit on failure (so `pnpm verify` and CI can read it); generated `.expect.md` files with the six sections from `docs/testing.md`.
- **Pieces:** a pragma parser; prefix semantics for `error.`, `attack.`, `neutrality.`, `todo.`; a `SimContext` (simulated clock, seeded RNG, ID generator) that packages take instead of the wall clock or `Math.random`; a recorded-judge provider bound to model ID, prompt template hash and input hash that fails loudly on mismatch; a renderer with stable ordering and no wall-clock values; a stub settlement that drives `@holdback/core`'s real `offer`/`step` so `_example` exercises real transitions.
- **Non-goals:** domain behavior beyond stubs (no SimChain ledger semantics, no deterministic checks, no screen, no real panel selection, no operator receipts with signatures); live model calls, network access or API keys (`--judges live` exists only to refuse); the EVM settlement (`--settlement local|testnet` refuses until Phase 2); new scenario fixtures beyond `_example` (T-010); schema or contract changes.

## Context

- `docs/testing.md`; `fixtures/README.md`; `fixtures/scenarios/_example.*`.

## Acceptance criteria

- [x] `pnpm snap`, `pnpm snap <name>`, `pnpm snap --update <name>`, `--settlement`, `--judges` and `--record` flags.
- [x] Pragma parser for the first-line comment; prefix semantics (`error.`, `attack.`, `neutrality.`, `todo.`).
- [x] Deterministic clock and seeded RNG/ID generator injected into all packages via a context object. (The `SimContext` type lives in testkit for now; see Handoff.)
- [x] Recorded-judge provider format with model ID, prompt template hash and input hash; mismatch fails loudly.
- [x] Snapshot renderer producing the sections listed in `docs/testing.md`; stable ordering; no wall-clock values.
- [x] The `_example` fixture runs against a stub settlement and produces its expect file.
- [x] `pnpm snap` prints one `pass`/`fail` line per fixture so `pnpm verify` can report it.

## Out of scope

- Domain behavior beyond stubs.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- **Tests failed first (measured).** After `test(testkit): specify…` (90a2367) and before any implementation, `pnpm vitest run packages/testkit` reported `Test Files 6 failed (6)` (modules missing). With the implementation in place but before generating the snapshot, 22 runner tests failed: the `_example` run threw `RecordingMissingError` (no recordings yet), which is the loud failure the task asks for.
- **Mutation checks (measured).** Each mutation was applied alone, the testkit suite run, then reverted. All 12 were caught:
  - recorded judges ignore an `inputHash` mismatch: 3 tests fail;
  - the clock reads `Date.now()`: 17 fail;
  - the renderer stamps `new Date()` into the header: 8 fail, including the leak test;
  - the RNG ignores the seed: 9 fail;
  - the stub skips signature verification: 1 fails (the impersonation test);
  - funding escrows the price without the fee: 6 fail;
  - `deliver` bypasses core's `step`: 1 fails;
  - `attack.` ignores an auto-accept: 2 fail;
  - the runner exits 0 on failures: 7 fail;
  - the runner skips the snapshot comparison: 1 fails;
  - YAML numeric money is accepted: 1 fails;
  - duplicate pragmas are accepted: 1 fails;
  - (a first, confounded variant of the `inputHash` mutation also changed the recording key set: 18 fail.)
- **`pnpm verify` (measured, commit e7afe4d plus the README edit):** typecheck pass, lint pass, test pass (16 files, 624 tests), spec pass, snap pass (`pass  _example`, `snap: 1 passed, 0 failed`), demo placeholder (T-013). Snap is no longer reported as placeholder.
- **Testkit suite (measured):** 6 files, 64 tests pass.
- **`_example` (measured):** states `Offered → AcceptedByAdjudicator → Agreed → Held → Delivered → Released` from core; final balances atlas-buyer 7,950, tidewater-seller 2,000, bench-a 25,050, escrow 0 tUSD, matching the fixture's `expect` block; all seven invariants hold; replay of 5 core events matches.
- **No wall clock or randomness in snapshots (measured):** the leak test runs `_example` with the system clock faked to 2031 and then 2099 and `Math.random` spied; snapshots are byte-identical, contain neither year, and `Math.random` is never called.
- **Live judges, network and keys (measured for the CLI paths, inferred for the rest):** `--judges live` exits 2 with a refusal before any fixture runs; no code path in packages/testkit imports an HTTP client or reads environment variables (inferred from reading the source).
- **Snapshot diffs:** `fixtures/scenarios/_example.expect.md` replaced the hand-written sketch with runner output. Differences from the sketch: a Step column, a Settlement row, the implied adjudicator acceptance row, whole-second ticks, all six accounts in Balances, a template/rubric/input hash line on the panel, stub labels on checks and screen, an Outcome section.
- **Metrics:** `pnpm snap` 597 ms including `tsc -b packages/testkit` (measured, one run).

## Decisions

1. **YAML parser.** Added `yaml@^2.9.1` (no dependencies). Parsed with the core schema, no custom tags, unique keys, strict mode and `maxAliasCount: 20`; every key is checked against a closed set. Unknown tags such as `!!js/function` are parse errors, so a fixture cannot carry code.
2. **Money in fixtures** must be a quoted decimal string; a YAML number is refused. Balances are `bigint` throughout and formatted with the token's 6 decimals.
3. **SimContext** = `{ seed, clock, rng, ids }`. Clock starts at the fixed `SIM_EPOCH` (2026-01-01T00:00:00Z) and moves only when told; RNG is splitmix64 over `bigint`; IDs are sequential per prefix. Snapshots show elapsed sim time only.
4. **One simulated second per call.** Signed timestamps are uint64 seconds (core's EIP-712 encoding), so sub-second ticks would make messages unsignable.
5. **Test keys** are `keccak256("holdback/testkit/v0/<seed>/<actor>")`, not RNG draws, so adding an actor does not shift other actors' addresses. They guard nothing and never appear in output.
6. **Signatures are real.** The stub signs every message and verifies it with core's `verifyMessage`/`verifyTerms` before `offer`/`step`. A `signer` field on `offer`, `agree_and_fund` and `deliver` makes impersonation fixtures possible and lets a test prove the check runs.
7. **Implied adjudicator acceptance.** Core requires `AcceptedByAdjudicator` before `agree`, and `_example` has no acceptance step, so `agree_and_fund` on an `Offered` commitment first runs the primary's acceptance and labels the row "implied". An explicit `adjudicator_accept` step exists too.
8. **Built-in stub terms.** The club, terms and data files `_example` names do not exist yet (demo lane). The stub uses built-in values and says so in the Input table; if a named club or terms file exists, the run fails instead of silently ignoring it.
9. **Recording format v0** (`holdback.recording/v0`): scenario, judgeId, provider, family, model, promptTemplateHash, inputHash, rubricHash, capturedFrom, verdict. The verdict is validated with core's `parseJudgeVerdict`; model aliases matching `latest` are refused. `--record` works with `--judges fake` (stub recordings marked `capturedFrom: fake`) because live judges are not available; `_example`'s recordings were captured that way and the snapshot says "captured from fake judges".
10. **Stub judgment.** Three seats over two families (`claude-a`, `claude-b`, `fam2-a`) with stub pinned IDs; `inputHash` = keccak of canonical JSON of commitment ID, attempt, plaintext hash, MIME, deliverable hash and rubric hash. Aggregation: any injection flag escalates; all pass across two families with weighted score at least the threshold accepts; all fail rejects; anything else escalates.
11. **Refusals do not stop a run.** Each refused step is recorded (problem type in the Result column, detail under Refusals) and later steps still run, so a `neutrality.` fixture can show recovery.
12. **Prefix rules.** `autoAccepted` means Released by a first-instance accept decision. `normal` fails on any refusal. `todo` always passes and is labelled. The fixture's `expect` block (terminal, balances, problem with optional step) is checked for every prefix except `todo`.
13. **CLI behavior.** Exit 0 all pass, 1 any fixture fails, 2 usage error. `--update` requires a name so every rewrite is deliberate. `--flag=value` and `--flag value` both work. An `## Outcome` section was added to the snapshot so the prefix verdict is reviewable alongside the transcript.
14. **Root `snap` script** is `tsc -b packages/testkit && node packages/testkit/dist/cli.js`, so it works without a prior build.

## Handoff

**Done:** everything in the acceptance list; `_example` snapshot and recordings generated; fixtures/README.md documents pragmas, commands, step kinds, recordings and the stub's limits.

**Files outside the task's listed paths, and why:**
- `package.json`: `snap` script now runs the testkit instead of the placeholder (acceptance criterion 1; allowed by the task brief).
- `pnpm-lock.yaml`: testkit dependencies (`@holdback/core` workspace link, `viem`, `yaml`).
- `fixtures/scenarios/_example.expect.md`: generated output (acceptance criterion 6; allowed by the task brief).
- `fixtures/recordings/_example/{claude-a,claude-b,fam2-a}.json`: `_example` uses `@judges recorded`, so it cannot pass without recordings. Test lane owns `fixtures/` per docs/team.md, but the directory was not in this task's path list.

**Not done / open:**
- `SimContext` is defined in `packages/testkit/src/context.ts`. For settlement and judgment to accept it without depending on testkit, the interface (not the implementation) should move to `@holdback/core` (core lane). Until then they can accept the structural type.
- Gap in the contract: the recording file format is testkit-internal (`holdback.recording/v0`), not in `spec/schemas/`. That seems right for a test artifact; raise an ADR if recordings become an interchange format.
- Stub event payloads and receipts do not follow `event.schema.json` and are unsigned; T-006/T-007 replace them. The stub judgment view is not a schema-valid `Judgment`.
- `fixtures/clubs/data-services-v1.yaml`, `fixtures/terms/clean-customers-2000.yaml` and `fixtures/data/customers.cleaned.good.csv` (demo lane) do not exist. When they land, the stub refuses `_example` by design; T-006 must load them.
- Testkit tests import `@holdback/core` through its built `dist/`, so `pnpm test` on a fresh checkout needs `pnpm typecheck` first (CI and `pnpm verify` already run it first). A vitest alias in the root config (infra lane) would remove that ordering dependency.
- Stale docs: CLAUDE.md still says `pnpm snap` is a placeholder until T-005, and docs/testing.md describes capturing with `--judges=live --record`, which refuses in this build.
- Proposed row for docs/team.md Rules and checks (not added; that file is outside this task): "Deterministic snapshots | `runner.test.ts` leak test fakes the system clock and spies `Math.random`; snapshot must be identical and year-free | T-005".

**How to resume:** `pnpm snap` from the repo root. Add a fixture under `fixtures/scenarios/`, run `pnpm snap --update <name>`, review the generated `.expect.md`, commit both. To capture stub recordings for a new fixture: `pnpm snap --judges fake --record --update <name>`, then `pnpm snap --update <name>` to snapshot in recorded mode.
