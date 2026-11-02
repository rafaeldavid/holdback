# Operations: what is live and how to change it

The public demo of ’crow (the Holdback protocol). Test tokens only; nothing here moves real money. Read `CLAUDE.md` first.

## What is live

| Address | What | Source | Deployed by |
| --- | --- | --- | --- |
| https://escrow.stream (and `www.`) | The site: tagline, early access, Try line, the animated plate; agent docs at `/llms.txt` | `site/` (`site/llms.txt` is the one source; `site/build.mjs` renders the page) | Cloudflare Worker `crow-site`, static assets (`apps/site/wrangler.jsonc`) |
| https://api.escrow.stream | Operator node 1, home of the shared simulated settlement layer (a Durable Object), the faucet and the adjudicators | `apps/demo-cloud/` (wraps `apps/operator`, `packages/settlement/sim`, `apps/adjudicator`) | Worker `holdback-op1` (`apps/demo-cloud/wrangler.op1.jsonc`) |
| https://api2.escrow.stream | Operator node 2, same world, own receipt key | same | Worker `holdback-op2` (`wrangler.op2.jsonc`) |
| https://join.escrow.stream | Early-access email sign-ups (KV `EMAILS`: address, time, page; nothing else) | `apps/early-access/` | Worker `crow-early-access` |
| npc.here.now/escrow | Old address; a redirect to escrow.stream | `reports/redirect/` (not in git) | here.now; no further publishing needed |

All on Rafa's Cloudflare account (`CLOUDFLARE_ACCOUNT_ID` in `config/keys-dev-env.template`). The domain `escrow.stream` was bought on Cloudflare (`brand/domain.md`).

**Demo settings** (in `apps/demo-cloud/wrangler.op1.jsonc` vars): minimum window 60 s; operator fee 1 bp, minimum 0.01 tUSD (D33, ADR-0023). Live judges: Anthropic and DeepSeek, pinned in `config/judges-live.yaml`, capped at 30 calls a day (`LIVE_JUDGE_CALLS_PER_DAY`); past the cap, or without keys, panels are scripted and every verdict says so.

**Schema:** the code on main is schema v0.8 (private deals, ADR-0024). The live demo still runs v0.7 until the next redeploy; `site/llms.txt` says so.

## Secrets

- Local secrets live in the git-ignored `.env` at the repo root (templates: `config/keys.template`, `config/keys-dev-env.template`). **Never read, print or copy `.env`** (hard rule; a permission rule also blocks it). Commands that need keys load it with Node's `--env-file`.
- Model keys reach Cloudflare only through `pnpm demo-cloud:secrets` (builds the JSON in memory, pipes it to `wrangler secret bulk`; nothing printed or written).
- `wrangler` uses Rafa's OAuth login on his Mac, or `CLOUDFLARE_API_TOKEN` (scoped to Workers and KV) in an isolated environment.

## Deploy

Always build and check before deploying; deploy only what changed. Deploys run as whoever runs them: an agent with Rafa's go-ahead (or within an approved task), using wrangler's OAuth login on Rafa's Mac or `CLOUDFLARE_API_TOKEN` in an isolated environment. Wrangler is pinned to major version 4 (`npx wrangler@4`).

```sh
# the site
node site/build.mjs --op1 https://api.escrow.stream --op2 https://api2.escrow.stream --out reports/site-out
node site/check.mjs
npx wrangler@4 deploy --config apps/site/wrangler.jsonc

# the operators (op1 first: it defines the Durable Object); keeps the custom domains in the wrangler files
pnpm demo-cloud:deploy

# a live end-to-end deal against the deployed nodes
node apps/demo-cloud/scripts/deal.ts https://api.escrow.stream https://api2.escrow.stream

# early-access sign-ups
npx wrangler@4 deploy --config apps/early-access/wrangler.jsonc
npx wrangler@4 kv key list --binding EMAILS --config apps/early-access/wrangler.jsonc --remote
```

**A schema bump resets the public world.** The World replays its journal on start, and a journal written under an older schema may not replay (2026-11-02: v0.8 refused v0.7's offers with `rulebook_unknown`, and the nodes kept serving the old version). Before deploying a schema bump, change `WORLD_NAME` in `apps/demo-cloud/src/worker.ts`; the old world's storage stays, so a `wrangler rollback` of both Workers brings it back. Check `schemaVersion` in `/v1/status` after the deploy, and `npx wrangler@4 tail holdback-op1 --format json` if it is wrong.

Workers rules learned the hard way (T-029): compile schemas at startup, not lazily inside a request (Cloudflare forbids it and the node returns error 1101); a failed Durable Object alarm must be re-armed. Deploy only from a branch that has merged main, or a deploy can drop the custom domains.

## Gates (ask Rafa first)

Anything outside the repository: a new public deployment target, Sepolia or any public chain, mainnet (never without an audit and his written approval), real keys or money, force pushes or history rewrites (also blocked by the permission deny list), repository settings, publishing or sending anything to other people.

## Working without permission prompts

Rafa's machine blocks reads outside the working directories, which makes some shell patterns prompt even in bypass mode. Keep the session's cwd at the repo root (never `cd` elsewhere; use absolute paths); change files with Edit/Write (not `sed -i`, interpreter one-liners or heredoc writes); keep logs under `reports/` (git-ignored); give build agents `isolation: "worktree"` and tell them the same.
