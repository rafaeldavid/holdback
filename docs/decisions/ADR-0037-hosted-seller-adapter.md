# ADR-0037: Crow hosts a seller adapter for a design partner on its own Cloudflare account

- **Status:** Accepted, 2026-11-14. Rafa chose the runtime: a Cloudflare Worker with one durable store (a Durable Object) per seller, option A, not a container (Rafa, 2026-11-14; D68). Nothing here is built.
- **Date:** 2026-11-14
- **Raised by:** T-407 (`docs/tasks/T-407-hosted-seller-adapter.md`), from Rafa's decision on 2026-11-14 that Crow runs the seller side for a design partner whose only interface is an HTTP job API priced in credits. Research: this note (code read at `a0a70dc`, `origin/main` on 2026-11-14; Cloudflare's documentation read the same day; nothing run) and one independent research pass (section 9).
- **Builds on:** ADR-0001 (neutrality), ADR-0005 (access by API), ADR-0033 (payout and payment addresses); D26 (the law is the backstop), D31 (parametrize, don't restrict), D32 (parties carry responsibility), D35 (rails, not a record-keeper), D47 (Crow's test seller); the adapter's tasks T-318, T-324, T-329, T-331, T-366 and T-406.
- **Changes when built:** `examples/seller-adapter.ts` and `examples/report-converter.ts` (the core moves out of the Node shell), a new `apps/hosted-sellers/` (one Worker per seller), `pnpm-workspace.yaml`, tests and fixtures, and a deploy section in `docs/operations.md`. No contract, schema, signed type, API route or site page changes.

Labels: **measured** (read at the cited line, or run), **documented** (stated in the cited doc), **inferred** (from reading, not from a run), **guessed**.

## Summary

**Today the seller side of a design partner's deal runs on one Mac.** `examples/seller-adapter.ts` is a Node process with a journal file, a poll loop and a server on 127.0.0.1. For the pilot's two scans a tunnel from Rafa's Mac carries it (Rafa, 2026-11-14). If that Mac sleeps, loses its network or reboots during a 7-day delivery window, the deal waits; if the window ends first, the buyer is refunded and the partner's scan is wasted [inferred from `examples/seller-adapter.ts:1027-1031`].

**The recommendation: a Worker with one Durable Object per seller (option A),** the pattern Crow's test seller has run since 2026-11-04. The adapter's logic moves into a core with no Node imports; the Node process and the Worker each wrap it. The journal lives in Durable Object storage, and an alarm replaces the poll loop.

**The decision, one line per question:**

1. **Runtime.** A Worker and a Durable Object (A), not a container (B). Both need durable storage outside the process, and A is the shape already in production.
2. **One Worker per seller,** so one seller's configuration cannot reach another seller's keys, and a deploy for one seller never restarts another's deal.
3. **Secrets.** The seller's signing key, the partner's API key and the quote credentials are Worker secrets only. The adapter refuses a configuration that points one credential at another's variable.
4. **The configuration** stays outside the public repository. The deploy script reads it from a path Rafa names and bundles it; the card shows its SHA-256.
5. **The workspace guard.** The configuration names the workspace once; the quote and start addresses must carry it; a result that names another workspace is never delivered.
6. **The card page** at `crow.direct/agents/<seller>`, with the `crow-agent` card `site/buy.txt` step 2 reads.
7. **A start with no idempotency key goes out at most once per deal.** Today the adapter sends it again at every poll until it records a job ID, which can charge the partner a second scan. The fix is in the shared core, so the Mac gets it too.
8. **Deploys** use deferred code updates, and the deploy script refuses while a deal waits between a funded hold and a recorded job ID.

## 1. Context

**What the adapter does** [measured, `examples/seller-adapter.ts:1-50`, `:885-1100`]:

- `POST /quote`: checks the buyer's scope against the configuration, asks the partner's API for a price, signs an offer naming the buyer and submits it through the operators.
- A poll every `pollMs`: when every operator shows the hold funded, it records `starting`, calls the partner's start, and records `started` with the job's ID.
- It polls the partner's result. When the job is done, it converts the report (`reportMapping`), runs the adjudicator's first-stage checks on those exact bytes (`preflightDelivery`), and delivers only bytes the checks would not refuse.
- `GET /defaults`: the seller's published terms. `POST /deals/<id>/ready`: the seller says a fixed report is ready.
- The journal is one JSON file written whole and renamed into place (`:778-783`).

