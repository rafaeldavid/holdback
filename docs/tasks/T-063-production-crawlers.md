# T-063: Production bug crawlers

- **Lane:** demo (with api for the synthetic bucket and infra for the timer)
- **Phase:** 10
- **Depends on:** T-039 (the `crawler` user and the VM); T-041 (`intake.mjs`, deduplication, the records folder); T-054 (the relayer floor the crawler reads); T-060 (the dependency map and status sources, deployed 2026-11-04). The crawler's `--once` mode depends on nothing unmerged, so it can ship first and serve as the post-deploy smoke test.
- **Paths this task may touch:** `tools/crawler/crawl.ts` (new), `tools/crawler/probes/*.ts` (new), `tools/crawler/crawl.test.ts` (new), `tools/crawler/README.md` (new), `agent-ops/ops.yaml` (the `crawler` block, only to match what this task builds; after T-040), `agent-ops/schemas/triage-record.schema.json` (the `crawler` source and the `probe`, `likelyCause` and `seenCount` fields; coordinated with T-041), `agent-ops/pipeline.md`, `agent-ops/gates.md`, `agent-ops/teams.md` and `agent-ops/README.md` (only to correct the design text of 2026-11-05 to what this task builds), `apps/demo-cloud/src/telemetry.ts`, `apps/demo-cloud/src/world.ts` and `apps/operator/src/server.ts` (the `X-Holdback-Synthetic` header and the `synthetic` bucket only; api lane, tier 2), `apps/demo-cloud/src/world.test.ts` (the two-bucket test), `docs/api.md` (one paragraph on the header), `scripts/dev-env/vm-users.sh` and `tests/dev-env.test.ts` (the `crawler` user and its timer; after T-039), `docs/operations.md` (the post-deploy smoke test), `docs/backlog.md` (narrow the "Reliable production maintenance" row), root `package.json` (a `crawl` script), `docs/tasks/T-063-production-crawlers.md`
- **Human gate:** **yes** for the systemd timer on the VM, the deploy of the synthetic bucket, the weekly probes (an appeal, the `Prefer` flow, a private deal, the vanilla visitor), and the push of the crawler's last record to the console. No for the code, and no for `crawl.ts --once`, which a deploy session may run after a deploy as it runs today's smoke steps. A PR that touches `agent-ops/` is tier 3, so Rafa merges it.
- **Status:** todo
- **Agent/session:** —

## Intent

Rafa, 2026-11-05: "And for 'tickets' we should have agent crawlers looking for bugs in production environment".

Restated: a process keeps exercising the live demo the way a visitor's agent does, with fresh keys and the faucet. It compares what is deployed with the docs, and each operator with the other. When something fails or disagrees with the docs, it files a TriageRecord with a stable fingerprint and a likely cause, never a public issue.

- **Inputs:** the live site, `llms.txt`, `try.mjs`, both operators, the test seller, the problem pages, the console's gate, Sepolia reads, and T-060's dependency status.
- **Outputs:** TriageRecords with `source: crawler`; a run history of counts; the post-deploy smoke test.
- **Non-goals:** load testing; anything a visitor would not leave behind (feedback, sign-ups, direct contract calls, registrations); alerts to Rafa (T-054 and T-055 own the relayer and cost alerts, and T-047 owns pipeline alarms).

## Context

- The design: `docs/research/2026-11-05-simulation-and-watch.md`, section 4 and threats P15, P16 and P19; `agent-ops/pipeline.md`, Production crawlers.
- `site/check.mjs` keeps the repository's agent docs consistent before a publish; the crawler runs the live equivalents. `site/build.mjs`: `tryCommand`, `trySha256`, `problemPages`, `TEST_SELLER_URL`.
- `examples/e2e-run.ts` and `e2e-round.ts`: records, `summary.md`, `printable()`, `assertRoundChain`, the finality re-read. The round's rule that a deal left open stops the run (T-216 Decision 12).
- Limits (measured): the faucet's 10 grants per client IP an hour and one per address an hour; the operators' 120 writes and 1,200 reads a minute; the test seller's 3 requests per client an hour and 10 a day; a relayed deal's 1,636,242 gas plus a faucet mint of 130,000 to 240,000 gas; T-054's funding-lane floor of 0.05 Sepolia ETH.
- `docs/operations.md`: today's post-deploy smoke steps (`deal.ts`, then `try.mjs` each way); T-031's day lines; invocation logs are off, so a `User-Agent` reaches no stored log.
- `docs/backlog.md`, "Reliable production maintenance and self-healing for the hosted demo" (Rafa, 2026-11-01): this task delivers its scheduled checks.

## Acceptance criteria

