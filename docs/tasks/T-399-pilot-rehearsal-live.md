# T-399: the pilot's cases rehearsed on the live phase-one deployment

- **Lane:** demo (examples), test; checklist item 11 of the testnet-ready list (Rafa, 2026-11-12)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 10 (a live rehearsal and its report), from the Change recipes in `docs/team.md`; code fixes, if any, go in their own pull requests of their own kind
- **Depends on:** the switch-over to the phase-one contracts (T-383, live since 2026-11-13); T-355 (the rehearsal tool `pnpm audit-deal`); T-387 (the pilot kit follows phase one); T-390 (late work and the postdated-offer stop); T-393 (the short guides and `site/buy.mjs`)
- **Paths this task may touch:** this file; outputs under `reports/pilot-rehearsal-2026-11-13/` (not committed); scratch under `reports/scratch/t-399/` (not committed). A fix of a few lines in `examples/`, `site/` or the guides goes in its own pull request. Never: `contracts/`, the operators, settlement, judgment or auth code, tier-3 files.
- **Human gate:** live deals on the public test service with test tokens only, on Rafa's word of 2026-11-13 ("Go ahead on these"). No deploy. Nothing is sent to anyone outside.
- **Status:** done (this pull request)
- **Agent/session:** the T-399 session, 2026-11-13, branch `t-399-pilot-rehearsal-live`

## Intent

**Why.** The pilot is a loop on the test network: an agent buys a security audit from another agent through Crow, with test money. Until today every case of the pilot ran only on a local world: a simulated chain with its own clock and stand-in judges. The live service has run the phase-one contracts on Sepolia since 2026-11-13. Before the pilot starts, Crow wants to see each case end as the kit says it should on that live service, with real blocks, real gas and the published buyer file.

**Goal.** Two things, in order:

1. **The buyer's first hour from the site alone.** Start in an empty folder, as a new buyer's agent would, with nothing but `https://crow.direct/llms.txt`, `buy.txt` and the install line that downloads `buy.mjs` and checks its SHA-256. Buy one audit to Released. Count the commands, the wrong calls, the approvals a person must give and the minutes. A step the guides do not cover is a finding, with the guide's line quoted.
2. **The eleven cases on the live service, one deal at a time.** Each ends as the kit's local evidence says, or the report says exactly why the live service cannot stage it and what the nearest live proof is.

| # | Case | What happens | Expected end |
| --- | --- | --- | --- |
| 1 | `released` | The report passes the checks; the seller is paid | Released |
| 2 | `redelivered` | The seller's check run refuses a first report and alerts the seller; the fixed report is delivered before the deadline | Released |
| 3 | `rubric` | The terms carry a rubric; the report passes the checks and the panel | Released |
| 4 | `refunded` | The panel rejects the report after delivery | Refunded |
| 5 | `missed-deadline` | The seller never delivers; the buyer reclaims the hold after the deadline | Refunded |
| 6 | `shown-mismatch` | What the operators serve at signing differs from what the buyer was shown; the buyer's signer refuses | Not funded |
| 7 | `resume` | The buyer stops after funding and resumes later from its key store | Released |
| 8 | Two money addresses | The buyer pays from a payment address apart from its signing key, signed outside the buyer tool by `cast` from a throwaway wallet file; the seller is paid at a payout address | Released; the payout address receives the price |
| 9 | Late work | The deadline passes with no delivery on record; the parties settle through the API; the buyer opens the work with `resume --delivery` | Settled |
| 10 | The approval stop | With the expected terms the buyer's command stops on any difference and goes on when the terms match | Stops, then Released |
| 11 | A postdated offer | A seller dates its offer five years ahead; the buyer's command stops | Stops; nothing paid |

**Sellers.** Each case names its seller in the Evidence: the test seller at `https://crow.direct/agents/test-seller`, or a seller run from this repository (the seller adapter, or a scripted seller) against the live operators. The pilot's own seller is not live, so no case uses it.

**Non-goals.**
- No fix in settlement, judgment, auth or the operators: a bug there is a report.
- No faked case. A case the live service cannot stage gets a stated reason and the nearest live proof.
- Nothing about the pilot's counterparty in this file, in a pull request or in a public artifact. The pilot kit and its evidence are private.

## Acceptance criteria

