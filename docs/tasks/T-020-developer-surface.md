# T-020: Developer surface: an HTTP API, examples and a quickstart a newcomer can use

- **Lane:** api + demo
- **Phase:** 1
- **Depends on:** T-007, T-009, T-012, T-018
- **Paths this task may touch:** `docs/team.md` (Rules and checks rows, at review), `docs/backlog.md` (rows, at review), `examples/` (new, inside the pnpm workspace), `apps/operator/` (new endpoints, a start script and bin), `apps/adjudicator/` (a test adjudicator), `README.md`, `docs/api.md`, `docs/quickstart.md` (new), package `README.md` files, `pnpm-workspace.yaml`, root `package.json` scripts, and the root `tsconfig.json` and `vitest.config.ts` (to compile and test `examples/`)
- **Human gate:** no
- **Status:** review
- **Agent/session:** implementer, 2026-10-31
- **Re-scoped:** 2026-10-31 by D30 (API-first, Rafa via the coordinator): no high-level SDK layer and no MCP server now; the existing SDK client stays as it is.

## Intent

Two outsider agents (`docs/reviews/2026-10-31-outsider-usability.md`) settled deals correctly but spent nearly all their time reading source, because there is no way in: no quickstart, a wrong SDK example, a low-level SDK, no runnable operator or adjudicator. Make the first deal take minutes from `README.md`.

**Restated (implementer, after D30).** An agent in any language should settle its first deal from `README.md` in minutes, talking only to an operator's HTTP API and signing with a standard library (viem, ethers, eth-account). The operator prepares; the agent verifies and signs; the operator relays. Concretely:

1. **Prepare, sign, submit.** For each party message (offer, agree and fund, delivery, early accept, appeal, mutual settlement), `POST /v1/prepare/<kind>` takes plain inputs and returns the exact EIP-712 typed data (domain, the types it needs, primary type, message with nonce and expiry filled), its digest, and the body to submit with the signature slot(s) named. The typed data is a pure function of the inputs plus defaults the response states, so an agent can recompute and check it. The agent submits the signed body to the existing write route. The operator never signs a party message and never holds a party key.
2. **Deliveries without our SDK.** `GET /v1/commitments/{id}/recipients` lists each required recipient's encryption public key and the envelope spec. The envelope (our NaCl box construction, not HPKE) is documented byte for byte with test vectors that a test checks against core. `POST /v1/ciphertext` stores ciphertext; operators never see plaintext.
3. **Defaults.** `POST /v1/prepare/offer` takes a `default` or `checks-only` template and fills the club's rulebook hash and the primary adjudicator's policy ID, policy hash, registry hash and minimum fee from its published registration.
4. **A world.** `pnpm sim`: SimChain, two operator nodes, three test adjudicators with fake judges, funded test keys, all printed.
5. **Docs and examples.** `docs/quickstart.md` (first in `README.md`): curl for every step, plus a short signing snippet in TypeScript and in Python. `examples/buy-dataset.ts` and `examples/sell-translation.ts` use only `fetch`, a signing library and a NaCl library, and run in CI. The review's doc fixes.
6. **Discovery (optional add).** `/.well-known/holdback.json`: the status document plus the API base URL.

**Non-goals.** No protocol, schema or settlement-rule change; no SDK expansion (the client stays internal); no MCP server; no operator-side encryption of plaintext; no package publishing. The outsider re-test is run by the coordinator (Handoff).

## Context

- The outsider review (all friction items); `docs/api.md`; `apps/operator/`; `packages/core/src/eip712.ts` and `packages/core/src/crypto/`; D30.

## Acceptance criteria

