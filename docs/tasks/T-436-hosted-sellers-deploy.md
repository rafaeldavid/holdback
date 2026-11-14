# T-436: the hosted seller's deploy and secret scripts, and Rafa's first-deploy runbook

- **Lane:** infra
- **Phase:** 2
- **Depends on:** T-435 (the Worker)
- **Paths this task may touch:** `apps/hosted-sellers/scripts/`, `apps/hosted-sellers/src/deploy-plan.ts` and its test, `apps/hosted-sellers/example/seller/`, one section in `docs/operations.md` ("Hosted sellers, the first deploy of one"), this file
- **Human gate:** yes. The first deploy creates a Worker on Crow's Cloudflare account, and the secrets hold the company's API key. Both are Rafa's. This task deploys nothing and sets no secret.
- **Status:** review
- **Agent/session:** the T-407 session, on Rafa's word of 2026-11-14 ("Yes, start both")
- **Roadmap row:** N134

## Intent

A hosted seller (T-435) needs three things before a buyer can reach it, each repeatable for the next company:
- a bundle built from its private folder;
- its own Worker deployed with the right routes;
- its secrets set without anyone seeing them.

This task writes the scripts that do each, the checks around them, and the runbook Rafa follows for a first deploy. The deploy follows the test seller's pattern:
- a pre-flight on a clean checkout of `origin/main`;
- the live version as the rollback target;
- the deal guard of ADR-0037 section 6;
- the upload;
- a check that the live seller serves this bundle;
- a rollback on a failed check;
- a record line.

The secrets script sets everything in one `wrangler secret bulk`. It generates the signing key in memory and prints only its address. It reads the company's API key from standard input, and generates the quote and ready credentials, writing them to files outside every repository.

Non-goals: deploying, setting a secret, or reading the pilot's private folder.

## Acceptance criteria

- [x] `deploy.ts --seller <folder> --workspace <id|none>` builds and checks the bundle, refuses an account that does not match the configuration's, and refuses an option it does not know.
- [x] `--dry-run` bundles with Wrangler and uploads nothing; `--first` creates a Worker that has none and passes once `/health` answers for this bundle; `--check-only` reads the live seller and changes nothing.
- [x] A deploy refuses while a deal is at `starting`, before any upload, and after an upload rolls back when the seller does not serve this bundle in time.
- [x] The generated configuration: Worker `crow-seller-<slug>`, routes `crow.direct/agents/<slug>` and `crow.direct/agents/<slug>/*`, the bundle by alias, deferred code updates, no invocation logs, no secret.
- [x] `secrets.ts` sets the signing key, the API key from standard input and fresh credentials in one bulk call, writes the credentials (mode 0600) only to a private directory outside every git checkout, refuses to replace a secret without `--replace`, and prints no secret.
- [x] The runbook in `docs/operations.md`: the commands in order, the secret each one asks for, and how to check the result.

## Evidence

Measured on 2026-11-14 on branch `t-436-hosted-sellers-deploy`, stacked on T-435.

- `pnpm exec vitest run apps/hosted-sellers/src/deploy.test.ts`: 16 tests passed. The example folder reads to the example bundle; the decisions are tested with plain facts, and both runs with stand-ins for wrangler, git, the network, the files and the clock.
- `node apps/hosted-sellers/scripts/deploy.ts --seller apps/hosted-sellers/example/seller --workspace example-workspace --dry-run`: printed the Worker, its address and the bundle's SHA-256; Wrangler bundled "Total Upload: 3876.47 KiB / gzip: 590.26 KiB"; exit 0. With `--workspace other`: "Refused: the configuration pins another account than --workspace names: nothing was deployed", exit 2.
- Nothing was deployed, no secret was set, and no Cloudflare account was called.

## Decisions

- **The deal guard waits for `starting` only.** ADR-0037 section 6 named `start-unknown` too. A deal at `start-unknown` sends no start, so a deploy cannot cause a second one, and waiting on it could block the deploy that fixes it. Recorded here; Rafa may overrule.
- **No offline copy of the signing key** (ADR-0037 open question 5): it is generated in memory and never shown. A Worker that cannot run until `deliverBy` means a refund to the buyer.
- **The generated files go to a new directory under the system's temporary folder,** mode 0700, never into either repository: the bundle can name a company and its account.

## Handoff

Rafa's first deploy follows `docs/operations.md`, "Hosted sellers, the first deploy of one". It needs a private folder for the company, in the private repository: `hosted.json`, `adapter.json` and the files `adapter.json` names. For the pilot's company, `adapter.json` is the kit's adapter configuration, with three changes:
- no `journal` or `port`;
- credential variables that do not start with `HOLDBACK_`;
- `sellerApi.workspace` set, the quote and start paths carrying `{{workspace}}`.
