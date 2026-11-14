# T-422: Rate limits and abuse controls on the API, with a threat model

- **Lane:** security
- **Roadmap row:** N19
- **Phase:** 2, stable EVM operations on Sepolia (D53)
- **Roadmap:** N19, "Rate limits and abuse controls on the REST API, with a threat model for operator nodes"
- **Depends on:** T-409 (operator hardening, PR 512), T-413 (the `deployedAt` field, PR 505)
- **Paths this task may touch:** `apps/demo-cloud/` (both operator Workers, the World Durable Object, their Wrangler files and tests); the write path and the idempotency store of `apps/operator/src/` (`server.ts`, `idempotency.ts`) and their tests, which the brief calls operator code (kind 4 covers both packages; the coordinator was told); one new document, `docs/operator-threat-model.md`; this file. Never: `contracts/`, `spec/schemas/`, `docs/api.md`, `site/ref/limits.txt`, the guides' first-deal text, `site/try.mjs`, `site/buy.mjs`.
- **Human gate:** none for the code. The deploy runs on Rafa's standing word for this wave ("merge and deploy when ready").
- **Status:** done (merged in PR 524, `f432892`; both operators deployed on 2026-11-14 at 11:55 UTC, on Rafa's word for this wave)
- **Agent/session:** the T-422 session, 2026-11-14, branch `t-422-rate-limits`, worktree `.worktrees/holdback-T-422`
- **Kind:** 4, API and operator code; one `reviewer` pass and one `red-teamer` pass

## Intent

Two operators serve the public API on Sepolia, and both relay through one relayer wallet that pays the gas of every deal they relay. Outside agents can reach them today, and a design partner's agents start soon. Today one caller can do three things that cost every other caller:

- **Flood the one Durable Object.** Both operators forward every request to one World object, which answers one request at a time. The operator's throttle refuses an abusive caller, but each refusal still runs inside that object.
- **Spend the relayer's gas.** Write limits count per signer, and a per-deal key costs nothing, so a caller with fresh keys and open-mint test tokens can have the relayer fund deal after deal.
- **Fill the world's storage.** Each ciphertext upload of up to 1 MiB stays in the world's storage for good, limited only by 120 writes a minute.

This task writes the threat model first (`docs/operator-threat-model.md`), then adds four limits: a flood ceiling in each Worker before the Durable Object; an early refusal of an oversized body; a daily cap per caller on deals the relayer funds; and a daily cap per caller on ciphertext bytes stored. It keeps the replay rule: a replay of an accepted request is answered from the stored response and never refused by a service limit. It also adds `demo.build.deployedAt` to discovery.

Every limit is one operator's service protection, stated as configuration with units (D31). None changes what the contract accepts, and none caps an amount, a deadline or another negotiated value. A caller one operator refuses can send the same signed message to the other operator or straight to the settlement contract.

## Acceptance criteria

- [ ] `docs/operator-threat-model.md` names each abuse (floods of reads, floods of gas-spending writes, draining the relayer with many small deals, replay storms, large bodies, slow requests, enumeration of other parties' deals), what each costs in units, what already stops it, and what this task adds.
- [ ] A request over a limit gets `429` with `application/problem+json`, type `rate_limited`, `retryAfterSec`, and a `Retry-After` header in whole seconds. An oversized body gets `413` `payload_too_large` with `maxBytes`.
- [ ] A replay of an accepted request, with the same Idempotency-Key and the same body, is answered from the stored response when its caller is over the read, write, funded-deal or ciphertext limit.
- [ ] `neutrality.operator-daily-cap` (the name `neutrality.operator-rate-limits` is the throttle's, in `apps/operator/src/neutrality.test.ts`): one operator refuses a party's funding at its daily cap; another client's deal funds through the same operator at the same time; the party's same signed funding goes through the other operator, and the deal ends Released.
- [ ] Each limit, the replay rule and the fixture has a test that fails before the change (measured).
- [ ] Discovery's `demo.build` carries `deployedAt` from each Worker's version-metadata binding, or null.
- [ ] The defaults sit well above what the live flows were measured to need (below), and this file and the Handoff state them with units.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint` and `pnpm snap` pass; one reviewer pass and one red-team pass, their findings fixed or recorded.
- [ ] Merged, deployed, and checked live: a burst above a limit gets `429`, and one normal try deal still ends Released.

## What the live flows need (measured 2026-11-14)

One try deal, `site/try.mjs --seller https://crow.direct/agents/test-seller`, run with a counting `fetch` against the live operators (log in `reports/scratch/t-422/try1.jsonl`): Released in 44 s.

| Operator | Requests | Reads | Writes | Peak in 60 s | Peak in 10 s | Largest body |
| --- | --- | --- | --- | --- | --- | --- |
| api.crow.direct | 71 | 67 | 4 (faucet, ciphertext, prepare, agree with fund) | 71 | 27 | 1,010 bytes |
| api2.crow.direct | 63 | 63 | 0 | 63 | 23 | none |

Funded deals per try deal: 1. The test buyer caps itself at 50 deals a day and 10 open (`apps/test-agents/src/buyer-rules.ts`); the test seller at 100 offers a day (`catalog.ts`). Both run as Workers, so every request they send counts under one client [inferred: Cloudflare sends a Worker's subrequests from its own addresses].

## The limits (defaults)

Each counts per client (an IPv4 address or an IPv6 /64) at each operator apart. Each refusal is `429` `rate_limited` with `retryAfterSec` and `Retry-After` in whole seconds, and its `detail` names the other routes: wait, the other operator, or the settlement contract.

| Limit | Default | Where | Measured need (one try deal) | Room | Set by |
| --- | --- | --- | --- | --- | --- |
| Flood ceiling | 500 requests per 10 s | each Worker, before the World object (Cloudflare rate-limit binding, per location) | 27 per 10 s | 18 times | `ratelimits` in `wrangler.op1.jsonc` and `wrangler.op2.jsonc`; `limits.ts` `FLOOD_CEILING` |
| Reads | 1,200 per 60 s | the operator, in the World object | 67 per 60 s | 17 times | `RATE_READS_PER_MIN` |
| Writes | 120 per 60 s per signer (per client before the settlement layer accepts one) | the operator | 4 per deal | 30 times | `RATE_WRITES_PER_MIN` |
| Requests under a known Idempotency-Key, replays included | the write budget's size: 120 per 60 s per client, counted at entry | the operator, its own count | 0; 1 after a lost answer | 120 times | follows `RATE_WRITES_PER_MIN` |
| Funded deals | 100 per UTC day | the World object, stored | 1; the test buyer funds at most 50 a day | 2 times the test buyer's own cap | `FUNDED_DEALS_PER_CLIENT_PER_DAY` |
| New ciphertext stored | 256 MiB (268,435,456 bytes) per UTC day | the World object, stored | under 1 KB | more than 250 deliveries of the 1 MiB maximum | `CIPHERTEXT_BYTES_PER_CLIENT_PER_DAY` |
| Body size | 1 MiB (1,048,576 bytes); 192 KiB (196,608 bytes) for `/v1/adjudicators` | each Worker by Content-Length, then the operator while it reads | 1,010 bytes | 1,000 times | code (`MAX_BODY_BYTES`, `MAX_REGISTRATION_BYTES`) |

The read and write throttle and its numbers are T-409's era and unchanged; this task makes them Worker variables and states them beside the new ones. Every variable sits in `wrangler.op1.jsonc`, because the World object runs with holdback-op1's environment for both nodes.

## Evidence

All runs on 2026-11-14, in this worktree, on the Mac. Logs in `reports/scratch/t-422/`.

- **The live flows' needs (measured):** the table above, from one try deal against the live operators (`try1.jsonl`).
- **The tests fail before the change (measured).** The new tests were committed alone (`4d07b03f`). Run against the original operator, world and Worker files with only the new pure module in place (`before.txt`): 12 of 16 failed. The 4 that passed were the two `DailyCaps` unit tests and `clientKey` (pure functions of the new module) and the replay of an accepted funding over the cap, which passes trivially with no cap.
- **The replay budget is needed (measured, a mutation run).** With the replay budget's `throttle` line removed from `server.ts`, the replay-flood test failed; restored, it passes.
- **The red team's attacks fail before their fixes and pass after (measured).** At `bccef8b2` its file failed 11 of 32 tests (its report). At the fix commit, `limits.attack.test.ts` and `limits.test.ts` pass 34 of 34, with the attacks adapted as Decisions 2 and the Review section say.
- **Checks at the fix commit `fe7ed893` (measured):** `pnpm build`, `pnpm typecheck` and `pnpm lint` exit 0; `pnpm test`: 201 files and 3,960 tests passed, 14 files and 217 tests skipped (the anvil and network ones, as on `main`); `pnpm snap`: 48 of 48; `pnpm validate:spec`: 35 of 35 examples, and `spec/openapi.json` fresh.

## Decisions

1. **The flood ceiling stands in front of the World object, in each Worker.** Both nodes forward to one Durable Object, which answers one request at a time, so any refusal made inside it still costs every other caller a turn. A Cloudflare rate-limit binding counts in the Worker instead (Cloudflare's documentation: approximate, per location, a 10 s or 60 s period). Each node has its own namespace (4221 and 4222), so a client one refuses still has its full count at the other. The binding fails open: an outage of it must not stop the API.
2. **A replay escapes the read and write budgets and the daily caps, and meets two limits of its own.** The coordinator asked on 2026-11-14 for a replay flood to meet a limit of its own, stated with units. Every request under a known Idempotency-Key counts at entry in a budget of its own, the size of the write budget (120 per 60 s per client), and the flood ceiling counts every request: the Worker cannot tell a replay from a new request without the World object's idempotency store. A lost answer needs one replay, so both sit 100 times or more above that need. The red team measured that ten times the write budget let one client keep the World object 1.5 s busy each second with 1 MB replays, so the budget is the write budget's size: the same bound on body work as before T-422. A funding for a deal already past funding is not counted at all (the settlement layer spends no funding gas on it), so a replay of one is answered after 00:00 UTC and from another address too.
3. **Gas is capped as funded deals, not as gas units.** The relayer commits to a deal's gas when it funds it; the later steps are bounded per deal by the contract's stages (one delivery, one decision or settlement, one timeout). Counting fundings needs no change to the settlement adapter, and a funded deal costs about 1.56 million gas [measured on Sepolia, T-389]. 100 a day per client and operator is twice the test buyer's own cap. The steps of deals funded elsewhere (by the caller, at its own gas) are left to the write throttle: the caller pays real gas for each, so the loss is bounded [recorded in the threat model as a residual].
4. **A storage cap on ciphertext is added.** The threat model found it: each upload of up to 1 MiB stays in the World object for good, and at 120 uploads a minute one client fills the object's 10 GB in about 85 minutes, after which every write fails and the world stops. 256 MiB a day per client and operator keeps that to about 20 client-days.
5. **One client is an IPv4 address or an IPv6 /64**, by the rule the test agents already use (`clientKey`). The Worker forwards that key, so the operator's existing throttle and the faucet's per-client count change too: an IPv6 host can no longer take a fresh count for each address in its /64.
6. **The daily rows name no address.** Each row's key holds the client hashed with the world's secret (`lc:<day>:<node>:<hash>`), and the first count of a new UTC day deletes the rows of the days before. The request log already keeps no IP (D39).
7. **The operator answers a replay before its throttle (`apps/operator/src/server.ts` and `idempotency.ts`, kind 4).** Before, the throttle came first, so an agent over its count could not read back an answer it had already been given. The coordinator added this one change to T-422's paths on 2026-11-14, on four conditions, each met:
   - Only a stored, accepted response whose Idempotency-Key and body fingerprint match is answered early. The same key with another body is a `409` and counts as a write, and so does a body that fails to read or parse. An unknown key meets the throttle at entry, as before. A dry run is never a replay.
   - The body cap runs before the lookup; the lookup is one keyed read (`IdempotencyStore.replay`); replays have their own budget (above), and a test shows a replay flood leaves another client's writes alone.
   - The red team got this exact edit, with the question whether the early answer can skip a limit, read another party's stored response, or spend gas.
   - No other edit in `apps/operator/`: `MAX_BODY_BYTES` stays private there, and demo-cloud keeps its own copy, checked against the operator's 413 by a test.
8. **`demo.build.deployedAt` is per node.** The World object runs holdback-op1's code, but each Worker in front has its own version; each forwards its binding's time in a header it sets itself (a caller's copy is dropped), and discovery shows the time of the Worker that answered. `spec/openapi/paths.json` gets the field and `demo.limits`, both additive (outside `spec/schemas/`; `pnpm openapi` regenerates `spec/openapi.json`).
9. **A malformed limit variable refuses to start**, as a malformed fee schedule does. The deploy's live try deal would then fail, and the script rolls back by itself.

## Review and red team

**Reviewer (one pass, 2026-11-14): ISSUES; 1 High, 2 Medium, 6 Low or Info.** Report in `reports/scratch/t-422/review/reviewer.md`.
- **Fixed:**
  - High 1: a refused replay gave back an accepted funding's count. `takeFunding` now says whether it counted, and only a counted funding is given back.
  - Medium 2: a replay after 00:00 UTC was refused at the cap. A funding for a deal past funding is no longer counted.
  - Low 4: re-uploads were counted while under the cap. The stored check now runs first.
  - Low 6: `neutrality.operator-rate-limits` was taken (the throttle's fixture in `apps/operator/src/neutrality.test.ts`). The new one is `neutrality.operator-daily-cap`.
  - Low 7 and Info 9: the OpenAPI scope is in Decision 8; Evidence names the four tests that passed before.
- **Recorded, not fixed:** Medium 3 (Workers share an address) and Lows 5 and 8 (offers and registrations, gas at higher tips) are residuals 6 to 8 in the threat model, with follow-ups.

**Red team (one pass, 2026-11-14): 3 High, 2 Medium, 2 Low.** No attack moved held funds or changed what the contract accepts. Its tests are now `apps/demo-cloud/src/limits.attack.test.ts`.
- **Fixed:**
  - F1 High: `//x/v1/…` skipped both daily caps, because the operator routes the path against a placeholder origin. The caps read the routed URL, and each Worker answers 404 for an empty segment.
  - F2 High: a refused copy of a counted funding, with a bad query or a byte-order mark, gave its count back; 10 deals funded at a cap of 1. Fixed with High 1 above, and the world now decodes as the operator does, keeping the byte-order mark.
  - F3 High: requests under a known key did their body work before any limit: 75 ms for a 1 MB replay, 1.5 object-seconds a second at 1,200 replays a minute. Every known-key request is now counted at entry against a replay budget of the write budget's size.
  - F4 Medium: a replay after midnight or from another address was refused. Fixed with Medium 2 above.
  - F6 Low: a hanging flood binding hung the Worker. It now fails open after 100 ms.
  - F7 Low: the same as the reviewer's Low 4.
- **Recorded, not fixed:** F5 Medium, every Worker caller counting as one client: residual 8 in the threat model.
- **The coordinator's question on the early replay answer** (red team): it cannot skip a limit by itself once F2 and F3 are fixed; it reads another party's stored answer only with that party's key and exact body, as before T-422, and those answers hold public receipts and states; it spends no gas, since it returns before any relay.

## Handoff

**Done.** PR 524 merged at 2026-11-14T11:55:11Z as `f4328920`, with all 17 CI checks passed on head `d0e0de5`, `check` and `gitleaks` among them.

**Deploy (measured).** `pnpm demo-cloud:deploy` from a detached worktree at `origin/main` `a182f81`, after `pnpm install --frozen-lockfile`:

| Worker | New version | Replaced | `deployedAt` in discovery |
| --- | --- | --- | --- |
| holdback-op1 | `e9c809a9-eb68-4e5d-afa7-d7bc836ced4f` | `33fe56ea-48b0-40ce-b9eb-10846f25d3fc` | 2026-11-14T11:56:15.806Z |
| holdback-op2 | `f65054dc-19ba-4914-bc16-ff77d1267cd2` | `ccb986ec-be19-4e55-9fd7-a4eb3061a4c4` | 2026-11-14T11:56:30.063Z |

- The deal guard checked 4 open deals; none would lose its judge. Wrangler listed both new bindings (`env.FLOOD`, 500 requests per 10 s, and `env.CF_VERSION_METADATA`) on both Workers.
- The script's smoke deal `0x56479cb9…6aba46` was Released in 52 s.
- The deploy also carried, from `main`: T-423's problem text in `apps/operator/src/problems.ts`, and test-only changes (`live-fork.test.ts`, `deploy-script.test.ts`). `contracts/deployments/sepolia.json` is unchanged, so the world is the same. No pinned file changed: the site was not deployed.

**Live checks after the deploy (measured, plain requests from this Mac):**
1. Discovery on both nodes names `a182f81`, its own `deployedAt` (above), `limits.reads` 1,200 and `limits.writes` 120 per 60 s, and `demo.limits` with the defaults.
2. A burst of 650 GETs of `/v1/status` to `api.crow.direct` in 1.66 s: 541 answered 200 and 109 answered 429. The ceiling is approximate, as Cloudflare documents, so a burst can pass it by a little before the count catches up. The first 429 had `Retry-After: 10`, `application/problem+json`, the `rate_limited` type link and `retryAfterSec` 10. `api2.crow.direct` answered 200 right after.
3. A POST declaring 1,048,600 bytes got 413 `payload_too_large` with `maxBytes` 1,048,576. `GET //x/v1/status` got 404 `not_found`.
4. One try deal, `site/try.mjs --seller https://crow.direct/agents/test-seller`, was Released in 53 s with Crow's test seller as the other party (`0x53ad3943…0e84492`). It made 153 requests: 152 answered 200 and 1 answered 201; none was refused.

**For T-423's files (exact text in the coordinator's notes folder, `T-422-for-T-423.md`):** a bullet for `site/ref/limits.txt` under "Honest limits"; the end of the "Limits (F8)" paragraph in `docs/api.md`, which still says replays stay on the client; and `neutrality.operator-daily-cap` in the operator row of `docs/neutrality.md`. None has landed yet (measured with grep on `main` at `a182f81`).

**Follow-ups, not built:**
- Measure the address and `CF-Worker` header that a Worker's request carries. Then route Crow's own agents to the operators by a service binding, so other Workers cannot use up their daily cap (threat model, residual 8).
- A daily cap per client on offers and adjudicator registrations, which grow storage (residual 6).
- Gas caps in gas units, or a relayer balance alert, for tips above 1 gwei (residual 7).

**How to resume.** The limits are Worker variables in `apps/demo-cloud/wrangler.op1.jsonc` and the flood ceiling is the `ratelimits` binding in both Wrangler files (keep `limits.ts` `FLOOD_CEILING` equal; a test checks). Run `pnpm exec vitest run apps/demo-cloud/src/limits.test.ts apps/demo-cloud/src/limits.attack.test.ts`.
