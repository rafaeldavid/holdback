# T-435: Crow's buying agent pays through the signer

- **Lane:** demo (Crow's own agents, roadmap row N131, build row 4)
- **Phase:** 2
- **Depends on:** T-434 (the signer), T-433 (the mandate tool)
- **Paths this task may touch:** `examples/own-buyer.ts`, `examples/own-buyer.test.ts`, `examples/own-buyer-attacks.test.ts`, one section in `site/ref/buyer-signer.txt`, this file
- **Human gate:** no (nothing deployed; the site deploy after merge follows the wave's rule)
- **Status:** review
- **Agent/session:** own-agents build session, started by the coordinator on 2026-11-14

## Intent

The buying agent needs a way to buy that never touches a payment key: it sends each funding message to Crow's signer and funds with the signature that comes back. It also must not fill the float from the faucet, because a float the faucet refills bounds nothing (design, review finding H1).

The design names `examples/buy-with-signer.ts` and `examples/buyer-signer.ts` as this row's paths. Both are inside the pilot's pinned bundle (`site/buy.mjs`, by SHA-256), so changing a byte of them changes the bundle. This task therefore adds a new command, `examples/own-buyer.ts`, that runs the buyer's tools as they are through their exported functions: the pinned bundle stays byte for byte the same, and the signer path runs only when this command runs.

Non-goals: any change to the buyer's tools or their bundle; a purchase a person signs; the selling agent.

## Acceptance criteria

- [x] `node examples/own-buyer.ts <quote URL> <key store> <scope> <the most you pay> --signer <URL>` reads the float's address from the signer, quotes with it as the payment address, checks the offer with the buyer's tools, sends the funding file to the signer, funds with its signature and follows the deal to its outcome.
- [x] The float gets nothing from the faucet: the agent asks it for the deal key's mandate only, with the least grant, 1 base unit, to the deal key.
- [x] A refusal by the signer, a stopped signer, or an operator that charges a fee pays nothing and exits 3, naming the reason.
- [x] A10: a deal funded from a fresh key with faucet money funds; the test records that it is not paid from Crow's float and that the signer's ledger does not hold it.
- [x] The SHA-256 of `site/buy.mjs` and `site/try.mjs` is unchanged.

## The constraints this task touches

| Constraint | Rung | What enforces it | The attack test |
| --- | --- | --- | --- |
| The agent pays only through the signer | 1, once the signer runs on its own machine (build row 7); a rehearsal on one machine until then | The command reads no float key and its process gets only `PATH` and `HOLDBACK_OPERATORS`; it asks the signer | A1 (`signer-attacks.test.ts`, `signer-anvil.test.ts`, T-434); control: `own-buyer.test.ts`, the agent as its own process buys one deal and the float pays exactly the total |
| What the agent sends is what its tool wrote, and what comes back is for that deal | 4 | The command checks the terms' ID and the file's digest before sending, and the signer's answer's ID and digest before funding; the buyer's tool recovers the signature over its own message before submitting | `own-buyer-attacks.test.ts` RT-4, RT-5 |
| The float takes no faucet money | 4, the agent's own command | The command asks the faucet for 1 base unit to the deal key only. An agent that is taken over can still ask the faucet to fill the float; on this network that bounds nothing (X3), and the signer's limits do not move (A9, T-434) | `own-buyer.test.ts`: the float's balance falls by the total and rises by nothing |
| A deal outside Crow's addresses is not Crow's | 5, recorded, not prevented | Nothing: on this network any key can take faucet money and deal (gaps N1) | A10, `own-buyer.test.ts` |
| The agent's own checks: the most it pays, `--expect-terms` | 4 | The command | none: soft, a first line before the signer |

## Out of scope

- A new page under `site/ref/`: that needs `site/build.mjs`, which another lane owns. One section in `site/ref/buyer-signer.txt` says how the setup works.

## Evidence

All measured on 2026-11-14 in `.worktrees/holdback-own-agents-buyer`, branch `t-435-own-buyer`, unless labelled.

- `npx vitest run examples/own-buyer.test.ts examples/own-buyer-attacks.test.ts`: 10 passed, against the public demo world on SimChain with the signer as its own process:
  - the agent, as its own process, buys one deal: the float pays 10.00 tUSDC and nothing more, gets nothing from the faucet, and 9.00 reaches the listed payout address;
  - a B3 refusal and a stopped signer exit 3 with nothing paid;
  - A10: a fresh key with faucet money funds a deal; the terms name that key as the payment address, the float's balance is unchanged, and the signer's ledger and day count do not hold it;
  - the red team's seven: a signer that is down or goes away (exit 3, naming it), operators that charge a fee (exit 3, the signer never asked), a signer answer for another deal, files swapped in the key store, operators with a trailing slash, a misspelt term in `--expect-terms`.
- `pnpm typecheck`: 0 errors. `npx eslint examples/own-buyer*.ts`: 0 problems. `node site/build.mjs && node site/check.mjs`: PASS. `tests/site-guides.test.ts`: passed.
- The pinned bundle on this branch: `site/buy.mjs` `e74ff2230f0d4fd426525095731e42d50b65b55ab7792a43cab73c302b22eb88`, `site/try.mjs` `04ef4434fb4b5635bb3c49df69c7547f3200c6c41f903237ee37098be23f75c8`, as on `origin/main` `02506766`. The reviewer rebuilt both in memory with `site/build.mjs`'s own functions: the same hashes. `site/buy-entry.mjs` imports `buy-with-signer`, `pay-from-wallet` and `deal-record` only; nothing imports `own-buyer.ts`.

### Reviews (PR on this branch)

The `reviewer` agent and the `red-teamer` agent read `CLAUDE.md`, ADR-0038, `docs/neutrality.md`, the design and the diff. The red team got no payment outside the signer's rules, no faucet money into the float and no leak. Verdicts: ISSUES, no Critical or High finding.

| Finding | Severity | What changed |
| --- | --- | --- |
| The operator-fee case had no test, and it was checked after the faucet | Medium | Refused before the faucet or the signer is asked; RT-3 tests it |
| The reference text said Crow's agent pays this way today, and that the signer signs one message | Medium | "is built to pay this way"; it signs a deal's funding and a delegation beside it; only the agent's machine reaches its port |
| The rung-1 row cited a control as its attack test | Medium | It cites A1 and says it holds once the signer has its own machine |
| A signer that is down exited 1 with "fetch failed" | Medium | Exit 3, naming the signer (RT-1, RT-2) |
| The signer's answer and the key store's files were not tied to the deal | Low | Both checked by ID and digest (RT-4, RT-5) |
| `--expect-terms` dropped a misspelt term | Low | `buy-with-signer.ts`'s checks, repeated (RT-6) |
| The operators were read raw | Low | Trimmed as the buyer's tools trim them (RT-7) |
| A wrong call exited 1; the A10 assertion proved nothing; two text faults; this file empty | Low | Exit 2; A10 checks the day count and the ledger; the state message and the resume line fixed; this section |

## Decisions

- **A new command, not a change to the buyer's tools.** The design names `buy-with-signer.ts` and `buyer-signer.ts`, which sit inside the pinned bundle; a new file that calls their exported functions keeps the bundle byte for byte the same.
- **The deal key takes 1 base unit from the faucet**, the least a grant gives, with its mandate. The float takes nothing.

## Handoff

Done: the command, its tests and the reference section. The site needs a deploy for that section and for T-433's `limits.txt` paragraph.

**Owed before the proof run:** a review by a model of another family of the unattended payment path (design, "The build, in order"). It needs a key of Rafa's.
