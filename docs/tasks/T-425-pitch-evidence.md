# T-425: Evidence for the machine-first pitch

- **Lane:** metrics (the pitch's missing measurements)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4 (tool code with its tests), with one kind 9 live run on Sepolia (test ETH and test tUSDC only)
- **Depends on:** the live test service on Sepolia (`https://api.crow.direct`, `https://api2.crow.direct`), Crow's test seller (`https://crow.direct/agents/test-seller`), `examples/try.ts`, and the anvil world of `examples/e2e-world.ts`
- **Paths this task may touch:** `scripts/metrics/pitch-evidence*`, `tests/metrics/pitch-evidence*`, this file. One shared line outside them: two entries in `EXEMPT` in `tests/ci-gated.test.ts`, which requires every anvil-gated test file to be named in CI's anvil job or exempted with a reason (CI's job is a tier 3 file). Scratch under `reports/scratch/t-425/` (not committed). The results go to the private repository, one new file `strategy/2026-11-14-machine-first-evidence.md`.
- **Human gate:** no. The live run makes test deals on the public test service like anyone running the try command; the operators pay its gas in test ETH. The two other measurements run on a local anvil chain only. Nothing is deployed.
- **Status:** done (pull request 544)
- **Agent/session:** the T-425 side session of 2026-11-14, worktree `.worktrees/holdback-T-425`, branch `t-425-pitch-evidence`

## Intent

The pitch says Crow is built for machines and leans on three claims that rest on one example or on reading the code: a deal goes from offer to payment in about half a minute, a deal still finishes when the operators stop, and a leaked key reaches at most what its address holds. This task turns each into a measurement anyone can rerun with one command, and writes the numbers down for the coordinator, who updates the pitch.

1. **Typical time on the live service.** Run 20 test deals one at a time, exactly as the published try command runs them, and time each from the operator's own events: offer to funding, funding to delivery, delivery to payment, offer to payment. Report the median, the minimum, the maximum and the count, and how typical the morning's 33 s deal was.
2. **A deal finished with both operators stopped.** On a local anvil chain, fund and deliver through the operators, stop both, and finish by calling the settlement contract directly; time the direct part.
3. **The worst a leaked key can do.** On anvil, for a buyer's per-deal key and for a seller's key, leaked before funding, after funding and after delivery: what the holder can and cannot do, and the largest loss in token units.

Non-goals: editing the pitch note or its page (the coordinator's); running anything against the live service except the 20 deals; a live direct-submission run (it needs a funded Sepolia wallet, Rafa's); changing the contracts, the operators or the guides.

## Acceptance criteria

- [x] `node scripts/metrics/pitch-evidence.mjs --help` describes the three measurements; each runs with one command and writes one JSON record.
- [x] Measurement 1: 20 live deals run one at a time, each with its commitment ID and its four intervals; the median, minimum, maximum and count; the relayer's test ETH read first and checked against its low mark.
- [x] Measurement 2: on anvil, a deal funded and delivered through the operators finishes with both operators stopped, by direct calls only, timed; it names the fixture it extends.
- [x] Measurement 3: on anvil, each attempt a leaked buyer or seller key can make at each stage, with what moved and the largest loss in tUSDC.
- [x] Tests for the parts that need no network (`tests/metrics/pitch-evidence.test.ts`, in CI). The two anvil tests skip where anvil or `contracts/out` is missing; CI's anvil job runs a fixed list of other files, so they run only by the commands above.
- [x] One `reviewer` pass, its findings fixed or recorded.
- [x] The private results file, with a table per measurement, each claim labelled, the commands, and three sentences for the pitch.

## Evidence

All on 2026-11-14 in the worktree, Node 22.22.2, unless labelled otherwise.

### Measurement 1: 20 live test deals

`node scripts/metrics/pitch-evidence.mjs deals --count 20` from 11:29 to 13:30 UTC: 20 of 20 deals Released, each with Crow's test seller as the other party, one at a time [measured]. Each is `examples/try.ts --seller https://crow.direct/agents/test-seller` at this branch's base (`0ed11a8a`) against `https://api.crow.direct` and `https://api2.crow.direct`; both operators served identical events for every deal [measured].

