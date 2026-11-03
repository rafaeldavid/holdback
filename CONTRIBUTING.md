# Contributing to Crow

Crow is built by a small team of people and their agents. Every change, from a person or an agent, follows the same rails.

## What you may work on

- A task in `docs/tasks/` whose status is `todo` or `ready` and that `docs/plan.md` lists: the approved roadmap.
- An issue labelled `approved`.

For anything else, open an issue first with the **Proposal** form. A maintainer labels it `approved` or explains why not. Don't start work on an idea that isn't approved.

## How to contribute

1. Fork the repository and work on a branch: `t-<id>-<slug>` for a task, `issue-<number>-<slug>` for an issue.
2. Read `CLAUDE.md` first. Its hard rules and the three litmus tests (neutrality, the hold, defended judgment) bind every change.
3. Keep pull requests small. Write the test first; run `pnpm verify`, or for a docs-only change `node site/build.mjs && node site/check.mjs`.
4. Open the pull request with the template, link the task or issue, and label each claim as measured, inferred or guessed.
5. A maintainer approves the CI run on your fork, reviews the change and merges it. Contributors never merge.

## Changes that need a maintainer's design approval

- `spec/schemas/`, the API contract: an ADR plus a version bump.
- `contracts/`: the settlement contracts. Reviewed, with a review by a second model family at milestones.
- `docs/decisions/`: ADRs are proposed; only a maintainer accepts them.
- `.github/`, `CLAUDE.md` and `.claude/`: maintainers only.

`.github/CODEOWNERS` routes these paths to a maintainer.

## Agents

An agent working for you follows `CLAUDE.md`, works only on approved tasks or issues, never pushes to `main`, never merges, and says in the pull request body that an agent wrote it (label: `agent`).

## Security

Never report a vulnerability in an issue. See `SECURITY.md`.

## License

Contributions are licensed under Apache-2.0, the project's license. Sign off each commit to certify you may contribute it (Developer Certificate of Origin): `git commit -s`.
