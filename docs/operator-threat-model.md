# Operator threat model: abuse of the public API

**Abuse of the public API costs Crow gas, storage and the one Durable Object's time, and never a party's held funds.** Anyone on the internet can call the two demo operators at `api.crow.direct` and `api2.crow.direct`. This page lists how a caller could abuse them, what each abuse costs in units, what already stopped it before T-422, and the limits T-422 adds. It sits beside the contract threat model (`docs/audit/threat-model.md`) and the neutrality analysis (`docs/neutrality.md`). The numbers are from 2026-11-14; the live values are in the Worker files and in discovery's `limits`.

## What is at stake

| Asset | Who pays | Amount at risk |
| --- | --- | --- |
| The relayer's test ETH, which pays the gas of every deal the operators relay | Crow | 2.84 test ETH across the funding lane and three deal lanes [measured, Sepolia, 2026-11-14]. A deal's three transactions use about 1.56 million gas [measured on Sepolia, T-389], about 0.0016 test ETH at a 1 gwei tip |
| The World Durable Object's time: both operators forward every request to one object | every caller | Cloudflare's soft limit for one object is about 1,000 requests a second [Cloudflare's documentation]. Past it, requests queue and then fail as overloaded, for every caller |
| The World's storage: deals, registrations and every ciphertext uploaded | Crow, then every caller | 10 GB per object [Cloudflare's documentation]. A full object refuses every write, and the world stops (T-313, `broken`) |
| Held funds and settlement | the parties | Nothing. The contract holds the funds, and no operator can move or freeze them (`docs/neutrality.md`) |

## Who can abuse the API

- **Any anonymous caller.** Keys, per-deal signers and test tokens are free: the faucet grants tUSDC, and the token is open-mint on Sepolia. So a signer address is no identity. The only scarce handle an operator sees is the caller's network address, and an IPv6 host usually holds a whole /64.
- **A party to a deal** who wants to slow the other party's deals, or every deal.
- **An agent with a bug**: a retry loop, or polling with no wait. This is the likeliest case.

Out of scope here: a party cheating its counterparty (the contract threat model), and an operator refusing service on purpose (neutrality, below).

## How the limits keep neutrality

A limit is one operator's protection of its own service. It never changes what the contract accepts, and it caps no amount, deadline or other term the parties negotiate (D31). A caller that one operator refuses sends the same signed message to the other operator, which counts separately, or straight to the settlement contract, which has no limits at all (ADR-0005). `neutrality.operator-daily-cap` (`apps/demo-cloud/src/limits.test.ts`) shows a deal completing that way, as `neutrality.operator-rate-limits` (`apps/operator/src/neutrality.test.ts`) does for the read and write throttle. Both demo operators share one relayer and one world, so for gas and storage they are one budget. An operator anyone else runs is a separate one.

**A replay is answered whatever the caller's other counts.** A repeat of an accepted request, with the same Idempotency-Key and the same body, is answered from the stored response whatever the caller's read, write, funded-deal or ciphertext count. So an agent that lost an answer can get it back. Replays meet two limits of their own: a replay budget the size of the write budget, 120 requests under a known Idempotency-Key per 60 s per client by default, and the flood ceiling below, which counts every request. One lost answer needs one replay; both limits sit 100 times or more above that and open again within 60 s. A funding for a deal that is already past funding is never counted against the daily cap, so its replay is answered after 00:00 UTC and from another address too.

## The abuses

Each row gives the cost of the abuse, the defence before T-422, and the defence T-422 adds. The defaults and their measured headroom are in the next section.

