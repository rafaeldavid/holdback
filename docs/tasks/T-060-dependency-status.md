# T-060: Crow Control shows the status of Crow's service dependencies

- **Lane:** infra
- **Phase:** 9
- **Depends on:** T-059, the console at `control.escrow.stream` (live since 2026-11-04).
- **Paths this task may touch:**
  - the `control/` folder in the founders' private repository: `console.mjs`, `console.html`, `build-public.mjs`, the tests and the README. The console's code lives there, never here.
  - here: `docs/tasks/T-060-dependency-status.md`, `docs/plan.md` (this row) and `docs/update-flow.md` (only if a flow changes).
- **Human gate:** yes, for the deploy only. The Worker bundles `console.html`, so a page change goes live with a crow-console deploy, on Rafa's go-ahead. The data part arrives with the next hourly push.
- **Status:** review: the code is on the private repository's `main`; the crow-console deploy waits for Rafa (human gate)
- **Agent/session:** the T-060 session, 2026-11-04

## Intent

Rafa, 2026-11-04: "Can you add a ticket to update Crow Control to import status for service dependencies (Cloudfare, Github, etc.)?"

Restated: the console's Status box checks Crow's own components today: the site, the agent docs, both API nodes, Sepolia, the relayer's funding lane, early access, CI on main and the judges. When one of them fails, the cause is often a provider Crow runs on. So the console also shows each dependency's own published status, maps each one to the Crow components it affects, and names a likely cause on an alert.

The example that prompted it: on 2026-11-04, GitHub Actions reported degraded performance and an incident. The hourly console refresh skipped its 18:17 and 19:17 UTC runs, and the console showed only that its data had gone stale, not why.

## Context

- The Status box and its live recheck: `control/README.md` in the private repository. The Worker's CSP narrows `connect-src` to the Sepolia RPC (red-team finding L5), so the page itself cannot fetch status pages.
- The hourly job: its `build` job holds no secrets and may fetch public URLs; its `push` job holds the push token (red-team finding M2).
- Red-team finding L10: every value the console renders goes through `esc()`, every link through `href()` (https or `#` only), and every class name through `cls()`.
- `docs/costs.md` lists the accounts Crow runs on.

## The dependencies, to confirm in the task

Most providers publish a Statuspage summary at `/api/v2/summary.json`. Each URL below is a candidate to confirm before use (guessed until checked):

| Dependency | What depends on it | Candidate status source |
| --- | --- | --- |
| Cloudflare (Workers, Durable Objects, KV, Access, DNS) | The site, both API nodes, the demo world, the test seller, the console and its sign-in | `https://www.cloudflarestatus.com/api/v2/summary.json` |
| GitHub (Actions, Git operations, API) | CI on main, the hourly console refresh, merges and the agents' work | `https://www.githubstatus.com/api/v2/summary.json` |
| Anthropic API | The live judge panel's Anthropic seat, and the agents | `https://status.anthropic.com/api/v2/summary.json` |
| DeepSeek API | The live judge panel's DeepSeek seat | its status page (format to confirm) |
| Sepolia RPC providers | Settlement reads and every relayed transaction | no status page: keep the console's own RPC check, and add each configured provider's own page if it has one |
| drand quicknet | Fallback and appeal decisions once T-217 is live | the League of Entropy's endpoints or status page (to confirm) |
| npm registry | `try.mjs`'s one command installs viem and tweetnacl | `https://status.npmjs.org/api/v2/summary.json` |

## Acceptance criteria

- [x] **Fetched at build time.** The hourly `build` job fetches each source with a timeout of 5 s or less and a size cap. A failed or slow source shows as "unknown" and never fails the build. No secret is involved, and the page's CSP does not widen.
- [x] **Shown in the Status box,** under a "Dependencies" group, one row per dependency:
  - its overall indicator (operational, minor, major, critical or unknown);
  - each active incident's title, status and start time, with its link;
  - the relevant components only, for example GitHub's Actions, Cloudflare's Workers, Durable Objects and Access;
  - the time it was read, so a stale reading is visible.
