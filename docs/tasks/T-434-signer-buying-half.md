# T-434: Crow's signer, the buying half

- **Lane:** demo (Crow's own agents, roadmap row N131, build row 3)
- **Phase:** 2
- **Depends on:** T-433 (the mandate tool: the signer verifies its mandate and revocations with it); the own-agents design and its constraints, version 1, in crow-private (`company-ops/own-agents/design.md`, `constraints.md`; Rafa's decisions 1 to 6 of 2026-11-14)
- **Paths this task may touch:** `examples/signer.ts`, `examples/signer-rules.schema.json`, `examples/signer-rules.v1.json`, `examples/signer*.test.ts`, `examples/signer-test-kit.ts`, `examples/signer-world-kit.ts`, this file
- **Human gate:** no. Nothing is deployed and no real key exists; Rafa makes the keys and the machines (design, "Actions only you can take")
- **Status:** review
- **Agent/session:** own-agents build session, started by the coordinator on 2026-11-14 ("Yes, start both")

## Intent

Crow's buying agent must not be able to move Crow's money past its limits, whatever it does with its own keys and its own machine (Rafa, 2026-11-14: "policy is not hard. We want agents with hard constraints"). So the agent holds no payment key. A separate program, the signer, holds the payment address's key (the float) and the buying agent's standing key, and signs exactly one kind of thing: a deal's funding, and only when every rule passes. It rebuilds the funding from the signed terms and its own pinned deployment, and decides from its own rules file, its own clock, its own ledger and its own reads of each deal, never from anything the agent says about them.

The rules: the most per deal and per UTC day, the open deals and their total, the listed sellers and their payout addresses, the product and checks each seller is listed for, the three reviewers with their policy, registry and fee, every other term, the windows and dates against the signer's clock, the chain and token, a live mandate from the pinned principal that no revocation ends, and the stop flag. It fails closed on every doubt and refuses every other message, the operator-fee message included. It keeps the day's ledger, a decision log and a public status file.

Non-goals: the selling half (build row 5); the machines, the service units and the network rule between them (build row 7); a purchase a person signs (the treasury path); emptying the float to the treasury; any change to the buyer's tools, the operators, the contracts or the schemas.

## Context

- Design, "Where the four constraints that matter stand", "The buying agent, constraint by constraint", section 5 (the stop) and section 7 (the attack tests).
- `constraints.md` section 1 (B1 to B14) and section 3 (X1 to X4), version 1 values.
- ADR-0038 sections 1 and 4: the spending limit is the payment address and the company's own wallet policy; a revocation ends only its own principal's mandate.
- `examples/verify.ts` `checkPaymentFile`: the check the holder of a payment address runs before it signs; the signer runs it as is.

## The constraints this build enforces

The attacker in every test is the buying agent: its own keys (each deal's buyer key, in its key store) and full control of the test process. The signer runs as its own process, with its keys in its own environment only. Every attack test has a control that is signed inside the limits.

| # | Constraint, version 1 value | Rung | What enforces it | The attack test that fails (file) |
| --- | --- | --- | --- | --- |
| B1 | The agent moves 0.00 tUSDC of Crow's money alone | 1 | The float's key is in the signer's environment only; the agent's key store and environment hold none; the token refuses a funding signed by the deal key | A1 (`signer-attacks.test.ts`: the store and the environment scanned, a forged funding refused by the tool and by the settlement layer, 401 `invalid_signature`; `signer-anvil.test.ts`: TestUSDC refuses the deal key's signature) |
| B2 | One signed payment pays one deal, its total, its payout address | 1, and 3 before | The token checks the nonce, which commits to the deal's ID, total and payout address; before that the signer signs only the file `checkPaymentFile` rebuilds from the terms and its pin | A2 (`signer-anvil.test.ts`: TestUSDC refuses another deal's nonce, a higher amount and a second use; `signer-attacks.test.ts`: SimChain refuses it, 401); A4 (`signer.test.ts`) |
| B3 | The most per deal with no person: 10.00 tUSDC | 3 | The signer, from the price plus the pinned fee; also the mandate's own cap | A3 (`signer.test.ts`: 10.000001 refused, 10.00 signed; a mandate cap below the rules') |
| B4 | The most per UTC day: 60.00 tUSDC | 3 | The signer's ledger, on its own disk, written before the signature leaves | A5 (`signer.test.ts`: the seventh deal of 10.00 refused, also after a restart) |
| B5 | Sellers and payout addresses on the list; the float pays | 3 before funding, 2 after | The signer; after funding the contract pays only the signed payout address or returns the money | A6 (`signer.test.ts`: an unlisted seller, another payout address, another payment address) |
| B6 | The terms: the club, the rulebook, the product, the checks with no rubric, the settlement mode, the remedy, public disclosure, one delivery, the appeal fields; public terms only | 3 | The signer compares each with its rules; the acceptance by its hash | A7 (`signer.test.ts`: a check removed, a rubric added, another product, another club, two deliveries) |
| B7 | The three reviewers, their policy and registry, the fee | 3 before funding, 2 after | The signer | A6 (`signer.test.ts`: each address in turn, each hash, the policy, the fee up and down) |
| B8 | Offer open 300 s, fund within 600 s, deliver within 3,600 s, each judging window 3,600 s at most; dates against the signer's clock (60 s ahead at most) | 3 | The signer | A7 (`signer.test.ts`: 301 s, 601 s, a date 120 s ahead, an offer expired by the signer's clock) |
| B9 | Open at once: 3 deals and 30.00 tUSDC | 3 | The signer's ledger. A deal ends only when every read endpoint the rules name says it ended, or it was never funded by its deadline; any read that fails keeps it open | A5 (`signer.test.ts`: a fourth refused; signed payments never funded count; two requests at once count one after the other; an endpoint that does not answer keeps deals open) |
| B10 | What the agent can do to an open hold: release it to the listed payout address | 2 | The contract (SimChain in the test) | A11, first part (`signer-attacks.test.ts`: the agent accepts early; the payout address gets the price, the agent's key nothing) |
| B12 | The chain: Ethereum Sepolia or a local chain; the pinned token | 1 and 3 | Every signed message names its domain; the rules pin the deployment, and the schema allows chain 31337 only for a local one | A4 (`signer.test.ts`: another chain's or rules contract's file, another token); the start refused for chain 1 |
| B13 | A delegation only beside a payment it signs, capped at the price, ending with the offer | 3 | The signer holds the standing key and has no other route that signs one | Control (`signer.test.ts`: the delegation verifies under the mandate); A14 (a request of kind `delegation` refused) |
| B14 | No other transfer from the float; the operator fee is 0 | 3 | The signer signs kind `payment` with a funding file only | A14 (`signer.test.ts`: the fee message naming the agent's own address, every other kind, an EarlyAccept, a revocation file; `signer-attacks.test.ts`: where an operator charges a fee, the float pays nothing) |
| X1 | The stop: nothing new is signed | 3 | The flag file must read exactly `run`; anything else, missing or unreadable, is a stop | A8 (`signer.test.ts`, `signer-attacks.test.ts`); A13 (`signer.test.ts`: missing, unreadable, empty, other text, a folder) |
| X4 | Only the administrator changes the rules | 3 in this build's code; the machine apart is build row 7 | No route writes the flag, the rules or the ledger; a rules file changed on disk refuses until a restart; the start refuses a key that is not the rules' address, an unreadable ledger, or a file that fails the schema | A13 (`signer.test.ts`) |
| Mandate | A live mandate from the pinned principal for the standing key, buyer role, the pinned club; no revocation by that principal in effect | 3 | The signer reads it on every request with `mandate.ts verify --principal`. A revocation that names this mandate and does not verify refuses too | `signer.test.ts`, "the mandate at the signer": expired, revoked, forged, lapsed, unreadable, a self-minted mandate stops the start |

Each attack test was shown to fail without its constraint: the refusal of each rule was turned into a no-op in a copy of `signer.ts` and `signer.test.ts` run again (Evidence).

## Still soft after this build

- **Rung 3 rests on a machine the agent cannot reach.** The tests run both on one machine: a rehearsal, not proof. No login, deploy credential or configuration channel from the agents' machine to the signer exists until build row 7 makes the machines and the network rule; A13's network and login parts wait for it.
- **The open-holds count trusts the read endpoints.** The rules name Crow's two operators. An operator that wrongly reports a deal as ended lets one more deal open; it cannot raise the per-deal or the per-day limit. Against the agent, this holds: the agent cannot reach the signer's reads.
- **The float's size bounds nothing on this network** (X3): anyone can mint tUSDC. The signer never asks the faucet for money and never reads the balance.
- **The decision log's completeness** is Crow's own statement. The outsider's check reads the chain (design, section 6).
- **CI skips `signer-anvil.test.ts`.** CI's anvil job runs its own list of files, which lives in `.github/` (tier 3, Rafa's word). It ran here on anvil (Evidence).
- **Not built here:** a purchase a person signs (B11's treasury path) and A11's second part (a hold a person funded, whose deal key the signer's machine makes); emptying the float to the treasury (the stop's second layer); a test where the paying wallet refuses an over-limit funding on chain (roadmap row N133: the contract wallet).

## Owed before the proof run

A review by a model of another family of the unattended payment path, the operator-fee message, the signatures collected before a stop and the delivery signature (design, "The build, in order"). It needs a key of Rafa's, so this session cannot run it.

## Acceptance criteria

- [x] `examples/signer.ts` serves `POST /v1/sign` and `GET /v1/status` only, with its keys from `CROW_SIGNER_FLOAT_KEY` and `CROW_SIGNER_BUYING_KEY`, and signs a deal's funding only inside its rules.
- [x] The limits come from a rules file validated against `examples/signer-rules.schema.json`; no limit is a constant in code. `examples/signer-rules.v1.json` holds `constraints.md` version 1's values, and the tests read it.
- [x] Every constraint in the table above has an attack test that fails without it, and a control.
- [x] The ledger, the decision log and the status file are written; no key appears in any of them.
- [x] The SHA-256 of `site/buy.mjs` and `site/try.mjs` is unchanged.

## Evidence

All measured on 2026-11-14 in `.worktrees/holdback-own-agents-signer`, branch `t-434-signer-buying`, unless labelled.

- `npx vitest run examples/signer.test.ts`: 22 passed. The signer runs as its own process in each test; a stand-in plays its read endpoint.
- `npx vitest run examples/signer-attacks.test.ts`: 6 passed, against the public demo world on SimChain:
  - the control deal funds from the float (10.00 tUSDC out, measured by balance) and releases 9.00 to the listed payout address;
  - A1 and A2 straight at the operator, past the buyer's tool: `401 invalid_signature`, "FundingAuthorization signature does not recover to" the float;
  - A8: a payment collected before the stop funded after it, inside its offer window (300 s at most);
  - A9: a float filled with 100.00 more still gets B3 at 10.000001;
  - A14: where the operators charge a fee, the float pays nothing.
- `npx vitest run examples/signer-anvil.test.ts`: 1 passed, on anvil 31337 with the phase-one contracts and TestUSDC, in about 30 s. TestUSDC itself takes the signer's authorization for its deal and refuses it for another deal's nonce, for 1 base unit more and for a second use ("authorization is used"); it refuses a funding the deal key signed. The deal then funds from the float and releases 9.00 tUSDC to the listed payout address. `contracts/out` was copied from a build of `origin/main`'s contracts (the build in `.worktrees/holdback-T-425`, 2026-11-14 12:38 local; `contracts/src` last changed 2026-11-12).
- **Each attack test fails without its constraint.** The script `reports/scratch/own-agents/mutate.sh` turned each rule's refusals into a no-op in a copy of `signer.ts` (commit `830cb9e7`), one rule at a time, and ran `signer.test.ts`:

  | Rule disabled | Tests that failed (of 22) |
  | --- | --- |
  | B2 (the payment check) | 2: A4, A14 |
  | B3 | 2: A3, the mandate's cap |
  | B4 | 1: A5, the day |
  | B5 | 1: A6 |
  | B6 | 2: A4, A7 |
  | B7 | 1: A6 |
  | B8 | 1: A7 |
  | B9 | 2: A5, open deals; A5, a read that does not answer |
  | B12 | 1: A4 |
  | B14 | 1: A14 |
  | X1 | 2: A8; A13, the flag |
  | X4 | 1: A13, the rules file |
  | mandate | 2: the mandate at the signer; a self-minted mandate |
  | none | 0: 22 passed |

- `pnpm typecheck`: 0 errors. `npx eslint examples/`: 0 problems.
- The pinned bundle, before (`origin/main` `02506766`) and on this branch: `site/buy.mjs` `e74ff2230f0d4fd426525095731e42d50b65b55ab7792a43cab73c302b22eb88`, `site/try.mjs` `04ef4434fb4b5635bb3c49df69c7547f3200c6c41f903237ee37098be23f75c8`. Unchanged.

## Decisions

- **The signer runs `checkPaymentFile` as it is**, the check a wallet's holder runs before signing (`verify.ts`), rather than its own rebuild: one check for both.
- **A deal ends in the ledger only when every read endpoint agrees**, or at its last deadline plus the deployment's expiry margin. Any doubt keeps it open, which can block a deal and never lets one through.
- **The mandate file is outside the rules' hash**, so the administrator renews it every 7 days without a restart; it is verified on every request, against the principal the rules pin.
- **The rules file is validated by a small validator in `signer.ts`** that knows each keyword the schema uses and refuses to start on any other; a test checks that Ajv strict agrees on the same files. Ajv is not a dependency of `examples/`.

## Handoff

Done: the signer's buying half, its rules format and version 1 file, and its attack tests. Not done, by design: the selling half (build row 5), the machines (row 7), the person-signed purchase, the float's emptying. To run it: `node examples/signer.ts check-rules <file>`, then `serve` with the two keys in the signer's own environment; the buying agent's side is T-435.

**For the coordinator:** CI's anvil job lists its files in `.github/workflows/ci.yml` (tier 3). Adding `examples/signer-anvil.test.ts` to the `world` leg would make CI run the token-level test; that change waits for Rafa's word.
