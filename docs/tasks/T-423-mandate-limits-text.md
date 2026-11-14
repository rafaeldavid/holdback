# T-423: Where an agent's limits hold, in plain text, and three doc fixes

- **Lane:** docs (kind: docs, plus one operator message text)
- **Phase:** 2
- **Depends on:** T-415 (ADR-0038, D69)
- **Paths this task may touch:** `docs/neutrality.md`, and on the coordinator's word for T-410's lines: one decision line in `docs/decisions-today.md` and the Status field of `docs/tasks/T-410-routine-redeploy.md`;, `docs/architecture.md`, `docs/operations.md`, `docs/api.md`, `site/ref/limits.txt`, the `next` text of `scope_exceeded` (it lives in `apps/operator/src/problems.ts`; `packages/core/src/problem.ts`, which the brief names, holds only the type names), this task file. `CLAUDE.md` in a separate draft pull request only.
- **Human gate:** the site deploy runs under Rafa's standing word for this wave ("merge and deploy when ready"). The `CLAUDE.md` line waits for Rafa's word.
- **Status:** done (pull request 520 merged 2026-11-14 11:30 UTC as `0746a888`)
- **Agent/session:** T-423 session of the second wave, 2026-11-14
- **Roadmap row:** N117

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

- [x] `site/ref/limits.txt` carries the ADR's company table and statements 1 to 7, in ASCII, and states that on the test service the faucet signs the mandate.
- [x] `docs/neutrality.md`: the definition of a valid commitment and residual 12 no longer say or imply that settlement checks the scope or that the scope caps bound a loss on a chain.
- [x] `docs/architecture.md`: the Offer and Agree guards, and the mandate line under "Identity and signing", say where the scope is checked.
- [x] `docs/api.md`: the agent read says what it serves, and the mandate statements are stated once.
- [x] The `scope_exceeded` problem names no `categories` and gives the way out.
- [x] `docs/operations.md` names `node apps/early-access/deploy.mjs`.
- [x] `docs/api.md` describes `version.json` as `https://crow.direct/version.json` serves it.
- [x] A draft pull request adds `docs/privacy-baseline.md` to `CLAUDE.md`'s Map.
- [x] Nothing presumes an answer to the ADR's seven questions; no wallet product is named.
- [x] `node site/build.mjs && node site/check.mjs`, `pnpm typecheck && pnpm test` pass.

## Out of scope