- [x] The first-hour purchase ran from an empty folder with the published files only, and ended Released; its cost is counted (commands, wrong calls, approvals, minutes).
- [x] Every case has a live result or a stated reason it cannot be staged live, with the nearest live proof.
- [x] Every live deal has: the commitment ID, the final state, its transactions with Sepolia links, the seconds from funding to the final state, the gas, what the buyer paid and what the seller received, and whether the buyer's deal record verifies.
- [x] The outputs are saved under `reports/pilot-rehearsal-2026-11-13/`.
- [x] The private kit's evidence holds the live results beside the local ones, dated, committed to the private repository.
- [x] Each finding is reported: a bug that stops a case, with the smallest reproduction; a small tool or guide fix, proposed or made as its own pull request.

## Evidence

All measured on 2026-11-13 between 08:13 and 09:34 UTC on the live service: operators `https://api.crow.direct` and `https://api2.crow.direct`, Sepolia (chain 11155111), the phase-one contracts of `contracts/deployments/sepolia.json`, the token tUSDC. The repository's tools ran from a worktree at `origin/main` `15fedc8`; the buyer's commands ran from `buy.mjs` as `https://crow.direct/buy.mjs` served it (SHA-256 `d1ad3381…2789`, the hash in `buy.txt`'s install line). Gas and times are read from Sepolia (`cast receipt`, block timestamps); money from the token's Transfer logs. The outputs, the deal records and one summary per deal are in `reports/pilot-rehearsal-2026-11-13/` (not committed). Every key is a throwaway test key made for this run and kept under `reports/scratch/t-399/` (not committed).

### The sellers

- **No audit seller is published on the site.** Crow's test seller sells a CSV through a sealed intake, which `buy.mjs`'s quote path does not take (`buy.txt`, step 2: "A card with an `intake` instead takes a sealed proposal"). The pilot's own seller is not live.
- **So every case used a seller run from this repository on this machine, against the live operators:**
  - the seller adapter (`examples/seller-adapter.ts`) with its public audit template and the public stub job API (`examples/seller-adapter-stub.ts`, the sample report of `fixtures/data/audit-report/`), started by a scratch launcher with a quote address on `127.0.0.1`; or `pnpm audit-deal --live`, which starts the same pair in process;
  - for cases 4 and 11, a scripted seller built on `examples/agent.ts`, for behaviour the adapter never produces (a delivery that fails a check; an offer dated years ahead).
- **The pilot kit's own terms and sample report stayed local.** Live terms are readable on the public operators, and the kit's checks are written for one seller's own report format. The live cases use the public template and sample report instead.

### Step 1: the buyer's first hour from the site alone

From an empty folder with `llms.txt` (6,297 bytes) and `buy.txt` (12,882 bytes), and no copy of the repository: **Released.**

| Measure | Value |
| --- | --- |
| Deal | `0x74a7504281a1b47f4865df680d13d0867380908578075f58f373d755d0c3fa34`, Released |
| Time | 3 min 39 s from the first fetch (08:13:33) to Released (08:17:12); 24 s from funding to Released |
| Commands | 5: the install line, reading the seller's defaults, the quote, the approve, the record |
| Wrong calls | 0 |
| Approvals a person gives | 2: the install command, and the approve after reading the offer |
| Reference files needed | 0 |
| Money | the buyer paid 551.00 tUSDC (price 550.00, adjudication fee 1.00, operator fee 0); the seller received 550.00; the primary adjudicator 1.00 |
| Gas | funding 569,792; delivery 174,048; decision with release 170,904 |
| The record (`buy.mjs record`) | 15 checks passed, 0 failed, 4 not run; both operators agree |

The install line printed `buy.mjs.part: OK`. The stop showed one difference from the seller's defaults (`deadlines.deliverWithinSec 604800 -> 172800`) and the approve line; the approve funded and followed the deal to Released and opened the 5,086-byte report.

### The cases

| # | Case | Seller | Expected | Got (live) | Deal | Funding to end | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `released` | adapter in process (`audit-deal --live`) | Released | **Released** | `0xc5775f4a…7daa` | 24 s | Seller paid 2,000.00 tUSDC; buyer opened the 4,938-byte report |
| 2 | `redelivered` | adapter in process | Released | **Released** | `0x0cdb62a7…32de` | 24 s | The adapter refused the first report (`coverage`), sent a signed `delivery.refused` alert, took the ready signal (202), delivered the fixed report and sent `delivery.fixed` |
| 3 | `rubric` | adapter in process | Released | **Released** | `0x25b6b7c3…bd3d` | 36 s | The live panel accepted: "3 of 3 valid verdicts pass, from 2 families", weighted score 370 |
| 4 | `refunded` | scripted seller (`examples/agent.ts`) | Refunded | **Refunded** | `0xf6eea366…d39a` | 24 s | Delivered a report that leaves out one file in scope; the adjudicator's required `coverage` check refused it; buyer got 550.00 back, adjudicator kept 1.00. Nearest live proof: a judged refund by the checks, since a live panel's reject cannot be forced |
| 5 | `missed-deadline` | adapter, a 600 s delivery window, the job never finishes | Refunded | **Refunded**, `reclaimed: true` | `0x696c3350…1bd6` | 612 s | The buyer's tool reported `deliverBy-passed` and sent the reclaim; the whole 551.00 came back 43 s after the deadline |
| 6 | `shown-mismatch` | adapter, behind a local front that raises the operator fee after the stop | Not funded | **Not funded** | `0x0a7ed5fd…efb5` (stays Offered) | none | `refusing to sign: fees.operator is {"amount":"5500000",…}, not the shown {"amount":"0",…}`; no faucet call, buyer key at 0 tUSDC. The live operators charge 0 and do not change it, so a local stand-in for a dishonest operator served the change |
| 7 | `resume` | adapter, restarted from its journal mid-deal | Released | **Released** | `0xf2d40424…4395` | 36 s | Buyer funded with `--stop-after-funding` and exited; the adapter restarted and started no second job; `resume deal-7` opened the work. Minutes, not days, passed |
| 8 | Two money addresses | adapter with a payout address | Released; the payout address paid | **Released** | `0x7e220ec2…ace4` | 36 s | One funding file (`ReceiveWithAuthorization` under the token's domain); `pay check` ok; `cast wallet sign --data --from-file` with `--keystore` signed it; the wallet paid 551.00, the payout address received 550.00, both signing keys moved 0 |
| 9 | Late work | adapter, a 600 s window, the job never finishes | Settled | **Settled** | `0x70cc2b24…2bd3` | 600 s | Settled 23 s after `deliverBy` by a settlement both sides signed (the kit's late-work script); the payout address received 550.00, the buyer the 1.00 fee; `resume <store> <ID> --delivery` opened 5,098 bytes whose SHA-256 equals the delivery's; record 15 of 15. Finding 1 below |
| 10 | The approval stop with expected terms | adapter | Stops on a difference; funds when they match | **Stopped, then Released** | stop `0xe30c9c0a…5abf`; funded `0x1fc52210…7556` | 36 s | A file with a 259,200 s window stopped: "1 difference from your terms: deadlines.deliverWithinSec"; the matching file funded and followed to Released in one run, no approval stop |
| 11 | A postdated offer | scripted seller dating offers 157,766,400 s (5 years) ahead | Stops; nothing paid | **Stopped**, exit 3 | `0x41e1508f…4f86` (stays Offered) | none | The live operators accepted the offer (`createdAt` 2031-11-13). With matching expected terms: "0 differences from your terms; against the clock: createdAt"; no file to sign, no faucet call, key at 0 tUSDC |

**Result: all eleven cases end as the kit expects on the live service.** Cases 4 and 6 are staged with a stand-in (a scripted seller; a local front for a dishonest operator), as the rows say. Cases 5 and 9 use a 600 s delivery window instead of days; the deadline passed in real time on Sepolia.

### Each funded deal

From each buyer's deal record (`buy.mjs record`, or the tool's own for cases 1 to 3) and Sepolia. In every deal the buyer's money went to the escrow's collector `0x959c…e3ef` and on to the hold `0x6917…ada0`; the 1.00 tUSDC adjudication fee went to the primary adjudicator `0xa909…23ed` on a decision. No operator fee moved. "Not run" checks: the delivery hash and the seller's delivery signature need `--delivery`, the plain report's hash needs a released key, and on Sepolia the operators' events carry no postings (`examples/deal-record.ts`, line 400), so the two postings checks do not run and `row.paidTo` is null except on the settled deal. The transfers above take their place.

**Step 1, the first hour**: `0x74a7504281a1b47f4865df680d13d0867380908578075f58f373d755d0c3fa34`, Released.
- transaction 1: 569,792 gas, block 12124715, https://sepolia.etherscan.io/tx/0xcbed74a97ac19eee1a8729d66268bb820863d27e1d338650e8bfef5e93e3925a
  - 551.00 tUSDC from `0xe781fca4ce77c4be3b2944589bf3fa7cbd061440` to `0x959ca9929ea2c47c6390199ab07639f307c0e3ef`
  - 551.00 tUSDC from `0x959ca9929ea2c47c6390199ab07639f307c0e3ef` to `0x69178a8112293f80f9f7b0db124a2c64aa31ada0`
- transaction 2: 174,048 gas, block 12124716, https://sepolia.etherscan.io/tx/0x5c0ec239e7654354d07bbccc18ac6bf236cb232119400e9e92561a7084ef9571
- transaction 3: 170,904 gas, block 12124717, https://sepolia.etherscan.io/tx/0x3a35c4b3f8653e5889aa1f705d0082974048e5b9d92f18c1b7e25d22e28cc641
  - 1.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0xa909f87a64fbe6982c838c1c1bf2973cda7823ed`
  - 550.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0x0d6549ca3b55ceeef9f1cf06cac256ede68201e1`
- funding to the final state: 24 s (block timestamps)
- the buyer's deal record: 15 passed, 0 failed, 4 not run (delivery hash; seller's delivery signature; postings conserve the hold; postings follow the outcome); disagreements []

**Case 1, released**: `0xc5775f4a19a6c5b1a6d738255ac5354ac034881bdcc6250d9a2a190ae3f67daa`, Released.
- transaction 1: 569,792 gas, block 12124728, https://sepolia.etherscan.io/tx/0xcbff76d3692c2708d0dc10e32761816cc7e9505ca7c0499c9e1db84e947f71b7
  - 2,001.00 tUSDC from `0x76786e0874243680df63397d82940004ece3079c` to `0x959ca9929ea2c47c6390199ab07639f307c0e3ef`
  - 2,001.00 tUSDC from `0x959ca9929ea2c47c6390199ab07639f307c0e3ef` to `0x69178a8112293f80f9f7b0db124a2c64aa31ada0`
- transaction 2: 174,012 gas, block 12124729, https://sepolia.etherscan.io/tx/0x250c1b6e868c702ae46690909207b1abcbaeab505d0457b1e1c99d1fb1d2871b
- transaction 3: 170,904 gas, block 12124730, https://sepolia.etherscan.io/tx/0x3790d617d3e0b73fed546ea59c5f49047ccc1abc2ad1549b99fd1df6199d428e
  - 1.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0xa909f87a64fbe6982c838c1c1bf2973cda7823ed`
  - 2,000.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0xd3f24d4328390a790409ee50b863c375e3c7b9c7`
- funding to the final state: 24 s (block timestamps)
- the buyer's deal record: 15 passed, 0 failed, 4 not run (delivery hash; seller's delivery signature; postings conserve the hold; postings follow the outcome); disagreements []

