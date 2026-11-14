# T-434: one seller-adapter core with no Node imports, and the Node shell around it

- **Lane:** demo (the seller adapter)
- **Phase:** 2
- **Depends on:** T-433 (`redirect: 'manual'`), ADR-0037 sections 4 and 7 (Accepted 2026-11-14, D68)
- **Paths this task may touch:** `examples/seller-adapter*.ts` and their tests, `site/ref/seller-adapter.txt`, this file
- **Human gate:** no
- **Status:** review
- **Agent/session:** the T-407 session, on Rafa's word of 2026-11-14 ("Yes, start both")

## Intent

The hosted seller adapter (T-435) has to run the same deal logic as the adapter on a seller's own machine, in a Worker where there is no file system, no `node:http` server and no `setInterval` that outlives a request. This task moves every rule of the adapter into `examples/seller-adapter-core.ts`, which imports no Node module but `node:crypto` (the Workers runtime provides it with `nodejs_compat`). It leaves `examples/seller-adapter.ts` as the Node shell: the journal file, the server on 127.0.0.1, the poll, the command line. The core takes an `AdapterIO` (read a file the configuration names; load and save the journal; append an event line) and answers standard `Request`s with `Response`s. A pass moves every open deal as far as it can.

One behaviour is new, from ADR-0037 section 4: each credential a configuration names needs a variable of its own, and none may be the shell's own `HOLDBACK_KEY`, `HOLDBACK_OPERATORS` or `HOLDBACK_DEPLOYMENT`. Before this, a configuration could send the seller's signing key to its API as a bearer token, or let a buyer's quote credential open the ready and job routes.

Non-goals: the Worker itself (T-435), its deploy scripts (T-436). Nothing a seller on its own machine runs or reads changes, apart from the new refusal.

## Acceptance criteria

- [x] `examples/seller-adapter-core.ts` imports no Node module but `node:crypto`, and no file or server API.
- [x] `examples/seller-adapter.ts` keeps every export it had (`config`, `loadConfig`, `startSellerAdapter` and the rest, re-exported from the core), its command line and its `--help`.
- [x] Every existing adapter test passes with no change to its file.
- [x] A deal runs through the core alone: a quote through `handle`, passes through `wake`, an in-memory journal, one job and one delivery; a second core on the same journal resumes the open deal and starts no second job.
- [x] The credential refusal: `HOLDBACK_KEY` or `HOLDBACK_OPERATORS` named as a credential, and one variable named for two credentials, each refused at start, before anything is sent.

## Evidence

All measured on 2026-11-14 on branch `t-434-adapter-core-split`, stacked on T-433 (PR 551).

- `pnpm exec vitest run examples/seller-adapter`: 5 files, 100 tests passed. They are the 95 tests of T-433's four files, whose files this task does not change (`git diff t-433-redirect-manual -- examples/seller-adapter.test.ts examples/seller-adapter-job-api.test.ts examples/seller-adapter-terms.test.ts examples/seller-adapter-keys.test.ts` is empty), and 5 new ones in `examples/seller-adapter-core.test.ts`.
- `pnpm exec vitest run examples/buy-with-signer.test.ts examples/audit-deal.test.ts examples/report-converter.test.ts examples/one-token.test.ts examples/examples.test.ts tests/design-map.test.ts`: 6 files, 106 tests passed.
- `node examples/seller-adapter.ts --help` prints the usage as before (exit 0). With no key set, a real configuration stops at "set HOLDBACK_KEY" as before.
- `pnpm typecheck` and ESLint on `examples/seller-adapter*.ts`: clean. `node site/build.mjs && node site/check.mjs`: PASS.
- `grep '^import' examples/seller-adapter-core.ts`: `node:crypto`, `viem`, `@holdback/judgment`, `@holdback/testkit`, and four files in `examples/`. Whether all of them bundle for the Workers runtime is checked in T-435 with Wrangler's dry run.
- `site/try.mjs` and `site/buy.mjs`: unchanged.

## Decisions

- **`node:crypto` stays in the core.** The Workers runtime provides `createHash`, `createHmac`, `randomBytes`, `randomUUID` and `timingSafeEqual` under `nodejs_compat`, which `crow-test-agents` already runs with. Replacing them would change the code that signs and compares credentials for no gain. ADR-0037 section 7 said "no `node:` module"; this is the one exception.
- **The journal is saved whole, as before,** through `io.saveJournal`, called where the file was written. The Worker keeps one value, and its output gate holds the next outgoing request until the write is stored. Per-deal keys can come later if a journal grows past the storage's per-value limit.
- **The Node server reads each request body before the core sees it,** up to 65,537 bytes, and drains the rest. The core's limits answer as before (413 past 65,536 bytes), and a refused request no longer leaves its body unread.

## Handoff

The next step is T-435, `apps/hosted-sellers/`, on this core.
