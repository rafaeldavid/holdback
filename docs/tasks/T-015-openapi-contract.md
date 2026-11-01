# T-015: OpenAPI document, staleness check and HTTP contract test

- **Lane:** api
- **Phase:** 1
- **Depends on:** T-007, T-010
- **Paths this task may touch:** `spec/openapi/` (paths file), `spec/openapi.json` (generated), `scripts/openapi.mjs`, `scripts/validate-spec.mjs`, `tests/contract/`, `apps/operator/src/openapi/`, root `package.json` (`openapi` script). Added after review, approved by lead: `apps/operator/src/server.ts` (routes for `/v1/openapi.json` and `/llms.txt`), `packages/settlement/sim/actors.ts` (sim rulebook version), `docs/api.md` (two discovery rows), `docs/team.md` (Rules and checks row), `vitest.config.ts` (shard cost entry), root `package.json` (`engines`)
- **Human gate:** no (the schemas it reads are already accepted in v0.5)
- **Status:** done
- **Agent/session:** —

## Intent

Give agents and tool builders one machine-readable description of the operator API that is generated from `spec/schemas` and proven against the running operator (ADR-0017 §11).

**Restated (implementer, 2026-11-01).** Since D30 the HTTP API is the product surface, so an agent framework should be able to generate its tools from one OpenAPI 3.1 document. This task produces that document and keeps it honest:

