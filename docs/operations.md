# Operations: what is live and how to change it

The public demo of Crow (the Holdback protocol). Test tokens only; nothing here moves real money. Read `CLAUDE.md` first.

## What is live

| Address | What | Source | Deployed by |
| --- | --- | --- | --- |
| https://crow.direct (and `www.`) | The site: the landing page from Rafa's mock (D56), early access, the Try line; agent docs at `/llms.txt` | `site/` (`site/llms.txt` is the one source; `site/build.mjs` renders the page) | Cloudflare Worker `crow-site`, static assets behind `apps/site/worker.js` (`apps/site/wrangler.jsonc`) |
| https://api.crow.direct | Operator node 1, home of the World Durable Object (the faucet, the adjudicators and the operators' view), which settles on Ethereum Sepolia since 2026-11-03 (D41; SimChain on a rollback) | `apps/demo-cloud/` (wraps `apps/operator`, `packages/settlement/sim`, `apps/adjudicator`) | Worker `holdback-op1` (`apps/demo-cloud/wrangler.op1.jsonc`) |
| https://api2.crow.direct | Operator node 2, same world, own receipt key | same | Worker `holdback-op2` (`wrangler.op2.jsonc`) |
| https://join.crow.direct | Early-access email sign-ups (KV `EMAILS`: address, time, page; nothing else) | `apps/early-access/` | Worker `crow-early-access`, one KV namespace for both hostnames |
| https://crow.direct/agents/test-seller | Crow's test seller (D47, T-222): a standing party that sells one test dataset over the operators' public API. Live since 2026-11-04 (T-222 Evidence) | `apps/test-agents/` (reuses `examples/agent.ts` and `verify.ts`) | Worker `crow-test-agents` on the route `crow.direct/agents/test-seller*` (`apps/test-agents/wrangler.jsonc`) |
| Ethereum Sepolia (chain 11155111) | The reviewed settlement contracts under EIP-712 domain 0.7 and their tUSDC test token, which the live demo settles on since 2026-11-04 (ADR-0029). The domain 0.6 deployment of 2026-11-03 still settles the deals opened on it | `contracts/src/` at `64be1f1`; addresses in `contracts/deployments/sepolia.json` (the 0.6 deployment, from `2342756`: `sepolia-2026-11-03-domain-0.6.json`) | `contracts/script/deploy-sepolia.sh` (T-206), with a throwaway deployer key |
| escrow.stream, www.escrow.stream, join.escrow.stream, escrow.stream/agents/test-seller | The old hostnames, kept while the forwarding runs (T-312): the site answers with a 301 to the same path on crow.direct, sign-ups and the test seller with a 308 (a browser sign-up from an old page is served in place). api.escrow.stream and api2.escrow.stream are not redirected: the operators serve both hostnames | `apps/site/worker.js`, `apps/early-access/worker.js`, `apps/test-agents/src/worker.ts` | the same Workers, with the old hostnames as extra Custom Domains and routes |
| npc.here.now/escrow | Old address; a redirect to escrow.stream, which forwards to crow.direct | `reports/redirect/` (not in git) | here.now; no further publishing needed |

All on Rafa's Cloudflare account (its ID goes in `CLOUDFLARE_ACCOUNT_ID` in the git-ignored `.env`; template: `config/keys-dev-env.template`). The domains `escrow.stream` and `crow.direct` (Rafa, 2026-11-10) were bought on Cloudflare; crow.direct is the canonical home since T-312's deploy, and Crow Control lives at control.crow.direct since 2026-11-11 (below).

**Demo settings** (in `apps/demo-cloud/wrangler.op1.jsonc` vars): minimum window 60 s; operator fee 1 bp, minimum 0.01 tUSD (D33, ADR-0023). Live judges: Anthropic and DeepSeek, pinned in `config/judges-live.yaml`, capped at 30 calls a day (`LIVE_JUDGE_CALLS_PER_DAY`); past the cap, or without keys, panels are scripted and every verdict says so.

**Schema:** main and the live demo run schema v0.10 (T-221, additive); the demo has served it since T-220's deploy on 2026-11-05 (below). Both sign under EIP-712 domain 0.7 (ADR-0029: decisions and early accepts name the delivery), against the 0.7 contracts on Sepolia (since 2026-11-04). `/v1/status` reports `schemaVersion` and the domain.

> **A build and the contracts it settles on must share one EIP-712 domain.** A contract change that moves the domain ships as a new deployment: deploy it, update `contracts/deployments/sepolia.json` (and its copy in `examples/deployments.ts`, and the pins in `site/llms.txt`), and only then deploy the Workers and the site. The Sepolia world refuses to start against a contract under another domain (`LiveChain.verify`, `domainMismatch`); the SimChain world and the site have no such check. ADR-0029 §8 has the steps. A new rules contract also means a new world (D49): the Sepolia world refuses to open against another rules address (`apps/demo-cloud/src/world.ts`).

## Secrets

- Local secrets live in the git-ignored `.env` at the repo root (templates: `config/keys.template`, `config/keys-dev-env.template`). **Never read, print or copy `.env`** (hard rule; a permission rule also blocks it). Commands that need keys load it with Node's `--env-file`.
- Model keys reach Cloudflare only through `pnpm demo-cloud:secrets` (builds the JSON in memory, pipes it to `wrangler secret bulk`; nothing printed or written).
- **The Sepolia relayer key** (D41, ADR-0028) is the Worker secret `SEPOLIA_RELAYER_KEY` on holdback-op1, made by `node apps/demo-cloud/scripts/relayer.mjs`: it generates a fresh key in memory, pipes it to `wrangler secret bulk` and prints only the public addresses. It is a Sepolia-only gas payer with no role in any contract, and it refuses to replace an existing key (`--replace` overrides; the old lanes' Sepolia ETH would be stranded). Set 2026-11-03; its funding lane is `0x601137a8DE7E195E1426f57C053aFa49B20Ef555` (Rafa funds this one), and the world tops up its three deal lanes from it: `0x5e7F1a8C06f357e8E321Ba33A3fFb0b4a0fd3243`, `0xDB940F8613aceE33465f62400395262126791879`, `0xbDd9f277360A6243446A57Ab59ACf8c488a95a1B`. Optional secret `SEPOLIA_RPC_URLS` (comma-separated keyed URLs, tried before the public ones); optional variable `SEPOLIA_MAX_FEE_GWEI` (default 20).
- **The test seller's secret** (D47, T-222) is the Worker secret `TEST_AGENTS_SEED` on crow-test-agents, made by `node apps/test-agents/scripts/seed.mjs`: it generates 32 random bytes in memory, pipes them to `wrangler secret bulk` and prints only the intake's public encryption key. Every key the seller uses derives from it (`apps/test-agents/src/keys.ts`). It is Sepolia-only, holds no ETH (the operators pay the gas) and guards worthless test tokens; it refuses to replace an existing secret (`--replace` overrides, which gives the seller a new address and a new intake key).
- `wrangler` uses Rafa's OAuth login on his Mac, or `CLOUDFLARE_API_TOKEN` (scoped to Workers and KV) in an isolated environment.

## Deploy

Always build and check before deploying; deploy only what changed. Deploys run as whoever runs them: an agent with Rafa's go-ahead (or within an approved task), using wrangler's OAuth login on Rafa's Mac or `CLOUDFLARE_API_TOKEN` in an isolated environment. Wrangler is pinned to major version 4 (`npx wrangler@4`).

```sh
# the site: builds, runs site/check.mjs, deploys, checks the live page, llms.txt and try.mjs, and rolls back on its own
pnpm site:deploy

# the operators (op1 first: it defines the Durable Object); keeps the custom domains in the wrangler files.
# It checks itself with one test deal and rolls back on its own: "A demo deploy", below
pnpm demo-cloud:deploy

# a live end-to-end deal against the deployed nodes (the deploy runs one; deal.ts runs on SimChain only)
HOLDBACK_OPERATORS=https://api.crow.direct,https://api2.crow.direct node examples/try.ts

# early-access sign-ups
npx wrangler@4 deploy --config apps/early-access/wrangler.jsonc
npx wrangler@4 kv key list --binding EMAILS --config apps/early-access/wrangler.jsonc --remote

# Crow's test seller (T-222): deploys, waits for /health to read operational, and rolls back on its own
node apps/test-agents/scripts/deploy.mjs

# Crow's test buyer (T-239): the same Worker and the same command; then check the buyer and run one deal
node apps/test-agents/scripts/deploy.mjs
curl -s https://crow.direct/agents/test-buyer/health
node apps/test-agents/scripts/sell-to-test-buyer.mjs
```

**Every deploy script starts with a pre-flight** (T-313, `scripts/deploy-lib.mjs`). It refuses, with exit code 2 and before any build or upload, a checkout whose tracked files differ from its commit, and one that lacks origin/main's commits after a fresh fetch. So a deploy uploads the commit its record line names, and never an old wrangler file. Untracked files are fine.

**A demo deploy** (T-234; Rafa's go-ahead first, as for every deploy):

1. From main at the commit to deploy, run `pnpm demo-cloud:deploy`. It builds, reads each Worker's live version (its rollback target), deploys holdback-op1 then holdback-op2, and waits until both nodes answer `/v1/status` 200. It then runs one `examples/try.ts` deal against both operators, which must end Released within 180 s.
2. It exits 0 on a pass. It exits 1 when an upload is refused or a later step fails, after it rolls back each Worker that changed.
3. Paste the Markdown line it prints into this file, under a heading for the task. The line gives the date, the commit and its branch, each new version and its rollback target, the smoke deal's ID and time, and pass or fail.

**Before an operator deploy that changes the screen version** (since PR 386, T-367): check that no deal is open first. After such a deploy the adjudicator refuses every deal accepted before the deploy and still open, with `policy_mismatch`. Each such deal runs down to its default outcome with no judgment. Deploy only when no such deal is open. The three reads that list the open deals are in `docs/tasks/T-367-screen-audit-lines.md`, Handoff. This holds until the fix that T-373's decision record tracks is built.

**To roll back by hand**, use the rollback targets the line names, both operators together:
- `npx wrangler@4 rollback <holdback-op1 target> --name holdback-op1`
- `npx wrangler@4 rollback <holdback-op2 target> --name holdback-op2`

**Crow's test seller, the first deploy** (D47; Rafa's go-ahead first). Done on 2026-11-04. Since T-313 the script reads the live version before it uploads, so a Worker that was never deployed takes its first upload from `npx wrangler@4 deploy --config apps/test-agents/wrangler.jsonc` by hand; every later deploy uses the script. The site's one command buys from the test seller, so the seller goes live before the site that names it:

1. `node apps/test-agents/scripts/deploy.mjs`: the Worker, its Durable Object and its routes `crow.direct/agents/test-seller*` and `escrow.stream/agents/test-seller*`. The route takes that path before crow-site's Custom Domain, as Cloudflare documents. If it does not, switch the route to the Custom Domain `agents.crow.direct`, and change `SELLER_URL` and `TEST_SELLER_URL` in `site/build.mjs` to match.
2. `node apps/test-agents/scripts/seed.mjs`: sets `TEST_AGENTS_SEED`.
3. Check that `https://crow.direct/agents/test-seller/health` reads `operational`, and that `https://crow.direct/` is still the site.
4. Measure which client IP the operators see for the seller's calls: the seller and the operators share the zone, so `cf-connecting-ip` follows `x-real-ip`, which the seller never sets (research note, section 5). It needs the faucet about once a month, so a shared bucket does not bind.
5. Run one deal: `node site/try.mjs --seller https://crow.direct/agents/test-seller`, then once with `--outcome refund`. Record the transactions in T-222's Evidence.
6. Publish the site (above).

If the seller is down or busy, `try.mjs` plays both sides and says so, so a site published first still completes a deal. **The mandate runs out after 30 days.** The seller asks the faucet for a fresh one 2 hours before. With T-223 (PR 191) each grant signs a new 30-day mandate. Operators that do not yet run T-223 return the address's existing mandate (D47), so the seller marks itself degraded and its health line reads `degraded`. In that case Rafa deploys the operators, or rotates the secret with `seed.mjs --replace`; a world reset also clears it.

**Crow's test buyer, the first deploy** (T-239; Rafa's go-ahead first). The buyer runs in crow-test-agents beside the seller, on the route `crow.direct/agents/test-buyer*` with `BUYER_URL` set (`apps/test-agents/wrangler.jsonc`). Its key derives from `TEST_AGENTS_SEED` under its own label, so it needs no new secret. It takes its test tUSDC and its mandate from the faucet, and holds no ETH.