**Case 2, redelivered**: `0x0cdb62a7f614e96be63167b30267f72f3a1bc05b42fb4d526f992807b69d32de`, Released.
- transaction 1: 569,816 gas, block 12124736, https://sepolia.etherscan.io/tx/0xeb4d60c8042c594a2979a7101517dc01aa67935f35b454ceaa2d4ecd62c2cacf
  - 2,001.00 tUSDC from `0x8941d24d5c4d5e665550029ccdecafa58e686ccf` to `0x959ca9929ea2c47c6390199ab07639f307c0e3ef`
  - 2,001.00 tUSDC from `0x959ca9929ea2c47c6390199ab07639f307c0e3ef` to `0x69178a8112293f80f9f7b0db124a2c64aa31ada0`
- transaction 2: 174,036 gas, block 12124737, https://sepolia.etherscan.io/tx/0x698a2f1fe78ec0302620e82ad24ccbac8c8d0b5aaa1659e50c5997d4167a08cf
- transaction 3: 170,904 gas, block 12124738, https://sepolia.etherscan.io/tx/0xdab72139fc77637690ebf092346b37dc92f2a3c068466fb0c7697c3ae0b9ce7c
  - 1.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0xa909f87a64fbe6982c838c1c1bf2973cda7823ed`
  - 2,000.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0xba5d290b6e1c9eb2480ba9fc4b239d27f428f85c`
