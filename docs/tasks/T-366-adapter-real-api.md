# T-366: the seller adapter talks to a real seller API

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-318, T-329, T-331, T-359
- **Paths this task may touch:** `examples/seller-adapter.ts`, its tests and stubs (`examples/seller-adapter*.test.ts`, `examples/seller-adapter*-stub.ts`), `examples/seller-adapter.config.json`, `examples/seller-adapter.template.json`, the service recipe files (`examples/seller-adapter-service.md`, `examples/seller-adapter.Caddyfile`, `examples/seller-adapter.service`), `site/sell.txt` except "A seller's client can carry the buyer's side", `vitest.config.ts` (one cost line for the new test file), this file. Added: `examples/seller-adapter-api.ts` (the mapping and the credential, beside the adapter), `examples/seller-adapter-job-stub.ts`, `examples/seller-adapter-job-api.test.ts`, `examples/seller-adapter.job-api.config.json`
- **Human gate:** no (the site deploy that publishes the page is Rafa's)
- **Status:** done (PR 383, merged 2026-11-12 at 06:52 UTC as `00be274`)
- **Agent/session:** T-366 implementer, change kind 4 (tooling), roadmap row N85

## Intent

A seller who already runs an HTTP job API should reach a delivered deal by writing one configuration file, with no helper service between the adapter and its API. Today the adapter assumes one API shape: no credential, fixed quote and start bodies, one result call that returns one file, and HTTP 202 for a running job. A seller whose API differs writes and runs a translating service, and that costs it hours in a pilot where its hours are the measure.

This task makes each of those assumptions a setting in `sellerApi`, read from the configuration file, with today's behaviour when the setting is absent:

1. **A credential.** The file names an environment variable, a header and an optional prefix. The adapter reads the value at start, sends it only to the seller's API, and never logs it or writes it to the journal. A named variable that is unset stops the start.
2. **Request mapping.** Each of the quote, start and result calls takes a method, a path under one base URL, headers and a JSON body template, filled from a fixed set of named values (the scope and its fields, the options, the deal's ID, the quote's ID, the job's ID, the buyer's address). Answers are read with JSON pointers. Nothing in the mapping runs: placeholders are names, not expressions. A configuration or an answer that would send a request outside the base URL is refused.
3. **A running job,** read by HTTP status or by a status field and the values that mean running, done and failed. A failed job is reported once and never delivered.
4. **An idempotency key on the start,** under a configured header, from the deal's ID, so a restart never starts a second job.
5. **More than one file per result:** a pointer to a list of file paths inside the result, a path template to fetch each, and the field where each file's path and content are added before the checks run. Count and total size are capped by the configuration, never above the delivery cap of 1,048,576 bytes. A path outside the base URL or a repeated path is refused; a file that fails to fetch holds the delivery and alerts, as a refused check run does.
6. **The Caddyfile** forwards `GET /defaults` as well as `POST /quote`.
7. **The seller's page** (`site/sell.txt`) says how to configure these five things instead of telling the seller to run a helper service.

Inputs: the configuration file and the environment. Outputs: the same signed offers, starts and deliveries as today, against an API of another shape.

Non-goals: a template language, expressions or scripts in the mapping; price conversion (the API still prices in base units of the settlement layer's token); OAuth or token refresh; a payout address (R6c-3); changes in `packages/` or `apps/`; any live run or deploy.

## Context

- `examples/seller-adapter.ts` (T-318, T-323, T-329, T-330, T-331), `examples/seller-adapter-service.md` (T-324), `site/sell.txt` (T-359).
- Hard rules: secrets from the environment only; no code execution from configuration or deliverables; idempotency on every mutating call.

## Acceptance criteria

- [x] Tests against a second stub of another shape (quote by POST at another path, a start that returns a job ID, a job read by GET with a status field, files fetched one by one), driven only by a configuration file: a quote becomes a signed offer; a funded deal starts one job, across a restart too; a running job is polled; the result with its extra files is checked and delivered once.
- [x] Each refusal has a test: an unset credential variable, a mapping URL outside the base URL, an answer that would leave it, an unknown placeholder, a failed job, a repeated or escaping file path, too many files or bytes, a file that fails to fetch.
- [x] The credential appears in no log line and no journal entry.
- [x] The existing seller adapter tests pass with no configuration change.
- [x] `pnpm typecheck`, `pnpm test`, `pnpm lint` and `node site/build.mjs && node site/check.mjs` pass.

## Out of scope

- A payout address in the adapter (R6c-3, on `contracts-audit-ready`).
- The section "A seller's client can carry the buyer's side" of `site/sell.txt`, and `site/llms.txt` (T-368).

## Evidence

All on branch `t-366-adapter-real-api`, 2026-11-12, macOS. Tests named are in `examples/seller-adapter-job-api.test.ts` unless another file is given.

| Item | What shows it | Label |
| --- | --- | --- |
| 1. Credential | "a quote becomes a signed offer…" (the stub sees `X-Api-Key` on every request, and the key is in no log line and not in the journal); "a funded deal…" and "a file that fails to fetch…" check the log and the journal again; "stops at start when the credential's variable is unset…" (the start stops before any request) | measured |
| 2. Request mapping and the base URL | "a quote becomes a signed offer…" (mapped body, price, `deliverWithinSec` and `validForSec` read by pointers); "refuses a mapping that could send a request outside the base URL…"; "refuses a placeholder outside the fixed list…"; "refuses a header that would replace the credential…"; "a job ID that would climb out of the base URL is refused…"; "a redirect is refused…" | measured |
| 3. Running job | "a funded deal…" (read while `queued` and `running`); "reads the job state by HTTP status…"; "a failed job is reported once and never delivered" | measured |
| 4. Idempotency key | "a start whose answer is lost, then a restart, starts one job under the same key and delivers once" | measured |
| 5. More than one file | "a funded deal… adds its files, and delivers once"; "a file that fails to fetch holds the delivery and alerts…"; "refuses a file list that repeats, climbs out, or is too long, and files over the byte limit"; "adds base64 content…"; "refuses file limits above the delivery cap…" | measured |
| 5, with a report mapping | "with a report mapping too, the mapping converts the result with its files…": the review's High finding (the mapping converted the raw result and dropped the files), fixed | measured |
| 6. Caddyfile | "the shipped job-API example loads…; the Caddyfile forwards /defaults" | measured |
| 7. Seller's page | `node site/build.mjs && node site/check.mjs`: PASS | measured |
| Mandate before the price (from the coordinator, a review Low with no owner) | `examples/seller-adapter.test.ts`, "refuses a quote with 503 when the mandate has ended, and asks the seller API for no price": the stub counts one quote call, from the quote before the mandate ended | measured |
| Today's sellers unaffected | `examples/seller-adapter.test.ts`, `seller-adapter-terms.test.ts` and `audit-deal.test.ts` pass with no change: 75 tests | measured |

- **Review** (one reviewer pass, 2026-11-12): ISSUES, one High: with `reportMapping` set, the adapter converted the raw result and dropped the fetched files. Fixed (the mapping now converts the result with its files) and tested. The four checks found nothing that blocks: the credential stays under the base URL with no redirect followed and is in no log line, journal or error; no request leaves the base URL through configuration or answers; `__proto__` keys and re-read placeholders run nothing; deliver-once holds. Today's string addresses behave as before, except that a job ID of `.` or `..` is refused and a whole-number job or quote ID is taken as text. [measured by the reviewer]
- `pnpm typecheck`: passes. `pnpm lint`: passes. [measured]
- `pnpm test`: 3,196 passed and 3 failed in one run while a second vitest run went at the same time: `examples/seller-adapter.test.ts` (fetch failed to the sim), `apps/demo-cloud/src/world.test.ts` and `packages/judgment/src/pipeline.test.ts` (30 s timeout). Run again alone, the three files pass, 131 tests [measured]; the failures came from the load of two runs [inferred]. CI is the gate.
- The new test file takes about 3.5 s locally [measured]; `vitest.config.ts` gives it a cost of 35.

## Decisions

- **The mapping lives in its own file,** `examples/seller-adapter-api.ts`, so the adapter's deal loop changes in a few places only and the mapping is tested without a chain.
- **Today's three addresses are the mapping's defaults.** A string call is a mapping with today's method, body and pointers; with no `baseUrl` it follows redirects and reads answers whole, as before. A mapping or a credential needs `baseUrl`, and then no redirect is followed and each answer is capped at the delivery cap.
- **A placeholder is a name, not an expression:** `buyer`, `scope`, `options`, `scope.<field>`, `options.<field>`, `commitmentId`, `quoteId`, `jobId`, `file`, each only in the calls that have it. No escape for literal double braces: no seller API needs them so far.
- **Every value in a path is percent-encoded,** and `.`, `..` and (for a file path) empty segments are refused. The final address is checked under the base URL by origin and path prefix after URL parsing, at load with dummy values and at each call.
- **Prices stay decimal strings** (hard rule). A JSON number is refused as today; job and quote IDs may be whole numbers.
- **`validForSec` caps the offer's window,** so an offer never outlives the price.
- **A failed job closes the deal** with one `job.failed` alert; the buyer's hold returns at `deliverBy` as for any undelivered deal.
- **Files are added to the result before the report mapping,** so a mapping can place them; with no mapping the result with its files is the delivered JSON. A file failure is a refusal (T-329): the delivery waits, the seller is alerted once per distinct result, and redelivery fetches again.

## Handoff

**Done.** All seven items, with tests. Not done: no live run against a real job API (none was in scope).

**What a seller with a job API writes.** `sellerApi` with `baseUrl`, `auth` (`env`, `header`, optional `prefix`), and a mapping for `quote` (`path`, `body`, `read`), `start` (`path`, `body`, `read.jobId`, optional `idempotencyHeader`) and `result` (`path`, `status`, `report`, optional `reportCall` and `files`). `examples/seller-adapter.job-api.config.json` is a whole example with placeholder values; "Your API's shape" in `site/sell.txt` lists every field. With its own template it also names `template` and `scope`. The credential goes in the service's environment file beside `HOLDBACK_KEY`. Its API must return the same job for the same idempotency key, or a restart at `starting` could start a second job.

**For R6c-3 (the payout address).** The change touches `sellerApi` only: `SellerAdapterConfig.sellerApi` is now `SellerApiConfig` from `seller-adapter-api.ts`, `loadConfig` takes `baseUrl` and `auth` in that block, and the `blocks` list in `startSellerAdapter` no longer holds `sellerApi` (the client checks it). A new top-level field such as a payout address goes into `FILE_KEYS`, `loadConfig`'s return and `blocks` as before, and into `seller.offer(…)` in `offerFor`; none of those lines changed here except `offerFor`'s price and window lines, so the merge is in separate hunks [inferred]. If the payout address should reach the seller's API, it would be a new placeholder name in `NAMES` in `seller-adapter-api.ts`.

**For the site deploy (Rafa's).** `site/sell.txt` changed: step 9 of the first hour, "Your three calls", the new "Your API's shape" subsection and the Caddyfile line under "Run it as a service". It is live only after `pnpm site:deploy`.

**Triage (not fixed, outside the task's intent).** Step 3 of "Sell a priced API service" in `site/sell.txt` still says the adapter follows `GET /v1/events`; T-331 removed that follower and the adapter only polls.
