---
description: Run or update scenario fixtures; review snapshot diffs before accepting them
argument-hint: [fixture-name] [--update]
---

Run `pnpm snap $ARGUMENTS`.

If `--update` was passed:
1. Show the diff for each changed `.expect.md` file.
2. For each changed section, explain why the new output is correct, citing the spec or task.
3. If you cannot justify a change, revert that snapshot and report it as a possible regression.

Never update snapshots in bulk without per-file justification.
