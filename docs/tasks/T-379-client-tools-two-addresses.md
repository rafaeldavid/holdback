# T-379: the client tools follow the two addresses, and an outside wallet can pay (package R6c-3)

- **Lane:** demo (client tools)
- **Phase:** 2
- **Depends on:** T-358 (R6c-1, merged to `contracts-audit-ready` at `a37a48d`: the two fields, schema v0.11, domain 0.8), ADR-0033, T-374 part 1 (rafaeldavid/holdback#398: main of 2026-11-12 into the lane, with T-366 and T-368), T-378 (R6c-2, the operator side, running beside this task)
- **Paths this task may touch:** `examples/buyer-signer.ts` and its tests, `examples/buy-with-signer.ts` and its test, `examples/seller-adapter.ts` with its configuration files and tests, `examples/audit-deal.ts` and its test, `examples/deal-record.ts` and its test, `examples/agent.ts`, `examples/verify.ts` and its test, the terms templates these tools ship in `examples/`, `site/llms.txt`, this task file. Never `contracts/`, `packages/`, `apps/`, `spec/`, `formal/`, `fixtures/` or any other file under `docs/`
- **Human gate:** no for the branch. The site deploy, the operator deploy, the Sepolia rehearsal and the merge to `main` are Rafa's
- **Status:** in progress
- **Agent/session:** implementer session, change kind 4: one reviewer per pull request, and one red team on the pull request that accepts an outside signature

## Intent

In my own words. Since T-358 the signed terms name four addresses: the buyer's and the seller's signing addresses, the buyer's payment address (it funds the hold and receives every refund) and the seller's payout address (it receives the price). Every client tool still assumes each money address equals its party's signing address. This task makes the tools a buyer and a seller actually run use the two money addresses, so that:

- **A buyer can pay from a wallet the tool never holds.** The signer writes the two messages the payment address must sign (the funding authorization and the operator fee) as standard typed-data files, the JSON that `eth_signTypedData_v4` takes. It prints one sentence for each: who pays whom, how much, until when, for which deal. It takes each signature back as hex and checks, before it sends anything, that the signature recovers to the payment address over the message it wrote. It refuses a signature from another address, a signature for another deal and a signature for more than the approved total, each with its own reason. This is how Rafa's own wallet pays in the pilot, with a Crow agent holding a per-deal signing key that holds no money.
- **No address that receives money comes from anyone but its owner.** The buyer signer shows the payment address and the seller's payout address in the offer, and refuses an offer whose payment address is not its own or whose payout address changed after the buyer approved it. The seller adapter takes its payout address from its own configuration and refuses to sign terms that carry another. With none set, each tool uses its signing address and says so in one line (ADR-0033 section 7).
- **No tool offers or signs in a token the operators refuse.** The adapter and the signer take the token from discovery; a terms file that names another is refused at start, naming both.

Inputs: ADR-0033 sections 3, 5, 6, 7 and 10 (the client package's proof); the contract refinement plan's sections 2b, 2c, 7c.2 and 7d ("R6c-3"), kept privately. Outputs: the changed tools, their tests, `site/llms.txt`, and this file's Evidence and Handoff.

Non-goals: no change to the operator's prepare routes, the faucet, the SDK or the adjudicator (T-378); no contract, schema, core or SimChain change; no `fixtures/` scenario (the three attack fixtures ADR-0033 names go to the Handoff, with the equivalent client tests here); no deploy and no Sepolia run; no support yet for a contract wallet (ERC-1271) or an undeployed wallet (ERC-6492) on the outside-signature path, because checking such a signature needs a chain read the client does not make (Handoff).

## Context

- ADR-0033 (on `main`, and on the lane after rafaeldavid/holdback#398): section 3 (who signs what, the funding nonce, what the payment address checks before it signs), section 6 (each party's own address comes only from its own configuration), section 7 (the defaults and the advisory warnings), section 10 (the client package's proof).
- The plan's section 2b, "How a person's own wallet signs": the typed-data files, the one-sentence summary, the end-to-end test from the files alone, the Foundry path for a hardware wallet.
- The plan's section 2c, row "R6c-3, with the kit": one token.
- The plan's section 7d, "R6c-3": items 19, 25, 79 and 81.
- T-368 (main `863a971`): the buyer's command stops for approval before it funds; T-366 (main `00be274`): the seller adapter calls a job API directly. Both are kept.

## Acceptance criteria

The two addresses (pull request 1)

- [ ] The buyer signer takes a payment address at `makeKeys` (saved in the key file) and sends it with the quote; with none set it uses the signing address and reports one line saying so.
- [ ] The offer view shows `buyerPaymentAddress` and `sellerPayoutAddress`, and the five fields T-332 left out: the schema version, the token (the one checked against discovery), the remedy on a reject, the nonce and the creation time (item 19).
- [ ] `checkOffer` refuses terms whose payment address is not the key file's, and terms whose payout address differs from the approved or shown one, naming the field.
- [ ] The seller adapter takes `payoutAddress` in its configuration, writes it into every offer, refuses prepared terms that carry another, and prints one start-up line when none is set. It warns, never refuses, for the zero address, a deployment contract or an adjudicator (ADR-0033 section 7).
- [ ] `examples/agent.ts` and `examples/verify.ts` build and check offers with both fields from the request; `verifyPrepared` refuses a prepared offer that substitutes either address.
- [ ] The deal record shows the address that was paid and the address that was refunded, and its postings check uses the money addresses.
- [ ] The rehearsal tool writes the buyer's deal record through the signer's `record()` and no longer reads the key file (item 79). The older single-deal path approves through the signer's offer view, with the signed fields (item 25). Its seven cases still pass.

An outside wallet pays (pull request 2)

- [ ] The rehearsal tool has a two-address case, whose payment key stands in for Rafa's wallet and signs the typed-data files. A live case makes a fresh signing key and reuses the payment address (item 81).

- [ ] The signer writes one typed-data file for the funding and one for the operator fee, each with `domain`, `types` (with `EIP712Domain`), `primaryType` and `message`, and prints one sentence for each.
- [ ] It accepts a signature made elsewhere and refuses one that is not the payment address's, one for another deal, and one for more than the approved total, each with a test.
- [ ] A test signs both files with viem from the files alone and the deal funds: the payment address funds it, the signing address holds nothing at any step, and a reject, a reclaim and a settlement's remainder return to the payment address.
- [ ] A check the holder runs alone rebuilds the funding nonce from the terms and its own pinned deployment and refuses a nonce built with another operator, receiver, buyer, chain ID or margin.
- [ ] One red team reads this path.

One token, and the words (pull request 3)

- [ ] The adapter and the buyer signer take the token from discovery; a terms file that names another (`tUSD` against a world whose token is another) is refused at start, naming both, before any offer is posted.
- [ ] A terms file for the live world may name no token and takes discovery's; a SimChain template says it is for the simulator.
- [ ] `site/llms.txt` explains the two addresses, why a production seller sets a separate payout address, the rule that a party's money address comes only from its own configuration, and the typed-data files for an outside wallet.
- [ ] `pnpm typecheck`, `pnpm lint`, the touched tests, `pnpm snap` and `node site/build.mjs && node site/check.mjs` pass; CI passes on each pull request.

## Out of scope

- The operator's prepare inputs for the two addresses, the faucet split and the settlement route (T-378).
- The attack fixtures under `fixtures/` (Handoff).
- Contract wallets and undeployed wallets on the outside-signature path (Handoff).
- The Sepolia rehearsal and the deploys (Rafa).

## Evidence

Labels: measured (run here), inferred (read from code), guessed.

### Pull request 1: the two addresses in every client tool

- **Commands run, on the lane at `027e3db` plus this branch** [measured]: `pnpm typecheck` passed; `npx eslint examples site` passed; `npx vitest run examples/` passed 368 tests in 28 files (23 skipped, as on the lane); `pnpm snap` passed 43 of 43; `node site/build.mjs && node site/check.mjs` passed.
- **Baseline before any edit** [measured]: the eight touched test files passed 153 tests in 31 s.
- **The new tests** [measured]:
  - `examples/buyer-signer-addresses.test.ts` (7 tests): the one-line notice with no payment address set; a payment address saved in the key file, sent with the quote and shown in the offer, with the payout address and the five fields of item 19; the refusal of a payment address that is not the key file's; the refusal of a payout address the buyer did not approve; the advisory warnings (an adjudicator, the zero address); an offer in another token, which this world's operators refuse before it exists; a deal whose payout address differs from the seller's signing key, released to the payout address with the signing key's balance unchanged, and the buyer's deal record by `record()` (item 79) showing `paidTo`, with no secret key in it.
  - `examples/verify.test.ts` (3 tests): a prepared offer that substitutes either money address is refused, with the inputs and without them (`attack.prepare-substitutes-payout-address` and `-payment-address`, as tests); `Agent.offerDirect`; the funding intent refuses terms whose payment address is not the buyer's own, and names the payment address as the signer of the funding slot.
  - `examples/seller-adapter.test.ts` (4 tests): the start-up line with no payout address; `payoutAddress` from a configuration file, a malformed one refused at start, a warning for an adjudicator; prepared terms with a substituted payout address refused through a lying operator, with no offer made; a malformed `buyerPaymentAddress` in a quote refused with 400.
- **One run was load-dependent** [measured]: in one run of 13 test files at once, the rehearsal's `refunded` case failed once (`expected null to deeply equal Any<String>`); alone it passed 26 of 26, and the next full run of `examples/` passed. Not changed by this pull request [inferred]; noted for the reviewer.
- **The site's command changes** [measured]: `verify.ts` is in the `try.mjs` bundle, so its SHA-256 and the command on the page change (`site/try.mjs`, `site/index.html`).

## Decisions

- **The outside wallet signs files the signer wrote, and the signer checks against its own copy.** The security of the check rests on recovering each signature over the typed data the signer rebuilt from the approved terms, never over a file handed back. A returned file is read only to give a named refusal (another deal, another amount) before that recovery.
- **The request field names match T-378's** (its answer, 2026-11-12): `POST /v1/prepare/offer` takes `buyer: {address, encryptionPublicKey, paymentAddress?}` and a top-level `sellerPayoutAddress?` beside `seller`, both lowercased into the terms; an absent one becomes the signing address with one `notices` line. `examples/verify.ts` rebuilds the offer from the same request fields. Agree-and-fund keeps its slots: `signature` (signer `buyer`), `fund.signature` and `operatorFee.signature` (signer `buyerPaymentAddress`). Until T-378's first pull request merges into the lane, the route defaults every address, so the tests that need the addresses apart through the prepare route wait for it.
- **The payment address is saved in the key file,** so a resumed or approved run uses the same address and the approval stop shows it. The buyer's command takes it from `CROW_PAYMENT_ADDRESS`.
- **A client-side recipe for a public offer, `Agent.offerDirect`.** The same function (`publicOfferTerms`) rebuilds a prepared offer in `verifyPrepared` and builds a direct one, so the two cannot drift. It lets an agent offer with no prepare call (ADR-0005), and it lets the tests make offers with the addresses apart before T-378's prepare inputs land. The seller adapter keeps the prepare route.
- **The tools send a money address only when it differs from the signing address,** so a tool that sets none sends exactly what it sent before.
- **Until T-378 lands, a separate address through the prepare route is refused, not ignored** [measured]: the lane's prepare route fills both money addresses with the signing addresses, so an adapter with `payoutAddress` set, or a quote with `buyerPaymentAddress`, gets prepared terms that differ from its request, and `verifyPrepared` refuses to sign them (502 from the adapter). That is the attack fixture's behaviour, and it ends when T-378's route takes the inputs.
- **The faucet split waits for T-378.** With the addresses apart, `testFunds` asks the faucet for the total for the payment address and for 1 base unit with the mandate for the signing key, because every grant on the lane mints at least 1 base unit [measured: `apps/operator/src/registry.ts:127`]. T-378's faucet sends the mandate alone; the signer switches to it when it merges.
- **The token check in the offer view is a second line.** This world's operators refuse an offer in another token before it exists [measured: the fallback adjudicator's bond check names the token]. The signer's own refusal covers operators that relay one; no operator can change a real offer's token, since the commitment ID covers it.

## Handoff

What is done, what is not, how to resume, and the open questions that remain.
