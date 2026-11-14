# T-432: a fresh seller key for each deal

- **Lane:** demo (the seller adapter)
- **Phase:** 2
- **Depends on:** T-431 (the same file; this branch starts from it), T-416 (the privacy baseline)
- **Paths this task may touch:** `examples/seller-adapter.ts`, `examples/seal.ts`, `examples/seller-adapter-keys.test.ts`, `site/ref/seller-adapter.txt`, this file
- **Human gate:** no
- **Status:** review
- **Agent/session:** T-399 session (roadmap row N127, Rafa 2026-11-14: "Yes build both")

## Intent

The seller adapter signs every deal with one key, `HOLDBACK_KEY`. So `GET /v1/commitments?party=<that address>` lists every deal the seller ever made: 15 for the rehearsal's seller (measured, `docs/privacy-baseline.md`, "Link between two deals of one party").

N127 asks for one key and its mandate per deal, with the long-term key kept for the seller itself. Done when a read of the commitments by a seller key returns one deal per key.

Non-goals:
- a fresh payout address per deal;
- a certificate from the long-term key to the buyer;
- admission of a key without a mandate at `public`;
- any operator, contract, schema or buyer-tool change.

## Context

The research pass is `t-432-fresh-seller-key-research.md` in the coordinator's notes folder, read at `main` `40eb155a`. Its main facts:

- At `public` only a mandate in the operators' book admits a seller key, and only at the offer (`packages/settlement/evm/evm-settlement.ts`).
- The contracts read no mandate.
- The faucet signs a fresh 30-day mandate per grant. It allows 10 addresses per client per hour on `main` (`apps/demo-cloud/src/world.ts`).
- A grant that names a `paymentAddress` sends its token there; on a chain it mints nothing once that address holds the amount.
- The buyer's tools compare no card address.

## Acceptance criteria

- [x] **The setting.** `signingKey: "per-deal"` signs each offer, and its delivery, with a key derived from `HOLDBACK_KEY` and the offer's own nonce: `keccak256(HOLDBACK_KEY ‖ "crow.seller-adapter.deal-key/1" ‖ nonce)`. `"standing"`, the default, keeps today's behaviour.
- [x] **The mandate.** Each deal key takes its own mandate from the test service's faucet when the quote comes in, after the seller's API has priced it. The grant sends its token unit to one holding address derived from `HOLDBACK_KEY`, never to the deal key or the payout address.
- [x] **No stored keys.** The journal gains no field. After a restart the adapter derives the deal key again from the signed terms, and `examples/seal.ts` does the same from the bare terms. A key that neither matches the terms' seller nor derives from their nonce is refused.
- [x] **Payments.** Every per-deal offer names `sellerPayoutAddress`: `payoutAddress`, or `HOLDBACK_KEY`'s address.
- [x] **Done when (N127):** three quotes give three seller keys. `party=` on each key returns that key's one deal on both operators, and `party=` on `HOLDBACK_KEY`'s address returns none.
- [x] **Faucet refusals.** A refused grant answers the quote 503 `seller_unavailable` with the faucet's own `Retry-After`, at least 60 s. No quote asks the faucet again until that time has passed. The adapter never signs with `HOLDBACK_KEY` instead.
- [x] **Start refusal.** Per-deal mode with no faucet for the club, or with `mandate.fromFaucet: false`, stops the start and says why.
- [x] **No secrets written.** No private key appears in the journal, the events file or the log. `deal.offered` gains `grantMs`, the faucet's time.

## Out of scope

