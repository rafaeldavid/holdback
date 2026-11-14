# T-422: Rate limits and abuse controls on the API, with a threat model

- **Lane:** security
- **Phase:** 2, stable EVM operations on Sepolia (D53)
- **Roadmap:** N19, "Rate limits and abuse controls on the REST API, with a threat model for operator nodes"
- **Depends on:** T-409 (operator hardening, PR 512), T-413 (the `deployedAt` field, PR 505)
- **Paths this task may touch:** `apps/demo-cloud/` (both operator Workers, the World Durable Object, their Wrangler files and tests); the write path and the idempotency store of `apps/operator/src/` (`server.ts`, `idempotency.ts`) and their tests, which the brief calls operator code (kind 4 covers both packages; the coordinator was told); one new document, `docs/operator-threat-model.md`; this file. Never: `contracts/`, `spec/schemas/`, `docs/api.md`, `site/ref/limits.txt`, the guides' first-deal text, `site/try.mjs`, `site/buy.mjs`.
- **Human gate:** none for the code. The deploy runs on Rafa's standing word for this wave ("merge and deploy when ready").
- **Status:** in progress
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
- [ ] `neutrality.operator-rate-limits`: one operator refuses a party's funding at its daily cap; another client's deal funds through the same operator at the same time; the party's same signed funding goes through the other operator, and the deal ends Released.
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
| Replays of accepted requests | 10 times the write budget: 1,200 per 60 s per client | the operator, its own count | 0; 1 after a lost answer | 1,200 times | follows `RATE_WRITES_PER_MIN` |
| Funded deals | 100 per UTC day | the World object, stored | 1; the test buyer funds at most 50 a day | 2 times the test buyer's own cap | `FUNDED_DEALS_PER_CLIENT_PER_DAY` |
| New ciphertext stored | 256 MiB (268,435,456 bytes) per UTC day | the World object, stored | under 1 KB | more than 250 deliveries of the 1 MiB maximum | `CIPHERTEXT_BYTES_PER_CLIENT_PER_DAY` |
| Body size | 1 MiB (1,048,576 bytes); 192 KiB (196,608 bytes) for `/v1/adjudicators` | each Worker by Content-Length, then the operator while it reads | 1,010 bytes | 1,000 times | code (`MAX_BODY_BYTES`, `MAX_REGISTRATION_BYTES`) |

The read and write throttle and its numbers are T-409's era and unchanged; this task makes them Worker variables and states them beside the new ones. Every variable sits in `wrangler.op1.jsonc`, because the World object runs with holdback-op1's environment for both nodes.

## Evidence

To be filled in.

## Decisions

1. **The flood ceiling stands in front of the World object, in each Worker.** Both nodes forward to one Durable Object, which answers one request at a time, so any refusal made inside it still costs every other caller a turn. A Cloudflare rate-limit binding counts in the Worker instead (Cloudflare's documentation: approximate, per location, a 10 s or 60 s period). Each node has its own namespace (4221 and 4222), so a client one refuses still has its full count at the other. The binding fails open: an outage of it must not stop the API.
2. **A replay escapes the read and write budgets and the daily caps, and meets two limits of its own.** The coordinator asked on 2026-11-14 for a replay flood to meet a limit of its own, stated with units. Replays count in their own budget, ten times the write budget (1,200 per 60 s per client), and the flood ceiling counts every request: the Worker cannot tell a replay from a new request without the World object's idempotency store. A lost answer needs one replay, so both sit more than 100 times above that need.
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

## Handoff

To be filled in.
