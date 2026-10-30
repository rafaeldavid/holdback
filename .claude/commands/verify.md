---
description: Run the product and collect evidence for the current branch
---

Run `pnpm verify`. It runs typecheck, lint, test, spec validation, snap and demo, and writes `reports/verify-<branch>.md` with pass, fail or placeholder per step, timings, snapshot diffs against HEAD, and the tail of each step's output. It exits 1 if any step fails.

Then:
- read the report; do not mark anything as passing unless the report shows it passing;
- explain every snapshot diff in one line;
- treat `placeholder` as not done (the command's task has not landed);
- copy the step table into the active task file's Evidence section, labeled measured, and summarize it in 1 to 3 bullets in the PR's Verification section.
