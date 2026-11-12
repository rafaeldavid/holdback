# T-365: send a deal's due timeout with no operator (cutover package CU-2)

- **Lane:** settlement (tooling under `examples/`, change kind 4)
- **Phase:** 2
- **Depends on:** T-363 (the cutover checklist, on `contracts-audit-ready`), whose gap 2 this closes
- **Paths this task may touch:** `examples/send-timeout.ts`, `examples/send-timeout.test.ts`, one script line in the root `package.json`, one `EXEMPT` entry in `tests/ci-gated.test.ts`, this task file
- **Human gate:** no for the code. A live run on Sepolia is Rafa's.
- **Status:** done (PR 385, merged 2026-11-12 at 06:41 UTC as `c5865ca`)
- **Agent/session:** T-365 implementer session, 2026-11-12

## Intent

At the cutover to the new contracts, the operators stop serving the deployment that `main` runs today (EIP-712 domain 0.7, `contracts/deployments/sepolia.json`). A deal still open there keeps its permissionless timeouts: once a deadline has passed, anyone may send the step that moves the deal on. But each timeout call takes the deal's full terms, and today only the operators assemble that call. So a deal left behind would need a rollback or a hand-built transaction.

This task adds one command that any holder of the terms can run, with no operator and no Crow service:

```sh
pnpm send-timeout --terms <file> --deployment <file> [--rpc <url>] [--dry-run]
```

- **Inputs:** the deal's terms as JSON (the body `GET /v1/commitments/<id>/terms` serves to a party, or the `checked.terms` a buyer signer saved), a deployment record (`contracts/deployments/*.json`), an RPC URL, and for a real send a sender key in the `TIMEOUT_SENDER_KEY` environment variable.
- **What it does:** it reads the deal's stage and times from `dealOf` and the latest block, works out which of the contract's timeouts is due now, and prints one line: the deal's ID, its stage, the deadline that passed with its time, and the step it will send. With `--dry-run` it stops there. Otherwise it sends that one transaction, waits for it, and prints the hash and the new stage. It never prints the key.
- **Refusals,** each with a reason and a non-zero exit: a mainnet chain; terms that do not hash to their own commitment ID; a record whose rules contract has no code, or whose signing domain differs from the terms'; a deal with no timeout due yet (it says when the next one opens); a closed deal.
- **Non-goals:** it never signs or sends a party's message, a decision, a delivery or a settlement. It authors no message at all: a timeout needs no party's signature, only a transaction from any funded sender. It does not cover the new contracts on `contracts-audit-ready`; their version follows in a later package (Handoff).

## Context

- `contracts/src/HoldbackRules.sol` on `main`, "Timeouts (TimeoutKind), anyone may call": `expireOffer`, `reclaim`, `triggerFallback`, `triggerDefault`, `expireAppeal`.
- `docs/neutrality.md`, liveness of everyone at once (item 4): funds stay held until someone triggers the expiry rule, and anyone can.
- `docs/cutover-phase-one.md` on `contracts-audit-ready`, step 1.5, the third way out: a deal left on the old contracts.
- `examples/e2e-chain.ts` (`RoundChain`, `termsTuple`, `assertRoundChain`), `examples/verify.ts` (the pinned EIP-712 types).

## Acceptance criteria

- [x] One test on anvil per timeout the deployed contracts have, each driving a deal to the point where it is due with no operator running, then closing it with this command alone.
- [x] One test per refusal; the dry run changes nothing on chain.
- [x] A named neutrality test: a deal still completes when every operator is offline after funding.
- [x] `pnpm typecheck`, `pnpm test` and `pnpm lint` pass.
- [x] Evidence lists each timeout and its test; Handoff gives the exact command for the cutover checklist and what changes for the new contracts.

## Out of scope

- The new contracts' timeouts (branch `contracts-audit-ready`).
- Any change under `packages/` or `contracts/`.
- A live run on Sepolia.

## Evidence

All measured on 2026-11-12 in the worktree at `origin/main` 277b597, with anvil 1.0.0 and the contracts built from `main`'s sources (`packages/settlement/evm/abis.test.ts` passes against that build).

**Each timeout of `HoldbackRules` on main, and its test** in `examples/send-timeout.test.ts`, suite "send-timeout on anvil, with no operator pass running". Each test drives a deal to the point where the timeout is due through the operators' settlement adapter, runs no operator pass, moves anvil's clock past the deadline, and closes the deal by running the command as a separate process from a key that is none of the deal's parties or adjudicators:

