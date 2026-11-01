# T-026: Public demo API on Cloudflare (test tokens, happy path)

- **Lane:** api + infra
- **Phase:** 1 (public demo)
- **Depends on:** T-020, T-023, T-025
- **Paths this task may touch:** `apps/demo-cloud/` (new), `apps/operator/src/` (only to expose a fetch-style handler and a public mode; no behaviour change for existing callers), `apps/adjudicator/src/test-adjudicator.ts` (only if the cloud runtime needs a hook), `packages/settlement/sim/` (only a persistence hook: snapshot or journal replay), `pnpm-workspace.yaml`, root `package.json` scripts, root `tsconfig.json`, `vitest.config.ts`, `docs/api.md` (a "Public demo" section), `docs/tasks/T-026-public-demo-api.md`
- **Human gate:** deploy approved by Rafa on 2026-11-01 ("use my Cloudflare account"), workers.dev only, test tokens only
- **Status:** todo
- **Agent/session:** —

## Intent

Let anyone's two agents run one honest deal end to end against a hosted Holdback, with nothing to download: discover the API, get test tUSD, offer, agree and fund, deliver, judge, settle. Rafa, 2026-11-01: keep it to the happy path, honest content and a basic adjudicator; test tokens with a notice; agents should not need the repo.

Restate this in your own words in this section before writing code.

## Design constraints

- **Runtime:** Cloudflare Workers with `nodejs_compat` and one Durable Object holding the world (SimChain, the club, one basic adjudicator). No Docker on this machine, so no Containers. The existing operator is a `node:http` handler; give it a fetch-style entry (Request → Response) rather than forking the logic.
- **Two operator origins:** the agent-side verifier requires settlement time and recipient keys from at least two distinct operator origins. Deploy two Workers (for example `holdback-op1` and `holdback-op2` on workers.dev), both serving the full API from the same Durable Object, each signing receipts with its own operator key. State plainly in `/.well-known/holdback.json` notes and the docs that both nodes share one simulated settlement layer in this demo (independent nodes need testnet contracts, Phase 2).
- **Public mode** (an option, D31 style; `pnpm sim` unchanged): no `/advance` and no adjudicator controls; settlement time is the wall clock; no endpoint ever returns a secret key. Agents generate their own keys. One public route funds and admits an address: `POST /v1/faucet` (or the sim's `/accounts` reshaped) gives a fixed test amount of tUSD and the club mandate the club needs, rate-limited per address and per IP. Whatever signs the mandate is the sim club's own test principal, said so in the docs.
- **Basic adjudicator:** one test adjudicator, named in each of the primary/fallback/appeal roles is acceptable for the demo, with real deterministic checks. Recommend the checks-only template in docs (real acceptance, no fake panel); if a rubric deal is offered, the response and docs say the panel is scripted. Real judges come when Rafa adds model keys.
- **Persistence:** SimChain lives in memory; the Durable Object can be evicted. Persist enough to survive eviction (simplest: store the journal of accepted signed submissions and replay it on wake, or snapshot). If that is not done, the notice says state may reset, and the docs say so.
- **Deadlines:** short real-time defaults are the parties' choice (D31); the docs show values that complete a deal in a few minutes.
- **Hard rules:** test token only, chain id 31337 (SimChain), no secrets in the repo (Cloudflare account auth is wrangler's own OAuth, nothing committed), Idempotency-Key and signed messages unchanged.
- **Scope:** happy path only. Edge cases go to `docs/backlog.md` rows, not code (Rafa, 2026-11-01).

## Acceptance criteria

- [ ] `apps/demo-cloud/` builds two Workers and one Durable Object with wrangler config; `pnpm demo-cloud:dev` runs both locally (wrangler dev) and a test drives a full checks-only deal over HTTP using `examples/agent.ts`-style calls against the local dev URLs.
- [ ] Public mode: tests show no secret on any route, no `/advance`, faucet funds and admits a fresh address once per rate window.
- [ ] Deployed to Rafa's Cloudflare account on workers.dev (two Workers, only resources this task creates). A live checks-only deal between two fresh agents completes (Released, final), measured with `examples/` scripts pointed at the live URLs, and `/.well-known/holdback.json` and `/v1/openapi.json` and `/llms.txt` are served by both.
- [ ] `docs/api.md` "Public demo" section: the two URLs, the faucet, what is shared, what is scripted, test tokens only.
- [ ] `pnpm verify` green. PR opened; deploy URLs in the PR.

## Out of scope

- Live model judges (Rafa's keys later); testnet or mainnet contracts; custom domains; edge-case hardening.

## Evidence

## Decisions

## Handoff
