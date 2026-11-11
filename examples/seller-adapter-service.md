# Run the seller adapter as a service

This recipe runs `examples/seller-adapter.ts` in production on one Linux machine: behind HTTPS, with a credential and a rate limit on `POST /quote`, and restarted by systemd. It deploys nothing by itself. Test tokens only: nothing here is real money.

## The pieces

- **The adapter** listens on `127.0.0.1:8791`, plain HTTP. Only processes on the same machine reach it.
- **Caddy** (`seller-adapter.Caddyfile`) serves `https://<your name>/quote`, gets and renews the certificate, and forwards to the adapter. It appends the client's address to `X-Forwarded-For`.
- **systemd** (`seller-adapter.service`) starts the adapter at boot, restarts it 5 s after any exit, and stops it with SIGTERM.

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

2. **Configure.** Edit the configuration block of `/opt/holdback/examples/seller-adapter.ts` (T-318): your API's three addresses, the template, the scope rules, the adjudicators and the windows. For production add:

   ```ts
   trustProxy: true, // the client is the last X-Forwarded-For entry; safe because only Caddy reaches 127.0.0.1:8791
   quoteAuth: { kind: 'bearer', env: 'HOLDBACK_QUOTE_CREDENTIALS' },
   quoteRateLimit: { perClient: { requests: 10, windowSec: 60 }, overall: { requests: 100, windowSec: 60 } },
   ```

   The values are yours: any positive whole numbers. `perClient` counts each client address before the credential is checked, so guessed credentials count against the guesser. `overall` counts the requests that passed both, which caps how many offers the adapter signs. Past either limit the route answers 429 with `Retry-After` in seconds. Leave `quoteAuth` out to keep the route open.

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

   The adapter's second log line says what the quote route takes: the credential's variable name (never its value) and the rate limits.

5. **Publish.** Your card's quoted item names `https://<your name>/quote` (`site/llms.txt`, "Sell a priced API service").

## Restarts

The journal, `/var/lib/crow-seller/seller-adapter.journal.json`, records each deal's stage before the adapter acts on it. After any restart, a crash included, the adapter reads it and moves every open deal on:

- a deal still offered starts its job once the hold is funded, even if the buyer funded while the adapter was down;
- a deal recorded as starting sends the start again with the same `Idempotency-Key` (the commitment ID), so your API returns the same job;
- a started deal fetches its result and delivers it, unless the settlement layer already holds a delivery;
- a keyed quote answers the same way as before the restart.

Run one adapter per journal. On SIGTERM it stops taking quotes and finishes the step in progress before it exits; systemd waits up to 60 s. Back up the journal with the machine's state: without it the adapter forgets its open deals, and the buyers of those deals are refunded at their deadlines.

## Checks

`pnpm exec vitest run examples/seller-adapter.test.ts` runs the adapter on the in-process chain, including a quote over HTTPS through a TLS proxy, the credential, the rate limits and a restart with three open deals.