- funding to the final state: 24 s (block timestamps)
- the buyer's deal record: 15 passed, 0 failed, 4 not run (delivery hash; seller's delivery signature; postings conserve the hold; postings follow the outcome); disagreements []

**Case 3, rubric**: `0x25b6b7c3bff882fb1505926598cb800acab6a4a334b9dae5ae3ef5c7f3b6bd3d`, Released.
- transaction 1: 569,768 gas, block 12124744, https://sepolia.etherscan.io/tx/0x65c1556eabc5e308ccc272275e80148e331657b47932d75904913779f7c21a97
  - 2,001.00 tUSDC from `0x91765437d8de6120b3a181ae9b02d59d1e47be09` to `0x959ca9929ea2c47c6390199ab07639f307c0e3ef`
  - 2,001.00 tUSDC from `0x959ca9929ea2c47c6390199ab07639f307c0e3ef` to `0x69178a8112293f80f9f7b0db124a2c64aa31ada0`
- transaction 2: 174,036 gas, block 12124745, https://sepolia.etherscan.io/tx/0x65633d9e526a4cf99a7955da9d3c7b80b09715db0c18da236d33cf155b58c59b
- transaction 3: 170,904 gas, block 12124747, https://sepolia.etherscan.io/tx/0xdf9c6519ced566896e47df798a5fff4dd8bf746a618a0391f7e6cbf0df31bcd5
  - 1.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0xa909f87a64fbe6982c838c1c1bf2973cda7823ed`
  - 2,000.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0x2d38ee8b3e7a90ee0e7b5c90f7fe90d90e1a55aa`
