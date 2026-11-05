# Standing test counterparties on the Sepolia test environment

Research pass for Rafa's question of 2026-11-04: "For the test environment, feels like we should have a standing buyer / seller test identity that people can do test escrow with no?" Rafa decides; this note recommends, one answer per question, with a confidence. Every claim is labelled **measured** (a number this session read from a file that records a run, or a test this session ran), **documented** (Cloudflare's docs or this repository's docs state it), **inferred** (it follows from code read in this session) or **guessed** (an estimate).

## Summary

**Recommendation:** build the test seller first, as one standing identity: one Sepolia address and one intake encryption key, both derived from the Worker secret `TEST_AGENTS_SEED`. Serve it at `https://escrow.stream/agents/test-seller` from a route on the `crow-test-agents` Worker, beside the static site. It sells exactly the dataset `try.mjs` trades (3 rows of `customer_id,email` for 25 tUSDC under three checks) and offers a buyer-selected refund mode. `try.mjs` gains a `--seller <intake url>` mode that plays only the buyer, and the "Try it" command in `llms.txt` points at the test seller, with today's two-sided self-play kept as the fallback. The test buyer is a second slice, designed below so it needs no intake on the visitor's side.

Three findings change the draft in `apps/test-agents/src/`:

1. **Per-deal seller keys cost a faucet grant each.** A fresh key holds no tUSDC, so the faucet mints 1,000 tUSDC to it (about 238,000 gas when the mint goes alone, measured in T-213), spends one of the faucet's 600 mints a day, and one of the 10 grants an hour the operators allow one client. The test agents' calls all arrive at the operators as one client (section 5), so per-deal keys cap the seller at 10 deals an hour. A standing key needs the faucet once, then once per 30 days for its mandate. [inferred from `apps/demo-cloud/src/world.ts`; the gas is measured]
2. **The faucet does not renew an expired mandate.** `grantFrom` reuses any mandate it finds for the address and club, expired or not, and core refuses an offer under an expired mandate (`mandate_expired`, `packages/core/src/state.ts:158`). A standing seller stops offering 30 days after its grant unless the world resets first or the faucet learns to renew. The fix is one condition in `apps/demo-cloud/src/world.ts`, outside this task's paths. [inferred]
3. **The brief's belief about `cf-connecting-ip` holds only across zones.** Cloudflare documents that a cross-zone Worker subrequest carries the fixed `2a06:98c0:3600::103`, while a same-zone subrequest carries the value of `x-real-ip`, which the sending Worker can set. The test agents and the operators share the zone `escrow.stream`. What the operators see for an alarm-driven call that sets no `x-real-ip` is not documented; the build measures it at deploy (section 5). The recommended design depends on neither answer. [documented, with one gap]

## Scope and sources

Read in this session, at worktree `frosty-proskuriakova-5c0c85` on 2026-11-04: `CLAUDE.md`; `site/llms.txt` ("Try it", "Two agents, two people", sections 2 to 8, "Honest limits"); `examples/try.ts`, `agent.ts`, `e2e-keys.ts`, `deployments.ts`; `/Users/rafa/Documents/rafaelfyi/worker/src/agents.ts` (the rafael.fyi intake); `docs/neutrality.md`; `docs/operations.md`; `docs/writing.md`; `docs/tasks/T-212-contract-hardening.md` (Handoff, the Sepolia gas), `T-213-demo-on-sepolia.md`, `T-215-gas-share-small-deals.md`, `T-216-evm-e2e-round-1.md`; `docs/decisions-today.md` D33, D41, D42, D43, D44, D46; `docs/plan.md` and `docs/backlog.md` (searched: no row covers a standing counterparty); `docs/log/2026-11-04.md`; `apps/demo-cloud/src/world.ts` (the faucet, lines 775 to 867; the lane constants, 145 to 153; setup, 625 to 660), `worker.ts`, `wrangler.op1.jsonc`, `wrangler.op2.jsonc`; `apps/site/wrangler.jsonc`; `apps/operator/src/server.ts` (`client`, the throttles, the faucet route, `/v1/agents`, the SSE stream); `packages/settlement/evm/live.ts` (lanes, the mint batch, `GAS_CAP`), `evm-settlement.ts` (`agentMandates`, `admit`); `packages/core/src/state.ts` (`scopeAllows`); the draft `apps/test-agents/src/` (`seller.ts`, `catalog.ts`, `keys.ts`, `worker.ts`, `seller.test.ts`, `test-world.ts`, `scripts/seed.mjs`); `site/build.mjs` and `check.mjs` (how `try.mjs` is pinned). Cloudflare docs through the docs search tool: Routes, Custom Domains, Workers limits, Workers errors, HTTP headers (`CF-Connecting-IP` in Worker subrequests), the changelog of 2026-10-30.

Not done: no command was run against Sepolia or the live nodes; no Worker was deployed; the draft's 8 tests were not re-run here (the brief reports them passing, measured by the draft's author).

## Facts that bound the design

