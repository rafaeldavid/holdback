# Run the seller adapter as a service

This recipe runs `examples/seller-adapter.ts` in production on one Linux machine: behind HTTPS, with a credential and a rate limit on `POST /quote`, and restarted by systemd. It deploys nothing by itself. Test tokens only: nothing here is real money.

## The pieces

- **The adapter** listens on `127.0.0.1:8791`, plain HTTP. Only processes on the same machine reach it.
- **Caddy** (`seller-adapter.Caddyfile`) serves `https://<your name>/quote`, gets and renews the certificate, and forwards to the adapter.
- **systemd** (`seller-adapter.service`) starts the adapter at boot with one configuration file, `/etc/crow-seller/seller-adapter.json`, restarts it 5 s after any exit, and stops it with SIGTERM.

**Why a TLS proxy, not TLS in the adapter.** A proxy gets and renews the certificate on its own, so the adapter never reads a private key file and needs no restart when the certificate changes. TLS in the adapter would need certificate paths in the configuration, a renewal job and a reload. The adapter stays a loopback HTTP service, which is what its tests run.

## Steps

1. **Install.** Node 22 and pnpm 12 (through corepack), then the repository at a commit you have read:

   ```sh
   git clone https://github.com/rafaeldavid/holdback /opt/holdback
   git -C /opt/holdback checkout <commit>
   pnpm -C /opt/holdback install --frozen-lockfile
   pnpm -C /opt/holdback build
   useradd --system --no-create-home crow-seller
   ```

2. **Configure.** Write `/etc/crow-seller/seller-adapter.json` (T-331); you edit no source file. Only `sellerApi` is required. Every other field has a default (`config` in `seller-adapter.ts`), and the club and the three adjudicators default to the ones the operators' discovery document names. Paths in the file, such as `template` and `reportMapping`, are read beside it. For production:

   ```json
   {
     "sellerApi": { "quote": "http://127.0.0.1:8790/quote", "start": "http://127.0.0.1:8790/jobs", "result": "http://127.0.0.1:8790/jobs/{jobId}/result" },
     "quoteAuth": { "kind": "bearer", "env": "HOLDBACK_QUOTE_CREDENTIALS" },
     "quoteRateLimit": { "overall": { "requests": 100, "windowSec": 60 } },
     "journal": "/var/lib/crow-seller/seller-adapter.journal.json"
   }
   ```

   The values are yours: any positive whole numbers. `overall` counts the requests that passed the credential, which caps how many offers the adapter signs. Past it the route answers 429 with `Retry-After` in seconds. Leave `quoteAuth` out to keep the route open. The adapter refuses a field it does not take, naming it, and the four options removed in T-331 (`stream`, `host`, `trustProxy`, `quoteRateLimit.perClient`), saying what to do instead. A limit per client address belongs in Caddy, which sees the address. `examples/seller-adapter.config.json` is a smaller example that points at the stub API.

   **The mandate.** Every offer needs a mandate in the club. On the test service, the adapter takes one from the faucet at start and renews it before it ends (each lasts 30 days; `mandate.renewBeforeSec`, default one day). Elsewhere your club's principal gives you one, and a start without one stops and says so.

3. **Secrets.** Write `/etc/crow-seller/environment`, owned by root with mode 0600:

   ```sh
   HOLDBACK_KEY=0x<the seller's signing key>
   HOLDBACK_OPERATORS=https://<operator 1>,https://<operator 2>
   HOLDBACK_QUOTE_CREDENTIALS=<credential for buyer A>,<credential for buyer B>
   ```

   The adapter reads these from its environment only and never logs them. Give each buyer its own credential, so you can remove one without the others. A buyer sends `Authorization: Bearer <its credential>` with each quote.

4. **Start.** Copy `seller-adapter.service` to `/etc/systemd/system/` and `seller-adapter.Caddyfile` to `/etc/caddy/Caddyfile` with your name in place of `quote.example.com`, then:

   ```sh
   systemctl daemon-reload
   systemctl enable --now seller-adapter
   systemctl reload caddy
   journalctl -u seller-adapter -f
   ```

   The adapter's first log lines say which club and adjudicators its offers name and where they came from, when the mandate ends, and what the quote route takes: the credential's variable name (never its value) and the rate limit.

5. **Publish.** Your card's quoted item names `https://<your name>/quote` (`site/llms.txt`, "Sell a priced API service").

## Restarts

The journal, `/var/lib/crow-seller/seller-adapter.journal.json`, records each deal's stage before the adapter acts on it. After any restart, a crash included, the adapter reads it and moves every open deal on:

- a deal still offered starts its job once the hold is funded, even if the buyer funded while the adapter was down;
- a deal recorded as starting sends the start again with the same `Idempotency-Key` (the commitment ID), so your API returns the same job;
- a started deal fetches its result and delivers it, unless the settlement layer already holds a delivery;
- a keyed quote answers the same way as before the restart.

Run one adapter per journal. On SIGTERM it stops taking quotes and finishes the step in progress before it exits; systemd waits up to 60 s. Back up the journal with the machine's state: without it the adapter forgets its open deals, and the buyers of those deals are refunded at their deadlines.

## Checks

`pnpm exec vitest run examples/seller-adapter.test.ts` runs the adapter on the in-process chain, including a start from one configuration file, the mandate taken and renewed on the test service, a quote over HTTPS through a TLS proxy, the credential, the rate limit and a restart with three open deals.
