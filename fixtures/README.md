# fixtures/

Scenario fixtures are the main test suite and the source of the demo's transcripts. Conventions are in `docs/testing.md`; this file covers layout.

```
fixtures/
  scenarios/      <name>.scenario.yaml + <name>.expect.md (golden snapshot)
  recordings/     <scenario>/<judgeId>.json   recorded judge verdicts (model ID + prompt hash)
  clubs/          rulebooks used by scenarios
  terms/          commitment terms used by scenarios
  data/           input datasets and deliverables (generated, seeded; see scripts/gen-demo-data.ts)
  calibration/    labeled cases for pnpm calibrate (Phase 3)
  redteam/        adversarial cases for pnpm calibrate --redteam (Phase 3)
```

## Naming

| Prefix | Meaning |
| --- | --- |
| none | Normal flow reaches a terminal state |
| `error.` | The system must refuse something at a named step |
| `attack.` | Adversarial input or party; must not auto-accept |
| `neutrality.` | One actor refuses or disappears; the transaction still completes according to its terms |
| `todo.` | Known gap; the snapshot records current behavior |

## First line pragmas

`# @settlement sim|local|testnet @judges recorded|fake|live @mode guaranteed_on_decision|settle_after_window @seed <int>`

## Example

`scenarios/_example.scenario.yaml` and `scenarios/_example.expect.md` show the intended format. The expect file was written by hand to show the shape; T-005's runner replaces it with generated output.

## Data generation

Deliverables are generated from seeds, so fixtures are reproducible. Do not hand-edit generated data. Change the generator and regenerate.
