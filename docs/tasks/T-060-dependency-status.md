# T-060: Crow Control shows the status of Crow's service dependencies

- **Lane:** infra
- **Phase:** 9
- **Depends on:** T-059, the console at `control.escrow.stream` (live since 2026-11-04).
- **Paths this task may touch:**
  - the `control/` folder in the founders' private repository: `console.mjs`, `console.html`, `build-public.mjs`, the tests and the README. The console's code lives there, never here.
  - here: `docs/tasks/T-060-dependency-status.md`, `docs/plan.md` (this row) and `docs/update-flow.md` (only if a flow changes).
- **Human gate:** yes, for the deploy only. The Worker bundles `console.html`, so a page change goes live with a crow-console deploy, on Rafa's go-ahead. The data part arrives with the next hourly push.
- **Status:** in progress (the code is in the private repository's `control/` folder; the deploy waits for Rafa)
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

- [ ] **Fetched at build time.** The hourly `build` job fetches each source with a timeout of 5 s or less and a size cap. A failed or slow source shows as "unknown" and never fails the build. No secret is involved, and the page's CSP does not widen.
- [ ] **Shown in the Status box,** under a "Dependencies" group, one row per dependency:
  - its overall indicator (operational, minor, major, critical or unknown);
  - each active incident's title, status and start time, with its link;
  - the relevant components only, for example GitHub's Actions, Cloudflare's Workers, Durable Objects and Access;
  - the time it was read, so a stale reading is visible.
- [ ] **Mapped to Crow's components.** A table in `console.mjs` maps each dependency's components to the Crow checks they affect. When a Crow check fails or its data is stale while a mapped dependency has an incident, the alert names it as the likely cause: for example, "Hourly refresh missed 2 runs; GitHub Actions reports an incident (degraded performance)".
- [ ] **Untrusted input.** Status-page text is third-party data. It is rendered as text through `esc()`, never as HTML, with lengths capped. Links go through `href()` and are https only. The red team's hostile-data fuzz covers the new fields and finds no raw value.
- [ ] **Tests.** Fixtures of real Statuspage JSON (operational, a minor incident, a major outage, malformed JSON, a timeout). Map tests for the likely-cause line. All the console's tests pass.
- [ ] **Docs.** The private repository's `control/README.md` lists the sources and the map. This file's Evidence holds the measured fetch times and a screenshot or text dump of the new rows.
- [ ] **Deploy,** on Rafa's go-ahead: crow-console, then one hourly run, checked live.

## Out of scope

- Paging or alerting outside the console (T-054 and T-055 own alerts that reach Rafa).
- Fetching status pages from the browser, which would widen the CSP.
- A status page for Crow itself; the Status box already plays that part.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
