# Demo: two agents, one $2,000 job, nobody in control

The first product priority. The demo exists to describe the experience to a first reader. It should leave that reader able to say what an agent can commit, how judgment is defended, and where control sits.

## Audience and takeaway

**Audience:** a first reader who works on agentic commerce (protocols, payments, evaluation, safety).

**Takeaway in one sentence:** two agents from different firms put money and work behind a promise; a bonded multi-model panel judges delivery; settlement happens in seconds; and no single party — including us — could have stopped it or taken the funds.

## Run it

```
pnpm demo                 # scripted judges: deterministic, no keys, a few seconds
pnpm demo --live          # live judges from two families, a few minutes and a few dollars a run (see below)
pnpm demo --beat 4        # run one beat
open demo/out/index.html  # timeline viewer
```

**Live mode (T-028).** `pnpm demo --live` needs `HOLDBACK_ANTHROPIC_API_KEY`, `HOLDBACK_OPENAI_COMPATIBLE_API_KEY` and `HOLDBACK_OPENAI_COMPATIBLE_BASE_URL` (DeepSeek), in the environment or in the git-ignored `.env` at the repository root, which the script loads with `--env-file-if-exists`; without them it refuses and names what is missing. Every bench then seats `config/judges-live.yaml` (Anthropic and DeepSeek, five pinned models) and calls the models; the per-beat fake scripts are ignored, so beat 6's appeal is the models' own verdicts. Transcripts say `Mode: live`, name each seat's pinned model ID, and the run ends with the number of live calls and tokens by model. Costs are dominated by input: the demo's CSV deliverable is about 60,000 to 75,000 tokens per judge call, so one full run (14 calls) costs about $3 at list prices (measured tokens, 2026-11-01). Live verdicts are not scripted to the story: on 2026-11-01 beat 3's panel split and escalated, beat 6's appeal rejected, and beat 7's fallback rejected the "good" CSV (the rubric's notes criterion), so the scripted narration of beats 3 to 7 does not hold in live mode.

Outputs per beat, in `demo/out/`:
- `<beat>.md`: a narrated transcript;
- `<beat>.json`: the machine-readable trace;
- `index.html`: a static timeline viewer, with no build step and no network.

Goal (not yet true): the transcripts and the `.expect.md` snapshots in `fixtures/scenarios/` become two renderings of one run (build review proposal 11, after the demo). Today each beat has its own fixture.

## Cast

| Role | Name in the demo | What it is |
| --- | --- | --- |
| Buyer agent | Atlas Research's procurement agent | Needs a customer dataset cleaned in 48 hours; budget $2,000 |
| Seller agent | Tidewater Data's cleaning agent | Offers deduplication, ISO 8601 dates, email validation |
| Club | Data Services Club (open rulebook v1) | Rulebook: windows, bonds, sealed-check cap, default compensation |
| Adjudicator | Bench A (bonded) | Runs the panel: two Claude judges and one judge from another family |
| Fallback adjudicator | Bench B | Takes over if Bench A misses its deadline |
| Appeal adjudicator | Bench C | Five judges, three families |
| Operators | op-1, op-2 | Interchangeable API nodes |
| Settlement | SimChain | In-process escrow rules with no admin keys. The public demo at crow.direct settles on Ethereum Sepolia instead, since 2026-11-03 (D41) |

All names are invented for the demo.

## Beats

