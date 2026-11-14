# T-435: `apps/hosted-sellers/`, the seller adapter as a Worker with one Durable Object per seller

- **Lane:** infra
- **Phase:** 2
- **Depends on:** T-434 (the adapter's core), ADR-0037 sections 3 to 7 and 11 (Accepted 2026-11-14, D68)
- **Paths this task may touch:** `apps/hosted-sellers/`, `examples/seller-adapter-api.ts`, `examples/seller-adapter-core.ts`, `examples/seller-adapter-job-stub.ts`, `examples/seller-adapter-workspace.test.ts`, the root `tsconfig.json` (one reference), `pnpm-lock.yaml`, this file
- **Human gate:** yes for any deploy and every secret; this task deploys nothing
- **Status:** review
- **Agent/session:** the T-407 session, on Rafa's word of 2026-11-14 ("Yes, start both")
- **Roadmap row:** N134

## Intent

Crow runs the seller side for a company that has only a job API, on Crow's own Cloudflare account. Each hosted seller is its own Worker, `crow-seller-<slug>`, with its own secrets and one Durable Object that holds its deals. The Worker serves the seller's page at `crow.direct/agents/<slug>`, with the `crow-agent` card `site/buy.txt` step 2 reads, and passes every other path under it to the object. There the adapter's core (T-434) answers the quote and defaults routes, and an alarm moves the open deals. A buyer needs nothing but crow.direct, and a deal no longer depends on one machine.

The seller's bundle holds its slug, its card, its adapter configuration and the files that configuration names. It holds no secret, and it is built at deploy from a private folder (T-436), so it never enters this repository. The secrets are Worker secrets: `HOLDBACK_KEY` and the variables the configuration names. The core gets those and no other variable.

This task also adds the workspace guard of ADR-0037 section 5 to the adapter's API client. It works on Node too, and is off unless a configuration sets it. `sellerApi.workspace` names the account once. The quote and start paths must carry it as `{{workspace}}`, and a result from another account is never delivered.

Non-goals: the deploy and secret scripts and Rafa's runbook (T-436); calling any company's real API; a deploy.

## Acceptance criteria

- [x] A Worker per seller, one Durable Object, journal in Durable Object storage with one entry per deal and per quote replay, alarm-driven passes; the alarm never throws.
- [x] The seller's page and `agent.json` carry the `crow-agent` card with the quote and defaults addresses; the card's text is escaped.
- [x] `/health` reads operational or degraded, the open deals by stage and the bundle's SHA-256, and no secret.
- [x] The core gets `HOLDBACK_KEY`, the operators and the configured credential variables only. A `HOLDBACK_` variable on the Worker, a credential named after a Worker variable, a chain other than Sepolia or SimChain, or a `SELLER_URL` for another seller stops the object (503, degraded).
- [x] Routes: `/agents/<slug>` and `/agents/<slug>/*` only; slugs that would share a path with Crow's test seller or test buyer are refused.
- [x] The workspace guard: the quote and start go to the pinned account, a path without `{{workspace}}` or with the account as text is refused, and a result from another account holds the deal and alerts once.
- [x] Tests on the in-process world against the job stub: a whole deal through the object's alarm; a reset of the object between the funded hold and the delivery, ending in one job and one delivery; no secret in storage, logs, card or health.
- [x] The Worker bundles for the Workers runtime (Wrangler's dry run) and runs one whole deal in Cloudflare's local runtime (`wrangler dev`).

## Evidence

Measured on 2026-11-14 on branch `t-435-hosted-sellers`, stacked on T-434 (PR 553).

- `pnpm exec vitest run examples/seller-adapter apps/hosted-sellers`: 7 files, 121 tests passed. These are the Worker's 9 tests, the workspace guard's 6, and the adapter's 106.
- `npx wrangler@4.151.3 deploy --dry-run --config apps/hosted-sellers/example/wrangler.jsonc --outdir <scratch>`: bundled for the Workers runtime, "Total Upload: 3795.78 KiB / gzip: 588.43 KiB", bindings `SELLER` (the Durable Object), `OPERATOR_URLS` and `SELLER_URL`. Nothing was uploaded.
- `node apps/hosted-sellers/scripts/local-run.ts`, in Cloudflare's local runtime (`wrangler dev --local`): health operational; the card named the quote and defaults addresses; the offer was 200,000,000 base units (200.00 tUSD on SimChain); after funding, the object's alarm took the deal to "settled Released; 1 delivery; the stub made 1 run". Both the quote and the start went to `example-workspace`. No key appeared in Wrangler's log. Exit 0.
- **The first local run failed, and changed T-434:** at load the Worker threw "Uncaught TypeError: Invalid URL string" in `packages/testkit/dist/judgment.js`. The core then imported `plain` from the testkit, whose index builds a URL from `import.meta.url`. T-434 now takes `plain` from `examples/plain.ts`.
- **The red team on T-434 found the journal one growing value** (Medium 3: 6,460 bytes per unfunded quote, measured). The Worker now stores one entry per deal and per replay, and writes only what changed, in parts of 128 entries. Tested.

## Decisions

- **One object name per seller, the same across deploys** (`crow-hosted-seller-<slug>`). The test seller names its object after the pinned rules address, so a new contracts deployment starts fresh storage; a hosted seller keeps its open deals instead, and a contracts cutover reads them first (ADR-0037 section 6).
- **Chains:** Sepolia (11155111) and SimChain (31337), both test networks. The check runs after the core reads the operators' discovery, and the object refuses every `HOLDBACK_` variable but `HOLDBACK_KEY`, since `examples/verify.ts` reads `HOLDBACK_DEPLOYMENT` and `HOLDBACK_CHAIN_ID`.
- **The workspace guard is generic:** it names no company's paths. `{{workspace}}` is filled from `sellerApi.workspace.id` only, whatever a caller passes under that name.

## Handoff

The next step is T-436: the scripts that build a seller's bundle from its private folder, deploy its Worker and set its secrets, and Rafa's runbook for the first deploy.