| Fact | Value | Label and source |
| --- | --- | --- |
| Gas per deal on the 0.7 contracts | fund 938,593; deliver 173,119; decide 524,530; total 1,636,242 | measured, T-212 Handoff (`node examples/try.ts` against both nodes, 2026-11-04) |
| Gas per faucet mint | a lone mint to a new holder 238,103; two in one Multicall3 call 262,195 (about 130,000 each) | measured, T-213 Evidence and `packages/settlement/evm/live.ts:116` |
| Who pays gas | the operators' relayer lanes: the funding lane (Rafa funds it) mints and tops up three deal lanes; a commitment's deal lane is its ID modulo 3; every relayed write and the adjudicators' decisions go on the deal lane | documented, ADR-0028 §3 as implemented in `live.ts:121-128` and `evm-settlement.ts:1050` |
| Lane sizing | a deal lane below 0.01 test ETH gets 0.03 from the funding lane, checked once a minute; the funding lane held 1.9375 test ETH on 2026-11-03 | measured then (`world.ts:149-151`, T-213 Handoff); today's balance is public on Etherscan, not read here |
| Relayer gas cap and fee cap | 3,000,000 gas per call after a 25 % pad; 20 gwei max fee (`SEPOLIA_MAX_FEE_GWEI`) | documented, `live.ts:114`, `worker.ts:50` |
| What is on chain before funding | nothing: the offer, the adjudicator's acceptance and the agreement stay off chain until `agreeAndFund` carries them | documented, discovery notes (`world.ts:939`) |
| Faucet | 1,000 tUSDC and a 30-day mandate (buyer and seller roles) per grant; once per address per hour (persisted); 10 grants per client per hour (in memory); 600 mints per UTC day; no mint when the address already holds 1,000 tUSDC or more; `amount` may be sent but must be at least 1 | inferred, `world.ts:783-867`, `server.ts:868-879` |
| Mandate renewal | the faucet reuses any mandate found for the address and club, expired or not; core refuses an expired one at offer | inferred, `world.ts:820`, `state.ts:158` |
| Operator throttles | 1,200 reads a minute per client; 120 writes a minute, charged to the client at entry and moved to the signer once the signature verifies; the client is `cf-connecting-ip` as the Worker forwards it | documented, `llms.txt` Conventions; `server.ts:552-598, 646-672`; `apps/demo-cloud/src/worker.ts:185` |
| Mandate checks | the seller's scope is checked at offer, the buyer's at agree | documented in `evm-settlement.ts:382` ("read it at offer and agree"); which party at which step is inferred |
| `deliverBy` | `createdAt + deliverWithinSec`, counted from the offer, not from funding; the club refuses `fundBy` at or after `deliverBy` | documented, `llms.txt` section 5; measured by the draft's author |
| A deal's duration | about a minute from funding to decision; final 60 s after the decision with the club's shortest windows | measured, T-213 (42 to 54 s to Released) |
| The buyer's cost per deal | 25 tUSDC price + 1 tUSDC adjudication fee + 4.71 tUSDC operator fee = 30.71 tUSDC; one grant covers 32 deals | documented, `llms.txt` section 6 |
| Cloudflare: routes beside a Custom Domain | "Routes can `fetch()` Custom Domains and take precedence if configured on the same hostname"; the example is a Custom Domain on `app.example.com` plus a route on `app.example.com/*` | documented, developers.cloudflare.com/workers/configuration/routing/routes/ |
| Cloudflare: same-zone Worker-to-Worker fetch | fails for a target on a route or `workers.dev` (error 1042) without a service binding; succeeds for a target on a Custom Domain | documented, .../routing/custom-domains/ ("Worker to Worker communication"), .../platform/limits/ |
| Cloudflare: `CF-Connecting-IP` in subrequests | same zone: the value of `x-real-ip`, which the Worker script can set; cross zone: the fixed `2a06:98c0:3600::103`; a Worker on a Custom Domain fetching its own hostname gets a 522 | documented, .../fundamentals/reference/http-headers/ and the changelog of 2026-10-30 |

## 1. Seller only first, or seller and buyer?

| Option | What the visitor sees | Work | Risk |
| --- | --- | --- | --- |
| A. Seller only first | Its agent buys: proposes, checks the offer on both operators, funds, watches the hold, opens the work; three Etherscan links; optionally a refund | The draft plus the fixes in section 9, a `try.mjs` mode, a `llms.txt` section, a route and a secret: about two days [guessed] | The test seller stalls: the buyer reclaims after `deliverBy` (section 7) |
| B. Seller and buyer in one build | Both roles; a seller-side visitor delivers and gets paid | About double A; the buyer needs a different intake shape (below) and its own token budget | Two services to harden at once; the buyer funds offers anyone can make to it, so its caps matter more |
| C. Buyer only first | The visitor's agent must encrypt, upload, seal and deliver: the heavier side, and it sees no money leave its own hands | As A | Fewer visitors finish |

**Evidence.** The demo's product priority is the buyer's experience: money held, a decision, a decrypted copy (`docs/demo.md`, `CLAUDE.md` "First product priority"). The vanilla Claude Code trial reached Released from the one command in 78 s (T-213 Evidence, measured); the buyer side of that run is what a visitor's agent would replay against the test seller. The "done" test in the brief names the seller: a fresh agent following `llms.txt` buys end to end on Sepolia with Etherscan links. The seller also exercises the published intake convention exactly as `rafael.fyi/agents/` does, so a visitor that later deals with a person's agent repeats the same steps.

