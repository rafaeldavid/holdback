# T-319: a buyer signer a seller ships inside its own client

- **Lane:** examples (client code), with one section of the agent docs
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4, example and client code (Change recipes): the package's tests, no review. The `site/llms.txt` section is kind 1.
- **Depends on:** T-020 (`examples/agent.ts` and `examples/verify.ts`, the buyer steps this file reuses), T-314 (the faucet takes an `amount`). T-318 (a seller adapter) serves the quote route this file calls; the two merge in either order.
- **Paths this task may touch:** `examples/buyer-signer.ts`, `examples/buyer-signer.test.ts`, `examples/buy-with-signer.ts`, `site/llms.txt` (one new section only), `site/index.html` (only as `node site/build.mjs` regenerates it), this file. Never: `examples/seller-adapter.ts` or a stub seller API (T-318's lane), `examples/agent.ts`, `examples/verify.ts`, `examples/try.ts`, `site/try.mjs`, `spec/schemas/`, `contracts/`, `apps/`, `packages/`.
- **Human gate:** no. The site deploy that publishes the `llms.txt` section waits for Rafa.
- **Status:** in progress
- **Agent/session:** the T-319 session, 2026-11-11, branch `t-319-buyer-signer`

## Intent

Rafa asked on 2026-11-11 for a buyer signer that a seller ships inside its own command-line client, so a buyer's agent pays with no code of its own.

**Problem.** Today a buyer's agent that wants to pay a seller through Crow writes its own client: keys, the checks on the offer, three signatures and the decryption. A seller that wants buyers to arrive with no integration work has nothing to hand them.

**Goal.** A seller's client embeds one file, `examples/buyer-signer.ts`. The buyer's agent approves a quoted deal once. The file then does the buyer's side of the deal on the buyer's own machine:
- it makes the buyer's keys there and saves them there; they never leave that machine;
- it reads the offer from both operators and refuses to sign anything that differs from what the buyer approved;
- it signs the agreement, the funding and the operator fee with the buyer's own key;
- it waits for the outcome, opens the work and checks its hash.

The operator still only relays. The seller's servers never hold the buyer's key: the only thing the file sends a seller is the buyer's address, its public encryption key and the scope of the work.

**Inputs.**
- A directory on the buyer's machine for the key store.
- The address of the seller's quote route. `POST` with `{buyer, buyerEncryptionPublicKey, scope}` answers `{commitmentId, price, fees, expiresAt}` (T-318 serves it).
- What the buyer approved: the price, the fees, the deliverable, the checks, the deadlines and the adjudicators.
- Two operators at distinct origins (`HOLDBACK_OPERATORS`, or the public demo's two nodes).

**Outputs.**
1. `examples/buyer-signer.ts`: `makeKeys`, `loadKeys`, and on the signer they return `quote`, `testFunds`, `readOffer`, `checkOffer`, `agreeAndFund` and `openDelivery`. It imports the buyer steps from `examples/agent.ts` and `examples/verify.ts`; it holds no second copy of the protocol.
2. `examples/buy-with-signer.ts`: a 20-line script that imports the file and buys one deal end to end.
3. `examples/buyer-signer.test.ts`: the script buys a deal against the demo world; `checkOffer` refuses an offer whose price, check list or adjudicator differs from the approved one; the key store survives a restart between funding and opening the delivery.
4. A section in `site/llms.txt`, "A seller's client can carry the buyer's side".

**Non-goals.**
- No seller side: no quote route, no adapter, no stub seller API file. The test plays the seller inside the test file, with `examples/agent.ts`.
- No new operator route, schema, contract or signed message. If no existing route can relay a sweep of the per-deal key without the buyer holding ETH, `sweep` stays out and the Handoff says so.
- No change to `agent.ts`, `verify.ts`, `try.ts` or the published `try.mjs`.
- No Python version, no admission of per-deal keys by a Delegation without the faucet, no published bundle with a pinned SHA-256. These are follow-ups in the Handoff.
- The file does not judge the work. It returns the work as untrusted data and never prints it.

## Context

- `site/llms.txt` sections 1 to 8, above all section 4, "Verify before you sign", and section 6, "Buyer: check the offer, agree and fund".
- `examples/agent.ts` (`Agent.trusted`, `agreeAndFund`, `openDelivery`), `examples/verify.ts` (`verifyPrepared`, `commitmentIdOf`, `operatorFeeOf`, `knownPins`), `examples/try.ts` (the buyer's checks on an offer it did not write).
- Hard rules in `CLAUDE.md`: signed messages, idempotency, money as base-unit decimal strings, deliverables are untrusted, secrets never printed.
- `docs/team.md`, "Operator proposes, agent verifies" (T-020).

## Acceptance criteria

- [ ] `makeKeys(store)` makes a fresh signing key and x25519 key, writes them to the store with file mode 0600, and never prints or returns a secret key.
- [ ] `checkOffer` reads the terms from both operators and refuses, naming the field, when the price, a fee, the deliverable, the checks, the deadlines, an adjudicator, the buyer's address or the buyer's encryption key differs from what the buyer approved. It also recomputes the commitment ID and recovers the seller's signature.
- [ ] `agreeAndFund` signs only terms `checkOffer` passed, verifies every prepared message against its own intent (`verify.ts`), and returns the total the buyer paid in base units.
- [ ] `openDelivery` waits for the outcome on both operators, opens the buyer's envelope, checks the plaintext hash both operators record, and returns the work with the receipt and the transaction links.
- [ ] A 20-line script imports the file and buys a deal end to end against the in-process demo world.
- [ ] A signer loaded from the key store after a restart opens the delivery of a deal the first one funded.
- [ ] `site/llms.txt` has the section; `node site/build.mjs && node site/check.mjs` pass.
- [ ] `pnpm typecheck`, the examples' tests and `pnpm lint` pass.

## Out of scope

- A Python version of the file.
- Admission of a per-deal key by a `Delegation` certificate, so a buyer needs no faucet call.
- Publishing the file with a pinned SHA-256, the way `site/try.mjs` is published.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