- [x] **Mapped to Crow's components.** (The table is in `control/deps.mjs`, which `console.mjs` imports: Decisions 1.) A table in `console.mjs` maps each dependency's components to the Crow checks they affect. When a Crow check fails or its data is stale while a mapped dependency has an incident, the alert names it as the likely cause: for example, "Hourly refresh missed 2 runs; GitHub Actions reports an incident (degraded performance)".
- [x] **Untrusted input.** Status-page text is third-party data. It is rendered as text through `esc()`, never as HTML, with lengths capped. Links go through `href()` and are https only. The red team's hostile-data fuzz covers the new fields and finds no raw value. (Met by the tests' hostile-data fuzz; Rafa dropped the red-team pass as overkill, 2026-11-04.)
- [x] **Tests.** Fixtures of real Statuspage JSON (operational, a minor incident, a major outage, malformed JSON, a timeout). Map tests for the likely-cause line. All the console's tests pass.
- [x] **Docs.** The private repository's `control/README.md` lists the sources and the map. This file's Evidence holds the measured fetch times and a screenshot or text dump of the new rows.
- [ ] **Deploy,** on Rafa's go-ahead: crow-console, then one hourly run, checked live.

## Out of scope

- Paging or alerting outside the console (T-054 and T-055 own alerts that reach Rafa).
- Fetching status pages from the browser, which would widen the CSP.
- A status page for Crow itself; the Status box already plays that part.

## Evidence

Labels: measured, inferred, guessed. Times are UTC unless a line says local; the previews ran in UTC+1.

**The code** is in the private repository `rafaeldavid/crow-private`, folder `control/`, commits 0fbbe45 to 16b649a on `main` (measured):
- `deps.mjs` (new): the sources, the map from each dependency's parts to Crow's checks, the reader and the likely causes. A plain, deterministic script: no model call and no inference (Rafa, 2026-11-04: "keep it very simple, pull directly from their service deterministically, script pure, no inference").
- `console.mjs`: the hourly build reads every dependency at once, beside its own checks. It puts them in `public.json` as `status.deps`, and their states in `status.json`.
- `console.html`: the Dependencies group, the Hourly refresh row, and the likely cause on each failing check.
- `build-public.mjs`: the job log keeps the `dependencies` lines with each source's state and fetch time.
- `README.md`: the sources, the map and the rules, under "Dependencies".
- `test/deps.test.mjs`, `test/deps-page.test.mjs`, `test/deps-fixtures.mjs` and `test/fixtures/deps/` (new).

**Sources, confirmed by one fetch each from the Mac with curl, 2026-11-04 about 20:44** (measured):

| Dependency | Source | Answer | Size | Time |
| --- | --- | --- | --- | --- |
| Cloudflare | `www.cloudflarestatus.com/api/v2/summary.json` | 200, Statuspage | 227 KB | 155 ms |
| GitHub | `www.githubstatus.com/api/v2/summary.json` | 200, Statuspage | 4.3 KB | 36 ms |
| Anthropic API | `status.anthropic.com/api/v2/summary.json` | 301 to `status.claude.com`, which answers 200, Statuspage | 2.2 KB | 48 ms |
| DeepSeek API | `status.deepseek.com/api/v2/summary.json` | 404 `RouteNotFound`: a Flashduty page. `feed.rss` answers 200 with one item per incident | 18.9 KB | about 1 s |
| npm | `status.npmjs.org/api/v2/summary.json` | 200, Statuspage | 2.4 KB | 168 ms |
| Sepolia RPC | `status.tenderly.co/api/v2/summary.json` (839 components; "Node RPC" in its Sepolia group); publicnode has no status page (`status.allnodes.com` does not resolve) | 200 | 275 KB | 203 ms |
| Sepolia RPC | `eth_getBlockByNumber` on publicnode and the Tenderly gateway | 200 | 12.4 KB | 62 ms and 95 ms |
| drand quicknet | `/<quicknet hash>/public/latest` on api2.drand.sh, drand.cloudflare.com, api.drand.sh, api3.drand.sh | 200 | 209 B | 90 ms to 710 ms |