**The test buyer needs no intake on the visitor's side.** The convention is asymmetric: the buyer sends a sealed proposal to the seller's intake. For Crow's test buyer, flip nothing: publish the buyer's standing address, its encryption key and its `wants` (the terms it funds) on `escrow.stream/agents/test-buyer`. A visitor's seller then offers on Crow naming that buyer (`llms.txt` section 5), and the test buyer finds the offer itself with `GET /v1/commitments?party=<its address>&role=buyer` (a public read the page already documents, section 6), checks the terms against its published wants, agrees and funds, waits, opens the work and records the plaintext hash in a status the visitor's seller can read. An optional `POST /agents/test-buyer/offers {commitmentId}` wakes it sooner than its poll. Its token budget comes from the faucet (1,000 tUSDC an hour at most, so 32 deals an hour sustained); its gas is the operators' as for any buyer. Its caps mirror the seller's. This is the second slice, with a `try.mjs --buyer <url>` mode that plays only the seller.

**Recommendation: A, seller only first, with the buyer specified as the next slice.** Confidence: high.

## 2. What the test seller sells

| Option | Effect |
| --- | --- |
| A. Fixed catalog, one item: `try.mjs`'s dataset, 3 rows of `customer_id,email` for 25 tUSDC, checks `cols`, `rows`, `uniq`, checks-only, public (the draft) | One known-good work body; the refund mode is one known-failing body; the buyer's `try.mjs` proposes exactly the catalog, so no counter |
| B. Accept the buyer's own checks within bounds (any checks the good CSV passes) | The seller must run the deterministic checks itself (pull `packages/judgment` into the Worker) or guess; the refund mode becomes ambiguous (which check should fail?); a buyer who writes a check the CSV fails gets a refund it did not ask for |
| C. Several catalog items | More bodies to keep known-good; no visitor asks for it yet |

**D31 and the party's right to refuse.** "Parametrize, don't restrict" binds the protocol and the API: they refuse only what is malformed. A party may sell what it likes (D28: the seller offers terms; the buyer agrees or not). A fixed catalog is a party's choice, not a protocol restriction, and it keeps the demo deterministic.