- **One description of every route an operator node serves** (`apps/operator/src/server.ts`, including T-020's `/v1/prepare/*`, `/recipients`, `/v1/ciphertext`, `/.well-known/holdback.json` and `/v1/test/faucet`), with an operation ID, summary and description per operation that a tool generator can use as-is. Each prepare operation says "verify before you sign" and links `docs/api.md`. The sim service's own routes (`pnpm sim`'s `/accounts`, `/advance`, ...) are not operator routes and stay out.
- **Generated, not hand-copied.** `pnpm openapi` builds `spec/openapi.json` from `spec/schemas` (every body schema hoisted into `components.schemas` with its `$ref`s rewritten) plus a hand-written paths file. Shapes that exist only at the operator (prepare inputs and answers, recipients, discovery) are written once, in the paths file, and reuse spec schemas by `$ref`. `x-holdback-untrusted` survives.
- **Kept fresh.** `pnpm validate:spec` fails when the committed `spec/openapi.json` differs from a fresh build, or when a `$ref` dangles or a schema does not compile under Ajv strict.
- **Proven against a running operator.** The snap runner drives SimChain directly, not HTTP, so the contract test drives the HTTP flows instead: the `examples/` agent (offer, agree and fund, encrypted delivery, release, open) and the sim-world flows (refund and appeal, early accept, mutual settlement, triggers, dry runs, idempotent replay and conflict, problems, throttling, relay refusal, the event stream). Every response from an operator is checked against the document (status listed, required headers present and valid, body valid), and every documented operation is exercised at least once.
- **Served.** `GET /v1/openapi.json` returns the document with `servers` set to the node's own base URL; `GET /llms.txt` points to it and to `docs/api.md`.
- **The planned routes stay out.** `docs/api.md`'s "planned: 404 today" routes are not in `paths` (a tool generator would otherwise make tools that always 404); they are listed under a top-level `x-holdback-planned`. A test checks that the documented operations are exactly api.md's served rows.

Non-goals: no change to `spec/schemas` (no version bump); no new bounds on negotiable values (D31: prepare inputs carry only the operator's own refusals, such as non-negative whole-second windows); spec examples as contract inputs; `RateLimit` and `Deprecation` headers; the `202 pending` chain responses (no chain in Phase 1); generating an SDK or tools (T-021).

## Context

- ADR-0017; `docs/api.md`; `spec/schemas`; T-010's scenario fixtures; OpenAPI 3.1 (JSON Schema 2020-12).

## Acceptance criteria

- [ ] `pnpm openapi` generates `spec/openapi.json` from `spec/schemas` plus a hand-written paths file; no body schema is written twice.
- [ ] `pnpm validate:spec` fails when `spec/openapi.json` is stale.
- [ ] Contract test: T-010's scenario fixtures run through an operator over HTTP, and every response validates against the document (status, headers, body). It runs in CI on SimChain.
- [ ] `GET /v1/openapi.json` serves the document; the operator root serves `llms.txt` pointing to it and to `docs/api.md`.
- [ ] Party-authored fields keep `x-holdback-untrusted` in the generated document.

## Out of scope

- Spec examples as contract inputs (their signatures are placeholders).
- RateLimit and Deprecation headers (deferred by ADR-0017).

## Evidence

- **measured:** `pnpm verify` on a clean tree at the branch head passes all six steps: typecheck, lint, test (73 files, 2014 tests), spec, snap, demo (`reports/verify-t-015-openapi.md`).
- **measured:** `pnpm openapi` writes `spec/openapi.json`: 38 operations, 79 component schemas, schema v0.6. `pnpm validate:spec` prints `ok spec/openapi.json (38 operations, 158 schemas compiled strictly, fresh)`. A test writes a hand-edited copy and `checkOpenApiDocument` reports it stale.
- **measured:** contract test (`tests/contract/openapi.contract.test.ts`): 177 operator exchanges recorded, 0 failures; 38 of 38 documented operations exercised, 33 with a 2xx; statuses seen 200, 400, 403, 404, 409, 429. The five reached only with a refusal: `submitAdjudicatorAcceptance` and `submitDecision` (the sim adjudicators submit to SimChain directly), `submitFunding` and `submitHold` (signatures the prepare flow does not produce), `getClubMember` (the sim club admits no members). About 1.1 s for the flows, 2.3 s for the file.
- **measured:** the contract test found a real violation on its first run: `GET /v1/clubs/sim-club` served `rulebook.version: "1.0-sim"`, which `club.schema.json` refuses. Fixed in `packages/settlement/sim/actors.ts` (see Decisions).
- **measured:** the documented operations equal docs/api.md's served rows exactly, and `x-holdback-planned` equals its 11 "planned: 404 today" rows (test). Every `x-holdback-untrusted` marker in `spec/schemas` (39) is at the mapped place in the document (47 in all: the extended schemas repeat some, plus `Problem.detail` and `Prepared.check`).
- **measured:** a negative check: the validator refuses a fractional amount, an unlisted status, a malformed or missing required header, an undocumented content type and a problem whose `instance` does not repeat `Request-Id`.
- **measured:** D31: the prepare-offer timing windows are `{type: integer, minimum: 0}` with no maximum; a request with a four-century delivery window and a 2020 `createdAt` validates against the request schema, and every JSON request the operator accepted in the flows validated against its request schema.
- **inferred:** `pnpm validate:spec` needs no build in CI's static job: `scripts/openapi.mjs` imports only `packages/core/src/problem.ts`, which has no imports, through Node 22's type stripping (on by default since 22.18; measured locally on 22.22.2).
- **guessed:** the document works with common OpenAPI tool generators. It uses only local `#/components/...` references and plain JSON Schema 2020-12, but no generator was run against it (that needs a new dependency; T-021 will).

## Decisions

- **Paths file is JSON** (`spec/openapi/paths.json`), with OpenAPI's own reuse (`components.parameters`, `headers`, `responses`) and two generator conveniences: `x-holdback-errors` lists an operation's problem statuses (the generator adds 500 and the `Problem<status>` responses) and `x-holdback-extends` deep-merges additions into a spec schema. JSON keeps the generator dependency-free and the contract language-neutral.
- **Spec schemas are flattened, not linked by `$id`.** Each file becomes `components.schemas.<PascalCase file>` and each `$defs` entry `components.schemas.<name>`, with every `$ref` rewritten to a local pointer; the generator refuses a name collision. Tool generators handle local pointers far better than cross-document `$id` resolution.
- **Operator-only shapes are written once, in the paths file**, and reuse spec schemas by `$ref`: prepare inputs and answers, recipients, discovery, member and agent views, the faucet. Where a spec schema is closed (`additionalProperties: false`) and the operator adds a field (a write's `receipt`, an adjudicator's `bond`, a mandate's `mandateHash`, a page's item type, discovery's numeric `chainId`), the paths file extends it with `x-holdback-extends` instead of copying it. No change to `spec/schemas`, so no version bump.
- **One operation per prepare kind** (`prepareOffer`, `prepareAgreeAndFund`, ...) rather than one `/v1/prepare/{kind}`: each gets its own input schema and its own "verify before you sign" list, which is what a generated tool needs. Triggers stay one operation with an enum `kind`, since they share an empty body.
- **Planned routes are left out of `paths`** and listed under top-level `x-holdback-planned`, so a generator makes no tool that always 404s.
- **The contract test drives the HTTP flows, not the scenario fixtures**, because the snap runner submits to SimChain directly and never touches an operator. It uses `examples/agent.ts` as-is for the buy-dataset flow and a plain signer for the rest, plus a third operator node over the same chain with a one-read budget and a refuse-all relay policy, for 429 and 403.
- **Problem `type` enum is generated from `@holdback/core`'s `PROBLEM_TYPES`**, and a test checks that each type is named under the status `statusOf` gives it.
- **Out-of-lane edits, each one line or a table row:** `packages/settlement/sim/actors.ts` (sim rulebook `version` `1.0-sim` to `1.0`: the operator was serving a club that fails `club.schema.json`; nothing hard-codes the sim club's `rulebookHash`, and verify, snap and demo pass); `apps/operator/src/server.ts` (route `/v1/openapi.json` and `/llms.txt` to `apps/operator/src/openapi/`, which the acceptance criterion requires); `docs/api.md` (two rows in the discovery table for the new routes, so the existing route test covers them); `docs/team.md` (a Rules and checks row for the contract test).
- **After review (PR 56, lead: ISSUES, all low):** `getOpenApiDocument` now lists 404 (no spec/openapi.json in the build); the `Idempotency-Key` description says a dry run ignores the key (it stays `required`, which is safe for clients); `engines.node` is `>=22.18`, the first 22.x that strips types by default, since `scripts/openapi.mjs` imports `packages/core/src/problem.ts`; the contract test file's cost (23 tenths, CI run 41288716778) is in `vitest.config.ts`. A new test reads the path literals the router compares against (`s[N] === '...'` and whole paths in server.ts, the write routes in the SDK's `operationOf`) and requires each to be a segment of a documented path, and the prepare and trigger kinds to match the document exactly. Measured: adding `s[1] === 'quotes'` to server.ts makes it fail naming `quotes`. The flows test also now fails if any documented call is answered "no route".
- **`llms.txt` lives at the operator root (`/llms.txt`)**, unthrottled like discovery. It names docs/api.md by repository path, since the docs have no public URL yet.

## Handoff

- **Done:** every acceptance criterion. `pnpm openapi`, `spec/openapi.json`, the staleness and strict-compile checks in `pnpm validate:spec`, the HTTP contract test in CI (it runs in the ordinary `pnpm test` shards on SimChain), `GET /v1/openapi.json` and `GET /llms.txt`, `x-holdback-untrusted` preserved.
- **Not done / follow-ups:**
  - Suggested: a second review by a model from a different family, on (a) whether the "verify before you sign" lists in the prepare descriptions are complete, especially agree-and-fund's `value` (price plus fee, nothing more, the price token) and settlement's payouts (every `to` and `amount`, summing to the price, the `deliveryHash`); and (b) whether `x-holdback-extends` reopens a closed spec schema in a way a client could rely on: it adds named properties only (`receipt`, `bond`, `mandateHash`, discovery's `apiBaseUrl` and `settlementTime`) and keeps `additionalProperties: false`, but that is worth a fresh read.
  - The router-literal test reads source text; a route built from a variable segment would slip past it. An explicit route table in server.ts would close that, if the api lane wants one.
  - `submitAdjudicatorAcceptance`, `submitDecision`, `submitFunding` and `submitHold` are proven only on their problem answers. A success case needs an adjudicator-signed acceptance or decision over HTTP; T-021's simulated agents, or a sim option that makes the adjudicators submit through an operator, would cover them.
  - The `202 pending` answer for chain settlement (docs/api.md, Latency) is not documented; add it with Phase 2's chain target.
  - When a spec schema changes, run `pnpm openapi` and commit the result; `validate:spec` fails until then.
- **Open question:** should `docs/api.md` and the OpenAPI document get a public URL so `llms.txt` can link docs/api.md directly? Not needed for the demo.