**What has to change for hosting** [measured, by import]: four Node-only parts. `node:fs` reads the configuration, the template, the report mapping and the journal; `node:http` serves the routes; `setInterval` drives the poll; `examples/report-converter.ts:31` reads its mapping with `readFileSync`. The rest already runs in Workers: `examples/agent.ts` and `examples/verify.ts` run in `crow-test-agents` [measured, `apps/test-agents/src/seller.ts:17-19`], and the check library runs in the adjudicators inside holdback-op1 [documented, `docs/operations.md`, "What is live"; `apps/adjudicator/src/service.ts` imports `@holdback/judgment`].

**One call fails in a Worker as written.** The adapter fetches with `redirect: 'error'` (`examples/seller-adapter-api.ts:427`, `examples/seller-adapter.ts:1110`). Workers do not implement that mode and throw a `TypeError` before sending [documented, Workers Request API]. The core uses `redirect: 'manual'` and refuses any 3xx itself, on Node and in the Worker.

**The partner's job API sets two hard constraints** (private kit, `run-real-jobs.md`, not copied here):

- **Each scan spends the partner's credits once.** A start for a deal whose scan has ended is charged again.
- **The start call takes no idempotency key.** A second start while the first scan is queued or running is refused with 409 at no cost.

**High · The adapter sends the start again at every poll while a deal is at `starting`** (`examples/seller-adapter.ts:1013-1017`, `:1172-1183`) [inferred from reading]. A start whose answer was lost (a crash, a reset, a timeout after the partner created the job) leaves no job ID. Each later poll calls start again. While the scan runs, each call draws a free 409. Once the scan ends, the next call starts and charges a second scan. The `starting` branch also checks neither `Held` nor `deliverBy` before it calls. This holds on the Mac today, hosted or not, so the shared core fixes it (section 6).

## 2. The runtime: a Worker with a Durable Object, or a container

| | A. Worker + Durable Object per seller | B. Container running `seller-adapter.ts` |
| --- | --- | --- |
| Where the journal lives | Durable Object storage, written transactionally per change | Must move off the container's disk anyway: "All disk is ephemeral by default" [documented, Containers FAQ]. So the journal goes to the container's Durable Object or to R2 over a mount |
| What drives the poll | The object's alarm, retried on failure [documented, Alarms API] | The process's `setInterval`, while the container runs. The container is reachable only through its Durable Object, which must keep it alive or wake it by alarm [documented, Containers architecture] |
| Code change | Split the core from the Node shell (section 7); both shells share every line of deal logic | Smallest at first: the process runs as is. Then the journal moves out of the file, which is the same split in another place |
| Secrets | Worker secrets, read by the object | Worker secrets, handed to the container as environment variables at start |
| A deploy | Resets the object; deferred updates let an active object finish first (section 6) | A rollout sends SIGTERM and allows 15 minutes to drain [documented, Containers rollouts]. The adapter already finishes its step on a signal (`examples/seller-adapter.ts:1299-1306`) |
| Cost at a few deals a month | An alarm every `pollMs` while a deal is open. At 60 s for 7 days, about 10,000 requests a deal: within Workers Paid's included use [inferred from `docs/operations.md`, "Durable Object use"] | A small instance kept running 7 days a deal, billed per 10 ms while it runs [documented, Workers pricing]. A few dollars a month at most [inferred] |
| What Crow already runs | Two Workers on this pattern: the test seller and the test buyer (`apps/test-agents`) | No container anywhere in Crow |
| Ops for Rafa | One deploy script, one secret script, the same as the test seller | Image builds and a container registry, plus the Worker |

**Recommendation: A.** The container's one advantage, running the Node file unchanged, disappears because its disk is not durable: the journal must leave the file in both options. A is then the same amount of work, runs on the pattern already proven in production, and has nothing new to operate. B stays the fallback if a partner's API ever needs a long-lived connection or a binary the Workers runtime cannot run.

## 3. One Worker per seller

**Each hosted seller is its own Worker,** `crow-seller-<slug>`, with its own secrets and its own Durable Object.

- **Secret isolation.** `sellerApi.auth.env` names the environment variable whose value the adapter sends to the partner [measured, `examples/seller-adapter-api.ts:70`]. In one shared Worker, a mistyped or hostile configuration for seller A could name seller B's key and send it to A's API. With one Worker per seller, the platform keeps B's secrets out of A's environment.
- **Deploy isolation.** A deploy resets the Durable Objects of the Worker it deploys. A Worker per seller means a configuration change for one seller never interrupts another's `starting` window.
- **The cost:** one more Worker for each seller, against a limit of 500 on Workers Paid [documented, Workers limits]. The code is the same; only the bundled configuration and the route differ.

