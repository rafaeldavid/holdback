# T-319: a buyer signer a seller ships inside its own client

- **Lane:** examples (client code), with one section of the agent docs
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4, example and client code (Change recipes): the package's tests, no review. The `site/llms.txt` section is kind 1.
- **Depends on:** T-020 (`examples/agent.ts` and `examples/verify.ts`, the buyer steps this file reuses), T-314 (the faucet takes an `amount`). T-318 (a seller adapter) serves the quote route this file calls; the two merge in either order.
- **Paths this task may touch:** `examples/buyer-signer.ts`, `examples/buyer-signer.test.ts`, `examples/buy-with-signer.ts`, `site/llms.txt` (one new section only), `site/index.html` (only as `node site/build.mjs` regenerates it), this file. Never: `examples/seller-adapter.ts` or a stub seller API (T-318's lane), `examples/agent.ts`, `examples/verify.ts`, `examples/try.ts`, `site/try.mjs`, `spec/schemas/`, `contracts/`, `apps/`, `packages/`.
- **Human gate:** no. The site deploy that publishes the `llms.txt` section waits for Rafa.
- **Status:** done (PR 281, merged 2026-11-11)
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

- [x] `makeKeys(store)` makes a fresh signing key and x25519 key, writes them to the store with file mode 0600, and never prints or returns a secret key.
- [x] `checkOffer` reads the terms from both operators and refuses, naming the field, when the price, a fee, the deliverable, the checks, the deadlines, an adjudicator, the buyer's address or the buyer's encryption key differs from what the buyer approved. It also recomputes the commitment ID and recovers the seller's signature.
- [x] `agreeAndFund` signs only terms `checkOffer` passed, verifies every prepared message against its own intent (`verify.ts`), and returns the total the buyer paid in base units.
- [x] `openDelivery` waits for the outcome on both operators, opens the buyer's envelope, checks the plaintext hash both operators record, and returns the work with the receipt and the transaction links.
- [x] A 20-line script imports the file and buys a deal end to end against the in-process demo world.
- [x] A signer loaded from the key store after a restart opens the delivery of a deal the first one funded.
- [x] `site/llms.txt` has the section; `node site/build.mjs && node site/check.mjs` pass.
- [x] `pnpm typecheck`, the examples' tests and `pnpm lint` pass.

## Out of scope

- A Python version of the file.
- Admission of a per-deal key by a `Delegation` certificate, so a buyer needs no faucet call.
- Publishing the file with a pinned SHA-256, the way `site/try.mjs` is published.

## Evidence

All measured on 2026-11-11 on branch `t-319-buyer-signer`, in a fresh clone of `origin/main` at `a42dc45`, unless a line says otherwise.

- `pnpm exec vitest run examples/buyer-signer.test.ts`: 6 tests pass in about 4 s. They run against the public demo's own world (`apps/demo-cloud`, SimChain, a 1 basis point operator fee with a 10,000 base unit minimum) served in the test process on two origins.
  1. `examples/buy-with-signer.ts`, 19 lines, runs as a separate Node process and buys one deal: `Released` on both operators, the work equals what the seller delivered, the buyer paid 26,010,000 base units (26.01 tUSD: 25 price, 1 adjudication fee, 0.01 operator fee), and the per-deal key's balance ends at 0. Its output and errors carry no secret key.
  2. `makeKeys` writes `<address>.json` with file mode 0600; the signer object shows no secret key.
  3. `checkOffer` refuses, naming the field, an approved price of 24 tUSD against an offer of 25, a check list with one check fewer or one more, another primary adjudicator, another operator fee, another deliverable format, another appeal window and another seller. After the refusals `agreeAndFund` refuses and the deal is still `AcceptedByAdjudicator`. The approved offer itself passes.
  4. `checkOffer` refuses an offer the seller made to an encryption key of its own.
  5. `agreeAndFund` refuses when one operator raises the funding's value in the message it prepares; the deal stays `AcceptedByAdjudicator` and the buyer's balance stays 26.01 tUSD.
  6. A signer that `loadKeys` builds from the directory and the commitment ID opens the delivery of a deal another signer funded: the work, its SHA-256, the operator's signed funding receipt and the event hashes.
- `pnpm exec vitest run examples`: 18 files pass, 163 tests pass, 13 skip (the anvil and network suites, which CI runs) in 117 s.
- `pnpm typecheck`: passes. `pnpm lint`: passes with no finding.
- `node site/build.mjs && node site/check.mjs`: site check PASS. `site/try.mjs` keeps its SHA-256 (`4dab4c08…`), and `site/index.html` does not change.
- Snapshot diffs: none. Metrics: none.
- Not run: the full `pnpm verify` (Change recipes: only before a deploy). CI is the gate.
- Inferred, not measured: the file works on Sepolia. It builds its agent from the same pins as `examples/try.ts`, which round 1 runs on Sepolia, but no test here funds a hold on a chain.

## Decisions

1. **A signer object, not six loose functions.** `makeKeys(store)` returns a `BuyerSigner`, and `checkOffer`, `agreeAndFund` and `openDelivery` are its methods. They take only a commitment ID, as the ticket asks, so the key has to come from somewhere: the object holds it in a private field and the key file holds it across a restart (`loadKeys`).
2. **`approved` has the shape `readOffer` returns.** The quote carries only a price, fees and an expiry. The buyer's agent needs the deliverable, the checks, the deadlines and the adjudicators to approve them, so `readOffer` reads them from both operators and `checkOffer` compares field by field. A client that already knows what its buyer wants builds `approved` itself and skips `readOffer`.
3. **The operator fee comes from the operators' schedule, never from the seller.** `readOffer` computes it with `operatorFeeOf`; `agreeAndFund` recomputes it and refuses when it changed since the approval.
4. **A missing rubric in `approved` means the offer must have none.** Otherwise a seller could add criteria the buyer never saw.
5. **The faucet call is a helper, `testFunds(amount)`, not part of `makeKeys`.** The total is known only after the quote, and the quote needs the keys. The faucet serves an address once an hour, so one call asks for the total. An offer to a buyer the club has not admitted yet is accepted (measured, test 1).
6. **One key, one deal.** `quote` and `checkOffer` bind the key to a commitment ID and stop on a second one.
7. **The file never deletes a key.** After a refund the price sits on the per-deal key, and no `sweep` exists (Handoff 1). Deleting the file would strand it.
8. **`agent.ts`, `verify.ts` and `try.ts` are unchanged.** The signer imports `Agent`, `commitmentIdOf`, `operatorFeeOf`, `knownPins`, `typedOf` and `Refusal`. What it repeats from `try.ts`, which is a script and exports nothing, is the list of fields to compare and the polling loop; no hashing, typed data or encryption is written twice. A change to `agent.ts` would also move the published `try.mjs` and its pinned SHA-256.
9. **The test plays the seller inside the test file,** with `Agent.offer` and `Agent.deliver` behind a `POST /quote` handler. No stub seller API file exists; T-318 owns the adapter.
10. **Text work only.** `Agent.openDelivery` returns a string. The signer re-hashes that string and stops when it does not match the recorded `plaintextSha256`, so binary work fails loudly and is never returned damaged.

## Handoff

**Done.** `examples/buyer-signer.ts`, `examples/buy-with-signer.ts`, `examples/buyer-signer.test.ts` and the `site/llms.txt` section "A seller's client can carry the buyer's side". The site deploy that publishes the section waits for Rafa.

**Not built, with the reason.**

1. **`sweep(to)` is left out.** No route relays a plain ERC-3009 transfer for an agent. The operators relay two authorisations with the agreement: the funding, which only the escrow's collector can redeem, and the operator fee, whose `to` is the operator's own address (`site/llms.txt` section 6). So after a refund, or when a faucet grant exceeds the total, tokens stay on the per-deal key until the buyer sends a transaction itself, which needs ETH on that key. Asking the faucet for exactly the total leaves 0 after a release (measured). A relayed sweep needs a new operator route and probably a fee for its gas: an API contract change, so an ADR first.

**Follow-ups, out of scope here.**

2. A Python version of the file.
3. Admission of a per-deal key by a `Delegation` certificate (ADR-0024), so a buyer needs no faucet call and no mandate of its own.
4. Publishing the file with a pinned SHA-256, the way `site/build.mjs` publishes `try.mjs`, so a buyer can check that the copy in a seller's client is the reviewed one.
5. Binary work: `Agent.openDelivery` would return bytes. That edit moves `try.mjs` and its SHA-256.
6. Private terms (ADR-0024): `readOffer` reads public terms only. `Agent.openTerms` already opens sealed ones.
7. A read of the delivery hash from the rules contract on Sepolia, so the opened work is checked against the chain and not only against two operators.

**Open questions.**

- T-318's quote route: this file posts to the full URL it is given and needs `commitmentId`, `price` as `{token, amount}` and `expiresAt` in the answer. It passes `fees` through unread, since `checkOffer` computes the fees itself. If T-318 names a field differently, change `quote` here.
- The quote's `expiresAt` is returned and saved, not enforced: the terms' `fundBy` is what settlement enforces.

**How to resume.** `pnpm install && pnpm typecheck && pnpm exec vitest run examples/buyer-signer.test.ts`. The surface is the header comment of `examples/buyer-signer.ts`.