| Abuse | What it costs | Before T-422 | Added by T-422 |
| --- | --- | --- | --- |
| **Flooding reads** | Each request is one turn of the World object. One caller at 1,000 requests a second fills the object for everyone | 1,200 reads a minute per client (address), per operator; refusals answered with 429. Each refusal still runs inside the World object | A flood ceiling in each Worker: 500 requests per 10 s per client, per Cloudflare location, answered with 429 before the request reaches the World object |
| **Flooding writes that spend gas** | Each funded deal commits the relayer to about 1.56 million gas | 120 writes a minute, counted per signer once the settlement layer accepts a write. A fresh per-deal key starts a fresh count, so a caller with many keys was not bounded | A daily cap on deals the relayer funds: 100 a UTC day per client, per operator. A replay of an accepted funding is not counted again |
| **Draining the relayer with many small deals** | A deal of 1 base unit costs the relayer the same gas as a large one. Without a cap, 2.84 test ETH lasts about 1,800 deals at a 1 gwei tip [inferred] | The faucet's caps (10 grants per client an hour, 600 mints a day) did not bound it: the token is open-mint | The same daily cap. One client can make the relayer fund at most 200 deals a day across both operators: about 312 million gas, 0.31 test ETH at a 1 gwei tip [inferred]. The steps after funding are bounded per deal by the contract's stages: one delivery, one decision or settlement, one timeout |
| **Steps for deals funded elsewhere** | A caller that funds on chain itself, paying its own gas, can relay the delivery and the decision through the operators: about 2 transactions of relayer gas for each 1 of its own | The write throttle | Nothing new: the caller pays real gas for each deal, and the loss is bounded per deal [recorded as a residual] |
| **Filling the store with ciphertext** | Each upload of up to 1 MiB stays in the World's storage. At 120 uploads a minute, one client fills 10 GB in about 85 minutes [inferred], and the world stops | 120 writes a minute per client; 1 MiB per ciphertext | A daily cap on new ciphertext stored: 256 MiB a UTC day per client, per operator. Bytes the store already holds, and replays, are not counted |
| **Replay storms on idempotency keys** | Each replay is one keyed lookup and one hash in the World object, after the body cap; it spends no gas and writes no row | Replays were counted as writes and could be refused by the throttle, so an agent over its count could not read back an answer it had already been given | Every request under a known key is counted at entry against a replay budget of its own, 120 per 60 s per client, before its body is read; a replay is then answered before the read and write budgets. Only the same key with the same body is a replay; the same key with another body is a `409` and counts as a write too. So the body work under known keys is bounded as a write's was before. The flood ceiling still bounds the rate |
| **Paths the operator routes differently** | `//x/v1/…` routes at the operator as `/v1/…`, and a cap that read the raw path would miss it | none | The caps read the path as the operator routes it, and each Worker answers 404 for a path with an empty segment or a backslash |
| **Large bodies** | A body streams into the World object; the operator stops reading past 1 MiB | 413 `payload_too_large` at 1 MiB (JSON and ciphertext) and 192 KiB (adjudicator registrations), read in the World object | The Worker refuses a body whose Content-Length is above the route's cap before it reaches the World object |
| **Slow requests** | A request whose body trickles in holds memory in the World object while it waits | Cloudflare's edge terminates connections and buffers requests; a Worker spends no CPU time while it waits [inferred from Cloudflare's model] | Nothing new [recorded as a residual] |
| **Enumerating other parties' deals** | A deal at disclosure `public` is public on chain anyway (residual 9 in `docs/neutrality.md`). Sealed terms need the party's read token | The read limit bounds the pace: 1,200 reads a minute per client | The flood ceiling. Nothing more is needed: nothing an operator serves is secret |
| **The faucet** | A mint costs the relayer gas | One grant per address an hour, 10 per client an hour, 600 mints a day in all | Nothing new. Since 2026-11-14, 50 per client an hour (Rafa) |
| **The operators' own timeouts** | Each costs the relayer gas | 200 a UTC day, 50 of them offer expiries | Nothing new |

**What counts as one client.** An IPv4 address, or an IPv6 address's /64 (`clientKey`, the rule the test agents already use). Before T-422 each IPv6 address counted alone, so one host could rotate addresses within its /64 and get a fresh count for every one.

## The limits and their headroom