- [x] Prepare endpoints for offer, agree-and-fund, delivery, early accept, appeal and mutual settlement return EIP-712 typed data, digest and submit body; signing that typed data with viem and submitting the body moves the commitment. The operator signs nothing.
- [x] "Verify before you sign" documented with the fields to check (counterparty, amount, adjudicators, payouts).
- [x] Recipients endpoint and envelope spec with test vectors checked in CI; ciphertext upload and read endpoints.
- [x] Offer prepare with `default` and `checks-only` templates; policy and registry hashes from the adjudicator's published registration.
- [x] `pnpm sim` starts SimChain, two operator nodes and three test adjudicators with fake judges, printing endpoints and funded test keys.
- [x] `examples/buy-dataset.ts` and `examples/sell-translation.ts` (fetch + signing library only), each under ~60 lines, run in CI.
- [x] `docs/quickstart.md` linked first from `README.md`: curl per step, TypeScript and Python signing snippets; states SimChain, fake judges, no real money, fee kept on refund, tUSD 6 decimals.
- [x] `docs/api.md`: example matches the API; `apply_default` in the trigger table; `key.released` says whose key it is.
- [x] Fake-judge records are marked as fake wherever they appear to an integrator.
- [x] OpenAPI for the new endpoints if T-015's document is cheap to extend; otherwise noted. (Noted: no document exists yet; see Decisions.)
- [x] Re-run the outsider test (both briefs, fresh agents) and record time to first settled deal; target under 15 minutes with no source reading (coordinator). Buyer 2 min 35 s, seller about 62 s, no product-source reads (reported by the coordinator).
- [x] `pnpm verify` green.

## Out of scope

- Publishing packages to a registry (needs Rafa); a high-level SDK and the MCP tool surface (D30); protocol changes; operator-side encryption of plaintext.

## Evidence

- **`pnpm verify` green on a clean tree** (measured, 2026-10-31, branch `t-020-developer-surface`): typecheck, lint, test (71 files, 1,983 tests), spec, snap and demo all pass; report `reports/verify-t-020-developer-surface.md`.
- **Prepare, sign, submit works end to end with viem and the agent's own key** (measured): `apps/operator/src/sim-world.test.ts` signs every prepared message with viem after checking `hashTypedData` of the converted typed data equals the operator's `digest`, and drives offer, agree-and-fund, delivery, release, refund, appeal and co-signed settlement through the second operator node. The offer digest equals core's `termsDigest`; two prepares with the same inputs give the same digest; the offer's `policyHash`, `registryHash` and fee equal the primary's published registration.
- **The operator signs no party message** (inferred from code): `prepare.ts` builds typed data and digests only; the operator's only key signs receipts, as before.
- **Deliveries need only standard libraries** (measured): `examples/agent.ts` encrypts with Web Crypto and seals keys with `tweetnacl`, and the core-based test adjudicators open and judge those deliveries (both examples settle). `envelope-spec.test.ts` checks the docs/api.md test vectors against core and against a tweetnacl and Web Crypto build of the spec.
- **Examples run in CI** (measured): `examples/examples.test.ts` runs `node examples/run.ts buy-dataset` against a running sim and `sell-translation` with no sim (run.ts starts one), checks outcomes and the fake-judge label, runs `sign.ts` on a prepared offer, keeps each example at 60 lines or fewer with no `@holdback/*` import, and checks that every `$API/...` path the quickstart curls is an operator route. CI's `pnpm test` includes `examples/*.test.ts`.
- **The quickstart works as written** (measured): its commands, run in order by a scratch script against `node apps/operator/dist/sim-bin.js` on the default ports, went Offered, AcceptedByAdjudicator, Held, Delivered, Released; the buyer opened the CSV; balances 9,974 and 10,025 tUSD; events show `key.released` to the primary, then to the buyer; 3.6 s wall time for the deal steps.
- **`pnpm sim`** (measured): prints both operators, the sim service, three adjudicators, four funded accounts with signing keys, and the economics; `/.well-known/holdback.json` answers with `apiBaseUrl`.
- **docs/api.md example matches the API** (measured): a test posts the agree-and-fund shape and compares the documented request and response fields with the live ones.
- **Demo unchanged** (measured): `git diff c523faa -- apps/demo packages/sdk packages/core packages/settlement packages/judgment spec` is empty. `pnpm demo` stdout before and after, timings masked, differs only in "Record hash" and one beat-6a "decision event" hash; two runs of the same build differ in those same fields (measured), so they vary run to run on main too.
- **Python signing snippet** (guessed): written against eth-account's documented `encode_typed_data` and `sign_typed_data`; not run (eth-account is not installed here and is not in CI).
- **Time to first settled deal for an outsider** (reported by the coordinator, not measured here): buyer 2 min 35 s, seller about 62 s, zero product-source reads.