| Timeout | Stage it ends | Test | Result on chain |
| --- | --- | --- | --- |
| `expireOffer` | `None`, after the earlier of `offerExpiresAt` and `fundBy` | "expireOffer: an offer nobody funded expires…" | `Expired` |
| `reclaim` | `Held`, after `deliverBy` | "reclaim: nothing delivered by deliverBy…" | `Refunded`; the buyer gets the price and fee back |
| `triggerFallback` | `Delivered`, after `judgeBy` | "triggerFallback: the primary misses judgeBy…" | `FallbackJudging` |
| `triggerDefault` | `FallbackJudging`, after `fallbackBy` | "neutrality.operators-offline-after-funding: …" | `Refunded`; the buyer gets the price and fee back |
| `triggerDefault` | `Escalated`, after `t1 + appealDecideSec` | "triggerDefault after an escalation…" | `Refunded`; the buyer gets the price and fee back |
| `expireAppeal` | `Released` or `Refunded` with no appeal, after `t1 + appealWindowSec` | "expireAppeal, window unused…" | `Released`, appeal `expired` |
| `expireAppeal` | an open appeal, after `t1 + appealWindowSec + appealDecideSec` | "expireAppeal, appeal open…" | `Refunded`, appeal `expired`; the seller's appeal bond comes back |

**Refusals and their tests:**
- a mainnet record (chains 1 and 8453), refused before any connection: "refuses a mainnet deployment record by name…";
- an RPC on another chain than the record: "refuses an RPC that serves another chain than the record names";
- terms whose ID is not their own hash: the unit tests under `dealOfTerms`, and "refuses terms whose commitment ID is not their own hash" on anvil;
- a rules address with no code: "refuses a record whose rules contract has no code at that address";
- another signing domain: "refuses a record whose rules contract signs under another domain than the terms" (terms at 0.6 against the 0.7 contract);
- other contracts than main's: "refuses a record whose HoldbackBonds is not the one the rules contract created…", "refuses a contract that is not HoldbackRules at the rules address", and a record with no `bonds`;
- no timeout due, with when the next one opens: the first run in the `expireOffer`, `triggerFallback` and both `expireAppeal` tests;
- a closed deal: the last run in the `expireOffer` and neutrality tests;
- a key file, an outsider's projection, missing fields, a settlement mode the contract does not run, a bad command line, no key or a malformed key (whose value is not printed): the offline unit tests.

**Dry run:** the `reclaim` test runs `--dry-run` first. It prints the plan, and dealOf still reads `Held`, the sender's nonce and the buyer's balance are unchanged; the real send then raises the nonce by 1.

**Neutrality:** `neutrality.operators-offline-after-funding`. After funding, nothing goes through any operator: the seller delivers to `HoldbackRules` from its own key, both adjudicators stay silent, and a stranger runs the command twice (`triggerFallback`, then `triggerDefault`). The buyer ends with the price and fee back, and the parties sent no transaction after the delivery.

**Commands run and results:**
- `pnpm vitest run examples/send-timeout.test.ts`: 25 passed, 0 skipped, 84 s.
- `pnpm test`: 165 files and 3,357 tests passed, 6 skipped (3 files that skip on this machine before this change too), exit 0.
- `pnpm typecheck` and `pnpm lint`: no errors.
- Review (one reviewer pass, 2026-11-12): PASS. It found no Critical or High finding, and two Low notes: the token check above, now fixed, and the CI gap in Handoff. After the fix: `vitest run examples/send-timeout.test.ts`, 25 passed, 85 s; typecheck and lint report no errors.
- CI on PR 382 failed two checks, both fixed here. Gitleaks' generic-api-key rule flagged the test's token address literals (now `ASSET`, as in `e2e-settle.test.ts`). `tests/ci-gated.test.ts` failed because the new anvil-gated file was neither in CI's anvil job nor exempt (now exempt, above). Gitleaks scans every commit of a pull request, so the work moved to a clean branch and a new PR.
- No transaction on Sepolia or any live network.

## Decisions