**Fetch times inside the build** (measured, `build-public.mjs --root <holdback> --out reports/scratch/t-060-build` on the Mac, 2026-11-04 21:04 UTC, each source in parallel, all seven read Operational): Cloudflare 115 ms, GitHub 43 ms, Anthropic 66 ms, DeepSeek 1,355 ms, npm 100 ms, Sepolia RPC 490 ms, drand 967 ms. A second run at 21:09 UTC: 121, 41, 48, 867, 77, 357 and 768 ms. The slowest source sets the added wait, so the build waits about 1.4 s more, and at most 5 s, the timeout (inferred from the parallel reads; tested with a source that never answers: `readDeps` returned in under 1.5 s with a 0.4 s timeout). The dependency data adds 6.4 KB to `public.json`; `status.json` grows from 9 to 16 states, under the Worker's 64 (measured).

**Tests** (measured): 77 of 77 pass. `node --test` on `worker-access`, `redteam-regressions`, `recheck-regressions`, `deps` (26) and `deps-page` (11):
- operational summaries for all five Statuspage sources, real;
- three real GitHub incidents from its `incidents.json`, put back on the real summary at their first update: a minor one (Git Operations, 2026-11-03), a major one (Actions, 2026-11-04 17:40 UTC, the incident behind the skipped hourly runs) and a critical one (Git Operations and Actions, 2026-10-07). Also a real Cloudflare Durable Objects incident (2026-11-03), matched by component ID;
- malformed bodies (truncated JSON, the wrong shape, HTML, empty, `null`), HTTP 503, 404 and 301, a fetch that throws, a source that never answers or stalls mid-body (timeout), and a body over the cap with and without a content-length (it stopped reading after under 16 MiB of 64 MiB, at a 256 KiB test cap);
- the DeepSeek feed, real, and its latest item reopened; RSS that would be quadratic (170,000 unclosed `<item>` tags, 900,000 `<`) reads in under 1.5 s;
- the likely-cause line: "Hourly refresh missed 2 runs; GitHub Actions reports an incident (partial outage)", from the real 17:40 incident;
- the page's own dependency block run in a fresh V8 context on 40 shuffles of hostile data that skip the reader: only allowlisted tags and attributes, every `href` https or `#`, no control or direction character, every row under 64 KB;
- the unchanged Worker takes `public.json` with `status.deps` and `status.json` with the dependency states, and serves both. Its `connect-src` stays `https://ethereum-sepolia-rpc.publicnode.com`, and no status URL is in the page.

The page test found one fault before review: JSON's `{"toString": 1}` made `pick()` and `Number()` throw, which would stop the Status box. The new block passes them strings and numbers only.

**The new rows, from live data** (measured, `console.mjs --private-slot --no-gh --out` preview, read in the browser pane, 2026-11-04 21:09 UTC; local times):

```
Hourly refresh  ● Operational
GitHub Actions, at 17 min past each hour · on time: built at 22:09

Dependencies
The published status of the services Crow runs on, read by the hourly build at 22:09. This page never fetches them. All 7 report no trouble.
Cloudflare  ● Operational
  Workers, Workers Assets, Durable Objects, Workers KV, Access, Authoritative DNS: operational
  Its page overall: major, Partial System Outage
  Affects Site, Agent docs, API node 1, API node 2, Early-access sign-ups, Hourly refresh
  read 22:09 in 121 ms · Status page
GitHub  ● Operational
  Actions, Git Operations, API Requests: operational
  Affects CI on main, Hourly refresh
Anthropic API  ● Operational
  Claude API (api.anthropic.com): operational · Affects Judges
DeepSeek API  ● Operational
  API: operational · Affects Judges
npm  ● Operational
  Package installation: operational · Affects CI on main
Sepolia RPC  ● Operational
  Node RPC: operational
  publicnode: latest block 3 s old · Tenderly gateway: latest block 15 s old
  Affects API node 1, API node 2, Settlement on Sepolia, Relayer funding lane
drand quicknet  ● Operational
  api2.drand.sh, drand.cloudflare.com, api.drand.sh, api3.drand.sh: round 33674400, current
  Affects no Crow check yet. Fallback and appeal decisions, read by the adjudicator (T-217)
```