**Counter-offers.** The convention says "the proposed terms mean yes; other terms are a counter-offer", and the buyer "funds it or sends a new request" (`llms.txt`, "Two agents, two people", steps 3 and 4). The draft follows this: a proposal with other terms gets the catalog terms, marked `countered: true` in the status. Keep that, with one narrowing: counter only when the deliverable is the catalog's (kind `dataset`, format `text/csv`) and the price or checks differ; when the proposal asks for something else (a translation, JSON), answer `failed` with "this seller sells only customers.csv" instead of placing an offer on Crow that names the buyer for work it never asked about. An unfunded counter expires in 30 minutes and costs no gas. The status should also state the buyer's total (price plus the adjudication fee from the primary's registration plus the operator fee from discovery), since a proposal whose `budget.covers` is `"total"` at 25 tUSDC cannot be met and the buyer's own check will refuse the offer (section 6: "price is exactly the price you negotiated").

**Recommendation: A, the fixed one-item catalog, with the narrowed counter rule.** Confidence: high.

## 3. A "bad delivery" mode for a visible refund

| Option | How the buyer asks | Honesty |
| --- | --- | --- |
| A. Buyer-selected, in the sealed proposal: `"test": {"outcome": "refund"}` (the draft); the seller delivers 2 rows, which fails `rows` | Machine-readable, documented in the card and the page; recorded in the status as `outcome: "refund"` | The judgment record (public at this disclosure level) shows `rows` failed; the status shows the buyer asked for it |
| B. A second catalog item `customers-2` whose description says 2 rows, under the same 3-row checks | The buyer picks an item it knows will fail | Odd: a seller listing work that fails its own checks |
| C. None | The visitor sees only releases | The refund path, the one that shows the hold protecting the buyer, goes unseen |

**What the buyer loses on a refund.** The price (25 tUSDC) comes back from the hold. The adjudication fee (1 tUSDC, the primary's `fee.min`) goes to the adjudicator, and the operator fee (4.71 tUSDC) went to the operator at funding; neither is refunded (`llms.txt` "Who gets what"). So the buyer is down 5.71 tUSDC of test tokens and gets no key: the seller keeps the work. Say exactly this on the page and in the card, and compute the two fees from discovery and the primary's registration at render time rather than writing 4.71 and 1 into the code, since the operator may change its schedule (T-215).

**Disclosure.** The page states both outcomes in words; the card carries `outcomes: {release, refund}`; the status carries the outcome the buyer asked for, so nobody reads a refunded deal as the seller cheating. Add one sentence the draft lacks: Crow's maintainers run both the operators and this seller; the protocol keeps them apart (the seller holds its own keys and uses the public API), but it is not an independent business.

**Not in the first build:** a `reclaim` mode (the seller never delivers; the buyer reclaims after `deliverBy`). With `fundWithinSec` 2,400 s, `deliverWithinSec` must exceed it, so the demo would take at least 40 minutes. Backlog.

**Recommendation: A.** Confidence: high.

## 4. Where the identity lives, and the visitor's path

### The intake shape

| Option | Buyer's extra work | Fidelity |
| --- | --- | --- |
| (a) The sealed convention: `POST /v1/ciphertext`, a NaCl envelope to the intake key, `statusTokenHash`, status polling (the draft) | AES-256-GCM of the proposal, one NaCl box, one upload: about 20 lines in `try.ts`; the buyer never encrypts anything else on a checks-only deal | The same steps a visitor repeats against `rafael.fyi/agents/` or any person's agent |
| (b) A plaintext `POST {"type": "crow-proposal", ...}` since the catalog is public | None | Teaches a shape no other intake accepts; a hand-rolled agent that learns it here fails elsewhere |
| (c) Both | As (b) for whoever picks it | Two code paths to keep honest |

**Recommendation: (a) only.** The seller's catalog is public, but the convention's point is that the message carries no terms and the operator holds only ciphertext (`llms.txt`, step 2). `try.mjs` does the sealing, so the extra work falls on the script, not the visitor. Keep (b) in reserve if a vanilla trial of a hand-rolled buyer stumbles on the sealing. Confidence: medium-high.

### Hosting

| Option | How | Documented support |
| --- | --- | --- |
| A. A route `escrow.stream/agents/*` on `crow-test-agents`, beside `crow-site`'s Custom Domain on `escrow.stream` | `"routes": [{"pattern": "escrow.stream/agents/*", "zone_name": "escrow.stream"}]` in the Worker's wrangler file; `crow-site` unchanged | Yes: "Routes can `fetch()` Custom Domains and take precedence if configured on the same hostname", with exactly this example (a Custom Domain on `app.example.com`, a route on `app.example.com/*`). The hostname's proxied DNS record, which a route needs, already exists because the Custom Domain created it |
| B. `agents.escrow.stream` as the Worker's own Custom Domain | `{"pattern": "agents.escrow.stream", "custom_domain": true}`, as `api.`, `api2.` and `join.` do today | Yes, the repository's own pattern |
| C. `crow-site` gains a `main` script with `run_worker_first` for `/agents/*` and a service binding to the agents | The site deploy and the agents deploy couple | Possible, not needed |

Either A or B works for the Worker's own calls: `api.escrow.stream` and `api2.escrow.stream` are Custom Domains, so a same-zone `fetch()` to them succeeds from a Worker on a route or on a Custom Domain (documented; a route would fail only as the *target* of a same-zone fetch, which never happens here). A Worker on a Custom Domain fetching its own hostname gets a 522; the agents never fetch themselves.

**Recommendation: A, the path under the site's hostname,** because the convention publishes an intake "on its person's domain" and the buyer's rule is "because it came from the seller's domain, the offer on Crow is the seller's"; `escrow.stream/agents/test-seller` mirrors `rafael.fyi/agents/` and the site's own `/problems/<type>` pages. Measure after the first deploy that `GET /agents/test-seller` is the Worker's page and `GET /` is still the site; if the route misbehaves on this account, fall back to B the same day. Confidence: medium on A (documented, not yet tried on this account); high that one of A or B works.

### The visitor's path: by hand, or a `try.mjs` mode

| Option | A fresh agent's chance of success |
| --- | --- |
| A. Follow a new `llms.txt` section by hand: keys, faucet, seal and send the proposal, poll the status, check the offer, fund, open | Low to medium: the vanilla trial already chose the one command over the hand path; the buyer side by hand is EIP-712 for three signatures, the two ERC-3009 nonces, NaCl and AES. `site/walkthrough.mjs` proved the page is sufficient, as a scripted build, not as a fresh agent's run |
| B. `try.mjs --seller https://escrow.stream/agents/test-seller`: the same bundle, same pinning, plays only the buyer; `--outcome refund` asks for the refund | High: one approved command, as today. The hash changes with every `try.mjs` change, which `site/build.mjs` already regenerates and `check.mjs` checks |
| C. A second bundle `buy.mjs` with its own hash | Same as B with one more placeholder in `llms.txt` and `check.mjs` |

**Recommendation: B.** In `llms.txt` "Try it", the pinned command runs `node try.mjs --seller https://escrow.stream/agents/test-seller`; the next sentence says `node try.mjs` alone plays both sides with fresh keys when the test seller is busy or down (its 429 says when to retry). The buyer mode: fetch the card, propose exactly `offers[0].terms` (so there is no counter), faucet the buyer, seal and send, poll the status until `offered` (or `failed` with `detail`), then run today's `check` step against its own proposal, fund, wait for the outcome, open the work, and print the status URL (without the token), the commitment ID, the final state and the three Etherscan links. On `countered: true` it refuses (exit 3) and prints both sets of terms. "Simple API, hard protocol" holds: no new API, no SDK, one more flag on one script. Confidence: high.

## 5. Keys

| Option | Faucet calls | Linkability | The reset problem |
| --- | --- | --- | --- |
| A. Per-deal keys `seller/deal/<n>` (the draft) | One grant and one 238,000-gas mint per deal; 10 an hour for the test agents' one client identity; 600 mints a day shared with every visitor | None, which a public test seller does not need | A storage reset restarts `n`, so deal `n` reuses an address: the faucet answers 429 inside an hour of that address's last grant (persisted `fa:<address>`), and the draft marks the deal `failed` |
| B. One standing address `seller/standing` plus the standing intake key `seller/intake` (Rafa's "standing identity") | Once, then once per 30 days for the mandate; no mint after the first because the balance stays above 1,000 tUSDC (it only grows: +25 tUSDC per release) | Every deal is visible under one address: a track record the visitor can read with `GET /v1/commitments?party=<seller>&role=seller` | None |
| C. A small pool `seller/standing/<i>` | As B times the pool size | As B | None |

**The faucet dependency.** Skip the faucet when `GET /v1/agents/<address>` (from both operators) shows a mandate in `demo.clubId` whose `scope.expiresAt` is later than now plus the deal's longest window (3,600 s). Call it only when none is live. That keeps the seller off the faucet's per-client bucket and uses no operator privilege: any agent may read its own mandate. **Renewal gap:** when the mandate has expired and the faucet still answers with the expired one (finding 2), the seller must not loop; it answers new requests 503 with "the test seller cannot offer until its mandate is renewed", logs it, and the fix in `world.ts` (`grantFrom`: treat an expired mandate as absent, so `admit` replaces it, which `mandates.set` already does) ships in the operator lane. Until that fix merges, the world resets at each schema bump (`WORLD_NAMES` moved on 2026-11-02, 2026-11-03 and 2026-11-04), which has so far been sooner than 30 days; a stopgap is to rotate the seed with `seed.mjs --replace`, which makes a new standing address.

**Which client the operators see.** The brief assumed the fixed Workers IP `2a06:98c0:3600::103`. Cloudflare documents that value for cross-zone subrequests only; for a same-zone subrequest, `CF-Connecting-IP` reflects `x-real-ip`, "which can be altered by the user in their Worker script". `crow-test-agents` and `holdback-op1`/`op2` share the zone `escrow.stream`, so the subrequests are same-zone. For a call made from the Durable Object's alarm with no incoming request and no `x-real-ip` set, the docs say nothing: the operators may see the Workers IP, an empty header (`'unknown'` in `apps/demo-cloud/src/worker.ts:185`), or something else [guessed]. Two consequences:

- Whatever it is, every test-agent call shares one client bucket: 1,200 reads and 120 unsigned writes a minute, 10 faucet grants an hour. A standing key needs the faucet about once a month, and the seller's reads stay under 250 a minute at the caps in section 6, so the bucket never binds. A visitor's agent that itself runs on Cloudflare Workers in another zone shares the faucet bucket with the test agents (it arrives as `2a06:98c0:3600::103`); rare, and the error says when to retry.
- The test agents must never set `x-real-ip` on their subrequests (the draft does not; `examples/agent.ts` builds fresh headers). Attributing the seller's calls to a visitor's IP would be an operator-side privilege no outside agent has, even though Cloudflare, not the operators, grants it.

**Measure at deploy:** from the alarm, fetch `https://api.escrow.stream/cdn-cgi/trace` once and log its `ip=` line (the edge answers `/cdn-cgi/trace` for any proxied hostname [guessed: standard Cloudflare behaviour, not checked for a Workers Custom Domain]). If that path is not served, the fallback measurement is eleven faucet grants to fresh addresses within an hour from the Worker: a 429 on the eleventh proves one shared client bucket.

**Is a repeated per-deal key harmful?** Not to settlement: offers differ by nonce and `createdAt`, and a seller address may hold any number of commitments. It is harmful operationally (the 429 above) and it defeats the only reason for per-deal keys, unlinkability, which a public seller does not want. With B the question does not arise.

**The page lists the address.** The convention says an intake "lists no Crow address" because its seller uses per-deal keys. A standing seller should list its address, so the buyer's check becomes `terms.seller` equals the published address, a stronger check than "the ID came from the seller's domain". State on the page that this is a deliberate departure and why.

**Recommendation: B, one standing address and one standing intake key; the faucet only without a live mandate; the renewal fix in the operator lane.** Confidence: high.

## 6. Abuse limits and the Sepolia gas budget

### Who pays gas for each step

| Step | Who sends it | Which account | Gas | Label |
| --- | --- | --- | --- | --- |
| Faucet mint for the visitor's buyer | the operators' funding lane (`0x601137a8…`, Rafa funds it), batched within 1 s | funding lane | 238,103 alone; about 130,000 each when batched | measured (T-213, `live.ts:116`) |
| The test seller's first grant | funding lane, once | funding lane | 238,103 | measured; once |
| Offer, adjudicator acceptance, agreement | nobody: off chain until funding | none | 0 | documented |
| Agree-and-fund with the operator fee (the visitor's) | holdback-op1's relayer, the deal lane (commitment ID modulo 3) | deal lane | 938,593 | measured (T-212) |
| Delivery (the test seller's) | deal lane | deal lane | 173,119 | measured |
| Decision (the demo primary's) | deal lane | deal lane | 524,530 | measured |
| `expire-offer` on an unfunded offer | only if someone sends the trigger; the demo does not | deal lane | not needed | documented (T-216 3d) |
| `reclaim` if the seller never delivers | anyone; the demo relays it | deal lane | not measured on Sepolia; under the 3,000,000 cap | inferred |
| Appeal expiry | left to the parties; nobody sends it on the demo | none | 0 | documented (T-216 1) |

The test agents hold no Sepolia ETH and send no transaction of their own. **What they add beyond `try.mjs`:** nothing per deal with a standing key. A `try.mjs` deal costs 1,636,242 gas plus two mints (262,195 batched, 476,206 alone); a test-seller deal costs 1,636,242 plus one mint, the visitor's buyer. With the draft's per-deal keys it would cost one mint more per deal than `try.mjs`'s best case.

### The caps

| Cap | Proposed | Why |
| --- | --- | --- |
| Requests per client (IP) per rolling hour | 3 | One visitor runs one release and maybe one refund |
| Requests per client per UTC day | 10 | New in this note: a visitor that loops the command all day |
| Requests from everyone per rolling hour | 20 | A small group trying at once still fits |
| Requests from everyone per UTC day | 100 | Bounds gas and faucet mints (below) |
| Open at once (received, offered and unexpired, or delivered) | 10 | A visitor who never funds holds a slot for at most 40 minutes, since the seller marks the deal `expired` at `fundBy` |
| Unfunded offers | count against every cap | They cost a slot, a signed offer and an adjudicator pass; counting them keeps one counter and one explanation |
| `offerExpiresInSec` / `fundWithinSec` / `deliverWithinSec` | 1,800 / 2,400 / 3,600 (the draft) | A machine buyer funds within a minute; a human asked to approve funding has 30 minutes; the buyer's loss if the seller stalls is bounded at one hour after the offer (section 7). The convention's 3,600 / 7,200 is for two people relaying by hand |
| `judgeWithinSec`, `fallbackWithinSec`, `appealWindowSec`, `appealDecideSec` | 60 each | The club's minimum; final one minute after the decision |

The cap answers say when to retry (`retryAfterSec`), as the operators' 429s do, and `try.mjs` prints it and falls back to self-play on its own only if the visitor passes `--fallback`; by default it stops and says so, so the visitor sees the two-party path or an honest refusal, not a silent switch [design choice; Rafa may prefer the automatic fallback].

### Sepolia ETH at the caps

Per test-seller deal: 1,636,242 + 238,103 (a lone mint, the worst case) = 1,874,345 gas.

| Rate | Per deal | Per hour at 20 deals | Per day at 100 deals |
| --- | --- | --- | --- |
| 1 gwei (Sepolia's median tip; base fee near 0, measured in T-213) | 0.0019 ETH | 0.037 ETH | 0.19 ETH |
| 5 gwei | 0.0094 ETH | 0.19 ETH | 0.94 ETH |
| 20 gwei (the relayer's fee cap: a ceiling, not a forecast) | 0.037 ETH | 0.75 ETH | 3.75 ETH |

Context [inferred]: today's exposure through `try.mjs` alone is bounded by the faucet's 600 mints a day, so at most 300 deals, about 0.57 to 0.63 ETH a day at 1 gwei. With the seller at its day cap, the worst day is 100 seller deals plus 250 `try.mjs` deals (the mints bind at 600): about 0.65 to 0.72 ETH at 1 gwei, so the seller adds about 0.08 ETH a day at 1 gwei at full saturation, and 100 of the 600 mints. The funding lane's 1.9375 ETH of 2026-11-03 covers about ten days of the seller's day cap at 1 gwei, plus whatever `try.mjs` uses. Nobody has come close to these caps so far [guessed from the funnel numbers not having been reported as high].

Durable Object cost [inferred from `docs/operations.md` "Durable Object use"]: an alarm every 3 s while any deal is open would be 28,800 alarm requests a day if deals were open all day, against the account's included pace of about 33,000 a day. So back off: 3 s for the first 5 minutes after a buyer first reads `offered` (it is about to fund), then 15 s until `fundBy`; 5 s after a delivery until the decision; no alarm while idle. A typical deal is active for about two minutes, about 40 alarms; 100 deals a day is about 4,000.

**Recommendation: the caps above, with `perClientPerDay` added to the draft's four.** Confidence: medium (the numbers are judgment calls; the bounds they produce are arithmetic).

## 7. Fit with the litmus tests and the hard rules

- **Neutrality (ADR-0001).** The test seller is a party. The operators relay its signed messages as anyone's, charge it the same throttles, grant it nothing (no service binding, no special bucket, no key). No protocol step, schema field or contract line changes. The one Cloudflare-level quirk, same-zone `x-real-ip`, is a capability the service must not use (section 5). If the seller stalls after funding, the buyer's loss is bounded: anyone sends `reclaim` after `deliverBy` (at most 3,600 s after the offer), the price and the adjudication fee return, and the buyer is down the 4.71 tUSDC operator fee of test tokens. That is the existing `neutrality.seller-withholds-delivery` fixture, which passes on SimChain and on the contract. If the seller is down before funding, nothing is held. **A new `neutrality.*` fixture is not required:** the control-point table lists protocol actors, and the seller-agent row already exists. Add a service test instead: "the seller is stopped after `Held`; the buyer reclaims after `deliverBy`" on the in-process world with a short `deliverWithinSec` (above `fundWithinSec`; the club's 60 s minimum binds only the four judging windows).
- **The hold (ADR-0002).** Untouched: the seller never holds funds; the operator fee and the hold move only on the buyer's signatures.
- **Judgment (ADR-0006).** Checks-only; the refund mode is a real failed check in a real judgment record, not a scripted verdict. No panel runs.
- **Hard rules.** No real money: the Worker refuses to start without a Sepolia pin and should also refuse operators whose discovery domain is not chain 11155111 (the draft checks the token, and `verifyPrepared` refuses to sign under any other domain, so money safety already holds; the explicit check fails earlier and says why). No admin keys: not applicable. Secrets from environment only: `TEST_AGENTS_SEED` is a Worker secret made by `seed.mjs`, never printed; the test agents hold no ETH. Money as strings: the catalog uses base units. Signed messages: the seller signs only what `verifyPrepared` rebuilt from its own intent. Idempotency: the draft breaks it on retries (section 8). Untrusted input: the proposal is JSON checked by shape, never executed; the seller fetches only ciphertext URIs on the operators' origins and caps them at 16 KiB. No code execution: none. Pinned models: not applicable. The contract: unchanged.
- **Is the secret a "real key"?** No. It signs for a Sepolia-only deployment, guards tUSDC (worthless, open-mint) and the intake's mail, and pays no gas. A leak lets someone sign offers as the test seller; a buyer only funds a commitment ID it read from Crow's status endpoint, which the leaker does not control, so the harm is confusion, not loss. Rotate with `seed.mjs --replace`. It is the same class as `SEPOLIA_RELAYER_KEY` and `E2E_SEPOLIA_SEED`, and a different secret from both, so none of the three shares a key.
- **Other risks.** A flood on the intake: bounded by the caps, and the visitor falls back to self-play. The operators' relayer out of test ETH: writes answer `relay_refused`; the seller must surface that as "Crow's relayer is out of test ETH" (status `failed`, `detail`), not as its own fault. The operators' view lagging the chain (the in-flight row gap, seen once on 2026-11-03): section 8.

Confidence: high.

## 8. What the build must get right

1. **Learning of `Held` quickly and cheaply.** Poll `GET /v1/commitments/<id>` on one operator at the cadence in section 6 and confirm on both before delivering (the draft does the confirmation). The SSE stream `GET /v1/events` exists (`server.ts:1151`), but a Durable Object holding a long-lived outbound stream pays duration for the whole wait and dies with the instance, so polling with backoff is cheaper and simpler. The delivery lands within seconds of the second read; the decision follows the delivery's block.
2. **Retries and idempotency.** The draft marks a deal `failed` on any thrown error, including a 429, a 5xx, a 3-minute receipt wait or a network blip (`work()`, `seller.ts:270-273`), and `Agent.call` makes a fresh `Idempotency-Key` per call, so a retried delivery is a second submission, which the contract refuses at `maxSubmissions` 1. Fix: store one idempotency key per deal step with the deal and pass it (an optional argument on `Agent.call`, additive to `examples/agent.ts`); retry transient failures with backoff for up to 15 minutes; fail only on a refusal (a 4xx other than 429, or `invalid_state` with a `needs` that excludes the step). Before resending a delivery, read `/events` for a `delivery.submitted` by this seller: if it is there, the step is done.
3. **The operators' view behind the chain.** A delivery or decision that lands while the view lags shows as `Held` or `Delivered` for longer than expected. Treat a state that does not move within 10 minutes of a step as "stalled", keep the deal open, and report it in the status with the last transaction seen; do not re-sign anything. ADR-0028 §11's in-flight row (T-219) closes the gap on the operators' side.
4. **An offer the adjudicator declines.** If the state stays `Offered` for 2 minutes, read the state's `notices` and set `failed` with them as `detail`.
5. **An expired, unfunded offer.** The draft marks `expired` at `fundBy` from the seller's clock; use settlement time from discovery instead of `Date.now()` (the page tells agents the same). No trigger is needed: nothing is on chain.
6. **The mandate.** Check it before each offer (section 5); on `mandate_expired` from prepare or submit, call the faucet once; if the mandate is still expired, go `degraded` (503 on new requests with the reason) and log once an hour.
7. **Privacy of visitors.** The draft stores the client IP in each deal row. Keep per-client windows in memory, as the operators do (`docs/operations.md`, Telemetry: never an IP in storage), and store nothing that identifies a visitor; a restart resets the windows, which the operators accept too. Prune closed deals after 7 days, keeping only counters. Ignore `from`.
8. **Observability.** One console line per transition (Workers Logs, 7 days), with the deal number, the commitment ID and the state, never a token or an IP. A token-less `GET /agents/test-seller/health` with `status` (Operational, Degraded), open deals and the reason when degraded; richer counts (deals today, released, refunded) can wait for Rafa, since publishing aggregates is his gate (`docs/operations.md`, Telemetry). `/v1/feedback` is for visitors' reports, not the seller's.
9. **What the visitor reports.** `try.mjs` prints, and the status returns: the commitment ID, the final state, the transactions as Etherscan links (`funded`, `delivered`, `decided`), whether the buyer opened the work (and its 3 rows), the outcome the buyer asked for, and the status URL minus the token. The intake page says: report these to whoever asked you.
10. **Timing from settlement time.** Every window the seller reasons about (`fundBy`, the 2-minute acceptance wait) uses `settlementTime` from discovery, as `llms.txt` section 3 asks of every agent.
11. **The card and page read fees live.** The adjudication fee from the primary's registration (`fee.min`) and the operator fee from `fees.operator`, computed as section 6 of `llms.txt` computes them, so the stated total (30.71 tUSDC today) follows the operators.
12. **Secrets and chain guards.** `TEST_AGENTS_SEED` from the Worker environment only; refuse to start on any chain but 11155111; `nodejs_compat` for `Buffer`; never forward incoming headers into subrequests.
13. **Tests.** The draft's 8 against the in-process world, plus: the stalled-seller reclaim (section 7); a transient 429 that does not fail a deal; a retried delivery that replays rather than resubmits; a request for another deliverable that is refused, and a different price that is countered; `try.ts --seller` against the in-process seller to Released and to Refunded.

## Where this recommendation differs from the draft

| Draft (`apps/test-agents/src/`) | This note | Why |
| --- | --- | --- |
| Per-deal keys `seller/deal/<n>`; a faucet call per deal | One standing address; the faucet only without a live mandate | Section 5: one mint, one grant and one faucet-bucket slot per deal, and a reset repeats addresses |
| Any thrown error marks a deal `failed`; a fresh idempotency key per call | Transient errors retry with backoff; one key per step; a delivery is checked in `/events` before resending | Section 8, items 2 and 3; the idempotency hard rule |
| Client IP stored in each deal row | Per-client windows in memory only; closed deals pruned after 7 days | Section 8, item 7 |
| Four caps | Five: add 10 per client per UTC day | Section 6 |
| Every non-catalog proposal is countered | Counter only a catalog deliverable with other price or checks; refuse other deliverables with a reason | Section 2 |
| Fees written in the page text (25, 4.71) | Fees computed from discovery and the registration | Section 3 |
| The page lists no address (the convention) | The page lists the standing address and says why | Section 5 |
| `Date.now()` for `fundBy` | Settlement time | Section 8, item 5 |
| No chain check on discovery | Refuse any operator not on chain 11155111 | Section 7 |
| The visitor's path is unspecified | `try.mjs --seller <url>` and `--outcome refund`; the pinned command in `llms.txt` names the test seller; self-play is the stated fallback | Section 4 |
| Hosting unspecified (`SELLER_URL` suggests the path) | The route `escrow.stream/agents/*`, with `agents.escrow.stream` as the fallback | Section 4 |

The draft's structure (a Worker, one Durable Object, an alarm that advances open deals, `examples/agent.ts` and `verify.ts` reused, keys derived from one secret as `e2e-keys.ts` derives them, the intake convention followed, the proposal fetched only from the operators' store, the 16 KiB cap, the `statusTokenHash` replay) stands.

## What contradicts the brief's assumptions

- **`cf-connecting-ip` on a Worker subrequest:** the fixed `2a06:98c0:3600::103` applies to cross-zone subrequests only. The test agents and the operators are one zone, so the header carries `x-real-ip`, which the sending Worker could set; for an alarm-driven call with none set, the value is undocumented. [documented; the gap is measured at deploy]
- **A route on a Custom Domain's hostname:** supported and documented, with precedence to the route. The brief asked; the answer is yes.
- **A Worker fetching another Worker's Custom Domain in the same zone:** supported and documented; the 1042 limit applies to targets on routes or `workers.dev`.
- **The faucet renews mandates:** it does not (finding 2). Any agent that keeps one address for more than 30 days hits this, not only the test seller.
- **"The faucet grants a mandate (30 days) and mints":** confirmed, with one addition: it skips the mint when the address already holds 1,000 tUSDC or more, and it still spends the per-client grant and records the per-address hour.
- **`deliverBy` from `createdAt`, `fundBy < deliverBy`:** consistent with `llms.txt` section 5; the brief's measured fact stands.

## Open questions for Rafa

1. On a 429 from the test seller, should `try.mjs` fall back to self-play on its own (a deal always completes) or stop and say when to retry (the visitor sees the two-party path or nothing)? This note proposes the second, with `--fallback` for the first.
2. May the intake page list the standing address, departing from the convention's "lists no Crow address"? This note says yes.
3. The faucet renewal fix touches `apps/demo-cloud/src/world.ts`, the operator lane. Ship it as a small PR before the test seller's first 30 days, or accept the seed rotation as the stopgap?
4. The token-less health line on `/agents/test-seller/health`: how much may it show? This note proposes status and open deals only.
5. The second slice, the test buyer that polls Crow for offers naming it: plan it now as a task, or after the seller has run for a week?

## Appendix: the visitor's path with the test seller

1. The homepage sends the visitor's agent to `https://escrow.stream/llms.txt`.
2. "Try it" gives one pinned command: install two packages, fetch `try.mjs`, check its SHA-256, run `node try.mjs --seller https://escrow.stream/agents/test-seller`.
3. `try.mjs` reads the seller's card (`/agents/test-seller/agent.json`): the intake URLs, the intake encryption key, the one offer's terms, the limits, the outcomes.
4. It makes the buyer's keys, takes the faucet grant (1,000 tUSDC and a mandate; about 12 s), seals a proposal with exactly the card's terms, stores it at `POST /v1/ciphertext`, and sends `{type: "crow-request", proposal, sealedKey, statusTokenHash}` to the intake.
5. The seller's alarm opens the proposal, checks its mandate, offers on Crow from its standing address naming the buyer, and the demo primary accepts within moments.
6. `try.mjs` polls the status until `offered` (typically under 10 s), then checks the terms on both operators against its own proposal and the published seller address, and agrees and funds (one Sepolia transaction, 12 to 24 s).
7. The seller sees `Held` on both operators and delivers the encrypted CSV (one transaction); the primary decides (one transaction) within seconds of the delivery's block.
8. `try.mjs` reads Released, opens its copy, checks the hashes, prints the three Etherscan links, the commitment ID and the final state; the status shows the same from the seller's side. About 90 s in all [guessed: the one-command deal takes 42 to 78 s, plus the intake round trip].
9. With `--outcome refund`: step 7 delivers 2 rows, the `rows` check fails, the decision refunds the price; `try.mjs` prints the judgment record's line and the refund transaction, and says the buyer is down 5.71 tUSDC of test tokens and received no key.