- [ ] `node tools/crawler/crawl.ts --once [--deals 0|1] [--site <url>] [--operators <a,b>] [--seller <url>]` runs the read-only probes R1 to R12 of the design note and, with `--deals 1`, the deal probe D1. It prints one state line per probe (Operational, Degraded, Down or Unknown; what, where and since when; the next action). It writes a run record of counts, status codes, problem types, booleans, durations and transaction hashes under `reports/crawler/`, or `/srv/crow/crawler/` on the VM, and never a response body or a party's text. A test plants a hostile seller card and a hostile problem detail and finds neither in any output or record.
- [ ] Each probe is a module in `tools/crawler/probes/` with a fixed `summary` template of enums and numbers, an owner lane, a severity rule (P1 when the one command fails or the operators disagree, P2 for a docs disagreement, P3 with a likely cause) and a fingerprint of the probe ID, the failure class and the normalized status or problem type. `pnpm vitest run tools/crawler/crawl.test.ts` runs every probe against the in-process demo world on two origins, a fixture site served locally and the in-process test seller. It shows each probe passing on a consistent deployment and failing on one planted drift: a `try.mjs` whose sha256 differs from the command's, operators on different schema versions, a seller card whose limits differ from `llms.txt`, a problem type without a page, and `escrow.stream/control` answering 200.
- [ ] D1 runs the one command verbatim as parsed from the live `llms.txt`, in a fresh temporary folder, with `cwd` set on the child process: `npm install` with the pinned versions, `curl -fsSLO`, `shasum -a 256 -c`, then `node try.mjs --seller`. It passes only when the deal ends Released with 3 rows decrypted and both operators serve the same final state and event count. D2 (`--outcome refund`) runs every third deal pass, and D3 (self-play) once a day. Tested against the in-process world with the bundle that `site/build.mjs` makes.
- [ ] Budgets and cadences come from `ops.yaml`'s `crawler` block (`read_pass_min`, `deal_pass_hours`, `deals_per_day`, `requests_per_pass`, `max_request_rate_per_origin`, `weekly_probes`), and a test shows that a changed value changes the behaviour. The crawler honours `Retry-After` on every 429, never retries a deal probe within the hour, runs probes one at a time, and skips the deal probe while the funding lane reads under T-054's floor or within an hour of a `relay_refused` answer, recording "relayer low". Each rule is tested with a stand-in operator.
- [ ] Test tokens only: `assertRoundChain` runs before any write, and a status that names another chain stops the run with exit code 3 (tested with a stand-in that answers chain 1).
- [ ] No side effects: the only `POST` outside a deal is `/v1/feedback?validateOnly=true`. The crawler never submits the early-access form, never calls `/v1/appeals` outside the weekly set, never calls the contract directly and never registers an adjudicator. A test records every request the crawler makes against the stand-ins and checks the list.
- [ ] Records: a failure writes a TriageRecord with `source: crawler`, `probe`, `kind`, `lane`, `severity`, `fingerprint`, `summary`, `likelyCause` and `needsRaw: false`, matching the schema. When a mapped dependency has an active incident in T-060's summaries, the record sets `likelyCause`, sets `duplicateOf` to the incident's fingerprint and takes severity P3. A repeat raises `seenCount`, and three consecutive passes close the record as recovered. Tested on a sequence of fixture runs. The vanilla-visitor probe's friction goes to the quarantine as untrusted text, never into a record field.
- [ ] The synthetic bucket (api lane, tier 2): requests carrying `X-Holdback-Synthetic: crawler` count under `synthetic` in the day line instead of `deals.*`, `signers.*` and `conversion.*`. `apps/demo-cloud/src/world.test.ts` plays one marked and one unmarked deal and checks both buckets. `docs/api.md` documents the header in one paragraph as an operator convention. Decisions records whether the header needs a schema bump or an ADR. This criterion applies only if Rafa chooses the header (open question 2).
- [ ] `vm-users.sh` adds the `crawler` user with no token, its systemd timer (read pass every 30 minutes, deal pass every 8 hours, the weekly set on Sunday 03:00 UTC) and write access to `/srv/crow/intake/` and `/srv/crow/crawler/`. `tests/dev-env.test.ts` checks it on the fixture root. The timer stays inert until Rafa approves it (README Activation step 6c).
- [ ] `docs/operations.md` names `node tools/crawler/crawl.ts --once --deals 1` as the post-deploy smoke test in place of the hand-run `deal.ts` and `try.mjs` steps, and `tools/crawler/README.md` states what the crawler may and may not do. `pnpm verify` passes.
- [ ] Measured in Evidence: one `--once --deals 1` run against the live demo after a deploy, with its record and the gas of its deal.

## Out of scope

- Alerting Rafa (T-054, T-055, T-047); the mechanism for pushing the crawler's last record to the console (recorded for Rafa in Handoff); a status page for Crow (the console's Status box plays that part, T-060).
- Load or soak testing of any kind.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics: requests per read pass; gas per deal probe; Durable Object requests a day from the crawler (from the day line's `synthetic` bucket, once deployed).

## Decisions

Choices made inside this task. Escalate anything that changes architecture, a contract or a defense to an ADR. Record here: the VM over GitHub Actions as the crawler's home (the design note's section 4.3), and whether the synthetic header needs an ADR.

## Handoff

What is done, what is not, how to resume, and the open questions that remain. Open questions for Rafa: the timer, the synthetic header and its deploy (design note question 2), the weekly probes (question 4), and the console push.