1. `node apps/test-agents/scripts/deploy.mjs`: uploads the Worker with the new route. The script's checks read the seller's health only.
2. `curl -s https://crow.direct/agents/test-buyer/health` should read `"status": "operational"`, and `https://crow.direct/agents/test-buyer/agent.json` a `crow-buyer` card.
3. `node apps/test-agents/scripts/sell-to-test-buyer.mjs` plays an outside seller with fresh keys and should end `released`; add `--outcome refund` to see a refund. Record the transactions in T-239's Evidence.

**Test seller deploy 2026-11-11 15:16 UTC, commit `7103cdf`: pass.** crow-test-agents `830eb7e1-9c6d-4892-a153-97b87bf17faa` (rollback target `545afdd8-1e1c-40ff-aa35-2eea83d9ec0e`). This deploy put the test buyer live. The first seller-started deal, `0xd298b3da40a61685ff5903284131607582b9b05dc41a14fa78401facf25c687a`, ended Released (T-239 Evidence) [measured].

**Test seller deploy 2026-11-11 15:45 UTC, commit `69c783b`: pass.** crow-test-agents `6d3b1cb7-dcd3-4ad9-81b8-7042693b9d21` (rollback target `830eb7e1-9c6d-4892-a153-97b87bf17faa`). It carries PR 313's review fixes to the test buyer. A seller-started deal against it, `0xe855a9baf0c72677e92bced214abaa0f62b9b9bf4f993fc051e14e3e5e549b01`, ended Released on Sepolia [measured].

**A world changes in place (D49).** The Sepolia world replays nothing on open, and each deal's book carries its own rulebook. So a rulebook change, an additive schema bump or a code deploy keeps the world names as they are, and deals open at the deploy continue. A new world is for a new rules contract or another chain only; record the switch below. The SimChain world still replays its journal on open, so a rulebook change there needs a new `sim` name (2026-11-02: v0.8 refused v0.7's offers with `rulebook_unknown`). Check `schemaVersion` in `/v1/status` after a deploy, and run `npx wrangler@4 tail holdback-op1 --format json` if it is wrong.

**When a world changes** (D49): Rafa approves the redeploy. Switch while no deal is open on the old world, or send its permissionless timeouts afterwards and record them. Record here the old world's name, rules address and deployment file, the new world's, the Worker versions and the bonds' transactions. Never delete a world's storage: a rollback of both Workers serves it again.

Workers rules learned the hard way (T-029, T-233): generate no code, at startup or inside a request. Core's validators are compiled ahead of time (T-233): a compile inside a request fails with error 1101, and one at startup spends the 1 s startup CPU limit (code 10021). A failed Durable Object alarm must be re-armed. Deploy only from a branch that has merged main, or a deploy can drop the custom domains.

## Settlement: SimChain or Sepolia (D41, ADR-0028)

Each operator Worker has a variable `SETTLEMENT`, `sim` or `sepolia`, in its wrangler file. It picks the world the Worker forwards to: `holdback-public-demo-2026-11-04` (SimChain) or `holdback-public-demo-sepolia-2026-11-04` (Sepolia), in `apps/demo-cloud/src/worker.ts`. Both names moved on 2026-11-04 with schema v0.9 and the 0.7 contracts; since D49 the Sepolia name moves only for a new rules contract or another chain; the earlier worlds (`holdback-public-demo-2026-11-02`, `holdback-public-demo-sepolia-2026-11-03`) keep their storage for a rollback of both Workers. The two worlds never share storage. A world records its settlement when it is created and keeps it; the Durable Object always runs holdback-op1's code and environment, so the Sepolia secrets live on holdback-op1 whichever Worker a request came through.

**Domain 0.7 (ADR-0029):** the 0.7 contracts are on Sepolia since 2026-11-04 and the build names them. A Sepolia world started against a contract under another domain refuses to start ("the rules contract signs under EIP-712 domain "Holdback" 0.6, this build under "Holdback" 0.7"). Deals opened on the 0.6 deployment finish on it: every timeout there is permissionless, and its addresses are in `contracts/deployments/sepolia-2026-11-03-domain-0.6.json`.

**What the Sepolia world needs before any Worker flips:** `contracts/deployments/sepolia.json` on main (T-206; the build embeds it), its copy in `examples/deployments.ts`, the relayer secret on holdback-op1 (above), and Sepolia ETH on the funding lane. On its first passes the world tops up the deal lanes, then bonds each demo adjudicator (25,000 tUSDC, minted, approved and deposited from its own key); `notices` on a state read say so until the bonds are in place.

**Cutover** (Rafa approved it on 2026-11-03):

1. Deploy holdback-op1's code with `SETTLEMENT` still `sim`: `pnpm -C apps/demo-cloud build`, then `npx wrangler@4 deploy -c apps/demo-cloud/wrangler.op1.jsonc --var SETTLEMENT:sim`. The SimChain demo keeps running.
2. Deploy holdback-op2 with `SETTLEMENT` `sepolia`. Smoke test against op2's two origins: `HOLDBACK_OPERATORS=https://api2.crow.direct,https://holdback-op2.<account>.workers.dev node examples/try.ts`; it must end Released with three Sepolia transaction links. From here until step 4 the try command in `llms.txt` fails: try.mjs requires both operators to serve one discovery document, and op1 still serves SimChain's.
3. Deploy the site at once (the Sepolia `llms.txt`, and a `try.mjs` that knows both the SimChain and the Sepolia pins).
4. Deploy holdback-op1 with `SETTLEMENT` `sepolia`, and run the one command from `llms.txt` ("Try it"). Steps 2 to 4 take a few minutes; that is the window in which the try command fails.