## 4. Secrets and the configuration

**Secrets, set by Rafa with a script like `apps/test-agents/scripts/seed.mjs`,** each read from the Worker's environment only:

| Secret | Holds | Who makes it |
| --- | --- | --- |
| `HOLDBACK_KEY` | The seller's signing key for this seller only | The script, in memory, piped to `wrangler secret bulk`; it prints only the address |
| The variable `sellerApi.auth.env` names | The partner's API key, limited at the partner to one workspace where it allows | Rafa, from the partner's approval page, typed at a hidden prompt |
| The variable `quoteAuth.env` names | The buyers' quote credentials | The script |
| `alerts.secretEnv`, `redelivery.readyAuth.env` (optional) | The alert signing secret, the ready credentials | The script |

**A new refusal, in the core, so Node gets it too:** every credential variable the configuration names must be distinct, and none may be `HOLDBACK_KEY`. Today a configuration with `sellerApi.auth.env: "HOLDBACK_KEY"` would send the seller's signing key to the partner as a bearer token [inferred from `examples/seller-adapter-api.ts:281-287`: the name is checked for shape only].

**Nothing else holds a secret.** The journal holds terms, scopes, job IDs and quote replays. The log names variables, never values (`describe`, `examples/seller-adapter-api.ts:95`). Workers Logs keeps the adapter's lines with invocation logs off, so no caller's IP is stored, as for the test seller [documented, `apps/test-agents/wrangler.jsonc`]. The build's tests read every journal entry and every log line and fail if either holds a secret's value.

**The configuration is the `loadConfig` shape, unchanged,** with `sellerApi` mappings, `quote.read.units` and `unitPrice` (T-406), `reportMapping`, `scope`, `termsRules`, `timing` and `quoteAuth`. It, its template and its report mapping can name a partner, its workspace and its report's fields, so they never enter the public repository:

- The deploy script takes `--config <path>` outside the repository (for the pilot partner, a folder in the private repository), checks it with `loadConfig`, and bundles the three files into the Worker as data. Worker variables cannot hold them: each is limited to 5 KB [documented, Workers limits].
- The card and `/health` show the configuration's SHA-256, and the deploy script prints it, so Rafa can check what runs against the file he approved.
- Two fields join the configuration for hosting only: `card` (the name and the item the page shows) and `workspace` (section 5). `journal`, `port` and `log` do not apply to the Worker, which refuses them.

## 5. The workspace guard

**A job runs only in the workspace its configuration names.** The adapter is generic, so the guard names no partner's paths:

1. **The configuration names the workspace once:** `workspace: {"id": "<id>", "resultPointer": "/<pointer>"}`. `resultPointer` is optional.
2. **The quote and start addresses must carry it** through the placeholder `{{workspace}}`, filled only from `workspace.id`. The loader refuses a configuration with `workspace` set whose quote or start path lacks the placeholder, or holds the ID as literal text, so the two can never differ.
3. **Before every quote and start call,** the client checks that the built address carries the ID as one path segment. A configuration changed between deploys cannot point a running deal elsewhere, since the deal's start uses the bundled configuration that priced it.
4. **Before delivery,** when `resultPointer` is set, the value at that pointer in the result must equal `workspace.id`. Otherwise the adapter refuses the result: nothing is delivered, the deal holds at `refused` and the seller is alerted (`workspace.mismatch`).
5. **The deploy script** takes `--workspace <id>` typed by Rafa and refuses a configuration that names another, the hosted form of the private kit's `check-workspace.mjs`.
6. **At the partner,** an API key approved for one workspace only is the second guard. That approval is Rafa's.

## 6. Deploys, resets and the `starting` window

**A start with no idempotency key is sent at most once per deal.** This is the fix for section 1's High finding, in the core, so the Mac gets it too.