| Interval | Median | Minimum | Maximum | Deals |
| --- | --- | --- | --- | --- |
| Offer to funding | 9 s | 7 s | 20 s | 20 |
| Funding to delivery | 12 s | 12 s | 12 s | 20 |
| Delivery to payment | 12 s | 12 s | 12 s | 20 |
| **Offer to payment** | **33 s** | **31 s** | **44 s** | **20** |
| Wall time of the whole try run | 47.8 s | 44.3 s | 61.4 s | 20 |

- **Before the first deal** (11:28 UTC): the funding lane held 2.7845 ETH and the deal lanes 0.0104, 0.0292 and 0.0136 ETH, at a gas price of 17 wei. 20 deals needed at most 0.0312 ETH, leaving the funding lane far above the 0.3 ETH low mark [measured].
- **Funding, delivery and payment landed in three consecutive Sepolia blocks in all 20 deals** [measured, each deal's blocks]: funding to delivery and delivery to payment are one 12 s block each. The spread is all in offer to funding, which is 20 s when the funding missed a block (deals 4 and 6).
- **The morning's 33 s deal is typical:** 8 deals were faster (31 to 32 s), 9 took 33 s and 3 were slower (34 s, 44 s, 44 s) [measured].
- **Gas:** 828,392 to 926,348 gas a deal for its three transactions, paid by the operators [measured, the events' `gasUsed`].
- **Nothing stopped the series:** no 429 other than the faucet's and no failed deal. The faucet refused deal 11's grant at 11:37 UTC and deal 20's at 12:36 UTC (10 new addresses per client an hour); the series waited 3,098 s and 3,156 s as its answers said [measured]. Rafa then raised the limit to 50 an hour (holdback pull request 534, merged; deploy pending).

| Deal | Commitment | Started (UTC) | Offer to funding | Funding to delivery | Delivery to payment | Offer to payment |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0x8de386f24e10b8f4086ad6186c5fffc6bb816962466aa3ea1bd1a85eaaff91e5` | 11:29:05 | 8 s | 12 s | 12 s | 32 s |
| 2 | `0xac55bb9ec866ad4b19f1002152f0427027be86900ffc14ac7e9e3feab09bbff5` | 11:29:52 | 9 s | 12 s | 12 s | 33 s |
| 3 | `0x686218679bddc53ff74b83e77a55e0a1fc217484f11c0f490d0f9eb9b3614dc8` | 11:30:39 | 10 s | 12 s | 12 s | 34 s |
| 4 | `0xbe6f3c1fa3ffec49223a381d7a01081d9b0e03c5e5d4eecbdaac71a631c3ff2d` | 11:31:26 | 20 s | 12 s | 12 s | 44 s |
| 5 | `0x1eb0b860c6b168ded67bec0bfe9770fdec692ca603ac7398d696e0c2ed4d69d6` | 11:32:28 | 9 s | 12 s | 12 s | 33 s |
| 6 | `0xe87a223bb695994f7e94cda55f08802c7ab8fc88ecaa949606807ef388ce3f16` | 11:33:14 | 20 s | 12 s | 12 s | 44 s |
| 7 | `0x0151d0596f37a6048e634209347f6c64651f195cf39accb9f1eadb9abeb3db1a` | 11:34:15 | 9 s | 12 s | 12 s | 33 s |
| 8 | `0x366a7cd2fbd14ac9debefc3d952a95f71fcbe95319c1ac4252448ae4f08de4b1` | 11:35:02 | 7 s | 12 s | 12 s | 31 s |
| 9 | `0x848606b4b3238c3c4e02318431f08766fef0b63ca7cf810d1ab6a2d230590be0` | 11:35:51 | 9 s | 12 s | 12 s | 33 s |
| 10 | `0xbdf9c7d53b732752cf03a6063c1133edcc40ccdd35f06982f96b2222415503c9` | 11:36:39 | 9 s | 12 s | 12 s | 33 s |
| 11 | `0xe0dd6be5f4a053ff496a92f01c03a4e00131b7fca78a2841a961c394c338898c` | 12:29:12 | 9 s | 12 s | 12 s | 33 s |
| 12 | `0xee93d24e27c1cf07b1c8501d4512a513a2c0bb891d58afb351cbf57ddcaa484e` | 12:30:03 | 9 s | 12 s | 12 s | 33 s |
| 13 | `0xef0bcab73472cd70915033f0ef4ccc8d6be79722803365c76def36baa7187aa2` | 12:30:51 | 8 s | 12 s | 12 s | 32 s |
| 14 | `0x76e3231de13cea4d329dbb1cfaced02b67a6807f4d3f5dfe5c1a1b7a58f0509c` | 12:31:39 | 8 s | 12 s | 12 s | 32 s |
| 15 | `0x2e8db44a09f3c41495ed6d299cbbb035c7ab8918953d02244eb5bb169eae8e27` | 12:32:28 | 8 s | 12 s | 12 s | 32 s |
| 16 | `0x7534dca8f99fc59bac025d39a13a74dedcfda9eb095a1de66a1506dbaf442b34` | 12:33:18 | 9 s | 12 s | 12 s | 33 s |
| 17 | `0x309883f168134f0d35222fddddd8669710729774f0472ccae54f982cc1136c4b` | 12:34:02 | 8 s | 12 s | 12 s | 32 s |
| 18 | `0xbd623a288fdaac9c03958b7b4c1ace741e910b2df46a0feebb59a5be9006c8e3` | 12:34:51 | 9 s | 12 s | 12 s | 33 s |
| 19 | `0x5b7899de7eb0d1f23d05e1ce4470008cb561c8a228e5b1fa95107076319a8472` | 12:35:38 | 8 s | 12 s | 12 s | 32 s |
| 20 | `0x678f4800280e045a9cd6d97034da8b95526b1cbcadc3175edd8ff7fc3b414d7a` | 13:29:18 | 8 s | 12 s | 12 s | 32 s |


### Measurement 2: a deal finished with both operators stopped (local anvil only)

`node scripts/metrics/pitch-evidence.mjs direct` (runs `tests/metrics/pitch-evidence-direct.test.ts`, 4 of 4 pass) [measured]. The demo's own world (`apps/demo-cloud`) on the phase-one contracts on anvil, 1 s blocks. Each deal is funded through the operators, and delivered through them where it is delivered, with the world's passes paused so no adjudicator judges it. Then both operator nodes stop (neither URL answers), and the deal is finished by calls straight to HoldbackRules from the buyer's own key, which pays its own anvil gas.

| Path | Direct calls | Final stage | Blocks | Gas, about | Wall time of the direct part |
| --- | --- | --- | --- | --- | --- |
| Release: the buyer opens its envelope and accepts early | `earlyAccept` | Released: 25 tUSDC to the seller, the 1 tUSDC fee back to the buyer | 1 | 181,000 | 4.0 s |
| Refund: nobody decides, anyone sends the timeouts | `triggerFallback`, `triggerDefault` | Refunded: 26 tUSDC to the buyer | 2 | 141,000 | 8.1 s |
| Reclaim: the seller never delivers | `reclaim` | Refunded: 26 tUSDC to the buyer | 1 | 83,000 | 4.0 s |

- Each direct call landed in the next block [measured]. The wall time is mostly viem's receipt polling (every 4 s by default), with the simulation and the fee estimate, and for the release also opening the envelope locally. On Sepolia a block takes about 12 s, so a direct early accept would settle in about 12 to 24 s [inferred], and needs test ETH in the sender's wallet: about 181,000 gas [measured on anvil].
- The refund path waits for the deadlines the terms set before anyone may send the timeouts: `deliverBy`, then the judge and fallback windows (here 86,400 s, 30 s and 30 s; anvil's clock skipped them) [measured]. try.ts accepts at most 3,600 s, 60 s and 60 s from the test seller (`SELLER_WINDOWS`), so on the live demo a refund by timeouts starts at most about 62 min after the offer [inferred].
- Crow's demo adjudicators run in the same process as both operators (`site/ref/limits.txt`, "Two names, one process"), so with both stopped no Crow adjudicator decides: the deal finishes by the buyer's early accept or by the timeouts. An adjudicator run by anyone else submits its signed decision directly the same way [inferred from `HoldbackRules.decide`, which checks the adjudicator's signature and never reads the sender; not measured].
- It extends `neutrality.operator-offline` (one operator offline; `fixtures/scenarios/`, on SimChain and on the contract) to both operators stopped.

### Measurement 3: the worst a leaked key can do (local anvil only)

`node scripts/metrics/pitch-evidence.mjs leak` (runs `tests/metrics/pitch-evidence-leak.test.ts`, 13 of 13 pass) [measured]. The holder has the leaked signing key and a key of its own with gas, not the party's encryption key. Deals of 25 tUSDC plus a 1 tUSDC adjudication fee. Two shapes: the try command's, where each party's signing address is also its money address and starts with the faucet's 1,000 tUSDC; and ADR-0033's per-deal key, where the signing keys hold nothing and the deal names a payment address and a payout address the holder does not have.

**The try command's keys (signing address = money address):**

| Key | Stage | What the holder can do | What it cannot do | Largest loss |
| --- | --- | --- | --- | --- |
| Buyer | Before funding | Move the address's whole balance, with no gas at the address (ERC-3009) [measured]; agree to and fund offers, up to the balance [inferred] | Reach any money but the address's | 1,000 tUSDC, the balance |
| Buyer | After funding | Move the rest of the balance (974 tUSDC); after `deliverBy`, anyone's `reclaim` returns the hold (26 tUSDC) to the payment address, which the holder then empties | Reclaim early (`TooEarly`), settle alone to itself or to the holder (`BadSignature`), trigger the default (`WrongStage`) | 1,000 tUSDC, what the address held |
| Buyer | After delivery | Accept early: 25 tUSDC to the agreed seller and the 1 tUSDC fee back to the buyer; move the balance | Redirect the price, settle alone (`BadSignature`); open the work, whose key is sealed to the buyer's encryption key [inferred, not tried] | 1,000 tUSDC, of which 25 tUSDC reached the agreed seller for work the checks did not judge |
| Seller | Before funding | Move the address's whole balance | Anything on the deal: the buyer has not agreed | 1,000 tUSDC |
| Seller | After funding | Move the balance; deliver work of its choosing: work that fails the checks is refunded, work that passes them is paid to the payout address, the leaked one | Accept early in the buyer's place (`BadSignature`), settle alone (`BadSignature`), trigger the default (`WrongStage`) | 1,025 tUSDC, the balance plus the price its deal pays that address under its terms |
| Seller | After payment | Move the balance with the price in it | Take anything from another party's hold | 1,025 tUSDC |

**ADR-0033's per-deal keys (money addresses apart):**

| Key | Stage | What the holder can do | What it cannot do | Largest loss |
| --- | --- | --- | --- | --- |
| Buyer | Before funding | Nothing with money: the key holds 0 tUSDC | Fund a deal with the payment address's money: a funding it signs itself reverts (`TestUSDC: invalid signature`) | 0 tUSDC |
| Buyer | After funding | Nothing with money | Settle alone, to the holder or to the payment address (`BadSignature`) | 0 tUSDC |
| Buyer | After delivery | Accept early: the payment address pays this deal's 25 tUSDC price to the agreed payout address, and gets the 1 tUSDC fee back | Take any of it | 25 tUSDC, one deal's price, paid to the agreed seller for unjudged work (ADR-0033's bound, "P + F plus the operator fee, for this one deal") |
| Seller | After funding and payment | Deliver work of its choosing; the price of work that passes goes to the payout address | Take the price, which never reaches the key; settle alone (`BadSignature`) | 0 tUSDC to the holder; the deal, if it delivers failing work |

- No attempt moved any of a hold outside the terms. The holder's own address gained exactly the sum of the drains of leaked addresses, 6,000 tUSDC, read from the chain [measured, the test's last check].
- Not tried, each bounded the same way, by what the leaked address holds [inferred from reading the token and the contract]: `receiveWithAuthorization`; an EIP-2612 permit; a Permit2 transfer (`TestUSDC` gives Permit2 an unlimited allowance); `agreeAndFund` on terms the holder writes itself; `cancelAuthorization`, which can only stop a funding. `decide` needs the adjudicator's signature, which neither key is.
- What the pitch's line leaves out is in the private results file.

### Review

**Reviewer pass, 2026-11-14 (the `reviewer` agent): ISSUES, nothing blocking.** Three Medium, all fixed: a faucet refusal after a busy test seller led to a wait instead of a stop (`nextStep`, now a test); the seller's key delivering work that passes the checks was not measured (now a row: 1,025 tUSDC, not 1,000); ADR-0033's per-deal key with its money apart was not measured (now four tests). Low, fixed: a circular final check (now a balance read from the chain), the relayer check counting the deal lanes, the short-ID regex, a timed-out run reported as an ordinary failure, the faucet probe's possible grant (now in Decisions), a race between the operators' own timeouts and the clock warp, and the task file's wording. Info, recorded above: the attempts not made. The reviewer suggested a second review by another model family for measurement 3; `docs/team.md` runs one only when Rafa asks, so it is in the Handoff.

## Decisions

- **Measurement 1 runs `examples/try.ts` as a child process,** unchanged, with `--seller` and the two live operators, so the numbers are the published command's and not a reimplementation's. Each deal is timed by its events' `at`, the operator's record; on-chain moments also keep their block.
- **A faucet refusal is waited out; any other 429 stops the series.** The faucet grants 10 new addresses per client an hour (discovery, `demo.faucet`), and with `--seller` each deal takes one grant. A refused probe from a random address reads how long the window has left and grants nothing.
- **The relayer check** reads the funding lane and the three deal lanes from discovery and the public RPC, once before the series. It stops if 20 deals at 1.56 million gas each (`LANE_FLOOR`'s note in `apps/demo-cloud/src/world.ts`), at the current gas price plus a 1 gwei tip, would take the funding lane alone below 0.3 ETH. The deal lanes refill from the funding lane and never pay back, so they are reported, not counted. The 0.3 ETH is Crow Control's low mark for the funding lane, marked guessed where it is set (the console's wallet list in the private repository); `--low-eth` changes it.
- **A faucet probe can be granted.** If the client's window has just reset, the probe from a random address gets 1,000 test tUSDC that nobody holds, and costs one grant and one relayer mint. That is test money only; the series then runs the deal at once.
- **A faucet refusal after the test seller was unavailable stops the series.** try.ts then plays both sides and asks for a second grant; the series stops on the seller's answer instead of waiting (the reviewer's finding 1).
- **The two local measurements are anvil tests,** which CI does not run, and the script runs them with `PITCH_EVIDENCE_OUT` set. Their record schema is not in `scripts/metrics/schemas/`, which is another lane's; the record names `crow.metrics.pitch-evidence/1`.

## Handoff

**Done:** the three measurements, their script and tests, and the private results file (crow-private `strategy/2026-11-14-machine-first-evidence.md`), which also says where the pitch's line on leaked keys needs correcting.

**Waits for Rafa:**
- **A live direct-submission run,** with test ETH in a wallet of his: about 181,000 gas for one early accept sent straight to HoldbackRules on Sepolia, on a deal with a long `judgeBy` so the operators' own adjudicator does not decide first.
- **The operators' deploy** that carries the faucet's 50 an hour (pull request 534): until then a 20-deal series waits out the hour after every 10 deals.
- **A second-family review of measurement 3,** if he wants one (the reviewer's suggestion).

**For the coordinator:** the three numbers and the three pitch sentences are in the private results file; this task edits neither the pitch note nor its page.

**Follow-ups not built** (for the triage note): publish the seller's payout address in its agent card and have the try command and the buyer's tools check it; the try command's closing hint should read `demo.faucet.perClientPerWindow` from discovery at the next planned `try.mjs` change; the anvil tests of this task in CI's anvil job.
