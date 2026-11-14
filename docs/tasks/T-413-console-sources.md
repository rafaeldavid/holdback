# T-413: Sources for the console's missing signals, public side

- **Lane:** infra
- **Phase:** 2
- **Depends on:** T-404 (Crow Control's rebuild, private), T-066 (the metrics format)
- **Paths this task may touch:** `apps/test-agents/`, `apps/early-access/`, `apps/site/`, `scripts/metrics/ops-cost*` (and its schema under `scripts/metrics/schemas/`), `site/check.mjs` (one block of its own), a new `site/guide-budget.mjs`, `docs/decisions-today.md` (a status line on each entry only), new tests under `tests/`, `tests/metrics/ops-cost*`, this file
- **Human gate:** yes for the three deploys (site, test agents, early access). Nothing is deployed by this task.
- **Status:** in progress
- **Agent/session:** the T-413 session, started 2026-11-14 by the coordinator's wave (sister task T-414 reads these sources into the console)
- **Kind:** 1 (the site check), 2 (the decisions record), 4 (Worker code), with the metrics script; one `reviewer` pass

## Intent

Crow Control's Steering panel shows nine signals as "missing" because no script can read their data. Four of the sources belong in this repository. This task makes each one a plain file or a plain GET with a pinned shape, so T-414 can read it into the console with no model and no guess:

1. **Which open decisions wait for Rafa.** `docs/decisions-today.md` mixes decisions the agents adopted (which Rafa may overrule) with decisions that need him. Each entry gets one machine-readable status line, so the console can age only the ones that need him.
2. **What each Worker runs, and since when.** The site, the test agents and early access each answer one unauthenticated, uncached GET with the commit they were built from and the time Cloudflare created the live version. Nothing secret is in it.
3. **The agent guides' size against their budget.** `site/check.mjs` already measures each role's first-deal path; at a publish build it writes that measure beside the site, so the deployed site serves it.
4. **Gas per deal in the hourly build.** `ops-cost.mjs` reads each measured deal's gas from the Sepolia receipts, and writes its source and date beside the number.

Non-goals: editing the console (T-414), the operators (`apps/demo-cloud/`, T-409's lane), any deploy, any decision's content.

## Acceptance criteria

- [ ] Every entry in `docs/decisions-today.md` carries one `**Status:**` line in a fixed vocabulary with a date; the open entries are classified from their own text and the daily logs, and any that cannot be told read `unclear` and are listed here. A test fails on an entry without a valid line. No decision's content changes.
- [ ] The site, the test agents and early access each serve `GET …/version.json` in one shape (a test pins it), with `cache-control: no-store`, the build commit (or null) and the live version's creation time from Cloudflare's version-metadata binding (or null). Each one's deploy script fills the commit.
- [ ] A publish build's `site/check.mjs` writes `reports/site-out/guide-budget.json`: each role's path, bytes, tokens, the budget and the method; a test pins its shape.
- [ ] `ops-cost.json` carries `perDeal.gas.source`: where the gas came from (receipts, the event log or both), how many deals and transactions, any mismatch, and the window's dates. The schema allows it and a test pins it. The script still runs with no installed packages, as the console's build runs it.
- [ ] Handoff names the exact path and shape of each source for T-414, what each deploy would change, the GET that checks each afterwards, and the one field the operators lack.

## Evidence

(filled in at handoff)

## Handoff

(filled in at handoff)