- funding to the final state: 36 s (block timestamps)
- the buyer's deal record: 15 passed, 0 failed, 4 not run (delivery hash; seller's delivery signature; postings conserve the hold; postings follow the outcome); disagreements []

**Case 4, refunded (the clean run)**: `0xf6eea366b2f73ceff399eb285190a3451b4b37d634893fdcecac142374cbd39a`, Refunded.
- transaction 1: 569,804 gas, block 12125098, https://sepolia.etherscan.io/tx/0xf468a1b18227e0fe2767f28f1baa5921c4f393c703bdb9682c72b947bc031e34
  - 551.00 tUSDC from `0x6681bfa993873ec356d6e0f611e1954c894045e6` to `0x959ca9929ea2c47c6390199ab07639f307c0e3ef`
  - 551.00 tUSDC from `0x959ca9929ea2c47c6390199ab07639f307c0e3ef` to `0x69178a8112293f80f9f7b0db124a2c64aa31ada0`
- transaction 2: 174,048 gas, block 12125099, https://sepolia.etherscan.io/tx/0x4e7660cf116890b2b514372a4db7788ee631b07c5636a02b70a783866733b899
- transaction 3: 257,328 gas, block 12125100, https://sepolia.etherscan.io/tx/0xa4d72e5aabac9f2c7917ada32e5d4e9a4db15334d80c513ee60031eb73140a79
  - 1.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0xa909f87a64fbe6982c838c1c1bf2973cda7823ed`
  - 550.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0x6681bfa993873ec356d6e0f611e1954c894045e6`
- funding to the final state: 24 s (block timestamps)
- the buyer's deal record: 14 passed, 0 failed, 5 not run (plaintext sha256; delivery hash; seller's delivery signature; postings conserve the hold; postings follow the outcome); disagreements []

**Case 4, refunded (first run; the scratch seller left its checks unfilled)**: `0x95df6e081a7e37d736ef590e54ad7937ec06cf480ae7b9f0fed169bfbdc429a1`, Refunded.
- transaction 1: 569,816 gas, block 12124755, https://sepolia.etherscan.io/tx/0x57f3821ffc50a812a790e3cba6eeb178a9c4cbdd1f98ea26e95c9fd487bde85e
  - 551.00 tUSDC from `0x922c228cef55b7a404c3439ba22f55e454cfea7d` to `0x959ca9929ea2c47c6390199ab07639f307c0e3ef`
  - 551.00 tUSDC from `0x959ca9929ea2c47c6390199ab07639f307c0e3ef` to `0x69178a8112293f80f9f7b0db124a2c64aa31ada0`