**Review round (PR 53).**

- **HIGH 1, signers trusted the operator** (measured, fixed): `examples/verify.ts` rebuilds every kind's message from the agent's own intent, with the EIP-712 domain and types pinned in the agent, and accepts from the operator only a nonce and a time near the agent's clock. `examples/verify.test.ts` (`neutrality.operator-lies-in-prepare`) applies 19 edits to a prepared offer (buyer in typed data, body or both; price; fee; primary; `domain.chainId`; `verifyingContract`; extra slot; `primaryType`; types; `buyerEncryptionPublicKey`; deliverable hash; checks; token; a deadline; nonce; `createdAt`; submit path), each with the digest recomputed, plus 4 agreement edits, a budget, a foreign key and settlement payout and `releaseKey` edits: every one is refused. The reviewer's exact attack through `sign.ts` exits 3 with "refusing to sign" (`examples/examples.test.ts`). The honest messages, signed from the agent's own typed data, are accepted by SimChain, so the pinned encoding matches core (measured).
- **HIGH 2, seller sealed to whatever /recipients returned** (measured, fixed): `Agent.deliver` takes the buyer's key from the signed terms and each adjudicator's key from its registration as both operators serve it, and refuses when `/recipients` or one operator's registration differs. Tested with a lying proxy operator in front of operator 1: a swapped buyer key and a swapped adjudicator key are both refused; through the same proxy with no lie the delivery succeeds.
- **MEDIUM 3** (measured, fixed; bounds later relaxed by D31, see the second round): malformed timing values answer 400 `invalid_terms`, never 500.
- **LOW 4** (measured, fixed): default nonces are keccak256 of the whole message without its nonce; two settlements differing only in `releaseKey` get different nonces, identical ones the same.
- **LOW 5, LOW 6** (fixed): the retry wording now says defaults must be passed back; `/.well-known/holdback.json` gives `domain.chainId` as a number (measured), `/v1/status` keeps the schema's string.
- **Re-test items** (measured): `pnpm sim` on a taken port prints a one-line hint (`Port 8787 is in use … pnpm sim --port 9780 --operator-ports 9787,9788`); `POST <sim>/accounts` hands out fresh funded accounts and both examples and the quickstart use them; `FAIL-ME` in panel-judged work is refunded; `POST <sim>/adjudicators/primary {"silent": true}` plus `/advance` lets the fallback decide; `GET /v1/ciphertext/{id}` sends `X-Content-Type-Options: nosniff`; docs/api.md marks 11 unbuilt routes "planned: 404 today", and a test checks the marked set equals the set the operator does not route. Check-types table, rubric shape and a who-gets-what table added to docs/api.md (inferred from `packages/judgment/src/checks/index.ts` and SimChain's postings, not each run).
- **Quickstart after the fixes** (measured): its commands, run in order against `pnpm sim`, settle a deal with every message verified (Offered, AcceptedByAdjudicator, Held, Delivered, Released; balances 9,974 and 10,025 tUSD); 3.4 s wall time for the deal steps.
- **`pnpm verify` green on a clean tree after the review fixes** (measured, commit `dbd811b`): typecheck, lint, test (72 files, 1,993 tests), spec, snap and demo pass.
- **Python snippet** (superseded): replaced in the second round by an honest note (below).

**Second review round (security re-check at 37054b8, D31, Haiku re-run).**

- **Appeal bond** (measured, fixed): the verifier computes the bond as price × `appealBondRateBps`, rounded up, from the club rulebook read across operators, and requires an exact match; a larger bond, another token, role, address, grounds or a far `filedAt` are refused, and the honest appeal opens on SimChain.
- **Distinct sources** (measured, fixed): trusted reads dedupe operators by origin and need two distinct ones; one node listed three ways is refused. Backlog row added (adjudicator self-published key, then on-chain registry).
- **Own nonces** (measured, fixed): the agent generates every nonce and sends it; the verifier refuses any other, an offer request without one, and agreement and funding sharing one.
- **Settlement-layer time** (measured, fixed): the verifier takes `now` as a required argument; agents read `settlementTime` from `/.well-known/holdback.json` on at least two operators (within 5 s of each other). After `POST /advance` of an hour, an honest offer verifies and submits; against the wall clock it would be refused. `createdAt` may be at most 60 s ahead.
- **Edit coverage** (measured): delivery (8 edits), early accept (4), appeal (6), settlement (payouts, `releaseKey`, nonce) added; all refused, and each honest message is accepted by SimChain. The default template verifies whether named or omitted; the server refuses `default` without a rubric (400), so there is nothing to sign.
- **D31, windows are free parameters** (measured): the 1 s to ten years bound and the within-a-day bound on caller times are gone. `judgeWithinSec: 0`, a four-century delivery window and a 2020 `createdAt` now prepare (200); `1.5`, `1e20`, `"abc"`, `-5` and an unknown window are 400.
- **Haiku re-run items:** `apiBaseUrl` no longer ends in `/v1` (every path and `submit.path` carries it), and the quickstart sets `$API` from it; the quickstart says it is written for bash and runs in zsh (both measured: the full walkthrough plus a post-`/advance` offer pass under `bash` and `zsh`); "Released means paid; final means the appeal window has also closed" is stated where `Released` first appears. Request bodies as files under `examples/requests/` (optional) not done: they need the per-run addresses and nonces, which the heredoc fills.
- **`pnpm verify` green on a clean tree after the second round** (measured, commit `9fe8670`): typecheck, lint, test (72 files, 1,999 tests), spec, snap, demo.
- **Python** (docs): the snippet that signed only the Agree half is replaced by a note: no port of `verify.ts` exists yet, a signing call alone is not safe, and what a port must cover.

## Decisions

- **API-first per D30.** The party-level SDK built before D30 arrived was removed before any push; `packages/sdk` and `apps/demo` are byte-identical to `main`. Terms presets, test accounts and tUSD units moved into `apps/operator` for the prepare endpoint and the sim.
- **The submit endpoint is the existing write route.** A prepare response names `submit.path` and a body with signature slots; the agent fills them and POSTs with an `Idempotency-Key`. No new submit route: a self-built message and a prepared one take the same path.
- **Prepare is a read.** `POST /v1/prepare/{kind}` records nothing, so it takes no `Idempotency-Key`; it is throttled as a read.
- **Deterministic defaults.** Default nonces are keccak256 of the kind and inputs; times default to settlement-layer time and are echoed in `defaults`. A retried prepare yields the same message (accepted once). Cost: two separate identical offers in the same second need distinct `nonce` values (documented).
- **Integers as decimal strings in typed data**, `chainId` as a number. Measured: viem hashes a string-valued uint differently from the integer without an error, so the docs and every snippet convert by `types` and compare with `digest` before signing.
- **Envelope: not HPKE.** Core's envelope is a NaCl box from an ephemeral key (`x25519-xsalsa20poly1305`), not RFC 9180. Changing it would be a schema and crypto change needing an ADR; instead the construction is specified byte for byte with test vectors, and it is buildable with libsodium, tweetnacl or PyNaCl.
- **Ciphertext upload requires an Idempotency-Key** (hard rule), fingerprinted by the bytes' SHA-256.
- **The sim service serves test keys over HTTP** (`GET :8780/`). They derive from public labels and fund only SimChain tUSD; it keeps the examples free of key derivation code.
- **`apps/operator` now depends on `apps/adjudicator` and `packages/judgment`** for the sim world only. No cycle.
- **Root `tsconfig.json` and `vitest.config.ts` touched** to compile and test `examples/` (listed in the re-scoped paths).
- **OpenAPI not generated.** T-015 (OpenAPI contract) is still `todo` and no document exists to extend; writing one for only the new endpoints would fork it.
- **The verifier is example code, not a package** (D30): `examples/verify.ts`, about 170 lines rather than the suggested 50 to 80, because a field-by-field rebuild needs the pinned types (about 25 lines) and one builder per kind. The agent signs the typed data it built and submits the body it built; the operator's typed data and digest only have to match.
- **Trusted reads = agreement of at least two operators.** Adjudicator registrations and the club rulebook are read from every configured operator and must be identical (and `policyHash`/`rulebookHash` must hash correctly). An adjudicator's own well-known document is not built; a settlement-layer registry is the later source (Phase 2).
- **Operator times are bounded, not trusted (agent policy):** `createdAt`, `submittedAt` and `filedAt` from 10 minutes behind to 60 seconds ahead of settlement-layer time as two operators report it; `expiresAt` within a day ahead. Nonces are the agent's own.
- **What the API still refuses under D31, and why.** Malformed input: a window that is not a non-negative whole number, an unknown window or field (schema strictness), a time that is not RFC 3339, an amount that is not base units. Not representable or not processable by the commitment contract (`parseCommitment`): a deadline past year 9999 (RFC 3339 has four-digit years, so year 20270 cannot be written in the schema's `date-time`; allowing it is a schema change), an appeal window or decision period over 2^32 − 1 seconds (the contract's bound), and `offerExpiresAt` not after `createdAt` (an offer that expires as it is made). The club rulebook's minimum windows are left to the settlement layer at submit. Everything else is the parties' choice; a "looks off" advisory is a backlog row.
- **Discovery (optional add) done:** `/.well-known/holdback.json` is `/v1/status` plus `apiBaseUrl`; quickstart step 2.

## Handoff

- **Outsider re-test:** done by the coordinator (see Evidence). This implementer spawned nothing. The quickstart changed after it (verified signing, fresh accounts), so a short re-run would confirm the new steps.
- **Not built, from the re-tests:** a "final at T" and a "buyer can decrypt" field on the commitment view. The view is `commitment-state.schema.json`, so that is a contract change (ADR and version bump); today `deadlines.appealBy` and `GET /v1/commitments/{id}/key?recipient=` answer both. Backlog candidate.
- **Adjudicator well-known document:** a third trusted source for adjudicator keys and policies (an adjudicator serving its own registration) is not built; backlog candidate alongside the Phase 2 settlement-layer registry.
- **Decisions file:** the decisions above are not yet in `docs/decisions-today.md` (outside this task's paths); the coordinator may record the envelope-not-HPKE and deterministic-nonce choices there.
- **Possible opt-in later (not built):** operator-side encryption of plaintext for agents without crypto libraries. It would put plaintext and the content key on an operator, against the two-sided hold's privacy model (ADR-0012, ADR-0020); it would need an ADR.
- **Backlog candidates:** OpenAPI for the prepare, ciphertext and recipients endpoints once T-015 lands; a Python example in CI; `GET /v1/commitments/{id}/key` signed requests (Phase 2, private disclosure); an HPKE envelope option via ADR if a standard is wanted.
- **Rules and checks (`docs/team.md`):** two rows added at the reviewer's request: "Operator proposes, agent verifies" (`examples/verify.test.ts`) and "Examples run as written" (`erasableSyntaxOnly` in `examples/tsconfig.json`).