**Rollback:** set `SETTLEMENT` back to `sim` on both wrangler files and run `pnpm demo-cloud:deploy`, then deploy the previous site build (`npx wrangler@4 rollback` on `crow-site`). The SimChain world resumes where it stopped; the Sepolia world's storage and its deals on chain stay, and a later flip back serves them again.

**The 0.7 cutover, 2026-11-04, about 08:30 UTC** (Rafa approved it the same day; T-212 Handoff): the 0.7 contracts, then holdback-op1 `5d369b0e`, holdback-op2 `1f169857` and crow-site `87d3c54c`, all built from `t-212-sepolia-redeploy` (main at `64be1f1` plus the new record, the world names and the site pins). Both Workers deployed together (`pnpm demo-cloud:deploy`), since both already settled on Sepolia. To roll back to the 0.6 world: holdback-op1 `3b6febc8`, holdback-op2 `45c2e6a9` and crow-site `671481dc` (`npx wrangler@4 rollback <version> --name <worker>` for each); the 0.6 world's storage and its deals on chain stay.

**2026-11-04, about 16:40 UTC** (Rafa's go-ahead: "You can deploy what's ready btw? like the test seller?"), all built from main at `dd0a55a`, in the same 0.7 world:
- crow-test-agents `9d171ddc` (new: Crow's test seller, T-222);
- crow-site `5582b10e` (llms.txt names the test seller; try.mjs sha256 `26ccaa80…`);
- holdback-op1 `50fd05c4` and holdback-op2 `1a95b960`, with T-210's and T-211's fixes.

After the deploy, a smoke deal ended Released in 44 s, and the test seller sold once each way (T-222 Evidence) [measured]. To roll back: holdback-op1 `5d369b0e`, holdback-op2 `1f169857` and crow-site `cb0adcb5` (`npx wrangler@4 rollback <version> --name <worker>`); `npx wrangler@4 delete --name crow-test-agents` removes the seller.

### T-367: the screen change (operators and site deployed 2026-11-12)

Rafa ran the operator deploy, from `8d20405`, the commit that holds PR 386 (T-367), and the site deploy of 06:57 UTC, which uploaded `sell.txt`, `llms.txt` and `version.json`. The coordinating session ran the site deploy of 07:00 UTC on Rafa's word; it changed no asset.

**Deploy 2026-11-12 06:55 UTC, commit `8d20405` on branch `main`: pass.** holdback-op1 `d8545ef2-7c4a-427c-ac3e-c17b9f4df039` (rollback target `08524578-c766-4633-8b95-e9dc9e153b72`), holdback-op2 `2599701e-9ffe-4788-b694-8d2d8dfa4ef7` (rollback target `c3c15379-fedb-4533-8941-0ac762d61a2a`). Smoke deal `0x4a3c63f95360cfa13493a6c6295c52745ed63ec95eccf9f7d826072eb1b7d0af` Released in 50 s.

**Site deploy 2026-11-12 06:57 UTC, commit `8d20405` on branch `main`: pass.** crow-site `a806e65b-fff0-470a-9bc9-d4039a14b087` (rollback target `cb842681-4a45-4f9a-a97e-265dc725f323`).

**Site deploy 2026-11-12 07:00 UTC, commit `8d20405` on branch `main`: pass.** crow-site `3564b317-b922-435f-9e7f-9c1b09ddec55` (rollback target `a806e65b-fff0-470a-9bc9-d4039a14b087`).

**The screen is live** [measured by the coordinating session]. The live operators serve `8d20405` since about 07:01 UTC, and the three demo adjudicators register `screen-1`. Just after the 06:55 deploy the service still reported `00be274` and `screen-0`. A smoke deal against the new screen at 07:05 UTC, `0x7b1b107c3921c73c0ab25fd91a3397e738930e22de5399ec4592aaa05c867d87`, ended Released in 42 s.

### T-366, T-368 and T-370: the seller adapter's API shapes, the buyer's approval stop and the discovery fields (operators deployed 2026-11-12)

Rafa ran this deploy on 2026-11-12, from `00be274`, before PR 386 (T-367). PR 216's discovery fields are live on both operators [measured by the coordinating session at 06:56 UTC: `demo.build.commit` is `00be274…` on both, with one funding lane and three deal lanes, `mintsPerDay` 600, and `byModel` empty].

**Deploy 2026-11-12 06:53 UTC, commit `00be274` on branch `main`: pass.** holdback-op1 `08524578-c766-4633-8b95-e9dc9e153b72` (rollback target `b531c0bc-c1b9-407a-b2d3-8f9cadd7bc4b`), holdback-op2 `c3c15379-fedb-4533-8941-0ac762d61a2a` (rollback target `aacbd652-ca95-4815-9223-93121806ca95`). Smoke deal `0x0ceb3fd15dd9a0f244ee9e87c22ca31002bb21f0741e5ddfda1ae44386dc1a66` Released in 42 s.

### T-359: the seller's page (site deployed 2026-11-12)

**Site deploy 2026-11-12 05:14 UTC, commit `18d2225` on branch `main`: pass.** crow-site `cb842681-4a45-4f9a-a97e-265dc725f323` (rollback target `106cdd47-c29b-41cb-825b-1c296ba75cda`).

Rafa ran it. The seller's page is live at `https://crow.direct/sell.txt` [measured by the coordinating session: HTTP 200, 33,495 bytes], and `llms.txt` points to it in place of the four seller sections.

### T-347: the operators catch up with `main` (deployed 2026-11-12)

Rafa ran this deploy on 2026-11-12. With it, T-347's fix is live: an unreadable delivery no longer stalls the adjudicator's other deals (PR 346).

**Deploy 2026-11-12 05:01 UTC, commit `2d03383` on branch `main`: pass.** holdback-op1 `b531c0bc-c1b9-407a-b2d3-8f9cadd7bc4b` (rollback target `c93d6786-0171-4299-8d93-5b227b3aedfa`), holdback-op2 `aacbd652-ca95-4815-9223-93121806ca95` (rollback target `24387d5f-e083-413a-8893-ace4204bec3c`). Smoke deal `0xbce2f1a4a1b2be922fe291baf4665def274f42adabf86733a55a20b240b48a18` Released in 51 s.

### T-329 and T-330: the refused report and terms set per quote in the agent docs (site deployed 2026-11-11)

**Site deploy 2026-11-11 20:18 UTC, commit `5a90dc5` on branch `main`: deployed by Rafa.** crow-site `106cdd47` (rollback target `feff0e7f-fd7b-4d80-88cc-34405ea80092`). The coordinator's log records the version, the commit and the rollback target; no check result is recorded here. The `site/` commits since the previous deploy (`ac2d2b6`) are T-329's `llms.txt` lines on fixing a refused report and T-330's two sections on terms set per quote [inferred: `git log ac2d2b6..5a90dc5 -- site/`]. The operators and the test agents were not deployed with it.

### T-323 to T-327: the report converter, the buyer signer's outcome and the adjudicator's reference files (deployed 2026-11-11)

All three deploys below ran on Rafa's go-ahead, or by Rafa himself, on 2026-11-11.

**Site deploy 2026-11-11 15:56 UTC, commit `ac2d2b6` on branch `main`: pass.** crow-site `feff0e7f-fd7b-4d80-88cc-34405ea80092` (rollback target `a3fd2ab0-efb9-4d63-af16-659083754387`). Only `/llms.txt` changed; the live file is 97,269 bytes.

**Deploy 2026-11-11 15:54 UTC, commit `ac2d2b6` on branch `main`: pass.** holdback-op1 `c93d6786-0171-4299-8d93-5b227b3aedfa` (rollback target `80b683f0-9023-4506-91e9-97c10f22809f`), holdback-op2 `24387d5f-e083-413a-8893-ace4204bec3c` (rollback target `2bfc0d0f-f9e6-4363-bdb3-baa90e3ebe54`). Smoke deal `0xb47e5385c117591b0b27b08293e52450c48b3d0bec1a532a8ce3a8f59f36d100` Released in 44 s. It carries T-327's PRs 306 and 312. The smoke deal has no reference check, so no live deal has exercised the reference path.

**Site deploy 2026-11-11 15:04 UTC, commit `488f30a` on a detached HEAD: pass.** crow-site `a3fd2ab0-efb9-4d63-af16-659083754387` (rollback target `6094a438-4ada-4826-861f-10f6d99f4ad4`). Only `/llms.txt` changed: T-323's line on report mappings.

### T-318 to T-321: the seller adapter, the buyer signer and the audit-deal docs (site deployed 2026-11-11)

**Site deploy 2026-11-11 09:28 UTC, commit `be19adc` on a detached HEAD: pass.** crow-site `6094a438-4ada-4826-861f-10f6d99f4ad4` (rollback target `33f0658b-1a40-4b2e-8f4a-904359d131ff`).

Rafa gave the go-ahead ("deploy when ready", 2026-11-11). This was a site deploy only: T-318 to T-321 changed examples, fixtures and `site/llms.txt`, and no operator code. After it, `https://crow.direct/llms.txt` serves the sections "Sell a priced API service", "A seller's client can carry the buyer's side" and "Writing checks for a report" [measured]. `node site/check.mjs` failed before the deploy, because `reports/site-out` held the earlier build, and passed after the deploy script rebuilt it [measured].

### T-314 to T-317: the faucet's stated amount, the ciphertext cap, the seller's check runner and the audit-report template (deployed 2026-11-11)

**Deploy 2026-11-11 07:54 UTC, commit `a42dc45` on branch `docs-deploy-2026-11-11`: pass.** holdback-op1 `80b683f0-9023-4506-91e9-97c10f22809f` (rollback target `f71bfaef-31ce-4535-bde7-15628384b55a`), holdback-op2 `2bfc0d0f-f9e6-4363-bdb3-baa90e3ebe54` (rollback target `60a7253a-a8a0-42c0-a0cc-ae43c8405fce`). Smoke deal `0xe47c874564d8c10ff56709629d8254fc832cf1cd6f1d113cddb753cbcc81b0a7` Released in 44 s.

**Site deploy 2026-11-11 07:56 UTC, commit `a42dc45` on branch `docs-deploy-2026-11-11`: pass.** crow-site `2d11374e-c999-4012-8d24-68f482363f37` (rollback target `4ceb5f29-6705-42ed-b9bd-3265a2f8d8de`).

Both operators and the site run main's tip `a42dc45`, on Rafa's go-ahead ("deploy when ready", 2026-11-11). The deploy shipped PRs 273, 274, 276 and 278 with `pnpm demo-cloud:deploy`, then `pnpm site:deploy`. No world, contract or domain changed. holdback-op2 no longer carries the variable `OPERATOR_URLS`, as PR 262 merged it (T-313).

The deploy ran from a clean worktree at `a42dc45`, which is why the lines name the branch `docs-deploy-2026-11-11`. The main checkout refused in pre-flight (exit code 2, nothing uploaded): its submodule `contracts/lib/commerce-payments` has a changed file in the nested `lib/spend-permissions`. Clean that submodule before the next deploy from the main checkout.

Checks on the live service after the deploy (measured):

- Discovery on both nodes states `limits.maxCiphertextBytes` 1048576 (1 MiB) and `demo.faucet.maxGrant` 1000000000000 base units (1,000,000 tUSDC).
- `POST /v1/faucet` with `"amount": "2005710000"` for a fresh address answered 200 with a balance of 2005710000 base units (2,005.71 tUSDC).
- `https://crow.direct/llms.txt` has the section "Writing checks for a report".

### T-312: crow.direct, the new landing page and escrow.stream forwarding (deployed 2026-11-10)

**Live since 2026-11-10, 10:33 UTC.** Rafa gave the go-ahead ("deploy when ready"). The coordinator shipped `b6b3980` from main in PR 253's order: the crow.direct domains first (`wrangler triggers deploy`, no new code), then crow-early-access, then the operators, the test seller and the site back to back. Versions and rollback targets (measured):

| Worker | Live | Rollback target |
| --- | --- | --- |
| holdback-op1 | `f71bfaef-31ce-4535-bde7-15628384b55a` | `d7211270-8310-49ec-be29-ebfc0baf793c` |
| holdback-op2 | `60a7253a-a8a0-42c0-a0cc-ae43c8405fce` | `fe75eceb-7943-4200-b48a-17808d55e64a` |
| crow-test-agents | `545afdd8-1e1c-40ff-aa35-2eea83d9ec0e` | `6122d260-d59b-41a0-8699-3bc6cacaa354` |
| crow-early-access | `99c500b2-c49e-4fb9-8348-083d0b939233` | `973116d7-2927-4b25-97ff-27db27df1819` |
| crow-site | `56af2ef3-4614-49ce-a10d-cf1ff407fc6b` | `f9806d3c-ac4a-4cd2-81ca-518e9b88d21f` |

Roll back in pairs, as PR 253 says: the operators with the site; the test seller only with the operators.

- **The first operator deploy failed safely.** Its smoke deal did not end Released within 180 s, and the script rolled both operators back (`07eaa890` and `adaf731a`, 10:25 UTC). The script printed no reason. A test deal against the rolled-back operators then ended Released in 43 s, and the second run passed: smoke deal `0x16429663fb232df430ec7476e7c47dec8a1c6331afffdbad25b611ec8cbb1dcc` Released in 47 s (10:28 UTC). The likeliest cause is the new hostnames' DNS reaching this Mac late: crow.direct did not resolve here for several minutes after Cloudflare served it [inferred]. The deploy script now prints the smoke deal's output when it fails.
- **Post-deploy checks (measured, 10:33 to 10:34 UTC):**
  - escrow.stream and www.escrow.stream return a 301 to the same path and query on crow.direct;
  - a POST to escrow.stream/agents/test-seller gets a 308;
  - join.escrow.stream returns a 301 to join.crow.direct;
  - crow.direct serves the new landing page, and its llms.txt reads "> ’crow. Verifiable settlement for AI commerce";
  - crow.direct/try.mjs hashes to `4dab4c08…1dd21`;
  - api and api2 answer 200 on both domains;
  - join.crow.direct allows the crow.direct origin;
  - a test deal against the crow.direct operators ended Released in 48 s.
- **Not done here:** control.crow.direct (Rafa adds it to the Crow Control Access application), and the private repo's checks, which still name escrow.stream and follow the forwarding.

### T-232 and T-233, through the deploy script (deployed 2026-11-07)

**Deploy 2026-11-07 06:32 UTC, commit `db5c6c3`: pass.** holdback-op1 `d7211270-8310-49ec-be29-ebfc0baf793c` (rollback target `066f1b18-24c6-4f0f-ad45-de2c27a6823f`), holdback-op2 `fe75eceb-7943-4200-b48a-17808d55e64a` (rollback target `21cbbc0b-dd56-4d0c-af4a-c6d4916d8283`). Smoke deal `0xe116a251931aa7c1dbee66d934748095b36080d766c7ba8fde9e3635a0b81f6f` Released in 43 s.

This was `pnpm demo-cloud:deploy`'s first real run (T-234), on Rafa's go-ahead ("Yes, deploy", 2026-11-07). It shipped T-232's read-after-write fixes, T-233's precompiled validators and PR 242's CodeQL fixes. Cloudflare took the first upload of each Worker, with no start-up refusal. Both nodes then answered `/v1/status` at event 650 with 0 s lag (measured). The site didn't change, so crow-site stays `f9806d3c`. A Haiku agent ran the deploy in 6 tool calls, 66,871 tokens and 114 s; T-231's hand-run deploy took 205 calls, 369,453 tokens and 50 min (measured).

### Crow Control, the founders' console (moved to control.crow.direct on 2026-11-11)

Crow Control is the founders' console. Its code lives in a private repository, and it serves control.crow.direct behind an access proxy. The maintainers keep its deploy records privately (`docs/private-materials.md`).

**Live since 2026-11-11, about 06:44 UTC**: crow-console `001cb560-b57c-41d6-9902-13d1a3216764` serves control.crow.direct.

### T-231: the operators send due timeouts on their own (deployed 2026-11-06)

T-231 deployed 2026-11-06: holdback-op1 066f1b18-24c6-4f0f-ad45-de2c27a6823f, holdback-op2 21cbbc0b-dd56-4d0c-af4a-c6d4916d8283, crow-site f9806d3c-ac4a-4cd2-81ca-518e9b88d21f

**Live since 2026-11-06, 19:01 UTC** for the two operators and 19:08 UTC for the site (T-231 Evidence, "The deploy"). Rafa gave the go-ahead on 2026-11-06 ("Yes, deploy T-231"). A deploy session shipped PR 230's merge commit `e24204d` from main with `pnpm demo-cloud:deploy`, in the same world, `holdback-public-demo-sepolia-2026-11-04` (D49). It waited until round 1's scenario 8 run had finished (15:35 UTC, pass). It then deployed the site from the same commit, for `llms.txt`'s two new lines on deadlines.

| Worker | Live version | Deployed (UTC) | Rollback target |
| --- | --- | --- | --- |
| holdback-op1 | `066f1b18-24c6-4f0f-ad45-de2c27a6823f` | 19:01:40 | `8bcda43c-ba12-4919-9355-54048b98f720` (T-230's build) |
| holdback-op2 | `21cbbc0b-dd56-4d0c-af4a-c6d4916d8283` | 19:01:56 | `7e4d3fa5-273f-47a2-b6c4-537dbf31b58f` (T-230's build) |
| crow-site | `f9806d3c-ac4a-4cd2-81ca-518e9b88d21f` | 19:08:14 | `16038434-1066-452c-bfec-25c064547359` (T-230's site) |

Every check passed, and nothing was rolled back (measured; T-231 Evidence). Two points from the deploy:
- **The first upload was refused.** At about 18:55 UTC Cloudflare refused holdback-op1 with "Script startup exceeded CPU time limit" (code 10021). It created no version, and both nodes kept serving T-230's code. The session retried the same build with no change, and the retry passed at 19:01 UTC. Wrangler then reported startup times of 575 ms for holdback-op1 and 780 ms for holdback-op2; T-230's deploy reported 394 and 397 ms (measured). The same refusal happened on 2026-11-03 (the backlog row on start-up CPU), and T-231's Handoff carries the follow-up.
- **The switch took at most 75 s.** `/v1/status` carries no build marker, so the session read the switch from `wrangler tail`. The Durable Object's last event on `8bcda43c` was at 19:01:54 UTC, and its first on `066f1b18` at 19:02:55 UTC, 75 s after holdback-op1's deploy (measured).

**What it carries,** since T-230's build (`e5f667a`): T-231 only, in `apps/demo-cloud/src/` and `packages/settlement/evm/` (measured: `git diff --stat e5f667a e24204d`). The operators' pass sends each due timeout of every deal the world holds: the reclaim, the default, the appeal expiry and an accepted offer's expiry. It sends each one a minute after its deadline, at the relayer's gas, once the contract accepts it at a pinned block. A cap of 4 sends a pass and 200 timeouts a UTC day, 50 of them offer expiries, bounds the gas. A party's trigger after the operators' timeout answers 200 with the state it left. No contract change, no schema change, no new secret or variable.

**On Sepolia an offer expiry costs 147,581 gas** (measured: the deploy's check, transaction [`0x0c27b233…504f`](https://sepolia.etherscan.io/tx/0x0c27b23328786937454e5f031c1d1c4b9742962eb0f3614aaa47c9fe1653504f)). That is 2.2 times the 65,597 gas measured on anvil. If every timeout costs that much, the day's 200 cost about 29.5 million gas, 0.03 Sepolia ETH at 1 gwei (inferred).

**To roll back** (`npx wrangler@4 rollback <version> --name <worker>`): both operators together, then the site if its lines must go too.

- `npx wrangler@4 rollback 8bcda43c-ba12-4919-9355-54048b98f720 --name holdback-op1`
- `npx wrangler@4 rollback 7e4d3fa5-273f-47a2-b6c4-537dbf31b58f --name holdback-op2`
- `npx wrangler@4 rollback 16038434-1066-452c-bfec-25c064547359 --name crow-site`

T-231 adds one storage prefix, `ot:`, the daily budget row, which T-230's code never reads (inferred from PR 230's diff). After a rollback the operators stop sending timeouts, and a party's trigger after a timeout ran answers 409 again.

**A hand redeploy of holdback-op1** (round 1's scenario 11 pauses it) must use `e24204d` or later, or it takes T-231 back out. The `.worktrees/round1-run` checkout sits at `e24204d` since this deploy.

### T-230: the operators join a delivery that is already on chain (deployed 2026-11-06)

T-230 deployed 2026-11-06: holdback-op1 8bcda43c-ba12-4919-9355-54048b98f720, holdback-op2 7e4d3fa5-273f-47a2-b6c4-537dbf31b58f, crow-site 16038434-1066-452c-bfec-25c064547359

**Live since 2026-11-06, 12:19 UTC** for the two operators and 15:04 UTC for the site (T-230 Evidence, "The deploy"), until T-231's deploy (above) replaced all three at 19:01 and 19:08 UTC. Rafa gave the go-ahead on 2026-11-06 ("Yes, deploy T-230"). A deploy session shipped PR 232's merge commit `e5f667a` from main with `pnpm demo-cloud:deploy`, in the same world, `holdback-public-demo-sepolia-2026-11-04` (D49). It then deployed the site from the same commit, for `llms.txt`'s new line on submitting directly.

| Worker | Live version | Deployed (UTC) | Rollback target |
| --- | --- | --- | --- |
| holdback-op1 | `8bcda43c-ba12-4919-9355-54048b98f720` | 12:19:19 | `ba7a2ad9-0172-458a-92a0-5d51d18afd0a` (T-228's build) |
| holdback-op2 | `7e4d3fa5-273f-47a2-b6c4-537dbf31b58f` | 12:19:36 | `7826e3ce-b8ce-422f-a2ea-9e88bd982ba9` (T-228's build) |
| crow-site | `16038434-1066-452c-bfec-25c064547359` | 15:04:51 | `4f049eb5-34fb-4a59-843a-bd3855aaea19` (T-229's site) |

Every check passed, and nothing was rolled back (measured; T-230 Evidence). `/v1/status` carries no build marker, so the session read the switch from `wrangler tail`: the Durable Object first ran `8bcda43c` at 12:20:10 UTC, 51 s after holdback-op1's deploy. The tail saw no Durable Object event between 12:18:59 and 12:20:10 UTC, so 51 s is an upper bound. The deploy session lost its network from about 12:25 to 14:58 UTC; it finished the checks at 15:00 UTC and deployed the site at 15:04 UTC.

**What it carries,** since T-228's build (`236786a`): T-230 only, in `packages/settlement/evm/evm-settlement.ts` and `sync.ts`. An operator joins a seller's posted delivery whose hash the chain already holds, whether the post comes before or after its sync pass, and sends no second delivery that lands. When it cannot read the seller's transaction yet, it answers 409 `invalid_state`, keeps the signed copy and joins it within about a minute. No contract change, no schema change, no new secret or variable. The other files that changed since `236786a` are examples, tests, the site, and `config/model-prices.json` and `config/ops-cost-prices.json`, which only `scripts/metrics/` reads (measured: `git diff --stat 236786a e5f667a` and a search for the two file names).

**To roll back** (`npx wrangler@4 rollback <version> --name <worker>`): the targets above, both operators together, then the site if its line must go too.

- `npx wrangler@4 rollback ba7a2ad9-0172-458a-92a0-5d51d18afd0a --name holdback-op1`
- `npx wrangler@4 rollback 7826e3ce-b8ce-422f-a2ea-9e88bd982ba9 --name holdback-op2`
- `npx wrangler@4 rollback 4f049eb5 --name crow-site`

T-230 adds two book fields, `posted` and `postedKeys`, and no storage prefix, so T-228's code keeps them unread (inferred from PR 232's diff). A copy kept at the rollback then never joins, and its deal waits for the seller to post again, as before T-230.

**A hand redeploy of holdback-op1** (round 1's scenario 11 pauses it) must now use T-231's `e24204d` or later (above). The `.worktrees/round1-run` checkout sat at `e5f667a` from this deploy until T-231's.

### T-229: the One-Click prompt on the site (deployed 2026-11-05)

**Live since 2026-11-05, about 15:58 UTC** (T-229 Evidence): crow-site `4f049eb5`, until T-230's site (above) replaced it on 2026-11-06 at 15:04 UTC. Rafa gave the go-ahead on 2026-11-05 ("ship the two One-Click changes (trim llms.txt, and copy the command with the prompt)"). A deploy session built the site from PR 209's merge commit `43f8067` with the site's three commands under Deploy (above) and deployed only `crow-site`. It waited until T-228's operators were recorded as live (below), because this build's `llms.txt` carries T-228's line on closing a deal behind the chain by its timeout.

| Worker | Live version | Deployed (UTC) | Rollback target (T-220's site) |
| --- | --- | --- | --- |
| crow-site | `4f049eb5-34fb-4a59-843a-bd3855aaea19` | 15:58:05 | `704bd295` |

The deploy uploaded 2 files, `index.html` and `llms.txt`; the live copies match the build byte for byte, and `https://escrow.stream/try.mjs` still serves sha256 `cc310963…d832`, the one the command names (measured). After the deploy, a fresh Claude Code needed 1 approval per deal in both permission modes (measured; T-229 Evidence).

**To roll back:** `npx wrangler@4 rollback 704bd295 --name crow-site`. That restores the link-only prompt and the `llms.txt` without T-228's line; the operators keep T-228.

### T-228: the operators close a deal behind the chain by its timeout (deployed 2026-11-05)

T-228 deployed 2026-11-05: holdback-op1 ba7a2ad9-0172-458a-92a0-5d51d18afd0a, holdback-op2 7826e3ce-b8ce-422f-a2ea-9e88bd982ba9

**Live since 2026-11-05, about 15:29 UTC** (T-228 Evidence): holdback-op1 `ba7a2ad9` and holdback-op2 `7826e3ce`, until T-230's deploy (above) replaced both on 2026-11-06 at 12:19 UTC. Rafa gave the go-ahead on 2026-11-05 ("Yes, deploy it"). A deploy session shipped PR 207's merge commit `236786a` from main with `pnpm demo-cloud:deploy`, in the same world, `holdback-public-demo-sepolia-2026-11-04` (D49). It deployed the operators only; the site, with T-228's line in `llms.txt`, ships in its own deploy.

| Worker | Live version | Deployed (UTC) | Rollback target (T-220's build) |
| --- | --- | --- | --- |
| holdback-op1 | `ba7a2ad9-0172-458a-92a0-5d51d18afd0a` | 15:28:56 | `1d8a029c-44eb-4276-b5c0-c2c8894b25d5` |
| holdback-op2 | `7826e3ce-b8ce-422f-a2ea-9e88bd982ba9` | 15:29:13 | `a042aae3-821a-4efd-856a-42070205c45e` |

Every check passed, and nothing was rolled back (measured; T-228 Evidence, "The deploy"). `/v1/status` carries no build marker and the schema stayed 0.10, so the session read the switch from `wrangler tail`: the first Durable Object event it saw, at 15:29:33 UTC, ran `ba7a2ad9`.

**What it carries,** since T-220's build (`69021a6`): T-228 only. The operators relay a due timeout for a deal behind the chain (residual 13 in `docs/neutrality.md`) through `POST /v1/commitments/<id>/triggers/<kind>`, at their own gas; a timeout that is not due reverts in the simulation and is not sent. Signed steps for such a deal still answer `invalid_state` until T-227. No contract change, no schema change, no new secret or variable. Main reached `2e6f3c6` during the deploy; its four later commits change none of the Worker's inputs (`apps/`, `packages/`, `spec/`, `config/`, `contracts/deployments/`), only CI, docs, the site and `examples/try.test.ts` (measured: `git diff --stat 236786a 2e6f3c6`).

**To roll back** (`npx wrangler@4 rollback <version> --name <worker>`, both Workers): the targets above. T-228 adds no storage prefix, so T-220's code reads the world as it is (inferred from PR 207's diff); a timeout for a deal behind the chain then answers `invalid_state` again.

### T-220: round 1's prerequisites in one deploy (deployed 2026-11-05)

**Live since 2026-11-05, about 11:04 UTC** (T-220 Evidence): holdback-op1 `1d8a029c`, holdback-op2 `a042aae3`, and crow-site `704bd295` from 11:10 UTC. T-228's deploy (above) replaced the two operators at 15:29 UTC; crow-site `704bd295` still serves. Rafa gave the go-ahead on 2026-11-05 ("When ready, deploy"). A deploy session shipped PR 204's merge commit `69021a6` from main, in the same world, `holdback-public-demo-sepolia-2026-11-04` (D49): `WORLD_NAMES` did not change.

- holdback-op1 `1d8a029c` and holdback-op2 `a042aae3`, deployed together by `pnpm demo-cloud:deploy` between 11:03:40 and 11:04:11 UTC, on the first try;
- crow-site `704bd295`, deployed at 11:10 UTC and replaced by T-229's site (above) at 15:58 UTC; `https://escrow.stream/try.mjs` serves sha256 `cc310963…d832`.

Every step below passed (measured; T-220 Evidence). The new code answered requests at once, but `/v1/status` read schema 0.9 until 11:04:55 UTC: the Durable Object took up to 44 s to restart under the new code (measured window, inferred cause). To roll back: holdback-op1 `50fd05c4`, holdback-op2 `1a95b960`, crow-site `5582b10e` (Rollback, below).

**What it carries,** since the build it replaced (`dd0a55a`): the drand quicknet source for fallback and appeal decisions and the rulebook that names it (T-217, T-220), direct contract calls in the operators' view (T-218), an in-flight row per relayer lane (T-219), adjudicator registration through the API with schema 0.10 (T-221), a fresh 30-day mandate at every faucet grant (T-223), and post-receipt reads at the receipt's block (T-226). No contract changes, no new secret, no new variable. The gas quote stays at `OPERATOR_FEE_GAS` 4700000 (4.70 tUSDC) until T-215 lands.

**What changes for agents:** `GET /v1/clubs/demo-club` serves a new `rulebookHash`, whose rulebook names `{"source": "drand-quicknet", "chainHash": "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"}`. Deals already offered keep their old hash and their sim beacon (`Book.club`), so a fallback or appeal on them still takes the default path. An offer prepared before the deploy and posted after it gets 422 `rulebook_unknown`, whose page says to read the club again; the test seller and `try.mjs` read the hash fresh for each offer.

**Before** (read-only; save each answer under `reports/t220/`):

1. Main is merged into the branch you deploy from, `pnpm verify` passes, and the fork run passes on it (`SEPOLIA_FORK_RPC=https://ethereum-sepolia-rpc.publicnode.com pnpm exec vitest run apps/demo-cloud/src/predeploy-fork.test.ts --silent=false`, about 10 minutes; Tenderly's gateway if publicnode makes anvil exit).
2. `curl -s https://api.escrow.stream/v1/status`: `schemaVersion` 0.9, domain 0.7, `verifyingContract` `0xf38287e5c5c1f20c6d03be500edbf8a244f27cfa`.
3. `curl -s https://api.escrow.stream/v1/clubs/demo-club`: the old `rulebookHash`, with `randomness` `{"source": "sim"}`.
4. `curl -s "https://api.escrow.stream/v1/commitments?limit=200"` (and its `nextCursor` pages): the deals the world holds. Keep each open deal's id and `escrowState`, and its `rulebookHash` from `/v1/commitments/<id>/terms`. Keep also the state read of `0xf0453986b888caa632f81606bcc44b28c24f0503b25c990851ae736091405e5b`, round 1's homepage deal (T-216): `Released`, appeal `expired`, and no `delivery.submitted` among its events (measured on api.escrow.stream, 2026-11-05). Deploy step 5 expects it to fall behind.
5. The funding lane's balance (`0x601137a8DE7E195E1426f57C053aFa49B20Ef555` on Sepolia Etherscan, or `cast balance`), and the three demo adjudicators' bonds in `GET /v1/adjudicators`.
6. No deal is mid-step: the build being replaced keeps no in-flight row (T-219 is in this deploy, not in the old build). Read `head.eventSeq` in `/v1/status` twice, 30 s apart, and deploy only if it did not move.
7. **Residual 13 is decided: deploy with the honest limit** (D50, Rafa, 2026-11-05; `docs/neutrality.md`; the backlog row "the operators' adjudicators act on a deal behind the chain"). From this deploy on, the operators follow the chain (T-218), and anyone who copies a signed step from the public mempool can leave a deal behind it, even a deal that uses only the API; the demo adjudicators then do not act on that deal, and it ends by its timeouts. The T-218 red team recommended the fix before this deploy; Rafa placed it in Phase 11 as T-227, before mainnet, and `llms.txt` states the limit. Quote D50 in T-220's Evidence.

**Deploy,** both Workers together, then the site, as at the 0.7 cutover:

1. `pnpm demo-cloud:deploy` (builds, then holdback-op1, then holdback-op2). Watch `npx wrangler@4 tail holdback-op1 --format json` for the first requests. One earlier deploy was refused with "Script startup exceeded CPU time limit" and the retry passed (backlog); the curve library T-217 adds loads on first use, so startup should not move (inferred, T-217 Decision 15). Record the two version IDs.
2. `curl -s https://api.escrow.stream/v1/status` and the same on api2: `schemaVersion` 0.10, the same domain and `verifyingContract`.
3. `GET /v1/clubs/demo-club` on both nodes: `randomness` names `drand-quicknet` with the chain hash above, and `rulebookHash` is `0x3fecb058383da073d562995df281fbd28dc895c3f7c93e7114266f607218d108`, keccak256 of the rulebook's canonical JSON. Before the deploy it is `0xd25b8f97bf315dd3d4f8dfe36c472f9bc96ba7fbc742a2c3a3f04c1ecbf50c25` (measured from the live club on 2026-11-05; the new hash is that rulebook with only `randomness` changed, computed).
4. `GET /v1/adjudicators` on both nodes: the three demo adjudicators, each with a signed `registration`, `observed.bond: "bonded"` and its `observed.defaultFor` role. The first open after the deploy writes their three `ar:` rows (T-221, measured on a storage copy).
5. **The first sync passes.** The live storage was written by `dd0a55a`, before T-218: it has no `cursor` row and its books keep no `chainTxs`. So the first passes read the rules contract's logs from the deployment's `fromBlock`, 12,061,237, to the head, and count a transaction as applied when one of the deal's events names it. Watch them in the `wrangler tail` from step 1: no error. Expect one deal to fall behind, `0xf0453986…5e5b` from step 4 of Before. Its relayed `deliver` [`0x64c5c757…caf1`](https://sepolia.etherscan.io/tx/0x64c5c757d4af4fd9b40850435eefffacdabe184835bad79b36282f7addd0caf1) mined while the deployed build logged nothing (T-216, T-226), and its book already stands `Released`, so the pass cannot apply that delivery. Its state read keeps `escrowState` `Released`, the contract's stage, and gains a "Behind the chain" notice naming that transaction (inferred from `EvmSettlement.follow` and `rebuild`; the fork run starts from this build's storage, so it did not measure this). The deal is final and its money settled on chain: this is the old build's lost delivery, not a regression. Read any other deal that falls behind before going on.
6. The setup pass sends nothing: no new transaction from the funding lane, the deal lanes or the three adjudicator addresses on Etherscan, and the funding lane's balance as in step 5 of Before. Measured on the fork run: 0 transactions and an unchanged balance.
7. Every deal from step 4 of Before reads the same `escrowState` and `rulebookHash` as before (`0xf0453986…5e5b` also carries the notice from step 5).
8. The smoke deal: `HOLDBACK_OPERATORS=https://api.escrow.stream,https://api2.escrow.stream node examples/try.ts` ends Released with three Etherscan links, as at the 0.7 cutover. `apps/demo-cloud/scripts/deal.ts` runs on SimChain only: on 2026-11-05 it refused the Sepolia nodes before it sent anything.
9. The site: `node site/build.mjs --op1 https://api.escrow.stream --op2 https://api2.escrow.stream --out reports/site-out`, `node site/check.mjs`, `npx wrangler@4 deploy --config apps/site/wrangler.jsonc`. Then `https://escrow.stream/try.mjs` has sha256 `cc310963bb0833e0d23f8018eb4ea802db09fa05fbd9489020340d2be2eed832` (it serves `26ccaa80…` before), and the one command in `llms.txt` ("Try it") runs end to end against both nodes.
10. Record here the Worker and site versions, and in T-220's Evidence what each step measured. Then T-216 reruns round 1 with `--t220`. (Done for this deploy: the versions are under State, above.)

**Rollback** (`npx wrangler@4 rollback <version> --name <worker>`): holdback-op1 `50fd05c4`, holdback-op2 `1a95b960`, crow-site `5582b10e`. The world is the same under the old code (inferred, `docs/research/2026-11-04-one-world.md`, finding 3):

- the old code lists only its own prefixes, so it never reads `cursor`, `lane:`, `ar:` or `ph:` rows, and books keep `chainTxs` and `beaconSource` unread;
- the old operators serve the sim rulebook again, so new offers bind the old hash, and an offer prepared against the drand hash gets 422 `rulebook_unknown`;
- deals offered under the drand rulebook keep their book; under the old adjudicator code their fallback and appeal panels take the default path;
- money is unaffected: the chain holds it.

**Live since 2026-11-03, about 16:32 UTC** (T-213 Evidence): holdback-op1 `3b6febc8`, holdback-op2 `45c2e6a9`, and the Sepolia site. To roll back, the earlier versions are holdback-op1 `167a6e70` (before the cutover) or `36b26c6f` (the new code on SimChain), and holdback-op2 `6310f84a`. A deploy of holdback-op1 restarts the Durable Object. With T-219, live since T-220's deploy, a restart mid-step loses no deal step: each deal lane writes an in-flight row before its broadcast, and the next pass applies that transaction as the operators' relay, with the adjudicators' envelopes and the buyer's key; a client that retries with the same Idempotency-Key gets the mined result. A broadcast that times out keeps its row too, so a transaction that lands anyway applies as the relay. One limit remains: the funding lane keeps no row, so a faucet grant in flight may mint again when the client retries (test tokens only). Before T-220's deploy on 2026-11-05, the live version lost the operators' view of a transaction in flight (seen once at the cutover). One holdback-op1 deploy was refused with "Script startup exceeded CPU time limit"; the retry passed (backlog).

**Watching it:** `/v1/status` reports `settlement: {kind: "chain", chainId: "11155111"}` and the domain's `verifyingContract`; discovery's notes name the contracts, the funding lane and the explorer. Relayer balances are public on Etherscan. When a lane runs out of gas, writes on it answer `relay_refused` (the signed message stays valid elsewhere) and the faucet stops minting; top up the funding lane. Each money step waits for a block, so a test deal takes about a minute; a write that waits more than three minutes for its receipt answers 500. If its transaction lands later, T-219's in-flight row and T-218's log sync bring the operators' view of that deal up within a pass (live since T-220's deploy; the chain, not the view, holds the money).

## Telemetry (T-031)

The operator nodes keep only what they already see (ADR-0024 §1, D39), in the World Durable Object and the account's Workers Logs. Nothing is served or published; publishing any aggregate (a status or stats page) is Rafa's gate. Code: `apps/demo-cloud/src/telemetry.ts`.

- **Request log:** one line per request: Request-Id, time, node, method, route template, status, problem type, milliseconds. Never a body, a header value, an IP address, or the path (it carries addresses and IDs). Kept in World storage under `rl:<UTC hour>` for seven days, then deleted. `world.telemetry.lookup(requestId)` finds a line; the nodes' notes tell agents to quote the Request-Id.
- **Summary lines:** a `telemetry: "hour"` line when each hour ends and a `telemetry: "day"` line when each UTC day ends, written with `console.log` by the World. The World flushes at most once a minute, and an idle instance flushes waiting log lines on a timer. A line is written at the first flush after its hour ends, so a quiet hour's line can come late, at the next wake.
- **Quota warnings:** an `alert: "durable-object-quota"` line (`console.warn`) when today's use passes 80% and again at 95% of a Free-tier daily limit. The account is on Workers Paid, where those numbers are not limits, so the line is an activity signal, not a cost or outage one. The SimChain world's adjudicator alarm alone (once a second while the world is active, about 86,400 requests a day) trips the request alert on a day the world stays active for about 22 hours or more (see "Durable Object use" below).
- **No invocation logs:** both wrangler files set `observability.logs.invocation_logs` to false, because Cloudflare's invocation logs record every request's headers, which carry `Authorization` (ReadTokens) and the caller's IP. Console lines and uncaught exceptions are still kept. `wrangler tail` still shows live requests, headers included, and stores nothing.

Read the lines in the dashboard: Workers & Pages, then holdback-op1, then Observability (or Durable Objects, then the World namespace, then Observability), and filter on `telemetry` or `alert`. Live: `npx wrangler@4 tail holdback-op1 --format json`. Workers Logs keeps them 7 days on Workers Paid.

| # | Metric | Field (hour and day lines unless noted) |
| --- | --- | --- |
| 1 | Requests per route | `routes["<METHOD> <route>"].requests` |
| 2 | Errors per route | `routes[…].clientErrors` (4xx), `serverErrors` (5xx) |
| 3 | Latency per route | `routes[…].p50Ms`, `p95Ms` |
| 4 | Problems by type | `routes[…].problems` |
| 5 | 429s by bucket | `throttled.read`, `write`, `faucet` |
| 6 | Durable Object use against the Free-tier daily numbers (an activity signal on Workers Paid) | `usage.requests`, `rowsRead`, `rowsWritten` as `{used, limit, percent}` (day); `usageToday` (hour) |
| 7 | Journal size and replay cost | `journalEntries` (day); `usage.wakes`, `replayRowsRead`, `replayMs` |
| 8 | Live judge calls and tokens | `liveJudges` (day); today's count is also in discovery, `demo.judges` |
| 9 | Deal funnel | `deals.offered`, `funded`, `delivered`, `decided` (a judgment or an early accept), `final` (settled and past every appeal; an expired offer counts under `outcomes`): `.deals`, deals reaching the stage that day (day) |
| 10 | Time per stage | `deals.<stage>.medianSecFromPrevious` (day) |
| 11 | Outcomes | `outcomes.released`, `refunded`, `reclaimed`, `settled`, `expired`, `escalated`, `appealed`, `defaulted` (day) |
| 12 | Prepare against submit | `conversion.<kind>.prepared`, `submitted` (2xx only) |
| 13 | First-try success | `signers.firstDealCompleted` of `signers.fresh`: parties whose first signed event was that day, and how many of their first deals have settled and are final (day) |
| 14 | Active signers | `signers.active`: parties that signed that day, a count (day) |

Funnel and signer numbers come from settlement events and each deal's finality only; no address leaves the computation.

**Durable Object use.** The account is on Workers Paid (since 2026-11-02, per Rafa). Each month that includes 1 million Durable Object requests (alarm invocations count), 400,000 GB-s of duration, 25 billion SQLite rows read and 50 million rows written, account-wide; use past that is billed (about $0.15 per million requests, $12.50 per million GB-s, $0.001 per million rows read, $1.00 per million rows written), not refused (Cloudflare pricing, read 2026-11-03). As a daily pace that is about 33,000 requests, 13,000 GB-s, 833 million rows read and 1.7 million rows written. The World still measures its use against the Free tier's daily numbers (100,000 requests, 5,000,000 rows read, 100,000 rows written), which no longer stop anything and do not match the paid pace: requests pass the paid pace well before the 80% alert, and the row alerts fire at a small fraction of it. Before T-057, the SimChain world's per-second alarm, active all day, would have used the month's included requests in about 12 days and about 324,000 of the 400,000 GB-s (inferred: one request a second, 128 MB). Since T-057 either world, SimChain or Sepolia, runs an adjudicator pass only while a case awaits a demo adjudicator or a Sepolia world's setup is left (next list; ADR-0028 §5 as amended). The World counts every key a `get`, `list`, `put` or `delete` touches and every `setAlarm` as one row, as Cloudflare bills them. Internal rows are not counted, so the estimate is a lower bound.

- Daily while the demo is in use: search Workers Logs for `durable-object-quota`, and compare with the authoritative numbers in the dashboard (Storage & databases, then Durable Objects: account usage; the World namespace's Metrics tab), or the GraphQL Analytics API datasets `durableObjectsInvocationsAdaptiveGroups`, `durableObjectsPeriodicGroups` and `durableObjectsStorageGroups`.
- Near a limit: read the day line's `usage`. Each adjudicator pass costs one `setAlarm` (a row written), one alarm invocation (a request) and, on SimChain, one journal `advance` entry (a row written). Since T-057 a pass runs only while a case awaits a demo adjudicator (an offer to accept, a delivery, escalation or appeal to decide), on either settlement: about two passes per deal, none for reads or faucet grants. A Sepolia world also runs a pass 2 s after each setup step (verify, lane gas, bonds) while setup is left, and backs off to a minute while a step fails (an RPC down). A fallback takeover gets one alarm at its judgeBy. A case no pass can finish (a refused delivery, an undecided panel) is retried at a cadence that doubles to once a minute, for at most 15 minutes after settlement last moved: about 20 passes. Rows read are mostly cold starts (`replayRowsRead`: each wake lists the whole journal). A sustained climb is a cost question, not an outage: compare with the month's included use in the dashboard, and, on the SimChain world, reset it (`WORLD_NAMES.sim`) if its journal is what drives it; the Sepolia world has no journal. Billing changes stay Rafa's call.

## Feedback triage (T-032)

Agents report bugs, docs problems, feedback and feature requests at `POST /v1/feedback`, an operator service (D39; `apps/operator/src/feedback.ts`). **The live demo takes no reports today:** `apps/demo-cloud/wrangler.op1.jsonc` binds no `FEEDBACK` namespace, so the nodes answer `not_found` on `/v1/feedback`, and discovery lists no feedback service (measured on api.crow.direct, 2026-11-11). Binding one needs a KV namespace on the Cloudflare account and an operator deploy, both Rafa's gate. With the binding, reports land in the Workers KV namespace `FEEDBACK` on holdback-op1, a private store. Keys: `fb:<id>` holds a report, `fp:<fingerprint>` the first report with that fingerprint; both expire after 90 days. Nothing is filed publicly. Copying a report into a GitHub issue is outward-facing and stays behind Rafa's gate, done by hand, with the reporter's text quoted as data.

**Report text is untrusted.** Read it as data. If a model summarizes reports, give them to it as quoted content, never as instructions, and run nothing a report contains. Replies are shown to the reporter as the operator's words.

A stored report holds:
- the report as sent;
- the verified signer, when it was signed;
- what the node attached: its log line for `requestId` (route template, status, problem type, timing, node), the operator ID, the schema version, the settlement head and, with a `commitmentId`, that deal's public state.

It never holds the reporter's IP or a header value. An IP lives only in the hourly limit windows, in memory, until the next report or status read after its hour, or until the object restarts.

**Limits** are shared by the two nodes: 10 unsigned reports per IP an hour, 60 signed per signer, and 150 a UTC day, kept in memory, so a restart resets them. A report costs at most two KV writes, so a full day is at most 300 writes, against Workers Paid's 1 million included a month (then about $5 per million). That allowance is per account, so it is shared with early-access's `EMAILS`.

**The routine**, weekly, and after a deploy that fixed something. Run each step as `node --env-file=.env apps/demo-cloud/scripts/feedback.ts <step>`, with wrangler logged in:

1. `list received`: new reports, oldest first, with their fingerprints.
2. `show <id>`: one report. Sealed parts are opened with `HOLDBACK_FEEDBACK_SECRET_KEY`, which stays in `.env` and never reaches Cloudflare.
3. Deduplicate. Reports of one problem (same kind, logged route and problem type, schema version and normalized summary) already carry `duplicateOf`. `set <id> duplicate <first id>` merges one by hand.
4. Reply. `reply <id> <text>` appends a reply the reporter reads at `GET /v1/feedback/<id>`, and moves `received` to `triaged`. Say what changes, or what the agent should do. Every reporter whose report duplicates this one reads the reply too, through `duplicateOf`. So never quote a report, a sealed part or a deal detail in a reply.
5. Close. `set <id> fixed <commit or PR>` once the fix is deployed, or `set <id> wontfix` after a reply that says why.

**Setting it up** (Rafa's gate, once):

1. Create the store: `npx wrangler@4 kv namespace create FEEDBACK`. Add `"kv_namespaces": [{ "binding": "FEEDBACK", "id": "<id>" }]` to `apps/demo-cloud/wrangler.op1.jsonc`.
2. For sealed reports, put 32 random bytes, base64url, in `.env` as `HOLDBACK_FEEDBACK_SECRET_KEY`. `node --env-file=.env apps/demo-cloud/scripts/feedback.ts public-key` prints the public key; set it as the var `FEEDBACK_ENCRYPTION_PUBLIC_KEY` in `wrangler.op1.jsonc`. It is public, and discovery serves it as `feedback.encryptionPublicKey`.
3. `pnpm demo-cloud:deploy`.

Without the binding, `/v1/feedback` answers 404 `not_found` and discovery has no `feedback`. Without the key, the nodes take unsealed reports only.

## Sepolia contracts (T-206)

The reviewed settlement contracts are deployed on Ethereum Sepolia (chain ID 11155111), a public testnet whose coins are worthless. Addresses, transaction hashes, blocks, constructor arguments, the commit and the compiler settings are in `contracts/deployments/sepolia.json`. Read them from there, not from this page. The live demo settles on them (T-213, behind the `SETTLEMENT` flag).

- **What was deployed.**
  - Commerce Payments' `AuthCaptureEscrow` with its ERC-3009 and Permit2 collectors.
  - `DrandQuicknetBeacon`.
  - `HoldbackRules`, with an expiry margin of 86,400 s. Its constructor creates `HoldbackBonds`.
  - Permit2 and Multicall3 are the canonical contracts already on Sepolia, and the script checks their code hashes.
  - None of these contracts has an owner, pause or upgrade path, so the deployer key has no power over them.
- **Token.** `TestUSDC` ("Crow Test USDC", tUSDC, 6 decimals, EIP-712 version "1"; D42). It has USDC's ERC-3009 interface and anyone can mint it. It is not Circle's USDC.
- **How.** `contracts/script/deploy-sepolia.sh <rpc-url> <keystore-file> <password-file>` runs one `forge create --broadcast` per contract, with no `forge script` and no `cast send`. It:
  - refuses any chain except Sepolia;
  - refuses a `contracts/src`, `lib`, build config or `script/TestUSDC.sol` that differs from the commit;
  - checks that each transaction succeeded, came from the deployer, and carried this build's creation code with its encoded constructor arguments;
  - checks every wiring getter, in the rules contract, the bond vault and both collectors;
  - checks that the beacon's code hash matches the compiled `DrandQuicknetBeacon`;
  - checks that the beacon verifies drand round 1000, and refuses a signature outside G1 or another round's signature with `InvalidSignature`;
  - checks the token's EIP-712 domain;
  - writes the JSON.
- **Check it.** `contracts/script/deploy-sepolia.sh --check <rpc-url>` deploys nothing and is read-only. It runs the same checks from the recorded addresses and the checkout's build. It ties each address to the transaction that created it, and the bond vault to the rules contract's first CREATE. Then it fails unless the record it derives equals `contracts/deployments/sepolia.json`. Run it from a checkout whose build inputs equal the recorded commit's. Every check fails closed: an RPC error is a failure, never a pass.
- **Rehearse first** on a fork: `anvil --fork-url <sepolia-rpc> --fork-block-number <a recent block> --hardfork prague`. Without `--hardfork prague` the fork lacks EIP-2537 and the beacon check fails.
- **The deployer.** A throwaway key, whose address is in the JSON. It sits in an encrypted Foundry keystore at `~/.foundry/keystores/`, outside the repository, with its password in a 0600 file next to it. It only pays gas. Never print the key or the password, and never put either in `.env*`.
- **Not verified on Etherscan.** No Etherscan API key is in the environment. The JSON records the commit and compiler settings, so anyone can rebuild and compare the bytecode.
- **Redeploying.** A contract fix ships as a new deployment that new deals opt into. Deals already open keep the contracts they started with. Deploying again, to Sepolia or anywhere else, is a gate (below).
- **The 0.7 redeploy (ADR-0029; Rafa approved it on 2026-11-04).** The whole stack was deployed again from `64be1f1` with the same script, after a rehearsal on a Sepolia fork, and `--check` passes against Sepolia [measured]. The rules contract signs under "Holdback" 0.7 [measured: `eip712Domain()`]. The throwaway deployer is the one of 2026-11-03. The 0.6 deployment's record moved to `contracts/deployments/sepolia-2026-11-03-domain-0.6.json`; check it with `deploy-sepolia.sh --check` from a checkout at `2342756`, after copying that file over `sepolia.json`.

## Costs

The maintainers keep the cost notes privately (`docs/private-materials.md`).

## Headline metrics (T-066)

The maintainers keep the notes on the console's headline metrics privately (`docs/private-materials.md`). The scripts that compute them are in `scripts/metrics/`.

## Gates (ask Rafa first)

These wait for the maintainer's go-ahead:

- a deploy to any public target or public chain. A mainnet deploy also needs an audit and his written approval;
- real keys or real money;
- anything published or sent to other people;
- force pushes, history rewrites and repository settings.

## Working without permission prompts

The maintainers keep the notes on agent sessions and permission prompts privately (`docs/private-materials.md`).