- transaction 2: 174,036 gas, block 12124756, https://sepolia.etherscan.io/tx/0xe76f548e2e5d77a4756ce004e2582d5c9fd78fedb7b3dc54e873c07265022189
- transaction 3: 257,340 gas, block 12124757, https://sepolia.etherscan.io/tx/0x8393d3679def2dfc9fd8797a95ee6ad2c3b2f7b4dd937ee2f6bda1e0f1d5e104
  - 1.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0xa909f87a64fbe6982c838c1c1bf2973cda7823ed`
  - 550.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0x922c228cef55b7a404c3439ba22f55e454cfea7d`
- funding to the final state: 24 s (block timestamps)
- the buyer's deal record: 14 passed, 0 failed, 5 not run (plaintext sha256; delivery hash; seller's delivery signature; postings conserve the hold; postings follow the outcome); disagreements []

**Case 5, missed deadline**: `0x696c3350a9205f37249773d134d2361be5eac16ec8cd854c8175a7feb0391bd6`, Refunded.
- transaction 1: 569,792 gas, block 12124764, https://sepolia.etherscan.io/tx/0xf40b0b8ea2984817402ff2638b3aceac96a43c22771289d979a6f7a27c3894c5
  - 551.00 tUSDC from `0xafe607cc6b720a902687ee921e31780bbeb99345` to `0x959ca9929ea2c47c6390199ab07639f307c0e3ef`
  - 551.00 tUSDC from `0x959ca9929ea2c47c6390199ab07639f307c0e3ef` to `0x69178a8112293f80f9f7b0db124a2c64aa31ada0`
