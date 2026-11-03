# T-207: Private deals and the end-to-end encrypted API

- **Lane:** core + api (stage 1 is an ADR in the research lane; stage 2 touches several lanes and should be split into sub-tasks once the ADR is adopted)
- **Phase:** 2
- **Depends on:** stage 1 (ADR) on nothing; it can start now. Stage 2's off-chain parts (read authentication, private records, ciphertext terms, mailbox) depend on stage 1 only. Stage 2's on-chain parts (what the contract emits, amount privacy) depend on T-202 and T-205. The Prividium fragment spike needs a Sepolia deployment (T-206) and is a separate task.
- **Paths this task may touch:** stage 1: `docs/decisions/ADR-0024-private-deals.md` (new, Proposed), `docs/decisions-today.md` (a new D entry), `docs/research/` (the research pass). Stage 2: `spec/schemas/`, `spec/examples/`, `spec/openapi/`, `spec/README.md`, `packages/core/`, `packages/sdk/`, `apps/operator/`, `examples/`, `fixtures/scenarios/` (new `attack.` and `neutrality.` privacy fixtures), `docs/api.md`, `docs/neutrality.md` (residual 9), `docs/backlog.md` (Privacy rows closed or moved). Not `contracts/` or `packages/settlement/evm/`: on-chain changes go to T-202 and T-205 owners through Handoff.
- **Human gate:** none for the repository work. Updating the live public demo (Cloudflare) or the site is a deploy and waits for Rafa. Local chain and Sepolia only; no mainnet.
- **Status:** in progress (stage 2a merged in PR 67, 2026-11-01; next: the adjudicator slice)
- **Agent/session:** implementer, branch `t-207-private-deals-2a`

## Intent

Make "private escrow" true end to end (Rafa, 2026-11-01). Today only the work is private; terms, amounts, addresses, judgment records and events are public reads at every operator. After this task a third party reading any operator learns nothing beyond the deal's disclosure level, and, as far as possible, the operator relaying a deal cannot read it either: agents encrypt the terms body to the parties and named adjudicators, operators store and relay ciphertext and see only what settlement must check (signatures, hashes, money and deadline fields). Prepare becomes a published, deterministic client-side recipe. An encrypted agent-to-agent mailbox, relayed by any operator, replaces off-protocol negotiation mail.

Restated (stage 2a, off-chain only): a private deal's two terms bodies travel only as ciphertext under two keys, sealed to the buyer and the primary, so an operator stores and relays ciphertext and hashes and settlement verifies the same signatures as before (the ID binds only the hashes, so the domain stays 0.6). Parties use one-time keys certified by a `Delegation` from their long-term key, which the counterparty checks and settlement does not. Reads of bodies, full events and records need a `ReadToken` from a party or an involved adjudicator; everyone else gets the settlement projection. Publication posts keys with a co-signed `Publish`, and the operator checks each key against its hash. Non-goals for 2a: contracts and the EVM settlement view, ERC-6538, the adjudicator opening sealed terms, sealed judgment records, time-locked fallback/appeal envelopes, the mailbox, and any deploy.

## Context