1. **The contract decides what is due, not the operators' schedule.** For a `Delivered` deal the command sends `triggerFallback` from `judgeBy`, the moment `HoldbackRules` allows it. The operators wait until `fallbackBy` (T-211: before then the takeover is the fallback adjudicator's own turn). After the cutover no operator and, for the old world, no operator-run adjudicator is left, so waiting buys nothing; the default still waits for `fallbackBy`. [inferred]
2. **"Now" is the latest block's timestamp,** the clock the contract checks (`block.timestamp < deadline` reverts `TooEarly`). The transaction lands in a later block, so a deadline at or before the latest block is due. The command then simulates the call before it signs (`RoundChain.send`), so a deal another sender moved in the meantime is refused by the contract's own revert, and nothing is sent. [measured on anvil]
3. **Reuse, no new chain code.** The send goes through `RoundChain.send` in `examples/e2e-chain.ts`: the chain guard (Sepolia or anvil only, mainnets refused by name), simulate first, the 20 gwei fee cap, and the fixed gas limit anvil 1.0.0 needs for timeouts. The terms tuple and the commitment ID are built here from one normalized copy of the terms, so both wire forms work: public bodies, or the hashes in `privateTerms` (ADR-0024). `termsTuple` in `e2e-chain.ts` handles public terms only, and it stays as it is. [measured]
4. **What the terms file may be.** The body `GET /v1/commitments/<id>/terms` serves a party, or a buyer signer's `checked.terms`. A whole buyer-signer key file is refused unread past its key fields, so a key never travels into the command by mistake. An outsider's projection of a private deal lacks the nonce and the body hashes, so it is refused with that reason. [measured, unit tests]
5. **Three checks tie the record to the terms.** The rules address has code; its `eip712Domain()` is `Holdback <schemaVersion>` on the record's chain and address; its `BONDS()` is the record's `bonds`. The third check exists because the phase-one contracts on `contracts-audit-ready` still sign under 0.7 until T-358, yet have another `dealOf` shape and fewer timeouts. A record without `bonds`, as the phase-one deploy writes it, is refused before any connection. [measured for the contracts on main; inferred for the phase-one contracts, which this task did not deploy]
6. **One token, by its lowercase address.** The contract rebuilds the price, fee and settlement token strings from one address, as lowercase hex. So the command refuses terms whose fee is in another token, or whose token is a mixed-case address. Either would hash to another commitment on chain than the terms' own ID. The review of PR 382 found this as a Low note: the contract's own guards already kept it harmless. [measured, unit tests]
7. **The sender key** comes from `TIMEOUT_SENDER_KEY` only, is read only for a real send, and appears in no output: the anvil tests check every run's output for it. [measured]

## Handoff

**For the cutover checklist** (`docs/cutover-phase-one.md` on `contracts-audit-ready`, step 1.5, the third way out: a deal left on the old contracts). From the main checkout, with `TIMEOUT_SENDER_KEY` holding any key with Sepolia ETH, and the old record copied as step 2 says:

```sh
pnpm send-timeout --terms <deal>.json --deployment /Users/rafa/Documents/escrow/contracts/deployments/sepolia-2026-11-04-domain-0.7.json --rpc "$SEPOLIA_RPC_URL" --dry-run
pnpm send-timeout --terms <deal>.json --deployment /Users/rafa/Documents/escrow/contracts/deployments/sepolia-2026-11-04-domain-0.7.json --rpc "$SEPOLIA_RPC_URL"
```

Before the copy exists, `contracts/deployments/sepolia.json` is the same record. Get `<deal>.json` before the operators leave: `curl -s https://api.crow.direct/v1/commitments/<id>/terms > <deal>.json` serves public deals in full. The same route serves a private deal's sealed terms only to a party with its ReadToken (ADR-0024 §3), and outsiders get a projection the command refuses; the buyer signer also keeps them (`jq .checked.terms <key file>`). Run it once per due timeout: a deal that went `Delivered` needs two runs, `triggerFallback` from `judgeBy`, then `triggerDefault` from `fallbackBy`. When nothing is due, it says which timeout opens next and when. No Sepolia run has been made; a live run is Rafa's.

**What changes for the new contracts** (read at `origin/contracts-audit-ready` 6230b46, 2026-11-12):
- Only three timeouts remain: `reclaim`, `triggerFallback`, `triggerDefault` (from `FallbackJudging` at `fallbackBy`, from `Escalated` at `t1 + appealDecideSec`). `expireOffer` and `expireAppeal` are gone (ADR-0031 §7 and §8): an unfunded offer stores nothing, and a decision is final when written.
- `Stage` has no `Expired`; `Deal` is `{ stage, attempt, t1, seedTag }`, with no appeal state, flags or `t2`. `planTimeout` loses its `None`, `Released` and `Refunded` branches: those stages are closed.
- No `HoldbackBonds` and no `BONDS()`: the branch version drops the `BONDS()` check and the record's `bonds` field, and needs the branch's own `abis.json`. Until T-358 moves the domain to 0.8, nothing else tells the two deployments apart; after it, the domain check does.
- `HoldbackTypes.Terms` is unchanged between the two, so the tuple and the commitment ID carry over. [measured by diffing `contracts/src/HoldbackTypes.sol`]

**Open:**
- CI's anvil job runs a fixed list of files (`.github/workflows/ci.yml`, job `anvil`), and the test shards skip anvil suites. So CI runs this file's offline tests only, and the anvil suite runs locally until `examples/send-timeout.test.ts` joins the job's `world` leg. That is a one-line change of kind 11 (CI settings), which Rafa approves. Until then the file is listed in `EXEMPT` in `tests/ci-gated.test.ts` with that reason, as the round driver's anvil files are; the same change removes the entry.
- `RoundChain.send` caps the fee at 20 gwei. A Sepolia fee spike refuses the send with that reason; run it again once fees fall.
