# T-222: Crow's standing test seller on the Sepolia test environment

- **Lane:** demo (with examples for `try.mjs`, and the site for `llms.txt`)
- **Phase:** 5
- **Depends on:** nothing unmerged. The live demo on Sepolia (T-213) and the intake convention in `site/llms.txt` are in place.
- **Paths this task may touch:**
  - `apps/test-agents/` (new);
  - `examples/try.ts`, `examples/try.test.ts`, and `examples/agent.ts` (an optional idempotency key on `call`, additive);
  - the site: `site/llms.txt`, `site/build.mjs`, `site/check.mjs`, and the files `node site/build.mjs` regenerates (`site/index.html`, `site/try.mjs`);
  - `tsconfig.json` (the project reference), `pnpm-lock.yaml`, `vitest.config.ts` (the cost table only);
  - docs: `docs/decisions-today.md` (D47), `docs/research/2026-11-04-test-counterparties.md`, `docs/plan.md`, `docs/backlog.md`, `docs/update-flow.md`, `docs/operations.md`, `SECURITY.md` (its scope), this file.
  - Not T-216's paths (`examples/e2e-*.ts`, its task file).
- **Human gate:** yes for the deploy: the Worker, its route on `escrow.stream`, its secret and the site publish wait for Rafa. Everything else is in the repository.
- **Status:** done (deployed 2026-11-04 as crow-test-agents `9d171ddc`; live deals each way in Evidence; the open items in Handoff are follow-ups)
- **Agent/session:** test counterparties session, 2026-11-04

## Intent

Rafa, 2026-11-04: "For the test environment, feels like we should have a standing buyer / seller test identity that people can do test escrow with no?"

Restated: give a visitor's AI agent a real counterparty on the Sepolia test environment, so it plays one side of a two-party Crow deal instead of `try.mjs` playing both. The first slice is the seller (D47).

- **Input:** a buyer's sealed `crow-request` at `https://escrow.stream/agents/test-seller/requests`, following the "Agent intake" convention in `site/llms.txt`.
- **Output:** an offer on Crow naming that buyer, from the seller's one standing address; a delivery within seconds of the funding (good work, or work that fails the `rows` check when the buyer asked to see a refund); the outcome and its Etherscan links in the buyer's status.
- **The visitor's path:** `node try.mjs --seller https://escrow.stream/agents/test-seller` plays only the buyer. When the seller is down or busy, `try.mjs` says so and plays both sides.
- **Non-goals:** a test buyer (backlog); any change to the protocol, the schemas, the contracts or the operators; any privilege for the test agents at the operators.

## Context

- D47 and the research behind it: `docs/research/2026-11-04-test-counterparties.md`.
- `site/llms.txt`, "Two agents, two people": the intake convention.
- `examples/agent.ts` and `examples/verify.ts`: the HTTP-only agent the seller reuses. `examples/e2e-keys.ts`: the key derivation the seller copies.
- A human-run intake with the same request shape, in a separate project outside this repository.
- Litmus tests: ADR-0001 (the seller is a party; `neutrality.seller-withholds-delivery` covers a stalled seller), ADR-0002 (untouched), ADR-0006 (checks-only; the refund is a real failed check).

## Acceptance criteria

