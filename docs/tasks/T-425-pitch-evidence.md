# T-425: Evidence for the machine-first pitch

- **Lane:** metrics (the pitch's missing measurements)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4 (tool code with its tests), with one kind 9 live run on Sepolia (test ETH and test tUSDC only)
- **Depends on:** the live test service on Sepolia (`https://api.crow.direct`, `https://api2.crow.direct`), Crow's test seller (`https://crow.direct/agents/test-seller`), `examples/try.ts`, and the anvil world of `examples/e2e-world.ts`
- **Paths this task may touch:** `scripts/metrics/pitch-evidence*`, `tests/metrics/pitch-evidence*`, this file. Scratch under `reports/scratch/t-425/` (not committed). The results go to the private repository, one new file `strategy/2026-11-14-machine-first-evidence.md`.
- **Human gate:** no. The live run makes test deals on the public test service like anyone running the try command; the operators pay its gas in test ETH. The two other measurements run on a local anvil chain only. Nothing is deployed.
- **Status:** in progress
- **Agent/session:** the T-425 side session of 2026-11-14, worktree `.worktrees/holdback-T-425`, branch `t-425-pitch-evidence`

## Intent

The pitch says Crow is built for machines and leans on three claims that rest on one example or on reading the code: a deal goes from offer to payment in about half a minute, a deal still finishes when the operators stop, and a leaked key reaches at most what its address holds. This task turns each into a measurement anyone can rerun with one command, and writes the numbers down for the coordinator, who updates the pitch.

1. **Typical time on the live service.** Run 20 test deals one at a time, exactly as the published try command runs them, and time each from the operator's own events: offer to funding, funding to delivery, delivery to payment, offer to payment. Report the median, the minimum, the maximum and the count, and how typical the morning's 33 s deal was.
2. **A deal finished with both operators stopped.** On a local anvil chain, fund and deliver through the operators, stop both, and finish by calling the settlement contract directly; time the direct part.
3. **The worst a leaked key can do.** On anvil, for a buyer's per-deal key and for a seller's key, leaked before funding, after funding and after delivery: what the holder can and cannot do, and the largest loss in token units.

Non-goals: editing the pitch note or its page (the coordinator's); running anything against the live service except the 20 deals; a live direct-submission run (it needs a funded Sepolia wallet, Rafa's); changing the contracts, the operators or the guides.

## Acceptance criteria

- [x] `node scripts/metrics/pitch-evidence.mjs --help` describes the three measurements; each runs with one command and writes one JSON record.
- [ ] Measurement 1: 20 live deals run one at a time, each with its commitment ID and its four intervals; the median, minimum, maximum and count; the relayer's test ETH read first and checked against its low mark.
- [x] Measurement 2: on anvil, a deal funded and delivered through the operators finishes with both operators stopped, by direct calls only, timed; it names the fixture it extends.
- [x] Measurement 3: on anvil, each attempt a leaked buyer or seller key can make at each stage, with what moved and the largest loss in tUSDC.
- [x] Tests for the parts that need no network (`tests/metrics/pitch-evidence.test.ts`, in CI); the anvil tests skip in CI, as the other anvil tests do.
- [ ] One `reviewer` pass, its findings fixed or recorded.
- [ ] The private results file, with a table per measurement, each claim labelled, the commands, and three sentences for the pitch.

## Evidence

All on 2026-11-14 in the worktree, Node 22.22.2, unless labelled otherwise.

### Measurement 1: 20 live test deals

Filled when the series ends.

### Measurement 2: a deal finished with both operators stopped (local anvil only)

`node scripts/metrics/pitch-evidence.mjs direct` (runs `tests/metrics/pitch-evidence-direct.test.ts`, 4 of 4 pass) [measured]. The demo's own world (`apps/demo-cloud`) on the phase-one contracts on anvil, 1 s blocks. Each deal is funded through the operators, and delivered through them where it is delivered, with the world's passes paused so no adjudicator judges it. Then both operator nodes stop (neither URL answers), and the deal is finished by calls straight to HoldbackRules from the buyer's own key, which pays its own anvil gas.

| Path | Direct calls | Final stage | Blocks | Gas | Wall time of the direct part |
| --- | --- | --- | --- | --- | --- |
| Release: the buyer opens its envelope and accepts early | `earlyAccept` | Released, the price to the seller, the fee back to the buyer | 1 | 181,390 | 4.0 s |
| Refund: nobody decides, anyone sends the timeouts | `triggerFallback`, `triggerDefault` | Refunded, price and fee to the buyer | 2 | 141,431 | 8.0 s |
| Reclaim: the seller never delivers | `reclaim` | Refunded | 1 | 83,153 | 4.0 s |

- The wall time is viem's receipt polling (every 4 s by default), not the chain: each direct call landed in the next block [measured]. On Sepolia a block takes about 12 s, so a direct early accept would settle in about 12 to 24 s [inferred], and needs test ETH in the sender's wallet: about 181,000 gas [measured on anvil].
- The refund path waits for the deadlines the terms set before anyone may send the timeouts: `deliverBy`, then the judge and fallback windows (here 86,400 s, 30 s and 30 s; anvil's clock skipped them) [measured]. On the live demo the test seller's deals set 3,600 s, 60 s and 60 s, so a refund by timeouts can start about 62 min after the offer [inferred from `examples/try.ts`, `SELLER_WINDOWS`].
- Crow's demo adjudicators run in the same process as both operators (`site/ref/limits.txt`, "Two names, one process"), so with both stopped no Crow adjudicator decides: the deal finishes by the buyer's early accept or by the timeouts. An adjudicator run by anyone else submits its signed decision directly the same way [inferred from `HoldbackRules.decide`, which checks the adjudicator's signature and never reads the sender; not measured].
- It extends `neutrality.operator-offline` (one operator offline; `fixtures/scenarios/`, on SimChain and on the contract) to both operators stopped.

### Measurement 3: the worst a leaked key can do (local anvil only)

`node scripts/metrics/pitch-evidence.mjs leak` (runs `tests/metrics/pitch-evidence-leak.test.ts`, 9 of 9 pass) [measured]. The holder has the leaked signing key and a key of its own with gas, not the party's encryption key. Each party's signing address is also its money address, as in the try command. Deals of 25 tUSDC plus a 1 tUSDC adjudication fee; each address started with the faucet's 1,000 tUSDC.

| Key | Stage | What the holder can do | What it cannot do | Largest loss |
| --- | --- | --- | --- | --- |
| Buyer | Before funding | Move the address's whole balance, with no gas at the address (ERC-3009) | Anything else: no hold exists | 1,000 tUSDC, the balance |
| Buyer | After funding | Move the rest of the balance (974); after `deliverBy`, anyone's `reclaim` returns the hold (26) to the payment address, which the holder then empties | Reclaim early (`TooEarly`), settle alone to itself or to its own address (`BadSignature`), trigger the default (`WrongStage`) | 1,000 tUSDC, what the address held |
| Buyer | After delivery | Accept early: the 25 goes to the agreed seller and the 1 fee back to the buyer; move the balance | Redirect the price, settle alone (`BadSignature`), open the work (the key is sealed to the buyer's encryption key) | 1,000 tUSDC, of which 25 reached the agreed seller for work the checks did not judge |
| Seller | Before funding | Move the address's whole balance | Anything on the deal: the buyer has not agreed | 1,000 tUSDC |
| Seller | After funding | Move the balance; deliver work of its choosing, which the agreed checks judge (work that fails them is refunded) | Accept early in the buyer's place (`BadSignature`), settle alone (`BadSignature`), trigger the default (`WrongStage`) | 1,000 tUSDC, and the deal |
| Seller | After payment | Move the balance with the price in it (1,025) | Take anything from another party's hold | 1,025 tUSDC |

No attempt moved any of a hold outside the terms: every token the holder got came from the leaked address itself [measured, the test's last check]. What the pitch's line leaves out is in the private results file.

## Decisions

- **Measurement 1 runs `examples/try.ts` as a child process,** unchanged, with `--seller` and the two live operators, so the numbers are the published command's and not a reimplementation's. Each deal is timed by its events' `at`, the operator's record; on-chain moments also keep their block.
- **A faucet refusal is waited out; any other 429 stops the series.** The faucet grants 10 new addresses per client an hour (discovery, `demo.faucet`), and with `--seller` each deal takes one grant. A refused probe from a random address reads how long the window has left and grants nothing.
- **The relayer check** reads the funding lane and the three deal lanes from discovery and the public RPC, and stops if 20 deals at 1.56 million gas each (`LANE_FLOOR`'s note in `apps/demo-cloud/src/world.ts`) and the current gas price plus a 1 gwei tip would take them below 0.3 ETH, Crow Control's low mark for the funding lane.
- **The two local measurements are anvil tests,** skipped in CI like the other anvil tests, and the script runs them with `PITCH_EVIDENCE_OUT` set. Their record schema is not in `scripts/metrics/schemas/`, which is another lane's; the record names `crow.metrics.pitch-evidence/1`.

## Handoff

Filled when the pull request opens.
