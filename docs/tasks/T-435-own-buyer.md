# T-435: Crow's buying agent pays through the signer

- **Lane:** demo (Crow's own agents, roadmap row N131, build row 4)
- **Phase:** 2
- **Depends on:** T-434 (the signer), T-433 (the mandate tool)
- **Paths this task may touch:** `examples/own-buyer.ts`, `examples/own-buyer.test.ts`, one section in `site/ref/buyer-signer.txt`, this file
- **Human gate:** no (nothing deployed; the site deploy after merge follows the wave's rule)
- **Status:** in progress
- **Agent/session:** own-agents build session, started by the coordinator on 2026-11-14

## Intent

The buying agent needs a way to buy that never touches a payment key: it sends each funding message to Crow's signer and funds with the signature that comes back. It also must not fill the float from the faucet, because a float the faucet refills bounds nothing (design, review finding H1).

The design names `examples/buy-with-signer.ts` and `examples/buyer-signer.ts` as this row's paths. Both are inside the pilot's pinned bundle (`site/buy.mjs`, by SHA-256), so changing a byte of them changes the bundle. This task therefore adds a new command, `examples/own-buyer.ts`, that runs the buyer's tools as they are through their exported functions: the pinned bundle stays byte for byte the same, and the signer path runs only when this command runs.

Non-goals: any change to the buyer's tools or their bundle; a purchase a person signs; the selling agent.

## Acceptance criteria

- [ ] `node examples/own-buyer.ts <quote URL> <key store> <scope> <the most you pay> --signer <URL>` reads the float's address from the signer, quotes with it as the payment address, checks the offer with the buyer's tools, sends the funding file to the signer, funds with its signature and follows the deal to its outcome.
- [ ] The float gets nothing from the faucet: the agent asks it for the deal key's mandate only, with the least grant, 1 base unit, to the deal key.
- [ ] A refusal by the signer, a stopped signer, or an operator that charges a fee pays nothing and exits 3, naming the reason.
- [ ] A10: a deal funded from a fresh key with faucet money funds; the test records that it is not paid from Crow's float and that the signer's ledger does not hold it.
- [ ] The SHA-256 of `site/buy.mjs` and `site/try.mjs` is unchanged.

## The constraints this task touches

| Constraint | Rung | What enforces it | The attack test |
| --- | --- | --- | --- |
| The agent pays only through the signer | 1 | The agent's process holds no float key; the command asks the signer | `own-buyer.test.ts`: the agent as its own process buys one deal; the float pays exactly the total |
| The float takes no faucet money | 4, the agent's own command | The command asks the faucet for 1 base unit to the deal key only. An agent that is taken over can still ask the faucet to fill the float; on this network that bounds nothing (X3), and the signer's limits do not move (A9, T-434) | `own-buyer.test.ts`: the float's balance falls by the total and rises by nothing |
| A deal outside Crow's addresses is not Crow's | 5, recorded, not prevented | Nothing: on this network any key can take faucet money and deal (gaps N1) | A10, `own-buyer.test.ts` |
| The agent's own checks: the most it pays, `--expect-terms` | 4 | The command | none: soft, a first line before the signer |

## Out of scope

- A new page under `site/ref/`: that needs `site/build.mjs`, which another lane owns. One section in `site/ref/buyer-signer.txt` says how the setup works.

## Evidence

## Decisions

## Handoff

**Owed before the proof run:** a review by a model of another family of the unattended payment path (design, "The build, in order"). It needs a key of Rafa's.
