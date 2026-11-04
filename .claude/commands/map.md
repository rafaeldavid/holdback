---
description: Regenerate the read-only design map and republish it
---

The design map is a read-only view of the project: phases, the work feed, decisions and ADRs, the protocol diagram, the commitment lifecycle, the API, and next steps. It is generated from the repository, so it is only as current as its sources.

1. Make sure the sources are current on main: task `Status` lines, `docs/plan.md`, `docs/decisions-today.md`, ADR `Status` lines, `docs/api.md`, the latest `docs/log/` entry and any new review in `docs/reviews/` (a `## Next steps` list there feeds the page).
2. Run `pnpm map`. It writes `reports/design-map.html`.
3. If the protocol architecture or the lifecycle changed, update the hand-drawn parts in `tools/design-map/template.html` first.
4. Republish `reports/design-map.html` to the existing design-map artifact, passing its URL (https://claude.ai/artifact/4nAPcSGQz6nL5mb8AuDhd2). Do not create a new link.
5. Report the link and what changed since the last publish, labeled measured.

The contract stack lives at https://control.escrow.stream/contracts; `pnpm stack` generates it, and the founder console's job rebuilds it when `contracts/` changes.
