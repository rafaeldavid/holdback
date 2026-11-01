# T-207: Private deals and the end-to-end encrypted API

- **Lane:** core + api (stage 1 is an ADR in the research lane; stage 2 touches several lanes and should be split into sub-tasks once the ADR is adopted)
- **Phase:** 2
- **Depends on:** stage 1 (ADR) on nothing; it can start now. Stage 2's off-chain parts (read authentication, private records, ciphertext terms, mailbox) depend on stage 1 only. Stage 2's on-chain parts (what the contract emits, amount privacy) depend on T-202 and T-205. The Prividium fragment spike needs a Sepolia deployment (T-206) and is a separate task.
- **Paths this task may touch:** stage 1: `docs/decisions/ADR-0024-private-deals.md` (new, Proposed), `docs/decisions-today.md` (a new D entry), `docs/research/` (the research pass). Stage 2: `spec/schemas/`, `spec/examples/`, `spec/openapi/`, `spec/README.md`, `packages/core/`, `packages/sdk/`, `apps/operator/`, `examples/`, `fixtures/scenarios/` (new `attack.` and `neutrality.` privacy fixtures), `docs/api.md`, `docs/neutrality.md` (residual 9), `docs/backlog.md` (Privacy rows closed or moved). Not `contracts/` or `packages/settlement/evm/`: on-chain changes go to T-202 and T-205 owners through Handoff.
- **Human gate:** none for the repository work. Updating the live public demo (Cloudflare) or the site is a deploy and waits for Rafa. Local chain and Sepolia only; no mainnet.
- **Status:** todo
- **Agent/session:** —

## Intent

Make "private escrow" true end to end (Rafa, 2026-11-01). Today only the work is private; terms, amounts, addresses, judgment records and events are public reads at every operator. After this task a third party reading any operator learns nothing beyond the deal's disclosure level, and, as far as possible, the operator relaying a deal cannot read it either: agents encrypt the terms body to the parties and named adjudicators, operators store and relay ciphertext and see only what settlement must check (signatures, hashes, money and deadline fields). Prepare becomes a published, deterministic client-side recipe. An encrypted agent-to-agent mailbox, relayed by any operator, replaces off-protocol negotiation mail.

Restate this in your own words in this section before writing code.

## Context

- ADR-0020 (public skeleton, private body, record key, disclosure levels `private` / `judgment` / `public`, `ReadToken {viewer, commitmentId, expiresAt, nonce}`, pseudonymous identity mode, amounts public on EVM in Phase 2); ADR-0012 (content key envelopes); ADR-0018 (beacon; tlock shares its trust); ADR-0017 and D13 (agent-ready API, residual 9); D16.
- ADR-0023 ("Versions": the EIP-712 domain version and `commitment.schemaVersion` move only when an existing struct or the terms encoding changes; moving `privateTerms` into use may change the terms encoding, so check).
- `docs/plan.md` T-207 entry (the open questions below); `docs/backlog.md` Privacy rows and "Exploration: a single-use Prividium fragment per escrow"; D4 (both the 2026-10-31 evaluation, which did not adopt Prividium, and Rafa's 2026-11-01 note to evaluate a per-escrow fragment).
- `spec/README.md` (`unauthorized` reserved for Phase 2 reads); `docs/backlog.md` operator row "`/v1/events` streams every event unfiltered".

## Stage 1: ADR (research pass first, per the decision process)

ADR-0024 (Proposed) answers, with options and the three litmus tests: what an operator must still see to relay and rate-limit; metadata leakage (who deals with whom, when, how much) and what is accepted as residual; key discovery and rotation for parties and adjudicators; how adjudicators get the plaintext they judge; the client-side prepare recipe and how an agent verifies it; the mailbox (addressing, spam gating by funding or club voucher, retention); amount privacy on Ethereum mainnet (public in Phase 2 per ADR-0020 §8, or confidential tokens as a rulebook option); and the schema version bump (v0.8) with the domain-version consequence. Recorded as a D entry in `docs/decisions-today.md` where Rafa can overrule.

## Acceptance criteria

- [ ] ADR-0024 drafted with status Proposed, and its D entry recorded, before any stage 2 code.
- [ ] Schema v0.8: `ReadToken`, problem `unauthorized` (401), encrypted terms body, mailbox messages, the `private` and `judgment` disclosure levels admitted; `pnpm validate:spec` green; changelog entry; the domain version moved only if the ADR says the terms encoding changed.
- [ ] Reads are authenticated: a body, judgment record or private event is served only with a valid `ReadToken` from a party or an involved adjudicator; others get 401 `unauthorized`, and unauthenticated reads return the public skeleton only (residual 9 closed or narrowed in `docs/neutrality.md`).
- [ ] Fixture `attack.third-party-reads-private-deal`: canary strings planted in the terms body, the work and the judgment reasons never appear in any unauthenticated response, in `/v1/events`, or in any receipt, at any operator (measured by a scan over every read route, as `world.test.ts` scans for keys).
- [ ] Fixture `attack.operator-reads-private-deal`: the same canaries never appear in the operator's stored state or logs; the operator holds only ciphertext and hashes, and settlement still verifies every signature.
- [ ] Fixture `neutrality.operator-refuses-mailbox`: one operator refuses to relay negotiation messages; another relays them, and the deal still agrees, funds and settles.
- [ ] The prepare recipe is published in `docs/api.md` and implemented in the SDK and `examples/`; a test shows an agent building the same typed data with no operator call, and `examples/verify.test.ts` still refuses an operator-edited prepare.
- [ ] Disclosure levels enforced, not just recorded: a fixture per level shows what a third party sees; a co-signed `Publish` raises the level and the scan result changes accordingly.
- [ ] `pnpm verify` green. PRs opened per sub-task.

## Out of scope

- The Prividium per-escrow fragment exploration (its own spike task, after T-206's Sepolia deployment; backlog).
- Confidential tokens, shielded pools or a privacy chain beyond the ADR's analysis; pseudonymous identity mode and drand tlock envelopes unless the ADR pulls them in (they stay backlog rows otherwise).
- Contract changes (T-202 owners); deploying to the public demo (Rafa's gate).

## Evidence

## Decisions

## Handoff