- The default on the test service, with `examples/audit-deal.ts` and `site/sell.txt` (they approve the adapter's own address). That waits for a live rehearsal.
- A certificate from the long-term key in the quote answer (the `Delegation` type, shown to the buyer only).
- A fresh payout address per deal: a standing payout address still groups the deals in an unfiltered read and in the calldata.
- Sellers in their own clubs: no route admits a mandate at run time (`POST /v1/agents` answers 501), so they keep one key.
- Pruning the operators' mandate book, which gains one row per quote.

## Evidence

- Commands run and results (measured, 2026-11-14, worktree `.worktrees/t-432-fresh-seller-key` from `t-431-report-salt`):
  - `npx vitest run examples/seller-adapter-keys.test.ts`: 7 passed (after the review), on the demo world (`PublicWorld`) behind two origins with its faucet. The six tests:
    - the done-when line (three keys; `party=` one deal each on both operators, none for the long-term address);
    - a funded deal Released across a restart, its delivery event's actor the deal key, and no key in the journal, the events or the log;
    - mixed modes across restarts: a deal offered in standing mode and one in per-deal mode, both delivered by a standing-mode run, each by the key it was offered with;
    - a replayed quote making one deal;
    - the faucet's limit at 1 an hour: the second quote answers 503 with the faucet's Retry-After, the third asks no faucet, and no deal is signed by the long-term key;
    - the start refused with `mandate.fromFaucet: false`;
    - `signerFor`.
  - `npx vitest run examples/`: 443 passed, 24 skipped, 0 failed (after the review).
  - `pnpm test` before the review fixes: 4,002 passed, 4 failed, 234 skipped. The four failures were in three files this change does not touch: `apps/adjudicator/src/hung-read.test.ts`, `apps/demo-cloud/src/limits.attack.test.ts` and `examples/buyer-signer-addresses.test.ts`. They ran while the red team ran tests on the same machine. Alone, the three files passed 40 of 40 (measured); the cause is inferred to be load.
- Review (red team; the change touches key handling): ISSUES, four Low and nothing High or Medium. All are fixed in the second commit:
  - Low: an open `/quote` lets a stranger spend the faucet's grants. The start now warns when neither `quoteAuth` nor `quoteRateLimit` is set; this is advisory, per D31.
  - Low: `Retry-After` was a fixed 60 s with no backoff. The adapter now passes on the faucet's own Retry-After, at least 60 s, and asks the faucet no more until then. It reads that header with its own fetch: a change to `agent.ts` would change the published `try.mjs` and `buy.mjs` bundles.
  - Low: the start line said "The mandate ends 1970-01-01". It now says each deal key takes its own mandate.
  - Low: mixed modes were not tested. The test above now covers them.
  - Added from its notes: a start warning when `payoutAddress` is unset, since every deal then names `HOLDBACK_KEY`'s address.
  - The red team also measured that five parallel quotes gave five distinct keys, and that the operators cannot swap the offer's nonce (`own()` in `verify.ts`).
  - `pnpm typecheck` and `pnpm lint`: pass. `node site/build.mjs && node site/check.mjs`: PASS.
  - `pnpm test`: see the PR.
- Not measured: a live run on Sepolia. On a chain, a grant whose holding address already holds the unit mints nothing and waits for no block (inferred from `world.ts`). The first grant after a fresh install waits for one mint, about 10 to 17 s (measured on 2026-11-13 for grants that mint).

## Decisions

- **Option (a) of the research, opt-in.**
  - The default stays `"standing"`: each quote spends one faucet grant, and the live limit is 10 an hour per client on `main`.
  - `audit-deal.ts` and the sell guide approve the adapter's own address, so turning it on by default changes them too.
  - The pilot's two jobs can set it in their own configurations.
  - Rafa can overrule this in `docs/decisions-today.md` terms.
- **The key from the nonce, not a stored key.** Nothing secret is written to disk, and a lost journal loses no key. No public parent key exists, so nobody without `HOLDBACK_KEY` can link two deal keys (inferred). A leak of `HOLDBACK_KEY` exposes every deal key; today the same leak exposes the one key that signs everything.
- **The grant after the price.** A quote the seller's API refuses spends no grant.
- **No fallback.** A refused grant refuses the quote. Signing with `HOLDBACK_KEY` instead would undo the point silently.

## Handoff

Done: the setting, the derivation, the per-quote grant, the delivery and `seal.ts` signer, the tests, the guide line. Not done:
- a live proof on Sepolia: three quotes, then `party=` for each key on both operators;
- a site deploy (Rafa's).

Open for Rafa:
- **The default.** Turn it on with the next live rehearsal?
- **The payout address.** Is one standing payout address acceptable?
- **A certificate for the buyer.** Should a buyer get a signed link from the deal key to the long-term key?
- **PR 534.** That PR raises the faucet's limit to 50 an hour; is it deployed?
