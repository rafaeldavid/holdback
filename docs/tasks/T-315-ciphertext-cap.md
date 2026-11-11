# T-315: The ciphertext size cap is published, and the docs and the nodes agree

- **Lane:** api and demo (the ciphertext route in `apps/operator`, the demo's store in `apps/demo-cloud`)
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `apps/operator/src/server.ts`, `apps/operator/src/problems.ts`, `apps/operator/src/agent-ready.test.ts`, `apps/demo-cloud/src/world.ts`, `apps/demo-cloud/src/world.test.ts`, `spec/openapi/paths.json` and the generated `spec/openapi.json`, `docs/api.md` and `site/llms.txt` (the ciphertext sentences), this file.
- **Human gate:** yes for the deploy only: the live operators publish the cap after Rafa deploys them. Everything else is in the repository.
- **Status:** review
- **Agent/session:** faucet and ciphertext-cap session, 2026-11-11 (Rafa asked for T-314 and T-315 that day)

## Intent

Three sources disagree about the largest ciphertext a node stores. The live nodes store at most 1 MiB (`DEMO_MAX_CIPHERTEXT_BYTES`, 1,048,576 bytes). `docs/api.md` and the OpenAPI document say 10 MiB. Discovery names no cap. A seller that trusts the docs uploads 5 MiB and gets a refusal it cannot act on.

The goal: one number, stated in four places that agree.

- **Discovery** states the largest ciphertext the node stores, in bytes, as `limits.maxCiphertextBytes`. A node with no ciphertext store states none.
- **`docs/api.md` and `site/llms.txt`** state the same number for the public demo and point to discovery for any other node.
- **An upload over the cap** gets 413 `payload_too_large` with `maxBytes`, the cap in bytes, so an agent reads the limit from the refusal.
- **A test** compares the node's cap, discovery and both docs.

The number stays 1,048,576 bytes (1 MiB) on the demo nodes: see Decisions. Non-goals: raising the cap, a new store, chunked uploads, and any change to the protocol's own ceiling of 10 MiB (`MAX_CIPHERTEXT_BYTES` in `packages/core`) or to what an adjudicator reads at intake.

## Context

- `apps/demo-cloud/src/world.ts`: `DEMO_MAX_CIPHERTEXT_BYTES` and `StorageCiphertextStore`, which keeps each ciphertext as one row of Durable Object storage.
- `apps/operator/src/server.ts`: `ciphertext` (the route counts bytes against core's 10 MiB), `discovery` (builds `limits`), `body` (the 1 MiB limit on JSON bodies).
- `apps/operator/src/problems.ts`: `ProblemMembers`, the typed members a problem carries.
- `spec/openapi/paths.json`: `Discovery.limits` and `Problem`, both closed objects in the hand-written paths file, not in `spec/schemas/`.
- `docs/api.md`, "Limits (F8)" and the `/v1/ciphertext` row; `site/llms.txt`, section 7.

## Acceptance criteria

- [x] Discovery states `limits.maxCiphertextBytes` on a node that stores ciphertext: 1,048,576 on the demo.
- [x] An upload of exactly the cap is stored; an upload 1 byte over gets 413 `payload_too_large` with `maxBytes` equal to the cap and a detail that names it.
- [x] A store that refuses an object as too large gets the same 413, never a 500.
- [x] `docs/api.md`, `site/llms.txt` and the OpenAPI document state the demo's cap and no longer say a node stores 10 MiB.
- [x] One test compares the code's cap, discovery, `docs/api.md` and `site/llms.txt`.

## Out of scope

- A larger cap (see Handoff).
- The deploy (Rafa's gate).

## Evidence

- Commands run and results:
  - Red first (measured): with only the tests added, `pnpm exec vitest run apps/operator/src/agent-ready.test.ts apps/demo-cloud/src/world.test.ts -t "T-315|carries the limits|states what the demo is"` failed 4 of 4: discovery had no `limits.maxCiphertextBytes`.
  - Green (measured): the same command passes 4 of 4. On the demo world an upload of 1,048,576 bytes is stored and served back, and one of 1,048,577 bytes gets 413 `payload_too_large` with `maxBytes: 1048576`. The same test reads `site/llms.txt`, `docs/api.md` and `spec/openapi/paths.json` and finds "1,048,576 bytes" beside `maxCiphertextBytes` in each, and no line that says a node stores 10 MiB.
  - The kind's local checks (measured, 2026-11-11): `pnpm typecheck` passes. `pnpm exec vitest run apps/demo-cloud apps/operator tests/contract apps/test-agents tests/spec.test.ts` passes: 35 files, 548 tests, 3 skipped (the Sepolia-fork file needs `SEPOLIA_FORK_RPC`). After the rebase onto T-314 (PR 274) the same command passes 550 tests. `pnpm validate:spec` passes with `spec/openapi.json` fresh. `pnpm exec eslint apps/demo-cloud/src apps/operator/src` reports nothing. `node site/build.mjs && node site/check.mjs` passes and changes no built file.
  - The full `pnpm verify` did not run: the change recipes keep it for a deploy. CI is the gate.
- Snapshot diffs: none.
- Metrics: none.

## Decisions

- **The demo's cap stays 1,048,576 bytes (1 MiB).** The demo keeps each ciphertext as one row of Durable Object storage, and the code's own note puts a row at 2 MiB at most (inferred from that note; this task did not re-measure the platform's limit). 1 MiB leaves half the row for the key and the encoding. The nodes already enforced 1 MiB; only the docs said 10 MiB, so the docs change and no upload that worked before fails now (inferred from the store's check, unchanged). The demo's deliveries are text files of a few kilobytes (inferred from the adjudicators' four text formats and the test seller's 3-row CSV).
- **10 MiB stays the protocol's ceiling.** `MAX_CIPHERTEXT_BYTES` in `packages/core` is the most `seal` produces and an adjudicator reads. An operator sets `maxCiphertextBytes` from 1 byte up to it, and the operator refuses to start outside that range.
- **The operator states the cap; the store does not.** `OperatorOptions.maxCiphertextBytes` is new, and the demo passes `DEMO_MAX_CIPHERTEXT_BYTES` to both the store and the operator. The `CiphertextStore` interface is in `packages/core`, outside this task's paths. If a store refuses an object the operator let through, the node answers 413 without `maxBytes`, since it cannot vouch for a number; before this task it answered 500 (inferred from the uncaught `StoreError`).
- **The refusal's member is `maxBytes`, on every `payload_too_large` this API sends.** The ciphertext route carries the node's cap; a JSON body over 1 MiB carries 1,048,576. One member, one meaning: the largest body the route takes, in bytes.
- **`limits.maxCiphertextBytes` and `maxBytes` go into `spec/openapi/paths.json`, not `spec/schemas/`.** Both `Discovery.limits` and `Problem` live only in the paths file, so this is kind 4: two optional fields, no ADR, no version bump. `spec/openapi.json` is regenerated with `pnpm openapi`.

## Handoff

- **Done in the repository:** discovery states the cap, the upload route refuses by it with `maxBytes`, the docs and the OpenAPI document state the demo's number, and one test compares them.
- **Not done: the deploy (Rafa's gate).** Until both operator Workers are deployed (`pnpm demo-cloud:deploy`), live discovery names no cap, and an upload between 1 MiB and 10 MiB still fails without `maxBytes`. `site/llms.txt` on crow.direct and the problem page for `payload_too_large` show the new text after a site deploy (`pnpm site:deploy`). No new world is needed.
- **Open, for the backlog:**
  - A larger cap needs chunked rows or an object store (R2) behind `StorageCiphertextStore`. Nothing has asked for more than 1 MiB yet.
  - The store could state its own limit (`CiphertextStore.maxBytes`, core lane), so an operator cannot state a number its store does not hold.
  - The platform's 2 MiB row limit is taken from the code's note. Measure it on a deployed Worker before raising the cap.
- **To resume:** `pnpm exec vitest run apps/demo-cloud/src/world.test.ts apps/operator/src/agent-ready.test.ts -t "T-315"`.