**The same rows during the 17:40 GitHub incident, with data 150 min old** (measured, a preview from saved responses through `--deps-from`, with the real incident at its first update and the build time moved back 150 min; the dependency readings kept their own time, 22:06 local):

```
Status  ◆ Degraded · 1 unknown
CI on main is unknown; GitHub Actions reports an incident (partial outage)
Hourly refresh missed 2 runs; GitHub Actions reports an incident (partial outage)

Hourly refresh  ◆ Degraded
GitHub Actions, at 17 min past each hour · missed 2 runs since the build at 19:36
Likely cause: GitHub Actions reports an incident (partial outage) · read 22:06

GitHub  ◆ Degraded
  Actions: partial outage · the rest operational
  Its page overall: major, Partial System Outage
  • Incident with Actions · investigating · started 18:40
  Affects CI on main, Hourly refresh
```

CI on main reads unknown in that preview because it ran with `--no-gh` (measured).

**No red-team pass.** Rafa, 2026-11-04: "I don't think a red team pass is necessary for updating text on the Crow Control? That feels overkill". A red-team subagent was started and then stopped before it reported; it confirmed nothing (measured: no report). The safeguards stand: every new value goes through `esc()`, every link through `href()` (https or `#`), every class through `pick()` and `cls()`, with lengths capped, and the hostile-data tests above pass.

## Decisions

1. **The map lives in `control/deps.mjs`, not in `console.mjs`.** `console.mjs` runs the whole build when imported, so no test can import a table from it. `console.mjs` imports `deps.mjs`, and the tests check every ID and check name.
2. **A row's state follows the parts Crow uses; the page's own indicator is shown as text.** Cloudflare's page counts some 330 data centres. It read "major, Partial System Outage" while every part Crow uses was operational (measured 2026-11-04). An open incident on a part Crow uses makes the row at least Degraded, and Down when its impact is critical. An incident that names no part shows on the row and among the causes, but leaves the state alone: GitHub lists Copilot incidents with no component (measured).
3. **DeepSeek is read from its RSS feed.** Its Flashduty page serves no `summary.json`. Each feed item is one incident with its latest status and affected components; a part is in trouble when an open incident names a component containing "API".
4. **The Sepolia RPCs and drand are read at their own endpoints.** Neither publicnode nor the League of Entropy publishes a status page. The build reads the latest block on both public RPCs (Degraded over 120 s old) and the latest quicknet round on the adjudicator's four relays (Degraded over 10 rounds, 30 s, behind). One source down reads Degraded; all of them down reads Down, since the API nodes and the adjudicator fall back from one to the next. Tenderly's own status page is read too.
5. **The likely cause shows in the Status box, not in the Alerts section.** Alerts lists work incidents (PRs and tasks) built at build time, and a stale refresh is only known in the browser. The alert lines sit under the Status banner, and each failing check carries a "Likely cause" note. With no cause, the note names the dependencies that report no incident and those the build could not read.
6. **The Hourly refresh row.** The browser works it out from the data's age. A run counts as missed 30 min after its hour, since GitHub may start a scheduled run late; six or more missed runs read Down. A local preview is no hourly build, so it has no such row.
7. **No redirect is followed.** The build reads `status.claude.com` directly; a source that moves reads "unknown" with "moved (HTTP 301)".

## Handoff

- **State:** the code and tests are pushed to `rafaeldavid/crow-private` `main`. The page change is not live: it needs a crow-console deploy, which waits for Rafa. The data arrives with the next hourly run: the old page ignores `status.deps`, and `status.json` carries 7 more states the old page does not draw (inferred from the old page's code).
- **To deploy (Rafa's go-ahead):** `npx wrangler@4.151.3 deploy --config /Users/rafa/Documents/escrow/reports/crow-private/control/wrangler.access.jsonc`. Then check one hourly run: its log's `dependencies` line, and the Dependencies group and Hourly refresh row on control.escrow.stream. Roll back with `npx wrangler@4.151.3 rollback <version> --name crow-console`.
- **Preview an incident:** `node /Users/rafa/Documents/escrow/reports/crow-private/control/console.mjs --root <holdback> --private-slot --no-gh --deps-from <dir> --out <file>`; the runbook names the files.
