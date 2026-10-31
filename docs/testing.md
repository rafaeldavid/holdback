# Testing strategy

The goal is fast, deterministic feedback that agents can trust, plus readable evidence that humans can review. Three practices shape it:

- **Types for invariants, and expect tests over deterministic simulation.** Following Ron Minsky's Bug Bash 2026 talk on reliable software in the age of agents: make illegal states unrepresentable, test with expect tests against deterministic simulations, value example-based tests, keep code review, and use formal methods where agents make them affordable.
- **Golden-file fixtures,** in the style of the React Compiler's fixture suite: an input file and a reviewed `.expect.md` snapshot, with filename prefixes for expected errors and known gaps. We take the shape, not the volume. Most compiler-style cases have no counterpart here.
- **Verification before parallelism** (Lauren Tan's pstack): make results observable, label claims as measured, inferred or guessed, and trust one agent's verifiable output before running many.

## Layers

| Layer | What it proves | Tool | Runs in CI |
| --- | --- | --- | --- |
| Types | Illegal commitment states cannot be built; money is never a float; messages are typed EIP-712 structs | TypeScript strict, discriminated unions, branded types | Yes |
| Unit + table tests | Aggregation rule, check evaluators, signature verification, timing rules | Vitest | Yes |
| Property tests | Ledger conservation, no negative balances, settle-once, idempotency under random interleavings | fast-check | Yes |
| **Scenario fixtures (expect tests)** | End-to-end behavior per scenario: states, balances, events, judgments, receipts | `pnpm snap` (testkit) | Yes |
| Differential tests | SimChain and the EVM contract produce the same transcript for every scenario | `pnpm snap --settlement=local` | Yes, from Phase 2 |
| Contract tests | Invariants, fuzzing, no admin paths | Foundry (`forge test`, invariant tests) | Yes, from Phase 2 |
| Formal model | Liveness and safety of the commitment state machine under any single actor halting | TLA+ (TLC/Apalache) or Quint | Yes, model check on PR touching the state machine |
| Calibration and red team | Judge accuracy, injection resistance, drift | `pnpm calibrate` | No (on demand, before registry promotion) |
| Demo dry run | The experience works for a newcomer | Manual checklist (T-013) | No |

## Scenario fixtures

### Layout

```
fixtures/scenarios/
  happy-path.scenario.yaml
  happy-path.expect.md
  bad-work-row-drop.scenario.yaml
  bad-work-row-drop.expect.md
  attack.injection-encoded-base64.scenario.yaml
  attack.injection-encoded-base64.expect.md
  neutrality.operator-refuses.scenario.yaml
  neutrality.operator-refuses.expect.md
  error.scope-exceeded.scenario.yaml
  error.scope-exceeded.expect.md
  todo.milestone-delivery.scenario.yaml        # known unsupported; expect file records the current error
fixtures/data/                                 # CSV inputs and deliverables referenced by scenarios
```

### Filename prefixes

| Prefix | Meaning | The runner expects |
| --- | --- | --- |
| *(none)* | Normal flow | Reaches a terminal state, invariants hold |
| `error.` | The system must refuse something | A specific problem type at a specific step; invariants hold |
| `attack.` | Adversarial input or party | No auto-accept; the expected escalation or rejection |
| `neutrality.` | One actor refuses or disappears | Terms-compliant terminal state despite the failure |
| `todo.` | Known gap | The snapshot records today's behavior; promote when fixed |

### Pragmas

The first line of a scenario file is a comment with pragmas. The runner reads them before parsing the YAML.

```yaml
# @settlement sim @judges recorded @mode guaranteed_on_decision @seed 7
name: happy-path
club: fixtures/clubs/data-services-v1.yaml
parties: { buyer: atlas-buyer, seller: tidewater-seller }
terms: fixtures/terms/clean-customers-2000.yaml
steps:
  - offer: { by: seller }
  - agree_and_fund: { by: buyer, via: op-1 }
  - deliver: { by: seller, file: data/customers.cleaned.good.csv }
  - judge: { adjudicator: bench-a }
  - settle: {}
  - verify_key_release: { by: buyer }
expect_terminal: Released
```

### Snapshot contents

`<name>.expect.md` is generated, human-readable and reviewed in PRs. It contains:

1. Input summary: parties, terms hash, rulebook hash, pragmas.
2. Timeline: one row per step, with columns for clock, actor, call, operator or direct, resulting state, and problem type if any.
3. Balances after each money-moving step.
4. Judgment: checks, screen signals, panel seed and members (with pinned model IDs, or `recorded:<id>`), verdict summaries, aggregate decision and reasons.
5. Receipts and event hash chain head.
6. Invariant results.

Volatile values (wall time, random IDs) are replaced by the deterministic clock and seeded IDs. Latency is never in snapshots. It goes to `pnpm load`.

### Commands

```
pnpm snap                       # run all; fail on diff
pnpm snap happy-path            # run one
pnpm snap --update happy-path   # rewrite the snapshot; commit only after reviewing the diff
pnpm snap --settlement=local    # same fixtures against the EVM contract (Phase 2)
pnpm snap --judges=live <name>  # same fixture with live judges; prints the diff, never updates snapshots
```

### Recorded judges

Recorded mode replays verdicts stored in `fixtures/recordings/<scenario>/<judgeId>.json`. They are captured from live runs with `pnpm snap --judges=live --record <name>`. Recordings include the model ID, the prompt template hash and the input hash; a template, rubric or input change invalidates them, and the runner fails loudly.

## Rules for adding tests

- Every bug fix adds or changes a scenario fixture that fails before the fix.
- Every new defense adds an `attack.` fixture.
- Every new actor or timeout adds a `neutrality.` fixture.
- Do not snapshot UI markup, provider SDK internals or log formatting.
- Do not test model quality in CI. Use `pnpm calibrate` for that.

## CI layout (T-022)

`.github/workflows/ci.yml` runs these jobs in parallel:

| Job | Runs |
| --- | --- |
| `typecheck, lint, spec, snap` | `pnpm typecheck`, `pnpm lint`, `pnpm validate:spec`, `pnpm snap` |
| `test (i/4)` | `pnpm build`, then `pnpm test --shard=i/4`, four shards |
| `check` | Fails unless the job above and every shard succeeded. This is the one status to require in branch protection. |
| `gitleaks` | Secret scan, unchanged |

- **Shards.** `vitest.config.ts` assigns test files to shards by measured cost, longest first, rather than by Vitest's path-hash split. A file missing from its cost table costs 2 (tenths of a second), so a new file is still run; only the balance drifts. To refresh the table, copy the per-file times that the default reporter prints in a CI test shard's log (`gh run view <id> --log`). Those times include `beforeAll` hooks. The JSON reporter's per-file times leave the hooks out, which drops the demo-transcript files to near zero.
- **Property-test runs.** `HOLDBACK_PROPERTY_RUNS` caps the run count of the SimChain properties (`packages/settlement/sim/properties.test.ts`). Pull requests set it to 40. Pushes to `main`, the nightly `schedule` run and local runs (including `pnpm verify`) leave it unset, which means the full counts. The seed is fixed, so a capped run checks exactly the first cases of the full run and a failure reproduces with the same seed. The deepest event kinds (`appeal.filed`, `default.triggered`, `commitment.settled`) need about 100 cases at this seed, so they are asserted only at the full count.
- **Heavy files.** The 9 MB adversarial screen inputs stay in every run: they test the screen at the 10 MB intake cap.