- `docs/judgment-and-defenses.md` (T13), `docs/audit/known-issues.md` (R-12) and D22 in `docs/decisions-today.md`: ADR-0038 step 1 names them, and other lanes own them. The text for each is in the Handoff.
- The hard rule in `CLAUDE.md` on scope (ADR-0038, question 2: Rafa's).

## Evidence

- **Checks (measured, 2026-11-14).** `node site/build.mjs && node site/check.mjs`: PASS, the buyer's first-deal path 5,000 of 5,000 tokens and the seller's 4,232 (estimates; this task changes neither path). `pnpm typecheck && pnpm test`: exit 0, 199 test files passed and 14 skipped, 3,927 tests passed and 217 skipped. `site/ref/limits.txt` is ASCII only (`site/check.mjs` rule 14, and the reviewer's grep). No snapshot changed: the old `scope_exceeded` text appeared only in `apps/operator/src/problems.ts`.
- **Where each statement now stands (measured by reading the diff).**

  | Statement | `site/ref/limits.txt` | `docs/api.md` | `docs/architecture.md` | `docs/neutrality.md` | `scope_exceeded` |
  | --- | --- | --- | --- | --- | --- |
  | 1. The contracts read no mandate | yes | yes | yes | yes (valid commitment, residual 12) | yes |
  | 2. Each operator checks it as its relay policy | yes | yes | yes (guards, the note below the table, Identity) | yes | yes |
  | 3. The daily cap is per operator | yes | yes | yes | no | names `maxDaily` for the UTC day |
  | 4. Nothing checks `categories` | yes | yes | yes | no | names no `categories` |
  | 5. The counterparty checks for itself | yes | yes | yes | yes | no |
  | 6. The spending limit is the payment address | yes, with the ADR's table | yes | yes | yes (residual 12) | no |
  | 7. What a company does today to stop an agent | yes | yes | yes | yes (residual 12) | no |

- **Code behind each statement (measured by the reviewer, who read each file).** `contracts/src/HoldbackRules.sol` (three signatures and the payment authorization; no mandate, scope, revocation or delegation under `contracts/src`); `packages/core/src/state.ts` (`scopeAllows` at the offer, the agreement and the funding; `maxDaily` at the agreement); `packages/settlement/evm/evm-settlement.ts` (`scopeFor`, the count by buyer address and UTC day, the wide scope and zero spend for a deal funded on chain); `packages/settlement/sim/simchain.ts` (SimChain checks at settlement); `examples/agent.ts` (the counterparty check, called only from `examples/private.test.ts`); `apps/demo-cloud/src/world.ts` (the faucet's 30-day mandate from the demo principal; one settlement for both nodes); `apps/operator/src/server.ts` (the agent read; 501 for `POST /v1/agents` and the revoke route).
- **`version.json` (measured, GET at 2026-11-14 about 11:50 UTC).** `https://crow.direct/version.json` served `{schema: "crow.build/1", worker: "crow-site", commit, deployedAt, versionId}`; `join.crow.direct` and the test seller serve the same shape.
- **The early-access script (measured).** `apps/early-access/deploy.mjs` exists on `origin/main` and names itself `node apps/early-access/deploy.mjs`.
- **Review.** One pass by the `reviewer` agent: ISSUES, no blocking finding, 2 Medium, 2 Low-medium and 8 Low or info. Every fact it checked held on a chain. Fixed: the task file (this section); "Revocation, once built" presumed open question 1 (now "If revocation is built"); the problem text and two daily-count sentences were false on SimChain (now "On a chain"); `docs/api.md`'s per-deal key sentence said "Settlement" (now "An operator"); the agent read now says it differs from `agent.schema.json`; "SimChain still" and "yet" leaned on questions 1 and 3 (now "today"); the multisig line now says "usually", as ADR-0038 fact 10 does; the Fund row names its scope guard; the limits page's intro names the new section; "the two names here" names both hostnames; whose mandate is checked at each step. Not done: the reviewer's recommended second review by a model of another family (below).
- **T-410's lines (coordinator, 2026-11-14).** `docs/operations.md`'s "Source verification" bullet now says Sourcify's API v2 only (`scripts/sourcify-verify.mjs`, measured in `contracts/script/deploy-sepolia.sh` lines 14-19 and `docs/redeploy-contracts.md` step 3); the "How" bullet names `DEPLOY_CROSSCHECK_RPC`, which the script requires on Sepolia (its line 249). D71 records the decision. T-410's Status reads done.
- **The `CLAUDE.md` line:** draft pull request 517, not merged.

## Decisions

- **The problem text's file.** The brief names `packages/core/src/problem.ts`; that file holds only the type names, and the text lives in `apps/operator/src/problems.ts`, which no lane of this wave owns. This task changed that one string only.
- **The same words.** `site/ref/limits.txt` and `docs/api.md` carry the statements in nearly the same sentences; `docs/architecture.md` and `docs/neutrality.md` state them in the form their sections need.
- **No wallet product named** (ADR-0038, question 6), no sentence on who bears a loss (question 7), and `maxDaily` described as it works today (question 4).

## Handoff

**Done:** ADR-0038 step 1 in the five files this task owns, the `scope_exceeded` text, the three doc fixes, and T-410's three lines.

**For the lanes that own the other places step 1 names** (text ready to paste; each corrects the claim that the scope caps bound a loss):

- `docs/judgment-and-defenses.md`, T13, the mitigation cell: "The payment address's balance and the principal's own wallet bound the loss: money leaves only on the payment address's signatures for one deal. On a chain the scope caps per commitment and per day and the mandate's expiry bind only through the operators that relay a deal and a counterparty that checks; the contracts read no mandate (ADR-0038). A principal cannot revoke a mandate today. On a live commitment the loss is bounded by the holds already funded, and there is no recourse (residual 12, D22)".
- `docs/audit/known-issues.md`, R-12, the last cell: "The payment address's balance and the principal's wallet; the scope caps bind only through the operators and a counterparty that checks (ADR-0038)".
- `docs/decisions-today.md`, D22, a dated line after its decision: "**2026-11-14, ADR-0038 (D69):** on a chain the caps bind only through the operators that relay a deal and a counterparty that checks; the bound that holds is the holds already funded plus the payment address's balance."
- `site/llms.txt` line 74 describes `ref/limits.txt` as "honest limits, reporting a problem, the sources". It could add "where your agent's limits hold", but the buyer's first-deal path is at 5,000 of 5,000 tokens (measured), so that waits for the lane that owns the guides' budget.

**For Rafa:** the hard rule in `CLAUDE.md` ("checked against the agent's address and scope", and the adjudicator as a checker of the `Delegation`) is ADR-0038's question 2; this task changes neither. The reviewer recommends a short review by a model of another family of the new definition of a valid commitment in `docs/neutrality.md` (on a chain a deal funded outside an agent's scope is valid) and of residual 12's bound; it was not run, since this wave's brief asks for one reviewer pass.

**Site deploy (measured, 2026-11-14 11:31 UTC).** `pnpm site:deploy` from a detached worktree at `0746a888`: pass. crow-site `0818c983-3757-46f0-a41e-6e980228a4c8`, rollback target `b5375383-de79-49f8-86df-96782f526e10` (the previous live version, commit `cb214d44`, deployed 10:45 UTC). It carried only this task's two changes; `site/try.mjs` and `site/buy.mjs` are unchanged, so no handed-out command stops working. Live checks by GET: `version.json` names `0746a888`; `/ref/limits.txt` serves "Where your agent's limits hold" and its table; `/problems/scope_exceeded` serves the new text and names no `categories`; `/` answers 200.

**Deploy:** the site carries `site/ref/limits.txt` and the problem page at `crow.direct/problems/scope_exceeded`. The operators carry the problem text with T-422's deploy or the next one.