- [x] `apps/test-agents` serves the intake page, its `crow-agent` card, the request endpoint, the token-gated status and a token-less health line, under `/agents/test-seller`.
- [x] The seller offers from one standing address derived from `TEST_AGENTS_SEED`, calls the faucet only without a live mandate, and lists its address on the page.
- [x] It sells one item, counters other prices or checks with the catalog terms, and refuses other work with a reason.
- [x] A buyer's `"test": {"outcome": "refund"}` gets 2 rows; the decision refunds the price.
- [x] Caps: 3 per client an hour, 10 per client a day, 20 an hour, 100 a day, 10 open; per-client windows in memory only, no IP stored.
- [x] Transient errors retry with backoff; each step keeps one idempotency key and one signed body, so a retry replays rather than resubmits.
- [x] Windows from settlement time; unfunded offers expire at `fundBy`; an offer the adjudicator declines fails with its notices (written, not tested: the seller names only the demo's own adjudicators, which accept its terms).
- [x] `try.mjs --seller <url>` buys from the seller end to end, and `--outcome refund` sees a refund; it falls back to playing both sides, with a printed reason, when the seller is unreachable or busy.
- [x] Tests against the in-process demo world: release, refund, counter, refusal, caps, expiry, transient retry, replayed delivery, a stalled seller reclaimed by the buyer, and `try.ts --seller` to Released and Refunded.
- [x] `site/llms.txt` carries the path; `site/check.mjs` checks it; `docs/update-flow.md` and `docs/operations.md` know the new Worker.
- [x] `pnpm verify` passes.
- [ ] Deployed, and a live deal each way on Sepolia with Etherscan links (Rafa's gate).

## Out of scope

- The test buyer, the second slice (backlog).
- The faucet's mandate renewal (`apps/demo-cloud/src/world.ts`, the operator lane; D47).
- The deploy itself, which waits for Rafa.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- **`pnpm verify`** (measured, 2026-11-04, `reports/verify-claude-frosty-proskuriakova-5c0c85.md`, before the commit): PASS.

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 210 ms |
  | lint | `pnpm lint` | pass | 3255 ms |
  | forge build | `forge build --root contracts` | pass | 743 ms |
  | forge | `forge test --root contracts` | pass | 16568 ms |
  | test | `pnpm test` | pass | 34097 ms |
  | spec | `pnpm validate:spec` | pass | 530 ms |
  | snap | `pnpm snap` | pass | 8887 ms |
  | snap:local | `pnpm snap --settlement=local` | pass | 14149 ms |
  | demo | `pnpm demo` | pass | 3732 ms |

  `pnpm test`: 2,356 passed and 3 skipped, in 109 files. Forge: 241 passed. The first run failed `forge build` because this fresh worktree had no contract submodules and the step spent 106 s cloning them; `forge test` passed in that same run, and the rerun built in 743 ms. It also failed lint on one `prefer-const` in `apps/test-agents/src/try.test.ts`, since fixed.
- **Snapshot diffs:** none against HEAD (measured).
- **`pnpm verify` after the review round** (measured, 2026-11-04): PASS on every step. Typecheck 278 ms, lint 4,245 ms, forge build 955 ms, forge 20,590 ms, test 47,380 ms (2,366 passed, 3 skipped), spec 587 ms, snap 9,528 ms, snap:local 15,126 ms, demo 5,494 ms. No snapshot diffs. `site/try.mjs` sha256 is now `26ccaa80409ea753da3b177583344a8ad3d511c65522929801a646a2797de7d4`.
- **The review** (reviewer agent, PR 179): ISSUES, 10 findings, all fixed in the second round. The litmus tests held.
  1. Deals the seller could no longer act on stayed open. Now deadlines close them: a reclaimed or settled deal closes, a Held deal past `deliverBy` fails, and a deal waiting on Crow is closed by its deadline rather than the 15-minute retry budget.
  2. `try.mjs --seller` checked no windows. Now it refuses windows longer than the seller publishes (exit 3) and prints when the buyer can reclaim.
  3. The seller's text reached `try.mjs` output unfiltered. Now it is collapsed to one plain line of at most 300 characters.
  4. Only a new request started the alarm. Now any request re-arms it while a deal is open.
  5. `countered` ignored the adjudicators and windows a buyer proposed. Now it counts them.
  6. The replay tests did not prove key and body reuse. Now they assert both.
  7. Junk requests could use up the hourly cap. Now only requests whose proposal opens count, and IPv6 clients count per /64.
  8. A retried offer could fail although the offer existed. Now an offer the operators already hold counts as made.
  9. Missing tests. Added: the busy and failed-before-offer fallbacks, self-play `--outcome refund`, the domain refusal, and the Worker's seed and Sepolia checks.
  10. Stale comments and docs. Fixed.
- **The seller's tests after the review** (measured): `seller.test.ts` 12, `try.test.ts` 7, `worker.test.ts` 3, and one more in `examples/try.test.ts`. With `examples/try.test.ts`, the 29 tests passed 5 runs in a row in about 12 s each.
- **The seller's tests before the review** (measured): `apps/test-agents/src/seller.test.ts`, 10 tests:
  - the card, the page and the health line;
  - two releases from one standing address;
  - a refund on request (`rows` fails, decision `reject`);
  - a counter-offer and a refusal of other work;
  - malformed and misdirected requests;
  - per-client hour and day caps, with no IP in storage;
  - a transient 503 retried;
  - a lost delivery answer replayed (one `delivery.submitted`);
  - expiry in settlement time;
  - a stalled seller reclaimed by the buyer, who is down only the operator fee.

  `apps/test-agents/src/try.test.ts` has 3 tests: `try.ts --seller` to Released and, with `--outcome refund`, to Refunded (buyer 973.99 and 998.99 tUSD), and the fallback to self-play when the seller does not answer. The 13 passed 12 runs in a row after one test-helper race was fixed (the buyer funded before the adjudicator accepted).
- **`node site/check.mjs`** (measured): PASS, with group 8 checking the seller's catalog, limits and windows in `llms.txt` against `apps/test-agents/src/catalog.ts`. `site/try.mjs` rebuilt: sha256 `c7ac0e4d826b6123dc063c190e0342ffd95401ce4d9c9326967bd3f1358b05c2`.
- **The Worker** (measured):
  - `wrangler deploy --dry-run` bundles it to 440.04 KiB, 95.81 KiB gzipped.
  - Under `wrangler dev --local`, with a throwaway seed, it read live discovery and the primary's registration from both public operators. It served the card with fees of 1 tUSDC (adjudication) and 4.71 tUSDC (operator), 30.71 tUSDC in all, the same as `llms.txt`. It also served health `operational` and the HTML page.
  - No request was sent: a live deal spends the operators' Sepolia ETH and waits for Rafa.
- **The first deploy (2026-11-04, about 16:40 UTC, on Rafa's go-ahead: "You can deploy what's ready btw? like the test seller?")** [measured]:
  - crow-test-agents `9d171ddc`, route `escrow.stream/agents/test-seller*`. The route takes its path ahead of crow-site's Custom Domain, so no fallback to `agents.escrow.stream` was needed. `seed.mjs` set `TEST_AGENTS_SEED` without printing it. Health: `operational`, 0 open.
  - **Release:** `node examples/try.ts --seller https://escrow.stream/agents/test-seller` ended Released in 55 s, and the buyer decrypted 3 rows. Commitment `0x3ecdd264d2b1e8f9fce52990befa61f15119fc57e35e210cd6fb001e96371028`. Transactions: funded https://sepolia.etherscan.io/tx/0xfe09c5916047ffcc6d349271efb638ece64884ccbd952888d4e12986098d811b, delivered https://sepolia.etherscan.io/tx/0xf20ce6a8c7f1bddf0cd9bf109328e847d34d1bf99bef533dccbad10f8d070fb7, decided https://sepolia.etherscan.io/tx/0xe6bda05355b714f7bf40cfafe9b8b174c55df8df48d44bb8535c25034455e174.
  - **Refund:** the same with `--outcome refund` ended Refunded in 48 s. The rows check failed, the price came back to the buyer, and no key was released. Commitment `0x7be625cd4050b7bc75fe9572416a5dcc19c77ff0c0ec895e4eefd4173679e2ac`. Transactions: funded https://sepolia.etherscan.io/tx/0x064be1f82aa4d711a5b02ae2b0b68ed5c20440f06f65f03d9f4b0745264088d1, delivered https://sepolia.etherscan.io/tx/0x4da73b265810267760413f5005f07de4f76d56e0b6dc69ef6d4a10009b6d47b0, decided https://sepolia.etherscan.io/tx/0xbeede08ce63378cddc4c7c04e0f07fe17b06b3e082fd780ec79d7ff7c844cbac.
  - **The site** followed as crow-site `5582b10e`. `try.mjs` sha256 `26ccaa80409ea753da3b177583344a8ad3d511c65522929801a646a2797de7d4` matched the build, and the live `llms.txt` names the test seller.
  - **Not measured:** which client IP the operators see for the seller's calls (operations step 4). It needs the operators' logs, and the seller needs the faucet only about once a month.

## Decisions

Choices made inside this task. Escalate anything that changes architecture, a contract or a defense to an ADR.

- **D47** records the design, after a Fable max-effort research pass (`docs/research/2026-11-04-test-counterparties.md`). One choice differs from the note: `try.mjs` falls back to playing both sides when the test seller is unavailable, rather than stopping. One approved command should always finish a deal, and the printed line keeps the switch visible.
- **The windows count from the offer.** `deliverBy` is `createdAt + deliverWithinSec`, and the club refuses `fundBy >= deliverBy` (measured: the first draft's 900 s delivery window was refused `invalid_terms: fundBy < deliverBy violated`). So the seller offers 1,800 / 2,400 / 3,600 s, and a stalled seller locks the buyer's hold for at most an hour after the offer.
- **The seller signs and stores each submission before sending it.** It keeps the signed body and one idempotency key per step, so a retry after a lost answer replays the first submission (measured in `seller.test.ts`: one `delivery.submitted` after a lost delivery answer). Its own submit wrapper sorts answers: a 429, a 5xx or a network error is retried with backoff for up to 15 minutes, `relay_refused` is reported as Crow's relayer running out of test ETH, and any other refusal fails the deal with its reason.
- **No changes to `examples/agent.ts`.** The seller uses `Agent.sign` and `Agent.prepareDelivery`, and posts the signed bodies itself, so the shared agent stays as it is.
- **The tests for `try.ts --seller` live in `apps/test-agents/src/try.test.ts`**, not `examples/try.test.ts`: the examples project typechecks its tests, and importing the seller from there would make the two projects reference each other.
- **The route is narrow**: `escrow.stream/agents/test-seller*`, so other pages under `/agents/` stay the site's.
- **Deadlines close deals, not the retry budget**, once an offer is on Crow (review finding 1). The buyer may still fund a waiting offer, so a transient outage keeps it open until `deliverBy` plus 10 minutes. A request that was never offered still fails after 15 minutes of retries.
- **The shared caps count offers**, not requests (review finding 7). A request is counted once its proposal opens and reads. New requests run one at a time, so two cannot both take the last slot.
- **Party text in `try.mjs` output** is one plain line (review finding 3). The character classes are built from code points: the edit tooling turned ` ` escapes into raw line separators, which break the regex.

## Handoff

What is done, what is not, how to resume, and the open questions that remain.

- **Done in the repository:** the service (`apps/test-agents`), the `try.mjs --seller` mode, `llms.txt` "Try it" and its check (`site/check.mjs` group 8), D47, the research note, the docs (`docs/operations.md`, `docs/update-flow.md`, `docs/backlog.md`, `SECURITY.md`).
- **Not done: the deploy, Rafa's gate.** The order is in `docs/operations.md`, "Crow's test seller, the first deploy": the Worker and its route, then `seed.mjs`, then the health check and one live deal each way, then the site. The site may go first without harm: `try.mjs` plays both sides while the seller is missing, and says so.
- **To measure at the first deploy:** which client IP the operators see for the seller's calls (same zone, so `cf-connecting-ip` follows `x-real-ip`; research note §5), and the live deal's transactions for the Evidence above.
- **Open for Rafa (D47):**
  1. The faucet's mandate renewal fix in `apps/demo-cloud/src/world.ts`, before the standing address is 30 days old: done in the repository by T-223; it reaches the live demo with the next operator deploy.
  2. When to plan the test buyer (backlog).
  3. Whether `try.mjs` should stop instead of falling back when the seller is unavailable.
- **To resume:** read D47 and the research note, then `apps/test-agents/src/seller.ts`; `npx vitest run apps/test-agents` runs its 22 tests in about 12 s.