- transaction 2: 198,805 gas, block 12124815, https://sepolia.etherscan.io/tx/0x7b503d78b6154077940f2ca3a1d69ed6a255f5343e8563efae58e03212657322
  - 551.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0xafe607cc6b720a902687ee921e31780bbeb99345`
- funding to the final state: 612 s (block timestamps)
- the buyer's deal record: 10 passed, 0 failed, 2 not run (postings conserve the hold; postings follow the outcome); disagreements []

**Case 7, resume**: `0xf2d40424c1ac7d9ff23debc82e19752fa7d0eb80cea4953f469ed904f2e14395`, Released.
- transaction 1: 569,816 gas, block 12124820, https://sepolia.etherscan.io/tx/0x01eadeea73291a7fce7106324e64df51a3be41f184c1518efac6a4b0562d0a51
  - 551.00 tUSDC from `0x8d0f011af332ac9d86bfedfb4de113b24edae301` to `0x959ca9929ea2c47c6390199ab07639f307c0e3ef`
  - 551.00 tUSDC from `0x959ca9929ea2c47c6390199ab07639f307c0e3ef` to `0x69178a8112293f80f9f7b0db124a2c64aa31ada0`
- transaction 2: 174,048 gas, block 12124822, https://sepolia.etherscan.io/tx/0xcf919d5f6dabf6e11e45ab6b563acd837e697c6d0f18080c8ac2fb6b9deaccaa
- transaction 3: 170,904 gas, block 12124823, https://sepolia.etherscan.io/tx/0x6b56a3b634861ed7105d8951bf8d895319c1372ee4058acb8c47ce9c795578bd
  - 1.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0xa909f87a64fbe6982c838c1c1bf2973cda7823ed`
  - 550.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0x0d6549ca3b55ceeef9f1cf06cac256ede68201e1`
- funding to the final state: 36 s (block timestamps)
- the buyer's deal record: 15 passed, 0 failed, 4 not run (delivery hash; seller's delivery signature; postings conserve the hold; postings follow the outcome); disagreements []

**Case 8, two money addresses**: `0x7e220ec267ef0932f200a439d6e05f54ccdf2a94e58068b985e90ecee05dace4`, Released.
- transaction 1: 572,680 gas, block 12124829, https://sepolia.etherscan.io/tx/0xc60634d06b2ed84c68854fe91c1d08563d871074a81a67a3ac8775c74e7b765c
  - 551.00 tUSDC from `0x328169b4c8c84ebbb6f014ec13d0d19260e9a6e5` to `0x959ca9929ea2c47c6390199ab07639f307c0e3ef`
  - 551.00 tUSDC from `0x959ca9929ea2c47c6390199ab07639f307c0e3ef` to `0x69178a8112293f80f9f7b0db124a2c64aa31ada0`
- transaction 2: 174,012 gas, block 12124831, https://sepolia.etherscan.io/tx/0x8883d206092b9c6d023c2f4213b6535c13df206f008e9fbe22a600bf4f81cfca
- transaction 3: 259,861 gas, block 12124832, https://sepolia.etherscan.io/tx/0xc4b80fad4641a5276d353b0e3733f0d75fd2f5e36fe9ce60e952015b25c96adb
  - 1.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0xa909f87a64fbe6982c838c1c1bf2973cda7823ed`
  - 550.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0x5f1c6b0c616b61aff7498de312dc82cc6c9b9aaa`
- funding to the final state: 36 s (block timestamps)
- the buyer's deal record: 15 passed, 0 failed, 4 not run (delivery hash; seller's delivery signature; postings conserve the hold; postings follow the outcome); disagreements []

**Case 9, late work**: `0x70cc2b24d707a02df351ecca7b9b6ad9eb6907e1c8755b82fc794bede4d32bd3`, Settled.
- transaction 1: 569,816 gas, block 12125030, https://sepolia.etherscan.io/tx/0xd5397a58e7a263b442ce9fc5f9989a5a6556bc8dd11697133106be835fb82103
  - 551.00 tUSDC from `0xbe83606671d493fbf984a6fb96ef2615be4051ba` to `0x959ca9929ea2c47c6390199ab07639f307c0e3ef`
  - 551.00 tUSDC from `0x959ca9929ea2c47c6390199ab07639f307c0e3ef` to `0x69178a8112293f80f9f7b0db124a2c64aa31ada0`
- transaction 2: 272,170 gas, block 12125079, https://sepolia.etherscan.io/tx/0x762dc45849d94d59e918b7d16604bff45935a1a48b19857adcd408f37420416b
  - 550.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0x5f1c6b0c616b61aff7498de312dc82cc6c9b9aaa`
  - 1.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0xbe83606671d493fbf984a6fb96ef2615be4051ba`
- funding to the final state: 600 s (block timestamps)
- the buyer's deal record: 15 passed, 0 failed, 0 not run (); disagreements []

**Case 10, the expected terms, funded**: `0x1fc52210ced28312e037dab5794b4670c76c76891c5c2dfed0f6dc6074cf7556`, Released.
- transaction 1: 569,780 gas, block 12125088, https://sepolia.etherscan.io/tx/0x18332d82e89ea7c67f370126e76b9187f3264744779c7b6124b046ca17c0757d
  - 551.00 tUSDC from `0xad90ec1c402a426dd506f61d2d97679eff10c339` to `0x959ca9929ea2c47c6390199ab07639f307c0e3ef`
  - 551.00 tUSDC from `0x959ca9929ea2c47c6390199ab07639f307c0e3ef` to `0x69178a8112293f80f9f7b0db124a2c64aa31ada0`
- transaction 2: 174,036 gas, block 12125089, https://sepolia.etherscan.io/tx/0xd4c9cdda1d3e68ceaa62a0e120a36bcb818f2833db2607bacf4a932e8a1d6011
- transaction 3: 170,904 gas, block 12125091, https://sepolia.etherscan.io/tx/0x7dacb9a0b8587ff3406f682688946f295e8e6f4e5f38dc996431bd6c7621c223
  - 1.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0xa909f87a64fbe6982c838c1c1bf2973cda7823ed`
  - 550.00 tUSDC from `0x69178a8112293f80f9f7b0db124a2c64aa31ada0` to `0x0d6549ca3b55ceeef9f1cf06cac256ede68201e1`
- funding to the final state: 36 s (block timestamps)
- the buyer's deal record: 15 passed, 0 failed, 4 not run (delivery hash; seller's delivery signature; postings conserve the hold; postings follow the outcome); disagreements []



### Findings