1. **The mapping says so.** A start mapping with no `idempotencyHeader`, or with `"repeatable": false`, is a one-shot start. The shipped stub's shape, which takes the deal's ID as its key, stays repeatable.
2. **Before the call,** the `starting` branch reads the settlement layer again: the hold must still be `Held` and `deliverBy` still ahead. Otherwise the deal closes with no start.
3. **The attempt is recorded before the call.** The Durable Object holds the outgoing request until that record is stored [documented, Durable Objects rules: output gates]; on Node the journal is written first, as today.
4. **A pass that finds an attempt and no job ID never calls again.** The deal holds at `start-unknown`, the adapter alerts once, and `/health` lists the deal as waiting on the seller's operator. An alert is only a log line unless `alerts.callback` is set (`examples/seller-adapter.ts:1105-1106`), so `/health` is where Rafa sees it.
5. **A person supplies the job ID** through `POST /deals/<id>/job`, behind the ready route's credential, after finding the job by its name at the partner. The adapter then resumes at `started`. With no ID by `deliverBy`, the deal closes and the buyer reclaims.

Reading the existing job's ID from a 409 answer would remove the person's step, but could adopt another deal's scan of the same commit. It is backlog (D26: bounded loss and a clean record first).

**A deploy resets an active Durable Object** unless its code update is deferred. With `deferred`, an active object keeps its version for up to `max_delay`, at most 300 s and best effort, then resets [documented, Durable Objects code updates]. The next alarm resumes from storage.

- **The Worker deploys with a deferred code update.**
- **The deploy script refuses** while `/health` shows a deal at `starting` or `start-unknown`, with no override. Every other stage is safe across a reset: `delivering` reads the settlement layer before it delivers again [measured, `examples/seller-adapter.ts:1021-1025`].
- **The alarm handler never throws.** It catches each deal's error, as the poll does today (`:1172-1183`), and sets the next alarm itself, since a throwing handler is retried only six times [documented, Alarms API].
- **A contract cutover** strands an open deal on the old deployment. The cutover checklist reads each hosted seller's open deals first.

## 7. One core, two shells

The deal logic moves from `startSellerAdapter` into `createSellerAdapter({config, files, env, store, log})`, which returns `handle(Request): Promise<Response>` and `pass(): Promise<nextWakeAt | null>`. It imports no `node:` module.

