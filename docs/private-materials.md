# What is kept outside this repository

This repository holds the current build and its technical record: the code, the contracts, the API contract, the decisions, the reviews and the task files with their evidence.

The maintainers keep planning and business material in a private repository. This page lists what is there, so that a reader knows it exists.

## What the private repository holds

- **The roadmap and the plan for later phases.** `docs/plan.md` covers the current build only.
- **The backlog:** work deferred until after the current build.
- **Market and prior-art research,** and the notes behind it. The research that the decisions cite stays here, in `docs/research/`.
- **The daily build log:** the coordinator's record of each day, with what waits on the maintainer, what is live and the next steps. The maintainers moved it on 2026-11-11. The entries from before the move stay in this repository's git history, under `docs/log/`.
- **The team's process notes and budgets:** the update-flow table, which lists how a change to one area reaches the others, and the design of an agent pipeline, which is not active. The maintainers moved both on 2026-11-11; the versions from before the move stay in this repository's git history, as `docs/update-flow.md` and under `agent-ops/`. `docs/team.md` stays in this repository: it pairs each hard rule with its check and names the checks each kind of change runs.
- **The cost model and operating costs.**
- **Brand and messaging work.**
- **The founders' console:** its code, its deploy records and the notes on its metrics.
- **The full text of documents shortened here.** On 2026-11-11 the maintainers shortened seven decisions and one passage in `docs/decisions-today.md`, and passages of `docs/operations.md`, `docs/PRD.md`, `docs/demo.md`, `README.md` and two task files, to their technical content. The private repository keeps each file as it read before.

## What this means for older documents

Task files, decisions and reviews are dated records. Some of them name a file that has moved, such as `docs/backlog.md`, `docs/costs.md` or an entry in `docs/log/`. The maintainers leave those records as written. A moved file also stays in this repository's git history.

## How to ask for access

Reviewers and auditors can ask the maintainer for access:

- through the private contact in [`SECURITY.md`](../SECURITY.md), or
- by opening a GitHub issue in this repository.
