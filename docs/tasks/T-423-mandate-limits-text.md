# T-423: Where an agent's limits hold, in plain text, and three doc fixes

- **Lane:** docs (kind: docs, plus one operator message text)
- **Phase:** 2
- **Depends on:** T-415 (ADR-0038, D69)
- **Paths this task may touch:** `docs/neutrality.md`, `docs/architecture.md`, `docs/operations.md`, `docs/api.md`, `site/ref/limits.txt`, the `next` text of `scope_exceeded` (it lives in `apps/operator/src/problems.ts`; `packages/core/src/problem.ts`, which the brief names, holds only the type names), this task file. `CLAUDE.md` in a separate draft pull request only.
- **Human gate:** the site deploy runs under Rafa's standing word for this wave ("merge and deploy when ready"). The `CLAUDE.md` line waits for Rafa's word.
- **Status:** in progress
- **Agent/session:** T-423 session of the second wave, 2026-11-14

## Intent

ADR-0038 decides where each limit a company sets on its agent holds. Its build step 1 is text only, and it is the one step before the pilot. This task writes that text: the same statements, in the same words, in each standing doc and reference page this task owns. They say which limits Crow enforces today and where (an operator, the contracts, the counterparty's own check), which it leaves to the company's wallet and tooling, and what a company does today to stop its agent. It writes nothing that answers one of the ADR's seven open questions for Rafa, and it changes no behaviour.

Three doc fixes from other lanes ride along: `docs/operations.md` names the early-access deploy script; `docs/api.md` describes the site's `version.json` as it is served; `CLAUDE.md`'s Map lists `docs/privacy-baseline.md` (a draft pull request, tier 3).

Non-goals: any code path, schema, contract or fixture change; the files of other lanes that step 1 also names (below, Handoff).

## Context

- `docs/decisions/ADR-0038-mandate-limits-and-revocation.md`: "What enforces each field today", section 1 (the company table), section 2 (`categories`), section 3 (the daily cap), section 4 ("Deals already agreed or funded"), "The build, in order" (step 1 and its list of standing texts), "Not decided here".
- Code read for each statement: `packages/core/src/state.ts` (`scopeAllows`, the agreement's daily cap), `packages/settlement/evm/evm-settlement.ts` (`scopeFor`, the daily count in `agree`, the wide scope for a deal funded on chain), `apps/operator/src/server.ts` (the agent read), `contracts/src/` (no mandate, scope or revocation).

## The statements (the same words in every file)

1. The contracts read no mandate.
2. Each operator checks a mandate as its own relay policy: the role, `maxPerCommitment` and `expiresAt` at the offer, the agreement and the funding, and `maxDaily` at the agreement.
3. The daily cap is counted per operator, per buyer signing address and UTC day.
4. Nothing checks `categories`: it is signed and not enforced.
5. A counterparty can check the mandate before it signs; the reference clients do not run that check in their flows yet.
6. The spending limit is the payment address: its balance, who signs for it, and the principal's own wallet policy.
7. To stop an agent today: move the balance off the payment address, or stop signing for it. A principal cannot revoke a mandate yet (`POST /v1/agents/{address}/revoke` answers 501). A funded hold is not touched.

## Acceptance criteria

- [ ] `site/ref/limits.txt` carries the ADR's company table and statements 1 to 7, in ASCII, and states that on the test service the faucet signs the mandate.
- [ ] `docs/neutrality.md`: the definition of a valid commitment and residual 12 no longer say or imply that settlement checks the scope or that the scope caps bound a loss on a chain.
- [ ] `docs/architecture.md`: the Offer and Agree guards, and the mandate line under "Identity and signing", say where the scope is checked.
- [ ] `docs/api.md`: the agent read says what it serves, and the mandate statements are stated once.
- [ ] The `scope_exceeded` problem names no `categories` and gives the way out.
- [ ] `docs/operations.md` names `node apps/early-access/deploy.mjs`.
- [ ] `docs/api.md` describes `version.json` as `https://crow.direct/version.json` serves it.
- [ ] A draft pull request adds `docs/privacy-baseline.md` to `CLAUDE.md`'s Map.
- [ ] Nothing presumes an answer to the ADR's seven questions; no wallet product is named.
- [ ] `node site/build.mjs && node site/check.mjs`, `pnpm typecheck && pnpm test` pass.

## Out of scope

- `docs/judgment-and-defenses.md` (T13), `docs/audit/known-issues.md` (R-12) and D22 in `docs/decisions-today.md`: ADR-0038 step 1 names them, and other lanes own them. The text for each is in the Handoff.
- The hard rule in `CLAUDE.md` on scope (ADR-0038, question 2: Rafa's).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
