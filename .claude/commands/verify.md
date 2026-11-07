---
description: Run the checks for the current change's kind and collect evidence
---

Run the local checks the change's kind names in `docs/team.md`, Change recipes: for example `node site/build.mjs && node site/check.mjs` for copy, that package's tests for code (`pnpm exec vitest run <paths>`), `forge test` for contracts, and nothing for process docs. CI is the gate and runs everything.

Run the full `pnpm verify` only before a deploy, and only one at a time on the Mac. It runs typecheck, lint, test, spec validation, snap and demo, and writes `reports/verify-<branch>.md` with pass, fail or placeholder per step.

Then:
- read the output; do not mark anything as passing unless the output shows it passing;
- explain every snapshot diff in one line;
- copy the result into the active task file's Evidence section, labeled measured, and summarize it in 1 to 3 bullets in the PR's Verification section.
