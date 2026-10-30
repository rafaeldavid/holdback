---
description: Run the product and collect evidence for the current branch
---

Run `pnpm verify`. If the script does not exist yet (before T-011), run these in order:

```
pnpm typecheck
pnpm test
pnpm snap
pnpm demo
```

Then summarize:
- pass or fail per step;
- every snapshot diff, with a one-line explanation of each;
- any metric produced (latency, counts), labeled as measured.

Write the summary into the active task file's Evidence section. Do not mark anything as passing unless you saw it pass.