The live flows' needs were measured on 2026-11-14 with one try deal (`site/try.mjs` with Crow's test seller, Released in 44 s), counting every request (T-422's task file has the table).

| Limit | Where | Default | What one try deal needs | Variable |
| --- | --- | --- | --- | --- |
| Flood ceiling | each Worker, before the World object; a Cloudflare rate-limit binding, counted per Cloudflare location | 500 requests per 10 s per client | 27 per 10 s at its peak, on one operator | `ratelimits` in each Wrangler file |
| Reads | the operator, in the World object | 1,200 per 60 s per client | 67 per 60 s | `RATE_READS_PER_MIN` |
| Writes | the operator, in the World object | 120 per 60 s per signer (per client before the settlement layer accepts it) | 4 | `RATE_WRITES_PER_MIN` |
| Requests under a known Idempotency-Key, replays included | the operator, in the World object, counted at entry | the write budget: 120 per 60 s per client | 0 in a normal deal; 1 after a lost answer | follows `RATE_WRITES_PER_MIN` |
| Funded deals | the World object, per operator | 100 per UTC day per client | 1; Crow's test buyer funds at most 50 a day | `FUNDED_DEALS_PER_CLIENT_PER_DAY` |
| New ciphertext stored | the World object, per operator | 256 MiB (268,435,456 bytes) per UTC day per client | under 1 KB | `CIPHERTEXT_BYTES_PER_CLIENT_PER_DAY` |
| Body size | each Worker, by Content-Length, then the operator while it reads | 1 MiB (1,048,576 bytes); 192 KiB (196,608 bytes) for adjudicator registrations | 1,010 bytes | fixed in code |

Each refusal answers `429` `rate_limited` with `retryAfterSec` and `Retry-After` in whole seconds, and says what else the caller can do: wait, use the other operator, or submit to the settlement contract. The daily caps open again at 00:00 UTC.

## What the limits do not stop

1. **Many addresses.** A caller with many IPv4 addresses, or many IPv6 /64s, gets each address's limits. With enough of them it can drain the relayer or fill the store. Bounded by the cost of addresses and by Cloudflare's own DDoS protection; watched through the relayer's balance in the hourly cost report. A firewall rule in the Cloudflare dashboard is Rafa's, outside this repository.
2. **Crow's own agents share one client.** The test seller, the test buyer and any seller adapter Crow hosts run as Workers, and their requests count under the address Cloudflare sends them from [inferred]. The defaults sit well above their own caps (the test buyer funds at most 50 deals a day); item 8 is the risk from other Workers.
3. **The flood ceiling is approximate.** Cloudflare counts it per location and updates the counts in the background, so a burst can pass it by a little. The operator's own limits behind it are exact.
4. **Counts kept in memory restart.** The read, write and replay counts and the stored answers live in the World object's memory and restart with it. The daily caps are kept in its storage and survive, in rows that name no address: each row's key holds the client hashed with the world's secret, and a new day deletes the rows of the days before.
5. **Slow requests and steps for deals funded elsewhere**, above.
6. **Offers and registrations grow storage.** A deal's offer and an adjudicator's registration (up to 192 KiB) are kept in the World object's storage. Once the settlement layer accepts a write, its count moves from the client to the signer, and fresh keys are free, so between them only the flood ceiling bounds a client's offers. An offer needs a seller with a mandate, which only a faucet grant gives (50 per client an hour, `demo.faucet.perClientPerWindow`; 10 until 2026-11-14); a registration stays on the client's write count, 120 a minute [inferred, not measured]. A daily cap on both, like the ciphertext cap, is a follow-up.
7. **Higher gas prices.** The gas figures assume the 1 gwei tip measured on Sepolia. At the operators' fee cap of 20 gwei a deal costs about 0.031 test ETH, and one client's 200 funded deals a day could spend more than the relayer holds [inferred].
8. **Cloudflare Workers share an address.** Workers' requests to other sites come from a few Cloudflare addresses [inferred from Cloudflare's documentation and community reports, not measured], so every agent hosted on Workers, Crow's test buyer and test seller among them, may count as one client. Another party's Worker could then use up that address's 100 funded deals a day and stop Crow's test buyer until 00:00 UTC. Before T-422 that crowding lasted 60 s. Follow-ups: measure what address and `CF-Worker` header a Worker's request carries, and route Crow's own agents to the operators by a service binding.
