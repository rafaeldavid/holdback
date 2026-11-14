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

To be filled in with the build.

## Evidence

To be filled in.

## Decisions

To be filled in.

## Handoff

To be filled in.