- **The Node shell** keeps `startSellerAdapter`'s signature and behaviour: a file store written whole and renamed, `node:http` turned into `Request`s, and `setInterval` calling `pass`. Every existing adapter test runs unchanged against it.
- **The Worker shell** is a Durable Object: storage holds one key per deal and per quote replay, the alarm calls `pass` and sets the next wake, and the Worker routes `/agents/<slug>` and `/agents/<slug>/*` to the object.
- **The routes are two patterns,** `crow.direct/agents/<slug>` and `crow.direct/agents/<slug>/*`, not `<slug>*`, so a seller named `test` never takes `test-seller`'s paths. The slug is lowercase letters, digits and single hyphens, and the deploy script refuses `test-seller` and `test-buyer`.
- **The card page,** `GET /agents/<slug>`: an HTML page with a `<script type="application/json" id="crow-agent">` card: `{"type": "crow-agent", "name", "seller": <signing address>, "offers": [{"id", "pricing": {"kind": "quoted", "quote": ".../quote", "defaults": ".../defaults"}}], "configSha256", "testTokensOnly": true}`, also served as `/agents/<slug>/agent.json`, as the test seller does (`apps/test-agents/src/seller.ts:238-249`). The page says that Crow runs the operators, the demo adjudicators and this seller, as the test seller's page does (`:232`). Whether a card names the partner is publishing, so Rafa decides it per seller in `card.name`.
- **Sepolia only.** The Worker signs only for the Sepolia deployment pinned in `examples/deployments.ts`, as `apps/test-agents/src/worker.ts:61` does. `knownPins()` also takes a deployment from the environment (`examples/verify.ts:55-59`), so the Worker refuses any other pin at start.
- **Rate limits held in memory** (the quote route's window, `examples/seller-adapter.ts:591-600`) move into storage, so a reset does not reopen the window.

## 8. Litmus tests

- **Neutrality: unchanged.** The hosted adapter is a party, the seller's agent, and reaches the operators over the public API like any agent, as the test seller does (D47). It gains no power over the hold, the operators or the adjudicators. Crow holding a partner's keys is an agency relationship outside the protocol: the partner can revoke its key at any time, and the signed record of every step is evidence a court can read (D26).
- **The hold: unchanged.** Funds stay on Sepolia under the rules contract. A seller that stops, hosted or not, leaves the deal to its deadline and the buyer's refund.
- **Defended judgment: unchanged.** The adapter runs the adjudicator's first stage on its own bytes before delivering, as on the Mac. It judges nothing; the adjudicators judge the delivery.

## 9. Alternatives considered

- **B. A container.** Section 2: no durable disk, so the journal moves out of the file anyway, plus a new runtime to operate.
- **C. Keep the Mac with a tunnel.** Right for the pilot's two scans, which Rafa chose. It fails the requirement that a deal outlive one machine.
- **D. One shared Worker for every hosted seller.** Fewer Workers, but one configuration could reach another seller's secrets, and one deploy restarts every seller's object (section 3).
- **E. A Workflow per deal.** Durable steps and long sleeps fit a 7-day deal. The quote route and the redelivery signal still need a Worker and storage, and the deal logic would be rewritten as steps rather than shared with the Node adapter.

**Independent research pass** (2026-11-14, a separate agent given the code, the docs and the two options, not this note's conclusion). It recommends A with one Worker per seller, at about 85% confidence for A over B and 65% for the configuration and guard details [its own estimates]. It agrees with sections 2 to 5 and 7. It added three findings this note now carries:

- **High:** the start sent again at every poll (section 1), fixed by section 6's start-at-most-once rule.
- **Medium:** B does not keep the adapter unchanged: the disk is ephemeral and code inside a container does not keep it running, so B needs the journal store and a keep-alive alarm too [documented, Containers FAQ].
- **Medium:** `redirect: 'error'` throws in a Worker (section 1).

It estimated A at about 40,000 alarm runs per 7-day deal at a 15 s poll, inside Workers Paid's included 1,000,000 requests a month, and B at about 1.40 USD per 7-day window on a 1 GiB instance [inferred, from Cloudflare's pricing pages]. It measured the pilot partner's template at 7,733 bytes minified, over the 5 KB limit for a Worker variable, which confirms the bundled configuration of section 4.

## 10. Consequences

- A design partner with only a job API sells through Crow without running anything; a buyer needs only crow.direct.
- Crow holds third-party keys that start paid work. The red-team review of the build covers: the credential-variable refusal, the workspace guard, secrets in the journal and logs, the `starting` window across a deploy and an alarm retry, the quote route's credential and rate limit, and the card page's escaping.
- `site/buy.txt` step 2 says Crow runs no seller that sells by quote. That line changes when the first hosted seller goes live, in the deploy's change.
- A hosted seller bundles its own copy of the check library. A change to the checks goes out to the hosted sellers with the operator deploy that carries it, so the seller's first-stage run matches the adjudicator's.
- Every deploy and every secret stays Rafa's.

## 11. What the build tests

On the in-process world (`apps/test-agents/src/test-world.ts`) with the job stub (`examples/seller-adapter-job-stub.ts`):

1. Quote, hold, start, result, delivery and release through the Worker shell.
2. A reset of the object between any two steps, `starting` included, ending in at most one job, at most one delivery, the same keyed quote answer and the same rate-limit window.
3. A lost start answer sends no second start; no start once the hold is not `Held` or `deliverBy` has passed; `POST /deals/<id>/job` resumes the deal.
4. A 3xx from the partner's API is refused, on Node and in the Worker; a pin other than Sepolia stops the Worker at start; a failed alarm sets the next one.
5. The workspace guard: a path without the placeholder, a literal ID, and a result from another workspace, each refused.
6. The credential refusal: `sellerApi.auth.env` equal to `HOLDBACK_KEY` or to another credential's variable.
7. No secret value in any journal entry or log line.
8. The card page: the `crow-agent` card parses, its addresses answer, and a hostile `card.name` is escaped.
9. Every existing adapter test, unchanged, on the Node shell.

## 12. Open questions for Rafa

1. **The runtime:** A (recommended) or B. **Decided: A,** a Worker with one Durable Object per seller, not a container (Rafa, 2026-11-14).
2. **One Worker per seller** (recommended) or one shared Worker.
3. **Where the configuration lives:** a folder per seller in the private repository (recommended), bundled at deploy.
4. **The card's name:** whether a hosted seller's page names its partner, decided per seller.
5. **A spare copy of each seller's signing key,** held offline by Rafa, or none. Without one, a Worker that cannot run until `deliverBy` means a refund to the buyer and a spent scan; with one, a person can deliver by hand (`examples/seal.ts`). Recommended: none for the pilot wave, since the funds are test tokens and the refund is bounded.
6. **The start-at-most-once rule (section 6) on the Mac too,** before the pilot's two scans: it changes `examples/seller-adapter.ts` that those scans run. Recommended: yes, as a small change of its own ahead of the hosted build, since a second charged scan is the costliest failure here.
