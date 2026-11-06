# T-067: The homepage's API animation shows the live API, and the recorded demo runs again on Sepolia with a stranger's own terms

- **Lane:** site, demo
- **Phase:** 5 (the demo on a public testnet; D53 keeps it out of Phase 2)
- **Depends on:** stable EVM operations finishing first (D53: T-216, T-221's leftovers, T-206 and T-212). It builds on T-213, T-217, T-221, T-222, T-228 and T-229, which are live.
- **Paths this task may touch:** `site/build.mjs` (the code streams and the plate notes in `FIGURE`), `site/index.html` (generated), `site/check.mjs`, `site/visualdemo/index.html`, `tools/demo-recording/` (new), `fixtures/site/` (new: one recorded event log of a live deal with Crow's test seller), `docs/demo.md`, `docs/team.md` (one Rules and checks row), `docs/update-flow.md` (the row from the API to the homepage), `docs/operations.md` (the site deploy record), `docs/plan.md` (this row), this file. Not `spec/`, `apps/`, `packages/`, `contracts/` or `examples/`.
- **Human gate:** yes, for the crow-site deploy, for the new recording (Rafa's go-ahead) and for publishing or sharing that recording. The live deals use test tokens only.
- **Status:** todo (deferred until after stable EVM operations, Rafa 2026-11-06: "We can do that later but you should add a ticket for it.")
- **Agent/session:** not started. A docs session wrote this ticket on 2026-11-06 (branch `docs-ticket-homepage-animation-demo`).

## Intent

Rafa, 2026-11-06:
- "You can add a note that the homepage API background animation reflects the actual API, and the demo used for the previous recording we built as well should get updated. We can do that later but you should add a ticket for it."
- On the demo: "For the demo it should not be the one-click, but should be assuming stranger uses the testnet version with their own contract terms".

Restated: two surfaces still show the product as it was on SimChain, before the demo moved to Sepolia on 2026-11-03 (T-213).

1. **The homepage's background animation.** Two faint code streams scroll down each side of https://escrow.stream/: the buyer agent's calls on the left and the seller agent's on the right, paced with the drawing's four plates (release, refund, default, appeal). They come from the SimChain case study `examples/buy-dataset.ts`. This task makes them show the live API: real endpoint paths, real field names, real states and the real order of steps for a deal with Crow's test seller, with the amounts the live config gives. A check in `site/check.mjs` keeps them true.
2. **The recorded demo.** The last recording shows a deal between two people's agents on 2026-11-02, on the demo's SimChain world. This task runs the same kind of deal again on today's live testnet: a stranger's agent writes its own contract terms through the public API (its deliverable, its checks or rubric, its price, its windows and its choice of adjudicators) and runs the deal to settlement on Sepolia. The path is the one `llms.txt` describes for integrating by hand, "Two agents, two people" and the sections it links. The replay page and a recording script in the repository follow that deal, and a new recording is made on Rafa's go-ahead.

Non-goals:
- Any API change: no route, field, state, schema, contract or operator change. If the animation or the demo needs something the API lacks, write it in Handoff and stop.
- The One-Click flow in the demo (Rafa's correction above). The homepage's Try line and its copied prompt (T-229) stay as they are.
- The test seller's preset in the recording. The animation may show a deal with the test seller; the recorded demo uses terms the stranger chose.
- `pnpm demo` (`apps/demo`): the narrated, keyless walkthrough on in-process SimChain stays as it is, because `pnpm verify` runs it offline (`docs/demo.md`).
- A new homepage design: the drawing, its four plates and the layout stay. Only the streams' text and the plate notes change.

## Context

Surveyed on 2026-11-06 at about 09:05 UTC against main at `3c54cf0` and the live operators. Labels: measured (read from the code, a file or a live read), documented (stated in `site/llms.txt`, `docs/api.md` or live discovery), inferred.

**The live API** [measured]: `GET /v1/status` on https://api.escrow.stream and https://api2.escrow.stream reads `schemaVersion` "0.10", `settlement.chainId` "11155111" (Sepolia) and the "Holdback" domain version "0.7" at HoldbackRules `0xf38287e5c5c1f20c6d03be500edbf8a244f27cfa`, with `head.eventSeq` 553 on both. The OpenAPI document op-1 serves (`/v1/openapi.json`, OpenAPI 3.1.0, 41 paths) equals the repository's `spec/openapi.json` except for its `servers` entry. The states are in `spec/schemas/commitment-state.schema.json` and the event types in `spec/schemas/event.schema.json`.

**A deal with Crow's test seller, as the live API ran it** [measured: `GET /v1/commitments/0xe480d0205d8a6b1aa3381ef315aa97d15bad3b50cb5fef045c153f30971a9ea0/events`, T-229's "always allow" run on 2026-11-05]. Events in order: `commitment.offered` (16:05:29 UTC), `adjudicator.accepted`, `commitment.agreed`, `fee.operator` (4710000) and `hold.funded` (26000000) in one transaction, `delivery.submitted` (a transaction, 16:05:48), `key.released` to the primary adjudicator, `judgment.decided` (accept) with `settlement.released` and `key.released` to the buyer in one transaction (16:06:00), and `appeal.expired` (a transaction of 80,792 gas, 16:07:12). Every chain step carries `payload.tx` and `payload.block`. The buyer's side of that order is documented in `llms.txt` "Crow's test seller" and "Two agents, two people": read the card at `https://escrow.stream/agents/test-seller/agent.json`, take tUSDC from `POST /v1/faucet`, store the sealed `crow-proposal` with `POST /v1/ciphertext`, send the `crow-request` to `intake.api`, poll `intake.status` until `offered`, read `/v1/commitments/{id}/terms` on both operators, `POST /v1/prepare/agree-and-fund`, `POST /v1/commitments/{id}/agree`, then `GET /v1/commitments/{id}/key?recipient=` and `GET /v1/ciphertext/{id}`. The test seller, an ordinary party, calls `POST /v1/prepare/offer`, `POST /v1/commitments`, `POST /v1/ciphertext`, `POST /v1/prepare/delivery` and `POST /v1/commitments/{id}/deliveries`.

### 1. The homepage animation: what it shows today and where that differs

The streams are the `CALLS` table and the plate notes `S` inside `FIGURE` in `site/build.mjs`, drawn into `#stream-b` and `#stream-s`. Commit `60cd914` wrote them on 2026-11-01 from `examples/buy-dataset.ts`, which runs against `pnpm sim` and prices in the `tUSD` symbol. T-213 (`cf536f8`, 2026-11-03) changed only the token, from tUSD to tUSDC [measured: `git log -L` on those lines].

Every endpoint path the streams name exists in the live OpenAPI, and every state they wait for (`AcceptedByAdjudicator`, `Held`, `Released`, `Refunded`, `Defaulted`, `appealState: open`) is in the live enums [measured]. The drift is in the steps and the numbers:

| What the streams show today | What the live API does |
| --- | --- |
| Helper calls from the examples' agent (`seller.offer`, `buyer.agreeAndFund`, `seller.deliver`, `buyer.waitFor`, `buyer.openDelivery`, `mail`, `balance`) in place of most HTTP calls | The steps are `POST /v1/prepare/<kind>`, then a signature, then the submit path; reads are `GET /v1/commitments/{id}` and its sub-routes [documented, `llms.txt` section 4] |
| The buyer mails the seller and the seller offers | With the test seller the buyer seals a proposal to the seller's intake and polls `intake.status` for the commitment ID; the seller offers from its one standing address [documented] |
| "sign Agree + FundingAuthorization" | Three signatures: `Agree`, `ReceiveWithAuthorization` for the funding and `TransferWithAuthorization` for the operator fee, the last two under tUSDC's own domain [documented, section 6] |
| Balances 9974000000 (buyer) and 10025000000 (seller) after a release; 9999000000 after a refund, "the 1 tUSDC fee is spent" | The faucet grants 1000000000 (1,000 tUSDC). Read on 2026-11-06, the buyer of the deal above, a fresh key used once, holds 969290000 (1,000 − 25 − 1 − 4.71 tUSDC), and the standing test seller holds 1350000000 [measured]. A refund keeps the 1 tUSDC adjudication fee and the 4.71 tUSDC operator fee, so a fresh buyer ends at 994290000 [inferred: 1,000 − 1 − 4.71 tUSDC] |
| No operator fee anywhere | `fees.operator`: 1 bp, at least 4710000 (4.71 tUSDC), sent in the funding transaction and never refunded; a 25 tUSDC deal costs 30.71 tUSDC [measured: discovery and the test seller's `offers[0].fees.total`] |
| No transaction, no block | Each money step waits for a Sepolia block, about 12 s, and its event names the transaction [documented; measured on the deal above] |
| No final step | When the appeal window closes, `appeal.expired` arrives as its own Sepolia transaction with `actor` "anyone", and `finalAt` is set [measured] |
| Default plate: `judgeBy` passes, then `triggers/default`, then `triggers/apply-default` | The fallback adjudicator takes over first (`triggers/fallback`, `FallbackJudging`), its panel seeded from the drand quicknet round at `judgeBy`. `default` is due only after `fallbackBy` with no decision. Anyone may post a due trigger, and the operators send it on chain, also for a deal behind the chain (T-228). The seller's compensation is 1000 bps of the price, 2.50 tUSDC on 25 tUSDC [documented, `docs/api.md` triggers row; measured, the rulebook] |
| Appeal plate: `POST /v1/prepare/appeal`, sign, submit | On Sepolia the appellant first approves tUSDC to HoldbackBonds (`0x83f3a2615a2be9a7dadca924ed9952ec85749ad1`) from its own address with its own Sepolia ETH, and the appeal adjudicator decides after the first drand quicknet round that follows the appeal [documented, "Beyond the happy path"] |
| `GET /v1/adjudicators` → "3 · fee.min 1 tUSDC · bonded" | 5 registrations: Crow's 3 marked with `observed.defaultFor`, 1 more bonded, 1 with `observed.bond` "none" [measured] |
| The offer omits `disclosure`, `nonce`, `clubId` and `timing` | `disclosure` has no default, and the demo's adjudicators accept only "public"; a prepare without its nonce is refused with 400 [documented, sections 4 and 5, and discovery `notes`] |

Unchanged and right [measured]: the faucet's 1,000 tUSDC and `demo-club`, the hold of 26000000 (price plus the 1 tUSDC adjudication fee), the club's `appealBondRateBps` 500 and `appealFee` 25 tUSDC, the default outcome (refund the buyer, compensate the seller), and the routes `/terms`, `/events`, `/judgment`, `/recipients`, `/receipts`, `/deliveries?validateOnly=true`, `/v1/openapi.json` and `/.well-known/holdback.json`.

Nothing checks the streams today: `site/check.mjs` checks `llms.txt`'s routes against `docs/api.md`, never the drawing's script [measured].

### 2. The recorded demo: what was recorded and what is out of date

**What was recorded** [measured]:
- A rehearsal deal on 2026-11-02 between two people's agents, commitment `0xd0d4…76de`, from 22:26:59 to 22:36:24 UTC. The buyer's agent wrote its own checks-only terms (`customers.csv`, 50 rows, 5 checks, 25 tUSD) and sealed them to the seller's intake; the seller's agent offered exactly those terms. A Loom screen recording dated 2026-11-02 and the rehearsal's local files are in `reports/demo-recording/` on Rafa's Mac, which git ignores (inferred: the recording shows this deal, from its date and folder).
- `/visualdemo` (`site/visualdemo/index.html`, PRs 100, 101 and 106) replays that deal's log in three panels (buyer, seller, arbitrator) with a flow diagram. Its steps are typed by hand in `STEPS`. PR 106 re-recorded it as an MP4 of 62.0 s at 1920×1080; `reports/visualdemo/crow-visualdemo.mp4`, also git-ignored, is that file (inferred from its date, 2026-11-03).
- No recording script is in the repository: a search for `mp4`, `ffmpeg`, `recordVideo` and `screencast` finds none. A new recording cannot be reproduced from the repository today.

**Out of date:**

| Item | The recorded demo (2026-11-02) | Today (2026-11-06) |
| --- | --- | --- |
| Settlement | The demo world's SimChain: the pinned domain was "0.6" on chain 31337 with the placeholder contract `0x…484f4c44` [measured: `site/llms.txt` at `2424c69`, the last commit on main before the deal]. Payment, fee and key moved in the same second as the delivery, 22:35:24 UTC [measured: the replay's `STEPS`] | Sepolia, chain 11155111, HoldbackRules `0xf382…7cfa`, domain "0.7". Delivery and decision are separate transactions about 12 s apart, each with an Etherscan link [measured] |
| Schema | API schema 0.8 [measured, same file] | 0.10 [measured] |
| Token and fees | "tUSD"; a 0.01 tUSD operator fee; "Paid 26.01 tUSD" [measured: the replay page] | tUSDC, named by its address `0x5029…96b6`; a 4.71 tUSDC operator fee; 30.71 tUSDC for a 25 tUSDC price [measured] |
| One-Click | Not shown | One approval from the homepage prompt since 2026-11-05 (T-229). Rafa's correction keeps it out of this demo, so the recording does not show it |
| Crow's test seller | Did not exist | Live since 2026-11-04 (T-222). Its preset (3 rows for 25 tUSDC) is not the demo's terms; the stranger writes its own |
| drand proofs | Not shown: the replay has only the primary adjudicator's path | Fallback and appeal panels are seeded from a drand quicknet round that the rules contract verifies (T-217) [documented, discovery `notes`]. The new demo says where drand enters, and shows it if it includes a fallback or an appeal (Handoff, question 2) |
| Adjudicators | One arbitrator, `0xc068…e679`, accepted through `/acceptance` | Registrations signed by each adjudicator at `GET /v1/adjudicators`, with the bond read from chain; anyone can register with `POST /v1/adjudicators` (T-221, ADR-0030). Crow's demo adjudicators decline terms that name another fallback or appeal adjudicator [documented] |
| Closing | "Final" is a quiet 60-second wait | `appeal.expired` is its own Sepolia transaction, and anyone may post a due timeout, which the operators send on chain, also for a deal behind the chain (T-228) [measured; documented] |

**What a stranger's own terms can be on the live demo** [documented in `llms.txt` and discovery]: disclosure "public" only; judge, fallback and appeal windows of 60 s or more (`minWindowsSec`); for two people, `"offerExpiresInSec": 3600, "fundWithinSec": 7200`; checks-only, or a rubric judged by a live panel of pinned models from Anthropic and DeepSeek within 30 live calls a day, after which panels are scripted and say so; Crow's three adjudicators, or one the stranger registers and bonds with its own Sepolia ETH.

## Acceptance criteria

**The animation:**
- [ ] Test first: `node site/check.mjs` fails on today's streams. It names at least the missing operator fee, the stale balances and the default plate's skipped fallback.
- [ ] The animation uses only endpoints, fields and states the live API serves, in the order of a deal with Crow's test seller (Context). The amounts come from the live config: the faucet grant, `fees.operator` and the test seller's catalog.
- [ ] `site/check.mjs` fails when the animation drifts. Its checks cover:
  - every path, against `spec/openapi.json`;
  - every state, against `spec/schemas/commitment-state.schema.json`;
  - every event type, against `spec/schemas/event.schema.json`;
  - the order of steps, against the event log of one live test-seller deal saved in `fixtures/site/`;
  - every amount, against `apps/operator/src/registry.ts` (`DEFAULT_FAUCET_GRANT`), `apps/demo-cloud/wrangler.op1.jsonc` (the `OPERATOR_FEE_*` values) and `apps/test-agents/src/catalog.ts`.
- [ ] `node site/build.mjs && node site/check.mjs` pass, and `docs/team.md` gets the check's row under Rules and checks.

**The demo and its recording:**
- [ ] The demo (the `/visualdemo` replay) and a recording script in `tools/demo-recording/` run against today's live demo, end to end on Sepolia. Every step goes through the public API, and every chain step links its Etherscan transaction.
- [ ] The recording uses terms the stranger chose: its deliverable, its checks or rubric, its price, its windows and its adjudicators. None comes from the test seller's preset, and the One-Click flow does not appear.
- [ ] The script writes the deal's log in the shape the replay page reads, so the next update reruns the script instead of editing `STEPS` by hand.
- [ ] A new recording is made, on Rafa's go-ahead. Its commitment ID, transactions, length and resolution go in Evidence.
- [ ] `pnpm verify` runs, and its report is read.
- [ ] After Rafa's go-ahead, crow-site is deployed and its record added to `docs/operations.md`.

## Out of scope

- Any API change (Non-goals).
- The One-Click flow and the test seller's preset in the recorded demo.
- `pnpm demo` and its SimChain beats.
- Publishing or sharing the recording: Rafa decides where it goes.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

- **Phase 5.** Its goal is the demo on a public testnet with two operator nodes, and it already holds the test seller (T-222) and "Neutrality beat 7 on testnet". This ticket is not stable EVM operations, so D53 keeps it out of Phase 2.
- **Record after T-212's redeploy** [inferred]. T-212's remaining items go out with the next contract redeploy, and a new rules contract needs a new demo world (D49). A recording made before then would show addresses that go stale.
- **The recorded demo is `/visualdemo` and the rehearsal it replays,** found from PR 106 ("MP4 re-recorded: 62.0 s, 1920×1080") and the git-ignored files in `reports/`. No video of `pnpm demo` turned up in `reports/` [measured: `find` for `*.mp4`].

## Handoff

Not started. To resume: read Context, then confirm the survey still holds (`/v1/status` on both nodes, one deal's `/events`, `git log` on `site/build.mjs`), because T-212's redeploy changes the contract addresses.

Open questions for Rafa:
1. Who plays the second party in the recording? In the 2026-11-02 rehearsal a second person's agent sold through its own intake. A stranger's single agent could also play both sides (`llms.txt`, "To run the same test deal step by step"). The proposed default is two agents through an intake, because the demo's story is two agents from different firms (`docs/demo.md`).
2. Should the recording add a second deal that shows a fallback or an appeal with its drand proof, or keep only the happy path to Final?
3. Should the 2026-11-02 replay stay online as history beside the new one, or should the new deal replace it at `/visualdemo`?