1. **Low · fixed in pull request 490 (`t-399-resume-delivery-hint`), not deployed.** After a first `resume` saved a late-work deal's `Settled` outcome, `node buy.mjs resume deal-9 --delivery late-delivery.json`, the form `buy.txt` step 7 gave ("add `--delivery <file>`"), printed nothing and exited 0. Naming the commitment ID opened the work. The fix names the ID in the settled note and in step 7, and has an empty `resume` say there is no open deal. A site deploy is owed for it (Rafa's word).
2. **Info · the faucet bounds a rehearsal, not a pilot.** The faucet grants one client 10 addresses an hour (`demo.faucet.perClientPerWindow`). Each `audit-deal --live` case takes two grants (a fresh buyer and a fresh seller), and each `buy.mjs` deal one. At 08:40 UTC the 11th grant answered 429 with `Retry-After` 2,264 s, and `buy.mjs approve` stopped with a stack trace: `POST /v1/faucet: rate_limited: too many faucet grants from this client; retry later`. Nothing was paid. `buy.txt` step 5 lists no faucet error. A pilot buyer makes one deal, so this is for the next rehearsal: reuse one seller key, and space the buyers.
3. **Info · the operators accept a check with unfilled template placeholders.** The first run of case 4 offered checks whose `scope` and `coverage` schemas still held `"{{commit}}"`, `"{{files}}"` and `minItems: "{{files.length}}"` (a scratch seller's bug, not Crow's). The operators took the offer, `buy.mjs` showed those checks to the buyer, and the adjudicator refused `scope` and `coverage`, so the buyer was refunded. It fails closed for the buyer. Whether the offer route should refuse a schema with a string where JSON Schema wants a number is for the operators' owners (D31 refuses only what is malformed).
4. **Info · no seller on the site sells by quote.** The only seller Crow runs, the test seller, takes a sealed intake, so a stranger cannot try `buy.mjs`'s quote path end to end without a seller of its own. The pilot is not affected: its seller sells by quote.
5. **Info · one transient disagreement.** In case 1 the seller adapter logged once, 11 s after the offer, "operators disagree on /v1/commitments/<id>; do not proceed", and went on at its next poll. No deal was affected.
6. **Info · the record on Sepolia.** `row.paidTo` is null and the two postings checks do not run on a release or refund, because the chain's events carry no postings (known; `examples/deal-record.ts` line 400). `row.transactions` lists the decision's transaction three times. Check the payee from the token's Transfer logs, as the blocks above do.

### Not covered live

- **A panel's reject.** A live panel cannot be made to reject; case 4 is a refund by the checks after delivery. Case 3 shows the live panel deciding, with an accept.
- **Days.** Cases 5, 7 and 9 ran in minutes. Restarts over days, operator deploys during a deal and a key store kept for days are not shown.
- **The pilot kit's own terms and sample report**, and the pilot seller's own adapter and API: they stay local (see "The sellers").

## Handoff

**Done.** All eleven cases and the first hour ran on the live service on 2026-11-13 and ended as the kit expects; the table above has one row per case. The private kit's evidence holds the live results beside the local ones (in the private repository, 2026-11-13). One fix, pull request 490, is open; its site deploy is Rafa's.

**To rerun a case** (from a worktree of `main` after `pnpm install --frozen-lockfile && pnpm -r build`; test keys only):

- Cases 1 to 3: `pnpm audit-deal --live --case <released|redelivered|rubric> --out <dir>`. Each case takes two faucet grants.
- Cases 4 to 11: install `buy.mjs` with `buy.txt`'s step 1 in an empty folder and run a seller on `127.0.0.1`: the seller adapter with the public stub job API, or a seller built on `examples/agent.ts` (set `HOLDBACK_CHAIN_ID=11155111` and `HOLDBACK_VERIFYING_CONTRACT` to the rules contract, or it signs under the simulator's domain and the operators answer `invalid_signature`). The scratch scripts this run used are not committed; they are described in the case rows.
- Space the buyers: the faucet grants one client 10 addresses an hour.

**For the owners.**

- Rafa: merge pull request 490 when green and reviewed, then a site deploy; the kit's lines that are now false (in the private kit's evidence).
- The operators' owners: finding 3, whether the offer route should refuse a check schema with a string in a numeric keyword.
- The next rehearsal: a panel reject and days-long waits are not covered (above).

**Status:** done once this file merges.