- ADR-0020 (public skeleton, private body, record key, disclosure levels `private` / `judgment` / `public`, `ReadToken {viewer, commitmentId, expiresAt, nonce}`, pseudonymous identity mode, amounts public on EVM in Phase 2); ADR-0012 (content key envelopes); ADR-0018 (beacon; tlock shares its trust); ADR-0017 and D13 (agent-ready API, residual 9); D16.
- ADR-0023 ("Versions": the EIP-712 domain version and `commitment.schemaVersion` move only when an existing struct or the terms encoding changes; moving `privateTerms` into use may change the terms encoding, so check).
- `docs/plan.md` T-207 entry (the open questions below); `docs/backlog.md` Privacy rows and the Prividium fragment proposal (now in `docs/research/prividium-fragment.md`); D4 (both the 2026-10-31 evaluation, which did not adopt Prividium, and Rafa's 2026-11-01 note to evaluate a per-escrow fragment).
- `spec/README.md` (`unauthorized` reserved for Phase 2 reads); `docs/backlog.md` operator row "`/v1/events` streams every event unfiltered".

## Stage 1: ADR (research pass first, per the decision process)

ADR-0024 (Proposed) answers, with options and the three litmus tests: what an operator must still see to relay and rate-limit; metadata leakage (who deals with whom, when, how much) and what is accepted as residual; key discovery and rotation for parties and adjudicators; how adjudicators get the plaintext they judge; the client-side prepare recipe and how an agent verifies it; the mailbox (addressing, spam gating by funding or club voucher, retention); amount privacy on Ethereum mainnet (public in Phase 2 per ADR-0020 §8, or confidential tokens as a rulebook option); and the schema version bump (v0.8) with the domain-version consequence. Recorded as a D entry in `docs/decisions-today.md` where Rafa can overrule.

## Acceptance criteria

- [ ] ADR-0024 drafted with status Proposed, and its D entry recorded, before any stage 2 code.
- [ ] Schema v0.8: `ReadToken`, problem `unauthorized` (401), encrypted terms body, mailbox messages, the `private` and `judgment` disclosure levels admitted; `pnpm validate:spec` green; changelog entry; the domain version moved only if the ADR says the terms encoding changed.
- [ ] Reads are authenticated: a body, judgment record or private event is served only with a valid `ReadToken` from a party or an involved adjudicator; others get 401 `unauthorized`, and unauthenticated reads return the public skeleton only (residual 9 closed or narrowed in `docs/neutrality.md`).
- [ ] Fixture `attack.third-party-reads-private-deal`: canary strings planted in the terms body, the work and the judgment reasons never appear in any unauthenticated response, in `/v1/events`, or in any receipt, at any operator (measured by a scan over every read route, as `world.test.ts` scans for keys).
- [ ] Fixture `attack.operator-reads-private-deal`: the same canaries never appear in the operator's stored state or logs; the operator holds only ciphertext and hashes, and settlement still verifies every signature.
- [ ] ~~Fixture `neutrality.operator-refuses-mailbox`~~ dropped: the mailbox left the protocol (ADR-0024 as accepted, D34); it is an optional operator service in the backlog. Follow ADR-0024's accepted fixture list instead (per-deal keys with `Delegation`, `ReadToken.audience`, two-key disclosure).
- [ ] The prepare recipe is published in `docs/api.md` and implemented in the SDK and `examples/`; a test shows an agent building the same typed data with no operator call, and `examples/verify.test.ts` still refuses an operator-edited prepare.
- [ ] Disclosure levels enforced, not just recorded: a fixture per level shows what a third party sees; a co-signed `Publish` raises the level and the scan result changes accordingly.
- [ ] `pnpm verify` green. PRs opened per sub-task.

## Out of scope

- The Prividium per-escrow fragment exploration (its own spike task, after T-206's Sepolia deployment; backlog).
- Confidential tokens, shielded pools or a privacy chain beyond the ADR's analysis; pseudonymous identity mode and drand tlock envelopes unless the ADR pulls them in (they stay backlog rows otherwise).
- Contract changes (T-202 owners); deploying to the public demo (Rafa's gate).

## Evidence

Stage 2a (off-chain), merged with main at 1044b00.

- **Measured:** `pnpm verify` on `t-207-private-deals-2a` passes every step: typecheck, lint, test (2166/2166), spec (32/32 examples, `spec/openapi.json` fresh with 40 operations), snap (32/32) and demo. Report: `reports/verify-t-207-private-deals-2a.md`.
- **Measured, `examples/private.test.ts`, 8/8 over HTTP against a sim with two operators.**
  - **Happy path:** per-deal keys certified by `Delegation`, the recipe, sealed offer, buyer opens via ReadTokens from both operators, agree and fund, deliver, early accept → `Released`.
  - **What an outsider can read**, without a token, at either operator:
    - none of the three canaries (deliverable body, acceptance body, delivered work) appears in any response from `/v1/commitments/{id}`, `/terms`, `/events`, `/receipts`, `/recipients`, `/judgment`, `/key?recipient=`, `/v1/commitments?party=`, `/v1/commitments`, `/v1/status`, `/.well-known/holdback.json` or the `/v1/events` stream;
    - `/terms` answers the projection with exactly the keys `adjudication, buyer, commitmentId, disclosure, hashes, price, seller, settlement, timing`, with no `privateTerms`;
    - `/judgment` answers 401.
  - **What a party can read:** with its own audience-bound ReadToken, the sealed terms: two envelopes per part (buyer, primary), still no plaintext, which it opens locally.
  - **Refusals:** a non-party's valid token → 401 `unauthorized`. `error.read-token-audience`: a buyer token for op 1 → 200 at op 1 and 401 at op 2.
  - **`attack.operator-reads-private-deal`:** no canary anywhere in the operators' in-memory state (index, idempotency store, receipts) or the SimChain state and event log. A sealed offer with a signature over other terms → `invalid_signature`.
  - **`pseudonymous.certificate-checked-before-agree`:** a self-signed certificate (no mandate), one for another deal key, and one below the price are refused.
  - **`publish.judgment-discloses-acceptance-only`:**
    - a deliverable key at judgment is refused, and so is a wrong key;
    - with the acceptance key the projection shows `disclosed.acceptance`, the level `judgment` and only the acceptance canary;
    - a Publish not co-signed is refused;
    - a co-signed Publish to public plus the deliverable key shows both bodies.
  - **Recipe:** deterministic, and its commitment ID and digest equal the hash-only `POST /v1/prepare/offer` answer, whose body contains no deliverable.
- **Measured:** `tests/contract/openapi.contract.test.ts` exercises `discloseCommitment` (200), a projection read and a 401 over HTTP, and every response validates against `spec/openapi.json`. Statuses seen now include 401.
- **Measured:** `pnpm snap`: 32 passed, 0 failed, with no snapshot updates. The `SIM_RULEBOOK` hash change moves nothing: the scenarios run on the testkit stub settlement, and the demo step passes.
- **Measured:** the site build with `--op1 https://api.escrow.stream --op2 https://api2.escrow.stream --out reports/site-out` wrote both files, and `node site/check.mjs` passes. Not deployed.
- **Inferred:** the operator's request log records method, path, status and timing only (`LogEntry` in server.ts), so it cannot carry a canary. The test scans in-memory state, not a log sink.
- **Measured:** `pnpm vitest run tests/spec.test.ts`: 182/182 pass, including the new v0.8 block (private commitment, ReadToken, Delegation, KeyRegistration, disclosure and projection examples; two-part form per level; projection refuses clubId, buyer key, privateTerms and bodies).
- **Measured:** `pnpm vitest run packages/core`: all pass (822), including `private.test.ts` (12). It shows the same commitment ID and signature for the plaintext and sealed forms; no canary in the sealed form; the buyer and primary open it and an outsider cannot; the acceptance key does not open the deliverable; AAD stops swapped parts and other IDs; a wrong hash is refused; the projection carries no body, club, buyer key or ciphertext; the ReadToken audience is bound (another audience fails verification); Delegation and KeyRegistration verify.
- **Measured:** `pnpm vitest run apps/operator/src/read-auth.test.ts`: 6/6. Anonymous without a header. Buyer, seller and primary admitted; an outsider refused; fallback refused until FallbackJudging. `error.read-token-audience`: a token for op A is refused at op B. `error.read-token-expired`, a token for another commitment, a forged signature and a malformed header are all refused.
- **Not covered here:** judgment-record privacy. The canaries never reached an adjudicator's reasons because no adjudicator judged a private deal (early accept); records stay plaintext at the adjudicator until the adjudicator slice. The operator only gates `/judgment` behind a token.
- **Not covered here:** operator logs (the acceptance criterion on `attack.operator-reads-private-deal`). `examples/private.test.ts` scans the operators' in-memory state and the SimChain log only; its `logs` array was always empty, and PR 113 dropped it.

## Decisions

- Two wire forms with one ID: at public the bodies are in the clear; at private and judgment only `privateTerms {deliverable, acceptance: {hash, ciphertext, envelopes}}` is admitted (schema if/then/else). `parseAnyCommitment` takes either form; `parseCommitment` stays plaintext-only for callers that read the bodies. EIP-712 domain and `schemaVersion` stay 0.6 (measured: the same digest for both forms).
- Body encryption: AES-256-GCM over the RFC 8785 JSON, AAD = commitment ID bytes ‖ part name; the hash check requires canonical bytes.
- SimChain: a party with no mandate is admitted only at private or judgment, and only under a rulebook listing `pseudonymous`. Its scope is then this commitment's price, and membership is attested by the certificate (ADR-0024 §7). `SIM_RULEBOOK` now has `disclosureMin: private` and `identityModes: [long-term, pseudonymous]`, which changes its hash. `offer()` enforces `disclosureMin` and the body form per level.
- An unauthenticated read gets the projection (200); a token that fails gets 401; a private deal's judgment record gets 401 without a token. SSE always projects offered events of sealed deals. Projected events keep the full event's hash, so an outsider cannot recompute it (residual).
- Publication is checked per operator: the operator verifies the co-signed Publish itself, because SimChain does not record Publish yet. `recordKeys` is reserved and refused.
- New schemas `disclosure.schema.json` and `projection.schema.json`. `EncryptedKey.keyId` was deferred: adding it to the signed struct would move the domain.
- **Files outside the listed paths:** `tests/spec.test.ts` (v0.8 assertions), `tests/contract/openapi.contract.test.ts` (it must exercise every documented operation, now including `discloseCommitment` and a 401), `packages/settlement/sim` (the per-deal key admission, in scope under "on SimChain" in the brief), and `site/llms.txt` (in the brief).
- **Hash-only prepare** (`hashOnly: true`) requires the agent's `nonce` and `createdAt`, because the bodies are already encrypted under the commitment ID. It returns the body without `privateTerms`, for the agent to add. Plaintext prepare still signs `public`: an operator that sees the bodies offers no privacy, so `private` is the default of the recipe and the SDK path, not of the plaintext convenience.
- **`site/llms.txt`** describes the live public demo, which still runs schema 0.7. It says private deals are built and arrive with the next demo update, rather than describing routes the live nodes do not serve.
- **`examples/sign.ts`** is unchanged. It signs operator-prepared messages; a private offer uses the recipe in `examples/agent.ts` (`offerPrivate`), and the later messages (agree, deliver, early accept) go through `sign.ts` as before.

## Handoff

Stage 2a is merged (PR 67). Next slices, each a backlog row under Privacy in `docs/backlog.md`:
- **Adjudicator lane (`apps/adjudicator`):** open `privateTerms` with the primary's key and verify the hashes before `AdjudicatorAcceptance`; judge from the opened bodies; seal judgment records to both parties. Today the sim primary accepts sealed offers without reading them, and would fail at decision time.
- **Settlement:** record `Publish` on SimChain and the contract (T-202).
- **On-chain:** the settlement view in calldata, events, and the ERC-6538 registry (T-202/T-205).
- **Read tokens:** list reads with a zero commitmentId.
- **Envelopes and keys:** fallback/appeal envelopes time-locked to beacon rounds; `KeyRegistration` served by operators; `EncryptedKey.keyId`.
- **Deploy:** the public demo redeploy (Rafa's gate).