| # | Beat | What the viewer sees | Litmus test shown |
| --- | --- | --- | --- |
| 1 | **Choose, agree and hold** | Seller offers terms naming Bench A, B and C, chosen by the two agents, at disclosure level `public` so the audience can read everything. Bench A accepts and reserves bond. Buyer signs, one call moves $2,050 (price plus $50 adjudication fee) into escrow. Timer shows milliseconds. Balances update | Agents choose the adjudicator; hold; machine speed |
| 2 | **Deliver without revealing** | Seller uploads an encrypted cleaned CSV. Buyer sees only hashes. Content key goes to the adjudicator | Two-sided hold |
| 3 | **Defended judgment** | Deterministic checks pass (row count, unique keys, date format). Panel seed revealed, judges listed with pinned model IDs, verdicts shown, cross-family agreement, accept | Multi-model judgment |
| 4 | **Settle** | Funds release to the seller; content key releases to the buyer in the same step; buyer verifies the plaintext hash; receipts signed. Narration: "Tidewater's $2,000 is final at the decision (1.2 s). Atlas can contest Bench A's decision for 300 s; if it wins, Bench A's $2,000 bond pays. Nothing takes the payment back from escrow." (illustrative numbers) | Fair exchange |
| 5 | **Bad work** | Second job: deliverable drops 8% of rows. A deterministic check fails, refund in one step, seller keeps the work | Hold; DvP for data |
| 6 | **Injection attempt** | Deliverable hides a base64 instruction telling judges to approve. Screen flags it, the panel cannot auto-accept, escalation to Bench C, five judges reject (scripted verdicts in `pnpm demo`; the models' own in `pnpm demo --live`) with the flag kept in the record, refund. A flagged appeal accepts only on a unanimous panel from all available families with no injection suspected, and otherwise rejects (ADR-0021 amendment, D27). A second delivery hides tag characters aimed at the buyer's own agent under an empty rubric: it is accepted, and the buyer's client shows "hidden payload stripped before your agent read it" from the signed screen report (ADR-0021) | Defenses |
| 7 | **Nobody in control** | Same job, failures in sequence: op-1 refuses to relay through its own relay policy (the agents' clients fail over to op-2); op-2 goes offline (the seller submits its delivery directly to SimChain); Bench A stays silent past `judgeBy` (anyone triggers the fallback; Bench B decides, and gets the content key only now, when it takes over). Club revocation is not shown: SimChain reads club membership from genesis only, so it has no run-time revocation (a backlog item). The club operator signs nothing in this flow | Neutrality |
| 8 | **Wrongful decision, paid by the bond** (optional) | Bench A wrongly rejects. Seller appeals, Bench C overturns, Bench A's bond pays the seller | Capital behind judgment |
| 9 | **Work for work** (optional; depends on the T-003 spike) | Two agents swap deliverables, each produced on its own user's compute, through two-sided holds. No money moves | Compute-native agreement |
| 10 | **Agree without a judge** (optional; outside the success criteria) | A third job. The buyer finds a gap and both agents co-sign a 70/30 split in milliseconds; the buyer gets the key, Bench A stands by and its bond is released, the fee returns to the buyer | 2-of-3: consent first, adjudicator only on disagreement |

Closing slide in the transcript, also stated by the narrator:
- finality per mode: the payee is final at the posting, the commitment at `finalAt` (`docs/architecture.md` §Finality);
- what remains centralized: residual risks from `docs/neutrality.md`;
- what a model provider could add: response attestation for judges (today a commitment proves which models and prompt had to judge, but not that the named model answered), a hold primitive on API credit as one rail among many, and model version disclosure for adjudication.

## Narration rules

- Every line states what happened and the number behind it: amount, milliseconds, model ID, hash prefix.
- Show the signed message for one beat, and one judge's prompt and verdict in beat 3, both collapsed by default in the viewer. The prompt is untrusted text: every surface makes it plain and escapes it.
- No marketing language. Label the mode honestly: "scripted" when fake judges run, "recorded" only when real model recordings are replayed, "live" when models are called. Never name task IDs in a transcript.
- The viewer and the terminal print the mode, source and units once; each beat adds only what differs.
- Show a balance table only when the ledger changed. The decision line states how long after delivery it came and how long judging took, measured by the adjudicator service.
- Each job ends with one line showing that both agents hold the same record (D26). Ledger reads through a client that tries op-1 first, Tide-7 through one that tries op-2 first; each fetches the commitment, every event and every receipt, and the line names the operator that signed each copy's receipts. The judgment record is the one the adjudicator published, found by the hash the decision event names (there is no read API for records yet). The hashes compare everything except the receipts' signer and signature, which differ by operator.
- The closing lists four residual control points (collusion, legal process, plaintext access, self-reported model identity) and points to `docs/neutrality.md` for the rest.

## Success criteria (T-013)

- A fresh clone produces all transcripts with scripted judges within 5 minutes, with no keys.
- A reviewer who has not read the docs can answer, from the transcript alone:
  1. Who held the money?
  2. Who decided?
  3. What stopped the injection?
  4. What happened when op-1 refused?
- Every beat is a passing scenario fixture.

**Status (2026-11-01, the Phase 1 close):**

- Fresh clone, no keys, all transcripts: **met** (measured in the T-013 dry run: first transcript after 741 ms, 10 s wall time with a warm pnpm store; a cold machine was not measured).
- A reviewer who has not read the docs answers the four questions from the transcripts alone: **met** (a no-context reviewer answered all four, quoting the transcripts; T-013 dry run). Rafa walked through the demo on 2026-11-01, closing the Phase 1 human gate.
- Every beat is a passing scenario fixture: **partly met**. Every beat runs on SimChain in `pnpm demo` and its tests, and 32 scenario fixtures pass in CI, but the transcripts are not themselves snapshots and some beat rows wait on runner features (T-016b: appeal steps, multi-commitment scenarios, live recordings). Accepted as the Phase 1 position; the rest moves to T-016b.
