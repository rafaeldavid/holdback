# T-411: the buyer's tools and record, follow-ups from the live rehearsal

- **Lane:** buyer's tools and guides, into `main`
- **Phase:** 2
- **Depends on:** T-399 (Findings 2, 5 and 6), T-401 (Handoff items 2 and 10)
- **Paths this task may touch:** `examples/buy-with-signer.ts`, `examples/deal-record.ts` and their tests, `site/buy.txt`, `site/llms.txt`, `site/buy.mjs` as the build writes it, this file. Also `examples/buyer-signer.ts` and a new test file beside it: the faucet call and the operators' reads live there, `buy.mjs` bundles it, no lane of the 2026-11-14 wave owns it, and no open pull request touches it (checked with `gh pr list`, 2026-11-14). Off limits: `examples/seller-adapter*.ts`, `examples/try.ts`, `examples/agent.ts`, `site/sell.txt`.
- **Human gate:** no. The site deploy that publishes the new `buy.mjs` is Rafa's word.
- **Status:** in progress
- **Agent/session:** T-411's session, kinds 1 and 4 (buyer's tools)

## Intent

The rehearsal on the live service (T-399) and the guide clean-up (T-401) left four small faults on the buyer's side. Each one costs a buyer's agent a wrong turn on its first deal:

1. When the faucet refuses a grant (429), `buy.mjs approve` dies with a stack trace. An agent cannot tell from that how long to wait, or whether money moved. It should stop with one plain line: the faucet's grants are used, it grants again in N seconds, nothing is paid.
2. The deal record on Sepolia lists the decision's transaction three times, because one transaction carries three events. It should list each transaction once. The payee (`row.paidTo`) stays empty on Sepolia because the chain's events carry no postings: fill it only if that is a small, tested read, else say what it takes.
3. The seller side once saw "operators disagree" 11 s after an offer, and the next poll went on. If the buyer's tools stop on one such read, an operator a few seconds behind the other stops a deal for nothing. A disagreement that clears within a short window should be read again, and one that does not clear must still stop: the two-operator check stays as strict as it is.
4. `llms.txt` names Node 20 for the try command, `buy.txt` Node 22.18 for the buyer's tools; and `buy.txt` step 9 reads as if running the checks yourself were a step, though it needs a clone the guide never sets up. State the Node version so an agent installs the right one first, and mark the clone step optional, inside the buyer's 5,000-token budget.

## Acceptance criteria

- [ ] A faucet 429 on `approve` prints one line on stderr, with no stack trace: the faucet's grants are used, the seconds from `Retry-After` (or `retryAfterSec`), and that nothing is signed or paid; the exit status is 1, as `buy.txt` documents for a stop with nothing paid. A test that fails before the change shows it, through an operator that answers the faucet with 429.
- [ ] `settlement.transactions` and `row.transactions` in the deal record list each transaction once, under the first step that names it. A test with three events on one transaction shows it.
- [ ] `row.paidTo` on a chain: filled from a small, tested read, or left null with what filling it would take written in the Handoff.
- [ ] The buyer's reads of what changes over time (the escrow state, the events, the balance, the released key) read again when the operators disagree, for up to about 15 s, and stop with the same `operators disagree on ...; do not proceed` when they still disagree. Reads of what does not change (the terms, discovery) stop at once, as now. Tests show a disagreement that clears, one that does not, and that another error is not retried.
- [ ] `site/llms.txt` and `site/buy.txt` state the Node version once, so a buyer installs Node 22.18 or later first; step 9's own check is marked optional. Both guides stay ASCII; the buyer's path stays within 5,000 tokens (before and after measured by `node site/check.mjs`). The first paragraph of `llms.txt` after the tagline is unchanged, and "owner" stays "owner" in `buy.txt`.
- [ ] `node site/build.mjs && node site/check.mjs` pass with nothing unexpected in `git status`; the old and new SHA-256 of `site/buy.mjs` are recorded, and `site/try.mjs` is unchanged.

## Evidence

(filled in at hand-off)

## Handoff

(filled in at hand-off)
