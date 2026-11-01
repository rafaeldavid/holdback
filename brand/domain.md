# Domain for ’crow

Status: **live on escrow.stream** (Rafa bought it on Cloudflare on 2026-11-01, "for now"). crow.so was the first choice from the study below and is not bought. `npc.here.now/escrow` redirects to escrow.stream.

## escrow.stream (live)

| Name | Serves | Worker |
| --- | --- | --- |
| `escrow.stream`, `www.escrow.stream` | the site (`index.html`, `llms.txt`, images) | `crow-site` (`apps/site/wrangler.jsonc`, static assets from `reports/site-out`) |
| `api.escrow.stream` | operator 1 | `holdback-op1` (also at its workers.dev address) |
| `api2.escrow.stream` | operator 2 | `holdback-op2` |
| `join.escrow.stream` | early-access sign-ups | `crow-early-access` |

Publish the site: `node site/build.mjs --op1 https://api.escrow.stream --op2 https://api2.escrow.stream --out reports/site-out`, copy `site/crow.png` and `site/favicon.png` into it if missing, then `npx wrangler@4 deploy --config apps/site/wrangler.jsonc`.

## What the name has to do

- Read as **crow**: the brand is ’crow, escrow with the "es" unsaid. The apostrophe cannot be in a domain.
- Work as an **API address** for agents (D30: the domain is the address; `https://<domain>/.well-known/holdback.json`). Short, unambiguous when typed by a model, no hyphens.
- Be credible for money: a serious TLD, not a joke one.
- Leave room for subdomains: `api.`, `docs.`, operator nodes (`op1.`), and later three-word agent names (backlog: agents without a domain).

## Availability check (2026-11-01)

Method: `whois` against each registry, read only. "Free?" means the registry returned no record; it is not a quote. Premium pricing, registry restrictions and the true price only show at a registrar's checkout, so confirm there before deciding.

| Domain | Status | Notes |
| --- | --- | --- |
| crow.com, crow.io, crow.co, crow.ai, crow.dev, crow.app, crow.xyz | taken | The obvious ones are all registered |
| crow.money, crow.network, crow.fi, crow.exchange, crow.markets, crow.finance, crow.cash | taken | Money TLDs taken too |
| crow.agency, crow.bot, crow.systems, crow.to, crow.sh | taken | |
| usecrow.com, trycrow.com, crowhq.com, crowlabs.com, crowpay.com, crowapi.com, crowapi.dev, crowprotocol.com, crowescrow.com | taken | Common prefixes and suffixes taken |
| scrow.com, scrow.ai, scrow.dev, escrow.ai | taken | |
| **crow.so** | free? | Short, developer-friendly (`.so` is used by many dev tools). Somalia's ccTLD: check its policies and renewal price |
| **crow.trade** | free? | Fits agent commerce; a less familiar TLD |
| **crow.tech** | free? | Neutral, readable; `.tech` reads a little generic |
| **getcrow.ai** | free? | `.ai` signals AI agents; `get` prefix is common for products. `.ai` is Anguilla's ccTLD with higher prices and a two-year minimum at many registrars |

## Recommendation

1. **crow.so**, if a registrar confirms it is available at a standard price: the shortest exact match, and it reads well as an API address (`api.crow.so`, `crow.so/llms.txt`).
2. **getcrow.ai** as the alternative that says "AI agents" in the name.
3. Register the runner-up too, and redirect it, to protect the name.

Before buying: confirm price and any premium at a registrar; check trademark conflicts for "Crow" in software and financial services (there are existing products named Crow; a search is needed, not legal advice); confirm the ccTLD's rules (Somalia for `.so`, Anguilla for `.ai`) are acceptable for a financial-adjacent product.

## After buying

- Point the domain at the site (here.now supports custom domains) and the API at the Cloudflare Workers (custom domains on Workers), for example `crow.so` for the site and `api.crow.so` for operator 1.
- Update `site/build.mjs` (`SITE_URL`), `llms.txt`, the faucet and early-access allowed origins, and the discovery documents.
