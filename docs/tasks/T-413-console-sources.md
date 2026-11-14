# T-413: Sources for the console's missing signals, public side

- **Lane:** infra
- **Phase:** 2
- **Depends on:** T-404 (Crow Control's rebuild, private), T-066 (the metrics format)
- **Paths this task may touch:** `apps/test-agents/`, `apps/early-access/`, `apps/site/`, `scripts/metrics/ops-cost*` (and its schema under `scripts/metrics/schemas/`), `site/check.mjs` (one block of its own), a new `site/guide-budget.mjs`, `docs/decisions-today.md` (a status line on each entry only), new tests under `tests/`, `tests/metrics/ops-cost*`, this file
- **Human gate:** yes for the three deploys (site, test agents, early access). Nothing is deployed by this task.
- **Status:** done (merged in PR 505, `e90b27a`; the site, the test agents and early access deployed on 2026-11-14, on Rafa's word)
- **Agent/session:** the T-413 session, started 2026-11-14 by the coordinator's wave (sister task T-414 reads these sources into the console)
- **Roadmap row:** N108
- **Kind:** 1 (the site check), 2 (the decisions record), 4 (Worker code), with the metrics script; one `reviewer` pass

## Intent

Crow Control's Steering panel shows nine signals as "missing" because no script can read their data. Four of the sources belong in this repository. This task makes each one a plain file or a plain GET with a pinned shape, so T-414 can read it into the console with no model and no guess:

1. **Which open decisions wait for Rafa.** `docs/decisions-today.md` mixes decisions the agents adopted (which Rafa may overrule) with decisions that need him. Each entry gets one machine-readable status line, so the console can age only the ones that need him.
2. **What each Worker runs, and since when.** The site, the test agents and early access each answer one unauthenticated, uncached GET with the commit they were built from and the time Cloudflare created the live version. Nothing secret is in it.
3. **The agent guides' size against their budget.** `site/check.mjs` already measures each role's first-deal path; at a publish build it writes that measure beside the site, so the deployed site serves it.
4. **Gas per deal in the hourly build.** `ops-cost.mjs` reads each measured deal's gas from the Sepolia receipts, and writes its source and date beside the number.

Non-goals: editing the console (T-414), the operators (`apps/demo-cloud/`, T-409's lane), any deploy, any decision's content.

## Acceptance criteria

- [x] Every entry in `docs/decisions-today.md` carries one `**Status:**` line in a fixed vocabulary with a date; the open entries are classified from their own text and the daily logs, in the coordinator's five states (2026-11-14). A test fails on an entry without a valid line. No decision's content changes.
- [x] The site, the test agents and early access each serve `GET …/version.json` in one shape (a test pins it), with `cache-control: no-store`, the build commit (or null) and the live version's creation time from Cloudflare's version-metadata binding (or null). Each one's deploy script fills the commit.
- [x] A publish build's `site/check.mjs` writes `reports/site-out/guide-budget.json`: each role's path, bytes, tokens, the budget and the method; a test pins its shape.
- [x] `ops-cost.json` carries `perDeal.gas.source`: where the gas came from (receipts, the event log or both), how many deals and transactions, any mismatch, and the window's dates. The schema allows it and a test pins it. The script still runs with no installed packages, as the console's build runs it.
- [x] Handoff names the exact path and shape of each source for T-414, what each deploy would change, the GET that checks each afterwards, and the one field the operators lack.

## Evidence

All measured on 2026-11-14 in this branch's worktree unless marked otherwise.

- **Checks:** `pnpm typecheck` passed; `pnpm lint` passed with no finding; `node site/build.mjs --op1 https://api.crow.direct --op2 https://api2.crow.direct --out reports/site-out && node site/check.mjs` passed; `pnpm exec vitest run` on the 22 affected test files (the four new ones, `tests/metrics`, `apps/test-agents`, the forwarding, site-deploy, site-guides, design-map and health tests) passed 342 tests after the review's fixes. No snapshot changed. CI runs the rest.
- **Test first:** `tests/decisions-status.test.ts` failed 68 of 70 tests before the status lines; `tests/build-info.test.ts` failed 7 of 9 before the Workers answered; the four new ops-cost tests failed before the change.
- **1. Decisions:** 68 entries, each with one status line: 54 `decided`, 12 `adopted`, 1 `deferred`, 1 `needs Rafa`, 0 `superseded`. The design map still reads 60 decided and 8 open, as before. The eight open entries, classified from their text and the daily logs of 2026-11-11 to 2026-11-14:

  | Entry | Status | Why |
  | --- | --- | --- |
  | D59 | adopted, 2026-11-12 | Proposed by T-348; its one call for Rafa (the slots) was answered by D63 on 2026-11-12, and T-380 built it |
  | D60 | adopted, 2026-11-12 | Designs Rafa's D58 item 5; D62 answered its first three points; its last two are answered: the pilot's payment address is Rafa's own wallet (Rafa, 2026-11-11, "Yes, two addresses", in the 2026-11-12 log's waiting list), and the Sepolia redeploy ran at the cutover |
  | D61 | deferred, 2026-11-11 | "none waits on Rafa now"; Rafa: "We can deal with this later" |
  | D64 | adopted, 2026-11-12 | "Adopted 2026-11-12 by T-367" |
  | D65 | adopted, 2026-11-12 | Proposed by T-373; built by T-377 (PRs 395, 397) and deployed on Rafa's word on 2026-11-12 (log) |
  | D66 | adopted, 2026-11-12 | "Adopted 2026-11-12 by T-380" |
  | D67 | adopted, 2026-11-12 | "Adopted 2026-11-12 by the coordinator" |
  | D68 | needs Rafa, 2026-11-14 | "Rafa picks before the build"; item 2 of the 2026-11-14 log's "Waiting on Rafa" |

  The decided entries are marked mechanically: `adopted` where their Decided line says "autonomy" (D25, D27, D37, D44, D47, D48), `decided` otherwise, dated by the last date in that line.
- **2. Build reads:** the three Workers answer `crow.build/1` in tests with stand-ins for the assets, the Durable Object and the binding; the deploy tests pass with `--var BUILD_COMMIT:<commit>`. Nothing is deployed, so no live answer is measured yet.
- **3. Guide budget:** a publish build wrote `reports/site-out/guide-budget.json`: the buyer's path 4,988 of 5,000 tokens (9,976 basis points) and the seller's 4,213 (8,426), by the estimate, bytes divided by four, with no key set. The buyer's path is above the console's proposed 98% line.
- **4. Gas per deal:** run as the console's build runs it (a copy with no `node_modules`, `env -i PATH HOME`, Node 22.22.2): `deal-timing.mjs` in 486 ms, `ops-cost.mjs` in 251 ms. 15 Released deals in the 7-day window, all 46 of their Crow-sent transactions' gas read from Sepolia receipts, 0 mismatches with the event log; a deal's own gas 926,312 (median), 1,117,319 with a new visitor's faucet mint and the adjudicators' setup share. The file passed `node scripts/metrics/check.mjs ops-cost`. The console's own build at 07:55 UTC (crow-private Actions job 132382146575) already read 926,312 gas a deal for the deal lanes from `ops-cost.json`.

- **Review** (one `reviewer` pass on `55f930d5`): ISSUES, no Critical or High. Fixed: (Medium) a deal whose transactions carry no gas figure read as a measured 0 in the median and the new source; it now stays out, with a gap line, and the gas reads unknown when no deal has a figure (two new tests). (Low) a failed second token count in `site/check.mjs`'s new block could fail a passing check; it now falls back to the estimate and says so. (Low) D60's status cited no source; it now cites the 2026-11-12 log. (Low) the status words changed after the review began; committed, with the test. Added from its notes: a HEAD test for each `version.json`.

- **Deploys** (Rafa, 2026-11-14: "merge and deploy as appropriate"; each from a detached worktree at `origin/main`, with the repository's own script; measured):

  | Worker | Commit | Version | Replaced | `deployedAt` |
  | --- | --- | --- | --- | --- |
  | crow-test-agents | `c179141` | `13cb42b5-12c3-4579-a0b5-ced3bfab89a9` | `4b675edd-e6bb-4b61-b473-b8305b1b0303` | 2026-11-14T09:29:23Z |
  | crow-early-access | `c179141` | `b33bf8dd-1625-40ee-9a39-a84fc46acbfd` | `99c500b2-c49e-4fb9-8348-083d0b939233` | 2026-11-14T09:29:54Z |
  | crow-site | `b37ea0a` | `27ae8e86-e7ed-4b17-ae5f-c9c003fe96b9` | `f17f3355-2da9-4038-8570-e9440e395232` | 2026-11-14T10:00:08Z |

  - Live checks after the deploys, plain GETs: all four `version.json` addresses answer 200 with `crow.build/1`, `no-store` and the deployed commit. `https://crow.direct/guide-budget.json` answers 200 with `crow.guide-budget/1`: buyer 4,965 of 5,000 tokens (9,930 basis points), seller 4,218 (8,436), by the estimate. The test seller's and test buyer's health and the seller's card answer 200, and the seller reads operational. Early access answers its preflight with 204 and a malformed address with 400, so nothing was stored. The old hosts forward with a 301.
  - The site deploy also carried T-411's and the pilot lane's guide changes, merged on `main`. `try.mjs` and `buy.mjs` hash the same before and after it, so no try command or install line already handed out changed.
  - A full `pnpm verify` before the deploys failed two steps on this Mac: `forge build`, while it fetched the contract libraries into the fresh worktree, and the one test that runs it (`packages/settlement/evm/deploy-script.test.ts`). CI passed both on the same commits [the cause is inferred]. Every other step passed.

## Handoff

**For T-414: the four sources, their paths and shapes.**

1. **Decisions.** File `docs/decisions-today.md` in the holdback checkout. Each entry `## D<n>. <title>` is followed by a blank line and one line matching `^\*\*Status:\*\* (needs Rafa|adopted|decided|deferred|superseded), (\d{4}-\d{2}-\d{2})\.$` (the first non-blank line of the entry's body). The date is the day the entry reached that state; for `needs Rafa` it is the day it started waiting. The smallest change to `parseDecisions` in `control/console.mjs`: read that line from `parts[i + 2]` and add `state` and `since` to the map's value; "the oldest decision that needs you" is the earliest `since` among `needs Rafa`. Pinned by `tests/decisions-status.test.ts`.
2. **Build reads.** Plain unauthenticated GETs, `cache-control: no-store`, `access-control-allow-origin: *`, JSON:
   - `https://crow.direct/version.json` (crow-site)
   - `https://crow.direct/agents/test-seller/version.json` and `https://crow.direct/agents/test-buyer/version.json` (crow-test-agents, the same Worker)
   - `https://join.crow.direct/version.json` (crow-early-access)

   Shape `crow.build/1`, pinned by `apps/site/build-info.schema.json` and `tests/build-info.test.ts`: `{ "schema": "crow.build/1", "worker": "crow-site" | "crow-test-agents" | "crow-early-access", "commit": "<40 hex>" | null, "deployedAt": "<ISO 8601 with ms, UTC>" | null, "versionId": "<UUID>" | null }`. `commit` is filled by the deploy; `deployedAt` is the time Cloudflare created the live version, at its upload (after a rollback, the older version's). The site's answer keeps the `commit` key the console reads today. Until each Worker is deployed, the site's version.json still reads `{ "commit": … }` only and the other two answer 404.
3. **Guide budget.** `https://crow.direct/guide-budget.json`, written by `site/check.mjs` at each publish build (so it changes only with a site deploy). Shape `crow.guide-budget/1`, pinned by `site/guide-budget.schema.json` and `tests/guide-budget.test.ts`: `{ schema, generatedAt, commit | null, budget: { tokens, model }, paths: [{ role: "buyer" | "seller", files, bytes, tokens, estimate, counted | null, method: "estimate" | "count_tokens", budgetBps }] }`. `budgetBps` is tokens over the budget in basis points, rounded down; the guide-budget signal is `budgetBps / 100` per role against the 98% line.
4. **Gas per deal.** The hourly build already writes `<out>/metrics/ops-cost.json`. The gas a deal uses is `perDeal.gas.dealGas.median` (a deal lane's own) and `perDeal.gas.totalGas.median` (with a new visitor's mint and the setup share), decimal strings; beside them `perDeal.gas.source`: `{ basis: "measured", from: "receipts" | "event log" | "receipts and event log", deals, receiptTxs, eventLogTxs, mismatches, window: { from, to } | null, newestDealAt }`, or null when no deal was measured. The schema stays `crow.metrics.ops-cost/1`; the field is optional, so an older file still validates. Once the console reads it, `steering.json`'s `parameters.gasPerDeal` is needed only as the fallback for a week with no Released deal (for example right after a contract redeploy, which starts a new event log).

**What each deploy would change, and the GET that checks it afterwards.** All three wait for Rafa.
- **Site** (`pnpm site:deploy`): the Worker binds its version metadata and answers `/version.json` with the full `crow.build/1` shape, and the build publishes `guide-budget.json`. Check: `curl -s https://crow.direct/version.json` names the deployed commit and a `deployedAt` from the deploy's minute; `curl -s https://crow.direct/guide-budget.json` reads `crow.guide-budget/1`.
- **Test agents** (`pnpm -C apps/test-agents deploy`): the Worker binds its version metadata, gets `BUILD_COMMIT`, and answers the two `version.json` paths before the Durable Object. Check: `curl -s https://crow.direct/agents/test-seller/version.json` names the deployed commit.
- **Early access** (`node apps/early-access/deploy.mjs`, new; it replaces `npx wrangler@4 deploy --config apps/early-access/wrangler.jsonc` in `docs/operations.md`, which a plain upload would leave at a null commit): the Worker binds its version metadata, gets `BUILD_COMMIT` and answers `/version.json`; the script waits until it names the commit and rolls back otherwise. Check: `curl -s https://join.crow.direct/version.json` names the deployed commit.

**The one field the operators lack** (T-409's lane, `apps/demo-cloud/`): discovery's `demo.build` has `commit` and no deploy time. Add `demo.build.deployedAt` from Cloudflare's version-metadata binding (`"version_metadata": { "binding": "CF_VERSION_METADATA" }` in both operators' wrangler files, then `env.CF_VERSION_METADATA.timestamp`), in the same ISO form as `apps/site/build-info.js`.

**Follow-ups, not built here:**
- `docs/api.md` line 503 describes the site's `version.json` as `{ "commit": … }`; it now carries the full `crow.build/1` shape (outside this lane).
- `docs/operations.md` line 52 names the plain wrangler command for early access; it should name `node apps/early-access/deploy.mjs` (outside this lane).
- The test agents' deploy checks health and the agent card, not `version.json`; it could also wait until `version.json` names the commit, as early access's does.
- The buyer's first-deal path is at 99.76% of its 5,000-token budget by the estimate (measured above): the guide-budget signal will read outside the 98% line once the console reads it.
- New entries in `docs/decisions-today.md` need a status line; T-415 (one new entry today) was told on 2026-11-14.
